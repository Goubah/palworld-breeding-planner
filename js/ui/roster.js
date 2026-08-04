// "My Pals" section: add/edit/duplicate/delete owned Pals, persisted via
// store.js, plus JSON import/export.

import { getPassives, palByInternal } from '../data.js';
import * as store from '../store.js';
import { createSpeciesPicker, createPassivePicker, renderPalIcon, renderPassiveChip } from './shared.js';

export function initRosterTab(container) {
  container.innerHTML = '';

  const formSection = document.createElement('div');
  formSection.className = 'card';
  const formTitle = document.createElement('h3');
  formTitle.textContent = 'Add a Pal';
  formSection.appendChild(formTitle);

  const speciesRow = document.createElement('div');
  speciesRow.className = 'form-row';
  const speciesLabel = document.createElement('label');
  speciesLabel.textContent = 'Pal';
  const speciesPicker = createSpeciesPicker(null);
  speciesRow.appendChild(speciesLabel);
  speciesRow.appendChild(speciesPicker.el);
  formSection.appendChild(speciesRow);

  const genderRow = document.createElement('div');
  genderRow.className = 'form-row';
  const genderLabel = document.createElement('label');
  genderLabel.textContent = 'Gender';
  const genderToggle = document.createElement('div');
  genderToggle.className = 'gender-toggle';
  let gender = 'MALE';
  const maleBtn = document.createElement('button');
  maleBtn.type = 'button'; maleBtn.textContent = 'Male'; maleBtn.className = 'gender-btn active';
  const femaleBtn = document.createElement('button');
  femaleBtn.type = 'button'; femaleBtn.textContent = 'Female'; femaleBtn.className = 'gender-btn';
  maleBtn.addEventListener('click', () => { gender = 'MALE'; maleBtn.classList.add('active'); femaleBtn.classList.remove('active'); });
  femaleBtn.addEventListener('click', () => { gender = 'FEMALE'; femaleBtn.classList.add('active'); maleBtn.classList.remove('active'); });
  genderToggle.appendChild(maleBtn);
  genderToggle.appendChild(femaleBtn);
  genderRow.appendChild(genderLabel);
  genderRow.appendChild(genderToggle);
  formSection.appendChild(genderRow);

  const passivePickers = [];
  const passivesRow = document.createElement('div');
  passivesRow.className = 'form-row passives-row';
  const passivesLabel = document.createElement('label');
  passivesLabel.textContent = 'Passives (up to 4)';
  passivesRow.appendChild(passivesLabel);
  const passivesGrid = document.createElement('div');
  passivesGrid.className = 'passives-grid';
  for (let i = 0; i < 4; i++) {
    // A real Pal can only carry a given passive once -- excludes whatever
    // the OTHER three slots currently hold, checked live each time this
    // slot's dropdown opens (not just at creation), so it stays correct as
    // sibling slots change.
    const picker = createPassivePicker(null, {
      isExcluded: (passive) => passivePickers.some((p, idx) => idx !== i && p.getValue()?.internalName === passive.internalName),
    });
    passivePickers.push(picker);
    passivesGrid.appendChild(picker.el);
  }
  passivesRow.appendChild(passivesGrid);
  formSection.appendChild(passivesRow);

  let editingId = null;

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'btn btn-primary';
  submitBtn.textContent = 'Add to Roster';

  const cancelEditBtn = document.createElement('button');
  cancelEditBtn.type = 'button';
  cancelEditBtn.className = 'btn btn-secondary';
  cancelEditBtn.textContent = 'Cancel Edit';
  cancelEditBtn.hidden = true;

  function resetForm() {
    editingId = null;
    speciesPicker.clear();
    gender = 'MALE';
    maleBtn.classList.add('active'); femaleBtn.classList.remove('active');
    for (const p of passivePickers) p.clear();
    submitBtn.textContent = 'Add to Roster';
    cancelEditBtn.hidden = true;
    formTitle.textContent = 'Add a Pal';
  }

  submitBtn.addEventListener('click', () => {
    const species = speciesPicker.getValue();
    if (!species) { alert('Pick a Pal first.'); return; }
    const passiveNames = passivePickers.map(p => p.getValue()).filter(Boolean).map(p => p.internalName);
    const palData = { speciesInternal: species.internalName, gender, passiveInternalNames: passiveNames };
    if (editingId) store.updatePal(editingId, palData);
    else store.addPal(palData);
    resetForm();
    renderList();
  });
  cancelEditBtn.addEventListener('click', resetForm);

  const btnRow = document.createElement('div');
  btnRow.className = 'form-row';
  btnRow.appendChild(submitBtn);
  btnRow.appendChild(cancelEditBtn);
  formSection.appendChild(btnRow);

  container.appendChild(formSection);

  const ioSection = document.createElement('div');
  ioSection.className = 'card io-card';
  const exportBtn = document.createElement('button');
  exportBtn.className = 'btn btn-secondary';
  exportBtn.textContent = 'Export Roster (JSON)';
  exportBtn.addEventListener('click', () => {
    const blob = new Blob([store.exportData()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'palworld-breeding-planner-data.json';
    a.click();
    URL.revokeObjectURL(url);
  });
  const importBtn = document.createElement('button');
  importBtn.className = 'btn btn-secondary';
  importBtn.textContent = 'Import Roster (JSON)';
  const importInput = document.createElement('input');
  importInput.type = 'file'; importInput.accept = 'application/json'; importInput.hidden = true;
  importBtn.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async () => {
    const file = importInput.files[0];
    if (!file) return;
    const text = await file.text();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      alert('Import failed: this file is not valid JSON.');
      importInput.value = '';
      return;
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.roster)) {
      alert('Import failed: this doesn\'t look like a roster export (expected a "roster" array).');
      importInput.value = '';
      return;
    }

    // store.js's own sanitizer only fixes STRUCTURE (right types, capped
    // passive count) -- it can't tell a real Pal/passive from a made-up
    // string, since it has no access to the game data this needs. That
    // semantic check happens here instead, where data.js is already loaded,
    // so the user finds out what got skipped and why before committing.
    const validPassiveNames = new Set(getPassives().map(p => p.internalName));
    let skippedUnknownSpecies = 0;
    let trimmedPassives = 0;
    const cleanedRoster = [];
    for (const raw of parsed.roster) {
      if (!raw || typeof raw !== 'object') continue;
      const species = palByInternal(raw.speciesInternal);
      if (!species) { skippedUnknownSpecies++; continue; }
      const gender = raw.gender === 'FEMALE' ? 'FEMALE' : 'MALE';
      const rawPassives = Array.isArray(raw.passiveInternalNames) ? raw.passiveInternalNames : [];
      const known = rawPassives.filter(p => validPassiveNames.has(p));
      const deduped = Array.from(new Set(known)).slice(0, 4);
      if (deduped.length < rawPassives.length) trimmedPassives++;
      cleanedRoster.push({ speciesInternal: raw.speciesInternal, gender, passiveInternalNames: deduped });
    }

    let summary = `Import ${cleanedRoster.length} Pal(s)`;
    if (skippedUnknownSpecies > 0) summary += `, skipping ${skippedUnknownSpecies} with an unrecognized species`;
    if (trimmedPassives > 0) summary += ` (${trimmedPassives} had unknown and/or duplicate passives removed)`;
    summary += '. This replaces your current roster and settings. Continue?';
    if (!confirm(summary)) { importInput.value = ''; return; }

    try {
      store.importData(JSON.stringify({
        roster: cleanedRoster,
        settings: (parsed.settings && typeof parsed.settings === 'object') ? parsed.settings : {},
      }));
      renderList();
    } catch (e) {
      alert('Import failed: ' + e.message);
    }
    importInput.value = '';
  });
  ioSection.appendChild(exportBtn);
  ioSection.appendChild(importBtn);
  ioSection.appendChild(importInput);
  container.appendChild(ioSection);

  const listSection = document.createElement('div');
  listSection.className = 'card';
  const listTitle = document.createElement('h3');
  listTitle.textContent = 'Your Pals';
  listSection.appendChild(listTitle);
  const listEl = document.createElement('div');
  listEl.className = 'pal-list';
  listSection.appendChild(listEl);
  container.appendChild(listSection);

  function renderList() {
    listEl.innerHTML = '';
    const roster = store.getRoster();
    if (roster.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'No Pals added yet. Add your first Pal above.';
      listEl.appendChild(empty);
      return;
    }
    for (const pal of roster) {
      const species = palByInternal(pal.speciesInternal);
      if (!species) continue;
      const row = document.createElement('div');
      row.className = 'pal-row';
      row.appendChild(renderPalIcon(species, 36));

      const info = document.createElement('div');
      info.className = 'pal-row-info';
      const nameLine = document.createElement('div');
      nameLine.className = 'pal-row-name';
      nameLine.append(species.name + ' ');
      const genderIcon = document.createElement('span');
      genderIcon.className = 'gender-icon ' + (pal.gender === 'MALE' ? 'male' : 'female');
      genderIcon.textContent = pal.gender === 'MALE' ? '♂' : '♀';
      nameLine.appendChild(genderIcon);
      info.appendChild(nameLine);

      const chipsLine = document.createElement('div');
      chipsLine.className = 'pal-row-passives';
      // store.js guarantees passiveInternalNames is always an array, but
      // this stays defensive rather than assuming it -- rendering code
      // crashing on a bad field is exactly the failure mode that got fixed
      // upstream, no reason to still be one missed sanitizer bug away from it.
      const palPassiveNames = Array.isArray(pal.passiveInternalNames) ? pal.passiveInternalNames : [];
      if (palPassiveNames.length === 0) {
        const none = document.createElement('span');
        none.className = 'muted';
        none.textContent = 'No passives set';
        chipsLine.appendChild(none);
      }
      for (const pname of palPassiveNames) {
        const passive = getPassives().find(p => p.internalName === pname);
        if (passive) chipsLine.appendChild(renderPassiveChip(passive));
      }
      info.appendChild(chipsLine);
      row.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'pal-row-actions';
      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn-small'; editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => {
        editingId = pal.id;
        speciesPicker.setValue(species);
        gender = pal.gender;
        if (gender === 'MALE') { maleBtn.classList.add('active'); femaleBtn.classList.remove('active'); }
        else { femaleBtn.classList.add('active'); maleBtn.classList.remove('active'); }
        palPassiveNames.forEach((pname, i) => {
          const passive = getPassives().find(p => p.internalName === pname);
          if (passivePickers[i] && passive) passivePickers[i].setValue(passive);
        });
        for (let i = palPassiveNames.length; i < 4; i++) passivePickers[i].clear();
        submitBtn.textContent = 'Save Changes';
        cancelEditBtn.hidden = false;
        formTitle.textContent = 'Edit Pal';
        formSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      const dupBtn = document.createElement('button');
      dupBtn.className = 'btn btn-small'; dupBtn.textContent = 'Duplicate';
      dupBtn.addEventListener('click', () => { store.duplicatePal(pal.id); renderList(); });
      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-small btn-danger'; delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => {
        if (confirm(`Remove ${species.name} from your roster?`)) { store.removePal(pal.id); renderList(); }
      });
      actions.appendChild(editBtn);
      actions.appendChild(dupBtn);
      actions.appendChild(delBtn);
      row.appendChild(actions);

      listEl.appendChild(row);
    }
  }

  renderList();
}
