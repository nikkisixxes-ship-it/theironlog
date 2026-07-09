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

// Compact one-line set summary, e.g. "225 x 8 @ 2 RIR"
function planFormatSetSummary(s) {
  s = s || {};
  let timeStr = '';
  if (s.timeType === 'fixed' && s.seconds) timeStr = `${s.seconds} sec`;
  else if (s.timeType === 'range' && (s.minSeconds || s.maxSeconds)) timeStr = `${s.minSeconds || '?'}-${s.maxSeconds || '?'} sec`;

  const hasLoadReps = !!s.loadType || !!s.repsType;
  let loadRepsStr = '';
  if (hasLoadReps) {
    let loadStr = '\u2014';
    if (s.loadType === 'fixed' && s.weight) loadStr = `${s.weight}`;
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

  const noteTag = (s.notes && s.notes.trim()) ? ` <span class="plan-note-tag">NOTE</span>` : '';
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
// Fixed values prefill the logger fields; everything else (ranges, %TM, %1RM,
// bodyweight, RIR, notes) is preserved as read-only target context only —
// no auto-fill or progression logic is applied here.
function planSetToLoggerSet(planSet) {
  const s = planSet || {};
  const out = { weight: '', reps: '', time: '', rpe: '', autoFilled: false, autoType: null, completed: false };
  if (s.loadType === 'fixed' && s.weight) out.weight = String(s.weight);
  if (s.repsType === 'fixed' && s.reps) out.reps = String(s.reps);
  if (s.timeType === 'fixed' && s.seconds) out.time = String(s.seconds);
  const hasTarget = !!(s.loadType || s.repsType || s.effortType || s.timeType || (s.notes && s.notes.trim()));
  out.targetSummary = hasTarget ? planFormatSetSummary(s) : '';
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

// Top bar reused by every draft-editing screen: [Back] Title [Save Template]
function planEditorTopBar(title, backAction) {
  return `<div class="page-title-zone">
    <button class="btn-icon" onclick="${backAction}" aria-label="Back">&#8592;</button>
    <div class="page-title-zone-title" style="flex:1;margin-left:8px;font-size:20px">${escapeHtml(title)}</div>
    <button class="btn btn-primary btn-sm" onclick="planSaveTemplate()">Save Template</button>
  </div>`;
}

// ==================== PROGRAM DETAILS EDITOR ====================

function planRenderDetailsEditor() {
  const c = planContainer(); if (!c || !planDraft) return;
  const mcs = planDraft.microcycles;
  const mcList = mcs.length ? mcs.map((mc, mi) => planEditorRow(
    mc.name || `Micro ${mi + 1}`,
    `${(mc.sessions || []).length} session${(mc.sessions || []).length !== 1 ? 's' : ''}`,
    `planOpenMicrocycle(${mi})`,
    `planDeleteMicrocycle(${mi})`,
    mi, mcs.length,
    `planMoveMicrocycle(${mi},-1)`,
    `planMoveMicrocycle(${mi},1)`
  )).join('') : `<div class="plan-profile-empty">No microcycles added yet</div>`;

  c.innerHTML = `
    ${planEditorTopBar('Program Details', 'planExitEditorToOrigin()')}
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
  const sessList = sessions.length ? sessions.map((s, si) => planEditorRow(
    s.name || `Session ${si + 1}`,
    `${(s.exercises || []).length} exercise${(s.exercises || []).length !== 1 ? 's' : ''}`,
    `planOpenSession(${mi},${si})`,
    `planDeleteSession(${mi},${si})`,
    si, sessions.length,
    `planMoveSession(${mi},${si},-1)`,
    `planMoveSession(${mi},${si},1)`
  )).join('') : `<div class="plan-profile-empty">No sessions added yet</div>`;

  c.innerHTML = `
    ${planEditorTopBar('Microcycle', 'planBackToDetails()')}
    <div class="plan-editor" style="padding:16px">
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

// ==================== SESSION EDITOR ====================

function planOpenSession(mi, si) {
  const c = planContainer(); if (!c || !planDraft) return;
  const sess = planDraft.microcycles[mi].sessions[si];
  const exs = sess.exercises;
  const exList = exs.length ? exs.map((ex, ei) => {
    const exData = getExercise(ex.exerciseId);
    const name = exData ? exData.name : ex.exerciseId;
    return planEditorRow(
      name,
      `${(ex.sets || []).length} set${(ex.sets || []).length !== 1 ? 's' : ''}`,
      `planOpenExercise(${mi},${si},${ei})`,
      `planDeleteExercise(${mi},${si},${ei})`,
      ei, exs.length,
      `planMoveExercise(${mi},${si},${ei},-1)`,
      `planMoveExercise(${mi},${si},${ei},1)`
    );
  }).join('') : `<div class="plan-profile-empty">No exercises added yet</div>`;

  c.innerHTML = `
    ${planEditorTopBar('Session', `planBackToMicrocycle(${mi})`)}
    <div class="plan-editor" style="padding:16px">
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
  openExBrowser('select', exId => {
    planDraft.microcycles[mi].sessions[si].exercises.push({ exerciseId: exId, notes: '', sets: [] });
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
  const ex = planDraft.microcycles[mi].sessions[si].exercises[ei];
  const exData = getExercise(ex.exerciseId);
  const name = exData ? exData.name : ex.exerciseId;
  const sets = ex.sets;
  const setList = sets.length ? sets.map((s, seti) => `
    <div class="plan-set-row">
      <div class="plan-set-row-main" onclick="planOpenSet(${mi},${si},${ei},${seti})">
        <span class="plan-set-row-num">${seti + 1}</span>
        <span class="plan-set-row-summary">${planFormatSetSummary(s)}</span>
      </div>
      <div class="plan-row-controls">
        ${seti > 0 ? `<button class="btn-icon btn-sm" onclick="planMoveSet(${mi},${si},${ei},${seti},-1)">&uarr;</button>` : ''}
        ${seti < sets.length - 1 ? `<button class="btn-icon btn-sm" onclick="planMoveSet(${mi},${si},${ei},${seti},1)">&darr;</button>` : ''}
        <button class="btn-icon btn-sm" style="color:var(--red)" onclick="planDeleteSet(${mi},${si},${ei},${seti})">&#10005;</button>
      </div>
    </div>
  `).join('') : `<div class="plan-profile-empty">No sets added yet</div>`;

  c.innerHTML = `
    ${planEditorTopBar('Exercise', `planBackToSession(${mi},${si})`)}
    <div class="plan-editor" style="padding:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:10px">
        <div style="font-family:var(--font-display);font-size:20px;font-weight:800;text-transform:uppercase">${escapeHtml(name)}</div>
        <button class="btn btn-ghost btn-sm" style="flex-shrink:0" onclick="planChangeExercise(${mi},${si},${ei})">Change Exercise</button>
      </div>
      <div class="form-group"><label>Prescription Notes <span style="color:var(--text3);font-weight:400">(optional)</span></label><textarea placeholder="Notes specific to this exercise in this program..." oninput="planDraft.microcycles[${mi}].sessions[${si}].exercises[${ei}].notes=this.value">${escapeHtml(ex.notes || '')}</textarea></div>
      <div class="prof-section-label" style="margin:16px 0 8px">Sets</div>
      ${setList}
      <button class="btn btn-secondary" style="width:100%;margin-top:8px" onclick="planAddSet(${mi},${si},${ei})">+ Add Set</button>
      <button class="btn btn-danger" style="width:100%;margin-top:18px" onclick="planDeleteExercise(${mi},${si},${ei})">Remove This Exercise</button>
    </div>
  `;
}
function planBackToSession(mi, si) { planOpenSession(mi, si); }
function planChangeExercise(mi, si, ei) {
  openExBrowser('select', exId => {
    const exEntry = planDraft.microcycles[mi].sessions[si].exercises[ei];
    exEntry.exerciseId = exId;
    exEntry.notes = '';
    exEntry.sets = [];
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
  const s = planDraft.microcycles[mi].sessions[si].exercises[ei].sets[seti];
  const path = `planDraft.microcycles[${mi}].sessions[${si}].exercises[${ei}].sets[${seti}]`;
  const upd = `planUpdateSetPreview(${mi},${si},${ei},${seti})`;

  const loadExtra =
    s.loadType === 'fixed' ? `<div class="form-group"><label>Weight (lbs)</label><input type="number" step="0.5" value="${s.weight || ''}" oninput="${path}.weight=this.value;${upd}"></div>`
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
    ${planEditorTopBar('Set Detail', `planBackToExercise(${mi},${si},${ei})`)}
    <div class="plan-editor" style="padding:16px">
      <div class="prof-section-label" style="margin-bottom:6px">Current Prescription</div>
      <div id="plan-set-preview" class="plan-set-preview-box">${planFormatSetSummary(s)}</div>

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
  const s = planDraft.microcycles[mi].sessions[si].exercises[ei].sets[seti];
  const el = document.getElementById('plan-set-preview');
  if (el) el.innerHTML = planFormatSetSummary(s);
}
