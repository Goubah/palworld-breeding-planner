// Species-lookup breeding logic.
//
// Palworld's child-species result is NOT a clean formula: the documented
// CombiRank averaging rule (floor((rankA+rankB+1)/2) -> nearest species) was
// checked against the real, exhaustive parent-pair table and only reproduced
// ~67% of results even with the best tie-break variant tried. Some species
// are excluded from generic outcomes and ~150 pairs are hard overrides, so
// this module is backed entirely by the precomputed table in data/breeding.bin
// (itself generated from PalCalc's exhaustive breeding.json).
//
// One gender-specific override exists in the whole dataset and can't be
// expressed in the gender-agnostic table, so it's checked first:
//   Cattiva (CatMage) FEMALE + Mistica (FoxMage) MALE -> Cattiva Ignis (CatMage_Fire)
//   Cattiva (CatMage) MALE + Mistica (FoxMage) FEMALE -> Mistica Noct (FoxMage_Dark)

let _table = null;   // Uint16Array, one child species index per canonical pair
let _n = 0;
let _genderRules = []; // [{p1,g1,p2,g2,child}, ...] species indices + 'MALE'|'FEMALE'
let _selfBredOnlySpecies = null; // Set<number>, lazily computed and cached -- see isSelfBredOnly

export const UNSET = 0xffff;

export function pairIndex(i, j, n) {
  if (i > j) { const t = i; i = j; j = t; }
  return i * n - (i * (i - 1)) / 2 + (j - i);
}

/**
 * Wire up the breeding table. `breedingBinBuffer` is the raw ArrayBuffer of
 * data/breeding.bin (a Uint16Array of size N*(N+1)/2 under the canonical
 * pairIndex ordering). `speciesCount` is N. `genderRules` come from
 * data/meta.json's genderSpecificRules.
 */
export function initBreeding(breedingBinBuffer, speciesCount, genderRules) {
  _table = new Uint16Array(breedingBinBuffer);
  _n = speciesCount;
  _genderRules = genderRules || [];
  _selfBredOnlySpecies = null;
}

export function isInitialized() {
  return _table !== null;
}

/**
 * Look up the child species index for a pair of parent species indices.
 * Genders are 'MALE' | 'FEMALE' | null|undefined (unknown/don't-care).
 * Gender is only consulted for the one documented override rule; every other
 * pair is resolved purely from species regardless of gender.
 *
 * Returns the child species index, or null if the table has no entry
 * (shouldn't happen in practice -- every one of the 44,850 canonical pairs
 * in the shipped data is populated).
 */
export function childOf(aIdx, aGender, bIdx, bGender) {
  if (_table === null) throw new Error('breeding table not initialized -- call initBreeding() first');

  for (const rule of _genderRules) {
    const forward = rule.p1 === aIdx && rule.p2 === bIdx && rule.g1 === aGender && rule.g2 === bGender;
    const reverse = rule.p1 === bIdx && rule.p2 === aIdx && rule.g1 === bGender && rule.g2 === aGender;
    if (forward || reverse) return rule.child;
  }

  const idx = pairIndex(aIdx, bIdx, _n);
  const child = _table[idx];
  return child === UNSET ? null : child;
}

export function speciesCount() {
  return _n;
}

/**
 * True when EVERY pair that produces `speciesIdx` -- across both the table
 * and the gender-override rules -- is that species paired with itself. E.g.
 * Frostallion's only entry in the whole table is Frostallion + Frostallion,
 * so a player who owns exactly one can never breed a second: no other parent
 * pair reaches it. Checked against the real data (2026-08-09): 26 of 299
 * species qualify, mostly legendaries and raid bosses. (The raw table alone
 * says 28 -- Katress Ignis and Wixen Noct drop out once the gender-override
 * rules are folded in, since each has a second producing pair, Katress x
 * Wixen, that the gender-agnostic table has no row for.)
 *
 * Says nothing about a specific player's roster -- a player who owns two of
 * such a species genuinely can breed a third by pairing those two. That
 * check belongs where the roster is known (js/ui/route-views.js).
 *
 * Computed once from data/breeding.bin, the same table `childOf` reads, and
 * cached, since the result depends only on the loaded game data.
 */
export function isSelfBredOnly(speciesIdx) {
  if (_table === null) throw new Error('breeding table not initialized -- call initBreeding() first');
  if (_selfBredOnlySpecies === null) _selfBredOnlySpecies = computeSelfBredOnlySpecies();
  return _selfBredOnlySpecies.has(speciesIdx);
}

function computeSelfBredOnlySpecies() {
  const producedAtAll = new Set();
  const producedByOther = new Set();

  for (let i = 0; i < _n; i++) {
    for (let j = i; j < _n; j++) {
      const child = _table[pairIndex(i, j, _n)];
      if (child === UNSET) continue;
      producedAtAll.add(child);
      if (!(i === j && i === child)) producedByOther.add(child);
    }
  }
  for (const rule of _genderRules) {
    producedAtAll.add(rule.child);
    if (!(rule.p1 === rule.child && rule.p2 === rule.child)) producedByOther.add(rule.child);
  }

  const result = new Set();
  for (const idx of producedAtAll) {
    if (!producedByOther.has(idx)) result.add(idx);
  }
  return result;
}
