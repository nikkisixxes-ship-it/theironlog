// ==================== LOAD CALCULATOR ====================
// A standalone, manual tool opened from the active Workout Logger's "•••"
// menu; its equipment editor also opens from LIBRARY. It never reads or
// writes the workout: no sets, prescriptions, progression, HISTORY, the
// workout timer or the recovery draft.
//
// EQUIPMENT (Stage 2) belongs to the signed-in account and is kept in
// Firestore by app-equipment.js (loaded before this file). Equipment saved
// on a device before Stage 2 (localStorage, LC_STORE_KEY_PREFIX + uid) is a
// read-only backup that can be copied to the account; it is never changed.
//
// NUMBERS: every weight is turned into a whole number of thousandths
// ("milli" units: 2.5 -> 2500) before any comparison or sum, so valid
// fractional weights (1.25, 0.5, 2.5...) are compared exactly and never
// suffer floating-point drift. Inputs allow at most 3 decimals.
//
// PROFILE TYPES
//   plate      - starting (unloaded) weight + a shared plate inventory
//                (sizes and PAIRS). targetMode 'total' (bar/machine) or
//                'perDumbbell'. Shows plates per side.
//   adjustable - preset settings: a regular range (min/max/increment) or a
//                custom list. perDumbbell flag labels weights per dumbbell.
//   quickdraw  - REP QuickDraw (lb, per dumbbell), 5..maxSetting in 2.5 lb
//                steps, with loading diagrams from LC_QD_POSITIONS.

const LC_SCHEMA = 'ironlog.loadCalculator';
const LC_VERSION = 1;
const LC_STORE_KEY_PREFIX = 'ironlog.loadCalculator:'; // + owner uid
const LC_MAX_WEIGHT_M = 100000 * 1000;   // 100,000 (lb or kg)
const LC_MAX_PAIRS = 50;
const LC_MAX_PLATE_TYPES = 20;


// ==================== NUMBERS ====================
// Parses a typed weight. Returns milli units (integer) or null.
function lcParseWeight(v, opts) {
  opts = opts || {};
  const s = String(v == null ? '' : v).trim();
  if (!/^(\d{1,6}(\.\d{0,3})?|\.\d{1,3})$/.test(s)) return null;
  const parts = s.split('.');
  const whole = parseInt(parts[0] || '0', 10);
  const frac = ((parts[1] || '') + '000').slice(0, 3);
  const m = whole * 1000 + parseInt(frac, 10);
  if (m > LC_MAX_WEIGHT_M) return null;
  if (m === 0 && !opts.allowZero) return null;
  return m;
}
function lcParseCount(v, max) {
  const s = String(v == null ? '' : v).trim();
  if (!/^\d{1,4}$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n <= max ? n : null;
}
// ==================== SOLVERS ====================
// The pure numbers and solvers (lcToM, lcFmt, lcSolvePlates, lcNearestSetting,
// QuickDraw positions, lcProfileSettingsM, lcIsPerDumbbell...) live in
// load-solver.js, which index.html loads before this file. They are shared,
// unchanged, with the calculation module (calc-cv1.js).

// ==================== STORAGE ====================
// Account equipment comes from app-equipment.js (eqState). lcState.data is a
// read-only view of it, rebuilt before every render.
function lcUid() { return (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.uid) || null; }
function lcRefreshData() {
  const uid = lcUid();
  const profiles = eqState.uid === uid ? eqState.profiles : [], inventories = eqState.uid === uid ? eqState.inventories : [];
  const last = uid ? eqLastProfile(uid) : null;
  lcState.data = { profiles, inventories, lastProfileId: profiles.some(p => p.id === last) ? last : (profiles[0] ? profiles[0].id : null) };
}

// ==================== UI STATE ====================
// stack: navigation history inside the dialog. Each entry remembers its own
// scroll position, so "Back" returns exactly where the user was.
let lcState = { data: { profiles: [], inventories: [], lastProfileId: null }, stack: [], target: '', targetBasis: null, drafts: {}, root: 'calc', busy: false, copy: null, unsub: null };

// TARGET BASIS: a typed target only means something for one unit (lb/kg)
// and one basis (per dumbbell / equipment total). Whenever the active
// profile's unit or basis differs from the one the target was typed for --
// after switching profiles, saving an edit, deleting the active profile,
// reopening -- the target and its result are cleared. Same unit and basis:
// the number is kept and recalculated with the new equipment.
function lcTargetBasis(p) { return p ? p.unit + '|' + (lcIsPerDumbbell(p) ? 'perDumbbell' : 'total') : null; }
function lcSyncTargetBasis(p) {
  const b = lcTargetBasis(p);
  if (lcState.targetBasis !== b) { lcState.target = ''; lcState.targetBasis = b; }
}

function lcProfile(id) { return (lcState.data.profiles || []).find(p => p.id === id) || null; }
function lcInventory(id) { return (lcState.data.inventories || []).find(i => i.id === id) || null; }
function lcCurrentProfile() {
  const d = lcState.data;
  return lcProfile(d.lastProfileId) || d.profiles[0] || null;
}
function lcScroller() { const ov = document.getElementById('modal-load-calc'); return ov ? ov.querySelector('.modal') : null; }
function lcTop() { return lcState.stack[lcState.stack.length - 1]; }

function lcOpen(root) {
  if (!lcUid()) return;
  if (eqState.uid !== lcUid()) eqResetForOwner(lcUid());
  eqEnsureStarted();
  lcState.root = root; lcState.stack = [{ view: root, scroll: 0 }];
  lcState.drafts = {}; lcState.copy = null; lcState.busy = false;
  if (!lcState.unsub) lcState.unsub = eqSubscribe(lcOnEquipmentChange);
  const ov = document.getElementById('modal-load-calc');
  ov.classList.add('lc-top');
  lcRender();
  openModal('modal-load-calc');
  const sc = lcScroller(); if (sc) sc.scrollTop = 0;
}
function openLoadCalculator() {
  if (!(typeof currentWorkout !== 'undefined' && currentWorkout && !currentWorkout._isEdit)) return;
  lcOpen('calc');
}
// LIBRARY > Equipment: the same equipment editor, no workout needed.
function openEquipmentEditor() { lcOpen('manage'); }
function closeLoadCalculator() {
  closeModal('modal-load-calc');
  if (lcState.unsub) { lcState.unsub(); lcState.unsub = null; }
  lcState.drafts = {}; lcState.copy = null; lcState.stack = [];
}
// Account changed (sign-out, sign-in, switch): close and forget everything shown.
function lcResetForOwner() {
  const ov = document.getElementById('modal-load-calc');
  if (ov && ov.classList.contains('open')) closeLoadCalculator();
  else { if (lcState.unsub) { lcState.unsub(); lcState.unsub = null; } lcState.drafts = {}; lcState.copy = null; lcState.stack = []; }
  lcState.target = ''; lcState.targetBasis = null;
  lcState.data = { profiles: [], inventories: [], lastProfileId: null };
}
// Live updates: redraw read-only views; editors keep the typed input (conflicts are caught on save).
function lcOnEquipmentChange() {
  const top = lcTop(); if (!top) return;
  if (['calc', 'manage', 'invUsers', 'copy'].indexOf(top.view) === -1 || lcState.busy) return;
  const sc = lcScroller(); const y = sc ? sc.scrollTop : 0;
  const active = document.activeElement && document.activeElement.id;
  const caret = active === 'lc-target' ? document.activeElement.selectionStart : null;
  lcRender(); if (sc) sc.scrollTop = y;
  if (active) { const el = document.getElementById(active); if (el) { el.focus(); if (caret !== null && el.setSelectionRange) el.setSelectionRange(caret, caret); } }
}
function lcNav(view, params) {
  const sc = lcScroller(); const top = lcTop();
  if (top && sc) top.scroll = sc.scrollTop;
  lcState.stack.push({ view, params: params || {}, scroll: 0 });
  lcRender();
  if (sc) sc.scrollTop = 0;
}
function lcBack() {
  if (lcState.stack.length <= 1) { lcRender(); return; }
  lcState.stack.pop();
  lcRender();
  const sc = lcScroller(); if (sc) sc.scrollTop = lcTop().scroll || 0;
}
// Replace the stack below the root (used after saving a profile).
function lcResetTo(view, params) {
  lcState.stack = [{ view: lcState.root, scroll: 0 }];
  if (view && view !== lcState.root) lcState.stack.push({ view, params: params || {}, scroll: 0 });
  lcRender();
  const sc = lcScroller(); if (sc) sc.scrollTop = 0;
}

function lcRender() {
  const top = lcTop();
  const titleEl = document.getElementById('lc-title');
  const body = document.getElementById('lc-body');
  const backBtn = document.getElementById('lc-back-btn');
  if (!top || !body) return;
  lcRefreshData();
  backBtn.style.display = lcState.stack.length > 1 ? '' : 'none';
  body.setAttribute('data-view', top.view);
  let title = 'Load Calculator', html = '';
  switch (top.view) {
    case 'calc': html = lcCalcHtml(); break;
    case 'manage': title = lcState.root === 'manage' && lcState.stack.length === 1 ? 'Equipment' : 'Manage Equipment'; html = lcManageHtml(); break;
    case 'invUsers': title = 'Inventory In Use'; html = lcInvUsersHtml(); break;
    case 'copy': title = 'Copy Device Equipment'; html = lcCopyHtml(); break;
    case 'editProfile': title = top.params.isNew ? 'New Equipment' : 'Edit Equipment'; html = lcEditProfileHtml(); break;
    case 'editInventory': title = top.params.isNew ? 'New Plate Inventory' : 'Edit Plate Inventory'; html = lcEditInventoryHtml(); break;
    case 'guide': title = 'Weight Guide'; html = lcGuideHtml(); break;
    case 'diagram': title = 'REP QuickDraw'; html = lcDiagramViewHtml(); break;
  }
  titleEl.textContent = title;
  body.innerHTML = html;
  if (top.view === 'calc') lcRenderResult();
}

// ==================== CALCULATOR VIEW ====================
function lcTypeLabel(p) {
  if (p.type === 'plate') return p.targetMode === 'perDumbbell' ? 'Plate-loaded dumbbell' : 'Plate-loaded';
  if (p.type === 'adjustable') return p.perDumbbell ? 'Adjustable dumbbell' : 'Adjustable';
  return 'REP QuickDraw';
}
// What the account read looks like right now. Returns html for a blocking state, or null when the lists can be shown.
function lcStatusHtml() {
  const st = eqState.status;
  if (st === 'idle' || st === 'loading') return '<div class="lc-state" data-testid="lc-state" data-state="loading"><div class="lc-empty-title">Loading your equipment…</div></div>';
  if (st === 'failed') return `<div class="lc-state" data-testid="lc-state" data-state="failed"><div class="lc-empty-title">Couldn’t load your equipment</div>
    <div class="lc-muted">${eqState.error === 'permission-denied' ? 'The server refused the request. Try signing out and in again.' : 'Something went wrong while reading your account' + (eqState.error ? ' (' + escapeHtml(eqState.error) + ')' : '') + '.'} Nothing has been changed.</div>
    <button class="btn btn-primary lc-full-btn" onclick="eqRetry()">Try again</button></div>`;
  if (st === 'cachedOnly' && !eqState.profiles.length && !eqState.inventories.length)
    return `<div class="lc-state" data-testid="lc-state" data-state="offline"><div class="lc-empty-title">Can’t reach your account</div>
    <div class="lc-muted">You seem to be offline, and this device has no saved copy of your account equipment yet. Your equipment isn’t gone; it will appear when you’re back online.</div>
    <button class="btn btn-secondary lc-full-btn" onclick="eqRetry()">Try again</button></div>`;
  return null;
}
function lcNoticesHtml() {
  let h = '';
  if (eqState.status === 'cachedOnly' || eqState.offline) h += '<div class="lc-notice" data-testid="lc-offline">Offline: showing the copy saved on this device. Changes can’t be saved until you’re back online.</div>';
  if (eqState.unreadable.length) h += `<div class="lc-notice" data-testid="lc-unreadable">${eqState.unreadable.length} saved item${eqState.unreadable.length > 1 ? 's' : ''} in your account couldn’t be read and ${eqState.unreadable.length > 1 ? 'are' : 'is'} hidden: ${eqState.unreadable.map(u => escapeHtml(u.name)).join(', ')}.</div>`;
  h += lcDeviceCopyBannerHtml();
  h += lcCopyClashHtml();
  return h;
}
// Copied equipment that now shares its name with different equipment (for
// example, made on another device at the very moment of copying).
function lcCopyClashHtml() {
  const uid = lcUid(); if (!uid || eqState.status !== 'ready') return '';
  const names = eqCopyNameClashes(uid); if (!names.length) return '';
  return `<div class="lc-notice" data-testid="lc-copy-clash">Two items now share ${names.length === 1 ? 'the name' : 'these names'}: ${names.map(n => '“' + escapeHtml(n) + '”').join(', ')}. One was copied from this device while another device added the other. Rename one in Manage Equipment so you can tell them apart.</div>`;
}
function lcDeviceCopyBannerHtml() {
  const uid = lcUid(); if (!uid || eqState.status !== 'ready') return '';
  const b = eqDeviceBackup(uid), done = eqCopyStatus(uid);
  if (b.status === 'unreadable') return '<div class="lc-notice" data-testid="lc-device-unreadable">Equipment saved on this device before account sync couldn’t be read. It has been left untouched.</div>';
  if (b.status !== 'ok') return '';
  if (done && done.completedAt) return `<div class="lc-notice lc-notice-quiet" data-testid="lc-device-done">This device’s earlier equipment was copied to your account. The device copy is kept as a backup. <button class="btn btn-ghost btn-sm" onclick="lcStartCopy()">Review again</button></div>`;
  return `<div class="lc-notice" data-testid="lc-device-banner">This device has equipment saved before your account kept equipment (${b.data.profiles.length} profile${b.data.profiles.length === 1 ? '' : 's'}, ${b.data.inventories.length} inventor${b.data.inventories.length === 1 ? 'y' : 'ies'}). It stays on this device until you copy it.
    <button class="btn btn-secondary btn-sm lc-full-btn" style="margin-top:8px" data-testid="lc-copy-start" onclick="lcStartCopy()">Copy this device’s equipment to your account</button></div>`;
}
function lcCalcHtml() {
  const d = lcState.data;
  const blocked = lcStatusHtml(); if (blocked) return blocked;
  const notice = lcNoticesHtml();
  if (!d.profiles.length) {
    return notice + `<div class="lc-empty" data-testid="lc-empty">
      <div class="lc-empty-title">No equipment yet</div>
      <div class="lc-muted">Add a profile to start calculating loads.</div>
      <div class="lc-add-grid">
        <button class="btn btn-primary" onclick="lcStartNewProfile('plate')">+ Plate-loaded</button>
        <button class="btn btn-secondary" onclick="lcStartNewProfile('adjustable')">+ Adjustable</button>
        <button class="btn btn-secondary" onclick="lcStartNewProfile('quickdraw')">+ REP QuickDraw</button>
      </div></div>`;
  }
  const p = lcCurrentProfile();
  lcSyncTargetBasis(p);
  const per = lcIsPerDumbbell(p);
  const opts = d.profiles.map(x => `<option value="${escapeHtml(x.id)}" ${x.id === p.id ? 'selected' : ''}>${escapeHtml(x.name)} · ${escapeHtml(x.unit)}</option>`).join('');
  return notice + `
    <div class="lc-profile-head">
      <label for="lc-profile-select">Equipment</label>
      <button class="btn btn-ghost btn-sm lc-manage-btn" onclick="lcNav('manage')">Manage Equipment</button>
    </div>
    <select id="lc-profile-select" onchange="lcSelectProfile(this.value)">${opts}</select>
    <div class="lc-type-line lc-muted">${escapeHtml(lcTypeLabel(p))}${p.type === 'plate' ? ' · starts at ' + escapeHtml(lcFmt(lcToM(p.startWeight))) + ' ' + escapeHtml(p.unit) : ''}</div>
    <div class="form-group lc-target-group">
      <label for="lc-target">${per ? 'Target per dumbbell' : (p.type === 'plate' ? 'Target total' : 'Target')} (${escapeHtml(p.unit)})</label>
      <div class="lc-target-wrap">
        <input type="text" inputmode="decimal" autocomplete="off" id="lc-target" value="${escapeHtml(lcState.target)}" placeholder="e.g. ${p.type === 'plate' && !per ? '185' : '25'}" oninput="lcState.target=this.value;lcRenderResult()">
        <span class="lc-unit-suffix">${escapeHtml(p.unit)}${per ? ' / dumbbell' : ''}</span>
      </div>
    </div>
    <div id="lc-result" class="lc-result" aria-live="polite"></div>
    ${p.type === 'quickdraw' ? `<button class="btn btn-secondary lc-full-btn" data-testid="lc-view-guide" onclick="lcNav('guide',{profileId:'${escapeHtml(p.id)}'})">View weight guide</button>` : ''}`;
}
function lcSelectProfile(id) {
  if (!lcProfile(id)) return;
  eqSetLastProfile(lcUid(), id);
  lcRender();
}
function lcWeightText(m, p) { return `${lcFmt(m)} ${p.unit}${lcIsPerDumbbell(p) ? ' per dumbbell' : ''}`; }
function lcPlatesText(perSide, p) {
  if (!perSide.length) return 'No plates';
  return perSide.map(x => `${lcFmt(x.sizeM)}${x.count > 1 ? ' × ' + x.count : ''}`).join(' + ');
}
function lcPlateOptionHtml(kind, o, p) {
  const chips = o.perSide.length
    ? o.perSide.map(x => `<span class="lc-chip">${lcFmt(x.sizeM)} ${escapeHtml(p.unit)}${x.count > 1 ? ' × ' + x.count : ''}</span>`).join('')
    : '<span class="lc-muted">No plates — starting weight only</span>';
  return `<div class="lc-option" data-kind="${kind}" data-total="${lcFmt(o.totalM)}" data-plates="${escapeHtml(o.perSide.map(x => lcFmt(x.sizeM) + 'x' + x.count).join(','))}">
    <div class="lc-option-head"><span class="lc-option-kind">${kind === 'exact' ? 'Exact' : kind === 'below' ? 'Nearest below' : 'Nearest above'}</span><span class="lc-option-total">${escapeHtml(lcWeightText(o.totalM, p))}</span></div>
    <div class="lc-option-sub">Per side${p.targetMode === 'perDumbbell' ? ' (each end of one dumbbell)' : ''}:</div>
    <div class="lc-chips">${chips}</div></div>`;
}
function lcRenderResult() {
  const el = document.getElementById('lc-result'); if (!el) return;
  const p = lcCurrentProfile(); if (!p) { el.innerHTML = ''; return; }
  const raw = String(lcState.target || '').trim();
  if (!raw) { el.innerHTML = `<div class="lc-muted lc-hint">Enter a target to see the ${p.type === 'plate' ? 'plates' : 'setting'}.</div>`; return; }
  const t = lcParseWeight(raw, { allowZero: true });
  if (t === null) { el.innerHTML = '<div class="lc-error" data-testid="lc-target-error">Enter a weight using numbers only, e.g. 185 or 47.5 (up to 3 decimals).</div>'; return; }
  if (p.type === 'plate') {
    const inv = lcInventory(p.inventoryId);
    if (!inv) { el.innerHTML = '<div class="lc-error">This profile’s plate inventory is missing. Edit it in Manage Equipment.</div>'; return; }
    if (inv.unit !== p.unit) { el.innerHTML = `<div class="lc-error">Units don’t match: this profile is in ${escapeHtml(p.unit)} but its inventory is in ${escapeHtml(inv.unit)}. Fix it in Manage Equipment.</div>`; return; }
    let r;
    try { r = lcSolvePlates(lcToM(p.startWeight), inv.plates.map(x => ({ sizeM: lcToM(x.size), pairs: x.pairs })), t); }
    catch (e) { el.innerHTML = '<div class="lc-error">This inventory has too many combinations to calculate.</div>'; return; }
    let html = '';
    if (r.exact) html += `<div class="lc-status lc-ok" data-testid="lc-status">✓ ${escapeHtml(lcWeightText(t, p))} is exact</div>` + lcPlateOptionHtml('exact', r.exact, p);
    else {
      html += `<div class="lc-status lc-warn" data-testid="lc-status">${escapeHtml(lcWeightText(t, p))} can’t be made exactly</div>`;
      if (t < lcToM(p.startWeight)) html += `<div class="lc-muted lc-note">That’s below the starting weight (${escapeHtml(lcFmt(lcToM(p.startWeight)))} ${escapeHtml(p.unit)}).</div>`;
      if (t > r.capacityM) html += `<div class="lc-muted lc-note">That’s above what your plates can load (${escapeHtml(lcFmt(r.capacityM))} ${escapeHtml(p.unit)}).</div>`;
      if (r.below) html += lcPlateOptionHtml('below', r.below, p);
      if (r.above) html += lcPlateOptionHtml('above', r.above, p);
    }
    el.innerHTML = html; return;
  }
  const settings = lcProfileSettingsM(p);
  const r = lcNearestSetting(settings, t);
  if (r.exact) {
    let html = `<div class="lc-status lc-ok" data-testid="lc-status">✓ ${escapeHtml(lcWeightText(t, p))} is available</div>`;
    if (p.type === 'quickdraw') html += lcQdFullHtml(t, p);
    el.innerHTML = html; return;
  }
  let html = `<div class="lc-status lc-warn" data-testid="lc-status">${escapeHtml(lcWeightText(t, p))} isn’t a setting</div>`;
  if (r.belowM === null) html += `<div class="lc-muted lc-note">That’s below the lightest setting.</div>`;
  if (r.aboveM === null) html += `<div class="lc-muted lc-note">That’s above the heaviest setting${p.type === 'quickdraw' ? ' for this set' : ''}.</div>`;
  html += '<div class="lc-near">';
  [['below', r.belowM], ['above', r.aboveM]].forEach(([k, m]) => {
    if (m === null) return;
    const inner = `<span class="lc-option-kind">${k === 'below' ? 'Closest below' : 'Closest above'}</span><span class="lc-option-total">${escapeHtml(lcWeightText(m, p))}</span>`;
    html += p.type === 'quickdraw'
      ? `<button class="lc-option lc-option-btn" data-kind="${k}" data-total="${lcFmt(m)}" onclick="lcNav('diagram',{weightM:${m},profileId:'${escapeHtml(p.id)}'})">${inner}<span class="lc-option-sub">Show diagram ›</span></button>`
      : `<div class="lc-option" data-kind="${k}" data-total="${lcFmt(m)}">${inner}</div>`;
  });
  el.innerHTML = html + '</div>';
}

// ==================== QUICKDRAW DIAGRAMS ====================
// The overview tiles and the full-size diagram are both drawn by
// lcQdRowsHtml from the same LC_QD_POSITIONS data.
function lcQdRowsHtml(m, big) {
  const pat = lcQdPattern(m);
  return pat.split('').map((c, i) => {
    const cls = c === 'F' ? 'lcq-five' : c === 'H' ? 'lcq-half' : 'lcq-off';
    const lab = `<span class="lcq-lab">${LC_QD_LABELS[i]}</span>`;
    return `<div class="lcq-row" data-pos="${i}" data-state="${c}">${lab}<span class="lcq-cell ${cls}"></span><span class="lcq-cell ${cls}"></span>${big ? `<span class="lcq-lab lcq-lab-r">${LC_QD_LABELS[i]}</span>` : ''}</div>`;
  }).join('');
}
function lcQdLegendHtml() {
  return `<div class="lcq-legend"><span><i class="lcq-sw lcq-five"></i>5 lb on</span><span><i class="lcq-sw lcq-half"></i>2.5 lb on</span><span><i class="lcq-sw lcq-off"></i>Off</span></div>`;
}
function lcQdFullHtml(m, p) {
  const uneven = lcQdIsUneven(m);
  return `<div class="lcq-panel">${lcQdLegendHtml()}
    <div class="lcq-full" data-testid="lcq-full" data-weight="${lcFmt(m)}" data-uneven="${uneven}">
      <div class="lcq-full-title">${lcFmt(m)}${uneven ? '<span class="lcq-ast">*</span>' : ''} <span class="lcq-full-unit">lb per dumbbell</span></div>
      ${uneven ? '<div class="lcq-uneven" data-testid="lcq-uneven">* Uneven loading — the two ends differ</div>' : ''}
      <div class="lcq-grid lcq-grid-big">${lcQdRowsHtml(m, true)}</div>
    </div></div>`;
}
function lcGuideHtml() {
  const p = lcProfile(lcTop().params.profileId) || lcCurrentProfile();
  if (!p || p.type !== 'quickdraw') return '<div class="lc-muted">Choose a REP QuickDraw profile first.</div>';
  const tiles = lcQdSettingsM(lcToM(p.maxSetting)).map(m => {
    const uneven = lcQdIsUneven(m);
    return `<button class="lcq-tile" data-testid="lcq-tile" data-weight="${lcFmt(m)}" aria-label="${lcFmt(m)} lb${uneven ? ', uneven loading' : ''}" onclick="lcNav('diagram',{weightM:${m},profileId:'${escapeHtml(p.id)}'})">
      <span class="lcq-tile-title">${lcFmt(m)}${uneven ? '<span class="lcq-ast">*</span>' : ''}</span>
      <span class="lcq-grid">${lcQdRowsHtml(m, false)}</span></button>`;
  }).join('');
  return `<div class="lcq-panel lcq-guide">
      <div class="lcq-guide-sub">${escapeHtml(p.name)} · lb per dumbbell · up to ${escapeHtml(lcFmt(lcToM(p.maxSetting)))} lb</div>
      ${lcQdLegendHtml()}
      <div class="lcq-note"><span class="lcq-ast">*</span> Uneven loading</div>
      <div class="lcq-tiles" data-testid="lcq-tiles">${tiles}</div>
      <div class="lcq-tap-hint">Tap a weight to see its full diagram.</div>
    </div>`;
}
function lcDiagramViewHtml() {
  const prm = lcTop().params;
  const p = lcProfile(prm.profileId) || lcCurrentProfile();
  if (!lcQdPattern(prm.weightM)) return '<div class="lc-muted">No diagram for that weight.</div>';
  return lcQdFullHtml(prm.weightM, p);
}

// ==================== MANAGE EQUIPMENT ====================
function lcManageHtml() {
  const d = lcState.data;
  const blocked = lcStatusHtml(); if (blocked) return blocked;
  const notices = lcNoticesHtml();
  const profs = d.profiles.length ? d.profiles.map(p => `
    <div class="lc-list-row" data-testid="lc-profile-row">
      <div class="lc-list-main"><div class="lc-list-name">${escapeHtml(p.name)}</div><div class="lc-muted lc-small">${escapeHtml(lcTypeLabel(p))} · ${escapeHtml(p.unit)}</div></div>
      <button class="btn btn-ghost btn-sm" onclick="lcStartEditProfile('${escapeHtml(p.id)}')">Edit</button>
      <button class="btn btn-danger btn-sm" onclick="lcDeleteProfile('${escapeHtml(p.id)}')">Delete</button>
    </div>`).join('') : '<div class="lc-muted lc-small">No equipment profiles yet.</div>';
  const invs = d.inventories.length ? d.inventories.map(i => {
    const users = eqDependents(i.id).length;
    return `<div class="lc-list-row" data-testid="lc-inventory-row">
      <div class="lc-list-main"><div class="lc-list-name">${escapeHtml(i.name)}</div><div class="lc-muted lc-small">${escapeHtml(i.unit)} · ${i.plates.filter(x => x.pairs > 0).map(x => lcFmt(lcToM(x.size)) + '×' + x.pairs).join(', ') || 'no plates'} · used by ${users}</div></div>
      <button class="btn btn-ghost btn-sm" onclick="lcStartEditInventory('${escapeHtml(i.id)}')">Edit</button>
      <button class="btn btn-danger btn-sm" onclick="lcDeleteInventory('${escapeHtml(i.id)}')">Delete</button>
    </div>`;
  }).join('') : '<div class="lc-muted lc-small">No plate inventories yet. One is needed for plate-loaded equipment.</div>';
  const missing = d.profiles.filter(p => p.type === 'plate' && !lcInventory(p.inventoryId));
  return notices + (missing.length ? `<div class="lc-notice" data-testid="lc-missing-ref">${missing.map(p => escapeHtml(p.name)).join(', ')}: plate inventory missing. Edit to choose another.</div>` : '') + `
    ${lcState.root === 'manage' && lcState.stack.length === 1 ? '<div class="lc-muted lc-small" style="margin-bottom:10px">Equipment for the Load Calculator, kept in your account.</div>' : ''}
    <div class="lc-section-label">Equipment profiles</div>${profs}
    <div class="lc-add-grid">
      <button class="btn btn-secondary btn-sm" onclick="lcStartNewProfile('plate')">+ Plate-loaded</button>
      <button class="btn btn-secondary btn-sm" onclick="lcStartNewProfile('adjustable')">+ Adjustable</button>
      <button class="btn btn-secondary btn-sm" onclick="lcStartNewProfile('quickdraw')">+ REP QuickDraw</button>
    </div>
    <div class="lc-section-label">Plate inventories <span class="lc-muted lc-small">(sizes and pairs, shared by plate-loaded profiles)</span></div>${invs}
    <div class="lc-add-grid"><button class="btn btn-secondary btn-sm" onclick="lcStartNewInventory()">+ Plate inventory</button></div>`;
}
// Runs an account write; while it runs, live redraws wait. Errors are shown, never swallowed.
async function lcWrite(fn, okMsg) {
  if (lcState.busy) return false;
  lcState.busy = true; lcSetBusyUi(true);
  try { const r = await fn(); if (okMsg) showToast(okMsg, 'success'); return r === undefined ? true : r; }
  catch (e) { const f = eqFriendly(e); lcFormError(f.message, f.eqCode); return false; }
  finally { lcState.busy = false; lcSetBusyUi(false); }
}
function lcSetBusyUi(on) { document.querySelectorAll('#lc-body .lc-save-btn').forEach(b => { b.disabled = on; if (on) b.dataset.label = b.dataset.label || b.textContent; b.textContent = on ? 'Saving…' : (b.dataset.label || b.textContent); }); }
function lcDeleteProfile(id) {
  const p = lcProfile(id); if (!p) return;
  confirm2('Delete Equipment', `Delete "${p.name}"?`, async () => {
    if (await lcWrite(() => eqDeleteProfile(id, p), 'Equipment deleted')) lcRender();
  });
}
function lcDeleteInventory(id) {
  const inv = lcInventory(id); if (!inv) return;
  if (eqDependents(id).length) { lcNav('invUsers', { inventoryId: id }); return; }
  confirm2('Delete Plate Inventory', `Delete "${inv.name}"?`, async () => {
    const r = await lcWrite(() => eqDeleteInventory(id, inv), null);
    if (r === 'deleted' || r === 'gone') { showToast('Plate inventory deleted', 'success'); lcRender(); }
    else if (eqDependents(id).length) lcNav('invUsers', { inventoryId: id });
  });
}
// An inventory can't be deleted while equipment uses it: move each user to another inventory, or delete it.
function lcInvUsersHtml() {
  const inv = lcInventory(lcTop().params.inventoryId);
  if (!inv) return '<div class="lc-muted" data-testid="lc-inv-gone">This inventory no longer exists.</div>';
  const users = eqDependents(inv.id);
  const others = lcState.data.inventories.filter(i => i.id !== inv.id && i.unit === inv.unit);
  const rows = users.map(p => `<div class="lc-list-row" data-testid="lc-dependent-row" data-id="${escapeHtml(p.id)}">
      <div class="lc-list-main"><div class="lc-list-name">${escapeHtml(p.name)}</div></div>
      ${p.missing ? '<span class="lc-muted lc-small">Not visible here</span>' : `${others.length ? `<select aria-label="Move ${escapeHtml(p.name)} to" data-testid="lc-move-select" onchange="if(this.value)lcMoveProfile('${escapeHtml(p.id)}',this.value)"><option value="">Move to…</option>${others.map(o => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.name)}</option>`).join('')}</select>` : ''}
      <button class="btn btn-danger btn-sm" onclick="lcDeleteProfile('${escapeHtml(p.id)}')">Delete</button>`}</div>`).join('');
  return `<div class="lc-notice" data-testid="lc-in-use">“${escapeHtml(inv.name)}” is used by ${users.length} piece${users.length === 1 ? '' : 's'} of equipment. Move each one to another ${escapeHtml(inv.unit)} inventory, or delete it, before deleting this inventory.</div>
    ${rows || '<div class="lc-muted lc-small">Nothing uses it any more.</div>'}
    ${!others.length && users.length ? `<div class="lc-muted lc-small" style="margin:8px 0">There’s no other ${escapeHtml(inv.unit)} inventory to move to. <button class="btn btn-ghost btn-sm" onclick="lcStartNewInventory()">+ Plate inventory</button></div>` : ''}
    <div id="lc-form-error" class="lc-error" style="display:none"></div>
    ${users.length ? '' : `<button class="btn btn-danger lc-full-btn" data-testid="lc-delete-now" onclick="lcDeleteInventory('${escapeHtml(inv.id)}')">Delete “${escapeHtml(inv.name)}”</button>`}`;
}
async function lcMoveProfile(profileId, invId) {
  if (await lcWrite(() => eqReassignProfile(profileId, invId), 'Equipment moved')) lcRender(); else lcRender();
}

// ---- profile editor ----
function lcDefaultUnit() { return (typeof appDb !== 'undefined' && appDb.unit === 'kg') ? 'kg' : 'lb'; }
function lcStartNewProfile(type) {
  const unit = type === 'quickdraw' ? 'lb' : lcDefaultUnit();
  const firstInv = lcState.data.inventories.find(i => i.unit === unit);
  const draft = { id: null, base: null, type, name: type === 'quickdraw' ? 'REP QuickDraw' : '', unit,
    startWeight: '', inventoryId: firstInv ? firstInv.id : '', targetMode: 'total',
    perDumbbell: true, mode: 'range', min: '', max: '', increment: '', list: '', maxSetting: '60' };
  lcState.drafts.profile = draft;
  lcNav('editProfile', { isNew: true });
}
function lcStartEditProfile(id) {
  const p = lcProfile(id); if (!p) return;
  lcState.drafts.profile = {
    id: p.id, base: p, type: p.type, name: p.name, unit: p.unit,
    startWeight: p.startWeight != null ? String(p.startWeight) : '', inventoryId: p.inventoryId || '', targetMode: p.targetMode || 'total',
    perDumbbell: p.perDumbbell !== false, mode: p.mode || 'range',
    min: p.min != null ? String(p.min) : '', max: p.max != null ? String(p.max) : '', increment: p.increment != null ? String(p.increment) : '',
    list: (p.list || []).map(x => lcFmt(lcToM(x))).join(', '), maxSetting: p.maxSetting != null ? String(p.maxSetting) : '60'
  };
  lcNav('editProfile', { isNew: false });
}
function lcDraftSet(kind, field, value, rerender) {
  const d = lcState.drafts[kind]; if (!d) return;
  d[field] = value;
  if (kind === 'profile' && field === 'unit' && d.type === 'plate') {
    const inv = lcInventory(d.inventoryId);
    if (!inv || inv.unit !== value) { const f = lcState.data.inventories.find(i => i.unit === value); d.inventoryId = f ? f.id : ''; }
  }
  if (rerender) { const sc = lcScroller(); const y = sc ? sc.scrollTop : 0; lcRender(); if (sc) sc.scrollTop = y; }
}
function lcField(label, id, kind, field, value, extra) {
  extra = extra || {};
  return `<div class="form-group"><label for="${id}">${label}</label><input type="text" id="${id}" autocomplete="off" ${extra.numeric ? 'inputmode="decimal"' : ''} placeholder="${extra.placeholder || ''}" value="${escapeHtml(String(value))}" oninput="lcDraftSet('${kind}','${field}',this.value)"></div>`;
}
function lcUnitSelect(kind, value, disabled) {
  return `<div class="form-group"><label for="lc-${kind}-unit">Unit</label><select id="lc-${kind}-unit" ${disabled ? 'disabled' : ''} onchange="lcDraftSet('${kind}','unit',this.value,true)">
    <option value="lb" ${value === 'lb' ? 'selected' : ''}>lb</option><option value="kg" ${value === 'kg' ? 'selected' : ''}>kg</option></select></div>`;
}
function lcEditProfileHtml() {
  const d = lcState.drafts.profile; if (!d) return '';
  let html = `<div class="lc-type-line lc-muted">${d.type === 'plate' ? 'Plate-loaded' : d.type === 'adjustable' ? 'Adjustable (preset weights)' : 'REP QuickDraw (lb, per dumbbell)'}</div>`;
  html += lcField('Name', 'lc-p-name', 'profile', 'name', d.name, { placeholder: d.type === 'plate' ? 'e.g. Straight bar' : 'e.g. Adjustable dumbbells' });
  if (d.conflict) html += `<div class="lc-notice" data-testid="lc-conflict">${escapeHtml(d.conflict)} <button class="btn btn-ghost btn-sm" onclick="lcReloadDraft('profile')">Load the latest version</button> <span class="lc-muted lc-small">(replaces what you typed)</span></div>`;
  if (d.type === 'plate') {
    html += lcUnitSelect('profile', d.unit);
    if (d.inventoryId && !lcInventory(d.inventoryId)) html += '<div class="lc-notice" data-testid="lc-inv-missing">Its plate inventory no longer exists. Choose another.</div>';
    html += lcField(`Starting weight, unloaded (${escapeHtml(d.unit)})`, 'lc-p-start', 'profile', 'startWeight', d.startWeight, { numeric: true, placeholder: 'e.g. 45' });
    html += `<div class="form-group"><label for="lc-p-mode">Target means</label><select id="lc-p-mode" onchange="lcDraftSet('profile','targetMode',this.value)">
      <option value="total" ${d.targetMode === 'total' ? 'selected' : ''}>Total on the bar or machine</option>
      <option value="perDumbbell" ${d.targetMode === 'perDumbbell' ? 'selected' : ''}>Weight per dumbbell</option></select></div>`;
    const invs = lcState.data.inventories.filter(i => i.unit === d.unit);
    html += `<div class="form-group"><label for="lc-p-inv">Plate inventory (${escapeHtml(d.unit)})</label>${invs.length
      ? `<select id="lc-p-inv" onchange="lcDraftSet('profile','inventoryId',this.value)"><option value="">Choose…</option>${invs.map(i => `<option value="${escapeHtml(i.id)}" ${i.id === d.inventoryId ? 'selected' : ''}>${escapeHtml(i.name)}</option>`).join('')}</select>`
      : `<div class="lc-muted lc-small">No ${escapeHtml(d.unit)} plate inventory yet.</div>`}
      <button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="lcStartNewInventory(true)">+ New ${escapeHtml(d.unit)} inventory</button></div>`;
  } else if (d.type === 'adjustable') {
    html += lcUnitSelect('profile', d.unit);
    html += `<label class="lc-check"><input type="checkbox" ${d.perDumbbell ? 'checked' : ''} onchange="lcDraftSet('profile','perDumbbell',this.checked)"> Weights are per dumbbell</label>`;
    html += `<div class="form-group"><label for="lc-p-amode">Settings</label><select id="lc-p-amode" onchange="lcDraftSet('profile','mode',this.value,true)">
      <option value="range" ${d.mode === 'range' ? 'selected' : ''}>Regular range (same step)</option>
      <option value="list" ${d.mode === 'list' ? 'selected' : ''}>Custom list (uneven jumps)</option></select></div>`;
    if (d.mode === 'range') {
      html += `<div class="lc-three">${lcField(`Lightest (${escapeHtml(d.unit)})`, 'lc-p-min', 'profile', 'min', d.min, { numeric: true, placeholder: '5' })}${lcField(`Heaviest (${escapeHtml(d.unit)})`, 'lc-p-max', 'profile', 'max', d.max, { numeric: true, placeholder: '50' })}${lcField(`Step (${escapeHtml(d.unit)})`, 'lc-p-inc', 'profile', 'increment', d.increment, { numeric: true, placeholder: '2.5' })}</div>`;
    } else {
      html += `<div class="form-group"><label for="lc-p-list">Available weights (${escapeHtml(d.unit)}), separated by commas</label><textarea id="lc-p-list" rows="3" placeholder="e.g. 5, 7.5, 10, 12.5, 15, 17.5, 20, 25, 30" oninput="lcDraftSet('profile','list',this.value)">${escapeHtml(d.list)}</textarea></div>`;
    }
  } else {
    html += `<div class="form-group"><label for="lc-p-qmax">Heaviest setting your set supports (lb)</label><select id="lc-p-qmax" onchange="lcDraftSet('profile','maxSetting',this.value)">${
      lcQdSettingsM(LC_QD_MAX_M).map(m => `<option value="${lcFmt(m)}" ${lcFmt(m) === d.maxSetting ? 'selected' : ''}>${lcFmt(m)} lb</option>`).join('')}</select></div>`;
    if (d.id) html += `<button class="btn btn-ghost btn-sm" style="margin-bottom:14px" onclick="lcNav('guide',{profileId:'${escapeHtml(d.id)}'})">View weight guide</button>`;
  }
  html += `<div id="lc-form-error" class="lc-error" style="display:none"></div>
    <button class="btn btn-primary lc-full-btn lc-save-btn" onclick="lcSaveProfileDraft()">Save</button>`;
  return html;
}
function lcFormError(msg, code) {
  const el = document.getElementById('lc-form-error');
  if (el) { el.textContent = msg; el.style.display = ''; el.dataset.code = code || 'invalid'; }
  showToast(msg, 'error');
  return false;
}
// After a conflict: replace the draft with the account's latest version (only when the lifter asks).
function lcReloadDraft(kind) {
  const d = lcState.drafts[kind]; if (!d || !d.id) return;
  lcState.stack.pop();
  if (kind === 'profile') { if (lcProfile(d.id)) lcStartEditProfile(d.id); else { lcState.drafts.profile = null; lcRender(); } }
  else { if (lcInventory(d.id)) lcStartEditInventory(d.id); else { lcState.drafts.inventory = null; lcRender(); } }
}
async function lcSaveProfileDraft() {
  const d = lcState.drafts.profile; if (!d || lcState.busy) return false;
  const name = String(d.name || '').trim();
  if (!name) return lcFormError('Give this equipment a name.');
  if (name.length > 40) return lcFormError('Keep the name to 40 characters or fewer.');
  if (d.unit !== 'lb' && d.unit !== 'kg') return lcFormError('Choose lb or kg.');
  const p = { id: d.id || eqNewId('eqp'), name, type: d.type, unit: d.type === 'quickdraw' ? 'lb' : d.unit };
  if (d.type === 'plate') {
    const start = lcParseWeight(d.startWeight, { allowZero: true });
    if (start === null) return lcFormError('Enter the starting weight as a number (0 or more, up to 3 decimals).');
    const inv = lcInventory(d.inventoryId);
    if (!inv) return lcFormError(`Choose a ${d.unit} plate inventory (or create one).`);
    if (inv.unit !== p.unit) return lcFormError(`That inventory is in ${inv.unit}. Choose a ${p.unit} inventory.`);
    if (d.targetMode !== 'total' && d.targetMode !== 'perDumbbell') return lcFormError('Choose what the target means.');
    Object.assign(p, { startWeight: start / 1000, inventoryId: inv.id, targetMode: d.targetMode });
  } else if (d.type === 'adjustable') {
    Object.assign(p, { perDumbbell: !!d.perDumbbell, mode: d.mode === 'list' ? 'list' : 'range' });
    if (p.mode === 'range') {
      const min = lcParseWeight(d.min), max = lcParseWeight(d.max), inc = lcParseWeight(d.increment);
      if (min === null || max === null || inc === null) return lcFormError('Enter lightest, heaviest and step as numbers greater than 0.');
      if (max < min) return lcFormError('Heaviest must be at least the lightest.');
      if ((max - min) % inc !== 0) return lcFormError('Heaviest minus lightest must be a whole number of steps.');
      if ((max - min) / inc + 1 > LC_MAX_SETTINGS) return lcFormError(`That’s more than ${LC_MAX_SETTINGS} settings. Use a bigger step.`);
      Object.assign(p, { min: min / 1000, max: max / 1000, increment: inc / 1000 });
    } else {
      const parts = String(d.list || '').split(/[\s,;]+/).filter(Boolean);
      if (!parts.length) return lcFormError('List at least one weight.');
      const ms = [];
      for (const s of parts) { const m = lcParseWeight(s); if (m === null) return lcFormError(`"${s}" isn’t a valid weight.`); if (ms.indexOf(m) === -1) ms.push(m); }
      if (ms.length > LC_MAX_SETTINGS) return lcFormError(`Use ${LC_MAX_SETTINGS} weights or fewer.`);
      ms.sort((a, b) => a - b);
      p.list = ms.map(m => m / 1000);
    }
  } else if (d.type === 'quickdraw') {
    const mx = lcParseWeight(d.maxSetting);
    if (mx === null || mx < LC_QD_MIN_M || mx > LC_QD_MAX_M || (mx - LC_QD_MIN_M) % LC_QD_STEP_M !== 0) return lcFormError('Choose a maximum from 5 to 60 lb.');
    p.maxSetting = mx / 1000;
  } else return lcFormError('Unknown equipment type.');
  const ok = await lcWrite(() => eqSaveProfile(p, d.base), null);
  if (!ok) { lcNoteConflict('profile'); return false; }
  if (lcState.drafts.profile !== d) return true;   // closed or account changed meanwhile
  eqSetLastProfile(lcUid(), p.id);
  lcState.drafts.profile = null;
  showToast('Equipment saved', 'success');
  lcResetTo(lcState.root === 'manage' ? 'manage' : 'calc');
  return true;
}

// ---- inventory editor ----
// When a save failed because the account changed, say so in the editor (the typed input stays).
function lcNoteConflict(kind) {
  const el = document.getElementById('lc-form-error'); const d = lcState.drafts[kind];
  if (!d || !el || ['conflict', 'deleted'].indexOf(el.dataset.code) === -1) return;
  d.conflict = el.textContent;
  if (el.dataset.code === 'deleted') { d.id = null; d.base = null; d.conflict += ' Saving again will create it as new.'; }
  const sc = lcScroller(); const y = sc ? sc.scrollTop : 0; const msg = el.textContent, code = el.dataset.code;
  lcRender(); if (sc) sc.scrollTop = y; lcFormError(msg, code);
}
function lcPresetPlates(unit) { return (unit === 'kg' ? [25, 20, 15, 10, 5, 2.5, 1.25] : [45, 35, 25, 10, 5, 2.5]).map(s => ({ size: String(s), pairs: '0' })); }
function lcStartNewInventory(fromProfile) {
  const unit = fromProfile && lcState.drafts.profile ? lcState.drafts.profile.unit : lcDefaultUnit();
  lcState.drafts.inventory = { id: null, base: null, name: '', unit, plates: lcPresetPlates(unit), lockedUnit: !!fromProfile };
  lcNav('editInventory', { isNew: true, fromProfile: !!fromProfile });
}
function lcStartEditInventory(id) {
  const inv = lcInventory(id); if (!inv) return;
  lcState.drafts.inventory = { id: inv.id, base: inv, name: inv.name, unit: inv.unit, plates: inv.plates.map(x => ({ size: lcFmt(lcToM(x.size)), pairs: String(x.pairs) })) };
  lcNav('editInventory', { isNew: false });
}
function lcInvPlateSet(i, field, value) { const d = lcState.drafts.inventory; if (d && d.plates[i]) d.plates[i][field] = value; }
function lcInvAddRow() { const d = lcState.drafts.inventory; if (!d) return; d.plates.push({ size: '', pairs: '' }); lcDraftSet('inventory', 'plates', d.plates, true); }
function lcInvRemoveRow(i) { const d = lcState.drafts.inventory; if (!d) return; d.plates.splice(i, 1); lcDraftSet('inventory', 'plates', d.plates, true); }
function lcEditInventoryHtml() {
  const d = lcState.drafts.inventory; if (!d) return '';
  const rows = d.plates.map((x, i) => `<div class="lc-plate-row" data-testid="lc-plate-row">
      <input type="text" inputmode="decimal" autocomplete="off" aria-label="Plate size" placeholder="Size" value="${escapeHtml(x.size)}" oninput="lcInvPlateSet(${i},'size',this.value)">
      <span class="lc-muted lc-small">${escapeHtml(d.unit)}</span>
      <input type="text" inputmode="numeric" autocomplete="off" aria-label="Pairs" placeholder="Pairs" value="${escapeHtml(x.pairs)}" oninput="lcInvPlateSet(${i},'pairs',this.value)">
      <span class="lc-muted lc-small">pairs</span>
      <button class="btn-icon" aria-label="Remove plate size" onclick="lcInvRemoveRow(${i})">✕</button></div>`).join('');
  const used = d.id ? eqDependents(d.id) : [];
  return `${d.conflict ? `<div class="lc-notice" data-testid="lc-conflict">${escapeHtml(d.conflict)} <button class="btn btn-ghost btn-sm" onclick="lcReloadDraft('inventory')">Load the latest version</button> <span class="lc-muted lc-small">(replaces what you typed)</span></div>` : ''}
    ${used.length ? `<div class="lc-muted lc-small" data-testid="lc-shared-note" style="margin-bottom:10px">Shared by ${used.map(u => escapeHtml(u.name)).join(', ')}. Changes apply to all of them.</div>` : ''}
    ${lcField('Name', 'lc-i-name', 'inventory', 'name', d.name, { placeholder: 'e.g. Garage plates' })}
    ${lcUnitSelect('inventory', d.unit, d.lockedUnit || used.length > 0)}
    <div class="lc-section-label">Plates <span class="lc-muted lc-small">(1 pair = one plate for each side; 0 if you have none)</span></div>
    ${rows}
    <button class="btn btn-ghost btn-sm" style="margin:4px 0 14px" onclick="lcInvAddRow()">+ Plate size</button>
    <div id="lc-form-error" class="lc-error" style="display:none"></div>
    <button class="btn btn-primary lc-full-btn lc-save-btn" onclick="lcSaveInventoryDraft()">Save</button>`;
}
async function lcSaveInventoryDraft() {
  const d = lcState.drafts.inventory; if (!d || lcState.busy) return false;
  const name = String(d.name || '').trim();
  if (!name) return lcFormError('Give this inventory a name.');
  if (name.length > 40) return lcFormError('Keep the name to 40 characters or fewer.');
  if (d.unit !== 'lb' && d.unit !== 'kg') return lcFormError('Choose lb or kg.');
  if (!d.plates.length) return lcFormError('Add at least one plate size.');
  if (d.plates.length > LC_MAX_PLATE_TYPES) return lcFormError(`Use ${LC_MAX_PLATE_TYPES} plate sizes or fewer.`);
  const seen = {}, plates = [];
  for (const row of d.plates) {
    const s = lcParseWeight(row.size);
    if (s === null) return lcFormError(`"${row.size}" isn’t a valid plate size.`);
    const n = lcParseCount(row.pairs, LC_MAX_PAIRS);
    if (n === null) return lcFormError(`Enter pairs for the ${lcFmt(s)} ${d.unit} plate as a whole number from 0 to ${LC_MAX_PAIRS}.`);
    if (seen[s]) return lcFormError(`${lcFmt(s)} ${d.unit} is listed twice.`);
    seen[s] = true; plates.push({ size: s / 1000, pairs: n });
  }
  plates.sort((a, b) => b.size - a.size);
  if (d.id) {
    const clash = lcState.data.profiles.filter(p => p.type === 'plate' && p.inventoryId === d.id && p.unit !== d.unit);
    if (clash.length) return lcFormError(`This inventory is used by ${clash.map(c => c.name).join(', ')} (${clash[0].unit}). Change those profiles first, so pounds and kilograms don’t mix.`);
  }
  const inv = { id: d.id || eqNewId('eqi'), name, unit: d.unit, plates };
  const ok = await lcWrite(() => eqSaveInventory(inv, d.base), null);
  if (!ok) { lcNoteConflict('inventory'); return false; }
  if (lcState.drafts.inventory !== d) return true;
  lcState.drafts.inventory = null;
  showToast('Plate inventory saved', 'success');
  const fromProfile = lcTop().params.fromProfile;
  if (fromProfile && lcState.drafts.profile) lcState.drafts.profile.inventoryId = inv.id;
  lcBack();
  return true;
}

// ==================== COPY THIS DEVICE'S EQUIPMENT ====================
// Preview first (copy / already in your account / conflicts / can't copy);
// nothing is written until "Copy". Back cancels with nothing written. The
// device's own data is never changed or deleted. Retrying after an
// interruption resumes safely: items already copied are recognised.
function lcStartCopy() {
  const uid = lcUid(); const b = eqDeviceBackup(uid);
  if (b.status !== 'ok') { showToast('There’s no readable equipment on this device to copy.', 'error'); return; }
  lcState.copy = { choices: {}, running: false, progress: null, error: null, result: null };
  lcNav('copy');
}
function lcCopyPlan() {
  const uid = lcUid(); const b = eqDeviceBackup(uid); if (b.status !== 'ok') return null;
  const st = eqCopyStatus(uid);
  // Before the first copy the id isn't stored yet: plan with a provisional id; it is fixed when copying starts.
  const dcid = st && st.deviceCopyId && !st.completedAt ? st.deviceCopyId : (lcState.copy.provisionalId || (lcState.copy.provisionalId = 'dc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)));
  return { plan: eqPlanCopy(b.data, { profiles: eqState.profiles, inventories: eqState.inventories }, dcid, lcState.copy.choices), local: b.data };
}
function lcCopyChoose(key, value) { lcState.copy.choices[key] = value; const sc = lcScroller(); const y = sc ? sc.scrollTop : 0; lcRender(); if (sc) sc.scrollTop = y; }
function lcCopyHtml() {
  const c = lcState.copy; if (!c) return '';
  const blocked = lcStatusHtml(); if (blocked) return blocked;
  if (eqState.status !== 'ready') return '<div class="lc-notice">Your account must be online to copy equipment.</div>';
  if (c.result) return lcCopyClashHtml() + `<div class="lc-state" data-testid="lc-copy-done"><div class="lc-empty-title">Copied</div>
    <div class="lc-muted">${c.result.copied} item${c.result.copied === 1 ? '' : 's'} copied${c.result.reused ? ', ' + c.result.reused + ' already in your account' : ''}${c.result.alreadyCopied ? ', ' + c.result.alreadyCopied + ' copied earlier' : ''}${c.result.skipped ? ', ' + c.result.skipped + ' skipped' : ''}${c.result.blocked ? ', ' + c.result.blocked + ' couldn’t be copied' : ''}. The calculator now uses your account equipment. This device’s earlier copy is kept as a backup.</div>
    <button class="btn btn-primary lc-full-btn" onclick="lcState.copy=null;lcResetTo(lcState.root)">Done</button></div>`;
  const r = lcCopyPlan(); if (!r) return '<div class="lc-muted">There’s nothing readable on this device to copy.</div>';
  const { plan } = r;
  const lbl = { copy: 'Will be copied', alreadyCopied: 'Already copied from this device', reuse: 'Already in your account', conflict: 'Name already used — choose', skip: 'Skipped', blocked: 'Can’t be copied' };
  const row = it => {
    const key = it.kind + ':' + it.localId; const ch = c.choices[key];
    let extra = '';
    if (it.status === 'copy' && it.newName && it.newName !== it.name) extra = `<div class="lc-muted lc-small">Will be named “${escapeHtml(it.newName)}”</div>`;
    if (it.status === 'reuse') extra = `<div class="lc-muted lc-small">Same as “${escapeHtml(it.accountName)}”, so it won’t be copied again.</div>`;
    if (it.status === 'blocked' || it.status === 'conflict') extra = `<div class="lc-muted lc-small">${escapeHtml(it.reason || '')}</div>`;
    const btns = it.status === 'conflict' || (ch && ch !== 'copyAnyway')
      ? `<div class="lc-copy-choices"><button class="btn btn-sm ${ch === 'keepBoth' ? 'btn-primary' : 'btn-secondary'}" data-testid="lc-keep-both" onclick="lcCopyChoose('${escapeHtml(key)}','keepBoth')">Keep both</button><button class="btn btn-sm ${ch === 'skip' ? 'btn-primary' : 'btn-secondary'}" data-testid="lc-skip" onclick="lcCopyChoose('${escapeHtml(key)}','skip')">Skip</button></div>` : '';
    return `<div class="lc-list-row lc-copy-row" data-testid="lc-copy-row" data-kind="${it.kind}" data-status="${it.status}" data-name="${escapeHtml(it.name || '')}">
      <div class="lc-list-main"><div class="lc-list-name">${escapeHtml(it.name || '(unnamed)')} <span class="lc-muted lc-small">· ${it.kind === 'inventory' ? 'plate inventory' : 'equipment'}</span></div>
      <div class="lc-small lc-copy-status">${lbl[it.status]}</div>${extra}${btns}</div></div>`;
  };
  const anything = plan.counts.copy > 0;
  return `<div class="lc-muted lc-small" style="margin-bottom:10px">Review what will happen. Nothing is copied until you press Copy, and nothing on this device is changed or deleted. Other settings and unfinished workouts aren’t copied.</div>
    ${plan.items.map(row).join('')}
    <div id="lc-form-error" class="lc-error" style="display:${c.error ? '' : 'none'}">${escapeHtml(c.error || '')}</div>
    ${c.progress ? `<div class="lc-muted lc-small" data-testid="lc-copy-progress">Copying… ${c.progress.done} of ${c.progress.total}</div>` : ''}
    <button class="btn btn-primary lc-full-btn lc-save-btn" data-testid="lc-copy-go" ${!plan.ready || c.running ? 'disabled' : ''} onclick="lcRunCopy()">${!plan.ready ? 'Choose for each name conflict' : anything ? 'Copy ' + plan.counts.copy + ' item' + (plan.counts.copy === 1 ? '' : 's') : 'Finish (nothing new to copy)'}</button>
    <button class="btn btn-ghost lc-full-btn" data-testid="lc-copy-cancel" ${c.running ? 'disabled' : ''} onclick="lcState.copy=null;lcBack()">Cancel</button>`;
}
async function lcRunCopy() {
  const c = lcState.copy; if (!c || c.running) return;
  const uid = lcUid();
  // Fix this device's copy id before writing anything, so an interrupted copy resumes with the same ids.
  const st = eqCopyStatus(uid);
  if (!(st && st.deviceCopyId && !st.completedAt)) {
    if (!eqSetCopyStatus(uid, { deviceCopyId: c.provisionalId, completedAt: null, previous: st && st.completedAt ? st : null, created: (st && st.created) || [] })) { c.error = 'This browser couldn’t remember the copy, so nothing was copied.'; lcRender(); return; }
  }
  const r = lcCopyPlan(); if (!r || !r.plan.ready) return;
  c.running = true; c.error = null; c.progress = { done: 0, total: r.plan.counts.copy + 1 }; lcState.busy = true; lcRender();
  try {
    c.result = await eqRunCopy(r.plan, r.local, pr => { c.progress = pr; const el = document.querySelector('[data-testid="lc-copy-progress"]'); if (el) el.textContent = `Copying… ${pr.done} of ${pr.total}`; });
  } catch (e) { const f = eqFriendly(e); c.error = f.eqCode === 'stale' ? f.message : f.message + ' Anything already copied is safe; pressing Copy again continues without duplicating.'; c.errorCode = f.eqCode; }
  finally { c.running = false; c.progress = null; lcState.busy = false; }
  if (lcState.copy === c && lcUid() === uid) lcRender();
}
