// Reusable searchable dropdown picker used for species and passive
// selection. No framework -- a small stateful DOM component. The item list
// is fixed at creation time (species/passives are static after data load).

export function createSearchPicker({
  items, getId, getLabel, getSearchText, renderRow, placeholder = 'Search...', onChange,
  groupBy, groupLabel, groupOrder, maxResults = 60, isExcluded,
}) {
  const root = document.createElement('div');
  root.className = 'picker';

  const inputWrap = document.createElement('div');
  inputWrap.className = 'picker-input-wrap';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  input.className = 'picker-input';
  input.autocomplete = 'off';

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'picker-clear';
  clearBtn.textContent = '×';
  clearBtn.title = 'Clear';
  clearBtn.hidden = true;

  inputWrap.appendChild(input);
  inputWrap.appendChild(clearBtn);

  const dropdown = document.createElement('div');
  dropdown.className = 'picker-dropdown';
  dropdown.hidden = true;

  root.appendChild(inputWrap);
  root.appendChild(dropdown);

  let selectedId = null;

  function appendRow(item) {
    const row = document.createElement('div');
    row.className = 'picker-row';
    row.tabIndex = 0;
    if (renderRow) renderRow(row, item);
    else row.textContent = getLabel(item);
    row.addEventListener('mousedown', (e) => { e.preventDefault(); select(item); });
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter') select(item); });
    dropdown.appendChild(row);
  }

  function renderList(query) {
    const q = query.trim().toLowerCase();
    let matches = q === ''
      ? items
      : items.filter(it => getSearchText(it).toLowerCase().includes(q));
    // Evaluated fresh on every render (not captured once) so it reflects
    // whatever the OTHER pickers are currently holding, e.g. excluding a
    // passive already chosen in a sibling slot of the same 4-slot form.
    if (isExcluded) matches = matches.filter(it => !isExcluded(it));

    dropdown.innerHTML = '';
    if (matches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'picker-empty';
      empty.textContent = 'No matches';
      dropdown.appendChild(empty);
      return;
    }

    if (groupBy) {
      const buckets = new Map();
      for (const it of matches) {
        const key = groupBy(it);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(it);
      }
      const orderedKeys = groupOrder ? groupOrder.filter(k => buckets.has(k)) : Array.from(buckets.keys());
      let shown = 0;
      for (const key of orderedKeys) {
        if (shown >= maxResults) break;
        const header = document.createElement('div');
        header.className = 'picker-group-header';
        header.textContent = groupLabel ? groupLabel(key) : String(key);
        dropdown.appendChild(header);
        for (const item of buckets.get(key)) {
          if (shown >= maxResults) break;
          appendRow(item);
          shown++;
        }
      }
    } else {
      for (const item of matches.slice(0, maxResults)) appendRow(item);
    }
  }

  function select(item) {
    selectedId = item ? getId(item) : null;
    input.value = item ? getLabel(item) : '';
    clearBtn.hidden = !item;
    dropdown.hidden = true;
    if (onChange) onChange(item || null);
  }

  input.addEventListener('focus', () => {
    renderList('');
    dropdown.hidden = false;
  });
  input.addEventListener('input', () => {
    selectedId = null;
    clearBtn.hidden = true;
    renderList(input.value);
    dropdown.hidden = false;
  });
  document.addEventListener('click', (e) => {
    if (!root.contains(e.target)) dropdown.hidden = true;
  });
  clearBtn.addEventListener('click', () => {
    select(null);
    input.focus();
  });

  return {
    el: root,
    getValue: () => (selectedId !== null ? items.find(it => getId(it) === selectedId) : null),
    setValue: (item) => select(item),
    clear: () => select(null),
  };
}
