// Web Worker wrapper around solver.js so route-finding never blocks the UI
// thread. This worker loads the breeding table independently (workers don't
// share module state with the main thread's copy of breeding.js), then
// listens for {type:'run', payload} messages and streams back
// {type:'progress'|'result'|'error'|'cancelled'}.

import { initBreeding } from './breeding.js';
import { runSolver } from './solver.js';

class CancelledError extends Error {}

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

    const result = runSolver({
      ownedPals: p.ownedPals,
      targetSpeciesIdx: p.targetSpeciesIdx,
      desiredPassiveNames: p.desiredPassiveNames,
      maleProbOf,
      genderRules: p.genderRules || [],
      beamWidth: p.beamWidth,
      maxSteps: p.maxSteps,
      timePerBreed: p.timePerBreed,
      maxResults: p.maxResults,
      useDominance: p.useDominance !== false,
      onProgress: (round, size) => {
        if (cancelled) throw new CancelledError();
        self.postMessage({ type: 'progress', round, size });
      },
    });

    if (cancelled) { self.postMessage({ type: 'cancelled' }); return; }
    self.postMessage({ type: 'result', result });
  } catch (e) {
    if (e instanceof CancelledError) { self.postMessage({ type: 'cancelled' }); return; }
    self.postMessage({ type: 'error', message: e && e.message ? e.message : String(e) });
  }
};
