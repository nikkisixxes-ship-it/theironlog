// =============================================================================
// app-plan-run-training-max-ui.js -- OPTIONAL PROGRESSION STARTING VALUES
// Round 6 CORRECTION (independent-review Finding 2): the "needs attention"
// surface that makes the already-implemented, already-tested persistence
// functions (plan-run-model.js / firebase-plan-run.js) actually reachable
// from the real production UI. Before this file existed, fsPlanRunEstablish-
// TrainingMax / fsPlanRunCheckTrainingMaxEstablishStatus /
// fsPlanRunListUnresolvedTrainingMaxStates had no caller anywhere in the
// production UI realm -- this file is that caller, and nothing else.
//
// STATUS / NON-AUTHORIZATION NOTICE: submitted for INDEPENDENT REVIEW ONLY.
// CANONICAL_PLAN_RUN_CAPABILITY_ENABLED (firebase-plan-run.js) remains
// hardcoded false -- every real persistence call this file makes begins with
// that file's own disabledGate() and therefore issues zero Firestore I/O in
// production today. This file never calls, and never wires a control to,
// fsPlanRunStart/fsPlanRunFinish/fsPlanRunEnd or any of their own
// preflight/check-status siblings, any progression-EVALUATION function, or
// any workout-history function. It calls exactly three persistence
// functions, all already implemented and already covered by plan-run-
// optional-progression.test.js's own fake-Firestore suite: the read-only
// discovery query (fsPlanRunListUnresolvedTrainingMaxStates) and the one
// write this file performs (fsPlanRunEstablishTrainingMax, a single,
// idempotent, fully-validated one-way blank-to-resolved transition on a
// training-max Rule that already exists -- never a resource-creating
// write), plus its own read-only status check
// (fsPlanRunCheckTrainingMaxEstablishStatus).
//
// SCOPE THIS CORRECTION:
//   1. An additive "Needs Attention" section on the existing Home/TRAIN
//      screen (#planrun-needs-attention-section, an empty container added
//      to index.html this correction, directly below the existing active-
//      Run section -- never touching that section's own markup or
//      functions), rendered by planRunTmRenderHomeSection(), called
//      additively from renderHome() exactly the way app-plan-run-ui.js's
//      own planRunUiRenderHomeSection already is.
//   2. Lists every unresolved training-max progression-state document the
//      real discovery query returns, with loading/empty/read-failure/
//      integrity-conflict states, owner-scoped Load-More pagination, and an
//      explicit Refresh action that discards any existing cursor and
//      restarts from page one -- the identical pagination idiom
//      app-plan-run-ui.js's own active-Run list already uses
//      (planRunUiFetchFirstPage/FetchNextPage), applied to this discovery
//      query instead.
//   3. Each listed Rule exposes an inline "Set Training Max" control: a
//      typed Amount + Unit, validated locally (a finite number and a legal
//      unit) BEFORE any persistence call is made -- malformed or partial
//      input never reaches fsPlanRunEstablishTrainingMax at all. A
//      successful, conclusively-confirmed establishment removes that one
//      row from the list; every other outcome (rejected/already-
//      established-differently/integrity-conflict/malformed-or-missing-
//      document) is shown honestly, in place, without altering the rest of
//      the list.
//   4. Retry/Check-Status/Abandon for an uncertain (thrown/rejected) attempt,
//      mirroring app-plan-run-start-ui.js's own identical three-control
//      pattern exactly: Retry resubmits the BYTE-IDENTICAL stored package
//      under the SAME operationId; Check Status is a read-only call; Abandon
//      only stops THIS session tracking the attempt, never deletes or
//      falsifies anything already persisted.
//   5. Discovery is deliberately NOT filtered by, or even aware of, the
//      owning Run's own status (active vs. ended) -- the real query
//      (fsPlanRunListUnresolvedTrainingMaxStates) already has no such
//      filter at all (it is a pure progressionState query), so a Rule
//      belonging to an ended Run is listed and actionable identically to
//      one belonging to an active Run; this file adds no extra read or
//      filter to change that.
//
//   ROUND 7 CORRECTION (ended-Run training-max establishment): a genuinely
//   NEW establishment attempt against a Rule whose owning Run has since
//   ended now COMMITS, exactly like one against a still-active Run --
//   plan-run-model.js's own `planRunClassifyTrainingMaxEstablishRequest`
//   was widened that round to accept both 'active' and 'ended' Run
//   statuses.
//
//   ROUND 8 CORRECTION (naturally-completed-Run training-max establishment,
//   independent-review finding): the SAME genuinely NEW establishment
//   attempt now also COMMITS when the owning Run's status is 'complete'
//   (the Run finished every occurrence naturally, as opposed to being ended
//   early) -- the classifier's one branch was widened a third time to
//   accept all three canonical `PLAN_RUN_STATUSES` values. This file's own
//   entry form, submit handling, and uncertain/retry/check-status/abandon
//   machinery still never reads or branches on Run status at all (true
//   before Round 7, true after Round 7, true after this round) -- the SAME
//   code path that already worked for active- and ended-Run entries now
//   also commits correctly for a complete-Run entry, with no separate
//   workflow added.
//   This correction's change IN THIS FILE is, again, to
//   `planRunTmOutcomeMessage`'s own `runNoLongerActive` wording (just
//   below): with all three recognized Run statuses now accepted for a
//   genuinely new attempt, and every real caller already guaranteed (by
//   firebase-plan-run.js's own unchanged `planRunDocValid` check) to only
//   ever pass one of those three recognized values, this reason can no
//   longer be produced by ANY real establishment attempt through the real
//   persistence layer -- it survives in the classifier purely as a
//   defensive fallthrough for a value outside the recognized vocabulary
//   (see plan-run-model.js's own comment). Keeping Round 7's specific,
//   status-flavored wording for a reason that is now dead on every real
//   path would be exactly the kind of "dead product copy kept solely to
//   preserve an old test" this round's own instructions warn against, so
//   the specific `runNoLongerActive` entry is removed from this file's own
//   reason-to-message map; it now falls through to the same honest, generic
//   "Nothing was changed." fallback every other unmapped/defensive outcome
//   already uses here. This is not a loss of coverage: it is the correct,
//   honest rendering of an outcome this round's own trace shows can no
//   longer genuinely occur.
//   An idempotent RETRY of an attempt that already committed while the Run
//   was still active still succeeds unconditionally regardless of the
//   Run's current status -- the receipt-guard path never consults
//   runStatus at all -- so access to a value already established before
//   the Run ended or completed was, and remains, never lost.
//   - No durable, reload-surviving recovery marker for a pending/uncertain
//     attempt. Retry/Check-Status work from this in-memory tracking map for
//     the lifetime of this browser tab/session, matching app-plan-run-
//     start-ui.js's own identical, already-accepted in-memory-only posture
//     ("a reload always starts fresh... loses this session's own Retry/
//     Check-Status controls, but loses nothing persisted").
//   - No per-entry display of the owning Run's or Template's own name --
//     the progression-state document itself carries no such snapshot field,
//     and fetching the owning Run document per listed entry to obtain one
//     would be the same unbudgeted extra read as the Run-status display
//     above. Each row is identified by exercise name only
//     (planCanonicalGetExerciseName), which is enough to act on.
// =============================================================================

// -----------------------------------------------------------------------------
// State. `planRunTmState.entries[i]` carries its own small, mutable,
// UI-local scratch fields (`_amount`/`_unit`/`_validationError`) directly on
// each entry object -- the same convention app-plan-run-start-ui.js's own
// row objects already use for `amount`/`unit`/`confirmed`. Per-attempt
// tracking (`planRunTmAttemptByKey`) is deliberately a SEPARATE map, keyed
// by the combined `planRunId + '::' + planRuleId` subject key (never
// `planRuleId` alone -- the SAME Rule id can legitimately recur across
// different Runs, spec Round 6's own discovery-ordering test already proves
// this at the persistence layer), so an attempt survives a Refresh/Load-More
// that replaces `entries` wholesale, and naturally becomes moot (never
// looked up again) if its row is no longer present after a refresh.
// -----------------------------------------------------------------------------
var planRunTmListEpoch = 0;
var planRunTmLastKnownOwnerUid; // intentionally undefined initially -- never equals any real uid or null-on-signed-out, so the very first render always resets
var planRunTmState = { phase: 'idle', entries: [], hasMore: false, nextCursor: null, loadingMore: false, loadMoreError: false };
var planRunTmAttemptByKey = {};

function planRunTmCapabilityEnabled() {
  if (typeof window !== 'undefined' && window.__PLAN_RUN_TEST_OVERRIDE_ENABLED__ === true) return true;
  return typeof window !== 'undefined' && window.CANONICAL_PLAN_RUN_CAPABILITY_ENABLED === true;
}
function planRunTmCurrentUid() {
  return (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.uid) || null;
}
function planRunTmKey(planRunId, planRuleId) { return planRunId + '::' + planRuleId; }

function planRunTmIsListResponseCurrent(epoch, expectedUid) {
  return planRunTmCapabilityEnabled() && epoch === planRunTmListEpoch && planRunTmCurrentUid() === expectedUid;
}
// An attempt response is current only if BOTH the owner is still the one it
// was made for AND this exact tracked attempt (by key) is still the one
// outstanding -- a second attempt started later for the SAME key (which
// `planRunTmHandleEstablishClick`'s own duplicate-submission guard normally
// prevents, but a stale resolved promise from a since-abandoned attempt
// could otherwise still race) is a distinct object, so `!==` here, not a
// missing-key check alone, is what makes a stale response unable to
// overwrite a newer attempt's own state.
function planRunTmIsAttemptResponseCurrent(key, attemptRef, expectedUid) {
  return planRunTmCapabilityEnabled() && planRunTmAttemptByKey[key] === attemptRef && planRunTmCurrentUid() === expectedUid;
}

function planRunTmResetState() {
  planRunTmState = { phase: 'idle', entries: [], hasMore: false, nextCursor: null, loadingMore: false, loadMoreError: false };
  planRunTmAttemptByKey = {};
  planRunTmListEpoch++;
}

// ---- Auth-transition reset entry point -- called SYNCHRONOUSLY from
// app-core.js's own auth.onAuthStateChanged handler, the identical primary
// auth boundary app-plan-run-ui.js's own planRunUiResetForOwner already is
// for the active-Run list -- before #app is made visible and before any new
// owner's async init begins. -----------------------------------------------
function planRunTmResetForOwner(uid) {
  planRunTmLastKnownOwnerUid = uid;
  planRunTmResetState();
  var el = (typeof document !== 'undefined') ? document.getElementById('planrun-needs-attention-section') : null;
  if (el) el.innerHTML = '';
}

// ---- Entry point, called additively from renderHome() (app-core.js). -----
function planRunTmRenderHomeSection() {
  var el = (typeof document !== 'undefined') ? document.getElementById('planrun-needs-attention-section') : null;
  if (!el) return; // markup absent (e.g. an older cached page) -- fail silent, never throw from a render hook
  planRunTmWireSectionEvents(el);
  var ownerUid = planRunTmCurrentUid();
  if (ownerUid !== planRunTmLastKnownOwnerUid) {
    // DEFENSIVE BACKSTOP ONLY -- see planRunTmResetForOwner's own header.
    planRunTmLastKnownOwnerUid = ownerUid;
    planRunTmResetState();
    el.innerHTML = '';
  }
  if (!planRunTmCapabilityEnabled()) {
    el.innerHTML = '';
    planRunTmResetState();
    return;
  }
  planRunTmFetchFirstPage();
}

// ---- Fetching (discovery list) --------------------------------------------
function planRunTmFetchFirstPage() {
  if (!planRunTmCapabilityEnabled()) return;
  var ownerUid = planRunTmCurrentUid();
  if (!ownerUid) { planRunTmState = Object.assign(planRunTmState, { phase: 'error' }); planRunTmRenderSection(); return; }
  var epoch = ++planRunTmListEpoch;
  var expectedUid = ownerUid;
  planRunTmAttemptByKey = {}; // a fresh page invalidates any in-flight attempt tracking tied to the OLD epoch's rows
  planRunTmState = Object.assign(planRunTmState, { phase: 'loading' });
  planRunTmRenderSection();
  var p;
  try {
    p = fsPlanRunPersistence.fsPlanRunListUnresolvedTrainingMaxStates(ownerUid, { cursor: null });
  } catch (err) {
    planRunTmState = Object.assign(planRunTmState, { phase: 'error' });
    planRunTmRenderSection();
    return;
  }
  p.then(function (result) {
    if (!planRunTmIsListResponseCurrent(epoch, expectedUid)) return; // superseded/owner changed -- drop silently
    planRunTmApplyFirstPageResult(result);
  }).catch(function () {
    if (!planRunTmIsListResponseCurrent(epoch, expectedUid)) return;
    planRunTmState = Object.assign(planRunTmState, { phase: 'error' });
    planRunTmRenderSection();
  });
}

function planRunTmBuildRow(entry) {
  return Object.assign({}, entry, { _amount: '', _unit: 'lb', _validationError: false });
}

function planRunTmApplyFirstPageResult(result) {
  if (!result || typeof result.outcome !== 'string') {
    planRunTmState = Object.assign(planRunTmState, { phase: 'error' });
  } else if (result.outcome === 'ok') {
    var rows = result.entries.map(planRunTmBuildRow);
    planRunTmState = Object.assign(planRunTmState, {
      phase: rows.length ? 'ok' : 'empty',
      entries: rows,
      hasMore: !!result.hasMore,
      nextCursor: result.hasMore ? result.nextCursor : null,
      loadingMore: false,
      loadMoreError: false
    });
  } else if (result.outcome === 'integrityConflict') {
    planRunTmState = Object.assign(planRunTmState, { phase: 'integrityConflict', entries: [], hasMore: false, nextCursor: null });
  } else {
    // invalidInput/invalidCursor on a FIRST page (cursor is always null
    // here, so invalidCursor should not be reachable from this call site --
    // treated as the same error state if it somehow occurs, never silently
    // ignored).
    planRunTmState = Object.assign(planRunTmState, { phase: 'error' });
  }
  planRunTmRenderSection();
}

function planRunTmFetchNextPage() {
  if (!planRunTmCapabilityEnabled() || !planRunTmState.hasMore || planRunTmState.loadingMore) return;
  var ownerUid = planRunTmCurrentUid();
  if (!ownerUid) return;
  var epoch = ++planRunTmListEpoch;
  var expectedUid = ownerUid;
  planRunTmState.loadingMore = true;
  planRunTmState.loadMoreError = false;
  planRunTmRenderSection();
  var cursor = planRunTmState.nextCursor;
  var p;
  try {
    p = fsPlanRunPersistence.fsPlanRunListUnresolvedTrainingMaxStates(ownerUid, { cursor: cursor });
  } catch (err) {
    planRunTmState.loadingMore = false;
    planRunTmState.loadMoreError = true;
    planRunTmRenderSection();
    return;
  }
  p.then(function (result) {
    if (!planRunTmIsListResponseCurrent(epoch, expectedUid)) return; // superseded/owner changed -- drop silently
    if (!result || typeof result.outcome !== 'string' || (result.outcome !== 'ok' && result.outcome !== 'integrityConflict')) {
      planRunTmState.loadingMore = false;
      planRunTmState.loadMoreError = true;
      planRunTmRenderSection();
      return;
    }
    if (result.outcome === 'integrityConflict') {
      // An integrity conflict on ANY page -- first or subsequent --
      // replaces the ENTIRE list, never just withholding the new page,
      // mirroring app-plan-run-ui.js's own identical Slice-1 precedent.
      planRunTmState = Object.assign(planRunTmState, { phase: 'integrityConflict', entries: [], hasMore: false, nextCursor: null, loadingMore: false, loadMoreError: false });
      planRunTmRenderSection();
      return;
    }
    planRunTmState.entries = planRunTmState.entries.concat(result.entries.map(planRunTmBuildRow));
    planRunTmState.hasMore = !!result.hasMore;
    planRunTmState.nextCursor = result.hasMore ? result.nextCursor : null;
    planRunTmState.loadingMore = false;
    planRunTmState.loadMoreError = false;
    planRunTmRenderSection();
  }).catch(function () {
    if (!planRunTmIsListResponseCurrent(epoch, expectedUid)) return;
    // A next-page failure leaves already-rendered rows in place and shows
    // an inline "couldn't load more" affordance -- never replaces the
    // existing list with the ordinary error state, mirroring
    // app-plan-run-ui.js's own identical Slice-1 precedent.
    planRunTmState.loadingMore = false;
    planRunTmState.loadMoreError = true;
    planRunTmRenderSection();
  });
}

// Explicit Refresh -- discards any existing cursor/entries/attempt tracking
// and restarts the traversal from page one. Identical call to opening the
// section fresh (planRunTmFetchFirstPage already always passes cursor:
// null), named separately only so the rendered control's own intent is
// unambiguous.
function planRunTmRefresh() {
  planRunTmFetchFirstPage();
}

// ---- Rendering: the Home-screen section -----------------------------------
function planRunTmRenderSection() {
  var el = (typeof document !== 'undefined') ? document.getElementById('planrun-needs-attention-section') : null;
  if (!el) return;
  planRunTmWireSectionEvents(el);
  if (!planRunTmCapabilityEnabled()) { el.innerHTML = ''; return; }

  var html = '<div class="planrun-tm-section" style="padding:0 16px 4px">';
  html += '<div class="home-section-label" style="margin:6px 0 8px">Needs Attention (Preview)</div>';

  if (planRunTmState.phase === 'loading') {
    html += '<div data-testid="tm-loading" style="padding:14px;color:var(--text2)">Checking for values that need attention…</div>';
  } else if (planRunTmState.phase === 'error') {
    html += '<div data-testid="tm-error" style="padding:14px;border:1px solid var(--border,#ccc);border-radius:8px">'
      + '<div style="margin-bottom:8px">Couldn’t load this list.</div>'
      + '<button type="button" class="btn-secondary" data-testid="tm-retry-list-btn" data-planrun-tm-action="refresh">Retry</button>'
      + '</div>';
  } else if (planRunTmState.phase === 'integrityConflict') {
    html += '<div data-testid="tm-integrity-conflict" style="padding:14px;border:1px solid var(--border,#ccc);border-radius:8px">'
      + '<div style="margin-bottom:8px">We found a problem with this data and can’t show it safely right now.</div>'
      + '<button type="button" class="btn-secondary" data-testid="tm-retry-list-btn" data-planrun-tm-action="refresh">Retry</button>'
      + '</div>';
  } else if (planRunTmState.phase === 'empty') {
    html += '<div data-testid="tm-empty" style="padding:14px;color:var(--text2)">Nothing needs attention right now.</div>';
  } else if (planRunTmState.phase === 'ok') {
    html += '<div style="padding:0 0 6px"><button type="button" class="btn-secondary" data-testid="tm-refresh-btn" data-planrun-tm-action="refresh">Refresh</button></div>';
    html += planRunTmState.entries.map(planRunTmRenderEntryRow).join('');
    if (planRunTmState.hasMore) {
      html += '<div style="padding:6px 0">';
      if (planRunTmState.loadingMore) {
        html += '<span style="color:var(--text2)">Loading more…</span>';
      } else {
        html += '<button type="button" class="btn-secondary" data-testid="tm-load-more-btn" data-planrun-tm-action="load-more">Load more</button>';
        if (planRunTmState.loadMoreError) {
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

function planRunTmOutcomeMessage(outcome, reason) {
  var map = {
    invalidInput: 'This request could not be prepared.',
    integrityConflict: 'This couldn’t be verified. Nothing further was changed.',
    budgetExceeded: 'This request was too large to process.',
    requiredDocumentMissing: 'This entry may have changed. Refresh the list and try again.',
    documentMalformed: 'This entry may have changed. Refresh the list and try again.',
    crossDocumentBindingMismatch: 'This entry no longer matches its Program. Refresh the list and try again.'
  };
  if (outcome === 'rejected') {
    var reasonMap = {
      // ROUND 8 CORRECTION: with 'active', 'complete', AND 'ended' all now
      // accepted for a genuinely new attempt (plan-run-model.js's own
      // classifier), and every real caller already guaranteed to pass only
      // one of those three recognized values, 'runNoLongerActive' can no
      // longer be produced by any real establishment attempt -- it is a
      // defensive-only outcome now (see that function's own comment). No
      // specific entry is kept here for it; it falls through to the
      // generic fallback below, which remains an honest message on the
      // (unreachable, through any real path) chance it is ever seen.
      ruleNeedsManualReview: 'This Rule needs manual review before a value can be set.',
      alreadyEstablishedDifferingValue: 'A different value was already set for this. Refresh to see the current value.',
      legacySchemaNotEligible: 'This entry isn’t eligible for this action.',
      wrongKind: 'This entry isn’t eligible for this action.'
    };
    return reasonMap[reason] || 'Nothing was changed.';
  }
  return map[outcome] || 'Nothing was changed.';
}

function planRunTmRenderEntryRow(row) {
  var key = planRunTmKey(row.state.planRunId, row.state.planRuleId);
  var att = planRunTmAttemptByKey[key];
  var exerciseName = (typeof planCanonicalGetExerciseName === 'function') ? planCanonicalGetExerciseName(row.state.exerciseId) : row.state.exerciseId;
  var busy = !!(att && att.phase === 'pending');
  var html = '<div class="planrun-tm-row" data-testid="tm-entry-row" data-planrun-tm-document-id="' + escapeHtml(row.documentId) + '" style="border:1px solid var(--border,#ccc);border-radius:6px;padding:8px;margin:6px 0">';
  html += '<div style="font-weight:600">' + escapeHtml(exerciseName) + '<span style="font-weight:400;color:var(--text2);font-size:12px"> — Training max needed</span></div>';

  if (att && att.phase === 'success') {
    html += '<div data-testid="tm-row-success" style="color:#080;font-size:12px;margin-top:4px">Set.</div>';
  } else if (att && att.phase === 'uncertain') {
    html += '<div data-testid="tm-row-uncertain" style="padding:6px;border-radius:6px;background:#ffe;color:#740;margin-top:4px;font-size:12px">We couldn’t confirm whether this was set. Nothing is shown as set until we know for sure.</div>';
    html += '<div style="margin-top:6px">';
    html += '<button type="button" class="btn-primary" data-testid="tm-retry-btn" ' + (busy ? 'disabled' : '') + ' data-planrun-tm-action="retry" data-planrun-tm-document-id="' + escapeHtml(row.documentId) + '">Retry</button> ';
    html += '<button type="button" class="btn-secondary" data-testid="tm-check-status-btn" ' + (busy ? 'disabled' : '') + ' data-planrun-tm-action="check-status" data-planrun-tm-document-id="' + escapeHtml(row.documentId) + '">Check Status</button> ';
    html += '<button type="button" class="btn-secondary" data-testid="tm-abandon-btn" data-planrun-tm-action="abandon" data-planrun-tm-document-id="' + escapeHtml(row.documentId) + '">Abandon</button>';
    html += '</div>';
  } else if (att && att.phase === 'rejected') {
    html += '<div data-testid="tm-row-rejected" style="padding:6px;border-radius:6px;background:#fee;color:#900;margin-top:4px;font-size:12px">' + escapeHtml(planRunTmOutcomeMessage(att.outcome, att.reason)) + '</div>';
    html += '<div style="margin-top:4px"><button type="button" class="btn-secondary" data-testid="tm-row-refresh-btn" data-planrun-tm-action="refresh">Refresh list</button></div>';
  } else {
    // 'idle' (no attempt tracked, or a prior one was abandoned) -- the
    // ordinary entry form.
    html += '<label style="display:inline-block;margin-top:4px">Training Max<input type="number" step="any" ' + (busy ? 'disabled' : '') + ' data-testid="tm-amount-input" data-planrun-tm-document-id="' + escapeHtml(row.documentId) + '" data-planrun-tm-amount value="' + escapeHtml(row._amount) + '"></label> ';
    html += '<label>Unit<select ' + (busy ? 'disabled' : '') + ' data-testid="tm-unit-select" data-planrun-tm-document-id="' + escapeHtml(row.documentId) + '" data-planrun-tm-unit>'
      + '<option value="lb" ' + (row._unit === 'lb' ? 'selected' : '') + '>lb</option>'
      + '<option value="kg" ' + (row._unit === 'kg' ? 'selected' : '') + '>kg</option>'
      + '</select></label> ';
    html += '<button type="button" class="btn-primary" data-testid="tm-submit-btn" ' + (busy ? 'disabled' : '') + ' data-planrun-tm-action="submit" data-planrun-tm-document-id="' + escapeHtml(row.documentId) + '">Set Training Max</button>';
    if (row._validationError) {
      html += '<div data-testid="tm-row-validation-error" style="color:#b00;font-size:12px;margin-top:2px">Enter a number and a unit before setting this value.</div>';
    }
  }
  html += '</div>';
  return html;
}

// ---- Event wiring -----------------------------------------------------------
function planRunTmFindRow(documentId) {
  return planRunTmState.entries.filter(function (r) { return r.documentId === documentId; })[0] || null;
}
function planRunTmFindRowEl(container, documentId) {
  if (!container || !container.querySelectorAll) return null;
  var rows = container.querySelectorAll('[data-testid="tm-entry-row"]');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].getAttribute('data-planrun-tm-document-id') === documentId) return rows[i];
  }
  return null;
}
function planRunTmContainer() {
  return (typeof document !== 'undefined') ? document.getElementById('planrun-needs-attention-section') : null;
}

// USABILITY: same focus-preserving in-place update app-plan-run-start-ui.js's
// own planRunStartHandleAmountInput already established for an identical
// reason -- a bare keystroke must never trigger a full innerHTML rebuild of
// the section (which would destroy and recreate the focused <input>, losing
// focus every keystroke). A keystroke here only ever affects the one row's
// own submit button's disabled state, updated directly on the existing
// node.
function planRunTmHandleAmountInput(documentId, raw) {
  var row = planRunTmFindRow(documentId);
  if (!row) return;
  row._amount = raw;
  row._validationError = false;
  var rowEl = planRunTmFindRowEl(planRunTmContainer(), documentId);
  if (rowEl && rowEl.querySelector) {
    var errEl = rowEl.querySelector('[data-testid="tm-row-validation-error"]');
    if (errEl) errEl.remove();
  }
}
function planRunTmHandleUnitChange(documentId, unit) {
  if (unit !== 'lb' && unit !== 'kg') return;
  var row = planRunTmFindRow(documentId);
  if (!row) return;
  row._unit = unit;
}

function planRunTmHandleEstablishClick(documentId) {
  var row = planRunTmFindRow(documentId);
  if (!row) return;
  var key = planRunTmKey(row.state.planRunId, row.state.planRuleId);
  var existing = planRunTmAttemptByKey[key];
  if (existing && existing.phase === 'pending') return; // duplicate submission while one is already in flight -- blocked
  var amountNum = Number(row._amount);
  if (row._amount === '' || !isFinite(amountNum) || (row._unit !== 'lb' && row._unit !== 'kg')) {
    // Malformed/partial input -- rejected locally, no persistence call made.
    row._validationError = true;
    planRunTmRenderSection();
    return;
  }
  var ownerUid = planRunTmCurrentUid();
  if (!ownerUid) return;
  var pkg = {
    operationId: uid(), ownerUid: ownerUid, planRunId: row.state.planRunId, planRuleId: row.state.planRuleId,
    planAssignmentId: row.state.planAssignmentId, ruleRevisionId: row.state.ruleRevisionId, exerciseId: row.state.exerciseId,
    kind: 'trainingMax', amount: amountNum, unit: row._unit
  };
  var attemptRef = { phase: 'pending', pkg: pkg };
  planRunTmAttemptByKey[key] = attemptRef;
  planRunTmRenderSection();
  planRunTmAttempt(key, attemptRef, pkg, planRunTmListEpoch, ownerUid);
}

function planRunTmAttempt(key, attemptRef, pkg, epoch, expectedUid) {
  var p;
  try {
    p = fsPlanRunPersistence.fsPlanRunEstablishTrainingMax(pkg);
  } catch (e) {
    planRunTmEnterUncertain(key, attemptRef, pkg, epoch, expectedUid);
    return;
  }
  p.then(function (result) {
    planRunTmApplyEstablishOutcome(key, attemptRef, pkg, epoch, expectedUid, result);
  }, function () {
    planRunTmEnterUncertain(key, attemptRef, pkg, epoch, expectedUid);
  });
}

function planRunTmApplyEstablishOutcome(key, attemptRef, pkg, epoch, expectedUid, result) {
  if (!planRunTmIsAttemptResponseCurrent(key, attemptRef, expectedUid)) return; // superseded/abandoned/owner changed -- never claim success onto a row the person already left
  if (result && (result.outcome === 'committed' || result.outcome === 'alreadyEstablished' || result.outcome === 'alreadyEstablishedMatchingValue')) {
    // Conclusively confirmed -- remove this entry from the visible list
    // only now, never optimistically before this point.
    delete planRunTmAttemptByKey[key];
    planRunTmState.entries = planRunTmState.entries.filter(function (r) { return !(r.state.planRunId === pkg.planRunId && r.state.planRuleId === pkg.planRuleId); });
    if (planRunTmState.entries.length === 0 && !planRunTmState.hasMore) planRunTmState.phase = 'empty';
    planRunTmRenderSection();
    return;
  }
  if (result && (result.outcome === 'rejected' || result.outcome === 'integrityConflict' || result.outcome === 'requiredDocumentMissing' || result.outcome === 'documentMalformed' || result.outcome === 'crossDocumentBindingMismatch' || result.outcome === 'budgetExceeded')) {
    // Conclusively-resolved zero-write rejections -- never re-offered a
    // blind "Retry" that would resubmit the identical, still-rejected
    // package (mirroring app-plan-run-start-ui.js's own identical
    // integrityConflict/budgetExceeded handling).
    attemptRef.phase = 'rejected';
    attemptRef.outcome = result.outcome;
    attemptRef.reason = result.reason || null;
    planRunTmRenderSection();
    return;
  }
  // Any other/malformed shape from the persistence layer is treated exactly
  // like a thrown failure -- uncertain, never a false success.
  planRunTmEnterUncertain(key, attemptRef, pkg, epoch, expectedUid);
}

function planRunTmEnterUncertain(key, attemptRef, pkg, epoch, expectedUid) {
  if (!planRunTmIsAttemptResponseCurrent(key, attemptRef, expectedUid)) return;
  attemptRef.phase = 'uncertain';
  attemptRef.operationId = pkg.operationId;
  planRunTmRenderSection();
}

function planRunTmRetry(documentId) {
  var row = planRunTmFindRow(documentId);
  if (!row) return;
  var key = planRunTmKey(row.state.planRunId, row.state.planRuleId);
  var attemptRef = planRunTmAttemptByKey[key];
  if (!attemptRef || attemptRef.phase !== 'uncertain') return;
  var ownerUid = planRunTmCurrentUid();
  if (!ownerUid) return;
  attemptRef.phase = 'pending';
  planRunTmRenderSection();
  // Retry resubmits the BYTE-IDENTICAL stored package (same operationId) --
  // never a freshly rebuilt one -- so the idempotency receipt guard
  // recognizes it as the same attempt, not an altered one.
  planRunTmAttempt(key, attemptRef, attemptRef.pkg, planRunTmListEpoch, ownerUid);
}

function planRunTmCheckStatus(documentId) {
  var row = planRunTmFindRow(documentId);
  if (!row) return;
  var key = planRunTmKey(row.state.planRunId, row.state.planRuleId);
  var attemptRef = planRunTmAttemptByKey[key];
  if (!attemptRef || attemptRef.phase !== 'uncertain') return;
  var ownerUid = planRunTmCurrentUid();
  if (!ownerUid) return;
  attemptRef.phase = 'pending';
  planRunTmRenderSection();
  var pkg = attemptRef.pkg;
  var p;
  try {
    p = fsPlanRunPersistence.fsPlanRunCheckTrainingMaxEstablishStatus({ ownerUid: ownerUid, planRunId: pkg.planRunId, planRuleId: pkg.planRuleId, operationId: attemptRef.operationId });
  } catch (e) {
    if (!planRunTmIsAttemptResponseCurrent(key, attemptRef, ownerUid)) return;
    attemptRef.phase = 'uncertain';
    planRunTmRenderSection();
    return;
  }
  p.then(function (result) {
    if (!planRunTmIsAttemptResponseCurrent(key, attemptRef, ownerUid)) return;
    if (result && result.outcome === 'committed') {
      delete planRunTmAttemptByKey[key];
      planRunTmState.entries = planRunTmState.entries.filter(function (r) { return !(r.state.planRunId === pkg.planRunId && r.state.planRuleId === pkg.planRuleId); });
      if (planRunTmState.entries.length === 0 && !planRunTmState.hasMore) planRunTmState.phase = 'empty';
      planRunTmRenderSection();
      return;
    }
    if (result && result.outcome === 'confirmedAbsent') {
      // The establishment never actually happened -- the SAME pending
      // package/operationId is still safe to Retry (nothing was committed
      // under it).
      attemptRef.phase = 'uncertain';
      planRunTmRenderSection();
      return;
    }
    // integrityConflict/anything else -- stay uncertain, still offering
    // Retry/Check Status/Abandon (mirroring app-plan-run-start-ui.js's own
    // identical "competingOperation/integrityConflict... stay uncertain"
    // handling).
    attemptRef.phase = 'uncertain';
    planRunTmRenderSection();
  }, function () {
    if (!planRunTmIsAttemptResponseCurrent(key, attemptRef, ownerUid)) return;
    attemptRef.phase = 'uncertain';
    planRunTmRenderSection();
  });
}

// Stops THIS session tracking an uncertain attempt for this one row. Never
// deletes, edits, or checks anything already persisted -- if the
// establishment genuinely committed, the next Refresh (fsPlanRunList-
// UnresolvedTrainingMaxStates) simply no longer lists it, regardless of
// whether this row ever learns that.
function planRunTmAbandonAttempt(documentId) {
  var row = planRunTmFindRow(documentId);
  if (!row) return;
  var key = planRunTmKey(row.state.planRunId, row.state.planRuleId);
  delete planRunTmAttemptByKey[key];
  planRunTmRenderSection();
}

function planRunTmHandleClick(event) {
  var btn = event.target.closest ? event.target.closest('[data-planrun-tm-action]') : null;
  if (!btn) return;
  var action = btn.getAttribute('data-planrun-tm-action');
  var documentId = btn.getAttribute('data-planrun-tm-document-id');
  if (action === 'refresh') planRunTmRefresh();
  else if (action === 'load-more') planRunTmFetchNextPage();
  else if (action === 'submit') planRunTmHandleEstablishClick(documentId);
  else if (action === 'retry') planRunTmRetry(documentId);
  else if (action === 'check-status') planRunTmCheckStatus(documentId);
  else if (action === 'abandon') planRunTmAbandonAttempt(documentId);
}
function planRunTmHandleInput(event) {
  var el = event.target;
  if (!el || !el.matches || !el.matches('[data-planrun-tm-amount]')) return;
  planRunTmHandleAmountInput(el.getAttribute('data-planrun-tm-document-id'), el.value);
}
function planRunTmHandleChange(event) {
  var el = event.target;
  if (!el || !el.matches || !el.matches('[data-planrun-tm-unit]')) return;
  planRunTmHandleUnitChange(el.getAttribute('data-planrun-tm-document-id'), el.value);
}
function planRunTmWireSectionEvents(el) {
  if (!el || el.__planRunTmWired) return;
  el.addEventListener('click', planRunTmHandleClick);
  el.addEventListener('input', planRunTmHandleInput);
  el.addEventListener('change', planRunTmHandleChange);
  el.__planRunTmWired = true;
}
