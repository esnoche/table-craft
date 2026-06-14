(() => {
'use strict';

const state = {
  rawData: null,
  records: [],
  datasetKey: null,
  fields: [],
  fieldConfig: {},
  search: '',
  filters: {},
  sort: null,
  page: 0,
  pageSize: 20,
  filteredCache: null,
};

const $ = sel => document.querySelector(sel);

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function escHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------- Load screen ----------

function setupLoadScreen() {
  $('#fileInput').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const text = await f.text();
      loadJson(text);
    } catch (err) {
      showLoadError(err.message);
    }
  });

  $('#btnPaste').addEventListener('click', () => {
    $('#pasteArea').classList.toggle('hidden');
  });

  $('#btnLoadPaste').addEventListener('click', () => {
    const text = $('#pasteInput').value.trim();
    if (!text) { showLoadError('Paste some JSON first'); return; }
    loadJson(text);
  });

  $('#btnReset').addEventListener('click', resetApp);
}

function loadJson(text) {
  hideLoadError();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    showLoadError('Invalid JSON: ' + e.message);
    return;
  }
  state.rawData = data;

  if (Array.isArray(data)) {
    startWithRecords(data, '(root array)');
    return;
  }
  if (data && typeof data === 'object') {
    const anyArrays = Object.keys(data).filter(k => Array.isArray(data[k]));
    if (anyArrays.length === 0) {
      startWithRecords([data], '(single object)');
      return;
    }
    // Prefer arrays that contain objects
    const objArrays = anyArrays.filter(k => {
      const arr = data[k];
      return arr.length > 0 && arr.every(v => v && typeof v === 'object' && !Array.isArray(v));
    });
    if (objArrays.length === 1) { startWithRecords(data[objArrays[0]], objArrays[0]); return; }
    if (objArrays.length > 1) { showArrayPicker(data, objArrays); return; }
    if (anyArrays.length === 1) { startWithRecords(data[anyArrays[0]], anyArrays[0]); return; }
    showArrayPicker(data, anyArrays);
    return;
  }
  showLoadError('JSON must be an object or array');
}

function showArrayPicker(root, keys) {
  $('#loadScreen').classList.add('hidden');
  $('#arrayPickerScreen').classList.remove('hidden');
  const opts = $('#arrayOptions');
  opts.innerHTML = '';
  for (const k of keys) {
    const arr = root[k];
    const btn = document.createElement('button');
    btn.className = 'array-option';
    const first = arr[0];
    let sample;
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      sample = 'fields: ' + Object.keys(first).slice(0, 6).join(', ');
    } else {
      sample = 'type: ' + (Array.isArray(first) ? 'array' : typeof first);
    }
    btn.innerHTML = `<strong>${escHtml(k)}</strong> &mdash; ${arr.length} items<br><span class="muted small">${escHtml(sample)}</span>`;
    btn.onclick = () => {
      $('#arrayPickerScreen').classList.add('hidden');
      startWithRecords(arr, k);
    };
    opts.appendChild(btn);
  }
}

function showLoadError(msg) {
  const el = $('#loadError');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function hideLoadError() { $('#loadError').classList.add('hidden'); }

function resetApp() {
  Object.assign(state, {
    rawData: null, records: [], datasetKey: null, fields: [],
    fieldConfig: {}, filters: {}, search: '', sort: null,
    page: 0, filteredCache: null,
  });
  $('#viewerScreen').classList.add('hidden');
  $('#arrayPickerScreen').classList.add('hidden');
  $('#btnReset').classList.add('hidden');
  $('#loadScreen').classList.remove('hidden');
  $('#fileInput').value = '';
  $('#pasteInput').value = '';
  $('#pasteArea').classList.add('hidden');
  $('#searchInput').value = '';
  hideLoadError();
}

// ---------- Field discovery ----------

function startWithRecords(records, key) {
  const clean = records.filter(r => r && typeof r === 'object' && !Array.isArray(r));
  if (clean.length === 0) {
    showLoadError('The chosen array contains no objects to display as records.');
    $('#arrayPickerScreen').classList.add('hidden');
    $('#loadScreen').classList.remove('hidden');
    return;
  }
  state.records = clean;
  state.datasetKey = key;
  state.fields = discoverFields(clean);
  initFieldConfig();
  showViewer();
}

function discoverFields(records) {
  const map = new Map();

  function register(path, value) {
    if (!map.has(path)) map.set(path, { types: new Map(), samples: [] });
    const e = map.get(path);
    let t;
    if (value === null) t = 'null';
    else if (Array.isArray(value)) t = 'array';
    else t = typeof value;
    e.types.set(t, (e.types.get(t) || 0) + 1);
    if (e.samples.length < 3000) e.samples.push(value);
  }

  function walk(val, path) {
    if (val === undefined) return;
    if (val === null) { register(path, null); return; }
    if (Array.isArray(val)) {
      if (val.length === 0) { register(path, []); return; }
      const allObj = val.every(v => v && typeof v === 'object' && !Array.isArray(v));
      if (allObj) {
        for (const item of val) {
          for (const k of Object.keys(item)) walk(item[k], `${path}[].${k}`);
        }
      } else {
        register(path, val);
      }
      return;
    }
    if (typeof val === 'object') {
      for (const k of Object.keys(val)) walk(val[k], path ? `${path}.${k}` : k);
      return;
    }
    register(path, val);
  }

  for (const rec of records) {
    for (const k of Object.keys(rec)) walk(rec[k], k);
  }

  const fields = [];
  for (const [path, info] of map) {
    const nonNull = [...info.types.entries()].filter(([t]) => t !== 'null' && t !== 'undefined');
    let type;
    if (nonNull.length === 0) type = 'null';
    else {
      nonNull.sort((a, b) => b[1] - a[1]);
      type = nonNull[0][0];
    }

    let elementType = null;
    if (type === 'array') {
      const flat = [];
      for (const s of info.samples) if (Array.isArray(s)) flat.push(...s);
      const counts = {};
      for (const v of flat) {
        if (v === null || v === undefined) continue;
        const t = typeof v;
        counts[t] = (counts[t] || 0) + 1;
      }
      const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
      elementType = best || 'string';
      type = 'list';
    }

    let distinct = null;
    if (type === 'string' || (type === 'list' && elementType === 'string')) {
      const flat = type === 'list' ? info.samples.flat() : info.samples;
      const set = new Set();
      for (const v of flat) {
        if (v === null || v === undefined || v === '') continue;
        set.add(String(v));
        if (set.size > 16) break;
      }
      if (set.size > 0 && set.size <= 15) distinct = [...set].sort();
    }

    fields.push({ path, type, elementType, distinct });
  }

  fields.sort((a, b) => {
    const rank = p => (p.includes('[]') ? 2 : p.includes('.') ? 1 : 0);
    const ra = rank(a.path), rb = rank(b.path);
    if (ra !== rb) return ra - rb;
    return a.path.localeCompare(b.path);
  });

  return fields;
}

function getValues(record, path) {
  let current = [record];
  const segments = path.split('.');
  for (const seg of segments) {
    const isArraySeg = seg.endsWith('[]');
    const key = isArraySeg ? seg.slice(0, -2) : seg;
    const next = [];
    for (const c of current) {
      if (c === null || c === undefined || typeof c !== 'object') continue;
      const v = c[key];
      if (v === undefined || v === null) continue;
      if (isArraySeg) {
        if (Array.isArray(v)) { for (const item of v) next.push(item); }
        else next.push(v);
      } else {
        next.push(v);
      }
    }
    current = next;
  }
  return current;
}

function getFieldValues(record, field) {
  const vals = getValues(record, field.path);
  if (field.type === 'list') {
    const flat = [];
    for (const v of vals) {
      if (Array.isArray(v)) for (const x of v) { if (x !== null && x !== undefined) flat.push(x); }
      else if (v !== null && v !== undefined) flat.push(v);
    }
    return flat;
  }
  return vals;
}

function formatFieldValue(values) {
  if (!values || values.length === 0) return '';
  const parts = [];
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'object') parts.push(JSON.stringify(v));
    else if (v === '') continue;
    else parts.push(String(v));
  }
  return parts.join(', ');
}

// ---------- Config ----------

function initFieldConfig() {
  const cfg = {};
  let visibleCount = 0;
  for (const f of state.fields) {
    const isTopLevel = !f.path.includes('.') && !f.path.includes('[]');
    const c = { searchable: false, filterable: false, visible: false };
    if (f.type === 'string' || (f.type === 'list' && f.elementType === 'string')) {
      c.searchable = true;
    }
    if (f.distinct && f.distinct.length <= 15) c.filterable = true;
    else if (f.type === 'boolean') c.filterable = true;
    else if (f.type === 'number' && isTopLevel) c.filterable = true;
    if (isTopLevel && f.type !== 'null' && visibleCount < 8) {
      c.visible = true;
      visibleCount++;
    }
    cfg[f.path] = c;
  }
  state.fieldConfig = cfg;
}

// ---------- Filtering & sorting ----------

function matchesSearch(record, q, fields) {
  for (const f of fields) {
    const vals = getFieldValues(record, f);
    for (const v of vals) {
      if (v === null || v === undefined) continue;
      if (String(v).toLowerCase().includes(q)) return true;
    }
  }
  return false;
}

function matchesFilter(record, field, filter) {
  const vals = getFieldValues(record, field);
  switch (filter.kind) {
    case 'contains': {
      if (!filter.value) return true;
      const q = filter.value.toLowerCase();
      return vals.some(v => v !== null && v !== undefined && String(v).toLowerCase().includes(q));
    }
    case 'multi': {
      if (!filter.values || filter.values.length === 0) return true;
      return vals.some(v => filter.values.includes(String(v)));
    }
    case 'range': {
      const hasMin = filter.min !== null && filter.min !== undefined && filter.min !== '';
      const hasMax = filter.max !== null && filter.max !== undefined && filter.max !== '';
      if (!hasMin && !hasMax) return true;
      return vals.some(v => {
        const n = Number(v);
        if (Number.isNaN(n)) return false;
        if (hasMin && n < Number(filter.min)) return false;
        if (hasMax && n > Number(filter.max)) return false;
        return true;
      });
    }
    case 'bool': {
      if (!filter.value || filter.value === 'any') return true;
      const target = filter.value === 'true';
      return vals.some(v => v === target);
    }
    default: return true;
  }
}

function getFiltered() {
  if (state.filteredCache) return state.filteredCache;
  const searchableFields = state.fields.filter(f => state.fieldConfig[f.path]?.searchable);
  const activeFilters = [];
  for (const path of Object.keys(state.filters)) {
    const field = state.fields.find(f => f.path === path);
    if (!field) continue;
    if (!state.fieldConfig[path]?.filterable) continue;
    activeFilters.push({ field, filter: state.filters[path] });
  }
  const q = state.search.trim().toLowerCase();

  let result = state.records.filter(rec => {
    if (q && searchableFields.length > 0 && !matchesSearch(rec, q, searchableFields)) return false;
    for (const { field, filter } of activeFilters) {
      if (!matchesFilter(rec, field, filter)) return false;
    }
    return true;
  });

  if (state.sort) {
    const { path, dir } = state.sort;
    const field = state.fields.find(f => f.path === path);
    if (field) {
      const mul = dir === 'asc' ? 1 : -1;
      result = result.slice().sort((a, b) => {
        const av = getFieldValues(a, field);
        const bv = getFieldValues(b, field);
        if (field.type === 'number') {
          const an = av.length ? Number(av[0]) : NaN;
          const bn = bv.length ? Number(bv[0]) : NaN;
          const aNa = Number.isNaN(an), bNa = Number.isNaN(bn);
          if (aNa && bNa) return 0;
          if (aNa) return 1;
          if (bNa) return -1;
          return (an - bn) * mul;
        }
        const as = formatFieldValue(av);
        const bs = formatFieldValue(bv);
        if (as === bs) return 0;
        if (as === '') return 1;
        if (bs === '') return -1;
        return as.localeCompare(bs) * mul;
      });
    }
  }

  state.filteredCache = result;
  return result;
}

function invalidateAndRender() {
  state.filteredCache = null;
  renderResults();
}

// ---------- Viewer ----------

function showViewer() {
  $('#loadScreen').classList.add('hidden');
  $('#viewerScreen').classList.remove('hidden');
  $('#btnReset').classList.remove('hidden');
  $('#datasetName').textContent = state.datasetKey || 'Records';
  $('#datasetCount').textContent = `${state.records.length} records · ${state.fields.length} fields discovered`;
  renderFieldConfig();
  renderFilters();
  invalidateAndRender();
}

function renderFieldConfig() {
  const list = $('#fieldList');
  list.innerHTML = state.fields.map(f => {
    const cfg = state.fieldConfig[f.path];
    let typeLabel = f.type;
    if (f.elementType) typeLabel += `‹${f.elementType}›`;
    if (f.distinct) typeLabel += ` (${f.distinct.length})`;
    const p = escHtml(f.path);
    return `
      <div class="field-config-row">
        <span class="field-path" title="${p}">${p}</span>
        <span class="field-type">${escHtml(typeLabel)}</span>
        <input type="checkbox" data-path="${p}" data-key="searchable" ${cfg.searchable ? 'checked' : ''} aria-label="Search">
        <input type="checkbox" data-path="${p}" data-key="filterable" ${cfg.filterable ? 'checked' : ''} aria-label="Filter">
        <input type="checkbox" data-path="${p}" data-key="visible" ${cfg.visible ? 'checked' : ''} aria-label="Show">
      </div>
    `;
  }).join('');

  list.onchange = e => {
    const t = e.target;
    if (t.type !== 'checkbox') return;
    const path = t.dataset.path;
    const key = t.dataset.key;
    if (!state.fieldConfig[path]) return;
    state.fieldConfig[path][key] = t.checked;
    if (key === 'filterable' && !t.checked) delete state.filters[path];
    if (key === 'filterable') renderFilters();
    invalidateAndRender();
  };
}

function renderFilters() {
  const panel = $('#filterPanel');
  const filterableFields = state.fields.filter(f => state.fieldConfig[f.path]?.filterable);
  if (filterableFields.length === 0) {
    panel.innerHTML = '<p class="muted small">No fields marked as filterable. Open "Configure fields" and tick some.</p>';
    return;
  }
  panel.innerHTML = filterableFields.map(renderFilterItem).join('');

  panel.querySelectorAll('input, select').forEach(el => {
    el.addEventListener('input', handleFilterChange);
    if (el.tagName === 'SELECT') el.addEventListener('change', handleFilterChange);
  });
  panel.querySelectorAll('.filter-chip').forEach(el => {
    el.addEventListener('click', handleChipToggle);
  });
}

function renderFilterItem(f) {
  const filter = state.filters[f.path] || {};
  const p = escHtml(f.path);
  let body;
  if (f.distinct && f.distinct.length > 0) {
    const selected = filter.values || [];
    body = `<div class="filter-chips">` + f.distinct.map(v => {
      const active = selected.includes(v) ? 'active' : '';
      return `<span class="filter-chip ${active}" data-path="${p}" data-value="${escHtml(v)}">${escHtml(v)}</span>`;
    }).join('') + `</div>`;
  } else if (f.type === 'number') {
    const min = filter.min !== undefined && filter.min !== null ? filter.min : '';
    const max = filter.max !== undefined && filter.max !== null ? filter.max : '';
    body = `<div class="filter-range">
      <input type="number" data-path="${p}" data-key="min" placeholder="Min" value="${escHtml(min)}">
      <input type="number" data-path="${p}" data-key="max" placeholder="Max" value="${escHtml(max)}">
    </div>`;
  } else if (f.type === 'boolean') {
    const v = filter.value || 'any';
    body = `<select data-path="${p}" data-key="value">
      <option value="any" ${v === 'any' ? 'selected' : ''}>Any</option>
      <option value="true" ${v === 'true' ? 'selected' : ''}>Yes / true</option>
      <option value="false" ${v === 'false' ? 'selected' : ''}>No / false</option>
    </select>`;
  } else {
    body = `<input type="text" data-path="${p}" data-key="text" placeholder="Contains..." value="${escHtml(filter.value || '')}">`;
  }
  return `<div class="filter-item"><label class="filter-label" title="${p}">${p}</label>${body}</div>`;
}

const debouncedInvalidate = debounce(() => invalidateAndRender(), 150);

function handleFilterChange(e) {
  const el = e.target;
  const path = el.dataset.path;
  const key = el.dataset.key;
  const field = state.fields.find(f => f.path === path);
  if (!field) return;

  if (field.type === 'number') {
    const cur = state.filters[path] && state.filters[path].kind === 'range'
      ? state.filters[path] : { kind: 'range', min: null, max: null };
    cur[key] = el.value === '' ? null : Number(el.value);
    if ((cur.min === null || cur.min === undefined) && (cur.max === null || cur.max === undefined)) {
      delete state.filters[path];
    } else {
      state.filters[path] = cur;
    }
  } else if (field.type === 'boolean') {
    if (el.value === 'any') delete state.filters[path];
    else state.filters[path] = { kind: 'bool', value: el.value };
  } else if (key === 'text') {
    if (el.value === '') delete state.filters[path];
    else state.filters[path] = { kind: 'contains', value: el.value };
  }
  state.page = 0;
  if (field.type === 'boolean') invalidateAndRender();
  else debouncedInvalidate();
}

function handleChipToggle(e) {
  const el = e.currentTarget;
  const path = el.dataset.path;
  const value = el.dataset.value;
  const existing = state.filters[path];
  const cur = existing && existing.kind === 'multi' ? existing : { kind: 'multi', values: [] };
  const idx = cur.values.indexOf(value);
  if (idx === -1) cur.values.push(value);
  else cur.values.splice(idx, 1);
  if (cur.values.length === 0) delete state.filters[path];
  else state.filters[path] = cur;
  el.classList.toggle('active');
  state.page = 0;
  invalidateAndRender();
}

// ---------- Results ----------

function renderResults() {
  const data = getFiltered();
  const total = data.length;
  const maxPage = total === 0 ? 0 : Math.max(0, Math.ceil(total / state.pageSize) - 1);
  if (state.page > maxPage) state.page = maxPage;

  const start = state.page * state.pageSize;
  const end = Math.min(start + state.pageSize, total);
  const pageData = data.slice(start, end);

  const visibleFields = state.fields.filter(f => state.fieldConfig[f.path]?.visible);

  const head = $('#resultsHead');
  const body = $('#resultsBody');

  if (visibleFields.length === 0) {
    head.innerHTML = '<tr><th>No columns selected</th></tr>';
    body.innerHTML = '<tr class="empty-row"><td>Tap "Columns" to choose what to display.</td></tr>';
  } else {
    head.innerHTML = '<tr>' + visibleFields.map(f => {
      const sortClass = state.sort && state.sort.path === f.path
        ? (state.sort.dir === 'asc' ? 'sort-asc' : 'sort-desc') : '';
      return `<th class="${sortClass}" data-path="${escHtml(f.path)}" title="${escHtml(f.path)}">${escHtml(f.path)}</th>`;
    }).join('') + '</tr>';

    if (total === 0) {
      body.innerHTML = `<tr class="empty-row"><td colspan="${visibleFields.length}">No matching records.</td></tr>`;
    } else {
      body.innerHTML = pageData.map((rec, i) => {
        const cells = visibleFields.map(f => {
          const v = formatFieldValue(getFieldValues(rec, f));
          return `<td title="${escHtml(v)}">${escHtml(v)}</td>`;
        }).join('');
        return `<tr data-idx="${start + i}">${cells}</tr>`;
      }).join('');
    }
  }

  $('#resultSummary').textContent = total === 0
    ? 'No matching records'
    : `Showing ${start + 1}–${end} of ${total}`;
  $('#pageIndicator').textContent = total === 0 ? '' : `Page ${state.page + 1} of ${maxPage + 1}`;

  $('#btnFirst').disabled = state.page <= 0;
  $('#btnPrev').disabled = state.page <= 0;
  $('#btnNext').disabled = state.page >= maxPage;
  $('#btnLast').disabled = state.page >= maxPage;
}

// ---------- Columns popover ----------

function openColumnsPopover() {
  const list = $('#columnsList');
  list.innerHTML = state.fields.map(f => {
    const cfg = state.fieldConfig[f.path];
    const p = escHtml(f.path);
    return `<label class="column-item">
      <input type="checkbox" data-path="${p}" ${cfg.visible ? 'checked' : ''}>
      <span class="field-path">${p}</span>
    </label>`;
  }).join('');
  list.onchange = e => {
    const t = e.target;
    if (t.type !== 'checkbox') return;
    const path = t.dataset.path;
    if (!state.fieldConfig[path]) return;
    state.fieldConfig[path].visible = t.checked;
    const row = document.querySelector(`#fieldList input[data-path="${CSS.escape(path)}"][data-key="visible"]`);
    if (row) row.checked = t.checked;
    renderResults();
  };
  $('#columnsPopover').classList.remove('hidden');
}

// ---------- Record popover ----------

function openRecordPopover(record) {
  $('#recordJson').textContent = JSON.stringify(record, null, 2);
  $('#recordPopover').classList.remove('hidden');
}

// ---------- Wire controls ----------

function setupViewerControls() {
  $('#searchInput').addEventListener('input', debounce(e => {
    state.search = e.target.value;
    state.page = 0;
    invalidateAndRender();
  }, 150));

  $('#btnToggleConfig').addEventListener('click', () => {
    $('#configPanel').classList.toggle('hidden');
  });
  $('#btnToggleFilters').addEventListener('click', () => {
    $('#filterPanel').classList.toggle('hidden');
  });
  $('#btnClear').addEventListener('click', () => {
    state.search = '';
    state.filters = {};
    state.sort = null;
    state.page = 0;
    $('#searchInput').value = '';
    renderFilters();
    invalidateAndRender();
  });

  $('#pageSizeSelect').addEventListener('change', e => {
    state.pageSize = Number(e.target.value) || 20;
    state.page = 0;
    renderResults();
  });

  $('#btnColumns').addEventListener('click', openColumnsPopover);
  $('#btnCloseColumns').addEventListener('click', () => $('#columnsPopover').classList.add('hidden'));
  $('#columnsPopover').addEventListener('click', e => {
    if (e.target.id === 'columnsPopover') $('#columnsPopover').classList.add('hidden');
  });

  $('#btnCloseRecord').addEventListener('click', () => $('#recordPopover').classList.add('hidden'));
  $('#recordPopover').addEventListener('click', e => {
    if (e.target.id === 'recordPopover') $('#recordPopover').classList.add('hidden');
  });

  $('#btnFirst').addEventListener('click', () => { state.page = 0; renderResults(); });
  $('#btnPrev').addEventListener('click', () => { if (state.page > 0) { state.page--; renderResults(); } });
  $('#btnNext').addEventListener('click', () => { state.page++; renderResults(); });
  $('#btnLast').addEventListener('click', () => {
    const data = getFiltered();
    const maxPage = Math.max(0, Math.ceil(data.length / state.pageSize) - 1);
    state.page = maxPage;
    renderResults();
  });

  $('#resultsHead').addEventListener('click', e => {
    const th = e.target.closest('th');
    if (!th || !th.dataset.path) return;
    const path = th.dataset.path;
    if (state.sort && state.sort.path === path) {
      if (state.sort.dir === 'asc') state.sort.dir = 'desc';
      else state.sort = null;
    } else {
      state.sort = { path, dir: 'asc' };
    }
    invalidateAndRender();
  });

  $('#resultsBody').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-idx]');
    if (!tr) return;
    const idx = Number(tr.dataset.idx);
    const data = getFiltered();
    const rec = data[idx];
    if (rec) openRecordPopover(rec);
  });

  $('#btnSelectAllVisible').addEventListener('click', () => {
    for (const f of state.fields) state.fieldConfig[f.path].visible = true;
    renderFieldConfig();
    renderResults();
  });
  $('#btnSelectNoneVisible').addEventListener('click', () => {
    for (const f of state.fields) state.fieldConfig[f.path].visible = false;
    renderFieldConfig();
    renderResults();
  });
}

function setupThemeToggle() {
  const btn = $('#btnTheme');
  const meta = document.getElementById('themeColorMeta');
  const apply = (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch (e) {}
    btn.textContent = theme === 'dark' ? 'Light' : 'Dark';
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f1419' : '#f4f6fa');
  };
  apply(document.documentElement.getAttribute('data-theme') || 'dark');
  btn.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    apply(cur === 'dark' ? 'light' : 'dark');
  });
}

setupLoadScreen();
setupViewerControls();
setupThemeToggle();

})();
