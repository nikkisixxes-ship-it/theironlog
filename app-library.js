// ==================== LIBRARY / EXERCISE BROWSER ====================
// Single context-agnostic core. Parent owns purpose and outcome.
// Entry points:
//   openExBrowser('browse', null, 'library')                -- Library tab
//   openExBrowser('exactSelect', fn(exId), 'logger')         -- Workout Logger
//   openExBrowser('exactSelect', fn(exId), 'plan')           -- Plan / Session builder
//   openExBrowser('planMultiSelect', fn(exId), 'plan')       -- Plan Quick Add (stays open, Done to close)
//
// Filters (category, type, display) reset whenever the calling context
// changes from the previous open, so selections made in Library Browse
// never leak into Logger or Plan selection, and vice versa.
// Sort is the only setting that persists globally across all contexts.
//
// Orthogonal to purpose/context is libBrowseTarget ('exercises' | 'collections'),
// which selects whether the shared shell shows the existing Exercise list/pipeline
// or Collections content (rendered by app-collections.js through the one registered
// adapter -- see libRegisterCollectionsAdapter below). Drilling into a single
// Collection's members (libCollectionDrill) is itself orthogonal to purpose too:
// it never changes whether a tap on a member closes the browser (exactSelect) or
// stays open with a toast (planMultiSelect) -- only WHERE that tap's row came from.

// -- Browser State --
let libPurpose = 'browse';     // 'browse' | 'exactSelect' | 'planMultiSelect' -- set by parent, never mutated by core
let libOnSelect = null;        // fn(exId) | null -- injected by parent
let libContext = null;         // 'library' | 'logger' | 'plan' -- tracks which app context last opened the browser
let libBrowseTarget = 'exercises'; // 'exercises' | 'collections'
let libCollectionDrill = null;     // null | { collectionId } -- focused single-Collection member view (TRAIN/PLAN and Library browser)
let libShowAllIndividually = false; // Exercises-mode only; when true, fully suspends consolidation collapsing on the default list (Stage 3A)

// Active browser root element.
// Stores the mounted shell so all scoped queries search within it,
// eliminating duplicate-ID collisions when browse mode (page-db) and
// select mode (lib-browser-inner) are both present in the DOM.
let _libRootEl = null;

// Always query within the active shell root, never document-wide.
function _libRoot() { return _libRootEl || document; }

// -- Collections adapter registration --
// One-directional, explicitly registered coupling: app-collections.js calls this once
// at script load. app-library.js never calls any coll... function directly -- only
// through this fixed, explicitly-registered method contract (rendering, menu, and
// consolidation/navigation entry points). If Collections content is requested
// before the adapter is registered, that is a real bug (script-order/load failure)
// and must throw loudly rather than silently render nothing.
let _collectionsAdapter = null;
function libRegisterCollectionsAdapter(adapter) {
  _collectionsAdapter = adapter;
}
function _requireCollectionsAdapter() {
  if (!_collectionsAdapter) {
    throw new Error('Collections adapter not registered -- app-collections.js must load and call libRegisterCollectionsAdapter() before Collections mode can be used.');
  }
  return _collectionsAdapter;
}

// Filter state -- resets on every context change except sort (global preference)
let libState = {
  activeCategories: [],        // [] = ALL
  movementStructure: '',       // '' | 'Compound' | 'Isolation'
  executionStyle:    '',       // '' | 'Bilateral' | 'Unilateral'
  displaySystem:  true,
  displayCustom:  true,
  sort: 'alpha',               // 'alpha' | 'recent' -- the only setting that persists globally
  // search is NOT stored here; lives only in DOM, always reset on open
};

// -- Single Entry Point --
// context identifies which part of the app is opening the browser:
// 'library' | 'logger' | 'plan'. Filters reset whenever context changes
// from the previous open. Sort is the only setting that persists globally.
function openExBrowser(purpose, onSelectCallback, context) {
  libPurpose  = purpose || 'browse';
  libOnSelect = onSelectCallback || null;

  const resolvedContext = context || (libPurpose === 'browse' ? 'library' : 'select');

  if (resolvedContext !== libContext) {
    // Context changed (e.g. Library -> Logger, Logger -> Plan, Plan -> Library)
    // Reset every filter except sort, which is a global user preference.
    libState.activeCategories  = [];
    libState.movementStructure = '';
    libState.executionStyle    = '';
    libState.displaySystem     = true;
    libState.displayCustom     = true;
    libBrowseTarget = 'exercises';
  }
  libContext = resolvedContext;

  // Every fresh open starts un-drilled, and clears any temporary Show All
  // Individually override from a prior open -- normal consolidation (subject to
  // sort/search/filters, per libVisibleExerciseProjection()) is restored by
  // default. Both are always session-local to one open/purpose, never resumed
  // across opens.
  libCollectionDrill = null;
  libShowAllIndividually = false;

  // Note: search resets after mount via _bindBrowserEvents

  _libMountShell();
}

// -- Render DB (Library nav tab) --
function renderDB() {
  openExBrowser('browse', null, 'library');
}

// -- Mount Shell into correct container --
function _libMountShell() {
  if (libPurpose === 'browse') {
    const page = document.getElementById('page-db');
    if (!page) return;
    page.innerHTML = _buildBrowserShellHTML();
    _libRootEl = page;
    _bindBrowserEvents();
    libRenderBrowserContent();
  } else {
    const body = document.getElementById('lib-browser-inner');
    if (!body) return;
    body.innerHTML = _buildBrowserShellHTML();
    _libRootEl = body;
    _bindBrowserEvents();
    libRenderBrowserContent();
    openModal('modal-ex-browser');
  }
}

// -- Content dispatch: Exercises pipeline vs. Collections adapter --
function libRenderBrowserContent() {
  if (libBrowseTarget === 'exercises') { renderExerciseList(); return; }
  const listEl = _libRoot().querySelector('#lib-list');
  if (!listEl) return;
  const adapter = _requireCollectionsAdapter();
  const searchEl = _libRoot().querySelector('#lib-search');
  const searchTerm = searchEl ? searchEl.value.trim() : '';
  if (libCollectionDrill) {
    adapter.renderFocusedMember(listEl, { collectionId: libCollectionDrill.collectionId, searchTerm });
  } else {
    adapter.renderList(listEl, { searchTerm });
  }
}

// -- Search input dispatch (Exercises pipeline vs. Collections adapter) --
function libOnSearchInput() {
  libRenderBrowserContent();
}

// -- Exercises/Collections toggle --
function libSetBrowseTarget(target) {
  if (libBrowseTarget === target) return;
  libBrowseTarget = target;
  libCollectionDrill = null;
  _libMountShell();
}

// -- Options menu dispatch (Exercises pipeline vs. Collections adapter) --
function libOpenActiveMenu(e) {
  if (libBrowseTarget === 'exercises') { openLibMenuDropdown(e); return; }
  _requireCollectionsAdapter().openMenu(e);
}

// -- Filter Pipeline --
function libFilteredExercises() {
  let pool = getAllExercises();

  const HIDDEN_CATS = ['Cardio', 'Full Body', 'Other'];

  // 1. Display filter (system / custom)
  pool = pool.filter(ex => ex.custom ? libState.displayCustom : libState.displaySystem);

  // 2. Hide Cardio/Full Body/Other always
  pool = pool.filter(ex => {
    const cats = getExCategories(ex);
    return !cats.every(c => HIDDEN_CATS.includes(c));
  });

  // 3. Category filter (OR logic)
  if (libState.activeCategories.length > 0) {
    pool = pool.filter(ex => {
      const cats = getExCategories(ex);
      return libState.activeCategories.some(ac => cats.includes(ac));
    });
  }

  // 4. Movement structure filter — exercise must include the selected value
  if (libState.movementStructure) {
    pool = pool.filter(ex => getExMovementStructure(ex).includes(libState.movementStructure));
  }

  // 5. Execution style filter — exercise must include the selected value
  if (libState.executionStyle) {
    pool = pool.filter(ex => getExExecutionStyle(ex).includes(libState.executionStyle));
  }

  // 6. Text search (reads live from DOM within active browser root)
  const searchEl = _libRoot().querySelector('#lib-search');
  const q = searchEl ? searchEl.value.trim().toLowerCase() : '';
  if (q) {
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

// -- Consolidation rollout gate --
// libIsDefaultListState() defines the fully unfiltered default state (no active
// category/type filter, no search, alpha sort, Show All Individually off). It is
// retained as that specific definition and used where the completely-unfiltered
// state matters, but -- per the Stage 3A search/filter refinement -- it is no
// longer the sole condition under which consolidation may collapse rows. As of
// Stage 3A, consolidation applies whenever sort is A-Z and Show All Individually
// is off, REGARDLESS of active search/filters; libConsolidationSuspended() below
// is the actual gate the visible-Exercise projection consults.
function libIsDefaultListState() {
  const searchEl = _libRoot().querySelector('#lib-search');
  const hasSearch = !!(searchEl && searchEl.value.trim());

  return (
    libState.activeCategories.length === 0 &&
    !libState.movementStructure &&
    !libState.executionStyle &&
    !hasSearch &&
    libState.sort === 'alpha' &&
    !libShowAllIndividually
  );
}

// The only two states that fully suspend consolidation (Stage 3A): Recently Used
// sort, and Show All Individually. Search and filters do NOT suspend it -- see
// libVisibleExerciseProjection() for the refined per-row algorithm.
function libConsolidationSuspended() {
  return libState.sort === 'recent' || libShowAllIndividually;
}

// -- Visible Exercise projection (Stage 3A) --
// The single, shared derivation of what actually renders in the Exercise List --
// used by both renderExerciseList() and libRandomize(), so the two can never
// disagree about which rows are currently visible/suppressed. Pure and read-only:
// consults appDb.exerciseCollections (via the Collections adapter's consolidation
// projection) and getExercise(), never mutates either. Returns an array of
// { ex, variantsCount, collectionId } in the same order libFilteredExercises()
// produced (so A-Z order is preserved -- rows are only ever removed, never
// reordered).
function libVisibleExerciseProjection() {
  const filtered = libFilteredExercises();

  if (libConsolidationSuspended()) {
    return filtered.map(ex => ({ ex, variantsCount: 0, collectionId: null }));
  }

  const consolidation = _requireCollectionsAdapter().getConsolidationProjection();
  const filteredIds = new Set(filtered.map(ex => ex.id));
  const rows = [];

  for (const ex of filtered) {
    const info = consolidation.get(ex.id);

    if (info && info.role === 'member') {
      if (filteredIds.has(info.displayExerciseId)) {
        continue; // suppressed: its Display Exercise also passed the filters and will render in its place
      }
      rows.push({ ex, variantsCount: 0, collectionId: null }); // Display didn't pass -- show this member plainly, never insert the Display artificially
      continue;
    }

    if (info && info.role === 'display') {
      rows.push({ ex, variantsCount: info.memberCount, collectionId: info.collectionId });
      continue;
    }

    rows.push({ ex, variantsCount: 0, collectionId: null });
  }

  return rows;
}

// -- Browser Shell HTML --
// Produces the 3-row sticky header + scroll container + optional footer.
// No visible filter toggles or sort bars. All controls live in the ... menu.

function _buildBrowserShellHTML() {
  const isModal = libPurpose !== 'browse';
  const isCollections = libBrowseTarget === 'collections';
  const searchPlaceholder = isCollections ? 'Search collections or exercises...' : 'Search exercises...';
  return `
    <div class="lib-shell${isModal ? ' lib-shell--modal' : ' lib-shell--page'}">

      <!-- STICKY HEADER GROUP -->
      <div class="lib-sticky-header">

        <!-- Row 1: Title + controls -->
        <div class="lib-title-row">
          <span class="lib-title-text">${isModal ? 'Exercise Selection' : 'Exercises'}</span>
          <div style="display:flex;align-items:center;gap:4px">
            <button class="lib-menu-btn" onclick="libOpenActiveMenu(event)" aria-label="Browser options">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <circle cx="12" cy="5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="19" r="1.3"/>
              </svg>
            </button>
            ${isModal ? `<button class="btn-icon" onclick="closeModal('modal-ex-browser')" aria-label="Close" style="margin-left:2px">&#x2715;</button>` : ''}
          </div>
        </div>

        <!-- Row 1.5: Exercises / Collections target toggle -->
        <div class="lib-target-row">
          <div class="lib-target-toggle">
            <button class="lib-target-btn${!isCollections ? ' active' : ''}" onclick="libSetBrowseTarget('exercises')">Exercises</button>
            <button class="lib-target-btn${isCollections ? ' active' : ''}" onclick="libSetBrowseTarget('collections')">Collections</button>
          </div>
        </div>

        <!-- Row 2: Search -->
        <div class="lib-search-row">
          <svg class="lib-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            id="lib-search"
            class="lib-search-input"
            placeholder="${searchPlaceholder}"
            oninput="libOnSearchInput()"
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
          >
        </div>

        <!-- Row 3: Category Chips (Exercises mode only) -->
        <div class="lib-chips-row" id="lib-chips" style="${isCollections ? 'display:none' : ''}"></div>

      </div>

      <!-- SINGLE SCROLLABLE LIST CONTAINER -->
      <div class="lib-list-container" id="lib-list"></div>

      <!-- FOOTER (select purposes only) -->
      ${isModal ? `
      <div class="lib-footer">
        ${libPurpose === 'planMultiSelect' ? `<button class="btn btn-primary" onclick="closeModal('modal-ex-browser')">Done</button>` : ''}
        ${!isCollections ? `
        <button class="btn btn-ghost" onclick="openCreateCustomExercise('select')">+ Create Custom</button>
        <button class="btn btn-ghost" onclick="libRandomize()">Randomize</button>
        ` : ''}
      </div>` : ''}

    </div>
  `;
}

function _bindBrowserEvents() {
  // Search resets here — input now exists in DOM after shell mount
  const searchEl = _libRoot().querySelector('#lib-search');
  if (searchEl) searchEl.value = '';
  if (libBrowseTarget === 'exercises') {
    renderLibChips();
  } else {
    const chipsEl = _libRoot().querySelector('#lib-chips');
    if (chipsEl) chipsEl.innerHTML = '';
  }
}

// -- Category Chips --
function renderLibChips() {
  const el = _libRoot().querySelector('#lib-chips');
  if (!el) return;
  const allActive = libState.activeCategories.length === 0;
  let html = `<button class="lib-chip${allActive ? ' active' : ''}" onclick="libChipAll()">ALL</button>`;
  LIBRARY_CATEGORIES.forEach(cat => {
    const active = libState.activeCategories.includes(cat);
    html += `<button class="lib-chip${active ? ' active' : ''}" onclick="libChipToggle('${cat}')">${CATEGORY_ABBREV[cat]}</button>`;
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
  if (idx === -1) libState.activeCategories.push(cat);
  else libState.activeCategories.splice(idx, 1);
  renderLibChips();
  renderExerciseList();
}

function libToggleMovement(val) {
  libState.movementStructure = libState.movementStructure === val ? '' : val;
  renderExerciseList();
}

function libToggleExecution(val) {
  libState.executionStyle = libState.executionStyle === val ? '' : val;
  renderExerciseList();
}

function libOnSort(val) {
  libState.sort = val;
  renderExerciseList();
}

// -- Exercise List --
function renderExerciseList() {
  const listEl = _libRoot().querySelector('#lib-list');
  if (!listEl) return;

  const rows = libVisibleExerciseProjection();

  if (!rows.length) {
    const searchEl = _libRoot().querySelector('#lib-search');
    const hasSearch = searchEl && searchEl.value.trim().length > 0;
    listEl.innerHTML = `
      <div class="lib-empty">
        <div class="lib-empty-text">No Exercises Found</div>
        ${hasSearch ? `<button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="libClearSearch()">Clear Search</button>` : ''}
      </div>`;
    return;
  }

  listEl.innerHTML = rows.map(r => buildExerciseRow(r.ex, r.variantsCount > 0 ? { count: r.variantsCount, collectionId: r.collectionId } : null)).join('');
}

// -- Single Exercise Row Template --
// Browse: full row tap opens Profile. Info button hidden.
// Select: full row tap selects exercise. Info button visible, opens Profile without selecting.
// variantsInfo ({count, collectionId} | null): when present, the row represents a
// valid enabled consolidation group's Display Exercise. The row's own identity,
// name, categories, custom badge, and tap action are entirely unchanged -- the row
// IS the Display Exercise, never a merged subject and never the Collection. The
// Variants affordance is a visually-subordinate secondary control with its own
// click target; its handler stops propagation so it can never trigger the row's
// own select/open action.
function buildExerciseRow(ex, variantsInfo) {
  const cats = sortCategories(getExCategories(ex));
  const badgesHtml = cats
    .filter(c => CATEGORY_ABBREV[c])
    .map(c => `<span class="ex-row-cat-badge">${CATEGORY_ABBREV[c]}</span>`)
    .join('');
  const customBadge = ex.custom ? `<span class="ex-row-custom-badge">Custom</span>` : '';
  const isSelect = libPurpose !== 'browse';
  const variantsHtml = variantsInfo
    ? `<button class="ex-variants-link" onclick="event.stopPropagation();libOpenControllingCollection('${variantsInfo.collectionId}')">${variantsInfo.count} VARIANT${variantsInfo.count !== 1 ? 'S' : ''} ›</button>`
    : '';

  return `
    <div class="ex-row${isSelect ? ' ex-row--select' : ''}"
         onclick="${isSelect ? `libSelectExercise('${ex.id}')` : `openExerciseProfile('${ex.id}')`}">
      <div class="ex-row-main">
        <div class="ex-row-name">${escapeHtml(ex.name)}</div>
        <div class="ex-row-badges">${badgesHtml}${customBadge}</div>
        ${variantsHtml}
      </div>
      ${isSelect ? `
      <button class="ex-row-info-btn"
              onclick="event.stopPropagation();openExerciseProfile('${ex.id}')"
              aria-label="View profile">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="8.5" stroke-width="2.5"/>
          <line x1="12" y1="11" x2="12" y2="16"/>
        </svg>
      </button>` : ''}
    </div>`;
}

// Tapping Variants: context-aware ("open controlling Collection") operation,
// delegated entirely to the registered Collections adapter -- app-library.js
// never calls a coll... function directly (Section: Variants navigation).
function libOpenControllingCollection(collectionId) {
  _requireCollectionsAdapter().openControllingCollection(collectionId);
}

// -- Library ... menu -- all filter/sort controls live here exclusively --
function openLibMenuDropdown(e) {
  e.stopPropagation();
  const ms = libState.movementStructure;
  const es = libState.executionStyle;
  const items = [
    { label: 'Sort: A - Z',           icon: '', toggle: libState.sort === 'alpha'  ? '✓ ' : '', action: `libOnSort('alpha')`  },
    { label: 'Sort: Recently Used',    icon: '', toggle: libState.sort === 'recent' ? '✓ ' : '', action: `libOnSort('recent')` },
    { label: 'Show All Individually',  icon: '', toggle: libShowAllIndividually ? '✓ ' : '', action: `libToggleShowAllIndividually()` },
    { divider: true },
    { label: 'Compound Only',          icon: '', toggle: ms === 'Compound'   ? '✓ ' : '', action: `libToggleMovement('Compound')`   },
    { label: 'Isolation Only',         icon: '', toggle: ms === 'Isolation'  ? '✓ ' : '', action: `libToggleMovement('Isolation')`  },
    { divider: true },
    { label: 'Bilateral Only',         icon: '', toggle: es === 'Bilateral'  ? '✓ ' : '', action: `libToggleExecution('Bilateral')`  },
    { label: 'Unilateral Only',        icon: '', toggle: es === 'Unilateral' ? '✓ ' : '', action: `libToggleExecution('Unilateral')` },
    { divider: true },
    { label: 'Show System Exercises',  icon: '', toggle: libState.displaySystem ? '✓ ' : '', action: `libToggleDisplay('system')` },
    { label: 'Show Custom Exercises',  icon: '', toggle: libState.displayCustom ? '✓ ' : '', action: `libToggleDisplay('custom')` },
    { divider: true },
    { label: 'Reset All Filters',      icon: '↺', action: `libResetFilters()` },
  ];
  if (libPurpose === 'browse') {
    items.push({ divider: true });
    items.push({ label: 'Add Custom Exercise', icon: '', action: `openCreateCustomExercise('browse')` });
  }
  showDropdown(e.currentTarget, items);
}

// Suspends consolidation collapsing on the default Exercise List (Stage 3A).
function libToggleShowAllIndividually() {
  libShowAllIndividually = !libShowAllIndividually;
  libRenderBrowserContent();
}

function libClearSearch() {
  const searchEl = _libRoot().querySelector('#lib-search');
  if (searchEl) searchEl.value = '';
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
  const searchEl = _libRoot().querySelector('#lib-search');
  if (searchEl) searchEl.value = '';
  renderLibChips();
  renderExerciseList();
}

// -- Select Mode --
let libLastRandomId = null;

function libSelectExercise(exId) {
  if (libOnSelect) libOnSelect(exId);
  if (libPurpose === 'planMultiSelect') {
    const ex = getExercise(exId);
    showToast(ex ? `${ex.name} added` : 'Exercise added', 'success');
  } else {
    closeModal('modal-ex-browser');
  }
}

function libRandomize() {
  const visible = libVisibleExerciseProjection().map(r => r.ex);
  const pool = visible.filter(ex => ex.id !== libLastRandomId);
  const src  = pool.length ? pool : visible;
  if (!src.length) { showToast('No exercises match current filters', 'error'); return; }
  const picked = src[Math.floor(Math.random() * src.length)];
  libLastRandomId = picked.id;
  showRandomConfirmLib(picked);
}

function showRandomConfirmLib(ex) {
  const listEl = _libRoot().querySelector('#lib-list');
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
        <button class="btn btn-ghost" onclick="libRandomize()">Re-Roll</button>
      </div>
    </div>`;
}

function libAcceptRandom(exId) {
  libLastRandomId = null;
  libSelectExercise(exId);
  if (libPurpose === 'planMultiSelect') renderExerciseList();
}

// -- Caller wrappers --
function openAddExerciseModal() {
  openExBrowser('exactSelect', exId => addExToWorkout(exId), 'logger');
}

function openChangeExModal(exIdx) {
  changeExTargetIdx = exIdx;
  openExBrowser('exactSelect', exId => confirmChangeExercise(exId), 'logger');
}

function renderSessionPicker() {
  openExBrowser('exactSelect', exId => {
    addExToSession(exId);
    closeModal('modal-ex-browser');
    renderSessionView();
    openModal('modal-session');
  }, 'plan');
}

// Backward compat stubs
function openExBrowserSelect(callback) { openExBrowser('exactSelect', callback, 'logger'); }
function openCustomExFromLogger()      { openCreateCustomExercise('logger'); }
function openCustomExFromChanger()     { openCreateCustomExercise('change'); }
function openCustomExFromSessionPicker() { openCreateCustomExercise('plan'); }

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

  const metaStr = [ms.join('/'), es.join('/')].filter(s => s.length > 0).join(' • ');

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

// Profile edit button opens Edit Exercise directly (no dropdown)

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
          <input type="checkbox" name="edit-ms" value="Compound" ${currentMS.includes('Compound') ? 'checked' : ''}> Compound
        </label>
        <label class="edit-radio-label">
          <input type="checkbox" name="edit-ms" value="Isolation" ${currentMS.includes('Isolation') ? 'checked' : ''}> Isolation
        </label>
      </div>
    </div>

    <div class="edit-group">
      <div class="edit-field-label">Execution Style</div>
      <div class="edit-radio-row">
        <label class="edit-radio-label">
          <input type="checkbox" name="edit-es" value="Bilateral" ${currentES.includes('Bilateral') ? 'checked' : ''}> Bilateral
        </label>
        <label class="edit-radio-label">
          <input type="checkbox" name="edit-es" value="Unilateral" ${currentES.includes('Unilateral') ? 'checked' : ''}> Unilateral
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
  const ms   = getSelectedEditMS();
  const es   = getSelectedEditES();
  const note = document.getElementById('edit-notes')?.value || '';
  renderEditExPage(ex, cats, ms, es, note);
}

function editRemoveRef(idx) {
  editExTempRefs.splice(idx, 1);
  const ex = getExercise(editExId);
  const cats = getSelectedEditCats();
  const ms   = getSelectedEditMS();
  const es   = getSelectedEditES();
  const note = document.getElementById('edit-notes')?.value || '';
  renderEditExPage(ex, cats, ms, es, note);
}

function getSelectedEditCats() {
  return [...document.querySelectorAll('.edit-cat-check:checked')].map(el => el.value);
}
function getSelectedEditMS() {
  return [...document.querySelectorAll('input[name="edit-ms"]:checked')].map(el => el.value);
}
function getSelectedEditES() {
  return [...document.querySelectorAll('input[name="edit-es"]:checked')].map(el => el.value);
}

function saveEditExercise() {
  const ex = getExercise(editExId);
  if (!ex) return;

  const cats = getSelectedEditCats();
  const ms   = getSelectedEditMS();
  const es   = getSelectedEditES();
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
    // Normalise default MS/ES to arrays for comparison
    const defaultMS = typeof defaultEx?.movementStructure === 'string'
      ? (defaultEx.movementStructure ? [defaultEx.movementStructure] : [])
      : (defaultEx?.movementStructure || []);
    const defaultES = typeof defaultEx?.executionStyle === 'string'
      ? (defaultEx.executionStyle ? [defaultEx.executionStyle] : [])
      : (defaultEx?.executionStyle || []);

    const catsChanged = JSON.stringify(sortCategories(cats)) !== JSON.stringify(sortCategories(defaultCats));
    const msChanged   = JSON.stringify([...ms].sort()) !== JSON.stringify([...defaultMS].sort());
    const esChanged   = JSON.stringify([...es].sort()) !== JSON.stringify([...defaultES].sort());

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
  _requireCollectionsAdapter().deleteCustomExerciseWithDisclosure(exId, {
    onSuccess: () => {
      closeModal('modal-edit-exercise');
      closeModal('modal-ex-profile');
      renderExerciseList();
    }
  });
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
        <label class="edit-radio-label"><input type="checkbox" name="create-ms" value="Compound"> Compound</label>
        <label class="edit-radio-label"><input type="checkbox" name="create-ms" value="Isolation"> Isolation</label>
      </div>
    </div>

    <div class="edit-group">
      <div class="edit-field-label">Execution Style</div>
      <div class="edit-radio-row">
        <label class="edit-radio-label"><input type="checkbox" name="create-es" value="Bilateral"> Bilateral</label>
        <label class="edit-radio-label"><input type="checkbox" name="create-es" value="Unilateral"> Unilateral</label>
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

  const ms      = [...document.querySelectorAll('input[name="create-ms"]:checked')].map(el => el.value);
  const es      = [...document.querySelectorAll('input[name="create-es"]:checked')].map(el => el.value);
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
function renderDbTabs()       { /* no-op */ }
function renderModalExTabs()  { /* no-op */ }
function renderModalExList()  { renderExerciseList(); }
function renderChangeExTabs() { /* no-op */ }
function renderChangeExList() { renderExerciseList(); }
function openCustomExerciseModal(exId) { exId ? openEditExercise(exId) : openCreateCustomExercise('browse'); }
function saveCustomExercise() { saveCreateCustom(); }
function closeCustomExModal() { closeModal('modal-create-custom'); }
function delCustomEx(id) {
  _requireCollectionsAdapter().deleteCustomExerciseWithDisclosure(id, {
    onSuccess: () => { renderExerciseList(); }
  });
}
