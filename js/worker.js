// Web Worker wrapper around solver.js so route-finding never blocks the UI
// thread. This worker loads the breeding table independently (workers don't
// share module state with the main thread's copy of breeding.js), then
// listens for {type:'run', payload} messages and streams back
// {type:'progress'|'result'|'error'|'cancelled'}.

import { initBreeding } from './breeding.js';
import { runSolver } from './solver.js';

class CancelledError extends Error {}

// Escalation limits. MAX_BEAM_WIDTH matches the Advanced Settings ceiling so
// the automatic ladder can never exceed what a user could set by hand. The
// time budget is generous because it is a ceiling, not a target: easy targets
// finish on the first attempt in well under a second.
const MAX_ATTEMPTS = 4;
const MAX_BEAM_WIDTH = 20000;
const TIME_BUDGET_MS = 90000;

let cancelled = false;

const readyPromise = (async () => {
  const [breedingRes, metaRes] = await Promise.all([
    fetch('../data/breeding.bin'),
    fetch('../data/meta.json'),
  ]);
  if (!breedingRes.ok || !metaRes.ok) {
    throw new Error('worker failed to load breeding data');
  }
  const buf = await breedingRes.arrayBuffer();
  const meta = await metaRes.json();
  initBreeding(buf, meta.speciesCount, meta.genderSpecificRules);
})();

self.postMessage({ type: 'loading' });
readyPromise
  .then(() => self.postMessage({ type: 'ready' }))
  .catch((e) => self.postMessage({ type: 'error', message: 'init failed: ' + (e && e.message ? e.message : String(e)) }));

self.onmessage = async (ev) => {
  const msg = ev.data;
  if (msg.type === 'cancel') { cancelled = true; return; }
  if (msg.type !== 'run') return;

  await readyPromise;
  cancelled = false;
  try {
    const p = msg.payload;
    const maleProbOf = (speciesIdx) => {
      const v = p.maleProbBySpecies ? p.maleProbBySpecies[speciesIdx] : undefined;
      return v === undefined || v === null ? 0.5 : v;
    };

    // Escalating search. A beam that's too narrow doesn't run slowly, it
    // starves: the frontier empties after a couple of rounds and the search
    // converges having never reached the target. Measured on a real 204-Pal
    // roster, width 1000 died at round 3 in 2.5s while a two-generation route
    // existed and turned up at width 4000. Waiting longer would never have
    // found it, so the only lever is widening, and making the user discover
    // that by failing and guessing is a poor trade.
    let beamWidth = p.beamWidth || 1000;
    let result = null;
    let attempt = 0;
    const startedAt = Date.now();
    let lastAttemptMs = 0;

    while (attempt < MAX_ATTEMPTS) {
      attempt++;
      self.postMessage({ type: 'attempt', attempt, maxAttempts: MAX_ATTEMPTS, beamWidth });

      const attemptStart = Date.now();
      result = runSolver({
        ownedPals: p.ownedPals,
        targetSpeciesIdx: p.targetSpeciesIdx,
        desiredPassiveNames: p.desiredPassiveNames,
        maleProbOf,
        genderRules: p.genderRules || [],
        beamWidth,
        maxSteps: p.maxSteps,
        timePerBreed: p.timePerBreed,
        maxResults: p.maxResults,
        useDominance: p.useDominance !== false,
        onProgress: (round, size) => {
          if (cancelled) throw new CancelledError();
          self.postMessage({ type: 'progress', round, size, attempt, beamWidth });
        },
      });
      lastAttemptMs = Date.now() - attemptStart;

      if (cancelled) break;
      if (result.results.length > 0) break;      // found something, stop here

      const nextBeam = beamWidth * 2;
      if (nextBeam > MAX_BEAM_WIDTH) break;

      // Pair evaluation is roughly quadratic in the frontier, so doubling the
      // width costs about 4x. Project that before committing, rather than
      // starting an attempt that blows far past the budget and can only be
      // escaped by hitting Cancel.
      const elapsed = Date.now() - startedAt;
      if (elapsed + lastAttemptMs * 4 > TIME_BUDGET_MS) break;

      beamWidth = nextBeam;
    }

    if (cancelled) { self.postMessage({ type: 'cancelled' }); return; }
    self.postMessage({ type: 'result', result, attempts: attempt, finalBeamWidth: beamWidth });
  } catch (e) {
    if (e instanceof CancelledError) { self.postMessage({ type: 'cancelled' }); return; }
    self.postMessage({ type: 'error', message: e && e.message ? e.message : String(e) });
  }
};
