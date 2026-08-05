// "Target Pal Child" section: pick the desired species + up to 4 desired
// passives, and run live pre-flight diagnostics (reachability, passive
// availability) before allowing a search to start -- so an impossible
// request fails fast with a clear reason instead of a long search ending in
// silence. Results render directly below this section on the same page.

import { getMeta, palByInternal, passiveByInternal } from '../data.js';
import { checkPreflight } from '../solver.js';
import * as store from '../store.js';
import { createSpeciesPicker, createPassivePicker, plural } from './shared.js';

export function initTargetTab(container, { onRun }) {
  container.innerHTML = '';

  let targetSpecies = null;
  let desiredPassives = [];

  const card = document.createElement('div');
  card.className = 'card';

  const speciesRow = document.createElement('div');
  speciesRow.className = 'form-row';
  const speciesLabel = document.createElement('label');
  speciesLabel.textContent = 'Target Pal';
  const speciesPicker = createSpeciesPicker((pal) => { targetSpecies = pal; refreshPreflight(); });
  speciesRow.appendChild(speciesLabel);
  speciesRow.appendChild(speciesPicker.el);
  card.appendChild(speciesRow);

  const passivesRow = document.createElement('div');
  passivesRow.className = 'form-row passives-row';
  const passivesLabel = document.createElement('label');
  passivesLabel.textContent = 'Desired passives (up to 4)';
  passivesRow.appendChild(passivesLabel);
  const grid = document.createElement('div');
  grid.className = 'passives-grid';
  const passivePickers = [];
  for (let i = 0; i < 4; i++) {
    // Same passive can't occupy two slots -- see the matching comment in
    // roster.js's Add-a-Pal form. Here a duplicate wouldn't corrupt junk
    // counts (this is the DESIRED list, not an owned Pal's own passives),
    // but it silently wastes a bit position in buildDesiredIndex(), so it's
    // worth preventing for the same reason: don't let the UI produce a
    // state the rest of the app didn't design for.
    const picker = createPassivePicker(() => {
      desiredPassives = passivePickers.map(p => p.getValue()).filter(Boolean);
      refreshPreflight();
    }, {
      isExcluded: (passive) => passivePickers.some((p, idx) => idx !== i && p.getValue()?.internalName === passive.internalName),
    });
    passivePickers.push(picker);
    grid.appendChild(picker.el);
  }
  passivesRow.appendChild(grid);
  card.appendChild(passivesRow);

  container.appendChild(card);

  const preflightCard = document.createElement('div');
  preflightCard.className = 'card preflight-card';
  container.appendChild(preflightCard);

  const runBtn = document.createElement('button');
  runBtn.className = 'btn btn-primary btn-large';
  runBtn.textContent = 'Find Breeding Routes';
  runBtn.disabled = true;
  container.appendChild(runBtn);

  function refreshPreflight() {
    preflightCard.innerHTML = '';
    if (!targetSpecies) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'Pick a target Pal to see route feasibility.';
      preflightCard.appendChild(p);
      runBtn.disabled = true;
      return;
    }

    const roster = store.getRoster()
      .map(p => {
        const species = palByInternal(p.speciesInternal);
        return species ? { speciesIdx: species.i, gender: p.gender, passiveInternalNames: p.passiveInternalNames } : null;
      })
      .filter(Boolean);

    if (roster.length === 0) {
      const p = document.createElement('p');
      p.className = 'warn';
      p.textContent = 'Add at least one Pal to your roster first (see "My Pals" above).';
      preflightCard.appendChild(p);
      runBtn.disabled = true;
      return;
    }

    const pre = checkPreflight({
      ownedPals: roster,
      targetSpeciesIdx: targetSpecies.i,
      desiredPassiveNames: desiredPassives.map(p => p.internalName),
      passiveInfoByName: passiveByInternal,
      genderRules: getMeta().genderSpecificRules,
      maxSteps: store.getSettings().maxSteps,
    });

    const reachEl = document.createElement('p');
    if (!pre.speciesReachable) {
      reachEl.className = 'error';
      reachEl.textContent = `✗ ${targetSpecies.name} is NOT reachable by breeding from any Pal you currently own.`;
    } else if (!pre.reachableWithinSteps) {
      reachEl.className = 'error';
      reachEl.textContent = `✗ ${targetSpecies.name} needs at least ${plural(pre.minGenerations, 'breeding generation')}, but "Max breeding generations" is currently set to ${pre.maxSteps}. Raise it in Advanced Settings, then try again.`;
    } else if (pre.minGenerations === 0) {
      reachEl.className = 'warn';
      reachEl.textContent = `⚠ You already own ${targetSpecies.name}, so no breeding is needed for the species itself. If yours is missing some of the desired passives, run the search anyway and it will breed a fresh one that combines them.`;
    } else {
      reachEl.className = 'ok';
      reachEl.textContent = `✓ ${targetSpecies.name} is reachable in ${plural(pre.minGenerations, 'generation')} from your current roster.`;
    }
    preflightCard.appendChild(reachEl);

    for (const check of pre.passiveChecks) {
      const p = document.createElement('p');
      if (check.status === 'ok') {
        p.className = 'ok';
        p.textContent = `✓ ${check.name}: owned on at least one of your Pals.`;
      } else if (check.status === 'unlikely') {
        p.className = 'warn';
        p.textContent = `⚠ ${check.name}: nobody owns it, but it can still appear via random inheritance (unlikely).`;
      } else {
        p.className = 'error';
        p.textContent = `✗ ${check.name}: nobody owns it, and it can never be randomly rolled, so it must come from a parent.`;
      }
      preflightCard.appendChild(p);
    }

    if (desiredPassives.length === 0) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'No desired passives selected. The search will just look for the Pal.';
      preflightCard.appendChild(p);
    }

    runBtn.disabled = pre.blocked;
  }

  runBtn.addEventListener('click', () => {
    if (!targetSpecies) return;
    onRun({ targetSpecies, desiredPassives });
  });

  store.subscribe(refreshPreflight);
  refreshPreflight();
}
