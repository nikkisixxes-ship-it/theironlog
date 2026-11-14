// ==================== LOAD CALCULATOR ====================
// A standalone tool opened from the active Workout Logger's "•••" menu.
// It never reads or writes the workout: no sets, prescriptions,
// progression, HISTORY, the workout timer, the recovery draft, or Firestore.
//
// EQUIPMENT is kept on this device only, per signed-in user, in
// localStorage under LC_STORE_KEY_PREFIX + uid. The pattern (prefix + uid,
// every storage access guarded) matches the active-workout recovery draft
// in app-core.js.
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
const LC_MAX_SETTINGS = 1000;
const LC_DP_STATE_LIMIT = 200000;

// ---- REP QuickDraw switch positions ----
// Read from the user's "REP Quickdraw" chart (12 positions, top to bottom,
// in the chart's own orientation). Both columns of the chart are identical
// in every setting, so one string per weight describes the whole diagram.
//   '-' off   'F' 5 lb position on   'H' 2.5 lb position on
// Position labels (LC_QD_LABELS) are the chart's own side labels. Each
// string was checked: 5 + 5 x (F count) + 2.5 x (H count) = its weight.
// The "two ends" are positions 1-6 (top) and 7-12 (bottom); a setting is
// UNEVEN when those two ends carry different weight.
const LC_QD_LABELS = [5, 5, 5, 5, 5, 2.5, 2.5, 5, 5, 5, 5, 5];
const LC_QD_POSITIONS = {
  '5': '------------',
  '7.5': '------H-----',
  '10': '-----HH-----',
  '12.5': '-----H-F----',
  '15': '----F--F----',
  '17.5': '----F-HF----',
  '20': '----FHHF----',
  '22.5': '----FH-FF---',
  '25': '---FF--FF---',
  '27.5': '---FF-HFF---',
  '30': '---FFHHFF---',
  '32.5': '---FFH-FFF--',
  '35': '--FFF--FFF--',
  '37.5': '--FFF-HFFF--',
  '40': '--FFFHHFFF--',
  '42.5': '--FFFH-FFFF-',
  '45': '-FFFF--FFFF-',
  '47.5': '-FFFF-HFFFF-',
  '50': '-FFFFHHFFFF-',
  '52.5': '-FFFFH-FFFFF',
  '55': 'FFFFF--FFFFF',
  '57.5': 'FFFFF-HFFFFF',
  '60': 'FFFFFHHFFFFF',
};
const LC_QD_MIN_M = 5000, LC_QD_MAX_M = 60000, LC_QD_STEP_M = 2500;

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
function lcToM(n) { return Math.round(Number(n) * 1000); }
function lcFmt(m) {
  let s = (m / 1000).toFixed(3);
  s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}
function lcGcd(a, b) { while (b) { const t = a % b; a = b; b = t; } return a; }

// ==================== SOLVERS (pure) ====================
// Plate-loaded. startM: unloaded weight; plates: [{sizeM, pairs}] (one pair
// = one plate per side); targetM: the target. Returns
//   { exact, below, above, capacityM } with each option
//   { totalM, perSide:[{sizeM,count}], plateCount } (null when none).
// Exact is the combination with the FEWEST plates per side; ties go to the
// combination using more of the heavier plates (compared heaviest first).
// The starting weight alone (no plates) is a valid result.
function lcPlateBetter(a, b) {
  const na = a.reduce((x, y) => x + y, 0), nb = b.reduce((x, y) => x + y, 0);
  if (na !== nb) return na < nb;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function lcSolvePlates(startM, plates, targetM) {
  const types = plates.filter(p => p.pairs > 0 && p.sizeM > 0).slice().sort((a, b) => b.sizeM - a.sizeM);
  // Heaviest possible load = every plate on. Needs no search.
  const capacityM = startM + 2 * types.reduce((a, t) => a + t.sizeM * t.pairs, 0);
  // SHORT-CIRCUIT: a target at or below the starting weight never needs the
  // combination search (plates only add weight). At the starting weight the
  // answer is exact with no plates; below it, the unloaded weight is the
  // nearest achievable load above, and nothing lighter exists.
  if (targetM <= startM) {
    const bare = { totalM: startM, perSide: [], plateCount: 0 };
    return targetM === startM
      ? { exact: bare, below: null, above: null, capacityM }
      : { exact: null, below: null, above: bare, capacityM };
  }
  let g = 0; types.forEach(t => { g = lcGcd(g, t.sizeM); });
  const n = types.length;
  let best = new Map([[0, new Array(n).fill(0)]]); // per-side sum in g-units -> counts
  types.forEach((t, i) => {
    const step = t.sizeM / g;
    const next = new Map(best);
    for (const [s, c] of best) {
      for (let k = 1; k <= t.pairs; k++) {
        const ns = s + k * step;
        const cand = c.slice(); cand[i] += k;
        const cur = next.get(ns);
        if (!cur) {
          // The limit is enforced as each NEW state is added, so one pass
          // can never build an oversized map before the check.
          if (next.size >= LC_DP_STATE_LIMIT) throw new Error('too many combinations');
          next.set(ns, cand);
        } else if (lcPlateBetter(cand, cur)) next.set(ns, cand);
      }
    }
    best = next;
  });
  const opt = (s) => {
    const c = best.get(s);
    return {
      totalM: startM + 2 * s * g,
      perSide: c.map((count, i) => ({ sizeM: types[i].sizeM, count })).filter(x => x.count > 0),
      plateCount: c.reduce((x, y) => x + y, 0)
    };
  };
  let exact = null, belowS = null, aboveS = null;
  for (const s of best.keys()) {
    const tot = startM + 2 * s * g;
    if (tot === targetM) exact = s;
    else if (tot < targetM) { if (belowS === null || s > belowS) belowS = s; }
    else if (aboveS === null || s < aboveS) aboveS = s;
  }
  return {
    exact: exact === null ? null : opt(exact),
    below: belowS === null ? null : opt(belowS),
    above: aboveS === null ? null : opt(aboveS),
    capacityM
  };
}
// Preset settings (sorted milli list). Returns { exact, belowM, aboveM }.
function lcNearestSetting(settingsM, targetM) {
  let exact = false, belowM = null, aboveM = null;
  settingsM.forEach(s => {
    if (s === targetM) exact = true;
    else if (s < targetM) { if (belowM === null || s > belowM) belowM = s; }
    else if (aboveM === null || s < aboveM) aboveM = s;
  });
  return { exact, belowM, aboveM };
}
function lcQdSettingsM(maxSettingM) {
  const out = [];
  for (let m = LC_QD_MIN_M; m <= Math.min(maxSettingM, LC_QD_MAX_M); m += LC_QD_STEP_M) out.push(m);
  return out;
}
function lcQdPattern(m) { return LC_QD_POSITIONS[lcFmt(m)] || null; }
function lcQdEndWeights(m) {
  const p = lcQdPattern(m); if (!p) return null;
  let top = 0, bottom = 0;
  for (let i = 0; i < 12; i++) {
    const w = p[i] === '-' ? 0 : lcToM(LC_QD_LABELS[i]);
    if (i < 6) top += w; else bottom += w;
  }
  return { top, bottom };
}
function lcQdIsUneven(m) { const e = lcQdEndWeights(m); return !!e && e.top !== e.bottom; }
function lcProfileSettingsM(p) {
  if (p.type === 'quickdraw') return lcQdSettingsM(lcToM(p.maxSetting));
  if (p.type !== 'adjustable') return [];
  if (p.mode === 'list') return (p.list || []).map(lcToM).sort((a, b) => a - b);
  const out = []; const min = lcToM(p.min), max = lcToM(p.max), inc = lcToM(p.increment);
  if (!(inc > 0)) return out;
  for (let m = min; m <= max && out.length <= LC_MAX_SETTINGS; m += inc) out.push(m);
  return out;
}
function lcIsPerDumbbell(p) {
  return p.type === 'quickdraw' || (p.type === 'plate' && p.targetMode === 'perDumbbell') || (p.type === 'adjustable' && !!p.perDumbbell);
}

// ==================== STORAGE ====================
function lcUid() { return (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.uid) || 'signed-out'; }
function lcStore() { try { return (typeof localStorage !== 'undefined') ? localStorage : null; } catch (e) { return null; } }
function lcEmptyData() { return { schema: LC_SCHEMA, version: LC_VERSION, inventories: [], profiles: [], lastProfileId: null }; }
function lcLoad() {
  const store = lcStore();
  let raw = null;
  try { raw = store ? store.getItem(LC_STORE_KEY_PREFIX + lcUid()) : null; } catch (e) { raw = null; }
  if (!raw) return { data: lcEmptyData(), problem: null };
  try {
    const d = JSON.parse(raw);
    if (!d || d.schema !== LC_SCHEMA || typeof d.version !== 'number' || d.version > LC_VERSION ||
        !Array.isArray(d.inventories) || !Array.isArray(d.profiles)) throw new Error('shape');
    return { data: d, problem: null };
  } catch (e) {
    // Never overwrite something we could not read until the user saves.
    return { data: lcEmptyData(), problem: 'unreadable' };
  }
}
function lcSave() {
  const store = lcStore();
  try {
    if (!store) throw new Error('no storage');
    store.setItem(LC_STORE_KEY_PREFIX + lcUid(), JSON.stringify(lcState.data));
    lcState.problem = null;
    return true;
  } catch (e) {
    showToast('This browser couldn’t save your equipment. It will work until the app is closed.', 'error');
    return false;
  }
}
function lcNewId(prefix) { return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// ==================== UI STATE ====================
// stack: navigation history inside the dialog. Each entry remembers its own
// scroll position, so "Back" returns exactly where the user was.
let lcState = { data: null, problem: null, stack: [], target: '', targetBasis: null, drafts: {} };

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

function openLoadCalculator() {
  if (!(typeof currentWorkout !== 'undefined' && currentWorkout && !currentWorkout._isEdit)) return;
  const r = lcLoad();
  lcState.data = r.data; lcState.problem = r.problem;
  lcState.stack = [{ view: 'calc', scroll: 0 }];
  lcState.drafts = {};
  const ov = document.getElementById('modal-load-calc');
  ov.classList.add('lc-top');
  lcRender();
  openModal('modal-load-calc');
  const sc = lcScroller(); if (sc) sc.scrollTop = 0;
}
function closeLoadCalculator() { closeModal('modal-load-calc'); }
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
  lcState.stack = [{ view: 'calc', scroll: 0 }];
  if (view && view !== 'calc') lcState.stack.push({ view, params: params || {}, scroll: 0 });
  lcRender();
  const sc = lcScroller(); if (sc) sc.scrollTop = 0;
}

function lcRender() {
  const top = lcTop();
  const titleEl = document.getElementById('lc-title');
  const body = document.getElementById('lc-body');
  const backBtn = document.getElementById('lc-back-btn');
  if (!top || !body) return;
  backBtn.style.display = lcState.stack.length > 1 ? '' : 'none';
  body.setAttribute('data-view', top.view);
  let title = 'Load Calculator', html = '';
  switch (top.view) {
    case 'calc': html = lcCalcHtml(); break;
    case 'manage': title = 'Manage Equipment'; html = lcManageHtml(); break;
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
function lcCalcHtml() {
  const d = lcState.data;
  const notice = lcState.problem === 'unreadable'
    ? '<div class="lc-notice">Saved equipment on this device couldn’t be read. It will be replaced when you save new equipment.</div>' : '';
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
  lcState.data.lastProfileId = id;
  lcSave();
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
  const profs = d.profiles.length ? d.profiles.map(p => `
    <div class="lc-list-row" data-testid="lc-profile-row">
      <div class="lc-list-main"><div class="lc-list-name">${escapeHtml(p.name)}</div><div class="lc-muted lc-small">${escapeHtml(lcTypeLabel(p))} · ${escapeHtml(p.unit)}</div></div>
      <button class="btn btn-ghost btn-sm" onclick="lcStartEditProfile('${escapeHtml(p.id)}')">Edit</button>
      <button class="btn btn-danger btn-sm" onclick="lcDeleteProfile('${escapeHtml(p.id)}')">Delete</button>
    </div>`).join('') : '<div class="lc-muted lc-small">No equipment profiles yet.</div>';
  const invs = d.inventories.length ? d.inventories.map(i => {
    const users = d.profiles.filter(p => p.type === 'plate' && p.inventoryId === i.id).length;
    return `<div class="lc-list-row" data-testid="lc-inventory-row">
      <div class="lc-list-main"><div class="lc-list-name">${escapeHtml(i.name)}</div><div class="lc-muted lc-small">${escapeHtml(i.unit)} · ${i.plates.filter(x => x.pairs > 0).map(x => lcFmt(lcToM(x.size)) + '×' + x.pairs).join(', ') || 'no plates'} · used by ${users}</div></div>
      <button class="btn btn-ghost btn-sm" onclick="lcStartEditInventory('${escapeHtml(i.id)}')">Edit</button>
      <button class="btn btn-danger btn-sm" onclick="lcDeleteInventory('${escapeHtml(i.id)}')">Delete</button>
    </div>`;
  }).join('') : '<div class="lc-muted lc-small">No plate inventories yet. One is needed for plate-loaded equipment.</div>';
  return `
    <div class="lc-section-label">Equipment profiles</div>${profs}
    <div class="lc-add-grid">
      <button class="btn btn-secondary btn-sm" onclick="lcStartNewProfile('plate')">+ Plate-loaded</button>
      <button class="btn btn-secondary btn-sm" onclick="lcStartNewProfile('adjustable')">+ Adjustable</button>
      <button class="btn btn-secondary btn-sm" onclick="lcStartNewProfile('quickdraw')">+ REP QuickDraw</button>
    </div>
    <div class="lc-section-label">Plate inventories <span class="lc-muted lc-small">(sizes and pairs, shared by plate-loaded profiles)</span></div>${invs}
    <div class="lc-add-grid"><button class="btn btn-secondary btn-sm" onclick="lcStartNewInventory()">+ Plate inventory</button></div>`;
}
function lcDeleteProfile(id) {
  const p = lcProfile(id); if (!p) return;
  confirm2('Delete Equipment', `Delete "${p.name}"?`, () => {
    lcState.data.profiles = lcState.data.profiles.filter(x => x.id !== id);
    if (lcState.data.lastProfileId === id) lcState.data.lastProfileId = lcState.data.profiles[0] ? lcState.data.profiles[0].id : null;
    lcSave(); lcRender();
  });
}
function lcDeleteInventory(id) {
  const inv = lcInventory(id); if (!inv) return;
  const users = lcState.data.profiles.filter(p => p.type === 'plate' && p.inventoryId === id);
  if (users.length) { showToast(`Used by ${users.map(u => u.name).join(', ')}. Change or delete those first.`, 'error'); return; }
  confirm2('Delete Plate Inventory', `Delete "${inv.name}"?`, () => {
    lcState.data.inventories = lcState.data.inventories.filter(x => x.id !== id);
    lcSave(); lcRender();
  });
}

// ---- profile editor ----
function lcDefaultUnit() { return (typeof appDb !== 'undefined' && appDb.unit === 'kg') ? 'kg' : 'lb'; }
function lcStartNewProfile(type) {
  const unit = type === 'quickdraw' ? 'lb' : lcDefaultUnit();
  const firstInv = lcState.data.inventories.find(i => i.unit === unit);
  const draft = { id: null, type, name: type === 'quickdraw' ? 'REP QuickDraw' : '', unit,
    startWeight: '', inventoryId: firstInv ? firstInv.id : '', targetMode: 'total',
    perDumbbell: true, mode: 'range', min: '', max: '', increment: '', list: '', maxSetting: '60' };
  lcState.drafts.profile = draft;
  lcNav('editProfile', { isNew: true });
}
function lcStartEditProfile(id) {
  const p = lcProfile(id); if (!p) return;
  lcState.drafts.profile = {
    id: p.id, type: p.type, name: p.name, unit: p.unit,
    startWeight: p.startWeight != null ? String(p.startWeight) : '', inventoryId: p.inventoryId || '', targetMode: p.targetMode || 'total',
    perDumbbell: p.perDumbbell !== false, mode: p.mode || 'range',
    min: p.min != null ? String(p.min) : '', max: p.max != null ? String(p.max) : '', increment: p.increment != null ? String(p.increment) : '',
    list: (p.list || []).join(', '), maxSetting: p.maxSetting != null ? String(p.maxSetting) : '60'
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
  if (d.type === 'plate') {
    html += lcUnitSelect('profile', d.unit);
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
    <button class="btn btn-primary lc-full-btn" onclick="lcSaveProfileDraft()">Save</button>`;
  return html;
}
function lcFormError(msg) {
  const el = document.getElementById('lc-form-error');
  if (el) { el.textContent = msg; el.style.display = ''; }
  showToast(msg, 'error');
  return false;
}
function lcSaveProfileDraft() {
  const d = lcState.drafts.profile; if (!d) return false;
  const name = String(d.name || '').trim();
  if (!name) return lcFormError('Give this equipment a name.');
  if (name.length > 40) return lcFormError('Keep the name to 40 characters or fewer.');
  if (d.unit !== 'lb' && d.unit !== 'kg') return lcFormError('Choose lb or kg.');
  const p = { id: d.id || lcNewId('lcp'), name, type: d.type, unit: d.type === 'quickdraw' ? 'lb' : d.unit };
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
  const list = lcState.data.profiles;
  const idx = list.findIndex(x => x.id === p.id);
  if (idx === -1) list.push(p); else list[idx] = p;
  lcState.data.lastProfileId = p.id;
  lcSave();
  lcState.drafts.profile = null;
  showToast('Equipment saved', 'success');
  lcResetTo('calc');
  return true;
}

// ---- inventory editor ----
function lcPresetPlates(unit) { return (unit === 'kg' ? [25, 20, 15, 10, 5, 2.5, 1.25] : [45, 35, 25, 10, 5, 2.5]).map(s => ({ size: String(s), pairs: '0' })); }
function lcStartNewInventory(fromProfile) {
  const unit = fromProfile && lcState.drafts.profile ? lcState.drafts.profile.unit : lcDefaultUnit();
  lcState.drafts.inventory = { id: null, name: '', unit, plates: lcPresetPlates(unit), lockedUnit: !!fromProfile };
  lcNav('editInventory', { isNew: true, fromProfile: !!fromProfile });
}
function lcStartEditInventory(id) {
  const inv = lcInventory(id); if (!inv) return;
  lcState.drafts.inventory = { id: inv.id, name: inv.name, unit: inv.unit, plates: inv.plates.map(x => ({ size: String(x.size), pairs: String(x.pairs) })) };
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
  return `${lcField('Name', 'lc-i-name', 'inventory', 'name', d.name, { placeholder: 'e.g. Garage plates' })}
    ${lcUnitSelect('inventory', d.unit, d.lockedUnit)}
    <div class="lc-section-label">Plates <span class="lc-muted lc-small">(1 pair = one plate for each side; 0 if you have none)</span></div>
    ${rows}
    <button class="btn btn-ghost btn-sm" style="margin:4px 0 14px" onclick="lcInvAddRow()">+ Plate size</button>
    <div id="lc-form-error" class="lc-error" style="display:none"></div>
    <button class="btn btn-primary lc-full-btn" onclick="lcSaveInventoryDraft()">Save</button>`;
}
function lcSaveInventoryDraft() {
  const d = lcState.drafts.inventory; if (!d) return false;
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
  const inv = { id: d.id || lcNewId('lci'), name, unit: d.unit, plates };
  const list = lcState.data.inventories;
  const idx = list.findIndex(x => x.id === inv.id);
  if (idx === -1) list.push(inv); else list[idx] = inv;
  lcSave();
  lcState.drafts.inventory = null;
  showToast('Plate inventory saved', 'success');
  const fromProfile = lcTop().params.fromProfile;
  if (fromProfile && lcState.drafts.profile) lcState.drafts.profile.inventoryId = inv.id;
  lcBack();
  return true;
}
