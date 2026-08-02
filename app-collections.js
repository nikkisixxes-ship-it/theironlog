// ==================== EXERCISE COLLECTIONS (Stage 1B) ====================
// Stage 1B scope: interface, routing, and draft safety only, using temporary
// in-memory Collection data (collTempCollections below). No Firestore reference,
// no appDb.exerciseCollections, no listeners, no persistence, no membership-index
// documents, no transactions, no staleness checking, no live consolidation
// collapsing, no exclusivity enforcement, no transfers, no custom-exercise
// deletion integration. A page refresh resets the temporary data -- that is
// correct for this stage.
//
// Ownership (see the Stage 1A proposal, Section G, for the full contract):
//   app-library.js owns the shared browser shell, purpose/context/target dispatch,
//     the Exercises pipeline, and Exercise Profile/Edit/Create.
//   app-collections.js (this file) owns Collections-mode list/drilled-in rendering
//     (via the one registered adapter), every full-page Library Collection screen,
//     the Collection draft model, the Library route model, and the unsaved-change
//     predicate/discard helper that app-core.js's showPage() guard calls into.
// The coupling is one-directional: app-collections.js calls app-library.js's
// existing exported functions freely; app-library.js never calls a coll... function
// directly, only through the libRegisterCollectionsAdapter(...) contract.

// ==================== LIBRARY ROUTE MODEL ====================
// { view: 'browser' }                -- Exercises OR Collections list in #page-db,
//                                        distinguished by libBrowseTarget (never a
//                                        separate route value)
// { view: 'collectionDetail', id }
// { view: 'newCollection' }
// { view: 'editCollection', id }
// { view: 'memberSelection' }
// { view: 'consolidation' }
// { view: 'chooseDisplayExercise' }
let libraryRoute = { view: 'browser' };

// Every route that carries a live, potentially-dirty collectionDraft. Used
// consistently everywhere protection is required: the unsaved-change guard in
// app-core.js's showPage(), and the listener-isolation check in setupListeners().
// newCollection is included on equal footing with editCollection -- a fresh,
// in-progress Collection is exactly as vulnerable to silent loss as an edit in
// progress.
const EDITABLE_LIBRARY_ROUTES = new Set([
  'newCollection', 'editCollection', 'memberSelection', 'consolidation', 'chooseDisplayExercise'
]);
function isEditableLibraryRoute(route) {
  route = route || libraryRoute;
  return EDITABLE_LIBRARY_ROUTES.has(route.view);
}

// ==================== DRAFT STATE ====================
let collectionDraft         = null; // present for BOTH newCollection and editCollection
let collectionDraftSnapshot = null; // JSON.stringify(collectionDraft) at open -- local dirty check only
let collectionDraftOrigin   = null; // { type:'browser' } | { type:'collectionDetail', id }

let consolidationDraft = null; // nested Consolidation-editor draft; owns its own restoration snapshot
let collMemberSelTemp  = null; // Set<exerciseId> -- Member Selection's temporary selection

let collActiveId = null; // id of the Collection open in collectionDetail/editCollection (Library only)
let collReturnTo = null; // { type:'browser' } | { type:'collectionDetail', id } | { type:'trainOrPlanCaller' }

function collDeepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

// Local dirty check -- intentionally separate from any future Firestore staleness
// check. Same-process, same-serialization comparison; safe as a raw string compare
// because it never crosses a network/round-trip boundary.
function isCollectionDraftDirty() {
  return !!collectionDraft && JSON.stringify(collectionDraft) !== collectionDraftSnapshot;
}

// Clears the primary draft, its snapshot/origin, the nested Consolidation draft,
// and the Member Selection temp state. Deliberately does not touch libraryRoute,
// collActiveId, or collReturnTo -- callers decide the resulting route/context
// (e.g. discarding out of Edit returns to that Collection's Detail; discarding
// out of New returns to the plain browser).
function discardCollectionDraft() {
  collectionDraft = null;
  collectionDraftSnapshot = null;
  collectionDraftOrigin = null;
  consolidationDraft = null;
  collMemberSelTemp = null;
}

// Whether the current draft corresponds to a Collection already committed to the
// temporary array (edit) or not yet saved anywhere (new). Re-derived from the
// data itself rather than tracked separately, so it stays correct regardless of
// which screen most recently returned here.
function collEditorRouteView() {
  return (collectionDraft && collTempCollections.some(c => c.id === collectionDraft.id))
    ? 'editCollection' : 'newCollection';
}

// ==================== TEMPORARY IN-MEMORY COLLECTION DATA (Stage 1B only) ====================
// Not appDb. Not persisted. Resets on refresh -- correct for this stage.
// Uses real exercise IDs from app-data.js's DEFAULT_EXERCISES so names, categories,
// and badges render exactly as they do everywhere else in the app.
let collTempCollections = [
  {
    id: 'coll_bench_variants',
    name: 'Bench Press Variants',
    memberIds: ['e50', 'e51', 'e52', 'e53', 'e54', 'e82'],
    consolidation: {
      enabled: true,
      displayExerciseId: 'e50',
      consolidatedExerciseIds: ['e51', 'e52', 'e53', 'e54', 'e82']
    },
    createdAt: Date.now() - 5 * 86400000,
    updatedAt: Date.now() - 2 * 86400000
  },
  {
    id: 'coll_pulling',
    name: 'Pulling Movements',
    memberIds: ['e40', 'e41', 'e43', 'e44', 'e45', 'e46'],
    consolidation: { enabled: false, displayExerciseId: null, consolidatedExerciseIds: [] },
    createdAt: Date.now() - 4 * 86400000,
    updatedAt: Date.now() - 4 * 86400000
  },
  {
    id: 'coll_single_leg',
    name: 'Single Leg Work',
    memberIds: ['e6', 'e7', 'e23'],
    consolidation: { enabled: false, displayExerciseId: null, consolidatedExerciseIds: [] },
    createdAt: Date.now() - 3 * 86400000,
    updatedAt: Date.now() - 3 * 86400000
  },
  {
    id: 'coll_empty_example',
    name: 'New Ideas',
    memberIds: [],
    consolidation: { enabled: false, displayExerciseId: null, consolidatedExerciseIds: [] },
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 86400000
  }
];

function collFindCollection(id) { return collTempCollections.find(c => c.id === id) || null; }

// ==================== renderLibraryRoute() -- SINGLE DISPATCHER FOR #page-db ====================
function renderLibraryRoute() {
  const page = document.getElementById('page-db');
  if (!page) return;
  switch (libraryRoute.view) {
    case 'browser':               renderDB(); break; // existing function, unmodified
    case 'collectionDetail':      collRenderDetail(libraryRoute.id); break;
    case 'newCollection':         collRenderEditor(); break;
    case 'editCollection':        collRenderEditor(); break;
    case 'memberSelection':       collRenderMemberSelection(); break;
    case 'consolidation':         collRenderConsolidation(); break;
    case 'chooseDisplayExercise': collRenderChooseDisplay(); break;
    default:                      renderDB();
  }
}

// ==================== SHARED PAGE HEADER ====================
function collPageHeader(title, backAction, rightHtml) {
  return `<div class="page-title-zone">
    <button class="btn-icon" onclick="${backAction}" aria-label="Back">&#8592;</button>
    <div class="page-title-zone-title" style="flex:1;margin-left:8px;font-size:20px">${escapeHtml(title)}</div>
    ${rightHtml || ''}
  </div>`;
}

// ==================== CONSOLIDATION SUMMARY (shared by Detail and Editor) ====================
function collConsolidationSummaryHtml(c) {
  if (c.consolidation.enabled) {
    const disp = getExercise(c.consolidation.displayExerciseId);
    const n = c.consolidation.consolidatedExerciseIds.length;
    return `<div class="coll-consol-summary coll-consol-summary--on">
      <div class="coll-consol-summary-label">List Consolidation</div>
      <div class="coll-consol-summary-val">Display: ${disp ? escapeHtml(disp.name) : '\u2014'} &middot; ${n} Consolidated Member${n !== 1 ? 's' : ''}</div>
    </div>`;
  }
  return `<div class="coll-consol-summary coll-consol-summary--off">
    <div class="coll-consol-summary-label">List Consolidation</div>
    <div class="coll-consol-summary-val" style="color:var(--text3)">Not Configured</div>
  </div>`;
}

// ==================== COLLECTIONS BROWSER (adapter) ====================
// Rendered inside the shared Exercise Browser shell (app-library.js) whenever
// libBrowseTarget === 'collections'. Registered once, below, as the sole,
// explicit coupling point back into app-library.js.

function collRenderCollectionsList(container, opts) {
  opts = opts || {};
  const q = (opts.searchTerm || '').trim().toLowerCase();

  let rows = collTempCollections.map(c => {
    if (!q) return { c, matchedMember: null };
    if (c.name.toLowerCase().includes(q)) return { c, matchedMember: null };
    const member = c.memberIds
      .map(id => getExercise(id))
      .find(ex => ex && ex.name.toLowerCase().includes(q));
    return member ? { c, matchedMember: member.name } : null;
  }).filter(Boolean);

  rows.sort((a, b) => a.c.name.localeCompare(b.c.name));

  if (!rows.length) {
    container.innerHTML = `
      <div class="lib-empty">
        <div class="lib-empty-text">No Collections Found</div>
        ${libContext === 'library' ? `<button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="collOpenNewFromBrowser()">Create Collection</button>` : ''}
      </div>`;
    return;
  }

  container.innerHTML = rows.map(({ c, matchedMember }) => {
    const containsLine = matchedMember ? `<div class="coll-row-contains">contains: ${escapeHtml(matchedMember)}</div>` : '';
    const consolBadge = c.consolidation.enabled
      ? `<span class="coll-status-badge coll-status-consolidated" style="margin-left:6px">CONSOLIDATED</span>` : '';
    return `<div class="ex-row" onclick="collOpenFromBrowser('${c.id}')">
      <div class="ex-row-main">
        <div class="ex-row-name">${escapeHtml(c.name)}</div>
        <div class="ex-row-badges">
          <span class="ex-row-cat-badge">${c.memberIds.length} Exercise${c.memberIds.length !== 1 ? 's' : ''}</span>${consolBadge}
        </div>
        ${containsLine}
      </div>
    </div>`;
  }).join('');
}

function collRenderFocusedMember(container, opts) {
  opts = opts || {};
  const c = collFindCollection(opts.collectionId);
  if (!c) {
    container.innerHTML = `<div class="lib-empty"><div class="lib-empty-text">Collection Not Found</div></div>`;
    return;
  }
  const q = (opts.searchTerm || '').trim().toLowerCase();
  let members = c.memberIds.map(id => getExercise(id)).filter(Boolean);
  if (q) members = members.filter(ex => ex.name.toLowerCase().includes(q));
  members.sort((a, b) => a.name.localeCompare(b.name));

  const backRow = `<div class="ex-row" style="cursor:pointer" onclick="collBackToCollectionsList()">
    <div class="ex-row-main"><div class="ex-row-name" style="color:var(--text2);font-size:15px">&larr; ${escapeHtml(c.name)}</div></div>
  </div>`;

  if (!members.length) {
    container.innerHTML = backRow + `<div class="lib-empty"><div class="lib-empty-text">No Members Found</div></div>`;
    return;
  }

  container.innerHTML = backRow + members.map(ex => {
    const cats = sortCategories(getExCategories(ex));
    const badgesHtml = cats.filter(cc => CATEGORY_ABBREV[cc]).map(cc => `<span class="ex-row-cat-badge">${CATEGORY_ABBREV[cc]}</span>`).join('');
    return `<div class="ex-row ex-row--select" onclick="libSelectExercise('${ex.id}')">
      <div class="ex-row-main">
        <div class="ex-row-name">${escapeHtml(ex.name)}</div>
        <div class="ex-row-badges">${badgesHtml}</div>
      </div>
      <button class="ex-row-info-btn" onclick="event.stopPropagation();openExerciseProfile('${ex.id}')" aria-label="View profile">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="8.5" stroke-width="2.5"/><line x1="12" y1="11" x2="12" y2="16"/>
        </svg>
      </button>
    </div>`;
  }).join('');
}

function collBackToCollectionsList() {
  libCollectionDrill = null;
  libRenderBrowserContent();
}

// Tapping a Collection row inside the shared browser: Library opens the full-page
// Collection Detail route; TRAIN/PLAN drill into a focused member view inside the
// same browser modal instead (never leaving that modal, never reaching Detail/Edit).
function collOpenFromBrowser(id) {
  if (libContext === 'library') {
    collActiveId = id;
    collReturnTo = { type: 'browser' };
    libraryRoute = { view: 'collectionDetail', id };
    renderLibraryRoute();
  } else {
    libCollectionDrill = { collectionId: id };
    // The search term that found this Collection (by name or by a member's name)
    // belongs to the Collections list, not to this Collection's own member list --
    // clear it so every member is shown on entry. Search remains usable afterward;
    // it now searches within this Collection instead.
    const searchEl = _libRoot().querySelector('#lib-search');
    if (searchEl) searchEl.value = '';
    libRenderBrowserContent();
  }
}

function collOpenMenuDropdown(e) {
  e.stopPropagation();
  const items = [];
  if (libContext === 'library') {
    items.push({ label: 'Create Collection', icon: '+', action: 'collOpenNewFromBrowser()' });
    items.push({ divider: true });
  }
  items.push({ label: 'Sort A - Z', icon: '', toggle: '\u2713 ' });
  items.push({ label: 'Reset Search', icon: '', action: 'collResetSearchFromMenu()' });
  showDropdown(e.currentTarget, items);
}

function collResetSearchFromMenu() {
  const searchEl = _libRoot().querySelector('#lib-search');
  if (searchEl) searchEl.value = '';
  libRenderBrowserContent();
}

// Create Collection is Library-only (enforced above in the menu itself, but this
// entry point is also only ever wired to a control that's hidden outside Library).
function collOpenNewFromBrowser() {
  if (libContext !== 'library') return;
  collActiveId = null;
  collReturnTo = { type: 'browser' };
  collBeginNewDraft();
  libraryRoute = { view: 'newCollection' };
  renderLibraryRoute();
}

// Explicit, one-directional registration -- app-library.js throws if this hasn't
// run before Collections mode is used, rather than silently rendering nothing.
libRegisterCollectionsAdapter({
  renderList: collRenderCollectionsList,
  renderFocusedMember: collRenderFocusedMember,
  openMenu: collOpenMenuDropdown
});

// ==================== COLLECTION DETAIL (Library full-page route) ====================
function collRenderDetail(id) {
  const page = document.getElementById('page-db');
  if (!page) return;
  const c = collFindCollection(id);
  if (!c) {
    libraryRoute = { view: 'browser' };
    renderDB();
    return;
  }

  const members = c.memberIds.map(mid => getExercise(mid)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  const memberRows = members.length ? members.map(ex => {
    const isDisplay = c.consolidation.enabled && c.consolidation.displayExerciseId === ex.id;
    const isConsolidated = c.consolidation.enabled && c.consolidation.consolidatedExerciseIds.includes(ex.id);
    let statusBadge = '';
    if (isDisplay) statusBadge = `<span class="coll-status-badge coll-status-display">DISPLAY</span>`;
    else if (isConsolidated) statusBadge = `<span class="coll-status-badge coll-status-consolidated">CONSOLIDATED</span>`;
    return `<div class="ex-row" onclick="openExerciseProfile('${ex.id}')">
      <div class="ex-row-main">
        <div class="ex-row-name">${escapeHtml(ex.name)}</div>
        <div class="ex-row-badges">${statusBadge}</div>
      </div>
    </div>`;
  }).join('') : `<div class="lib-empty"><div class="lib-empty-text">No Members Yet</div></div>`;

  const editBtn = `<button class="btn-icon" onclick="collOpenEditFromDetail('${c.id}')" aria-label="Edit Collection">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  </button>`;

  page.innerHTML = `
    ${collPageHeader(c.name, `collBackFromDetail()`, editBtn)}
    <div style="padding:14px 16px 20px">
      <div class="plan-card-meta" style="margin-bottom:14px">${c.memberIds.length} Exercise${c.memberIds.length !== 1 ? 's' : ''}</div>
      ${collConsolidationSummaryHtml(c)}
      <div class="prof-divider" style="margin:18px 0"></div>
      <div class="prof-section-label" style="margin-bottom:10px">Members</div>
      ${memberRows}
    </div>
  `;
}

function collBackFromDetail() {
  collActiveId = null;
  collReturnTo = null;
  libraryRoute = { view: 'browser' };
  renderLibraryRoute();
}

function collOpenEditFromDetail(id) {
  collBeginEditDraft(id);
  libraryRoute = { view: 'editCollection', id };
  renderLibraryRoute();
}

// ==================== DRAFT CREATION ====================
function collBeginNewDraft() {
  collectionDraft = {
    id: uid(),
    name: '',
    memberIds: [],
    consolidation: { enabled: false, displayExerciseId: null, consolidatedExerciseIds: [] },
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  collectionDraftSnapshot = JSON.stringify(collectionDraft);
  collectionDraftOrigin = collReturnTo || { type: 'browser' };
}

function collBeginEditDraft(id) {
  const c = collFindCollection(id);
  if (!c) return;
  collectionDraft = collDeepClone(c);
  collectionDraftSnapshot = JSON.stringify(collectionDraft);
  collectionDraftOrigin = { type: 'collectionDetail', id };
}

// ==================== NEW / EDIT COLLECTION (shared editor screen) ====================
function collRenderEditor() {
  const page = document.getElementById('page-db');
  if (!page || !collectionDraft) return;
  const isNew = libraryRoute.view === 'newCollection';

  const members = collectionDraft.memberIds.map(id => getExercise(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  const memberListHtml = members.length
    ? members.map(ex => `<div class="ex-row" style="cursor:default">
        <div class="ex-row-main"><div class="ex-row-name">${escapeHtml(ex.name)}</div></div>
      </div>`).join('')
    : `<div class="lib-empty" style="padding:22px 12px"><div class="lib-empty-text" style="font-size:14px">No Members Yet</div></div>`;

  page.innerHTML = `
    ${collPageHeader(isNew ? 'New Collection' : 'Edit Collection', `collExitEditor()`, `<button class="btn btn-primary btn-sm" onclick="collSaveDraft()">Save</button>`)}
    <div style="padding:16px">
      <div class="form-group">
        <label>Collection Name</label>
        <input type="text" id="coll-name-input" value="${escapeHtml(collectionDraft.name)}" placeholder="e.g. Bench Press Variants" oninput="collUpdateDraftName(this.value)">
      </div>

      <div class="prof-section-label" style="margin:18px 0 8px">Members (${collectionDraft.memberIds.length})</div>
      ${memberListHtml}
      <button class="btn btn-secondary" style="width:100%;margin-top:8px" onclick="collOpenMemberSelection()">Manage Members</button>

      <div class="prof-divider" style="margin:20px 0"></div>

      <div class="prof-section-label" style="margin-bottom:8px">Exercise List Consolidation</div>
      ${collConsolidationSummaryHtml(collectionDraft)}
      <button class="btn btn-secondary" style="width:100%;margin-top:8px" onclick="collOpenConsolidation()">Configure</button>
    </div>
  `;
}

function collUpdateDraftName(val) {
  if (!collectionDraft) return;
  collectionDraft.name = val;
}

// Shared "leave the editable flow" behavior for both New and Edit: clean draft
// (or none) proceeds immediately; a dirty draft is guarded by a Collection-specific
// confirmation. Internal movement between the editor and its own nested screens
// (Member Selection / Consolidation / Choose Display) never calls this -- only
// leaving the editable flow entirely does.
function collAttemptLeaveEditor(afterLeaveFn) {
  if (isCollectionDraftDirty()) {
    confirm2(
      'Discard Collection Changes?',
      'Your unsaved changes to this Collection will be lost.',
      () => { discardCollectionDraft(); afterLeaveFn(); },
      'Discard'
    );
  } else {
    discardCollectionDraft();
    afterLeaveFn();
  }
}

function collExitEditor() {
  const origin = collectionDraftOrigin;
  collAttemptLeaveEditor(() => {
    if (origin && origin.type === 'collectionDetail') {
      collActiveId = origin.id;
      libraryRoute = { view: 'collectionDetail', id: origin.id };
    } else {
      collActiveId = null;
      collReturnTo = null;
      libraryRoute = { view: 'browser' };
    }
    renderLibraryRoute();
  });
}

// ==================== SAVE (temporary array only -- no persistence in Stage 1B) ====================
function collSaveDraft() {
  if (!collectionDraft) return;
  const name = (collectionDraft.name || '').trim();
  if (!name) { showToast('Enter a Collection name', 'error'); return; }
  collectionDraft.name = name;

  // In-memory validation only (Stage 1B) -- no cross-Collection exclusivity check.
  const cons = collectionDraft.consolidation;
  if (cons.enabled) {
    if (!cons.displayExerciseId) { showToast('Choose a Display Exercise before saving', 'error'); return; }
    if (!cons.consolidatedExerciseIds.length) { showToast('Add at least one consolidated member before saving', 'error'); return; }
    if (!collectionDraft.memberIds.includes(cons.displayExerciseId)) { showToast('Display Exercise must be a Collection member', 'error'); return; }
    if (!cons.consolidatedExerciseIds.every(id => collectionDraft.memberIds.includes(id))) { showToast('All consolidated members must be Collection members', 'error'); return; }
    if (cons.consolidatedExerciseIds.includes(cons.displayExerciseId)) { showToast('Display Exercise cannot also be a consolidated member', 'error'); return; }
  }

  collectionDraft.updatedAt = Date.now();
  const saved = collDeepClone(collectionDraft);
  const idx = collTempCollections.findIndex(c => c.id === saved.id);
  if (idx === -1) collTempCollections.push(saved);
  else collTempCollections[idx] = saved;

  const savedId = saved.id;
  discardCollectionDraft();
  collActiveId = savedId;
  libraryRoute = { view: 'collectionDetail', id: savedId };
  renderLibraryRoute();
  showToast('Collection saved', 'success');
}

// ==================== MEMBER SELECTION (nested, reuses no browser purpose --
// a dedicated full-page checklist screen, since Stage 1B's approved purpose set
// is browse/exactSelect/planMultiSelect only) ====================
function collOpenMemberSelection() {
  if (!collectionDraft) return;
  collMemberSelTemp = new Set(collectionDraft.memberIds);
  libraryRoute = { view: 'memberSelection' };
  renderLibraryRoute();
}

function collRenderMemberSelection() {
  const page = document.getElementById('page-db');
  if (!page || !collectionDraft || !collMemberSelTemp) return;
  page.innerHTML = `
    ${collPageHeader('Manage Members', `collCancelMemberSelection()`, `<button class="btn btn-primary btn-sm" onclick="collApplyMemberSelection()">Apply</button>`)}
    <div id="coll-member-select-error" class="coll-inline-error" style="display:none"></div>
    <div class="lib-search-row" style="padding:0 16px 10px">
      <svg class="lib-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="text" id="coll-member-search" class="lib-search-input" placeholder="Search exercises..." oninput="collRenderMemberSelectionList()" autocomplete="off" autocorrect="off" spellcheck="false">
    </div>
    <div id="coll-member-select-list" class="lib-list-container"></div>
  `;
  collRenderMemberSelectionList();
}

// Restrained inline explanation area -- reserved for validation blocks that need
// more than a toast (e.g. Display Exercise removal below). Never used for
// NEEDS ATTENTION, which stays reserved for future save-time Firestore conflicts.
function collShowMemberSelectionError(msg) {
  const el = document.getElementById('coll-member-select-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}
function collClearMemberSelectionError() {
  const el = document.getElementById('coll-member-select-error');
  if (!el) return;
  el.style.display = 'none';
  el.textContent = '';
}

function collRenderMemberSelectionList() {
  const listEl = document.getElementById('coll-member-select-list');
  if (!listEl) return;
  const searchEl = document.getElementById('coll-member-search');
  const q = searchEl ? searchEl.value.trim().toLowerCase() : '';
  const HIDDEN_CATS = ['Cardio', 'Full Body', 'Other'];

  let exs = getAllExercises().filter(ex => {
    const cats = getExCategories(ex);
    return !cats.every(cc => HIDDEN_CATS.includes(cc));
  });
  if (q) exs = exs.filter(ex => ex.name.toLowerCase().includes(q));
  exs.sort((a, b) => a.name.localeCompare(b.name));

  if (!exs.length) {
    listEl.innerHTML = `<div class="lib-empty"><div class="lib-empty-text">No Exercises Found</div></div>`;
    return;
  }

  listEl.innerHTML = exs.map(ex => {
    const selected = collMemberSelTemp.has(ex.id);
    const cats = sortCategories(getExCategories(ex));
    const badgesHtml = cats.filter(cc => CATEGORY_ABBREV[cc]).map(cc => `<span class="ex-row-cat-badge">${CATEGORY_ABBREV[cc]}</span>`).join('');
    return `<div class="ex-row coll-select-row${selected ? ' coll-select-row--selected' : ''}" onclick="collToggleMemberTemp('${ex.id}')">
      <div class="coll-select-check${selected ? ' coll-select-check--on' : ''}">${selected ? '&#10003;' : ''}</div>
      <div class="ex-row-main">
        <div class="ex-row-name">${escapeHtml(ex.name)}</div>
        <div class="ex-row-badges">${badgesHtml}</div>
      </div>
    </div>`;
  }).join('');
}

function collToggleMemberTemp(exId) {
  if (!collMemberSelTemp) return;
  if (collMemberSelTemp.has(exId)) collMemberSelTemp.delete(exId);
  else collMemberSelTemp.add(exId);
  collClearMemberSelectionError();
  collRenderMemberSelectionList();
}

function collCancelMemberSelection() {
  collClearMemberSelectionError();
  collMemberSelTemp = null;
  libraryRoute = { view: collEditorRouteView(), id: collectionDraft.id };
  renderLibraryRoute();
}

function collFinishMemberSelectionApply() {
  collClearMemberSelectionError();
  collMemberSelTemp = null;
  libraryRoute = { view: collEditorRouteView(), id: collectionDraft.id };
  renderLibraryRoute();
}

// -------- Complete Member Selection Apply reconciliation --------
function collApplyMemberSelection() {
  if (!collectionDraft || !collMemberSelTemp) return;

  const oldIds = collectionDraft.memberIds;
  const oldSet = new Set(oldIds);
  const newSet = collMemberSelTemp;
  const newIds = [...newSet];

  const additions = newIds.filter(id => !oldSet.has(id));
  const removals  = oldIds.filter(id => !newSet.has(id));

  const cons = collectionDraft.consolidation;
  const displayId = cons.enabled ? cons.displayExerciseId : null;
  const consolidatedIds = cons.enabled ? cons.consolidatedExerciseIds : [];

  // Case 1: Display Exercise removal blocks the ENTIRE Apply -- no partial
  // application of anything else in this pass.
  if (displayId && removals.includes(displayId)) {
    collShowMemberSelectionError(
      'The Display Exercise cannot be removed while List Consolidation is enabled. Restore it, or return to the Collection editor and reconfigure consolidation first.'
    );
    showToast('Cannot remove the Display Exercise', 'error');
    return; // collMemberSelTemp and collectionDraft both left exactly as they were
  }

  const consolidatedRemovals = removals.filter(id => consolidatedIds.includes(id));

  // Case 2: no consolidated members affected -- apply silently.
  if (consolidatedRemovals.length === 0) {
    collectionDraft.memberIds = newIds;
    void additions; // additions require no special handling beyond being included in newIds
    collFinishMemberSelectionApply();
    return;
  }

  const remainingConsolidated = consolidatedIds.filter(id => !consolidatedRemovals.includes(id));
  const names = consolidatedRemovals.map(id => { const ex = getExercise(id); return ex ? ex.name : id; });
  const nameList = names.join(', ');

  if (remainingConsolidated.length > 0) {
    // Case 3: at least one consolidated member remains after this removal.
    confirm2(
      'Remove Consolidated Members?',
      `${consolidatedRemovals.length} exercise(s) \u2014 ${nameList} \u2014 are consolidated members of this Collection. Removing them will also remove them from consolidation. Continue?`,
      () => {
        collectionDraft.memberIds = newIds;
        collectionDraft.consolidation.consolidatedExerciseIds = remainingConsolidated;
        collFinishMemberSelectionApply();
      },
      'Continue',
      false,
      () => { /* reject: leave collectionDraft and collMemberSelTemp completely untouched */ }
    );
  } else {
    // Case 4: every consolidated member is being removed -- combined disclosure.
    confirm2(
      'Disable List Consolidation?',
      `${consolidatedRemovals.length} exercise(s) \u2014 ${nameList} \u2014 are consolidated members of this Collection. Removing them will also disable List Consolidation for this Collection, since no consolidated members would remain. Continue?`,
      () => {
        collectionDraft.memberIds = newIds;
        collectionDraft.consolidation = { enabled: false, displayExerciseId: null, consolidatedExerciseIds: [] };
        collFinishMemberSelectionApply();
      },
      'Continue',
      false,
      () => { /* reject: leave collectionDraft and collMemberSelTemp completely untouched */ }
    );
  }
}

// ==================== CONSOLIDATION (nested editor) ====================
function collOpenConsolidation() {
  if (!collectionDraft) return;
  consolidationDraft = collDeepClone(collectionDraft.consolidation);
  consolidationDraft._lastEnabledSnapshot = null; // nested-only; never copied onto collectionDraft
  libraryRoute = { view: 'consolidation' };
  renderLibraryRoute();
}

function collRenderConsolidation() {
  const page = document.getElementById('page-db');
  if (!page || !collectionDraft || !consolidationDraft) return;

  const members = collectionDraft.memberIds.map(id => getExercise(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  const displayEx = consolidationDraft.displayExerciseId ? getExercise(consolidationDraft.displayExerciseId) : null;
  const eligibleForToggle = members.filter(ex => ex.id !== consolidationDraft.displayExerciseId);

  const memberToggleRows = consolidationDraft.enabled ? eligibleForToggle.map(ex => {
    const on = consolidationDraft.consolidatedExerciseIds.includes(ex.id);
    return `<div class="ex-row coll-select-row${on ? ' coll-select-row--selected' : ''}" onclick="collToggleConsolidatedMember('${ex.id}')">
      <div class="coll-select-check${on ? ' coll-select-check--on' : ''}">${on ? '&#10003;' : ''}</div>
      <div class="ex-row-main"><div class="ex-row-name">${escapeHtml(ex.name)}</div></div>
    </div>`;
  }).join('') : '';

  page.innerHTML = `
    ${collPageHeader('List Consolidation', `collCancelConsolidation()`, `<button class="btn btn-primary btn-sm" onclick="collApplyConsolidation()">Apply</button>`)}
    <div style="padding:16px">
      <div class="edit-check-row" style="justify-content:space-between;cursor:pointer" onclick="collToggleConsolidationEnabled()">
        <span>Enable List Consolidation</span>
        <span style="font-family:var(--font-display);font-weight:800;letter-spacing:0.06em;color:${consolidationDraft.enabled ? 'var(--accent)' : 'var(--text3)'}">${consolidationDraft.enabled ? 'ON' : 'OFF'}</span>
      </div>

      ${consolidationDraft.enabled ? `
        <div class="prof-section-label" style="margin:18px 0 8px">Display Exercise</div>
        <button class="btn btn-secondary" style="width:100%;text-align:left" onclick="collOpenChooseDisplay()">
          ${displayEx ? escapeHtml(displayEx.name) : 'Choose Display Exercise'}
        </button>

        <div class="prof-section-label" style="margin:18px 0 8px">Consolidated Members</div>
        ${members.length <= 1
          ? `<div class="lib-empty" style="padding:16px"><div class="lib-empty-text" style="font-size:13px">Add more members to this Collection first</div></div>`
          : (eligibleForToggle.length ? memberToggleRows : `<div class="lib-empty" style="padding:16px"><div class="lib-empty-text" style="font-size:13px">Choose a Display Exercise to reveal eligible members</div></div>`)}
      ` : `<div class="plan-profile-empty" style="margin-top:14px">Consolidation is off for this Collection.</div>`}
    </div>
  `;
}

function collToggleConsolidationEnabled() {
  if (!consolidationDraft) return;
  if (consolidationDraft.enabled) {
    confirm2(
      'Disable Consolidation?',
      'This clears the Display Exercise and consolidated members for this Collection. You can restore them if you re-enable during this visit.',
      () => {
        consolidationDraft._lastEnabledSnapshot = {
          displayExerciseId: consolidationDraft.displayExerciseId,
          consolidatedExerciseIds: [...consolidationDraft.consolidatedExerciseIds]
        };
        consolidationDraft.enabled = false;
        consolidationDraft.displayExerciseId = null;
        consolidationDraft.consolidatedExerciseIds = [];
        collRenderConsolidation();
      },
      'Disable',
      false
    );
  } else {
    consolidationDraft.enabled = true;
    if (consolidationDraft._lastEnabledSnapshot) {
      const snap = consolidationDraft._lastEnabledSnapshot;
      const validDisplay = snap.displayExerciseId && collectionDraft.memberIds.includes(snap.displayExerciseId);
      consolidationDraft.displayExerciseId = validDisplay ? snap.displayExerciseId : null;
      consolidationDraft.consolidatedExerciseIds = snap.consolidatedExerciseIds.filter(id =>
        collectionDraft.memberIds.includes(id) && id !== consolidationDraft.displayExerciseId
      );
    }
    collRenderConsolidation();
  }
}

function collToggleConsolidatedMember(exId) {
  if (!consolidationDraft) return;
  const idx = consolidationDraft.consolidatedExerciseIds.indexOf(exId);
  if (idx === -1) consolidationDraft.consolidatedExerciseIds.push(exId);
  else consolidationDraft.consolidatedExerciseIds.splice(idx, 1);
  collRenderConsolidation();
}

function collCancelConsolidation() {
  consolidationDraft = null;
  libraryRoute = { view: collEditorRouteView(), id: collectionDraft.id };
  renderLibraryRoute();
}

function collApplyConsolidation() {
  if (!consolidationDraft) return;
  if (consolidationDraft.enabled) {
    if (!consolidationDraft.displayExerciseId) { showToast('Choose a Display Exercise', 'error'); return; }
    if (!consolidationDraft.consolidatedExerciseIds.length) { showToast('Choose at least one consolidated member', 'error'); return; }
  }
  collectionDraft.consolidation = {
    enabled: consolidationDraft.enabled,
    displayExerciseId: consolidationDraft.enabled ? consolidationDraft.displayExerciseId : null,
    consolidatedExerciseIds: consolidationDraft.enabled ? [...consolidationDraft.consolidatedExerciseIds] : []
  };
  consolidationDraft = null;
  libraryRoute = { view: collEditorRouteView(), id: collectionDraft.id };
  renderLibraryRoute();
}

// ==================== CHOOSE DISPLAY EXERCISE (nested) ====================
function collOpenChooseDisplay() {
  if (!consolidationDraft) return;
  libraryRoute = { view: 'chooseDisplayExercise' };
  renderLibraryRoute();
}

function collChooseDisplayRows(query) {
  const q = (query || '').trim().toLowerCase();
  let members = collectionDraft.memberIds.map(id => getExercise(id)).filter(Boolean);
  if (q) members = members.filter(ex => ex.name.toLowerCase().includes(q));
  members.sort((a, b) => a.name.localeCompare(b.name));
  if (!members.length) return `<div class="lib-empty"><div class="lib-empty-text">No Members Found</div></div>`;
  return members.map(ex => {
    const selected = consolidationDraft.displayExerciseId === ex.id;
    return `<div class="ex-row coll-select-row${selected ? ' coll-select-row--selected' : ''}" onclick="collChooseDisplayExercise('${ex.id}')">
      <div class="coll-select-check${selected ? ' coll-select-check--on' : ''}">${selected ? '&#10003;' : ''}</div>
      <div class="ex-row-main"><div class="ex-row-name">${escapeHtml(ex.name)}</div></div>
    </div>`;
  }).join('');
}

function collRenderChooseDisplay() {
  const page = document.getElementById('page-db');
  if (!page || !collectionDraft || !consolidationDraft) return;
  page.innerHTML = `
    ${collPageHeader('Choose Display Exercise', `collBackToConsolidation()`, '')}
    <div class="lib-search-row" style="padding:0 16px 10px">
      <svg class="lib-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="text" id="coll-display-search" class="lib-search-input" placeholder="Search members..." oninput="collFilterChooseDisplay()" autocomplete="off" autocorrect="off" spellcheck="false">
    </div>
    <div id="coll-choose-display-list">${collChooseDisplayRows('')}</div>
  `;
}

function collFilterChooseDisplay() {
  const q = document.getElementById('coll-display-search')?.value || '';
  const listEl = document.getElementById('coll-choose-display-list');
  if (listEl) listEl.innerHTML = collChooseDisplayRows(q);
}

// Choosing a Display Exercise cannot leave it simultaneously listed as a
// consolidated member -- strip it from consolidatedExerciseIds if present.
function collChooseDisplayExercise(exId) {
  if (!consolidationDraft) return;
  consolidationDraft.displayExerciseId = exId;
  const idx = consolidationDraft.consolidatedExerciseIds.indexOf(exId);
  if (idx !== -1) consolidationDraft.consolidatedExerciseIds.splice(idx, 1);
  libraryRoute = { view: 'consolidation' };
  renderLibraryRoute();
}

function collBackToConsolidation() {
  libraryRoute = { view: 'consolidation' };
  renderLibraryRoute();
}
