// =============================================================================
// plan-run-failure-model.js -- IRON LOG: Workout Logger support for PLAN
// failure recommendations. PURE MODEL LAYER (no Firestore, no DOM).
//
// Loaded after plan-run-model.js. Every function is a pure function of its
// arguments; the persistence layer (firebase-plan-run.js) and the TRAIN UI
// call the SAME functions, so what the lifter is shown before accepting is
// exactly what is applied.
//
// Vocabulary
//   PLAN intent        -- the template / the Run's frozen Session snapshot
//                         (never changed by any decision here).
//   recorded execution -- the workout document Finish saved.
//   approved response  -- the lifter's decision, applied to Run state only:
//                         series state (value, schedule overrides, omitted
//                         prescriptions, adjustments) or, for a standalone
//                         Rule, recorded on its own progression state.
//
// Scope rule: a Rule's recommendation can only act on LATER Sessions of the
// same Progression series (its saved scope). A standalone Rule belongs to
// exactly one Session, so it never has a later applicable Session -- the
// lifter is told so; exercise identity alone never carries a response
// anywhere else.
// =============================================================================
'use strict';

// Release gate: the same switch PLAN authoring uses (preview opts in).
function planRunFailureFeatureEnabled() {
  return !!(typeof window !== 'undefined' && window.__ironlogPreviewFeatures && window.__ironlogPreviewFeatures.failureRecommendations === true);
}

var PLAN_RUN_FAILURE_ACTION_LABELS = Object.freeze({
  none: 'No Recommendation',
  'continue': 'Continue as Planned',
  repeatPrescription: 'Repeat Prescription',
  reduceWorkingLoadFixed: 'Reduce Working Load by a Fixed Amount',
  reduceWorkingLoadPercent: 'Reduce Working Load by a Percentage',
  reduceTrainingMaxFixed: 'Reduce Training Max by a Fixed Amount',
  reduceTrainingMaxPercent: 'Reduce Training Max by a Percentage'
});
var PLAN_RUN_KG_PER_LB = 0.45359237;

function planRunFailureRound2(n) { return Math.round(n * 100) / 100; }
// Same increments as the app's existing roundPercentageLoad (app-core.js):
// 5 lb / 2.5 kg, nearest.
function planRunFailureRoundLoad(n, unit) {
  var inc = unit === 'kg' ? 2.5 : 5;
  return Math.round(n / inc) * inc;
}
function planRunFailureConvert(amount, fromUnit, toUnit) {
  if (fromUnit === toUnit) return amount;
  if (fromUnit === 'lb' && toUnit === 'kg') return planRunFailureRound2(amount * PLAN_RUN_KG_PER_LB);
  if (fromUnit === 'kg' && toUnit === 'lb') return planRunFailureRound2(amount / PLAN_RUN_KG_PER_LB);
  return NaN;
}
function planRunFailureTarget(action) {
  return /TrainingMax/.test(action) ? 'trainingMax' : (/WorkingLoad/.test(action) ? 'workingLoad' : null);
}
function planRunFailureFormatValue(v) {
  return v && typeof v.amount === 'number' ? (String(planRunFailureRound2(v.amount)) + ' ' + v.unit) : '—';
}

// Deterministic id for the decision Finish creates (one per Rule per workout).
function planRunFailureBuildDecisionId(workoutId, planRuleId) {
  var raw = 'fd_' + workoutId + '_' + planRuleId;
  if (raw.length <= 200) return raw;
  var h = 5381; for (var i = 0; i < raw.length; i++) h = ((h * 33) ^ raw.charCodeAt(i)) >>> 0;
  return 'fd_' + h.toString(36) + '_' + raw.slice(-150);
}

// The assignment (and its Rule entry) a series uses in one Session snapshot.
function planRunFailureSeriesAssignment(occurrenceDoc, seriesId) {
  var found = null;
  (occurrenceDoc && occurrenceDoc.assignments || []).forEach(function (a) {
    (a.rules || []).forEach(function (rl) {
      if (!found && rl.enabled && planRunRuleEntrySeriesId(rl) === seriesId) found = { assignment: a, rule: rl };
    });
  });
  return found;
}
// REPEAT PRESCRIPTION COHERENCE -- what travels with a prescription.
// MOVES with the prescription (how THESE sets are judged and answered):
//   evaluationType, gatewaySetIndex   -- the gateway index points into these
//                                        exact sets, so it can only be read
//                                        against them;
//   loadIncrease / tmIncrease          -- the increase a pass of these sets
//                                        earns (proposed for approval);
//   failureRecommendation              -- the program's answer to a miss of
//                                        these sets;
//   source identity (Rule, revision, Assignment) for the record.
// STAYS with the running series / destination Session (who is progressing):
//   planRuleId, ruleRevisionId, adjustmentType, progressionSeriesId,
//   successRequiresApproval, recommendedExerciseIds, the Assignment and its
//   exercise, the series value and its adjustments.
function planRunFailureEvaluationFromRule(ruleEntry, assignment) {
  var ev = {
    sourcePlanRuleId: ruleEntry.planRuleId, sourceRuleRevisionId: ruleEntry.ruleRevisionId, sourcePlanAssignmentId: assignment.planAssignmentId,
    evaluationType: ruleEntry.evaluationType, gatewaySetIndex: ruleEntry.gatewaySetIndex,
    loadIncrease: ruleEntry.loadIncrease, tmIncrease: ruleEntry.tmIncrease
  };
  if (Object.prototype.hasOwnProperty.call(ruleEntry, 'failureRecommendation')) ev.failureRecommendation = planRunDeepClone(ruleEntry.failureRecommendation);
  return ev;
}
// The rule entry a Session actually evaluates with: its own identity, the
// carried prescription's evaluation fields.
function planRunFailureApplyEvaluationToRule(ruleEntry, ev) {
  var out = Object.assign({}, ruleEntry, {
    evaluationType: ev.evaluationType, gatewaySetIndex: ev.gatewaySetIndex,
    loadIncrease: ev.loadIncrease, tmIncrease: ev.tmIncrease
  });
  if (Object.prototype.hasOwnProperty.call(ev, 'failureRecommendation')) out.failureRecommendation = planRunDeepClone(ev.failureRecommendation);
  else delete out.failureRecommendation;
  return out;
}
// The prescription a member Session will actually run: a retry/shift
// override if one applies, otherwise its own snapshot -- always with the
// evaluation that governs it.
// SCHEDULE MODEL: scheduleRefs[i] names whose frozen prescription member i
// runs (memberPrescriptions holds them all, frozen at Start).
function planRunFailureScheduleRef(seriesDoc, occurrenceId) {
  if (!seriesDoc || !Array.isArray(seriesDoc.scheduleRefs)) return occurrenceId;
  var i = seriesDoc.memberOccurrenceIds.indexOf(occurrenceId);
  return i === -1 ? occurrenceId : seriesDoc.scheduleRefs[i];
}
// The moved-in prescription for a member (null when it runs its own).
function planRunFailureScheduleOverride(seriesDoc, occurrenceId) {
  var ref = planRunFailureScheduleRef(seriesDoc, occurrenceId);
  if (ref === occurrenceId) return null;
  var mp = seriesDoc.memberPrescriptions[ref];
  return { sourceOccurrenceId: ref, orderedSets: mp.orderedSets, evaluation: mp.evaluation };
}
function planRunFailureEffectivePrescription(seriesDoc, occurrenceDoc, seriesId) {
  if (seriesDoc && seriesDoc.memberPrescriptions && seriesDoc.memberPrescriptions[occurrenceDoc.occurrenceId]) {
    var ref = planRunFailureScheduleRef(seriesDoc, occurrenceDoc.occurrenceId);
    var mp = seriesDoc.memberPrescriptions[ref];
    return { sourceOccurrenceId: ref, orderedSets: mp.orderedSets, evaluation: mp.evaluation, overridden: ref !== occurrenceDoc.occurrenceId };
  }
  var own = planRunFailureSeriesAssignment(occurrenceDoc, seriesId);
  return own ? { sourceOccurrenceId: occurrenceDoc.occurrenceId, orderedSets: own.assignment.orderedSets, evaluation: planRunFailureEvaluationFromRule(own.rule, own.assignment), overridden: false } : null;
}
// The increase a prescription earns, in the series' value kind.
function planRunFailureEvaluationIncrease(ev, valueKind) {
  return valueKind === 'trainingMax' ? ev.tmIncrease : ev.loadIncrease;
}
// A copy of the Session snapshot with any series override swapped into its
// own assignment AND that series' rule entry -- used by Finish (context
// check, completion check, evaluation) and by the logger/preview. The
// stored snapshot is untouched.
function planRunFailureEffectiveOccurrence(occurrenceDoc, seriesDocsBySeriesId) {
  if (!seriesDocsBySeriesId) return occurrenceDoc;
  var changed = false;
  var assignments = occurrenceDoc.assignments.map(function (a) {
    for (var i = 0; i < (a.rules || []).length; i++) {
      var rl = a.rules[i];
      var sid = rl.enabled ? planRunRuleEntrySeriesId(rl) : null;
      if (sid === null) continue;
      var sd = seriesDocsBySeriesId[sid];
      var ov = sd ? planRunFailureScheduleOverride(sd, occurrenceDoc.occurrenceId) : null;
      if (ov) {
        changed = true;
        var rules = a.rules.map(function (r2, j) { return j === i ? planRunFailureApplyEvaluationToRule(r2, ov.evaluation) : r2; });
        return Object.assign({}, a, { orderedSets: ov.orderedSets, rules: rules });
      }
    }
    return a;
  });
  return changed ? Object.assign({}, occurrenceDoc, { assignments: assignments }) : occurrenceDoc;
}
// Human description of how a prescription is judged.
function planRunFailureEvaluationText(ev) {
  if (!ev) return '';
  if (ev.evaluationType === 'gateway') return 'judged by gateway Set ' + (ev.gatewaySetIndex + 1);
  if (ev.evaluationType === 'volume') return 'judged by total volume';
  return 'every set must hit its target';
}

// Unfinished member Sessions scheduled AFTER `afterOccurrenceId`, in schedule
// order (memberOccurrenceIds and remainingOccurrenceIds are both schedule
// ordered at Start).
function planRunFailureLaterMembers(seriesDoc, afterOccurrenceId) {
  var members = seriesDoc.memberOccurrenceIds;
  var idx = members.indexOf(afterOccurrenceId);
  if (idx === -1) return [];
  var applied = seriesDoc.appliedOccurrenceIds || [];
  return members.slice(idx + 1).filter(function (o) { return applied.indexOf(o) === -1; });
}

// ---- Load resolution with adjustments (shared by preview and logger) ------
// Apply Training Max adjustments (temporary only; carried-forward TM
// reductions are already in the value).
function planRunFailureEffectiveTm(amount, temps) {
  var tm = amount;
  (temps || []).forEach(function (a) {
    if (a.target !== 'trainingMax') return;
    tm = a.mode === 'percent' ? tm * (1 - a.amount / 100) : tm - a.amount;
  });
  return planRunFailureRound2(tm);
}
function planRunFailureApplyWorkingLoadAdjustments(load, adjustments, unit) {
  var wl = load, touched = false;
  (adjustments || []).forEach(function (a) {
    if (a.target !== 'workingLoad') return;
    wl = a.mode === 'percent' ? wl * (1 - a.amount / 100) : wl - a.amount;
    touched = true;
  });
  return touched ? planRunFailureRoundLoad(wl, unit) : load;
}
// ctx: { valueKind, amount, unit, temps: [], persistent: [] }
// Returns the executable load for one prescribed set, or null when the Run
// doesn't fill it (percent1RM, bodyweight, unresolved value, ...). Mirrors
// app-plan.js planSetToLoggerSet for the cases a Run fills.
function planRunFailureResolveSetLoad(prescribed, ctx) {
  if (!ctx || ctx.amount === null || ctx.amount === undefined) {
    if (prescribed.loadType === 'fixed' && prescribed.weight) {
      return planRunFailureApplyWorkingLoadAdjustments(Number(prescribed.weight), (ctx && ctx.temps || []).concat(ctx && ctx.persistent || []), ctx ? ctx.unit : 'lb');
    }
    return null;
  }
  var all = (ctx.temps || []).concat(ctx.persistent || []);
  if (prescribed.loadType === 'fixed' && prescribed.weight) {
    return planRunFailureApplyWorkingLoadAdjustments(Number(prescribed.weight), all, ctx.unit);
  }
  if (prescribed.loadType === 'fixed' && !prescribed.weight && ctx.valueKind === 'workingLoad') {
    // The Working Load itself: carried-forward reductions are already in the
    // value; only temporary ones apply here.
    return planRunFailureApplyWorkingLoadAdjustments(ctx.amount, ctx.temps, ctx.unit);
  }
  if (prescribed.loadType === 'percentTM' && ctx.valueKind === 'trainingMax') {
    var pct = parseFloat(prescribed.percent);
    if (isNaN(pct)) return null;
    var tm = planRunFailureEffectiveTm(ctx.amount, ctx.temps);
    return planRunFailureApplyWorkingLoadAdjustments(planRunFailureRoundLoad((pct / 100) * tm, ctx.unit), all, ctx.unit);
  }
  return null;
}
function planRunFailureLoadsFor(orderedSets, ctx) {
  return (orderedSets || []).map(function (os) { return planRunFailureResolveSetLoad(os.prescribed, ctx); });
}

// ---- Pending decision built at Finish --------------------------------------
// kind 'failure' (evaluated miss + recommendation) or 'success' (evaluated
// pass + PROPOSED increase; nothing changes until approved).
function planRunFailureBuildPendingEntry(p) {
  var kind = p.kind || 'failure';
  return {
    decisionId: planRunFailureBuildDecisionId(p.workoutId, p.planRuleId),
    sequence: p.sequence, kind: kind, occurrenceId: p.occurrenceId, workoutId: p.workoutId, finishOperationId: p.finishOperationId,
    occurrenceIndex: (typeof p.occurrenceIndex === 'number') ? p.occurrenceIndex : null,
    planRuleId: p.planRuleId, planAssignmentId: p.planAssignmentId,
    evaluatedPrescription: { sourceOccurrenceId: p.sourceOccurrenceId, orderedSets: planRunDeepClone(p.orderedSets), evaluation: planRunDeepClone(p.evaluation) },
    valueAtEvaluation: { kind: p.value.kind, amount: p.value.amount, unit: p.value.unit },
    adjustmentsInEffect: planRunDeepClone(p.adjustmentsInEffect || []),
    recommendation: kind === 'failure' ? planRunDeepClone(p.recommendation) : null,
    proposal: kind === 'success' ? { increase: { amount: p.increase, unit: p.value.unit }, proposedValue: { kind: p.proposedValue.kind, amount: p.proposedValue.amount, unit: p.proposedValue.unit } } : null,
    remainingOccurrenceIds: (p.remainingOccurrenceIds || []).slice(),
    status: 'pending', response: null, effects: null, decidedOperationId: null
  };
}

// ---- Success approval --------------------------------------------------------
// ctx as for failures. response = { choice: 'accepted' | 'declined' }.
// Accepting sets the APPROVED value to the proposed value -- only if the
// approved value is still exactly what the proposal was built on (stale
// proposals are refused, never re-based silently).
function planRunSuccessPlanResponse(ctx, response) {
  if (!planRunSuccessResponseValid(response)) return { ok: false, reason: 'invalidResponse', message: 'That response isn’t complete.' };
  var entry = ctx.entry, state = ctx.state, pr = entry.proposal;
  var noun = entry.valueAtEvaluation.kind === 'trainingMax' ? 'Training Max' : 'Working Load';
  var explain = { lines: [], rows: [], omitted: null, values: null, success: null };
  var later = ctx.isSeries ? planRunFailureLaterMembers(state, entry.occurrenceId) : [];
  var scope = ctx.isSeries
    ? (later.length ? { kind: 'series', occurrenceIds: later.slice(), names: later.map(function (o) { var d = ctx.memberOccurrences && ctx.memberOccurrences[o]; return d ? d.nameSnapshot : null; }) } : { kind: 'seriesEnded', occurrenceIds: [], names: [] })
    : { kind: 'rule', occurrenceIds: [], names: [] };
  explain.success = { current: state.currentValue, valueAtEvaluation: entry.valueAtEvaluation, increase: pr.increase, proposed: pr.proposedValue, scope: scope };
  if (response.choice === 'declined') {
    explain.lines.push('Your approved ' + noun + ' stays ' + planRunFailureFormatValue(state.currentValue) + '.');
    return { ok: true, status: 'declined', effects: { kind: 'none', note: 'Declined the increase: the approved ' + noun + ' stays ' + planRunFailureFormatValue(state.currentValue) + '.' }, patch: {}, explain: explain };
  }
  var cv = state.currentValue, at = entry.valueAtEvaluation;
  if (!cv || cv.kind !== at.kind || cv.unit !== at.unit || cv.amount !== at.amount) {
    return { ok: false, reason: 'staleProposal', message: 'Your approved ' + noun + ' changed after this increase was proposed (it is now ' + planRunFailureFormatValue(cv) + ', not ' + planRunFailureFormatValue(at) + '), so it can’t be applied. You can decline it.' };
  }
  if (!(pr.proposedValue.amount > 0)) return { ok: false, reason: 'nonPositive', message: 'The result would be zero or below, so it can’t be applied.' };
  explain.lines.push('Your approved ' + noun + ' becomes ' + planRunFailureFormatValue(pr.proposedValue) + ' (' + planRunFailureFormatValue(at) + ' ' + (pr.increase.amount >= 0 ? '+ ' : '− ') + Math.abs(pr.increase.amount) + ' ' + pr.increase.unit + ').');
  return { ok: true, status: 'accepted', effects: { kind: 'valueChange', previousValue: { kind: at.kind, amount: at.amount, unit: at.unit }, newValue: planRunDeepClone(pr.proposedValue) }, patch: { currentValue: planRunDeepClone(pr.proposedValue) }, explain: explain };
}
// One entry point for both decision kinds (the save and the screen use it).
function planRunDecisionPlanResponse(ctx, response) {
  return ctx && ctx.entry && ctx.entry.kind === 'success' ? planRunSuccessPlanResponse(ctx, response) : planRunFailurePlanResponse(ctx, response);
}

// ---- Planning a response ---------------------------------------------------
// ctx = {
//   isSeries, state (series or Rule state doc), entry (the pending decision),
//   remainingOccurrenceIds (the Run's), memberOccurrences: { occId: doc }
//   (the later members' Session snapshots; series only), seriesId
// }
// response = { choice: 'accepted' | 'declined' | 'chosen', action?, amount?, unit?, duration? }
// Returns { ok:true, status, effects, patch, explain:{...} } or
//         { ok:false, reason, message }.
function planRunFailurePlanResponse(ctx, response) {
  if (!planRunFailureResponseValid(response)) return { ok: false, reason: 'invalidResponse', message: 'That response isn’t complete.' };
  var entry = ctx.entry, state = ctx.state;
  var status = response.choice;
  var explain = { lines: [], rows: [], omitted: null, values: null };
  if (response.choice === 'declined') {
    explain.lines.push('Nothing changes: the next Session keeps its planned prescription and your current approved ' + (state.currentValue.kind === 'trainingMax' ? 'Training Max' : 'Working Load') + ' (' + planRunFailureFormatValue(state.currentValue) + ').');
    return { ok: true, status: status, effects: { kind: 'none', note: 'Declined: continued with the existing approved values and schedule.' }, patch: {}, explain: explain };
  }
  var action = response.action;
  if (action === 'none') {
    explain.lines.push('The miss is recorded. Nothing else changes.');
    return { ok: true, status: status, effects: { kind: 'none', note: 'No recommendation from the program; the miss is recorded.' }, patch: {}, explain: explain };
  }
  if (action === 'continue') {
    explain.lines.push('The next Session keeps its planned prescription and your current approved ' + (state.currentValue.kind === 'trainingMax' ? 'Training Max' : 'Working Load') + ' (' + planRunFailureFormatValue(state.currentValue) + ').');
    return { ok: true, status: status, effects: { kind: 'none', note: 'Continue as planned.' }, patch: {}, explain: explain };
  }
  var later = ctx.isSeries ? planRunFailureLaterMembers(state, entry.occurrenceId) : [];
  if (!later.length) {
    explain.lines.push(ctx.isSeries
      ? 'There is no remaining scheduled Session in this Progression series, so there is nowhere to apply this. You can finish the program, or arrange further training yourself.'
      : 'This Progression has no later scheduled Session, so there is nowhere to apply this. You can finish the program, or arrange further training yourself.');
    return { ok: true, status: status, effects: { kind: 'noRemainingOccurrence', note: 'No remaining scheduled Session for this Progression.' }, patch: {}, explain: explain };
  }
  var docFor = function (occId) { return ctx.memberOccurrences && ctx.memberOccurrences[occId]; };
  for (var li = 0; li < later.length; li++) if (!docFor(later[li])) return { ok: false, reason: 'memberMissing', message: 'A later Session of this series couldn’t be read. Try again.' };

  if (action === 'repeatPrescription') {
    // SCHEDULE MODEL: the retry goes into the next member, and every later
    // member takes the prescription before it -- one list operation on
    // scheduleRefs that the database Rules re-check exactly. It needs every
    // later member of the series still unfinished (otherwise there is no
    // contiguous schedule to move back).
    var members = state.memberOccurrenceIds, refs = state.scheduleRefs, q = entry.occurrenceIndex;
    var laterAll = members.slice(q + 1);
    if (laterAll.length !== later.length) return { ok: false, reason: 'laterSessionFinished', message: 'A later Session of this series is already finished, so the schedule can’t move back to fit a retry. Choose another response.' };
    var newRefs = refs.slice(0, q + 1).concat([refs[q]]).concat(refs.slice(q + 1, refs.length - 1));
    var omittedRef = refs[refs.length - 1];
    var mpOf = function (ref) { return state.memberPrescriptions[ref]; };
    var rows = laterAll.map(function (occId, i) {
      var j = q + 1 + i;
      return { occurrenceId: occId, nameSnapshot: docFor(occId).nameSnapshot,
        from: { sourceOccurrenceId: refs[j], orderedSets: mpOf(refs[j]).orderedSets, evaluation: mpOf(refs[j]).evaluation },
        to: { sourceOccurrenceId: newRefs[j], orderedSets: mpOf(newRefs[j]).orderedSets, evaluation: mpOf(newRefs[j]).evaluation } };
    });
    var omitted = { decisionId: entry.decisionId, sourceOccurrenceId: omittedRef };
    explain.rows = rows;
    explain.omitted = { sourceOccurrenceId: omittedRef, orderedSets: mpOf(omittedRef).orderedSets, evaluation: mpOf(omittedRef).evaluation };
    explain.lines.push('The next Session of this series retries the missed prescription, judged the way it was written (' + planRunFailureEvaluationText(entry.evaluatedPrescription.evaluation) + '). Each later Session moves back one place with its own way of judging, and the last prescription that no longer fits before the program ends is left out.');
    return {
      ok: true, status: status,
      effects: { kind: 'scheduleShift', shiftedOccurrenceIds: laterAll.slice(), omittedSourceOccurrenceId: omittedRef },
      patch: { scheduleRefs: newRefs, omittedPrescriptions: (state.omittedPrescriptions || []).concat([omitted]) },
      explain: explain
    };
  }

  // Reductions.
  var target = planRunFailureTarget(action);
  var value = state.currentValue;
  if (value.amount === null) return { ok: false, reason: 'valueUnresolved', message: 'This series doesn’t have an approved value yet, so there is nothing to reduce. Choose another response.' };
  if (target === 'trainingMax' && state.valueKind !== 'trainingMax') return { ok: false, reason: 'noTrainingMax', message: 'This series progresses a Working Load, so there is no Training Max to reduce. Choose another response.' };
  var pct = /Percent$/.test(action);
  var amt = response.amount;
  if (!pct) {
    amt = planRunFailureConvert(response.amount, response.unit, value.unit);
    if (!(amt > 0)) return { ok: false, reason: 'unitConversion', message: 'The amount couldn’t be converted to ' + value.unit + '.' };
  }
  var adj = { decisionId: entry.decisionId, target: target, mode: pct ? 'percent' : 'fixed', amount: amt, unit: pct ? '%' : value.unit };
  // A converted fixed amount may need more than two decimals to be exact;
  // keep the adjustment valid by rounding it (shown to the lifter).
  if (!pct) adj.amount = planRunFailureRound2(adj.amount);
  if (!(adj.amount > 0)) return { ok: false, reason: 'amountTooSmall', message: 'That amount is too small to apply.' };
  var temps = (state.temporaryAdjustments || []).slice();
  var persistent = (state.loadAdjustments || []).slice();
  var carry = response.duration === 'carryForward';
  var patch = {}, effects, newValue = null;
  if (carry && target === state.valueKind) {
    var raw = adj.mode === 'percent' ? value.amount * (1 - adj.amount / 100) : value.amount - adj.amount;
    var nv = target === 'workingLoad' ? planRunFailureRoundLoad(raw, value.unit) : planRunFailureRound2(raw);
    if (!(nv > 0)) return { ok: false, reason: 'nonPositive', message: 'That reduction would take the ' + (target === 'trainingMax' ? 'Training Max' : 'Working Load') + ' to zero or below. Adjust the amount or choose another response.' };
    newValue = { kind: value.kind, amount: nv, unit: value.unit };
    patch.currentValue = newValue;
    // Fixed sets with a written weight aren't driven by the Working Load
    // value, so a carried-forward Working Load reduction also applies to
    // them as a standing adjustment.
    if (target === 'workingLoad') { persistent = persistent.concat([adj]); patch.loadAdjustments = persistent; }
    effects = { kind: 'valueChange', previousValue: value, newValue: newValue, adjustment: adj };
  } else if (carry) {
    persistent = persistent.concat([adj]);
    patch.loadAdjustments = persistent;
    effects = { kind: 'loadAdjustment', adjustment: adj };
  } else {
    temps = temps.concat([adj]);
    patch.temporaryAdjustments = temps;
    effects = { kind: 'temporaryAdjustment', adjustment: adj };
  }
  // Consequences for the next applicable Session, with executable loads.
  var nextOcc = docFor(later[0]);
  var nextPres = planRunFailureEffectivePrescription(state, nextOcc, ctx.seriesId);
  var beforeCtx = { valueKind: state.valueKind, amount: value.amount, unit: value.unit, temps: state.temporaryAdjustments || [], persistent: state.loadAdjustments || [] };
  var afterCtx = { valueKind: state.valueKind, amount: newValue ? newValue.amount : value.amount, unit: value.unit, temps: temps, persistent: newValue && target === 'workingLoad' ? persistent : persistent };
  if (newValue && target === 'workingLoad') {
    // value already reduced; the standing adjustment must not hit the
    // Working Load-driven sets again (handled in planRunFailureResolveSetLoad).
  }
  var before = planRunFailureLoadsFor(nextPres.orderedSets, beforeCtx);
  var after = planRunFailureLoadsFor(nextPres.orderedSets, afterCtx);
  if (after.some(function (x) { return x !== null && !(x > 0); })) return { ok: false, reason: 'nonPositive', message: 'That reduction would take a load to zero or below. Adjust the amount or choose another response.' };
  var reduced = before.some(function (b, k) { return b !== null && after[k] !== null && after[k] < b; });
  if (!reduced) {
    return { ok: false, reason: 'noExecutableReduction', message: 'After rounding to loadable increments (' + (value.unit === 'kg' ? '2.5 kg' : '5 lb') + '), this reduction doesn’t change any load in the next Session. Adjust the amount or choose another response.', explain: { before: before, after: after } };
  }
  explain.values = { before: value, after: newValue, temporaryTm: (!carry && target === 'trainingMax') ? { kind: 'trainingMax', amount: planRunFailureEffectiveTm(value.amount, temps), unit: value.unit } : null };
  explain.loads = { occurrenceId: later[0], nameSnapshot: nextOcc.nameSnapshot, orderedSets: nextPres.orderedSets, before: before, after: after };
  var noun = target === 'trainingMax' ? 'Training Max' : 'Working Load';
  var amountText = adj.mode === 'percent' ? adj.amount + '%' : adj.amount + ' ' + adj.unit;
  if (carry) {
    explain.lines.push(newValue
      ? 'Your approved ' + noun + ' becomes ' + planRunFailureFormatValue(newValue) + ' (from ' + planRunFailureFormatValue(value) + '). Later Sessions use it, and any progression you earn adds to it.'
      : 'Every later Session’s working loads are reduced by ' + amountText + '. Your Training Max stays ' + planRunFailureFormatValue(value) + '.');
  } else {
    explain.lines.push(target === 'trainingMax'
      ? 'For the next Session only, loads are worked out from a Training Max of ' + planRunFailureFormatValue(explain.values.temporaryTm) + '. Your approved Training Max stays ' + planRunFailureFormatValue(value) + '.'
      : 'For the next Session only, working loads are reduced by ' + amountText + '. Your approved ' + (state.valueKind === 'trainingMax' ? 'Training Max' : 'Working Load') + ' stays ' + planRunFailureFormatValue(value) + '.');
    var inc = ctx.successIncrease;
    if (inc && inc.amount > 0) {
      explain.lines.push('If you pass that Session, an increase is proposed for your approval, added to the approved value: ' + planRunFailureFormatValue(value) + ' + ' + inc.amount + ' ' + value.unit + ' = ' + planRunFailureFormatValue({ amount: value.amount + inc.amount, unit: value.unit }) + '. Nothing changes until you approve it.');
    }
  }
  return { ok: true, status: status, effects: effects, patch: patch, explain: explain };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    planRunFailureFeatureEnabled: planRunFailureFeatureEnabled, planRunFailureRoundLoad: planRunFailureRoundLoad,
    planRunFailureConvert: planRunFailureConvert, planRunFailureBuildDecisionId: planRunFailureBuildDecisionId,
    planRunFailureEffectivePrescription: planRunFailureEffectivePrescription, planRunFailureEffectiveOccurrence: planRunFailureEffectiveOccurrence,
    planRunFailureLaterMembers: planRunFailureLaterMembers, planRunFailureResolveSetLoad: planRunFailureResolveSetLoad,
    planRunFailureBuildPendingEntry: planRunFailureBuildPendingEntry, planRunFailurePlanResponse: planRunFailurePlanResponse,
    planRunFailureEvaluationFromRule: planRunFailureEvaluationFromRule, planRunFailureApplyEvaluationToRule: planRunFailureApplyEvaluationToRule,
    planRunSuccessPlanResponse: planRunSuccessPlanResponse, planRunDecisionPlanResponse: planRunDecisionPlanResponse,
    planRunFailureScheduleRef: planRunFailureScheduleRef, planRunFailureScheduleOverride: planRunFailureScheduleOverride,
    planRunFailureEvaluationIncrease: planRunFailureEvaluationIncrease
  };
}
