// Breeding-routes output, rendered directly below the Target Pal Child
// section on the same page. Runs the solver in a Web Worker so the beam
// search never blocks the UI thread, shows live progress, and renders each
// result either as a family tree or as a numbered list of breeding steps
// (see js/ui/route-views.js for why there are two).

import { getPals, getMeta, palByInternal } from '../data.js';
import * as store from '../store.js';
import { attachTooltip, plural } from './shared.js';
import { renderRouteSteps, renderRouteTree } from './route-views.js';

let worker = null;
let statusEl, cancelBtn, listEl, viewToggle;
let currentRequest = null;
let lastResult = null, lastMeta = null;

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

  // Standing explanation of what the search returns. The solver produces at
  // most two results, split by whether the plan needs a Pal Reverser, so say
  // that plainly rather than leaving people to wonder why a list of five
  // never appears.
  const scopeEl = document.createElement('p');
  scopeEl.className = 'results-scope muted';
  scopeEl.textContent = 'The search returns the fastest routes it can find, including one that needs a Pal Reverser and one that does not, where both exist. All of them use only the Pals in your roster.';
  header.appendChild(scopeEl);

  viewToggle = createViewToggle();
  viewToggle.el.hidden = true;
  header.appendChild(viewToggle.el);

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

/**
 * Switches between the two route views. The choice persists like every other
 * setting -- it's a reading preference, not a per-search decision, and having
 * it reset on reload would be a small irritation every time.
 */
function createViewToggle() {
  const wrap = document.createElement('div');
  wrap.className = 'route-view-toggle';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'How to display each route');

  const label = document.createElement('span');
  label.className = 'route-view-label';
  label.textContent = 'Show as';
  wrap.appendChild(label);

  const buttons = [];
  const options = [
    ['tree', 'Family tree', 'The whole plan at once, your own Pals on the left and the target on the right.'],
    ['steps', 'Steps', 'One breeding pair per line, in the order you would actually do them.'],
  ];
  for (const [value, text, hint] of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary route-view-btn';
    btn.textContent = text;
    attachTooltip(btn, hint);
    btn.addEventListener('click', () => {
      if (store.getSettings().routeView === value) return;
      store.updateSettings({ routeView: value });
      sync();
      if (lastResult) renderResults(lastResult, currentRequest, lastMeta);
    });
    buttons.push([value, btn]);
    wrap.appendChild(btn);
  }

  function sync() {
    const current = store.getSettings().routeView;
    for (const [value, btn] of buttons) {
      const on = value === current;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }
  sync();
  return { el: wrap, sync };
}

function handleWorkerMessage(ev) {
  const msg = ev.data;
  if (msg.type === 'attempt') {
    // Only mentioned from the second attempt on. Announcing "attempt 1 of 4"
    // up front would imply three more are coming, when most searches finish
    // on the first and never widen at all.
    if (msg.attempt > 1) {
      statusEl.textContent = `No route at that search width. Widening to ${msg.beamWidth.toLocaleString()} and trying again (attempt ${msg.attempt} of ${msg.maxAttempts})...`;
    }
  } else if (msg.type === 'progress') {
    const widening = msg.attempt > 1 ? ` at search width ${msg.beamWidth.toLocaleString()}` : '';
    statusEl.textContent = `Searching${widening}... generation ${msg.round}, ${msg.size.toLocaleString()} candidate Pals so far.`;
  } else if (msg.type === 'result') {
    cancelBtn.hidden = true;
    renderResults(msg.result, currentRequest, msg);
  } else if (msg.type === 'cancelled') {
    cancelBtn.hidden = true;
    statusEl.textContent = 'Search cancelled.';
  } else if (msg.type === 'error') {
    cancelBtn.hidden = true;
    statusEl.textContent = 'Error: ' + msg.message;
  }
}

export function runSearch({ targetSpecies, desiredPassives }) {
  ensureWorker();
  const settings = store.getSettings();

  // ownedPals and ownedEntries are built in ONE pass so their indices cannot
  // drift apart. This matters: a route's owned leaves identify themselves by
  // `ownedRefs`, which are positions in the ownedPals array the solver was
  // given -- NOT positions in store.getRoster(). Rebuilding the display list
  // separately (map + filter over the roster again) would silently shift
  // every index after any entry whose species failed to resolve, and the
  // route views would then name the wrong Pal with total confidence.
  const ownedPals = [], ownedEntries = [];
  for (const entry of store.getRoster()) {
    const species = palByInternal(entry.speciesInternal);
    if (!species) continue;
    ownedPals.push({
      speciesIdx: species.i,
      gender: entry.gender,
      passiveInternalNames: entry.passiveInternalNames,
    });
    ownedEntries.push(entry);
  }

  currentRequest = { targetSpecies, desiredPassives, ownedEntries };
  lastResult = null;
  lastMeta = null;

  const maleProbBySpecies = getPals().map(p => p.maleProb);

  statusEl.textContent = 'Starting search...';
  cancelBtn.hidden = false;
  viewToggle.el.hidden = true;
  listEl.innerHTML = '';

  worker.postMessage({
    type: 'run',
    payload: {
      ownedPals,
      targetSpeciesIdx: targetSpecies.i,
      desiredPassiveNames: desiredPassives.map(p => p.internalName),
      maleProbBySpecies,
      genderRules: getMeta().genderSpecificRules,
      beamWidth: settings.beamWidth,
      maxSteps: settings.maxSteps,
      timePerBreed: settings.timePerBreed,
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

function renderResults(result, request, meta = {}) {
  lastResult = result;
  lastMeta = meta;
  listEl.innerHTML = '';

  const widened = meta.attempts > 1
    ? ` The search widened to ${meta.finalBeamWidth.toLocaleString()} to find this.`
    : '';
  statusEl.textContent = result.results.length > 0
    ? `Found ${plural(result.results.length, 'route')} after searching ${plural(result.rounds, 'generation')} and ${plural(result.stateCount, 'candidate Pal')}.${widened}`
    // The search already widened on its own, so telling the reader to raise
    // the beam width would be advice it has taken several times already.
    : `No route found. The search widened to ${plural(meta.finalBeamWidth || 0, 'candidate Pal')} across ${plural(meta.attempts || 1, 'attempt')} without success. Raising "Max breeding generations" in Advanced Settings can help if the target needs more steps; otherwise the passives you want may not be reachable from your current roster.`;

  viewToggle.el.hidden = result.results.length === 0;
  viewToggle.sync();

  const useTree = store.getSettings().routeView !== 'steps';

  result.results.forEach((route, idx) => {
    const card = document.createElement('div');
    card.className = 'card result-card';
    const heading = document.createElement('h4');
    heading.textContent = `Route ${idx + 1} — ${plural(route.depth, 'generation')}, est. ${formatEffort(route.effort)}`;
    card.appendChild(heading);

    // Routes that need a Pal Reverser and routes that don't are kept as
    // separate results, so say which this is up front. The time estimate
    // alone can't carry the decision: farming the item is active play, while
    // the extra eggs an item-free route costs get batched and hatched
    // together, and some players would rather bank a scarce item regardless.
    const reverserTag = document.createElement('div');
    reverserTag.className = 'route-reverser-tag ' + (route.usesReverser ? 'needs' : 'free');
    reverserTag.textContent = route.usesReverser ? '⇄ Uses a Pal Reverser' : 'No Pal Reverser needed';
    card.appendChild(reverserTag);

    const view = { desiredPassives: request.desiredPassives, ownedEntries: request.ownedEntries };
    card.appendChild(useTree ? renderRouteTree(route, view) : renderRouteSteps(route, view));
    listEl.appendChild(card);
  });
}
