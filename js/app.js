// Entry point: loads game data once, then mounts every section onto the
// single scrolling page (no tabs -- roster, target, and results all sit
// stacked top to bottom so nothing requires switching views to see).

import { loadGameData } from './data.js';
import { initRosterTab } from './ui/roster.js';
import { initTargetTab } from './ui/target.js';
import { initResultsTab, runSearch } from './ui/results.js';
import { initSettingsTab } from './ui/settings.js';

async function main() {
  const loadingEl = document.getElementById('loading-overlay');
  try {
    await loadGameData('data/');
  } catch (e) {
    loadingEl.textContent = 'Failed to load game data: ' + e.message +
      '. Make sure this page is being served over http:// (not opened directly as a file), and that the data/ folder is present next to index.html.';
    return;
  }
  loadingEl.hidden = true;

  initRosterTab(document.getElementById('roster-mount'));
  initResultsTab(document.getElementById('results-mount'));
  initTargetTab(document.getElementById('target-mount'), {
    onRun: (req) => {
      runSearch(req);
      document.getElementById('results-mount').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
  });
  initSettingsTab(document.getElementById('settings-mount'));
}

main();
