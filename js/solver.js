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
// female ratio. Two fixed-gender states of the SAME gender can still be
// bred together (Palworld requires one male + one female per pair, but the
// Pal Reverser item lets you flip one owned Pal's gender on demand) -- see
// pairGenderInfo's `reversalSide`, surfaced in the UI so the player knows
// the route needs that item. Two flexible ('ANY') states are treated as
// freely gender-compatible (a documented simplification -- hatching a
// couple of extra eggs of each side to line up genders is cheap relative to
// matching passives, so it isn't modeled as a throttling cost). This keeps
// the meaningful constraint -- a skewed-gender bred species paired against
// a fixed owned gender -- without recursively modeling multi-hatch gender
// matching for the fully-flexible case.

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

/**
 * Like the old pairGenderProbability, but also reports whether the pairing
 * only works by using a Pal Reverser (the in-game item that flips a Pal's
 * gender) on one of the two OWNED, fixed-gender sides. Two fixed-gender Pals
 * of the same gender used to be a hard dead end (probability 0); Palworld
 * actually lets you reverse one of them on demand, so that pairing is fully
 * usable -- just worth flagging to the player, since it costs an item they
 * need to have or make. `reversalSide` is 'A'/'B' (whichever side needs the
 * item) or null when no reversal is involved.
 */
function pairGenderInfo(a, b, maleProbOf) {
  const aFixed = a.genderTag === 'M' || a.genderTag === 'F';
  const bFixed = b.genderTag === 'M' || b.genderTag === 'F';
  if (aFixed && bFixed) {
    if (a.genderTag !== b.genderTag) return { p: 1, reversalSide: null };
    return { p: 1, reversalSide: 'B' };
  }
  if (aFixed && !bFixed) {
    const needed = a.genderTag === 'M' ? 'F' : 'M';
    const mp = maleProbOf(b.species);
    return { p: needed === 'M' ? mp : (1 - mp), reversalSide: null };
  }
  if (!aFixed && bFixed) {
    const needed = b.genderTag === 'M' ? 'F' : 'M';
    const mp = maleProbOf(a.species);
    return { p: needed === 'M' ? mp : (1 - mp), reversalSide: null };
  }
  return { p: 1, reversalSide: null }; // both flexible -- see gender model note above
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
 * childOf() lookup plus pairGenderInfo().
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
 * Expands `keep` in place to include every ancestor of anything already in it.
 *
 * A kept state's parents (and theirs, recursively) must never be dropped,
 * however poor they look in isolation -- they're load-bearing for
 * reconstructing that state's route. Skipping this doesn't merely lose a step
 * from the display: it leaves a dangling parentAKey/parentBKey that crashes
 * reconstructRoute() outright once the ancestor is actually deleted.
 */
function protectAncestors(keep, allStates) {
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
}

/**
 * True when `t` is at least as good as `s` for every purpose the search cares
 * about, so `s` can be discarded without losing any route.
 *
 * Requires the same species and the same gender tag, then: a superset of the
 * desired passives, no more junk, and no more effort. Each of those is
 * monotone in the outcome distribution -- more desired passives in the parent
 * pool can only help, and junk only dilutes the pool the child draws from.
 *
 * Gender must match exactly rather than treating 'ANY' as universally better.
 * It isn't: two fixed-gender parents pair at probability 1 (a Pal Reverser
 * covers the same-gender case), whereas pairing a flexible parent against a
 * fixed one costs that species' gender ratio. Neither dominates the other.
 */
function dominates(t, s) {
  return t.species === s.species
    && t.genderTag === s.genderTag
    && (t.mask & s.mask) === s.mask   // t carries every desired passive s has
    && t.junk <= s.junk
    && t.effort <= s.effort;
}

/**
 * Marks bred states that some other state dominates, so they are no longer
 * expanded as parents. Unlike the beam this is lossless: a dominated state
 * cannot appear in any route a surviving state couldn't serve at least as
 * cheaply. Owned Pals are never marked -- they're real Pals the player has,
 * and they anchor the route display.
 *
 * Tombstones rather than deletes, which matters a lot. Deleting was the
 * obvious first implementation and it was measurably worse: the pair that
 * produced a dominated state is still in the frontier, so emitChild found no
 * existing entry and recreated it every single round. That churn kept
 * updatedOrNew large, which grew the O(n^2) pair scan and stopped the search
 * converging early. Leaving the record in place means emitChild sees it and
 * skips, so each state is derived once. It also makes dangling parent
 * pointers impossible, so no ancestor protection is needed here.
 *
 * Returns the number of states newly marked.
 */
function pruneDominated(allStates, updatedOrNew) {
  const groups = new Map();
  for (const s of allStates.values()) {
    const g = `${s.species},${s.genderTag}`;
    let arr = groups.get(g);
    if (!arr) groups.set(g, arr = []);
    arr.push(s);
  }

  let marked = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.effort - b.effort);
    for (let i = 0; i < group.length; i++) {
      const s = group[i];
      if (s.origin !== 'bred' || s.dominated) continue;
      for (let j = 0; j < i; j++) {        // only states already at <= effort
        const t = group[j];
        if (t.dominated) continue;         // don't dominate via a tombstone
        if (dominates(t, s)) {
          s.dominated = true;
          updatedOrNew.delete(s.key);
          marked++;
          break;
        }
      }
    }
  }
  return marked;
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
  useDominance = true, // exposed so benchmarks can A/B it on an identical roster
}) {
  const desiredIndex = buildDesiredIndex(desiredPassiveNames);
  const fullMask = desiredPassiveNames.length >= 4 ? 0b1111 : (1 << desiredPassiveNames.length) - 1;

  // Species pairs with a gender-specific override rule (currently just
  // Katress/Wixen) need special handling: unlike every other pair, the
  // child species DEPENDS on which parent is male vs female, so a
  // gender-agnostic lookup (used for all normal pairs) can't resolve it.
  const specialPairs = new Set(genderRules.map(r => specialPairKey(r.p1, r.p2)));

  const allStates = new Map(); // key -> stateRecord
  const dominancePruned = []; // per-round removal counts, for diagnosing churn
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

    // Only the round that hits maxSteps is genuinely last. If the frontier
    // empties earlier the loop stops too, but that isn't knowable in advance,
    // and guessing wrong here would silently discard states a later round
    // still needed. Treating only the maxSteps round as final is the safe
    // reading: at worst the optimisation just doesn't fire.
    const isFinalRound = round === maxSteps;

    const emitChild = (keyA, keyB, a, b, childSpecies, genderP, reversalSide = null) => {
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
            parentAKey: keyA, parentBKey: keyB, p: successProb, attempts, reversalSide,
            ownedRefs: [],
          });
          // A strictly cheaper route may lift it back out of domination, so
          // let the next pruneDominated pass re-judge it from scratch.
          updatedOrNew.add(childKey);
        }
      }
    };

    const considerPair = (keyA, keyB) => {
      const a = allStates.get(keyA), b = allStates.get(keyB);
      if (!a || !b) return;
      // Tombstoned by pruneDominated: some other state does everything this
      // one does at no greater cost, so expanding it can only duplicate work.
      if (a.dominated || b.dominated) return;

      // keyA === keyB means "breed this state with itself" -- fine for a
      // bred/'ANY' state (re-hatching is unlimited by assumption), but for an
      // OWNED state it's only real if there are 2+ actual individuals in
      // that bucket. Without this guard, the reversalSide logic below reads
      // a single owned Pal as its own same-gender opposite and "reverses"
      // it against itself, offering a route that needs just one physical
      // Pal to fill both breeding slots -- not possible even with a Pal
      // Reverser, which only flips a gender, not a Pal into a duplicate.
      if (keyA === keyB && a.origin === 'owned' && a.ownedRefs.length < 2) return;

      // Nothing bred on the final round can be used as a parent afterwards,
      // so the only pairs worth evaluating then are the ones that can produce
      // the goal itself. A child's desired-passive mask is always a subset of
      // its parents' union (outcomeDistribution draws subsets of mask1|mask2,
      // and random additions only ever add junk), so a pair whose union
      // doesn't already cover every desired passive cannot possibly finish.
      if (isFinalRound && (a.mask | b.mask) !== fullMask) return;

      if (!specialPairs.has(specialPairKey(a.species, b.species))) {
        // The overwhelming majority of pairs: child species doesn't depend
        // on gender, so a gender-agnostic lookup is always valid, and
        // pairGenderInfo alone captures the full gender cost/feasibility
        // (including whether a Pal Reverser is needed on one side).
        const childSpecies = childOf(a.species, null, b.species, null);
        if (childSpecies === null) return;
        if (isFinalRound && childSpecies !== targetSpeciesIdx) return;
        const { p: genderP, reversalSide } = pairGenderInfo(a, b, maleProbOf);
        if (genderP <= 0) return;
        emitChild(keyA, keyB, a, b, childSpecies, genderP, reversalSide);
        return;
      }

      // Special-cased pair: the result depends on which parent is male vs
      // female, so every feasible concrete gender assignment must be tried
      // individually (a flexible 'ANY' state can't be queried with a null
      // gender here -- that loses the rule match entirely). Reversal isn't
      // offered here -- this only ever matters for Katress/Wixen, and the
      // extra same-gender-fixed branch it would need is not worth the
      // complexity for one pair.
      for (const asg of feasibleGenderAssignments(a, b, maleProbOf)) {
        const childSpecies = childOf(a.species, asg.aGender, b.species, asg.bGender);
        if (childSpecies === null) continue;
        if (isFinalRound && childSpecies !== targetSpeciesIdx) continue;
        emitChild(keyA, keyB, a, b, childSpecies, asg.p);
      }
    };

    for (let i = 0; i < newKeys.length; i++) {
      for (let j = i; j < newKeys.length; j++) considerPair(newKeys[i], newKeys[j]);
      for (let j = 0; j < oldKeys.length; j++) considerPair(newKeys[i], oldKeys[j]);
    }

    // Lossless pass first: drop states some other state strictly beats. This
    // runs before the beam so the beam's budget is spent on states that are
    // actually distinct, rather than on near-duplicates that differ only by
    // carrying extra junk at higher cost.
    if (useDominance) dominancePruned.push(pruneDominated(allStates, updatedOrNew));

    // Beam prune: keep all owned leaves (effort 0, always useful), cap bred
    // states to the configured beam width. Unlike the pass above this IS
    // lossy -- it can discard a state that was on the only cheap route.
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
    // Count live states only: tombstones aren't expanded, so letting them
    // trip the beam would prune real candidates to make room for nothing.
    let liveCount = 0;
    for (const s of allStates.values()) if (!s.dominated) liveCount++;

    if (liveCount > beamWidth) {
      // Tombstoned states are never expanded, so they cost only memory and
      // shouldn't eat the beam's budget or be considered for eviction (which
      // would just let emitChild recreate them).
      const bred = Array.from(allStates.values()).filter(s => s.origin === 'bred' && !s.dominated);
      const ownedCount = Array.from(allStates.values()).filter(s => s.origin === 'owned').length;
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

      protectAncestors(keep, allStates);

      for (const s of bred) {
        if (!keep.has(s.key)) {
          allStates.delete(s.key);
          updatedOrNew.delete(s.key);
        }
      }
    }

    frontierNew = Array.from(updatedOrNew);
    if (onProgress) onProgress(round, liveCount);
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
    // Live states only. Tombstones are an internal bookkeeping detail, and
    // counting them would inflate the "candidate Pals" figure shown in the UI.
    stateCount: Array.from(allStates.values()).filter(s => !s.dominated).length,
    dominancePruned,
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
  const a = reconstructRoute(allStates.get(state.parentAKey), allStates);
  const b = reconstructRoute(allStates.get(state.parentBKey), allStates);
  // reversalSide only ever points at a fixed-gender (owned) parent -- bred
  // intermediates are always genderTag 'ANY' and never need a Pal Reverser.
  if (state.reversalSide === 'A') a.needsReversal = true;
  else if (state.reversalSide === 'B') b.needsReversal = true;
  return {
    type: 'bred', species: state.species, mask: state.mask, junk: state.junk,
    effort: state.effort, depth: state.depth, p: state.p, attempts: state.attempts,
    parentA: a,
    parentB: b,
  };
}

export { pairGenderInfo, feasibleGenderAssignments, specialPairKey, dominates };
