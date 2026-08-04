// Passive inheritance probability model.
//
// Matches the game's own weighted-random tables, as extracted from
// PalCalc's db.json (BreedingMechanics.PassiveInheritanceWeights /
// PassiveRandomWeights, generated directly from the game's asset tables).
//
// Verified analytically and in tests.html: for a "clean" pool of k unique
// desired passives (no junk on either parent), P(child gets exactly those k,
// with zero random additions) reproduces the game's published rates:
// k=1 -> 40%, k=2 -> 24%, k=3 -> 12%, k=4 -> 10%. The k=4 case is 10% (not
// 4%) specifically because there is no room left for the random-add step
// once all 4 slots are filled by direct inheritance -- that step is skipped
// entirely rather than rolled and discarded.

export const INHERIT_WEIGHTS = { 1: 4, 2: 3, 3: 2, 4: 1 }; // -> 40/30/20/10 over counts 1..4
export const RANDOM_WEIGHTS = { 0: 4, 1: 3, 2: 2, 3: 1 };   // -> 40/30/20/10 over counts 0..3

const INHERIT_TOTAL = Object.values(INHERIT_WEIGHTS).reduce((a, b) => a + b, 0); // 10
const RANDOM_TOTAL = Object.values(RANDOM_WEIGHTS).reduce((a, b) => a + b, 0);   // 10

export function popcount(x) {
  x = x - ((x >> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  return (((x + (x >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
}

// n choose k, exact for the small values this model ever uses (n <= ~12).
const _chooseCache = new Map();
export function choose(n, k) {
  if (k < 0 || k > n || n < 0) return 0;
  if (k === 0 || k === n) return 1;
  const key = n * 32 + k;
  const cached = _chooseCache.get(key);
  if (cached !== undefined) return cached;
  const kk = Math.min(k, n - k);
  let num = 1, den = 1;
  for (let i = 0; i < kk; i++) {
    num *= (n - i);
    den *= (i + 1);
  }
  const result = Math.round(num / den);
  _chooseCache.set(key, result);
  return result;
}

/**
 * P(g) for the number of passives directly inherited from a combined pool of
 * size n, aggregating the weighted roll X in {1,2,3,4} through g = min(X, n).
 * Returns a Map<g, probability>.
 */
export function inheritCountDistribution(n) {
  const dist = new Map();
  for (let x = 1; x <= 4; x++) {
    const g = Math.min(x, n);
    const p = INHERIT_WEIGHTS[x] / INHERIT_TOTAL;
    dist.set(g, (dist.get(g) || 0) + p);
  }
  return dist;
}

/**
 * P(added) for the random-add step given `room` free slots after direct
 * inheritance. When room <= 0 the step is skipped: single point mass at 0.
 * Returns a Map<added, probability>.
 */
export function randomAddDistribution(room) {
  const dist = new Map();
  if (room <= 0) {
    dist.set(0, 1);
    return dist;
  }
  for (let y = 0; y <= 3; y++) {
    const added = Math.min(y, room);
    const p = RANDOM_WEIGHTS[y] / RANDOM_TOTAL;
    dist.set(added, (dist.get(added) || 0) + p);
  }
  return dist;
}

function enumerateSubsets(bits) {
  const n = bits.length;
  const subsets = [];
  for (let m = 0; m < (1 << n); m++) {
    let S = 0;
    for (let i = 0; i < n; i++) if (m & (1 << i)) S |= (1 << bits[i]);
    subsets.push(S);
  }
  return subsets;
}

/**
 * Compute the outcome distribution for breeding two parents characterized by
 * (mask, junk) pairs. `mask` is a bitmask over up to 4 globally-desired
 * passives (bit i set = parent carries desired passive i); `junk` is a count
 * of the parent's other, non-desired passives.
 *
 * Returns an array of { mask, junk, p } outcomes describing the child's
 * state, with probabilities summing to 1 (entries below 1e-9 are dropped).
 *
 * Modeling notes:
 *  - The combined pool dedupes desired passives (mask1 | mask2) but does NOT
 *    dedupe junk counts (junk1 + junk2) -- junk identity isn't tracked by the
 *    solver, so summing is a deliberate, slightly pessimistic approximation
 *    (it can only ever under-count real inheritance odds, never over-count).
 *  - Randomly-added passives are always treated as junk, never as desired.
 *    This is conservative: several commonly-desired passives (Legend, Lucky)
 *    can NEVER be randomly rolled in the real game, so crediting random adds
 *    as "maybe the desired passive" would overstate a route's true odds.
 */
export function outcomeDistribution(mask1, junk1, mask2, junk2) {
  const desiredPool = mask1 | mask2;
  const d = popcount(desiredPool);
  const j = junk1 + junk2;
  const n = d + j;

  const bits = [];
  for (let b = 0; b < 4; b++) if (desiredPool & (1 << b)) bits.push(b);
  const subsets = enumerateSubsets(bits); // includes S = 0

  const gDist = inheritCountDistribution(n);
  const outcomes = new Map(); // "mask|junk" -> probability

  for (const [g, pg] of gDist) {
    if (pg <= 0) continue;
    const nCg = choose(n, g);
    if (nCg === 0) continue;
    const room = 4 - g;
    const addDist = randomAddDistribution(room);

    for (const S of subsets) {
      const s = popcount(S);
      if (s > g) continue;
      const junkNeeded = g - s;
      if (junkNeeded > j) continue;
      const pSubset = (choose(j, junkNeeded) / nCg) * pg;
      if (pSubset <= 0) continue;

      for (const [added, pAdd] of addDist) {
        const p = pSubset * pAdd;
        if (p <= 1e-9) continue;
        const childJunk = junkNeeded + added;
        const key = S + '|' + childJunk;
        outcomes.set(key, (outcomes.get(key) || 0) + p);
      }
    }
  }

  const result = [];
  let total = 0;
  for (const [key, p] of outcomes) {
    const [maskStr, junkStr] = key.split('|');
    result.push({ mask: Number(maskStr), junk: Number(junkStr), p });
    total += p;
  }
  if (total > 0 && Math.abs(total - 1) > 1e-9) {
    for (const o of result) o.p /= total;
  }
  return result;
}

// Memoized by canonical (order-independent) parent signature -- breeding
// outcome depends only on the combined pool, not on which parent is "first".
const _outcomeCache = new Map();
export function cachedOutcomeDistribution(mask1, junk1, mask2, junk2) {
  let a = [mask1, junk1], b = [mask2, junk2];
  if (a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])) { const t = a; a = b; b = t; }
  const key = a[0] + ',' + a[1] + ',' + b[0] + ',' + b[1];
  let hit = _outcomeCache.get(key);
  if (!hit) {
    hit = outcomeDistribution(a[0], a[1], b[0], b[1]);
    _outcomeCache.set(key, hit);
  }
  return hit;
}

export function clearOutcomeCache() {
  _outcomeCache.clear();
}
