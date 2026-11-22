// ==================== LOAD SOLVER (pure, shared) ====================
// Pure equipment-solving functions, moved UNCHANGED out of app-load-calc.js
// (Stage 1, pure foundations). They read and write nothing: no DOM, no
// storage, no Firestore. Used by:
//   - the Load Calculator (app-load-calc.js), exactly as before;
//   - the versioned calculation module (calc-cv1.js), which the app does
//     NOT load yet (no workout, progression or statistics use).
// A classic script: top-level functions/constants are globals, as before.
// In Node or a Worker the same file is loaded with require()/importScripts.
//
// NUMBERS: every weight is a whole number of thousandths ("milli" units:
// 2.5 -> 2500) before any comparison or sum.

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

// Node / test access (ignored by browsers, where `module` is undefined).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LC_MAX_SETTINGS, LC_DP_STATE_LIMIT, LC_QD_LABELS, LC_QD_POSITIONS, LC_QD_MIN_M, LC_QD_MAX_M, LC_QD_STEP_M,
    lcToM, lcFmt, lcGcd, lcPlateBetter, lcSolvePlates, lcNearestSetting, lcQdSettingsM, lcQdPattern, lcQdEndWeights, lcQdIsUneven,
    lcProfileSettingsM, lcIsPerDumbbell };
}
