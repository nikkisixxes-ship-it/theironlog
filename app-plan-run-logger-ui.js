// =============================================================================
// app-plan-run-logger-ui.js -- Run-aware logger LAUNCH and FINISH slice (this
// round). Resolves the deferral app-plan-run-ui.js's own header comment
// named ("deliberately NOT the live, interactive page-log screen... a
// dependency this slice stops and reports rather than quietly resolving
// with a write") per the owner's explicit decisions recorded in
// program-run-logger-finish-slice-addendum.md:
//   1. Persisted Set shape is the already-implemented flat 8-field shape
//      (plan-run-model.js) -- `time`, not `seconds`. Not reopened here.
//   2. This slice EXTENDS the existing Session-preview path
//      (app-plan-run-ui.js) into the real, interactive `#page-log` screen --
//      no parallel "TRAIN" flow, and Run Finish never falls through to
//      legacy finishWorkout()'s own two branches (`currentWorkout.programId`/
//      `currentWorkout.activeProgramId`) or its fire-and-forget
//      `fsSaveWorkout()` tail. `app-core.js`'s `finishWorkout()` gains
//      exactly one new, additive, EARLY-return branch:
//        if (currentWorkout.canonicalRun) { finishCanonicalRunWorkout(); return; }
//      inserted after the existing shared preamble (name defaulting, empty-
//      set/exercise filtering, the `_isEdit` branch, `duration` capture) and
//      before the legacy `programId`/`activeProgramId` branches -- see that
//      file's own diff for the exact insertion point.
//   3. A genuine `integrityConflict` from Mark-In-Progress (already handled
//      by app-plan-run-ui.js's own planRunUiStartSession) is shown and
//      blocks launch, with wording distinct from an ordinary transient
//      failure. This file does not change that gate -- launch (below) is
//      reached only through the SAME already-confirmed 'committed'/
//      'alreadyInProgress' path planRunUiStartSession already requires.
//
// STATUS / NON-AUTHORIZATION NOTICE: submitted for INDEPENDENT REVIEW ONLY.
// CANONICAL_PLAN_RUN_CAPABILITY_ENABLED (firebase-plan-run.js) remains
// hardcoded false -- fsPlanRunFinish/fsPlanRunCheckFinishStatus both begin
// with that file's own disabledGate() and issue zero Firestore I/O in
// production today. This file calls exactly two persistence functions --
// fsPlanRunPersistence.fsPlanRunFinish and
// fsPlanRunPersistence.fsPlanRunCheckFinishStatus -- never Start, End, or
// any progression-evaluation function directly (progression evaluation is
// entirely internal to fsPlanRunFinish's own transaction; this file only
// ever reads its returned resultRefs, never invokes it separately). The
// user-facing End Run path is explicitly deferred to a separate slice --
// no code here reaches fsPlanRunEnd/fsPlanRunPreflightEnd/
// fsPlanRunCheckEndStatus.
//
// SCOPE THIS ROUND:
//   A. LAUNCH: extends app-plan-run-ui.js's read-only Session-preview
//      content with a real "Open Logger" control (wired from that file --
//      see its own diff), which calls planRunLoggerLaunch(run, occurrence)
//      below. Builds a real `currentWorkout` from the occurrence's own
//      already-verified `assignments[].orderedSets[]` (the SAME data the
//      read-only preview already renders, via the SAME existing
//      `planSetToLoggerSet` converter app-plan.js already exports -- no new
//      numeric auto-fill logic; the already-accepted, already-disclosed
//      "no %TM/%1RM/working-load resolution outside an Active Program
//      instance" gap applies identically here), stamps `currentWorkout.
//      canonicalRun` with exactly the identity fields Finish will need, and
//      opens the real `#page-log` screen via the SAME
//      finalizeStartActiveWorkout/startNewWorkout convention every other
//      logger launch already uses (renderWorkoutExercises/showPage/
//      startWorkoutTimer).
//   B. IDENTITY PRESERVATION AT LAUNCH: every Set the logger renders for a
//      canonical Run session is stamped with its own real, already-verified
//      `planSetId` (occurrence.assignments[].orderedSets[].planSetId) and
//      every exercise with its own real `planAssignmentId`/
//      `planPrescriptionId` -- the SAME identity fields
//      planRunWorkoutContextMatchesOccurrence (plan-run-model.js, not
//      reopened) requires every persisted Set to resolve against. Because
//      that already-accepted model requires EVERY persisted Set to resolve
//      to a real prescribed Set, and the generic logger's own `addSet`/
//      `addPRSet`/`removeSet` (app-core.js) have no concept of that
//      identity, this slice adds one small, additive guard to each of
//      those three existing functions (see app-core.js's own diff): for a
//      canonical Run session only, they decline with an honest message
//      instead of silently either fabricating an unidentifiable Set or
//      silently dropping one at Finish time -- a Run-linked Session logs
//      exactly its prescribed Sets, matching what the read-only preview
//      already showed. This is a direct, non-guessed consequence of
//      decision 1 above ("preserve every required... Set identity"), not a
//      new design decision -- disclosed here and in the delivery report,
//      not silently applied.
//   C. FINISH: `finishCanonicalRunWorkout()` builds the amended 16-field
//      top-level / 8-field-flat-Set / `perfVideos`-array workout doc from
//      `currentWorkout` (coercing each Set's weight/reps/time/rpe to a
//      real finite number or null, and completed/isPR/isNew1RM to a real
//      boolean -- see planRunLoggerCoerceNumOrNull/planRunLoggerCoerceBool
//      below; the in-memory logger set's own fields are plain strings from
//      `<input>.value`, confirmed by reading app-core.js's own `updateSet`),
//      then calls the real, awaited `fsPlanRunFinish` transaction. Shows
//      honest pending/committed/notEligible/conflict/budgetExceeded/
//      invalidInput/uncertain states on `#page-log` itself (never navigates
//      away until success is CONFIRMED by the transaction's own return
//      value), offers Retry (resubmits the EXACT SAME prepared `pkg`/
//      `operationId`, never rebuilt) and Check Status
//      (fsPlanRunCheckFinishStatus, read-only, identity-only input) on an
//      uncertain outcome, and disables the Finish button for the duration
//      of any in-flight or uncertain attempt so a second click can never
//      submit a second, competing operationId for the same workoutId.
//
// EXCLUDED, DELIBERATELY, THIS SLICE: the user-facing End Run path (its own
// subsequent slice, per the owner's explicit instruction); any interactive
// per-Rule progression Apply/Edit/Skip review UI (no such capability exists
// anywhere in this codebase for the canonical model -- progression
// evaluation is fully automatic inside fsPlanRunFinish's own transaction;
// this file only surfaces its resultRefs.needsManualReviewRuleIds count as
// an honest informational note, never an interactive review flow); Save-
// without-finishing (fsPlanRunSaveHistoryOnly) from this screen; History-
// only workout creation.
//
// LIFECYCLE-SAFETY CORRECTION (this round, still logger-launch/Finish only
// -- End Run not begun). Four narrowly scoped fixes, all still inside this
// file plus the two small app-core.js call sites this file already relies
// on (finishWorkout's branch, the auth-change/showPage boundaries):
//   1. planRunLoggerFinishResetForAuthChange now also discards a Run-linked
//      currentWorkout (never a legacy one -- see that function's own
//      comment).
//   2. Result staleness is now two INDEPENDENT checks, not one buggy epoch
//      counter that was declared but never actually consulted:
//      planRunLoggerFinishResultStillCurrent(pkg) (is this response still
//      about the CURRENT workout/owner/attempt -- gates every data/state
//      effect) and planRunLoggerFinishIsPageVisible() (is #page-log the
//      active page RIGHT NOW -- gates only the interruptive toast/
//      navigation on a real commit). The old planRunLoggerFinishEpoch/
//      planRunLoggerFinishInvalidateForNav/planRunLoggerFinishIsCurrentForRender
//      (the last of which was written but never actually called anywhere)
//      are removed as superseded, not left as dead, misleading weight.
//   3. planRunLoggerLaunch now declines (zero state change, honest toast)
//      when a currentWorkout already exists -- legacy or canonicalRun --
//      rather than silently overwriting it.
//   4. finishCanonicalRunWorkout now also blocks re-entry while the
//      tracked attempt is 'uncertain', not only 'pending' -- Retry remains
//      the sole path that may resubmit during that phase. The existing
//      Abandon contract (fresh operationId, same workoutId, "fsPlanRunFinish's
//      own already-accepted collision handling resolves that safely
//      regardless of whether the abandoned attempt secretly did commit")
//      was traced against the real planRunClassifyFinishOccurrence branches
//      (b)/(h) before this correction, confirmed still safe, and therefore
//      left unchanged -- see the delivery report for the full trace.
//
// LIFECYCLE-SAFETY CORRECTION, ROUND 2 (independent review) -- one narrowly
// scoped fix, still inside this file only, no plan-run-model.js/
// firebase-plan-run.js change:
//   5. Abandon -> edit -> fresh Finish (new operationId, same workoutId) ->
//      the ORIGINAL, abandoned attempt turns out to have actually committed:
//      fsPlanRunFinish's own real, already-accepted branch (b) ("no-receipt
//      self-commit", plan-run-model.js) correctly returns alreadyCommitted
//      in this case (the occurrence really IS completed under this
//      workoutId) -- but branch (b) only confirms the STORED workout's own
//      structural identity against the occurrence, never its byte content
//      against THIS fresh attempt's own (possibly-edited) pkg.workout. This
//      file previously treated every 'alreadyCommitted' outcome as proof
//      that pkg.workout was what got saved -- true for a genuine first
//      commit and for an exact-pkg Retry, but NOT true here: the real,
//      persisted content is the ORIGINAL attempt's, which this fresh
//      attempt's local pkg never saw.
//      The already-accepted, already-shipped fsPlanRunFinish contract
//      already discloses exactly this uncertainty via its own
//      `packageHashVerified` field (plan-run-model.js branch (a)'s own
//      comment: "a status-check-only call... must never claim to have
//      verified byte-identical package content it never had" -- the same
//      honesty requirement applies here). This correction does not add,
//      redefine, or reinterpret that field -- it simply makes THIS file
//      finally read it: `planRunLoggerFinishApplyOutcome` (reached only
//      from a real fsPlanRunFinish call -- a fresh Finish or an exact-pkg
//      Retry) now trusts pkg.workout for History/"saved" ONLY when
//      outcome==='committed' (this attempt's own write just happened, so
//      pkg.workout trivially IS the content) or outcome==='alreadyCommitted'
//      && packageHashVerified===true (an exact-pkg Retry always reaches
//      this, byte-verified, since it resubmits the SAME operationId+content
//      fsPlanRunFinish just hashed). Any other 'alreadyCommitted' --
//      reachable only after an Abandon, per the trace above and in the
//      delivery report -- routes to a new, honest, non-"saved" state
//      (planRunLoggerFinishEnterAlreadyCommittedUnverified) instead: local
//      History is never written with unverified content, and no "saved"
//      toast is ever shown for content that was never actually confirmed.
//      fsPlanRunCheckFinishStatus's own outcome handling (planRunLogger
//      FinishCheckStatus) is DELIBERATELY left unchanged -- see that
//      function's own comment for why it is safe as-is without this same
//      gate (it can only ever confirm the SAME already-tracked pkg, which
//      cannot collide with a different attempt without an intervening
//      Abandon that already ends its own tracking first).
//
// END RUN SLICE (this round) -- adds exactly one new, pure, read-only
// function, `planRunLoggerBlocksEndForRun(planRunId)` (below), consumed by
// the new `app-plan-run-end-ui.js`'s own End Run control so it can refuse to
// offer ending a Run while this file's own logger state still has an open
// Run-linked workout or an unresolved Finish attempt belonging to that same
// Run. This file itself still calls exactly the same two persistence
// functions named above -- fsPlanRunFinish/fsPlanRunCheckFinishStatus --
// and never fsPlanRunEnd/fsPlanRunPreflightEnd/fsPlanRunCheckEndStatus,
// which live entirely in the new file.
//
// SAFETY CORRECTION (this round -- independent-review finding, same-device
// race; see app-plan-run-end-ui.js's own header for the full trace):
// `planRunLoggerLaunch` below is the ONLY place in this codebase that stamps
// a NEW `currentWorkout.canonicalRun` -- it now also refuses to do so while
// a DIFFERENT file's End attempt for the SAME Run is 'pending' or
// 'uncertain', checked via app-plan-run-end-ui.js's own read-only
// `planRunEndBlocksNewWorkoutForRun` (the exact reverse-direction mirror of
// this file's own `planRunLoggerBlocksEndForRun`, immediately above). This
// file still never itself calls fsPlanRunEnd/fsPlanRunPreflightEnd/
// fsPlanRunCheckEndStatus, and still never reads app-plan-run-end-ui.js's
// own `planRunEndStateByRunId` directly -- only through that file's one
// exported read-only check, the same cross-file hand-off convention this
// file's own `planRunLoggerBlocksEndForRun` already established in the
// opposite direction.
// =============================================================================

// ---- Pure coercion helpers (zero I/O) -- exported below for direct testing
// without a DOM. Mirror the in-memory logger set's own real representation:
// app-core.js's `updateSet(exIdx, setIdx, field, val)` stores `val` (an
// `<input type="number">`'s raw `.value`, i.e. a STRING, or '' when blank --
// confirmed by reading that function directly, never something this file
// assumes) verbatim into `currentWorkout.exercises[exIdx].sets[setIdx]
// [field]`, with no numeric coercion anywhere in the legacy logger itself
// (the legacy History write path persists those same raw strings
// unchanged). The already-accepted, already-reviewed canonical Set
// validator (plan-run-model.js's planRunWorkoutSetValid) requires a REAL
// finite number or `null` for weight/reps/time/rpe -- never a string, never
// NaN -- so this coercion is required new logic for this slice, applied
// only at the canonical Finish boundary, never touching the legacy write
// path or the in-memory logger representation itself.
// -----------------------------------------------------------------------------
function planRunLoggerCoerceNumOrNull(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v === 'string') {
    if (v.trim() === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  return null;
}
function planRunLoggerCoerceBool(v) { return v === true; }

// Builds one canonical flat Set (PLAN_RUN_WORKOUT_SET_KEYS order/shape) from
// one in-memory logger set. `planSetId` is never derived or guessed here --
// it must already have been stamped onto the in-memory set at launch
// (planRunLoggerBuildCurrentWorkout below); a set missing one is dropped by
// the caller (planRunLoggerBuildWorkoutDoc), never persisted with a
// fabricated id.
function planRunLoggerBuildPersistedSet(s) {
  return {
    planSetId: s.planSetId,
    weight: planRunLoggerCoerceNumOrNull(s.weight),
    reps: planRunLoggerCoerceNumOrNull(s.reps),
    time: planRunLoggerCoerceNumOrNull(s.time),
    rpe: planRunLoggerCoerceNumOrNull(s.rpe),
    completed: planRunLoggerCoerceBool(s.completed),
    isPR: planRunLoggerCoerceBool(s.isPR),
    isNew1RM: planRunLoggerCoerceBool(s.isNew1RM)
  };
}

// Builds the full amended 16-field canonical workout document from a
// `currentWorkout` already carrying a `canonicalRun` stamp (see
// planRunLoggerBuildCurrentWorkout). Pure except for its `nowFn`/`ownerUid`
// inputs (both supplied by the caller, never read from ambient globals
// here) -- safe to unit-test without a DOM or `auth`. Returns
// `{ok:true, workout}` or `{ok:false, reason}` -- a `reason` of
// 'missingSetIdentity' means at least one rendered Set lost its
// `planSetId` stamp somehow (should be unreachable given the launch-time
// stamping and the add/remove guards in app-core.js, but this function
// never assumes that and never silently drops a Set to "fix" the shape --
// an honest, zero-write rejection is always preferred to guessing).
function planRunLoggerBuildWorkoutDoc(currentWorkout, ownerUid, nowTimestamp) {
  if (!currentWorkout || !currentWorkout.canonicalRun) return { ok: false, reason: 'notCanonicalRun' };
  var cr = currentWorkout.canonicalRun;
  var exercises = [];
  for (var i = 0; i < currentWorkout.exercises.length; i++) {
    var ex = currentWorkout.exercises[i];
    if (typeof ex.planAssignmentId !== 'string' || typeof ex.planPrescriptionId !== 'string') {
      return { ok: false, reason: 'missingExerciseIdentity' };
    }
    var sets = [];
    for (var s = 0; s < ex.sets.length; s++) {
      if (typeof ex.sets[s].planSetId !== 'string') return { ok: false, reason: 'missingSetIdentity' };
      sets.push(planRunLoggerBuildPersistedSet(ex.sets[s]));
    }
    var perfVideos = Array.isArray(ex.perfVideos) ? ex.perfVideos.filter(function (v) { return typeof v === 'string' && v.length > 0; }) : [];
    exercises.push({ exerciseId: ex.exerciseId, planAssignmentId: ex.planAssignmentId, planPrescriptionId: ex.planPrescriptionId, sets: sets, perfVideos: perfVideos });
  }
  var workout = {
    id: currentWorkout.id, ownerUid: ownerUid,
    planRunId: cr.planRunId, planOccurrenceId: cr.occurrenceId, planTemplateId: cr.planTemplateId,
    headRevisionId: cr.headRevisionId, planMicrocycleId: cr.planMicrocycleId, planSessionId: cr.planSessionId,
    recordKind: 'canonicalWorkout', completionState: 'sessionCompleted',
    name: currentWorkout.name, date: planRunLoggerCoerceNumOrNull(currentWorkout.date),
    duration: planRunLoggerCoerceNumOrNull(currentWorkout.duration), bodyweight: planRunLoggerCoerceNumOrNull(currentWorkout.bodyweight),
    exercises: exercises, createdAt: nowTimestamp
  };
  return { ok: true, workout: workout };
}

// -----------------------------------------------------------------------------
// DOM / UI layer -- everything below needs a real browser (or jsdom) realm.
// -----------------------------------------------------------------------------

function planRunLoggerCapabilityEnabled() {
  if (typeof window !== 'undefined' && window.__PLAN_RUN_TEST_OVERRIDE_ENABLED__ === true) return true;
  return typeof window !== 'undefined' && window.CANONICAL_PLAN_RUN_CAPABILITY_ENABLED === true;
}
function planRunLoggerCurrentUid() {
  return (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.uid) || null;
}

// END RUN SLICE ADDITION -- a pure, read-only check used by
// app-plan-run-end-ui.js's own End Run control before it will even offer to
// end a Run: true when THIS SAME Run (planRunId) currently has an open
// Run-linked workout in the logger, or an unresolved Finish attempt tracked
// for it. Reads this file's own existing module state only (`currentWorkout`,
// `planRunLoggerFinishState`) -- introduces no new state, and never mutates
// anything. Checked as two independent conditions, matching the requirement
// literally ("an open Run-linked workout OR an unresolved Finish attempt"):
//   - an open workout: `currentWorkout.canonicalRun.planRunId === planRunId`
//     -- covers every phase where a Session for this Run is still sitting
//     open/editable in the logger, including 'pending'/'uncertain'/the
//     Round-2 'alreadyCommittedUnverified' phase (all three leave
//     currentWorkout populated by design -- see that phase's own header) and
//     even the ordinary case where nothing has been submitted yet at all.
//   - an unresolved Finish attempt: derived independently from
//     `planRunLoggerFinishState.pkg.planRunId` (never from currentWorkout),
//     so this stays correct even if a future change ever decouples the two.
//     Only 'pending'/'uncertain'/'alreadyCommittedUnverified' count as
//     unresolved -- every other phase (disabled/error/a terminal rejection
//     already Dismissable, or no state at all) is already fully resolved
//     and never blocks End.
function planRunLoggerBlocksEndForRun(planRunId) {
  var hasOpenWorkout = !!(typeof currentWorkout !== 'undefined' && currentWorkout && currentWorkout.canonicalRun && currentWorkout.canonicalRun.planRunId === planRunId);
  var hasUnresolvedFinish = !!(typeof planRunLoggerFinishState !== 'undefined' && planRunLoggerFinishState && planRunLoggerFinishState.pkg && planRunLoggerFinishState.pkg.planRunId === planRunId &&
    (planRunLoggerFinishState.phase === 'pending' || planRunLoggerFinishState.phase === 'uncertain' || planRunLoggerFinishState.phase === 'alreadyCommittedUnverified'));
  return hasOpenWorkout || hasUnresolvedFinish;
}

// ---- A. LAUNCH --------------------------------------------------------------
// Called from app-plan-run-ui.js's read-only preview screen's new "Open
// Logger" control. `run`/`occurrence` are the SAME already-verified objects
// (fsPlanRunReadForDisplay, mode:'display') that screen already has in hand
// -- no additional read is issued here. Building `currentWorkout` and
// opening `#page-log` is entirely synchronous, local state -- no write of
// any kind happens at launch; the first real write this whole path can
// possibly cause is the person's own later, explicit Finish.
function planRunLoggerLaunch(run, occurrence) {
  if (!planRunLoggerCapabilityEnabled()) return false;
  if (!run || !occurrence || !Array.isArray(occurrence.assignments) || occurrence.assignments.length === 0) return false;
  // LIFECYCLE-SAFETY CORRECTION, issue 3 -- opening a Run Session must never
  // silently discard logged work already in progress, whether that work is
  // an ordinary legacy workout or an earlier Run-linked one. Declines
  // honestly (zero state change) instead; the person must explicitly Finish
  // or Cancel whatever is already open first.
  if (currentWorkout) {
    showToast('Finish or cancel your current workout before starting a new Session.', 'error');
    return false;
  }
  // SAFETY CORRECTION (this round) -- see this file's own header and
  // app-plan-run-end-ui.js's for the full trace: never open a NEW workout
  // for a Run whose End attempt has not yet resolved one way or the other,
  // however this function was reached (Resume's read-only preview, or
  // Start Session's own preview afterward).
  if (typeof planRunEndBlocksNewWorkoutForRun === 'function' && planRunEndBlocksNewWorkoutForRun(run.planRunId)) {
    showToast('This Program Run is being ended. Wait for that to finish before opening the logger.', 'error');
    return false;
  }
  var exercises = occurrence.assignments.map(function (a) {
    var sets = (a.orderedSets || []).map(function (os) {
      var loggerSet = (typeof planSetToLoggerSet === 'function') ? planSetToLoggerSet(os.prescribed, a.exerciseId, null, null) : { weight: '', reps: '', time: '', rpe: '', autoFilled: false, autoType: null, completed: false };
      loggerSet.planSetId = os.planSetId;
      loggerSet.isPR = false;
      loggerSet.isNew1RM = false;
      return loggerSet;
    });
    return { exerciseId: a.exerciseId, planAssignmentId: a.planAssignmentId, planPrescriptionId: a.planPrescriptionId, sets: sets, perfVideos: [] };
  });
  currentWorkout = {
    id: uid(), name: (occurrence.nameSnapshot && occurrence.nameSnapshot.sessionName) || (occurrence.nameSnapshot && occurrence.nameSnapshot.microcycleName) || 'Program Run Session',
    date: Date.now(), exercises: exercises, rpeEnabled: false, duration: 0, bodyweight: null,
    canonicalRun: {
      planRunId: occurrence.planRunId, occurrenceId: occurrence.occurrenceId, planTemplateId: occurrence.planTemplateId,
      headRevisionId: occurrence.headRevisionId, planMicrocycleId: occurrence.planMicrocycleId, planSessionId: occurrence.planSessionId
    }
  };
  planRunLoggerFinishState = null;
  planRunLoggerFinishCurrentOperationId = null;
  document.getElementById('workout-exercises').innerHTML = '';
  var nameDisplay = document.getElementById('log-session-name-display');
  if (nameDisplay) nameDisplay.textContent = (currentWorkout.name || 'WORKOUT').toUpperCase();
  renderWorkoutExercises();
  showPage('page-log');
  startWorkoutTimer();
  return true;
}

// ---- C. FINISH ---------------------------------------------------------------
// In-memory only (a reload always starts fresh, matching every other
// Program Run surface's own posture) -- see this file's own header on why
// this state survives ordinary navigation away from #page-log (unlike
// app-plan-run-start-ui.js's own planRunStartClose, which fully discards
// its state on navigation) but is fully discarded on a real auth change.
var planRunLoggerFinishState = null; // null | {phase, pkg?, reason?, resultRefs?}

// LIFECYCLE-SAFETY CORRECTION, issue 2 -- replaces the prior
// planRunLoggerFinishEpoch/planRunLoggerFinishInvalidateForNav/
// planRunLoggerFinishIsCurrentForRender mechanism (the epoch was bumped on
// navigation/new launch/auth change but was never actually consulted by
// planRunLoggerFinishApplyOutcome or the uncertain path -- a real defect;
// planRunLoggerFinishIsCurrentForRender was written but never called
// anywhere). "Still current" and "currently visible" are two independent
// questions and are now two independent, always-consulted checks:
//   - planRunLoggerFinishResultStillCurrent(pkg): is this response still
//     about the workout/owner/attempt this screen is actually tracking right
//     now? Gates every data/state effect (currentWorkout mutation, appDb
//     writes, Finish-attempt state). A stale result (superseded by a newer
//     launch, an Abandon, or a real auth change) is dropped untouched --
//     never partially applied.
//   - planRunLoggerFinishIsPageVisible(): is #page-log the active page RIGHT
//     NOW? Gates ONLY the interruptive toast + redirect-to-Home inside
//     planRunLoggerFinishCommit -- never the underlying save, which already
//     genuinely happened and must be reflected (History, currentWorkout,
//     the Finish button) regardless of what screen the person currently has
//     open.
// planRunLoggerFinishCurrentOperationId tracks the operationId of the one
// attempt (if any) this screen still considers live for the CURRENT
// currentWorkout -- set when a fresh attempt is built (finishCanonicalRun
// Workout), cleared on a fresh launch, an Abandon, or an auth change. A
// result whose own pkg.operationId no longer matches this is stale by
// definition, independent of currentWorkout identity.
var planRunLoggerFinishCurrentOperationId = null;

function planRunLoggerFinishResultStillCurrent(pkg) {
  return !!pkg && !!currentWorkout && !!currentWorkout.canonicalRun &&
    currentWorkout.id === pkg.workoutId &&
    planRunLoggerCurrentUid() === pkg.ownerUid &&
    planRunLoggerFinishCurrentOperationId === pkg.operationId;
}

function planRunLoggerFinishIsPageVisible() {
  var pageLog = (typeof document !== 'undefined') ? document.getElementById('page-log') : null;
  return !!pageLog && pageLog.classList.contains('active');
}

function planRunLoggerFinishContainer() {
  return (typeof document !== 'undefined') ? document.getElementById('plan-run-finish-status') : null;
}

function planRunLoggerFinishHandleClick(event) {
  var btn = event.target.closest ? event.target.closest('[data-planrun-finish-action]') : null;
  if (!btn) return;
  var action = btn.getAttribute('data-planrun-finish-action');
  if (action === 'retry') planRunLoggerFinishRetry();
  else if (action === 'check-status') planRunLoggerFinishCheckStatus();
  else if (action === 'abandon') planRunLoggerFinishAbandon();
}
function planRunLoggerFinishWireEvents(el) {
  if (!el || el.__planRunLoggerFinishWired) return;
  el.addEventListener('click', planRunLoggerFinishHandleClick);
  el.__planRunLoggerFinishWired = true;
}

// Entry point -- called from app-core.js's finishWorkout() when
// currentWorkout.canonicalRun is set (see that file's own diff). Never
// falls through to any legacy branch; always returns without touching
// appDb.workouts/fsSaveWorkout unless/until a real 'committed'/
// 'alreadyCommitted' outcome is confirmed.
function finishCanonicalRunWorkout() {
  if (!currentWorkout || !currentWorkout.canonicalRun) return;
  if (!planRunLoggerCapabilityEnabled()) { planRunLoggerFinishSetState({ phase: 'disabled' }); return; }
  // Duplicate-submission / re-entry guard (extended this round -- issue 4):
  // a second Finish click while one is already pending, OR while the
  // previous attempt is 'uncertain' (its real outcome not yet known), is a
  // no-op -- never a second, competing operationId for the same workoutId.
  // Retry remains the sole path that may resubmit during 'uncertain'; it
  // resubmits the EXACT SAME already-prepared pkg (see
  // planRunLoggerFinishRetry), never a fresh one built here. Traced against
  // the real planRunClassifyFinishOccurrence branches (b)/(h)
  // (plan-run-model.js) before this correction: a fresh Finish here, while
  // the prior attempt's real-world outcome is still unknown, is exactly the
  // race the addendum and this correction both treat as unsafe -- see this
  // file's own header and the delivery report for the full trace. A
  // definitively resolved state (committed, or a rejected/dismissable
  // outcome the person has Abandoned) does not block this -- once
  // planRunLoggerFinishState is null again, a fresh Finish is an ordinary,
  // new, honest attempt.
  if (planRunLoggerFinishState && (planRunLoggerFinishState.phase === 'pending' || planRunLoggerFinishState.phase === 'uncertain')) return;
  var ownerUid = planRunLoggerCurrentUid();
  if (!ownerUid) { planRunLoggerFinishSetState({ phase: 'error', reason: 'noAuthenticatedUser' }); return; }
  var nowTs = (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.Timestamp) ? firebase.firestore.Timestamp.now() : { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 };
  var built = planRunLoggerBuildWorkoutDoc(currentWorkout, ownerUid, nowTs);
  if (!built.ok) { planRunLoggerFinishSetState({ phase: 'error', reason: built.reason }); return; }
  var operationId = uid();
  var pkg = {
    operationId: operationId, ownerUid: ownerUid, planRunId: currentWorkout.canonicalRun.planRunId,
    occurrenceId: currentWorkout.canonicalRun.occurrenceId, workoutId: currentWorkout.id, workout: built.workout
  };
  planRunLoggerFinishCurrentOperationId = operationId;
  planRunLoggerFinishAttempt(pkg, ownerUid);
}

function planRunLoggerFinishAttempt(pkg, ownerUid) {
  planRunLoggerFinishSetState({ phase: 'pending', pkg: pkg });
  var p;
  try {
    p = fsPlanRunPersistence.fsPlanRunFinish(pkg);
  } catch (err) {
    planRunLoggerFinishEnterUncertain(pkg, ownerUid);
    return;
  }
  Promise.resolve(p).then(function (result) {
    planRunLoggerFinishApplyOutcome(pkg, ownerUid, result);
  }, function () {
    planRunLoggerFinishEnterUncertain(pkg, ownerUid);
  });
}

function planRunLoggerFinishApplyOutcome(pkg, expectedUid, result) {
  // LIFECYCLE-SAFETY CORRECTION, issue 2 -- staleness is now checked here,
  // for every outcome branch, not left unconsulted. A result that is no
  // longer "still current" (a newer launch, an Abandon, or a real auth
  // change already superseded this exact attempt) is dropped untouched: no
  // currentWorkout mutation, no state change, no toast, no redirect. This
  // covers the auth-change case the old `planRunLoggerCurrentUid() !==
  // expectedUid` check handled, plus the cases it missed (a newer
  // currentWorkout under the SAME owner).
  if (!planRunLoggerFinishResultStillCurrent(pkg)) return;
  if (result && (result.outcome === 'committed' || result.outcome === 'alreadyCommitted')) {
    // LIFECYCLE-SAFETY CORRECTION, ROUND 2, issue 5 -- 'committed' always
    // means THIS attempt's own write just happened (pkg.workout trivially
    // IS the persisted content). 'alreadyCommitted' means something else --
    // possibly a DIFFERENT, earlier attempt (only reachable after an
    // Abandon) -- and is trustworthy here ONLY when packageHashVerified is
    // explicitly true (an exact-pkg Retry always gets this, since it
    // resubmits the identical operationId+content fsPlanRunFinish itself
    // hashes and compares). See this file's own header for the full trace.
    if (planRunLoggerFinishResultConfirmsLocalContent(result)) {
      planRunLoggerFinishCommit(pkg, result);
    } else {
      planRunLoggerFinishEnterAlreadyCommittedUnverified(pkg, result);
    }
    return;
  }
  if (result && result.outcome === 'notEligibleForCompletion') {
    planRunLoggerFinishSetState({ phase: 'notEligible' });
    return;
  }
  if (result && result.outcome === 'budgetExceeded') {
    planRunLoggerFinishSetState({ phase: 'budgetExceeded', reasons: result.reasons || [] });
    return;
  }
  if (result && result.outcome === 'integrityConflict') {
    planRunLoggerFinishSetState({ phase: 'conflict', reason: result.reason || null });
    return;
  }
  if (result && result.outcome === 'invalidInput') {
    // A shape/identity rejection BEFORE any write -- this slice's own
    // builder is designed to never produce one, but a genuine occurrence is
    // shown honestly, never silently retried as if it might succeed
    // unchanged.
    planRunLoggerFinishSetState({ phase: 'error', reason: result.reason || null });
    return;
  }
  if (result && (result.outcome === 'occurrenceSkipped' || result.outcome === 'competingOperationCorroborated')) {
    // A competing operation already resolved this occurrence (e.g. a
    // duplicate attempt from another tab/device) -- not this attempt's own
    // success, but not this attempt's own failure either. Shown as its own
    // distinct, honest state, never claimed as "saved" by THIS attempt.
    planRunLoggerFinishSetState({ phase: 'competing' });
    return;
  }
  // Any other/malformed shape is treated exactly like a thrown failure --
  // uncertain, never a false success.
  planRunLoggerFinishEnterUncertain(pkg, expectedUid);
}

// LIFECYCLE-SAFETY CORRECTION, ROUND 2, issue 5 -- the one place this file
// decides whether pkg.workout (this screen's own local copy) may honestly
// be treated as "what is actually persisted." 'committed' is always true by
// construction (this exact call just wrote it). 'alreadyCommitted' is true
// only when the persistence layer itself reports packageHashVerified:true
// -- never inferred, never assumed from the outcome string alone.
function planRunLoggerFinishResultConfirmsLocalContent(result) {
  if (!result) return false;
  if (result.outcome === 'committed') return true;
  if (result.outcome === 'alreadyCommitted') return result.packageHashVerified === true;
  return false;
}

// Reached only from planRunLoggerFinishApplyOutcome (a real fsPlanRunFinish
// call -- a fresh Finish or an exact-pkg Retry) when the outcome is
// 'alreadyCommitted' without packageHashVerified:true. This means: the
// occurrence is genuinely, permanently completed under this workoutId, but
// NOT provably by pkg.workout's own content -- an EARLIER, different
// attempt for this same workoutId (only reachable after an Abandon; see
// this file's own header for the full trace) may be what actually
// committed, and its real content could differ from what currentWorkout
// holds right now. Never writes appDb.workouts, never shows a "saved"
// toast, never navigates away -- this screen cannot honestly claim its own
// current content is what got persisted. currentWorkout itself is left
// untouched (matching every other rejected/terminal phase's own
// convention) so the person's edits are never silently discarded; the real,
// actually-persisted content will still reach appDb.workouts on its own,
// via this app's ordinary COL_WORKOUTS live listener (app-core.js), exactly
// as it would for any write this session did not itself make.
function planRunLoggerFinishEnterAlreadyCommittedUnverified(pkg, result) {
  planRunLoggerFinishSetState({ phase: 'alreadyCommittedUnverified', pkg: pkg, resultRefs: (result && result.resultRefs) || null });
}

function planRunLoggerFinishCommit(pkg, result) {
  // Success is rendered/acted on ONLY here, reached ONLY from a real
  // 'committed'/'alreadyCommitted' outcome, and ONLY for a result
  // planRunLoggerFinishApplyOutcome/planRunLoggerFinishCheckStatus has
  // already confirmed is still current (see planRunLoggerFinishResultStill
  // Current) -- so the data effects below always apply. Pushes the EXACT
  // persisted document (never raw currentWorkout, which still carries
  // in-memory-only fields like autoFilled/targetData) into appDb.workouts so
  // History reflects it immediately, mirroring legacy finishWorkout()'s own
  // appDb.workouts.unshift(...) tail -- the one piece of that tail this
  // slice deliberately preserves, since it is pure local display state, not
  // a write.
  //
  // LIFECYCLE-SAFETY CORRECTION, issue 2 -- whether the write itself really
  // happened does NOT depend on what screen the person currently has open,
  // so every data/state effect below (History, clearing currentWorkout,
  // stopping the timer, clearing the tracked attempt) always runs. Only the
  // INTERRUPTIVE parts -- the success toast and the redirect to Home -- are
  // gated on #page-log actually being visible right now; a late commit that
  // resolves after the person has already navigated elsewhere must not
  // yank them back to Home or pop a toast about a screen they're not on.
  var wasVisible = planRunLoggerFinishIsPageVisible();
  appDb.workouts.unshift(pkg.workout);
  var resultRefs = result.resultRefs || null;
  planRunLoggerFinishState = null;
  planRunLoggerFinishCurrentOperationId = null;
  stopWorkoutTimer();
  currentWorkout = null;
  if (wasVisible) {
    var needsReview = resultRefs && Array.isArray(resultRefs.needsManualReviewRuleIds) ? resultRefs.needsManualReviewRuleIds.length : 0;
    if (needsReview > 0) {
      showToast('Workout saved! ' + needsReview + ' progression rule' + (needsReview === 1 ? ' needs' : 's need') + ' manual review.', 'success');
    } else {
      showToast('Workout saved!', 'success');
    }
    showPage('page-home');
  } else {
    // Not on #page-log right now -- no toast, no redirect (issue 2's
    // explicit requirement). #plan-run-finish-status and the Finish button
    // are still brought current so a later return to #page-log shows
    // nothing pending, honestly reflecting that this attempt already
    // resolved; showPage('page-home') above would have done this via its
    // own id==='page-log' branch, so it's done directly here instead.
    planRunLoggerFinishRender();
  }
}

function planRunLoggerFinishEnterUncertain(pkg, expectedUid) {
  // Mirrors planRunLoggerFinishApplyOutcome's own currency check -- a
  // throw/reject/malformed-result path reaches here too, and must be
  // dropped just as silently when superseded.
  if (!planRunLoggerFinishResultStillCurrent(pkg)) return;
  planRunLoggerFinishSetState({ phase: 'uncertain', pkg: pkg });
}

function planRunLoggerFinishRetry() {
  var st = planRunLoggerFinishState;
  if (!st || st.phase !== 'uncertain' || !st.pkg) return;
  var ownerUid = planRunLoggerCurrentUid();
  if (!ownerUid || ownerUid !== st.pkg.ownerUid) return;
  // Reuses the EXACT SAME pkg object (same operationId, same workout byte
  // content) -- never rebuilt from currentWorkout, which may since have
  // been mutated by further edits on this screen (the person is free to
  // keep typing while an attempt is uncertain; Retry still resubmits
  // exactly what was originally prepared, per the task's own "preserve the
  // exact prepared attempt" requirement -- a person who wants their further
  // edits included must Abandon and Finish again, a fresh, honest attempt).
  planRunLoggerFinishAttempt(st.pkg, ownerUid);
}

function planRunLoggerFinishCheckStatus() {
  var st = planRunLoggerFinishState;
  if (!st || st.phase !== 'uncertain' || !st.pkg || st.checking) return;
  var ownerUid = planRunLoggerCurrentUid();
  if (!ownerUid || ownerUid !== st.pkg.ownerUid) return;
  var pkg = st.pkg;
  planRunLoggerFinishSetState(Object.assign({}, st, { checking: true }));
  var p;
  try {
    p = fsPlanRunPersistence.fsPlanRunCheckFinishStatus({
      operationId: pkg.operationId, ownerUid: pkg.ownerUid, planRunId: pkg.planRunId,
      occurrenceId: pkg.occurrenceId, workoutId: pkg.workoutId
    });
  } catch (err) {
    if (!planRunLoggerFinishResultStillCurrent(pkg)) return;
    planRunLoggerFinishSetState(Object.assign({}, planRunLoggerFinishState, { checking: false }));
    return;
  }
  Promise.resolve(p).then(function (result) {
    if (!planRunLoggerFinishResultStillCurrent(pkg)) return;
    // LIFECYCLE-SAFETY CORRECTION, ROUND 2, issue 5 -- deliberately NOT
    // gated on packageHashVerified the way planRunLoggerFinishApplyOutcome
    // now is (see that function and this file's own header). Check Status
    // is read-only, identity-only input (never carries pkg.workout, so
    // fsPlanRunCheckFinishStatus can never honestly set that flag true for
    // ANY outcome -- gating on it here would treat every legitimate
    // "confirm my own uncertain attempt" recovery as unverified, breaking
    // the existing, accepted Check Status contract). This is safe as-is:
    // `pkg` here is always `st.pkg`, the SAME package this exact uncertain
    // attempt already submitted via a real fsPlanRunFinish call -- and the
    // re-entry guard in finishCanonicalRunWorkout blocks any OTHER attempt
    // for this workoutId for as long as this one stays 'uncertain', so
    // nothing else can have raced it. The ambiguity this round's fix
    // addresses is only ever introduced by Abandon (which ends this exact
    // tracking first, before a DIFFERENT, possibly-edited attempt can ever
    // be built) -- Check Status can therefore never observe it.
    if (result && (result.outcome === 'committed' || result.outcome === 'alreadyCommitted')) {
      planRunLoggerFinishCommit(pkg, result);
      return;
    }
    if (result && result.outcome === 'confirmedAbsent') {
      // The Finish never actually happened -- the SAME pending pkg is still
      // safe to Retry (nothing was committed under it).
      planRunLoggerFinishSetState({ phase: 'uncertain', pkg: pkg, checking: false, lastCheck: 'confirmedAbsent' });
      return;
    }
    // occurrenceSkipped/competingOperationCorroborated/integrityConflict/
    // anything else -- stay uncertain, report the check's own result
    // honestly, still offering Retry/Check Status/Abandon.
    planRunLoggerFinishSetState({ phase: 'uncertain', pkg: pkg, checking: false, lastCheck: (result && result.outcome) || 'unknown' });
  }, function () {
    if (!planRunLoggerFinishResultStillCurrent(pkg)) return;
    planRunLoggerFinishSetState(Object.assign({}, planRunLoggerFinishState, { checking: false }));
  });
}

// Stops THIS session tracking an uncertain (or definitively rejected)
// attempt. Never deletes, edits, or checks anything already persisted, and
// never discards currentWorkout itself -- the person's logged data stays on
// screen; they may edit further and Finish again (a fresh attempt, fresh
// operationId, same workoutId -- fsPlanRunFinish's own already-accepted
// collision handling resolves that safely regardless of whether the
// abandoned attempt secretly did commit).
function planRunLoggerFinishAbandon() {
  var st = planRunLoggerFinishState;
  if (!st || (st.phase !== 'uncertain' && st.phase !== 'conflict' && st.phase !== 'notEligible' && st.phase !== 'budgetExceeded' && st.phase !== 'error' && st.phase !== 'competing' && st.phase !== 'alreadyCommittedUnverified')) return;
  planRunLoggerFinishState = null;
  planRunLoggerFinishCurrentOperationId = null;
  planRunLoggerFinishRender();
}

// Real auth-change boundary (app-core.js's onAuthStateChanged calls this
// synchronously, alongside planRunUiResetForOwner/planRunStartClose, before
// any new owner's content can display).
//
// LIFECYCLE-SAFETY CORRECTION, issue 1 -- previously this only discarded
// THIS file's own pending Finish-attempt tracking, leaving a Run-linked
// currentWorkout (and whatever the previous owner had already logged into
// it) sitting in memory afterward. Sign-out, a direct A->B switch, and
// A->B->A could all leave that PREVIOUS owner's in-progress canonical
// Session -- including a workout with a still-pending or uncertain Finish
// attempt -- displayed and finishable by a NEWLY signed-in owner (B, or A
// again on the A->B->A path). A Run-linked currentWorkout (canonicalRun
// truthy) is now discarded here too, exactly like planRunUiResetForOwner/
// planRunStartClose already discard their own owner-scoped state on this
// same boundary; a pending/uncertain attempt's own late response is
// independently guarded by planRunLoggerFinishResultStillCurrent (its
// currentWorkout.id check alone already fails once currentWorkout is
// nulled here). An ordinary LEGACY currentWorkout (no canonicalRun) is
// left completely untouched -- this correction does not silently change
// that already-existing, out-of-scope behavior, which this slice has no
// more license to alter than it did before.
function planRunLoggerFinishResetForAuthChange() {
  var discardingRun = !!(currentWorkout && currentWorkout.canonicalRun);
  planRunLoggerFinishState = null;
  planRunLoggerFinishCurrentOperationId = null;
  if (discardingRun) {
    stopWorkoutTimer();
    currentWorkout = null;
    var exContainer = (typeof document !== 'undefined') ? document.getElementById('workout-exercises') : null;
    if (exContainer) exContainer.innerHTML = '';
  }
  planRunLoggerFinishRender();
}

function planRunLoggerFinishSetState(next) {
  planRunLoggerFinishState = next;
  planRunLoggerFinishRender();
}

// ---- Rendering ----------------------------------------------------------
function planRunLoggerFinishOutcomeMessage(phase, st) {
  if (phase === 'notEligible') return 'This Session doesn’t yet have enough recorded evidence to complete. Check that your prescribed sets are marked complete with the required reps/time.';
  if (phase === 'budgetExceeded') return 'This Session is too large to finish in one operation.';
  if (phase === 'conflict') return 'We found a conflict with this Run’s saved data and blocked this Finish. Nothing was saved.';
  if (phase === 'competing') return 'This Session was already resolved by another attempt (e.g. another open tab). Nothing further was saved by this one.';
  if (phase === 'error') return 'This Session couldn’t be prepared to finish right now.';
  return 'Nothing was saved.';
}

function planRunLoggerFinishRender() {
  var container = planRunLoggerFinishContainer();
  var finishBtn = document.getElementById('log-finish-btn');
  if (!container) return;
  planRunLoggerFinishWireEvents(container);
  var st = planRunLoggerFinishState;
  if (!currentWorkout || !currentWorkout.canonicalRun || !st) {
    container.innerHTML = '';
    if (finishBtn) finishBtn.disabled = false;
    return;
  }
  var html = '';
  if (st.phase === 'pending') {
    html = '<div data-testid="finish-pending" style="padding:8px;border-radius:6px;background:#eef;color:#046;margin-top:8px">Saving…</div>';
    if (finishBtn) finishBtn.disabled = true;
  } else if (st.phase === 'uncertain') {
    html = '<div data-testid="finish-uncertain" style="padding:8px;border-radius:6px;background:#ffe;color:#740;margin-top:8px">We couldn’t confirm whether this Session was saved. Nothing is shown as saved until we know for sure.'
      + (st.lastCheck && st.lastCheck !== 'confirmedAbsent' ? ' (Last check: ' + escapeHtml(st.lastCheck) + '.)' : '') + '</div>';
    html += '<div style="margin-top:6px">'
      + '<button type="button" class="btn-primary" data-testid="finish-retry-btn" data-planrun-finish-action="retry" ' + (st.checking ? 'disabled' : '') + '>Retry</button> '
      + '<button type="button" class="btn-secondary" data-testid="finish-check-status-btn" data-planrun-finish-action="check-status" ' + (st.checking ? 'disabled' : '') + '>Check Status</button> '
      + '<button type="button" class="btn-secondary" data-testid="finish-abandon-btn" data-planrun-finish-action="abandon" ' + (st.checking ? 'disabled' : '') + '>Abandon</button>'
      + '</div>';
    if (finishBtn) finishBtn.disabled = true;
  } else if (st.phase === 'notEligible' || st.phase === 'budgetExceeded' || st.phase === 'conflict' || st.phase === 'competing' || st.phase === 'error') {
    html = '<div data-testid="finish-rejected" style="padding:8px;border-radius:6px;background:#fee;color:#900;margin-top:8px">' + escapeHtml(planRunLoggerFinishOutcomeMessage(st.phase, st)) + '</div>';
    html += '<div style="margin-top:6px"><button type="button" class="btn-secondary" data-testid="finish-abandon-btn" data-planrun-finish-action="abandon">Dismiss</button></div>';
    if (finishBtn) finishBtn.disabled = false;
  } else if (st.phase === 'alreadyCommittedUnverified') {
    // LIFECYCLE-SAFETY CORRECTION, ROUND 2, issue 5 -- distinct from the
    // generic 'finish-rejected' phases above on purpose: nothing was
    // rejected here (the occurrence really is completed), and this is NOT
    // shown as success either. A separate testid so this exact honest state
    // is independently verifiable.
    html = '<div data-testid="finish-already-committed-unverified" style="padding:8px;border-radius:6px;background:#fee;color:#900;margin-top:8px">This Session was already marked complete by an earlier attempt. We can’t confirm your current edits on this screen match what was actually saved, so nothing further was saved just now.</div>';
    html += '<div style="margin-top:6px"><button type="button" class="btn-secondary" data-testid="finish-abandon-btn" data-planrun-finish-action="abandon">Dismiss</button></div>';
    if (finishBtn) finishBtn.disabled = false;
  } else if (st.phase === 'disabled') {
    html = '<div data-testid="finish-disabled" style="padding:8px;border-radius:6px;background:#eee;margin-top:8px">Finishing this Session is currently disabled.</div>';
    if (finishBtn) finishBtn.disabled = true;
  } else {
    container.innerHTML = '';
    if (finishBtn) finishBtn.disabled = false;
    return;
  }
  container.innerHTML = html;
}

// -----------------------------------------------------------------------------
// Guarded Node-only export seam (mirrors app-plan-run-start-ui.js's own
// convention) -- exposes ONLY the pure, zero-I/O functions above.
// -----------------------------------------------------------------------------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    planRunLoggerCoerceNumOrNull: planRunLoggerCoerceNumOrNull,
    planRunLoggerCoerceBool: planRunLoggerCoerceBool,
    planRunLoggerBuildPersistedSet: planRunLoggerBuildPersistedSet,
    planRunLoggerBuildWorkoutDoc: planRunLoggerBuildWorkoutDoc
  };
}
