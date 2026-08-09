// ==================== FIREBASE INIT ====================
const firebaseConfig = {
  apiKey: "AIzaSyA7i7i5hjGGn-a_dhDURFRMTc7SMGdflhg",
  authDomain: "ironlog-f620e.firebaseapp.com",
  projectId: "ironlog-f620e",
  storageBucket: "ironlog-f620e.firebasestorage.app",
  messagingSenderId: "929849859248",
  appId: "1:929849859248:web:47f2457e7658ee6fdb6f75"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const fsDb = firebase.firestore();
fsDb.enablePersistence({ synchronizeTabs: false }).catch(() => {});

let COL_WORKOUTS, COL_PROGRAMS, COL_CUSTOM_EX, COL_META, COL_EX_NOTES,
    COL_IMPORTED_SETS, COL_EX_VIDEOS, COL_EX_OVERRIDES,
    COL_EX_COLLECTIONS, COL_EX_COLLECTION_MEMBERSHIP;
let firestoreListeners = [];

function initCollections(uid) {
  const base = fsDb.collection('users').doc(uid);
  COL_WORKOUTS      = base.collection('workouts');
  COL_PROGRAMS      = base.collection('programs');
  COL_CUSTOM_EX     = base.collection('customExercises');
  COL_META          = base.collection('meta');
  COL_EX_NOTES      = base.collection('exerciseNotes');
  COL_IMPORTED_SETS = base.collection('importedSets');
  COL_EX_VIDEOS     = base.collection('exerciseVideos');
  COL_EX_OVERRIDES  = base.collection('exerciseOverrides');
  // Exercise Collections (Stage 2). COL_EX_COLLECTIONS is the canonical source of
  // Collection identity/membership/consolidation. COL_EX_COLLECTION_MEMBERSHIP is
  // derived integrity data only (Section 6/15) -- never loaded into appDb, never
  // listened to, and deliberately has no fsSave.../fsDel... convenience wrapper:
  // every write to either collection happens inside an explicit, awaited
  // transaction in app-collections.js so failures are never silently swallowed.
  COL_EX_COLLECTIONS           = base.collection('exerciseCollections');
  COL_EX_COLLECTION_MEMBERSHIP = base.collection('exerciseCollectionMembership');
}

function fsSet(col, id, data)   { col.doc(id).set(data).catch(e => console.error(e)); }
function fsDel(col, id)         { col.doc(id).delete().catch(e => console.error(e)); }
function fsSaveWorkout(w)       { fsSet(COL_WORKOUTS,  w.id, w); }
function fsDelWorkout(id)       { fsDel(COL_WORKOUTS,  id); }
function fsSaveProgram(p)       { fsSet(COL_PROGRAMS,  p.id, p); }
function fsDelProgram(id)       { fsDel(COL_PROGRAMS,  id); }
function fsSaveCustomEx(ex)     { fsSet(COL_CUSTOM_EX, ex.id, ex); }
function fsDelCustomEx(id)      { fsDel(COL_CUSTOM_EX, id); }
function fsSavePrefs()          { COL_META.doc('prefs').set({ unit: appDb.unit, e1rmFormula: appDb.e1rmFormula }); }
function fsSaveExNote(exId, note)     { COL_EX_NOTES.doc(exId).set({ note }).catch(e => console.error(e)); }
function fsSaveExVideos(exId, videos) { COL_EX_VIDEOS.doc(exId).set({ videos }).catch(e => console.error(e)); }
function fsSaveExOverride(exId, data) { COL_EX_OVERRIDES.doc(exId).set(data).catch(e => console.error(e)); }
