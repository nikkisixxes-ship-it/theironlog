// ==================== APP UPDATES (reliable, coherent) ====================
// Hosting: GitHub Pages sends every file with "Cache-Control: max-age=600"
// and there is no service worker, so a browser may reuse a saved copy of any
// file for a while.
//
// How updates work:
//  1. Every release lives in its own folder, releases/<id>/, which never
//     changes (tools/stamp-build.js). index.html loads its scripts and styles
//     only from its own release's folder, so a page -- even one reopened
//     from a browser's saved copy after a newer release went live -- always
//     gets its own matching files, never a mix.
//  2. version.json names the live release. This file checks it, bypassing
//     every cache, when the app opens, when it comes back to the screen
//     (Home Screen app resumed, tab shown again) and every 15 minutes.
//  3. If a newer release is live, the page moves to it (a new "?build="
//     address, so no saved copy of the old page is reused) ONLY when that is
//     safe -- see busyReason() and safeToReload(). Otherwise a banner waits
//     and says why; "Update now" works once the reason is gone.
//     One automatic move per release per tab; never a loop.
//
// Loaded in <head>, right after the Firebase SDK, so it can count every
// database write the app makes (set/update/delete/add/batch/transaction).
(function () {
  'use strict';
  var meta = document.querySelector('meta[name="ironlog-build"]');
  var RUNNING = meta ? meta.getAttribute('content') : null;
  var TRIED_KEY = 'ironlog.updateTried';
  var CHECK_EVERY_MS = 15 * 60 * 1000;
  var SYNC_WAIT_MS = 4000;
  var st = { latest: null, checking: false, lastCheck: 0, failedAuto: false, hiddenFor: null, waitingFor: null, navigating: false, writesInFlight: 0 };
  window.__ironlogBuild = RUNNING;
  window.__ironlogUpdate = st;

  // ---- Database writes still in progress ------------------------------------
  // Every write promise the app starts is counted until it settles. A reload
  // waits for 0, then also for Firestore's own pending-write queue.
  function track(p) {
    if (!p || typeof p.then !== 'function') return p;
    st.writesInFlight++;
    var done = function () { st.writesInFlight = Math.max(0, st.writesInFlight - 1); };
    p.then(done, done);
    return p;
  }
  function wrap(proto, names) {
    if (!proto) return;
    names.forEach(function (n) {
      var orig = proto[n];
      if (typeof orig !== 'function' || orig.__ironlogTracked) return;
      var w = function () { return track(orig.apply(this, arguments)); };
      w.__ironlogTracked = true;
      try { proto[n] = w; } catch (e) { /* leave as is */ }
    });
  }
  try {
    var F = window.firebase && window.firebase.firestore;
    if (F) {
      wrap(F.DocumentReference && F.DocumentReference.prototype, ['set', 'update', 'delete']);
      wrap(F.CollectionReference && F.CollectionReference.prototype, ['add']);
      wrap(F.WriteBatch && F.WriteBatch.prototype, ['commit']);
      wrap(F.Firestore && F.Firestore.prototype, ['runTransaction']);
    }
  } catch (e) { /* counting is a safety net; the checks below still apply */ }

  // ---- What a reload could lose or interrupt --------------------------------
  // Traced from the app's own state. If anything can't be inspected, assume
  // busy (never reload).
  function anyPhase(map, phases) {
    if (!map) return false;
    return Object.keys(map).some(function (k) { return map[k] && phases.indexOf(map[k].phase) !== -1; });
  }
  function busyReason() {
    try {
      // An open workout (live, or editing a past one), including its Finish.
      if (typeof currentWorkout !== 'undefined' && currentWorkout) return currentWorkout._isEdit ? 'edit' : 'workout';
      // PLAN editor: any save stage (preparing, saving, verifying/reopening),
      // its own "not safe to leave" state, or unsaved changes.
      if (typeof planCanonicalEditorState !== 'undefined' && planCanonicalEditorState) {
        var pst = planCanonicalEditorState;
        if (pst.savePhase || pst.busy || pst._pendingSaveAttempt || pst.recoveryChecking ||
            (typeof planCanonicalEditorIsSafeToLeave === 'function' && !planCanonicalEditorIsSafeToLeave())) return 'planSaving';
        if (typeof planUiDraftIsChanged === 'function' && planUiDraftIsChanged(pst)) return 'plan';
      }
      // Program decisions (approve / respond after a miss): saving, or a
      // save whose result isn't confirmed.
      if (typeof planRunFailureUi !== 'undefined' && planRunFailureUi && (planRunFailureUi.phase === 'saving' || planRunFailureUi.phase === 'uncertain' || planRunFailureUi.inFlight)) return 'saving';
      // Starting a Program: values being entered, sending, or unconfirmed.
      if (typeof planRunStartState !== 'undefined' && planRunStartState &&
          (planRunStartState.submitting || planRunStartState.phase === 'uncertain' ||
           (planRunStartState.phase === 'confirmingValues' && document.getElementById('page-run-start') && document.getElementById('page-run-start').classList.contains('active')))) return 'start';
      // Ending a Program, or setting a Training Max: in flight or unconfirmed.
      if (typeof planRunEndStateByRunId !== 'undefined' && anyPhase(planRunEndStateByRunId, ['pending', 'uncertain', 'uncertainDismissed'])) return 'saving';
      if (typeof planRunTmAttemptByKey !== 'undefined' && anyPhase(planRunTmAttemptByKey, ['pending', 'uncertain'])) return 'saving';
      // Account equipment / exercise loading settings: a save on its way, or unsaved settings.
      if (typeof lcState !== 'undefined' && lcState && (lcState.busy || (lcState.drafts && lcState.drafts.exLoading && lcState.drafts.exLoading.dirty))) return lcState.busy ? 'saving' : 'dialog';
      // Any open dialog: the confirmation dialog, modal windows, prompts.
      if (document.querySelector('#confirm-overlay.open, .modal-overlay.open, #tm-prompt-overlay.open')) return 'dialog';
      // Any database write still on its way.
      if (st.writesInFlight > 0) return 'syncing';
    } catch (e) { return 'unknown'; }
    return null;
  }
  var BUSY_TEXT = {
    workout: 'It will install after you finish or cancel this workout.',
    edit: 'It will install after you save or close this workout edit.',
    plan: 'It will install after you save or discard your PLAN changes.',
    planSaving: 'It will install once your program has finished saving.',
    saving: 'It will install once this save is confirmed.',
    start: 'It will install after you start or cancel this program.',
    dialog: 'It will install after you close this window.',
    syncing: 'It will install once your changes have finished syncing.',
    unknown: 'Finish what you’re doing, then tap Update now.'
  };

  // Right before moving: nothing busy, no write in flight, and Firestore's
  // own queue of pending writes confirmed by the server (bounded wait).
  // Resolves to null when safe, or a busy reason.
  function safeToReload() {
    var why = busyReason();
    if (why) return Promise.resolve(why);
    var fs = null;
    try { fs = window.firebase && window.firebase.firestore && window.firebase.firestore(); } catch (e) { fs = null; }
    var waitQueue = (fs && typeof fs.waitForPendingWrites === 'function')
      ? new Promise(function (res) {
          var t = setTimeout(function () { res('syncing'); }, SYNC_WAIT_MS);
          fs.waitForPendingWrites().then(function () { clearTimeout(t); res(null); }, function () { clearTimeout(t); res('syncing'); });
        })
      : Promise.resolve(null);
    return waitQueue.then(function (q) { return q || busyReason(); });
  }

  function triedFor() { try { return sessionStorage.getItem(TRIED_KEY); } catch (e) { return null; } }
  function markTried(b) { try { sessionStorage.setItem(TRIED_KEY, b); } catch (e) { /* still works */ } }
  function targetUrl(build) { return location.pathname + '?build=' + encodeURIComponent(build) + location.hash; }
  // Every move (automatic or "Update now") goes through here.
  function moveTo(build, automatic) {
    if (st.navigating) return Promise.resolve(false);
    st.waitingFor = null;
    return safeToReload().then(function (why) {
      if (why) { st.waitingFor = why; render(); return false; }
      if (automatic) markTried(build);
      st.navigating = true;
      window.__ironlogUpdateNavigating = targetUrl(build);
      location.replace(targetUrl(build));
      return true;
    });
  }

  function render() {
    var el = document.getElementById('app-update-banner');
    if (!st.latest || st.latest === RUNNING || st.hiddenFor === st.latest || st.navigating) { if (el) el.remove(); return; }
    if (!document.body) return;
    if (!el) {
      el = document.createElement('div');
      el.id = 'app-update-banner'; el.className = 'app-update-banner';
      el.setAttribute('role', 'status'); el.setAttribute('data-testid', 'app-update-banner');
      el.addEventListener('click', function (e) {
        var t = e.target;
        if (t.closest && t.closest('[data-app-update="later"]')) { st.hiddenFor = st.latest; render(); return; }
        if (t.closest && t.closest('[data-app-update="now"]')) moveTo(st.latest, false);
      });
      // In the app's own column, between the header and the scrolling
      // content, so it takes its own space and never covers a control.
      var main = document.getElementById('main');
      if (main && main.parentNode) main.parentNode.insertBefore(el, main); else document.body.appendChild(el);
    }
    // why: something in progress right now (button unavailable). The last
    // pre-move check may also have found writes not yet confirmed by the
    // server; that is explained, but the button stays usable -- each tap
    // checks again.
    var why = busyReason();
    var said = why || (st.waitingFor === 'syncing' ? 'syncing' : null);
    var msg = st.failedAuto
      ? 'A new version of IRON LOG is ready, but this page couldn’t load it automatically. Close IRON LOG completely and open it again.'
      : 'A new version of IRON LOG is ready. ' + (said ? BUSY_TEXT[said] : '');
    el.setAttribute('data-busy', why || '');
    el.innerHTML = '<span class="app-update-msg" data-testid="app-update-msg">' + msg + '</span>' +
      (st.failedAuto ? '' : '<button type="button" class="app-update-btn" data-app-update="now" data-testid="app-update-now"' + (why ? ' disabled' : '') + '>Update now</button>') +
      '<button type="button" class="app-update-later" data-app-update="later" data-testid="app-update-later">Later</button>';
  }

  // trigger: 'open' | 'resume' | 'timer'
  function check(trigger) {
    if (st.checking || !RUNNING || st.navigating) return Promise.resolve(null);
    st.checking = true; st.lastCheck = Date.now();
    return fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        st.checking = false;
        var latest = j && typeof j.build === 'string' ? j.build : null;
        if (!latest || latest === RUNNING) { st.latest = null; render(); return null; }
        st.latest = latest;
        if (trigger !== 'timer') st.hiddenFor = null;
        if (triedFor() === latest) { st.failedAuto = true; render(); return latest; }   // no loops
        if (trigger === 'open' || trigger === 'resume') return moveTo(latest, true).then(function () { return latest; });
        render(); return latest;
      }, function () { st.checking = false; return null; });   // offline: try again later
  }
  window.__ironlogCheckForUpdate = check;
  window.__ironlogUpdateBusyReason = busyReason;
  window.__ironlogUpdateSafeToReload = safeToReload;

  // Arrived on a "?build=" address that IS current: tidy the address bar.
  try {
    var q = new URLSearchParams(location.search);
    if (q.get('build') && q.get('build') === RUNNING && history.replaceState) {
      q.delete('build');
      var rest = q.toString();
      history.replaceState(history.state, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
    }
  } catch (e) { /* cosmetic only */ }

  function onReady() {
    // Check straight away, before the app has started anything: a fresh open
    // has nothing in progress (an unfinished workout is kept as a local draft
    // and offered back after any reload).
    check('open');
    setInterval(function () { if (document.visibilityState === 'visible') check('timer'); else render(); }, CHECK_EVERY_MS);
    // Keep the banner current as the person moves around.
    setInterval(function () { if (st.latest) render(); }, 3000);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Date.now() - st.lastCheck > 5000) check('resume');
  });
  window.addEventListener('pageshow', function (e) { if (e.persisted) check('resume'); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady); else onReady();
})();
