// ==================== APP UPDATES (reliable, coherent) ====================
// Hosting: GitHub Pages sends every file with "Cache-Control: max-age=600"
// and there is no service worker, so a browser may reuse a saved copy of any
// file for a while -- and before this, a reload could combine a NEW
// index.html with OLD saved scripts (mixed versions).
//
// How updates work now:
//  1. index.html names its release in <meta name="ironlog-build"> and loads
//     every app script/style with "?v=<release>". A new release means new
//     URLs, so a page always gets the scripts and styles that belong to it --
//     never a mix (tools/stamp-build.js keeps these in step).
//  2. version.json names the release that is live. This file checks it,
//     bypassing every cache, when the app opens, when it comes back to the
//     screen (Home Screen app resumed, tab shown again) and every 15 minutes.
//  3. If a newer release is live:
//       - on open/resume, with nothing in progress, the page reloads straight
//         into it (a new "?build=" address, so no saved copy of the old page
//         can be reused);
//       - otherwise a banner says an update is ready, and nothing is reloaded
//         while a workout is open, a PLAN edit is unsaved, a dialog is open
//         or a save is under way. "Update now" works once that is finished.
//     One automatic reload per release per tab; if the page still isn't
//     current after it, the banner explains instead of looping.
(function () {
  'use strict';
  var meta = document.querySelector('meta[name="ironlog-build"]');
  var RUNNING = meta ? meta.getAttribute('content') : null;
  var TRIED_KEY = 'ironlog.updateTried';
  var CHECK_EVERY_MS = 15 * 60 * 1000;
  var st = { latest: null, checking: false, lastCheck: 0, failedAuto: false, hiddenFor: null };
  window.__ironlogBuild = RUNNING;
  window.__ironlogUpdate = st;

  // Anything that a reload could lose, or interrupt. Each check is guarded:
  // if any part of the app can't be inspected, assume busy (never reload).
  function busyReason() {
    try {
      if (typeof currentWorkout !== 'undefined' && currentWorkout) return currentWorkout._isEdit ? 'edit' : 'workout';
      if (typeof planCanonicalEditorState !== 'undefined' && planCanonicalEditorState && typeof planUiDraftIsChanged === 'function' && planUiDraftIsChanged(planCanonicalEditorState)) return 'plan';
      if (typeof planRunFailureUi !== 'undefined' && planRunFailureUi && planRunFailureUi.phase === 'saving') return 'saving';
      if (document.querySelector('.modal-overlay.open, #tm-prompt-overlay.open')) return 'dialog';
    } catch (e) { return 'unknown'; }
    return null;
  }
  var BUSY_TEXT = {
    workout: 'It will install after you finish or cancel this workout.',
    edit: 'It will install after you save or close this workout edit.',
    plan: 'It will install after you save or discard your PLAN changes.',
    saving: 'It will install once this save finishes.',
    dialog: 'It will install after you close this window.',
    unknown: 'Finish what you’re doing, then tap Update now.'
  };

  function triedFor() { try { return sessionStorage.getItem(TRIED_KEY); } catch (e) { return null; } }
  function markTried(b) { try { sessionStorage.setItem(TRIED_KEY, b); } catch (e) { /* still works */ } }
  function targetUrl(build) {
    return location.pathname + '?build=' + encodeURIComponent(build) + location.hash;
  }
  function apply(build) {
    markTried(build);
    window.__ironlogUpdateNavigating = targetUrl(build);
    location.replace(targetUrl(build));
  }

  function render() {
    var el = document.getElementById('app-update-banner');
    if (!st.latest || st.latest === RUNNING || st.hiddenFor === st.latest) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'app-update-banner'; el.className = 'app-update-banner';
      el.setAttribute('role', 'status'); el.setAttribute('data-testid', 'app-update-banner');
      el.addEventListener('click', function (e) {
        // "Later": hide until the next check (app reopened or brought back).
        if (e.target.closest && e.target.closest('[data-app-update="later"]')) { st.hiddenFor = st.latest; render(); return; }
        if (!e.target.closest || !e.target.closest('[data-app-update="now"]')) return;
        var why = busyReason();
        if (why) { render(); return; }
        apply(st.latest);
      });
      (document.body || document.documentElement).appendChild(el);
    }
    var why = busyReason();
    var msg = st.failedAuto
      ? 'A new version of IRON LOG is ready, but this page couldn’t load it automatically. Close IRON LOG completely and open it again.'
      : 'A new version of IRON LOG is ready. ' + (why ? BUSY_TEXT[why] : '');
    el.setAttribute('data-busy', why || '');
    el.innerHTML = '<span class="app-update-msg" data-testid="app-update-msg">' + msg + '</span>' +
      (st.failedAuto ? '' : '<button type="button" class="app-update-btn" data-app-update="now" data-testid="app-update-now"' + (why ? ' disabled' : '') + '>Update now</button>') +
      '<button type="button" class="app-update-later" data-app-update="later" data-testid="app-update-later">Later</button>';
  }

  // trigger: 'open' | 'resume' | 'timer'
  function check(trigger) {
    if (st.checking || !RUNNING) return Promise.resolve(null);
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
        if ((trigger === 'open' || trigger === 'resume') && !busyReason()) { apply(latest); return latest; }
        render(); return latest;
      }, function () { st.checking = false; return null; });   // offline: try again later
  }
  window.__ironlogCheckForUpdate = check;
  window.__ironlogUpdateBusyReason = busyReason;

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
    // has no unsaved state yet (an unfinished workout is kept as a local
    // draft and offered back after any reload), so the update is picked up
    // with the least flicker.
    check('open');
    setInterval(function () { if (document.visibilityState === 'visible') check('timer'); else render(); }, CHECK_EVERY_MS);
    // Keep the banner's "busy" text current as the person moves around.
    setInterval(function () { if (st.latest) render(); }, 3000);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Date.now() - st.lastCheck > 5000) check('resume');
  });
  window.addEventListener('pageshow', function (e) { if (e.persisted) check('resume'); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady); else onReady();
})();
