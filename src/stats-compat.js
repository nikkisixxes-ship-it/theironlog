// ==================== STATISTICS COMPATIBILITY (pure) ====================
// The classification rules of the specification (section 11.2) as pure
// functions. Stage 1 wrote them; STAGE 4a connects them: index.html loads this
// file so the app can keep each class's statistics apart (app-data.js,
// statsRowClass). It needs nothing else: the two integer helpers it used from
// calc-cv1.js (toTicks, divHalfUp) are copied below unchanged, so the
// provisional calculation module stays unconnected.
//
(function (root) {
  'use strict';
  // Same as calc-cv1.js toTicks / divHalfUp (kept identical; see tests/stage4).
  const C = { toTicks: value => Math.round(Number(value) * 10000),
    divHalfUp: (n, d) => Number((2n * n + d) / (2n * d)) };
  const B = x => BigInt(x), LB = 45359237n;
  function classify(rec) {      // rec: {unit?, implements?, basis?}
    if (rec.unit !== 'lb' && rec.unit !== 'kg') return 'L';
    if (!(rec.implements === 1 || rec.implements === 2)) return 'C';
    if (rec.implements === 2 && rec.basis !== 'total' && rec.basis !== 'perImplement') return 'C';
    return 'V'; }
  // Per-implement physical load in whole grams (V only), half up. weight: the recorded number (<= 4 decimals).
  function perImplementGrams(weight, rec) {
    if (classify(rec) !== 'V') return null;
    const t = B(C.toTicks(weight)), k = B(rec.implements === 2 && rec.basis === 'total' ? 2 : 1);
    return rec.unit === 'kg' ? C.divHalfUp(t, 10n * k) : C.divHalfUp(t * LB, 1000000000n * k); }
  // Comparable value for one set, or null when it may not be compared with anything.
  function comparable(weight, rec) {
    const c = classify(rec);
    if (c === 'V') return { cls: 'V', value: perImplementGrams(weight, rec) };
    if (c === 'L') return { cls: 'L', value: Number(weight) };            // raw, exactly as today
    return null; }
  // May two records be compared at all? (same exercise assumed by the caller)
  function canCompare(a, b) { const ca = classify(a), cb = classify(b); return ca === cb && ca !== 'C'; }
  // Best-so-far flags, in date order, WITHIN each class. records: [{weight, rec}] sorted by date.
  // Returns [{cls, isBest}] -- isBest only for V/L; C records are never flagged.
  // (The app's existing duplicate/tie rules are applied by its own code; this only enforces the class boundary.)
  function bestFlags(records) {
    const best = { V: -Infinity, L: -Infinity };
    return records.map(r => { const c = comparable(r.weight, r.rec);
      if (!c) return { cls: 'C', isBest: false };
      const isBest = c.value > best[c.cls]; if (isBest) best[c.cls] = c.value; return { cls: c.cls, isBest }; }); }
  // Volume contribution of one set: V in grams (per implement x implements x reps); L raw x reps (as today); C none.
  function volume(weight, reps, rec) {
    const c = classify(rec);
    if (c === 'V') return { cls: 'V', grams: perImplementGrams(weight, rec) * rec.implements * reps };
    if (c === 'L') return { cls: 'L', raw: Number(weight) * reps };
    return { cls: 'C', none: true }; }
  // Starting-value / reference suggestions: one-tap use only for V; L and C are information only.
  function suggestionUse(rec) { return classify(rec) === 'V' ? 'oneTap' : 'infoOnly'; }
  const LABELS = { V: 'Best since units were recorded', L: 'Older records — unit not recorded; compared as written, not a verified physical comparison',
    C: 'Unit recorded, loading convention not recorded — not compared' };
  const api = { classify, perImplementGrams, comparable, canCompare, bestFlags, volume, suggestionUse, LABELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.IronStatsCompat = api;
})(typeof self !== 'undefined' ? self : this);
