// Loads and decodes the static game-data files under data/, and wires the
// breeding table into breeding.js. Must be awaited once at startup before
// any other module (breeding.js, solver.js) is used.

import { initBreeding } from './breeding.js';

let _pals = [];
let _passives = [];
let _meta = null;
let _palsByInternal = new Map();
let _palsByName = new Map();
let _passivesByInternal = new Map();
let _loaded = false;

export async function loadGameData(baseUrl = 'data/') {
  const [palsRes, passivesRes, metaRes, breedingRes] = await Promise.all([
    fetch(baseUrl + 'pals.json'),
    fetch(baseUrl + 'passives.json'),
    fetch(baseUrl + 'meta.json'),
    fetch(baseUrl + 'breeding.bin'),
  ]);

  for (const [name, res] of [['pals.json', palsRes], ['passives.json', passivesRes], ['meta.json', metaRes], ['breeding.bin', breedingRes]]) {
    if (!res.ok) throw new Error(`Failed to load ${baseUrl}${name}: HTTP ${res.status}`);
  }

  _pals = await palsRes.json();
  _passives = await passivesRes.json();
  _meta = await metaRes.json();
  const breedingBuf = await breedingRes.arrayBuffer();

  _palsByInternal = new Map(_pals.map(p => [p.internalName, p]));
  _palsByName = new Map(_pals.map(p => [p.name, p]));
  _passivesByInternal = new Map(_passives.map(p => [p.internalName, p]));

  initBreeding(breedingBuf, _meta.speciesCount, _meta.genderSpecificRules);
  _loaded = true;

  return { pals: _pals, passives: _passives, meta: _meta };
}

export function isLoaded() { return _loaded; }
export function getPals() { return _pals; }
export function getPassives() { return _passives; }
export function getMeta() { return _meta; }
export function palByInternal(internalName) { return _palsByInternal.get(internalName); }
export function palByName(name) { return _palsByName.get(name); }
export function passiveByInternal(internalName) { return _passivesByInternal.get(internalName); }
export function palById(i) { return _pals[i]; }
