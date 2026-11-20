// ==================== REST TIMER ====================
// A rest countdown for the OPEN live workout (ordinary or Program Run),
// opened from the Workout Logger's "•••" menu. It never reads or writes
// the workout record, PLAN, HISTORY or Firestore, and it never touches the
// workout clock: pausing, resuming or editing workout time has no effect.
// Nothing starts it automatically (completing a set does not).
//
// TIMING: remaining = endAt - Date.now(), so the display is always right,
// even after the phone throttled or suspended timers (app switch, screen
// lock). A visibilitychange listener recalculates the moment IRON LOG is
// shown again.
//
// ONE COUNTDOWN: every Start/Restart/Stop/clear bumps rtState.token. A tick
// only acts if its token is still current, so a stopped or restarted
// countdown can never produce an old completion cue.
//
// TIED TO THE WORKOUT: the countdown remembers currentWorkout.id. It is
// cleared by stopWorkoutTimer()/startWorkoutTimer()/restoreWorkoutTimer()
// (every Finish, Cancel, discard or new workout path calls one of these),
// and every tick also clears it if the open workout is no longer the same.
// An active countdown is NOT restored after a full page reload (by design
// for this release); only the preferences are.
//
// CHIME: optional. Audio is prepared inside the user's Start/Restart tap
// (WebAudio context created/resumed + a silent blip, which is what iOS
// requires). One short chime plays only if the countdown reaches zero
// while IRON LOG is visible and has been visible since before the end
// time, AND the audio context already reports 'running' at that moment
// (nothing is scheduled on a suspended/interrupted context). If it expired while hidden, "Rest done" shows on return with no
// delayed chime. If audio is blocked/unavailable, the visual cue still works.
//
// PREFERENCES (this device, per signed-in user, localStorage
// RT_PREFS_KEY_PREFIX + uid): last duration started and the chime setting.
// First use: 2:00, chime off.

const RT_PREFS_SCHEMA = 'ironlog.restTimer';
const RT_PREFS_KEY_PREFIX = 'ironlog.restTimer:'; // + owner uid
const RT_PRESETS = [60, 120, 180];
const RT_DEFAULT_S = 120;
const RT_MAX_S = 99 * 60 + 59;
const RT_TICK_MS = 250;
const RT_CHIME_GRACE_MS = 1500; // a chime more than this late would be a "delayed" chime

let rtState = {
  endAt: null,        // ms timestamp while counting down
  durationS: null,    // duration of the current/last countdown
  workoutId: null,    // the workout this countdown belongs to
  done: false,        // "Rest done" showing
  token: 0,           // invalidates old ticks
  interval: null,
  visibleSince: (typeof document !== 'undefined' && document.visibilityState === 'visible') ? Date.now() : null,
  audioCtx: null,
  draft: null,        // dialog selection: { sel: 60|120|180|'custom', min, sec }
  lastChimeAt: null   // for tests/diagnostics only
};

// ---------- preferences ----------
function rtUid() { return (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.uid) || 'signed-out'; }
function rtPrefsKey() { return RT_PREFS_KEY_PREFIX + rtUid(); }
function rtLoadPrefs() {
  const out = { lastDurationS: RT_DEFAULT_S, chime: false };
  try {
    const raw = localStorage.getItem(rtPrefsKey());
    if (!raw) return out;
    const p = JSON.parse(raw);
    if (!p || p.schema !== RT_PREFS_SCHEMA) return out;
    if (Number.isInteger(p.lastDurationS) && p.lastDurationS > 0 && p.lastDurationS <= RT_MAX_S) out.lastDurationS = p.lastDurationS;
    out.chime = p.chime === true;
  } catch (e) { /* unreadable or blocked storage: use defaults */ }
  return out;
}
function rtSavePrefs(patch) {
  const p = Object.assign(rtLoadPrefs(), patch);
  try { localStorage.setItem(rtPrefsKey(), JSON.stringify({ schema: RT_PREFS_SCHEMA, version: 1, lastDurationS: p.lastDurationS, chime: p.chime })); } catch (e) { /* still works this session */ }
  return p;
}

// ---------- helpers ----------
function rtFmt(s) { s = Math.max(0, s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function rtAvailable() { return !!(typeof currentWorkout !== 'undefined' && currentWorkout && !currentWorkout._isEdit); }
function rtActive() { return rtState.endAt !== null && !rtState.done; }
function rtRemainingS() { return rtActive() ? Math.max(0, Math.ceil((rtState.endAt - Date.now()) / 1000)) : 0; }
function rtWorkoutStillOpen() { return !!(currentWorkout && !currentWorkout._isEdit && currentWorkout.id === rtState.workoutId); }
function rtParseField(v, maxDigits) {
  v = String(v == null ? '' : v).trim();
  return new RegExp('^\\d{1,' + maxDigits + '}$').test(v) ? parseInt(v, 10) : null;
}

// ---------- countdown ----------
function rtStopInterval() { if (rtState.interval) { clearInterval(rtState.interval); rtState.interval = null; } }
// Clears everything (active countdown AND "Rest done"). Called when the
// workout ends, is discarded, or a different workout starts.
function restTimerClear() {
  rtState.token++;
  rtStopInterval();
  rtState.endAt = null; rtState.done = false; rtState.workoutId = null;
  rtRenderIndicator();
  const ov = document.getElementById('modal-rest-timer');
  if (ov && ov.classList.contains('open')) closeModal('modal-rest-timer');
}
function rtStart(durationS) {
  rtPrepareAudio(); // inside the user's tap
  rtState.token++;
  rtStopInterval();
  rtState.durationS = durationS;
  rtState.endAt = Date.now() + durationS * 1000;
  rtState.done = false;
  rtState.workoutId = currentWorkout.id;
  rtSavePrefs({ lastDurationS: durationS });
  const myToken = rtState.token;
  rtState.interval = setInterval(() => { if (myToken === rtState.token) rtTick(); }, RT_TICK_MS);
  rtRenderIndicator();
}
function rtStop() {
  rtState.token++;
  rtStopInterval();
  rtState.endAt = null; rtState.done = false;
  rtRenderIndicator();
}
function rtTick() {
  if (rtState.endAt === null || rtState.done) return;
  if (!rtWorkoutStillOpen()) { restTimerClear(); return; }
  const now = Date.now();
  if (now >= rtState.endAt) { rtComplete(now); return; }
  rtRenderIndicator();
  rtUpdateDialogStatus();
}
function rtComplete(now) {
  const endAt = rtState.endAt;
  rtState.token++;
  rtStopInterval();
  rtState.done = true;
  // Chime only for a countdown that reached zero while IRON LOG was on
  // screen (visible continuously since before the end, and caught on time).
  const visibleThroughout = typeof document !== 'undefined' && document.visibilityState === 'visible' &&
    rtState.visibleSince !== null && rtState.visibleSince <= endAt;
  if (visibleThroughout && now - endAt <= RT_CHIME_GRACE_MS && rtLoadPrefs().chime) rtPlayChime();
  rtRenderIndicator();
  const ov = document.getElementById('modal-rest-timer');
  if (ov && ov.classList.contains('open')) rtRenderDialog();
}
function rtOnVisibility() {
  if (document.visibilityState === 'visible') {
    rtState.visibleSince = Date.now();
    // Show the correct remaining time or "Rest done" straight away.
    // An expiry found here happened while hidden: rtComplete sees
    // visibleSince > endAt and stays silent.
    if (rtState.endAt !== null && !rtState.done) rtTick();
  } else {
    rtState.visibleSince = null;
  }
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', rtOnVisibility);

// ---------- audio ----------
function rtPrepareAudio() {
  if (!rtLoadPrefs().chime) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!rtState.audioCtx) rtState.audioCtx = new AC();
    const ctx = rtState.audioCtx;
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
    // Silent blip: unlocks audio on iOS when played from a user gesture.
    const o = ctx.createOscillator(), g = ctx.createGain();
    g.gain.value = 0; o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.01);
  } catch (e) { rtState.audioCtx = null; }
}
function rtPlayChime() {
  try {
    // Only an audio context that is ALREADY running may schedule the chime.
    // Suspended, interrupted (iOS), closed or missing -> skip the sound for
    // this expiry (Rest done still shows). Never resume() here: tones
    // scheduled on a suspended context could play late once audio returns.
    const ctx = rtState.audioCtx;
    if (!ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + 0.02;
    [[880, 0], [1320, 0.18]].forEach(([freq, at]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(0.35, t0 + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.32);
      o.connect(g); g.connect(ctx.destination);
      o.start(t0 + at); o.stop(t0 + at + 0.35);
    });
    rtState.lastChimeAt = Date.now();
  } catch (e) { /* visual cue still shows */ }
}

// ---------- indicator (next to the workout clock) ----------
function rtRenderIndicator() {
  const el = document.getElementById('rest-indicator');
  if (!el) return;
  const show = rtState.workoutId !== null && (rtActive() || rtState.done) && rtWorkoutStillOpen();
  el.style.display = show ? '' : 'none';
  // Narrow screens: the indicator moves to its own compact second header
  // row while showing (styles.css, .log-header.has-rest); the row
  // collapses again as soon as the indicator clears.
  const header = el.closest('.log-header');
  if (header) header.classList.toggle('has-rest', show);
  if (!show) { el.classList.remove('done'); return; }
  if (rtState.done) {
    el.classList.add('done');
    el.textContent = 'Rest done';
    el.setAttribute('aria-label', 'Rest done. Open rest timer');
  } else {
    el.classList.remove('done');
    el.textContent = 'Rest ' + rtFmt(rtRemainingS());
    el.setAttribute('aria-label', 'Rest timer, ' + rtFmt(rtRemainingS()) + ' left. Open controls');
  }
}

// ---------- dialog ----------
function openRestTimerDialog() {
  if (!rtAvailable()) return;
  const prefs = rtLoadPrefs();
  const d = rtActive() ? rtState.durationS : prefs.lastDurationS;
  rtState.draft = RT_PRESETS.indexOf(d) !== -1
    ? { sel: d, min: String(Math.floor(d / 60)), sec: String(d % 60).padStart(2, '0') }
    : { sel: 'custom', min: String(Math.floor(d / 60)), sec: String(d % 60).padStart(2, '0') };
  rtRenderDialog();
  openModal('modal-rest-timer');
}
function rtSelect(sel) {
  if (!rtState.draft) return;
  rtState.draft.sel = sel;
  rtRenderDialog();
  if (sel === 'custom') { const m = document.getElementById('rt-min'); if (m) m.focus({ preventScroll: true }); }
}
function rtSetChime(on) {
  rtSavePrefs({ chime: !!on });
  if (on) rtPrepareAudio(); // the toggle tap is a user gesture too
}
function rtDraftField(field, v) { if (rtState.draft) rtState.draft[field] = v; }
function rtStatusHtml() {
  if (rtActive()) return `<div class="rt-status" data-testid="rt-status">Resting · <span id="rt-status-remaining">${rtFmt(rtRemainingS())}</span> left of ${rtFmt(rtState.durationS)}</div>`;
  if (rtState.done && rtWorkoutStillOpen()) return `<div class="rt-status rt-status-done" data-testid="rt-status">Rest done</div>`;
  return '';
}
function rtRenderDialog() {
  const body = document.getElementById('rt-body'); if (!body) return;
  const d = rtState.draft || { sel: RT_DEFAULT_S, min: '2', sec: '00' };
  const chime = rtLoadPrefs().chime;
  const presetBtn = s => `<button type="button" class="rt-preset${d.sel === s ? ' selected' : ''}" aria-pressed="${d.sel === s}" data-testid="rt-preset-${s}" onclick="rtSelect(${s})">${rtFmt(s)}</button>`;
  const active = rtActive();
  const done = rtState.done && rtWorkoutStillOpen();
  body.innerHTML = `
    ${rtStatusHtml()}
    <div class="rt-presets" role="group" aria-label="Rest length">
      ${RT_PRESETS.map(presetBtn).join('')}
      <button type="button" class="rt-preset${d.sel === 'custom' ? ' selected' : ''}" aria-pressed="${d.sel === 'custom'}" data-testid="rt-preset-custom" onclick="rtSelect('custom')">Custom</button>
    </div>
    ${d.sel === 'custom' ? `<div class="rt-custom">
      <div class="form-group" style="flex:1"><label for="rt-min">Minutes</label><input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" id="rt-min" value="${escapeHtml(d.min)}" oninput="rtDraftField('min',this.value)"></div>
      <div class="form-group" style="flex:1"><label for="rt-sec">Seconds (0–59)</label><input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" id="rt-sec" value="${escapeHtml(d.sec)}" oninput="rtDraftField('sec',this.value)"></div>
    </div>` : ''}
    <label class="rt-chime"><input type="checkbox" id="rt-chime" ${chime ? 'checked' : ''} onchange="rtSetChime(this.checked)"> Chime when rest ends</label>
    <div id="rt-error" class="rt-error" style="display:none"></div>
    <div class="rt-actions">
      ${active
        ? `<button class="btn btn-secondary" data-testid="rt-stop" onclick="rtStopFromDialog()">Stop</button><button class="btn btn-primary" data-testid="rt-restart" onclick="rtStartFromDialog()">Restart</button>`
        : `${done ? `<button class="btn btn-secondary" data-testid="rt-dismiss" onclick="rtDismissFromDialog()">Dismiss</button>` : ''}<button class="btn btn-primary" data-testid="rt-start" onclick="rtStartFromDialog()">Start</button>`}
    </div>`;
}
function rtUpdateDialogStatus() {
  const el = document.getElementById('rt-status-remaining');
  if (el) el.textContent = rtFmt(rtRemainingS());
}
function rtError(msg) {
  const el = document.getElementById('rt-error');
  if (el) { el.textContent = msg; el.style.display = ''; }
  showToast(msg, 'error');
}
// Returns the selected duration in seconds, or null (with an error shown).
function rtSelectedSeconds() {
  const d = rtState.draft; if (!d) return null;
  if (d.sel !== 'custom') return d.sel;
  const m = rtParseField(d.min, 2), s = rtParseField(d.sec, 2);
  if (m === null || s === null || s > 59) { rtError('Enter whole minutes (0–99) and seconds (0–59).'); return null; }
  const total = m * 60 + s;
  if (total <= 0) { rtError('Rest must be longer than 0:00.'); return null; }
  return total;
}
function rtStartFromDialog() {
  if (!rtAvailable()) { closeModal('modal-rest-timer'); return; }
  const s = rtSelectedSeconds();
  if (s === null) return; // invalid: an active countdown is left exactly as it was
  rtStart(s);
  closeModal('modal-rest-timer');
}
function rtStopFromDialog() { rtStop(); closeModal('modal-rest-timer'); }
function rtDismissFromDialog() { rtStop(); closeModal('modal-rest-timer'); }
