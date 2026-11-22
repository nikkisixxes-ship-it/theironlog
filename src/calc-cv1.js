// ==================== CALCULATION MODULE cv1 (PROVISIONAL) ====================
// Stage 1 "pure foundations" of the Working Load reduction specification
// (Draft 7). PURE: no DOM, storage, Firestore, clock or randomness.
//
// NOT CONNECTED: index.html does not load this file. Nothing in the app calls
// it -- no workout prefilling, progression decisions or statistics. It is used
// only by the validation tests and the benchmark page (tests/calc/).
//
// VERSION: CALC_VERSION 'cv1' is PROVISIONAL until accepted and released; no
// record is written with it in Stage 1. Fixing a defect before release
// changes cv1 itself; after release, any change to a result is a new version.
//
// Contents
//   1. Integer helpers and the ONE load-equality definition (whole grams)
//   2. Unit / weight-basis conversion, display and logger-entry rules
//   3. Equipment sources and equipment-aware resolution (spec section 5.2)
//   4. Session-target steps, incl. SEQUENTIAL temporary TM reductions (7.1a)
//   5. Acceptance range, bounds and the exact smallest-group search (7.7),
//      resumable from checkpoints
//   6. Series attribution (7.3, 7.4)
(function (root) {
  'use strict';
  const S = (typeof module !== 'undefined' && module.exports) ? require('./load-solver.js')
    : { lcSolvePlates: root.lcSolvePlates, lcNearestSetting: root.lcNearestSetting, lcProfileSettingsM: root.lcProfileSettingsM,
        lcIsPerDumbbell: root.lcIsPerDumbbell, lcToM: root.lcToM };

  const CALC_VERSION = 'cv1';
  const CALC_STATUS = 'provisional';

  // ---------- 0. explicit-input validation (no guessed units, bases, implement counts or equipment) ----------
  // Conversions and comparisons that depend on a unit, a weight basis or an implement count REQUIRE it.
  // Low-level helpers throw a CalcError {code}; the resolution and attribution APIs return an explicit status.
  //   unitUnknown        unit is not 'lb' or 'kg'
  //   basisNotConfirmed  weight basis is not 'total' or 'perImplement'
  //   implementsUnknown  implement count is not 1 or 2 (never assumed to be 1)
  //   needsEquipment     equipment missing, unreadable or with nothing loadable (never default steps)
  function CalcError(code, message) { const e = new Error(message); e.code = code; return e; }
  const isUnit = u => u === 'lb' || u === 'kg', isBasis = b => b === 'total' || b === 'perImplement', isCount = k => k === 1 || k === 2;
  function needUnit(u, what) { if (!isUnit(u)) throw CalcError('unitUnknown', what + ': unit must be lb or kg'); }
  function needBasis(b, what) { if (!isBasis(b)) throw CalcError('basisNotConfirmed', what + ': weight basis must be total or perImplement'); }
  function needCount(k, what) { if (!isCount(k)) throw CalcError('implementsUnknown', what + ': implement count must be 1 or 2'); }
  const isInt = (v, min) => Number.isInteger(v) && v >= min;
  // Equipment source check. Returns null when usable, else {status:'needsEquipment', reason}.
  function equipmentProblem(eq) {
    if (!eq || typeof eq !== 'object') return { status: 'needsEquipment', reason: 'missing' };
    if (!isUnit(eq.unit)) return { status: 'needsEquipment', reason: 'unitMissing' };
    if (!isBasis(eq.basis)) return { status: 'needsEquipment', reason: 'basisMissing' };
    if (eq.kind === 'plates') { if (!isInt(eq.startM, 0) || !Array.isArray(eq.plates) || !eq.plates.every(x => x && isInt(x.sizeM, 1) && isInt(x.pairs, 0))) return { status: 'needsEquipment', reason: 'unreadable' }; return null; }
    if (eq.kind === 'settings') { if (!Array.isArray(eq.settingsM) || !eq.settingsM.every(v => isInt(v, 0))) return { status: 'needsEquipment', reason: 'unreadable' };
      if (!eq.settingsM.some(v => v > 0) && !eq.added) return { status: 'needsEquipment', reason: 'noSettings' }; return null; }
    if (eq.kind === 'steps') { if (!isInt(eq.originM, 0) || !isInt(eq.stepM, 1)) return { status: 'needsEquipment', reason: 'unreadable' }; return null; }
    return { status: 'needsEquipment', reason: 'unknownKind' }; }
  // Set-and-equipment convention check for conversion between them. Returns null or {status, reason}.
  function conventionProblem(set, eq) {
    if (!isUnit(set.unit)) return { status: 'unitUnknown', reason: 'set unit' };
    if (!isBasis(set.basis)) return { status: 'basisNotConfirmed', reason: 'set basis' };
    const e = equipmentProblem(eq); if (e) return e;
    // the implement count matters when the bases differ, or when a per-implement load is compared in grams
    if ((set.basis === 'perImplement' || eq.basis === 'perImplement' || eq.basis !== set.basis) && !isCount(set.implements)) return { status: 'implementsUnknown', reason: 'set implements' };
    return null; }

  // ---------- 1. integers and load equality ----------
  const LB_KG_NUM = 45359237n, LB_KG_DEN = 100000000n;      // 1 lb = 0.45359237 kg exactly
  const B = x => BigInt(x);
  function divHalfUp(n, d) { return Number((2n * n + d) / (2n * d)); }   // n >= 0, d > 0 (BigInt): round half up
  // A stored load has at most 4 decimals: "ticks" = 0.0001 of its unit.
  function toTicks(value) { return Math.round(Number(value) * 10000); }
  // Whole grams of the TOTAL physical load, rounded half up (spec 7.2).
  function gramsFromTicks(ticks, unit, basis, count) {
    if (!isInt(ticks, 0)) throw CalcError('invalidLoad', 'load must be a whole number of ticks, zero or more');
    needUnit(unit, 'load'); needBasis(basis, 'load'); if (basis === 'perImplement') needCount(count, 'per-implement load');
    const k = B(basis === 'perImplement' ? count : 1);
    return unit === 'kg' ? divHalfUp(B(ticks) * k, 10n) : divHalfUp(B(ticks) * k * LB_KG_NUM, 1000000000n); }
  function sameLoad(a, b) {      // a, b: {ticks, unit, basis, implements}
    return gramsFromTicks(a.ticks, a.unit, a.basis, a.implements) === gramsFromTicks(b.ticks, b.unit, b.basis, b.implements); }

  // ---------- 2. conversion, display, entry ----------
  function convertTicks(t, from, to) { needUnit(from, 'convert from'); needUnit(to, 'convert to'); const b = B(t); if (from === to) return Number(b);
    return from === 'lb' ? divHalfUp(b * LB_KG_NUM, LB_KG_DEN) : divHalfUp(b * LB_KG_DEN, LB_KG_NUM); }
  function amountToTicks(amount, fromUnit, toUnit) { return convertTicks(toTicks(amount), fromUnit, toUnit); }
  // Display text: 2 decimals in the display unit, half up.
  function displayText(ticks, recordUnit, displayUnit) {
    const t = convertTicks(ticks, recordUnit, displayUnit); return (divHalfUp(B(t), 100n) / 100).toFixed(2); }
  // Logger entry (7.2): typing a number equal to the value shown keeps the exact stored target.
  function enterLoad(typed, displayUnit, targetTicks, recordUnit) {
    if (targetTicks != null && Number(typed) === Number(displayText(targetTicks, recordUnit, displayUnit))) return targetTicks;
    return convertTicks(toTicks(typed), displayUnit, recordUnit); }
  // Set target (ticks, set unit and basis) -> equipment milli-units (equipment unit and basis), half up.
  // Both directions REQUIRE explicit units and bases; the implement count is required when the bases differ.
  function needConversion(set, eq, what) {
    needUnit(set.unit, what + ' (set)'); needBasis(set.basis, what + ' (set)');
    if (!eq) throw CalcError('needsEquipment', what + ': equipment missing'); needUnit(eq.unit, what + ' (equipment)'); needBasis(eq.basis, what + ' (equipment)');
    if (set.basis !== eq.basis) needCount(set.implements, what); }
  function toEquipmentM(x, set, eq) {
    needConversion(set, eq, 'convert to equipment'); if (!isInt(x, 0)) throw CalcError('invalidLoad', 'target must be a whole number of ticks, zero or more');
    let n = B(x), d = 10n;
    if (set.unit === 'lb' && eq.unit === 'kg') { n *= LB_KG_NUM; d *= LB_KG_DEN; }
    if (set.unit === 'kg' && eq.unit === 'lb') { n *= LB_KG_DEN; d *= LB_KG_NUM; }
    if (set.basis === 'total' && eq.basis === 'perImplement') d *= B(set.implements);
    if (set.basis === 'perImplement' && eq.basis === 'total') n *= B(set.implements);
    return divHalfUp(n, d); }
  function equipmentMToTicks(m, set, eq) {          // back to the record (4 decimals), half up
    needConversion(set, eq, 'convert from equipment'); if (!isInt(m, 0)) throw CalcError('invalidLoad', 'equipment load must be a whole number, zero or more');
    let n = B(m) * 10n, d = 1n;
    if (eq.unit === 'kg' && set.unit === 'lb') { n *= LB_KG_DEN; d *= LB_KG_NUM; }
    if (eq.unit === 'lb' && set.unit === 'kg') { n *= LB_KG_NUM; d *= LB_KG_DEN; }
    if (set.basis === 'total' && eq.basis === 'perImplement') n *= B(set.implements);
    if (set.basis === 'perImplement' && eq.basis === 'total') d *= B(set.implements);
    return divHalfUp(n, d); }
  // Grams of an equipment load: per-implement equipment needs the set's implement count (never assumed 1).
  function equipmentGrams(m, set, eq) { if (!eq) throw CalcError('needsEquipment', 'equipment missing'); return gramsFromTicks(m * 10, eq.unit, eq.basis, set.implements); }

  // ---------- 3. equipment sources and resolution ----------
  // Equipment source (all loads in milli-units of eq.unit, in eq.basis):
  //   {kind:'plates', startM, plates:[{sizeM,pairs}]}  |  {kind:'settings', settingsM:[...]}  |  {kind:'steps', originM, stepM}
  //   + unit ('lb'|'kg'), basis ('total'|'perImplement'), added (true: bodyweight added weight, 0 = bodyweight only)
  // A Load Calculator profile (+ its inventory for plate profiles) -> {ok:true, eq} or {ok:false, status:'needsEquipment', reason}.
  // A MISSING or unreadable inventory is a failure; an inventory that exists with NO plates is valid (starting weight only).
  // Nothing here ever falls back to default increments.
  function equipmentFromProfile(profile, inventory) {
    const fail = reason => ({ ok: false, status: 'needsEquipment', reason });
    if (!profile || typeof profile !== 'object') return fail('profileMissing');
    if (!isUnit(profile.unit)) return fail('profileUnitMissing');
    const basis = S.lcIsPerDumbbell(profile) ? 'perImplement' : 'total';
    if (profile.type === 'plate') {
      if (inventory === undefined || inventory === null) return fail('inventoryMissing');
      if (typeof inventory !== 'object' || !Array.isArray(inventory.plates)) return fail('inventoryUnreadable');
      if (profile.inventoryId != null && inventory.id != null && profile.inventoryId !== inventory.id) return fail('inventoryMismatch');
      if (inventory.unit != null && inventory.unit !== profile.unit) return fail('inventoryUnitMismatch');
      const startM = S.lcToM(profile.startWeight);
      const plates = inventory.plates.map(x => ({ sizeM: S.lcToM(x.size), pairs: Number(x.pairs) }));
      const eq = { kind: 'plates', unit: profile.unit, basis, startM, plates };
      const bad = equipmentProblem(eq); return bad ? fail('profileUnreadable') : { ok: true, eq }; }
    if (profile.type === 'adjustable' || profile.type === 'quickdraw') {
      const eq = { kind: 'settings', unit: profile.unit, basis, settingsM: S.lcProfileSettingsM(profile) };
      const bad = equipmentProblem(eq); return bad ? fail(bad.reason === 'noSettings' ? 'noSettings' : 'profileUnreadable') : { ok: true, eq }; }
    return fail('profileTypeUnknown'); }
  function defaultEquipment(unit) { return { kind: 'steps', unit, basis: 'total', originM: 0, stepM: unit === 'kg' ? 2500 : 5000 }; }
  function candidates(eq, tM) {     // {exact, below, above} in milli-units (null when none)
    const bad = equipmentProblem(eq); if (bad) throw CalcError('needsEquipment', 'equipment ' + bad.reason);
    if (eq.kind === 'plates') { const r = S.lcSolvePlates(eq.startM, eq.plates, tM);
      return { exact: r.exact ? r.exact.totalM : null, below: r.below ? r.below.totalM : null, above: r.above ? r.above.totalM : null }; }
    if (eq.kind === 'settings') { const list = eq.added ? [0].concat(eq.settingsM.filter(v => v > 0)) : eq.settingsM;
      const r = S.lcNearestSetting(list, tM); return { exact: r.exact ? tM : null, below: r.belowM, above: r.aboveM }; }
    // steps: origin + k*step (k >= 0; an origin of 0 is not itself a load unless this is added weight)
    const o = eq.originM, st = eq.stepM, first = (o === 0 && !eq.added) ? st : o;
    if (tM < first) return { exact: null, below: (eq.added && tM > 0) ? 0 : null, above: first };
    const k = Math.floor((tM - o) / st), at = o + k * st;
    if (at === tM) return { exact: tM, below: null, above: null };
    const below = at >= first ? at : null; return { exact: null, below, above: at + st }; }
  // Core selection (shared by Step A and Step B): nearest available >= minimum, ties per `tie`, never above capM.
  function pickM(eq, tM, tie, capM, minM) {
    const ok = v => v != null && (minM == null || v >= minM) && (capM == null || v <= capM);
    if (minM != null && tM < minM) { const c = candidates(eq, minM); const v = c.exact != null ? c.exact : c.above;
      if (v == null) return { m: null }; if (capM != null && v > capM) return { m: capM, limited: true }; return { m: v, limited: true }; }
    const c = candidates(eq, tM);
    if (c.exact != null && ok(c.exact)) return { m: c.exact, exact: true };
    let opts = [c.below, c.above].filter(ok);
    if (!opts.length && capM != null) { const cb = candidates(eq, capM); opts = [cb.exact, cb.below].filter(ok); }
    if (!opts.length) return { m: null };
    let best = opts[0];
    for (const o of opts.slice(1)) { const d1 = Math.abs(o - tM), d0 = Math.abs(best - tM);
      if (d1 < d0 || (d1 === d0 && (tie === 'lighter' ? o < best : o > best))) best = o; }
    return { m: best, aboveCapacity: c.above == null && tM > best }; }
  // Step A (5.2): the unreduced resolved load U. source: 'calculated' | 'written'
  // Shared rule for both steps: an EXTERNAL target at zero or below needs a load entered by hand; an ADDED-weight
  // target at zero or below is bodyweight only (valid, whatever the minimum). Missing equipment: needsEquipment.
  function zeroOrMissing(eq, tM) {
    const bad = equipmentProblem(eq); if (bad) return { m: null, status: 'needsEquipment', reason: bad.reason };
    if (!Number.isInteger(tM)) return { m: null, status: 'invalidTarget' };
    if (tM <= 0) return eq.added ? { m: 0, status: 'bodyweightOnly' } : { m: null, status: 'needsLoad' };
    return null; }
  function resolveUnreduced(eq, tM, source, minM) {
    const z = zeroOrMissing(eq, tM); if (z) return z;
    if (source === 'written' && (minM == null || tM >= minM)) {
      const c = candidates(eq, tM);
      if (c.exact != null) return { m: c.exact, status: 'exact' };
      const below = c.below != null && (minM == null || c.below >= minM) ? c.below : null;
      if (below != null) return { m: below, status: 'substituted' };      // shown: "Written 137.5 - can load 135"
      const lightest = candidates(eq, minM != null ? minM : 0); const v = lightest.exact != null && lightest.exact > 0 ? lightest.exact : (c.above != null ? c.above : lightest.above);
      return v == null ? { m: null, status: 'needsLoad' } : { m: v, status: 'needsConfirmation' }; }
    const r = pickM(eq, tM, 'heavier', null, minM);
    if (r.m == null) return { m: null, status: 'needsLoad' };
    if (minM != null && tM < minM) return { m: r.m, status: source === 'written' ? 'needsConfirmation' : 'limitedToMinimum' };
    return { m: r.m, status: r.exact ? 'exact' : (r.aboveCapacity ? 'aboveCapacity' : 'nearest') }; }
  // Step B (5.2): the reduced load, never above U; target >= path means "no reduction" (R11).
  function resolveReduced(eq, tM, UM, minM) {
    const z = zeroOrMissing(eq, tM); if (z) return z;
    if (!Number.isInteger(UM) || UM < 0) return { m: null, status: 'invalidCap' };
    const r = pickM(eq, tM, 'lighter', UM, minM);
    if (r.m == null) return { m: null, status: 'needsLoad' };
    return { m: r.m, status: r.m === UM ? 'noEffect' : (r.limited ? 'limitedToMinimum' : (r.exact ? 'exact' : 'nearest')) }; }

  // ---------- 4. steps (7.1a, 7.7.1) ----------
  // State {x, M}: x target ticks (set unit); M TM in use (ticks) for %TM sets fed by the series TM, else null.
  function step(s, st) {
    let x = s.x, M = s.M;
    if (st.kind === 'wlPercent') x = divHalfUp(B(x) * B(10000 - st.bp), 10000n);
    else if (st.kind === 'wlFixed') x = x - st.d;
    else { const M2 = st.kind === 'tmPercent' ? divHalfUp(B(M) * B(10000 - st.bp), 10000n) : Math.max(0, M - st.d);
      x = x - divHalfUp(B(st.pctBp) * B(M - M2), 10000n); M = M2; }
    return { x: x < 0 ? 0 : x, M }; }
  function stepForSet(t, set) {     // temporary {scope:'WL'|'TM', mode:'percent'|'fixed', bp?, amount?, unit?}
    if (t.scope === 'TM') { if (!set.tm) return null;
      return t.mode === 'percent' ? { kind: 'tmPercent', bp: t.bp, pctBp: set.tm.pctBp }
        : { kind: 'tmFixed', d: amountToTicks(t.amount, t.unit, set.unit), pctBp: set.tm.pctBp }; }
    return t.mode === 'percent' ? { kind: 'wlPercent', bp: t.bp } : { kind: 'wlFixed', d: amountToTicks(t.amount, t.unit, set.unit) }; }
  function startState(set) { return { x: set.p, M: set.tm ? set.tm.tmInUseTicks : null }; }
  function sessionTarget(set, temps) { let s = startState(set);
    for (const t of temps) { const st = stepForSet(t, set); if (st) s = step(s, st); } return s; }

  // ---------- 5. acceptance range, bounds, exact search ----------
  function acceptanceRange(Q, Lg, p) {
    let a = 0, b = p; while (a < b) { const m = Math.floor((a + b) / 2); if (Q(m) >= Lg) b = m; else a = m + 1; }
    const lo = a; a = lo; b = p; while (a < b) { const m = Math.ceil((a + b) / 2); if (Q(m) <= Lg) a = m; else b = m - 1; }
    return [lo, a]; }
  const fdiv = (a, b) => Math.floor(a / b), cdiv = (a, b) => Math.ceil(a / b);
  function enclose(I, st, P) {
    let nxl, nxh, nMl = I.Ml, nMh = I.Mh, nEl, nEh;
    if (st.kind === 'tmPercent' || st.kind === 'tmFixed') {
      const Ms = M => st.kind === 'tmPercent' ? divHalfUp(B(M) * B(10000 - st.bp), 10000n) : Math.max(0, M - st.d);
      const drop = M => divHalfUp(B(st.pctBp) * B(M - Ms(M)), 10000n);
      nMl = Ms(I.Ml); nMh = Ms(I.Mh); nxl = Math.max(0, I.xl - drop(I.Mh)); nxh = Math.max(0, I.xh - drop(I.Ml));
      nEl = I.El - 5000; nEh = Math.max(I.Eh + 5000, -P * nMl);
    } else if (st.kind === 'wlPercent') { const c = 10000 - st.bp;
      nxl = divHalfUp(B(I.xl) * B(c), 10000n); nxh = divHalfUp(B(I.xh) * B(c), 10000n);
      nEl = fdiv(c * I.El - st.bp * P * I.Mh, 10000) - 5000; nEh = cdiv(c * I.Eh - st.bp * P * I.Ml, 10000) + 5000;
    } else { nxl = Math.max(0, I.xl - st.d); nxh = Math.max(0, I.xh - st.d); nEl = I.El - 10000 * st.d; nEh = Math.max(I.Eh - 10000 * st.d, -P * I.Ml); }
    const xl = Math.max(nxl, cdiv(nEl + P * nMl, 10000)), xh = Math.min(nxh, fdiv(nEh + P * nMh, 10000));
    return { xl, xh, Ml: nMl, Mh: nMh, El: Math.max(nEl, 10000 * xl - P * nMh), Eh: Math.min(nEh, 10000 * xh - P * nMl) }; }
  // lowX[r] <= every final x reachable with exactly r more steps from (j, s); highX[r] >= every one.
  function boundsTable(j, s, steps, P) {
    const n = steps.length, m = n - j;
    if (s.M == null) { const lowX = new Array(m + 1).fill(Infinity), highX = new Array(m + 1).fill(-Infinity); lowX[0] = highX[0] = s.x;
      for (let i = j; i < n; i++) for (let r = Math.min(i - j + 1, m); r >= 1; r--) {
        if (lowX[r - 1] !== Infinity) { const a = step({ x: lowX[r - 1], M: null }, steps[i]).x; if (a < lowX[r]) lowX[r] = a; }
        if (highX[r - 1] !== -Infinity) { const b = step({ x: highX[r - 1], M: null }, steps[i]).x; if (b > highX[r]) highX[r] = b; } }
      return { lowX, highX }; }
    const I = new Array(m + 1).fill(null); const E0 = 10000 * s.x - P * s.M;
    I[0] = { xl: s.x, xh: s.x, Ml: s.M, Mh: s.M, El: E0, Eh: E0 };
    for (let i = j; i < n; i++) for (let r = Math.min(i - j + 1, m); r >= 1; r--) if (I[r - 1]) {
      const e = enclose(I[r - 1], steps[i], P), h = I[r];
      I[r] = h == null ? e : { xl: Math.min(h.xl, e.xl), xh: Math.max(h.xh, e.xh), Ml: Math.min(h.Ml, e.Ml), Mh: Math.max(h.Mh, e.Mh), El: Math.min(h.El, e.El), Eh: Math.max(h.Eh, e.Eh) }; }
    return { lowX: I.map(v => v ? v.xl : Infinity), highX: I.map(v => v ? v.xh : -Infinity) }; }
  // Deterministic 106-bit fingerprint (two 53-bit hashes) of a canonical JSON string -- for checkpoint invalidation.
  function fingerprint(str) { const h = seed => { let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
      for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
      return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36); };
    return h(1) + '.' + h(2); }
  // Exact smallest-group search, earliest decisions on ties (7.7.4), as an ITERATIVE depth-first search so it
  // can stop after `budget` steps and RESUME from a checkpoint. Order and result are identical to the recursive form.
  // Returns {status:'done', group:[indices]|null, stats} or {status:'unfinished', checkpoint, stats}.
  function searchExact(start, steps, lo, hi, opts) {
    opts = opts || {}; const P = opts.P || 0, n = steps.length, hasM = start.M != null;
    const stats = { nodes: 0, tables: 0, deadEnds: 0, peakDeadEnds: 0, peakTables: 0 };
    const inputKey = fingerprint(JSON.stringify([CALC_VERSION, start, steps, lo, hi, P]));
    let k = 1, resumePath = null;
    const cp = opts.checkpoint;
    if (cp) { if (cp.kind === 'search' && cp.calcVersion === CALC_VERSION && cp.inputKey === inputKey) { k = cp.k; resumePath = cp.path; stats.resumed = true; }
      else stats.checkpointDiscarded = cp.calcVersion !== CALC_VERSION ? 'calculation version differs' : 'inputs differ'; }
    const tables = new Map(), dead = new Set();
    const k2 = (j, s) => hasM ? j + ':' + s.x + ':' + s.M : j + ':' + s.x;
    // BOUNDED caches (results never depend on them; a full cache is simply cleared and rebuilt as needed)
    const maxTables = opts.maxTables || 5000, maxDead = opts.maxDeadEnds || 50000; stats.cacheResets = 0;
    const bounds = (j, s) => { const key = k2(j, s); let t = tables.get(key);
      if (!t) { stats.tables++; t = boundsTable(j, s, steps, P); if (tables.size >= maxTables) { tables.clear(); stats.cacheResets++; } tables.set(key, t); if (tables.size > stats.peakTables) stats.peakTables = tables.size; } return t; };
    const markDead = key => { if (dead.size >= maxDead) { dead.clear(); stats.cacheResets++; } dead.add(key); if (dead.size > stats.peakDeadEnds) stats.peakDeadEnds = dead.size; };
    const budget = opts.budget || Infinity; let used = 0;
    for (; k <= n; k++, resumePath = null) {
      const t0 = bounds(0, start); if (!resumePath && (t0.lowX[k] > hi || t0.highX[k] < lo)) continue;
      // frames: {j, s, r, i = next index to try, entered}; path = chosen indices (frame d chose path[d])
      const frames = [{ j: 0, s: start, r: k, i: 0, entered: false }]; const path = [];
      if (resumePath) {   // checkpoint = "about to enter the frame reached by this path": rebuild it exactly
        for (const idx of resumePath) { const f = frames[frames.length - 1]; f.entered = true; f.i = idx + 1;
          path.push(idx); frames.push({ j: idx + 1, s: step(f.s, steps[idx]), r: f.r - 1, i: 0, entered: false }); } }
      while (frames.length) {
        const f = frames[frames.length - 1];
        if (!f.entered) {
          if (++used > budget) return { status: 'unfinished', stats, checkpoint: { kind: 'search', calcVersion: CALC_VERSION, inputKey, k, path: path.slice() } };
          f.entered = true; stats.nodes++;
          if (f.r === 0) { if (f.s.x >= lo && f.s.x <= hi) { stats.k = k; return { status: 'done', group: path.slice(), stats }; } frames.pop(); path.pop(); continue; }
          const t = bounds(f.j, f.s);
          if (n - f.j < f.r || t.lowX[f.r] > hi || t.highX[f.r] < lo || dead.has(k2(f.j, f.s) + ':' + f.r)) { frames.pop(); path.pop(); continue; }
          f.i = f.j; }
        let pushed = false;
        while (f.i <= n - f.r) { const i = f.i++; const w = step(f.s, steps[i]);
          if ((w.x === f.s.x && w.M === f.s.M) || w.x < lo) continue;     // full no-op / below the range
          path.push(i); frames.push({ j: i + 1, s: w, r: f.r - 1, i: 0, entered: false }); pushed = true; break; }
        if (!pushed) { markDead(k2(f.j, f.s) + ':' + f.r); frames.pop(); path.pop(); } }
    }
    stats.deadEnds = dead.size; return { status: 'done', group: null, stats }; }

  // ---------- 6. series attribution ----------
  // sets: [{id, p (ticks), unit, basis, implements, eq (equipment source), source:'calculated'|'written', minM, tm:{pctBp,tmInUseTicks}|null,
  //         completed, loggedTicks (record ticks) | null}]
  // temps: [{id, scope, mode, bp?, amount?, unit?}] in decision order.
  // Returns {status:'done', used:[temp indices], perSet} or {status:'unfinished', checkpoint}.
  function attributeSeries(sets, temps, opts) {
    opts = opts || {}; const stats = { resolverCalls: 0, nodes: 0, signatureHits: 0 };
    const seriesKey = fingerprint(JSON.stringify([CALC_VERSION, sets, temps]));
    let startIdx = 0, used = new Set(), perSet = {}, sigMemo = new Map(), resume = null;
    const cp = opts.checkpoint;
    if (cp) { if (cp.kind === 'series' && cp.calcVersion === CALC_VERSION && cp.seriesKey === seriesKey) {
        startIdx = cp.setIndex; used = new Set(cp.used); perSet = cp.perSet; sigMemo = new Map(cp.sigMemo); resume = cp.search; stats.resumed = true; }
      else stats.checkpointDiscarded = cp.calcVersion !== CALC_VERSION ? 'calculation version differs' : 'inputs differ'; }
    for (let si = startIdx; si < sets.length; si++) { const s = sets[si];
      // Explicit inputs only: an unknown unit, basis or implement count, or missing equipment, makes the set
      // unresolved (never evidence) instead of guessing.
      const prob = conventionProblem(s, s.eq);
      if (prob) { perSet[s.id] = { status: prob.status, reason: prob.reason, U: null, L: null, changed: false, evidence: false, group: null, targetTicks: null }; continue; }
      const steps = [], idx = []; temps.forEach((t, i) => { const st = stepForSet(t, s); if (st) { steps.push(st); idx.push(i); } });
      const pM = toEquipmentM(s.p, s, s.eq); const A = s.p > 0 ? resolveUnreduced(s.eq, pM, s.source || 'calculated', s.minM) : (s.eq.added ? { m: 0 } : { m: null });
      const UM = A.m == null ? -1 : A.m; const cache = new Map();
      const Q = x => { let r = cache.get(x); if (r !== undefined) return r; stats.resolverCalls++;
        if (x >= s.p) r = UM < 0 ? -1 : equipmentGrams(UM, s, s.eq);
        else if (x <= 0) r = s.eq.added ? 0 : -1;
        else { const v = resolveReduced(s.eq, toEquipmentM(x, s, s.eq), UM, s.minM).m; r = v == null ? -1 : equipmentGrams(v, s, s.eq); }
        cache.set(x, r); return r; };
      let fin = startState(s); for (const st of steps) fin = step(fin, st);
      const Lg = Q(fin.x), Ug = UM < 0 ? -1 : equipmentGrams(UM, s, s.eq);
      const changed = Lg !== Ug && Lg !== -1 && Ug !== -1;
      let targetTicks = null;
      if (changed) { const LM = fin.x <= 0 ? 0 : resolveReduced(s.eq, toEquipmentM(fin.x, s, s.eq), UM, s.minM).m; targetTicks = equipmentMToTicks(LM, s, s.eq); }
      let loggedOk = true;
      if (changed && s.loggedTicks != null)
        loggedOk = gramsFromTicks(s.loggedTicks, s.unit, s.basis, s.implements) === gramsFromTicks(targetTicks, s.unit, s.basis, s.implements);
      const evidence = changed && s.completed !== false && loggedOk;
      let group = null;
      if (evidence) {
        if (used.size === temps.length) group = 'notNeeded';
        else { const sig = fingerprint(JSON.stringify([s.eq, s.p, s.unit, s.basis, s.implements, s.minM, s.tm, s.source]));
          if (sigMemo.has(sig)) { group = sigMemo.get(sig); stats.signatureHits++; }
          else { const [lo, hi] = acceptanceRange(Q, Lg, s.p);
            const r = searchExact(startState(s), steps, lo, hi, { P: s.tm ? s.tm.pctBp : 0, budget: opts.budget, checkpoint: resume, maxTables: opts.maxTables, maxDeadEnds: opts.maxDeadEnds });
            resume = null; stats.nodes += r.stats.nodes; stats.lastSearch = r.stats;
            if (r.status === 'unfinished') return { status: 'unfinished', stats,
              checkpoint: { kind: 'series', calcVersion: CALC_VERSION, seriesKey, setIndex: si, used: [...used], perSet, sigMemo: [...sigMemo], search: r.checkpoint } };
            group = r.group.map(i => idx[i]); sigMemo.set(sig, group); }
          if (Array.isArray(group)) group.forEach(i => used.add(i)); } }
      perSet[s.id] = { status: 'resolved', U: Ug, L: Lg, changed, evidence, group, targetTicks }; }
    return { status: 'done', used: [...used].sort((a, b) => a - b), perSet, stats }; }

  const api = { CALC_VERSION, CALC_STATUS, CalcError, equipmentProblem, conventionProblem, divHalfUp, toTicks, gramsFromTicks, sameLoad, convertTicks, amountToTicks, displayText, enterLoad,
    toEquipmentM, equipmentMToTicks, equipmentGrams, equipmentFromProfile, defaultEquipment, candidates, pickM, resolveUnreduced, resolveReduced,
    step, stepForSet, startState, sessionTarget, acceptanceRange, boundsTable, fingerprint, searchExact, attributeSeries };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.IronCalc = api;
})(typeof self !== 'undefined' ? self : this);
