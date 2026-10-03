// =============================================================================
// firebase-plan-run.js -- IRON LOG Canonical Program-Run Lifecycle, Round 8
// specification (canonical-program-run-lifecycle-specification-round8.md).
// FIRESTORE-FACING TRANSACTION LAYER.
//
// STATUS / NON-AUTHORIZATION NOTICE: this file implements a narrowly scoped
// Run-persistence slice submitted for INDEPENDENT REVIEW ONLY. It does not
// authorize, and has not been used for, deployment, Firestore-rule
// publication, capability activation, migration, or any real-data change.
// It is NOT referenced by index.html and carries no browser-reachable path
// of any kind today -- every real exercise of this file in this delivery is
// through Node (`require`) or a Node `vm` sandbox, exactly like this
// codebase's own existing standalone test harnesses already load
// firebase.js/app-plan.js. `CANONICAL_PLAN_RUN_CAPABILITY_ENABLED` below is
// hardcoded `false` and is never read, referenced, or overridden by
// anything outside this file's own dispatch gate -- there is no mutable
// switch, query parameter, or global setter anywhere.
//
// STYLE CONVENTION: this file mirrors firebase-plan-progression.js's own
// IIFE-with-`root`-attachment shape (a private dependency-injected factory,
// a guarded Node `module.exports`/`__test` seam, `root.<name>` for every
// external pure function it calls) because it plays the exact same
// architectural role that file does: owner-scoped Firestore transactions
// built on top of already-accepted pure model/canonical functions. It
// expects the pure functions from plan-run-model.js (loaded first) and from
// app-plan.js (loaded before that) to already be reachable as bare globals
// on `root` -- exactly the same expectation firebase-plan-progression.js
// already has of app-plan.js's own `planBuildCanonicalEncoding`/
// `planSha256Hex`/etc (see that file's own header comment). See the
// implementation report for the exact required load order in every context
// this delivery exercises (Node `require`, combined `vm` realm).
// =============================================================================
(function (root) {
  'use strict';

  // Per task instructions §2/§6: "Any new Run-specific capability must
  // default to disabled, with isolated test-only access absent from real
  // browser loads." This is the ONE such capability this slice introduces.
  // It is never switched true anywhere in this file, in any real code path.
  var CANONICAL_PLAN_RUN_CAPABILITY_ENABLED = false;

  function M(name) {
    var f = root[name];
    if (typeof f === 'undefined') {
      throw new Error('firebase-plan-run.js: required dependency "' + name + '" is not available on the shared realm -- see this file\'s own header for the required load order.');
    }
    return f;
  }

  // ---- Typed errors at this feature's own persistence boundary. Mirrors
  // firebase.js's own five-member CanonicalPlanCommit*Error family
  // (firebase.js:455-536) in SHAPE and in the classification switch's own
  // branching (`classifyTransactionFailure`, firebase.js:526-535) -- but as
  // an independent copy, not a shared import, because that function and
  // those classes are private to firebase.js's own IIFE and are not part of
  // its exported seven-key production surface or its guarded __test object
  // (see the implementation report's file-change inventory: this is a
  // reuse-of-PATTERN, not reuse-of-CODE, for the same reason
  // COMMIT_SAFETY_CAPS's own comment already gives -- classic <script> tags
  // sharing one global scope have no import mechanism, and this feature's
  // typed errors are semantically about RUN operations, not Template
  // commits, so a parallel, purpose-named family is clearer than reusing
  // Template-commit-named classes for an unrelated feature even if doing so
  // were mechanically possible).
  function makeErrorClass(name, defaultMessage, code) {
    function E(message, cause) {
      var base = Error.call(this, message || defaultMessage);
      this.message = base.message; this.stack = base.stack; this.name = name; this.code = code;
      this.sdkCode = (cause && cause.code) || null; this.cause = cause || null;
    }
    E.prototype = Object.create(Error.prototype);
    E.prototype.constructor = E;
    return E;
  }
  var CanonicalPlanRunWriterDisabledError = makeErrorClass('CanonicalPlanRunWriterDisabledError', 'Canonical Program-Run persistence is disabled.', 'CANONICAL_PLAN_RUN_DISABLED');
  var CanonicalPlanRunAuthorizationError = makeErrorClass('CanonicalPlanRunAuthorizationError', 'Firestore rejected the Run transaction due to an authorization failure.', 'CANONICAL_PLAN_RUN_AUTHORIZATION');
  var CanonicalPlanRunUnavailableError = makeErrorClass('CanonicalPlanRunUnavailableError', 'The Run transaction did not complete because the persistence backend was unavailable.', 'CANONICAL_PLAN_RUN_UNAVAILABLE');
  var CanonicalPlanRunPersistenceError = makeErrorClass('CanonicalPlanRunPersistenceError', 'The Run transaction failed with an unexpected persistence error.', 'CANONICAL_PLAN_RUN_PERSISTENCE_FAILURE');
  var CanonicalPlanRunIntegrityError = makeErrorClass('CanonicalPlanRunIntegrityError', 'Canonical Program-Run adapter/package integrity failure.', 'CANONICAL_PLAN_RUN_INTEGRITY');

  // Bucket (a)/(b) taxonomy -- invariant 25, mirrored from
  // classifyTransactionFailure (firebase.js:526-535) branch-for-branch.
  function classifyRunTransactionFailure(err) {
    if (err instanceof CanonicalPlanRunWriterDisabledError || err instanceof CanonicalPlanRunIntegrityError ||
      err instanceof CanonicalPlanRunAuthorizationError || err instanceof CanonicalPlanRunUnavailableError ||
      err instanceof CanonicalPlanRunPersistenceError) return err;
    var code = err && err.code;
    if (code === 'permission-denied' || code === 'unauthenticated') return new CanonicalPlanRunAuthorizationError('Firestore rejected the Run transaction due to an authorization failure.', err);
    if (code === 'unavailable' || code === 'deadline-exceeded' || code === 'aborted' || code === 'resource-exhausted' || code === 'cancelled') return new CanonicalPlanRunUnavailableError('The Run transaction did not complete due to an availability or retry failure.', err);
    return new CanonicalPlanRunPersistenceError('The Run transaction failed with an unexpected SDK error.', err);
  }

  function createRunPersistence(deps, enabled) {
    function disabledGate() { if (!enabled) throw new CanonicalPlanRunWriterDisabledError(); }

    // JUDGMENT CALL (flagged in the report): the completed workout document
    // this slice's Finish operation writes is persisted at the EXISTING
    // `users/{ownerUid}/workouts/{workoutId}` path -- the SAME collection
    // legacy Tier A/B history already uses (`COL_WORKOUTS`, firebase.js:36)
    // -- never a new, seventh collection (the task's own instructions
    // forbid introducing one). This is directly supported by invariant 15
    // (which forbids calling the fire-and-forget `fsSaveWorkout`/`fsSet`
    // FUNCTIONS and forbids the `programs` collection specifically, but
    // never forbids this feature's own properly-awaited transactional write
    // to the `workouts` collection itself) and by invariant 8 ("a completed
    // workout remains in workout history independently of the Run's later
    // status"). What is NOT settled by Round 8 is the workout document's
    // own FULL field shape beyond the canonical-context stamps §8 names --
    // the real, rich logger-display shape (`planSetToLoggerSet`,
    // app-plan.js:391-410: loadType/percent/effortType/rir/etc) is a
    // UI/logger concern this narrowly scoped persistence slice does not
    // build (the task's own scope section explicitly excludes logger
    // integration). This slice therefore defines and validates its OWN
    // minimal performed-workout shape (plan-run-model.js's
    // PLAN_RUN_WORKOUT_KEYS) as the smallest shape sufficient to satisfy
    // the canonical-context contract and the completion-eligibility/
    // progression-evaluation contracts this slice DOES implement, and
    // writes exactly that shape (nothing more) to the shared collection. A
    // future logger-integration slice must ensure whatever richer object it
    // eventually builds is a superset that still satisfies this same
    // contract; Round 8 does not specify that superset, so this
    // implementation does not invent one.
    function workoutPath(ownerUid, workoutId) { return 'users/' + ownerUid + '/workouts/' + workoutId; }
    function colPath(ownerUid, kind, id) { return 'users/' + ownerUid + '/' + M('PLAN_RUN_COLLECTIONS')[kind] + '/' + id; }

    // ROUND 4 CORRECTION (Finish package-hash / Timestamp defect, reported
    // unresolved at the end of the prior round -- see that round's report,
    // Finding 2): `packageHash` below hashes the ENTIRE input package via
    // app-plan.js's `planBuildCanonicalEncoding`, which is unmodified and
    // deliberately left that way -- its documented contract (app-plan.js
    // ~line 1399) only ever supports null/boolean/finite-number/string/
    // array/plain-object values, and correctly rejects any class instance,
    // Firestore Timestamp included. `pkg.workout.createdAt` is the one
    // field in this feature's surface that legitimately needs to carry a
    // REAL Firestore Timestamp -- `fsPlanRunFinish` writes `pkg.workout` to
    // Firestore VERBATIM (`tx.set(workoutPath(...), pkg.workout)`, below),
    // so a real, native Timestamp field in the persisted document requires
    // the caller to supply one here -- while that same value also has to
    // survive `packageHash`.
    //
    // This function is a disposable, hash-only normalization: it builds a
    // NEW object tree for hashing and never mutates its input in any way.
    // `pkg` itself -- and specifically `pkg.workout`, still carrying its
    // real Timestamp -- is untouched and is exactly what later reaches
    // `tx.set`. It changes nothing about what gets persisted.
    //
    // It does not touch the canonical encoder's own contract (app-plan.js
    // is unchanged this round -- confirmed by hash in this round's report).
    // Instead it walks the SAME two shapes the encoder already accepts
    // today (plain object, array) exactly the way the encoder itself
    // would, and intercepts ONLY a value that is NOT a plain object but IS
    // genuinely Timestamp-shaped -- decided by `planRunIsTimestamp`, the
    // SAME duck-typed validity check plan-run-model.js already uses
    // everywhere else a timestamp field is validated in this feature
    // (`pkg.workout.createdAt` itself, progressionState's own createdAt/
    // updatedAt/lastEvaluatedAt) -- never a newly invented check. A
    // genuinely Timestamp-shaped value (whether a real Timestamp instance
    // or an already-accepted plain {seconds,nanoseconds} object -- both
    // satisfy `planRunIsTimestamp` today, and this feature's own
    // fake-Firestore test suite already relies on the plain-object form
    // being equivalent) is replaced with the SMALLEST deterministic
    // representation that still preserves its value exactly: a fresh plain
    // object carrying only its own `seconds`/`nanoseconds` integers,
    // copied verbatim -- no rounding, no truncation to milliseconds, no
    // timezone conversion, nothing invented.
    //
    // Anything else -- a value that is neither a plain object nor
    // genuinely Timestamp-shaped (a `Date`, a `Map`, a malformed
    // pseudo-Timestamp with a non-integer or out-of-range field) -- is left
    // completely alone and reaches the unmodified encoder exactly as it
    // would today, which still, correctly, rejects it with the same
    // `PlanCanonicalEncodingError` as before. Nothing here guesses, rounds,
    // or coerces an invalid value into looking valid; an invalid
    // timestamp-like value is rejected, not repaired.
    //
    // This applies to every one of packageHash's five call sites (Start's
    // receipt-guard check, Finish's shared read+classify decision input,
    // Finish's own commit receipt, and End's shared read+classify decision
    // input, reused by both a genuine End and Check-End-Status) -- not
    // just Finish -- because it is the one shared `packageHash` helper all
    // of them already call. This is a no-op for Start and End: neither of
    // their own package shapes contains a Timestamp-shaped value today (a
    // Start package's occurrences carry no timestamp fields; an End
    // package is exactly `{operationId, ownerUid, planRunId}`), so nothing
    // in their existing hashes changes -- see this round's own tests for a
    // direct before/after confirmation.
    function planRunNormalizeForPackageHash(value) {
      if (value === null || typeof value !== 'object') return value;
      if (Array.isArray(value)) return value.map(planRunNormalizeForPackageHash);
      if (M('planIsPlainObject')(value)) {
        var out = {};
        var keys = Object.keys(value);
        for (var i = 0; i < keys.length; i++) { out[keys[i]] = planRunNormalizeForPackageHash(value[keys[i]]); }
        return out;
      }
      if (M('planRunIsTimestamp')(value)) {
        return { seconds: value.seconds, nanoseconds: value.nanoseconds };
      }
      return value;
    }
    function packageHash(pkg) {
      var sha = root.planSha256Hex, enc = root.planBuildCanonicalEncoding;
      if (typeof sha !== 'function' || typeof enc !== 'function') throw new CanonicalPlanRunIntegrityError('planSha256Hex/planBuildCanonicalEncoding are not available to hash the prepared package.');
      return sha(enc(planRunNormalizeForPackageHash(pkg)));
    }

    // FOUNDATION SLICE ADDITION (canonical-program-run-ui-logger-integration-
    // specification-round8.md §3A.10.6, both findings). Compares two WORKOUT
    // DOCUMENTS directly -- not an operation package -- for byte-identical
    // canonical content, after normalizing each side's own Timestamp-typed
    // fields via the model-layer, schema-aware
    // `planRunNormalizeForCanonicalHash` (plan-run-model.js §3A.10.1-5).
    // This is a DIFFERENT question, and a DIFFERENT function, from the
    // `packageHash` normalization directly above: packageHash hashes an
    // entire Start/Finish/End package (including operationId) to answer "is
    // this the same operation attempt"; this function has no operationId to
    // fold in and answers "is this the same document" -- used by the new
    // Finish collision check (finishReadAndClassify below) and by the new
    // fsPlanRunSaveHistoryOnly's own collision step. Deliberately reuses
    // this file's own already-accepted, already-reviewed `packageHash`
    // dependency-resolution pattern (`root.planSha256Hex`/
    // `root.planBuildCanonicalEncoding`, the identical `typeof` guard) --
    // this introduces no new resolution mechanism.
    //
    // Declared here, inside createRunPersistence's own closure, alongside
    // packageHash/workoutPath/colPath -- deliberately NOT exported, NOT
    // public, and NEVER resolved via M(...): its two real call sites
    // (finishReadAndClassify's own collision comparison, and
    // fsPlanRunSaveHistoryOnly's own step 8, both below) are themselves
    // declared inside this SAME closure, so an ordinary, direct,
    // same-scope function reference is correct and sufficient on its own.
    // M(...) exists specifically to reach a DIFFERENT file's own
    // module.exports (plan-run-model.js's) across the classic-<script>
    // load-order boundary -- it would simply never find a name that is
    // never registered on that file's own exports object, since this
    // function is not one of them.
    function planRunNormalizedWorkoutHashesEqual(workoutA, workoutB) {
      var sha = root.planSha256Hex, enc = root.planBuildCanonicalEncoding;
      if (typeof sha !== 'function' || typeof enc !== 'function') {
        throw new CanonicalPlanRunIntegrityError('planSha256Hex/planBuildCanonicalEncoding are not available to compare the two workout documents.');
      }
      var norm = M('planRunNormalizeForCanonicalHash');
      var TimestampErr = M('PlanRunTimestampNormalizationError');
      var normA, normB;
      try {
        normA = norm(workoutA, null);
        normB = norm(workoutB, null);
      } catch (e) {
        if (e instanceof TimestampErr) throw new CanonicalPlanRunIntegrityError('unsupportedTimestampShape', e);
        throw e;
      }
      return sha(enc(normA)) === sha(enc(normB));
    }

    function classifyDocFlags(raw, validFn, identityFn, identityArgs) {
      if (!raw || !raw.exists) return { exists: false, valid: false, identityOk: false, outcome: null };
      var v = validFn(raw.data);
      var idOk = v && identityFn.apply(null, [raw.data].concat(identityArgs));
      return { exists: true, valid: !!v, identityOk: !!idOk, outcome: raw.data ? raw.data.outcome : null };
    }

    // =========================================================================
    // START (spec §6, §13's Start table)
    // =========================================================================
    async function fsPlanRunPreflightStart(pkg) { return M('planRunPreflightStart')(pkg); }

    async function fsPlanRunStart(pkg) {
      disabledGate();
      // ROUND 2 CORRECTION (section 3): validate the input's own SHAPE
      // before touching any property of it -- a null/undefined/primitive/
      // array `pkg` must classify as invalidInput, never surface as an
      // uncaught TypeError from `pkg.ownerUid`.
      if (!M('planRunIsPlainObject')(pkg)) return { outcome: 'invalidInput', reason: 'malformedInput' };
      if (pkg.ownerUid !== deps.currentUid()) return { outcome: 'invalidInput', reason: 'ownerMismatch' };
      var preflight = M('planRunPreflightStart')(pkg);
      if (!preflight.ok) return { outcome: 'invalidInput', reason: 'preflightRejected', reasons: preflight.reasons };
      var slotId = M('planRunBuildActiveSlotId')(pkg.ownerUid, pkg.planTemplateId);
      if (!slotId) return { outcome: 'invalidInput', reason: 'malformedSlotIdentity' };
      var runPath = colPath(pkg.ownerUid, 'runs', pkg.planRunId);
      var slotPath = colPath(pkg.ownerUid, 'activeSlot', slotId);
      var receiptPath = colPath(pkg.ownerUid, 'operations', pkg.operationId);
      try {
        return await deps.transaction(async function (tx) {
          // ROUND 2 CORRECTION (section 2): read + validate the operation
          // receipt BEFORE anything else -- closes the "operation-ID reuse
          // across different Runs" gap (this code previously wrote the
          // receipt unconditionally at the end, with no read of any
          // pre-existing document at that path first, which could silently
          // overwrite a different Run's immutable receipt). This is checked
          // on every code path that can reach this transaction -- there is
          // no separate, bypassable "front door".
          var receiptSnap = await tx.get(receiptPath);
          var receiptValid = receiptSnap.exists && M('planRunOperationDocValid')(receiptSnap.data);
          var receiptIdentityOk = receiptValid && M('planRunOperationIdentityOk')(receiptSnap.data, pkg.ownerUid, pkg.operationId, 'runStart');
          var actualHash = packageHash(pkg);
          var receiptGuard = M('planRunClassifyOperationReceiptGuard')({
            receiptExists: receiptSnap.exists, receiptValid: receiptValid, receiptIdentityOk: receiptIdentityOk,
            receiptResultRefsPlanRunId: receiptIdentityOk ? receiptSnap.data.resultRefs.planRunId : null,
            requestedPlanRunId: pkg.planRunId, haveFullPackage: true, actualPackageHash: actualHash,
            receiptPreparedPackageHash: receiptValid ? receiptSnap.data.preparedPackageHash : null
          });
          if (receiptGuard.result === 'integrityConflict') return { outcome: 'integrityConflict', reason: receiptGuard.reason };

          var runSnap = await tx.get(runPath);
          var runExists = runSnap.exists;
          // ROUND 5 CORRECTION (amendment Rounds 2+3): a Run document whose
          // declared activeSlotId is not the correct hash of its own
          // ownerUid+planTemplateId is treated exactly like any other
          // shape-invalid Run document -- folded into the SAME `runValid`
          // flag that already gates every downstream historical-
          // classification branch below, never a new/separate outcome.
          var runValid = runExists && M('planRunDocValid')(runSnap.data) && M('planRunActiveSlotIdOk')(runSnap.data);
          var runIdentityOk = runValid && runSnap.data.ownerUid === pkg.ownerUid && runSnap.data.planRunId === pkg.planRunId &&
            runSnap.data.planTemplateId === pkg.planTemplateId && runSnap.data.headRevisionId === pkg.headRevisionId;
          var historical = M('planRunClassifyStartRequest')({ runExists: runExists, runValid: runValid, runIdentityOk: runIdentityOk });
          if (receiptGuard.result === 'recognizedMatchingPackage' && historical.outcome !== 'alreadyCommitted') {
            // The receipt genuinely claims this exact operation already
            // committed this exact package, but the Run document itself
            // disagrees (missing or foreign) -- a contradiction between two
            // independent pieces of persisted evidence, never silently
            // resolved in either direction.
            return { outcome: 'integrityConflict', reason: 'receiptCommittedButRunMissingOrForeign' };
          }
          if (historical.outcome === 'alreadyCommitted') return { outcome: 'alreadyCommitted', packageHashVerified: receiptGuard.result === 'recognizedMatchingPackage', resultRefs: { planRunId: pkg.planRunId } };
          if (historical.outcome === 'integrityConflict') return { outcome: 'integrityConflict', reason: historical.reason };

          var slotSnap = await tx.get(slotPath);
          var slotExists = slotSnap.exists;
          var slotValid = slotExists && M('planRunSlotDocValid')(slotSnap.data) && M('planRunSlotIdentityOk')(slotSnap.data, pkg.ownerUid, pkg.planTemplateId);
          var slotActivePlanRunId = slotValid ? slotSnap.data.activePlanRunId : null;
          var pointedRun = null;
          if (slotValid && slotActivePlanRunId !== null) {
            var pointedSnap = await tx.get(colPath(pkg.ownerUid, 'runs', slotActivePlanRunId));
            // ROUND 5 CORRECTION (amendment Rounds 2+3): same fold-in as the
            // Run-being-started check above, applied to the Run a slot's
            // existing claim points at.
            var pointedValid = pointedSnap.exists && M('planRunDocValid')(pointedSnap.data) && M('planRunActiveSlotIdOk')(pointedSnap.data);
            var pointedIdentityOk = pointedValid && pointedSnap.data.ownerUid === pkg.ownerUid && pointedSnap.data.planTemplateId === pkg.planTemplateId;
            pointedRun = { exists: pointedSnap.exists, valid: pointedValid, identityOk: pointedIdentityOk, status: pointedValid ? pointedSnap.data.status : null };
          }
          var claim = M('planRunSlotClaimDecision')({ slotExists: slotExists, slotValid: slotValid, slotActivePlanRunId: slotActivePlanRunId, pointedRun: pointedRun });
          if (claim.result === 'alreadyRunning') return { outcome: 'alreadyRunning', runId: claim.runId };
          if (claim.result === 'integrityConflict') return { outcome: 'integrityConflict', reason: claim.reason };

          // Legal, genuinely new Start. Build every write BEFORE issuing any
          // of them (no partial-write risk on a later, hypothetical check).
          var now = deps.timestamp();
          var orderedOccIds = pkg.occurrences.slice().sort(function (x, y) {
            return (x.microcycleOrdinal - y.microcycleOrdinal) || (x.sessionOrdinal - y.sessionOrdinal);
          }).map(function (o) { return o.occurrenceId; });
          var occWrites = pkg.occurrences.map(function (o) {
            return {
              path: colPath(pkg.ownerUid, 'occurrences', o.occurrenceId),
              data: {
                ownerUid: pkg.ownerUid, planRunId: pkg.planRunId, occurrenceId: o.occurrenceId,
                planTemplateId: pkg.planTemplateId, headRevisionId: pkg.headRevisionId, manifestId: pkg.manifestId,
                planMicrocycleId: o.planMicrocycleId, planSessionId: o.planSessionId,
                microcycleOrdinal: o.microcycleOrdinal, sessionOrdinal: o.sessionOrdinal,
                nameSnapshot: o.nameSnapshot, assignments: o.assignments,
                status: 'pending', workoutId: null, completedAt: null, updatedAt: now
              }
            };
          });
          var stateWrites = pkg.progressionInitialValues.map(function (v) {
            var stateId = M('planRunBuildRuleStateId')(pkg.planRunId, v.planRuleId);
            return {
              path: colPath(pkg.ownerUid, 'progressionState', stateId),
              data: {
                ownerUid: pkg.ownerUid, planRunId: pkg.planRunId, planTemplateId: pkg.planTemplateId, headRevisionId: pkg.headRevisionId,
                planAssignmentId: v.planAssignmentId, planRuleId: v.planRuleId, ruleRevisionId: v.ruleRevisionId, exerciseId: v.exerciseId,
                currentValue: { kind: v.kind, amount: v.amount, unit: v.unit }, status: 'active', needsManualReviewReason: null,
                initializationSource: v.initializationSource, lastProcessedWorkoutId: null, lastEvaluatedAt: null,
                schemaVersion: 1, createdAt: now, updatedAt: now
              }
            };
          });
          // ROUND 5 CORRECTION (amendment Rounds 2+3): activeSlotId is
          // populated at genuine Start from the SAME `slotId` variable
          // already computed near the top of this function (before the
          // transaction even opened) -- no new computation is introduced.
          var runData = {
            recordType: 'planProgramRun', schemaVersion: 1, ownerUid: pkg.ownerUid, planRunId: pkg.planRunId,
            planTemplateId: pkg.planTemplateId, headRevisionId: pkg.headRevisionId, manifestId: pkg.manifestId, graphHash: pkg.graphHash,
            nameSnapshot: pkg.nameSnapshot, status: 'active', totalOccurrenceCount: orderedOccIds.length,
            remainingOccurrenceIds: orderedOccIds, nextOccurrenceId: orderedOccIds.length ? orderedOccIds[0] : null,
            startedAt: now, completedAt: null, endedAt: null, updatedAt: now, activeSlotId: slotId
          };
          var resultRefs = { planRunId: pkg.planRunId };
          var receiptData = { ownerUid: pkg.ownerUid, operationId: pkg.operationId, operationType: 'runStart', preparedPackageHash: actualHash, outcome: 'committed', resultRefs: resultRefs, createdAt: now };

          // ROUND 2 CORRECTION (section 1): a final, freshly-computed check
          // right before any write is issued, derived from the ACTUAL write
          // arrays built above (never from a caller-supplied count) --
          // defense-in-depth against any future code path that might build
          // more writes than the request-time preflight anticipated. The
          // request-time preflight above already bounds this for any
          // well-formed request; this recheck is what makes the cap
          // impossible to bypass through a code path that skips preflight.
          var actualWriteCount = 1 /* run */ + occWrites.length + stateWrites.length + 1 /* slot */ + 1 /* receipt */;
          if (actualWriteCount > M('PLAN_RUN_SAFETY_CAPS').maxStartTransactionWrites) {
            return { outcome: 'budgetExceeded', reasons: ['tooManyWrites'] };
          }

          // ROUND 3 CORRECTION (finding 3): the real, non-bypassable
          // final-document-size + aggregate-transaction-byte check, run
          // against the ACTUAL staged write set -- including the slot
          // document's own real FINAL content (a merge of its existing data
          // with the patch, when this is an update; the fresh document
          // itself, when this is a create), never just the request-time
          // package the (unchanged) preflight above already checked. This
          // closes the specific gap this feature had for
          // `maxRunDocumentBytes` (declared since Round 1, never actually
          // enforced anywhere until this line).
          var finalSlotData = slotExists
            ? Object.assign({}, slotSnap.data, { activePlanRunId: pkg.planRunId, updatedAt: now })
            : { ownerUid: pkg.ownerUid, planTemplateId: pkg.planTemplateId, activeSlotId: slotId, activePlanRunId: pkg.planRunId, updatedAt: now };
          var stagedByteWrites = [{ path: runPath, kind: 'run', data: runData }]
            .concat(occWrites.map(function (w) { return { path: w.path, kind: 'occurrence', data: w.data }; }))
            .concat(stateWrites.map(function (w) { return { path: w.path, kind: 'progressionState', data: w.data }; }))
            .concat([{ path: slotPath, kind: 'activeSlot', data: finalSlotData }, { path: receiptPath, kind: 'operation', data: receiptData }]);
          var byteBudget = M('planRunCheckStagedTransactionBytes')(stagedByteWrites);
          if (!byteBudget.ok) return { outcome: 'budgetExceeded', reasons: byteBudget.reasons };

          tx.set(runPath, runData);
          occWrites.forEach(function (w) { tx.set(w.path, w.data); });
          stateWrites.forEach(function (w) { tx.set(w.path, w.data); });
          if (slotExists) tx.update(slotPath, { activePlanRunId: pkg.planRunId, updatedAt: now });
          else tx.set(slotPath, { ownerUid: pkg.ownerUid, planTemplateId: pkg.planTemplateId, activeSlotId: slotId, activePlanRunId: pkg.planRunId, updatedAt: now });
          tx.set(receiptPath, receiptData);

          return { outcome: 'committed', resultRefs: resultRefs };
        });
      } catch (err) { throw classifyRunTransactionFailure(err); }
    }

    async function fsPlanRunCheckStartStatus(input) {
      disabledGate();
      // ROUND 2 CORRECTION (section 3): validate shape + the minimal
      // identity-only input contract BEFORE any property access or I/O.
      if (!M('planRunIsPlainObject')(input)) return { outcome: 'invalidInput', reason: 'malformedInput' };
      var inputCheck = M('planRunValidateCheckStartStatusInput')(input);
      if (!inputCheck.ok) return { outcome: 'invalidInput', reason: inputCheck.reason };
      if (input.ownerUid !== deps.currentUid()) return { outcome: 'invalidInput', reason: 'ownerMismatch' };
      try {
        return await deps.transaction(async function (tx) {
          var runSnap = await tx.get(colPath(input.ownerUid, 'runs', input.planRunId));
          // ROUND 5 CORRECTION (amendment Rounds 2+3): mirrors fsPlanRunStart's
          // own identical fold-in above -- a wrong-arithmetic activeSlotId is
          // just another way for this document to be invalid.
          var runExists = runSnap.exists, runValid = runExists && M('planRunDocValid')(runSnap.data) && M('planRunActiveSlotIdOk')(runSnap.data);
          // ROUND 2 CORRECTION (section 3): a found Run must also match the
          // REQUESTED Template identity -- the prior round recognized any
          // Run at this planRunId as "committed" regardless of whether it
          // was actually started against the Template the caller is asking
          // about, which could wrongly confirm an unrelated Run that
          // happens to reuse the same planRunId value under a different
          // Template.
          var runIdentityOk = runValid && runSnap.data.ownerUid === input.ownerUid && runSnap.data.planRunId === input.planRunId &&
            runSnap.data.planTemplateId === input.planTemplateId;
          if (runExists && runValid && runIdentityOk) return { outcome: 'committed', resultRefs: { planRunId: input.planRunId } };
          if (runExists) return { outcome: 'integrityConflict', reason: 'startRunDocumentMalformedOrForeign' };
          var slotId = M('planRunBuildActiveSlotId')(input.ownerUid, input.planTemplateId);
          var slotSnap = await tx.get(colPath(input.ownerUid, 'activeSlot', slotId));
          if (!slotSnap.exists) return { outcome: 'confirmedAbsent' };
          var slotValid = M('planRunSlotDocValid')(slotSnap.data) && M('planRunSlotIdentityOk')(slotSnap.data, input.ownerUid, input.planTemplateId);
          if (!slotValid) return { outcome: 'integrityConflict', reason: 'slotMalformed' };
          if (slotSnap.data.activePlanRunId === null) return { outcome: 'confirmedAbsent' };
          if (slotSnap.data.activePlanRunId === input.planRunId) return { outcome: 'integrityConflict', reason: 'slotNamesMissingRun' };
          var otherSnap = await tx.get(colPath(input.ownerUid, 'runs', slotSnap.data.activePlanRunId));
          // ROUND 5 CORRECTION (amendment Rounds 2+3): same fold-in, applied
          // to the Run the slot's existing claim points at.
          var otherValid = otherSnap.exists && M('planRunDocValid')(otherSnap.data) && M('planRunActiveSlotIdOk')(otherSnap.data) && otherSnap.data.ownerUid === input.ownerUid && otherSnap.data.planTemplateId === input.planTemplateId;
          if (otherValid && otherSnap.data.status === 'active') return { outcome: 'competingOperation', winningRunId: slotSnap.data.activePlanRunId };
          return { outcome: 'integrityConflict', reason: 'slotPointsToInvalidOrTerminalRun' };
        });
      } catch (err) { throw classifyRunTransactionFailure(err); }
    }

    // =========================================================================
    // MARK OCCURRENCE IN PROGRESS -- new this slice. Named by the
    // ui-logger-integration-specification family (round1 §2.6, round8 §7) but
    // that family is SPECIFICATION ONLY, never accepted, and never
    // implemented it -- confirmed absent from this file and from
    // plan-run-model.js before any of this slice's own code was written.
    // Follows the same read-validate-classify-transact discipline as
    // Start/Finish/End above, including full document/identity verification
    // and active-slot corroboration before any write. See
    // planRunClassifyMarkInProgressRequest (plan-run-model.js) for the full
    // decision table and rationale.
    //
    // SLICE 2 CORRECTION (independent-review, this round): the
    // occurrence-to-Run cross-check below originally compared only
    // planRunId. It now calls the same `planRunOccurrenceRunBindingOk`
    // helper the existing read path (fsPlanRunReadForDisplay above) already
    // uses, which also checks ownerUid, planTemplateId, headRevisionId, and
    // manifestId. This is a widening of what gets rejected, not a
    // loosening: a request that used to pass on planRunId agreement alone
    // can now be caught as crossDocumentBindingMismatch/occurrenceRunMismatch
    // (zero writes) if any of those other fields disagree. The check is
    // still performed at the same point in the sequence -- after both
    // documents' own shape/self-identity are confirmed, before the slot is
    // ever read or any write is made.
    // =========================================================================
    async function fsPlanRunMarkOccurrenceInProgress(pkg) {
      disabledGate();
      if (!M('planRunIsPlainObject')(pkg)) return { outcome: 'invalidInput', reason: 'malformedInput' };
      if (pkg.ownerUid !== deps.currentUid()) return { outcome: 'invalidInput', reason: 'ownerMismatch' };
      var inputCheck = M('planRunValidateMarkInProgressInput')(pkg);
      if (!inputCheck.ok) return { outcome: 'invalidInput', reason: inputCheck.reason };
      var runPath = colPath(pkg.ownerUid, 'runs', pkg.planRunId);
      var occPath = colPath(pkg.ownerUid, 'occurrences', pkg.occurrenceId);
      try {
        return await deps.transaction(async function (tx) {
          var runSnap = await tx.get(runPath);
          var occSnap = await tx.get(occPath);
          var runExists = runSnap.exists, occExists = occSnap.exists;
          var runValid = runExists && M('planRunDocValid')(runSnap.data) && M('planRunActiveSlotIdOk')(runSnap.data);
          var occValid = occExists && M('planRunOccurrenceDocValid')(occSnap.data);
          var runIdentityOk = runValid && runSnap.data.ownerUid === pkg.ownerUid && runSnap.data.planRunId === pkg.planRunId &&
            runSnap.data.planTemplateId === pkg.planTemplateId && runSnap.data.headRevisionId === pkg.headRevisionId;
          var occIdentityOk = occValid && M('planRunOccurrenceIdentityOk')(occSnap.data, pkg.ownerUid, pkg.planRunId, pkg.occurrenceId);
          // SLICE 2 CORRECTION (independent-review): this used to compare only
          // planRunId between the two documents. That is too narrow -- it let
          // an occurrence and a Run agree on planRunId alone while disagreeing
          // on planTemplateId/headRevisionId/manifestId/ownerUid and still be
          // treated as bound to each other. The existing read path
          // (fsPlanRunReadForDisplay above) already established the correct,
          // full cross-document check via the shared `planRunOccurrenceRunBindingOk`
          // helper (plan-run-model.js) -- reused here, unchanged, rather than
          // re-deriving a narrower ad hoc comparison. `occValid && runValid &&`
          // is kept as a defensive prefix even though the helper re-validates
          // shape internally, to make the short-circuit explicit at this call
          // site and match this function's own established style.
          var occurrenceRunMatch = occValid && runValid && M('planRunOccurrenceRunBindingOk')(occSnap.data, runSnap.data);

          // The slot is only ever read once every cheaper, already-available
          // check has passed -- mirrors this file's own established "read
          // only what a still-live decision needs" discipline (e.g.
          // fsPlanRunStart's own slot read, only reached after its receipt/
          // run checks). A request that already fails an earlier check never
          // pays for the extra read, and never reaches the shared classifier
          // with slot fields it cannot actually vouch for.
          var slotSnap = null, slotValid = false, slotIdentityOk = false, slotActivePlanRunId = null;
          var reachedSlotCheck = runExists && occExists && runValid && occValid && runIdentityOk && occIdentityOk && occurrenceRunMatch &&
            runSnap.data.status === 'active' && runSnap.data.remainingOccurrenceIds.indexOf(pkg.occurrenceId) !== -1;
          if (reachedSlotCheck) {
            var slotId = M('planRunBuildActiveSlotId')(pkg.ownerUid, runSnap.data.planTemplateId);
            slotSnap = await tx.get(colPath(pkg.ownerUid, 'activeSlot', slotId));
            slotValid = slotSnap.exists && M('planRunSlotDocValid')(slotSnap.data);
            slotIdentityOk = slotValid && M('planRunSlotIdentityOk')(slotSnap.data, pkg.ownerUid, runSnap.data.planTemplateId);
            slotActivePlanRunId = slotIdentityOk ? slotSnap.data.activePlanRunId : null;
          }

          var decision = M('planRunClassifyMarkInProgressRequest')({
            runExists: runExists, occExists: occExists, runValid: runValid, occValid: occValid,
            runIdentityOk: runIdentityOk, occIdentityOk: occIdentityOk, occurrenceRunMatch: occurrenceRunMatch,
            runStatus: runValid ? runSnap.data.status : null,
            occurrenceInRemaining: (runValid && occValid) ? runSnap.data.remainingOccurrenceIds.indexOf(pkg.occurrenceId) !== -1 : false,
            occurrenceStatus: occValid ? occSnap.data.status : null,
            slotExists: slotSnap ? slotSnap.exists : false, slotValid: slotValid, slotIdentityOk: slotIdentityOk,
            slotActivePlanRunId: slotActivePlanRunId, thisRunId: pkg.planRunId
          });

          if (decision.outcome === 'alreadyInProgress') return { outcome: 'alreadyInProgress' };
          if (decision.outcome !== 'eligible') return decision; // zero-write: requiredDocumentMissing/documentMalformed/crossDocumentBindingMismatch/integrityConflict

          // ROUND 13 IMPLEMENTATION ADDITION (program-run-authoritative-end-
          // recovery-specification-round12.md SS7, carried from Round 1) --
          // the projected-state coordination check: a Mark-In-Progress
          // transition is denied while a valid, pending End coordination
          // document blocks it, exactly mirroring the rules-layer
          // planRunOccurrenceMarkInProgressCoordinationOk. Read only once
          // every cheaper check has already passed (the existing "eligible"
          // classification above) -- one additional tx.get(), never on a
          // request that was already going to be refused for another
          // reason. Preserves the existing idempotent alreadyInProgress
          // behavior above, unaffected: that branch returns before this
          // check is ever reached.
          var coordSnap = await tx.get(colPath(pkg.ownerUid, 'endCoordination', pkg.planRunId));
          if (coordSnap.exists && coordSnap.data.phase === 'pending') {
            return { outcome: 'integrityConflict', reason: 'pendingEndCoordinationBlocksMarkInProgress' };
          }

          var now = deps.timestamp();
          tx.update(occPath, { status: 'inProgress', updatedAt: now });
          return { outcome: 'committed' };
        });
      } catch (err) { throw classifyRunTransactionFailure(err); }
    }

    // =========================================================================
    // ROUND 13 IMPLEMENTATION ADDITION -- ABANDON OCCURRENCE (program-run-
    // authoritative-end-recovery-specification-round12.md SS6.5b, fully
    // specified since Round 3). The minimum-viable recovery for the Open-
    // Logger-race correction (SS6.5a): reverts one occurrence from
    // 'inProgress' back to 'pending' so a blocked Complete End can be
    // retried, scoped to unblocking one specific, named, currently-pending
    // End attempt -- never a general-purpose "revert any session" tool.
    // Read-validate-classify-transact, in this exact order, zero write on
    // any failure. Named `fsPlanRunAbandonOccurrence` -- fixed by this
    // specification since Round 3, unlike Begin's/Cancel's own names.
    // =========================================================================
    async function fsPlanRunAbandonOccurrence(pkg) {
      disabledGate();
      if (!M('planRunIsPlainObject')(pkg)) return { outcome: 'invalidInput', reason: 'malformedInput' };
      if (pkg.ownerUid !== deps.currentUid()) return { outcome: 'invalidInput', reason: 'ownerMismatch' };
      var v = M('planRunValidateAbandonOccurrencePackage')(pkg);
      if (!v.ok) return { outcome: 'invalidInput', reason: v.reason };
      var coordPath = colPath(pkg.ownerUid, 'endCoordination', pkg.planRunId);
      var runPath = colPath(pkg.ownerUid, 'runs', pkg.planRunId);
      var occPath = colPath(pkg.ownerUid, 'occurrences', pkg.occurrenceId);
      try {
        return await deps.transaction(async function (tx) {
          // Step 1 (SS6.5b(1)): coordination read, narrowest-safe-scope
          // binding -- refused, zero-write, unless a pending End
          // coordination record for THIS Run names THIS exact operationId.
          var coordSnap = await tx.get(coordPath);
          if (!coordSnap.exists || coordSnap.data.phase !== 'pending' || coordSnap.data.currentOperationId !== pkg.operationId) {
            return { outcome: 'integrityConflict', reason: 'noPendingCoordinationForOperation' };
          }

          // Step 2 (SS6.5b(2)): Run read -- mirrors Begin's own check.
          var runSnap = await tx.get(runPath);
          if (!runSnap.exists) return { outcome: 'requiredDocumentMissing', reason: 'runMissing' };
          if (!M('planRunDocValid')(runSnap.data) || !M('planRunActiveSlotIdOk')(runSnap.data)) return { outcome: 'documentMalformed', reason: 'runMalformed' };
          var runDoc = runSnap.data;
          if (!M('planRunDocIdentityOk')(runDoc, pkg.ownerUid, pkg.planRunId)) return { outcome: 'crossDocumentBindingMismatch', reason: 'runIdentity' };
          if (runDoc.status !== 'active') return { outcome: 'integrityConflict', reason: 'runNotActive' };

          // Step 3 (SS6.5b(3)): occurrence read and binding -- identity is
          // checked BEFORE status is ever inspected, so a wrong-Run or
          // foreign occurrence is rejected on identity grounds alone.
          var occSnap = await tx.get(occPath);
          if (!occSnap.exists) return { outcome: 'requiredDocumentMissing', reason: 'occurrenceMissing' };
          if (!M('planRunOccurrenceDocValid')(occSnap.data)) return { outcome: 'documentMalformed', reason: 'occurrenceMalformed' };
          if (!M('planRunOccurrenceIdentityOk')(occSnap.data, pkg.ownerUid, pkg.planRunId, pkg.occurrenceId)) return { outcome: 'crossDocumentBindingMismatch', reason: 'occurrenceIdentity' };
          if (!M('planRunOccurrenceRunBindingOk')(occSnap.data, runDoc)) return { outcome: 'crossDocumentBindingMismatch', reason: 'occurrenceRunBindingMismatch' };

          // Step 4 (SS6.5b(4)): remaining-work check.
          if (runDoc.remainingOccurrenceIds.indexOf(pkg.occurrenceId) === -1) return { outcome: 'integrityConflict', reason: 'occurrenceNotInRemainingWork' };

          // Step 5 (SS6.5b(5)): status classification -- every real value.
          var status = occSnap.data.status;
          if (status === 'pending') return { outcome: 'alreadyPending' };
          if (status === 'completed' || status === 'skipped') return { outcome: 'integrityConflict', reason: 'occurrenceAlreadyTerminal' };
          if (status !== 'inProgress') return { outcome: 'integrityConflict', reason: 'unrecognizedOccurrenceStatus' };

          var now = deps.timestamp();
          tx.update(occPath, { status: 'pending', updatedAt: now });
          return { outcome: 'committed' };
        });
      } catch (err) { throw classifyRunTransactionFailure(err); }
    }

    // =========================================================================
    // FINISH (spec §10, §13's Finish table) -- the read+classify phase
    // (steps 1-8) is shared, byte-for-byte, between a genuine Finish attempt
    // and a read-only Check Status, per §13's own "Retry and Check Status
    // follow the identical ordering" requirement.
    // =========================================================================
    // ROUND 2 CORRECTION: `haveFullPackage` (default true) distinguishes a
    // genuine Finish/Retry call (which always carries the full original
    // `pkg.workout`, so its actual content can be independently hashed and
    // compared against a receipt's retained preparedPackageHash) from a
    // lighter, identity-only Check-Status call (section 3: `pkg` there is
    // only {operationId, ownerUid, planRunId, occurrenceId, workoutId} --
    // this function never touches pkg.workout for anything BUT the hash
    // comparison, so it works unchanged either way, it simply skips that one
    // comparison and marks the result accordingly).
    async function finishReadAndClassify(tx, pkg, haveFullPackage) {
      if (haveFullPackage === undefined) haveFullPackage = true;
      var receiptPath = colPath(pkg.ownerUid, 'operations', pkg.operationId);
      var runPath = colPath(pkg.ownerUid, 'runs', pkg.planRunId);
      var occPath = colPath(pkg.ownerUid, 'occurrences', pkg.occurrenceId);
      var receiptSnap = await tx.get(receiptPath);
      var runSnap = await tx.get(runPath);
      var occSnap = await tx.get(occPath);

      if (!runSnap.exists || !occSnap.exists) {
        return { terminal: { outcome: 'requiredDocumentMissing', reason: !runSnap.exists ? 'runMissing' : 'occurrenceMissing' } };
      }
      // ROUND 5 CORRECTION (amendment Rounds 2+3): a Run document with a
      // mathematically-wrong activeSlotId is folded into the SAME
      // 'runMalformed' documentMalformed outcome this shared helper (used by
      // both fsPlanRunFinish and fsPlanRunCheckFinishStatus) already returns
      // for any other shape failure -- no new outcome/reason code.
      if (!M('planRunDocValid')(runSnap.data) || !M('planRunActiveSlotIdOk')(runSnap.data)) return { terminal: { outcome: 'documentMalformed', reason: 'runMalformed' } };
      if (!M('planRunOccurrenceDocValid')(occSnap.data)) return { terminal: { outcome: 'documentMalformed', reason: 'occurrenceMalformed' } };
      var runDoc = runSnap.data, occurrenceDoc = occSnap.data;
      if (runDoc.ownerUid !== pkg.ownerUid || runDoc.planRunId !== pkg.planRunId) return { terminal: { outcome: 'crossDocumentBindingMismatch', reason: 'runIdentity' } };
      if (!M('planRunOccurrenceIdentityOk')(occurrenceDoc, pkg.ownerUid, pkg.planRunId, pkg.occurrenceId)) return { terminal: { outcome: 'crossDocumentBindingMismatch', reason: 'occurrenceIdentity' } };
      // FOUNDATION SLICE RETROFIT (spec §3A.6.8) -- the shared cross-document
      // binding check (plan-run-model.js, first introduced for
      // fsPlanRunReadForDisplay) closes a real gap here: the prior inline
      // check below only ever compared planRunId, never
      // planTemplateId/headRevisionId/manifestId -- a corrupted or
      // substituted occurrence agreeing on planRunId alone could otherwise
      // pass. Reason literal renamed occurrenceRunMismatch ->
      // occurrenceRunBindingMismatch to match this shared helper's own
      // convention (mirrors the identical rename in
      // fsPlanRunMarkOccurrenceInProgress's own step 9.5 retrofit below).
      if (!M('planRunOccurrenceRunBindingOk')(occurrenceDoc, runDoc)) return { terminal: { outcome: 'crossDocumentBindingMismatch', reason: 'occurrenceRunBindingMismatch' } };

      var receiptFlag = null;
      if (receiptSnap.exists) {
        if (!M('planRunOperationDocValid')(receiptSnap.data)) return { terminal: { outcome: 'documentMalformed', reason: 'receiptMalformed' } };
        if (!M('planRunOperationIdentityOk')(receiptSnap.data, pkg.ownerUid, pkg.operationId, 'runFinish')) return { terminal: { outcome: 'crossDocumentBindingMismatch', reason: 'receiptIdentity' } };
        receiptFlag = {
          resultRefsWorkoutId: receiptSnap.data.resultRefs.workoutId,
          resultRefsOccurrenceId: receiptSnap.data.resultRefs.occurrenceId,
          resultRefsPlanRunId: receiptSnap.data.resultRefs.planRunId,
          preparedPackageHash: receiptSnap.data.preparedPackageHash,
          appliedRuleIds: receiptSnap.data.resultRefs.appliedRuleIds, needsManualReviewRuleIds: receiptSnap.data.resultRefs.needsManualReviewRuleIds
        };
      }

      // Step 4.
      var enabledRules = [];
      occurrenceDoc.assignments.forEach(function (a) { a.rules.forEach(function (r) { if (r.enabled) enabledRules.push({ ruleEntry: r, assignment: a }); }); });
      var expectedIds = enabledRules.map(function (x) { return x.ruleEntry.planRuleId; });

      // ROUND 2 CORRECTION (section 1): the enabled-Rule count used for the
      // budget check below is derived from the REAL, just-read, validated
      // occurrence document -- never from a caller-supplied count -- and is
      // checked BEFORE the per-Rule read loop that follows is ever issued,
      // so a corrupted/oversized occurrence document cannot cause unbounded
      // further reads (this budget check applies identically to a genuine
      // Finish attempt and to a Check-Status call, since both share this
      // exact code path -- there is no separate, bypassable "front door").
      var workoutBytesForBudget = haveFullPackage ? M('planRunEstimateDocBytes')(pkg.workout) : undefined;
      var budgetCheck = M('planRunCheckFinishBudget')(expectedIds.length, workoutBytesForBudget);
      if (!budgetCheck.ok) return { terminal: { outcome: 'budgetExceeded', reasons: budgetCheck.reasons } };

      var stateRaw = {}, requestedRecRaw = {};
      for (var i = 0; i < expectedIds.length; i++) {
        var rid = expectedIds[i];
        var sSnap = await tx.get(colPath(pkg.ownerUid, 'progressionState', M('planRunBuildRuleStateId')(pkg.planRunId, rid)));
        var rSnap = await tx.get(colPath(pkg.ownerUid, 'applications', M('planRunBuildApplicationId')(pkg.planRunId, rid, pkg.workoutId)));
        stateRaw[rid] = sSnap; requestedRecRaw[rid] = rSnap;
      }

      // Step 5.
      var matchingWorkoutRaw = null, differingWorkoutRaw = null, winningWorkoutId = null, winningRecRaw = null;
      if (occurrenceDoc.workoutId !== null && occurrenceDoc.workoutId === pkg.workoutId) {
        matchingWorkoutRaw = await tx.get(workoutPath(pkg.ownerUid, pkg.workoutId));
      } else if (occurrenceDoc.workoutId !== null) {
        winningWorkoutId = occurrenceDoc.workoutId;
        differingWorkoutRaw = await tx.get(workoutPath(pkg.ownerUid, winningWorkoutId));
        winningRecRaw = {};
        for (var j = 0; j < expectedIds.length; j++) {
          winningRecRaw[expectedIds[j]] = await tx.get(colPath(pkg.ownerUid, 'applications', M('planRunBuildApplicationId')(pkg.planRunId, expectedIds[j], winningWorkoutId)));
        }
      }

      // Step 6.
      var occurrenceInRemaining = runDoc.remainingOccurrenceIds.indexOf(pkg.occurrenceId) !== -1;
      var wouldBeLast = occurrenceInRemaining && runDoc.remainingOccurrenceIds.length === 1;
      // FOUNDATION SLICE ADDITION (spec §3A.6.9, generalized Rounds 6-8) --
      // slot-state corroboration for a Retry/Check-Status call reached
      // AFTER the occurrence has already been finished, in either
      // direction: the Run has gone terminal (needsTerminalSlotCorroboration)
      // or the Run is still active and this occurrence already completed
      // (needsActiveSlotCorroboration). Exhaustively proven mutually
      // exclusive with `wouldBeLast` and with each other (both require
      // disjoint values of occurrenceDoc.status/runDoc.status), so at most
      // one slot read fires per call regardless of which trigger applies.
      var needsTerminalSlotCorroboration = runDoc.status === 'complete';
      var needsActiveSlotCorroboration = occurrenceDoc.status === 'completed' && runDoc.status === 'active';
      var slotSnap = null, slotPath = null;
      if (wouldBeLast || needsTerminalSlotCorroboration || needsActiveSlotCorroboration) {
        slotPath = colPath(pkg.ownerUid, 'activeSlot', M('planRunBuildActiveSlotId')(pkg.ownerUid, runDoc.planTemplateId));
        slotSnap = await tx.get(slotPath);
      }

      // FOUNDATION SLICE ADDITION (spec §3A.6.10.3) -- Finish collision
      // protection's own precisely-scoped read: fires ONLY when the
      // occurrence is still genuinely unfinished and remains in the Run's
      // own remainingOccurrenceIds -- the only case branch (h) can be
      // reached from, and the only case this read's own result could ever
      // affect. Mutually exclusive with every slot-read trigger above
      // (this one requires occurrenceDoc.status in {pending, inProgress};
      // every slot trigger requires occurrenceDoc.status === 'completed'
      // or is gated on the Run's own terminal status), so this transaction
      // issues at most one of {slot read, collision read} per call, never
      // both.
      var occurrenceUnfinishedInRemaining = (occurrenceDoc.status === 'pending' || occurrenceDoc.status === 'inProgress') &&
        occurrenceDoc.workoutId === null && occurrenceInRemaining;
      var requestedWorkoutRaw = null;
      if (occurrenceUnfinishedInRemaining) {
        requestedWorkoutRaw = await tx.get(workoutPath(pkg.ownerUid, pkg.workoutId));
      }

      // Step 7.
      var stateFlags = {}, requestedFlags = {}, winningFlags = {};
      expectedIds.forEach(function (rid) {
        stateFlags[rid] = classifyDocFlags(stateRaw[rid], M('planRunProgressionStateDocValid'), M('planRunStateIdentityOk'), [pkg.ownerUid, pkg.planRunId, rid]);
        requestedFlags[rid] = classifyDocFlags(requestedRecRaw[rid], M('planRunApplicationDocValid'), M('planRunApplicationIdentityOk'), [pkg.ownerUid, pkg.planRunId, rid, pkg.workoutId]);
        if (winningRecRaw) winningFlags[rid] = classifyDocFlags(winningRecRaw[rid], M('planRunApplicationDocValid'), M('planRunApplicationIdentityOk'), [pkg.ownerUid, pkg.planRunId, rid, winningWorkoutId]);
      });
      var boundaryOk = M('planRunFinishStructuralBoundaryOk')({
        expectedRuleIds: expectedIds, stateDocs: stateFlags, requestedRecordDocs: requestedFlags,
        winningWorkoutId: winningWorkoutId, winningRecordDocs: winningRecRaw ? winningFlags : null
      });
      if (!boundaryOk) return { terminal: { outcome: 'integrityConflict', reason: 'perRuleStructuralBoundary' } };

      // Step 8. FOUNDATION SLICE CORRECTION (spec §3A.6.7) -- a document
      // sitting at the requested/winning workout path is only genuine
      // Finish-time evidence when it is a genuine, completed canonical
      // workout: the added `completionState === 'sessionCompleted'`
      // conjunct closes the gap where a structurally-valid `historyOnly`
      // document at that exact path would otherwise pass `contextMatches`
      // exactly as readily as a real committed workout.
      var matchingWorkoutFlag = matchingWorkoutRaw ? { exists: matchingWorkoutRaw.exists, contextMatches: matchingWorkoutRaw.exists && matchingWorkoutRaw.data.completionState === 'sessionCompleted' && M('planRunWorkoutContextMatchesOccurrence')(matchingWorkoutRaw.data, occurrenceDoc) } : null;
      var differingWorkoutFlag = differingWorkoutRaw ? { exists: differingWorkoutRaw.exists, contextMatches: differingWorkoutRaw.exists && differingWorkoutRaw.data.completionState === 'sessionCompleted' && M('planRunWorkoutContextMatchesOccurrence')(differingWorkoutRaw.data, occurrenceDoc) } : null;

      // FOUNDATION SLICE ADDITION (spec §3A.6.9) -- terminal (Run complete)
      // and non-final/active (Run still active, occurrence already
      // completed) slot-state corroboration, via the one shared
      // planRunClassifySlotState classifier. Each *Ok flag defaults true
      // when its own precondition does not apply, so passing both into the
      // pure decision function below is safe even when neither trigger
      // fired this call (the ordinary case for a genuine first Finish).
      var terminalSlotFlag = null;
      if (needsTerminalSlotCorroboration) {
        var slotValidNowT = slotSnap.exists && M('planRunSlotDocValid')(slotSnap.data);
        var slotIdentityOkNowT = slotValidNowT && M('planRunSlotIdentityOk')(slotSnap.data, pkg.ownerUid, runDoc.planTemplateId);
        terminalSlotFlag = M('planRunClassifySlotState')({
          slotExists: slotSnap.exists, slotValid: slotValidNowT, slotIdentityOk: slotIdentityOkNowT,
          slotActivePlanRunId: slotIdentityOkNowT ? slotSnap.data.activePlanRunId : undefined,
          thisRunId: pkg.planRunId, expectation: 'released'
        });
      }
      var terminalSlotOk = !needsTerminalSlotCorroboration || !!(terminalSlotFlag && terminalSlotFlag.result === 'confirmed');
      var activeSlotFlag = null;
      if (needsActiveSlotCorroboration) {
        var slotValidNowA = slotSnap.exists && M('planRunSlotDocValid')(slotSnap.data);
        var slotIdentityOkNowA = slotValidNowA && M('planRunSlotIdentityOk')(slotSnap.data, pkg.ownerUid, runDoc.planTemplateId);
        activeSlotFlag = M('planRunClassifySlotState')({
          slotExists: slotSnap.exists, slotValid: slotValidNowA, slotIdentityOk: slotIdentityOkNowA,
          slotActivePlanRunId: slotIdentityOkNowA ? slotSnap.data.activePlanRunId : undefined,
          thisRunId: pkg.planRunId, expectation: 'active'
        });
      }
      var activeSlotOk = !needsActiveSlotCorroboration || !!(activeSlotFlag && activeSlotFlag.result === 'confirmed');

      // FOUNDATION SLICE ADDITION (spec §3A.6.10.2/§3A.6.10.4, Round 8
      // Findings 1+2) -- Finish collision classification via the shared
      // discriminator, direct (never M(...)) call to
      // planRunNormalizedWorkoutHashesEqual for the one case (a genuine
      // sessionCompleted collision) where byte content actually decides
      // the outcome. `haveFullPackage` guards the comparison: a
      // Check-Finish-Status caller never carries `pkg.workout` at all, so
      // it can never legitimately claim the colliding document is
      // byte-identical to a package it does not hold -- it is
      // conservatively classified `differingCompleted` instead.
      var requestedWorkoutCollision = null;
      if (requestedWorkoutRaw) {
        if (!requestedWorkoutRaw.exists) {
          requestedWorkoutCollision = { exists: false };
        } else {
          var disc = M('planRunClassifyWorkoutDiscriminator')(requestedWorkoutRaw.data);
          if (disc.category === 'legacy' || disc.category === 'malformed') {
            requestedWorkoutCollision = { exists: true, category: disc.category };
          } else if (disc.category === 'historyOnly') {
            requestedWorkoutCollision = { exists: true, category: 'historyOnly' };
          } else { // disc.category === 'sessionCompleted'
            var identical = haveFullPackage && planRunNormalizedWorkoutHashesEqual(requestedWorkoutRaw.data, pkg.workout); // direct call -- Finding 1, §3A.10.6
            requestedWorkoutCollision = { exists: true, category: identical ? 'identicalButUncorroborated' : 'differingCompleted' };
          }
        }
      }

      var decision = M('planRunClassifyFinishOccurrence')({
        requestedWorkoutId: pkg.workoutId, occurrenceId: pkg.occurrenceId, planRunId: pkg.planRunId,
        occurrenceStatus: occurrenceDoc.status, occurrenceWorkoutId: occurrenceDoc.workoutId, occurrenceInRemaining: occurrenceInRemaining,
        runStatus: runDoc.status, runEndedAtSet: runDoc.endedAt !== null, expectedRuleIds: expectedIds, receipt: receiptFlag,
        matchingWorkout: matchingWorkoutFlag, differingWorkout: differingWorkoutFlag,
        perRuleAtRequested: requestedFlags, perRuleAtOccurrenceWorkoutId: winningRecRaw ? winningFlags : {},
        haveFullPackage: haveFullPackage, actualPackageHash: haveFullPackage ? packageHash(pkg) : null,
        terminalSlotOk: terminalSlotOk, terminalSlotReason: terminalSlotFlag ? terminalSlotFlag.reason : null,
        activeSlotOk: activeSlotOk, activeSlotReason: activeSlotFlag ? activeSlotFlag.reason : null,
        requestedWorkoutCollision: requestedWorkoutCollision
      });

      return {
        decision: decision, runDoc: runDoc, occurrenceDoc: occurrenceDoc, enabledRules: enabledRules, expectedIds: expectedIds,
        stateRaw: stateRaw, requestedRecRaw: requestedRecRaw, runPath: runPath, occPath: occPath, receiptPath: receiptPath,
        slotSnap: slotSnap, slotPath: slotPath, wouldBeLast: wouldBeLast
      };
    }

    function mapFinishDecisionToPublicOutcome(decision) {
      if (decision.outcome === 'alreadyCommitted') return { outcome: 'alreadyCommitted', packageHashVerified: !!decision.packageHashVerified, resultRefs: decision.resultRefs };
      if (decision.outcome === 'occurrenceSkipped') return { outcome: 'occurrenceSkipped' };
      if (decision.outcome === 'competingOperationCorroborated') return { outcome: 'competingOperationCorroborated', winningWorkoutId: decision.winningWorkoutId };
      if (decision.outcome === 'confirmedAbsent') return { outcome: 'confirmedAbsent' };
      return { outcome: 'integrityConflict', reason: decision.reason, branch: decision.branch };
    }

    async function fsPlanRunPreflightFinish(pkg, expectedRuleCount) { return M('planRunPreflightFinish')(pkg, expectedRuleCount); }

    async function fsPlanRunFinish(pkg) {
      disabledGate();
      // ROUND 2 CORRECTION (section 3): shape guard before any property
      // access.
      if (!M('planRunIsPlainObject')(pkg)) return { outcome: 'invalidInput', reason: 'malformedInput' };
      if (pkg.ownerUid !== deps.currentUid()) return { outcome: 'invalidInput', reason: 'ownerMismatch' };
      var v = M('planRunValidateFinishPackage')(pkg);
      if (!v.ok) return { outcome: 'invalidInput', reason: v.reason };
      // ROUND 2 CORRECTION (section 1): the one budget check derivable from
      // the request alone (the workout document's own real byte size) runs
      // BEFORE any transaction is opened -- the enabled-Rule-count-dependent
      // half of the budget cannot be known yet (it depends on the real,
      // persisted occurrence document) and is checked inside
      // finishReadAndClassify, immediately after that document is read and
      // validated, before any further read is issued.
      var preflightBytesCheck = M('planRunCheckFinishBudget')(0, M('planRunEstimateDocBytes')(pkg.workout));
      if (preflightBytesCheck.reasons.indexOf('workoutDocumentTooLarge') !== -1) {
        return { outcome: 'invalidInput', reason: 'workoutDocumentTooLarge' };
      }
      try {
        return await deps.transaction(async function (tx) {
          var r = await finishReadAndClassify(tx, pkg, true);
          if (r.terminal) return r.terminal;
          if (r.decision.outcome !== 'confirmedAbsent') return mapFinishDecisionToPublicOutcome(r.decision);

          var runDoc = r.runDoc, occurrenceDoc = r.occurrenceDoc;
          // Step 9.
          if (runDoc.status !== 'active') return { outcome: 'integrityConflict', reason: 'terminalRunWithUnfinishedOccurrence' };
          // Step 10.
          if (!M('planRunWorkoutContextMatchesOccurrence')(pkg.workout, occurrenceDoc)) return { outcome: 'integrityConflict', reason: 'workoutContextMismatch' };
          // FOUNDATION SLICE ADDITION -- the amended shape's own
          // completionState discriminator now makes it structurally
          // possible for a caller to pass a `historyOnly`-flagged workout
          // (legitimate input to fsPlanRunSaveHistoryOnly, below) through
          // Finish instead. Rejected here, via the same integrity-failure
          // path used for a context mismatch immediately above -- without
          // this check, a `historyOnly` document would otherwise pass
          // every other Finish validation and illegitimately advance a
          // Run's own occurrence/progression state.
          if (pkg.workout.completionState !== 'sessionCompleted') return { outcome: 'integrityConflict', reason: 'workoutNotSessionCompleted' };

          // Step 11 -- pure computation only; nothing is written to `tx` yet.
          var now = deps.timestamp();
          var appliedIds = [], reviewedIds = [], stagedStateWrites = [], stagedRecordWrites = [];
          for (var k = 0; k < r.enabledRules.length; k++) {
            var ruleEntry = r.enabledRules[k].ruleEntry, assignment = r.enabledRules[k].assignment;
            var rid = ruleEntry.planRuleId;
            var stateData = r.stateRaw[rid].data;
            var reviewReason = null;
            if (stateData.planAssignmentId !== assignment.planAssignmentId || stateData.planTemplateId !== occurrenceDoc.planTemplateId || stateData.exerciseId !== assignment.exerciseId) {
              reviewReason = 'assignmentIdentityMismatch';
            } else if (stateData.ruleRevisionId !== ruleEntry.ruleRevisionId) {
              reviewReason = 'ruleChangedSinceState';
            } else if (stateData.currentValue.kind !== (ruleEntry.adjustmentType === 'addLoad' ? 'workingLoad' : 'trainingMax')) {
              reviewReason = 'adjustmentTypeChanged';
            }
            var evaluatedDecision = null;
            if (!reviewReason) {
              var triple = M('planRunBuildProgressionTriple')(ruleEntry, assignment, occurrenceDoc, pkg.workout, pkg.workoutId);
              var validation = M('planValidateProgressionEvaluationInput')(triple.rule, triple.evidence, triple.basis);
              if (!validation.ok) { reviewReason = 'notEvaluable'; }
              else {
                var evaluated = M('planEvaluateCanonicalProgression')(triple.rule, stateData.currentValue, triple.evidence, triple.basis);
                if (evaluated.decision === 'notEvaluable') reviewReason = 'notEvaluable'; else evaluatedDecision = evaluated;
              }
            }
            var statePath = colPath(pkg.ownerUid, 'progressionState', M('planRunBuildRuleStateId')(pkg.planRunId, rid));
            var recPath = colPath(pkg.ownerUid, 'applications', M('planRunBuildApplicationId')(pkg.planRunId, rid, pkg.workoutId));
            if (reviewReason) {
              stagedStateWrites.push({ path: statePath, data: { status: 'needsManualReview', needsManualReviewReason: reviewReason, lastProcessedWorkoutId: pkg.workoutId, lastEvaluatedAt: now, updatedAt: now } });
              stagedRecordWrites.push({ path: recPath, data: { ownerUid: pkg.ownerUid, planRunId: pkg.planRunId, planRuleId: rid, workoutId: pkg.workoutId, outcome: 'reviewed', decision: null, reviewReason: reviewReason, recordedAt: now } });
              reviewedIds.push(rid);
            } else {
              stagedStateWrites.push({ path: statePath, data: { currentValue: evaluatedDecision.nextValue, status: 'active', needsManualReviewReason: null, lastProcessedWorkoutId: pkg.workoutId, lastEvaluatedAt: now, updatedAt: now } });
              stagedRecordWrites.push({ path: recPath, data: { ownerUid: pkg.ownerUid, planRunId: pkg.planRunId, planRuleId: rid, workoutId: pkg.workoutId, outcome: 'applied', decision: evaluatedDecision.decision, reviewReason: null, recordedAt: now } });
              appliedIds.push(rid);
            }
          }

          // Step 12.
          if (!M('planRunOccurrenceEligibleForCompletion')(occurrenceDoc, pkg.workout)) return { outcome: 'notEligibleForCompletion' };

          // Step 13 -- resolve EVERY conditional (including the slot release
          // decision) before issuing a single tx.set/tx.update, so a
          // late-discovered conflict can never leave a partial write staged.
          var removal = M('planRunRemoveFromRemaining')(runDoc.remainingOccurrenceIds, pkg.occurrenceId);
          var runBecomesComplete = removal.remainingOccurrenceIds.length === 0;
          if (runBecomesComplete) {
            var slotValidNow = r.slotSnap && r.slotSnap.exists && M('planRunSlotDocValid')(r.slotSnap.data) && M('planRunSlotIdentityOk')(r.slotSnap.data, pkg.ownerUid, runDoc.planTemplateId);
            var slotDecision = M('planRunSlotReleaseDecision')({ slotExists: !!(r.slotSnap && r.slotSnap.exists), slotValid: slotValidNow, slotActivePlanRunId: slotValidNow ? r.slotSnap.data.activePlanRunId : undefined, thisRunId: pkg.planRunId });
            if (slotDecision.result !== 'release') return { outcome: 'integrityConflict', reason: 'slotReleaseFailedAtLastOccurrence' };
          }

          // ROUND 2 CORRECTION (section 1): a final, freshly-computed write
          // recheck, derived from the ACTUAL staged-write arrays (never a
          // caller-supplied count), immediately before any write is issued.
          var actualWriteCount = 2 /* workout set + occurrence update */ + stagedStateWrites.length + stagedRecordWrites.length + 1 /* run update */ + (runBecomesComplete ? 1 : 0) /* slot release */ + 1 /* receipt */;
          if (actualWriteCount > M('PLAN_RUN_SAFETY_CAPS').maxFinishTransactionWrites) {
            return { outcome: 'budgetExceeded', reasons: ['tooManyWrites'] };
          }

          var finalOccurrenceData = Object.assign({}, occurrenceDoc, { status: 'completed', workoutId: pkg.workoutId, completedAt: now, updatedAt: now });
          var runUpdate = { remainingOccurrenceIds: removal.remainingOccurrenceIds, nextOccurrenceId: removal.nextOccurrenceId, updatedAt: now };
          if (runBecomesComplete) { runUpdate.status = 'complete'; runUpdate.completedAt = now; }
          var finalRunData = Object.assign({}, runDoc, runUpdate);
          var resultRefs = { workoutId: pkg.workoutId, occurrenceId: pkg.occurrenceId, planRunId: pkg.planRunId, appliedRuleIds: appliedIds, needsManualReviewRuleIds: reviewedIds };
          var receiptData2 = { ownerUid: pkg.ownerUid, operationId: pkg.operationId, operationType: 'runFinish', preparedPackageHash: packageHash(pkg), outcome: 'committed', resultRefs: resultRefs, createdAt: now };

          // ROUND 3 CORRECTION (finding 3): the real, non-bypassable
          // final-document-size + aggregate-transaction-byte check. Each
          // `tx.update` target's staged byte entry is the REAL, FULL,
          // POST-MERGE document it leaves in place (the already-read,
          // already-validated existing document merged with the exact patch
          // about to be applied -- an `Object.assign({}, existing, patch)`,
          // mirroring the fake/real Firestore `update()` semantics this
          // codebase's own harness already models) -- never the bare patch
          // alone. This is precisely what catches an existing occurrence or
          // Run document already at/near its cap that a small Finish patch
          // would otherwise push over without ever being checked (the gap
          // this round closes; see plan-run-model.js's Section 9B header for
          // the full explanation).
          var stagedByteWrites = [
            { path: workoutPath(pkg.ownerUid, pkg.workoutId), kind: 'workout', data: pkg.workout },
            { path: r.occPath, kind: 'occurrence', data: finalOccurrenceData }
          ].concat(stagedStateWrites.map(function (w, idx) {
            var rid = r.expectedIds[idx];
            return { path: w.path, kind: 'progressionState', data: Object.assign({}, r.stateRaw[rid].data, w.data) };
          })).concat(stagedRecordWrites.map(function (w) {
            return { path: w.path, kind: 'application', data: w.data };
          })).concat([{ path: r.runPath, kind: 'run', data: finalRunData }]);
          if (runBecomesComplete) {
            stagedByteWrites.push({ path: r.slotPath, kind: 'activeSlot', data: Object.assign({}, r.slotSnap.data, { activePlanRunId: null, updatedAt: now }) });
          }
          stagedByteWrites.push({ path: r.receiptPath, kind: 'operation', data: receiptData2 });
          var byteBudget = M('planRunCheckStagedTransactionBytes')(stagedByteWrites);
          if (!byteBudget.ok) return { outcome: 'budgetExceeded', reasons: byteBudget.reasons };

          tx.set(workoutPath(pkg.ownerUid, pkg.workoutId), pkg.workout);
          tx.update(r.occPath, { status: 'completed', workoutId: pkg.workoutId, completedAt: now, updatedAt: now });
          stagedStateWrites.forEach(function (w) { tx.update(w.path, w.data); });
          stagedRecordWrites.forEach(function (w) { tx.set(w.path, w.data); });
          tx.update(r.runPath, runUpdate);
          if (runBecomesComplete) tx.update(r.slotPath, { activePlanRunId: null, updatedAt: now });
          tx.set(r.receiptPath, receiptData2);
          return { outcome: 'committed', resultRefs: resultRefs };
        });
      } catch (err) { throw classifyRunTransactionFailure(err); }
    }

    // ROUND 2 CORRECTION (section 3): this is now genuinely an
    // IDENTITY-ONLY status check -- its own minimal input contract is
    // {operationId, ownerUid, planRunId, occurrenceId, workoutId}, never the
    // entire original Finish package (a caller reconciling after a reload
    // typically does not still have the full prepared workout in hand, and
    // must not be required to). A caller that happens to still be holding
    // the full package (e.g. a same-session Retry that calls this before
    // fsPlanRunFinish) is not penalized -- extra fields are simply not read
    // -- but this function itself never treats `pkg.workout` as available,
    // and passes haveFullPackage:false into the shared read/classify path so
    // its result is honestly marked packageHashVerified:false rather than
    // ever claiming to have verified byte-identical package content it does
    // not have.
    async function fsPlanRunCheckFinishStatus(pkg) {
      disabledGate();
      if (!M('planRunIsPlainObject')(pkg)) return { outcome: 'invalidInput', reason: 'malformedInput' };
      var inputCheck = M('planRunValidateCheckFinishStatusInput')(pkg);
      if (!inputCheck.ok) return { outcome: 'invalidInput', reason: inputCheck.reason };
      if (pkg.ownerUid !== deps.currentUid()) return { outcome: 'invalidInput', reason: 'ownerMismatch' };
      try {
        return await deps.transaction(async function (tx) {
          var r = await finishReadAndClassify(tx, pkg, false);
          if (r.terminal) return r.terminal;
          return mapFinishDecisionToPublicOutcome(r.decision);
        });
      } catch (err) { throw classifyRunTransactionFailure(err); }
    }

    // =========================================================================
    // FOUNDATION SLICE ADDITION -- fsPlanRunSaveHistoryOnly (spec §3A.7,
    // final Round 8 pseudocode). The "Save without completing Session"
    // action's own backing write -- persists a canonical workout document
    // WITHOUT advancing the occurrence/Run/progression state Finish
    // advances. Exactly 5 input keys (no operationId -- this function
    // writes no operation receipt, unlike Start/Finish/End). Uses only
    // deps.currentUid()/deps.transaction() -- no deps.setDoc.
    // Read/write budget: at most 3 reads (Run, occurrence, existing-
    // workout-at-path) + 1 write; every rejection/conflict path is 0
    // writes.
    // =========================================================================
    async function fsPlanRunSaveHistoryOnly(pkg) {
      disabledGate();
      if (!M('planRunIsPlainObject')(pkg)) return { outcome: 'invalidInput', reason: 'malformedInput' };
      if (!M('planRunExactKeys')(pkg, ['ownerUid', 'planRunId', 'occurrenceId', 'workoutId', 'workout'])) return { outcome: 'invalidInput', reason: 'malformedPackageShape' };
      var idFields = ['ownerUid', 'planRunId', 'occurrenceId', 'workoutId'];
      if (idFields.some(function (k) { return !M('planRunIsId')(pkg[k]); })) return { outcome: 'invalidInput', reason: 'malformedPackageShape' };
      if (pkg.ownerUid !== deps.currentUid()) return { outcome: 'invalidInput', reason: 'ownerMismatch' };
      // Step 0 -- zero-I/O shape/owner/self-consistency validation, before
      // any read is issued.
      if (!M('planRunWorkoutDocValid')(pkg.workout)) return { outcome: 'invalidInput', reason: 'malformedWorkoutShape' };
      if (pkg.workout.completionState !== 'historyOnly') return { outcome: 'invalidInput', reason: 'workoutNotHistoryOnly' };
      if (pkg.workout.id !== pkg.workoutId || pkg.workout.ownerUid !== pkg.ownerUid ||
          pkg.workout.planRunId !== pkg.planRunId || pkg.workout.planOccurrenceId !== pkg.occurrenceId) {
        return { outcome: 'invalidInput', reason: 'workoutIdentityDisagreesWithRequest' };
      }
      var preflightBytesCheck = M('planRunCheckFinishBudget')(0, M('planRunEstimateDocBytes')(pkg.workout));
      if (preflightBytesCheck.reasons.indexOf('workoutDocumentTooLarge') !== -1) {
        return { outcome: 'invalidInput', reason: 'workoutDocumentTooLarge' };
      }

      var runPath = colPath(pkg.ownerUid, 'runs', pkg.planRunId);
      var occPath = colPath(pkg.ownerUid, 'occurrences', pkg.occurrenceId);
      try {
        return await deps.transaction(async function (tx) {
          // Steps 1-2 -- read Run and occurrence together, mirroring
          // fsPlanRunFinish's own read-both-together style (not the
          // early-exit style the Round-4-era read-only display functions
          // use).
          var runSnap = await tx.get(runPath);
          var occSnap = await tx.get(occPath);

          // Step 3 -- validate Run.
          if (!runSnap.exists) return { outcome: 'notFound', reason: 'runAbsent' };
          if (!M('planRunDocValid')(runSnap.data) || !M('planRunActiveSlotIdOk')(runSnap.data)) return { outcome: 'notFound', reason: 'runMalformed' };
          var runDoc = runSnap.data;
          if (runDoc.ownerUid !== pkg.ownerUid || runDoc.planRunId !== pkg.planRunId) return { outcome: 'notFound', reason: 'runForeign' };
          if (runDoc.status !== 'active') return { outcome: 'notFound', reason: 'runNotActive' };

          // Step 4 -- validate occurrence.
          if (!occSnap.exists) return { outcome: 'notFound', reason: 'occurrenceAbsent' };
          if (!M('planRunOccurrenceDocValid')(occSnap.data)) return { outcome: 'notFound', reason: 'occurrenceMalformed' };
          var occurrenceDoc = occSnap.data;
          if (!M('planRunOccurrenceIdentityOk')(occurrenceDoc, pkg.ownerUid, pkg.planRunId, pkg.occurrenceId)) return { outcome: 'notFound', reason: 'occurrenceForeign' };

          // Step 5 (Round 6 correction) -- cross-document binding via the
          // SAME shared helper finishReadAndClassify/fsPlanRunMarkOccurrenceInProgress
          // already use, not a re-derived inline check.
          if (!M('planRunOccurrenceRunBindingOk')(occurrenceDoc, runDoc)) return { outcome: 'integrityConflict', reason: 'occurrenceRunBindingMismatch' };

          // Step 6 -- occurrence state eligibility.
          if (occurrenceDoc.status === 'completed' || occurrenceDoc.status === 'skipped') return { outcome: 'illegal', reason: 'occurrenceTerminal' };
          if (runDoc.remainingOccurrenceIds.indexOf(pkg.occurrenceId) === -1) return { outcome: 'integrityConflict', reason: 'unfinishedOccurrenceAbsentFromRemaining' };

          // Step 7 -- canonical-context match, reusing the existing,
          // unmodified planRunWorkoutContextMatchesOccurrence.
          if (!M('planRunWorkoutContextMatchesOccurrence')(pkg.workout, occurrenceDoc)) return { outcome: 'integrityConflict', reason: 'workoutContextMismatch' };

          // Step 8 (Round 8, Findings 1+2) -- collision/idempotency
          // decision, via the shared discriminator, read 3
          // (tx.get(workoutPath(...))).
          var workoutPathHere = workoutPath(pkg.ownerUid, pkg.workoutId);
          var existingSnap = await tx.get(workoutPathHere);
          if (existingSnap.exists) {
            var disc = M('planRunClassifyWorkoutDiscriminator')(existingSnap.data);
            if (disc.category === 'legacy') return { outcome: 'integrityConflict', reason: 'collidesWithLegacyWorkout' };
            if (disc.category === 'malformed') return { outcome: 'integrityConflict', reason: 'collidesWithMalformedWorkout' };
            if (disc.category === 'sessionCompleted') return { outcome: 'integrityConflict', reason: 'collidesWithCompletedWorkout' };
            // disc.category === 'historyOnly' -- the only remaining
            // possibility, per the shared discriminator's own exhaustive
            // four-way category value.
            if (planRunNormalizedWorkoutHashesEqual(pkg.workout, existingSnap.data)) { // direct call -- Finding 1, §3A.10.6
              return { outcome: 'alreadyCommitted' };
            }
            return { outcome: 'integrityConflict', reason: 'collidesWithDifferingHistoryOnlyAttempt' };
          }

          // ROUND 3-style real, non-bypassable final-document-size +
          // aggregate-transaction-byte check, mirroring fsPlanRunFinish's
          // own established discipline, before the one write is issued.
          var byteBudget = M('planRunCheckStagedTransactionBytes')([{ path: workoutPathHere, kind: 'workout', data: pkg.workout }]);
          if (!byteBudget.ok) return { outcome: 'budgetExceeded', reasons: byteBudget.reasons };

          // Step 9 -- genuine first attempt only.
          tx.set(workoutPathHere, pkg.workout);
          return { outcome: 'committed' };
        });
      } catch (err) { throw classifyRunTransactionFailure(err); }
    }

    // =========================================================================
    // END (spec §12, §13's End table)
    // =========================================================================
    async function fsPlanRunPreflightEnd(pkg, remainingOccurrenceCount) { return M('planRunPreflightEnd')(pkg, remainingOccurrenceCount); }

    async function endReadAndClassify(tx, pkg) {
      var runPath = colPath(pkg.ownerUid, 'runs', pkg.planRunId);
      var receiptPath = colPath(pkg.ownerUid, 'operations', pkg.operationId);

      // ROUND 2 CORRECTION (section 2): read + validate the operation
      // receipt FIRST, before the Run document -- closes the same
      // operation-ID-reuse gap as Start (End also used to write its receipt
      // unconditionally, with no read of any pre-existing document at that
      // path first). End's own full package IS its minimal identity shape
      // ({operationId, ownerUid, planRunId} -- planRunValidateEndPackage's
      // own exact-key list), so haveFullPackage is always true here; there
      // is no "lighter" variant to distinguish for End.
      var receiptSnap = await tx.get(receiptPath);
      var receiptValid = receiptSnap.exists && M('planRunOperationDocValid')(receiptSnap.data);
      var receiptIdentityOk = receiptValid && M('planRunOperationIdentityOk')(receiptSnap.data, pkg.ownerUid, pkg.operationId, 'runEnd');
      var actualHash = packageHash(pkg);
      var receiptGuard = M('planRunClassifyOperationReceiptGuard')({
        receiptExists: receiptSnap.exists, receiptValid: receiptValid, receiptIdentityOk: receiptIdentityOk,
        receiptResultRefsPlanRunId: receiptIdentityOk ? receiptSnap.data.resultRefs.planRunId : null,
        requestedPlanRunId: pkg.planRunId, haveFullPackage: true, actualPackageHash: actualHash,
        receiptPreparedPackageHash: receiptValid ? receiptSnap.data.preparedPackageHash : null
      });
      if (receiptGuard.result === 'integrityConflict') return { terminal: { outcome: 'integrityConflict', reason: receiptGuard.reason } };

      var runSnap = await tx.get(runPath);
      if (!runSnap.exists) return { terminal: { outcome: 'requiredDocumentMissing', reason: 'runMissing' } };
      // ROUND 5 CORRECTION (amendment Rounds 2+3): same fold-in as
      // finishReadAndClassify -- this shared helper is used by both
      // fsPlanRunEnd and fsPlanRunCheckEndStatus.
      if (!M('planRunDocValid')(runSnap.data) || !M('planRunActiveSlotIdOk')(runSnap.data)) return { terminal: { outcome: 'documentMalformed', reason: 'runMalformed' } };
      var runDoc = runSnap.data;
      if (runDoc.ownerUid !== pkg.ownerUid || runDoc.planRunId !== pkg.planRunId) return { terminal: { outcome: 'crossDocumentBindingMismatch', reason: 'runIdentity' } };
      // ROUND 13 IMPLEMENTATION CORRECTION (program-run-authoritative-end-
      // recovery-specification-round12.md SS6.2/SS0) -- once Cancel exists,
      // a recognizedMatchingPackage receipt no longer proves the Run must
      // be 'ended': it may instead be a genuine CANCELLED receipt for this
      // exact End attempt, in which case the Run correctly remains
      // 'active' (Cancel never ends the Run). This must be branched on
      // BEFORE the existing committed-vs-Run-status contradiction check
      // below, which remains correct and unchanged for the committed case.
      if (receiptGuard.result === 'recognizedMatchingPackage' && receiptSnap.data.outcome === 'cancelled') {
        return { terminal: { outcome: 'alreadyCancelled', packageHashVerified: true } };
      }
      if (receiptGuard.result === 'recognizedMatchingPackage' && !(runDoc.status === 'ended' && runDoc.endedAt !== null)) {
        return { terminal: { outcome: 'integrityConflict', reason: 'receiptCommittedButRunContradicts' } };
      }
      if (runDoc.status === 'ended') {
        if (runDoc.endedAt === null) return { terminal: { outcome: 'integrityConflict', reason: 'endedWithoutEndedAt' } };
        // FOUNDATION SLICE ADDITION (spec §3A.6.11) -- End-status recovery
        // corroboration. The prior code returned `alreadyCommitted` here
        // purely on the Run's own already-terminal status, without ever
        // corroborating that the slot this Run's own End was supposed to
        // release was ACTUALLY released -- so a subsequent Retry/Check-
        // Status call after a genuine End never re-verified this, unlike
        // every other corroboration this specification performs. Reuses
        // the shared, generalized planRunClassifySlotState classifier
        // with expectation:'released' -- the identical semantics Finish's
        // own terminal-slot corroboration already applies.
        var slotIdE = M('planRunBuildActiveSlotId')(pkg.ownerUid, runDoc.planTemplateId);
        var slotPathE = colPath(pkg.ownerUid, 'activeSlot', slotIdE);
        var slotSnapE = await tx.get(slotPathE);
        var slotValidNowE = slotSnapE.exists && M('planRunSlotDocValid')(slotSnapE.data);
        var slotIdentityOkNowE = slotValidNowE && M('planRunSlotIdentityOk')(slotSnapE.data, pkg.ownerUid, runDoc.planTemplateId);
        var endSlotState = M('planRunClassifySlotState')({
          slotExists: slotSnapE.exists, slotValid: slotValidNowE, slotIdentityOk: slotIdentityOkNowE,
          slotActivePlanRunId: slotIdentityOkNowE ? slotSnapE.data.activePlanRunId : undefined,
          thisRunId: pkg.planRunId, expectation: 'released'
        });
        if (endSlotState.result !== 'confirmed') return { terminal: { outcome: 'integrityConflict', reason: endSlotState.reason } };
        return { terminal: { outcome: 'alreadyCommitted', packageHashVerified: receiptGuard.result === 'recognizedMatchingPackage' } };
      }
      if (runDoc.status === 'complete') return { terminal: { outcome: 'rejectedTerminalComplete' } };

      // ROUND 2 CORRECTION (section 1): the remaining-occurrence count used
      // for the budget check is the REAL, just-read Run document's own
      // remainingOccurrenceIds.length -- never a caller-supplied count --
      // and is checked here, before the slot read and before the per-
      // occurrence read loop that follows in fsPlanRunEnd, so an
      // oversized/corrupted Run cannot cause unbounded further reads. This
      // applies identically to a genuine End attempt and to a Check-Status
      // call, since both share this exact code path.
      var budgetCheck = M('planRunCheckEndBudget')(runDoc.remainingOccurrenceIds.length);
      if (!budgetCheck.ok) return { terminal: { outcome: 'budgetExceeded', reasons: budgetCheck.reasons } };

      var slotId = M('planRunBuildActiveSlotId')(pkg.ownerUid, runDoc.planTemplateId);
      var slotPath = colPath(pkg.ownerUid, 'activeSlot', slotId);
      var slotSnap = await tx.get(slotPath);
      var slotValid = slotSnap.exists && M('planRunSlotDocValid')(slotSnap.data) && M('planRunSlotIdentityOk')(slotSnap.data, pkg.ownerUid, runDoc.planTemplateId);
      var slotDecision = M('planRunSlotReleaseDecision')({ slotExists: slotSnap.exists, slotValid: slotValid, slotActivePlanRunId: slotValid ? slotSnap.data.activePlanRunId : undefined, thisRunId: pkg.planRunId });
      if (slotDecision.result !== 'release') return { terminal: { outcome: 'integrityConflict', reason: slotDecision.reason } };

      // ROUND 13 IMPLEMENTATION ADDITION (program-run-authoritative-end-
      // recovery-specification-round12.md SS6.2, carried from Round 1/2) --
      // the two-stage Begin/Complete coordination precondition. A genuine
      // Complete (or a Check-Status call reaching this exact non-terminal
      // point) may proceed only while a coordination document for this Run
      // exists, is still 'pending', and names THIS EXACT operationId as
      // current -- one additional tx.get(), reached only on this active,
      // not-yet-classified branch, exactly as the specification's own
      // application-level read formula counts it ("3 + N (existing) +
      // coordination(1)"). Zero-write, before the occurrence-read loop.
      var coordPath = colPath(pkg.ownerUid, 'endCoordination', pkg.planRunId);
      var coordSnap = await tx.get(coordPath);
      if (!coordSnap.exists || coordSnap.data.phase !== 'pending' || coordSnap.data.currentOperationId !== pkg.operationId) {
        return { terminal: { outcome: 'integrityConflict', reason: 'noPendingCoordinationForOperation' } };
      }
      return { runDoc: runDoc, runPath: runPath, slotPath: slotPath, slotData: slotSnap.data, receiptPath: receiptPath, actualHash: actualHash, coordPath: coordPath };
    }

    async function fsPlanRunEnd(pkg) {
      disabledGate();
      // ROUND 2 CORRECTION (section 3): shape guard before any property
      // access.
      if (!M('planRunIsPlainObject')(pkg)) return { outcome: 'invalidInput', reason: 'malformedInput' };
      if (pkg.ownerUid !== deps.currentUid()) return { outcome: 'invalidInput', reason: 'ownerMismatch' };
      var v = M('planRunValidateEndPackage')(pkg);
      if (!v.ok) return { outcome: 'invalidInput', reason: v.reason };
      try {
        return await deps.transaction(async function (tx) {
          var r = await endReadAndClassify(tx, pkg);
          if (r.terminal) return r.terminal;
          var runDoc = r.runDoc, remaining = runDoc.remainingOccurrenceIds;

          // Read + validate every remaining occurrence BEFORE any write.
          var occRefs = [];
          var occExistingData = {};
          for (var i = 0; i < remaining.length; i++) {
            var oPath = colPath(pkg.ownerUid, 'occurrences', remaining[i]);
            var oSnap = await tx.get(oPath);
            if (!oSnap.exists) return { outcome: 'requiredDocumentMissing', reason: 'occurrenceMissing' };
            if (!M('planRunOccurrenceDocValid')(oSnap.data)) return { outcome: 'documentMalformed', reason: 'occurrenceMalformed' };
            if (!M('planRunOccurrenceIdentityOk')(oSnap.data, pkg.ownerUid, pkg.planRunId, remaining[i])) return { outcome: 'crossDocumentBindingMismatch', reason: 'occurrenceIdentity' };
            if (oSnap.data.status !== 'pending' && oSnap.data.status !== 'inProgress') return { outcome: 'integrityConflict', reason: 'remainingOccurrenceAlreadyTerminal' };
            occRefs.push(oPath);
            occExistingData[oPath] = oSnap.data;
          }

          // ROUND 2 CORRECTION (section 1): final freshly-computed write
          // recheck from the ACTUAL occRefs array about to be written.
          var actualWriteCount = occRefs.length + 1 /* run */ + 1 /* slot */ + 1 /* receipt */;
          if (actualWriteCount > M('PLAN_RUN_SAFETY_CAPS').maxEndTransactionWrites) {
            return { outcome: 'budgetExceeded', reasons: ['tooManyWrites'] };
          }

          var now = deps.timestamp();
          var runUpdateData = { status: 'ended', endedAt: now, remainingOccurrenceIds: [], nextOccurrenceId: null, updatedAt: now };
          var resultRefs = { planRunId: pkg.planRunId, skippedOccurrenceIds: remaining };
          var receiptDataEnd = { ownerUid: pkg.ownerUid, operationId: pkg.operationId, operationType: 'runEnd', preparedPackageHash: r.actualHash, outcome: 'committed', resultRefs: resultRefs, createdAt: now };

          // ROUND 3 CORRECTION (finding 3): the real, non-bypassable
          // final-document-size + aggregate-transaction-byte check, run
          // against the ACTUAL staged write set -- every occurrence's real
          // FINAL document (its already-read existing data, merged with the
          // exact skip patch about to be applied -- never the bare patch
          // alone, so an occurrence document already at/near its cap from
          // an earlier Start is still caught here), the Run document's own
          // real final state, and the active-slot document's own real final
          // state.
          var stagedByteWrites = occRefs.map(function (p) {
            return { path: p, kind: 'occurrence', data: Object.assign({}, occExistingData[p], { status: 'skipped', workoutId: null, updatedAt: now }) };
          }).concat([
            { path: r.runPath, kind: 'run', data: Object.assign({}, runDoc, runUpdateData) },
            { path: r.slotPath, kind: 'activeSlot', data: Object.assign({}, r.slotData, { activePlanRunId: null, updatedAt: now }) },
            { path: r.receiptPath, kind: 'operation', data: receiptDataEnd }
          ]);
          var byteBudget = M('planRunCheckStagedTransactionBytes')(stagedByteWrites);
          if (!byteBudget.ok) return { outcome: 'budgetExceeded', reasons: byteBudget.reasons };

          occRefs.forEach(function (p) { tx.update(p, { status: 'skipped', workoutId: null, updatedAt: now }); });
          tx.update(r.runPath, runUpdateData);
          tx.update(r.slotPath, { activePlanRunId: null, updatedAt: now });
          tx.set(r.receiptPath, receiptDataEnd);
          // ROUND 13 IMPLEMENTATION ADDITION (spec SS6.2/SS6.3) -- resolve
          // the coordination document ATOMICALLY with the genuine commit,
          // by deletion (never left in a terminal "resting" phase). Reached
          // only here, on the genuine-commit branch -- coordination is
          // never touched on any rejection/historical path above.
          tx.delete(r.coordPath);
          return { outcome: 'committed', resultRefs: resultRefs };
        });
      } catch (err) { throw classifyRunTransactionFailure(err); }
    }

    async function fsPlanRunCheckEndStatus(pkg) {
      disabledGate();
      // ROUND 2 CORRECTION (section 3): shape + minimal-input validation
      // before any property access or I/O.
      if (!M('planRunIsPlainObject')(pkg)) return { outcome: 'invalidInput', reason: 'malformedInput' };
      var inputCheck = M('planRunValidateCheckEndStatusInput')(pkg);
      if (!inputCheck.ok) return { outcome: 'invalidInput', reason: inputCheck.reason };
      if (pkg.ownerUid !== deps.currentUid()) return { outcome: 'invalidInput', reason: 'ownerMismatch' };
      try {
        return await deps.transaction(async function (tx) {
          var r = await endReadAndClassify(tx, pkg);
          if (r.terminal) return r.terminal;
          return { outcome: 'confirmedAbsent' };
        });
      } catch (err) { throw classifyRunTransactionFailure(err); }
    }

    // =========================================================================
    // ROUND 13 IMPLEMENTATION ADDITION -- BEGIN END (program-run-
    // authoritative-end-recovery-specification-round12.md SS6.1, carried
    // from Round 1/2). A small, separate transaction, run BEFORE the real
    // End-commit, establishing the authoritative coordination document a
    // genuine Complete End (endReadAndClassify, above) now requires. Named
    // `fsPlanRunBeginEnd`, following this codebase's own `fsPlanRun<Verb>`
    // convention (Round 10's own §15.3 naming gap, resolved here; recorded
    // in the implementation report).
    // =========================================================================
    async function fsPlanRunBeginEnd(pkg) {
      disabledGate();
      if (!M('planRunIsPlainObject')(pkg)) return { outcome: 'invalidInput', reason: 'malformedInput' };
      if (pkg.ownerUid !== deps.currentUid()) return { outcome: 'invalidInput', reason: 'ownerMismatch' };
      var v = M('planRunValidateBeginEndPackage')(pkg);
      if (!v.ok) return { outcome: 'invalidInput', reason: v.reason };
      var runPath = colPath(pkg.ownerUid, 'runs', pkg.planRunId);
      var coordPath = colPath(pkg.ownerUid, 'endCoordination', pkg.planRunId);
      try {
        return await deps.transaction(async function (tx) {
          // Step 1 (spec SS6.1(1)): coordination read, cheapest-fail-first.
          // A DIFFERENT currentOperationId already pending is a competing
          // Begin -- refused, zero-write, before any Run/slot read.
          var coordSnap = await tx.get(coordPath);
          var isIdempotentRetry = coordSnap.exists && coordSnap.data.phase === 'pending' && coordSnap.data.currentOperationId === pkg.operationId;
          if (coordSnap.exists && coordSnap.data.phase === 'pending' && coordSnap.data.currentOperationId !== pkg.operationId) {
            return { outcome: 'competingOperationPending' };
          }

          // Step 2 (SS6.1(2)): Run binding.
          var runSnap = await tx.get(runPath);
          if (!runSnap.exists) return { outcome: 'requiredDocumentMissing', reason: 'runMissing' };
          if (!M('planRunDocValid')(runSnap.data) || !M('planRunActiveSlotIdOk')(runSnap.data)) return { outcome: 'documentMalformed', reason: 'runMalformed' };
          var runDoc = runSnap.data;
          if (!M('planRunDocIdentityOk')(runDoc, pkg.ownerUid, pkg.planRunId)) return { outcome: 'crossDocumentBindingMismatch', reason: 'runIdentity' };
          if (runDoc.status !== 'active') return { outcome: 'integrityConflict', reason: 'runNotActive' };

          // Step 3 (SS6.1(3)): slot binding -- proves this Run is the
          // legitimate current claimant, reusing the shared
          // planRunClassifySlotState classifier, expectation:'active'.
          var slotPath = colPath(pkg.ownerUid, 'activeSlot', runDoc.activeSlotId);
          var slotSnap = await tx.get(slotPath);
          var slotValid = slotSnap.exists && M('planRunSlotDocValid')(slotSnap.data);
          var slotIdentityOk = slotValid && M('planRunSlotIdentityOk')(slotSnap.data, pkg.ownerUid, runDoc.planTemplateId);
          var slotDecision = M('planRunClassifySlotState')({
            slotExists: slotSnap.exists, slotValid: slotValid, slotIdentityOk: slotIdentityOk,
            slotActivePlanRunId: slotIdentityOk ? slotSnap.data.activePlanRunId : undefined,
            thisRunId: pkg.planRunId, expectation: 'active'
          });
          if (slotDecision.result !== 'confirmed') return { outcome: 'integrityConflict', reason: slotDecision.reason };

          // Step 4 (SS6.1(4)): write, only if 1-3 all pass. An idempotent
          // retry (same operationId) re-validates Run/slot binding above
          // and, having passed, is a write-free no-op reporting the
          // existing pending state back to the caller.
          if (isIdempotentRetry) return { outcome: 'pending', beginAt: coordSnap.data.beginAt };
          var now = deps.timestamp();
          var coordData = { ownerUid: pkg.ownerUid, planRunId: pkg.planRunId, phase: 'pending', currentOperationId: pkg.operationId, beginAt: now, updatedAt: now };
          tx.set(coordPath, coordData);
          return { outcome: 'pending', beginAt: now };
        });
      } catch (err) { throw classifyRunTransactionFailure(err); }
    }

    // =========================================================================
    // ROUND 13 IMPLEMENTATION ADDITION -- CANCEL END (spec SS6.5, finalized
    // SS6.2a/SS6.5). Receipt-first, reusing the existing, unchanged
    // planRunClassifyOperationReceiptGuard exactly as End's own
    // endReadAndClassify does -- the guard itself never inspects `outcome`
    // (confirmed directly from source, spec SS0); the outcome-aware
    // branching happens here, in the caller, immediately after a
    // recognizedMatchingPackage result, exactly mirroring the identical
    // correction just made to endReadAndClassify above. Named
    // `fsPlanRunCancelEnd` (Round 10's own §15.3 naming gap, resolved here).
    // =========================================================================
    async function fsPlanRunCancelEnd(pkg) {
      disabledGate();
      if (!M('planRunIsPlainObject')(pkg)) return { outcome: 'invalidInput', reason: 'malformedInput' };
      if (pkg.ownerUid !== deps.currentUid()) return { outcome: 'invalidInput', reason: 'ownerMismatch' };
      var v = M('planRunValidateCancelEndPackage')(pkg);
      if (!v.ok) return { outcome: 'invalidInput', reason: v.reason };
      var receiptPath = colPath(pkg.ownerUid, 'operations', pkg.operationId);
      var coordPath = colPath(pkg.ownerUid, 'endCoordination', pkg.planRunId);
      try {
        return await deps.transaction(async function (tx) {
          var receiptSnap = await tx.get(receiptPath);
          var receiptValid = receiptSnap.exists && M('planRunOperationDocValid')(receiptSnap.data);
          var receiptIdentityOk = receiptValid && M('planRunOperationIdentityOk')(receiptSnap.data, pkg.ownerUid, pkg.operationId, 'runEnd');
          var actualHash = packageHash(pkg);
          var receiptGuard = M('planRunClassifyOperationReceiptGuard')({
            receiptExists: receiptSnap.exists, receiptValid: receiptValid, receiptIdentityOk: receiptIdentityOk,
            receiptResultRefsPlanRunId: receiptIdentityOk ? receiptSnap.data.resultRefs.planRunId : null,
            requestedPlanRunId: pkg.planRunId, haveFullPackage: true, actualPackageHash: actualHash,
            receiptPreparedPackageHash: receiptValid ? receiptSnap.data.preparedPackageHash : null
          });
          if (receiptGuard.result === 'integrityConflict') return { outcome: 'integrityConflict', reason: receiptGuard.reason };
          if (receiptGuard.result === 'recognizedMatchingPackage') {
            // Case 1 (spec SS6.5): Cancel retried after Cancel itself
            // already committed -- idempotent no-op, zero further writes.
            if (receiptSnap.data.outcome === 'cancelled') return { outcome: 'alreadyCancelled', packageHashVerified: true };
            // Case 2: Cancel attempted/retried after End Complete already
            // committed at this operationId -- informs the caller, zero
            // writes, never claims cancellation.
            return { outcome: 'alreadyCommitted', packageHashVerified: true, resultRefs: receiptSnap.data.resultRefs };
          }
          // Case 4: a malformed/mismatched receipt is already refused above
          // via receiptGuard.result === 'integrityConflict'. Reaching here
          // means receiptGuard.result === 'absent' -- neither operation has
          // committed yet (recognizedIdentityOnly is unreachable for Cancel,
          // since haveFullPackage is always true, exactly like End).
          var coordSnap = await tx.get(coordPath);
          if (!coordSnap.exists || coordSnap.data.phase !== 'pending' || coordSnap.data.currentOperationId !== pkg.operationId) {
            // Case 3 variant: this operationId is not (or no longer) the
            // Run's own current pending End -- infers neither cancellation
            // nor commitment.
            return { outcome: 'notCurrentlyPending', reason: 'noPendingCoordinationForOperation' };
          }
          // Case 3: neither operation has committed, and this operationId
          // is genuinely the Run's own current pending End -- proceed.
          var now = deps.timestamp();
          var resultRefs = { planRunId: pkg.planRunId, skippedOccurrenceIds: [] };
          var receiptData = { ownerUid: pkg.ownerUid, operationId: pkg.operationId, operationType: 'runEnd', preparedPackageHash: actualHash, outcome: 'cancelled', resultRefs: resultRefs, createdAt: now };
          tx.set(receiptPath, receiptData);
          tx.delete(coordPath);
          return { outcome: 'cancelled', resultRefs: resultRefs };
        });
      } catch (err) { throw classifyRunTransactionFailure(err); }
    }

    // =========================================================================
    // SLICE 1 ADDITION -- LIST ACTIVE RUNS (spec Round 3 §3A.2, corrected
    // Round 4 §3A.2 Finding 8: `unavailable` -- and any other thrown,
    // retryable SDK failure -- is THROWN via classifyRunTransactionFailure,
    // never returned as a domain outcome literal; this function's returned
    // outcome vocabulary is exactly 'ok' / 'integrityConflict' /
    // 'invalidCursor' / 'invalidInput'). Read-only: no `deps.transaction`,
    // `deps.updateDoc`, or any write-capable dependency method is called
    // anywhere in this function. Gated by disabledGate() first, matching
    // every other exported function in this file (including this file's own
    // pure read-status checks), per this file's own established convention.
    //
    // NOT YET IMPLEMENTED / OUT OF SCOPE THIS SLICE (disclosed in the
    // implementation report): `fsPlanRunResolveActiveSlot`. Its own Round 2
    // §3A.3 "Purpose" names only two use cases (a Start-eligibility advisory
    // check, and a "Go to Active Run" affordance on the PLAN editor) -- both
    // Start-adjacent, and Start itself is a firm exclusion of this slice.
    // =========================================================================
    async function fsPlanRunListActiveRuns(ownerUid, opts) {
      disabledGate();
      // Shape/owner validation first, zero I/O on any failure -- matching
      // every existing function's own ordering discipline. No dedicated
      // `planRunValidateListActiveRunsInput` pure validator exists in, or is
      // specified by, the traced round text for this function (unlike, e.g.,
      // `planRunValidateCheckEndStatusInput` above) -- this inline check is
      // this slice's own judgment call, disclosed in the report, following
      // the same shape-then-ownerUid ordering every other function uses.
      if (!M('planRunIsId')(ownerUid)) return { outcome: 'invalidInput', reason: 'malformedOwnerUid' };
      if (ownerUid !== deps.currentUid()) return { outcome: 'invalidInput', reason: 'ownerMismatch' };
      var o = opts || {};
      if (!M('planRunIsPlainObject')(o)) return { outcome: 'invalidInput', reason: 'malformedInput' };
      var cursorInput = (o.cursor === undefined) ? null : o.cursor;
      if (cursorInput !== null && typeof cursorInput !== 'string') {
        return { outcome: 'invalidInput', reason: 'malformedInput' };
      }

      // §3A.2.4: page size 20 -- an operational default, not an enforced
      // completeness cap (no accepted invariant bounds the total number of
      // concurrently active Runs across different Templates).
      var PAGE_SIZE = 20;

      // §3A.2.6: cursor validation and owner binding happen BEFORE any
      // Firestore I/O -- a malformed, wrong-version, or foreign-owner cursor
      // never reaches a real query.
      if (cursorInput !== null && deps.decodeCursor(cursorInput, ownerUid).invalid) {
        return { outcome: 'invalidCursor' };
      }

      var page;
      try {
        // §3A.2.2 (Round 4, corrected): exactly ONE call to
        // deps.queryActiveRunsPage per invocation that reaches this point --
        // one Firestore query operation (internally fetching at most
        // PAGE_SIZE+1 = 21 documents to detect a further page without a
        // second round trip), never up to 21 separate reads.
        page = await deps.queryActiveRunsPage(ownerUid, { limit: PAGE_SIZE, cursor: cursorInput });
      } catch (err) {
        throw classifyRunTransactionFailure(err);
      }

      var docValid = M('planRunDocValid');
      var slotOk = M('planRunActiveSlotIdOk');
      var clone = M('planRunDeepClone');
      var runs = [];
      for (var i = 0; i < page.docs.length; i++) {
        var data = page.docs[i].data;
        // §3A.2.1: fail-closed per page -- ANY single malformed or foreign
        // document anywhere in the fetched page fails the ENTIRE page as an
        // integrity conflict. No partial `runs` array is ever returned as if
        // it were complete, and no already-passing document from this same
        // page is included alongside the conflict outcome.
        if (!docValid(data) || !slotOk(data) || data.ownerUid !== ownerUid) {
          return { outcome: 'integrityConflict', reason: 'malformedOrForeignActiveRun' };
        }
        // No explicit "projected fields" list is specified for this
        // function's `runs` array (unlike §3A.3.4's explicit discussion for
        // `fsPlanRunReadForDisplay`) -- this slice's judgment call, disclosed
        // in the report, is to return the full validated Run document
        // (deep-cloned, never a live driver reference) rather than inventing
        // an undocumented trimmed projection.
        runs.push(clone(data));
      }

      return {
        outcome: 'ok',
        runs: runs,
        hasMore: !!page.hasMore,
        nextCursor: page.hasMore ? page.lastCursor : null
      };
    }

    // =========================================================================
    // SLICE 1 ADDITION -- READ FOR DISPLAY (spec Round 3 §3A.3, full 9-step
    // algorithm and 11-literal outcome enumeration; step 7 corrected Round 6
    // §3A.3.2 to call the shared `planRunOccurrenceRunBindingOk` helper
    // instead of an inline four-field OR-check -- confirmed by Round 6's own
    // direct re-inspection to be a pure refactor with no behavior change at
    // this call site). Read-only: exactly 2 `deps.getDoc` reads on every
    // reachable path except an input-validation failure (0 reads); never
    // writes. Gated by disabledGate() first.
    // =========================================================================
    async function fsPlanRunReadForDisplay(pkg) {
      disabledGate();
      // Step 1: validate input shape, mode, and ownerUid -- zero I/O on any
      // failure.
      if (!M('planRunIsPlainObject')(pkg)) return { outcome: 'invalidInput', reason: 'malformedInput' };
      var ownerUid = pkg.ownerUid, planRunId = pkg.planRunId, occurrenceId = pkg.occurrenceId, mode = pkg.mode;
      if (mode !== 'launch' && mode !== 'display') return { outcome: 'invalidInput', reason: 'invalidMode' };
      if (!M('planRunIsId')(ownerUid) || !M('planRunIsId')(planRunId) || !M('planRunIsId')(occurrenceId)) {
        return { outcome: 'invalidInput', reason: 'malformedInput' };
      }
      if (ownerUid !== deps.currentUid()) return { outcome: 'invalidInput', reason: 'ownerMismatch' };

      // Step 2: read the Run (read 1 of 2).
      var runRaw;
      try {
        runRaw = await deps.getDoc(colPath(ownerUid, 'runs', planRunId));
      } catch (err) { throw classifyRunTransactionFailure(err); }
      // Step 3.
      if (!runRaw.exists) return { outcome: 'runAbsent' };
      var run = runRaw.data;
      if (!M('planRunDocValid')(run) || !M('planRunActiveSlotIdOk')(run)) return { outcome: 'runMalformed' };
      if (run.ownerUid !== ownerUid || run.planRunId !== planRunId) return { outcome: 'runSelfIdentityMismatch' };
      // Step 4 (launch mode only).
      if (mode === 'launch' && run.status !== 'active') return { outcome: 'runNotActive' };

      // Step 5: only now, after the Run is fully validated, read the
      // occurrence (read 2 of 2).
      var occRaw;
      try {
        occRaw = await deps.getDoc(colPath(ownerUid, 'occurrences', occurrenceId));
      } catch (err) { throw classifyRunTransactionFailure(err); }
      // Step 6.
      if (!occRaw.exists) return { outcome: 'occurrenceAbsent' };
      var occurrence = occRaw.data;
      if (!M('planRunOccurrenceDocValid')(occurrence)) return { outcome: 'occurrenceMalformed' };
      if (occurrence.ownerUid !== ownerUid || occurrence.occurrenceId !== occurrenceId) {
        return { outcome: 'occurrenceSelfIdentityMismatch' };
      }
      // Step 7 (corrected Round 6 §3A.3.2): shared cross-document binding
      // helper, in place of the original inline four-field OR-check.
      if (!M('planRunOccurrenceRunBindingOk')(occurrence, run)) return { outcome: 'occurrenceRunBindingMismatch' };
      // Step 8 (launch mode only).
      if (mode === 'launch') {
        var notEligible = (occurrence.status === 'completed' || occurrence.status === 'skipped') ||
          run.remainingOccurrenceIds.indexOf(occurrenceId) === -1;
        if (notEligible) return { outcome: 'occurrenceNotEligible' };
      }

      // Step 9: §3A.3.4 -- identity fields the caller already supplied are
      // RETAINED (not stripped) in the returned run/occurrence objects; both
      // are deep-cloned, never a live driver reference.
      return {
        outcome: 'verified',
        run: M('planRunDeepClone')(run),
        occurrence: M('planRunDeepClone')(occurrence)
      };
    }

    return Object.freeze({
      fsPlanRunPreflightStart: fsPlanRunPreflightStart, fsPlanRunStart: fsPlanRunStart, fsPlanRunCheckStartStatus: fsPlanRunCheckStartStatus,
      fsPlanRunPreflightFinish: fsPlanRunPreflightFinish, fsPlanRunFinish: fsPlanRunFinish, fsPlanRunCheckFinishStatus: fsPlanRunCheckFinishStatus,
      fsPlanRunPreflightEnd: fsPlanRunPreflightEnd, fsPlanRunEnd: fsPlanRunEnd, fsPlanRunCheckEndStatus: fsPlanRunCheckEndStatus,
      // ROUND 13 IMPLEMENTATION additions -- authoritative End recovery:
      // Begin/Cancel coordination, and Abandon-Occurrence.
      fsPlanRunBeginEnd: fsPlanRunBeginEnd,
      fsPlanRunCancelEnd: fsPlanRunCancelEnd,
      fsPlanRunAbandonOccurrence: fsPlanRunAbandonOccurrence,
      // SLICE 1 additions -- read-only active-Run discovery/display.
      fsPlanRunListActiveRuns: fsPlanRunListActiveRuns,
      fsPlanRunReadForDisplay: fsPlanRunReadForDisplay,
      // SLICE 2 addition -- occurrence pending -> inProgress transition.
      fsPlanRunMarkOccurrenceInProgress: fsPlanRunMarkOccurrenceInProgress,
      // FOUNDATION SLICE addition (spec §3A.7) -- Save-without-completing.
      fsPlanRunSaveHistoryOnly: fsPlanRunSaveHistoryOnly,
      CanonicalPlanRunWriterDisabledError: CanonicalPlanRunWriterDisabledError,
      CanonicalPlanRunAuthorizationError: CanonicalPlanRunAuthorizationError,
      CanonicalPlanRunUnavailableError: CanonicalPlanRunUnavailableError,
      CanonicalPlanRunPersistenceError: CanonicalPlanRunPersistenceError,
      CanonicalPlanRunIntegrityError: CanonicalPlanRunIntegrityError
    });
  }

  function productionDeps() {
    var db = root.firebase && root.firebase.firestore ? root.firebase.firestore() : null;
    function ref(path) {
      var parts = path.split('/'), r = db.collection(parts[0]).doc(parts[1]);
      for (var i = 2; i < parts.length; i += 2) r = r.collection(parts[i]).doc(parts[i + 1]);
      return r;
    }
    return {
      currentUid: function () { return (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.uid) || null; },
      timestamp: function () { return root.firebase.firestore.Timestamp.now(); },
      transaction: function (fn) {
        return db.runTransaction(function (t) {
          return fn({
            get: async function (path) { var s = await t.get(ref(path)); return { exists: s.exists, data: s.exists ? s.data() : null }; },
            set: function (path, data) { t.set(ref(path), data); },
            update: function (path, data) { t.update(ref(path), data); },
            // ROUND 13 IMPLEMENTATION ADDITION -- coordination-document
            // resolution (Complete End, Cancel) is a delete, never an
            // update (spec SS6.3): the real Firestore transaction's own
            // native delete() is exposed here for the first time this
            // file's own transaction wrapper has ever needed it.
            delete: function (path) { t.delete(ref(path)); }
          });
        });
      },
      // SLICE 1 ADDITIONS -- spec Round 3 §3A.1.1/§3A.1.3, cursor redesign
      // Round 4 §3A.1.5. Standalone (non-transactional) read/query
      // capability, used only by the two new read-only functions above;
      // no existing function's own dependency usage changes.
      //
      // §3A.1.1: identical shape to the existing transactional `get`'s own
      // return value, reusing the same `ref(path)` helper this file already
      // defines, just calling the document's own non-transactional `.get()`.
      getDoc: async function (path) {
        var s = await ref(path).get();
        return { exists: s.exists, data: s.exists ? s.data() : null };
      },
      // §3A.1.3, cursor handling redesigned §3A.1.5 (Round 4, Finding 5):
      // deterministic (startedAt asc, planRunId asc) order; `.limit(limit+1)`
      // fetched internally, as ONE query operation, solely to compute
      // `hasMore` without a second round trip. `opts.cursor` reaching this
      // method has already been validated (non-invalid) by
      // `fsPlanRunListActiveRuns` itself before this is ever called -- an
      // invalid cursor here is an internal contract violation, not a normal
      // outcome, so it is a thrown persistence error rather than a silent
      // first-page fallback (which would misrepresent the requested page).
      queryActiveRunsPage: async function (ownerUid, opts) {
        var limit = opts.limit;
        var col = db.collection('users').doc(ownerUid).collection(M('PLAN_RUN_COLLECTIONS').runs);
        var q = col.where('status', '==', 'active').orderBy('startedAt', 'asc').orderBy('planRunId', 'asc');
        if (opts.cursor) {
          var decoded = M('planRunDecodePageCursor')(opts.cursor, ownerUid);
          if (decoded.invalid) {
            throw new CanonicalPlanRunPersistenceError('queryActiveRunsPage received an already-invalid cursor; the caller must validate via decodeCursor before calling this method.');
          }
          var startAfterTs = new root.firebase.firestore.Timestamp(decoded.startedAtSeconds, decoded.startedAtNanoseconds);
          q = q.startAfter(startAfterTs, decoded.planRunId);
        }
        var snap = await q.limit(limit + 1).get();
        var allDocs = snap.docs.map(function (d) { return { id: d.id, data: d.data() }; });
        var hasMore = allDocs.length > limit;
        var pageDocs = allDocs.slice(0, limit);
        var lastCursor = null;
        if (hasMore && pageDocs.length > 0) {
          var last = pageDocs[pageDocs.length - 1].data;
          lastCursor = M('planRunEncodePageCursor')({ ownerUid: ownerUid, startedAtTimestamp: last.startedAt, planRunId: last.planRunId });
        }
        return { docs: pageDocs, hasMore: hasMore, lastCursor: lastCursor };
      },
      // §3A.1.4, redesigned §3A.1.5 -- pure (no I/O), thin wrappers around
      // the plan-run-model.js-owned encode/decode functions, kept there per
      // this file's own established convention that pure decision/encoding
      // logic lives in the model file, never in this Firestore-facing layer.
      encodeCursor: function (fields) { return M('planRunEncodePageCursor')(fields); },
      decodeCursor: function (cursor, ownerUid) { return M('planRunDecodePageCursor')(cursor, ownerUid); }
    };
  }

  var surface = createRunPersistence(productionDeps(), CANONICAL_PLAN_RUN_CAPABILITY_ENABLED);
  root.fsPlanRunPersistence = surface;
  // SLICE 1 ADDITION -- expose the (hardcoded-false) capability flag itself
  // on the shared realm, read-only in effect (nothing outside this file
  // ever assigns to it), so app-plan-run-ui.js can gate its own rendering
  // without needing any write-capable access to this module's internals.
  root.CANONICAL_PLAN_RUN_CAPABILITY_ENABLED = CANONICAL_PLAN_RUN_CAPABILITY_ENABLED;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      CANONICAL_PLAN_RUN_CAPABILITY_ENABLED: CANONICAL_PLAN_RUN_CAPABILITY_ENABLED,
      createRunPersistence: createRunPersistence,
      classifyRunTransactionFailure: classifyRunTransactionFailure,
      CanonicalPlanRunWriterDisabledError: CanonicalPlanRunWriterDisabledError,
      CanonicalPlanRunAuthorizationError: CanonicalPlanRunAuthorizationError,
      CanonicalPlanRunUnavailableError: CanonicalPlanRunUnavailableError,
      CanonicalPlanRunPersistenceError: CanonicalPlanRunPersistenceError,
      CanonicalPlanRunIntegrityError: CanonicalPlanRunIntegrityError
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
