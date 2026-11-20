// =============================================================================
// app-plan-run-failure-ui.js -- IRON LOG TRAIN: the decision after an
// evaluated miss (failure recommendations, Workout Logger support).
//
// One screen (#page-run-failure-decision). For a pending decision it shows:
//   - what was missed (the prescription that governed the evaluated Session)
//     and the approved value at the time;
//   - the program writer's recommendation, and EXACTLY what accepting it
//     would change (computed by plan-run-failure-model.js -- the same
//     function the save uses, so the preview is what gets applied);
//   - Accept / Decline (continue with current values and schedule) /
//     Choose another response.
// The write (fsPlanRunDecideFailure) applies once; a retry after an
// interrupted save reuses the same operation id.
//
// Release-gated (planRunFailureFeatureEnabled): nothing here runs or renders
// in the production build until the feature is enabled.
// =============================================================================
'use strict';

var planRunFailureUi = {
  planRunId: null, items: [], epoch: 0, phase: 'idle', current: null, ctx: null, missed: null,
  mode: 'review', other: null, message: null, lastResult: null, inFlight: null, countByRun: {}, kindsByRun: {}, countEpochByRun: {}
};

function planRunFailureUiEnabled() {
  return typeof planRunFailureFeatureEnabled === 'function' && planRunFailureFeatureEnabled() && typeof fsPlanRunPersistence !== 'undefined' && !!fsPlanRunPersistence.fsPlanRunListFailureDecisions;
}
function planRunFailureUiUid() {
  return (typeof planRunUiCurrentUid === 'function') ? planRunUiCurrentUid() : null;
}
function planRunFailureUiEsc(t) { return (typeof escapeHtml === 'function') ? escapeHtml(String(t == null ? '' : t)) : String(t); }
function planRunFailureUiContainer() { return document.getElementById('page-run-failure-decision'); }
// This Run's Sessions the app knows about: finished ones from saved workouts
// (each records its Session) -- the Run's remaining list is added by the read.
function planRunFailureUiKnownOccurrenceIds(planRunId) {
  var ids = [];
  ((typeof appDb !== 'undefined' && appDb && appDb.workouts) || []).forEach(function (w) {
    if (w && w.planRunId === planRunId && typeof w.planOccurrenceId === 'string' && ids.indexOf(w.planOccurrenceId) === -1) ids.push(w.planOccurrenceId);
  });
  return ids;
}
function planRunFailureUiNewOperationId() {
  return 'frop_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}
function planRunFailureUiStorageKey(decisionId) { return 'ironlog-fr-op-' + decisionId; }
function planRunFailureUiRememberOp(decisionId, op) { try { localStorage.setItem(planRunFailureUiStorageKey(decisionId), JSON.stringify(op)); } catch (e) {} }
function planRunFailureUiForgetOp(decisionId) { try { localStorage.removeItem(planRunFailureUiStorageKey(decisionId)); } catch (e) {} }
function planRunFailureUiRecallOp(decisionId) { try { return JSON.parse(localStorage.getItem(planRunFailureUiStorageKey(decisionId)) || 'null'); } catch (e) { return null; } }

// ---- Card badge (TRAIN) -----------------------------------------------------
function planRunFailureUiPendingCount(planRunId) {
  return planRunFailureUi.countByRun[planRunId] || 0;
}
// Which kinds of decision are waiting ('failure', 'success'), for the card.
function planRunFailureUiPendingKinds(planRunId) {
  return (planRunFailureUi.kindsByRun[planRunId] || ['failure']).slice();
}
function planRunFailureUiRecordPending(planRunId, decisions) {
  var pend = decisions.filter(function (d) { return d.decision.status === 'pending'; });
  var kinds = [];
  pend.forEach(function (d) { if (kinds.indexOf(d.decision.kind) === -1) kinds.push(d.decision.kind); });
  planRunFailureUi.kindsByRun[planRunId] = kinds;
  return pend.length;
}
// Called while the TRAIN card renders; looks up pending decisions at most
// once per Run per TRAIN refresh, then re-renders the card.
function planRunFailureUiEnsureCount(planRunId, epoch) {
  if (!planRunFailureUiEnabled() || !planRunId) return;
  if (planRunFailureUi.countEpochByRun[planRunId] === epoch) return;
  planRunFailureUi.countEpochByRun[planRunId] = epoch;
  var uid = planRunFailureUiUid();
  if (!uid) return;
  Promise.resolve(fsPlanRunPersistence.fsPlanRunListFailureDecisions({ ownerUid: uid, planRunId: planRunId, occurrenceIds: planRunFailureUiKnownOccurrenceIds(planRunId) })).then(function (r) {
    if (!r || r.outcome !== 'verified' || planRunFailureUiUid() !== uid) return;
    var before = JSON.stringify(planRunFailureUi.kindsByRun[planRunId] || null);
    var n = planRunFailureUiRecordPending(planRunId, r.decisions);
    if (planRunFailureUi.countByRun[planRunId] !== n || before !== JSON.stringify(planRunFailureUi.kindsByRun[planRunId])) {
      planRunFailureUi.countByRun[planRunId] = n;
      if (typeof planRunUiRenderSection === 'function') planRunUiRenderSection();
    }
  }, function () {});
}

// ---- Open -------------------------------------------------------------------
function planRunFailureUiOpenForRun(planRunId) {
  if (!planRunFailureUiEnabled()) return;
  var uid = planRunFailureUiUid();
  if (!uid) return;
  var epoch = ++planRunFailureUi.epoch;
  planRunFailureUi.planRunId = planRunId;
  planRunFailureUi.phase = 'loading'; planRunFailureUi.message = null; planRunFailureUi.lastResult = null;
  planRunFailureUiWire();
  showPage('page-run-failure-decision');
  planRunFailureUiRender();
  Promise.resolve(fsPlanRunPersistence.fsPlanRunListFailureDecisions({ ownerUid: uid, planRunId: planRunId, occurrenceIds: planRunFailureUiKnownOccurrenceIds(planRunId) })).then(function (r) {
    if (epoch !== planRunFailureUi.epoch) return;
    if (!r || r.outcome !== 'verified') { planRunFailureUi.phase = 'error'; planRunFailureUiRender(); return; }
    planRunFailureUi.items = r.decisions;
    planRunFailureUi.countByRun[planRunId] = planRunFailureUiRecordPending(planRunId, r.decisions);
    var next = r.decisions.filter(function (d) { return d.decision.status === 'pending'; })[0];
    if (next) planRunFailureUiOpenDecision(next);
    else { planRunFailureUi.phase = 'list'; planRunFailureUiRender(); }
  }, function () {
    if (epoch !== planRunFailureUi.epoch) return;
    planRunFailureUi.phase = 'error'; planRunFailureUiRender();
  });
}
// keepMessage (optional): a message to keep showing after the decision is
// reloaded, e.g. why a save was refused -- otherwise it would be cleared and
// the button would appear to do nothing.
function planRunFailureUiOpenDecision(item, keepMessage) {
  var uid = planRunFailureUiUid();
  var epoch = ++planRunFailureUi.epoch;
  planRunFailureUi.current = item; planRunFailureUi.phase = 'loading'; planRunFailureUi.mode = 'review'; planRunFailureUi.message = keepMessage || null;
  planRunFailureUi.other = null; planRunFailureUi.ctx = null;
  planRunFailureUiRender();
  Promise.resolve(fsPlanRunPersistence.fsPlanRunReadFailureDecisionContext({ ownerUid: uid, planRunId: planRunFailureUi.planRunId, stateKind: item.stateKind, key: item.key, decisionId: item.decision.decisionId })).then(function (r) {
    if (epoch !== planRunFailureUi.epoch) return;
    if (!r || r.outcome !== 'verified') { planRunFailureUi.phase = 'error'; planRunFailureUiRender(); return; }
    planRunFailureUi.ctx = r.ctx; planRunFailureUi.missed = r.missed;
    planRunFailureUi.current = Object.assign({}, item, { decision: r.ctx.entry });
    planRunFailureUi.phase = r.ctx.entry.status === 'pending' ? 'decide' : 'decided';
    var rec = r.ctx.entry.recommendation || { action: 'continue' };
    planRunFailureUi.other = { action: rec.action === 'none' ? 'continue' : rec.action, amount: rec.amount != null ? String(rec.amount) : '', unit: rec.unit || ((typeof appDb !== 'undefined' && appDb.unit === 'kg') ? 'kg' : 'lb'), duration: rec.duration || 'nextSession' };
    planRunFailureUiRender();
  }, function () {
    if (epoch !== planRunFailureUi.epoch) return;
    planRunFailureUi.phase = 'error'; planRunFailureUiRender();
  });
}

// ---- Responses ----------------------------------------------------------------
function planRunFailureUiRecommendationResponse() {
  var rec = planRunFailureUi.ctx.entry.recommendation;
  return Object.assign({ choice: 'accepted' }, rec);
}
function planRunFailureUiOtherResponse() {
  var o = planRunFailureUi.other;
  var r = { choice: 'chosen', action: o.action };
  if (/^reduce/.test(o.action)) {
    var pct = /Percent$/.test(o.action);
    r.amount = o.amount === '' ? NaN : Number(o.amount);
    r.unit = pct ? '%' : o.unit;
    r.duration = o.duration;
  }
  return r;
}
function planRunFailureUiPlan(response) {
  if (!planRunFailureUi.ctx) return null;
  if (planRunFailureUi.ctx.entry.kind !== 'success' && typeof planRunFailureResponseValid === 'function' && !planRunFailureResponseValid(response)) {
    return { ok: false, reason: 'invalidResponse', message: /^reduce/.test(response.action || '') ? 'Enter an amount greater than 0 with at most 2 decimal places' + (/Percent$/.test(response.action) ? ', below 100%.' : ' (up to 1000).') : 'That response isn’t complete.' };
  }
  return planRunDecisionPlanResponse(planRunFailureUi.ctx, response);
}
function planRunFailureUiSubmit(response) {
  var cur = planRunFailureUi.current;
  var plan = planRunFailureUiPlan(response);
  if (!plan || !plan.ok) { planRunFailureUi.message = plan ? plan.message : 'Not available.'; planRunFailureUiRender(); return; }
  var prior = planRunFailureUiRecallOp(cur.decision.decisionId);
  var op = (prior && JSON.stringify(prior.response) === JSON.stringify(response)) ? prior : { operationId: planRunFailureUiNewOperationId(), response: response };
  op.expectedEffects = plan.effects;
  planRunFailureUiRememberOp(cur.decision.decisionId, op);
  planRunFailureUiSend(op);
}
function planRunFailureUiSend(op) {
  var cur = planRunFailureUi.current, uid = planRunFailureUiUid();
  var epoch = ++planRunFailureUi.epoch;
  planRunFailureUi.inFlight = op; planRunFailureUi.phase = 'saving'; planRunFailureUi.message = null;
  planRunFailureUiRender();
  var p;
  try {
    p = Promise.resolve(fsPlanRunPersistence.fsPlanRunDecideFailure({
      ownerUid: uid, planRunId: planRunFailureUi.planRunId, stateKind: cur.stateKind, key: cur.key, decisionId: cur.decision.decisionId,
      operationId: op.operationId, response: op.response, expectedEffects: op.expectedEffects
    }));
  } catch (err) { p = Promise.reject(err); }
  p.then(function (r) {
    if (epoch !== planRunFailureUi.epoch) return;
    planRunFailureUi.inFlight = null;
    if (r && r.outcome === 'committed') {
      planRunFailureUiForgetOp(cur.decision.decisionId);
      planRunFailureUi.lastResult = r.decision;
      planRunFailureUi.current = Object.assign({}, cur, { decision: r.decision });
      planRunFailureUi.phase = 'saved';
      planRunFailureUi.countByRun[planRunFailureUi.planRunId] = Math.max(0, (planRunFailureUi.countByRun[planRunFailureUi.planRunId] || 1) - 1);
      planRunFailureUi.countEpochByRun = {};
    } else if (r && r.outcome === 'alreadyDecided') {
      planRunFailureUiForgetOp(cur.decision.decisionId);
      planRunFailureUi.current = Object.assign({}, cur, { decision: r.decision });
      planRunFailureUi.phase = 'decided';
      planRunFailureUi.message = 'This was already decided (perhaps on another device). Nothing else was changed.';
    } else if (r && r.outcome === 'changedSincePreview') {
      planRunFailureUiOpenDecision(cur, 'This Program changed while you were deciding, so nothing was saved. Review the updated details and decide again.');
      return;
    } else if (r && r.outcome === 'responseNotApplicable') {
      planRunFailureUi.phase = 'decide';
      planRunFailureUi.message = r.message || 'That response can’t be applied.';
    } else {
      planRunFailureUi.phase = 'uncertain';
    }
    planRunFailureUiRender();
  }, function () {
    if (epoch !== planRunFailureUi.epoch) return;
    planRunFailureUi.phase = 'uncertain';      // may or may not have saved
    planRunFailureUiRender();
  });
}
function planRunFailureUiRetry() {
  var cur = planRunFailureUi.current;
  var op = planRunFailureUi.inFlight || planRunFailureUiRecallOp(cur.decision.decisionId);
  if (op) planRunFailureUiSend(op);
}

// ---- Rendering ------------------------------------------------------------------
function planRunFailureUiSetsHtml(orderedSets) {
  return (orderedSets || []).map(function (os) {
    var t = (typeof planFormatSetSummary === 'function') ? planFormatSetSummary(os.prescribed, false, false) : '';
    return '<li>' + planRunFailureUiEsc(t) + '</li>';
  }).join('');
}
function planRunFailureUiSetsInline(orderedSets) {
  return (orderedSets || []).map(function (os) { return (typeof planFormatSetSummary === 'function') ? planFormatSetSummary(os.prescribed, false, false) : ''; }).join(', ');
}
function planRunFailureUiSessionName(ns) {
  return (typeof planRunUiFormatOccurrenceName === 'function') ? planRunUiFormatOccurrenceName(ns, 'Session') : 'Session';
}
// ---- What an approved value does to real loads -----------------------------
// One sentence, used everywhere an approved value is shown (approval screen,
// waiting-Session preview, saved decision, HISTORY).
function planRunFailureUiValueUseText(kind) {
  return kind === 'trainingMax'
    ? 'Your Training Max sets the load of %TM sets. Sets with a weight written in PLAN keep that weight.'
    : 'Your Working Load fills fixed-load sets left blank in PLAN. Sets with a weight written in PLAN keep that weight.';
}
// The Sets one Session will open with if the series value were `amount`,
// resolved exactly as the logger fills them (planRunLoggerRunSets), with the
// series' active reductions. source: 'value' (filled from the Working Load /
// Training Max), 'written' (a weight written in PLAN, kept), 'none' (not
// filled by the Program, e.g. %1RM or bodyweight).
function planRunFailureUiLoadsUnder(orderedSets, exerciseId, rule, v, amount) {
  var vv = v ? Object.assign({}, v, { currentValue: Object.assign({}, v.currentValue, { amount: amount }) }) : null;
  var ls = (typeof planRunLoggerRunSets === 'function') ? planRunLoggerRunSets(orderedSets, exerciseId, rule, vv) : [];
  return (orderedSets || []).map(function (os, i) {
    var p = os.prescribed || {}, s = ls[i] || {};
    var source = (p.loadType === 'fixed' && p.weight) ? 'written'
      : ((s.weight !== '' && s.weight !== undefined && (s.autoType === 'workingLoad' || s.autoType === 'percentTM' || s.failureAdjusted)) ? 'value' : 'none');
    return { summary: (typeof planFormatSetSummary === 'function') ? planFormatSetSummary(p, false, false) : '', weight: s.weight || '', source: source, reduced: !!s.failureAdjusted };
  });
}
// The next applicable Session of a series, from a decision context:
// { name, orderedSets, exerciseId, rule, v } or null.
function planRunFailureUiNextSession(ctx, occurrenceId) {
  if (!ctx || !ctx.isSeries || !occurrenceId) return null;
  var occ = ctx.memberOccurrences && ctx.memberOccurrences[occurrenceId];
  if (!occ) return null;
  var pres = planRunFailureEffectivePrescription(ctx.state, occ, ctx.seriesId);
  var own = planRunFailureSeriesAssignment(occ, ctx.seriesId);
  if (!pres || !own) return null;
  var st = ctx.state;
  return {
    name: occ.nameSnapshot, orderedSets: pres.orderedSets, retried: !!pres.overridden,
    exerciseId: (typeof planRunSeriesActiveExerciseId === 'function' ? planRunSeriesActiveExerciseId(st) : null) || own.assignment.exerciseId,
    rule: own.rule,
    v: { valueKind: st.valueKind, currentValue: st.currentValue, temporaryAdjustments: st.temporaryAdjustments || [], loadAdjustments: st.loadAdjustments || [] }
  };
}
// Per-Set rows: approve/decline loads side by side (decline omitted for a
// saved decision). Concise, and the same wording on every screen.
function planRunFailureUiLoadRowsHtml(approveRows, declineRows, unit) {
  var w = function (x) { return x ? x + ' ' + unit : ''; };
  return '<ul class="fr-vloads" data-testid="fr-value-loads">' + approveRows.map(function (r, i) {
    var dr = declineRows ? declineRows[i] : null;
    var txt;
    if (r.source === 'none') txt = 'not filled by the Program';
    else if (r.source === 'written') txt = w(r.weight) + (r.reduced ? ' (written in PLAN, reduced by your reduction)' : ' (written in PLAN)') + (dr ? ' either way' : '');
    else if (!dr || dr.weight === r.weight) txt = w(r.weight) + (dr ? ' either way' : '');
    else txt = w(r.weight) + ' if you approve · ' + (dr.weight ? w(dr.weight) : 'not filled') + ' if you decline';
    return '<li data-testid="fr-value-load-row" data-source="' + r.source + '" data-approve="' + planRunFailureUiEsc(r.weight) + '"' + (dr ? ' data-decline="' + planRunFailureUiEsc(dr.weight) + '"' : '') + '>Set ' + (i + 1) + ' · ' + planRunFailureUiEsc(r.summary) + ' — ' + planRunFailureUiEsc(txt) + '</li>';
  }).join('') + '</ul>';
}
// The consequence block: which sets use the value, and the loads they get.
function planRunFailureUiValueConsequencesHtml(next, kind, approvedAmount, declinedAmount) {
  var noun = kind === 'trainingMax' ? 'Training Max' : 'Working Load';
  var h = '<p class="fr-muted" data-testid="fr-value-use">' + planRunFailureUiEsc(planRunFailureUiValueUseText(kind)) + '</p>';
  if (!next) return h;
  var a = planRunFailureUiLoadsUnder(next.orderedSets, next.exerciseId, next.rule, next.v, approvedAmount);
  var d = declinedAmount === undefined ? null : planRunFailureUiLoadsUnder(next.orderedSets, next.exerciseId, next.rule, next.v, declinedAmount);
  h += '<div class="fr-label" data-testid="fr-next-loads-title">' + planRunFailureUiEsc(planRunFailureUiSessionName(next.name)) + (next.retried ? ' (retry)' : '') + ' — loads</div>' +
    planRunFailureUiLoadRowsHtml(a, d, next.v.currentValue.unit);
  if (!a.some(function (r) { return r.source === 'value'; })) h += '<p class="fr-muted" data-testid="fr-value-unused">None of these sets use your ' + noun + ', so their loads don’t depend on it.</p>';
  if ((next.v.temporaryAdjustments || []).length || (next.v.loadAdjustments || []).length) h += '<p class="fr-muted" data-testid="fr-loads-include-reduction">These loads include your active reduction.</p>';
  return h;
}
function planRunFailureUiConsequencesHtml(plan) {
  if (!plan) return '';
  if (!plan.ok) return '<p class="fr-problem" role="alert" data-testid="fr-problem">' + planRunFailureUiEsc(plan.message) + '</p>';
  var ex = plan.explain || {};
  var h = '<div class="fr-cons" data-testid="fr-consequences">';
  (ex.lines || []).forEach(function (l) { h += '<p>' + planRunFailureUiEsc(l) + '</p>'; });
  if (ex.rows && ex.rows.length) {
    h += '<ol class="fr-shift">';
    ex.rows.forEach(function (row, i) {
      h += '<li data-testid="fr-shift-row" data-occurrence-id="' + planRunFailureUiEsc(row.occurrenceId) + '"><b>' + planRunFailureUiEsc(planRunFailureUiSessionName(row.nameSnapshot)) + '</b>: ' +
        planRunFailureUiEsc(planRunFailureUiSetsInline(row.to.orderedSets)) + (i === 0 ? ' <span class="fr-tag">retry</span>' : '') +
        '<div class="fr-was">instead of ' + planRunFailureUiEsc(planRunFailureUiSetsInline(row.from.orderedSets)) + '</div></li>';
    });
    h += '</ol>';
  }
  if (ex.omitted) {
    h += '<p class="fr-omit" data-testid="fr-omitted">Left out (kept in your record as planned but not performed): ' + planRunFailureUiEsc(planRunFailureUiSetsInline(ex.omitted.orderedSets)) + '</p>';
  }
  if (ex.loads) {
    h += '<div class="fr-loads" data-testid="fr-loads"><div class="fr-loads-h">' + planRunFailureUiEsc(planRunFailureUiSessionName(ex.loads.nameSnapshot)) + '</div>';
    ex.loads.orderedSets.forEach(function (os, i) {
      var b = ex.loads.before[i], a = ex.loads.after[i];
      if (b === null && a === null) return;
      var t = (typeof planFormatSetSummary === 'function') ? planFormatSetSummary(os.prescribed, false, false) : '';
      h += '<div class="fr-load-row" data-testid="fr-load-row"><span>' + planRunFailureUiEsc(t) + '</span><span><s>' + planRunFailureUiEsc(b) + '</s> → <b>' + planRunFailureUiEsc(a) + '</b></span></div>';
    });
    h += '</div>';
  }
  return h + '</div>';
}
function planRunFailureUiOtherFormHtml() {
  var o = planRunFailureUi.other;
  var acts = ['continue', 'repeatPrescription', 'reduceWorkingLoadFixed', 'reduceWorkingLoadPercent', 'reduceTrainingMaxFixed', 'reduceTrainingMaxPercent'];
  var h = '<div class="fr-other" data-testid="fr-other-form"><label class="fr-field"><span>Your response</span><select data-testid="fr-other-action" data-fr-field="action">' +
    acts.map(function (a) { return '<option value="' + a + '"' + (o.action === a ? ' selected' : '') + '>' + planRunFailureUiEsc(PLAN_RUN_FAILURE_ACTION_LABELS[a]) + '</option>'; }).join('') + '</select></label>';
  if (/^reduce/.test(o.action)) {
    var pct = /Percent$/.test(o.action);
    h += '<label class="fr-field"><span>Reduce by' + (pct ? ' (%)' : '') + '</span><input type="number" inputmode="decimal" step="any" min="0" data-testid="fr-other-amount" data-fr-field="amount" value="' + planRunFailureUiEsc(o.amount) + '"></label>';
    if (!pct) h += '<label class="fr-field"><span>Unit</span><select data-testid="fr-other-unit" data-fr-field="unit"><option value="lb"' + (o.unit === 'lb' ? ' selected' : '') + '>lb</option><option value="kg"' + (o.unit === 'kg' ? ' selected' : '') + '>kg</option></select></label>';
    h += '<label class="fr-field"><span>For how long</span><select data-testid="fr-other-duration" data-fr-field="duration"><option value="nextSession"' + (o.duration === 'nextSession' ? ' selected' : '') + '>Next applicable session only</option><option value="carryForward"' + (o.duration === 'carryForward' ? ' selected' : '') + '>Carry forward</option></select></label>';
  }
  var plan = planRunFailureUiPlan(planRunFailureUiOtherResponse());
  h += '<div data-testid="fr-other-preview">' + planRunFailureUiConsequencesHtml(plan) + '</div>';
  h += '<div class="fr-actions"><button type="button" class="btn fr-primary" data-testid="fr-apply-other" data-fr-action="apply-other"' + (plan && plan.ok ? '' : ' disabled') + '>Apply this response</button>' +
    '<button type="button" class="btn fr-secondary" data-testid="fr-other-cancel" data-fr-action="other-cancel">Back to recommendation</button></div>';
  return h + '</div>';
}
// ctx (optional): the decision context, to list the next Session's loads.
function planRunFailureUiDecidedHtml(d, ctx) {
  var labels = d.kind === 'success'
    ? { accepted: 'Approved the increase', declined: 'Declined the increase', superseded: 'Not decided — a later Session ran first' }
    : { accepted: 'Accepted the recommendation', declined: 'Declined — continued as planned', chosen: 'Chose another response', superseded: 'Not decided — a later Session ran first' };
  var h = '<div class="fr-done" data-testid="fr-decided" data-status="' + planRunFailureUiEsc(d.status) + '"><p><b>' + planRunFailureUiEsc(labels[d.status] || d.status) + '</b>';
  if (d.response && d.response.choice !== 'declined' && d.kind !== 'success') h += ': ' + planRunFailureUiEsc(PLAN_RUN_FAILURE_ACTION_LABELS[d.response.action]) + (d.response.amount != null ? ' (' + d.response.amount + (d.response.unit === '%' ? '%' : ' ' + d.response.unit) + (d.response.duration ? ', ' + (d.response.duration === 'carryForward' ? 'carried forward' : 'next session only') : '') + ')' : '');
  h += '</p>';
  if (d.effects && d.effects.note) h += '<p>' + planRunFailureUiEsc(d.effects.note) + '</p>';
  if (d.effects && d.effects.kind === 'valueChange') {
    var vk = d.effects.newValue.kind;
    h += '<p data-testid="fr-approved-value">Approved ' + (vk === 'trainingMax' ? 'Training Max' : 'Working Load') + ': ' + planRunFailureUiEsc(planRunFailureFormatValue(d.effects.previousValue)) + ' → ' + planRunFailureUiEsc(planRunFailureFormatValue(d.effects.newValue)) + '</p>';
    var nextId = (ctx && ctx.isSeries && ctx.state) ? planRunFailureLaterMembers(ctx.state, d.occurrenceId)[0] : null;
    h += planRunFailureUiValueConsequencesHtml(nextId ? planRunFailureUiNextSession(ctx, nextId) : null, vk, d.effects.newValue.amount);
  }
  if (d.effects && d.effects.kind === 'scheduleShift') h += '<p>Retry scheduled; ' + d.effects.shiftedOccurrenceIds.length + ' later Session' + (d.effects.shiftedOccurrenceIds.length === 1 ? '' : 's') + ' moved back one place.' + (d.effects.omitted ? ' Left out: ' + planRunFailureUiEsc(planRunFailureUiSetsInline(d.effects.omitted.orderedSets)) + '.' : '') + '</p>';
  if (d.effects && (d.effects.kind === 'temporaryAdjustment' || d.effects.kind === 'loadAdjustment')) {
    var a = d.effects.adjustment;
    h += '<p>' + (a.target === 'trainingMax' ? 'Training Max' : 'Working loads') + ' reduced by ' + a.amount + (a.unit === '%' ? '%' : ' ' + a.unit) + (d.effects.kind === 'temporaryAdjustment' ? (d.effects.consumedByOccurrenceId ? ' for one Session (used).' : ' for the next Session only.') : ' from now on.') + '</p>';
  }
  return h + '</div>';
}
function planRunFailureUiRender() {
  var el = planRunFailureUiContainer();
  if (!el) return;
  var st = planRunFailureUi;
  var title = st.current && st.current.decision && (st.phase !== 'list') ? (st.current.decision.kind === 'success' ? 'Progression increase' : 'After a miss') : 'Program decisions';
  var h = '<div class="page-title-zone"><div class="page-title-zone-title" data-testid="fr-title">' + title + '</div></div><div class="fr-wrap" data-testid="fr-screen" data-phase="' + st.phase + '"' + (st.current && st.current.decision ? ' data-kind="' + planRunFailureUiEsc(st.current.decision.kind) + '"' : '') + '>';
  if (st.phase === 'loading') { el.innerHTML = h + '<p class="fr-muted">Loading…</p></div>'; return; }
  if (st.phase === 'error') {
    el.innerHTML = h + '<p class="fr-problem" role="alert">This decision can’t be shown safely right now. Nothing was changed.</p><div class="fr-actions"><button type="button" class="btn fr-secondary" data-testid="fr-back" data-fr-action="back">Back</button></div></div>';
    return;
  }
  if (st.phase === 'list') {
    h += '<p data-testid="fr-none-pending">No decisions are waiting for this Program.</p>';
    if (st.items.length) {
      h += '<h3 class="fr-h">Earlier decisions</h3>';
      st.items.forEach(function (it) {
        h += '<div class="fr-hist" data-testid="fr-history">' + planRunFailureUiEsc((typeof planCanonicalGetExerciseName === 'function' ? planCanonicalGetExerciseName(it.exerciseId) : it.exerciseId) + ' · ' + planRunFailureUiSessionName(it.occurrenceName)) + planRunFailureUiDecidedHtml(it.decision) + '</div>';
      });
    }
    el.innerHTML = h + '<div class="fr-actions"><button type="button" class="btn fr-secondary" data-testid="fr-back" data-fr-action="back">Back to TRAIN</button></div></div>';
    return;
  }
  var cur = st.current, ctx = st.ctx, d = cur.decision;
  var exName = (typeof planCanonicalGetExerciseName === 'function') ? planCanonicalGetExerciseName(cur.exerciseId) : cur.exerciseId;
  h += '<div class="fr-card"><div class="fr-ex" data-testid="fr-exercise">' + planRunFailureUiEsc(exName) + '</div>' +
    '<div class="fr-sub">' + planRunFailureUiEsc(planRunFailureUiSessionName(st.missed && st.missed.nameSnapshot)) + (cur.seriesName ? ' · ' + planRunFailureUiEsc(cur.seriesName) : '') + '</div>' +
    '<div class="fr-label">' + (d.kind === 'success' ? 'Passed this prescription' : 'Missed this prescription') + '</div><ul class="fr-sets" data-testid="fr-missed">' + planRunFailureUiSetsHtml(d.evaluatedPrescription.orderedSets) + '</ul>' +
    '<div class="fr-muted fr-eval" data-testid="fr-evaluation">' + planRunFailureUiEsc(planRunFailureEvaluationText(d.evaluatedPrescription.evaluation).replace(/^./, function (c) { return c.toUpperCase(); })) + (d.evaluatedPrescription.sourceOccurrenceId !== d.occurrenceId ? ' · retried prescription' : '') + '</div>' +
    '<div class="fr-label">Approved ' + (d.valueAtEvaluation.kind === 'trainingMax' ? 'Training Max' : 'Working Load') + ' at the time</div><div data-testid="fr-value">' + planRunFailureUiEsc(planRunFailureFormatValue(d.valueAtEvaluation)) + '</div></div>';
  if (st.phase === 'decided' || st.phase === 'saved') {
    if (st.phase === 'saved') h += '<p class="fr-ok" data-testid="fr-saved" role="status">Decision saved.</p>';
    if (st.message) h += '<p class="fr-muted" data-testid="fr-message">' + planRunFailureUiEsc(st.message) + '</p>';
    h += planRunFailureUiDecidedHtml(d, d.kind === 'success' ? ctx : null);
    var more = st.items.filter(function (it) { return it.decision.status === 'pending' && it.decision.decisionId !== d.decisionId; }).length;
    h += '<div class="fr-actions">' + (more ? '<button type="button" class="btn fr-primary" data-testid="fr-next" data-fr-action="reload">Next decision</button>' : '') +
      '<button type="button" class="btn fr-secondary" data-testid="fr-back" data-fr-action="back">Back to TRAIN</button></div></div>';
    el.innerHTML = h; return;
  }
  if (d.kind === 'success') { el.innerHTML = h + planRunFailureUiSuccessHtml(st, d) + '</div>'; return; }
  var rec = d.recommendation;
  h += '<div class="fr-rec"><div class="fr-label">The program recommends</div><div class="fr-rec-name" data-testid="fr-recommendation">' + planRunFailureUiEsc(PLAN_RUN_FAILURE_ACTION_LABELS[rec.action]) +
    (rec.amount != null ? ' — ' + rec.amount + (rec.unit === '%' ? '%' : ' ' + rec.unit) + ', ' + (rec.duration === 'carryForward' ? 'carried forward' : 'next applicable session only') : '') + '</div></div>';
  if (st.message) h += '<p class="fr-problem" role="alert" data-testid="fr-message">' + planRunFailureUiEsc(st.message) + '</p>';
  if (st.phase === 'saving') { el.innerHTML = h + '<p class="fr-muted" data-testid="fr-saving">Saving your decision…</p></div>'; return; }
  if (st.phase === 'uncertain') {
    el.innerHTML = h + '<p class="fr-problem" role="alert" data-testid="fr-uncertain">We couldn’t confirm your decision was saved. Trying again is safe — it can only be applied once.</p>' +
      '<div class="fr-actions"><button type="button" class="btn fr-primary" data-testid="fr-retry" data-fr-action="retry">Try again</button><button type="button" class="btn fr-secondary" data-testid="fr-back" data-fr-action="back">Back</button></div></div>';
    return;
  }
  if (st.mode === 'other') { el.innerHTML = h + planRunFailureUiOtherFormHtml() + '</div>'; return; }
  var accPlan = rec.action === 'none' ? null : planRunFailureUiPlan(planRunFailureUiRecommendationResponse());
  if (rec.action === 'none') h += '<p data-testid="fr-none-note">The program doesn’t recommend a response. Your miss is recorded.</p>';
  else h += '<div class="fr-label">If you accept</div>' + planRunFailureUiConsequencesHtml(accPlan);
  h += '<div class="fr-label">If you decline</div><p class="fr-muted">Nothing changes: you continue with your current approved values and schedule.</p>';
  h += '<div class="fr-actions">';
  if (rec.action !== 'none') h += '<button type="button" class="btn fr-primary" data-testid="fr-accept" data-fr-action="accept"' + (accPlan && accPlan.ok ? '' : ' disabled') + '>Accept recommendation</button>';
  h += '<button type="button" class="btn fr-secondary" data-testid="fr-decline" data-fr-action="decline">' + (rec.action === 'none' ? 'Continue as planned' : 'Decline') + '</button>' +
    '<button type="button" class="btn fr-secondary" data-testid="fr-other" data-fr-action="other">Choose another response</button>' +
    '<button type="button" class="btn fr-secondary" data-testid="fr-back" data-fr-action="back">Decide later</button></div>' +
    '<p class="fr-muted">Until you decide, the next Session of this series waits.</p>';
  el.innerHTML = h + '</div>';
}

// The success-approval view: approved value, proposed increase, result and
// scope, then Approve / Decline / Decide later.
function planRunFailureUiSuccessHtml(st, d) {
  var h = '';
  if (st.message) h += '<p class="fr-problem" role="alert" data-testid="fr-message">' + planRunFailureUiEsc(st.message) + '</p>';
  if (st.phase === 'saving') return h + '<p class="fr-muted" data-testid="fr-saving">Saving your decision…</p>';
  if (st.phase === 'uncertain') {
    return h + '<p class="fr-problem" role="alert" data-testid="fr-uncertain">We couldn’t confirm your decision was saved. Trying again is safe — it can only be applied once.</p>' +
      '<div class="fr-actions"><button type="button" class="btn fr-primary" data-testid="fr-retry" data-fr-action="retry">Try again</button><button type="button" class="btn fr-secondary" data-testid="fr-back" data-fr-action="back">Back</button></div>';
  }
  var noun = d.valueAtEvaluation.kind === 'trainingMax' ? 'Training Max' : 'Working Load';
  var plan = planRunFailureUiPlan({ choice: 'accepted' });
  var sx = (plan && plan.explain && plan.explain.success) || (planRunDecisionPlanResponse(st.ctx, { choice: 'declined' }).explain.success);
  var inc = d.proposal.increase;
  h += '<div class="fr-rec fr-success" data-testid="fr-proposal">' +
    '<div class="fr-row"><span>Current approved ' + noun + '</span><b data-testid="fr-current">' + planRunFailureUiEsc(planRunFailureFormatValue(sx.current)) + '</b></div>' +
    '<div class="fr-row"><span>Proposed increase</span><b data-testid="fr-increase">' + (inc.amount >= 0 ? '+' : '−') + planRunFailureUiEsc(Math.abs(inc.amount) + ' ' + inc.unit) + '</b></div>' +
    '<div class="fr-row"><span>Result if approved</span><b data-testid="fr-result">' + planRunFailureUiEsc(planRunFailureFormatValue(d.proposal.proposedValue)) + '</b></div>';
  var usedTemp = (d.adjustmentsInEffect || []).length > 0;
  if (usedTemp) h += '<p class="fr-muted" data-testid="fr-adjust-note">This Session used reduced loads from an earlier decision; the increase is added to your approved value, not to the reduced loads.</p>';
  var scope = sx.scope;
  var scopeText = scope.kind === 'series'
    ? 'Applies to the later Sessions of this series: ' + scope.names.map(function (n) { return planRunFailureUiSessionName(n); }).join(', ') + '.'
    : (scope.kind === 'seriesEnded' ? 'This series has no remaining Session, so the approved value is only recorded.' : 'This exercise’s progression belongs to this one Session, so the approved value is only recorded; no later Session uses it.');
  h += '<div class="fr-scope" data-testid="fr-scope">' + planRunFailureUiEsc(scopeText) + '</div></div>';
  var next = scope.kind === 'series' ? planRunFailureUiNextSession(st.ctx, scope.occurrenceIds[0]) : null;
  h += planRunFailureUiValueConsequencesHtml(next, d.valueAtEvaluation.kind, d.proposal.proposedValue.amount, sx.current.amount);
  if (plan && !plan.ok) h += '<p class="fr-problem" role="alert" data-testid="fr-problem">' + planRunFailureUiEsc(plan.message) + '</p>';
  h += '<div class="fr-label">If you decline</div><p class="fr-muted">Your approved ' + noun + ' stays ' + planRunFailureUiEsc(planRunFailureFormatValue(sx.current)) + '.</p>';
  h += '<div class="fr-actions"><button type="button" class="btn fr-primary" data-testid="fr-accept" data-fr-action="accept-success"' + (plan && plan.ok ? '' : ' disabled') + '>Approve increase</button>' +
    '<button type="button" class="btn fr-secondary" data-testid="fr-decline" data-fr-action="decline">Decline</button>' +
    '<button type="button" class="btn fr-secondary" data-testid="fr-back" data-fr-action="back">Decide later</button></div>' +
    (scope.kind === 'series' ? '<p class="fr-muted">Until you decide, the next Session of this series waits.</p>' : '');
  return h;
}

// ---- Events ---------------------------------------------------------------------
function planRunFailureUiWire() {
  var el = planRunFailureUiContainer();
  if (!el || el.__frWired) return;
  el.__frWired = true;
  el.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-fr-action]') : null;
    if (!b || b.disabled) return;
    var a = b.getAttribute('data-fr-action');
    if (a === 'back') { planRunFailureUi.epoch++; showPage('page-home'); if (typeof planRunUiRenderSection === 'function') planRunUiRenderSection(); }
    else if (a === 'accept') planRunFailureUiSubmit(planRunFailureUiRecommendationResponse());
    else if (a === 'accept-success') planRunFailureUiSubmit({ choice: 'accepted' });
    else if (a === 'decline') planRunFailureUiSubmit({ choice: 'declined' });
    else if (a === 'other') { planRunFailureUi.mode = 'other'; planRunFailureUi.message = null; planRunFailureUiRender(); }
    else if (a === 'other-cancel') { planRunFailureUi.mode = 'review'; planRunFailureUiRender(); }
    else if (a === 'apply-other') planRunFailureUiSubmit(planRunFailureUiOtherResponse());
    else if (a === 'retry') planRunFailureUiRetry();
    else if (a === 'reload') planRunFailureUiOpenForRun(planRunFailureUi.planRunId);
  });
  var onField = function (e) {
    var f = e.target.getAttribute && e.target.getAttribute('data-fr-field');
    if (!f || !planRunFailureUi.other) return;
    planRunFailureUi.other[f] = e.target.value;
    if (f === 'amount') {
      // keep focus while typing: refresh only the preview + apply button
      var prev = document.querySelector('[data-testid="fr-other-preview"]');
      var plan = planRunFailureUiPlan(planRunFailureUiOtherResponse());
      if (prev) prev.innerHTML = planRunFailureUiConsequencesHtml(plan);
      var btn = document.querySelector('[data-testid="fr-apply-other"]');
      if (btn) btn.disabled = !(plan && plan.ok);
    } else {
      planRunFailureUiRender();
    }
  };
  el.addEventListener('input', function (e) { if (e.target.getAttribute && e.target.getAttribute('data-fr-field') === 'amount') onField(e); });
  el.addEventListener('change', function (e) { if (e.target.getAttribute && e.target.getAttribute('data-fr-field') !== 'amount') onField(e); });
}

// =============================================================================
// HISTORY -- "Program details" for one Program Run workout.
// Three things are kept visibly apart:
//   PLANNED   -- the program's own prescription for this Session (intent);
//   PERFORMED -- what was recorded (the sets above) and how it was judged;
//   DECIDED   -- what the program proposed and what you chose, and what
//                that changed (values, schedule, left-out prescriptions).
// Everything comes from the persisted Run records, so it survives reload
// and sync. Program Run workouts can't be edited or deleted in History
// (unchanged), so a recorded evaluation and its decision can't drift from
// the workout they judged.
// =============================================================================
function planRunFailureUiHistoryEnabled() {
  return planRunFailureUiEnabled() && !!fsPlanRunPersistence.fsPlanRunReadWorkoutProgressionHistory;
}
var planRunFailureUiHistoryEpoch = {};
function planRunFailureUiHistoryFill(wid, containerEl) {
  if (!planRunFailureUiHistoryEnabled()) return;
  var w = ((typeof appDb !== 'undefined' && appDb.workouts) || []).filter(function (x) { return x.id === wid; })[0];
  var box = containerEl && containerEl.querySelector('[data-hist-prog]');
  if (!w || !box || !w.planRunId || !w.planOccurrenceId) return;
  var uid = planRunFailureUiUid();
  var ep = (planRunFailureUiHistoryEpoch[wid] || 0) + 1; planRunFailureUiHistoryEpoch[wid] = ep;
  Promise.resolve(fsPlanRunPersistence.fsPlanRunReadWorkoutProgressionHistory({ ownerUid: uid, planRunId: w.planRunId, occurrenceId: w.planOccurrenceId, workoutId: w.id })).then(function (r) {
    if (planRunFailureUiHistoryEpoch[wid] !== ep || !box.isConnected) return;
    box.innerHTML = planRunFailureUiHistoryHtml(r);
    box.setAttribute('data-loaded', '1');
  }, function () {
    if (planRunFailureUiHistoryEpoch[wid] !== ep || !box.isConnected) return;
    box.innerHTML = '<div class="hist-prog-h">Program details</div><div class="fr-muted" data-testid="hist-prog-error">Couldn’t load the program details right now.</div>';
    box.setAttribute('data-loaded', '1');
  });
}
function planRunFailureUiHistDecisionText(d) {
  var noun = d.valueAtEvaluation.kind === 'trainingMax' ? 'Training Max' : 'Working Load';
  var proposed = d.kind === 'success'
    ? 'Proposed: increase ' + noun + ' ' + planRunFailureFormatValue(d.valueAtEvaluation) + ' → ' + planRunFailureFormatValue(d.proposal.proposedValue)
    : 'Recommended after the miss: ' + PLAN_RUN_FAILURE_ACTION_LABELS[d.recommendation.action] + (d.recommendation.amount != null ? ' (' + d.recommendation.amount + (d.recommendation.unit === '%' ? '%' : ' ' + d.recommendation.unit) + ', ' + (d.recommendation.duration === 'carryForward' ? 'carried forward' : 'next session only') + ')' : '');
  var chosen;
  if (d.status === 'pending') chosen = 'Your decision: not made yet';
  else if (d.status === 'superseded') chosen = 'Your decision: none — a later Session ran first';
  else if (d.status === 'declined') chosen = 'Your decision: declined';
  else if (d.status === 'accepted') chosen = 'Your decision: ' + (d.kind === 'success' ? 'approved' : 'accepted');
  else chosen = 'Your decision: chose ' + PLAN_RUN_FAILURE_ACTION_LABELS[d.response.action] + (d.response.amount != null ? ' (' + d.response.amount + (d.response.unit === '%' ? '%' : ' ' + d.response.unit) + ', ' + (d.response.duration === 'carryForward' ? 'carried forward' : 'next session only') + ')' : '');
  return { proposed: proposed, chosen: chosen };
}
function planRunFailureUiHistChangeText(d, it) {
  var e = d.effects; if (!e) return '';
  if (e.kind === 'valueChange') return 'Approved ' + (e.newValue.kind === 'trainingMax' ? 'Training Max' : 'Working Load') + ': ' + planRunFailureFormatValue(e.previousValue) + ' → ' + planRunFailureFormatValue(e.newValue) + '. ' + planRunFailureUiValueUseText(e.newValue.kind);
  if (e.kind === 'scheduleShift') return 'Schedule: retry in ' + e.shiftedOccurrenceIds.map(function (o) { return planRunFailureUiSessionName(it.shiftedNames[o]); }).join(', then ') + ' (each later prescription moved back one Session)';
  if (e.kind === 'temporaryAdjustment' || e.kind === 'loadAdjustment') {
    var a = e.adjustment;
    return (a.target === 'trainingMax' ? 'Training Max' : 'Working loads') + ' reduced by ' + a.amount + (a.unit === '%' ? '%' : ' ' + a.unit) + (e.kind === 'temporaryAdjustment' ? ' for the next Session only' + (e.consumedByOccurrenceId ? ' (used)' : '') : ' from then on');
  }
  return e.note || '';
}
function planRunFailureUiHistoryHtml(r) {
  var h = '<div class="hist-prog-h">Program details</div>';
  if (!r || r.outcome !== 'verified') return h + '<div class="fr-muted" data-testid="hist-prog-error">Program details aren’t available for this workout.</div>';
  var shown = r.items.filter(function (it) { return it.evaluation || it.decisions.length || it.governing.retried || it.adjustmentsUsed.length; });
  if (!shown.length) return h + '<div class="fr-muted" data-testid="hist-prog-empty">No progression was evaluated in this workout.</div>';
  shown.forEach(function (it) {
    var exName = (typeof planCanonicalGetExerciseName === 'function') ? planCanonicalGetExerciseName(it.exerciseId) : it.exerciseId;
    h += '<div class="hist-prog-ex" data-testid="hist-prog-item" data-rule-id="' + planRunFailureUiEsc(it.planRuleId) + '"><div class="hist-prog-name">' + planRunFailureUiEsc(exName) + (it.seriesName ? ' · ' + planRunFailureUiEsc(it.seriesName) : '') + '</div>';
    // PLANNED
    h += '<div class="hist-prog-sec" data-testid="hist-planned"><span class="hist-prog-k">Planned</span> ' + planRunFailureUiEsc(planRunFailureUiSetsInline(it.planned.orderedSets)) + ' <span class="fr-muted">(' + planRunFailureUiEsc(planRunFailureEvaluationText(it.planned.evaluation)) + ')</span></div>';
    if (it.governing.retried) {
      h += '<div class="hist-prog-sec" data-testid="hist-governing"><span class="hist-prog-k">Used instead</span> ' + planRunFailureUiEsc(planRunFailureUiSetsInline(it.governing.orderedSets)) + ' <span class="fr-tag">retry of ' + planRunFailureUiEsc(planRunFailureUiSessionName(it.governing.sourceName)) + '</span> <span class="fr-muted">(' + planRunFailureUiEsc(planRunFailureEvaluationText(it.governing.evaluation)) + ')</span></div>';
    }
    it.adjustmentsUsed.forEach(function (u) {
      var a = u.adjustment;
      h += '<div class="hist-prog-sec" data-testid="hist-adjustment-used"><span class="hist-prog-k">Loads</span> reduced by ' + a.amount + (a.unit === '%' ? '%' : ' ' + planRunFailureUiEsc(a.unit)) + ' on the ' + (a.target === 'trainingMax' ? 'Training Max' : 'working loads') + ' (decision after ' + planRunFailureUiEsc(planRunFailureUiSessionName(u.fromName)) + ')</div>';
    });
    // PERFORMED -> judged
    var res;
    if (!it.evaluation) res = 'Not evaluated';
    else if (it.evaluation.outcome === 'applied') res = it.evaluation.decision === 'passed' ? 'Passed' : 'Missed';
    else if (it.evaluation.outcome === 'notAttempted') res = 'Not enough evidence (a judged set wasn’t attempted) — no change';
    else if (it.evaluation.outcome === 'established') res = 'Starting Working Load set from this workout';
    else if (it.evaluation.outcome === 'reviewed') res = 'Needs review (' + it.evaluation.reviewReason + ')';
    else res = it.evaluation.outcome;
    h += '<div class="hist-prog-sec" data-testid="hist-result" data-result="' + planRunFailureUiEsc(it.evaluation ? (it.evaluation.decision || it.evaluation.outcome) : 'none') + '"><span class="hist-prog-k">Result</span> ' + planRunFailureUiEsc(res) + '</div>';
    // DECIDED
    it.decisions.forEach(function (d) {
      var t = planRunFailureUiHistDecisionText(d);
      h += '<div class="hist-prog-dec" data-testid="hist-decision" data-kind="' + planRunFailureUiEsc(d.kind) + '" data-status="' + planRunFailureUiEsc(d.status) + '"><div>' + planRunFailureUiEsc(t.proposed) + '</div><div><b>' + planRunFailureUiEsc(t.chosen) + '</b></div>';
      var c = planRunFailureUiHistChangeText(d, it);
      if (c && d.status !== 'pending') h += '<div data-testid="hist-change">' + planRunFailureUiEsc(c) + '</div>';
      h += '</div>';
    });
    it.omitted.forEach(function (o) {
      h += '<div class="hist-prog-sec hist-omit" data-testid="hist-omitted"><span class="hist-prog-k">Left out</span> ' + planRunFailureUiEsc(planRunFailureUiSetsInline(o.orderedSets)) + ' (planned for ' + planRunFailureUiEsc(planRunFailureUiSessionName(o.sourceName)) + '; displaced past the program’s end by the retry)</div>';
    });
    h += '</div>';
  });
  return h;
}
