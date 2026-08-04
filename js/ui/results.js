// Breeding-routes output, rendered directly below the Target Pal Child
// section on the same page. Runs the solver in a Web Worker so the beam
// search never blocks the UI thread, shows live progress, and renders each
// result as an expandable breeding tree down to owned-roster leaves.

import { getPals, getMeta, palByInternal } from '../data.js';
import * as store from '../store.js';
import { renderPalIcon, attachTooltip } from './shared.js';

let worker = null;
let statusEl, cancelBtn, listEl;
let currentRequest = null;

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker('js/worker.js', { type: 'module' });
  worker.addEventListener('message', handleWorkerMessage);
  worker.addEventListener('error', (e) => {
    statusEl.textContent = 'Worker error: ' + e.message;
    cancelBtn.hidden = true;
  });
  return worker;
}

export function initResultsTab(container) {
  container.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'card';
  statusEl = document.createElement('div');
  statusEl.className = 'results-status';
  statusEl.textContent = 'Pick a target Pal above, then click "Find Breeding Routes".';
  header.appendChild(statusEl);
  cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = 'Cancel Search';
  cancelBtn.hidden = true;
  cancelBtn.addEventListener('click', () => { if (worker) worker.postMessage({ type: 'cancel' }); });
  header.appendChild(cancelBtn);
  container.appendChild(header);

  listEl = document.createElement('div');
  listEl.className = 'results-list';
  container.appendChild(listEl);
}

function handleWorkerMessage(ev) {
  const msg = ev.data;
  if (msg.type === 'progress') {
    statusEl.textContent = `Searching... generation ${msg.round}, ${msg.size.toLocaleString()} candidate Pals so far.`;
  } else if (msg.type === 'result') {
    cancelBtn.hidden = true;
    renderResults(msg.result, currentRequest);
  } else if (msg.type === 'cancelled') {
    cancelBtn.hidden = true;
    statusEl.textContent = 'Search cancelled.';
  } else if (msg.type === 'error') {
    cancelBtn.hidden = true;
    statusEl.textContent = 'Error: ' + msg.message;
  }
}

export function runSearch({ targetSpecies, desiredPassives }) {
  currentRequest = { targetSpecies, desiredPassives };
  ensureWorker();
  const settings = store.getSettings();
  const roster = store.getRoster()
    .map(p => {
      const species = palByInternal(p.speciesInternal);
      return species ? { speciesIdx: species.i, gender: p.gender, passiveInternalNames: p.passiveInternalNames } : null;
    })
    .filter(Boolean);

  const maleProbBySpecies = getPals().map(p => p.maleProb);

  statusEl.textContent = 'Starting search...';
  cancelBtn.hidden = false;
  listEl.innerHTML = '';

  worker.postMessage({
    type: 'run',
    payload: {
      ownedPals: roster,
      targetSpeciesIdx: targetSpecies.i,
      desiredPassiveNames: desiredPassives.map(p => p.internalName),
      maleProbBySpecies,
      genderRules: getMeta().genderSpecificRules,
      beamWidth: settings.beamWidth,
      maxSteps: settings.maxSteps,
      timePerBreed: settings.timePerBreed,
      maxResults: settings.maxResults,
    },
  });
}

function formatEffort(minutes) {
  if (!isFinite(minutes)) return 'unknown';
  if (minutes < 60) return `~${minutes.toFixed(0)} min`;
  const hrs = minutes / 60;
  if (hrs < 48) return `~${hrs.toFixed(1)} hr`;
  return `~${(hrs / 24).toFixed(1)} days`;
}

function renderResults(result, request) {
  listEl.innerHTML = '';
  statusEl.textContent = result.results.length > 0
    ? `Found ${result.results.length} route(s) after searching ${result.rounds} generation(s) and ${result.stateCount.toLocaleString()} candidate Pals.`
    : `No route found within the configured search limits (${result.rounds} generation(s), ${result.stateCount.toLocaleString()} candidates explored). Try raising "Max breeding generations" or "Beam width" in Settings.`;

  result.results.forEach((route, idx) => {
    const card = document.createElement('div');
    card.className = 'card result-card';
    const heading = document.createElement('h4');
    const genLabel = `${route.depth} generation${route.depth === 1 ? '' : 's'}`;
    heading.textContent = `Route ${idx + 1} — ${genLabel}, est. ${formatEffort(route.effort)}`;
    card.appendChild(heading);
    const scrollWrap = document.createElement('div');
    scrollWrap.className = 'route-tree-scroll';
    scrollWrap.appendChild(renderRouteNode(route, request.desiredPassives));
    card.appendChild(scrollWrap);
    listEl.appendChild(card);
  });
}

/**
 * Renders a breeding tree node. The direct parents of the final target
 * (depth 0) sit side by side, matching how a single breeding pair reads
 * left-to-right. Every generation below that (depth > 0) is drawn as a
 * vertical block instead: the two parents stacked, then an "=" restating
 * the child they produce -- since at depth > 0 that child isn't already the
 * card's own heading, unlike depth 0. This also sidesteps the
 * horizontal-space problem a purely side-by-side layout runs into a couple
 * of generations deep (each nested pair only has half its parent's width to
 * work with, so it used to wrap awkwardly); going vertical instead just
 * makes the page taller, which scales fine to 4+ generations.
 */
function renderRouteNode(node, desiredPassives, depth = 0) {
  const wrap = document.createElement('div');
  wrap.className = 'route-node ' + node.type;
  wrap.appendChild(renderNodeHeader(node, desiredPassives));

  if (node.type === 'owned') {
    const tag = document.createElement('div');
    tag.className = 'route-node-tag';
    tag.textContent = 'From your roster' + (node.genderTag === 'M' ? ' (♂)' : node.genderTag === 'F' ? ' (♀)' : '');
    if (node.needsReversal) {
      const note = document.createElement('span');
      note.className = 'reverser-note';
      note.textContent = ' -- needs Pal Reverser to flip gender for this pairing';
      tag.appendChild(note);
    }
    wrap.appendChild(tag);
    return wrap;
  }

  const info = document.createElement('div');
  info.className = 'route-node-tag';
  const pct = node.p * 100;
  const pctStr = pct >= 0.1 ? pct.toFixed(1) : pct.toExponential(1);
  info.textContent = `Breed together — ${pctStr}% chance per egg, ~${node.attempts.toFixed(1)} eggs expected`;
  wrap.appendChild(info);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'route-toggle';
  toggle.textContent = 'Hide parents ▾';

  // Whichever parent is itself a bred (multi-generation) result comes
  // first -- consistently left (depth 0) or on top (nested/vertical) -- so
  // the deepest lineage reads as one consistent edge instead of jumping
  // sides at random between generations.
  const [first, second] = orderOperands(node);

  const pair = document.createElement('div');
  pair.className = depth === 0 ? 'route-pair route-pair-horizontal' : 'route-pair route-pair-vertical';
  pair.appendChild(renderRouteNode(first, desiredPassives, depth + 1));
  pair.appendChild(renderRouteNode(second, desiredPassives, depth + 1));

  const collapsible = document.createElement('div');
  collapsible.className = 'route-collapsible';
  collapsible.appendChild(pair);

  if (depth > 0) {
    const equalsRow = document.createElement('div');
    equalsRow.className = 'route-equals-row';
    const equals = document.createElement('span');
    equals.className = 'route-equals';
    equals.textContent = '=';
    equalsRow.appendChild(equals);
    equalsRow.appendChild(renderCompactNode(node));
    collapsible.appendChild(equalsRow);
  }

  toggle.addEventListener('click', () => {
    const hidden = collapsible.hidden = !collapsible.hidden;
    toggle.textContent = hidden ? 'Show parents ▸' : 'Hide parents ▾';
  });
  wrap.appendChild(toggle);
  wrap.appendChild(collapsible);

  return wrap;
}

function renderNodeHeader(node, desiredPassives) {
  const species = getPals()[node.species];
  const header = document.createElement('div');
  header.className = 'route-node-header';
  if (node.needsReversal) header.appendChild(renderReverserBadge());
  header.appendChild(renderPalIcon(species, 28));
  const label = document.createElement('span');
  label.className = 'route-node-label';
  label.textContent = species ? species.name : `#${node.species}`;
  header.appendChild(label);

  for (let b = 0; b < desiredPassives.length; b++) {
    const has = (node.mask & (1 << b)) !== 0;
    const badge = document.createElement('span');
    badge.className = 'mask-badge ' + (has ? 'has' : 'missing');
    badge.textContent = desiredPassives[b].name;
    attachTooltip(badge, desiredPassives[b].description);
    header.appendChild(badge);
  }
  if (node.junk > 0) {
    const junkBadge = document.createElement('span');
    junkBadge.className = 'mask-badge junk';
    junkBadge.textContent = `+${node.junk} other`;
    attachTooltip(junkBadge, 'Other passives this Pal carries that aren\'t part of your desired set (specific ones aren\'t tracked, just the count).');
    header.appendChild(junkBadge);
  }
  return header;
}

/**
 * Small badge shown to the left of an owned Pal's icon when this specific
 * pairing only works by using a Pal Reverser (the in-game item that flips a
 * Pal's gender) on it -- e.g. you own two males of a species and need to
 * flip one to female to breed them together.
 */
function renderReverserBadge() {
  const badge = document.createElement('span');
  badge.className = 'reverser-badge';
  badge.textContent = '⇄';
  attachTooltip(badge, 'Needs a Pal Reverser: this Pal must have its gender flipped before it can be paired this way.');
  return badge;
}

/** Compact icon+name summary used to restate a node's result after its "=". */
function renderCompactNode(node) {
  const species = getPals()[node.species];
  const el = document.createElement('span');
  el.className = 'route-compact-node';
  el.appendChild(renderPalIcon(species, 20));
  const label = document.createElement('span');
  label.className = 'route-node-label';
  label.textContent = species ? species.name : `#${node.species}`;
  el.appendChild(label);
  return el;
}

/** Puts the bred/multi-generation parent first when only one parent is bred. */
function orderOperands(node) {
  const { parentA: a, parentB: b } = node;
  if (a.type === 'bred' && b.type === 'owned') return [a, b];
  if (b.type === 'bred' && a.type === 'owned') return [b, a];
  return [a, b];
}
