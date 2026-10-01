// =============================================================================
// app-plan-run-end-ui.js -- END RUN slice. Renders the "End Run" action on
// the canonical active-Run card app-plan-run-ui.js already draws (see that
// file's own diff for the one small, additive render hook), the exact same
// cross-file hand-off convention its existing "Open Logger" control already
// uses for app-plan-run-logger-ui.js.
//
// STATUS / NON-AUTHORIZATION NOTICE: submitted for INDEPENDENT REVIEW ONLY.
// CANONICAL_PLAN_RUN_CAPABILITY_ENABLED (firebase-plan-run.js) remains
// hardcoded false. This file calls exactly six persistence functions --
// fsPlanRunPersistence.fsPlanRunPreflightEnd, .fsPlanRunBeginEnd,
// .fsPlanRunEnd, .fsPlanRunCheckEndStatus, .fsPlanRunCancelEnd, and
// .fsPlanRunAbandonOccurrence -- plus the already-existing, read-only
// .fsPlanRunReadForDisplay (mode:'display', to inspect one occurrence's real
// status). No change was made to plan-run-model.js, firebase-plan-run.js, or
// any Firestore rule anywhere in this slice -- this is a pure UI consumer of
// the already-shipped, already-accepted, already-emulator-verified
// authoritative End-recovery contract (program-run-authoritative-end-
// recovery-specification-round12.md SS6, and its Round-13 implementation).
//
// =============================================================================
// THIS ROUND -- AUTHORITATIVE END RECOVERY UI INTEGRATION
// =============================================================================
// The prior round's End control called fsPlanRunEnd directly, with no Begin
// step -- a design that predates the Round-13 two-stage Begin/Complete
// coordination contract, and that the real, accepted fsPlanRunEnd/
// fsPlanRunCheckEndStatus (firebase-plan-run.js's endReadAndClassify, spec
// SS6.2) now REQUIRE: a genuine Complete only proceeds while a matching,
// 'pending' users/{uid}/planProgramRunEndCoordination/{planRunId} document
// already names the exact operationId attempting it. Calling fsPlanRunEnd
// without first calling fsPlanRunBeginEnd would now deterministically fail
// every attempt with integrityConflict/noPendingCoordinationForOperation.
// This round rewires the control to the real, two-stage flow, and layers in
// the three new capabilities the accepted contract also added this round:
// Cancel (fsPlanRunCancelEnd), Abandon-Occurrence (fsPlanRunAbandonOccurrence,
// for the one narrowly-scoped in-progress-Session case), and durable,
// same-device recovery via a small localStorage convenience cache -- never
// the source of truth, only a same-device hint that Firestore's own
// authoritative state is always re-verified against.
//
// ---- Design summary (full trace, including every outcome literal this file
// branches on, is in this round's own delivery report) --------------------
//
// 1. LOCAL STORAGE IS A CONVENIENCE ONLY, NEVER AN AUTHORITY. This file
//    persists exactly one small record per Run with an attempt genuinely in
//    flight -- {ownerUid, planRunId, operationId} -- the instant it is about
//    to call fsPlanRunBeginEnd for it (so even a crash mid-network-call is
//    recoverable), and clears it only once a real, server-confirmed,
//    definitive outcome is known. Every read of this cache is treated as an
//    unverified HINT: the very first thing this file does with a recovered
//    record, on every boot/auth/list-render path, is ask Firestore itself
//    (fsPlanRunCheckEndStatus) what is actually true. A missing, corrupted,
//    or unreadable/unwritable cache never blocks a legitimate action and
//    never fabricates one either -- see planRunEndTrackingLoad/Save/Persist/
//    Clear below, every one of which is wrapped so a storage failure can
//    never throw into a real persistence call.
//
// 2. BEGIN, ALWAYS BEFORE COMPLETE. planRunEndAttemptBegin below is the only
//    path that leads to a real fsPlanRunEnd call -- Complete is never
//    attempted from a state this file has not itself seen fsPlanRunBeginEnd
//    (or a recovered fsPlanRunCheckEndStatus confirming the SAME operationId
//    is still the Run's own current pending attempt) confirm as 'pending'.
//    A fresh 'competingOperationPending' result (a DIFFERENT operationId is
//    already the Run's pending attempt -- another tab, or another device
//    that began an End for this same Run before this one asked) is shown
//    honestly and never overridden; this is also the mechanism by which a
//    device with NO local record at all discovers a cross-device-pending End
//    the moment it tries to act, safely, with no invented read primitive and
//    no change to the accepted persistence surface.
//
// 3. RECOVERY IS ONE FUNCTION, REUSED EVERYWHERE (planRunEndReconcilePkg).
//    Whatever interrupted the previous attempt (a reload, a crash, a lost
//    response, a corrupted cache entry recovered anyway from Firestore) is
//    irrelevant to how it is resolved: ask fsPlanRunCheckEndStatus for the
//    exact tracked operationId. A definitive terminal answer (committed /
//    alreadyCommitted / alreadyCancelled / rejectedTerminalComplete) is
//    applied and the tracking cleared. A 'confirmedAbsent' answer (Begin
//    genuinely landed; Complete has not) resumes the flow -- UNLESS the
//    interrupted action was itself a Cancel, in which case resuming toward
//    Complete would silently override the very thing the person asked for,
//    so that one case is surfaced instead, never auto-resumed. An ambiguous
//    'integrityConflict'/'noPendingCoordinationForOperation' (Begin may
//    never have genuinely landed at all) is disambiguated with one more,
//    always-safe, idempotent Begin retry using the SAME operationId.
//
// 4. THE IN-PROGRESS-OCCURRENCE PAUSE (planRunEndGuardOccurrenceThenComplete).
//    fsPlanRunEnd's own real contract already accepts a remaining occurrence
//    left 'inProgress' and silently marks it 'skipped' along with every
//    'pending' one -- Complete was never actually BLOCKED by this at the
//    persistence layer. This file nonetheless pauses, deliberately, before
//    ever reaching that silent skip: once Begin is confirmed, it reads the
//    Run's own real next occurrence (fsPlanRunReadForDisplay, mode:'display'
//    -- read-only, never a hard gate: a failed/inconclusive read never
//    strands the flow, it simply proceeds, exactly like this file's existing
//    Preflight call). Only a REAL, freshly-read 'inProgress' status stops the
//    flow, with an explicit warning and two honest choices: Abandon (reverts
//    the occurrence to 'pending' via the real fsPlanRunAbandonOccurrence,
//    never a local edit) or Cancel the End attempt entirely. This is the
//    one and only gate that can hold an already-Begun attempt open
//    indefinitely -- by design, since it is the one place unsaved Logger
//    content could genuinely be lost.
//
// 5. CANCEL reuses the End attempt's own operationId and receipt family --
//    fsPlanRunCancelEnd looks up the SAME users/{uid}/planProgramRunOperations
//    /{operationId} receipt path End's own Complete would use, so Cancel is
//    only ever offered against a pkg this file already has (a fresh,
//    unrelated operationId could never legitimately cancel anything, and is
//    never constructed for this purpose).
//
// 6. AUTH / NAVIGATION SAFETY -- planRunEndResultStillCurrent (operationId +
//    signed-in owner) gates every async application effect, exactly as the
//    prior round already established; extended here to Begin/Cancel/Abandon,
//    not just Complete/CheckStatus. Sign-out/owner-switch (already wired,
//    unchanged, from app-core.js's real onAuthStateChanged into
//    planRunEndResetForAuthChange) now ALSO reloads the new owner's own
//    tracking cache (or none, on sign-out) and kicks off the boot-time sweep
//    below -- never the previous owner's. DATA vs VISIBILITY, per this
//    round's own requirement, are now explicitly separated the same way the
//    Logger/Finish slice's planRunLoggerFinishIsPageVisible already
//    separates them: a resolution that lands while Home is not the active
//    page still updates planRunEndStateByRunId/the tracking cache and still
//    calls planRunUiFetchFirstPage (a harmless background refresh, exactly
//    like the pre-existing sibling surfaces already fetch off-screen) but
//    withholds its toast until/unless Home is actually visible again -- see
//    planRunEndIsPageVisible below, added this round, mirroring that file's
//    own precedent exactly.
//
// 7. BOOT-TIME SWEEP (planRunEndReconcileAllTracked, called from
//    planRunEndResetForAuthChange) clears any tracked Run that has ALREADY
//    definitively resolved (e.g. ended or cancelled from a different device
//    entirely, so it will never again appear in this owner's active-Run
//    list for the render-triggered path below to ever reach) -- a small,
//    owner-scoped, read-only-outcome pass, never more than one
//    fsPlanRunCheckEndStatus call per tracked Run. It deliberately does
//    NOT itself drive the occurrence-guard/Complete continuation (it has no
//    Run document in hand yet, since the Home list has not necessarily
//    loaded); a still-genuinely-pending record is left exactly as it is for
//    the render-triggered path (below) to pick up and fully resolve, safely
//    and idempotently, the moment (if ever) that Run's own card next renders.
//
// 8. RENDER-TRIGGERED RECOVERY (inside planRunEndRenderControl) is this
//    slice's own concrete mapping of the requirement's "boot, authentication,
//    Run-list, and End-screen entry" recovery points onto an app that has no
//    separate End screen: auth resolves (and the boot sweep above runs)
//    before Home is ever shown, and Home's own Run cards are the only place
//    this app ever surfaces an active Run's End state -- so the very first
//    time a tracked Run's card renders (an ordinary Run-list load, which is
//    also this app's own End-screen-equivalent entry point) is exactly the
//    render-triggered recovery point below, attempted at most once per
//    (owner, Run, operationId) per session.
//
// EXCLUDED, DELIBERATELY, THIS SLICE: no code path anywhere in this file
// alters History (`appDb.workouts`), any progression record, `currentWorkout`
// itself, or any Finish-attempt state -- those remain entirely app-plan-run-
// logger-ui.js's own, read here only via its existing read-only helper. No
// Firestore rules, deployment, capability activation, or Program-scheduling
// change. Pagination beyond the active-Run list's own first page is a
// disclosed, narrow limitation of the render-triggered path (item 8 above):
// a tracked Run that is active but sits on a page this session never
// scrolls to is reconciled only by the boot sweep's own terminal-outcome
// cleanup (item 7), not by the full occurrence-guard/auto-Complete
// continuation, until/unless its own card is actually rendered. Disclosed in
// the delivery report as an accepted, narrow gap for this personal-scale app
// (page size 20; SLICE 1's own already-accepted judgment call).
// =============================================================================

// ---- In-memory state, keyed per Run (never itself persisted -- the
// DURABLE record is the small tracking-cache entry below; this object is
// rebuilt from that cache, and re-verified against Firestore, on demand).
// null | {
//   phase: 'pending'          -- a real call is in flight (activity: 'begin'|
//                                'complete'|'cancel'|'abandon'|'recovering')
//         | 'uncertain'        -- a call's real outcome is unknown
//                                (lastAction: 'begin'|'complete'|'cancel'|
//                                'abandon', pkg)
//         | 'uncertainDismissed'
//         | 'competingElsewhere' -- a DIFFERENT operationId is this Run's
//                                   own current pending End attempt
//         | 'blockedByInProgressOccurrence' -- Begin confirmed; the Run's
//                                   own next occurrence is genuinely
//                                   'inProgress' right now (occurrenceId,
//                                   pkg, abandonError?)
//         | 'rejected'          -- a definitive, zero-further-recourse
//                                  rejection (outcome, reason, pkg)
//   pkg, activity?, lastAction?, occurrenceId?, abandonError?, outcome?,
//   reason?, reasons?
// }
var planRunEndStateByRunId = {};

// ---- Durable, same-device-only tracking cache (never authoritative -- see
// this file's own header, item 1). One entry per (ownerUid, planRunId) with
// an attempt genuinely in flight; cleared the instant a definitive outcome
// is known.
var PLAN_RUN_END_TRACKING_STORAGE_KEY = 'ironlog_plan_run_end_tracking_v1';
var planRunEndTrackingStore = {}; // { [ownerUid]: { [planRunId]: {ownerUid, planRunId, operationId} } }
// Guards against re-attempting the render-triggered recovery pass more than
// once per (ownerUid, planRunId, operationId) per session -- reset whenever
// the tracking store itself is reloaded (planRunEndResetForAuthChange).
var planRunEndRecoveryAttempted = {};

function planRunEndTrackingRecordValid(rec) {
  return !!rec && typeof rec === 'object' &&
    typeof rec.ownerUid === 'string' && rec.ownerUid.length > 0 &&
    typeof rec.planRunId === 'string' && rec.planRunId.length > 0 &&
    typeof rec.operationId === 'string' && rec.operationId.length > 0;
}

// Every storage access is wrapped -- a disabled/full/corrupted localStorage
// (or none at all, e.g. a non-browser test realm) degrades this file to
// exactly the prior round's own "never persisted, always starts fresh"
// posture, and never throws into any real persistence call.
function planRunEndTrackingLoad() {
  try {
    if (typeof localStorage === 'undefined') return {};
    var raw = localStorage.getItem(PLAN_RUN_END_TRACKING_STORAGE_KEY);
    if (!raw) return {};
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    var out = {};
    Object.keys(parsed).forEach(function (ownerUid) {
      var byRun = parsed[ownerUid];
      if (!byRun || typeof byRun !== 'object') return;
      var cleanByRun = {};
      Object.keys(byRun).forEach(function (planRunId) {
        var rec = byRun[planRunId];
        if (planRunEndTrackingRecordValid(rec) && rec.ownerUid === ownerUid && rec.planRunId === planRunId) {
          cleanByRun[planRunId] = { ownerUid: rec.ownerUid, planRunId: rec.planRunId, operationId: rec.operationId };
        }
      });
      if (Object.keys(cleanByRun).length) out[ownerUid] = cleanByRun;
    });
    return out;
  } catch (err) { return {}; }
}

function planRunEndTrackingSaveAll(store) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(PLAN_RUN_END_TRACKING_STORAGE_KEY, JSON.stringify(store));
  } catch (err) { /* quota/disabled/corrupted -- never blocks the real operation */ }
}

function planRunEndTrackingPersist(pkg) {
  try {
    if (!planRunEndTrackingStore[pkg.ownerUid]) planRunEndTrackingStore[pkg.ownerUid] = {};
    planRunEndTrackingStore[pkg.ownerUid][pkg.planRunId] = { ownerUid: pkg.ownerUid, planRunId: pkg.planRunId, operationId: pkg.operationId };
    planRunEndTrackingSaveAll(planRunEndTrackingStore);
  } catch (err) { /* in-memory update failing is not itself fatal; storage write is already guarded above */ }
}

function planRunEndTrackingClear(ownerUid, planRunId) {
  try {
    if (planRunEndTrackingStore[ownerUid]) {
      delete planRunEndTrackingStore[ownerUid][planRunId];
      if (Object.keys(planRunEndTrackingStore[ownerUid]).length === 0) delete planRunEndTrackingStore[ownerUid];
    }
    planRunEndTrackingSaveAll(planRunEndTrackingStore);
  } catch (err) { /* see above */ }
}

function planRunEndCurrentUid() {
  return (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.uid) || null;
}

// Mirrors app-plan-run-logger-ui.js's own planRunLoggerFinishIsPageVisible
// exactly (added this round) -- governs ONLY whether a resolution shows a
// toast, never whether the underlying tracked state/refresh is applied.
function planRunEndIsPageVisible() {
  var pageHome = (typeof document !== 'undefined') ? document.getElementById('page-home') : null;
  return !!pageHome && pageHome.classList.contains('active');
}

function planRunEndShowToastIfVisible(msg, kind) {
  if (planRunEndIsPageVisible() && typeof showToast === 'function') showToast(msg, kind);
}

// A resolution may only touch state/DOM if it is still about the exact
// attempt (same planRunId + same operationId) this file is still tracking,
// for the SAME signed-in owner that started it.
function planRunEndResultStillCurrent(planRunId, operationId, expectedUid) {
  var st = planRunEndStateByRunId[planRunId];
  return !!st && !!st.pkg && st.pkg.operationId === operationId && planRunEndCurrentUid() === expectedUid;
}

// ---- Auth-boundary reset (wired from app-core.js's own onAuthStateChanged,
// unchanged call site -- see that file's own diff history). Reloads the
// NEW owner's own tracking cache (or none, on sign-out) and kicks off the
// owner-scoped boot sweep. An End attempt has no local, editable content of
// its own to preserve across an owner change -- there is nothing to lose
// here, only stale tracking (this owner's in-memory state, never another
// owner's cache entries) to discard.
function planRunEndResetForAuthChange() {
  planRunEndStateByRunId = {};
  planRunEndRecoveryAttempted = {};
  planRunEndTrackingStore = planRunEndTrackingLoad();
  var ownerUid = planRunEndCurrentUid();
  if (ownerUid) planRunEndReconcileAllTracked(ownerUid);
}

// ---- Boot-time sweep (item 7 in this file's own header). Read-only in
// effect (fsPlanRunCheckEndStatus never writes); clears only a tracked Run
// that has ALREADY definitively resolved. Never touches a still-genuinely-
// pending record -- the render-triggered path owns fully resolving those.
function planRunEndReconcileAllTracked(ownerUid) {
  var byRun = planRunEndTrackingStore[ownerUid];
  if (!byRun) return;
  Object.keys(byRun).forEach(function (planRunId) {
    var rec = byRun[planRunId];
    if (!rec) return;
    var pkg = { operationId: rec.operationId, ownerUid: rec.ownerUid, planRunId: rec.planRunId };
    var p;
    try {
      p = fsPlanRunPersistence.fsPlanRunCheckEndStatus(pkg);
    } catch (err) { return; } // a synchronous throw here is not evidence of anything -- leave the record for the render-triggered path
    p.then(function (result) {
      if (planRunEndCurrentUid() !== ownerUid) return; // owner already changed again -- drop silently, never touch the new owner's own state
      if (result && (result.outcome === 'committed' || result.outcome === 'alreadyCommitted' || result.outcome === 'alreadyCancelled' || result.outcome === 'rejectedTerminalComplete')) {
        planRunEndTrackingClear(ownerUid, planRunId);
        if (planRunEndStateByRunId[planRunId] && planRunEndStateByRunId[planRunId].pkg && planRunEndStateByRunId[planRunId].pkg.operationId === rec.operationId) {
          delete planRunEndStateByRunId[planRunId];
          planRunEndRefreshSection();
        }
      }
      // 'confirmedAbsent' / any rejection -- left exactly as-is; the
      // render-triggered path (planRunEndRenderControl) owns full
      // resolution once/if this Run's own card next renders.
    }).catch(function () { /* leave the record -- never a reason to clear tracking on a mere network failure */ });
  });
}

// Safe, harmless no-op when Home is not currently mounted/rendering (e.g. a
// boot-time sweep resolving before the first render) -- mirrors the existing
// planRunUiRenderSection's own null-guard.
function planRunEndRefreshSection() {
  if (typeof planRunUiRenderSection === 'function') planRunUiRenderSection();
}

// ---- Blocking check (requirement: do not discard an open Run-linked
// workout or an unresolved Finish attempt). Computed live, every render.
function planRunEndBlockedReason(planRunId) {
  if (typeof planRunLoggerBlocksEndForRun === 'function' && planRunLoggerBlocksEndForRun(planRunId)) {
    return 'openWorkoutOrUnresolvedFinish';
  }
  return null;
}

// True while this Run has an End attempt whose real outcome is not yet
// known to be a definitive non-blocking state -- consulted by
// app-plan-run-ui.js's own planRunUiStartSession and app-plan-run-logger-
// ui.js's own planRunLoggerLaunch, before either stamps new work for this
// Run, and by each of those files' own rendered controls.
function planRunEndBlocksNewWorkoutForRun(planRunId) {
  var st = planRunEndStateByRunId[planRunId];
  if (!st) return false;
  return st.phase === 'pending' || st.phase === 'uncertain' || st.phase === 'uncertainDismissed' ||
    st.phase === 'competingElsewhere' || st.phase === 'blockedByInProgressOccurrence';
}

function planRunEndFindRun(planRunId) {
  return (planRunUiState && planRunUiState.runs || []).filter(function (r) { return r.planRunId === planRunId; })[0] || null;
}

// ---- Entry point: the "End Run" control. -----------------------------------
function planRunEndRequestConfirm(planRunId) {
  if (!planRunUiCapabilityEnabled()) return;
  var st = planRunEndStateByRunId[planRunId];
  if (st && planRunEndBlocksNewWorkoutForRun(planRunId)) return; // duplicate-submission guard
  if (planRunEndBlockedReason(planRunId)) return; // the block itself IS the explanation -- no dialog opens while it applies
  confirm2(
    'End this Program Run?',
    'Ending early skips any Sessions you have not yet completed in this Program Run. Workouts you have already logged, and any progression already recorded from them, are kept exactly as they are. This cannot be undone.',
    function () { planRunEndBegin(planRunId); },
    'End Run',
    true
  );
}

function planRunEndBegin(planRunId) {
  var run = planRunEndFindRun(planRunId);
  var ownerUid = planRunEndCurrentUid();
  if (!run || !ownerUid) return;
  if (planRunEndBlockedReason(planRunId)) { planRunEndRefreshSection(); return; }
  var st = planRunEndStateByRunId[planRunId];
  if (st && planRunEndBlocksNewWorkoutForRun(planRunId)) return;

  var operationId = uid();
  var pkg = { operationId: operationId, ownerUid: ownerUid, planRunId: planRunId };

  // Advisory-only preflight -- the REAL, non-bypassable enforcement lives
  // inside fsPlanRunEnd's own transaction. A rejection here stops before any
  // network round-trip is even attempted; the real transaction independently
  // re-enforces the same cap regardless.
  var remainingCount = Array.isArray(run.remainingOccurrenceIds) ? run.remainingOccurrenceIds.length : 0;
  var pre;
  try {
    pre = fsPlanRunPersistence.fsPlanRunPreflightEnd(pkg, remainingCount);
  } catch (err) {
    pre = null;
  }
  if (pre && pre.ok === false) {
    planRunEndStateByRunId[planRunId] = { phase: 'rejected', outcome: 'budgetExceeded', reasons: pre.reasons, pkg: pkg };
    planRunEndRefreshSection();
    return;
  }

  planRunEndAttemptBegin(pkg, run);
}

// ---- Stage 1: Begin. Never persists a losing/rejected pkg -- only one that
// is genuinely 'pending' or whose outcome is genuinely unknown.
function planRunEndAttemptBegin(pkg, run) {
  var expectedUid = pkg.ownerUid;
  planRunEndTrackingPersist(pkg); // durable BEFORE the network call -- see this file's own header, item 1
  planRunEndStateByRunId[pkg.planRunId] = { phase: 'pending', activity: 'begin', pkg: pkg };
  planRunEndRefreshSection();
  var p;
  try {
    p = fsPlanRunPersistence.fsPlanRunBeginEnd({ ownerUid: pkg.ownerUid, planRunId: pkg.planRunId, operationId: pkg.operationId });
  } catch (err) {
    planRunEndEnterUncertain(pkg, 'begin');
    return;
  }
  p.then(function (result) {
    if (!planRunEndResultStillCurrent(pkg.planRunId, pkg.operationId, expectedUid)) return;
    planRunEndApplyBeginOutcome(pkg, result, run);
  }).catch(function (err) {
    if (!planRunEndResultStillCurrent(pkg.planRunId, pkg.operationId, expectedUid)) return;
    planRunEndEnterUncertain(pkg, 'begin');
  });
}

function planRunEndApplyBeginOutcome(pkg, result, run) {
  if (result && result.outcome === 'pending') {
    planRunEndGuardOccurrenceThenComplete(pkg, run);
    return;
  }
  if (result && result.outcome === 'competingOperationPending') {
    planRunEndTrackingClear(pkg.ownerUid, pkg.planRunId); // not ours to track -- a DIFFERENT operationId is the Run's own current pending attempt
    planRunEndStateByRunId[pkg.planRunId] = { phase: 'competingElsewhere', pkg: pkg };
    planRunEndRefreshSection();
    return;
  }
  // requiredDocumentMissing / documentMalformed / crossDocumentBindingMismatch
  // / integrityConflict(runNotActive/slot*) / invalidInput -- definitive,
  // zero-write rejections. Nothing legitimate was ever established.
  planRunEndTrackingClear(pkg.ownerUid, pkg.planRunId);
  planRunEndStateByRunId[pkg.planRunId] = { phase: 'rejected', outcome: (result && result.outcome) || 'unknown', reason: result && result.reason, pkg: pkg };
  planRunEndRefreshSection();
}

function planRunEndEnterUncertain(pkg, lastAction, occurrenceId) {
  planRunEndStateByRunId[pkg.planRunId] = { phase: 'uncertain', lastAction: lastAction, pkg: pkg, occurrenceId: occurrenceId };
  planRunEndRefreshSection();
}

// ---- The in-progress-occurrence pause (item 4 in this file's own header).
// Read-only, advisory: any failure/inconclusive result proceeds straight to
// Complete rather than stranding an already-confirmed Begin.
function planRunEndGuardOccurrenceThenComplete(pkg, run) {
  var occurrenceId = run && run.nextOccurrenceId;
  if (!occurrenceId) { planRunEndAttemptComplete(pkg); return; }
  var expectedUid = pkg.ownerUid;
  var p;
  try {
    p = fsPlanRunPersistence.fsPlanRunReadForDisplay({ ownerUid: pkg.ownerUid, planRunId: pkg.planRunId, occurrenceId: occurrenceId, mode: 'display' });
  } catch (err) {
    planRunEndAttemptComplete(pkg);
    return;
  }
  p.then(function (result) {
    if (!planRunEndResultStillCurrent(pkg.planRunId, pkg.operationId, expectedUid)) return;
    if (result && result.outcome === 'verified' && result.occurrence && result.occurrence.status === 'inProgress') {
      planRunEndStateByRunId[pkg.planRunId] = { phase: 'blockedByInProgressOccurrence', pkg: pkg, occurrenceId: occurrenceId };
      planRunEndRefreshSection();
      return;
    }
    planRunEndAttemptComplete(pkg);
  }).catch(function () {
    if (!planRunEndResultStillCurrent(pkg.planRunId, pkg.operationId, expectedUid)) return;
    planRunEndAttemptComplete(pkg); // advisory read failed -- never strands an already-confirmed Begin
  });
}

// ---- Stage 2: Complete. -----------------------------------------------------
function planRunEndAttemptComplete(pkg) {
  var expectedUid = pkg.ownerUid;
  planRunEndStateByRunId[pkg.planRunId] = { phase: 'pending', activity: 'complete', pkg: pkg };
  planRunEndRefreshSection();
  var p;
  try {
    p = fsPlanRunPersistence.fsPlanRunEnd(pkg);
  } catch (err) {
    planRunEndEnterUncertain(pkg, 'complete');
    return;
  }
  p.then(function (result) {
    if (!planRunEndResultStillCurrent(pkg.planRunId, pkg.operationId, expectedUid)) return;
    planRunEndApplyTerminalOutcome(pkg, result, 'complete');
  }).catch(function (err) {
    if (!planRunEndResultStillCurrent(pkg.planRunId, pkg.operationId, expectedUid)) return;
    planRunEndEnterUncertain(pkg, 'complete');
  });
}

// End's own package carries no free-form content, so every committed/
// alreadyCommitted/alreadyCancelled/cancelled here is equally trustworthy --
// no Finish-style packageHashVerified gate is needed.
function planRunEndConfirmsEnded(result) {
  return !!result && (result.outcome === 'committed' || result.outcome === 'alreadyCommitted');
}
function planRunEndConfirmsCancelled(result) {
  return !!result && (result.outcome === 'cancelled' || result.outcome === 'alreadyCancelled');
}

function planRunEndApplyTerminalOutcome(pkg, result, sourceAction) {
  if (planRunEndConfirmsEnded(result)) {
    planRunEndTrackingClear(pkg.ownerUid, pkg.planRunId);
    delete planRunEndStateByRunId[pkg.planRunId];
    planRunEndShowToastIfVisible('Program Run ended.', 'success');
    if (typeof planRunUiFetchFirstPage === 'function') planRunUiFetchFirstPage();
    return;
  }
  if (planRunEndConfirmsCancelled(result)) {
    planRunEndTrackingClear(pkg.ownerUid, pkg.planRunId);
    delete planRunEndStateByRunId[pkg.planRunId];
    planRunEndShowToastIfVisible('The End request was cancelled. This Program Run is still active.', 'success');
    if (typeof planRunUiFetchFirstPage === 'function') planRunUiFetchFirstPage();
    return;
  }
  if (result && result.outcome === 'rejectedTerminalComplete') {
    planRunEndTrackingClear(pkg.ownerUid, pkg.planRunId);
    delete planRunEndStateByRunId[pkg.planRunId];
    planRunEndShowToastIfVisible('This Program Run had already completed all its Sessions.', 'success');
    if (typeof planRunUiFetchFirstPage === 'function') planRunUiFetchFirstPage();
    return;
  }
  // AMBIGUOUS, NOT DEFINITIVE -- Cancel's own 'notCurrentlyPending' or
  // Abandon's own 'integrityConflict'/'noPendingCoordinationForOperation':
  // this exact operationId is no longer the Run's current pending attempt,
  // but that alone does not say WHY (it may have already committed via a
  // race with Complete). Never guessed -- resolved with one more real,
  // authoritative read of the SAME operationId.
  if ((sourceAction === 'cancel' && result && result.outcome === 'notCurrentlyPending') ||
    (sourceAction === 'abandon' && result && result.outcome === 'integrityConflict' && result.reason === 'noPendingCoordinationForOperation')) {
    planRunEndReconcilePkg(pkg, planRunEndFindRun(pkg.planRunId), sourceAction);
    return;
  }
  if (sourceAction === 'abandon') {
    // Every other Abandon-specific rejection (requiredDocumentMissing /
    // documentMalformed / crossDocumentBindingMismatch / integrityConflict
    // for a reason other than the ambiguous one just handled above, e.g.
    // occurrenceAlreadyTerminal/occurrenceNotInRemainingWork/runNotActive) --
    // never silently advanced to Complete: shown honestly, still offering
    // Abandon-retry and Cancel, never discarding the tracked End attempt.
    planRunEndStateByRunId[pkg.planRunId] = {
      phase: 'blockedByInProgressOccurrence', pkg: pkg, occurrenceId: planRunEndStateByRunId[pkg.planRunId] && planRunEndStateByRunId[pkg.planRunId].occurrenceId,
      abandonError: (result && result.outcome) || 'unknown'
    };
    planRunEndRefreshSection();
    return;
  }
  // Every other Begin/Complete/Cancel rejection (invalidInput /
  // requiredDocumentMissing / documentMalformed / crossDocumentBindingMismatch
  // / integrityConflict / budgetExceeded) -- a definitive, zero-further-
  // recourse outcome. requiredDocumentMissing specifically reflects a
  // client-state bug (the Run this card was showing no longer exists) --
  // logged, never offered a Retry, exactly like every other rejection here.
  if (result && result.outcome === 'requiredDocumentMissing' && typeof console !== 'undefined' && console.error) {
    console.error('[IRON LOG] End Run: the Run this card was showing no longer exists (requiredDocumentMissing) -- this should not be reachable from normal navigation.', pkg);
  }
  planRunEndTrackingClear(pkg.ownerUid, pkg.planRunId);
  planRunEndStateByRunId[pkg.planRunId] = {
    phase: 'rejected',
    outcome: (result && result.outcome) || 'unknown',
    reason: result && result.reason,
    reasons: result && result.reasons,
    pkg: pkg
  };
  planRunEndRefreshSection();
}

// ---- The single, reusable recovery routine (item 3 in this file's own
// header). Used by: render-triggered recovery, "Check Status", "Retry" (for
// an uncertain Begin/Complete), and the ambiguous-Cancel/Abandon follow-up
// above. `run` may be null (e.g. the boot sweep never reaches this function
// at all; a render-triggered call always has it) -- a null `run` simply
// skips the occurrence guard and proceeds straight to Complete, exactly like
// planRunEndGuardOccurrenceThenComplete's own null-occurrenceId branch.
function planRunEndReconcilePkg(pkg, run, lastAction) {
  planRunEndStateByRunId[pkg.planRunId] = { phase: 'pending', activity: 'recovering', pkg: pkg };
  planRunEndRefreshSection();
  planRunEndReconcileCore(pkg, run, lastAction, false);
}

// Same real check + disambiguation + occurrence-guard sequence as
// planRunEndReconcilePkg above, but never overwrites whatever is currently
// tracked/rendered before a real resolution arrives -- used by the
// user-facing "Check Status" button (planRunEndCheckStatus below), so
// clicking it never itself hides the still-relevant uncertain/dismissed
// banner (and its own Retry/Dismiss/Cancel controls) while the check is
// merely in flight. `st.pkg` is left exactly as it was, so
// planRunEndResultStillCurrent's own currency check still passes normally
// once this resolves. A user-initiated status check never itself issues a
// fresh Complete attempt on 'confirmedAbsent' (see planRunEndReconcileCore's
// own `quiet` branch below) -- it only ever reports the truth; a separate,
// explicit "Retry" click is what resubmits.
function planRunEndReconcilePkgQuiet(pkg, run, lastAction) {
  planRunEndReconcileCore(pkg, run, lastAction, true);
}

// Shared core for planRunEndReconcilePkg / planRunEndReconcilePkgQuiet above.
// `quiet` distinguishes the two ONLY in how a 'confirmedAbsent' result (Begin
// genuinely landed; Complete has not, yet) is handled: a silent, automatic
// recovery pass (boot sweep, render-triggered recovery, the ambiguous
// Cancel/Abandon follow-up) is free to resume straight toward Complete,
// since the user already asked to End and there is nothing further for them
// to decide. A user-initiated "Check Status" click (quiet=true) must never
// itself be the thing that (re)submits Complete -- it only ever reports the
// real, current truth, leaving the tracked package exactly as it was and
// safe for an explicit "Retry" to resubmit.
function planRunEndReconcileCore(pkg, run, lastAction, quiet) {
  var expectedUid = pkg.ownerUid;
  var p;
  try {
    p = fsPlanRunPersistence.fsPlanRunCheckEndStatus({ operationId: pkg.operationId, ownerUid: pkg.ownerUid, planRunId: pkg.planRunId });
  } catch (err) {
    planRunEndEnterUncertain(pkg, lastAction || 'complete');
    return;
  }
  p.then(function (result) {
    if (!planRunEndResultStillCurrent(pkg.planRunId, pkg.operationId, expectedUid)) return;
    if (result && result.outcome === 'confirmedAbsent') {
      // Begin genuinely landed; Complete has not (yet). A quiet (user-
      // initiated "Check Status") check never itself resubmits Complete --
      // it only reports the truth, leaving the SAME tracked package
      // uncertain and safe for an explicit "Retry" to resubmit. A silent,
      // automatic pass (boot sweep / render-triggered recovery / the
      // ambiguous Cancel-or-Abandon follow-up) is free to resume straight
      // toward Complete on the person's behalf -- EXCEPT when the person's
      // own last action here was specifically Cancel, where resuming toward
      // Complete would silently override that request instead.
      if (quiet || lastAction === 'cancel') {
        planRunEndStateByRunId[pkg.planRunId] = { phase: 'uncertain', lastAction: lastAction || 'complete', pkg: pkg };
        planRunEndRefreshSection();
        return;
      }
      planRunEndGuardOccurrenceThenComplete(pkg, run || planRunEndFindRun(pkg.planRunId));
      return;
    }
    if (result && result.outcome === 'integrityConflict' && result.reason === 'noPendingCoordinationForOperation') {
      // Ambiguous: Begin may never have genuinely landed. One more,
      // always-safe, idempotent Begin retry with the SAME operationId
      // disambiguates it.
      var p2;
      try {
        p2 = fsPlanRunPersistence.fsPlanRunBeginEnd({ ownerUid: pkg.ownerUid, planRunId: pkg.planRunId, operationId: pkg.operationId });
      } catch (err2) {
        planRunEndEnterUncertain(pkg, lastAction || 'begin');
        return;
      }
      p2.then(function (beginResult) {
        if (!planRunEndResultStillCurrent(pkg.planRunId, pkg.operationId, expectedUid)) return;
        planRunEndApplyBeginOutcome(pkg, beginResult, run || planRunEndFindRun(pkg.planRunId));
      }).catch(function () {
        if (!planRunEndResultStillCurrent(pkg.planRunId, pkg.operationId, expectedUid)) return;
        planRunEndEnterUncertain(pkg, lastAction || 'begin');
      });
      return;
    }
    // committed / alreadyCommitted / alreadyCancelled / rejectedTerminalComplete
    // / any other definitive rejection.
    planRunEndApplyTerminalOutcome(pkg, result, 'complete');
  }).catch(function () {
    if (!planRunEndResultStillCurrent(pkg.planRunId, pkg.operationId, expectedUid)) return;
    planRunEndEnterUncertain(pkg, lastAction || 'complete');
  });
}

// ---- User-facing recovery actions ------------------------------------------
function planRunEndCheckStatus(planRunId) {
  var st = planRunEndStateByRunId[planRunId];
  if (!st) return;
  if (st.phase === 'competingElsewhere') { planRunEndBegin(planRunId); return; } // "Check Again" -- a fresh attempt, safe and idempotent either way
  if (st.phase !== 'uncertain' && st.phase !== 'uncertainDismissed') return;
  planRunEndReconcilePkgQuiet(st.pkg, planRunEndFindRun(planRunId), st.lastAction);
}

function planRunEndRetry(planRunId) {
  var st = planRunEndStateByRunId[planRunId];
  if (!st || (st.phase !== 'uncertain' && st.phase !== 'uncertainDismissed')) return;
  if (planRunEndBlockedReason(planRunId)) { planRunEndRefreshSection(); return; }
  if (st.lastAction === 'cancel') { planRunEndAttemptCancel(st.pkg); return; }
  if (st.lastAction === 'abandon') { planRunEndAttemptAbandon(st.pkg, st.occurrenceId); return; }
  if (st.lastAction === 'begin') { planRunEndAttemptBegin(st.pkg, planRunEndFindRun(planRunId)); return; }
  planRunEndAttemptComplete(st.pkg);
}

function planRunEndRequestCancel(planRunId) {
  var st = planRunEndStateByRunId[planRunId];
  if (!st || !st.pkg) return;
  if (st.phase !== 'uncertain' && st.phase !== 'uncertainDismissed' && st.phase !== 'blockedByInProgressOccurrence') return;
  var pkg = st.pkg;
  confirm2(
    'Cancel this End request?',
    'If it hasn’t gone through yet, this Program Run stays active and nothing is skipped. If it already went through, cancelling has no effect — you’ll see the real result.',
    function () { planRunEndAttemptCancel(pkg); },
    'Cancel End Request',
    true
  );
}

function planRunEndAttemptCancel(pkg) {
  var expectedUid = pkg.ownerUid;
  planRunEndStateByRunId[pkg.planRunId] = { phase: 'pending', activity: 'cancel', pkg: pkg };
  planRunEndRefreshSection();
  var p;
  try {
    p = fsPlanRunPersistence.fsPlanRunCancelEnd(pkg);
  } catch (err) {
    planRunEndEnterUncertain(pkg, 'cancel');
    return;
  }
  p.then(function (result) {
    if (!planRunEndResultStillCurrent(pkg.planRunId, pkg.operationId, expectedUid)) return;
    planRunEndApplyTerminalOutcome(pkg, result, 'cancel');
  }).catch(function (err) {
    if (!planRunEndResultStillCurrent(pkg.planRunId, pkg.operationId, expectedUid)) return;
    planRunEndEnterUncertain(pkg, 'cancel');
  });
}

function planRunEndRequestAbandon(planRunId) {
  var st = planRunEndStateByRunId[planRunId];
  if (!st || st.phase !== 'blockedByInProgressOccurrence' || !st.pkg || !st.occurrenceId) return;
  var pkg = st.pkg, occurrenceId = st.occurrenceId;
  confirm2(
    'Abandon this in-progress Session?',
    'Any sets logged for it that were never saved will be lost, and this Session will be skipped when the Program Run ends. This cannot be undone.',
    function () { planRunEndAttemptAbandon(pkg, occurrenceId); },
    'Abandon Session',
    true
  );
}

function planRunEndAttemptAbandon(pkg, occurrenceId) {
  var expectedUid = pkg.ownerUid;
  planRunEndStateByRunId[pkg.planRunId] = { phase: 'pending', activity: 'abandon', pkg: pkg, occurrenceId: occurrenceId };
  planRunEndRefreshSection();
  var abandonPkg = { ownerUid: pkg.ownerUid, planRunId: pkg.planRunId, occurrenceId: occurrenceId, operationId: pkg.operationId };
  var p;
  try {
    p = fsPlanRunPersistence.fsPlanRunAbandonOccurrence(abandonPkg);
  } catch (err) {
    planRunEndEnterUncertain(pkg, 'abandon', occurrenceId);
    return;
  }
  p.then(function (result) {
    if (!planRunEndResultStillCurrent(pkg.planRunId, pkg.operationId, expectedUid)) return;
    if (result && (result.outcome === 'committed' || result.outcome === 'alreadyPending')) {
      planRunEndAttemptComplete(pkg); // the blocker is cleared -- proceed exactly as the fresh, unblocked flow would
      return;
    }
    planRunEndApplyTerminalOutcome(pkg, result, 'abandon');
  }).catch(function (err) {
    if (!planRunEndResultStillCurrent(pkg.planRunId, pkg.operationId, expectedUid)) return;
    planRunEndEnterUncertain(pkg, 'abandon', occurrenceId);
  });
}

// ---- Dismiss: hides the on-screen NOTICE only -- never erases tracking of
// an attempt whose real outcome is still unknown, because that tracking is
// the ONLY thing (planRunEndBlocksNewWorkoutForRun) standing between an End
// that may still commit and a newly-opened workout for the same Run.
function planRunEndDismiss(planRunId) {
  var st = planRunEndStateByRunId[planRunId];
  if (!st || st.phase === 'pending') return;
  if (st.phase === 'uncertain' || st.phase === 'uncertainDismissed') {
    planRunEndStateByRunId[planRunId] = { phase: 'uncertainDismissed', lastAction: st.lastAction, pkg: st.pkg, occurrenceId: st.occurrenceId };
    planRunEndRefreshSection();
    return;
  }
  // 'rejected' (or any other definitively-resolved, non-blocking phase):
  // safe to discard entirely. 'competingElsewhere'/'blockedByInProgressOccurrence'
  // are NOT dismissible here -- both are known, definitive, still-blocking
  // states with their own explicit actions (Check Again / Abandon / Cancel),
  // never a "hide and forget" affordance.
  delete planRunEndStateByRunId[planRunId];
  planRunEndRefreshSection();
}

// ---- Rendering --------------------------------------------------------------
function planRunEndRenderControl(run) {
  if (!run || run.status !== 'active') return '';
  var planRunId = run.planRunId;
  var st = planRunEndStateByRunId[planRunId];

  // Render-triggered recovery (item 8 in this file's own header): the first
  // time this Run's own card renders with nothing in memory yet but a
  // matching tracked record on this device, kick off the one, reusable
  // recovery routine -- at most once per (owner, Run, operationId).
  if (!st) {
    var ownerUid = planRunEndCurrentUid();
    var rec = ownerUid && planRunEndTrackingStore[ownerUid] && planRunEndTrackingStore[ownerUid][planRunId];
    if (rec && ownerUid) {
      var attemptKey = ownerUid + '|' + planRunId + '|' + rec.operationId;
      if (!planRunEndRecoveryAttempted[attemptKey]) {
        planRunEndRecoveryAttempted[attemptKey] = true;
        var pkg = { operationId: rec.operationId, ownerUid: rec.ownerUid, planRunId: rec.planRunId };
        planRunEndStateByRunId[planRunId] = { phase: 'pending', activity: 'recovering', pkg: pkg };
        st = planRunEndStateByRunId[planRunId];
        // Deferred one microtask so this synchronous render pass finishes
        // (and returns this SAME 'recovering' markup) before any network
        // call begins -- planRunEndReconcilePkg's own eventual resolution
        // triggers its own, later, top-level re-render.
        Promise.resolve().then(function () { planRunEndReconcilePkg(pkg, run); });
      }
    }
  }

  var html = '<div class="planrun-end" style="margin-top:8px">';
  if (!st) {
    var blocked = planRunEndBlockedReason(planRunId);
    if (blocked) {
      html += '<div data-testid="planrun-end-blocked" style="font-size:13px;color:var(--text2)">Finish or resolve the open Session for this Program Run before ending it.</div>';
    } else {
      html += '<button class="btn-secondary" data-testid="planrun-end-run-btn" data-planrun-action="end-run-request" data-planrun-run-id="' + escapeHtml(planRunId) + '">End Run</button>';
    }
  } else if (st.phase === 'pending') {
    var activityLabel = (st.activity === 'cancel') ? 'Cancelling End request…' :
      (st.activity === 'abandon') ? 'Abandoning Session…' :
      (st.activity === 'recovering') ? 'Checking this Program Run’s End status…' : 'Ending Program Run…';
    html += '<span data-testid="planrun-end-pending" style="color:var(--text2);font-size:13px">' + escapeHtml(activityLabel) + '</span>';
  } else if (st.phase === 'competingElsewhere') {
    html += '<div data-testid="planrun-end-competing" style="padding:8px;border:1px solid var(--border,#ccc);border-radius:8px">'
      + '<div style="margin-bottom:6px;font-size:13px">An End request for this Program Run is already in progress elsewhere. Starting a new Session for it is paused until that resolves.</div>'
      + '<button class="btn-secondary" data-testid="planrun-end-check-again-btn" data-planrun-action="end-run-check-status" data-planrun-run-id="' + escapeHtml(planRunId) + '">Check Again</button>'
      + '</div>';
  } else if (st.phase === 'blockedByInProgressOccurrence') {
    html += '<div data-testid="planrun-end-blocked-occurrence" style="padding:8px;border:1px solid var(--border,#ccc);border-radius:8px">'
      + '<div style="margin-bottom:6px;font-size:13px">A Session for this Program Run is in progress right now. Ending will skip it unless you abandon it first.</div>';
    if (st.abandonError) {
      html += '<div data-testid="planrun-end-abandon-error" style="margin-bottom:6px;font-size:13px;color:#b00">Couldn’t abandon this Session just now. You can try again, or cancel the End request instead.</div>';
    }
    html += '<button class="btn-secondary" data-testid="planrun-end-abandon-btn" data-planrun-action="end-run-abandon" data-planrun-run-id="' + escapeHtml(planRunId) + '">Abandon Session</button> '
      + '<button class="btn-secondary" data-testid="planrun-end-cancel-btn" data-planrun-action="end-run-cancel" data-planrun-run-id="' + escapeHtml(planRunId) + '">Cancel End Request</button>'
      + '</div>';
  } else if (st.phase === 'uncertain' || st.phase === 'uncertainDismissed') {
    var retryBlocked = !!planRunEndBlockedReason(planRunId);
    var testId = st.phase === 'uncertain' ? 'planrun-end-uncertain' : 'planrun-end-uncertain-dismissed';
    var wrapStyle = st.phase === 'uncertain'
      ? 'padding:8px;border:1px solid var(--border,#ccc);border-radius:8px'
      : 'padding:6px 8px;border:1px solid var(--border,#ccc);border-radius:8px;font-size:12px;color:var(--text2)';
    html += '<div data-testid="' + testId + '" style="' + wrapStyle + '">'
      + '<div style="margin-bottom:6px;font-size:13px">We couldn’t confirm whether this Program Run’s End request went through. It’s safe to check or try again.</div>';
    if (retryBlocked) {
      html += '<div data-testid="planrun-end-retry-blocked" style="margin-bottom:6px;font-size:13px;color:var(--text2)">A Session for this Program Run is open right now, so Retry is paused until it’s finished or resolved. Checking status is still safe.</div>';
    }
    html += '<button class="btn-secondary" data-testid="planrun-end-check-status-btn" data-planrun-action="end-run-check-status" data-planrun-run-id="' + escapeHtml(planRunId) + '">Check Status</button> ';
    if (!retryBlocked) {
      html += '<button class="btn-secondary" data-testid="planrun-end-retry-btn" data-planrun-action="end-run-retry" data-planrun-run-id="' + escapeHtml(planRunId) + '">Retry</button> ';
    }
    html += '<button class="btn-secondary" data-testid="planrun-end-cancel-btn" data-planrun-action="end-run-cancel" data-planrun-run-id="' + escapeHtml(planRunId) + '">Cancel End Request</button>';
    if (st.phase === 'uncertain') {
      html += ' <button class="btn-secondary" data-testid="planrun-end-dismiss-btn" data-planrun-action="end-run-dismiss" data-planrun-run-id="' + escapeHtml(planRunId) + '">Dismiss</button>';
    }
    html += '</div>';
  } else if (st.phase === 'rejected') {
    html += '<div data-testid="planrun-end-rejected" style="padding:8px;border:1px solid var(--border,#ccc);border-radius:8px">'
      + '<div style="margin-bottom:6px;font-size:13px;color:#b00">' + escapeHtml(planRunEndRejectionMessage(st)) + '</div>'
      + '<button class="btn-secondary" data-testid="planrun-end-dismiss-btn" data-planrun-action="end-run-dismiss" data-planrun-run-id="' + escapeHtml(planRunId) + '">Dismiss</button>'
      + '</div>';
  }
  html += '</div>';
  return html;
}

function planRunEndRejectionMessage(st) {
  var outcome = st.outcome;
  if (outcome === 'budgetExceeded') return 'This Program Run is too large to end safely right now.';
  if (outcome === 'requiredDocumentMissing') return 'This Program Run could not be found. Please refresh.';
  if (outcome === 'integrityConflict' || outcome === 'documentMalformed' || outcome === 'crossDocumentBindingMismatch') {
    return 'We found a problem with this Program Run’s data and can’t end it safely right now.';
  }
  return 'This Program Run couldn’t be ended right now.';
}

// No Node export seam -- this file is, like app-plan-run-ui.js itself,
// entirely DOM-driven (confirm2, document, auth, fsPlanRunPersistence,
// localStorage); unlike app-plan-run-logger-ui.js it has no pure, zero-I/O
// functions worth exposing to a plain-Node harness.
