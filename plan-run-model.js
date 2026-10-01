// =============================================================================
// plan-run-model.js -- IRON LOG Canonical Program-Run Lifecycle, Round 8
// specification. PURE MODEL LAYER (zero I/O).
//
// STATUS: this file implements a narrowly scoped, NOT-YET-ACTIVATED
// persistence slice, submitted for independent review. It is never loaded by
// index.html and carries no browser-reachable capability of any kind -- see
// firebase-plan-run.js's header for the full non-authorization notice, which
// applies equally to this file.
//
// NAMING/STYLE CONVENTION (see the implementation report for the full
// justification): this codebase's existing pure canonical-model logic lives
// as plain top-level functions directly inside app-plan.js (no wrapper
// object, no IIFE) -- e.g. planEvaluateCanonicalProgression,
// planValidateProgressionEvaluationInput, planSha256Hex,
// planBuildCanonicalEncoding, all plain globals when loaded as a classic
// <script>. This file follows that SAME convention (plain top-level
// functions, a guarded `module.exports` block at the bottom, exactly
// matching app-plan.js's own export-guard shape) rather than the
// IIFE-with-`root`-attachment shape firebase-plan-progression.js uses --
// because this file, like app-plan.js's own pure functions, has no Firestore
// dependency of any kind and is deliberately kept parallel in style to the
// pure model it extends. The Firestore-FACING half of this slice
// (firebase-plan-run.js) instead follows firebase-plan-progression.js's own
// IIFE/`root`-attachment convention, because it plays the exact same role
// (owner-scoped Firestore transactions, dependency-injected) that file does.
//
// This file has NO dependency on Firestore, `firebase`, `window`, or any
// mutable global state. Every function here is a pure function of its
// arguments (the few that need the real app-plan.js hashing primitives
// accept them as an explicit, optional dependency-injection parameter, or
// fall back to the bare global identifier when this file is loaded after
// app-plan.js in the same realm -- mirroring firebase-plan-progression.js's
// own `typeof auth !== 'undefined'` idiom for exactly the same load-order
// reason: classic <script> tags cannot `require()`/`import` one another).
// =============================================================================
'use strict';

// ---- Collection names (spec Part 5). Verified not to collide with any name
// in the existing registry (see the implementation report's collision check).
var PLAN_RUN_COLLECTIONS = Object.freeze({
  runs: 'planProgramRuns',
  occurrences: 'planProgramRunOccurrences',
  progressionState: 'planProgramRunProgressionState',
  applications: 'planProgramRunApplications',
  activeSlot: 'planProgramRunActiveSlot',
  operations: 'planProgramRunOperations',
  // ROUND 13 IMPLEMENTATION ADDITION -- the authoritative End-recovery
  // coordination document collection (program-run-authoritative-end-
  // recovery-specification-round12.md SS6.4/SS8, carried from Round 1). One
  // document per Run, deterministically addressed by planRunId, deleted the
  // instant its End attempt resolves (committed or cancelled) -- see
  // firebase-plan-run.js's Begin/Cancel/Complete-End changes.
  endCoordination: 'planProgramRunEndCoordination'
});

// ---- Shared small vocabularies, mirrored byte-for-byte from the accepted
// firebase-plan-progression.js precedent (never a second, independently
// re-typed copy of the same four strings -- see the report).
var PLAN_RUN_REVIEW_REASONS = Object.freeze(['assignmentIdentityMismatch', 'ruleChangedSinceState', 'adjustmentTypeChanged', 'notEvaluable']);
var PLAN_RUN_VALUE_KINDS = Object.freeze(['workingLoad', 'trainingMax']);
var PLAN_RUN_VALUE_UNITS = Object.freeze(['lb', 'kg']);
var PLAN_RUN_STATUSES = Object.freeze(['active', 'complete', 'ended']);
var PLAN_RUN_OCCURRENCE_STATUSES = Object.freeze(['pending', 'inProgress', 'completed', 'skipped']);
var PLAN_RUN_OPERATION_TYPES = Object.freeze(['runStart', 'runFinish', 'runEnd']);

// ---- Field-key lists (exact-key validation -- spec Part 5, field-by-field).
// ROUND 5 CORRECTION (amendment Rounds 2+3, "activeSlotId" field addition) --
// 18th field, appended at the end so historical field-order expectations
// elsewhere (documentation, ordering-sensitive diffs) are minimally
// disturbed; exact-key validation below is order-independent regardless.
var PLAN_RUN_KEYS = Object.freeze([
  'recordType', 'schemaVersion', 'ownerUid', 'planRunId', 'planTemplateId',
  'headRevisionId', 'manifestId', 'graphHash', 'nameSnapshot', 'status',
  'totalOccurrenceCount', 'remainingOccurrenceIds', 'nextOccurrenceId',
  'startedAt', 'completedAt', 'endedAt', 'updatedAt', 'activeSlotId'
]);
var PLAN_RUN_OCCURRENCE_KEYS = Object.freeze([
  'ownerUid', 'planRunId', 'occurrenceId', 'planTemplateId', 'headRevisionId',
  'manifestId', 'planMicrocycleId', 'planSessionId', 'microcycleOrdinal',
  'sessionOrdinal', 'nameSnapshot', 'assignments', 'status', 'workoutId',
  'completedAt', 'updatedAt'
]);
var PLAN_RUN_STATE_KEYS = Object.freeze([
  'ownerUid', 'planRunId', 'planTemplateId', 'headRevisionId', 'planAssignmentId',
  'planRuleId', 'ruleRevisionId', 'exerciseId', 'currentValue', 'status',
  'needsManualReviewReason', 'initializationSource', 'lastProcessedWorkoutId',
  'lastEvaluatedAt', 'schemaVersion', 'createdAt', 'updatedAt'
]);
var PLAN_RUN_VALUE_KEYS = Object.freeze(['amount', 'kind', 'unit']);
var PLAN_RUN_APPLICATION_KEYS = Object.freeze(['ownerUid', 'planRunId', 'planRuleId', 'workoutId', 'outcome', 'decision', 'reviewReason', 'recordedAt']);
var PLAN_RUN_SLOT_KEYS = Object.freeze(['ownerUid', 'planTemplateId', 'activeSlotId', 'activePlanRunId', 'updatedAt']);
var PLAN_RUN_OPERATION_KEYS = Object.freeze(['ownerUid', 'operationId', 'operationType', 'preparedPackageHash', 'outcome', 'resultRefs', 'createdAt']);
var PLAN_RUN_RULE_ENTRY_KEYS = Object.freeze(['planRuleId', 'ruleRevisionId', 'adjustmentType', 'evaluationType', 'failBehavior', 'gatewaySetIndex', 'loadIncrease', 'tmIncrease', 'enabled']);
var PLAN_RUN_PRESCRIBED_KEYS = Object.freeze([
  'loadType', 'weight', 'percent', 'addedWeight', 'repsType', 'reps', 'minReps', 'maxReps',
  'effortType', 'rir', 'minRir', 'maxRir', 'timeType', 'seconds', 'minSeconds', 'maxSeconds', 'notes'
]);
var PLAN_RUN_PROGRESSION_PRESCRIBED_KEYS = Object.freeze(['maxReps', 'maxSeconds', 'minReps', 'minSeconds', 'reps', 'repsType', 'seconds', 'timeType']);
var PLAN_RUN_ORDERED_SET_KEYS = Object.freeze(['planSetId', 'prescribed']);
var PLAN_RUN_ASSIGNMENT_KEYS = Object.freeze(['planAssignmentId', 'planPrescriptionId', 'exerciseId', 'rules', 'orderedSets']);
// CANONICAL WORKOUT-SHAPE AMENDMENT (canonical-program-run-ui-logger-
// integration-specification-round8.md §3A.6, unchanged in substance since
// Round 4 §3A.6.2's own exhaustive, source-grounded trace of every real
// History/stats/export function reading appDb.workouts). Retires the prior,
// narrower 10-field shape this slice originally defined for itself -- the
// prior shape could satisfy this slice's own completion-eligibility/
// progression-evaluation contracts, but could not carry what the real,
// existing History UI/stats/export code actually reads, nor the
// recordKind/completionState discriminator §3A.9's History-immutability
// protections depend on. `PLAN_RUN_PERFORMED_KEYS`/`planRunWorkoutPerformedValid`
// (the prior shape's own nested {completed,reps,seconds,weight} sub-object)
// are retired along with it -- see the amended PLAN_RUN_WORKOUT_SET_KEYS
// below, which flattens those same four fields (renaming `seconds` to
// `time`, matching legacy/History's own field name exactly) directly onto
// the Set record instead of nesting them under a `performed` key.
var PLAN_RUN_WORKOUT_KEYS = Object.freeze([
  'id', 'ownerUid', 'planRunId', 'planOccurrenceId', 'planTemplateId', 'headRevisionId',
  'planMicrocycleId', 'planSessionId', 'recordKind', 'completionState', 'name', 'date',
  'duration', 'bodyweight', 'exercises', 'createdAt'
]);
var PLAN_RUN_WORKOUT_EXERCISE_KEYS = Object.freeze(['exerciseId', 'planAssignmentId', 'planPrescriptionId', 'sets', 'perfVideos']);
var PLAN_RUN_WORKOUT_SET_KEYS = Object.freeze(['planSetId', 'weight', 'reps', 'time', 'rpe', 'completed', 'isPR', 'isNew1RM']);

// =============================================================================
// SECTION 1 -- generic small predicates (mirrored, not re-derived, from the
// accepted firebase-plan-progression.js/app-plan.js precedent: same bounded
// non-empty path-safe identifier rule, same {seconds,nanoseconds} timestamp
// shape, same exact-own-keys check).
// =============================================================================
function planRunIsPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function planRunExactKeys(v, keys) {
  return planRunIsPlainObject(v) && Object.keys(v).sort().join('\n') === keys.slice().sort().join('\n');
}
function planRunIsId(v) {
  if (typeof v !== 'string' || v.length === 0 || v.length > 200) return false;
  if (v !== v.trim()) return false;
  if (/[\/\\\x00]/.test(v)) return false;
  if (v === '.' || v === '..') return false;
  if (v.indexOf('?') !== -1 || v.indexOf('#') !== -1) return false;
  var lv = v.toLowerCase();
  if (lv.indexOf('%2f') !== -1 || lv.indexOf('%5c') !== -1) return false;
  return true;
}
function planRunIsTimestamp(v) {
  return !!v && typeof v === 'object' && Number.isInteger(v.seconds) && Number.isInteger(v.nanoseconds) && v.nanoseconds >= 0 && v.nanoseconds < 1e9;
}
function planRunIsNullableId(v) { return v === null || planRunIsId(v); }
function planRunIsNullableTimestamp(v) { return v === null || planRunIsTimestamp(v); }
function planRunIsFiniteOrNull(v) { return v === null || (typeof v === 'number' && Number.isFinite(v)); }
// ROUND 3 CORRECTION (finding 2) -- a REQUIRED-measurement variant of the
// FiniteOrNull predicate above (mirrors app-plan.js's own
// planProgressionFiniteOrNull idiom minus the null-is-legal branch, never a
// newly invented numeric-validity rule): a value must be an actual `number`
// AND pass Number.isFinite -- this alone is what already correctly rejects
// undefined, null, strings, booleans, NaN, and +/-Infinity, since `typeof`
// narrows to the single legal primitive type before Number.isFinite is ever
// consulted. Used wherever a measurement is REQUIRED to be present (not
// merely "present or legitimately absent" the way FiniteOrNull's own null
// branch models an unprescribed/not-yet-recorded field elsewhere in this
// file).
function planRunIsFiniteNumber(v) { return typeof v === 'number' && Number.isFinite(v); }
function planRunIsBoolean(v) { return typeof v === 'boolean'; }
function planRunIsInteger(v) { return typeof v === 'number' && Number.isInteger(v); }
function planRunIsNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }
function planRunDeepClone(v) { return v === null || v === undefined ? v : JSON.parse(JSON.stringify(v)); }
function planRunArrayHasDuplicates(arr) {
  var seen = {};
  for (var i = 0; i < arr.length; i++) {
    if (Object.prototype.hasOwnProperty.call(seen, arr[i])) return true;
    seen[arr[i]] = true;
  }
  return false;
}

// ---- Portable UTF-8 byte estimator (private to this file, independently
// declared for the exact same classic-<script>-load-order reason
// firebase.js's own copy documents at firebase.js:538-560: this file cannot
// `require()`/`import` that one, and cross-checking an untrusted package's
// own claimed byte count against a second, independent measurement is
// stronger than trusting a single count). Mirrors the same codePointAt-based
// semantics: a genuine surrogate pair is counted once as its combined 4-byte
// astral code point; an isolated surrogate is counted as its own 3-byte unit
// (matching how a real UTF-8 encoder treats it), never mis-paired with an
// unrelated following character.
function planRunUtf8ByteLength(str) {
  var bytes = 0;
  for (var i = 0; i < str.length; i++) {
    var code = str.codePointAt(i);
    if (code > 0xFFFF) { bytes += 4; i += 1; }
    else if (code > 0x7FF) bytes += 3;
    else if (code > 0x7F) bytes += 2;
    else bytes += 1;
  }
  return bytes;
}
function planRunEstimateDocBytes(data) {
  try { return planRunUtf8ByteLength(JSON.stringify(data)); } catch (e) { return Infinity; }
}

// =============================================================================
// SECTION 2 -- deterministic ID builders (spec §5.2/§5.3/§5.4/§5.5). Each
// reuses the exact, already-accepted `planSha256Hex(planBuildCanonicalEncoding(...))`
// pair every manifest-chunk ID and the existing `applicationId(ruleId,
// workoutId)` precedent (firebase-plan-progression.js:66-70) already use --
// never a bespoke hash or a bare string-concatenation ID. `hashDeps` is an
// optional {sha256Hex, buildCanonicalEncoding} pair; when omitted, the bare
// globals of the same name are used (present after app-plan.js has loaded in
// the same realm -- true for every real and test load order this slice
// requires, per this file's own header note).
function planRunResolveHashDeps(hashDeps) {
  var sha = (hashDeps && hashDeps.sha256Hex) || (typeof planSha256Hex !== 'undefined' ? planSha256Hex : null);
  var enc = (hashDeps && hashDeps.buildCanonicalEncoding) || (typeof planBuildCanonicalEncoding !== 'undefined' ? planBuildCanonicalEncoding : null);
  if (typeof sha !== 'function' || typeof enc !== 'function') return null;
  return { sha256Hex: sha, buildCanonicalEncoding: enc };
}
function planRunBuildOccurrenceId(planRunId, planMicrocycleId, planSessionId, hashDeps) {
  var deps = planRunResolveHashDeps(hashDeps);
  if (!deps || !planRunIsId(planRunId) || !planRunIsId(planMicrocycleId) || !planRunIsId(planSessionId)) return null;
  return deps.sha256Hex(deps.buildCanonicalEncoding({ planRunId: planRunId, planMicrocycleId: planMicrocycleId, planSessionId: planSessionId }));
}
function planRunBuildRuleStateId(planRunId, planRuleId, hashDeps) {
  var deps = planRunResolveHashDeps(hashDeps);
  if (!deps || !planRunIsId(planRunId) || !planRunIsId(planRuleId)) return null;
  return deps.sha256Hex(deps.buildCanonicalEncoding({ planRunId: planRunId, planRuleId: planRuleId }));
}
function planRunBuildApplicationId(planRunId, planRuleId, workoutId, hashDeps) {
  var deps = planRunResolveHashDeps(hashDeps);
  if (!deps || !planRunIsId(planRunId) || !planRunIsId(planRuleId) || !planRunIsId(workoutId)) return null;
  return deps.sha256Hex(deps.buildCanonicalEncoding({ planRunId: planRunId, planRuleId: planRuleId, workoutId: workoutId }));
}
function planRunBuildActiveSlotId(ownerUid, planTemplateId, hashDeps) {
  var deps = planRunResolveHashDeps(hashDeps);
  if (!deps || !planRunIsId(ownerUid) || !planRunIsId(planTemplateId)) return null;
  return deps.sha256Hex(deps.buildCanonicalEncoding({ ownerUid: ownerUid, planTemplateId: planTemplateId }));
}

// =============================================================================
// SECTION 3 -- document validators (spec §5, field-by-field; step 3/§13's
// "schema and self-identity" checks). Each `*Valid` function checks ONLY a
// document's own internal shape (never what it was expected to be at a given
// path -- see the separate `*IdentityOk` functions in Section 4 for that,
// mirroring the accepted `stateValid`/`statePathIdentityOk` split in
// firebase-plan-progression.js).
// =============================================================================
function planRunCurrentValueValid(v) {
  if (!planRunExactKeys(v, PLAN_RUN_VALUE_KEYS)) return false;
  if (!PLAN_RUN_VALUE_KINDS.includes(v.kind)) return false;
  if (typeof v.amount !== 'number' || !Number.isFinite(v.amount)) return false;
  if (!PLAN_RUN_VALUE_UNITS.includes(v.unit)) return false;
  return true;
}

function planRunPrescribedValid(v) {
  if (!planRunExactKeys(v, PLAN_RUN_PRESCRIBED_KEYS)) return false;
  if (typeof v.repsType !== 'string' || typeof v.timeType !== 'string') return false;
  if (typeof v.loadType !== 'string' || typeof v.effortType !== 'string') return false;
  if (v.notes !== null && typeof v.notes !== 'string') return false;
  var numericFields = ['weight', 'percent', 'addedWeight', 'reps', 'minReps', 'maxReps', 'rir', 'minRir', 'maxRir', 'seconds', 'minSeconds', 'maxSeconds'];
  for (var i = 0; i < numericFields.length; i++) if (!planRunIsFiniteOrNull(v[numericFields[i]])) return false;
  return true;
}

function planRunRuleEntryValid(v) {
  if (!planRunExactKeys(v, PLAN_RUN_RULE_ENTRY_KEYS)) return false;
  if (!planRunIsId(v.planRuleId) || !planRunIsId(v.ruleRevisionId)) return false;
  if (!['addLoad', 'increaseTM'].includes(v.adjustmentType)) return false;
  if (!['strict', 'volume', 'gateway'].includes(v.evaluationType)) return false;
  if (v.failBehavior !== 'repeat') return false;
  if (!planRunIsInteger(v.gatewaySetIndex) || v.gatewaySetIndex < 0) return false;
  if (typeof v.loadIncrease !== 'number' || !Number.isFinite(v.loadIncrease)) return false;
  if (typeof v.tmIncrease !== 'number' || !Number.isFinite(v.tmIncrease)) return false;
  if (!planRunIsBoolean(v.enabled)) return false;
  return true;
}

function planRunOrderedSetValid(v) {
  if (!planRunExactKeys(v, PLAN_RUN_ORDERED_SET_KEYS)) return false;
  if (!planRunIsId(v.planSetId)) return false;
  return planRunPrescribedValid(v.prescribed);
}

// Spec §10 step 3's "nested structure" check: every entry has the required
// fields, `enabled` is a boolean, no duplicate `planRuleId` -- checked
// independently of, and BEFORE, anything derives the expected Rule set from
// this array (invariant 27). Duplicate-`planRuleId` is checked across the
// WHOLE occurrence (every assignment's `rules[]` combined), not per
// assignment alone: a `planRuleId` is a globally stable canonical Rule
// identity within one Template (spec §3.2), so the same id legitimately
// naming two different Rule slots on one occurrence is never a real,
// supported case -- an implementation judgment call, flagged in the report,
// since the specification itself does not spell out the scope of "within
// the array" precisely enough to settle per-assignment vs. whole-occurrence
// on its own text alone.
function planRunAssignmentsRulesStructureValid(assignments) {
  if (!Array.isArray(assignments)) return false;
  var allRuleIds = [];
  for (var i = 0; i < assignments.length; i++) {
    var a = assignments[i];
    if (!planRunExactKeys(a, PLAN_RUN_ASSIGNMENT_KEYS)) return false;
    if (!planRunIsId(a.planAssignmentId) || !planRunIsId(a.planPrescriptionId) || !planRunIsId(a.exerciseId)) return false;
    if (!Array.isArray(a.rules) || !Array.isArray(a.orderedSets) || a.orderedSets.length === 0) return false;
    for (var r = 0; r < a.rules.length; r++) {
      if (!planRunRuleEntryValid(a.rules[r])) return false;
      allRuleIds.push(a.rules[r].planRuleId);
    }
    var seenSets = {};
    for (var s = 0; s < a.orderedSets.length; s++) {
      if (!planRunOrderedSetValid(a.orderedSets[s])) return false;
      if (Object.prototype.hasOwnProperty.call(seenSets, a.orderedSets[s].planSetId)) return false;
      seenSets[a.orderedSets[s].planSetId] = true;
    }
  }
  if (planRunArrayHasDuplicates(allRuleIds)) return false;
  return true;
}

// Full occurrence-document schema check (spec §5.2), INCLUDING the nested
// assignments/rules structure above -- used wherever a document's complete
// self-validity (not just its top-level shape) must be confirmed before any
// field of it is trusted (invariant 27). A caller that specifically needs to
// prove "the nested-structure check runs, and zero further reads are issued,
// even when only the nested array is broken" (§14 item 1's own required
// test) should call planRunAssignmentsRulesStructureValid directly on an
// otherwise-valid document, exactly as this function itself does internally.
function planRunOccurrenceDocValid(v) {
  if (!planRunExactKeys(v, PLAN_RUN_OCCURRENCE_KEYS)) return false;
  if (!planRunIsId(v.ownerUid) || !planRunIsId(v.planRunId) || !planRunIsId(v.occurrenceId)) return false;
  if (!planRunIsId(v.planTemplateId) || !planRunIsId(v.headRevisionId) || !planRunIsId(v.manifestId)) return false;
  if (!planRunIsId(v.planMicrocycleId) || !planRunIsId(v.planSessionId)) return false;
  if (!planRunIsInteger(v.microcycleOrdinal) || v.microcycleOrdinal < 0) return false;
  if (!planRunIsInteger(v.sessionOrdinal) || v.sessionOrdinal < 0) return false;
  if (!planRunIsPlainObject(v.nameSnapshot)) return false;
  if (!planRunAssignmentsRulesStructureValid(v.assignments) || v.assignments.length === 0) return false;
  if (!PLAN_RUN_OCCURRENCE_STATUSES.includes(v.status)) return false;
  if (!planRunIsNullableId(v.workoutId)) return false;
  if (!planRunIsNullableTimestamp(v.completedAt)) return false;
  if (!planRunIsTimestamp(v.updatedAt)) return false;
  return true;
}

function planRunDocValid(v) {
  if (!planRunExactKeys(v, PLAN_RUN_KEYS)) return false;
  if (v.recordType !== 'planProgramRun' || v.schemaVersion !== 1) return false;
  if (!planRunIsId(v.ownerUid) || !planRunIsId(v.planRunId) || !planRunIsId(v.planTemplateId)) return false;
  if (!planRunIsId(v.headRevisionId) || !planRunIsId(v.manifestId) || !planRunIsId(v.graphHash)) return false;
  // ROUND 5 CORRECTION (amendment Rounds 2+3) -- activeSlotId is required and
  // must be a legal id; its ARITHMETIC correctness (is it actually the right
  // hash of this Run's own ownerUid+planTemplateId) is a separate, deeper
  // check performed by planRunActiveSlotIdOk (Section 4-adjacent below),
  // mirroring the existing shape-vs-identity split already used throughout
  // this file (*DocValid checks shape only; *IdentityOk/*Ok checks the deeper
  // cross-value property). Shape-only here matches how every other id field
  // in this same function is checked.
  if (!planRunIsId(v.activeSlotId)) return false;
  if (typeof v.nameSnapshot !== 'string') return false;
  if (!PLAN_RUN_STATUSES.includes(v.status)) return false;
  if (!planRunIsInteger(v.totalOccurrenceCount) || v.totalOccurrenceCount < 1) return false;
  if (!Array.isArray(v.remainingOccurrenceIds) || !v.remainingOccurrenceIds.every(planRunIsId)) return false;
  if (planRunArrayHasDuplicates(v.remainingOccurrenceIds)) return false;
  if (v.remainingOccurrenceIds.length > v.totalOccurrenceCount) return false;
  if (v.nextOccurrenceId !== null && !planRunIsId(v.nextOccurrenceId)) return false;
  if (v.nextOccurrenceId !== (v.remainingOccurrenceIds.length ? v.remainingOccurrenceIds[0] : null)) return false;
  if (!planRunIsTimestamp(v.startedAt)) return false;
  if (!planRunIsNullableTimestamp(v.completedAt) || !planRunIsNullableTimestamp(v.endedAt)) return false;
  if (!planRunIsTimestamp(v.updatedAt)) return false;
  // Legal-status/field agreement (spec §5.1's transition table).
  if (v.status === 'active' && (v.completedAt !== null || v.endedAt !== null)) return false;
  if (v.status === 'complete' && (v.completedAt === null || v.endedAt !== null)) return false;
  if (v.status === 'ended' && (v.endedAt === null)) return false;
  if (v.status !== 'active' && v.remainingOccurrenceIds.length !== 0) return false;
  return true;
}

function planRunProgressionStateDocValid(v) {
  if (!planRunExactKeys(v, PLAN_RUN_STATE_KEYS)) return false;
  if (!planRunIsId(v.ownerUid) || !planRunIsId(v.planRunId) || !planRunIsId(v.planTemplateId)) return false;
  if (!planRunIsId(v.headRevisionId) || !planRunIsId(v.planAssignmentId) || !planRunIsId(v.planRuleId)) return false;
  if (!planRunIsId(v.ruleRevisionId) || !planRunIsId(v.exerciseId)) return false;
  if (!planRunCurrentValueValid(v.currentValue)) return false;
  if (!['active', 'needsManualReview'].includes(v.status)) return false;
  if (v.status === 'active' && v.needsManualReviewReason !== null) return false;
  if (v.status === 'needsManualReview' && !PLAN_RUN_REVIEW_REASONS.includes(v.needsManualReviewReason)) return false;
  if (!['manual', 'confirmedFromSuggestion'].includes(v.initializationSource)) return false;
  if (!planRunIsNullableId(v.lastProcessedWorkoutId)) return false;
  if (!planRunIsNullableTimestamp(v.lastEvaluatedAt)) return false;
  if (v.schemaVersion !== 1) return false;
  if (!planRunIsTimestamp(v.createdAt) || !planRunIsTimestamp(v.updatedAt)) return false;
  return true;
}

function planRunApplicationDocValid(v) {
  if (!planRunExactKeys(v, PLAN_RUN_APPLICATION_KEYS)) return false;
  if (!planRunIsId(v.ownerUid) || !planRunIsId(v.planRunId) || !planRunIsId(v.planRuleId) || !planRunIsId(v.workoutId)) return false;
  if (!['applied', 'reviewed'].includes(v.outcome)) return false;
  if (v.outcome === 'applied') {
    if (!['passed', 'failed'].includes(v.decision)) return false;
    if (v.reviewReason !== null) return false;
  } else {
    if (v.decision !== null) return false;
    if (!PLAN_RUN_REVIEW_REASONS.includes(v.reviewReason)) return false;
  }
  if (!planRunIsTimestamp(v.recordedAt)) return false;
  return true;
}

function planRunSlotDocValid(v) {
  if (!planRunExactKeys(v, PLAN_RUN_SLOT_KEYS)) return false;
  if (!planRunIsId(v.ownerUid) || !planRunIsId(v.planTemplateId) || !planRunIsId(v.activeSlotId)) return false;
  if (!planRunIsNullableId(v.activePlanRunId)) return false;
  if (!planRunIsTimestamp(v.updatedAt)) return false;
  return true;
}

function planRunOperationResultRefsValid(operationType, refs) {
  if (!planRunIsPlainObject(refs)) return false;
  if (operationType === 'runStart') {
    return planRunExactKeys(refs, ['planRunId']) && planRunIsId(refs.planRunId);
  }
  if (operationType === 'runFinish') {
    if (!planRunExactKeys(refs, ['workoutId', 'occurrenceId', 'planRunId', 'appliedRuleIds', 'needsManualReviewRuleIds'])) return false;
    if (!planRunIsId(refs.workoutId) || !planRunIsId(refs.occurrenceId) || !planRunIsId(refs.planRunId)) return false;
    if (!Array.isArray(refs.appliedRuleIds) || !refs.appliedRuleIds.every(planRunIsId)) return false;
    if (!Array.isArray(refs.needsManualReviewRuleIds) || !refs.needsManualReviewRuleIds.every(planRunIsId)) return false;
    if (planRunArrayHasDuplicates(refs.appliedRuleIds.concat(refs.needsManualReviewRuleIds))) return false;
    return true;
  }
  if (operationType === 'runEnd') {
    return planRunExactKeys(refs, ['planRunId', 'skippedOccurrenceIds']) && planRunIsId(refs.planRunId) &&
      Array.isArray(refs.skippedOccurrenceIds) && refs.skippedOccurrenceIds.every(planRunIsId);
  }
  return false;
}

// ROUND 13 IMPLEMENTATION ADDITION (program-run-authoritative-end-recovery-
// specification-round12.md SS6.2a) -- the operation-type/outcome
// compatibility invariant: 'runStart'/'runFinish' receipts are legal only
// with outcome 'committed'; 'runEnd' receipts may legally be 'committed' OR
// 'cancelled' (Cancel's own receipt, SS6.5) -- the one operation type that
// ever will be, since only End has a Cancel action defined anywhere in this
// specification. Any other/unknown operationType is already refused
// upstream by PLAN_RUN_OPERATION_TYPES.includes(...) before this is reached.
function planRunOperationOutcomeOk(operationType, outcome) {
  if (operationType === 'runEnd') return outcome === 'committed' || outcome === 'cancelled';
  return outcome === 'committed';
}

// ROUND 13 IMPLEMENTATION ADDITION (SS6.2a) -- the additional evidence
// distinguishing a legitimate cancelled receipt from an invalid one,
// expressed through the existing schema rather than a new field: a
// 'runEnd' receipt with outcome 'cancelled' must have an EMPTY
// resultRefs.skippedOccurrenceIds (Cancel never skips an occurrence). A
// 'committed' receipt (of any operationType) is unaffected -- its
// resultRefs are validated exactly as today by the unchanged
// planRunOperationResultRefsValid. Layered ON TOP OF that function, not
// inside it, per the specification's own explicit "no change to
// planRunOperationResultRefsValid" instruction.
function planRunOperationCancelledShapeOk(outcome, resultRefs) {
  if (outcome !== 'cancelled') return true;
  return planRunIsPlainObject(resultRefs) && Array.isArray(resultRefs.skippedOccurrenceIds) && resultRefs.skippedOccurrenceIds.length === 0;
}

function planRunOperationDocValid(v) {
  if (!planRunExactKeys(v, PLAN_RUN_OPERATION_KEYS)) return false;
  if (!planRunIsId(v.ownerUid) || !planRunIsId(v.operationId)) return false;
  if (!PLAN_RUN_OPERATION_TYPES.includes(v.operationType)) return false;
  if (!planRunIsId(v.preparedPackageHash)) return false;
  // ROUND 13 IMPLEMENTATION CORRECTION (SS6.2a) -- replaces the prior
  // hardcoded `if (v.outcome !== 'committed') return false;` with the two
  // outcome-aware helpers above. This is the ONLY clause in this function
  // touched by this round; every other clause, and
  // planRunOperationResultRefsValid itself, is unchanged.
  if (!planRunOperationOutcomeOk(v.operationType, v.outcome)) return false;
  if (!planRunOperationResultRefsValid(v.operationType, v.resultRefs)) return false;
  if (!planRunOperationCancelledShapeOk(v.outcome, v.resultRefs)) return false;
  if (!planRunIsTimestamp(v.createdAt)) return false;
  return true;
}

// =============================================================================
// SECTION 4 -- self-identity ("does this document at this path claim to be
// the document this exact request is about") checks. Mirrors the accepted
// `statePathIdentityOk`/`applicationRecordIdentityOk` precedent
// (firebase-plan-progression.js:78-90) directly.
// =============================================================================
function planRunOccurrenceIdentityOk(doc, ownerUid, planRunId, occurrenceId) {
  return doc.ownerUid === ownerUid && doc.planRunId === planRunId && doc.occurrenceId === occurrenceId;
}
function planRunDocIdentityOk(doc, ownerUid, planRunId) {
  return doc.ownerUid === ownerUid && doc.planRunId === planRunId;
}
function planRunStateIdentityOk(doc, ownerUid, planRunId, planRuleId) {
  return doc.ownerUid === ownerUid && doc.planRunId === planRunId && doc.planRuleId === planRuleId;
}
function planRunApplicationIdentityOk(doc, ownerUid, planRunId, planRuleId, workoutId) {
  return doc.ownerUid === ownerUid && doc.planRunId === planRunId && doc.planRuleId === planRuleId && doc.workoutId === workoutId;
}
function planRunSlotIdentityOk(doc, ownerUid, planTemplateId) {
  return doc.ownerUid === ownerUid && doc.planTemplateId === planTemplateId;
}
function planRunOperationIdentityOk(doc, ownerUid, operationId, operationType) {
  return doc.ownerUid === ownerUid && doc.operationId === operationId && doc.operationType === operationType;
}
// ROUND 5 CORRECTION (amendment Rounds 2+3) -- a Run document's own internal
// arithmetic check: is its declared `activeSlotId` actually the correct hash
// of THIS Run's own ownerUid+planTemplateId (the same deterministic builder
// every genuine Start already uses, per Section 2 above)? This mirrors the
// existing *IdentityOk pattern (a deeper cross-value property, not mere
// shape) but is named `*Ok` rather than `*IdentityOk` because it checks a
// document's own internal self-consistency, not its match against an
// externally supplied expectation -- matching the "self-identity" framing
// used elsewhere in this file's section comments. It says nothing about, and
// must never be made to check, the SEPARATE slot document's current
// claim state (see amendment Round 3, Section 1.5): a completed/ended Run's
// activeSlotId remains correct forever even after its slot is legitimately
// reassigned to a later Run.
function planRunActiveSlotIdOk(doc, hashDeps) {
  return doc.activeSlotId === planRunBuildActiveSlotId(doc.ownerUid, doc.planTemplateId, hashDeps);
}

// -----------------------------------------------------------------------------
// SLICE 1 ADDITION (active-Run discovery / read-only TRAIN navigation,
// `canonical-program-run-ui-logger-integration-specification-round8.md`,
// carrying forward the occurrence-to-Run binding design specified in full at
// Round 6 §3A.6.8.1 -- reproduced here exactly, not reinterpreted, since this
// is the first round in which the function is actually implemented rather
// than only proposed). A Run document and an occurrence document, each
// independently valid and each independently matching the caller's own
// supplied identity, can still disagree with EACH OTHER (e.g. a corrupted or
// substituted occurrence whose own `planTemplateId` doesn't match the Run it
// claims to belong to). This is the shared, reusable cross-document check for
// that condition, used by `fsPlanRunReadForDisplay` (this slice) exactly as
// specified.
//
// Unlike the `*IdentityOk` family above (which compares a document against
// CALLER-SUPPLIED scalar values), this compares two DOCUMENTS directly
// against each other, and defensively re-validates each document's own shape
// first -- so it is safe to call from a context that has not already done
// that validation itself. `manifestId` is checked here and only here: the
// workout document (Section 5 below) carries no `manifestId` field at all,
// so occurrence-to-Run `manifestId` agreement can only ever be verified at
// this exact boundary. Microcycle/Session identity is not re-checked here,
// deliberately: the Run document carries no per-occurrence Microcycle/Session
// field to cross-check against (that agreement is already fully covered by
// `planRunOccurrenceDocValid`'s own shape check on the occurrence's own
// fields).
function planRunOccurrenceRunBindingOk(occurrenceDoc, runDoc) {
  if (!planRunOccurrenceDocValid(occurrenceDoc) || !planRunDocValid(runDoc)) return false;
  return occurrenceDoc.ownerUid === runDoc.ownerUid &&
    occurrenceDoc.planRunId === runDoc.planRunId &&
    occurrenceDoc.planTemplateId === runDoc.planTemplateId &&
    occurrenceDoc.headRevisionId === runDoc.headRevisionId &&
    occurrenceDoc.manifestId === runDoc.manifestId;
}

// FOUNDATION SLICE ADDITION (canonical-program-run-ui-logger-integration-
// specification-round8.md §3A.6.9, generalized across Rounds 6/7/8 into one
// shared classifier). Answers, for a slot document already read alongside a
// Run document, whether the slot's own current claim state corroborates
// what a caller EXPECTS given that Run's own status -- 'active' (the Run
// should still actively hold the claim) or 'released' (the Run has gone
// terminal and should no longer hold it). Shape/identity failures
// (missing/malformed/foreign) are identical regardless of which
// expectation is being checked, since an uninformative slot document
// corroborates neither. The one place the two expectations genuinely
// diverge: under `expectation:'released'`, a slot now claimed by a
// DIFFERENT Run is `confirmed` (a legitimate later reclaim); under
// `expectation:'active'`, the identical slot state is never legitimate for
// a Run that is still supposed to hold the claim, so it is a genuine
// conflict instead. Used by Finish's own terminal (§3A.6.9.2) and
// non-final/active (§3A.6.9.3) corroboration, and by End's own recovery
// corroboration (§3A.6.11), each supplying its own already-validated
// slotSnap/runDoc-derived flags.
// p: { slotExists, slotValid, slotIdentityOk, slotActivePlanRunId, thisRunId, expectation: 'active' | 'released' }
function planRunClassifySlotState(p) {
  if (!p.slotExists) return { result: 'integrityConflict', reason: 'slotMissing' };
  if (!p.slotValid) return { result: 'integrityConflict', reason: 'slotMalformed' };
  if (!p.slotIdentityOk) return { result: 'integrityConflict', reason: 'slotForeign' };
  if (p.expectation === 'active') {
    if (p.slotActivePlanRunId === p.thisRunId) return { result: 'confirmed' };
    if (p.slotActivePlanRunId === null) return { result: 'integrityConflict', reason: 'slotReleasedWhileRunActive' };
    return { result: 'integrityConflict', reason: 'slotClaimedByAnotherRunWhileActive' };
  }
  // expectation === 'released'
  if (p.slotActivePlanRunId === p.thisRunId) return { result: 'integrityConflict', reason: 'slotNotReleased' };
  return { result: 'confirmed' };
}

// -----------------------------------------------------------------------------
// SLICE 1 ADDITION -- active-Run listing pagination cursor (spec Round 4
// §3A.1.5, reproduced exactly: a real Firestore `Timestamp`'s own two integer
// components, encoded directly, never round-tripped through a
// millisecond-precision ISO string). Pure encode/decode with no I/O of any
// kind; `deps.encodeCursor`/`deps.decodeCursor` (firebase-plan-run.js) are
// thin wrappers around these two functions, kept here because the file's own
// established convention (Sections 1-9 above) is that every PURE decision or
// encoding function lives in this model file, never in the Firestore-facing
// dependency layer.
// -----------------------------------------------------------------------------
var PLAN_RUN_PAGE_CURSOR_VERSION = 2;
var PLAN_RUN_PAGE_CURSOR_KEYS = Object.freeze(['v', 'ownerUid', 'startedAtSeconds', 'startedAtNanoseconds', 'planRunId']);

// -----------------------------------------------------------------------------
// SLICE 1 CORRECTION (independent-review Finding 1): the cursor's own
// base64/UTF-8 codec must not depend on Node's `Buffer`, which is undefined
// in the real browser realm this file is actually loaded into (index.html
// provides no polyfill, and none is added here). Below is a small,
// dependency-free UTF-8 <-> byte-array codec and a standard (RFC 4648,
// '+/' alphabet, '=' padding -- the SAME alphabet `Buffer.toString('base64')`
// already used) byte-array <-> base64-string codec, both pure JS with no
// reference to `Buffer`, `btoa`/`atob`, or `TextEncoder`/`TextDecoder` --
// so the exact same code path runs unchanged in a real browser, in a Node
// `require()`, and in a Node `vm` sandbox, and produces byte-for-byte
// identical cursor strings to the prior `Buffer`-based implementation for
// the same input (confirmed by a dedicated cross-check test) -- this is a
// pure implementation swap, not a cursor-format change. The cursor's own
// contract (v:2 payload shape, field names, owner binding, Timestamp
// seconds/nanoseconds precision, "never throws" decode discipline) is
// otherwise byte-for-byte unchanged from the design below.
// -----------------------------------------------------------------------------
function planRunUtf8EncodeToBytes(str) {
  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    var codePoint = str.codePointAt(i);
    if (codePoint > 0xFFFF) i++; // this code unit was the high half of a surrogate pair; codePointAt already consumed both
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xC0 | (codePoint >> 6), 0x80 | (codePoint & 0x3F));
    } else if (codePoint < 0x10000) {
      bytes.push(0xE0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3F), 0x80 | (codePoint & 0x3F));
    } else {
      bytes.push(0xF0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 0x3F), 0x80 | ((codePoint >> 6) & 0x3F), 0x80 | (codePoint & 0x3F));
    }
  }
  return bytes;
}
// Throws on any structurally invalid UTF-8 byte sequence -- the caller
// (`planRunDecodePageCursor`) wraps this in the same try/catch that already
// covers JSON.parse, so a malformed sequence still becomes a clean
// {invalid:true}, never an uncaught throw reaching the caller.
function planRunUtf8DecodeFromBytes(bytes) {
  var out = '';
  var i = 0;
  while (i < bytes.length) {
    var b0 = bytes[i];
    if (b0 < 0x80) { out += String.fromCodePoint(b0); i += 1; continue; }
    var extra, min, cp;
    if ((b0 & 0xE0) === 0xC0) { extra = 1; min = 0x80; cp = b0 & 0x1F; }
    else if ((b0 & 0xF0) === 0xE0) { extra = 2; min = 0x800; cp = b0 & 0x0F; }
    else if ((b0 & 0xF8) === 0xF0) { extra = 3; min = 0x10000; cp = b0 & 0x07; }
    else { throw new Error('planRunUtf8DecodeFromBytes: invalid leading byte'); }
    if (i + extra >= bytes.length) throw new Error('planRunUtf8DecodeFromBytes: truncated sequence');
    for (var k = 1; k <= extra; k++) {
      var bk = bytes[i + k];
      if ((bk & 0xC0) !== 0x80) throw new Error('planRunUtf8DecodeFromBytes: invalid continuation byte');
      cp = (cp << 6) | (bk & 0x3F);
    }
    if (cp < min || cp > 0x10FFFF) throw new Error('planRunUtf8DecodeFromBytes: overlong or out-of-range sequence');
    out += String.fromCodePoint(cp);
    i += extra + 1;
  }
  return out;
}
var PLAN_RUN_BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function planRunBase64EncodeBytes(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i += 3) {
    var b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    var haveB1 = b1 !== undefined, haveB2 = b2 !== undefined;
    var triple = (b0 << 16) | ((haveB1 ? b1 : 0) << 8) | (haveB2 ? b2 : 0);
    out += PLAN_RUN_BASE64_ALPHABET.charAt((triple >> 18) & 0x3F);
    out += PLAN_RUN_BASE64_ALPHABET.charAt((triple >> 12) & 0x3F);
    out += haveB1 ? PLAN_RUN_BASE64_ALPHABET.charAt((triple >> 6) & 0x3F) : '=';
    out += haveB2 ? PLAN_RUN_BASE64_ALPHABET.charAt(triple & 0x3F) : '=';
  }
  return out;
}
// Returns a byte array on a syntactically well-formed standard base64
// string (correct alphabet, length a multiple of 4, at most 2 '=' padding
// characters and only as the final characters), or `null` -- **never
// throws** -- on anything else, so the caller can treat a malformed cursor
// as clean, classified input rather than an exception.
function planRunBase64DecodeToBytes(str) {
  if (typeof str !== 'string' || str.length === 0 || str.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(str)) return null;
  var lookup = {};
  for (var i = 0; i < PLAN_RUN_BASE64_ALPHABET.length; i++) lookup[PLAN_RUN_BASE64_ALPHABET.charAt(i)] = i;
  var bytes = [];
  for (var j = 0; j < str.length; j += 4) {
    var c0 = str.charAt(j), c1 = str.charAt(j + 1), c2 = str.charAt(j + 2), c3 = str.charAt(j + 3);
    if (c0 === '=' || c1 === '=') return null; // padding can only ever be the 3rd/4th character of the FINAL quad
    var n0 = lookup[c0], n1 = lookup[c1];
    if (n0 === undefined || n1 === undefined) return null;
    var n2 = (c2 === '=') ? 0 : lookup[c2];
    var n3 = (c3 === '=') ? 0 : lookup[c3];
    if (n2 === undefined || n3 === undefined) return null;
    var triple = (n0 << 18) | (n1 << 12) | (n2 << 6) | n3;
    bytes.push((triple >> 16) & 0xFF);
    if (c2 !== '=') bytes.push((triple >> 8) & 0xFF);
    if (c3 !== '=') bytes.push(triple & 0xFF);
  }
  return bytes;
}

// `fields`: {ownerUid, startedAtTimestamp: {seconds, nanoseconds}, planRunId}
// -- `startedAtTimestamp` must be read directly off the Run document's own
// `startedAt` field (a real Firestore Timestamp, or the fake harness's own
// `{seconds, nanoseconds}` equivalent), never re-derived from a formatted
// string. Returns a base64-encoded JSON string; never throws (a caller
// passing a malformed `fields` object gets back a cursor that
// `planRunDecodePageCursor` will then correctly reject as `{invalid: true}`,
// rather than this function throwing synchronously).
function planRunEncodePageCursor(fields) {
  var f = fields || {};
  var t = f.startedAtTimestamp || {};
  var payload = {
    v: PLAN_RUN_PAGE_CURSOR_VERSION,
    ownerUid: f.ownerUid,
    startedAtSeconds: t.seconds,
    startedAtNanoseconds: t.nanoseconds,
    planRunId: f.planRunId
  };
  return planRunBase64EncodeBytes(planRunUtf8EncodeToBytes(JSON.stringify(payload)));
}

// Returns {startedAtSeconds, startedAtNanoseconds, planRunId} on a
// well-formed, version-2, owner-matching cursor, or {invalid: true} --
// **never throws** -- for any of: decode/parse failure; not a plain object;
// key set not EXACTLY PLAN_RUN_PAGE_CURSOR_KEYS; `v !== 2` (a `v:1` cursor,
// never issued by any deployed code since this capability has never been
// activated, is deterministically rejected rather than misparsed under an
// incompatible shape); `ownerUid` not a well-formed ID or not equal to the
// `ownerUid` argument (the authenticated caller's own uid -- this is a
// stale-cursor/account-switch guard, never a security boundary: the
// underlying query is always owner-scoped by its own `where` clause
// regardless of what a cursor claims, spec Round 4 §3A.1.5); `startedAtSeconds`
// not a non-negative integer; `startedAtNanoseconds` not an integer in
// [0, 999999999]; `planRunId` not a well-formed ID.
function planRunDecodePageCursor(cursor, ownerUid) {
  var payload;
  try {
    var bytes = planRunBase64DecodeToBytes(String(cursor));
    if (bytes === null) return { invalid: true };
    payload = JSON.parse(planRunUtf8DecodeFromBytes(bytes));
  } catch (e) {
    return { invalid: true };
  }
  if (!planRunExactKeys(payload, PLAN_RUN_PAGE_CURSOR_KEYS)) return { invalid: true };
  if (payload.v !== PLAN_RUN_PAGE_CURSOR_VERSION) return { invalid: true };
  if (!planRunIsId(payload.ownerUid) || payload.ownerUid !== ownerUid) return { invalid: true };
  if (!Number.isInteger(payload.startedAtSeconds) || payload.startedAtSeconds < 0) return { invalid: true };
  if (!Number.isInteger(payload.startedAtNanoseconds) || payload.startedAtNanoseconds < 0 || payload.startedAtNanoseconds > 999999999) return { invalid: true };
  if (!planRunIsId(payload.planRunId)) return { invalid: true };
  return { startedAtSeconds: payload.startedAtSeconds, startedAtNanoseconds: payload.startedAtNanoseconds, planRunId: payload.planRunId };
}

// =============================================================================
// SECTION 5 -- the minimal workout-persistence shape this slice defines
// (see PLAN_RUN_WORKOUT_KEYS above), the completion-eligibility check (spec
// §9 decision 2), and the progression-evidence adapter that projects an
// occurrence's own stored snapshot plus a workout's performed values into
// the exact `evidence`/`basis` shapes the real, UNMODIFIED
// planEvaluateCanonicalProgression/planValidateProgressionEvaluationInput
// already require (app-plan.js:13237-13275) -- reused, never re-implemented.
// =============================================================================
// Amended per-Set validator: the prior nested `performed` sub-object is
// retired (see PLAN_RUN_WORKOUT_SET_KEYS above) -- these same four fields
// (`weight`/`reps`/`time`/`completed`, `time` renamed from the prior
// shape's own `seconds`) are now checked directly on the flat Set record,
// alongside two new required fields (`rpe`, `isPR`, `isNew1RM` -- three,
// not two; named individually below) the real History/stats code also
// reads. `planRunWorkoutPerformedValid` itself is retired along with the
// shape it validated.
function planRunWorkoutSetValid(st) {
  if (!planRunExactKeys(st, PLAN_RUN_WORKOUT_SET_KEYS)) return false;
  if (!planRunIsId(st.planSetId)) return false;
  if (!planRunIsFiniteOrNull(st.weight) || !planRunIsFiniteOrNull(st.reps) || !planRunIsFiniteOrNull(st.time) || !planRunIsFiniteOrNull(st.rpe)) return false;
  if (typeof st.completed !== 'boolean' || typeof st.isPR !== 'boolean' || typeof st.isNew1RM !== 'boolean') return false;
  return true;
}
function planRunWorkoutDocValid(v) {
  if (!planRunExactKeys(v, PLAN_RUN_WORKOUT_KEYS)) return false;
  if (!planRunIsId(v.id) || !planRunIsId(v.ownerUid)) return false;
  if (!planRunIsId(v.planRunId) || !planRunIsId(v.planOccurrenceId) || !planRunIsId(v.planTemplateId)) return false;
  if (!planRunIsId(v.headRevisionId) || !planRunIsId(v.planMicrocycleId) || !planRunIsId(v.planSessionId)) return false;
  if (v.recordKind !== 'canonicalWorkout') return false;
  if (v.completionState !== 'sessionCompleted' && v.completionState !== 'historyOnly') return false;
  if (!planRunIsNonEmptyString(v.name)) return false;
  if (!planRunIsFiniteNumber(v.date)) return false;
  if (!planRunIsFiniteOrNull(v.duration) || !planRunIsFiniteOrNull(v.bodyweight)) return false;
  if (!Array.isArray(v.exercises) || v.exercises.length === 0) return false;
  for (var i = 0; i < v.exercises.length; i++) {
    var ex = v.exercises[i];
    if (!planRunExactKeys(ex, PLAN_RUN_WORKOUT_EXERCISE_KEYS)) return false;
    if (!planRunIsId(ex.exerciseId) || !planRunIsId(ex.planAssignmentId) || !planRunIsId(ex.planPrescriptionId)) return false;
    if (!Array.isArray(ex.sets) || ex.sets.length === 0) return false;
    // FOUNDATION CORRECTION (perfVideos empty-array acceptance): `perfVideos`
    // must still be PRESENT (planRunExactKeys, above) and must still be a
    // real array, but is no longer required to be non-empty. This matches
    // both the field's own original stated intent ("a workout with no
    // videos for an exercise carries an empty array, never an omitted
    // key") and the real, current logger's own default for every exercise
    // (`perfVideos: []`, app-core.js) -- a video is added only if the
    // person explicitly pastes one into the existing Add Videos modal,
    // which most real sessions never do for most exercises. The prior
    // `|| ex.perfVideos.length === 0` conjunct made every ordinary,
    // video-free real workout unconditionally fail this validator --
    // confirmed a genuine defect, not a design choice, since no accepted
    // spec round ever stated videos are required to Finish a Session. Every
    // element actually present in the array is still validated exactly as
    // before -- this loop's own per-element check is unchanged.
    if (!Array.isArray(ex.perfVideos)) return false;
    for (var pv = 0; pv < ex.perfVideos.length; pv++) {
      if (!planRunIsNonEmptyString(ex.perfVideos[pv])) return false;
    }
    var seenSetIds = {};
    for (var s = 0; s < ex.sets.length; s++) {
      var st = ex.sets[s];
      if (!planRunWorkoutSetValid(st)) return false;
      if (Object.prototype.hasOwnProperty.call(seenSetIds, st.planSetId)) return false;
      seenSetIds[st.planSetId] = true;
    }
  }
  if (!planRunIsTimestamp(v.createdAt)) return false;
  return true;
}

// Shared existing-workout discriminator (spec §3A.6.10.2, Round 8 Findings
// 1+2 together). Answers, for a document that already exists at a
// candidate workout path, one of exactly four categories -- BEFORE either
// caller (Finish's collision check, fsPlanRunSaveHistoryOnly's own step 8)
// decides anything else. `recordKind`-presence is checked FIRST, on the
// raw document, before the full shape validator ever runs: a genuine
// legacy/imported workout (the real app-core.js write path, confirmed
// this round to carry NO `recordKind` at all, and nine fields the amended
// canonical shape does not have) would otherwise ALWAYS fail the strict
// exact-key `planRunWorkoutDocValid` check and be misclassified `malformed`
// instead of `legacy` -- exactly the ordering defect this function exists
// to prevent from ever being reintroduced inline at either call site.
// Once `recordKind` is confirmed present, the FULL validator (not a
// narrower "does recordKind equal the literal" check) decides malformed
// vs. genuine canonical -- so a forged discriminator on otherwise-legacy-
// shaped data, a wrong-typed value, or any other shape defect is uniformly
// `malformed`, never `legacy`. Safe to call unconditionally on
// `existingSnap.data` for an existing snapshot: the Firestore SDK
// guarantees `.data()` is a plain object whenever the snapshot exists.
function planRunClassifyWorkoutDiscriminator(v) {
  if (!Object.prototype.hasOwnProperty.call(v, 'recordKind')) return { category: 'legacy' };
  if (!planRunWorkoutDocValid(v)) return { category: 'malformed' };
  return { category: v.completionState === 'sessionCompleted' ? 'sessionCompleted' : 'historyOnly' };
}

// Canonical-context match (spec §8's "Workout creation contract"): the
// workout's own stamped identity must agree EXACTLY with the occurrence's
// own snapshot identity -- never a soft/partial match (spec §10 step 10).
function planRunWorkoutContextMatchesOccurrence(workoutDoc, occurrenceDoc) {
  if (!planRunWorkoutDocValid(workoutDoc) || !planRunOccurrenceDocValid(occurrenceDoc)) return false;
  if (workoutDoc.ownerUid !== occurrenceDoc.ownerUid) return false;
  if (workoutDoc.planRunId !== occurrenceDoc.planRunId) return false;
  if (workoutDoc.planOccurrenceId !== occurrenceDoc.occurrenceId) return false;
  if (workoutDoc.planTemplateId !== occurrenceDoc.planTemplateId) return false;
  if (workoutDoc.headRevisionId !== occurrenceDoc.headRevisionId) return false;
  if (workoutDoc.planMicrocycleId !== occurrenceDoc.planMicrocycleId) return false;
  if (workoutDoc.planSessionId !== occurrenceDoc.planSessionId) return false;
  // Every exercise the workout stamps must resolve to a real Assignment on
  // this occurrence's own snapshot, with matching exerciseId/prescriptionId.
  var byAssignmentId = {};
  occurrenceDoc.assignments.forEach(function (a) { byAssignmentId[a.planAssignmentId] = a; });
  for (var i = 0; i < workoutDoc.exercises.length; i++) {
    var ex = workoutDoc.exercises[i];
    var a = byAssignmentId[ex.planAssignmentId];
    if (!a || a.exerciseId !== ex.exerciseId || a.planPrescriptionId !== ex.planPrescriptionId) return false;
    var bySetId = {};
    a.orderedSets.forEach(function (os) { bySetId[os.planSetId] = os; });
    for (var s = 0; s < ex.sets.length; s++) {
      if (!bySetId[ex.sets[s].planSetId]) return false;
    }
  }
  return true;
}

// Spec §9 decision 2: occurrence completion requires at least one prescribed
// Set anywhere in the occurrence's assignments[].orderedSets[] to have valid
// performed evidence on the matching workout.
//
// ROUND 2 CORRECTION (judgment call 2 -- owner-directed, see the round2
// correction report for the owner's exact quoted contract): a Set may
// legitimately prescribe BOTH reps and time. This is not corruption and is
// not resolved by picking one field via priority. Completion evidence for
// one Set requires: performed.completed === true, AND (no reps prescribed
// OR a valid performed.reps is recorded), AND (no time prescribed OR a
// valid performed.seconds is recorded); when BOTH are prescribed, BOTH
// measurements are required. Achieving the numeric TARGET is explicitly not
// required -- only that a valid measurement was recorded ("recording valid
// performance is distinct from achieving the targets" -- the owner's own
// words). "Prescribed" means the set's own prescribed.repsType/
// prescribed.timeType is non-blank ('' means not prescribed; 'fixed'/
// 'range' mean prescribed -- the same blank/non-blank convention app-plan.js
// uses throughout for these two fields, confirmed by grep against the real
// source rather than assumed).
//
// ROUND 3 CORRECTION (finding 1 -- removes the active, unapproved weight
// fallback the round2 report itself already flagged as contradicting the
// owner's own instruction not to invent one; see
// program-run-persistence-slice-round3-correction-report.md for the full
// history). The owner's contract above settles reps-prescribed,
// time-prescribed, and both-prescribed. It does NOT settle a Set that
// prescribes NEITHER reps NOR time -- the round2 report's own words:
// "the neither-reps-nor-time case ... remains genuinely undefined by the
// accepted spec text and is NOT resolved by this contract ... do NOT invent
// a weight-based fallback for it." Round 2's implementation nonetheless
// LEFT the prior round's own weight-tracked fallback (`performed.weight !==
// null`) ACTIVE for this exact case -- an unapproved behavior still silently
// granting completion credit, not a merely-documented gap. This correction
// makes the neither-prescribed case explicitly UNSUPPORTED for completion
// credit: it returns `false` (no credit) unconditionally, never consulting
// `performed.weight` at all. This is a TEMPORARY FAIL-CLOSED BOUNDARY, not a
// declaration that a weight-only Set is invalid, corrupt, or unusual --
// `planRunOccurrenceEligibleForCompletion` (below) simply does not count
// such a Set as qualifying, exactly the same as any other not-yet-qualifying
// Set; a single weight-only Set on an occurrence never fails validation and
// never prevents a DIFFERENT, qualifying Set elsewhere on the same
// occurrence from making it eligible. The neither-prescribed case's
// eventual real behavior (weight-tracked? a distinct third prescription
// type? never eligible by design?) remains a genuinely open product
// decision -- named again here, in plan-run-traceability.md, and in the
// round3 correction report, not resolved by this or any prior round.
//
// ROUND 3 CORRECTION (finding 2 -- the helper now enforces measurement
// validity itself, rather than trusting a bare `!== null` check that let
// `undefined` silently pass as "not null"). A REQUIRED measurement
// (performed.reps when reps is prescribed; performed.seconds when time is
// prescribed) must satisfy `planRunIsFiniteNumber` -- present, a genuine
// `number`, and `Number.isFinite` -- rejecting undefined, null, strings,
// booleans, NaN, and +/-Infinity uniformly, reusing the exact same
// finite-number domain rule this codebase's own prescribed-field validation
// (`planRunPrescribedValid`, via `planRunIsFiniteOrNull`) and app-plan.js's
// accepted `planProgressionFiniteOrNull` precedent already establish for
// numeric measurement fields -- never a newly invented numeric-validity or
// target-achievement rule (achieving the prescribed target amount is still
// explicitly not required; only that a VALID measurement was recorded).
// `prescribed`/`performed` are also now defensively shape-checked (plain
// object) before any property of either is read, so a malformed/missing
// input of either kind returns `false` (no completion credit) rather than
// throwing -- this helper is exercised directly by tests with deliberately
// malformed inputs (see plan-run-model.test.js), and is also reachable, via
// `planRunOccurrenceEligibleForCompletion`, from the real Finish boundary
// (`fsPlanRunFinish`, firebase-plan-run.js step 12) on a workout the shape
// validators upstream (`planRunWorkoutDocValid`/`planRunOccurrenceDocValid`)
// have already confirmed schema-valid before this helper ever runs -- so in
// production use, prescribed/performed are already known-shaped by the time
// this function sees them, and this function's own defensive guard is a
// second, independent line of defense (never the only one), consistent with
// this codebase's existing "defense in depth, never single point of trust"
// idiom.
function planRunSetHasValidCompletionEvidence(prescribed, performed) {
  if (!planRunIsPlainObject(prescribed)) return false;
  if (!planRunIsPlainObject(performed)) return false;
  if (performed.completed !== true) return false;
  var repsPrescribed = !!prescribed.repsType;
  var timePrescribed = !!prescribed.timeType;
  if (!repsPrescribed && !timePrescribed) {
    // Still-open gap (see the header comment above): NEITHER prescribed is
    // not addressed by the owner's accepted contract. Fail-closed -- no
    // completion credit -- rather than inventing a resolution. This is NOT
    // a corruption signal; callers must never treat this return value as
    // meaning the Set or the surrounding workout is malformed.
    return false;
  }
  if (repsPrescribed && !planRunIsFiniteNumber(performed.reps)) return false;
  if (timePrescribed && !planRunIsFiniteNumber(performed.seconds)) return false;
  return true;
}
function planRunOccurrenceEligibleForCompletion(occurrenceDoc, workoutDoc) {
  if (!planRunOccurrenceDocValid(occurrenceDoc) || !planRunWorkoutDocValid(workoutDoc)) return false;
  var performedBySetId = {};
  workoutDoc.exercises.forEach(function (ex) {
    // Amended-shape adapter (spec §3A.6.4): the prior nested `performed`
    // sub-object is retired -- projects the flat, amended Set fields into
    // the exact {completed, reps, seconds} shape planRunSetHasValidCompletionEvidence
    // has always required, unchanged. `time` (the amended shape's own
    // field name) is read here as `seconds`, matching that function's own
    // parameter name -- a pure field rename, not a semantic change.
    ex.sets.forEach(function (s) { performedBySetId[s.planSetId] = { completed: s.completed, reps: s.reps, seconds: s.time }; });
  });
  for (var i = 0; i < occurrenceDoc.assignments.length; i++) {
    var a = occurrenceDoc.assignments[i];
    for (var s2 = 0; s2 < a.orderedSets.length; s2++) {
      var os = a.orderedSets[s2];
      if (planRunSetHasValidCompletionEvidence(os.prescribed, performedBySetId[os.planSetId])) return true;
    }
  }
  return false;
}

// Projects one enabled Rule + its owning Assignment's occurrence snapshot,
// plus the winning workout's performed sets for that same Assignment, into
// the exact {rule, basis, evidence} triple planValidateProgressionEvaluationInput/
// planEvaluateCanonicalProgression already require. Returns null (never
// throws) if the workout does not carry a matching, complete set of
// performed values for every one of the Assignment's own prescribed sets --
// the caller (firebase-plan-run.js step 11) treats that as the
// `notEvaluable` semantic-review reason, exactly as the real evaluator's own
// contract already specifies (basis validation failing IS one of its own
// named review triggers, not a distinct corruption mode -- see the report).
function planRunBuildProgressionTriple(ruleEntry, assignment, occurrenceDoc, workoutDoc, workoutId) {
  var basis = {
    ownerUid: occurrenceDoc.ownerUid,
    planTemplateId: occurrenceDoc.planTemplateId,
    headRevisionId: occurrenceDoc.headRevisionId,
    planSessionId: occurrenceDoc.planSessionId,
    planAssignmentId: assignment.planAssignmentId,
    planRuleId: ruleEntry.planRuleId,
    ruleRevisionId: ruleEntry.ruleRevisionId,
    exerciseId: assignment.exerciseId,
    planPrescriptionId: assignment.planPrescriptionId,
    adjustmentType: ruleEntry.adjustmentType,
    orderedSets: assignment.orderedSets.map(function (os) {
      var narrowed = {};
      PLAN_RUN_PROGRESSION_PRESCRIBED_KEYS.forEach(function (k) { narrowed[k] = os.prescribed[k]; });
      return { planSetId: os.planSetId, prescribed: narrowed };
    })
  };
  var rule = {
    adjustmentType: ruleEntry.adjustmentType, enabled: ruleEntry.enabled, evaluationType: ruleEntry.evaluationType,
    failBehavior: ruleEntry.failBehavior, gatewaySetIndex: ruleEntry.gatewaySetIndex, loadIncrease: ruleEntry.loadIncrease,
    planRuleId: ruleEntry.planRuleId, ruleRevisionId: ruleEntry.ruleRevisionId, tmIncrease: ruleEntry.tmIncrease
  };
  var performedBySetId = {};
  (workoutDoc.exercises || []).forEach(function (ex) {
    if (ex.planAssignmentId === assignment.planAssignmentId) {
      // Amended-shape adapter (spec §3A.6.4) -- see the identical comment
      // in planRunOccurrenceEligibleForCompletion above.
      ex.sets.forEach(function (s) { performedBySetId[s.planSetId] = { completed: s.completed, reps: s.reps, seconds: s.time }; });
    }
  });
  // Deliberately skips (never fabricates) a set the workout carries no
  // performed evidence for -- the resulting `setPairs` may legitimately be
  // SHORTER than `basis.orderedSets`, which is exactly what the real,
  // unmodified planValidateProgressionEvaluationInput's own
  // `missingCommittedSet` check (app-plan.js:13260) is built to catch and
  // classify as a validation failure -- the caller (firebase-plan-run.js
  // step 11) maps ANY such failure to the `notEvaluable` semantic-review
  // reason, per spec §8's "reuses planValidateProgressionEvaluationInput's
  // existing rejection reasons ... unchanged."
  var setPairs = [];
  for (var i = 0; i < basis.orderedSets.length; i++) {
    var performed = performedBySetId[basis.orderedSets[i].planSetId];
    if (!performed) continue;
    setPairs.push({ planSetId: basis.orderedSets[i].planSetId, prescribed: basis.orderedSets[i].prescribed, performed: { completed: performed.completed, reps: performed.reps, seconds: performed.seconds } });
  }
  var evidence = {
    exerciseId: assignment.exerciseId, headRevisionId: occurrenceDoc.headRevisionId, ownerUid: occurrenceDoc.ownerUid,
    planAssignmentId: assignment.planAssignmentId, planRuleId: ruleEntry.planRuleId, planSessionId: occurrenceDoc.planSessionId,
    planTemplateId: occurrenceDoc.planTemplateId, setPairs: setPairs, workoutId: workoutId
  };
  return { rule: rule, basis: basis, evidence: evidence };
}

// -----------------------------------------------------------------------------
// FOUNDATION SLICE ADDITION -- deterministic Timestamp hash normalization
// (spec §3A.10, Rounds 6-8, unchanged in substance since Round 6 §3A.10.1-
// §3A.10.5). The contradiction this resolves: app-plan.js's own
// planBuildCanonicalEncoding accepts only plain objects/null (a live
// Firebase SDK Timestamp instance satisfies neither, so encoding one
// directly throws), but every real, persisted document in this domain uses
// exactly such live instances for its own timestamp fields -- and
// converting those fields to plain objects BEFORE persistence would store
// Firestore maps instead of genuine Firestore timestamps, breaking every
// downstream consumer relying on real timestamp semantics. The resolution:
// a disposable, hash-only preprocessing copy that normalizes ONLY the
// fields this domain's own schemas declare as timestamp-typed, built fresh
// for hashing and immediately discarded -- the persisted document itself
// (`pkg.workout`, or any Run/occurrence document) is never touched.
// -----------------------------------------------------------------------------

// Exact, hand-maintained list of the field NAMES this domain's own document
// schemas (Sections 1-2 above) declare as timestamp-typed. Mirrors
// PLAN_RUN_*_KEYS's own convention -- explicit and enumerated, never
// inferred from a value's shape. Adding a new timestamp-typed field
// anywhere in this file's schemas requires adding its name here.
var PLAN_RUN_CANONICAL_TIMESTAMP_FIELD_NAMES = Object.freeze([
  'createdAt', 'updatedAt', 'startedAt', 'completedAt', 'endedAt',
  'recordedAt', 'lastEvaluatedAt'
]);

function PlanRunTimestampNormalizationError(reason) {
  this.name = 'PlanRunTimestampNormalizationError';
  this.reason = reason;
  this.message = 'Canonical hash normalization rejected an unsupported value: ' + reason;
}
PlanRunTimestampNormalizationError.prototype = Object.create(Error.prototype);

// Reuses the existing, UNCHANGED duck-typed planRunIsTimestamp check --
// accepts a real Firebase SDK Timestamp instance (browser or emulator) or
// the test harness's own accepted stand-in, identically to how every
// existing *DocValid validator already accepts either. Called ONLY on a
// value already known, by its POSITION (a field name in
// PLAN_RUN_CANONICAL_TIMESTAMP_FIELD_NAMES above), to be a timestamp
// candidate -- never on an arbitrary value based on its shape alone. This
// positional gating is exactly what prevents an ordinary object that
// happens to carry fields literally named seconds/nanoseconds, at any
// OTHER position, from ever being treated as a timestamp: shape is never
// consulted for this decision, only position (field name) is.
function planRunNormalizeTimestampForHash(v) {
  if (!planRunIsTimestamp(v)) throw new PlanRunTimestampNormalizationError('unsupportedTimestampShape');
  return { __planRunTimestamp: true, seconds: v.seconds, nanoseconds: v.nanoseconds };
}

// Recursively walks `value`, returning a NEW value -- the input is never
// mutated (every branch returns a fresh object/array via {}/.map, or
// returns a scalar as-is without ever assigning back into the input).
// Every field named in PLAN_RUN_CANONICAL_TIMESTAMP_FIELD_NAMES, at any
// depth, is replaced by its tagged normalized representation via
// planRunNormalizeTimestampForHash above; every other field/element is
// copied through unchanged in kind -- this function adds, removes, and
// reorders no key of its own, preserving the exact-key semantics
// planBuildCanonicalEncoding itself is about to enforce. The tagged output
// `{__planRunTimestamp:true, seconds:N, nanoseconds:N}` uses integer
// seconds/nanoseconds, never a single millisecond number, to preserve
// nanosecond precision (Timestamp.toMillis() would lose it).
function planRunNormalizeForCanonicalHash(value, fieldNameInParent) {
  if (fieldNameInParent !== null && PLAN_RUN_CANONICAL_TIMESTAMP_FIELD_NAMES.indexOf(fieldNameInParent) !== -1) {
    return planRunNormalizeTimestampForHash(value);
  }
  if (Array.isArray(value)) {
    return value.map(function (item) { return planRunNormalizeForCanonicalHash(item, null); });
  }
  if (planRunIsPlainObject(value)) {
    var out = {};
    Object.keys(value).forEach(function (k) { out[k] = planRunNormalizeForCanonicalHash(value[k], k); });
    return out;
  }
  return value;
}

// =============================================================================
// SECTION 6 -- Finish's step 7 (per-Rule structural boundary) and step 8
// (ten-branch historical-commit/occurrence-state classification), spec §10,
// invariant 24, invariant 26, §13's Finish outcome table. Both are PURE
// decision functions over already-computed booleans/flags -- the caller
// (firebase-plan-run.js) is responsible for actually reading documents and
// running the Section 3/4 validators/identity-checks to produce those flags;
// keeping the decision itself free of any Firestore/document shape makes it
// exhaustively unit-testable (tier 1) independently of any I/O harness.
// =============================================================================

// Step 7. Returns true only if every expected Rule's progression-state
// document exists/valid/self-identified, and every per-workout record that
// DOES exist at a key this transaction actually reads (requested workoutId
// always; the occurrence's own differing workoutId only in the differing
// case) is itself valid/self-identified. Never inspects occurrence/Run
// status -- this check is unconditional, exactly as spec step 7 requires.
function planRunFinishStructuralBoundaryOk(p) {
  for (var i = 0; i < p.expectedRuleIds.length; i++) {
    var rid = p.expectedRuleIds[i];
    var st = p.stateDocs && p.stateDocs[rid];
    if (!st || !st.exists || !st.valid || !st.identityOk) return false;
    var rec = p.requestedRecordDocs && p.requestedRecordDocs[rid];
    if (rec && rec.exists && (!rec.valid || !rec.identityOk)) return false;
    if (p.winningWorkoutId !== null && p.winningWorkoutId !== undefined) {
      var wrec = p.winningRecordDocs ? p.winningRecordDocs[rid] : null;
      if (wrec && wrec.exists && (!wrec.valid || !wrec.identityOk)) return false;
    }
  }
  return true;
}

// Step 8. See the file header and the implementation report's traceability
// table for the full branch-by-branch mapping back to spec §10/§13/invariant
// 24. `p` shape:
//   requestedWorkoutId, occurrenceId, planRunId, occurrenceStatus,
//   occurrenceWorkoutId, occurrenceInRemaining, runStatus, runEndedAtSet,
//   expectedRuleIds,
//   receipt: null | { resultRefsWorkoutId, appliedRuleIds, needsManualReviewRuleIds }
//     (null means either genuinely absent OR present-but-failed-step-3 --
//     the latter already terminated the transaction before step 8, per
//     invariant 27, so by construction this function is never called with a
//     receipt that failed its own step-3 validation),
//   matchingWorkout: null | { exists, contextMatches },
//   differingWorkout: null | { exists, contextMatches },
//   perRuleAtRequested: { [ruleId]: null | { exists, valid, identityOk, outcome } },
//   perRuleAtOccurrenceWorkoutId: { [ruleId]: null | { exists, valid, identityOk, outcome } },
//   terminalSlotOk, terminalSlotReason, activeSlotOk, activeSlotReason
//     (FOUNDATION SLICE ADDITION, spec §3A.6.9 -- each *Ok flag is true
//     whenever its own precondition does not apply to this call, so a
//     genuine first Finish is never affected; each is computed by the
//     caller via the shared planRunClassifySlotState classifier),
//   requestedWorkoutCollision: null | { exists: false } | { exists: true, category }
//     (FOUNDATION SLICE ADDITION, spec §3A.6.10 -- only ever non-null when
//     branch (h) is the branch that will actually be reached; category is
//     one of 'malformed'|'legacy'|'historyOnly'|'differingCompleted'|
//     'identicalButUncorroborated', via the shared workout discriminator)
function planRunClassifyFinishOccurrence(p) {
  var expected = p.expectedRuleIds;
  function perRuleFullyValid(map, key) {
    var r = map && map[key];
    return !!(r && r.exists && r.valid && r.identityOk);
  }
  function everyExpectedHasValidRecord(map) {
    for (var i = 0; i < expected.length; i++) if (!perRuleFullyValid(map, expected[i])) return false;
    return true;
  }
  function reconstructResultRefs(map, workoutId) {
    var applied = [], reviewed = [];
    expected.forEach(function (rid) {
      if (map[rid].outcome === 'applied') applied.push(rid); else reviewed.push(rid);
    });
    return { workoutId: workoutId, occurrenceId: p.occurrenceId, planRunId: p.planRunId, appliedRuleIds: applied, needsManualReviewRuleIds: reviewed };
  }
  // FOUNDATION SLICE ADDITION (spec §3A.6.9.2/§3A.6.9.3) -- the slot
  // conjunct on branches (a)/(b)/(c) below. `terminalSlotOk`/`activeSlotOk`
  // each default true when their own precondition does not apply, so this
  // never affects a genuine first Finish. Substitutes the branch's own
  // fallback reason for the slot-specific one ONLY when every OTHER
  // conjunct already passed and the slot check alone is what failed --
  // never when the branch was already going to fail for an unrelated
  // reason (a bad receipt, missing workout evidence, etc).
  var terminalSlotOk = p.terminalSlotOk !== false;
  var activeSlotOk = p.activeSlotOk !== false;
  function slotFailureReason(nonSlotOk, fallback) {
    if (!nonSlotOk) return fallback;
    if (!terminalSlotOk) return p.terminalSlotReason;
    if (!activeSlotOk) return p.activeSlotReason;
    return fallback;
  }

  // (a) Receipt-based fast path -- checked FIRST and EXCLUSIVELY whenever a
  // valid receipt is present (spec step 8(a) is reached before (b)/(c) can
  // ever apply; a receipt claiming commit is always resolved to either
  // alreadyCommitted or an integrity conflict, never falls through).
  //
  // ROUND 2 CORRECTION (section 2): the subject-identity check below now
  // compares ALL THREE of the receipt's claimed resultRefs identity fields
  // (workoutId, occurrenceId, planRunId) against the request -- not just
  // workoutId as the prior round did -- closing an operation-ID-reuse gap
  // (a receipt legitimately committed for a different occurrence/Run could
  // otherwise coincidentally share a workoutId value and be misread as this
  // request's own receipt). When the caller holds the FULL original
  // prepared package (p.haveFullPackage), the receipt's own retained
  // preparedPackageHash is independently compared against a hash computed
  // fresh from the caller's actual package content -- an altered retry
  // (same operationId, different package content) is rejected here, never
  // silently accepted on resultRefs agreement alone. A status-check caller
  // that does NOT hold the full package (p.haveFullPackage === false) skips
  // this hash comparison entirely and the returned outcome is marked
  // packageHashVerified:false -- it must never claim to have verified
  // byte-identical package content it never had.
  if (p.receipt) {
    if (p.receipt.resultRefsWorkoutId !== p.requestedWorkoutId ||
        p.receipt.resultRefsOccurrenceId !== p.occurrenceId ||
        p.receipt.resultRefsPlanRunId !== p.planRunId) {
      return { branch: 'a', outcome: 'integrityConflict', reason: 'receiptResultRefsSubjectMismatch' };
    }
    if (p.haveFullPackage && p.receipt.preparedPackageHash !== p.actualPackageHash) {
      return { branch: 'a', outcome: 'integrityConflict', reason: 'preparedPackageHashMismatch' };
    }
    var okANonSlot = p.occurrenceStatus === 'completed' && p.occurrenceWorkoutId === p.requestedWorkoutId &&
      !!(p.matchingWorkout && p.matchingWorkout.exists && p.matchingWorkout.contextMatches) &&
      !p.occurrenceInRemaining && everyExpectedHasValidRecord(p.perRuleAtRequested);
    var okA = okANonSlot && terminalSlotOk && activeSlotOk;
    if (okA) {
      var actualApplied = expected.filter(function (rid) { return p.perRuleAtRequested[rid].outcome === 'applied'; }).sort();
      var actualReviewed = expected.filter(function (rid) { return p.perRuleAtRequested[rid].outcome === 'reviewed'; }).sort();
      var claimedApplied = (p.receipt.appliedRuleIds || []).slice().sort();
      var claimedReviewed = (p.receipt.needsManualReviewRuleIds || []).slice().sort();
      if (JSON.stringify(actualApplied) === JSON.stringify(claimedApplied) && JSON.stringify(actualReviewed) === JSON.stringify(claimedReviewed)) {
        return { branch: 'a', outcome: 'alreadyCommitted', packageHashVerified: !!p.haveFullPackage, resultRefs: { workoutId: p.requestedWorkoutId, occurrenceId: p.occurrenceId, planRunId: p.planRunId, appliedRuleIds: claimedApplied, needsManualReviewRuleIds: claimedReviewed } };
      }
    }
    return { branch: 'a', outcome: 'integrityConflict', reason: slotFailureReason(okANonSlot, 'receiptEvidenceMismatch') };
  }

  // (b) No-receipt self-commit.
  if (p.occurrenceStatus === 'completed' && p.occurrenceWorkoutId === p.requestedWorkoutId) {
    var okBNonSlot = !!(p.matchingWorkout && p.matchingWorkout.exists && p.matchingWorkout.contextMatches) &&
      !p.occurrenceInRemaining && everyExpectedHasValidRecord(p.perRuleAtRequested);
    var okB = okBNonSlot && terminalSlotOk && activeSlotOk;
    if (okB) return { branch: 'b', outcome: 'alreadyCommitted', resultRefs: reconstructResultRefs(p.perRuleAtRequested, p.requestedWorkoutId) };
    return { branch: 'b', outcome: 'integrityConflict', reason: slotFailureReason(okBNonSlot, 'selfCommitEvidenceMismatch') };
  }

  // (c) No-receipt competing commit -- corroborated or not.
  if (p.occurrenceStatus === 'completed' && p.occurrenceWorkoutId !== null && p.occurrenceWorkoutId !== p.requestedWorkoutId) {
    var okCNonSlot = !!(p.differingWorkout && p.differingWorkout.exists && p.differingWorkout.contextMatches) &&
      !p.occurrenceInRemaining && everyExpectedHasValidRecord(p.perRuleAtOccurrenceWorkoutId);
    var okC = okCNonSlot && terminalSlotOk && activeSlotOk;
    if (okC) return { branch: 'c', outcome: 'competingOperationCorroborated', winningWorkoutId: p.occurrenceWorkoutId };
    return { branch: 'c', outcome: 'integrityConflict', reason: slotFailureReason(okCNonSlot, 'competingEvidenceNotCorroborated') };
  }

  // (d) completed + null workoutId: never legal, unconditional conflict.
  if (p.occurrenceStatus === 'completed' && p.occurrenceWorkoutId === null) {
    return { branch: 'd', outcome: 'integrityConflict', reason: 'completedWithNullWorkoutId' };
  }

  // (e)/(f) skipped.
  if (p.occurrenceStatus === 'skipped') {
    if (p.occurrenceWorkoutId !== null) return { branch: 'f', outcome: 'integrityConflict', reason: 'skippedWithNonNullWorkoutId' };
    var okE = !p.occurrenceInRemaining && p.runStatus === 'ended' && p.runEndedAtSet === true;
    if (okE) return { branch: 'e', outcome: 'occurrenceSkipped' };
    return { branch: 'e', outcome: 'integrityConflict', reason: 'contradictorySkippedState' };
  }

  // (g)/(h)/(i) pending/inProgress.
  if (p.occurrenceStatus === 'pending' || p.occurrenceStatus === 'inProgress') {
    if (p.occurrenceWorkoutId !== null) return { branch: 'g', outcome: 'integrityConflict', reason: 'unfinishedWithNonNullWorkoutId' };
    if (p.occurrenceInRemaining) {
      var reachabilityOk = expected.every(function (rid) { return !perRuleFullyValid(p.perRuleAtRequested, rid); });
      if (!reachabilityOk) return { branch: 'h', outcome: 'integrityConflict', reason: 'ruleRecordExistsForUnfinishedOccurrence' };
      // FOUNDATION SLICE ADDITION (spec §3A.6.10.4) -- Finish collision
      // protection. Reaching branch (h) at all means the occurrence, Run,
      // receipt, and progression state all independently say this
      // occurrence is still unfinished: a document already sitting at the
      // candidate workout path is therefore a genuine collision, even when
      // byte-identical to the requested workout (never a recognized
      // Retry -- a fully corroborated Retry is recognized entirely
      // separately, by branches (a)/(b)'s own occurrence/receipt/
      // progression-agreement logic, and never reaches branch (h) at all).
      var c = p.requestedWorkoutCollision;
      if (c && c.exists) {
        var reasons = { malformed: 'collidesWithMalformedWorkout', legacy: 'collidesWithLegacyWorkout',
          historyOnly: 'collidesWithHistoryOnlyWorkout', differingCompleted: 'collidesWithDifferingCompletedWorkout',
          identicalButUncorroborated: 'collidesWithUncorroboratedIdenticalWorkout' };
        return { branch: 'h', outcome: 'integrityConflict', reason: reasons[c.category] };
      }
      return { branch: 'h', outcome: 'confirmedAbsent' };
    }
    return { branch: 'i', outcome: 'integrityConflict', reason: 'unfinishedNullWorkoutIdAbsentFromRemaining' };
  }

  // (j) defensive: an occurrence.status outside the four legal literals
  // should already have been caught as documentMalformed at step 3 --
  // unreachable in practice, named only for defense-in-depth (invariant 26's
  // own `alreadyRecorded` category is named for the identical reason).
  return { branch: 'j', outcome: 'integrityConflict', reason: 'unrecognizedOccurrenceStatus' };
}

// =============================================================================
// SECTION 6B (ROUND 2 CORRECTION, section 2) -- a generic operation-receipt
// reuse guard, used identically by Start's and End's own "read the receipt
// before deciding to create it" step (Finish already has its own, richer
// receipt fast path as branch (a) of planRunClassifyFinishOccurrence above,
// now itself strengthened by this same round's full-subject-match +
// package-hash comparison -- see that function's own comment).
//
// This closes the "operation-ID reuse across different operations/Runs" gap
// named in the round2 task: Start/End previously wrote their own operation
// receipt unconditionally, with no read of any pre-existing document at
// that path first -- so a client that (by bug or malice) reused an
// operationId already bound to a DIFFERENT Run would silently overwrite
// that other Run's immutable receipt. This guard is read-only (pure
// decision over already-read flags); the caller in firebase-plan-run.js is
// responsible for actually reading the receipt document.
//
// p: {
//   receiptExists, receiptValid, receiptIdentityOk    -- from the existing
//     classifyDocFlags-style read (shape + ownerUid/operationId/operationType
//     agreement, via planRunOperationDocValid/planRunOperationIdentityOk),
//   receiptResultRefsPlanRunId  -- the planRunId the EXISTING receipt's own
//     resultRefs names (null if not applicable to this operationType),
//   requestedPlanRunId          -- the planRunId THIS request is about,
//   haveFullPackage             -- true for a genuine Start/End mutation
//     call (which always carries its own full, hashable package); false for
//     a lighter identity-only status check that cannot compute a hash,
//   actualPackageHash           -- packageHash(pkg), only meaningful when
//     haveFullPackage is true,
//   receiptPreparedPackageHash  -- the existing receipt's own retained hash
// }
// Returns one of:
//   { result: 'absent' }                     -- no pre-existing receipt; the
//     caller is free to proceed and create one.
//   { result: 'integrityConflict', reason }   -- a conflicting receipt
//     exists (malformed/foreign, OR bound to a genuinely different subject,
//     OR bound to this same subject but a different package) -- the caller
//     must write NOTHING.
//   { result: 'recognizedIdentityOnly' }      -- receipt is genuinely this
//     same operation/subject, but the caller could not verify the package
//     byte-for-byte (status-check-only call) -- recognized, not verified.
//   { result: 'recognizedMatchingPackage' }   -- receipt is genuinely this
//     same operation/subject AND (when checkable) the package content
//     independently hashes to the exact same value already retained.
function planRunClassifyOperationReceiptGuard(p) {
  if (!p.receiptExists) return { result: 'absent' };
  if (!p.receiptValid || !p.receiptIdentityOk) return { result: 'integrityConflict', reason: 'receiptMalformedOrForeign' };
  if (p.receiptResultRefsPlanRunId !== p.requestedPlanRunId) {
    return { result: 'integrityConflict', reason: 'operationIdReusedForDifferentSubject' };
  }
  if (!p.haveFullPackage) return { result: 'recognizedIdentityOnly' };
  if (p.actualPackageHash !== p.receiptPreparedPackageHash) {
    return { result: 'integrityConflict', reason: 'preparedPackageHashMismatch' };
  }
  return { result: 'recognizedMatchingPackage' };
}

// =============================================================================
// SECTION 6C (ROUND 2 CORRECTION, section 3) -- minimal, exact-required-field
// validators for the three read-only Check*Status inputs. Each checks ONLY
// that the identity fields the corresponding status check actually reads
// are present and individually well-formed IDs -- mirroring the same
// "minimal shape, identity fields only" spirit as the existing, accepted
// app-plan.js recovery-marker pattern (planCanonicalEditorReadValidRecoveryMarker),
// but intentionally NOT an exact-key check: a caller that still happens to
// be holding a larger object (e.g. a full Finish package reused for a
// status check after a reload) is not penalized for carrying extra fields
// this function never reads -- only missing/malformed REQUIRED fields are
// rejected. This is what makes "accept just the identity fields it actually
// needs" true without breaking a caller who legitimately still has more.
function planRunValidateCheckStartStatusInput(input) {
  if (!planRunIsPlainObject(input)) return { ok: false, reason: 'malformedInputShape' };
  if (!planRunIsId(input.ownerUid) || !planRunIsId(input.planRunId) || !planRunIsId(input.planTemplateId)) return { ok: false, reason: 'malformedInputShape' };
  return { ok: true };
}
function planRunValidateCheckFinishStatusInput(input) {
  if (!planRunIsPlainObject(input)) return { ok: false, reason: 'malformedInputShape' };
  var required = ['operationId', 'ownerUid', 'planRunId', 'occurrenceId', 'workoutId'];
  for (var i = 0; i < required.length; i++) if (!planRunIsId(input[required[i]])) return { ok: false, reason: 'malformedInputShape' };
  return { ok: true };
}
function planRunValidateCheckEndStatusInput(input) {
  if (!planRunIsPlainObject(input)) return { ok: false, reason: 'malformedInputShape' };
  if (!planRunIsId(input.operationId) || !planRunIsId(input.ownerUid) || !planRunIsId(input.planRunId)) return { ok: false, reason: 'malformedInputShape' };
  return { ok: true };
}

// =============================================================================
// SECTION 7 -- Start's and End's own (much simpler) historical-commit checks
// and the shared active-slot decision order (spec §5.5, applied identically
// by Start's claim and by Finish/End's release -- "One unified decision
// order, used identically everywhere the slot is read").
// =============================================================================
function planRunClassifyStartRequest(p) {
  if (p.runExists) {
    return (p.runValid && p.runIdentityOk) ? { outcome: 'alreadyCommitted' } : { outcome: 'integrityConflict', reason: 'startRunDocumentMalformedOrForeign' };
  }
  return { outcome: 'confirmedAbsent' };
}

// p: { slotExists, slotValid (shape+identity already confirmed), slotActivePlanRunId,
//      pointedRun: null | { exists, valid, identityOk, status } } -- pointedRun is only
//      read/supplied by the caller when slotActivePlanRunId is non-null.
function planRunSlotClaimDecision(p) {
  if (p.slotExists && !p.slotValid) return { result: 'integrityConflict', reason: 'slotMalformed' };
  if (!p.slotExists) return { result: 'claim' };
  if (p.slotActivePlanRunId === null) return { result: 'claim' };
  var pr = p.pointedRun;
  if (pr && pr.exists && pr.valid && pr.identityOk && pr.status === 'active') {
    return { result: 'alreadyRunning', runId: p.slotActivePlanRunId };
  }
  return { result: 'integrityConflict', reason: 'slotPointsToInvalidOrTerminalRun' };
}

// p: { slotExists, slotValid, slotActivePlanRunId, thisRunId }
function planRunSlotReleaseDecision(p) {
  if (!p.slotExists || !p.slotValid) return { result: 'integrityConflict', reason: 'slotMissingOrMalformed' };
  if (p.slotActivePlanRunId === p.thisRunId) return { result: 'release' };
  return { result: 'integrityConflict', reason: 'slotNamesAnotherRun' };
}

// End's historical-commit check (spec §12/§13's End outcome table).
// p: { runStatus, runEndedAtSet, slotDecisionResult ('release'|'integrityConflict', only
//      meaningful/consulted when runStatus==='active') }
function planRunClassifyEndRequest(p) {
  if (p.runStatus === 'ended') {
    return p.runEndedAtSet ? { outcome: 'alreadyCommitted' } : { outcome: 'integrityConflict', reason: 'endedWithoutEndedAt' };
  }
  if (p.runStatus === 'complete') {
    return { outcome: 'rejectedTerminalComplete' };
  }
  // runStatus === 'active' (the only remaining legal value once schema
  // validation has passed -- spec §12).
  if (p.slotDecisionResult === 'release') return { outcome: 'confirmedAbsent' };
  return { outcome: 'integrityConflict', reason: 'activeRunSlotMismatch' };
}

// -----------------------------------------------------------------------------
// SLICE 2 ADDITION -- Mark Occurrence In Progress. This transition is named
// by the ui-logger-integration-specification family (round1 §2.6, round8 §7)
// but that family is SPECIFICATION ONLY, never accepted, and never
// implemented it -- there is no existing `fsPlanRunMarkOccurrenceInProgress`
// or equivalent anywhere in this codebase prior to this slice (confirmed by
// direct search before writing any of this). This is new work, not a reuse
// of an existing contract, though it deliberately follows the identical
// read-validate-classify-transact discipline every other operation in this
// file already uses (Start/Finish/End), including full document/identity
// verification and active-slot corroboration before any write -- never a
// bare, unconditional status flip.
//
// Unlike Start/Finish/End, this operation has no operation-receipt document
// and no operationId -- it is a lightweight, idempotent status transition on
// a document that already exists (the occurrence), not a resource-creating
// operation that needs replay protection across a reused idempotency key.
// Idempotency here comes from the transition itself: calling this again on
// an occurrence already `inProgress` is a zero-write, honest no-op
// (`alreadyInProgress`), never a second write and never an error -- this is
// what makes "Resume" (opening an already-in-progress occurrence again)
// safe to call this function from, or to skip calling it entirely, with
// identical net effect.
//
// p: { runExists, occExists, runValid, occValid, runIdentityOk (doc's own
//      ownerUid+planRunId+planTemplateId+headRevisionId match the caller's
//      supplied values -- catches a stale-revision or wrong-Template
//      request), occIdentityOk (doc's own ownerUid+planRunId+occurrenceId
//      match), occurrenceRunMatch (the two documents agree with EACH OTHER,
//      not just each with the caller), runStatus, occurrenceInRemaining,
//      occurrenceStatus, slotExists, slotValid, slotIdentityOk,
//      slotActivePlanRunId, thisRunId }
//
// Slot corroboration is checked here for the same reason Start's own claim
// and Finish/End's own release are both checked against the SAME persisted
// slot document, never assumed from the write model alone: an occurrence
// belonging to a Run that is no longer the slot's own active claim (e.g. a
// prior End/Finish this caller's own screen has not yet learned about) must
// never be silently marked in progress.
function planRunClassifyMarkInProgressRequest(p) {
  if (!p.runExists || !p.occExists) {
    return { outcome: 'requiredDocumentMissing', reason: !p.runExists ? 'runMissing' : 'occurrenceMissing' };
  }
  if (!p.runValid) return { outcome: 'documentMalformed', reason: 'runMalformed' };
  if (!p.occValid) return { outcome: 'documentMalformed', reason: 'occurrenceMalformed' };
  if (!p.runIdentityOk) return { outcome: 'crossDocumentBindingMismatch', reason: 'runIdentity' };
  if (!p.occIdentityOk) return { outcome: 'crossDocumentBindingMismatch', reason: 'occurrenceIdentity' };
  if (!p.occurrenceRunMatch) return { outcome: 'crossDocumentBindingMismatch', reason: 'occurrenceRunMismatch' };
  if (p.runStatus !== 'active') return { outcome: 'integrityConflict', reason: 'runNotActive' };
  if (!p.occurrenceInRemaining) return { outcome: 'integrityConflict', reason: 'occurrenceNotInRemaining' };
  if (!p.slotExists || !p.slotValid) return { outcome: 'integrityConflict', reason: !p.slotExists ? 'slotMissing' : 'slotMalformed' };
  if (!p.slotIdentityOk) return { outcome: 'integrityConflict', reason: 'slotForeign' };
  if (p.slotActivePlanRunId !== p.thisRunId) return { outcome: 'integrityConflict', reason: 'slotMismatch' };
  if (p.occurrenceStatus === 'inProgress') return { outcome: 'alreadyInProgress' };
  if (p.occurrenceStatus !== 'pending') return { outcome: 'integrityConflict', reason: 'occurrenceNotPending' };
  return { outcome: 'eligible' };
}

// Minimal, exact-required-field input validator, mirroring the existing
// planRunValidateCheck*StatusInput family's own "identity fields only, not
// an exact-key check" spirit (Section 6C above): checks only the five
// identity fields fsPlanRunMarkOccurrenceInProgress actually reads before
// touching Firestore -- ownerUid, planRunId, planTemplateId, headRevisionId
// (the last two catch a stale-revision or wrong-Template request before any
// I/O), and occurrenceId.
function planRunValidateMarkInProgressInput(input) {
  if (!planRunIsPlainObject(input)) return { ok: false, reason: 'malformedInputShape' };
  var required = ['ownerUid', 'planRunId', 'planTemplateId', 'headRevisionId', 'occurrenceId'];
  for (var i = 0; i < required.length; i++) {
    if (!planRunIsId(input[required[i]])) return { ok: false, reason: 'malformedInputShape' };
  }
  return { ok: true };
}

// Pure remainingOccurrenceIds advancement (spec §5.1): removes exactly one
// ID by value (never by index), preserving relative order of the rest, and
// recomputes nextOccurrenceId. Returns null if occurrenceId is not actually
// present -- a precondition violation the caller must never let arise on a
// genuinely fresh, committing write.
function planRunRemoveFromRemaining(remaining, occurrenceId) {
  var idx = remaining.indexOf(occurrenceId);
  if (idx === -1) return null;
  var next = remaining.slice(0, idx).concat(remaining.slice(idx + 1));
  return { remainingOccurrenceIds: next, nextOccurrenceId: next.length ? next[0] : null };
}

// =============================================================================
// SECTION 8 -- prepared-package validators (Start/Finish/End) and safety-cap
// preflight (spec §6 step 8, §10's "Transaction size", §12, §13/§14 item 2,
// invariant 17). Numeric cap VALUES are declared in Section 9, immediately
// below, with the measurement method recorded in the implementation report
// (they are NOT guessed, and NOT copied from the unrelated Template-save
// COMMIT_SAFETY_CAPS precedent -- see firebase.js:427-433's own comment,
// which this specification's §13/§15 explicitly says is a STYLE precedent
// only, never a source of the actual numbers for this feature).
// =============================================================================
var PLAN_RUN_PROGRESSION_INITIAL_KEYS = Object.freeze(['planRuleId', 'planAssignmentId', 'ruleRevisionId', 'exerciseId', 'kind', 'amount', 'unit', 'initializationSource']);

function planRunValidateStartPackage(pkg) {
  if (!planRunExactKeys(pkg, ['operationId', 'ownerUid', 'planTemplateId', 'planRunId', 'headRevisionId', 'manifestId', 'graphHash', 'nameSnapshot', 'occurrences', 'progressionInitialValues'])) return { ok: false, reason: 'malformedPackageShape' };
  var idFields = ['operationId', 'ownerUid', 'planTemplateId', 'planRunId', 'headRevisionId', 'manifestId', 'graphHash'];
  if (idFields.some(function (k) { return !planRunIsId(pkg[k]); })) return { ok: false, reason: 'malformedPackageShape' };
  if (typeof pkg.nameSnapshot !== 'string') return { ok: false, reason: 'malformedPackageShape' };
  if (!Array.isArray(pkg.occurrences) || pkg.occurrences.length === 0) return { ok: false, reason: 'noRunnableOccurrences' };
  var seenOccIds = {}, seenOrdinals = {}, allEnabledRuleIds = [];
  for (var i = 0; i < pkg.occurrences.length; i++) {
    var o = pkg.occurrences[i];
    if (!planRunExactKeys(o, ['occurrenceId', 'planMicrocycleId', 'planSessionId', 'microcycleOrdinal', 'sessionOrdinal', 'nameSnapshot', 'assignments'])) return { ok: false, reason: 'malformedOccurrenceShape' };
    if (!planRunIsId(o.occurrenceId) || !planRunIsId(o.planMicrocycleId) || !planRunIsId(o.planSessionId)) return { ok: false, reason: 'malformedOccurrenceShape' };
    if (!planRunIsInteger(o.microcycleOrdinal) || !planRunIsInteger(o.sessionOrdinal)) return { ok: false, reason: 'malformedOccurrenceShape' };
    if (!planRunIsPlainObject(o.nameSnapshot)) return { ok: false, reason: 'malformedOccurrenceShape' };
    if (!planRunAssignmentsRulesStructureValid(o.assignments) || o.assignments.length === 0) return { ok: false, reason: 'malformedOccurrenceShape' };
    if (Object.prototype.hasOwnProperty.call(seenOccIds, o.occurrenceId)) return { ok: false, reason: 'duplicateOccurrenceId' };
    seenOccIds[o.occurrenceId] = true;
    var ordKey = o.microcycleOrdinal + ':' + o.sessionOrdinal;
    if (Object.prototype.hasOwnProperty.call(seenOrdinals, ordKey)) return { ok: false, reason: 'duplicateOrdinalPair' };
    seenOrdinals[ordKey] = true;
    o.assignments.forEach(function (a) { a.rules.forEach(function (r) { if (r.enabled) allEnabledRuleIds.push(r.planRuleId); }); });
  }
  if (planRunArrayHasDuplicates(allEnabledRuleIds)) return { ok: false, reason: 'duplicateEnabledRuleAcrossOccurrences' };
  if (!Array.isArray(pkg.progressionInitialValues)) return { ok: false, reason: 'malformedProgressionInitialValues' };
  var providedRuleIds = {};
  for (var j = 0; j < pkg.progressionInitialValues.length; j++) {
    var v = pkg.progressionInitialValues[j];
    if (!planRunExactKeys(v, PLAN_RUN_PROGRESSION_INITIAL_KEYS)) return { ok: false, reason: 'malformedProgressionInitialValues' };
    if (!planRunIsId(v.planRuleId) || !planRunIsId(v.planAssignmentId) || !planRunIsId(v.ruleRevisionId) || !planRunIsId(v.exerciseId)) return { ok: false, reason: 'malformedProgressionInitialValues' };
    if (!PLAN_RUN_VALUE_KINDS.includes(v.kind) || typeof v.amount !== 'number' || !Number.isFinite(v.amount) || !PLAN_RUN_VALUE_UNITS.includes(v.unit)) return { ok: false, reason: 'malformedProgressionInitialValues' };
    if (!['manual', 'confirmedFromSuggestion'].includes(v.initializationSource)) return { ok: false, reason: 'malformedProgressionInitialValues' };
    if (Object.prototype.hasOwnProperty.call(providedRuleIds, v.planRuleId)) return { ok: false, reason: 'duplicateProgressionInitialValue' };
    providedRuleIds[v.planRuleId] = true;
  }
  // Exactly one initial value per enabled Rule -- no fewer, no extras (spec
  // §6 step 5: "one progression-state record per enabled Rule").
  if (allEnabledRuleIds.length !== Object.keys(providedRuleIds).length) return { ok: false, reason: 'progressionInitialValuesDoNotMatchEnabledRules' };
  for (var k = 0; k < allEnabledRuleIds.length; k++) {
    if (!providedRuleIds[allEnabledRuleIds[k]]) return { ok: false, reason: 'progressionInitialValuesDoNotMatchEnabledRules' };
  }
  return { ok: true };
}

function planRunValidateFinishPackage(pkg) {
  if (!planRunExactKeys(pkg, ['operationId', 'ownerUid', 'planRunId', 'occurrenceId', 'workoutId', 'workout'])) return { ok: false, reason: 'malformedPackageShape' };
  var idFields = ['operationId', 'ownerUid', 'planRunId', 'occurrenceId', 'workoutId'];
  if (idFields.some(function (k) { return !planRunIsId(pkg[k]); })) return { ok: false, reason: 'malformedPackageShape' };
  if (!planRunWorkoutDocValid(pkg.workout)) return { ok: false, reason: 'malformedWorkoutShape' };
  if (pkg.workout.id !== pkg.workoutId || pkg.workout.ownerUid !== pkg.ownerUid || pkg.workout.planRunId !== pkg.planRunId || pkg.workout.planOccurrenceId !== pkg.occurrenceId) {
    return { ok: false, reason: 'workoutIdentityDisagreesWithRequest' };
  }
  return { ok: true };
}

function planRunValidateEndPackage(pkg) {
  if (!planRunExactKeys(pkg, ['operationId', 'ownerUid', 'planRunId'])) return { ok: false, reason: 'malformedPackageShape' };
  if (!planRunIsId(pkg.operationId) || !planRunIsId(pkg.ownerUid) || !planRunIsId(pkg.planRunId)) return { ok: false, reason: 'malformedPackageShape' };
  return { ok: true };
}

// ROUND 13 IMPLEMENTATION ADDITION -- Begin's own package
// (program-run-authoritative-end-recovery-specification-round12.md SS6.1,
// carried from Round 1/2). Identical minimal shape to End's own package --
// Begin's own precondition set never checks anything beyond these three
// identity fields (SS6.1's own explicit "what Begin does not re-validate,
// and why not"). Kept as its own named function, per this codebase's
// established one-validator-per-operation convention, even though the
// shape is byte-for-byte identical to planRunValidateEndPackage.
function planRunValidateBeginEndPackage(pkg) {
  if (!planRunExactKeys(pkg, ['ownerUid', 'planRunId', 'operationId'])) return { ok: false, reason: 'malformedPackageShape' };
  if (!planRunIsId(pkg.ownerUid) || !planRunIsId(pkg.planRunId) || !planRunIsId(pkg.operationId)) return { ok: false, reason: 'malformedPackageShape' };
  return { ok: true };
}

// ROUND 13 IMPLEMENTATION ADDITION -- Cancel's own package (spec SS6.5,
// named precisely in Round 2 SS6.5: "identical in shape to End's own
// minimal package"). Cancel's own `operationId` is never a fresh id it
// mints for itself -- it is the PENDING END's own operationId (SS6.5(1)) --
// so this validator checks only shape, exactly like End's own.
function planRunValidateCancelEndPackage(pkg) {
  if (!planRunExactKeys(pkg, ['operationId', 'ownerUid', 'planRunId'])) return { ok: false, reason: 'malformedPackageShape' };
  if (!planRunIsId(pkg.operationId) || !planRunIsId(pkg.ownerUid) || !planRunIsId(pkg.planRunId)) return { ok: false, reason: 'malformedPackageShape' };
  return { ok: true };
}

// ROUND 13 IMPLEMENTATION ADDITION -- Abandon-Occurrence's own package
// (spec SS6.5b, fully specified since Round 3). `operationId` here is NOT
// a fresh id Abandon generates for itself -- it is the currently-pending
// End's own operationId, required so this action is scoped to "unblocking
// one specific, named, currently-pending End attempt" (the narrowest safe
// scope), never a general-purpose "revert any session" tool.
function planRunValidateAbandonOccurrencePackage(pkg) {
  if (!planRunExactKeys(pkg, ['ownerUid', 'planRunId', 'occurrenceId', 'operationId'])) return { ok: false, reason: 'malformedPackageShape' };
  if (!planRunIsId(pkg.ownerUid) || !planRunIsId(pkg.planRunId) || !planRunIsId(pkg.occurrenceId) || !planRunIsId(pkg.operationId)) return { ok: false, reason: 'malformedPackageShape' };
  return { ok: true };
}

// =============================================================================
// SECTION 9 -- the declared, safety-margined caps (spec §13/§14 item 2,
// invariant 17) and the pure, zero-Firestore-write preflight checks built on
// them (spec §6 step 8, §10, §12). SEE THE IMPLEMENTATION REPORT for the
// exact measurement method and real measured numbers this round's
// measurement pass produced -- these are not asserted, and not copied from
// the unrelated Template-save COMMIT_SAFETY_CAPS precedent (firebase.js's
// own comment at line 419-426 is explicit that its style, not its numbers,
// is what carries over).
// =============================================================================
var PLAN_RUN_SAFETY_CAPS = Object.freeze({
  maxOccurrencesPerRun: 400,
  maxAssignmentsPerOccurrence: 40,
  maxOrderedSetsPerAssignment: 40,
  maxEnabledRulesPerOccurrence: 40,
  // maxStartTransactionWrites: Cloud Firestore hard-caps every transaction
  // (like every batch write) at 500 total document writes -- a platform
  // ceiling, not a tunable choice. The measurement pass's own formula
  // (writes = 3 + N + N*R) confirmed the worst still-useful case
  // (N=400 occurrences, R=0 enabled Rules each) needs exactly 403 writes,
  // leaving headroom for up to ~97 total enabled Rules spread across the
  // whole Run before this cap, not Firestore's own hard limit, is what
  // rejects a package. The previous value here (900) exceeded Firestore's
  // real limit, which would have let preflight approve a package Firestore
  // itself would then refuse at commit time -- a false negative this
  // correction closes.
  maxStartTransactionWrites: 500,
  // ROUND 2 CORRECTION (section 1): this was declared as `3` and never
  // actually enforced anywhere (planRunPreflightStart checked writes/bytes
  // only). Round 2 also adds one further FIXED read to Start's own
  // transaction (the operation-receipt read, section 2's reuse guard) --
  // Start's real worst-case read count is now
  // receipt(1) + Run(1) + slot(1) + conditional pointedRun(1) = 4, which is
  // what this is corrected to, and what planRunPreflightStart now actually
  // checks (below).
  maxStartTransactionReads: 4,
  maxFinishTransactionWrites: 90,
  maxFinishTransactionReads: 130,
  maxEndTransactionWrites: 420,
  // ROUND 2 CORRECTION (section 1): the prior round declared this as `2`
  // (fixed Run+slot reads only) and never actually enforced it anywhere --
  // planRunPreflightEnd checked writes only, not reads. End's real read
  // count is `3 + remainingOccurrenceCount` (receipt + Run + slot + one
  // read per still-unfinished occurrence -- the receipt read is itself
  // this same round's own section-2 addition to End's transaction, see
  // endReadAndClassify's comment in firebase-plan-run.js; an EARLIER pass
  // of this correction mistakenly left this formula at its pre-receipt-read
  // value of `2 + remaining`, which this fix corrects). Confirmed by
  // plan-run-safety-budget-measurement.js's own literal output, e.g.
  // "remaining=50: reads=53/53". At the declared maxOccurrencesPerRun cap
  // (400), End's worst-case read count is 3+400=403 -- this is what the cap
  // is corrected to, and planRunPreflightEnd/planRunCheckEndBudget (below)
  // now actually check it.
  maxEndTransactionReads: 403,
  maxEstimatedRequestBytes: 6 * 1024 * 1024,
  maxOccurrenceDocumentBytes: 768 * 1024,
  maxRunDocumentBytes: 256 * 1024,
  maxWorkoutDocumentBytes: 256 * 1024,
  // ROUND 3 CORRECTION (finding 3) -- two further per-collection final-
  // document caps this round adds real enforcement for (see Section 9B
  // below). Every field in `planProgramRunProgressionState` (§5.3) and
  // `planProgramRunApplications` (§5.4) is a fixed-cardinality
  // id/enum/number/timestamp with no free-text field at all, so a genuine
  // document in either collection is bounded to at most a few hundred
  // bytes by construction -- these caps are deliberately generous relative
  // to that real worst case (a wide safety margin, not a tight fit),
  // consistent with this file's existing caps' own stated margin philosophy.
  // `maxGenericDocumentBytes` is the same generous backstop applied to the
  // remaining, structurally small collections this round's aggregate check
  // also covers (`planProgramRunActiveSlot`, `planProgramRunOperations`) --
  // an operation receipt's `resultRefs.appliedRuleIds`/
  // `needsManualReviewRuleIds` arrays are the only even moderately variable
  // field here (up to `maxEnabledRulesPerOccurrence` id strings each, at
  // most 200 bytes per id per `planRunIsId`), comfortably inside this cap.
  maxProgressionStateDocumentBytes: 16 * 1024,
  maxGenericDocumentBytes: 64 * 1024
});

function planRunPreflightStart(pkg) {
  var reasons = [];
  var v = planRunValidateStartPackage(pkg);
  if (!v.ok) return { ok: false, reasons: [v.reason] };
  var occCount = pkg.occurrences.length;
  if (occCount > PLAN_RUN_SAFETY_CAPS.maxOccurrencesPerRun) reasons.push('tooManyOccurrences');
  var maxAssignmentsSeen = 0, maxSetsSeen = 0, enabledRuleCount = 0;
  var occurrenceBytesTotal = 0;
  pkg.occurrences.forEach(function (o) {
    maxAssignmentsSeen = Math.max(maxAssignmentsSeen, o.assignments.length);
    o.assignments.forEach(function (a) {
      maxSetsSeen = Math.max(maxSetsSeen, a.orderedSets.length);
      enabledRuleCount += a.rules.filter(function (r) { return r.enabled; }).length;
    });
    var b = planRunEstimateDocBytes(o);
    occurrenceBytesTotal += b;
    if (b > PLAN_RUN_SAFETY_CAPS.maxOccurrenceDocumentBytes) reasons.push('occurrenceDocumentTooLarge');
  });
  if (maxAssignmentsSeen > PLAN_RUN_SAFETY_CAPS.maxAssignmentsPerOccurrence) reasons.push('tooManyAssignmentsInOneOccurrence');
  if (maxSetsSeen > PLAN_RUN_SAFETY_CAPS.maxOrderedSetsPerAssignment) reasons.push('tooManySetsInOneAssignment');
  if (enabledRuleCount > PLAN_RUN_SAFETY_CAPS.maxEnabledRulesPerOccurrence * occCount) reasons.push('tooManyEnabledRules');
  var estimatedWrites = 3 + occCount + enabledRuleCount; // Run + slot(claim) + receipt, plus one write per occurrence and per enabled-Rule progression-state doc
  if (estimatedWrites > PLAN_RUN_SAFETY_CAPS.maxStartTransactionWrites) reasons.push('tooManyWrites');
  var estimatedBytes = occurrenceBytesTotal + planRunEstimateDocBytes({ pkg: pkg });
  if (estimatedBytes > PLAN_RUN_SAFETY_CAPS.maxEstimatedRequestBytes) reasons.push('estimatedRequestTooLarge');
  // ROUND 2 CORRECTION (section 1): Start's own read count is a small FIXED
  // number (receipt + Run + slot + conditional pointedRun), never dependent
  // on package size -- this check is always trivially satisfied by
  // construction today, but is included anyway so a future change to
  // Start's own read pattern cannot silently exceed the declared cap
  // unnoticed.
  var estimatedReads = 4;
  if (estimatedReads > PLAN_RUN_SAFETY_CAPS.maxStartTransactionReads) reasons.push('tooManyReads');
  return { ok: reasons.length === 0, reasons: reasons, estimatedReads: estimatedReads, estimatedWrites: estimatedWrites, estimatedBytes: estimatedBytes, enabledRuleCount: enabledRuleCount };
}

// ROUND 2 CORRECTION (section 1): the pure read/write-count math is now
// factored out of planRunPreflightFinish/planRunPreflightEnd into these two
// standalone estimator/checker pairs, so the SAME formulas can be re-run
// inside the real transaction (firebase-plan-run.js) against the ACTUAL,
// freshly-read enabled-Rule count / remaining-occurrence count -- never a
// caller-supplied count taken on faith. planRunPreflightFinish/End
// (below) are kept as the pre-existing, request-time ADVISORY entry points
// (their own `expectedRuleCount`/`remainingOccurrenceCount` parameters
// remain exactly what they were: a caller's own best-effort, non-binding
// estimate, useful for a client to short-circuit before even building a
// request) -- they are no longer the only place this math is enforced.
function planRunEstimateFinishBudget(enabledRuleCount) {
  // See planRunPreflightFinish's own comment for what each term counts.
  var estimatedReads = 3 + (2 * enabledRuleCount) + 1 + enabledRuleCount + 1;
  var estimatedWrites = 4 + 1 + (2 * enabledRuleCount);
  return { estimatedReads: estimatedReads, estimatedWrites: estimatedWrites };
}
function planRunCheckFinishBudget(enabledRuleCount, workoutBytes) {
  var reasons = [];
  if (typeof workoutBytes === 'number' && workoutBytes > PLAN_RUN_SAFETY_CAPS.maxWorkoutDocumentBytes) reasons.push('workoutDocumentTooLarge');
  if (enabledRuleCount > PLAN_RUN_SAFETY_CAPS.maxEnabledRulesPerOccurrence) reasons.push('tooManyEnabledRules');
  var budget = planRunEstimateFinishBudget(enabledRuleCount);
  if (budget.estimatedReads > PLAN_RUN_SAFETY_CAPS.maxFinishTransactionReads) reasons.push('tooManyReads');
  if (budget.estimatedWrites > PLAN_RUN_SAFETY_CAPS.maxFinishTransactionWrites) reasons.push('tooManyWrites');
  return { ok: reasons.length === 0, reasons: reasons, estimatedReads: budget.estimatedReads, estimatedWrites: budget.estimatedWrites };
}
function planRunEstimateEndBudget(remainingOccurrenceCount) {
  // ROUND 2 CORRECTION (section 1): estimatedReads corrected from
  // `2 + remainingOccurrenceCount` to `3 + remainingOccurrenceCount` --
  // receipt + Run + slot (all three fixed, unconditional reads in
  // endReadAndClassify) + one read per still-unfinished occurrence. See
  // PLAN_RUN_SAFETY_CAPS.maxEndTransactionReads's own comment for the full
  // history of this fix.
  return { estimatedReads: 3 + remainingOccurrenceCount, estimatedWrites: 3 + remainingOccurrenceCount };
}
function planRunCheckEndBudget(remainingOccurrenceCount) {
  var reasons = [];
  if (remainingOccurrenceCount > PLAN_RUN_SAFETY_CAPS.maxOccurrencesPerRun) reasons.push('tooManyRemainingOccurrences');
  var budget = planRunEstimateEndBudget(remainingOccurrenceCount);
  if (budget.estimatedReads > PLAN_RUN_SAFETY_CAPS.maxEndTransactionReads) reasons.push('tooManyReads');
  if (budget.estimatedWrites > PLAN_RUN_SAFETY_CAPS.maxEndTransactionWrites) reasons.push('tooManyWrites');
  return { ok: reasons.length === 0, reasons: reasons, estimatedReads: budget.estimatedReads, estimatedWrites: budget.estimatedWrites };
}

// expectedRuleCount is known to the client before Finish is even attempted
// (it is the same occurrence document the logger opened against). This
// remains an ADVISORY, request-time check only -- see this section's own
// header comment; the real, non-bypassable enforcement against the
// ACTUAL, freshly-read enabled-Rule count now lives in
// firebase-plan-run.js's finishReadAndClassify, via planRunCheckFinishBudget
// above.
function planRunPreflightFinish(pkg, expectedRuleCount) {
  var v = planRunValidateFinishPackage(pkg);
  if (!v.ok) return { ok: false, reasons: [v.reason] };
  var workoutBytes = planRunEstimateDocBytes(pkg.workout);
  var check = planRunCheckFinishBudget(expectedRuleCount, workoutBytes);
  return { ok: check.ok, reasons: check.reasons, estimatedReads: check.estimatedReads, estimatedWrites: check.estimatedWrites, estimatedBytes: workoutBytes };
}

// remainingOccurrenceCount is likewise an ADVISORY, request-time estimate
// only -- the real enforcement against the Run document's OWN, freshly-read
// remainingOccurrenceIds.length now lives in firebase-plan-run.js's
// endReadAndClassify, via planRunCheckEndBudget above.
function planRunPreflightEnd(pkg, remainingOccurrenceCount) {
  var v = planRunValidateEndPackage(pkg);
  if (!v.ok) return { ok: false, reasons: [v.reason] };
  var check = planRunCheckEndBudget(remainingOccurrenceCount);
  return { ok: check.ok, reasons: check.reasons, estimatedReads: check.estimatedReads, estimatedWrites: check.estimatedWrites };
}

// =============================================================================
// SECTION 9B (ROUND 3 CORRECTION, finding 3) -- a realistic, documented
// Firestore-value-size estimator, and the ACTUAL-staged-write-set
// enforcement (final document size, per collection, plus aggregate
// transaction byte estimate) this round adds. See
// plan-run-safety-budget-measurement.js and the round3 correction report
// for the measured worked examples this section's own numbers are checked
// against.
//
// WHAT WAS MISSING BEFORE THIS ROUND (confirmed by inspection, not assumed):
// `PLAN_RUN_SAFETY_CAPS.maxRunDocumentBytes` was declared but NEVER READ
// anywhere in this file or firebase-plan-run.js -- a genuinely unenforced
// cap. `maxOccurrenceDocumentBytes` was checked only against the CALLER'S
// OWN REQUEST-TIME occurrence package at Start's advisory preflight
// (`planRunPreflightStart`) -- never against the REAL, already-persisted
// occurrence document Finish/End actually PATCH (`tx.update`), so an
// existing large document already at/near its cap, receiving even a
// one-field patch, was never rechecked at its real, final, post-merge size
// before that patch was committed. `maxWorkoutDocumentBytes` was the one
// genuinely enforced final-document check (the workout is always a fresh
// `tx.set`, so its request-time byte count already equals its final size)
// -- left unchanged here. No aggregate byte estimate of the ACTUAL staged
// write set (as opposed to the caller's own request payload) existed at
// all for Finish or End; Start had a REQUEST-time aggregate estimate only
// (`estimatedRequestTooLarge`), never rechecked against the real,
// freshly-built write set immediately before commit the way this round's
// write-COUNT recheck (`actualWriteCount`, Round 2) already does.
//
// ESTIMATOR METHODOLOGY, STATED HONESTLY. Two independent byte estimates
// are combined, never just one:
//   (1) `planRunEstimateDocBytes` (unchanged, Section 1 above) -- the raw
//       UTF-8 byte length of `JSON.stringify(data)`. This OVER-counts a
//       Firestore Timestamp field (this codebase's own in-memory
//       `{seconds,nanoseconds}` shape serializes to roughly 35 JSON bytes,
//       versus Firestore's own real internal Timestamp encoding, which is
//       far smaller) and OVER-counts booleans (`true`/`false` as 4-5 JSON
//       bytes vs. Firestore's documented 1-byte boolean cost) and null (4
//       JSON bytes vs. Firestore's documented 1-byte cost) -- safe
//       over-estimates. It UNDER-counts a small numeric field (e.g. the
//       literal digits of `5` is 1 JSON byte, versus Firestore's documented
//       fixed 8-byte numeric-value cost) and does not add Firestore's own
//       documented fixed per-document/per-map/per-field-name overhead at
//       all -- unsafe under-estimates for a document with many numeric
//       fields (exactly this slice's own `prescribed`/`performed` shapes,
//       which are numeric-field-heavy).
//   (2) `planRunEstimateFirestoreDocBytes` (new below) -- implements
//       Google's own publicly documented Cloud Firestore storage-size
//       accounting rules: a fixed per-type byte cost for null (1), boolean
//       (1), number/integer/float (8), and Timestamp (8); UTF-8 length + 1
//       for a string value; a further UTF-8-length-of-field-name + 1
//       overhead for every named field; +16 bytes for every map/document
//       nesting level; and a flat +32-byte fixed base overhead per
//       document. This is a documented STORAGE-size formula, not a
//       separately-published wire/transaction-size formula (Google does not
//       publish the latter) -- so it is itself only a well-reasoned PROXY
//       for real transaction/commit-request size, not a certified exact
//       figure, and this file makes no claim otherwise anywhere.
// Because the two methods diverge in different, uncorrelated directions
// for different field shapes (numbers vs. timestamps vs. strings vs.
// booleans), this file's own established idiom -- "cross-checking an
// untrusted package's own claimed byte count against a second, independent
// measurement is stronger than trusting a single count" (see
// `planRunUtf8ByteLength`'s own header comment, Section 1) -- is applied
// again here: `planRunEstimateFinalDocBytes` takes the LARGER of the two
// independently-computed numbers, then applies a further explicit
// `PLAN_RUN_SIZE_MARGIN_FACTOR` (20%) of headroom on top, so neither a
// transcription mistake in the second method's hand-copied per-type
// constants nor either method's own known blind spots can silently produce
// a false "under cap" result. This is a CONSERVATIVE ESTIMATE WITH A STATED
// SAFETY MARGIN -- never asserted as an exact Firestore wire-size
// measurement.
//
// PROVIDER LIMITS RELIED ON (stated honestly, per the task's own
// instruction to verify or flag uncertainty rather than assert blindly):
// Cloud Firestore's published maximum document size is 1 MiB (1,048,576
// bytes) and its published maximum writes per transaction/batch is 500 --
// both well-established, high-confidence figures independently corroborated
// by this codebase's own pre-existing `firebase.js` COMMIT_SAFETY_CAPS
// comment (`firebase.js:419-433`) and by `PLAN_RUN_SAFETY_CAPS.
// maxStartTransactionWrites`'s own comment above, neither of which this
// round disputes or changes. An approximate "~10 MiB total per transaction"
// aggregate-request-size figure is also commonly cited for Cloud Firestore,
// and this round's own `maxEstimatedRequestBytes` application cap (6 MiB,
// unchanged since Round 1) was already deliberately set well below it as a
// safety margin -- but this file does NOT independently re-verify that
// specific ~10 MiB figure against a live, current Firestore document in
// this session (no network fetch of Google's own current documentation was
// performed for this correction), so it is presented here as a
// commonly-cited, plausible figure this file's own 6 MiB application cap
// stays safely under, not as an independently re-confirmed certainty --
// see the round3 correction report for this same caveat stated to the
// reviewer directly, rather than silently assumed.
// =============================================================================
var PLAN_RUN_SIZE_MARGIN_FACTOR = 1.2; // +20% conservative headroom -- see header above.
// A conservative, DECLARED (never independently verified against a real
// Firestore wire capture in this sandboxed session -- no live/emulator
// Firestore access exists here, per this delivery's own environment
// constraint) fixed allowance for what one write actually costs beyond its
// own document payload inside a real commit/transaction request: the target
// document's full resource path (encoded again in the request), plus
// protobuf message-framing/field-tag overhead for the write's own envelope.
// Chosen to be generous rather than tight, exactly like this section's other
// margin choices -- if this number is wrong, the intended failure direction
// is "rejects a transaction Firestore would have accepted" (safe), never
// the reverse.
var PLAN_RUN_WRITE_PATH_OVERHEAD_BYTES = 96;

// Firestore's own documented per-value storage-size cost (see this
// section's header comment for the full citation/caveat). Recurses through
// arrays (sum of element costs, no per-element name overhead -- array
// elements are not separately named) and maps/documents (a flat +16 bytes,
// plus every own key's UTF-8-name-length + 1 overhead, plus that key's own
// value cost).
function planRunEstimateFirestoreValueBytes(v) {
  if (v === null || v === undefined) return 1;
  if (typeof v === 'boolean') return 1;
  if (typeof v === 'number') return 8;
  if (typeof v === 'string') return planRunUtf8ByteLength(v) + 1;
  if (planRunIsTimestamp(v)) return 8;
  if (Array.isArray(v)) {
    var sum = 0;
    for (var i = 0; i < v.length; i++) sum += planRunEstimateFirestoreValueBytes(v[i]);
    return sum;
  }
  if (planRunIsPlainObject(v)) {
    var total = 16; // map/nesting overhead
    Object.keys(v).forEach(function (k) { total += planRunUtf8ByteLength(k) + 1 + planRunEstimateFirestoreValueBytes(v[k]); });
    return total;
  }
  // Defensive: a value type this model never legitimately produces (a
  // function, a Symbol, `undefined` inside an array, etc.) is estimated at
  // a deliberately large, unmissable size rather than silently returning 0
  // -- an estimator must never silently under-count an input it does not
  // recognize.
  return 4096;
}
function planRunEstimateFirestoreDocBytes(data) {
  try {
    if (!planRunIsPlainObject(data)) return planRunEstimateFirestoreValueBytes(data);
    var total = 32; // fixed per-document base overhead (Firestore's own documented storage-size formula)
    Object.keys(data).forEach(function (k) { total += planRunUtf8ByteLength(k) + 1 + planRunEstimateFirestoreValueBytes(data[k]); });
    return total;
  } catch (e) { return Infinity; }
}
// The single entry point every final-document-size decision in this round
// uses -- never `planRunEstimateDocBytes` alone for a NEW cap decision this
// round adds (see this section's header for why either method alone is
// insufficient).
function planRunEstimateFinalDocBytes(data) {
  var a = planRunEstimateDocBytes(data);
  var b = planRunEstimateFirestoreDocBytes(data);
  return Math.ceil(Math.max(a, b) * PLAN_RUN_SIZE_MARGIN_FACTOR);
}
// Maps a staged write's declared `kind` to the per-collection final-document
// cap that applies to it (Section 9's PLAN_RUN_SAFETY_CAPS, extended above).
function planRunFinalDocumentByteCapFor(kind) {
  if (kind === 'run') return PLAN_RUN_SAFETY_CAPS.maxRunDocumentBytes;
  if (kind === 'occurrence') return PLAN_RUN_SAFETY_CAPS.maxOccurrenceDocumentBytes;
  if (kind === 'workout') return PLAN_RUN_SAFETY_CAPS.maxWorkoutDocumentBytes;
  if (kind === 'progressionState') return PLAN_RUN_SAFETY_CAPS.maxProgressionStateDocumentBytes;
  return PLAN_RUN_SAFETY_CAPS.maxGenericDocumentBytes;
}
// The real, non-bypassable check every one of Start/Finish/End now runs
// against its OWN actual staged write set, built from real data (freshly
// read existing documents merged with the real patch about to be applied,
// or the real freshly-built document for a fresh `tx.set`) -- immediately
// before the first `tx.set`/`tx.update` call, exactly mirroring where
// Round 2's own `actualWriteCount` recheck already runs, so a rejection
// here leaves zero writes issued.
//
// `writes`: an array of `{ path, kind, data }`, where `data` is the REAL,
// COMPLETE, FINAL document this write leaves in place at `path` --
// for a fresh `tx.set`, the document being set; for a `tx.update` PATCH to
// an existing document, the caller's own already-merged
// `Object.assign({}, existingDoc, patch)` result, NEVER the bare patch
// object alone (that is precisely the "small patch hides an oversized
// final document" gap this round closes -- see the header comment above).
function planRunCheckStagedTransactionBytes(writes) {
  var reasons = [];
  var perWrite = [];
  var aggregateBytes = 0;
  for (var i = 0; i < writes.length; i++) {
    var w = writes[i];
    var finalBytes = planRunEstimateFinalDocBytes(w.data);
    var cap = planRunFinalDocumentByteCapFor(w.kind);
    perWrite.push({ path: w.path, kind: w.kind, bytes: finalBytes, cap: cap });
    if (finalBytes > cap) reasons.push('finalDocumentTooLarge:' + w.kind);
    aggregateBytes += finalBytes + planRunUtf8ByteLength(w.path) + PLAN_RUN_WRITE_PATH_OVERHEAD_BYTES;
  }
  if (aggregateBytes > PLAN_RUN_SAFETY_CAPS.maxEstimatedRequestBytes) reasons.push('aggregateTransactionTooLarge');
  return { ok: reasons.length === 0, reasons: reasons, aggregateBytes: aggregateBytes, perWrite: perWrite };
}

// -----------------------------------------------------------------------------
// Guarded Node export block -- exactly matching app-plan.js's own bottom-of-
// file `if (typeof module !== 'undefined' ...)` shape (this file has no
// browser load path at all yet, so this guard is a no-op in every real
// context, but is kept anyway for consistency with the codebase's own
// established convention and in case this file is ever loaded as a plain
// classic <script>, where these become ordinary globals instead).
// -----------------------------------------------------------------------------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PLAN_RUN_COLLECTIONS: PLAN_RUN_COLLECTIONS,
    PLAN_RUN_REVIEW_REASONS: PLAN_RUN_REVIEW_REASONS,
    PLAN_RUN_VALUE_KINDS: PLAN_RUN_VALUE_KINDS,
    PLAN_RUN_VALUE_UNITS: PLAN_RUN_VALUE_UNITS,
    PLAN_RUN_STATUSES: PLAN_RUN_STATUSES,
    PLAN_RUN_OCCURRENCE_STATUSES: PLAN_RUN_OCCURRENCE_STATUSES,
    PLAN_RUN_OPERATION_TYPES: PLAN_RUN_OPERATION_TYPES,
    PLAN_RUN_SAFETY_CAPS: PLAN_RUN_SAFETY_CAPS,
    planRunIsPlainObject: planRunIsPlainObject,
    planRunExactKeys: planRunExactKeys,
    planRunIsId: planRunIsId,
    planRunIsTimestamp: planRunIsTimestamp,
    planRunIsNullableId: planRunIsNullableId,
    planRunIsNullableTimestamp: planRunIsNullableTimestamp,
    planRunIsFiniteOrNull: planRunIsFiniteOrNull,
    planRunIsFiniteNumber: planRunIsFiniteNumber,
    planRunDeepClone: planRunDeepClone,
    planRunArrayHasDuplicates: planRunArrayHasDuplicates,
    planRunUtf8ByteLength: planRunUtf8ByteLength,
    planRunEstimateDocBytes: planRunEstimateDocBytes,
    planRunBuildOccurrenceId: planRunBuildOccurrenceId,
    planRunBuildRuleStateId: planRunBuildRuleStateId,
    planRunBuildApplicationId: planRunBuildApplicationId,
    planRunBuildActiveSlotId: planRunBuildActiveSlotId,
    planRunCurrentValueValid: planRunCurrentValueValid,
    planRunPrescribedValid: planRunPrescribedValid,
    planRunRuleEntryValid: planRunRuleEntryValid,
    planRunOrderedSetValid: planRunOrderedSetValid,
    planRunAssignmentsRulesStructureValid: planRunAssignmentsRulesStructureValid,
    planRunOccurrenceDocValid: planRunOccurrenceDocValid,
    planRunDocValid: planRunDocValid,
    planRunProgressionStateDocValid: planRunProgressionStateDocValid,
    planRunApplicationDocValid: planRunApplicationDocValid,
    planRunSlotDocValid: planRunSlotDocValid,
    planRunOperationResultRefsValid: planRunOperationResultRefsValid,
    planRunOperationDocValid: planRunOperationDocValid,
    // ROUND 13 IMPLEMENTATION additions (program-run-authoritative-end-
    // recovery-specification-round12.md SS6.2a) -- operation-type/outcome
    // compatibility invariant, and the cancelled-shape evidence.
    planRunOperationOutcomeOk: planRunOperationOutcomeOk,
    planRunOperationCancelledShapeOk: planRunOperationCancelledShapeOk,
    planRunOccurrenceIdentityOk: planRunOccurrenceIdentityOk,
    planRunDocIdentityOk: planRunDocIdentityOk,
    planRunStateIdentityOk: planRunStateIdentityOk,
    planRunApplicationIdentityOk: planRunApplicationIdentityOk,
    planRunSlotIdentityOk: planRunSlotIdentityOk,
    planRunOperationIdentityOk: planRunOperationIdentityOk,
    planRunActiveSlotIdOk: planRunActiveSlotIdOk,
    // CANONICAL WORKOUT-SHAPE AMENDMENT -- planRunWorkoutPerformedValid is
    // retired along with the nested `performed` shape it validated;
    // planRunWorkoutSetValid is its amended, flat-shape replacement.
    planRunWorkoutSetValid: planRunWorkoutSetValid,
    planRunWorkoutDocValid: planRunWorkoutDocValid,
    planRunClassifyWorkoutDiscriminator: planRunClassifyWorkoutDiscriminator,
    planRunWorkoutContextMatchesOccurrence: planRunWorkoutContextMatchesOccurrence,
    planRunSetHasValidCompletionEvidence: planRunSetHasValidCompletionEvidence,
    planRunOccurrenceEligibleForCompletion: planRunOccurrenceEligibleForCompletion,
    planRunBuildProgressionTriple: planRunBuildProgressionTriple,
    planRunFinishStructuralBoundaryOk: planRunFinishStructuralBoundaryOk,
    planRunClassifyFinishOccurrence: planRunClassifyFinishOccurrence,
    planRunClassifyStartRequest: planRunClassifyStartRequest,
    planRunSlotClaimDecision: planRunSlotClaimDecision,
    planRunSlotReleaseDecision: planRunSlotReleaseDecision,
    planRunClassifyEndRequest: planRunClassifyEndRequest,
    // SLICE 2 additions -- Mark Occurrence In Progress.
    planRunClassifyMarkInProgressRequest: planRunClassifyMarkInProgressRequest,
    planRunValidateMarkInProgressInput: planRunValidateMarkInProgressInput,
    planRunRemoveFromRemaining: planRunRemoveFromRemaining,
    planRunValidateStartPackage: planRunValidateStartPackage,
    planRunValidateFinishPackage: planRunValidateFinishPackage,
    planRunValidateEndPackage: planRunValidateEndPackage,
    // ROUND 13 IMPLEMENTATION additions -- Begin/Cancel/Abandon package
    // validators (spec SS6.1/SS6.5/SS6.5b).
    planRunValidateBeginEndPackage: planRunValidateBeginEndPackage,
    planRunValidateCancelEndPackage: planRunValidateCancelEndPackage,
    planRunValidateAbandonOccurrencePackage: planRunValidateAbandonOccurrencePackage,
    planRunPreflightStart: planRunPreflightStart,
    planRunPreflightFinish: planRunPreflightFinish,
    planRunPreflightEnd: planRunPreflightEnd,
    // ROUND 2 CORRECTION additions (sections 1-3).
    planRunEstimateFinishBudget: planRunEstimateFinishBudget,
    planRunCheckFinishBudget: planRunCheckFinishBudget,
    planRunEstimateEndBudget: planRunEstimateEndBudget,
    planRunCheckEndBudget: planRunCheckEndBudget,
    planRunClassifyOperationReceiptGuard: planRunClassifyOperationReceiptGuard,
    planRunValidateCheckStartStatusInput: planRunValidateCheckStartStatusInput,
    planRunValidateCheckFinishStatusInput: planRunValidateCheckFinishStatusInput,
    planRunValidateCheckEndStatusInput: planRunValidateCheckEndStatusInput,
    // ROUND 3 CORRECTION additions (finding 3 -- realistic byte estimator +
    // actual-staged-write-set enforcement).
    PLAN_RUN_SIZE_MARGIN_FACTOR: PLAN_RUN_SIZE_MARGIN_FACTOR,
    PLAN_RUN_WRITE_PATH_OVERHEAD_BYTES: PLAN_RUN_WRITE_PATH_OVERHEAD_BYTES,
    planRunEstimateFirestoreValueBytes: planRunEstimateFirestoreValueBytes,
    planRunEstimateFirestoreDocBytes: planRunEstimateFirestoreDocBytes,
    planRunEstimateFinalDocBytes: planRunEstimateFinalDocBytes,
    planRunFinalDocumentByteCapFor: planRunFinalDocumentByteCapFor,
    planRunCheckStagedTransactionBytes: planRunCheckStagedTransactionBytes,
    // SLICE 1 additions (active-Run discovery / read-only ReadForDisplay
    // support): shared cross-document binding check plus the v2 pagination
    // cursor encode/decode pair used by fsPlanRunListActiveRuns.
    planRunOccurrenceRunBindingOk: planRunOccurrenceRunBindingOk,
    // FOUNDATION SLICE additions -- slot-state corroboration classifier and
    // deterministic Timestamp hash normalization (spec §3A.6.9/§3A.10).
    planRunClassifySlotState: planRunClassifySlotState,
    PLAN_RUN_CANONICAL_TIMESTAMP_FIELD_NAMES: PLAN_RUN_CANONICAL_TIMESTAMP_FIELD_NAMES,
    PlanRunTimestampNormalizationError: PlanRunTimestampNormalizationError,
    planRunNormalizeTimestampForHash: planRunNormalizeTimestampForHash,
    planRunNormalizeForCanonicalHash: planRunNormalizeForCanonicalHash,
    PLAN_RUN_PAGE_CURSOR_VERSION: PLAN_RUN_PAGE_CURSOR_VERSION,
    PLAN_RUN_PAGE_CURSOR_KEYS: PLAN_RUN_PAGE_CURSOR_KEYS,
    planRunEncodePageCursor: planRunEncodePageCursor,
    planRunDecodePageCursor: planRunDecodePageCursor,
    // SLICE 1 CORRECTION additions (independent-review Finding 1) -- the
    // dependency-free UTF-8/base64 codec `planRunEncodePageCursor`/
    // `planRunDecodePageCursor` are now built on. Exported for direct,
    // dedicated codec testing (round-trip, cross-realm consistency,
    // malformed-input rejection) independent of the cursor's own shape
    // rules above.
    PLAN_RUN_BASE64_ALPHABET: PLAN_RUN_BASE64_ALPHABET,
    planRunUtf8EncodeToBytes: planRunUtf8EncodeToBytes,
    planRunUtf8DecodeFromBytes: planRunUtf8DecodeFromBytes,
    planRunBase64EncodeBytes: planRunBase64EncodeBytes,
    planRunBase64DecodeToBytes: planRunBase64DecodeToBytes
  };
}
