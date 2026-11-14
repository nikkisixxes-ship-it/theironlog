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
  exerciseCollections: [], // Stage 2 -- canonical Collection docs (never the reverse membership index)
};

let currentWorkout      = null;
let progReviewActiveId  = null;
let progReviewPendingId = null;
let activeTMPromptContinue = null;
let activeTMEditExIdx      = null;
let active1RMPromptContinue   = null;
let active1RMEditExIdx        = null;
let active1RMEditSource       = 'manual';
let active1RMEditCurrentE1RM  = null;
let activeWLPromptContinue    = null;
let activeWLPromptSourceTags  = {};
let activeWLEditExIdx         = null;
let activeWorkoutTimer  = null;
let activeWorkoutStart  = null;
let workoutPaused       = false;
let workoutPausedAt     = null;
let workoutPausedTotal  = 0;
let currentProgramId    = null, currentMicrocycleIdx = null, currentSessionIdx = null;
let copyWorkoutId       = null, copyFormat = 'phpbb';
let confirmCallback     = null;
let confirmRejectCallback = null;
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
// AUTH-BOUNDARY CORRECTION (legacy active-program gap) -- tracks the one
// pending setTimeout shared by openProgramFromCard/openTemplateFromActiveCard
// (both delay their own planOpenProfile(...) call by 150ms so showPage can
// finish its own transition first). See resetLegacyProgramsForAuthChange's
// own header for why this needs to be cancellable at the auth boundary.
let legacyProfileOpenTimer = null;

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
  }, 'Sign Out'); // confirm button says SIGN OUT (was inheriting confirm2's 'Delete' default); style unchanged
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
// startup-read-fix: temporary diagnostics prefix + build marker, for verifying the
// read-amplification correction after the Firestore quota resets. Remove once verified.
const DIAG = '[IRON LOG startup-read-fix]';
const STARTUP_FIX_BUILD = 'startup-read-fix-v1';

let initSession = 0;   // increments on every auth transition; guards stale listener/load callbacks from a previous user or previous init attempt from touching current state
let appReady     = false; // true once the loading screen is dismissed; gates listener-driven page rerenders during startup so the first (load-bearing) snapshot doesn't double-render

// ---- Imported sets: lazy, session-scoped, single-flight loader ----
// Not queried at startup. Loaded at most once per signed-in session, only by an
// actual consumer (HISTORY totals, Import duplicate-check, Export). Concurrent
// callers share one in-flight Promise. A failed load is never treated as "loaded
// empty" -- the pending Promise is cleared so a later retry is possible, and the
// call rejects so the requesting capability can show an error instead of quietly
// omitting data.
let importedSetsLoaded = false;
let importedSetsLoadPromise = null;

function resetImportedSetsState() {
  importedSetsLoaded = false;
  importedSetsLoadPromise = null;
  appDb.importedSets = [];
}

// AUTH-BOUNDARY CORRECTION (independent-review, account-change gap): the
// legacy active-program system (appDb.programs) and its directly-associated
// UI state/DOM were never reset on sign-out, sign-in, or an owner switch --
// unlike every canonical Program-Run surface (planRunUiResetForOwner,
// planRunTmResetForOwner, planRunStartClose, planRunLoggerFinishReset
// ForAuthChange, planRunEndResetForAuthChange -- all called from this same
// auth boundary, below). Concretely, without this function: (1) a
// signed-out owner's own programs stayed in appDb.programs and in whatever
// legacy DOM had last rendered them (the Home carousel, a Program Profile
// view, a template editor) until some unrelated later render happened to
// overwrite it -- sign-out only ever hid #app, it never cleared any of
// this; (2) a direct A->B switch never hides #app at all (unlike
// sign-out), so A's own #home-program-carousel HTML -- already painted on
// screen -- stayed visibly on screen, genuinely showing A's program
// name(s) to B, for the entire async window between this synchronous
// reset and whenever B's own sign-in boot eventually reaches its own
// renderHome() call; blanking #home-program-carousel/#home-carousel-dots
// here, synchronously, closes that window rather than leaving it to
// chance. Separately, if A had navigated to Plan and opened a Program
// Profile or template editor before the switch, #page-programs (shared by
// the legacy Profile/editor/library view and, when enabled, the canonical
// Library) kept showing A's own rendered content indefinitely, since
// nothing else re-renders that container the way renderHome() does for
// the Home page; (3) the legacy card's own "..." menu
// (openActiveProgCardMenu/openPlanProfileMenu), the generic confirm dialog
// (confirm2 -- shared by End/Restart/Delete Template and others), and the
// session/move-week modals could all stay open across the switch with
// stale, previous-owner-scoped ids and text baked into their rendered HTML
// or their tracked callback closures; (4) openProgramFromCard/
// openTemplateFromActiveCard's own delayed (150ms) planOpenProfile(...)
// call had no session guard at all and could fire AFTER a sign-out or
// switch, rendering the previous owner's own template profile into
// whichever owner is current by the time it fires.
//
// This is the new, PRIMARY auth boundary for all of that -- called
// synchronously, at the top of the real auth transition, before #app can
// become visible or any asynchronous initialization begins, exactly
// alongside the canonical resets it now sits next to. The real Firestore
// `COL_PROGRAMS.onSnapshot` listener already guarded itself correctly
// before this correction (`if (mySession !== initSession) return;`,
// PHASE A CORRECTION FINDING 3, below) -- a delayed legacy SNAPSHOT was
// never the gap; the gap was always this function's own absence.
//
// Deliberately NOT touched here: `currentWorkout`, and the legacy %TM/1RM/
// working-load prompt continuations (activeTMPromptContinue/
// active1RMPromptContinue/activeWLPromptContinue). Those belong to the
// Logger's own, already-established, intentionally-preserved-across-auth-
// changes in-progress workout -- see planRunLoggerFinishResetForAuthChange's
// own header ("An ordinary LEGACY currentWorkout (no canonicalRun) is left
// completely untouched"). This correction has no more license to destroy
// that unsaved, user-authored work than any prior round did; see this
// round's own correction report for the full disclosure of this boundary.
function resetLegacyProgramsForAuthChange() {
  appDb.programs = [];
  homeCarouselIdx = 0;
  homeCarouselProgs = [];
  homeCarouselItems = [];
  homeCarouselSelectedKey = null;
  homeCarouselSuppressClick = false;
  currentProgramId = null;
  currentMicrocycleIdx = null;
  currentSessionIdx = null;
  moveDayProgId = null;
  moveDayMi = null;
  moveDaySi = null;
  planDraft = null;
  planSnapshot = null;
  planEditorOrigin = null;
  planCurrentProgId = null;
  if (legacyProfileOpenTimer) { clearTimeout(legacyProfileOpenTimer); legacyProfileOpenTimer = null; }
  closeDropdown();
  closeModal('modal-session');
  closeModal('modal-move-week');
  closeModal('modal-program');
  confirmCallback = null;
  confirmRejectCallback = null;
  const confirmOverlayEl = document.getElementById('confirm-overlay');
  if (confirmOverlayEl) confirmOverlayEl.classList.remove('open');
  // #page-programs is shared by the legacy Profile/editor/library view and
  // (when the canonical capability is ever enabled) the canonical Library --
  // blanking it here removes any stale, owner-scoped rendered HTML from
  // either system rather than leaving it indefinitely visible if it
  // happened to be the active page at the moment of this transition. A
  // later render (renderPlanLibrary/planCanonicalLibraryRender), reached
  // the normal way by navigating to the Plan tab, repopulates it correctly
  // for whichever owner is now signed in.
  const pageProgramsEl = document.getElementById('page-programs');
  if (pageProgramsEl) pageProgramsEl.innerHTML = '';
  // CORRECTION (found by this round's own smoke-test coverage, not merely
  // asserted): unlike #page-programs, #home-program-carousel is NOT gated
  // behind navigating to a particular page -- it is part of #page-home,
  // which stays visible across a direct A->B owner switch (no intervening
  // sign-out ever hides #app in that case). Clearing appDb.programs above
  // does not, by itself, touch this already-rendered HTML; the next
  // correct repaint only happens later, asynchronously, when the new
  // owner's own sign-in boot sequence reaches its own renderHome() call
  // (after its own persistenceReady/prefs/setupListeners awaits settle).
  // Without blanking it here too, the previous owner's own program
  // name(s) could remain visibly on screen for that entire async window --
  // exactly the "briefly render the previous owner's legacy data" risk
  // this round was asked to rule out. Blanking to empty string (rather
  // than reproducing renderHomeCarousel's own "No Active Programs"
  // empty-state markup) is deliberately the smallest change: the next
  // real renderHome() -- reached the normal way, during this same
  // transition's own boot sequence -- repopulates it correctly either way.
  const carouselEl = document.getElementById('home-program-carousel');
  if (carouselEl) carouselEl.innerHTML = '';
  const carouselDotsEl = document.getElementById('home-carousel-dots');
  if (carouselDotsEl) carouselDotsEl.innerHTML = '';
}

function ensureImportedSetsLoaded(reason) {
  if (importedSetsLoaded) return Promise.resolve(appDb.importedSets);
  if (importedSetsLoadPromise) return importedSetsLoadPromise;
  const mySession = initSession;
  // `request` is captured by reference below so the settle handlers can check, by
  // identity, whether this exact request is still the one the module is tracking
  // before touching importedSetsLoadPromise. If a newer session already replaced it
  // (or cleared it) by the time this settles, this request must not clear, complete,
  // or otherwise mutate that newer state -- it only resolves/rejects for its own caller.
  const request = COL_IMPORTED_SETS.get().then(snap => {
    if (mySession !== initSession) {
      // Signed-in user changed while this load was in flight; discard rather than
      // apply one user's data to another user's session. Do not touch appDb,
      // importedSetsLoaded, or importedSetsLoadPromise -- those belong to whatever
      // session is current now.
      throw new Error('auth changed during imported-sets load');
    }
    appDb.importedSets = snap.docs.map(d => d.data());
    importedSetsLoaded = true;
    if (importedSetsLoadPromise === request) importedSetsLoadPromise = null;
    console.log(DIAG, 'imported sets loaded — reason:', reason || '(unspecified)', '| docs:', snap.docs.length, '| fromCache:', snap.metadata.fromCache);
    return appDb.importedSets;
  }).catch(err => {
    if (mySession === initSession) {
      if (importedSetsLoadPromise === request) importedSetsLoadPromise = null;
      console.error(DIAG, 'imported sets load FAILED — reason:', reason || '(unspecified)', err);
    }
    // else: obsolete request from a prior session -- reject quietly for this caller
    // only; the current session's pending/loaded state (if any) is left untouched.
    throw err;
  });
  importedSetsLoadPromise = request;
  return request;
}

auth.onAuthStateChanged(async user => {
  const mySession = ++initSession;
  // ACTIVE-WORKOUT RECOVERY: first, so a previous owner's open workout is
  // kept under that owner's own draft before anything below discards it,
  // and nothing of it stays visible to a different account.
  awDraftHandleAuthChange(user);
  // Every auth transition (sign-in, sign-out, user switch) unsubscribes all
  // previously-attached listeners immediately -- not only via the manual Sign Out
  // control -- so a stale listener can never write a previous user's data into a
  // new session.
  firestoreListeners.forEach(u => u());
  firestoreListeners = [];
  // Canonical Program/progression state is user-scoped just like the legacy
  // listeners above. Clear it on every sign-in, sign-out, and account switch
  // before any new owner's references or asynchronous work can begin.
  if (typeof planResetCanonicalUserScopedState === 'function') {
    planResetCanonicalUserScopedState();
  }
  // SLICE 1 CORRECTION (independent-review, account-change gap): the
  // canonical Program-Run UI (app-plan-run-ui.js) is user-scoped too, but
  // its own renderHome()-driven reset only ran once THIS async callback
  // eventually reached its own renderHome() call below -- well after #app
  // is made visible a few lines down, and (on sign-in) well after this
  // callback's own asynchronous init has started. In that window the
  // PREVIOUS owner's Run list or Session preview could still be sitting in
  // the DOM underneath the now-visible #app. Reset it here, synchronously,
  // before anything else in this transition proceeds -- this is now the
  // PRIMARY auth boundary for that UI (see planRunUiResetForOwner's own
  // header comment); the later renderHome() reset is kept only as a
  // defensive backstop.
  if (typeof planRunUiResetForOwner === 'function') {
    planRunUiResetForOwner(user ? user.uid : null);
  }
  // OPTIONAL PROGRESSION STARTING VALUES ROUND 6 CORRECTION ADDITION -- the
  // same auth boundary, for app-plan-run-training-max-ui.js's own
  // "Needs Attention" list/pagination/attempt-tracking state, which is
  // owner-scoped exactly the same way the Program Run list immediately
  // above already is. Reuses that same function's own signature
  // (planRunTmResetForOwner(uid)) for the identical reason.
  if (typeof planRunTmResetForOwner === 'function') {
    planRunTmResetForOwner(user ? user.uid : null);
  }
  // SLICE 3 CORRECTION (independent-review, auth-boundary gap): the Start
  // screen (app-plan-run-start-ui.js) holds owner-scoped Program details
  // and progression suggestions in its own in-memory state, but nothing
  // previously reset it on this same transition. Reuses the exact same
  // function that screen's own Cancel/Back control already calls
  // (planRunStartClose()) -- it already does exactly what this boundary
  // needs (invalidate every outstanding read/Start/status response by
  // bumping its epoch and nulling its state, and clear its own rendered
  // DOM synchronously, before the app can display another owner's
  // content), so no new function was added for this.
  if (typeof planRunStartClose === 'function') {
    planRunStartClose();
  }
  // LOGGER-FINISH SLICE ADDITION -- the same auth boundary, for
  // app-plan-run-logger-ui.js's own pending/uncertain Finish-attempt
  // tracking. Deliberately does NOT touch `currentWorkout` itself -- see
  // planRunLoggerFinishResetForAuthChange's own header for why.
  if (typeof planRunLoggerFinishResetForAuthChange === 'function') {
    planRunLoggerFinishResetForAuthChange();
  }
  // END RUN SLICE ADDITION -- the same auth boundary, for
  // app-plan-run-end-ui.js's own per-Run End-attempt tracking. An End
  // attempt has no local, editable content to preserve across an owner
  // change (unlike a Finish attempt's own currentWorkout) -- there is
  // nothing to lose here, only stale tracking to discard so a later
  // response for the previous owner can never be applied to the next one.
  if (typeof planRunEndResetForAuthChange === 'function') {
    planRunEndResetForAuthChange();
  }
  // LEGACY AUTH-BOUNDARY CORRECTION -- same auth boundary as every canonical
  // Program-Run reset above. app-core.js and app-plan.js are always-present
  // core files (not an optional slice), so this call is unguarded, matching
  // how appDb/homeCarouselIdx etc. are already referenced unguarded elsewhere
  // in this file. See resetLegacyProgramsForAuthChange's own header for the
  // full list of gaps this closes. currentWorkout and the TM/1RM/WL prompt
  // continuations are deliberately NOT touched by this call -- see that
  // function's header for why.
  resetLegacyProgramsForAuthChange();
  appReady = false;
  resetImportedSetsState();
  // Reset preference defaults on every transition too, before the next user's
  // meta/prefs read -- otherwise a user with no prefs doc (or a failed read) would
  // silently inherit the previous account's in-memory unit/formula.
  appDb.unit = 'lbs';
  appDb.e1rmFormula = 'epley';

  if (!user) {
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    return;
  }
  document.getElementById('loading-screen').style.display = 'flex';
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  initCollections(user.uid);
  try {
    const persistedOk = await persistenceReady;
    if (mySession !== initSession) return; // a newer session has already started
    console.log(DIAG, STARTUP_FIX_BUILD, '| persistence:', persistedOk ? 'multi-tab enabled' : 'unavailable (continuing without it)');

    const mSnap = await COL_META.doc('prefs').get();
    if (mySession !== initSession) return;
    if (mSnap.exists) { appDb.unit = mSnap.data().unit || 'lbs'; appDb.e1rmFormula = mSnap.data().e1rmFormula || 'epley'; }
    console.log(DIAG, 'prefs doc exists:', mSnap.exists, '| fromCache:', mSnap.metadata.fromCache);

    await setupListeners(mySession);
    if (mySession !== initSession) return;

    appReady = true;
    document.getElementById('loading-screen').style.display = 'none';
    console.log(DIAG, 'startup complete — imported sets NOT loaded (deferred until HISTORY/Import/Export needs them)');
    renderHome();
    // ACTIVE-WORKOUT RECOVERY: only now -- signed in, startup finished -- is
    // this owner's draft looked for (an auth delay never looks like "none").
    awDraftOfferRecovery(user.uid);

    // SLICE 5B correction round 1 (finding 6) -- the ONLY entry point for
    // the new manual progression starting-value/correction UI
    // (app-plan.js, planProgressionManualDevBoot). Unlike the canonical PLAN
    // editor, this progression-state utility remains deliberately hidden
    // from normal navigation and gated on
    // two URL query parameters nothing else in the app ever sets or reads,
    // checked once, here, only after full boot and real authentication have
    // both already completed. A normal user who never adds these exact
    // parameters to the URL never triggers it. While either the canonical
    // read or the progression capability remains disabled (both hardcoded
    // false in production), this can wire itself up but cannot perform any
    // database I/O -- corrected round 3: the two disabled gates fail in two
    // different shapes, not one uniform return value. The progression
    // capability's real functions THROW a disabled error synchronously; the
    // canonical reader's disabled path REJECTS with its own, differently-
    // typed disabled error. planProgressionManualDevBoot (app-plan.js)
    // catches both, independently, and resolves this call to
    // {outcome:'disabled'} either way, after visibly mounting the disabled
    // message into the real manual-progression container -- it never
    // reaches this .catch() below for either disabled case.
    if (typeof planProgressionManualDevBoot === 'function') {
      const _progParams = new URLSearchParams(location.search);
      const _progTemplateId = _progParams.get('progressionTemplateId');
      const _progAssignmentId = _progParams.get('progressionAssignmentId');
      if (_progParams.get(typeof PLAN_PROGRESSION_MANUAL_DEV_QUERY_PARAM === 'string' ? PLAN_PROGRESSION_MANUAL_DEV_QUERY_PARAM : 'slice5bProgressionManual') === '1'
          && _progTemplateId && _progAssignmentId) {
        planProgressionManualDevBoot(_progTemplateId, _progAssignmentId).catch(err => console.error(DIAG, 'planProgressionManualDevBoot failed:', err));
      }
    }
  } catch (err) {
    if (mySession !== initSession) return;
    console.error(DIAG, 'initialization failed:', err);
    firestoreListeners.forEach(u => u());
    firestoreListeners = [];
    document.getElementById('loading-screen').innerHTML = '<div style="font-family:var(--font-display);font-size:32px;font-weight:900;color:var(--red)">LOAD ERROR</div><div style="margin-top:12px;color:var(--text2);font-size:15px;text-align:center;max-width:280px;line-height:1.5">Could not connect to database.<br>Check your internet connection.</div><button onclick="location.reload()" style="margin-top:20px;background:var(--accent);color:#fff;border:none;padding:12px 28px;border-radius:8px;font-family:var(--font-display);font-size:17px;font-weight:700;cursor:pointer;letter-spacing:0.05em">RETRY</button>';
  }
});

// Attaches the seven live-dataset listeners and resolves once every one of them
// has delivered its first snapshot -- that first snapshot IS the initial load for
// each dataset; there is no separate startup .get() for any of them. Rejects (so
// the caller shows the existing load-error screen) if any listener's very first
// snapshot fails. A later error, for a dataset that already loaded successfully
// once, is logged but never discards the already-loaded data.
function setupListeners(mySession) {
  const datasetKeys = ['workouts','programs','customExercises','exerciseCollections','exerciseNotes','exerciseVideos','exOverrides'];
  const settled  = {};
  const resolvers = {};
  const firstSnapshotPromises = datasetKeys.map(key => new Promise((resolve, reject) => { resolvers[key] = { resolve, reject }; }));

  function firstSuccess(key, count, fromCache) {
    console.log(DIAG, 'first snapshot —', key, '| docs:', count, '| fromCache:', fromCache);
    if (!settled[key]) { settled[key] = true; resolvers[key].resolve(); }
  }
  function firstFailure(key, err) {
    console.error(DIAG, 'listener FAILED before first snapshot —', key, err);
    if (!settled[key]) { settled[key] = true; resolvers[key].reject(err); }
  }
  function laterFailure(key, err) {
    console.error(DIAG, 'listener error (after initial load; existing data kept) —', key, err);
  }

  firestoreListeners.push(COL_WORKOUTS.onSnapshot(snap => {
    if (mySession !== initSession) return;
    appDb.workouts = snap.docs.map(d => d.data()).sort((a,b) => b.date - a.date);
    const isFirst = !settled.workouts;
    if (isFirst) firstSuccess('workouts', snap.docs.length, snap.metadata.fromCache);
    if (appReady) {
      const pg = activePage();
      if (pg === 'page-home') renderHome();
      // Only rerender HISTORY here if imported sets already finished loading --
      // otherwise this would blow away the loading spinner or the error/Retry UI
      // shown by loadHistoryThenRender() with incomplete totals. It must never
      // itself kick off an imported-set query; it just waits for whichever
      // History entry point (nav, View All, Search, Browse by Date) or a
      // deliberate Retry click to finish that load.
      if (pg === 'page-history' && importedSetsLoaded) renderHistory();
    }
  }, err => { if (mySession !== initSession) return; settled.workouts ? laterFailure('workouts', err) : firstFailure('workouts', err); }));

  // PHASE A CORRECTION, FINDING 3 -- legacy `programs` snapshot listener.
  firestoreListeners.push(COL_PROGRAMS.onSnapshot(snap => {
    if (mySession !== initSession) return;
    appDb.programs = snap.docs.map(d => d.data());
    const isFirst = !settled.programs;
    if (isFirst) firstSuccess('programs', snap.docs.length, snap.metadata.fromCache);
    // This legacy in-memory update (above) still runs unconditionally --
    // other historical behavior may depend on appDb.programs staying
    // current. But the legacy renderPlanLibrary() render call must not
    // fire while the canonical Program library/editor (or its boot-time
    // recovery-check screen) owns #page-programs, since that render blows
    // away the canonical DOM out from under it. Gated on the one explicit
    // canonical-ownership predicate (app-plan.js) rather than a scattered
    // DOM guess.
    if (appReady && activePage() === 'page-programs' && !planCanonicalOwnsPageProgramsView()) renderPlanLibrary();
  }, err => { if (mySession !== initSession) return; settled.programs ? laterFailure('programs', err) : firstFailure('programs', err); }));
  // END PHASE A CORRECTION, FINDING 3

  firestoreListeners.push(COL_CUSTOM_EX.onSnapshot(snap => {
    if (mySession !== initSession) return;
    // appDb.customExercises always updates. Re-rendering #page-db is isolated to the
    // two safe, read-only Library routes -- while an editable Collection route
    // (newCollection/editCollection/memberSelection/consolidation/chooseDisplayExercise)
    // is open, a remote exercise-name change must not disrupt its DOM, input focus,
    // or in-progress draft. A later intentional render resolves names from the
    // now-current appDb.
    appDb.customExercises = snap.docs.map(d => d.data());
    const isFirst = !settled.customExercises;
    if (isFirst) firstSuccess('customExercises', snap.docs.length, snap.metadata.fromCache);
    if (appReady && activePage() === 'page-db' && (libraryRoute.view === 'browser' || libraryRoute.view === 'collectionDetail')) {
      renderLibraryRoute();
    }
  }, err => { if (mySession !== initSession) return; settled.customExercises ? laterFailure('customExercises', err) : firstFailure('customExercises', err); }));

  firestoreListeners.push(COL_EX_COLLECTIONS.onSnapshot(snap => {
    if (mySession !== initSession) return;
    // appDb.exerciseCollections always updates, unconditionally. The re-render
    // decision (safe surfaces only -- never an open editable Collection route) is
    // owned by app-collections.js, which already tracks libraryRoute/libBrowseTarget/
    // libCollectionDrill and the modal-open state (Section 9). Called on every
    // snapshot including the first, exactly as before this repair.
    appDb.exerciseCollections = snap.docs.map(d => {
      const data = d.data();
      return (data && data.id === d.id) ? data : Object.assign({}, data, { id: d.id });
    });
    const isFirst = !settled.exerciseCollections;
    collHandleCollectionsSnapshotUpdate();
    if (isFirst) firstSuccess('exerciseCollections', snap.docs.length, snap.metadata.fromCache);
  }, err => { if (mySession !== initSession) return; settled.exerciseCollections ? laterFailure('exerciseCollections', err) : firstFailure('exerciseCollections', err); }));

  firestoreListeners.push(COL_EX_NOTES.onSnapshot(snap => {
    if (mySession !== initSession) return;
    appDb.exerciseNotes = {};
    snap.docs.forEach(d => { appDb.exerciseNotes[d.id] = d.data().note || ''; });
    const isFirst = !settled.exerciseNotes;
    if (isFirst) firstSuccess('exerciseNotes', snap.docs.length, snap.metadata.fromCache);
  }, err => { if (mySession !== initSession) return; settled.exerciseNotes ? laterFailure('exerciseNotes', err) : firstFailure('exerciseNotes', err); }));

  firestoreListeners.push(COL_EX_VIDEOS.onSnapshot(snap => {
    if (mySession !== initSession) return;
    appDb.exerciseVideos = {};
    snap.docs.forEach(d => { appDb.exerciseVideos[d.id] = d.data().videos || []; });
    const isFirst = !settled.exerciseVideos;
    if (isFirst) firstSuccess('exerciseVideos', snap.docs.length, snap.metadata.fromCache);
  }, err => { if (mySession !== initSession) return; settled.exerciseVideos ? laterFailure('exerciseVideos', err) : firstFailure('exerciseVideos', err); }));

  firestoreListeners.push(COL_EX_OVERRIDES.onSnapshot(snap => {
    if (mySession !== initSession) return;
    appDb.exOverrides = {};
    snap.docs.forEach(d => { appDb.exOverrides[d.id] = d.data(); });
    const isFirst = !settled.exOverrides;
    if (isFirst) firstSuccess('exOverrides', snap.docs.length, snap.metadata.fromCache);
  }, err => { if (mySession !== initSession) return; settled.exOverrides ? laterFailure('exOverrides', err) : firstFailure('exOverrides', err); }));

  return Promise.all(firstSnapshotPromises);
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
// Unsaved-Collection-change guard lives at the very top of showPage(), since every
// navigation path in the app -- the three bottom-nav buttons (inline onclick in
// index.html) and every other internal call to showPage(...) -- already funnels
// through this one function. It applies to any non-browser Collection route
// (isEditableLibraryRoute/isCollectionDraftDirty, both from app-collections.js):
// a dirty editable route is guarded with a confirmation; a clean editable route or
// a read-only route (collectionDetail) ends the Collection flow silently. Internal
// movement between Collection screens (collExitEditor, collBackFromDetail, etc.)
// never calls showPage -- it calls renderLibraryRoute() directly -- so none of this
// fires for in-flow navigation, only for actual app-level page switches. This never
// touches PLAN's own (separately unguarded) editor.
function showPage(id) {
  if (libraryRoute.view !== 'browser') {
    if (isEditableLibraryRoute(libraryRoute) && isCollectionDraftDirty()) {
      confirm2(
        'Discard Collection Changes?',
        'Your unsaved changes to this Collection will be lost.',
        () => {
          discardCollectionDraft();
          libraryRoute = { view: 'browser' };
          collActiveId = null;
          collReturnTo = null;
          showPage(id); // re-entrant call is safe: libraryRoute is now 'browser'
        },
        'Discard'
      );
      return;
    }
    // Either a clean editable draft, or a read-only Collection route
    // (collectionDetail) with no draft to lose -- either way, app-level
    // navigation away from Library must end the Collection flow so a later
    // return to Library opens the browser, never a stale Collection screen.
    if (isEditableLibraryRoute(libraryRoute)) discardCollectionDraft();
    libraryRoute = { view: 'browser' };
    collActiveId = null;
    collReturnTo = null;
  }
  // SLICE 3 CORRECTION (independent-review, navigation-boundary gap):
  // ordinary navigation away from the Start flow (any real destination
  // other than page-run-start itself) must invalidate its own pending
  // reads/Start/status responses and clear its screen state -- otherwise a
  // late response (e.g. a slow fsPlanRunStart that finally resolves
  // 'committed' after the person has already navigated to PLAN/Library)
  // could redirect them back to TRAIN or render a success message on a
  // screen they already left. planRunStartClose() is idempotent (a no-op
  // when no Start attempt is open), so this call is always safe here,
  // including during the flow's OWN successful Start -> TRAIN handoff --
  // planRunStartApplyStartOutcome/planRunStartGoToActiveRun already call
  // planRunStartClose() themselves before ever navigating here, so by the
  // time that same navigation reaches this line there is nothing left to
  // close. This line runs only once actual navigation is committed (after
  // the Library-dirty-draft confirmation gate above, which can otherwise
  // return without navigating at all), so declining that confirmation
  // never closes a Start screen the person never actually left.
  if (id !== 'page-run-start' && typeof planRunStartClose === 'function') planRunStartClose();
  // LIFECYCLE-SAFETY CORRECTION (logger-finish slice, issue 2) -- the prior
  // planRunLoggerFinishInvalidateForNav() call here bumped an epoch that
  // planRunLoggerFinishApplyOutcome/the uncertain path never actually
  // consulted, so it did nothing real. Navigating away from #page-log no
  // longer needs any call here at all: a pending/uncertain Finish attempt's
  // own currency is now checked directly, at the moment its response
  // arrives, against the CURRENT currentWorkout/owner/operationId
  // (app-plan-run-logger-ui.js's planRunLoggerFinishResultStillCurrent) --
  // not against whether #page-log happened to be visible back when the
  // attempt was started. Whether #page-log is visible RIGHT NOW (checked
  // live, at resolution time, by planRunLoggerFinishIsPageVisible) governs
  // only whether a resulting success shows its toast/redirect on this
  // navigation, never whether the underlying save is applied. See that
  // file's own header for the full design.
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === id));
  const activeBar = document.getElementById('active-bar');
  if (activeBar) activeBar.style.display = id === 'page-log' ? 'none' : '';
  if (id === 'page-home')     renderHome();
  if (id === 'page-history')  loadHistoryThenRender(renderHistory);
  if (id === 'page-db')       renderLibraryRoute();
  // LOGGER-FINISH SLICE ADDITION -- re-renders any surviving canonical
  // Finish status (pending/uncertain/conflict/...) whenever #page-log
  // becomes the active page, covering every entry path uniformly (a fresh
  // planRunLoggerLaunch, goToActiveWorkout() resuming an in-progress
  // canonical Session, or any other existing navigation into page-log). A
  // null/absent Finish state (the ordinary case) renders nothing, so this
  // is a no-op for every non-Program-Run workout.
  if (id === 'page-log' && typeof planRunLoggerFinishRender === 'function') planRunLoggerFinishRender();
  // Canonical PLAN adoption: the regular PLAN destination now owns the
  // canonical editor. Legacy Program records remain untouched in Firestore,
  // but the primary navigation no longer routes into their editor/library.
  // Canonical PLAN library correction (Phase A requirement 2): normal PLAN
  // navigation now opens the discoverable canonical Program library FIRST
  // (planOpenCanonicalLibraryFromPlanNavigation), not the single-Program
  // editor directly -- planOpenCanonicalEditorFromPlanNavigation itself is
  // left defined and unused from this call site (still reachable directly
  // by name, e.g. from a test), per this round's decision not to remove it.
  if (id === 'page-programs') planOpenCanonicalLibraryFromPlanNavigation();
}

function showHistoryPage() {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-history').classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  loadHistoryThenRender(renderHistory);
}

// ==================== HOME ====================
let homeCarouselIdx = 0;
let homeCarouselProgs = [];
let homeCarouselStartX = 0;
let homeCarouselDragging = false;
// TRAIN ACTIVE PROGRAMS CAROUSEL INTEGRATION -- one carousel for BOTH kinds
// of active program: canonical Program Runs (cards rendered by
// app-plan-run-ui.js) first, in the order the Run list returned them, then
// legacy active Programs, in their existing order. Every slide carries a
// TYPED identity -- 'run:<planRunId>' or 'legacy:<programId>' -- and nothing
// is ever merged or de-duplicated by name, dates, order, contents or
// similarity. The selected card is remembered by that identity (not by
// position), so a card keeps its place when canonical Runs reload, when
// "Load more" appends Runs ahead of the legacy cards, or when a Finish
// advances a Run. Only a swipe or a dot tap changes the selection.
let homeCarouselItems = [];          // [{ key, kind: 'run'|'legacy', run|prog }]
let homeCarouselSelectedKey = null;  // typed identity of the card the person chose
let homeCarouselSuppressClick = false;
let homeCarouselSuppressTimer = null;

function getActivePrograms() {
  return appDb.programs.filter(p => p.recordType === 'activeProgram' && p.status === 'active');
}

function renderHome() {
  renderHomeCarousel();
  // SLICE 1 ADDITION -- canonical Program Runs. Since the carousel
  // integration this starts (or refreshes) the canonical Run list; its
  // cards are shown INSIDE the Active Programs carousel above (see
  // renderHomeCarousel), never in a separate section.
  if (typeof planRunUiRenderHomeSection === 'function') planRunUiRenderHomeSection();
  // VISUAL-ALIGNMENT CORRECTION: the permanent "Needs Attention (Preview)"
  // section is removed from TRAIN (and TRAIN no longer runs its owner-wide
  // discovery query). A Training Max left blank at Run Start is asked for
  // when the Session that needs it is started or resumed
  // (app-plan-run-training-max-ui.js planRunTmGateSession).
  const sorted = [...appDb.workouts].slice(0, 3);
  document.getElementById('home-recent').innerHTML = sorted.length
    ? sorted.map(w => workoutHistoryCard(w, true)).join('')
    : '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 6h18M3 12h18M3 18h18"/></svg><h3>No workouts yet</h3><p>Tap New Workout to get started</p></div>';
}

// Dots for slide i of n: one per loaded card (never for "Load more"), each a
// tap target that moves the carousel to that card. Shown only for 2+ cards.
function homeCarouselDotsHtml(i, n) {
  if (n < 2) return '';
  let html = '';
  for (let di = 0; di < n; di++) {
    html += `<div class="home-carousel-dot ${di === i ? 'active' : ''}" data-carousel-dot="${di}" role="button" aria-label="Show active program ${di + 1} of ${n}"></div>`;
  }
  return html;
}

// VISUAL-ALIGNMENT CORRECTION: the ONE Active Programs card template, used by
// BOTH legacy active-Program cards (below) and canonical Program Run cards
// (app-plan-run-ui.js planRunUiRenderRunCard), so the two can never drift
// apart. Every visual property lives in styles.css (.prog-carousel-card,
// .prog-card-head, .prog-card-session, .prog-card-name, .prog-card-menu-btn,
// .prog-card-progress-label, .prog-card-bar-*, .prog-card-dots). Callers pass
// already-safe HTML strings / attribute strings:
//   cardAttrs    -- extra attributes on the card element (identity, action)
//   sessionLabel -- the next Session ("Week 1 • Day A")
//   name         -- the Program's name
//   menuButton   -- the ••• button (its own action attributes)
//   progressPct  -- 0..100; progressLabel -- text under the name
//   dotsHtml     -- homeCarouselDotsHtml(i, n)
//   extraHtml    -- content-specific controls that must stay visible (End
//                   Run recovery states); empty for every ordinary card
function homeCarouselCardHtml(c) {
  return `<div class="prog-carousel-card${c.extraClass ? ' ' + c.extraClass : ''}" ${c.cardAttrs}>
      <div class="prog-card-head">
        <div class="prog-card-head-text">
          <div class="prog-card-session">${c.sessionLabel}</div>
          <div class="prog-card-name">${c.name}</div>
        </div>
        ${c.menuButton}
      </div>
      <div class="prog-card-progress-label">${c.progressLabel}</div>
      <div class="prog-card-bar-row">
        <div class="prog-card-bar-track"><div class="prog-card-bar-fill" style="width:${c.progressPct}%"></div></div>
        <div class="prog-card-dots">${c.dotsHtml}</div>
      </div>${c.extraHtml || ''}
    </div>`;
}

function homeCarouselLegacyCardHtml(prog, i, n) {
  const next = planGetFirstUnfinishedSession(prog);
  const totalSessions = planCountActiveSessions(prog);
  const completed = (prog.completedSessionKeys || []).length;
  const pct = totalSessions > 0 ? Math.round((completed / totalSessions) * 100) : 0;
  const mc = prog.microcycles[next.microcycleIdx];
  const sess = mc.sessions[next.sessionIdx];
  const mcName = mc.name || `Micro ${next.microcycleIdx + 1}`;
  const sessName = sess.name || `Session ${next.sessionIdx + 1}`;
  return homeCarouselCardHtml({
    cardAttrs: `data-testid="legacy-carousel-card" data-carousel-key="${escapeHtml('legacy:' + prog.id)}" onclick="startWorkoutFromActiveCard('${prog.id}')"`,
    sessionLabel: `${mcName} • ${sessName}`,
    name: prog.name,
    menuButton: `<button class="prog-card-menu-btn" onclick="openActiveProgCardMenu(event,'${prog.id}')" title="Program options">•••</button>`,
    progressPct: pct,
    progressLabel: `${pct}% Complete`,
    dotsHtml: homeCarouselDotsHtml(i, n)
  });
}

function renderHomeCarousel() {
  homeCarouselProgs = getActivePrograms().filter(prog => !!planGetFirstUnfinishedSession(prog));
  const runs = (typeof planRunUiCarouselRuns === 'function') ? planRunUiCarouselRuns() : [];
  homeCarouselItems = runs.map(run => ({ key: 'run:' + run.planRunId, kind: 'run', run }))
    .concat(homeCarouselProgs.map(prog => ({ key: 'legacy:' + prog.id, kind: 'legacy', prog })));
  const carousel = document.getElementById('home-program-carousel');
  const dotsEl   = document.getElementById('home-carousel-dots');
  if (typeof planRunUiRenderCarouselStatus === 'function') planRunUiRenderCarouselStatus();
  if (!carousel) return;
  const n = homeCarouselItems.length;
  const keyIdx = homeCarouselSelectedKey ? homeCarouselItems.findIndex(it => it.key === homeCarouselSelectedKey) : -1;
  homeCarouselIdx = keyIdx !== -1 ? keyIdx : Math.max(0, Math.min(homeCarouselIdx, n - 1));
  if (!n) {
    // "No Active Programs" only once BOTH sources are known to be empty --
    // never while canonical Runs are still loading or failed to load (the
    // status line under the carousel says which, with Retry).
    const canonicalSettled = (typeof planRunUiCarouselSettled === 'function') ? planRunUiCarouselSettled() : true;
    carousel.innerHTML = canonicalSettled ? `<div class="prog-card-empty" onclick="showPage('page-programs')">
      <div class="prog-card-empty-label">No Active Programs</div>
      <div class="prog-card-empty-sub">Go to Plan to create and start a program</div>
    </div>` : '';
    if (dotsEl) dotsEl.innerHTML = '';
    updateCarouselPosition(false);
    return;
  }
  carousel.innerHTML = homeCarouselItems.map((it, i) => it.kind === 'run'
    ? planRunUiRenderRunCard(it.run, homeCarouselDotsHtml(i, n))
    : homeCarouselLegacyCardHtml(it.prog, i, n)).join('');
  if (dotsEl) dotsEl.innerHTML = '';
  updateCarouselPosition(false);
  initCarouselSwipe();
}

function updateCarouselPosition(animate) {
  const carousel = document.getElementById('home-program-carousel');
  if (!carousel) return;
  carousel.style.transition = animate ? 'transform 0.3s ease' : 'none';
  carousel.style.transform  = `translateX(-${homeCarouselIdx * 100}%)`;
  const n = homeCarouselItems.length;
  document.querySelectorAll('.home-carousel-dot').forEach((d, i) => {
    d.classList.toggle('active', n > 0 && (i % n) === homeCarouselIdx);
  });
}

function goToCarouselSlide(i) {
  if (!homeCarouselItems.length) return;
  homeCarouselIdx = Math.max(0, Math.min(i, homeCarouselItems.length - 1));
  homeCarouselSelectedKey = homeCarouselItems[homeCarouselIdx].key;
  updateCarouselPosition(true);
}

// Wired ONCE per page load (the wrap element is static markup; only its
// contents are re-rendered), so repeated renders never add handlers.
function initCarouselSwipe() {
  const wrap = document.getElementById('home-program-carousel-wrap');
  if (!wrap || wrap._swipeInit) return;
  wrap._swipeInit = true;
  // A new touch is a new gesture: any click-suppression left over from an
  // earlier swipe (one whose click the browser never sent) is dropped here,
  // so a real tap right after a swipe always works.
  wrap.addEventListener('touchstart', e => { homeCarouselStartX = e.touches[0].clientX; homeCarouselDragging = true; homeCarouselSuppressClick = false; }, { passive: true });
  wrap.addEventListener('touchend', e => {
    if (!homeCarouselDragging) return;
    homeCarouselDragging = false;
    const diff = homeCarouselStartX - e.changedTouches[0].clientX;
    // A horizontal drag is a swipe, never a tap: the click the browser may
    // still fire at the end of it is swallowed below, so a swipe that starts
    // on a button (Start Session, •••, a legacy card) never triggers it.
    if (Math.abs(diff) > 10) {
      homeCarouselSuppressClick = true;
      clearTimeout(homeCarouselSuppressTimer);
      homeCarouselSuppressTimer = setTimeout(() => { homeCarouselSuppressClick = false; }, 700);
    }
    if (Math.abs(diff) > 40) {
      if (diff > 0 && homeCarouselIdx < homeCarouselItems.length - 1) goToCarouselSlide(homeCarouselIdx + 1);
      else if (diff < 0 && homeCarouselIdx > 0) goToCarouselSlide(homeCarouselIdx - 1);
      else updateCarouselPosition(true);
    }
  }, { passive: true });
  // Capture phase: runs before any card's own handler. Swallows the click
  // that ends a swipe, and handles dot taps without letting them reach the
  // card underneath (a legacy card's whole surface starts a workout).
  wrap.addEventListener('click', e => {
    if (homeCarouselSuppressClick) {
      homeCarouselSuppressClick = false;
      e.stopPropagation(); e.preventDefault();
      return;
    }
    const dot = e.target && e.target.closest ? e.target.closest('[data-carousel-dot]') : null;
    if (dot) {
      e.stopPropagation(); e.preventDefault();
      goToCarouselSlide(Number(dot.getAttribute('data-carousel-dot')));
    }
  }, true);
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
  legacyProfileOpenTimer = setTimeout(() => { legacyProfileOpenTimer = null; if (typeof planOpenProfile === 'function') planOpenProfile(progId); }, 150);
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
    { label: 'Choose Session', icon: '☰', action: `openChooseSessionModal('${activeId}')` },
    { label: 'Open Template', icon: '→', action: `openTemplateFromActiveCard('${activeId}')` },
    { divider: true },
    { label: 'End Program', icon: '✕', action: `endActiveProgram('${activeId}')`, danger: true },
  ];
  showDropdown(e.currentTarget, items);
}

function openTemplateFromActiveCard(activeId) {
  const active = appDb.programs.find(p => p.id === activeId); if (!active || !active.templateId) return;
  showPage('page-programs');
  const templateId = active.templateId;
  legacyProfileOpenTimer = setTimeout(() => { legacyProfileOpenTimer = null; if (typeof planOpenProfile === 'function') planOpenProfile(templateId); }, 150);
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
        html += `<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;color:var(--text3);font-family:var(--font-display);font-size:15px;font-weight:700;text-transform:uppercase"><span style="color:var(--green)">✓</span> ${escapeHtml(name)}</div>`;
      } else {
        html += `<div onclick="chooseSessionAndStart('${activeId}',${mi},${si})" style="display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:pointer;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:6px;font-family:var(--font-display);font-size:15px;font-weight:700;text-transform:uppercase;color:var(--text)"><span style="color:var(--text3)">○</span> ${escapeHtml(name)}</div>`;
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
  const missingTM = getExercisesNeedingActiveTM(active, sess);
  const proceedAfterTM = () => {
    const missing1RM = getExercisesNeedingActive1RM(active, sess);
    const proceedAfter1RM = () => {
      const missingWL = getExercisesNeedingWorkingLoad(active, sess);
      if (missingWL.length) {
        showActiveWorkingLoadPrompt(activeId, missingWL, () => finalizeStartActiveWorkout(activeId, mi, si));
      } else {
        finalizeStartActiveWorkout(activeId, mi, si);
      }
    };
    if (missing1RM.length) {
      showActive1RMPrompt(activeId, missing1RM, proceedAfter1RM);
    } else {
      proceedAfter1RM();
    }
  };
  if (missingTM.length) {
    showActiveTMPrompt(activeId, missingTM, proceedAfterTM);
  } else {
    proceedAfterTM();
  }
}

function finalizeStartActiveWorkout(activeId, mi, si) {
  const active = appDb.programs.find(p => p.id === activeId); if (!active) return;
  const mc = active.microcycles[mi]; if (!mc) return;
  const sess = mc.sessions[si]; if (!sess) return;
  const mcName = mc.name || `Micro ${mi + 1}`;
  const sessName = sess.name || `Session ${si + 1}`;
  const name = `${mcName} · ${sessName}`;

  // STALE-TIMER / OWNERSHIP-TRANSITION DEFENSE (this round, Round 8):
  // audited this function as a real ownership-transition site -- unlike
  // planRunLoggerLaunch, nothing here previously refused to overwrite an
  // already-open currentWorkout, so a pending debounce timer from
  // whatever workout was open before this call could otherwise go on to
  // mutate the NEW workout assigned just below if it happened to reuse the
  // same exIdx/setIdx indices. Cleared here, before the replacement.
  if (awDraftBlocksOpeningWorkout()) return;
  clearAllPRDebounceTimers();
  currentWorkout = {
    id: uid(), name, date: Date.now(), exercises: [], rpeEnabled: false, duration: 0, bodyweight: null,
    programId: null, microcycleIdx: null, sessionIdx: null,
    activeProgramId: activeId, activeMicrocycleIdx: mi, activeSessionIdx: si
  };
  currentWorkout.exercises = (sess.exercises || []).map(ex => ({
    exerciseId: ex.exerciseId,
    sets: (ex.sets && ex.sets.length ? ex.sets : [{}]).map(s => planSetToLoggerSet(s, ex.exerciseId, active, ex.progression)),
    perfVideos: []
  }));

  document.getElementById('workout-exercises').innerHTML = '';
  const nameDisplay = document.getElementById('log-session-name-display');
  if (nameDisplay) nameDisplay.textContent = (name || 'NEW WORKOUT').toUpperCase();
  renderWorkoutExercises(); showPage('page-log'); startWorkoutTimer(); awDraftBeginForCurrentWorkout();
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

// Shared by %TM and %1RM resolution — nearest 5 lb / 2.5 kg.
function roundPercentageLoad(val) {
  const inc = appDb.unit === 'kg' ? 2.5 : 5;
  return Math.round(val / inc) * inc;
}
function roundToTMIncrement(val) {
  return roundPercentageLoad(val);
}

function resolvePercentTMWeight(percent, tmValue) {
  return roundPercentageLoad((percent / 100) * tmValue);
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
      if (s.autoType === 'percentTM' && s.autoFilled && !s.completed && s.targetData && s.targetData.loadType === 'percentTM') {
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

// ==================== ACTIVE-INSTANCE 1RM (Build 6) ====================
// One-rep-max values live on the active program instance only — separate storage
// from active.trainingMaxes, never on the Plan template, never inherited by a new
// active instance started later from the same template.

function getActiveOneRepMax(active, exerciseId) {
  if (!active || !active.oneRepMaxes) return null;
  const orm = active.oneRepMaxes[exerciseId];
  const val = orm ? parseFloat(orm.value) : NaN;
  return !isNaN(val) ? val : null;
}

function setActiveOneRepMax(active, exerciseId, value, source) {
  if (!active) return;
  if (!active.oneRepMaxes) active.oneRepMaxes = {};
  active.oneRepMaxes[exerciseId] = { value, unit: appDb.unit, source: source || 'manual', updatedAt: Date.now() };
  active.updatedAt = Date.now();
  fsSaveProgram(active);
}

function resolvePercent1RMWeight(percent, oneRepMax) {
  return roundPercentageLoad((percent / 100) * oneRepMax);
}

// Scans a session for %1RM exercises that don't yet have a stored active 1RM.
function getExercisesNeedingActive1RM(active, session) {
  const seen = new Set();
  const needing = [];
  (session.exercises || []).forEach(ex => {
    if (seen.has(ex.exerciseId)) return;
    const hasPercent1RM = (ex.sets || []).some(s => s.loadType === 'percent1RM');
    if (!hasPercent1RM) return;
    seen.add(ex.exerciseId);
    if (getActiveOneRepMax(active, ex.exerciseId) != null) return;
    needing.push({ exerciseId: ex.exerciseId, exData: getExercise(ex.exerciseId) });
  });
  return needing;
}

// Whether the CURRENT logger exercise (by index) has a %1RM set in the active
// instance's prescription — used to show the "Set / Edit 1RM" menu item.
function hasActive1RMTarget(exIdx) {
  if (!currentWorkout?.activeProgramId) return false;
  const active = appDb.programs.find(p => p.id === currentWorkout.activeProgramId); if (!active) return false;
  const mc = active.microcycles[currentWorkout.activeMicrocycleIdx];
  const session = mc && mc.sessions[currentWorkout.activeSessionIdx];
  if (!session) return false;
  const ex = currentWorkout.exercises[exIdx];
  const sessEx = session.exercises.find(e => e.exerciseId === ex.exerciseId); if (!sessEx?.sets) return false;
  return sessEx.sets.some(s => s.loadType === 'percent1RM');
}

// Tracks which prompt rows currently hold an E1RM-sourced value, so Save can
// record source:'e1rm' vs 'manual'. Typing over the field clears the tag.
let active1RMPromptSourceTags = {};

function showActive1RMPrompt(activeId, missingExercises, continueCallback) {
  active1RMPromptContinue = continueCallback;
  active1RMPromptSourceTags = {};
  document.getElementById('modal-active-1rm-prompt').dataset.activeId = activeId;
  document.getElementById('active-1rm-prompt-body').innerHTML = missingExercises.map(m => {
    const e1rm = getBest1RM(m.exerciseId, null);
    const e1rmLine = e1rm > 0
      ? `<div class="tm-display">Current E1RM: ${Math.round(e1rm)} ${appDb.unit}</div>`
      : `<div class="tm-display" style="color:var(--text3)">No estimated 1RM available</div>`;
    const useBtn = e1rm > 0 ? `<button class="tm-use-e1rm" onclick="useE1RMForPrompt('${m.exerciseId}',${Math.round(e1rm)})">Use E1RM</button>` : '';
    return `
    <div class="tm-ex-block" id="orm-block-${m.exerciseId}">
      <div class="tm-ex-name">${m.exData ? escapeHtml(m.exData.name) : m.exerciseId}</div>
      ${e1rmLine}
      <div class="tm-input-row">
        <input type="number" id="orm-input-${m.exerciseId}" placeholder="1RM Value (${appDb.unit})" step="2.5" oninput="delete active1RMPromptSourceTags['${m.exerciseId}']">
        ${useBtn}
      </div>
    </div>`;
  }).join('');
  openModal('modal-active-1rm-prompt');
}

function useE1RMForPrompt(exerciseId, val) {
  const input = document.getElementById(`orm-input-${exerciseId}`);
  if (input) input.value = val;
  active1RMPromptSourceTags[exerciseId] = 'e1rm';
}

function active1RMPromptSaveContinue() {
  const activeId = document.getElementById('modal-active-1rm-prompt').dataset.activeId;
  const active = appDb.programs.find(p => p.id === activeId);
  if (active) {
    document.querySelectorAll('#active-1rm-prompt-body input[id^="orm-input-"]').forEach(input => {
      const val = parseFloat(input.value);
      if (!isNaN(val) && val > 0) {
        const exerciseId = input.id.replace('orm-input-', '');
        const source = active1RMPromptSourceTags[exerciseId] === 'e1rm' ? 'e1rm' : 'manual';
        setActiveOneRepMax(active, exerciseId, val, source);
      }
    });
  }
  closeModal('modal-active-1rm-prompt');
  const cb = active1RMPromptContinue; active1RMPromptContinue = null;
  if (cb) cb();
}

function active1RMPromptSkip() {
  closeModal('modal-active-1rm-prompt');
  const cb = active1RMPromptContinue; active1RMPromptContinue = null;
  if (cb) cb();
}

function openActive1RMEditModal(idx) {
  if (!currentWorkout?.activeProgramId) return;
  active1RMEditExIdx = idx;
  active1RMEditSource = 'manual';
  const ex = currentWorkout.exercises[idx];
  const exData = getExercise(ex.exerciseId);
  const active = appDb.programs.find(p => p.id === currentWorkout.activeProgramId);
  const current = active ? getActiveOneRepMax(active, ex.exerciseId) : null;
  const e1rm = getBest1RM(ex.exerciseId, null);
  active1RMEditCurrentE1RM = e1rm > 0 ? e1rm : null;
  document.getElementById('active-1rm-edit-title').textContent = (exData ? exData.name : ex.exerciseId) + ' 1RM';
  document.getElementById('active-1rm-edit-input').value = current != null ? current : '';
  document.getElementById('active-1rm-edit-unit').textContent = appDb.unit;
  document.getElementById('active-1rm-edit-e1rm-line').textContent = e1rm > 0 ? `Current E1RM: ${Math.round(e1rm)} ${appDb.unit}` : 'No estimated 1RM available';
  const useBtn = document.getElementById('active-1rm-edit-use-e1rm-btn');
  if (useBtn) useBtn.style.display = e1rm > 0 ? '' : 'none';
  openModal('modal-active-1rm-edit');
}

function use1RMEditE1RM() {
  if (active1RMEditCurrentE1RM == null) return;
  document.getElementById('active-1rm-edit-input').value = Math.round(active1RMEditCurrentE1RM);
  active1RMEditSource = 'e1rm';
}

function saveActive1RMEdit() {
  if (active1RMEditExIdx === null || !currentWorkout?.activeProgramId) { closeModal('modal-active-1rm-edit'); return; }
  const val = parseFloat(document.getElementById('active-1rm-edit-input').value);
  if (isNaN(val) || val <= 0) { showToast('Enter a valid 1RM value', 'error'); return; }
  const active = appDb.programs.find(p => p.id === currentWorkout.activeProgramId);
  if (!active) { closeModal('modal-active-1rm-edit'); return; }
  const exId = currentWorkout.exercises[active1RMEditExIdx].exerciseId;
  setActiveOneRepMax(active, exId, val, active1RMEditSource);
  updateCurrentWorkoutFor1RM(exId, active);
  closeModal('modal-active-1rm-edit');
  showToast('1RM updated', 'success');
}

// Re-resolves %1RM weights for the given exercise in the CURRENT workout only —
// and only for sets that are still auto-filled (manual edits already clear
// autoFilled via updateSet(), same behavior relied on by the %TM edit flow).
function updateCurrentWorkoutFor1RM(exerciseId, active) {
  if (!currentWorkout) return;
  let touched = false;
  currentWorkout.exercises.forEach(ex => {
    if (ex.exerciseId !== exerciseId) return;
    ex.sets.forEach(s => {
      if (s.autoType === 'percent1RM' && s.autoFilled && !s.completed && s.targetData && s.targetData.loadType === 'percent1RM') {
        const pct = parseFloat(s.targetData.percent);
        const ormVal = getActiveOneRepMax(active, exerciseId);
        if (!isNaN(pct) && ormVal != null) {
          s.weight = String(resolvePercent1RMWeight(pct, ormVal));
          touched = true;
        }
      }
    });
  });
  if (touched) renderWorkoutExercises();
}

// ==================== ACTIVE-INSTANCE WORKING LOADS (Active Working Loads build) ====================
// Working Loads live on the active program instance only — separate storage from
// active.trainingMaxes and active.oneRepMaxes, never on the Plan template, never
// inherited by a new active instance started later from the same template.
// These resolve blank Fixed-Load sets whose exercise has addLoad progression enabled
// (the reusable Plan template intentionally never stores a numeric starting weight).

function getActiveWorkingLoad(active, exerciseId) {
  if (!active || !active.workingLoads) return null;
  const wl = active.workingLoads[exerciseId];
  const val = wl ? parseFloat(wl.value) : NaN;
  return !isNaN(val) ? val : null;
}

function setActiveWorkingLoad(active, exerciseId, value, source) {
  if (!active) return;
  if (!active.workingLoads) active.workingLoads = {};
  active.workingLoads[exerciseId] = { value, unit: appDb.unit, source: source || 'manual', updatedAt: Date.now() };
  active.updatedAt = Date.now();
  fsSaveProgram(active);
}

// Whether a blank fixed-load set (no numeric weight) exists on a prescribed set.
function isBlankFixedSet(s) {
  return s && s.loadType === 'fixed' && (s.weight === '' || s.weight == null || isNaN(parseFloat(s.weight)));
}

// Whether an exercise prescription's progression is eligible to use Active Working Loads —
// enabled, addLoad adjustment, and at least one blank fixed-load set.
function isWorkingLoadEligibleExercise(ex) {
  const prog = ex && ex.progression;
  if (!prog || !prog.enabled || prog.adjustmentType !== 'addLoad') return false;
  return (ex.sets || []).some(isBlankFixedSet);
}

// Scans a session for Working-Load-eligible exercises that don't yet have a stored
// active Working Load. Each qualifying exercise is listed once.
function getExercisesNeedingWorkingLoad(active, session) {
  const seen = new Set();
  const needing = [];
  (session.exercises || []).forEach(ex => {
    if (seen.has(ex.exerciseId)) return;
    if (!isWorkingLoadEligibleExercise(ex)) return;
    seen.add(ex.exerciseId);
    if (getActiveWorkingLoad(active, ex.exerciseId) != null) return;
    needing.push({ exerciseId: ex.exerciseId, exData: getExercise(ex.exerciseId), prog: ex.progression });
  });
  return needing;
}

// Whether the CURRENT logger exercise (by index) is Working-Load-eligible in the
// active instance's prescription — used to show the "Set / Edit Working Load" menu item.
function hasWorkingLoadTarget(exIdx) {
  if (!currentWorkout?.activeProgramId) return false;
  const active = appDb.programs.find(p => p.id === currentWorkout.activeProgramId); if (!active) return false;
  const mc = active.microcycles[currentWorkout.activeMicrocycleIdx];
  const session = mc && mc.sessions[currentWorkout.activeSessionIdx];
  if (!session) return false;
  const ex = currentWorkout.exercises[exIdx];
  const sessEx = session.exercises.find(e => e.exerciseId === ex.exerciseId); if (!sessEx) return false;
  return isWorkingLoadEligibleExercise(sessEx);
}

// History-based Working Load recommendation. Does not require exact rep-target
// matching — a completed 20x14 remains valid evidence for a new 12-rep target.
// Priority 1: the corresponding Gateway Set position from the most recent workout
//             containing this exercise, if completed with a positive weight.
// Priority 2: the most recent completed weighted set for this exercise, any workout.
// Returns null if no usable evidence exists — never invents a suggestion.
function getWorkingLoadSuggestion(exerciseId, prog) {
  const workoutsWithEx = appDb.workouts
    .filter(w => w.exercises.some(e => e.exerciseId === exerciseId))
    .sort((a, b) => b.date - a.date);
  if (!workoutsWithEx.length) return null;

  function usable(s) {
    if (!s || !s.completed) return null;
    const w = parseFloat(s.weight);
    if (isNaN(w) || w <= 0) return null;
    return { weight: w, reps: s.reps || null, time: s.time || null };
  }

  if (prog && prog.evaluationType === 'gateway') {
    const mostRecent = workoutsWithEx[0];
    const loggedEx = mostRecent.exercises.find(e => e.exerciseId === exerciseId);
    const gatewayIdx = prog.gatewaySetIndex || 0;
    const found = usable(loggedEx && loggedEx.sets ? loggedEx.sets[gatewayIdx] : null);
    if (found) return { ...found, date: mostRecent.date, workoutId: mostRecent.id };
  }

  for (const w of workoutsWithEx) {
    const ex = w.exercises.find(e => e.exerciseId === exerciseId);
    if (!ex || !ex.sets) continue;
    for (const s of ex.sets) {
      const found = usable(s);
      if (found) return { ...found, date: w.date, workoutId: w.id };
    }
  }
  return null;
}

function showActiveWorkingLoadPrompt(activeId, missingExercises, continueCallback) {
  activeWLPromptContinue = continueCallback;
  activeWLPromptSourceTags = {};
  const unit = appDb.unit;
  document.getElementById('modal-active-wl-prompt').dataset.activeId = activeId;
  document.getElementById('active-wl-prompt-body').innerHTML = missingExercises.map(m => {
    const suggestion = getWorkingLoadSuggestion(m.exerciseId, m.prog);
    activeWLPromptSourceTags[m.exerciseId] = suggestion ? 'history' : 'manual';
    let evidenceHtml, suggestionHtml, prefill;
    if (suggestion) {
      const dateStr = new Date(suggestion.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      const repsOrTime = suggestion.reps ? `${suggestion.reps} reps` : (suggestion.time ? `${suggestion.time}s` : '');
      evidenceHtml = `<div class="tm-display">Last completed: ${suggestion.weight} ${unit}${repsOrTime ? ' × ' + repsOrTime : ''}, ${dateStr}</div>`;
      suggestionHtml = `<div class="tm-display" style="margin-top:3px">Suggested Working Load: ${suggestion.weight} ${unit}</div>`;
      prefill = suggestion.weight;
    } else {
      evidenceHtml = `<div class="tm-display" style="color:var(--text3)">No completed working-load history available.</div>`;
      suggestionHtml = '';
      prefill = '';
    }
    return `
    <div class="tm-ex-block" id="awl-block-${m.exerciseId}">
      <div class="tm-ex-name">${m.exData ? escapeHtml(m.exData.name) : m.exerciseId}</div>
      ${evidenceHtml}
      ${suggestionHtml}
      <div class="tm-input-row">
        <input type="number" id="awl-input-${m.exerciseId}" placeholder="Working Load (${unit})" step="2.5" value="${prefill}" oninput="activeWLPromptSourceTags['${m.exerciseId}']='manual'">
      </div>
    </div>`;
  }).join('');
  openModal('modal-active-wl-prompt');
}

function activeWLPromptSaveContinue() {
  const activeId = document.getElementById('modal-active-wl-prompt').dataset.activeId;
  const active = appDb.programs.find(p => p.id === activeId);
  if (active) {
    document.querySelectorAll('#active-wl-prompt-body input[id^="awl-input-"]').forEach(input => {
      const val = parseFloat(input.value);
      if (!isNaN(val) && val > 0) {
        const exerciseId = input.id.replace('awl-input-', '');
        const source = activeWLPromptSourceTags[exerciseId] === 'history' ? 'history' : 'manual';
        setActiveWorkingLoad(active, exerciseId, val, source);
      }
    });
  }
  closeModal('modal-active-wl-prompt');
  const cb = activeWLPromptContinue; activeWLPromptContinue = null;
  if (cb) cb();
}

function activeWLPromptSkip() {
  closeModal('modal-active-wl-prompt');
  const cb = activeWLPromptContinue; activeWLPromptContinue = null;
  if (cb) cb();
}

function openActiveWorkingLoadEditModal(idx) {
  if (!currentWorkout?.activeProgramId) return;
  activeWLEditExIdx = idx;
  const ex = currentWorkout.exercises[idx];
  const exData = getExercise(ex.exerciseId);
  const active = appDb.programs.find(p => p.id === currentWorkout.activeProgramId);
  const current = active ? getActiveWorkingLoad(active, ex.exerciseId) : null;
  document.getElementById('active-wl-edit-title').textContent = (exData ? exData.name : ex.exerciseId) + ' Working Load';
  document.getElementById('active-wl-edit-input').value = current != null ? current : '';
  document.getElementById('active-wl-edit-unit').textContent = appDb.unit;
  openModal('modal-active-wl-edit');
}

function saveActiveWorkingLoadEdit() {
  if (activeWLEditExIdx === null || !currentWorkout?.activeProgramId) { closeModal('modal-active-wl-edit'); return; }
  const val = parseFloat(document.getElementById('active-wl-edit-input').value);
  if (isNaN(val) || val <= 0) { showToast('Enter a valid Working Load', 'error'); return; }
  const active = appDb.programs.find(p => p.id === currentWorkout.activeProgramId);
  if (!active) { closeModal('modal-active-wl-edit'); return; }
  const exId = currentWorkout.exercises[activeWLEditExIdx].exerciseId;
  setActiveWorkingLoad(active, exId, val, 'manual');
  updateCurrentWorkoutForWorkingLoad(exId, active);
  closeModal('modal-active-wl-edit');
  showToast('Working Load updated', 'success');
}

// Re-resolves Working-Load weights for the given exercise in the CURRENT workout
// only — and only for sets that are still auto-filled and NOT completed (manual
// edits already clear autoFilled via updateSet(); completed sets represent actual
// execution and must never be recalculated).
function updateCurrentWorkoutForWorkingLoad(exerciseId, active) {
  if (!currentWorkout) return;
  let touched = false;
  currentWorkout.exercises.forEach(ex => {
    if (ex.exerciseId !== exerciseId) return;
    ex.sets.forEach(s => {
      if (s.autoType === 'workingLoad' && s.autoFilled && !s.completed && s.targetData && s.targetData.loadType === 'fixed' && !s.targetData.weight) {
        const wlVal = getActiveWorkingLoad(active, exerciseId);
        if (wlVal != null) {
          s.weight = String(wlVal);
          touched = true;
        }
      }
    });
  });
  if (touched) renderWorkoutExercises();
}

// Only ever mutates active.workingLoads — never active.microcycles, never the
// sourceSnapshot, never the Plan template, never a completed workout.
function applyWorkingLoadSuggestion(active, exerciseId, newValue) {
  setActiveWorkingLoad(active, exerciseId, newValue, 'progression');
}

// Whether any future unfinished session still has an eligible blank fixed-load
// occurrence of this exercise under addLoad progression — used to decide if a
// Working Load increase is actually worth applying.
function hasFutureWorkingLoadOccurrence(active, exerciseId) {
  if (!active) return false;
  return getFutureUnfinishedSessions(active).some(({ session }) =>
    (session.exercises || []).some(ex => ex.exerciseId === exerciseId && isWorkingLoadEligibleExercise(ex))
  );
}

// ==================== HISTORY STATS ====================
function renderHistoryStats() {
  const total = appDb.workouts.length;
  // PARTIAL-WORKOUT CORRECTION ROUND 4 (finding 1) -- was e.sets.length
  // (raw array length), counting every blank/untouched canonical placeholder
  // as a performed set. Now counts only sets carrying genuine recorded
  // performance (shared predicate, plan-run-model.js).
  const totalSets = appDb.workouts.reduce((a,w) => a + w.exercises.reduce((b,e) => b + e.sets.filter(planRunSetHasRecordedPerformance).length, 0), 0) + appDb.importedSets.length;
  let totalVol = 0;
  // UNPERFORMED-EXERCISE HISTORY CORRECTION: Total Volume now uses the same
  // shared predicate as Total Sets on the line above -- an unchecked,
  // prefilled target weight x reps was previously counted as lifted volume.
  appDb.workouts.forEach(w => w.exercises.forEach(e => e.sets.forEach(s => { if (planRunSetHasRecordedPerformance(s) && s.weight && s.reps) totalVol += (+s.weight) * (+s.reps); })));
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
  // ACTIVE-WORKOUT RECOVERY safety net: stores any change made by any path
  // within a second (an unchanged workout is not rewritten).
  if (typeof awDraftWrite === 'function') awDraftWrite(false);
}
function getElapsedSeconds() {
  if (!activeWorkoutStart) return 0;
  if (workoutPaused) return Math.floor((workoutPausedAt - activeWorkoutStart - workoutPausedTotal) / 1000);
  return Math.floor((Date.now() - activeWorkoutStart - workoutPausedTotal) / 1000);
}
function pauseWorkout() { if (!currentWorkout || workoutPaused) return; workoutPaused = true; workoutPausedAt = Date.now(); updateTimerDisplay(); awDraftSaveNow(); showToast('Workout paused', ''); }
function resumeWorkout() { if (!currentWorkout || !workoutPaused) return; workoutPausedTotal += (Date.now() - workoutPausedAt); workoutPaused = false; workoutPausedAt = null; updateTimerDisplay(); awDraftSaveNow(); showToast('Workout resumed', 'success'); }
function stopWorkoutTimer() { if (activeWorkoutTimer) clearInterval(activeWorkoutTimer); document.getElementById('active-bar').classList.remove('visible'); workoutPaused = false; workoutPausedTotal = 0; workoutPausedAt = null; }
// ACTIVE-WORKOUT RECOVERY: continues the timer from a recovered draft's
// stored values (same semantics as startWorkoutTimer/pause/resume: time in
// the background counts unless the workout was paused).
function restoreWorkoutTimer(t) {
  activeWorkoutStart = t.activeWorkoutStart; workoutPaused = !!t.workoutPaused;
  workoutPausedAt = t.workoutPaused ? t.workoutPausedAt : null; workoutPausedTotal = t.workoutPausedTotal || 0;
  if (activeWorkoutTimer) clearInterval(activeWorkoutTimer);
  document.getElementById('active-bar').classList.add('visible');
  activeWorkoutTimer = setInterval(updateTimerDisplay, 1000);
  updateTimerDisplay();
}

// ==================== ACTIVE-WORKOUT LOCAL RECOVERY DRAFT ====================
// Mobile browsers may suspend a backgrounded tab or discard it to recover
// memory; the page then reloads from scratch. currentWorkout, the workout
// timer and the logger's state live only in page memory, so a reload used
// to lose an unfinished workout. This section keeps ONE versioned draft of
// the open live workout per signed-in user, in this browser's localStorage
// (synchronous, so the latest state is already stored if the page is
// killed abruptly; no Firestore reads/writes, no Rules change), and offers
// it back -- explicitly, never silently -- after the next sign-in.
//
// SAVE POINTS: a new live workout opens (awDraftBeginForCurrentWorkout);
// every logger re-render (renderWorkoutExercises -- covers add/remove/
// change/substitute/restore/reorder of exercises and sets, PR sets, RPE
// toggle, Training-Max / 1RM / Working-Load fills); updateSet (typing:
// short debounce); set checkboxes; pause/resume; bodyweight; performance
// videos; every canonical Finish state change; page hidden / pagehide;
// and a safety net on the existing one-second timer tick that stores any
// change any other path may have made (unchanged content is not rewritten).
// CLEAR POINTS (only): an ordinary/legacy Finish reaching its existing
// "saved" point; a canonical Finish confirmed committed
// (planRunLoggerFinishCommit); an explicitly confirmed Cancel; an explicit
// "Discard Draft". Never on navigation, backgrounding, sign-out/auth delay,
// network errors, rejected/conflicting/uncertain Finish, or unreadable
// drafts. Historical-workout edit mode (_isEdit) is EXCLUDED: never saved,
// never cleared.
const AW_DRAFT_SCHEMA = 'ironlog.activeWorkoutDraft';
const AW_DRAFT_VERSION = 1;
const AW_DRAFT_KEY_PREFIX = 'ironlog.activeWorkoutDraft:'; // + owner uid (unversioned: a newer build's draft is still found, then refused as unsupported)
const AW_DRAFT_TYPING_DEBOUNCE_MS = 400;
let awDraftOwnerUid = null;          // owner of the live workout currently open in this page
let awDraftLastBody = null;          // last stored content (savedAt excluded), to skip identical writes
let awDraftTypingTimer = null;
let awDraftStorageFailed = false;    // shown once per page, never repeatedly
let awDraftRecoveredWorkoutId = null;// id of a workout restored from a draft (blocks opening another over it)
let awDraftRecovery = null;          // unresolved recovery prompt: { ownerUid, draft|null, problem|null, busy }

function awDraftKey(uid) { return AW_DRAFT_KEY_PREFIX + uid; }
function awDraftStore() { try { return (typeof localStorage !== 'undefined') ? localStorage : null; } catch (e) { return null; } }
function awDraftAuthUid() { return (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.uid) || null; }
function awDraftLiveWorkoutOpen() { return !!currentWorkout && !currentWorkout._isEdit; }

// JSON with Firestore Timestamps tagged (a pending canonical Finish package
// carries them); everything else in an active workout is plain data.
function awDraftEncode(value) {
  return JSON.stringify(value, function (k, v) {
    if (v && typeof v === 'object' && typeof v.toMillis === 'function' && typeof v.seconds === 'number' && typeof v.nanoseconds === 'number') {
      return { __awTimestamp: [v.seconds, v.nanoseconds] };
    }
    return v;
  });
}
function awDraftDecode(text) {
  return JSON.parse(text, function (k, v) {
    if (v && typeof v === 'object' && Array.isArray(v.__awTimestamp) && v.__awTimestamp.length === 2 && Object.keys(v).length === 1) {
      const s = v.__awTimestamp[0], ns = v.__awTimestamp[1];
      if (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.Timestamp) return new firebase.firestore.Timestamp(s, ns);
      return { seconds: s, nanoseconds: ns };
    }
    return v;
  });
}

function awDraftKind(w) {
  if (w.canonicalRun) return 'canonicalRun';
  if (w.activeProgramId) return 'legacyActiveProgram';
  if (w.programId) return 'legacyProgram';
  return 'ordinary';
}
// Only a still-unresolved canonical Finish attempt is kept (so a reload
// reuses the existing Retry / Check Status with the SAME prepared package).
function awDraftFinishAttempt() {
  if (!currentWorkout || !currentWorkout.canonicalRun || typeof planRunLoggerFinishState === 'undefined') return null;
  const st = planRunLoggerFinishState;
  if (!st || !st.pkg || (st.phase !== 'pending' && st.phase !== 'uncertain')) return null;
  if (st.pkg.workoutId !== currentWorkout.id) return null;
  return { phase: st.phase, pkg: st.pkg };
}
function awDraftBody() {
  const w = Object.assign({}, currentWorkout); delete w._isEdit;
  return {
    schema: AW_DRAFT_SCHEMA, version: AW_DRAFT_VERSION, ownerUid: awDraftOwnerUid,
    workoutId: currentWorkout.id, kind: awDraftKind(currentWorkout), workout: w,
    timer: { activeWorkoutStart: activeWorkoutStart, workoutPaused: !!workoutPaused, workoutPausedAt: workoutPausedAt, workoutPausedTotal: workoutPausedTotal || 0 },
    finishAttempt: awDraftFinishAttempt()
  };
}
function awDraftReportStorageFailure() {
  if (awDraftStorageFailed) return;
  awDraftStorageFailed = true;
  if (typeof showToast === 'function') showToast('This browser can’t keep a recovery copy of your workout. Keep IRON LOG open until you finish.', 'error');
}
// Writes the open live workout to its OWNER's draft. `forOwnerOnAuthChange`
// is used only by awDraftHandleAuthChange, to store the previous owner's
// workout under that owner's own key at the moment of an account change.
function awDraftWrite(forOwnerOnAuthChange) {
  if (!awDraftLiveWorkoutOpen() || !awDraftOwnerUid) return;
  if (!forOwnerOnAuthChange && awDraftAuthUid() !== awDraftOwnerUid) return;
  let body;
  try { body = awDraftEncode(awDraftBody()); } catch (e) { awDraftReportStorageFailure(); return; }
  if (body === awDraftLastBody) return;
  const store = awDraftStore();
  if (!store) { awDraftReportStorageFailure(); return; }
  try {
    store.setItem(awDraftKey(awDraftOwnerUid), body.slice(0, -1) + ',"savedAt":' + Date.now() + '}');
    awDraftLastBody = body;
  } catch (e) { awDraftReportStorageFailure(); }
}
function awDraftSaveNow() {
  if (awDraftTypingTimer) { clearTimeout(awDraftTypingTimer); awDraftTypingTimer = null; }
  awDraftWrite(false);
}
function awDraftSaveSoon() {
  if (awDraftTypingTimer) clearTimeout(awDraftTypingTimer);
  awDraftTypingTimer = setTimeout(function () { awDraftTypingTimer = null; awDraftWrite(false); }, AW_DRAFT_TYPING_DEBOUNCE_MS);
}
// Called right after a NEW live workout is opened (it replaces this user's
// single draft slot, exactly as it replaces currentWorkout in memory).
function awDraftBeginForCurrentWorkout() {
  if (!awDraftLiveWorkoutOpen()) return;
  awDraftOwnerUid = awDraftAuthUid();
  awDraftLastBody = null;
  awDraftRecoveredWorkoutId = null;
  awDraftSaveNow();
}
function awDraftClear(ownerUid) {
  const uid = ownerUid || awDraftOwnerUid;
  if (awDraftTypingTimer) { clearTimeout(awDraftTypingTimer); awDraftTypingTimer = null; }
  if (uid) { const store = awDraftStore(); try { if (store) store.removeItem(awDraftKey(uid)); } catch (e) { /* nothing more can be done; never blocks the logger */ } }
  if (!ownerUid || ownerUid === awDraftOwnerUid) { awDraftOwnerUid = null; awDraftLastBody = null; awDraftRecoveredWorkoutId = null; }
}
// Opening another workout over a recovered one -- or while the recovery
// question is still unanswered -- is refused (it would replace the draft).
//
// CORRECTION (review finding 1): the draft slot is also HELD by any draft
// still in storage that this page is not itself writing -- e.g. after "Keep
// for Later", or a draft that is unreadable or from a newer version. That
// is read from storage itself (not from the dialog's in-memory state), so a
// new workout can never overwrite it. Only a confirmed Finish, a confirmed
// Cancel or a confirmed Discard Draft releases the slot. The attempt is
// refused and the saved draft's recovery choices are shown again.
// `opts.historyEdit`: editing a past workout never writes or clears the
// draft, so a held draft alone does not block it (unchanged behavior).
function awDraftStoredRaw(uid) {
  const store = awDraftStore();
  if (!store || !uid) return null;
  try { return store.getItem(awDraftKey(uid)); } catch (e) { return null; }
}
function awDraftSlotHeldByStoredDraft() {
  const uid = awDraftAuthUid();
  if (!uid) return false;
  if (awDraftLiveWorkoutOpen() && awDraftOwnerUid === uid) return false; // the slot holds this page's own open workout
  return awDraftStoredRaw(uid) !== null;
}
function awDraftBlocksOpeningWorkout(opts) {
  if (awDraftRecovery) { showToast('Resume or discard the recovered workout first.', 'error'); return true; }
  if (currentWorkout && awDraftRecoveredWorkoutId && currentWorkout.id === awDraftRecoveredWorkoutId) {
    showToast('Finish or cancel your recovered workout first.', 'error'); return true;
  }
  if (!(opts && opts.historyEdit) && awDraftSlotHeldByStoredDraft()) {
    showToast('You have a saved unfinished workout. Resume or discard it first.', 'error');
    if (!currentWorkout) awDraftOfferRecovery(awDraftAuthUid());
    return true;
  }
  return false;
}

// ---- auth boundary (called first thing in auth.onAuthStateChanged) ----
function awDraftHandleAuthChange(user) {
  const newUid = user ? user.uid : null;
  awDraftCloseRecovery();
  awDraftRecovery = null;
  if (awDraftLiveWorkoutOpen() && awDraftOwnerUid && newUid !== awDraftOwnerUid) {
    awDraftWrite(true); // keep the previous owner's latest state under the previous owner's key
    if (!currentWorkout.canonicalRun) { // canonical: planRunLoggerFinishResetForAuthChange discards it
      clearAllPRDebounceTimers(); stopWorkoutTimer(); currentWorkout = null;
      const ex = document.getElementById('workout-exercises'); if (ex) ex.innerHTML = '';
      if (activePage() === 'page-log') showPage('page-home');
    }
    awDraftOwnerUid = null; awDraftLastBody = null; awDraftRecoveredWorkoutId = null;
    if (awDraftTypingTimer) { clearTimeout(awDraftTypingTimer); awDraftTypingTimer = null; }
  }
}

// ---- recovery (called after sign-in, once startup has finished) ----
function awDraftValidShape(d, uid) {
  const w = d && d.workout, t = d && d.timer;
  return !!d && typeof d === 'object' && d.ownerUid === uid && typeof d.workoutId === 'string' &&
    !!w && typeof w === 'object' && w.id === d.workoutId && Array.isArray(w.exercises) &&
    w.exercises.every(function (e) { return e && typeof e === 'object' && Array.isArray(e.sets); }) &&
    ['ordinary', 'legacyActiveProgram', 'legacyProgram', 'canonicalRun'].indexOf(d.kind) !== -1 && d.kind === awDraftKind(w) &&
    !!t && typeof t.activeWorkoutStart === 'number' && typeof t.workoutPausedTotal === 'number' &&
    (!t.workoutPaused || typeof t.workoutPausedAt === 'number') &&
    (d.kind !== 'canonicalRun' || (typeof w.canonicalRun.planRunId === 'string' && typeof w.canonicalRun.occurrenceId === 'string')) &&
    (d.finishAttempt == null || (d.kind === 'canonicalRun' && d.finishAttempt.pkg && d.finishAttempt.pkg.workoutId === d.workoutId && d.finishAttempt.pkg.ownerUid === uid));
}
function awDraftOfferRecovery(uid) {
  if (!uid || uid !== awDraftAuthUid() || currentWorkout) return;
  const store = awDraftStore();
  let raw = null;
  try { raw = store ? store.getItem(awDraftKey(uid)) : null; } catch (e) { return; }
  if (!raw) return;
  let d = null, problem = null;
  try { d = awDraftDecode(raw); } catch (e) { problem = 'malformed'; }
  if (!problem) {
    if (!d || d.schema !== AW_DRAFT_SCHEMA || typeof d.version !== 'number') problem = 'malformed';
    else if (d.version > AW_DRAFT_VERSION) problem = 'unsupported';
    else if (d.version !== AW_DRAFT_VERSION || !awDraftValidShape(d, uid)) problem = 'malformed';
  }
  awDraftRecovery = { ownerUid: uid, draft: problem ? null : d, problem: problem, busy: false, message: null, canResume: !problem };
  awDraftRenderRecovery();
}
function awDraftSummary(d) {
  const w = d.workout;
  const done = w.exercises.reduce(function (a, e) { return a + e.sets.filter(function (s) { return s && s.completed; }).length; }, 0);
  const when = d.savedAt ? new Date(d.savedAt).toLocaleString() : '';
  return (w.name || 'Workout') + ' — ' + w.exercises.length + ' exercise' + (w.exercises.length === 1 ? '' : 's') + ', ' + done + ' set' + (done === 1 ? '' : 's') + ' checked' + (when ? ' · saved ' + when : '');
}
function awDraftCloseRecovery() {
  const el = (typeof document !== 'undefined') ? document.getElementById('aw-recovery-overlay') : null;
  if (el && el.parentNode && typeof el.remove === 'function') el.remove();
}
function awDraftRenderRecovery() {
  awDraftCloseRecovery();
  const r = awDraftRecovery; if (!r) return;
  let title, msg, buttons = '';
  if (r.problem) {
    title = 'Saved Workout Unreadable';
    msg = r.problem === 'unsupported'
      ? 'An unfinished workout was saved by a newer version of IRON LOG, so this version can’t open it. It has been kept on this device.'
      : 'An unfinished workout was saved on this device, but it couldn’t be read safely. It has been kept on this device.';
    buttons = '<button class="btn btn-secondary" style="flex:1 1 130px;min-width:0;white-space:normal" data-aw-action="later" data-testid="aw-later-btn">Keep for Later</button>' +
      '<button class="btn btn-danger" style="flex:1 1 130px;min-width:0;white-space:normal" data-aw-action="discard" data-testid="aw-discard-btn">Discard Draft</button>';
  } else {
    title = 'Workout Recovered';
    msg = 'An unfinished workout was recovered. Would you like to resume it?';
    if (r.message) msg = r.message;
    const resume = r.canResume
      ? '<button class="btn btn-primary" style="flex:1 1 130px;min-width:0;white-space:normal" data-aw-action="' + (r.retry ? 'retry' : 'resume') + '" data-testid="aw-resume-btn" ' + (r.busy ? 'disabled' : '') + '>' + (r.busy ? 'Checking…' : (r.retry ? 'Retry' : 'Resume Workout')) + '</button>'
      : '<button class="btn btn-secondary" style="flex:1 1 130px;min-width:0;white-space:normal" data-aw-action="later" data-testid="aw-later-btn">Keep for Later</button>';
    buttons = '<button class="btn btn-danger" style="flex:1 1 130px;min-width:0;white-space:normal" data-aw-action="discard" data-testid="aw-discard-btn" ' + (r.busy ? 'disabled' : '') + '>Discard Draft</button>' + resume;
  }
  const el = document.createElement('div');
  el.id = 'aw-recovery-overlay';
  el.setAttribute('data-testid', 'aw-recovery');
  el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:290;display:flex;align-items:center;justify-content:center;padding:20px';
  el.innerHTML = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:24px;width:100%;max-width:340px">' +
    '<h3 style="font-family:var(--font-display);font-size:20px;font-weight:800;text-transform:uppercase;margin-bottom:8px">' + escapeHtml(title) + '</h3>' +
    '<p data-testid="aw-recovery-msg" style="font-size:15px;color:var(--text2);margin-bottom:10px;line-height:1.5">' + escapeHtml(msg) + '</p>' +
    (r.draft ? '<p data-testid="aw-recovery-summary" style="font-size:13px;color:var(--text3);margin-bottom:18px;line-height:1.4">' + escapeHtml(awDraftSummary(r.draft)) + '</p>' : '') +
    '<div style="display:flex;flex-wrap:wrap;gap:10px">' + buttons + '</div></div>';
  el.addEventListener('click', function (ev) {
    const b = ev.target.closest ? ev.target.closest('[data-aw-action]') : null;
    if (!b || b.disabled) return;
    const a = b.getAttribute('data-aw-action');
    if (a === 'resume' || a === 'retry') awDraftResume();
    else if (a === 'discard') awDraftDiscardFromRecovery();
    else if (a === 'later') { awDraftRecovery = null; awDraftCloseRecovery(); }
  });
  document.body.appendChild(el);
}
function awDraftDiscardFromRecovery() {
  const r = awDraftRecovery; if (!r) return;
  confirm2('Discard Draft', 'Discard the recovered workout? Everything entered in it will be lost.', function () {
    if (awDraftRecovery !== r) return;
    awDraftClear(r.ownerUid);
    awDraftRecovery = null; awDraftCloseRecovery();
    showToast('Recovered workout discarded', '');
  }, 'Discard');
}
function awDraftResume() {
  const r = awDraftRecovery;
  if (!r || !r.draft || r.busy || r.ownerUid !== awDraftAuthUid() || currentWorkout) return;
  const d = r.draft;
  if (d.kind !== 'canonicalRun') { awDraftRestore(d); return; }
  // A Finish attempt was still unresolved when the page went away: resume
  // into that attempt's existing "uncertain" state and let the existing
  // Check Status reconcile it (never a fresh Finish).
  if (d.finishAttempt) { awDraftRestore(d); return; }
  // Otherwise confirm, through the existing launch-mode read, that the Run
  // is still active and this Session is still open. The draft is never
  // rebuilt from PLAN or merged.
  r.busy = true; r.message = 'Checking this Program Run Session…'; awDraftRenderRecovery();
  const cr = d.workout.canonicalRun;
  let p;
  try {
    p = fsPlanRunPersistence.fsPlanRunReadForDisplay({ ownerUid: r.ownerUid, planRunId: cr.planRunId, occurrenceId: cr.occurrenceId, mode: 'launch' });
  } catch (e) { p = Promise.reject(e); }
  Promise.resolve(p).then(function (res) {
    if (awDraftRecovery !== r || r.ownerUid !== awDraftAuthUid()) return;
    r.busy = false;
    if (res && res.outcome === 'verified') { awDraftRestore(d); return; }
    const saved = appDb.workouts.some(function (w) { return w && w.id === d.workoutId; });
    r.canResume = false; r.retry = false;
    r.message = saved
      ? 'This workout has already been saved to your History, so it can’t be resumed. Nothing more was saved.'
      : 'This Program Run Session has already been finished or skipped, or its Run has ended or is no longer available, so this workout can’t be resumed. Nothing from it was saved.';
    awDraftRenderRecovery();
  }, function () {
    if (awDraftRecovery !== r || r.ownerUid !== awDraftAuthUid()) return;
    r.busy = false; r.retry = true; r.canResume = true;
    r.message = 'We couldn’t check this Program Run Session right now (you may be offline). Your recovered workout is kept — try again.';
    awDraftRenderRecovery();
  });
}
// Rebuilds the logger from the draft through the normal render path; the
// timer continues from the stored start/pause values (background time
// counts unless the workout was paused).
function awDraftRestore(d) {
  awDraftRecovery = null; awDraftCloseRecovery();
  clearAllPRDebounceTimers();
  if (awDraftTypingTimer) { clearTimeout(awDraftTypingTimer); awDraftTypingTimer = null; }
  currentWorkout = d.workout;
  delete currentWorkout._isEdit;
  recomputeAllSetPRFlags(currentWorkout); // derived state regenerated, not trusted from storage
  restoreWorkoutTimer(d.timer);
  if (currentWorkout.canonicalRun && typeof planRunLoggerRestoreFromDraft === 'function') planRunLoggerRestoreFromDraft(d.finishAttempt);
  document.getElementById('workout-exercises').innerHTML = '';
  const nameDisplay = document.getElementById('log-session-name-display');
  if (nameDisplay) nameDisplay.textContent = (currentWorkout.name || (currentWorkout.canonicalRun ? 'WORKOUT' : 'NEW WORKOUT')).toUpperCase();
  awDraftOwnerUid = d.ownerUid;
  awDraftLastBody = null;
  awDraftRecoveredWorkoutId = currentWorkout.id;
  renderWorkoutExercises();
  showPage('page-log');
  if (typeof planRunLoggerFinishRender === 'function') planRunLoggerFinishRender();
  awDraftSaveNow();
  showToast('Workout resumed', 'success');
  if (d.finishAttempt && typeof planRunLoggerFinishCheckStatus === 'function') planRunLoggerFinishCheckStatus();
}

if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') awDraftSaveNow(); });
}
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('pagehide', function () { awDraftSaveNow(); });
}
function goToActiveWorkout() { showPage('page-log'); }

function onSetChecked(exIdx, si, checked) {
  if (!currentWorkout) return;
  const s = currentWorkout.exercises[exIdx].sets[si];
  s.completed = checked;
  if (checked && workoutPaused) resumeWorkout();
  const wrap = document.getElementById(`set-wrap-${exIdx}-${si}`);
  if (wrap) wrap.classList.toggle('completed', checked);
  // ONE CONSISTENT RULE (this round, Round 8): routed through the single
  // computeSetPRFlags helper (defined with updateSet/checkSetPR below) --
  // this function no longer carries its own copy of the completed/weight/
  // reps gate or the two comparison lines. Round 7's own fix (explicitly
  // clearing both flags whenever this Set is not both checked and
  // qualifying, so unchecking or checking-while-still-blank never leaves a
  // stale true flag) is preserved exactly -- computeSetPRFlags itself
  // always returns {isPR:false, isNew1RM:false} for anything not completed
  // and valid, which is the same outcome, just no longer a second,
  // independently-maintained copy of the rule. Round 8 additionally closes
  // Finding 2 here too: computeSetPRFlags requires a genuine finite
  // positive weight/reps, not merely a truthy value, so `Infinity` or a
  // malformed numeric string can no longer earn a flag through this path
  // either.
  const checkFlags = computeSetPRFlags(s, currentWorkout.exercises[exIdx].exerciseId, currentWorkout.id);
  s.isPR = checkFlags.isPR;
  s.isNew1RM = checkFlags.isNew1RM;
  // EXTRA-LABEL REMOVAL CORRECTION (unchanged): badge patches render no
  // EXTRA tag. Duplicate weight-PR correction: checking/unchecking can move
  // the PR to another set, so the rule is re-applied to the whole workout
  // and every badge refreshed (patchSetBadges = the previous per-set patch).
  refreshCurrentWorkoutPRBadges();
  awDraftSaveNow(); // ACTIVE-WORKOUT RECOVERY: a checkbox is saved at once
}

// ==================== LOG HEADER MENU ====================
function openLogHeaderMenu(e) {
  e.stopPropagation();
  const items = [
    { label: 'Reorder Exercises', icon: '↕', action: 'openReorderModal()' },
    { label: 'Log Bodyweight',    icon: '⚖', action: 'openLogBWModal()' },
    // EDIT WORKOUT TIME: open live workouts only (never a History edit).
    ...(workoutTimeEditAvailable() ? [{ label: 'Edit Workout Time', icon: '⏱', action: 'openEditWorkoutTimeModal()' }] : []),
    { label: 'RPE',              icon: '',  action: 'toggleRPEFromMenu()', toggle: currentWorkout?.rpeEnabled ? '✓ ' : '' },
    { divider: true },
    { label: 'Cancel Workout', icon: '✕', action: 'cancelWorkout()', danger: true },
  ];
  showDropdown(e.currentTarget, items);
}
function togglePauseWorkout() { if (!currentWorkout) return; if (workoutPaused) resumeWorkout(); else pauseWorkout(); }

// ==================== EDIT WORKOUT TIME ====================
// Corrects the elapsed time of the OPEN live workout (e.g. a forgotten
// pause). It works by moving workoutPausedTotal -- the value that
// getElapsedSeconds() and updateTimerDisplay() already subtract -- so the
// Logger timer, the active-workout bar, the recovery draft and Finish's
// saved duration all read the same corrected value. activeWorkoutStart
// (and the workout's id and date) is never touched. workoutPausedTotal may
// go negative when the entered time is longer than the real time since
// start; the elapsed math and the recovery draft's shape check accept that.
// startWorkoutTimer()/stopWorkoutTimer() reset it, so nothing carries over
// to the next workout.
function workoutTimeEditAvailable() {
  return !!(currentWorkout && !currentWorkout._isEdit && activeWorkoutStart);
}
function openEditWorkoutTimeModal() {
  if (!workoutTimeEditAvailable()) return;
  if (planRunLoggerFinishBlocksCancel()) { showToast('Resolve the current Finish attempt before changing the workout time.', 'error'); return; }
  const s = Math.max(0, getElapsedSeconds());
  document.getElementById('wt-modal-min').value = String(Math.floor(s / 60));
  document.getElementById('wt-modal-sec').value = String(s % 60);
  openModal('modal-edit-workout-time');
}
// Whole, nonnegative number written with digits only ("", "-1", "1.5",
// "1e3" are all rejected). Returns null when invalid.
function parseWorkoutTimeField(v) {
  v = String(v == null ? '' : v).trim();
  return /^\d{1,5}$/.test(v) ? parseInt(v, 10) : null;
}
function setWorkoutElapsedSeconds(target) {
  // "As of now": running -> measured from this moment; paused -> measured
  // from the pause moment, so the paused display holds `target` exactly.
  const ref = workoutPaused ? workoutPausedAt : Date.now();
  workoutPausedTotal = ref - activeWorkoutStart - target * 1000;
  updateTimerDisplay();
  awDraftSaveNow();
}
function saveWorkoutTimeFromModal() {
  if (!workoutTimeEditAvailable()) { closeModal('modal-edit-workout-time'); return; }
  if (planRunLoggerFinishBlocksCancel()) { showToast('Resolve the current Finish attempt before changing the workout time.', 'error'); return; }
  const m = parseWorkoutTimeField(document.getElementById('wt-modal-min').value);
  const s = parseWorkoutTimeField(document.getElementById('wt-modal-sec').value);
  if (m === null || s === null || s > 59) { showToast('Enter whole minutes, and seconds from 0 to 59.', 'error'); return; }
  setWorkoutElapsedSeconds(m * 60 + s);
  closeModal('modal-edit-workout-time');
  showToast('Workout time updated', 'success');
}

// WORKOUT-FLEXIBILITY CORRECTION (restores user authority over a
// Program Run Session's planned exercises -- see the correction report
// for the full root-cause trace and the Constitution basis). The PRIOR
// correction (comment retained below, for history) found the real cause
// of "We found a conflict..." at Finish: Change Exercise rewrote a row's
// exerciseId without ever touching its planAssignmentId/planPrescriptionId/
// Set planSetId identity, which plan-run-model.js's
// planRunWorkoutContextMatchesOccurrence correctly, and strictly, re-checks
// at Finish. Rather than leaving both actions withdrawn, this correction
// makes both actions genuinely safe: every exercise row now carries an
// honest `origin` label (plan-run-model.js), and Change Exercise/Delete
// Exercise both now UPDATE that label (and, where needed, the Set
// identities) instead of silently drifting out of agreement with it.
//
// PRIOR CORRECTION NOTE (historical, for context): "Change Exercise" and
// "Delete Exercise" were withdrawn entirely for a canonical Run Session.
// That was the safe, minimal fix available at the time; it is superseded
// by this correction, which restores both actions without reopening the
// original defect -- see confirmChangeExercise/deleteExercise below.
function openExerciseMenu(e, idx) {
  e.stopPropagation();
  const ex = currentWorkout?.exercises[idx];
  const hasProg = ex ? hasProgression(idx) : false;
  const hasTM = ex ? hasActiveTMTarget(idx) : false;
  const has1RM = ex ? hasActive1RMTarget(idx) : false;
  const hasWL = ex ? hasWorkingLoadTarget(idx) : false;
  // RESTORED (see the correction note above this function): both items
  // are offered for a canonical Run Session now, exactly as for an
  // ordinary workout -- confirmChangeExercise/deleteExercise below carry
  // their own canonical-Run-specific, data-preserving behavior.
  const items = [
    { label: 'Change Exercise', icon: '⇄', action: `openChangeExModal(${idx})` },
    ...(hasProg ? [{ label: 'Reset TM / Baseline', icon: '↺', action: `openSingleTMPrompt(${idx})` }] : []),
    ...(hasTM ? [{ label: 'Set / Edit Training Max', icon: '⚖', action: `openActiveTMEditModal(${idx})` }] : []),
    ...(has1RM ? [{ label: 'Set / Edit 1RM', icon: '◉', action: `openActive1RMEditModal(${idx})` }] : []),
    ...(hasWL ? [{ label: 'Set / Edit Working Load', icon: '➕', action: `openActiveWorkingLoadEditModal(${idx})` }] : []),
    // RECOMMENDED REPLACEMENTS: a pending (not yet durable) Run-level
    // replacement can be edited or cancelled until Finish.
    ...(planRunPendingReplacementForRow(idx) && planRunSeriesForRow(idx) ? [
      { label: 'Edit Run Replacement Value', icon: '✎', action: `planRunEditPendingReplacement(${idx})` },
      { label: 'Cancel Run Replacement', icon: '↺', action: `planRunCancelPendingReplacement(${idx})` }
    ] : []),
    { divider: true }, { label: 'Delete Exercise', icon: '✕', action: `deleteExercise(${idx})`, danger: true },
  ];
  if (items.length === 0) return;
  showDropdown(e.currentTarget, items);
}

function deleteExercise(idx) {
  if (!currentWorkout) return;
  const ex = currentWorkout.exercises[idx];
  const exData = getExercise(ex.exerciseId);
  const name = exData ? exData.name : 'this exercise';
  if (planRunLoggerIsCanonicalRunSession()) {
    // WORKOUT-FLEXIBILITY CORRECTION. Three honest cases, chosen by what
    // is actually true of this row -- never a blanket refusal:
    //   1. An 'added' row has no prescribed identity to protect -- behaves
    //      exactly like an ordinary workout's Delete Exercise (confirm,
    //      then full removal).
    //   2. A prescribed/substituted row with NO genuine recorded
    //      performance anywhere on it -- nothing is at risk, so it is
    //      removed immediately, with no confirmation needed (this is the
    //      "deliberately omitted" case: the row's own absence from the
    //      final persisted document, together with the occurrence's own
    //      permanent prescription snapshot, already IS an honest, durable
    //      record that it was planned but not performed this Session --
    //      see the correction report's own note on why no separate
    //      tombstone field is needed).
    //   3. A prescribed/substituted row that DOES carry genuine recorded
    //      performance somewhere on it -- that performance is never
    //      destroyed. Only the still-unperformed remainder of its Sets is
    //      dropped (exactly Delete Set's own effect, applied to every
    //      remaining unperformed Set on the row at once); the row itself,
    //      and every Set with real recorded work, stays exactly as
    //      logged, and will Finish and appear in History untouched.
    if (ex.origin === 'added') {
      confirm2('Delete Exercise', `Remove ${name} from this workout?`, () => { currentWorkout.exercises.splice(idx, 1); renderWorkoutExercises(); }, 'Delete');
      return;
    }
    const hasWork = ex.sets.some(planRunSetHasRecordedPerformance);
    if (!hasWork) {
      currentWorkout.exercises.splice(idx, 1);
      renderWorkoutExercises();
      showToast(`${name} removed for this Session.`, 'success');
      return;
    }
    ex.sets = ex.sets.filter(planRunSetHasRecordedPerformance);
    renderWorkoutExercises();
    showToast('Remaining sets skipped. Your completed work is kept.', 'success');
    return;
  }
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
function saveBWFromModal() { const val = parseFloat(document.getElementById('bw-modal-input').value); if (currentWorkout) currentWorkout.bodyweight = val || null; awDraftSaveNow(); closeModal('modal-log-bw'); showToast('Bodyweight saved', 'success'); }
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
  renderVideosModalBody();
  // VIDEO-URL ENTRY (phone): this is the entry screen, so mark it for the
  // phone-only top-anchored layout (styles.css). History's read-only viewer
  // (openExpandedVideosModal) reuses this modal and removes the mark.
  document.getElementById('modal-ex-videos').classList.add('video-entry');
  openModal('modal-ex-videos');
  // Focus the URL field now, inside the same tap that opened the dialog, so
  // a phone opens its keyboard once and the user can paste straight away.
  // A delayed focus would fall outside the tap and iOS would not open the
  // keyboard. Phone width only; desktop keeps its existing behavior.
  if (window.matchMedia && window.matchMedia('(max-width: 599px)').matches) {
    const input = document.getElementById('perf-vid-modal-input');
    if (input) input.focus({ preventScroll: true });
  }
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
function addPerfVideoFromModal() { const input = document.getElementById('perf-vid-modal-input'); if (!input) return; const url = input.value.trim(); if (!url) { showToast('Paste a link first', 'error'); return; } if (!currentWorkout || videosExIdx === null) return; if (!currentWorkout.exercises[videosExIdx].perfVideos) currentWorkout.exercises[videosExIdx].perfVideos = []; currentWorkout.exercises[videosExIdx].perfVideos.push(url); awDraftSaveNow(); input.value = ''; renderVideosModalBody(); showToast('Video added', 'success'); }
function removePerfVideo(viIdx) { if (!currentWorkout || videosExIdx === null) return; currentWorkout.exercises[videosExIdx].perfVideos.splice(viIdx, 1); awDraftSaveNow(); renderVideosModalBody(); }

// ==================== CHANGE EXERCISE ====================
// WORKOUT-FLEXIBILITY CORRECTION ROUND 2 (Finding 1 remediation): decides
// the honest `origin` for a prescribed/substituted row AFTER a Change
// Exercise, by comparing the newly selected exercise against the
// Assignment's own TRUE original prescribed exerciseId (from the
// `prescribedExerciseByAssignmentId` map recorded once at launch --
// app-plan-run-logger-ui.js's planRunLoggerLaunch, see that file's own
// correction note) -- never against the row's CURRENT exerciseId, which
// may already reflect an earlier substitution and would otherwise cause a
// genuine "change back to the original" to be mislabeled 'substituted'
// with an exerciseId that matches the prescription, which
// plan-run-model.js's planRunWorkoutContextMatchesOccurrence correctly
// rejects as a mislabeled non-substitution -- that exact rejection is
// Finding 1. Falls back to 'substituted' (never 'prescribed') if the map
// or this row's planAssignmentId is missing from it, which is the safe
// direction: a wrongly-'substituted' row with a genuinely different
// exerciseId is still Finish-valid, whereas a wrongly-'prescribed' row
// would not be.
function planRunResolveChangeExerciseOrigin(ex, newExId) {
  const cr = currentWorkout && currentWorkout.canonicalRun;
  const map = cr && cr.prescribedExerciseByAssignmentId;
  const trueExId = map ? map[ex.planAssignmentId] : undefined;
  // RECOMMENDED REPLACEMENTS: when the Run's series for this Assignment was
  // durably replaced, the exercise this Session opened with is the
  // replacement; returning to IT is 'runReplacement', and anything else --
  // including the original PLAN exercise -- is a substitution.
  const eff = cr && cr.effectiveExerciseByAssignmentId ? cr.effectiveExerciseByAssignmentId[ex.planAssignmentId] : undefined;
  if (eff !== undefined && trueExId !== undefined && eff !== trueExId) return newExId === eff ? 'runReplacement' : 'substituted';
  if (trueExId !== undefined && trueExId === newExId) return 'prescribed';
  return 'substituted';
}

// ==================== RUN-LEVEL REPLACEMENT (pending until Finish) ====================
// A "Replace for this active Run" choice is held ONLY in this open Session
// (currentWorkout.canonicalRun.pendingRunReplacements, keyed by Assignment,
// kept in the local recovery draft like every other in-progress edit). It is
// never written anywhere until a Finish commits; then the same transaction
// applies it to the Run's series. It stays valid only while this workout
// still has the replacement exercise's row for that Assignment.
function planRunPendingReplacements() {
  const cr = currentWorkout && currentWorkout.canonicalRun;
  if (!cr) return null;
  if (!cr.pendingRunReplacements || typeof cr.pendingRunReplacements !== 'object') cr.pendingRunReplacements = {};
  return cr.pendingRunReplacements;
}
// Drops any pending replacement whose row is gone (deleted, or changed back).
// Returns how many were dropped.
function planRunReconcilePendingReplacements() {
  const pend = planRunPendingReplacements();
  if (!pend) return 0;
  let dropped = 0;
  Object.keys(pend).forEach(asg => {
    const p = pend[asg];
    const hasRow = currentWorkout.exercises.some(ex => ex.origin === 'substituted' && ex.planAssignmentId === asg && ex.exerciseId === p.toExerciseId);
    if (!hasRow) { delete pend[asg]; dropped++; }
  });
  return dropped;
}
function planRunClearPendingReplacement(asg) {
  const pend = planRunPendingReplacements();
  if (pend && pend[asg]) { delete pend[asg]; return true; }
  return false;
}
// Finish package entries, in a fixed order (sorted by Rule id).
function planRunPendingReplacementsForFinish() {
  if (!planRunPendingReplacements()) return [];
  planRunReconcilePendingReplacements();
  const pend = planRunPendingReplacements();
  return Object.keys(pend).map(asg => pend[asg])
    .map(p => ({ planRuleId: p.planRuleId, toExerciseId: p.toExerciseId, amount: p.amount, unit: p.unit }))
    .sort((a, b) => (a.planRuleId < b.planRuleId ? -1 : a.planRuleId > b.planRuleId ? 1 : 0));
}
// The pending replacement whose row is `idx`, if any.
function planRunPendingReplacementForRow(idx) {
  const pend = planRunPendingReplacements();
  const ex = currentWorkout && currentWorkout.exercises[idx];
  if (!pend || !ex || ex.origin !== 'substituted') return null;
  const p = pend[ex.planAssignmentId];
  return (p && p.toExerciseId === ex.exerciseId) ? p : null;
}
// The series facts for row `idx` when Change Exercise must ask which scope
// the person means (feature build, canonical Run Session, a row bound to a
// series-linked Assignment). null otherwise -- existing behavior applies.
function planRunSeriesForRow(idx) {
  if (typeof planRecommendedReplacementsFeatureEnabled !== 'function' || !planRecommendedReplacementsFeatureEnabled()) return null;
  const cr = currentWorkout && currentWorkout.canonicalRun;
  const ex = currentWorkout && currentWorkout.exercises[idx];
  if (!cr || !ex || ex.origin === 'added' || !cr.seriesByAssignmentId) return null;
  return cr.seriesByAssignmentId[ex.planAssignmentId] || null;
}

let planRunReplaceUi = null; // { idx, newExId, series, step: 'choose'|'value', amount, error }
function planRunReplaceClose() {
  planRunReplaceUi = null;
  const el = document.getElementById('run-replace-overlay');
  if (el && el.parentNode) el.remove();
}
function planRunReplaceOpen(idx, newExId, series, startAtValue) {
  const existing = planRunPendingReplacementForRow(idx);
  planRunReplaceUi = { idx, newExId, series, step: startAtValue ? 'value' : 'choose', amount: startAtValue && existing ? String(existing.amount) : '', error: null };
  planRunReplaceRender();
}
function planRunReplaceRender() {
  const u = planRunReplaceUi;
  const old = document.getElementById('run-replace-overlay'); if (old && old.parentNode) old.remove();
  if (!u) return;
  const exData = getExercise(u.newExId);
  const name = exData ? exData.name : 'this exercise';
  const unit = appDb.unit === 'kg' ? 'kg' : 'lb';
  const kindLabel = u.series.valueKind === 'trainingMax' ? 'Training Max' : 'Working Load';
  const btn = (action, label, cls, testid, disabled) => `<button class="btn ${cls}" style="${u.step === 'choose' ? 'width:100%' : 'flex:1 1 130px;min-width:0'};white-space:normal" data-rr-action="${action}" data-testid="${testid}" ${disabled ? 'disabled' : ''}>${label}</button>`;
  let body;
  if (u.step === 'choose') {
    const canRun = u.series.hasFutureMember === true;
    body = `<h3 style="font-family:var(--font-display);font-size:20px;font-weight:800;text-transform:uppercase;margin-bottom:8px">Change to ${escapeHtml(name)}</h3>
      <p style="font-size:14px;color:var(--text2);margin-bottom:14px;line-height:1.5">This exercise is part of the Progression series “${escapeHtml(u.series.seriesName || '')}”. How long should the change last?</p>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${btn('workout', 'This workout only', 'btn-secondary', 'rr-workout-only-btn', false)}
        ${btn('run', 'Replace for this active Run', 'btn-secondary', 'rr-run-btn', !canRun)}
        ${canRun ? '' : '<div data-testid="rr-run-unavailable" style="font-size:12px;color:var(--text3)">No later Session in this Run uses this series, so there is nothing to replace beyond this workout.</div>'}
        ${btn('cancel', 'Cancel', 'btn-ghost', 'rr-cancel-btn', false)}
      </div>
      <p style="font-size:12px;color:var(--text3);margin-top:12px;line-height:1.4">“This workout only” never affects the series. “Replace for this active Run” changes this and later Sessions of this Run only (never your Program), and takes effect when this workout is finished.</p>`;
  } else {
    body = `<h3 style="font-family:var(--font-display);font-size:20px;font-weight:800;text-transform:uppercase;margin-bottom:8px">Starting ${kindLabel}</h3>
      <p style="font-size:14px;color:var(--text2);margin-bottom:10px;line-height:1.5">Enter a starting ${kindLabel} for ${escapeHtml(name)}. It is not copied from the previous exercise.</p>
      <label style="font-size:13px;display:block;margin-bottom:6px">${kindLabel} (${unit})
        <input type="number" step="any" min="0" inputmode="decimal" data-testid="rr-value-input" id="rr-value-input" value="${escapeHtml(u.amount)}" style="width:100%;margin-top:4px"></label>
      ${u.error ? `<div data-testid="rr-value-error" style="color:var(--red);font-size:13px;margin-bottom:8px">${escapeHtml(u.error)}</div>` : ''}
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:8px">
        ${btn('back', 'Cancel', 'btn-ghost', 'rr-value-cancel-btn', false)}
        ${btn('confirm', 'Confirm Replacement', 'btn-primary', 'rr-value-confirm-btn', false)}
      </div>`;
  }
  const el = document.createElement('div');
  el.id = 'run-replace-overlay';
  el.setAttribute('data-testid', 'run-replace-overlay');
  el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:300;display:flex;align-items:center;justify-content:center;padding:20px';
  el.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:22px;width:100%;max-width:360px">${body}</div>`;
  el.addEventListener('click', ev => {
    const b = ev.target.closest ? ev.target.closest('[data-rr-action]') : null;
    if (!b || b.disabled) return;
    planRunReplaceAction(b.getAttribute('data-rr-action'));
  });
  document.body.appendChild(el);
  const inp = document.getElementById('rr-value-input'); if (inp) inp.focus();
}
function planRunReplaceAction(action) {
  const u = planRunReplaceUi; if (!u || !currentWorkout) { planRunReplaceClose(); return; }
  if (action === 'cancel') { planRunReplaceClose(); return; }
  if (action === 'workout') {
    planRunReplaceClose();
    const cleared = planRunClearPendingReplacement(currentWorkout.exercises[u.idx].planAssignmentId);
    changeExTargetIdx = u.idx;
    confirmChangeExerciseApply(u.newExId);
    if (cleared) showToast('Exercise changed for this workout only. The pending Run replacement was cancelled.', 'success');
    return;
  }
  if (action === 'run') { if (u.series.hasFutureMember !== true) return; u.step = 'value'; u.error = null; planRunReplaceRender(); return; }
  if (action === 'back') { planRunReplaceClose(); return; }
  if (action === 'confirm') {
    const inp = document.getElementById('rr-value-input');
    const raw = inp ? inp.value.trim() : '';
    const amount = raw === '' ? NaN : Number(raw);
    if (!Number.isFinite(amount) || amount < 0) { u.amount = raw; u.error = 'Enter a number of 0 or more.'; planRunReplaceRender(); return; }
    const unit = appDb.unit === 'kg' ? 'kg' : 'lb';
    const row = currentWorkout.exercises[u.idx];
    const asg = row.planAssignmentId;
    const editingExisting = planRunPendingReplacementForRow(u.idx);
    planRunReplaceClose();
    if (!(editingExisting && editingExisting.toExerciseId === u.newExId)) {
      changeExTargetIdx = u.idx;
      confirmChangeExerciseApply(u.newExId);
    }
    const pend = planRunPendingReplacements();
    pend[asg] = { planRuleId: u.series.planRuleId, seriesId: u.series.seriesId, valueKind: u.series.valueKind, toExerciseId: u.newExId, amount: amount, unit: unit };
    if (planRunReconcilePendingReplacements() > 0) { showToast('The replacement row is missing, so nothing was set.', 'error'); return; }
    if (typeof awDraftSaveNow === 'function') awDraftSaveNow();
    showToast('Replacement set for this Run. It takes effect when you finish this workout.', 'success');
  }
}
function planRunEditPendingReplacement(idx) {
  const p = planRunPendingReplacementForRow(idx); const series = planRunSeriesForRow(idx);
  if (!p || !series) return;
  planRunReplaceOpen(idx, p.toExerciseId, series, true);
}
function planRunCancelPendingReplacement(idx) {
  const p = planRunPendingReplacementForRow(idx);
  if (!p) return;
  planRunClearPendingReplacement(currentWorkout.exercises[idx].planAssignmentId);
  if (typeof awDraftSaveNow === 'function') awDraftSaveNow();
  showToast('Run replacement cancelled. This change now applies to this workout only.', 'success');
}
// WORKOUT-FLEXIBILITY CORRECTION ROUND 2: a single fresh, blank,
// model-valid supplemental Set (plan-run-model.js's own
// isSupplemental:true/planSetId:null shape -- never a fabricated or
// reused prescribed identity, and exempt from the cross-row
// claimedSetIds double-claim guard for exactly that reason) used as the
// replacement row's starting Set whenever there is no never-performed
// remainder left to carry over (Finding 3).
function planRunFreshSupplementalSet() {
  return { planSetId: null, weight: '', reps: '', time: '', rpe: '', completed: false, isPR: false, isNew1RM: false, isSupplemental: true };
}
function confirmChangeExercise(newExId) {
  if (changeExTargetIdx === null || !currentWorkout) return;
  // RECOMMENDED REPLACEMENTS: a row bound to a Progression series asks which
  // scope the person means; nothing is applied or preselected until they
  // choose. Returning to the exercise the series uses now needs no question
  // (it simply restores the row, and cancels any pending replacement).
  const sIdx = changeExTargetIdx;
  const series = planRunSeriesForRow(sIdx);
  const sRow = currentWorkout.exercises[sIdx];
  if (series && sRow && newExId !== sRow.exerciseId) {
    if (newExId === series.activeExerciseId) {
      const cleared = planRunClearPendingReplacement(sRow.planAssignmentId);
      confirmChangeExerciseApply(newExId);
      if (cleared) showToast('Original exercise restored. The pending Run replacement was cancelled.', 'success');
      return;
    }
    closeModal('modal-ex-browser');
    planRunReplaceOpen(sIdx, newExId, series, false);
    return;
  }
  confirmChangeExerciseApply(newExId);
}
function confirmChangeExerciseApply(newExId) {
  if (changeExTargetIdx === null || !currentWorkout) return;
  const idx = changeExTargetIdx;
  const ex = currentWorkout.exercises[idx];
  // WORKOUT-FLEXIBILITY CORRECTION, amended ROUND 2 per the independent
  // review's Findings 1-3 (see implementation-report.md Round 2 section
  // for the full trace). Change Exercise is restored for a canonical Run
  // Session, using the honest `origin` label from plan-run-model.js
  // instead of a blanket refusal. Four cases, by the row's current state:
  //   1. origin === 'added', no genuine performance yet -- change freely
  //      in place, exactly like an ordinary workout (unchanged from Round
  //      1).
  //   2. origin === 'added', WITH genuine recorded performance (Finding 2
  //      remediation) -- that performed work is never reassigned to a
  //      different exercise's identity. Split: the original row keeps
  //      only the performed sets, under the exercise actually performed;
  //      a fresh 'added' row is inserted for the newly selected exercise,
  //      carrying the never-performed remainder (or one fresh blank
  //      supplemental Set if none remain).
  //   3. origin is 'prescribed'/'substituted', no genuine performance yet
  //      -- relabel this SAME row in place, using
  //      planRunResolveChangeExerciseOrigin (Finding 1 remediation) to
  //      decide 'prescribed' vs. 'substituted' by comparing against the
  //      Assignment's TRUE original prescription, never the row's own
  //      prior exerciseId.
  //   4. origin is 'prescribed'/'substituted', WITH genuine recorded
  //      performance -- split exactly as in Round 1, except: (a) the new
  //      row's origin is likewise resolved via
  //      planRunResolveChangeExerciseOrigin rather than hardcoded
  //      'substituted' (Finding 1), and (b) when every Set was already
  //      performed and nothing remains to carry over, the new row still
  //      gets one fresh blank supplemental Set instead of being refused
  //      outright (Finding 3 remediation -- the prior "nothing left to
  //      swap" refusal is removed).
  if (planRunLoggerIsCanonicalRunSession()) {
    // GUARD: plan-run-model.js's planRunWorkoutContextMatchesOccurrence
    // requires a 'substituted' row's exerciseId to actually DIFFER from
    // the plan's own prescribed exerciseId for that Assignment (that's
    // how it tells a real swap apart from a mislabeled non-swap). Picking
    // the same exercise again from the browser (a no-op) is not a real
    // substitution, so for a prescribed/substituted row it's declined
    // here rather than silently creating a row that would fail that
    // check at Finish. An 'added' row has no such constraint.
    if (ex.origin !== 'added' && newExId === ex.exerciseId) {
      closeModal('modal-ex-browser');
      return;
    }
    if (ex.origin === 'added') {
      const performedSetsAdded = ex.sets.filter(planRunSetHasRecordedPerformance);
      const remainingSetsAdded = ex.sets.filter(s => !planRunSetHasRecordedPerformance(s));
      if (performedSetsAdded.length === 0) {
        // Case 1: nothing performed yet on this added row -- change in
        // place, unchanged from Round 1.
        ex.exerciseId = newExId;
        ex.perfVideos = [];
        closeModal('modal-ex-browser'); renderWorkoutExercises(); showToast('Exercise changed', 'success');
        return;
      }
      // Case 2 (Finding 2 remediation): genuine performed work exists on
      // this added row. Never relabel it under the newly selected
      // exercise's identity -- keep it, under the exercise it was
      // actually performed as, and create a brand-new added row for the
      // replacement.
      ex.sets = performedSetsAdded;
      const newAddedRow = {
        exerciseId: newExId, planAssignmentId: null, planPrescriptionId: null, origin: 'added',
        sets: remainingSetsAdded.length > 0
          ? remainingSetsAdded.map(() => planRunFreshSupplementalSet())
          : [planRunFreshSupplementalSet()],
        perfVideos: []
      };
      currentWorkout.exercises.splice(idx + 1, 0, newAddedRow);
      closeModal('modal-ex-browser'); renderWorkoutExercises(); showToast('Exercise changed. Completed sets were kept under the original exercise.', 'success');
      return;
    }
    const performedSets = ex.sets.filter(planRunSetHasRecordedPerformance);
    const remainingSets = ex.sets.filter(s => !planRunSetHasRecordedPerformance(s));
    if (performedSets.length === 0) {
      // Case 3: nothing performed yet on this row -- relabel in place,
      // correctly identifying whether this is a genuine substitution or a
      // return to the Assignment's own true prescribed exercise (Finding
      // 1 remediation).
      ex.exerciseId = newExId;
      ex.origin = planRunResolveChangeExerciseOrigin(ex, newExId);
      ex.perfVideos = [];
      closeModal('modal-ex-browser'); renderWorkoutExercises(); showToast('Exercise changed', 'success');
      return;
    }
    // Case 4: split. Original row keeps only the performed sets, under
    // the exercise it was actually performed as. Finding 3 remediation:
    // when nothing remains unperformed, the replacement row still gets
    // one fresh blank supplemental Set (model-valid; see
    // planRunFreshSupplementalSet's own note) rather than being refused.
    ex.sets = performedSets;
    const newRow = {
      exerciseId: newExId,
      planAssignmentId: ex.planAssignmentId,
      planPrescriptionId: ex.planPrescriptionId,
      origin: planRunResolveChangeExerciseOrigin(ex, newExId),
      sets: remainingSets.length > 0
        ? remainingSets.map(s => ({ planSetId: s.planSetId, weight: '', reps: '', time: '', rpe: '', completed: false, isPR: false, isNew1RM: false, isSupplemental: s.isSupplemental === true }))
        : [planRunFreshSupplementalSet()],
      perfVideos: []
    };
    currentWorkout.exercises.splice(idx + 1, 0, newRow);
    closeModal('modal-ex-browser'); renderWorkoutExercises(); showToast('Exercise changed. Completed sets were kept under the original exercise.', 'success');
    return;
  }
  ex.exerciseId = newExId;
  ex.perfVideos = [];
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
    actualDescription: `Actual: ${actual !== null ? actual : '—'} ${unitLabel}`
  };
}

// Evaluates one progression-enabled exercise prescription against what was logged.
// loggedExercise: an entry from workout.exercises (Logger format)
// prescribedExercise: the matching entry from the active instance's session.exercises (Plan format)
// active: the active program instance — needed to look up the current Training Max
//         and to check whether a future %TM occurrence of this exercise even exists.
function evaluateExerciseProgression(loggedExercise, prescribedExercise, active) {
  const prog = prescribedExercise.progression || {};
  const evalType = prog.evaluationType || 'strict';
  const adjustmentType = prog.adjustmentType || 'addLoad';
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
      adjustmentType,
      status: 'not_evaluable',
      message: evalResult.message || 'No evaluable rep/time target found.'
    };
  }

  const base = {
    exerciseId: prescribedExercise.exerciseId,
    exerciseName,
    evaluationType: evalType,
    adjustmentType,
    status: evalResult.status,
    targetDescription: evalResult.targetDescription || '',
    actualDescription: evalResult.actualDescription || '',
    failBehavior: prog.failBehavior || 'repeat'
  };

  if (adjustmentType === 'increaseTM') {
    const rawTM = parseFloat(prog.tmIncrease);
    const tmIncrease = (!isNaN(rawTM) && rawTM > 0) ? rawTM : (appDb.unit === 'kg' ? 2.5 : 5);
    const currentTM = getActiveTrainingMax(active, prescribedExercise.exerciseId);
    const hasFutureTM = hasFuturePercentTMOccurrence(active, prescribedExercise.exerciseId);
    const canSuggestTMIncrease = evalResult.status === 'passed' && currentTM != null && hasFutureTM;

    let message;
    if (evalResult.status === 'passed') {
      if (currentTM == null) message = 'Target met, but no active Training Max is available.';
      else if (!hasFutureTM) message = 'Target met, but no future %TM prescription is available to update.';
      else message = 'Target met. Training Max increase can be suggested.';
    } else {
      message = 'Target not met. Repeat prescription.';
    }

    return {
      ...base,
      tmIncrease,
      currentTM,
      suggestedTM: currentTM != null ? Math.round((currentTM + tmIncrease) * 100) / 100 : null,
      canSuggestTMIncrease,
      message
    };
  }

  // addLoad: an exercise's blank fixed-load sets resolve via Active Working Load;
  // an exercise with at least one EXPLICIT numeric fixed-load set keeps using the
  // original, unchanged behavior (a numeric prescription is a deliberate absolute
  // value and takes priority over the newer Working Load path for suggestion purposes).
  const hasExplicitFixed = prescribedSets.some(s => s.loadType === 'fixed' && s.weight !== '' && s.weight != null && !isNaN(parseFloat(s.weight)));
  const hasBlankFixed = prescribedSets.some(isBlankFixedSet);
  const rawLoad = parseFloat(prog.loadIncrease);
  const loadIncrease = (!isNaN(rawLoad) && rawLoad > 0) ? rawLoad : (appDb.unit === 'kg' ? 2.5 : 5);

  if (!hasExplicitFixed && hasBlankFixed) {
    const currentWorkingLoad = getActiveWorkingLoad(active, prescribedExercise.exerciseId);
    const hasFutureWL = hasFutureWorkingLoadOccurrence(active, prescribedExercise.exerciseId);
    const canSuggestLoadIncrease = evalResult.status === 'passed' && currentWorkingLoad != null && hasFutureWL;

    let wlMessage;
    if (evalResult.status === 'passed') {
      if (currentWorkingLoad == null) wlMessage = 'Target met, but no Active Working Load is available.';
      else if (!hasFutureWL) wlMessage = 'Target met, but no future Working Load prescription is available.';
      else wlMessage = 'Target met. Working Load increase can be suggested.';
    } else {
      wlMessage = 'Target not met. Repeat Working Load.';
    }

    return {
      ...base,
      loadReferenceType: 'workingLoad',
      loadIncrease,
      currentWorkingLoad,
      suggestedWorkingLoad: currentWorkingLoad != null ? Math.round((currentWorkingLoad + loadIncrease) * 100) / 100 : null,
      hasFutureWorkingLoadOccurrence: hasFutureWL,
      canSuggestLoadIncrease,
      message: wlMessage
    };
  }

  // Load increases can only ever be suggested against a fixed-load set — this does
  // not apply anything, it only records whether a future build would be able to.
  const canSuggestLoadIncrease = hasExplicitFixed;

  let message;
  if (evalResult.status === 'passed') {
    message = canSuggestLoadIncrease
      ? 'Target met. Load increase can be suggested.'
      : 'Target met, but no fixed-load set is available for load increase.';
  } else {
    message = 'Target not met. Repeat prescription.';
  }

  return {
    ...base,
    loadReferenceType: 'explicitFixed',
    loadIncrease,
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
  // V1 safeguard: only one actionable Training Max / Working Load increase per
  // exerciseId per workout, even if the same exercise appears more than once in
  // the session.
  const seenActionableTMExerciseIds = new Set();
  const seenActionableWLExerciseIds = new Set();
  (session.exercises || []).forEach(sessEx => {
    if (!sessEx.progression || !sessEx.progression.enabled) return;
    const loggedEx = (workout.exercises || []).find(e => e.exerciseId === sessEx.exerciseId);
    if (!loggedEx) return; // exercise wasn't logged this session — nothing to evaluate
    const result = evaluateExerciseProgression(loggedEx, sessEx, activeProgram);
    if (result.adjustmentType === 'increaseTM' && result.canSuggestTMIncrease) {
      if (seenActionableTMExerciseIds.has(result.exerciseId)) {
        console.warn('[progression] duplicate increaseTM suggestion for', result.exerciseId, '— only the first is actionable this workout.');
        result.canSuggestTMIncrease = false;
        result.message = 'Target met, but a Training Max increase was already suggested for this exercise this workout.';
      } else {
        seenActionableTMExerciseIds.add(result.exerciseId);
      }
    }
    if (result.loadReferenceType === 'workingLoad' && result.canSuggestLoadIncrease) {
      if (seenActionableWLExerciseIds.has(result.exerciseId)) {
        console.warn('[progression] duplicate Working Load suggestion for', result.exerciseId, '— only the first is actionable this workout.');
        result.canSuggestLoadIncrease = false;
        result.message = 'Target met, but a Working Load increase was already suggested for this exercise this workout.';
      } else {
        seenActionableWLExerciseIds.add(result.exerciseId);
      }
    }
    results.push(result);
  });
  return results;
}

// ==================== START WORKOUT ====================
function startNewWorkout(programId, microcycleIdx, sessionIdx) {
  // STALE-TIMER / OWNERSHIP-TRANSITION DEFENSE (this round, Round 8): see
  // finalizeStartActiveWorkout's own comment above -- same real gap, same
  // fix, cleared before the replacement just below.
  if (awDraftBlocksOpeningWorkout()) return;
  clearAllPRDebounceTimers();
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
  renderWorkoutExercises(); showPage('page-log'); startWorkoutTimer(); awDraftBeginForCurrentWorkout();
}
function getProgramSessionName(progId, mi, si) { const prog = appDb.programs.find(p => p.id === progId); if (!prog) return ''; const sess = prog.microcycles[mi].sessions[si]; return `Week ${mi+1} · ${sess.name || `Day ${si+1}`}`; }

// ==================== RENDER WORKOUT ====================
function renderWorkoutExercises() {
  const c = document.getElementById('workout-exercises');
  // Duplicate weight-PR correction: every full render (start, recovery,
  // split/restore/substitute/delete exercise, reorder, ...) shows PR badges
  // from the one first-new-maximum rule, never from stale per-set flags.
  if (currentWorkout) applyWorkoutPRFlags(currentWorkout);
  // RECOMMENDED REPLACEMENTS: a pending Run-level replacement whose row was
  // deleted or changed away is cancelled here -- never left as hidden state.
  if (currentWorkout && currentWorkout.canonicalRun && currentWorkout.canonicalRun.pendingRunReplacements && planRunReconcilePendingReplacements() > 0) {
    showToast('The pending Run replacement was cancelled.', '');
  }
  if (!currentWorkout?.exercises.length) {
    c.innerHTML = '<div style="text-align:center;padding:30px 0;color:var(--text3);font-size:15px">Add exercises below to begin logging</div>';
    if (typeof awDraftSaveNow === 'function') awDraftSaveNow(); // ACTIVE-WORKOUT RECOVERY (review finding 2): deleting the last exercise is stored at once
    return;
  }
  c.innerHTML = currentWorkout.exercises.map((ex, i) => buildExerciseBlock(ex, i)).join('');
  currentWorkout.exercises.forEach((ex, i) => ex.sets.forEach((s, si) => attachSwipeToSet(i, si)));
  if (typeof awDraftSaveNow === 'function') awDraftSaveNow(); // ACTIVE-WORKOUT RECOVERY: structural changes re-render through here
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
  } else if (currentWorkout.activeProgramId) {
    const active = appDb.programs.find(p => p.id === currentWorkout.activeProgramId);
    if (active && hasActiveTMTarget(idx)) {
      const tmVal = getActiveTrainingMax(active, ex.exerciseId);
      if (tmVal != null) metaBadgesHtml += `<span class="ex-meta-badge" style="cursor:pointer" onclick="openActiveTMEditModal(${idx})">TM: ${tmVal}</span>`;
    }
    if (active && hasActive1RMTarget(idx)) {
      const ormVal = getActiveOneRepMax(active, ex.exerciseId);
      if (ormVal != null) metaBadgesHtml += `<span class="ex-meta-badge" style="cursor:pointer" onclick="openActive1RMEditModal(${idx})">1RM: ${ormVal}</span>`;
    }
    if (active && hasWorkingLoadTarget(idx)) {
      const wlVal = getActiveWorkingLoad(active, ex.exerciseId);
      if (wlVal != null) metaBadgesHtml += `<span class="ex-meta-badge" style="cursor:pointer" onclick="openActiveWorkingLoadEditModal(${idx})">WL: ${wlVal}</span>`;
    }
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
  } else if (currentWorkout.activeProgramId) {
    const active = appDb.programs.find(p => p.id === currentWorkout.activeProgramId);
    if (active && hasActiveTMTarget(idx)) {
      const tmVal = getActiveTrainingMax(active, ex.exerciseId);
      if (tmVal == null) {
        tmControls += `<div style="margin-bottom:8px"><span style="font-size:12px;color:var(--red);font-family:var(--font-display);font-weight:600;letter-spacing:0.04em">No Training Max set</span><button class="btn btn-ghost btn-sm" style="font-size:11px;padding:4px 9px;margin-left:8px" onclick="openActiveTMEditModal(${idx})">Set TM</button></div>`;
      }
    }
    if (active && hasActive1RMTarget(idx)) {
      const ormVal = getActiveOneRepMax(active, ex.exerciseId);
      if (ormVal == null) {
        tmControls += `<div style="margin-bottom:8px"><span style="font-size:12px;color:var(--red);font-family:var(--font-display);font-weight:600;letter-spacing:0.04em">No 1RM set</span><button class="btn btn-ghost btn-sm" style="font-size:11px;padding:4px 9px;margin-left:8px" onclick="openActive1RMEditModal(${idx})">Set 1RM</button></div>`;
      }
    }
    if (active && hasWorkingLoadTarget(idx)) {
      const wlVal = getActiveWorkingLoad(active, ex.exerciseId);
      if (wlVal == null) {
        tmControls += `<div style="margin-bottom:8px"><span style="font-size:12px;color:var(--red);font-family:var(--font-display);font-weight:600;letter-spacing:0.04em">No Working Load set</span><button class="btn btn-ghost btn-sm" style="font-size:11px;padding:4px 9px;margin-left:8px" onclick="openActiveWorkingLoadEditModal(${idx})">Set Working Load</button></div>`;
      }
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
  // WORKOUT-FLEXIBILITY CORRECTION: the Delete control used to be hidden
  // for a canonical Run Session's own prescribed Sets (isSupplemental !==
  // true), because removeSet refused to act on them. removeSet now
  // allows removing any Set (see its own comment), so the control is
  // shown unconditionally -- every Set in every workout, Program Run or
  // ordinary, gets a working Delete control.
  return ex.sets.map((s, si) => {
    const inputCls = s.autoFilled ? 'set-input auto-filled' : 'set-input';
    const repCls   = (s.autoFilled && s.autoType === 'rep_goal') ? 'set-input auto-filled' : 'set-input';
    const wrapCls  = s.completed ? 'set-row-wrap completed' : 'set-row-wrap';
    const canRemoveThisSet = true;
    // EXTRA-LABEL REMOVAL CORRECTION: the supplemental-set correction
    // previously rendered a small, purely visual "EXTRA" tag on any Set
    // the person added beyond the Program Run's own prescription
    // (isSupplemental:true). Per the owner's explicit direction, that tag
    // is removed from every user-facing presentation -- it added visual
    // noise, told the person nothing useful, and competed with the real
    // PR/estimated-1RM badges for the same small space. The underlying
    // isSupplemental:true metadata is NOT removed (addSet in this same
    // file still stamps it, exactly as before) -- only this visual tag is
    // gone. A Set the person added now looks and behaves like an ordinary
    // Set in every way the person can see.
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
      ${canRemoveThisSet ? `<div class="set-delete-btn" onclick="removeSet(${exIdx},${si})">Delete</div>` : ''}
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
  // WORKOUT-FLEXIBILITY CORRECTION: consistent with buildSetsHTML's own
  // Delete control, above, swipe-to-reveal-Delete now works for every
  // Set in every workout, Program Run or ordinary -- there is no longer a
  // case where the control underneath is absent.
  let startX = 0, currentX = 0, swiping = false;
  wrap.addEventListener('touchstart', e => { startX = e.touches[0].clientX; currentX = startX; swiping = true; }, { passive: true });
  wrap.addEventListener('touchmove', e => { if (!swiping) return; currentX = e.touches[0].clientX; const diff = startX - currentX; row.style.transform = diff > 0 ? `translateX(${-Math.min(diff,70)}px)` : 'translateX(0)'; }, { passive: true });
  wrap.addEventListener('touchend', () => { if (!swiping) return; swiping = false; row.style.transform = (startX - currentX) > 60 ? 'translateX(-70px)' : 'translateX(0)'; });
}

// ==================== SET OPERATIONS ====================
// SYNCHRONOUS DERIVED-FLAG RECOMPUTATION (this round, Round 8). Finding 2
// (malformed numeric gating): every prior round's own gate was plain
// truthiness (`s.weight && s.reps`) -- truthy for `Infinity`, `"Infinity"`,
// and any other non-empty-but-malformed value, which is not the same as
// "a valid finite positive number". `coercePositiveFiniteNumber` is the
// one place that decides whether a raw, possibly-string, possibly-garbage
// input value counts as real evidence at all.
function coercePositiveFiniteNumber(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = +v;
  return (Number.isFinite(n) && n > 0) ? n : null;
}
// ONE CONSISTENT RULE (this round, Round 8): `onSetChecked` and
// `checkSetPR` previously each carried their OWN copy of the same
// "completed && weight && reps" truthiness gate and their own copy of the
// same two comparison lines -- two subtly-independent places that could
// drift. This is now the single synchronous source of truth both of them
// (and every pre-save recompute -- see recomputeAllSetPRFlags below) route
// through. It never touches the DOM and never schedules anything -- it is
// a pure function of (set, exerciseId, excludeId) that always returns a
// definite `{isPR, isNew1RM}` pair, explicitly false whenever the Set is
// not genuinely completed and valid, exactly matching the required
// invariant: isPR/isNew1RM may be true only when the set is completed, its
// required values are valid finite positive numbers, and a synchronous
// comparison against genuine historical performance currently shows the
// flag is deserved. `excludeId` is passed straight through to
// getBestWeight/getBest1RM, respecting the exact same self-exclusion
// behavior those two already-corrected functions have always had.
function computeSetPRFlags(s, exerciseId, excludeId) {
  const completed = s && s.completed === true;
  const weight = completed ? coercePositiveFiniteNumber(s.weight) : null;
  const reps = completed ? coercePositiveFiniteNumber(s.reps) : null;
  if (!completed || weight === null || reps === null) {
    return { isPR: false, isNew1RM: false };
  }
  return {
    isNew1RM: calc1RM(weight, reps) > getBest1RM(exerciseId, excludeId),
    isPR: weight > getBestWeight(exerciseId, excludeId)
  };
}
// FIRST-NEW-MAXIMUM PR RULE (duplicate weight-PR correction). A weight PR
// marks the MOMENT a completed set establishes a new maximum weight -- not
// every later repetition of that maximum. computeSetPRFlags above still
// answers the per-set question "is this set heavier than every OTHER
// saved workout?" (its isNew1RM likewise for estimated 1RM). Its
// isPR answer alone, though, cannot see earlier sets of the SAME workout,
// which is why four completed 70 lb sets each used to show "PR: 70". The
// rule below is the ONE definition of which sets are weight PRs; every
// reader goes through it:
//   - Logger (live badges, debounced recompute, Finish/pre-save, recovered
//     drafts, both ordinary and Program Run): applyWorkoutPRFlags.
//   - History (card PR totals, expanded per-set badges, Export):
//     storedWorkoutPRSets -- read-only, no write, no migration.
//
// prSetWeight -- the weight a set contributes, or null when it does not
// take part at all: unchecked, blank, malformed, zero or non-finite
// weight/reps never participate (the same gate computeSetPRFlags uses).
function prSetWeight(s) {
  if (!s || s.completed !== true) return null;
  const weight = coercePositiveFiniteNumber(s.weight);
  const reps = coercePositiveFiniteNumber(s.reps);
  return (weight === null || reps === null) ? null : weight;
}
// One ordered set list per exercise, in visible workout order. Several
// truthful rows for the same exercise (e.g. a split/restored Program Run
// exercise, or an added row) form ONE sequence, so PR qualification is
// never restarted per row.
function workoutExerciseSetSequences(workout) {
  const seqs = new Map();
  ((workout && workout.exercises) || []).forEach(e => {
    if (!e || !Array.isArray(e.sets)) return;
    if (!seqs.has(e.exerciseId)) seqs.set(e.exerciseId, []);
    e.sets.forEach(s => seqs.get(e.exerciseId).push(s));
  });
  return seqs;
}
// THE RULE. Walk the sequence keeping a running maximum that starts at
// `startingMax`. A participating set strictly above the running maximum
// is a PR and raises it; an equal or lower set is not. With
// `requireStoredFlag`, a set must ALSO already carry a stored isPR:true
// (History's read-side mode -- see storedWorkoutPRSets).
// DUPLICATE E1RM CORRECTION: the walk now takes WHAT it measures
// (valueOf) and which stored flag History requires (storedFlagKey), so the
// estimated-1RM badge uses this same machinery instead of a second system.
function firstNewMaximumSets(orderedSets, valueOf, startingMax, storedFlagKey) {
  const hits = new Set();
  let runningMax = startingMax;
  orderedSets.forEach(s => {
    const v = valueOf(s);
    if (v === null || !(v > runningMax)) return;
    if (!storedFlagKey || s[storedFlagKey] === true) hits.add(s);
    runningMax = v;
  });
  return hits;
}
// Weight PRs -- unchanged behavior (same gate, same comparison).
function firstNewMaximumPRSets(orderedSets, startingMax, requireStoredFlag) {
  return firstNewMaximumSets(orderedSets, prSetWeight, startingMax, requireStoredFlag ? 'isPR' : null);
}
// Estimated-1RM badges (isNew1RM): the set's E1RM by the existing calc1RM
// (same formula/setting, same rounding), over exactly the same
// participation gate as weight PRs and computeSetPRFlags -- completed,
// positive finite weight and reps. Anything else never takes part.
function prSetE1RM(s) {
  const weight = prSetWeight(s);
  return weight === null ? null : calc1RM(weight, coercePositiveFiniteNumber(s.reps));
}
function firstNewMaximumE1RMSets(orderedSets, startingMax, requireStoredFlag) {
  return firstNewMaximumSets(orderedSets, prSetE1RM, startingMax, requireStoredFlag ? 'isNew1RM' : null);
}
// Logger: the running maximum starts at the genuine historical best from
// every OTHER saved workout -- exactly getBestWeight(exerciseId, workout.id),
// the same self-excluding comparison the app has always used. Sets isPR on
// every set of the workout. DUPLICATE E1RM CORRECTION: isNew1RM is settled
// here too, by the same walk over the set's estimated 1RM, starting at the
// existing self-excluding getBest1RM(exerciseId, workout.id).
function applyWorkoutPRFlags(workout) {
  if (!workout || !Array.isArray(workout.exercises)) return;
  const prs = new Set();
  const e1rms = new Set();
  workoutExerciseSetSequences(workout).forEach((sets, exerciseId) => {
    firstNewMaximumPRSets(sets, getBestWeight(exerciseId, workout.id), false).forEach(s => prs.add(s));
    firstNewMaximumE1RMSets(sets, getBest1RM(exerciseId, workout.id), false).forEach(s => e1rms.add(s));
  });
  workout.exercises.forEach(e => (e.sets || []).forEach(s => { s.isPR = prs.has(s); s.isNew1RM = e1rms.has(s); }));
}
// History (read-only): which stored sets display/count as a PR. A stored
// isPR:true already means "heavier than the earlier best when it was
// saved", so applying the same walk from 0 and keeping only sets that
// still carry that stored flag gives exactly the Logger's answer --
// stored && weight > every earlier participating set in this workout.
// Older workouts saved with duplicate flags therefore show and count one
// PR per new maximum. This only ever hides a stored flag, never adds one,
// and never writes.
function storedWorkoutPRSets(workout) {
  const prs = new Set();
  workoutExerciseSetSequences(workout).forEach(sets => {
    firstNewMaximumPRSets(sets, 0, true).forEach(s => prs.add(s));
  });
  return prs;
}
// DUPLICATE E1RM CORRECTION -- History/Export (read-only): the same
// read-side normalization for stored isNew1RM flags. A stored true means
// "estimated 1RM above the earlier best when saved"; keeping it only where
// the set's E1RM also beats every earlier participating set of that
// exercise in this workout gives the Logger's answer. Only ever hides a
// stored flag, never adds one, never writes.
function storedWorkoutNew1RMSets(workout) {
  const hits = new Set();
  workoutExerciseSetSequences(workout).forEach(sets => {
    firstNewMaximumE1RMSets(sets, 0, true).forEach(s => hits.add(s));
  });
  return hits;
}
// Logger badge refresh: one set's PR/1RM badge area, exactly as the
// previous per-set patch did (same HTML, same grid-column handling).
function patchSetBadges(exIdx, si, s) {
  const badgesEl = document.getElementById(`set-badges-${exIdx}-${si}`);
  if (!badgesEl) return;
  const html = buildSetBadgesHtml(s);
  badgesEl.innerHTML = html;
  const rowEl = document.getElementById(`set-row-${exIdx}-${si}`);
  if (rowEl && html && !rowEl.style.gridTemplateColumns.includes('auto')) {
    rowEl.style.gridTemplateColumns = rowEl.style.gridTemplateColumns + ' auto';
  }
}
// After any change that can move a PR (check/uncheck, debounced weight/
// reps recompute, add/delete set, PR set), re-apply the rule to the whole
// current workout and refresh every visible badge -- a change to one set
// can move the PR to a set in another row of the same exercise.
function refreshCurrentWorkoutPRBadges() {
  if (!currentWorkout) return;
  applyWorkoutPRFlags(currentWorkout);
  currentWorkout.exercises.forEach((ex, exIdx) => (ex.sets || []).forEach((s, si) => patchSetBadges(exIdx, si, s)));
}
// SYNCHRONOUS PRE-SAVE RECOMPUTATION (this round, Round 8). Called
// immediately before each real persistence path serializes or saves a
// workout (see finishWorkout's two call sites and
// finishCanonicalRunWorkout, app-plan-run-logger-ui.js) -- never merely
// checks whether the flags already in memory look structurally plausible,
// genuinely recalculates whether each one is currently deserved, using the
// exact same computeSetPRFlags every live edit uses. This closes Finding 1
// (the save-before-debounce race): whatever a pending 400ms timer has or
// hasn't gotten around to yet, by the time any real save actually happens
// every Set's own isPR/isNew1RM already reflects its CURRENT weight/reps/
// completed state, not a value from before the most recent edit.
function recomputeAllSetPRFlags(workout) {
  if (!workout || !Array.isArray(workout.exercises)) return;
  workout.exercises.forEach(ex => {
    (ex.sets || []).forEach(s => {
      const flags = computeSetPRFlags(s, ex.exerciseId, workout.id);
      s.isPR = flags.isPR;
      s.isNew1RM = flags.isNew1RM;
    });
  });
  // Duplicate weight-PR correction: isPR is then settled by the one
  // first-new-maximum rule, so what is saved is exactly what the Logger
  // shows. DUPLICATE E1RM CORRECTION: isNew1RM is settled the same way.
  applyWorkoutPRFlags(workout);
}
// STALE-TIMER / OWNERSHIP-TRANSITION DEFENSE (this round, Round 8, Finding
// 3). `prDebounceTimers` is keyed only by the string `${exIdx}-${setIdx}`
// -- it always has been, and still is, because that key is still the
// simplest way to debounce repeated edits to the SAME box. The problem
// this round closes is what happens to an already-scheduled timer when
// `currentWorkout` is replaced or nulled before it fires: audited every
// real ownership-transition site in this file and in
// app-plan-run-logger-ui.js (startNewWorkout, finalizeStartActiveWorkout,
// editHistoricalWorkout, finishWorkout's two save branches, cancelWorkout,
// planRunLoggerLaunch, the canonical Finish-commit path, and the
// sign-out reset) -- none of them cleared a pending timer before this
// round. This function is called at every one of those sites. It is a
// genuine clear, not merely a best-effort hint: any timer still pending at
// that moment is cancelled and its entry removed, so it can never fire at
// all, on any workout. The SECOND, independent backstop -- binding each
// still-scheduled timer to the exact workout id and exact Set object it
// was scheduled for, so even a timer this function somehow failed to
// reach is a safe no-op rather than a mutation of the wrong state -- lives
// in updateSet/checkSetPR immediately below.
function clearAllPRDebounceTimers() {
  Object.keys(prDebounceTimers).forEach(key => {
    const entry = prDebounceTimers[key];
    if (entry && entry.timer) clearTimeout(entry.timer);
    delete prDebounceTimers[key];
  });
}
function updateSet(exIdx, setIdx, field, val) {
  if (!currentWorkout) return;
  const s = currentWorkout.exercises[exIdx].sets[setIdx];
  s[field] = val;
  awDraftSaveSoon(); // ACTIVE-WORKOUT RECOVERY: typing (short debounce)
  if (field === 'weight') s.autoFilled = false;
  const key = `${exIdx}-${setIdx}`;
  if (prDebounceTimers[key] && prDebounceTimers[key].timer) clearTimeout(prDebounceTimers[key].timer);
  // TIMER-OWNERSHIP CORRECTION (this round, Round 8, Finding 3): this
  // pending recompute is bound, at the moment it is scheduled, to the
  // exact workout id and the exact Set OBJECT it was scheduled for --
  // never merely to the `exIdx-setIdx` string these are still keyed by.
  // If Finish/Cancel/navigation/a brand-new workout replaces
  // `currentWorkout`, or this same index later holds a different Set
  // object (e.g. a new workout happens to reuse the same position), the
  // callback below detects the mismatch and does nothing at all -- it can
  // never read or mutate a workout or Set it was not scheduled for, even
  // though `clearAllPRDebounceTimers` (called at every real
  // ownership-transition site) should already have cancelled it outright
  // before that could happen. This is the second, independent layer, not
  // a replacement for the first.
  const scheduledWorkoutId = currentWorkout.id;
  const scheduledSetRef = s;
  const timerHandle = setTimeout(() => checkSetPR(exIdx, setIdx, scheduledWorkoutId, scheduledSetRef), 400);
  prDebounceTimers[key] = { timer: timerHandle, workoutId: scheduledWorkoutId, setRef: scheduledSetRef };
}
function checkSetPR(exIdx, setIdx, scheduledWorkoutId, scheduledSetRef) {
  if (!currentWorkout) return;
  // Ownership check (see updateSet's own comment above). A direct call
  // with no scheduledWorkoutId/scheduledSetRef (every existing direct call
  // site in this codebase and its own test suite calls checkSetPR this
  // way, 2-argument form) skips this check entirely and behaves exactly as
  // before -- this guard exists only to protect the DEBOUNCED path against
  // acting on a workout/Set it was not scheduled for.
  if (scheduledWorkoutId !== undefined && currentWorkout.id !== scheduledWorkoutId) return;
  const ex = currentWorkout.exercises[exIdx];
  const s = ex && ex.sets[setIdx];
  if (!s) return;
  if (scheduledSetRef !== undefined && s !== scheduledSetRef) return;
  // ONE CONSISTENT RULE (this round): routed through the single
  // computeSetPRFlags helper -- see its own comment above. This function
  // no longer carries its own copy of the completed/weight/reps gate or
  // the two comparison lines; onSetChecked (below) uses the exact same
  // helper, so the two can never again drift into subtly different rules.
  const flags = computeSetPRFlags(s, ex.exerciseId, currentWorkout.id);
  s.isPR = flags.isPR;
  s.isNew1RM = flags.isNew1RM;
  // Duplicate weight-PR correction: isPR for EVERY set is re-settled by the
  // first-new-maximum rule and every badge refreshed (this edit can move
  // the PR to or from another set). Includes this set's own badges.
  refreshCurrentWorkoutPRBadges();
}
// PERSISTENCE-BOUNDARY DEFENSE (this round): an independent backstop for
// the ordinary (non-Program-Run) Finish/Edit-save path -- see
// finishWorkout below for where this is applied, and
// app-plan-run-logger-ui.js's planRunLoggerBuildPersistedSet for the
// equivalent backstop on the canonical Program Run path. isPR/isNew1RM
// must never be persisted true for a Set that is not completed and does
// not genuinely carry the values its own calculation requires (isPR
// needs a real positive weight; isNew1RM additionally needs real reps),
// regardless of how an unanticipated code path or stale in-memory state
// might otherwise have left them. This never alters any other field on
// the Set -- entered weight/reps/time/rpe/completed and all identity
// fields are left exactly as they are.
function sanitizeSetPRFlags(s) {
  if (!(s.completed === true && s.weight && s.reps)) {
    s.isPR = false;
    s.isNew1RM = false;
  }
}
// LOGGER-FINISH SLICE ADDITION, AS AMENDED BY THE SUPPLEMENTAL-SET
// CORRECTION BELOW: a Run-linked Session's own persisted canonical shape
// originally required EVERY Set to resolve to a real, already-verified
// prescribed planSetId (plan-run-model.js's
// planRunWorkoutContextMatchesOccurrence). That requirement still holds
// for every PRESCRIBED Set -- it is never relaxed, fabricated, or waived.
// What changes below is that a Run-linked Session may now also carry
// SUPPLEMENTAL Sets: Sets the person adds beyond the prescription, each
// honestly marked isSupplemental:true and planSetId:null (never a
// fabricated or reused prescribed id). This is a disclosed, additive
// capability, not a loosening of the original identity requirement --
// see plan-run-model.js's own comments for the full Set-shape contract,
// and app-plan-run-logger-ui.js's planRunLoggerBuildPersistedSet /
// planRunLoggerBuildWorkoutDoc for how a supplemental Set is persisted.
//
// SUPPLEMENTAL-SET CORRECTION -- the owner's own explicit decision: a
// supplemental Set stays part of the workout record only. It never
// silently influences Program completion, progression results, or
// automatic working-weight establishment -- those all remain scoped to
// prescribed Sets exactly as before (plan-run-model.js's
// planRunOccurrenceEligibleForCompletion, planRunBuildProgressionTriple,
// and planRunSelectQualifyingWorkingLoadWeight are unchanged in that
// respect, or explicitly filter supplemental Sets out). If a supplemental
// Set reveals that a working weight should change, that happens through
// an explicit adjustment the person makes themselves -- never as an
// unnoticed side effect of adding an extra Set.
//
// None of this changes this function's own behavior for any ordinary
// (non-Program-Run) workout.
function planRunLoggerIsCanonicalRunSession() { return !!(currentWorkout && currentWorkout.canonicalRun); }
function addSet(idx) {
  const sets = currentWorkout.exercises[idx].sets; const last = sets.length > 0 ? sets[sets.length-1] : null;
  if (planRunLoggerIsCanonicalRunSession()) {
    // A Run-linked Session may add a Set beyond its prescription, but that
    // Set can never claim a prescribed identity it doesn't have -- it is
    // stamped isSupplemental:true / planSetId:null here, at creation, so
    // every downstream consumer can tell it apart without guessing.
    sets.push({ planSetId: null, isSupplemental: true, weight: last ? last.weight : '', reps: '', time: '', rpe: '', completed: false, isPR: false, isNew1RM: false });
  } else {
    sets.push({ weight: last ? last.weight : '', reps: '', time: '', rpe: '', completed: false });
  }
  const container = document.getElementById(`sets-container-${idx}`); const exData = getExercise(currentWorkout.exercises[idx].exerciseId);
  const isTime = exData && (exData.tracking === 'time' || exData.tracking === 'weight_time');
  if (container) { container.innerHTML = buildSetsHTML(currentWorkout.exercises[idx], idx, isTime, currentWorkout.rpeEnabled); currentWorkout.exercises[idx].sets.forEach((s, si) => attachSwipeToSet(idx, si)); } else renderWorkoutExercises();
  refreshCurrentWorkoutPRBadges(); // duplicate weight-PR correction: adding/removing a set can move a PR
  awDraftSaveNow(); // ACTIVE-WORKOUT RECOVERY: partial re-render path
}
function removeSet(exIdx, si) {
  // WORKOUT-FLEXIBILITY CORRECTION: a canonical Run Session's prescribed
  // Sets used to be permanently fixed here -- removing one was refused
  // outright, even when it had never been performed. That's now allowed,
  // with set-level parity to an ordinary workout's own Delete Set (which
  // has never asked for confirmation either):
  //   - Not yet performed (planRunSetHasRecordedPerformance is false) --
  //     removed immediately. plan-run-model.js's
  //     planRunWorkoutContextMatchesOccurrence only checks that any Set
  //     present in the saved document belongs to the plan; it never
  //     requires every prescribed Set to still be present, so a removed,
  //     unperformed Set is simply absent from Finish's eyes -- an honest
  //     tombstone-by-absence, with no new model field needed.
  //   - Genuine performance already recorded -- still removed immediately
  //     (trim), matching exactly how an ordinary workout's Delete Set has
  //     always behaved; nothing here reassigns or fabricates that
  //     performance, it is simply no longer part of this saved workout,
  //     same as unchecking a completed Set already allows today.
  // GUARD: plan-run-model.js's planRunWorkoutDocValid requires every
  // exercise row to keep at least one Set -- removing the last one would
  // make this row invalid and fail the whole Finish later. An ordinary
  // workout has the same practical floor (an exercise with zero Sets is
  // meaningless), so this isn't a new restriction, just making the
  // existing one honest instead of discovering it at Finish time. Point
  // the person at Delete Exercise instead, which already handles removing
  // the whole row correctly for every origin.
  if (currentWorkout.exercises[exIdx].sets.length <= 1) {
    showToast('This is the last set — use Delete Exercise to remove the whole exercise instead.', 'error');
    return;
  }
  currentWorkout.exercises[exIdx].sets.splice(si, 1);
  const container = document.getElementById(`sets-container-${exIdx}`); const exData = getExercise(currentWorkout.exercises[exIdx].exerciseId);
  const isTime = exData && (exData.tracking === 'time' || exData.tracking === 'weight_time');
  if (container) { container.innerHTML = buildSetsHTML(currentWorkout.exercises[exIdx], exIdx, isTime, currentWorkout.rpeEnabled); currentWorkout.exercises[exIdx].sets.forEach((s, si) => attachSwipeToSet(exIdx, si)); } else renderWorkoutExercises();
  refreshCurrentWorkoutPRBadges(); // duplicate weight-PR correction: adding/removing a set can move a PR
  awDraftSaveNow(); // ACTIVE-WORKOUT RECOVERY: partial re-render path
}

// ==================== PR SET ====================
function addPRSet(idx) {
  if (!currentWorkout) return;
  // SUPPLEMENTAL-SET CORRECTION: + PR Set remains out of scope for this
  // correction (it targets + Set only, per the task's own required
  // behavior) -- a Run-linked Session still declines it here, unchanged
  // in substance. Only the message is updated: the old copy ("logs
  // exactly its prescribed sets") would now be inaccurate, since + Set can
  // add a Set, and it pointed the person nowhere useful.
  if (planRunLoggerIsCanonicalRunSession()) { showToast('Program Run Sessions don\'t support + PR Set. Use + Set to add an extra set instead.', 'error'); return; }
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
  refreshCurrentWorkoutPRBadges(); // duplicate weight-PR correction: adding/removing a set can move a PR
  awDraftSaveNow(); // ACTIVE-WORKOUT RECOVERY: partial re-render path
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
  // PARTIAL-WORKOUT CORRECTION (production finding: "+ Set did nothing for
  // other exercises", and Finish wrongly blocking a genuinely partial
  // Program Run Session): this filter -- dropping an empty Set, then
  // dropping an exercise left with none -- was always meant for an
  // ordinary, un-prescribed legacy workout, where an exercise added then
  // abandoned with nothing ever entered really has nothing worth keeping.
  // It must never run for a canonical Run Session (currentWorkout.
  // canonicalRun): a Run Session's prescribed Sets carry real, already-
  // verified identity (planSetId/planAssignmentId, stamped at launch by
  // planRunLoggerLaunch) that this correction's own required behavior
  // depends on staying present even when still blank -- that is the whole
  // point of letting the person Finish with some prescribed Sets not yet
  // performed (see finishCanonicalRunWorkout/planRunOccurrenceEligibleFor
  // Completion). Running this filter here, before that function is even
  // reached, previously (a) permanently mutated the still-open
  // currentWorkout even when the resulting Finish attempt was then
  // declined (nothing rolls this back), silently discarding real
  // prescribed-Set identity for any exercise still blank at that moment,
  // and (b) broke the index alignment every other exercise card's own
  // rendered "+ Set"/"Delete"/checkbox controls depend on (addSet/
  // removeSet/buildSetsHTML above all address currentWorkout.exercises by
  // position) for the rest of that still-open session -- exactly the
  // production finding this correction fixes. A legacy workout's own
  // existing behavior (this exact filter, then the "Add at least one set
  // first" decline) is completely unchanged below.
  if (!currentWorkout.canonicalRun) {
    currentWorkout.exercises.forEach(e => { e.sets = e.sets.filter(s => s.weight||s.reps||s.time); });
    currentWorkout.exercises = currentWorkout.exercises.filter(e => e.sets.length);
    if (!currentWorkout.exercises.length) { showToast('Add at least one set first','error'); return; }
  }
  if (currentWorkout._isEdit) {
    const originalDuration = currentWorkout.duration; delete currentWorkout._isEdit; currentWorkout.duration = originalDuration;
    // SYNCHRONOUS PRE-SAVE RECOMPUTATION (this round, Round 8, Finding 1):
    // genuinely recalculates every Set's isPR/isNew1RM from its CURRENT
    // weight/reps/completed state, closing the save-before-debounce race
    // (a completed PR edited downward, then saved before the 400ms timer
    // fires, no longer persists the stale true flags -- this recompute
    // runs regardless of whether any timer was ever pending). Also clears
    // any pending debounce timer for this workout outright, since it is
    // about to be saved and (on success) currentWorkout replaced/cleared
    // below.
    recomputeAllSetPRFlags(currentWorkout);
    clearAllPRDebounceTimers();
    // PERSISTENCE-BOUNDARY DEFENSE (Round 7, preserved): a fail-closed
    // normalization check, not a substitute for the genuine recomputation
    // just above -- kept as a second, independent backstop exactly as
    // Round 7 designed it.
    currentWorkout.exercises.forEach(e => e.sets.forEach(sanitizeSetPRFlags));
    const idx = appDb.workouts.findIndex(w => w.id === currentWorkout.id);
    if (idx !== -1) appDb.workouts[idx] = currentWorkout;
    fsSaveWorkout(currentWorkout);
    const timerEl = document.getElementById('log-timer-display'); if (timerEl) { timerEl.style.opacity = ''; timerEl.style.pointerEvents = ''; }
    stopWorkoutTimer(); currentWorkout = null; showToast('Workout updated!', 'success'); showPage('page-home'); return;
  }
  currentWorkout.duration = getElapsedSeconds();
  // LOGGER-FINISH SLICE ADDITION -- a Run-linked Session (currentWorkout.
  // canonicalRun, stamped only by app-plan-run-logger-ui.js's
  // planRunLoggerLaunch) is finished through the real fsPlanRunFinish
  // transaction, never through this function's own legacy tail below. This
  // branch is additive and returns immediately -- it never falls through to
  // the programId/activeProgramId branches or the unconditional
  // appDb.workouts.unshift(...)/fsSaveWorkout(...) tail that follows them,
  // per the program-run-logger-finish-slice-addendum.md decision 2. See
  // app-plan-run-logger-ui.js's own header for the full Finish design
  // (honest pending/uncertain/conflict/notEligible/budgetExceeded states,
  // Retry/Check Status, duplicate-submission prevention).
  if (currentWorkout.canonicalRun) { finishCanonicalRunWorkout(); return; }
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
  // SYNCHRONOUS PRE-SAVE RECOMPUTATION (this round, Round 8, Finding 1):
  // see the `_isEdit` branch's own comment above -- same fix, same reason,
  // applied to this unconditional new-workout Finish tail. Placed before
  // the progression-review branch below reads currentWorkout, though
  // progression itself never consumes isPR/isNew1RM (confirmed by audit --
  // see the implementation report).
  recomputeAllSetPRFlags(currentWorkout);
  clearAllPRDebounceTimers();
  // PERSISTENCE-BOUNDARY DEFENSE (Round 7, preserved): see the `_isEdit`
  // branch's own comment above. This is the ordinary (non-canonical-Run)
  // Finish path's own unconditional save -- it has no separate serializer
  // comparable to app-plan-run-logger-ui.js's
  // planRunLoggerBuildPersistedSet, so this fail-closed backstop is
  // applied directly to currentWorkout here too, immediately before it is
  // pushed to storage.
  currentWorkout.exercises.forEach(e => e.sets.forEach(sanitizeSetPRFlags));
  appDb.workouts.unshift(currentWorkout); fsSaveWorkout(currentWorkout); awDraftClear(); stopWorkoutTimer(); currentWorkout = null; // ACTIVE-WORKOUT RECOVERY: saved -> draft no longer needed
  if (reviewActive && reviewPending) {
    showProgressionReview(reviewActive, reviewPending);
  } else {
    showToast('Workout saved!','success'); showPage('page-home');
  }
}
// LOGGER-FINISH SLICE ADDITION -- a canonical Run Session with a real
// in-flight or uncertain Finish attempt (planRunLoggerFinishState) must
// never be discarded mid-attempt: the transaction may already have
// committed server-side even though this screen doesn't yet know it, and
// discarding currentWorkout here would strand the person with no way to
// Retry/Check Status/Abandon that specific attempt. Declines honestly
// instead of guessing; a definitively rejected/dismissable state (conflict/
// notEligible/budgetExceeded/error/competing) does not block Cancel, since
// nothing from that attempt is or ever will be persisted.
function planRunLoggerFinishBlocksCancel() {
  return !!(currentWorkout && currentWorkout.canonicalRun && planRunLoggerFinishState &&
    (planRunLoggerFinishState.phase === 'pending' || planRunLoggerFinishState.phase === 'uncertain'));
}
function cancelWorkout() {
  if (planRunLoggerFinishBlocksCancel()) { showToast('Resolve the current Finish attempt (Retry, Check Status, or Abandon) before canceling.', 'error'); return; }
  // STALE-TIMER / OWNERSHIP-TRANSITION DEFENSE (this round, Round 8): a
  // Cancel discards currentWorkout entirely (nothing is saved) -- any
  // pending debounce timer scheduled against it must be cancelled here too,
  // never left to fire later against whatever workout (if any) is open by
  // then.
  confirm2('Cancel Workout','Discard this workout? All data will be lost.', () => { if (currentWorkout && !currentWorkout._isEdit) awDraftClear(); clearAllPRDebounceTimers(); stopWorkoutTimer(); currentWorkout = null; showPage('page-home'); }, 'Discard');
}

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
  const isTM = r.adjustmentType === 'increaseTM';
  const isWL = r.loadReferenceType === 'workingLoad';
  const canSuggest = isTM ? r.canSuggestTMIncrease : r.canSuggestLoadIncrease;

  let detailHtml;
  if (r.status === 'passed' && canSuggest) {
    const targetLine = `${escapeHtml(r.targetDescription || '')}${r.actualDescription ? ' — ' + escapeHtml(r.actualDescription) : ''}`;
    let refLine = '';
    if (isTM) refLine = `<div class="prog-review-detail" style="margin-top:4px">Training Max: ${r.currentTM} → ${r.suggestedTM} ${unit}</div>`;
    else if (isWL) refLine = `<div class="prog-review-detail" style="margin-top:4px">Working Load: ${r.currentWorkingLoad} → ${r.suggestedWorkingLoad} ${unit}</div>`;
    detailHtml = `<div class="prog-review-detail">${targetLine}</div>${refLine}`;
  } else {
    detailHtml = `<div class="prog-review-detail">${escapeHtml(r.message || '')}</div>`;
  }

  let controlsHtml = '';
  if (r.decision) {
    const isSkip = r.decision === 'skipped';
    let noMatch;
    if (isTM) noMatch = !isSkip && r.appliedTM == null;
    else if (isWL) noMatch = !isSkip && r.appliedWorkingLoad == null;
    else noMatch = !isSkip && (!r.affectedSetCount || r.affectedSetCount === 0);
    const tagClass = (isSkip || noMatch) ? 'prog-review-done-tag prog-review-done-tag--skip' : 'prog-review-done-tag';
    let tagText;
    if (isSkip) tagText = 'Skipped';
    else if (isTM) tagText = noMatch ? 'No Training Max update applied' : `Applied: TM updated to ${r.appliedTM} ${unit}`;
    else if (isWL) tagText = noMatch ? 'No Working Load update applied' : `Applied: Working Load updated to ${r.appliedWorkingLoad} ${unit}`;
    else tagText = noMatch ? 'No matching future sets found' : `Applied: +${r.appliedIncrease} ${unit} to ${r.affectedSetCount} set${r.affectedSetCount !== 1 ? 's' : ''}`;
    controlsHtml = `<div class="${tagClass}">${tagText}</div>`;
  } else if (r.status === 'passed' && canSuggest) {
    if (active.status === 'complete') {
      controlsHtml = `<div class="prog-review-detail" style="color:var(--text3);font-style:italic;margin-top:6px">Program complete — no future sessions to update.</div>`;
    } else if (r._editing) {
      if (isTM) {
        controlsHtml = `
        <div style="margin-top:10px">
          <div style="font-size:12px;color:var(--text3);margin-bottom:6px">Current Training Max: ${r.currentTM} ${unit}</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <input type="number" step="0.5" id="prog-edit-tm-input-${pending.id}-${idx}" value="${r.suggestedTM}" style="max-width:110px">
            <span style="font-size:13px;color:var(--text3)">${unit}</span>
            <button class="btn btn-primary btn-sm" onclick="confirmProgressionEdit('${pending.id}',${idx})">Confirm</button>
            <button class="btn btn-ghost btn-sm" onclick="cancelProgressionEdit('${pending.id}',${idx})">Cancel</button>
          </div>
        </div>`;
      } else if (isWL) {
        controlsHtml = `
        <div style="margin-top:10px">
          <div style="font-size:12px;color:var(--text3);margin-bottom:6px">Current Working Load: ${r.currentWorkingLoad} ${unit}</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <input type="number" step="0.5" id="prog-edit-wl-input-${pending.id}-${idx}" value="${r.suggestedWorkingLoad}" style="max-width:110px">
            <span style="font-size:13px;color:var(--text3)">${unit}</span>
            <button class="btn btn-primary btn-sm" onclick="confirmProgressionEdit('${pending.id}',${idx})">Confirm</button>
            <button class="btn btn-ghost btn-sm" onclick="cancelProgressionEdit('${pending.id}',${idx})">Cancel</button>
          </div>
        </div>`;
      } else {
        controlsHtml = `
        <div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap">
          <input type="number" step="0.5" id="prog-edit-input-${pending.id}-${idx}" value="${r.loadIncrease}" style="max-width:90px">
          <span style="font-size:13px;color:var(--text3)">${unit}</span>
          <button class="btn btn-primary btn-sm" onclick="confirmProgressionEdit('${pending.id}',${idx})">Confirm</button>
          <button class="btn btn-ghost btn-sm" onclick="cancelProgressionEdit('${pending.id}',${idx})">Cancel</button>
        </div>`;
      }
    } else {
      let suggestionLine;
      if (isTM) suggestionLine = `Suggested Training Max: ${r.suggestedTM} ${unit}`;
      else if (isWL) suggestionLine = `Suggested Working Load: ${r.suggestedWorkingLoad} ${unit}`;
      else suggestionLine = `Suggested increase: +${r.loadIncrease} ${unit}`;
      controlsHtml = `
        <div style="font-size:13px;color:var(--text2);margin-top:6px">${suggestionLine}</div>
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
      <div class="prog-review-status" style="color:${statusColor}">${statusLabel} • ${evalLabel}</div>
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
  const ctx = getProgReviewContext();
  if (!ctx || ctx.pending.id !== pendingId) return;
  const r = ctx.pending.results[idx]; if (!r) return;
  if (r.adjustmentType === 'increaseTM') {
    const input = document.getElementById(`prog-edit-tm-input-${pendingId}-${idx}`);
    const val = input ? parseFloat(input.value) : NaN;
    if (isNaN(val) || val <= 0) { showToast('Enter a valid Training Max', 'error'); return; }
    runProgressionDecision(pendingId, idx, val);
  } else if (r.loadReferenceType === 'workingLoad') {
    const input = document.getElementById(`prog-edit-wl-input-${pendingId}-${idx}`);
    const val = input ? parseFloat(input.value) : NaN;
    if (isNaN(val) || val <= 0) { showToast('Enter a valid Working Load', 'error'); return; }
    runProgressionDecision(pendingId, idx, val);
  } else {
    const input = document.getElementById(`prog-edit-input-${pendingId}-${idx}`);
    const val = input ? parseFloat(input.value) : NaN;
    if (isNaN(val) || val <= 0) { showToast('Enter a valid increase', 'error'); return; }
    runProgressionDecision(pendingId, idx, val);
  }
}

// Shared by Apply (customValue = null, uses the suggestion as-is) and
// Edit-confirm (customValue = the user's entered number). For addLoad/explicitFixed,
// customValue is an increment; for increaseTM and workingLoad, customValue is the
// new value itself.
function runProgressionDecision(pendingId, idx, customValue) {
  const ctx = getProgReviewContext();
  if (!ctx || ctx.pending.id !== pendingId) return;
  const { active, pending } = ctx;
  const r = pending.results[idx]; if (!r) return;

  if (active.status === 'complete') {
    showToast('Program complete — no future sessions to update', 'error');
    return;
  }

  if (r.adjustmentType === 'increaseTM') {
    runTMProgressionDecision(active, pending, r, customValue);
  } else if (r.loadReferenceType === 'workingLoad') {
    runWorkingLoadProgressionDecision(active, pending, r, customValue);
  } else {
    runLoadProgressionDecision(active, pending, r, customValue);
  }
  renderProgressionReview();
}

function runLoadProgressionDecision(active, pending, r, customIncrease) {
  const increase = (customIncrease != null && !isNaN(customIncrease)) ? customIncrease : r.loadIncrease;
  const { affectedSetCount, affectedSessionCount } = applyLoadIncreaseToFutureSessions(active, r.exerciseId, increase);

  r.decision = customIncrease != null ? 'edited' : 'applied';
  r.appliedIncrease = increase;
  r.affectedSetCount = affectedSetCount;
  r.affectedSessionCount = affectedSessionCount;
  delete r._editing;

  logProgressionDecision(active, pending, r, { affectedSetCount, affectedSessionCount });
  fsSaveProgram(active);

  const unit = appDb.unit === 'kg' ? 'kg' : 'lb';
  showToast(
    affectedSetCount > 0
      ? `Applied +${increase} ${unit} to ${affectedSetCount} future set${affectedSetCount !== 1 ? 's' : ''}`
      : 'No matching future sets found',
    'success'
  );
}

// customTM (when set) is the user's edited NEW Training Max value directly —
// not an increment — per the Build 5 spec's preferred Edit UX.
function runTMProgressionDecision(active, pending, r, customTM) {
  const newTM = (customTM != null && !isNaN(customTM) && customTM > 0) ? customTM : r.suggestedTM;
  if (newTM == null) return;
  const previousTM = r.currentTM;
  const futureSessionCount = getFutureUnfinishedSessions(active).filter(({ session }) =>
    (session.exercises || []).some(ex => ex.exerciseId === r.exerciseId && (ex.sets || []).some(s => s.loadType === 'percentTM'))
  ).length;

  // Reuses the same active-instance TM storage as the Build 4 manual edit control —
  // there is only ever one Training Max per exercise per active instance.
  setActiveTrainingMax(active, r.exerciseId, newTM);

  r.decision = (customTM != null && customTM !== r.suggestedTM) ? 'edited' : 'applied';
  r.appliedTM = newTM;
  r.appliedIncrease = Math.round((newTM - previousTM) * 100) / 100;
  delete r._editing;

  logProgressionDecision(active, pending, r, { previousTM, appliedTM: newTM, futureSessionCount });
  fsSaveProgram(active);

  const unit = appDb.unit === 'kg' ? 'kg' : 'lb';
  showToast(`Applied: TM updated to ${newTM} ${unit}`, 'success');
}

// customWL (when set) is the user's edited NEW Working Load value directly — not
// an increment — matching the same Edit UX used for Training Max. Never touches
// active.microcycles or any future set's stored percent/weight — only the single
// active.workingLoads[exerciseId] value that future occurrences resolve from.
function runWorkingLoadProgressionDecision(active, pending, r, customWL) {
  const newWL = (customWL != null && !isNaN(customWL) && customWL > 0) ? customWL : r.suggestedWorkingLoad;
  if (newWL == null) return;
  const previousWorkingLoad = r.currentWorkingLoad;
  const futureSessionCount = getFutureUnfinishedSessions(active).filter(({ session }) =>
    (session.exercises || []).some(ex => ex.exerciseId === r.exerciseId && isWorkingLoadEligibleExercise(ex))
  ).length;

  applyWorkingLoadSuggestion(active, r.exerciseId, newWL);

  r.decision = (customWL != null && customWL !== r.suggestedWorkingLoad) ? 'edited' : 'applied';
  r.appliedWorkingLoad = newWL;
  r.appliedIncrease = Math.round((newWL - previousWorkingLoad) * 100) / 100;
  delete r._editing;

  logProgressionDecision(active, pending, r, { previousWorkingLoad, appliedWorkingLoad: newWL, futureSessionCount });
  fsSaveProgram(active);

  const unit = appDb.unit === 'kg' ? 'kg' : 'lb';
  showToast(`Applied: Working Load updated to ${newWL} ${unit}`, 'success');
}

function skipProgressionSuggestion(pendingId, idx) {
  const ctx = getProgReviewContext();
  if (!ctx || ctx.pending.id !== pendingId) return;
  const { active, pending } = ctx;
  const r = pending.results[idx]; if (!r) return;
  r.decision = 'skipped';
  delete r._editing;

  if (r.adjustmentType === 'increaseTM') {
    r.appliedTM = null;
    r.appliedIncrease = null;
    logProgressionDecision(active, pending, r, { previousTM: r.currentTM, appliedTM: null, futureSessionCount: 0 });
  } else if (r.loadReferenceType === 'workingLoad') {
    r.appliedWorkingLoad = null;
    r.appliedIncrease = null;
    logProgressionDecision(active, pending, r, { previousWorkingLoad: r.currentWorkingLoad, appliedWorkingLoad: null, futureSessionCount: 0 });
  } else {
    r.appliedIncrease = null;
    logProgressionDecision(active, pending, r, { affectedSetCount: 0, affectedSessionCount: 0 });
  }

  fsSaveProgram(active);
  renderProgressionReview();
}

function logProgressionDecision(active, pending, r, extra) {
  if (!active.progressionDecisionLog) active.progressionDecisionLog = [];
  extra = extra || {};
  const entry = {
    id: uid(),
    workoutId: pending.workoutId,
    sessionKey: pending.sessionKey,
    completedAt: pending.completedAt,
    exerciseId: r.exerciseId,
    exerciseName: r.exerciseName,
    evaluationType: r.evaluationType,
    status: r.status,
    adjustmentType: r.adjustmentType,
    decision: r.decision,
    createdAt: Date.now()
  };
  if (r.adjustmentType === 'increaseTM') {
    entry.previousTM = extra.previousTM;
    entry.suggestedTM = r.suggestedTM;
    entry.appliedTM = extra.appliedTM;
    entry.suggestedIncrease = r.tmIncrease;
    entry.appliedIncrease = r.appliedIncrease;
    entry.futureSessionCount = extra.futureSessionCount;
  } else if (r.loadReferenceType === 'workingLoad') {
    entry.loadReferenceType = 'workingLoad';
    entry.previousWorkingLoad = extra.previousWorkingLoad;
    entry.suggestedWorkingLoad = r.suggestedWorkingLoad;
    entry.appliedWorkingLoad = extra.appliedWorkingLoad;
    entry.suggestedIncrease = r.loadIncrease;
    entry.appliedIncrease = r.appliedIncrease;
    entry.futureSessionCount = extra.futureSessionCount;
  } else {
    entry.loadReferenceType = 'explicitFixed';
    entry.suggestedIncrease = r.loadIncrease;
    entry.appliedIncrease = r.appliedIncrease;
    entry.affectedSetCount = extra.affectedSetCount;
    entry.affectedSessionCount = extra.affectedSessionCount;
  }
  active.progressionDecisionLog.push(entry);
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

// Whether any future unfinished session still prescribes this exercise with a
// %TM set — used to decide if a Training Max increase is actually worth applying.
function hasFuturePercentTMOccurrence(active, exerciseId) {
  if (!active) return false;
  return getFutureUnfinishedSessions(active).some(({ session }) =>
    (session.exercises || []).some(ex =>
      ex.exerciseId === exerciseId && (ex.sets || []).some(s => s.loadType === 'percentTM')
    )
  );
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
  // PARTIAL-WORKOUT CORRECTION ROUND 4 (finding 1) -- previously included
  // ANY workout containing this exercise, even one where every Set for it
  // was still an untouched canonical placeholder, and rendered every
  // stored Set unconditionally (a blank one fell through to the literal
  // "—" ghost line). Now only workouts where this exercise has at least
  // one genuinely-performed Set are shown, and only genuinely-performed
  // Sets (shared predicate) are rendered within each.
  const workoutsWithEx = appDb.workouts
    .filter(w => w.exercises.some(e => e.exerciseId === exId && e.sets.some(planRunSetHasRecordedPerformance)))
    .slice(0, 3);
  const body = document.getElementById('ex-history-modal-body');
  if (!workoutsWithEx.length) { body.innerHTML = '<div class="empty-state" style="padding:30px 0"><h3>No History</h3><p>Not logged yet</p></div>'; openModal('modal-ex-history'); return; }
  body.innerHTML = workoutsWithEx.map(w => {
    const ex = w.exercises.find(e => e.exerciseId === exId); const d = new Date(w.date).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
    const performedSets = ex.sets.filter(planRunSetHasRecordedPerformance);
    return `<div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border)"><div style="font-family:var(--font-display);font-size:16px;font-weight:800;color:var(--accent);margin-bottom:6px">${w.name}</div><div style="font-size:13px;color:var(--text3);margin-bottom:8px">${d}</div>${performedSets.map((s,i)=>{ const line=`Set ${i+1}: ${formatPerformedSetLine(s)}`; return `<div class="history-set-line">${line}</div>`; }).join('')}</div>`;
  }).join('');
  openModal('modal-ex-history');
}

// ==================== PROGRAM PICKER ====================
function openProgramPickerModal() {
  if (!appDb.programs.length) { showToast('No programs yet. Create one first.','error'); return; }
  const sorted = [...appDb.programs].sort((a,b) => (b.lastUsed||0)-(a.lastUsed||0));
  document.getElementById('prog-picker-list').innerHTML = sorted.map(p => {
    const next = getNextSessionForProgram(p); const totalSessions = p.microcycles.reduce((a,mc) => a + mc.sessions.length, 0); const completed = (p.completedSessionIndices||[]).length;
    let statusText = next === null ? 'Program Complete' : (() => { const sname = p.microcycles[next.microcycleIdx].sessions[next.sessionIdx].name || `Day ${next.sessionIdx+1}`; return `Next: Week ${next.microcycleIdx+1} · ${sname}`; })();
    return `<div class="prog-pick-item" onclick="selectProgramForWorkout('${p.id}')"><div><div class="prog-pick-name">${p.name}</div><div class="prog-pick-meta">${statusText} · ${completed}/${totalSessions} sessions done</div></div><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="color:var(--accent);flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg></div>`;
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
      // UNPERFORMED-EXERCISE HISTORY CORRECTION: only genuinely performed
      // Sets (shared predicate) may become a highlight -- an unchecked,
      // prefilled target (e.g. a planned "135 x 5" never actually done)
      // previously could be shown here as if it had been lifted.
      if (!planRunSetHasRecordedPerformance(s)) continue;
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

// ==================== HISTORY: imported-set gated entry (startup-read-fix) ====================
// Imported sets are no longer loaded at startup. Every route that can display
// HISTORY (bottom-nav, the Home "view all" link, Search History, Browse by Date)
// funnels through loadHistoryThenRender() so the first entry per session awaits
// ensureImportedSetsLoaded() and shows a small loading/error state instead of
// rendering totals that silently omit imported data. Once loaded, later HISTORY
// visits render immediately (no repeat query), and the workout listener continues
// to rerender HISTORY live using the already-loaded imported-set data.
function renderHistoryLoading() {
  document.getElementById('history-stats').innerHTML = '';
  document.getElementById('history-list').innerHTML = '<div class="empty-state"><div class="load-spinner" style="margin:0 auto"></div><h3 style="margin-top:14px">Loading History...</h3></div>';
}
function renderHistoryLoadError(retryFn) {
  document.getElementById('history-list').innerHTML = '<div class="empty-state"><h3>Could Not Load History</h3><p>Check your connection and try again.</p><button class="btn btn-secondary" style="margin-top:12px" id="history-retry-btn">Retry</button></div>';
  const btn = document.getElementById('history-retry-btn');
  if (btn) btn.onclick = retryFn;
}
function loadHistoryThenRender(renderFn) {
  if (importedSetsLoaded) { renderFn(); return; }
  renderHistoryLoading();
  ensureImportedSetsLoaded('history').then(renderFn).catch(() => {
    renderHistoryLoadError(() => loadHistoryThenRender(renderFn));
  });
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
    // PARTIAL-WORKOUT CORRECTION ROUND 4 (finding 1) -- both counts were
    // previously raw (e.sets.length / w.exercises.length), counting every
    // blank/untouched canonical placeholder set, and every exercise that
    // had one, as performed. Now counts only genuinely-performed sets
    // (shared predicate) and only exercises that have at least one.
    + matches.map(w => { const d = new Date(w.date).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'}); const performedSetsByEx = w.exercises.map(e => e.sets.filter(planRunSetHasRecordedPerformance)); const sets = performedSetsByEx.reduce((a,ps) => a+ps.length, 0); const exercisesWithWork = performedSetsByEx.filter(ps => ps.length > 0).length; return `<div onclick="goToSearchResult('${w.id}')" style="padding:12px;border-bottom:1px solid var(--border);cursor:pointer" onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background=''"><div style="font-size:11px;color:var(--text3);margin-bottom:3px">${d}</div><div style="font-family:var(--font-display);font-size:16px;font-weight:800;text-transform:uppercase;color:var(--text)">${w.name}</div><div style="font-size:12px;color:var(--text3);margin-top:2px">${exercisesWithWork} exercises · ${sets} sets</div></div>`; }).join('');
}
function goToSearchResult(wid) {
  const raw = document.getElementById('history-search-input').value.trim(); if (raw) saveRecentSearch(raw);
  closeModal('modal-search-history'); const idx = appDb.workouts.findIndex(w => w.id === wid);
  if (idx >= historyShown) historyShown = idx + historyPageSize;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-history').classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  loadHistoryThenRender(() => {
    renderHistoryStats(); renderHistoryList();
    setTimeout(() => { const card = document.getElementById(`hist-expanded-${wid}`); if (card) { if (card.style.display === 'none') toggleHistoryCard(wid); document.getElementById(`hist-collapsed-${wid}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, 150);
  });
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
  loadHistoryThenRender(() => { renderHistoryStats(); renderHistoryList(); setTimeout(() => { const el = document.getElementById(`hist-collapsed-${match.id}`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 150); });
}

function workoutHistoryCard(w, compact=false) {
  const d = new Date(w.date).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
  // PARTIAL-WORKOUT CORRECTION ROUND 4 (finding 1 -- this is the exact
  // reported "3 Exercises · 8 Sets" defect): `sets` and the exercise count
  // below were previously raw (e.sets.length / w.exercises.length),
  // counting every blank/untouched canonical placeholder set, and every
  // exercise that had one, as performed. Now counts only genuinely-
  // performed sets (shared predicate, plan-run-model.js) and only
  // exercises that have at least one such set.
  const performedSetsByEx = w.exercises.map(e => e.sets.filter(planRunSetHasRecordedPerformance));
  const sets = performedSetsByEx.reduce((a,ps) => a+ps.length, 0);
  const exercisesWithWork = performedSetsByEx.filter(ps => ps.length > 0).length;
  const dur = w.duration ? fmtDuration(w.duration) : '';
  // DERIVED-FLAG CORRECTION (this round): isPR/isNew1RM are stored flags
  // on a Set, not independently trustworthy facts -- only a genuinely
  // completed, qualifying Set (the same shared predicate used just above
  // for `sets`/`exercisesWithWork`) should ever count toward this card's
  // own PR/new-E1RM totals. This read-side filter is a defensive backstop
  // behind the write-side correction above (checkSetPR/onSetChecked/
  // sanitizeSetPRFlags/planRunLoggerBuildPersistedSet) -- it does not
  // assume that correction alone is sufficient for every record this
  // card might ever render, including older ones already in storage.
  // DUPLICATE WEIGHT-PR CORRECTION: stored isPR flags are counted through
  // the one first-new-maximum rule (storedWorkoutPRSets, read-only), so an
  // older workout saved with four PR:70 flags counts one PR.
  const prSets = storedWorkoutPRSets(w);
  const new1rmSets = storedWorkoutNew1RMSets(w); // duplicate E1RM correction (read-only)
  const prs = w.exercises.reduce((a,e)=>a+e.sets.filter(s=>planRunSetHasRecordedPerformance(s) && prSets.has(s)).length,0); const new1rms = w.exercises.reduce((a,e)=>a+e.sets.filter(s=>planRunSetHasRecordedPerformance(s) && new1rmSets.has(s)).length,0);
  const wid = w.id;
  const prBadge = prs > 0 ? `<span class="recent-badge recent-badge-pr">${prs} PR'S</span>` : '';
  const e1rmBadge = new1rms > 0 ? `<span class="recent-badge recent-badge-1rm">${new1rms} New E1RM${new1rms > 1 ? "'S" : ''}</span>` : '';
  const badges = prBadge || e1rmBadge ? `<div class="recent-card-badges">${prBadge}${e1rmBadge}</div>` : '';
  const metaParts = [`${exercisesWithWork} Exercises`, `${sets} Sets`]; if (dur) metaParts.push(dur);
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
  const prSets = storedWorkoutPRSets(w); // duplicate weight-PR correction (read-only)
  const new1rmSets = storedWorkoutNew1RMSets(w); // duplicate E1RM correction (read-only)
  // UNPERFORMED-EXERCISE HISTORY CORRECTION: an exercise with no
  // genuinely performed Set (shared predicate) is no longer rendered at all
  // -- previously its name row still appeared with an empty set list (the
  // reported "blank exercise" in History). `ei` stays the exercise's ORIGINAL
  // index (the video modal looks it up by that index); the visible number
  // is its position among the exercises actually shown. Read-only: the
  // stored workout object is never modified.
  let shownNum = 0;
  const exercisesHtml = w.exercises.map((e, ei) => {
    if (!e.sets.some(planRunSetHasRecordedPerformance)) return '';
    shownNum++;
    const ex = getExercise(e.exerciseId); const name = ex ? ex.name : e.exerciseId;
    const isTime = ex && (ex.tracking === 'time' || ex.tracking === 'weight_time');
    const perfVideos = e.perfVideos || []; const refVideos = getExVideos(e.exerciseId);
    const hasVideos = perfVideos.length > 0 || refVideos.length > 0;
    const videoIcon = hasVideos ? `<span class="recent-ex-video-btn" onclick="openExpandedVideosModal('${wid}',${ei});event.stopPropagation()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" stroke-width="2.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg></span>` : '';
    // PARTIAL-WORKOUT CORRECTION ROUND 4 (finding 1) -- previously rendered
    // EVERY stored Set unconditionally, so a blank/untouched canonical
    // placeholder fell through to the empty-string defaults above and
    // rendered as a ghost row (no weight, no reps, no "x"). Now rendered
    // only for Sets carrying genuine recorded performance (shared
    // predicate) -- a genuinely completed Set still renders exactly as
    // logged (unchanged), an untouched one no longer renders at all.
    const setsHtml = e.sets.filter(planRunSetHasRecordedPerformance).map(s => {
      let weightStr = '', xStr = '', repsStr = '';
      if (s.weight && +s.weight > 0) { weightStr = `${s.weight}`; xStr = '×'; repsStr = `${s.reps||s.time||'—'}`; }
      else if (s.reps) { weightStr = 'BW'; xStr = '×'; repsStr = `${s.reps}`; }
      else if (s.time) { weightStr = `${s.time}s`; }
      // DERIVED-FLAG CORRECTION (this round): defensive backstop, same
      // reasoning as workoutHistoryCard's own PR/new-E1RM counts above --
      // the surrounding `setsHtml` filter already requires
      // planRunSetHasRecordedPerformance(s) before a Set reaches this
      // badge logic at all, but isPR/isNew1RM are re-checked against it
      // again here directly, rather than assuming the upstream filter (or
      // the write-side correction) is the only thing standing between a
      // stale flag and a visible badge.
      const qualifiesForBadge = planRunSetHasRecordedPerformance(s);
      const prBadge = qualifiesForBadge && prSets.has(s) ? `<span class="recent-badge recent-badge-pr" style="font-size:10px;padding:1px 6px;display:inline-block;min-width:72px;text-align:center">PR: ${s.weight}</span>` : `<span style="display:inline-block;min-width:72px"></span>`;
      const e1rmBadge = qualifiesForBadge && new1rmSets.has(s) && s.weight && s.reps ? `<span class="recent-badge recent-badge-1rm" style="font-size:10px;padding:1px 6px;display:inline-block;min-width:72px;text-align:center">E1RM: ${Math.round(calc1RM(+s.weight,+s.reps))}</span>` : (qualifiesForBadge && s.isPR ? `<span style="display:inline-block;min-width:72px"></span>` : '');
      return `<div class="recent-set-row"><span class="recent-set-weight">${weightStr}</span><span class="recent-set-x">${xStr}</span><span class="recent-set-reps">${repsStr}</span><span class="recent-set-badges">${prBadge}${e1rmBadge}</span></div>`;
    }).join('');
    return `<div class="recent-ex-block"><div class="recent-ex-name-row"><span class="recent-ex-num">${shownNum}</span><span class="recent-ex-name">${name}</span>${videoIcon}</div><div class="recent-ex-sets">${setsHtml}</div></div>`;
  }).join('');
  // FOUNDATION SLICE ADDITION (spec §3A.9) -- a canonical (Program Run)
  // workout OMITS the Edit control entirely (never merely disables it) and
  // substitutes non-interactive explanatory text in its place. Export
  // remains unrestricted (read-only -- no write path, so no immutability
  // concern). Legacy/imported workouts (no recordKind at all) are
  // unaffected and keep both controls exactly as before.
  const isCanonical = w.recordKind === 'canonicalWorkout';
  const editOrNotice = isCanonical
    ? `<span style="flex:1;text-align:center;font-size:12px;color:var(--text3);align-self:center">Completed via Program Run — not editable here</span>`
    : `<button class="btn btn-secondary" style="flex:1;justify-content:center" onclick="editHistoricalWorkout('${wid}');event.stopPropagation()">Edit</button>`;
  return `<div class="recent-expanded-inner"><div class="recent-ex-list">${exercisesHtml}</div><div class="recent-expanded-actions">${editOrNotice}<button class="btn btn-secondary" style="flex:1;justify-content:center" onclick="openCopyModal('${wid}');event.stopPropagation()">Export</button></div></div>`;
}
function openExpandedVideosModal(wid, exIdx) {
  const w = appDb.workouts.find(x => x.id === wid); if (!w) return;
  const e = w.exercises[exIdx]; const ex = getExercise(e.exerciseId); const perfVideos = e.perfVideos || []; const refVideos = getExVideos(e.exerciseId);
  document.getElementById('ex-videos-modal-title').textContent = ex ? ex.name : 'Videos';
  const refHtml = refVideos.length ? `<div style="margin-bottom:12px"><div class="video-section-label">Reference Videos</div>${refVideos.map(v => `<div class="video-link-row"><a class="video-link" href="${v}" target="_blank">${v}</a></div>`).join('')}</div>` : '';
  const perfHtml = perfVideos.length ? `<div><div class="video-section-label">This Session</div>${perfVideos.map(v => `<div class="video-link-row"><a class="video-link" href="${v}" target="_blank">${v}</a></div>`).join('')}</div>` : '';
  document.getElementById('ex-videos-modal-body').innerHTML = refHtml + perfHtml || '<div style="color:var(--text3);font-size:14px">No videos found.</div>';
  document.getElementById('modal-ex-videos').classList.remove('video-entry'); // read-only viewer keeps its existing layout
  openModal('modal-ex-videos');
}
// FOUNDATION SLICE ADDITION (canonical-program-run-ui-logger-integration-
// specification-round8.md §3A.9, unchanged since Round 5) -- a workout
// carrying `recordKind === 'canonicalWorkout'` (either completionState,
// sessionCompleted or historyOnly -- deliberately not distinguished, since
// neither can be safely routed through this generic legacy code, which has
// no awareness of the canonical shape) must never be edited or deleted
// through the ordinary History path. This guard is a zero-write
// short-circuit at the top of both functions -- effective regardless of
// invocation path (a stale DOM element, a direct console call, or any
// future UI addition that might otherwise become a silent bypass), and
// independent of the History-rendering omission below (buildRecentExpandedHtml),
// which only prevents a NEW Edit control from being shown in the first
// place. Both layers matter: legacy `finishWorkout()`'s own `_isEdit`
// branch and `fsDelWorkout` are fire-and-forget (rejections never surface
// to the user), so UI-layer blocking alone would leave a misleading
// false-success possibility open if either guard were skipped.
function editHistoricalWorkout(wid) {
  const w = appDb.workouts.find(x => x.id === wid); if (!w) return;
  if (w.recordKind === 'canonicalWorkout') { showToast('This session was completed through a Program Run and cannot be edited here.', 'error'); return; }
  // STALE-TIMER / OWNERSHIP-TRANSITION DEFENSE (this round, Round 8): see
  // finalizeStartActiveWorkout's own comment above -- same real gap, same
  // fix, cleared before the replacement just below.
  clearAllPRDebounceTimers();
  if (awDraftBlocksOpeningWorkout({ historyEdit: true })) return;
  currentWorkout = JSON.parse(JSON.stringify(w)); currentWorkout._isEdit = true;
  const nameDisplay = document.getElementById('log-session-name-display'); if (nameDisplay) nameDisplay.textContent = (w.name || 'WORKOUT').toUpperCase();
  const timerEl = document.getElementById('log-timer-display'); if (timerEl) { timerEl.textContent = w.duration ? fmtDuration(w.duration) : '0:00'; timerEl.style.opacity = '0.5'; timerEl.style.pointerEvents = 'none'; }
  document.getElementById('active-bar').classList.remove('visible'); renderWorkoutExercises(); showPage('page-log');
}
function deleteWorkout(id) {
  const w = appDb.workouts.find(x => x.id === id);
  if (w && w.recordKind === 'canonicalWorkout') { showToast('This session was completed through a Program Run and cannot be deleted here.', 'error'); return; }
  confirm2('Delete Workout','Permanently delete this workout log?', () => { appDb.workouts = appDb.workouts.filter(w=>w.id!==id); fsDelWorkout(id); renderHistory(); showToast('Workout deleted'); });
}

// ==================== ADD EXERCISE TO WORKOUT ====================
function addExToWorkout(exId) {
  if (!currentWorkout) return;
  if (planRunLoggerIsCanonicalRunSession()) {
    // WORKOUT-FLEXIBILITY CORRECTION: a canonical Run Session's Add
    // Exercise button was previously unaware of plan identity entirely --
    // the row it pushed had no planAssignmentId/planPrescriptionId/origin
    // at all, which made planRunLoggerBuildWorkoutDoc's identity check
    // fail the WHOLE Finish (not just this one exercise) with
    // missingExerciseIdentity the moment the person tried to save. Stamp
    // this row honestly as origin:'added' with no plan-assignment identity
    // (there is none -- it's unplanned, extra work), matching
    // PLAN_RUN_WORKOUT_EXERCISE_KEYS and PLAN_RUN_WORKOUT_SET_KEYS in
    // plan-run-model.js exactly, so Finish succeeds and this exercise's
    // performance is correctly excluded from automatic progression.
    currentWorkout.exercises.push({
      exerciseId: exId,
      planAssignmentId: null,
      planPrescriptionId: null,
      origin: 'added',
      sets: [{ planSetId: null, weight: '', reps: '', time: '', rpe: '', completed: false, isPR: false, isNew1RM: false, isSupplemental: true }],
      perfVideos: []
    });
    renderWorkoutExercises();
    return;
  }
  currentWorkout.exercises.push({ exerciseId: exId, sets: [{ weight:'', reps:'', time:'', rpe:'', completed:false }], perfVideos:[] });
  renderWorkoutExercises();
}

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
function openSessionModal(progId,mi,si){currentProgramId=progId;currentMicrocycleIdx=mi;currentSessionIdx=si;document.getElementById('session-modal-title').textContent=`Week ${mi+1} · Day ${si+1}`;renderSessionView();openModal('modal-session');}
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
  const prSets=storedWorkoutPRSets(w); // duplicate weight-PR correction: Export reads PRs through the same rule (read-only)
  const new1rmSets=storedWorkoutNew1RMSets(w); // duplicate E1RM correction: same, for New E1RM (read-only)
  const d=new Date(w.date).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  let out='';
  // PARTIAL-WORKOUT CORRECTION ROUND 4 (finding 1) -- both branches
  // previously iterated e.sets unconditionally (formatSetStr's own
  // '- —' fallback is the literal ghost line this produced for a
  // blank/untouched canonical placeholder), and getBestPRAndE1RM's
  // bestPRIdx/bestE1RMIdx were computed against that same unfiltered
  // array. Both branches now filter to genuinely-performed Sets (shared
  // predicate) FIRST, then compute the PR/E1RM indices against that same
  // filtered array, so the si===bestPRIdx/si===bestE1RMIdx comparisons
  // below stay correctly aligned -- a genuinely completed Set still
  // exports exactly as logged (unchanged); an untouched one no longer
  // appears at all (never a fabricated '- —' line).
  // UNPERFORMED-EXERCISE HISTORY CORRECTION: in both formats below, an
  // exercise with no genuinely performed Set is now skipped entirely
  // (previously its name heading was still printed with nothing under it).
  if(copyFormat==='txt'){
    out+=`${w.name.toUpperCase()}\n${d}\n`;if(w.duration)out+=`Duration: ${fmtDuration(w.duration)}\n`;out+='─'.repeat(40)+'\n\n';
    w.exercises.forEach(e=>{const performedSets=e.sets.filter(planRunSetHasRecordedPerformance);if(!performedSets.length)return;const ex=getExercise(e.exerciseId);out+=`${ex?ex.name.toUpperCase():e.exerciseId}\n`;const{bestPRIdx,bestE1RMIdx,bestPRWeight,bestE1RM}=getBestPRAndE1RM({sets:performedSets.map(s=>Object.assign({},s,{isPR:prSets.has(s),isNew1RM:new1rmSets.has(s)}))});performedSets.forEach((s,si)=>{let line=formatSetStr(s);const parts=[];if(si===bestPRIdx)parts.push(`PR=${bestPRWeight}${appDb.unit}`);if(si===bestE1RMIdx)parts.push(`E1RM=${Math.round(bestE1RM)}${appDb.unit}`);if(parts.length)line+=` - ${parts.join(' / ')}`;out+=line+'\n';});const pv=e.perfVideos||[];if(pv.length)out+=pv.join('\n')+'\n';out+='\n';});
  } else {
    out+=`[u][size=200]${w.name}[/size][/u]\n[i]${d}[/i]\n`;if(w.duration)out+=`[i]Duration: ${fmtDuration(w.duration)}[/i]\n`;out+='\n';
    w.exercises.forEach(e=>{const performedSets=e.sets.filter(planRunSetHasRecordedPerformance);if(!performedSets.length)return;const ex=getExercise(e.exerciseId);out+=`[b][size=125]${ex?ex.name:e.exerciseId}[/b][/size]\n`;const{bestPRIdx,bestE1RMIdx,bestPRWeight,bestE1RM}=getBestPRAndE1RM({sets:performedSets.map(s=>Object.assign({},s,{isPR:prSets.has(s),isNew1RM:new1rmSets.has(s)}))});performedSets.forEach((s,si)=>{let line=formatSetStr(s);const parts=[];if(si===bestPRIdx)parts.push(`PR=${bestPRWeight}${appDb.unit}`);if(si===bestE1RMIdx)parts.push(`E1RM=${Math.round(bestE1RM)}${appDb.unit}`);if(parts.length)line+=` - ${parts.join(' / ')}`;out+=line+'\n';});const pv=e.perfVideos||[];if(pv.length)out+=pv.join('\n')+'\n';out+='\n';});
  }
  document.getElementById('copy-output').textContent=out;
}
function formatSetStr(s){if(s.weight&&+s.weight>0)return`- ${s.weight}${appDb.unit} x ${s.reps||s.time||'?'}`;if(s.reps)return`- BW x ${s.reps}`;if(s.time)return`- ${s.time}s`;return'- —';}
// DERIVED-FLAG CORRECTION (this round): hardened internally with the same
// shared predicate, even though both of this function's current callers
// (renderCopyOutput, below) already pre-filter their input to
// performedSets before calling this -- an explicit internal gate here
// means a future caller that forgets to pre-filter cannot silently count
// a stale flag on an unchecked Set, rather than relying solely on every
// caller remembering to filter first.
function getBestPRAndE1RM(ex){let bestPRIdx=-1,bestPRWeight=0,bestE1RMIdx=-1,bestE1RM=0;ex.sets.forEach((s,si)=>{if(!planRunSetHasRecordedPerformance(s))return;if(s.isPR&&+s.weight>bestPRWeight){bestPRWeight=+s.weight;bestPRIdx=si;}if(s.isNew1RM&&s.weight&&s.reps){const v=calc1RM(+s.weight,+s.reps);if(v>bestE1RM){bestE1RM=v;bestE1RMIdx=si;}}});return{bestPRIdx,bestE1RMIdx,bestPRWeight,bestE1RM};}
function copyToClipboard(){navigator.clipboard.writeText(document.getElementById('copy-output').textContent).then(()=>showToast('Copied to clipboard','success')).catch(()=>showToast('Select text manually to copy','error'));}

// ==================== MODALS ====================
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){
  document.getElementById(id).classList.remove('open');
  if (id === 'modal-ex-browser') {
    // Collections browsing inside the shared Exercise Browser modal (TRAIN/PLAN) never
    // persists across a close -- reopening later always starts back at the Collections list.
    libCollectionDrill = null;
    collActiveId = null;
    collReturnTo = null;
  }
}
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
async function runImport(){
  const fileInput=document.getElementById('import-file-input');
  if(!fileInput||!fileInput.files.length){showToast('Select a CSV file first','error');return;}
  const file = fileInput.files[0]; // captured now, before any await or user-facing dialog delay
  const importBtn = document.querySelector('#import-export-body .btn-primary');
  const originalLabel = importBtn ? importBtn.textContent : 'Import';
  if (importBtn) { importBtn.disabled = true; importBtn.textContent = 'Checking...'; }
  let existing;
  try {
    existing = await ensureImportedSetsLoaded('import-duplicate-check');
  } catch (err) {
    if (importBtn) { importBtn.disabled = false; importBtn.textContent = originalLabel; }
    showToast('Could not check for an existing import. Check your connection and try again.', 'error');
    return;
  }
  if (existing.length>0){
    if (importBtn) importBtn.textContent = 'Waiting...'; // stays disabled while the confirm dialog is up
    confirm2(
      'Existing Import Detected',
      `You already have ${existing.length} imported sets. Importing again will add duplicates. Continue?`,
      () => { runGuardedImport(file, importBtn, originalLabel); },
      'Import Anyway',
      true,
      () => { if (importBtn) { importBtn.disabled = false; importBtn.textContent = originalLabel; } } // cancel restores the control
    );
    return;
  }
  await runGuardedImport(file, importBtn, originalLabel);
}
// Runs the actual import and guarantees the control is restored and any failure is
// caught -- so neither call site (accept-confirmation or no-existing-import) can
// leave an unhandled rejection or a stuck "Importing..." button.
async function runGuardedImport(file, importBtn, originalLabel){
  if (importBtn) { importBtn.disabled = true; importBtn.textContent = 'Importing...'; }
  try {
    await doImport(file);
  } catch (err) {
    console.error(DIAG, 'import failed:', err);
    showToast(err && err.reason === 'no-valid-rows' ? 'Import failed - no valid rows found' : 'Import failed. Check the file and your connection, then try again.', 'error');
  } finally {
    if (importBtn) { importBtn.disabled = false; importBtn.textContent = originalLabel; }
  }
}
async function doImport(file){
  const text=await file.text();const rows=parseCSV(text);const exAll=getAllExercises();const newCustomExes={};const setsToSave=[];
  for(const cols of rows){const dateRaw=(cols[0]||'').trim();const exName=(cols[2]||'').trim();const weight=(cols[4]||'').trim();const reps=(cols[5]||'').trim();if(!dateRaw&&!weight&&!reps)continue;if(!dateRaw)continue;const dateTs=parseImportDate(dateRaw);if(!dateTs)continue;if(!exName)continue;let matched=exAll.find(e=>e.name.toLowerCase()===exName.toLowerCase());if(!matched&&newCustomExes[exName.toLowerCase()])matched=newCustomExes[exName.toLowerCase()];if(!matched){const newEx={id:uid(),name:exName,bodypart:'Other',categories:['Other'],tracking:'weight_reps',custom:true};appDb.customExercises.push(newEx);fsSaveCustomEx(newEx);newCustomExes[exName.toLowerCase()]=newEx;matched=newEx;}setsToSave.push({id:uid(),exerciseId:matched.id,date:dateTs,workoutName:(cols[1]||'').trim(),setNumber:(cols[3]||'').trim(),weight,reps});}
  if (setsToSave.length===0) {
    // Handled failure: no batches run, appDb.importedSets untouched, modal stays
    // open. runGuardedImport()'s catch shows this specific message (via err.reason)
    // and its finally still restores the Import control.
    const err = new Error('Import failed - no valid rows found');
    err.reason = 'no-valid-rows';
    throw err;
  }
  const BATCH_SIZE=400;for(let i=0;i<setsToSave.length;i+=BATCH_SIZE){const batch=fsDb.batch();setsToSave.slice(i,i+BATCH_SIZE).forEach(s=>{batch.set(COL_IMPORTED_SETS.doc(s.id),s);});await batch.commit();}
  appDb.importedSets.push(...setsToSave);closeModal('modal-import-export');
  showToast(`Imported ${setsToSave.length} set${setsToSave.length!==1?'s':''}`, 'success');
}
let exportInProgress = false; // prevents a second export flow (modal card or HISTORY dropdown) while one is already running
async function runExport(){
  if (exportInProgress) return;
  exportInProgress = true;
  // The Export control is a clickable card in the Import/Export modal (not a
  // <button>), and only exists at all when that modal's home view is open -- the
  // HISTORY dropdown invocation has no persistent element to disable, so it relies
  // on the toast alone for feedback.
  const exportEl = document.querySelector('#import-export-body [onclick="runExport()"]');
  if (exportEl) { exportEl.style.pointerEvents = 'none'; exportEl.style.opacity = '0.55'; }
  showToast('Preparing export...', '');
  try {
    const importedSets = await ensureImportedSetsLoaded('export');
    const rows=['date,workout_name,exercise_name,set_number,weight,reps,rpe,duration_seconds,notes'];
    // PARTIAL-WORKOUT CORRECTION ROUND 4 (finding 1) -- previously exported
    // EVERY stored Set unconditionally (set_number=si+1, with empty
    // weight/reps for a blank/untouched canonical placeholder). Now
    // exports only genuinely-performed Sets (shared predicate); an
    // exercise with none produces zero rows for this workout, and
    // set_number renumbers 1..N over the genuinely-performed Sets only, so
    // the canonical round-trip identity of the STORED data is untouched
    // (export is one-way/read-only -- confirmed no import path writes back
    // into this same canonical workout) while nothing untouched is ever
    // presented as performed work.
    appDb.workouts.forEach(w=>{const d=new Date(w.date);const dateStr=`${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;const dur=w.duration||'';w.exercises.forEach(e=>{const ex=getExercise(e.exerciseId);const exName=ex?ex.name:e.exerciseId;e.sets.filter(planRunSetHasRecordedPerformance).forEach((s,si)=>{rows.push([dateStr,csvEscape(w.name),csvEscape(exName),si+1,s.weight||'',s.reps||s.time||'',s.rpe||'',si===0?dur:'',''].join(','));});});});
    importedSets.forEach(s=>{const d=new Date(s.date);const dateStr=`${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;const ex=getExercise(s.exerciseId);rows.push([dateStr,csvEscape(s.workoutName||''),csvEscape(ex?ex.name:s.exerciseId),s.setNumber||'',s.weight||'',s.reps||'','','',''].join(','));});
    const today=new Date();const datePart=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    triggerDownload(rows.join('\n'),`ironlog-export-${datePart}.csv`,'text/csv');
    closeModal('modal-import-export');
    showToast('Export downloaded','success');
  } catch (err) {
    // Covers imported-set loading, CSV construction, and download creation alike --
    // no incomplete CSV is ever produced, and the modal is never closed, on failure.
    console.error(DIAG, 'export failed:', err);
    showToast('Export failed. Check your connection and try again.', 'error');
  } finally {
    exportInProgress = false;
    if (exportEl) { exportEl.style.pointerEvents = ''; exportEl.style.opacity = ''; }
  }
}
function csvEscape(val){if(!val)return'';const s=String(val);if(s.includes(',')||s.includes('"')||s.includes('\n'))return`"${s.replace(/"/g,'""')}"`;return s;}

// ==================== UNIT / SETTINGS ====================
function setUnit(u){appDb.unit=u;fsSavePrefs();updateUnitToggle();}
function updateUnitToggle(){document.getElementById('unit-lbs').classList.toggle('active',appDb.unit==='lbs');document.getElementById('unit-kg').classList.toggle('active',appDb.unit==='kg');}

// ==================== INIT EVENTS ====================
document.querySelectorAll('.modal-overlay').forEach(el => el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); }));
document.getElementById('modal-progression-review')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeProgressionReview(); });
document.getElementById('modal-active-tm-prompt')?.addEventListener('click', e => { if (e.target === e.currentTarget) activeTMPromptSkip(); });
document.getElementById('modal-active-1rm-prompt')?.addEventListener('click', e => { if (e.target === e.currentTarget) active1RMPromptSkip(); });
document.getElementById('modal-active-wl-prompt')?.addEventListener('click', e => { if (e.target === e.currentTarget) activeWLPromptSkip(); });
