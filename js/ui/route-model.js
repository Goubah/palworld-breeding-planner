// Pure analysis of a solver route tree: no DOM, no game data lookups. The two
// route views (js/ui/route-views.js) share every structural decision from
// here, and tests.html exercises this module directly. The renderers only
// turn what comes back into elements.

/**
 * Drops Reverser routes that an item-free route already beats outright.
 *
 * The solver keeps Reverser and Reverser-free routes as separate results on
 * purpose -- `dominates` in solver.js refuses to let one collapse the other
 * mid-search, so the best of each kind survives to be compared as a finished
 * plan. That split only has value when the item buys something. A route that
 * needs a Pal Reverser AND takes no fewer generations AND costs no less time
 * is strictly worse: there is no reading of the trade-off under which a player
 * picks it, so it is scrolling with no choice at the end of it.
 *
 * Pareto dominance on (depth, effort), not a threshold on the effort gap. The
 * obvious-looking rule -- hide it when the two routes differ by less than the
 * 2.5 min Reverser penalty -- does not work, because the penalty does not
 * arrive at the root as 2.5. Gender setup is a function of a branch's own
 * effort, so a penalty deep in the tree is re-charged at every level above it.
 * Measured on the 252-Pal roster, Frostallion Noct (Eternal Engine, Nimble,
 * Swift, Runner): 2.5 at the leaf becomes 5.0 one level up and 10.0 at the
 * root. Across 9 searches that returned a Reverser route, the threshold rule
 * caught 0 of the 7 junk ones; this one catches all 7.
 *
 * Comparing finished efforts also keeps the routes worth keeping. Lyleen Noct
 * (same passives) has a Reverser route 592 min CHEAPER than its item-free
 * sibling, and Katress Ignis has no item-free route at all. Both survive here.
 *
 * The item-free route is never dropped, even when a Reverser route beats it on
 * both axes. Needing no item is a real advantage the effort number does not
 * carry, so it always has a reason to be on screen.
 */
export function suppressRedundantReverserRoutes(routes) {
  const free = routes.filter(r => !r.usesReverser);
  return routes.filter(r => !isRedundantReverserRoute(r, free));
}

/**
 * The complement of the above: exactly the routes it drops.
 *
 * The UI says how many were hidden and offers to show them, so nothing
 * disappears without the reader being told. Both functions run the same
 * predicate over the same `free` set, so they partition the input by
 * construction and cannot drift into disagreeing about a route.
 */
export function redundantReverserRoutes(routes) {
  const free = routes.filter(r => !r.usesReverser);
  return routes.filter(r => isRedundantReverserRoute(r, free));
}

/** True when `route` needs a Reverser and some item-free route already matches
 *  or beats it on both generations and effort. `free` is the item-free subset
 *  of the same result list. */
function isRedundantReverserRoute(route, free) {
  return route.usesReverser
    && free.some(f => f.depth <= route.depth && f.effort <= route.effort);
}

/**
 * Puts the routes needing no Pal Reverser first, keeping the solver's
 * generations-then-effort ranking within each group.
 *
 * Most players would rather not farm the item, so the plan they are most
 * likely to run should not be the one they have to scroll past a whole family
 * tree to reach. Once a dominated Reverser route is gone (above), any that
 * survives is genuinely faster or shallower -- which means it would otherwise
 * take the top slot every time it appears, and the common preference would
 * always be second.
 *
 * A partition, not a sort comparator: it cannot perturb the order inside
 * either group no matter how the engine implements sorting, and the group a
 * route lands in does not depend on any other route.
 *
 * This does mean route 1 is no longer always the cheapest, so the estimate
 * stays on every card. A Reverser route that saves ten hours is still worth
 * taking, and the reader has to be able to see that it does.
 */
export function itemFreeRoutesFirst(routes) {
  return [
    ...routes.filter(r => !r.usesReverser),
    ...routes.filter(r => r.usesReverser),
  ];
}

/**
 * Identity of an owned leaf as the SOLVER sees it: species, which desired
 * passives it carries, how much junk, and its gender. Two leaves sharing this
 * key came from the same bucket of interchangeable roster Pals.
 *
 * Deliberately not the roster entry's id. The solver collapses same-species,
 * same-mask, same-junk, same-gender Pals into one state precisely because
 * they are interchangeable for breeding purposes (junk *identity* never
 * enters the probability model, only the count), so this is the right grain
 * for asking "is this the same Pal twice".
 */
export function leafStateKey(node) {
  return `${node.species},${node.mask},${node.junk},${node.genderTag}`;
}

/** Every owned leaf in the tree, in left-to-right display order. */
export function collectOwnedLeaves(root) {
  const leaves = [];
  (function walk(n) {
    if (n.type === 'owned') leaves.push(n);
    else { walk(n.parentA); walk(n.parentB); }
  })(root);
  return leaves;
}

/**
 * How many times each owned leaf-state is used across the route.
 *
 * Breeding never consumes a parent, so a Pal appearing in several pairings is
 * ONE Pal used repeatedly, not several copies. Without this the tree reads as
 * though you need N of something you may only ever be able to own one of --
 * on the Frostallion Noct route the single owned Frostallion appears three
 * times, and Frostallion can only be bred from two Frostallions, so a player
 * reading it as "you need three" would abandon a route they can actually run.
 *
 * Returns Map<leafStateKey, count>.
 */
export function countOwnedUses(root) {
  const counts = new Map();
  for (const leaf of collectOwnedLeaves(root)) {
    const key = leafStateKey(leaf);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/**
 * Flatten the tree into an executable build order.
 *
 * Post-order, so a step's parents are always already done by the time it is
 * reached. Each entry records which earlier step (if any) produced each
 * parent, letting the list say "the Helzephyr from step 1" instead of
 * restating a whole subtree inline.
 *
 * Returns [{ node, stepNumber, aStep, bStep }] with 1-based step numbers;
 * aStep/bStep are a step number or null when that parent is an owned Pal.
 */
export function flattenSteps(root) {
  const steps = [];
  (function walk(n) {
    if (n.type === 'owned') return null;
    const aStep = walk(n.parentA);
    const bStep = walk(n.parentB);
    steps.push({ node: n, aStep, bStep, stepNumber: steps.length + 1 });
    return steps.length;
  })(root);
  return steps;
}

/**
 * Sorts a Pal's passives so the desired ones come first.
 *
 * A tree node has room for about two names before it truncates, and the ones
 * worth keeping are the ones that tell you which of your Pals to grab.
 * Stable within each group, so a Pal's own ordering is otherwise preserved.
 */
export function desiredFirst(passiveInternalNames, desiredInternalNames) {
  const desired = new Set(desiredInternalNames);
  return passiveInternalNames
    .map((name, i) => ({ name, i }))
    .sort((a, b) => (desired.has(a.name) ? 0 : 1) - (desired.has(b.name) ? 0 : 1) || a.i - b.i)
    .map(x => x.name);
}

/**
 * Geometry for the left-to-right family tree, in abstract row/column units
 * (the renderer multiplies by pixel constants).
 *
 * Column is distance from the ROOT, so every parent sits exactly one column
 * left of its child. The obvious alternative -- pinning all owned Pals to
 * column 0 so "everything you own" reads as one column -- makes a leaf that
 * feeds a deep node span several columns, and those long connectors cross
 * unrelated nodes. Short uniform connectors are worth more than that
 * alignment: it is what keeps an 11-leaf tree legible.
 *
 * Leaves take consecutive rows in display order; an internal node sits at the
 * midpoint of its two parents, which is what makes the connectors read as a
 * pedigree rather than a flowchart.
 *
 * Returns { nodes, columns, rows, root } where each node is
 * { node, col, row, kids } and `rows` is the leaf count.
 */
export function layoutTree(root) {
  let maxDistance = 0;
  (function measure(n, distance) {
    if (distance > maxDistance) maxDistance = distance;
    if (n.type === 'bred') { measure(n.parentA, distance + 1); measure(n.parentB, distance + 1); }
  })(root, 0);

  const nodes = [];
  let nextLeafRow = 0;
  const placed = (function place(n, distance) {
    const rec = { node: n, col: maxDistance - distance, row: 0, kids: [] };
    if (n.type === 'owned') {
      rec.row = nextLeafRow++;
    } else {
      const a = place(n.parentA, distance + 1);
      const b = place(n.parentB, distance + 1);
      rec.kids = [a, b];
      rec.row = (a.row + b.row) / 2;
    }
    nodes.push(rec);
    return rec;
  })(root, 0);

  return { nodes, columns: maxDistance + 1, rows: nextLeafRow, root: placed };
}
