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
// ROUND 5 CORRECTION: this comment previously said CANONICAL_PLAN_RUN_
// CAPABILITY_ENABLED (firebase-plan-run.js) "remains hardcoded false" and
// that this file's persistence calls therefore "issue zero Firestore I/O in
// production today." That was stale/wrong. The real, current value is
// hardcoded `true` -- deliberately reactivated during Stage 6 and still
// enabled through the supplemental-set deployment, an independently
// confirmed baseline fact for this round, not a new finding. With the flag
// true, disabledGate() does NOT throw, so every real persistence call this
// file makes DOES issue real Firestore I/O in production today. This file
// never calls, and never wires a control to,
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

// =============================================================================
// VISUAL-ALIGNMENT CORRECTION (this round) -- CONTEXTUAL TRAINING MAX PROMPT.
// The permanent "Needs Attention (Preview)" section on TRAIN is REMOVED (its
// heading, empty/loading/error copy, rows, Refresh/Load more, and its
// container in index.html). TRAIN no longer runs the owner-wide discovery
// query on every visit. The ability to establish a Training Max that was
// left blank at Run Start moves to where it is needed:
//
//   Start Session / Resume on a Program Run card (app-plan-run-ui.js)
//     -> planRunTmGateSession(...)
//        1. From the Session's own (already-read) occurrence, list its
//           enabled, NON-series Training Max Rules. (A series Training Max
//           can never be left blank at Run Start -- app-plan-run-start-ui.js
//           leaveBlankAllowed -- so only per-Rule states can be unresolved.)
//           None -> no read at all; the Session opens exactly as before.
//        2. Otherwise read the EXISTING, unchanged discovery query
//           (fsPlanRunListUnresolvedTrainingMaxStates, every page) and keep
//           only entries for THIS Run and THESE Rules. None -> opens as
//           before. (Judgment call, disclosed: there is no existing
//           per-Rule read for Run progression state; adding one would be a
//           persistence change, so the existing validated query is reused,
//           but ONLY at this moment and ONLY for a Session that has such a
//           Rule.)
//        3. Otherwise a focused prompt (#modal-planrun-tm) asks for exactly
//           those values: exercise name, amount, unit (lb/kg). Explicit
//           "Set and Continue" only; nothing is ever inferred.
//           - Cancel: no write, logger not opened, Run/Session unchanged
//             (Start Session's own Mark-In-Progress write has NOT happened
//             yet -- the prompt runs before it), asked again next time.
//           - Each value is set through the SAME, unchanged establishment
//             machinery this file always had: fsPlanRunEstablishTrainingMax,
//             outcome classification, uncertain -> Retry (byte-identical
//             package, same operationId) / Check Status
//             (fsPlanRunCheckTrainingMaxEstablishStatus) / Abandon, rejected
//             and integrity outcomes shown honestly, never continued.
//           - Only when EVERY needed value is conclusively established does
//             it continue into the originally requested Session.
//        Any failed or conflicting read: honest message + Retry/Cancel,
//        never continued.
//   Owner change (planRunTmResetForOwner, called synchronously from the
//   auth boundary in app-core.js): prompt closed, all prompt and attempt
//   state cleared; every async response checks the owner and its own gate /
//   attempt object before touching anything.
// =============================================================================

var planRunTmAttemptByKey = {};   // planRunId::planRuleId -> { phase: pending|uncertain|rejected|success, pkg, operationId, outcome, reason }
var planRunTmGate = null;         // the one open contextual check/prompt, or null
var planRunTmGateCounter = 0;

function planRunTmCapabilityEnabled() {
  if (typeof window !== 'undefined' && window.__PLAN_RUN_TEST_OVERRIDE_ENABLED__ === true) return true;
  return typeof window !== 'undefined' && window.CANONICAL_PLAN_RUN_CAPABILITY_ENABLED === true;
}
function planRunTmCurrentUid() {
  return (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.uid) || null;
}
function planRunTmKey(planRunId, planRuleId) { return planRunId + '::' + planRuleId; }
function planRunTmAppUnit() { return (typeof appDb !== 'undefined' && appDb && appDb.unit === 'kg') ? 'kg' : 'lb'; }

function planRunTmIsGateCurrent(gate) {
  if (!(planRunTmCapabilityEnabled() && planRunTmGate === gate && planRunTmCurrentUid() === gate.uid)) return false;
  // The person left the Session screen (Back, or another tab) while the
  // check was running: the request is dropped -- never a surprise prompt or
  // a jump into the Session later.
  if (typeof activePage === 'function' && activePage() !== 'page-run-session-preview') { planRunTmGate = null; planRunTmCloseModal(); return false; }
  return true;
}
// Called when the Session screen's own Back is used while a check is running.
function planRunTmDropGate() {
  planRunTmGate = null;
  planRunTmCloseModal();
}
// An attempt response is current only if the owner is unchanged AND this
// exact tracked attempt object is still the one outstanding for its key.
function planRunTmIsAttemptResponseCurrent(key, attemptRef, expectedUid) {
  return planRunTmCapabilityEnabled() && planRunTmAttemptByKey[key] === attemptRef && planRunTmCurrentUid() === expectedUid;
}

// ---- Auth boundary (called synchronously from app-core.js) -----------------
function planRunTmResetForOwner(uid) {
  planRunTmAttemptByKey = {};
  planRunTmGate = null;
  planRunTmGateCounter++;
  planRunTmCloseModal();
}

// ---- Which Rules of a Session could need a Training Max --------------------
function planRunTmSessionCandidateRuleIds(occurrence) {
  var out = [];
  ((occurrence && occurrence.assignments) || []).forEach(function (a) {
    (a.rules || []).forEach(function (rl) {
      if (rl.enabled !== true || rl.adjustmentType === 'addLoad') return;
      if (typeof planRunRuleEntrySeriesId === 'function' && planRunRuleEntrySeriesId(rl) !== null) return;
      if (out.indexOf(rl.planRuleId) === -1) out.push(rl.planRuleId);
    });
  });
  return out;
}

// ---- Entry point -------------------------------------------------------------
// opts: { planRunId, occurrenceId, occurrence (verified, or null when not
// already in memory), proceed(), onChecking(), onCancel() }.
// Returns false when nothing could be needed (the caller proceeds at once,
// with no read and no prompt); true when this file has taken over.
function planRunTmGateSession(opts) {
  if (!planRunTmCapabilityEnabled()) return false;
  var uidNow = planRunTmCurrentUid();
  if (!uidNow) return false;
  if (opts.occurrence && planRunTmSessionCandidateRuleIds(opts.occurrence).length === 0) return false;
  var gate = { id: ++planRunTmGateCounter, uid: uidNow, planRunId: opts.planRunId, occurrenceId: opts.occurrenceId,
    occurrence: opts.occurrence || null, proceed: opts.proceed, onCancel: opts.onCancel, phase: 'checking', rows: [], establishedRows: [] };
  planRunTmGate = gate;
  planRunTmCloseModal();
  if (typeof opts.onChecking === 'function') opts.onChecking();
  planRunTmRunCheck(gate);
  return true;
}

function planRunTmRunCheck(gate) {
  if (!planRunTmIsGateCurrent(gate)) return;
  gate.phase = 'checking';
  gate.rows = [];
  gate.establishedRows = [];
  if (planRunTmModalIsOpen()) planRunTmRender();
  var p;
  try {
    p = gate.occurrence ? Promise.resolve({ outcome: 'verified', occurrence: gate.occurrence })
      : fsPlanRunPersistence.fsPlanRunReadForDisplay({ ownerUid: gate.uid, planRunId: gate.planRunId, occurrenceId: gate.occurrenceId, mode: 'display' });
  } catch (e) { planRunTmCheckFailed(gate, 'checkError'); return; }
  p.then(function (r) {
    if (!planRunTmIsGateCurrent(gate)) return;
    if (!r || r.outcome !== 'verified' || !r.occurrence) { planRunTmCheckFailed(gate, 'checkError'); return; }
    gate.occurrence = r.occurrence;
    var candidates = planRunTmSessionCandidateRuleIds(r.occurrence);
    if (!candidates.length) { planRunTmContinue(gate); return; }
    planRunTmScanPage(gate, candidates, null, [], 0);
  }, function () { if (planRunTmIsGateCurrent(gate)) planRunTmCheckFailed(gate, 'checkError'); });
}

var PLAN_RUN_TM_MAX_SCAN_PAGES = 100;
function planRunTmScanPage(gate, candidates, cursor, found, pageCount) {
  if (!planRunTmIsGateCurrent(gate)) return;
  if (pageCount >= PLAN_RUN_TM_MAX_SCAN_PAGES) { planRunTmCheckFailed(gate, 'checkError'); return; }
  var p;
  try {
    p = fsPlanRunPersistence.fsPlanRunListUnresolvedTrainingMaxStates(gate.uid, { cursor: cursor });
  } catch (e) { planRunTmCheckFailed(gate, 'checkError'); return; }
  p.then(function (result) {
    if (!planRunTmIsGateCurrent(gate)) return; // superseded / cancelled / owner changed
    if (result && result.outcome === 'integrityConflict') { planRunTmCheckFailed(gate, 'checkConflict'); return; }
    if (!result || result.outcome !== 'ok' || !Array.isArray(result.entries)) { planRunTmCheckFailed(gate, 'checkError'); return; }
    result.entries.forEach(function (e) {
      if (e && e.state && e.state.planRunId === gate.planRunId && candidates.indexOf(e.state.planRuleId) !== -1) found.push(e);
    });
    if (result.hasMore) { planRunTmScanPage(gate, candidates, result.nextCursor, found, pageCount + 1); return; }
    if (!found.length) { planRunTmContinue(gate); return; }
    var rows = found.map(function (e) { return { documentId: e.documentId, state: e.state, _amount: '', _unit: planRunTmAppUnit(), _validationError: false }; });
    // LATE-SUCCESS CORRECTION (independent-review finding): a value can
    // already be CONCLUSIVELY established by an attempt this session is
    // still tracking -- e.g. its save finished after an earlier prompt was
    // closed -- while this discovery read still lists it as unresolved (a
    // lagging read). Such rows are never asked for again and never resent:
    //   - all rows already established -> continue into THIS requested
    //     Session now (this gate exists only because the person tapped Start
    //     or Resume again), without opening the prompt and without a write;
    //   - some established -> the prompt shows only the remaining rows; the
    //     established ones are kept on the gate so they are cleaned up when
    //     it continues.
    // Only phase 'success' counts; pending / uncertain / rejected rows are
    // shown exactly as before. Gate, owner and Session checks are unchanged
    // (planRunTmIsGateCurrent above; attempts are cleared at owner change).
    gate.establishedRows = rows.filter(planRunTmRowEstablished);
    gate.rows = rows.filter(function (r) { return !planRunTmRowEstablished(r); });
    if (!gate.rows.length) { planRunTmContinue(gate); return; }
    gate.phase = 'prompt';
    planRunTmOpenModal();
    planRunTmRender();
  }, function () { if (planRunTmIsGateCurrent(gate)) planRunTmCheckFailed(gate, 'checkError'); });
}

function planRunTmCheckFailed(gate, phase) {
  gate.phase = phase;
  gate.rows = [];
  planRunTmOpenModal();
  planRunTmRender();
}

// Continue into the originally requested Session -- only while this gate is
// still the current one for this owner.
function planRunTmContinue(gate) {
  if (!planRunTmIsGateCurrent(gate)) return;
  planRunTmGate = null;
  planRunTmCloseModal();
  gate.rows.concat(gate.establishedRows || []).forEach(function (r) {
    var k = planRunTmKey(r.state.planRunId, r.state.planRuleId);
    if (planRunTmAttemptByKey[k] && planRunTmAttemptByKey[k].phase === 'success') delete planRunTmAttemptByKey[k];
  });
  if (typeof gate.proceed === 'function') gate.proceed();
}

// Cancel: closes the prompt. No write, no logger, nothing about the Run or
// Session changes. An attempt already in flight or uncertain stays tracked
// (so its Retry/Check Status are offered again next time); the gate itself
// is gone, so nothing can continue into the Session from it.
function planRunTmCancel() {
  var gate = planRunTmGate;
  planRunTmGate = null;
  planRunTmCloseModal();
  if (gate && typeof gate.onCancel === 'function') gate.onCancel();
}

function planRunTmRowEstablished(r) {
  var a = planRunTmAttemptByKey[planRunTmKey(r.state.planRunId, r.state.planRuleId)];
  return !!(a && a.phase === 'success');
}
function planRunTmAllRowsEstablished(gate) {
  return gate.rows.length > 0 && gate.rows.every(planRunTmRowEstablished);
}
function planRunTmAfterAttemptChange() {
  var gate = planRunTmGate;
  if (gate && planRunTmIsGateCurrent(gate) && gate.phase === 'prompt' && planRunTmAllRowsEstablished(gate)) { planRunTmContinue(gate); return; }
  planRunTmRender();
}

// ---- Modal ------------------------------------------------------------------
function planRunTmModalEl() { return (typeof document !== 'undefined') ? document.getElementById('modal-planrun-tm') : null; }
function planRunTmModalIsOpen() { var m = planRunTmModalEl(); return !!(m && m.classList && m.classList.contains('open')); }
function planRunTmOpenModal() {
  var m = planRunTmModalEl();
  if (!m) return;
  planRunTmWireEvents(m);
  m.classList.add('open');
}
function planRunTmCloseModal() {
  var m = planRunTmModalEl();
  if (!m) return;
  m.classList.remove('open');
  var body = document.getElementById('planrun-tm-prompt-body');
  if (body) body.innerHTML = '';
}

function planRunTmOutcomeMessage(outcome, reason) {
  var map = {
    invalidInput: 'This request could not be prepared.',
    integrityConflict: 'This couldn’t be verified. Nothing further was changed.',
    budgetExceeded: 'This request was too large to process.',
    requiredDocumentMissing: 'This value may have changed. Cancel and try again.',
    documentMalformed: 'This value may have changed. Cancel and try again.',
    crossDocumentBindingMismatch: 'This value no longer matches its Program. Cancel and try again.'
  };
  if (outcome === 'rejected') {
    var reasonMap = {
      ruleNeedsManualReview: 'This Rule needs manual review before a value can be set.',
      alreadyEstablishedDifferingValue: 'A different value was already set for this. Cancel and try again to see it.',
      legacySchemaNotEligible: 'This value isn’t eligible to be set here.',
      wrongKind: 'This value isn’t eligible to be set here.'
    };
    return reasonMap[reason] || 'Nothing was changed.';
  }
  return map[outcome] || 'Nothing was changed.';
}

function planRunTmRender() {
  var body = (typeof document !== 'undefined') ? document.getElementById('planrun-tm-prompt-body') : null;
  var gate = planRunTmGate;
  if (!body) return;
  if (!gate || !planRunTmIsGateCurrent(gate)) { body.innerHTML = ''; return; }
  var html = '';
  if (gate.phase === 'checking') {
    html += '<div data-testid="tm-prompt-checking" style="color:var(--text2)">Checking this Session’s starting values…</div>';
  } else if (gate.phase === 'checkError' || gate.phase === 'checkConflict') {
    html += '<div data-testid="' + (gate.phase === 'checkError' ? 'tm-prompt-check-error' : 'tm-prompt-check-conflict') + '" style="margin-bottom:14px">'
      + (gate.phase === 'checkError'
        ? 'Couldn’t check whether this Session needs a Training Max. Nothing was changed.'
        : 'We found a problem with this Program’s data and can’t continue safely right now. Nothing was changed.')
      + '</div>';
    html += '<button type="button" class="btn btn-primary" data-testid="tm-prompt-recheck-btn" data-planrun-tm-action="recheck">Retry</button> ';
    html += '<button type="button" class="btn btn-secondary" data-testid="tm-prompt-cancel-btn" data-planrun-tm-action="cancel">Cancel</button>';
  } else {
    var anyPending = false, anyIdle = false, anyRejected = false;
    html += '<p style="margin:0 0 14px;color:var(--text2);font-size:14px;line-height:1.4">This Session uses a Training Max that was left blank when the Program started. Enter it to continue. Nothing is saved until you choose Set and Continue.</p>';
    gate.rows.forEach(function (row) {
      var key = planRunTmKey(row.state.planRunId, row.state.planRuleId);
      var att = planRunTmAttemptByKey[key];
      var phase = att ? att.phase : 'idle';
      if (phase === 'pending') anyPending = true;
      if (phase === 'idle') anyIdle = true;
      if (phase === 'rejected') anyRejected = true;
      var exName = (typeof planCanonicalGetExerciseName === 'function') ? planCanonicalGetExerciseName(row.state.exerciseId) : row.state.exerciseId;
      var docAttr = escapeHtml(row.documentId);
      html += '<div data-testid="tm-prompt-row" data-planrun-tm-document-id="' + docAttr + '" style="border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:10px">';
      html += '<div style="font-weight:600;margin-bottom:6px">' + escapeHtml(exName) + ' — Training Max</div>';
      if (phase === 'success') {
        html += '<div data-testid="tm-row-success" style="color:var(--green,#080);font-size:13px">Set to ' + escapeHtml(String(att.pkg.amount)) + ' ' + escapeHtml(att.pkg.unit) + '.</div>';
      } else if (phase === 'uncertain' || (phase === 'pending' && att.operationId)) {
        var busy = phase === 'pending';
        html += '<div data-testid="tm-row-uncertain" style="font-size:13px;margin-bottom:8px">We couldn’t confirm whether ' + escapeHtml(String(att.pkg.amount)) + ' ' + escapeHtml(att.pkg.unit) + ' was saved. Nothing is shown as set until we know for sure.</div>';
        html += '<button type="button" class="btn btn-primary btn-sm" data-testid="tm-retry-btn" ' + (busy ? 'disabled' : '') + ' data-planrun-tm-action="retry" data-planrun-tm-document-id="' + docAttr + '">Retry</button> ';
        html += '<button type="button" class="btn btn-secondary btn-sm" data-testid="tm-check-status-btn" ' + (busy ? 'disabled' : '') + ' data-planrun-tm-action="check-status" data-planrun-tm-document-id="' + docAttr + '">Check Status</button> ';
        html += '<button type="button" class="btn btn-secondary btn-sm" data-testid="tm-abandon-btn" ' + (busy ? 'disabled' : '') + ' data-planrun-tm-action="abandon" data-planrun-tm-document-id="' + docAttr + '">Abandon</button>';
      } else if (phase === 'rejected') {
        html += '<div data-testid="tm-row-rejected" style="font-size:13px;color:#b00">' + escapeHtml(planRunTmOutcomeMessage(att.outcome, att.reason)) + '</div>';
      } else {
        var dis = phase === 'pending' ? 'disabled' : '';
        html += '<label>Training Max (' + (row._unit === 'kg' ? 'kg' : 'lb') + ')</label>';
        html += '<div style="display:flex;gap:8px;align-items:center">'
          + '<input type="number" inputmode="decimal" step="any" ' + dis + ' aria-label="Training Max for ' + escapeHtml(exName) + '" data-testid="tm-amount-input" data-planrun-tm-document-id="' + docAttr + '" data-planrun-tm-amount value="' + escapeHtml(row._amount) + '" style="flex:2;min-width:0">'
          + '<select ' + dis + ' aria-label="Unit" style="flex:1;min-width:0" data-testid="tm-unit-select" data-planrun-tm-document-id="' + docAttr + '" data-planrun-tm-unit>'
          + '<option value="lb" ' + (row._unit === 'lb' ? 'selected' : '') + '>lb</option>'
          + '<option value="kg" ' + (row._unit === 'kg' ? 'selected' : '') + '>kg</option>'
          + '</select></div>';
        if (row._validationError) html += '<div data-testid="tm-row-validation-error" style="color:#b00;font-size:12px;margin-top:4px">Enter a number before continuing.</div>';
        if (phase === 'pending') html += '<div data-testid="tm-row-pending" style="font-size:13px;color:var(--text2);margin-top:6px">Saving…</div>';
      }
      html += '</div>';
    });
    if (anyRejected) html += '<div data-testid="tm-prompt-not-continued" style="font-size:13px;color:var(--text2);margin-bottom:10px">The Session was not opened.</div>';
    html += '<div style="display:flex;gap:8px;margin-top:4px">';
    if (anyIdle) html += '<button type="button" class="btn btn-primary" style="flex:1;justify-content:center" data-testid="tm-submit-btn" ' + (anyPending ? 'disabled' : '') + ' data-planrun-tm-action="submit">Set and Continue</button>';
    html += '<button type="button" class="btn btn-secondary" style="flex:1;justify-content:center" data-testid="tm-prompt-cancel-btn" data-planrun-tm-action="cancel">Cancel</button>';
    html += '</div>';
  }
  body.innerHTML = html;
}

// ---- Input handling (no full re-render per keystroke) -----------------------
function planRunTmFindRow(documentId) {
  var gate = planRunTmGate;
  if (!gate) return null;
  return gate.rows.filter(function (r) { return r.documentId === documentId; })[0] || null;
}
function planRunTmHandleAmountInput(documentId, raw) {
  var row = planRunTmFindRow(documentId);
  if (!row) return;
  row._amount = raw;
  row._validationError = false;
}
function planRunTmHandleUnitChange(documentId, unit) {
  if (unit !== 'lb' && unit !== 'kg') return;
  var row = planRunTmFindRow(documentId);
  if (!row) return;
  row._unit = unit;
  planRunTmRender(); // the label names the unit being entered
}

// "Set and Continue": every row still needing a value must hold a valid
// number first (checked locally -- malformed input never reaches
// persistence); then each is established through the unchanged machinery.
function planRunTmHandleSubmit() {
  var gate = planRunTmGate;
  if (!gate || !planRunTmIsGateCurrent(gate) || gate.phase !== 'prompt') return;
  var toSend = [], invalid = false;
  gate.rows.forEach(function (row) {
    var key = planRunTmKey(row.state.planRunId, row.state.planRuleId);
    var att = planRunTmAttemptByKey[key];
    if (att) return; // success / pending / uncertain / rejected -- not a fresh submission
    var n = Number(row._amount);
    if (row._amount === '' || row._amount === null || !isFinite(n) || (row._unit !== 'lb' && row._unit !== 'kg')) { row._validationError = true; invalid = true; return; }
    toSend.push(row);
  });
  if (invalid) { planRunTmRender(); return; }
  var ownerUid = planRunTmCurrentUid();
  if (!ownerUid || !toSend.length) return;
  toSend.forEach(function (row) {
    var key = planRunTmKey(row.state.planRunId, row.state.planRuleId);
    var pkg = {
      operationId: uid(), ownerUid: ownerUid, planRunId: row.state.planRunId, planRuleId: row.state.planRuleId,
      planAssignmentId: row.state.planAssignmentId, ruleRevisionId: row.state.ruleRevisionId, exerciseId: row.state.exerciseId,
      kind: 'trainingMax', amount: Number(row._amount), unit: row._unit
    };
    planRunTmAttemptByKey[key] = { phase: 'pending', pkg: pkg };
  });
  planRunTmRender();
  toSend.forEach(function (row) {
    var key = planRunTmKey(row.state.planRunId, row.state.planRuleId);
    var ref = planRunTmAttemptByKey[key];
    planRunTmAttempt(key, ref, ref.pkg, ownerUid);
  });
}

// ---- Establishment (unchanged machinery, now driving the prompt) ------------
function planRunTmAttempt(key, attemptRef, pkg, expectedUid) {
  var p;
  try {
    p = fsPlanRunPersistence.fsPlanRunEstablishTrainingMax(pkg);
  } catch (e) {
    planRunTmEnterUncertain(key, attemptRef, pkg, expectedUid);
    return;
  }
  p.then(function (result) {
    planRunTmApplyEstablishOutcome(key, attemptRef, pkg, expectedUid, result);
  }, function () {
    planRunTmEnterUncertain(key, attemptRef, pkg, expectedUid);
  });
}

function planRunTmApplyEstablishOutcome(key, attemptRef, pkg, expectedUid, result) {
  if (!planRunTmIsAttemptResponseCurrent(key, attemptRef, expectedUid)) return; // superseded/abandoned/owner changed
  if (result && (result.outcome === 'committed' || result.outcome === 'alreadyEstablished' || result.outcome === 'alreadyEstablishedMatchingValue')) {
    // Conclusively confirmed -- only now, never optimistically.
    attemptRef.phase = 'success';
    planRunTmAfterAttemptChange();
    return;
  }
  if (result && (result.outcome === 'rejected' || result.outcome === 'integrityConflict' || result.outcome === 'requiredDocumentMissing' || result.outcome === 'documentMalformed' || result.outcome === 'crossDocumentBindingMismatch' || result.outcome === 'budgetExceeded' || result.outcome === 'invalidInput')) {
    // Conclusively-resolved zero-write refusals -- never re-offered a blind
    // Retry of the identical, still-refused package; never continued.
    attemptRef.phase = 'rejected';
    attemptRef.outcome = result.outcome;
    attemptRef.reason = result.reason || null;
    planRunTmAfterAttemptChange();
    return;
  }
  // Any other/malformed shape is treated like a thrown failure -- uncertain,
  // never a false success.
  planRunTmEnterUncertain(key, attemptRef, pkg, expectedUid);
}

function planRunTmEnterUncertain(key, attemptRef, pkg, expectedUid) {
  if (!planRunTmIsAttemptResponseCurrent(key, attemptRef, expectedUid)) return;
  attemptRef.phase = 'uncertain';
  attemptRef.operationId = pkg.operationId;
  planRunTmAfterAttemptChange();
}

function planRunTmRowKey(documentId) {
  var row = planRunTmFindRow(documentId);
  return row ? planRunTmKey(row.state.planRunId, row.state.planRuleId) : null;
}

// Retry resubmits the BYTE-IDENTICAL stored package (same operationId), so
// the idempotency receipt guard recognizes it as the same attempt.
function planRunTmRetry(documentId) {
  var key = planRunTmRowKey(documentId);
  var attemptRef = key && planRunTmAttemptByKey[key];
  if (!attemptRef || attemptRef.phase !== 'uncertain') return;
  var ownerUid = planRunTmCurrentUid();
  if (!ownerUid) return;
  attemptRef.phase = 'pending';
  planRunTmRender();
  planRunTmAttempt(key, attemptRef, attemptRef.pkg, ownerUid);
}

function planRunTmCheckStatus(documentId) {
  var key = planRunTmRowKey(documentId);
  var attemptRef = key && planRunTmAttemptByKey[key];
  if (!attemptRef || attemptRef.phase !== 'uncertain') return;
  var ownerUid = planRunTmCurrentUid();
  if (!ownerUid) return;
  attemptRef.phase = 'pending';
  planRunTmRender();
  var pkg = attemptRef.pkg;
  var p;
  try {
    p = fsPlanRunPersistence.fsPlanRunCheckTrainingMaxEstablishStatus({ ownerUid: ownerUid, planRunId: pkg.planRunId, planRuleId: pkg.planRuleId, operationId: attemptRef.operationId });
  } catch (e) {
    if (!planRunTmIsAttemptResponseCurrent(key, attemptRef, ownerUid)) return;
    attemptRef.phase = 'uncertain';
    planRunTmRender();
    return;
  }
  p.then(function (result) {
    if (!planRunTmIsAttemptResponseCurrent(key, attemptRef, ownerUid)) return;
    if (result && result.outcome === 'committed') { attemptRef.phase = 'success'; planRunTmAfterAttemptChange(); return; }
    // confirmedAbsent: never happened -- the SAME package is still safe to
    // Retry. integrityConflict/anything else: stay uncertain.
    attemptRef.phase = 'uncertain';
    planRunTmRender();
  }, function () {
    if (!planRunTmIsAttemptResponseCurrent(key, attemptRef, ownerUid)) return;
    attemptRef.phase = 'uncertain';
    planRunTmRender();
  });
}

// Stops THIS session tracking an uncertain attempt. Never deletes or changes
// anything persisted; the row returns to the ordinary entry form.
function planRunTmAbandonAttempt(documentId) {
  var key = planRunTmRowKey(documentId);
  if (!key) return;
  var att = planRunTmAttemptByKey[key];
  if (att && att.phase === 'pending') return;
  delete planRunTmAttemptByKey[key];
  planRunTmRender();
}

// ---- Event wiring (once, on the static modal element) -----------------------
function planRunTmHandleClick(event) {
  var btn = event.target.closest ? event.target.closest('[data-planrun-tm-action]') : null;
  if (!btn) return;
  var action = btn.getAttribute('data-planrun-tm-action');
  var documentId = btn.getAttribute('data-planrun-tm-document-id');
  if (action === 'cancel') planRunTmCancel();
  else if (action === 'recheck') { if (planRunTmGate) planRunTmRunCheck(planRunTmGate); }
  else if (action === 'submit') planRunTmHandleSubmit();
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
function planRunTmWireEvents(el) {
  if (!el || el.__planRunTmWired) return;
  el.addEventListener('click', planRunTmHandleClick);
  el.addEventListener('input', planRunTmHandleInput);
  el.addEventListener('change', planRunTmHandleChange);
  el.__planRunTmWired = true;
}
