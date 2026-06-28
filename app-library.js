// ==================== LIBRARY / EXERCISE BROWSER ====================
// Modes: 'browse' (Library tab) | 'select' (Plan/Logger modals)

// ── Browser State ──────────────────────────────────────────────────
let libBrowserMode = 'browse'; // 'browse' | 'select'
let libSelectCallback = null;  // fn(exId) called on selection in select mode

// Persistent session state (reset when session ends, per spec)
let libState = {
  activeCategories: [],   // [] = ALL
  movementStructure: '',  // '' | 'Compound' | 'Isolation'
  executionStyle:    '',  // '' | 'Bilateral' | 'Unilateral'
  displaySystem:  true,
  displayCustom:  true,
  sort: 'alpha',          // 'alpha' | 'recent' — persisted across sessions
  search: '',
};

function libResetSessionState() {
  libState.activeCategories  = [];
  libState.movementStructure = '';
  libState.executionStyle    = '';
  libState.displaySystem     = true;
  libState.displayCustom     = true;
  libState.search            = '';
  // sort is intentionally NOT reset
}

// ── Filter Pipeline ────────────────────────────────────────────────
function libFilteredExercises() {
  let pool = getAllExercises();

  // In Library browse mode, hide Cardio/Full Body/Other
  const HIDDEN_CATS = ['Cardio', 'Full Body', 'Other'];

  // 1. Display filter (system / custom)
  pool = pool.filter(ex => {
    if (ex.custom) return libState.displayCustom;
    return libState.displaySystem;
  });

  // 2. Hide Cardio/Full Body/Other in browse mode
  if (libBrowserMode === 'browse') {
    pool = pool.filter(ex => {
      const cats = getExCategories(ex);
      return !cats.every(c => HIDDEN_CATS.includes(c));
    });
  }

  // 3. Category filter (OR logic)
  if (libState.activeCategories.length > 0) {
    pool = pool.filter(ex => {
      const cats = getExCategories(ex);
      return libState.activeCategories.some(ac => cats.includes(ac));
    });
  }

  // 4. Movement structure filter (AND)
  if (libState.movementStructure) {
    pool = pool.filter(ex => getExMovementStructure(ex) === libState.movementStructure);
  }

  // 5. Execution style filter (AND)
  if (libState.executionStyle) {
    pool = pool.filter(ex => getExExecutionStyle(ex) === libState.executionStyle);
  }

  // 6. Text search
  if (libState.search.trim()) {
    const q = libState.search.trim().toLowerCase();
    pool = pool.filter(ex => ex.name.toLowerCase().includes(q));
  }

  // 7. Sort
  if (libState.sort === 'alpha') {
    pool.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    pool.sort((a, b) => (getLastUsed(b.id) || 0) - (getLastUsed(a.id) || 0));
  }

  return pool;
}

// ── Open Library (Browse Mode) ─────────────────────────────────────
function renderDB() {
  libBrowserMode = 'browse';
  libSelectCallback = null;
  renderLibraryPage();
}

function renderLibraryPage() {
  const page = document.getElementById('page-db');
  if (!page) return;
  page.innerHTML = buildLibraryPageHTML();
  bindLibraryEvents();
  renderExerciseList();
}

function buildLibraryPageHTML() {
  return `
    <div class="lib-header">
      <div class="page-title-zone-title">Exercises</div>
      <div style="display:flex;gap:8px;align-items:center">
        ${libBrowserMode === 'browse' ? `<button class="btn btn-primary btn-sm" onclick="openCreateCustomExercise()">+ Custom</button>` : ''}
        <button class="btn-icon lib-menu-btn" onclick="openLibMenuDropdown(event)" title="Options">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/></svg>
        </button>
      </div>
    </div>

    <!-- Category Chips -->
    <div class="lib-chips-wrap" id="lib-chips"></div>

    <!-- Filters Row -->
    <div class="lib-filters-row" id="lib-filters-row">
      <button class="lib-toggle-btn ${libState.movementStructure === 'Compound' ? 'active' : ''}"
        onclick="libToggleMovement('Compound')">COMPOUND</button>
      <button class="lib-toggle-btn ${libState.movementStructure === 'Isolation' ? 'active' : ''}"
        onclick="libToggleMovement('Isolation')">ISOLATION</button>
      <div class="lib-filter-sep"></div>
      <button class="lib-toggle-btn ${libState.executionStyle === 'Bilateral' ? 'active' : ''}"
        onclick="libToggleExecution('Bilateral')">BILATERAL</button>
      <button class="lib-toggle-btn ${libState.executionStyle === 'Unilateral' ? 'active' : ''}"
        onclick="libToggleExecution('Unilateral')">UNILATERAL</button>
    </div>

    <!-- Search -->
    <div class="lib-search-wrap">
      <svg class="lib-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="text" class="lib-search-input" id="lib-search" placeholder="Search exercises..."
        value="${escapeHtml(libState.search)}" oninput="libOnSearch(this.value)">
    </div>

    <!-- Sort + Count row -->
    <div class="lib-sort-row">
      <span class="lib-count" id="lib-count"></span>
      <select class="lib-sort-select" id="lib-sort" onchange="libOnSort(this.value)">
        <option value="alpha" ${libState.sort === 'alpha' ? 'selected' : ''}>A – Z</option>
        <option value="recent" ${libState.sort === 'recent' ? 'selected' : ''}>Recently Used</option>
      </select>
    </div>

    <!-- Exercise List -->
    <div id="lib-list"></div>

    ${libBrowserMode === 'select' ? `
    <div class="lib-footer-actions">
      <button class="btn btn-ghost" onclick="openCreateCustomExercise()">+ Create Custom</button>
      <button class="btn btn-ghost" onclick="libRandomize()">🎲 Randomize</button>
    </div>` : ''}
  `;
}

function bindLibraryEvents() {
  renderLibChips();
}

// ── Category Chips ─────────────────────────────────────────────────
function renderLibChips() {
  const el = document.getElementById('lib-chips');
  if (!el) return;
  const allActive = libState.activeCategories.length === 0;
  let html = `<button class="lib-chip ${allActive ? 'active' : ''}" onclick="libChipAll()">ALL</button>`;
  LIBRARY_CATEGORIES.forEach(cat => {
    const active = libState.activeCategories.includes(cat);
    html += `<button class="lib-chip ${active ? 'active' : ''}" onclick="libChipToggle('${cat}')">${CATEGORY_ABBREV[cat]}</button>`;
  });
  el.innerHTML = html;
}

function libChipAll() {
  libState.activeCategories = [];
  renderLibChips();
  renderExerciseList();
}

function libChipToggle(cat) {
  const idx = libState.activeCategories.indexOf(cat);
  if (idx === -1) {
    libState.activeCategories.push(cat);
  } else {
    libState.activeCategories.splice(idx, 1);
  }
  // If all deselected, behaves as ALL
  renderLibChips();
  renderExerciseList();
}

function libToggleMovement(val) {
  libState.movementStructure = libState.movementStructure === val ? '' : val;
  renderLibraryPage();
}

function libToggleExecution(val) {
  libState.executionStyle = libState.executionStyle === val ? '' : val;
  renderLibraryPage();
}

function libOnSearch(val) {
  libState.search = val;
  renderExerciseList();
}

function libOnSort(val) {
  libState.sort = val;
  renderExerciseList();
}

// ── Exercise List ──────────────────────────────────────────────────
function renderExerciseList() {
  const listEl = document.getElementById('lib-list');
  const countEl = document.getElementById('lib-count');
  if (!listEl) return;

  const exs = libFilteredExercises();
  if (countEl) countEl.textContent = `${exs.length} exercise${exs.length !== 1 ? 's' : ''}`;

  if (!exs.length) {
    const hasSearch = libState.search.trim().length > 0;
    listEl.innerHTML = `
      <div class="lib-empty">
        <div class="lib-empty-text">No Exercises Found</div>
        ${hasSearch ? `<button class="btn btn-ghost btn-sm" onclick="libClearSearch()">Clear Search</button>` : ''}
      </div>`;
    return;
  }

  listEl.innerHTML = exs.map(ex => buildExerciseRow(ex)).join('');
}

function libClearSearch() {
  libState.search = '';
  const inp = document.getElementById('lib-search');
  if (inp) inp.value = '';
  renderExerciseList();
}

function buildExerciseRow(ex) {
  const cats = sortCategories(getExCategories(ex));
  const visibleCats = cats.filter(c => CATEGORY_ABBREV[c]);
  const badgesHtml = visibleCats.map(c =>
    `<span class="ex-row-cat-badge">${CATEGORY_ABBREV[c]}</span>`
  ).join('');
  const customBadge = ex.custom ? `<span class="ex-row-custom-badge">Custom</span>` : '';

  if (libBrowserMode === 'browse') {
    // Tap row → Profile
    return `
      <div class="ex-row" onclick="openExerciseProfile('${ex.id}')">
        <div class="ex-row-main">
          <div class="ex-row-name">${escapeHtml(ex.name)}</div>
          <div class="ex-row-badges">${badgesHtml}${customBadge}</div>
        </div>
      </div>`;
  } else {
    // Select mode: tap row → select, ⓘ → profile
    return `
      <div class="ex-row ex-row-select" onclick="libSelectExercise('${ex.id}')">
        <div class="ex-row-main" style="padding-right:40px">
          <div class="ex-row-name">${escapeHtml(ex.name)}</div>
          <div class="ex-row-badges">${badgesHtml}${customBadge}</div>
        </div>
        <button class="ex-row-info-btn" onclick="event.stopPropagation();openExerciseProfile('${ex.id}')" title="View profile">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="8.5" stroke-width="2.5"/><line x1="12" y1="11" x2="12" y2="16"/></svg>
        </button>
      </div>`;
  }
}

// ── Library ··· menu ───────────────────────────────────────────────
function openLibMenuDropdown(e) {
  e.stopPropagation();
  const items = [
    { label: 'Sort: A – Z',        icon: '', action: `libSetSort('alpha')`,  toggle: libState.sort === 'alpha' ? '✓ ' : '' },
    { label: 'Sort: Recently Used',icon: '', action: `libSetSort('recent')`, toggle: libState.sort === 'recent' ? '✓ ' : '' },
    { divider: true },
    { label: 'Display: System',    icon: '', action: `libToggleDisplay('system')`,  toggle: libState.displaySystem ? '✓ ' : '' },
    { label: 'Display: Custom',    icon: '', action: `libToggleDisplay('custom')`,  toggle: libState.displayCustom ? '✓ ' : '' },
    { divider: true },
    { label: 'Reset Filters', icon: '↺', action: `libResetFilters()` },
  ];
  showDropdown(e.currentTarget, items);
}

function libSetSort(val) {
  libState.sort = val;
  const sel = document.getElementById('lib-sort');
  if (sel) sel.value = val;
  renderExerciseList();
}

function libToggleDisplay(type) {
  if (type === 'system') libState.displaySystem = !libState.displaySystem;
  else libState.displayCustom = !libState.displayCustom;
  renderExerciseList();
}

function libResetFilters() {
  libState.activeCategories  = [];
  libState.movementStructure = '';
  libState.executionStyle    = '';
  libState.displaySystem     = true;
  libState.displayCustom     = true;
  libState.search            = '';
  renderLibraryPage();
}

// ── Select Mode (Plan / Logger) ────────────────────────────────────
let libLastRandomId = null;

function openExBrowserSelect(callback, context) {
  // context: 'logger' | 'plan' | 'change'
  libBrowserMode = 'select';
  libSelectCallback = callback;
  // Session state retained; reset only on session end
  renderLibraryPage();
  openModal('modal-ex-browser');
}

function libSelectExercise(exId) {
  if (libSelectCallback) libSelectCallback(exId);
  closeModal('modal-ex-browser');
}

function libRandomize() {
  const pool = libFilteredExercises().filter(ex => ex.id !== libLastRandomId);
  const src  = pool.length ? pool : libFilteredExercises();
  if (!src.length) { showToast('No exercises match current filters', 'error'); return; }
  const picked = src[Math.floor(Math.random() * src.length)];
  libLastRandomId = picked.id;
  showRandomConfirmLib(picked);
}

function showRandomConfirmLib(ex) {
  const listEl = document.getElementById('lib-list');
  const countEl = document.getElementById('lib-count');
  if (countEl) countEl.textContent = '';
  if (!listEl) return;
  const cats = sortCategories(getExCategories(ex)).filter(c => CATEGORY_ABBREV[c]);
  const badgesHtml = cats.map(c => `<span class="ex-row-cat-badge">${CATEGORY_ABBREV[c]}</span>`).join('');
  const customBadge = ex.custom ? `<span class="ex-row-custom-badge">Custom</span>` : '';
  listEl.innerHTML = `
    <div class="lib-random-confirm">
      <div class="lib-random-label">Selected</div>
      <div class="lib-random-name">${escapeHtml(ex.name)}</div>
      <div class="lib-random-badges">${badgesHtml}${customBadge}</div>
      <div class="lib-random-btns">
        <button class="btn btn-primary" onclick="libAcceptRandom('${ex.id}')">Accept</button>
        <button class="btn btn-ghost" onclick="libRandomize()">🎲 Re-Roll</button>
      </div>
    </div>`;
}

function libAcceptRandom(exId) {
  libLastRandomId = null;
  libSelectExercise(exId);
}

// ── Open Exercise Browser Modals (replaces old openAddExerciseModal etc.) ──
function openAddExerciseModal() {
  openExBrowserSelect(exId => {
    addExToWorkout(exId);
  }, 'logger');
}

function openChangeExModal(exIdx) {
  changeExTargetIdx = exIdx;
  openExBrowserSelect(exId => {
    confirmChangeExercise(exId);
  }, 'change');
}

function openCustomExFromLogger() {
  closeModal('modal-ex-browser');
  openCreateCustomExercise('logger');
}

function openCustomExFromChanger() {
  closeModal('modal-ex-browser');
  openCreateCustomExercise('change');
}

function openCustomExFromSessionPicker() {
  closeModal('modal-ex-browser');
  openCreateCustomExercise('plan');
}

// Session picker in Plan now uses unified browser
function renderSessionPicker() {
  openExBrowserSelect(exId => {
    addExToSession(exId);
    closeModal('modal-ex-browser');
    // Re-open session modal after selection
    renderSessionView();
    openModal('modal-session');
  }, 'plan');
}

// ==================== EXERCISE PROFILE ====================

let profileExId = null;
let profileChart = null;

function openExerciseProfile(exId) {
  profileExId = exId;
  const ex = getExercise(exId);
  if (!ex) return;
  renderProfilePage(ex);
  openModal('modal-ex-profile');
}

function renderProfilePage(ex) {
  const modal = document.getElementById('modal-ex-profile');
  if (!modal) return;

  const cats = sortCategories(getExCategories(ex));
  const ms   = getExMovementStructure(ex);
  const es   = getExExecutionStyle(ex);
  const note = getExNote(ex.id);
  const refs  = getExVideos(ex.id);
  const lastUsed = getLastUsed(ex.id);
  const lastUsedStr = lastUsed
    ? new Date(lastUsed).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
    : 'Never';

  // Stats
  const currentE1RM = getBest1RM(ex.id, null);
  const pr1  = getBestNRM(ex.id, 1)  || getBestWeight(ex.id, null) || null;
  const pr5  = getBestNRM(ex.id, 5)  || null;
  const pr10 = getBestNRM(ex.id, 10) || null;
  const e1rmHistory = getE1RMHistory(ex.id);
  const hasGraph = e1rmHistory.length >= 3;

  const badgesHtml = cats
    .filter(c => CATEGORY_ABBREV[c])
    .map(c => `<span class="prof-cat-badge">${CATEGORY_ABBREV[c]}</span>`)
    .join('');

  const metaStr = [ms, es].filter(Boolean).join(' • ');

  const notesContent = note
    ? `<div class="prof-notes-text">${escapeHtml(note).replace(/\n/g,'<br>')}</div>`
    : `<div class="prof-empty-state">No notes added</div>`;

  let refsHtml = '';
  if (refs.length === 0) {
    refsHtml = `<div class="prof-empty-state">No references added</div>`;
  } else {
    refsHtml = refs.map(url => `
      <a class="prof-ref-row" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="flex-shrink:0"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        <span class="prof-ref-url">${escapeHtml(url)}</span>
      </a>`).join('');
  }

  const exrxUrl = EXRX_LINKS[ex.id];

  document.getElementById('modal-ex-profile-body').innerHTML = `
    <!-- Header -->
    <div class="prof-header">
      <div class="prof-header-top">
        <div class="prof-name">${escapeHtml(ex.name)}</div>
        <div class="prof-last-used">Last used: ${lastUsedStr}</div>
      </div>
      <div class="prof-badges-row">${badgesHtml}</div>
      ${metaStr ? `<div class="prof-meta-row">${metaStr}</div>` : ''}
    </div>

    <div class="prof-divider"></div>

    <!-- Performance -->
    <div class="prof-section">
      <div class="prof-e1rm-block">
        <div class="prof-e1rm-label">Current E1RM</div>
        <div class="prof-e1rm-value">${currentE1RM ? Math.round(currentE1RM) + ' ' + appDb.unit : '—'}</div>
      </div>

      <div class="prof-prs">
        <div class="prof-pr-label">PR's</div>
        <div class="prof-pr-table">
          <div class="prof-pr-row"><span class="prof-pr-key">1RM</span><span class="prof-pr-val">${pr1 ? pr1 + ' ' + appDb.unit : '—'}</span></div>
          <div class="prof-pr-row"><span class="prof-pr-key">5RM</span><span class="prof-pr-val">${pr5 ? pr5 + ' ' + appDb.unit : '—'}</span></div>
          <div class="prof-pr-row"><span class="prof-pr-key">10RM</span><span class="prof-pr-val">${pr10 ? pr10 + ' ' + appDb.unit : '—'}</span></div>
        </div>
      </div>

      ${hasGraph ? `
      <div class="prof-graph-section">
        <div class="prof-section-label">Progress</div>
        <div class="prof-graph-wrap">
          <canvas id="e1rm-chart" height="160"></canvas>
        </div>
      </div>` : ''}
    </div>

    <div class="prof-divider"></div>

    <!-- Notes -->
    <div class="prof-section">
      <div class="prof-section-label">Notes</div>
      ${notesContent}
    </div>

    <div class="prof-divider"></div>

    <!-- References -->
    <div class="prof-section">
      <div class="prof-section-label">References</div>
      ${exrxUrl ? `
        <a class="prof-ref-row" href="${exrxUrl}" target="_blank" rel="noopener noreferrer">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="flex-shrink:0"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          <span class="prof-ref-url">ExRx.net — ${escapeHtml(ex.name)}</span>
        </a>` : ''}
      ${refsHtml}
    </div>
  `;

  // Render Chart.js graph if data available
  if (hasGraph) {
    setTimeout(() => renderE1RMChart(e1rmHistory), 50);
  }
}

function renderE1RMChart(history) {
  const canvas = document.getElementById('e1rm-chart');
  if (!canvas) return;
  if (profileChart) { profileChart.destroy(); profileChart = null; }

  const values = history.map(p => p.value);
  const labels = history.map(p => new Date(p.date).toLocaleDateString('en-US', { month:'short', day:'numeric' }));

  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const pad = (maxVal - minVal) * 0.1 || 10;
  const rawMin = minVal - pad;
  const rawMax = maxVal + pad;

  // Round to standard plate increments
  const inc = appDb.unit === 'kg' ? 2.5 : 5;
  const yMin = Math.floor(rawMin / inc) * inc;
  const yMax = Math.ceil(rawMax / inc) * inc;

  profileChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: '#ffffff',
        borderWidth: 2,
        pointBackgroundColor: '#ff6a00',
        pointBorderColor: '#ff6a00',
        pointRadius: 5,
        pointHoverRadius: 7,
        tension: 0.3,
        fill: false,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#16161a',
          borderColor: '#2e2e38',
          borderWidth: 1,
          titleColor: '#888899',
          bodyColor: '#ff6a00',
          bodyFont: { family: "'Barlow Condensed', sans-serif", size: 14, weight: '700' },
          callbacks: {
            label: ctx => `${Math.round(ctx.parsed.y)} ${appDb.unit}`
          }
        }
      },
      scales: {
        x: {
          grid: { color: '#26262e' },
          ticks: { color: '#888899', font: { family: "'Barlow Condensed', sans-serif", size: 11 }, maxRotation: 0 }
        },
        y: {
          min: yMin,
          max: yMax,
          grid: { color: '#26262e' },
          ticks: {
            color: '#888899',
            font: { family: "'Barlow Condensed', sans-serif", size: 11 },
            stepSize: inc,
            callback: v => v + ' ' + appDb.unit
          }
        }
      }
    }
  });
}

// Profile ··· menu
function openProfileMenu(exId) {
  const ex = getExercise(exId);
  if (!ex) return;
  const items = [
    { label: 'Edit Exercise', icon: '✎', action: `openEditExercise('${exId}')` },
  ];
  showDropdown(document.getElementById('prof-menu-btn'), items);
}

// ==================== EDIT EXERCISE SCREEN ====================

let editExId = null;
let editExTempRefs = [];

function openEditExercise(exId) {
  editExId = exId;
  const ex = getExercise(exId);
  if (!ex) return;

  editExTempRefs = [...getExVideos(exId)];

  // Get current (possibly overridden) values
  const cats = getExCategories(ex);
  const ms   = getExMovementStructure(ex);
  const es   = getExExecutionStyle(ex);
  const note = getExNote(exId);

  renderEditExPage(ex, cats, ms, es, note);
  openModal('modal-edit-exercise');
}

function renderEditExPage(ex, currentCats, currentMS, currentES, currentNote) {
  const isCustom = ex.custom;
  const refs = editExTempRefs;

  // Category checkboxes
  const catChecks = LIBRARY_CATEGORIES.map(cat => `
    <label class="edit-check-row">
      <input type="checkbox" class="edit-cat-check" value="${cat}" ${currentCats.includes(cat) ? 'checked' : ''}>
      <span>${CATEGORY_ABBREV[cat]} <span style="color:var(--text3);font-size:12px">(${cat})</span></span>
    </label>`).join('');

  const refsHtml = refs.length
    ? refs.map((url, i) => `
        <div class="edit-ref-row">
          <span class="edit-ref-url">${escapeHtml(url)}</span>
          <button class="btn-icon btn-sm" style="color:var(--red);border-color:rgba(255,71,87,0.4);flex-shrink:0" onclick="editRemoveRef(${i})">✕</button>
        </div>`).join('')
    : '';

  document.getElementById('modal-edit-exercise-body').innerHTML = `
    <!-- Identity -->
    <div class="edit-section-label">Identity</div>

    <div class="edit-group">
      <div class="edit-field-label">Categories</div>
      <div class="edit-cat-grid">${catChecks}</div>
    </div>

    <div class="edit-group">
      <div class="edit-field-label">Movement Structure</div>
      <div class="edit-radio-row">
        <label class="edit-radio-label">
          <input type="radio" name="edit-ms" value="Compound" ${currentMS === 'Compound' ? 'checked' : ''}> Compound
        </label>
        <label class="edit-radio-label">
          <input type="radio" name="edit-ms" value="Isolation" ${currentMS === 'Isolation' ? 'checked' : ''}> Isolation
        </label>
      </div>
    </div>

    <div class="edit-group">
      <div class="edit-field-label">Execution Style</div>
      <div class="edit-radio-row">
        <label class="edit-radio-label">
          <input type="radio" name="edit-es" value="Bilateral" ${currentES === 'Bilateral' ? 'checked' : ''}> Bilateral
        </label>
        <label class="edit-radio-label">
          <input type="radio" name="edit-es" value="Unilateral" ${currentES === 'Unilateral' ? 'checked' : ''}> Unilateral
        </label>
      </div>
    </div>

    <div class="edit-divider"></div>

    <!-- Knowledge -->
    <div class="edit-section-label">Knowledge</div>

    <div class="edit-group">
      <div class="edit-field-label">Notes</div>
      <textarea class="edit-textarea" id="edit-notes" placeholder="Setup cues, notes...">${escapeHtml(currentNote)}</textarea>
    </div>

    <div class="edit-group">
      <div class="edit-field-label">References <span style="color:var(--text3);font-weight:400;font-size:12px">(max 20)</span></div>
      <div id="edit-refs-list">${refsHtml}</div>
      ${refs.length < 20 ? `
      <div class="edit-ref-add-row">
        <input type="text" class="edit-ref-input" id="edit-ref-input" placeholder="Paste URL...">
        <button class="btn btn-ghost btn-sm" onclick="editAddRef()">+ Add</button>
      </div>` : ''}
    </div>

    ${isCustom ? `
    <div class="edit-divider"></div>

    <!-- Custom Only -->
    <div class="edit-section-label">Custom Exercise</div>

    <div class="edit-group">
      <div class="edit-field-label">Name</div>
      <input type="text" class="edit-text-input" id="edit-name" value="${escapeHtml(ex.name)}">
    </div>

    <div class="edit-group">
      <div class="edit-field-label">Tracking Type</div>
      <select class="edit-select" id="edit-tracking">
        <option value="weight_reps" ${ex.tracking==='weight_reps'?'selected':''}>Weight + Reps</option>
        <option value="weight_time" ${ex.tracking==='weight_time'?'selected':''}>Weight + Time</option>
        <option value="bodyweight_reps" ${ex.tracking==='bodyweight_reps'?'selected':''}>Bodyweight + Reps</option>
        <option value="time" ${ex.tracking==='time'?'selected':''}>Time Only</option>
      </select>
    </div>

    <div style="margin-top:24px;padding-top:16px;border-top:1px solid var(--border)">
      <button class="btn btn-danger" style="width:100%" onclick="deleteCustomExFromProfile('${ex.id}')">Delete Exercise</button>
    </div>` : ''}

    <div style="height:16px"></div>
  `;
}

function editAddRef() {
  const inp = document.getElementById('edit-ref-input');
  if (!inp) return;
  const url = inp.value.trim();
  if (!url) { showToast('Paste a URL first', 'error'); return; }
  if (editExTempRefs.length >= 20) { showToast('Maximum 20 references', 'error'); return; }
  editExTempRefs.push(url);
  inp.value = '';
  const ex = getExercise(editExId);
  const cats = getSelectedEditCats();
  const ms   = document.querySelector('input[name="edit-ms"]:checked')?.value || '';
  const es   = document.querySelector('input[name="edit-es"]:checked')?.value || '';
  const note = document.getElementById('edit-notes')?.value || '';
  renderEditExPage(ex, cats, ms, es, note);
}

function editRemoveRef(idx) {
  editExTempRefs.splice(idx, 1);
  const ex = getExercise(editExId);
  const cats = getSelectedEditCats();
  const ms   = document.querySelector('input[name="edit-ms"]:checked')?.value || '';
  const es   = document.querySelector('input[name="edit-es"]:checked')?.value || '';
  const note = document.getElementById('edit-notes')?.value || '';
  renderEditExPage(ex, cats, ms, es, note);
}

function getSelectedEditCats() {
  return [...document.querySelectorAll('.edit-cat-check:checked')].map(el => el.value);
}

function saveEditExercise() {
  const ex = getExercise(editExId);
  if (!ex) return;

  const cats = getSelectedEditCats();
  const ms   = document.querySelector('input[name="edit-ms"]:checked')?.value || ex.movementStructure || '';
  const es   = document.querySelector('input[name="edit-es"]:checked')?.value || ex.executionStyle || '';
  const note = (document.getElementById('edit-notes')?.value || '').trim();
  const refs = [...editExTempRefs];

  if (cats.length === 0) { showToast('Select at least one category', 'error'); return; }

  if (ex.custom) {
    // Custom: save directly to exercise record
    const nameEl = document.getElementById('edit-name');
    const trackEl = document.getElementById('edit-tracking');
    if (nameEl && !nameEl.value.trim()) { showToast('Enter an exercise name', 'error'); return; }
    if (nameEl) ex.name = nameEl.value.trim();
    if (trackEl) ex.tracking = trackEl.value;
    ex.categories        = cats;
    ex.movementStructure = ms;
    ex.executionStyle    = es;
    ex.notes             = note;
    ex.videos            = refs;
    fsSaveCustomEx(ex);
  } else {
    // System: save notes/refs to existing tables; save category/type overrides to user overrides
    saveExNote(editExId, note);
    saveExVideos(editExId, refs);

    // Check if any overrides differ from defaults
    const defaultEx = DEFAULT_EXERCISES.find(d => d.id === editExId);
    const defaultCats = defaultEx?.categories || [defaultEx?.bodypart || ''];
    const catsChanged = JSON.stringify(sortCategories(cats)) !== JSON.stringify(sortCategories(defaultCats));
    const msChanged   = ms !== (defaultEx?.movementStructure || '');
    const esChanged   = es !== (defaultEx?.executionStyle || '');

    if (catsChanged || msChanged || esChanged) {
      if (!appDb.exOverrides) appDb.exOverrides = {};
      appDb.exOverrides[editExId] = { categories: cats, movementStructure: ms, executionStyle: es };
      fsSaveExOverride(editExId, appDb.exOverrides[editExId]);
    }
  }

  closeModal('modal-edit-exercise');
  showToast('Saved', 'success');

  // Refresh profile if open
  if (profileExId === editExId) {
    const updatedEx = getExercise(editExId);
    if (updatedEx) renderProfilePage(updatedEx);
  }

  // Refresh library list
  renderExerciseList();
}

function deleteCustomExFromProfile(exId) {
  confirm2('Delete Exercise', 'Remove this custom exercise?', () => {
    appDb.customExercises = appDb.customExercises.filter(e => e.id !== exId);
    fsDelCustomEx(exId);
    closeModal('modal-edit-exercise');
    closeModal('modal-ex-profile');
    renderExerciseList();
    showToast('Exercise deleted', 'success');
  }, 'Delete');
}

// ==================== CUSTOM EXERCISE CREATE ====================
// Unified create-custom form (replaces old multi-modal approach)

let createCustomContext = null; // 'browse' | 'logger' | 'plan' | 'change'
let createCustomTempRefs = [];

function openCreateCustomExercise(context) {
  createCustomContext = context || 'browse';
  createCustomTempRefs = [];
  renderCreateCustomForm();
  openModal('modal-create-custom');
}

function renderCreateCustomForm() {
  document.getElementById('modal-create-custom-body').innerHTML = `
    <div class="edit-group">
      <div class="edit-field-label">Name</div>
      <input type="text" class="edit-text-input" id="create-name" placeholder="e.g. Hack Squat Machine">
    </div>

    <div class="edit-group">
      <div class="edit-field-label">Categories</div>
      <div class="edit-cat-grid">
        ${LIBRARY_CATEGORIES.map(cat => `
          <label class="edit-check-row">
            <input type="checkbox" class="create-cat-check" value="${cat}">
            <span>${CATEGORY_ABBREV[cat]} <span style="color:var(--text3);font-size:12px">(${cat})</span></span>
          </label>`).join('')}
      </div>
    </div>

    <div class="edit-group">
      <div class="edit-field-label">Movement Structure</div>
      <div class="edit-radio-row">
        <label class="edit-radio-label"><input type="radio" name="create-ms" value="Compound"> Compound</label>
        <label class="edit-radio-label"><input type="radio" name="create-ms" value="Isolation"> Isolation</label>
      </div>
    </div>

    <div class="edit-group">
      <div class="edit-field-label">Execution Style</div>
      <div class="edit-radio-row">
        <label class="edit-radio-label"><input type="radio" name="create-es" value="Bilateral" checked> Bilateral</label>
        <label class="edit-radio-label"><input type="radio" name="create-es" value="Unilateral"> Unilateral</label>
      </div>
    </div>

    <div class="edit-group">
      <div class="edit-field-label">Tracking Type</div>
      <select class="edit-select" id="create-tracking">
        <option value="weight_reps">Weight + Reps</option>
        <option value="weight_time">Weight + Time</option>
        <option value="bodyweight_reps">Bodyweight + Reps</option>
        <option value="time">Time Only</option>
      </select>
    </div>

    <div class="edit-group">
      <div class="edit-field-label">Notes <span style="color:var(--text3);font-weight:400">(optional)</span></div>
      <textarea class="edit-textarea" id="create-notes" placeholder="Setup cues, notes..."></textarea>
    </div>

    <div class="edit-group">
      <div class="edit-field-label">References <span style="color:var(--text3);font-weight:400">(optional)</span></div>
      <div id="create-refs-list"></div>
      <div class="edit-ref-add-row">
        <input type="text" class="edit-ref-input" id="create-ref-input" placeholder="Paste URL...">
        <button class="btn btn-ghost btn-sm" onclick="createAddRef()">+ Add</button>
      </div>
    </div>

    <div style="height:8px"></div>
  `;
}

function createAddRef() {
  const inp = document.getElementById('create-ref-input');
  if (!inp) return;
  const url = inp.value.trim();
  if (!url) return;
  if (createCustomTempRefs.length >= 20) { showToast('Maximum 20 references', 'error'); return; }
  createCustomTempRefs.push(url);
  inp.value = '';
  const refsEl = document.getElementById('create-refs-list');
  if (refsEl) {
    refsEl.innerHTML = createCustomTempRefs.map((u, i) => `
      <div class="edit-ref-row">
        <span class="edit-ref-url">${escapeHtml(u)}</span>
        <button class="btn-icon btn-sm" style="color:var(--red);border-color:rgba(255,71,87,0.4);flex-shrink:0" onclick="createRemoveRef(${i})">✕</button>
      </div>`).join('');
  }
}

function createRemoveRef(idx) {
  createCustomTempRefs.splice(idx, 1);
  createAddRef(); // re-render list without adding (no URL in input)
}

function saveCreateCustom() {
  const name = (document.getElementById('create-name')?.value || '').trim();
  if (!name) { showToast('Enter an exercise name', 'error'); return; }

  const cats = [...document.querySelectorAll('.create-cat-check:checked')].map(el => el.value);
  if (cats.length === 0) { showToast('Select at least one category', 'error'); return; }

  const ms      = document.querySelector('input[name="create-ms"]:checked')?.value || '';
  const es      = document.querySelector('input[name="create-es"]:checked')?.value || 'Bilateral';
  const tracking= document.getElementById('create-tracking')?.value || 'weight_reps';
  const notes   = (document.getElementById('create-notes')?.value || '').trim();
  const videos  = [...createCustomTempRefs];

  const newEx = {
    id: uid(),
    name,
    bodypart: cats[0], // primary for backward compat
    categories: cats,
    movementStructure: ms,
    executionStyle: es,
    tracking,
    notes,
    videos,
    custom: true,
  };

  appDb.customExercises.push(newEx);
  fsSaveCustomEx(newEx);
  closeModal('modal-create-custom');

  if (createCustomContext === 'logger') {
    addExToWorkout(newEx.id);
    showToast('Exercise created and added', 'success');
  } else if (createCustomContext === 'change') {
    confirmChangeExercise(newEx.id);
    showToast('Exercise created and added', 'success');
  } else if (createCustomContext === 'plan') {
    addExToSession(newEx.id);
    closeModal('modal-ex-browser');
    renderSessionView();
    openModal('modal-session');
    showToast('Exercise created and added', 'success');
  } else {
    renderExerciseList();
    showToast('Exercise added', 'success');
  }
}

// ==================== LEGACY COMPAT SHIMS ====================
// Keep old function names working so Plan/Logger code doesn't break

function renderDbTabs() { /* no-op — chips replace tabs */ }

function openCustomExerciseModal(exId) {
  if (exId) {
    openEditExercise(exId);
  } else {
    openCreateCustomExercise('browse');
  }
}

function saveCustomExercise() { saveCreateCustom(); }

function closeCustomExModal() {
  closeModal('modal-create-custom');
  if (createCustomContext === 'logger') openAddExerciseModal();
  else if (createCustomContext === 'change') openChangeExModal(changeExTargetIdx);
  else if (createCustomContext === 'plan') renderSessionPicker();
}

function delCustomEx(id) {
  confirm2('Delete Exercise', 'Remove this custom exercise?', () => {
    appDb.customExercises = appDb.customExercises.filter(e => e.id !== id);
    fsDelCustomEx(id);
    renderExerciseList();
    showToast('Exercise deleted');
  });
}

// Old modal-ex-list based functions that Plan still uses internally
function renderModalExTabs()  { /* replaced by chip system */ }
function renderModalExList()  { renderExerciseList(); }
function renderChangeExTabs() { /* replaced by chip system */ }
function renderChangeExList() { renderExerciseList(); }
