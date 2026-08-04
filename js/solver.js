// Beam-search breeding-route solver. Pure logic, no DOM -- runs identically
// on the main thread or inside worker.js.
//
// A "state" is a breeding-relevant abstraction of a Pal: its species, which
// of the (up to 4) globally-desired passives it carries (`mask`, a bitmask),
// and how many other non-desired passives it carries (`junk`). Owned Pals
// become leaf states at zero effort; every other state is reached by
// breeding two existing states together.
//
// Gender model: an owned Pal has a fixed, known gender ('M'/'F'). A bred
// intermediate is tagged 'ANY' -- you can obtain either gender of it by
// re-hatching its parent pair, at a cost baked into that species' male/
// female ratio. Two fixed-gender states of the SAME gender can never be
// bred together (Palworld requires one male + one female); two flexible
// ('ANY') states are treated as freely gender-compatible (a documented
// simplification -- hatching a couple of extra eggs of each side to line up
// genders is cheap relative to matching passives, so it isn't modeled as a
// throttling cost). This keeps the meaningful constraint -- an owned
// same-gender pair, or a skewed-gender bred species paired against a fixed
// owned gender -- without recursively modeling multi-hatch gender matching
// for the fully-flexible case.

import { childOf } from './breeding.js';
import { cachedOutcomeDistribution } from './probability.js';

export const DEFAULTS = {
  // Benchmarked against a 10-Pal roster targeting a 2-generation-deep
  // species with 4 desired passives: beamWidth 1000 finds it correctly in
  // ~2s; 3000 (the old default) took ~12s for the same result with no
  // better an outcome. Very hard targets (species distance right at
  // maxSteps, needing all 4 passives) can still fail to find a route even
  // at much higher beam widths -- that's a known remaining limitation, not
  // something this default is meant to paper over.
  beamWidth: 1000,
  maxSteps: 6, // matches the Advanced Settings ceiling -- see settings.js
  timePerBreed: 5, // minutes per breeding attempt (egg + incubation); user-configurable
  maxResults: 5,
};

/** Build a map from desired passive internalName -> bit index (0..3). */
export function buildDesiredIndex(desiredPassiveNames) {
  const index = new Map();
  desiredPassiveNames.slice(0, 4).forEach((name, i) => index.set(name, i));
  return index;
}

/** Convert an owned-Pal roster entry into a leaf search state. */
export function ownedPalToState(pal, desiredIndex) {
  let mask = 0, junk = 0;
  for (const name of pal.passiveInternalNames) {
    if (desiredIndex.has(name)) mask |= (1 << desiredIndex.get(name));
    else junk++;
  }
  return {
    species: pal.speciesIdx,
    mask,
    junk,
    genderTag: pal.gender === 'MALE' ? 'M' : 'F',
  };
}

export function stateKey(species, mask, junk, genderTag) {
  return `${species},${mask},${junk},${genderTag}`;
}

/**
 * BFS closure of species reachable purely by breeding, starting from a seed
 * set of owned species indices. Ignores gender/passives entirely -- this is
 * a necessary-but-not-sufficient reachability check, used for the pre-flight
 * "is this species even reachable from your roster" diagnostic.
 */
export function reachableSpeciesClosure(seedSpeciesIndices, genderRules = []) {
  const reached = new Set(seedSpeciesIndices);
  let changed = true;
  while (changed) {
    changed = false;
    const current = Array.from(reached);
    for (let i = 0; i < current.length; i++) {
      for (let j = i; j < current.length; j++) {
        const a = current[i], b = current[j];
        const child = childOf(a, null, b, null);
        if (child !== null && !reached.has(child)) { reached.add(child); changed = true; }
        for (const rule of genderRules) {
          const forward = rule.p1 === a && rule.p2 === b;
          const reverse = rule.p1 === b && rule.p2 === a;
          if ((forward || reverse) && !reached.has(rule.child)) { reached.add(rule.child); changed = true; }
        }
      }
    }
  }
  return reached;
}

/**
 * Like reachableSpeciesClosure, but tracks the MINIMUM number of breeding
 * generations needed to reach each species, not just whether it's reachable
 * at all. Species-only reachability is cheap regardless of generation count
 * (bounded by ~299 species, unlike the passive-aware solver's state space),
 * so this always runs to the true unbounded fixpoint rather than needing a
 * generation cap of its own.
 */
export function reachableSpeciesDepths(seedSpeciesIndices, genderRules = []) {
  const depth = new Map(seedSpeciesIndices.map(s => [s, 0]));
  let gen = 0;
  let addedAny = true;
  while (addedAny) {
    gen++;
    addedAny = false;
    const known = Array.from(depth.keys());
    for (let i = 0; i < known.length; i++) {
      for (let j = i; j < known.length; j++) {
        const a = known[i], b = known[j];
        const child = childOf(a, null, b, null);
        if (child !== null && !depth.has(child)) { depth.set(child, gen); addedAny = true; }
        for (const rule of genderRules) {
          const forward = rule.p1 === a && rule.p2 === b;
          const reverse = rule.p1 === b && rule.p2 === a;
          if ((forward || reverse) && !depth.has(rule.child)) { depth.set(rule.child, gen); addedAny = true; }
        }
      }
    }
  }
  return depth;
}

/**
 * Pre-flight diagnostics: is the target species reachable from the owned
 * roster WITHIN the configured Max Steps, and is every desired passive
 * obtainable?
 *
 * Reachability used to ignore maxSteps entirely (an unbounded closure), so
 * a target that was reachable only in, say, 6 generations got a confident
 * green light even when Max Steps was set to 3 -- the solver (which DOES
 * respect maxSteps) would then spend real time searching before coming back
 * with nothing, for a reason the UI never surfaced. Now the true minimum
 * generation count is computed and compared against maxSteps, so a target
 * that's reachable only beyond the configured limit is blocked with an
 * actionable reason instead of silently wasting a search.
 *
 * Passive availability is a hard "impossible" only when nobody owns a
 * passive that can ALSO never be randomly rolled (e.g. Legend, Lucky) --
 * otherwise it's a soft "unlikely" warning, since the random-add step could
 * still introduce it.
 */
export function checkPreflight({ ownedPals, targetSpeciesIdx, desiredPassiveNames, passiveInfoByName, genderRules, maxSteps = Infinity }) {
  const depths = reachableSpeciesDepths(ownedPals.map(p => p.speciesIdx), genderRules);
  const minGenerations = depths.has(targetSpeciesIdx) ? depths.get(targetSpeciesIdx) : null;
  const speciesReachable = minGenerations !== null;
  const reachableWithinSteps = speciesReachable && minGenerations <= maxSteps;

  const passiveChecks = desiredPassiveNames.map((name) => {
    const info = passiveInfoByName(name);
    const anyOwnedHasIt = ownedPals.some(p => p.passiveInternalNames.includes(name));
    const randomAllowed = info ? info.randomAllowed : true;
    let status = 'ok';
    if (!anyOwnedHasIt && !randomAllowed) status = 'impossible';
    else if (!anyOwnedHasIt && randomAllowed) status = 'unlikely';
    return { internalName: name, name: info ? info.name : name, status };
  });

  return {
    speciesReachable,
    reachableWithinSteps,
    minGenerations,
    maxSteps,
    reachableCount: depths.size,
    passiveChecks,
    blocked: !reachableWithinSteps || passiveChecks.some(c => c.status === 'impossible'),
  };
}

function pairGenderProbability(a, b, maleProbOf) {
  const aFixed = a.genderTag === 'M' || a.genderTag === 'F';
  const bFixed = b.genderTag === 'M' || b.genderTag === 'F';
  if (aFixed && bFixed) return a.genderTag === b.genderTag ? 0 : 1;
  if (aFixed && !bFixed) {
    const needed = a.genderTag === 'M' ? 'F' : 'M';
    const mp = maleProbOf(b.species);
    return needed === 'M' ? mp : (1 - mp);
  }
  if (!aFixed && bFixed) return pairGenderProbability(b, a, maleProbOf);
  return 1; // both flexible -- see gender model note above
}

function genderTagToGender(tag) {
  return tag === 'M' ? 'MALE' : tag === 'F' ? 'FEMALE' : null;
}

function specialPairKey(i, j) {
  return i < j ? `${i}:${j}` : `${j}:${i}`;
}

/**
 * Enumerate every feasible concrete (aGender, bGender) assignment for a pair,
 * with its probability, WITHOUT collapsing flexible ('ANY') sides to null.
 * Only used for the rare species pair whose child depends on which parent is
 * male vs female -- every other pair is handled via the gender-agnostic
 * childOf() lookup plus pairGenderProbability().
 */
function feasibleGenderAssignments(a, b, maleProbOf) {
  const aFixed = a.genderTag === 'M' || a.genderTag === 'F';
  const bFixed = b.genderTag === 'M' || b.genderTag === 'F';

  if (aFixed && bFixed) {
    if (a.genderTag === b.genderTag) return [];
    return [{ aGender: genderTagToGender(a.genderTag), bGender: genderTagToGender(b.genderTag), p: 1 }];
  }
  if (aFixed && !bFixed) {
    const needed = a.genderTag === 'M' ? 'FEMALE' : 'MALE';
    const mp = maleProbOf(b.species);
    const p = needed === 'MALE' ? mp : (1 - mp);
    return p > 0 ? [{ aGender: genderTagToGender(a.genderTag), bGender: needed, p }] : [];
  }
  if (!aFixed && bFixed) {
    return feasibleGenderAssignments(b, a, maleProbOf).map(x => ({ aGender: x.bGender, bGender: x.aGender, p: x.p }));
  }
  // Both flexible: both concrete assignments are achievable (simplified cost
  // 1 each, per the gender model note above), and for the special-pair case
  // they can yield DIFFERENT children, so both must be offered as candidates.
  return [
    { aGender: 'MALE', bGender: 'FEMALE', p: 1 },
    { aGender: 'FEMALE', bGender: 'MALE', p: 1 },
  ];
}

/**
 * Run the beam search.
 *  - ownedPals: [{ speciesIdx, gender: 'MALE'|'FEMALE', passiveInternalNames: string[] }]
 *  - desiredPassiveNames: up to 4 passive internalNames (order defines bit assignment)
 *  - maleProbOf(speciesIdx): returns that species' male ratio (0..1)
 *  - onProgress(round, frontierSize): optional, called between rounds
 */
export function runSolver({
  ownedPals,
  targetSpeciesIdx,
  desiredPassiveNames,
  maleProbOf,
  genderRules = [],
  beamWidth = DEFAULTS.beamWidth,
  maxSteps = DEFAULTS.maxSteps,
  timePerBreed = DEFAULTS.timePerBreed,
  maxResults = DEFAULTS.maxResults,
  onProgress = null,
}) {
  const desiredIndex = buildDesiredIndex(desiredPassiveNames);
  const fullMask = desiredPassiveNames.length >= 4 ? 0b1111 : (1 << desiredPassiveNames.length) - 1;

  // Species pairs with a gender-specific override rule (currently just
  // Katress/Wixen) need special handling: unlike every other pair, the
  // child species DEPENDS on which parent is male vs female, so a
  // gender-agnostic lookup (used for all normal pairs) can't resolve it.
  const specialPairs = new Set(genderRules.map(r => specialPairKey(r.p1, r.p2)));

  const allStates = new Map(); // key -> stateRecord
  let frontierNew = [];

  ownedPals.forEach((pal, idx) => {
    const s = ownedPalToState(pal, desiredIndex);
    const key = stateKey(s.species, s.mask, s.junk, s.genderTag);
    const existing = allStates.get(key);
    if (existing) {
      existing.ownedRefs.push(idx);
    } else {
      allStates.set(key, {
        key, species: s.species, mask: s.mask, junk: s.junk, genderTag: s.genderTag,
        effort: 0, depth: 0, origin: 'owned', ownedRefs: [idx],
        parentAKey: null, parentBKey: null, p: null, attempts: null,
      });
      frontierNew.push(key);
    }
  });

  let round = 0;
  while (frontierNew.length > 0 && round < maxSteps) {
    round++;
    const newKeySet = new Set(frontierNew);
    const oldKeys = Array.from(allStates.keys()).filter(k => !newKeySet.has(k));
    const newKeys = frontierNew;

    const updatedOrNew = new Set();

    const emitChild = (keyA, keyB, a, b, childSpecies, genderP) => {
      const outcomes = cachedOutcomeDistribution(a.mask, a.junk, b.mask, b.junk);
      for (const outcome of outcomes) {
        const successProb = outcome.p * genderP;
        if (successProb <= 0) continue;
        const attempts = 1 / successProb;
        const timeCost = attempts * timePerBreed;
        const childEffort = a.effort + b.effort + timeCost;

        const childDepth = Math.max(a.depth, b.depth) + 1;
        const childKey = stateKey(childSpecies, outcome.mask, outcome.junk, 'ANY');
        const existing = allStates.get(childKey);
        if (!existing || childEffort < existing.effort) {
          allStates.set(childKey, {
            key: childKey, species: childSpecies, mask: outcome.mask, junk: outcome.junk, genderTag: 'ANY',
            effort: childEffort, depth: childDepth, origin: 'bred',
            parentAKey: keyA, parentBKey: keyB, p: successProb, attempts,
            ownedRefs: [],
          });
          updatedOrNew.add(childKey);
        }
      }
    };

    const considerPair = (keyA, keyB) => {
      const a = allStates.get(keyA), b = allStates.get(keyB);
      if (!a || !b) return;

      if (!specialPairs.has(specialPairKey(a.species, b.species))) {
        // The overwhelming majority of pairs: child species doesn't depend
        // on gender, so a gender-agnostic lookup is always valid, and
        // pairGenderProbability alone captures the full gender cost/feasibility.
        const genderP = pairGenderProbability(a, b, maleProbOf);
        if (genderP <= 0) return;
        const childSpecies = childOf(a.species, null, b.species, null);
        if (childSpecies === null) return;
        emitChild(keyA, keyB, a, b, childSpecies, genderP);
        return;
      }

      // Special-cased pair: the result depends on which parent is male vs
      // female, so every feasible concrete gender assignment must be tried
      // individually (a flexible 'ANY' state can't be queried with a null
      // gender here -- that loses the rule match entirely).
      for (const asg of feasibleGenderAssignments(a, b, maleProbOf)) {
        const childSpecies = childOf(a.species, asg.aGender, b.species, asg.bGender);
        if (childSpecies === null) continue;
        emitChild(keyA, keyB, a, b, childSpecies, asg.p);
      }
    };

    for (let i = 0; i < newKeys.length; i++) {
      for (let j = i; j < newKeys.length; j++) considerPair(newKeys[i], newKeys[j]);
      for (let j = 0; j < oldKeys.length; j++) considerPair(newKeys[i], oldKeys[j]);
    }

    // Beam prune: keep all owned leaves (effort 0, always useful), cap bred
    // states to the configured beam width.
    //
    // Critical: this must NOT rank purely by effort. Accumulating desired
    // passives is inherently expensive (each one costs multiple breeding
    // attempts), while breeding two "no progress" (mask=0) common Pals is
    // cheap and produces far more distinct states. A pure cheapest-first
    // beam therefore fills up entirely with mask=0 states every round and
    // permanently starves out the rare, expensive, higher-mask states that
    // are the only ones that can ever reach the goal (mask===fullMask) --
    // the search looks like it's working (states climbing, rounds
    // completing) while never actually making progress toward the target.
    //
    // Fixed by bucketing the beam budget by `mask` and keeping the cheapest
    // states within each bucket, so every mask value present gets a
    // guaranteed minimum share of the beam instead of competing directly
    // against the much larger, much cheaper mask=0 population. Leftover
    // budget from sparsely-populated buckets is redistributed so capacity
    // is never wasted.
    if (allStates.size > beamWidth) {
      const bred = Array.from(allStates.values()).filter(s => s.origin === 'bred');
      const ownedCount = allStates.size - bred.length;
      const budget = Math.max(0, beamWidth - ownedCount);

      const byMask = new Map();
      for (const s of bred) {
        if (!byMask.has(s.mask)) byMask.set(s.mask, []);
        byMask.get(s.mask).push(s);
      }
      const perMaskBudget = Math.max(1, Math.floor(budget / byMask.size));

      const keep = new Set();
      for (const group of byMask.values()) {
        group.sort((x, y) => x.effort - y.effort);
        for (const s of group.slice(0, perMaskBudget)) keep.add(s.key);
      }
      if (keep.size < budget) {
        const remaining = bred.filter(s => !keep.has(s.key)).sort((a, b) => a.effort - b.effort);
        for (const s of remaining) {
          if (keep.size >= budget) break;
          keep.add(s.key);
        }
      }

      // A kept state's ancestors (its parentA/parentB, and theirs, ...) must
      // never be pruned, however low-mask or high-effort they look in
      // isolation -- they're load-bearing for reconstructing this state's
      // route. Skipping this step doesn't just lose a step from the display:
      // it leaves a dangling parentAKey/parentBKey that crashes
      // reconstructRoute() outright once that ancestor is actually deleted.
      let frontier = Array.from(keep);
      while (frontier.length > 0) {
        const next = [];
        for (const key of frontier) {
          const s = allStates.get(key);
          if (!s || s.origin !== 'bred') continue;
          for (const parentKey of [s.parentAKey, s.parentBKey]) {
            if (parentKey && !keep.has(parentKey)) {
              keep.add(parentKey);
              next.push(parentKey);
            }
          }
        }
        frontier = next;
      }

      for (const s of bred) {
        if (!keep.has(s.key)) {
          allStates.delete(s.key);
          updatedOrNew.delete(s.key);
        }
      }
    }

    frontierNew = Array.from(updatedOrNew);
    if (onProgress) onProgress(round, allStates.size);
  }

  // Different (mask, junk) outcomes from the exact same pair of parents
  // (e.g. "got the desired passive with 0 extra junk" vs "...with 2 extra
  // junk") are different solver states, but they're not different ROUTES --
  // it's the same breeding plan either way, just a different amount of
  // incidental junk tagging along. Deduplicate by the actual breeding-pair
  // structure (routeSignature) so the same plan is never shown twice.
  //
  // Ranked by generation count first, effort second -- so the first result
  // is always the route needing the fewest breeding generations, with
  // ties (and everything after it) broken by lowest effort. This is a
  // ranking over whatever routes the search actually found, not a proof
  // that no shallower route exists anywhere in the graph: the effort-driven
  // beam (see the pruning comment above) can in rare cases discard a
  // shallow-but-costly intermediate in favor of a cheaper-but-deeper one,
  // same heuristic-search caveat that applies to this tool throughout.
  const candidates = Array.from(allStates.values())
    .filter(s => s.species === targetSpeciesIdx && s.mask === fullMask)
    .sort((x, y) => x.depth - y.depth || x.effort - y.effort);

  const seenSignatures = new Set();
  const results = [];
  for (const candidate of candidates) {
    if (results.length >= maxResults) break;
    const route = reconstructRoute(candidate, allStates);
    const signature = routeSignature(route);
    if (seenSignatures.has(signature)) continue;
    seenSignatures.add(signature);
    results.push(route);
  }

  return {
    results,
    rounds: round,
    stateCount: allStates.size,
  };
}

/** Canonical breeding-plan identity: same species and same parent pairs
 * recursively, ignoring the mask/junk/probability details that vary between
 * outcomes of the same pair. Parent order is canonicalized so a route isn't
 * treated as distinct merely because parentA/parentB were stored swapped. */
function routeSignature(node) {
  if (node.type === 'owned') {
    return `L:${node.species}:${node.genderTag}`;
  }
  const a = routeSignature(node.parentA);
  const b = routeSignature(node.parentB);
  const [x, y] = a <= b ? [a, b] : [b, a];
  return `B:${node.species}:(${x})(${y})`;
}

/** Walk backpointers from a result state down to owned leaves, building a tree. */
function reconstructRoute(state, allStates) {
  if (state.origin === 'owned') {
    return {
      type: 'owned', species: state.species, mask: state.mask, junk: state.junk,
      genderTag: state.genderTag, ownedRefs: state.ownedRefs, effort: state.effort, depth: 0,
    };
  }
  const a = allStates.get(state.parentAKey);
  const b = allStates.get(state.parentBKey);
  return {
    type: 'bred', species: state.species, mask: state.mask, junk: state.junk,
    effort: state.effort, depth: state.depth, p: state.p, attempts: state.attempts,
    parentA: reconstructRoute(a, allStates),
    parentB: reconstructRoute(b, allStates),
  };
}

export { pairGenderProbability, feasibleGenderAssignments, specialPairKey };
