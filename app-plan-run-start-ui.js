// =============================================================================
// app-plan-run-start-ui.js -- Program Run "Start" slice (this round). The
// PLAN-library action that Slice 1/2's own header comments named as
// deliberately deferred: "Starting a Run at all is a PLAN-library action...
// it depends on a per-Rule progression-value confirmation step that is its
// own open design question." This file IS that answer.
//
// STATUS / NON-AUTHORIZATION NOTICE: submitted for INDEPENDENT REVIEW ONLY.
// CANONICAL_PLAN_RUN_CAPABILITY_ENABLED (firebase-plan-run.js) remains
// hardcoded false -- every real persistence call this file makes begins with
// that file's own disabledGate() and therefore issues zero Firestore I/O in
// production today. This file never calls, and never wires a control to,
// fsPlanRunFinish / fsPlanRunPreflightFinish / fsPlanRunCheckFinishStatus /
// fsPlanRunEnd / fsPlanRunPreflightEnd / fsPlanRunCheckEndStatus, any
// progression-EVALUATION function, any workout-history function, or the
// legacy `planStartOnTrain`/`programs`-collection path. It never calls
// fsPlanProgressionSetManualState -- it only READS the existing Template-
// level progression value (fsPlanProgressionReadState) to show as a
// suggestion; confirming or editing that suggestion in this flow writes
// nothing back to the Template's own `planProgressionState` collection, it
// only feeds this NEW Run's own `progressionInitialValues` (a completely
// separate, Run-scoped record -- plan-run-model.js's PLAN_RUN_STATE_KEYS).
//
// SCOPE THIS ROUND:
//   1. A discoverable "Start on Train" action on the canonical PLAN Program
//      library card (wired from app-plan.js's planCanonicalLibraryRender).
//   2. A verified read of the selected canonical Template
//      (ctx.readCanonicalTemplate -- the SAME real, only-reachable public
//      reader path planCanonicalLibraryHandleOpen/planReopenCanonicalTemplate
//      already use), from which a Round-8 Start package is built.
//   3. For every ENABLED progression Rule found in that read, a confirmation
//      row: the existing Template-level value (if one exists AND verifiably
//      belongs to the same Rule+assignment identity) is shown as a
//      SUGGESTION only -- never copied into the Run's progressionInitialValues
//      automatically. The person must explicitly click "Use suggested value"
//      (-> initializationSource 'confirmedFromSuggestion') or type a value
//      themselves (-> initializationSource 'manual'). A Rule with no valid
//      suggestion requires EITHER a typed value OR an explicit "Leave
//      blank" choice (-> initializationSource 'deferred', ROUND 6
//      CORRECTION below) before it counts as confirmed; none is ever
//      invented.
//   4. "Start Program" is disabled until every enabled Rule's row is
//      confirmed with a finite Amount and a Unit. Submitting reuses the
//      EXISTING, already-accepted fsPlanRunPreflightStart/fsPlanRunStart/
//      fsPlanRunCheckStartStatus contracts and the existing active-slot
//      lock -- no new persistence function was added for Start itself.
//   5. Outcome handling: committed/alreadyCommitted navigate to TRAIN (and
//      re-trigger the EXISTING, already-tested Slice 1 discovery fetch --
//      app-plan-run-ui.js's planRunUiFetchFirstPage -- so "success" is
//      confirmed by a fresh read, never merely by the transaction's own
//      return value); alreadyRunning shows "Go to Active Run" (never framed
//      as an error); integrityConflict/budgetExceeded are conclusively-
//      resolved zero-write rejections with no blind retry of the same
//      package; a thrown/rejected persistence call is the "uncertain" state
//      with Retry (resubmits the SAME stored package/operationId) and Check
//      Status (fsPlanRunCheckStartStatus, read-only) controls, plus an
//      Abandon control that only stops THIS session tracking the attempt --
//      it never deletes or falsifies anything already persisted.
//
// OPTIONAL PROGRESSION STARTING VALUES ROUND 6 CORRECTION (independent-
// review Finding 1): before this correction, every row still required a
// typed, finite Amount -- `planRunStartAllRowsReady`/`planRunStartSubmit`
// rejected a blank value outright, even though the persistence and model
// layers (plan-run-model.js's `planRunValidateStartPackage`,
// firebase-plan-run.js's `fsPlanRunStart`) had already accepted a paired-
// null `{amount:null, unit:null, initializationSource:'deferred'}` entry
// since Round 6 itself. This left the accepted product requirement
// ("Start accepts blank values") unreachable from the real UI. Fixed by
// adding an explicit, per-row "Leave blank" choice
// (`row.deferred`/`planRunStartHandleLeaveBlankToggle`, further down):
// checking it marks that one row confirmed with the exact paired-null
// shape the package already requires, UNCHECKING it returns the row to
// needing a typed value or the suggestion, exactly like any other not-yet-
// confirmed row. A row is NEVER treated as blank merely because its Amount
// field happens to be empty -- only this explicit toggle produces a
// paired-null package entry, so a genuinely incomplete row (e.g. a typed
// Amount with no Unit, not reachable through this file's own controls but
// defended against anyway) is never silently reinterpreted as a deliberate
// blank. See `planRunStartAllRowsReady`/`planRunStartSubmit` below for the
// corresponding readiness/package-construction changes.
//
// DELIBERATE SIMPLIFICATIONS THIS ROUND (see the implementation report for
// the full rationale):
//   - No advisory pre-transaction "is a Run already active" read. The spec
//     (round1 §1.3 item 3, §1.4) describes this ONLY as a UI convenience that
//     "can be stale, and is not trusted for correctness" -- the authoritative
//     check inside the real fsPlanRunStart transaction is what actually
//     prevents a second active Run, and this file relies on it exclusively.
//     A Start attempt against an already-active Run is discovered from the
//     transaction's own 'alreadyRunning' outcome, not pre-empted.
//   - No durable, reload-surviving recovery marker (the canonical editor's
//     own planCanonicalEditorWriteRecoveryMarker precedent). Retry/Check
//     Status work from the in-memory pending package for the lifetime of
//     this browser tab/session, matching this file's own in-memory-only
//     posture elsewhere (app-plan-run-ui.js: "a reload always starts
//     fresh"). A reload while a Start is genuinely uncertain loses this
//     session's own Retry/Check-Status controls, but loses nothing
//     persisted -- the person can simply try Start again from the library;
//     the authoritative alreadyCommitted/alreadyRunning checks inside the
//     real transaction make a fresh attempt safe either way.
//   - The "Start on Train" button is rendered unconditionally on every
//     library card (no per-card eligibility pre-check against a lightweight
//     list projection that does not carry a Sessions count). Eligibility
//     (>=1 runnable Session) is determined from the same verified read this
//     flow already performs when the button is clicked -- a Template with
//     none shows a clear, non-alarming "nothing to start" message, zero
//     writes, rather than being hidden from a summary list that cannot
//     cheaply know this without an extra read per card.
//   - Only the library-card location is wired this round (the spec's own
//     round1 §1.2 second location, a Start action on the OPENED Program's
//     own editor screen, is not added -- the library card alone already
//     satisfies "a discoverable Start action... to the canonical PLAN
//     Program library").
// =============================================================================

// -----------------------------------------------------------------------------
// PURE FUNCTIONS (zero I/O) -- Node-`require()`-testable without any DOM.
// These are the only functions this file exports via the guarded Node seam
// at the tail; every other function below needs `document`/`window`/`auth`
// and is exercised only through a real (jsdom) browser realm, matching this
// codebase's own existing Tier 1 (pure)/Tier 4 (jsdom) split.
// -----------------------------------------------------------------------------

// The same 17-key PLAN_RUN_PRESCRIBED_KEYS shape plan-run-model.js declares
// (kept as a literal here, not imported, for the same reason
// plan-run-integration.test.js's own harness glue restates it: this file
// lives outside that module and reads a real canonical Set's raw
// semantic-payload fields -- app-plan.js's own planSetRevision key list,
// app-plan.js:6434 -- down to exactly the narrower shape
// planRunOrderedSetValid requires).
var PLAN_RUN_START_PRESCRIBED_STRING_KEYS = ['loadType', 'repsType', 'effortType', 'timeType'];
var PLAN_RUN_START_PRESCRIBED_NUMERIC_OR_NULL_KEYS = ['weight', 'percent', 'addedWeight', 'reps', 'minReps', 'maxReps', 'rir', 'minRir', 'maxRir', 'seconds', 'minSeconds', 'maxSeconds'];

function planRunStartPickPrescribed(setEntry) {
  var out = {};
  PLAN_RUN_START_PRESCRIBED_STRING_KEYS.forEach(function (k) { out[k] = (typeof setEntry[k] === 'string') ? setEntry[k] : ''; });
  PLAN_RUN_START_PRESCRIBED_NUMERIC_OR_NULL_KEYS.forEach(function (k) { out[k] = (typeof setEntry[k] === 'number' && isFinite(setEntry[k])) ? setEntry[k] : null; });
  out.notes = (typeof setEntry.notes === 'string') ? setEntry.notes : null;
  return out;
}

// Filters a profileView down to exactly the runnable shape Program Run
// requires (spec round1 §1.3 item 2: "at least one Microcycle with at least
// one Session with at least one Exercise Assignment with at least one Set"),
// preserving relative order. An assignment with zero sets, or a session left
// with zero assignments after that filter, is dropped entirely -- never
// included with an empty orderedSets/assignments array, which
// planRunAssignmentsRulesStructureValid/planRunValidateStartPackage would
// both reject as malformed.
function planRunStartFilterRunnableStructure(profileView) {
  var microcycles = [];
  (profileView.microcycles || []).forEach(function (mc) {
    var sessions = [];
    (mc.sessions || []).forEach(function (sess) {
      var assignments = (sess.assignments || []).filter(function (a) { return Array.isArray(a.sets) && a.sets.length > 0; });
      if (assignments.length > 0) sessions.push({ microcycleId: mc.microcycleId, name: mc.name, sessionId: sess.sessionId, sessionName: sess.name, assignments: assignments });
    });
    if (sessions.length > 0) microcycles.push({ microcycleId: mc.microcycleId, name: mc.name, sessions: sessions });
  });
  return microcycles;
}

// spec round1 §1.3 item 2's eligibility count, from the SAME filtered
// structure Start itself will actually use (never a separate, potentially
// inconsistent count).
function planRunStartCountRunnableSessions(profileView) {
  var runnable = planRunStartFilterRunnableStructure(profileView);
  var n = 0;
  runnable.forEach(function (mc) { n += mc.sessions.length; });
  return n;
}

// Flat, stable-ordered list of every ENABLED progression Rule in the
// Template, one entry per Rule, with exactly the identity fields this file's
// suggestion-lookup and package-building both need. `kind` mirrors the
// established addLoad->workingLoad / increaseTM->trainingMax mapping
// (app-plan.js:13421's own planProgressionManualSave, and
// firebase-plan-progression.js:110's own identity check) -- restated here,
// not re-derived differently.
function planRunStartEnumerateEnabledRules(profileView) {
  var out = [];
  var runnable = planRunStartFilterRunnableStructure(profileView);
  runnable.forEach(function (mc) {
    mc.sessions.forEach(function (sess) {
      sess.assignments.forEach(function (a) {
        (a.rules || []).forEach(function (r) {
          if (r.enabled !== true) return;
          out.push({
            planRuleId: r.ruleSubjectId, planAssignmentId: a.assignmentSubjectId, ruleRevisionId: r.ruleRevisionId,
            exerciseId: a.exerciseId, adjustmentType: r.adjustmentType,
            kind: r.adjustmentType === 'addLoad' ? 'workingLoad' : 'trainingMax'
          });
        });
      });
    });
  });
  return out;
}

// The exact cross-check the user's own instruction required before an
// existing Template-level progression value may ever be OFFERED as a
// suggestion: the stored state must agree with the CURRENT Rule's own
// Template/assignment/exercise identity, not merely exist at the right
// document path (fsPlanProgressionReadState's own statePathIdentityOk only
// checks ownerUid+planRuleId -- it does NOT check planTemplateId/
// planAssignmentId/exerciseId agreement against what THIS Start flow is
// about, which is exactly the gap this function closes, entirely client-
// side and read-only, never by editing that persistence file). A `false`
// result means "no valid suggestion" -- the caller must require a typed
// value, never invent one.
function planRunStartTemplateLevelSuggestionIsValid(state, planTemplateId, rule) {
  if (!state || typeof state !== 'object') return false;
  return state.planTemplateId === planTemplateId && state.planAssignmentId === rule.planAssignmentId &&
    state.exerciseId === rule.exerciseId && state.planRuleId === rule.planRuleId;
}

// Builds a complete Round-8 Start package from a genuinely verified profile
// read (the same {verificationReceipt, profileView} shape
// canonicalBase.{verificationReceipt,profileView} already carries) and the
// caller's own already-confirmed progressionInitialValues -- this function
// invents no progression value itself; it only shapes whatever array it is
// given. Pure: no I/O, no reference to `document`/`window`/`auth`, safe to
// call from a plain Node `require()` provided `hashDeps` is supplied
// explicitly (a plain Node `require()` of this file is a separate module
// scope from plan-run-model.js's own `planRunBuildOccurrenceId`, which is
// only a bare global in the real shared-script-tag browser realm this file
// actually runs in -- the optional 5th parameter here mirrors plan-run-
// model.js's own planRunBuildOccurrenceId(..., hashDeps) convention exactly,
// so production callers below pass nothing and get the real bare-global
// lookup, while a Node test can pass { sha256Hex, buildCanonicalEncoding }
// explicitly).
function planRunStartBuildPackage(profile, planRunId, operationId, progressionInitialValues, hashDeps) {
  var receipt = profile.verificationReceipt;
  var pv = profile.profileView;
  var runnable = planRunStartFilterRunnableStructure(pv);
  var occurrences = [];
  runnable.forEach(function (mc, mcOrd) {
    mc.sessions.forEach(function (sess, sOrd) {
      var occurrenceId = planRunBuildOccurrenceId(planRunId, sess.microcycleId, sess.sessionId, hashDeps);
      var assignments = sess.assignments.map(function (a) {
        var rules = (a.rules || []).map(function (r) {
          return {
            planRuleId: r.ruleSubjectId, ruleRevisionId: r.ruleRevisionId, adjustmentType: r.adjustmentType,
            evaluationType: r.evaluationType, failBehavior: r.failBehavior, gatewaySetIndex: r.gatewaySetIndex,
            loadIncrease: r.loadIncrease, tmIncrease: r.tmIncrease, enabled: r.enabled
          };
        });
        return {
          planAssignmentId: a.assignmentSubjectId, planPrescriptionId: a.prescriptionSubjectId, exerciseId: a.exerciseId,
          rules: rules, orderedSets: a.sets.map(function (s) { return { planSetId: s.setSubjectId, prescribed: planRunStartPickPrescribed(s) }; })
        };
      });
      occurrences.push({
        occurrenceId: occurrenceId, planMicrocycleId: sess.microcycleId, planSessionId: sess.sessionId,
        microcycleOrdinal: mcOrd, sessionOrdinal: sOrd,
        nameSnapshot: { microcycleName: mc.name, sessionName: sess.sessionName },
        assignments: assignments
      });
    });
  });
  return {
    operationId: operationId, ownerUid: receipt.ownerUid, planTemplateId: receipt.templateId, planRunId: planRunId,
    headRevisionId: receipt.headRevisionId, manifestId: receipt.manifestId, graphHash: receipt.graphHash,
    nameSnapshot: (typeof pv.name === 'string' && pv.name) ? pv.name : '(untitled Program)',
    occurrences: occurrences, progressionInitialValues: progressionInitialValues
  };
}

// -----------------------------------------------------------------------------
// DOM / UI layer -- everything below needs a real browser (or jsdom) realm.
// -----------------------------------------------------------------------------

function planRunStartCapabilityEnabled() {
  if (typeof window !== 'undefined' && window.__PLAN_RUN_TEST_OVERRIDE_ENABLED__ === true) return true;
  return typeof window !== 'undefined' && window.CANONICAL_PLAN_RUN_CAPABILITY_ENABLED === true;
}
function planRunStartCurrentUid() {
  return (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.uid) || null;
}

// Production ctx -- the SAME real reader (fsPlanReadCanonicalTemplate) and
// the SAME real Run-persistence/progression-persistence surfaces every
// other production ctx in this codebase already wires to; a Node-only test
// passes its own ctxOverride, driving these IDENTICAL production handler
// functions below.
function planRunStartBuildProductionCtx() {
  var uid = (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.uid) || null;
  return {
    ownerUid: uid,
    readCanonicalTemplate: function (input) { return fsPlanPersistence.fsPlanReadCanonicalTemplate(input); },
    initProgressionReferences: function (input) { return fsPlanProgressionPersistence.fsPlanProgressionInitReferences(input); },
    readProgressionState: function (planRuleId) { return fsPlanProgressionPersistence.fsPlanProgressionReadState(planRuleId); },
    runPreflightStart: function (pkg) { return fsPlanRunPersistence.fsPlanRunPreflightStart(pkg); },
    runStart: function (pkg) { return fsPlanRunPersistence.fsPlanRunStart(pkg); },
    runCheckStartStatus: function (input) { return fsPlanRunPersistence.fsPlanRunCheckStartStatus(input); }
  };
}
function planRunStartIsProgressionDisabledError(e) {
  if (!e) return false;
  if (typeof fsPlanProgressionPersistence !== 'undefined' && fsPlanProgressionPersistence &&
    typeof fsPlanProgressionPersistence.CanonicalProgressionWriterDisabledError === 'function' &&
    e instanceof fsPlanProgressionPersistence.CanonicalProgressionWriterDisabledError) return true;
  return e.name === 'CanonicalProgressionWriterDisabledError';
}
function planRunStartIsCanonicalReadDisabledError(e) {
  return !!e && (e.name === 'CanonicalPlanReaderDisabledError' || e.code === 'CANONICAL_PLAN_READER_DISABLED');
}

// ---- In-memory state (never persisted -- a reload always starts fresh, see
// this file's own header on the deliberate absence of a durable marker). ----
var planRunStartState = null;
var planRunStartEpoch = 0; // bumped on every new attempt/close -- any async
                            // response captured against an older epoch is
                            // dropped silently, never rendered, and never
                            // used to navigate anywhere on its own.

function planRunStartIsResponseCurrent(epoch, expectedUid) {
  return planRunStartState !== null && epoch === planRunStartEpoch && planRunStartCurrentUid() === expectedUid;
}

function planRunStartContainer() {
  return (typeof document !== 'undefined') ? document.getElementById('page-run-start') : null;
}

function planRunStartHandleClick(event) {
  var btn = event.target.closest ? event.target.closest('[data-planrun-start-action]') : null;
  if (!btn) return;
  var action = btn.getAttribute('data-planrun-start-action');
  var ruleId = btn.getAttribute('data-planrun-start-rule-id');
  if (action === 'close') planRunStartClose();
  else if (action === 'use-suggestion') planRunStartHandleUseSuggestion(ruleId);
  else if (action === 'submit') planRunStartSubmit();
  else if (action === 'retry') planRunStartRetry();
  else if (action === 'check-status') planRunStartCheckStatus();
  else if (action === 'abandon') planRunStartAbandon();
  else if (action === 'go-to-active-run') planRunStartGoToActiveRun();
}
function planRunStartHandleInput(event) {
  var el = event.target;
  if (!el || !el.matches || !el.matches('[data-planrun-start-amount]')) return;
  planRunStartHandleAmountInput(el.getAttribute('data-planrun-start-rule-id'), el.value);
}
function planRunStartHandleChange(event) {
  var el = event.target;
  if (!el || !el.matches) return;
  if (el.matches('[data-planrun-start-unit]')) {
    planRunStartHandleUnitChange(el.getAttribute('data-planrun-start-rule-id'), el.value);
  } else if (el.matches('[data-planrun-start-leave-blank]')) {
    // ROUND 6 CORRECTION ADDITION.
    planRunStartHandleLeaveBlankToggle(el.getAttribute('data-planrun-start-rule-id'), !!el.checked);
  }
}
function planRunStartWireEvents(el) {
  if (!el || el.__planRunStartWired) return;
  el.addEventListener('click', planRunStartHandleClick);
  el.addEventListener('input', planRunStartHandleInput);
  el.addEventListener('change', planRunStartHandleChange);
  el.__planRunStartWired = true;
}

// ---- planRunStartOpen(templateId, ctxOverride) -- the library button's
// handler, and this file's one real entry point. -----------------------------
function planRunStartOpen(templateId, ctxOverride) {
  var ctx = (ctxOverride && typeof ctxOverride === 'object') ? ctxOverride : planRunStartBuildProductionCtx();
  var epoch = ++planRunStartEpoch;
  // Mirrors app-plan-run-ui.js's own planRunUiStartSession/
  // planRunUiOpenSessionPreview convention exactly: showPage() is called
  // synchronously, before any async work begins, so the destination page is
  // already visible (showing its own loading/disabled state) rather than
  // silently doing work behind the still-visible PLAN library screen.
  if (typeof showPage === 'function') showPage('page-run-start');
  if (!planRunStartCapabilityEnabled()) {
    // Disabled: zero I/O of any kind, a plain honest state, real controls
    // render disabled/absent -- matching every other Program Run surface's
    // own disabled posture.
    planRunStartState = { phase: 'disabled', epoch: epoch };
    planRunStartRender();
    return Promise.resolve({ outcome: 'disabled' });
  }
  if (!ctx.ownerUid) {
    planRunStartState = { phase: 'error', epoch: epoch, reason: 'noAuthenticatedUser' };
    planRunStartRender();
    return Promise.resolve({ outcome: 'error', reason: 'noAuthenticatedUser' });
  }
  var expectedUid = ctx.ownerUid;
  planRunStartState = { phase: 'loadingProfile', epoch: epoch, ctx: ctx, templateId: templateId, ownerUid: ctx.ownerUid };
  planRunStartRender();

  // Step 1: init the Template-level progression module's owner reference
  // (idempotent -- see firebase-plan-progression.js's own ready() gate).
  // A thrown disabled error here is caught and folded into a distinct
  // "suggestions unavailable" note on every row later -- it never blocks
  // Start itself, since every row still requires an explicit value/confirm
  // regardless of whether a suggestion could be fetched.
  var progressionAvailable = true;
  try {
    var initResult = ctx.initProgressionReferences({ ownerUid: ctx.ownerUid });
    if (!initResult || initResult.outcome !== 'success') progressionAvailable = false;
  } catch (e) {
    if (!planRunStartIsProgressionDisabledError(e)) throw e;
    progressionAvailable = false;
  }

  var p;
  try {
    p = ctx.readCanonicalTemplate({ ownerUid: ctx.ownerUid, templateId: templateId });
  } catch (err) {
    if (planRunStartIsCanonicalReadDisabledError(err)) {
      if (planRunStartIsResponseCurrent(epoch, expectedUid)) { planRunStartState = { phase: 'disabled', epoch: epoch }; planRunStartRender(); }
      return Promise.resolve({ outcome: 'disabled' });
    }
    if (planRunStartIsResponseCurrent(epoch, expectedUid)) { planRunStartState = { phase: 'readError', epoch: epoch, detail: null }; planRunStartRender(); }
    return Promise.resolve({ outcome: 'readError' });
  }
  return p.then(function (result) {
    if (!planRunStartIsResponseCurrent(epoch, expectedUid)) return { outcome: 'stale' }; // navigated away / superseded -- drop silently
    // STAGE 6 CORRECTION (hang fix): everything from here through the
    // 'confirmingValues' transition below used to run with no safety net.
    // A successful (`outcome: 'verifiedCurrent'`) read whose own shape later
    // turned out to be unusable -- a missing/malformed canonicalBase,
    // profileView, or rules list -- made planRunStartCountRunnableSessions/
    // planRunStartEnumerateEnabledRules/Object.assign throw SYNCHRONOUSLY
    // inside this handler. That throw rejected the promise this function
    // returns, but nothing downstream (including the real production call
    // site, index.html's own onclick="planRunStartOpen(...)") ever attaches
    // a .catch to it -- so the rejection went unhandled, planRunStartState
    // was never reassigned past 'loadingProfile', and the screen stayed on
    // "Checking this Program..." permanently, with zero error shown and zero
    // retry affordance. This is the confirmed, reproduced Stage 6 defect
    // mechanism (see the correction report's reproduction evidence).
    // Fix: wrap this entire branch in try/catch so ANY exception while
    // processing a successful read result -- not just an explicit
    // non-'verifiedCurrent' outcome -- lands on the SAME already-existing,
    // already-reviewed 'readError' terminal state the malformed-outcome
    // branch immediately below already uses. No new terminal state is
    // introduced; every currently-working path (verifiedCurrent with a
    // well-formed shape, any non-'verifiedCurrent' outcome, a rejected read)
    // is completely unchanged.
    try {
      if (!result || result.outcome !== 'verifiedCurrent') {
        planRunStartState = { phase: 'readError', epoch: epoch, detail: result || null };
        planRunStartRender();
        return { outcome: 'readError', detail: result };
      }
      var profile = { verificationReceipt: result.canonicalBase.verificationReceipt, profileView: result.canonicalBase.profileView };
      var runnableSessions = planRunStartCountRunnableSessions(profile.profileView);
      if (runnableSessions === 0) {
        planRunStartState = { phase: 'ineligible', epoch: epoch, reason: 'noRunnableSessions' };
        planRunStartRender();
        return { outcome: 'ineligible' };
      }
      var enabledRules = planRunStartEnumerateEnabledRules(profile.profileView).map(function (r) {
        return Object.assign({}, r, {
          exerciseName: planCanonicalGetExerciseName(r.exerciseId),
          suggestionState: progressionAvailable ? 'loading' : 'unavailable',
          suggestion: null, amount: '', unit: 'lb', confirmed: false, initializationSource: null, deferred: false
        });
      });
      planRunStartState = {
        phase: 'confirmingValues', epoch: epoch, ctx: ctx, templateId: templateId, ownerUid: ctx.ownerUid,
        profile: profile, rules: enabledRules, submitting: false, submitError: null
      };
      planRunStartRender();
      if (progressionAvailable) planRunStartFetchSuggestions(epoch, expectedUid);
      return { outcome: 'confirmingValues', ruleCount: enabledRules.length };
    } catch (processingErr) {
      if (!planRunStartIsResponseCurrent(epoch, expectedUid)) return { outcome: 'stale' }; // superseded while this handler itself was running
      planRunStartState = { phase: 'readError', epoch: epoch, detail: null, processingError: (processingErr && processingErr.message) || String(processingErr) };
      planRunStartRender();
      return { outcome: 'readError', detail: null, processingError: (processingErr && processingErr.message) || String(processingErr) };
    }
  }, function (err) {
    if (!planRunStartIsResponseCurrent(epoch, expectedUid)) return { outcome: 'stale' };
    if (planRunStartIsCanonicalReadDisabledError(err)) { planRunStartState = { phase: 'disabled', epoch: epoch }; planRunStartRender(); return { outcome: 'disabled' }; }
    planRunStartState = { phase: 'readError', epoch: epoch, detail: null };
    planRunStartRender();
    return { outcome: 'readError' };
  });
}

// Fetches each enabled Rule's existing Template-level suggestion in
// parallel; each row updates independently as its own response arrives
// (never blocking the others), guarded by the SAME epoch this whole attempt
// was opened under -- a stale response (attempt closed/superseded before it
// resolved) is dropped without touching any state.
function planRunStartFetchSuggestions(epoch, expectedUid) {
  var st = planRunStartState;
  if (!st || st.phase !== 'confirmingValues') return;
  st.rules.forEach(function (rule) {
    var p;
    try {
      p = st.ctx.readProgressionState(rule.planRuleId);
    } catch (e) {
      planRunStartApplySuggestionResult(epoch, expectedUid, rule.planRuleId, { outcome: 'unavailable' });
      return;
    }
    p.then(function (result) {
      planRunStartApplySuggestionResult(epoch, expectedUid, rule.planRuleId, result);
    }, function () {
      planRunStartApplySuggestionResult(epoch, expectedUid, rule.planRuleId, { outcome: 'unavailable' });
    });
  });
}
function planRunStartApplySuggestionResult(epoch, expectedUid, planRuleId, result) {
  if (!planRunStartIsResponseCurrent(epoch, expectedUid)) return;
  var st = planRunStartState;
  if (!st || st.phase !== 'confirmingValues') return;
  var row = st.rules.filter(function (r) { return r.planRuleId === planRuleId; })[0];
  if (!row) return;
  if (result && result.outcome === 'success' && planRunStartTemplateLevelSuggestionIsValid(result.state, st.templateId, row)) {
    row.suggestionState = 'available';
    row.suggestion = { amount: result.state.currentValue.amount, unit: result.state.currentValue.unit };
  } else if (result && result.outcome === 'success') {
    // A stored value exists at this Rule's own path but disagrees with the
    // CURRENT Template/assignment/exercise identity (e.g. a stale value left
    // over from a Template that has since changed underneath this Rule id).
    // Never offered as a suggestion, and never treated as a value -- the
    // person must type one.
    row.suggestionState = 'stale';
    row.suggestion = null;
  } else if (result && result.outcome === 'notInitialized') {
    row.suggestionState = 'none';
    row.suggestion = null;
  } else {
    row.suggestionState = 'unavailable';
    row.suggestion = null;
  }
  planRunStartRender();
}

function planRunStartHandleUseSuggestion(planRuleId) {
  var st = planRunStartState;
  if (!st || st.phase !== 'confirmingValues' || st.submitting) return;
  var row = st.rules.filter(function (r) { return r.planRuleId === planRuleId; })[0];
  if (!row || row.suggestionState !== 'available' || !row.suggestion) return;
  row.amount = String(row.suggestion.amount);
  row.unit = row.suggestion.unit;
  row.initializationSource = 'confirmedFromSuggestion';
  row.confirmed = true;
  row.deferred = false; // accepting a suggestion is an explicit real value -- never still "leave blank"
  planRunStartRender();
}
// USABILITY CORRECTION (independent-review finding, this round): both
// handlers below previously ended with a full planRunStartRender() -- the
// SAME full-container innerHTML rebuild every phase transition uses. A
// browser (and jsdom identically) destroys and recreates every descendant
// node on an innerHTML replacement, including whichever <input> currently
// holds focus, so every single keystroke in the real Amount field lost
// focus the instant this ran -- typing "365" left only the "3" entered
// before the field had to be reselected for "6", then again for "5". That
// is a render/state-identity defect, not a timing issue, so the fix is not
// a timing trick or a forced refocus call -- it is to stop rebuilding the
// input's own DOM subtree for this path at all. A bare keystroke or unit
// change only ever affects two small, derived things: this one row's own
// "Needs a confirmed value"/"Confirmed" indicator, and the submit button's
// disabled state -- see planRunStartUpdateRowStatusInPlace/
// planRunStartUpdateSubmitButtonInPlace below, which update exactly those
// two nodes directly and never touch the amount/unit controls themselves.
// Since the input/select nodes are never replaced, the browser has no
// reason to move focus, so continuous typing, deletion, text selection,
// paste, decimal entry, and keyboard navigation all behave normally. Every
// OTHER phase transition (submit, retry, check-status, abandon, close,
// suggestion-fetch resolving, etc.) still goes through the real, full
// planRunStartRender() exactly as before -- this change is scoped strictly
// to the per-keystroke/per-selection path, nothing else.
function planRunStartHandleAmountInput(planRuleId, raw) {
  var st = planRunStartState;
  if (!st || st.phase !== 'confirmingValues' || st.submitting) return;
  var row = st.rules.filter(function (r) { return r.planRuleId === planRuleId; })[0];
  if (!row) return;
  row.amount = raw;
  row.initializationSource = 'manual';
  row.confirmed = true;
  row.deferred = false; // typing a value is an explicit override of any prior "leave blank" choice
  planRunStartUpdateRowStatusInPlace(planRuleId);
  planRunStartUpdateSubmitButtonInPlace();
}
function planRunStartHandleUnitChange(planRuleId, unit) {
  var st = planRunStartState;
  if (!st || st.phase !== 'confirmingValues' || st.submitting) return;
  if (unit !== 'lb' && unit !== 'kg') return;
  var row = st.rules.filter(function (r) { return r.planRuleId === planRuleId; })[0];
  if (!row) return;
  row.unit = unit;
  row.initializationSource = 'manual';
  row.confirmed = true;
  row.deferred = false; // choosing a unit is an explicit override of any prior "leave blank" choice
  planRunStartUpdateRowStatusInPlace(planRuleId);
  planRunStartUpdateSubmitButtonInPlace();
}
// ROUND 6 CORRECTION ADDITION -- the explicit "Leave blank" toggle. This is
// a deliberate, separate user action, never inferred from an empty Amount
// field: checking it marks the row confirmed with the exact paired-null
// shape `planRunValidateStartPackage` requires for a deferred entry
// (amount:null, unit:null, initializationSource:'deferred'); unchecking it
// returns the row to needing a typed value or an accepted suggestion,
// exactly like any other not-yet-confirmed row (never silently restoring a
// stale typed amount as if it had been re-confirmed). A full render is
// used here (not the in-place keystroke-path update above) because this is
// a discrete checkbox toggle, not a per-keystroke event -- the existing
// disabled Amount/Unit controls this produces are never mid-typing, so
// there is no focus to preserve.
function planRunStartHandleLeaveBlankToggle(planRuleId, checked) {
  var st = planRunStartState;
  if (!st || st.phase !== 'confirmingValues' || st.submitting) return;
  var row = st.rules.filter(function (r) { return r.planRuleId === planRuleId; })[0];
  if (!row) return;
  if (checked) {
    row.deferred = true;
    row.confirmed = true;
    row.initializationSource = 'deferred';
  } else {
    row.deferred = false;
    row.confirmed = false;
    row.initializationSource = null;
  }
  planRunStartRender();
}
// Finds one rule row's own rendered container without any selector-string
// interpolation of planRuleId (defensive: even though planRunIsId already
// constrains the real shape, this avoids ever building a CSS attribute
// selector out of untrusted/variable text).
function planRunStartFindRuleRowEl(container, planRuleId) {
  if (!container || !container.querySelectorAll) return null;
  var rows = container.querySelectorAll('[data-testid="start-rule-row"]');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].getAttribute('data-planrun-start-rule-id') === planRuleId) return rows[i];
  }
  return null;
}
// In-place update of one row's own status indicator -- same two possible
// strings/colors planRunStartRenderRuleRow already renders, just applied to
// the existing node instead of rebuilding it. Never touches the row's own
// amount <input> or unit <select>.
function planRunStartUpdateRowStatusInPlace(planRuleId) {
  var st = planRunStartState;
  if (!st || st.phase !== 'confirmingValues') return;
  var row = st.rules.filter(function (r) { return r.planRuleId === planRuleId; })[0];
  if (!row) return;
  var rowEl = planRunStartFindRuleRowEl(planRunStartContainer(), planRuleId);
  if (!rowEl || !rowEl.querySelector) return;
  var statusEl = rowEl.querySelector('[data-testid="start-rule-needs-action"],[data-testid="start-rule-confirmed"]');
  if (!statusEl) return;
  var needsAction = !(row.deferred || (row.confirmed && row.amount !== '' && isFinite(Number(row.amount))));
  statusEl.setAttribute('data-testid', needsAction ? 'start-rule-needs-action' : 'start-rule-confirmed');
  statusEl.style.color = needsAction ? '#b00' : '#080';
  statusEl.textContent = needsAction ? 'Needs a confirmed value' : (row.deferred ? 'Will be set later' : 'Confirmed');
}
// In-place update of the submit button's disabled state only -- same
// planRunStartAllRowsReady gate planRunStartRender already applies, just
// applied directly to the existing button node.
function planRunStartUpdateSubmitButtonInPlace() {
  var st = planRunStartState;
  if (!st || st.phase !== 'confirmingValues') return;
  var container = planRunStartContainer();
  if (!container || !container.querySelector) return;
  var btn = container.querySelector('[data-testid="start-submit-btn"]');
  if (!btn) return;
  btn.disabled = !planRunStartAllRowsReady(st.rules) || st.submitting;
}

// Every enabled Rule's row must be explicitly confirmed with EITHER a finite
// Amount and a legal Unit, OR the explicit "Leave blank" choice (ROUND 6
// CORRECTION), before Start is allowed -- the one gate this entire flow
// exists to enforce. A row is never considered confirmed merely because a
// suggestion happened to be displayed, and a row is never treated as
// deliberately blank merely because its Amount field happens to be empty --
// `row.deferred` is set ONLY by the explicit toggle
// (planRunStartHandleLeaveBlankToggle), never inferred here.
function planRunStartAllRowsReady(rules) {
  return rules.every(function (r) {
    if (r.deferred) return true;
    return r.confirmed && r.amount !== '' && isFinite(Number(r.amount)) && (r.unit === 'lb' || r.unit === 'kg');
  });
}

function planRunStartSubmit() {
  var st = planRunStartState;
  if (!st || st.phase !== 'confirmingValues' || st.submitting) return;
  if (!planRunStartAllRowsReady(st.rules)) { st.submitError = 'incomplete'; planRunStartRender(); return; }
  st.submitting = true;
  st.submitError = null;
  planRunStartRender();
  // ROUND 6 CORRECTION -- a deferred row emits the exact paired-null shape
  // `planRunValidateStartPackage` requires (amount:null, unit:null,
  // initializationSource:'deferred'), never `''`/`NaN`/a stale suggestion/
  // an invented default. A non-deferred row is unchanged from before this
  // correction. Key order matches PLAN_RUN_PROGRESSION_INITIAL_KEYS
  // (plan-run-model.js) in both branches.
  var progressionInitialValues = st.rules.map(function (r) {
    return r.deferred
      ? { planRuleId: r.planRuleId, planAssignmentId: r.planAssignmentId, ruleRevisionId: r.ruleRevisionId, exerciseId: r.exerciseId, kind: r.kind, amount: null, unit: null, initializationSource: 'deferred' }
      : { planRuleId: r.planRuleId, planAssignmentId: r.planAssignmentId, ruleRevisionId: r.ruleRevisionId, exerciseId: r.exerciseId, kind: r.kind, amount: Number(r.amount), unit: r.unit, initializationSource: r.initializationSource };
  });
  var planRunId = uid();
  var operationId = uid();
  var pkg = planRunStartBuildPackage(st.profile, planRunId, operationId, progressionInitialValues);
  var epoch = st.epoch, expectedUid = st.ownerUid, ctx = st.ctx;
  var pre;
  try {
    pre = ctx.runPreflightStart(pkg);
  } catch (e) {
    planRunStartEnterUncertain(st, pkg, planRunId, operationId, epoch, expectedUid);
    return;
  }
  Promise.resolve(pre).then(function (preflight) {
    if (!planRunStartIsResponseCurrent(epoch, expectedUid)) return;
    if (!preflight || !preflight.ok) {
      st.submitting = false;
      st.phase = 'rejected';
      st.rejection = { outcome: 'invalidInput', reasons: (preflight && preflight.reasons) || [] };
      planRunStartRender();
      return;
    }
    planRunStartAttempt(st, pkg, planRunId, operationId, epoch, expectedUid);
  });
}

function planRunStartAttempt(st, pkg, planRunId, operationId, epoch, expectedUid) {
  var p;
  try {
    p = st.ctx.runStart(pkg);
  } catch (e) {
    planRunStartEnterUncertain(st, pkg, planRunId, operationId, epoch, expectedUid);
    return;
  }
  p.then(function (result) {
    planRunStartApplyStartOutcome(st, pkg, planRunId, operationId, epoch, expectedUid, result);
  }, function () {
    planRunStartEnterUncertain(st, pkg, planRunId, operationId, epoch, expectedUid);
  });
}

function planRunStartApplyStartOutcome(st, pkg, planRunId, operationId, epoch, expectedUid, result) {
  if (!planRunStartIsResponseCurrent(epoch, expectedUid)) return; // navigated away / superseded -- never claim success onto a screen the person already left
  if (result && (result.outcome === 'committed' || result.outcome === 'alreadyCommitted')) {
    planRunStartClose();
    planRunStartGoToTrainAndRefresh();
    return;
  }
  if (result && result.outcome === 'alreadyRunning') {
    st.submitting = false;
    st.phase = 'alreadyRunning';
    st.activeRunId = result.runId || null;
    planRunStartRender();
    return;
  }
  if (result && (result.outcome === 'integrityConflict' || result.outcome === 'budgetExceeded')) {
    // Conclusively-resolved zero-write rejections -- never re-offered a
    // blind "Retry" that would resubmit the identical, still-rejected
    // package.
    st.submitting = false;
    st.phase = 'rejected';
    st.rejection = result;
    planRunStartRender();
    return;
  }
  // Any other/malformed shape from the persistence layer is treated exactly
  // like a thrown failure -- uncertain, never a false success.
  planRunStartEnterUncertain(st, pkg, planRunId, operationId, epoch, expectedUid);
}

function planRunStartEnterUncertain(st, pkg, planRunId, operationId, epoch, expectedUid) {
  if (!planRunStartIsResponseCurrent(epoch, expectedUid)) return;
  st.submitting = false;
  st.phase = 'uncertain';
  st.pending = { pkg: pkg, planRunId: planRunId, operationId: operationId };
  planRunStartRender();
}

function planRunStartRetry() {
  var st = planRunStartState;
  if (!st || st.phase !== 'uncertain' || !st.pending || st.submitting) return;
  st.submitting = true;
  planRunStartRender();
  planRunStartAttempt(st, st.pending.pkg, st.pending.planRunId, st.pending.operationId, st.epoch, st.ownerUid);
}

function planRunStartCheckStatus() {
  var st = planRunStartState;
  if (!st || st.phase !== 'uncertain' || !st.pending || st.submitting) return;
  st.submitting = true;
  planRunStartRender();
  var epoch = st.epoch, expectedUid = st.ownerUid, pending = st.pending;
  var p;
  try {
    p = st.ctx.runCheckStartStatus({ ownerUid: st.ownerUid, planRunId: pending.planRunId, planTemplateId: st.templateId, operationId: pending.operationId });
  } catch (e) {
    if (!planRunStartIsResponseCurrent(epoch, expectedUid)) return;
    st.submitting = false;
    planRunStartRender();
    return;
  }
  p.then(function (result) {
    if (!planRunStartIsResponseCurrent(epoch, expectedUid)) return;
    if (result && result.outcome === 'committed') { planRunStartClose(); planRunStartGoToTrainAndRefresh(); return; }
    if (result && result.outcome === 'confirmedAbsent') {
      // The Start never actually happened -- the SAME pending package/
      // operationId is still safe to Retry (nothing was committed under it).
      st.submitting = false;
      planRunStartRender();
      return;
    }
    // competingOperation/integrityConflict/anything else -- stay uncertain,
    // report the check's own result honestly, still offering Retry/Check
    // Status/Abandon.
    st.submitting = false;
    st.lastCheckResult = result;
    planRunStartRender();
  }, function () {
    if (!planRunStartIsResponseCurrent(epoch, expectedUid)) return;
    st.submitting = false;
    planRunStartRender();
  });
}

// Stops THIS session tracking an uncertain attempt. Never deletes, edits, or
// checks anything already persisted -- if the Start genuinely committed, the
// next real visit to TRAIN (fsPlanRunListActiveRuns) shows it regardless of
// whether this screen ever learns that.
function planRunStartAbandon() {
  var st = planRunStartState;
  if (!st || st.phase !== 'uncertain') return;
  planRunStartClose();
}

function planRunStartGoToActiveRun() {
  planRunStartClose();
  planRunStartGoToTrainAndRefresh();
}

// Navigates to TRAIN, so "success" is confirmed by TRAIN's own fresh read,
// never merely claimed from this screen. The real, already-accepted
// showPage('page-home') ALREADY re-triggers the EXISTING Slice 1 discovery
// fetch on its own (app-core.js's real showPage calls the real renderHome(),
// which calls the real planRunUiRenderHomeSection(), which itself calls the
// real planRunUiFetchFirstPage() whenever the capability is on) -- calling
// planRunUiFetchFirstPage() again here explicitly would issue a redundant
// second fetch for the exact same navigation, which an early version of
// this function did before this was caught by this slice's own Tier 4
// suite. showPage alone is both the navigation AND the refresh.
function planRunStartGoToTrainAndRefresh() {
  if (typeof showPage === 'function') showPage('page-home');
}

// Closing always bumps the epoch FIRST -- any response for the just-closed
// attempt that resolves later is therefore guaranteed stale and is dropped
// by every handler above without ever touching the DOM or navigating
// anywhere. Idempotent and safe to call when no attempt is open at all
// (planRunStartState is already null): it then just bumps the epoch again
// and clears an already-empty container.
//
// INDEPENDENT-REVIEW CORRECTION (auth + navigation boundaries): this
// function now has THREE real callers, not one --
//   1. The Start screen's own Cancel/Back control (data-planrun-start-
//      action="close"), and the successful Start -> TRAIN handoff
//      (planRunStartApplyStartOutcome, planRunStartGoToActiveRun) -- the
//      original, always-existing uses.
//   2. app-core.js's real `auth.onAuthStateChanged` handler, called
//      synchronously on every sign-in, sign-out, and account switch,
//      BEFORE the app can display another owner's content -- the Start
//      screen holds owner-scoped Program details and progression
//      suggestions in planRunStartState, and nothing previously reset that
//      on an auth transition (the same class of gap app-plan-run-ui.js's
//      own planRunUiResetForOwner was independently added to close for
//      that sibling surface).
//   3. app-core.js's real `showPage(id)`, whenever `id` is anything other
//      than 'page-run-start' -- ordinary PLAN/TRAIN/Library navigation
//      away from an open Start screen previously left its pending reads
//      and Start/status responses live: a late `fsPlanRunStart` response
//      that finally resolved 'committed' after the person had already
//      navigated elsewhere could still redirect them back to TRAIN or
//      render a success message on a screen they had already left.
// No new function was added for either correction -- this one already did
// exactly what both boundaries need (invalidate every outstanding
// response, clear the in-memory state, clear the rendered DOM), and reusing
// it keeps retry/status behavior and the exact-package idempotency in
// planRunStartRetry/planRunStartCheckStatus/planRunStartBuildPackage
// completely untouched.
function planRunStartClose() {
  planRunStartEpoch++;
  planRunStartState = null;
  var el = planRunStartContainer();
  if (el) el.innerHTML = '';
}

// ---- Rendering --------------------------------------------------------------
function planRunStartOutcomeMessage(outcome, reason) {
  var map = {
    invalidInput: 'The prepared Start request was rejected before anything was written.',
    integrityConflict: 'This Program’s Run data could not be verified. Nothing was started.',
    budgetExceeded: 'This Program has too many Sessions/Assignments to start in one operation.'
  };
  return map[outcome] || 'Nothing was started.';
}

function planRunStartRenderRuleRow(row, disabled) {
  var d = disabled ? 'disabled' : '';
  var suggestionHtml = '';
  if (row.suggestionState === 'loading') {
    suggestionHtml = '<div class="planrun-start-suggestion" style="color:var(--text2);font-size:12px">Checking existing value…</div>';
  } else if (row.suggestionState === 'available' && row.suggestion) {
    suggestionHtml = '<div class="planrun-start-suggestion" data-testid="start-suggestion-value" style="font-size:12px">'
      + 'Suggested (from Program): ' + escapeHtml(String(row.suggestion.amount)) + ' ' + escapeHtml(row.suggestion.unit)
      + ' <button type="button" class="btn-secondary" ' + d + ' data-planrun-start-action="use-suggestion" data-planrun-start-rule-id="' + escapeHtml(row.planRuleId) + '">Use suggested value</button>'
      + '</div>';
  } else if (row.suggestionState === 'none') {
    suggestionHtml = '<div class="planrun-start-suggestion" style="color:var(--text2);font-size:12px">No existing starting value for this exercise yet — enter one below.</div>';
  } else if (row.suggestionState === 'stale') {
    suggestionHtml = '<div class="planrun-start-suggestion" style="color:var(--text2);font-size:12px">The stored value for this exercise doesn’t match this Program’s current Rule — enter a fresh value below.</div>';
  } else if (row.suggestionState === 'unavailable') {
    suggestionHtml = '<div class="planrun-start-suggestion" style="color:var(--text2);font-size:12px">Could not check for an existing value — enter one below.</div>';
  }
  var needsAction = !(row.deferred || (row.confirmed && row.amount !== '' && isFinite(Number(row.amount))));
  var typeLabel = row.adjustmentType === 'addLoad' ? 'Add Load' : 'Increase Training Max';
  // ROUND 6 CORRECTION -- explanatory copy for the "Leave blank" choice,
  // worded per-kind so the person knows what happens next without needing
  // to understand "workingLoad"/"trainingMax" as terms: a blank working
  // weight resolves itself automatically the first time a qualifying set is
  // logged; a blank training max must be entered later, by hand, from the
  // Needs Attention list (app-plan-run-training-max-ui.js).
  var deferredExplainer = row.kind === 'trainingMax'
    ? 'You can set this later from the Needs Attention list once the Program is running.'
    : 'This will be filled in automatically the first time you log a qualifying set.';
  var amountUnitDisabled = disabled || row.deferred;
  var ad = amountUnitDisabled ? 'disabled' : '';
  return '<div class="planrun-start-rule-row" data-testid="start-rule-row" data-planrun-start-rule-id="' + escapeHtml(row.planRuleId) + '" style="border:1px solid var(--border,#ccc);border-radius:6px;padding:8px;margin:6px 0">'
    + '<div style="font-weight:600">' + escapeHtml(row.exerciseName) + '<span style="font-weight:400;color:var(--text2);font-size:12px"> — ' + escapeHtml(typeLabel) + '</span></div>'
    + suggestionHtml
    + '<label style="display:inline-block;margin-top:4px">Starting Amount<input type="number" step="any" ' + ad + ' data-testid="start-amount-input" data-planrun-start-rule-id="' + escapeHtml(row.planRuleId) + '" data-planrun-start-amount value="' + escapeHtml(row.amount) + '"></label> '
    + '<label>Unit<select ' + ad + ' data-testid="start-unit-select" data-planrun-start-rule-id="' + escapeHtml(row.planRuleId) + '" data-planrun-start-unit>'
    + '<option value="lb" ' + (row.unit === 'lb' ? 'selected' : '') + '>lb</option>'
    + '<option value="kg" ' + (row.unit === 'kg' ? 'selected' : '') + '>kg</option>'
    + '</select></label>'
    + '<div style="margin-top:4px"><label style="font-size:13px"><input type="checkbox" ' + d + ' data-testid="start-leave-blank-checkbox" data-planrun-start-rule-id="' + escapeHtml(row.planRuleId) + '" data-planrun-start-leave-blank ' + (row.deferred ? 'checked' : '') + '> Leave blank — I’ll set this later</label></div>'
    + (row.deferred ? '<div data-testid="start-deferred-explainer" style="color:var(--text2);font-size:12px;margin-top:2px">' + escapeHtml(deferredExplainer) + '</div>' : '')
    + (needsAction ? '<div data-testid="start-rule-needs-action" style="color:#b00;font-size:12px;margin-top:2px">Needs a confirmed value</div>' : '<div data-testid="start-rule-confirmed" style="color:#080;font-size:12px;margin-top:2px">' + (row.deferred ? 'Will be set later' : 'Confirmed') + '</div>')
    + '</div>';
}

function planRunStartRender() {
  var el = planRunStartContainer();
  if (!el) return;
  planRunStartWireEvents(el);
  var st = planRunStartState;
  if (!st) { el.innerHTML = ''; return; }

  var html = '<div class="page-title-zone"><div class="page-title-zone-title">Start Program</div></div>';
  html += '<div style="padding:0 16px 16px">';

  if (st.phase === 'disabled') {
    html += '<div data-testid="start-disabled" style="padding:8px;border-radius:6px;background:#eee">Starting a Program is currently disabled.</div>';
  } else if (st.phase === 'error') {
    html += '<div data-testid="start-error" style="padding:8px;border-radius:6px;background:#fee;color:#900">Could not start this Program right now.</div>';
  } else if (st.phase === 'loadingProfile') {
    html += '<div data-testid="start-loading" style="color:var(--text2)">Checking this Program…</div>';
  } else if (st.phase === 'readError') {
    html += '<div data-testid="start-read-error" style="padding:8px;border-radius:6px;background:#fee;color:#900">This Program could not be verified. Nothing was started.</div>';
  } else if (st.phase === 'ineligible') {
    html += '<div data-testid="start-ineligible" style="color:var(--text2)">This Program has no Sessions to start yet.</div>';
  } else if (st.phase === 'confirmingValues' || st.phase === 'rejected' || st.phase === 'uncertain' || st.phase === 'alreadyRunning') {
    var disabledRows = st.submitting || st.phase !== 'confirmingValues';
    if (st.rules.length === 0) {
      html += '<div data-testid="start-no-rules" style="color:var(--text2);margin-bottom:8px">This Program has no progression Rules to configure.</div>';
    } else {
      html += st.rules.map(function (r) { return planRunStartRenderRuleRow(r, disabledRows); }).join('');
    }
    if (st.phase === 'confirmingValues') {
      var ready = planRunStartAllRowsReady(st.rules);
      html += '<div style="margin-top:12px">';
      html += '<button type="button" class="btn-primary" data-testid="start-submit-btn" data-planrun-start-action="submit" ' + ((!ready || st.submitting) ? 'disabled' : '') + '>' + (st.submitting ? 'Starting…' : 'Start Program') + '</button> ';
      html += '<button type="button" class="btn-secondary" data-testid="start-close-btn" data-planrun-start-action="close">Cancel</button>';
      html += '</div>';
      if (st.submitError === 'incomplete') {
        html += '<div data-testid="start-incomplete-error" style="color:#b00;margin-top:6px">Confirm a starting value — or choose to leave it blank — for every Rule above before starting.</div>';
      }
    } else if (st.phase === 'rejected') {
      html += '<div data-testid="start-rejected" style="padding:8px;border-radius:6px;background:#fee;color:#900;margin-top:8px">' + escapeHtml(planRunStartOutcomeMessage(st.rejection && st.rejection.outcome)) + '</div>';
      html += '<button type="button" class="btn-secondary" data-testid="start-close-btn" data-planrun-start-action="close">Back to Programs</button>';
    } else if (st.phase === 'uncertain') {
      html += '<div data-testid="start-uncertain" style="padding:8px;border-radius:6px;background:#ffe;color:#740;margin-top:8px">We couldn’t confirm whether this Program started. Nothing is shown as started until we know for sure.</div>';
      html += '<div style="margin-top:8px">';
      html += '<button type="button" class="btn-primary" data-testid="start-retry-btn" data-planrun-start-action="retry" ' + (st.submitting ? 'disabled' : '') + '>Retry</button> ';
      html += '<button type="button" class="btn-secondary" data-testid="start-check-status-btn" data-planrun-start-action="check-status" ' + (st.submitting ? 'disabled' : '') + '>Check Status</button> ';
      html += '<button type="button" class="btn-secondary" data-testid="start-abandon-btn" data-planrun-start-action="abandon" ' + (st.submitting ? 'disabled' : '') + '>Abandon</button>';
      html += '</div>';
    } else if (st.phase === 'alreadyRunning') {
      html += '<div data-testid="start-already-running" style="padding:8px;border-radius:6px;background:#eef;color:#046;margin-top:8px">This Program is already running.</div>';
      html += '<button type="button" class="btn-primary" data-testid="start-go-to-active-run-btn" data-planrun-start-action="go-to-active-run">Go to Active Run</button>';
    }
  }
  html += '</div>';
  el.innerHTML = html;
}

// -----------------------------------------------------------------------------
// Guarded Node-only export seam (mirrors plan-run-model.js's own convention)
// -- exposes ONLY the pure, zero-I/O functions above for a plain `require()`
// Tier-1-style test. Every DOM/ctx-driven function is exercised solely
// through a real (jsdom) browser realm, exactly like app-plan-run-ui.js's
// own functions already are.
// -----------------------------------------------------------------------------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    planRunStartPickPrescribed: planRunStartPickPrescribed,
    planRunStartFilterRunnableStructure: planRunStartFilterRunnableStructure,
    planRunStartCountRunnableSessions: planRunStartCountRunnableSessions,
    planRunStartEnumerateEnabledRules: planRunStartEnumerateEnabledRules,
    planRunStartTemplateLevelSuggestionIsValid: planRunStartTemplateLevelSuggestionIsValid,
    planRunStartBuildPackage: planRunStartBuildPackage
  };
}
