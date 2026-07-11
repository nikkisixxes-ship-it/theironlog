// ==================== APP STATE ====================
let appDb = {
  customExercises: [],
  workouts: [],
  programs: [],
  unit: 'lbs',
  e1rmFormula: 'epley',
  exerciseNotes: {},
  exerciseVideos: {},
  importedSets: [],
  exOverrides: {},
};

let currentWorkout      = null;
let progReviewActiveId  = null;
let progReviewPendingId = null;
let activeTMPromptContinue = null;
let activeTMEditExIdx      = null;
let activeWorkoutTimer  = null;
let activeWorkoutStart  = null;
let workoutPaused       = false;
let workoutPausedAt     = null;
let workoutPausedTotal  = 0;
let currentProgramId    = null, currentMicrocycleIdx = null, currentSessionIdx = null;
let copyWorkoutId       = null, copyFormat = 'phpbb';
let confirmCallback     = null;
let currentModalBodypart = 'All';
let changeExBodypart    = 'All';
let changeExTargetIdx   = null;
let customExEditId      = null;
let customExFromLogger  = false;
let customExFromSessionPicker = false;
let customExFromChanger = false;
let moveDayProgId = null, moveDayMi = null, moveDaySi = null;
let customExTempVideos  = [];
let videosExIdx         = null;
let prDebounceTimers    = {};

// ==================== AUTH ====================
let authMode = 'login';

function switchAuthTab(mode) {
  authMode = mode;
  document.getElementById('auth-tab-login').classList.toggle('active', mode === 'login');
  document.getElementById('auth-tab-register').classList.toggle('active', mode === 'register');
  document.getElementById('auth-submit-btn').textContent = mode === 'login' ? 'Login' : 'Create Account';
  document.getElementById('auth-err').textContent = '';
}

function authSubmit() {
  const email = document.getElementById('auth-email').value.trim();
  const pass  = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-err');
  errEl.textContent = '';
  if (!email || !pass) { errEl.textContent = 'Please enter email and password.'; return; }
  const btn = document.getElementById('auth-submit-btn');
  btn.textContent = '...'; btn.disabled = true;
  const promise = authMode === 'login'
    ? auth.signInWithEmailAndPassword(email, pass)
    : auth.createUserWithEmailAndPassword(email, pass);
  promise.catch(err => {
    errEl.textContent = friendlyAuthError(err.code);
    btn.textContent = authMode === 'login' ? 'Login' : 'Create Account';
    btn.disabled = false;
  });
}

function authForgot() {
  const email = document.getElementById('auth-email').value.trim();
  if (!email) { document.getElementById('auth-err').textContent = 'Enter your email first.'; return; }
  auth.sendPasswordResetEmail(email)
    .then(() => { document.getElementById('auth-err').style.color = 'var(--green)'; document.getElementById('auth-err').textContent = 'Reset email sent!'; })
    .catch(err => { document.getElementById('auth-err').style.color = 'var(--red)'; document.getElementById('auth-err').textContent = friendlyAuthError(err.code); });
}

function friendlyAuthError(code) {
  const map = {
    'auth/invalid-email': 'Invalid email address.',
    'auth/user-not-found': 'No account found with this email.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/email-already-in-use': 'Email already in use.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/too-many-requests': 'Too many attempts. Try again later.',
    'auth/invalid-credential': 'Invalid email or password.',
  };
  return map[code] || 'An error occurred. Please try again.';
}

function signOut() {
  confirm2('Sign Out', 'Sign out of Iron Log?', () => {
    firestoreListeners.forEach(unsub => unsub());
    firestoreListeners = [];
    auth.signOut();
  });
}

// ==================== SETTINGS ====================
function openSettingsModal() {
  document.getElementById('settings-e1rm-formula').value = appDb.e1rmFormula || 'epley';
  updateUnitToggle();
  openModal('modal-settings');
}

function saveSettings() {
  appDb.e1rmFormula = document.getElementById('settings-e1rm-formula').value;
  fsSavePrefs();
  showToast('Settings saved', 'success');
}

// ==================== INIT ====================
auth.onAuthStateChanged(async user => {
  if (!user) {
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    return;
  }
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  initCollections(user.uid);
  try {
    const [wSnap, pSnap, eSnap, mSnap, nSnap, iSnap, vSnap, ovSnap] = await Promise.all([
      COL_WORKOUTS.get(), COL_PROGRAMS.get(), COL_CUSTOM_EX.get(),
      COL_META.doc('prefs').get(), COL_EX_NOTES.get(), COL_IMPORTED_SETS.get(),
      COL_EX_VIDEOS.get(), COL_EX_OVERRIDES.get()
    ]);
    appDb.workouts        = wSnap.docs.map(d => d.data()).sort((a,b) => b.date - a.date);
    appDb.programs        = pSnap.docs.map(d => d.data());
    appDb.customExercises = eSnap.docs.map(d => d.data());
    if (mSnap.exists) { appDb.unit = mSnap.data().unit || 'lbs'; appDb.e1rmFormula = mSnap.data().e1rmFormula || 'epley'; }
    appDb.exerciseNotes = {};
    nSnap.docs.forEach(d => { appDb.exerciseNotes[d.id] = d.data().note || ''; });
    appDb.importedSets = iSnap.docs.map(d => d.data());
    appDb.exerciseVideos = {};
    vSnap.docs.forEach(d => { appDb.exerciseVideos[d.id] = d.data().videos || []; });
    appDb.exOverrides = {};
    ovSnap.docs.forEach(d => { appDb.exOverrides[d.id] = d.data(); });
    setupListeners();
    document.getElementById('loading-screen').style.display = 'none';
    renderHome();
  } catch(err) {
    console.error(err);
    document.getElementById('loading-screen').innerHTML = '<div style="font-family:var(--font-display);font-size:32px;font-weight:900;color:var(--red)">LOAD ERROR</div><div style="margin-top:12px;color:var(--text2);font-size:15px;text-align:center;max-width:280px;line-height:1.5">Could not connect to database.<br>Check your internet connection.</div><button onclick="location.reload()" style="margin-top:20px;background:var(--accent);color:#fff;border:none;padding:12px 28px;border-radius:8px;font-family:var(--font-display);font-size:17px;font-weight:700;cursor:pointer;letter-spacing:0.05em">RETRY</button>';
  }
});

function setupListeners() {
  firestoreListeners.forEach(u => u());
  firestoreListeners = [];
  firestoreListeners.push(COL_WORKOUTS.onSnapshot(snap => {
    appDb.workouts = snap.docs.map(d => d.data()).sort((a,b) => b.date - a.date);
    const pg = activePage();
    if (pg === 'page-home') renderHome();
    if (pg === 'page-history') renderHistory();
  }, () => {}));
  firestoreListeners.push(COL_PROGRAMS.onSnapshot(snap => {
    appDb.programs = snap.docs.map(d => d.data());
    if (activePage() === 'page-programs') renderPlanLibrary();
  }, () => {}));
  firestoreListeners.push(COL_CUSTOM_EX.onSnapshot(snap => {
    appDb.customExercises = snap.docs.map(d => d.data());
    if (activePage() === 'page-db') renderDB();
  }, () => {}));
  firestoreListeners.push(COL_EX_NOTES.onSnapshot(snap => {
    appDb.exerciseNotes = {};
    snap.docs.forEach(d => { appDb.exerciseNotes[d.id] = d.data().note || ''; });
  }, () => {}));
  firestoreListeners.push(COL_EX_VIDEOS.onSnapshot(snap => {
    appDb.exerciseVideos = {};
    snap.docs.forEach(d => { appDb.exerciseVideos[d.id] = d.data().videos || []; });
  }, () => {}));
  firestoreListeners.push(COL_EX_OVERRIDES.onSnapshot(snap => {
    appDb.exOverrides = {};
    snap.docs.forEach(d => { appDb.exOverrides[d.id] = d.data(); });
  }, () => {}));
}

function getExNote(exId) {
  const ex = appDb.customExercises.find(e => e.id === exId);
  if (ex) return ex.notes || '';
  return appDb.exerciseNotes[exId] || '';
}
function saveExNote(exId, note) {
  const ex = appDb.customExercises.find(e => e.id === exId);
  if (ex) { ex.notes = note; fsSaveCustomEx(ex); }
  else { appDb.exerciseNotes[exId] = note; fsSaveExNote(exId, note); }
}
function getExVideos(exId) {
  const ex = appDb.customExercises.find(e => e.id === exId);
  if (ex) return ex.videos || [];
  return appDb.exerciseVideos[exId] || [];
}
function saveExVideos(exId, videos) {
  const ex = appDb.customExercises.find(e => e.id === exId);
  if (ex) { ex.videos = videos; fsSaveCustomEx(ex); }
  else { appDb.exerciseVideos[exId] = videos; fsSaveExVideos(exId, videos); }
}

function activePage() { return document.querySelector('.page.active')?.id; }

// ==================== NAVIGATION ====================
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === id));
  const activeBar = document.getElementById('active-bar');
  if (activeBar) activeBar.style.display = id === 'page-log' ? 'none' : '';
  if (id === 'page-home')     renderHome();
  if (id === 'page-history')  renderHistory();
  if (id === 'page-db')       renderDB();
  if (id === 'page-programs') renderPlanLibrary();
}

function showHistoryPage() {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-history').classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  renderHistory();
}

// ==================== HOME ====================
let homeCarouselIdx = 0;
let homeCarouselProgs = [];
let homeCarouselStartX = 0;
let homeCarouselDragging = false;

function getActivePrograms() {
  return appDb.programs.filter(p => p.recordType === 'activeProgram' && p.status === 'active');
}

function renderHome() {
  renderHomeCarousel();
  const sorted = [...appDb.workouts].slice(0, 3);
  document.getElementById('home-recent').innerHTML = sorted.length
    ? sorted.map(w => workoutHistoryCard(w, true)).join('')
    : '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 6h18M3 12h18M3 18h18"/></svg><h3>No workouts yet</h3><p>Tap New Workout to get started</p></div>';
}

function renderHomeCarousel() {
  homeCarouselProgs = getActivePrograms().filter(prog => !!planGetFirstUnfinishedSession(prog));
  const carousel = document.getElementById('home-program-carousel');
  const dotsEl   = document.getElementById('home-carousel-dots');
  if (!carousel) return;
  if (homeCarouselIdx >= homeCarouselProgs.length) homeCarouselIdx = 0;
  if (!homeCarouselProgs.length) {
    carousel.innerHTML = `<div class="prog-card-empty" onclick="showPage('page-programs')">
      <div class="prog-card-empty-label">No Active Programs</div>
      <div class="prog-card-empty-sub">Go to Plan to create and start a program</div>
    </div>`;
    dotsEl.innerHTML = '';
    return;
  }
  carousel.innerHTML = homeCarouselProgs.map((prog, i) => {
    const next = planGetFirstUnfinishedSession(prog);
    const totalSessions = planCountActiveSessions(prog);
    const completed = (prog.completedSessionKeys || []).length;
    const pct = totalSessions > 0 ? Math.round((completed / totalSessions) * 100) : 0;
    const mc = prog.microcycles[next.microcycleIdx];
    const sess = mc.sessions[next.sessionIdx];
    const mcName = mc.name || `Micro ${next.microcycleIdx + 1}`;
    const sessName = sess.name || `Session ${next.sessionIdx + 1}`;
    const sessionLabel = `${mcName} \u2022 ${sessName}`;
    const dotsHtml = homeCarouselProgs.length > 1
      ? homeCarouselProgs.map((_, di) => `<div class="home-carousel-dot ${di === i ? 'active' : ''}"></div>`).join('')
      : '';
    return `<div class="prog-carousel-card" onclick="startWorkoutFromActiveCard('${prog.id}')">
      <div style="display:flex;align-items:flex-start;justify-content:space-between">
        <div style="flex:1;min-width:0">
          <div class="prog-card-session">${sessionLabel}</div>
          <div class="prog-card-name">${prog.name}</div>
        </div>
        <button class="prog-card-menu-btn" onclick="openActiveProgCardMenu(event,'${prog.id}')" title="Program options">•••</button>
      </div>
      <div class="prog-card-progress-label">${pct}% Complete</div>
      <div class="prog-card-bar-row">
        <div class="prog-card-bar-track"><div class="prog-card-bar-fill" style="width:${pct}%"></div></div>
        <div class="prog-card-dots">${dotsHtml}</div>
      </div>
    </div>`;
  }).join('');
  dotsEl.innerHTML = '';
  updateCarouselPosition(false);
  initCarouselSwipe();
}

function updateCarouselPosition(animate) {
  const carousel = document.getElementById('home-program-carousel');
  if (!carousel) return;
  carousel.style.transition = animate ? 'transform 0.3s ease' : 'none';
  carousel.style.transform  = `translateX(-${homeCarouselIdx * 100}%)`;
  document.querySelectorAll('.home-carousel-dot').forEach((d, i) => {
    d.classList.toggle('active', (i % homeCarouselProgs.length) === homeCarouselIdx);
  });
}

function goToCarouselSlide(i) { homeCarouselIdx = i; updateCarouselPosition(true); }

function initCarouselSwipe() {
  const wrap = document.getElementById('home-program-carousel-wrap');
  if (!wrap || wrap._swipeInit) return;
  wrap._swipeInit = true;
  wrap.addEventListener('touchstart', e => { homeCarouselStartX = e.touches[0].clientX; homeCarouselDragging = true; }, { passive: true });
  wrap.addEventListener('touchend', e => {
    if (!homeCarouselDragging) return;
    homeCarouselDragging = false;
    const diff = homeCarouselStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) {
      if (diff > 0 && homeCarouselIdx < homeCarouselProgs.length - 1) homeCarouselIdx++;
      else if (diff < 0 && homeCarouselIdx > 0) homeCarouselIdx--;
      updateCarouselPosition(true);
    }
  }, { passive: true });
}

function startWorkoutFromCard(progId) {
  const prog = appDb.programs.find(p => p.id === progId); if (!prog) return;
  const next = getNextSessionForProgram(prog); if (next === null) return;
  startNewWorkout(prog.id, next.microcycleIdx, next.sessionIdx);
}

function openProgCardMenu(e, progId) {
  e.stopPropagation();
  const items = [
    { label: 'Open Program', icon: '→', action: `openProgramFromCard('${progId}')` },
    { divider: true },
    { label: 'End Program', icon: '✕', action: `endProgramFromCard('${progId}')`, danger: true },
  ];
  showDropdown(e.currentTarget, items);
}

function openProgramFromCard(progId) {
  showPage('page-programs');
  setTimeout(() => { if (typeof planOpenProfile === 'function') planOpenProfile(progId); }, 150);
}

function endProgramFromCard(progId) {
  const prog = appDb.programs.find(p => p.id === progId); if (!prog) return;
  confirm2('End Program?', 'This program will be removed from Active Programs and reset to its starting state. Workout history will remain available in History.', () => {
    prog.completedSessionIndices = []; prog.trainingMaxes = {}; prog.lastUsed = null;
    fsSaveProgram(prog); homeCarouselIdx = 0; renderHome(); showToast('Program ended', 'success');
  }, 'End Program');
}

function restartProgramFromHome(progId) {
  confirm2('Restart Program', 'Clear all progress and restart? Your workout history is kept.', () => {
    const prog = appDb.programs.find(p => p.id === progId); if (!prog) return;
    prog.completedSessionIndices = []; prog.trainingMaxes = {}; prog.lastUsed = Date.now();
    fsSaveProgram(prog); renderHome(); showToast('Program restarted', 'success');
  }, 'Restart');
}

// ==================== ACTIVE PROGRAM INSTANCES (new Plan-driven model) ====================

function startWorkoutFromActiveCard(activeId) {
  const active = appDb.programs.find(p => p.id === activeId); if (!active) return;
  const next = planGetFirstUnfinishedSession(active); if (!next) return;
  startNewWorkoutFromActive(activeId, next.microcycleIdx, next.sessionIdx);
}

function openActiveProgCardMenu(e, activeId) {
  e.stopPropagation();
  const items = [
    { label: 'Choose Session', icon: '\u2630', action: `openChooseSessionModal('${activeId}')` },
    { label: 'Open Template', icon: '\u2192', action: `openTemplateFromActiveCard('${activeId}')` },
    { divider: true },
    { label: 'End Program', icon: '\u2715', action: `endActiveProgram('${activeId}')`, danger: true },
  ];
  showDropdown(e.currentTarget, items);
}

function openTemplateFromActiveCard(activeId) {
  const active = appDb.programs.find(p => p.id === activeId); if (!active || !active.templateId) return;
  showPage('page-programs');
  setTimeout(() => { if (typeof planOpenProfile === 'function') planOpenProfile(active.templateId); }, 150);
}

function endActiveProgram(activeId) {
  const active = appDb.programs.find(p => p.id === activeId); if (!active) return;
  confirm2('End Program?', 'This removes the active program from Train. The original template will remain available on Plan, and workout history will remain in History.', () => {
    active.status = 'ended';
    active.updatedAt = Date.now();
    fsSaveProgram(active);
    homeCarouselIdx = 0;
    renderHome();
    showToast('Program ended', 'success');
  }, 'End Program');
}

// ---- Choose Session (reuses the existing, otherwise-unused Session modal shell) ----
function openChooseSessionModal(activeId) {
  const active = appDb.programs.find(p => p.id === activeId); if (!active) return;
  document.getElementById('session-modal-title').textContent = 'Choose Session';
  const mcs = Array.isArray(active.microcycles) ? active.microcycles : [];
  const completed = active.completedSessionKeys || [];
  let html = '';
  mcs.forEach((mc, mi) => {
    const sessions = Array.isArray(mc.sessions) ? mc.sessions : [];
    if (!sessions.length) return;
    html += `<div style="font-family:var(--font-display);font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text3);margin:14px 0 6px">${escapeHtml(mc.name || `Micro ${mi + 1}`)}</div>`;
    sessions.forEach((sess, si) => {
      const key = planSessionKey(mi, si);
      const isDone = completed.includes(key);
      const name = sess.name || `Session ${si + 1}`;
      if (isDone) {
        html += `<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;color:var(--text3);font-family:var(--font-display);font-size:15px;font-weight:700;text-transform:uppercase"><span style="color:var(--green)">\u2713</span> ${escapeHtml(name)}</div>`;
      } else {
        html += `<div onclick="chooseSessionAndStart('${activeId}',${mi},${si})" style="display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:pointer;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:6px;font-family:var(--font-display);font-size:15px;font-weight:700;text-transform:uppercase;color:var(--text)"><span style="color:var(--text3)">\u25CB</span> ${escapeHtml(name)}</div>`;
      }
    });
  });
  document.getElementById('session-modal-body').innerHTML = html || `<div class="plan-profile-empty">No sessions in this program</div>`;
  openModal('modal-session');
}

function chooseSessionAndStart(activeId, mi, si) {
  closeModal('modal-session');
  startNewWorkoutFromActive(activeId, mi, si);
}

// ---- Starting a workout from an active instance ----
function startNewWorkoutFromActive(activeId, mi, si) {
  const active = appDb.programs.find(p => p.id === activeId); if (!active) return;
  const mc = active.microcycles[mi]; if (!mc) return;
  const sess = mc.sessions[si]; if (!sess) return;
  const missing = getExercisesNeedingActiveTM(active, sess);
  if (missing.length) {
    showActiveTMPrompt(activeId, missing, () => finalizeStartActiveWorkout(activeId, mi, si));
  } else {
    finalizeStartActiveWorkout(activeId, mi, si);
  }
}

function finalizeStartActiveWorkout(activeId, mi, si) {
  const active = appDb.programs.find(p => p.id === activeId); if (!active) return;
  const mc = active.microcycles[mi]; if (!mc) return;
  const sess = mc.sessions[si]; if (!sess) return;
  const mcName = mc.name || `Micro ${mi + 1}`;
  const sessName = sess.name || `Session ${si + 1}`;
  const name = `${mcName} \u00b7 ${sessName}`;

  currentWorkout = {
    id: uid(), name, date: Date.now(), exercises: [], rpeEnabled: false, duration: 0, bodyweight: null,
    programId: null, microcycleIdx: null, sessionIdx: null,
    activeProgramId: activeId, activeMicrocycleIdx: mi, activeSessionIdx: si
  };
  currentWorkout.exercises = (sess.exercises || []).map(ex => ({
    exerciseId: ex.exerciseId,
    sets: (ex.sets && ex.sets.length ? ex.sets : [{}]).map(s => planSetToLoggerSet(s, ex.exerciseId, active)),
    perfVideos: []
  }));

  document.getElementById('workout-exercises').innerHTML = '';
  const nameDisplay = document.getElementById('log-session-name-display');
  if (nameDisplay) nameDisplay.textContent = (name || 'NEW WORKOUT').toUpperCase();
  renderWorkoutExercises(); showPage('page-log'); startWorkoutTimer();
}

// ==================== ACTIVE-INSTANCE TRAINING MAX (Build 4) ====================
// Training Maxes live on the active program instance only — never on the Plan
// template, never globally in the Library. Starting the same template again later
// as a new active program does not inherit these values.

function getActiveTrainingMax(active, exerciseId) {
  if (!active || !active.trainingMaxes) return null;
  const tm = active.trainingMaxes[exerciseId];
  const val = tm ? parseFloat(tm.value) : NaN;
  return !isNaN(val) ? val : null;
}

function setActiveTrainingMax(active, exerciseId, value) {
  if (!active) return;
  if (!active.trainingMaxes) active.trainingMaxes = {};
  active.trainingMaxes[exerciseId] = { value, unit: appDb.unit, updatedAt: Date.now() };
  active.updatedAt = Date.now();
  fsSaveProgram(active);
}

function roundToTMIncrement(val) {
  const inc = appDb.unit === 'kg' ? 2.5 : 5;
  return Math.round(val / inc) * inc;
}

function resolvePercentTMWeight(percent, tmValue) {
  return roundToTMIncrement((percent / 100) * tmValue);
}

// Scans a session for %TM exercises that don't yet have a stored active TM.
// Each qualifying exercise is listed once, even if it appears multiple times
// or has multiple %TM sets within the session.
function getExercisesNeedingActiveTM(active, session) {
  const seen = new Set();
  const needing = [];
  (session.exercises || []).forEach(ex => {
    if (seen.has(ex.exerciseId)) return;
    const hasPercentTM = (ex.sets || []).some(s => s.loadType === 'percentTM');
    if (!hasPercentTM) return;
    seen.add(ex.exerciseId);
    if (getActiveTrainingMax(active, ex.exerciseId) != null) return;
    needing.push({ exerciseId: ex.exerciseId, exData: getExercise(ex.exerciseId) });
  });
  return needing;
}

// Whether the CURRENT logger exercise (by index) has a %TM set in the active
// instance's prescription — used to show the "Set / Edit Training Max" menu item.
function hasActiveTMTarget(exIdx) {
  if (!currentWorkout?.activeProgramId) return false;
  const active = appDb.programs.find(p => p.id === currentWorkout.activeProgramId); if (!active) return false;
  const mc = active.microcycles[currentWorkout.activeMicrocycleIdx];
  const session = mc && mc.sessions[currentWorkout.activeSessionIdx];
  if (!session) return false;
  const ex = currentWorkout.exercises[exIdx];
  const sessEx = session.exercises.find(e => e.exerciseId === ex.exerciseId); if (!sessEx?.sets) return false;
  return sessEx.sets.some(s => s.loadType === 'percentTM');
}

function showActiveTMPrompt(activeId, missingExercises, continueCallback) {
  activeTMPromptContinue = continueCallback;
  document.getElementById('modal-active-tm-prompt').dataset.activeId = activeId;
  document.getElementById('active-tm-prompt-body').innerHTML = missingExercises.map(m => `
    <div class="tm-ex-block" id="atm-block-${m.exerciseId}">
      <div class="tm-ex-name">${m.exData ? escapeHtml(m.exData.name) : m.exerciseId}</div>
      <div class="tm-input-row">
        <input type="number" id="atm-input-${m.exerciseId}" placeholder="Training Max (${appDb.unit})" step="2.5">
      </div>
    </div>
  `).join('');
  openModal('modal-active-tm-prompt');
}

function activeTMPromptSaveContinue() {
  const activeId = document.getElementById('modal-active-tm-prompt').dataset.activeId;
  const active = appDb.programs.find(p => p.id === activeId);
  if (active) {
    document.querySelectorAll('#active-tm-prompt-body input[id^="atm-input-"]').forEach(input => {
      const val = parseFloat(input.value);
      if (!isNaN(val) && val > 0) {
        const exerciseId = input.id.replace('atm-input-', '');
        setActiveTrainingMax(active, exerciseId, val);
      }
    });
  }
  closeModal('modal-active-tm-prompt');
  const cb = activeTMPromptContinue; activeTMPromptContinue = null;
  if (cb) cb();
}

function activeTMPromptSkip() {
  closeModal('modal-active-tm-prompt');
  const cb = activeTMPromptContinue; activeTMPromptContinue = null;
  if (cb) cb();
}

function openActiveTMEditModal(idx) {
  if (!currentWorkout?.activeProgramId) return;
  activeTMEditExIdx = idx;
  const ex = currentWorkout.exercises[idx];
  const exData = getExercise(ex.exerciseId);
  const active = appDb.programs.find(p => p.id === currentWorkout.activeProgramId);
  const current = active ? getActiveTrainingMax(active, ex.exerciseId) : null;
  document.getElementById('active-tm-edit-title').textContent = (exData ? exData.name : ex.exerciseId) + ' Training Max';
  document.getElementById('active-tm-edit-input').value = current != null ? current : '';
  document.getElementById('active-tm-edit-unit').textContent = appDb.unit;
  openModal('modal-active-tm-edit');
}

function saveActiveTMEdit() {
  if (activeTMEditExIdx === null || !currentWorkout?.activeProgramId) { closeModal('modal-active-tm-edit'); return; }
  const val = parseFloat(document.getElementById('active-tm-edit-input').value);
  if (isNaN(val) || val <= 0) { showToast('Enter a valid Training Max', 'error'); return; }
  const active = appDb.programs.find(p => p.id === currentWorkout.activeProgramId);
  if (!active) { closeModal('modal-active-tm-edit'); return; }
  const exId = currentWorkout.exercises[activeTMEditExIdx].exerciseId;
  setActiveTrainingMax(active, exId, val);
  updateCurrentWorkoutForTM(exId, active);
  closeModal('modal-active-tm-edit');
  showToast('Training Max updated', 'success');
}

// Re-resolves %TM weights for the given exercise in the CURRENT workout only —
// and only for sets that are still auto-filled (i.e. the user hasn't typed a
// manual weight over them; updateSet() already clears autoFilled on manual edit).
function updateCurrentWorkoutForTM(exerciseId, active) {
  if (!currentWorkout) return;
  let touched = false;
  currentWorkout.exercises.forEach(ex => {
    if (ex.exerciseId !== exerciseId) return;
    ex.sets.forEach(s => {
      if (s.autoType === 'percentTM' && s.autoFilled && s.targetData && s.targetData.loadType === 'percentTM') {
        const pct = parseFloat(s.targetData.percent);
        const tmVal = getActiveTrainingMax(active, exerciseId);
        if (!isNaN(pct) && tmVal != null) {
          s.weight = String(resolvePercentTMWeight(pct, tmVal));
          touched = true;
        }
      }
    });
  });
  if (touched) renderWorkoutExercises();
}

// ==================== HISTORY STATS ====================
function renderHistoryStats() {
  const total = appDb.workouts.length;
  const totalSets = appDb.workouts.reduce((a,w) => a + w.exercises.reduce((b,e) => b + e.sets.length, 0), 0) + appDb.importedSets.length;
  let totalVol = 0;
  appDb.workouts.forEach(w => w.exercises.forEach(e => e.sets.forEach(s => { if (s.weight && s.reps) totalVol += (+s.weight) * (+s.reps); })));
  appDb.importedSets.forEach(s => { if (s.weight && s.reps) totalVol += (+s.weight) * (+s.reps); });
  const totalSecs = appDb.workouts.reduce((a,w) => a + (w.duration||0), 0);
  const totalHours = totalSecs / 3600;
  let timeDisplay, timeLabel;
  if (totalHours < 24) { timeDisplay = totalHours.toFixed(1); timeLabel = 'hrs'; }
  else { timeDisplay = (totalHours / 24).toFixed(1); timeLabel = 'days'; }
  const unitLabel = appDb.unit.toUpperCase();
  const totalSetsFormatted = totalSets.toLocaleString();
  let volDisplay;
  if (totalVol >= 1000000) volDisplay = (Math.floor(totalVol / 100000) / 10).toFixed(1) + 'm';
  else if (totalVol >= 1000) volDisplay = (Math.floor(totalVol / 100) / 10).toFixed(1) + 'k';
  else volDisplay = totalVol;
  document.getElementById('history-stats').innerHTML = `
    <div class="stat-box"><div class="stat-label">Total Workouts</div><div class="stat-value">${total}</div></div>
    <div class="stat-box"><div class="stat-label">Total Sets</div><div class="stat-value">${totalSetsFormatted}</div></div>
    <div class="stat-box"><div class="stat-label">${unitLabel} Lifted</div><div class="stat-value" style="font-size:${totalVol>=10000?'22px':'28px'}">${volDisplay}</div></div>
    <div class="stat-box"><div class="stat-label">Training Time</div><div class="stat-value">${timeDisplay}<span style="font-size:16px;font-weight:600;color:var(--accent);margin-left:3px">${timeLabel}</span></div></div>`;
}

// ==================== WORKOUT TIMER ====================
function startWorkoutTimer() {
  activeWorkoutStart = Date.now(); workoutPaused = false; workoutPausedTotal = 0; workoutPausedAt = null;
  if (activeWorkoutTimer) clearInterval(activeWorkoutTimer);
  document.getElementById('active-bar').classList.add('visible');
  activeWorkoutTimer = setInterval(updateTimerDisplay, 1000);
  updateTimerDisplay();
}
function updateTimerDisplay() {
  if (!activeWorkoutStart) return;
  let elapsed;
  if (workoutPaused) elapsed = Math.floor((workoutPausedAt - activeWorkoutStart - workoutPausedTotal) / 1000);
  else elapsed = Math.floor((Date.now() - activeWorkoutStart - workoutPausedTotal) / 1000);
  if (elapsed < 0) elapsed = 0;
  const el = document.getElementById('log-timer-display');
  if (el) { el.textContent = fmtDuration(elapsed); el.classList.toggle('paused', workoutPaused); }
  const barEl = document.getElementById('active-bar-time');
  if (barEl) barEl.textContent = fmtDuration(elapsed);
}
function getElapsedSeconds() {
  if (!activeWorkoutStart) return 0;
  if (workoutPaused) return Math.floor((workoutPausedAt - activeWorkoutStart - workoutPausedTotal) / 1000);
  return Math.floor((Date.now() - activeWorkoutStart - workoutPausedTotal) / 1000);
}
function pauseWorkout() { if (!currentWorkout || workoutPaused) return; workoutPaused = true; workoutPausedAt = Date.now(); updateTimerDisplay(); showToast('Workout paused', ''); }
function resumeWorkout() { if (!currentWorkout || !workoutPaused) return; workoutPausedTotal += (Date.now() - workoutPausedAt); workoutPaused = false; workoutPausedAt = null; updateTimerDisplay(); showToast('Workout resumed', 'success'); }
function stopWorkoutTimer() { if (activeWorkoutTimer) clearInterval(activeWorkoutTimer); document.getElementById('active-bar').classList.remove('visible'); workoutPaused = false; workoutPausedTotal = 0; workoutPausedAt = null; }
function goToActiveWorkout() { showPage('page-log'); }

function onSetChecked(exIdx, si, checked) {
  if (!currentWorkout) return;
  const s = currentWorkout.exercises[exIdx].sets[si];
  s.completed = checked;
  if (checked && workoutPaused) resumeWorkout();
  const wrap = document.getElementById(`set-wrap-${exIdx}-${si}`);
  if (wrap) wrap.classList.toggle('completed', checked);
  if (checked && s.weight && s.reps) {
    s.isNew1RM = calc1RM(+s.weight, +s.reps) > getBest1RM(currentWorkout.exercises[exIdx].exerciseId, currentWorkout.id);
    s.isPR = +s.weight > getBestWeight(currentWorkout.exercises[exIdx].exerciseId, currentWorkout.id);
  }
  const badgesEl = document.getElementById(`set-badges-${exIdx}-${si}`);
  if (badgesEl) {
    const html = buildSetBadgesHtml(s);
    badgesEl.innerHTML = html;
    const rowEl = document.getElementById(`set-row-${exIdx}-${si}`);
    if (rowEl && html && !rowEl.style.gridTemplateColumns.includes('auto')) {
      rowEl.style.gridTemplateColumns = rowEl.style.gridTemplateColumns + ' auto';
    }
  }
}

// ==================== LOG HEADER MENU ====================
function openLogHeaderMenu(e) {
  e.stopPropagation();
  const items = [
    { label: 'Reorder Exercises', icon: '↕', action: 'openReorderModal()' },
    { label: 'Log Bodyweight',    icon: '⚖', action: 'openLogBWModal()' },
    { label: 'RPE',               icon: '',  action: 'toggleRPEFromMenu()', toggle: currentWorkout?.rpeEnabled ? '✓ ' : '' },
    { divider: true },
    { label: 'Cancel Workout', icon: '✕', action: 'cancelWorkout()', danger: true },
  ];
  showDropdown(e.currentTarget, items);
}
function togglePauseWorkout() { if (!currentWorkout) return; if (workoutPaused) resumeWorkout(); else pauseWorkout(); }

function openExerciseMenu(e, idx) {
  e.stopPropagation();
  const ex = currentWorkout?.exercises[idx];
  const hasProg = ex ? hasProgression(idx) : false;
  const hasTM = ex ? hasActiveTMTarget(idx) : false;
  const items = [
    { label: 'Change Exercise', icon: '⇄', action: `openChangeExModal(${idx})` },
    ...(hasProg ? [{ label: 'Reset TM / Baseline', icon: '↺', action: `openSingleTMPrompt(${idx})` }] : []),
    ...(hasTM ? [{ label: 'Set / Edit Training Max', icon: '⚖', action: `openActiveTMEditModal(${idx})` }] : []),
    { divider: true },
    { label: 'Delete Exercise', icon: '✕', action: `deleteExercise(${idx})`, danger: true },
  ];
  showDropdown(e.currentTarget, items);
}

function deleteExercise(idx) {
  if (!currentWorkout) return;
  const exData = getExercise(currentWorkout.exercises[idx].exerciseId);
  const name = exData ? exData.name : 'this exercise';
  confirm2('Delete Exercise', `Remove ${name} from this workout?`, () => { currentWorkout.exercises.splice(idx, 1); renderWorkoutExercises(); }, 'Delete');
}

function hasProgression(exIdx) {
  if (!currentWorkout?.programId) return false;
  const prog = appDb.programs.find(p => p.id === currentWorkout.programId); if (!prog) return false;
  const session = prog.microcycles[currentWorkout.microcycleIdx]?.sessions[currentWorkout.sessionIdx]; if (!session) return false;
  const ex = currentWorkout.exercises[exIdx];
  const sessEx = session.exercises.find(e => e.exerciseId === ex.exerciseId); if (!sessEx?.sets) return false;
  return sessEx.sets.some(s => s.progression === 'pct1rm' || s.progression === 'rep_goal');
}

function showDropdown(anchor, items) {
  closeDropdown();
  const menu = document.getElementById('dropdown-menu');
  menu.innerHTML = items.map(item => {
    if (item.divider) return '<div class="dropdown-divider"></div>';
    return `<div class="dropdown-item ${item.danger?'danger':''}" onclick="closeDropdown();${item.action}"><span style="width:18px;text-align:center;flex-shrink:0">${item.icon||''}</span><span>${item.toggle||''}${item.label}</span></div>`;
  }).join('');
  const rect = anchor.getBoundingClientRect();
  menu.style.display = 'block';
  const menuW = 220;
  let left = rect.right - menuW;
  if (left < 8) left = 8;
  let top = rect.bottom + 6;
  if (top + 200 > window.innerHeight) top = rect.top - 210;
  menu.style.left = left + 'px'; menu.style.top = top + 'px'; menu.style.minWidth = menuW + 'px';
  document.getElementById('dropdown-backdrop').classList.add('open');
}
function closeDropdown() { document.getElementById('dropdown-menu').style.display = 'none'; document.getElementById('dropdown-backdrop').classList.remove('open'); }
function toggleRPEFromMenu() { if (!currentWorkout) return; currentWorkout.rpeEnabled = !currentWorkout.rpeEnabled; renderWorkoutExercises(); }

// ==================== REORDER MODAL ====================
function openReorderModal() { if (!currentWorkout?.exercises.length) { showToast('No exercises to reorder', ''); return; } renderReorderList(); openModal('modal-reorder'); }
function renderReorderList() {
  const list = document.getElementById('reorder-list'); if (!currentWorkout) return;
  list.innerHTML = currentWorkout.exercises.map((ex, i) => {
    const exData = getExercise(ex.exerciseId); const name = exData ? exData.name : ex.exerciseId;
    return `<div class="reorder-item"><div class="reorder-item-name">${name}</div><div class="reorder-btns"><button class="btn-icon btn-sm" ${i===0?'disabled style="opacity:0.3"':''} onclick="reorderMove(${i},-1)">↑</button><button class="btn-icon btn-sm" ${i===currentWorkout.exercises.length-1?'disabled style="opacity:0.3"':''} onclick="reorderMove(${i},1)">↓</button></div></div>`;
  }).join('');
}
function reorderMove(idx, dir) { const arr = currentWorkout.exercises, n = idx + dir; if (n < 0 || n >= arr.length) return; [arr[idx], arr[n]] = [arr[n], arr[idx]]; renderReorderList(); renderWorkoutExercises(); }

// ==================== LOG BODYWEIGHT ====================
function openLogBWModal() { document.getElementById('bw-modal-unit').textContent = appDb.unit; document.getElementById('bw-modal-input').value = currentWorkout?.bodyweight || ''; openModal('modal-log-bw'); }
function saveBWFromModal() { const val = parseFloat(document.getElementById('bw-modal-input').value); if (currentWorkout) currentWorkout.bodyweight = val || null; closeModal('modal-log-bw'); showToast('Bodyweight saved', 'success'); }
function getWorkoutBW() { if (currentWorkout && currentWorkout.bodyweight) return currentWorkout.bodyweight; for (const w of appDb.workouts) { if (w.bodyweight) return w.bodyweight; } return null; }

// ==================== NOTES MODAL ====================
let notesEditExIdx = null;
function toggleNotesSection(idx) { const content = document.getElementById(`ex-notes-content-${idx}`); if (!content) return; const isHidden = content.style.display === 'none'; content.style.display = isHidden ? '' : 'none'; const label = document.getElementById(`notes-hide-btn-${idx}`); if (label) label.textContent = isHidden ? 'Hide' : 'Show'; }
function openNotesEditModal(exIdx) { notesEditExIdx = exIdx; const ex = currentWorkout.exercises[exIdx]; const exData = getExercise(ex.exerciseId); document.getElementById('notes-edit-modal-title').textContent = exData ? exData.name : 'Notes'; document.getElementById('notes-edit-textarea').value = getExNote(ex.exerciseId); openModal('modal-notes-edit'); }
function saveNotesFromModal() {
  if (notesEditExIdx === null) return;
  const exId = currentWorkout.exercises[notesEditExIdx].exerciseId;
  const note = document.getElementById('notes-edit-textarea').value.trim();
  saveExNote(exId, note); closeModal('modal-notes-edit');
  const contentEl = document.getElementById(`ex-notes-content-${notesEditExIdx}`);
  if (contentEl) contentEl.innerHTML = note ? escapeHtml(note) : '<span style="color:var(--text3);font-style:italic">Tap to add notes...</span>';
  showToast('Note saved', 'success');
}

// ==================== VIDEOS MODAL ====================
function openVideosModal(exIdx) {
  videosExIdx = exIdx; const ex = currentWorkout.exercises[exIdx]; const exData = getExercise(ex.exerciseId);
  document.getElementById('ex-videos-modal-title').textContent = exData ? exData.name : 'Videos';
  renderVideosModalBody(); openModal('modal-ex-videos');
}
function renderVideosModalBody() {
  if (videosExIdx === null) return;
  const ex = currentWorkout.exercises[videosExIdx]; const perfVideos = ex.perfVideos || [];
  document.getElementById('ex-videos-modal-body').innerHTML = `<div>
    <div class="video-section-label" style="margin-bottom:10px">Add Videos</div>
    ${perfVideos.map((v,vi) => `<div class="video-link-row"><a class="video-link" href="${v}" target="_blank">${v}</a><button class="btn-icon" style="padding:4px;color:var(--red);border:none;background:none;font-size:12px;flex-shrink:0" onclick="removePerfVideo(${vi})">✕</button></div>`).join('')}
    <div class="video-add-row" style="margin-top:${perfVideos.length?'10px':'0'}">
      <input type="text" class="video-add-input" id="perf-vid-modal-input" placeholder="Paste video URL...">
      <button class="video-add-btn" onclick="addPerfVideoFromModal()">+ Add</button>
    </div>
  </div>`;
}
function addPerfVideoFromModal() { const input = document.getElementById('perf-vid-modal-input'); if (!input) return; const url = input.value.trim(); if (!url) { showToast('Paste a link first', 'error'); return; } if (!currentWorkout || videosExIdx === null) return; if (!currentWorkout.exercises[videosExIdx].perfVideos) currentWorkout.exercises[videosExIdx].perfVideos = []; currentWorkout.exercises[videosExIdx].perfVideos.push(url); input.value = ''; renderVideosModalBody(); showToast('Video added', 'success'); }
function removePerfVideo(viIdx) { if (!currentWorkout || videosExIdx === null) return; currentWorkout.exercises[videosExIdx].perfVideos.splice(viIdx, 1); renderVideosModalBody(); }

// ==================== CHANGE EXERCISE ====================
function confirmChangeExercise(newExId) {
  if (changeExTargetIdx === null || !currentWorkout) return;
  currentWorkout.exercises[changeExTargetIdx].exerciseId = newExId;
  currentWorkout.exercises[changeExTargetIdx].perfVideos = [];
  closeModal('modal-ex-browser'); renderWorkoutExercises(); showToast('Exercise changed', 'success');
}

// ==================== AUTOMATED PROGRESSION ====================
function getProgTM(prog, exId) { if (!prog.trainingMaxes) return null; return prog.trainingMaxes[exId] || null; }
function setProgTM(prog, exId, tmData) { if (!prog.trainingMaxes) prog.trainingMaxes = {}; prog.trainingMaxes[exId] = tmData; fsSaveProgram(prog); }
function getExercisesNeedingTMSetup() {
  if (!currentWorkout?.programId) return [];
  const prog = appDb.programs.find(p => p.id === currentWorkout.programId); if (!prog) return [];
  const session = prog.microcycles[currentWorkout.microcycleIdx]?.sessions[currentWorkout.sessionIdx]; if (!session) return [];
  const needing = [];
  for (const ex of session.exercises) {
    const hasPctProg = ex.sets && ex.sets.some(s => s.progression === 'pct1rm' && s.progressionValue);
    const hasRepGoal = ex.sets && ex.sets.some(s => s.progression === 'rep_goal' && s.progressionValue);
    if (!hasPctProg && !hasRepGoal) continue;
    const existing = getProgTM(prog, ex.exerciseId);
    if (existing && existing.value) continue;
    if (existing && existing.repGoalBase) continue;
    const exData = getExercise(ex.exerciseId);
    needing.push({ exerciseId: ex.exerciseId, exData, hasPctProg, hasRepGoal, repGoalTarget: hasRepGoal ? +ex.sets.find(s => s.progression === 'rep_goal')?.progressionValue : null });
  }
  return needing;
}
function showTMPrompt(exercises) {
  if (!exercises.length) return;
  document.getElementById('tm-prompt-exercises').innerHTML = exercises.map(ex => {
    const e1rm = getBest1RM(ex.exerciseId, null); const e1rmText = e1rm > 0 ? `Use E1RM (est. ${Math.round(e1rm)}${appDb.unit})` : null;
    const typeLabel = ex.hasPctProg ? '% Progression' : `Rep Goal (${ex.repGoalTarget} reps)`;
    return `<div class="tm-ex-block" id="tm-block-${ex.exerciseId}"><div class="tm-ex-name">${ex.exData ? ex.exData.name : ex.exerciseId}</div><div class="tm-ex-type">Type: <span>${typeLabel}</span></div><div class="tm-input-row"><input type="number" id="tm-input-${ex.exerciseId}" placeholder="${ex.hasPctProg?'Training Max':'Starting Weight'} (${appDb.unit})" step="2.5">${e1rmText && ex.hasPctProg ? `<button class="tm-use-e1rm" onclick="useTME1RM('${ex.exerciseId}',${Math.round(e1rm)})">Use E1RM</button>` : ''}</div><span class="tm-skip" onclick="skipTMSetup('${ex.exerciseId}')">Skip for now</span><div class="tm-warning" id="tm-warn-${ex.exerciseId}">No baseline set — weight will not auto-fill.</div></div>`;
  }).join('');
  document.getElementById('tm-prompt-overlay').classList.add('open');
}
function useTME1RM(exId, val) { document.getElementById(`tm-input-${exId}`).value = val; }
function skipTMSetup(exId) { document.getElementById(`tm-warn-${exId}`).classList.add('show'); document.getElementById(`tm-input-${exId}`).value = ''; document.getElementById(`tm-input-${exId}`).disabled = true; const btn = document.querySelector(`#tm-block-${exId} .tm-use-e1rm`); if (btn) btn.disabled = true; }
function closeTMPrompt() {
  const prog = appDb.programs.find(p => p.id === currentWorkout?.programId);
  if (!prog) { document.getElementById('tm-prompt-overlay').classList.remove('open'); return; }
  const session = prog.microcycles[currentWorkout.microcycleIdx]?.sessions[currentWorkout.sessionIdx];
  if (!session) { document.getElementById('tm-prompt-overlay').classList.remove('open'); return; }
  for (const ex of session.exercises) {
    const input = document.getElementById(`tm-input-${ex.exerciseId}`); if (!input || input.disabled) continue;
    const val = parseFloat(input.value); if (!val || isNaN(val)) continue;
    const hasPctProg = ex.sets && ex.sets.some(s => s.progression === 'pct1rm');
    const hasRepGoal = ex.sets && ex.sets.some(s => s.progression === 'rep_goal');
    const repGoalTarget = hasRepGoal ? +ex.sets.find(s => s.progression === 'rep_goal')?.progressionValue : null;
    const bw = getWorkoutBW(); const exData = getExercise(ex.exerciseId); const isBW = exData && exData.tracking === 'bodyweight_reps';
    if (hasPctProg) setProgTM(prog, ex.exerciseId, { value: val, lockedBW: isBW ? bw : null });
    else if (hasRepGoal) setProgTM(prog, ex.exerciseId, { repGoalBase: val, repGoalTarget, repGoalProgressions: 0 });
  }
  document.getElementById('tm-prompt-overlay').classList.remove('open');
  autoFillProgramWeights(); renderWorkoutExercises();
}
function openSingleTMPrompt(exIdx) {
  if (!currentWorkout?.programId) return;
  const prog = appDb.programs.find(p => p.id === currentWorkout.programId); if (!prog) return;
  const ex = currentWorkout.exercises[exIdx];
  const session = prog.microcycles[currentWorkout.microcycleIdx]?.sessions[currentWorkout.sessionIdx]; if (!session) return;
  const sessEx = session.exercises.find(e => e.exerciseId === ex.exerciseId); if (!sessEx) return;
  const hasPctProg = sessEx.sets && sessEx.sets.some(s => s.progression === 'pct1rm');
  const hasRepGoal = sessEx.sets && sessEx.sets.some(s => s.progression === 'rep_goal');
  const repGoalTarget = hasRepGoal ? +sessEx.sets.find(s => s.progression === 'rep_goal')?.progressionValue : null;
  const exData = getExercise(ex.exerciseId); const e1rm = getBest1RM(ex.exerciseId, null);
  const typeLabel = hasPctProg ? '% Progression' : `Rep Goal (${repGoalTarget} reps)`;
  const e1rmText = e1rm > 0 && hasPctProg ? `Use E1RM (est. ${Math.round(e1rm)}${appDb.unit})` : null;
  document.getElementById('tm-prompt-exercises').innerHTML = `<div class="tm-ex-block" id="tm-block-${ex.exerciseId}"><div class="tm-ex-name">${exData ? exData.name : ex.exerciseId}</div><div class="tm-ex-type">Type: <span>${typeLabel}</span></div><div class="tm-input-row"><input type="number" id="tm-input-${ex.exerciseId}" placeholder="${hasPctProg?'Training Max':'Starting Weight'} (${appDb.unit})" step="2.5">${e1rmText ? `<button class="tm-use-e1rm" onclick="useTME1RM('${ex.exerciseId}',${Math.round(e1rm)})">Use E1RM</button>` : ''}</div><span class="tm-skip" onclick="skipTMSetup('${ex.exerciseId}')">Skip</span><div class="tm-warning" id="tm-warn-${ex.exerciseId}">No baseline set.</div></div>`;
  document.getElementById('tm-prompt-overlay').classList.add('open');
}
function autoFillProgramWeights() {
  if (!currentWorkout?.programId) return;
  const prog = appDb.programs.find(p => p.id === currentWorkout.programId); if (!prog) return;
  const session = prog.microcycles[currentWorkout.microcycleIdx]?.sessions[currentWorkout.sessionIdx]; if (!session) return;
  currentWorkout.exercises.forEach(ex => {
    const sessEx = session.exercises.find(e => e.exerciseId === ex.exerciseId); if (!sessEx) return;
    const tmData = getProgTM(prog, ex.exerciseId); if (!tmData) return;
    ex.sets.forEach((s, si) => {
      const sessSet = sessEx.sets ? sessEx.sets[si] : null; if (!sessSet) return;
      if (sessSet.progression === 'pct1rm' && sessSet.progressionValue && tmData.value) {
        const pct = parseFloat(sessSet.progressionValue); if (!pct) return;
        s.weight = String(roundToIncrement((pct / 100) * tmData.value)); s.autoFilled = true; s.autoType = 'pct';
      } else if (sessSet.progression === 'rep_goal' && tmData.repGoalBase != null) {
        const inc = appDb.unit === 'kg' ? 1.25 : 2.5;
        s.weight = String(tmData.repGoalBase + ((tmData.repGoalProgressions||0) * inc));
        s.reps = String(sessSet.progressionValue || tmData.repGoalTarget || ''); s.autoFilled = true; s.autoType = 'rep_goal';
      }
    });
  });
}
function updateRepGoalProgressions(prog, workout) {
  if (!prog || !workout) return;
  const session = prog.microcycles[workout.microcycleIdx]?.sessions[workout.sessionIdx]; if (!session) return;
  let changed = false;
  session.exercises.forEach(sessEx => {
    const hasRepGoal = sessEx.sets && sessEx.sets.some(s => s.progression === 'rep_goal'); if (!hasRepGoal) return;
    const tmData = getProgTM(prog, sessEx.exerciseId); if (!tmData || tmData.repGoalBase == null) return;
    const loggedEx = workout.exercises.find(e => e.exerciseId === sessEx.exerciseId); if (!loggedEx) return;
    if (loggedEx.sets.some(s => +s.reps >= tmData.repGoalTarget)) {
      tmData.repGoalProgressions = (tmData.repGoalProgressions || 0) + 1;
      if (!prog.trainingMaxes) prog.trainingMaxes = {};
      prog.trainingMaxes[sessEx.exerciseId] = tmData; changed = true;
    }
  });
  if (changed) fsSaveProgram(prog);
}

// ==================== PROGRESSION V1 — EVALUATION ONLY (Build 2) ====================
// Reads progression rules from the ACTIVE PROGRAM INSTANCE's own copied microcycles —
// never the original Plan template. Produces pass/fail/not_evaluable results only.
// Nothing here applies a change, edits a prescription, or mutates the Plan template
// or the active instance's prescriptions. That is deferred to a later build.

// Reads a prescribed (Plan-format) set and returns the single number it must be
// measured against, plus whether that's a reps target or a time target.
function getTargetThreshold(set) {
  if (!set) return { mode: null, value: null };
  if (set.repsType === 'fixed' && set.reps !== '' && set.reps != null && !isNaN(parseFloat(set.reps))) {
    return { mode: 'reps', value: parseFloat(set.reps) };
  }
  if (set.repsType === 'range' && set.minReps !== '' && set.minReps != null && !isNaN(parseFloat(set.minReps))) {
    return { mode: 'reps', value: parseFloat(set.minReps) };
  }
  if (set.timeType === 'fixed' && set.seconds !== '' && set.seconds != null && !isNaN(parseFloat(set.seconds))) {
    return { mode: 'time', value: parseFloat(set.seconds) };
  }
  if (set.timeType === 'range' && set.minSeconds !== '' && set.minSeconds != null && !isNaN(parseFloat(set.minSeconds))) {
    return { mode: 'time', value: parseFloat(set.minSeconds) };
  }
  return { mode: null, value: null };
}

// Reads a logged (Logger-format) set and returns the actual reps/time value.
// Unchecked/incomplete sets always count as no result (null), never as zero.
function getActualValue(loggedSet, mode) {
  if (!loggedSet || !loggedSet.completed) return null;
  if (mode === 'reps') {
    return (loggedSet.reps !== '' && loggedSet.reps != null && !isNaN(parseFloat(loggedSet.reps))) ? parseFloat(loggedSet.reps) : null;
  }
  if (mode === 'time') {
    return (loggedSet.time !== '' && loggedSet.time != null && !isNaN(parseFloat(loggedSet.time))) ? parseFloat(loggedSet.time) : null;
  }
  return null;
}

function evaluateStrictMatch(loggedSets, prescribedSets) {
  const evaluable = [];
  (prescribedSets || []).forEach((pSet, i) => {
    const threshold = getTargetThreshold(pSet);
    if (threshold.mode !== null) evaluable.push({ idx: i, threshold });
  });
  if (!evaluable.length) return { status: 'not_evaluable', message: 'No evaluable rep/time target found.' };

  let passedCount = 0;
  evaluable.forEach(({ idx, threshold }) => {
    const actual = getActualValue((loggedSets || [])[idx], threshold.mode);
    if (actual !== null && actual >= threshold.value) passedCount++;
  });
  const total = evaluable.length;
  const status = passedCount === total ? 'passed' : 'failed';
  return {
    status,
    targetDescription: `${total} target set${total !== 1 ? 's' : ''} ${status === 'passed' ? 'met' : 'required'}`,
    actualDescription: `${passedCount}/${total} sets passed`
  };
}

function evaluateVolumeTotal(loggedSets, prescribedSets) {
  const thresholds = (prescribedSets || []).map(pSet => getTargetThreshold(pSet));
  const mode = thresholds.some(t => t.mode === 'reps') ? 'reps' : (thresholds.some(t => t.mode === 'time') ? 'time' : null);
  if (!mode) return { status: 'not_evaluable', message: 'No evaluable rep/time target found.' };

  let targetVolume = 0, actualVolume = 0;
  thresholds.forEach((threshold, i) => {
    if (threshold.mode !== mode) return;
    targetVolume += threshold.value;
    const actual = getActualValue((loggedSets || [])[i], mode);
    actualVolume += (actual !== null ? actual : 0);
  });
  if (targetVolume <= 0) return { status: 'not_evaluable', message: 'No evaluable rep/time target found.' };

  const unitLabel = mode === 'reps' ? 'reps' : 'sec';
  const status = actualVolume >= targetVolume ? 'passed' : 'failed';
  return {
    status,
    targetDescription: `${targetVolume} target ${unitLabel}`,
    actualDescription: `${actualVolume} ${unitLabel} completed`
  };
}

function evaluateGatewaySet(loggedSets, prescribedSets, gatewaySetIndex) {
  const sets = prescribedSets || [];
  let idx = gatewaySetIndex || 0;
  if (idx < 0 || idx >= sets.length) idx = 0;
  const pSet = sets[idx];
  const threshold = getTargetThreshold(pSet);
  if (threshold.mode === null) return { status: 'not_evaluable', message: 'No evaluable rep/time target found.' };

  const unitLabel = threshold.mode === 'reps' ? 'reps' : 'sec';
  const loggedSet = (loggedSets || [])[idx];
  if (!loggedSet || !loggedSet.completed) {
    return {
      status: 'failed',
      targetDescription: `Gateway Set ${idx + 1} target: ${threshold.value} ${unitLabel}`,
      actualDescription: 'Set not completed'
    };
  }
  const actual = getActualValue(loggedSet, threshold.mode);
  const status = (actual !== null && actual >= threshold.value) ? 'passed' : 'failed';
  return {
    status,
    targetDescription: `Gateway Set ${idx + 1} target: ${threshold.value} ${unitLabel}`,
    actualDescription: `Actual: ${actual !== null ? actual : '\u2014'} ${unitLabel}`
  };
}

// Evaluates one progression-enabled exercise prescription against what was logged.
// loggedExercise: an entry from workout.exercises (Logger format)
// prescribedExercise: the matching entry from the active instance's session.exercises (Plan format)
function evaluateExerciseProgression(loggedExercise, prescribedExercise) {
  const prog = prescribedExercise.progression || {};
  const evalType = prog.evaluationType || 'strict';
  const prescribedSets = prescribedExercise.sets || [];
  const loggedSets = loggedExercise.sets || [];
  const exData = getExercise(prescribedExercise.exerciseId);
  const exerciseName = exData ? exData.name : prescribedExercise.exerciseId;

  let evalResult;
  if (evalType === 'volume') evalResult = evaluateVolumeTotal(loggedSets, prescribedSets);
  else if (evalType === 'gateway') evalResult = evaluateGatewaySet(loggedSets, prescribedSets, prog.gatewaySetIndex || 0);
  else evalResult = evaluateStrictMatch(loggedSets, prescribedSets);

  if (evalResult.status === 'not_evaluable') {
    return {
      exerciseId: prescribedExercise.exerciseId,
      exerciseName,
      evaluationType: evalType,
      status: 'not_evaluable',
      message: evalResult.message || 'No evaluable rep/time target found.'
    };
  }

  // Load increases can only ever be suggested against a fixed-load set — this does
  // not apply anything, it only records whether a future build would be able to.
  const canSuggestLoadIncrease = prescribedSets.some(s => s.loadType === 'fixed' && s.weight !== '' && s.weight != null && !isNaN(parseFloat(s.weight)));
  const rawLoad = parseFloat(prog.loadIncrease);
  const loadIncrease = (!isNaN(rawLoad) && rawLoad > 0) ? rawLoad : (appDb.unit === 'kg' ? 2.5 : 5);

  let message;
  if (evalResult.status === 'passed') {
    message = canSuggestLoadIncrease
      ? 'Target met. Load increase can be suggested.'
      : 'Target met, but no fixed-load set is available for load increase.';
  } else {
    message = 'Target not met. Repeat prescription.';
  }

  return {
    exerciseId: prescribedExercise.exerciseId,
    exerciseName,
    evaluationType: evalType,
    status: evalResult.status,
    targetDescription: evalResult.targetDescription || '',
    actualDescription: evalResult.actualDescription || '',
    loadIncrease,
    adjustmentType: prog.adjustmentType || 'addLoad',
    failBehavior: prog.failBehavior || 'repeat',
    canSuggestLoadIncrease,
    message
  };
}

// Evaluates every progression-enabled exercise in the session this workout came from.
// workout: currentWorkout (must have activeProgramId/activeMicrocycleIdx/activeSessionIdx)
// activeProgram: the active program instance record (its own copied microcycles — never the template)
function evaluateWorkoutProgression(workout, activeProgram) {
  if (!workout || !activeProgram) return [];
  const mcs = activeProgram.microcycles || [];
  const mc = mcs[workout.activeMicrocycleIdx];
  const session = mc && mc.sessions ? mc.sessions[workout.activeSessionIdx] : null;
  if (!session) return [];
  const results = [];
  (session.exercises || []).forEach(sessEx => {
    if (!sessEx.progression || !sessEx.progression.enabled) return;
    const loggedEx = (workout.exercises || []).find(e => e.exerciseId === sessEx.exerciseId);
    if (!loggedEx) return; // exercise wasn't logged this session — nothing to evaluate
    results.push(evaluateExerciseProgression(loggedEx, sessEx));
  });
  return results;
}

// ==================== START WORKOUT ====================
function startNewWorkout(programId, microcycleIdx, sessionIdx) {
  const name = (programId != null) ? getProgramSessionName(programId, microcycleIdx, sessionIdx) : '';
  currentWorkout = { id: uid(), name, date: Date.now(), exercises: [], rpeEnabled: false, duration: 0, bodyweight: null, programId: programId||null, microcycleIdx: microcycleIdx!=null?microcycleIdx:null, sessionIdx: sessionIdx!=null?sessionIdx:null };
  if (programId != null) {
    const prog = appDb.programs.find(p => p.id === programId);
    if (prog) {
      const sess = prog.microcycles[microcycleIdx].sessions[sessionIdx];
      currentWorkout.exercises = sess.exercises.map(ex => ({ exerciseId: ex.exerciseId, sets: (ex.sets||[]).map(s => ({ weight: s.weight||'', reps: s.reps||'', time: s.time||'', rpe: '', autoFilled: false, autoType: null, completed: false })), perfVideos: [] }));
      const needingSetup = getExercisesNeedingTMSetup();
      autoFillProgramWeights();
      if (needingSetup.length > 0) setTimeout(() => showTMPrompt(needingSetup), 300);
    }
  }
  document.getElementById('workout-exercises').innerHTML = '';
  const nameDisplay = document.getElementById('log-session-name-display');
  if (nameDisplay) nameDisplay.textContent = (name || 'NEW WORKOUT').toUpperCase();
  renderWorkoutExercises(); showPage('page-log'); startWorkoutTimer();
}
function getProgramSessionName(progId, mi, si) { const prog = appDb.programs.find(p => p.id === progId); if (!prog) return ''; const sess = prog.microcycles[mi].sessions[si]; return `Week ${mi+1} · ${sess.name || `Day ${si+1}`}`; }

// ==================== RENDER WORKOUT ====================
function renderWorkoutExercises() {
  const c = document.getElementById('workout-exercises');
  if (!currentWorkout?.exercises.length) { c.innerHTML = '<div style="text-align:center;padding:30px 0;color:var(--text3);font-size:15px">Add exercises below to begin logging</div>'; return; }
  c.innerHTML = currentWorkout.exercises.map((ex, i) => buildExerciseBlock(ex, i)).join('');
  currentWorkout.exercises.forEach((ex, i) => ex.sets.forEach((s, si) => attachSwipeToSet(i, si)));
}
function buildExerciseBlock(ex, idx) {
  const exData = getExercise(ex.exerciseId); const name = exData ? exData.name : ex.exerciseId;
  const note = getExNote(ex.exerciseId); const prev = getPreviousPerf(ex.exerciseId);
  const rpe = currentWorkout.rpeEnabled;
  const isTime = exData && (exData.tracking === 'time' || exData.tracking === 'weight_time');
  const isBW   = exData && exData.tracking === 'bodyweight_reps';
  const col2Label = isBW ? 'Added Wt' : appDb.unit.toUpperCase(); const col3Label = isTime ? 'Time(s)' : 'Reps';
  const exrxUrl = EXRX_LINKS[ex.exerciseId];
  const exrxHtml = exrxUrl ? `<a href="${exrxUrl}" target="_blank" class="exrx-link" title="View on ExRx.net"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></a>` : '';
  let metaBadgesHtml = '';
  if (prev) metaBadgesHtml += `<span class="ex-meta-badge" style="cursor:pointer" onclick="openExHistoryModal('${ex.exerciseId}')">Last: ${prev.replace(appDb.unit,'').replace(appDb.unit.toLowerCase(),'').trim()}</span>`;
  if (currentWorkout.programId) {
    const prog = appDb.programs.find(p => p.id === currentWorkout.programId);
    if (prog) {
      const tmData = getProgTM(prog, ex.exerciseId);
      if (tmData && tmData.value) metaBadgesHtml += `<span class="ex-meta-badge" style="cursor:pointer" onclick="openSingleTMPrompt(${idx})">TM: ${tmData.value}</span>`;
      else if (tmData && tmData.repGoalBase != null) metaBadgesHtml += `<span class="ex-meta-badge" style="cursor:pointer" onclick="openSingleTMPrompt(${idx})">Base: ${tmData.repGoalBase}</span>`;
    }
  } else if (currentWorkout.activeProgramId && hasActiveTMTarget(idx)) {
    const active = appDb.programs.find(p => p.id === currentWorkout.activeProgramId);
    const tmVal = active ? getActiveTrainingMax(active, ex.exerciseId) : null;
    if (tmVal != null) metaBadgesHtml += `<span class="ex-meta-badge" style="cursor:pointer" onclick="openActiveTMEditModal(${idx})">TM: ${tmVal}</span>`;
  }
  const hasVideos = (ex.perfVideos||[]).length > 0;
  metaBadgesHtml += `<span class="ex-meta-badge" style="cursor:pointer;color:${hasVideos ? 'var(--accent3)' : 'var(--text3)'};padding:2px 6px" onclick="openVideosModal(${idx})"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="display:block"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg></span>`;
  let tmControls = '';
  if (currentWorkout.programId) {
    const prog = appDb.programs.find(p => p.id === currentWorkout.programId);
    if (prog) {
      const session = prog.microcycles[currentWorkout.microcycleIdx]?.sessions[currentWorkout.sessionIdx];
      if (session) {
        const sessEx = session.exercises.find(e => e.exerciseId === ex.exerciseId);
        if (sessEx?.sets) {
          const hasPct = sessEx.sets.some(s => s.progression === 'pct1rm'); const hasRG = sessEx.sets.some(s => s.progression === 'rep_goal');
          if (hasPct || hasRG) {
            const tmData = getProgTM(prog, ex.exerciseId);
            if (!tmData || (!tmData.value && tmData.repGoalBase == null)) {
              tmControls = `<div style="margin-bottom:8px"><span style="font-size:12px;color:var(--red);font-family:var(--font-display);font-weight:600;letter-spacing:0.04em">No baseline set</span><button class="btn btn-ghost btn-sm" style="font-size:11px;padding:4px 9px;margin-left:8px" onclick="openSingleTMPrompt(${idx})">${hasPct?'Set TM':'Set Baseline'}</button></div>`;
            }
          }
        }
      }
    }
  } else if (currentWorkout.activeProgramId && hasActiveTMTarget(idx)) {
    const active = appDb.programs.find(p => p.id === currentWorkout.activeProgramId);
    const tmVal = active ? getActiveTrainingMax(active, ex.exerciseId) : null;
    if (tmVal == null) {
      tmControls = `<div style="margin-bottom:8px"><span style="font-size:12px;color:var(--red);font-family:var(--font-display);font-weight:600;letter-spacing:0.04em">No Training Max set</span><button class="btn btn-ghost btn-sm" style="font-size:11px;padding:4px 9px;margin-left:8px" onclick="openActiveTMEditModal(${idx})">Set TM</button></div>`;
    }
  }
  const notesHtml = `<div><div class="ex-notes-label">Notes <span class="ex-notes-hide-btn" id="notes-hide-btn-${idx}" onclick="toggleNotesSection(${idx})">Hide</span></div><div class="ex-notes-content" id="ex-notes-content-${idx}" onclick="openNotesEditModal(${idx})" style="cursor:pointer">${note ? escapeHtml(note) : '<span style="color:var(--text3);font-style:italic">Tap to add notes...</span>'}</div></div>`;
  const hdrCls = rpe ? 'set-header with-rpe' : 'set-header';
  return `<div class="exercise-item" id="ex-block-${idx}">
    <div class="exercise-item-header"><div class="exercise-item-name">${name}${exrxHtml}</div><button class="ex-menu-btn" onclick="openExerciseMenu(event,${idx})">•••</button></div>
    <div class="exercise-meta-row">${metaBadgesHtml}</div>
    ${tmControls}
    <div style="margin-top:24px" id="ex-notes-section-${idx}">${notesHtml}</div>
    <div style="margin-top:24px">
      <div class="${hdrCls}"><div class="set-label">✓</div><div class="set-label">${col2Label}</div><div class="set-label">${col3Label}</div>${rpe ? '<div class="set-label">RPE</div>' : ''}</div>
      <div id="sets-container-${idx}">${buildSetsHTML(ex, idx, isTime, rpe)}</div>
      <div class="ex-action-row"><button class="btn btn-ghost" style="background:#222222;border-color:#5C5C5C" onclick="addSet(${idx})">+ Set</button><button class="btn btn-ghost" onclick="addPRSet(${idx})" style="background:#222222;color:var(--accent2);border-color:rgba(255,170,0,0.4)">+ PR Set</button></div>
    </div>
  </div>`;
}
function buildSetsHTML(ex, exIdx, isTime, rpe) {
  const rowCls = rpe ? 'set-row with-rpe' : 'set-row';
  return ex.sets.map((s, si) => {
    const inputCls = s.autoFilled ? 'set-input auto-filled' : 'set-input';
    const repCls   = (s.autoFilled && s.autoType === 'rep_goal') ? 'set-input auto-filled' : 'set-input';
    const wrapCls  = s.completed ? 'set-row-wrap completed' : 'set-row-wrap';
    const badgesHtml = buildSetBadgesHtml(s);
    const gridCols = rpe ? `40px 1fr 1fr 64px${badgesHtml ? ' auto' : ''}` : `40px 1fr 1fr${badgesHtml ? ' auto' : ''}`;
    return `<div class="${wrapCls}" id="set-wrap-${exIdx}-${si}">
      <div class="${rowCls}" id="set-row-${exIdx}-${si}" style="grid-template-columns:${gridCols}">
        <input type="checkbox" class="set-checkbox" ${s.completed?'checked':''} onchange="onSetChecked(${exIdx},${si},this.checked)">
        <input class="${inputCls}" type="number" placeholder="0" value="${s.weight||''}" oninput="updateSet(${exIdx},${si},'weight',this.value);this.classList.remove('auto-filled')" step="0.5">
        <input class="${repCls}" type="number" placeholder="0" value="${s.reps||s.time||''}" oninput="updateSet(${exIdx},${si},'${isTime?'time':'reps'}',this.value)" step="1">
        ${rpe ? `<input class="set-input" type="number" placeholder="RPE" value="${s.rpe||''}" oninput="updateSet(${exIdx},${si},'rpe',this.value)" min="1" max="10" step="0.5">` : ''}
        <div class="set-badges" id="set-badges-${exIdx}-${si}">${badgesHtml}</div>
      </div>
      <div class="set-delete-btn" onclick="removeSet(${exIdx},${si})">Delete</div>
    </div>
    ${s.targetSummary ? `<div class="plan-target-line">Target: ${s.targetSummary}${buildSetNoteTagHtml(s, exIdx, si)}</div>` : ''}
    ${buildSetNoteBodyHtml(s, exIdx, si)}
    <div class="pr-target-line" id="pr-line-${exIdx}-${si}"></div>`;
  }).join('');
}
function buildSetNoteTagHtml(s, exIdx, si) {
  const note = s.targetData && s.targetData.notes ? s.targetData.notes.trim() : '';
  if (!note) return '';
  return ` <span class="plan-note-tag plan-note-tag-clickable" onclick="toggleSetNote(${exIdx},${si})">NOTE</span>`;
}
function buildSetNoteBodyHtml(s, exIdx, si) {
  const note = s.targetData && s.targetData.notes ? s.targetData.notes.trim() : '';
  if (!note) return '';
  return `<div class="plan-set-note-body" id="plan-set-note-${exIdx}-${si}" style="display:none">${escapeHtml(note)}</div>`;
}
function toggleSetNote(exIdx, si) {
  const el = document.getElementById(`plan-set-note-${exIdx}-${si}`);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}
function buildSetBadgesHtml(s) {
  if (!s.completed) return '';
  let html = '';
  if (s.isPR && s.weight) html += `<span class="set-badge-pr">PR: ${s.weight}</span>`;
  if (s.isNew1RM && s.weight && s.reps) html += `<span class="set-badge-1rm">1RM: ${Math.round(calc1RM(+s.weight, +s.reps))}</span>`;
  return html;
}
function attachSwipeToSet(exIdx, si) {
  const wrap = document.getElementById(`set-wrap-${exIdx}-${si}`); const row = document.getElementById(`set-row-${exIdx}-${si}`);
  if (!wrap || !row) return;
  let startX = 0, currentX = 0, swiping = false;
  wrap.addEventListener('touchstart', e => { startX = e.touches[0].clientX; currentX = startX; swiping = true; }, { passive: true });
  wrap.addEventListener('touchmove', e => { if (!swiping) return; currentX = e.touches[0].clientX; const diff = startX - currentX; row.style.transform = diff > 0 ? `translateX(${-Math.min(diff,70)}px)` : 'translateX(0)'; }, { passive: true });
  wrap.addEventListener('touchend', () => { if (!swiping) return; swiping = false; row.style.transform = (startX - currentX) > 60 ? 'translateX(-70px)' : 'translateX(0)'; });
}

// ==================== SET OPERATIONS ====================
function updateSet(exIdx, setIdx, field, val) {
  if (!currentWorkout) return;
  currentWorkout.exercises[exIdx].sets[setIdx][field] = val;
  if (field === 'weight') currentWorkout.exercises[exIdx].sets[setIdx].autoFilled = false;
  const key = `${exIdx}-${setIdx}`;
  if (prDebounceTimers[key]) clearTimeout(prDebounceTimers[key]);
  prDebounceTimers[key] = setTimeout(() => checkSetPR(exIdx, setIdx), 400);
}
function checkSetPR(exIdx, setIdx) {
  if (!currentWorkout) return;
  const s = currentWorkout.exercises[exIdx].sets[setIdx];
  if (s.weight && s.reps) { s.isNew1RM = calc1RM(+s.weight, +s.reps) > getBest1RM(currentWorkout.exercises[exIdx].exerciseId, currentWorkout.id); s.isPR = +s.weight > getBestWeight(currentWorkout.exercises[exIdx].exerciseId, currentWorkout.id); }
}
function addSet(idx) {
  const sets = currentWorkout.exercises[idx].sets; const last = sets.length > 0 ? sets[sets.length-1] : null;
  sets.push({ weight: last ? last.weight : '', reps: '', time: '', rpe: '', completed: false });
  const container = document.getElementById(`sets-container-${idx}`); const exData = getExercise(currentWorkout.exercises[idx].exerciseId);
  const isTime = exData && (exData.tracking === 'time' || exData.tracking === 'weight_time');
  if (container) { container.innerHTML = buildSetsHTML(currentWorkout.exercises[idx], idx, isTime, currentWorkout.rpeEnabled); currentWorkout.exercises[idx].sets.forEach((s, si) => attachSwipeToSet(idx, si)); } else renderWorkoutExercises();
}
function removeSet(exIdx, si) {
  currentWorkout.exercises[exIdx].sets.splice(si, 1);
  const container = document.getElementById(`sets-container-${exIdx}`); const exData = getExercise(currentWorkout.exercises[exIdx].exerciseId);
  const isTime = exData && (exData.tracking === 'time' || exData.tracking === 'weight_time');
  if (container) { container.innerHTML = buildSetsHTML(currentWorkout.exercises[exIdx], exIdx, isTime, currentWorkout.rpeEnabled); currentWorkout.exercises[exIdx].sets.forEach((s, si) => attachSwipeToSet(exIdx, si)); } else renderWorkoutExercises();
}

// ==================== PR SET ====================
function addPRSet(idx) {
  if (!currentWorkout) return;
  const ex = currentWorkout.exercises[idx]; const exData = getExercise(ex.exerciseId); if (!exData) return;
  const isTime = exData.tracking === 'time' || exData.tracking === 'weight_time'; const isBW = exData.tracking === 'bodyweight_reps';
  const inc = appDb.unit === 'kg' ? 1.25 : 2.5;
  let newSet = { weight: '', reps: '', time: '', rpe: '', completed: false }; let targetInfo = '';
  if (isTime) {
    const best = getBestTime(ex.exerciseId); if (!best) { showToast('No previous time found', 'error'); return; }
    newSet.time = String(best + 5); ex.sets.push(newSet); targetInfo = `Target: ${best+5}s (best: ${best}s)`;
  } else if (isBW) {
    const bw = getWorkoutBW(); const currentE1RM = getBestE1RMForExercise(ex.exerciseId, bw);
    if (currentE1RM > 0 && bw) {
      const result = calcPRWeightReps(currentE1RM + 1, inc, bw); if (!result) { showToast('No PR found', 'error'); return; }
      newSet.weight = result.addedWeight > 0 ? String(result.addedWeight) : ''; newSet.reps = String(result.reps); ex.sets.push(newSet); targetInfo = `Target E1RM: ${Math.round(currentE1RM+1)}${appDb.unit}`;
    } else {
      const bestReps = getBestReps(ex.exerciseId); if (!bestReps) { showToast('No PR found', 'error'); return; }
      newSet.reps = String(bestReps + 1); ex.sets.push(newSet); targetInfo = `Target: ${bestReps+1} reps`;
    }
  } else {
    const currentE1RM = getBest1RM(ex.exerciseId, null); if (!currentE1RM) { showToast('No PR found', 'error'); return; }
    const result = calcPRWeightReps(currentE1RM + 1, inc, 0); if (!result) { showToast('No PR found', 'error'); return; }
    newSet.weight = String(result.addedWeight); newSet.reps = String(result.reps); ex.sets.push(newSet); targetInfo = `Target E1RM: ${Math.round(currentE1RM+1)}${appDb.unit}`;
  }
  const newSi = ex.sets.length - 1;
  const container = document.getElementById(`sets-container-${idx}`); const isTimeEx = exData.tracking === 'time' || exData.tracking === 'weight_time';
  if (container) { container.innerHTML = buildSetsHTML(ex, idx, isTimeEx, currentWorkout.rpeEnabled); ex.sets.forEach((s, si) => attachSwipeToSet(idx, si)); } else renderWorkoutExercises();
  if (targetInfo) setTimeout(() => { const line = document.getElementById(`pr-line-${idx}-${newSi}`); if (line) { line.textContent = targetInfo; line.classList.add('visible'); } }, 50);
}
function calcPRWeightReps(targetE1RM, inc, bwOffset) {
  let bestResult = null, bestExcess = Infinity;
  for (let r = 2; r <= 15; r++) {
    const rawWeight = targetE1RM / (1 + r / 30) - bwOffset; if (rawWeight < 0) continue;
    const roundedWeight = Math.ceil(rawWeight / inc) * inc;
    const actualE1RM = calc1RM(roundedWeight + bwOffset, r); const excess = actualE1RM - targetE1RM; if (excess < 0) continue;
    if (excess < bestExcess || (excess === bestExcess && r < (bestResult?.reps || 99))) { bestExcess = excess; bestResult = { addedWeight: roundedWeight, reps: r, actualE1RM }; }
  }
  return bestResult;
}

// ==================== FINISH / CANCEL ====================
function finishWorkout() {
  if (!currentWorkout) return;
  const nameDisplay = document.getElementById('log-session-name-display'); const nm = nameDisplay ? nameDisplay.textContent.trim() : '';
  currentWorkout.name = (nm && nm !== 'NEW WORKOUT') ? nm : `Workout ${new Date(currentWorkout.date).toLocaleDateString('en-US',{month:'short',day:'numeric'})}`;
  currentWorkout.exercises.forEach(e => { e.sets = e.sets.filter(s => s.weight||s.reps||s.time); });
  currentWorkout.exercises = currentWorkout.exercises.filter(e => e.sets.length);
  if (!currentWorkout.exercises.length) { showToast('Add at least one set first','error'); return; }
  if (currentWorkout._isEdit) {
    const originalDuration = currentWorkout.duration; delete currentWorkout._isEdit; currentWorkout.duration = originalDuration;
    const idx = appDb.workouts.findIndex(w => w.id === currentWorkout.id);
    if (idx !== -1) appDb.workouts[idx] = currentWorkout;
    fsSaveWorkout(currentWorkout);
    const timerEl = document.getElementById('log-timer-display'); if (timerEl) { timerEl.style.opacity = ''; timerEl.style.pointerEvents = ''; }
    stopWorkoutTimer(); currentWorkout = null; showToast('Workout updated!', 'success'); showPage('page-home'); return;
  }
  currentWorkout.duration = getElapsedSeconds();
  let reviewActive = null, reviewPending = null;
  if (currentWorkout.programId) {
    const prog = appDb.programs.find(p => p.id === currentWorkout.programId);
    if (prog) {
      prog.lastUsed = Date.now();
      const flatIdx = getProgramFlatIndex(prog, currentWorkout.microcycleIdx, currentWorkout.sessionIdx);
      if (!prog.completedSessionIndices) prog.completedSessionIndices = [];
      if (!prog.completedSessionIndices.includes(flatIdx)) prog.completedSessionIndices.push(flatIdx);
      updateRepGoalProgressions(prog, currentWorkout);
      const totalSessions = prog.microcycles.reduce((a, mc) => a + mc.sessions.length, 0);
      if (prog.completedSessionIndices.length >= totalSessions) { prog.completedSessionIndices = []; prog.trainingMaxes = {}; showToast('Program complete! Great work.', 'success'); }
      fsSaveProgram(prog);
    }
  } else if (currentWorkout.activeProgramId) {
    const active = appDb.programs.find(p => p.id === currentWorkout.activeProgramId);
    if (active) {
      const key = planSessionKey(currentWorkout.activeMicrocycleIdx, currentWorkout.activeSessionIdx);
      if (!active.completedSessionKeys) active.completedSessionKeys = [];
      if (!active.completedSessionKeys.includes(key)) active.completedSessionKeys.push(key);
      active.updatedAt = Date.now();

      // Progression V1 — evaluation only (Build 2). Reads rules from this active
      // instance's own copied microcycles. Does not apply any change, and does not
      // touch the Plan template or this instance's prescriptions.
      const progressionResults = evaluateWorkoutProgression(currentWorkout, active);
      if (progressionResults.length) {
        currentWorkout.progressionResults = progressionResults;
        if (!active.pendingProgressionResults) active.pendingProgressionResults = [];
        const pendingEntry = {
          id: uid(),
          workoutId: currentWorkout.id,
          completedAt: Date.now(),
          sessionKey: key,
          results: progressionResults
        };
        active.pendingProgressionResults.push(pendingEntry);
        console.log('Progression evaluated:', progressionResults);
        reviewActive = active;
        reviewPending = pendingEntry;
      }

      const totalSessions = planCountActiveSessions(active);
      if (totalSessions > 0 && active.completedSessionKeys.length >= totalSessions) {
        active.status = 'complete';
        showToast('Program complete! Great work.', 'success');
      }
      fsSaveProgram(active);
    }
  }
  appDb.workouts.unshift(currentWorkout); fsSaveWorkout(currentWorkout); stopWorkoutTimer(); currentWorkout = null;
  if (reviewActive && reviewPending) {
    showProgressionReview(reviewActive, reviewPending);
  } else {
    showToast('Workout saved!','success'); showPage('page-home');
  }
}
function cancelWorkout() { confirm2('Cancel Workout','Discard this workout? All data will be lost.', () => { stopWorkoutTimer(); currentWorkout = null; showPage('page-home'); }, 'Discard'); }

// ==================== PROGRESSION V1 — SUGGESTIONS REVIEW (Build 3) ====================
// Consumes the read-only evaluation results from Build 2 and lets the user Apply,
// Edit, or Skip each actionable suggestion. Only ever modifies the ACTIVE PROGRAM
// INSTANCE's own future (not-yet-completed) sessions — the original Plan template
// and the just-completed workout are never touched.

function getProgReviewContext() {
  if (!progReviewActiveId || !progReviewPendingId) return null;
  const active = appDb.programs.find(p => p.id === progReviewActiveId);
  if (!active) return null;
  const pending = (active.pendingProgressionResults || []).find(p => p.id === progReviewPendingId);
  if (!pending) return null;
  return { active, pending };
}

function showProgressionReview(active, pendingEntry) {
  progReviewActiveId = active.id;
  progReviewPendingId = pendingEntry.id;
  renderProgressionReview();
  openModal('modal-progression-review');
}

function renderProgressionReview() {
  const body = document.getElementById('progression-review-body');
  if (!body) return;
  const ctx = getProgReviewContext();
  if (!ctx) {
    body.innerHTML = `<div class="plan-profile-empty">Nothing to review.</div><button class="btn btn-primary" style="width:100%;margin-top:14px" onclick="closeProgressionReview()">Done</button>`;
    return;
  }
  const { active, pending } = ctx;
  const results = pending.results || [];
  const rowsHtml = results.map((r, idx) => buildProgressionReviewRow(r, idx, pending, active)).join('');
  body.innerHTML = `
    <div style="font-size:14px;color:var(--text2);margin-bottom:14px;line-height:1.5">Review suggested changes before applying them to this active program.</div>
    ${rowsHtml}
    <button class="btn btn-primary" style="width:100%;margin-top:14px" onclick="closeProgressionReview()">Done</button>
  `;
}

function buildProgressionReviewRow(r, idx, pending, active) {
  const unit = appDb.unit === 'kg' ? 'kg' : 'lb';
  const evalLabel = r.evaluationType === 'volume' ? 'Volume Total' : r.evaluationType === 'gateway' ? 'Gateway Set' : 'Strict Match';
  const statusColor = r.status === 'passed' ? 'var(--green)' : r.status === 'failed' ? 'var(--red)' : 'var(--text3)';
  const statusLabel = r.status === 'passed' ? 'Passed' : r.status === 'failed' ? 'Failed' : 'Not Evaluable';

  let detailHtml;
  if (r.status === 'passed' && r.canSuggestLoadIncrease) {
    detailHtml = `<div class="prog-review-detail">${escapeHtml(r.targetDescription || '')}${r.actualDescription ? ' \u2014 ' + escapeHtml(r.actualDescription) : ''}</div>`;
  } else {
    detailHtml = `<div class="prog-review-detail">${escapeHtml(r.message || '')}</div>`;
  }

  let controlsHtml = '';
  if (r.decision) {
    const isSkip = r.decision === 'skipped';
    const noMatch = !isSkip && (!r.affectedSetCount || r.affectedSetCount === 0);
    const tagClass = (isSkip || noMatch) ? 'prog-review-done-tag prog-review-done-tag--skip' : 'prog-review-done-tag';
    let tagText;
    if (isSkip) tagText = 'Skipped';
    else if (noMatch) tagText = 'No matching future sets found';
    else tagText = `Applied: +${r.appliedIncrease} ${unit} to ${r.affectedSetCount} set${r.affectedSetCount !== 1 ? 's' : ''}`;
    controlsHtml = `<div class="${tagClass}">${tagText}</div>`;
  } else if (r.status === 'passed' && r.canSuggestLoadIncrease) {
    if (active.status === 'complete') {
      controlsHtml = `<div class="prog-review-detail" style="color:var(--text3);font-style:italic;margin-top:6px">Program complete \u2014 no future sessions to update.</div>`;
    } else if (r._editing) {
      controlsHtml = `
        <div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap">
          <input type="number" step="0.5" id="prog-edit-input-${pending.id}-${idx}" value="${r.loadIncrease}" style="max-width:90px">
          <span style="font-size:13px;color:var(--text3)">${unit}</span>
          <button class="btn btn-primary btn-sm" onclick="confirmProgressionEdit('${pending.id}',${idx})">Confirm</button>
          <button class="btn btn-ghost btn-sm" onclick="cancelProgressionEdit('${pending.id}',${idx})">Cancel</button>
        </div>`;
    } else {
      controlsHtml = `
        <div style="font-size:13px;color:var(--text2);margin-top:6px">Suggested increase: +${r.loadIncrease} ${unit}</div>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="applyProgressionSuggestion('${pending.id}',${idx})">Apply</button>
          <button class="btn btn-secondary btn-sm" onclick="startProgressionEdit('${pending.id}',${idx})">Edit</button>
          <button class="btn btn-ghost btn-sm" onclick="skipProgressionSuggestion('${pending.id}',${idx})">Skip</button>
        </div>`;
    }
  }

  return `
    <div class="prog-review-row">
      <div class="prog-review-name">${escapeHtml(r.exerciseName || r.exerciseId)}</div>
      <div class="prog-review-status" style="color:${statusColor}">${statusLabel} \u2022 ${evalLabel}</div>
      ${detailHtml}
      ${controlsHtml}
    </div>
  `;
}

function startProgressionEdit(pendingId, idx) {
  const ctx = getProgReviewContext();
  if (!ctx || ctx.pending.id !== pendingId) return;
  const r = ctx.pending.results[idx]; if (!r) return;
  r._editing = true;
  renderProgressionReview();
}

function cancelProgressionEdit(pendingId, idx) {
  const ctx = getProgReviewContext();
  if (!ctx || ctx.pending.id !== pendingId) return;
  const r = ctx.pending.results[idx]; if (!r) return;
  delete r._editing;
  renderProgressionReview();
}

function applyProgressionSuggestion(pendingId, idx) {
  runProgressionDecision(pendingId, idx, null);
}

function confirmProgressionEdit(pendingId, idx) {
  const input = document.getElementById(`prog-edit-input-${pendingId}-${idx}`);
  const val = input ? parseFloat(input.value) : NaN;
  if (isNaN(val) || val <= 0) { showToast('Enter a valid increase', 'error'); return; }
  runProgressionDecision(pendingId, idx, val);
}

// Shared by Apply (customIncrease = null, uses the suggested amount) and
// Edit-confirm (customIncrease = the user's entered number).
function runProgressionDecision(pendingId, idx, customIncrease) {
  const ctx = getProgReviewContext();
  if (!ctx || ctx.pending.id !== pendingId) return;
  const { active, pending } = ctx;
  const r = pending.results[idx]; if (!r) return;

  if (active.status === 'complete') {
    showToast('Program complete \u2014 no future sessions to update', 'error');
    return;
  }

  const increase = (customIncrease != null && !isNaN(customIncrease)) ? customIncrease : r.loadIncrease;
  const { affectedSetCount, affectedSessionCount } = applyLoadIncreaseToFutureSessions(active, r.exerciseId, increase);

  r.decision = customIncrease != null ? 'edited' : 'applied';
  r.appliedIncrease = increase;
  r.affectedSetCount = affectedSetCount;
  r.affectedSessionCount = affectedSessionCount;
  delete r._editing;

  logProgressionDecision(active, pending, r, affectedSetCount, affectedSessionCount);
  fsSaveProgram(active);

  const unit = appDb.unit === 'kg' ? 'kg' : 'lb';
  showToast(
    affectedSetCount > 0
      ? `Applied +${increase} ${unit} to ${affectedSetCount} future set${affectedSetCount !== 1 ? 's' : ''}`
      : 'No matching future sets found',
    'success'
  );
  renderProgressionReview();
}

function skipProgressionSuggestion(pendingId, idx) {
  const ctx = getProgReviewContext();
  if (!ctx || ctx.pending.id !== pendingId) return;
  const { active, pending } = ctx;
  const r = pending.results[idx]; if (!r) return;
  r.decision = 'skipped';
  r.appliedIncrease = null;
  delete r._editing;

  logProgressionDecision(active, pending, r, 0, 0);
  fsSaveProgram(active);
  renderProgressionReview();
}

function logProgressionDecision(active, pending, r, affectedSetCount, affectedSessionCount) {
  if (!active.progressionDecisionLog) active.progressionDecisionLog = [];
  active.progressionDecisionLog.push({
    id: uid(),
    workoutId: pending.workoutId,
    sessionKey: pending.sessionKey,
    completedAt: pending.completedAt,
    exerciseId: r.exerciseId,
    exerciseName: r.exerciseName,
    evaluationType: r.evaluationType,
    status: r.status,
    decision: r.decision,
    suggestedIncrease: r.loadIncrease,
    appliedIncrease: r.appliedIncrease,
    affectedSetCount,
    affectedSessionCount,
    createdAt: Date.now()
  });
}

// Sessions in this active instance that are not yet completed. Because the
// just-finished session's key was already added to completedSessionKeys earlier
// in finishWorkout(), it is automatically excluded here — never re-touched.
function getFutureUnfinishedSessions(active) {
  const mcs = Array.isArray(active.microcycles) ? active.microcycles : [];
  const completed = active.completedSessionKeys || [];
  const result = [];
  for (let mi = 0; mi < mcs.length; mi++) {
    const sessions = Array.isArray(mcs[mi].sessions) ? mcs[mi].sessions : [];
    for (let si = 0; si < sessions.length; si++) {
      const key = planSessionKey(mi, si);
      if (!completed.includes(key)) result.push({ mi, si, key, session: sessions[si] });
    }
  }
  return result;
}

// Only ever mutates this active instance's own future session data — never the
// Plan template, never a completed session, never a non-fixed-load set.
function applyLoadIncreaseToFutureSessions(active, exerciseId, increase) {
  const futureSessions = getFutureUnfinishedSessions(active);
  let affectedSetCount = 0, affectedSessionCount = 0;
  console.log('[progression] applying', { exerciseId, increase, futureSessionCount: futureSessions.length, completedSessionKeys: active.completedSessionKeys });
  futureSessions.forEach(({ mi, si, key, session }) => {
    let sessionAffected = false;
    (session.exercises || []).forEach(ex => {
      if (ex.exerciseId !== exerciseId) return;
      (ex.sets || []).forEach((s, setIdx) => {
        const isFixed = s.loadType === 'fixed' && s.weight !== '' && s.weight != null && !isNaN(parseFloat(s.weight));
        console.log('[progression] checking set', { sessionKey: key, mi, si, exerciseId, setIdx, loadType: s.loadType, weight: s.weight, isFixed });
        if (isFixed) {
          const before = s.weight;
          s.weight = Math.round((parseFloat(s.weight) + increase) * 100) / 100;
          console.log('[progression] set updated', { sessionKey: key, exerciseId, setIdx, before, after: s.weight });
          affectedSetCount++;
          sessionAffected = true;
        }
      });
    });
    if (sessionAffected) affectedSessionCount++;
  });
  console.log('[progression] apply summary', { exerciseId, increase, affectedSessionCount, affectedSetCount });
  return { affectedSetCount, affectedSessionCount };
}

function markProgressionPendingHandled(active, pendingId) {
  if (!active || !active.pendingProgressionResults) return;
  const idx = active.pendingProgressionResults.findIndex(p => p.id === pendingId);
  if (idx !== -1) active.pendingProgressionResults.splice(idx, 1);
}

function closeProgressionReview() {
  const ctx = getProgReviewContext();
  if (ctx) {
    markProgressionPendingHandled(ctx.active, ctx.pending.id);
    fsSaveProgram(ctx.active);
  }
  closeModal('modal-progression-review');
  progReviewActiveId = null;
  progReviewPendingId = null;
  showToast('Workout saved!', 'success');
  showPage('page-home');
}

// ==================== EXERCISE HISTORY MODAL ====================
function openExHistoryModal(exId) {
  const exData = getExercise(exId); document.getElementById('ex-history-modal-title').textContent = exData ? exData.name : exId;
  const workoutsWithEx = appDb.workouts.filter(w => w.exercises.some(e => e.exerciseId === exId)).slice(0, 3);
  const body = document.getElementById('ex-history-modal-body');
  if (!workoutsWithEx.length) { body.innerHTML = '<div class="empty-state" style="padding:30px 0"><h3>No History</h3><p>Not logged yet</p></div>'; openModal('modal-ex-history'); return; }
  body.innerHTML = workoutsWithEx.map(w => {
    const ex = w.exercises.find(e => e.exerciseId === exId); const d = new Date(w.date).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
    return `<div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border)"><div style="font-family:var(--font-display);font-size:16px;font-weight:800;color:var(--accent);margin-bottom:6px">${w.name}</div><div style="font-size:13px;color:var(--text3);margin-bottom:8px">${d}</div>${ex.sets.map((s,i)=>{ let line=`Set ${i+1}: `; if(s.weight&&+s.weight>0)line+=`${s.weight}${appDb.unit} \u00d7 ${s.reps||s.time||'\u2014'}`; else if(s.reps)line+=`BW \u00d7 ${s.reps}`; else if(s.time)line+=`${s.time}s`; else line+='\u2014'; return `<div class="history-set-line">${line}</div>`; }).join('')}</div>`;
  }).join('');
  openModal('modal-ex-history');
}

// ==================== PROGRAM PICKER ====================
function openProgramPickerModal() {
  if (!appDb.programs.length) { showToast('No programs yet. Create one first.','error'); return; }
  const sorted = [...appDb.programs].sort((a,b) => (b.lastUsed||0)-(a.lastUsed||0));
  document.getElementById('prog-picker-list').innerHTML = sorted.map(p => {
    const next = getNextSessionForProgram(p); const totalSessions = p.microcycles.reduce((a,mc) => a + mc.sessions.length, 0); const completed = (p.completedSessionIndices||[]).length;
    let statusText = next === null ? 'Program Complete' : (() => { const sname = p.microcycles[next.microcycleIdx].sessions[next.sessionIdx].name || `Day ${next.sessionIdx+1}`; return `Next: Week ${next.microcycleIdx+1} \u00b7 ${sname}`; })();
    return `<div class="prog-pick-item" onclick="selectProgramForWorkout('${p.id}')"><div><div class="prog-pick-name">${p.name}</div><div class="prog-pick-meta">${statusText} \u00b7 ${completed}/${totalSessions} sessions done</div></div><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="color:var(--accent);flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg></div>`;
  }).join('');
  openModal('modal-prog-picker');
}
function selectProgramForWorkout(progId) {
  const prog = appDb.programs.find(p => p.id === progId); if (!prog) return;
  const next = getNextSessionForProgram(prog); closeModal('modal-prog-picker');
  if (next === null) { confirm2('Program Complete', `"${prog.name}" is finished! Restart from Week 1?`, () => { prog.completedSessionIndices = []; prog.trainingMaxes = {}; prog.lastUsed = Date.now(); fsSaveProgram(prog); startNewWorkout(prog.id, 0, 0); }, 'Restart'); return; }
  startNewWorkout(prog.id, next.microcycleIdx, next.sessionIdx);
}
function getNextSessionForProgram(prog) {
  const completed = prog.completedSessionIndices || []; let flatIdx = 0;
  const mcs = Array.isArray(prog.microcycles) ? prog.microcycles : [];
  for (let mi = 0; mi < mcs.length; mi++) {
    const sessions = Array.isArray(mcs[mi].sessions) ? mcs[mi].sessions : [];
    for (let si = 0; si < sessions.length; si++) {
      if (!completed.includes(flatIdx)) return { microcycleIdx: mi, sessionIdx: si };
      flatIdx++;
    }
  }
  return null;
}
function getProgramFlatIndex(prog, mi, si) { let idx = 0; for (let m = 0; m < mi; m++) idx += prog.microcycles[m].sessions.length; return idx + si; }

// ==================== HISTORY ====================
function getWorkoutHighlights(w) {
  const highlights = [];
  for (const e of w.exercises) {
    if (highlights.length >= 2) break;
    const exData = getExercise(e.exerciseId); const name = exData ? exData.name : e.exerciseId;
    const isTime = exData && (exData.tracking === 'time' || exData.tracking === 'weight_time');
    const isBW   = exData && exData.tracking === 'bodyweight_reps'; const isWeighted = !isTime && !isBW;
    let bestSet = null, bestVal = -1;
    for (const s of e.sets) {
      if (isWeighted && s.weight && +s.weight > 0 && s.reps && +s.reps > 0) { const v = calc1RM(+s.weight, +s.reps); if (v > bestVal) { bestVal = v; bestSet = s; } }
      else if (isBW && s.reps && +s.reps > 0) { if (+s.reps > bestVal) { bestVal = +s.reps; bestSet = s; } }
      else if (isTime && s.time && +s.time > 0) { if (+s.time > bestVal) { bestVal = +s.time; bestSet = s; } }
    }
    if (!bestSet) continue;
    let display = '';
    if (isWeighted) display = `${bestSet.weight} × ${bestSet.reps}`;
    else if (isBW) display = `BW × ${bestSet.reps}`;
    else if (isTime) display = `${bestSet.time}s`;
    highlights.push({ name, display });
  }
  return highlights;
}

let historyPageSize = 20, historyShown = 20;
function renderHistory() { renderHistoryStats(); historyShown = historyPageSize; renderHistoryList(); }
function renderHistoryList() {
  const wks = [...appDb.workouts]; const list = document.getElementById('history-list');
  if (!wks.length) { list.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="12 8 12 12 14 14"/><path d="M3.05 11a9 9 0 1 0 .5-4"/></svg><h3>No Workouts Found</h3><p>Start logging to see history here</p></div>'; return; }
  const visible = wks.slice(0, historyShown);
  const showMoreBtn = wks.length > historyShown ? `<div style="padding:16px;text-align:center"><button class="btn btn-secondary" onclick="showMoreHistory()">Show More</button></div>` : '';
  list.innerHTML = visible.map(w => workoutHistoryCard(w)).join('') + showMoreBtn;
}
function showMoreHistory() { historyShown += historyPageSize; renderHistoryList(); }

function openHistoryMenu(e) {
  e.stopPropagation();
  const items = [
    { label: 'Search History', icon: '🔍', action: 'openSearchHistoryModal()' },
    { label: 'Browse by Date', icon: '📅', action: 'openBrowseDateModal()' },
    { divider: true },
    { label: 'Import Data', icon: '⬆', action: 'openImportDirect()' },
    { label: 'Export Data', icon: '⬇', action: 'runExport()' },
  ];
  showDropdown(e.currentTarget, items);
}

const SEARCH_STORAGE_KEY = 'ironlog_recent_searches';
function getRecentSearches() { try { return JSON.parse(localStorage.getItem(SEARCH_STORAGE_KEY) || '[]'); } catch { return []; } }
function saveRecentSearch(term) { if (!term.trim()) return; let s = getRecentSearches().filter(x => x.toLowerCase() !== term.toLowerCase()); s.unshift(term); s = s.slice(0,5); localStorage.setItem(SEARCH_STORAGE_KEY, JSON.stringify(s)); }
function openSearchHistoryModal() { document.getElementById('history-search-input').value = ''; document.getElementById('history-search-results').innerHTML = ''; renderRecentSearches(); openModal('modal-search-history'); setTimeout(() => document.getElementById('history-search-input').focus(), 100); }
function renderRecentSearches() {
  const searches = getRecentSearches(); const el = document.getElementById('history-search-recent'); const q = document.getElementById('history-search-input')?.value.trim() || '';
  if (!searches.length || q) { el.innerHTML = ''; return; }
  el.innerHTML = `<div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text3);margin-bottom:8px">Recent Searches</div>`
    + searches.map(s => { const safe = escapeHtml(s); return `<div onclick="applyRecentSearch(this.dataset.term)" data-term="${safe}" style="padding:10px 12px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;align-items:center;justify-content:space-between;font-family:var(--font-display);font-size:15px;font-weight:700;text-transform:uppercase;color:var(--text2)" onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background=''"><span>${safe}</span><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--text3)"><polyline points="9 18 15 12 9 6"/></svg></div>`; }).join('');
}
function applyRecentSearch(term) { document.getElementById('history-search-input').value = term; runHistorySearch(); }
function runHistorySearch() {
  const raw = document.getElementById('history-search-input').value.trim(); const q = raw.toLowerCase(); const resultsEl = document.getElementById('history-search-results');
  if (!q) { renderRecentSearches(); resultsEl.innerHTML = ''; return; } renderRecentSearches();
  const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const matches = appDb.workouts.filter(w => {
    const d = new Date(w.date); const dateStr = d.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'}).toLowerCase();
    const monthName = MONTHS[d.getMonth()]; const yearStr = String(d.getFullYear());
    if (w.name.toLowerCase().includes(q)) return true; if (dateStr.includes(q)) return true;
    if (monthName.includes(q)) return true; if (yearStr.includes(q)) return true;
    if ((monthName+' '+yearStr).includes(q)) return true;
    if (w.exercises.some(e => { const ex = getExercise(e.exerciseId); return ex && ex.name.toLowerCase().includes(q); })) return true;
    return false;
  });
  if (!matches.length) { resultsEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:14px">No results found</div>'; return; }
  resultsEl.innerHTML = `<div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text3);margin-bottom:8px">${matches.length} Result${matches.length!==1?'s':''}</div>`
    + matches.map(w => { const d = new Date(w.date).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'}); const sets = w.exercises.reduce((a,e)=>a+e.sets.length,0); return `<div onclick="goToSearchResult('${w.id}')" style="padding:12px;border-bottom:1px solid var(--border);cursor:pointer" onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background=''"><div style="font-size:11px;color:var(--text3);margin-bottom:3px">${d}</div><div style="font-family:var(--font-display);font-size:16px;font-weight:800;text-transform:uppercase;color:var(--text)">${w.name}</div><div style="font-size:12px;color:var(--text3);margin-top:2px">${w.exercises.length} exercises · ${sets} sets</div></div>`; }).join('');
}
function goToSearchResult(wid) {
  const raw = document.getElementById('history-search-input').value.trim(); if (raw) saveRecentSearch(raw);
  closeModal('modal-search-history'); const idx = appDb.workouts.findIndex(w => w.id === wid);
  if (idx >= historyShown) historyShown = idx + historyPageSize;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-history').classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  renderHistoryStats(); renderHistoryList();
  setTimeout(() => { const card = document.getElementById(`hist-expanded-${wid}`); if (card) { if (card.style.display === 'none') toggleHistoryCard(wid); document.getElementById(`hist-collapsed-${wid}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, 150);
}
function openBrowseDateModal() {
  const yearEl = document.getElementById('browse-year'); const years = [...new Set(appDb.workouts.map(w => new Date(w.date).getFullYear()))].sort((a,b) => b-a);
  if (!years.length) { showToast('No workouts yet', ''); return; }
  yearEl.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join(''); document.getElementById('browse-month').value = new Date().getMonth(); openModal('modal-browse-date');
}
function browseByDate() {
  const year = parseInt(document.getElementById('browse-year').value); const month = parseInt(document.getElementById('browse-month').value);
  closeModal('modal-browse-date'); const match = appDb.workouts.find(w => { const d = new Date(w.date); return d.getFullYear() === year && d.getMonth() === month; });
  if (!match) { showToast('No workouts found for that month', ''); return; }
  const idx = appDb.workouts.indexOf(match); if (idx >= historyShown) historyShown = idx + historyPageSize;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active')); document.getElementById('page-history').classList.add('active'); document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  renderHistoryStats(); renderHistoryList(); setTimeout(() => { const el = document.getElementById(`hist-collapsed-${match.id}`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 150);
}

function workoutHistoryCard(w, compact=false) {
  const d = new Date(w.date).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
  const sets = w.exercises.reduce((a,e)=>a+e.sets.length,0); const dur = w.duration ? fmtDuration(w.duration) : '';
  const prs = w.exercises.reduce((a,e)=>a+e.sets.filter(s=>s.isPR).length,0); const new1rms = w.exercises.reduce((a,e)=>a+e.sets.filter(s=>s.isNew1RM).length,0);
  const wid = w.id;
  const prBadge = prs > 0 ? `<span class="recent-badge recent-badge-pr">${prs} PR'S</span>` : '';
  const e1rmBadge = new1rms > 0 ? `<span class="recent-badge recent-badge-1rm">${new1rms} New E1RM${new1rms > 1 ? "'S" : ''}</span>` : '';
  const badges = prBadge || e1rmBadge ? `<div class="recent-card-badges">${prBadge}${e1rmBadge}</div>` : '';
  const metaParts = [`${w.exercises.length} Exercises`, `${sets} Sets`]; if (dur) metaParts.push(dur);
  const metaHtml = `<div class="recent-card-meta">${metaParts.join('<span class="recent-meta-dot">•</span>')}</div>`;
  if (compact) {
    return `<div class="recent-card" onclick="toggleRecentCard('${wid}')">
      <div class="recent-card-collapsed" id="recent-collapsed-${wid}"><div class="recent-card-main"><div class="recent-card-date">${d}</div><div class="recent-card-name-row"><div class="recent-card-name">${w.name}</div>${badges}<svg class="recent-card-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg></div>${metaHtml}</div></div>
      <div class="recent-card-expanded" id="recent-expanded-${wid}" style="display:none"></div>
    </div>`;
  }
  const highlights = getWorkoutHighlights(w);
  const highlightsHtml = highlights.length ? `<div class="history-card-highlights" id="hist-highlights-${wid}">${highlights.map(h => `<div class="history-highlight-row"><span class="history-highlight-name">${h.name}</span><span class="history-highlight-val">${h.display}</span></div>`).join('')}</div>` : '';
  return `<div class="recent-card" onclick="toggleHistoryCard('${wid}')">
    <div class="recent-card-collapsed" id="hist-collapsed-${wid}"><div class="recent-card-main"><div class="recent-card-date">${d}</div><div class="recent-card-name-row"><div class="recent-card-name">${w.name}</div>${badges}<svg class="recent-card-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg></div>${metaHtml}${highlightsHtml}</div></div>
    <div class="recent-card-expanded" id="hist-expanded-${wid}" style="display:none"></div>
  </div>`;
}
function toggleHistoryCard(wid) {
  const expanded = document.getElementById(`hist-expanded-${wid}`); const highlights = document.getElementById(`hist-highlights-${wid}`); const chevron = document.querySelector(`#hist-collapsed-${wid} .recent-card-chevron`);
  if (!expanded) return; const isOpen = expanded.style.display !== 'none';
  document.querySelectorAll('[id^="hist-expanded-"]').forEach(el => { el.style.display = 'none'; });
  document.querySelectorAll('[id^="hist-highlights-"]').forEach(el => { el.style.display = ''; });
  document.querySelectorAll('[id^="hist-collapsed-"] .recent-card-chevron').forEach(el => { el.style.transform = ''; });
  if (!isOpen) { expanded.innerHTML = buildRecentExpandedHtml(wid); expanded.style.display = 'block'; if (highlights) highlights.style.display = 'none'; if (chevron) chevron.style.transform = 'rotate(180deg)'; }
}
function toggleRecentCard(wid) {
  const expanded = document.getElementById(`recent-expanded-${wid}`); const chevron = document.querySelector(`#recent-collapsed-${wid} .recent-card-chevron`);
  if (!expanded) return; const isOpen = expanded.style.display !== 'none';
  document.querySelectorAll('.recent-card-expanded').forEach(el => { el.style.display = 'none'; }); document.querySelectorAll('.recent-card-chevron').forEach(el => { el.style.transform = ''; });
  if (!isOpen) { expanded.innerHTML = buildRecentExpandedHtml(wid); expanded.style.display = 'block'; if (chevron) chevron.style.transform = 'rotate(180deg)'; }
}
function buildRecentExpandedHtml(wid) {
  const w = appDb.workouts.find(x => x.id === wid); if (!w) return '';
  const exercisesHtml = w.exercises.map((e, ei) => {
    const ex = getExercise(e.exerciseId); const name = ex ? ex.name : e.exerciseId;
    const isTime = ex && (ex.tracking === 'time' || ex.tracking === 'weight_time');
    const perfVideos = e.perfVideos || []; const refVideos = getExVideos(e.exerciseId);
    const hasVideos = perfVideos.length > 0 || refVideos.length > 0;
    const videoIcon = hasVideos ? `<span class="recent-ex-video-btn" onclick="openExpandedVideosModal('${wid}',${ei});event.stopPropagation()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" stroke-width="2.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg></span>` : '';
    const setsHtml = e.sets.map(s => {
      let weightStr = '', xStr = '', repsStr = '';
      if (s.weight && +s.weight > 0) { weightStr = `${s.weight}`; xStr = '×'; repsStr = `${s.reps||s.time||'—'}`; }
      else if (s.reps) { weightStr = 'BW'; xStr = '×'; repsStr = `${s.reps}`; }
      else if (s.time) { weightStr = `${s.time}s`; }
      const prBadge = s.isPR ? `<span class="recent-badge recent-badge-pr" style="font-size:10px;padding:1px 6px;display:inline-block;min-width:72px;text-align:center">PR: ${s.weight}</span>` : `<span style="display:inline-block;min-width:72px"></span>`;
      const e1rmBadge = s.isNew1RM && s.weight && s.reps ? `<span class="recent-badge recent-badge-1rm" style="font-size:10px;padding:1px 6px;display:inline-block;min-width:72px;text-align:center">E1RM: ${Math.round(calc1RM(+s.weight,+s.reps))}</span>` : (s.isPR ? `<span style="display:inline-block;min-width:72px"></span>` : '');
      return `<div class="recent-set-row"><span class="recent-set-weight">${weightStr}</span><span class="recent-set-x">${xStr}</span><span class="recent-set-reps">${repsStr}</span><span class="recent-set-badges">${prBadge}${e1rmBadge}</span></div>`;
    }).join('');
    return `<div class="recent-ex-block"><div class="recent-ex-name-row"><span class="recent-ex-num">${ei+1}</span><span class="recent-ex-name">${name}</span>${videoIcon}</div><div class="recent-ex-sets">${setsHtml}</div></div>`;
  }).join('');
  return `<div class="recent-expanded-inner"><div class="recent-ex-list">${exercisesHtml}</div><div class="recent-expanded-actions"><button class="btn btn-secondary" style="flex:1;justify-content:center" onclick="editHistoricalWorkout('${wid}');event.stopPropagation()">Edit</button><button class="btn btn-secondary" style="flex:1;justify-content:center" onclick="openCopyModal('${wid}');event.stopPropagation()">Export</button></div></div>`;
}
function openExpandedVideosModal(wid, exIdx) {
  const w = appDb.workouts.find(x => x.id === wid); if (!w) return;
  const e = w.exercises[exIdx]; const ex = getExercise(e.exerciseId); const perfVideos = e.perfVideos || []; const refVideos = getExVideos(e.exerciseId);
  document.getElementById('ex-videos-modal-title').textContent = ex ? ex.name : 'Videos';
  const refHtml = refVideos.length ? `<div style="margin-bottom:12px"><div class="video-section-label">Reference Videos</div>${refVideos.map(v => `<div class="video-link-row"><a class="video-link" href="${v}" target="_blank">${v}</a></div>`).join('')}</div>` : '';
  const perfHtml = perfVideos.length ? `<div><div class="video-section-label">This Session</div>${perfVideos.map(v => `<div class="video-link-row"><a class="video-link" href="${v}" target="_blank">${v}</a></div>`).join('')}</div>` : '';
  document.getElementById('ex-videos-modal-body').innerHTML = refHtml + perfHtml || '<div style="color:var(--text3);font-size:14px">No videos found.</div>';
  openModal('modal-ex-videos');
}
function editHistoricalWorkout(wid) {
  const w = appDb.workouts.find(x => x.id === wid); if (!w) return;
  currentWorkout = JSON.parse(JSON.stringify(w)); currentWorkout._isEdit = true;
  const nameDisplay = document.getElementById('log-session-name-display'); if (nameDisplay) nameDisplay.textContent = (w.name || 'WORKOUT').toUpperCase();
  const timerEl = document.getElementById('log-timer-display'); if (timerEl) { timerEl.textContent = w.duration ? fmtDuration(w.duration) : '0:00'; timerEl.style.opacity = '0.5'; timerEl.style.pointerEvents = 'none'; }
  document.getElementById('active-bar').classList.remove('visible'); renderWorkoutExercises(); showPage('page-log');
}
function deleteWorkout(id) { confirm2('Delete Workout','Permanently delete this workout log?', () => { appDb.workouts = appDb.workouts.filter(w=>w.id!==id); fsDelWorkout(id); renderHistory(); showToast('Workout deleted'); }); }

// ==================== ADD EXERCISE TO WORKOUT ====================
function addExToWorkout(exId) { if (!currentWorkout) return; currentWorkout.exercises.push({ exerciseId: exId, sets: [{ weight:'', reps:'', time:'', rpe:'', completed:false }], perfVideos:[] }); renderWorkoutExercises(); }

// ==================== PROGRAMS ====================
function renderPrograms() {
  document.getElementById('programs-list').innerHTML = appDb.programs.length ? appDb.programs.map(p => programCard(p)).join('') :
    '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><h3>No Programs Yet</h3><p>Create a program to plan your training</p></div>';
}
function programCard(prog) {
  const next = getNextSessionForProgram(prog); const totalSessions = prog.microcycles.reduce((a,mc)=>a+mc.sessions.length,0);
  const completed = (prog.completedSessionIndices||[]).length; const isComplete = next===null;
  const dayCounts = prog.microcycles.map(mc=>mc.sessions.length); const allEqual = dayCounts.every(d=>d===dayCounts[0]);
  const daysPerWeekBadge = allEqual&&dayCounts[0]>0 ? `<span class="badge badge-blue">${dayCounts[0]} days/week</span>` : '';
  const _sname = !isComplete ? (prog.microcycles[next.microcycleIdx].sessions[next.sessionIdx].name||`Day ${next.sessionIdx+1}`) : '';
  let startBtnHtml = isComplete
    ? `<button class="btn btn-ghost btn-sm" onclick="restartProgram('${prog.id}')">Restart Program</button>`
    : `<button class="btn btn-primary btn-sm" onclick="selectProgramForWorkout('${prog.id}')">Start — Week ${!isComplete?next.microcycleIdx+1:''} · ${_sname}</button>`;
  const descId = `prog-desc-${prog.id}`; const descText = prog.notes||'';
  const descHtml = `<div style="margin-top:8px;margin-bottom:10px"><div class="prog-desc-view" id="${descId}-view" onclick="startEditProgDesc('${prog.id}')">${descText||'<span class="prog-desc-placeholder">Add a description...</span>'}</div><div class="prog-desc-edit" id="${descId}-edit"><textarea style="width:100%;margin-top:4px;min-height:70px;font-size:14px" placeholder="Goals, description...">${descText}</textarea><div style="display:flex;gap:8px;margin-top:6px"><button class="btn btn-primary btn-sm" onclick="saveProgDesc('${prog.id}')">Save</button><button class="btn btn-ghost btn-sm" onclick="cancelProgDesc('${prog.id}')">Cancel</button></div></div></div>`;
  const tmSummary = buildTMSummary(prog);
  const weeks = prog.microcycles.map((mc,mi) => {
    const mcId = `mc-${prog.id}-${mi}`;
    return `<div style="margin-bottom:6px"><div class="microcycle-row" onclick="toggleMicrocycle('${prog.id}',${mi});event.stopPropagation()"><div><div class="microcycle-label">Week ${mi+1}</div><div style="font-size:13px;color:var(--text3);margin-top:2px">${mc.sessions.filter(s=>s.exercises.length).length}/${mc.sessions.length} sessions planned</div></div><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--text3)" id="${mcId}-chevron"><polyline points="6 9 12 15 18 9"/></svg></div><div id="${mcId}" style="display:none;padding:8px 0 4px 0">${mc.sessions.map((s,si)=>{ const flatIdx=getProgramFlatIndex(prog,mi,si); const isDone=(prog.completedSessionIndices||[]).includes(flatIdx); const isFirst=si===0,isLast=si===mc.sessions.length-1; return `<div style="background:var(--surface2);border:1px solid ${isDone?'rgba(46,213,115,0.3)':'var(--border)'};border-radius:var(--radius-sm);padding:10px 12px;margin-bottom:6px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><div style="cursor:pointer;flex:1" onclick="openSessionModal('${prog.id}',${mi},${si})"><div style="font-family:var(--font-display);font-size:15px;font-weight:700;text-transform:uppercase;display:flex;align-items:center;gap:7px">${s.name||'Day '+(si+1)} ${isDone?'<span class="badge badge-green" style="font-size:10px;padding:2px 7px">Done</span>':''}</div><div style="font-size:13px;color:var(--text3);margin-top:2px">${s.exercises.length} exercise${s.exercises.length!==1?'s':''} · tap to edit</div></div><div style="display:flex;gap:5px;flex-shrink:0;margin-left:8px">${!isFirst?`<button class="btn-icon btn-sm" onclick="moveDayLeft('${prog.id}',${mi},${si});event.stopPropagation()">&larr;</button>`:'<div style="width:34px"></div>'}${!isLast?`<button class="btn-icon btn-sm" onclick="moveDayRight('${prog.id}',${mi},${si});event.stopPropagation()">&rarr;</button>`:'<div style="width:34px"></div>'}<button class="btn-icon btn-sm" onclick="openMoveToWeekModal('${prog.id}',${mi},${si});event.stopPropagation()" style="color:var(--accent3);font-size:11px;padding:6px">&harr;</button><button class="btn-icon btn-sm" onclick="duplicateDay('${prog.id}',${mi},${si});event.stopPropagation()" style="color:var(--accent2);font-size:11px">+</button><button class="btn-icon btn-sm" style="color:var(--red)" onclick="removeDay('${prog.id}',${mi},${si});event.stopPropagation()">x</button></div></div></div>`; }).join('')}<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" onclick="addDay('${prog.id}',${mi});event.stopPropagation()">+ Add Day</button><button class="btn btn-ghost btn-sm" onclick="duplicateWeek('${prog.id}',${mi});event.stopPropagation()" style="color:var(--accent2);border-color:rgba(255,170,0,0.3)">+ Duplicate Week</button><button class="btn btn-danger btn-sm" onclick="removeWeek('${prog.id}',${mi});event.stopPropagation()">Remove Week</button></div></div></div>`;
  }).join('');
  return `<div class="program-card" id="prog-card-${prog.id}" style="transition:border-color 0.4s"><div class="program-card-header"><div style="flex:1"><div class="program-name">${prog.name}</div><div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap"><span class="badge badge-accent">${prog.microcycles.length} weeks</span>${daysPerWeekBadge}<span class="badge ${isComplete?'badge-green':'badge-orange'}">${completed}/${totalSessions} done</span></div>${descHtml}</div><button class="btn-icon" style="color:var(--red);margin-left:8px;flex-shrink:0" onclick="deleteProg('${prog.id}')">x</button></div><div style="margin-bottom:12px">${startBtnHtml}</div>${tmSummary}${weeks}<div style="margin-top:8px"><button class="btn btn-secondary" style="width:100%" onclick="addWeek('${prog.id}')">+ Add Week</button></div></div>`;
}
function buildTMSummary(prog) {
  if (!prog.trainingMaxes||!Object.keys(prog.trainingMaxes).length) return '';
  const lines = Object.entries(prog.trainingMaxes).map(([exId,tmData])=>{ const ex=getExercise(exId); const name=ex?ex.name:exId; if(tmData.value)return`${name}: TM ${tmData.value}${appDb.unit}`; if(tmData.repGoalBase!=null)return`${name}: Base ${tmData.repGoalBase}${appDb.unit} (${tmData.repGoalTarget} reps)`; return null; }).filter(Boolean);
  if (!lines.length) return '';
  return `<div style="margin-top:8px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px"><div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--accent2);margin-bottom:6px">Training Maxes / Baselines</div>${lines.map(l=>`<div style="font-size:13px;color:var(--text2);margin-bottom:3px">${l}</div>`).join('')}</div>`;
}
function startEditProgDesc(progId){document.getElementById(`prog-desc-${progId}-view`).style.display='none';document.getElementById(`prog-desc-${progId}-edit`).classList.add('open');}
function saveProgDesc(progId){const prog=appDb.programs.find(p=>p.id===progId);if(!prog)return;const ta=document.querySelector(`#prog-desc-${progId}-edit textarea`);prog.notes=ta?ta.value.trim():'';fsSaveProgram(prog);document.getElementById(`prog-desc-${progId}-view`).style.display='';document.getElementById(`prog-desc-${progId}-edit`).classList.remove('open');const viewEl=document.getElementById(`prog-desc-${progId}-view`);if(viewEl)viewEl.innerHTML=prog.notes?prog.notes:'<span class="prog-desc-placeholder">Add a description...</span>';showToast('Description saved','success');}
function cancelProgDesc(progId){document.getElementById(`prog-desc-${progId}-view`).style.display='';document.getElementById(`prog-desc-${progId}-edit`).classList.remove('open');}
function addWeek(progId){const prog=appDb.programs.find(p=>p.id===progId);if(!prog)return;prog.microcycles.push({week:prog.microcycles.length+1,sessions:[]});fsSaveProgram(prog);renderPrograms();showToast('Week added','success');}
function duplicateWeek(progId,mi){const prog=appDb.programs.find(p=>p.id===progId);if(!prog)return;const copy=JSON.parse(JSON.stringify(prog.microcycles[mi]));copy.week=prog.microcycles.length+1;prog.microcycles.splice(mi+1,0,copy);fsSaveProgram(prog);renderPrograms();showToast('Week duplicated','success');}
function removeWeek(progId,mi){const prog=appDb.programs.find(p=>p.id===progId);if(!prog)return;confirm2('Remove Week',`Remove Week ${mi+1}?`,()=>{prog.microcycles.splice(mi,1);fsSaveProgram(prog);renderPrograms();showToast('Week removed','success');},'Remove');}
function addDay(progId,mi){const prog=appDb.programs.find(p=>p.id===progId);if(!prog)return;prog.microcycles[mi].sessions.push({name:`Day ${prog.microcycles[mi].sessions.length+1}`,exercises:[]});fsSaveProgram(prog);renderPrograms();setTimeout(()=>{const el=document.getElementById(`mc-${progId}-${mi}`);if(el)el.style.display='block';},50);showToast('Day added','success');}
function duplicateDay(progId,mi,si){const prog=appDb.programs.find(p=>p.id===progId);if(!prog)return;const copy=JSON.parse(JSON.stringify(prog.microcycles[mi].sessions[si]));copy.name=copy.name+' (Copy)';prog.microcycles[mi].sessions.splice(si+1,0,copy);fsSaveProgram(prog);renderPrograms();setTimeout(()=>{const el=document.getElementById(`mc-${progId}-${mi}`);if(el)el.style.display='block';},50);showToast('Day duplicated','success');}
function removeDay(progId,mi,si){const prog=appDb.programs.find(p=>p.id===progId);if(!prog)return;const sname=prog.microcycles[mi].sessions[si].name||`Day ${si+1}`;confirm2('Remove Day',`Remove "${sname}" from Week ${mi+1}?`,()=>{prog.microcycles[mi].sessions.splice(si,1);fsSaveProgram(prog);renderPrograms();setTimeout(()=>{const el=document.getElementById(`mc-${progId}-${mi}`);if(el)el.style.display='block';},50);showToast('Day removed','success');},'Remove');}
function moveDayLeft(progId,mi,si){if(si===0)return;const prog=appDb.programs.find(p=>p.id===progId);const arr=prog.microcycles[mi].sessions;[arr[si-1],arr[si]]=[arr[si],arr[si-1]];fsSaveProgram(prog);renderPrograms();setTimeout(()=>{const el=document.getElementById(`mc-${progId}-${mi}`);if(el)el.style.display='block';},50);}
function moveDayRight(progId,mi,si){const prog=appDb.programs.find(p=>p.id===progId);const arr=prog.microcycles[mi].sessions;if(si===arr.length-1)return;[arr[si],arr[si+1]]=[arr[si+1],arr[si]];fsSaveProgram(prog);renderPrograms();setTimeout(()=>{const el=document.getElementById(`mc-${progId}-${mi}`);if(el)el.style.display='block';},50);}
function openMoveToWeekModal(progId,mi,si){moveDayProgId=progId;moveDayMi=mi;moveDaySi=si;const prog=appDb.programs.find(p=>p.id===progId);if(!prog)return;const sname=prog.microcycles[mi].sessions[si].name||`Day ${si+1}`;document.getElementById('move-week-body').innerHTML=`<div style="margin-bottom:12px;font-size:14px;color:var(--text2)">Move <strong>${sname}</strong> (Week ${mi+1}) to:</div>`+prog.microcycles.map((mc,idx)=>idx===mi?'':`<div onclick="moveDayToWeek(${idx})" style="padding:13px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;align-items:center;justify-content:space-between;background:var(--surface2);border-radius:var(--radius-sm);margin-bottom:6px" onmouseenter="this.style.background='var(--surface3)'" onmouseleave="this.style.background='var(--surface2)'"><div style="font-family:var(--font-display);font-size:16px;font-weight:700;text-transform:uppercase">Week ${idx+1}</div><div style="font-size:13px;color:var(--text3)">${mc.sessions.length} day${mc.sessions.length!==1?'s':''}</div></div>`).join('');openModal('modal-move-week');}
function moveDayToWeek(destMi){const prog=appDb.programs.find(p=>p.id===moveDayProgId);if(!prog)return;const day=prog.microcycles[moveDayMi].sessions.splice(moveDaySi,1)[0];prog.microcycles[destMi].sessions.push(day);fsSaveProgram(prog);closeModal('modal-move-week');renderPrograms();setTimeout(()=>{const el=document.getElementById(`mc-${moveDayProgId}-${destMi}`);if(el)el.style.display='block';},50);showToast(`Day moved to Week ${destMi+1}`,'success');}
function toggleMicrocycle(progId,mi){const el=document.getElementById(`mc-${progId}-${mi}`);const chev=document.getElementById(`mc-${progId}-${mi}-chevron`);if(el){const isOpen=el.style.display!=='none';el.style.display=isOpen?'none':'block';if(chev)chev.style.transform=isOpen?'':'rotate(180deg)';}}
function restartProgram(progId){confirm2('Restart Program','Clear all progress and restart? Your workout history is kept.',()=>{const prog=appDb.programs.find(p=>p.id===progId);if(!prog)return;prog.completedSessionIndices=[];prog.trainingMaxes={};prog.lastUsed=Date.now();fsSaveProgram(prog);renderPrograms();showToast('Program restarted','success');},'Restart');}
function deleteProg(id){confirm2('Delete Program','Permanently delete this program?',()=>{appDb.programs=appDb.programs.filter(p=>p.id!==id);fsDelProgram(id);renderPrograms();showToast('Program deleted');});}

// ==================== SESSION MODAL ====================
function openSessionModal(progId,mi,si){currentProgramId=progId;currentMicrocycleIdx=mi;currentSessionIdx=si;document.getElementById('session-modal-title').textContent=`Week ${mi+1} \u00b7 Day ${si+1}`;renderSessionView();openModal('modal-session');}
function renderSessionView(){
  const prog=appDb.programs.find(p=>p.id===currentProgramId);
  const session=prog.microcycles[currentMicrocycleIdx].sessions[currentSessionIdx];
  document.getElementById('session-modal-body').innerHTML=`<div style="margin-bottom:12px"><button class="btn btn-primary" style="width:100%" onclick="startSessionFromModal('${currentProgramId}',${currentMicrocycleIdx},${currentSessionIdx})">Start This Workout</button></div><div class="form-group"><label>Session Name</label><input type="text" value="${session.name||''}" placeholder="e.g. Push A" oninput="updateSessionName(this.value)"></div><div id="session-exercises-body">${session.exercises.map((ex,i)=>renderSessionExBlock(ex,i)).join('')}</div><button class="btn btn-secondary" style="width:100%;margin-bottom:12px" onclick="renderSessionPicker()">+ Add Exercise</button>`;
}
function startSessionFromModal(progId,mi,si){closeModal('modal-session');startNewWorkout(progId,mi,si);}
function addExToSession(exId){const prog=appDb.programs.find(p=>p.id===currentProgramId);const session=prog.microcycles[currentMicrocycleIdx].sessions[currentSessionIdx];session.exercises.push({exerciseId:exId,sets:[{weight:'',reps:'',progression:'',progressionValue:''}]});fsSaveProgram(prog);renderSessionView();}
function renderSessionExBlock(ex,idx){
  const exData=getExercise(ex.exerciseId);const name=exData?exData.name:ex.exerciseId;
  const isTime=exData&&(exData.tracking==='time'||exData.tracking==='weight_time');
  const setsHTML=(ex.sets||[]).map((s,si)=>{
    const hasProg=s.progression==='pct1rm'||s.progression==='rep_goal';
    const valuePlaceholder=s.progression==='pct1rm'?'e.g. 75':s.progression==='rep_goal'?'Reps':'';
    const gridCols=hasProg?'28px 1fr 1fr 1fr 1fr 34px':'28px 1fr 1fr 1fr 34px';
    return `<div style="display:grid;grid-template-columns:${gridCols};gap:5px;align-items:center;margin-bottom:6px">
      <div style="font-family:var(--font-display);font-size:14px;font-weight:700;color:var(--text3);text-align:center">${si+1}</div>
      <input class="set-input" type="number" placeholder="Wt" value="${s.weight||''}" oninput="updateSessSet(${idx},${si},'weight',this.value)" step="0.5">
      <input class="set-input" type="text" placeholder="${isTime?'Time':'Reps'}" value="${s.reps||s.time||''}" oninput="updateSessSet(${idx},${si},'${isTime?'time':'reps'}',this.value)">
      <select class="set-input" style="font-size:12px;padding:9px 4px" onchange="updateSessSet(${idx},${si},'progression',this.value)">
        <option value="" ${!s.progression?'selected':''}>--</option>
        <option value="pct1rm" ${s.progression==='pct1rm'?'selected':''}>%1RM</option>
        <option value="rep_goal" ${s.progression==='rep_goal'?'selected':''}>Rep Goal</option>
      </select>
      ${hasProg?`<input class="set-input" type="text" placeholder="${valuePlaceholder}" value="${s.progressionValue||''}" oninput="updateSessSet(${idx},${si},'progressionValue',this.value)">`:''}
      <button class="btn-icon" style="padding:5px;color:var(--red);border-color:rgba(255,71,87,0.4)" onclick="removeSessSet(${idx},${si})">x</button>
    </div>`;
  }).join('');
  const anyProg=(ex.sets||[]).some(s=>s.progression==='pct1rm'||s.progression==='rep_goal');
  const firstProg=(ex.sets||[]).find(s=>s.progression==='pct1rm'||s.progression==='rep_goal');
  const valueHeaderLabel=firstProg?.progression==='pct1rm'?'%':firstProg?.progression==='rep_goal'?'Rep Goal':'Value';
  const headerCols=anyProg?'28px 1fr 1fr 1fr 1fr 34px':'28px 1fr 1fr 1fr 34px';
  return`<div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:12px;margin-bottom:10px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div style="font-family:var(--font-display);font-size:17px;font-weight:800;text-transform:uppercase">${name}</div>
      <div style="display:flex;gap:5px"><button class="btn-icon" onclick="moveSessEx(${idx},-1)">&uarr;</button><button class="btn-icon" onclick="moveSessEx(${idx},1)">&darr;</button><button class="btn-icon" style="color:var(--red)" onclick="removeSessEx(${idx})">x</button></div>
    </div>
    <div style="display:grid;grid-template-columns:${headerCols};gap:5px;margin-bottom:5px">
      <div class="set-label">SET</div><div class="set-label">WT</div><div class="set-label">${isTime?'TIME':'REPS'}</div><div class="set-label">PROG</div>${anyProg?`<div class="set-label">${valueHeaderLabel}</div>`:''}
    </div>
    ${setsHTML}
    <div style="margin-top:6px;font-size:11px;color:var(--text3)">Rep Goal / % 1RM = automated progression</div>
    <button class="btn btn-ghost btn-sm" style="width:100%;margin-top:6px" onclick="addSessSet(${idx})">+ Set</button>
  </div>`;
}
function updateSessionName(val){const prog=appDb.programs.find(p=>p.id===currentProgramId);prog.microcycles[currentMicrocycleIdx].sessions[currentSessionIdx].name=val;fsSaveProgram(prog);}
function updateSessSet(exIdx,setIdx,field,val){const prog=appDb.programs.find(p=>p.id===currentProgramId);const session=prog.microcycles[currentMicrocycleIdx].sessions[currentSessionIdx];session.exercises[exIdx].sets[setIdx][field]=val;if(field==='progression')renderSessionView();else fsSaveProgram(prog);}
function addSessSet(exIdx){const prog=appDb.programs.find(p=>p.id===currentProgramId);const session=prog.microcycles[currentMicrocycleIdx].sessions[currentSessionIdx];const sets=session.exercises[exIdx].sets;const last=sets.length>0?sets[sets.length-1]:null;sets.push(last?{weight:last.weight||'',reps:last.reps||'',progression:last.progression||'',progressionValue:last.progressionValue||''}:{weight:'',reps:'',progression:'',progressionValue:''});fsSaveProgram(prog);renderSessionView();}
function removeSessSet(exIdx,setIdx){const prog=appDb.programs.find(p=>p.id===currentProgramId);prog.microcycles[currentMicrocycleIdx].sessions[currentSessionIdx].exercises[exIdx].sets.splice(setIdx,1);fsSaveProgram(prog);renderSessionView();}
function moveSessEx(idx,dir){const prog=appDb.programs.find(p=>p.id===currentProgramId);const arr=prog.microcycles[currentMicrocycleIdx].sessions[currentSessionIdx].exercises;const n=idx+dir;if(n<0||n>=arr.length)return;[arr[idx],arr[n]]=[arr[n],arr[idx]];fsSaveProgram(prog);renderSessionView();}
function removeSessEx(idx){const prog=appDb.programs.find(p=>p.id===currentProgramId);prog.microcycles[currentMicrocycleIdx].sessions[currentSessionIdx].exercises.splice(idx,1);fsSaveProgram(prog);renderSessionView();}

// ==================== EXPORT ====================
function openCopyModal(workoutId){copyWorkoutId=workoutId;copyFormat='phpbb';updateCopyBtns();renderCopyOutput();openModal('modal-copy');}
function setCopyFormat(fmt){copyFormat=fmt;updateCopyBtns();renderCopyOutput();}
function updateCopyBtns(){document.getElementById('copy-btn-txt').className=`btn btn-sm ${copyFormat==='txt'?'btn-primary':'btn-secondary'}`;document.getElementById('copy-btn-phpbb').className=`btn btn-sm ${copyFormat==='phpbb'?'btn-primary':'btn-secondary'}`;}
function renderCopyOutput(){
  const w=appDb.workouts.find(x=>x.id===copyWorkoutId);if(!w)return;
  const d=new Date(w.date).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  let out='';
  if(copyFormat==='txt'){
    out+=`${w.name.toUpperCase()}\n${d}\n`;if(w.duration)out+=`Duration: ${fmtDuration(w.duration)}\n`;out+='\u2500'.repeat(40)+'\n\n';
    w.exercises.forEach(e=>{const ex=getExercise(e.exerciseId);out+=`${ex?ex.name.toUpperCase():e.exerciseId}\n`;const{bestPRIdx,bestE1RMIdx,bestPRWeight,bestE1RM}=getBestPRAndE1RM(e);e.sets.forEach((s,si)=>{let line=formatSetStr(s);const parts=[];if(si===bestPRIdx)parts.push(`PR=${bestPRWeight}${appDb.unit}`);if(si===bestE1RMIdx)parts.push(`E1RM=${Math.round(bestE1RM)}${appDb.unit}`);if(parts.length)line+=` - ${parts.join(' / ')}`;out+=line+'\n';});const pv=e.perfVideos||[];if(pv.length)out+=pv.join('\n')+'\n';out+='\n';});
  } else {
    out+=`[u][size=200]${w.name}[/size][/u]\n[i]${d}[/i]\n`;if(w.duration)out+=`[i]Duration: ${fmtDuration(w.duration)}[/i]\n`;out+='\n';
    w.exercises.forEach(e=>{const ex=getExercise(e.exerciseId);out+=`[b][size=125]${ex?ex.name:e.exerciseId}[/b][/size]\n`;const{bestPRIdx,bestE1RMIdx,bestPRWeight,bestE1RM}=getBestPRAndE1RM(e);e.sets.forEach((s,si)=>{let line=formatSetStr(s);const parts=[];if(si===bestPRIdx)parts.push(`PR=${bestPRWeight}${appDb.unit}`);if(si===bestE1RMIdx)parts.push(`E1RM=${Math.round(bestE1RM)}${appDb.unit}`);if(parts.length)line+=` - ${parts.join(' / ')}`;out+=line+'\n';});const pv=e.perfVideos||[];if(pv.length)out+=pv.join('\n')+'\n';out+='\n';});
  }
  document.getElementById('copy-output').textContent=out;
}
function formatSetStr(s){if(s.weight&&+s.weight>0)return`- ${s.weight}${appDb.unit} x ${s.reps||s.time||'?'}`;if(s.reps)return`- BW x ${s.reps}`;if(s.time)return`- ${s.time}s`;return'- \u2014';}
function getBestPRAndE1RM(ex){let bestPRIdx=-1,bestPRWeight=0,bestE1RMIdx=-1,bestE1RM=0;ex.sets.forEach((s,si)=>{if(s.isPR&&+s.weight>bestPRWeight){bestPRWeight=+s.weight;bestPRIdx=si;}if(s.isNew1RM&&s.weight&&s.reps){const v=calc1RM(+s.weight,+s.reps);if(v>bestE1RM){bestE1RM=v;bestE1RMIdx=si;}}});return{bestPRIdx,bestE1RMIdx,bestPRWeight,bestE1RM};}
function copyToClipboard(){navigator.clipboard.writeText(document.getElementById('copy-output').textContent).then(()=>showToast('Copied to clipboard','success')).catch(()=>showToast('Select text manually to copy','error'));}

// ==================== MODALS ====================
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
function openNewProgramModal(){document.getElementById('prog-name').value='';document.getElementById('prog-notes').value='';openModal('modal-program');}
function saveProgram(){const name=document.getElementById('prog-name').value.trim();if(!name){showToast('Enter a program name','error');return;}const prog={id:uid(),name,notes:document.getElementById('prog-notes').value.trim(),microcycles:[{week:1,sessions:[]}],completedSessionIndices:[],trainingMaxes:{},lastUsed:null};appDb.programs.push(prog);fsSaveProgram(prog);closeModal('modal-program');renderPrograms();showToast('Program created','success');}

// ==================== IMPORT / EXPORT ====================
function openImportExportModal(){renderImportExportHome();openModal('modal-import-export');}
function openImportDirect(){renderImportExportHome();renderImportView();openModal('modal-import-export');}
function renderImportExportHome(){document.getElementById('import-export-body').innerHTML=`<div style="display:flex;flex-direction:column;gap:10px"><div onclick="renderImportView()" style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:12px" onmouseenter="this.style.borderColor='var(--accent)'" onmouseleave="this.style.borderColor='var(--border)'"><div style="background:rgba(255,106,0,0.15);border-radius:8px;padding:9px;flex-shrink:0"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ff6a00" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div><div style="flex:1"><div style="font-family:var(--font-display);font-size:16px;font-weight:700;text-transform:uppercase;color:var(--text)">Import CSV</div><div style="font-size:13px;color:var(--text3);margin-top:2px">Load historical workout data from a file</div></div></div><div onclick="runExport()" style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:12px" onmouseenter="this.style.borderColor='var(--accent3)'" onmouseleave="this.style.borderColor='var(--border)'"><div style="background:rgba(71,200,255,0.12);border-radius:8px;padding:9px;flex-shrink:0"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#47c8ff" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></div><div style="flex:1"><div style="font-family:var(--font-display);font-size:16px;font-weight:700;text-transform:uppercase;color:var(--text)">Export CSV</div><div style="font-size:13px;color:var(--text3);margin-top:2px">Download your complete workout history</div></div></div></div>`;}
function renderImportView(){document.getElementById('import-export-body').innerHTML=`<div style="margin-bottom:14px"><button class="btn btn-ghost btn-sm" onclick="renderImportExportHome()">&larr; Back</button></div><div style="background:var(--steel);border:1px solid var(--steel-border);border-radius:var(--radius-sm);padding:13px 14px;margin-bottom:16px;font-size:14px;color:var(--text2);line-height:1.6"><div style="font-family:var(--font-display);font-size:14px;font-weight:700;text-transform:uppercase;color:var(--accent3);margin-bottom:6px">Before You Import</div>CSV columns: <code style="font-size:12px;color:var(--accent2)">date, workout_name, exercise_name, set_number, weight, reps, rpe, duration_seconds, notes</code><br><br>Date formats: <strong>M/D/YYYY</strong> or <strong>M-D-YY</strong><br><br><span onclick="downloadTemplate()" style="color:var(--accent3);cursor:pointer;text-decoration:underline;font-weight:600">Download blank template</span></div><div class="form-group"><label>Select CSV File</label><input type="file" id="import-file-input" accept=".csv" style="padding:10px;cursor:pointer"></div><button class="btn btn-primary" style="width:100%" onclick="runImport()">Import</button>`;}
function downloadTemplate(){const header='date,workout_name,exercise_name,set_number,weight,reps,rpe,duration_seconds,notes';const example='1/15/2024,Push Day A,Barbell Bench Press,1,185,8,,,';triggerDownload(header+'\n'+example+'\n','ironlog-import-template.csv','text/csv');showToast('Template downloaded','success');}
function triggerDownload(content,filename,mimeType){const blob=new Blob([content],{type:mimeType});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function parseImportDate(raw){if(!raw)return null;raw=raw.trim();let m=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(m)return new Date(+m[3],+m[1]-1,+m[2]).getTime();m=raw.match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/);if(m){const yr=+m[3]<50?2000+ +m[3]:1900+ +m[3];return new Date(yr,+m[1]-1,+m[2]).getTime();}m=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);if(m){const yr=+m[3]<50?2000+ +m[3]:1900+ +m[3];return new Date(yr,+m[1]-1,+m[2]).getTime();}return null;}
function parseCSV(text){const lines=text.split(/\r?\n/);const rows=[];for(let i=1;i<lines.length;i++){const line=lines[i].trim();if(!line)continue;const cols=[];let cur='',inQ=false;for(let c=0;c<line.length;c++){const ch=line[c];if(ch==='"'){inQ=!inQ;}else if(ch===','&&!inQ){cols.push(cur);cur='';}else{cur+=ch;}}cols.push(cur);rows.push(cols);}return rows;}
async function runImport(){const fileInput=document.getElementById('import-file-input');if(!fileInput||!fileInput.files.length){showToast('Select a CSV file first','error');return;}if(appDb.importedSets.length>0){confirm2('Existing Import Detected',`You already have ${appDb.importedSets.length} imported sets. Importing again will add duplicates. Continue?`,()=>doImport(fileInput.files[0]),'Import Anyway');return;}doImport(fileInput.files[0]);}
async function doImport(file){
  const text=await file.text();const rows=parseCSV(text);const exAll=getAllExercises();const newCustomExes={};const setsToSave=[];
  for(const cols of rows){const dateRaw=(cols[0]||'').trim();const exName=(cols[2]||'').trim();const weight=(cols[4]||'').trim();const reps=(cols[5]||'').trim();if(!dateRaw&&!weight&&!reps)continue;if(!dateRaw)continue;const dateTs=parseImportDate(dateRaw);if(!dateTs)continue;if(!exName)continue;let matched=exAll.find(e=>e.name.toLowerCase()===exName.toLowerCase());if(!matched&&newCustomExes[exName.toLowerCase()])matched=newCustomExes[exName.toLowerCase()];if(!matched){const newEx={id:uid(),name:exName,bodypart:'Other',categories:['Other'],tracking:'weight_reps',custom:true};appDb.customExercises.push(newEx);fsSaveCustomEx(newEx);newCustomExes[exName.toLowerCase()]=newEx;matched=newEx;}setsToSave.push({id:uid(),exerciseId:matched.id,date:dateTs,workoutName:(cols[1]||'').trim(),setNumber:(cols[3]||'').trim(),weight,reps});}
  const BATCH_SIZE=400;for(let i=0;i<setsToSave.length;i+=BATCH_SIZE){const batch=fsDb.batch();setsToSave.slice(i,i+BATCH_SIZE).forEach(s=>{batch.set(COL_IMPORTED_SETS.doc(s.id),s);});await batch.commit();}
  appDb.importedSets.push(...setsToSave);closeModal('modal-import-export');
  if(setsToSave.length===0)showToast('Import failed - no valid rows found','error');else showToast(`Imported ${setsToSave.length} set${setsToSave.length!==1?'s':''}`, 'success');
}
function runExport(){
  const rows=['date,workout_name,exercise_name,set_number,weight,reps,rpe,duration_seconds,notes'];
  appDb.workouts.forEach(w=>{const d=new Date(w.date);const dateStr=`${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;const dur=w.duration||'';w.exercises.forEach(e=>{const ex=getExercise(e.exerciseId);const exName=ex?ex.name:e.exerciseId;e.sets.forEach((s,si)=>{rows.push([dateStr,csvEscape(w.name),csvEscape(exName),si+1,s.weight||'',s.reps||s.time||'',s.rpe||'',si===0?dur:'',''].join(','));});});});
  appDb.importedSets.forEach(s=>{const d=new Date(s.date);const dateStr=`${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;const ex=getExercise(s.exerciseId);rows.push([dateStr,csvEscape(s.workoutName||''),csvEscape(ex?ex.name:s.exerciseId),s.setNumber||'',s.weight||'',s.reps||'','','',''].join(','));});
  const today=new Date();const datePart=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  triggerDownload(rows.join('\n'),`ironlog-export-${datePart}.csv`,'text/csv');closeModal('modal-import-export');showToast('Export downloaded','success');
}
function csvEscape(val){if(!val)return'';const s=String(val);if(s.includes(',')||s.includes('"')||s.includes('\n'))return`"${s.replace(/"/g,'""')}"`;return s;}

// ==================== UNIT / SETTINGS ====================
function setUnit(u){appDb.unit=u;fsSavePrefs();updateUnitToggle();}
function updateUnitToggle(){document.getElementById('unit-lbs').classList.toggle('active',appDb.unit==='lbs');document.getElementById('unit-kg').classList.toggle('active',appDb.unit==='kg');}

// ==================== INIT EVENTS ====================
document.querySelectorAll('.modal-overlay').forEach(el => el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); }));
document.getElementById('modal-progression-review')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeProgressionReview(); });
document.getElementById('modal-active-tm-prompt')?.addEventListener('click', e => { if (e.target === e.currentTarget) activeTMPromptSkip(); });
