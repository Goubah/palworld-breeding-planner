// localStorage persistence for the owned-Pal roster and solver settings.
// No backend -- everything lives in the browser, exportable/importable as
// plain JSON so a roster survives a browser wipe or moves between devices.
//
// Roster entries store the Pal's `speciesInternal` name (stable across data
// regenerations), never a numeric species index -- indices are only ever
// resolved fresh via data.js at the point of use.

const STORAGE_KEY = 'palworld-breeding-planner:v1';

const DEFAULT_SETTINGS = {
  maxSteps: 6, // matches the Advanced Settings ceiling -- see settings.js
  timePerBreed: 5, // minutes per breeding attempt (egg + incubation)
  beamWidth: 1000, // see the comment on solver.js's DEFAULTS for the benchmark behind this number
  maxResults: 5,
};

function defaultState() {
  return { roster: [], settings: { ...DEFAULT_SETTINGS } };
}

/**
 * Structurally normalizes one roster entry so every field the rest of the
 * app relies on (gender is one of two values, passiveInternalNames is
 * always an array of at most 4 unique strings) is guaranteed true no matter
 * where the data came from -- a hand-edited export, an older/different
 * version of this app, or plain corruption. This is deliberately the ONLY
 * validation done here: it can't check that speciesInternal or a passive
 * name is a REAL one, since that requires the game data this module has no
 * access to (store.js loads before data.js finishes fetching). That check
 * happens at import time in roster.js instead, where data.js is available
 * and the user can be told what got skipped and why. This layer exists so
 * that even if that earlier check is ever bypassed, malformed data can
 * never reach rendering code and crash it -- it gets a safe default field
 * instead, never a missing one.
 *
 * Returns null (drop the entry) only when speciesInternal itself isn't a
 * usable string, since there's no sane default for "which Pal is this".
 */
function sanitizePal(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.speciesInternal !== 'string' || !raw.speciesInternal) return null;
  const gender = raw.gender === 'FEMALE' ? 'FEMALE' : 'MALE';
  const rawPassives = Array.isArray(raw.passiveInternalNames) ? raw.passiveInternalNames : [];
  const passiveInternalNames = Array.from(new Set(rawPassives.filter(p => typeof p === 'string'))).slice(0, 4);
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : makeId(),
    speciesInternal: raw.speciesInternal,
    gender,
    passiveInternalNames,
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const roster = Array.isArray(parsed.roster) ? parsed.roster.map(sanitizePal).filter(Boolean) : [];
    return {
      roster,
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
    };
  } catch (e) {
    console.warn('Failed to load saved data, starting fresh:', e);
    return defaultState();
  }
}

let _state = load();
const _listeners = new Set();

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
  for (const fn of _listeners) fn(_state);
}

export function getRoster() { return _state.roster; }
export function getSettings() { return _state.settings; }

export function addPal(pal) {
  const clean = sanitizePal(pal);
  if (!clean) return;
  _state.roster.push(clean);
  save();
}

export function updatePal(id, updates) {
  const idx = _state.roster.findIndex(p => p.id === id);
  if (idx === -1) return;
  const clean = sanitizePal({ ..._state.roster[idx], ...updates, id });
  if (!clean) return;
  _state.roster[idx] = clean;
  save();
}

export function duplicatePal(id) {
  const p = _state.roster.find(p => p.id === id);
  if (!p) return;
  _state.roster.push({ ...p, id: makeId() });
  save();
}

export function removePal(id) {
  _state.roster = _state.roster.filter(p => p.id !== id);
  save();
}

export function updateSettings(updates) {
  _state.settings = { ..._state.settings, ...updates };
  save();
}

export function exportData() {
  return JSON.stringify(_state, null, 2);
}

export function importData(json) {
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Not a valid roster export (expected a JSON object, not an array or primitive).');
  }
  _state = {
    roster: Array.isArray(parsed.roster) ? parsed.roster.map(sanitizePal).filter(Boolean) : [],
    settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
  };
  save();
}

export function subscribe(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function makeId() {
  return 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
