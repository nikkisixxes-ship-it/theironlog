// ==================== EXERCISE DATA ====================
const BODY_PARTS = ['All','Quadriceps','Hamstrings','Calves','Glutes','Back','Chest','Shoulders','Biceps','Triceps','Forearms','Core','Cardio','Full Body','Other'];

const EXRX_LINKS = {
  'e1':  'https://exrx.net/WeightExercises/Quadriceps/BBSquat',
  'e2':  'https://exrx.net/WeightExercises/Quadriceps/BBFrontSquat',
  'e3':  'https://exrx.net/WeightExercises/Quadriceps/LVLegPress',
  'e4':  'https://exrx.net/WeightExercises/Quadriceps/BBHackSquat',
  'e5':  'https://exrx.net/WeightExercises/Quadriceps/LVLegExtension',
  'e6':  'https://exrx.net/WeightExercises/Quadriceps/DBSingleLegSplit',
  'e7':  'https://exrx.net/WeightExercises/Quadriceps/DBLunge',
  'e8':  'https://exrx.net/WeightExercises/Quadriceps/BWIliacusFlex',
  'e10': 'https://exrx.net/WeightExercises/Hamstrings/BBRomanianDeadlift',
  'e11': 'https://exrx.net/WeightExercises/Hamstrings/LVLegCurl',
  'e12': 'https://exrx.net/WeightExercises/Hamstrings/LVSeatedLegCurl',
  'e13': 'https://exrx.net/WeightExercises/Hamstrings/BWNordicHamstringCurl',
  'e14': 'https://exrx.net/WeightExercises/Hamstrings/BBStiffLegDeadlift',
  'e15': 'https://exrx.net/WeightExercises/Hamstrings/BBGoodMorning',
  'e20': 'https://exrx.net/WeightExercises/Gastrocnemius/LVStandingCalfRaise',
  'e21': 'https://exrx.net/WeightExercises/Soleus/LVSeatedCalfRaise',
  'e22': 'https://exrx.net/WeightExercises/Gastrocnemius/LVDonkeyCalfRaise',
  'e23': 'https://exrx.net/WeightExercises/Gastrocnemius/BWOneFootCalfRaise',
  'e30': 'https://exrx.net/WeightExercises/Gluteus/BBHipThrust',
  'e31': 'https://exrx.net/WeightExercises/Gluteus/BWGluteaBridge',
  'e32': 'https://exrx.net/WeightExercises/Gluteus/CBHipExtension',
  'e40': 'https://exrx.net/WeightExercises/ErectorSpinae/BBDeadlift',
  'e41': 'https://exrx.net/WeightExercises/BackGeneral/BBBentOverRow',
  'e42': 'https://exrx.net/WeightExercises/BackGeneral/DBBentOverRow',
  'e43': 'https://exrx.net/WeightExercises/LatissimusDorsi/BWPullUp',
  'e44': 'https://exrx.net/WeightExercises/LatissimusDorsi/BWChinUp',
  'e45': 'https://exrx.net/WeightExercises/LatissimusDorsi/CBFrontPullDown',
  'e46': 'https://exrx.net/WeightExercises/BackGeneral/CBSeatedRow',
  'e47': 'https://exrx.net/WeightExercises/BackGeneral/LVTBarRow',
  'e48': 'https://exrx.net/WeightExercises/DeltoidPosterior/CBFacePull',
  'e49': 'https://exrx.net/WeightExercises/TrapeziusMiddle/BBShrug',
  'e50': 'https://exrx.net/WeightExercises/PectoralSternal/BBBenchPress',
  'e51': 'https://exrx.net/WeightExercises/PectoralClavicular/BBInclineBenchPress',
  'e52': 'https://exrx.net/WeightExercises/PectoralSternal/BBDeclineBenchPress',
  'e53': 'https://exrx.net/WeightExercises/PectoralSternal/DBBenchPress',
  'e54': 'https://exrx.net/WeightExercises/PectoralClavicular/DBInclineBenchPress',
  'e55': 'https://exrx.net/WeightExercises/PectoralSternal/CBCrossover',
  'e56': 'https://exrx.net/WeightExercises/PectoralSternal/DBFly',
  'e57': 'https://exrx.net/WeightExercises/PectoralSternal/BWDip',
  'e58': 'https://exrx.net/WeightExercises/PectoralSternal/BWPushUp',
  'e60': 'https://exrx.net/WeightExercises/DeltoidAnterior/BBMilitaryPress',
  'e61': 'https://exrx.net/WeightExercises/DeltoidAnterior/DBSeatedPress',
  'e62': 'https://exrx.net/WeightExercises/DeltoidLateral/DBLateralRaise',
  'e63': 'https://exrx.net/WeightExercises/DeltoidAnterior/DBFrontRaise',
  'e64': 'https://exrx.net/WeightExercises/DeltoidPosterior/DBBentLateralRaise',
  'e65': 'https://exrx.net/WeightExercises/DeltoidAnterior/DBArnoldPress',
  'e66': 'https://exrx.net/WeightExercises/DeltoidLateral/CBLateralRaise',
  'e70': 'https://exrx.net/WeightExercises/Biceps/BBCurl',
  'e71': 'https://exrx.net/WeightExercises/Biceps/DBCurl',
  'e72': 'https://exrx.net/WeightExercises/Brachioradialis/DBHammerCurl',
  'e73': 'https://exrx.net/WeightExercises/Biceps/BBPreacherCurl',
  'e74': 'https://exrx.net/WeightExercises/Biceps/CBCurl',
  'e75': 'https://exrx.net/WeightExercises/Biceps/DBConcentrationCurl',
  'e76': 'https://exrx.net/WeightExercises/Biceps/DBInclineCurl',
  'e80': 'https://exrx.net/WeightExercises/Triceps/CBPushDown',
  'e81': 'https://exrx.net/WeightExercises/Triceps/BBLyingTriExtension',
  'e82': 'https://exrx.net/WeightExercises/Triceps/BBCloseGripBenchPress',
  'e83': 'https://exrx.net/WeightExercises/Triceps/DBTriExtension',
  'e84': 'https://exrx.net/WeightExercises/Triceps/DBKickback',
  'e85': 'https://exrx.net/WeightExercises/Triceps/BWDiamondPushUp',
  'e90': 'https://exrx.net/WeightExercises/WristFlexors/BBWristCurl',
  'e91': 'https://exrx.net/WeightExercises/WristExtensors/BBReverseWristCurl',
  'e92': 'https://exrx.net/WeightExercises/Forearm/DBFarmerWalk',
  'e100':'https://exrx.net/WeightExercises/Iliopsoas/BWPlank',
  'e101':'https://exrx.net/WeightExercises/RectusAbdominis/BWCrunch',
  'e102':'https://exrx.net/WeightExercises/RectusAbdominis/CBCrunch',
  'e103':'https://exrx.net/WeightExercises/Iliopsoas/BWHangingLegRaise',
  'e104':'https://exrx.net/WeightExercises/RectusAbdominis/BWAbWheelRollout',
  'e105':'https://exrx.net/WeightExercises/Obliques/BWRussianTwist',
  'e110':'https://exrx.net/Aerobic/Activities/Treadmill',
  'e111':'https://exrx.net/Aerobic/Activities/StationaryBicycle',
  'e112':'https://exrx.net/Aerobic/Activities/Elliptical',
  'e113':'https://exrx.net/Aerobic/Activities/JumpRope',
};

const DEFAULT_EXERCISES = [
  {id:'e1',name:'Back Squat',bodypart:'Quadriceps',tracking:'weight_reps',custom:false},
  {id:'e2',name:'Front Squat',bodypart:'Quadriceps',tracking:'weight_reps',custom:false},
  {id:'e3',name:'Leg Press',bodypart:'Quadriceps',tracking:'weight_reps',custom:false},
  {id:'e4',name:'Hack Squat',bodypart:'Quadriceps',tracking:'weight_reps',custom:false},
  {id:'e5',name:'Leg Extension',bodypart:'Quadriceps',tracking:'weight_reps',custom:false},
  {id:'e6',name:'Bulgarian Split Squat',bodypart:'Quadriceps',tracking:'weight_reps',custom:false},
  {id:'e7',name:'Walking Lunge',bodypart:'Quadriceps',tracking:'weight_reps',custom:false},
  {id:'e8',name:'Sissy Squat',bodypart:'Quadriceps',tracking:'bodyweight_reps',custom:false},
  {id:'e10',name:'Romanian Deadlift',bodypart:'Hamstrings',tracking:'weight_reps',custom:false},
  {id:'e11',name:'Leg Curl (Lying)',bodypart:'Hamstrings',tracking:'weight_reps',custom:false},
  {id:'e12',name:'Leg Curl (Seated)',bodypart:'Hamstrings',tracking:'weight_reps',custom:false},
  {id:'e13',name:'Nordic Hamstring Curl',bodypart:'Hamstrings',tracking:'bodyweight_reps',custom:false},
  {id:'e14',name:'Stiff-Leg Deadlift',bodypart:'Hamstrings',tracking:'weight_reps',custom:false},
  {id:'e15',name:'Good Morning',bodypart:'Hamstrings',tracking:'weight_reps',custom:false},
  {id:'e20',name:'Standing Calf Raise',bodypart:'Calves',tracking:'weight_reps',custom:false},
  {id:'e21',name:'Seated Calf Raise',bodypart:'Calves',tracking:'weight_reps',custom:false},
  {id:'e22',name:'Donkey Calf Raise',bodypart:'Calves',tracking:'weight_reps',custom:false},
  {id:'e23',name:'Single-Leg Calf Raise',bodypart:'Calves',tracking:'bodyweight_reps',custom:false},
  {id:'e30',name:'Hip Thrust',bodypart:'Glutes',tracking:'weight_reps',custom:false},
  {id:'e31',name:'Glute Bridge',bodypart:'Glutes',tracking:'weight_reps',custom:false},
  {id:'e32',name:'Cable Kickback',bodypart:'Glutes',tracking:'weight_reps',custom:false},
  {id:'e40',name:'Deadlift',bodypart:'Back',tracking:'weight_reps',custom:false},
  {id:'e41',name:'Barbell Row',bodypart:'Back',tracking:'weight_reps',custom:false},
  {id:'e42',name:'Dumbbell Row',bodypart:'Back',tracking:'weight_reps',custom:false},
  {id:'e43',name:'Pull-Up',bodypart:'Back',tracking:'bodyweight_reps',custom:false},
  {id:'e44',name:'Chin-Up',bodypart:'Back',tracking:'bodyweight_reps',custom:false},
  {id:'e45',name:'Lat Pulldown',bodypart:'Back',tracking:'weight_reps',custom:false},
  {id:'e46',name:'Seated Cable Row',bodypart:'Back',tracking:'weight_reps',custom:false},
  {id:'e47',name:'T-Bar Row',bodypart:'Back',tracking:'weight_reps',custom:false},
  {id:'e48',name:'Face Pull',bodypart:'Back',tracking:'weight_reps',custom:false},
  {id:'e49',name:'Shrug',bodypart:'Back',tracking:'weight_reps',custom:false},
  {id:'e50',name:'Barbell Bench Press',bodypart:'Chest',tracking:'weight_reps',custom:false},
  {id:'e51',name:'Incline Bench Press',bodypart:'Chest',tracking:'weight_reps',custom:false},
  {id:'e52',name:'Decline Bench Press',bodypart:'Chest',tracking:'weight_reps',custom:false},
  {id:'e53',name:'Dumbbell Bench Press',bodypart:'Chest',tracking:'weight_reps',custom:false},
  {id:'e54',name:'Incline Dumbbell Press',bodypart:'Chest',tracking:'weight_reps',custom:false},
  {id:'e55',name:'Cable Fly',bodypart:'Chest',tracking:'weight_reps',custom:false},
  {id:'e56',name:'Dumbbell Fly',bodypart:'Chest',tracking:'weight_reps',custom:false},
  {id:'e57',name:'Dip',bodypart:'Chest',tracking:'bodyweight_reps',custom:false},
  {id:'e58',name:'Push-Up',bodypart:'Chest',tracking:'bodyweight_reps',custom:false},
  {id:'e60',name:'Overhead Press (Barbell)',bodypart:'Shoulders',tracking:'weight_reps',custom:false},
  {id:'e61',name:'Overhead Press (Dumbbell)',bodypart:'Shoulders',tracking:'weight_reps',custom:false},
  {id:'e62',name:'Lateral Raise',bodypart:'Shoulders',tracking:'weight_reps',custom:false},
  {id:'e63',name:'Front Raise',bodypart:'Shoulders',tracking:'weight_reps',custom:false},
  {id:'e64',name:'Rear Delt Fly',bodypart:'Shoulders',tracking:'weight_reps',custom:false},
  {id:'e65',name:'Arnold Press',bodypart:'Shoulders',tracking:'weight_reps',custom:false},
  {id:'e66',name:'Cable Lateral Raise',bodypart:'Shoulders',tracking:'weight_reps',custom:false},
  {id:'e70',name:'Barbell Curl',bodypart:'Biceps',tracking:'weight_reps',custom:false},
  {id:'e71',name:'Dumbbell Curl',bodypart:'Biceps',tracking:'weight_reps',custom:false},
  {id:'e72',name:'Hammer Curl',bodypart:'Biceps',tracking:'weight_reps',custom:false},
  {id:'e73',name:'Preacher Curl',bodypart:'Biceps',tracking:'weight_reps',custom:false},
  {id:'e74',name:'Cable Curl',bodypart:'Biceps',tracking:'weight_reps',custom:false},
  {id:'e75',name:'Concentration Curl',bodypart:'Biceps',tracking:'weight_reps',custom:false},
  {id:'e76',name:'Incline Dumbbell Curl',bodypart:'Biceps',tracking:'weight_reps',custom:false},
  {id:'e80',name:'Tricep Pushdown (Cable)',bodypart:'Triceps',tracking:'weight_reps',custom:false},
  {id:'e81',name:'Skull Crusher',bodypart:'Triceps',tracking:'weight_reps',custom:false},
  {id:'e82',name:'Close Grip Bench Press',bodypart:'Triceps',tracking:'weight_reps',custom:false},
  {id:'e83',name:'Overhead Tricep Extension',bodypart:'Triceps',tracking:'weight_reps',custom:false},
  {id:'e84',name:'Tricep Kickback',bodypart:'Triceps',tracking:'weight_reps',custom:false},
  {id:'e85',name:'Diamond Push-Up',bodypart:'Triceps',tracking:'bodyweight_reps',custom:false},
  {id:'e90',name:'Wrist Curl',bodypart:'Forearms',tracking:'weight_reps',custom:false},
  {id:'e91',name:'Reverse Wrist Curl',bodypart:'Forearms',tracking:'weight_reps',custom:false},
  {id:'e92',name:'Farmer Carry',bodypart:'Forearms',tracking:'weight_time',custom:false},
  {id:'e100',name:'Plank',bodypart:'Core',tracking:'time',custom:false},
  {id:'e101',name:'Crunch',bodypart:'Core',tracking:'bodyweight_reps',custom:false},
  {id:'e102',name:'Cable Crunch',bodypart:'Core',tracking:'weight_reps',custom:false},
  {id:'e103',name:'Hanging Leg Raise',bodypart:'Core',tracking:'bodyweight_reps',custom:false},
  {id:'e104',name:'Ab Wheel Rollout',bodypart:'Core',tracking:'bodyweight_reps',custom:false},
  {id:'e105',name:'Russian Twist',bodypart:'Core',tracking:'bodyweight_reps',custom:false},
  {id:'e110',name:'Treadmill',bodypart:'Cardio',tracking:'time',custom:false},
  {id:'e111',name:'Stationary Bike',bodypart:'Cardio',tracking:'time',custom:false},
  {id:'e112',name:'Elliptical',bodypart:'Cardio',tracking:'time',custom:false},
  {id:'e113',name:'Jump Rope',bodypart:'Cardio',tracking:'time',custom:false},
];

function getAllExercises() { return [...DEFAULT_EXERCISES, ...appDb.customExercises]; }
function getExercise(id)   { return getAllExercises().find(e => e.id === id); }
function getLastUsed(id)   {
  let last = 0;
  appDb.workouts.forEach(w => { if (w.exercises.some(e => e.exerciseId === id) && w.date > last) last = w.date; });
  return last || null;
}

// ==================== APP STATE ====================
let appDb = { customExercises: [], workouts: [], programs: [], unit: 'lbs', e1rmFormula: 'epley', exerciseNotes: {}, exerciseVideos: {}, importedSets: [] };
let currentWorkout = null;
let activeWorkoutTimer = null;
let activeWorkoutStart = null;
let workoutPaused = false;
let workoutPausedAt = null;
let workoutPausedTotal = 0;
let currentProgramId = null, currentMicrocycleIdx = null, currentSessionIdx = null;
let copyWorkoutId = null, copyFormat = 'phpbb';
let confirmCallback = null;
let currentDbBodypart = 'All', currentModalBodypart = 'All';
let sessionPickerBodypart = 'All';
let changeExBodypart = 'All';
let changeExTargetIdx = null;
let customExEditId = null;
let customExFromLogger = false;
let customExFromSessionPicker = false;
let customExFromChanger = false;
let moveDayProgId = null, moveDayMi = null, moveDaySi = null;
let customExTempVideos = [];
let videosExIdx = null;
let activeDropdownEl = null;
let prDebounceTimers = {};

// ==================== E1RM ====================
function calc1RM(w, r) {
  if (r === 1) return w;
  const formula = appDb.e1rmFormula || 'epley';
  if (formula === 'brzycki') { if (r >= 37) return w; return Math.round(w * (36 / (37 - r)) * 10) / 10; }
  if (formula === 'wathan')  { return Math.round(100 * w / (48.8 + 53.8 * Math.exp(-0.075 * r)) * 10) / 10; }
  return Math.round(w * (1 + r / 30) * 10) / 10;
}
function roundToIncrement(val) {
  const inc = appDb.unit === 'kg' ? 1.25 : 2.5;
  return Math.ceil(val / inc) * inc;
}

// ==================== AUTH ====================
let authMode = 'login';
function switchAuthTab(mode) {
  authMode = mode;
  document.getElementById('auth-tab-login').classList.toggle('active', mode==='login');
  document.getElementById('auth-tab-register').classList.toggle('active', mode==='register');
  document.getElementById('auth-submit-btn').textContent = mode==='login' ? 'Login' : 'Create Account';
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
    btn.textContent = authMode==='login'?'Login':'Create Account';
    btn.disabled = false;
  });
}
function authForgot() {
  const email = document.getElementById('auth-email').value.trim();
  if (!email) { document.getElementById('auth-err').textContent = 'Enter your email first.'; return; }
  auth.sendPasswordResetEmail(email)
    .then(() => { document.getElementById('auth-err').style.color='var(--green)'; document.getElementById('auth-err').textContent='Reset email sent!'; })
    .catch(err => { document.getElementById('auth-err').style.color='var(--red)'; document.getElementById('auth-err').textContent = friendlyAuthError(err.code); });
}
function friendlyAuthError(code) {
  const map = {'auth/invalid-email':'Invalid email address.','auth/user-not-found':'No account found with this email.','auth/wrong-password':'Incorrect password.','auth/email-already-in-use':'Email already in use.','auth/weak-password':'Password must be at least 6 characters.','auth/too-many-requests':'Too many attempts. Try again later.','auth/invalid-credential':'Invalid email or password.'};
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
    const [wSnap, pSnap, eSnap, mSnap, nSnap, iSnap, vSnap] = await Promise.all([
      COL_WORKOUTS.get(), COL_PROGRAMS.get(), COL_CUSTOM_EX.get(),
      COL_META.doc('prefs').get(), COL_EX_NOTES.get(), COL_IMPORTED_SETS.get(),
      COL_EX_VIDEOS.get()
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
    if (activePage() === 'page-programs') renderPrograms();
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
  // Hide active workout bar when on logger page
  const activeBar = document.getElementById('active-bar');
  if (activeBar) activeBar.style.display = id === 'page-log' ? 'none' : '';
  if (id === 'page-home')     renderHome();
  if (id === 'page-history')  renderHistory();
  if (id === 'page-db')       renderDB();
  if (id === 'page-programs') renderPrograms();
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
  // Active = has at least one completed session
  return appDb.programs.filter(p => p.completedSessionIndices && p.completedSessionIndices.length > 0);
}

function renderHome() {
  renderHomeCarousel();
  const sorted = [...appDb.workouts].slice(0, 3);
  document.getElementById('home-recent').innerHTML = sorted.length
    ? sorted.map(w => workoutHistoryCard(w, true)).join('')
    : '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 6h18M3 12h18M3 18h18"/></svg><h3>No workouts yet</h3><p>Tap New Workout to get started</p></div>';
}

function renderHomeCarousel() {
  homeCarouselProgs = getActivePrograms();
  const carousel = document.getElementById('home-program-carousel');
  const dotsEl = document.getElementById('home-carousel-dots');
  if (!carousel) return;

  if (homeCarouselIdx >= homeCarouselProgs.length) homeCarouselIdx = 0;

  if (!homeCarouselProgs.length) {
    // No active programs — show prompt
    carousel.innerHTML = `<div class="prog-card-empty" onclick="showPage('page-programs')">
      <div class="prog-card-empty-label">No Active Programs</div>
      <div class="prog-card-empty-sub">Go to Plan to create and start a program</div>
    </div>`;
    dotsEl.innerHTML = '';
    return;
  }

  carousel.innerHTML = homeCarouselProgs.map((prog, i) => {
    const next = getNextSessionForProgram(prog);
    const totalSessions = prog.microcycles.reduce((a, mc) => a + mc.sessions.length, 0);
    const completed = (prog.completedSessionIndices || []).length;
    const pct = totalSessions > 0 ? Math.round((completed / totalSessions) * 100) : 0;

    let sessionLabel, isComplete;
    if (next === null) {
      sessionLabel = 'Program Complete';
      isComplete = true;
    } else {
      const sessName = prog.microcycles[next.microcycleIdx].sessions[next.sessionIdx].name || `Day ${next.sessionIdx + 1}`;
      sessionLabel = `Week ${next.microcycleIdx + 1} \u2022 ${sessName}`;
      isComplete = false;
    }

    const tapAction = isComplete
      ? `restartProgramFromHome('${prog.id}')`
      : `startWorkoutFromCard('${prog.id}')`;

    const dotsHtml = homeCarouselProgs.length > 1
      ? homeCarouselProgs.map((_, di) =>
          `<div class="home-carousel-dot ${di === i ? 'active' : ''}"></div>`
        ).join('')
      : '';

    return `<div class="prog-carousel-card" onclick="${tapAction}">
      <div class="prog-card-session">${sessionLabel}</div>
      <div class="prog-card-name">${prog.name}</div>
      <div class="prog-card-progress-label">${pct}% Complete</div>
      <div class="prog-card-bar-row">
        <div class="prog-card-bar-track">
          <div class="prog-card-bar-fill" style="width:${pct}%"></div>
        </div>
        <div class="prog-card-dots">${dotsHtml}</div>
      </div>
    </div>`;
  }).join('');

  // Dots are rendered inside each card now
  dotsEl.innerHTML = '';

  updateCarouselPosition(false);
  initCarouselSwipe();
}

function updateCarouselPosition(animate) {
  const carousel = document.getElementById('home-program-carousel');
  if (!carousel) return;
  carousel.style.transition = animate ? 'transform 0.3s ease' : 'none';
  carousel.style.transform = `translateX(-${homeCarouselIdx * 100}%)`;
  // Update dots inside cards — each card has a full set of dots
  document.querySelectorAll('.home-carousel-dot').forEach((d, i) => {
    // dots repeat per card, so use modulo against number of programs
    d.classList.toggle('active', (i % homeCarouselProgs.length) === homeCarouselIdx);
  });
}

function goToCarouselSlide(i) {
  homeCarouselIdx = i;
  updateCarouselPosition(true);
}

function initCarouselSwipe() {
  const wrap = document.getElementById('home-program-carousel-wrap');
  if (!wrap || wrap._swipeInit) return;
  wrap._swipeInit = true;

  wrap.addEventListener('touchstart', e => {
    homeCarouselStartX = e.touches[0].clientX;
    homeCarouselDragging = true;
  }, { passive: true });

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
  const prog = appDb.programs.find(p => p.id === progId);
  if (!prog) return;
  const next = getNextSessionForProgram(prog);
  if (next === null) return;
  startNewWorkout(prog.id, next.microcycleIdx, next.sessionIdx);
}

function restartProgramFromHome(progId) {
  confirm2('Restart Program', 'Clear all progress and restart? Your workout history is kept.', () => {
    const prog = appDb.programs.find(p => p.id === progId);
    if (!prog) return;
    prog.completedSessionIndices = [];
    prog.trainingMaxes = {};
    prog.lastUsed = Date.now();
    fsSaveProgram(prog);
    renderHome();
    showToast('Program restarted', 'success');
  }, 'Restart');
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
  document.getElementById('history-stats').innerHTML = `
    <div class="stat-box"><div class="stat-label">Total Workouts</div><div class="stat-value">${total}</div></div>
    <div class="stat-box"><div class="stat-label">Total Sets</div><div class="stat-value">${totalSets}</div></div>
    <div class="stat-box"><div class="stat-label">${unitLabel} Lifted</div><div class="stat-value" style="font-size:${totalVol>=10000?'22px':'28px'}">${totalVol>=1000?Math.round(totalVol/1000)+'k':totalVol}</div></div>
    <div class="stat-box"><div class="stat-label">Training Time</div><div class="stat-value">${timeDisplay}<span style="font-size:16px;font-weight:600;color:var(--text3);margin-left:3px">${timeLabel}</span></div></div>`;
}

// ==================== WORKOUT TIMER ====================
function startWorkoutTimer() {
  activeWorkoutStart = Date.now();
  workoutPaused = false; workoutPausedTotal = 0; workoutPausedAt = null;
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
function pauseWorkout() {
  if (!currentWorkout || workoutPaused) return;
  workoutPaused = true; workoutPausedAt = Date.now();
  updateTimerDisplay(); showToast('Workout paused', '');
}
function resumeWorkout() {
  if (!currentWorkout || !workoutPaused) return;
  workoutPausedTotal += (Date.now() - workoutPausedAt);
  workoutPaused = false; workoutPausedAt = null;
  updateTimerDisplay(); showToast('Workout resumed', 'success');
}
function stopWorkoutTimer() {
  if (activeWorkoutTimer) clearInterval(activeWorkoutTimer);
  document.getElementById('active-bar').classList.remove('visible');
  workoutPaused = false; workoutPausedTotal = 0; workoutPausedAt = null;
}
function goToActiveWorkout() { showPage('page-log'); }
function onSetChecked(exIdx, si, checked) {
  if (!currentWorkout) return;
  const s = currentWorkout.exercises[exIdx].sets[si];
  s.completed = checked;
  if (checked && workoutPaused) resumeWorkout();
  const wrap = document.getElementById(`set-wrap-${exIdx}-${si}`);
  if (wrap) wrap.classList.toggle('completed', checked);
  // Run PR/1RM check and update badges on complete
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
    { label: 'Log Bodyweight', icon: '⚖', action: 'openLogBWModal()' },
    { label: 'RPE', icon: '', action: 'toggleRPEFromMenu()', toggle: currentWorkout?.rpeEnabled ? '✓ ' : '' },
    { divider: true },
    { label: 'Cancel Workout', icon: '✕', action: 'cancelWorkout()', danger: true },
  ];
  showDropdown(e.currentTarget, items);
}
function togglePauseWorkout() {
  if (!currentWorkout) return;
  if (workoutPaused) resumeWorkout(); else pauseWorkout();
}
function openExerciseMenu(e, idx) {
  e.stopPropagation();
  const ex = currentWorkout?.exercises[idx];
  const hasProg = ex ? hasProgression(idx) : false;
  const items = [
    { label: 'Change Exercise', icon: '⇄', action: `openChangeExModal(${idx})` },
    ...(hasProg ? [{ label: 'Reset TM / Baseline', icon: '↺', action: `openSingleTMPrompt(${idx})` }] : []),
    { divider: true },
    { label: 'Delete Exercise', icon: '✕', action: `deleteExercise(${idx})`, danger: true },
  ];
  showDropdown(e.currentTarget, items);
}
function deleteExercise(idx) {
  if (!currentWorkout) return;
  const exData = getExercise(currentWorkout.exercises[idx].exerciseId);
  const name = exData ? exData.name : 'this exercise';
  confirm2('Delete Exercise', `Remove ${name} from this workout?`, () => {
    currentWorkout.exercises.splice(idx, 1);
    renderWorkoutExercises();
  }, 'Delete');
}
function hasProgression(exIdx) {
  if (!currentWorkout?.programId) return false;
  const prog = appDb.programs.find(p => p.id === currentWorkout.programId);
  if (!prog) return false;
  const session = prog.microcycles[currentWorkout.microcycleIdx]?.sessions[currentWorkout.sessionIdx];
  if (!session) return false;
  const ex = currentWorkout.exercises[exIdx];
  const sessEx = session.exercises.find(e => e.exerciseId === ex.exerciseId);
  if (!sessEx?.sets) return false;
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
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  menu.style.minWidth = menuW + 'px';
  document.getElementById('dropdown-backdrop').classList.add('open');
}
function closeDropdown() {
  document.getElementById('dropdown-menu').style.display = 'none';
  document.getElementById('dropdown-backdrop').classList.remove('open');
}
function toggleRPEFromMenu() {
  if (!currentWorkout) return;
  currentWorkout.rpeEnabled = !currentWorkout.rpeEnabled;
  renderWorkoutExercises();
}

// ==================== REORDER MODAL ====================
function openReorderModal() {
  if (!currentWorkout?.exercises.length) { showToast('No exercises to reorder', ''); return; }
  renderReorderList(); openModal('modal-reorder');
}
function renderReorderList() {
  const list = document.getElementById('reorder-list');
  if (!currentWorkout) return;
  list.innerHTML = currentWorkout.exercises.map((ex, i) => {
    const exData = getExercise(ex.exerciseId);
    const name = exData ? exData.name : ex.exerciseId;
    return `<div class="reorder-item"><div class="reorder-item-name">${name}</div><div class="reorder-btns"><button class="btn-icon btn-sm" ${i===0?'disabled style="opacity:0.3"':''} onclick="reorderMove(${i},-1)">↑</button><button class="btn-icon btn-sm" ${i===currentWorkout.exercises.length-1?'disabled style="opacity:0.3"':''} onclick="reorderMove(${i},1)">↓</button></div></div>`;
  }).join('');
}
function reorderMove(idx, dir) {
  const arr = currentWorkout.exercises, n = idx + dir;
  if (n < 0 || n >= arr.length) return;
  [arr[idx], arr[n]] = [arr[n], arr[idx]];
  renderReorderList(); renderWorkoutExercises();
}

// ==================== LOG BODYWEIGHT ====================
function openLogBWModal() {
  document.getElementById('bw-modal-unit').textContent = appDb.unit;
  document.getElementById('bw-modal-input').value = currentWorkout?.bodyweight || '';
  openModal('modal-log-bw');
}
function saveBWFromModal() {
  const val = parseFloat(document.getElementById('bw-modal-input').value);
  if (currentWorkout) currentWorkout.bodyweight = val || null;
  closeModal('modal-log-bw'); showToast('Bodyweight saved', 'success');
}
function getWorkoutBW() {
  if (currentWorkout && currentWorkout.bodyweight) return currentWorkout.bodyweight;
  for (const w of appDb.workouts) { if (w.bodyweight) return w.bodyweight; }
  return null;
}

// ==================== NOTES MODAL ====================
let notesEditExIdx = null;
function toggleNotesSection(idx) {
  const content = document.getElementById(`ex-notes-content-${idx}`);
  if (!content) return;
  const isCurrentlyHidden = content.style.display === 'none';
  content.style.display = isCurrentlyHidden ? '' : 'none';
  const label = document.getElementById(`notes-hide-btn-${idx}`);
  if (label) label.textContent = isCurrentlyHidden ? 'Hide' : 'Show';
}
function openNotesEditModal(exIdx) {
  notesEditExIdx = exIdx;
  const ex = currentWorkout.exercises[exIdx];
  const exData = getExercise(ex.exerciseId);
  document.getElementById('notes-edit-modal-title').textContent = exData ? exData.name : 'Notes';
  document.getElementById('notes-edit-textarea').value = getExNote(ex.exerciseId);
  openModal('modal-notes-edit');
}
function saveNotesFromModal() {
  if (notesEditExIdx === null) return;
  const exId = currentWorkout.exercises[notesEditExIdx].exerciseId;
  const note = document.getElementById('notes-edit-textarea').value.trim();
  saveExNote(exId, note);
  closeModal('modal-notes-edit');
  // Update notes content in place without full re-render
  const contentEl = document.getElementById(`ex-notes-content-${notesEditExIdx}`);
  if (contentEl) {
    contentEl.innerHTML = note ? escapeHtml(note) : '<span style="color:var(--text3);font-style:italic">Tap to add notes...</span>';
  }
  showToast('Note saved', 'success');
}

// ==================== VIDEOS MODAL ====================
function openVideosModal(exIdx) {
  videosExIdx = exIdx;
  const ex = currentWorkout.exercises[exIdx];
  const exData = getExercise(ex.exerciseId);
  document.getElementById('ex-videos-modal-title').textContent = exData ? exData.name : 'Videos';
  renderVideosModalBody(); openModal('modal-ex-videos');
}
function renderVideosModalBody() {
  if (videosExIdx === null) return;
  const ex = currentWorkout.exercises[videosExIdx];
  const refVideos = getExVideos(ex.exerciseId);
  const perfVideos = ex.perfVideos || [];
  const body = document.getElementById('ex-videos-modal-body');
  const refHtml = refVideos.length
    ? `<div style="margin-bottom:12px"><div class="video-section-label">Reference Videos</div>${refVideos.map((v,vi) => `<div class="video-link-row"><a class="video-link" href="${v}" target="_blank">${v}</a><button class="btn-icon" style="padding:4px;color:var(--red);border:none;background:none;font-size:12px;flex-shrink:0" onclick="removeRefVideoFromLogger(${vi})">✕</button></div>`).join('')}<div class="video-add-row" style="margin-top:6px"><input type="text" class="video-add-input" id="ref-vid-modal-input" placeholder="Add reference link..."><button class="video-add-btn" onclick="addRefVideoFromLogger()">+ Add</button></div></div>`
    : `<div style="margin-bottom:12px"><div class="video-section-label">Reference Videos</div><div style="font-size:13px;color:var(--text3);margin-bottom:6px">No reference videos yet.</div><div class="video-add-row"><input type="text" class="video-add-input" id="ref-vid-modal-input" placeholder="Add reference link..."><button class="video-add-btn" onclick="addRefVideoFromLogger()">+ Add</button></div></div>`;
  const perfHtml = `<div><div class="video-section-label">This Session</div>${perfVideos.map((v,vi) => `<div class="video-link-row"><a class="video-link" href="${v}" target="_blank">${v}</a><button class="btn-icon" style="padding:4px;color:var(--red);border:none;background:none;font-size:12px;flex-shrink:0" onclick="removePerfVideo(${vi})">✕</button></div>`).join('')}<div class="video-add-row" style="margin-top:8px"><input type="text" class="video-add-input" id="perf-vid-modal-input" placeholder="Paste performance link..."><button class="video-add-btn" onclick="addPerfVideoFromModal()">+ Add</button></div></div>`;
  body.innerHTML = refHtml + perfHtml;
}
function addRefVideoFromLogger() {
  const input = document.getElementById('ref-vid-modal-input'); if (!input) return;
  const url = input.value.trim(); if (!url) { showToast('Paste a link first', 'error'); return; }
  const exId = currentWorkout.exercises[videosExIdx].exerciseId;
  saveExVideos(exId, [...getExVideos(exId), url]);
  input.value = ''; renderVideosModalBody(); showToast('Video added', 'success');
}
function removeRefVideoFromLogger(vi) {
  const exId = currentWorkout.exercises[videosExIdx].exerciseId;
  saveExVideos(exId, getExVideos(exId).filter((_,i) => i !== vi)); renderVideosModalBody();
}
function addPerfVideoFromModal() {
  const input = document.getElementById('perf-vid-modal-input'); if (!input) return;
  const url = input.value.trim(); if (!url) { showToast('Paste a link first', 'error'); return; }
  if (!currentWorkout || videosExIdx === null) return;
  if (!currentWorkout.exercises[videosExIdx].perfVideos) currentWorkout.exercises[videosExIdx].perfVideos = [];
  currentWorkout.exercises[videosExIdx].perfVideos.push(url);
  input.value = ''; renderVideosModalBody(); showToast('Video added', 'success');
}
function removePerfVideo(viIdx) {
  if (!currentWorkout || videosExIdx === null) return;
  currentWorkout.exercises[videosExIdx].perfVideos.splice(viIdx, 1); renderVideosModalBody();
}

// ==================== CHANGE EXERCISE ====================
function openChangeExModal(exIdx) {
  changeExTargetIdx = exIdx; changeExBodypart = 'All';
  document.getElementById('change-ex-search').value = '';
  renderChangeExTabs(); renderChangeExList(); openModal('modal-change-exercise');
}
function renderChangeExTabs() {
  const el = document.getElementById('change-ex-tabs'); if (!el) return;
  el.innerHTML = BODY_PARTS.map(bp => `<button class="tab ${changeExBodypart===bp?'active':''}" onclick="changeExBodypart='${bp}';renderChangeExTabs();renderChangeExList()">${bp}</button>`).join('');
}
function renderChangeExList() {
  const q = (document.getElementById('change-ex-search')?.value||'').toLowerCase();
  let exs = [...getAllExercises()].sort((a,b)=>a.name.localeCompare(b.name));
  if (changeExBodypart !== 'All') exs = exs.filter(e => e.bodypart === changeExBodypart);
  if (q) exs = exs.filter(e => e.name.toLowerCase().includes(q));
  const el = document.getElementById('change-ex-list'); if (!el) return;
  el.innerHTML = exs.map(e => `<div onclick="confirmChangeExercise('${e.id}')" style="padding:13px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;align-items:center;justify-content:space-between" onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background=''"><div><div style="font-family:var(--font-display);font-size:16px;font-weight:700;text-transform:uppercase;color:var(--text)">${e.name}</div><div style="margin-top:3px"><span class="badge badge-blue">${e.bodypart}</span>${e.custom?'<span class="badge badge-orange" style="margin-left:5px">Custom</span>':''}</div></div><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="color:var(--accent);flex-shrink:0"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></div>`).join('') || '<div style="padding:20px;text-align:center;color:var(--text3)">No exercises found</div>';
}
function confirmChangeExercise(newExId) {
  if (changeExTargetIdx === null || !currentWorkout) return;
  currentWorkout.exercises[changeExTargetIdx].exerciseId = newExId;
  currentWorkout.exercises[changeExTargetIdx].perfVideos = [];
  closeModal('modal-change-exercise'); renderWorkoutExercises(); showToast('Exercise changed', 'success');
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
  const html = exercises.map(ex => {
    const e1rm = getBest1RM(ex.exerciseId, null);
    const e1rmText = e1rm > 0 ? `Use E1RM (est. ${Math.round(e1rm)}${appDb.unit})` : null;
    const typeLabel = ex.hasPctProg ? '% Progression' : `Rep Goal (${ex.repGoalTarget} reps)`;
    return `<div class="tm-ex-block" id="tm-block-${ex.exerciseId}"><div class="tm-ex-name">${ex.exData ? ex.exData.name : ex.exerciseId}</div><div class="tm-ex-type">Type: <span>${typeLabel}</span></div><div class="tm-input-row"><input type="number" id="tm-input-${ex.exerciseId}" placeholder="${ex.hasPctProg?'Training Max':'Starting Weight'} (${appDb.unit})" step="2.5">${e1rmText && ex.hasPctProg ? `<button class="tm-use-e1rm" onclick="useTME1RM('${ex.exerciseId}',${Math.round(e1rm)})">Use E1RM</button>` : ''}</div><span class="tm-skip" onclick="skipTMSetup('${ex.exerciseId}')">Skip for now</span><div class="tm-warning" id="tm-warn-${ex.exerciseId}">No baseline set — weight will not auto-fill.</div></div>`;
  }).join('');
  document.getElementById('tm-prompt-exercises').innerHTML = html;
  document.getElementById('tm-prompt-overlay').classList.add('open');
}
function useTME1RM(exId, val) { document.getElementById(`tm-input-${exId}`).value = val; }
function skipTMSetup(exId) {
  document.getElementById(`tm-warn-${exId}`).classList.add('show');
  document.getElementById(`tm-input-${exId}`).value = '';
  document.getElementById(`tm-input-${exId}`).disabled = true;
  const btn = document.querySelector(`#tm-block-${exId} .tm-use-e1rm`);
  if (btn) btn.disabled = true;
}
function closeTMPrompt() {
  const prog = appDb.programs.find(p => p.id === currentWorkout?.programId);
  if (!prog) { document.getElementById('tm-prompt-overlay').classList.remove('open'); return; }
  const session = prog.microcycles[currentWorkout.microcycleIdx]?.sessions[currentWorkout.sessionIdx];
  if (!session) { document.getElementById('tm-prompt-overlay').classList.remove('open'); return; }
  for (const ex of session.exercises) {
    const input = document.getElementById(`tm-input-${ex.exerciseId}`);
    if (!input || input.disabled) continue;
    const val = parseFloat(input.value); if (!val || isNaN(val)) continue;
    const hasPctProg = ex.sets && ex.sets.some(s => s.progression === 'pct1rm');
    const hasRepGoal = ex.sets && ex.sets.some(s => s.progression === 'rep_goal');
    const repGoalTarget = hasRepGoal ? +ex.sets.find(s => s.progression === 'rep_goal')?.progressionValue : null;
    const bw = getWorkoutBW(); const exData = getExercise(ex.exerciseId);
    const isBW = exData && exData.tracking === 'bodyweight_reps';
    if (hasPctProg) setProgTM(prog, ex.exerciseId, { value: val, lockedBW: isBW ? bw : null });
    else if (hasRepGoal) setProgTM(prog, ex.exerciseId, { repGoalBase: val, repGoalTarget, repGoalProgressions: 0 });
  }
  document.getElementById('tm-prompt-overlay').classList.remove('open');
  renderWorkoutExercises();
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
  currentWorkout.exercises.forEach((ex) => {
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
function getProgramSessionName(progId, mi, si) {
  const prog = appDb.programs.find(p => p.id === progId); if (!prog) return '';
  const sess = prog.microcycles[mi].sessions[si];
  return `Week ${mi+1} · ${sess.name || `Day ${si+1}`}`;
}

// ==================== RENDER WORKOUT ====================
function renderWorkoutExercises() {
  const c = document.getElementById('workout-exercises');
  if (!currentWorkout?.exercises.length) { c.innerHTML = '<div style="text-align:center;padding:30px 0;color:var(--text3);font-size:15px">Add exercises below to begin logging</div>'; return; }
  c.innerHTML = currentWorkout.exercises.map((ex, i) => buildExerciseBlock(ex, i)).join('');
  currentWorkout.exercises.forEach((ex, i) => ex.sets.forEach((s, si) => attachSwipeToSet(i, si)));
}
function buildExerciseBlock(ex, idx) {
  const exData = getExercise(ex.exerciseId);
  const name = exData ? exData.name : ex.exerciseId;
  const note = getExNote(ex.exerciseId);
  const prev = getPreviousPerf(ex.exerciseId);
  const rpe = currentWorkout.rpeEnabled;
  const isTime = exData && (exData.tracking === 'time' || exData.tracking === 'weight_time');
  const isBW = exData && exData.tracking === 'bodyweight_reps';
  const col2Label = isBW ? 'Added Wt' : appDb.unit.toUpperCase();
  const col3Label = isTime ? 'Time(s)' : 'Reps';

  const exrxUrl = EXRX_LINKS[ex.exerciseId];
  const exrxHtml = exrxUrl ? `<a href="${exrxUrl}" target="_blank" class="exrx-link" title="View on ExRx.net">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
  </a>` : '';

  // Meta badges (Last + TM) — Last is clickable for history, Videos icon at end
  let metaBadgesHtml = '';
  if (prev) {
    metaBadgesHtml += `<span class="ex-meta-badge" style="cursor:pointer" onclick="openExHistoryModal('${ex.exerciseId}')">Last: ${prev.replace(appDb.unit,'').replace(appDb.unit.toLowerCase(),'').trim()}</span>`;
  }
  if (currentWorkout.programId) {
    const prog = appDb.programs.find(p => p.id === currentWorkout.programId);
    if (prog) {
      const tmData = getProgTM(prog, ex.exerciseId);
      if (tmData && tmData.value) {
        metaBadgesHtml += `<span class="ex-meta-badge" style="cursor:pointer" onclick="openSingleTMPrompt(${idx})">TM: ${tmData.value}</span>`;
      } else if (tmData && tmData.repGoalBase != null) {
        metaBadgesHtml += `<span class="ex-meta-badge" style="cursor:pointer" onclick="openSingleTMPrompt(${idx})">Base: ${tmData.repGoalBase}</span>`;
      }
    }
  }
  // Videos icon — always shown in meta row
  const hasVideos = getExVideos(ex.exerciseId).length > 0 || (ex.perfVideos||[]).length > 0;
  metaBadgesHtml += `<span class="ex-meta-badge" style="cursor:pointer;color:${hasVideos ? 'var(--accent3)' : 'var(--text3)'};padding:2px 6px" onclick="openVideosModal(${idx})"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="display:block"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg></span>`;

  // TM controls (set TM button — keep functional)
  let tmControls = '';
  if (currentWorkout.programId) {
    const prog = appDb.programs.find(p => p.id === currentWorkout.programId);
    if (prog) {
      const session = prog.microcycles[currentWorkout.microcycleIdx]?.sessions[currentWorkout.sessionIdx];
      if (session) {
        const sessEx = session.exercises.find(e => e.exerciseId === ex.exerciseId);
        if (sessEx?.sets) {
          const hasPct = sessEx.sets.some(s => s.progression === 'pct1rm');
          const hasRG = sessEx.sets.some(s => s.progression === 'rep_goal');
          if (hasPct || hasRG) {
            const tmData = getProgTM(prog, ex.exerciseId);
            if (!tmData || (!tmData.value && tmData.repGoalBase == null)) {
              tmControls = `<div style="margin-bottom:8px">
                <span style="font-size:12px;color:var(--red);font-family:var(--font-display);font-weight:600;letter-spacing:0.04em">No baseline set</span>
                <button class="btn btn-ghost btn-sm" style="font-size:11px;padding:4px 9px;margin-left:8px" onclick="openSingleTMPrompt(${idx})">${hasPct?'Set TM':'Set Baseline'}</button>
              </div>`;
            }
          }
        }
      }
    }
  }

  // Notes section — always shown, tap to edit
  const notesHtml = `
    <div>
      <div class="ex-notes-label">Notes <span class="ex-notes-hide-btn" id="notes-hide-btn-${idx}" onclick="toggleNotesSection(${idx})">Hide</span></div>
      <div class="ex-notes-content" id="ex-notes-content-${idx}" onclick="openNotesEditModal(${idx})" style="cursor:pointer">${note ? escapeHtml(note) : '<span style="color:var(--text3);font-style:italic">Tap to add notes...</span>'}</div>
    </div>`;

  const hdrCls = rpe ? 'set-header with-rpe' : 'set-header';

  return `<div class="exercise-item" id="ex-block-${idx}">
    <div class="exercise-item-header">
      <div class="exercise-item-name">${name}${exrxHtml}</div>
      <button class="ex-menu-btn" onclick="openExerciseMenu(event,${idx})">•••</button>
    </div>
    <div class="exercise-meta-row">${metaBadgesHtml}</div>
    ${tmControls}
    <div style="margin-top:24px" id="ex-notes-section-${idx}">${notesHtml}</div>
    <div style="margin-top:24px">
      <div class="${hdrCls}">
        <div class="set-label">✓</div>
        <div class="set-label">${col2Label}</div>
        <div class="set-label">${col3Label}</div>
        ${rpe ? '<div class="set-label">RPE</div>' : ''}
      </div>
      <div id="sets-container-${idx}">${buildSetsHTML(ex, idx, isTime, rpe)}</div>
      <div class="ex-action-row">
        <button class="btn btn-ghost" style="background:#222222;border-color:#5C5C5C" onclick="addSet(${idx})">+ Set</button>
        <button class="btn btn-ghost" onclick="addPRSet(${idx})" style="background:#222222;color:var(--accent2);border-color:rgba(255,170,0,0.4)">+ PR Set</button>
      </div>
    </div>
  </div>`;
}

function buildSetsHTML(ex, exIdx, isTime, rpe) {
  const rowCls = rpe ? 'set-row with-rpe' : 'set-row';
  return ex.sets.map((s, si) => {
    const isAutoFilled = s.autoFilled;
    const isCompleted = s.completed;
    const inputCls = isAutoFilled ? 'set-input auto-filled' : 'set-input';
    const repCls = (s.autoFilled && s.autoType === 'rep_goal') ? 'set-input auto-filled' : 'set-input';
    const wrapCls = isCompleted ? 'set-row-wrap completed' : 'set-row-wrap';
    const badgesHtml = buildSetBadgesHtml(s);
    const gridCols = rpe ? `40px 1fr 1fr 64px${badgesHtml ? ' auto' : ''}` : `40px 1fr 1fr${badgesHtml ? ' auto' : ''}`;
    return `<div class="${wrapCls}" id="set-wrap-${exIdx}-${si}">
      <div class="${rowCls}" id="set-row-${exIdx}-${si}" style="grid-template-columns:${gridCols}">
        <input type="checkbox" class="set-checkbox" ${isCompleted?'checked':''} onchange="onSetChecked(${exIdx},${si},this.checked)">
        <input class="${inputCls}" type="number" placeholder="0" value="${s.weight||''}" oninput="updateSet(${exIdx},${si},'weight',this.value);this.classList.remove('auto-filled')" step="0.5">
        <input class="${repCls}" type="number" placeholder="0" value="${s.reps||s.time||''}" oninput="updateSet(${exIdx},${si},'${isTime?'time':'reps'}',this.value)" step="1">
        ${rpe ? `<input class="set-input" type="number" placeholder="RPE" value="${s.rpe||''}" oninput="updateSet(${exIdx},${si},'rpe',this.value)" min="1" max="10" step="0.5">` : ''}
        <div class="set-badges" id="set-badges-${exIdx}-${si}">${badgesHtml}</div>
      </div>
      <div class="set-delete-btn" onclick="removeSet(${exIdx},${si})">Delete</div>
    </div>
    <div class="pr-target-line" id="pr-line-${exIdx}-${si}"></div>`;
  }).join('');
}

function buildSetBadgesHtml(s) {
  if (!s.completed) return '';
  let html = '';
  if (s.isPR && s.weight) html += `<span class="set-badge-pr">PR: ${s.weight}</span>`;
  if (s.isNew1RM && s.weight && s.reps) html += `<span class="set-badge-1rm">1RM: ${Math.round(calc1RM(+s.weight, +s.reps))}</span>`;
  return html;
}

function attachSwipeToSet(exIdx, si) {
  const wrap = document.getElementById(`set-wrap-${exIdx}-${si}`);
  const row  = document.getElementById(`set-row-${exIdx}-${si}`);
  if (!wrap || !row) return;
  let startX = 0, currentX = 0, swiping = false;
  wrap.addEventListener('touchstart', e => { startX = e.touches[0].clientX; currentX = startX; swiping = true; }, { passive: true });
  wrap.addEventListener('touchmove', e => { if (!swiping) return; currentX = e.touches[0].clientX; const diff = startX - currentX; row.style.transform = diff > 0 ? `translateX(${-Math.min(diff,70)}px)` : 'translateX(0)'; }, { passive: true });
  wrap.addEventListener('touchend', () => { if (!swiping) return; swiping = false; row.style.transform = (startX - currentX) > 60 ? 'translateX(-70px)' : 'translateX(0)'; });
}
function escapeHtml(str) { return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

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
  if (s.weight && s.reps) {
    s.isNew1RM = calc1RM(+s.weight, +s.reps) > getBest1RM(currentWorkout.exercises[exIdx].exerciseId, currentWorkout.id);
    s.isPR = +s.weight > getBestWeight(currentWorkout.exercises[exIdx].exerciseId, currentWorkout.id);
  }
}
function addSet(idx) {
  const sets = currentWorkout.exercises[idx].sets;
  const last = sets.length > 0 ? sets[sets.length-1] : null;
  sets.push({ weight: last ? last.weight : '', reps: '', time: '', rpe: '', completed: false });
  const container = document.getElementById(`sets-container-${idx}`);
  const exData = getExercise(currentWorkout.exercises[idx].exerciseId);
  const isTime = exData && (exData.tracking === 'time' || exData.tracking === 'weight_time');
  if (container) { container.innerHTML = buildSetsHTML(currentWorkout.exercises[idx], idx, isTime, currentWorkout.rpeEnabled); currentWorkout.exercises[idx].sets.forEach((s, si) => attachSwipeToSet(idx, si)); }
  else renderWorkoutExercises();
}
function removeSet(exIdx, si) {
  currentWorkout.exercises[exIdx].sets.splice(si, 1);
  const container = document.getElementById(`sets-container-${exIdx}`);
  const exData = getExercise(currentWorkout.exercises[exIdx].exerciseId);
  const isTime = exData && (exData.tracking === 'time' || exData.tracking === 'weight_time');
  if (container) { container.innerHTML = buildSetsHTML(currentWorkout.exercises[exIdx], exIdx, isTime, currentWorkout.rpeEnabled); currentWorkout.exercises[exIdx].sets.forEach((s, si) => attachSwipeToSet(exIdx, si)); }
  else renderWorkoutExercises();
}

// ==================== PR SET ====================
function addPRSet(idx) {
  if (!currentWorkout) return;
  const ex = currentWorkout.exercises[idx]; const exData = getExercise(ex.exerciseId); if (!exData) return;
  const isTime = exData.tracking === 'time' || exData.tracking === 'weight_time';
  const isBW = exData.tracking === 'bodyweight_reps';
  const inc = appDb.unit === 'kg' ? 1.25 : 2.5;
  let newSet = { weight: '', reps: '', time: '', rpe: '', completed: false }; let targetInfo = '';
  if (isTime) {
    const best = getBestTime(ex.exerciseId); if (!best) { showToast('No previous time found', 'error'); return; }
    newSet.time = String(best + 5); ex.sets.push(newSet); targetInfo = `Target: ${best+5}s (best: ${best}s)`;
  } else if (isBW) {
    const bw = getWorkoutBW(); const currentE1RM = getBestE1RMForExercise(ex.exerciseId, bw);
    if (currentE1RM > 0 && bw) {
      const result = calcPRWeightReps(currentE1RM + 1, inc, bw); if (!result) { showToast('No PR found', 'error'); return; }
      newSet.weight = result.addedWeight > 0 ? String(result.addedWeight) : ''; newSet.reps = String(result.reps); ex.sets.push(newSet);
      targetInfo = `Target E1RM: ${Math.round(currentE1RM+1)}${appDb.unit}`;
    } else {
      const bestReps = getBestReps(ex.exerciseId); if (!bestReps) { showToast('No PR found', 'error'); return; }
      newSet.reps = String(bestReps + 1); ex.sets.push(newSet); targetInfo = `Target: ${bestReps+1} reps`;
    }
  } else {
    const currentE1RM = getBest1RM(ex.exerciseId, null); if (!currentE1RM) { showToast('No PR found', 'error'); return; }
    const result = calcPRWeightReps(currentE1RM + 1, inc, 0); if (!result) { showToast('No PR found', 'error'); return; }
    newSet.weight = String(result.addedWeight); newSet.reps = String(result.reps); ex.sets.push(newSet);
    targetInfo = `Target E1RM: ${Math.round(currentE1RM+1)}${appDb.unit}`;
  }
  const newSi = ex.sets.length - 1;
  const container = document.getElementById(`sets-container-${idx}`);
  const isTimeEx = exData.tracking === 'time' || exData.tracking === 'weight_time';
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

// ==================== BEST PERF HELPERS ====================
function getPreviousPerf(exId) {
  const prev = appDb.workouts.filter(w => w.exercises.some(e => e.exerciseId === exId)).sort((a,b) => b.date-a.date)[0]; if (!prev) return null;
  const ex = prev.exercises.find(e => e.exerciseId === exId); const s = ex?.sets?.[0];
  return s?.weight ? `${s.weight}${appDb.unit} \u00d7 ${s.reps||s.time}` : null;
}
function getBest1RM(exId, excludeId) {
  let best = 0;
  appDb.workouts.filter(w => excludeId ? w.id !== excludeId : true).forEach(w => w.exercises.filter(e => e.exerciseId===exId).forEach(e => e.sets.forEach(s => { if(s.weight&&s.reps){const v=calc1RM(+s.weight,+s.reps);if(v>best)best=v;} })));
  return best;
}
function getBestWeight(exId, excludeId) {
  let best = 0;
  appDb.workouts.filter(w => excludeId ? w.id !== excludeId : true).forEach(w => w.exercises.filter(e => e.exerciseId===exId).forEach(e => e.sets.forEach(s => { if(+s.weight>best)best=+s.weight; })));
  return best;
}
function getBestTime(exId) { let best = 0; appDb.workouts.forEach(w => w.exercises.filter(e=>e.exerciseId===exId).forEach(e => e.sets.forEach(s=>{if(+s.time>best)best=+s.time;}))); return best || null; }
function getBestReps(exId) { let best = 0; appDb.workouts.forEach(w => w.exercises.filter(e=>e.exerciseId===exId).forEach(e => e.sets.forEach(s=>{if(+s.reps>best)best=+s.reps;}))); return best || null; }
function getBestE1RMForExercise(exId, bw) {
  let best = 0;
  appDb.workouts.forEach(w => w.exercises.filter(e=>e.exerciseId===exId).forEach(e => e.sets.forEach(s=>{
    if(s.weight&&+s.weight>0&&s.reps){const v=calc1RM(+s.weight,+s.reps);if(v>best)best=v;}
    if((!s.weight||+s.weight===0)&&s.reps&&bw){const v=calc1RM(bw,+s.reps);if(v>best)best=v;}
  })));
  return best;
}

// ==================== FINISH / CANCEL ====================
function finishWorkout() {
  if (!currentWorkout) return;
  const nameDisplay = document.getElementById('log-session-name-display');
  const nm = nameDisplay ? nameDisplay.textContent.trim() : '';
  currentWorkout.name = (nm && nm !== 'NEW WORKOUT') ? nm : `Workout ${new Date(currentWorkout.date).toLocaleDateString('en-US',{month:'short',day:'numeric'})}`;
  currentWorkout.duration = getElapsedSeconds();
  currentWorkout.exercises.forEach(e => { e.sets = e.sets.filter(s => s.weight||s.reps||s.time); });
  currentWorkout.exercises = currentWorkout.exercises.filter(e => e.sets.length);
  if (!currentWorkout.exercises.length) { showToast('Add at least one set first','error'); return; }
  if (currentWorkout.programId) {
    const prog = appDb.programs.find(p => p.id === currentWorkout.programId);
    if (prog) {
      prog.lastUsed = Date.now();
      const flatIdx = getProgramFlatIndex(prog, currentWorkout.microcycleIdx, currentWorkout.sessionIdx);
      if (!prog.completedSessionIndices) prog.completedSessionIndices = [];
      if (!prog.completedSessionIndices.includes(flatIdx)) prog.completedSessionIndices.push(flatIdx);
      updateRepGoalProgressions(prog, currentWorkout); fsSaveProgram(prog);
    }
  }
  appDb.workouts.unshift(currentWorkout); fsSaveWorkout(currentWorkout);
  stopWorkoutTimer(); currentWorkout = null;
  showToast('Workout saved!','success'); showPage('page-home');
}
function cancelWorkout() {
  confirm2('Cancel Workout','Discard this workout? All data will be lost.', () => { stopWorkoutTimer(); currentWorkout = null; showPage('page-home'); }, 'Discard');
}

// ==================== EXERCISE HISTORY MODAL ====================
function openExHistoryModal(exId) {
  const exData = getExercise(exId);
  document.getElementById('ex-history-modal-title').textContent = exData ? exData.name : exId;
  const workoutsWithEx = appDb.workouts.filter(w => w.exercises.some(e => e.exerciseId === exId)).slice(0, 3);
  const body = document.getElementById('ex-history-modal-body');
  if (!workoutsWithEx.length) { body.innerHTML = '<div class="empty-state" style="padding:30px 0"><h3>No History</h3><p>Not logged yet</p></div>'; openModal('modal-ex-history'); return; }
  body.innerHTML = workoutsWithEx.map(w => {
    const ex = w.exercises.find(e => e.exerciseId === exId);
    const d = new Date(w.date).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
    return `<div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border)"><div style="font-family:var(--font-display);font-size:16px;font-weight:800;color:var(--accent);margin-bottom:6px">${w.name}</div><div style="font-size:13px;color:var(--text3);margin-bottom:8px">${d}</div>${ex.sets.map((s,i)=>{ let line=`Set ${i+1}: `; if(s.weight&&+s.weight>0)line+=`${s.weight}${appDb.unit} \u00d7 ${s.reps||s.time||'\u2014'}`; else if(s.reps)line+=`BW \u00d7 ${s.reps}`; else if(s.time)line+=`${s.time}s`; else line+='\u2014'; return `<div class="history-set-line">${line}</div>`; }).join('')}</div>`;
  }).join('');
  openModal('modal-ex-history');
}

// ==================== PROGRAM PICKER ====================
function openProgramPickerModal() {
  if (!appDb.programs.length) { showToast('No programs yet. Create one first.','error'); return; }
  const sorted = [...appDb.programs].sort((a,b) => (b.lastUsed||0)-(a.lastUsed||0));
  document.getElementById('prog-picker-list').innerHTML = sorted.map(p => {
    const next = getNextSessionForProgram(p);
    const totalSessions = p.microcycles.reduce((a,mc) => a + mc.sessions.length, 0);
    const completed = (p.completedSessionIndices||[]).length;
    let statusText = next === null ? 'Program Complete' : (() => { const sname = p.microcycles[next.microcycleIdx].sessions[next.sessionIdx].name || `Day ${next.sessionIdx+1}`; return `Next: Week ${next.microcycleIdx+1} \u00b7 ${sname}`; })();
    return `<div class="prog-pick-item" onclick="selectProgramForWorkout('${p.id}')"><div><div class="prog-pick-name">${p.name}</div><div class="prog-pick-meta">${statusText} \u00b7 ${completed}/${totalSessions} sessions done</div></div><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="color:var(--accent);flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg></div>`;
  }).join('');
  openModal('modal-prog-picker');
}
function selectProgramForWorkout(progId) {
  const prog = appDb.programs.find(p => p.id === progId); if (!prog) return;
  const next = getNextSessionForProgram(prog);
  closeModal('modal-prog-picker');
  if (next === null) { confirm2('Program Complete', `"${prog.name}" is finished! Restart from Week 1?`, () => { prog.completedSessionIndices = []; prog.trainingMaxes = {}; prog.lastUsed = Date.now(); fsSaveProgram(prog); startNewWorkout(prog.id, 0, 0); }, 'Restart'); return; }
  startNewWorkout(prog.id, next.microcycleIdx, next.sessionIdx);
}
function getNextSessionForProgram(prog) {
  const completed = prog.completedSessionIndices || []; let flatIdx = 0;
  for (let mi = 0; mi < prog.microcycles.length; mi++) { for (let si = 0; si < prog.microcycles[mi].sessions.length; si++) { if (!completed.includes(flatIdx)) return { microcycleIdx: mi, sessionIdx: si }; flatIdx++; } }
  return null;
}
function getProgramFlatIndex(prog, mi, si) { let idx = 0; for (let m = 0; m < mi; m++) idx += prog.microcycles[m].sessions.length; return idx + si; }

// ==================== HISTORY ====================
function renderHistory() {
  renderHistoryStats();
  const wks = [...appDb.workouts];
  const list = document.getElementById('history-list');
  list.innerHTML = wks.length ? wks.map(w => workoutHistoryCard(w)).join('') :
    '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="12 8 12 12 14 14"/><path d="M3.05 11a9 9 0 1 0 .5-4"/></svg><h3>No Workouts Found</h3><p>Start logging to see history here</p></div>';
}
function workoutHistoryCard(w, compact=false) {
  const d = new Date(w.date).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
  const sets = w.exercises.reduce((a,e)=>a+e.sets.length,0);
  const dur = w.duration ? fmtDuration(w.duration) : '';
  const prs = w.exercises.reduce((a,e)=>a+e.sets.filter(s=>s.isPR).length,0);
  const new1rms = w.exercises.reduce((a,e)=>a+e.sets.filter(s=>s.isNew1RM).length,0);
  const wid = w.id;

  if (compact) {
    // Train screen collapsed card
    const prBadge = prs > 0 ? `<span class="recent-badge recent-badge-pr">${prs} PR'S</span>` : '';
    const e1rmBadge = new1rms > 0 ? `<span class="recent-badge recent-badge-1rm">${new1rms} New E1RM${new1rms > 1 ? "'S" : ''}</span>` : '';
    const badges = prBadge || e1rmBadge ? `<div class="recent-card-badges">${prBadge}${e1rmBadge}</div>` : '';
    const metaParts = [`${w.exercises.length} Exercises`, `${sets} Sets`];
    if (dur) metaParts.push(dur);
    return `<div class="recent-card" onclick="toggleRecentCard('${wid}')">
      <div class="recent-card-collapsed" id="recent-collapsed-${wid}">
        <div class="recent-card-main">
          <div class="recent-card-date">${d}</div>
          <div class="recent-card-name-row">
            <div class="recent-card-name">${w.name}</div>
            ${badges}
            <svg class="recent-card-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
          <div class="recent-card-meta">${metaParts.join('<span class="recent-meta-dot">•</span>')}</div>
        </div>
      </div>
      <div class="recent-card-expanded" id="recent-expanded-${wid}" style="display:none">
        <!-- expanded state coming later -->
      </div>
    </div>`;
  }

  // Full history card (unchanged)
  return `<div class="history-item"><div class="history-item-header" onclick="this.parentElement.querySelector('.history-body').classList.toggle('open')"><div style="flex:1"><div class="history-date">${w.name}</div><div style="font-size:13px;color:var(--text3);margin-top:2px">${d}</div><div class="history-meta"><span class="badge badge-accent">${w.exercises.length} exercises</span><span class="badge badge-blue">${sets} sets</span>${dur?`<span class="badge badge-orange">${dur}</span>`:''}${prs?`<span class="badge badge-green">${prs} PR${prs>1?'s':''}</span>`:''}${new1rms?`<span class="badge badge-orange">${new1rms} New 1RM${new1rms>1?'s':''}</span>`:''}</div></div><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--text3);flex-shrink:0;margin-left:8px"><polyline points="6 9 12 15 18 9"/></svg></div><div class="history-body">${w.exercises.map(e => { const ex = getExercise(e.exerciseId); const perfVideos = e.perfVideos || []; const videosHtml = perfVideos.length ? `<div class="history-video-links">${perfVideos.map(v=>`<a class="history-video-link" href="${v}" target="_blank">${v}</a>`).join('')}</div>` : ''; return `<div class="history-ex"><div class="history-ex-name">${ex?ex.name:e.exerciseId}</div>${e.sets.map((s,i)=>`<div class="history-set-line">Set ${i+1}: ${s.weight?s.weight+appDb.unit+' \u00d7 ':''}${s.reps||s.time||'\u2014'}${s.rpe?' @ RPE '+s.rpe:''} ${s.isPR?'<span class="pr-tag">PR</span>':''} ${s.isNew1RM?'<span class="est1rm-tag">1RM</span>':''}</div>`).join('')}${videosHtml}</div>`; }).join('')}<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button class="btn btn-secondary btn-sm" onclick="openCopyModal('${wid}');event.stopPropagation()">Export</button><button class="btn btn-danger btn-sm" onclick="deleteWorkout('${wid}');event.stopPropagation()">Delete</button></div></div></div>`;
}
function toggleRecentCard(wid) {
  const expanded = document.getElementById(`recent-expanded-${wid}`);
  const chevron = document.querySelector(`#recent-collapsed-${wid} .recent-card-chevron`);
  if (!expanded) return;
  const isOpen = expanded.style.display !== 'none';
  expanded.style.display = isOpen ? 'none' : 'block';
  if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
}

function deleteWorkout(id) {
  confirm2('Delete Workout','Permanently delete this workout log?', () => { appDb.workouts = appDb.workouts.filter(w=>w.id!==id); fsDelWorkout(id); renderHistory(); showToast('Workout deleted'); });
}

// ==================== EXERCISE DB ====================
function renderDB() {
  renderDbTabs();
  const search = document.getElementById('db-search').value.toLowerCase();
  const sort = document.getElementById('db-sort').value;
  let exs = [...getAllExercises()];
  if (currentDbBodypart !== 'All') exs = exs.filter(e => e.bodypart===currentDbBodypart);
  if (search) exs = exs.filter(e => e.name.toLowerCase().includes(search));
  if (sort === 'alpha') exs.sort((a,b) => a.name.localeCompare(b.name));
  else exs.sort((a,b) => (getLastUsed(b.id)||0)-(getLastUsed(a.id)||0));
  document.getElementById('db-list').innerHTML = exs.length ? exs.map(e => dbCard(e)).join('') : '<div class="empty-state"><h3>No exercises found</h3><p>Try a different filter</p></div>';
}
function dbCard(ex) {
  const stats = getExerciseStats(ex.id);
  const lu = getLastUsed(ex.id);
  const lastUsed = lu ? new Date(lu).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : 'Never';
  const notes = getExNote(ex.id); const hasNote = notes.trim().length > 0;
  const noteColor = hasNote ? 'var(--accent3)' : 'var(--text3)';
  const videos = getExVideos(ex.id); const hasVideos = videos.length > 0;
  const exrxUrl = EXRX_LINKS[ex.id];
  const noteIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  const videoIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>';
  const notesId = `notes-body-db-${ex.id}`; const videosId = `videos-body-db-${ex.id}`;
  const videosPanel = `<div class="videos-body" id="${videosId}">${videos.length ? videos.map((v,vi) => `<div class="video-link-row"><a class="video-link" href="${v}" target="_blank">${v}</a><button class="btn-icon" style="padding:4px;color:var(--red);border:none;background:none;font-size:12px;flex-shrink:0" onclick="removeDbVideo('${ex.id}',${vi});event.stopPropagation()">x</button></div>`).join('') : '<div style="font-size:13px;color:var(--text3)">No reference videos.</div>'}<div class="video-add-row" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--steel-border)"><input type="text" class="video-add-input" id="db-vid-input-${ex.id}" placeholder="Paste video URL..."><button class="video-add-btn" onclick="addDbVideo('${ex.id}');event.stopPropagation()">+ Add</button></div></div>`;
  return `<div class="db-card"><div onclick="toggleDbStats('${ex.id}')" style="display:flex;align-items:flex-start;justify-content:space-between"><div style="flex:1"><div class="db-card-name" style="display:flex;align-items:center;gap:4px">${ex.name}${exrxUrl?`<a href="${exrxUrl}" target="_blank" class="exrx-link" title="View on ExRx.net" onclick="event.stopPropagation()"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></a>`:''}</div><div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap"><span class="badge badge-blue">${ex.bodypart}</span>${ex.custom?'<span class="badge badge-orange">Custom</span>':''}<span style="font-size:12px;color:var(--text3)">Last: ${lastUsed}</span></div></div><div style="display:flex;gap:6px;flex-shrink:0;margin-left:8px">${ex.custom?`<button class="btn-icon" style="color:var(--accent3)" onclick="openCustomExerciseModal('${ex.id}');event.stopPropagation()">e</button><button class="btn-icon" style="color:var(--red)" onclick="delCustomEx('${ex.id}');event.stopPropagation()">x</button>`:''}</div></div><div style="display:flex;gap:14px;margin-top:8px;flex-wrap:wrap"><span style="font-size:12px;color:${noteColor};cursor:pointer;display:inline-flex;align-items:center;gap:4px" onclick="toggleNotesDb('${ex.id}');event.stopPropagation()">${noteIcon} Notes</span><span style="font-size:12px;color:${hasVideos?'var(--accent3)':'var(--text3)'};cursor:pointer;display:inline-flex;align-items:center;gap:4px" onclick="toggleVideosDb('${ex.id}');event.stopPropagation()">${videoIcon} Videos${hasVideos?` (${videos.length})`:''}</span></div><div class="notes-body" id="${notesId}" onclick="event.stopPropagation()"><div id="${notesId}-text">${notes||'<span style="color:var(--text3);font-style:italic">No notes.</span>'}</div><textarea class="notes-edit-area" id="notes-edit-db-${ex.id}" placeholder="Add notes...">${notes}</textarea><div style="display:flex;gap:8px;margin-top:8px"><button class="btn btn-ghost btn-sm" onclick="startEditNoteDb('${ex.id}')" id="${notesId}-edit-btn">Edit</button><button class="btn btn-primary btn-sm" onclick="saveNoteDb('${ex.id}')" id="${notesId}-save-btn" style="display:none">Save</button><button class="btn btn-ghost btn-sm" onclick="cancelEditNoteDb('${ex.id}')" id="${notesId}-cancel-btn" style="display:none">Cancel</button></div></div>${videosPanel}<div class="db-card-stats" id="dbstats-${ex.id}" onclick="event.stopPropagation()">${stats?`<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:10px"><div><div class="stat-label" style="font-size:11px">Best Weight</div><div style="font-family:var(--font-display);font-size:20px;font-weight:800;color:var(--accent)">${stats.bestWeight||'\u2014'}${stats.bestWeight?`<span style="font-size:12px;color:var(--text3)">${appDb.unit}</span>`:''}</div></div><div><div class="stat-label" style="font-size:11px">Est. 1RM</div><div style="font-family:var(--font-display);font-size:20px;font-weight:800;color:var(--accent2)">${stats.best1rm||'\u2014'}${stats.best1rm?`<span style="font-size:12px;color:var(--text3)">${appDb.unit}</span>`:''}</div></div><div><div class="stat-label" style="font-size:11px">Total Sets</div><div style="font-family:var(--font-display);font-size:20px;font-weight:800;color:var(--accent3)">${stats.totalSets}</div></div></div>${stats.recentSets.length?`<div style="margin-top:10px"><div class="stat-label" style="font-size:11px;margin-bottom:4px">Recent Sets</div>${stats.recentSets.map(s=>`<div style="font-size:14px;color:var(--text2)">${s}</div>`).join('')}</div>`:''}` : '<div style="color:var(--text3);font-size:14px;margin-top:8px">No data logged yet</div>'}</div></div>`;
}
function toggleDbStats(id) { document.querySelectorAll('.db-card-stats').forEach(el=>{if(el.id!=='dbstats-'+id)el.classList.remove('open');}); document.getElementById('dbstats-'+id)?.classList.toggle('open'); }
function toggleNotesDb(id){document.getElementById(`notes-body-db-${id}`)?.classList.toggle('open');}
function toggleVideosDb(id){document.getElementById(`videos-body-db-${id}`)?.classList.toggle('open');}
function addDbVideo(exId){const input=document.getElementById(`db-vid-input-${exId}`);if(!input)return;const url=input.value.trim();if(!url){showToast('Paste a URL first','error');return;}saveExVideos(exId,[...getExVideos(exId),url]);input.value='';renderDB();showToast('Video added','success');}
function removeDbVideo(exId,vi){saveExVideos(exId,getExVideos(exId).filter((_,i)=>i!==vi));renderDB();}
function startEditNoteDb(id){document.getElementById(`notes-edit-db-${id}`).classList.add('open');document.getElementById(`notes-body-db-${id}-text`).style.display='none';document.getElementById(`notes-body-db-${id}-edit-btn`).style.display='none';document.getElementById(`notes-body-db-${id}-save-btn`).style.display='';document.getElementById(`notes-body-db-${id}-cancel-btn`).style.display='';document.getElementById(`notes-edit-db-${id}`).focus();}
function saveNoteDb(id){const ea=document.getElementById(`notes-edit-db-${id}`);if(!ea)return;saveExNote(id,ea.value.trim());showToast('Note saved','success');renderDB();}
function cancelEditNoteDb(id){document.getElementById(`notes-edit-db-${id}`).classList.remove('open');document.getElementById(`notes-body-db-${id}-text`).style.display='';document.getElementById(`notes-body-db-${id}-edit-btn`).style.display='';document.getElementById(`notes-body-db-${id}-save-btn`).style.display='none';document.getElementById(`notes-body-db-${id}-cancel-btn`).style.display='none';}
function getExerciseStats(exId){
  const all=[];
  appDb.workouts.forEach(w=>{const ex=w.exercises.find(e=>e.exerciseId===exId);if(ex)ex.sets.forEach(s=>all.push(s));});
  appDb.importedSets.filter(s=>s.exerciseId===exId).forEach(s=>all.push(s));
  if(!all.length)return null;
  let bestW=0,best1=0;
  all.forEach(s=>{if(+s.weight>bestW)bestW=+s.weight;if(s.weight&&s.reps){const v=calc1RM(+s.weight,+s.reps);if(v>best1)best1=v;}});
  const recent=all.slice(-3).reverse().map(s=>`${s.weight?s.weight+appDb.unit+' \u00d7 ':''}${s.reps||s.time||'?'}${s.rpe?' @ RPE '+s.rpe:''}`);
  return{bestWeight:bestW||null,best1rm:best1?Math.round(best1):null,totalSets:all.length,recentSets:recent};
}
function renderDbTabs(){ document.getElementById('db-tabs').innerHTML=BODY_PARTS.map(bp=>`<button class="tab ${currentDbBodypart===bp?'active':''}" onclick="currentDbBodypart='${bp}';renderDB()">${bp}</button>`).join(''); }
function delCustomEx(id){ confirm2('Delete Exercise','Remove this custom exercise?',()=>{appDb.customExercises=appDb.customExercises.filter(e=>e.id!==id);fsDelCustomEx(id);renderDB();showToast('Exercise deleted');}); }

// ==================== PROGRAMS ====================
function renderPrograms(){
  document.getElementById('programs-list').innerHTML=appDb.programs.length?appDb.programs.map(p=>programCard(p)).join(''):
    '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><h3>No Programs Yet</h3><p>Create a program to plan your training</p></div>';
}
function programCard(prog){
  const next=getNextSessionForProgram(prog);
  const totalSessions=prog.microcycles.reduce((a,mc)=>a+mc.sessions.length,0);
  const completed=(prog.completedSessionIndices||[]).length;
  const isComplete=next===null;
  const dayCounts=prog.microcycles.map(mc=>mc.sessions.length);
  const allEqual=dayCounts.every(d=>d===dayCounts[0]);
  const daysPerWeekBadge=allEqual&&dayCounts[0]>0?`<span class="badge badge-blue">${dayCounts[0]} days/week</span>`:'';
  const _sname=!isComplete?(prog.microcycles[next.microcycleIdx].sessions[next.sessionIdx].name||`Day ${next.sessionIdx+1}`):'';
  let startBtnHtml=isComplete
    ?`<button class="btn btn-ghost btn-sm" onclick="restartProgram('${prog.id}')">Restart Program</button>`
    :`<button class="btn btn-primary btn-sm" onclick="selectProgramForWorkout('${prog.id}')">Start — Week ${!isComplete?next.microcycleIdx+1:''} · ${_sname}</button>`;
  const descId=`prog-desc-${prog.id}`;const descText=prog.notes||'';
  const descHtml=`<div style="margin-top:8px;margin-bottom:10px"><div class="prog-desc-view" id="${descId}-view" onclick="startEditProgDesc('${prog.id}')">${descText||'<span class="prog-desc-placeholder">Add a description...</span>'}</div><div class="prog-desc-edit" id="${descId}-edit"><textarea style="width:100%;margin-top:4px;min-height:70px;font-size:14px" placeholder="Goals, description...">${descText}</textarea><div style="display:flex;gap:8px;margin-top:6px"><button class="btn btn-primary btn-sm" onclick="saveProgDesc('${prog.id}')">Save</button><button class="btn btn-ghost btn-sm" onclick="cancelProgDesc('${prog.id}')">Cancel</button></div></div></div>`;
  const tmSummary=buildTMSummary(prog);
  const weeks=prog.microcycles.map((mc,mi)=>{
    const mcId=`mc-${prog.id}-${mi}`;
    return`<div style="margin-bottom:6px"><div class="microcycle-row" onclick="toggleMicrocycle('${prog.id}',${mi});event.stopPropagation()"><div><div class="microcycle-label">Week ${mi+1}</div><div style="font-size:13px;color:var(--text3);margin-top:2px">${mc.sessions.filter(s=>s.exercises.length).length}/${mc.sessions.length} sessions planned</div></div><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--text3)" id="${mcId}-chevron"><polyline points="6 9 12 15 18 9"/></svg></div><div id="${mcId}" style="display:none;padding:8px 0 4px 0">${mc.sessions.map((s,si)=>{const flatIdx=getProgramFlatIndex(prog,mi,si);const isDone=(prog.completedSessionIndices||[]).includes(flatIdx);const isFirst=si===0,isLast=si===mc.sessions.length-1;return`<div style="background:var(--surface2);border:1px solid ${isDone?'rgba(46,213,115,0.3)':'var(--border)'};border-radius:var(--radius-sm);padding:10px 12px;margin-bottom:6px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><div style="cursor:pointer;flex:1" onclick="openSessionModal('${prog.id}',${mi},${si})"><div style="font-family:var(--font-display);font-size:15px;font-weight:700;text-transform:uppercase;display:flex;align-items:center;gap:7px">${s.name||'Day '+(si+1)} ${isDone?'<span class="badge badge-green" style="font-size:10px;padding:2px 7px">Done</span>':''}</div><div style="font-size:13px;color:var(--text3);margin-top:2px">${s.exercises.length} exercise${s.exercises.length!==1?'s':''} · tap to edit</div></div><div style="display:flex;gap:5px;flex-shrink:0;margin-left:8px">${!isFirst?`<button class="btn-icon btn-sm" onclick="moveDayLeft('${prog.id}',${mi},${si});event.stopPropagation()">&larr;</button>`:'<div style="width:34px"></div>'}${!isLast?`<button class="btn-icon btn-sm" onclick="moveDayRight('${prog.id}',${mi},${si});event.stopPropagation()">&rarr;</button>`:'<div style="width:34px"></div>'}<button class="btn-icon btn-sm" onclick="openMoveToWeekModal('${prog.id}',${mi},${si});event.stopPropagation()" style="color:var(--accent3);font-size:11px;padding:6px">&harr;</button><button class="btn-icon btn-sm" onclick="duplicateDay('${prog.id}',${mi},${si});event.stopPropagation()" style="color:var(--accent2);font-size:11px">+</button><button class="btn-icon btn-sm" style="color:var(--red)" onclick="removeDay('${prog.id}',${mi},${si});event.stopPropagation()">x</button></div></div></div>`;}).join('')}<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" onclick="addDay('${prog.id}',${mi});event.stopPropagation()">+ Add Day</button><button class="btn btn-ghost btn-sm" onclick="duplicateWeek('${prog.id}',${mi});event.stopPropagation()" style="color:var(--accent2);border-color:rgba(255,170,0,0.3)">+ Duplicate Week</button><button class="btn btn-danger btn-sm" onclick="removeWeek('${prog.id}',${mi});event.stopPropagation()">Remove Week</button></div></div></div>`;
  }).join('');
  return`<div class="program-card"><div class="program-card-header"><div style="flex:1"><div class="program-name">${prog.name}</div><div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap"><span class="badge badge-accent">${prog.microcycles.length} weeks</span>${daysPerWeekBadge}<span class="badge ${isComplete?'badge-green':'badge-orange'}">${completed}/${totalSessions} done</span></div>${descHtml}</div><button class="btn-icon" style="color:var(--red);margin-left:8px;flex-shrink:0" onclick="deleteProg('${prog.id}')">x</button></div><div style="margin-bottom:12px">${startBtnHtml}</div>${weeks}<div style="margin-top:8px"><button class="btn btn-secondary" style="width:100%" onclick="addWeek('${prog.id}')">+ Add Week</button></div></div>`;
}
function buildTMSummary(prog){
  if(!prog.trainingMaxes||!Object.keys(prog.trainingMaxes).length)return'';
  const lines=Object.entries(prog.trainingMaxes).map(([exId,tmData])=>{const ex=getExercise(exId);const name=ex?ex.name:exId;if(tmData.value)return`${name}: TM ${tmData.value}${appDb.unit}`;if(tmData.repGoalBase!=null)return`${name}: Base ${tmData.repGoalBase}${appDb.unit} (${tmData.repGoalTarget} reps)`;return null;}).filter(Boolean);
  if(!lines.length)return'';
  return`<div style="margin-top:8px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px"><div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--accent2);margin-bottom:6px">Training Maxes / Baselines</div>${lines.map(l=>`<div style="font-size:13px;color:var(--text2);margin-bottom:3px">${l}</div>`).join('')}</div>`;
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
function openMoveToWeekModal(progId,mi,si){
  moveDayProgId=progId;moveDayMi=mi;moveDaySi=si;
  const prog=appDb.programs.find(p=>p.id===progId);if(!prog)return;
  const sname=prog.microcycles[mi].sessions[si].name||`Day ${si+1}`;
  document.getElementById('move-week-body').innerHTML=`<div style="margin-bottom:12px;font-size:14px;color:var(--text2)">Move <strong>${sname}</strong> (Week ${mi+1}) to:</div>`+prog.microcycles.map((mc,idx)=>idx===mi?'':`<div onclick="moveDayToWeek(${idx})" style="padding:13px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;align-items:center;justify-content:space-between;background:var(--surface2);border-radius:var(--radius-sm);margin-bottom:6px" onmouseenter="this.style.background='var(--surface3)'" onmouseleave="this.style.background='var(--surface2)'"><div style="font-family:var(--font-display);font-size:16px;font-weight:700;text-transform:uppercase">Week ${idx+1}</div><div style="font-size:13px;color:var(--text3)">${mc.sessions.length} day${mc.sessions.length!==1?'s':''}</div></div>`).join('');
  openModal('modal-move-week');
}
function moveDayToWeek(destMi){const prog=appDb.programs.find(p=>p.id===moveDayProgId);if(!prog)return;const day=prog.microcycles[moveDayMi].sessions.splice(moveDaySi,1)[0];prog.microcycles[destMi].sessions.push(day);fsSaveProgram(prog);closeModal('modal-move-week');renderPrograms();setTimeout(()=>{const el=document.getElementById(`mc-${moveDayProgId}-${destMi}`);if(el)el.style.display='block';},50);showToast(`Day moved to Week ${destMi+1}`,'success');}
function toggleMicrocycle(progId,mi){const el=document.getElementById(`mc-${progId}-${mi}`);const chev=document.getElementById(`mc-${progId}-${mi}-chevron`);if(el){const isOpen=el.style.display!=='none';el.style.display=isOpen?'none':'block';if(chev)chev.style.transform=isOpen?'':'rotate(180deg)';}}
function restartProgram(progId){confirm2('Restart Program','Clear all progress and restart? Your workout history is kept.',()=>{const prog=appDb.programs.find(p=>p.id===progId);if(!prog)return;prog.completedSessionIndices=[];prog.trainingMaxes={};prog.lastUsed=Date.now();fsSaveProgram(prog);renderPrograms();showToast('Program restarted','success');},'Restart');}
function deleteProg(id){confirm2('Delete Program','Permanently delete this program?',()=>{appDb.programs=appDb.programs.filter(p=>p.id!==id);fsDelProgram(id);renderPrograms();showToast('Program deleted');});}

// ==================== SESSION MODAL ====================
function openSessionModal(progId,mi,si){currentProgramId=progId;currentMicrocycleIdx=mi;currentSessionIdx=si;sessionPickerBodypart='All';document.getElementById('session-modal-title').textContent=`Week ${mi+1} \u00b7 Day ${si+1}`;renderSessionView();openModal('modal-session');}
function renderSessionView(){
  const prog=appDb.programs.find(p=>p.id===currentProgramId);
  const session=prog.microcycles[currentMicrocycleIdx].sessions[currentSessionIdx];
  document.getElementById('session-modal-body').innerHTML=`<div style="margin-bottom:12px"><button class="btn btn-primary" style="width:100%" onclick="startSessionFromModal('${currentProgramId}',${currentMicrocycleIdx},${currentSessionIdx})">Start This Workout</button></div><div class="form-group"><label>Session Name</label><input type="text" value="${session.name||''}" placeholder="e.g. Push A" oninput="updateSessionName(this.value)"></div><div id="session-exercises-body">${session.exercises.map((ex,i)=>renderSessionExBlock(ex,i)).join('')}</div><button class="btn btn-secondary" style="width:100%;margin-bottom:12px" onclick="renderSessionPicker()">+ Add Exercise</button>`;
}
function startSessionFromModal(progId,mi,si){closeModal('modal-session');startNewWorkout(progId,mi,si);}
function renderSessionPicker(){
  document.getElementById('session-modal-body').innerHTML=`<div style="margin-bottom:12px"><button class="btn btn-ghost btn-sm" onclick="renderSessionView()">&larr; Back</button></div><div style="position:relative;margin-bottom:12px"><svg style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text3);pointer-events:none" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input type="text" id="sess-picker-search" placeholder="Search exercises..." style="padding-left:40px" oninput="renderSessionPickerList()"></div><div class="tabs" id="sess-picker-tabs" style="padding:0 0 12px;flex-wrap:wrap;gap:5px"></div><div id="sess-picker-list" style="max-height:42vh;overflow-y:auto"></div><div style="border-top:1px solid var(--border);padding-top:12px;margin-top:8px"><button class="btn btn-ghost" style="width:100%" onclick="openCustomExFromSessionPicker()">+ Create Custom Exercise</button></div>`;
  renderSessionPickerTabs();renderSessionPickerList();
}
function renderSessionPickerTabs(){const el=document.getElementById('sess-picker-tabs');if(!el)return;el.innerHTML=BODY_PARTS.map(bp=>`<button class="tab ${sessionPickerBodypart===bp?'active':''}" onclick="sessionPickerBodypart='${bp}';renderSessionPickerTabs();renderSessionPickerList()">${bp}</button>`).join('');}
function renderSessionPickerList(){
  const q=(document.getElementById('sess-picker-search')?.value||'').toLowerCase();
  let exs=[...getAllExercises()].sort((a,b)=>a.name.localeCompare(b.name));
  if(sessionPickerBodypart!=='All')exs=exs.filter(e=>e.bodypart===sessionPickerBodypart);
  if(q)exs=exs.filter(e=>e.name.toLowerCase().includes(q));
  const el=document.getElementById('sess-picker-list');if(!el)return;
  el.innerHTML=exs.map(e=>`<div onclick="addExToSession('${e.id}')" style="padding:13px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;align-items:center;justify-content:space-between" onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background=''"><div><div style="font-family:var(--font-display);font-size:16px;font-weight:700;text-transform:uppercase;color:var(--text)">${e.name}</div><div style="margin-top:3px"><span class="badge badge-blue">${e.bodypart}</span>${e.custom?'<span class="badge badge-orange" style="margin-left:5px">Custom</span>':''}</div></div><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="color:var(--accent);flex-shrink:0"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></div>`).join('')||'<div style="padding:20px;text-align:center;color:var(--text3)">No exercises found</div>';
}
function addExToSession(exId){const prog=appDb.programs.find(p=>p.id===currentProgramId);const session=prog.microcycles[currentMicrocycleIdx].sessions[currentSessionIdx];session.exercises.push({exerciseId:exId,sets:[{weight:'',reps:'',progression:'',progressionValue:''}]});fsSaveProgram(prog);sessionPickerBodypart='All';renderSessionView();}
function renderSessionExBlock(ex,idx){
  const exData=getExercise(ex.exerciseId);const name=exData?exData.name:ex.exerciseId;
  const isTime=exData&&(exData.tracking==='time'||exData.tracking==='weight_time');
  const setsHTML=(ex.sets||[]).map((s,si)=>{
    const hasProg=s.progression==='pct1rm'||s.progression==='rep_goal';
    const valueLabel=s.progression==='pct1rm'?'%':s.progression==='rep_goal'?'Rep Goal':'';
    const valuePlaceholder=s.progression==='pct1rm'?'e.g. 75':s.progression==='rep_goal'?'Reps':'';
    const gridCols=hasProg?'28px 1fr 1fr 1fr 1fr 34px':'28px 1fr 1fr 1fr 34px';
    return `<div style="display:grid;grid-template-columns:${gridCols};gap:5px;align-items:center;margin-bottom:6px">
      <div style="font-family:var(--font-display);font-size:14px;font-weight:700;color:var(--text3);text-align:center">${si+1}</div>
      <input class="set-input" type="number" placeholder="Wt" value="${s.weight||''}" oninput="updateSessSet(${idx},${si},'weight',this.value)" step="0.5">
      <input class="set-input" type="text" placeholder="${isTime?'Time':'Reps'}" value="${s.reps||s.time||''}" oninput="updateSessSet(${idx},${si},'${isTime?'time':'reps'}',this.value)">
      <select class="set-input" style="font-size:12px;padding:9px 4px" onchange="updateSessSet(${idx},${si},'progression',this.value)">
        <option value="" ${!s.progression?'selected':''}>--</option>
        <option value="pct1rm" ${s.progression==='pct1rm'?'selected':''}>&percnt;1RM</option>
        <option value="rep_goal" ${s.progression==='rep_goal'?'selected':''}>Rep Goal</option>
      </select>
      ${hasProg?`<input class="set-input" type="text" placeholder="${valuePlaceholder}" value="${s.progressionValue||''}" oninput="updateSessSet(${idx},${si},'progressionValue',this.value)">`:'' }
      <button class="btn-icon" style="padding:5px;color:var(--red);border-color:rgba(255,71,87,0.4)" onclick="removeSessSet(${idx},${si})">x</button>
    </div>`;
  }).join('');
  const anyProg=(ex.sets||[]).some(s=>s.progression==='pct1rm'||s.progression==='rep_goal');
  // Determine value header label — use the first set that has a progression, or fall back
  const firstProg=(ex.sets||[]).find(s=>s.progression==='pct1rm'||s.progression==='rep_goal');
  const valueHeaderLabel=firstProg?.progression==='pct1rm'?'%':firstProg?.progression==='rep_goal'?'Rep Goal':'Value';
  const headerCols=anyProg?'28px 1fr 1fr 1fr 1fr 34px':'28px 1fr 1fr 1fr 34px';
  return`<div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:12px;margin-bottom:10px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div style="font-family:var(--font-display);font-size:17px;font-weight:800;text-transform:uppercase">${name}</div>
      <div style="display:flex;gap:5px">
        <button class="btn-icon" onclick="moveSessEx(${idx},-1)">&uarr;</button>
        <button class="btn-icon" onclick="moveSessEx(${idx},1)">&darr;</button>
        <button class="btn-icon" style="color:var(--red)" onclick="removeSessEx(${idx})">x</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:${headerCols};gap:5px;margin-bottom:5px">
      <div class="set-label">SET</div>
      <div class="set-label">WT</div>
      <div class="set-label">${isTime?'TIME':'REPS'}</div>
      <div class="set-label">PROG</div>
      ${anyProg?`<div class="set-label">${valueHeaderLabel}</div>`:''}
      <div></div>
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
function openAddExerciseModal(){currentModalBodypart='All';document.getElementById('modal-ex-search').value='';renderModalExTabs();renderModalExList();openModal('modal-add-exercise');}
function renderModalExTabs(){document.getElementById('modal-ex-tabs').innerHTML=BODY_PARTS.map(bp=>`<button class="tab ${currentModalBodypart===bp?'active':''}" onclick="currentModalBodypart='${bp}';renderModalExTabs();renderModalExList()">${bp}</button>`).join('');}
function renderModalExList(){
  const q=(document.getElementById('modal-ex-search')?.value||'').toLowerCase();
  let exs=[...getAllExercises()].sort((a,b)=>a.name.localeCompare(b.name));
  if(currentModalBodypart!=='All')exs=exs.filter(e=>e.bodypart===currentModalBodypart);
  if(q)exs=exs.filter(e=>e.name.toLowerCase().includes(q));
  document.getElementById('modal-ex-list').innerHTML=exs.map(e=>`<div onclick="addExToWorkout('${e.id}')" style="padding:13px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;align-items:center;justify-content:space-between" onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background=''"><div><div style="font-family:var(--font-display);font-size:16px;font-weight:700;text-transform:uppercase;color:var(--text)">${e.name}</div><div style="margin-top:3px"><span class="badge badge-blue">${e.bodypart}</span>${e.custom?'<span class="badge badge-orange" style="margin-left:5px">Custom</span>':''}</div></div><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="color:var(--accent);flex-shrink:0"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></div>`).join('')||'<div style="padding:20px;text-align:center;color:var(--text3)">No exercises found</div>';
}
function addExToWorkout(exId){if(!currentWorkout)return;currentWorkout.exercises.push({exerciseId:exId,sets:[{weight:'',reps:'',time:'',rpe:'',completed:false}],perfVideos:[]});renderWorkoutExercises();closeModal('modal-add-exercise');}

// ==================== RANDOMIZER ====================
let lastRandomExId = null;

function getFilteredExList(mode) {
  if (mode === 'add') {
    const q = (document.getElementById('modal-ex-search')?.value || '').toLowerCase();
    let exs = [...getAllExercises()].sort((a,b) => a.name.localeCompare(b.name));
    if (currentModalBodypart !== 'All') exs = exs.filter(e => e.bodypart === currentModalBodypart);
    if (q) exs = exs.filter(e => e.name.toLowerCase().includes(q));
    return exs;
  } else {
    const q = (document.getElementById('change-ex-search')?.value || '').toLowerCase();
    let exs = [...getAllExercises()].sort((a,b) => a.name.localeCompare(b.name));
    if (changeExBodypart !== 'All') exs = exs.filter(e => e.bodypart === changeExBodypart);
    if (q) exs = exs.filter(e => e.name.toLowerCase().includes(q));
    return exs;
  }
}

function randomizeExercise(mode) {
  const exs = getFilteredExList(mode);
  if (!exs.length) { showToast('No match found. Choose a different filter.', 'error'); return; }
  let pool = exs.filter(e => e.id !== lastRandomExId);
  if (!pool.length) pool = exs; // only one exercise in filter, allow repeat
  const picked = pool[Math.floor(Math.random() * pool.length)];
  lastRandomExId = picked.id;
  showRandomConfirm(picked, mode);
}

function showRandomConfirm(ex, mode) {
  const listEl = document.getElementById(mode === 'add' ? 'modal-ex-list' : 'change-ex-list');
  if (!listEl) return;
  listEl.innerHTML = `
    <div style="padding:24px 16px;text-align:center">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text3);margin-bottom:12px">Selected</div>
      <div style="font-family:var(--font-display);font-size:24px;font-weight:900;text-transform:uppercase;color:var(--text);margin-bottom:8px">${ex.name}</div>
      <div style="margin-bottom:24px"><span class="badge badge-blue">${ex.bodypart}</span>${ex.custom ? '<span class="badge badge-orange" style="margin-left:6px">Custom</span>' : ''}</div>
      <div style="display:flex;gap:10px;justify-content:center">
        <button class="btn btn-primary" style="flex:1;max-width:160px" onclick="acceptRandomExercise('${ex.id}','${mode}')">Accept</button>
        <button class="btn btn-ghost" style="flex:1;max-width:160px" onclick="rerollExercise('${mode}')">🎲 Re-Roll</button>
      </div>
    </div>`;
}

function acceptRandomExercise(exId, mode) {
  lastRandomExId = null;
  if (mode === 'add') {
    addExToWorkout(exId);
  } else {
    confirmChangeExercise(exId);
  }
}

function rerollExercise(mode) {
  randomizeExercise(mode);
}
function renderCustomExVideosList(){const list=document.getElementById('custom-ex-videos-list');if(!list)return;list.innerHTML=customExTempVideos.map((v,i)=>`<div class="video-link-row" style="margin-bottom:6px"><span style="font-size:13px;color:var(--text2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v}</span><button class="btn-icon" style="padding:4px;color:var(--red);border:none;background:none;font-size:12px;flex-shrink:0" onclick="removeCustomExVideo(${i})">x</button></div>`).join('');}
function addCustomExVideo(){const input=document.getElementById('custom-ex-video-input');if(!input)return;const url=input.value.trim();if(!url)return;customExTempVideos.push(url);input.value='';renderCustomExVideosList();}
function removeCustomExVideo(i){customExTempVideos.splice(i,1);renderCustomExVideosList();}
function openCustomExerciseModal(exId){
  customExEditId=exId||null;customExFromLogger=false;customExFromSessionPicker=false;
  const ex=exId?appDb.customExercises.find(e=>e.id===exId):null;
  document.getElementById('custom-ex-modal-title').textContent=ex?'Edit Exercise':'Custom Exercise';
  document.getElementById('custom-ex-name').value=ex?ex.name:'';
  document.getElementById('custom-ex-bodypart').value=ex?ex.bodypart:'Quadriceps';
  document.getElementById('custom-ex-tracking').value=ex?ex.tracking:'weight_reps';
  document.getElementById('custom-ex-notes').value=ex?(ex.notes||''):'';
  customExTempVideos=ex?[...(ex.videos||[])]:[];
  document.getElementById('custom-ex-video-input').value='';
  renderCustomExVideosList();openModal('modal-custom-ex');
}
function openCustomExFromLogger(){customExEditId=null;customExFromLogger=true;customExFromSessionPicker=false;customExFromChanger=false;document.getElementById('custom-ex-modal-title').textContent='Create Custom Exercise';document.getElementById('custom-ex-name').value='';document.getElementById('custom-ex-bodypart').value='Quadriceps';document.getElementById('custom-ex-tracking').value='weight_reps';document.getElementById('custom-ex-notes').value='';customExTempVideos=[];document.getElementById('custom-ex-video-input').value='';renderCustomExVideosList();closeModal('modal-add-exercise');openModal('modal-custom-ex');}
function openCustomExFromChanger(){customExEditId=null;customExFromLogger=false;customExFromSessionPicker=false;customExFromChanger=true;document.getElementById('custom-ex-modal-title').textContent='Create Custom Exercise';document.getElementById('custom-ex-name').value='';document.getElementById('custom-ex-bodypart').value='Quadriceps';document.getElementById('custom-ex-tracking').value='weight_reps';document.getElementById('custom-ex-notes').value='';customExTempVideos=[];document.getElementById('custom-ex-video-input').value='';renderCustomExVideosList();closeModal('modal-change-exercise');openModal('modal-custom-ex');}
function openCustomExFromSessionPicker(){customExEditId=null;customExFromLogger=false;customExFromSessionPicker=true;customExFromChanger=false;document.getElementById('custom-ex-modal-title').textContent='Create Custom Exercise';document.getElementById('custom-ex-name').value='';document.getElementById('custom-ex-bodypart').value='Quadriceps';document.getElementById('custom-ex-tracking').value='weight_reps';document.getElementById('custom-ex-notes').value='';customExTempVideos=[];document.getElementById('custom-ex-video-input').value='';renderCustomExVideosList();openModal('modal-custom-ex');}
function closeCustomExModal(){closeModal('modal-custom-ex');if(customExFromLogger)openAddExerciseModal();else if(customExFromChanger)openChangeExModal(changeExTargetIdx);else if(customExFromSessionPicker)renderSessionPicker();}
function saveCustomExercise(){
  const name=document.getElementById('custom-ex-name').value.trim();if(!name){showToast('Enter an exercise name','error');return;}
  if(customExEditId){const ex=appDb.customExercises.find(e=>e.id===customExEditId);if(ex){ex.name=name;ex.bodypart=document.getElementById('custom-ex-bodypart').value;ex.tracking=document.getElementById('custom-ex-tracking').value;ex.notes=document.getElementById('custom-ex-notes').value.trim();ex.videos=[...customExTempVideos];fsSaveCustomEx(ex);closeModal('modal-custom-ex');renderDB();showToast('Exercise updated','success');}}
  else{const ex={id:uid(),name,bodypart:document.getElementById('custom-ex-bodypart').value,tracking:document.getElementById('custom-ex-tracking').value,notes:document.getElementById('custom-ex-notes').value.trim(),videos:[...customExTempVideos],custom:true};appDb.customExercises.push(ex);fsSaveCustomEx(ex);if(customExFromLogger){addExToWorkout(ex.id);closeModal('modal-custom-ex');showToast('Exercise created and added','success');}else if(customExFromChanger){confirmChangeExercise(ex.id);closeModal('modal-custom-ex');showToast('Exercise created and added','success');}else if(customExFromSessionPicker){addExToSession(ex.id);closeModal('modal-custom-ex');showToast('Exercise created and added','success');}else{closeModal('modal-custom-ex');renderDB();showToast('Exercise added','success');}}
}
function openNewProgramModal(){document.getElementById('prog-name').value='';document.getElementById('prog-notes').value='';openModal('modal-program');}
function saveProgram(){const name=document.getElementById('prog-name').value.trim();if(!name){showToast('Enter a program name','error');return;}const prog={id:uid(),name,notes:document.getElementById('prog-notes').value.trim(),microcycles:[{week:1,sessions:[]}],completedSessionIndices:[],trainingMaxes:{},lastUsed:null};appDb.programs.push(prog);fsSaveProgram(prog);closeModal('modal-program');renderPrograms();showToast('Program created','success');}

// ==================== IMPORT / EXPORT ====================
function openImportExportModal(){renderImportExportHome();openModal('modal-import-export');}
function renderImportExportHome(){
  document.getElementById('import-export-body').innerHTML=`<div style="display:flex;flex-direction:column;gap:10px"><div onclick="renderImportView()" style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:12px" onmouseenter="this.style.borderColor='var(--accent)'" onmouseleave="this.style.borderColor='var(--border)'"><div style="background:rgba(255,106,0,0.15);border-radius:8px;padding:9px;flex-shrink:0"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ff6a00" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div><div style="flex:1"><div style="font-family:var(--font-display);font-size:16px;font-weight:700;text-transform:uppercase;color:var(--text)">Import CSV</div><div style="font-size:13px;color:var(--text3);margin-top:2px">Load historical workout data from a file</div></div></div><div onclick="runExport()" style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:12px" onmouseenter="this.style.borderColor='var(--accent3)'" onmouseleave="this.style.borderColor='var(--border)'"><div style="background:rgba(71,200,255,0.12);border-radius:8px;padding:9px;flex-shrink:0"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#47c8ff" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></div><div style="flex:1"><div style="font-family:var(--font-display);font-size:16px;font-weight:700;text-transform:uppercase;color:var(--text)">Export CSV</div><div style="font-size:13px;color:var(--text3);margin-top:2px">Download your complete workout history</div></div></div></div>`;
}
function renderImportView(){
  document.getElementById('import-export-body').innerHTML=`<div style="margin-bottom:14px"><button class="btn btn-ghost btn-sm" onclick="renderImportExportHome()">&larr; Back</button></div><div style="background:var(--steel);border:1px solid var(--steel-border);border-radius:var(--radius-sm);padding:13px 14px;margin-bottom:16px;font-size:14px;color:var(--text2);line-height:1.6"><div style="font-family:var(--font-display);font-size:14px;font-weight:700;text-transform:uppercase;color:var(--accent3);margin-bottom:6px">Before You Import</div>CSV columns: <code style="font-size:12px;color:var(--accent2)">date, workout_name, exercise_name, set_number, weight, reps, rpe, duration_seconds, notes</code><br><br>Date formats: <strong>M/D/YYYY</strong> or <strong>M-D-YY</strong><br><br><span onclick="downloadTemplate()" style="color:var(--accent3);cursor:pointer;text-decoration:underline;font-weight:600">Download blank template</span></div><div class="form-group"><label>Select CSV File</label><input type="file" id="import-file-input" accept=".csv" style="padding:10px;cursor:pointer"></div><button class="btn btn-primary" style="width:100%" onclick="runImport()">Import</button>`;
}
function downloadTemplate(){const header='date,workout_name,exercise_name,set_number,weight,reps,rpe,duration_seconds,notes';const example='1/15/2024,Push Day A,Barbell Bench Press,1,185,8,,,';triggerDownload(header+'\n'+example+'\n','ironlog-import-template.csv','text/csv');showToast('Template downloaded','success');}
function triggerDownload(content,filename,mimeType){const blob=new Blob([content],{type:mimeType});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function parseImportDate(raw){if(!raw)return null;raw=raw.trim();let m=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(m)return new Date(+m[3],+m[1]-1,+m[2]).getTime();m=raw.match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/);if(m){const yr=+m[3]<50?2000+ +m[3]:1900+ +m[3];return new Date(yr,+m[1]-1,+m[2]).getTime();}m=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);if(m){const yr=+m[3]<50?2000+ +m[3]:1900+ +m[3];return new Date(yr,+m[1]-1,+m[2]).getTime();}return null;}
function parseCSV(text){const lines=text.split(/\r?\n/);const rows=[];for(let i=1;i<lines.length;i++){const line=lines[i].trim();if(!line)continue;const cols=[];let cur='',inQ=false;for(let c=0;c<line.length;c++){const ch=line[c];if(ch==='"'){inQ=!inQ;}else if(ch===','&&!inQ){cols.push(cur);cur='';}else{cur+=ch;}}cols.push(cur);rows.push(cols);}return rows;}
async function runImport(){
  const fileInput=document.getElementById('import-file-input');if(!fileInput||!fileInput.files.length){showToast('Select a CSV file first','error');return;}
  if(appDb.importedSets.length>0){confirm2('Existing Import Detected',`You already have ${appDb.importedSets.length} imported sets. Importing again will add duplicates. Continue?`,()=>doImport(fileInput.files[0]),'Import Anyway');return;}
  doImport(fileInput.files[0]);
}
async function doImport(file){
  const text=await file.text();const rows=parseCSV(text);
  const exAll=getAllExercises();const newCustomExes={};const setsToSave=[];
  for(const cols of rows){
    const dateRaw=(cols[0]||'').trim();const exName=(cols[2]||'').trim();const weight=(cols[4]||'').trim();const reps=(cols[5]||'').trim();
    if(!dateRaw&&!weight&&!reps)continue;if(!dateRaw)continue;
    const dateTs=parseImportDate(dateRaw);if(!dateTs)continue;if(!exName)continue;
    let matched=exAll.find(e=>e.name.toLowerCase()===exName.toLowerCase());
    if(!matched&&newCustomExes[exName.toLowerCase()])matched=newCustomExes[exName.toLowerCase()];
    if(!matched){const newEx={id:uid(),name:exName,bodypart:'Other',tracking:'weight_reps',custom:true};appDb.customExercises.push(newEx);fsSaveCustomEx(newEx);newCustomExes[exName.toLowerCase()]=newEx;matched=newEx;}
    setsToSave.push({id:uid(),exerciseId:matched.id,date:dateTs,workoutName:(cols[1]||'').trim(),setNumber:(cols[3]||'').trim(),weight,reps});
  }
  const BATCH_SIZE=400;
  for(let i=0;i<setsToSave.length;i+=BATCH_SIZE){const batch=fsDb.batch();setsToSave.slice(i,i+BATCH_SIZE).forEach(s=>{batch.set(COL_IMPORTED_SETS.doc(s.id),s);});await batch.commit();}
  appDb.importedSets.push(...setsToSave);closeModal('modal-import-export');
  if(setsToSave.length===0)showToast('Import failed - no valid rows found','error');
  else showToast(`Imported ${setsToSave.length} set${setsToSave.length!==1?'s':''}`, 'success');
}
function runExport(){
  const rows=['date,workout_name,exercise_name,set_number,weight,reps,rpe,duration_seconds,notes'];
  appDb.workouts.forEach(w=>{const d=new Date(w.date);const dateStr=`${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;const dur=w.duration||'';w.exercises.forEach(e=>{const ex=getExercise(e.exerciseId);const exName=ex?ex.name:e.exerciseId;e.sets.forEach((s,si)=>{rows.push([dateStr,csvEscape(w.name),csvEscape(exName),si+1,s.weight||'',s.reps||s.time||'',s.rpe||'',si===0?dur:'',''].join(','));});});});
  appDb.importedSets.forEach(s=>{const d=new Date(s.date);const dateStr=`${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;const ex=getExercise(s.exerciseId);rows.push([dateStr,csvEscape(s.workoutName||''),csvEscape(ex?ex.name:s.exerciseId),s.setNumber||'',s.weight||'',s.reps||'','','',''].join(','));});
  const today=new Date();const datePart=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  triggerDownload(rows.join('\n'),`ironlog-export-${datePart}.csv`,'text/csv');closeModal('modal-import-export');showToast('Export downloaded','success');
}
function csvEscape(val){if(!val)return'';const s=String(val);if(s.includes(',')||s.includes('"')||s.includes('\n'))return`"${s.replace(/"/g,'""')}"`;return s;}

// ==================== UTILITIES ====================
function uid(){return 'id'+Date.now()+Math.random().toString(36).slice(2,7);}
function fmtDuration(s){const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:`${m}:${String(sec).padStart(2,'0')}`;}
function setUnit(u){appDb.unit=u;fsSavePrefs();updateUnitToggle();}
function updateUnitToggle(){document.getElementById('unit-lbs').classList.toggle('active',appDb.unit==='lbs');document.getElementById('unit-kg').classList.toggle('active',appDb.unit==='kg');}
function showToast(msg,type=''){const t=document.getElementById('toast');t.textContent=msg;t.className='show '+(type||'');setTimeout(()=>t.className='',2500);}
function confirm2(title,msg,cb,acceptLabel='Delete'){document.getElementById('confirm-title').textContent=title;document.getElementById('confirm-msg').textContent=msg;document.getElementById('confirm-accept-btn').textContent=acceptLabel;confirmCallback=cb;document.getElementById('confirm-overlay').classList.add('open');}
function confirmAccept(){document.getElementById('confirm-overlay').classList.remove('open');if(confirmCallback)confirmCallback();confirmCallback=null;}
function confirmReject(){document.getElementById('confirm-overlay').classList.remove('open');confirmCallback=null;}

document.querySelectorAll('.modal-overlay').forEach(el=>el.addEventListener('click',e=>{if(e.target===el)el.classList.remove('open');}));
