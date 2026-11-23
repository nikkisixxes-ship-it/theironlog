// ==================== EXERCISE LOADING SETTINGS (Stage 3) ====================
// One lasting loading preference per exercise, kept in the signed-in account
// at users/{uid}/exerciseLoading/{exerciseId} (system and custom exercises use
// their stable exercise id). LIBRARY and the workout logger open the SAME
// document through the same editor (a view of the Load Calculator dialog,
// app-load-calc.js), so a change on one device appears on the others.
//
// WHAT IT HOLDS
//   mode            'none' (nothing chosen), 'equipment' (linked to an account
//                   equipment profile) or 'direct' (typed settings)
//   equipmentId     only when mode is 'equipment'
//   direct          { kind:'step', unit, origin, step } or { kind:'list', unit, listText }.
//                   Kept when another mode is chosen, so switching back never
//                   loses it; only used when mode is 'direct'.
//   minimumUsableLoad { value, unit }  optional, separate from origin and step
//   implements      1 or 2, optional: never guessed (not from Bilateral/Unilateral)
//   defaultBasis    'total' or 'perImplement', optional, only with implements 2
//   schemaVersion 1, revision (compare-and-set), createdAt, updatedAt, ownerUid, id
//
// WHAT IT DOES NOT DO (Stage 3): nothing here reads or changes a workout, a
// set, PLAN, progression, statistics or HISTORY. Filling in workout weights
// from these settings is a later stage and stays off.
//
// REFERENCES: an equipment profile lists the exercises linked to it in
// `usedByExercises` (exerciseId -> true). Linking, reassigning, unlinking and
// deleting change the preference and the profile(s) in ONE transaction; the
// rules check both directions. Equipment that exercises use can't be deleted.

const EL_COL = 'exerciseLoading';
const EL_SCHEMA = 1;
const EL_DEFAULT_STEP = { lb: 5, kg: 2.5 };   // only when nothing is configured

let elState = { uid: null, status: 'signedOut', error: null, offline: false, epoch: 0, unsub: null,
  serverSeen: false, docs: null, prefs: {}, unreadable: {}, subscribers: [] };

function elNotify() { elState.subscribers.slice().forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }
function elSubscribe(fn) { elState.subscribers.push(fn); return () => { elState.subscribers = elState.subscribers.filter(f => f !== fn); }; }
function elColFor(uid) { return fsDb.collection('users').doc(uid).collection(EL_COL); }
function elProfRefFor(uid, pid) { return fsDb.collection('users').doc(uid).collection(EQ_COL_PROFILES).doc(pid); }

// ---- the exercise must exist (revision 1) ----
// Settings may only be created, changed or relinked for an exercise that exists:
// a built-in exercise (its id is in the app's built-in list, the same list the
// rules carry), or a custom exercise whose document is read INSIDE the same
// transaction. If another device deletes the custom exercise first, the save is
// refused; if the deletion lands while the save is running, Firestore retries
// the save (its read changed) and it is refused then. The rules check the same
// thing on the server, so no client can skip it.
function elIsBuiltInExercise(id) { return typeof DEFAULT_EXERCISES !== 'undefined' && DEFAULT_EXERCISES.some(e => e.id === id); }
function elCustomExRefFor(uid, id) { return fsDb.collection('users').doc(uid).collection('customExercises').doc(id); }
const EL_EXERCISE_DELETED = 'This exercise was deleted (perhaps on another device), so its loading settings can’t be saved. Nothing was saved. Your entries are still shown.';
async function elRequireExerciseInTx(tx, uid, exId) {
  if (elIsBuiltInExercise(exId)) return;
  const s = await tx.get(elCustomExRefFor(uid, exId));
  if (!s.exists) throw eqError('exerciseDeleted', EL_EXERCISE_DELETED);
}

// ---- auth boundary (called with eqResetForOwner on every sign-in / sign-out / switch) ----
function elResetForOwner(uid) {
  if (elState.unsub) { try { elState.unsub(); } catch (e) {} }
  elState.epoch++;
  Object.assign(elState, { uid: uid || null, status: uid ? 'idle' : 'signedOut', error: null, offline: false, unsub: null,
    serverSeen: false, docs: null, prefs: {}, unreadable: {} });
  elNotify();
}
function elEnsureStarted() {
  if (!elState.uid || (elState.status !== 'idle' && elState.status !== 'failed')) return;
  const epoch = ++elState.epoch;
  if (elState.unsub) { try { elState.unsub(); } catch (e) {} }
  Object.assign(elState, { status: 'loading', error: null, serverSeen: false, docs: null });
  elState.unsub = elColFor(elState.uid).onSnapshot({ includeMetadataChanges: true }, snap => {
    if (epoch !== elState.epoch) return;
    const fromCache = !!(snap.metadata && snap.metadata.fromCache);
    if (!fromCache) elState.serverSeen = true;
    elState.offline = fromCache;
    elState.docs = snap.docs.map(d => ({ id: d.id, data: d.data() }));
    elRecompute();
  }, err => {
    if (epoch !== elState.epoch) return;
    elState.status = 'failed'; elState.error = (err && err.code) || 'unknown'; elNotify();
  });
  elNotify();
}
// Start reading for the signed-in account. If this file loaded after the first
// sign-in callback ran (a slow script load), the owner is taken from auth here,
// as the Load Calculator already does for equipment.
function elStartForCurrentOwner() {
  const uid = (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.uid) || null;
  if (!uid) return;
  if (eqState.uid !== uid) eqResetForOwner(uid);
  if (elState.uid !== uid) elResetForOwner(uid);
  eqEnsureStarted(); elEnsureStarted();
}
function elRetry() { if (elState.status === 'failed' || elState.status === 'cachedOnly') { elState.status = 'idle'; elEnsureStarted(); } }
function elRecompute() {
  if (elState.status === 'failed' || !elState.docs) return;
  const prefs = {}, unreadable = {};
  elState.docs.forEach(d => { const r = elFromDoc(d.id, d.data); if (r.ok) prefs[d.id] = r.value; else unreadable[d.id] = { reason: r.reason, raw: d.data }; });
  elState.prefs = prefs; elState.unreadable = unreadable;
  elState.status = elState.serverSeen ? 'ready' : 'cachedOnly';
  elNotify();
}

// ---- document <-> model (kept identical to firestore.rules exerciseLoading) ----
const elUnitOk = u => u === 'lb' || u === 'kg';
const elIdOk = id => typeof id === 'string' && id.length >= 1 && id.length <= 200 && id.indexOf('/') === -1;
const EL_KEYS = ['id', 'ownerUid', 'schemaVersion', 'mode', 'equipmentId', 'direct', 'minimumUsableLoad', 'implements', 'defaultBasis', 'revision', 'createdAt', 'updatedAt'];
function elDirectFromDoc(x) {
  if (!x || typeof x !== 'object' || !elUnitOk(x.unit)) return null;
  if (x.kind === 'step') { if (Object.keys(x).some(k => ['kind', 'unit', 'origin', 'step'].indexOf(k) === -1)) return null;
    if (!eqWeightOk(x.origin) || !eqWeightOk(x.step, true)) return null; return { kind: 'step', unit: x.unit, origin: eqW(x.origin), step: eqW(x.step) }; }
  if (x.kind === 'list') { if (Object.keys(x).some(k => ['kind', 'unit', 'listText'].indexOf(k) === -1)) return null;
    const list = eqParseListText(x.listText); if (!list) return null; return { kind: 'list', unit: x.unit, list }; }
  return null;
}
function elFromDoc(id, d) {
  if (!d || typeof d !== 'object') return { ok: false, reason: 'not a document' };
  if (Object.keys(d).some(k => EL_KEYS.indexOf(k) === -1)) return { ok: false, reason: 'unknown fields' };
  if (d.id !== id || d.schemaVersion !== EL_SCHEMA || !Number.isInteger(d.revision) || d.revision < 1) return { ok: false, reason: 'id, version or revision' };
  const m = { exerciseId: id, mode: d.mode, equipmentId: null, direct: null, minimum: null, implements: null, defaultBasis: null, revision: d.revision };
  if (d.mode === 'equipment') { if (!elIdOk(d.equipmentId)) return { ok: false, reason: 'equipment link' }; m.equipmentId = d.equipmentId; }
  else if (d.mode === 'none' || d.mode === 'direct') { if ('equipmentId' in d) return { ok: false, reason: 'equipment link' }; }
  else return { ok: false, reason: 'mode' };
  if ('direct' in d) { m.direct = elDirectFromDoc(d.direct); if (!m.direct) return { ok: false, reason: 'direct settings' }; }
  if (d.mode === 'direct' && !m.direct) return { ok: false, reason: 'direct settings' };
  if ('minimumUsableLoad' in d) { const x = d.minimumUsableLoad;
    if (!x || typeof x !== 'object' || Object.keys(x).length !== 2 || !eqWeightOk(x.value, true) || !elUnitOk(x.unit)) return { ok: false, reason: 'minimum' };
    m.minimum = { value: eqW(x.value), unit: x.unit }; }
  if ('implements' in d) { if (d.implements !== 1 && d.implements !== 2) return { ok: false, reason: 'implements' }; m.implements = d.implements; }
  if ('defaultBasis' in d) { if ((d.defaultBasis !== 'total' && d.defaultBasis !== 'perImplement') || m.implements !== 2) return { ok: false, reason: 'basis' }; m.defaultBasis = d.defaultBasis; }
  return { ok: true, value: m };
}
// Model -> document fields (without id / owner / revision / timestamps). Unknown values stay unset.
function elFields(m) {
  const f = { schemaVersion: EL_SCHEMA, mode: m.mode };
  if (m.mode === 'equipment') f.equipmentId = m.equipmentId;
  if (m.direct) f.direct = m.direct.kind === 'step' ? { kind: 'step', unit: m.direct.unit, origin: m.direct.origin, step: m.direct.step }
    : { kind: 'list', unit: m.direct.unit, listText: m.direct.list.map(eqNumText).join(',') };
  if (m.minimum) f.minimumUsableLoad = { value: m.minimum.value, unit: m.minimum.unit };
  if (m.implements) f.implements = m.implements;
  if (m.defaultBasis) f.defaultBasis = m.defaultBasis;
  return f;
}
function elEmptyModel(exId) { return { exerciseId: exId, mode: 'none', equipmentId: null, direct: null, minimum: null, implements: null, defaultBasis: null, revision: 0 }; }
function elPref(exId) { return elState.prefs[exId] || null; }

// ---- PRECEDENCE (spec §4.2, levels 3 and 4; levels 1-2 belong to workouts, a later stage) ----
// Answers "what loading applies to this exercise right now" for the calculator
// and the editor's summary. Never invents availability: a missing or unreadable
// link is reported as a problem, never replaced by the default steps.
//   { state:'loading'|'failed'|'unconfirmed' }                          can't tell yet
//   { state:'problem', problem:'unreadable'|'missingEquipment'|'unreadableEquipment'|'unconfirmedEquipment', ... }
//   { state:'ok', availability:{ source:'equipment', profile } | { source:'direct', direct } | { source:'default', unit, step, origin:0 }, minimum|null, implements|null, defaultBasis|null }
function elResolve(exId, unit) {
  if (elState.status === 'idle' || elState.status === 'loading' || elState.status === 'signedOut') return { state: 'loading' };
  if (elState.status === 'failed') return { state: 'failed', error: elState.error };
  if (elState.unreadable[exId]) return { state: 'problem', problem: 'unreadable' };
  const p = elPref(exId);
  if (!p && elState.status !== 'ready') return { state: 'unconfirmed' };
  const extra = p ? { minimum: p.minimum, implements: p.implements, defaultBasis: p.defaultBasis } : { minimum: null, implements: null, defaultBasis: null };
  if (p && p.mode === 'equipment') {
    const prof = eqProfileById(p.equipmentId);
    if (prof) return Object.assign({ state: 'ok', availability: { source: 'equipment', profile: prof } }, extra);
    if (eqState.status === 'idle' || eqState.status === 'loading') return { state: 'loading' };
    if (eqState.status === 'failed') return { state: 'failed', error: eqState.error };
    if (eqState.unreadable.some(u => u.kind === 'profile' && u.id === p.equipmentId)) return { state: 'problem', problem: 'unreadableEquipment', equipmentId: p.equipmentId };
    if (eqState.status !== 'ready') return { state: 'problem', problem: 'unconfirmedEquipment', equipmentId: p.equipmentId };
    return { state: 'problem', problem: 'missingEquipment', equipmentId: p.equipmentId };
  }
  if (p && p.mode === 'direct') return Object.assign({ state: 'ok', availability: { source: 'direct', direct: p.direct } }, extra);
  const u = unit === 'kg' ? 'kg' : 'lb';
  return Object.assign({ state: 'ok', availability: { source: 'default', unit: u, origin: 0, step: EL_DEFAULT_STEP[u] } }, extra);
}

// Exercises that link to a profile: from the profile's own list and from the
// preferences (so a broken list can't hide one).
function elDependents(profileId) {
  const ids = new Set();
  const prof = eqProfileById(profileId); if (prof) Object.keys(prof.exerciseUsers || {}).forEach(k => ids.add(k));
  Object.keys(elState.prefs).forEach(k => { const p = elState.prefs[k]; if (p.mode === 'equipment' && p.equipmentId === profileId) ids.add(k); });
  return [...ids].map(id => { const ex = typeof getExercise === 'function' ? getExercise(id) : null;
    const p = elState.prefs[id]; const linked = !!(p && p.mode === 'equipment' && p.equipmentId === profileId);
    return { exerciseId: id, name: ex ? ex.name : '(deleted exercise)', exists: !!ex, linked }; })
    .sort((a, b) => a.name.localeCompare(b.name) || a.exerciseId.localeCompare(b.exerciseId));
}

// ---- writes ----
async function elRunTx(fn) {
  const uid = elState.uid, epoch = elState.epoch;
  if (!uid) throw eqError('account', 'Sign in to save loading settings.');
  if (elState.offline || eqState.offline || (typeof navigator !== 'undefined' && navigator.onLine === false))
    throw eqError('offline', 'You’re offline, so nothing was saved. Your changes are still here; try again when you’re back online.');
  try {
    const r = await fsDb.runTransaction(tx => fn(tx, uid));
    if (!elState.uid || elState.uid !== uid || elState.epoch !== epoch || !auth.currentUser || auth.currentUser.uid !== uid)
      throw eqError('account', 'You signed out or switched accounts, so nothing was saved here.');
    return r;
  } catch (e) { throw eqFriendly(e); }
}
// Write `next` (a complete document body or null to delete) for exercise exId
// whose current raw document is `cur`, moving the equipment link in the same
// transaction. Every read happens before this is called (Firestore requires it):
// profs = { [profileId]: snapshot } for the old and the new linked profiles.
function elWriteWithLinks(tx, uid, exId, cur, next, profs) {
  const oldLink = cur && cur.mode === 'equipment' ? cur.equipmentId : null;
  const newLink = next && next.mode === 'equipment' ? next.equipmentId : null;
  const ref = elColFor(uid).doc(exId);
  if (next) tx.set(ref, next); else tx.delete(ref);
  const bumpProf = (pid, fn) => { const s = profs[pid]; if (!s || !s.exists) return; const d = s.data();
    const u = Object.assign({}, d.usedByExercises || {}); if (!fn(u)) return;
    tx.set(elProfRefFor(uid, pid), Object.assign({}, d, { usedByExercises: u, revision: d.revision + 1, updatedAt: eqServerTime() })); };
  if (oldLink && oldLink !== newLink) bumpProf(oldLink, u => { if (!u[exId]) return false; delete u[exId]; return true; });
  if (newLink && newLink !== oldLink) bumpProf(newLink, u => { if (u[exId]) return false; u[exId] = true; return true; });
  else if (newLink && newLink === oldLink) bumpProf(newLink, u => { if (u[exId]) return false; u[exId] = true; return true; }); // repair a missing listing
}
async function elReadProfiles(tx, uid, ids) {
  const out = {};
  for (const pid of ids) if (pid && !out[pid]) out[pid] = await tx.get(elProfRefFor(uid, pid));
  return out;
}
// Save from the editor. baseRevision: the revision the editor started from (0 = no document yet).
async function elSavePreference(exId, model, baseRevision) {
  if (!elIdOk(exId)) throw eqError('failed', 'This exercise can’t have loading settings.');
  return elRunTx(async (tx, uid) => {
    const ref = elColFor(uid).doc(exId); const snap = await tx.get(ref);
    // First: the exercise itself. A deleted exercise is never "settings removed" (which may be recreated).
    await elRequireExerciseInTx(tx, uid, exId);
    const cur = snap.exists ? snap.data() : null;
    const curRev = cur && Number.isInteger(cur.revision) ? cur.revision : 0;
    if (curRev !== baseRevision) throw eqError(cur ? 'conflict' : 'deleted', cur
      ? 'These loading settings were changed on another device. Your edits are still here.'
      : 'These loading settings were removed on another device (or the exercise was deleted). Your edits are still here.', { latest: cur });
    if (cur && (cur.createdAt == null || !Number.isInteger(cur.revision)))
      throw eqError('damaged', 'The saved settings are too damaged to replace from here (no revision or creation time). Nothing was changed.');
    const oldLink = cur && cur.mode === 'equipment' && typeof cur.equipmentId === 'string' ? cur.equipmentId : null;
    const newLink = model.mode === 'equipment' ? model.equipmentId : null;
    const profs = await elReadProfiles(tx, uid, [oldLink, newLink]);
    if (newLink) {
      const ps = profs[newLink];
      if (!ps.exists) throw eqError('missingEquipment', 'That equipment no longer exists (it may have been deleted on another device). Choose other equipment. Your edits are still here.');
      if (!eqProfileFromDoc(newLink, ps.data()).ok) throw eqError('unreadableEquipment', 'That equipment can’t be read, so it can’t be linked. Choose other equipment.');
    }
    const next = Object.assign({ id: exId, ownerUid: uid }, elFields(model), { revision: curRev + 1, createdAt: cur ? cur.createdAt : eqServerTime(), updatedAt: eqServerTime() });
    elWriteWithLinks(tx, uid, exId, cur, next, profs);
    return next.revision;
  });
}
// From the "equipment in use" screen: move one exercise from profile `fromId`
// to `toId` (or unlink when toId is null). Works on the CURRENT document, so it
// never overwrites unrelated settings; if the exercise no longer links fromId,
// only a stale listing is removed. Returns 'moved' | 'unlinked' | 'cleaned' | 'unchanged'.
// Settings left behind by a deleted custom exercise can't be reassigned
// ('exerciseDeleted'); unlinking them removes the settings and the listing together.
async function elRelink(exId, fromId, toId) {
  return elRunTx(async (tx, uid) => {
    const ref = elColFor(uid).doc(exId); const snap = await tx.get(ref);
    const cur = snap.exists ? snap.data() : null;
    const links = cur && cur.mode === 'equipment' && cur.equipmentId === fromId;
    let exerciseGone = false;
    if (links) { try { await elRequireExerciseInTx(tx, uid, exId); } catch (e) { if (e.eqCode !== 'exerciseDeleted') throw e; exerciseGone = true; } }
    const profs = await elReadProfiles(tx, uid, [fromId, toId]);
    if (exerciseGone) {
      if (toId) throw eqError('exerciseDeleted', 'This exercise was deleted, so its leftover settings can’t be moved to other equipment. Use Remove instead.');
      elWriteWithLinks(tx, uid, exId, cur, null, profs);
      return 'cleaned';
    }
    if (!links) {
      const fs = profs[fromId];
      if (fs && fs.exists && (fs.data().usedByExercises || {})[exId]) {
        const d = fs.data(); const u = Object.assign({}, d.usedByExercises); delete u[exId];
        tx.set(elProfRefFor(uid, fromId), Object.assign({}, d, { usedByExercises: u, revision: d.revision + 1, updatedAt: eqServerTime() }));
        return 'cleaned';
      }
      return 'unchanged';
    }
    if (!Number.isInteger(cur.revision) || cur.createdAt == null) throw eqError('unreadable', 'This exercise’s loading settings can’t be read. Open them from LIBRARY to replace them.');
    if (toId) { const ts = profs[toId]; if (!ts.exists) throw eqError('missingEquipment', 'That equipment no longer exists. Choose other equipment.'); }
    const next = Object.assign({}, cur, { revision: cur.revision + 1, updatedAt: eqServerTime() });
    if (toId) next.equipmentId = toId; else { next.mode = 'none'; delete next.equipmentId; }
    elWriteWithLinks(tx, uid, exId, cur, next, profs);
    return toId ? 'moved' : 'unlinked';
  });
}

// ---- custom-exercise deletion (called inside the existing deletion transaction) ----
// Read phase: the preference and its linked profile. Apply phase: delete the
// preference and remove the exercise from the profile's list, atomically with
// the exercise itself (the rules refuse deleting a custom exercise while its
// preference still exists).
async function elPrepareExerciseDeletion(tx, uid, exId) {
  const snap = await tx.get(elColFor(uid).doc(exId));
  if (!snap.exists) return { exId, cur: null, profs: {} };
  const cur = snap.data();
  const link = cur && cur.mode === 'equipment' && typeof cur.equipmentId === 'string' ? cur.equipmentId : null;
  return { exId, cur, profs: await elReadProfiles(tx, uid, [link]) };
}
function elApplyExerciseDeletion(tx, uid, plan) {
  if (!plan || !plan.cur) return;
  elWriteWithLinks(tx, uid, plan.exId, plan.cur, null, plan.profs);
}

// ---- shown text ----
function elFmt(n) { return lcFmt(lcToM(n)); }
function elDirectText(d) {
  if (!d) return '';
  if (d.kind === 'step') return `${elFmt(d.step)} ${d.unit} steps from ${elFmt(d.origin)} ${d.unit}`;
  const l = d.list; return `${l.length} weight${l.length === 1 ? '' : 's'}: ${l.slice(0, 6).map(elFmt).join(', ')}${l.length > 6 ? '…' : ''} ${d.unit}`;
}
// One-line summary for LIBRARY and the editor.
function elSummaryText(exId) {
  const r = elResolve(exId, typeof appDb !== 'undefined' ? appDb.unit : 'lb');
  if (r.state === 'loading') return 'Loading…';
  if (r.state === 'failed') return 'Couldn’t load loading settings.';
  if (r.state === 'unconfirmed') return 'Offline: not confirmed yet.';
  if (r.state === 'problem') return r.problem === 'unreadable' ? 'Saved settings can’t be read.' : r.problem === 'missingEquipment' ? 'Linked equipment is missing.' : r.problem === 'unreadableEquipment' ? 'Linked equipment can’t be read.' : 'Offline: linked equipment not confirmed.';
  const a = r.availability; const parts = [];
  if (a.source === 'equipment') parts.push(a.profile.name);
  else if (a.source === 'direct') parts.push(elDirectText(a.direct));
  else parts.push('Not set');
  if (r.minimum) parts.push(`minimum ${elFmt(r.minimum.value)} ${r.minimum.unit}`);
  if (r.implements) parts.push(r.implements === 1 ? 'one implement' : 'two implements' + (r.defaultBasis ? (r.defaultBasis === 'total' ? ', combined' : ', per implement') : ''));
  return parts.join(' · ');
}
