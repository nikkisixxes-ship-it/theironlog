// ==================== ACCOUNT EQUIPMENT (Stage 2) ====================
// Equipment profiles and shared plate inventories, owned by the signed-in
// account (Firestore users/{uid}/equipmentProfiles, equipmentInventories,
// equipmentCopies). Used by the Load Calculator (app-load-calc.js), opened from
// the live workout logger or from LIBRARY. The calculator stays a manual tool:
// nothing here touches workouts, exercises, progression or statistics.
//
// LOADING STATES (never treat an unconfirmed read as an empty account):
//   signedOut  no account
//   idle       not started yet (starts when the calculator or editor opens)
//   loading    waiting for the first answer
//   ready      the server has confirmed both lists (may be empty: a real empty account)
//   cachedOnly only this device's cached copy is available (offline, never confirmed)
//   failed     the read failed (with a code); retry offered
// `offline` is a separate flag: the latest answer came from this device's cache.
//
// SAVES: every change is one Firestore transaction that re-reads what it
// changes and checks the revision the editor started from, so a stale edit
// never overwrites a newer change silently. Rules enforce the same (revision
// must rise by exactly 1) and keep inventory references (usedBy) consistent.
//
// DEVICE COPY: equipment saved on a device before Stage 2 (localStorage,
// LC_STORE_KEY_PREFIX + uid) is a read-only backup. "Copy this device's
// equipment to your account" plans, previews and copies it with deterministic
// document ids, so retries and interrupted copies never duplicate anything.
// The device data itself is never changed or deleted.

const EQ_COL_PROFILES = 'equipmentProfiles', EQ_COL_INVENTORIES = 'equipmentInventories', EQ_COL_COPIES = 'equipmentCopies', EQ_COL_IMPORT_KEYS = 'equipmentImportKeys';
const EQ_COPY_STATUS_PREFIX = 'ironlog.equipment.deviceCopy:';   // + uid -> { deviceCopyId, completedAt }
const EQ_LAST_PROFILE_PREFIX = 'ironlog.equipment.lastProfile:'; // + uid -> profile id (a device preference)
const EQ_MAX_WRITES_PER_TX = 400;

let eqState = { uid: null, status: 'signedOut', error: null, offline: false, epoch: 0, unsubs: [],
  lists: { profiles: null, inventories: null }, serverSeen: { profiles: false, inventories: false }, fromCache: { profiles: false, inventories: false },
  profiles: [], inventories: [], unreadable: [], subscribers: [] };

function eqNotify() { eqState.subscribers.slice().forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }
function eqSubscribe(fn) { eqState.subscribers.push(fn); return () => { eqState.subscribers = eqState.subscribers.filter(f => f !== fn); }; }
function eqCol(name) { return fsDb.collection('users').doc(eqState.uid).collection(name); }

// ---- auth boundary: called first thing on every sign-in / sign-out / account switch ----
function eqResetForOwner(uid) {
  eqState.unsubs.forEach(u => { try { u(); } catch (e) {} });
  eqState.unsubs = []; eqState.epoch++;
  Object.assign(eqState, { uid: uid || null, status: uid ? 'idle' : 'signedOut', error: null, offline: false,
    lists: { profiles: null, inventories: null }, serverSeen: { profiles: false, inventories: false }, fromCache: { profiles: false, inventories: false },
    profiles: [], inventories: [], unreadable: [] });
  eqNotify();
}
function eqEnsureStarted() {
  if (!eqState.uid || (eqState.status !== 'idle' && eqState.status !== 'failed')) return;
  const epoch = ++eqState.epoch; eqState.unsubs.forEach(u => u()); eqState.unsubs = [];
  eqState.status = 'loading'; eqState.error = null;
  eqState.lists = { profiles: null, inventories: null }; eqState.serverSeen = { profiles: false, inventories: false };
  ['profiles', 'inventories'].forEach(which => {
    const col = eqCol(which === 'profiles' ? EQ_COL_PROFILES : EQ_COL_INVENTORIES);
    const unsub = col.onSnapshot({ includeMetadataChanges: true }, snap => {
      if (epoch !== eqState.epoch) return;
      const fromCache = !!(snap.metadata && snap.metadata.fromCache);
      eqState.lists[which] = snap.docs.map(d => ({ id: d.id, data: d.data() }));
      eqState.fromCache[which] = fromCache; if (!fromCache) eqState.serverSeen[which] = true;
      eqRecompute();
    }, err => {
      if (epoch !== eqState.epoch) return;
      eqState.status = 'failed'; eqState.error = (err && err.code) || 'unknown'; eqNotify();
    });
    eqState.unsubs.push(unsub);
  });
  eqNotify();
}
function eqRetry() { if (eqState.status === 'failed' || eqState.status === 'cachedOnly') { eqState.status = 'idle'; eqEnsureStarted(); } }
function eqRecompute() {
  if (eqState.status === 'failed') return;
  const L = eqState.lists;
  if (!L.profiles || !L.inventories) { eqState.status = 'loading'; eqNotify(); return; }
  const unreadable = [];
  const inventories = [], profiles = [];
  L.inventories.forEach(d => { const r = eqInventoryFromDoc(d.id, d.data); if (r.ok) inventories.push(r.value); else unreadable.push({ kind: 'inventory', id: d.id, name: (d.data && d.data.name) || d.id, reason: r.reason }); });
  L.profiles.forEach(d => { const r = eqProfileFromDoc(d.id, d.data); if (r.ok) profiles.push(r.value); else unreadable.push({ kind: 'profile', id: d.id, name: (d.data && d.data.name) || d.id, reason: r.reason }); });
  const byName = (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  eqState.inventories = inventories.sort(byName); eqState.profiles = profiles.sort(byName); eqState.unreadable = unreadable;
  eqState.status = (eqState.serverSeen.profiles && eqState.serverSeen.inventories) ? 'ready' : 'cachedOnly';
  eqState.offline = eqState.fromCache.profiles || eqState.fromCache.inventories;
  eqNotify();
}
function eqProfileById(id) { return eqState.profiles.find(p => p.id === id) || null; }
function eqInventoryById(id) { return eqState.inventories.find(i => i.id === id) || null; }
// Plate profiles that name an inventory (from the profiles, so a broken usedBy can't hide one).
function eqDependents(invId) {
  const inv = eqInventoryById(invId); const ids = new Set(eqState.profiles.filter(p => p.type === 'plate' && p.inventoryId === invId).map(p => p.id));
  if (inv) Object.keys(inv.usedBy || {}).forEach(k => ids.add(k));
  return [...ids].map(id => eqProfileById(id) || { id, name: '(another profile)', missing: true });
}

// ---- documents <-> models (validated both ways) ----
// VALIDATION is kept identical to firestore.rules (Stage 2 revision 1): every
// document the rules accept can be read here, and everything this app saves is
// accepted by the rules. Weights: 0..100,000 with at most 3 decimals (checked
// the same way in both: |w*1000 - round(w*1000)| < 0.000001). Text numbers:
// 0.001..100000, at most 3 decimals, no trailing zeros.
const EQ_NUM_RE = /^(0\.[0-9]{0,2}[1-9]|([1-9][0-9]{0,4})(\.[0-9]{0,2}[1-9])?|100000)$/;
const eqThreeDp = w => Math.abs(w * 1000 - Math.round(w * 1000)) < 0.000001;
function eqNumText(n) { return lcFmt(lcToM(n)); }
function eqPlatesText(plates) { return plates.map(p => eqNumText(p.size) + 'x' + p.pairs).join(','); }
function eqParsePlatesText(t) {
  if (typeof t !== 'string' || !t) return null; const out = [];
  for (const part of t.split(',')) { const m = /^([0-9.]+)x([0-9]+)$/.exec(part); if (!m || !EQ_NUM_RE.test(m[1])) return null;
    const pairs = Number(m[2]); if (!(pairs >= 0 && pairs <= LC_MAX_PAIRS && Number.isInteger(pairs))) return null; out.push({ size: Number(m[1]), pairs }); }
  return out.length >= 1 && out.length <= LC_MAX_PLATE_TYPES ? out : null; }
function eqParseListText(t) {
  if (typeof t !== 'string' || !t) return null; const out = [];
  for (const part of t.split(',')) { if (!EQ_NUM_RE.test(part)) return null; out.push(Number(part)); }
  return out.length >= 1 && out.length <= LC_MAX_SETTINGS ? out.sort((a, b) => a - b) : null; }
const eqWeightOk = (w, positive) => typeof w === 'number' && isFinite(w) && w >= 0 && w <= 100000 && (!positive || w > 0) && eqThreeDp(w);
const eqW = w => lcToM(w) / 1000;    // the exact 3-decimal value
// Names: the editor saves 1-40 characters (trimmed); reading accepts anything
// the rules accept (1-40 characters however counted), so nothing becomes unreadable.
const eqNameOk = n => typeof n === 'string' && n.length >= 1 && n.length <= 80;
function eqInventoryFromDoc(id, d) {
  if (!d || typeof d !== 'object') return { ok: false, reason: 'not a document' };
  if (d.id !== id || !eqNameOk(d.name) || (d.unit !== 'lb' && d.unit !== 'kg')) return { ok: false, reason: 'name, unit or id' };
  const plates = eqParsePlatesText(d.plates); if (!plates) return { ok: false, reason: 'plates' };
  if (!Number.isInteger(d.revision) || d.revision < 1 || !d.usedBy || typeof d.usedBy !== 'object') return { ok: false, reason: 'revision or references' };
  return { ok: true, value: { id, name: d.name, unit: d.unit, plates, usedBy: Object.assign({}, d.usedBy), revision: d.revision, copyKey: d.copyKey || null } }; }
function eqProfileFromDoc(id, d) {
  if (!d || typeof d !== 'object') return { ok: false, reason: 'not a document' };
  if (d.id !== id || !eqNameOk(d.name) || (d.unit !== 'lb' && d.unit !== 'kg') || !Number.isInteger(d.revision) || d.revision < 1) return { ok: false, reason: 'name, unit, id or revision' };
  const base = { id, name: d.name, type: d.type, unit: d.unit, revision: d.revision, copyKey: d.copyKey || null };
  if (d.type === 'plate') {
    if (!eqWeightOk(d.startWeight) || typeof d.inventoryId !== 'string' || !d.inventoryId || (d.targetMode !== 'total' && d.targetMode !== 'perDumbbell')) return { ok: false, reason: 'plate settings' };
    return { ok: true, value: Object.assign(base, { startWeight: eqW(d.startWeight), inventoryId: d.inventoryId, targetMode: d.targetMode }) }; }
  if (d.type === 'adjustable') {
    if (typeof d.perDumbbell !== 'boolean') return { ok: false, reason: 'per dumbbell' };
    if (d.mode === 'range') { if (![d.min, d.max, d.increment].every(v => eqWeightOk(v, true)) || lcToM(d.max) < lcToM(d.min) || (lcToM(d.max) - lcToM(d.min)) % lcToM(d.increment) !== 0 || (lcToM(d.max) - lcToM(d.min)) / lcToM(d.increment) + 1 > LC_MAX_SETTINGS) return { ok: false, reason: 'range' };
      return { ok: true, value: Object.assign(base, { perDumbbell: d.perDumbbell, mode: 'range', min: eqW(d.min), max: eqW(d.max), increment: eqW(d.increment) }) }; }
    if (d.mode === 'list') { const list = eqParseListText(d.listText); if (!list) return { ok: false, reason: 'list' };
      return { ok: true, value: Object.assign(base, { perDumbbell: d.perDumbbell, mode: 'list', list }) }; }
    return { ok: false, reason: 'mode' }; }
  if (d.type === 'quickdraw') {
    const m = lcToM(d.maxSetting); if (d.unit !== 'lb' || !(m >= LC_QD_MIN_M && m <= LC_QD_MAX_M && (m - LC_QD_MIN_M) % LC_QD_STEP_M === 0)) return { ok: false, reason: 'QuickDraw maximum' };
    return { ok: true, value: Object.assign(base, { maxSetting: eqW(d.maxSetting) }) }; }
  return { ok: false, reason: 'type' }; }
// Model -> document fields (without revision / timestamps / ownership, added by the writers).
function eqProfileFields(p) {
  const f = { name: p.name, type: p.type, unit: p.unit };
  if (p.type === 'plate') Object.assign(f, { startWeight: p.startWeight, inventoryId: p.inventoryId, targetMode: p.targetMode });
  else if (p.type === 'adjustable') { f.perDumbbell = !!p.perDumbbell; f.mode = p.mode;
    if (p.mode === 'range') Object.assign(f, { min: p.min, max: p.max, increment: p.increment }); else f.listText = p.list.map(eqNumText).join(','); }
  else f.maxSetting = p.maxSetting;
  return f; }
function eqInventoryFields(i) { return { name: i.name, unit: i.unit, plates: eqPlatesText(i.plates) }; }
function eqNewId(prefix) { return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
const eqServerTime = () => firebase.firestore.FieldValue.serverTimestamp();
const eqSame = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- errors shown to the lifter (unsaved input is always kept by the caller) ----
function eqError(code, message, extra) { const e = new Error(message); e.eqCode = code; Object.assign(e, extra || {}); return e; }
function eqFriendly(e) {
  if (e && e.eqCode) return e;
  const c = e && e.code;
  if (c === 'permission-denied') return eqError('denied', 'The server refused this change. Nothing was saved. If you just signed in or out, reopen the calculator.');
  if (c === 'unavailable' || c === 'deadline-exceeded' || (typeof navigator !== 'undefined' && navigator.onLine === false)) return eqError('offline', 'You’re offline, so nothing was saved. Your changes are still here; try again when you’re back online.');
  if (c === 'aborted' || c === 'failed-precondition') return eqError('busy', 'Another change was being saved at the same moment. Nothing was saved; please try again.');
  return eqError('failed', 'Couldn’t save' + (c ? ' (' + c + ')' : '') + '. Nothing was saved; your changes are still here.');
}
function eqCheckOwner(uid, epoch) { if (!eqState.uid || eqState.uid !== uid || eqState.epoch !== epoch || !auth.currentUser || auth.currentUser.uid !== uid) throw eqError('account', 'You signed out or switched accounts, so nothing was saved.'); }
async function eqRunTx(fn) {
  const uid = eqState.uid, epoch = eqState.epoch;
  if (!uid) throw eqError('account', 'Sign in to save equipment.');
  if (eqState.offline) throw eqError('offline', 'You’re offline, so nothing was saved. Your changes are still here; try again when you’re back online.');
  try { const r = await fsDb.runTransaction(tx => fn(tx, uid)); eqCheckOwner(uid, epoch); return r; }
  catch (e) { throw eqFriendly(e); }
}

// ---- inventory writes ----
// base: the inventory as the editor loaded it (null for a new one).
async function eqSaveInventory(model, base) {
  return eqRunTx(async (tx, uid) => {
    const ref = eqCol(EQ_COL_INVENTORIES).doc(model.id || eqNewId('eqi'));
    const snap = await tx.get(ref);
    if (!base) {
      if (snap.exists) throw eqError('exists', 'That inventory already exists.');
      tx.set(ref, Object.assign({ id: ref.id, ownerUid: uid }, eqInventoryFields(model), { usedBy: {}, revision: 1, createdAt: eqServerTime(), updatedAt: eqServerTime() }));
      return ref.id; }
    if (!snap.exists) throw eqError('deleted', 'This inventory was deleted on another device. Your edits are still here.');
    const cur = snap.data();
    if (cur.revision !== base.revision && !eqSame(eqInventoryFields(eqInventoryFromDoc(ref.id, cur).value || {}), eqInventoryFields(base)))
      throw eqError('conflict', 'This inventory was changed on another device. Your edits are still here.', { latest: cur });
    if (model.unit !== cur.unit && Object.keys(cur.usedBy || {}).length)
      throw eqError('unitInUse', 'This inventory is used by plate-loaded equipment in ' + cur.unit + '. Change those first, so pounds and kilograms don’t mix.');
    // (when only references changed meanwhile, the content the editor started from is still current: safe to apply)
    tx.set(ref, Object.assign({}, cur, eqInventoryFields(model), { revision: cur.revision + 1, updatedAt: eqServerTime() }));
    return ref.id; });
}
async function eqDeleteInventory(id, base) {
  return eqRunTx(async (tx) => {
    const ref = eqCol(EQ_COL_INVENTORIES).doc(id); const snap = await tx.get(ref);
    if (!snap.exists) return 'gone';
    const cur = snap.data(); const users = Object.keys(cur.usedBy || {});
    if (users.length) throw eqError('inUse', 'This inventory is used by other equipment.', { users });
    if (base && cur.revision !== base.revision) throw eqError('conflict', 'This inventory was changed on another device. Review it before deleting.');
    tx.delete(ref); return 'deleted'; });
}
// ---- profile writes (keeping usedBy consistent in the same transaction) ----
async function eqSaveProfile(model, base) {
  return eqRunTx(async (tx, uid) => {
    const id = model.id || eqNewId('eqp'); const ref = eqCol(EQ_COL_PROFILES).doc(id);
    const snap = await tx.get(ref);
    const oldInvId = base && base.type === 'plate' ? (snap.exists && snap.data().type === 'plate' ? snap.data().inventoryId : base.inventoryId) : null;
    const newInvRef = model.type === 'plate' ? eqCol(EQ_COL_INVENTORIES).doc(model.inventoryId) : null;
    const oldInvRef = oldInvId && (!newInvRef || oldInvId !== model.inventoryId) ? eqCol(EQ_COL_INVENTORIES).doc(oldInvId) : null;
    const newInv = newInvRef ? await tx.get(newInvRef) : null, oldInv = oldInvRef ? await tx.get(oldInvRef) : null;
    let revision = 1, createdAt = eqServerTime(), copyKey = null;
    if (base) {
      if (!snap.exists) throw eqError('deleted', 'This equipment was deleted on another device. Your edits are still here.');
      const cur = snap.data(); copyKey = cur.copyKey || null;
      if (cur.revision !== base.revision) throw eqError('conflict', 'This equipment was changed on another device. Your edits are still here.', { latest: cur });
      revision = cur.revision + 1; createdAt = cur.createdAt;
    } else if (snap.exists) throw eqError('exists', 'That equipment already exists.');
    if (newInvRef) {
      if (!newInv.exists) throw eqError('missingInventory', 'That plate inventory no longer exists (it may have been deleted on another device). Choose another.');
      if (newInv.data().unit !== model.unit) throw eqError('unitMismatch', 'That inventory is in ' + newInv.data().unit + '. Choose a ' + model.unit + ' inventory.');
    }
    const doc = Object.assign({ id, ownerUid: uid }, eqProfileFields(model), { revision, createdAt, updatedAt: eqServerTime() });
    if (copyKey) doc.copyKey = copyKey;
    tx.set(ref, doc);
    if (newInvRef) { const d = newInv.data(); if (!(d.usedBy || {})[id]) tx.set(newInvRef, Object.assign({}, d, { usedBy: Object.assign({}, d.usedBy, { [id]: true }), revision: d.revision + 1, updatedAt: eqServerTime() })); }
    if (oldInvRef && oldInv.exists) { const d = oldInv.data(); if ((d.usedBy || {})[id]) { const u = Object.assign({}, d.usedBy); delete u[id]; tx.set(oldInvRef, Object.assign({}, d, { usedBy: u, revision: d.revision + 1, updatedAt: eqServerTime() })); } }
    return id; });
}
async function eqDeleteProfile(id, base) {
  return eqRunTx(async (tx) => {
    const ref = eqCol(EQ_COL_PROFILES).doc(id); const snap = await tx.get(ref);
    if (!snap.exists) return 'gone';
    const cur = snap.data();
    if (base && cur.revision !== base.revision) throw eqError('conflict', 'This equipment was changed on another device. Review it before deleting.');
    const invRef = cur.type === 'plate' ? eqCol(EQ_COL_INVENTORIES).doc(cur.inventoryId) : null; const inv = invRef ? await tx.get(invRef) : null;
    tx.delete(ref);
    if (inv && inv.exists && (inv.data().usedBy || {})[id]) { const d = inv.data(); const u = Object.assign({}, d.usedBy); delete u[id]; tx.set(invRef, Object.assign({}, d, { usedBy: u, revision: d.revision + 1, updatedAt: eqServerTime() })); }
    return 'deleted'; });
}
// Reassign one plate profile to another inventory (same unit): the profile editor's save, with only inventoryId changed.
async function eqReassignProfile(profileId, newInventoryId) {
  const p = eqProfileById(profileId); if (!p) throw eqError('deleted', 'That equipment no longer exists.');
  return eqSaveProfile(Object.assign({}, p, { inventoryId: newInventoryId }), p);
}

// ==================== DEVICE COPY ====================
function eqDeviceBackup(uid) {     // read-only; never written or deleted here
  let raw = null; try { raw = localStorage.getItem(LC_STORE_KEY_PREFIX + uid); } catch (e) { return { status: 'unavailable' }; }
  if (!raw) return { status: 'none' };
  try { const d = JSON.parse(raw);
    if (!d || d.schema !== LC_SCHEMA || !Array.isArray(d.inventories) || !Array.isArray(d.profiles)) throw new Error('shape');
    if (!d.inventories.length && !d.profiles.length) return { status: 'none' };
    return { status: 'ok', data: d }; } catch (e) { return { status: 'unreadable' }; } }
function eqCopyStatus(uid) { try { return JSON.parse(localStorage.getItem(EQ_COPY_STATUS_PREFIX + uid) || 'null'); } catch (e) { return null; } }
function eqSetCopyStatus(uid, v) { try { localStorage.setItem(EQ_COPY_STATUS_PREFIX + uid, JSON.stringify(v)); return true; } catch (e) { return false; } }
function eqEnsureDeviceCopyId(uid) {
  const s = eqCopyStatus(uid); if (s && s.deviceCopyId && !s.completedAt) return s.deviceCopyId;
  const id = 'dc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  eqSetCopyStatus(uid, { deviceCopyId: id, completedAt: null, previous: s && s.completedAt ? s : null, created: (s && s.created) || [] }); return id; }
const eqSafeId = s => String(s).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
function eqCopyDocId(deviceCopyId, localId) { return 'dc_' + deviceCopyId + '_' + eqSafeId(localId); }
// Content keys: identical configuration, whatever the name.
function eqInvKey(inv) { return inv.unit + '|' + (inv.plates || []).filter(p => p.pairs > 0).map(p => lcToM(p.size) + 'x' + p.pairs).sort().join(','); }
// A profile's identity for copying: its own settings plus WHICH account
// inventory it uses (so shared-inventory relationships are kept exactly).
function eqProfKeyRef(p, inventoryRef) {
  return JSON.stringify({ t: p.type, u: p.unit, b: lcIsPerDumbbell(p) ? 'per' : 'total',
    s: p.type === 'plate' ? lcToM(p.startWeight) : null, i: p.type === 'plate' ? inventoryRef : null,
    set: p.type === 'plate' ? null : lcProfileSettingsM(p).join(',') }); }
// Short, stable fingerprint of a key (for import coordination document ids).
function eqHash(str) {
  let out = '';
  for (const seed of [0x9e3779b1, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f]) {
    let h = seed ^ str.length;
    for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 0x5bd1e995); h ^= h >>> 15; }
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
    out += (h >>> 0).toString(16).padStart(8, '0');
  }
  return out; }
// Local items are validated with the same rules as the editor (the device data may be old or hand-edited).
function eqLocalInventoryOk(i) { return i && typeof i.id === 'string' && eqNameOk(i.name) && i.name.length <= 40 && (i.unit === 'lb' || i.unit === 'kg') && Array.isArray(i.plates) && i.plates.length >= 1 && i.plates.length <= LC_MAX_PLATE_TYPES
  && i.plates.every(p => eqWeightOk(Number(p.size), true) && Number.isInteger(Number(p.pairs)) && p.pairs >= 0 && p.pairs <= LC_MAX_PAIRS); }
function eqLocalProfileOk(p) {
  if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' || p.name.length > 40) return false;
  const f = eqProfileFieldsSafe(p); return !!f && eqProfileFromDoc(p.id, Object.assign({ id: p.id, revision: 1 }, f)).ok; }
function eqProfileFieldsSafe(p) { try { return eqProfileFields(Object.assign({}, p, p.type === 'adjustable' && p.mode === 'list' ? { list: (p.list || []).map(Number) } : {})); } catch (e) { return null; } }
// NAMES are limited to EQ_NAME_MAX characters, counted as JavaScript string
// length (UTF-16 units). That is never less than Firestore's count, so a name
// that fits here always fits the rules' 40-character limit. Truncation never
// splits a character made of two units (e.g. an emoji).
const EQ_NAME_MAX = 40;
function eqTruncate(str, max) {
  let out = String(str).slice(0, Math.max(0, max));
  if (out.length && /[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);   // don't cut a surrogate pair
  return out.replace(/\s+$/, '');
}
// "Keep both": the first free name of "<base> (device)", "<base> (device 2)", ...
// with the base shortened for each suffix's real length, so every candidate fits.
function eqUniqueName(name, taken) {
  const base = String(name).trim();
  for (let n = 1; n < 10000; n++) {
    const suffix = n === 1 ? ' (device)' : ' (device ' + n + ')';
    const cand = eqTruncate(base, EQ_NAME_MAX - suffix.length) + suffix;
    if (!taken.has(cand.trim().toLowerCase())) return cand;
  }
  throw eqError('names', 'Couldn’t find a free name.');
}
function eqNormLocalInv(i) { return { id: i.id, name: i.name, unit: i.unit, plates: i.plates.map(x => ({ size: eqW(Number(x.size)), pairs: Number(x.pairs) })) }; }

// PURE plan (tested directly). choices: { 'inventory:<localId>' | 'profile:<localId>': 'keepBoth'|'skip'|'copyAnyway' }
// Each item: { kind, localId, name, status, accountId, accountName, newName, reason, expectKey }
//   copy           will be created (accountId = deterministic dc_ id)
//   alreadyCopied  an earlier attempt from this device already created it (retry): nothing to do
//   reuse          identical configuration already in the account (accountName): nothing to copy (choice copyAnyway)
//   conflict       same name, different content: needs a choice (keepBoth -> newName, or skip)
//   skip           skipped by choice
//   blocked        can't be copied (reason), e.g. its plate inventory was skipped or is broken on this device
// The plan also remembers what the preview promised (expectKey of reused
// items, the account item ids it saw) so copying can tell when it is stale.
function eqPlanCopy(local, account, deviceCopyId, choices) {
  choices = choices || {};
  const accInvKey = new Map(), accProfKey = new Map();
  account.inventories.forEach(i => { if (!accInvKey.has(eqInvKey(i))) accInvKey.set(eqInvKey(i), i); });
  account.profiles.forEach(p => { const k = eqProfKeyRef(p, p.inventoryId); if (!accProfKey.has(k)) accProfKey.set(k, p); });
  const takenInv = new Set(account.inventories.map(i => i.name.trim().toLowerCase())), takenProf = new Set(account.profiles.map(p => p.name.trim().toLowerCase()));
  const accIds = new Set(account.inventories.map(i => i.id).concat(account.profiles.map(p => p.id)));
  const items = [], invTarget = new Map();   // local inventory id -> account inventory id (new or reused) | null
  const localInvKey = new Map();
  (local.inventories || []).forEach(i0 => {
    const it = { kind: 'inventory', localId: i0 && i0.id, name: i0 && i0.name, accountId: null, accountName: null, newName: null, reason: null, expectKey: null };
    const ch = choices['inventory:' + it.localId], docId = eqCopyDocId(deviceCopyId, it.localId);
    if (!eqLocalInventoryOk(i0)) { it.status = 'blocked'; it.reason = 'This inventory couldn’t be read on this device.'; invTarget.set(it.localId, null); items.push(it); return; }
    const i = eqNormLocalInv(i0), key = eqInvKey(i); localInvKey.set(i.id, key); it.expectKey = key;
    if (accIds.has(docId)) { it.status = 'alreadyCopied'; it.accountId = docId; invTarget.set(i.id, docId); items.push(it); return; }
    const same = accInvKey.get(key);
    if (same && ch !== 'copyAnyway') { it.status = 'reuse'; it.accountId = same.id; it.accountName = same.name; invTarget.set(i.id, same.id); items.push(it); return; }
    const nameClash = takenInv.has(i.name.trim().toLowerCase());
    if (nameClash && ch !== 'keepBoth' && ch !== 'skip' && ch !== 'copyAnyway') { it.status = 'conflict'; it.reason = 'Your account already has a different inventory with this name.'; invTarget.set(i.id, null); items.push(it); return; }
    if (ch === 'skip') { it.status = 'skip'; invTarget.set(i.id, null); items.push(it); return; }
    it.status = 'copy'; it.accountId = docId; it.copyAnyway = ch === 'copyAnyway'; it.newName = nameClash ? eqUniqueName(i.name, takenInv) : i.name; takenInv.add(it.newName.toLowerCase());
    invTarget.set(i.id, docId); items.push(it); });
  (local.profiles || []).forEach(p => {
    const it = { kind: 'profile', localId: p && p.id, name: p && p.name, accountId: null, accountName: null, newName: null, reason: null, inventoryAccountId: null, inventoryLocalId: null, expectKey: null };
    const ch = choices['profile:' + (p && p.id)], docId = eqCopyDocId(deviceCopyId, p && p.id);
    if (!eqLocalProfileOk(p)) { it.status = 'blocked'; it.reason = 'This equipment couldn’t be read on this device.'; items.push(it); return; }
    if (p.type === 'plate') { if (!(local.inventories || []).some(i => i && i.id === p.inventoryId)) { it.status = 'blocked'; it.reason = 'Its plate inventory is missing on this device.'; items.push(it); return; }
      const t = invTarget.get(p.inventoryId);
      if (!t) { it.status = 'blocked'; it.reason = 'Its plate inventory isn’t being copied.'; items.push(it); return; }
      it.inventoryAccountId = t; it.inventoryLocalId = p.inventoryId; }
    if (accIds.has(docId)) { it.status = 'alreadyCopied'; it.accountId = docId; items.push(it); return; }
    const key = eqProfKeyRef(eqNormLocalProfile(p), it.inventoryAccountId), same = accProfKey.get(key);
    if (same && ch !== 'copyAnyway') { it.status = 'reuse'; it.accountId = same.id; it.accountName = same.name; it.expectKey = key; items.push(it); return; }
    const nameClash = takenProf.has(p.name.trim().toLowerCase());
    if (nameClash && ch !== 'keepBoth' && ch !== 'skip' && ch !== 'copyAnyway') { it.status = 'conflict'; it.reason = 'Your account already has different equipment with this name.'; items.push(it); return; }
    if (ch === 'skip') { it.status = 'skip'; items.push(it); return; }
    it.status = 'copy'; it.accountId = docId; it.copyAnyway = ch === 'copyAnyway'; it.newName = nameClash ? eqUniqueName(p.name, takenProf) : p.name; takenProf.add(it.newName.toLowerCase());
    items.push(it); });
  const count = s => items.filter(i => i.status === s).length;
  return { deviceCopyId, items, accountIdsAtPreview: [...accIds], ready: count('conflict') === 0, counts: { copy: count('copy'), reuse: count('reuse'), alreadyCopied: count('alreadyCopied'), conflict: count('conflict'), skip: count('skip'), blocked: count('blocked') } };
}
function eqNormLocalProfile(p) { const m = Object.assign({}, p); if (m.type === 'adjustable' && m.mode === 'list') m.list = (m.list || []).map(Number); return m; }

// Runs a plan. Safe to stop and retry at any point:
//  - every document id is deterministic (dc_<copyId>_<localId>), and each
//    step re-reads and skips what already exists;
//  - IMPORT COORDINATION: an identical item imported by any device is
//    recorded in users/{uid}/equipmentImportKeys/<fingerprint>. Each import
//    step reads that record inside its transaction and reuses the item it
//    names (after checking the item really is still identical), so two
//    devices copying the same equipment at the same moment end up with one
//    copy. Equipment made in the editor is never deduplicated, so identical
//    settings can still be kept as separate items on purpose;
//  - STALE PREVIEW: everything the preview promised is checked again inside
//    the transaction that relies on it (the plates of a reused inventory, the
//    settings of reused equipment, names that have since been taken). If it
//    changed or disappeared, copying stops with nothing half-done and the
//    preview must be reviewed again. Revision increases caused only by
//    "used by" bookkeeping are not changes.
// Steps: (1) each new inventory; (2) each new profile (with its inventory's
// "used by" entry, one per transaction); (3) check reused items and write the receipt.
async function eqRunCopy(plan, local, onProgress) {
  if (!plan.ready) throw eqError('notReady', 'Choose what to do with each name conflict first.');
  const uid = eqState.uid, epoch = eqState.epoch; const progress = m => { try { onProgress && onProgress(m); } catch (e) {} };
  const L = { inv: new Map((local.inventories || []).filter(eqLocalInventoryOk).map(i => [i.id, eqNormLocalInv(i)])), prof: new Map((local.profiles || []).filter(p => p && p.id).map(p => [p.id, eqNormLocalProfile(p)])) };
  const copyInv = plan.items.filter(i => i.kind === 'inventory' && i.status === 'copy');
  const copyProf = plan.items.filter(i => i.kind === 'profile' && i.status === 'copy');
  const reused = plan.items.filter(i => i.status === 'reuse');
  const made = new Set(), created = new Set();   // made: items this run created or reused; created: new documents
  const invTarget = new Map(plan.items.filter(i => i.kind === 'inventory' && (i.status === 'reuse' || i.status === 'alreadyCopied')).map(i => [i.localId, i.accountId]));
  const copyKey = localId => 'device:' + plan.deviceCopyId + ':' + eqSafeId(localId);
  const stale = why => eqError('stale', 'Your account changed since this preview (' + why + '). Nothing more was copied, and what was already copied is kept. Review the updated preview and press Copy again.');
  const invKeyOfDoc = s => { const r = s && s.exists ? eqInventoryFromDoc(s.id, s.data()) : null; return r && r.ok ? eqInvKey(r.value) : null; };
  const profOfDoc = s => { const r = s && s.exists ? eqProfileFromDoc(s.id, s.data()) : null; return r && r.ok ? r.value : null; };
  const live = kind => (kind === 'inventory' ? eqState.inventories : eqState.profiles).filter(x => !made.has(x.id));
  const norm = n => String(n).trim().toLowerCase();
  // NAME CHECK, inside the transaction that creates the item. The preview chose
  // a name no account item had. Every other item of this kind that this device
  // knows of is read in the same transaction, so: a rename of any of them (made
  // before this point) is seen here; and a rename made after these reads but
  // before the commit makes Firestore retry the transaction, which reads it
  // again. Items identical to the one being copied don't count: the first one
  // found is returned as `same` so it is reused instead (unless "copy anyway").
  // Returns { clash: the clashing name | null, same: an identical item id | null }.
  async function nameTakenInTx(tx, kind, it, sameContent) {
    let same = null;
    const col = kind === 'inventory' ? EQ_COL_INVENTORIES : EQ_COL_PROFILES, parse = kind === 'inventory' ? eqInventoryFromDoc : eqProfileFromDoc;
    const ids = new Set((kind === 'inventory' ? eqState.inventories : eqState.profiles).map(x => x.id)
      .concat(eqState.unreadable.filter(u => u.kind === kind).map(u => u.id)).concat(plan.accountIdsAtPreview || []));
    for (const id of ids) {
      if (made.has(id) || id === it.accountId) continue;
      const snap = await tx.get(eqCol(col).doc(id)); if (!snap.exists) continue;
      const d = snap.data(); const v = parse(id, d); const identical = v.ok && sameContent(v.value);
      if (identical && !same) same = id;
      if (d && typeof d.name === 'string' && norm(d.name) === norm(it.newName) && !identical) return { clash: d.name, same };
    }
    return { clash: null, same };
  }
  let done = 0; const total = copyInv.length + copyProf.length + 1;

  // (1) inventories
  for (const it of copyInv) {
    const inv = L.inv.get(it.localId), key = eqInvKey(inv);
    const claimRef = eqCol(EQ_COL_IMPORT_KEYS).doc('inv_' + eqHash(key));
    const liveSame = it.copyAnyway ? [] : live('inventory').filter(x => eqInvKey(x) === key).map(x => x.id);
    const target = await eqRunTx(async (tx, uidv) => {
      const ownRef = eqCol(EQ_COL_INVENTORIES).doc(it.accountId);
      const own = await tx.get(ownRef); if (own.exists) return it.accountId;      // created by an earlier attempt
      if (!it.copyAnyway) {
        const claim = await tx.get(claimRef);
        const cands = [...new Set([claim.exists ? claim.data().targetId : null].concat(liveSame).filter(Boolean))];
        for (const c of cands) { const s = await tx.get(eqCol(EQ_COL_INVENTORIES).doc(c)); if (invKeyOfDoc(s) === key) return c; }
      }
      const chk = await nameTakenInTx(tx, 'inventory', it, x => eqInvKey(x) === key);
      if (chk.same && !it.copyAnyway) return chk.same;
      if (chk.clash) throw stale('the name “' + chk.clash + '” is now used by a different inventory');
      tx.set(ownRef, Object.assign({ id: it.accountId, ownerUid: uidv }, eqInventoryFields({ name: it.newName, unit: inv.unit, plates: inv.plates }),
        { usedBy: {}, revision: 1, copyKey: copyKey(it.localId), createdAt: eqServerTime(), updatedAt: eqServerTime() }));
      if (!it.copyAnyway) tx.set(claimRef, { id: claimRef.id, ownerUid: uidv, kind: 'inventory', targetId: it.accountId, updatedAt: eqServerTime() });
      return it.accountId; });
    invTarget.set(it.localId, target); made.add(target); if (target === it.accountId) created.add(target);
    done++; progress({ done, total });
  }
  // (2) profiles
  for (const it of copyProf) {
    const p = L.prof.get(it.localId);
    const invId = p.type === 'plate' ? invTarget.get(p.inventoryId) : null;
    if (p.type === 'plate' && !invId) throw stale('a plate inventory it needs isn’t available');
    const expectInvKey = p.type === 'plate' ? eqInvKey(L.inv.get(p.inventoryId)) : null;
    const key = eqProfKeyRef(p, invId);
    const claimRef = eqCol(EQ_COL_IMPORT_KEYS).doc('prof_' + eqHash(key));
    const liveSame = it.copyAnyway ? [] : live('profile').filter(x => eqProfKeyRef(x, x.inventoryId) === key).map(x => x.id);
    const target = await eqRunTx(async (tx, uidv) => {
      const pref = eqCol(EQ_COL_PROFILES).doc(it.accountId);
      const ps = await tx.get(pref); if (ps.exists) return it.accountId;
      const iref = invId ? eqCol(EQ_COL_INVENTORIES).doc(invId) : null;
      const is = iref ? await tx.get(iref) : null;
      if (iref && invKeyOfDoc(is) !== expectInvKey) throw stale(is && is.exists ? 'the plates of “' + (is.data().name || 'an inventory') + '” changed' : 'a plate inventory was deleted');
      if (!it.copyAnyway) {
        const claim = await tx.get(claimRef);
        const cands = [...new Set([claim.exists ? claim.data().targetId : null].concat(liveSame).filter(Boolean))];
        for (const c of cands) { const s = await tx.get(eqCol(EQ_COL_PROFILES).doc(c)); const v = profOfDoc(s); if (v && eqProfKeyRef(v, v.inventoryId) === key) return c; }
      }
      const chk = await nameTakenInTx(tx, 'profile', it, x => eqProfKeyRef(x, x.inventoryId) === key);
      if (chk.same && !it.copyAnyway) return chk.same;
      if (chk.clash) throw stale('the name “' + chk.clash + '” is now used by different equipment');
      const m = Object.assign({}, p, { name: it.newName, inventoryId: invId || undefined });
      tx.set(pref, Object.assign({ id: it.accountId, ownerUid: uidv }, eqProfileFields(m), { revision: 1, copyKey: copyKey(it.localId), createdAt: eqServerTime(), updatedAt: eqServerTime() }));
      if (iref) { const d = is.data(); tx.set(iref, Object.assign({}, d, { usedBy: Object.assign({}, d.usedBy, { [it.accountId]: true }), revision: d.revision + 1, updatedAt: eqServerTime() })); }
      if (!it.copyAnyway) tx.set(claimRef, { id: claimRef.id, ownerUid: uidv, kind: 'profile', targetId: it.accountId, updatedAt: eqServerTime() });
      return it.accountId; });
    made.add(target); if (target === it.accountId) created.add(target);
    done++; progress({ done, total });
  }
  // (3) reused items must still be what the preview promised; then the receipt
  const summary = { copied: plan.counts.copy, reused: plan.counts.reuse, alreadyCopied: plan.counts.alreadyCopied, skipped: plan.counts.skip, blocked: plan.counts.blocked };
  await eqRunTx(async (tx, uidv) => {
    for (const it of reused) {
      if (it.kind === 'inventory') { const s = await tx.get(eqCol(EQ_COL_INVENTORIES).doc(it.accountId));
        if (invKeyOfDoc(s) !== it.expectKey) throw stale(s.exists ? 'the plates of “' + it.accountName + '” changed' : '“' + it.accountName + '” was deleted'); }
      else { const s = await tx.get(eqCol(EQ_COL_PROFILES).doc(it.accountId)); const v = profOfDoc(s);
        if (!v || eqProfKeyRef(v, v.inventoryId) !== it.expectKey) throw stale(v ? '“' + it.accountName + '” was changed' : '“' + it.accountName + '” was deleted');
        if (v.type === 'plate') { const lp = L.prof.get(it.localId); const is = await tx.get(eqCol(EQ_COL_INVENTORIES).doc(v.inventoryId));
          if (invKeyOfDoc(is) !== eqInvKey(L.inv.get(lp.inventoryId))) throw stale('the plates used by “' + it.accountName + '” changed'); } }
    }
    const r = eqCol(EQ_COL_COPIES).doc(plan.deviceCopyId); const s = await tx.get(r);
    if (!s.exists) tx.set(r, { id: plan.deviceCopyId, ownerUid: uidv, createdAt: eqServerTime(), summary }); });
  eqCheckOwner(uid, epoch);
  // The ids created are remembered on this device, so a same-name item another
  // device creates at the very last moment (a brand-new document no transaction
  // could have read) is still pointed out afterwards (eqCopyNameClashes).
  const prev = eqCopyStatus(uid) || {};
  const createdAll = [...new Set(((prev && prev.created) || []).concat([...created]))];
  eqSetCopyStatus(uid, { deviceCopyId: plan.deviceCopyId, completedAt: Date.now(), summary, created: createdAll });
  progress({ done: total, total });
  return Object.assign({ created: [...created] }, summary);
}
// Items this device's copies created that now share a name with a different
// account item (e.g. one created on another device while copying). Shown in
// the calculator and Manage Equipment until renamed, so it is never silent.
function eqCopyNameClashes(uid) {
  const st = eqCopyStatus(uid); const ids = new Set((st && st.created) || []); const out = [];
  if (!ids.size) return out;
  const n = x => String(x).trim().toLowerCase();
  [eqState.inventories, eqState.profiles].forEach(list => list.forEach(x => {
    if (!ids.has(x.id)) return;
    const other = list.find(o => o.id !== x.id && !ids.has(o.id) && n(o.name) === n(x.name));
    if (other) out.push(x.name);
  }));
  return [...new Set(out)];
}
// The device preference "last used equipment" (never synced).
function eqLastProfile(uid) { try { return localStorage.getItem(EQ_LAST_PROFILE_PREFIX + uid); } catch (e) { return null; } }
function eqSetLastProfile(uid, id) { try { localStorage.setItem(EQ_LAST_PROFILE_PREFIX + uid, id); } catch (e) {} }
