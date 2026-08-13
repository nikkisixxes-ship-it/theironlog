// ==================== EXERCISE COLLECTIONS ====================
// Stage 2: converted the approved Stage 1B interface from temporary local data
// into durable, concurrency-safe Firestore data. Collection identity, membership,
// and consolidation configuration are persisted, with stale-edit detection,
// Reload Latest, Keep as New, and listener-isolated editable drafts.
//
// Stage 3A (current): List Consolidation is now visible and live in the shared
// Exercise List for valid, non-conflicting groups -- see the Visible Exercise
// projection in app-library.js (libVisibleExerciseProjection()) and the
// consolidation projection this file exposes through the adapter
// (collGetConsolidationProjection()). The reverse membership index's
// consolidationRole field is now transactionally maintained on Collection
// create/save/delete (collComputeMembershipWrite()/collDesiredRoleFor()),
// including a hard abort -- never a silent overwrite -- if a save would claim a
// role another Collection already holds. Ambiguous claims (an Exercise claimed by
// more than one enabled Collection) always fail open: the Exercise stays
// individually visible and no winner is chosen.
//
// Stage 3B (deferred, not implemented here): transfers between consolidation
// groups, TRANSFER/TRANSFER PENDING/UNAVAILABLE conflict-resolution UI, full
// live cross-Collection save-time validation, and custom-Exercise-deletion
// coupling with consolidation.
//
// Ownership (unchanged since Stage 1A/1B):
//   app-library.js owns the shared browser shell, purpose/context/target dispatch,
//     the Exercises pipeline (including the visible-Exercise projection and
//     Variants row rendering), and Exercise Profile/Edit/Create.
//   app-collections.js (this file) owns Collections-mode list/drilled-in rendering
//     (via the one registered adapter), every full-page Library Collection screen,
//     the Collection draft model and its persistence, the Library route model,
//     the unsaved-change predicate/discard helper that app-core.js's showPage()
//     guard calls into, and the read-only consolidation projection.
// The coupling is one-directional: app-collections.js calls app-library.js's
// existing exported functions freely; app-library.js never calls a coll... function
// directly, only through the libRegisterCollectionsAdapter(...) contract.
//
// The Collection document (users/{uid}/exerciseCollections/{id}) is authoritative.
// The reverse membership index (users/{uid}/exerciseCollectionMembership/{exerciseId})
// is derived integrity data only -- never loaded into appDb, never listened to,
// never rendered directly (the Exercise List reads appDb.exerciseCollections, not
// this index), and every write to it uses a complete tx.set() (never tx.update(),
// since the document may not exist yet) computed from a read that happened before
// any write in the same transaction.


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
// app-core.js's showPage(), and the listener-isolation check below.
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

// Explicit draft identity (Stage 2, Section 7) -- replaces the old Stage 1B
// inference ("does this id already exist in the temp array?"), which stopped being
// reliable once a listener, a UID-collision retry, or Keep-as-New could all change
// what "exists" means out from under that inference.
let collectionDraftMode = null; // 'new' | 'edit'

// Immutable canonical snapshot of the Collection as it was when Edit opened (or as
// of the last successful Reload Latest). Never touched by the COL_EX_COLLECTIONS
// listener, never touched by ordinary draft edits -- this is what every save
// transaction compares the live document against (Section 10/13).
let collectionServerBaseline = null;

// null | 'changed' | 'deleted' -- set only by an authoritative save-transaction
// result (or a Reload Latest read), never by a listener event alone (Section 18).
let collectionConflictState = null;

// True while a create/save/delete/reload operation is awaiting Firestore. Guards
// against duplicate submissions from a second tap; does not otherwise block
// unrelated navigation.
let collPendingOperation = false;

let consolidationDraft = null; // nested Consolidation-editor draft; owns its own restoration snapshot
let collMemberSelTemp  = null; // Set<exerciseId> -- Member Selection's temporary selection

let collActiveId = null; // id of the Collection open in collectionDetail/editCollection (Library only)
let collReturnTo = null; // { type:'browser' } | { type:'collectionDetail', id } | { type:'trainOrPlanCaller' }

function collDeepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

// Local dirty check -- intentionally separate from the Firestore staleness check
// (collectionServerBaseline / collProjectionsEqual below). Same-process,
// same-serialization comparison; safe as a raw string compare because it never
// crosses a network/round-trip boundary.
function isCollectionDraftDirty() {
  return !!collectionDraft && JSON.stringify(collectionDraft) !== collectionDraftSnapshot;
}

// Clears the primary draft and every piece of state scoped to one editing visit:
// snapshot/origin/mode/server-baseline/conflict-state, the nested Consolidation
// draft, and the Member Selection temp state. Deliberately does not touch
// libraryRoute, collActiveId, or collReturnTo -- callers decide the resulting
// route/context (e.g. discarding out of Edit returns to that Collection's Detail;
// discarding out of New returns to the plain browser). Does not touch
// collPendingOperation, which is a separate in-flight-request flag owned by
// whichever transaction function is currently running.
function discardCollectionDraft() {
  collectionDraft = null;
  collectionDraftSnapshot = null;
  collectionDraftOrigin = null;
  collectionDraftMode = null;
  collectionServerBaseline = null;
  collectionConflictState = null;
  consolidationDraft = null;
  collMemberSelTemp = null;
}

// Which editor route a nested screen (Member Selection / Consolidation / Choose
// Display) should return to. Driven by the explicit collectionDraftMode, never by
// re-inferring "does this id exist yet" from appDb -- that inference is exactly
// what Section 7 identifies as unreliable once listeners/retries/Keep-as-New exist.
function collEditorRouteView() {
  return collectionDraftMode === 'new' ? 'newCollection' : 'editCollection';
}

// ==================== appDb.exerciseCollections -- CANONICAL SOURCE (Stage 2) ====================
// No more collTempCollections. A user with no persisted Collections sees appDb.exerciseCollections
// as an empty array, which is exactly the existing empty-Collections UI -- no special-casing needed.
function collFindCollection(id) { return appDb.exerciseCollections.find(c => c.id === id) || null; }

// ==================== CANONICAL NORMALIZATION / COMPARISON (Section 10) ====================

// Produces a normalized, deduplicated Collection object. Does not decide display
// order (A-Z sort happens at render time) -- only removes duplicate array entries,
// which would otherwise be meaningless noise in both persistence and comparison.
function collNormalizeCollection(payload) {
  const cons = (payload && payload.consolidation) || {};
  return {
    id: payload.id,
    name: payload.name || '',
    memberIds: Array.from(new Set((payload.memberIds || []).filter(Boolean))),
    consolidation: {
      enabled: !!cons.enabled,
      displayExerciseId: cons.displayExerciseId || null,
      consolidatedExerciseIds: Array.from(new Set((cons.consolidatedExerciseIds || []).filter(Boolean)))
    },
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt
  };
}

// Fixed-key, sorted-array projection used for every stale-edit comparison. Built
// from the SAME function on both sides of every comparison, so JSON.stringify of
// the two projections is a safe, deterministic equality check -- array order and
// duplicate entries can never produce a false "changed" result; a real difference
// in name/membership/consolidation/id/createdAt/updatedAt always can.
function collComparableProjection(payload) {
  const norm = collNormalizeCollection(payload);
  return {
    id: norm.id,
    name: norm.name,
    memberIds: [...norm.memberIds].sort(),
    consolidationEnabled: norm.consolidation.enabled,
    displayExerciseId: norm.consolidation.displayExerciseId,
    consolidatedExerciseIds: [...norm.consolidation.consolidatedExerciseIds].sort(),
    createdAt: norm.createdAt,
    updatedAt: norm.updatedAt
  };
}

function collProjectionsEqual(a, b) {
  return JSON.stringify(collComparableProjection(a)) === JSON.stringify(collComparableProjection(b));
}

// Synchronous local reconciliation into appDb -- called immediately after a
// successful create/save/reload, never deferred to the listener (Section 9/12/14/21).
function collReconcileIntoAppDb(payload) {
  const idx = appDb.exerciseCollections.findIndex(c => c.id === payload.id);
  if (idx === -1) appDb.exerciseCollections.push(payload);
  else appDb.exerciseCollections[idx] = payload;
}
function collRemoveFromAppDb(id) {
  appDb.exerciseCollections = appDb.exerciseCollections.filter(c => c.id !== id);
}

// Duplicate-name normalization (Section 23): trim, collapse internal whitespace,
// lowercase. Punctuation and word order remain meaningful.
function collNormalizeNameForDuplicateCompare(name) {
  return (name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}
function collFindDuplicateName(name, excludeId) {
  const norm = collNormalizeNameForDuplicateCompare(name);
  if (!norm) return null;
  return appDb.exerciseCollections.find(c =>
    c.id !== excludeId && collNormalizeNameForDuplicateCompare(c.name) === norm
  ) || null;
}

// Coarse failure classification -- just enough to choose between the two approved
// copy variants (Section 24). Not a general-purpose Firestore error taxonomy.
function collClassifyPersistenceFailure(err) {
  const code = (err && err.code) || '';
  const msg = ((err && err.message) || '').toLowerCase();
  if (code === 'unavailable' || code === 'deadline-exceeded' || msg.includes('offline') || msg.includes('network')) {
    return 'offline';
  }
  return 'general';
}
function collFailureMessage(action, reason) {
  if (reason === 'offline') {
    if (action === 'save')   return 'Could not save the Collection. Check your connection and try again.';
    if (action === 'delete') return 'Could not delete the Collection. Check your connection and try again.';
    return 'Could not load the latest Collection. Check your connection and try again.';
  }
  if (action === 'save')   return 'The Collection could not be saved. Try again.';
  if (action === 'delete') return 'The Collection could not be deleted. Try again.';
  return 'The Collection could not be loaded. Try again.';
}

// ==================== REVERSE MEMBERSHIP-INDEX RECONCILIATION (Section 6/15) ====================
// Every affected exercise's index document is read (inside the transaction) before
// any write is issued -- always in a discrete read phase, then a discrete write
// phase, never interleaved per-exercise.

async function collReadMembershipDocs(tx, exerciseIds) {
  const uniqueIds = Array.from(new Set(exerciseIds));
  const entries = new Map();
  for (const exId of uniqueIds) {
    const ref = COL_EX_COLLECTION_MEMBERSHIP.doc(exId);
    const snap = await tx.get(ref);
    entries.set(exId, {
      exerciseId: exId,
      ref,
      data: snap.exists ? snap.data() : { exerciseId: exId, memberOfCollectionIds: [], consolidationRole: null }
    });
  }
  return entries;
}

// Computes (does not perform) the write for one exercise's index document, given
// whether it should be a member of `collectionId` after this operation, and
// `desiredRole` (null | 'display' | 'member') -- the role THIS Collection wants to
// claim for this Exercise after the save, derived from its own consolidation
// config by desiredRoleFor() below. Always a complete tx.set() with a freshly
// computed document -- never tx.update(), since the document may not have existed
// before this call.
//
// Stage 3A role rules:
//   - If desiredRole is set and no role exists yet (or the existing role already
//     belongs to this same Collection), claim/update it.
//   - If desiredRole is set and an existing role belongs to a DIFFERENT
//     Collection, this is a foreign-role conflict -- Stage 3A never overwrites
//     another Collection's claim. Throws, which aborts the whole transaction
//     atomically (no partial save) via the caller's normal transaction-failure
//     handling; this is deliberately not a new UI state, just the smallest
//     existing non-destructive error treatment.
//   - If desiredRole is null and the existing role belongs to THIS Collection,
//     clear it (disabling consolidation / removing this Exercise from
//     consolidation / removing it from membership all reach this path).
//   - If desiredRole is null and the existing role belongs to a different
//     Collection (or there is none), leave it completely untouched.
function collComputeMembershipWrite(entry, collectionId, isMember, desiredRole) {
  let ids = Array.from(new Set((entry.data.memberOfCollectionIds || []).filter(Boolean)));
  if (isMember) {
    if (!ids.includes(collectionId)) ids.push(collectionId);
  } else {
    ids = ids.filter(cid => cid !== collectionId);
  }
  ids.sort();

  const existingRole = entry.data.consolidationRole || null;
  let newRole = existingRole;

  if (desiredRole) {
    if (existingRole && existingRole.collectionId !== collectionId) {
      const err = new Error('Exercise is already claimed by another Collection\'s consolidation');
      err.collReason = 'foreignRoleConflict';
      err.exerciseId = entry.exerciseId;
      err.foreignCollectionId = existingRole.collectionId;
      throw err;
    }
    newRole = { collectionId, role: desiredRole };
  } else if (existingRole && existingRole.collectionId === collectionId) {
    newRole = null;
  }
  // else: a foreign role (or no role) and this Collection isn't claiming one --
  // left completely untouched, per "never clear or overwrite a foreign role."

  if (ids.length === 0 && !newRole) {
    return { ref: entry.ref, action: 'delete' };
  }
  return {
    ref: entry.ref,
    action: 'set',
    data: {
      exerciseId: entry.exerciseId,
      memberOfCollectionIds: ids,
      consolidationRole: newRole,
      updatedAt: Date.now()
    }
  };
}

// Derives the role (if any) `payload`'s own consolidation config claims for
// exId, trusting collValidateDraftForSave()'s already-enforced shape (exactly
// one Display, consolidated members disjoint from it) -- this only mirrors
// what the Collection document itself says, it does not re-validate.
function collDesiredRoleFor(exId, payload) {
  const cons = payload.consolidation;
  if (!cons || !cons.enabled) return null;
  if (cons.displayExerciseId === exId) return 'display';
  if (cons.consolidatedExerciseIds.includes(exId)) return 'member';
  return null;
}
function collApplyMembershipWrites(tx, writes) {
  writes.forEach(w => {
    if (w.action === 'set') tx.set(w.ref, w.data);
    else tx.delete(w.ref);
  });
}

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

// ==================== COL_EX_COLLECTIONS LISTENER ISOLATION (Section 9) ====================
// Called by app-core.js's setupListeners() AFTER appDb.exerciseCollections has
// already been updated unconditionally. This function decides only whether it is
// currently safe to re-render, using the same route/modal state the rest of this
// file already tracks -- no parallel routing system.
function collHandleCollectionsSnapshotUpdate() {
  // Editable routes are never touched by a listener event -- only an authoritative
  // save/delete/reload result may change what they show. Draft, dirty snapshot,
  // server baseline, conflict state, nested temp state, DOM, focus, search, and
  // scroll position are all left completely alone.
  if (isEditableLibraryRoute(libraryRoute)) return;

  const onLibraryPage = typeof activePage === 'function' && activePage() === 'page-db';
  const browserModalEl = document.getElementById('modal-ex-browser');
  const browserModalOpen = !!(browserModalEl && browserModalEl.classList.contains('open'));

  // LIBRARY: the Collections browser or Collection Detail.
  if (onLibraryPage && (libraryRoute.view === 'browser' || libraryRoute.view === 'collectionDetail')) {
    if (libraryRoute.view === 'collectionDetail' && !collFindCollection(libraryRoute.id)) {
      // The Collection being viewed was deleted elsewhere -- fall back to the
      // browser safely rather than rendering a dead end.
      libraryRoute = { view: 'browser' };
      collActiveId = null;
      collReturnTo = null;
    }
    renderLibraryRoute();
    return;
  }

  // TRAIN/PLAN: the shared Exercise Browser modal. Safe to refresh regardless of
  // which target it's currently showing -- Collections-mode content (list/focused
  // member view) exactly as before, and now also the Exercises-mode list itself,
  // since a remote Collection change can change what it shows (Stage 3A
  // consolidation) and must be reflected without a manual refresh.
  if (browserModalOpen) {
    if (libBrowseTarget === 'collections' && libCollectionDrill && !collFindCollection(libCollectionDrill.collectionId)) {
      libCollectionDrill = null; // deleted elsewhere -- return to the list, not a dead focused view
    }
    libRenderBrowserContent();
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

  let rows = appDb.exerciseCollections.map(c => {
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

// ==================== CONSOLIDATION PROJECTION (Stage 3A) ====================
// Pure, read-only derivation from appDb.exerciseCollections -- never mutates
// appDb, never rewrites a Collection document, never touches the reverse
// membership index. Recomputed fresh on every call (cheap at this app's scale;
// avoids any risk of a stale cached projection).
//
// A "valid enabled consolidation group" requires: consolidation.enabled; exactly
// one displayExerciseId which is a current Collection member and resolves to a
// real Exercise; at least one consolidatedExerciseId that is a current member,
// resolves to a real Exercise, and is not the Display Exercise itself.
//
// Two-stage, so a malformed competing Collection can still contest an Exercise ID:
//   Stage 1 (claim detection) -- for every ENABLED Collection, regardless of
//     whether its own consolidation is otherwise valid, gather its nonempty
//     configured Display + consolidated Exercise IDs (deduplicated within that
//     one Collection, so a Collection can't contest itself via a repeated ID).
//     An Exercise ID claimed by more than one DISTINCT Collection is contested.
//     This must happen before any validity filtering -- a Collection that is
//     itself malformed (unresolvable member, nonmember ID, etc.) still counts as
//     a claimant, because otherwise it would silently vanish from ambiguity
//     detection precisely because it was malformed, letting some OTHER, valid
//     group suppress an Exercise that was genuinely contested.
//   Stage 2 (group validity + projection) -- only now are the existing
//     shape-validity checks applied, and the projection is built using the
//     contested set computed in Stage 1. A contested Display Exercise makes that
//     whole group unusable; a contested consolidated member is simply excluded
//     from suppression (remains individually visible, and is not counted toward
//     its Display's Variants total) -- no winner is ever chosen either way.
function collGetConsolidationProjection() {
  const collections = Array.isArray(appDb.exerciseCollections) ? appDb.exerciseCollections : [];

  // ---- Stage 1: claim detection, independent of group validity ----
  const claimants = new Map(); // exerciseId -> Set<collectionId>
  function recordClaim(exId, collectionId) {
    if (!claimants.has(exId)) claimants.set(exId, new Set());
    claimants.get(exId).add(collectionId);
  }
  for (const c of collections) {
    const cons = c && c.consolidation;
    if (!c || !cons || !cons.enabled) continue;
    const claimedIds = new Set(); // dedupe WITHIN this one Collection first
    if (cons.displayExerciseId) claimedIds.add(cons.displayExerciseId);
    (Array.isArray(cons.consolidatedExerciseIds) ? cons.consolidatedExerciseIds : []).forEach(id => { if (id) claimedIds.add(id); });
    claimedIds.forEach(id => recordClaim(id, c.id));
  }
  const contested = new Set();
  claimants.forEach((collectionIds, exId) => { if (collectionIds.size > 1) contested.add(exId); });

  // ---- Stage 2: existing group-validity checks, then projection construction
  // using the Stage 1 contested set (never a set derived only from valid groups) ----
  const groups = []; // { collectionId, displayId, memberIds: [] } -- shape-valid groups only
  for (const c of collections) {
    const cons = c && c.consolidation;
    if (!c || !cons || !cons.enabled) continue;

    const displayId = cons.displayExerciseId;
    const memberIds = Array.isArray(c.memberIds) ? c.memberIds : [];
    const consolidatedIds = Array.isArray(cons.consolidatedExerciseIds) ? cons.consolidatedExerciseIds : [];

    if (!displayId) continue;                                   // no Display Exercise -- fail open
    if (!memberIds.includes(displayId)) continue;                // Display must be a current member
    if (consolidatedIds.includes(displayId)) continue;           // Display cannot also be a consolidated member
    if (!getExercise(displayId)) continue;                       // Display must resolve to a real Exercise

    const validMemberIds = Array.from(new Set(consolidatedIds.filter(Boolean)))
      .filter(id => id !== displayId && memberIds.includes(id) && !!getExercise(id));
    if (!validMemberIds.length) continue;                        // nothing left to consolidate -- fail open

    groups.push({ collectionId: c.id, displayId, memberIds: validMemberIds });
  }

  const projection = new Map();
  groups.forEach(g => {
    if (contested.has(g.displayId)) return; // Display itself is contested -- whole group unusable, fail open
    const survivingMemberIds = g.memberIds.filter(id => !contested.has(id));
    if (!survivingMemberIds.length) return; // every consolidated member was contested -- Display shows plain, no Variants
    projection.set(g.displayId, { role: 'display', collectionId: g.collectionId, memberCount: survivingMemberIds.length });
    survivingMemberIds.forEach(id => projection.set(id, { role: 'member', collectionId: g.collectionId, displayExerciseId: g.displayId }));
  });

  return projection;
}

// Context-aware "open controlling Collection" operation for the Variants
// affordance (Section: Variants navigation). Reuses the existing
// collOpenFromBrowser() Library/TRAIN/PLAN branching exactly as a Collections-list
// row tap would -- no second Collection Detail implementation. Forcing
// libBrowseTarget to 'collections' first ensures Back subsequently returns to the
// Collections-mode list rather than jumping straight back to the Exercise List,
// per the approved Library navigation requirement.
function collOpenControllingCollectionFromVariants(collectionId) {
  libBrowseTarget = 'collections';
  collOpenFromBrowser(collectionId);
}

// Explicit, one-directional registration -- app-library.js throws if this hasn't
// run before Collections mode is used, rather than silently rendering nothing.
// getConsolidationProjection/openControllingCollection are the minimal Stage 3A
// extension: a read-only consolidation lookup and a context-aware "open the
// controlling Collection" operation, so app-library.js's Exercise List and
// Randomize never call a coll... function directly.
libRegisterCollectionsAdapter({
  renderList: collRenderCollectionsList,
  renderFocusedMember: collRenderFocusedMember,
  openMenu: collOpenMenuDropdown,
  getConsolidationProjection: collGetConsolidationProjection,
  openControllingCollection: collOpenControllingCollectionFromVariants
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
// For a New draft, `id`/`createdAt`/`updatedAt` are local placeholders only -- they
// are never treated as committed identity (collectionDraftMode is explicitly 'new',
// never inferred from these fields) and the create transaction below establishes
// the real committed id/timestamps independently, generating a fresh id on the fly
// if this placeholder happens to collide.
function collBeginNewDraft() {
  collectionDraft = {
    id: uid(),
    name: '',
    memberIds: [],
    consolidation: { enabled: false, displayExerciseId: null, consolidatedExerciseIds: [] },
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  collectionDraftMode = 'new';
  collectionServerBaseline = null;
  collectionConflictState = null;
  collectionDraftSnapshot = JSON.stringify(collectionDraft);
  collectionDraftOrigin = collReturnTo || { type: 'browser' };
}

function collBeginEditDraft(id) {
  const c = collFindCollection(id);
  if (!c) return;
  collectionDraft = collDeepClone(c);
  collectionDraftMode = 'edit';
  // Immutable snapshot at open time -- a later listener update to appDb must never
  // alter this; every save transaction compares fresh live data against THIS.
  collectionServerBaseline = collDeepClone(c);
  collectionConflictState = null;
  collectionDraftSnapshot = JSON.stringify(collectionDraft);
  collectionDraftOrigin = { type: 'collectionDetail', id };
}

// ==================== NEW / EDIT COLLECTION (shared editor screen) ====================
function collRenderEditor() {
  const page = document.getElementById('page-db');
  if (!page || !collectionDraft) return;
  const isNew = collectionDraftMode === 'new';

  const members = collectionDraft.memberIds.map(id => getExercise(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  const memberListHtml = members.length
    ? members.map(ex => `<div class="ex-row" style="cursor:default">
        <div class="ex-row-main"><div class="ex-row-name">${escapeHtml(ex.name)}</div></div>
      </div>`).join('')
    : `<div class="lib-empty" style="padding:22px 12px"><div class="lib-empty-text" style="font-size:14px">No Members Yet</div></div>`;

  const staleHtml = collectionConflictState ? collStalePanelHtml() : '';
  const saveDisabled = collPendingOperation || !!collectionConflictState;
  const saveLabel = collPendingOperation ? 'Saving\u2026' : 'Save';
  // While create/save/delete/Reload Latest is in flight, the entire editor is
  // visibly read-only -- every control that could mutate the draft or enter a
  // nested editor is disabled. The matching functions below (collUpdateDraftName,
  // collOpenMemberSelection, collOpenConsolidation) also refuse to act while
  // pending, so this is not merely cosmetic: DOM manipulation or a rapid input
  // event firing before re-render can't bypass it.
  const readOnly = collPendingOperation;

  const deleteBtnHtml = !isNew ? `
    <div class="prof-divider" style="margin:24px 0 14px"></div>
    <button class="btn btn-danger" style="width:100%" onclick="collConfirmDeleteCollection()" ${readOnly ? 'disabled' : ''}>Delete Collection</button>
  ` : '';

  page.innerHTML = `
    ${collPageHeader(isNew ? 'New Collection' : 'Edit Collection', `collExitEditor()`, `<button class="btn btn-primary btn-sm" onclick="collSaveDraft()" ${saveDisabled ? 'disabled' : ''}>${saveLabel}</button>`)}
    ${staleHtml}
    <div style="padding:16px">
      <div class="form-group">
        <label>Collection Name</label>
        <input type="text" id="coll-name-input" value="${escapeHtml(collectionDraft.name)}" placeholder="e.g. Bench Press Variants" oninput="collOnNameInput(this.value)" ${readOnly ? 'disabled' : ''}>
      </div>
      <div id="coll-dup-name-warning">${collDuplicateNameWarningHtml(collectionDraft.name)}</div>

      <div class="prof-section-label" style="margin:18px 0 8px">Members (${collectionDraft.memberIds.length})</div>
      ${memberListHtml}
      <button class="btn btn-secondary" style="width:100%;margin-top:8px" onclick="collOpenMemberSelection()" ${readOnly ? 'disabled' : ''}>Manage Members</button>

      <div class="prof-divider" style="margin:20px 0"></div>

      <div class="prof-section-label" style="margin-bottom:8px">Exercise List Consolidation</div>
      ${collConsolidationSummaryHtml(collectionDraft)}
      <button class="btn btn-secondary" style="width:100%;margin-top:8px" onclick="collOpenConsolidation()" ${readOnly ? 'disabled' : ''}>Configure</button>
      ${deleteBtnHtml}
    </div>
  `;
}

// Patches the name and the duplicate-name warning directly, without remounting the
// editor -- so typing never loses input focus (Section 23, last requirement).
// Guarded against collPendingOperation so a rapid input event (or direct DOM/
// console manipulation of the disabled attribute) cannot mutate the draft while
// a create/save/delete/reload is in flight -- the disabled attribute above is a
// visual affordance, this guard is the actual enforcement.
function collUpdateDraftName(val) {
  if (!collectionDraft || collPendingOperation) return;
  collectionDraft.name = val;
}
function collOnNameInput(val) {
  if (collPendingOperation) return;
  collUpdateDraftName(val);
  const el = document.getElementById('coll-dup-name-warning');
  if (el) el.innerHTML = collDuplicateNameWarningHtml(val);
}

// Blue, informational only -- never disables Save, never requires confirmation,
// never uses NEEDS ATTENTION. Recalculated on every intentional render (editor
// mount, Reload Latest, Keep as New) and directly on name input.
function collDuplicateNameWarningHtml(name) {
  const excludeId = collectionDraftMode === 'edit' && collectionDraft ? collectionDraft.id : null;
  const match = collFindDuplicateName(name, excludeId);
  if (!match) return '';
  return `<div class="coll-dup-warning">
    <div class="coll-dup-warning-label">Duplicate Name</div>
    <div class="coll-dup-warning-val">Another Collection is already named \u201c${escapeHtml(match.name)}.\u201d Collection names do not need to be unique.</div>
  </div>`;
}

// Amber NEEDS ATTENTION panel -- Edit Collection only, never on nested routes.
function collStalePanelHtml() {
  if (collectionConflictState === 'deleted') {
    return `<div class="coll-attention-panel">
      <div class="coll-attention-title">NEEDS ATTENTION</div>
      <div class="coll-attention-body">This Collection was deleted elsewhere after you began editing. Your draft has been preserved, but it can no longer be saved as the same Collection.</div>
      <div class="coll-attention-actions">
        <button class="btn btn-secondary btn-sm" onclick="collKeepAsNew()" ${collPendingOperation ? 'disabled' : ''}>Keep as New</button>
      </div>
    </div>`;
  }
  return `<div class="coll-attention-panel">
    <div class="coll-attention-title">NEEDS ATTENTION</div>
    <div class="coll-attention-body">This Collection changed elsewhere after you began editing. Your draft has been preserved, but it cannot replace the newer saved version.</div>
    <div class="coll-attention-actions">
      <button class="btn btn-secondary btn-sm" onclick="collReloadLatest()" ${collPendingOperation ? 'disabled' : ''}>Reload Latest</button>
      <button class="btn btn-secondary btn-sm" onclick="collKeepAsNew()" ${collPendingOperation ? 'disabled' : ''}>Keep as New</button>
    </div>
  </div>`;
}

// Shared "leave the editable flow" behavior for both New and Edit: clean draft
// (or none) proceeds immediately; a dirty draft is guarded by a Collection-specific
// confirmation. Internal movement between the editor and its own nested screens
// (Member Selection / Consolidation / Choose Display) never calls this -- only
// leaving the editable flow entirely does. Works unchanged while stale (a stale
// draft is still dirty, so normal exit protection remains active -- Section 20).
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

// ==================== LOCAL VALIDATION (Section 11) ====================
function collValidateDraftForSave(draft) {
  const name = (draft.name || '').trim();
  if (!name) return { ok: false, message: 'Enter a Collection name' };
  const cons = draft.consolidation;
  if (cons.enabled) {
    if (!cons.displayExerciseId) return { ok: false, message: 'Choose a Display Exercise before saving' };
    if (!cons.consolidatedExerciseIds.length) return { ok: false, message: 'Add at least one consolidated member before saving' };
    if (!draft.memberIds.includes(cons.displayExerciseId)) return { ok: false, message: 'Display Exercise must be a Collection member' };
    if (!cons.consolidatedExerciseIds.every(id => draft.memberIds.includes(id))) return { ok: false, message: 'All consolidated members must be Collection members' };
    if (cons.consolidatedExerciseIds.includes(cons.displayExerciseId)) return { ok: false, message: 'Display Exercise cannot also be a consolidated member' };
  }
  return { ok: true };
}

// Builds a committed-shape payload from a CLONE of the draft -- never mutates
// collectionDraft itself (Section 11, last requirement). Trims the name; does not
// otherwise rewrite capitalization/punctuation/internal spacing.
function collBuildPersistablePayload(draft) {
  return {
    id: draft.id,
    name: (draft.name || '').trim(),
    memberIds: Array.from(new Set((draft.memberIds || []).filter(Boolean))),
    consolidation: {
      enabled: !!draft.consolidation.enabled,
      displayExerciseId: draft.consolidation.enabled ? draft.consolidation.displayExerciseId : null,
      consolidatedExerciseIds: draft.consolidation.enabled
        ? Array.from(new Set((draft.consolidation.consolidatedExerciseIds || []).filter(Boolean)))
        : []
    },
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt
  };
}

// ==================== SAVE -- dispatches to create (New) or save (Edit) (Section 12/14) ====================
function collSaveDraft() {
  if (!collectionDraft || collPendingOperation) return;
  if (collectionDraftMode === 'edit' && collectionConflictState) return; // Save disabled both visually and behaviorally while stale
  const validation = collValidateDraftForSave(collectionDraft);
  if (!validation.ok) { showToast(validation.message, 'error'); return; }
  if (collectionDraftMode === 'new') return collSaveNewCollection();
  return collSaveExistingCollection();
}

// ---- Create transaction (Section 12) ----
async function collRunCreateTransactionAttempt(payload) {
  return fsDb.runTransaction(async (tx) => {
    const ref = COL_EX_COLLECTIONS.doc(payload.id);
    const snap = await tx.get(ref);
    if (snap.exists) {
      const err = new Error('Collection id collision');
      err.collReason = 'uidCollision';
      throw err;
    }
    const membershipEntries = await collReadMembershipDocs(tx, payload.memberIds);
    // -- read phase complete; no writes issued above this line --
    const writes = payload.memberIds.map(exId => collComputeMembershipWrite(membershipEntries.get(exId), payload.id, true, collDesiredRoleFor(exId, payload)));
    tx.set(ref, payload);
    collApplyMembershipWrites(tx, writes);
    return payload;
  });
}

async function collCreateCollectionTransaction(draft) {
  // `draft` is expected to already be an immutable clone captured by the caller
  // before persistence began (collSaveNewCollection) -- this function never reads
  // the live collectionDraft, so nothing that happens to collectionDraft after
  // this point (which the pending-operation guards above prevent anyway) can
  // affect what actually gets committed, including across retries.
  const MAX_RETRIES = 5;
  let lastErr = null;
  // The first durable candidate ID is generated here, at Save time, via uid() --
  // never the New Collection editor's temporary placeholder draft.id, which was
  // only ever a local value that must not be mistaken for committed identity.
  let candidateId = uid();
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const now = Date.now(); // established fresh here, not reused from the draft's local placeholder
    const payload = {
      id: candidateId,
      name: (draft.name || '').trim(),
      memberIds: Array.from(new Set((draft.memberIds || []).filter(Boolean))),
      consolidation: {
        enabled: !!draft.consolidation.enabled,
        displayExerciseId: draft.consolidation.enabled ? draft.consolidation.displayExerciseId : null,
        consolidatedExerciseIds: draft.consolidation.enabled
          ? Array.from(new Set((draft.consolidation.consolidatedExerciseIds || []).filter(Boolean)))
          : []
      },
      createdAt: now,
      updatedAt: now
    };
    try {
      const committed = await collRunCreateTransactionAttempt(payload);
      return { ok: true, payload: committed };
    } catch (err) {
      if (err && err.collReason === 'uidCollision') {
        lastErr = err;
        candidateId = uid(); // regenerate and retry; the submitted clone itself is never touched
        continue;
      }
      return { ok: false, reason: collClassifyPersistenceFailure(err), error: err };
    }
  }
  return { ok: false, reason: 'general', error: lastErr };
}

async function collSaveNewCollection() {
  // Capture an immutable clone of exactly what the user submitted, before
  // persistence begins. Every create attempt -- including UID-collision retries --
  // is built from this clone, never from collectionDraft directly; combined with
  // the pending-operation guards on every draft-mutating control, this makes it
  // impossible for anything committed to reflect a change made after Save was
  // pressed.
  const submittedDraft = collDeepClone(collectionDraft);

  collPendingOperation = true;
  collRenderEditor();

  const result = await collCreateCollectionTransaction(submittedDraft);
  collPendingOperation = false;

  if (!result.ok) {
    collRenderEditor(); // draft, route, and appDb all untouched -- purely a re-render to clear the pending state
    showToast(collFailureMessage('save', result.reason), 'error');
    return;
  }

  collReconcileIntoAppDb(result.payload);
  const savedId = result.payload.id;
  discardCollectionDraft();
  collActiveId = savedId;
  libraryRoute = { view: 'collectionDetail', id: savedId };
  renderLibraryRoute();
  showToast('Collection saved', 'success');
}

// ---- Existing-Collection save transaction (Section 14) ----
async function collSaveExistingCollection() {
  const proposedPayload = collBuildPersistablePayload(collectionDraft);
  const baseline = collectionServerBaseline;

  collPendingOperation = true;
  collRenderEditor();

  let result;
  try {
    result = await fsDb.runTransaction(async (tx) => {
      const ref = COL_EX_COLLECTIONS.doc(proposedPayload.id);
      const snap = await tx.get(ref);
      if (!snap.exists) {
        const err = new Error('Collection deleted elsewhere');
        err.collReason = 'deletedStale';
        throw err;
      }
      const live = snap.data();
      if (!collProjectionsEqual(live, baseline)) {
        const err = new Error('Collection changed elsewhere');
        err.collReason = 'changedStale';
        throw err;
      }
      const affectedIds = Array.from(new Set([...(live.memberIds || []), ...proposedPayload.memberIds]));
      const membershipEntries = affectedIds.length ? await collReadMembershipDocs(tx, affectedIds) : new Map();
      // -- read phase complete; no writes issued above this line --
      const finalPayload = Object.assign({}, proposedPayload, { createdAt: live.createdAt, updatedAt: Date.now() });
      const memberSet = new Set(finalPayload.memberIds);
      const writes = affectedIds.map(exId => collComputeMembershipWrite(membershipEntries.get(exId), finalPayload.id, memberSet.has(exId), memberSet.has(exId) ? collDesiredRoleFor(exId, finalPayload) : null));
      tx.set(ref, finalPayload);
      collApplyMembershipWrites(tx, writes);
      return finalPayload;
    });
  } catch (err) {
    collPendingOperation = false;
    if (err && err.collReason === 'deletedStale') {
      collectionConflictState = 'deleted';
      collRenderEditor();
      return;
    }
    if (err && err.collReason === 'changedStale') {
      collectionConflictState = 'changed';
      collRenderEditor();
      return;
    }
    // Ordinary transport/transaction failure -- preserve everything, allow retry.
    collRenderEditor();
    showToast(collFailureMessage('save', collClassifyPersistenceFailure(err)), 'error');
    return;
  }

  collPendingOperation = false;
  collReconcileIntoAppDb(result);
  const savedId = result.id;
  discardCollectionDraft();
  collActiveId = savedId;
  libraryRoute = { view: 'collectionDetail', id: savedId };
  renderLibraryRoute();
  showToast('Collection saved', 'success');
}

// ==================== RELOAD LATEST (Section 21) ====================
function collReloadLatest() {
  if (!collectionDraft || collectionDraftMode !== 'edit' || collectionConflictState !== 'changed' || collPendingOperation) return;
  confirm2(
    'Reload Latest Collection?',
    'Your current draft will be discarded and replaced with the latest saved version.',
    () => collReloadLatestNow(),
    'Reload Latest',
    false
  );
}

async function collReloadLatestNow() {
  if (!collectionDraft) return;
  const id = collectionDraft.id;
  collPendingOperation = true;
  collRenderEditor();
  let snap;
  try {
    // Direct, server-sourced read -- never the potentially-delayed listener cache.
    snap = await COL_EX_COLLECTIONS.doc(id).get({ source: 'server' });
  } catch (err) {
    collPendingOperation = false;
    showToast(collFailureMessage('reload', collClassifyPersistenceFailure(err)), 'error');
    collRenderEditor(); // draft, baseline, and stale state all preserved
    return;
  }
  collPendingOperation = false;

  if (!snap.exists) {
    collectionConflictState = 'deleted';
    collRenderEditor();
    return;
  }

  const raw = snap.data();
  const normalized = collNormalizeCollection((raw && raw.id === snap.id) ? raw : Object.assign({}, raw, { id: snap.id }));
  normalized.createdAt = raw.createdAt;
  normalized.updatedAt = raw.updatedAt;

  collReconcileIntoAppDb(normalized);
  collectionDraft = collDeepClone(normalized);
  collectionDraftSnapshot = JSON.stringify(collectionDraft);
  collectionServerBaseline = collDeepClone(normalized);
  collectionConflictState = null;
  libraryRoute = { view: 'editCollection', id: collectionDraft.id };
  renderLibraryRoute();
  showToast('Reloaded the latest saved version', 'success');
}

// ==================== KEEP AS NEW (Section 22) ====================
function collKeepAsNew() {
  if (!collectionDraft || collPendingOperation) return;
  const wasDeleted = collectionConflictState === 'deleted';
  const msg = wasDeleted
    ? 'Your current name, members, and consolidation settings will become a new Collection. The deleted Collection will not be restored.'
    : 'Your current name, members, and consolidation settings will become a new Collection. The existing Collection will remain unchanged.';
  confirm2(
    'Keep Draft as a New Collection?',
    msg,
    () => {
      collectionDraft.id = uid();
      collectionDraft.createdAt = Date.now();
      collectionDraft.updatedAt = Date.now();
      collectionDraftMode = 'new';
      collectionServerBaseline = null;
      collectionConflictState = null;
      collectionDraftOrigin = { type: 'browser' };
      // collectionDraftSnapshot is deliberately left as the pre-conversion snapshot,
      // not reset to match the converted draft -- this preserved work must still
      // read as dirty/unsaved so the normal exit guard keeps protecting it until
      // an explicit Save (Section 22, last requirement).
      libraryRoute = { view: 'newCollection' };
      renderLibraryRoute(); // also recalculates the duplicate-name warning
    },
    'Continue as New',
    false
  );
}

// ==================== DELETE COLLECTION (Section 16/17) -- Edit Collection only ====================
function collConfirmDeleteCollection() {
  if (!collectionDraft || collectionDraftMode !== 'edit' || collPendingOperation) return;
  const name = collectionDraft.name;
  confirm2(
    'Delete Collection?',
    `\u201c${name}\u201d and its consolidation settings will be removed. The exercises themselves and their training history will not be deleted.`,
    () => collDeleteCollectionNow(collectionDraft.id),
    'Delete',
    true
  );
}

async function collDeleteCollectionNow(id) {
  if (collPendingOperation) return;
  collPendingOperation = true;
  collRenderEditor();

  let result;
  try {
    result = await fsDb.runTransaction(async (tx) => {
      const ref = COL_EX_COLLECTIONS.doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists) {
        return { alreadyMissing: true };
      }
      const live = snap.data();
      const memberIds = Array.from(new Set((live.memberIds || []).filter(Boolean)));
      let writes = [];
      if (memberIds.length) {
        // Derived from the LIVE document, not collectionDraft/baseline/appDb.
        const membershipEntries = await collReadMembershipDocs(tx, memberIds);
        // -- read phase complete; no writes issued above this line --
        writes = memberIds.map(exId => collComputeMembershipWrite(membershipEntries.get(exId), id, false, null));
      }
      // Membership-index cleanup is queued first; the Collection document's own
      // deletion is queued last, so it is the final write in this transaction.
      collApplyMembershipWrites(tx, writes);
      tx.delete(ref);
      return { alreadyMissing: false };
    });
  } catch (err) {
    collPendingOperation = false;
    collRenderEditor();
    showToast(collFailureMessage('delete', collClassifyPersistenceFailure(err)), 'error');
    return;
  }

  collPendingOperation = false;
  void result;
  collRemoveFromAppDb(id);
  discardCollectionDraft();
  collActiveId = null;
  collReturnTo = null;
  libraryRoute = { view: 'browser' };
  renderLibraryRoute();
  showToast('Collection deleted', 'success');
}

// ==================== MEMBER SELECTION (nested, reuses no browser purpose --
// a dedicated full-page checklist screen, since the approved purpose set is
// browse/exactSelect/planMultiSelect only) ====================
function collOpenMemberSelection() {
  if (!collectionDraft || collPendingOperation) return;
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
// NEEDS ATTENTION, which stays reserved for save-time Firestore conflicts.
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
  if (!collectionDraft || collPendingOperation) return;
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
