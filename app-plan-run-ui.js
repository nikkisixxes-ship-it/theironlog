// =============================================================================
// app-plan-run-ui.js -- SLICE 1 (active-Run discovery, read-only TRAIN
// navigation) PLUS SLICE 2 (this round): the occurrence pending -> inProgress
// transition, wired to the existing Slice 1 discovery UI. See the Slice 2
// implementation report for the full trace; this header describes the
// CURRENT combined scope, not just what changed this round.
//
// STATUS / NON-AUTHORIZATION NOTICE: submitted for INDEPENDENT REVIEW ONLY.
// This file itself never calls, and never wires a control to, any of
// fsPlanRunStart / fsPlanRunPreflightStart / fsPlanRunCheckStartStatus /
// fsPlanRunFinish / fsPlanRunPreflightFinish / fsPlanRunCheckFinishStatus /
// fsPlanRunEnd / fsPlanRunPreflightEnd / fsPlanRunCheckEndStatus, or any
// progression-evaluation or recovery-marker function. Starting a Run at all
// is a PLAN-library action, built separately in app-plan-run-start-ui.js
// (not this file). It calls exactly three persistence functions --
// fsPlanRunPersistence.fsPlanRunListActiveRuns,
// fsPlanRunPersistence.fsPlanRunReadForDisplay (both read-only, Slice 1), and
// fsPlanRunPersistence.fsPlanRunMarkOccurrenceInProgress (Slice 2 -- the
// one write THIS FILE performs, a single, idempotent, fully-validated
// status transition on an occurrence already belonging to the caller's own
// active Run; never a resource-creating write, never Start, Finish, or
// End). Every one of these three begins with disabledGate()
// (firebase-plan-run.js) and would issue zero Firestore I/O if the
// capability were disabled -- but it is not. ROUND 5 CORRECTION: this
// comment previously said the capability "is disabled, which is its real,
// hardcoded state today." That was stale/wrong. The real, current value of
// CANONICAL_PLAN_RUN_CAPABILITY_ENABLED (firebase-plan-run.js) is hardcoded
// `true` -- deliberately reactivated during Stage 6 and still enabled
// through the supplemental-set deployment, an independently confirmed
// baseline fact for this round, not a new finding. disabledGate() does not
// throw while the flag is true, so this file's one write DOES issue real
// Firestore I/O in production today.
//
// LOGGER-FINISH SLICE UPDATE (this round): the read-only Session preview
// below (#page-run-session-preview) now offers one additional control,
// "Open Logger" (data-planrun-action="open-logger"), reachable only once an
// occurrence has already been confirmed inProgress -- it hands the SAME
// already-verified `run`/`occurrence` objects this screen already holds to
// app-plan-run-logger-ui.js's planRunLoggerLaunch(run, occurrence), a
// DIFFERENT file, which opens the real, interactive #page-log screen. That
// hand-off call is the only thing this file does differently now; it still
// never itself calls fsPlanRunFinish or any other write beyond the single
// Mark-In-Progress transition named above. See app-plan-run-logger-ui.js's
// own header for the full Finish-side design; this is not a parallel "TRAIN"
// flow -- it is the one, single path into the real logger for a Run-linked
// Session, per the program-run-logger-finish-slice-addendum.md decision.
//
// CAPABILITY GATE: every entry point below checks planRunUiCapabilityEnabled()
// FIRST and returns immediately (rendering nothing / clearing any prior
// content) when it is false -- matching the disabled-by-default posture the
// task requires. The one test-only override this introduces
// (window.__PLAN_RUN_TEST_OVERRIDE_ENABLED__) is a plain global boolean this
// file only ever READS, never sets -- grep this file and index.html and
// confirm neither assigns it; a test harness sets it itself, before this
// file's capability check first runs, exactly like any other page-level
// global a test controls.
//
// SLICE 1 CORRECTION (independent-review Finding 2): every rendered control
// below is wired with real DOM event listeners (event delegation on the two
// stable container elements, `#planrun-home-section` and
// `#page-run-session-preview`), never an inline `onclick="..."` attribute
// built by string-concatenating a Run/occurrence id into executable markup.
// A Run/occurrence id -- validated only by `planRunIsId`, which permits
// quote characters -- travels through the DOM exclusively as an HTML
// ATTRIBUTE VALUE (`data-planrun-run-id`/`data-planrun-occurrence-id`,
// always written through `escapeHtml`, which escapes `"`), read back with
// `getAttribute` (which the DOM always hands back as the exact original
// string, HTML-entity-decoded, with no re-parsing as markup or script) --
// never concatenated into a `<script>`-executable attribute or context.
// This slice's own new "Start Session" control follows the identical
// pattern -- no exception.
//
// SCOPE (see the implementation report for the full trace): renders an
// additive "Program Run" section on the existing Home/TRAIN screen
// (#planrun-home-section, an empty container added to index.html this
// slice, never touching the existing legacy Active-Program carousel markup
// or its own renderHomeCarousel() function); lists the caller's own active
// Runs with loading/empty/error/integrity-conflict states and owner-scoped
// "load more" pagination; opens a tapped Run's own next Session via
// fsPlanRunReadForDisplay in 'display' mode (no eligibility requirement,
// matching this requirement's own "open ... for display" wording); for a
// `pending` next occurrence, offers a "Start Session" control that calls
// fsPlanRunMarkOccurrenceInProgress and, ONLY once that call honestly
// confirms the transition, opens the read-only preview -- merely opening the
// preview screen never itself marks anything in progress, and a rejected or
// uncertain outcome is shown honestly, never as false success; and, for an
// occurrence already inProgress, offers the SAME Session preview screen
// (#page-run-session-preview), reached idempotently -- no further write is
// attempted or needed to reach it. That preview screen's own descriptive
// content is still genuinely read-only (see planRunUiRenderSessionPreviewContent
// below, unchanged from Slice 1); the ONE control it adds this round,
// "Open Logger," hands off to a DIFFERENT file
// (app-plan-run-logger-ui.js's planRunLoggerLaunch) which opens the real,
// interactive #page-log screen -- see that file's own header for the full
// Finish-side design this file deliberately does not duplicate.
//
// END RUN SLICE UPDATE (this round): the active-Run card `planRunUiRenderRunCard`
// renders (below) now additionally renders one small, additive control area
// via `planRunEndRenderControl(run)` -- a DIFFERENT file's function
// (app-plan-run-end-ui.js), called the exact same way "Open Logger" already
// hands off to app-plan-run-logger-ui.js's `planRunLoggerLaunch`: this file
// never itself calls fsPlanRunEnd, fsPlanRunPreflightEnd, or
// fsPlanRunCheckEndStatus, and never tracks any End-attempt state. Six
// `data-planrun-action` values ("end-run-request"/"end-run-retry"/
// "end-run-check-status"/"end-run-dismiss"/"end-run-cancel"/"end-run-abandon"
// -- the last two added by the authoritative End recovery UI integration
// round) are routed, below, to that other file's own functions the identical
// way "start-session"/"resume" already route to this file's own. On a
// confirmed End (or a resolved Cancel), that other file calls back
// into this file's own already-existing, already-accepted
// `planRunUiFetchFirstPage()` to refresh the active list -- the SAME
// mechanism Retry already uses -- rather than this file inventing a second
// list-refresh path.
//
// EXCLUDED, DELIBERATELY, THIS SLICE (no code path anywhere in THIS FILE
// offers any of these -- app-plan-run-start-ui.js, app-plan-run-logger-ui.js,
// and (this round) app-plan-run-end-ui.js are the files that do): Starting a
// Run itself; Save without finishing; Finish / Retry Finish / Check Finish
// Status; End / Retry End / Check End Status; progression evaluation;
// recovery-marker creation or mutation.
//
// SAFETY CORRECTION (this round -- independent-review finding, same-device
// race; see app-plan-run-end-ui.js's own header for the full trace):
// `planRunUiStartSession` below (its real Mark-In-Progress write) now
// refuses to even attempt that write while a DIFFERENT file's End attempt
// for the SAME Run is 'pending' or 'uncertain' -- checked via
// app-plan-run-end-ui.js's own read-only `planRunEndBlocksNewWorkoutForRun`,
// the exact reverse-direction mirror of that file's own
// `planRunLoggerBlocksEndForRun`. `planRunUiRenderRunDetail`'s own "Start
// Session" button, and `planRunUiRenderSessionPreviewContent`'s own "Open
// Logger" button, both reflect the same live check so neither is ever shown
// as a working control during that window -- but per the task's own
// instruction, the entry-point guard exists independently of, and is never
// substituted by, hiding the button. This file still never itself calls
// fsPlanRunEnd/fsPlanRunPreflightEnd/fsPlanRunCheckEndStatus, and still
// never reads app-plan-run-end-ui.js's own `planRunEndStateByRunId`
// directly -- only through that file's one exported read-only check.
// =============================================================================

// ---- Capability gate -------------------------------------------------------
function planRunUiCapabilityEnabled() {
  if (typeof window !== 'undefined' && window.__PLAN_RUN_TEST_OVERRIDE_ENABLED__ === true) return true;
  return typeof window !== 'undefined' && window.CANONICAL_PLAN_RUN_CAPABILITY_ENABLED === true;
}

// ---- Safe DOM event binding (independent-review Finding 2) ----------------
// One delegated click listener per stable container, attached exactly once
// (guarded by a plain property on the element itself, so calling this again
// after a later `innerHTML` replacement -- which destroys any listeners
// bound to the replaced descendants, but never one bound to the container
// itself -- is always a safe no-op). Every dynamic value a handler needs
// comes back via `getAttribute` on the actual clicked control, never by
// re-deriving it from string-built markup.
function planRunUiHandleHomeSectionClick(event) {
  var btn = event.target.closest ? event.target.closest('[data-planrun-action]') : null;
  if (!btn) return;
  var action = btn.getAttribute('data-planrun-action');
  if (action === 'retry') { planRunUiRetry(); }
  else if (action === 'load-more') { planRunUiFetchNextPage(); }
  else if (action === 'toggle-run') { planRunUiToggleRunDetail(btn.getAttribute('data-planrun-run-id')); }
  else if (action === 'resume') { planRunUiOpenSessionPreview(btn.getAttribute('data-planrun-run-id'), btn.getAttribute('data-planrun-occurrence-id')); }
  else if (action === 'start-session') { planRunUiStartSession(btn.getAttribute('data-planrun-run-id'), btn.getAttribute('data-planrun-occurrence-id')); }
  // END RUN SLICE ADDITION -- routed to app-plan-run-end-ui.js's own
  // functions, the same cross-file hand-off pattern "open-logger" already
  // uses for app-plan-run-logger-ui.js (see this file's own header).
  else if (action === 'end-run-request') { if (typeof planRunEndRequestConfirm === 'function') planRunEndRequestConfirm(btn.getAttribute('data-planrun-run-id')); }
  else if (action === 'end-run-retry') { if (typeof planRunEndRetry === 'function') planRunEndRetry(btn.getAttribute('data-planrun-run-id')); }
  else if (action === 'end-run-check-status') { if (typeof planRunEndCheckStatus === 'function') planRunEndCheckStatus(btn.getAttribute('data-planrun-run-id')); }
  else if (action === 'end-run-dismiss') { if (typeof planRunEndDismiss === 'function') planRunEndDismiss(btn.getAttribute('data-planrun-run-id')); }
  // AUTHORITATIVE END RECOVERY UI INTEGRATION ADDITION -- Cancel-End and
  // Abandon-Occurrence, routed the same way every other end-run-* action
  // above already is.
  else if (action === 'end-run-cancel') { if (typeof planRunEndRequestCancel === 'function') planRunEndRequestCancel(btn.getAttribute('data-planrun-run-id')); }
  else if (action === 'end-run-abandon') { if (typeof planRunEndRequestAbandon === 'function') planRunEndRequestAbandon(btn.getAttribute('data-planrun-run-id')); }
  // USABILITY CORRECTION ADDITION (independent-review finding, this round):
  // the card's own secondary overflow menu (hosts "End Run" when idle).
  else if (action === 'toggle-menu') { planRunUiToggleRunMenu(btn.getAttribute('data-planrun-run-id')); }
}
function planRunUiWireHomeSectionEvents(el) {
  if (!el || el.__planRunUiWired) return;
  el.addEventListener('click', planRunUiHandleHomeSectionClick);
  el.__planRunUiWired = true;
}
function planRunUiHandlePreviewClick(event) {
  var btn = event.target.closest ? event.target.closest('[data-planrun-action]') : null;
  if (!btn) return;
  var action = btn.getAttribute('data-planrun-action');
  if (action === 'back') { showPage('page-home'); return; }
  if (action === 'open-logger') {
    // Hands the SAME already-verified run/occurrence this screen already
    // has (planRunUiLastPreviewRunOccurrence, stamped by
    // planRunUiRenderSessionPreviewContent below) to a DIFFERENT file's
    // launch function -- no read, no write happens here. See
    // app-plan-run-logger-ui.js's own header for what happens next.
    if (planRunUiLastPreviewRunOccurrence && typeof planRunLoggerLaunch === 'function') {
      planRunLoggerLaunch(planRunUiLastPreviewRunOccurrence.run, planRunUiLastPreviewRunOccurrence.occurrence);
    }
  }
}
function planRunUiWirePreviewEvents(el) {
  if (!el || el.__planRunUiWired) return;
  el.addEventListener('click', planRunUiHandlePreviewClick);
  el.__planRunUiWired = true;
}

// ---- In-memory UI state (never persisted; a reload always starts fresh --
// this slice's own "do not assume unsaved logger typing survives reload"
// posture applied to this screen's own navigation/list state too). ---------
var planRunUiState = {
  phase: 'idle',            // idle | loading | ok | empty | integrityConflict | error
  runs: [],
  hasMore: false,
  nextCursor: null,
  loadingMore: false,
  loadMoreError: false,
  expandedRunId: null,      // which run card's OPTIONAL extra detail is currently shown (see planRunUiRenderRunDetail)
  detailByRunId: {},        // planRunId -> {phase, run, occurrence, epoch} | {phase:'error', epoch} etc.
  // USABILITY CORRECTION ADDITION (independent-review finding, this round):
  // which run card's secondary overflow menu (End Run, when idle) is open.
  // Independent of expandedRunId -- the two controls no longer overlap.
  menuOpenRunId: null
};

// ---- Stale-response guarding (independent-review Finding 3) ---------------
// Three independent surfaces can each have an async request in flight:
// the list (first page + "load more" share one surface, since a page-2
// response only ever makes sense appended to the page-1 response that
// preceded it), a per-Run detail fetch (one epoch counter shared across all
// Runs, but compared against the epoch stamped into THAT Run's own
// `detailByRunId` entry, so two different Runs' requests can never collide
// with each other), and the read-only Session preview (one screen, so one
// counter). Each surface gets its own monotonically-increasing "epoch": a
// request captures the surface's epoch value and the signed-in UID at the
// moment it starts, and its resolution handler is allowed to touch the
// screen or in-memory state ONLY if, at resolution time, (a) the capability
// is still enabled, (b) the signed-in UID still matches the UID captured at
// request-start, and (c) the surface's epoch (or, for detail, the specific
// Run's stamped epoch) still matches what was captured -- i.e. no newer
// request for that same surface has superseded it. A later request for the
// same surface always bumps the epoch, so an older in-flight response can
// never overwrite a newer one, and an owner change always fails the UID
// check even without an epoch bump. This adds no new persistence write and
// no new state-management layer -- it is a guard purely around applying
// already-existing async results to already-existing in-memory state.
// LOGGER-FINISH SLICE ADDITION -- the exact {run, occurrence} pair last
// rendered onto the read-only preview screen, so its new "Open Logger"
// control can hand off the SAME already-verified objects (no re-fetch) to
// planRunLoggerLaunch. Cleared by every preview-screen entry point below
// before a new fetch begins, so a stale pair can never be handed off after
// a newer request has superseded it (guarded the same way every other
// preview state already is -- see planRunUiIsPreviewResponseCurrent).
var planRunUiLastPreviewRunOccurrence = null;
var planRunUiListEpoch = 0;          // list surface: first page + next page
var planRunUiDetailEpochCounter = 0; // detail surface: shared counter, compared per-Run (see above)
var planRunUiPreviewEpoch = 0;       // Session-preview surface
var planRunUiLastKnownOwnerUid;      // undefined until first observed -- deliberately distinct from null (signed out)

// ---- POST-FINISH AUTHORITATIVE-STATE GUARD (live Stage 3 smoke finding) ----
// A successful Finish is the one moment this screen KNOWS a fact for certain:
// that Session (occurrence) of that Run is no longer remaining work -- the
// Finish transaction removed it from the Run's remainingOccurrenceIds in the
// same atomic commit that completed it (and completed the Run if it was the
// last one). The reads TRAIN then makes (the active-Run list and each Run's
// Session detail) are ordinary, cache-eligible Firestore reads that are not
// guaranteed to reflect a transaction the instant it commits. Previously
// TRAIN rendered whatever those reads returned, so a read that had not yet
// caught up showed the just-finished Session as the "Next Session" (In
// Progress / Completed), or a completed Run as still active, with nothing
// ever re-reading it. Now planRunLoggerFinishCommit records the committed
// fact here (planRunUiNoteFinishCommitted) BEFORE it refreshes TRAIN, and any
// list or detail result that contradicts it is treated as not-yet-current:
// TRAIN keeps showing its existing loading state and re-reads (bounded,
// increasing delays); if the reads still disagree after the last attempt it
// shows the existing honest "Couldn't load" + Retry state. A just-finished
// Session is never presented as current.
//
// PAGINATION CORRECTION (independent review): the active-Run list is paged
// (20 per page, ordered by startedAt then planRunId, no limit on active
// Runs), so a guarded Run can be on page two or later. Absence from an
// INCOMPLETE first page proves nothing. Each guard therefore records whether
// the commit has been PROVEN reflected (`verified`), and proof comes only
// from authoritative evidence:
//   - an agreeing copy of that Run (listed on any page without the finished
//     Session, or a Session detail read that agrees), or
//   - absence from a COMPLETE list (no further page exists), or
//   - when page one is incomplete and the Run is not on it, ONE targeted
//     read of that Run (planRunUiProveGuardedRuns): it has moved on, or it is
//     no longer active (completed/ended).
// Page one is not shown until every unproven guard is proven; every later
// page is checked the same way before it is appended. A guard is never
// deleted before proof; a proven guard stays (cheaply) as a filter for the
// rest of the signed-in session, because a finished Session can never
// become remaining work again and a completed Run can never become active
// again -- so it can only ever hide data that predates the commit. All
// guards are cleared on any owner change (planRunUiResetState).
var planRunUiJustFinishedByRunId = {};   // planRunId -> { occurrenceId committed by Finish, verified }
var planRunUiAuthoritativeAttempts = 0;  // first-page rechecks spent while any guard is unproven
var planRunUiNextPageAttempts = 0;       // rechecks spent on the current Load More
var PLAN_RUN_UI_AUTHORITATIVE_RETRY_DELAYS_MS = [300, 600, 1200, 2400, 4800];
function planRunUiNoteFinishCommitted(planRunId, occurrenceId) {
  if (typeof planRunId !== 'string' || typeof occurrenceId !== 'string') return;
  planRunUiJustFinishedByRunId[planRunId] = { occurrenceId: occurrenceId, verified: false };
  planRunUiAuthoritativeAttempts = 0;
}
function planRunUiGuardFor(planRunId) {
  return Object.prototype.hasOwnProperty.call(planRunUiJustFinishedByRunId, planRunId) ? planRunUiJustFinishedByRunId[planRunId] : null;
}
function planRunUiMarkGuardVerified(planRunId) {
  var g = planRunUiGuardFor(planRunId);
  if (g) g.verified = true;
  if (!planRunUiUnverifiedGuardIds().length) planRunUiAuthoritativeAttempts = 0;
}
function planRunUiUnverifiedGuardIds() {
  return Object.keys(planRunUiJustFinishedByRunId).filter(function (id) { return !planRunUiJustFinishedByRunId[id].verified; });
}
// True when this Run document (from any list page or from a detail read)
// still lists the just-finished Session as next or remaining work -- i.e. it
// predates the committed Finish.
function planRunUiRunContradictsFinish(run) {
  var g = run ? planRunUiGuardFor(run.planRunId) : null;
  if (!g) return false;
  return run.nextOccurrenceId === g.occurrenceId ||
    (Array.isArray(run.remainingOccurrenceIds) && run.remainingOccurrenceIds.indexOf(g.occurrenceId) !== -1);
}
// Page one is incomplete and these guarded Runs are not on it: read each one
// directly (the same read-only 'display' read used for a Session detail,
// addressed to the finished Session, which always exists). The page is
// shown only when every one is proven; any contradicting, unreadable or
// failed read is treated as not-yet-current (bounded rechecks, then the
// existing error + Retry). Responses that a newer list read or an owner
// change has superseded are dropped.
function planRunUiProveGuardedRuns(result, ids) {
  var epoch = planRunUiListEpoch;
  var uid = planRunUiCurrentUid();
  var pending = ids.length;
  var failed = false;
  planRunUiState = Object.assign(planRunUiState, { phase: 'loading', runs: [], detailByRunId: {} });
  planRunUiRenderSection();
  function current() { return planRunUiIsListResponseCurrent(epoch, uid); }
  function settleOne(ok) {
    if (!current()) return;
    if (!ok) failed = true;
    if (--pending > 0) return;
    if (failed) { planRunUiRetryUntilAuthoritative(); return; }
    planRunUiAcceptFirstPage(result);
  }
  ids.forEach(function (id) {
    var g = planRunUiGuardFor(id);
    var p;
    try {
      p = fsPlanRunPersistence.fsPlanRunReadForDisplay({ ownerUid: uid, planRunId: id, occurrenceId: g.occurrenceId, mode: 'display' });
    } catch (err) { settleOne(false); return; }
    p.then(function (r) {
      if (!current()) return;
      if (!r || r.outcome !== 'verified' || !r.run || planRunUiRunContradictsFinish(r.run)) { settleOne(false); return; }
      // Agreeing copy: the Run has moved on (still active, finished Session
      // removed) or is no longer active (completed/ended). Either proves it.
      planRunUiMarkGuardVerified(id);
      settleOne(true);
    }).catch(function () { settleOne(false); });
  });
}
// Called with a contradicting read: schedules the next list re-read (which
// also re-reads every Session detail) or, after the last attempt, shows the
// existing error + Retry. Returns nothing; the caller has already decided not
// to render the contradicting data.
function planRunUiRetryUntilAuthoritative() {
  var attempt = planRunUiAuthoritativeAttempts++;
  if (attempt >= PLAN_RUN_UI_AUTHORITATIVE_RETRY_DELAYS_MS.length) {
    planRunUiAuthoritativeAttempts = 0;
    planRunUiState = Object.assign(planRunUiState, { phase: 'error', runs: [], detailByRunId: {} });
    planRunUiRenderSection();
    return;
  }
  planRunUiState = Object.assign(planRunUiState, { phase: 'loading', runs: [], detailByRunId: {} });
  planRunUiRenderSection();
  var scheduledEpoch = planRunUiListEpoch;
  var scheduledUid = planRunUiCurrentUid();
  setTimeout(function () {
    // Skip if anything newer already re-read the list, or the owner changed.
    if (scheduledEpoch !== planRunUiListEpoch || planRunUiCurrentUid() !== scheduledUid) return;
    planRunUiFetchFirstPage();
  }, PLAN_RUN_UI_AUTHORITATIVE_RETRY_DELAYS_MS[attempt]);
}

function planRunUiCurrentUid() {
  return (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.uid) || null;
}

function planRunUiIsListResponseCurrent(epoch, expectedUid) {
  return planRunUiCapabilityEnabled() && epoch === planRunUiListEpoch && planRunUiCurrentUid() === expectedUid;
}

function planRunUiIsDetailResponseCurrent(planRunId, epoch, expectedUid) {
  var entry = planRunUiState.detailByRunId[planRunId];
  return planRunUiCapabilityEnabled() && !!entry && entry.epoch === epoch && planRunUiCurrentUid() === expectedUid;
}

function planRunUiIsPreviewResponseCurrent(epoch, expectedUid) {
  return planRunUiCapabilityEnabled() && epoch === planRunUiPreviewEpoch && planRunUiCurrentUid() === expectedUid;
}

// Clears every previously rendered Run row and every in-memory per-Run/
// preview detail. Bumps the list and preview epochs too, so any request
// already in flight for the previous owner is also refused by the epoch
// check even in a case where the UID check alone would not have caught it.
// Does NOT touch the Home section's own rendered DOM (`#planrun-home-
// section`) -- callers that are not immediately followed by a render call
// (i.e. `planRunUiResetForOwner` below) must clear that themselves.
function planRunUiResetState() {
  planRunUiState = { phase: 'idle', runs: [], hasMore: false, nextCursor: null, loadingMore: false, loadMoreError: false, expandedRunId: null, detailByRunId: {}, menuOpenRunId: null };
  planRunUiJustFinishedByRunId = {};
  planRunUiAuthoritativeAttempts = 0;
  planRunUiNextPageAttempts = 0;
  planRunUiListEpoch++;
  planRunUiPreviewEpoch++;
  planRunUiLastPreviewRunOccurrence = null;
  var previewEl = (typeof document !== 'undefined') ? document.getElementById('page-run-session-preview') : null;
  if (previewEl) previewEl.innerHTML = '';
}

// ---- Auth-transition reset entry point (independent-review correction: an
// account-change gap remained even with the guards above). -----------------
// `planRunUiRenderHomeSection()`'s own owner-change check below only runs
// when something actually calls it -- in the real app that is `renderHome()`,
// called from `app-core.js`'s `auth.onAuthStateChanged` handler only after
// that handler has already made `#app` visible and has already started (and,
// for the sign-in path, awaited most of) the new owner's own asynchronous
// init. In that window, the PREVIOUS owner's Run list or Session preview
// markup could still be sitting in `#planrun-home-section`/
// `#page-run-session-preview`'s own DOM, visible underneath the now-visible
// `#app`.
//
// This function is the fix: `app-core.js` calls it SYNCHRONOUSLY, at the
// very top of every `onAuthStateChanged` transition (sign-out, sign-in, or
// account switch) -- before `#app` is made visible and before any new
// owner's async init begins -- passing the new owner's uid (or `null` on
// sign-out). It is now the PRIMARY auth boundary for this UI: it clears the
// Home section's own rendered markup directly (something
// `planRunUiResetState()` alone does not do, since nothing else is
// guaranteed to render synchronously afterward here), clears the Session
// preview's markup and in-memory list/detail state via `planRunUiResetState()`,
// bumps every request epoch, and records the new owner so a later
// `planRunUiRenderHomeSection()` call (still kept below, as a defensive
// backstop only -- e.g. for a render path this function is somehow not
// wired ahead of) recognizes the owner as already synced and does not need
// to redundantly reset again, while still correctly detecting and resetting
// for any FURTHER owner change it observes on its own.
function planRunUiResetForOwner(uid) {
  planRunUiLastKnownOwnerUid = uid;
  planRunUiResetState();
  var homeEl = (typeof document !== 'undefined') ? document.getElementById('planrun-home-section') : null;
  if (homeEl) homeEl.innerHTML = '';
}

// ---- Entry point, called additively from renderHome() (app-core.js). -----
function planRunUiRenderHomeSection() {
  var el = document.getElementById('planrun-home-section');
  if (!el) return; // markup absent (e.g. an older cached page) -- fail silent, never throw from a render hook
  planRunUiWireHomeSectionEvents(el);
  var ownerUid = planRunUiCurrentUid();
  if (ownerUid !== planRunUiLastKnownOwnerUid) {
    // DEFENSIVE BACKSTOP ONLY -- the primary auth boundary is
    // `planRunUiResetForOwner`, called synchronously from the real
    // `auth.onAuthStateChanged` handler (app-core.js) before this section
    // could ever be asked to render for a new owner. This still catches
    // the case (e.g. a render path reached before that wiring runs) where
    // this section renders for an owner it has not already been told
    // about -- clearing everything from the previous owner before any
    // fetch for the (possibly new) owner begins or anything is shown.
    planRunUiLastKnownOwnerUid = ownerUid;
    planRunUiResetState();
    el.innerHTML = '';
  }
  if (!planRunUiCapabilityEnabled()) {
    // Disabled: render nothing, and -- critically -- never call
    // fsPlanRunListActiveRuns at all. Also resets any stale in-memory state
    // from a prior enabled session (e.g. a test that flipped the override
    // off again) so a disabled reload never shows stale rows.
    el.innerHTML = '';
    planRunUiResetState();
    return;
  }
  planRunUiFetchFirstPage();
}

// ---- Fetching -------------------------------------------------------------
function planRunUiFetchFirstPage() {
  if (!planRunUiCapabilityEnabled()) return;
  var ownerUid = planRunUiCurrentUid();
  if (!ownerUid) { planRunUiState = Object.assign(planRunUiState, { phase: 'error' }); planRunUiRenderSection(); return; }
  var epoch = ++planRunUiListEpoch;
  var expectedUid = ownerUid;
  planRunUiState = Object.assign(planRunUiState, { phase: 'loading' });
  planRunUiRenderSection();
  var p;
  try {
    p = fsPlanRunPersistence.fsPlanRunListActiveRuns(ownerUid, { cursor: null });
  } catch (err) {
    planRunUiState = Object.assign(planRunUiState, { phase: 'error' });
    planRunUiRenderSection();
    return;
  }
  p.then(function (result) {
    if (!planRunUiIsListResponseCurrent(epoch, expectedUid)) return; // superseded/owner changed -- drop silently
    planRunUiApplyFirstPageResult(result);
  }).catch(function (err) {
    if (!planRunUiIsListResponseCurrent(epoch, expectedUid)) return;
    // A thrown CanonicalPlanRun*Error (authorization/unavailable/persistence)
    // -- the existing TRAIN error state with retry, per spec §3A.2.9.
    planRunUiState = Object.assign(planRunUiState, { phase: 'error' });
    planRunUiRenderSection();
  });
}

function planRunUiApplyFirstPageResult(result) {
  if (!result || typeof result.outcome !== 'string') {
    planRunUiState = Object.assign(planRunUiState, { phase: 'error' });
  } else if (result.outcome === 'ok') {
    // POST-FINISH AUTHORITATIVE-STATE GUARD: a list that still shows a
    // just-finished Session as remaining work predates the committed Finish
    // -- never render it; re-read instead (see the guard's header above).
    if (result.runs.some(planRunUiRunContradictsFinish)) { planRunUiRetryUntilAuthoritative(); return; }
    // PAGINATION CORRECTION: a guarded Run listed on this page without the
    // finished Session is proven. A guarded Run NOT on this page is proven
    // absent only if this page is the complete list; otherwise it is read
    // directly before anything is shown.
    var unproven = planRunUiUnverifiedGuardIds().filter(function (id) {
      if (result.runs.some(function (r) { return r.planRunId === id; })) { planRunUiMarkGuardVerified(id); return false; }
      if (!result.hasMore) { planRunUiMarkGuardVerified(id); return false; }
      return true;
    });
    if (unproven.length) { planRunUiProveGuardedRuns(result, unproven); return; }
    planRunUiAcceptFirstPage(result);
    return;
  } else if (result.outcome === 'integrityConflict') {
    // §3A.2.2: a distinct state, no Start/Resume/Choose-Session affordance
    // against anything on this section while it is showing.
    planRunUiState = Object.assign(planRunUiState, { phase: 'integrityConflict', runs: [], hasMore: false, nextCursor: null });
  } else {
    // invalidInput/invalidCursor on a FIRST page (cursor is always null
    // here, so invalidCursor should not be reachable from this call site --
    // treated as the same error state if it somehow occurs, never silently
    // ignored).
    planRunUiState = Object.assign(planRunUiState, { phase: 'error' });
  }
  planRunUiRenderSection();
}

// Renders an accepted first page (every guard proven): the unchanged
// pre-existing "ok" handling.
function planRunUiAcceptFirstPage(result) {
  planRunUiNextPageAttempts = 0;
  planRunUiState = Object.assign(planRunUiState, {
    phase: result.runs.length ? 'ok' : 'empty',
    runs: result.runs,
    hasMore: !!result.hasMore,
    nextCursor: result.hasMore ? result.nextCursor : null,
    loadingMore: false,
    loadMoreError: false,
    // POST-FINISH STALE-TRAIN CORRECTION: a fresh first-page list is the
    // authoritative re-read, so every per-Run Session detail cached under
    // the PREVIOUS list is discarded here and re-read below. Previously
    // this cache was keyed by planRunId only and never invalidated, so
    // after a successful Finish (which advances the Run's
    // nextOccurrenceId) the refreshed list was paired with the OLD
    // occurrence's cached detail -- the just-finished Session kept
    // showing "In Progress" until an app restart cleared memory. Any
    // still-in-flight older detail response is dropped by the existing
    // per-Run epoch check (its entry no longer exists / carries a newer
    // epoch). A plain re-render of the section never reaches this line,
    // so re-rendering alone still never refetches.
    detailByRunId: {}
  });
  // USABILITY CORRECTION (independent-review finding, this round): kick
  // off each new Run's own detail read automatically, the instant the
  // list itself resolves -- never waiting for a "View" click. See
  // planRunUiEnsureRunDetailLoaded's own header for exactly why this is
  // safe alongside the existing, unchanged toggle mechanism.
  result.runs.forEach(function (r) { planRunUiEnsureRunDetailLoaded(r.planRunId); });
  planRunUiRenderSection();
}

function planRunUiFetchNextPage() {
  if (!planRunUiCapabilityEnabled() || !planRunUiState.hasMore || planRunUiState.loadingMore) return;
  var ownerUid = planRunUiCurrentUid();
  if (!ownerUid) return;
  var epoch = ++planRunUiListEpoch;
  var expectedUid = ownerUid;
  planRunUiState.loadingMore = true;
  planRunUiState.loadMoreError = false;
  planRunUiRenderSection();
  var cursor = planRunUiState.nextCursor;
  var p;
  try {
    p = fsPlanRunPersistence.fsPlanRunListActiveRuns(ownerUid, { cursor: cursor });
  } catch (err) {
    planRunUiState.loadingMore = false;
    planRunUiState.loadMoreError = true;
    planRunUiRenderSection();
    return;
  }
  p.then(function (result) {
    if (!planRunUiIsListResponseCurrent(epoch, expectedUid)) return; // superseded/owner changed -- drop silently
    if (!result || typeof result.outcome !== 'string' || (result.outcome !== 'ok' && result.outcome !== 'integrityConflict')) {
      planRunUiState.loadingMore = false;
      planRunUiState.loadMoreError = true;
      planRunUiRenderSection();
      return;
    }
    if (result.outcome === 'integrityConflict') {
      // §3A.2.9: an integrity conflict on ANY page -- first or subsequent --
      // replaces the ENTIRE list, never just withholding the new page.
      planRunUiState = Object.assign(planRunUiState, { phase: 'integrityConflict', runs: [], hasMore: false, nextCursor: null, loadingMore: false, loadMoreError: false });
      planRunUiRenderSection();
      return;
    }
    // PAGINATION CORRECTION: every later page is checked before it is
    // appended. A page that still lists a just-finished Session (or a Run
    // whose final Session was finished) as remaining work predates the
    // commit: it is never shown; "Loading more…" stays up while it is
    // re-read with the same bounded delays, then the existing "Couldn't load
    // more" + Load more state.
    if (result.runs.some(planRunUiRunContradictsFinish)) {
      var attempt = planRunUiNextPageAttempts++;
      if (attempt >= PLAN_RUN_UI_AUTHORITATIVE_RETRY_DELAYS_MS.length) {
        planRunUiNextPageAttempts = 0;
        planRunUiState.loadingMore = false;
        planRunUiState.loadMoreError = true;
        planRunUiRenderSection();
        return;
      }
      var recheckEpoch = planRunUiListEpoch;
      setTimeout(function () {
        if (recheckEpoch !== planRunUiListEpoch || planRunUiCurrentUid() !== expectedUid) return;
        planRunUiState.loadingMore = false; // let planRunUiFetchNextPage run again (it re-sets it)
        planRunUiFetchNextPage();
      }, PLAN_RUN_UI_AUTHORITATIVE_RETRY_DELAYS_MS[attempt]);
      return;
    }
    planRunUiNextPageAttempts = 0;
    result.runs.forEach(function (r) { if (planRunUiGuardFor(r.planRunId)) planRunUiMarkGuardVerified(r.planRunId); });
    planRunUiState.runs = planRunUiState.runs.concat(result.runs);
    planRunUiState.hasMore = !!result.hasMore;
    planRunUiState.nextCursor = result.hasMore ? result.nextCursor : null;
    planRunUiState.loadingMore = false;
    planRunUiState.loadMoreError = false;
    // USABILITY CORRECTION (independent-review finding, this round): same
    // eager detail load as the first page, applied to this newly-appended
    // page's own Runs.
    result.runs.forEach(function (r) { planRunUiEnsureRunDetailLoaded(r.planRunId); });
    planRunUiRenderSection();
  }).catch(function (err) {
    if (!planRunUiIsListResponseCurrent(epoch, expectedUid)) return;
    // §3A.2.9: a next-page failure leaves already-rendered rows in place
    // and shows an inline "couldn't load more" affordance -- never replaces
    // the existing list with the ordinary error state.
    planRunUiState.loadingMore = false;
    planRunUiState.loadMoreError = true;
    planRunUiRenderSection();
  });
}

function planRunUiRetry() {
  planRunUiFetchFirstPage();
}

// ---- Rendering: the Home-screen section -----------------------------------
function planRunUiRenderSection() {
  var el = document.getElementById('planrun-home-section');
  if (!el) return;
  planRunUiWireHomeSectionEvents(el);
  if (!planRunUiCapabilityEnabled()) { el.innerHTML = ''; return; }

  var html = '<div class="planrun-section" style="padding:0 16px 4px">';
  // DUPLICATE-PRESENTATION USABILITY CORRECTION (Round 2, Approach 4) --
  // label text only, changed from "Program Run (Preview)" to the
  // user-facing wording approved in the Round 2 specification ("Started
  // From Plan"), tying this section to the already user-facing "Plan" nav
  // tab instead of internal engineering terms. No markup structure,
  // handler, data fetch, or action in this section changes.
  html += '<div class="home-section-label" style="margin:6px 0 8px">Started From Plan</div>';

  if (planRunUiState.phase === 'loading') {
    html += '<div class="planrun-loading" style="padding:14px;color:var(--text2)">Loading active Program Runs…</div>';
  } else if (planRunUiState.phase === 'error') {
    html += '<div class="planrun-error" style="padding:14px;border:1px solid var(--border,#ccc);border-radius:8px">'
      + '<div style="margin-bottom:8px">Couldn’t load your active Program Runs.</div>'
      + '<button class="btn-secondary" data-planrun-action="retry">Retry</button>'
      + '</div>';
  } else if (planRunUiState.phase === 'integrityConflict') {
    html += '<div class="planrun-integrity-conflict" style="padding:14px;border:1px solid var(--border,#ccc);border-radius:8px">'
      + '<div style="margin-bottom:8px">We found a problem with your active Program data and can’t show it safely right now.</div>'
      + '<button class="btn-secondary" data-planrun-action="retry">Retry</button>'
      + '</div>';
  } else if (planRunUiState.phase === 'empty') {
    html += '<div class="planrun-empty" style="padding:14px;color:var(--text2)">No active canonical Program Runs.</div>';
  } else if (planRunUiState.phase === 'ok') {
    html += planRunUiState.runs.map(planRunUiRenderRunCard).join('');
    if (planRunUiState.hasMore) {
      html += '<div style="padding:6px 0">';
      if (planRunUiState.loadingMore) {
        html += '<span style="color:var(--text2)">Loading more…</span>';
      } else {
        html += '<button class="btn-secondary" data-planrun-action="load-more">Load more</button>';
        if (planRunUiState.loadMoreError) {
          html += ' <span style="color:#b00">Couldn’t load more, try again.</span>';
        }
      }
      html += '</div>';
    }
  }
  // phase === 'idle': render nothing yet (initial state before the first
  // fetch resolves) -- avoids a flash of empty-state copy before loading.

  html += '</div>';
  el.innerHTML = html;
}

function planRunUiRenderRunCard(run) {
  var detail = planRunUiState.detailByRunId[run.planRunId];
  var isOpen = planRunUiState.expandedRunId === run.planRunId;
  var menuOpen = planRunUiState.menuOpenRunId === run.planRunId;
  var name = escapeHtml(run.nameSnapshot || run.planTemplateId || 'Program Run');
  var card = '<div class="planrun-card" style="border:1px solid var(--border,#ccc);border-radius:8px;padding:10px 12px;margin-bottom:8px">';

  // END RUN SLICE ADDITION, kept as the SAME call with the SAME unmodified
  // side effects (see app-plan-run-end-ui.js's own header -- that file is
  // not touched by this round). USABILITY CORRECTION (independent-review
  // finding, this round) -- only WHERE this returned markup is placed
  // changes: the plain, steady-state "End Run" entry point (no attempt in
  // flight, nothing blocking it) is no longer a prominent, always-visible
  // top-row button sitting above the actual workout action -- it moves
  // into this card's own secondary overflow area, opened via the "⋯"
  // control below. Any OTHER state this returns (pending, competing
  // elsewhere, blocked by an open Session, uncertain, or rejected) is a
  // real recovery/safety state, not idle chrome, and stays exactly where
  // it already rendered: inline and unmissable, never behind a menu. The
  // distinction is made by checking this control's own public data-testid
  // contract, never by reading app-plan-run-end-ui.js's internal state.
  var endHtml = (typeof planRunEndRenderControl === 'function') ? planRunEndRenderControl(run) : '';
  var endIsPlainIdleButton = endHtml.indexOf('data-testid="planrun-end-run-btn"') !== -1;

  card += '<div style="display:flex;justify-content:space-between;align-items:center">';
  card += '<div><div style="font-weight:600">' + name + '</div>'
    + '<div style="font-size:12px;color:var(--text2)">' + escapeHtml(run.status || '') + '</div></div>';
  card += '<div>';
  if (endIsPlainIdleButton) {
    card += '<button class="btn-secondary" data-testid="planrun-overflow-btn" data-planrun-action="toggle-menu" data-planrun-run-id="' + escapeHtml(run.planRunId) + '" title="Program Run options" aria-label="Program Run options">⋯</button> ';
  }
  card += '<button class="btn-secondary" data-planrun-action="toggle-run" data-planrun-run-id="' + escapeHtml(run.planRunId) + '">' + (isOpen ? 'Hide' : 'View') + '</button>';
  card += '</div>';
  card += '</div>';

  // USABILITY CORRECTION (independent-review finding, this round): the
  // next Session, its status, and the Start Session/Resume action are now
  // always rendered -- never gated behind the "View" expansion click.
  // planRunUiEnsureRunDetailLoaded already kicked off this Run's own
  // detail read automatically when the list itself loaded (see the fetch
  // handlers above), so `detail` is populated (or honestly still
  // "Loading Session…") without the person ever having to click anything.
  // "View"/"Hide" still exists, but now only ever gates genuinely OPTIONAL
  // extra detail (see planRunUiRenderRunDetail's own isOpen parameter) --
  // never the primary workout action.
  card += planRunUiRenderRunDetail(run, detail, isOpen);

  if (endIsPlainIdleButton) {
    if (menuOpen) {
      card += '<div class="planrun-card-menu" data-testid="planrun-overflow-menu" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border,#eee)">' + endHtml + '</div>';
    }
  } else if (endHtml) {
    card += endHtml;
  }
  card += '</div>';
  return card;
}

// USABILITY CORRECTION ADDITION (independent-review finding, this round):
// kicks off the identical real read (fsPlanRunReadForDisplay, 'display'
// mode) planRunUiToggleRunDetail already performs on open -- but
// automatically, once per Run, the instant that Run first has somewhere to
// render into, and WITHOUT ever touching expandedRunId. Idempotent: a Run
// that already has a cached-or-in-flight detail entry (by either this
// function or the existing toggle) is never refetched merely because its
// card re-rendered. Shares planRunUiDetailEpochCounter/
// planRunUiIsDetailResponseCurrent with the existing toggle path -- that
// guard already supports multiple concurrent per-Run fetches safely (a
// different Run, or this same Run refetched later by an explicit "View"
// click), so this addition introduces no new stale-response surface.
function planRunUiEnsureRunDetailLoaded(planRunId) {
  if (Object.prototype.hasOwnProperty.call(planRunUiState.detailByRunId, planRunId)) return;
  var run = planRunUiState.runs.filter(function (r) { return r.planRunId === planRunId; })[0];
  if (!run) return;
  if (!run.nextOccurrenceId) {
    // Mirrors planRunUiToggleRunDetail's own identical, already-accepted
    // handling of this data state.
    planRunUiState.detailByRunId[planRunId] = { phase: 'noNextOccurrence' };
    return;
  }
  var epoch = ++planRunUiDetailEpochCounter;
  var expectedUid = planRunUiCurrentUid();
  planRunUiState.detailByRunId[planRunId] = { phase: 'loading', epoch: epoch };
  var ownerUid = expectedUid;
  var p;
  try {
    p = fsPlanRunPersistence.fsPlanRunReadForDisplay({
      ownerUid: ownerUid, planRunId: run.planRunId, occurrenceId: run.nextOccurrenceId, mode: 'display'
    });
  } catch (err) {
    planRunUiState.detailByRunId[planRunId] = { phase: 'error', epoch: epoch };
    planRunUiRenderSection();
    return;
  }
  p.then(function (result) {
    if (!planRunUiIsDetailResponseCurrent(planRunId, epoch, expectedUid)) return; // superseded/owner changed -- drop silently
    if (result && result.outcome === 'verified') {
      // POST-FINISH AUTHORITATIVE-STATE GUARD: the Session detail re-reads
      // the Run document itself; if that copy predates a committed Finish
      // (or the detail is the just-finished Session), do not show it.
      if (planRunUiDetailContradictsFinish(result)) { planRunUiRetryUntilAuthoritative(); return; }
      planRunUiNoteDetailAgrees(planRunId);
      planRunUiState.detailByRunId[planRunId] = { phase: 'verified', run: result.run, occurrence: result.occurrence, epoch: epoch };
    } else {
      planRunUiState.detailByRunId[planRunId] = { phase: 'unverified', outcome: result && result.outcome, epoch: epoch };
    }
    planRunUiRenderSection();
  }).catch(function (err) {
    if (!planRunUiIsDetailResponseCurrent(planRunId, epoch, expectedUid)) return;
    planRunUiState.detailByRunId[planRunId] = { phase: 'error', epoch: epoch };
    planRunUiRenderSection();
  });
}
// A verified detail that agrees with the committed Finish is authoritative
// proof for that Run.
function planRunUiNoteDetailAgrees(planRunId) {
  if (planRunUiGuardFor(planRunId)) planRunUiMarkGuardVerified(planRunId);
}
// A just-finished Session shown as the detail, or a Run copy that still
// lists it as remaining work, contradicts the committed Finish.
function planRunUiDetailContradictsFinish(result) {
  if (!result || !result.run) return false;
  var g = planRunUiGuardFor(result.run.planRunId);
  if (!g) return false;
  return planRunUiRunContradictsFinish(result.run) ||
    (!!result.occurrence && result.occurrence.occurrenceId === g.occurrenceId);
}

// USABILITY CORRECTION ADDITION (independent-review finding, this round):
// toggles this one Run's secondary overflow menu (which hosts the idle
// "End Run" entry point -- see planRunUiRenderRunCard above). Independent
// of expandedRunId/planRunUiToggleRunDetail; at most one Run's menu is
// open at a time, same convention as the existing View/Hide toggle.
function planRunUiToggleRunMenu(planRunId) {
  planRunUiState.menuOpenRunId = (planRunUiState.menuOpenRunId === planRunId) ? null : planRunId;
  planRunUiRenderSection();
}

function planRunUiToggleRunDetail(planRunId) {
  if (planRunUiState.expandedRunId === planRunId) {
    planRunUiState.expandedRunId = null;
    planRunUiRenderSection();
    return;
  }
  planRunUiState.expandedRunId = planRunId;
  var run = planRunUiState.runs.filter(function (r) { return r.planRunId === planRunId; })[0];
  if (!run) { planRunUiRenderSection(); return; }
  if (!run.nextOccurrenceId) {
    // An active Run with no persisted next occurrence -- a data state this
    // slice does not attempt to repair or guess about; shown as a distinct,
    // honest informational line, never silently treated as "nothing to
    // show."
    planRunUiState.detailByRunId[planRunId] = { phase: 'noNextOccurrence' };
    planRunUiRenderSection();
    return;
  }
  var epoch = ++planRunUiDetailEpochCounter;
  var expectedUid = planRunUiCurrentUid();
  planRunUiState.detailByRunId[planRunId] = { phase: 'loading', epoch: epoch };
  planRunUiRenderSection();
  var ownerUid = expectedUid;
  var p;
  try {
    p = fsPlanRunPersistence.fsPlanRunReadForDisplay({
      ownerUid: ownerUid, planRunId: run.planRunId, occurrenceId: run.nextOccurrenceId, mode: 'display'
    });
  } catch (err) {
    planRunUiState.detailByRunId[planRunId] = { phase: 'error', epoch: epoch };
    planRunUiRenderSection();
    return;
  }
  p.then(function (result) {
    if (!planRunUiIsDetailResponseCurrent(planRunId, epoch, expectedUid)) return; // superseded/owner changed -- drop silently
    if (result && result.outcome === 'verified') {
      // POST-FINISH AUTHORITATIVE-STATE GUARD (same check as the automatic
      // detail read above).
      if (planRunUiDetailContradictsFinish(result)) { planRunUiRetryUntilAuthoritative(); return; }
      planRunUiNoteDetailAgrees(planRunId);
      planRunUiState.detailByRunId[planRunId] = { phase: 'verified', run: result.run, occurrence: result.occurrence, epoch: epoch };
    } else {
      // Any non-'verified' outcome (runAbsent/runMalformed/
      // runSelfIdentityMismatch/occurrenceAbsent/occurrenceMalformed/
      // occurrenceSelfIdentityMismatch/occurrenceRunBindingMismatch/
      // invalidInput) is shown as the same honest "can't show this safely"
      // detail state -- never repaired, never guessed at.
      planRunUiState.detailByRunId[planRunId] = { phase: 'unverified', outcome: result && result.outcome, epoch: epoch };
    }
    planRunUiRenderSection();
  }).catch(function (err) {
    if (!planRunUiIsDetailResponseCurrent(planRunId, epoch, expectedUid)) return;
    planRunUiState.detailByRunId[planRunId] = { phase: 'error', epoch: epoch };
    planRunUiRenderSection();
  });
}

// LOGGER-FINISH SLICE CORRECTION (independent-review finding, this round):
// an occurrence's own `nameSnapshot` (PLAN_RUN_OCCURRENCE_KEYS,
// plan-run-model.js's planRunOccurrenceDocValid: `planRunIsPlainObject(v.
// nameSnapshot)`) is a real OBJECT -- `{microcycleName, sessionName}`,
// confirmed against app-plan-run-start-ui.js's own planRunStartBuildPackage,
// the only place this codebase actually constructs one -- never a string.
// Both call sites below previously passed that object straight to
// `escapeHtml` (which requires a real string and throws otherwise, `str.
// replace is not a function`), a defect that never surfaced against this
// slice's OWN prior test fixtures because they used a plain string for
// convenience rather than the real object shape. Confirmed genuinely
// crashing against ANY real occurrence document (every occurrence's own
// nameSnapshot is always this object shape, never a string) -- fixed here,
// disclosed in the delivery report, not silently absorbed. This is a
// display-only fix inside a file already open for this round's own edits;
// it does not touch plan-run-model.js/firebase-plan-run.js.
// (`run.nameSnapshot`, used elsewhere in this file, is a DIFFERENT field --
// the Run's own top-level Program-name string -- and is unaffected.)
function planRunUiFormatOccurrenceName(nameSnapshot, fallback) {
  // Accepts a plain string too (never crashes either way) -- defensive, and
  // keeps this file's own pre-existing test fixtures that predate this
  // correction (a plain string, not yet updated to the real object shape)
  // still rendering exactly as they did before this fix, since a real
  // string is itself a perfectly legitimate display value.
  if (typeof nameSnapshot === 'string' && nameSnapshot) return nameSnapshot;
  if (!nameSnapshot || typeof nameSnapshot !== 'object') return fallback;
  var mc = (typeof nameSnapshot.microcycleName === 'string' && nameSnapshot.microcycleName) ? nameSnapshot.microcycleName : '';
  var sess = (typeof nameSnapshot.sessionName === 'string' && nameSnapshot.sessionName) ? nameSnapshot.sessionName : '';
  if (mc && sess) return mc + ' — ' + sess;
  // DEFENSIVE ADDITION (independent-review finding, this round): this
  // function's own fallback parameter is always a real occurrenceId in
  // production (every real occurrence document satisfies PLAN_RUN_
  // OCCURRENCE_KEYS and is id-validated before ever reaching here), but
  // this detail view now renders unconditionally for every Run card
  // instead of only once "View" is clicked (see planRunUiRenderRunCard),
  // so it is reached far more often -- including against test fixtures
  // built only for an unrelated (e.g. End-recovery) scenario that never
  // exercised this path before and can supply an incomplete stub. A
  // final `|| ''` keeps this pure formatter's own contract (always
  // returns a string, never undefined) rather than letting a malformed
  // fallback crash escapeHtml downstream -- it changes no real,
  // production-shaped call's output.
  return sess || mc || fallback || '';
}

// USABILITY CORRECTION (independent-review finding, this round): this is
// now called UNCONDITIONALLY for every rendered Run card (see
// planRunUiRenderRunCard above), never gated behind "View" -- every branch
// below was already safe to render without any detail-specific precondition
// other than `detail` itself existing, so the only real change is that
// `detail` now gets populated automatically (planRunUiEnsureRunDetailLoaded)
// instead of only after a click. The new third parameter, `isOpen`, governs
// ONLY the genuinely optional extra identifying detail appended at the end
// for a verified Session -- never the Session name/status/action above it,
// which stays visible regardless of isOpen.
function planRunUiRenderRunDetail(run, detail, isOpen) {
  if (!detail || detail.phase === 'loading') {
    return '<div style="padding:8px 0;color:var(--text2)">Loading Session…</div>';
  }
  if (detail.phase === 'noNextOccurrence') {
    return '<div style="padding:8px 0;color:var(--text2)">No upcoming Session found for this active Run.</div>';
  }
  if (detail.phase === 'error' || detail.phase === 'unverified') {
    return '<div style="padding:8px 0;color:#b00">This Session can’t be shown safely right now.</div>';
  }
  // detail.phase === 'verified'
  var occ = detail.occurrence;
  // DEFENSIVE ADDITION (independent-review finding, this round): every
  // `occ.occurrenceId || ''` below (mirroring this function's own
  // pre-existing `occ.status || ''` convention two lines down) guards
  // against a test fixture built for an unrelated scenario (several exist
  // across the End-recovery suites) that stubs only the `status` field --
  // never reachable before because detail rendering was gated behind
  // "View" and those fixtures' Runs were never expanded. A real production
  // occurrence always has a real, id-validated occurrenceId, so this
  // changes no real call's output.
  var occId = occ.occurrenceId || '';
  var isInProgress = occ.status === 'inProgress';
  var isPending = occ.status === 'pending';
  var label = isInProgress ? 'In Progress' : (isPending ? 'Not Started' : escapeHtml(occ.status || ''));
  var html = '<div style="padding:8px 0;border-top:1px solid var(--border,#eee);margin-top:6px">';
  html += '<div style="font-size:13px;margin-bottom:4px"><strong>Next Session:</strong> ' + escapeHtml(planRunUiFormatOccurrenceName(occ.nameSnapshot, occId)) + ' &mdash; <em>' + label + '</em></div>';
  if (isInProgress) {
    html += '<button class="btn-secondary" data-planrun-action="resume" data-planrun-run-id="' + escapeHtml(run.planRunId) + '" data-planrun-occurrence-id="' + escapeHtml(occId) + '">Resume (view only)</button>';
  } else if (isPending) {
    // SAFETY CORRECTION (this round): never render Start Session as a
    // working control while a DIFFERENT file's End attempt for this SAME
    // Run is pending/uncertain -- see this file's own header. The entry
    // point (planRunUiStartSession) enforces this independently too; this
    // is the rendered-control half of that same guard, never a substitute
    // for it.
    if (typeof planRunEndBlocksNewWorkoutForRun === 'function' && planRunEndBlocksNewWorkoutForRun(run.planRunId)) {
      // DEFENSIVE ADDITION (independent-review finding, this round): a
      // data-planrun-run-id attribute, matching every other per-Run control
      // in this file, now that this div can co-exist on-screen with
      // OTHER Runs' own cards (detail renders unconditionally for every
      // Run now, not just whichever one was expanded) -- lets a query
      // scope to this specific Run rather than matching the first such
      // div anywhere on the page.
      html += '<div data-testid="planrun-start-session-blocked" data-planrun-run-id="' + escapeHtml(run.planRunId) + '" style="font-size:13px;color:var(--text2)">This Program Run is being ended — Start Session is unavailable until that finishes.</div>';
    } else {
      // SLICE 2 addition: a real action, gated entirely on the persistence
      // layer's own honest confirmation (planRunUiStartSession below) --
      // merely rendering this button, or merely opening the preview
      // afterward, never itself marks anything in progress.
      html += '<button class="btn-secondary" data-planrun-action="start-session" data-planrun-run-id="' + escapeHtml(run.planRunId) + '" data-planrun-occurrence-id="' + escapeHtml(occId) + '">Start Session</button>';
    }
  }
  // USABILITY CORRECTION ADDITION (independent-review finding, this round):
  // "View"/"Hide" still exists, now gating only this genuinely optional
  // extra identifying detail -- every value here is a real stored field
  // off the already-fetched, already-verified occurrence (PLAN_RUN_
  // OCCURRENCE_KEYS), never a fabricated or display-name-derived value.
  // Defensive `|| ''`/`Number.isInteger` guards match occId above, for the
  // same pre-existing-fixture reason.
  if (isOpen) {
    var assignCount = Array.isArray(occ.assignments) ? occ.assignments.length : 0;
    var mcOrdinal = Number.isInteger(occ.microcycleOrdinal) ? occ.microcycleOrdinal : '?';
    var sessOrdinal = Number.isInteger(occ.sessionOrdinal) ? occ.sessionOrdinal : '?';
    html += '<div style="padding:6px 0;margin-top:4px;font-size:12px;color:var(--text2)">'
      + 'Occurrence: ' + escapeHtml(occId) + ' &middot; Microcycle ' + escapeHtml(String(mcOrdinal))
      + ', Session ' + escapeHtml(String(sessOrdinal)) + ' &middot; ' + assignCount + ' exercise' + (assignCount === 1 ? '' : 's')
      + '</div>';
  }
  html += '</div>';
  return html;
}

// ---- SLICE 2 addition: mark the next pending occurrence in progress, then
// (and ONLY then, gated on the persistence layer's own honest outcome) open
// the same read-only preview Resume already uses. -------------------------
// Reuses `planRunUiPreviewEpoch`/`planRunUiIsPreviewResponseCurrent` -- the
// SAME stale-response guard already governing the read-only preview surface
// -- rather than introducing a fourth, parallel epoch counter: this call and
// the preview fetch it may lead into are one continuous logical request to
// the same screen, and an owner change or a newer request for that screen
// must invalidate both halves identically.
function planRunUiStartSession(planRunId, occurrenceId) {
  if (!planRunUiCapabilityEnabled()) return;
  // SAFETY CORRECTION (this round) -- see this file's own header and
  // app-plan-run-end-ui.js's for the full trace: never attempt the real
  // Mark-In-Progress write for a Run whose End attempt has not yet
  // resolved one way or the other, however this function was reached.
  if (typeof planRunEndBlocksNewWorkoutForRun === 'function' && planRunEndBlocksNewWorkoutForRun(planRunId)) {
    if (typeof showToast === 'function') showToast('This Program Run is being ended. Wait for that to finish before starting a new Session.', 'error');
    return;
  }
  var run = planRunUiState.runs.filter(function (r) { return r.planRunId === planRunId; })[0];
  var ownerUid = planRunUiCurrentUid();
  if (!run || !ownerUid) return;
  var epoch = ++planRunUiPreviewEpoch;
  var expectedUid = ownerUid;
  var container = document.getElementById('page-run-session-preview');
  planRunUiWirePreviewEvents(container);
  if (container) container.innerHTML = '<div style="padding:16px;color:var(--text2)">Starting Session…</div>';
  showPage('page-run-session-preview');
  var p;
  try {
    p = fsPlanRunPersistence.fsPlanRunMarkOccurrenceInProgress({
      ownerUid: ownerUid, planRunId: run.planRunId, planTemplateId: run.planTemplateId,
      headRevisionId: run.headRevisionId, occurrenceId: occurrenceId
    });
  } catch (err) {
    planRunUiRenderSessionPreviewError();
    return;
  }
  p.then(function (result) {
    if (!planRunUiIsPreviewResponseCurrent(epoch, expectedUid)) return; // superseded/owner changed -- drop silently
    // Success (opening the preview with real content) is shown ONLY once
    // the persistence operation itself has confirmed the transition
    // ('committed') or confirmed it was already done ('alreadyInProgress',
    // the idempotent-resume case) -- every other outcome (invalidInput,
    // requiredDocumentMissing, documentMalformed, crossDocumentBindingMismatch,
    // integrityConflict, or a thrown/rejected persistence error) shows the
    // SAME honest "can't be shown safely" state the read-only preview
    // already uses for an unverified detail read, never a false success.
    if (result && (result.outcome === 'committed' || result.outcome === 'alreadyInProgress')) {
      planRunUiOpenSessionPreview(planRunId, occurrenceId);
    } else {
      planRunUiRenderSessionPreviewError();
    }
  }).catch(function (err) {
    if (!planRunUiIsPreviewResponseCurrent(epoch, expectedUid)) return;
    planRunUiRenderSessionPreviewError();
  });
}

// ---- Read-only Session preview (the deliberate substitute for reusing the
// live, interactive page-log screen -- see this file's own header). -------
function planRunUiOpenSessionPreview(planRunId, occurrenceId) {
  if (!planRunUiCapabilityEnabled()) return;
  var ownerUid = planRunUiCurrentUid();
  var epoch = ++planRunUiPreviewEpoch;
  var expectedUid = ownerUid;
  var container = document.getElementById('page-run-session-preview');
  planRunUiWirePreviewEvents(container);
  if (container) container.innerHTML = '<div style="padding:16px;color:var(--text2)">Loading…</div>';
  showPage('page-run-session-preview');
  var p;
  try {
    p = fsPlanRunPersistence.fsPlanRunReadForDisplay({ ownerUid: ownerUid, planRunId: planRunId, occurrenceId: occurrenceId, mode: 'display' });
  } catch (err) {
    planRunUiRenderSessionPreviewError();
    return;
  }
  p.then(function (result) {
    if (!planRunUiIsPreviewResponseCurrent(epoch, expectedUid)) return; // superseded/owner changed -- drop silently
    if (!(result && result.outcome === 'verified')) { planRunUiRenderSessionPreviewError(); return; }
    // SESSION-PREVIEW CORRECTION: show the SAME exercise the logger will open
    // with. A series-linked assignment whose Run series was durably replaced
    // ("Replace for this active Run") opens in the logger with the series'
    // activeExerciseId; the preview reads that from the very same verified,
    // read-only series read the logger uses (fsPlanRunReadSeriesForOccurrence:
    // owner, Run, series identity, membership of THIS occurrence/assignment/
    // rule and value kind all checked; zero writes). A Session with no
    // series-linked Rule ('noSeries') costs no extra read and renders exactly
    // as before. Anything else -- missing, malformed, foreign or mismatched
    // series state, a failed read -- shows the existing "can't be shown
    // safely" screen rather than a possibly stale original exercise.
    return planRunUiReadPreviewSeries(expectedUid, result.occurrence).then(function (seriesValuesByRuleId) {
      if (!planRunUiIsPreviewResponseCurrent(epoch, expectedUid)) return;
      if (seriesValuesByRuleId === false) { planRunUiRenderSessionPreviewError(); return; }
      planRunUiRenderSessionPreviewContent(result.run, result.occurrence, seriesValuesByRuleId);
    });
  }).catch(function (err) {
    if (!planRunUiIsPreviewResponseCurrent(epoch, expectedUid)) return;
    planRunUiRenderSessionPreviewError();
  });
}

// SESSION-PREVIEW CORRECTION -- resolves to:
//   null  -- the Session has no series-linked Rule (render as before);
//   { planRuleId: verified series values } -- from the logger's own read;
//   false -- the series state could not be verified (render the safe error).
// Only the next unfinished Session (pending/inProgress) reaches this screen;
// for any other status the CURRENT series exercise may not be the one that
// Session used, so a series-linked Session in any other status is refused
// rather than guessed.
function planRunUiReadPreviewSeries(ownerUid, occurrence) {
  var linked = (occurrence.assignments || []).some(function (a) {
    return (a.rules || []).some(function (rl) { return rl.enabled && typeof planRunRuleEntrySeriesId === 'function' && planRunRuleEntrySeriesId(rl) !== null; });
  });
  if (!linked) return Promise.resolve(null);
  if (occurrence.status !== 'pending' && occurrence.status !== 'inProgress') return Promise.resolve(false);
  if (typeof planRunLoggerSeriesValueForAssignment !== 'function') return Promise.resolve(false);
  var p;
  try {
    p = Promise.resolve(fsPlanRunPersistence.fsPlanRunReadSeriesForOccurrence({ ownerUid: ownerUid, planRunId: occurrence.planRunId, occurrence: occurrence }));
  } catch (err) {
    return Promise.resolve(false);
  }
  return p.then(function (r) {
    return (r && r.outcome === 'verified' && r.valuesByRuleId) ? r.valuesByRuleId : false;
  }, function () { return false; });
}

// The exercise the logger opens an assignment with: the series'
// activeExerciseId when the assignment's enabled Rule is linked to a verified
// series (via the logger's own planRunLoggerSeriesValueForAssignment), else
// the assignment's own prescribed exercise.
function planRunUiPreviewEffectiveExerciseId(a, seriesValuesByRuleId) {
  if (!seriesValuesByRuleId) return a.exerciseId;
  var sv = planRunLoggerSeriesValueForAssignment(a, seriesValuesByRuleId);
  return (sv && typeof sv.value.activeExerciseId === 'string' && sv.value.activeExerciseId) ? sv.value.activeExerciseId : a.exerciseId;
}

function planRunUiRenderSessionPreviewError() {
  planRunUiLastPreviewRunOccurrence = null;
  var container = document.getElementById('page-run-session-preview');
  if (!container) return;
  container.innerHTML = '<div class="page-title-zone"><div class="page-title-zone-title">Session Preview</div></div>'
    + '<div style="padding:16px;color:#b00">This Session can’t be shown safely right now.</div>'
    + '<div style="padding:0 16px"><button class="btn-secondary" data-planrun-action="back">Back</button></div>';
}

function planRunUiRenderSessionPreviewContent(run, occurrence, seriesValuesByRuleId) {
  planRunUiLastPreviewRunOccurrence = { run: run, occurrence: occurrence };
  var container = document.getElementById('page-run-session-preview');
  if (!container) return;
  var occInProgress = occurrence.status === 'inProgress';
  // SAFETY CORRECTION (this round) -- see this file's own header: the
  // "Open Logger" control is the real, only entry point that opens a NEW
  // `currentWorkout` for a Run-linked Session (planRunLoggerLaunch). Never
  // rendered as a working control while a DIFFERENT file's End attempt for
  // this SAME Run is pending/uncertain -- planRunLoggerLaunch itself
  // enforces this independently too; this is the rendered-control half of
  // that same guard.
  var blockedByEnd = occInProgress && typeof planRunEndBlocksNewWorkoutForRun === 'function' && planRunEndBlocksNewWorkoutForRun(run.planRunId);
  var canOpenLogger = occInProgress && !blockedByEnd;
  var html = '<div class="page-title-zone"><div class="page-title-zone-title">' + escapeHtml(planRunUiFormatOccurrenceName(occurrence.nameSnapshot, 'Session Preview')) + '</div></div>';
  if (blockedByEnd) {
    html += '<div data-testid="planrun-open-logger-blocked" style="padding:0 16px 8px;color:var(--text2);font-size:13px">This Program Run is being ended — the logger is unavailable until that finishes.</div>';
  } else {
    html += canOpenLogger
      ? '<div style="padding:0 16px 8px;color:var(--text2);font-size:13px">Open the logger to record this Session.</div>'
      : '<div style="padding:0 16px 8px;color:var(--text2);font-size:13px">Read-only preview — no changes are saved from this screen.</div>';
  }
  html += '<div style="padding:0 16px 16px">';
  (occurrence.assignments || []).forEach(function (a) {
    var effectiveExerciseId = planRunUiPreviewEffectiveExerciseId(a, seriesValuesByRuleId);
    var exName = (typeof planCanonicalGetExerciseName === 'function') ? planCanonicalGetExerciseName(effectiveExerciseId) : effectiveExerciseId;
    html += '<div style="margin-bottom:12px" data-testid="planrun-preview-exercise" data-exercise-id="' + escapeHtml(effectiveExerciseId) + '"><div style="font-weight:600;margin-bottom:4px">' + escapeHtml(exName) + '</div>';
    (a.orderedSets || []).forEach(function (s) {
      // planFormatSetSummary is the existing, UNMODIFIED descriptive-text
      // formatter (app-plan.js) -- it needs only the prescribed sub-object
      // itself, no %TM/%1RM/working-load NUMERIC resolution. No canonical
      // equivalent of that numeric auto-fill exists or is specified
      // anywhere traced for this feature; this slice deliberately shows
      // descriptive text only (e.g. "70% TM × 5") and does not
      // fabricate a numeric value. Disclosed as a stopped-and-reported gap
      // in the implementation report, not guessed at here.
      var summary = (typeof planFormatSetSummary === 'function') ? planFormatSetSummary(s.prescribed, false, false) : '';
      html += '<div style="font-size:13px;color:var(--text2);padding-left:8px">' + escapeHtml(summary) + '</div>';
    });
    html += '</div>';
  });
  html += '</div>';
  html += '<div style="padding:0 16px 24px">';
  if (canOpenLogger) {
    html += '<button class="btn-primary" data-testid="planrun-open-logger-btn" data-planrun-action="open-logger">Open Logger</button> ';
  }
  html += '<button class="btn-secondary" data-planrun-action="back">Back</button></div>';
  container.innerHTML = html;
}
