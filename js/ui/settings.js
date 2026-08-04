// "Advanced Settings" section (collapsed by default, see the <details> in
// index.html): solver tuning knobs, persisted via store.js.

import * as store from '../store.js';

const FIELDS = [
  { key: 'maxSteps', label: 'Max breeding generations', min: 1, max: 6, step: 1,
    hint: 'How many breeding steps deep to search. Higher finds more routes but is slower.' },
  { key: 'timePerBreed', label: 'Minutes per breeding attempt', min: 1, max: 240, step: 1,
    hint: 'Used only to estimate route time -- it never affects the probabilities themselves.' },
  { key: 'beamWidth', label: 'Beam width (advanced)', min: 100, max: 20000, step: 100,
    hint: 'Max candidate Pals kept per generation. Higher is more thorough but slower -- and cost grows much faster than the number itself, so raise it gradually (e.g. 1000 -> 3000) rather than jumping straight to the max.' },
  { key: 'maxResults', label: 'Number of routes to show', min: 1, max: 20, step: 1, hint: '' },
];

export function initSettingsTab(container) {
  container.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'card';
  const title = document.createElement('h3');
  title.textContent = 'Search Settings';
  card.appendChild(title);

  const settings = store.getSettings();

  for (const f of FIELDS) {
    const row = document.createElement('div');
    row.className = 'form-row';
    const label = document.createElement('label');
    label.textContent = f.label;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(f.min); input.max = String(f.max); input.step = String(f.step);
    input.value = String(settings[f.key]);
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (!Number.isNaN(v)) {
        const clamped = Math.max(f.min, Math.min(f.max, v));
        input.value = String(clamped);
        store.updateSettings({ [f.key]: clamped });
      }
    });
    row.appendChild(label);
    row.appendChild(input);
    if (f.hint) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = f.hint;
      row.appendChild(hint);
    }
    card.appendChild(row);
  }

  container.appendChild(card);
}
