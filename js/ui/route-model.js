// Pure analysis of a solver route tree: no DOM, no game data lookups. The two
// route views (js/ui/route-views.js) share every structural decision from
// here, and tests.html exercises this module directly. The renderers only
// turn what comes back into elements.

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
