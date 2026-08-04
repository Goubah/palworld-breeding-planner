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
