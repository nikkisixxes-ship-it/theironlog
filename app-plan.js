// ==================== PLAN — PROGRAM TEMPLATE EDITOR (Stage 1B) ====================
// PLAN shows Program Templates only. Active/running program state (completedSessionIndices,
// trainingMaxes, lastUsed) belongs to Train and is never read or written from this file.
//
// Editing uses an explicit draft model:
//   - Opening a template clones it into planDraft (a plain in-memory object).
//   - Every editor screen (Details / Microcycle / Session / Exercise / Set) reads and
//     writes directly to planDraft. Nothing touches Firestore until "Save Template" is tapped.
//   - Moving between the inner editor screens never loses data — they all share the same
//     planDraft object. Only leaving the editor entirely (Back from Program Details) checks
//     for unsaved changes and offers to discard them.
//
// Known limitation (Stage 1B): switching to another bottom-nav tab mid-edit does not
// prompt to save — it silently returns to the Program Library next time Plan is opened.

// ---- State ----
let planDraft         = null;    // program object currently being edited (draft copy)
let planSnapshot      = null;    // JSON snapshot of planDraft at open/save time, for change detection
let planEditorOrigin  = null;    // { type:'library' } or { type:'profile', id }
let planCurrentProgId = null;    // program id currently shown in read-only Profile
let planLibrarySort   = 'alpha'; // 'alpha' | 'recent'

// ==================== HELPERS ====================

function planContainer() { return document.getElementById('page-programs'); }

function planMoveInArray(arr, idx, dir) {
  const n = idx + dir;
  if (n < 0 || n >= arr.length) return;
  [arr[idx], arr[n]] = [arr[n], arr[idx]];
}

// Derived metadata row for Library cards / Profile. Returns null if no structure exists yet.
function planDeriveMeta(program) {
  const mcs = program.microcycles || [];
  if (!mcs.length) return null;
  const counts = mcs.map(mc => (mc.sessions || []).length);
  const total = counts.reduce((a, b) => a + b, 0);
  const allEqual = counts.every(c => c === counts[0]) && counts[0] > 0;
  const parts = [`${mcs.length} Micro${mcs.length !== 1 ? 's' : ''}`];
  if (allEqual) parts.push(`${counts[0]} / Micro`);
  else if (total > 0) parts.push(`${total} Sessions`);
  if (program.structureLabel) parts.push(program.structureLabel);
  return parts.join(' \u2022 ');
}

// Richer row summaries for the editor lists — only include counts that are non-zero,
// per the "only show values that exist" rule, except the row's own primary count
// (Sessions / Exercises / Sets respectively), which always shows for orientation.
function planMicrocycleSummary(mc) {
  const sessions = mc.sessions || [];
  let exerciseCount = 0, setCount = 0;
  sessions.forEach(s => {
    const exs = s.exercises || [];
    exerciseCount += exs.length;
    exs.forEach(ex => { setCount += (ex.sets || []).length; });
  });
  const parts = [`${sessions.length} Session${sessions.length !== 1 ? 's' : ''}`];
  if (exerciseCount > 0) parts.push(`${exerciseCount} Exercise${exerciseCount !== 1 ? 's' : ''}`);
  if (setCount > 0) parts.push(`${setCount} Set${setCount !== 1 ? 's' : ''}`);
  return parts.join(' \u2022 ');
}

function planSessionSummary(sess) {
  const exs = sess.exercises || [];
  let setCount = 0;
  exs.forEach(ex => { setCount += (ex.sets || []).length; });
  const parts = [`${exs.length} Exercise${exs.length !== 1 ? 's' : ''}`];
  if (setCount > 0) parts.push(`${setCount} Set${setCount !== 1 ? 's' : ''}`);
  return parts.join(' \u2022 ');
}

// Progression tag prefers naming the special-case rule (Gateway) when that's the
// evaluation rule in use, otherwise names the adjustment (TM vs generic Progression).
function planExerciseSummary(ex) {
  const setCount = (ex.sets || []).length;
  const parts = [`${setCount} Set${setCount !== 1 ? 's' : ''}`];
  const prog = ex.progression;
  if (prog && prog.enabled) {
    if (prog.evaluationType === 'gateway') parts.push('Gateway Progression');
    else if (prog.adjustmentType === 'increaseTM') parts.push('TM Progression');
    else parts.push('Progression');
  }
  return parts.join(' \u2022 ');
}

// Compact two-line empty state used throughout the editor screens.
function planEmptyState(title, sub) {
  return `<div class="plan-empty-state"><div class="plan-empty-title">${escapeHtml(title)}</div><div class="plan-empty-sub">${escapeHtml(sub)}</div></div>`;
}

// Small uppercase label marking which editing level the current screen represents —
// reinforces the Program > Microcycle > Session > Exercise > Set hierarchy through
// typography alone, no extra color.
function planLevelEyebrow(label) {
  return `<div class="plan-level-eyebrow">${escapeHtml(label)}</div>`;
}

// Compact one-line set summary, e.g. "225 x 8 @ 2 RIR"
function planFormatSetSummary(s, includeNoteTag, workingLoadEligible) {
  if (includeNoteTag === undefined) includeNoteTag = true;
  s = s || {};
  let timeStr = '';
  if (s.timeType === 'fixed' && s.seconds) timeStr = `${s.seconds} sec`;
  else if (s.timeType === 'range' && (s.minSeconds || s.maxSeconds)) timeStr = `${s.minSeconds || '?'}-${s.maxSeconds || '?'} sec`;

  const hasLoadReps = !!s.loadType || !!s.repsType;
  let loadRepsStr = '';
  if (hasLoadReps) {
    let loadStr = '\u2014';
    if (s.loadType === 'fixed' && s.weight) loadStr = `${s.weight}`;
    else if (s.loadType === 'fixed' && workingLoadEligible) loadStr = 'Working Load';
    else if (s.loadType === 'percentTM' && s.percent) loadStr = `${s.percent}% TM`;
    else if (s.loadType === 'percent1RM' && s.percent) loadStr = `${s.percent}% 1RM`;
    else if (s.loadType === 'bodyweight') loadStr = s.addedWeight ? `BW + ${s.addedWeight}` : 'BW';

    let repsStr = '\u2014';
    if (s.repsType === 'fixed' && s.reps) repsStr = `${s.reps}`;
    else if (s.repsType === 'range' && (s.minReps || s.maxReps)) repsStr = `${s.minReps || '?'}-${s.maxReps || '?'}`;

    loadRepsStr = `${loadStr} \u00d7 ${repsStr}`;
  }

  let main;
  if (loadRepsStr && timeStr) main = `${loadRepsStr} / ${timeStr}`;
  else if (loadRepsStr) main = loadRepsStr;
  else if (timeStr) main = timeStr;
  else main = '\u2014 \u00d7 \u2014';

  let effort = '';
  if (s.effortType === 'fixed' && s.rir !== '' && s.rir != null) effort = ` @ ${s.rir} RIR`;
  else if (s.effortType === 'range' && (s.minRir || s.maxRir)) effort = ` @ ${s.minRir || '?'}-${s.maxRir || '?'} RIR`;

  const noteTag = (includeNoteTag && s.notes && s.notes.trim()) ? ` <span class="plan-note-tag">NOTE</span>` : '';
  return `${main}${effort}${noteTag}`;
}

// Generic list row used by Microcycle / Session / Exercise lists (name, sub-label,
// tap-to-open, delete, optional up/down reorder)
function planEditorRow(label, sub, openAction, deleteAction, idx, total, moveUpAction, moveDownAction) {
  return `<div class="plan-row">
    <div class="plan-row-main" onclick="${openAction}">
      <div class="plan-row-name">${escapeHtml(label)}</div>
      <div class="plan-row-sub">${sub}</div>
    </div>
    <div class="plan-row-controls">
      ${idx > 0 ? `<button class="btn-icon btn-sm" onclick="${moveUpAction}">&uarr;</button>` : ''}
      ${idx < total - 1 ? `<button class="btn-icon btn-sm" onclick="${moveDownAction}">&darr;</button>` : ''}
      <button class="btn-icon btn-sm" style="color:var(--red)" onclick="${deleteAction}">&#10005;</button>
    </div>
  </div>`;
}

// Row variant used by Microcycle / Session lists, where actions (Move, Duplicate,
// Delete) are consolidated behind a single ... menu to keep rows compact.
function planEditorRowWithMenu(label, sub, openAction, menuAction) {
  return `<div class="plan-row">
    <div class="plan-row-main" onclick="${openAction}">
      <div class="plan-row-name">${escapeHtml(label)}</div>
      <div class="plan-row-sub">${sub}</div>
    </div>
    <div class="plan-row-controls">
      <button class="btn-icon btn-sm" onclick="${menuAction}" aria-label="Options">&bull;&bull;&bull;</button>
    </div>
  </div>`;
}

function planOpenMicrocycleRowMenu(e, mi) {
  e.stopPropagation();
  const total = planDraft.microcycles.length;
  const items = [
    ...(mi > 0 ? [{ label: 'Move Up', icon: '\u2191', action: `planMoveMicrocycle(${mi},-1)` }] : []),
    ...(mi < total - 1 ? [{ label: 'Move Down', icon: '\u2193', action: `planMoveMicrocycle(${mi},1)` }] : []),
    { divider: true },
    { label: 'Duplicate', icon: '', action: `planDuplicateMicrocycle(${mi})` },
    { label: 'Delete', icon: '', action: `planDeleteMicrocycle(${mi})`, danger: true },
  ];
  showDropdown(e.currentTarget, items);
}

function planDuplicateMicrocycle(mi) {
  const copy = JSON.parse(JSON.stringify(planDraft.microcycles[mi]));
  copy.name = (copy.name || `Micro ${mi + 1}`) + ' (Copy)';
  planDraft.microcycles.splice(mi + 1, 0, copy);
  planRenderDetailsEditor();
  showToast('Microcycle duplicated', 'success');
}

// ==================== PROGRAM LIBRARY ====================

function renderPlanLibrary() {
  planDraft = null; planEditorOrigin = null; // leaving any in-progress edit
  const c = planContainer(); if (!c) return;
  const progs = appDb.programs.filter(p => p.recordType !== 'activeProgram').sort((a, b) => {
    if (planLibrarySort === 'recent') return (b.updatedAt || 0) - (a.updatedAt || 0);
    return (a.name || '').localeCompare(b.name || '');
  });
  const list = progs.length ? progs.map(planLibraryCard).join('') :
    `<div class="empty-state"><h3>No Program Templates Yet</h3><p>Create one to get started</p></div>`;
  c.innerHTML = `
    <div class="page-title-zone">
      <div class="page-title-zone-title">Programs</div>
      <button class="btn-icon" onclick="openPlanLibraryMenu(event)" aria-label="Program options">\u2022\u2022\u2022</button>
    </div>
    <div id="plan-library-list">${list}</div>
  `;
}

function planLibraryCard(p) {
  const meta = planDeriveMeta(p);
  return `<div class="program-card" style="cursor:pointer" onclick="planOpenProfile('${p.id}')">
    <div class="program-name">${escapeHtml(p.name || 'Untitled Program')}</div>
    ${p.description ? `<div class="plan-card-desc">${escapeHtml(p.description)}</div>` : ''}
    ${meta ? `<div class="plan-card-meta">${meta}</div>` : ''}
  </div>`;
}

function openPlanLibraryMenu(e) {
  e.stopPropagation();
  const items = [
    { label: 'Create Program', icon: '+', action: 'planCreateNewProgram()' },
    { divider: true },
    { label: 'Sort A - Z', icon: '', toggle: planLibrarySort === 'alpha' ? '\u2713 ' : '', action: `planSetLibrarySort('alpha')` },
    { label: 'Sort Recently Edited', icon: '', toggle: planLibrarySort === 'recent' ? '\u2713 ' : '', action: `planSetLibrarySort('recent')` },
  ];
  showDropdown(e.currentTarget, items);
}
function planSetLibrarySort(v) { planLibrarySort = v; renderPlanLibrary(); }

// ==================== PROGRAM PROFILE (read-only) ====================

function planOpenProfile(programId) {
  const p = appDb.programs.find(x => x.id === programId);
  if (!p || p.recordType === 'activeProgram') { renderPlanLibrary(); return; }
  planDraft = null; planEditorOrigin = null;
  planCurrentProgId = programId;
  const c = planContainer(); if (!c) return;

  const meta = planDeriveMeta(p);
  const mcs = p.microcycles || [];

  const structureHtml = mcs.length ? mcs.map((mc, mi) => `
    <div class="plan-mc-card">
      <div class="plan-mc-header" onclick="planToggleProfileMc(${mi})">
        <div class="plan-mc-num">${mi + 1}</div>
        <div class="plan-mc-info">
          <div class="plan-mc-name">${escapeHtml(mc.name || `Micro ${mi + 1}`)}</div>
          <div class="plan-mc-sub">${(mc.sessions || []).length} session${(mc.sessions || []).length !== 1 ? 's' : ''}</div>
        </div>
        <svg class="plan-mc-chevron" id="plan-mc-chevron-${mi}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="plan-mc-body" id="plan-profile-mc-body-${mi}"></div>
    </div>
  `).join('') : `<div class="plan-profile-empty">No microcycles added yet</div>`;

  c.innerHTML = `
    <div class="page-title-zone">
      <button class="btn-icon" onclick="renderPlanLibrary()" aria-label="Back">&#8592;</button>
      <div class="page-title-zone-title" style="flex:1;margin-left:8px;font-size:20px">${escapeHtml(p.name || 'Untitled Program')}</div>
      <button class="btn-icon" onclick="openPlanProfileMenu(event,'${p.id}')" aria-label="Program options">\u2022\u2022\u2022</button>
    </div>
    <div style="padding:14px 16px 20px">
      ${p.description ? `<div style="font-size:15px;color:var(--text2);margin-bottom:8px;line-height:1.5">${escapeHtml(p.description)}</div>` : ''}
      ${meta ? `<div class="plan-card-meta" style="margin-bottom:14px">${meta}</div>` : ''}
      ${p.notes ? `<div style="margin-bottom:6px"><div class="prof-section-label" style="margin-bottom:4px">Program Notes</div><div style="font-size:14px;color:var(--text2);line-height:1.6">${escapeHtml(p.notes).replace(/\n/g, '<br>')}</div></div>` : ''}
      <div class="prof-divider" style="margin:18px 0"></div>
      <div style="display:flex;gap:10px">
        <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="planStartOnTrain('${p.id}')">Start on Train</button>
        <button class="btn btn-secondary" style="flex:1;justify-content:center" onclick="planEditTemplate('${p.id}')">Edit Template</button>
      </div>
      <div class="prof-divider" style="margin:20px 0"></div>
      <div class="prof-section-label" style="margin-bottom:10px">Program Structure</div>
      ${structureHtml}
    </div>
  `;
}

function planToggleProfileMc(mi) {
  const p = appDb.programs.find(x => x.id === planCurrentProgId);
  if (!p) return;
  const body = document.getElementById(`plan-profile-mc-body-${mi}`);
  if (!body) return;
  const isOpen = body.style.display === 'block';

  document.querySelectorAll('[id^="plan-profile-mc-body-"]').forEach(el => el.style.display = 'none');
  document.querySelectorAll('[id^="plan-mc-chevron-"]').forEach(el => el.style.transform = '');
  if (isOpen) return;

  const mc = p.microcycles[mi];
  const sessions = mc.sessions || [];
  body.innerHTML = sessions.length ? sessions.map(sess => {
    const exs = sess.exercises || [];
    const exHtml = exs.length ? exs.map(ex => {
      const exData = getExercise(ex.exerciseId);
      const sets = (ex.sets || []).map(s => `<div class="plan-ex-set-line">${planFormatSetSummary(s)}</div>`).join('');
      return `<div class="plan-ex-row">
        <div class="plan-ex-name">${exData ? escapeHtml(exData.name) : ex.exerciseId}</div>
        ${sets || `<div class="plan-ex-set-line">No sets added yet</div>`}
      </div>`;
    }).join('') : `<div class="plan-profile-empty" style="padding-left:12px">No exercises added yet</div>`;
    return `<div class="plan-session-block">
      <div class="plan-session-title">${escapeHtml(sess.name || 'Session')}</div>
      ${exHtml}
    </div>`;
  }).join('') : `<div class="plan-profile-empty">No sessions added yet</div>`;

  body.style.display = 'block';
  const chevron = document.getElementById(`plan-mc-chevron-${mi}`);
  if (chevron) chevron.style.transform = 'rotate(180deg)';
}

function openPlanProfileMenu(e, programId) {
  e.stopPropagation();
  const items = [
    { label: 'Duplicate Template', icon: '', action: `planDuplicateTemplate('${programId}')` },
    { divider: true },
    { label: 'Delete Template', icon: '', action: `planDeleteTemplate('${programId}')`, danger: true },
  ];
  showDropdown(e.currentTarget, items);
}

function planStartOnTrain(programId) {
  const p = appDb.programs.find(x => x.id === programId);
  if (!p) return;
  if (!p.planSchema) {
    // Legacy-format program — already fully supported by Train today.
    selectProgramForWorkout(programId);
    return;
  }
  confirm2(
    'Start Program on Train?',
    'This creates an active copy of this template on Train. The template in Plan will remain unchanged.',
    () => planCreateActiveInstance(p),
    'Start Program',
    false // not a destructive action — show as primary, not danger
  );
}

// Creates a new, independent active-program record for Train, cloned from a template.
// The template record itself is never modified.
function planCreateActiveInstance(template) {
  const snapshot = JSON.parse(JSON.stringify(template.microcycles || []));
  const active = {
    id: uid(),
    recordType: 'activeProgram',
    activeSchema: 1,
    templateId: template.id,
    status: 'active',
    name: template.name || 'Untitled Program',
    structureLabel: template.structureLabel || '',
    sourceSnapshot: JSON.parse(JSON.stringify(snapshot)),
    microcycles: snapshot,
    completedSessionKeys: [],
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  appDb.programs.push(active);
  fsSaveProgram(active);
  showToast('Program started', 'success');
  showPage('page-home');
}

// ---- Active-instance session helpers (also used by Train in app-core.js) ----
function planSessionKey(mi, si) { return `mc${mi}_s${si}`; }

function planGetFirstUnfinishedSession(active) {
  const mcs = Array.isArray(active.microcycles) ? active.microcycles : [];
  const completed = active.completedSessionKeys || [];
  for (let mi = 0; mi < mcs.length; mi++) {
    const sessions = Array.isArray(mcs[mi].sessions) ? mcs[mi].sessions : [];
    for (let si = 0; si < sessions.length; si++) {
      if (!completed.includes(planSessionKey(mi, si))) return { microcycleIdx: mi, sessionIdx: si, key: planSessionKey(mi, si) };
    }
  }
  return null;
}

function planCountActiveSessions(active) {
  const mcs = Array.isArray(active.microcycles) ? active.microcycles : [];
  return mcs.reduce((a, mc) => a + ((mc.sessions || []).length), 0);
}

// Translates one Plan-prescription set into a Workout Logger set.
// Fixed values prefill the logger fields. %TM and %1RM prefill the weight field too,
// using the active instance's stored Training Max / 1RM (if one exists) — everything
// else (ranges, bodyweight, RIR, notes) is preserved as read-only target context only,
// no resolution or progression logic applied here.
// exerciseId/active are optional — omitting them just skips %TM/%1RM/workingLoad resolution.
// progression (the exercise's own progression object) is optional — only needed to
// gate blank-fixed-load resolution to addLoad-eligible exercises.
function planSetToLoggerSet(planSet, exerciseId, active, progression) {
  const s = planSet || {};
  const out = { weight: '', reps: '', time: '', rpe: '', autoFilled: false, autoType: null, completed: false };
  const isWorkingLoadEligible = !!(progression && progression.enabled && progression.adjustmentType === 'addLoad');
  if (s.loadType === 'fixed' && s.weight) {
    out.weight = String(s.weight);
  } else if (s.loadType === 'percentTM' && exerciseId && active) {
    const pct = parseFloat(s.percent);
    const tmVal = getActiveTrainingMax(active, exerciseId);
    if (!isNaN(pct) && tmVal != null) {
      out.weight = String(resolvePercentTMWeight(pct, tmVal));
      out.autoFilled = true;
      out.autoType = 'percentTM';
    }
  } else if (s.loadType === 'percent1RM' && exerciseId && active) {
    const pct = parseFloat(s.percent);
    const ormVal = getActiveOneRepMax(active, exerciseId);
    if (!isNaN(pct) && ormVal != null) {
      out.weight = String(resolvePercent1RMWeight(pct, ormVal));
      out.autoFilled = true;
      out.autoType = 'percent1RM';
    }
  } else if (s.loadType === 'fixed' && !s.weight && exerciseId && active && isWorkingLoadEligible) {
    const wlVal = getActiveWorkingLoad(active, exerciseId);
    if (wlVal != null) {
      out.weight = String(wlVal);
      out.autoFilled = true;
      out.autoType = 'workingLoad';
    }
  }
  if (s.repsType === 'fixed' && s.reps) out.reps = String(s.reps);
  if (s.timeType === 'fixed' && s.seconds) out.time = String(s.seconds);
  const hasTarget = !!(s.loadType || s.repsType || s.effortType || s.timeType || (s.notes && s.notes.trim()));
  out.targetSummary = hasTarget ? planFormatSetSummary(s, false, isWorkingLoadEligible) : '';
  out.targetData = { ...s };
  return out;
}

function planDuplicateTemplate(programId) {
  const p = appDb.programs.find(x => x.id === programId);
  if (!p) return;
  const copy = JSON.parse(JSON.stringify(p));
  copy.id = uid();
  copy.name = (p.name || 'Untitled Program') + ' (Copy)';
  copy.updatedAt = Date.now();
  delete copy.completedSessionIndices;
  delete copy.trainingMaxes;
  delete copy.lastUsed;
  appDb.programs.push(copy);
  fsSaveProgram(copy);
  showToast('Template duplicated', 'success');
  renderPlanLibrary();
}

function planDeleteTemplate(programId) {
  confirm2('Delete Template?', 'This permanently removes the program template. This cannot be undone.', () => {
    appDb.programs = appDb.programs.filter(p => p.id !== programId);
    fsDelProgram(programId);
    showToast('Template deleted', 'success');
    renderPlanLibrary();
  }, 'Delete');
}

// ==================== ENTER / EXIT EDITOR ====================

function planCreateNewProgram() {
  planDraft = { id: uid(), name: '', description: '', structureLabel: '', notes: '', microcycles: [] };
  planSnapshot = JSON.stringify(planDraft);
  planEditorOrigin = { type: 'library' };
  planRenderDetailsEditor();
}

function planEditTemplate(programId) {
  const p = appDb.programs.find(x => x.id === programId);
  if (!p) return;
  planDraft = JSON.parse(JSON.stringify(p));
  if (planDraft.description === undefined) planDraft.description = '';
  if (planDraft.structureLabel === undefined) planDraft.structureLabel = '';
  if (planDraft.notes === undefined) planDraft.notes = '';
  if (!planDraft.microcycles) planDraft.microcycles = [];
  planSnapshot = JSON.stringify(planDraft);
  planEditorOrigin = { type: 'profile', id: programId };
  planRenderDetailsEditor();
}

function planExitEditorToOrigin() {
  const changed = JSON.stringify(planDraft) !== planSnapshot;
  const origin = planEditorOrigin;
  const doExit = () => {
    planDraft = null; planEditorOrigin = null;
    if (origin && origin.type === 'profile') planOpenProfile(origin.id);
    else renderPlanLibrary();
  };
  if (changed) confirm2('Discard Changes?', 'You have unsaved edits to this template. Discard them?', doExit, 'Discard');
  else doExit();
}

function planSaveTemplate() {
  if (!planDraft) return;
  const name = (planDraft.name || '').trim();
  if (!name) { showToast('Enter a program name', 'error'); return; }
  planDraft.name = name;
  planDraft.updatedAt = Date.now();
  planDraft.planSchema = 2; // marks this template as edited/created by the new Plan editor
  planDraft.recordType = 'template';
  const idx = appDb.programs.findIndex(p => p.id === planDraft.id);
  if (idx === -1) appDb.programs.push(planDraft);
  else appDb.programs[idx] = planDraft;
  fsSaveProgram(planDraft);
  planSnapshot = JSON.stringify(planDraft);
  showToast('Template saved', 'success');
}

// Top bar reused by every draft-editing screen: [Back] Program Name [Save/Save Changes]
// plus a subdued breadcrumb trail showing where in the hierarchy this screen sits.
// breadcrumbSegments is an array of strings, e.g. ['Micro 1', 'Push A', 'Bench Press'].
function planEditorTopBar(breadcrumbSegments, backAction) {
  const progName = (planDraft.name || 'Untitled Program').trim() || 'Untitled Program';
  const trail = (breadcrumbSegments || []).filter(Boolean).map(escapeHtml).join(' <span class="plan-breadcrumb-sep">&rsaquo;</span> ');
  return `<div class="page-title-zone" style="flex-direction:column;align-items:stretch;gap:3px;padding-bottom:10px">
    <div style="display:flex;align-items:center">
      <button class="btn-icon" onclick="${backAction}" aria-label="Back">&#8592;</button>
      <div class="page-title-zone-title" style="flex:1;margin-left:8px;font-size:18px">${escapeHtml(progName)}</div>
      <button class="btn btn-primary btn-sm" onclick="planSaveTemplate()">Save</button>
    </div>
    ${trail ? `<div class="plan-breadcrumb">${trail}</div>` : ''}
  </div>`;
}

// ==================== PROGRAM DETAILS EDITOR ====================

function planRenderDetailsEditor() {
  const c = planContainer(); if (!c || !planDraft) return;
  const mcs = planDraft.microcycles;
  const mcList = mcs.length ? mcs.map((mc, mi) => planEditorRowWithMenu(
    mc.name || `Micro ${mi + 1}`,
    planMicrocycleSummary(mc),
    `planOpenMicrocycle(${mi})`,
    `planOpenMicrocycleRowMenu(event,${mi})`
  )).join('') : planEmptyState('No Microcycles yet.', 'Create your first microcycle to begin building this program.');

  c.innerHTML = `
    ${planEditorTopBar(['Program Details'], 'planExitEditorToOrigin()')}
    <div class="plan-editor" style="padding:16px">
      <div class="form-group"><label>Program Name</label><input type="text" value="${escapeHtml(planDraft.name)}" placeholder="e.g. 12-Week Hypertrophy" oninput="planDraft.name=this.value"></div>
      <div class="form-group"><label>Description</label><textarea style="min-height:60px" placeholder="Short summary for the library card" oninput="planDraft.description=this.value">${escapeHtml(planDraft.description)}</textarea></div>
      <div class="form-group"><label>Structure Label</label><input type="text" value="${escapeHtml(planDraft.structureLabel)}" placeholder="e.g. PPL+, Upper/Lower, Rotating" oninput="planDraft.structureLabel=this.value"></div>
      <div class="form-group"><label>Program Notes</label><textarea placeholder="Phase explanations, reminders, instructions..." oninput="planDraft.notes=this.value">${escapeHtml(planDraft.notes)}</textarea></div>
      <div class="prof-section-label" style="margin:18px 0 8px">Microcycles</div>
      ${mcList}
      <button class="btn btn-secondary" style="width:100%;margin-top:8px" onclick="planAddMicrocycle()">+ Add Microcycle</button>
    </div>
  `;
}

function planAddMicrocycle() {
  planDraft.microcycles.push({ name: `Micro ${planDraft.microcycles.length + 1}`, sessions: [] });
  planRenderDetailsEditor();
}
function planDeleteMicrocycle(mi) {
  confirm2('Delete Microcycle?', 'This removes all sessions inside this microcycle.', () => {
    planDraft.microcycles.splice(mi, 1);
    planRenderDetailsEditor();
  }, 'Delete');
}
function planMoveMicrocycle(mi, dir) {
  planMoveInArray(planDraft.microcycles, mi, dir);
  planRenderDetailsEditor();
}

// ==================== MICROCYCLE EDITOR ====================

function planOpenMicrocycle(mi) {
  const c = planContainer(); if (!c || !planDraft) return;
  const mc = planDraft.microcycles[mi];
  const sessions = mc.sessions;
  const sessList = sessions.length ? sessions.map((s, si) => planEditorRowWithMenu(
    s.name || `Session ${si + 1}`,
    planSessionSummary(s),
    `planOpenSession(${mi},${si})`,
    `planOpenSessionRowMenu(event,${mi},${si})`
  )).join('') : planEmptyState('No Sessions yet.', 'Add a session to this microcycle.');

  c.innerHTML = `
    ${planEditorTopBar([mc.name || `Micro ${mi + 1}`], 'planBackToDetails()')}
    <div class="plan-editor" style="padding:16px">
      ${planLevelEyebrow('Microcycle')}
      <div class="form-group"><label>Microcycle Label</label><input type="text" value="${escapeHtml(mc.name || '')}" placeholder="e.g. Accumulation" oninput="planDraft.microcycles[${mi}].name=this.value"></div>
      <div class="prof-section-label" style="margin:16px 0 8px">Sessions</div>
      ${sessList}
      <button class="btn btn-secondary" style="width:100%;margin-top:8px" onclick="planAddSession(${mi})">+ Add Session</button>
      <button class="btn btn-danger" style="width:100%;margin-top:18px" onclick="planDeleteMicrocycle(${mi})">Delete This Microcycle</button>
    </div>
  `;
}
function planBackToDetails() { planRenderDetailsEditor(); }
function planAddSession(mi) {
  planDraft.microcycles[mi].sessions.push({ name: `Session ${planDraft.microcycles[mi].sessions.length + 1}`, notes: '', exercises: [] });
  planOpenMicrocycle(mi);
}
function planDeleteSession(mi, si) {
  confirm2('Delete Session?', 'This removes all exercises and set prescriptions in this session.', () => {
    planDraft.microcycles[mi].sessions.splice(si, 1);
    planOpenMicrocycle(mi);
  }, 'Delete');
}
function planMoveSession(mi, si, dir) { planMoveInArray(planDraft.microcycles[mi].sessions, si, dir); planOpenMicrocycle(mi); }

function planOpenSessionRowMenu(e, mi, si) {
  e.stopPropagation();
  const total = planDraft.microcycles[mi].sessions.length;
  const items = [
    ...(si > 0 ? [{ label: 'Move Up', icon: '\u2191', action: `planMoveSession(${mi},${si},-1)` }] : []),
    ...(si < total - 1 ? [{ label: 'Move Down', icon: '\u2193', action: `planMoveSession(${mi},${si},1)` }] : []),
    { divider: true },
    { label: 'Duplicate', icon: '', action: `planDuplicateSession(${mi},${si})` },
    { label: 'Delete', icon: '', action: `planDeleteSession(${mi},${si})`, danger: true },
  ];
  showDropdown(e.currentTarget, items);
}

function planDuplicateSession(mi, si) {
  const copy = JSON.parse(JSON.stringify(planDraft.microcycles[mi].sessions[si]));
  copy.name = (copy.name || `Session ${si + 1}`) + ' (Copy)';
  planDraft.microcycles[mi].sessions.splice(si + 1, 0, copy);
  planOpenMicrocycle(mi);
  showToast('Session duplicated', 'success');
}

// ==================== SESSION EDITOR ====================

function planOpenSession(mi, si) {
  const c = planContainer(); if (!c || !planDraft) return;
  const mc = planDraft.microcycles[mi];
  const sess = mc.sessions[si];
  const exs = sess.exercises;
  const exList = exs.length ? exs.map((ex, ei) => {
    const exData = getExercise(ex.exerciseId);
    const name = exData ? exData.name : ex.exerciseId;
    return planEditorRow(
      name,
      planExerciseSummary(ex),
      `planOpenExercise(${mi},${si},${ei})`,
      `planDeleteExercise(${mi},${si},${ei})`,
      ei, exs.length,
      `planMoveExercise(${mi},${si},${ei},-1)`,
      `planMoveExercise(${mi},${si},${ei},1)`
    );
  }).join('') : planEmptyState('No Exercises yet.', 'Add your first exercise to begin building this session.');

  c.innerHTML = `
    ${planEditorTopBar([mc.name || `Micro ${mi + 1}`, sess.name || `Session ${si + 1}`], `planBackToMicrocycle(${mi})`)}
    <div class="plan-editor" style="padding:16px">
      ${planLevelEyebrow('Session')}
      <div class="form-group"><label>Session Name</label><input type="text" value="${escapeHtml(sess.name || '')}" placeholder="e.g. Push A" oninput="planDraft.microcycles[${mi}].sessions[${si}].name=this.value"></div>
      <div class="form-group"><label>Session Notes <span style="color:var(--text3);font-weight:400">(optional)</span></label><textarea placeholder="Session-specific notes..." oninput="planDraft.microcycles[${mi}].sessions[${si}].notes=this.value">${escapeHtml(sess.notes || '')}</textarea></div>
      <div class="prof-section-label" style="margin:16px 0 8px">Exercises</div>
      ${exList}
      <button class="btn btn-secondary" style="width:100%;margin-top:8px" onclick="planAddExerciseToSession(${mi},${si})">+ Add Exercise</button>
      <button class="btn btn-danger" style="width:100%;margin-top:18px" onclick="planDeleteSession(${mi},${si})">Delete This Session</button>
    </div>
  `;
}
function planBackToMicrocycle(mi) { planOpenMicrocycle(mi); }
function planAddExerciseToSession(mi, si) {
  openExBrowser('planMultiSelect', exId => {
    planDraft.microcycles[mi].sessions[si].exercises.push({ exerciseId: exId, notes: '', sets: [], progression: { enabled: false } });
    planOpenSession(mi, si);
  }, 'plan');
}
function planDeleteExercise(mi, si, ei) {
  confirm2('Remove Exercise?', 'This removes this exercise from the session template.', () => {
    planDraft.microcycles[mi].sessions[si].exercises.splice(ei, 1);
    planOpenSession(mi, si);
  }, 'Remove');
}
function planMoveExercise(mi, si, ei, dir) { planMoveInArray(planDraft.microcycles[mi].sessions[si].exercises, ei, dir); planOpenSession(mi, si); }

// ==================== EXERCISE PRESCRIPTION EDITOR ====================

function planOpenExercise(mi, si, ei) {
  const c = planContainer(); if (!c || !planDraft) return;
  const mc = planDraft.microcycles[mi];
  const sess = mc.sessions[si];
  const ex = sess.exercises[ei];
  const exData = getExercise(ex.exerciseId);
  const name = exData ? exData.name : ex.exerciseId;
  const sets = ex.sets;
  const setList = sets.length ? sets.map((s, seti) => `
    <div class="plan-set-row">
      <div class="plan-set-row-main" onclick="planOpenSet(${mi},${si},${ei},${seti})">
        <span class="plan-set-row-num">${seti + 1}</span>
        <span class="plan-set-row-summary">${planFormatSetSummary(s, true, !!(ex.progression && ex.progression.enabled && ex.progression.adjustmentType === 'addLoad'))}</span>
      </div>
      <div class="plan-row-controls">
        ${seti > 0 ? `<button class="btn-icon btn-sm" onclick="planMoveSet(${mi},${si},${ei},${seti},-1)">&uarr;</button>` : ''}
        ${seti < sets.length - 1 ? `<button class="btn-icon btn-sm" onclick="planMoveSet(${mi},${si},${ei},${seti},1)">&darr;</button>` : ''}
        <button class="btn-icon btn-sm" style="color:var(--red)" onclick="planDeleteSet(${mi},${si},${ei},${seti})">&#10005;</button>
      </div>
    </div>
  `).join('') : planEmptyState('No Sets yet.', 'Add your first prescribed set.');

  c.innerHTML = `
    ${planEditorTopBar([mc.name || `Micro ${mi + 1}`, sess.name || `Session ${si + 1}`, name], `planBackToSession(${mi},${si})`)}
    <div class="plan-editor" style="padding:16px">
      ${planLevelEyebrow('Exercise')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:10px">
        <div style="font-family:var(--font-display);font-size:20px;font-weight:800;text-transform:uppercase">${escapeHtml(name)}</div>
        <button class="btn btn-ghost btn-sm" style="flex-shrink:0" onclick="planChangeExercise(${mi},${si},${ei})">Change Exercise</button>
      </div>
      <div class="form-group"><label>Prescription Notes <span style="color:var(--text3);font-weight:400">(optional)</span></label><textarea placeholder="Notes specific to this exercise in this program..." oninput="planDraft.microcycles[${mi}].sessions[${si}].exercises[${ei}].notes=this.value">${escapeHtml(ex.notes || '')}</textarea></div>
      <div class="prof-section-label" style="margin:16px 0 8px">Sets</div>
      ${setList}
      <button class="btn btn-secondary" style="width:100%;margin-top:8px" onclick="planAddSet(${mi},${si},${ei})">+ Add Set</button>

      <div style="margin-top:18px">
        ${planRenderProgressionSection(mi, si, ei)}
      </div>

      <button class="btn btn-danger" style="width:100%;margin-top:18px" onclick="planDeleteExercise(${mi},${si},${ei})">Remove This Exercise</button>
    </div>
  `;
}
function planBackToSession(mi, si) { planOpenSession(mi, si); }

// ==================== PROGRESSION V1 (Plan-only — no Train evaluation yet) ====================

function planDefaultLoadIncrease() {
  return appDb.unit === 'kg' ? 2.5 : 5;
}

// Whether this exercise's prescribed sets contain each load type — used to decide
// which progression adjustment options are actually usable.
function planExerciseHasFixedLoadSet(ex) {
  return (ex.sets || []).some(s => s.loadType === 'fixed');
}
function planExerciseHasPercentTMSet(ex) {
  return (ex.sets || []).some(s => s.loadType === 'percentTM');
}

function planProgressionSummaryText(ex) {
  const prog = ex.progression;
  if (!prog || !prog.enabled) return '';
  const unit = appDb.unit === 'kg' ? 'kg' : 'lb';
  const sets = ex.sets || [];
  let gatewayIdx = prog.gatewaySetIndex || 0;
  if (gatewayIdx < 0 || gatewayIdx >= sets.length) gatewayIdx = 0;
  const evalLabel = prog.evaluationType === 'volume' ? 'Volume Total'
    : prog.evaluationType === 'gateway' ? `Gateway Set ${gatewayIdx + 1}`
    : 'Strict Match';

  if (prog.adjustmentType === 'increaseTM') {
    const rawTM = parseFloat(prog.tmIncrease);
    const tmVal = (!isNaN(rawTM) && rawTM > 0) ? rawTM : planDefaultLoadIncrease();
    return `${evalLabel} \u2022 TM +${tmVal} ${unit} on pass \u2022 Repeat on fail`;
  }

  const rawLoad = parseFloat(prog.loadIncrease);
  const loadVal = (!isNaN(rawLoad) && rawLoad > 0) ? rawLoad : planDefaultLoadIncrease();
  return `${evalLabel} \u2022 +${loadVal} ${unit} on pass \u2022 Repeat on fail`;
}

function planRenderProgressionSection(mi, si, ei) {
  const ex = planDraft.microcycles[mi].sessions[si].exercises[ei];
  const prog = ex.progression;
  const enabled = !!(prog && prog.enabled);

  if (!enabled) {
    return `
      <div class="plan-field-group">
        <div class="prof-section-label" style="margin-bottom:8px">Progression</div>
        <div style="font-size:13px;color:var(--text3);margin-bottom:12px">Off</div>
        <button class="btn btn-secondary btn-sm" onclick="planEnableProgression(${mi},${si},${ei})">Enable Progression</button>
      </div>
    `;
  }

  const unit = appDb.unit === 'kg' ? 'kg' : 'lb';
  const evalType = prog.evaluationType || 'strict';
  const sets = ex.sets || [];
  let gatewayIdx = prog.gatewaySetIndex || 0;
  if (gatewayIdx < 0 || gatewayIdx >= sets.length) gatewayIdx = 0;

  const hasFixed = planExerciseHasFixedLoadSet(ex);
  const hasPercentTM = planExerciseHasPercentTMSet(ex);

  // Safety net: if sets changed since this rule was configured (e.g. the last
  // fixed-load set was deleted) and the selected adjustment is no longer usable,
  // fall back to whichever option is still compatible rather than showing a
  // broken/impossible rule. This runs every time the exercise screen renders.
  let adjustmentType = prog.adjustmentType || 'addLoad';
  if (adjustmentType === 'addLoad' && !hasFixed && hasPercentTM) adjustmentType = 'increaseTM';
  else if (adjustmentType === 'increaseTM' && !hasPercentTM && hasFixed) adjustmentType = 'addLoad';
  if (adjustmentType !== prog.adjustmentType) prog.adjustmentType = adjustmentType;

  const rawLoad = parseFloat(prog.loadIncrease);
  const loadVal = (!isNaN(rawLoad) && rawLoad > 0) ? rawLoad : planDefaultLoadIncrease();
  const rawTM = parseFloat(prog.tmIncrease);
  const tmVal = (!isNaN(rawTM) && rawTM > 0) ? rawTM : planDefaultLoadIncrease();

  const gatewayOptions = sets.map((s, i) =>
    `<option value="${i}" ${i === gatewayIdx ? 'selected' : ''}>Set ${i + 1}</option>`
  ).join('');

  const canAddLoad = hasFixed;
  const canIncreaseTM = hasPercentTM;
  const noCompatible = !canAddLoad && !canIncreaseTM;

  const amountFieldHtml = adjustmentType === 'increaseTM' ? `
      <div class="form-group" style="margin-bottom:0">
        <label>Training Max Increase (${unit})</label>
        <input type="number" step="0.5" min="0" value="${tmVal}"
          oninput="planLiveUpdateProgTM(${mi},${si},${ei},this.value)"
          onchange="planNormalizeProgTM(${mi},${si},${ei})">
      </div>` : `
      <div class="form-group" style="margin-bottom:0">
        <label>Load Increase on Pass (${unit})</label>
        <input type="number" step="0.5" min="0" value="${loadVal}"
          oninput="planLiveUpdateProgLoad(${mi},${si},${ei},this.value)"
          onchange="planNormalizeProgLoad(${mi},${si},${ei})">
      </div>`;

  const footerNote = adjustmentType === 'increaseTM'
    ? 'Training Max changes apply only to the active program instance after user approval.'
    : 'Load increases will apply to fixed-load sets only.';

  return `
    <div class="plan-field-group">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div class="prof-section-label" style="margin-bottom:0">Progression</div>
        <button class="btn btn-ghost btn-sm" style="padding:4px 10px;font-size:11px" onclick="planDisableProgression(${mi},${si},${ei})">Turn Off</button>
      </div>
      <div id="prog-summary-${mi}-${si}-${ei}" style="font-size:13px;color:var(--text2);margin-bottom:14px">${planProgressionSummaryText(ex)}</div>

      <div class="form-group" style="margin-bottom:12px">
        <label>Evaluation Rule</label>
        <select onchange="planSetProgField(${mi},${si},${ei},'evaluationType',this.value)">
          <option value="strict" ${evalType === 'strict' ? 'selected' : ''}>Strict Match</option>
          <option value="volume" ${evalType === 'volume' ? 'selected' : ''}>Volume Total</option>
          <option value="gateway" ${evalType === 'gateway' ? 'selected' : ''} ${!sets.length ? 'disabled' : ''}>Gateway Set</option>
        </select>
      </div>

      ${evalType === 'gateway' && sets.length ? `
      <div class="form-group" style="margin-bottom:12px">
        <label>Gateway Set</label>
        <select onchange="planSetProgField(${mi},${si},${ei},'gatewaySetIndex',this.value)">
          ${gatewayOptions}
        </select>
      </div>` : ''}

      <div class="form-group" style="margin-bottom:12px">
        <label>Adjustment on Pass</label>
        <select onchange="planSetProgField(${mi},${si},${ei},'adjustmentType',this.value)" ${noCompatible ? 'disabled' : ''}>
          <option value="addLoad" ${adjustmentType === 'addLoad' ? 'selected' : ''} ${!canAddLoad ? 'disabled' : ''}>Increase Fixed Load</option>
          <option value="increaseTM" ${adjustmentType === 'increaseTM' ? 'selected' : ''} ${!canIncreaseTM ? 'disabled' : ''}>Increase Training Max</option>
        </select>
        ${noCompatible ? `<div style="font-size:11px;color:var(--text3);margin-top:6px;font-style:italic">Add a fixed-load or %TM set to enable an adjustment.</div>` : ''}
      </div>

      ${!noCompatible ? amountFieldHtml : ''}

      <div style="font-size:12px;color:var(--text3);margin-top:12px">Failure: Repeat prescription</div>
      ${!noCompatible ? `<div style="font-size:11px;color:var(--text3);margin-top:6px;font-style:italic;line-height:1.5">${footerNote}</div>` : ''}
    </div>
  `;
}

function planEnableProgression(mi, si, ei) {
  const ex = planDraft.microcycles[mi].sessions[si].exercises[ei];
  const hasFixed = planExerciseHasFixedLoadSet(ex);
  const hasPercentTM = planExerciseHasPercentTMSet(ex);
  const adjustmentType = (hasPercentTM && !hasFixed) ? 'increaseTM' : 'addLoad';
  ex.progression = {
    enabled: true,
    evaluationType: 'strict',
    gatewaySetIndex: 0,
    adjustmentType,
    loadIncrease: planDefaultLoadIncrease(),
    tmIncrease: planDefaultLoadIncrease(),
    failBehavior: 'repeat'
  };
  planOpenExercise(mi, si, ei);
}

function planDisableProgression(mi, si, ei) {
  const ex = planDraft.microcycles[mi].sessions[si].exercises[ei];
  ex.progression = { enabled: false };
  planOpenExercise(mi, si, ei);
}

function planSetProgField(mi, si, ei, field, value) {
  const ex = planDraft.microcycles[mi].sessions[si].exercises[ei];
  if (!ex.progression) ex.progression = { enabled: true };
  if (field === 'gatewaySetIndex') {
    const sets = ex.sets || [];
    let idx = parseInt(value, 10);
    if (isNaN(idx) || idx < 0 || idx >= sets.length) idx = 0;
    ex.progression.gatewaySetIndex = idx;
  } else {
    ex.progression[field] = value;
  }
  planOpenExercise(mi, si, ei);
}

// Live-updates the in-memory value and the summary line only (no re-render)
// so the input never loses focus while typing.
function planLiveUpdateProgLoad(mi, si, ei, value) {
  const ex = planDraft.microcycles[mi].sessions[si].exercises[ei];
  if (!ex.progression) return;
  ex.progression.loadIncrease = value === '' ? '' : parseFloat(value);
  const el = document.getElementById(`prog-summary-${mi}-${si}-${ei}`);
  if (el) el.textContent = planProgressionSummaryText(ex);
}

// Fires on blur — clamps blank/invalid values back to a safe default.
function planNormalizeProgLoad(mi, si, ei) {
  const ex = planDraft.microcycles[mi].sessions[si].exercises[ei];
  if (!ex.progression) return;
  const val = parseFloat(ex.progression.loadIncrease);
  ex.progression.loadIncrease = (isNaN(val) || val <= 0) ? planDefaultLoadIncrease() : val;
  planOpenExercise(mi, si, ei);
}

// Same live-update/normalize pattern, for the Training Max Increase field.
function planLiveUpdateProgTM(mi, si, ei, value) {
  const ex = planDraft.microcycles[mi].sessions[si].exercises[ei];
  if (!ex.progression) return;
  ex.progression.tmIncrease = value === '' ? '' : parseFloat(value);
  const el = document.getElementById(`prog-summary-${mi}-${si}-${ei}`);
  if (el) el.textContent = planProgressionSummaryText(ex);
}

function planNormalizeProgTM(mi, si, ei) {
  const ex = planDraft.microcycles[mi].sessions[si].exercises[ei];
  if (!ex.progression) return;
  const val = parseFloat(ex.progression.tmIncrease);
  ex.progression.tmIncrease = (isNaN(val) || val <= 0) ? planDefaultLoadIncrease() : val;
  planOpenExercise(mi, si, ei);
}
function planChangeExercise(mi, si, ei) {
  openExBrowser('exactSelect', exId => {
    const exEntry = planDraft.microcycles[mi].sessions[si].exercises[ei];
    exEntry.exerciseId = exId;
    exEntry.notes = '';
    exEntry.sets = [];
    exEntry.progression = { enabled: false };
    planOpenExercise(mi, si, ei);
  }, 'plan');
}
function planAddSet(mi, si, ei) {
  const sets = planDraft.microcycles[mi].sessions[si].exercises[ei].sets;
  sets.push({
    loadType: '', weight: '', percent: '', addedWeight: '',
    repsType: '', reps: '', minReps: '', maxReps: '',
    effortType: '', rir: '', minRir: '', maxRir: '',
    timeType: '', seconds: '', minSeconds: '', maxSeconds: '',
    notes: ''
  });
  planOpenSet(mi, si, ei, sets.length - 1);
}
function planMoveSet(mi, si, ei, seti, dir) { planMoveInArray(planDraft.microcycles[mi].sessions[si].exercises[ei].sets, seti, dir); planOpenExercise(mi, si, ei); }
function planDeleteSet(mi, si, ei, seti) {
  confirm2('Delete Set?', 'This removes this set prescription.', () => {
    planDraft.microcycles[mi].sessions[si].exercises[ei].sets.splice(seti, 1);
    planOpenExercise(mi, si, ei);
  }, 'Delete');
}

// ==================== SET DETAIL EDITOR ====================

function planOpenSet(mi, si, ei, seti) {
  const c = planContainer(); if (!c || !planDraft) return;
  const mc = planDraft.microcycles[mi];
  const sess = mc.sessions[si];
  const ex = sess.exercises[ei];
  const exData = getExercise(ex.exerciseId);
  const exName = exData ? exData.name : ex.exerciseId;
  const s = ex.sets[seti];
  const path = `planDraft.microcycles[${mi}].sessions[${si}].exercises[${ei}].sets[${seti}]`;
  const upd = `planUpdateSetPreview(${mi},${si},${ei},${seti})`;

  const isWorkingLoadEligible = !!(ex.progression && ex.progression.enabled && ex.progression.adjustmentType === 'addLoad');
  const loadExtra =
    s.loadType === 'fixed' ? `<div class="form-group"><label>Weight (lbs)</label><input type="number" step="0.5" value="${s.weight || ''}" oninput="${path}.weight=this.value;${upd}"></div>${(!s.weight && isWorkingLoadEligible) ? `<div style="font-size:11px;color:var(--text3);margin-top:-8px;margin-bottom:8px;font-style:italic">Blank fixed loads are established as Active Working Loads on Train.</div>` : ''}`
    : s.loadType === 'percentTM' ? `<div class="form-group"><label>% TM</label><input type="number" step="1" value="${s.percent || ''}" oninput="${path}.percent=this.value;${upd}"></div>`
    : s.loadType === 'percent1RM' ? `<div class="form-group"><label>% 1RM</label><input type="number" step="1" value="${s.percent || ''}" oninput="${path}.percent=this.value;${upd}"></div>`
    : s.loadType === 'bodyweight' ? `<div class="form-group"><label>Added Weight <span style="color:var(--text3);font-weight:400">(optional)</span></label><input type="number" step="0.5" value="${s.addedWeight || ''}" oninput="${path}.addedWeight=this.value;${upd}"></div>`
    : '';

  const repsExtra =
    s.repsType === 'fixed' ? `<div class="form-group"><label>Reps</label><input type="number" step="1" value="${s.reps || ''}" oninput="${path}.reps=this.value;${upd}"></div>`
    : s.repsType === 'range' ? `<div style="display:flex;gap:10px"><div class="form-group" style="flex:1"><label>Min Reps</label><input type="number" step="1" value="${s.minReps || ''}" oninput="${path}.minReps=this.value;${upd}"></div><div class="form-group" style="flex:1"><label>Max Reps</label><input type="number" step="1" value="${s.maxReps || ''}" oninput="${path}.maxReps=this.value;${upd}"></div></div>`
    : '';

  const effortExtra =
    s.effortType === 'fixed' ? `<div class="form-group"><label>RIR</label><input type="number" step="0.5" value="${s.rir || ''}" oninput="${path}.rir=this.value;${upd}"></div>`
    : s.effortType === 'range' ? `<div style="display:flex;gap:10px"><div class="form-group" style="flex:1"><label>Min RIR</label><input type="number" step="0.5" value="${s.minRir || ''}" oninput="${path}.minRir=this.value;${upd}"></div><div class="form-group" style="flex:1"><label>Max RIR</label><input type="number" step="0.5" value="${s.maxRir || ''}" oninput="${path}.maxRir=this.value;${upd}"></div></div>`
    : '';

  const timeExtra =
    s.timeType === 'fixed' ? `<div class="form-group"><label>Seconds</label><input type="number" step="1" value="${s.seconds || ''}" oninput="${path}.seconds=this.value;${upd}"></div>`
    : s.timeType === 'range' ? `<div style="display:flex;gap:10px"><div class="form-group" style="flex:1"><label>Min Seconds</label><input type="number" step="1" value="${s.minSeconds || ''}" oninput="${path}.minSeconds=this.value;${upd}"></div><div class="form-group" style="flex:1"><label>Max Seconds</label><input type="number" step="1" value="${s.maxSeconds || ''}" oninput="${path}.maxSeconds=this.value;${upd}"></div></div>`
    : '';

  c.innerHTML = `
    ${planEditorTopBar([mc.name || `Micro ${mi + 1}`, sess.name || `Session ${si + 1}`, exName, `Set ${seti + 1}`], `planBackToExercise(${mi},${si},${ei})`)}
    <div class="plan-editor" style="padding:16px">
      ${planLevelEyebrow('Set')}
      <div class="prof-section-label" style="margin-bottom:6px">Current Prescription</div>
      <div id="plan-set-preview" class="plan-set-preview-box">${planFormatSetSummary(s, true, !!(ex.progression && ex.progression.enabled && ex.progression.adjustmentType === 'addLoad'))}</div>

      <div class="plan-field-group">
        <div class="prof-section-label" style="margin-bottom:8px">Load</div>
        <div class="form-group" style="margin-bottom:0"><select onchange="${path}.loadType=this.value;planOpenSet(${mi},${si},${ei},${seti})">
          <option value="" ${!s.loadType ? 'selected' : ''}>Blank / Decide During Workout</option>
          <option value="fixed" ${s.loadType === 'fixed' ? 'selected' : ''}>Fixed Weight</option>
          <option value="percentTM" ${s.loadType === 'percentTM' ? 'selected' : ''}>% TM</option>
          <option value="percent1RM" ${s.loadType === 'percent1RM' ? 'selected' : ''}>% 1RM</option>
          <option value="bodyweight" ${s.loadType === 'bodyweight' ? 'selected' : ''}>Bodyweight / Added Weight</option>
        </select></div>
        ${loadExtra}
      </div>

      <div class="plan-field-group">
        <div class="prof-section-label" style="margin-bottom:8px">Reps</div>
        <div class="form-group" style="margin-bottom:0"><select onchange="${path}.repsType=this.value;planOpenSet(${mi},${si},${ei},${seti})">
          <option value="" ${!s.repsType ? 'selected' : ''}>Blank</option>
          <option value="fixed" ${s.repsType === 'fixed' ? 'selected' : ''}>Fixed Reps</option>
          <option value="range" ${s.repsType === 'range' ? 'selected' : ''}>Rep Range</option>
        </select></div>
        ${repsExtra}
      </div>

      <div class="plan-field-group">
        <div class="prof-section-label" style="margin-bottom:8px">Effort (RIR)</div>
        <div class="form-group" style="margin-bottom:0"><select onchange="${path}.effortType=this.value;planOpenSet(${mi},${si},${ei},${seti})">
          <option value="" ${!s.effortType ? 'selected' : ''}>Blank</option>
          <option value="fixed" ${s.effortType === 'fixed' ? 'selected' : ''}>Fixed RIR</option>
          <option value="range" ${s.effortType === 'range' ? 'selected' : ''}>RIR Range</option>
        </select></div>
        ${effortExtra}
      </div>

      <div class="plan-field-group">
        <div class="prof-section-label" style="margin-bottom:8px">Time</div>
        <div class="form-group" style="margin-bottom:0"><select onchange="${path}.timeType=this.value;planOpenSet(${mi},${si},${ei},${seti})">
          <option value="" ${!s.timeType ? 'selected' : ''}>Blank</option>
          <option value="fixed" ${s.timeType === 'fixed' ? 'selected' : ''}>Fixed Time</option>
          <option value="range" ${s.timeType === 'range' ? 'selected' : ''}>Time Range</option>
        </select></div>
        ${timeExtra}
      </div>

      <div class="plan-field-group">
        <div class="prof-section-label" style="margin-bottom:8px">Notes</div>
        <div class="form-group" style="margin-bottom:0"><textarea placeholder="AMRAP, tempo, rest-pause, conditional instructions..." oninput="${path}.notes=this.value">${escapeHtml(s.notes || '')}</textarea></div>
      </div>
    </div>
  `;
}
function planBackToExercise(mi, si, ei) { planOpenExercise(mi, si, ei); }
function planUpdateSetPreview(mi, si, ei, seti) {
  const ex = planDraft.microcycles[mi].sessions[si].exercises[ei];
  const s = ex.sets[seti];
  const el = document.getElementById('plan-set-preview');
  if (el) el.innerHTML = planFormatSetSummary(s, true, !!(ex.progression && ex.progression.enabled && ex.progression.adjustmentType === 'addLoad'));
}

// =============================================================================
// CANONICAL PLAN MODEL -- SLICE 1 (pure, side-effect-free) -- CORRECTED
// =============================================================================
//
// Everything below this line is new, isolated source added under the
// approved architectural specification:
//   IRON LOG Canonical PLAN Record and Firestore Mapping Specification,
//   Draft 0.1 -- Controlled Source Implementation Sequence, Slice 1.
//
// This section was returned once, rejected by independent source review
// for 15 architectural defects, and has been rewritten here to correct
// every one of them. See the accompanying implementation report for the
// defect-by-defect account of what changed and why; every corrected
// function below carries its own comment pointing back to the specific
// defect(s) it fixes.
//
// SCOPE (Slice 1 only -- see spec §18):
//   Stable draft identity allocation, canonical graph normalization,
//   canonical encoding and integrity hashing, an authoritative Firestore
//   collection/path table, deep-freeze/deep-clone utilities, graph
//   manifest construction (with dependency-ordered two-hash revision
//   reuse), an immutable Template commitment package (full canonical
//   envelope + payload on every write, expanded frozen read plan,
//   removal-lifecycle planning, required projection write), a frozen
//   read-plan validator (hard schema-authority gating, full reused-
//   revision integrity), and a deterministic write-plan builder (deep-
//   frozen, independently cloned). Nothing below this line performs a
//   Firestore read, write, listener registration, transaction,
//   navigation, DOM update, or toast. Nothing below this line is called by
//   any existing function above this line, and nothing above this line is
//   modified by this section. Existing PLAN behavior is therefore
//   unchanged: these functions are present in the file but structurally
//   unreachable from the running application until a later, separately
//   authorized slice wires them in.
//
// WHAT THIS SECTION DOES NOT DO (see spec §1, §12, §17, §18):
//   - Does not connect to or read from the live Firestore client handle in
//     any way.
//   - Does not read or mutate the application's live in-memory database
//     object, the PLAN editor draft state, or any other global application
//     state.
//   - Does not change Save Template, Start on Train, or any existing PLAN
//     screen, interaction, rendering, or navigation.
//   - Does not migrate, adapt, or reinterpret legacy Templates/programs.
//   - Does not execute any of the writes it plans; planBuildTemplateCommitWrites
//     returns a deterministic write-set description only.
//   - Does not fabricate a live Firestore server timestamp; every
//     committedAt/terminatedAt/freshnessCheckpoint field carries an
//     explicit PLAN_SERVER_TIMESTAMP_SENTINEL placeholder for a later
//     slice's persistence layer to replace with the real writer primitive.
//
// PUBLIC PURE FUNCTIONS (spec §19):
//   planEnsureDraftIdentities(draft, allocator, options)
//   planNormalizeCanonicalGraph(draft)
//   planBuildCanonicalEncoding(value)
//   planBuildGraphManifest(graph, ids, deps?)
//   planBuildTemplateCommitPackage(draft, basis, ids)
//   planValidateTemplateCommitReads(package, docs)
//   planBuildTemplateCommitWrites(package, docs)
//     (round-10 review Defect #3: this now takes the exact read documents,
//     the same shape planValidateTemplateCommitReads itself takes, and
//     performs validation internally on every call -- it no longer accepts
//     a caller-supplied validation-result object at all, closing the
//     forgeable-proof gap by removing the forgeable value from the public
//     interface entirely, rather than by trying to make it unforgeable.)
//
// SUPPORTING INTERNAL MODULES (new in this correction pass):
//   00-collections.js  -- the sole authoritative Firestore collection/path
//                          table (corrects Defect #3: no more mechanical
//                          "Revisions" -> "s" path derivation anywhere).
//   09-deep-utils.js   -- planDeepFreeze / planDeepClone / planDeepEqual,
//                          hand-written recursive utilities (corrects
//                          Defect #4).
//
// A companion standalone Node test harness (plan-canonical-model.test.js,
// NOT loaded by the application) exercises these functions against the
// specification's adversarial test list, the review's 15 defects, and a
// byte-for-byte comparison of this file's legacy prefix against the
// original source. See that file, and the accompanying implementation
// report, for verification detail.
// =============================================================================

// ---- 00-collections.js ----
// Exact Firestore namespace mapping (spec Draft 0.1 §5).
//
// This table is the SOLE authority for canonical PLAN collection names and
// document paths. No other module may derive a collection name by string
// manipulation (e.g. replacing a "Revisions" suffix) -- every path in this
// codebase must be built by calling the helpers below, which read this
// table verbatim. This directly implements the review's Defect #3
// correction: "needs explicit authoritative mapping for every collection,
// never mechanical pluralization."
//
// Keyed by the *subject* recordType (the type produced by
// planNormalizeCanonicalGraph). Each entry names:
//   subjectCollection        -- users/{uid}/<subjectCollection>/{subjectId}
//   revisionRecordType       -- the recordType stamped on revision documents
//   revisionCollection       -- users/{uid}/<revisionCollection>/{revisionId}
//
// planSetGroupSubject is included for completeness with the spec's exact
// table even though Slice 1's normalizer never emits planSetGroupSubject
// nodes (spec §8: "Omitted entirely when grouping is display-only").

var PLAN_COLLECTION_MAP = {
  planTemplateSubject: {
    subjectCollection: 'planTemplates',
    revisionRecordType: 'planTemplateRevision',
    revisionCollection: 'planTemplateRevisions'
  },
  planAssignmentSubject: {
    subjectCollection: 'planAssignments',
    revisionRecordType: 'planAssignmentRevision',
    revisionCollection: 'planAssignmentRevisions'
  },
  planScheduleOpportunitySubject: {
    subjectCollection: 'planScheduleOpportunities',
    revisionRecordType: 'planScheduleOpportunityRevision',
    revisionCollection: 'planScheduleOpportunityRevisions'
  },
  planPrescriptionSubject: {
    subjectCollection: 'planPrescriptions',
    revisionRecordType: 'planPrescriptionRevision',
    revisionCollection: 'planPrescriptionRevisions'
  },
  planSetGroupSubject: {
    subjectCollection: 'planSetGroups',
    revisionRecordType: 'planSetGroupRevision',
    revisionCollection: 'planSetGroupRevisions'
  },
  planSetSubject: {
    subjectCollection: 'planSets',
    revisionRecordType: 'planSetRevision',
    revisionCollection: 'planSetRevisions'
  },
  planRuleSubject: {
    subjectCollection: 'planRules',
    revisionRecordType: 'planRuleRevision',
    revisionCollection: 'planRuleRevisions'
  },
  planImplementationRelationshipSubject: {
    subjectCollection: 'planImplementationRelationships',
    revisionRecordType: 'planImplementationRelationshipRevision',
    revisionCollection: 'planImplementationRelationshipRevisions'
  }
};

// Non-subject-keyed top-level collections named explicitly by spec §5.
var PLAN_SYSTEM_COLLECTIONS = {
  planGraphManifest: 'planGraphManifests',
  planGraphManifestChunk: 'planGraphManifestChunks',
  canonicalOperation: 'canonicalOperations',
  planCommitGateway: 'planCommitGateways',
  planTemplateSummary: 'planTemplateSummaries'
};

function planRequireOwnerUid(ownerUid, callerName) {
  if (!ownerUid) throw new Error(callerName + ': ownerUid is required');
}

function planCollectionInfoForSubjectRecordType(recordType) {
  var info = PLAN_COLLECTION_MAP[recordType];
  if (!info) throw new Error('planCollectionInfoForSubjectRecordType: unknown subject recordType: ' + recordType);
  return info;
}

// users/{uid}/{subjectCollection}/{subjectId}
function planSubjectPath(ownerUid, recordType, subjectId) {
  planRequireOwnerUid(ownerUid, 'planSubjectPath');
  var info = planCollectionInfoForSubjectRecordType(recordType);
  return 'users/' + ownerUid + '/' + info.subjectCollection + '/' + subjectId;
}

// users/{uid}/{revisionCollection}/{revisionId}
function planRevisionPath(ownerUid, recordType, revisionId) {
  planRequireOwnerUid(ownerUid, 'planRevisionPath');
  var info = planCollectionInfoForSubjectRecordType(recordType);
  return 'users/' + ownerUid + '/' + info.revisionCollection + '/' + revisionId;
}

function planRevisionRecordTypeForSubjectRecordType(recordType) {
  return planCollectionInfoForSubjectRecordType(recordType).revisionRecordType;
}

// users/{uid}/{systemCollection}/{id}
function planSystemPath(ownerUid, systemRecordType, id) {
  planRequireOwnerUid(ownerUid, 'planSystemPath');
  var collection = PLAN_SYSTEM_COLLECTIONS[systemRecordType];
  if (!collection) throw new Error('planSystemPath: unknown system recordType: ' + systemRecordType);
  return 'users/' + ownerUid + '/' + collection + '/' + id;
}

// The one global (non-user-owned) document named by the spec.
var PLAN_SCHEMA_AUTHORITY_PATH = 'schemaAuthorities/plan';

// Shared constants used by both the manifest builder (05) and the
// commit-package builder (06). Defined once, here, in the first-loaded
// module, specifically so the manifest layer's chunk byte-size accounting
// (Defect #6, source review round 4) can measure the EXACT same document
// shape -- including these fields -- that the commit-package layer will
// later actually write, instead of two independently-maintained shapes
// drifting apart.
//
// V1 never fabricates a live Firestore server timestamp (spec §1/§12; the
// "represent server-timestamp requirement abstractly, don't fabricate"
// correction from source review round 1). This sentinel stands in for
// FieldValue.serverTimestamp() (or equivalent) and must be replaced by a
// later slice's persistence layer with the real writer primitive -- never
// with a concrete client-side date/time value.
var PLAN_SERVER_TIMESTAMP_SENTINEL = '__PLAN_SERVER_TIMESTAMP__';
var PLAN_CANONICAL_ENCODING_VERSION = 1;
var PLAN_SCHEMA_VERSION = 1;

// ---- 01-sha256.js ----
// Self-contained pure-JS SHA-256 implementation (no Node crypto dependency),
// so it runs identically in-browser and in the Node test harness.
// Standard FIPS 180-4 implementation, operating on a UTF-8 encoded string
// and returning a lowercase hex digest.

var PLAN_SHA256_K = [
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
];

function planSha256RightRotate(value, amount) {
  return (value >>> amount) | (value << (32 - amount));
}

function planSha256Utf8Bytes(str) {
  // Manual UTF-8 encoder so this has zero platform dependency (works the
  // same in Node and in any browser, with or without TextEncoder).
  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    var code = str.codePointAt(i);
    if (code > 0xFFFF) i++; // consumed a surrogate pair
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
    } else if (code < 0x10000) {
      bytes.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
    } else {
      bytes.push(
        0xF0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3F),
        0x80 | ((code >> 6) & 0x3F),
        0x80 | (code & 0x3F)
      );
    }
  }
  return bytes;
}

function planSha256Hex(inputString) {
  var bytes = planSha256Utf8Bytes(String(inputString));
  var bitLength = bytes.length * 8;

  // Padding: append 0x80, then zero bytes until length % 64 === 56, then
  // the 64-bit big-endian bit length.
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  // 64-bit length, but JS bitwise ops are 32-bit; bitLength safe as double
  // for any realistic canonical PLAN payload (< 2^53 bits).
  var hi = Math.floor(bitLength / 0x100000000);
  var lo = bitLength >>> 0;
  bytes.push(
    (hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff,
    (lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff
  );

  var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  var w = new Array(64);
  for (var chunkStart = 0; chunkStart < bytes.length; chunkStart += 64) {
    for (var t = 0; t < 16; t++) {
      var off = chunkStart + t * 4;
      w[t] = ((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0;
    }
    for (var t2 = 16; t2 < 64; t2++) {
      var s0 = planSha256RightRotate(w[t2 - 15], 7) ^ planSha256RightRotate(w[t2 - 15], 18) ^ (w[t2 - 15] >>> 3);
      var s1 = planSha256RightRotate(w[t2 - 2], 17) ^ planSha256RightRotate(w[t2 - 2], 19) ^ (w[t2 - 2] >>> 10);
      w[t2] = (w[t2 - 16] + s0 + w[t2 - 7] + s1) >>> 0;
    }

    var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

    for (var i2 = 0; i2 < 64; i2++) {
      var S1 = planSha256RightRotate(e, 6) ^ planSha256RightRotate(e, 11) ^ planSha256RightRotate(e, 25);
      var ch = (e & f) ^ (~e & g);
      var temp1 = (h + S1 + ch + PLAN_SHA256_K[i2] + w[i2]) >>> 0;
      var S0 = planSha256RightRotate(a, 2) ^ planSha256RightRotate(a, 13) ^ planSha256RightRotate(a, 22);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var temp2 = (S0 + maj) >>> 0;

      h = g; g = f; f = e;
      e = (d + temp1) >>> 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  function toHex(n) { return (n >>> 0).toString(16).padStart(8, '0'); }
  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4) + toHex(h5) + toHex(h6) + toHex(h7);
}

// ---- 02-encoding.js ----
// Deterministic canonical encoding for the PLAN pure model.
//
// Spec refs: §9 "Canonical serialization sorts object keys, normalizes
// numeric and absent-value representation..."; §19 planBuildCanonicalEncoding
// "canonicalize keys/absent values/numbers/strings/arrays/explicit order
// fields for deterministic hashes."; §20 test: "equivalent normalized graphs
// produce identical hashes; a semantic change produces a different hash";
// test: "non-finite numeric values (NaN, Infinity) are rejected rather than
// silently coerced."
//
// Design:
//  - Object keys are sorted lexicographically (by UTF-16 code unit, i.e.
//    JS default string comparison) before encoding, at every depth.
//  - undefined values and object keys whose value is undefined are treated
//    as "absent" and removed entirely (they do not appear in the encoding
//    as null or as an omitted-but-order-affecting key).
//  - null is preserved as an explicit value distinct from absent.
//  - Numbers: -0 is normalized to 0. NaN and +/-Infinity are rejected by
//    throwing PlanCanonicalEncodingError, per spec "reject non-finite
//    numbers and unsupported values."
//  - Arrays preserve their given order exactly (callers are responsible for
//    only relying on array order where the spec says order is semantic;
//    everywhere else normalization must produce an explicit order field and
//    an otherwise order-independent structure, per §9/§19).
//  - Supported value types: null, boolean, finite number, string, array,
//    plain object. Anything else (function, symbol, Date, Map, etc.) is
//    rejected as an unsupported value.
//  - The output is a JSON string with no extraneous whitespace, produced by
//    a custom serializer (not JSON.stringify + replacer) so key ordering
//    and absent-value handling are fully controlled and documented.

function PlanCanonicalEncodingError(message, path) {
  this.name = 'PlanCanonicalEncodingError';
  this.message = message + (path ? ' (at ' + path + ')' : '');
  this.path = path || '';
}
PlanCanonicalEncodingError.prototype = Object.create(Error.prototype);
PlanCanonicalEncodingError.prototype.constructor = PlanCanonicalEncodingError;

function planIsPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  var proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function planCanonicalEncodeValue(value, path) {
  if (value === undefined) {
    // Absent value at the top level of an encode call: caller context
    // decides whether this is legal (object property vs. array element).
    throw new PlanCanonicalEncodingError('Unexpected undefined value', path);
  }
  if (value === null) return 'null';
  var t = typeof value;
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number') {
    if (!Number.isFinite(value)) {
      throw new PlanCanonicalEncodingError('Non-finite number is not a supported canonical value: ' + value, path);
    }
    var normalized = value === 0 ? 0 : value; // normalize -0 -> 0
    if (Object.is(normalized, -0)) normalized = 0;
    // Use a stable decimal representation. Integers print without a
    // trailing ".0"; this matches JSON number semantics.
    return String(normalized);
  }
  if (t === 'string') return planCanonicalEncodeString(value);
  if (Array.isArray(value)) return planCanonicalEncodeArray(value, path);
  if (planIsPlainObject(value)) return planCanonicalEncodeObject(value, path);
  throw new PlanCanonicalEncodingError('Unsupported canonical value type: ' + t, path);
}

function planCanonicalEncodeString(str) {
  // Minimal, deterministic JSON string escaping.
  var out = '"';
  for (var i = 0; i < str.length; i++) {
    var ch = str.charAt(i);
    var code = str.charCodeAt(i);
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (code === 0x08) out += '\\b';
    else if (code === 0x09) out += '\\t';
    else if (code === 0x0A) out += '\\n';
    else if (code === 0x0C) out += '\\f';
    else if (code === 0x0D) out += '\\r';
    else if (code < 0x20) out += '\\u' + code.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}

function planCanonicalEncodeArray(arr, path) {
  var parts = [];
  for (var i = 0; i < arr.length; i++) {
    var elPath = (path || '') + '[' + i + ']';
    if (arr[i] === undefined) {
      throw new PlanCanonicalEncodingError('Array elements must not be undefined; use null explicitly', elPath);
    }
    parts.push(planCanonicalEncodeValue(arr[i], elPath));
  }
  return '[' + parts.join(',') + ']';
}

function planCanonicalEncodeObject(obj, path) {
  var keys = Object.keys(obj).filter(function (k) { return obj[k] !== undefined; });
  keys.sort(); // lexicographic sort of object keys, per spec §9
  var parts = [];
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var kPath = (path || '') + '.' + k;
    parts.push(planCanonicalEncodeString(k) + ':' + planCanonicalEncodeValue(obj[k], kPath));
  }
  return '{' + parts.join(',') + '}';
}

// Public entry point: encode any supported canonical value (object, array,
// or primitive) into its canonical JSON string form.
function planBuildCanonicalEncoding(value) {
  return planCanonicalEncodeValue(value, '$');
}

// ---- 03-identity.js ----
// Stable draft identity allocation.
//
// Spec refs: §4 Identity and Revision Rules; §19 planEnsureDraftIdentities
// contract; §20 tests "a newly created Template and every newly created
// nested element receive a stable subject identity before the first save
// attempt", "reordering ... preserves identity", "renaming ... never
// changes identity", "Duplicate Template creates an independent subject
// graph with explicit duplication lineage".
//
// Canonical subject identity fields are namespaced with a `plan` prefix
// (planTemplateId, planMicrocycleId, planSessionId, planAssignmentId,
// planOpportunityId, planPrescriptionId, planRelationshipId, planSetId,
// planRuleId) and are kept completely separate from legacy fields (id,
// exerciseId, array position). This function never reads array position,
// exerciseId, or any name/label field to derive an identity, and it never
// mutates the input draft: it returns a new, deep-cloned draft with
// identity fields populated.
//
// Default allocator: collision-resistant opaque strings, using the best
// available randomness source. Callers (including the test harness) are
// expected to inject a deterministic allocator for reproducible tests.

function planDefaultIdAllocator() {
  var bytes;
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
  } else {
    try {
      var nodeCrypto = require('crypto');
      bytes = nodeCrypto.randomBytes(16);
    } catch (e) {
      bytes = new Uint8Array(16);
      for (var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  var hex = '';
  for (var j = 0; j < bytes.length; j++) {
    hex += bytes[j].toString(16).padStart(2, '0');
  }
  return 'plan_' + hex;
}

function planDeepClonePlain(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(planDeepClonePlain);
  var out = {};
  var keys = Object.keys(value);
  for (var i = 0; i < keys.length; i++) {
    out[keys[i]] = planDeepClonePlain(value[keys[i]]);
  }
  return out;
}

// planEnsureDraftIdentities(draft, allocator, options)
//   draft:    the nested editor draft (see app-plan.js planDraft shape).
//   allocator: () => string, injected ID source.
//   options:  optional { duplicate: true, duplicatedFromTemplateId } to
//             force a full identity remap with duplication lineage.
//
// Returns a NEW draft object; the input draft is never mutated.
function planEnsureDraftIdentities(draft, allocator, options) {
  if (!draft || typeof draft !== 'object') {
    throw new Error('planEnsureDraftIdentities: draft must be an object');
  }
  var alloc = typeof allocator === 'function' ? allocator : planDefaultIdAllocator;
  var duplicate = !!(options && options.duplicate);
  if (duplicate && !draft.planTemplateId) {
    // Duplicating a draft that was never given identities in the first
    // place is not a duplication in the spec's sense (there is no prior
    // committed subject to duplicate from); treat it as ordinary creation.
    duplicate = false;
  }

  var out = planDeepClonePlain(draft);
  var lineage = [];

  function nextId(existing, recordType) {
    if (duplicate) {
      var fresh = alloc();
      lineage.push({ oldSubjectId: existing || null, newSubjectId: fresh, recordType: recordType });
      return fresh;
    }
    if (existing) return existing;
    return alloc();
  }

  out.planTemplateId = nextId(out.planTemplateId, 'planTemplateSubject');

  var microcycles = Array.isArray(out.microcycles) ? out.microcycles : [];
  for (var mi = 0; mi < microcycles.length; mi++) {
    var mc = microcycles[mi];
    mc.planMicrocycleId = nextId(mc.planMicrocycleId, 'planMicrocycleLocal');

    var sessions = Array.isArray(mc.sessions) ? mc.sessions : [];
    for (var si = 0; si < sessions.length; si++) {
      var sess = sessions[si];
      sess.planSessionId = nextId(sess.planSessionId, 'planSessionLocal');

      var exercises = Array.isArray(sess.exercises) ? sess.exercises : [];
      for (var ei = 0; ei < exercises.length; ei++) {
        var ex = exercises[ei];
        ex.planAssignmentId = nextId(ex.planAssignmentId, 'planAssignmentSubject');
        ex.planOpportunityId = nextId(ex.planOpportunityId, 'planScheduleOpportunitySubject');
        ex.planPrescriptionId = nextId(ex.planPrescriptionId, 'planPrescriptionSubject');
        ex.planRelationshipId = nextId(ex.planRelationshipId, 'planImplementationRelationshipSubject');

        var sets = Array.isArray(ex.sets) ? ex.sets : [];
        for (var seti = 0; seti < sets.length; seti++) {
          var s = sets[seti];
          s.planSetId = nextId(s.planSetId, 'planSetSubject');
        }

        if (ex.progression && typeof ex.progression === 'object') {
          ex.progression.planRuleId = nextId(ex.progression.planRuleId, 'planRuleSubject');
        }
      }
    }
  }

  if (duplicate) {
    out._planDuplicationLineage = {
      duplicatedFromTemplateId: options.duplicatedFromTemplateId || null,
      subjectLineage: lineage
    };
  } else {
    // Never carry a stale lineage marker forward on ordinary edits.
    delete out._planDuplicationLineage;
  }

  return out;
}

// ---- 04-normalize.js ----
// planNormalizeCanonicalGraph(draft)
//
// Produces a side-effect-free, deterministic semantic graph from a draft
// that already has stable identities (see planEnsureDraftIdentities).
// The result is a flat collection of typed subject nodes, each carrying:
//   - subjectId, recordType
//   - semanticPayload: a plain object containing ONLY the fields the spec
//     (Draft 0.1 §7, §8) declares as semantic for that record type's OWN
//     local content, plus an explicit orderKey/sequenceKey field wherever
//     the draft's array position is training-meaningful (§4.7, §9: "UI
//     array order preserved only in explicit semantic order fields").
//     Exact dependency revision refs are NOT part of semanticPayload --
//     they cannot be, because revision IDs are only decided later, during
//     manifest construction, in dependency order (see 05-manifest.js).
//     They are carried instead via dependsOnSubjectIds below, and folded
//     into a separate dependencyHash by the manifest builder (spec §9's
//     Integrity field group: payloadHash and dependencyHash are distinct).
//     The complete written revision document (own payload + resolved
//     dependency refs + full envelope) is assembled later, in
//     06-commit-package.js.
//   - dependsOnSubjectIds: other subject IDs this record's meaning
//     references (used for manifest dependency refs, the dependencyHash
//     that gates revision reuse, and cycle checks). Ownership-by-templateId
//     is not included here; only genuine cross-subject references are.
//
// This function does not mutate its input, does not allocate any new
// identity, and does not touch revision IDs, manifests, hashes, or
// appDb -- that is the job of later commit-package/manifest stages.
//
// Design notes (documented interpretive choices -- see final report):
//
// 1. Microcycle/Session representation (corrects the prior slice's
//    Defect #11). Per spec §8's closing note, Microcycle and Session get
//    "a stable local identity inside the Template revision manifest" but
//    are not promoted to independently addressable subject/revision
//    collections in V1. This implementation allocates and retains their
//    stable local IDs (via planEnsureDraftIdentities, unchanged), but does
//    NOT create synthetic manifest-facing nodes/paths for them -- doing so
//    was the exact defect flagged in source review. Instead, each
//    Microcycle's and Session's identity + name + orderKey is embedded
//    directly as plain data inside every planScheduleOpportunityRevision
//    that belongs to it, per spec §8's literal requirement ("microcycle
//    subject/revision ref; session subject/revision ref when modeled").
//    Trade-off, accepted deliberately per the review's explicit
//    correction: when two schedule opportunities share one Microcycle or
//    Session, a change to that Microcycle/Session's own name changes the
//    semanticPayload -- and therefore forces a new revision -- of every
//    schedule opportunity that embeds it, even though nothing about that
//    opportunity's own scheduling meaning changed. This redundancy is the
//    explicit price of "no invented pseudo-document paths in the
//    manifest," and is called out again in the final report.
//
// 2. SetGroup is omitted entirely for V1 (spec §8: "Omitted entirely when
//    grouping is display-only") because the current editor has no
//    superset/grouping concept beyond a simple ordered Set list.
//
// 3. Several spec §8 payload fields describe configurability the current
//    editor does not yet collect (e.g. Assignment's resolver/flexibility
//    semantics, Rule's authority/scope/Track semantics, Relationship's
//    resolver/acceptance-policy semantics). Rather than leaving the field
//    silently absent (which would misrepresent "no value given" as "no
//    concept exists") or fabricating per-instance data the editor never
//    collected, each such field is set to an explicit, documented V1
//    constant describing the single mode the current editor actually
//    supports. Every constant is commented at its definition. This
//    mirrors the already-reviewed `eligibilityMode: 'fixedExercise'`
//    field from the prior slice.
//
// 4. Template's dependsOnSubjectIds now names every planScheduleOpportunitySubject
//    in the draft (sorted). This is what makes the Template revision bind
//    its exact committed graph (Defect #12): any semantic change anywhere
//    in the graph changes some schedule opportunity's dependencyHash chain
//    (Set -> Prescription -> Assignment -> ScheduleOpportunity), which
//    changes the ordered {subjectId, revisionId} list Template's own
//    dependencyHash is computed from in 05-manifest.js, which forces a new
//    Template revision -- while any schedule opportunity NOT on that chain
//    keeps its own prior revision id unchanged and reusable.

function PlanCanonicalNormalizationError(message, details) {
  this.name = 'PlanCanonicalNormalizationError';
  this.message = message;
  this.details = details || {};
}
PlanCanonicalNormalizationError.prototype = Object.create(Error.prototype);
PlanCanonicalNormalizationError.prototype.constructor = PlanCanonicalNormalizationError;

var PLAN_SET_NUMERIC_FIELDS = [
  'weight', 'addedWeight', 'percent',
  'reps', 'minReps', 'maxReps',
  'rir', 'minRir', 'maxRir',
  'seconds', 'minSeconds', 'maxSeconds'
];
var PLAN_SET_STRING_FIELDS = ['loadType', 'repsType', 'effortType', 'timeType', 'notes'];

function planNormalizeAbsent(value) {
  // Normalize legacy "empty" representations (undefined, '', null used
  // inconsistently by the editor) down to a single canonical absent
  // representation: the key is simply omitted. Returns undefined to
  // signal omission; callers must drop undefined-valued keys.
  if (value === undefined || value === null || value === '') return undefined;
  return value;
}

function planNormalizeNumberField(value, fieldPath) {
  // Corrects the prior slice's Defect #5: a present-but-invalid numeric
  // intent (a non-finite number, or a string that does not parse to a
  // finite number) must be rejected, not silently converted to absence --
  // silently dropping it would misrepresent "the user entered something
  // invalid" as "the user entered nothing." Genuine absence (undefined,
  // null, '') is still legitimate omission, and -0 is still normalized to
  // 0.
  var v = planNormalizeAbsent(value);
  if (v === undefined) return undefined;
  var n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) {
    throw new PlanCanonicalNormalizationError(
      'planNormalizeNumberField: invalid numeric intent' + (fieldPath ? ' at ' + fieldPath : ''),
      { fieldPath: fieldPath, value: value }
    );
  }
  return n === 0 ? 0 : n; // normalizes -0
}

function planStripUndefined(obj) {
  var out = {};
  var keys = Object.keys(obj);
  for (var i = 0; i < keys.length; i++) {
    if (obj[keys[i]] !== undefined) out[keys[i]] = obj[keys[i]];
  }
  return out;
}

function planNormalizeSetPayload(set, prescriptionId, orderKey, fieldPathPrefix) {
  var payload = { prescriptionId: prescriptionId, setId: set.planSetId, orderKey: orderKey };
  for (var i = 0; i < PLAN_SET_NUMERIC_FIELDS.length; i++) {
    var f = PLAN_SET_NUMERIC_FIELDS[i];
    var nv = planNormalizeNumberField(set[f], fieldPathPrefix + '.' + f);
    if (nv !== undefined) payload[f] = nv;
  }
  for (var j = 0; j < PLAN_SET_STRING_FIELDS.length; j++) {
    var sf = PLAN_SET_STRING_FIELDS[j];
    var sv = planNormalizeAbsent(set[sf]);
    if (sv !== undefined) payload[sf] = sv;
  }
  return payload;
}

function planNormalizeCanonicalGraph(draft) {
  if (!draft || typeof draft !== 'object') {
    throw new Error('planNormalizeCanonicalGraph: draft must be an object');
  }
  if (!draft.planTemplateId) {
    throw new Error('planNormalizeCanonicalGraph: draft is missing stable identities; call planEnsureDraftIdentities first');
  }

  var templateId = draft.planTemplateId;
  var nodes = [];
  var opportunityIdsForTemplate = [];

  function addNode(subjectId, recordType, semanticPayload, dependsOnSubjectIds) {
    nodes.push({
      subjectId: subjectId,
      recordType: recordType,
      semanticPayload: planStripUndefined(semanticPayload),
      dependsOnSubjectIds: (dependsOnSubjectIds || []).slice().sort()
    });
  }

  var microcycles = Array.isArray(draft.microcycles) ? draft.microcycles : [];
  for (var mi = 0; mi < microcycles.length; mi++) {
    var mc = microcycles[mi];
    if (!mc.planMicrocycleId) throw new Error('planNormalizeCanonicalGraph: microcycle missing planMicrocycleId at index ' + mi);

    var sessions = Array.isArray(mc.sessions) ? mc.sessions : [];
    for (var si = 0; si < sessions.length; si++) {
      var sess = sessions[si];
      if (!sess.planSessionId) throw new Error('planNormalizeCanonicalGraph: session missing planSessionId at microcycle ' + mi + ' index ' + si);

      var exercises = Array.isArray(sess.exercises) ? sess.exercises : [];
      for (var ei = 0; ei < exercises.length; ei++) {
        var ex = exercises[ei];
        if (!ex.planAssignmentId || !ex.planOpportunityId || !ex.planPrescriptionId || !ex.planRelationshipId) {
          throw new Error('planNormalizeCanonicalGraph: exercise entry missing one or more identities at microcycle ' + mi + ' session ' + si + ' index ' + ei);
        }
        var fieldPathBase = 'microcycles[' + mi + '].sessions[' + si + '].exercises[' + ei + ']';

        // A Rule subject is only materialized in the canonical graph when
        // progression is actually enabled (spec §8's "omitted entirely
        // when [...] display-only" logic extended, by the same reasoning,
        // to a progression rule that is not currently in effect). The
        // identity step still reserves progression.planRuleId unconditionally
        // so that toggling progression on/off never reassigns its identity.
        var ruleActive = !!(ex.progression && ex.progression.enabled && ex.progression.planRuleId);
        var ruleId = ruleActive ? ex.progression.planRuleId : undefined;

        addNode(ex.planAssignmentId, 'planAssignmentSubject', {
          templateId: templateId,
          assignmentId: ex.planAssignmentId,
          instructions: planNormalizeAbsent(ex.notes),
          // V1 constants (see design note 3 above): the current editor
          // supports exactly one assignment mode -- a fixed exercise,
          // scoped to this Template, ordered by its schedule opportunity,
          // with no resolver and no flexible binding.
          assignmentIntent: 'standard',
          constraintScope: 'template',
          resolverPolicy: 'none',
          timingSemantics: 'scheduleOpportunityOrder',
          flexibility: 'fixedExercise'
        }, [ex.planPrescriptionId, ex.planRelationshipId].concat(ruleId ? [ruleId] : []));

        opportunityIdsForTemplate.push(ex.planOpportunityId);
        addNode(ex.planOpportunityId, 'planScheduleOpportunitySubject', {
          templateId: templateId,
          opportunityId: ex.planOpportunityId,
          // Microcycle/Session are embedded here rather than modeled as
          // independent manifest nodes -- see design note 1 above.
          microcycle: planStripUndefined({
            microcycleId: mc.planMicrocycleId,
            name: planNormalizeAbsent(mc.name),
            orderKey: mi
          }),
          session: planStripUndefined({
            sessionId: sess.planSessionId,
            name: planNormalizeAbsent(sess.name),
            notes: planNormalizeAbsent(sess.notes),
            orderKey: si
          }),
          orderKey: ei,
          // V1 constant: the Template's Microcycle sequence itself is the
          // only recurrence concept the current editor models; there is no
          // independent recurrence/enactment-boundary configuration per
          // opportunity yet.
          recurrence: 'templateMicrocycleSequence'
          // "notes that govern execution" (spec §8) is intentionally left
          // absent: the current editor collects one notes/instructions
          // field per exercise entry, modeled above as
          // planAssignmentSubject.instructions (general performance
          // guidance). There is no distinct schedule-specific execution
          // note in the editor yet.
        }, [ex.planAssignmentId]);

        var sets = Array.isArray(ex.sets) ? ex.sets : [];
        var setIds = [];
        for (var seti = 0; seti < sets.length; seti++) {
          var s = sets[seti];
          if (!s.planSetId) throw new Error('planNormalizeCanonicalGraph: set missing planSetId at exercise ' + ei);
          setIds.push(s.planSetId);
          // Sets carry prescriptionId as a payload back-reference (parentage)
          // only, not as a dependency edge: a Set's own meaning does not
          // require the Prescription's revision to exist first. The
          // Prescription depends on its Sets (below), not the reverse --
          // otherwise Prescription<->Set would form a 2-node dependency
          // cycle, which §4/§9 explicitly forbid.
          addNode(s.planSetId, 'planSetSubject',
            planNormalizeSetPayload(s, ex.planPrescriptionId, seti, fieldPathBase + '.sets[' + seti + ']'),
            []);
        }
        setIds.sort();

        addNode(ex.planPrescriptionId, 'planPrescriptionSubject', {
          templateId: templateId,
          assignmentId: ex.planAssignmentId,
          prescriptionId: ex.planPrescriptionId,
          // V1 constants: the current editor keeps all load/reps/effort/
          // time/notes values at the Set level (see planSetSubject
          // payloads above); there is no separate prescription-level
          // default and no cross-session unresolved-value resolution
          // method (e.g. an automatic %1RM lookup) implemented yet.
          componentApplicability: 'perSet',
          unresolvedResolutionMethod: 'none'
        }, setIds);

        // Relationship carries assignmentId as a back-reference only, for
        // the same cycle-avoidance reason as Set above: Assignment is the
        // one that depends on Relationship (its revision embeds the exact
        // relationship revision ref), not the other way around.
        addNode(ex.planRelationshipId, 'planImplementationRelationshipSubject', {
          templateId: templateId,
          assignmentId: ex.planAssignmentId,
          relationshipId: ex.planRelationshipId,
          exerciseId: planNormalizeAbsent(ex.exerciseId),
          eligibilityMode: 'fixedExercise',
          // V1 constants (design note 3): the current library has no
          // Exercise revisioning, no flexible-source selection, and no
          // approval workflow, so these fields describe the single V1
          // behavior rather than per-instance configuration.
          sourceRevisionSemantics: 'exerciseIdentityOnly',
          constraints: 'none',
          resolver: 'none',
          resolutionTiming: 'atAssignmentCreation',
          permittedBindingScope: 'singleAssignment',
          acceptancePolicy: 'automatic',
          lifecycleInterval: 'ongoing'
        }, []);

        if (ruleActive) {
          var prog = ex.progression;
          addNode(prog.planRuleId, 'planRuleSubject', {
            templateId: templateId,
            assignmentId: ex.planAssignmentId,
            ruleId: prog.planRuleId,
            enabled: !!prog.enabled,
            evaluationType: planNormalizeAbsent(prog.evaluationType),
            gatewaySetIndex: planNormalizeNumberField(prog.gatewaySetIndex, fieldPathBase + '.progression.gatewaySetIndex'),
            adjustmentType: planNormalizeAbsent(prog.adjustmentType),
            loadIncrease: planNormalizeNumberField(prog.loadIncrease, fieldPathBase + '.progression.loadIncrease'),
            tmIncrease: planNormalizeNumberField(prog.tmIncrease, fieldPathBase + '.progression.tmIncrease'),
            failBehavior: planNormalizeAbsent(prog.failBehavior),
            // V1 constants (design note 3): all V1 Rules are
            // Assignment-scoped, author-authored, apply for the ongoing
            // life of the Assignment, and have no Track-gating.
            authority: 'templateAuthor',
            scope: 'assignment',
            effectiveBoundary: 'ongoing',
            requiredTracks: [],
            inputContract: 'gatewaySetOutcome',
            outputContract: 'nextAssignmentAdjustment'
          }, []); // Rule carries assignmentId as a back-reference only; Assignment depends on Rule, not vice versa.
        }
      }
    }
  }

  addNode(templateId, 'planTemplateSubject', {
    templateId: templateId,
    name: planNormalizeAbsent(draft.name),
    description: planNormalizeAbsent(draft.description),
    structureLabel: planNormalizeAbsent(draft.structureLabel),
    notes: planNormalizeAbsent(draft.notes)
  }, opportunityIdsForTemplate); // binds the Template revision to the exact committed graph -- design note 4 above.

  // Duplicate subjectId detection: two distinct nodes must never share a
  // subjectId. This should be structurally impossible given a correct
  // allocator, but the normalizer must catch it defensively rather than
  // silently overwrite one record with another.
  var seen = Object.create(null);
  for (var n = 0; n < nodes.length; n++) {
    var sid = nodes[n].subjectId;
    if (seen[sid]) {
      throw new Error('planNormalizeCanonicalGraph: duplicate canonical subject id detected: ' + sid);
    }
    seen[sid] = true;
  }

  // Deterministic manifest-facing order: by recordType then subjectId.
  // (This is the order manifest entries are ultimately sorted into; it is
  // intentionally independent of draft/array order, per spec §9. The
  // separate dependency-respecting RESOLUTION order used to decide
  // revision reuse is computed later, in planBuildGraphManifest.)
  nodes.sort(function (a, b) {
    if (a.recordType !== b.recordType) return a.recordType < b.recordType ? -1 : 1;
    return a.subjectId < b.subjectId ? -1 : (a.subjectId > b.subjectId ? 1 : 0);
  });

  var plainNodes = nodes.map(function (node) {
    return {
      subjectId: node.subjectId,
      recordType: node.recordType,
      semanticPayload: node.semanticPayload,
      dependsOnSubjectIds: node.dependsOnSubjectIds
    };
  });

  // Round-4 source review Defect #2: the previous Object.freeze calls here
  // were shallow, so a nested structure inside a node's semanticPayload
  // (e.g. planScheduleOpportunitySubject's embedded microcycle/session
  // objects) was still mutable after "normalization." planDeepFreeze
  // recursively freezes the ENTIRE returned graph -- every node, every
  // semanticPayload, and every nested object or array inside it -- so the
  // public result of this function is genuinely immutable at every depth,
  // not just at its top level.
  return planDeepFreeze({
    templateId: templateId,
    nodes: plainNodes
  });
}

// ---- 05-manifest.js ----
// planBuildGraphManifest(graph, ids)
//
// Turns a normalized canonical graph (from planNormalizeCanonicalGraph)
// into an exact, bounded, immutable graph manifest: for every subject node,
// resolves dependencies in deterministic dependency order (leaves first:
// Rule, ImplementationRelationship, Set, SetGroup, then Prescription, then
// Assignment, then ScheduleOpportunity, then Template -- spec §9/Defect #2),
// decides whether it needs a brand-new revision or may reuse an exact prior
// revision, computes BOTH a payload hash (own local content only) and a
// dependency hash (exact resolved dependency revision refs), assigns
// deterministic document paths via the single authoritative collection
// table (00-collections.js), chunks the ordered entry list into bounded
// pieces (max 100 entries / 256 KiB measured against the COMPLETE encoded
// chunk document, not summed entry sizes), and computes chunk hashes and
// one graph hash (§9).
//
// This function never accesses appDb or Firestore. It is pure: given the
// same graph and ids input, it always returns the same manifest.
//
// Corrects the prior slice's Defect #2 (dependency changes did not create
// successor ancestor revisions) and Defect #14 (chunk-size accounting
// summed entry sizes instead of measuring the complete encoded chunk
// document).
//
// ids: {
//   manifestId:        string, required. Pre-minted by the caller (the
//                       commit-package builder) because chunk IDs derive
//                       deterministically from it.
//   ownerUid:           string, required. Used only to build document
//                       paths recorded in manifest entries via the
//                       authoritative collection table; no Firestore
//                       access occurs.
//   allocateRevisionId: () => string, required. Injected allocator for new
//                       revision IDs (kept separate from the draft-identity
//                       allocator so tests can control each independently).
//   priorRevisionsBySubjectId: optional map, { [subjectId]: { revisionId,
//                       payloadHash, dependencyHash } }, describing the
//                       exact prior committed revision (both hashes) for
//                       subjects that already have one. Supplied by the
//                       caller from the read plan / basis (never from
//                       appDb inside this function). A revision is reused
//                       only when BOTH hashes match -- an unchanged own
//                       payload whose dependency revision refs changed
//                       still requires a new revision.
// }
//
// Result shape (typed, never throws for the expected "graph too large"
// case -- see §12, "oversized graph must block ... Do not partially plan or
// silently truncate it"):
//   { ok: true, manifest, chunks, entries, revisionsBySubjectId }
//   { ok: false, blockReason: 'graphRequiresPreparedCommit', details }
//
// `entries` (the top-level result field, distinct from each chunk's own
// `entries`) carries the COMPLETE resolved record for every node --
// including its semanticPayload and dependencyHash -- so that
// 06-commit-package.js can assemble full revision documents. The slimmer
// per-chunk entries stored in `chunks[].entries` (and hashed into
// chunkHash) intentionally carry only what spec §9 names for a manifest
// entry: recordType, recordId, subjectId, revisionId, path, payloadHash,
// and dependencyRefs -- never the semantic payload itself.

var PLAN_REVISIONED_RECORD_TYPES = {
  planTemplateSubject: true,
  planAssignmentSubject: true,
  planScheduleOpportunitySubject: true,
  planPrescriptionSubject: true,
  planSetSubject: true,
  planRuleSubject: true,
  planImplementationRelationshipSubject: true
};

// Deterministic dependency-resolution priority (spec §9/Defect #2: "Rule ->
// ImplementationRelationship -> Set -> SetGroup -> Prescription ->
// Assignment -> ScheduleOpportunity -> Template"). Used only to break ties
// deterministically among nodes whose dependencies are simultaneously
// satisfied during topological resolution; the real edges (dependsOnSubjectIds)
// are what actually enforce dependency-first ordering.
var PLAN_RESOLUTION_RECORD_TYPE_PRIORITY = {
  planRuleSubject: 0,
  planImplementationRelationshipSubject: 1,
  planSetSubject: 2,
  planSetGroupSubject: 3,
  planPrescriptionSubject: 4,
  planAssignmentSubject: 5,
  planScheduleOpportunitySubject: 6,
  planTemplateSubject: 7
};

var PLAN_MANIFEST_MAX_ENTRIES_PER_CHUNK = 100;
var PLAN_MANIFEST_MAX_CHUNK_BYTES = 256 * 1024;
var PLAN_HASH_PLACEHOLDER = new Array(65).join('0'); // 64 '0' chars: exact length of a real sha256 hex digest

// ---- Canonical write-set hash (spec Sec.13; round-12 review, option 3
// authorized; round-13 review: this function itself must implement BOTH
// authorized normalization rules, not just one of them, so a caller can
// pass the complete final candidate-write array -- including the gateway
// -- and get back the exact same value production stamped, with no
// caller-side filtering of any kind). Two normalization rules, both
// applied here and ONLY here:
//
// 1. The gateway document's own entry is excluded from the write set it
//    describes -- by definition (spec Sec.13), a commit's write-set hash
//    covers every candidate write of that commit EXCEPT the gateway's own
//    not-yet-existing entry at the moment the hash is computed. Round-12
//    only satisfied this by relying on production's own construction
//    order (the hash was computed before the gateway write existed to be
//    included) -- correct for THAT one call site, but silently unsound
//    for any other caller who passes the complete, final candidateWrites
//    array (which DOES include the gateway by the time a package is
//    fully built). Round-13 review caught this: the function itself now
//    filters out every planCommitGateway-kind entry before hashing,
//    regardless of whether the caller's input happens to include one.
//    Mutating a gateway write's own content therefore never changes the
//    result -- exactly matching the approved rule that the gateway is not
//    part of its own write-set hash.
//
// 2. The Template subject pointer's own write carries a field
//    (headWriteSetHash, round-12) whose value IS (derived from) the
//    write-set hash: a genuine circular dependency, not a fixable
//    oversight (the same kind of self-reference PLAN_HASH_PLACEHOLDER
//    already exists to neutralize for a chunk document's own chunkHash
//    field, during historical chunk-hash recomputation -- see
//    planBuildManifestChunkDocumentData's call sites). Resolved with one
//    fixed, deterministic rule: when computing the write-set hash, the
//    Template-subject write's headWriteSetHash field is ALWAYS normalized
//    to the canonical placeholder first, regardless of whatever value
//    that field actually holds in the input -- the placeholder is exactly
//    64 ASCII characters, the same length as a real sha256 hex digest, so
//    this never changes document/request size accounting.
//
// Every OTHER field, of every OTHER (non-gateway) candidate write, is
// hashed exactly as it stands; no other field and no other write kind is
// ever normalized, excluded, or omitted.
//
// This is the SOLE implementation of this algorithm -- both rules live
// here, together, and nowhere else. Every call site -- real package
// construction (below), and any future recomputation or test
// verification -- must call this same function on whatever candidateWrites
// array it has (complete-with-gateway, or already-filtered -- both
// produce an identical result, since filtering an array that has no
// gateway entries to begin with is a no-op); the algorithm must never be
// reimplemented, or partially reimplemented via caller-side filtering, at
// a second call site. It never mutates its input: filtering produces a
// new array reference, and each entry's data is independently re-encoded
// into a fresh object only when normalization is needed (the
// Template-subject entry), so candidateWrites and its members -- whether
// still-mutable (real construction, before Object.freeze) or already
// frozen (a caller re-verifying a previously-built set) -- are left
// untouched either way.
function planComputeCanonicalWriteSetHash(candidateWrites) {
  if (!Array.isArray(candidateWrites)) {
    throw new Error('planComputeCanonicalWriteSetHash: candidateWrites array is required');
  }
  var nonGatewayWrites = candidateWrites.filter(function (w) { return w.kind !== 'planCommitGateway'; });
  var normalizedEntries = nonGatewayWrites.map(function (w) {
    var normalizedData = w.data;
    if (w.kind === 'planTemplateSubject') {
      normalizedData = Object.assign({}, w.data, { headWriteSetHash: PLAN_HASH_PLACEHOLDER });
    }
    return { path: w.path, kind: w.kind, contentHash: planSha256Hex(planBuildCanonicalEncoding(normalizedData)) };
  });
  normalizedEntries.sort(function (a, b) { return a.path < b.path ? -1 : (a.path > b.path ? 1 : 0); });
  return planSha256Hex(planBuildCanonicalEncoding(normalizedEntries));
}

// Round-4 source review Defect #6: the previous chunk byte-size accounting
// measured a REDUCED structure (manifestId/chunkId/ordinal/entries/
// entryCount/chunkHash) that omitted fields the actual candidate write in
// 06-commit-package.js also carries (recordType, schemaVersion,
// operationId, gatewayId, committedAt, ownerUid) -- an independent probe
// produced a package whose real write was 282,184 bytes against the
// approved 262,144-byte limit. This ONE function is now the single
// authoritative builder for the exact final planGraphManifestChunk
// document shape, called both here (for byte-size accounting and for
// computing chunkHash) and from 06-commit-package.js (for the actual
// write), so the two can never independently drift apart again.
// Round-6 Defect #7: envelopeCtx carries the authority/provenance/encoding/
// lifecycle fields this document type was previously missing entirely
// (actorUid, authorityKind, authorityScope, authorityBasisRefs,
// clientSchemaGeneration, clientCreatedAt -- the same envelope content
// planBuildSystemEnvelope already gives every OTHER system document). It
// is a required parameter, not an optional add-on, specifically so that
// byte-size accounting (chunkDocBytes/flushChunk in planBuildGraphManifest,
// below) and the real candidate write (planBuildTemplateCommitPackage)
// can never again build two different document shapes -- exactly the
// single-source-of-truth guarantee round-4 Defect #6 established, which
// silently omitting new fields from only one caller would break again.
function planBuildManifestChunkDocumentData(manifestId, chunkId, chunkOrdinal, entries, entryCount, chunkHash, operationId, gatewayId, ownerUid, envelopeCtx) {
  return {
    // Round-7 review Defect #6: recordId (Identity), sourceRefs
    // (Provenance), and effectiveBoundary (Time) were previously omitted
    // -- every other candidate document type carries them.
    recordId: chunkId,
    recordType: 'planGraphManifestChunk',
    schemaVersion: PLAN_SCHEMA_VERSION,
    ownerDomain: 'plan',
    ownerUid: ownerUid,
    manifestId: manifestId,
    chunkId: chunkId,
    chunkOrdinal: chunkOrdinal,
    entries: entries,
    entryCount: entryCount,
    chunkHash: chunkHash,
    operationId: operationId,
    gatewayId: gatewayId,
    actorUid: envelopeCtx.actorUid,
    authorityKind: envelopeCtx.authorityKind,
    authorityScope: envelopeCtx.authorityScope,
    authorityBasisRefs: envelopeCtx.authorityBasisRefs,
    clientSchemaGeneration: envelopeCtx.clientSchemaGeneration,
    sourceKind: 'planEditorCommit',
    sourceRefs: [],
    canonicalEncodingVersion: PLAN_CANONICAL_ENCODING_VERSION,
    commitState: 'committed',
    lifecycleState: 'active',
    effectiveBoundary: 'immediate',
    clientCreatedAt: envelopeCtx.clientCreatedAt,
    committedAt: PLAN_SERVER_TIMESTAMP_SENTINEL
  };
}

function planUtf8ByteLength(str) {
  var bytes = 0;
  for (var i = 0; i < str.length; i++) {
    var code = str.codePointAt(i);
    if (code > 0xFFFF) i++;
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code < 0x10000) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

function planZeroPad(n, width) {
  var s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

function planResolutionSortComparator(byId) {
  return function (aId, bId) {
    var a = byId[aId], b = byId[bId];
    var pa = PLAN_RESOLUTION_RECORD_TYPE_PRIORITY[a.recordType];
    var pb = PLAN_RESOLUTION_RECORD_TYPE_PRIORITY[b.recordType];
    if (pa === undefined) pa = 99;
    if (pb === undefined) pb = 99;
    if (pa !== pb) return pa - pb;
    return aId < bId ? -1 : (aId > bId ? 1 : 0);
  };
}

// The public contract is the 2-argument planBuildGraphManifest(graph, ids)
// from spec §19. The optional 3rd argument lets tests substitute the hash
// or encoding primitives (e.g. to prove hash-mismatch handling); ordinary
// callers never pass it and get the real planSha256Hex / canonical
// encoding used everywhere else in this file.
function planBuildGraphManifest(graph, ids, deps) {
  var sha256 = (deps && deps.sha256Hex) || planSha256Hex;
  var encode = (deps && deps.buildCanonicalEncoding) || planBuildCanonicalEncoding;
  if (typeof sha256 !== 'function' || typeof encode !== 'function') {
    throw new Error('planBuildGraphManifest: no sha256/canonical-encoding implementation available');
  }
  if (!graph || !Array.isArray(graph.nodes)) {
    throw new Error('planBuildGraphManifest: graph must be a normalized canonical graph');
  }
  if (!ids || !ids.manifestId || !ids.ownerUid || !ids.operationId || !ids.gatewayId || typeof ids.allocateRevisionId !== 'function') {
    throw new Error('planBuildGraphManifest: ids.manifestId, ids.ownerUid, ids.operationId, ids.gatewayId, and ids.allocateRevisionId are required');
  }
  // Round-6 Defect #7: chunk documents now carry a complete envelope (see
  // planBuildManifestChunkDocumentData above) -- these inputs are required,
  // not optional, so this function's own byte-size accounting can never
  // again diverge from the real candidate write's actual shape/size.
  if (!ids.authorityKind || !ids.clientSchemaGeneration && ids.clientSchemaGeneration !== 0 || ids.clientCreatedAt === undefined || ids.clientCreatedAt === null) {
    throw new Error('planBuildGraphManifest: ids.authorityKind, ids.clientSchemaGeneration, and ids.clientCreatedAt are required (needed for complete chunk envelopes, round-6 Defect #7)');
  }
  var chunkEnvelopeCtx = {
    actorUid: ids.actorUid || null,
    authorityKind: ids.authorityKind,
    authorityScope: ids.authorityScope !== undefined ? ids.authorityScope : null,
    authorityBasisRefs: ids.authorityBasisRefs || [],
    clientSchemaGeneration: ids.clientSchemaGeneration,
    clientCreatedAt: ids.clientCreatedAt
  };

  var priorBySubject = (ids.priorRevisionsBySubjectId && typeof ids.priorRevisionsBySubjectId === 'object')
    ? ids.priorRevisionsBySubjectId
    : {};

  var byId = {};
  for (var bi = 0; bi < graph.nodes.length; bi++) {
    var bn = graph.nodes[bi];
    if (!PLAN_REVISIONED_RECORD_TYPES[bn.recordType]) {
      throw new Error('planBuildGraphManifest: unsupported canonical record type: ' + bn.recordType);
    }
    if (byId[bn.subjectId]) {
      throw new Error('planBuildGraphManifest: duplicate canonical subject id detected: ' + bn.subjectId);
    }
    byId[bn.subjectId] = bn;
  }

  // ---- Step 1: deterministic topological (dependency-first) resolution
  // order via Kahn's algorithm, so that every node is processed only after
  // every subject it depends on has already been resolved (spec §9/§4:
  // "keep graph acyclic"; Defect #2: "resolve in deterministic dependency
  // order").
  var remainingDeps = {};
  var dependents = {};
  for (var di = 0; di < graph.nodes.length; di++) {
    var dn = graph.nodes[di];
    remainingDeps[dn.subjectId] = dn.dependsOnSubjectIds.length;
    for (var dj = 0; dj < dn.dependsOnSubjectIds.length; dj++) {
      var depId = dn.dependsOnSubjectIds[dj];
      if (!byId[depId]) {
        throw new Error('planBuildGraphManifest: broken dependency reference; subject ' + dn.subjectId + ' depends on missing subject ' + depId);
      }
      if (!dependents[depId]) dependents[depId] = [];
      dependents[depId].push(dn.subjectId);
    }
  }

  var comparator = planResolutionSortComparator(byId);
  var ready = [];
  for (var ri = 0; ri < graph.nodes.length; ri++) {
    if (remainingDeps[graph.nodes[ri].subjectId] === 0) ready.push(graph.nodes[ri].subjectId);
  }
  ready.sort(comparator);

  var resolutionOrder = [];
  while (ready.length > 0) {
    var nextId = ready.shift();
    resolutionOrder.push(nextId);
    var affected = dependents[nextId] || [];
    var newlyReady = [];
    for (var ai = 0; ai < affected.length; ai++) {
      remainingDeps[affected[ai]] -= 1;
      if (remainingDeps[affected[ai]] === 0) newlyReady.push(affected[ai]);
    }
    if (newlyReady.length > 0) {
      ready = ready.concat(newlyReady);
      ready.sort(comparator);
    }
  }

  if (resolutionOrder.length !== graph.nodes.length) {
    throw new Error('planBuildGraphManifest: canonical dependency graph is not acyclic (cycle detected)');
  }

  // ---- Step 2: resolve every node in that order -- payload hash,
  // resolved dependency refs, dependency hash, and a reuse-vs-new-revision
  // decision that requires BOTH hashes to match the prior revision.
  var resolvedBySubject = {};
  var revisionsBySubjectId = {};
  var usedRevisionPaths = {}; // Defect #3: cross-entry duplicate write-path detection.

  for (var oi = 0; oi < resolutionOrder.length; oi++) {
    var subjectId = resolutionOrder[oi];
    var node = byId[subjectId];

    var payloadEncoding = encode(node.semanticPayload);
    var payloadHash = sha256(payloadEncoding);

    var dependencyRefs = [];
    for (var k = 0; k < node.dependsOnSubjectIds.length; k++) {
      var depSubjectId = node.dependsOnSubjectIds[k];
      var depResolved = resolvedBySubject[depSubjectId];
      if (!depResolved) {
        // Cannot happen given a correct topological order above; defensive.
        throw new Error('planBuildGraphManifest: internal error: dependency not yet resolved for ' + subjectId + ' -> ' + depSubjectId);
      }
      dependencyRefs.push({
        subjectId: depResolved.subjectId,
        recordType: depResolved.recordType,
        revisionId: depResolved.revisionId
      });
    }
    dependencyRefs.sort(function (a, b) { return a.subjectId < b.subjectId ? -1 : (a.subjectId > b.subjectId ? 1 : 0); });
    var dependencyHash = sha256(encode(dependencyRefs));

    var prior = priorBySubject[subjectId];
    var revisionId;
    var reused = false;
    if (prior && prior.payloadHash === payloadHash && prior.dependencyHash === dependencyHash) {
      revisionId = prior.revisionId;
      reused = true;
    } else {
      revisionId = ids.allocateRevisionId();
    }

    var path = planRevisionPath(ids.ownerUid, node.recordType, revisionId);
    var recordType = planRevisionRecordTypeForSubjectRecordType(node.recordType);

    // Round-4 source review Defect #3: an independent probe using an
    // allocator that returns the same revision id for two different
    // exercise occurrences produced 11 revision writes but only 6 unique
    // revision paths -- duplicate write targets that must never reach a
    // released package. Every resolved revision path must be unique
    // within this manifest build; any collision blocks HERE, before any
    // chunk/write plan is constructed, rather than relying on Firestore
    // or a later transaction adapter to discover it.
    if (usedRevisionPaths[path]) {
      return {
        ok: false,
        blockReason: 'duplicateRevisionIdentity',
        details: {
          path: path,
          recordType: recordType,
          revisionId: revisionId,
          subjectIds: [usedRevisionPaths[path], subjectId]
        }
      };
    }
    usedRevisionPaths[path] = subjectId;

    var resolved = {
      subjectId: subjectId,
      subjectRecordType: node.recordType,
      recordType: recordType,
      recordId: revisionId,
      revisionId: revisionId,
      path: path,
      payloadHash: payloadHash,
      dependencyHash: dependencyHash,
      dependencyRefs: dependencyRefs,
      semanticPayload: node.semanticPayload,
      reused: reused
    };
    resolvedBySubject[subjectId] = resolved;
    revisionsBySubjectId[subjectId] = { revisionId: revisionId, payloadHash: payloadHash, dependencyHash: dependencyHash, reused: reused };
  }

  // ---- Step 3: deterministic manifest order -- recordType then recordId
  // (spec §9). This is independent of resolution order above.
  var entries = [];
  for (var si = 0; si < graph.nodes.length; si++) {
    entries.push(resolvedBySubject[graph.nodes[si].subjectId]);
  }
  entries.sort(function (a, b) {
    if (a.recordType !== b.recordType) return a.recordType < b.recordType ? -1 : 1;
    return a.recordId < b.recordId ? -1 : (a.recordId > b.recordId ? 1 : 0);
  });

  // ---- Step 4: chunk into bounded pieces, measured against the COMPLETE
  // encoded chunk document (Defect #14), not summed entry sizes. Chunk
  // entries carry only what spec §9 names for a manifest entry -- never
  // the semantic payload.
  function toSlimEntry(e) {
    return {
      recordType: e.recordType,
      recordId: e.recordId,
      subjectId: e.subjectId,
      revisionId: e.revisionId,
      path: e.path,
      payloadHash: e.payloadHash,
      dependencyRefs: e.dependencyRefs
    };
  }

  // Both byte-size accounting (chunkDocBytes) and chunk-hash computation
  // (flushChunk) now build the SAME exact document shape via
  // planBuildManifestChunkDocumentData -- the one authoritative final
  // document representation the review's Defect #6 requires -- so
  // "how big will the real write be" and "what identifies this chunk's
  // content" can never again be answered from two different shapes.
  function chunkDocBytes(entriesList, ordinal) {
    var chunkId = ids.manifestId + '-' + planZeroPad(ordinal, 4);
    var doc = planBuildManifestChunkDocumentData(
      ids.manifestId, chunkId, ordinal, entriesList, entriesList.length,
      PLAN_HASH_PLACEHOLDER, ids.operationId, ids.gatewayId, ids.ownerUid, chunkEnvelopeCtx
    );
    return planUtf8ByteLength(encode(doc));
  }

  var chunks = [];
  var currentEntries = [];
  var chunkOrdinal = 0;

  function flushChunk() {
    if (currentEntries.length === 0) return;
    var chunkId = ids.manifestId + '-' + planZeroPad(chunkOrdinal, 4);
    var docForHash = planBuildManifestChunkDocumentData(
      ids.manifestId, chunkId, chunkOrdinal, currentEntries, currentEntries.length,
      PLAN_HASH_PLACEHOLDER, ids.operationId, ids.gatewayId, ids.ownerUid, chunkEnvelopeCtx
    );
    var chunkHash = sha256(encode(docForHash));
    chunks.push({
      chunkId: chunkId,
      manifestId: ids.manifestId,
      chunkOrdinal: chunkOrdinal,
      entries: currentEntries,
      entryCount: currentEntries.length,
      chunkHash: chunkHash,
      operationId: ids.operationId,
      gatewayId: ids.gatewayId
    });
    chunkOrdinal += 1;
    currentEntries = [];
  }

  for (var m = 0; m < entries.length; m++) {
    var slim = toSlimEntry(entries[m]);

    var aloneBytes = chunkDocBytes([slim], chunkOrdinal);
    if (aloneBytes > PLAN_MANIFEST_MAX_CHUNK_BYTES) {
      return {
        ok: false,
        blockReason: 'graphRequiresPreparedCommit',
        details: { reason: 'singleEntryExceedsChunkByteCap', subjectId: slim.subjectId, entryBytes: aloneBytes, cap: PLAN_MANIFEST_MAX_CHUNK_BYTES }
      };
    }

    var tentative = currentEntries.concat([slim]);
    var wouldExceedCount = tentative.length > PLAN_MANIFEST_MAX_ENTRIES_PER_CHUNK;
    var wouldExceedBytes = chunkDocBytes(tentative, chunkOrdinal) > PLAN_MANIFEST_MAX_CHUNK_BYTES;
    if (wouldExceedCount || wouldExceedBytes) {
      flushChunk();
    }
    currentEntries.push(slim);
  }
  flushChunk();

  var chunkIds = chunks.map(function (c) { return c.chunkId; });
  var chunkHashes = chunks.map(function (c) { return c.chunkHash; });
  var graphHash = sha256(encode({ manifestId: ids.manifestId, chunkHashes: chunkHashes }));

  var manifest = Object.freeze({
    manifestId: ids.manifestId,
    templateId: graph.templateId,
    recordCount: entries.length,
    chunkCount: chunks.length,
    chunkIds: Object.freeze(chunkIds.slice()),
    chunkHashes: Object.freeze(chunkHashes.slice()),
    graphHash: graphHash
  });

  // Round-4 source review Defect #2: the previous freezes here were
  // shallow -- individual entry objects, their nested dependencyRefs
  // arrays, and revisionsBySubjectId's value objects were all still
  // mutable. planDeepFreeze makes this function's ENTIRE standalone
  // result immutable at every depth, matching the same guarantee already
  // applied (correctly) to the final commitment package.
  return planDeepFreeze({
    ok: true,
    manifest: manifest,
    chunks: chunks.map(function (c) { return Object.assign({}, c, { entries: c.entries.slice() }); }),
    entries: entries.slice(),
    revisionsBySubjectId: revisionsBySubjectId
  });
}

// ---- 06-commit-package.js ----
// planBuildTemplateCommitPackage(draft, basis, ids)
//
// Freezes one complete, immutable local commitment package for a single
// Save Template attempt (§10). The package is built entirely from the
// draft (already carrying stable identities from planEnsureDraftIdentities)
// and from `basis` -- an explicit description of what the caller currently
// believes about existing canonical state (Template head, child subject
// heads, prior revisions, and prior Assignment membership for removal
// detection). This function never touches appDb, Firestore, or any global
// state; it is a pure computation from its three arguments.
//
// Corrects the prior slice's Defects #1, #3, #4 (via 09-deep-utils.js),
// #6, #7, #8 (read-plan side), #10, #12 (via the graph produced by
// 04-normalize.js + 05-manifest.js), #13, and #14 (via 05-manifest.js).
//
// basis = {
//   ownerUid: string, required.
//   actorUid: string, required.
//   clientSchemaGeneration: number|string, required.
//   authorityKind: string, optional (defaults 'owner').
//   authorityScope: string, optional (defaults null).
//   authorityBasisRefs: array, optional (defaults []).
//   clientCreatedAt: required (round-6 Defect #7). Caller-supplied (never
//     Date.now() inside this pure function). Spec §6's Time field group and
//     §10's Operation package component both name creation time as
//     unconditional envelope content, not an "only when applicable" field
//     -- the round-5 shape silently treated it as optional, which is the
//     kind of missing-because-the-caller-didn't-supply-it gap the spec
//     forbids. A caller that genuinely has no creation time to report is a
//     caller that needs fixing, not a reason to omit the field.
//   deviceId, sessionId: optional. Spec §10's Operation package component
//     also names "actor/device/session provenance" as required content,
//     but V1's editor has no device/session identity concept anywhere else
//     in this codebase to source real values from -- inventing placeholder
//     ids would be worse than an honest gap. Still accepted and carried
//     through verbatim when a caller supplies them; a later slice that
//     adds real device/session identity should make these required too.
//   templateSubject: null | {
//     templateId, lifecycleState, headRevisionId, headSequence,
//     headManifestId, headManifestHash
//   }.  null means "this is believed to be a brand-new Template; no
//   canonical Template subject is expected to exist yet."
//   priorRevisionsBySubjectId: { [subjectId]: { revisionId, payloadHash,
//     dependencyHash, semanticPayload, dependencyRefs } } -- exact prior
//     revision identity, both hashes, AND actual content for every child
//     subject the caller believes already exists. payloadHash/dependencyHash
//     are required by planBuildGraphManifest for correct two-hash reuse
//     decisions (Defect #2). semanticPayload/dependencyRefs (round-6 Defect
//     #3) are required whenever this subject could become a predecessor of
//     a new revision -- i.e. whenever its content might have changed --
//     so validate.js can recompute a predecessor's hashes from real read
//     content instead of trusting stored hash fields alone.
//   priorChildHeadsBySubjectId: { [subjectId]: { headRevisionId } }
//     -- optional; defaults to using priorRevisionsBySubjectId's revisionId
//     as the expected head when omitted (the common case where a child
//     subject's head always equals its only/most recent revision).
//   priorAssignmentSubjectIds: string[], optional, defaults []. The exact
//     set of planAssignmentSubject ids present in the prior committed
//     graph. Any id in this list absent from the CURRENT graph is a
//     removed Assignment and gets a prospective lifecycle-termination
//     write instead of a new revision (Defect #7). Scope is deliberately
//     limited to Assignment subjects -- see the final report's forced-
//     choices list; this is the only removable record type named by the
//     spec's acceptance test #7.
// }
//
// ids = {
//   operationId: string, required. Minted once by the caller and reused
//     verbatim on every retry of the same attempt (§4.3, §16).
//   manifestId: string, required. Same reuse requirement.
//   gatewayId: string, required. Same reuse requirement.
//   allocateRevisionId: () => string, required.
//   commitMode: string, optional, defaults 'standard'.
// }
//
// Returns either:
//   { ok: true, package: <deeply frozen package> }
//   { ok: false, blockReason: 'graphRequiresPreparedCommit', details }
//     (propagated unchanged from planBuildGraphManifest, or raised locally
//     for the same reason by the safety-cap checks; the draft and any
//     already-built package are never partially persisted -- §12.)

function planRequire(condition, message) {
  if (!condition) throw new Error('planBuildTemplateCommitPackage: ' + message);
}

var PLAN_V1_SAFETY_CAPS = {
  maxTransactionWrites: 350,
  maxEstimatedRequestBytes: 6 * 1024 * 1024,
  maxCanonicalDocumentBytes: 768 * 1024
};

// PLAN_SERVER_TIMESTAMP_SENTINEL, PLAN_CANONICAL_ENCODING_VERSION, and
// PLAN_SCHEMA_VERSION now live in 00-collections.js (the first-loaded
// module) as the single shared source of truth, specifically so this
// file's actual chunk-document writes and 05-manifest.js's chunk
// byte-size accounting can never drift apart again (round-4 source
// review Defect #6). They are used here as free variables resolved by
// concatenation, exactly like planSha256Hex, planRevisionPath, etc.
// already are throughout this codebase.

function planEstimateDocBytes(value) {
  return planUtf8ByteLength(planBuildCanonicalEncoding(value));
}

function planUniqueSorted(arr) {
  var seen = Object.create(null);
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    if (!seen[arr[i]]) { seen[arr[i]] = true; out.push(arr[i]); }
  }
  out.sort();
  return out;
}

// Extracts the exact typed dependency-ref fields spec §8 names by their
// literal field name (e.g. "exact prescriptionRevisionId") from the
// generic resolved dependencyRefs list produced by 05-manifest.js. Kept
// entirely separate from 00-collections.js's path table, since this is a
// semantic mapping (which revision-type plays which named role for a
// given subject type), not a path-derivation mapping -- Defect #3 is
// about paths, not this.
function planNamedDependencyFields(subjectRecordType, dependencyRefs) {
  function idsOfType(revisionRecordType) {
    var ids = [];
    for (var i = 0; i < dependencyRefs.length; i++) {
      if (dependencyRefs[i].recordType === revisionRecordType) ids.push(dependencyRefs[i].revisionId);
    }
    return planUniqueSorted(ids);
  }
  if (subjectRecordType === 'planAssignmentSubject') {
    var prescriptionIds = idsOfType('planPrescriptionRevision');
    var relationshipIds = idsOfType('planImplementationRelationshipRevision');
    return {
      prescriptionRevisionId: prescriptionIds.length ? prescriptionIds[0] : null,
      implementationRelationshipRevisionId: relationshipIds.length ? relationshipIds[0] : null,
      ruleRevisionIds: idsOfType('planRuleRevision')
    };
  }
  if (subjectRecordType === 'planScheduleOpportunitySubject') {
    var assignmentIds = idsOfType('planAssignmentRevision');
    return { assignmentRevisionId: assignmentIds.length ? assignmentIds[0] : null };
  }
  if (subjectRecordType === 'planPrescriptionSubject') {
    return { setRevisionIds: idsOfType('planSetRevision') };
  }
  if (subjectRecordType === 'planTemplateSubject') {
    return { scheduleOpportunityRevisionIds: idsOfType('planScheduleOpportunityRevision') };
  }
  return {};
}

// Builds the common canonical envelope fields (spec §6) shared by every
// revision document, before that type's own semantic payload and named
// dependency fields are spread on top.
function planBuildRevisionEnvelope(entry, ctx) {
  var prior = ctx.priorRevisionsBySubjectId[entry.subjectId];
  var env = {
    recordId: entry.revisionId,
    recordType: entry.recordType,
    schemaVersion: PLAN_SCHEMA_VERSION,
    ownerDomain: 'plan',
    ownerUid: ctx.ownerUid,
    subjectId: entry.subjectId,
    revisionId: entry.revisionId,

    actorUid: ctx.actorUid,
    authorityKind: ctx.authorityKind,
    authorityScope: ctx.authorityScope,
    authorityBasisRefs: ctx.authorityBasisRefs,
    clientSchemaGeneration: ctx.clientSchemaGeneration,

    createdByOperationId: ctx.operationId,
    sourceKind: 'planEditorCommit',
    sourceRefs: [],

    committedAt: PLAN_SERVER_TIMESTAMP_SENTINEL,
    effectiveBoundary: 'immediate',

    dependencyRefs: entry.dependencyRefs,

    // V1 never enables the prepared-commit protocol (§12); every revision
    // this slice's write plan can ever describe is written as part of one
    // atomic single-transaction commit, so commitState is always the
    // steady-state value below.
    commitState: 'committed',
    lifecycleState: 'active',
    gatewayId: ctx.gatewayId,

    canonicalEncodingVersion: PLAN_CANONICAL_ENCODING_VERSION,
    payloadHash: entry.payloadHash,
    dependencyHash: entry.dependencyHash
  };
  if (ctx.clientCreatedAt !== undefined) env.clientCreatedAt = ctx.clientCreatedAt;
  if (prior) env.predecessorRevisionId = prior.revisionId;
  // Round-4 source review Defect #5: carry canonical duplication lineage
  // (produced by planEnsureDraftIdentities, previously computed and then
  // silently discarded) into the one revision envelope field the spec's
  // Lineage field group actually names for it. duplicatedFromSubjectId is
  // set only on a brand-new revision whose SUBJECT is itself a
  // duplication target -- mutually exclusive in practice with
  // predecessorRevisionId, since a duplicated subject has no revision
  // history of its own identity yet.
  if (ctx.duplicationLineageBySubjectId && Object.prototype.hasOwnProperty.call(ctx.duplicationLineageBySubjectId, entry.subjectId)) {
    env.duplicatedFromSubjectId = ctx.duplicationLineageBySubjectId[entry.subjectId];
  }
  return env;
}

// Round-4 source review Defect #5: the complete applicable §6 envelope was
// previously applied almost exclusively to revision writes -- subject/head
// docs, the manifest doc, the operation, and the gateway used ad-hoc field
// sets missing most envelope groups. This is the shared builder for every
// NON-revision canonical document type (subject/head docs, the manifest
// doc, the projection); revision documents keep using
// planBuildRevisionEnvelope above, and the manifest CHUNK document shape
// is owned by 05-manifest.js's planBuildManifestChunkDocumentData instead
// (Defect #6 requires that shape to have exactly one source of truth for
// byte-size accounting). `isNew` controls whether createdByOperationId is
// stamped: for a subject/head doc that already existed before this
// attempt, this pure function has no read of the document's true original
// creator, so it deliberately omits createdByOperationId rather than
// overwrite real history with the current operation id on every edit.
function planBuildSystemEnvelope(recordType, recordId, ctx, isNew) {
  var env = {
    recordType: recordType,
    recordId: recordId,
    schemaVersion: PLAN_SCHEMA_VERSION,
    ownerDomain: 'plan',
    ownerUid: ctx.ownerUid,
    actorUid: ctx.actorUid,
    authorityKind: ctx.authorityKind,
    authorityScope: ctx.authorityScope,
    authorityBasisRefs: ctx.authorityBasisRefs,
    clientSchemaGeneration: ctx.clientSchemaGeneration,
    updatedByOperationId: ctx.operationId,
    gatewayId: ctx.gatewayId,
    sourceKind: 'planEditorCommit',
    // Round-7 review Defect #6: sourceRefs (Provenance), commitState
    // (Lifecycle -- V1 never enables the prepared-commit protocol, so this
    // is always the same steady-state value every other document type
    // already stamps -- see planBuildRevisionEnvelope), and effectiveBoundary
    // (Time) were previously omitted from every document built off this
    // shared system envelope (planAssignmentSubject, planTemplateSubject,
    // planTemplateSummary) even though sibling document types (revisions,
    // canonicalOperation, planCommitGateway, planGraphManifest/-Chunk) all
    // carry them.
    sourceRefs: [],
    commitState: 'committed',
    effectiveBoundary: 'immediate',
    canonicalEncodingVersion: PLAN_CANONICAL_ENCODING_VERSION,
    committedAt: PLAN_SERVER_TIMESTAMP_SENTINEL
  };
  if (isNew) env.createdByOperationId = ctx.operationId;
  if (ctx.clientCreatedAt !== undefined) env.clientCreatedAt = ctx.clientCreatedAt;
  return env;
}

// Round-7 review Defect #5: validates the RAW duplication-lineage list
// (draft._planDuplicationLineage.subjectLineage) as a whole graph before
// any of it is trusted to stamp duplicatedFromSubjectId on candidate
// writes. Pure and side-effect-free -- reads its arguments only, returns
// either { ok:true, bySubjectId } or the same { ok:false, blockReason,
// details } shape planBuildTemplateCommitPackage's other early blocks
// (manifestResult, duplicateTargetPath) already use, so callers handle it
// identically: `if (!result.ok) return result;`.
//
// graphSubjectIds: map of every subjectId present in THIS commit's graph
// (Template + every child), used to catch a lineage entry naming a
// subject not actually part of this commit at all.
// priorRevisions: basis.priorRevisionsBySubjectId, used to decide whether
// a named subject genuinely is new to this commit (a duplication target)
// or already existed (an ordinary edit, which must carry no lineage).
// templateIsNew: !basis.templateSubject, computed by the caller with the
// exact same formula used everywhere else in this file.
//
// Not every entry planEnsureDraftIdentities records names a canonical
// subject: Microcycle and Session get fresh local-scope identities on
// duplication too (recordType 'planMicrocycleLocal'/'planSessionLocal'),
// but per this file's own normalize-stage design (see the design notes
// above planNormalizeCanonicalGraph) they are deliberately NOT promoted
// to independently addressable subject/revision documents in V1 -- their
// identity is embedded as plain data inside the ScheduleOpportunity
// revisions that reference them. Such entries can never appear in
// graphSubjectIds and are never stamped onto any candidate write; they
// are recognized by their own recordType and passed through unchecked
// against the graph/newness/completeness rules below (which apply only
// to genuine canonical-subject duplication targets), while still being
// subject to the structural sanity checks (well-formed, no duplicate
// destination, source != destination) every entry must satisfy.
// Round-9 review Defect #2: round 7's planEnvelopeCompletenessReason only
// ever checked that historical/attempt-specific fields (actorUid,
// authorityKind, authorityBasisRefs, clientSchemaGeneration, the
// creating/updating operation id, sourceRefs, lineage) were PRESENT and
// correctly typed -- never that their VALUE actually matched what was
// true when the document was really created. An independent probe
// changed a reused revision's actorUid to a fabricated value and
// validation still returned 'proceed', because nothing anywhere held an
// independent record of what that document's actorUid was actually
// supposed to be. Round 7's own comment on planEnvelopeCompletenessReason
// named this exact gap and flagged it as a further extension, not made
// that round; this closes it. Every basis source that can feed an
// existing-document read (the Template subject, a prior child head, a
// reused or predecessor revision) must now also carry a frozen
// expectedEnvelope naming what that document's historical fields are
// independently known to be -- supplied by the caller (who read it from
// the real canonical store), never derived from the document being
// checked itself. planRequireExpectedEnvelope enforces its shape is
// complete at package-build time (a caller contract violation throws,
// exactly like the existing semanticPayload/dependencyRefs requirement
// above); planHistoricalEnvelopeMismatchReason (defined near
// planEnvelopeCompletenessReason, used by validate.js) is what actually
// compares a read document's fields against it.
function planRequireExpectedEnvelope(sourceLabel, env) {
  planRequire(env && typeof env === 'object',
    sourceLabel + '.expectedEnvelope is required (round-9 review Defect #2: historical envelope fields must be validated against an independent frozen expectation, not merely checked for presence)');
  planRequire(env.ownerUid, sourceLabel + '.expectedEnvelope.ownerUid is required');
  planRequire(env.actorUid, sourceLabel + '.expectedEnvelope.actorUid is required');
  planRequire(env.authorityKind, sourceLabel + '.expectedEnvelope.authorityKind is required');
  planRequire(Object.prototype.hasOwnProperty.call(env, 'authorityScope'), sourceLabel + '.expectedEnvelope.authorityScope is required (may legitimately be null, but must be explicitly present, not merely absent)');
  planRequire(Array.isArray(env.authorityBasisRefs), sourceLabel + '.expectedEnvelope.authorityBasisRefs is required');
  planRequire(env.clientSchemaGeneration !== undefined && env.clientSchemaGeneration !== null, sourceLabel + '.expectedEnvelope.clientSchemaGeneration is required');
  planRequire(env.provenanceOperationId, sourceLabel + '.expectedEnvelope.provenanceOperationId is required (the operation id the document\'s createdByOperationId/updatedByOperationId field is independently known to carry)');
  planRequire(env.sourceKind, sourceLabel + '.expectedEnvelope.sourceKind is required');
  planRequire(Array.isArray(env.sourceRefs), sourceLabel + '.expectedEnvelope.sourceRefs is required');
  planRequire(env.clientCreatedAt !== undefined && env.clientCreatedAt !== null, sourceLabel + '.expectedEnvelope.clientCreatedAt is required');
  planRequire(env.effectiveBoundary, sourceLabel + '.expectedEnvelope.effectiveBoundary is required');
  planRequire(env.commitState, sourceLabel + '.expectedEnvelope.commitState is required');
  planRequire(env.lifecycleState, sourceLabel + '.expectedEnvelope.lifecycleState is required');
  planRequire(env.canonicalEncodingVersion !== undefined && env.canonicalEncodingVersion !== null, sourceLabel + '.expectedEnvelope.canonicalEncodingVersion is required');
  return env;
}

var PLAN_LINEAGE_LOCAL_SCOPE_RECORD_TYPES = { planMicrocycleLocal: true, planSessionLocal: true };
function planValidateDuplicationLineage(rawLineageList, graphSubjectIds, templateId, priorRevisions, templateIsNew, expectedBySubjectId) {
  if (!Array.isArray(rawLineageList) || rawLineageList.length === 0) {
    return { ok: true, bySubjectId: {}, recordTypeBySubjectId: {} };
  }
  var seenDestinations = {};
  var bySubjectId = {};
  // Round-9 review Defect #5: the destination's canonical record type,
  // tracked alongside oldSubjectId (previously discarded once the shape
  // check passed) -- needed both to cross-check against
  // expectedBySubjectId's independently known sourceRecordType below, and
  // to plan the actual source-subject reads (planBuildTemplateCommitPackage
  // builds duplicationSourceRefs from this).
  var recordTypeBySubjectId = {};
  for (var i = 0; i < rawLineageList.length; i++) {
    var entry = rawLineageList[i];
    var newSubjectId = entry && entry.newSubjectId;
    var oldSubjectId = entry && entry.oldSubjectId;
    if (typeof newSubjectId !== 'string' || !newSubjectId || typeof oldSubjectId !== 'string' || !oldSubjectId) {
      return { ok: false, blockReason: 'duplicationLineageInvalid', details: { reason: 'lineageEntryMalformed', index: i, entry: entry } };
    }
    if (Object.prototype.hasOwnProperty.call(seenDestinations, newSubjectId)) {
      return { ok: false, blockReason: 'duplicationLineageInvalid', details: { reason: 'duplicateDestination', newSubjectId: newSubjectId } };
    }
    seenDestinations[newSubjectId] = true;
    if (oldSubjectId === newSubjectId) {
      return { ok: false, blockReason: 'duplicationLineageInvalid', details: { reason: 'lineageSourceEqualsDestination', subjectId: newSubjectId } };
    }
    if (!Object.prototype.hasOwnProperty.call(graphSubjectIds, newSubjectId)) {
      if (Object.prototype.hasOwnProperty.call(PLAN_LINEAGE_LOCAL_SCOPE_RECORD_TYPES, entry.recordType)) {
        continue; // local-scope identity (Microcycle/Session); never a canonical subject, nothing further to check
      }
      return { ok: false, blockReason: 'duplicationLineageInvalid', details: { reason: 'lineageDestinationNotInGraph', newSubjectId: newSubjectId } };
    }
    var subjectIsNew = (newSubjectId === templateId) ? templateIsNew : !priorRevisions[newSubjectId];
    if (!subjectIsNew) {
      return { ok: false, blockReason: 'duplicationLineageInvalid', details: { reason: 'lineageOnOrdinaryEdit', subjectId: newSubjectId } };
    }
    bySubjectId[newSubjectId] = oldSubjectId;
    recordTypeBySubjectId[newSubjectId] = entry.recordType;
  }
  // No cycle among the entries (A's source is B, B's source is A, or any
  // longer loop back to a starting point) -- bounded by the map's own
  // size so a malformed/adversarial chain cannot loop forever.
  var lineageKeys = Object.keys(bySubjectId);
  for (var k = 0; k < lineageKeys.length; k++) {
    var start = lineageKeys[k];
    var cursor = bySubjectId[start];
    var steps = 0;
    while (Object.prototype.hasOwnProperty.call(bySubjectId, cursor) && steps <= lineageKeys.length) {
      if (cursor === start) {
        return { ok: false, blockReason: 'duplicationLineageInvalid', details: { reason: 'lineageCyclic', subjectId: start } };
      }
      cursor = bySubjectId[cursor];
      steps++;
    }
  }
  // If the Template subject pointer is itself new to this commit and any
  // lineage entries exist at all, the Template must be one of them -- the
  // exact defect an independent probe demonstrated (every child carried
  // lineage, the Template did not, and the package still built).
  if (templateIsNew && !Object.prototype.hasOwnProperty.call(bySubjectId, templateId)) {
    return { ok: false, blockReason: 'duplicationLineageInvalid', details: { reason: 'templateLineageMissing', templateId: templateId } };
  }
  // If the Template DOES carry lineage (this commit is recognized as a
  // whole-template duplication), every other subject in this commit's
  // graph that is new must carry lineage too -- a duplication commit that
  // mixes real copies with unrelated brand-new subjects in the same
  // atomic attempt is rejected rather than guessed at (see the function
  // comment above); an ordinary edit that adds one genuinely new subject
  // alongside no duplication at all is unaffected, since bySubjectId is
  // empty in that case and this branch never runs.
  if (Object.prototype.hasOwnProperty.call(bySubjectId, templateId)) {
    var graphIds = Object.keys(graphSubjectIds);
    for (var g = 0; g < graphIds.length; g++) {
      var gid = graphIds[g];
      if (gid === templateId) continue;
      var gidIsNew = !priorRevisions[gid];
      if (gidIsNew && !Object.prototype.hasOwnProperty.call(bySubjectId, gid)) {
        return { ok: false, blockReason: 'duplicationLineageInvalid', details: { reason: 'childLineageMissing', subjectId: gid } };
      }
    }
  }
  // Round-9 review Defect #5: everything above proves the draft's
  // self-asserted lineage is an internally well-formed, complete,
  // cycle-free, one-to-one graph -- it never proves oldSubjectId is the
  // TRUE corresponding source subject, since the entire structure being
  // checked is the draft's own self-report (planEnsureDraftIdentities'
  // output, fully caller/attacker-controlled). An independent probe
  // changed a legitimate duplicated child's oldSubjectId to a fabricated
  // but well-formed string and every check above still passed. This cross-
  // checks the now-validated bySubjectId/recordTypeBySubjectId against
  // expectedBySubjectId -- a map the CALLER independently derived from the
  // actual source graph before duplication began (never reconstructed from
  // this draft's own mutable self-assertions) -- exact key set, exact
  // source subject id per destination, exact record type.
  var finalLineageKeys = Object.keys(bySubjectId);
  if (finalLineageKeys.length > 0) {
    for (var xk = 0; xk < finalLineageKeys.length; xk++) {
      var xNewId = finalLineageKeys[xk];
      var expectedSource = expectedBySubjectId ? expectedBySubjectId[xNewId] : null;
      if (!expectedSource || typeof expectedSource !== 'object' || !expectedSource.sourceSubjectId) {
        return { ok: false, blockReason: 'duplicationLineageInvalid', details: { reason: 'duplicationSourceExpectationMissing', newSubjectId: xNewId } };
      }
      if (expectedSource.sourceSubjectId !== bySubjectId[xNewId]) {
        return { ok: false, blockReason: 'duplicationLineageInvalid', details: { reason: 'duplicationSourceIdentityMismatch', newSubjectId: xNewId, claimed: bySubjectId[xNewId], expected: expectedSource.sourceSubjectId } };
      }
      if (!expectedSource.sourceRecordType || expectedSource.sourceRecordType !== recordTypeBySubjectId[xNewId]) {
        return { ok: false, blockReason: 'duplicationLineageInvalid', details: { reason: 'duplicationSourceRecordTypeMismatch', newSubjectId: xNewId, claimed: recordTypeBySubjectId[xNewId], expected: expectedSource.sourceRecordType } };
      }
    }
    // No destination claiming a source that ANOTHER destination also
    // claims -- expectedBySubjectId is caller-supplied independent truth,
    // so a duplicate source claim here means the caller's own truth map is
    // internally contradictory (two different destinations cannot both be
    // "the" copy of the same source subject in a one-to-one duplication).
    var seenExpectedSources = {};
    for (var yk = 0; yk < finalLineageKeys.length; yk++) {
      var ySrc = expectedBySubjectId[finalLineageKeys[yk]].sourceSubjectId;
      if (Object.prototype.hasOwnProperty.call(seenExpectedSources, ySrc)) {
        return { ok: false, blockReason: 'duplicationLineageInvalid', details: { reason: 'duplicationSourceClaimedByMultipleDestinations', sourceSubjectId: ySrc } };
      }
      seenExpectedSources[ySrc] = finalLineageKeys[yk];
    }
  }
  return { ok: true, bySubjectId: bySubjectId, recordTypeBySubjectId: recordTypeBySubjectId };
}

function planBuildTemplateCommitPackage(draft, basis, ids) {
  planRequire(draft && typeof draft === 'object', 'draft must be an object');
  planRequire(draft.planTemplateId, 'draft is missing stable identities; call planEnsureDraftIdentities first');
  planRequire(basis && typeof basis === 'object', 'basis is required');
  planRequire(basis.ownerUid, 'basis.ownerUid is required');
  planRequire(basis.actorUid, 'basis.actorUid is required');
  planRequire(basis.clientSchemaGeneration !== undefined && basis.clientSchemaGeneration !== null, 'basis.clientSchemaGeneration is required');
  // Round-6 Defect #7: spec §6 (Time field group) and §10 (Operation
  // package component) both name creation time as unconditional required
  // content, not "only when applicable" -- treating it as optional (the
  // round-5 shape) let it go silently missing whenever the caller simply
  // didn't pass it, rather than the caller being required to supply it.
  planRequire(basis.clientCreatedAt !== undefined && basis.clientCreatedAt !== null, 'basis.clientCreatedAt is required (spec Sec.6/Sec.10: creation time is unconditional envelope content)');
  // Round-9 review Defect #3: device/session provenance must not silently
  // disappear. Round 7/8 treated basis.deviceId/basis.sessionId as
  // optional (V1's editor has no real device/session identity source),
  // which let a probe confirm the written canonicalOperation document
  // carried neither field at all when they were omitted -- exactly the
  // "missing required input silently drops the field" failure mode
  // Sec.10 forbids. The approved spec defines no abstract placeholder
  // value for these two fields, so per the review's own instruction this
  // is now the "require and block" branch, not a fabricated placeholder:
  // a caller with no real device/session identity to report is a caller
  // that is not ready to commit, exactly like a caller with no
  // clientCreatedAt above.
  planRequire(basis.deviceId !== undefined && basis.deviceId !== null && basis.deviceId !== '', 'basis.deviceId is required (round-9 review Defect #3: device/session provenance must not silently disappear; spec Sec.10)');
  planRequire(basis.sessionId !== undefined && basis.sessionId !== null && basis.sessionId !== '', 'basis.sessionId is required (round-9 review Defect #3: device/session provenance must not silently disappear; spec Sec.10)');
  planRequire(ids && typeof ids === 'object', 'ids is required');
  planRequire(ids.operationId, 'ids.operationId is required');
  planRequire(ids.manifestId, 'ids.manifestId is required');
  planRequire(ids.gatewayId, 'ids.gatewayId is required');
  planRequire(typeof ids.allocateRevisionId === 'function', 'ids.allocateRevisionId is required');

  var ownerUid = basis.ownerUid;
  var priorRevisions = basis.priorRevisionsBySubjectId || {};
  var priorChildHeads = basis.priorChildHeadsBySubjectId || {};
  var priorAssignmentSubjectIds = planUniqueSorted(basis.priorAssignmentSubjectIds || []);
  for (var pai = 0; pai < priorAssignmentSubjectIds.length; pai++) {
    planRequire(priorRevisions[priorAssignmentSubjectIds[pai]],
      'basis.priorAssignmentSubjectIds names a subject missing from basis.priorRevisionsBySubjectId: ' + priorAssignmentSubjectIds[pai]);
  }

  var graph = planNormalizeCanonicalGraph(draft);

  var manifestResult = planBuildGraphManifest(graph, {
    manifestId: ids.manifestId,
    ownerUid: ownerUid,
    operationId: ids.operationId,
    gatewayId: ids.gatewayId,
    allocateRevisionId: ids.allocateRevisionId,
    priorRevisionsBySubjectId: priorRevisions,
    // Round-6 Defect #7: complete chunk envelopes (authority/provenance/
    // encoding/lifecycle fields) -- see planBuildManifestChunkDocumentData.
    actorUid: basis.actorUid,
    authorityKind: basis.authorityKind || 'owner',
    authorityScope: basis.authorityScope || null,
    authorityBasisRefs: basis.authorityBasisRefs || [],
    clientSchemaGeneration: basis.clientSchemaGeneration,
    clientCreatedAt: basis.clientCreatedAt
  });

  if (!manifestResult.ok) {
    return manifestResult; // { ok: false, blockReason: 'duplicateRevisionIdentity'|'graphRequiresPreparedCommit', details }
  }

  // Round-4 source review Defect #5: consume the duplication lineage
  // planEnsureDraftIdentities already computes (03-identity.js) instead of
  // silently discarding it. _planDuplicationLineage itself is never
  // spread into any canonical write below -- only this derived
  // subjectId -> sourceSubjectId map is used, to stamp the approved
  // canonical duplicatedFromSubjectId lineage field on new revisions.
  //
  // Round-7 review Defect #5: the round-4/5/6 shape above only ever
  // COLLAPSED the raw subjectLineage list into a map and used it if
  // present -- nothing validated the list itself. An independent probe
  // removed only the Template's own entry from a draft's
  // _planDuplicationLineage.subjectLineage (leaving every child's entry
  // in place) and planBuildTemplateCommitPackage still succeeded, writing
  // every child's duplicatedFromSubjectId but leaving the brand-new
  // Template subject pointer with no lineage at all -- an internally
  // contradictory duplication graph. planValidateDuplicationLineage (above)
  // now validates the raw list as a whole graph before any of it is
  // trusted: see its own comment for the complete rule set.
  var graphSubjectIdsForLineage = {};
  graphSubjectIdsForLineage[draft.planTemplateId] = true;
  for (var lgi = 0; lgi < graph.nodes.length; lgi++) graphSubjectIdsForLineage[graph.nodes[lgi].subjectId] = true;
  var rawLineageListForCheck = draft._planDuplicationLineage && Array.isArray(draft._planDuplicationLineage.subjectLineage) ? draft._planDuplicationLineage.subjectLineage : [];
  // Round-9 review Defect #5: a draft that asserts duplication lineage at
  // all requires the caller to also supply the independently known
  // source-to-destination truth (see planValidateDuplicationLineage's own
  // comment on expectedBySubjectId) -- a caller with nothing real to
  // report here is not ready to commit a duplication, exactly like a
  // caller with no clientCreatedAt/deviceId/sessionId above.
  if (rawLineageListForCheck.length > 0) {
    planRequire(basis.duplicationSourceExpectedBySubjectId && typeof basis.duplicationSourceExpectedBySubjectId === 'object',
      'basis.duplicationSourceExpectedBySubjectId is required when the draft asserts duplication lineage (round-9 review Defect #5: oldSubjectId must be proven against an independently known source-to-destination map, never trusted from the draft\'s own self-assertion alone)');
  }
  var lineageCheck = planValidateDuplicationLineage(
    rawLineageListForCheck,
    graphSubjectIdsForLineage,
    draft.planTemplateId,
    priorRevisions,
    !basis.templateSubject,
    basis.duplicationSourceExpectedBySubjectId || {}
  );
  if (!lineageCheck.ok) return lineageCheck; // { ok:false, blockReason:'duplicationLineageInvalid', details }
  var duplicationLineageBySubjectId = lineageCheck.bySubjectId;
  // Round-9 review Defect #5: one read-plan ref per validated duplication
  // destination, naming the CLAIMED source subject's own canonical
  // document -- read and independently confirmed to actually exist (right
  // type, right owner, active) before any remapping is trusted. Built from
  // lineageCheck's own already-cross-checked bySubjectId/
  // recordTypeBySubjectId (not re-derived from the draft), so this list is
  // exactly the set of source subjects the independent expectation map and
  // the draft's self-report both agreed on.
  // Round-10 review Defect #2: the round-9 fix above proves the CLAIMED
  // source subject id/record type are the true ones, and the read-time
  // check below (step 6.6) confirmed the source document existed, was
  // owned by the same owner, and was active -- but never checked it was a
  // COMPLETE canonical document (full §6 envelope), nor bound the read to a
  // specific expected head revision, the same "recompute/verify against an
  // independent expectation, not merely check four fields" standard every
  // other subject-pointer read in this file (child subjects, the Template
  // head itself) already applies. Each duplication source is, after all,
  // exactly the same kind of document as those -- a subject pointer -- so
  // it gets exactly the same expectedHeadRevisionId/expectedEnvelope
  // treatment, sourced from the SAME independently-supplied
  // basis.duplicationSourceExpectedBySubjectId entry that already supplied
  // sourceSubjectId/sourceRecordType.
  var duplicationSourceRefs = Object.keys(duplicationLineageBySubjectId).map(function (newSubjectId) {
    var sourceSubjectId = duplicationLineageBySubjectId[newSubjectId];
    var sourceRecordType = lineageCheck.recordTypeBySubjectId[newSubjectId];
    var sourceExpectation = basis.duplicationSourceExpectedBySubjectId[newSubjectId];
    planRequire(sourceExpectation.expectedHeadRevisionId, 'basis.duplicationSourceExpectedBySubjectId[' + newSubjectId + '].expectedHeadRevisionId is required (round-10 review Defect #2: a duplication source must be bound to a specific expected head revision, not merely confirmed to exist)');
    var sourceExpectedEnvelope = planRequireExpectedEnvelope('basis.duplicationSourceExpectedBySubjectId[' + newSubjectId + ']', sourceExpectation.expectedEnvelope);
    return {
      newSubjectId: newSubjectId,
      sourceSubjectId: sourceSubjectId,
      sourceRecordType: sourceRecordType,
      path: planSubjectPath(ownerUid, sourceRecordType, sourceSubjectId),
      expectedHeadRevisionId: sourceExpectation.expectedHeadRevisionId,
      expectedEnvelope: sourceExpectedEnvelope
    };
  });

  var templateId = draft.planTemplateId;
  var templateEntry = null;
  for (var ie = 0; ie < manifestResult.entries.length; ie++) {
    if (manifestResult.entries[ie].subjectId === templateId) { templateEntry = manifestResult.entries[ie]; break; }
  }
  planRequire(templateEntry, 'internal error: template subject missing from manifest entries');
  var templateRevisionId = templateEntry.revisionId;

  // Round-6 Defect #2: the Template's own dependencyHash recursively
  // covers every child in its graph (round-1 Defect #2/#12: "the Template
  // now explicitly depends on every ScheduleOpportunity in it"), so
  // templateEntry.reused === true proves the ENTIRE graph -- not just the
  // Template's own top-level fields -- is byte-identical to what is
  // already committed. An independent probe using a completely unchanged
  // draft on a second save still reused the Template revision but wrote a
  // brand-new manifest and advanced the Template head's headManifestId/
  // headManifestHash to that new, redundant manifest -- leaving the head
  // naming a manifest its own unchanged, immutable, never-rewritten
  // revision document does not itself reference. That breaks spec Sec.13's
  // required agreement ("Canonical readers accept a Template revision only
  // when the Template head, revision, manifest, operation outcome, and
  // gateway agree") regardless of which of the two options the review
  // offered is "more correct" in the abstract. Spec Sec.20's acceptance
  // test "every immutable revision and manifest remains byte-for-byte
  // unchanged after later saves" forces the choice: a genuine no-op that
  // preserves the exact prior revision AND manifest, not a successor
  // revision (there is nothing to succeed -- reused already means "no
  // successor needed") and not a redundant new manifest with nothing
  // pointing at it. When true, this attempt plans ZERO candidate writes:
  // no new manifest/chunks, no Template head advance, no operation/gateway/
  // projection write -- "the Template head, operation outcome, gateway,
  // manifest, and projection either advance together or none becomes
  // authoritative" (spec Sec.13), and here none does. Validation (07) still
  // runs its full read-plan agreement checks first, so a save that only
  // LOOKS unchanged from a stale client's perspective (someone else
  // committed a real change concurrently) still correctly blocks rather
  // than silently no-op'ing.
  var noChangeToCommit = templateEntry.reused === true;

  // Round-7 review Defect #2: a genuine no-op must be verified against the
  // EXACT existing committed tuple (Template head, revision, manifest,
  // operation outcome, gateway) it claims to be identical to -- not
  // described using freshly minted, never-written manifest/gateway ids.
  // That requires knowing which prior operation and gateway produced the
  // Template's current head, so every REAL commit (the `!noChangeToCommit`
  // write below) now stamps headOperationId/headGatewayId onto the
  // Template subject pointer alongside the pre-existing headManifestId/
  // headManifestHash. A no-change attempt against a Template head that
  // predates this fix (no headOperationId/headGatewayId recorded) cannot
  // safely be verified this way and must not silently proceed as a no-op.
  if (noChangeToCommit && !templateSubjectExpectedAbsentForNoChangeCheck()) {
    planRequire(basis.templateSubject.headOperationId, 'basis.templateSubject.headOperationId is required to verify a no-change save against its exact prior committed tuple (round-7 Defect #2) -- this Template head predates that field and cannot be safely no-op-verified');
    planRequire(basis.templateSubject.headGatewayId, 'basis.templateSubject.headGatewayId is required to verify a no-change save against its exact prior committed tuple (round-7 Defect #2) -- this Template head predates that field and cannot be safely no-op-verified');
    // Round-9 review Defect #1: the no-change tuple was previously verified
    // down to the manifest ROOT document only -- an independent probe
    // showed the manifest's own chunk documents (which actually carry the
    // graph's content) were never read or validated at all during a
    // no-change attempt, so a manifest root whose stored graphHash was
    // simply left stale/wrong relative to its own chunks would still pass.
    // headManifestChunkIds (stamped onto every REAL commit's Template head
    // below, alongside the pre-existing headOperationId/headGatewayId)
    // names the exact ordered chunk id list to re-read and re-verify. A
    // head that predates this field cannot be safely no-change-verified,
    // exactly like a head that predates headOperationId/headGatewayId.
    planRequire(Array.isArray(basis.templateSubject.headManifestChunkIds) && basis.templateSubject.headManifestChunkIds.length > 0, 'basis.templateSubject.headManifestChunkIds is required to verify a no-change save against its exact prior committed manifest chunks (round-9 Defect #1) -- this Template head predates that field and cannot be safely no-op-verified');
    // Round-10 review Defect #1: the prior operation's own deviceId/sessionId
    // (round-9 Defect #3's device/session provenance) were never verified
    // against an independent expectation during a no-change save -- only
    // presence on the CURRENT attempt's own basis.deviceId/basis.sessionId
    // was required, which says nothing about what the PRIOR real commit's
    // operation document actually recorded. Mirrors headOperationId/
    // headGatewayId/headManifestChunkIds exactly: every REAL commit now also
    // stamps headDeviceId/headSessionId (see templateSubjectWriteData below),
    // and a head that predates this fix cannot be safely no-op-verified.
    planRequire(basis.templateSubject.headDeviceId, 'basis.templateSubject.headDeviceId is required to verify a no-change save against its exact prior committed operation (round-10 Defect #1) -- this Template head predates that field and cannot be safely no-op-verified');
    planRequire(basis.templateSubject.headSessionId, 'basis.templateSubject.headSessionId is required to verify a no-change save against its exact prior committed operation (round-10 Defect #1) -- this Template head predates that field and cannot be safely no-op-verified');
    // Round-11 review: the prior operation's intentFingerprint and the
    // prior gateway's expectedPredecessorRevisionId were never verified
    // against an independent expectation during a no-change save either --
    // same gap, same fix shape. headExpectedPredecessorRevisionId may
    // legitimately be null (the original commit created a brand-new
    // Template with no predecessor revision), so its require checks
    // presence, not truthiness -- mirrors expectedEnvelope.authorityScope
    // in planRequireExpectedEnvelope above. A head that predates either
    // field cannot be safely no-op-verified.
    planRequire(basis.templateSubject.headIntentFingerprint, 'basis.templateSubject.headIntentFingerprint is required to verify a no-change save against its exact prior committed operation (round-11 Defect) -- this Template head predates that field and cannot be safely no-op-verified');
    planRequire(Object.prototype.hasOwnProperty.call(basis.templateSubject, 'headExpectedPredecessorRevisionId'), 'basis.templateSubject.headExpectedPredecessorRevisionId is required (may legitimately be null, but must be explicitly present) to verify a no-change save against its exact prior committed gateway (round-11 Defect) -- this Template head predates that field and cannot be safely no-op-verified');
    // Round-12 review: the write-set hash's own historical value is now
    // independently frozen and cross-checked too (see
    // expectedHeadWriteSetHash above) -- unlike the fields just above,
    // this one is required to be not merely present but well-formed (a
    // genuine 64-lowercase-hex sha256 digest) at construction time, per
    // the review's explicit instruction that a no-change package must
    // refuse construction if this expectation is "missing OR malformed".
    // Never legitimately null (every real commit, first or later
    // generation, always produces a genuine write-set hash).
    planRequire(typeof basis.templateSubject.headWriteSetHash === 'string' && /^[0-9a-f]{64}$/.test(basis.templateSubject.headWriteSetHash), 'basis.templateSubject.headWriteSetHash is required and must be a well-formed sha256 hex digest to verify a no-change save against its exact prior committed write-set hash (round-12 review) -- this Template head predates that field, or carries a malformed value, and cannot be safely no-op-verified');
  }
  function templateSubjectExpectedAbsentForNoChangeCheck() {
    // A no-change attempt against an absent Template subject is a
    // contradiction (reused revision implies a subject already exists),
    // but guard defensively rather than dereference basis.templateSubject
    // when it is falsy -- that contradiction surfaces on its own via the
    // normal staleTemplateHead/targetCollision checks in validation.
    return !basis.templateSubject;
  }

  function expectedHeadFor(subjectId) {
    if (priorChildHeads[subjectId]) return priorChildHeads[subjectId].headRevisionId;
    if (priorRevisions[subjectId]) return priorRevisions[subjectId].revisionId;
    return null;
  }

  // Round-9 review Defect #2: same fallback order as expectedHeadFor above
  // (a child subject's head expectation defaults to its priorRevisions
  // entry when basis.priorChildHeadsBySubjectId doesn't separately name
  // one) applied to where the frozen historical envelope expectation for
  // that same subject comes from.
  function expectedEnvelopeSourceFor(subjectId) {
    if (priorChildHeads[subjectId]) return priorChildHeads[subjectId];
    if (priorRevisions[subjectId]) return priorRevisions[subjectId];
    return null;
  }

  var envCtx = {
    ownerUid: ownerUid,
    operationId: ids.operationId,
    gatewayId: ids.gatewayId,
    actorUid: basis.actorUid,
    authorityKind: basis.authorityKind || 'owner',
    authorityScope: basis.authorityScope || null,
    authorityBasisRefs: basis.authorityBasisRefs || [],
    clientSchemaGeneration: basis.clientSchemaGeneration,
    clientCreatedAt: basis.clientCreatedAt,
    priorRevisionsBySubjectId: priorRevisions,
    duplicationLineageBySubjectId: duplicationLineageBySubjectId
  };

  // ---- Present-in-current-graph child subject ids, by whether they are
  // new or already existed, used both for the read plan and for removal
  // detection below.
  var currentAssignmentSubjectIds = {};
  var childSubjectRefs = [];
  var reusedRevisionRefs = [];
  var newRevisionTargetRefs = [];

  // Round-4 source review Defect #4: for every NEW revision whose subject
  // had a prior committed revision, plan a read of that EXACT predecessor
  // revision document (not just the subject's head pointer), so
  // successor-lineage can be validated against real read content rather
  // than trusted purely from in-memory basis data.
  //
  // Round-6 Defect #3: the round-5 shape only froze the predecessor's two
  // stored HASHES as the expectation, then validate.js compared those
  // against the read document's own (also merely stored) hash fields --
  // never against anything recomputed from real content. An independent
  // probe supplied a predecessor document containing only identity fields
  // plus the two expected hash strings, with no semantic payload and no
  // dependencyRefs at all, and validation returned 'proceed'. This freezes
  // the predecessor's actual expected semantic payload and dependency refs
  // too (basis.priorRevisionsBySubjectId[subjectId] must now carry them --
  // see the updated basis-shape comment above), exactly mirroring the
  // expectedSemanticPayload/expectedDependencyRefs already frozen for
  // in-place REUSED revisions, so validate.js can apply the identical
  // recompute-and-cross-check standard to predecessors too.
  var predecessorRevisionRefs = [];
  function addPredecessorRefIfNeeded(subjectId, subjectRecordType, revisionRecordType) {
    var prior = priorRevisions[subjectId];
    if (!prior) return;
    planRequire(prior.semanticPayload && typeof prior.semanticPayload === 'object',
      'basis.priorRevisionsBySubjectId[' + subjectId + '].semanticPayload is required (needed to validate predecessor content, round-6 Defect #3)');
    planRequire(Array.isArray(prior.dependencyRefs),
      'basis.priorRevisionsBySubjectId[' + subjectId + '].dependencyRefs is required (needed to validate predecessor content, round-6 Defect #3)');
    var predEnv = planRequireExpectedEnvelope('basis.priorRevisionsBySubjectId[' + subjectId + ']', prior.expectedEnvelope);
    predecessorRevisionRefs.push({
      subjectId: subjectId,
      revisionRecordType: revisionRecordType,
      revisionId: prior.revisionId,
      path: planRevisionPath(ownerUid, subjectRecordType, prior.revisionId),
      expectedPayloadHash: prior.payloadHash,
      expectedDependencyHash: prior.dependencyHash,
      expectedSemanticPayload: prior.semanticPayload,
      expectedDependencyRefs: prior.dependencyRefs,
      expectedEnvelope: predEnv
    });
  }

  for (var i = 0; i < graph.nodes.length; i++) {
    var node = graph.nodes[i];
    if (node.subjectId === templateId) continue; // Template handled separately below

    if (node.recordType === 'planAssignmentSubject') currentAssignmentSubjectIds[node.subjectId] = true;

    var entry = null;
    for (var je = 0; je < manifestResult.entries.length; je++) {
      if (manifestResult.entries[je].subjectId === node.subjectId) { entry = manifestResult.entries[je]; break; }
    }
    var existedBefore = !!priorRevisions[node.subjectId];
    var childExpectedEnvelope = existedBefore
      ? planRequireExpectedEnvelope('basis.priorChildHeadsBySubjectId/priorRevisionsBySubjectId[' + node.subjectId + ']', expectedEnvelopeSourceFor(node.subjectId) && expectedEnvelopeSourceFor(node.subjectId).expectedEnvelope)
      : null;

    childSubjectRefs.push({
      subjectId: node.subjectId,
      recordType: node.recordType,
      path: planSubjectPath(ownerUid, node.recordType, node.subjectId),
      expectedAbsent: !existedBefore,
      expectedHeadRevisionId: existedBefore ? expectedHeadFor(node.subjectId) : null,
      expectedEnvelope: childExpectedEnvelope
    });

    if (entry.reused) {
      // A reused revision, by definition, already existed prior to this
      // attempt -- priorRevisions[node.subjectId] must be present, and its
      // OWN expectedEnvelope (the revision document's original creation
      // envelope) is the correct source here, never the subject pointer's
      // (childExpectedEnvelope above): the pointer gets re-stamped by
      // every later commit that touches this Template even when this
      // specific child's own revision is reused unchanged, so the two
      // documents' true historical envelopes can genuinely differ.
      var reusedRevEnv = planRequireExpectedEnvelope('basis.priorRevisionsBySubjectId[' + node.subjectId + ']', priorRevisions[node.subjectId] && priorRevisions[node.subjectId].expectedEnvelope);
      reusedRevisionRefs.push({
        subjectId: node.subjectId,
        recordType: node.recordType,
        revisionRecordType: entry.recordType,
        revisionId: entry.revisionId,
        path: entry.path,
        expectedPayloadHash: entry.payloadHash,
        expectedDependencyHash: entry.dependencyHash,
        // Full expected document meaning (Defect #9: reused-revision
        // integrity must be checked against the complete expected
        // document, not just the payload hash) -- validate.js compares
        // the actually-read document's semantic payload against this.
        expectedSemanticPayload: entry.semanticPayload,
        expectedDependencyRefs: entry.dependencyRefs,
        expectedEnvelope: reusedRevEnv
      });
    } else {
      newRevisionTargetRefs.push({
        subjectId: node.subjectId,
        recordType: node.recordType,
        revisionRecordType: entry.recordType,
        revisionId: entry.revisionId,
        path: entry.path
      });
      addPredecessorRefIfNeeded(node.subjectId, node.recordType, entry.recordType);
    }
  }

  var templateSubjectExpectedAbsent = !basis.templateSubject;
  // Round-9 review Defect #2 (and reused as the no-change prior tuple's own
  // expected envelope for Defect #1 -- see below): the Template subject
  // pointer's updatedByOperationId/actorUid/etc. get re-stamped by EVERY
  // real commit that touches this Template (the write loop below runs for
  // every child unconditionally), so basis.templateSubject.expectedEnvelope
  // is "whatever the most recent real commit against this Template
  // actually was" -- which, when the Template's own revision is also
  // reused (templateEntry.reused, which only ever happens together with
  // noChangeToCommit -- see its definition above), is the exact SAME
  // commit that produced the currently-authoritative prior manifest/
  // operation/gateway. One frozen expectation legitimately serves all of
  // them.
  var templateExpectedEnvelope = templateSubjectExpectedAbsent
    ? null
    : planRequireExpectedEnvelope('basis.templateSubject', basis.templateSubject.expectedEnvelope);
  var templateSubjectPath = planSubjectPath(ownerUid, 'planTemplateSubject', templateId);
  var templateSubjectRef = {
    subjectId: templateId,
    recordType: 'planTemplateSubject',
    path: templateSubjectPath,
    expectedAbsent: templateSubjectExpectedAbsent,
    expectedHeadRevisionId: templateSubjectExpectedAbsent ? null : basis.templateSubject.headRevisionId,
    expectedHeadSequence: templateSubjectExpectedAbsent ? null : basis.templateSubject.headSequence,
    // Round-4 source review Defect #4: Template head manifest ID/hash
    // agreement must be validated too, not only head revision/sequence.
    expectedHeadManifestId: templateSubjectExpectedAbsent ? null : basis.templateSubject.headManifestId,
    expectedHeadManifestHash: templateSubjectExpectedAbsent ? null : basis.templateSubject.headManifestHash,
    // Round-10 review Defect #1 (adversarially reverified): headOperationId/
    // headGatewayId are safely read straight off docs.templateSubject at
    // step 10 below (see basisHeadOperationIdFor's own comment) because a
    // FORGED value there would still be caught -- both ids get baked into
    // the manifest-chunk hash recomputation, so a wrong one fails a
    // cryptographic hash comparison even if the document read itself were
    // otherwise self-consistent. headDeviceId/headSessionId have no such
    // hash binding anywhere (planBuildManifestChunkDocumentData never
    // includes them), so reading them the same "trust docs.templateSubject
    // once it's proven non-stale" way would only prove INTERNAL
    // self-consistency between two fields of the same untrusted read
    // bundle, not agreement with anything the caller independently knew in
    // advance -- exactly the gap round-9 Defect #2 exists to close in
    // general. These instead follow the expectedHeadManifestId/
    // expectedHeadManifestHash pattern: an independent expectation frozen
    // from basis.templateSubject (the caller's own prior record), cross-
    // checked against the real read document at step 3 below.
    expectedHeadDeviceId: templateSubjectExpectedAbsent ? null : basis.templateSubject.headDeviceId,
    expectedHeadSessionId: templateSubjectExpectedAbsent ? null : basis.templateSubject.headSessionId,
    // Round-11 review: the prior operation's intentFingerprint and the
    // prior gateway's expectedPredecessorRevisionId cannot be recomputed
    // from current state during a no-change re-check (intentFingerprint's
    // own source includes the HEAD-BEFORE-LAST expectedHeadRevisionId, two
    // generations back; expectedPredecessorRevisionId is itself that same
    // two-generations-back value). Both follow the same independently-
    // frozen-expectation pattern as expectedHeadDeviceId/expectedHeadSessionId
    // above, stashed on the Template subject pointer at the time it was
    // the real, live commit -- never read back out of the untrusted prior
    // operation/gateway documents themselves.
    expectedHeadIntentFingerprint: templateSubjectExpectedAbsent ? null : basis.templateSubject.headIntentFingerprint,
    expectedHeadExpectedPredecessorRevisionId: templateSubjectExpectedAbsent ? null : basis.templateSubject.headExpectedPredecessorRevisionId,
    // Round-12 review: option 3 (deterministic placeholder normalization)
    // authorized for the write-set hash's self-reference -- see
    // planComputeCanonicalWriteSetHash. This does NOT recompute the
    // original historical write-set hash from scratch (that would require
    // re-reading everything a no-change re-check exists to avoid
    // re-reading); it follows the exact same independently-frozen-
    // expectation pattern as every other head field above: the caller's
    // own remembered value, cross-checked against what the transaction
    // actually reads, never derived from the documents being checked.
    expectedHeadWriteSetHash: templateSubjectExpectedAbsent ? null : basis.templateSubject.headWriteSetHash,
    expectedEnvelope: templateExpectedEnvelope
  };
  if (templateEntry.reused) {
    reusedRevisionRefs.push({
      subjectId: templateId,
      recordType: 'planTemplateSubject',
      revisionRecordType: templateEntry.recordType,
      revisionId: templateRevisionId,
      path: templateEntry.path,
      expectedPayloadHash: templateEntry.payloadHash,
      expectedDependencyHash: templateEntry.dependencyHash,
      expectedSemanticPayload: templateEntry.semanticPayload,
      expectedDependencyRefs: templateEntry.dependencyRefs,
      expectedEnvelope: templateExpectedEnvelope
    });
  } else {
    newRevisionTargetRefs.push({
      subjectId: templateId,
      recordType: 'planTemplateSubject',
      revisionRecordType: templateEntry.recordType,
      revisionId: templateRevisionId,
      path: templateEntry.path
    });
    addPredecessorRefIfNeeded(templateId, 'planTemplateSubject', templateEntry.recordType);
  }

  // ---- Removal-lifecycle planning (Defect #7). Scope: planAssignmentSubject
  // only (see the basis doc comment above and the final report).
  var removedAssignmentRefs = [];
  for (var ra = 0; ra < priorAssignmentSubjectIds.length; ra++) {
    var removedId = priorAssignmentSubjectIds[ra];
    if (currentAssignmentSubjectIds[removedId]) continue; // still present: not a removal
    var removedExpectedEnvelope = planRequireExpectedEnvelope('basis.priorChildHeadsBySubjectId/priorRevisionsBySubjectId[' + removedId + ']', expectedEnvelopeSourceFor(removedId) && expectedEnvelopeSourceFor(removedId).expectedEnvelope);
    removedAssignmentRefs.push({
      subjectId: removedId,
      recordType: 'planAssignmentSubject',
      path: planSubjectPath(ownerUid, 'planAssignmentSubject', removedId),
      expectedHeadRevisionId: expectedHeadFor(removedId),
      expectedEnvelope: removedExpectedEnvelope
    });
  }

  // ---- Deterministic collision targets for the manifest root and every
  // chunk (Defect #6): fresh manifestId/chunkIds are minted per attempt
  // and reused verbatim on retry (§4.3), so on a fresh 'proceed' attempt
  // these must not already exist; on a true retry, the operation-outcome
  // check (validate.js step 2) resolves before this matters.
  var manifestRootRef = { path: planSystemPath(ownerUid, 'planGraphManifest', ids.manifestId) };
  var chunkRefs = manifestResult.chunks.map(function (c) {
    return { chunkId: c.chunkId, path: planSystemPath(ownerUid, 'planGraphManifestChunk', c.chunkId) };
  });

  // ---- Required projection target (Defect #6/#13): frozen into the read
  // plan for completeness/audit, but its presence/content never blocks --
  // planTemplateSummaries is an always-overwritten rebuildable projection
  // (spec §15), not a collision-sensitive canonical record.
  var projectionRef = { path: planSystemPath(ownerUid, 'planTemplateSummary', templateId) };

  // Round-7 review Defect #2: for a genuine no-change attempt, name the
  // EXACT prior committed manifest/operation/gateway that the current
  // Template head already points to, so validation can read and verify
  // that real tuple instead of the freshly minted, never-written ids
  // above. All three paths are derivable in one flat pass directly from
  // basis.templateSubject (the caller-supplied, already-read current head
  // pointer) -- no second read phase required. null when not applicable
  // (a real, non-no-change attempt has nothing prior to re-verify here;
  // the ordinary manifestRootRef/gatewayRef collision checks above already
  // cover that path).
  // Slice 3 spec §6 (additive contract closure): the approved Slice 2
  // resolver requires record type, record ID, and expected path as three
  // SEPARATE claims -- deriving an ID back out of its own path would not
  // satisfy that contract (a malformed document stored under a mismatched
  // ID could then be read without a true pre-read identity cross-check).
  // manifestId/operationId/gatewayId below are frozen beside each ref's
  // existing `path` field, purely additively -- the path itself, and every
  // other field on these three objects, is completely unchanged.
  var priorManifestRootRef = null;
  var priorOperationRef = null;
  var priorGatewayRef = null;
  // Round-9 review Defect #1: one ref per prior manifest chunk, in the
  // exact ordinal order basis.templateSubject.headManifestChunkIds (itself
  // stamped verbatim from manifestResult.manifest.chunkIds by the REAL
  // commit that produced this head -- see the Template subject write
  // below) names -- so validation can read and independently recompute
  // every chunk's hash, not just trust the manifest root's own stored
  // graphHash. Always an array (empty when not applicable), matching every
  // other *Refs array in this readPlan -- unlike the three singular refs
  // above, there is no single "not applicable" ref to null out.
  var priorChunkRefs = [];
  if (noChangeToCommit) {
    priorManifestRootRef = { manifestId: basis.templateSubject.headManifestId, path: planSystemPath(ownerUid, 'planGraphManifest', basis.templateSubject.headManifestId) };
    priorOperationRef = { operationId: basis.templateSubject.headOperationId, path: planSystemPath(ownerUid, 'canonicalOperation', basis.templateSubject.headOperationId) };
    priorGatewayRef = { gatewayId: basis.templateSubject.headGatewayId, path: planSystemPath(ownerUid, 'planCommitGateway', basis.templateSubject.headGatewayId) };
    priorChunkRefs = basis.templateSubject.headManifestChunkIds.map(function (chunkId, chunkOrdinal) {
      return { chunkId: chunkId, chunkOrdinal: chunkOrdinal, path: planSystemPath(ownerUid, 'planGraphManifestChunk', chunkId) };
    });
  }

  var readPlan = Object.freeze({
    schemaAuthorityRef: Object.freeze({ path: PLAN_SCHEMA_AUTHORITY_PATH }),
    operationRef: Object.freeze({ path: planSystemPath(ownerUid, 'canonicalOperation', ids.operationId) }),
    gatewayRef: Object.freeze({ path: planSystemPath(ownerUid, 'planCommitGateway', ids.gatewayId) }),
    templateSubjectRef: Object.freeze(templateSubjectRef),
    childSubjectRefs: Object.freeze(childSubjectRefs.map(Object.freeze)),
    reusedRevisionRefs: Object.freeze(reusedRevisionRefs.map(Object.freeze)),
    newRevisionTargetRefs: Object.freeze(newRevisionTargetRefs.map(Object.freeze)),
    predecessorRevisionRefs: Object.freeze(predecessorRevisionRefs.map(Object.freeze)),
    removedAssignmentRefs: Object.freeze(removedAssignmentRefs.map(Object.freeze)),
    manifestRootRef: Object.freeze(manifestRootRef),
    chunkRefs: Object.freeze(chunkRefs.map(Object.freeze)),
    projectionRef: Object.freeze(projectionRef),
    priorManifestRootRef: priorManifestRootRef ? Object.freeze(priorManifestRootRef) : null,
    priorOperationRef: priorOperationRef ? Object.freeze(priorOperationRef) : null,
    priorGatewayRef: priorGatewayRef ? Object.freeze(priorGatewayRef) : null,
    priorChunkRefs: Object.freeze(priorChunkRefs.map(Object.freeze)),
    duplicationSourceRefs: Object.freeze(duplicationSourceRefs.map(Object.freeze))
  });

  // ---- Intent fingerprint (§10): binds operation type, actor, templateId,
  // expected head, new revision identity, normalized graph hash, schema
  // generation, and commit policy.
  var intentFingerprintSource = {
    operationType: 'commitPlanTemplateRevision',
    actorUid: basis.actorUid,
    templateId: templateId,
    expectedHeadRevisionId: templateSubjectExpectedAbsent ? null : basis.templateSubject.headRevisionId,
    newTemplateRevisionId: templateRevisionId,
    graphHash: manifestResult.manifest.graphHash,
    clientSchemaGeneration: basis.clientSchemaGeneration,
    commitMode: ids.commitMode || 'standard'
  };
  var intentFingerprint = planSha256Hex(planBuildCanonicalEncoding(intentFingerprintSource));

  // ---- Candidate write set (§10's "Write plan" package component): the
  // complete deterministic set of documents this attempt would write if
  // validation succeeds. Pure structure derived only from the
  // graph/manifest/operation/gateway -- never depends on validation
  // outcome, so it is safe to precompute here. planBuildTemplateCommitWrites
  // is the sole gate that may release it, and only after a successful
  // 'proceed' validation result.
  var candidateWrites = [];

  // Round-6 Defect #2: when noChangeToCommit is true (see the comment
  // above where it is computed), this entire candidate-write section is
  // skipped -- candidateWrites stays genuinely empty, and none of the
  // manifest/chunk/subject-head/operation/projection/gateway writes below
  // are ever built. See the `else` branch just before Object.freeze(
  // candidateWrites) below for the corresponding empty-write-set hash.
  if (!noChangeToCommit) {

  for (var c = 0; c < manifestResult.chunks.length; c++) {
    var chunk = manifestResult.chunks[c];
    // Reuses the exact same builder 05-manifest.js used to measure this
    // chunk's byte size and compute its chunkHash (Defect #6) -- the
    // actual write can never again diverge from what was measured.
    candidateWrites.push({
      kind: 'planGraphManifestChunk',
      path: planSystemPath(ownerUid, 'planGraphManifestChunk', chunk.chunkId),
      data: planBuildManifestChunkDocumentData(
        ids.manifestId, chunk.chunkId, chunk.chunkOrdinal,
        chunk.entries, chunk.entryCount, chunk.chunkHash,
        ids.operationId, ids.gatewayId, ownerUid, envCtx
      )
    });
  }
  candidateWrites.push({
    kind: 'planGraphManifest',
    path: planSystemPath(ownerUid, 'planGraphManifest', ids.manifestId),
    data: Object.assign({}, planBuildSystemEnvelope('planGraphManifest', ids.manifestId, envCtx, true), {
      manifestId: ids.manifestId, templateId: templateId,
      templateRevisionId: templateRevisionId,
      // Round-7 review Defect #6: a manifest is a permanent record once
      // written -- lifecycleState was previously omitted.
      lifecycleState: 'active',
      recordCount: manifestResult.manifest.recordCount, chunkCount: manifestResult.manifest.chunkCount,
      chunkIds: manifestResult.manifest.chunkIds, chunkHashes: manifestResult.manifest.chunkHashes,
      graphHash: manifestResult.manifest.graphHash,
      // Round-5 reverification fix: planBuildSystemEnvelope only stamps
      // updatedByOperationId/createdByOperationId (its general-purpose
      // naming, shared by every non-revision, non-chunk system doc). The
      // manifest chunk write (planBuildManifestChunkDocumentData, just
      // above) uses a plain operationId field instead, and a manifest is
      // always freshly created -- never updated in place, one manifestId
      // per commit -- so there is no created/updated distinction for it to
      // preserve. Stamping the same plain operationId field here keeps the
      // manifest root doc and its chunk docs consistently queryable by the
      // same field name, without removing the general envelope fields.
      operationId: ids.operationId
    })
  });

  for (var e = 0; e < manifestResult.entries.length; e++) {
    var revEntry = manifestResult.entries[e];
    if (revEntry.reused) continue; // unchanged: no write, exact prior revision remains authoritative

    var envelope = planBuildRevisionEnvelope(revEntry, envCtx);
    var namedDeps = planNamedDependencyFields(revEntry.subjectRecordType, revEntry.dependencyRefs);
    var data = Object.assign({}, envelope, revEntry.semanticPayload, namedDeps);

    if (revEntry.subjectId === templateId) {
      data.templateId = templateId;
      data.templateRevisionId = templateRevisionId;
      data.revisionSequence = templateSubjectExpectedAbsent ? 1 : (basis.templateSubject.headSequence + 1);
      data.manifestId = ids.manifestId;
      data.manifestHash = manifestResult.manifest.graphHash;
      data.manifestChunkIds = manifestResult.manifest.chunkIds;
      data.graphRecordCount = manifestResult.manifest.recordCount;
      data.intentFingerprint = intentFingerprint;
    }

    candidateWrites.push({
      kind: revEntry.recordType,
      path: revEntry.path,
      data: data
    });
  }

  // Subject/head doc writes: one per non-Template, non-removed subject
  // (new subjects get a fresh subject doc; existing subjects get their
  // head advanced).
  for (var h = 0; h < childSubjectRefs.length; h++) {
    var ref = childSubjectRefs[h];
    var headEntry = null;
    for (var ke = 0; ke < manifestResult.entries.length; ke++) {
      if (manifestResult.entries[ke].subjectId === ref.subjectId) { headEntry = manifestResult.entries[ke]; break; }
    }
    var subjectWriteData = Object.assign({}, planBuildSystemEnvelope(ref.recordType, ref.subjectId, envCtx, ref.expectedAbsent), {
      subjectId: ref.subjectId,
      lifecycleState: 'active',
      headRevisionId: headEntry.revisionId
    });
    // Round-5 reverification fix: this is the same duplication-lineage stamp
    // planBuildRevisionEnvelope above already applies to the corresponding
    // Revision write -- previously it stopped there, so a duplicated
    // subject's REVISION carried duplicatedFromSubjectId but its Subject/
    // head doc (this write) silently did not, even though both documents
    // are brand-new in this exact commit (ref.expectedAbsent). Applying it
    // here too makes "find everything derived from subject X" answerable
    // directly from Subject docs, not only by following headRevisionId
    // into Revision history. Only stamped on brand-new subject docs, same
    // as createdByOperationId, never on an update to a pre-existing one.
    if (ref.expectedAbsent && Object.prototype.hasOwnProperty.call(envCtx.duplicationLineageBySubjectId, ref.subjectId)) {
      subjectWriteData.duplicatedFromSubjectId = envCtx.duplicationLineageBySubjectId[ref.subjectId];
    }
    candidateWrites.push({
      kind: ref.recordType,
      path: ref.path,
      data: subjectWriteData
    });
  }

  // Removal-lifecycle writes (Defect #7): prospective termination only --
  // the subject/head pointer transitions; every historical revision it
  // still names remains untouched and unread by this write.
  for (var rw = 0; rw < removedAssignmentRefs.length; rw++) {
    var removedRef = removedAssignmentRefs[rw];
    candidateWrites.push({
      kind: 'planAssignmentSubject',
      path: removedRef.path,
      data: Object.assign({}, planBuildSystemEnvelope('planAssignmentSubject', removedRef.subjectId, envCtx, false), {
        subjectId: removedRef.subjectId,
        lifecycleState: 'removedFromTemplate',
        headRevisionId: removedRef.expectedHeadRevisionId, // last valid revision id; unchanged by removal
        terminationOperationId: ids.operationId,
        terminatedAt: PLAN_SERVER_TIMESTAMP_SENTINEL
      })
    });
  }

  var templateSubjectWriteData = Object.assign({}, planBuildSystemEnvelope('planTemplateSubject', templateId, envCtx, templateSubjectExpectedAbsent), {
    templateId: templateId,
    lifecycleState: 'active',
    headRevisionId: templateRevisionId,
    headSequence: templateSubjectExpectedAbsent ? 1 : (basis.templateSubject.headSequence + 1),
    headManifestId: ids.manifestId,
    headManifestHash: manifestResult.manifest.graphHash,
    // Round-7 review Defect #2: recorded so a FUTURE no-change save against
    // this head can name and verify the exact operation/gateway that
    // produced it, without a second read phase. See priorOperationRef/
    // priorGatewayRef above.
    headOperationId: ids.operationId,
    headGatewayId: ids.gatewayId,
    // Round-9 review Defect #1: recorded so a FUTURE no-change save against
    // this head can re-read and independently recompute every prior
    // manifest chunk's hash, not just trust the manifest root's own stored
    // graphHash. See priorChunkRefs above.
    headManifestChunkIds: manifestResult.manifest.chunkIds,
    // Round-10 review Defect #1: recorded so a FUTURE no-change save against
    // this head can verify the prior operation's deviceId/sessionId against
    // an independent expectation, not merely presence. See
    // basisHeadDeviceIdFor/basisHeadSessionIdFor in validate.js.
    headDeviceId: basis.deviceId,
    headSessionId: basis.sessionId,
    // Round-11 review: recorded so a FUTURE no-change save against this
    // head can verify the prior operation's intentFingerprint and the
    // prior gateway's expectedPredecessorRevisionId against an
    // independent expectation. Neither can be recomputed from current
    // state alone during a no-change re-check (see
    // expectedHeadIntentFingerprint/expectedHeadExpectedPredecessorRevisionId
    // above). headExpectedPredecessorRevisionId intentionally uses the
    // exact same expression as this commit's own gateway write's
    // expectedPredecessorRevisionId below, so the stashed value always
    // matches what THIS commit actually wrote.
    headIntentFingerprint: intentFingerprint,
    headExpectedPredecessorRevisionId: templateSubjectExpectedAbsent ? null : basis.templateSubject.headRevisionId,
    // Round-12 review, option 3 authorized: the write-set hash (below)
    // covers every candidate write of this commit, INCLUDING this very
    // Template subject pointer write -- a genuine circular dependency,
    // since this field's own value IS (derived from) that hash. Resolved
    // with one fixed, deterministic rule: this field always carries the
    // canonical placeholder here, at construction time, and is replaced
    // with the real computed hash immediately after
    // planComputeCanonicalWriteSetHash runs (see below) -- never left as
    // the placeholder in the final candidate write.
    headWriteSetHash: PLAN_HASH_PLACEHOLDER
  });
  // Round-6 Defect #7: the round-5 fix stamped duplicatedFromSubjectId on
  // every duplicated CHILD subject's pointer document, but never on the
  // duplicated Template's OWN subject pointer -- an independent probe
  // confirmed every child carried it while the Template subject pointer
  // did not, even though the Template subject is exactly as much a brand-
  // new duplication target as its children. Same rule as the child-subject
  // loop above: only on a brand-new pointer doc for a subject that is
  // itself a duplication target, never on an update to a pre-existing one.
  if (templateSubjectExpectedAbsent && Object.prototype.hasOwnProperty.call(envCtx.duplicationLineageBySubjectId, templateId)) {
    templateSubjectWriteData.duplicatedFromSubjectId = envCtx.duplicationLineageBySubjectId[templateId];
  }
  // Round-12 review: remembered so the placeholder stamped into
  // templateSubjectWriteData.headWriteSetHash above can be swapped for the
  // real computed hash below, once every other candidate write is known.
  var templateSubjectCandidateIndex = candidateWrites.length;
  candidateWrites.push({
    kind: 'planTemplateSubject',
    path: templateSubjectRef.path,
    data: templateSubjectWriteData
  });
  // Round-6 Defect #7: the round-5 shape omitted several §6 envelope
  // fields this document type has no excuse to skip -- recordId (Identity),
  // sourceKind (Provenance), canonicalEncodingVersion (Integrity),
  // commitState/lifecycleState/gatewayId (Lifecycle) -- and treated
  // clientCreatedAt (Time: unconditional, not "only when applicable") as
  // optional. clientCreatedAt is now required by planBuildTemplateCommitPackage
  // itself (see the planRequire above), so it is always present here too.
  var operationData = {
    recordId: ids.operationId,
    recordType: 'canonicalOperation', schemaVersion: PLAN_SCHEMA_VERSION, ownerDomain: 'plan',
    operationId: ids.operationId, operationType: 'commitPlanTemplateRevision',
    actorUid: basis.actorUid, ownerUid: ownerUid, templateId: templateId, intentFingerprint: intentFingerprint,
    clientSchemaGeneration: basis.clientSchemaGeneration,
    authorityKind: envCtx.authorityKind, authorityScope: envCtx.authorityScope, authorityBasisRefs: envCtx.authorityBasisRefs,
    sourceKind: 'planEditorCommit',
    // Round-7 review Defect #6: sourceRefs (Provenance) and effectiveBoundary
    // (Time) were previously omitted here too.
    sourceRefs: [],
    effectiveBoundary: 'immediate',
    canonicalEncodingVersion: PLAN_CANONICAL_ENCODING_VERSION,
    commitState: 'committed',
    lifecycleState: 'active',
    gatewayId: ids.gatewayId,
    outcome: 'committed', committedAt: PLAN_SERVER_TIMESTAMP_SENTINEL,
    clientCreatedAt: basis.clientCreatedAt,
    // Round-9 review Defect #3: deviceId/sessionId are now required by the
    // planRequire calls above, so they are always genuinely present here --
    // never a fabricated placeholder, never silently dropped.
    deviceId: basis.deviceId,
    sessionId: basis.sessionId
  };
  candidateWrites.push({ kind: 'canonicalOperation', path: readPlan.operationRef.path, data: operationData });

  // Required deterministic projection write (Defect #13: not optional).
  // Built and pushed BEFORE the gateway write so it is included in the
  // gateway's write-set hash below (Defect #5).
  var templateNodeForProjection = graph.nodes.filter(function (n) { return n.subjectId === templateId; })[0];
  candidateWrites.push({
    kind: 'planTemplateSummary',
    path: projectionRef.path,
    data: Object.assign({}, planBuildSystemEnvelope('planTemplateSummary', templateId, envCtx, true), {
      templateId: templateId,
      name: templateNodeForProjection.semanticPayload.name || null,
      description: templateNodeForProjection.semanticPayload.description || null,
      structureLabel: templateNodeForProjection.semanticPayload.structureLabel || null,
      assignmentCount: Object.keys(currentAssignmentSubjectIds).length,
      // Round-7 review Defect #6: the round-6 shape above carried only
      // lifecycleLabel (this projection's own pre-existing display field,
      // kept unchanged for whatever reads it today) -- lifecycleState
      // itself, the canonical §6 Lifecycle field group's field name every
      // other document type in this file stamps, was never added
      // alongside it.
      lifecycleLabel: 'active',
      lifecycleState: 'active',
      headRevisionId: templateRevisionId,
      sourceTemplateHeadRevisionId: templateRevisionId,
      sourceRevisionId: templateRevisionId,
      sourceGatewayId: ids.gatewayId,
      derivationVersion: 1,
      freshnessCheckpoint: PLAN_SERVER_TIMESTAMP_SENTINEL,
      rebuildMethod: 'commitSynchronousProjection'
    })
  });

  // Round-4 source review Defect #5: the commit gateway must bind the
  // complete deterministic write-set hash (§13) -- computed over every
  // candidate write built so far (revisions, subject/head docs, removal
  // writes, Template subject, manifest, chunks, operation, projection),
  // excluding only the gateway document's own not-yet-existing entry.
  // Round-12 review: this is now the SOLE call site of
  // planComputeCanonicalWriteSetHash -- see its own comment for why the
  // algorithm lives in exactly one place, and how it handles the Template
  // subject write's self-referential headWriteSetHash field.
  var writeSetHash = planComputeCanonicalWriteSetHash(candidateWrites);

  // The Template subject pointer's own write carried the placeholder
  // purely so it could be included in the hash computation just run --
  // now that the real hash is known, replace the placeholder with it in
  // the final candidate write. Build a fresh write object rather than
  // mutate the existing one (candidateWrites is not yet frozen at this
  // point, but nothing else in this file ever mutates a candidate write
  // object in place, and this keeps that invariant unbroken).
  candidateWrites[templateSubjectCandidateIndex] = {
    kind: 'planTemplateSubject',
    path: templateSubjectRef.path,
    data: Object.assign({}, templateSubjectWriteData, { headWriteSetHash: writeSetHash })
  };

  // Round-6 Defect #7: same envelope-completeness gap as the operation
  // write above -- recordId, clientSchemaGeneration (Authority),
  // createdByOperationId/sourceKind (Provenance: the gateway genuinely IS
  // created by this operation, unlike the operation's own self-referential
  // case), canonicalEncodingVersion (Integrity), commitState/lifecycleState
  // (Lifecycle), and clientCreatedAt (Time) were all previously omitted.
  candidateWrites.push({
    kind: 'planCommitGateway',
    path: readPlan.gatewayRef.path,
    data: {
      recordId: ids.gatewayId,
      recordType: 'planCommitGateway', schemaVersion: PLAN_SCHEMA_VERSION, ownerDomain: 'plan',
      gatewayId: ids.gatewayId, ownerUid: ownerUid, templateId: templateId, templateRevisionId: templateRevisionId,
      manifestId: ids.manifestId, manifestHash: manifestResult.manifest.graphHash,
      operationId: ids.operationId, actorUid: basis.actorUid,
      authorityKind: envCtx.authorityKind, authorityScope: envCtx.authorityScope, authorityBasisRefs: envCtx.authorityBasisRefs,
      clientSchemaGeneration: basis.clientSchemaGeneration,
      createdByOperationId: ids.operationId,
      sourceKind: 'planEditorCommit',
      // Round-7 review Defect #6: sourceRefs (Provenance) previously omitted.
      sourceRefs: [],
      canonicalEncodingVersion: PLAN_CANONICAL_ENCODING_VERSION,
      commitState: 'committed',
      lifecycleState: 'active',
      expectedPredecessorRevisionId: templateSubjectExpectedAbsent ? null : basis.templateSubject.headRevisionId,
      writeSetHash: writeSetHash,
      effectiveBoundary: 'immediate', committedAt: PLAN_SERVER_TIMESTAMP_SENTINEL,
      clientCreatedAt: basis.clientCreatedAt
    }
  });

  } else {
    // Round-6 Defect #2: genuine no-op -- no candidate writes, so the
    // write-set hash is simply the hash of an empty write set. Nothing
    // downstream (there is no gateway write in this branch) ever reads
    // this value, but pkg.writeSetHash is kept a well-defined sha256 hex
    // string either way rather than left undefined. Round-12 review: routed
    // through the same shared function as the real-write path, rather than
    // a separately hand-written empty-array hash, per "do not duplicate the
    // hashing algorithm across multiple call sites" -- candidateWrites is
    // genuinely [] here, so this produces the identical result either way.
    writeSetHash = planComputeCanonicalWriteSetHash(candidateWrites);
  }

  Object.freeze(candidateWrites);
  for (var w = 0; w < candidateWrites.length; w++) Object.freeze(candidateWrites[w]);

  // Round-7 review Defect #5: "candidate writes agree with validated
  // lineage" -- an internal self-consistency check, not a user-input
  // validation (the two write call sites above already read from this
  // exact validated map, so a mismatch here would mean a code defect, not
  // a bad draft). Checked both directions: every subject the validated
  // lineage graph names has a candidate write actually carrying its
  // duplicatedFromSubjectId, and no candidate write carries a
  // duplicatedFromSubjectId the validated graph never approved.
  var lineageSubjectIds = Object.keys(duplicationLineageBySubjectId);
  if (lineageSubjectIds.length > 0) {
    var lineagePathBySubjectId = {};
    lineagePathBySubjectId[templateId] = templateSubjectRef.path;
    for (var lp = 0; lp < childSubjectRefs.length; lp++) lineagePathBySubjectId[childSubjectRefs[lp].subjectId] = childSubjectRefs[lp].path;
    for (var lsi = 0; lsi < lineageSubjectIds.length; lsi++) {
      var lSubjectId = lineageSubjectIds[lsi];
      var lWrite = null;
      for (var lw = 0; lw < candidateWrites.length; lw++) {
        if (candidateWrites[lw].path === lineagePathBySubjectId[lSubjectId]) { lWrite = candidateWrites[lw]; break; }
      }
      planRequire(lWrite, 'internal error: validated duplication lineage names subject ' + lSubjectId + ' but no candidate write targets its subject-pointer path (round-7 Defect #5 consistency check)');
      planRequire(lWrite.data.duplicatedFromSubjectId === duplicationLineageBySubjectId[lSubjectId],
        'internal error: candidate write for subject ' + lSubjectId + ' does not carry the validated duplicatedFromSubjectId (round-7 Defect #5 consistency check)');
    }
  }
  for (var cw = 0; cw < candidateWrites.length; cw++) {
    var cwData = candidateWrites[cw].data;
    if (cwData && Object.prototype.hasOwnProperty.call(cwData, 'duplicatedFromSubjectId')) {
      // subjectId (when present) names the subject this document is ABOUT;
      // recordId names the document's OWN identity, which for a Revision
      // write is its revisionId, not its subject -- subjectId must win
      // whenever both are present (every revision write carries both).
      var cwSubjectId = cwData.subjectId !== undefined ? cwData.subjectId : cwData.recordId;
      planRequire(
        Object.prototype.hasOwnProperty.call(duplicationLineageBySubjectId, cwSubjectId) &&
        duplicationLineageBySubjectId[cwSubjectId] === cwData.duplicatedFromSubjectId,
        'internal error: candidate write for ' + cwSubjectId + ' carries a duplicatedFromSubjectId the validated lineage graph does not approve (round-7 Defect #5 consistency check)'
      );
    }
  }

  // Round-4 source review Defect #3: a final cross-write duplicate-path
  // scan across the COMPLETE candidate write set. Any two writes that
  // would target the same document path must block this attempt from
  // ever being released as a package -- never rely on Firestore or a
  // later transaction adapter to discover a collision.
  var seenWritePaths = {};
  for (var dw = 0; dw < candidateWrites.length; dw++) {
    var dwPath = candidateWrites[dw].path;
    if (seenWritePaths[dwPath]) {
      return {
        ok: false,
        blockReason: 'duplicateTargetPath',
        details: { path: dwPath, kinds: [seenWritePaths[dwPath], candidateWrites[dw].kind] }
      };
    }
    seenWritePaths[dwPath] = candidateWrites[dw].kind;
  }

  // ---- V1 safety cap estimation (§12). A cap violation blocks here,
  // before any read or write, with the draft and any already-built package
  // left untouched by the caller (this function never mutates anything).
  var estimatedRequestBytes = 0;
  var oversizedDoc = null;
  for (var d = 0; d < candidateWrites.length; d++) {
    var docBytes = planEstimateDocBytes(candidateWrites[d].data);
    estimatedRequestBytes += docBytes;
    if (docBytes > PLAN_V1_SAFETY_CAPS.maxCanonicalDocumentBytes && !oversizedDoc) {
      oversizedDoc = { path: candidateWrites[d].path, bytes: docBytes };
    }
  }
  if (oversizedDoc) {
    return {
      ok: false,
      blockReason: 'graphRequiresPreparedCommit',
      details: { reason: 'canonicalDocumentExceedsCap', oversizedDoc: oversizedDoc, cap: PLAN_V1_SAFETY_CAPS.maxCanonicalDocumentBytes }
    };
  }
  if (candidateWrites.length > PLAN_V1_SAFETY_CAPS.maxTransactionWrites) {
    return {
      ok: false,
      blockReason: 'graphRequiresPreparedCommit',
      details: { reason: 'writeCountExceedsCap', writeCount: candidateWrites.length, cap: PLAN_V1_SAFETY_CAPS.maxTransactionWrites }
    };
  }
  if (estimatedRequestBytes > PLAN_V1_SAFETY_CAPS.maxEstimatedRequestBytes) {
    return {
      ok: false,
      blockReason: 'graphRequiresPreparedCommit',
      details: { reason: 'requestSizeExceedsCap', estimatedRequestBytes: estimatedRequestBytes, cap: PLAN_V1_SAFETY_CAPS.maxEstimatedRequestBytes }
    };
  }

  var pkg = {
    // Round-6 Defect #7: spec Sec.10's "Operation" package component names
    // actor/device/session provenance and creation time as required frozen
    // content -- the round-5 shape's pkg.operation carried neither.
    // clientCreatedAt, deviceId, and sessionId are now all unconditional
    // (see the planRequire calls above -- round-9 review Defect #3 closed
    // the last gap here).
    operation: {
      operationId: ids.operationId,
      operationType: 'commitPlanTemplateRevision',
      actorUid: basis.actorUid,
      clientSchemaGeneration: basis.clientSchemaGeneration,
      authorityKind: envCtx.authorityKind,
      authorityScope: envCtx.authorityScope,
      authorityBasisRefs: envCtx.authorityBasisRefs,
      clientCreatedAt: basis.clientCreatedAt,
      deviceId: basis.deviceId,
      sessionId: basis.sessionId
    },
    intent: {
      templateId: templateId,
      newTemplateRevisionId: templateRevisionId,
      expectedHeadRevisionId: templateSubjectExpectedAbsent ? null : basis.templateSubject.headRevisionId,
      expectedHeadSequence: templateSubjectExpectedAbsent ? null : basis.templateSubject.headSequence,
      graphHash: manifestResult.manifest.graphHash,
      intentFingerprint: intentFingerprint,
      commitMode: ids.commitMode || 'standard'
    },
    graph: {
      manifest: manifestResult.manifest,
      chunks: manifestResult.chunks,
      entries: manifestResult.entries,
      revisionsBySubjectId: manifestResult.revisionsBySubjectId
    },
    readPlan: readPlan,
    candidateWrites: candidateWrites,
    writeSetHash: writeSetHash,
    // Round-6 Defect #2: explicit, inspectable flag for "this attempt's
    // graph is byte-identical to what is already committed, so
    // candidateWrites is genuinely empty by design" -- see the comment
    // where this is computed, above. A future transaction driver checks
    // this BEFORE ever opening a transaction, exactly like it already must
    // check an 'alreadyCommitted' validation result.
    noChangeToCommit: noChangeToCommit,
    estimatedRequestBytes: estimatedRequestBytes,
    ownerUid: ownerUid,
    gatewayId: ids.gatewayId
  };

  // Defect #4: deep-freeze the complete package at every nested level, not
  // just its top-level fields.
  planDeepFreeze(pkg);

  return { ok: true, package: pkg };
}

// ---- 07-validate.js ----
// planValidateTemplateCommitReads(package, docs)
//
// Pure validation of the EXACT frozen candidate set named by a commitment
// package's read plan (§11). This function never recomputes what should be
// read from appDb or any mutable state -- it only looks at `docs`, the
// caller-supplied results of having read exactly the paths in
// package.readPlan. It also never widens or narrows that candidate set:
// every planned read must be explicitly represented in `docs` (present,
// even if its value is null meaning "confirmed absent"); a slot that is
// simply missing from `docs` is a missing planned read and blocks, and any
// extra/unplanned document handed in beyond what the plan named is ignored
// entirely -- it can never supply evidence of absence or presence for
// anything not planned (§9, §14, §20).
//
// Corrects the prior slice's Defect #8 (schema-authority absence used to
// permit commitment; now it blocks), Defect #9 (validation coverage was
// incomplete: reused-revision integrity now checks both payload AND
// dependency hashes, and the expanded read plan's new collision/removal
// targets are all validated here), and Defect #6 (every new deterministic
// target named by the expanded read plan -- manifest root, chunks,
// projection -- is validated for presence, per the "missing planned read
// blocks" rule).
//
// Round-4 source review corrections (Defect #2, #4) implemented in this
// file:
//   - every returned result (proceed / alreadyCommitted / blocked) is now
//     deeply frozen (Defect #2);
//   - reused-revision payload/dependency hashes are recomputed from the
//     ACTUAL field values on the read document rather than trusted from a
//     stored hash field, and cross-checked against the document's own
//     self-claimed hash (Defect #4);
//   - dependencyRefs presence is now required unconditionally, not
//     checked only when the field happens to exist (Defect #4);
//   - every subject/revision document read (Template subject, child
//     subjects, reused revisions, predecessor revisions) now has its
//     recordType, ownerUid, subjectId/revisionId identity, and
//     lifecycleState validated, not just its head pointer (Defect #4);
//   - the Template subject's headManifestId/headManifestHash are now
//     validated for agreement, not only headRevisionId/headSequence
//     (Defect #4);
//   - actor authority is now validated: owner authority requires the
//     actor and owner to agree; delegated authority requires a non-empty
//     frozen authority basis (Defect #4);
//   - the already-committed idempotent-retry path now cross-checks the
//     complete gateway/operation/Template/manifest/authority/write-set
//     agreement, not just two IDs (Defect #4);
//   - exact predecessor revisions named by the package's new
//     predecessorRevisionRefs are read and validated (Defect #4).
//
// docs = {
//   schemaAuthority:      doc | null,
//   operation:            doc | null,
//   templateSubject:      doc | null,
//   childSubjects:        { [subjectId]: doc | null },  // one entry per package.readPlan.childSubjectRefs
//   reusedRevisions:      { [subjectId]: doc | null },  // one entry per package.readPlan.reusedRevisionRefs
//   newRevisionTargets:   { [subjectId]: doc | null },  // one entry per package.readPlan.newRevisionTargetRefs
//   predecessorRevisions: { [subjectId]: doc | null },  // one entry per package.readPlan.predecessorRevisionRefs
//   removedAssignments:   { [subjectId]: doc | null },  // one entry per package.readPlan.removedAssignmentRefs
//   manifestRoot:         doc | null,
//   chunkTargets:         { [chunkId]: doc | null },    // one entry per package.readPlan.chunkRefs
//   projectionTarget:     doc | null,                   // always read; never blocks by content
//   gatewayTarget:        doc | null
// }
//
// Returns exactly one of (each deeply frozen):
//   { result: 'proceed' }
//   { result: 'alreadyCommitted', outcome: {...} }
//   { result: 'blocked', blockReason: string, details: {...} }
//
// It produces no side effects and enqueues nothing; write-plan construction
// happens only afterward, in planBuildTemplateCommitWrites, and only for a
// 'proceed' (or, for the explicit zero-write case, 'alreadyCommitted')
// result.

function planBlocked(reason, details) {
  return planDeepFreeze({ result: 'blocked', blockReason: reason, details: details || {} });
}

// Round-7 review Defect #7: planBuildTemplateCommitWrites previously
// trusted ANY object shaped like { result: 'proceed' } (or 'alreadyCommitted'
// / 'noChange'), regardless of whether planValidateTemplateCommitReads had
// actually produced it for THIS package -- an independent probe supplied a
// hand-constructed { result: 'proceed' } with no validation call at all and
// every candidate write released unchecked. This file has no server-side
// secret a pure function could sign with (there is no persistence layer, no
// session, nothing but the package and the documents passed in), so the
// binding this can genuinely provide is a content fingerprint: a hash over
// exactly the package fields planBuildTemplateCommitWrites itself trusts
// (operation/gateway/template identity, the complete write-set hash, the
// intent fingerprint, and whether this is the zero-write no-change case)
// together with the declared result kind and outcome. A validation result
// actually produced by calling planValidateTemplateCommitReads(pkg, docs)
// carries a proof that recomputes to itself; a hand-typed result has no
// proof field at all; a real proof copied onto a DIFFERENT package (or a
// mutated outcome under an unchanged proof) recomputes to a different
// value, because the recomputation always uses the package and validation
// object actually being released, never the ones the proof was minted
// against. This does not defend against an adversary willing to read this
// source and recompute the same public hash -- nothing in a secretless
// pure function can -- it defends against exactly the failure mode the
// probe demonstrated: code that skips or diverges from the real validation
// call and releases writes anyway.
function planComputeCommitProof(pkg, resultKind, outcome) {
  return planSha256Hex(planBuildCanonicalEncoding({
    operationId: pkg.operation.operationId,
    gatewayId: pkg.gatewayId,
    templateId: pkg.intent.templateId,
    templateRevisionId: pkg.intent.newTemplateRevisionId,
    intentFingerprint: pkg.intent.intentFingerprint,
    writeSetHash: pkg.writeSetHash,
    noChangeToCommit: pkg.noChangeToCommit,
    resultKind: resultKind,
    outcome: outcome || null
  }));
}

function planHasSlot(map, key) {
  return !!map && Object.prototype.hasOwnProperty.call(map, key);
}

// Round-7 review Defect #3: every existing canonical document read for
// validation must carry a complete applicable Common Canonical Envelope
// (spec Sec.6), not just the identity/ownership/lifecycle/content-hash
// fields each specific check already validates. An independent probe
// supplied documents missing every envelope field beyond a handful of
// identity fields and they still validated to proceed.
//
// SCOPE: this checks the fields that are ATTEMPT-INVARIANT -- true for
// every commit regardless of which operation produced the document -- so
// no extra historical-basis data is required to know the correct expected
// value (schemaVersion, ownerDomain, canonicalEncodingVersion, commitState,
// sourceKind are always the same constant; clientSchemaGeneration/
// authorityKind/authorityBasisRefs/actorUid/committedAt/provenance-operation-id
// are checked for PRESENCE and correct shape, proving they were actually
// stamped, not fabricated as empty). Historical actor/provenance fields
// are attempt-SPECIFIC (a different value on every real commit) and this
// pure function has no independent record of what a given PRIOR commit's
// actual actorUid/authorityKind truly was beyond what basis already
// threads through for content (payloadHash/dependencyHash via
// priorRevisionsBySubjectId) -- validating those against a frozen
// historical expectation would require threading a parallel expected-
// envelope shape through basis for every prior revision and head, which
// is a further extension not made in this round; see the round-7 report.
function planEnvelopeCompletenessReason(doc, provenanceField) {
  if (doc.schemaVersion !== PLAN_SCHEMA_VERSION) return 'schemaVersionMissingOrWrong';
  if (doc.ownerDomain !== 'plan') return 'ownerDomainMissingOrWrong';
  if (doc.canonicalEncodingVersion !== PLAN_CANONICAL_ENCODING_VERSION) return 'canonicalEncodingVersionMissingOrWrong';
  if (doc.commitState !== 'committed') return 'commitStateMissingOrWrong';
  if (doc.sourceKind !== 'planEditorCommit') return 'sourceKindMissingOrWrong';
  if (!Array.isArray(doc.sourceRefs)) return 'sourceRefsMissing';
  if (typeof doc.clientSchemaGeneration !== 'number') return 'clientSchemaGenerationMissing';
  if (!doc.authorityKind) return 'authorityKindMissing';
  if (!Array.isArray(doc.authorityBasisRefs)) return 'authorityBasisRefsMissing';
  if (!doc.actorUid) return 'actorUidMissing';
  if (doc.committedAt === undefined || doc.committedAt === null) return 'committedAtMissing';
  if (!doc[provenanceField]) return provenanceField + 'Missing';
  return null;
}

// Round-9 review Defect #2: compares an ACTUALLY READ document's historical
// fields against an INDEPENDENTLY FROZEN expectedEnvelope (see
// planRequireExpectedEnvelope above for how that expectation is sourced and
// required at package-build time -- always from the caller's own record of
// the real prior commit, never derived from the document being checked
// here). Returns null when every checked field agrees, or a specific
// *HistoricalMismatch reason naming exactly which field disagreed. This
// runs IN ADDITION to planEnvelopeCompletenessReason (presence/shape),
// never instead of it -- a document can be complete-and-well-shaped while
// still lying about what its historical fields actually were.
function planHistoricalEnvelopeMismatchReason(doc, expectedEnvelope, provenanceField) {
  if (!expectedEnvelope) return 'expectedEnvelopeMissing';
  if (doc.ownerUid !== expectedEnvelope.ownerUid) return 'ownerUidHistoricalMismatch';
  if (doc.actorUid !== expectedEnvelope.actorUid) return 'actorUidHistoricalMismatch';
  if (doc.authorityKind !== expectedEnvelope.authorityKind) return 'authorityKindHistoricalMismatch';
  if (doc.authorityScope !== expectedEnvelope.authorityScope) return 'authorityScopeHistoricalMismatch';
  if (!planDeepEqual(doc.authorityBasisRefs, expectedEnvelope.authorityBasisRefs)) return 'authorityBasisRefsHistoricalMismatch';
  if (doc.clientSchemaGeneration !== expectedEnvelope.clientSchemaGeneration) return 'clientSchemaGenerationHistoricalMismatch';
  if (doc[provenanceField] !== expectedEnvelope.provenanceOperationId) return provenanceField + 'HistoricalMismatch';
  if (doc.sourceKind !== expectedEnvelope.sourceKind) return 'sourceKindHistoricalMismatch';
  if (!planDeepEqual(doc.sourceRefs, expectedEnvelope.sourceRefs)) return 'sourceRefsHistoricalMismatch';
  if (doc.clientCreatedAt !== expectedEnvelope.clientCreatedAt) return 'clientCreatedAtHistoricalMismatch';
  if (doc.effectiveBoundary !== expectedEnvelope.effectiveBoundary) return 'effectiveBoundaryHistoricalMismatch';
  if (doc.commitState !== expectedEnvelope.commitState) return 'commitStateHistoricalMismatch';
  if (doc.lifecycleState !== expectedEnvelope.lifecycleState) return 'lifecycleStateHistoricalMismatch';
  if (doc.canonicalEncodingVersion !== expectedEnvelope.canonicalEncodingVersion) return 'canonicalEncodingVersionHistoricalMismatch';
  return null;
}

// Round-4 Defect #4: recompute a reused revision's actual semantic payload
// from the read document's own field values, rather than trusting a
// stored hash. Real Firestore documents spread semantic fields at the top
// level, mixed with envelope fields -- there is no nested "semanticPayload"
// sub-object in the actual stored shape -- so this extracts exactly the
// key set the package's own expectation names, and nothing else. A
// document that is missing those fields (e.g. an adversarial document
// containing only hash strings) yields an incomplete/empty extraction,
// whose hash will not match the expected payload hash.
function planExtractSemanticSubset(doc, expectedSemanticPayload) {
  var keys = Object.keys(expectedSemanticPayload || {});
  var out = {};
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (doc && Object.prototype.hasOwnProperty.call(doc, k) && doc[k] !== undefined) {
      out[k] = doc[k];
    }
  }
  return out;
}

function planValidateTemplateCommitReads(pkg, docs) {
  if (!pkg || typeof pkg !== 'object' || !pkg.readPlan) {
    throw new Error('planValidateTemplateCommitReads: package with a readPlan is required');
  }
  if (!docs || typeof docs !== 'object') {
    throw new Error('planValidateTemplateCommitReads: docs is required');
  }

  // Round-7 review Defect #2: prior operation/gateway ids used by the
  // no-change verification (step 10, below) are not carried as their own
  // readPlan fields (only the paths derived from them are, in
  // priorOperationRef/priorGatewayRef) -- derive them from the
  // already-read docs.templateSubject, once step 3 below has proved it is
  // the real, non-stale current head, rather than trusting closure state a
  // second, redundant way.
  function basisHeadOperationIdFor(docsArg) {
    return docsArg.templateSubject ? docsArg.templateSubject.headOperationId : null;
  }
  function basisHeadGatewayIdFor(docsArg) {
    return docsArg.templateSubject ? docsArg.templateSubject.headGatewayId : null;
  }
  // Round-10 review Defect #1 (adversarially reverified): UNLIKE
  // headOperationId/headGatewayId above, deviceId/sessionId are never baked
  // into any hash, so reading them straight off docs.templateSubject here
  // would only prove they agree with THEMSELVES (the same untrusted read
  // bundle checked against the same read bundle) -- not with anything the
  // caller independently knew in advance. These instead come from
  // readPlan.templateSubjectRef.expectedHeadDeviceId/expectedHeadSessionId
  // (frozen from the caller's own basis.templateSubject at package-build
  // time), which step 3 above has already cross-checked against the real
  // read docs.templateSubject -- so by the time step 10 runs, using either
  // source is equal, but the closure value is the one actually anchored to
  // independent caller-supplied truth.

  var readPlan = pkg.readPlan;

  // ---- 0. Every planned read must be present in docs (missing planned
  // read blocks; §9/§20).
  if (!planHasSlot(docs, 'schemaAuthority')) return planBlocked('missingPlannedRead', { slot: 'schemaAuthority' });
  if (!planHasSlot(docs, 'operation')) return planBlocked('missingPlannedRead', { slot: 'operation' });
  if (!planHasSlot(docs, 'templateSubject')) return planBlocked('missingPlannedRead', { slot: 'templateSubject' });
  if (!planHasSlot(docs, 'gatewayTarget')) return planBlocked('missingPlannedRead', { slot: 'gatewayTarget' });
  if (!planHasSlot(docs, 'manifestRoot')) return planBlocked('missingPlannedRead', { slot: 'manifestRoot' });
  if (!planHasSlot(docs, 'projectionTarget')) return planBlocked('missingPlannedRead', { slot: 'projectionTarget' });
  if (readPlan.priorManifestRootRef && !planHasSlot(docs, 'priorManifest')) return planBlocked('missingPlannedRead', { slot: 'priorManifest' });
  if (readPlan.priorOperationRef && !planHasSlot(docs, 'priorOperation')) return planBlocked('missingPlannedRead', { slot: 'priorOperation' });
  if (readPlan.priorGatewayRef && !planHasSlot(docs, 'priorGateway')) return planBlocked('missingPlannedRead', { slot: 'priorGateway' });
  // Round-9 review Defect #1: every planned prior manifest chunk read is
  // required too, exactly like every other planned-read category above --
  // a no-change attempt whose caller simply never supplied the chunk
  // documents must block, not silently skip chunk verification.
  var priorManifestChunksSlot = docs.priorManifestChunks || {};
  for (var pcsi = 0; pcsi < readPlan.priorChunkRefs.length; pcsi++) {
    if (!planHasSlot(priorManifestChunksSlot, readPlan.priorChunkRefs[pcsi].chunkId)) {
      return planBlocked('missingPlannedRead', { slot: 'priorManifestChunks', chunkId: readPlan.priorChunkRefs[pcsi].chunkId });
    }
  }
  // Round-9 review Defect #5: every planned duplication-source read is
  // required too, exactly like every other planned-read category -- a
  // duplication attempt whose caller never supplied the source documents
  // must block, not silently skip source-identity verification.
  var duplicationSourcesSlot = docs.duplicationSources || {};
  for (var dsi = 0; dsi < readPlan.duplicationSourceRefs.length; dsi++) {
    if (!planHasSlot(duplicationSourcesSlot, readPlan.duplicationSourceRefs[dsi].newSubjectId)) {
      return planBlocked('missingPlannedRead', { slot: 'duplicationSources', newSubjectId: readPlan.duplicationSourceRefs[dsi].newSubjectId });
    }
  }

  var childSubjects = docs.childSubjects || {};
  for (var ci = 0; ci < readPlan.childSubjectRefs.length; ci++) {
    var cref = readPlan.childSubjectRefs[ci];
    if (!planHasSlot(childSubjects, cref.subjectId)) {
      return planBlocked('missingPlannedRead', { slot: 'childSubjects', subjectId: cref.subjectId });
    }
  }
  var reusedRevisions = docs.reusedRevisions || {};
  for (var ri = 0; ri < readPlan.reusedRevisionRefs.length; ri++) {
    var rref = readPlan.reusedRevisionRefs[ri];
    if (!planHasSlot(reusedRevisions, rref.subjectId)) {
      return planBlocked('missingPlannedRead', { slot: 'reusedRevisions', subjectId: rref.subjectId });
    }
  }
  var newRevisionTargets = docs.newRevisionTargets || {};
  for (var ni = 0; ni < readPlan.newRevisionTargetRefs.length; ni++) {
    var nref = readPlan.newRevisionTargetRefs[ni];
    if (!planHasSlot(newRevisionTargets, nref.subjectId)) {
      return planBlocked('missingPlannedRead', { slot: 'newRevisionTargets', subjectId: nref.subjectId });
    }
  }
  var predecessorRevisions = docs.predecessorRevisions || {};
  for (var pdi0 = 0; pdi0 < readPlan.predecessorRevisionRefs.length; pdi0++) {
    var pdref0 = readPlan.predecessorRevisionRefs[pdi0];
    if (!planHasSlot(predecessorRevisions, pdref0.subjectId)) {
      return planBlocked('missingPlannedRead', { slot: 'predecessorRevisions', subjectId: pdref0.subjectId });
    }
  }
  var removedAssignments = docs.removedAssignments || {};
  for (var mi = 0; mi < readPlan.removedAssignmentRefs.length; mi++) {
    var mref = readPlan.removedAssignmentRefs[mi];
    if (!planHasSlot(removedAssignments, mref.subjectId)) {
      return planBlocked('missingPlannedRead', { slot: 'removedAssignments', subjectId: mref.subjectId });
    }
  }
  var chunkTargets = docs.chunkTargets || {};
  for (var chi = 0; chi < readPlan.chunkRefs.length; chi++) {
    var chref = readPlan.chunkRefs[chi];
    if (!planHasSlot(chunkTargets, chref.chunkId)) {
      return planBlocked('missingPlannedRead', { slot: 'chunkTargets', chunkId: chref.chunkId });
    }
  }

  // ---- 1. Schema authority (Defect #8: absence/malformation now blocks
  // rather than permitting unrestricted commitment). A present authority
  // doc must declare a numeric minimumAuthoritativeWriterGeneration and an
  // enabledCapabilities object; anything else is malformed. An unsupported
  // client generation, or a capability that is missing/disabled, blocks.
  if (!docs.schemaAuthority) {
    return planBlocked('schemaAuthorityMissing', {});
  }
  var authority = docs.schemaAuthority;
  var authorityMalformed =
    typeof authority.minimumAuthoritativeWriterGeneration !== 'number' ||
    !authority.enabledCapabilities ||
    typeof authority.enabledCapabilities !== 'object';
  if (authorityMalformed) {
    return planBlocked('schemaAuthorityMalformed', {});
  }
  if (pkg.operation.clientSchemaGeneration < authority.minimumAuthoritativeWriterGeneration) {
    return planBlocked('unsupportedSchemaGeneration', {
      clientSchemaGeneration: pkg.operation.clientSchemaGeneration,
      minimumRequired: authority.minimumAuthoritativeWriterGeneration
    });
  }
  if (authority.enabledCapabilities.commitPlanTemplateRevision !== true) {
    return planBlocked('writerCapabilityDisabled', { capability: 'commitPlanTemplateRevision' });
  }

  // ---- 1.5. Actor authority (round-4 Defect #4; round-6 Defect #5). An
  // actor different from ownerUid claiming owner authority has no authority
  // basis and must not proceed. Delegated authority is a DIFFERENT matter:
  // the round-5 shape treated any nonempty authorityBasisRefs array as
  // sufficient, without ever reading or validating what those references
  // actually point to -- an independent probe supplied
  // authorityBasisRefs: ['unread/fake/ref'] for a nonexistent delegate and
  // it proceeded. A nonempty array of unvalidated strings is not authority.
  // Genuinely validating delegated authority would require a real
  // authority-basis record type (actor, owner, kind, scope, capability,
  // effective lifecycle) named in the read plan and read before validation
  // -- but the approved spec's exact V1 collection mapping (§4) defines no
  // such collection at all (no planAuthorityGrants or equivalent). There is
  // nothing this pure function could read and check a delegated grant
  // against. Rather than half-validate an unbacked concept, V1 explicitly
  // supports owner-only commitment and rejects delegated authority outright.
  // A later slice that adds a real authority-basis record type to the
  // spec's collection mapping can replace this outright rejection with
  // genuine frozen-read validation.
  if (pkg.operation.authorityKind === 'owner') {
    if (pkg.operation.actorUid !== pkg.ownerUid) {
      return planBlocked('actorAuthorityInvalid', {
        reason: 'ownerAuthorityActorMismatch',
        actorUid: pkg.operation.actorUid,
        ownerUid: pkg.ownerUid
      });
    }
  } else {
    return planBlocked('actorAuthorityInvalid', {
      reason: 'delegatedAuthorityUnsupported',
      authorityKind: pkg.operation.authorityKind
    });
  }

  // ---- 2. Operation idempotency (§10, §13, §20).
  if (docs.operation) {
    var existingOp = docs.operation;
    if (existingOp.intentFingerprint !== pkg.intent.intentFingerprint) {
      return planBlocked('operationIdentityConflict', {
        operationId: pkg.operation.operationId,
        existingFingerprint: existingOp.intentFingerprint,
        attemptedFingerprint: pkg.intent.intentFingerprint
      });
    }
    // Same fingerprint: this is a retry of the same attempt.
    if (existingOp.outcome === 'committed') {
      // Round-4 Defect #4 checked only two IDs on the gateway document.
      // Round-6 Defect #6: even that fuller check still let a matching
      // intentFingerprint (itself only a hash over a handful of composed
      // fields, checked above) stand in for the REST of the operation and
      // gateway documents' own plain fields. An independent probe supplied
      // a committed operation with the right fingerprint but a wrong
      // recordType/operationId/ownerUid/actorUid/templateId, and a gateway
      // with the right checked fields but a wrong templateId/actor/
      // authorityScope/authorityBasisRefs -- and it still returned
      // alreadyCommitted. A matching fingerprint alone must never excuse
      // malformed canonical operation/gateway data; every plain identity,
      // ownership, authority, and outcome field on BOTH documents must
      // independently agree with what this package expects.
      var gw = docs.gatewayTarget;
      // Round-7 review Defect #4: the round-6 field list above still left
      // an independent probe able to supply operation/gateway documents
      // that were missing entire envelope sections (provenance, schema/
      // encoding version, commit/lifecycle state, effective boundary,
      // timing) and still pass -- because none of those fields were ever
      // read here, a matching subset was accepted as if it were the whole
      // document. Every plain field either write actually stamps (see
      // operationData/the gateway write above) is now checked, so a
      // truncated or malformed already-committed document blocks instead
      // of silently confirming success. committedAt is a server-stamped
      // value this attempt never itself produces (PLAN_SERVER_TIMESTAMP_
      // SENTINEL only marks where the server fills it in) so it is checked
      // for presence, not equality; clientCreatedAt is caller-supplied and
      // NOT part of intentFingerprint's source (see intentFingerprintSource
      // above), so it is a genuine independent equality check, not a
      // restatement of the fingerprint match already done above.
      var operationFullyAgrees =
        existingOp.recordId === existingOp.operationId &&
        existingOp.recordType === 'canonicalOperation' &&
        existingOp.schemaVersion === PLAN_SCHEMA_VERSION &&
        existingOp.ownerDomain === 'plan' &&
        existingOp.operationId === pkg.operation.operationId &&
        existingOp.operationType === pkg.operation.operationType &&
        existingOp.ownerUid === pkg.ownerUid &&
        existingOp.actorUid === pkg.operation.actorUid &&
        existingOp.templateId === pkg.intent.templateId &&
        existingOp.clientSchemaGeneration === pkg.operation.clientSchemaGeneration &&
        existingOp.authorityKind === pkg.operation.authorityKind &&
        existingOp.authorityScope === pkg.operation.authorityScope &&
        planDeepEqual(existingOp.authorityBasisRefs, pkg.operation.authorityBasisRefs) &&
        existingOp.sourceKind === 'planEditorCommit' &&
        Array.isArray(existingOp.sourceRefs) &&
        existingOp.effectiveBoundary === 'immediate' &&
        existingOp.canonicalEncodingVersion === PLAN_CANONICAL_ENCODING_VERSION &&
        existingOp.commitState === 'committed' &&
        existingOp.lifecycleState === 'active' &&
        existingOp.gatewayId === pkg.gatewayId &&
        existingOp.clientCreatedAt === pkg.operation.clientCreatedAt &&
        // Round-9 review Defect #3: device/session provenance must agree
        // on a retry too, not only on a fresh write.
        existingOp.deviceId === pkg.operation.deviceId &&
        existingOp.sessionId === pkg.operation.sessionId &&
        !!existingOp.committedAt;
      var gatewayFullyAgrees = !!gw &&
        gw.recordId === gw.gatewayId &&
        gw.recordType === 'planCommitGateway' &&
        gw.schemaVersion === PLAN_SCHEMA_VERSION &&
        gw.ownerDomain === 'plan' &&
        gw.gatewayId === pkg.gatewayId &&
        gw.operationId === pkg.operation.operationId &&
        gw.ownerUid === pkg.ownerUid &&
        gw.actorUid === pkg.operation.actorUid &&
        gw.templateId === pkg.intent.templateId &&
        gw.templateRevisionId === pkg.intent.newTemplateRevisionId &&
        gw.manifestId === pkg.graph.manifest.manifestId &&
        gw.manifestHash === pkg.graph.manifest.graphHash &&
        gw.expectedPredecessorRevisionId === pkg.intent.expectedHeadRevisionId &&
        gw.authorityKind === pkg.operation.authorityKind &&
        gw.authorityScope === pkg.operation.authorityScope &&
        planDeepEqual(gw.authorityBasisRefs, pkg.operation.authorityBasisRefs) &&
        gw.clientSchemaGeneration === pkg.operation.clientSchemaGeneration &&
        gw.createdByOperationId === pkg.operation.operationId &&
        gw.sourceKind === 'planEditorCommit' &&
        Array.isArray(gw.sourceRefs) &&
        gw.canonicalEncodingVersion === PLAN_CANONICAL_ENCODING_VERSION &&
        gw.commitState === 'committed' &&
        gw.lifecycleState === 'active' &&
        gw.effectiveBoundary === 'immediate' &&
        gw.clientCreatedAt === pkg.operation.clientCreatedAt &&
        !!gw.committedAt &&
        gw.writeSetHash === pkg.writeSetHash;
      if (operationFullyAgrees && gatewayFullyAgrees) {
        var alreadyCommittedOutcome = {
          operationId: pkg.operation.operationId,
          templateId: pkg.intent.templateId,
          templateRevisionId: pkg.intent.newTemplateRevisionId,
          gatewayId: pkg.gatewayId,
          manifestId: pkg.graph.manifest.manifestId,
          manifestHash: pkg.graph.manifest.graphHash,
          writeSetHash: pkg.writeSetHash
        };
        return planDeepFreeze({
          result: 'alreadyCommitted',
          outcome: alreadyCommittedOutcome,
          // Round-7 review Defect #7: binds this result to the exact
          // package it was validated against -- see planComputeCommitProof.
          proof: planComputeCommitProof(pkg, 'alreadyCommitted', alreadyCommittedOutcome)
        });
      }
      // Committed operation outcome exists but either the operation
      // document itself or its required gateway does not fully agree with
      // what this package expects -- an inconsistent canonical state that
      // must never be silently treated as either fresh-proceed or
      // already-committed.
      return planBlocked('operationCommittedGatewayMissing', { operationId: pkg.operation.operationId });
    }
    // Operation exists, same fingerprint, but not yet committed (e.g. a
    // concurrent or interrupted attempt). V1 has no prepared/resume
    // protocol (§12: "Prepared protocol deferred"), so this blocks rather
    // than guessing.
    return planBlocked('operationInProgressUnsupported', { operationId: pkg.operation.operationId });
  }

  // ---- 3. Template head validation (§11 step 5). Round-4 Defect #4:
  // identity (recordType/ownerUid/templateId), lifecycle, and head
  // manifest ID/hash agreement are now validated too, not only head
  // revision/sequence.
  var templateRef = readPlan.templateSubjectRef;
  if (templateRef.expectedAbsent) {
    if (docs.templateSubject) {
      return planBlocked('templateTargetCollision', { templateId: pkg.intent.templateId });
    }
  } else {
    if (!docs.templateSubject) {
      return planBlocked('staleTemplateHead', { templateId: pkg.intent.templateId, reason: 'templateSubjectMissing' });
    }
    var ts = docs.templateSubject;
    if (ts.recordType !== 'planTemplateSubject') {
      return planBlocked('staleTemplateHead', { templateId: pkg.intent.templateId, reason: 'recordTypeMismatch', actual: ts.recordType });
    }
    if (ts.ownerUid !== pkg.ownerUid) {
      return planBlocked('staleTemplateHead', { templateId: pkg.intent.templateId, reason: 'ownerUidMismatch', actual: ts.ownerUid });
    }
    if (ts.templateId !== pkg.intent.templateId) {
      return planBlocked('staleTemplateHead', { templateId: pkg.intent.templateId, reason: 'templateIdMismatch', actual: ts.templateId });
    }
    if (ts.lifecycleState !== 'active') {
      return planBlocked('staleTemplateHead', { templateId: pkg.intent.templateId, reason: 'lifecycleNotActive', actual: ts.lifecycleState });
    }
    if (ts.headRevisionId !== templateRef.expectedHeadRevisionId) {
      return planBlocked('staleTemplateHead', {
        templateId: pkg.intent.templateId,
        expected: templateRef.expectedHeadRevisionId,
        actual: ts.headRevisionId
      });
    }
    if (ts.headSequence !== templateRef.expectedHeadSequence) {
      return planBlocked('staleTemplateSequence', {
        templateId: pkg.intent.templateId,
        expected: templateRef.expectedHeadSequence,
        actual: ts.headSequence
      });
    }
    if (ts.headManifestId !== templateRef.expectedHeadManifestId) {
      return planBlocked('staleTemplateHead', {
        templateId: pkg.intent.templateId, reason: 'headManifestIdMismatch',
        expected: templateRef.expectedHeadManifestId, actual: ts.headManifestId
      });
    }
    if (ts.headManifestHash !== templateRef.expectedHeadManifestHash) {
      return planBlocked('staleTemplateHead', {
        templateId: pkg.intent.templateId, reason: 'headManifestHashMismatch',
        expected: templateRef.expectedHeadManifestHash, actual: ts.headManifestHash
      });
    }
    // Round-10 review Defect #1 (adversarially reverified): headDeviceId/
    // headSessionId, unlike headOperationId/headGatewayId, are never baked
    // into any hash -- so they are cross-checked here against
    // templateRef.expectedHeadDeviceId/expectedHeadSessionId, an
    // expectation frozen from the CALLER's own basis.templateSubject
    // (independent of this read), exactly like headManifestId/
    // headManifestHash just above. Only meaningful once the Template head
    // itself carries these fields at all -- see the headDeviceId/
    // headSessionId planRequire in the noChangeToCommit setup below, which
    // guards the no-change path specifically; this step-3 check runs for
    // every commit against an existing Template head, no-change or not.
    if (ts.headDeviceId !== templateRef.expectedHeadDeviceId) {
      return planBlocked('staleTemplateHead', {
        templateId: pkg.intent.templateId, reason: 'headDeviceIdMismatch',
        expected: templateRef.expectedHeadDeviceId, actual: ts.headDeviceId
      });
    }
    if (ts.headSessionId !== templateRef.expectedHeadSessionId) {
      return planBlocked('staleTemplateHead', {
        templateId: pkg.intent.templateId, reason: 'headSessionIdMismatch',
        expected: templateRef.expectedHeadSessionId, actual: ts.headSessionId
      });
    }
    // Round-11 review (self-review, adversarial re-verification): step 10's
    // no-change check exclusively uses the basis-derived closure values
    // (expectedIntentFingerprint/expectedPredecessorRevisionIdForGateway),
    // never docs.templateSubject, for these two fields -- so a forged
    // ts.headIntentFingerprint/ts.headExpectedPredecessorRevisionId was
    // never actually reachable as an attack. This check is added anyway,
    // for the same reason headManifestId/headManifestHash/headDeviceId/
    // headSessionId are all cross-checked here even though some of them
    // are also independently hash-bound or closure-anchored elsewhere: it
    // keeps every field this document is stamped with -- real or forged --
    // provably consistent at the one point every commit (no-change or not)
    // reads the Template head, rather than leaving a stamped field that is
    // simply never read back by anything.
    if (ts.headIntentFingerprint !== templateRef.expectedHeadIntentFingerprint) {
      return planBlocked('staleTemplateHead', {
        templateId: pkg.intent.templateId, reason: 'headIntentFingerprintMismatch',
        expected: templateRef.expectedHeadIntentFingerprint, actual: ts.headIntentFingerprint
      });
    }
    if (ts.headExpectedPredecessorRevisionId !== templateRef.expectedHeadExpectedPredecessorRevisionId) {
      return planBlocked('staleTemplateHead', {
        templateId: pkg.intent.templateId, reason: 'headExpectedPredecessorRevisionIdMismatch',
        expected: templateRef.expectedHeadExpectedPredecessorRevisionId, actual: ts.headExpectedPredecessorRevisionId
      });
    }
    // Round-12 review: the transaction-read Template subject's own
    // headWriteSetHash must agree with the independently frozen
    // expectedHeadWriteSetHash -- never derived from this document or any
    // other transaction-read document. Because expectedHeadWriteSetHash is
    // itself guaranteed well-formed (64 lowercase hex) at construction time
    // (see the planRequire above), this equality check necessarily also
    // enforces that ts.headWriteSetHash is well-formed whenever it passes --
    // a malformed or forged value simply cannot equal a genuine sha256
    // digest it wasn't computed to match.
    if (ts.headWriteSetHash !== templateRef.expectedHeadWriteSetHash) {
      return planBlocked('staleTemplateHead', {
        templateId: pkg.intent.templateId, reason: 'headWriteSetHashMismatch',
        expected: templateRef.expectedHeadWriteSetHash, actual: ts.headWriteSetHash
      });
    }
    // Round-7 review Defect #3: complete envelope check (see
    // planEnvelopeCompletenessReason above).
    var tsEnvelopeReason = planEnvelopeCompletenessReason(ts, 'updatedByOperationId');
    if (tsEnvelopeReason) {
      return planBlocked('staleTemplateHead', { templateId: pkg.intent.templateId, reason: 'envelopeIncomplete', field: tsEnvelopeReason });
    }
    // Round-9 review Defect #2: presence is not correctness -- compare the
    // actually read document against the independently frozen historical
    // expectation too.
    var tsHistoricalReason = planHistoricalEnvelopeMismatchReason(ts, templateRef.expectedEnvelope, 'updatedByOperationId');
    if (tsHistoricalReason) {
      return planBlocked('staleTemplateHead', { templateId: pkg.intent.templateId, reason: 'envelopeHistoricalMismatch', field: tsHistoricalReason });
    }
  }

  // ---- 4. Child subject head validation (stale non-Template subject head
  // blocks; target collision for brand-new subjects blocks). Round-4
  // Defect #4: identity and lifecycle are now validated too.
  for (var cj = 0; cj < readPlan.childSubjectRefs.length; cj++) {
    var ref = readPlan.childSubjectRefs[cj];
    var doc = childSubjects[ref.subjectId];
    if (ref.expectedAbsent) {
      if (doc) {
        return planBlocked('targetCollision', { subjectId: ref.subjectId, recordType: ref.recordType, path: ref.path });
      }
    } else {
      if (!doc) {
        return planBlocked('staleSubjectHead', { subjectId: ref.subjectId, recordType: ref.recordType, reason: 'subjectMissing' });
      }
      if (doc.recordType !== ref.recordType) {
        return planBlocked('staleSubjectHead', { subjectId: ref.subjectId, recordType: ref.recordType, reason: 'recordTypeMismatch', actual: doc.recordType });
      }
      if (doc.ownerUid !== pkg.ownerUid) {
        return planBlocked('staleSubjectHead', { subjectId: ref.subjectId, recordType: ref.recordType, reason: 'ownerUidMismatch', actual: doc.ownerUid });
      }
      if (doc.subjectId !== ref.subjectId) {
        return planBlocked('staleSubjectHead', { subjectId: ref.subjectId, recordType: ref.recordType, reason: 'subjectIdMismatch', actual: doc.subjectId });
      }
      if (doc.lifecycleState !== 'active') {
        return planBlocked('staleSubjectHead', { subjectId: ref.subjectId, recordType: ref.recordType, reason: 'lifecycleNotActive', actual: doc.lifecycleState });
      }
      if (doc.headRevisionId !== ref.expectedHeadRevisionId) {
        return planBlocked('staleSubjectHead', {
          subjectId: ref.subjectId, recordType: ref.recordType,
          expected: ref.expectedHeadRevisionId, actual: doc.headRevisionId
        });
      }
      // Round-7 review Defect #3: complete envelope check.
      var childEnvelopeReason = planEnvelopeCompletenessReason(doc, 'updatedByOperationId');
      if (childEnvelopeReason) {
        return planBlocked('staleSubjectHead', { subjectId: ref.subjectId, recordType: ref.recordType, reason: 'envelopeIncomplete', field: childEnvelopeReason });
      }
      // Round-9 review Defect #2.
      var childHistoricalReason = planHistoricalEnvelopeMismatchReason(doc, ref.expectedEnvelope, 'updatedByOperationId');
      if (childHistoricalReason) {
        return planBlocked('staleSubjectHead', { subjectId: ref.subjectId, recordType: ref.recordType, reason: 'envelopeHistoricalMismatch', field: childHistoricalReason });
      }
    }
  }

  // ---- 5. Removed-Assignment lifecycle validation (round-1 Defect #7;
  // round-6 Defect #4). The subject must still exist, with the exact
  // identity and lifecycle a genuine Assignment pointer document would
  // have, before its prospective termination write may proceed. The
  // round-5 shape checked only headRevisionId -- an independent probe
  // supplied a document with the right head id but a wrong recordType,
  // ownerUid, subjectId, and lifecycleState, and it still proceeded. This
  // now mirrors the exact identity/ownership/lifecycle checks step 4 above
  // already applies to every other child subject head. (Template-membership
  // basis beyond the head pointer itself is out of scope: V1 has no
  // separate membership record to read, and removal detection is already
  // computed purely from comparing the current draft's Assignment subject
  // ids against basis.priorAssignmentSubjectIds -- see the write-plan
  // comment above candidateWrites' removal loop.)
  for (var rmi = 0; rmi < readPlan.removedAssignmentRefs.length; rmi++) {
    var rmRef = readPlan.removedAssignmentRefs[rmi];
    var rmDoc = removedAssignments[rmRef.subjectId];
    if (!rmDoc) {
      return planBlocked('staleSubjectHead', { subjectId: rmRef.subjectId, recordType: rmRef.recordType, reason: 'subjectMissing' });
    }
    if (rmDoc.recordType !== rmRef.recordType) {
      return planBlocked('staleSubjectHead', { subjectId: rmRef.subjectId, recordType: rmRef.recordType, reason: 'recordTypeMismatch', actual: rmDoc.recordType });
    }
    if (rmDoc.ownerUid !== pkg.ownerUid) {
      return planBlocked('staleSubjectHead', { subjectId: rmRef.subjectId, recordType: rmRef.recordType, reason: 'ownerUidMismatch', actual: rmDoc.ownerUid });
    }
    if (rmDoc.subjectId !== rmRef.subjectId) {
      return planBlocked('staleSubjectHead', { subjectId: rmRef.subjectId, recordType: rmRef.recordType, reason: 'subjectIdMismatch', actual: rmDoc.subjectId });
    }
    if (rmDoc.lifecycleState !== 'active') {
      return planBlocked('staleSubjectHead', { subjectId: rmRef.subjectId, recordType: rmRef.recordType, reason: 'lifecycleNotActive', actual: rmDoc.lifecycleState });
    }
    if (rmDoc.headRevisionId !== rmRef.expectedHeadRevisionId) {
      return planBlocked('staleSubjectHead', {
        subjectId: rmRef.subjectId, recordType: rmRef.recordType,
        expected: rmRef.expectedHeadRevisionId, actual: rmDoc.headRevisionId
      });
    }
    // Round-7 review Defect #3: complete envelope check.
    var rmEnvelopeReason = planEnvelopeCompletenessReason(rmDoc, 'updatedByOperationId');
    if (rmEnvelopeReason) {
      return planBlocked('staleSubjectHead', { subjectId: rmRef.subjectId, recordType: rmRef.recordType, reason: 'envelopeIncomplete', field: rmEnvelopeReason });
    }
    // Round-9 review Defect #2.
    var rmHistoricalReason = planHistoricalEnvelopeMismatchReason(rmDoc, rmRef.expectedEnvelope, 'updatedByOperationId');
    if (rmHistoricalReason) {
      return planBlocked('staleSubjectHead', { subjectId: rmRef.subjectId, recordType: rmRef.recordType, reason: 'envelopeHistoricalMismatch', field: rmHistoricalReason });
    }
  }

  // ---- 6. Reused revision integrity (§4.3: reuse only when the exact
  // semantic payload AND exact dependency refs are unchanged). Round-4
  // Defect #4: both hashes are now RECOMPUTED from the actual document
  // content (never trusted from a stored hash field alone), dependencyRefs
  // presence is required unconditionally, and full document identity
  // (recordType/ownerUid/subjectId/revisionId/lifecycleState) is checked.
  for (var rk = 0; rk < readPlan.reusedRevisionRefs.length; rk++) {
    var rr = readPlan.reusedRevisionRefs[rk];
    var revDoc = reusedRevisions[rr.subjectId];
    if (!revDoc) {
      return planBlocked('reusedRevisionMismatch', { subjectId: rr.subjectId, reason: 'reusedRevisionMissing', revisionId: rr.revisionId });
    }
    if (revDoc.recordType !== rr.revisionRecordType) {
      return planBlocked('reusedRevisionMismatch', { subjectId: rr.subjectId, revisionId: rr.revisionId, reason: 'recordTypeMismatch', actual: revDoc.recordType });
    }
    if (revDoc.ownerUid !== pkg.ownerUid) {
      return planBlocked('reusedRevisionMismatch', { subjectId: rr.subjectId, revisionId: rr.revisionId, reason: 'ownerUidMismatch', actual: revDoc.ownerUid });
    }
    if (revDoc.subjectId !== rr.subjectId) {
      return planBlocked('reusedRevisionMismatch', { subjectId: rr.subjectId, revisionId: rr.revisionId, reason: 'subjectIdMismatch', actual: revDoc.subjectId });
    }
    if (revDoc.revisionId !== rr.revisionId) {
      return planBlocked('reusedRevisionMismatch', { subjectId: rr.subjectId, revisionId: rr.revisionId, reason: 'revisionIdMismatch', actual: revDoc.revisionId });
    }
    if (revDoc.lifecycleState !== 'active') {
      return planBlocked('reusedRevisionMismatch', { subjectId: rr.subjectId, revisionId: rr.revisionId, reason: 'lifecycleNotActive', actual: revDoc.lifecycleState });
    }
    if (!revDoc.dependencyRefs || !Array.isArray(revDoc.dependencyRefs)) {
      return planBlocked('reusedRevisionMismatch', { subjectId: rr.subjectId, revisionId: rr.revisionId, reason: 'dependencyRefsMissing' });
    }
    if (!planDeepEqual(revDoc.dependencyRefs, rr.expectedDependencyRefs)) {
      return planBlocked('reusedRevisionMismatch', { subjectId: rr.subjectId, revisionId: rr.revisionId, reason: 'dependencyRefsDisagree' });
    }

    var recomputedPayloadHash = planSha256Hex(planBuildCanonicalEncoding(planExtractSemanticSubset(revDoc, rr.expectedSemanticPayload)));
    if (recomputedPayloadHash !== rr.expectedPayloadHash) {
      return planBlocked('reusedRevisionMismatch', {
        subjectId: rr.subjectId, revisionId: rr.revisionId, reason: 'payloadContentMismatch',
        expected: rr.expectedPayloadHash, recomputed: recomputedPayloadHash
      });
    }
    if (revDoc.payloadHash !== recomputedPayloadHash) {
      return planBlocked('reusedRevisionMismatch', {
        subjectId: rr.subjectId, revisionId: rr.revisionId, reason: 'selfClaimedPayloadHashInconsistent',
        selfClaimed: revDoc.payloadHash, recomputed: recomputedPayloadHash
      });
    }

    var recomputedDependencyHash = planSha256Hex(planBuildCanonicalEncoding(revDoc.dependencyRefs));
    if (recomputedDependencyHash !== rr.expectedDependencyHash) {
      return planBlocked('reusedRevisionMismatch', {
        subjectId: rr.subjectId, revisionId: rr.revisionId, reason: 'dependencyContentMismatch',
        expected: rr.expectedDependencyHash, recomputed: recomputedDependencyHash
      });
    }
    if (revDoc.dependencyHash !== recomputedDependencyHash) {
      return planBlocked('reusedRevisionMismatch', {
        subjectId: rr.subjectId, revisionId: rr.revisionId, reason: 'selfClaimedDependencyHashInconsistent',
        selfClaimed: revDoc.dependencyHash, recomputed: recomputedDependencyHash
      });
    }
    // Round-7 review Defect #3: complete envelope check.
    var revEnvelopeReason = planEnvelopeCompletenessReason(revDoc, 'createdByOperationId');
    if (revEnvelopeReason) {
      return planBlocked('reusedRevisionMismatch', { subjectId: rr.subjectId, revisionId: rr.revisionId, reason: 'envelopeIncomplete', field: revEnvelopeReason });
    }
    // Round-9 review Defect #2.
    var revHistoricalReason = planHistoricalEnvelopeMismatchReason(revDoc, rr.expectedEnvelope, 'createdByOperationId');
    if (revHistoricalReason) {
      return planBlocked('reusedRevisionMismatch', { subjectId: rr.subjectId, revisionId: rr.revisionId, reason: 'envelopeHistoricalMismatch', field: revHistoricalReason });
    }
  }

  // ---- 6.5. Predecessor revision validation (round-4 Defect #4; round-6
  // Defect #3). For every new revision whose subject had a prior committed
  // revision, the EXACT predecessor document must be read and must agree
  // in identity, ownership, and lifecycle -- successor lineage is real,
  // not merely asserted by in-memory basis data. The round-5 shape then
  // compared only the document's OWN stored hash fields against the
  // package's expectation, never against anything recomputed from real
  // content -- an independent probe supplied a predecessor document with
  // correct identity fields and the two correct-looking hash strings, but
  // no semantic payload and no dependencyRefs at all, and validation still
  // returned 'proceed'. This now applies the identical recompute-and-
  // cross-check standard step 6 above already applies to REUSED revisions:
  // require dependencyRefs, recompute both hashes from the document's
  // actual content, and check the recomputed value against both what the
  // package expected (content mismatch) and what the document itself
  // claims (self-claimed inconsistency).
  for (var pdi = 0; pdi < readPlan.predecessorRevisionRefs.length; pdi++) {
    var pdRef = readPlan.predecessorRevisionRefs[pdi];
    var pdDoc = predecessorRevisions[pdRef.subjectId];
    if (!pdDoc) {
      return planBlocked('predecessorRevisionMismatch', { subjectId: pdRef.subjectId, reason: 'predecessorRevisionMissing', revisionId: pdRef.revisionId });
    }
    if (pdDoc.recordType !== pdRef.revisionRecordType) {
      return planBlocked('predecessorRevisionMismatch', { subjectId: pdRef.subjectId, reason: 'recordTypeMismatch', actual: pdDoc.recordType });
    }
    if (pdDoc.ownerUid !== pkg.ownerUid) {
      return planBlocked('predecessorRevisionMismatch', { subjectId: pdRef.subjectId, reason: 'ownerUidMismatch', actual: pdDoc.ownerUid });
    }
    if (pdDoc.subjectId !== pdRef.subjectId) {
      return planBlocked('predecessorRevisionMismatch', { subjectId: pdRef.subjectId, reason: 'subjectIdMismatch', actual: pdDoc.subjectId });
    }
    if (pdDoc.revisionId !== pdRef.revisionId) {
      return planBlocked('predecessorRevisionMismatch', { subjectId: pdRef.subjectId, reason: 'revisionIdMismatch', actual: pdDoc.revisionId });
    }
    if (pdDoc.lifecycleState !== 'active') {
      return planBlocked('predecessorRevisionMismatch', { subjectId: pdRef.subjectId, reason: 'lifecycleNotActive', actual: pdDoc.lifecycleState });
    }
    if (!pdDoc.dependencyRefs || !Array.isArray(pdDoc.dependencyRefs)) {
      return planBlocked('predecessorRevisionMismatch', { subjectId: pdRef.subjectId, revisionId: pdRef.revisionId, reason: 'dependencyRefsMissing' });
    }
    if (!planDeepEqual(pdDoc.dependencyRefs, pdRef.expectedDependencyRefs)) {
      return planBlocked('predecessorRevisionMismatch', { subjectId: pdRef.subjectId, revisionId: pdRef.revisionId, reason: 'dependencyRefsDisagree' });
    }

    var recomputedPredecessorPayloadHash = planSha256Hex(planBuildCanonicalEncoding(planExtractSemanticSubset(pdDoc, pdRef.expectedSemanticPayload)));
    if (recomputedPredecessorPayloadHash !== pdRef.expectedPayloadHash) {
      return planBlocked('predecessorRevisionMismatch', {
        subjectId: pdRef.subjectId, revisionId: pdRef.revisionId, reason: 'payloadContentMismatch',
        expected: pdRef.expectedPayloadHash, recomputed: recomputedPredecessorPayloadHash
      });
    }
    if (pdDoc.payloadHash !== recomputedPredecessorPayloadHash) {
      return planBlocked('predecessorRevisionMismatch', {
        subjectId: pdRef.subjectId, revisionId: pdRef.revisionId, reason: 'selfClaimedPayloadHashInconsistent',
        selfClaimed: pdDoc.payloadHash, recomputed: recomputedPredecessorPayloadHash
      });
    }

    var recomputedPredecessorDependencyHash = planSha256Hex(planBuildCanonicalEncoding(pdDoc.dependencyRefs));
    if (recomputedPredecessorDependencyHash !== pdRef.expectedDependencyHash) {
      return planBlocked('predecessorRevisionMismatch', {
        subjectId: pdRef.subjectId, revisionId: pdRef.revisionId, reason: 'dependencyContentMismatch',
        expected: pdRef.expectedDependencyHash, recomputed: recomputedPredecessorDependencyHash
      });
    }
    if (pdDoc.dependencyHash !== recomputedPredecessorDependencyHash) {
      return planBlocked('predecessorRevisionMismatch', {
        subjectId: pdRef.subjectId, revisionId: pdRef.revisionId, reason: 'selfClaimedDependencyHashInconsistent',
        selfClaimed: pdDoc.dependencyHash, recomputed: recomputedPredecessorDependencyHash
      });
    }
    // Round-7 review Defect #3: complete envelope check.
    var pdEnvelopeReason = planEnvelopeCompletenessReason(pdDoc, 'createdByOperationId');
    if (pdEnvelopeReason) {
      return planBlocked('predecessorRevisionMismatch', { subjectId: pdRef.subjectId, revisionId: pdRef.revisionId, reason: 'envelopeIncomplete', field: pdEnvelopeReason });
    }
    // Round-9 review Defect #2.
    var pdHistoricalReason = planHistoricalEnvelopeMismatchReason(pdDoc, pdRef.expectedEnvelope, 'createdByOperationId');
    if (pdHistoricalReason) {
      return planBlocked('predecessorRevisionMismatch', { subjectId: pdRef.subjectId, revisionId: pdRef.revisionId, reason: 'envelopeHistoricalMismatch', field: pdHistoricalReason });
    }
  }

  // ---- 6.6. Duplication source-identity verification (round-9 review
  // Defect #5; extended by round-10 review Defect #2). planValidateDuplicationLineage
  // (called while building this package) already proved the draft's self-
  // asserted lineage is well-formed AND agrees with
  // basis.duplicationSourceExpectedBySubjectId, the caller's independently
  // known source-to-destination truth -- but that was a build-time cross-
  // check of two pieces of CALLER-supplied data against each other, not
  // proof the claimed source subject genuinely exists, as a COMPLETE
  // canonical document, at the exact expected head revision, in the real
  // canonical store. A duplication source is exactly the same kind of
  // document as any other subject pointer this file already fully
  // validates (a child subject head, the Template head itself) -- round 9
  // checked only four identity/lifecycle fields, which an independent probe
  // showed was satisfied by a bare four-field skeleton with no real
  // envelope and no binding to a specific revision at all. This now applies
  // the exact same standard step 4 above applies to every ordinary child
  // subject head: identity, ownership, lifecycle, the exact expected head
  // revision (binding the read to a specific source revision, not merely
  // "some active document with this id"), and a complete, historically
  // correct §6 envelope.
  var duplicationSources = docs.duplicationSources || {};
  for (var dsj = 0; dsj < readPlan.duplicationSourceRefs.length; dsj++) {
    var dsRef = readPlan.duplicationSourceRefs[dsj];
    var dsDoc = duplicationSources[dsRef.newSubjectId];
    if (!dsDoc) return planBlocked('duplicationSourceInvalid', { newSubjectId: dsRef.newSubjectId, sourceSubjectId: dsRef.sourceSubjectId, reason: 'duplicationSourceMissing' });
    if (dsDoc.recordType !== dsRef.sourceRecordType) return planBlocked('duplicationSourceInvalid', { newSubjectId: dsRef.newSubjectId, sourceSubjectId: dsRef.sourceSubjectId, reason: 'duplicationSourceRecordTypeMismatch', actual: dsDoc.recordType });
    if (dsDoc.ownerUid !== pkg.ownerUid) return planBlocked('duplicationSourceInvalid', { newSubjectId: dsRef.newSubjectId, sourceSubjectId: dsRef.sourceSubjectId, reason: 'duplicationSourceOwnerUidMismatch', actual: dsDoc.ownerUid });
    // Correction defect 5: a planTemplateSubject source document (a whole-
    // Template duplication) has no `subjectId` field at all -- it carries
    // `recordId` and `templateId` instead (see planBuildSystemEnvelope /
    // templateSubjectWriteData), so a single `dsDoc.subjectId !==
    // dsRef.sourceSubjectId` check, as before, always failed for a genuine
    // whole-Template duplication (dsDoc.subjectId is always undefined for
    // that record type), even though every other identity/lifecycle/
    // envelope check below it would otherwise have passed. This branches by
    // the source's own claimed record type: a planTemplateSubject source is
    // now validated by its actual identity fields (recordId AND templateId,
    // both required to equal sourceSubjectId); every other source type keeps
    // the exact same two-field standard (recordId AND subjectId, both
    // required to equal sourceSubjectId) ordinary child sources always had.
    if (dsRef.sourceRecordType === 'planTemplateSubject') {
      if (dsDoc.recordId !== dsRef.sourceSubjectId || dsDoc.templateId !== dsRef.sourceSubjectId) {
        return planBlocked('duplicationSourceInvalid', { newSubjectId: dsRef.newSubjectId, sourceSubjectId: dsRef.sourceSubjectId, reason: 'duplicationSourceSubjectIdMismatch', actual: { recordId: dsDoc.recordId, templateId: dsDoc.templateId } });
      }
    } else {
      if (dsDoc.recordId !== dsRef.sourceSubjectId || dsDoc.subjectId !== dsRef.sourceSubjectId) {
        return planBlocked('duplicationSourceInvalid', { newSubjectId: dsRef.newSubjectId, sourceSubjectId: dsRef.sourceSubjectId, reason: 'duplicationSourceSubjectIdMismatch', actual: { recordId: dsDoc.recordId, subjectId: dsDoc.subjectId } });
      }
    }
    if (dsDoc.lifecycleState !== 'active') return planBlocked('duplicationSourceInvalid', { newSubjectId: dsRef.newSubjectId, sourceSubjectId: dsRef.sourceSubjectId, reason: 'duplicationSourceLifecycleNotActive', actual: dsDoc.lifecycleState });
    // Round-10 review Defect #2: bind the read to the exact expected source
    // revision -- a "some active document with this subject id" check alone
    // does not prove it is the revision the caller actually intended to
    // copy from.
    if (dsDoc.headRevisionId !== dsRef.expectedHeadRevisionId) {
      return planBlocked('duplicationSourceInvalid', { newSubjectId: dsRef.newSubjectId, sourceSubjectId: dsRef.sourceSubjectId, reason: 'duplicationSourceHeadRevisionMismatch', expected: dsRef.expectedHeadRevisionId, actual: dsDoc.headRevisionId });
    }
    // Round-10 review Defect #2: complete §6 envelope, not a bare identity
    // skeleton -- the same completeness + historical-mismatch standard
    // every other subject-pointer read in this file already applies.
    var dsEnvelopeReason = planEnvelopeCompletenessReason(dsDoc, 'updatedByOperationId');
    if (dsEnvelopeReason) {
      return planBlocked('duplicationSourceInvalid', { newSubjectId: dsRef.newSubjectId, sourceSubjectId: dsRef.sourceSubjectId, reason: 'duplicationSourceEnvelopeIncomplete', field: dsEnvelopeReason });
    }
    var dsHistoricalReason = planHistoricalEnvelopeMismatchReason(dsDoc, dsRef.expectedEnvelope, 'updatedByOperationId');
    if (dsHistoricalReason) {
      return planBlocked('duplicationSourceInvalid', { newSubjectId: dsRef.newSubjectId, sourceSubjectId: dsRef.sourceSubjectId, reason: 'duplicationSourceEnvelopeHistoricalMismatch', field: dsHistoricalReason });
    }
  }

  // ---- 7. New revision target collision detection.
  for (var nk = 0; nk < readPlan.newRevisionTargetRefs.length; nk++) {
    var nr = readPlan.newRevisionTargetRefs[nk];
    var targetDoc = newRevisionTargets[nr.subjectId];
    if (targetDoc) {
      return planBlocked('targetCollision', { subjectId: nr.subjectId, revisionId: nr.revisionId, path: nr.path });
    }
  }

  // ---- 8. Manifest root and chunk target collision detection (Defect #6).
  if (docs.manifestRoot) {
    return planBlocked('targetCollision', { path: readPlan.manifestRootRef.path, reason: 'manifestRootCollision' });
  }
  for (var chj = 0; chj < readPlan.chunkRefs.length; chj++) {
    var chRef = readPlan.chunkRefs[chj];
    if (chunkTargets[chRef.chunkId]) {
      return planBlocked('targetCollision', { path: chRef.path, chunkId: chRef.chunkId, reason: 'manifestChunkCollision' });
    }
  }

  // ---- 9. Gateway target collision (fresh-attempt path; the idempotent
  // already-committed path was handled in step 2).
  if (docs.gatewayTarget) {
    return planBlocked('gatewayTargetCollision', { gatewayId: pkg.gatewayId });
  }

  // ---- 10. Genuine no-change verification (round-7 review Defect #2).
  // Every check above already confirms the Template head is not stale
  // (step 3) and that the Template's own revision content re-hashes
  // identically to what is already committed, which -- because the
  // Template's dependencyHash recursively covers its whole graph -- proves
  // the entire graph is content-identical too (see the noChangeToCommit
  // comment above where it is computed). What is still unverified is that
  // the EXACT prior manifest/operation/gateway tuple this attempt claims
  // to leave untouched is itself real, complete, and self-consistent --
  // not merely that pkg.noChangeToCommit was computed as true. A missing
  // or malformed member of that tuple blocks rather than silently
  // no-op'ing.
  //
  // NOTE: graphHash/chunkHash are NOT pure content hashes in this
  // architecture -- planBuildGraphManifest binds them to the specific
  // manifestId/operationId/gatewayId/clientCreatedAt of the attempt that
  // built them (see planBuildManifestChunkDocumentData and the graphHash
  // computation above), by design, so that every manifest/chunk documents
  // proves which exact commit produced it. That means pkg.intent.graphHash
  // (computed fresh for THIS attempt's own never-to-be-written ids) can
  // never equal the prior manifest's stored graphHash even when the
  // content is genuinely identical -- comparing them would make every
  // no-change attempt block. The correct self-consistency check is instead
  // against the Template head pointer's own expectedHeadManifestHash
  // (step 3 above already proved that pointer is not stale), since both
  // that field and the prior manifest's own graphHash field were stamped
  // from the exact same value at the time of the original commit.
  if (pkg.noChangeToCommit) {
    var priorManifestDoc = docs.priorManifest;
    var priorOperationDoc = docs.priorOperation;
    var priorGatewayDoc = docs.priorGateway;
    var expectedManifestId = readPlan.templateSubjectRef.expectedHeadManifestId;
    var expectedManifestHash = readPlan.templateSubjectRef.expectedHeadManifestHash;
    var expectedOperationId = basisHeadOperationIdFor(docs);
    var expectedGatewayId = basisHeadGatewayIdFor(docs);
    // Round-10 review Defect #1 (adversarially reverified): sourced from the
    // independently-frozen closure expectation, not re-read from docs --
    // see the comment above basisHeadOperationIdFor/basisHeadGatewayIdFor.
    var expectedDeviceId = readPlan.templateSubjectRef.expectedHeadDeviceId;
    var expectedSessionId = readPlan.templateSubjectRef.expectedHeadSessionId;
    // Round-11 review: sourced the same way -- independently-frozen closure
    // expectations, never re-read from the untrusted prior documents
    // themselves.
    var expectedIntentFingerprint = readPlan.templateSubjectRef.expectedHeadIntentFingerprint;
    var expectedPredecessorRevisionIdForGateway = readPlan.templateSubjectRef.expectedHeadExpectedPredecessorRevisionId;
    // Round-12 review: sourced the same way -- an independently-frozen
    // closure expectation, never derived from either transaction-read
    // document (docs.templateSubject or priorGatewayDoc) being checked
    // against it. See planComputeCanonicalWriteSetHash's own comment for
    // why this is a comparison against a remembered value, not a
    // recomputation of the original historical write-set hash.
    var expectedWriteSetHash = readPlan.templateSubjectRef.expectedHeadWriteSetHash;

    // Round-9 review Defect #2 infrastructure, reused here exactly as
    // designed (see templateExpectedEnvelope's own comment in
    // planBuildTemplateCommitPackage): templateEntry.reused is only ever
    // true together with noChangeToCommit, so the SAME frozen envelope
    // expectation that already proved the Template subject pointer's
    // historical fields (step 3 above) is, by construction, the exact
    // envelope the prior operation/gateway/manifest/every prior chunk were
    // also stamped with -- one commit produced all of them together.
    var priorTupleExpectedEnvelope = readPlan.templateSubjectRef.expectedEnvelope;

    if (!priorManifestDoc) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestMissing', manifestId: expectedManifestId });
    if (priorManifestDoc.recordType !== 'planGraphManifest') return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestRecordTypeMismatch', actual: priorManifestDoc.recordType });
    // Round-10 review Defect #1: the manifest root's own Identity-group
    // recordId, and its separate self-named manifestId field, were never
    // directly checked -- only implied via chunk-list/graphHash agreement.
    if (priorManifestDoc.recordId !== expectedManifestId) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestRecordIdMismatch', expected: expectedManifestId, actual: priorManifestDoc.recordId });
    if (priorManifestDoc.manifestId !== expectedManifestId) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestManifestIdMismatch', expected: expectedManifestId, actual: priorManifestDoc.manifestId });
    if (priorManifestDoc.ownerUid !== pkg.ownerUid) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestOwnerUidMismatch', actual: priorManifestDoc.ownerUid });
    if (priorManifestDoc.templateId !== pkg.intent.templateId) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestTemplateIdMismatch', actual: priorManifestDoc.templateId });
    if (priorManifestDoc.templateRevisionId !== pkg.intent.newTemplateRevisionId) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestRevisionIdMismatch', expected: pkg.intent.newTemplateRevisionId, actual: priorManifestDoc.templateRevisionId });
    if (priorManifestDoc.graphHash !== expectedManifestHash) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestGraphHashMismatch', expected: expectedManifestHash, actual: priorManifestDoc.graphHash });
    if (priorManifestDoc.lifecycleState !== 'active') return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestLifecycleNotActive', actual: priorManifestDoc.lifecycleState });
    if (priorManifestDoc.operationId !== expectedOperationId) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestOperationIdMismatch', expected: expectedOperationId, actual: priorManifestDoc.operationId });
    if (priorManifestDoc.gatewayId !== expectedGatewayId) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestGatewayIdMismatch', expected: expectedGatewayId, actual: priorManifestDoc.gatewayId });
    // Round-11 review: planEnvelopeCompletenessReason was never called on
    // any of the 4 prior-tuple document types -- only
    // planHistoricalEnvelopeMismatchReason (which checks a DIFFERENT field
    // set: it compares fields against expectedEnvelope, but never confirms
    // schemaVersion/ownerDomain/canonicalEncodingVersion/commitState/
    // sourceKind/sourceRefs/clientSchemaGeneration/authorityKind/
    // authorityBasisRefs/actorUid/committedAt are even PRESENT and
    // well-shaped in the first place). Both checks run, in addition to each
    // other, on every prior document -- exactly as they already do wherever
    // else this file reads an existing record (see planEnvelopeCompletenessReason's
    // own comment).
    var priorManifestCompletenessReason = planEnvelopeCompletenessReason(priorManifestDoc, 'createdByOperationId');
    if (priorManifestCompletenessReason) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestEnvelopeIncomplete', field: priorManifestCompletenessReason });
    // The manifest root is always freshly created (never updated in place --
    // one manifestId per commit; see planBuildSystemEnvelope's isNew=true
    // call site), so its historical provenance field is createdByOperationId.
    var priorManifestHistoricalReason = planHistoricalEnvelopeMismatchReason(priorManifestDoc, priorTupleExpectedEnvelope, 'createdByOperationId');
    if (priorManifestHistoricalReason) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestHistoricalMismatch', field: priorManifestHistoricalReason });
    // Round-9 review Defect #1: the manifest root's own claimed chunk list
    // must agree with the FROZEN read plan (readPlan.priorChunkRefs, built
    // from basis.templateSubject.headManifestChunkIds -- the independently
    // known truth), not merely be self-consistent -- an independent probe
    // scenario is a manifest root whose claimed chunks disagree with what
    // the Template head actually named.
    var expectedChunkIdList = readPlan.priorChunkRefs.map(function (r) { return r.chunkId; });
    if (!planDeepEqual(priorManifestDoc.chunkIds, expectedChunkIdList)) {
      return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestChunkListMismatch', expected: expectedChunkIdList, actual: priorManifestDoc.chunkIds });
    }
    if (priorManifestDoc.chunkCount !== readPlan.priorChunkRefs.length) {
      return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestChunkCountMismatch', expected: readPlan.priorChunkRefs.length, actual: priorManifestDoc.chunkCount });
    }

    // operationId on the operation/gateway/chunk documents below is
    // compared via the generic provenanceField mechanism too (a
    // canonicalOperation/planCommitGateway/planGraphManifestChunk
    // document's own operationId IS the "creating operation" reference for
    // that document type, self-referential rather than a separate
    // createdByOperationId/updatedByOperationId field).
    if (!priorOperationDoc) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorOperationMissing', operationId: expectedOperationId });
    if (priorOperationDoc.recordType !== 'canonicalOperation') return planBlocked('noChangePriorTupleInvalid', { reason: 'priorOperationRecordTypeMismatch', actual: priorOperationDoc.recordType });
    // Round-10 review Defect #1: recordId (Identity) and operationType were
    // never directly checked.
    if (priorOperationDoc.recordId !== expectedOperationId) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorOperationRecordIdMismatch', expected: expectedOperationId, actual: priorOperationDoc.recordId });
    if (priorOperationDoc.operationType !== 'commitPlanTemplateRevision') return planBlocked('noChangePriorTupleInvalid', { reason: 'priorOperationTypeMismatch', actual: priorOperationDoc.operationType });
    if (priorOperationDoc.ownerUid !== pkg.ownerUid) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorOperationOwnerUidMismatch', actual: priorOperationDoc.ownerUid });
    if (priorOperationDoc.templateId !== pkg.intent.templateId) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorOperationTemplateIdMismatch', actual: priorOperationDoc.templateId });
    if (priorOperationDoc.outcome !== 'committed') return planBlocked('noChangePriorTupleInvalid', { reason: 'priorOperationNotCommitted', actual: priorOperationDoc.outcome });
    if (priorOperationDoc.gatewayId !== expectedGatewayId) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorOperationGatewayIdMismatch', expected: expectedGatewayId, actual: priorOperationDoc.gatewayId });
    // Round-10 review Defect #1: deviceId/sessionId (round-9 Defect #3's
    // device/session provenance) were never verified against an independent
    // expectation -- only presence on the CURRENT attempt was required.
    if (priorOperationDoc.deviceId !== expectedDeviceId) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorOperationDeviceIdMismatch', expected: expectedDeviceId, actual: priorOperationDoc.deviceId });
    if (priorOperationDoc.sessionId !== expectedSessionId) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorOperationSessionIdMismatch', expected: expectedSessionId, actual: priorOperationDoc.sessionId });
    // Round-11 review: the prior operation's intentFingerprint (spec Sec.10)
    // was never verified at all. It cannot be independently RECOMPUTED
    // during a no-change re-check -- its own source includes
    // expectedHeadRevisionId as of the ORIGINAL commit, i.e. the head
    // BEFORE that commit, two generations back from the current head, which
    // no-change verification does not otherwise track -- so instead it is
    // compared against expectedHeadIntentFingerprint, independently stashed
    // on the Template subject pointer at the time this operation was the
    // real, live commit (see headIntentFingerprint in
    // templateSubjectWriteData above). This is the same non-recomputable-
    // from-current-state shape as headDeviceId/headSessionId, not the
    // hash-bound shape of headOperationId/headGatewayId.
    if (priorOperationDoc.intentFingerprint !== expectedIntentFingerprint) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorOperationIntentFingerprintMismatch', expected: expectedIntentFingerprint, actual: priorOperationDoc.intentFingerprint });
    var priorOperationCompletenessReason = planEnvelopeCompletenessReason(priorOperationDoc, 'operationId');
    if (priorOperationCompletenessReason) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorOperationEnvelopeIncomplete', field: priorOperationCompletenessReason });
    var priorOperationHistoricalReason = planHistoricalEnvelopeMismatchReason(priorOperationDoc, priorTupleExpectedEnvelope, 'operationId');
    if (priorOperationHistoricalReason) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorOperationHistoricalMismatch', field: priorOperationHistoricalReason });

    if (!priorGatewayDoc) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorGatewayMissing', gatewayId: expectedGatewayId });
    if (priorGatewayDoc.recordType !== 'planCommitGateway') return planBlocked('noChangePriorTupleInvalid', { reason: 'priorGatewayRecordTypeMismatch', actual: priorGatewayDoc.recordType });
    // Round-10 review Defect #1: recordId (Identity), the gateway's own
    // self-named gatewayId field, and createdByOperationId (Provenance --
    // the gateway genuinely IS created by the operation that produced it,
    // unlike the operation document's self-referential operationId; see the
    // matching comment on the write side above) were never directly checked.
    if (priorGatewayDoc.recordId !== expectedGatewayId) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorGatewayRecordIdMismatch', expected: expectedGatewayId, actual: priorGatewayDoc.recordId });
    if (priorGatewayDoc.gatewayId !== expectedGatewayId) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorGatewayGatewayIdMismatch', expected: expectedGatewayId, actual: priorGatewayDoc.gatewayId });
    if (priorGatewayDoc.createdByOperationId !== expectedOperationId) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorGatewayCreatedByOperationIdMismatch', expected: expectedOperationId, actual: priorGatewayDoc.createdByOperationId });
    if (priorGatewayDoc.ownerUid !== pkg.ownerUid) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorGatewayOwnerUidMismatch', actual: priorGatewayDoc.ownerUid });
    if (priorGatewayDoc.templateId !== pkg.intent.templateId) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorGatewayTemplateIdMismatch', actual: priorGatewayDoc.templateId });
    if (priorGatewayDoc.commitState !== 'committed') return planBlocked('noChangePriorTupleInvalid', { reason: 'priorGatewayNotCommitted', actual: priorGatewayDoc.commitState });
    if (priorGatewayDoc.manifestId !== expectedManifestId) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorGatewayManifestIdMismatch', expected: expectedManifestId, actual: priorGatewayDoc.manifestId });
    if (priorGatewayDoc.templateRevisionId !== pkg.intent.newTemplateRevisionId) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorGatewayTemplateRevisionIdMismatch', expected: pkg.intent.newTemplateRevisionId, actual: priorGatewayDoc.templateRevisionId });
    if (priorGatewayDoc.manifestHash !== expectedManifestHash) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorGatewayManifestHashMismatch', expected: expectedManifestHash, actual: priorGatewayDoc.manifestHash });
    // Round-11 review: expectedPredecessorRevisionId (spec-referenced
    // alongside the gateway write) was never verified. Do not accept an
    // arbitrary value merely because the current Template head is
    // otherwise valid -- it is compared against
    // expectedHeadExpectedPredecessorRevisionId, independently stashed on
    // the Template subject pointer at the time this gateway was the real,
    // live commit (the exact same expression that commit's own gateway
    // write used -- see headExpectedPredecessorRevisionId in
    // templateSubjectWriteData above), never recomputed from current state
    // and never read back out of the prior gateway document itself. May
    // legitimately be null (the original commit created a brand-new
    // Template with no predecessor).
    if (priorGatewayDoc.expectedPredecessorRevisionId !== expectedPredecessorRevisionIdForGateway) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorGatewayExpectedPredecessorRevisionIdMismatch', expected: expectedPredecessorRevisionIdForGateway, actual: priorGatewayDoc.expectedPredecessorRevisionId });
    // Round-10/11 review: the prior gateway's writeSetHash could not be
    // independently recomputed OR compared against a second stored copy --
    // by spec Sec.13's own definition, it is a hash over EVERY candidate
    // write of that original commit, including the Template subject
    // pointer write itself, a genuine self-reference. Fully recomputing it
    // would require re-reading every candidate write the ORIGINAL commit
    // produced, which a no-change verification deliberately never does --
    // that is the entire point of the noChangeToCommit path. Round 10/11
    // could only strengthen the check to confirm the value at least LOOKED
    // like a genuine sha256 hex digest, not that it was the genuine one --
    // reported honestly as an open gap rather than silently accepted.
    //
    // Round-12 review: option 3 (deterministic placeholder normalization)
    // is now authorized -- see planComputeCanonicalWriteSetHash and
    // headWriteSetHash in templateSubjectWriteData/templateSubjectRef
    // above. This does NOT recompute the original write set (still
    // deliberately avoided); instead the prior gateway's writeSetHash is
    // compared against expectedWriteSetHash, an independently frozen
    // expectation sourced from the CALLER's own basis.templateSubject --
    // never derived from priorGatewayDoc or docs.templateSubject
    // themselves. The two format checks below are kept for a specific,
    // friendly block reason on their own (and because round-9/10 tests
    // already depend on them); the equality check below them is the real
    // fix, and blocks even a well-formed-but-wrong value that would have
    // silently passed prior to this round -- the exact attack the round-11
    // review's own probe (and this file's former "KNOWN OPEN GAP" test)
    // demonstrated.
    if (!priorGatewayDoc.writeSetHash) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorGatewayWriteSetHashMissing' });
    if (!/^[0-9a-f]{64}$/.test(priorGatewayDoc.writeSetHash)) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorGatewayWriteSetHashMalformed', actual: priorGatewayDoc.writeSetHash });
    if (priorGatewayDoc.writeSetHash !== expectedWriteSetHash) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorGatewayWriteSetHashMismatch', expected: expectedWriteSetHash, actual: priorGatewayDoc.writeSetHash });
    var priorGatewayCompletenessReason = planEnvelopeCompletenessReason(priorGatewayDoc, 'operationId');
    if (priorGatewayCompletenessReason) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorGatewayEnvelopeIncomplete', field: priorGatewayCompletenessReason });
    var priorGatewayHistoricalReason = planHistoricalEnvelopeMismatchReason(priorGatewayDoc, priorTupleExpectedEnvelope, 'operationId');
    if (priorGatewayHistoricalReason) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorGatewayHistoricalMismatch', field: priorGatewayHistoricalReason });

    // Round-9 review Defect #1: read and independently verify every prior
    // manifest chunk -- identity, ordinal, entry accounting, cross-
    // agreement with the prior operation/gateway ids, historical envelope,
    // and (critically) a RECOMPUTED chunkHash from the chunk's own actual
    // read content, using the real prior operationId/gatewayId/ownerUid and
    // the same frozen envelope context every other prior-tuple member was
    // just checked against -- never the current attempt's own never-
    // written ids/envelope. This is the same recompute-not-trust standard
    // step 6/6.5 already apply to reused/predecessor revisions.
    var priorManifestChunks = docs.priorManifestChunks || {};
    var chunkEnvCtxForRecompute = {
      actorUid: priorTupleExpectedEnvelope.actorUid,
      authorityKind: priorTupleExpectedEnvelope.authorityKind,
      authorityScope: priorTupleExpectedEnvelope.authorityScope,
      authorityBasisRefs: priorTupleExpectedEnvelope.authorityBasisRefs,
      clientSchemaGeneration: priorTupleExpectedEnvelope.clientSchemaGeneration,
      clientCreatedAt: priorTupleExpectedEnvelope.clientCreatedAt
    };
    var recomputedChunkHashes = [];
    // Round-10 review Defect #1: the manifest root's recordCount was never
    // cross-checked against anything -- tallied here from the VERIFIED
    // chunk entries (never the chunk's own self-claimed entryCount alone,
    // already separately proven self-consistent above) as each chunk is
    // read and confirmed real.
    var verifiedEntryTotal = 0;
    for (var pci = 0; pci < readPlan.priorChunkRefs.length; pci++) {
      var pcRef = readPlan.priorChunkRefs[pci];
      var pcDoc = priorManifestChunks[pcRef.chunkId];
      if (!pcDoc) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestChunkMissing', chunkId: pcRef.chunkId });
      if (pcDoc.recordType !== 'planGraphManifestChunk') return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestChunkRecordTypeMismatch', chunkId: pcRef.chunkId, actual: pcDoc.recordType });
      if (pcDoc.ownerUid !== pkg.ownerUid) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestChunkOwnerUidMismatch', chunkId: pcRef.chunkId, actual: pcDoc.ownerUid });
      if (pcDoc.manifestId !== expectedManifestId) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestChunkManifestIdMismatch', chunkId: pcRef.chunkId, expected: expectedManifestId, actual: pcDoc.manifestId });
      if (pcDoc.chunkId !== pcRef.chunkId) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestChunkIdentityMismatch', expected: pcRef.chunkId, actual: pcDoc.chunkId });
      // Round-11 review: the chunk document's own Identity-group recordId
      // (stamped by planBuildManifestChunkDocumentData as recordId: chunkId
      // on every chunk write) was never directly checked -- only chunkId.
      if (pcDoc.recordId !== pcRef.chunkId) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestChunkRecordIdMismatch', chunkId: pcRef.chunkId, expected: pcRef.chunkId, actual: pcDoc.recordId });
      if (pcDoc.chunkOrdinal !== pcRef.chunkOrdinal) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestChunkOrdinalMismatch', chunkId: pcRef.chunkId, expected: pcRef.chunkOrdinal, actual: pcDoc.chunkOrdinal });
      if (pcDoc.lifecycleState !== 'active') return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestChunkLifecycleNotActive', chunkId: pcRef.chunkId, actual: pcDoc.lifecycleState });
      if (!Array.isArray(pcDoc.entries)) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestChunkEntriesMissing', chunkId: pcRef.chunkId });
      if (pcDoc.entryCount !== pcDoc.entries.length) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestChunkEntryCountMismatch', chunkId: pcRef.chunkId, expected: pcDoc.entries.length, actual: pcDoc.entryCount });
      if (pcDoc.operationId !== expectedOperationId) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestChunkOperationIdMismatch', chunkId: pcRef.chunkId, expected: expectedOperationId, actual: pcDoc.operationId });
      if (pcDoc.gatewayId !== expectedGatewayId) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestChunkGatewayIdMismatch', chunkId: pcRef.chunkId, expected: expectedGatewayId, actual: pcDoc.gatewayId });
      var pcCompletenessReason = planEnvelopeCompletenessReason(pcDoc, 'operationId');
      if (pcCompletenessReason) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestChunkEnvelopeIncomplete', chunkId: pcRef.chunkId, field: pcCompletenessReason });
      var pcHistoricalReason = planHistoricalEnvelopeMismatchReason(pcDoc, priorTupleExpectedEnvelope, 'operationId');
      if (pcHistoricalReason) return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestChunkHistoricalMismatch', chunkId: pcRef.chunkId, field: pcHistoricalReason });

      var recomputedChunkHash = planSha256Hex(planBuildCanonicalEncoding(planBuildManifestChunkDocumentData(
        expectedManifestId, pcRef.chunkId, pcRef.chunkOrdinal, pcDoc.entries, pcDoc.entryCount,
        PLAN_HASH_PLACEHOLDER, expectedOperationId, expectedGatewayId, pkg.ownerUid, chunkEnvCtxForRecompute
      )));
      if (pcDoc.chunkHash !== recomputedChunkHash) {
        return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestChunkSelfClaimedHashInconsistent', chunkId: pcRef.chunkId, selfClaimed: pcDoc.chunkHash, recomputed: recomputedChunkHash });
      }
      if (priorManifestDoc.chunkHashes[pcRef.chunkOrdinal] !== recomputedChunkHash) {
        return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestChunkHashDisagreesWithManifest', chunkId: pcRef.chunkId, expected: priorManifestDoc.chunkHashes[pcRef.chunkOrdinal], recomputed: recomputedChunkHash });
      }
      recomputedChunkHashes.push(recomputedChunkHash);
      verifiedEntryTotal += pcDoc.entries.length;
    }
    if (priorManifestDoc.recordCount !== verifiedEntryTotal) {
      return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestRecordCountMismatch', expected: verifiedEntryTotal, actual: priorManifestDoc.recordCount });
    }
    // The manifest's own graphHash, recomputed from the chunks' RECOMPUTED
    // hashes (never the chunks' self-claimed ones, which were already
    // separately proven consistent above) -- compared against both the
    // manifest document's own stored claim (self-consistency) and the
    // Template head's independently frozen expectedHeadManifestHash
    // (agreement with the pointer that named this manifest in the first
    // place, already proven non-stale by step 3).
    var recomputedGraphHash = planSha256Hex(planBuildCanonicalEncoding({ manifestId: expectedManifestId, chunkHashes: recomputedChunkHashes }));
    if (priorManifestDoc.graphHash !== recomputedGraphHash) {
      return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestGraphHashRecomputedMismatch', selfClaimed: priorManifestDoc.graphHash, recomputed: recomputedGraphHash });
    }
    if (expectedManifestHash !== recomputedGraphHash) {
      return planBlocked('noChangePriorTupleInvalid', { reason: 'priorManifestGraphHashDisagreesWithTemplateHead', expected: expectedManifestHash, recomputed: recomputedGraphHash });
    }

    var noChangeOutcome = {
      templateId: pkg.intent.templateId,
      templateRevisionId: pkg.intent.newTemplateRevisionId,
      manifestId: expectedManifestId,
      operationId: expectedOperationId,
      gatewayId: expectedGatewayId,
      // Round-12 review: reported alongside the rest of the committed
      // identity, matching alreadyCommittedOutcome's own shape above.
      writeSetHash: expectedWriteSetHash
    };
    return planDeepFreeze({
      result: 'noChange',
      outcome: noChangeOutcome,
      // Round-7 review Defect #7: see planComputeCommitProof.
      proof: planComputeCommitProof(pkg, 'noChange', noChangeOutcome)
    });
  }

  // Round-7 review Defect #7: see planComputeCommitProof.
  return planDeepFreeze({ result: 'proceed', proof: planComputeCommitProof(pkg, 'proceed', null) });
}

// ---- 08-write-plan.js ----
// planBuildTemplateCommitWrites(package, docs)
//
// The sole gate that may release a package's precomputed candidate write
// set. It refuses any validation result other than a successful 'proceed'
// -- except 'alreadyCommitted', which is itself a form of successful
// resolution (the transaction need not, and per §13 must not, write
// anything again) and yields an explicit zero-write result rather than a
// thrown refusal. This is a documented interpretive resolution of an
// apparent tension in the spec: the write-plan boundary text says write
// construction "must refuse any validation result other than successful
// proceed," while the adversarial test list separately requires "An
// already-committed result produces zero writes" -- i.e. a defined,
// inspectable result, not an exception. See the implementation report for
// the full reasoning.
//
// Round-10 review Defect #3: this function no longer accepts a
// caller-supplied validation result at all -- it takes docs (the exact read
// documents) and calls planValidateTemplateCommitReads itself, internally,
// every call. A 'blocked' result from that internal call always throws
// PlanCommitBlockedError; the caller (a future slice's transaction driver)
// must not proceed past a blocked validation under any circumstance, and
// now has no way to bypass validation at all short of supplying different
// docs.
//
// This function performs no writes itself -- Slice 1 must not execute
// writes. It only returns the deterministic write-set descriptor that a
// later slice's transaction driver would enqueue.
//
// Corrects the prior slice's Defect #4: the returned write plan holds an
// independently deep-cloned, deeply-frozen copy of the writes -- not a
// shared reference into pkg.candidateWrites -- so that the package and the
// write plan are provably independent immutable object graphs, and any
// attempted mutation of either (in strict mode) throws at every nested
// level.

function PlanCommitBlockedError(blockReason, details) {
  this.name = 'PlanCommitBlockedError';
  this.message = 'Template commit blocked: ' + blockReason;
  this.blockReason = blockReason;
  this.details = details || {};
}
PlanCommitBlockedError.prototype = Object.create(Error.prototype);
PlanCommitBlockedError.prototype.constructor = PlanCommitBlockedError;

// Round-10 review Defect #3: round 7/8/9's proof mechanism (planComputeCommitProof,
// still used by planValidateTemplateCommitReads below for its own returned
// diagnostic 'proof' field) could only ever DETECT a forged or mismatched
// validation result after the fact -- it could never PREVENT one, because
// every input the proof hash covers is derivable from a plain,
// freely-constructible pkg object using only exported functions. Round 9's
// report called that gap architecturally impossible to close without a
// server secret; this round's review correctly points out that framing was
// too narrow -- the fix does not require a secret at all, only removing the
// caller's ability to hand this function a pre-computed validation-result
// object in the first place. planBuildTemplateCommitWrites no longer
// accepts one: it takes the exact read documents (docs, the same shape
// planValidateTemplateCommitReads itself takes) and performs validation
// itself, internally, every single call. There is no longer any
// validation-result-shaped value for a caller to forge, replay across
// packages, or hand-construct -- the only way to get a 'committed' write
// plan out of this function is to supply docs that a REAL run of
// planValidateTemplateCommitReads, executed by this function itself, judges
// worthy of 'proceed'. planValidateTemplateCommitReads remains separately
// exported for diagnostics/inspection (a caller may still want to know WHY
// something blocked without attempting to build writes), but its return
// value is never accepted as authority here, and this function never
// trusts one handed to it from outside.
function planBuildTemplateCommitWrites(pkg, docs) {
  if (!pkg || typeof pkg !== 'object' || !pkg.candidateWrites) {
    throw new Error('planBuildTemplateCommitWrites: a built commitment package is required');
  }
  if (!docs || typeof docs !== 'object') {
    throw new Error('planBuildTemplateCommitWrites: docs (the exact read documents to validate, the same shape planValidateTemplateCommitReads itself takes) is required');
  }

  var validation = planValidateTemplateCommitReads(pkg, docs);

  if (validation.result === 'alreadyCommitted') {
    return planDeepFreeze({
      result: 'alreadyCommitted',
      writes: [],
      outcome: planDeepClone(validation.outcome)
    });
  }

  // Round-7 review Defect #2: a genuine no-change attempt must never be
  // reported as 'committed' -- there is nothing new to commit, and
  // pkg.candidateWrites is empty by construction (noChangeToCommit gates
  // the entire candidate-write section in 06-write-plan.js). Report the
  // exact prior tuple validation already proved real, not a phantom new
  // manifest/gateway id that will never be written.
  if (validation.result === 'noChange') {
    return planDeepFreeze({
      result: 'noChange',
      writes: [],
      outcome: planDeepClone(validation.outcome)
    });
  }

  if (validation.result !== 'proceed') {
    throw new PlanCommitBlockedError(validation.blockReason, validation.details);
  }

  return planDeepFreeze({
    result: 'committed',
    writes: planDeepClone(pkg.candidateWrites),
    operationId: pkg.operation.operationId,
    templateId: pkg.intent.templateId,
    templateRevisionId: pkg.intent.newTemplateRevisionId,
    gatewayId: pkg.gatewayId
  });
}

// ---- 09-deep-utils.js ----
// planDeepFreeze(value) / planDeepClone(value)
//
// Hand-written recursive deep-freeze and deep-clone utilities for plain
// JSON-shaped data (objects, arrays, strings, numbers, booleans, null --
// the only shapes canonical PLAN data ever takes). Implements the review's
// Defect #4 correction: every returned commitment structure must be deeply
// immutable, and layers that must be independent (e.g. a write plan built
// from a commitment package) must hold their own cloned object graph
// rather than share nested references with the package they were built
// from.
//
// Deliberately NOT implemented as JSON.parse(JSON.stringify(value)):
// that approach silently drops `undefined` values and cannot defend
// against cycles. This implementation is explicit and defends against
// accidental cycles (defensively; canonical PLAN data is a DAG by
// construction and should never contain one).

function planDeepFreeze(value, seen) {
  if (value === null || typeof value !== 'object') return value;
  seen = seen || (typeof Set !== 'undefined' ? new Set() : null);
  if (seen) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  var names = Object.getOwnPropertyNames(value);
  for (var i = 0; i < names.length; i++) {
    var child = value[names[i]];
    if (child !== null && typeof child === 'object') {
      planDeepFreeze(child, seen);
    }
  }
  return Object.freeze(value);
}

function planDeepClone(value, seen) {
  if (value === null || typeof value !== 'object') return value;
  seen = seen || (typeof Map !== 'undefined' ? new Map() : null);
  if (seen && seen.has(value)) return seen.get(value);

  if (Array.isArray(value)) {
    var arr = [];
    if (seen) seen.set(value, arr);
    for (var i = 0; i < value.length; i++) {
      arr.push(planDeepClone(value[i], seen));
    }
    return arr;
  }

  var out = {};
  if (seen) seen.set(value, out);
  var keys = Object.keys(value);
  for (var k = 0; k < keys.length; k++) {
    out[keys[k]] = planDeepClone(value[keys[k]], seen);
  }
  return out;
}

function planDeepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (!planDeepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  var aKeys = Object.keys(a).sort();
  var bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (var k = 0; k < aKeys.length; k++) {
    if (aKeys[k] !== bKeys[k]) return false;
    if (!planDeepEqual(a[aKeys[k]], b[bKeys[k]])) return false;
  }
  return true;
}


// ==================== CANONICAL PLAN VERIFIED READERS AND PROJECTION RECONCILIATION (Slice 4) ====================
// Controlling authority: IRON LOG Canonical PLAN Verified Readers and
// Projection Reconciliation Specification, Draft 0.1 (approved). Every
// function below is pure and side-effect-free: it accepts and returns
// independent plain values, never references Firebase, Firestore handles,
// DOM APIs, appDb, planDraft, navigation, toasts, Save Template, Start on
// Train, or any other existing runtime integration, and never mutates its
// inputs. It reuses the already-accepted Slice 1 primitives declared above
// (planSha256Hex, planBuildCanonicalEncoding, planDeepFreeze, planDeepClone,
// planIsPlainObject, planStripUndefined, planNormalizeAbsent,
// planNormalizeCanonicalGraph, planEnsureDraftIdentities, PLAN_HASH_PLACEHOLDER,
// PLAN_SERVER_TIMESTAMP_SENTINEL, PLAN_SCHEMA_VERSION,
// PLAN_CANONICAL_ENCODING_VERSION) without changing their approved semantics.
//
// This section adds no browser integration of any kind. It is reachable only
// by direct function call from Node (the guarded export block at the bottom
// of this file) or from firebase.js's own private, disabled, dependency-
// injected Slice 4 reader orchestration -- never from any existing production
// caller.

// ---- Known semantic-payload field names per canonical child record type
// (spec Part 5/6). These are EXACTLY the keys planNormalizeCanonicalGraph's
// addNode() calls place into semanticPayload for each record type (see the
// 05-manifest.js/03-normalize.js sections above) -- i.e. exactly what
// payloadHash is computed over, and nothing else. In particular this
// deliberately excludes the namedDependencyFields planNamedDependencyFields
// spreads onto the final WRITTEN document (prescriptionRevisionId,
// implementationRelationshipRevisionId, ruleRevisionIds, assignmentRevisionId,
// setRevisionIds, scheduleOpportunityRevisionIds) -- those are a redundant
// pointer convenience resolved from dependencyRefs at write time, not part of
// the hashed semantic payload, so they must not be included here or every
// recomputed payloadHash would disagree with the real one.
// NOTE: keyed by REVISION record type (e.g. 'planAssignmentRevision'), not
// subject record type -- a manifest chunk entry's own recordType, and a
// revision document's own recordType field, are both always the REVISION
// type (planBuildGraphManifest sorts/labels entries by "recordType then
// recordId (the *revision* record type/id)"); only a subject POINTER
// document (read separately, for a current read's liveness check) carries
// the subject record type instead -- see
// PLAN_READER_REVISION_TO_SUBJECT_RECORD_TYPE below for that mapping. Every
// revision type's semantic field list here is identical in content to its
// subject type's own addNode() payload, since a revision document's
// semantic fields are exactly what was normalized once, at commit time, and
// then copied unchanged onto both the manifest entry and the revision
// document -- a subject POINTER document never itself carries semantic
// payload fields at all.
var PLAN_READER_SEMANTIC_FIELDS = Object.freeze({
  planTemplateRevision: Object.freeze(['templateId', 'name', 'description', 'structureLabel', 'notes']),
  planAssignmentRevision: Object.freeze(['templateId', 'assignmentId', 'instructions', 'assignmentIntent', 'constraintScope', 'resolverPolicy', 'timingSemantics', 'flexibility']),
  planScheduleOpportunityRevision: Object.freeze(['templateId', 'opportunityId', 'microcycle', 'session', 'orderKey', 'recurrence']),
  planPrescriptionRevision: Object.freeze(['templateId', 'assignmentId', 'prescriptionId', 'componentApplicability', 'unresolvedResolutionMethod']),
  planSetRevision: Object.freeze(['prescriptionId', 'setId', 'orderKey', 'weight', 'addedWeight', 'percent', 'reps', 'minReps', 'maxReps', 'rir', 'minRir', 'maxRir', 'seconds', 'minSeconds', 'maxSeconds', 'loadType', 'repsType', 'effortType', 'timeType', 'notes']),
  planRuleRevision: Object.freeze(['templateId', 'assignmentId', 'ruleId', 'enabled', 'evaluationType', 'gatewaySetIndex', 'adjustmentType', 'loadIncrease', 'tmIncrease', 'failBehavior', 'authority', 'scope', 'effectiveBoundary', 'requiredTracks', 'inputContract', 'outputContract']),
  planImplementationRelationshipRevision: Object.freeze(['templateId', 'assignmentId', 'relationshipId', 'exerciseId', 'eligibilityMode', 'sourceRevisionSemantics', 'constraints', 'resolver', 'resolutionTiming', 'permittedBindingScope', 'acceptancePolicy', 'lifecycleInterval'])
});

// Non-Template child REVISION record types that participate in a Template's
// manifest graph. planSetGroupSubject/planSetGroupRevision are deliberately
// excluded: planSetGroupSubject is a reserved record type that Slice 1's
// normalizer never actually materializes (see PLAN_REVISIONED_RECORD_TYPES's
// own omission of it above), so no graph will ever legitimately contain one;
// if a manifest entry ever names it, that is itself an unsupported/
// unexpected-record integrity conflict, handled below.
var PLAN_READER_CHILD_RECORD_TYPES = Object.freeze(['planAssignmentRevision', 'planScheduleOpportunityRevision', 'planPrescriptionRevision', 'planImplementationRelationshipRevision', 'planSetRevision', 'planRuleRevision']);

var PLAN_READER_CHILD_GRAPH_KEY_BY_RECORD_TYPE = Object.freeze({
  planAssignmentRevision: 'assignments',
  planScheduleOpportunityRevision: 'scheduleOpportunities',
  planPrescriptionRevision: 'prescriptions',
  planImplementationRelationshipRevision: 'implementationRelationships',
  planSetRevision: 'sets',
  planRuleRevision: 'rules'
});

// Maps a REVISION record type (as carried by a manifest entry / revision
// document) to its corresponding SUBJECT record type (as carried by the
// separate subject POINTER document read for a current read's liveness
// check). Mirrors exactly the revisionRecordType associations already
// declared in PLAN_COLLECTION_MAP above -- built independently here (rather
// than derived from it at runtime) so this table's correctness is itself
// something the standalone Slice 4 harness can directly assert against the
// real PLAN_COLLECTION_MAP, the same cross-check pattern firebase.js's own
// CANONICAL_COLLECTION_MAP copy already uses.
var PLAN_READER_REVISION_TO_SUBJECT_RECORD_TYPE = Object.freeze({
  planTemplateRevision: 'planTemplateSubject',
  planAssignmentRevision: 'planAssignmentSubject',
  planScheduleOpportunityRevision: 'planScheduleOpportunitySubject',
  planPrescriptionRevision: 'planPrescriptionSubject',
  planSetRevision: 'planSetSubject',
  planRuleRevision: 'planRuleSubject',
  planImplementationRelationshipRevision: 'planImplementationRelationshipSubject'
});

// The one V1 supported schema/encoding pair this reader contract recognizes.
// A read document whose own schemaVersion/canonicalEncodingVersion disagrees
// is classified unsupportedSchema rather than silently verified or
// misinterpreted (spec §6/Part 5).
var PLAN_READER_SUPPORTED_SCHEMA_VERSION = PLAN_SCHEMA_VERSION;
var PLAN_READER_SUPPORTED_ENCODING_VERSION = PLAN_CANONICAL_ENCODING_VERSION;

// Correction round (source review): the reader side needs its own
// generation gate, exactly mirroring the writer side's existing
// minimumAuthoritativeWriterGeneration check (see the schema-authority
// validation inside planValidateTemplateCommitPackage above) rather than
// silently reusing the writer's field or skipping the check entirely. A
// schema-authority document that requires a reader generation higher than
// this reader implements is unsupportedSchema, never silently verified.
var PLAN_READER_SUPPORTED_GENERATION = 1;

// The owner-only V1 authority model this reader enforces, mirroring the
// writer side's own outright rejection of delegated authority (see
// "Actor authority" above): every canonical document a verified read
// trusts must claim authorityKind 'owner' and an actorUid equal to the
// Template's own ownerUid. A document claiming any other authorityKind is
// an unsupported/unvalidated delegation this V1 reader has nothing to
// check it against, so it is rejected outright, never accepted on the
// strength of an unread authorityBasisRefs array.
var PLAN_READER_SUPPORTED_AUTHORITY_KIND = 'owner';

function planReaderHasOwnKey(obj, key) {
  return obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);
}

function planReaderConflict(reason, details) {
  return Object.freeze({ outcome: 'integrityConflict', reason: reason, details: planDeepFreeze(planDeepClone(details || {})) });
}
function planReaderUnsupported(reason, details) {
  return Object.freeze({ outcome: 'unsupportedSchema', reason: reason, details: planDeepFreeze(planDeepClone(details || {})) });
}
function planReaderNotFound() {
  return Object.freeze({ outcome: 'notFound', reason: 'the exact canonical Template subject document is absent' });
}

// Extracts exactly the known semantic fields for one record type from a flat
// stored document (documents are flat in storage -- envelope and semantic
// fields intermixed at the top level; there is no nested semanticPayload key
// to read back). A field absent from the document is simply absent from the
// result, matching planStripUndefined's own contract, so the extracted
// object is byte-identical (once canonically encoded) to what
// planNormalizeCanonicalGraph originally produced and hashed.
function planReaderExtractSemanticPayload(doc, recordType) {
  var fields = PLAN_READER_SEMANTIC_FIELDS[recordType];
  if (!fields) return null;
  var out = {};
  for (var i = 0; i < fields.length; i++) {
    var k = fields[i];
    if (planReaderHasOwnKey(doc, k) && doc[k] !== undefined) out[k] = doc[k];
  }
  return out;
}

function planReaderRecomputePayloadHash(doc, recordType) {
  var payload = planReaderExtractSemanticPayload(doc, recordType);
  if (payload === null) return null;
  return planSha256Hex(planBuildCanonicalEncoding(payload));
}

function planReaderRecomputeDependencyHash(doc) {
  var refs = Array.isArray(doc.dependencyRefs) ? doc.dependencyRefs : [];
  return planSha256Hex(planBuildCanonicalEncoding(refs));
}

// Recomputes one manifest chunk's chunkHash from an ACTUALLY-READ chunk
// document. Two neutralizations are required to reproduce exactly what was
// hashed at write time (planBuildGraphManifest's flushChunk):
//   1. the chunk document's own chunkHash field is forced back to
//      PLAN_HASH_PLACEHOLDER (the value it held at the moment it was hashed,
//      before the real hash existed to fill it in);
//   2. committedAt is restored to the reserved server-timestamp sentinel
//      string (the value planBuildManifestChunkDocumentData set at hash time
//      -- Slice 3's write-time timestamp transform replaces this string with
//      a real server timestamp only once the document is actually written,
//      so an actually-read document never has the sentinel string anymore).
// Skipping either neutralization would make every real, correctly-written
// chunk document's hash appear to disagree with its own claimed chunkHash.
function planReaderRecomputeChunkHash(chunkDoc) {
  var forHash = Object.assign({}, chunkDoc, {
    chunkHash: PLAN_HASH_PLACEHOLDER,
    committedAt: PLAN_SERVER_TIMESTAMP_SENTINEL
  });
  return planSha256Hex(planBuildCanonicalEncoding(forHash));
}

function planReaderRecomputeManifestGraphHash(manifestId, chunkHashesInOrder) {
  return planSha256Hex(planBuildCanonicalEncoding({ manifestId: manifestId, chunkHashes: chunkHashesInOrder }));
}

function planReaderEnvelopeSnapshot(doc) {
  return Object.freeze({
    ownerUid: doc.ownerUid,
    actorUid: doc.actorUid,
    authorityKind: doc.authorityKind,
    authorityScope: doc.authorityScope,
    authorityBasisRefs: doc.authorityBasisRefs,
    clientSchemaGeneration: doc.clientSchemaGeneration,
    sourceKind: doc.sourceKind,
    sourceRefs: doc.sourceRefs,
    clientCreatedAt: doc.clientCreatedAt,
    effectiveBoundary: doc.effectiveBoundary,
    commitState: doc.commitState,
    lifecycleState: doc.lifecycleState,
    canonicalEncodingVersion: doc.canonicalEncodingVersion
  });
}

function planReaderIsSupportedSchemaDoc(doc) {
  return doc && typeof doc === 'object' &&
    doc.schemaVersion === PLAN_READER_SUPPORTED_SCHEMA_VERSION &&
    doc.canonicalEncodingVersion === PLAN_READER_SUPPORTED_ENCODING_VERSION;
}

// ---- Correction round 3 (source review defect #1): shared, record-type-
// agnostic envelope field-check helpers. Every one of these is called
// IDENTICALLY by both the staged-discovery gate for a document type and
// the full validator's own step for that same document type -- there is
// now exactly one implementation of each check, never two hand-copied
// subsets that could silently diverge. Each returns a reject result
// (planReaderConflict/planReaderUnsupported shape) or null (the field is
// valid).
//
// authorityScope: the writer (planBuildTemplateCommitPackage, approved
// Slice 3 behavior this correction does not alter) stamps
// `basis.authorityScope || null` -- every existing genuine commit that
// does not explicitly opt into a caller-supplied scope legitimately
// carries authorityScope: null on every document type. null is therefore
// a valid, compliant value under the approved owner-only V1 model (there
// is no delegated scope to describe), not a missing/ignored field -- but
// a document that DOES carry a non-null authorityScope must carry exactly
// the owner-only shape {kind: 'owner', ownerUid: <the Template's real
// owner>}, and every document in one commit must agree with every other
// (checked separately, at the point in discovery/validation where the
// reference document is already available).
// Round-5 source review: the shape check below previously verified only
// that `scope.kind`/`scope.ownerUid` held the expected VALUES -- it never
// checked that those were the document's ONLY two properties. A forged
// scope carrying a genuine kind/ownerUid pair plus an extra property (e.g.
// { kind: 'owner', ownerUid: <real>, delegatedBy: 'forged' }) therefore
// passed as valid. The approved owner-only V1 writer (planBuildTemplateCommitPackage,
// via envCtx.authorityScope) never produces anything but exactly a plain
// object with these two own enumerable keys and nothing else, or `null` --
// so a third key of any name, on any document, is forged data, not a
// forward-compatible addition. This is now a deterministic exact-key
// check: reject anything that is not a plain object (no arrays, no
// exotic/non-Object.prototype objects such as class instances or
// Object.create(null)), reject any object whose own enumerable key set is
// not precisely {kind, ownerUid} (nothing missing, nothing extra), and
// only then compare the two values.
function planReaderAuthorityScopeShapeValid(scope, ownerUid) {
  if (scope === null) return true;
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return false;
  if (Object.getPrototypeOf(scope) !== Object.prototype) return false;
  var scopeKeys = Object.keys(scope);
  if (scopeKeys.length !== 2 || scopeKeys.indexOf('kind') === -1 || scopeKeys.indexOf('ownerUid') === -1) return false;
  return scope.kind === 'owner' && scope.ownerUid === ownerUid;
}
function planReaderCheckAuthorityScopeShape(doc, ownerUid, category) {
  if (!planReaderAuthorityScopeShapeValid(doc.authorityScope, ownerUid)) {
    return planReaderConflict('authorityScopeMalformed', { category: category });
  }
  return null;
}
function planReaderCheckAuthorityScopeAgreement(doc, ownerUid, referenceScope, category) {
  var shapeReject = planReaderCheckAuthorityScopeShape(doc, ownerUid, category);
  if (shapeReject) return shapeReject;
  if (!planDeepEqual(doc.authorityScope, referenceScope)) {
    return planReaderConflict('authorityScopeDisagreement', { category: category });
  }
  return null;
}

// sourceRefs: every canonical document this reader touches is built off
// planBuildSystemEnvelope or planBuildRevisionEnvelope, both of which
// unconditionally stamp sourceRefs: [] -- always an array, in every
// approved Slice 3 write path.
//
// Round-4 source review Defect #1: checking only Array.isArray accepted an
// arbitrary well-typed but nonempty array (e.g. ['forged/source']) as a
// valid alternate representation. The approved writer never produces
// anything but the literal empty array for this field on any document
// type it writes -- a nonempty array is forged provenance, not schema
// drift, so it is now required to be exactly [].
function planReaderCheckSourceRefs(doc, category) {
  if (!Array.isArray(doc.sourceRefs)) {
    return planReaderConflict('sourceRefsMissing', { category: category });
  }
  if (doc.sourceRefs.length !== 0) {
    return planReaderConflict('sourceRefsUnsupported', { category: category });
  }
  return null;
}

// Round-4 source review Defect #1: authorityBasisRefs was, at every call
// site below, checked only for Array.isArray (shape) and -- at most sites
// -- for agreeing with the Template revision's own value (cross-document
// agreement). Agreement alone cannot catch a forgery that is consistent
// with itself everywhere, including at the document used as the
// comparison reference: an independent probe could set the SAME nonempty
// array on every document in a commit (recomputing every enclosing hash)
// and every existing agreement check would still "agree". Under the
// approved V1 owner-only authority model -- the only authorityKind this
// reader or the Slice 3 writer ever supports; any other value is already
// rejected elsewhere as delegatedAuthorityUnsupported --
// planBuildTemplateCommitPackage's write path stamps authorityBasisRefs:
// [] on every single document type, unconditionally (basis.authorityBasisRefs
// || [], never overridden for owner authority anywhere in the approved
// writer). A nonempty array is therefore forged, delegated-authority-shaped
// provenance riding on an owner-kind envelope -- never a legitimate
// alternate representation. This guard is called at every site that
// already checks the field is an array, immediately after that check, and
// fires independently of any agreement comparison -- so a coherent,
// hash-consistent forgery is blocked exactly like a one-off one.
function planReaderCheckAuthorityBasisRefsUnsupported(doc, category) {
  if (Array.isArray(doc.authorityBasisRefs) && doc.authorityBasisRefs.length !== 0) {
    return planReaderConflict('authorityBasisRefsUnsupported', { category: category });
  }
  return null;
}

// clientSchemaGeneration: every document from one commit shares exactly
// the same basis.clientSchemaGeneration value (see envCtx construction in
// planBuildTemplateCommitPackage above) -- the Template revision is this
// reader's own reference point (checked for shape only, since nothing
// else has been read yet to agree against), every other document's value
// must both be a number AND agree with it exactly.
function planReaderCheckClientSchemaGenerationShape(doc, category) {
  if (typeof doc.clientSchemaGeneration !== 'number') {
    return planReaderConflict('clientSchemaGenerationMalformed', { category: category });
  }
  return null;
}
function planReaderCheckClientSchemaGenerationAgreement(doc, referenceGeneration, category) {
  var shapeReject = planReaderCheckClientSchemaGenerationShape(doc, category);
  if (shapeReject) return shapeReject;
  if (doc.clientSchemaGeneration !== referenceGeneration) {
    return planReaderConflict('clientSchemaGenerationDisagreement', { category: category });
  }
  return null;
}

// clientCreatedAt: required on every commit (planBuildTemplateCommitPackage
// itself requires it as an input -- see the planRequire calls above) and
// stamped identically, unconditionally, on every document type this
// commit writes. Same shape-then-agreement pattern as clientSchemaGeneration.
function planReaderCheckClientCreatedAtShape(doc, category) {
  if (typeof doc.clientCreatedAt !== 'number') {
    return planReaderConflict('clientCreatedAtMalformed', { category: category });
  }
  return null;
}
function planReaderCheckClientCreatedAtAgreement(doc, referenceClientCreatedAt, category) {
  var shapeReject = planReaderCheckClientCreatedAtShape(doc, category);
  if (shapeReject) return shapeReject;
  if (doc.clientCreatedAt !== referenceClientCreatedAt) {
    return planReaderConflict('clientCreatedAtDisagreement', { category: category });
  }
  return null;
}

// committedAt: every document type is stamped with the reserved
// server-timestamp sentinel at write time, which resolves to a genuine
// Timestamp-shaped value once actually committed and read back (mirrors
// firebase.js's own readerLooksLikeServerTimestamp check for the summary
// projection). No cross-document agreement is required (a real Firestore
// server timestamp is not required to be bit-identical across documents
// written in the same transaction), only that it genuinely looks like a
// server-resolved time value rather than a fabricated or missing one.
function planReaderLooksLikeTimestampValue(v) {
  return !!v && typeof v === 'object' && (typeof v.seconds === 'number' || typeof v.toMillis === 'function' || typeof v.toDate === 'function');
}
function planReaderCheckCommittedAt(doc, category) {
  if (!planReaderLooksLikeTimestampValue(doc.committedAt)) {
    return planReaderConflict('committedAtMalformed', { category: category });
  }
  return null;
}
// ---- Correction round 3 (source review defect #2): a manifest entry's
// claimed recordType is a *revision*-type string (e.g. 'planAssignmentRevision'),
// not a subject-type string, so it cannot be resolved directly via the
// Slice 1/2-approved planCollectionInfoForSubjectRecordType/planRevisionPath
// helpers (which are keyed by subject type). This reverse-lookup table and
// helper let the manifest-entry gate independently recompute the canonical
// path a genuine entry of the claimed type/id would have, without touching
// PLAN_COLLECTION_MAP or planRevisionPath themselves.
var PLAN_REVISION_COLLECTION_BY_RECORD_TYPE = (function () {
  var map = {};
  var subjectTypes = Object.keys(PLAN_COLLECTION_MAP);
  for (var i = 0; i < subjectTypes.length; i++) {
    var info = PLAN_COLLECTION_MAP[subjectTypes[i]];
    map[info.revisionRecordType] = info.revisionCollection;
  }
  return Object.freeze(map);
})();
function planReaderCanonicalRevisionPath(ownerUid, revisionRecordType, revisionId) {
  var collection = PLAN_REVISION_COLLECTION_BY_RECORD_TYPE[revisionRecordType];
  if (!collection || !ownerUid || typeof revisionId !== 'string' || !revisionId) return null;
  return 'users/' + ownerUid + '/' + collection + '/' + revisionId;
}

// ---- Correction round 2 (source review defect #2): staged-discovery gate
// functions. firebase.js's assembleTemplateReadDocs previously read the
// entire discovered graph before validating any of it -- it followed a
// caller/stored-data-derived reference (Template subject -> head revision,
// Template revision -> operation/gateway/manifest, manifest root -> chunk
// IDs, manifest chunks -> child record references) before the record that
// supplied that reference had itself been validated at all. Each function
// below is the exact same check planValidateCanonicalTemplateRead performs
// at the equivalent step (verbatim logic, not a re-implementation, so the
// two can never diverge in what they consider valid) but callable in
// isolation, with only the evidence read so far, so firebase.js's
// orchestration can gate each read against it BEFORE following that read's
// own references onward. Each returns null when the stage is valid (safe
// to keep discovering) or the exact same reject result
// (planReaderConflict/planReaderUnsupported/planReaderNotFound shape) the
// full validator would eventually reach on the complete bundle -- so a
// caller that stops discovery on a non-null return and hands whatever was
// read so far to the unchanged full validator still gets back the
// identical outcome/reason it would have gotten from a complete read. This
// is a pure, read-only, side-effect-free re-statement of already-existing
// per-stage rules -- it does not add, remove, or redefine any rule the
// approved contract does not already require.

function planReaderGateSchemaAuthority(schemaAuthority) {
  if (!schemaAuthority || typeof schemaAuthority !== 'object') {
    return planReaderUnsupported('schemaAuthorityMissingOrMalformed', {});
  }
  if (!planReaderHasOwnKey(schemaAuthority, 'enabledCapabilities') || !schemaAuthority.enabledCapabilities || typeof schemaAuthority.enabledCapabilities !== 'object') {
    return planReaderUnsupported('schemaAuthorityMissingOrMalformed', {});
  }
  if (typeof schemaAuthority.minimumAuthoritativeReaderGeneration !== 'number') {
    return planReaderUnsupported('schemaAuthorityMissingOrMalformed', {});
  }
  if (PLAN_READER_SUPPORTED_GENERATION < schemaAuthority.minimumAuthoritativeReaderGeneration) {
    return planReaderUnsupported('unsupportedReaderGeneration', {
      supportedGeneration: PLAN_READER_SUPPORTED_GENERATION,
      minimumRequired: schemaAuthority.minimumAuthoritativeReaderGeneration
    });
  }
  if (schemaAuthority.enabledCapabilities.readCanonicalTemplate !== true) {
    return planReaderUnsupported('readCapabilityDisabled', {});
  }
  return null;
}

// isHistorical: true for a requested (non-current) revision read, which
// never follows templateSubject.headRevisionId at all and therefore does
// not require the Template to currently be active.
function planReaderGateTemplateSubjectForDiscovery(templateSubject, ownerUid, templateId, isHistorical) {
  if (!templateSubject || typeof templateSubject !== 'object') {
    return planReaderNotFound();
  }
  if (templateSubject.recordType !== 'planTemplateSubject' || templateSubject.recordId !== templateId || templateSubject.templateId !== templateId) {
    return planReaderConflict('templateSubjectIdentityMismatch', { recordType: templateSubject.recordType, recordId: templateSubject.recordId, templateId: templateSubject.templateId });
  }
  if (templateSubject.ownerUid !== ownerUid) {
    return planReaderConflict('crossOwnerReference', { field: 'templateSubject.ownerUid' });
  }
  if (!planReaderIsSupportedSchemaDoc(templateSubject)) {
    return planReaderUnsupported('templateSubjectUnsupportedSchemaOrEncoding', { schemaVersion: templateSubject.schemaVersion, canonicalEncodingVersion: templateSubject.canonicalEncodingVersion });
  }
  if (templateSubject.ownerDomain !== 'plan') {
    return planReaderConflict('templateSubjectEnvelopeMalformed', { field: 'ownerDomain' });
  }
  if (templateSubject.authorityKind !== PLAN_READER_SUPPORTED_AUTHORITY_KIND) {
    return planReaderConflict('delegatedAuthorityUnsupported', { category: 'templateSubject' });
  }
  if (!Array.isArray(templateSubject.authorityBasisRefs)) {
    return planReaderConflict('authorityBasisRefsMissing', { category: 'templateSubject' });
  }
  var templateSubjectBasisRefsUnsupportedReject = planReaderCheckAuthorityBasisRefsUnsupported(templateSubject, 'templateSubject');
  if (templateSubjectBasisRefsUnsupportedReject) return templateSubjectBasisRefsUnsupportedReject;
  if (templateSubject.actorUid !== ownerUid) {
    return planReaderConflict('ownerAuthorityActorMismatch', { category: 'templateSubject' });
  }
  // Correction round 3 (source review defect #1): authorityScope (exact
  // shape), sourceRefs (Provenance), clientSchemaGeneration (Authority,
  // shape only here -- agreement with the Template revision is checked
  // later, once it is actually available -- see the head-tuple agreement
  // block below), and committedAt (Time) were never checked on the
  // Template subject.
  var templateSubjectScopeReject = planReaderCheckAuthorityScopeShape(templateSubject, ownerUid, 'templateSubject');
  if (templateSubjectScopeReject) return templateSubjectScopeReject;
  var templateSubjectSourceRefsReject = planReaderCheckSourceRefs(templateSubject, 'templateSubject');
  if (templateSubjectSourceRefsReject) return templateSubjectSourceRefsReject;
  var templateSubjectGenReject = planReaderCheckClientSchemaGenerationShape(templateSubject, 'templateSubject');
  if (templateSubjectGenReject) return templateSubjectGenReject;
  var templateSubjectClientCreatedReject = planReaderCheckClientCreatedAtShape(templateSubject, 'templateSubject');
  if (templateSubjectClientCreatedReject) return templateSubjectClientCreatedReject;
  var templateSubjectCommittedAtReject = planReaderCheckCommittedAt(templateSubject, 'templateSubject');
  if (templateSubjectCommittedAtReject) return templateSubjectCommittedAtReject;
  if (templateSubject.sourceKind !== 'planEditorCommit') {
    return planReaderConflict('templateSubjectEnvelopeMalformed', { field: 'sourceKind' });
  }
  if (templateSubject.commitState !== 'committed') {
    return planReaderConflict('templateSubjectEnvelopeMalformed', { field: 'commitState' });
  }
  if (!isHistorical && templateSubject.lifecycleState !== 'active') {
    return planReaderConflict('templateTerminated', { lifecycleState: templateSubject.lifecycleState });
  }
  return null;
}

function planReaderGateTemplateRevisionForDiscovery(templateRevision, ownerUid, templateId, targetRevisionId) {
  if (!templateRevision || typeof templateRevision !== 'object') {
    return planReaderConflict('missingPlannedRead', { category: 'templateRevision' });
  }
  if (templateRevision.recordType !== 'planTemplateRevision' || templateRevision.subjectId !== templateId || templateRevision.revisionId !== targetRevisionId) {
    return planReaderConflict('templateRevisionIdentityMismatch', { recordType: templateRevision.recordType, subjectId: templateRevision.subjectId, revisionId: templateRevision.revisionId });
  }
  if (templateRevision.recordId !== templateRevision.revisionId) {
    return planReaderConflict('templateRevisionIdentityMismatch', { field: 'recordId' });
  }
  if (templateRevision.ownerUid !== ownerUid) {
    return planReaderConflict('crossOwnerReference', { field: 'templateRevision.ownerUid' });
  }
  if (!planReaderIsSupportedSchemaDoc(templateRevision)) {
    return planReaderUnsupported('templateRevisionUnsupportedSchemaOrEncoding', { schemaVersion: templateRevision.schemaVersion, canonicalEncodingVersion: templateRevision.canonicalEncodingVersion });
  }
  if (templateRevision.commitState !== 'committed') {
    return planReaderConflict('templateRevisionNotCommitted', { commitState: templateRevision.commitState });
  }
  if (templateRevision.ownerDomain !== 'plan') {
    return planReaderConflict('templateRevisionEnvelopeMalformed', { field: 'ownerDomain' });
  }
  if (templateRevision.lifecycleState !== 'active') {
    return planReaderConflict('templateRevisionNotActive', { lifecycleState: templateRevision.lifecycleState });
  }
  if (templateRevision.sourceKind !== 'planEditorCommit') {
    return planReaderConflict('templateRevisionEnvelopeMalformed', { field: 'sourceKind' });
  }
  if (templateRevision.effectiveBoundary !== 'immediate') {
    return planReaderConflict('templateRevisionEnvelopeMalformed', { field: 'effectiveBoundary' });
  }
  if (!Array.isArray(templateRevision.authorityBasisRefs)) {
    return planReaderConflict('authorityBasisRefsMissing', { subjectId: templateId });
  }
  var templateRevisionBasisRefsUnsupportedReject = planReaderCheckAuthorityBasisRefsUnsupported(templateRevision, 'templateRevision');
  if (templateRevisionBasisRefsUnsupportedReject) return templateRevisionBasisRefsUnsupportedReject;
  if (templateRevision.authorityKind !== PLAN_READER_SUPPORTED_AUTHORITY_KIND) {
    return planReaderConflict('delegatedAuthorityUnsupported', { subjectId: templateId, authorityKind: templateRevision.authorityKind });
  }
  if (templateRevision.actorUid !== ownerUid) {
    return planReaderConflict('ownerAuthorityActorMismatch', { subjectId: templateId, actorUid: templateRevision.actorUid, ownerUid: ownerUid });
  }
  // Correction round 3 (source review defect #1): authorityScope, sourceRefs,
  // clientSchemaGeneration, clientCreatedAt, and committedAt were never
  // checked on the Template revision -- the Template revision is this
  // reader's own reference point for every downstream agreement check, so
  // only its own shape is validated here (nothing else has been read yet
  // to agree against).
  var templateRevisionScopeReject = planReaderCheckAuthorityScopeShape(templateRevision, ownerUid, 'templateRevision');
  if (templateRevisionScopeReject) return templateRevisionScopeReject;
  var templateRevisionSourceRefsReject = planReaderCheckSourceRefs(templateRevision, 'templateRevision');
  if (templateRevisionSourceRefsReject) return templateRevisionSourceRefsReject;
  var templateRevisionGenReject = planReaderCheckClientSchemaGenerationShape(templateRevision, 'templateRevision');
  if (templateRevisionGenReject) return templateRevisionGenReject;
  var templateRevisionClientCreatedReject = planReaderCheckClientCreatedAtShape(templateRevision, 'templateRevision');
  if (templateRevisionClientCreatedReject) return templateRevisionClientCreatedReject;
  var templateRevisionCommittedAtReject = planReaderCheckCommittedAt(templateRevision, 'templateRevision');
  if (templateRevisionCommittedAtReject) return templateRevisionCommittedAtReject;
  // Correction round 3 (source review defect #1): applicable lineage
  // fields -- when present, predecessorRevisionId/duplicatedFromSubjectId
  // must be non-empty strings, never a contradictory malformed value.
  if (planReaderHasOwnKey(templateRevision, 'predecessorRevisionId') && templateRevision.predecessorRevisionId !== undefined &&
    (typeof templateRevision.predecessorRevisionId !== 'string' || !templateRevision.predecessorRevisionId)) {
    return planReaderConflict('templateRevisionEnvelopeMalformed', { field: 'predecessorRevisionId' });
  }
  if (planReaderHasOwnKey(templateRevision, 'duplicatedFromSubjectId') && templateRevision.duplicatedFromSubjectId !== undefined &&
    (typeof templateRevision.duplicatedFromSubjectId !== 'string' || !templateRevision.duplicatedFromSubjectId)) {
    return planReaderConflict('templateRevisionEnvelopeMalformed', { field: 'duplicatedFromSubjectId' });
  }
  if (typeof templateRevision.revisionSequence !== 'number') {
    return planReaderConflict('templateRevisionMissingSequence', {});
  }
  var templateRecomputedPayloadHash = planReaderRecomputePayloadHash(templateRevision, 'planTemplateRevision');
  if (templateRecomputedPayloadHash === null || templateRecomputedPayloadHash !== templateRevision.payloadHash) {
    return planReaderConflict('payloadHashMismatch', { subjectId: templateId });
  }
  var templateRecomputedDependencyHash = planReaderRecomputeDependencyHash(templateRevision);
  if (templateRecomputedDependencyHash !== templateRevision.dependencyHash) {
    return planReaderConflict('dependencyHashMismatch', { subjectId: templateId });
  }
  return null;
}

function planReaderGateOperationGatewayForDiscovery(operation, gateway, ownerUid, templateId, templateRevision) {
  if (!operation || typeof operation !== 'object') {
    return planReaderConflict('missingPlannedRead', { category: 'operation' });
  }
  if (!gateway || typeof gateway !== 'object') {
    return planReaderConflict('missingPlannedRead', { category: 'gateway' });
  }
  if (operation.recordType !== 'canonicalOperation' || operation.operationId !== templateRevision.createdByOperationId) {
    return planReaderConflict('operationIdentityMismatch', {});
  }
  if (operation.recordId !== operation.operationId) {
    return planReaderConflict('operationIdentityMismatch', { field: 'recordId' });
  }
  if (gateway.recordType !== 'planCommitGateway' || gateway.gatewayId !== templateRevision.gatewayId) {
    return planReaderConflict('gatewayIdentityMismatch', {});
  }
  if (gateway.recordId !== gateway.gatewayId) {
    return planReaderConflict('gatewayIdentityMismatch', { field: 'recordId' });
  }
  if (gateway.operationId !== operation.operationId || gateway.createdByOperationId !== operation.operationId) {
    return planReaderConflict('gatewayOperationMismatch', {});
  }
  // Round-4 source review Defect #1: the operation's OWN gatewayId field
  // (distinct from the gateway's operationId/createdByOperationId just
  // checked above -- see operationData.gatewayId, app-plan.js's
  // planBuildTemplateCommitPackage) was never cross-checked against the
  // gateway actually being verified. An independent probe changed only
  // canonicalOperation.gatewayId to a forged gateway and it went
  // undetected.
  if (operation.gatewayId !== gateway.gatewayId) {
    return planReaderConflict('operationGatewayMismatch', {});
  }
  if (operation.ownerUid !== ownerUid || gateway.ownerUid !== ownerUid) {
    return planReaderConflict('crossOwnerReference', { field: 'operation/gateway.ownerUid' });
  }
  if (!planReaderIsSupportedSchemaDoc(operation) || !planReaderIsSupportedSchemaDoc(gateway)) {
    return planReaderUnsupported('operationOrGatewayUnsupportedSchemaOrEncoding', {});
  }
  if (operation.templateId !== templateId || gateway.templateId !== templateId) {
    return planReaderConflict('operationOrGatewayTemplateMismatch', {});
  }
  if (gateway.templateRevisionId !== templateRevision.revisionId) {
    return planReaderConflict('gatewayTemplateRevisionMismatch', {});
  }
  if (gateway.manifestId !== templateRevision.manifestId) {
    return planReaderConflict('gatewayManifestMismatch', {});
  }
  if (operation.commitState !== 'committed' || operation.outcome !== 'committed') {
    return planReaderConflict('operationNotCommitted', { commitState: operation.commitState, outcome: operation.outcome });
  }
  if (gateway.commitState !== 'committed') {
    return planReaderConflict('gatewayNotCommitted', { commitState: gateway.commitState });
  }
  if (operation.intentFingerprint !== templateRevision.intentFingerprint) {
    return planReaderConflict('intentFingerprintDisagreement', {});
  }
  if (operation.authorityKind !== PLAN_READER_SUPPORTED_AUTHORITY_KIND || gateway.authorityKind !== PLAN_READER_SUPPORTED_AUTHORITY_KIND) {
    return planReaderConflict('delegatedAuthorityUnsupported', {});
  }
  if (!Array.isArray(operation.authorityBasisRefs) || !Array.isArray(gateway.authorityBasisRefs)) {
    return planReaderConflict('authorityBasisRefsMissing', {});
  }
  var opBasisRefsUnsupportedReject = planReaderCheckAuthorityBasisRefsUnsupported(operation, 'operation');
  if (opBasisRefsUnsupportedReject) return opBasisRefsUnsupportedReject;
  var gwBasisRefsUnsupportedReject = planReaderCheckAuthorityBasisRefsUnsupported(gateway, 'gateway');
  if (gwBasisRefsUnsupportedReject) return gwBasisRefsUnsupportedReject;
  if (operation.actorUid !== ownerUid || gateway.actorUid !== ownerUid) {
    return planReaderConflict('ownerAuthorityActorMismatch', {});
  }
  if (operation.actorUid !== templateRevision.actorUid || gateway.actorUid !== templateRevision.actorUid) {
    return planReaderConflict('actorUidDisagreement', {});
  }
  if (!planDeepEqual(operation.authorityBasisRefs, templateRevision.authorityBasisRefs) || !planDeepEqual(gateway.authorityBasisRefs, templateRevision.authorityBasisRefs)) {
    return planReaderConflict('authorityBasisRefsDisagreement', {});
  }
  if (typeof gateway.writeSetHash !== 'string' || !gateway.writeSetHash) {
    return planReaderConflict('gatewayEnvelopeMalformed', { field: 'writeSetHash' });
  }
  if (operation.sourceKind !== 'planEditorCommit' || gateway.sourceKind !== 'planEditorCommit') {
    return planReaderConflict('operationOrGatewayEnvelopeMalformed', { field: 'sourceKind' });
  }
  if (operation.ownerDomain !== 'plan' || gateway.ownerDomain !== 'plan') {
    return planReaderConflict('operationOrGatewayEnvelopeMalformed', { field: 'ownerDomain' });
  }
  if (operation.lifecycleState !== 'active' || gateway.lifecycleState !== 'active') {
    return planReaderConflict('operationOrGatewayEnvelopeMalformed', { field: 'lifecycleState' });
  }
  if (operation.effectiveBoundary !== 'immediate' || gateway.effectiveBoundary !== 'immediate') {
    return planReaderConflict('operationOrGatewayEnvelopeMalformed', { field: 'effectiveBoundary' });
  }
  // Correction round 3 (source review defect #1): authorityScope,
  // sourceRefs, clientSchemaGeneration (agreement -- an independent probe
  // changed only canonicalOperation.clientSchemaGeneration to 999 and it
  // went undetected), clientCreatedAt (agreement), and committedAt were
  // never checked on the operation or gateway. operation.deviceId/sessionId
  // (required, operation-only fields -- see planBuildTemplateCommitPackage's
  // operationData above) were never checked at all. gateway.manifestHash
  // (a real, independently-writable field distinct from gateway.manifestId
  // -- see the gatewayData literal above) was never cross-checked against
  // the Template revision's own manifestHash -- an independent probe
  // changed only planCommitGateway.manifestHash and it went undetected.
  var opScopeReject = planReaderCheckAuthorityScopeAgreement(operation, ownerUid, templateRevision.authorityScope, 'operation');
  if (opScopeReject) return opScopeReject;
  var gwScopeReject = planReaderCheckAuthorityScopeAgreement(gateway, ownerUid, templateRevision.authorityScope, 'gateway');
  if (gwScopeReject) return gwScopeReject;
  var opSourceRefsReject = planReaderCheckSourceRefs(operation, 'operation');
  if (opSourceRefsReject) return opSourceRefsReject;
  var gwSourceRefsReject = planReaderCheckSourceRefs(gateway, 'gateway');
  if (gwSourceRefsReject) return gwSourceRefsReject;
  var opGenReject = planReaderCheckClientSchemaGenerationAgreement(operation, templateRevision.clientSchemaGeneration, 'operation');
  if (opGenReject) return opGenReject;
  var gwGenReject = planReaderCheckClientSchemaGenerationAgreement(gateway, templateRevision.clientSchemaGeneration, 'gateway');
  if (gwGenReject) return gwGenReject;
  var opClientCreatedReject = planReaderCheckClientCreatedAtAgreement(operation, templateRevision.clientCreatedAt, 'operation');
  if (opClientCreatedReject) return opClientCreatedReject;
  var gwClientCreatedReject = planReaderCheckClientCreatedAtAgreement(gateway, templateRevision.clientCreatedAt, 'gateway');
  if (gwClientCreatedReject) return gwClientCreatedReject;
  var opCommittedAtReject = planReaderCheckCommittedAt(operation, 'operation');
  if (opCommittedAtReject) return opCommittedAtReject;
  var gwCommittedAtReject = planReaderCheckCommittedAt(gateway, 'gateway');
  if (gwCommittedAtReject) return gwCommittedAtReject;
  if (typeof operation.deviceId !== 'string' || !operation.deviceId) {
    return planReaderConflict('operationEnvelopeMalformed', { field: 'deviceId' });
  }
  if (typeof operation.sessionId !== 'string' || !operation.sessionId) {
    return planReaderConflict('operationEnvelopeMalformed', { field: 'sessionId' });
  }
  if (gateway.manifestHash !== templateRevision.manifestHash) {
    return planReaderConflict('gatewayManifestHashMismatch', {});
  }
  // Round-4 source review Defect #1: the operation's own claimed
  // operationType (a writer constant -- see operationData.operationType,
  // app-plan.js's planBuildTemplateCommitPackage, always
  // 'commitPlanTemplateRevision' for this write path) was never checked at
  // all.
  if (operation.operationType !== 'commitPlanTemplateRevision') {
    return planReaderConflict('operationEnvelopeMalformed', { field: 'operationType' });
  }
  // Round-4 source review Defect #1: the gateway's expectedPredecessorRevisionId
  // (the Template head's frozen expectation, stamped at commit time from
  // basis.templateSubject.headRevisionId -- see gatewayData.expectedPredecessorRevisionId,
  // app-plan.js) was never cross-checked against anything. The Template
  // revision's own predecessorRevisionId field (planBuildRevisionEnvelope,
  // stamped from the exact same prior-head lookup for the Template's own
  // revision entry) is the independent evidence for the same fact -- both
  // are absent/null together (a brand-new Template's first revision) or
  // agree exactly otherwise.
  var expectedGatewayPredecessor = (typeof templateRevision.predecessorRevisionId === 'string' && templateRevision.predecessorRevisionId) ? templateRevision.predecessorRevisionId : null;
  var actualGatewayPredecessor = planReaderHasOwnKey(gateway, 'expectedPredecessorRevisionId') ? gateway.expectedPredecessorRevisionId : undefined;
  if (actualGatewayPredecessor !== expectedGatewayPredecessor) {
    return planReaderConflict('gatewayExpectedPredecessorRevisionIdMismatch', {});
  }
  return null;
}

function planReaderGateManifestRootForDiscovery(manifestRoot, ownerUid, templateId, templateRevision, operation, gateway) {
  if (!manifestRoot || typeof manifestRoot !== 'object') {
    return planReaderConflict('missingPlannedRead', { category: 'manifestRoot' });
  }
  if (manifestRoot.recordType !== 'planGraphManifest' || manifestRoot.manifestId !== templateRevision.manifestId) {
    return planReaderConflict('manifestRootIdentityMismatch', {});
  }
  if (manifestRoot.recordId !== manifestRoot.manifestId) {
    return planReaderConflict('manifestRootIdentityMismatch', { field: 'recordId' });
  }
  if (manifestRoot.ownerUid !== ownerUid) {
    return planReaderConflict('crossOwnerReference', { field: 'manifestRoot.ownerUid' });
  }
  if (!planReaderIsSupportedSchemaDoc(manifestRoot)) {
    return planReaderUnsupported('manifestRootUnsupportedSchemaOrEncoding', {});
  }
  if (manifestRoot.templateId !== templateId || manifestRoot.templateRevisionId !== templateRevision.revisionId) {
    return planReaderConflict('manifestRootTemplateMismatch', {});
  }
  if (manifestRoot.graphHash !== templateRevision.manifestHash) {
    return planReaderConflict('manifestRootHashClaimMismatch', {});
  }
  if (manifestRoot.ownerDomain !== 'plan') {
    return planReaderConflict('manifestRootEnvelopeMalformed', { field: 'ownerDomain' });
  }
  if (manifestRoot.authorityKind !== PLAN_READER_SUPPORTED_AUTHORITY_KIND || manifestRoot.actorUid !== ownerUid) {
    return planReaderConflict('delegatedAuthorityUnsupported', { category: 'manifestRoot' });
  }
  if (manifestRoot.actorUid !== templateRevision.actorUid) {
    return planReaderConflict('actorUidDisagreement', { category: 'manifestRoot' });
  }
  if (!Array.isArray(manifestRoot.authorityBasisRefs)) {
    return planReaderConflict('authorityBasisRefsMissing', { category: 'manifestRoot' });
  }
  var manifestRootBasisRefsUnsupportedReject = planReaderCheckAuthorityBasisRefsUnsupported(manifestRoot, 'manifestRoot');
  if (manifestRootBasisRefsUnsupportedReject) return manifestRootBasisRefsUnsupportedReject;
  if (!planDeepEqual(manifestRoot.authorityBasisRefs, templateRevision.authorityBasisRefs)) {
    return planReaderConflict('authorityBasisRefsDisagreement', { category: 'manifestRoot' });
  }
  // Round-4 source review Defect #1: the manifest root's own provenance
  // (operationId -- its plain, doc-type-specific field, plus the shared
  // system envelope's updatedByOperationId/createdByOperationId/gatewayId
  // -- see the planGraphManifest write literal, app-plan.js's
  // planBuildTemplateCommitPackage) was never cross-checked against the
  // operation/gateway this read already verified. An independent probe
  // changed only manifestRoot.operationId to a forged operation and it
  // went undetected.
  if (manifestRoot.operationId !== operation.operationId || manifestRoot.updatedByOperationId !== operation.operationId || manifestRoot.createdByOperationId !== operation.operationId) {
    return planReaderConflict('manifestRootProvenanceMismatch', {});
  }
  if (manifestRoot.gatewayId !== gateway.gatewayId) {
    return planReaderConflict('manifestRootProvenanceMismatch', { field: 'gatewayId' });
  }
  if (manifestRoot.sourceKind !== 'planEditorCommit') {
    return planReaderConflict('manifestRootEnvelopeMalformed', { field: 'sourceKind' });
  }
  if (manifestRoot.effectiveBoundary !== 'immediate') {
    return planReaderConflict('manifestRootEnvelopeMalformed', { field: 'effectiveBoundary' });
  }
  if (manifestRoot.commitState !== 'committed') {
    return planReaderConflict('manifestRootEnvelopeMalformed', { field: 'commitState' });
  }
  // Correction round 3 (source review defect #1): lifecycleState
  // (Lifecycle -- the writer stamps 'active' unconditionally, see
  // planBuildTemplateCommitPackage's manifest write above), authorityScope,
  // sourceRefs, clientSchemaGeneration, clientCreatedAt, and committedAt
  // were never checked on the manifest root.
  if (manifestRoot.lifecycleState !== 'active') {
    return planReaderConflict('manifestRootEnvelopeMalformed', { field: 'lifecycleState' });
  }
  var manifestRootScopeReject = planReaderCheckAuthorityScopeAgreement(manifestRoot, ownerUid, templateRevision.authorityScope, 'manifestRoot');
  if (manifestRootScopeReject) return manifestRootScopeReject;
  var manifestRootSourceRefsReject = planReaderCheckSourceRefs(manifestRoot, 'manifestRoot');
  if (manifestRootSourceRefsReject) return manifestRootSourceRefsReject;
  var manifestRootGenReject = planReaderCheckClientSchemaGenerationAgreement(manifestRoot, templateRevision.clientSchemaGeneration, 'manifestRoot');
  if (manifestRootGenReject) return manifestRootGenReject;
  var manifestRootClientCreatedReject = planReaderCheckClientCreatedAtAgreement(manifestRoot, templateRevision.clientCreatedAt, 'manifestRoot');
  if (manifestRootClientCreatedReject) return manifestRootClientCreatedReject;
  var manifestRootCommittedAtReject = planReaderCheckCommittedAt(manifestRoot, 'manifestRoot');
  if (manifestRootCommittedAtReject) return manifestRootCommittedAtReject;
  if (!Array.isArray(manifestRoot.chunkIds) || !Array.isArray(templateRevision.manifestChunkIds) || manifestRoot.chunkIds.length !== templateRevision.manifestChunkIds.length) {
    return planReaderConflict('manifestChunkIdsMismatch', {});
  }
  for (var mc = 0; mc < manifestRoot.chunkIds.length; mc++) {
    if (manifestRoot.chunkIds[mc] !== templateRevision.manifestChunkIds[mc]) {
      return planReaderConflict('manifestChunkIdsMismatch', {});
    }
  }
  if (!Array.isArray(manifestRoot.chunkHashes) || manifestRoot.chunkHashes.length !== manifestRoot.chunkIds.length) {
    return planReaderConflict('manifestChunkHashesCountMismatch', {});
  }
  return null;
}

// ordinal: this chunk's expected zero-based position in manifestRoot.chunkIds.
function planReaderGateManifestChunkForDiscovery(chunkDoc, expectedChunkId, ordinal, ownerUid, manifestRoot, templateRevision, operation, gateway) {
  if (!chunkDoc || typeof chunkDoc !== 'object') {
    return planReaderConflict('missingPlannedRead', { category: 'manifestChunk', chunkId: expectedChunkId });
  }
  if (chunkDoc.recordType !== 'planGraphManifestChunk' || chunkDoc.chunkId !== expectedChunkId || chunkDoc.recordId !== expectedChunkId) {
    return planReaderConflict('chunkIdentityMismatch', { expectedChunkId: expectedChunkId });
  }
  if (chunkDoc.ownerUid !== ownerUid) {
    return planReaderConflict('crossOwnerReference', { field: 'manifestChunk.ownerUid', chunkId: expectedChunkId });
  }
  if (!planReaderIsSupportedSchemaDoc(chunkDoc)) {
    return planReaderUnsupported('manifestChunkUnsupportedSchemaOrEncoding', { chunkId: expectedChunkId });
  }
  if (chunkDoc.manifestId !== manifestRoot.manifestId) {
    return planReaderConflict('chunkManifestMismatch', { chunkId: expectedChunkId });
  }
  if (chunkDoc.ownerDomain !== 'plan') {
    return planReaderConflict('chunkEnvelopeMalformed', { chunkId: expectedChunkId, field: 'ownerDomain' });
  }
  if (chunkDoc.authorityKind !== PLAN_READER_SUPPORTED_AUTHORITY_KIND || chunkDoc.actorUid !== ownerUid) {
    return planReaderConflict('delegatedAuthorityUnsupported', { category: 'manifestChunk', chunkId: expectedChunkId });
  }
  if (chunkDoc.actorUid !== templateRevision.actorUid) {
    return planReaderConflict('actorUidDisagreement', { category: 'manifestChunk', chunkId: expectedChunkId });
  }
  if (chunkDoc.operationId !== operation.operationId || chunkDoc.gatewayId !== gateway.gatewayId) {
    return planReaderConflict('chunkProvenanceMismatch', { chunkId: expectedChunkId });
  }
  var chunkBasisRefsUnsupportedReject = planReaderCheckAuthorityBasisRefsUnsupported(chunkDoc, 'manifestChunk');
  if (chunkBasisRefsUnsupportedReject) return chunkBasisRefsUnsupportedReject;
  if (!Array.isArray(chunkDoc.authorityBasisRefs) || !planDeepEqual(chunkDoc.authorityBasisRefs, templateRevision.authorityBasisRefs)) {
    return planReaderConflict('authorityBasisRefsDisagreement', { category: 'manifestChunk', chunkId: expectedChunkId });
  }
  if (chunkDoc.sourceKind !== 'planEditorCommit') {
    return planReaderConflict('chunkEnvelopeMalformed', { chunkId: expectedChunkId, field: 'sourceKind' });
  }
  if (chunkDoc.effectiveBoundary !== 'immediate') {
    return planReaderConflict('chunkEnvelopeMalformed', { chunkId: expectedChunkId, field: 'effectiveBoundary' });
  }
  if (chunkDoc.commitState !== 'committed') {
    return planReaderConflict('chunkEnvelopeMalformed', { chunkId: expectedChunkId, field: 'commitState' });
  }
  // Correction round 3 (source review defect #1): lifecycleState,
  // authorityScope, sourceRefs, clientSchemaGeneration, clientCreatedAt,
  // and committedAt were never checked on a manifest chunk.
  if (chunkDoc.lifecycleState !== 'active') {
    return planReaderConflict('chunkEnvelopeMalformed', { chunkId: expectedChunkId, field: 'lifecycleState' });
  }
  var chunkScopeReject = planReaderCheckAuthorityScopeAgreement(chunkDoc, ownerUid, templateRevision.authorityScope, 'manifestChunk');
  if (chunkScopeReject) return chunkScopeReject;
  var chunkSourceRefsReject = planReaderCheckSourceRefs(chunkDoc, 'manifestChunk');
  if (chunkSourceRefsReject) return chunkSourceRefsReject;
  var chunkGenReject = planReaderCheckClientSchemaGenerationAgreement(chunkDoc, templateRevision.clientSchemaGeneration, 'manifestChunk');
  if (chunkGenReject) return chunkGenReject;
  var chunkClientCreatedReject = planReaderCheckClientCreatedAtAgreement(chunkDoc, templateRevision.clientCreatedAt, 'manifestChunk');
  if (chunkClientCreatedReject) return chunkClientCreatedReject;
  var chunkCommittedAtReject = planReaderCheckCommittedAt(chunkDoc, 'manifestChunk');
  if (chunkCommittedAtReject) return chunkCommittedAtReject;
  if (chunkDoc.chunkOrdinal !== ordinal) {
    return planReaderConflict('chunkOrderMismatch', { chunkId: expectedChunkId, expectedOrdinal: ordinal, actualOrdinal: chunkDoc.chunkOrdinal });
  }
  if (!Array.isArray(chunkDoc.entries) || chunkDoc.entries.length !== chunkDoc.entryCount) {
    return planReaderConflict('chunkBoundsMismatch', { chunkId: expectedChunkId });
  }
  var recomputedHash = planReaderRecomputeChunkHash(chunkDoc);
  if (recomputedHash !== chunkDoc.chunkHash) {
    return planReaderConflict('chunkHashMismatch', { chunkId: expectedChunkId });
  }
  if (!Array.isArray(manifestRoot.chunkHashes) || recomputedHash !== manifestRoot.chunkHashes[ordinal]) {
    return planReaderConflict('manifestChunkHashClaimMismatch', { chunkId: expectedChunkId });
  }
  return null;
}

// Structural pre-check on one manifest entry, run before its child
// reference (entry.subjectId/entry.recordType/entry.revisionId) is ever
// resolved into a document read. seenEntrySubjectIdsSoFar: a plain map of
// every entry subjectId already accepted earlier in this same discovery
// attempt (across every chunk processed so far), used to catch a duplicate
// entry before a second, wasted read of the same child is even attempted.
// targetTemplateRevisionId: the caller's already-verified target Template
// revision ID (Step 3's targetRevisionId in the full validator; the
// already-gated templateRevision.revisionId in firebase.js's staged
// discovery) -- required so the Template's own manifest entry (below) can
// be checked against independent evidence, never trusted from the entry
// itself, which is exactly the value under test.
function planReaderGateManifestEntryForDiscovery(entry, templateId, ownerUid, seenEntrySubjectIdsSoFar, targetTemplateRevisionId) {
  if (!entry || typeof entry !== 'object' || typeof entry.subjectId !== 'string' || !entry.subjectId) {
    return planReaderConflict('malformedManifestEntry', {});
  }
  // Correction round 3 (source review defect #2): duplicate-tracking now
  // covers the Template's own manifest entry too, and marking happens here,
  // inside the gate, on every accepted entry -- not only in the caller and
  // not only for non-Template entries -- so a duplicate Template entry is
  // caught exactly like a duplicate child entry would be.
  if (seenEntrySubjectIdsSoFar && planReaderHasOwnKey(seenEntrySubjectIdsSoFar, entry.subjectId)) {
    return planReaderConflict('duplicateManifestEntry', { subjectId: entry.subjectId });
  }
  if (entry.subjectId === templateId) {
    // Round-4 source review Defect #2: this used to return null here,
    // immediately after the duplicate check, before ANY of the recordType/
    // revisionId/recordId/path checks every non-Template entry receives
    // just below -- an independent probe changed only the Template entry's
    // path, recomputed the chunk hash and the complete manifest graph
    // hash, and propagated the new hash through the Template revision,
    // Template head, and gateway, and it still received verifiedCurrent.
    // The Template entry now receives the exact same identity/path checks,
    // against the caller-supplied, already-verified target revision ID --
    // this is still never itself resolved as a *child* reference (the
    // Template's own revision document is separately, independently read
    // and gated by planReaderGateTemplateRevisionForDiscovery), but its
    // manifest entry can no longer bypass identity/path validation the way
    // every other entry already receives.
    if (entry.recordType !== 'planTemplateRevision') {
      return planReaderConflict('unsupportedCanonicalRecordType', { recordType: entry.recordType, subjectId: entry.subjectId });
    }
    if (typeof targetTemplateRevisionId !== 'string' || !targetTemplateRevisionId || entry.revisionId !== targetTemplateRevisionId) {
      return planReaderConflict('manifestEntryIdentityMismatch', { subjectId: entry.subjectId, field: 'revisionId' });
    }
    if (entry.recordId !== entry.revisionId) {
      return planReaderConflict('manifestEntryIdentityMismatch', { subjectId: entry.subjectId, field: 'recordId' });
    }
    var expectedTemplateEntryPath = planReaderCanonicalRevisionPath(ownerUid, entry.recordType, entry.revisionId);
    if (expectedTemplateEntryPath === null || entry.path !== expectedTemplateEntryPath) {
      return planReaderConflict('manifestEntryPathMismatch', { subjectId: entry.subjectId });
    }
    if (seenEntrySubjectIdsSoFar) seenEntrySubjectIdsSoFar[entry.subjectId] = true;
    return null;
  }
  if (typeof entry.recordType !== 'string' || PLAN_READER_CHILD_RECORD_TYPES.indexOf(entry.recordType) === -1) {
    return planReaderConflict('unsupportedCanonicalRecordType', { recordType: entry.recordType, subjectId: entry.subjectId });
  }
  if (typeof entry.revisionId !== 'string' || !entry.revisionId) {
    return planReaderConflict('malformedManifestEntry', { subjectId: entry.subjectId });
  }
  // Correction round 3 (source review defect #2): the entry's claimed
  // recordId and path are now independently checked against what a genuine
  // entry of this claimed type/id would look like, before this entry is
  // ever used to resolve and fetch a document. A forged recordId or a
  // forged path (even one that has been coherently re-hashed into the
  // manifest chain around it) is blocked here, before any get is issued.
  if (entry.recordId !== entry.revisionId) {
    return planReaderConflict('manifestEntryIdentityMismatch', { subjectId: entry.subjectId, field: 'recordId' });
  }
  var expectedEntryPath = planReaderCanonicalRevisionPath(ownerUid, entry.recordType, entry.revisionId);
  if (expectedEntryPath === null || entry.path !== expectedEntryPath) {
    return planReaderConflict('manifestEntryPathMismatch', { subjectId: entry.subjectId });
  }
  if (seenEntrySubjectIdsSoFar) seenEntrySubjectIdsSoFar[entry.subjectId] = true;
  return null;
}

// ---- planValidateCanonicalTemplateRead(input) ----
// input: {
//   ownerUid, templateId, requestedRevisionId (string, historical target, or
//   null/undefined for "verify the current head"),
//   docs: {
//     schemaAuthority, templateSubject, templateRevision, manifestRoot,
//     manifestChunks: [ {chunkId, doc}, ... ]  -- in the exact order named by
//       templateRevision.manifestChunkIds,
//     operation, gateway,
//     childRevisions: { [subjectId]: doc },  // every non-Template revision
//       named by a manifest chunk entry
//     childSubjects: { [subjectId]: doc }    // every non-Template subject
//       pointer named by a manifest chunk entry (only required/consulted for
//       a CURRENT read's liveness cross-check; may be {} for a historical
//       read)
//   }
// }
// Every document value may be null/undefined to represent "this planned read
// came back absent" -- the caller (firebase.js's private orchestration) is
// responsible for having actually attempted every planned read before calling
// this function; a null here is always treated as "missing", never silently
// skipped.
function planValidateCanonicalTemplateRead(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('planValidateCanonicalTemplateRead: input is required');
  }
  if (typeof input.ownerUid !== 'string' || !input.ownerUid) {
    throw new Error('planValidateCanonicalTemplateRead: input.ownerUid is required');
  }
  if (typeof input.templateId !== 'string' || !input.templateId) {
    throw new Error('planValidateCanonicalTemplateRead: input.templateId is required');
  }
  if (input.requestedRevisionId !== null && input.requestedRevisionId !== undefined && typeof input.requestedRevisionId !== 'string') {
    throw new Error('planValidateCanonicalTemplateRead: input.requestedRevisionId must be a string, null, or undefined');
  }
  if (!input.docs || typeof input.docs !== 'object') {
    throw new Error('planValidateCanonicalTemplateRead: input.docs is required');
  }

  var ownerUid = input.ownerUid;
  var templateId = input.templateId;
  var isHistorical = (typeof input.requestedRevisionId === 'string' && input.requestedRevisionId.length > 0);
  var docs = input.docs;

  // ---- Step 1: schema authority (read as part of every attempt; spec Part 4 step 2) ----
  var schemaAuthority = docs.schemaAuthority;
  if (!schemaAuthority || typeof schemaAuthority !== 'object') {
    return planReaderUnsupported('schemaAuthorityMissingOrMalformed', {});
  }
  if (!planReaderHasOwnKey(schemaAuthority, 'enabledCapabilities') || !schemaAuthority.enabledCapabilities || typeof schemaAuthority.enabledCapabilities !== 'object') {
    return planReaderUnsupported('schemaAuthorityMissingOrMalformed', {});
  }
  // Correction round (source review defect #1): a present-but-malformed
  // generation field, or a genuinely disabled/absent reader capability,
  // previously went completely unchecked -- an independent probe declared
  // readCanonicalTemplate: false and an unsupported minimum generation and
  // still received verifiedCurrent. Both are now required, exactly
  // mirroring the writer side's own generation-gate pattern.
  if (typeof schemaAuthority.minimumAuthoritativeReaderGeneration !== 'number') {
    return planReaderUnsupported('schemaAuthorityMissingOrMalformed', {});
  }
  if (PLAN_READER_SUPPORTED_GENERATION < schemaAuthority.minimumAuthoritativeReaderGeneration) {
    return planReaderUnsupported('unsupportedReaderGeneration', {
      supportedGeneration: PLAN_READER_SUPPORTED_GENERATION,
      minimumRequired: schemaAuthority.minimumAuthoritativeReaderGeneration
    });
  }
  if (schemaAuthority.enabledCapabilities.readCanonicalTemplate !== true) {
    return planReaderUnsupported('readCapabilityDisabled', {});
  }

  // ---- Step 2: exact Template subject (spec Part 4 steps 2-3) ----
  // Correction round 3 (source review defect #2): this step now calls the
  // EXACT SAME gate function firebase.js's staged discovery calls at this
  // point, rather than maintaining a second, separately hand-copied
  // implementation -- guaranteeing the two can never drift apart again.
  var templateSubject = docs.templateSubject;
  var templateSubjectReject = planReaderGateTemplateSubjectForDiscovery(templateSubject, ownerUid, templateId, isHistorical);
  if (templateSubjectReject) return templateSubjectReject;

  // ---- Step 3: which revision are we verifying? ----
  var targetRevisionId = isHistorical ? input.requestedRevisionId : templateSubject.headRevisionId;
  if (typeof targetRevisionId !== 'string' || !targetRevisionId) {
    return planReaderConflict('templateSubjectMissingHeadRevisionId', {});
  }

  // Correction round 3 (source review defect #2): this step now calls the
  // EXACT SAME gate function firebase.js's staged discovery calls at this
  // point (see the comment on Step 2 above for why).
  var templateRevision = docs.templateRevision;
  var templateRevisionReject = planReaderGateTemplateRevisionForDiscovery(templateRevision, ownerUid, templateId, targetRevisionId);
  if (templateRevisionReject) return templateRevisionReject;

  // ---- Step 4 (current only): head tuple agreement (spec Part 4 step 10 / §10) ----
  // (the terminated-liveness check that used to open this block now runs
  // earlier, immediately after Step 2 -- see the comment there.)
  if (!isHistorical) {
    if (templateSubject.headManifestId !== templateRevision.manifestId) {
      return planReaderConflict('headManifestMismatch', {});
    }
    if (templateSubject.headManifestHash !== templateRevision.manifestHash) {
      return planReaderConflict('headManifestHashMismatch', {});
    }
    if (templateSubject.headOperationId !== templateRevision.createdByOperationId) {
      return planReaderConflict('headOperationMismatch', {});
    }
    if (templateSubject.headGatewayId !== templateRevision.gatewayId) {
      return planReaderConflict('headGatewayMismatch', {});
    }
    // Round-4 source review Defect #1: templateSubject's OWN system-
    // envelope provenance fields (updatedByOperationId/gatewayId -- stamped
    // by planBuildSystemEnvelope, distinct from the head*-prefixed fields
    // just checked above, which are this document type's own extra fields)
    // were never cross-checked at all. An independent probe changed only
    // updatedByOperationId to a forged operation and it went undetected.
    if (templateSubject.updatedByOperationId !== templateRevision.createdByOperationId) {
      return planReaderConflict('updatedByOperationIdMismatch', { category: 'templateSubject' });
    }
    if (templateSubject.gatewayId !== templateRevision.gatewayId) {
      return planReaderConflict('templateSubjectGatewayMismatch', {});
    }
    // Round-4 source review Defect #1: headIntentFingerprint (stamped from
    // the exact same intentFingerprint value written onto the Template
    // revision and the operation -- see intentFingerprintSource/
    // templateSubjectWriteData.headIntentFingerprint, app-plan.js's
    // planBuildTemplateCommitPackage) was never checked against anything.
    if (templateSubject.headIntentFingerprint !== templateRevision.intentFingerprint) {
      return planReaderConflict('headIntentFingerprintMismatch', {});
    }
    // Round-4 source review Defect #1: applicable creation-provenance/
    // duplication-lineage consistency between the Template subject pointer
    // and the Template revision it currently points at -- both are
    // stamped duplicatedFromSubjectId together, from the same lookup, only
    // when the Template itself is a brand-new duplication target (see
    // templateSubjectWriteData/planBuildRevisionEnvelope's
    // duplicatedFromSubjectId stamps, app-plan.js) -- so one carrying it
    // while the other does not, or the two disagreeing on its value, is a
    // contradiction.
    var templateSubjectDupFrom = planReaderHasOwnKey(templateSubject, 'duplicatedFromSubjectId') ? templateSubject.duplicatedFromSubjectId : undefined;
    var templateRevisionDupFrom = planReaderHasOwnKey(templateRevision, 'duplicatedFromSubjectId') ? templateRevision.duplicatedFromSubjectId : undefined;
    if (templateSubjectDupFrom !== undefined && (typeof templateSubjectDupFrom !== 'string' || !templateSubjectDupFrom)) {
      return planReaderConflict('templateSubjectEnvelopeMalformed', { field: 'duplicatedFromSubjectId' });
    }
    if ((templateSubjectDupFrom !== undefined || templateRevisionDupFrom !== undefined) && templateSubjectDupFrom !== templateRevisionDupFrom) {
      return planReaderConflict('duplicationLineageDisagreement', { category: 'templateSubject' });
    }
    // Correction round 2 (source review defect #1): templateSubject's own
    // actor/authority envelope (validated for shape in Step 2 above) must
    // also AGREE with the Template revision it currently points at -- both
    // are stamped by the exact same commit's shared envelope context.
    if (templateSubject.actorUid !== templateRevision.actorUid) {
      return planReaderConflict('actorUidDisagreement', { category: 'templateSubject' });
    }
    if (!planDeepEqual(templateSubject.authorityBasisRefs, templateRevision.authorityBasisRefs)) {
      return planReaderConflict('authorityBasisRefsDisagreement', { category: 'templateSubject' });
    }
    // Correction round 3 (source review defect #1): templateSubject's
    // authorityScope, clientSchemaGeneration, and clientCreatedAt (each
    // already shape-checked in Step 2) must also AGREE with the Template
    // revision it currently points at, exactly like every other document
    // in this commit -- only checkable here, once templateRevision itself
    // has been read and independently verified.
    var templateSubjectScopeAgreeReject = planReaderCheckAuthorityScopeAgreement(templateSubject, ownerUid, templateRevision.authorityScope, 'templateSubject');
    if (templateSubjectScopeAgreeReject) return templateSubjectScopeAgreeReject;
    var templateSubjectGenAgreeReject = planReaderCheckClientSchemaGenerationAgreement(templateSubject, templateRevision.clientSchemaGeneration, 'templateSubject');
    if (templateSubjectGenAgreeReject) return templateSubjectGenAgreeReject;
    var templateSubjectClientCreatedAgreeReject = planReaderCheckClientCreatedAtAgreement(templateSubject, templateRevision.clientCreatedAt, 'templateSubject');
    if (templateSubjectClientCreatedAgreeReject) return templateSubjectClientCreatedAgreeReject;
    // Correction round (source review defect #1): an independent probe
    // changed only templateSubject.headSequence, leaving every other head
    // tuple field agreeing, and it went undetected -- headSequence was
    // never part of the tuple this step actually compared. It must now
    // agree with the Template revision's own revisionSequence (both are
    // computed identically at commit time -- see planBuildTemplateCommitPackage
    // above), and a mismatch blocks even when headRevisionId matches.
    if (templateSubject.headSequence !== templateRevision.revisionSequence) {
      return planReaderConflict('headSequenceMismatch', {});
    }
    var expectedChunkIds = Array.isArray(templateSubject.headManifestChunkIds) ? templateSubject.headManifestChunkIds : null;
    if (!expectedChunkIds || !Array.isArray(templateRevision.manifestChunkIds) || expectedChunkIds.length !== templateRevision.manifestChunkIds.length) {
      return planReaderConflict('headManifestChunkIdsMismatch', {});
    }
    for (var hc = 0; hc < expectedChunkIds.length; hc++) {
      if (expectedChunkIds[hc] !== templateRevision.manifestChunkIds[hc]) {
        return planReaderConflict('headManifestChunkIdsMismatch', {});
      }
    }
  }

  // ---- Step 5: operation and gateway (spec §10) ----
  // Correction round 3 (source review defect #2): this step now calls the
  // EXACT SAME gate function firebase.js's staged discovery calls at this
  // point (see the comment on Step 2 above for why).
  var operation = docs.operation;
  var gateway = docs.gateway;
  var operationGatewayReject = planReaderGateOperationGatewayForDiscovery(operation, gateway, ownerUid, templateId, templateRevision);
  if (operationGatewayReject) return operationGatewayReject;

  // ---- Step 5b (current only): head tuple fields whose independent
  // evidence is the operation/gateway just verified in Step 5, not the
  // Template revision checked in Step 4 (spec §10) ----
  // Round-4 source review Defect #1: headWriteSetHash, headDeviceId/
  // headSessionId, and headExpectedPredecessorRevisionId are all real,
  // independently-writable fields on the Template subject pointer (see
  // templateSubjectWriteData, app-plan.js's planBuildTemplateCommitPackage)
  // that were never cross-checked against anything at all. Three
  // independent probes (a forged headWriteSetHash, a forged headDeviceId,
  // and -- by the same gap -- a forged headSessionId/
  // headExpectedPredecessorRevisionId) all went undetected.
  if (!isHistorical) {
    if (typeof templateSubject.headWriteSetHash !== 'string' || !/^[0-9a-f]{64}$/.test(templateSubject.headWriteSetHash)) {
      return planReaderConflict('templateSubjectEnvelopeMalformed', { field: 'headWriteSetHash' });
    }
    if (templateSubject.headWriteSetHash !== gateway.writeSetHash) {
      return planReaderConflict('headWriteSetHashMismatch', {});
    }
    if (templateSubject.headDeviceId !== operation.deviceId) {
      return planReaderConflict('headDeviceIdMismatch', {});
    }
    if (templateSubject.headSessionId !== operation.sessionId) {
      return planReaderConflict('headSessionIdMismatch', {});
    }
    var expectedHeadPredecessor = planReaderHasOwnKey(gateway, 'expectedPredecessorRevisionId') ? gateway.expectedPredecessorRevisionId : undefined;
    var actualHeadPredecessor = planReaderHasOwnKey(templateSubject, 'headExpectedPredecessorRevisionId') ? templateSubject.headExpectedPredecessorRevisionId : undefined;
    if (actualHeadPredecessor !== expectedHeadPredecessor) {
      return planReaderConflict('headExpectedPredecessorRevisionIdMismatch', {});
    }
  }

  // ---- Step 6: manifest root (spec §10) ----
  // Correction round 3 (source review defect #2): this step now calls the
  // EXACT SAME gate function firebase.js's staged discovery calls at this
  // point (see the comment on Step 2 above for why).
  var manifestRoot = docs.manifestRoot;
  var manifestRootReject = planReaderGateManifestRootForDiscovery(manifestRoot, ownerUid, templateId, templateRevision, operation, gateway);
  if (manifestRootReject) return manifestRootReject;

  // ---- Step 7: manifest chunks (spec §10) ----
  var manifestChunksInput = Array.isArray(docs.manifestChunks) ? docs.manifestChunks : null;
  if (!manifestChunksInput || manifestChunksInput.length !== manifestRoot.chunkIds.length) {
    return planReaderConflict('missingPlannedRead', { category: 'manifestChunks' });
  }
  var allEntries = []; // flattened, in chunk order, each: {recordType, recordId, subjectId, revisionId, path, payloadHash, dependencyRefs}
  var seenEntrySubjectIds = Object.create(null);
  var recomputedChunkHashes = [];
  var totalEntryCount = 0;
  for (var ci = 0; ci < manifestChunksInput.length; ci++) {
    var expectedChunkId = manifestRoot.chunkIds[ci];
    var chunkEntry = manifestChunksInput[ci];
    var chunkDoc = chunkEntry && chunkEntry.doc;
    // Correction round 3 (source review defect #2): this step now calls the
    // EXACT SAME gate function firebase.js's staged discovery calls at this
    // point (see the comment on Step 2 above for why).
    var chunkReject = planReaderGateManifestChunkForDiscovery(chunkDoc, expectedChunkId, ci, ownerUid, manifestRoot, templateRevision, operation, gateway);
    if (chunkReject) return chunkReject;
    var recomputedHash = planReaderRecomputeChunkHash(chunkDoc);
    recomputedChunkHashes.push(recomputedHash);
    totalEntryCount += chunkDoc.entries.length;
    for (var ee = 0; ee < chunkDoc.entries.length; ee++) {
      var entry = chunkDoc.entries[ee];
      // Correction round 3 (source review defect #2): use the SAME gate
      // function staged discovery uses, so a forged recordId/path (even one
      // coherently re-hashed into the manifest chain) and a duplicate
      // Template manifest entry are both caught here too, not only in the
      // staged path -- guaranteeing gate/validator parity.
      var entryGateReject = planReaderGateManifestEntryForDiscovery(entry, templateId, ownerUid, seenEntrySubjectIds, targetRevisionId);
      if (entryGateReject) {
        return entryGateReject;
      }
      allEntries.push(entry);
    }
  }
  if (totalEntryCount !== manifestRoot.recordCount || totalEntryCount !== templateRevision.graphRecordCount) {
    return planReaderConflict('recordCountMismatch', { totalEntryCount: totalEntryCount, manifestRootRecordCount: manifestRoot.recordCount, templateRevisionGraphRecordCount: templateRevision.graphRecordCount });
  }

  // ---- Step 8: manifest/graph hash (spec §10) ----
  var recomputedGraphHash = planReaderRecomputeManifestGraphHash(manifestRoot.manifestId, recomputedChunkHashes);
  if (recomputedGraphHash !== manifestRoot.graphHash) {
    return planReaderConflict('manifestGraphHashMismatch', {});
  }

  // ---- Step 9: every named child revision (and, for a current read, its
  // subject pointer), independently verified (spec §10) ----
  var childRevisionsInput = docs.childRevisions && typeof docs.childRevisions === 'object' ? docs.childRevisions : {};
  var childSubjectsInput = docs.childSubjects && typeof docs.childSubjects === 'object' ? docs.childSubjects : {};
  var nodesBySubjectId = Object.create(null);
  nodesBySubjectId[templateId] = {
    subjectId: templateId,
    recordType: 'planTemplateRevision',
    revisionId: templateRevision.revisionId,
    dependencyRefs: Array.isArray(templateRevision.dependencyRefs) ? templateRevision.dependencyRefs : [],
    doc: templateRevision
  };

  var sawTemplateManifestEntry = false;
  for (var eIdx = 0; eIdx < allEntries.length; eIdx++) {
    var e = allEntries[eIdx];

    // The Template's OWN revision is itself one of the resolved graph nodes
    // planNormalizeCanonicalGraph produces (addNode(templateId, ...) --
    // see app-plan.js above), so it legitimately appears as one of the
    // manifest's own entries too, alongside every child. It is cross-
    // validated here against the templateRevision document already read and
    // verified in steps 3-4 above (never against a separate childRevisions/
    // childSubjects lookup, since none is needed or expected for it), and is
    // deliberately NOT added to nodesBySubjectId again (it was already seeded
    // there, immediately above this loop) or to any of the six child graph
    // maps assembled further below.
    if (e.subjectId === templateId) {
      if (sawTemplateManifestEntry) {
        return planReaderConflict('duplicateManifestEntry', { subjectId: e.subjectId });
      }
      sawTemplateManifestEntry = true;
      if (e.recordType !== 'planTemplateRevision' || e.revisionId !== templateRevision.revisionId) {
        return planReaderConflict('manifestEntryTemplateIdentityMismatch', { subjectId: e.subjectId });
      }
      if (templateRevision.payloadHash !== e.payloadHash) {
        return planReaderConflict('manifestEntryPayloadHashClaimMismatch', { subjectId: e.subjectId });
      }
      if (!planDeepEqual(templateRevision.dependencyRefs || [], e.dependencyRefs || [])) {
        return planReaderConflict('manifestEntryDependencyRefsClaimMismatch', { subjectId: e.subjectId });
      }
      continue;
    }

    if (PLAN_READER_CHILD_RECORD_TYPES.indexOf(e.recordType) === -1) {
      return planReaderConflict('unsupportedCanonicalRecordType', { recordType: e.recordType, subjectId: e.subjectId });
    }
    var childDoc = childRevisionsInput[e.subjectId];
    if (!childDoc || typeof childDoc !== 'object') {
      return planReaderConflict('missingPlannedRead', { category: 'childRevision', subjectId: e.subjectId });
    }
    if (childDoc.recordType !== e.recordType || childDoc.subjectId !== e.subjectId || childDoc.revisionId !== e.revisionId || childDoc.recordId !== e.recordId) {
      return planReaderConflict('recordIdentityMismatch', { subjectId: e.subjectId });
    }
    if (childDoc.ownerUid !== ownerUid) {
      return planReaderConflict('crossOwnerReference', { field: 'childRevision.ownerUid', subjectId: e.subjectId });
    }
    if (!planReaderIsSupportedSchemaDoc(childDoc)) {
      return planReaderUnsupported('childRevisionUnsupportedSchemaOrEncoding', { subjectId: e.subjectId });
    }
    if (childDoc.commitState !== 'committed') {
      return planReaderConflict('childRevisionNotCommitted', { subjectId: e.subjectId, commitState: childDoc.commitState });
    }
    // Correction round 9 (personal-use simplification; supersedes rounds
    // 6-8's reused-child-revision provenance corroboration system -- see
    // slice4-round8-pause-handoff.md and the round-9 simplification report
    // for what was removed and why). A legitimately REUSED child revision
    // (unchanged since an earlier commit -- see the writer's
    // `if (revEntry.reused) continue;` skip, planBuildRevisionEnvelope) is
    // never rewritten, so its own gatewayId/createdByOperationId are frozen
    // at whatever they were when that revision was ORIGINALLY created, not
    // this commit's values -- only a child revision actually WRITTEN by
    // this commit carries this commit's own operation/gateway. A reused
    // child's gatewayId/createdByOperationId are therefore NOT required to
    // equal the current commit's own operation/gateway; they are required
    // only to be present, non-empty, and correctly typed. This is an
    // internal-consistency contract, not proof of historical authorship:
    // the evidence that this child genuinely belongs to the current graph
    // is the current manifest's own binding to this child's revisionId
    // (checked below/above via the manifest entry) together with the
    // recomputed payload/dependency hashes (checked below) -- never a
    // historical read of any kind.
    if (typeof childDoc.gatewayId !== 'string' || !childDoc.gatewayId || typeof childDoc.createdByOperationId !== 'string' || !childDoc.createdByOperationId) {
      return planReaderConflict('childRevisionProvenanceMismatch', { subjectId: e.subjectId });
    }
    // Whether this child was actually written by the current commit (used
    // below only to decide clientSchemaGeneration/clientCreatedAt check
    // strictness -- see the round-6 comment there -- never to accept or
    // reject the child's provenance itself, which the check above already
    // settled without regard to this).
    var childRevMatchesCurrentCommit = (childDoc.gatewayId === gateway.gatewayId && childDoc.createdByOperationId === operation.operationId);
    // Correction round (source review defect #1): complete applicable
    // envelope on every child revision, not merely identity/owner/schema/
    // commit-state -- and every child revision's actor must agree with the
    // Template revision's own already-verified actor (owner-only V1 model).
    if (childDoc.ownerDomain !== 'plan') {
      return planReaderConflict('childRevisionEnvelopeMalformed', { subjectId: e.subjectId, field: 'ownerDomain' });
    }
    if (childDoc.lifecycleState !== 'active') {
      return planReaderConflict('childRevisionEnvelopeMalformed', { subjectId: e.subjectId, field: 'lifecycleState' });
    }
    if (childDoc.sourceKind !== 'planEditorCommit') {
      return planReaderConflict('childRevisionEnvelopeMalformed', { subjectId: e.subjectId, field: 'sourceKind' });
    }
    if (childDoc.authorityKind !== PLAN_READER_SUPPORTED_AUTHORITY_KIND) {
      return planReaderConflict('delegatedAuthorityUnsupported', { subjectId: e.subjectId });
    }
    if (childDoc.actorUid !== ownerUid || childDoc.actorUid !== templateRevision.actorUid) {
      return planReaderConflict('actorUidDisagreement', { subjectId: e.subjectId });
    }
    // Correction round 2 (source review defect #1): authorityBasisRefs
    // AGREEMENT and effectiveBoundary were never checked on child revisions.
    var childRevBasisRefsUnsupportedReject = planReaderCheckAuthorityBasisRefsUnsupported(childDoc, 'childRevision');
    if (childRevBasisRefsUnsupportedReject) return childRevBasisRefsUnsupportedReject;
    if (!Array.isArray(childDoc.authorityBasisRefs) || !planDeepEqual(childDoc.authorityBasisRefs, templateRevision.authorityBasisRefs)) {
      return planReaderConflict('authorityBasisRefsDisagreement', { subjectId: e.subjectId });
    }
    // Correction round 2 fix-up: planRuleRevision's own semantic payload
    // (a V1 domain constant -- "applies for the ongoing life of the
    // Assignment", see PLAN_READER_SEMANTIC_FIELDS.planRuleRevision) is
    // spread onto the written document AFTER planBuildRevisionEnvelope
    // (see the writer's `Object.assign({}, envelope, revEntry.semanticPayload,
    // namedDeps)`), and both happen to use the field name "effectiveBoundary"
    // for two different §6/domain concepts. For every OTHER child revision
    // type this collision does not exist and the envelope's own steady-state
    // 'immediate' value passes through unchanged; only planRuleRevision's
    // genuine, writer-produced value is legitimately 'ongoing'. Checking a
    // single hardcoded 'immediate' here was therefore a false positive
    // against real, untampered Rule fixtures, not a defect it was catching.
    var expectedChildEffectiveBoundary = (e.recordType === 'planRuleRevision') ? 'ongoing' : 'immediate';
    if (childDoc.effectiveBoundary !== expectedChildEffectiveBoundary) {
      return planReaderConflict('childRevisionEnvelopeMalformed', { subjectId: e.subjectId, field: 'effectiveBoundary' });
    }
    // Correction round 3 (source review defect #1): authorityScope,
    // sourceRefs, clientSchemaGeneration (agreement), clientCreatedAt
    // (agreement), and committedAt were never checked on a child revision.
    var childRevScopeReject = planReaderCheckAuthorityScopeAgreement(childDoc, ownerUid, templateRevision.authorityScope, 'childRevision');
    if (childRevScopeReject) return childRevScopeReject;
    var childRevSourceRefsReject = planReaderCheckSourceRefs(childDoc, 'childRevision');
    if (childRevSourceRefsReject) return childRevSourceRefsReject;
    // Correction round 6: same reused-vs-fresh distinction as the
    // gatewayId/createdByOperationId check above -- a reused child's
    // clientSchemaGeneration/clientCreatedAt are frozen at its original
    // creation time and may legitimately disagree with this commit's
    // values, so only a child that matches this commit's own operation/
    // gateway is held to full agreement; a confirmed-reused child (the
    // headSequence===1 illegitimate case was already rejected above) is
    // checked for shape only, reusing the existing shape-only helpers.
    if (childRevMatchesCurrentCommit) {
      var childRevGenReject = planReaderCheckClientSchemaGenerationAgreement(childDoc, templateRevision.clientSchemaGeneration, 'childRevision');
      if (childRevGenReject) return childRevGenReject;
      var childRevClientCreatedReject = planReaderCheckClientCreatedAtAgreement(childDoc, templateRevision.clientCreatedAt, 'childRevision');
      if (childRevClientCreatedReject) return childRevClientCreatedReject;
    } else {
      var childRevGenReject = planReaderCheckClientSchemaGenerationShape(childDoc, 'childRevision');
      if (childRevGenReject) return childRevGenReject;
      var childRevClientCreatedReject = planReaderCheckClientCreatedAtShape(childDoc, 'childRevision');
      if (childRevClientCreatedReject) return childRevClientCreatedReject;
    }
    var childRevCommittedAtReject = planReaderCheckCommittedAt(childDoc, 'childRevision');
    if (childRevCommittedAtReject) return childRevCommittedAtReject;
    var recomputedPayloadHash = planReaderRecomputePayloadHash(childDoc, e.recordType);
    if (recomputedPayloadHash === null || recomputedPayloadHash !== childDoc.payloadHash) {
      return planReaderConflict('payloadHashMismatch', { subjectId: e.subjectId });
    }
    if (recomputedPayloadHash !== e.payloadHash) {
      return planReaderConflict('manifestEntryPayloadHashClaimMismatch', { subjectId: e.subjectId });
    }
    var recomputedDependencyHash = planReaderRecomputeDependencyHash(childDoc);
    if (recomputedDependencyHash !== childDoc.dependencyHash) {
      return planReaderConflict('dependencyHashMismatch', { subjectId: e.subjectId });
    }
    if (!planDeepEqual(childDoc.dependencyRefs || [], e.dependencyRefs || [])) {
      return planReaderConflict('manifestEntryDependencyRefsClaimMismatch', { subjectId: e.subjectId });
    }

    if (!isHistorical) {
      var subjDoc = childSubjectsInput[e.subjectId];
      if (!subjDoc || typeof subjDoc !== 'object') {
        return planReaderConflict('missingPlannedRead', { category: 'childSubject', subjectId: e.subjectId });
      }
      if (subjDoc.recordType !== PLAN_READER_REVISION_TO_SUBJECT_RECORD_TYPE[e.recordType] || subjDoc.subjectId !== e.subjectId || subjDoc.recordId !== e.subjectId) {
        return planReaderConflict('recordIdentityMismatch', { subjectId: e.subjectId });
      }
      if (subjDoc.ownerUid !== ownerUid) {
        return planReaderConflict('crossOwnerReference', { field: 'childSubject.ownerUid', subjectId: e.subjectId });
      }
      // Correction round (source review defect #1): the child subject
      // pointer previously had no schema/encoding check at all, and no
      // envelope check beyond identity/owner/lifecycle.
      if (!planReaderIsSupportedSchemaDoc(subjDoc)) {
        return planReaderUnsupported('childSubjectUnsupportedSchemaOrEncoding', { subjectId: e.subjectId });
      }
      if (subjDoc.ownerDomain !== 'plan') {
        return planReaderConflict('childSubjectEnvelopeMalformed', { subjectId: e.subjectId, field: 'ownerDomain' });
      }
      if (subjDoc.commitState !== 'committed') {
        return planReaderConflict('childSubjectEnvelopeMalformed', { subjectId: e.subjectId, field: 'commitState' });
      }
      if (subjDoc.lifecycleState !== 'active') {
        return planReaderConflict('childSubjectNotActive', { subjectId: e.subjectId, lifecycleState: subjDoc.lifecycleState });
      }
      // Correction round 2 (source review defect #1): the child subject
      // pointer's own actor/authority envelope was never checked -- an
      // independent probe changed only planAssignmentSubject.actorUid and
      // it went undetected. Every child subject pointer is built off the
      // same shared system envelope (planBuildSystemEnvelope) as the
      // Template subject and must agree with the same owner-only V1 model.
      if (subjDoc.authorityKind !== PLAN_READER_SUPPORTED_AUTHORITY_KIND) {
        return planReaderConflict('delegatedAuthorityUnsupported', { category: 'childSubject', subjectId: e.subjectId });
      }
      if (!Array.isArray(subjDoc.authorityBasisRefs)) {
        return planReaderConflict('authorityBasisRefsMissing', { category: 'childSubject', subjectId: e.subjectId });
      }
      var childSubjBasisRefsUnsupportedReject = planReaderCheckAuthorityBasisRefsUnsupported(subjDoc, 'childSubject');
      if (childSubjBasisRefsUnsupportedReject) return childSubjBasisRefsUnsupportedReject;
      if (subjDoc.actorUid !== ownerUid || subjDoc.actorUid !== templateRevision.actorUid) {
        return planReaderConflict('actorUidDisagreement', { category: 'childSubject', subjectId: e.subjectId });
      }
      if (!planDeepEqual(subjDoc.authorityBasisRefs, templateRevision.authorityBasisRefs)) {
        return planReaderConflict('authorityBasisRefsDisagreement', { category: 'childSubject', subjectId: e.subjectId });
      }
      if (subjDoc.sourceKind !== 'planEditorCommit') {
        return planReaderConflict('childSubjectEnvelopeMalformed', { subjectId: e.subjectId, field: 'sourceKind' });
      }
      // Correction round 2 (source review defect #1): effectiveBoundary
      // (Time) was never checked on a child subject pointer.
      if (subjDoc.effectiveBoundary !== 'immediate') {
        return planReaderConflict('childSubjectEnvelopeMalformed', { subjectId: e.subjectId, field: 'effectiveBoundary' });
      }
      // Correction round 3 (source review defect #1): authorityScope,
      // sourceRefs, clientSchemaGeneration (agreement), clientCreatedAt
      // (agreement), and committedAt were never checked on a child subject
      // pointer.
      var childSubjScopeReject = planReaderCheckAuthorityScopeAgreement(subjDoc, ownerUid, templateRevision.authorityScope, 'childSubject');
      if (childSubjScopeReject) return childSubjScopeReject;
      var childSubjSourceRefsReject = planReaderCheckSourceRefs(subjDoc, 'childSubject');
      if (childSubjSourceRefsReject) return childSubjSourceRefsReject;
      var childSubjGenReject = planReaderCheckClientSchemaGenerationAgreement(subjDoc, templateRevision.clientSchemaGeneration, 'childSubject');
      if (childSubjGenReject) return childSubjGenReject;
      var childSubjClientCreatedReject = planReaderCheckClientCreatedAtAgreement(subjDoc, templateRevision.clientCreatedAt, 'childSubject');
      if (childSubjClientCreatedReject) return childSubjClientCreatedReject;
      var childSubjCommittedAtReject = planReaderCheckCommittedAt(subjDoc, 'childSubject');
      if (childSubjCommittedAtReject) return childSubjCommittedAtReject;
      // Correction round 3 (source review defect #1): a child subject's
      // updatedByOperationId/gatewayId (its own provenance -- always
      // present, whether the subject was newly created or pre-existing and
      // updated, unlike createdByOperationId which is only conditionally
      // stamped -- see planBuildTemplateCommitPackage above) were never
      // cross-checked against the operation/gateway this read already
      // verified -- an independent probe changed only
      // planAssignmentSubject.updatedByOperationId and it went undetected.
      if (subjDoc.updatedByOperationId !== operation.operationId || subjDoc.gatewayId !== gateway.gatewayId) {
        return planReaderConflict('childSubjectProvenanceMismatch', { subjectId: e.subjectId });
      }
      if (subjDoc.headRevisionId !== e.revisionId) {
        return planReaderConflict('staleChildHeadRevision', { subjectId: e.subjectId });
      }
    }

    nodesBySubjectId[e.subjectId] = {
      subjectId: e.subjectId,
      recordType: e.recordType,
      revisionId: e.revisionId,
      dependencyRefs: Array.isArray(childDoc.dependencyRefs) ? childDoc.dependencyRefs : [],
      doc: childDoc
    };
  }
  if (!sawTemplateManifestEntry) {
    return planReaderConflict('missingManifestEntry', { subjectId: templateId });
  }

  // ---- Step 10: dependency resolution, cycle detection, and closure equality (spec §10) ----
  var allSubjectIds = Object.keys(nodesBySubjectId);
  for (var di = 0; di < allSubjectIds.length; di++) {
    var node = nodesBySubjectId[allSubjectIds[di]];
    for (var dj = 0; dj < node.dependencyRefs.length; dj++) {
      var ref = node.dependencyRefs[dj];
      if (!ref || typeof ref.subjectId !== 'string' || !nodesBySubjectId[ref.subjectId]) {
        return planReaderConflict('missingDependencyTarget', { subjectId: node.subjectId, dependsOn: ref && ref.subjectId });
      }
      var depNode = nodesBySubjectId[ref.subjectId];
      if (depNode.recordType !== ref.recordType || depNode.revisionId !== ref.revisionId) {
        return planReaderConflict('unexpectedDependencyReference', { subjectId: node.subjectId, dependsOn: ref.subjectId });
      }
    }
  }
  // Cycle detection (DFS with recursion-stack tracking) over the dependency
  // graph rooted at every node (defensive -- in this model only the Template
  // node's dependency edges matter for reachability, but a cycle anywhere is
  // still a contradiction regardless of reachability from the root).
  var WHITE = 0, GRAY = 1, BLACK = 2;
  var color = Object.create(null);
  for (var ci2 = 0; ci2 < allSubjectIds.length; ci2++) color[allSubjectIds[ci2]] = WHITE;
  var cycleFound = null;
  function planReaderDfs(sid) {
    if (cycleFound) return;
    color[sid] = GRAY;
    var n = nodesBySubjectId[sid];
    for (var k = 0; k < n.dependencyRefs.length; k++) {
      var depId = n.dependencyRefs[k].subjectId;
      if (color[depId] === GRAY) { cycleFound = { subjectId: sid, dependsOn: depId }; return; }
      if (color[depId] === WHITE) planReaderDfs(depId);
      if (cycleFound) return;
    }
    color[sid] = BLACK;
  }
  for (var ci3 = 0; ci3 < allSubjectIds.length; ci3++) {
    if (color[allSubjectIds[ci3]] === WHITE) planReaderDfs(allSubjectIds[ci3]);
    if (cycleFound) break;
  }
  if (cycleFound) {
    return planReaderConflict('dependencyCycle', cycleFound);
  }
  // Reachability from the Template root must equal the manifest exactly: every
  // manifest entry must be reachable, and (by construction above) nothing
  // outside the manifest was ever added to nodesBySubjectId, so equality only
  // needs to be checked in the "orphan" direction.
  var reached = Object.create(null);
  var queue = [templateId];
  reached[templateId] = true;
  while (queue.length > 0) {
    var cur = queue.shift();
    var curNode = nodesBySubjectId[cur];
    for (var qi = 0; qi < curNode.dependencyRefs.length; qi++) {
      var nid = curNode.dependencyRefs[qi].subjectId;
      if (!reached[nid]) { reached[nid] = true; queue.push(nid); }
    }
  }
  for (var oi = 0; oi < allEntries.length; oi++) {
    if (!reached[allEntries[oi].subjectId]) {
      return planReaderConflict('orphanManifestRecord', { subjectId: allEntries[oi].subjectId });
    }
  }

  // ---- Assemble the verified, deeply frozen result ----
  var childMaps = {
    assignments: {}, scheduleOpportunities: {}, prescriptions: {},
    implementationRelationships: {}, sets: {}, rules: {}
  };
  for (var fi = 0; fi < allEntries.length; fi++) {
    var fe = allEntries[fi];
    if (fe.subjectId === templateId) continue; // the Template's own manifest entry -- represented separately as canonicalGraph.templateRevision, not one of the six child maps
    var fNode = nodesBySubjectId[fe.subjectId];
    var graphKey = PLAN_READER_CHILD_GRAPH_KEY_BY_RECORD_TYPE[fe.recordType];
    childMaps[graphKey][fe.subjectId] = {
      subjectId: fe.subjectId,
      recordType: fe.recordType,
      revisionId: fe.revisionId,
      semanticPayload: planReaderExtractSemanticPayload(fNode.doc, fe.recordType),
      dependencyRefs: fNode.dependencyRefs,
      payloadHash: fNode.doc.payloadHash,
      dependencyHash: fNode.doc.dependencyHash,
      lifecycleState: fNode.doc.lifecycleState,
      commitState: fNode.doc.commitState,
      predecessorRevisionId: fNode.doc.predecessorRevisionId || null,
      duplicatedFromSubjectId: fNode.doc.duplicatedFromSubjectId || null
    };
  }

  var canonicalGraph = {
    ownerUid: ownerUid,
    templateId: templateId,
    templateRevision: {
      subjectId: templateId,
      recordType: 'planTemplateRevision',
      revisionId: templateRevision.revisionId,
      semanticPayload: planReaderExtractSemanticPayload(templateRevision, 'planTemplateRevision'),
      dependencyRefs: Array.isArray(templateRevision.dependencyRefs) ? templateRevision.dependencyRefs : [],
      payloadHash: templateRevision.payloadHash,
      dependencyHash: templateRevision.dependencyHash,
      lifecycleState: templateRevision.lifecycleState,
      commitState: templateRevision.commitState,
      predecessorRevisionId: templateRevision.predecessorRevisionId || null,
      duplicatedFromSubjectId: templateRevision.duplicatedFromSubjectId || null
    },
    assignments: childMaps.assignments,
    scheduleOpportunities: childMaps.scheduleOpportunities,
    prescriptions: childMaps.prescriptions,
    implementationRelationships: childMaps.implementationRelationships,
    setGroups: {},
    sets: childMaps.sets,
    rules: childMaps.rules,
    manifest: {
      manifestId: manifestRoot.manifestId,
      graphHash: manifestRoot.graphHash,
      chunkIds: manifestRoot.chunkIds.slice(),
      chunkHashes: manifestRoot.chunkHashes.slice(),
      recordCount: manifestRoot.recordCount,
      chunkCount: manifestRoot.chunkIds.length
    },
    operation: {
      operationId: operation.operationId,
      operationType: operation.operationType,
      actorUid: operation.actorUid,
      intentFingerprint: operation.intentFingerprint,
      outcome: operation.outcome
    },
    gateway: {
      gatewayId: gateway.gatewayId,
      writeSetHash: gateway.writeSetHash,
      expectedPredecessorRevisionId: gateway.expectedPredecessorRevisionId || null
    }
  };

  var verificationReceipt = {
    ownerUid: ownerUid,
    templateId: templateId,
    isCurrent: !isHistorical,
    headRevisionId: templateRevision.revisionId,
    headSequence: isHistorical ? null : templateSubject.headSequence,
    manifestId: manifestRoot.manifestId,
    manifestChunkIds: manifestRoot.chunkIds.slice(),
    manifestChunkHashes: manifestRoot.chunkHashes.slice(),
    operationId: operation.operationId,
    gatewayId: gateway.gatewayId,
    schemaVersion: templateRevision.schemaVersion,
    canonicalEncodingVersion: templateRevision.canonicalEncodingVersion,
    graphHash: manifestRoot.graphHash,
    recordCount: manifestRoot.recordCount,
    freshnessCheckpoint: isHistorical ? null : (templateSubject.headManifestId ? templateRevision.committedAt : null)
  };

  // Round-9 simplification: exactly two outcomes for a successful
  // validation, exactly as before rounds 6-8 introduced a third
  // assurance tier for reused children -- `verifiedCurrentWithCorroboratedReuse`
  // is removed. A reused child that passes the internal-consistency
  // contract above (present/well-typed provenance IDs, manifest binding,
  // recomputed hashes) is simply part of a `verifiedCurrent` read, exactly
  // like any other child.
  var finalOutcome = isHistorical ? 'verifiedHistorical' : 'verifiedCurrent';

  return Object.freeze({
    outcome: finalOutcome,
    verificationReceipt: planDeepFreeze(planDeepClone(verificationReceipt)),
    canonicalGraph: planDeepFreeze(planDeepClone(canonicalGraph))
  });
}

// ---- planBuildCanonicalTemplateProfile(input) ----
// Same input contract as planValidateCanonicalTemplateRead. On success, adds
// a deterministic profileView built ONLY from the just-verified canonicalGraph
// (never from an unverified summary or appDb). On any non-success outcome,
// returns that same typed outcome unchanged, with no profileView, canonicalGraph,
// or verificationReceipt attached (spec §6: "No partial profile may be
// returned after any failure").
function planBuildCanonicalTemplateProfile(input) {
  var validated = planValidateCanonicalTemplateRead(input);
  if (validated.outcome !== 'verifiedCurrent' && validated.outcome !== 'verifiedHistorical') {
    return validated;
  }
  var graph = validated.canonicalGraph;

  // Correction round (source review defect #4): every reconstruction
  // contradiction below now returns the approved integrityConflict
  // outcome -- with NO partial profileView/canonicalGraph/verificationReceipt
  // attached -- instead of throwing an ordinary untyped Error. `conflict`
  // is set by the (now plain, breakable) loops below and checked after
  // each stage; nothing after a stage that sets it is ever reached.
  var conflict = null;
  function fail(reason, details) { conflict = planReaderConflict(reason, details); }

  function bySubjectIdList(map) {
    return Object.keys(map).map(function (sid) { return map[sid]; });
  }

  var opportunities = bySubjectIdList(graph.scheduleOpportunities);

  // Group opportunities by embedded microcycle/session identity (never by
  // name or array position -- spec §11.3/Part 6). Contradictory reuse of
  // either identity across EVERY governed semantic field (name, notes,
  // order key) is rejected, not merely order key.
  var microcyclesById = {};
  var microcycleOrder = [];
  for (var i = 0; i < opportunities.length && !conflict; i++) {
    var opp = opportunities[i];
    var mc = opp.semanticPayload && opp.semanticPayload.microcycle;
    var sess = opp.semanticPayload && opp.semanticPayload.session;
    if (!mc || !mc.microcycleId || !sess || !sess.sessionId) {
      fail('scheduleOpportunityMissingMicrocycleOrSessionIdentity', { subjectId: opp.subjectId });
      break;
    }
    if (!planReaderHasOwnKey(microcyclesById, mc.microcycleId)) {
      microcyclesById[mc.microcycleId] = { microcycleId: mc.microcycleId, name: mc.name || null, orderKey: mc.orderKey, sessionsById: {}, sessionOrder: [] };
      microcycleOrder.push(mc.microcycleId);
    } else if (microcyclesById[mc.microcycleId].orderKey !== mc.orderKey || microcyclesById[mc.microcycleId].name !== (mc.name || null)) {
      fail('contradictoryMicrocycleIdentity', { microcycleId: mc.microcycleId });
      break;
    }
    var mEntry = microcyclesById[mc.microcycleId];
    if (!planReaderHasOwnKey(mEntry.sessionsById, sess.sessionId)) {
      mEntry.sessionsById[sess.sessionId] = { sessionId: sess.sessionId, name: sess.name || null, notes: sess.notes || null, orderKey: sess.orderKey, assignments: [] };
      mEntry.sessionOrder.push(sess.sessionId);
    } else if (mEntry.sessionsById[sess.sessionId].orderKey !== sess.orderKey ||
      mEntry.sessionsById[sess.sessionId].name !== (sess.name || null) ||
      mEntry.sessionsById[sess.sessionId].notes !== (sess.notes || null)) {
      // Correction round (source review defect #4): reusing one Session id
      // with a changed name or notes previously slipped through when
      // orderKey happened to still agree -- every governed field is now
      // compared, not orderKey alone.
      fail('contradictorySessionIdentity', { sessionId: sess.sessionId });
      break;
    }
    mEntry.sessionsById[sess.sessionId].assignments.push({ opportunitySubjectId: opp.subjectId, opportunityRevisionId: opp.revisionId, orderKey: opp.semanticPayload.orderKey });
  }
  if (conflict) return conflict;

  // Correction round (source review defect #4): duplicate Microcycle order
  // keys under the Template root, across DIFFERENT microcycle ids, were
  // never checked (only the same id reused with a different key was
  // caught above).
  var seenMicrocycleOrderKeys = {};
  for (var mci = 0; mci < microcycleOrder.length; mci++) {
    var mcOk = microcyclesById[microcycleOrder[mci]].orderKey;
    if (planReaderHasOwnKey(seenMicrocycleOrderKeys, mcOk)) {
      return planReaderConflict('duplicateMicrocycleOrderKey', { orderKey: mcOk });
    }
    seenMicrocycleOrderKeys[mcOk] = true;
  }

  var assignments = bySubjectIdList(graph.assignments);
  var assignmentByOpportunityId = {};
  // The Assignment <-> Opportunity relationship is opportunity-depends-on-
  // assignment (see planNormalizeCanonicalGraph's addNode() call for
  // planScheduleOpportunitySubject: dependsOnSubjectIds includes the
  // Assignment id). Build the inverse index from that edge, requiring
  // exactly one Assignment per opportunity.
  for (var o2 = 0; o2 < opportunities.length; o2++) {
    var opp2 = opportunities[o2];
    var linkedAssignmentIds = opp2.dependencyRefs.filter(function (r) { return r.recordType === 'planAssignmentRevision'; }).map(function (r) { return r.subjectId; });
    if (linkedAssignmentIds.length !== 1) {
      return planReaderConflict('opportunityMustResolveExactlyOneAssignment', { subjectId: opp2.subjectId });
    }
    assignmentByOpportunityId[opp2.subjectId] = linkedAssignmentIds[0];
  }
  // Correction round (source review defect #4): a verified Assignment with
  // no opportunity that resolves to it was previously silently omitted
  // from the profile rather than rejected -- every Assignment the graph
  // verified must be represented by the intended schedule structure.
  var scheduledAssignmentIds = {};
  Object.keys(assignmentByOpportunityId).forEach(function (oid) { scheduledAssignmentIds[assignmentByOpportunityId[oid]] = true; });
  for (var au = 0; au < assignments.length; au++) {
    if (!planReaderHasOwnKey(scheduledAssignmentIds, assignments[au].subjectId)) {
      return planReaderConflict('assignmentNotScheduled', { subjectId: assignments[au].subjectId });
    }
  }

  var prescriptionByAssignmentId = {};
  var relationshipByAssignmentId = {};
  var rulesByAssignmentId = {};
  for (var a2 = 0; a2 < assignments.length; a2++) {
    var asn2 = assignments[a2];
    var prescriptionIds = asn2.dependencyRefs.filter(function (r) { return r.recordType === 'planPrescriptionRevision'; }).map(function (r) { return r.subjectId; });
    var relationshipIds = asn2.dependencyRefs.filter(function (r) { return r.recordType === 'planImplementationRelationshipRevision'; }).map(function (r) { return r.subjectId; });
    var ruleIds = asn2.dependencyRefs.filter(function (r) { return r.recordType === 'planRuleRevision'; }).map(function (r) { return r.subjectId; });
    if (prescriptionIds.length !== 1 || relationshipIds.length !== 1) {
      return planReaderConflict('assignmentMustResolveOnePrescriptionAndOneRelationship', { subjectId: asn2.subjectId });
    }
    // Correction round (source review defect #4): a Prescription or
    // relationship attached to an Assignment via the dependency graph, but
    // whose OWN semantic assignmentId names a different Assignment, was
    // never cross-checked -- an "attached at the wrong scope" contradiction
    // that this closes.
    var prNode = graph.prescriptions[prescriptionIds[0]];
    if (!prNode || prNode.semanticPayload.assignmentId !== asn2.subjectId) {
      return planReaderConflict('prescriptionWrongAssignmentScope', { subjectId: prescriptionIds[0], assignmentSubjectId: asn2.subjectId });
    }
    var relNode = graph.implementationRelationships[relationshipIds[0]];
    if (!relNode || relNode.semanticPayload.assignmentId !== asn2.subjectId) {
      return planReaderConflict('relationshipWrongAssignmentScope', { subjectId: relationshipIds[0], assignmentSubjectId: asn2.subjectId });
    }
    for (var rui = 0; rui < ruleIds.length; rui++) {
      var ruNode = graph.rules[ruleIds[rui]];
      if (!ruNode || ruNode.semanticPayload.assignmentId !== asn2.subjectId) {
        return planReaderConflict('ruleWrongAssignmentScope', { subjectId: ruleIds[rui], assignmentSubjectId: asn2.subjectId });
      }
    }
    prescriptionByAssignmentId[asn2.subjectId] = prescriptionIds[0];
    relationshipByAssignmentId[asn2.subjectId] = relationshipIds[0];
    rulesByAssignmentId[asn2.subjectId] = ruleIds;
  }

  var sets = bySubjectIdList(graph.sets);
  var setsByPrescriptionId = {};
  for (var s = 0; s < sets.length; s++) {
    var setNode = sets[s];
    var pid = setNode.semanticPayload.prescriptionId;
    // Correction round (source review defect #4): a Set's semantic
    // prescriptionId is a display-convenience back-reference; the real
    // dependency edge runs the OTHER way (the Prescription depends on its
    // Sets, never the reverse -- see planNormalizeCanonicalGraph, which
    // deliberately gives every Set an empty dependencyRefs to avoid a
    // Prescription<->Set two-node cycle). The genuine cross-check is: the
    // Prescription this Set claims to belong to must itself list this
    // Set's subjectId in ITS dependencyRefs.
    var prForSet = graph.prescriptions[pid];
    if (!prForSet) {
      return planReaderConflict('setPrescriptionDependencyDisagreement', { subjectId: setNode.subjectId, semanticPrescriptionId: pid });
    }
    var prescriptionClaimsThisSet = prForSet.dependencyRefs.some(function (r) { return r.recordType === 'planSetRevision' && r.subjectId === setNode.subjectId; });
    if (!prescriptionClaimsThisSet) {
      return planReaderConflict('setPrescriptionDependencyDisagreement', { subjectId: setNode.subjectId, semanticPrescriptionId: pid });
    }
    if (!setsByPrescriptionId[pid]) setsByPrescriptionId[pid] = [];
    setsByPrescriptionId[pid].push(setNode);
  }
  var setOrderKeys = Object.keys(setsByPrescriptionId);
  for (var spi = 0; spi < setOrderKeys.length; spi++) {
    var pidKey = setOrderKeys[spi];
    var arr = setsByPrescriptionId[pidKey];
    var seenOrderKeys = {};
    for (var sni = 0; sni < arr.length; sni++) {
      var sn = arr[sni];
      if (planReaderHasOwnKey(seenOrderKeys, sn.semanticPayload.orderKey)) {
        return planReaderConflict('duplicateSetOrderKey', { prescriptionSubjectId: pidKey, orderKey: sn.semanticPayload.orderKey });
      }
      seenOrderKeys[sn.semanticPayload.orderKey] = true;
    }
    arr.sort(function (x, y) { return x.semanticPayload.orderKey - y.semanticPayload.orderKey; });
  }

  var microcyclesView = [];
  var sortedMicrocycleIds = microcycleOrder.slice().sort(function (x, y) { return microcyclesById[x].orderKey - microcyclesById[y].orderKey; });
  for (var mcv = 0; mcv < sortedMicrocycleIds.length; mcv++) {
    var mcId = sortedMicrocycleIds[mcv];
    var mEntry2 = microcyclesById[mcId];
    var seenSessionOrderKeys = {};
    for (var sidx = 0; sidx < mEntry2.sessionOrder.length; sidx++) {
      var ok = mEntry2.sessionsById[mEntry2.sessionOrder[sidx]].orderKey;
      if (planReaderHasOwnKey(seenSessionOrderKeys, ok)) {
        return planReaderConflict('duplicateSessionOrderKey', { microcycleId: mcId, orderKey: ok });
      }
      seenSessionOrderKeys[ok] = true;
    }
    var sortedSessionIds = mEntry2.sessionOrder.slice().sort(function (x, y) { return mEntry2.sessionsById[x].orderKey - mEntry2.sessionsById[y].orderKey; });
    var sessionsView = [];
    for (var sv = 0; sv < sortedSessionIds.length; sv++) {
      var sid = sortedSessionIds[sv];
      var sess2 = mEntry2.sessionsById[sid];
      var seenAssignmentOrderKeys = {};
      for (var a3i = 0; a3i < sess2.assignments.length; a3i++) {
        var a3 = sess2.assignments[a3i];
        if (planReaderHasOwnKey(seenAssignmentOrderKeys, a3.orderKey)) {
          return planReaderConflict('duplicateAssignmentOrderKey', { sessionId: sid, orderKey: a3.orderKey });
        }
        seenAssignmentOrderKeys[a3.orderKey] = true;
      }
      var sortedAssignments = sess2.assignments.slice().sort(function (x, y) { return x.orderKey - y.orderKey; });
      var assignmentsView = [];
      for (var av = 0; av < sortedAssignments.length; av++) {
        var a4 = sortedAssignments[av];
        var assignmentSubjectId = assignmentByOpportunityId[a4.opportunitySubjectId];
        var assignmentNode = graph.assignments[assignmentSubjectId];
        var prescriptionId = prescriptionByAssignmentId[assignmentSubjectId];
        var relationshipId = relationshipByAssignmentId[assignmentSubjectId];
        var relationshipNode = graph.implementationRelationships[relationshipId];
        var prescriptionNode = graph.prescriptions[prescriptionId];
        var ruleIds2 = rulesByAssignmentId[assignmentSubjectId] || [];
        assignmentsView.push(Object.freeze({
          // Correction round (source review defect #4): every nested
          // canonical identity the graph supplies -- Assignment, Opportunity,
          // Prescription, and implementation-relationship subject/revision
          // ids -- is now retained, not only Exercise ID/order/similarity.
          assignmentSubjectId: assignmentSubjectId,
          assignmentRevisionId: assignmentNode.revisionId,
          opportunitySubjectId: a4.opportunitySubjectId,
          opportunityRevisionId: a4.opportunityRevisionId,
          exerciseId: (relationshipNode && relationshipNode.semanticPayload.exerciseId) || assignmentSubjectId,
          instructions: assignmentNode.semanticPayload.instructions || null,
          prescriptionSubjectId: prescriptionId,
          prescriptionRevisionId: prescriptionNode.revisionId,
          relationshipSubjectId: relationshipId,
          relationshipRevisionId: relationshipNode.revisionId,
          sets: (setsByPrescriptionId[prescriptionId] || []).map(function (sn2) {
            return Object.freeze(Object.assign({ setSubjectId: sn2.subjectId, setRevisionId: sn2.revisionId }, sn2.semanticPayload));
          }),
          rules: ruleIds2.map(function (rid) {
            var ruleNode = graph.rules[rid];
            return Object.freeze(Object.assign({ ruleSubjectId: ruleNode.subjectId, ruleRevisionId: ruleNode.revisionId }, ruleNode.semanticPayload));
          })
        }));
      }
      sessionsView.push(Object.freeze({ sessionId: sid, name: sess2.name, notes: sess2.notes, assignments: assignmentsView }));
    }
    microcyclesView.push(Object.freeze({ microcycleId: mcId, name: mEntry2.name, sessions: sessionsView }));
  }

  var profileView = {
    templateSubjectId: graph.templateId,
    templateRevisionId: graph.templateRevision.revisionId,
    name: graph.templateRevision.semanticPayload.name || null,
    description: graph.templateRevision.semanticPayload.description || null,
    structureLabel: graph.templateRevision.semanticPayload.structureLabel || null,
    notes: graph.templateRevision.semanticPayload.notes || null,
    microcycles: microcyclesView,
    counts: {
      microcycleCount: microcyclesView.length,
      sessionCount: microcyclesView.reduce(function (sum, mc) { return sum + mc.sessions.length; }, 0),
      assignmentCount: Object.keys(graph.assignments).length
    }
  };

  return Object.freeze({
    outcome: validated.outcome,
    verificationReceipt: validated.verificationReceipt,
    canonicalGraph: validated.canonicalGraph,
    profileView: planDeepFreeze(planDeepClone(profileView))
  });
}

// ---- planBuildCanonicalTemplateEditSession(input) ----
// Same input contract as planValidateCanonicalTemplateRead, but only ever
// valid for a CURRENT read (input.requestedRevisionId must be null/undefined)
// -- editing a historical revision is not part of this slice. Returns
// { outcome: 'verifiedCurrent', draft, canonicalBase, readerState } on
// success, or the same typed non-success outcome unchanged on failure.
function planBuildCanonicalTemplateEditSession(input) {
  if (input && (input.requestedRevisionId !== null && input.requestedRevisionId !== undefined)) {
    return planReaderConflict('editSessionRequiresCurrentRead', {});
  }
  var validated = planValidateCanonicalTemplateRead(input);
  if (validated.outcome !== 'verifiedCurrent') {
    return validated;
  }
  var graph = validated.canonicalGraph;

  // Reconstruct the editor-shaped draft directly from the verified graph,
  // reusing exactly the same grouping/ordering logic as the profile view
  // (built once, independently, by calling planBuildCanonicalTemplateProfile
  // on the SAME already-verified input -- no second read, no re-verification
  // of anything the caller has not already had verified once).
  var profileResult = planBuildCanonicalTemplateProfile(input);
  if (profileResult.outcome !== 'verifiedCurrent') {
    return profileResult;
  }
  var profileView = profileResult.profileView;

  var draft = {
    planTemplateId: graph.templateId,
    name: profileView.name || '',
    description: profileView.description || '',
    structureLabel: profileView.structureLabel || '',
    notes: profileView.notes || '',
    microcycles: profileView.microcycles.map(function (mc) {
      return {
        planMicrocycleId: mc.microcycleId,
        name: mc.name || '',
        sessions: mc.sessions.map(function (sess) {
          return {
            planSessionId: sess.sessionId,
            name: sess.name || '',
            notes: sess.notes || '',
            exercises: sess.assignments.map(function (a) {
              var progressionRuleId = a.rules && a.rules.length > 0 ? a.rules[0].ruleId : null;
              var progressionRule = progressionRuleId ? a.rules[0] : null;
              return {
                exerciseId: a.exerciseId,
                notes: a.instructions || '',
                planAssignmentId: a.assignmentSubjectId,
                planOpportunityId: a.opportunitySubjectId,
                planPrescriptionId: a.prescriptionSubjectId,
                planRelationshipId: graph.assignments[a.assignmentSubjectId] ? relationshipIdForAssignment(graph, a.assignmentSubjectId) : null,
                sets: a.sets.map(function (setPayload) {
                  return {
                    loadType: setPayload.loadType || '', weight: numOrEmpty(setPayload.weight), percent: numOrEmpty(setPayload.percent), addedWeight: numOrEmpty(setPayload.addedWeight),
                    repsType: setPayload.repsType || '', reps: numOrEmpty(setPayload.reps), minReps: numOrEmpty(setPayload.minReps), maxReps: numOrEmpty(setPayload.maxReps),
                    effortType: setPayload.effortType || '', rir: numOrEmpty(setPayload.rir), minRir: numOrEmpty(setPayload.minRir), maxRir: numOrEmpty(setPayload.maxRir),
                    timeType: setPayload.timeType || '', seconds: numOrEmpty(setPayload.seconds), minSeconds: numOrEmpty(setPayload.minSeconds), maxSeconds: numOrEmpty(setPayload.maxSeconds),
                    notes: setPayload.notes || '',
                    planSetId: setPayload.setId
                  };
                }),
                progression: {
                  enabled: !!(progressionRule && progressionRule.enabled),
                  evaluationType: (progressionRule && progressionRule.evaluationType) || 'strict',
                  gatewaySetIndex: (progressionRule && progressionRule.gatewaySetIndex) || 0,
                  adjustmentType: (progressionRule && progressionRule.adjustmentType) || 'increaseTM',
                  loadIncrease: (progressionRule && progressionRule.loadIncrease) || 0,
                  tmIncrease: (progressionRule && progressionRule.tmIncrease) || 0,
                  failBehavior: (progressionRule && progressionRule.failBehavior) || 'repeat',
                  planRuleId: progressionRuleId
                }
              };
            })
          };
        })
      };
    })
  };

  function relationshipIdForAssignment(g, assignmentSubjectId) {
    var node = g.assignments[assignmentSubjectId];
    var rel = node.dependencyRefs.filter(function (r) { return r.recordType === 'planImplementationRelationshipRevision'; })[0];
    return rel ? rel.subjectId : null;
  }
  function numOrEmpty(v) { return (v === undefined || v === null) ? '' : v; }

  // ---- Round-trip invariant (spec Part 7) ----
  var normalized;
  try {
    normalized = planNormalizeCanonicalGraph(draft);
  } catch (e) {
    return planReaderConflict('roundTripReconstructionFailed', { message: e && e.message });
  }
  var normalizedBySubjectId = {};
  for (var ni = 0; ni < normalized.nodes.length; ni++) normalizedBySubjectId[normalized.nodes[ni].subjectId] = normalized.nodes[ni];

  var verifiedSubjectIds = Object.keys(graph.assignments).concat(Object.keys(graph.scheduleOpportunities), Object.keys(graph.prescriptions), Object.keys(graph.implementationRelationships), Object.keys(graph.sets), Object.keys(graph.rules), [graph.templateId]);
  var verifiedNodeBySubjectId = {};
  verifiedSubjectIds.forEach(function (sid) {
    verifiedNodeBySubjectId[sid] = sid === graph.templateId ? graph.templateRevision :
      (graph.assignments[sid] || graph.scheduleOpportunities[sid] || graph.prescriptions[sid] || graph.implementationRelationships[sid] || graph.sets[sid] || graph.rules[sid]);
  });

  if (normalized.nodes.length !== verifiedSubjectIds.length) {
    return planReaderConflict('roundTripNodeCountMismatch', { expected: verifiedSubjectIds.length, actual: normalized.nodes.length });
  }
  // Correction round (source review defect #5): the sorted {subjectId,
  // payloadHash, dependencyHash} list collected while proving the round
  // trip already fully captures this draft's normalized semantic content
  // (payloadHash/dependencyHash are exactly what a real commit would hash)
  // -- reused below as the cheap, order-independent starting semantic
  // fingerprint for dirty-state detection, instead of JSON.stringify-ing
  // the whole edit session (spec: "Dirtiness must not use JSON.stringify
  // on the full edit session").
  var semanticFingerprintEntries = [];
  for (var vi = 0; vi < verifiedSubjectIds.length; vi++) {
    var vsid = verifiedSubjectIds[vi];
    var nNode = normalizedBySubjectId[vsid];
    var vNode = verifiedNodeBySubjectId[vsid];
    if (!nNode || nNode.recordType !== PLAN_READER_REVISION_TO_SUBJECT_RECORD_TYPE[vNode.recordType]) {
      return planReaderConflict('roundTripIdentityMismatch', { subjectId: vsid });
    }
    var recomputedPayloadHashRt = planSha256Hex(planBuildCanonicalEncoding(nNode.semanticPayload));
    if (recomputedPayloadHashRt !== vNode.payloadHash) {
      return planReaderConflict('roundTripPayloadHashMismatch', { subjectId: vsid });
    }
    var expectedDepSubjectIds = vNode.dependencyRefs.map(function (r) { return r.subjectId; }).slice().sort();
    var actualDepSubjectIds = nNode.dependsOnSubjectIds.slice().sort();
    if (!planDeepEqual(expectedDepSubjectIds, actualDepSubjectIds)) {
      return planReaderConflict('roundTripDependencyShapeMismatch', { subjectId: vsid });
    }
    var recomputedDependencyRefsRt = nNode.dependsOnSubjectIds.map(function (dsid) {
      var depV = verifiedNodeBySubjectId[dsid];
      return { subjectId: dsid, recordType: depV.recordType, revisionId: depV.revisionId };
    }).sort(function (x, y) { return x.subjectId < y.subjectId ? -1 : (x.subjectId > y.subjectId ? 1 : 0); });
    var recomputedDependencyHashRt = planSha256Hex(planBuildCanonicalEncoding(recomputedDependencyRefsRt));
    if (recomputedDependencyHashRt !== vNode.dependencyHash) {
      return planReaderConflict('roundTripDependencyHashMismatch', { subjectId: vsid });
    }
    // NOTE: this fingerprint entry's dependencyHash deliberately hashes
    // only the sorted list of DEPENDED-ON SUBJECT IDS (not their
    // revisionIds, unlike recomputedDependencyHashRt above) -- a future
    // draft state's dependencies cannot know what revisionId a not-yet-
    // committed edit would eventually be assigned, so the dirty-state
    // comparison in planClassifyEditSessionDirtyState below (which starts
    // from a plain re-normalized draft, not a verified graph) uses this
    // same subject-id-only shape. Keeping the two formulas identical here
    // is what makes an untouched draft compare as genuinely unchanged.
    semanticFingerprintEntries.push({ subjectId: vsid, recordType: nNode.recordType, payloadHash: recomputedPayloadHashRt, dependencyHash: planSha256Hex(planBuildCanonicalEncoding(actualDepSubjectIds)) });
  }
  semanticFingerprintEntries.sort(function (x, y) { return x.subjectId < y.subjectId ? -1 : (x.subjectId > y.subjectId ? 1 : 0); });
  var startingSemanticHash = planSha256Hex(planBuildCanonicalEncoding(semanticFingerprintEntries));

  // Correction round (source review defect #5): canonicalBase previously
  // carried only a small head summary, the (already-trimmed) canonicalGraph,
  // and the verificationReceipt -- not the complete immutable Slice 1 basis
  // a later re-commit attempt needs (exact raw prior revision/subject
  // documents, complete manifest/chunk/operation/gateway documents, the
  // prior Assignment-subject set). `input.docs` is the exact same raw,
  // already-verified evidence planValidateCanonicalTemplateRead just used
  // to build `graph` -- reusing it here adds no second read and no second
  // verification of anything not already verified once above.
  var rawDocs = (input && input.docs) || {};
  var priorRevisionsBySubjectId = {};
  priorRevisionsBySubjectId[graph.templateId] = rawDocs.templateRevision;
  var rawChildRevisions = (rawDocs.childRevisions && typeof rawDocs.childRevisions === 'object') ? rawDocs.childRevisions : {};
  Object.keys(rawChildRevisions).forEach(function (sid) { priorRevisionsBySubjectId[sid] = rawChildRevisions[sid]; });
  var priorChildHeadsBySubjectId = (rawDocs.childSubjects && typeof rawDocs.childSubjects === 'object') ? rawDocs.childSubjects : {};
  var priorAssignmentSubjectIds = Object.keys(graph.assignments).slice().sort();
  var rawManifestChunks = Array.isArray(rawDocs.manifestChunks) ? rawDocs.manifestChunks.map(function (c) { return { chunkId: c.chunkId, doc: c.doc }; }) : [];

  var canonicalBase = {
    ownerUid: graph.ownerUid,
    templateId: graph.templateId,
    headRevisionId: graph.templateRevision.revisionId,
    // Correction round 2 (source review defect #4): canonicalGraph.templateRevision
    // is the trimmed read-side PROJECTION (spec Part 5) and never carried
    // revisionSequence -- deriving from it produced a silent null. The
    // exact verified value already exists, independently computed and
    // cross-checked against the raw Template subject/revision during
    // validation, on the verification receipt itself (planValidateCanonicalTemplateRead's
    // headSequence field) -- use that raw verified evidence directly rather
    // than re-deriving from a trimmed projection that never carried it.
    headSequence: validated.verificationReceipt.headSequence,
    headManifestId: graph.manifest.manifestId,
    headManifestHash: graph.manifest.graphHash,
    headManifestChunkIds: graph.manifest.chunkIds.slice(),
    headOperationId: graph.operation.operationId,
    headGatewayId: graph.gateway.gatewayId,
    lifecycleState: graph.templateRevision.lifecycleState,
    verificationReceipt: validated.verificationReceipt,
    canonicalGraph: graph,
    // Production-integration correction: the real public reader
    // (fsPlanReadCanonicalTemplate) always calls readCanonicalTemplate in
    // 'editSession' mode, so this is the ONLY result shape any real caller
    // ever receives -- there is no separate top-level `profileView` the
    // way a direct, mode:'profile' call would return. `profileResult`
    // (above) is already a genuine, fully-verified planBuildCanonicalTemplateProfile
    // output computed from this exact already-verified graph, moments ago,
    // in this same call, purely to build `draft` -- it was previously
    // discarded once `draft` was built from it. Exposing it here adds no
    // second read, no second Firestore transaction, and no relaxed
    // validation: it is the same object, with the same integrity checks
    // already applied, just no longer thrown away. This is what lets
    // planBuildProgressionBasisFromEditSession (below) derive a complete,
    // genuinely verified progression basis from the real public reader's
    // actual result, instead of a shape it was never able to produce.
    profileView: profileResult.profileView,
    // Complete exact raw evidence (not summarized), for a future re-commit
    // attempt's basis -- see planBuildTemplateCommitPackage's own basis
    // contract above for exactly what shape each of these mirrors.
    templateSubject: rawDocs.templateSubject || null,
    templateRevision: rawDocs.templateRevision || null,
    manifestRoot: rawDocs.manifestRoot || null,
    manifestChunks: rawManifestChunks,
    operation: rawDocs.operation || null,
    gateway: rawDocs.gateway || null,
    priorRevisionsBySubjectId: priorRevisionsBySubjectId,
    priorChildHeadsBySubjectId: priorChildHeadsBySubjectId,
    priorAssignmentSubjectIds: priorAssignmentSubjectIds,
    startingSemanticHash: startingSemanticHash
  };

  return Object.freeze({
    outcome: 'verifiedCurrent',
    draft: draft,
    canonicalBase: planDeepFreeze(planDeepClone(canonicalBase)),
    readerState: 'baseCurrent'
  });
}

// ---- planClassifyEditSessionDirtyState(canonicalBase, currentDraft) ----
// Pure, side-effect-free semantic dirty-state classification (spec Part 8
// correction: canonicalBase/dirty-state completeness). Never uses
// JSON.stringify on the whole edit session -- it normalizes currentDraft
// exactly the way planBuildCanonicalTemplateEditSession above does, hashes
// the same order-independent {subjectId, payloadHash, dependencyHash}
// fingerprint, and compares it against canonicalBase.startingSemanticHash.
// readerState changes (baseCurrent/baseStale/baseUnconfirmed/...) never
// enter this comparison at all -- only normalized semantic content does.
function planClassifyEditSessionDirtyState(canonicalBase, currentDraft) {
  if (!canonicalBase || typeof canonicalBase !== 'object' || typeof canonicalBase.startingSemanticHash !== 'string') {
    throw new Error('planClassifyEditSessionDirtyState: canonicalBase (with startingSemanticHash) is required');
  }
  var normalized;
  try {
    normalized = planNormalizeCanonicalGraph(currentDraft);
  } catch (e) {
    return Object.freeze({ dirtyState: 'invalidDraft', reason: e && e.message ? e.message : String(e) });
  }
  var entries = normalized.nodes.map(function (n) {
    return {
      subjectId: n.subjectId,
      recordType: n.recordType,
      payloadHash: planSha256Hex(planBuildCanonicalEncoding(n.semanticPayload)),
      dependencyHash: planSha256Hex(planBuildCanonicalEncoding(n.dependsOnSubjectIds.slice().sort()))
    };
  }).sort(function (x, y) { return x.subjectId < y.subjectId ? -1 : (x.subjectId > y.subjectId ? 1 : 0); });
  var currentHash = planSha256Hex(planBuildCanonicalEncoding(entries));
  return Object.freeze({ dirtyState: currentHash === canonicalBase.startingSemanticHash ? 'unchanged' : 'changed' });
}

// Correction round (source review defect #7): the one supported projection
// derivation version this reader recognizes as "current"; a stored
// derivationVersion that is structurally a number but not this exact value
// is stale, not merely present-and-untyped.
var PLAN_READER_SUPPORTED_PROJECTION_DERIVATION_VERSION = 1;

// A minimal, permissive "does this look like a real server timestamp"
// check -- true for a Firestore Timestamp-shaped object (numeric .seconds,
// or a real SDK Timestamp exposing .toMillis/.toDate), false for a plain
// string/number/null/the pre-write sentinel. Independent probes supplied a
// non-timestamp STRING for freshnessCheckpoint/committedAt and it passed
// the previous "not undefined" check -- this closes that gap.
function planReaderLooksLikeServerTimestamp(v) {
  return !!v && typeof v === 'object' && (typeof v.seconds === 'number' || typeof v.toMillis === 'function' || typeof v.toDate === 'function');
}

// ---- planClassifyTemplateSummaryProjection(verifiedResult, storedSummaryOrNull) ----
// verifiedResult must be the exact object returned by
// planBuildCanonicalTemplateProfile/planValidateCanonicalTemplateRead with
// outcome === 'verifiedCurrent' (a projection can only ever be compared
// against a CURRENT graph -- spec Part 9). storedSummaryOrNull is either a
// plain summary document, or null to represent a confirmed exact absence.
function planClassifyTemplateSummaryProjection(verifiedResult, storedSummaryOrNull) {
  if (!verifiedResult || typeof verifiedResult !== 'object' || verifiedResult.outcome !== 'verifiedCurrent' || !verifiedResult.canonicalGraph) {
    return Object.freeze({ outcome: 'canonicalConflict', reason: 'suppliedCanonicalInputIsNotVerifiedCurrent' });
  }
  var graph = verifiedResult.canonicalGraph;
  var expectedAssignmentCount = Object.keys(graph.assignments).length;
  // Correction round (source review defect #7): the one genuine
  // synchronous-commit timestamp this Template's current head actually
  // has -- verificationReceipt.freshnessCheckpoint is exactly
  // templateRevision.committedAt for a current, verified graph (see
  // planValidateCanonicalTemplateRead's own assembly above). Both the
  // projection's freshnessCheckpoint and committedAt fields are stamped
  // in the SAME synchronous-commit transaction as that same value, so
  // both are now genuinely comparable, not merely type-checked.
  var expectedCommitTimestamp = verifiedResult.verificationReceipt && verifiedResult.verificationReceipt.freshnessCheckpoint;
  var expected = {
    recordType: 'planTemplateSummary',
    recordId: graph.templateId,
    templateId: graph.templateId,
    ownerDomain: 'plan',
    ownerUid: graph.ownerUid,
    schemaVersion: PLAN_READER_SUPPORTED_SCHEMA_VERSION,
    canonicalEncodingVersion: PLAN_READER_SUPPORTED_ENCODING_VERSION,
    headRevisionId: graph.templateRevision.revisionId,
    sourceTemplateHeadRevisionId: graph.templateRevision.revisionId,
    sourceRevisionId: graph.templateRevision.revisionId,
    sourceGatewayId: graph.gateway.gatewayId,
    lifecycleState: 'active',
    lifecycleLabel: 'active',
    name: graph.templateRevision.semanticPayload.name || null,
    description: graph.templateRevision.semanticPayload.description || null,
    structureLabel: graph.templateRevision.semanticPayload.structureLabel || null,
    assignmentCount: expectedAssignmentCount,
    derivationVersion: PLAN_READER_SUPPORTED_PROJECTION_DERIVATION_VERSION,
    rebuildMethod: 'commitSynchronousProjection',
    commitState: 'committed',
    updatedByOperationId: graph.operation.operationId,
    freshnessCheckpoint: expectedCommitTimestamp,
    committedAt: expectedCommitTimestamp
  };

  if (storedSummaryOrNull === null || storedSummaryOrNull === undefined) {
    return Object.freeze({ outcome: 'projectionMissing', expected: planDeepFreeze(planDeepClone(expected)) });
  }
  var doc = storedSummaryOrNull;
  if (!doc || typeof doc !== 'object') {
    return Object.freeze({ outcome: 'projectionMalformed', reason: 'notAPlainDocument' });
  }
  if (doc.recordType !== 'planTemplateSummary' || doc.recordId !== graph.templateId || doc.templateId !== graph.templateId) {
    return Object.freeze({ outcome: 'projectionMalformed', reason: 'identityMismatch' });
  }
  if (doc.ownerUid !== graph.ownerUid || doc.ownerDomain !== 'plan') {
    return Object.freeze({ outcome: 'projectionMalformed', reason: 'ownerMismatch' });
  }
  if (doc.schemaVersion !== PLAN_READER_SUPPORTED_SCHEMA_VERSION || doc.canonicalEncodingVersion !== PLAN_READER_SUPPORTED_ENCODING_VERSION) {
    return Object.freeze({ outcome: 'projectionMalformed', reason: 'unsupportedSchemaOrEncoding' });
  }
  if (typeof doc.derivationVersion !== 'number' || typeof doc.rebuildMethod !== 'string') {
    return Object.freeze({ outcome: 'projectionMalformed', reason: 'missingProjectionMetadata' });
  }
  // Correction round (source review defect #7): freshnessCheckpoint and
  // committedAt were previously accepted whenever merely "not undefined"
  // -- a non-timestamp string sailed through. committedAt itself was
  // never even read by this function before. Both are now required to
  // structurally look like a real server timestamp.
  if (!planReaderLooksLikeServerTimestamp(doc.freshnessCheckpoint)) {
    return Object.freeze({ outcome: 'projectionMalformed', reason: 'invalidFreshnessCheckpointType' });
  }
  if (!planReaderLooksLikeServerTimestamp(doc.committedAt)) {
    return Object.freeze({ outcome: 'projectionMalformed', reason: 'invalidOrMissingCommittedAt' });
  }
  var VALID_REBUILD_METHODS = { commitSynchronousProjection: true, diagnosticReplacement: true };
  if (!VALID_REBUILD_METHODS[doc.rebuildMethod]) {
    return Object.freeze({ outcome: 'projectionMalformed', reason: 'invalidRebuildMethod' });
  }
  if (doc.commitState !== 'committed') {
    return Object.freeze({ outcome: 'projectionMalformed', reason: 'invalidCommitState' });
  }
  if (doc.lifecycleState !== 'active' && doc.lifecycleState !== 'terminated') {
    return Object.freeze({ outcome: 'projectionMalformed', reason: 'contradictoryLifecycle' });
  }
  if (doc.lifecycleState !== 'active') {
    return Object.freeze({ outcome: 'projectionStale', field: 'lifecycleState', differences: Object.freeze([{ field: 'lifecycleState', expected: 'active', actual: doc.lifecycleState }]) });
  }

  // Correction round (source review defect #7): derivationVersion,
  // freshnessCheckpoint, rebuildMethod, and committedAt were previously
  // only gate-checked for presence/type above, never compared for VALUE
  // -- an independent probe changed all four simultaneously (derivationVersion
  // to 999, freshnessCheckpoint to a non-timestamp string, rebuildMethod to
  // the valid-but-wrong diagnosticReplacement, committedAt to a
  // non-timestamp string) and the projection still classified as current.
  // All four (plus commitState/updatedByOperationId provenance binding) are
  // now compared exactly like every other display field.
  var COMPARE_FIELDS = ['assignmentCount', 'commitState', 'committedAt', 'derivationVersion', 'description', 'freshnessCheckpoint', 'headRevisionId', 'lifecycleLabel', 'name', 'rebuildMethod', 'sourceGatewayId', 'sourceRevisionId', 'sourceTemplateHeadRevisionId', 'structureLabel', 'updatedByOperationId'];
  var differences = [];
  for (var i = 0; i < COMPARE_FIELDS.length; i++) {
    var f = COMPARE_FIELDS[i];
    var expVal = planReaderHasOwnKey(expected, f) ? expected[f] : null;
    var actVal = planReaderHasOwnKey(doc, f) ? doc[f] : null;
    if (!planDeepEqual(expVal, actVal)) {
      differences.push({ field: f, expected: expVal, actual: actVal });
    }
  }
  differences.sort(function (a, b) { return a.field < b.field ? -1 : (a.field > b.field ? 1 : 0); });

  if (differences.length === 0) {
    return Object.freeze({ outcome: 'projectionCurrent' });
  }
  return Object.freeze({ outcome: 'projectionStale', differences: planDeepFreeze(planDeepClone(differences)), expected: planDeepFreeze(planDeepClone(expected)) });
}

// ---- planBuildTemplateSummaryReconciliationBlueprint(verifiedResult, classification) ----
// Only meaningful for projectionMissing/projectionStale/projectionMalformed;
// returns null for any other classification outcome (spec Part 10).
function planBuildTemplateSummaryReconciliationBlueprint(verifiedResult, classification) {
  if (!classification || (classification.outcome !== 'projectionMissing' && classification.outcome !== 'projectionStale' && classification.outcome !== 'projectionMalformed')) {
    return null;
  }
  if (!verifiedResult || verifiedResult.outcome !== 'verifiedCurrent' || !verifiedResult.canonicalGraph) {
    return null;
  }
  var graph = verifiedResult.canonicalGraph;
  var expectedDisplayPayload = {
    name: graph.templateRevision.semanticPayload.name || null,
    description: graph.templateRevision.semanticPayload.description || null,
    structureLabel: graph.templateRevision.semanticPayload.structureLabel || null,
    assignmentCount: Object.keys(graph.assignments).length
  };
  var blueprint = {
    target: { path: 'users/' + graph.ownerUid + '/planTemplateSummaries/' + graph.templateId, recordType: 'planTemplateSummary', recordId: graph.templateId },
    canonicalSource: {
      headRevisionId: graph.templateRevision.revisionId,
      sourceRevisionId: graph.templateRevision.revisionId,
      gatewayId: graph.gateway.gatewayId,
      operationId: graph.operation.operationId,
      manifestId: graph.manifest.manifestId,
      graphHash: graph.manifest.graphHash,
      lifecycleState: graph.templateRevision.lifecycleState,
      schemaVersion: PLAN_READER_SUPPORTED_SCHEMA_VERSION,
      canonicalEncodingVersion: PLAN_READER_SUPPORTED_ENCODING_VERSION
    },
    expectedDisplayPayload: expectedDisplayPayload,
    // Correction round (source review defect #7): a malformed/stale
    // projection's replacement must be built from a COMPLETE required
    // envelope -- identity, ownership, schema/encoding, lifecycle/commit,
    // projection metadata, and provenance -- not only a small identity
    // subset.
    requiredEnvelope: {
      ownerDomain: 'plan', ownerUid: graph.ownerUid,
      recordType: 'planTemplateSummary', recordId: graph.templateId, templateId: graph.templateId,
      schemaVersion: PLAN_READER_SUPPORTED_SCHEMA_VERSION, canonicalEncodingVersion: PLAN_READER_SUPPORTED_ENCODING_VERSION,
      lifecycleState: 'active', lifecycleLabel: 'active', commitState: 'committed',
      derivationVersion: PLAN_READER_SUPPORTED_PROJECTION_DERIVATION_VERSION,
      updatedByOperationId: graph.operation.operationId
    },
    requiredRepairProvenance: {
      repairOperationId: null, repairActorUid: null, repairAuthorityKind: null,
      // A future repair that did NOT occur inside the original Template
      // commitment must never claim 'commitSynchronousProjection' -- that
      // label is reserved for the current synchronous writer (spec Part 9).
      truthfulRebuildMethod: 'diagnosticReplacement',
      separateWriteAuthorityRequired: true
    },
    requiredServerTimeFields: ['committedAt', 'freshnessCheckpoint'],
    differences: (classification.differences ? classification.differences.slice() : []).slice().sort(function (a, b) { return a.field < b.field ? -1 : (a.field > b.field ? 1 : 0); })
  };
  return planDeepFreeze(planDeepClone(blueprint));
}

// =============================================================================
// SLICE 5A -- Canonical Program Editor: production adapters and orchestration
// =============================================================================
// Accepted contract: slice5a-bridge-creation-spec-round11.md (round 1) and
// slice5a-bridge-creation-spec-round12.md (round-2 correction). Two pure,
// symmetric adapters (editor state <-> canonical draft), a commit-basis
// builder, and two thin orchestration functions that call the accepted
// canonical writer/reader entry points in firebase.js via an injected `ctx`
// (never a hardcoded global reference -- these functions must run standalone
// under Node `require()`, exactly like every other function in this file).
// None of this touches, calls, or reuses any legacy editor function
// (planCreateNewProgram, planEditTemplate, planSaveTemplate,
// planEnableProgression, planDefaultLoadIncrease, and neighbors) -- Slice 5A
// adds new, parallel functions only; no legacy function is modified.

// ---- Approved canonical defaults for a brand-new progression rule (round-2
// correction §3, user-approved). No authoritative canonical default existed
// anywhere in source before this slice -- the two pre-existing fallback
// sites (legacy planEnableProgression and this same file's own
// planBuildCanonicalTemplateEditSession empty-rule fallback, ~line 7636)
// disagreed with each other on adjustmentType/loadIncrease/tmIncrease. This
// is a new, explicitly-named, explicitly-approved constant, not a recovered
// fact.
var PLAN_CANONICAL_PROGRESSION_DEFAULTS = Object.freeze({
  evaluationType: 'strict',
  gatewaySetIndex: 0,
  adjustmentType: 'increaseTM',
  loadIncrease: 0,
  tmIncrease: 0,
  failBehavior: 'repeat'
});

// ---- New, explicit client-schema-generation constant Slice 5A stamps on
// every commit basis. No prior caller ever supplied one (round-1 §1.3: "None
// of these exist as concepts anywhere in today's UI").
var PLAN_CANONICAL_CLIENT_SCHEMA_GENERATION = 1;

// ---- Typed error for the adapter's own shape-level input rejection
// (round-1 §4: "Rejects unsupported or malformed editor state rather than
// silently discarding it"). Deliberately separate from
// PlanCanonicalNormalizationError, which governs the deeper, already-
// accepted graph-normalization checks this adapter never duplicates
// (round-1 §4: "avoid duplicating writer or reader validation logic").
function PlanCanonicalEditorAdapterError(message) {
  var base = Error.call(this, message || 'Slice 5A canonical editor adapter rejected malformed input.');
  this.message = base.message;
  this.stack = base.stack;
  this.name = 'PlanCanonicalEditorAdapterError';
  this.code = 'PLAN_CANONICAL_EDITOR_ADAPTER_ERROR';
}
PlanCanonicalEditorAdapterError.prototype = Object.create(Error.prototype);
PlanCanonicalEditorAdapterError.prototype.constructor = PlanCanonicalEditorAdapterError;

function planCanonicalAdapterRequire(condition, message) {
  if (!condition) throw new PlanCanonicalEditorAdapterError(message);
}

function planCanonicalAdapterOptionalString(v) {
  return (typeof v === 'string') ? v : '';
}

// Mirrors the canonical model's own "absent vs present" contract (round-1
// §1.4): undefined/null both mean "not set". A present numeric value --
// INCLUDING 0 -- passes through completely unchanged; 0 is never mistaken
// for absence (round-2 correction requirement 7: "Reopen must preserve all
// stored values exactly, including valid zero values"). This function does
// not itself validate numeric-ness -- planNormalizeNumberField already does
// that later in the pipeline, and duplicating it here was explicitly
// avoided per round-1 §4.
function planCanonicalAdapterOptionalNumeric(v) {
  return (v === undefined || v === null) ? '' : v;
}

// Fresh, never-before-existing progression state for a newly added exercise
// entry. Reads ONLY PLAN_CANONICAL_PROGRESSION_DEFAULTS -- never
// planDefaultLoadIncrease, never planEnableProgression, never any
// exercise-set-composition inference (round-2 correction §3, rule 4: reused
// visual controls must never silently inject a legacy initialization
// value).
function planNewCanonicalProgressionState() {
  return {
    enabled: false,
    evaluationType: PLAN_CANONICAL_PROGRESSION_DEFAULTS.evaluationType,
    gatewaySetIndex: PLAN_CANONICAL_PROGRESSION_DEFAULTS.gatewaySetIndex,
    adjustmentType: PLAN_CANONICAL_PROGRESSION_DEFAULTS.adjustmentType,
    loadIncrease: PLAN_CANONICAL_PROGRESSION_DEFAULTS.loadIncrease,
    tmIncrease: PLAN_CANONICAL_PROGRESSION_DEFAULTS.tmIncrease,
    failBehavior: PLAN_CANONICAL_PROGRESSION_DEFAULTS.failBehavior
  };
}

function planCanonicalAdaptProgressionField(prog) {
  // prog may be: a real progression object (either direction), or
  // null/absent (creation direction only -- reopen always has one, since
  // planBuildCanonicalTemplateEditSession always produces one, round-1
  // §1.2). Round-2 correction §3 rule 1/2/3: creation uses the approved
  // defaults, reopen/edit preserve every stored value exactly, and neither
  // adapter direction ever resets a field to the default merely because it
  // currently equals the default.
  if (!prog || typeof prog !== 'object') {
    return planNewCanonicalProgressionState();
  }
  var out = {
    enabled: !!prog.enabled,
    evaluationType: planCanonicalAdapterOptionalString(prog.evaluationType),
    gatewaySetIndex: planCanonicalAdapterOptionalNumeric(prog.gatewaySetIndex),
    adjustmentType: planCanonicalAdapterOptionalString(prog.adjustmentType),
    loadIncrease: planCanonicalAdapterOptionalNumeric(prog.loadIncrease),
    tmIncrease: planCanonicalAdapterOptionalNumeric(prog.tmIncrease),
    failBehavior: planCanonicalAdapterOptionalString(prog.failBehavior)
  };
  if (typeof prog.planRuleId === 'string' && prog.planRuleId) out.planRuleId = prog.planRuleId;
  return out;
}

function planCanonicalAdaptSetField(st) {
  planCanonicalAdapterRequire(st && typeof st === 'object', 'planCanonicalAdaptSetField: each set entry must be an object');
  var out = {
    loadType: planCanonicalAdapterOptionalString(st.loadType),
    weight: planCanonicalAdapterOptionalNumeric(st.weight),
    percent: planCanonicalAdapterOptionalNumeric(st.percent),
    addedWeight: planCanonicalAdapterOptionalNumeric(st.addedWeight),
    repsType: planCanonicalAdapterOptionalString(st.repsType),
    reps: planCanonicalAdapterOptionalNumeric(st.reps),
    minReps: planCanonicalAdapterOptionalNumeric(st.minReps),
    maxReps: planCanonicalAdapterOptionalNumeric(st.maxReps),
    effortType: planCanonicalAdapterOptionalString(st.effortType),
    rir: planCanonicalAdapterOptionalNumeric(st.rir),
    minRir: planCanonicalAdapterOptionalNumeric(st.minRir),
    maxRir: planCanonicalAdapterOptionalNumeric(st.maxRir),
    timeType: planCanonicalAdapterOptionalString(st.timeType),
    seconds: planCanonicalAdapterOptionalNumeric(st.seconds),
    minSeconds: planCanonicalAdapterOptionalNumeric(st.minSeconds),
    maxSeconds: planCanonicalAdapterOptionalNumeric(st.maxSeconds),
    notes: planCanonicalAdapterOptionalString(st.notes)
  };
  if (typeof st.planSetId === 'string' && st.planSetId) out.planSetId = st.planSetId;
  return out;
}

// Shared by both adapter directions -- the nesting shape (microcycles ->
// sessions -> exercises -> sets/progression) is identical in the editor and
// canonical-draft shapes (round-1 §1.1/§1.2); only which identity fields are
// carried differs between directions (see the two callers below).
function planCanonicalAdaptStructure(source, carryIds) {
  planCanonicalAdapterRequire(source && typeof source === 'object' && !Array.isArray(source), 'must be a plain object');
  planCanonicalAdapterRequire(Array.isArray(source.microcycles), 'microcycles must be an array');

  var out = {
    name: planCanonicalAdapterOptionalString(source.name),
    description: planCanonicalAdapterOptionalString(source.description),
    structureLabel: planCanonicalAdapterOptionalString(source.structureLabel),
    notes: planCanonicalAdapterOptionalString(source.notes),
    microcycles: []
  };
  if (carryIds && typeof source.planTemplateId === 'string' && source.planTemplateId) {
    out.planTemplateId = source.planTemplateId;
  }

  source.microcycles.forEach(function (mc) {
    planCanonicalAdapterRequire(mc && typeof mc === 'object', 'each microcycle must be an object');
    planCanonicalAdapterRequire(Array.isArray(mc.sessions), 'microcycle.sessions must be an array');
    var mcOut = { name: planCanonicalAdapterOptionalString(mc.name), sessions: [] };
    if (carryIds && typeof mc.planMicrocycleId === 'string' && mc.planMicrocycleId) mcOut.planMicrocycleId = mc.planMicrocycleId;

    mc.sessions.forEach(function (s) {
      planCanonicalAdapterRequire(s && typeof s === 'object', 'each session must be an object');
      planCanonicalAdapterRequire(Array.isArray(s.exercises), 'session.exercises must be an array');
      var sOut = { name: planCanonicalAdapterOptionalString(s.name), notes: planCanonicalAdapterOptionalString(s.notes), exercises: [] };
      if (carryIds && typeof s.planSessionId === 'string' && s.planSessionId) sOut.planSessionId = s.planSessionId;

      s.exercises.forEach(function (ex) {
        planCanonicalAdapterRequire(ex && typeof ex === 'object', 'each exercise entry must be an object');
        planCanonicalAdapterRequire(typeof ex.exerciseId === 'string' && ex.exerciseId, 'exercise entry is missing exerciseId');
        planCanonicalAdapterRequire(Array.isArray(ex.sets), 'exercise.sets must be an array');
        var exOut = {
          exerciseId: ex.exerciseId,
          notes: planCanonicalAdapterOptionalString(ex.notes),
          sets: ex.sets.map(planCanonicalAdaptSetField),
          progression: planCanonicalAdaptProgressionField(ex.progression)
        };
        if (carryIds) {
          if (typeof ex.planAssignmentId === 'string' && ex.planAssignmentId) exOut.planAssignmentId = ex.planAssignmentId;
          if (typeof ex.planOpportunityId === 'string' && ex.planOpportunityId) exOut.planOpportunityId = ex.planOpportunityId;
          if (typeof ex.planPrescriptionId === 'string' && ex.planPrescriptionId) exOut.planPrescriptionId = ex.planPrescriptionId;
          if (typeof ex.planRelationshipId === 'string' && ex.planRelationshipId) exOut.planRelationshipId = ex.planRelationshipId;
        }
        sOut.exercises.push(exOut);
      });

      mcOut.sessions.push(sOut);
    });

    out.microcycles.push(mcOut);
  });

  return out;
}

// ---- planAdaptEditorStateToCanonicalDraft(editorState) ----
// Pure, no I/O. Editor state -> canonical draft (round-1 §3.1). Identity
// fields already present on editorState (the edit path -- editorState was
// produced by a prior planAdaptCanonicalDraftToEditorState call) are carried
// through unchanged; identity fields absent (the create path) are simply
// omitted, since this function never mints an id itself -- that is
// planEnsureDraftIdentities's job, called by the orchestration layer below,
// never here.
function planAdaptEditorStateToCanonicalDraft(editorState) {
  return planCanonicalAdaptStructure(editorState, true);
}

// ---- planAdaptCanonicalDraftToEditorState(draft) ----
// Pure, no I/O. Reverse of the above (round-1 §3.2). Always carries every
// identity field through unchanged -- never drops one -- since preserving
// them is exactly what keeps planTemplateId (and every child id) stable
// across the next save (round-1 §1.5/§3.3).
function planAdaptCanonicalDraftToEditorState(draft) {
  return planCanonicalAdaptStructure(draft, true);
}

// ---- planBuildCommitBasis(ownerUid, actorUid, priorCanonicalBase, deviceId, sessionId) ----
// New plumbing (round-1 §1.3). When priorCanonicalBase is supplied (this
// editorState was reopened via a real fsPlanReadCanonicalTemplate call
// earlier in the same edit session), its templateSubject /
// priorRevisionsBySubjectId / priorAssignmentSubjectIds are carried straight
// through unchanged -- exactly the fields planBuildTemplateCommitPackage's
// own basis contract expects a re-commit to supply, and exactly the fields
// planBuildCanonicalTemplateEditSession's own canonicalBase output already
// carries for this purpose (round-2 correction §5 execution-flow note; see
// also plan-canonical-commit.test.js's basisAgainst()/freshBasis() test
// helpers, which this mirrors). When absent (a brand-new Template, never
// before saved), fresh/empty values are used.
// ---- planCanonicalBasisAttachExpectedEnvelope(doc, provenanceField) ----
// Bug found and fixed during Slice 5A's own round-trip acceptance testing
// (Category C4, a real edit-and-resave of a reopened Template): every prior
// document a re-commit's basis names (the Template subject, a prior child
// subject head, a prior revision) must carry a frozen `expectedEnvelope`
// (planRequireExpectedEnvelope, round-9 review Defect #2) naming what that
// document's historical envelope fields are INDEPENDENTLY known to be --
// "supplied by the caller who read it from the real canonical store, never
// derived from the document being checked itself." canonicalBase's raw
// prior-document fields (priorRevisionsBySubjectId[sid], etc.) are exactly
// that real read, but arrive as flat documents with no nested
// `.expectedEnvelope` sub-object -- this basis builder is the caller
// responsible for constructing it, and had not done so.
// Reuses planReaderEnvelopeSnapshot (app-plan.js ~line 5783), an existing,
// already-accepted, pure Slice-4-era helper for exactly this envelope-field
// extraction that had no caller anywhere in source until this slice wires
// it up -- not new validation logic, only the missing plumbing. provenanceField
// is 'createdByOperationId' for a revision document, 'updatedByOperationId'
// for a subject document (Template subject or a child subject head),
// mirroring the exact field-per-document-kind convention
// planHistoricalEnvelopeMismatchReason's own call sites already use
// (app-plan.js ~lines 4736/4780/4904).
function planCanonicalBasisAttachExpectedEnvelope(doc, provenanceField) {
  if (!doc || typeof doc !== 'object') return doc;
  var envelope = planReaderEnvelopeSnapshot(doc);
  var expectedEnvelope = {
    ownerUid: envelope.ownerUid, actorUid: envelope.actorUid, authorityKind: envelope.authorityKind,
    authorityScope: envelope.authorityScope, authorityBasisRefs: envelope.authorityBasisRefs,
    clientSchemaGeneration: envelope.clientSchemaGeneration,
    provenanceOperationId: doc[provenanceField],
    sourceKind: envelope.sourceKind, sourceRefs: envelope.sourceRefs, clientCreatedAt: envelope.clientCreatedAt,
    effectiveBoundary: envelope.effectiveBoundary, commitState: envelope.commitState,
    lifecycleState: envelope.lifecycleState, canonicalEncodingVersion: envelope.canonicalEncodingVersion
  };
  var out = {};
  Object.keys(doc).forEach(function (k) { out[k] = doc[k]; });
  out.expectedEnvelope = expectedEnvelope;
  return out;
}

// ---- planCanonicalBasisAttachRevisionExpectations(doc) ----
// A prior REVISION document's basis entry (basis.priorRevisionsBySubjectId)
// needs, beyond expectedEnvelope, a nested `semanticPayload` object
// (addPredecessorRefIfNeeded, app-plan.js ~line 3334, round-6 Defect #3).
// Stored revision documents are flat -- envelope and semantic fields
// intermixed at the top level, no nested semanticPayload key -- exactly the
// gap planReaderExtractSemanticPayload (app-plan.js ~line 5736, another
// existing, already-accepted, pure Slice-4-era helper with no caller
// anywhere in source until this slice) exists to close. dependencyRefs,
// payloadHash, dependencyHash, and revisionId are already present flat on
// the raw document under those exact names, so no further reconstruction
// is needed for them.
function planCanonicalBasisAttachRevisionExpectations(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  var withEnvelope = planCanonicalBasisAttachExpectedEnvelope(doc, 'createdByOperationId');
  withEnvelope.semanticPayload = planReaderExtractSemanticPayload(doc, doc.recordType);
  return withEnvelope;
}

function planBuildCommitBasis(ownerUid, actorUid, priorCanonicalBase, deviceId, sessionId) {
  planCanonicalAdapterRequire(typeof ownerUid === 'string' && ownerUid, 'planBuildCommitBasis: ownerUid is required');
  planCanonicalAdapterRequire(typeof actorUid === 'string' && actorUid, 'planBuildCommitBasis: actorUid is required');
  var prior = (priorCanonicalBase && typeof priorCanonicalBase === 'object') ? priorCanonicalBase : null;
  var priorRevisionsBySubjectId = {};
  if (prior && prior.priorRevisionsBySubjectId && typeof prior.priorRevisionsBySubjectId === 'object') {
    Object.keys(prior.priorRevisionsBySubjectId).forEach(function (sid) {
      priorRevisionsBySubjectId[sid] = planCanonicalBasisAttachRevisionExpectations(prior.priorRevisionsBySubjectId[sid]);
    });
  }
  // priorChildHeadsBySubjectId: also required by planBuildTemplateCommitPackage's
  // basis contract (app-plan.js:3055 and expectedEnvelopeSourceFor) -- the
  // first Slice 5A implementation omitted this field from the basis
  // entirely; canonicalBase (planBuildCanonicalTemplateEditSession,
  // ~line 7742/7777) already carries it for exactly this purpose.
  var priorChildHeadsBySubjectId = {};
  if (prior && prior.priorChildHeadsBySubjectId && typeof prior.priorChildHeadsBySubjectId === 'object') {
    Object.keys(prior.priorChildHeadsBySubjectId).forEach(function (sid) {
      priorChildHeadsBySubjectId[sid] = planCanonicalBasisAttachExpectedEnvelope(prior.priorChildHeadsBySubjectId[sid], 'updatedByOperationId');
    });
  }
  var templateSubject = (prior && prior.templateSubject) ? planCanonicalBasisAttachExpectedEnvelope(prior.templateSubject, 'updatedByOperationId') : null;
  return {
    ownerUid: ownerUid,
    actorUid: actorUid,
    clientSchemaGeneration: PLAN_CANONICAL_CLIENT_SCHEMA_GENERATION,
    clientCreatedAt: Date.now(),
    deviceId: (typeof deviceId === 'string' && deviceId) ? deviceId : 'slice5a-unknown-device',
    sessionId: (typeof sessionId === 'string' && sessionId) ? sessionId : 'slice5a-unknown-session',
    templateSubject: templateSubject,
    priorRevisionsBySubjectId: priorRevisionsBySubjectId,
    priorChildHeadsBySubjectId: priorChildHeadsBySubjectId,
    priorAssignmentSubjectIds: prior ? prior.priorAssignmentSubjectIds : []
  };
}

function planClassifyCanonicalWriteError(err, draft) {
  var name = err && err.name;
  if (name === 'CanonicalPlanWriterDisabledError') return { status: 'disabled', error: err, draft: draft };
  if (name === 'CanonicalPlanCommitBlockedError') return { status: 'conflict', error: err, draft: draft };
  if (name === 'CanonicalPlanCommitUnavailableError') return { status: 'retryable', error: err, draft: draft };
  return { status: 'permanent', error: err, draft: draft };
}

// ---- planBuildCanonicalSaveAttempt(editorState, ctx) ----
// Save-lifecycle correction (requirement 2: "Preserve the exact pending
// package across retryable uncertainty"). This is the BUILD half of what
// planSaveCanonicalTemplate below used to do in one shot -- everything that
// runs before the network commit (adapt editor state -> allocate stable
// identities -> build the commit basis from _priorCanonicalBase -> mint
// operation/manifest/gateway/revision ids -> build the commit package) --
// extracted into its own synchronous, side-effect-free function so a caller
// can build the package EXACTLY ONCE, hold onto the resulting package
// object, and commit (or re-commit, on Retry) that SAME object without ever
// re-running identity allocation or package construction. Returns
// { ok:true, package, draft } on success, or { ok:false, status:'blocked',
// blockReason, details, draft } when planBuildTemplateCommitPackage itself
// refuses the draft (mirrors planSaveCanonicalTemplate's own pre-existing
// 'blocked' branch, unchanged).
function planBuildCanonicalSaveAttempt(editorState, ctx) {
  planCanonicalAdapterRequire(ctx && typeof ctx === 'object', 'planBuildCanonicalSaveAttempt: ctx is required');
  var allocator = (typeof ctx.allocateId === 'function') ? ctx.allocateId : planDefaultIdAllocator;

  var rawDraft = planAdaptEditorStateToCanonicalDraft(editorState);
  var draft = planEnsureDraftIdentities(rawDraft, allocator);

  var basis = planBuildCommitBasis(ctx.ownerUid, ctx.actorUid, editorState && editorState._priorCanonicalBase, ctx.deviceId, ctx.sessionId);
  var ids = {
    operationId: allocator(),
    manifestId: allocator(),
    gatewayId: allocator(),
    allocateRevisionId: allocator
  };

  var pkgResult = planBuildTemplateCommitPackage(draft, basis, ids);
  if (!pkgResult.ok) {
    return { ok: false, status: 'blocked', blockReason: pkgResult.blockReason, details: pkgResult.details || {}, draft: draft };
  }
  return { ok: true, package: pkgResult.package, draft: draft };
}

// ---- planCommitCanonicalPackageAndClassify(ctx, pkg, draft) ----
// The COMMIT half: submits an already-built package (never rebuilds it) and
// classifies the result/error into the same outcome vocabulary
// planSaveCanonicalTemplate has always returned. Shared by
// planSaveCanonicalTemplate (first attempt) below AND by the editor's own
// planCanonicalEditorHandleRetrySave (requirement 2's Retry action, which
// must resubmit the byte-identical stored package and must NEVER call
// planSaveCanonicalTemplate again, since that would rebuild with fresh
// ids) -- one single place classifies a commit outcome, so both callers
// agree on what 'success'/'alreadyCommitted'/'retryable'/etc. mean.
async function planCommitCanonicalPackageAndClassify(ctx, pkg, draft) {
  planCanonicalAdapterRequire(ctx && typeof ctx === 'object', 'planCommitCanonicalPackageAndClassify: ctx is required');
  planCanonicalAdapterRequire(typeof ctx.commitCanonicalPackage === 'function', 'planCommitCanonicalPackageAndClassify: ctx.commitCanonicalPackage must be a function');
  try {
    var outcome = await ctx.commitCanonicalPackage(pkg);
    // outcome.result is one of 'committed' | 'alreadyCommitted' | 'noChange'
    // -- firebase.js's own preflight already rejects anything else before
    // this ever returns (round-1 source finding, firebase.js:1322-1334), so
    // no further branch is needed here.
    var status = (outcome && (outcome.result === 'committed' || outcome.result === 'noChange')) ? 'success'
      : (outcome && outcome.result === 'alreadyCommitted') ? 'alreadyCommitted'
      : 'permanent';
    return { status: status, outcome: outcome, draft: draft };
  } catch (err) {
    return planClassifyCanonicalWriteError(err, draft);
  }
}

// ---- planSaveCanonicalTemplate(editorState, ctx) ----
// ctx: { ownerUid, actorUid, deviceId, sessionId, allocateId (fn, optional),
//        commitCanonicalPackage (fn -- production callers pass the real
//        fsPlanCommitCanonicalPackage; tests pass a fake) }.
// Orchestration only (round-1 §4's execution flow) -- calls the already-
// accepted planBuildTemplateCommitPackage and the already-accepted writer;
// no semantic validation is duplicated here. Every outcome maps to the
// vocabulary in round-1 §6. Unchanged in outward behavior/signature by the
// save-lifecycle correction -- it is now a two-line composition of
// planBuildCanonicalSaveAttempt + planCommitCanonicalPackageAndClassify
// above, kept as its own function because every pre-existing caller
// (Categories A-G/H of plan-slice5a-editor.test.js, and any other future
// non-editor caller) calls it directly as a single-shot "build AND commit"
// operation with no notion of a retry-able pending attempt -- that notion
// exists ONLY inside the editor layer below (planCanonicalEditorState),
// never here.
async function planSaveCanonicalTemplate(editorState, ctx) {
  planCanonicalAdapterRequire(ctx && typeof ctx === 'object', 'planSaveCanonicalTemplate: ctx is required');
  planCanonicalAdapterRequire(typeof ctx.commitCanonicalPackage === 'function', 'planSaveCanonicalTemplate: ctx.commitCanonicalPackage must be a function');
  var built = planBuildCanonicalSaveAttempt(editorState, ctx);
  if (!built.ok) {
    return { status: built.status, blockReason: built.blockReason, details: built.details, draft: built.draft };
  }
  return planCommitCanonicalPackageAndClassify(ctx, built.package, built.draft);
}

function planClassifyCanonicalReadError(err) {
  var name = err && err.name;
  if (name === 'CanonicalPlanReaderDisabledError') return { status: 'disabled', error: err };
  if (name === 'CanonicalPlanReaderUnavailableError') return { status: 'retryable', error: err };
  return { status: 'permanent', error: err };
}

// ---- planReopenCanonicalTemplate(ownerUid, templateId, ctx) ----
// ctx: { readCanonicalTemplate (fn -- production callers pass the real
//        fsPlanReadCanonicalTemplate; tests pass a fake) }.
// Always performs a real read through the accepted reader (round-2
// correction §5: the in-memory reopen shortcut is removed as an acceptance
// requirement). fsPlanReadCanonicalTemplate calls the reader suite's
// readCanonicalTemplate in 'editSession' mode internally, which already
// returns the exact { outcome, draft, canonicalBase, readerState } shape
// planAdaptCanonicalDraftToEditorState needs -- no separate call to
// planBuildCanonicalTemplateEditSession happens here.
async function planReopenCanonicalTemplate(ownerUid, templateId, ctx) {
  planCanonicalAdapterRequire(ctx && typeof ctx === 'object', 'planReopenCanonicalTemplate: ctx is required');
  planCanonicalAdapterRequire(typeof ctx.readCanonicalTemplate === 'function', 'planReopenCanonicalTemplate: ctx.readCanonicalTemplate must be a function');
  try {
    var result = await ctx.readCanonicalTemplate({ ownerUid: ownerUid, templateId: templateId });
    if (result && result.outcome === 'retryableFailure') {
      return { status: 'retryable', result: result };
    }
    if (!result || (result.outcome !== 'verifiedCurrent' && result.outcome !== 'verifiedHistorical')) {
      return { status: 'permanent', result: result };
    }
    var editorState = planAdaptCanonicalDraftToEditorState(result.draft);
    // Hidden bookkeeping field, never rendered by any UI control -- carried
    // only so the NEXT save (planSaveCanonicalTemplate) can supply a
    // correct re-commit basis (round-1 §3.3: "how identity is retained
    // between successive saves").
    editorState._priorCanonicalBase = result.canonicalBase;
    return { status: 'success', editorState: editorState, readerState: result.readerState };
  } catch (err) {
    return planClassifyCanonicalReadError(err);
  }
}

// =============================================================================
// SLICE 5A COMPLETION CORRECTION -- production canonical editor UI
// =============================================================================
// Accepted contract: this correction's own live-authorization message
// ("Perform a narrowly scoped Slice 5A completion correction"). The
// functions above this banner (planSaveCanonicalTemplate,
// planReopenCanonicalTemplate, planNewCanonicalProgressionState, and the
// two pure adapters) had no real caller anywhere in the browser
// application -- this section is that caller: a small, genuinely parallel,
// production browser workflow built entirely from new functions. The
// existing legacy Program editor (planCreateNewProgram, planEditTemplate,
// planSaveTemplate, planEnableProgression, planRenderDetailsEditor, and
// everything else above the original SLICE 5A banner near the top of this
// file's Slice 5A section) is completely untouched by this correction --
// zero lines in that code changed, and nothing here calls into it.
//
// Reachability ("hidden from normal production navigation... reachable
// only through the approved development/test entry mechanism"): this
// workflow has no entry in showPage()'s page-id dispatch and no nav
// button anywhere in the app shell. Its ONLY entry point is
// planCanonicalEditorBoot(), called from exactly one place in the whole
// app -- a single guarded check in app-core.js, immediately after the
// normal startup sequence finishes (see that file's own "SLICE 5A" comment
// near its auth.onAuthStateChanged handler), gated on a URL query
// parameter (see PLAN_CANONICAL_EDITOR_DEV_QUERY_PARAM below) that nothing
// in normal navigation ever sets or reads. A person who does not know that
// exact parameter name can never reach this screen by clicking anything in
// the app. This is the "approved development/test entry mechanism" this
// correction establishes -- no such convention existed anywhere in the app
// before it.
//
// Production identity binding ("do not trust an arbitrary UI-supplied
// owner UID"): planCanonicalEditorBuildProductionCtx() is the ONLY place
// ownerUid/actorUid are read, and it reads them from auth.currentUser.uid
// -- the live Firebase Auth handle, the exact same accessor firebase.js's
// own buildProductionCanonicalCommitDeps/buildProductionCanonicalReaderDeps
// already use (firebase.js, inside the SLICE 5A dormant-delegation-wiring
// section). The editor's own state shape (planCanonicalEditorFreshState())
// carries no ownerUid/actorUid field at all -- there is no form field a
// person could type into to influence either value -- and the Firebase
// layer independently re-verifies ownership on every call regardless of
// what this layer sends (dispatchCanonicalCommit/dispatchCanonicalTemplateRead,
// and the real executor/reader suite's own requireAuthenticatedOwner
// cross-check).
//
// Testability without touching the real capability flags ("the test must
// start at the new canonical editor's production handler"): every handler
// below (*Boot, *HandleNew, *HandleEnableProgression, *HandleSave,
// *HandleReopen, and neighbors) is the SAME function a real click in the
// browser invokes -- there is no separate "test version" of any of them.
// planCanonicalEditorBoot accepts one optional argument, a ctx override,
// solely for this purpose: the real app (app-core.js) always calls it with
// zero arguments, which always builds ctx from the real auth handle and
// the real fsPlanPersistence.fsPlanCommitCanonicalPackage/
// fsPlanReadCanonicalTemplate public functions (themselves still gated on
// the real hardcoded-false capability constants in firebase.js). A
// Node-only test instead passes a ctx whose commitCanonicalPackage/
// readCanonicalTemplate are bound to the existing
// __test.dispatchCanonicalCommitForTest/dispatchCanonicalTemplateReadForTest
// seam, then drives the IDENTICAL handler functions production uses --
// mirroring the same injection pattern firebase.js's own dormant-delegation
// wiring already established and this project already accepted.

var PLAN_CANONICAL_EDITOR_DEV_QUERY_PARAM = 'slice5aCanonicalEditor';
var PLAN_CANONICAL_EDITOR_CONTAINER_ID = 'slice5a-canonical-editor-root';
var PLAN_CANONICAL_EDITOR_DEVICE_ID_STORAGE_KEY = 'slice5aCanonicalEditorDeviceId';

// ---- Uncertain-save recovery marker (Slice 5A uncertain-save recovery
// correction, requirement 3) ----
// A SMALL, owner-scoped local-storage marker written just before the first
// commit attempt of a Save so that, if the page reloads before that
// attempt's outcome is ever confirmed (the browser crashes, the tab is
// closed, the network reply never arrives), the NEXT boot can check whether
// the write actually landed rather than silently offering a brand-new
// "unidentified Program" Save that could mint a duplicate. Deliberately
// minimal -- requirement 3 is explicit that the complete package, editor
// contents, Firestore documents, auth credentials, or capability state must
// never be persisted here: only what is needed to look the attempt up
// again (schemaVersion, ownerUid, planTemplateId, operationId, createdAt).
var PLAN_CANONICAL_EDITOR_RECOVERY_MARKER_STORAGE_KEY = 'slice5aCanonicalEditorRecoveryMarker';
var PLAN_CANONICAL_EDITOR_RECOVERY_MARKER_SCHEMA_VERSION = 1;

// Module-scoped, not exported for direct mutation -- planCanonicalEditorGetState()
// below is the only read accessor, matching the read-only-getter convention
// firebase.js's own __test.hasRegistry already uses for similar module state.
var planCanonicalEditorState = null;
var planCanonicalEditorSessionIdCache = null;
var planCanonicalEditorFallbackDeviceId = null;

function planCanonicalEditorGetState() { return planCanonicalEditorState; }

// Authentication is a hard boundary for all canonical UI state. Replacing
// these module-scoped state objects invalidates the canonical editor's existing
// stale-result guards; clearing both containers ensures a newly authenticated
// user cannot see data left in memory by the previous account.
function planResetCanonicalUserScopedState() {
  planCanonicalEditorState = null;
  planProgressionManualState = null;
  if (typeof document !== 'undefined') {
    var editorRoot = document.getElementById(PLAN_CANONICAL_EDITOR_CONTAINER_ID);
    if (editorRoot) editorRoot.innerHTML = '';
    var progressionRoot = document.getElementById(PLAN_PROGRESSION_MANUAL_CONTAINER_ID);
    if (progressionRoot) progressionRoot.innerHTML = '';
  }
}

// ---- planCanonicalEditorFreshState() ----
// The starting shape for a brand-new canonical Program: one microcycle, one
// session, one exercise (empty exerciseId -- a person fills it in), one set,
// no progression object at all (progression is only ever attached by an
// explicit "Enable Progression" action below, via
// planNewCanonicalProgressionState() -- never present by default, never
// built from any legacy default). Every field name here matches
// planCanonicalAdaptStructure's own editor-state shape exactly (see that
// function above): this is real editor state, adapted by the real
// planAdaptEditorStateToCanonicalDraft on save, not a separate shape.
function planCanonicalEditorFreshSet() {
  return {
    loadType: 'fixed', weight: null, percent: null, addedWeight: null,
    repsType: 'fixed', reps: null, minReps: null, maxReps: null,
    effortType: '', rir: null, minRir: null, maxRir: null,
    timeType: '', seconds: null, minSeconds: null, maxSeconds: null,
    notes: ''
  };
}
function planCanonicalEditorFreshExercise() {
  return { exerciseId: '', notes: '', sets: [planCanonicalEditorFreshSet()] };
}
function planCanonicalEditorFreshState() {
  return {
    name: '', description: '', structureLabel: '', notes: '',
    microcycles: [{
      name: 'Week 1',
      sessions: [{ name: 'Day 1', notes: '', exercises: [planCanonicalEditorFreshExercise()] }]
    }]
  };
}

// ---- Device/session identity (round-2 completion correction requirement
// 2: "stable device/session identity"). No convention for either existed
// anywhere in the app before this correction (confirmed by source
// investigation: no localStorage-based device id, no session id generator,
// anywhere in app-core.js, app-plan.js, or firebase.js prior to this
// change). deviceId is minted once per browser (persisted in localStorage
// so it survives a reload) using the same approved allocator
// (planDefaultIdAllocator) planSaveCanonicalTemplate already falls back to
// for every other id it mints; sessionId is minted once per page load
// (module-scoped cache, never persisted). Both degrade to an in-memory
// fallback under Node (no localStorage there), so calling these from a
// test never throws.
// Save-lifecycle correction requirement 3: tolerate localStorage EXISTING
// but throwing on access -- e.g. Safari private-browsing mode, where
// `typeof localStorage` is 'object' (never 'undefined') but any
// getItem/setItem call throws a SecurityError/QuotaExceededError. Prior to
// this correction, only the "no localStorage at all" branch above was
// guarded; a throwing-but-present localStorage was an uncaught throw that
// would abort planCanonicalEditorBuildProductionCtx -> planCanonicalEditorBoot
// entirely, meaning the whole editor failed to boot in exactly the browser
// mode most likely to be used for a quick private check. Both getItem and
// setItem are wrapped independently: a getItem throw falls back to the same
// in-memory id every no-localStorage environment already uses (never
// persisted -- there is nothing durable to write to); a setItem-only throw
// (getItem succeeded, or returned nothing to read) still lets the freshly
// minted id be used for the rest of THIS boot, it just will not survive a
// reload -- silently degrading rather than aborting boot.
function planCanonicalEditorGetDeviceId() {
  if (typeof localStorage === 'undefined') {
    if (!planCanonicalEditorFallbackDeviceId) planCanonicalEditorFallbackDeviceId = planDefaultIdAllocator();
    return planCanonicalEditorFallbackDeviceId;
  }
  try {
    var existing = localStorage.getItem(PLAN_CANONICAL_EDITOR_DEVICE_ID_STORAGE_KEY);
    if (existing) return existing;
    var minted = planDefaultIdAllocator();
    try {
      localStorage.setItem(PLAN_CANONICAL_EDITOR_DEVICE_ID_STORAGE_KEY, minted);
    } catch (setErr) {
      // Write blocked -- the minted id above is still returned and used.
    }
    return minted;
  } catch (getErr) {
    if (!planCanonicalEditorFallbackDeviceId) planCanonicalEditorFallbackDeviceId = planDefaultIdAllocator();
    return planCanonicalEditorFallbackDeviceId;
  }
}
function planCanonicalEditorGetSessionId() {
  if (!planCanonicalEditorSessionIdCache) planCanonicalEditorSessionIdCache = planDefaultIdAllocator();
  return planCanonicalEditorSessionIdCache;
}

// ---- planCanonicalEditorWriteRecoveryMarker(st, marker) ----
// Best-effort write, wrapped in try/catch -- localStorage may not exist at
// all (Node, or a browser with it disabled) or may exist but throw on
// access (Safari private browsing, matching the same tolerance
// planCanonicalEditorGetDeviceId above already established). Requirement 3:
// a write failure must NEVER block the save itself -- it only means reload
// recovery will not be available for this attempt, and that must be
// surfaced honestly (st.reloadRecoveryWarning), not silently swallowed.
function planCanonicalEditorWriteRecoveryMarker(st, marker) {
  if (typeof localStorage === 'undefined') {
    st.reloadRecoveryWarning = 'This save cannot be recovered after a reload -- local storage is unavailable in this browser. If the save fails to confirm, use Retry Save rather than reloading the page.';
    return;
  }
  try {
    localStorage.setItem(PLAN_CANONICAL_EDITOR_RECOVERY_MARKER_STORAGE_KEY, JSON.stringify(marker));
    st.reloadRecoveryWarning = null;
  } catch (err) {
    st.reloadRecoveryWarning = 'This save cannot be recovered after a reload -- local storage is unavailable in this browser. If the save fails to confirm, use Retry Save rather than reloading the page.';
  }
}
// ---- planCanonicalEditorClearRecoveryMarker() ----
// Best-effort removal, called from exactly the three places requirement 3
// names: (a) planCanonicalEditorApplySaveResult's successful-auto-reopen
// branch, (b) the Check Saved Status handler's confirmed-absent branch, and
// (c) the boot-time recovery flow's confirmed-absent/verified branches.
function planCanonicalEditorClearRecoveryMarker() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(PLAN_CANONICAL_EDITOR_RECOVERY_MARKER_STORAGE_KEY);
  } catch (err) {
    // Best-effort -- nothing further to do if even removeItem throws.
  }
}
// ---- planCanonicalEditorReadValidRecoveryMarker(ownerUid) ----
// Reads and STRICTLY validates the marker (requirement 4: "Ignore/reject it
// if its owner UID does not match the authenticated user. Validate its
// exact shape."). Returns the parsed marker object on success, or null for
// every other case (no marker, localStorage unavailable/throwing,
// unparsable JSON, wrong/missing schemaVersion, wrong/missing ownerUid, or
// any required field missing/mistyped) -- a null return always means
// "proceed exactly as if there were no marker at all," never a thrown
// error, since a malformed marker is user data (browser storage), not a
// programmer error.
function planCanonicalEditorReadValidRecoveryMarker(ownerUid) {
  if (typeof localStorage === 'undefined') return null;
  var raw;
  try {
    raw = localStorage.getItem(PLAN_CANONICAL_EDITOR_RECOVERY_MARKER_STORAGE_KEY);
  } catch (err) {
    return null;
  }
  if (typeof raw !== 'string' || !raw) return null;
  var parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  // Recovery-marker-lifecycle correction, requirement 2: reject an array
  // explicitly and unambiguously -- typeof [] === 'object', so without this
  // an array would otherwise only fail incidentally (no named properties)
  // rather than being rejected on its own terms.
  if (Array.isArray(parsed)) return null;
  // Exact-key-set check: the marker must have precisely these five
  // string-keyed properties, nothing more and nothing less. Because the
  // marker comes from JSON.parse, its output is always a plain object (or
  // array/primitive) -- no symbol keys, no accessors, no custom prototypes --
  // so a plain Object.keys(...).sort() comparison is sufficient at this
  // boundary; no heavier Object.getPrototypeOf checks are needed here.
  var expectedKeys = ['createdAt', 'operationId', 'ownerUid', 'planTemplateId', 'schemaVersion'];
  var actualKeys = Object.keys(parsed).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.join('|') !== expectedKeys.join('|')) return null;
  if (parsed.schemaVersion !== PLAN_CANONICAL_EDITOR_RECOVERY_MARKER_SCHEMA_VERSION) return null;
  if (typeof parsed.ownerUid !== 'string' || !parsed.ownerUid || parsed.ownerUid !== ownerUid) return null;
  if (typeof parsed.planTemplateId !== 'string' || !parsed.planTemplateId) return null;
  if (typeof parsed.operationId !== 'string' || !parsed.operationId) return null;
  if (typeof parsed.createdAt !== 'string' || !parsed.createdAt) return null;
  // createdAt must parse as a valid timestamp, not merely be a non-empty
  // string.
  if (isNaN(Date.parse(parsed.createdAt))) return null;
  return parsed;
}

// ---- planCanonicalEditorBuildProductionCtx() ----
// The minimal production orchestration context (round-2 completion
// correction requirement 2): binds fsPlanCommitCanonicalPackage,
// fsPlanReadCanonicalTemplate, authenticated owner/actor identity, stable
// device/session identity, and the approved id allocator. ownerUid/actorUid
// come ONLY from auth.currentUser.uid -- never from any argument to this
// function, never from any UI field -- so there is nothing an arbitrary
// caller could pass in to spoof either. `auth` and `fsPlanPersistence` are
// firebase.js globals; every reference to either here is inside this
// function body, so it is only ever evaluated when this function actually
// runs (never at app-plan.js's own module-load time), exactly like the
// analogous deferred references in firebase.js's own SLICE 5A dormant
// delegation wiring.
function planCanonicalEditorBuildProductionCtx() {
  var uid = (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.uid) || null;
  planCanonicalAdapterRequire(typeof uid === 'string' && uid,
    'planCanonicalEditorBuildProductionCtx: no authenticated user -- the canonical editor must never be booted before real authentication resolves');
  return {
    ownerUid: uid,
    actorUid: uid,
    deviceId: planCanonicalEditorGetDeviceId(),
    sessionId: planCanonicalEditorGetSessionId(),
    allocateId: planDefaultIdAllocator,
    commitCanonicalPackage: function (pkg) { return fsPlanPersistence.fsPlanCommitCanonicalPackage(pkg); },
    readCanonicalTemplate: function (input) { return fsPlanPersistence.fsPlanReadCanonicalTemplate(input); }
  };
}

// ---- planCanonicalEditorBoot(ctxOverride) ----
// The sole entry point (see the banner comment above for the full
// reachability contract). Production callers (app-core.js) always call this
// with zero arguments. A Node-only test passes an explicit ctx (built with
// the __test dispatch-for-test seam) to exercise the identical handler
// chain below without ever touching the real hardcoded capability flags.
function planCanonicalEditorBoot(ctxOverride) {
  var ctx = (ctxOverride && typeof ctxOverride === 'object') ? ctxOverride : planCanonicalEditorBuildProductionCtx();
  var st = {
    editorState: planCanonicalEditorFreshState(),
    ctx: ctx,
    outcome: null,
    validationMessage: null,
    lastSavedTemplateId: null,
    reopenTemplateIdInput: '',
    busy: false,
    // Save-lifecycle correction requirement 1: set true whenever a save
    // committed successfully but the immediate follow-up reopen (below)
    // could not confirm the new canonical head -- blocks an ordinary next
    // Save from being silently treated as a brand-new Program (see
    // planCanonicalEditorHandleSave's own top-of-function check) until a
    // Reopen (manual or automatic) succeeds.
    needsReopenBeforeNextSave: false,
    // Save-lifecycle correction requirement 2: the exact prepared-but-not-
    // yet-confirmed save package, set immediately before the first commit
    // attempt and resubmitted byte-identical (same object reference, never
    // rebuilt) by planCanonicalEditorHandleRetrySave. null whenever there is
    // nothing pending. Uncertain-save recovery correction requirement 1: a
    // Cancel no longer nulls this out -- it instead sets a
    // `.cancelledUnresolved` flag on the SAME object, so the exact package
    // stays available for Retry Save while ordinary mutation stays blocked
    // (see planCanonicalEditorGuardMutable / planCanonicalEditorHandleNew).
    _pendingSaveAttempt: null,
    // Uncertain-save recovery correction requirement 3: a visible warning
    // for the CURRENT pending attempt when local storage could not hold its
    // recovery marker -- null whenever there is nothing to warn about.
    reloadRecoveryWarning: null,
    // Uncertain-save recovery correction requirement 4: true from the
    // moment a valid recovery marker is found at boot (or the marker's
    // status remains unresolved after a check) until the application
    // establishes the Template's fate or the user explicitly abandons it.
    // Blocks every mutation exactly like busy/_pendingSaveAttempt already
    // do (see planCanonicalEditorGuardMutable).
    recoveryChecking: false,
    // The validated marker driving the current recovery check, kept around
    // so Retry Check can re-read the same Template Id. null whenever
    // recoveryChecking is false.
    recoveryMarker: null,
    // Backing field for the rendered Abandon control's two-step
    // acknowledgment checkbox (requirement 1/2's "explicit acknowledgment"
    // -- see planCanonicalEditorHandleAbandonUnresolvedSave and the
    // renderer's abandon control below). Never influences anything by
    // itself; only what is explicitly passed to that handler does.
    _abandonAcknowledged: false
  };
  planCanonicalEditorState = st;

  // Uncertain-save recovery correction requirement 4: check for a valid,
  // owner-matched recovery marker BEFORE ever rendering a fresh/unidentified
  // Program. planCanonicalEditorReadValidRecoveryMarker already rejects a
  // marker with the wrong owner, wrong/missing schema version, or any
  // malformed field -- a null return here means "proceed exactly like an
  // ordinary boot," matching requirement 7's "a malformed or wrong-owner
  // marker is never used for a read."
  var validMarker = planCanonicalEditorReadValidRecoveryMarker(ctx.ownerUid);
  if (validMarker) {
    st.recoveryChecking = true;
    st.recoveryMarker = validMarker;
    st.outcome = {
      status: 'checkingPreviousSave',
      message: 'Checking whether a previous save attempt (Template Id "' + validMarker.planTemplateId + '") completed before this page reloaded...'
    };
    // Boot itself stays synchronous (existing callers/tests depend on
    // this) -- the actual read is fired off here but never awaited; it
    // mutates this SAME captured `st` object in place once it resolves,
    // exactly the way busy/outcome already update in place for Save/Reopen.
    // planCanonicalEditorRunBootRecoveryCheck re-checks
    // `planCanonicalEditorState === st` before touching anything, so a
    // stale resolution from a superseded boot can never attach itself to a
    // newer one.
    planCanonicalEditorRunBootRecoveryCheck(st, validMarker);
  }

  planCanonicalEditorRender();
  return st;
}

// ---- planCanonicalEditorApplyBootRecoveryOutcome(st, marker, result) ----
// The four outcome branches requirement 4 names, grounded in the reader's
// own typed outcome (never in planReopenCanonicalTemplate's collapsed
// 'permanent' status): `result.outcome === 'notFound'` is the ONE and only
// "definitively absent" signal (planReaderNotFound() is the sole producer
// of it); 'verifiedCurrent'/'verifiedHistorical' is success;
// 'retryableFailure' is temporary; anything else (planReaderConflict/
// planReaderUnsupported outcomes, or an unrecognized shape) is an
// integrity/authorization problem, not absence, and must stay locked.
function planCanonicalEditorApplyBootRecoveryOutcome(st, marker, result) {
  if (result && result.outcome === 'notFound') {
    planCanonicalEditorClearRecoveryMarker();
    st.recoveryChecking = false;
    st.recoveryMarker = null;
    st.outcome = {
      status: 'recoveryResolved', resolution: 'notFound',
      message: 'The previous save attempt (Template Id "' + marker.planTemplateId + '") did not produce a readable Template -- it is safe to save again.'
    };
    planCanonicalEditorRender();
    return;
  }
  if (result && (result.outcome === 'verifiedCurrent' || result.outcome === 'verifiedHistorical')) {
    var editorState = planAdaptCanonicalDraftToEditorState(result.draft);
    editorState._priorCanonicalBase = result.canonicalBase;
    planCanonicalEditorClearRecoveryMarker();
    st.editorState = editorState;
    st.lastSavedTemplateId = marker.planTemplateId;
    st.reopenTemplateIdInput = marker.planTemplateId;
    st.recoveryChecking = false;
    st.recoveryMarker = null;
    st.needsReopenBeforeNextSave = false;
    st.outcome = {
      status: 'recoveryResolved', resolution: 'verified',
      message: 'The previous save attempt (Template Id "' + marker.planTemplateId + '") had already completed -- it has been reopened and is ready for normal editing.'
    };
    planCanonicalEditorRender();
    return;
  }
  if (result && result.outcome === 'retryableFailure') {
    st.recoveryChecking = true;
    st.outcome = {
      status: 'checkingPreviousSave', recoveryRetryable: true,
      message: 'Could not confirm whether the previous save attempt (Template Id "' + marker.planTemplateId + '") completed -- the check is temporarily unavailable. Use Retry Check to try again; the recovery marker is preserved.'
    };
    planCanonicalEditorRender();
    return;
  }
  // requirement 4: "Do not treat every permanent read failure as absence."
  // Everything else -- planReaderConflict/planReaderUnsupported outcomes, or
  // any unrecognized shape -- is a genuine integrity/authorization problem,
  // not confirmed absence: stay locked, keep the marker, surface a clear
  // permanent diagnostic.
  st.recoveryChecking = true;
  st.outcome = {
    status: 'checkingPreviousSave', recoveryConflict: true,
    message: 'A previous save attempt (Template Id "' + marker.planTemplateId + '") could not be verified -- checking it returned ' +
      (result && result.outcome ? '"' + result.outcome + '"' + (result.reason ? ' (' + result.reason + ')' : '') : 'an unexpected result') +
      ', not a definitive absence. The recovery marker is preserved -- use Abandon if you want to start a new Program anyway.'
  };
  planCanonicalEditorRender();
}

// ---- planCanonicalEditorRunBootRecoveryCheck(st, marker) ----
// The async-after-sync-boot mechanism itself. Called fire-and-forget from
// planCanonicalEditorBoot (and re-invoked, identically, by
// planCanonicalEditorHandleRetryRecoveryCheck below). Reads the marker's
// Template Id through the same ctx.readCanonicalTemplate every other reader
// call in this file uses -- never planReopenCanonicalTemplate's own
// collapsed 'permanent' status -- so the notFound-vs-other-outcomes
// distinction requirement 4 requires is available to branch on directly.
async function planCanonicalEditorRunBootRecoveryCheck(st, marker) {
  st.busy = true;
  planCanonicalEditorRender();
  var result, threw = null;
  try {
    result = await st.ctx.readCanonicalTemplate({ ownerUid: st.ctx.ownerUid, templateId: marker.planTemplateId });
  } catch (err) {
    threw = err;
  }
  // Completion-of-a-stale-operation guard (mirrors the save-lifecycle
  // correction's own principle): if a newer Boot/New has since replaced
  // planCanonicalEditorState, this resolution must never attach itself to
  // that different, newer state.
  if (planCanonicalEditorState !== st) return;
  st.busy = false;
  if (threw) {
    var classified = planClassifyCanonicalReadError(threw);
    st.recoveryChecking = true;
    if (classified.status === 'retryable') {
      st.outcome = {
        status: 'checkingPreviousSave', recoveryRetryable: true,
        message: 'Could not confirm whether the previous save attempt (Template Id "' + marker.planTemplateId + '") completed -- the check failed temporarily. Use Retry Check to try again; the recovery marker is preserved.'
      };
    } else {
      st.outcome = {
        status: 'checkingPreviousSave', recoveryConflict: true,
        message: 'Could not determine whether the previous save attempt (Template Id "' + marker.planTemplateId + '") completed -- a permanent problem occurred while checking (' + (threw && threw.message ? threw.message : 'unknown error') + '). The recovery marker is preserved -- use Abandon if you want to start a new Program anyway.'
      };
    }
    planCanonicalEditorRender();
    return;
  }
  planCanonicalEditorApplyBootRecoveryOutcome(st, marker, result);
}

// ---- planCanonicalEditorHandleRetryRecoveryCheck() ----
// The "Retry Check" action offered while boot-time recovery remains locked
// on a retryable or permanent-diagnostic outcome. Re-runs the identical
// check, fire-and-forget, against the SAME captured state object -- never
// rebuilds the marker or re-reads it from local storage (the marker itself
// might already be gone if a concurrent tab resolved it, in which case the
// stored st.recoveryMarker -- read once at boot -- is still the correct
// Template Id to keep checking).
function planCanonicalEditorHandleRetryRecoveryCheck() {
  planCanonicalEditorRequireBooted('planCanonicalEditorHandleRetryRecoveryCheck');
  var st = planCanonicalEditorState;
  if (st.busy) return { status: 'ignored', reason: 'busy' };
  if (!st.recoveryChecking || !st.recoveryMarker) {
    return { status: 'ignored', reason: 'noRecoveryCheckPending' };
  }
  planCanonicalEditorRunBootRecoveryCheck(st, st.recoveryMarker);
  return { status: 'checking' };
}

function planCanonicalEditorRequireBooted(callerName) {
  planCanonicalAdapterRequire(planCanonicalEditorState && typeof planCanonicalEditorState === 'object',
    callerName + ': planCanonicalEditorBoot must be called first');
}

// ---- planCanonicalEditorGuardMutable(callerName) ----
// Save-lifecycle correction requirement 3: "a small centralized mutation
// guard is preferable to duplicating inconsistent checks across every
// handler." Every mutation handler below (New*, Add*, Remove*, Move*,
// Enable/DisableProgression, and every SetXField setter) calls this FIRST,
// in place of the bare planCanonicalEditorRequireBooted call each used to
// open with. "Not booted yet" is still a genuine programmer error (calling
// a handler before planCanonicalEditorBoot ever ran) and still throws, via
// planCanonicalEditorRequireBooted, exactly as it always has. "Busy" (a
// commit/reopen literally in flight) and "a retryable save attempt is
// pending confirmation" are NOT programmer errors -- they are ordinary race
// conditions a real double-click or a rapid Retry-vs-edit race can produce --
// so both return false (a silent no-op) rather than throwing, matching the
// pre-existing `if (st.busy) return {status:'ignored',...}` convention
// Save/Reopen already used before this correction: a thrown error from an
// onclick/oninput attribute would surface as a visible console error in a
// real browser for what is, from the user's point of view, nothing more
// than a mistimed click. Requirement 2's chosen policy for "the user edits
// a field while a retryable attempt is pending" is BLOCK, not silently
// discard-and-rebuild: every mutation handler refuses outright until the
// pending attempt is resolved via Retry or Cancel (or superseded by an
// explicit New, which is itself a deliberate change and is exempt --see
// planCanonicalEditorHandleNew's own comment).
function planCanonicalEditorGuardMutable(callerName) {
  planCanonicalEditorRequireBooted(callerName);
  var st = planCanonicalEditorState;
  if (st.busy) return false;
  if (st._pendingSaveAttempt) return false;
  // Uncertain-save recovery correction requirement 4: a boot-time recovery
  // check (in flight, or locked awaiting Retry Check/Abandon after a
  // retryable-or-worse result) blocks mutation exactly like busy/
  // _pendingSaveAttempt above -- nothing may edit editorState while it is
  // still unknown whether a previous attempt already created this Program.
  if (st.recoveryChecking) return false;
  return true;
}

// ---- planCanonicalEditorHandleNew() ----
// The canonical "new Program" action. Discards whatever editor state
// existed (if any) and replaces it with a completely fresh
// planCanonicalEditorFreshState() -- no progression object, no identity
// fields, nothing carried over.
//
// Uncertain-save recovery correction requirement 2 REVERSES the prior
// round's design decision. The save-lifecycle correction originally made
// New the one deliberate exception to the pending-attempt block, force-
// clearing st._pendingSaveAttempt outright on the theory that clicking New
// itself was "the deliberate user cancellation/change" requirement 2 (that
// round) allowed. This round's requirement 1 establishes that a retryable
// save outcome means the write MAY ALREADY HAVE COMMITTED -- so silently
// discarding _pendingSaveAttempt (or a boot-time recovery lock) is exactly
// the failure mode that lets a single accidental New click remove the only
// state standing between the user and creating a second Program on top of
// one that may already exist. New is therefore now BLOCKED (fail-closed,
// the explicitly preferred one of requirement 2's two options) under
// exactly the same conditions planCanonicalEditorGuardMutable already
// blocks every other mutation handler under: busy, a pending save attempt
// (live OR cancelled-but-unresolved -- both leave st._pendingSaveAttempt
// truthy), or a boot-time recovery check still unresolved. There is no
// force-clear path left in this function at all; the only ways to leave an
// unresolved attempt behind now are Retry Save/Check Saved Status
// resolving it, or the explicit two-step planCanonicalEditorHandleAbandonUnresolvedSave
// acknowledgment.
function planCanonicalEditorHandleNew() {
  planCanonicalEditorRequireBooted('planCanonicalEditorHandleNew');
  var st = planCanonicalEditorState;
  if (st.busy) return;
  if (st._pendingSaveAttempt || st.recoveryChecking) return;
  st.editorState = planCanonicalEditorFreshState();
  st.outcome = null;
  st.validationMessage = null;
  st.lastSavedTemplateId = null;
  st.needsReopenBeforeNextSave = false;
  planCanonicalEditorRender();
}

// ---- planCanonicalEditorHandleEnableProgression(mi, si, ei) ----
// Uses ONLY planNewCanonicalProgressionState() (the approved canonical
// initializer) to build the new progression object -- never
// planEnableProgression (the legacy function, defined near the top of this
// file's Slice 5A section, in the untouched legacy code above), never any
// hand-built object with different field values. planNewCanonicalProgressionState()
// itself always returns enabled:false (a freshly-initialized rule is inert
// by default); flipping it to true is this action's entire job, done
// explicitly on the very next line, nowhere else.
function planCanonicalEditorHandleEnableProgression(mi, si, ei) {
  if (!planCanonicalEditorGuardMutable('planCanonicalEditorHandleEnableProgression')) return;
  var ex = planCanonicalEditorState.editorState.microcycles[mi].sessions[si].exercises[ei];
  planCanonicalAdapterRequire(ex, 'planCanonicalEditorHandleEnableProgression: no such exercise at [' + mi + '][' + si + '][' + ei + ']');
  ex.progression = planNewCanonicalProgressionState();
  ex.progression.enabled = true;
  planCanonicalEditorRender();
}
function planCanonicalEditorHandleDisableProgression(mi, si, ei) {
  if (!planCanonicalEditorGuardMutable('planCanonicalEditorHandleDisableProgression')) return;
  var ex = planCanonicalEditorState.editorState.microcycles[mi].sessions[si].exercises[ei];
  planCanonicalAdapterRequire(ex, 'planCanonicalEditorHandleDisableProgression: no such exercise at [' + mi + '][' + si + '][' + ei + ']');
  if (ex.progression) ex.progression.enabled = false;
  planCanonicalEditorRender();
}

// ---- Structural editing actions (add-only -- this is deliberately the
// smallest real workflow, not full editing parity with the legacy editor;
// see the correction report for this scope note). Each mutates
// planCanonicalEditorState.editorState in place, the same way the legacy
// editor's own oninput handlers mutate planDraft in place.
function planCanonicalEditorHandleAddMicrocycle() {
  if (!planCanonicalEditorGuardMutable('planCanonicalEditorHandleAddMicrocycle')) return;
  planCanonicalEditorState.editorState.microcycles.push({ name: 'New Microcycle', sessions: [] });
  planCanonicalEditorRender();
}
function planCanonicalEditorHandleAddSession(mi) {
  if (!planCanonicalEditorGuardMutable('planCanonicalEditorHandleAddSession')) return;
  planCanonicalEditorState.editorState.microcycles[mi].sessions.push({ name: 'New Session', notes: '', exercises: [] });
  planCanonicalEditorRender();
}
function planCanonicalEditorHandleAddExercise(mi, si) {
  if (!planCanonicalEditorGuardMutable('planCanonicalEditorHandleAddExercise')) return;
  planCanonicalEditorState.editorState.microcycles[mi].sessions[si].exercises.push(planCanonicalEditorFreshExercise());
  planCanonicalEditorRender();
}
function planCanonicalEditorHandleAddSet(mi, si, ei) {
  if (!planCanonicalEditorGuardMutable('planCanonicalEditorHandleAddSet')) return;
  planCanonicalEditorState.editorState.microcycles[mi].sessions[si].exercises[ei].sets.push(planCanonicalEditorFreshSet());
  planCanonicalEditorRender();
}

// =============================================================================
// SLICE 5A EDITOR-COMPLETION CORRECTION -- full field controls, removal,
// reordering, and pre-save validation (requirement 1).
// =============================================================================
// Every function below reads and writes ONLY planCanonicalEditorState --
// this module's own state -- and never planDraft or any legacy Program
// editor function (planCreateNewProgram, planEditTemplate, planSaveTemplate,
// planEnableProgression, and neighbors, all above the original SLICE 5A
// banner near the top of this file, are not referenced anywhere below).
// Category G/H in plan-slice5a-editor.test.js statically re-verify this
// against the live source, not just this comment.

// ---- Resolvers -- shared, explicit "no such X" guards (planCanonicalAdapterRequire,
// the same typed error every other handler in this section already throws)
// rather than letting a bad index silently produce `undefined` and fail
// later with a confusing message deep inside a setter.
function planCanonicalEditorResolveMicrocycle(mi) {
  planCanonicalEditorRequireBooted('planCanonicalEditorResolveMicrocycle');
  var mc = planCanonicalEditorState.editorState.microcycles[mi];
  planCanonicalAdapterRequire(mc, 'planCanonicalEditorResolveMicrocycle: no such microcycle at [' + mi + ']');
  return mc;
}
function planCanonicalEditorResolveSession(mi, si) {
  var mc = planCanonicalEditorResolveMicrocycle(mi);
  var s = mc.sessions[si];
  planCanonicalAdapterRequire(s, 'planCanonicalEditorResolveSession: no such session at [' + mi + '][' + si + ']');
  return s;
}
function planCanonicalEditorResolveExercise(mi, si, ei) {
  var s = planCanonicalEditorResolveSession(mi, si);
  var ex = s.exercises[ei];
  planCanonicalAdapterRequire(ex, 'planCanonicalEditorResolveExercise: no such exercise at [' + mi + '][' + si + '][' + ei + ']');
  return ex;
}
function planCanonicalEditorResolveSet(mi, si, ei, seti) {
  var ex = planCanonicalEditorResolveExercise(mi, si, ei);
  var set = ex.sets[seti];
  planCanonicalAdapterRequire(set, 'planCanonicalEditorResolveSet: no such set at [' + mi + '][' + si + '][' + ei + '][' + seti + ']');
  return set;
}

// ---- planCanonicalEditorParseOptionalNumber(rawValue) ----
// Shared by every numeric control below (requirement 2: "Empty or invalid
// required fields receive a clear user-facing message" -- specifically, a
// person typing a non-numeric value into a number field must never
// silently become NaN in state). Blank clears the field (matches
// planCanonicalAdapterOptionalNumeric's own absent-is-null convention);
// anything else must parse as a finite number or the caller rejects the
// input before it ever reaches state.
function planCanonicalEditorParseOptionalNumber(rawValue) {
  if (rawValue === '' || rawValue === null || rawValue === undefined) return { ok: true, value: null };
  var n = Number(rawValue);
  if (isNaN(n) || !isFinite(n)) return { ok: false };
  return { ok: true, value: n };
}

var PLAN_CANONICAL_EDITOR_SET_NUMERIC_FIELDS = ['weight', 'percent', 'addedWeight', 'reps', 'minReps', 'maxReps', 'rir', 'minRir', 'maxRir', 'seconds', 'minSeconds', 'maxSeconds'];
var PLAN_CANONICAL_EDITOR_SET_STRING_FIELDS = ['loadType', 'repsType', 'effortType', 'timeType', 'notes'];
var PLAN_CANONICAL_EDITOR_PROGRESSION_NUMERIC_FIELDS = ['gatewaySetIndex', 'loadIncrease', 'tmIncrease'];
var PLAN_CANONICAL_EDITOR_PROGRESSION_STRING_FIELDS = ['evaluationType', 'adjustmentType', 'failBehavior'];

// ---- Field setters -- one generic function per level, covering every
// user-authored field the accepted canonical editor-state mapping supports
// (requirement 1). Each sets planCanonicalEditorState.validationMessage
// (never a native alert()/confirm() -- none exists anywhere in this app)
// instead of writing an unparsable numeric value into state.
function planCanonicalEditorHandleSetProgramField(field, rawValue) {
  if (!planCanonicalEditorGuardMutable('planCanonicalEditorHandleSetProgramField')) return;
  planCanonicalEditorState.editorState[field] = rawValue;
  planCanonicalEditorRender();
}
function planCanonicalEditorHandleSetMicrocycleField(mi, field, rawValue) {
  if (!planCanonicalEditorGuardMutable('planCanonicalEditorHandleSetMicrocycleField')) return;
  var mc = planCanonicalEditorResolveMicrocycle(mi);
  mc[field] = rawValue;
  planCanonicalEditorRender();
}
function planCanonicalEditorHandleSetSessionField(mi, si, field, rawValue) {
  if (!planCanonicalEditorGuardMutable('planCanonicalEditorHandleSetSessionField')) return;
  var s = planCanonicalEditorResolveSession(mi, si);
  s[field] = rawValue;
  planCanonicalEditorRender();
}
function planCanonicalEditorHandleSetExerciseField(mi, si, ei, field, rawValue) {
  if (!planCanonicalEditorGuardMutable('planCanonicalEditorHandleSetExerciseField')) return;
  var ex = planCanonicalEditorResolveExercise(mi, si, ei);
  ex[field] = rawValue;
  planCanonicalEditorRender();
}
function planCanonicalEditorHandleSetSetField(mi, si, ei, seti, field, rawValue) {
  if (!planCanonicalEditorGuardMutable('planCanonicalEditorHandleSetSetField')) return;
  var set = planCanonicalEditorResolveSet(mi, si, ei, seti);
  if (PLAN_CANONICAL_EDITOR_SET_NUMERIC_FIELDS.indexOf(field) !== -1) {
    var parsed = planCanonicalEditorParseOptionalNumber(rawValue);
    if (!parsed.ok) {
      planCanonicalEditorState.validationMessage = 'Enter a valid number for ' + field + ', or leave it blank.';
      planCanonicalEditorRender();
      return;
    }
    set[field] = parsed.value;
  } else if (PLAN_CANONICAL_EDITOR_SET_STRING_FIELDS.indexOf(field) !== -1) {
    set[field] = rawValue;
  } else {
    planCanonicalAdapterRequire(false, 'planCanonicalEditorHandleSetSetField: unsupported field ' + field);
  }
  planCanonicalEditorState.validationMessage = null;
  planCanonicalEditorRender();
}
function planCanonicalEditorHandleSetProgressionField(mi, si, ei, field, rawValue) {
  if (!planCanonicalEditorGuardMutable('planCanonicalEditorHandleSetProgressionField')) return;
  var ex = planCanonicalEditorResolveExercise(mi, si, ei);
  planCanonicalAdapterRequire(ex.progression, 'planCanonicalEditorHandleSetProgressionField: progression is not enabled at [' + mi + '][' + si + '][' + ei + ']');
  if (PLAN_CANONICAL_EDITOR_PROGRESSION_NUMERIC_FIELDS.indexOf(field) !== -1) {
    var parsedP = planCanonicalEditorParseOptionalNumber(rawValue);
    if (!parsedP.ok) {
      planCanonicalEditorState.validationMessage = 'Enter a valid number for ' + field + ', or leave it blank.';
      planCanonicalEditorRender();
      return;
    }
    ex.progression[field] = parsedP.value;
  } else if (PLAN_CANONICAL_EDITOR_PROGRESSION_STRING_FIELDS.indexOf(field) !== -1) {
    ex.progression[field] = rawValue;
  } else {
    planCanonicalAdapterRequire(false, 'planCanonicalEditorHandleSetProgressionField: unsupported field ' + field);
  }
  planCanonicalEditorState.validationMessage = null;
  planCanonicalEditorRender();
}

// ---- Removal controls (requirement 1: "Add removal controls for sets,
// exercises, sessions, and microcycles... Prevent deletion from leaving a
// structurally unusable Program"). Each refuses to remove -- leaving state
// untouched, surfacing validationMessage -- exactly when the target is the
// LAST remaining item at its level, since a Program with zero microcycles
// (or a microcycle with zero sessions, a session with zero exercises, an
// exercise with zero sets) has nothing left to execute.
function planCanonicalEditorHandleRemoveMicrocycle(mi) {
  if (!planCanonicalEditorGuardMutable('planCanonicalEditorHandleRemoveMicrocycle')) return;
  var mcs = planCanonicalEditorState.editorState.microcycles;
  if (!mcs[mi]) return;
  if (mcs.length <= 1) {
    planCanonicalEditorState.validationMessage = 'A Program must have at least one microcycle -- add another before removing this one.';
    planCanonicalEditorRender();
    return;
  }
  mcs.splice(mi, 1);
  planCanonicalEditorState.validationMessage = null;
  planCanonicalEditorRender();
}
function planCanonicalEditorHandleRemoveSession(mi, si) {
  if (!planCanonicalEditorGuardMutable('planCanonicalEditorHandleRemoveSession')) return;
  var mc = planCanonicalEditorResolveMicrocycle(mi);
  if (!mc.sessions[si]) return;
  if (mc.sessions.length <= 1) {
    planCanonicalEditorState.validationMessage = 'Each microcycle must have at least one session -- add another before removing this one.';
    planCanonicalEditorRender();
    return;
  }
  mc.sessions.splice(si, 1);
  planCanonicalEditorState.validationMessage = null;
  planCanonicalEditorRender();
}
function planCanonicalEditorHandleRemoveExercise(mi, si, ei) {
  if (!planCanonicalEditorGuardMutable('planCanonicalEditorHandleRemoveExercise')) return;
  var s = planCanonicalEditorResolveSession(mi, si);
  if (!s.exercises[ei]) return;
  if (s.exercises.length <= 1) {
    planCanonicalEditorState.validationMessage = 'Each session must have at least one exercise -- add another before removing this one.';
    planCanonicalEditorRender();
    return;
  }
  s.exercises.splice(ei, 1);
  planCanonicalEditorState.validationMessage = null;
  planCanonicalEditorRender();
}
function planCanonicalEditorHandleRemoveSet(mi, si, ei, seti) {
  if (!planCanonicalEditorGuardMutable('planCanonicalEditorHandleRemoveSet')) return;
  var ex = planCanonicalEditorResolveExercise(mi, si, ei);
  if (!ex.sets[seti]) return;
  if (ex.sets.length <= 1) {
    planCanonicalEditorState.validationMessage = 'Each exercise must have at least one set -- add another before removing this one.';
    planCanonicalEditorRender();
    return;
  }
  ex.sets.splice(seti, 1);
  // Integrity housekeeping, not new progression-evaluation behavior: a
  // gateway index that pointed past the end of the (now shorter) sets array
  // is clamped back into range, mirroring the legacy editor's own
  // gatewayIdx clamp ("if (gatewayIdx < 0 || gatewayIdx >= sets.length)
  // gatewayIdx = 0", app-plan.js ~line 772) -- never called from here, just
  // the same clamp idea applied to this module's own state.
  if (ex.progression && (ex.progression.gatewaySetIndex === null || ex.progression.gatewaySetIndex === undefined || ex.progression.gatewaySetIndex >= ex.sets.length || ex.progression.gatewaySetIndex < 0)) {
    ex.progression.gatewaySetIndex = 0;
  }
  planCanonicalEditorState.validationMessage = null;
  planCanonicalEditorRender();
}

// ---- Reordering controls, added ONLY where array position materially
// affects Program execution (requirement 1: "Add reordering only where
// order materially affects Program execution"). Every one of these four
// levels qualifies: planNormalizeCanonicalGraph (the already-accepted
// canonical writer, app-plan.js ~line 1849/1855/1857/1884) derives each
// microcycle/session/exercise/set's stored orderKey PURELY from its array
// position at commit time (orderKey: mi / si / ei / seti) -- and the
// reader (~line 7482/7486/7498/7511) sorts strictly by that orderKey to
// reconstruct which week, day, exercise, and set comes first. Reordering
// any of these four arrays is therefore a real change to how the Program
// executes, not merely a display change.
function planCanonicalEditorSwap(arr, i, j) {
  var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
}
function planCanonicalEditorHandleMoveMicrocycle(mi, delta) {
  if (!planCanonicalEditorGuardMutable('planCanonicalEditorHandleMoveMicrocycle')) return;
  var mcs = planCanonicalEditorState.editorState.microcycles;
  var target = mi + delta;
  if (target < 0 || target >= mcs.length) return;
  planCanonicalEditorSwap(mcs, mi, target);
  planCanonicalEditorRender();
}
function planCanonicalEditorHandleMoveSession(mi, si, delta) {
  if (!planCanonicalEditorGuardMutable('planCanonicalEditorHandleMoveSession')) return;
  var mc = planCanonicalEditorResolveMicrocycle(mi);
  var target = si + delta;
  if (target < 0 || target >= mc.sessions.length) return;
  planCanonicalEditorSwap(mc.sessions, si, target);
  planCanonicalEditorRender();
}
function planCanonicalEditorHandleMoveExercise(mi, si, ei, delta) {
  if (!planCanonicalEditorGuardMutable('planCanonicalEditorHandleMoveExercise')) return;
  var s = planCanonicalEditorResolveSession(mi, si);
  var target = ei + delta;
  if (target < 0 || target >= s.exercises.length) return;
  planCanonicalEditorSwap(s.exercises, ei, target);
  planCanonicalEditorRender();
}
function planCanonicalEditorHandleMoveSet(mi, si, ei, seti, delta) {
  if (!planCanonicalEditorGuardMutable('planCanonicalEditorHandleMoveSet')) return;
  var ex = planCanonicalEditorResolveExercise(mi, si, ei);
  var target = seti + delta;
  if (target < 0 || target >= ex.sets.length) return;
  planCanonicalEditorSwap(ex.sets, seti, target);
  planCanonicalEditorRender();
}

// ---- planCanonicalEditorValidateBeforeSave(es) ----
// A friendlier, UI-facing validation pass that runs BEFORE
// planSaveCanonicalTemplate is ever called, so an empty/missing required
// field produces a clear message instead of reaching the adapter's own
// terser PlanCanonicalEditorAdapterError. Mirrors (does not duplicate the
// RESULT of, only the SHAPE of) the same structural requirements
// planCanonicalAdaptStructure itself enforces -- returns a human-readable
// string on the first problem found, or null when the state is
// save-ready. This never replaces the adapter's own validation
// (planSaveCanonicalTemplate is still called normally afterward and still
// performs its own independent check); a defensive try/catch/finally
// around that call (planCanonicalEditorHandleSave, below) still guards
// against anything this pass does not catch.
function planCanonicalEditorValidateBeforeSave(es) {
  if (!es || !Array.isArray(es.microcycles) || es.microcycles.length === 0) {
    return 'Add at least one microcycle before saving.';
  }
  for (var mi = 0; mi < es.microcycles.length; mi++) {
    var mc = es.microcycles[mi];
    if (!mc || !Array.isArray(mc.sessions) || mc.sessions.length === 0) {
      return 'Microcycle ' + (mi + 1) + ' needs at least one session before saving.';
    }
    for (var si = 0; si < mc.sessions.length; si++) {
      var s = mc.sessions[si];
      if (!s || !Array.isArray(s.exercises) || s.exercises.length === 0) {
        return 'Session ' + (si + 1) + ' in Microcycle ' + (mi + 1) + ' needs at least one exercise before saving.';
      }
      for (var ei = 0; ei < s.exercises.length; ei++) {
        var ex = s.exercises[ei];
        if (!ex || typeof ex.exerciseId !== 'string' || !ex.exerciseId) {
          return 'Choose an exercise for every exercise entry before saving (Microcycle ' + (mi + 1) + ', Session ' + (si + 1) + ').';
        }
        if (!Array.isArray(ex.sets) || ex.sets.length === 0) {
          return 'Every exercise needs at least one set before saving (Microcycle ' + (mi + 1) + ', Session ' + (si + 1) + ').';
        }
      }
    }
  }
  return null;
}

// ---- planCanonicalEditorApplySaveResult(st, result) ----
// Save-lifecycle correction requirement 1 + 2: the SHARED "what happens
// after a commit attempt resolves" logic, called from both
// planCanonicalEditorHandleSave's first attempt and
// planCanonicalEditorHandleRetrySave's resubmission of the identical
// pending package -- exactly one place decides what a commit outcome means
// for lastSavedTemplateId, _pendingSaveAttempt, needsReopenBeforeNextSave,
// and the automatic follow-up reopen, so the two entry points can never
// disagree about it.
//
// requirement 2 ("Clear the pending attempt only after confirmed success, a
// deliberate user cancellation/change, or a non-retryable result"), AS
// NARROWED by this round's recovery-marker certainty correction:
// result.status === 'retryable' OR 'permanent' are the two cases that leave
// st._pendingSaveAttempt untouched -- 'retryable' because the write may
// already have landed, and 'permanent' because it is an unrecognized-error
// catch-all with no traced no-write guarantee of its own (see
// planCanonicalEditorOutcomeIsConclusivelyNoWrite's comment). Every other
// status (success, alreadyCommitted, disabled, conflict, blocked) clears it,
// because each of those has a specifically traced source guarantee that
// nothing is left to retry: 'disabled'/'conflict'/'blocked' are proven
// no-write (not a transient condition a byte-identical resubmission would
// fix), and 'success'/'alreadyCommitted' already fully resolved it).
// "Treat alreadyCommitted as successful completion of that same attempt"
// (requirement 2) falls out naturally: it is handled by the exact same
// branch as 'success' below.
//
// ---- planCanonicalEditorOutcomeIsConclusivelyNoWrite(status) ----
// Recovery-marker-lifecycle correction, requirement 1's outcome matrix, AS
// NARROWED by this round's recovery-marker CERTAINTY correction. Returns
// true ONLY for the commit-outcome statuses whose production error path has
// been individually traced and specifically proven to precede any
// transaction.set/commit -- never inferred from a broad label:
//   - 'disabled'  -> CanonicalPlanWriterDisabledError, thrown at the very top
//     of commitCanonicalPackage before any dependency construction or I/O.
//     Proven zero I/O.
//   - 'conflict'  -> CanonicalPlanCommitBlockedError, thrown from the pure
//     judgment step inside the transaction callback strictly before any
//     transaction.set call for the attempt (the "Stage-then-commit"
//     invariant: zero transaction.set calls on failure). Proven no-commit.
//   - 'blocked'   -> included defensively, matching the requirement's
//     explicit list, even though the current planCanonicalEditorHandleSave
//     control flow returns every 'blocked' outcome before a pending save
//     attempt (and so before a marker for that attempt) is ever created --
//     meaning this function is not actually reachable with 'blocked' today.
//
// 'permanent' is DELIBERATELY EXCLUDED (certainty correction, this round):
// planClassifyCanonicalWriteError uses 'permanent' as its catch-all for
// every writer error that is not specifically recognized as
// disabled/conflict/retryable -- an unrecognized SDK error code, a future
// error type this file's taxonomy has not named, or one of this file's own
// internal integrity checks. A catch-all being reached is not, by itself,
// proof that no write occurred; the prior round's reasoning ("per
// Firestore's transaction contract, only the specific unavailable/aborted-
// class codes carry ambiguity") was an inference about Firestore's general
// contract, not a traced guarantee about every possible error this specific
// catch-all could ever receive -- exactly the kind of guess this correction
// was asked not to make. 'permanent' is therefore treated as genuinely
// uncertain, identically to 'retryable' -- see
// planCanonicalEditorApplySaveResult's own early-return branch, which is
// where this exclusion actually takes effect (this helper is not even
// reached for 'retryable'/'permanent', since both return before reaching
// the call site below).
//
// 'success'/'alreadyCommitted' are excluded because a commit DID occur;
// they are handled by their own reopen-based marker lifecycle, not by this
// helper.
function planCanonicalEditorOutcomeIsConclusivelyNoWrite(status) {
  return status === 'disabled' || status === 'conflict' || status === 'blocked';
}

// requirement 1 ("Establish the saved canonical identity immediately"): on
// success/alreadyCommitted, the saved planTemplateId is recorded, then an
// IMMEDIATE real reopen is attempted through planReopenCanonicalTemplate --
// never a shortcut -- so the editor state ends up carrying
// `_priorCanonicalBase` and every stable subject id without a person having
// to click Reopen by hand. If that follow-up reopen itself does not
// succeed, the save is still honestly reported as having committed
// (result.status stays 'success'/'alreadyCommitted' -- the write genuinely
// happened) but two things distinguish "saved, but refresh/reopen failed"
// from an ordinary clean save: result.savedButReopenFailed is set to true
// (surfaced in the rendered outcome banner -- see
// planCanonicalEditorOutcomeLabel below) and
// st.needsReopenBeforeNextSave is set to true, which
// planCanonicalEditorHandleSave's own top-of-function check (below) then
// refuses to let a plain next Save silently pass through -- exactly the
// condition that used to let an ordinary second Save mint a brand-new
// Program instead of updating the one just saved.
async function planCanonicalEditorApplySaveResult(st, result) {
  st.outcome = result;
  // Recovery-marker CERTAINTY correction (this round): 'permanent' is
  // planClassifyCanonicalWriteError's catch-all for every writer error that
  // is not specifically recognized as disabled/conflict/retryable -- an
  // unrecognized SDK error code, a future error type nobody has classified
  // yet, or anything else this file's own taxonomy does not name. A
  // catch-all bucket is, by construction, NOT proof of anything about
  // whether a write occurred -- treating it as conclusively-no-write (as a
  // prior round did) was an unjustified inference from the label alone, not
  // from a traced source guarantee. So 'permanent' is now handled exactly
  // like 'retryable': the pending attempt AND the recovery marker are both
  // left untouched, preserving Retry Save / Check Saved Status / Abandon
  // ("unresolved-save protection") until the application (or the user)
  // actually establishes what happened -- never silently treated as safe to
  // start a fresh Program over.
  if (result.status === 'retryable' || result.status === 'permanent') {
    // st._pendingSaveAttempt is deliberately left in place -- Retry must
    // resubmit this exact same package next time, never rebuild it. Genuinely
    // uncertain: for 'retryable', the accepted writer's transaction contract
    // cannot tell "committed but the confirmation was lost" apart from
    // "never reached the server"; for 'permanent', the catch-all itself
    // carries no source-proven guarantee either way. Either way the recovery
    // marker must also survive untouched.
    return result;
  }
  // Every other status is terminal for this attempt -- nothing left to retry.
  st._pendingSaveAttempt = null;

  // Recovery-marker-lifecycle correction, requirement 1 (as narrowed by this
  // round's certainty correction): a status the accepted writer's error
  // taxonomy guarantees is conclusively a NON-write (see
  // planCanonicalEditorOutcomeIsConclusivelyNoWrite and the outcome matrix in
  // this round's report) must also drop the recovery marker here -- not just
  // the in-memory pending attempt above -- so a stale marker never survives
  // to lock the next boot into uncertain-save recovery for an attempt that
  // provably never wrote anything. 'disabled' is the case that matters today
  // (both capability flags are hardcoded false, so every real save currently
  // ends here); 'conflict' is included because its source trace (the pure
  // judgment step throwing strictly before any transaction.set call, this
  // file's own "Stage-then-commit" invariant) still proves the transaction
  // was aborted before any commit; 'blocked' is included defensively, even
  // though it cannot currently reach this function (every blocked path in
  // planCanonicalEditorHandleSave returns before a pending attempt -- and so
  // before a marker for this attempt -- is ever created). 'permanent' is
  // deliberately NOT in this set any more -- see the retryable/permanent
  // early return above.
  if (planCanonicalEditorOutcomeIsConclusivelyNoWrite(result.status)) {
    planCanonicalEditorClearRecoveryMarker();
  }

  if ((result.status === 'success' || result.status === 'alreadyCommitted') && result.draft && typeof result.draft.planTemplateId === 'string' && result.draft.planTemplateId) {
    st.lastSavedTemplateId = result.draft.planTemplateId;
    st.reopenTemplateIdInput = result.draft.planTemplateId;
    var reopenResult = await planReopenCanonicalTemplate(st.ctx.ownerUid, result.draft.planTemplateId, st.ctx);
    if (reopenResult.status === 'success' && reopenResult.editorState) {
      st.editorState = reopenResult.editorState;
      st.needsReopenBeforeNextSave = false;
      result.reopenStatus = 'success';
      // Uncertain-save recovery correction requirement 3: "On successful
      // automatic reopen ... remove the marker" -- this attempt is now
      // fully confirmed, so there is nothing left to recover after a
      // reload.
      planCanonicalEditorClearRecoveryMarker();
    } else {
      st.needsReopenBeforeNextSave = true;
      result.savedButReopenFailed = true;
      result.reopenResult = reopenResult;
      // The marker is deliberately NOT cleared here -- requirement 3's
      // whole point is surviving exactly this scenario (the write
      // committed, but confirming it failed) across a reload.
    }
    st.outcome = result;
  }
  return result;
}

// ---- planCanonicalEditorHandleSave() ----
// The canonical Save action. Builds a save attempt exactly once
// (planBuildCanonicalSaveAttempt), stores it as the pending attempt BEFORE
// ever committing it (requirement 2), commits it
// (planCommitCanonicalPackageAndClassify), and hands the outcome to
// planCanonicalEditorApplySaveResult (above) for the shared post-commit
// handling (requirement 1's auto-reopen, requirement 2's pending-attempt
// lifecycle). The full result is stored verbatim on
// planCanonicalEditorState.outcome for both the UI and any test to inspect.
// busy is always cleared via `finally`, so a failed operation never leaves
// Save permanently disabled; an overlapping call is ignored outright
// (checked FIRST); an empty/invalid required field is caught by
// planCanonicalEditorValidateBeforeSave before any I/O is attempted; and
// every synchronous throw this function's own try does not otherwise
// convert into a classified outcome is still caught here, never becoming
// an unhandled promise rejection.
//
// Two preconditions block an ordinary Save outright, before validation and
// before any I/O, each with its own distinct ignored/blocked outcome so a
// caller (and the rendered UI) can tell them apart from a plain field
// problem: st._pendingSaveAttempt (requirement 2 -- a prior attempt is
// still awaiting Retry or Cancel; use planCanonicalEditorHandleRetrySave
// instead of calling Save again) and st.needsReopenBeforeNextSave
// (requirement 1 -- the last save committed but its confirmation reopen
// failed; reopen it first, manually or via Reopen Last Saved, so this next
// Save has a genuine _priorCanonicalBase rather than silently minting a
// second Program).
async function planCanonicalEditorHandleSave() {
  planCanonicalEditorRequireBooted('planCanonicalEditorHandleSave');
  var st = planCanonicalEditorState;
  if (st.busy) return { status: 'ignored', reason: 'busy' };
  if (st._pendingSaveAttempt) {
    // Uncertain-save recovery correction requirement 1: once Cancel has
    // marked the pending attempt cancelledUnresolved, an ordinary Save
    // click gets a message that says what it actually means -- the
    // previous attempt may already have saved -- rather than the generic
    // "awaiting Retry or Cancel" text (there is no Cancel action left to
    // take at this point; only Retry Save, Check Saved Status, or Abandon).
    if (st._pendingSaveAttempt.cancelledUnresolved) {
      return {
        status: 'ignored', reason: 'unresolvedSaveAttempt',
        message: 'A previous save attempt was not confirmed -- it may already have saved. Use Retry Save to resubmit the exact same attempt, Check Saved Status to look it up, or Abandon to acknowledge it may already exist and start a new Program.'
      };
    }
    return { status: 'ignored', reason: 'pendingSaveAttempt', message: 'A previous save attempt is still awaiting Retry or Cancel -- use one of those instead of Save.' };
  }
  if (st.recoveryChecking) {
    return {
      status: 'ignored', reason: 'recoveryChecking',
      message: 'Still checking whether a previous save attempt completed before this page reloaded -- wait for that to resolve, or use Retry Check / Abandon.'
    };
  }
  if (st.needsReopenBeforeNextSave) {
    st.outcome = {
      status: 'blocked', validation: true, needsReopen: true,
      message: 'This Program was saved, but the confirmation reopen afterward failed. Reopen Template Id "' + st.lastSavedTemplateId + '" before saving again, so this Save updates that same Program instead of risking a second one.'
    };
    st.validationMessage = st.outcome.message;
    planCanonicalEditorRender();
    return st.outcome;
  }

  var fieldProblem = planCanonicalEditorValidateBeforeSave(st.editorState);
  if (fieldProblem) {
    st.outcome = { status: 'blocked', validation: true, message: fieldProblem };
    st.validationMessage = fieldProblem;
    planCanonicalEditorRender();
    return st.outcome;
  }

  st.busy = true;
  st.outcome = null;
  st.validationMessage = null;
  planCanonicalEditorRender();
  try {
    planCanonicalAdapterRequire(st.ctx && typeof st.ctx === 'object', 'planCanonicalEditorHandleSave: ctx is required');
    planCanonicalAdapterRequire(typeof st.ctx.commitCanonicalPackage === 'function', 'planCanonicalEditorHandleSave: ctx.commitCanonicalPackage must be a function');
    var built = planBuildCanonicalSaveAttempt(st.editorState, st.ctx);
    if (!built.ok) {
      var blockedResult = { status: built.status, blockReason: built.blockReason, details: built.details || {}, draft: built.draft };
      st.outcome = blockedResult;
      return blockedResult;
    }
    // requirement 2: stored BEFORE the commit is ever attempted, so a
    // retryable failure has the exact same package waiting to resubmit.
    st._pendingSaveAttempt = { package: built.package, draft: built.draft };
    // Uncertain-save recovery correction requirement 3: the recovery marker
    // is also written HERE, before the first commit is ever attempted --
    // built.draft.planTemplateId is already the newly-allocated (or
    // reused, on a resave) stable Template Id at this point (identity
    // allocation already happened inside planBuildCanonicalSaveAttempt),
    // so it is available even before any commit is attempted. A write
    // failure (no localStorage, or a throwing one) never blocks the save
    // itself -- it only sets a visible warning.
    var operationIdForMarker = (built.package && built.package.operation && typeof built.package.operation.operationId === 'string') ? built.package.operation.operationId : '';
    planCanonicalEditorWriteRecoveryMarker(st, {
      schemaVersion: PLAN_CANONICAL_EDITOR_RECOVERY_MARKER_SCHEMA_VERSION,
      ownerUid: st.ctx.ownerUid,
      planTemplateId: built.draft.planTemplateId,
      operationId: operationIdForMarker,
      createdAt: new Date().toISOString()
    });
    var result = await planCommitCanonicalPackageAndClassify(st.ctx, built.package, built.draft);
    return await planCanonicalEditorApplySaveResult(st, result);
  } catch (err) {
    // A synchronous throw here (malformed ctx, or anything
    // planBuildCanonicalSaveAttempt's own adapter/identity/basis/package
    // steps reject) never reached the commit step, so there is nothing
    // valid to keep pending.
    st._pendingSaveAttempt = null;
    var classified = planClassifyCanonicalWriteError(err, undefined);
    st.outcome = classified;
    return classified;
  } finally {
    st.busy = false;
    planCanonicalEditorRender();
  }
}

// ---- planCanonicalEditorHandleRetrySave() ----
// Save-lifecycle correction requirement 2's Retry action. Resubmits
// st._pendingSaveAttempt.package -- the EXACT object planBuildCanonicalSaveAttempt
// built for the first attempt -- via planCommitCanonicalPackageAndClassify
// directly. Deliberately never calls planSaveCanonicalTemplate or
// planBuildCanonicalSaveAttempt again: doing so would allocate fresh
// Template/operation/manifest/gateway/revision ids and build a genuinely
// different package, exactly the bug this requirement exists to prevent.
// Shares planCanonicalEditorApplySaveResult with HandleSave, so a Retry
// that succeeds establishes canonical identity via the same auto-reopen
// path, and a Retry that resolves 'alreadyCommitted' (the store silently
// already had this exact operationId from the uncertain first attempt) is
// treated as the same successful completion HandleSave would treat it as.
//
// Uncertain-save recovery correction requirement 5: this function's guard
// condition (`!st._pendingSaveAttempt`) was already loose enough to accept
// BOTH the live-retryable-pending state and the new post-Cancel
// cancelledUnresolved state without any change -- both leave
// st._pendingSaveAttempt truthy, and the actual resubmission line
// (planCommitCanonicalPackageAndClassify(st.ctx, pending.package,
// pending.draft)) is untouched, byte-identical to the save-lifecycle
// correction's own version. The one addition is clearing the
// cancelledUnresolved flag right before resubmitting: if this retry itself
// comes back retryable again, the pending attempt is once again a live,
// freshly-retried one (Retry/Cancel is the right rendered pair for it, not
// the post-Cancel Retry Save/Check Saved Status/Abandon set) --
// planCanonicalEditorApplySaveResult's own 'retryable' branch leaves
// _pendingSaveAttempt (and this cleared flag) in place exactly as before.
async function planCanonicalEditorHandleRetrySave() {
  planCanonicalEditorRequireBooted('planCanonicalEditorHandleRetrySave');
  var st = planCanonicalEditorState;
  if (st.busy) return { status: 'ignored', reason: 'busy' };
  if (!st._pendingSaveAttempt) {
    var blocked = { status: 'blocked', validation: true, message: 'There is no pending save attempt to retry.' };
    st.outcome = blocked;
    st.validationMessage = blocked.message;
    planCanonicalEditorRender();
    return blocked;
  }
  var pending = st._pendingSaveAttempt;
  pending.cancelledUnresolved = false;
  st.busy = true;
  st.outcome = null;
  st.validationMessage = null;
  planCanonicalEditorRender();
  try {
    var result = await planCommitCanonicalPackageAndClassify(st.ctx, pending.package, pending.draft);
    return await planCanonicalEditorApplySaveResult(st, result);
  } catch (err) {
    var classified = planClassifyCanonicalWriteError(err, pending.draft);
    st._pendingSaveAttempt = null;
    st.outcome = classified;
    return classified;
  } finally {
    st.busy = false;
    planCanonicalEditorRender();
  }
}

// ---- planCanonicalEditorHandleCancelPendingSave() ----
// Uncertain-save recovery correction requirement 1's redesign of Cancel.
// The save-lifecycle correction's original version nulled
// st._pendingSaveAttempt outright and reported the attempt as "discarded
// without being resubmitted" -- wording that reads as proof the underlying
// Firestore write itself was cancelled. That is false: a 'retryable'
// commit outcome (the only outcome that ever leaves a pending attempt in
// the first place) means the write may already have landed; the response
// was merely lost or uncertain. Requirement 1 is explicit: "Do not label a
// pending attempt 'discarded' in a way that implies the underlying
// Firestore write was cancelled -- it may already have completed."
//
// Cancel therefore no longer clears st._pendingSaveAttempt at all -- it
// marks it `.cancelledUnresolved = true` on the SAME object, so:
//   - The exact package/draft stay intact, so Retry Save
//     (planCanonicalEditorHandleRetrySave) can still resubmit them
//     byte-identical, with no rebuild.
//   - st._pendingSaveAttempt stays truthy, so
//     planCanonicalEditorGuardMutable and planCanonicalEditorHandleNew
//     both continue to refuse ordinary mutation and New exactly as they
//     already do for a live pending attempt (requirement 1's "Block
//     ordinary Save from creating another Program").
//   - The rendered controls change to Retry Save / Check Saved Status /
//     Abandon (see the renderer) instead of Retry / Cancel, since there is
//     no live in-flight attempt to cancel anymore -- only ways to resolve
//     the one already left behind.
// The unresolved state is cleared only by: (a) Retry Save reaching a
// terminal (non-retryable) outcome, via the ordinary
// planCanonicalEditorApplySaveResult path; (b)
// planCanonicalEditorHandleCheckSavedStatus establishing the Template's
// actual fate through a real canonical read; or (c) the explicit
// planCanonicalEditorHandleAbandonUnresolvedSave acknowledgment -- never by
// Cancel itself again (Cancel on an already-cancelled attempt is a no-op;
// see the guard below).
function planCanonicalEditorHandleCancelPendingSave() {
  planCanonicalEditorRequireBooted('planCanonicalEditorHandleCancelPendingSave');
  var st = planCanonicalEditorState;
  if (st.busy) return { status: 'ignored', reason: 'busy' };
  if (!st._pendingSaveAttempt) return { status: 'ignored', reason: 'noPendingSaveAttempt' };
  if (st._pendingSaveAttempt.cancelledUnresolved) return { status: 'ignored', reason: 'alreadyUnresolved' };
  st._pendingSaveAttempt.cancelledUnresolved = true;
  st.outcome = {
    status: 'unresolved',
    message: 'The previous save attempt was not confirmed -- it may already have saved. Use Retry Save to resubmit the exact same attempt, or Check Saved Status to look it up.'
  };
  st.validationMessage = null;
  planCanonicalEditorRender();
  return st.outcome;
}

// ---- planCanonicalEditorHandleCheckSavedStatus() ----
// Uncertain-save recovery correction requirement 1's "Check Saved Status"
// action: reads the pending attempt's own planTemplateId through the real
// canonical reader (st.ctx.readCanonicalTemplate -- the exact same
// production accessor planReopenCanonicalTemplate and the boot-time
// recovery check both use) and, on a genuine 'notFound' outcome, THEN --
// and only then -- fully clears the pending attempt and returns editing to
// normal. A verified read is treated as a successful reopen (adopts the
// editor state, establishes _priorCanonicalBase, clears the pending
// attempt and the recovery marker). A retryable or integrity/authorization
// outcome leaves everything locked/pending, exactly matching the boot-time
// recovery flow's own four-branch grounding in the reader's real typed
// outcome (see planCanonicalEditorApplyBootRecoveryOutcome).
async function planCanonicalEditorHandleCheckSavedStatus() {
  planCanonicalEditorRequireBooted('planCanonicalEditorHandleCheckSavedStatus');
  var st = planCanonicalEditorState;
  if (st.busy) return { status: 'ignored', reason: 'busy' };
  if (!st._pendingSaveAttempt) return { status: 'ignored', reason: 'noPendingSaveAttempt' };
  var pending = st._pendingSaveAttempt;
  var templateId = pending.draft && pending.draft.planTemplateId;
  if (typeof templateId !== 'string' || !templateId) {
    var blocked = { status: 'blocked', message: 'The pending save attempt has no Template Id to check.' };
    st.outcome = blocked;
    planCanonicalEditorRender();
    return blocked;
  }
  st.busy = true;
  planCanonicalEditorRender();
  try {
    var result = await st.ctx.readCanonicalTemplate({ ownerUid: st.ctx.ownerUid, templateId: templateId });
    // Completion-of-a-stale-operation guard, matching the boot-time
    // recovery check's own principle: never attach a resolved check to a
    // state object a newer Boot/New has since replaced.
    if (planCanonicalEditorState !== st) return { status: 'ignored', reason: 'stateReplaced' };
    if (result && result.outcome === 'notFound') {
      st._pendingSaveAttempt = null;
      planCanonicalEditorClearRecoveryMarker();
      st.outcome = { status: 'recoveryResolved', resolution: 'notFound', message: 'The previous save attempt did not produce a saved Program -- it is safe to save again.' };
      st.validationMessage = null;
      return st.outcome;
    }
    if (result && (result.outcome === 'verifiedCurrent' || result.outcome === 'verifiedHistorical')) {
      var editorState = planAdaptCanonicalDraftToEditorState(result.draft);
      editorState._priorCanonicalBase = result.canonicalBase;
      st._pendingSaveAttempt = null;
      planCanonicalEditorClearRecoveryMarker();
      st.editorState = editorState;
      st.lastSavedTemplateId = templateId;
      st.reopenTemplateIdInput = templateId;
      st.needsReopenBeforeNextSave = false;
      st.outcome = { status: 'recoveryResolved', resolution: 'verified', message: 'The previous save attempt had already completed -- it has been reopened and is ready for normal editing.' };
      return st.outcome;
    }
    if (result && result.outcome === 'retryableFailure') {
      st.outcome = { status: 'unresolved', recoveryRetryable: true, message: 'Could not confirm the previous save attempt\'s status -- the check failed temporarily. The pending attempt is preserved; try Check Saved Status again or use Retry Save.' };
      return st.outcome;
    }
    st.outcome = {
      status: 'unresolved', recoveryConflict: true,
      message: 'Could not determine the previous save attempt\'s status -- checking it returned ' + (result && result.outcome ? '"' + result.outcome + '"' : 'an unexpected result') + ', not a definitive absence. The pending attempt is preserved; use Abandon if you want to start a new Program anyway.'
    };
    return st.outcome;
  } catch (err) {
    if (planCanonicalEditorState !== st) return { status: 'ignored', reason: 'stateReplaced' };
    var classified = planClassifyCanonicalReadError(err);
    st.outcome = {
      status: 'unresolved',
      recoveryRetryable: classified.status === 'retryable',
      recoveryConflict: classified.status !== 'retryable',
      message: classified.status === 'retryable'
        ? 'Could not confirm the previous save attempt\'s status -- the check failed temporarily. The pending attempt is preserved; try Check Saved Status again or use Retry Save.'
        : 'Could not determine the previous save attempt\'s status (' + (err && err.message ? err.message : 'unknown error') + '). The pending attempt is preserved; use Abandon if you want to start a new Program anyway.'
    };
    return st.outcome;
  } finally {
    if (planCanonicalEditorState === st) {
      st.busy = false;
      planCanonicalEditorRender();
    }
  }
}

// ---- planCanonicalEditorHandleAbandonUnresolvedSave(opts) ----
// Uncertain-save recovery correction requirement 1/2's explicit "abandon"
// acknowledgment path: "the user explicitly acknowledges abandoning a
// possibly-created Program." Resolves BOTH kinds of unresolved state this
// correction introduces -- a cancelled-but-unresolved pending save attempt
// AND a boot-time recovery check still locked on a retryable or
// integrity/authorization result -- since both are, at bottom, the same
// situation: it is unknown whether a Program already exists, and the user
// is choosing to stop tracking that uncertainty rather than resolve it.
//
// Deliberately unreachable by a single ordinary click: this must be called
// with `{ acknowledged: true }` explicitly -- anything else (no argument,
// acknowledged missing or falsy) is refused outright. The rendered Abandon
// control (see the renderer) enforces this as two separate real actions --
// checking an acknowledgment checkbox, then clicking Abandon -- so a single
// accidental click on the Abandon button alone can never bypass duplicate
// protection; the onclick source literally reads the checkbox's own state
// back into the `acknowledged` argument.
function planCanonicalEditorHandleAbandonUnresolvedSave(opts) {
  planCanonicalEditorRequireBooted('planCanonicalEditorHandleAbandonUnresolvedSave');
  var st = planCanonicalEditorState;
  if (st.busy) return { status: 'ignored', reason: 'busy' };
  if (!opts || opts.acknowledged !== true) {
    return {
      status: 'ignored', reason: 'acknowledgmentRequired',
      message: 'Abandoning an unresolved save requires an explicit acknowledgment that a Program may already exist.'
    };
  }
  if (!st._pendingSaveAttempt && !st.recoveryChecking) {
    return { status: 'ignored', reason: 'nothingUnresolved' };
  }
  var templateIdForReopen =
    (st._pendingSaveAttempt && st._pendingSaveAttempt.draft && st._pendingSaveAttempt.draft.planTemplateId) ||
    (st.recoveryMarker && st.recoveryMarker.planTemplateId) ||
    null;
  st._pendingSaveAttempt = null;
  st.recoveryChecking = false;
  st.recoveryMarker = null;
  st.needsReopenBeforeNextSave = false;
  st._abandonAcknowledged = false;
  // requirement 3: an explicitly completed recovery is one of the three
  // named removal points -- the user has now made an informed decision
  // about this attempt, so there is nothing further to recover after a
  // reload.
  planCanonicalEditorClearRecoveryMarker();
  if (templateIdForReopen) st.reopenTemplateIdInput = templateIdForReopen;
  st.outcome = {
    status: 'abandoned',
    message: 'The unresolved save attempt was abandoned. If a Program was actually created, it has NOT been deleted -- it can still be found later with Reopen using its Template Id' + (templateIdForReopen ? ' ("' + templateIdForReopen + '")' : '') + '.'
  };
  st.validationMessage = null;
  planCanonicalEditorRender();
  return st.outcome;
}

// ---- planCanonicalEditorHandleReopen(templateId) ----
// The canonical Reopen action. Reaches planReopenCanonicalTemplate (the
// already-accepted orchestration function, which always performs a real
// read -- no in-memory shortcut). On a successful reopen, the ENTIRE prior
// in-memory editorState (every unsaved edit included) is discarded and
// replaced with result.editorState, which already carries
// `_priorCanonicalBase` (planReopenCanonicalTemplate's own hidden
// bookkeeping field -- never touched by any oninput handler above, so it
// survives every subsequent field edit until the next Save/Reopen/New), and
// -- requirement 1 -- st.needsReopenBeforeNextSave is cleared, since a
// person has now genuinely confirmed the canonical head by hand.
// Same hardening as planCanonicalEditorHandleSave above, applied to Reopen:
// busy-guard checked first (no overlapping reads), a live pending save
// attempt also blocks Reopen (requirement 2 -- reopening would discard
// editorState while a commit that might still land is unresolved; Retry or
// Cancel it first), an empty Template Id is caught with a friendly message
// before any I/O, and any error planReopenCanonicalTemplate's own try/catch
// does not already cover (its ctx-shape planCanonicalAdapterRequire checks
// run before its own try, so a malformed ctx would otherwise become an
// unhandled rejection) is caught here, with busy always cleared via
// `finally`.
async function planCanonicalEditorHandleReopen(templateId) {
  planCanonicalEditorRequireBooted('planCanonicalEditorHandleReopen');
  var st = planCanonicalEditorState;
  if (st.busy) return { status: 'ignored', reason: 'busy' };
  if (st._pendingSaveAttempt) {
    return { status: 'ignored', reason: 'pendingSaveAttempt', message: 'A previous save attempt is still awaiting Retry or Cancel -- use one of those before reopening a different read.' };
  }
  var tid = (typeof templateId === 'string' && templateId) ? templateId : st.reopenTemplateIdInput;
  if (!tid) {
    st.outcome = { status: 'blocked', validation: true, message: 'Enter a Template Id to reopen.' };
    st.validationMessage = st.outcome.message;
    planCanonicalEditorRender();
    return st.outcome;
  }

  st.busy = true;
  st.outcome = null;
  st.validationMessage = null;
  planCanonicalEditorRender();
  try {
    var result = await planReopenCanonicalTemplate(st.ctx.ownerUid, tid, st.ctx);
    st.outcome = result;
    if (result.status === 'success' && result.editorState) {
      st.editorState = result.editorState;
      // requirement 1: "Clear the flag once a Reopen (manual or automatic)
      // succeeds" -- any successful reopen re-establishes a genuine
      // _priorCanonicalBase for whichever Template was just read, so a
      // plain next Save is safe again regardless of which stale
      // lastSavedTemplateId originally set the flag.
      st.needsReopenBeforeNextSave = false;
    }
    return result;
  } catch (err) {
    var classified = planClassifyCanonicalReadError(err);
    st.outcome = classified;
    return classified;
  } finally {
    st.busy = false;
    planCanonicalEditorRender();
  }
}
function planCanonicalEditorHandleReopenLastSaved() {
  planCanonicalEditorRequireBooted('planCanonicalEditorHandleReopenLastSaved');
  return planCanonicalEditorHandleReopen(planCanonicalEditorState.lastSavedTemplateId);
}

// ---- Rendering (real DOM, guarded no-op under Node -- there is no
// `document` to draw into there, and none of the handler functions above
// need it: they mutate planCanonicalEditorState directly and a test reads
// that state directly, exactly the way it reads planSaveCanonicalTemplate's
// return value directly, never by scraping rendered HTML). ----
function planCanonicalEditorOutcomeLabel(outcome) {
  if (!outcome || !outcome.status) return '';
  // Save-lifecycle correction requirement 1: a committed save whose
  // follow-up reopen failed must never render as an ordinary clean "Saved"
  // -- distinctly labeled so a person can tell "saved, but refresh/reopen
  // failed" apart from a save that fully confirmed, at a glance, without
  // reading the outcome's message text.
  if (outcome.savedButReopenFailed) return 'Saved, but refresh/reopen failed -- reopen before saving again';
  // Acceptance correction (this round): 'permanent' is the writer's
  // catch-all for every unrecognized error, and (per the recovery-marker
  // CERTAINTY correction) is now treated as genuinely uncertain -- the
  // pending package and recovery marker are both retained, identically to
  // 'retryable'. The label previously read 'Permanent failure', which
  // wrongly implied the write was confirmed NOT to have happened. Only the
  // rendered wording changes here -- the status name ('permanent'), the
  // error-classification logic, the marker-retention policy, and Retry/
  // Cancel behavior are all unchanged.
  // Production-integration correction (secondary finding): this SAME label
  // function renders BOTH Save and Reopen outcomes (planCanonicalEditorHandleReopen
  // sets st.outcome exactly like Save does, and both funnel through the one
  // rendered outcome banner). The 'permanent' wording used to read "Save
  // outcome unknown -- Retry or Cancel", which is wrong for a failed Reopen
  // -- nothing was saved. Every other label here was already action-neutral
  // (no other entry mentions "Save"); 'permanent' is now the same way, so
  // it reads correctly regardless of which action produced it.
  var labels = {
    success: 'Saved', alreadyCommitted: 'Saved (no change)', blocked: 'Blocked',
    disabled: 'Disabled (canonical capability is off)', conflict: 'Conflict',
    retryable: 'Retryable failure -- Retry or Cancel', permanent: 'Outcome unknown -- Retry or Cancel',
    ignored: 'Ignored (already in progress)', cancelled: 'Cancelled',
    // Uncertain-save recovery correction labels.
    unresolved: 'Unresolved -- previous attempt not confirmed',
    checkingPreviousSave: 'Checking previous save...',
    recoveryResolved: 'Recovery resolved',
    abandoned: 'Abandoned (unresolved save left behind)'
  };
  return labels[outcome.status] || outcome.status;
}

// ---- planCanonicalEditorIdxAttrs(mi, si, ei, seti) ----
// Emits stable data-mi/data-si/data-ei/data-seti attributes on every
// control below, purely so a test (or any other automated tool) can find
// and disambiguate a specific rendered control -- harmless in a real
// browser (no CSS or JS elsewhere reads them). Requirement 3's DOM-level
// test category locates controls this way and dispatches real input/
// change/click events at them; it never calls a handler function by name.
function planCanonicalEditorIdxAttrs(mi, si, ei, seti) {
  var out = '';
  if (mi !== undefined && mi !== null) out += ' data-mi="' + mi + '"';
  if (si !== undefined && si !== null) out += ' data-si="' + si + '"';
  if (ei !== undefined && ei !== null) out += ' data-ei="' + ei + '"';
  if (seti !== undefined && seti !== null) out += ' data-seti="' + seti + '"';
  return out;
}

// ---- planCanonicalEditorExerciseOptions() ----
// Backs the exercise-selection control (requirement 1: "Use appropriate
// select/number/text controls rather than requiring a person to know or
// manually type internal values unnecessarily"). getAllExercises() is the
// existing, already-accepted, shared exercise-catalog accessor
// (app-data.js) every other part of this app already uses to resolve an
// exerciseId to a name (e.g. app-plan.js's own legacy getExercise() calls,
// untouched by this correction) -- not a legacy Program editor function,
// and never mutated here. Guarded and wrapped so a bare Node load (no
// app-data.js/app-core.js globals) never breaks rendering; the renderer
// falls back to a manual text field in that case (see exerciseSelectHtml
// below), which is also what a real browser would need if the catalog
// were ever genuinely empty.
function planCanonicalEditorExerciseOptions() {
  try {
    if (typeof getAllExercises === 'function') {
      var list = getAllExercises() || [];
      return list.slice().sort(function (a, b) {
        var an = (a && a.name) || '', bn = (b && b.name) || '';
        return an < bn ? -1 : (an > bn ? 1 : 0);
      });
    }
  } catch (e) { /* never let a broken/absent library block rendering */ }
  return [];
}

function planCanonicalEditorRender() {
  if (typeof document === 'undefined') return;
  if (!planCanonicalEditorState) return;
  var root = document.getElementById(PLAN_CANONICAL_EDITOR_CONTAINER_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = PLAN_CANONICAL_EDITOR_CONTAINER_ID;
    root.style.cssText = 'position:fixed;inset:0;z-index:99999;background:var(--bg,#fff);overflow:auto;padding:16px';
    document.body.appendChild(root);
  }
  var st = planCanonicalEditorState;
  var es = st.editorState;
  var busyAttr = st.busy ? 'disabled' : '';
  // Save-lifecycle correction requirement 3 ("Rendered controls must be
  // disabled appropriately"): every control that MUTATES editorState is
  // disabled whenever planCanonicalEditorGuardMutable would refuse it --
  // busy (an operation is literally in flight) OR a save attempt is
  // pending confirmation (requirement 2's chosen "block editing" policy).
  // The actual protection against mutation is planCanonicalEditorGuardMutable
  // itself (every handler checks it regardless of what is rendered here) --
  // this attribute is the honest reflection of that in the DOM, not the
  // enforcement mechanism.
  // Uncertain-save recovery correction requirement 4: recoveryChecking now
  // blocks mutation exactly like busy/_pendingSaveAttempt already do (see
  // planCanonicalEditorGuardMutable) -- the rendered lock reflects that.
  var lockedAttr = (st.busy || st._pendingSaveAttempt || st.recoveryChecking) ? 'disabled' : '';

  var outcomeHtml = st.outcome
    ? '<div class="plan-canonical-editor-outcome" data-testid="outcome" style="margin:8px 0;padding:8px;border-radius:6px;background:#eee">' +
      escapeHtml(planCanonicalEditorOutcomeLabel(st.outcome)) +
      (st.outcome.message ? ' -- ' + escapeHtml(st.outcome.message) : '') +
      (st.outcome.error && st.outcome.error.message ? ' -- ' + escapeHtml(st.outcome.error.message) : '') +
      '</div>'
    : '';
  var validationHtml = st.validationMessage
    ? '<div class="plan-canonical-editor-validation" data-testid="validation-message" style="margin:8px 0;padding:8px;border-radius:6px;background:#fee;color:#900">' + escapeHtml(st.validationMessage) + '</div>'
    : '';
  // Uncertain-save recovery correction requirement 3: "If local storage is
  // unavailable, keep the current in-memory behavior but visibly warn that
  // reload recovery will not be available while the save is unresolved."
  var reloadWarningHtml = st.reloadRecoveryWarning
    ? '<div class="plan-canonical-editor-reload-warning" data-testid="reload-recovery-warning" style="margin:8px 0;padding:8px;border-radius:6px;background:#ffe;color:#740">' + escapeHtml(st.reloadRecoveryWarning) + '</div>'
    : '';

  var exerciseOptions = planCanonicalEditorExerciseOptions();

  function exerciseSelectHtml(mi, si, ei, ex) {
    var idx = planCanonicalEditorIdxAttrs(mi, si, ei);
    if (!exerciseOptions.length) {
      return '<label style="font-size:11px;display:block">Exercise<input type="text" data-testid="exercise-id-input"' + idx + ' ' + lockedAttr + ' placeholder="exercise id" value="' + escapeHtml(ex.exerciseId || '') + '" oninput="planCanonicalEditorHandleSetExerciseField(' + mi + ',' + si + ',' + ei + ',\'exerciseId\',this.value)"></label>';
    }
    var foundCurrent = false;
    var optionsHtml = '<option value="">-- Select Exercise --</option>' + exerciseOptions.map(function (opt) {
      var selected = opt.id === ex.exerciseId;
      if (selected) foundCurrent = true;
      return '<option value="' + escapeHtml(opt.id) + '" ' + (selected ? 'selected' : '') + '>' + escapeHtml(opt.name || opt.id) + '</option>';
    }).join('');
    if (ex.exerciseId && !foundCurrent) {
      optionsHtml += '<option value="' + escapeHtml(ex.exerciseId) + '" selected>' + escapeHtml(ex.exerciseId) + '</option>';
    }
    return '<label style="font-size:11px;display:block">Exercise<select data-testid="exercise-select"' + idx + ' ' + lockedAttr + ' onchange="planCanonicalEditorHandleSetExerciseField(' + mi + ',' + si + ',' + ei + ',\'exerciseId\',this.value)">' + optionsHtml + '</select></label>';
  }

  function setHtml(mi, si, ei, set, seti, setCount) {
    var idx = planCanonicalEditorIdxAttrs(mi, si, ei, seti);
    function num(field, label) {
      var v = set[field];
      return '<label style="font-size:11px">' + label + '<input type="number" step="any" data-testid="set-' + field + '"' + idx + ' ' + lockedAttr + ' value="' + (v === null || v === undefined ? '' : v) + '" oninput="planCanonicalEditorHandleSetSetField(' + mi + ',' + si + ',' + ei + ',' + seti + ',\'' + field + '\',this.value)"></label>';
    }
    var loadHtml = set.loadType === 'fixed' ? num('weight', 'Weight')
      : set.loadType === 'percentTM' ? num('percent', '% TM')
      : set.loadType === 'percent1RM' ? num('percent', '% 1RM')
      : set.loadType === 'bodyweight' ? num('addedWeight', 'Added Weight')
      : '';
    var repsHtml = set.repsType === 'fixed' ? num('reps', 'Reps')
      : set.repsType === 'range' ? (num('minReps', 'Min Reps') + num('maxReps', 'Max Reps'))
      : '';
    var effortHtml = set.effortType === 'fixed' ? num('rir', 'RIR')
      : set.effortType === 'range' ? (num('minRir', 'Min RIR') + num('maxRir', 'Max RIR'))
      : '';
    var timeHtml = set.timeType === 'fixed' ? num('seconds', 'Seconds')
      : set.timeType === 'range' ? (num('minSeconds', 'Min Sec') + num('maxSeconds', 'Max Sec'))
      : '';
    function typeSelect(field, label, opts) {
      return '<label style="font-size:11px">' + label +
        '<select data-testid="set-' + field + '"' + idx + ' ' + lockedAttr + ' onchange="planCanonicalEditorHandleSetSetField(' + mi + ',' + si + ',' + ei + ',' + seti + ',\'' + field + '\',this.value)">' +
        opts.map(function (o) { return '<option value="' + o.v + '" ' + (set[field] === o.v ? 'selected' : '') + '>' + o.label + '</option>'; }).join('') +
        '</select></label>';
    }
    return '<div class="plan-canonical-editor-set" data-testid="set-row"' + idx + ' style="display:flex;flex-wrap:wrap;gap:6px;align-items:flex-end;margin:4px 0;padding:4px;border:1px solid #eee;border-radius:4px">' +
      typeSelect('loadType', 'Load', [{ v: '', label: 'Blank' }, { v: 'fixed', label: 'Fixed Weight' }, { v: 'percentTM', label: '% TM' }, { v: 'percent1RM', label: '% 1RM' }, { v: 'bodyweight', label: 'Bodyweight' }]) +
      loadHtml +
      typeSelect('repsType', 'Reps', [{ v: '', label: 'Blank' }, { v: 'fixed', label: 'Fixed' }, { v: 'range', label: 'Range' }]) +
      repsHtml +
      typeSelect('effortType', 'Effort', [{ v: '', label: 'Blank' }, { v: 'fixed', label: 'Fixed RIR' }, { v: 'range', label: 'RIR Range' }]) +
      effortHtml +
      typeSelect('timeType', 'Time', [{ v: '', label: 'Blank' }, { v: 'fixed', label: 'Fixed' }, { v: 'range', label: 'Range' }]) +
      timeHtml +
      '<label style="font-size:11px">Notes<input type="text" data-testid="set-notes"' + idx + ' ' + lockedAttr + ' value="' + escapeHtml(set.notes || '') + '" oninput="planCanonicalEditorHandleSetSetField(' + mi + ',' + si + ',' + ei + ',' + seti + ',\'notes\',this.value)"></label>' +
      '<button type="button" class="btn btn-sm" data-testid="move-set-up"' + idx + ' ' + (lockedAttr || (seti === 0 ? 'disabled' : '')) + ' onclick="planCanonicalEditorHandleMoveSet(' + mi + ',' + si + ',' + ei + ',' + seti + ',-1)">Move Up</button>' +
      '<button type="button" class="btn btn-sm" data-testid="move-set-down"' + idx + ' ' + (lockedAttr || (seti === setCount - 1 ? 'disabled' : '')) + ' onclick="planCanonicalEditorHandleMoveSet(' + mi + ',' + si + ',' + ei + ',' + seti + ',1)">Move Down</button>' +
      '<button type="button" class="btn btn-sm" data-testid="remove-set"' + idx + ' ' + lockedAttr + ' onclick="planCanonicalEditorHandleRemoveSet(' + mi + ',' + si + ',' + ei + ',' + seti + ')">Remove Set</button>' +
      '</div>';
  }

  function progressionHtml(mi, si, ei, ex) {
    var idx = planCanonicalEditorIdxAttrs(mi, si, ei);
    var prog = ex.progression;
    if (!prog || !prog.enabled) {
      return '<div class="plan-canonical-editor-progression" data-testid="progression-panel"' + idx + ' style="margin:6px 0">' +
        '<button type="button" class="btn btn-sm" data-testid="progression-enable"' + idx + ' ' + lockedAttr + ' onclick="planCanonicalEditorHandleEnableProgression(' + mi + ',' + si + ',' + ei + ')">Enable Progression</button>' +
        '</div>';
    }
    var setCount = ex.sets.length;
    var gatewayOptions = ex.sets.map(function (s, i) { return '<option value="' + i + '" ' + (prog.gatewaySetIndex === i ? 'selected' : '') + '>Set ' + (i + 1) + '</option>'; }).join('');
    return '<div class="plan-canonical-editor-progression" data-testid="progression-panel"' + idx + ' style="margin:6px 0;padding:6px;border:1px solid #ddd;border-radius:4px">' +
      '<div style="font-size:12px;font-weight:600">Progression: ON</div>' +
      '<label style="font-size:11px">Evaluation<select data-testid="progression-evaluationType"' + idx + ' ' + lockedAttr + ' onchange="planCanonicalEditorHandleSetProgressionField(' + mi + ',' + si + ',' + ei + ',\'evaluationType\',this.value)">' +
        ['strict', 'volume', 'gateway'].map(function (v) { return '<option value="' + v + '" ' + (prog.evaluationType === v ? 'selected' : '') + '>' + v + '</option>'; }).join('') +
        '</select></label>' +
      (prog.evaluationType === 'gateway' && setCount ? '<label style="font-size:11px">Gateway Set<select data-testid="progression-gatewaySetIndex"' + idx + ' ' + lockedAttr + ' onchange="planCanonicalEditorHandleSetProgressionField(' + mi + ',' + si + ',' + ei + ',\'gatewaySetIndex\',this.value)">' + gatewayOptions + '</select></label>' : '') +
      '<label style="font-size:11px">Adjustment<select data-testid="progression-adjustmentType"' + idx + ' ' + lockedAttr + ' onchange="planCanonicalEditorHandleSetProgressionField(' + mi + ',' + si + ',' + ei + ',\'adjustmentType\',this.value)">' +
        [{ v: 'addLoad', label: 'Increase Fixed Load' }, { v: 'increaseTM', label: 'Increase Training Max' }].map(function (o) { return '<option value="' + o.v + '" ' + (prog.adjustmentType === o.v ? 'selected' : '') + '>' + o.label + '</option>'; }).join('') +
        '</select></label>' +
      (prog.adjustmentType === 'increaseTM'
        ? '<label style="font-size:11px">TM Increase<input type="number" step="any" data-testid="progression-tmIncrease"' + idx + ' ' + lockedAttr + ' value="' + (prog.tmIncrease === null || prog.tmIncrease === undefined ? '' : prog.tmIncrease) + '" oninput="planCanonicalEditorHandleSetProgressionField(' + mi + ',' + si + ',' + ei + ',\'tmIncrease\',this.value)"></label>'
        : '<label style="font-size:11px">Load Increase<input type="number" step="any" data-testid="progression-loadIncrease"' + idx + ' ' + lockedAttr + ' value="' + (prog.loadIncrease === null || prog.loadIncrease === undefined ? '' : prog.loadIncrease) + '" oninput="planCanonicalEditorHandleSetProgressionField(' + mi + ',' + si + ',' + ei + ',\'loadIncrease\',this.value)"></label>') +
      '<label style="font-size:11px">On Failure<select data-testid="progression-failBehavior"' + idx + ' ' + lockedAttr + ' onchange="planCanonicalEditorHandleSetProgressionField(' + mi + ',' + si + ',' + ei + ',\'failBehavior\',this.value)">' +
        '<option value="repeat" ' + (prog.failBehavior === 'repeat' ? 'selected' : '') + '>Repeat Prescription</option>' +
        '</select></label>' +
      '<button type="button" class="btn btn-sm" data-testid="progression-disable"' + idx + ' ' + lockedAttr + ' onclick="planCanonicalEditorHandleDisableProgression(' + mi + ',' + si + ',' + ei + ')">Disable Progression</button>' +
      '</div>';
  }

  var microcyclesHtml = es.microcycles.map(function (mc, mi) {
    var mcIdx = planCanonicalEditorIdxAttrs(mi);
    var mcCount = es.microcycles.length;
    var sessionsHtml = mc.sessions.map(function (s, si) {
      var sIdx = planCanonicalEditorIdxAttrs(mi, si);
      var sessCount = mc.sessions.length;
      var exercisesHtml = s.exercises.map(function (ex, ei) {
        var eIdx = planCanonicalEditorIdxAttrs(mi, si, ei);
        var exCount = s.exercises.length;
        var setsHtml = ex.sets.map(function (set, seti) { return setHtml(mi, si, ei, set, seti, ex.sets.length); }).join('');
        return '<div class="plan-canonical-editor-exercise" data-testid="exercise-row"' + eIdx + ' style="border:1px solid #ccc;border-radius:6px;padding:8px;margin:6px 0">' +
          exerciseSelectHtml(mi, si, ei, ex) +
          '<label style="font-size:11px;display:block">Notes<input type="text" data-testid="exercise-notes"' + eIdx + ' ' + lockedAttr + ' value="' + escapeHtml(ex.notes || '') + '" oninput="planCanonicalEditorHandleSetExerciseField(' + mi + ',' + si + ',' + ei + ',\'notes\',this.value)"></label>' +
          setsHtml +
          '<button type="button" class="btn btn-sm" data-testid="add-set"' + eIdx + ' ' + lockedAttr + ' onclick="planCanonicalEditorHandleAddSet(' + mi + ',' + si + ',' + ei + ')">+ Set</button>' +
          progressionHtml(mi, si, ei, ex) +
          '<div style="margin-top:4px">' +
          '<button type="button" class="btn btn-sm" data-testid="move-exercise-up"' + eIdx + ' ' + (lockedAttr || (ei === 0 ? 'disabled' : '')) + ' onclick="planCanonicalEditorHandleMoveExercise(' + mi + ',' + si + ',' + ei + ',-1)">Move Up</button>' +
          '<button type="button" class="btn btn-sm" data-testid="move-exercise-down"' + eIdx + ' ' + (lockedAttr || (ei === exCount - 1 ? 'disabled' : '')) + ' onclick="planCanonicalEditorHandleMoveExercise(' + mi + ',' + si + ',' + ei + ',1)">Move Down</button>' +
          '<button type="button" class="btn btn-sm" data-testid="remove-exercise"' + eIdx + ' ' + lockedAttr + ' onclick="planCanonicalEditorHandleRemoveExercise(' + mi + ',' + si + ',' + ei + ')">Remove Exercise</button>' +
          '</div></div>';
      }).join('');
      return '<div class="plan-canonical-editor-session" data-testid="session-row"' + sIdx + ' style="border:1px solid #ddd;border-radius:6px;padding:8px;margin:6px 0">' +
        '<label style="font-size:11px;display:block">Session Name<input type="text" data-testid="session-name"' + sIdx + ' ' + lockedAttr + ' value="' + escapeHtml(s.name || '') + '" oninput="planCanonicalEditorHandleSetSessionField(' + mi + ',' + si + ',\'name\',this.value)"></label>' +
        '<label style="font-size:11px;display:block">Session Notes<textarea data-testid="session-notes"' + sIdx + ' ' + lockedAttr + ' oninput="planCanonicalEditorHandleSetSessionField(' + mi + ',' + si + ',\'notes\',this.value)">' + escapeHtml(s.notes || '') + '</textarea></label>' +
        exercisesHtml +
        '<button type="button" class="btn btn-sm" data-testid="add-exercise"' + sIdx + ' ' + lockedAttr + ' onclick="planCanonicalEditorHandleAddExercise(' + mi + ',' + si + ')">+ Exercise</button>' +
        '<div style="margin-top:4px">' +
        '<button type="button" class="btn btn-sm" data-testid="move-session-up"' + sIdx + ' ' + (lockedAttr || (si === 0 ? 'disabled' : '')) + ' onclick="planCanonicalEditorHandleMoveSession(' + mi + ',' + si + ',-1)">Move Up</button>' +
        '<button type="button" class="btn btn-sm" data-testid="move-session-down"' + sIdx + ' ' + (lockedAttr || (si === sessCount - 1 ? 'disabled' : '')) + ' onclick="planCanonicalEditorHandleMoveSession(' + mi + ',' + si + ',1)">Move Down</button>' +
        '<button type="button" class="btn btn-sm" data-testid="remove-session"' + sIdx + ' ' + lockedAttr + ' onclick="planCanonicalEditorHandleRemoveSession(' + mi + ',' + si + ')">Remove Session</button>' +
        '</div></div>';
    }).join('');
    return '<div class="plan-canonical-editor-microcycle" data-testid="microcycle-row"' + mcIdx + ' style="border:1px solid #bbb;border-radius:6px;padding:8px;margin:6px 0">' +
      '<label style="font-size:11px;display:block">Microcycle Name<input type="text" data-testid="microcycle-name"' + mcIdx + ' ' + lockedAttr + ' value="' + escapeHtml(mc.name || '') + '" oninput="planCanonicalEditorHandleSetMicrocycleField(' + mi + ',\'name\',this.value)"></label>' +
      sessionsHtml +
      '<button type="button" class="btn btn-sm" data-testid="add-session"' + mcIdx + ' ' + lockedAttr + ' onclick="planCanonicalEditorHandleAddSession(' + mi + ')">+ Session</button>' +
      '<div style="margin-top:4px">' +
      '<button type="button" class="btn btn-sm" data-testid="move-microcycle-up"' + mcIdx + ' ' + (lockedAttr || (mi === 0 ? 'disabled' : '')) + ' onclick="planCanonicalEditorHandleMoveMicrocycle(' + mi + ',-1)">Move Up</button>' +
      '<button type="button" class="btn btn-sm" data-testid="move-microcycle-down"' + mcIdx + ' ' + (lockedAttr || (mi === mcCount - 1 ? 'disabled' : '')) + ' onclick="planCanonicalEditorHandleMoveMicrocycle(' + mi + ',1)">Move Down</button>' +
      '<button type="button" class="btn btn-sm" data-testid="remove-microcycle"' + mcIdx + ' ' + lockedAttr + ' onclick="planCanonicalEditorHandleRemoveMicrocycle(' + mi + ')">Remove Microcycle</button>' +
      '</div></div>';
  }).join('');

  // Uncertain-save recovery correction requirement 1/2/4: the "Abandon"
  // control shared by the two unresolved states below (a cancelled-but-
  // unresolved pending save, and a boot-time recovery lock). Deliberately
  // two real actions, not one: a checkbox (whose onchange writes to
  // st._abandonAcknowledged and re-renders, purely so the checked state is
  // visible) and a SEPARATE Abandon button whose onclick reads that same
  // field back as the `acknowledged` argument -- a bare click on the
  // button alone (no prior checkbox click) always passes
  // {acknowledged:false}, which planCanonicalEditorHandleAbandonUnresolvedSave
  // refuses outright. This is what makes a single accidental click unable
  // to bypass duplicate-prevention.
  var abandonControlHtml =
    '<div class="plan-canonical-editor-abandon" data-testid="abandon-control" style="margin-top:8px;padding:8px;border:1px dashed #900;border-radius:6px">' +
    '<label style="font-size:11px;display:block"><input type="checkbox" data-testid="abandon-ack-checkbox" ' + (st._abandonAcknowledged ? 'checked' : '') + ' onchange="planCanonicalEditorState._abandonAcknowledged = this.checked; planCanonicalEditorRender();"> Yes, I understand a Program may already exist and I am abandoning tracking it.</label>' +
    '<button type="button" class="btn btn-secondary" data-testid="abandon-btn" ' + busyAttr + ' onclick="planCanonicalEditorHandleAbandonUnresolvedSave({acknowledged: planCanonicalEditorState._abandonAcknowledged === true})">Abandon</button>' +
    '</div>';

  // Save-lifecycle / uncertain-save recovery correction: three distinct
  // rendered states now, not two.
  //   1. recoveryChecking (requirement 4) -- boot-time recovery is either
  //      still in flight or locked awaiting Retry Check/Abandon. Nothing
  //      about the pending save-attempt controls applies here at all;
  //      there is no editorState worth saving yet.
  //   2. st._pendingSaveAttempt.cancelledUnresolved (requirement 1) -- a
  //      Cancel has already happened; there is no live in-flight attempt
  //      left to Cancel again, only Retry Save / Check Saved Status /
  //      Abandon.
  //   3. st._pendingSaveAttempt (live, not yet cancelled) -- the original
  //      save-lifecycle correction's Retry/Cancel pair, unchanged.
  //   4. Neither -- the ordinary Save button.
  var saveAreaHtml;
  if (st.recoveryChecking) {
    saveAreaHtml =
      '<div class="plan-canonical-editor-recovery-lock" data-testid="recovery-lock-banner" style="padding:8px;border-radius:6px;background:#ffe">' +
      'Checking previous save status -- editing is locked until this resolves.' +
      '</div>' +
      '<button type="button" class="btn btn-primary" data-testid="retry-recovery-check-btn" ' + busyAttr + ' onclick="planCanonicalEditorHandleRetryRecoveryCheck()">Retry Check</button>' +
      abandonControlHtml;
  } else if (st._pendingSaveAttempt && st._pendingSaveAttempt.cancelledUnresolved) {
    saveAreaHtml =
      '<button type="button" class="btn btn-primary" data-testid="retry-save-btn" ' + busyAttr + ' onclick="planCanonicalEditorHandleRetrySave()">Retry Save</button>' +
      '<button type="button" class="btn btn-secondary" data-testid="check-saved-status-btn" ' + busyAttr + ' onclick="planCanonicalEditorHandleCheckSavedStatus()">Check Saved Status</button>' +
      abandonControlHtml;
  } else if (st._pendingSaveAttempt) {
    // Save-lifecycle correction requirement 2: while a LIVE save attempt is
    // pending confirmation, the Save button is replaced with Retry/Cancel
    // -- there is nothing an ordinary Save click could mean in that state
    // (see planCanonicalEditorHandleSave's own top-of-function refusal).
    saveAreaHtml =
      '<button type="button" class="btn btn-primary" data-testid="retry-save-btn" ' + busyAttr + ' onclick="planCanonicalEditorHandleRetrySave()">Retry Save</button>' +
      '<button type="button" class="btn btn-secondary" data-testid="cancel-pending-save-btn" ' + busyAttr + ' onclick="planCanonicalEditorHandleCancelPendingSave()">Cancel</button>';
  } else {
    saveAreaHtml = '<button type="button" class="btn btn-primary" data-testid="save-btn" ' + busyAttr + ' onclick="planCanonicalEditorHandleSave()">Save</button>';
  }
  // Reopen (and Reopen Last Saved) are disabled while a save attempt is
  // pending, or while a boot-time recovery check is unresolved, too --
  // reopening would discard the in-memory editorState the pending attempt
  // was built from, or race the recovery check, while either is still
  // unresolved (see planCanonicalEditorHandleReopen's own pending-attempt
  // guard).
  var reopenLockedAttr = (st.busy || st._pendingSaveAttempt || st.recoveryChecking) ? 'disabled' : '';

  root.innerHTML =
    '<div class="page-title-zone"><h2>Canonical Program Editor (development/test only)</h2></div>' +
    outcomeHtml + validationHtml + reloadWarningHtml +
    '<div class="form-group"><label>Program Name</label><input type="text" data-testid="program-name" ' + lockedAttr + ' value="' + escapeHtml(es.name || '') + '" oninput="planCanonicalEditorHandleSetProgramField(\'name\',this.value)"></div>' +
    '<div class="form-group"><label>Description</label><textarea data-testid="program-description" ' + lockedAttr + ' oninput="planCanonicalEditorHandleSetProgramField(\'description\',this.value)">' + escapeHtml(es.description || '') + '</textarea></div>' +
    '<div class="form-group"><label>Structure Label</label><input type="text" data-testid="program-structureLabel" ' + lockedAttr + ' value="' + escapeHtml(es.structureLabel || '') + '" oninput="planCanonicalEditorHandleSetProgramField(\'structureLabel\',this.value)"></div>' +
    '<div class="form-group"><label>Notes</label><textarea data-testid="program-notes" ' + lockedAttr + ' oninput="planCanonicalEditorHandleSetProgramField(\'notes\',this.value)">' + escapeHtml(es.notes || '') + '</textarea></div>' +
    microcyclesHtml +
    '<button type="button" class="btn btn-secondary" data-testid="add-microcycle-btn" ' + lockedAttr + ' onclick="planCanonicalEditorHandleAddMicrocycle()">+ Add Microcycle</button>' +
    '<div style="margin-top:16px;display:flex;gap:8px">' +
    saveAreaHtml +
    // Uncertain-save recovery correction requirement 2: New is now locked
    // (fail-closed, the explicitly preferred option) under exactly the
    // same conditions lockedAttr already reflects -- see
    // planCanonicalEditorHandleNew's own comment for why New is no longer
    // exempt from this.
    '<button type="button" class="btn btn-secondary" data-testid="new-btn" ' + lockedAttr + ' onclick="planCanonicalEditorHandleNew()">New</button>' +
    '</div>' +
    '<div class="form-group" style="margin-top:16px"><label>Reopen Template Id</label>' +
    '<input type="text" data-testid="reopen-template-id-input" ' + reopenLockedAttr + ' value="' + escapeHtml(st.reopenTemplateIdInput || '') + '" oninput="planCanonicalEditorState.reopenTemplateIdInput = this.value">' +
    '<button type="button" class="btn btn-secondary" data-testid="reopen-btn" ' + reopenLockedAttr + ' onclick="planCanonicalEditorHandleReopen()">Reopen</button>' +
    '<button type="button" class="btn btn-secondary" data-testid="reopen-last-saved-btn" ' + (reopenLockedAttr || (!st.lastSavedTemplateId ? 'disabled' : '')) + ' onclick="planCanonicalEditorHandleReopenLastSaved()">Reopen Last Saved</button>' +
    '</div>';
}

// -----------------------------------------------------------------------------
// Isomorphic export block. In the browser (no `module`), this is a no-op and
// every function above remains an ordinary top-level function declaration.
// The pure adapters/orchestration functions from the original Slice 5A
// section (planSaveCanonicalTemplate, planReopenCanonicalTemplate,
// planNewCanonicalProgressionState, and neighbors) were, at that point,
// correct but genuinely unreachable from anywhere in the running app --
// this comment used to say so explicitly. The Slice 5A completion
// correction below (banner: "SLICE 5A COMPLETION CORRECTION") is the
// "future, separately authorized slice" that comment anticipated: it adds
// the first and only real browser call sites for those functions, reachable
// solely through planCanonicalEditorBoot() (see that section for the exact
// reachability contract -- hidden from normal navigation, no legacy code
// touched). In Node, this export block lets the standalone test harness
// `require()` these pure functions (and, now, the new editor's production
// handler functions) without loading or affecting any browser-only DOM code
// elsewhere in this file. There is exactly ONE export block for the whole
// Slice 1 section (not one per internal module) so that every module's
// exports survive assembly into this single file.
// -----------------------------------------------------------------------------
// ==================== SLICE 5B — CANONICAL PROGRESSION ====================
// Pure only: this section never reads or writes Firestore or workout history.
var PLAN_PROGRESSION_BASIS_KEYS = Object.freeze(['adjustmentType','exerciseId','headRevisionId','orderedSets','ownerUid','planAssignmentId','planPrescriptionId','planRuleId','planSessionId','planTemplateId','ruleRevisionId']);
var PLAN_PROGRESSION_PRESCRIBED_KEYS = Object.freeze(['maxReps','maxSeconds','minReps','minSeconds','reps','repsType','seconds','timeType']);

function planProgressionOwnKeysExactly(value, keys) {
  return planIsPlainObject(value) && Object.keys(value).sort().join('\n') === keys.slice().sort().join('\n');
}
// Correction round 1 (finding 2): strengthened to also reject NUL bytes and
// leading/trailing whitespace padding, not just '/' and '\\'. This is the
// one shared identifier precedent used throughout progression validation
// (basis fields, rule fields, evidence fields, and now evidence.workoutId
// too) and firebase-plan-progression.js's own local `id()` copy.
// Correction round 2 (finding 3): additionally rejects the same categories
// the accepted firebase.js isValidRecordId precedent rejects -- dot
// segments ('.'/'..'), query/fragment suffix characters ('?'/'#'), and
// case-insensitive encoded separator substitutes ('%2f'/'%5c') -- on top of
// the existing empty/overlong/slash/backslash/NUL/whitespace-padding
// rejections and the Slice 5B-specific 200-character bound (isValidRecordId
// itself has no length bound).
function planProgressionId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) return false;
  if (value !== value.trim()) return false;
  if (/[\/\\\x00]/.test(value)) return false;
  if (value === '.' || value === '..') return false;
  if (value.indexOf('?') !== -1 || value.indexOf('#') !== -1) return false;
  var lowerValue = value.toLowerCase();
  if (lowerValue.indexOf('%2f') !== -1 || lowerValue.indexOf('%5c') !== -1) return false;
  return true;
}
function planProgressionFiniteOrNull(value) { return value === null || (typeof value === 'number' && Number.isFinite(value)); }
function planProgressionPrescribedFromSet(set) {
  return { repsType:set.repsType || '', reps:set.reps == null ? null : set.reps, minReps:set.minReps == null ? null : set.minReps,
    maxReps:set.maxReps == null ? null : set.maxReps, timeType:set.timeType || '', seconds:set.seconds == null ? null : set.seconds,
    minSeconds:set.minSeconds == null ? null : set.minSeconds, maxSeconds:set.maxSeconds == null ? null : set.maxSeconds };
}

function planBuildProgressionBasis(verifiedReadResult, planAssignmentId) {
  if (!verifiedReadResult || verifiedReadResult.outcome !== 'verifiedCurrent') return {ok:false,reason:'notVerifiedCurrent'};
  var receipt = verifiedReadResult.verificationReceipt;
  if (!receipt || typeof receipt !== 'object') return {ok:false,reason:'missingVerificationReceipt'};
  if (!planProgressionId(receipt.headRevisionId)) return {ok:false,reason:'missingHeadRevisionId'};
  if (!verifiedReadResult.profileView || typeof verifiedReadResult.profileView !== 'object') return {ok:false,reason:'notVerifiedCurrent'};
  if (verifiedReadResult.profileView.templateSubjectId !== receipt.templateId) return {ok:false,reason:'templateIdentityMismatch'};
  var found=[];
  (verifiedReadResult.profileView.microcycles || []).forEach(function(mc){ (mc.sessions || []).forEach(function(session){
    (session.assignments || []).forEach(function(a){ if (a.assignmentSubjectId === planAssignmentId) found.push({session:session,assignment:a}); });
  }); });
  if (!found.length) return {ok:false,reason:'assignmentNotFound'};
  if (found.length !== 1) return {ok:false,reason:'duplicateAssignment'};
  var a=found[0].assignment, rules=a.rules || [];
  if (!rules.length) return {ok:false,reason:'noApplicableRule'};
  if (rules.length !== 1) return {ok:false,reason:'multipleApplicableRules'};
  var rule=rules[0];
  var basis={ownerUid:receipt.ownerUid,planTemplateId:receipt.templateId,headRevisionId:receipt.headRevisionId,
    planSessionId:found[0].session.sessionId,planAssignmentId:a.assignmentSubjectId,planRuleId:rule.ruleSubjectId,
    ruleRevisionId:rule.ruleRevisionId,adjustmentType:rule.adjustmentType,exerciseId:a.exerciseId,
    planPrescriptionId:a.prescriptionSubjectId,orderedSets:(a.sets || []).map(function(s){return {planSetId:s.setSubjectId,prescribed:planProgressionPrescribedFromSet(s)};})};
  return {ok:true,basis:planDeepFreeze(planDeepClone(basis))};
}

// ---- planBuildProgressionBasisFromEditSession(editSessionResult, planAssignmentId) ----
// Production-integration correction (independent pre-activation browser/
// emulator review). The confirmed blocker: the real public canonical
// reader (fsPlanReadCanonicalTemplate) always calls readCanonicalTemplate
// in 'editSession' mode, returning { outcome, draft, canonicalBase,
// readerState } -- with the verified evidence nested inside canonicalBase
// (canonicalBase.verificationReceipt, canonicalBase.canonicalGraph).
// planBuildProgressionBasis above expects a DIFFERENT, top-level shape
// ({ outcome, verificationReceipt, profileView }) -- the shape a direct
// mode:'profile' call would return, which no real progression-boot caller
// ever actually receives. Feeding the real edit-session result straight
// into planBuildProgressionBasis therefore always failed with
// missingVerificationReceipt, regardless of how genuinely valid the
// underlying canonical data was.
//
// Fix, smallest-clear-design: adapt the one already-computed, already-
// verified piece of evidence the edit-session result was missing at its
// top level. planBuildCanonicalTemplateEditSession (above) now also
// exposes canonicalBase.profileView -- the exact planBuildCanonicalTemplateProfile
// output it already computed internally, from the SAME verified graph, to
// build `draft` -- so this adapter only needs to re-nest two already-
// verified fields into the shape planBuildProgressionBasis has always
// accepted. planBuildProgressionBasis itself is completely UNCHANGED: no
// existing accepted call site (or test) that already hand-builds a
// { outcome, verificationReceipt, profileView } object is affected.
//
// No second Firestore read, no second reader-suite invocation, no relaxed
// validation: canonicalBase.verificationReceipt/profileView are the exact
// same already-verified objects the real transaction produced once. A
// non-verifiedCurrent (or shape-incomplete) edit-session result is passed
// through UNCHANGED, so planBuildProgressionBasis's own existing
// `!== 'verifiedCurrent'` / missing-field checks classify it exactly as
// they always have -- this adapter adds no new failure path and weakens
// no existing one.
function planBuildProgressionBasisFromEditSession(editSessionResult, planAssignmentId) {
  var adapted = (editSessionResult && editSessionResult.outcome === 'verifiedCurrent' && editSessionResult.canonicalBase && typeof editSessionResult.canonicalBase === 'object')
    ? {outcome: editSessionResult.outcome, verificationReceipt: editSessionResult.canonicalBase.verificationReceipt, profileView: editSessionResult.canonicalBase.profileView}
    : editSessionResult;
  return planBuildProgressionBasis(adapted, planAssignmentId);
}

function planValidateProgressionBasis(basis) {
  if (!planProgressionOwnKeysExactly(basis, PLAN_PROGRESSION_BASIS_KEYS) || !Array.isArray(basis.orderedSets)) return {ok:false,reason:'malformedBasisShape'};
  var ids=['ownerUid','planTemplateId','headRevisionId','planSessionId','planAssignmentId','planRuleId','ruleRevisionId','exerciseId','planPrescriptionId'];
  if (ids.some(function(k){return !planProgressionId(basis[k]);}) || !['addLoad','increaseTM'].includes(basis.adjustmentType) || !basis.orderedSets.length) return {ok:false,reason:'malformedBasisShape'};
  var seen={};
  for(var i=0;i<basis.orderedSets.length;i++){
    var item=basis.orderedSets[i];
    if(!planProgressionOwnKeysExactly(item,['planSetId','prescribed']) || !planProgressionId(item.planSetId) || !planProgressionOwnKeysExactly(item.prescribed,PLAN_PROGRESSION_PRESCRIBED_KEYS)) return {ok:false,reason:'malformedBasisShape'};
    if(seen[item.planSetId]) return {ok:false,reason:'duplicateBasisSetId'}; seen[item.planSetId]=true;
    for(var n of ['reps','minReps','maxReps','seconds','minSeconds','maxSeconds']) if(!planProgressionFiniteOrNull(item.prescribed[n])) return {ok:false,reason:'nonFiniteNumber'};
    if(typeof item.prescribed.repsType!=='string'||typeof item.prescribed.timeType!=='string') return {ok:false,reason:'malformedBasisShape'};
  }
  return {ok:true};
}

function planValidateProgressionEvaluationInput(rule,evidence,basis) {
  var bv=planValidateProgressionBasis(basis); if(!bv.ok)return bv;
  var ruleKeys=['adjustmentType','enabled','evaluationType','failBehavior','gatewaySetIndex','loadIncrease','planRuleId','ruleRevisionId','tmIncrease'];
  if(!planProgressionOwnKeysExactly(rule,ruleKeys))return {ok:false,reason:'malformedRuleShape'};
  var evidenceKeys=['exerciseId','headRevisionId','ownerUid','planAssignmentId','planRuleId','planSessionId','planTemplateId','setPairs','workoutId'];
  if(!planProgressionOwnKeysExactly(evidence,evidenceKeys)||!Array.isArray(evidence.setPairs))return {ok:false,reason:'malformedEvidenceShape'};
  // Correction round 1 (finding 2): workoutId was previously only required
  // to be a present own key -- never actually validated as a bounded,
  // path-safe identifier -- before being combined with planRuleId into a
  // Firestore document id. It is now checked here, in the zero-I/O
  // structural phase, exactly like every other evidence identifier.
  if(!planProgressionId(evidence.workoutId))return {ok:false,reason:'malformedEvidenceShape'};
  if(![rule.loadIncrease,rule.tmIncrease].every(function(v){return typeof v==='number'&&Number.isFinite(v);}) || !Number.isInteger(rule.gatewaySetIndex))return {ok:false,reason:'nonFiniteNumber'};
  var comparisons={planRuleId:[basis.planRuleId,rule.planRuleId,evidence.planRuleId],ruleRevisionId:[basis.ruleRevisionId,rule.ruleRevisionId],planTemplateId:[basis.planTemplateId,evidence.planTemplateId],headRevisionId:[basis.headRevisionId,evidence.headRevisionId],planSessionId:[basis.planSessionId,evidence.planSessionId],planAssignmentId:[basis.planAssignmentId,evidence.planAssignmentId],exerciseId:[basis.exerciseId,evidence.exerciseId],adjustmentType:[basis.adjustmentType,rule.adjustmentType]};
  for(var field in comparisons)if(comparisons[field].some(function(v){return v!==comparisons[field][0];}))return {ok:false,reason:'identityMismatch',details:{field:field}};
  var byId={}; basis.orderedSets.forEach(function(x){byId[x.planSetId]=x;}); var seen={};
  for(var i=0;i<evidence.setPairs.length;i++){var pair=evidence.setPairs[i];
    if(!planProgressionOwnKeysExactly(pair,['performed','planSetId','prescribed'])||!planProgressionId(pair.planSetId)||!planProgressionOwnKeysExactly(pair.prescribed,PLAN_PROGRESSION_PRESCRIBED_KEYS)||!planProgressionOwnKeysExactly(pair.performed,['completed','reps','seconds']))return {ok:false,reason:'malformedEvidenceShape'};
    if(seen[pair.planSetId])return {ok:false,reason:'duplicateSetId'};seen[pair.planSetId]=true;
    if(!byId[pair.planSetId])return {ok:false,reason:'foreignSetId'};
    if(!planDeepEqual(pair.prescribed,byId[pair.planSetId].prescribed))return {ok:false,reason:'prescribedValueMismatch'};
    if(typeof pair.performed.completed!=='boolean'||!planProgressionFiniteOrNull(pair.performed.reps)||!planProgressionFiniteOrNull(pair.performed.seconds))return {ok:false,reason:'malformedEvidenceShape'};
  }
  for(var id in byId)if(!seen[id])return {ok:false,reason:'missingCommittedSet'};
  return {ok:true};
}

function planProgressionThreshold(p){if(p.repsType==='fixed'&&p.reps!=null)return {mode:'reps',value:p.reps};if(p.repsType==='range'&&p.minReps!=null)return {mode:'reps',value:p.minReps};if(p.timeType==='fixed'&&p.seconds!=null)return {mode:'seconds',value:p.seconds};if(p.timeType==='range'&&p.minSeconds!=null)return {mode:'seconds',value:p.minSeconds};return null;}
function planEvaluateCanonicalProgression(rule,currentValue,evidence,basis){
  var ordered=basis.orderedSets.map(function(s){var e=evidence.setPairs.find(function(x){return x.planSetId===s.planSetId;});return {p:s.prescribed,a:e.performed};});
  function passed(x){var t=planProgressionThreshold(x.p);return t&&x.a.completed&&x.a[t.mode]!=null&&x.a[t.mode]>=t.value;}
  var evaluable=ordered.filter(function(x){return !!planProgressionThreshold(x.p);}); if(!evaluable.length)return {decision:'notEvaluable'};
  var ok;
  if(rule.evaluationType==='gateway'){var x=ordered[rule.gatewaySetIndex];if(!x||!planProgressionThreshold(x.p))return {decision:'notEvaluable'};ok=!!passed(x);}
  else if(rule.evaluationType==='volume'){var mode=planProgressionThreshold(evaluable[0].p).mode;if(evaluable.some(function(x){return planProgressionThreshold(x.p).mode!==mode;}))return {decision:'notEvaluable'};var target=evaluable.reduce(function(s,x){return s+planProgressionThreshold(x.p).value;},0);var actual=evaluable.reduce(function(s,x){return s+(x.a.completed&&x.a[mode]!=null?x.a[mode]:0);},0);ok=actual>=target;}
  else ok=evaluable.every(passed);
  var amount=rule.adjustmentType==='increaseTM'?rule.tmIncrease:rule.loadIncrease;
  return {decision:ok?'passed':'failed',nextValue:{kind:currentValue.kind,amount:ok?Math.round((currentValue.amount+amount)*1000000)/1000000:currentValue.amount,unit:currentValue.unit}};
}

function planSuggestProgressionInitialValueFromHistory(workouts,exerciseId,kind,unit){
  if(!Array.isArray(workouts)||!planProgressionId(exerciseId))return {outcome:'noHistory'};
  for(var wi=workouts.length-1;wi>=0;wi--){var matches=(workouts[wi].exercises||[]).filter(function(e){return e.exerciseId===exerciseId;});if(matches.length>1)return {outcome:'ambiguousDuplicate'};if(matches.length===1){var values=[];(matches[0].sets||[]).forEach(function(s){var v=Number(s.weight);if(s.completed&&Number.isFinite(v))values.push(v);});if(values.length)return {outcome:'suggestion',kind:kind,amount:Math.max.apply(null,values),unit:unit};}}
  return {outcome:'noHistory'};
}

// Correction round 1 (finding 4): a pure, read-only adapter from ONE real
// logger-shaped workout (the exact shape app-core.js's finishWorkout/
// addExToWorkout/planSetToLoggerSet build and fsSaveWorkout persists --
// {id, exercises:[{exerciseId, sets:[{weight,reps,time,rpe,completed,...}]}]})
// into the exact canonical evaluation-evidence structure
// planValidateProgressionEvaluationInput already requires. The real logger
// stores performed set duration under `time` (a form-input string); the
// existing, already-accepted evaluator/evidence contract uses `seconds`
// (app-plan.js:10421's own `performed:['completed','reps','seconds']`
// shape, exercised by 1,255 already-passing tests) -- rather than touching
// that accepted contract or the evaluator, this adapter performs the one
// explicit `time -> seconds` conversion, per the review's own first option
// ("retain performed.seconds ... explicitly convert logger time -> seconds").
// Canonical identities and prescribed values come exclusively from the
// verified `basis` (never from the workout/history) -- matching by
// `exerciseId` only, never by name, and rejecting (never guessing) every
// ambiguous or malformed case: missing exercise, duplicate occurrences,
// missing/extra sets relative to the basis, non-boolean `completed`, or a
// non-numeric `reps`/`time` value that isn't simply blank. It never mutates
// its inputs and performs no I/O of any kind; durable workout stamping
// remains deferred (unchanged from every prior round).
function planProgressionParseLoggedNumber(raw){
  if(raw===''||raw===null||raw===undefined)return null;
  if(typeof raw!=='string'&&typeof raw!=='number')return undefined;
  var n=Number(raw);
  return Number.isFinite(n)?n:undefined;
}
function planBuildProgressionEvidenceFromWorkout(workout,basis){
  var bv=planValidateProgressionBasis(basis);if(!bv.ok)return {ok:false,reason:bv.reason};
  if(!workout||typeof workout!=='object'||!planProgressionId(workout.id)||!Array.isArray(workout.exercises))return {ok:false,reason:'malformedWorkoutShape'};
  var matches=workout.exercises.filter(function(e){return e&&e.exerciseId===basis.exerciseId;});
  if(matches.length===0)return {ok:false,reason:'missingExercise'};
  if(matches.length>1)return {ok:false,reason:'ambiguousDuplicate'};
  var loggedSets=matches[0].sets;
  if(!Array.isArray(loggedSets))return {ok:false,reason:'malformedWorkoutShape'};
  if(loggedSets.length<basis.orderedSets.length)return {ok:false,reason:'missingSets'};
  if(loggedSets.length>basis.orderedSets.length)return {ok:false,reason:'extraSets'};
  var setPairs=[];
  for(var i=0;i<basis.orderedSets.length;i++){
    var canon=basis.orderedSets[i],logged=loggedSets[i];
    if(!logged||typeof logged!=='object'||typeof logged.completed!=='boolean')return {ok:false,reason:'malformedPerformedValue'};
    var reps=planProgressionParseLoggedNumber(logged.reps);if(reps===undefined)return {ok:false,reason:'malformedPerformedValue'};
    var seconds=planProgressionParseLoggedNumber(logged.time);if(seconds===undefined)return {ok:false,reason:'malformedPerformedValue'};
    setPairs.push({planSetId:canon.planSetId,prescribed:canon.prescribed,performed:{completed:logged.completed,reps:reps,seconds:seconds}});
  }
  var evidence={ownerUid:basis.ownerUid,workoutId:workout.id,planTemplateId:basis.planTemplateId,headRevisionId:basis.headRevisionId,planSessionId:basis.planSessionId,planAssignmentId:basis.planAssignmentId,planRuleId:basis.planRuleId,exerciseId:basis.exerciseId,setPairs:setPairs};
  return {ok:true,evidence:planDeepFreeze(planDeepClone(evidence))};
}

// Manual progression-state controller. It deliberately has no automatic
// workout-completion hook: history may suggest a number, but only this
// explicit user action can initialize or correct authoritative state.
var PLAN_PROGRESSION_MANUAL_CONTAINER_ID='plan-progression-manual-state';
var planProgressionManualState=null;
function planProgressionManualBoot(ctx,basis){
  if(!ctx||typeof ctx.readState!=='function'||typeof ctx.setManualState!=='function')throw new Error('Progression manual context is incomplete.');
  var bv=planValidateProgressionBasis(basis);if(!bv.ok)throw new Error('Progression basis is invalid: '+bv.reason);
  planProgressionManualState={ctx:ctx,basis:basis,mode:'initialize',amount:'',unit:'lb',initializationSource:'manual',expectedUpdatedAt:null,currentState:null,outcome:null,busy:false,suggestion:null};
  planProgressionManualRender();return planProgressionManualState;
}
function planProgressionManualGetState(){return planProgressionManualState;}
function planProgressionManualSetAmount(raw){if(!planProgressionManualState||planProgressionManualState.busy)return;planProgressionManualState.amount=raw;planProgressionManualRender();}
function planProgressionManualSetUnit(unit){if(!planProgressionManualState||planProgressionManualState.busy||!['lb','kg'].includes(unit))return;planProgressionManualState.unit=unit;planProgressionManualRender();}
// Correction round 2 (finding 4a): the controller can now RECEIVE a
// non-authoritative history suggestion and display it, separately from the
// authoritative amount/unit fields, without applying it. Displaying a
// suggestion performs no write of any kind -- it only sets local UI state
// and re-renders. Only a real rendered "Use suggested value" control (see
// planProgressionManualRender below) invokes planProgressionManualUseSuggestion.
function planProgressionManualSetSuggestion(suggestion){
  if(!planProgressionManualState||planProgressionManualState.busy)return;
  planProgressionManualState.suggestion=(suggestion&&suggestion.outcome==='suggestion')?suggestion:null;
  planProgressionManualRender();
}
// Correction round 2 (finding 4a): now callable with NO argument (the real
// rendered "Use suggested value" button's onclick calls it this way),
// reading the currently-displayed st.suggestion -- while remaining fully
// backward compatible with the pre-existing explicit-argument call shape
// (plan-slice5b-progression.test.js's own "manual controller requires
// explicit save after a suggestion" test, unrelated to this correction
// round, still calls it with an explicit suggestion object). Confirming a
// suggestion this way still performs no write -- only a subsequent, real
// Save click invokes setManualState.
function planProgressionManualUseSuggestion(suggestion){
  var st=planProgressionManualState;
  var s=suggestion!==undefined?suggestion:(st&&st.suggestion);
  if(!st||st.busy||!s||s.outcome!=='suggestion')return false;
  st.amount=String(s.amount);st.unit=s.unit;st.initializationSource='confirmedFromSuggestion';
  planProgressionManualRender();return true;
}
// Correction round 2 (finding 1): the real progression persistence
// functions throw CanonicalProgressionWriterDisabledError (a real,
// shared class -- firebase-plan-progression.js:15, exported as one of the
// five frozen fsPlanProgressionPersistence keys) while the progression
// capability is off. This classifies a caught error as exactly that
// condition, preferring `instanceof` against the real class -- reachable
// here as the bare identifier `fsPlanProgressionPersistence` shares
// firebase-plan-progression.js's own lexical/global scope, exactly like
// the bare `auth` identifier finding 1's Round 1 correction already
// established, and is realm-safe because app-plan.js and
// firebase-plan-progression.js always share one realm (one classic-script
// global scope in the real browser; one `global` object under plain
// require() in Node) -- with a stable `.name` fallback for the
// hypothetical case where `fsPlanProgressionPersistence` is not yet
// defined (e.g. a hand-wired ctx used without loading that file at all).
// Message text is never inspected.
function planProgressionManualIsDisabledError(e) {
  if (!e) return false;
  if (typeof fsPlanProgressionPersistence !== 'undefined' && fsPlanProgressionPersistence &&
      typeof fsPlanProgressionPersistence.CanonicalProgressionWriterDisabledError === 'function' &&
      e instanceof fsPlanProgressionPersistence.CanonicalProgressionWriterDisabledError) return true;
  return e.name === 'CanonicalProgressionWriterDisabledError';
}
async function planProgressionManualRead(){
  var st=planProgressionManualState;if(!st||st.busy)return {outcome:'ignored'};
  st.busy=true;
  try{
    var result=await st.ctx.readState(st.basis.planRuleId);
    if(planProgressionManualState!==st)return {outcome:'ignored',reason:'stateReplaced'};
    st.outcome=result;
    if(result.outcome==='success'){st.currentState=result.state;st.expectedUpdatedAt=result.expectedUpdatedAt;st.mode='correct';st.amount=String(result.state.currentValue.amount);st.unit=result.state.currentValue.unit;}
    return result;
  }catch(e){
    // Correction round 2 (finding 1): Read previously had no catch at all,
    // so a disabled capability produced an unhandled rejection instead of
    // an honest, visible outcome. Only the disabled condition is
    // reclassified here -- any other, genuinely unclassified failure still
    // propagates exactly as before (Read never had an `uncertain` bucket,
    // and none is added by this correction).
    if(planProgressionManualIsDisabledError(e)){st.outcome={outcome:'disabled'};return st.outcome;}
    throw e;
  }finally{if(planProgressionManualState===st){st.busy=false;planProgressionManualRender();}}
}
async function planProgressionManualSave(){
  var st=planProgressionManualState;if(!st||st.busy)return {outcome:'ignored'};
  var amount=Number(st.amount);if(st.amount===''||!Number.isFinite(amount)){st.outcome={outcome:'invalidInput',reason:'nonFiniteNumber'};planProgressionManualRender();return st.outcome;}
  st.busy=true;
  try{
    var input={mode:st.mode,planRuleId:st.basis.planRuleId,kind:st.basis.adjustmentType==='addLoad'?'workingLoad':'trainingMax',amount:amount,unit:st.unit,initializationSource:st.initializationSource,expectedUpdatedAt:st.mode==='initialize'?null:st.expectedUpdatedAt,schemaVersion:1};
    var result=await st.ctx.setManualState(input,st.basis);
    if(planProgressionManualState!==st)return {outcome:'ignored',reason:'stateReplaced'};
    st.outcome=result;
    if(result.outcome==='success'){st.currentState=result.state;st.expectedUpdatedAt=result.expectedUpdatedAt;st.mode='correct';st.amount=String(result.state.currentValue.amount);st.unit=result.state.currentValue.unit;}
    return result;
  }catch(e){
    // Correction round 2 (finding 1): the disabled condition is now
    // distinguished from every other, genuinely unclassified failure --
    // it must never be folded into the generic `uncertain` bucket, which
    // is preserved unchanged for anything else this catch receives.
    if(planProgressionManualIsDisabledError(e)){st.outcome={outcome:'disabled'};return st.outcome;}
    st.outcome={outcome:'uncertain'};
    return st.outcome;
  }finally{if(planProgressionManualState===st){st.busy=false;planProgressionManualRender();}}
}
function planProgressionManualOutcomeLabel(o){if(!o)return '';return {success:'Saved',notInitialized:'Not initialized',conflict:'Changed elsewhere — read again',stateIntegrityConflict:'Stored progression data needs attention',applicationRecordIntegrityConflict:'Stored progression data needs attention',needsManualReview:'Program changed — review required',savedButRefreshFailed:'Saved, but refresh failed — read again',uncertain:'Outcome unknown — read before trying again',disabled:'Progression saving is disabled',invalidInput:'Check the entered value'}[o.outcome]||o.outcome;}
// Correction round 1 (finding 6): creates its own container on demand,
// exactly like the already-accepted Slice 5A canonical editor's own
// renderer does (planCanonicalEditorRender, app-plan.js:10070-10079) --
// so this hidden dev/test entry mounts real markup into a real DOM
// container without requiring any change to index.html.
function planProgressionManualRender(){
  if(typeof document==='undefined'||!planProgressionManualState)return;
  var root=document.getElementById(PLAN_PROGRESSION_MANUAL_CONTAINER_ID);
  if(!root){root=document.createElement('div');root.id=PLAN_PROGRESSION_MANUAL_CONTAINER_ID;document.body.appendChild(root);}
  var st=planProgressionManualState,disabled=st.busy?'disabled':'';
  // Correction round 2 (finding 4a): a non-authoritative suggestion (when
  // present) renders as its own labeled block, distinct from the
  // authoritative Amount/Unit fields below it -- it is never pre-filled
  // into those fields merely by being displayed. Only the real "Use
  // suggested value" button's onclick (a bare, zero-arg call so a real
  // dispatched click naturally reads the currently-displayed suggestion,
  // never a hand-typed argument) applies it, and even then performs no
  // write -- only a subsequent Save click does.
  var suggestionHtml=st.suggestion?('<div class="plan-progression-manual-suggestion"><span data-testid="progression-manual-suggestion-value">Suggested (not yet saved): '+escapeHtml(String(st.suggestion.amount))+' '+escapeHtml(st.suggestion.unit)+'</span> <button data-testid="progression-manual-use-suggestion" '+disabled+' onclick="planProgressionManualUseSuggestion()">Use suggested value</button></div>'):'';
  root.innerHTML='<div class="plan-progression-manual"><h3>Progression starting value</h3><div data-testid="progression-manual-outcome">'+escapeHtml(planProgressionManualOutcomeLabel(st.outcome))+'</div>'+suggestionHtml+'<label>Amount<input data-testid="progression-manual-amount" type="number" step="any" '+disabled+' value="'+escapeHtml(st.amount)+'" oninput="planProgressionManualSetAmount(this.value)"></label><label>Unit<select data-testid="progression-manual-unit" '+disabled+' onchange="planProgressionManualSetUnit(this.value)"><option value="lb" '+(st.unit==='lb'?'selected':'')+'>lb</option><option value="kg" '+(st.unit==='kg'?'selected':'')+'>kg</option></select></label><button data-testid="progression-manual-save" '+disabled+' onclick="planProgressionManualSave()">'+(st.mode==='initialize'?'Set starting value':'Save correction')+'</button><button data-testid="progression-manual-read" '+disabled+' onclick="planProgressionManualRead()">Read current value</button></div>';}

// ---- Hidden development/test entry point (correction round 1, finding 6) ----
// Mirrors the already-accepted Slice 5A canonical-editor entry exactly
// (app-core.js:223-236 / app-plan.js PLAN_CANONICAL_EDITOR_DEV_QUERY_PARAM):
// a URL query parameter nothing else in the app ever sets or reads,
// checked once by app-core.js only after full boot and real authentication
// have both completed. No nav button, no showPage() case -- a normal user
// who never adds this exact parameter to the URL never triggers it. It
// obtains owner identity from the real authenticated session (the same
// bare `auth` binding finding 1 corrects firebase-plan-progression.js's
// own production deps to use), a genuine 'verifiedCurrent' canonical read
// through the existing, still-disabled accepted reader, and builds the
// basis through the real planBuildProgressionBasis. Correction round 3:
// while either capability is disabled (both hardcoded false in
// production), this entry wires itself up but performs no database I/O --
// but the two gates fail in TWO DIFFERENT SHAPES, not one uniform
// {outcome:'disabled'} return value: the progression capability's real
// functions THROW CanonicalProgressionWriterDisabledError synchronously
// (see planProgressionManualIsDisabledError below), while the canonical
// reader's disabled path REJECTS the returned promise with a differently-
// typed CanonicalPlanReaderDisabledError (firebase.js's
// dispatchCanonicalTemplateRead). Both are caught below, independently,
// and turned into the same visible, honest disabled outcome.
var PLAN_PROGRESSION_MANUAL_DEV_QUERY_PARAM = 'slice5bProgressionManual';
function planProgressionManualDevBuildProductionCtx(){
  var uid=(typeof auth!=='undefined'&&auth.currentUser&&auth.currentUser.uid)||null;
  planCanonicalAdapterRequire(typeof uid==='string'&&!!uid,'planProgressionManualDevBoot: no authenticated user -- must never boot before real authentication resolves');
  return {
    ownerUid:uid,
    readCanonicalTemplate:function(input){return fsPlanPersistence.fsPlanReadCanonicalTemplate(input);},
    initReferences:function(input){return fsPlanProgressionPersistence.fsPlanProgressionInitReferences(input);},
    readState:function(planRuleId){return fsPlanProgressionPersistence.fsPlanProgressionReadState(planRuleId);},
    setManualState:function(input,basis){return fsPlanProgressionPersistence.fsPlanProgressionSetManualState(input,basis);}
  };
}
// Correction round 3 (finding 1): classifies the canonical reader's OWN
// disabled error -- a genuinely different type from progression's
// CanonicalProgressionWriterDisabledError above. firebase.js's
// CanonicalPlanReaderDisabledError is never exposed on the accepted
// eight-key fsPlanPersistence browser surface (only the writer side's
// CanonicalPlanWriterDisabledError is), so `instanceof` is not reachable
// here even though both files share one realm -- its stable `.name`/
// `.code` are the only identity this error exposes across that boundary.
// Message text is never inspected.
function planProgressionManualIsCanonicalReadDisabledError(e) {
  return !!e && (e.name === 'CanonicalPlanReaderDisabledError' || e.code === 'CANONICAL_PLAN_READER_DISABLED');
}
// Correction round 3 (finding 1): mounts the disabled outcome into the REAL
// manual-progression container/state (PLAN_PROGRESSION_MANUAL_CONTAINER_ID /
// planProgressionManualState / planProgressionManualRender) -- replacing
// round 2's separate small "entry" container, which independent review
// correctly found did not satisfy "mount the manual progression UI." No
// basis is required: planProgressionManualRender never reads state.basis.
// `busy: true` is set permanently (never cleared by this path) so the
// rendered Amount/Unit/Save/Read controls render HTML-disabled, and --
// more importantly -- planProgressionManualRead/Save's own top-line guard
// (`if (!st || st.busy) return {outcome:'ignored'}`) makes a stray
// dispatched click a safe no-op rather than a crash on the null basis/ctx
// below, without this function needing to fabricate a fake basis.
function planProgressionManualBootDisabled(outcome) {
  planProgressionManualState = {ctx:null, basis:null, mode:'initialize', amount:'', unit:'lb', initializationSource:'manual', expectedUpdatedAt:null, currentState:null, outcome:outcome, busy:true, suggestion:null};
  planProgressionManualRender();
  return planProgressionManualState;
}
async function planProgressionManualDevBoot(templateId,planAssignmentId,ctxOverride){
  var ctx=(ctxOverride&&typeof ctxOverride==='object')?ctxOverride:planProgressionManualDevBuildProductionCtx();
  if(typeof templateId!=='string'||!templateId||typeof planAssignmentId!=='string'||!planAssignmentId){
    return {outcome:'invalidInput',reason:'missingTargetIdentity'};
  }
  // Correction round 2 (finding 2), corrected round 3: fsPlanProgressionInitReferences
  // throws CanonicalProgressionWriterDisabledError synchronously while the
  // progression capability is off (real production: always). This is
  // caught, classified, and turned into an honest, visibly rendered
  // disabled result -- mounted into the REAL manual-progression
  // container/state via planProgressionManualBootDisabled above (round 3:
  // no longer a separate small container), since no real basis exists yet
  // to boot the full controller's normal path with. Neither capability
  // gate is bypassed to get here: initReferences is still the REAL,
  // unmodified, disabled-checking function.
  var initResult;
  try{
    initResult=ctx.initReferences({ownerUid:ctx.ownerUid});
  }catch(e){
    if(planProgressionManualIsDisabledError(e)){planProgressionManualBootDisabled({outcome:'disabled'});return {outcome:'disabled'};}
    throw e;
  }
  if(!initResult||initResult.outcome!=='success')return {outcome:'initFailed',result:initResult};
  // Correction round 3 (finding 1): if progression's own gate reports
  // success (either genuinely enabled, or an isolated test seam) but the
  // canonical reader's independent gate is still disabled -- the real
  // production combination, since progression is disabled too, always
  // reaches this exact same disabled rejection -- fsPlanReadCanonicalTemplate
  // REJECTS with CanonicalPlanReaderDisabledError instead of resolving.
  // This was previously uncaught here, so it propagated as an unhandled
  // rejection past this function's own returned promise, silently
  // swallowed by app-core.js's own `.catch(err => console.error(...))`
  // with no UI ever shown. It is now caught and classified the same
  // honest way as the init-disabled case above, mounting the same real
  // disabled UI -- and still zero canonical database I/O, since
  // dispatchCanonicalTemplateRead's disabled gate throws before any
  // registry/Firestore access.
  var readResult;
  try{
    readResult=await ctx.readCanonicalTemplate({ownerUid:ctx.ownerUid,templateId:templateId});
  }catch(e){
    if(planProgressionManualIsCanonicalReadDisabledError(e)){planProgressionManualBootDisabled({outcome:'disabled'});return {outcome:'disabled'};}
    throw e;
  }
  if(!readResult||readResult.outcome!=='verifiedCurrent')return {outcome:'readFailed',result:readResult};
  // Production-integration correction: readResult is the REAL public
  // reader's actual result shape ({outcome,draft,canonicalBase,readerState}
  // -- always 'editSession' mode, see fsPlanReadCanonicalTemplate above),
  // never the {outcome,verificationReceipt,profileView} shape a direct
  // mode:'profile' call would produce. planBuildProgressionBasisFromEditSession
  // adapts the former into the latter using evidence already verified in
  // this same read (see its own definition above) -- no second read, no
  // relaxed validation.
  var basisResult=planBuildProgressionBasisFromEditSession(readResult,planAssignmentId);
  if(!basisResult.ok)return {outcome:'basisFailed',reason:basisResult.reason};
  planProgressionManualBoot({readState:ctx.readState,setManualState:ctx.setManualState},basisResult.basis);
  return {outcome:'booted',basis:basisResult.basis};
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    // Collection/path table (00-collections.js)
    PLAN_COLLECTION_MAP: PLAN_COLLECTION_MAP,
    PLAN_SYSTEM_COLLECTIONS: PLAN_SYSTEM_COLLECTIONS,
    PLAN_SCHEMA_AUTHORITY_PATH: PLAN_SCHEMA_AUTHORITY_PATH,
    PLAN_SERVER_TIMESTAMP_SENTINEL: PLAN_SERVER_TIMESTAMP_SENTINEL,
    PLAN_CANONICAL_ENCODING_VERSION: PLAN_CANONICAL_ENCODING_VERSION,
    PLAN_SCHEMA_VERSION: PLAN_SCHEMA_VERSION,
    planCollectionInfoForSubjectRecordType: planCollectionInfoForSubjectRecordType,
    planSubjectPath: planSubjectPath,
    planRevisionPath: planRevisionPath,
    planRevisionRecordTypeForSubjectRecordType: planRevisionRecordTypeForSubjectRecordType,
    planSystemPath: planSystemPath,
    // Deep utilities (09-deep-utils.js)
    planDeepFreeze: planDeepFreeze,
    planDeepClone: planDeepClone,
    planDeepEqual: planDeepEqual,
    // SHA-256
    planSha256Hex: planSha256Hex,
    // Canonical encoding / hashing
    planBuildCanonicalEncoding: planBuildCanonicalEncoding,
    PlanCanonicalEncodingError: PlanCanonicalEncodingError,
    planIsPlainObject: planIsPlainObject,
    // Identity
    planEnsureDraftIdentities: planEnsureDraftIdentities,
    planDefaultIdAllocator: planDefaultIdAllocator,
    planDeepClonePlain: planDeepClonePlain,
    // Normalization
    planNormalizeCanonicalGraph: planNormalizeCanonicalGraph,
    planNormalizeAbsent: planNormalizeAbsent,
    planNormalizeNumberField: planNormalizeNumberField,
    PlanCanonicalNormalizationError: PlanCanonicalNormalizationError,
    // Manifest
    planBuildGraphManifest: planBuildGraphManifest,
    planBuildManifestChunkDocumentData: planBuildManifestChunkDocumentData,
    PLAN_REVISIONED_RECORD_TYPES: PLAN_REVISIONED_RECORD_TYPES,
    PLAN_RESOLUTION_RECORD_TYPE_PRIORITY: PLAN_RESOLUTION_RECORD_TYPE_PRIORITY,
    PLAN_MANIFEST_MAX_ENTRIES_PER_CHUNK: PLAN_MANIFEST_MAX_ENTRIES_PER_CHUNK,
    PLAN_MANIFEST_MAX_CHUNK_BYTES: PLAN_MANIFEST_MAX_CHUNK_BYTES,
    PLAN_HASH_PLACEHOLDER: PLAN_HASH_PLACEHOLDER,
    planComputeCanonicalWriteSetHash: planComputeCanonicalWriteSetHash,
    // Commitment package
    planBuildTemplateCommitPackage: planBuildTemplateCommitPackage,
    PLAN_V1_SAFETY_CAPS: PLAN_V1_SAFETY_CAPS,
    planNamedDependencyFields: planNamedDependencyFields,
    planBuildRevisionEnvelope: planBuildRevisionEnvelope,
    planBuildSystemEnvelope: planBuildSystemEnvelope,
    // Validation
    planValidateTemplateCommitReads: planValidateTemplateCommitReads,
    // Write plan
    planBuildTemplateCommitWrites: planBuildTemplateCommitWrites,
    PlanCommitBlockedError: PlanCommitBlockedError,
    // Verified readers and projection reconciliation (Slice 4)
    planValidateCanonicalTemplateRead: planValidateCanonicalTemplateRead,
    planBuildCanonicalTemplateProfile: planBuildCanonicalTemplateProfile,
    planBuildCanonicalTemplateEditSession: planBuildCanonicalTemplateEditSession,
    planClassifyEditSessionDirtyState: planClassifyEditSessionDirtyState,
    planClassifyTemplateSummaryProjection: planClassifyTemplateSummaryProjection,
    planBuildTemplateSummaryReconciliationBlueprint: planBuildTemplateSummaryReconciliationBlueprint,
    PLAN_READER_SEMANTIC_FIELDS: PLAN_READER_SEMANTIC_FIELDS,
    PLAN_READER_CHILD_RECORD_TYPES: PLAN_READER_CHILD_RECORD_TYPES,
    PLAN_READER_REVISION_TO_SUBJECT_RECORD_TYPE: PLAN_READER_REVISION_TO_SUBJECT_RECORD_TYPE,
    PLAN_READER_SUPPORTED_SCHEMA_VERSION: PLAN_READER_SUPPORTED_SCHEMA_VERSION,
    PLAN_READER_SUPPORTED_ENCODING_VERSION: PLAN_READER_SUPPORTED_ENCODING_VERSION,
    PLAN_READER_SUPPORTED_GENERATION: PLAN_READER_SUPPORTED_GENERATION,
    PLAN_READER_SUPPORTED_AUTHORITY_KIND: PLAN_READER_SUPPORTED_AUTHORITY_KIND,
    PLAN_READER_SUPPORTED_PROJECTION_DERIVATION_VERSION: PLAN_READER_SUPPORTED_PROJECTION_DERIVATION_VERSION,
    planReaderRecomputeChunkHash: planReaderRecomputeChunkHash,
    planReaderRecomputeManifestGraphHash: planReaderRecomputeManifestGraphHash,
    planReaderRecomputePayloadHash: planReaderRecomputePayloadHash,
    planReaderRecomputeDependencyHash: planReaderRecomputeDependencyHash,
    planReaderLooksLikeServerTimestamp: planReaderLooksLikeServerTimestamp,
    // Slice 5B pure progression logic
    PLAN_PROGRESSION_BASIS_KEYS: PLAN_PROGRESSION_BASIS_KEYS,
    planBuildProgressionBasis: planBuildProgressionBasis,
    // Production-integration correction: adapts the real public reader's
    // actual edit-session result shape into planBuildProgressionBasis's
    // existing contract -- see its own definition above.
    planBuildProgressionBasisFromEditSession: planBuildProgressionBasisFromEditSession,
    planValidateProgressionBasis: planValidateProgressionBasis,
    planValidateProgressionEvaluationInput: planValidateProgressionEvaluationInput,
    planEvaluateCanonicalProgression: planEvaluateCanonicalProgression,
    planSuggestProgressionInitialValueFromHistory: planSuggestProgressionInitialValueFromHistory,
    PLAN_PROGRESSION_MANUAL_CONTAINER_ID: PLAN_PROGRESSION_MANUAL_CONTAINER_ID,
    // Correction round 1 (finding 4): pure logger-workout evidence adapter
    planProgressionParseLoggedNumber: planProgressionParseLoggedNumber,
    planBuildProgressionEvidenceFromWorkout: planBuildProgressionEvidenceFromWorkout,
    // Correction round 1 (finding 6): hidden manual-UI dev/test entry point
    PLAN_PROGRESSION_MANUAL_DEV_QUERY_PARAM: PLAN_PROGRESSION_MANUAL_DEV_QUERY_PARAM,
    planProgressionManualDevBoot: planProgressionManualDevBoot,
    planProgressionManualBoot: planProgressionManualBoot,
    planProgressionManualGetState: planProgressionManualGetState,
    planProgressionManualSetAmount: planProgressionManualSetAmount,
    planProgressionManualSetUnit: planProgressionManualSetUnit,
    planProgressionManualUseSuggestion: planProgressionManualUseSuggestion,
    planProgressionManualRead: planProgressionManualRead,
    planProgressionManualSave: planProgressionManualSave,
    planProgressionManualOutcomeLabel: planProgressionManualOutcomeLabel,
    planProgressionManualRender: planProgressionManualRender,
    // Correction round 2 (finding 1): shared disabled-error classifier
    planProgressionManualIsDisabledError: planProgressionManualIsDisabledError,
    // Correction round 2 (finding 4a): non-authoritative suggestion display
    planProgressionManualSetSuggestion: planProgressionManualSetSuggestion,
    // Correction round 3 (finding 1): canonical-reader disabled-error
    // classifier, and the real-container disabled mount (replaces round
    // 2's separate small dormant-entry container, which is removed).
    planProgressionManualIsCanonicalReadDisabledError: planProgressionManualIsCanonicalReadDisabledError,
    planProgressionManualBootDisabled: planProgressionManualBootDisabled,
    // Correction round 2 (source review defect #2): staged-discovery gates
    planReaderGateSchemaAuthority: planReaderGateSchemaAuthority,
    planReaderGateTemplateSubjectForDiscovery: planReaderGateTemplateSubjectForDiscovery,
    planReaderGateTemplateRevisionForDiscovery: planReaderGateTemplateRevisionForDiscovery,
    planReaderGateOperationGatewayForDiscovery: planReaderGateOperationGatewayForDiscovery,
    planReaderGateManifestRootForDiscovery: planReaderGateManifestRootForDiscovery,
    planReaderGateManifestChunkForDiscovery: planReaderGateManifestChunkForDiscovery,
    planReaderGateManifestEntryForDiscovery: planReaderGateManifestEntryForDiscovery,
    // Slice 5A -- Canonical Program Editor production adapters/orchestration
    PLAN_CANONICAL_PROGRESSION_DEFAULTS: PLAN_CANONICAL_PROGRESSION_DEFAULTS,
    PLAN_CANONICAL_CLIENT_SCHEMA_GENERATION: PLAN_CANONICAL_CLIENT_SCHEMA_GENERATION,
    PlanCanonicalEditorAdapterError: PlanCanonicalEditorAdapterError,
    planNewCanonicalProgressionState: planNewCanonicalProgressionState,
    planAdaptEditorStateToCanonicalDraft: planAdaptEditorStateToCanonicalDraft,
    planAdaptCanonicalDraftToEditorState: planAdaptCanonicalDraftToEditorState,
    planBuildCommitBasis: planBuildCommitBasis,
    planSaveCanonicalTemplate: planSaveCanonicalTemplate,
    planReopenCanonicalTemplate: planReopenCanonicalTemplate,
    planClassifyCanonicalWriteError: planClassifyCanonicalWriteError,
    planClassifyCanonicalReadError: planClassifyCanonicalReadError,
    // Save-lifecycle correction -- build/commit split (requirement 2)
    planBuildCanonicalSaveAttempt: planBuildCanonicalSaveAttempt,
    planCommitCanonicalPackageAndClassify: planCommitCanonicalPackageAndClassify,
    // Slice 5A completion correction -- production canonical editor UI
    PLAN_CANONICAL_EDITOR_DEV_QUERY_PARAM: PLAN_CANONICAL_EDITOR_DEV_QUERY_PARAM,
    PLAN_CANONICAL_EDITOR_CONTAINER_ID: PLAN_CANONICAL_EDITOR_CONTAINER_ID,
    planCanonicalEditorFreshState: planCanonicalEditorFreshState,
    planCanonicalEditorGetState: planCanonicalEditorGetState,
    planResetCanonicalUserScopedState: planResetCanonicalUserScopedState,
    planCanonicalEditorBuildProductionCtx: planCanonicalEditorBuildProductionCtx,
    planCanonicalEditorBoot: planCanonicalEditorBoot,
    planCanonicalEditorHandleNew: planCanonicalEditorHandleNew,
    planCanonicalEditorHandleEnableProgression: planCanonicalEditorHandleEnableProgression,
    planCanonicalEditorHandleDisableProgression: planCanonicalEditorHandleDisableProgression,
    planCanonicalEditorHandleAddMicrocycle: planCanonicalEditorHandleAddMicrocycle,
    planCanonicalEditorHandleAddSession: planCanonicalEditorHandleAddSession,
    planCanonicalEditorHandleAddExercise: planCanonicalEditorHandleAddExercise,
    planCanonicalEditorHandleAddSet: planCanonicalEditorHandleAddSet,
    planCanonicalEditorHandleSave: planCanonicalEditorHandleSave,
    planCanonicalEditorHandleReopen: planCanonicalEditorHandleReopen,
    planCanonicalEditorHandleReopenLastSaved: planCanonicalEditorHandleReopenLastSaved,
    // Save-lifecycle correction -- retry/cancel and the shared post-commit handler
    planCanonicalEditorApplySaveResult: planCanonicalEditorApplySaveResult,
    planCanonicalEditorHandleRetrySave: planCanonicalEditorHandleRetrySave,
    planCanonicalEditorHandleCancelPendingSave: planCanonicalEditorHandleCancelPendingSave,
    planCanonicalEditorGuardMutable: planCanonicalEditorGuardMutable,
    planCanonicalEditorRender: planCanonicalEditorRender,
    planCanonicalEditorOutcomeLabel: planCanonicalEditorOutcomeLabel,
    // Uncertain-save recovery correction
    PLAN_CANONICAL_EDITOR_RECOVERY_MARKER_STORAGE_KEY: PLAN_CANONICAL_EDITOR_RECOVERY_MARKER_STORAGE_KEY,
    PLAN_CANONICAL_EDITOR_RECOVERY_MARKER_SCHEMA_VERSION: PLAN_CANONICAL_EDITOR_RECOVERY_MARKER_SCHEMA_VERSION,
    planCanonicalEditorWriteRecoveryMarker: planCanonicalEditorWriteRecoveryMarker,
    planCanonicalEditorClearRecoveryMarker: planCanonicalEditorClearRecoveryMarker,
    planCanonicalEditorReadValidRecoveryMarker: planCanonicalEditorReadValidRecoveryMarker,
    planCanonicalEditorApplyBootRecoveryOutcome: planCanonicalEditorApplyBootRecoveryOutcome,
    planCanonicalEditorRunBootRecoveryCheck: planCanonicalEditorRunBootRecoveryCheck,
    planCanonicalEditorHandleRetryRecoveryCheck: planCanonicalEditorHandleRetryRecoveryCheck,
    planCanonicalEditorHandleCheckSavedStatus: planCanonicalEditorHandleCheckSavedStatus,
    planCanonicalEditorHandleAbandonUnresolvedSave: planCanonicalEditorHandleAbandonUnresolvedSave,
    // Recovery-marker-lifecycle correction
    planCanonicalEditorOutcomeIsConclusivelyNoWrite: planCanonicalEditorOutcomeIsConclusivelyNoWrite,
    // Slice 5A editor-completion correction -- full field controls, removal,
    // reordering, and pre-save validation
    planCanonicalEditorResolveMicrocycle: planCanonicalEditorResolveMicrocycle,
    planCanonicalEditorResolveSession: planCanonicalEditorResolveSession,
    planCanonicalEditorResolveExercise: planCanonicalEditorResolveExercise,
    planCanonicalEditorResolveSet: planCanonicalEditorResolveSet,
    planCanonicalEditorParseOptionalNumber: planCanonicalEditorParseOptionalNumber,
    PLAN_CANONICAL_EDITOR_SET_NUMERIC_FIELDS: PLAN_CANONICAL_EDITOR_SET_NUMERIC_FIELDS,
    PLAN_CANONICAL_EDITOR_SET_STRING_FIELDS: PLAN_CANONICAL_EDITOR_SET_STRING_FIELDS,
    PLAN_CANONICAL_EDITOR_PROGRESSION_NUMERIC_FIELDS: PLAN_CANONICAL_EDITOR_PROGRESSION_NUMERIC_FIELDS,
    PLAN_CANONICAL_EDITOR_PROGRESSION_STRING_FIELDS: PLAN_CANONICAL_EDITOR_PROGRESSION_STRING_FIELDS,
    planCanonicalEditorHandleSetProgramField: planCanonicalEditorHandleSetProgramField,
    planCanonicalEditorHandleSetMicrocycleField: planCanonicalEditorHandleSetMicrocycleField,
    planCanonicalEditorHandleSetSessionField: planCanonicalEditorHandleSetSessionField,
    planCanonicalEditorHandleSetExerciseField: planCanonicalEditorHandleSetExerciseField,
    planCanonicalEditorHandleSetSetField: planCanonicalEditorHandleSetSetField,
    planCanonicalEditorHandleSetProgressionField: planCanonicalEditorHandleSetProgressionField,
    planCanonicalEditorHandleRemoveMicrocycle: planCanonicalEditorHandleRemoveMicrocycle,
    planCanonicalEditorHandleRemoveSession: planCanonicalEditorHandleRemoveSession,
    planCanonicalEditorHandleRemoveExercise: planCanonicalEditorHandleRemoveExercise,
    planCanonicalEditorHandleRemoveSet: planCanonicalEditorHandleRemoveSet,
    planCanonicalEditorSwap: planCanonicalEditorSwap,
    planCanonicalEditorHandleMoveMicrocycle: planCanonicalEditorHandleMoveMicrocycle,
    planCanonicalEditorHandleMoveSession: planCanonicalEditorHandleMoveSession,
    planCanonicalEditorHandleMoveExercise: planCanonicalEditorHandleMoveExercise,
    planCanonicalEditorHandleMoveSet: planCanonicalEditorHandleMoveSet,
    planCanonicalEditorValidateBeforeSave: planCanonicalEditorValidateBeforeSave,
    planCanonicalEditorExerciseOptions: planCanonicalEditorExerciseOptions,
    planCanonicalEditorIdxAttrs: planCanonicalEditorIdxAttrs
  };
}
