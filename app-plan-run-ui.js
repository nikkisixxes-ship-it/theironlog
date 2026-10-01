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
// (firebase-plan-run.js) and therefore issues zero Firestore I/O whenever
// the capability is disabled, which is its real, hardcoded state today.
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
  expandedRunId: null,      // which run card's detail is currently open
  detailByRunId: {}         // planRunId -> {phase, run, occurrence, epoch} | {phase:'error', epoch} etc.
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
  planRunUiState = { phase: 'idle', runs: [], hasMore: false, nextCursor: null, loadingMore: false, loadMoreError: false, expandedRunId: null, detailByRunId: {} };
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
    planRunUiState = Object.assign(planRunUiState, {
      phase: result.runs.length ? 'ok' : 'empty',
      runs: result.runs,
      hasMore: !!result.hasMore,
      nextCursor: result.hasMore ? result.nextCursor : null,
      loadingMore: false,
      loadMoreError: false
    });
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
    planRunUiState.runs = planRunUiState.runs.concat(result.runs);
    planRunUiState.hasMore = !!result.hasMore;
    planRunUiState.nextCursor = result.hasMore ? result.nextCursor : null;
    planRunUiState.loadingMore = false;
    planRunUiState.loadMoreError = false;
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
  html += '<div class="home-section-label" style="margin:6px 0 8px">Program Run (Preview)</div>';

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
  var name = escapeHtml(run.nameSnapshot || run.planTemplateId || 'Program Run');
  var card = '<div class="planrun-card" style="border:1px solid var(--border,#ccc);border-radius:8px;padding:10px 12px;margin-bottom:8px">';
  card += '<div style="display:flex;justify-content:space-between;align-items:center">';
  card += '<div><div style="font-weight:600">' + name + '</div>'
    + '<div style="font-size:12px;color:var(--text2)">' + escapeHtml(run.status || '') + '</div></div>';
  card += '<button class="btn-secondary" data-planrun-action="toggle-run" data-planrun-run-id="' + escapeHtml(run.planRunId) + '">' + (isOpen ? 'Hide' : 'View') + '</button>';
  card += '</div>';
  // END RUN SLICE ADDITION -- always rendered when this card is (never
  // gated behind expanding "View" detail, since ending is a Run-level
  // decision, not tied to any one Session's own detail read -- per the
  // accepted spec, canonical-program-run-ui-logger-integration-
  // specification round1 §2.9). A different file's function (see this
  // file's own header); returns '' outright for a non-active Run.
  if (typeof planRunEndRenderControl === 'function') { card += planRunEndRenderControl(run); }
  if (isOpen) {
    card += planRunUiRenderRunDetail(run, detail);
  }
  card += '</div>';
  return card;
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
  return sess || mc || fallback;
}

function planRunUiRenderRunDetail(run, detail) {
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
  var isInProgress = occ.status === 'inProgress';
  var isPending = occ.status === 'pending';
  var label = isInProgress ? 'In Progress' : (isPending ? 'Not Started' : escapeHtml(occ.status || ''));
  var html = '<div style="padding:8px 0;border-top:1px solid var(--border,#eee);margin-top:6px">';
  html += '<div style="font-size:13px;margin-bottom:4px"><strong>Next Session:</strong> ' + escapeHtml(planRunUiFormatOccurrenceName(occ.nameSnapshot, occ.occurrenceId)) + ' &mdash; <em>' + label + '</em></div>';
  if (isInProgress) {
    html += '<button class="btn-secondary" data-planrun-action="resume" data-planrun-run-id="' + escapeHtml(run.planRunId) + '" data-planrun-occurrence-id="' + escapeHtml(occ.occurrenceId) + '">Resume (view only)</button>';
  } else if (isPending) {
    // SAFETY CORRECTION (this round): never render Start Session as a
    // working control while a DIFFERENT file's End attempt for this SAME
    // Run is pending/uncertain -- see this file's own header. The entry
    // point (planRunUiStartSession) enforces this independently too; this
    // is the rendered-control half of that same guard, never a substitute
    // for it.
    if (typeof planRunEndBlocksNewWorkoutForRun === 'function' && planRunEndBlocksNewWorkoutForRun(run.planRunId)) {
      html += '<div data-testid="planrun-start-session-blocked" style="font-size:13px;color:var(--text2)">This Program Run is being ended — Start Session is unavailable until that finishes.</div>';
    } else {
      // SLICE 2 addition: a real action, gated entirely on the persistence
      // layer's own honest confirmation (planRunUiStartSession below) --
      // merely rendering this button, or merely opening the preview
      // afterward, never itself marks anything in progress.
      html += '<button class="btn-secondary" data-planrun-action="start-session" data-planrun-run-id="' + escapeHtml(run.planRunId) + '" data-planrun-occurrence-id="' + escapeHtml(occ.occurrenceId) + '">Start Session</button>';
    }
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
    if (result && result.outcome === 'verified') {
      planRunUiRenderSessionPreviewContent(result.run, result.occurrence);
    } else {
      planRunUiRenderSessionPreviewError();
    }
  }).catch(function (err) {
    if (!planRunUiIsPreviewResponseCurrent(epoch, expectedUid)) return;
    planRunUiRenderSessionPreviewError();
  });
}

function planRunUiRenderSessionPreviewError() {
  planRunUiLastPreviewRunOccurrence = null;
  var container = document.getElementById('page-run-session-preview');
  if (!container) return;
  container.innerHTML = '<div class="page-title-zone"><div class="page-title-zone-title">Session Preview</div></div>'
    + '<div style="padding:16px;color:#b00">This Session can’t be shown safely right now.</div>'
    + '<div style="padding:0 16px"><button class="btn-secondary" data-planrun-action="back">Back</button></div>';
}

function planRunUiRenderSessionPreviewContent(run, occurrence) {
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
    var exName = (typeof planCanonicalGetExerciseName === 'function') ? planCanonicalGetExerciseName(a.exerciseId) : a.exerciseId;
    html += '<div style="margin-bottom:12px"><div style="font-weight:600;margin-bottom:4px">' + escapeHtml(exName) + '</div>';
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
