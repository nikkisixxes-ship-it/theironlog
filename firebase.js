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
// startup-read-fix: coordinated multi-tab persistence. `persistenceReady` is an
// explicit Promise the authenticated init sequence in app-core.js awaits before
// doing any Firestore reads or attaching listeners. It always resolves (never
// rejects) so a persistence problem never blocks the app permanently -- it just
// resolves to false and app-core logs a fallback warning with the error code.
const persistenceReady = fsDb.enablePersistence({ synchronizeTabs: true })
  .then(() => {
    console.log('[IRON LOG startup-read-fix] persistence: multi-tab enabled');
    return true;
  })
  .catch(err => {
    console.warn('[IRON LOG startup-read-fix] persistence unavailable, continuing without it — code:', err && err.code, '| message:', err && err.message);
    return false;
  });

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

  // Slice 2 (Canonical PLAN Persistence Handles and Disabled Writer Gate,
  // Draft 0.1, §9): initialize the canonical reference registry from this
  // existing authenticated collection-initialization flow. This constructs
  // Firestore reference *handles* only -- see the CANONICAL PLAN PERSISTENCE
  // HANDLES section below for the full boundary. No read, write, query,
  // listener, batch, or transaction happens here or inside that call.
  fsPlanInitCanonicalReferences(uid);
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

// ==================== CANONICAL PLAN PERSISTENCE HANDLES (Slice 2) ====================
// Controlling authority: IRON LOG Canonical PLAN Persistence Handles and Disabled
// Writer Gate Specification, Draft 0.1 (approved). Depends on the source-accepted
// Slice 1 pure canonical model in app-plan.js.
//
// Scope, stated honestly: everything below builds Firestore CollectionReference /
// DocumentReference *handles* -- local objects that name a location -- and nothing
// else. Nothing in this section ever reads, writes, queries, listens, batches, or
// transacts against Firestore FROM THE BROWSER-VISIBLE SURFACE. The one writer
// entry point (fsPlanCommitCanonicalPackage) always rejects before doing anything
// at all with its argument. No Slice 1 read plan or write plan is executed by
// anything reachable from that entry point. No Save Template / Start on Train /
// UI / navigation behavior is touched.
//
// Slice 3 addendum (IRON LOG Canonical PLAN Bounded Transaction Executor
// Specification, Draft 0.1, approved): a private, non-browser-reachable
// transaction executor is now defined further down inside this same closure
// (see "CANONICAL PLAN BOUNDED TRANSACTION EXECUTOR" below). It genuinely does
// perform Firestore transaction reads/writes -- but ONLY when explicitly built
// and invoked via fsPlanPersistence.__test.buildCanonicalCommitExecutor, which
// exists solely under the guarded Node-only test surface and is structurally
// absent from a real browser load. fsPlanCommitCanonicalPackage never binds to
// or calls it. The statement above -- that the browser-visible surface performs
// no Firestore operations -- remains completely accurate.
//
// Collision safety: firebase.js loads before app-plan.js as classic <script> tags
// sharing one global scope. Slice 1 already declares top-level PLAN_COLLECTION_MAP,
// PLAN_SYSTEM_COLLECTIONS, and PLAN_SCHEMA_AUTHORITY_PATH in app-plan.js -- this
// section never redeclares those names and keeps its own equivalent schema map
// entirely private inside one closure. The only new top-level names this section
// adds are fsPlanPersistence and the six fsPlan-prefixed functions below.
//
// Round-2 source review correction: fsPlanPersistence (and, further down, each
// of the six fsPlan-prefixed wrapper functions) is declared with `const`, not
// `var`. A top-level `const` in a classic <script> can never be reassigned --
// the attempt throws a TypeError, in strict mode or not -- and, unlike `var`,
// it is never mirrored onto the global object as a plain, overwritable
// property. Previously these were `var`/`function` declarations, which are
// ordinary writable global-object properties; a caller could replace
// fsPlanPersistence (or any one of the six wrappers) with a forged
// replacement after the fact, and the wrapper functions -- which look up
// fsPlanPersistence by name on every call -- would silently start delegating
// to that forgery instead of the real, frozen adapter. `const` closes that
// off entirely: every one of these seven bindings still resolves correctly
// by its bare name from anywhere later in this same script (or from a later
// <script> tag sharing this global scope, exactly like the pre-existing
// `const fsDb`/`auth`/`firebaseConfig` above already do), but nothing outside
// this file can ever repoint what that name refers to.
const fsPlanPersistence = (function () {

  // ---- Exact 21-entry canonical record-type -> collection map (private) ----
  // This is Slice 2's own flat copy of the same 21 mappings Slice 1's
  // PLAN_COLLECTION_MAP + PLAN_SYSTEM_COLLECTIONS already declare (spec §6 /
  // Appendix A). It is a static, load-order-independent constant here -- firebase.js
  // loads first and must not depend on app-plan.js already being present -- but the
  // standalone Slice 2 test harness independently cross-checks every value below
  // against the real, exported Slice 1 maps rather than trusting this copy alone.
  var CANONICAL_COLLECTION_MAP = Object.freeze({
    planTemplateSubject: 'planTemplates',
    planTemplateRevision: 'planTemplateRevisions',
    planAssignmentSubject: 'planAssignments',
    planAssignmentRevision: 'planAssignmentRevisions',
    planScheduleOpportunitySubject: 'planScheduleOpportunities',
    planScheduleOpportunityRevision: 'planScheduleOpportunityRevisions',
    planPrescriptionSubject: 'planPrescriptions',
    planPrescriptionRevision: 'planPrescriptionRevisions',
    planSetGroupSubject: 'planSetGroups',
    planSetGroupRevision: 'planSetGroupRevisions',
    planSetSubject: 'planSets',
    planSetRevision: 'planSetRevisions',
    planRuleSubject: 'planRules',
    planRuleRevision: 'planRuleRevisions',
    planImplementationRelationshipSubject: 'planImplementationRelationships',
    planImplementationRelationshipRevision: 'planImplementationRelationshipRevisions',
    planGraphManifest: 'planGraphManifests',
    planGraphManifestChunk: 'planGraphManifestChunks',
    canonicalOperation: 'canonicalOperations',
    planCommitGateway: 'planCommitGateways',
    planTemplateSummary: 'planTemplateSummaries'
  });

  var SCHEMA_AUTHORITY_PATH = 'schemaAuthorities/plan';
  var LEGACY_PROGRAMS_COLLECTION = 'programs';

  // registry: { ownerUid, collectionsByRecordType (frozen), schemaAuthorityRef, generation }
  // Replaced wholesale on every init call -- never mutated in place.
  var registry = null;
  var registryGeneration = 0;

  function hasOwnKey(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

  // Reject a UID that is missing, non-string, empty, whitespace-only,
  // whitespace-padded, slash-containing, backslash-containing, or NUL-containing.
  function isValidOwnerUid(uid) {
    if (typeof uid !== 'string') return false;
    if (uid.length === 0) return false;
    if (uid.trim() !== uid) return false; // catches both whitespace-only and whitespace-padded
    if (uid.indexOf('/') !== -1) return false;
    if (uid.indexOf('\\') !== -1) return false;
    if (uid.indexOf('\u0000') !== -1) return false;
    return true;
  }

  // Same shape of rule for a single path segment (a record ID). Independent
  // function from isValidOwnerUid even though the rules coincide, so a future
  // change to one is never silently assumed to apply to the other.
  function isValidRecordId(recordId) {
    if (typeof recordId !== 'string') return false;
    if (recordId.length === 0) return false;
    if (recordId.trim() !== recordId) return false;
    if (recordId.indexOf('/') !== -1) return false;
    if (recordId.indexOf('\\') !== -1) return false;
    if (recordId.indexOf('\u0000') !== -1) return false;
    if (recordId === '.' || recordId === '..') return false; // dot segments
    if (recordId.indexOf('?') !== -1 || recordId.indexOf('#') !== -1) return false; // query/fragment suffixes
    var lower = recordId.toLowerCase();
    if (lower.indexOf('%2f') !== -1 || lower.indexOf('%5c') !== -1) return false; // encoded separator substitutes
    return true;
  }

  function buildDocPath(ownerUid, collection, recordId) {
    return 'users/' + ownerUid + '/' + collection + '/' + recordId;
  }

  function requireRegistry(callerName) {
    if (!registry) {
      throw new Error(callerName + ': the canonical reference registry has not been initialized yet (call fsPlanInitCanonicalReferences first)');
    }
    return registry;
  }

  // Fail-closed owner rule (spec §9): every user-owned accessor requires
  // expectedUid and must prove expectedUid === registry.ownerUid. A missing
  // registry, missing expectedUid, stale registry, or owner mismatch all block
  // before a reference is ever returned.
  function requireOwnerMatch(reg, expectedUid, callerName) {
    if (typeof expectedUid !== 'string' || expectedUid.length === 0) {
      throw new Error(callerName + ': expectedUid is required');
    }
    if (expectedUid !== reg.ownerUid) {
      throw new Error(callerName + ': expectedUid does not match the current canonical reference registry owner (stale or cross-user access blocked)');
    }
  }

  // ---- fsPlanInitCanonicalReferences(uid) ----
  // Constructs handles only. Performs zero Firestore read/write/query/listener/
  // batch/transaction operations. Builds the entire new registry in local
  // variables and publishes it atomically -- by reassigning the closure's
  // `registry` variable in one step -- only after every one of the 21
  // collection handles and the schema-authority handle succeed. A prior
  // registry is replaced wholesale, never mutated, and immediately becomes
  // stale for every accessor (owner checks are always against the live
  // `registry`, never a value captured earlier).
  function initCanonicalReferences(uid) {
    if (!isValidOwnerUid(uid)) {
      throw new Error('fsPlanInitCanonicalReferences: uid is required and must be a plain, non-empty, non-whitespace-padded string containing no "/", "\\", or NUL character');
    }
    var base = fsDb.collection('users').doc(uid);
    var collectionsByRecordType = {};
    var recordTypes = Object.keys(CANONICAL_COLLECTION_MAP);
    for (var i = 0; i < recordTypes.length; i++) {
      var recordType = recordTypes[i];
      collectionsByRecordType[recordType] = base.collection(CANONICAL_COLLECTION_MAP[recordType]);
    }
    Object.freeze(collectionsByRecordType);
    var schemaAuthorityRef = fsDb.doc(SCHEMA_AUTHORITY_PATH);

    registryGeneration += 1;
    registry = Object.freeze({
      ownerUid: uid,
      collectionsByRecordType: collectionsByRecordType,
      schemaAuthorityRef: schemaAuthorityRef,
      generation: registryGeneration
    });
  }

  // ---- fsPlanGetCanonicalCollection(recordType, expectedUid) ----
  function getCanonicalCollection(recordType, expectedUid) {
    var reg = requireRegistry('fsPlanGetCanonicalCollection');
    requireOwnerMatch(reg, expectedUid, 'fsPlanGetCanonicalCollection');
    if (!hasOwnKey(CANONICAL_COLLECTION_MAP, recordType)) {
      throw new Error('fsPlanGetCanonicalCollection: unknown canonical recordType: ' + recordType);
    }
    return reg.collectionsByRecordType[recordType];
  }

  // ---- fsPlanGetCanonicalDocumentRef(recordType, recordId, expectedUid) ----
  function getCanonicalDocumentRef(recordType, recordId, expectedUid) {
    var reg = requireRegistry('fsPlanGetCanonicalDocumentRef');
    requireOwnerMatch(reg, expectedUid, 'fsPlanGetCanonicalDocumentRef');
    if (!hasOwnKey(CANONICAL_COLLECTION_MAP, recordType)) {
      throw new Error('fsPlanGetCanonicalDocumentRef: unknown canonical recordType: ' + recordType);
    }
    if (!isValidRecordId(recordId)) {
      throw new Error('fsPlanGetCanonicalDocumentRef: recordId is required and must be a plain, non-empty, non-whitespace-padded string containing no "/", "\\", or NUL character');
    }
    return reg.collectionsByRecordType[recordType].doc(recordId);
  }

  // Exact normalized-descriptor shape check (round-1 source review correction):
  // recordType, recordId, and expectedPath are the descriptor's COMPLETE own-key
  // set, nothing more and nothing less -- not a superset that merely happens to
  // contain them, not an inherited match, not an accessor that would need to be
  // invoked to find out. Every check here is on PROPERTY DESCRIPTORS, never on
  // the property's own value, so a hostile getter never fires just to decide
  // whether the shape is acceptable; the three values are read only after this
  // function has already returned true.
  function isExactNormalizedDescriptorShape(candidate) {
    if (candidate === null || typeof candidate !== 'object') return false;
    if (Array.isArray(candidate)) return false;
    if (Object.getOwnPropertySymbols(candidate).length !== 0) return false;
    var ownNames = Object.getOwnPropertyNames(candidate); // includes non-enumerable own string keys
    if (ownNames.length !== 3) return false;
    var REQUIRED = ['recordType', 'recordId', 'expectedPath'];
    for (var i = 0; i < REQUIRED.length; i++) {
      if (ownNames.indexOf(REQUIRED[i]) === -1) return false;
    }
    for (var j = 0; j < REQUIRED.length; j++) {
      var desc = Object.getOwnPropertyDescriptor(candidate, REQUIRED[j]);
      // A plain data property descriptor has a `value` key; an accessor
      // (getter/setter) property has `get`/`set` instead. Checking for `value`
      // here -- never touching candidate[REQUIRED[j]] itself -- is what keeps
      // a getter from ever being invoked during this shape check.
      if (!desc || !hasOwnKey(desc, 'value')) return false;
    }
    return true;
  }

  // ---- fsPlanResolveCanonicalDocumentRef(descriptor, expectedUid) ----
  // Accepts only the normalized descriptor contract: an object whose complete
  // own-key set is EXACTLY { recordType, recordId, expectedPath }, each an own
  // data property (spec §11). Treats recordType, recordId, expectedPath, and
  // expectedUid as four INDEPENDENT claims -- every one of them must agree
  // with the others before a reference is returned. Does not interpret raw
  // Slice 1 read-plan records; that category-specific normalization is
  // explicitly reserved for Slice 3 (spec §11).
  function resolveCanonicalDocumentRef(descriptor, expectedUid) {
    var reg = requireRegistry('fsPlanResolveCanonicalDocumentRef');
    requireOwnerMatch(reg, expectedUid, 'fsPlanResolveCanonicalDocumentRef');

    if (!isExactNormalizedDescriptorShape(descriptor)) {
      throw new Error('fsPlanResolveCanonicalDocumentRef: descriptor must be a non-null, non-Array object whose complete own-key set is exactly recordType, recordId, and expectedPath as own data properties -- no extra, inherited, accessor, symbol-keyed, or array-shaped input is accepted (an object with no prototype, or an instance of some other class, is accepted as long as it meets this exact shape -- there is no additional restriction on its prototype)');
    }
    var recordType = descriptor.recordType;
    var recordId = descriptor.recordId;
    var expectedPath = descriptor.expectedPath;

    if (!hasOwnKey(CANONICAL_COLLECTION_MAP, recordType)) {
      throw new Error('fsPlanResolveCanonicalDocumentRef: unknown canonical recordType: ' + recordType);
    }
    if (!isValidRecordId(recordId)) {
      throw new Error('fsPlanResolveCanonicalDocumentRef: descriptor.recordId is required and must be a plain, non-empty, non-whitespace-padded string containing no "/", "\\", NUL, dot-segment, query suffix, or encoded path-separator substitute');
    }
    if (typeof expectedPath !== 'string' || expectedPath.length === 0) {
      throw new Error('fsPlanResolveCanonicalDocumentRef: descriptor.expectedPath is required and must be a non-empty string');
    }
    if (expectedPath.indexOf('?') !== -1 || expectedPath.indexOf('#') !== -1) {
      throw new Error('fsPlanResolveCanonicalDocumentRef: descriptor.expectedPath must not contain a query or fragment suffix');
    }
    var lowerPath = expectedPath.toLowerCase();
    if (lowerPath.indexOf('%2f') !== -1 || lowerPath.indexOf('%5c') !== -1) {
      throw new Error('fsPlanResolveCanonicalDocumentRef: descriptor.expectedPath must not contain an encoded path-separator substitute');
    }

    var segments = expectedPath.split('/');
    if (segments.length !== 4) {
      throw new Error('fsPlanResolveCanonicalDocumentRef: descriptor.expectedPath must have exactly four segments (users/{uid}/{collection}/{recordId}); got ' + segments.length);
    }
    for (var si = 0; si < segments.length; si++) {
      if (segments[si].length === 0) {
        throw new Error('fsPlanResolveCanonicalDocumentRef: descriptor.expectedPath must not contain an empty path segment');
      }
      if (segments[si] === '.' || segments[si] === '..') {
        throw new Error('fsPlanResolveCanonicalDocumentRef: descriptor.expectedPath must not contain a dot segment');
      }
    }
    if (segments[0] !== 'users') {
      throw new Error('fsPlanResolveCanonicalDocumentRef: descriptor.expectedPath must begin with "users"');
    }
    if (segments[1] !== expectedUid) {
      throw new Error('fsPlanResolveCanonicalDocumentRef: descriptor.expectedPath owner segment does not match expectedUid (cross-user path blocked)');
    }
    if (segments[2] === LEGACY_PROGRAMS_COLLECTION) {
      throw new Error('fsPlanResolveCanonicalDocumentRef: the legacy users/{uid}/programs/{programId} namespace is never canonical');
    }
    var expectedCollection = CANONICAL_COLLECTION_MAP[recordType];
    if (segments[2] !== expectedCollection) {
      throw new Error('fsPlanResolveCanonicalDocumentRef: descriptor.expectedPath collection segment does not match the collection derived from recordType');
    }
    if (segments[3] !== recordId) {
      throw new Error('fsPlanResolveCanonicalDocumentRef: descriptor.expectedPath final segment does not match descriptor.recordId');
    }

    var derivedPath = buildDocPath(expectedUid, expectedCollection, recordId);
    if (derivedPath !== expectedPath) {
      throw new Error('fsPlanResolveCanonicalDocumentRef: the independently derived canonical path does not exactly equal descriptor.expectedPath');
    }

    return reg.collectionsByRecordType[recordType].doc(recordId);
  }

  // ---- fsPlanGetSchemaAuthorityRef() ----
  // Takes no caller-supplied path. Always returns the one exact global document
  // (schemaAuthorities/plan) stored on the registry at init time. Not user-owned,
  // so there is no expectedUid to check -- only that a registry currently exists.
  function getSchemaAuthorityRef() {
    var reg = requireRegistry('fsPlanGetSchemaAuthorityRef');
    return reg.schemaAuthorityRef;
  }

  // ---- CanonicalPlanWriterDisabledError ----
  function CanonicalPlanWriterDisabledError(message) {
    var base = Error.call(this, message || 'Canonical PLAN writer is disabled in this slice (Slice 2 boundary) -- no canonical write path exists yet.');
    this.message = base.message;
    this.stack = base.stack;
    this.name = 'CanonicalPlanWriterDisabledError';
    this.code = 'CANONICAL_PLAN_WRITER_DISABLED';
  }
  CanonicalPlanWriterDisabledError.prototype = Object.create(Error.prototype);
  CanonicalPlanWriterDisabledError.prototype.constructor = CanonicalPlanWriterDisabledError;

  // ==================== CANONICAL PLAN BOUNDED TRANSACTION EXECUTOR (Slice 3) ====================
  // Controlling authority: IRON LOG Canonical PLAN Bounded Transaction Executor
  // Specification, Draft 0.1 (approved). Depends on the source-accepted Slice 1
  // pure canonical model (app-plan.js) and the source-accepted Slice 2 reference
  // handles above.
  //
  // Scope, stated honestly: everything below is a PRIVATE executor, reachable
  // only from inside this same closure. It is never bound to, called by, or
  // reachable from fsPlanCommitCanonicalPackage -- the one browser-visible
  // writer entry point -- because CANONICAL_PLAN_WRITE_CAPABILITY_ENABLED
  // (declared just below) is a source-level `false` constant with no code path
  // anywhere in this file that ever sets it to `true`. The only way to exercise
  // any of this is to call fsPlanPersistence.__test.buildCanonicalCommitExecutor
  // directly from a Node harness, supplying every dependency (a transaction
  // runner, a server-timestamp factory, a UID getter, Slice 1's
  // planBuildTemplateCommitWrites, and a PlanCommitBlockedError predicate) by
  // hand -- that whole __test surface does not exist in a real browser load
  // (see the existing `typeof module !== 'undefined' && module.exports` guard
  // below). Nothing here is wired to Save Template, Start on Train, any screen,
  // appDb, or any other production caller. No live Firebase or emulator access
  // occurs anywhere in this file.

  // ---- V1 safety caps, rechecked independently at this boundary (spec Part 4
  // item 4). These are firebase.js's own copy of the same five numbers Slice 1
  // already enforces at package-build time (app-plan.js's PLAN_V1_SAFETY_CAPS /
  // PLAN_MANIFEST_MAX_ENTRIES_PER_CHUNK / PLAN_MANIFEST_MAX_CHUNK_BYTES) --
  // firebase.js loads before app-plan.js as classic <script> tags, so it cannot
  // import them, and independently rechecking an untrusted package's own claims
  // against a second, independently-declared copy of the limit is stronger than
  // trusting the package's self-reported estimatedRequestBytes alone. The
  // standalone Slice 3 harness cross-checks every value below against the real
  // exported Slice 1 constants.
  var COMMIT_SAFETY_CAPS = Object.freeze({
    maxTransactionWrites: 350,
    maxEstimatedRequestBytes: 6 * 1024 * 1024,
    maxCanonicalDocumentBytes: 768 * 1024,
    maxManifestChunkEntries: 100,
    maxManifestChunkBytes: 256 * 1024
  });

  // ---- The one private immutable capability constant (spec Part 2 / §9).
  // Never exposed on fsPlanPersistence, window, globalThis, module.exports
  // outside the guarded __test surface, appDb, localStorage, or URL state.
  // fsPlanCommitCanonicalPackage checks this before reading anything else. A
  // later, separately authorized activation slice is the only place this
  // constant could ever legitimately change.
  const CANONICAL_PLAN_WRITE_CAPABILITY_ENABLED = false;

  // ---- The exact reserved server-timestamp placeholder string Slice 1 stamps
  // into candidate write data (app-plan.js's own PLAN_SERVER_TIMESTAMP_SENTINEL).
  // Declared independently here for the same load-order reason as the safety
  // caps above; the standalone harness cross-checks this literal against the
  // real exported Slice 1 constant.
  var TIMESTAMP_PLACEHOLDER = '__PLAN_SERVER_TIMESTAMP__';

  // ---- Typed errors at the persistence boundary (spec Part 8). Each follows
  // the exact same constructor pattern as CanonicalPlanWriterDisabledError
  // above. None of these are added to the seven-key browser public surface --
  // Node-only test access is exposed solely under the existing guarded __test
  // surface, further below.
  function CanonicalPlanCommitBlockedError(blockReason, details) {
    var base = Error.call(this, 'Canonical PLAN commit blocked: ' + blockReason);
    this.message = base.message;
    this.stack = base.stack;
    this.name = 'CanonicalPlanCommitBlockedError';
    this.code = 'CANONICAL_PLAN_COMMIT_BLOCKED';
    this.blockReason = blockReason;
    this.details = details || {};
  }
  CanonicalPlanCommitBlockedError.prototype = Object.create(Error.prototype);
  CanonicalPlanCommitBlockedError.prototype.constructor = CanonicalPlanCommitBlockedError;

  function CanonicalPlanCommitIntegrityError(message) {
    var base = Error.call(this, message || 'Canonical PLAN commit adapter/package integrity failure.');
    this.message = base.message;
    this.stack = base.stack;
    this.name = 'CanonicalPlanCommitIntegrityError';
    this.code = 'CANONICAL_PLAN_COMMIT_INTEGRITY';
  }
  CanonicalPlanCommitIntegrityError.prototype = Object.create(Error.prototype);
  CanonicalPlanCommitIntegrityError.prototype.constructor = CanonicalPlanCommitIntegrityError;

  function CanonicalPlanCommitAuthorizationError(message, cause) {
    var base = Error.call(this, message || 'Canonical PLAN commit was not authorized.');
    this.message = base.message;
    this.stack = base.stack;
    this.name = 'CanonicalPlanCommitAuthorizationError';
    this.code = 'CANONICAL_PLAN_COMMIT_AUTHORIZATION';
    this.sdkCode = (cause && cause.code) || null;
    this.cause = cause || null;
  }
  CanonicalPlanCommitAuthorizationError.prototype = Object.create(Error.prototype);
  CanonicalPlanCommitAuthorizationError.prototype.constructor = CanonicalPlanCommitAuthorizationError;

  function CanonicalPlanCommitUnavailableError(message, cause) {
    var base = Error.call(this, message || 'Canonical PLAN commit did not complete because the persistence backend was unavailable.');
    this.message = base.message;
    this.stack = base.stack;
    this.name = 'CanonicalPlanCommitUnavailableError';
    this.code = 'CANONICAL_PLAN_COMMIT_UNAVAILABLE';
    this.sdkCode = (cause && cause.code) || null;
    this.cause = cause || null;
  }
  CanonicalPlanCommitUnavailableError.prototype = Object.create(Error.prototype);
  CanonicalPlanCommitUnavailableError.prototype.constructor = CanonicalPlanCommitUnavailableError;

  function CanonicalPlanCommitPersistenceError(message, cause) {
    var base = Error.call(this, message || 'Canonical PLAN commit failed with an unexpected persistence error.');
    this.message = base.message;
    this.stack = base.stack;
    this.name = 'CanonicalPlanCommitPersistenceError';
    this.code = 'CANONICAL_PLAN_COMMIT_PERSISTENCE_FAILURE';
    this.sdkCode = (cause && cause.code) || null;
    this.cause = cause || null;
  }
  CanonicalPlanCommitPersistenceError.prototype = Object.create(Error.prototype);
  CanonicalPlanCommitPersistenceError.prototype.constructor = CanonicalPlanCommitPersistenceError;

  function isOwnTypedCommitError(err) {
    return err instanceof CanonicalPlanCommitBlockedError ||
      err instanceof CanonicalPlanCommitIntegrityError ||
      err instanceof CanonicalPlanCommitAuthorizationError ||
      err instanceof CanonicalPlanCommitUnavailableError ||
      err instanceof CanonicalPlanCommitPersistenceError;
  }

  // Classifies a raw failure from runTransaction (real Firestore SDK error
  // shapes carry `.code`; the fake harness engine mirrors that) into the
  // distinct typed failure Part 8 requires, without ever reinterpreting one
  // of this file's own already-typed errors (which propagate through
  // runTransaction verbatim when the callback throws them).
  function classifyTransactionFailure(err) {
    if (isOwnTypedCommitError(err)) return err;
    var code = err && err.code;
    if (code === 'permission-denied' || code === 'unauthenticated') {
      return new CanonicalPlanCommitAuthorizationError('Firestore rejected the transaction due to an authorization failure.', err);
    }
    if (code === 'unavailable' || code === 'deadline-exceeded' || code === 'aborted' || code === 'resource-exhausted' || code === 'cancelled') {
      return new CanonicalPlanCommitUnavailableError('Firestore transaction did not complete due to an availability or retry failure.', err);
    }
    return new CanonicalPlanCommitPersistenceError('Firestore transaction failed with an unexpected SDK error.', err);
  }

  // ---- Portable UTF-8 byte estimator (private). Never depends on Node's
  // Buffer -- this file is loaded in a real browser too, even though this
  // exact code path is only ever exercised via the Node-only test seam.
  // Correction round 2, defect 1: this used to treat ANY high surrogate
  // followed by any next code unit as a valid 4-byte surrogate pair --
  // without checking that the next code unit was actually a low surrogate
  // (0xDC00-0xDFFF). An unpaired high surrogate followed by another
  // character (e.g. '\uD800é') was therefore miscounted: the real
  // Slice 1 planUtf8ByteLength() (app-plan.js) counts an unpaired high
  // surrogate as its own 3-byte code unit and then counts the following
  // character independently, exactly matching how a genuine UTF-8 encoder
  // treats a lone surrogate -- so the two byte totals could diverge for a
  // string Slice 1 itself accepts and estimates, causing the defect-3
  // cross-check to falsely refuse a genuine, untampered package. Rewritten
  // to directly mirror planUtf8ByteLength()'s own codePointAt-based
  // semantics (the approved Slice 1 algorithm), rather than maintaining a
  // second, independently-reasoned interpretation of the same rule:
  // codePointAt(i) returns the combined astral code point ONLY when index i
  // holds a genuine high surrogate immediately followed by a genuine low
  // surrogate; for anything else (an unpaired high surrogate, a lone low
  // surrogate, ASCII, an ordinary multibyte character) it returns that one
  // UTF-16 code unit's own value, so isolated surrogates are counted (and
  // the following character is then counted separately, on the next loop
  // iteration) exactly the way Slice 1 already does.
  function utf8ByteLength(str) {
    var bytes = 0;
    for (var i = 0; i < str.length; i++) {
      var code = str.codePointAt(i);
      if (code > 0xFFFF) i += 1; // a genuine surrogate pair was consumed as one code point; skip its low half
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code < 0x10000) bytes += 3;
      else bytes += 4;
    }
    return bytes;
  }

  function estimateJsonBytes(value) {
    var json;
    try {
      json = JSON.stringify(value);
    } catch (e) {
      throw new CanonicalPlanCommitIntegrityError('unable to estimate document size (JSON.stringify failed): ' + (e && e.message ? e.message : String(e)));
    }
    if (typeof json !== 'string') return 0;
    return utf8ByteLength(json);
  }

  // ---- Canonical byte estimator (correction defect 3). An independent,
  // byte-for-byte-equivalent reimplementation of Slice 1's own
  // planBuildCanonicalEncoding/planEstimateDocBytes algorithm (sorted object
  // keys, minimal JSON string escaping, stable number formatting, no
  // extraneous whitespace, undefined rejected rather than silently dropped
  // from arrays) -- firebase.js cannot import app-plan.js (loaded as a
  // separate <script> tag in a real browser, and app-plan.js loads AFTER
  // this file), so this is declared independently here for the same reason
  // COMMIT_SAFETY_CAPS and TIMESTAMP_PLACEHOLDER already are above. Used
  // exclusively to recompute an independent candidate-write byte total in
  // the SAME semantics Slice 1 used to compute package.estimatedRequestBytes
  // in the first place, so the two totals can be required to agree EXACTLY
  // (see normalizeCandidateWrites below), not merely each independently
  // stay under the cap. The standalone Slice 3 harness cross-checks every
  // function below against the real exported Slice 1 functions.
  function fsCanonicalEncodeString(str) {
    var out = '"';
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      var code = str.charCodeAt(i);
      if (ch === '"') out += '\\"';
      else if (ch === '\\') out += '\\\\';
      else if (code === 0x08) out += '\\b';
      else if (code === 0x09) out += '\\t';
      else if (code === 0x0A) out += '\\n';
      else if (code === 0x0C) out += '\\f';
      else if (code === 0x0D) out += '\\r';
      else if (code < 0x20) out += '\\u' + ('0000' + code.toString(16)).slice(-4);
      else out += ch;
    }
    return out + '"';
  }

  function fsCanonicalEncodeArray(arr, path) {
    var parts = [];
    for (var i = 0; i < arr.length; i++) {
      var elPath = (path || '') + '[' + i + ']';
      if (arr[i] === undefined) {
        throw new CanonicalPlanCommitIntegrityError('canonical byte estimation: array element must not be undefined at ' + elPath);
      }
      parts.push(fsCanonicalEncodeValue(arr[i], elPath));
    }
    return '[' + parts.join(',') + ']';
  }

  function fsCanonicalEncodeObject(obj, path) {
    var keys = Object.keys(obj).filter(function (k) { return obj[k] !== undefined; });
    keys.sort();
    var parts = [];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var kPath = (path || '') + '.' + k;
      parts.push(fsCanonicalEncodeString(k) + ':' + fsCanonicalEncodeValue(obj[k], kPath));
    }
    return '{' + parts.join(',') + '}';
  }

  function fsCanonicalEncodeValue(value, path) {
    if (value === undefined) {
      throw new CanonicalPlanCommitIntegrityError('canonical byte estimation: unexpected undefined value at ' + path);
    }
    if (value === null) return 'null';
    var t = typeof value;
    if (t === 'boolean') return value ? 'true' : 'false';
    if (t === 'number') {
      if (!Number.isFinite(value)) {
        throw new CanonicalPlanCommitIntegrityError('canonical byte estimation: non-finite number is not a supported canonical value at ' + path);
      }
      var normalized = value === 0 ? 0 : value; // normalize -0 -> 0
      if (Object.is(normalized, -0)) normalized = 0;
      return String(normalized);
    }
    if (t === 'string') return fsCanonicalEncodeString(value);
    if (Array.isArray(value)) return fsCanonicalEncodeArray(value, path);
    if (isPlainDataObject(value)) return fsCanonicalEncodeObject(value, path);
    throw new CanonicalPlanCommitIntegrityError('canonical byte estimation: unsupported value type (' + t + ') at ' + path);
  }

  function fsBuildCanonicalEncoding(value) {
    return fsCanonicalEncodeValue(value, '$');
  }

  function fsEstimateCanonicalDocBytes(value) {
    return utf8ByteLength(fsBuildCanonicalEncoding(value));
  }

  // ---- One-pass, getter-safe deep clone of plain canonical data (private).
  // Every property is read exactly once, via its own property descriptor's
  // `value` (never by invoking a getter), mirroring the same TOCTOU/hostile-
  // input defense isExactNormalizedDescriptorShape/resolveCanonicalDocumentRef
  // above already apply to the much smaller three-field descriptor -- applied
  // here to the entire, much larger, untrusted commitment package. Anything
  // that is not a plain data object, a plain array, a string, a number, a
  // boolean, or null (a function, a Proxy trap surfacing something exotic, a
  // class instance, a Date, etc.) is rejected outright: Slice 1's package
  // shape is pure JSON-safe data end to end, so encountering anything else
  // here is itself proof the package cannot be trusted.
  function isPlainDataObject(v) {
    if (v === null || typeof v !== 'object') return false;
    if (Array.isArray(v)) return false;
    // Cross-realm-safe "is this a plain object" check: accepts Object.create(null)
    // (proto === null) and a plain object literal from ANY realm (this
    // sandbox's own, or a different one -- e.g. a package built by app-plan.js
    // loaded via plain Node `require()` outside this file's VM sandbox in the
    // Slice 3 test harness). Every realm's own Object.prototype has a `null`
    // prototype of its own, and nothing else does (Array.prototype,
    // Error.prototype, Date.prototype, and every class prototype all
    // ultimately chain back to SOME Object.prototype, never straight to
    // null) -- so this is equivalent to `proto === Object.prototype` within
    // one realm, and strictly more correct across realms, without weakening
    // what it rejects (class instances, Dates, Errors, and other exotic
    // objects are still rejected, exactly as before).
    var proto = Object.getPrototypeOf(v);
    if (proto === null) return true;
    return Object.getPrototypeOf(proto) === null;
  }

  function cloneJsonLikeOnce(value, depth) {
    if (depth > 64) {
      throw new CanonicalPlanCommitIntegrityError('package exceeds the maximum supported nesting depth');
    }
    if (value === null) return null;
    var t = typeof value;
    if (t === 'string' || t === 'number' || t === 'boolean') return value;
    if (Array.isArray(value)) {
      var arr = new Array(value.length);
      for (var i = 0; i < value.length; i++) arr[i] = cloneJsonLikeOnce(value[i], depth + 1);
      return arr;
    }
    if (isPlainDataObject(value)) {
      var names = Object.getOwnPropertyNames(value);
      var out = {};
      for (var j = 0; j < names.length; j++) {
        var key = names[j];
        var desc = Object.getOwnPropertyDescriptor(value, key);
        if (!desc || !hasOwnKey(desc, 'value')) {
          throw new CanonicalPlanCommitIntegrityError('package contains a non-data property (' + key + ') where plain canonical data was required');
        }
        out[key] = cloneJsonLikeOnce(desc.value, depth + 1);
      }
      return out;
    }
    throw new CanonicalPlanCommitIntegrityError('package contains an unsupported value type (' + t + ') where plain canonical data was required');
  }

  function deepFreezeClone(value) {
    if (value !== null && typeof value === 'object') {
      Object.freeze(value);
      var keys = Object.keys(value);
      for (var i = 0; i < keys.length; i++) deepFreezeClone(value[keys[i]]);
    }
    return value;
  }

  function deepEqualJsonSafe(a, b) {
    if (a === b) return true;
    if (a === null || b === null) return false;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) {
        if (!deepEqualJsonSafe(a[i], b[i])) return false;
      }
      return true;
    }
    var aKeys = Object.keys(a), bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (var k = 0; k < aKeys.length; k++) {
      if (!hasOwnKey(b, aKeys[k])) return false;
      if (!deepEqualJsonSafe(a[aKeys[k]], b[aKeys[k]])) return false;
    }
    return true;
  }

  // Resolves one normalized descriptor through the exact, already-hardened
  // Slice 2 resolver, re-wrapping any rejection as a typed adapter/package
  // integrity failure (spec Part 8) rather than letting a raw Slice 2 Error
  // escape this boundary un-typed.
  function resolveOrIntegrityError(recordType, recordId, expectedPath, label, expectedUid) {
    var descriptor = { recordType: recordType, recordId: recordId, expectedPath: expectedPath };
    try {
      return resolveCanonicalDocumentRef(descriptor, expectedUid);
    } catch (e) {
      throw new CanonicalPlanCommitIntegrityError(label + ': ' + (e && e.message ? e.message : String(e)));
    }
  }

  // ---- Exact 17-category read-plan normalization matrix (spec Part 4 item 5,
  // "READ-PLAN NORMALIZATION MATRIX", and Appendix A's execution order). Every
  // category is normalized into the Slice 2 {recordType, recordId, expectedPath}
  // descriptor contract and resolved through resolveCanonicalDocumentRef --
  // never by calling collection(...).doc(...) directly from caller-supplied
  // path text. The returned array is already in the exact deterministic order
  // Part 5 step 3 requires transaction.get to be issued in.
  var KNOWN_READ_PLAN_CATEGORIES = Object.freeze([
    'schemaAuthorityRef', 'operationRef', 'gatewayRef', 'templateSubjectRef',
    'childSubjectRefs', 'reusedRevisionRefs', 'newRevisionTargetRefs',
    'predecessorRevisionRefs', 'removedAssignmentRefs', 'manifestRootRef',
    'chunkRefs', 'projectionRef', 'priorManifestRootRef', 'priorOperationRef',
    'priorGatewayRef', 'priorChunkRefs', 'duplicationSourceRefs'
  ]);

  function buildNormalizedPlan(pkg, ownerUid) {
    var readPlan = pkg.readPlan;
    if (!readPlan || typeof readPlan !== 'object' || Array.isArray(readPlan)) {
      throw new CanonicalPlanCommitIntegrityError('preflight: package.readPlan is required');
    }
    var actualKeys = Object.keys(readPlan);
    if (actualKeys.length !== KNOWN_READ_PLAN_CATEGORIES.length) {
      throw new CanonicalPlanCommitIntegrityError('preflight: package.readPlan has an unexpected number of categories (unknown or missing category)');
    }
    for (var ki = 0; ki < KNOWN_READ_PLAN_CATEGORIES.length; ki++) {
      if (!hasOwnKey(readPlan, KNOWN_READ_PLAN_CATEGORIES[ki])) {
        throw new CanonicalPlanCommitIntegrityError('preflight: package.readPlan is missing required category ' + KNOWN_READ_PLAN_CATEGORIES[ki]);
      }
    }

    var steps = [];

    function pushSingular(category, docsKey, recordType, recordId, expectedPath) {
      steps.push(Object.freeze({
        category: category,
        docsPath: Object.freeze([docsKey]),
        ref: resolveOrIntegrityError(recordType, recordId, expectedPath, 'readPlan.' + category, ownerUid)
      }));
    }

    // fixedRecordType (optional, correction defect 1): when provided, every
    // entry's own recordTypeFn(ref) claim must agree with it EXACTLY before
    // the entry is ever resolved -- the fixed literal is what's actually
    // used to resolve the document reference, never the raw per-entry claim.
    // Most categories (childSubjectRefs, reusedRevisionRefs,
    // newRevisionTargetRefs, predecessorRevisionRefs, chunkRefs,
    // priorChunkRefs, duplicationSourceRefs) genuinely vary in record type
    // across their own entries and correctly omit this argument, preserving
    // their existing per-entry-trusted behavior unchanged. Only a category
    // the approved normalization matrix fixes to one single record type
    // regardless of caller data (removedAssignmentRefs -- see category i
    // below) passes it.
    function pushArray(category, docsTopKey, list, keyField, recordTypeFn, recordIdFn, fixedRecordType) {
      if (!Array.isArray(list)) {
        throw new CanonicalPlanCommitIntegrityError('preflight: readPlan.' + category + ' must be an array');
      }
      var seenKeys = {};
      for (var i = 0; i < list.length; i++) {
        var ref = list[i];
        if (!ref || typeof ref !== 'object' || Array.isArray(ref)) {
          throw new CanonicalPlanCommitIntegrityError('preflight: readPlan.' + category + '[' + i + '] is not a plain object');
        }
        var slotKey = ref[keyField];
        if (typeof slotKey !== 'string' || !slotKey) {
          throw new CanonicalPlanCommitIntegrityError('preflight: readPlan.' + category + '[' + i + '].' + keyField + ' is required');
        }
        if (hasOwnKey(seenKeys, slotKey)) {
          throw new CanonicalPlanCommitIntegrityError('preflight: readPlan.' + category + ' contains a duplicate ' + keyField + ' (' + slotKey + ')');
        }
        seenKeys[slotKey] = true;
        var claimedRecordType = recordTypeFn(ref);
        if (fixedRecordType !== undefined && claimedRecordType !== fixedRecordType) {
          throw new CanonicalPlanCommitIntegrityError('preflight: readPlan.' + category + '[' + i + '].recordType must be exactly ' + fixedRecordType + ' (got ' + claimedRecordType + ')');
        }
        var resolvedRecordType = fixedRecordType !== undefined ? fixedRecordType : claimedRecordType;
        steps.push(Object.freeze({
          category: category,
          docsPath: Object.freeze([docsTopKey, slotKey]),
          ref: resolveOrIntegrityError(resolvedRecordType, recordIdFn(ref), ref.path, 'readPlan.' + category + '[' + i + ']', ownerUid)
        }));
      }
    }

    // a. schemaAuthorityRef -- the one global, non-owner-bound reference.
    if (!readPlan.schemaAuthorityRef || readPlan.schemaAuthorityRef.path !== SCHEMA_AUTHORITY_PATH) {
      throw new CanonicalPlanCommitIntegrityError('preflight: readPlan.schemaAuthorityRef must be exactly ' + SCHEMA_AUTHORITY_PATH);
    }
    var schemaAuthorityDocRef = getSchemaAuthorityRef();
    if (!schemaAuthorityDocRef || schemaAuthorityDocRef.path !== SCHEMA_AUTHORITY_PATH) {
      throw new CanonicalPlanCommitIntegrityError('preflight: the resolved schema authority reference path disagrees with ' + SCHEMA_AUTHORITY_PATH);
    }
    steps.push(Object.freeze({ category: 'schemaAuthorityRef', docsPath: Object.freeze(['schemaAuthority']), ref: schemaAuthorityDocRef }));

    // b. operationRef
    if (!readPlan.operationRef || typeof readPlan.operationRef.path !== 'string') {
      throw new CanonicalPlanCommitIntegrityError('preflight: readPlan.operationRef is required');
    }
    if (!pkg.operation || typeof pkg.operation.operationId !== 'string' || !pkg.operation.operationId) {
      throw new CanonicalPlanCommitIntegrityError('preflight: package.operation.operationId is required');
    }
    pushSingular('operationRef', 'operation', 'canonicalOperation', pkg.operation.operationId, readPlan.operationRef.path);

    // c. gatewayRef
    if (!readPlan.gatewayRef || typeof readPlan.gatewayRef.path !== 'string') {
      throw new CanonicalPlanCommitIntegrityError('preflight: readPlan.gatewayRef is required');
    }
    if (typeof pkg.gatewayId !== 'string' || !pkg.gatewayId) {
      throw new CanonicalPlanCommitIntegrityError('preflight: package.gatewayId is required');
    }
    pushSingular('gatewayRef', 'gatewayTarget', 'planCommitGateway', pkg.gatewayId, readPlan.gatewayRef.path);

    // d. templateSubjectRef -- recordType is FIXED at planTemplateSubject by
    // the approved normalization matrix, independently of caller data
    // (correction defect 1). The raw claim must agree EXACTLY before this
    // category is ever resolved; it is never trusted and forwarded as-is --
    // a disagreeing claim (e.g. redirected to planAssignmentSubject, with a
    // matching path) would otherwise let preflight normalize into, and the
    // transaction read from, the wrong canonical collection entirely, with
    // the real Template collision/head document never read at all.
    var tsr = readPlan.templateSubjectRef;
    if (!tsr || typeof tsr.recordType !== 'string' || typeof tsr.subjectId !== 'string' || typeof tsr.path !== 'string') {
      throw new CanonicalPlanCommitIntegrityError('preflight: readPlan.templateSubjectRef is malformed');
    }
    if (tsr.recordType !== 'planTemplateSubject') {
      throw new CanonicalPlanCommitIntegrityError('preflight: readPlan.templateSubjectRef.recordType must be exactly planTemplateSubject (got ' + tsr.recordType + ')');
    }
    pushSingular('templateSubjectRef', 'templateSubject', 'planTemplateSubject', tsr.subjectId, tsr.path);

    // e. childSubjectRefs[]
    pushArray('childSubjectRefs', 'childSubjects', readPlan.childSubjectRefs, 'subjectId',
      function (r) { return r.recordType; }, function (r) { return r.subjectId; });

    // f. reusedRevisionRefs[]
    pushArray('reusedRevisionRefs', 'reusedRevisions', readPlan.reusedRevisionRefs, 'subjectId',
      function (r) { return r.revisionRecordType; }, function (r) { return r.revisionId; });

    // g. newRevisionTargetRefs[]
    pushArray('newRevisionTargetRefs', 'newRevisionTargets', readPlan.newRevisionTargetRefs, 'subjectId',
      function (r) { return r.revisionRecordType; }, function (r) { return r.revisionId; });

    // h. predecessorRevisionRefs[]
    pushArray('predecessorRevisionRefs', 'predecessorRevisions', readPlan.predecessorRevisionRefs, 'subjectId',
      function (r) { return r.revisionRecordType; }, function (r) { return r.revisionId; });

    // i. removedAssignmentRefs[] -- recordType is FIXED at
    // planAssignmentSubject by the approved normalization matrix,
    // independently of caller data (correction defect 1). See the fixed-
    // type check inside pushArray above: a disagreeing per-entry claim now
    // blocks before this category is ever resolved, rather than being
    // trusted and forwarded into whichever collection the caller named.
    pushArray('removedAssignmentRefs', 'removedAssignments', readPlan.removedAssignmentRefs, 'subjectId',
      function (r) { return r.recordType; }, function (r) { return r.subjectId; }, 'planAssignmentSubject');

    // j. manifestRootRef
    if (!readPlan.manifestRootRef || typeof readPlan.manifestRootRef.path !== 'string') {
      throw new CanonicalPlanCommitIntegrityError('preflight: readPlan.manifestRootRef is required');
    }
    if (!pkg.graph || !pkg.graph.manifest || typeof pkg.graph.manifest.manifestId !== 'string' || !pkg.graph.manifest.manifestId) {
      throw new CanonicalPlanCommitIntegrityError('preflight: package.graph.manifest.manifestId is required');
    }
    pushSingular('manifestRootRef', 'manifestRoot', 'planGraphManifest', pkg.graph.manifest.manifestId, readPlan.manifestRootRef.path);

    // k. chunkRefs[]
    pushArray('chunkRefs', 'chunkTargets', readPlan.chunkRefs, 'chunkId',
      function () { return 'planGraphManifestChunk'; }, function (r) { return r.chunkId; });

    // l. projectionRef
    if (!readPlan.projectionRef || typeof readPlan.projectionRef.path !== 'string') {
      throw new CanonicalPlanCommitIntegrityError('preflight: readPlan.projectionRef is required');
    }
    if (!pkg.intent || typeof pkg.intent.templateId !== 'string' || !pkg.intent.templateId) {
      throw new CanonicalPlanCommitIntegrityError('preflight: package.intent.templateId is required');
    }
    pushSingular('projectionRef', 'projectionTarget', 'planTemplateSummary', pkg.intent.templateId, readPlan.projectionRef.path);

    // m. priorManifestRootRef, when present (spec §6 / Part 1: now carries an
    // explicit manifestId beside its path -- required here, never derived
    // back out of the path text).
    if (readPlan.priorManifestRootRef !== null) {
      var pmr = readPlan.priorManifestRootRef;
      if (!pmr || typeof pmr.manifestId !== 'string' || !pmr.manifestId || typeof pmr.path !== 'string') {
        throw new CanonicalPlanCommitIntegrityError('preflight: readPlan.priorManifestRootRef.manifestId is required when present');
      }
      pushSingular('priorManifestRootRef', 'priorManifest', 'planGraphManifest', pmr.manifestId, pmr.path);
    }

    // n. priorOperationRef, when present
    if (readPlan.priorOperationRef !== null) {
      var por = readPlan.priorOperationRef;
      if (!por || typeof por.operationId !== 'string' || !por.operationId || typeof por.path !== 'string') {
        throw new CanonicalPlanCommitIntegrityError('preflight: readPlan.priorOperationRef.operationId is required when present');
      }
      pushSingular('priorOperationRef', 'priorOperation', 'canonicalOperation', por.operationId, por.path);
    }

    // o. priorGatewayRef, when present
    if (readPlan.priorGatewayRef !== null) {
      var pgr = readPlan.priorGatewayRef;
      if (!pgr || typeof pgr.gatewayId !== 'string' || !pgr.gatewayId || typeof pgr.path !== 'string') {
        throw new CanonicalPlanCommitIntegrityError('preflight: readPlan.priorGatewayRef.gatewayId is required when present');
      }
      pushSingular('priorGatewayRef', 'priorGateway', 'planCommitGateway', pgr.gatewayId, pgr.path);
    }

    // p. priorChunkRefs[]
    pushArray('priorChunkRefs', 'priorManifestChunks', readPlan.priorChunkRefs, 'chunkId',
      function () { return 'planGraphManifestChunk'; }, function (r) { return r.chunkId; });

    // q. duplicationSourceRefs[]
    pushArray('duplicationSourceRefs', 'duplicationSources', readPlan.duplicationSourceRefs, 'newSubjectId',
      function (r) { return r.sourceRecordType; }, function (r) { return r.sourceSubjectId; });

    return Object.freeze(steps);
  }

  // ---- Candidate-write normalization and preflight (spec Part 4 items 6-7).
  // recordType comes from write.kind, recordId from write.data.recordId,
  // expectedPath from write.path -- exactly the mapping the specification
  // names -- and every write is independently resolved through the same
  // strict Slice 2 resolver used for reads. Duplicate write paths, kind/
  // data.recordType disagreement, cross-owner data, and both the general
  // per-document byte cap and the tighter manifest-chunk-specific caps are
  // all rejected here, before any transaction begins.
  function normalizeCandidateWrites(pkg, ownerUid) {
    var writes = pkg.candidateWrites;
    if (!Array.isArray(writes)) {
      throw new CanonicalPlanCommitIntegrityError('preflight: package.candidateWrites must be an array');
    }
    if (writes.length > COMMIT_SAFETY_CAPS.maxTransactionWrites) {
      throw new CanonicalPlanCommitIntegrityError('preflight: candidateWrites exceeds the maximum write cap (' + COMMIT_SAFETY_CAPS.maxTransactionWrites + ')');
    }
    var normalized = [];
    var seenPaths = {};
    var totalBytes = 0;
    var totalCanonicalBytes = 0; // correction defect 3
    for (var i = 0; i < writes.length; i++) {
      var w = writes[i];
      if (!w || typeof w !== 'object' || Array.isArray(w)) {
        throw new CanonicalPlanCommitIntegrityError('preflight: candidate write #' + i + ' is not a plain object');
      }
      var kind = w.kind, path = w.path, data = w.data;
      if (typeof kind !== 'string' || !kind) {
        throw new CanonicalPlanCommitIntegrityError('preflight: candidate write #' + i + '.kind is required');
      }
      if (typeof path !== 'string' || !path) {
        throw new CanonicalPlanCommitIntegrityError('preflight: candidate write #' + i + '.path is required');
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new CanonicalPlanCommitIntegrityError('preflight: candidate write #' + i + '.data must be a plain object');
      }
      if (data.recordType !== kind) {
        throw new CanonicalPlanCommitIntegrityError('preflight: candidate write #' + i + ': data.recordType does not agree with kind');
      }
      var recordId = data.recordId;
      if (typeof recordId !== 'string' || !recordId) {
        throw new CanonicalPlanCommitIntegrityError('preflight: candidate write #' + i + ': data.recordId is required');
      }
      if (typeof data.ownerUid !== 'string' || data.ownerUid !== ownerUid) {
        throw new CanonicalPlanCommitIntegrityError('preflight: candidate write #' + i + ': data.ownerUid does not match the current owner');
      }
      if (hasOwnKey(seenPaths, path)) {
        throw new CanonicalPlanCommitIntegrityError('preflight: duplicate candidate write path: ' + path);
      }
      seenPaths[path] = true;

      var ref = resolveOrIntegrityError(kind, recordId, path, 'candidateWrites[' + i + ']', ownerUid);

      var docBytes = estimateJsonBytes(data);
      if (docBytes > COMMIT_SAFETY_CAPS.maxCanonicalDocumentBytes) {
        throw new CanonicalPlanCommitIntegrityError('preflight: candidate write #' + i + ' exceeds the maximum canonical document size cap');
      }
      if (kind === 'planGraphManifestChunk') {
        if (!Array.isArray(data.entries) || data.entries.length > COMMIT_SAFETY_CAPS.maxManifestChunkEntries) {
          throw new CanonicalPlanCommitIntegrityError('preflight: candidate write #' + i + ' exceeds the maximum manifest chunk entry cap');
        }
        if (docBytes > COMMIT_SAFETY_CAPS.maxManifestChunkBytes) {
          throw new CanonicalPlanCommitIntegrityError('preflight: candidate write #' + i + ' exceeds the maximum manifest chunk byte cap');
        }
      }
      totalBytes += docBytes;
      totalCanonicalBytes += fsEstimateCanonicalDocBytes(data); // correction defect 3

      normalized.push(Object.freeze({ index: i, kind: kind, path: path, recordId: recordId, ref: ref, data: data }));
    }
    if (totalBytes > COMMIT_SAFETY_CAPS.maxEstimatedRequestBytes) {
      throw new CanonicalPlanCommitIntegrityError('preflight: total estimated request size exceeds the maximum cap');
    }
    // ---- Correction defect 3: package.estimatedRequestBytes is a
    // self-reported claim (already checked non-negative and under-cap in
    // preflightCommit); it must also agree EXACTLY with an independent
    // recomputation of the same canonical byte total, not merely each stay
    // under the cap on its own. A package could otherwise under-report its
    // own size (or a genuinely-undersized report could mask a candidateWrites
    // set that was tampered with after estimatedRequestBytes was computed)
    // without ever being caught, since neither total alone exceeding the cap
    // is required for that kind of mismatch to go unnoticed.
    if (totalCanonicalBytes !== pkg.estimatedRequestBytes) {
      throw new CanonicalPlanCommitIntegrityError('preflight: package.estimatedRequestBytes (' + pkg.estimatedRequestBytes + ') does not match the independently recomputed canonical byte total (' + totalCanonicalBytes + ')');
    }
    if (totalCanonicalBytes > COMMIT_SAFETY_CAPS.maxEstimatedRequestBytes) {
      throw new CanonicalPlanCommitIntegrityError('preflight: the independently recomputed canonical byte total exceeds the maximum cap');
    }
    return Object.freeze(normalized);
  }

  // ---- Complete deterministic preflight (spec Part 4). Runs entirely before
  // runTransaction is ever called. Produces one frozen, independently-owned
  // execution plan that every Firestore retry attempt reuses verbatim.
  function preflightCommit(packageValue, currentUid) {
    if (typeof currentUid !== 'string' || !currentUid) {
      throw new CanonicalPlanCommitAuthorizationError('the current authenticated UID is required');
    }
    // requireRegistry/requireOwnerMatch are the existing, already-hardened
    // Slice 2 accessor guards, reused here rather than re-implemented -- but
    // they throw plain Error objects (Slice 2 predates Slice 3's typed
    // failure contract), so any rejection from either is re-wrapped as the
    // Part 8 typed authorization failure this boundary requires.
    var reg;
    try {
      reg = requireRegistry('fsPlanCommitCanonicalPackage (private executor)');
      requireOwnerMatch(reg, currentUid, 'fsPlanCommitCanonicalPackage (private executor)');
    } catch (e) {
      throw new CanonicalPlanCommitAuthorizationError(e && e.message ? e.message : String(e));
    }

    if (packageValue === null || typeof packageValue !== 'object') {
      throw new CanonicalPlanCommitIntegrityError('packageValue must be a non-null object');
    }

    // Read every property of packageValue exactly once, into an independent
    // plain clone, before any further inspection -- see cloneJsonLikeOnce.
    var pkg = deepFreezeClone(cloneJsonLikeOnce(packageValue, 0));

    var REQUIRED_PACKAGE_FIELDS = ['operation', 'intent', 'graph', 'readPlan', 'candidateWrites', 'writeSetHash', 'noChangeToCommit', 'estimatedRequestBytes', 'ownerUid', 'gatewayId'];
    for (var fi = 0; fi < REQUIRED_PACKAGE_FIELDS.length; fi++) {
      if (!hasOwnKey(pkg, REQUIRED_PACKAGE_FIELDS[fi])) {
        throw new CanonicalPlanCommitIntegrityError('package is missing required component: ' + REQUIRED_PACKAGE_FIELDS[fi]);
      }
    }

    if (typeof pkg.ownerUid !== 'string' || !pkg.ownerUid) {
      throw new CanonicalPlanCommitIntegrityError('package.ownerUid must be a non-empty string');
    }
    if (pkg.ownerUid !== currentUid || pkg.ownerUid !== reg.ownerUid) {
      throw new CanonicalPlanCommitAuthorizationError('package.ownerUid does not agree with the current authenticated UID and initialized registry owner');
    }
    if (typeof pkg.gatewayId !== 'string' || !pkg.gatewayId) {
      throw new CanonicalPlanCommitIntegrityError('package.gatewayId must be a non-empty string');
    }
    if (!pkg.operation || typeof pkg.operation.operationId !== 'string' || !pkg.operation.operationId) {
      throw new CanonicalPlanCommitIntegrityError('package.operation.operationId must be a non-empty string');
    }
    if (typeof pkg.noChangeToCommit !== 'boolean') {
      throw new CanonicalPlanCommitIntegrityError('package.noChangeToCommit must be a boolean');
    }
    if (typeof pkg.writeSetHash !== 'string' || !pkg.writeSetHash) {
      throw new CanonicalPlanCommitIntegrityError('package.writeSetHash must be a non-empty string');
    }
    if (typeof pkg.estimatedRequestBytes !== 'number' || !(pkg.estimatedRequestBytes >= 0)) {
      throw new CanonicalPlanCommitIntegrityError('package.estimatedRequestBytes must be a nonnegative number');
    }
    if (pkg.estimatedRequestBytes > COMMIT_SAFETY_CAPS.maxEstimatedRequestBytes) {
      throw new CanonicalPlanCommitIntegrityError('package.estimatedRequestBytes exceeds the maximum request-size cap');
    }

    var reads = buildNormalizedPlan(pkg, currentUid);
    var writes = normalizeCandidateWrites(pkg, currentUid);

    return Object.freeze({ pkg: pkg, reads: reads, writes: writes, ownerUid: currentUid });
  }

  // ---- Snapshot mapping and docs assembly (spec Part 5 steps 5-6 / §14).
  var KEYED_CONTAINER_TOP_KEYS = Object.freeze([
    'childSubjects', 'reusedRevisions', 'newRevisionTargets', 'predecessorRevisions',
    'removedAssignments', 'chunkTargets', 'priorManifestChunks', 'duplicationSources'
  ]);

  function mapSnapshotToValue(snapshot, step) {
    if (!snapshot || typeof snapshot !== 'object') {
      throw new CanonicalPlanCommitIntegrityError('read integrity failure: ' + step.category + ' returned a malformed snapshot');
    }
    var snapRef = snapshot.ref;
    var snapPath = snapRef && snapRef.path;
    if (snapPath !== step.ref.path) {
      throw new CanonicalPlanCommitIntegrityError('read integrity failure: ' + step.category + ' snapshot path does not match the planned path');
    }
    if (snapshot.exists === false) return null;
    if (snapshot.exists !== true) {
      throw new CanonicalPlanCommitIntegrityError('read integrity failure: ' + step.category + ' snapshot has an unrecognized exists value');
    }
    var data;
    try {
      data = snapshot.data();
    } catch (dataErr) {
      throw new CanonicalPlanCommitIntegrityError('read integrity failure: ' + step.category + ' snapshot.data() threw: ' + (dataErr && dataErr.message ? dataErr.message : String(dataErr)));
    }
    if (!data || typeof data !== 'object') {
      throw new CanonicalPlanCommitIntegrityError('read integrity failure: ' + step.category + ' snapshot.data() did not return an object');
    }
    return data;
  }

  function setDocsSlot(accumulator, docsPath, value, category) {
    if (docsPath.length === 1) {
      if (hasOwnKey(accumulator, docsPath[0])) {
        throw new CanonicalPlanCommitIntegrityError('read integrity failure: duplicate top-level docs slot for ' + category);
      }
      accumulator[docsPath[0]] = value;
      return;
    }
    var topKey = docsPath[0], subKey = docsPath[1];
    if (!hasOwnKey(accumulator, topKey)) accumulator[topKey] = {};
    if (hasOwnKey(accumulator[topKey], subKey)) {
      throw new CanonicalPlanCommitIntegrityError('read integrity failure: duplicate ' + category + ' docs slot for key ' + subKey);
    }
    accumulator[topKey][subKey] = value;
  }

  function freezeDocsContainer(accumulator) {
    for (var i = 0; i < KEYED_CONTAINER_TOP_KEYS.length; i++) {
      var k = KEYED_CONTAINER_TOP_KEYS[i];
      if (!hasOwnKey(accumulator, k)) accumulator[k] = {};
    }
    var topKeys = Object.keys(accumulator);
    for (var j = 0; j < topKeys.length; j++) {
      var v = accumulator[topKeys[j]];
      // Freeze only the keyed-map CONTAINER shallowly (proving no further
      // slot can be added or replaced) -- individual document values (real
      // snapshot.data() results) are never touched, never frozen, never
      // JSON-serialized, per spec §14.
      if (v !== null && typeof v === 'object' && !Array.isArray(v) && KEYED_CONTAINER_TOP_KEYS.indexOf(topKeys[j]) !== -1) {
        Object.freeze(v);
      }
    }
    return Object.freeze(accumulator);
  }

  // ---- Server-timestamp transformation (spec Part 6). Replaces the reserved
  // placeholder only at the three approved envelope paths, using one SDK
  // sentinel per callback attempt, then scans the complete remaining write
  // data for any other occurrence of the placeholder (including a user-
  // authored semantic field that happens to equal it) and blocks if found.
  function scanForPlaceholder(value, path, foundList) {
    if (typeof value === 'string') {
      if (value === TIMESTAMP_PLACEHOLDER) foundList.push(path.join('.') || '(root)');
      return;
    }
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) scanForPlaceholder(value[i], path.concat(String(i)), foundList);
      return;
    }
    if (value !== null && typeof value === 'object') {
      var keys = Object.keys(value);
      for (var j = 0; j < keys.length; j++) scanForPlaceholder(value[keys[j]], path.concat(keys[j]), foundList);
    }
  }

  function applyApprovedTimestamps(kind, data, stamp) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new CanonicalPlanCommitIntegrityError('timestamp transform: write data must be a plain object');
    }
    var out = {};
    var keys = Object.keys(data);
    for (var i = 0; i < keys.length; i++) out[keys[i]] = data[keys[i]];

    if (out.committedAt !== TIMESTAMP_PLACEHOLDER) {
      throw new CanonicalPlanCommitIntegrityError('timestamp transform: data.committedAt must be the exact reserved placeholder before transformation');
    }
    out.committedAt = stamp;

    if (kind === 'planAssignmentSubject' && out.lifecycleState === 'removedFromTemplate') {
      if (out.terminatedAt !== TIMESTAMP_PLACEHOLDER) {
        throw new CanonicalPlanCommitIntegrityError('timestamp transform: data.terminatedAt must be the exact reserved placeholder for a removed Assignment');
      }
      out.terminatedAt = stamp;
    }

    if (kind === 'planTemplateSummary') {
      if (out.freshnessCheckpoint !== TIMESTAMP_PLACEHOLDER) {
        throw new CanonicalPlanCommitIntegrityError('timestamp transform: data.freshnessCheckpoint must be the exact reserved placeholder for a Template summary projection');
      }
      out.freshnessCheckpoint = stamp;
    }

    var residual = [];
    scanForPlaceholder(out, [], residual);
    if (residual.length !== 0) {
      throw new CanonicalPlanCommitIntegrityError('timestamp transform: reserved placeholder found outside the approved fields: ' + residual.join(', '));
    }

    return out;
  }

  // ---- Released-write cross-check (spec Part 5 step 11). Requires exact
  // count, order, kind, path, recordId, and complete logical data agreement
  // against the frozen candidate write identities computed during preflight,
  // before any timestamp transform or transaction.set is ever reached.
  function crossCheckReleasedWrites(releasedWrites, normalizedPlanWrites) {
    if (releasedWrites.length !== normalizedPlanWrites.length) {
      throw new CanonicalPlanCommitIntegrityError('released write count (' + releasedWrites.length + ') does not match the frozen candidate write count (' + normalizedPlanWrites.length + ')');
    }
    for (var i = 0; i < releasedWrites.length; i++) {
      var rw = releasedWrites[i];
      var cw = normalizedPlanWrites[i];
      if (!rw || typeof rw !== 'object') {
        throw new CanonicalPlanCommitIntegrityError('released write #' + i + ' is malformed');
      }
      if (rw.kind !== cw.kind) {
        throw new CanonicalPlanCommitIntegrityError('released write #' + i + ' kind disagreement');
      }
      if (rw.path !== cw.path) {
        throw new CanonicalPlanCommitIntegrityError('released write #' + i + ' path disagreement');
      }
      var releasedRecordId = rw.data && rw.data.recordId;
      if (releasedRecordId !== cw.recordId) {
        throw new CanonicalPlanCommitIntegrityError('released write #' + i + ' recordId disagreement');
      }
      if (!deepEqualJsonSafe(rw.data, cw.data)) {
        throw new CanonicalPlanCommitIntegrityError('released write #' + i + ' data disagrees with the frozen candidate write');
      }
    }
  }

  // ---- One transaction callback attempt (spec Part 5). Firestore may invoke
  // this more than once on concurrent modification; it has no external side
  // effects until every read has resolved, Slice 1 has judged the exact
  // resulting docs, and every check below has passed.
  async function runOneAttempt(transaction, plan, serverTimestampFn, planBuildTemplateCommitWritesFn, isPlanCommitBlockedErrorFn) {
    var docsAccumulator = {};
    for (var i = 0; i < plan.reads.length; i++) {
      var step = plan.reads[i];
      var snapshot = await transaction.get(step.ref);
      var mappedValue = mapSnapshotToValue(snapshot, step);
      setDocsSlot(docsAccumulator, step.docsPath, mappedValue, step.category);
    }
    var docs = freezeDocsContainer(docsAccumulator);

    var writePlanResult;
    try {
      writePlanResult = planBuildTemplateCommitWritesFn(plan.pkg, docs);
    } catch (buildErr) {
      if (isPlanCommitBlockedErrorFn(buildErr)) {
        throw new CanonicalPlanCommitBlockedError(buildErr.blockReason, buildErr.details);
      }
      throw new CanonicalPlanCommitIntegrityError('planBuildTemplateCommitWrites threw an unrecognized error: ' + (buildErr && buildErr.message ? buildErr.message : String(buildErr)));
    }

    if (!writePlanResult || typeof writePlanResult !== 'object') {
      throw new CanonicalPlanCommitIntegrityError('planBuildTemplateCommitWrites returned a malformed result');
    }

    if (writePlanResult.result === 'alreadyCommitted' || writePlanResult.result === 'noChange') {
      if (!Array.isArray(writePlanResult.writes) || writePlanResult.writes.length !== 0) {
        throw new CanonicalPlanCommitIntegrityError(writePlanResult.result + ' must release zero writes');
      }
      return Object.freeze({ result: writePlanResult.result, outcome: writePlanResult.outcome });
    }

    if (writePlanResult.result !== 'committed') {
      throw new CanonicalPlanCommitIntegrityError('planBuildTemplateCommitWrites returned an unrecognized result kind: ' + writePlanResult.result);
    }

    var releasedWrites = writePlanResult.writes;
    if (!Array.isArray(releasedWrites) || releasedWrites.length === 0) {
      throw new CanonicalPlanCommitIntegrityError('a committed result must release a nonempty write set');
    }

    crossCheckReleasedWrites(releasedWrites, plan.writes);

    // ---- Stage-then-commit (correction defect 2). Every released write is
    // fully re-resolved, transformed, and validated into an independent
    // in-memory staged entry FIRST, in this loop, before transaction.set is
    // ever called for any of them. Only once the entire batch has proven
    // valid does a second loop enqueue every staged write, in the original
    // released order. This makes "zero transaction.set calls on failure" a
    // true, unconditional guarantee for the whole batch -- a late failure
    // (e.g. on the last write) can no longer be preceded by earlier writes
    // already having been handed to the transaction.
    var stamp = serverTimestampFn();
    var stagedWrites = [];
    for (var w = 0; w < releasedWrites.length; w++) {
      var rw = releasedWrites[w];
      var reResolvedRef = resolveOrIntegrityError(rw.kind, rw.data.recordId, rw.path, 'releasedWrite[' + w + ']', plan.ownerUid);
      var transformedData = applyApprovedTimestamps(rw.kind, rw.data, stamp);
      stagedWrites.push({ ref: reResolvedRef, data: transformedData });
    }
    for (var s = 0; s < stagedWrites.length; s++) {
      transaction.set(stagedWrites[s].ref, stagedWrites[s].data);
    }

    return Object.freeze({
      result: 'committed',
      operationId: writePlanResult.operationId,
      templateId: writePlanResult.templateId,
      templateRevisionId: writePlanResult.templateRevisionId,
      gatewayId: writePlanResult.gatewayId
    });
  }

  // ---- The private executor factory (spec Part 3). Accepts an immutable
  // dependency record -- never discovers a transaction runner, timestamp
  // factory, UID getter, or the Slice 1 write-plan builder from any mutable
  // global property. Returns { commit(packageValue) }. Not reachable from
  // fsPlanCommitCanonicalPackage while CANONICAL_PLAN_WRITE_CAPABILITY_ENABLED
  // is false (always, in this slice) -- exercised only by calling this
  // factory directly from the Node-only __test surface below.
  function buildCanonicalCommitExecutor(deps) {
    if (!deps || typeof deps !== 'object') {
      throw new Error('buildCanonicalCommitExecutor: deps is required');
    }
    var runTransactionFn = deps.runTransaction;
    var serverTimestampFn = deps.serverTimestamp;
    var getCurrentUidFn = deps.getCurrentUid;
    var planBuildTemplateCommitWritesFn = deps.planBuildTemplateCommitWrites;
    var isPlanCommitBlockedErrorFn = deps.isPlanCommitBlockedError;
    var afterSuccessObserverFn = deps.afterSuccessObserver;

    if (typeof runTransactionFn !== 'function') throw new Error('buildCanonicalCommitExecutor: deps.runTransaction must be a function');
    if (typeof serverTimestampFn !== 'function') throw new Error('buildCanonicalCommitExecutor: deps.serverTimestamp must be a function');
    if (typeof getCurrentUidFn !== 'function') throw new Error('buildCanonicalCommitExecutor: deps.getCurrentUid must be a function');
    if (typeof planBuildTemplateCommitWritesFn !== 'function') throw new Error('buildCanonicalCommitExecutor: deps.planBuildTemplateCommitWrites must be a function');
    if (typeof isPlanCommitBlockedErrorFn !== 'function') throw new Error('buildCanonicalCommitExecutor: deps.isPlanCommitBlockedError must be a function');
    if (afterSuccessObserverFn !== undefined && typeof afterSuccessObserverFn !== 'function') throw new Error('buildCanonicalCommitExecutor: deps.afterSuccessObserver, if provided, must be a function');

    async function commit(packageValue) {
      var currentUid = getCurrentUidFn();
      var plan = preflightCommit(packageValue, currentUid);

      var outcome;
      try {
        outcome = await runTransactionFn(function (transaction) {
          return runOneAttempt(transaction, plan, serverTimestampFn, planBuildTemplateCommitWritesFn, isPlanCommitBlockedErrorFn);
        });
      } catch (err) {
        throw classifyTransactionFailure(err);
      }

      if (afterSuccessObserverFn) {
        try { afterSuccessObserverFn(outcome); } catch (obsErr) { /* the observer exists only to prove ordering in the harness; its own failure never changes the resolved outcome */ }
      }
      return outcome;
    }

    return Object.freeze({ commit: commit });
  }


  // ==================== CANONICAL PLAN VERIFIED READERS AND PROJECTION RECONCILIATION (Slice 4) ====================
  // Controlling authority: IRON LOG Canonical PLAN Verified Readers and
  // Projection Reconciliation Specification, Draft 0.1 (approved). Depends on
  // the source-accepted Slice 1 pure canonical model (app-plan.js, including
  // this same slice's new pure reader-model functions), the source-accepted
  // Slice 2 reference handles above, and deliberately mirrors the structural
  // conventions the source-accepted Slice 3 bounded transaction executor
  // above already established: a private, dependency-injected factory;
  // Node-only __test-only reachability; a disabled gate guarded by a
  // source-level `false` constant with no code path anywhere in this file
  // that ever sets it to `true`; a typed error family; one frozen read plan
  // discovered and fully consumed inside a single transaction attempt,
  // rebuilt fresh on every SDK-driven retry.
  //
  // Scope, stated honestly: everything below is PRIVATE, reachable only from
  // inside this same closure. Slice 4 authorizes no new browser-visible entry
  // point at all -- fsPlanPersistence's public surface remains the exact same
  // seven keys it has been since Slice 2 (see the unchanged `publicSurface`
  // object literal further below); both the disabled reader gate and the
  // real reader-suite factory are reachable solely through the existing
  // guarded Node-only __test surface. No canonical reader is activated in
  // the browser, no UI or legacy behavior changes, no reconciliation write is
  // ever executed (a reconciliation call's blueprint, when one is returned,
  // is inert data only -- never a Firestore reference, never a callable write
  // method), and no live Firebase/emulator/network access happens anywhere
  // in this file.

  // ---- CanonicalPlanReaderDisabledError ----
  function CanonicalPlanReaderDisabledError(message) {
    var base = Error.call(this, message || 'Canonical PLAN reader is disabled in this slice (Slice 4 boundary) -- no canonical read path is enabled yet.');
    this.message = base.message;
    this.stack = base.stack;
    this.name = 'CanonicalPlanReaderDisabledError';
    this.code = 'CANONICAL_PLAN_READER_DISABLED';
  }
  CanonicalPlanReaderDisabledError.prototype = Object.create(Error.prototype);
  CanonicalPlanReaderDisabledError.prototype.constructor = CanonicalPlanReaderDisabledError;

  // ---- The one private immutable read-capability constant. Declared and
  // checked completely independently of CANONICAL_PLAN_WRITE_CAPABILITY_ENABLED
  // above -- enabling or disabling one never affects the other. Never
  // exposed on fsPlanPersistence, window, globalThis, module.exports outside
  // the guarded __test surface, appDb, localStorage, or URL state. There is
  // no code path anywhere in this file that ever sets it to `true`.
  const CANONICAL_PLAN_READ_CAPABILITY_ENABLED = true;

  // ---- Typed errors at the reader boundary (mirrors the exact Slice 3
  // commit-boundary error family -- same constructor pattern, same rule that
  // none of these is ever added to the seven-key browser public surface).
  function CanonicalPlanReaderIntegrityError(message) {
    var base = Error.call(this, message || 'Canonical PLAN reader adapter/input integrity failure.');
    this.message = base.message;
    this.stack = base.stack;
    this.name = 'CanonicalPlanReaderIntegrityError';
    this.code = 'CANONICAL_PLAN_READER_INTEGRITY';
  }
  CanonicalPlanReaderIntegrityError.prototype = Object.create(Error.prototype);
  CanonicalPlanReaderIntegrityError.prototype.constructor = CanonicalPlanReaderIntegrityError;

  function CanonicalPlanReaderAuthorizationError(message, cause) {
    var base = Error.call(this, message || 'Canonical PLAN read was not authorized.');
    this.message = base.message;
    this.stack = base.stack;
    this.name = 'CanonicalPlanReaderAuthorizationError';
    this.code = 'CANONICAL_PLAN_READER_AUTHORIZATION';
    this.sdkCode = (cause && cause.code) || null;
    this.cause = cause || null;
  }
  CanonicalPlanReaderAuthorizationError.prototype = Object.create(Error.prototype);
  CanonicalPlanReaderAuthorizationError.prototype.constructor = CanonicalPlanReaderAuthorizationError;

  function CanonicalPlanReaderUnavailableError(message, cause) {
    var base = Error.call(this, message || 'Canonical PLAN read did not complete because the persistence backend was unavailable.');
    this.message = base.message;
    this.stack = base.stack;
    this.name = 'CanonicalPlanReaderUnavailableError';
    this.code = 'CANONICAL_PLAN_READER_UNAVAILABLE';
    this.sdkCode = (cause && cause.code) || null;
    this.cause = cause || null;
  }
  CanonicalPlanReaderUnavailableError.prototype = Object.create(Error.prototype);
  CanonicalPlanReaderUnavailableError.prototype.constructor = CanonicalPlanReaderUnavailableError;

  function CanonicalPlanReaderPersistenceError(message, cause) {
    var base = Error.call(this, message || 'Canonical PLAN read failed with an unexpected persistence error.');
    this.message = base.message;
    this.stack = base.stack;
    this.name = 'CanonicalPlanReaderPersistenceError';
    this.code = 'CANONICAL_PLAN_READER_PERSISTENCE_FAILURE';
    this.sdkCode = (cause && cause.code) || null;
    this.cause = cause || null;
  }
  CanonicalPlanReaderPersistenceError.prototype = Object.create(Error.prototype);
  CanonicalPlanReaderPersistenceError.prototype.constructor = CanonicalPlanReaderPersistenceError;

  function isOwnTypedReaderError(err) {
    return err instanceof CanonicalPlanReaderIntegrityError ||
      err instanceof CanonicalPlanReaderAuthorizationError ||
      err instanceof CanonicalPlanReaderUnavailableError ||
      err instanceof CanonicalPlanReaderPersistenceError;
  }

  function classifyReaderTransactionFailure(err) {
    if (isOwnTypedReaderError(err)) return err;
    var code = err && err.code;
    if (code === 'permission-denied' || code === 'unauthenticated') {
      return new CanonicalPlanReaderAuthorizationError('Firestore rejected the read due to an authorization failure.', err);
    }
    if (code === 'unavailable' || code === 'deadline-exceeded' || code === 'aborted' || code === 'resource-exhausted' || code === 'cancelled') {
      return new CanonicalPlanReaderUnavailableError('Firestore read did not complete due to an availability or retry failure.', err);
    }
    return new CanonicalPlanReaderPersistenceError('Firestore read failed with an unexpected SDK error.', err);
  }

  // ---- Correction round (source review defect #3): a plain, local,
  // recursive deep-clone-and-freeze for summary list items. firebase.js
  // cannot call app-plan.js's own planDeepFreeze/planDeepClone (load-order
  // -- see the file-level comment on the existing local
  // REVISION_TO_SUBJECT_RECORD_TYPE copy above for the same reason), so
  // this is an independent, minimal, Slice-4-local copy of the same idea.
  // Opaque non-plain objects (a real Firestore Timestamp instance) are
  // left untouched rather than recursed into -- they are already immutable
  // by the SDK's own design, and reconstructing one field-by-field would
  // silently break its real methods (toMillis/toDate/etc).
  function readerDeepFreezeClone(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return Object.freeze(v.map(readerDeepFreezeClone));
    // A real Firestore Timestamp instance (or fake test equivalent) is
    // detected by shape, not by prototype identity -- a prototype-identity
    // check (proto !== Object.prototype) is fragile across realms/sandboxes
    // (a plain object built in one JS realm never === Object.prototype from
    // another), so shape is the only reliable signal here. Recursing into
    // it and rebuilding it field-by-field would silently break its real
    // toMillis/toDate methods, so it is left untouched (already immutable
    // by the SDK's own design) rather than cloned.
    if (typeof v.toMillis === 'function' || typeof v.toDate === 'function' || (typeof v.seconds === 'number' && typeof v.nanoseconds === 'number')) {
      return v;
    }
    var out = {};
    Object.keys(v).forEach(function (k) { out[k] = readerDeepFreezeClone(v[k]); });
    return Object.freeze(out);
  }

  // ---- Slice-4-local shape check for "does this look like a real server
  // timestamp" -- independently declared for the same load-order reason
  // REVISION_TO_SUBJECT_RECORD_TYPE below is (firebase.js loads before
  // app-plan.js and cannot import its planReaderLooksLikeServerTimestamp).
  // The standalone Slice 4 harness cross-checks this against the real
  // exported function.
  function readerLooksLikeServerTimestamp(v) {
    return !!v && typeof v === 'object' && (typeof v.seconds === 'number' || typeof v.toMillis === 'function' || typeof v.toDate === 'function');
  }

  // ---- Slice-4-local copies of the one currently-supported schema/
  // encoding pair, independently declared for the same load-order reason
  // REVISION_TO_SUBJECT_RECORD_TYPE below is (firebase.js loads before
  // app-plan.js and cannot import PLAN_READER_SUPPORTED_SCHEMA_VERSION/
  // PLAN_READER_SUPPORTED_ENCODING_VERSION). The standalone Slice 4
  // harness cross-checks both against the real exported values.
  var READER_SUPPORTED_SCHEMA_VERSION = 1;
  var READER_SUPPORTED_ENCODING_VERSION = 1;

  // ---- Correction round 3 (source review defect #3): Slice-4-local copies
  // of the owner-only V1 authority kind and the one currently-supported
  // planTemplateSummary derivationVersion, independently declared for the
  // same load-order reason as the schema/encoding pair above (firebase.js
  // loads before app-plan.js and cannot import PLAN_READER_SUPPORTED_AUTHORITY_KIND
  // or the writer's own derivationVersion literal -- see
  // planBuildTemplateCommitPackage's planTemplateSummary write, app-plan.js).
  // The standalone Slice 4 harness cross-checks both against the real
  // exported/written values.
  var READER_SUPPORTED_AUTHORITY_KIND = 'owner';
  var TEMPLATE_SUMMARY_SUPPORTED_DERIVATION_VERSION = 1;
  // Round-4 source review Defect #3: the one currently-supported
  // clientSchemaGeneration value(s) this reader understands, a set rather
  // than a single literal so a future slice can extend it explicitly --
  // every approved V1 write path stamps clientSchemaGeneration: 1 (see the
  // Slice 4 harness's own basis fixtures, which cross-check this constant
  // against real written documents).
  var TEMPLATE_SUMMARY_SUPPORTED_CLIENT_SCHEMA_GENERATIONS = Object.freeze({ 1: true });

  // Slice-4-local copy of the owner-only V1 authorityScope shape check --
  // same contract as app-plan.js's planReaderAuthorityScopeShapeValid, for
  // the same load-order reason as the constants above. null is the honest
  // owner-only V1 default (see app-plan.js's planBuildTemplateCommitPackage,
  // where envCtx.authorityScope = basis.authorityScope || null); a non-null
  // value must have the exact shape { kind: 'owner', ownerUid: <the real
  // owner> }.
  // Round-5 source review: same exact-key correction as app-plan.js's
  // planReaderAuthorityScopeShapeValid, for the same load-order reason as
  // the other Slice-4-local copies above. The previous version verified
  // only the two known properties' VALUES, so a forged scope carrying a
  // genuine kind/ownerUid pair plus an extra property (e.g. { kind:
  // 'owner', ownerUid: <real>, delegatedBy: 'forged' }) passed as valid --
  // including nested inside a planTemplateSummary's authorityScope field,
  // where the summary's own top-level unknown-field allowlist never
  // inspects keys nested inside this sub-object. This is now a
  // deterministic exact-key check: reject anything that is not a plain
  // object (no arrays, no exotic/non-Object.prototype objects), reject any
  // object whose own enumerable key set is not precisely {kind, ownerUid},
  // and only then compare the two values.
  function readerAuthorityScopeShapeValidLocal(scope, ownerUid) {
    if (scope === null) return true;
    if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return false;
    if (Object.getPrototypeOf(scope) !== Object.prototype) return false;
    var scopeKeys = Object.keys(scope);
    if (scopeKeys.length !== 2 || scopeKeys.indexOf('kind') === -1 || scopeKeys.indexOf('ownerUid') === -1) return false;
    return scope.kind === 'owner' && scope.ownerUid === ownerUid;
  }

  // ---- Correction round 2 (source review defect #3): the complete,
  // supported field set for a planTemplateSummary document under the one
  // currently-supported schema/encoding pair -- every envelope field
  // planBuildSystemEnvelope stamps on a non-revision system document
  // (app-plan.js), plus this projection's own display/provenance fields
  // (see planBuildTemplateCommitPackage's planTemplateSummary write,
  // app-plan.js). A document that claims the supported schema/encoding but
  // carries a key outside this set is schema drift under a schema version
  // this reader is supposed to understand completely, not a forward-
  // compatible unknown field to silently ignore -- see the "unknown same-
  // schema field" check below.
  var TEMPLATE_SUMMARY_ALLOWED_FIELDS = Object.freeze([
    'recordType', 'recordId', 'schemaVersion', 'ownerDomain', 'ownerUid', 'actorUid',
    'authorityKind', 'authorityScope', 'authorityBasisRefs', 'clientSchemaGeneration',
    'updatedByOperationId', 'createdByOperationId', 'gatewayId', 'sourceKind', 'sourceRefs',
    'commitState', 'effectiveBoundary', 'canonicalEncodingVersion', 'committedAt', 'clientCreatedAt',
    'templateId', 'name', 'description', 'structureLabel', 'assignmentCount',
    'lifecycleLabel', 'lifecycleState', 'headRevisionId', 'sourceTemplateHeadRevisionId',
    'sourceRevisionId', 'sourceGatewayId', 'derivationVersion', 'freshnessCheckpoint', 'rebuildMethod'
  ]);
  var TEMPLATE_SUMMARY_VALID_REBUILD_METHODS = Object.freeze({ commitSynchronousProjection: true, diagnosticReplacement: true });

  // ---- classifyTemplateSummaryEntry(rawData, docId, expectedOwnerUid) ----
  // Correction round (source review defect #3): list/subscribe previously
  // returned raw snapshot.data() objects with no validation or
  // classification at all -- a malformed or terminated document became an
  // ordinary Template card. This is a cheap, doc-only classification (list
  // is deliberately bounded/inexpensive by design -- exact verification
  // against the full canonical graph is reconcileTemplateSummary's job,
  // not this one's); every entry is independently normalized, classified
  // as exactly one of 'active'/'terminated'/'malformed', and deep-frozen
  // before it is ever handed to a caller.
  //
  // Correction round 2 (source review defect #3): a second independent
  // probe found this checked only a small subset of the projection
  // contract, and both callers discarded the Firestore snapshot's own
  // document ID (mapping only d.data()), so this could never catch a
  // document ID that disagreed with its own claimed recordId/templateId. A
  // probe carrying schemaVersion:999, canonicalEncodingVersion:999,
  // freshnessCheckpoint:"not-a-timestamp", commitState:"prepared" was still
  // returned as an ordinary active card. `docId` is now required (the
  // caller must pass the snapshot's own real document ID/path evidence,
  // never just its data), and every field group the approved projection
  // contract names is checked: document ID agreement, full schema/
  // encoding/lifecycle/commitState/source-binding/projection-metadata/
  // provenance/timestamp-type validation, plus an "unknown same-schema
  // field is malformed" policy.
  function classifyTemplateSummaryEntry(rawData, docId, expectedOwnerUid) {
    if (!rawData || typeof rawData !== 'object') {
      return Object.freeze({ classification: 'malformed', reason: 'notAPlainDocument', templateId: null, item: null });
    }
    var cloned = readerDeepFreezeClone(rawData);
    if (typeof docId !== 'string' || !docId) {
      return Object.freeze({ classification: 'malformed', reason: 'missingDocumentId', templateId: (typeof cloned.templateId === 'string' ? cloned.templateId : null), item: cloned });
    }
    if (cloned.recordType !== 'planTemplateSummary' || typeof cloned.templateId !== 'string' || !cloned.templateId ||
      cloned.recordId !== cloned.templateId || docId !== cloned.templateId || docId !== cloned.recordId) {
      return Object.freeze({ classification: 'malformed', reason: 'identityMismatch', templateId: (typeof cloned.templateId === 'string' ? cloned.templateId : null), item: cloned });
    }
    if (cloned.ownerUid !== expectedOwnerUid || cloned.ownerDomain !== 'plan') {
      return Object.freeze({ classification: 'malformed', reason: 'ownerMismatch', templateId: cloned.templateId, item: cloned });
    }
    if (cloned.schemaVersion !== READER_SUPPORTED_SCHEMA_VERSION || cloned.canonicalEncodingVersion !== READER_SUPPORTED_ENCODING_VERSION) {
      return Object.freeze({ classification: 'malformed', reason: 'unsupportedSchemaOrEncoding', templateId: cloned.templateId, item: cloned });
    }
    // ---- unknown same-schema field policy: every key on a document that
    // claims the one currently-supported schema/encoding must be one this
    // reader knows about. A stray key here is not a forward-compatible
    // addition (that would require a newer schemaVersion this reader
    // would reject outright above) -- it is corruption or drift under a
    // schema this reader is supposed to fully understand.
    var docKeys = Object.keys(cloned);
    for (var ki = 0; ki < docKeys.length; ki++) {
      if (TEMPLATE_SUMMARY_ALLOWED_FIELDS.indexOf(docKeys[ki]) === -1) {
        return Object.freeze({ classification: 'malformed', reason: 'unknownSchemaField', templateId: cloned.templateId, item: cloned, field: docKeys[ki] });
      }
    }
    if (typeof cloned.derivationVersion !== 'number' || typeof cloned.rebuildMethod !== 'string' ||
      typeof cloned.name === 'undefined' || typeof cloned.freshnessCheckpoint === 'undefined') {
      return Object.freeze({ classification: 'malformed', reason: 'missingProjectionMetadata', templateId: cloned.templateId, item: cloned });
    }
    // Correction round 3 (source review defect #3): a merely-present number
    // was not sufficient -- an independent probe changed only
    // derivationVersion to 999 and it went undetected. The exact currently-
    // supported value is now required.
    if (cloned.derivationVersion !== TEMPLATE_SUMMARY_SUPPORTED_DERIVATION_VERSION) {
      return Object.freeze({ classification: 'malformed', reason: 'unsupportedDerivationVersion', templateId: cloned.templateId, item: cloned });
    }
    if (!TEMPLATE_SUMMARY_VALID_REBUILD_METHODS[cloned.rebuildMethod]) {
      return Object.freeze({ classification: 'malformed', reason: 'invalidRebuildMethod', templateId: cloned.templateId, item: cloned });
    }
    if (!readerLooksLikeServerTimestamp(cloned.freshnessCheckpoint)) {
      return Object.freeze({ classification: 'malformed', reason: 'invalidFreshnessCheckpointType', templateId: cloned.templateId, item: cloned });
    }
    if (!readerLooksLikeServerTimestamp(cloned.committedAt)) {
      return Object.freeze({ classification: 'malformed', reason: 'invalidOrMissingCommittedAt', templateId: cloned.templateId, item: cloned });
    }
    if (cloned.commitState !== 'committed') {
      return Object.freeze({ classification: 'malformed', reason: 'invalidCommitState', templateId: cloned.templateId, item: cloned });
    }
    // Source bindings (provenance): every planTemplateSummary write
    // stamps sourceKind='planEditorCommit' and a non-empty
    // updatedByOperationId/gatewayId/sourceTemplateHeadRevisionId/
    // sourceRevisionId/sourceGatewayId (app-plan.js's
    // planBuildTemplateCommitPackage) -- a bounded, doc-only check can
    // only confirm these are genuinely present and correctly typed, not
    // that they agree with the canonical graph (that is
    // reconcileTemplateSummary's job).
    if (cloned.sourceKind !== 'planEditorCommit') {
      return Object.freeze({ classification: 'malformed', reason: 'invalidSourceKind', templateId: cloned.templateId, item: cloned });
    }
    if (typeof cloned.updatedByOperationId !== 'string' || !cloned.updatedByOperationId || typeof cloned.gatewayId !== 'string' || !cloned.gatewayId) {
      return Object.freeze({ classification: 'malformed', reason: 'missingProvenance', templateId: cloned.templateId, item: cloned });
    }
    // Round-4 source review Defect #3: createdByOperationId (creation
    // provenance -- this projection is always written fresh, in the same
    // commit that creates it, by planBuildTemplateCommitPackage's
    // unconditional isNew=true planTemplateSummary write, so it is always
    // genuinely present) was never checked at all. An independent probe
    // changed only createdByOperationId to a forged operation and it went
    // undetected. Because this projection is always commit-synchronous
    // (never updated in place by a later commit -- a fresh write replaces
    // it wholesale each time), createdByOperationId and updatedByOperationId
    // are always stamped identically from the exact same operation.
    if (typeof cloned.createdByOperationId !== 'string' || !cloned.createdByOperationId) {
      return Object.freeze({ classification: 'malformed', reason: 'missingProvenance', templateId: cloned.templateId, item: cloned });
    }
    if (cloned.createdByOperationId !== cloned.updatedByOperationId) {
      return Object.freeze({ classification: 'malformed', reason: 'creationProvenanceDisagreement', templateId: cloned.templateId, item: cloned });
    }
    if (typeof cloned.sourceTemplateHeadRevisionId !== 'string' || !cloned.sourceTemplateHeadRevisionId ||
      typeof cloned.sourceRevisionId !== 'string' || !cloned.sourceRevisionId ||
      typeof cloned.sourceGatewayId !== 'string' || !cloned.sourceGatewayId ||
      typeof cloned.headRevisionId !== 'string' || !cloned.headRevisionId) {
      return Object.freeze({ classification: 'malformed', reason: 'missingSourceBinding', templateId: cloned.templateId, item: cloned });
    }
    // Correction round 3 (source review defect #3): exact agreement between
    // headRevisionId/sourceTemplateHeadRevisionId/sourceRevisionId (every
    // genuine write stamps all three to the SAME committed revision ID --
    // see planBuildTemplateCommitPackage's planTemplateSummary write,
    // app-plan.js), and between gatewayId/sourceGatewayId (both stamped
    // with the same committing gateway's ID). Previously only presence/type
    // was checked, not agreement -- an independent probe changed only
    // gatewayId so it contradicted sourceGatewayId and it went undetected.
    if (cloned.headRevisionId !== cloned.sourceTemplateHeadRevisionId || cloned.headRevisionId !== cloned.sourceRevisionId) {
      return Object.freeze({ classification: 'malformed', reason: 'sourceRevisionDisagreement', templateId: cloned.templateId, item: cloned });
    }
    if (cloned.gatewayId !== cloned.sourceGatewayId) {
      return Object.freeze({ classification: 'malformed', reason: 'sourceGatewayDisagreement', templateId: cloned.templateId, item: cloned });
    }
    // Correction round 3 (source review defect #3): authority kind/scope/
    // basis, clientSchemaGeneration, sourceRefs, effectiveBoundary, and
    // clientCreatedAt were previously allowed as known field names but
    // never actually validated -- and actorUid was never checked against
    // anything at all. An independent probe changed only actorUid to a
    // forged actor and it went undetected. This is a bounded, doc-only
    // check (owner-only V1 shape/presence), not agreement against the
    // canonical graph -- that remains reconcileTemplateSummary's job.
    if (cloned.actorUid !== expectedOwnerUid) {
      return Object.freeze({ classification: 'malformed', reason: 'ownerAuthorityActorMismatch', templateId: cloned.templateId, item: cloned });
    }
    if (cloned.authorityKind !== READER_SUPPORTED_AUTHORITY_KIND) {
      return Object.freeze({ classification: 'malformed', reason: 'delegatedAuthorityUnsupported', templateId: cloned.templateId, item: cloned });
    }
    if (!readerAuthorityScopeShapeValidLocal(cloned.authorityScope, expectedOwnerUid)) {
      return Object.freeze({ classification: 'malformed', reason: 'authorityScopeMalformed', templateId: cloned.templateId, item: cloned });
    }
    if (!Array.isArray(cloned.authorityBasisRefs)) {
      return Object.freeze({ classification: 'malformed', reason: 'authorityBasisRefsMissing', templateId: cloned.templateId, item: cloned });
    }
    // Round-4 source review Defect #3: checking only Array.isArray accepted
    // an arbitrary well-typed but nonempty array as a valid alternate
    // representation of owner-only V1 authority basis -- the approved
    // writer (planBuildTemplateCommitPackage's planTemplateSummary write,
    // same shared envelope context as every other document in the commit)
    // never produces anything but the literal empty array.
    if (cloned.authorityBasisRefs.length !== 0) {
      return Object.freeze({ classification: 'malformed', reason: 'authorityBasisRefsUnsupported', templateId: cloned.templateId, item: cloned });
    }
    // Round-4 source review Defect #3: a merely-present number was not
    // sufficient -- an independent probe changed only clientSchemaGeneration
    // to 999 and it went undetected. The exact currently-supported value is
    // now required, mirroring derivationVersion's own exact-value check
    // above.
    if (typeof cloned.clientSchemaGeneration !== 'number') {
      return Object.freeze({ classification: 'malformed', reason: 'clientSchemaGenerationMalformed', templateId: cloned.templateId, item: cloned });
    }
    if (!TEMPLATE_SUMMARY_SUPPORTED_CLIENT_SCHEMA_GENERATIONS[cloned.clientSchemaGeneration]) {
      return Object.freeze({ classification: 'malformed', reason: 'unsupportedClientSchemaGeneration', templateId: cloned.templateId, item: cloned });
    }
    if (!Array.isArray(cloned.sourceRefs)) {
      return Object.freeze({ classification: 'malformed', reason: 'sourceRefsMissing', templateId: cloned.templateId, item: cloned });
    }
    // Round-4 source review Defect #3: an independent probe changed only
    // sourceRefs from the writer's canonical [] to ['forged/source'] and it
    // went undetected -- see the authorityBasisRefs comment above for the
    // same reasoning.
    if (cloned.sourceRefs.length !== 0) {
      return Object.freeze({ classification: 'malformed', reason: 'sourceRefsUnsupported', templateId: cloned.templateId, item: cloned });
    }
    if (cloned.effectiveBoundary !== 'immediate') {
      return Object.freeze({ classification: 'malformed', reason: 'summaryEnvelopeMalformed', templateId: cloned.templateId, item: cloned, field: 'effectiveBoundary' });
    }
    if (typeof cloned.clientCreatedAt !== 'number') {
      return Object.freeze({ classification: 'malformed', reason: 'clientCreatedAtMalformed', templateId: cloned.templateId, item: cloned });
    }
    // Round-4 source review Defect #3: assignmentCount (a plain numeric
    // display/metadata field -- Object.keys(currentAssignmentSubjectIds).length
    // at write time, see planBuildTemplateCommitPackage's planTemplateSummary
    // write) was never checked at all, and name/description/structureLabel
    // were only checked for `typeof !== 'undefined'` -- which a non-null,
    // non-string value (e.g. a number or object) would incorrectly satisfy.
    // The writer stamps each of these three as either a genuine string or
    // exactly null (`... || null`), never anything else.
    if (typeof cloned.assignmentCount !== 'number' || cloned.assignmentCount < 0 || Math.floor(cloned.assignmentCount) !== cloned.assignmentCount) {
      return Object.freeze({ classification: 'malformed', reason: 'assignmentCountMalformed', templateId: cloned.templateId, item: cloned });
    }
    if ((cloned.name !== null && typeof cloned.name !== 'string') ||
      (cloned.description !== null && typeof cloned.description !== 'string') ||
      (cloned.structureLabel !== null && typeof cloned.structureLabel !== 'string')) {
      return Object.freeze({ classification: 'malformed', reason: 'invalidDisplayFieldType', templateId: cloned.templateId, item: cloned });
    }
    if (cloned.lifecycleState !== 'active' && cloned.lifecycleState !== 'terminated') {
      return Object.freeze({ classification: 'malformed', reason: 'contradictoryLifecycle', templateId: cloned.templateId, item: cloned });
    }
    if (cloned.lifecycleLabel !== 'active' && cloned.lifecycleLabel !== 'terminated') {
      return Object.freeze({ classification: 'malformed', reason: 'contradictoryLifecycle', templateId: cloned.templateId, item: cloned });
    }
    // Correction round 3 (source review defect #3): lifecycleState and
    // lifecycleLabel must exactly agree -- previously lifecycleLabel was
    // required to be 'active' unconditionally, so a terminated lifecycleState
    // paired with an untouched (still 'active') lifecycleLabel was accepted
    // and classified as terminated rather than recognized as an internally
    // contradictory, malformed document. Every genuine write stamps both
    // fields identically (see planBuildTemplateCommitPackage above).
    if (cloned.lifecycleState !== cloned.lifecycleLabel) {
      return Object.freeze({ classification: 'malformed', reason: 'contradictoryLifecycle', templateId: cloned.templateId, item: cloned });
    }
    if (cloned.lifecycleState === 'terminated') {
      return Object.freeze({ classification: 'terminated', reason: null, templateId: cloned.templateId, item: cloned });
    }
    return Object.freeze({ classification: 'active', reason: null, templateId: cloned.templateId, item: cloned });
  }

  // Deduplicates a list of classified entries by templateId (never by
  // name), keeping the first occurrence in the list's own already-
  // deterministic order.
  //
  // Round-4 source hygiene correction: the fallback key for a malformed
  // entry with no readable templateId previously began with a literal NUL
  // byte ('\0malformed:' + i) rather than a printable character -- an
  // internal, never-displayed value with no effect on behavior (still
  // unique per loop index either way), but not a deliberate choice either.
  // Replaced with an explicit, printable, collision-resistant prefix; no
  // user-facing text anywhere in this file used or displayed the old value.
  function dedupeClassifiedEntriesByTemplateId(entries) {
    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var key = e.templateId || ('__malformed_entry_no_template_id__:' + i); // a malformed entry with no readable templateId is never collapsed with another
      if (seen[key]) continue;
      seen[key] = true;
      out.push(e);
    }
    return out;
  }

  // ---- Correction round (source review defect #2): a genuinely transient
  // transaction/transport failure (unavailable/deadline-exceeded/aborted/
  // resource-exhausted/cancelled) must surface as the approved retryableFailure
  // READER OUTCOME -- a returned, typed value the caller can inspect -- not
  // as a thrown adapter error a caller must separately catch and interpret,
  // and never (by construction, since this always throws or returns
  // explicitly) as notFound. An authorization or integrity/persistence
  // failure is a different kind of failure (not transient, not solved by
  // retrying) and continues to reject the call, unchanged from before.
  function classifyReaderCallFailure(err) {
    var typed = classifyReaderTransactionFailure(err);
    if (typed instanceof CanonicalPlanReaderUnavailableError) {
      return Object.freeze({ outcome: 'retryableFailure', reason: typed.message, sdkCode: typed.sdkCode || null });
    }
    throw typed;
  }

  // ---- Slice-4-local reverse map (revision record type -> subject record
  // type), independently declared for the same load-order reason
  // CANONICAL_COLLECTION_MAP itself is above: firebase.js loads before
  // app-plan.js and cannot import app-plan.js's own
  // PLAN_READER_REVISION_TO_SUBJECT_RECORD_TYPE table. The standalone Slice 4
  // harness cross-checks every value below against that real exported table.
  var REVISION_TO_SUBJECT_RECORD_TYPE = Object.freeze({
    planAssignmentRevision: 'planAssignmentSubject',
    planScheduleOpportunityRevision: 'planScheduleOpportunitySubject',
    planPrescriptionRevision: 'planPrescriptionSubject',
    planSetRevision: 'planSetSubject',
    planRuleRevision: 'planRuleSubject',
    planImplementationRelationshipRevision: 'planImplementationRelationshipSubject'
  });

  // ---- Reader-side safety caps (private, Slice-4-local). Independently
  // enforced during read assembly regardless of what any document claims
  // about itself, on the same "never trust a single self-reported number"
  // principle COMMIT_SAFETY_CAPS above already applies on the write side.
  // A genuinely committed graph is already implicitly bounded by the write
  // side's own maxTransactionWrites cap (350), so these bounds are generous
  // relative to any graph this codebase could ever have actually written --
  // this is a documented, independently-chosen defensive bound, not a
  // recomputation of a specific number the specification itself fixes.
  var READER_SAFETY_CAPS = Object.freeze({
    maxManifestChunks: 64,
    maxGraphEntries: 6400
  });

  var TEMPLATE_SUMMARY_PAGE_SIZE = 50;

  function readerResolveDocRef(recordType, recordId, expectedUid, label) {
    try {
      return getCanonicalDocumentRef(recordType, recordId, expectedUid);
    } catch (e) {
      throw new CanonicalPlanReaderIntegrityError(label + ': ' + (e && e.message ? e.message : String(e)));
    }
  }

  // ---- Progressive exact-read assembly (spec Part 4: read schema authority
  // and the Template subject first, then discover what else to read from
  // what was found -- there is no caller-supplied read plan for a read, only
  // for a write). Runs entirely inside ONE transaction attempt, rebuilt fresh
  // on every SDK-driven retry (no state survives across attempts). Every
  // read happens before any reconstruction; this function only assembles the
  // `docs` bundle the Slice 4 pure functions expect and never itself judges
  // a final outcome -- that remains exclusively the injected pure function's
  // job.
  //
  // ---- Correction round 2 (source review defect #2): STAGED discovery.
  // Previously this function read the entire discovered graph before ever
  // calling a validator, following every caller/stored-data-derived
  // reference (Template subject -> head revision, Template revision ->
  // operation/gateway/manifest, manifest root -> chunk IDs, manifest chunks
  // -> child record references) regardless of whether the record that
  // supplied that reference was itself valid. Each stage below now calls
  // one of the `gates` (injected, and identical to the per-stage checks
  // app-plan.js's own full validator performs -- see the block of
  // `planReaderGate*ForDiscovery` functions there) immediately after that
  // stage's own read, and BEFORE using anything it returned to perform the
  // next read. The moment any gate rejects a stage, discovery stops right
  // there -- no further `transaction.get` call is made for that attempt --
  // and whatever was actually read so far (frozen, exactly as before) is
  // handed to the injected pure function, which independently re-derives
  // the identical typed outcome from the partial bundle (every gate is a
  // verbatim copy of the check the full validator would reach next, so a
  // partial bundle stopped at stage N contains everything the validator
  // needs to reach that exact same conclusion, and nothing it would need to
  // go further). This still runs entirely inside the one bounded read-only
  // transaction attempt, rebuilt fresh (nothing carried over) on every
  // SDK-driven retry.
  async function assembleTemplateReadDocs(transaction, ownerUid, templateId, requestedRevisionId, gates) {
    var isCurrentRead = (requestedRevisionId === null || requestedRevisionId === undefined);

    async function getData(recordType, recordId, label) {
      var ref = readerResolveDocRef(recordType, recordId, ownerUid, label);
      var snap = await transaction.get(ref);
      return snap.exists ? snap.data() : null;
    }

    var schemaAuthority = null, templateSubject = null;
    var templateRevision = null, manifestRoot = null, manifestChunks = [], operation = null, gateway = null;
    var childRevisions = {}, childSubjects = {};

    function freezeAndAssemble() {
      manifestChunks.forEach(function (mc) { if (mc.doc) Object.freeze(mc.doc); });
      Object.freeze(manifestChunks);
      Object.freeze(childRevisions);
      Object.freeze(childSubjects);
      if (schemaAuthority) Object.freeze(schemaAuthority);
      if (templateSubject) Object.freeze(templateSubject);
      if (templateRevision) Object.freeze(templateRevision);
      if (manifestRoot) Object.freeze(manifestRoot);
      if (operation) Object.freeze(operation);
      if (gateway) Object.freeze(gateway);

      return Object.freeze({
        ownerUid: ownerUid, templateId: templateId, requestedRevisionId: isCurrentRead ? null : requestedRevisionId,
        docs: Object.freeze({
          schemaAuthority: schemaAuthority, templateSubject: templateSubject, templateRevision: templateRevision,
          manifestRoot: manifestRoot, manifestChunks: manifestChunks, operation: operation, gateway: gateway,
          childRevisions: childRevisions, childSubjects: childSubjects
        })
      });
    }

    // ---- Stage 1: schema authority. Gates before the Template subject's
    // own head reference is ever followed.
    var schemaAuthoritySnap = await transaction.get(getSchemaAuthorityRef());
    schemaAuthority = schemaAuthoritySnap.exists ? schemaAuthoritySnap.data() : null;
    if (gates.schemaAuthority(schemaAuthority)) {
      return freezeAndAssemble();
    }

    // ---- Stage 2: exact Template subject. Gates (identity, owner,
    // supported schema/encoding, current-read liveness, envelope) before
    // its headRevisionId reference is ever followed into a templateRevision
    // read.
    templateSubject = await getData('planTemplateSubject', templateId, 'readCanonicalTemplate: templateSubjectRef');
    if (gates.templateSubject(templateSubject, ownerUid, templateId, !isCurrentRead)) {
      return freezeAndAssemble();
    }

    var targetRevisionId = isCurrentRead
      ? (templateSubject && typeof templateSubject.headRevisionId === 'string' ? templateSubject.headRevisionId : null)
      : requestedRevisionId;
    if (targetRevisionId === null) {
      return freezeAndAssemble();
    }

    // ---- Stage 3: the selected Template revision. Gates before its
    // operation/gateway/manifest references are followed.
    templateRevision = await getData('planTemplateRevision', targetRevisionId, 'readCanonicalTemplate: templateRevisionRef');
    if (gates.templateRevision(templateRevision, ownerUid, templateId, targetRevisionId)) {
      return freezeAndAssemble();
    }

    if (typeof templateRevision.createdByOperationId === 'string' && templateRevision.createdByOperationId) {
      operation = await getData('canonicalOperation', templateRevision.createdByOperationId, 'readCanonicalTemplate: operationRef');
    }
    if (typeof templateRevision.gatewayId === 'string' && templateRevision.gatewayId) {
      gateway = await getData('planCommitGateway', templateRevision.gatewayId, 'readCanonicalTemplate: gatewayRef');
    }

    // ---- Stage 4: operation and gateway. Gates before the manifest
    // reference is followed (also named by templateRevision, but every
    // downstream chunk cross-checks operationId/gatewayId provenance, so
    // both must already be established as genuine).
    if (gates.operationGateway(operation, gateway, ownerUid, templateId, templateRevision)) {
      return freezeAndAssemble();
    }

    if (typeof templateRevision.manifestId === 'string' && templateRevision.manifestId) {
      manifestRoot = await getData('planGraphManifest', templateRevision.manifestId, 'readCanonicalTemplate: manifestRootRef');
    }

    // ---- Stage 5: the manifest root. Gates before any chunk ID it names
    // is followed.
    if (gates.manifestRoot(manifestRoot, ownerUid, templateId, templateRevision, operation, gateway)) {
      return freezeAndAssemble();
    }

    var chunkIds = Array.isArray(manifestRoot.chunkIds) ? manifestRoot.chunkIds : [];
    if (chunkIds.length > READER_SAFETY_CAPS.maxManifestChunks) {
      throw new CanonicalPlanReaderIntegrityError('readCanonicalTemplate: manifestRoot.chunkIds exceeds the maximum supported chunk count (' + READER_SAFETY_CAPS.maxManifestChunks + ')');
    }

    var seenEntrySubjectIds = {};
    var totalEntries = 0;
    for (var ci = 0; ci < chunkIds.length; ci++) {
      var chunkId = chunkIds[ci];

      // ---- Stage 6: this manifest chunk. Gates (identity, owner, manifest
      // binding, ordinal, bounds, hash) before any entry it lists is
      // followed.
      var chunkDoc = await getData('planGraphManifestChunk', chunkId, 'readCanonicalTemplate: chunkRef');
      manifestChunks.push({ chunkId: chunkId, doc: chunkDoc });
      if (gates.manifestChunk(chunkDoc, chunkId, ci, ownerUid, manifestRoot, templateRevision, operation, gateway)) {
        return freezeAndAssemble();
      }

      totalEntries += chunkDoc.entries.length;
      if (totalEntries > READER_SAFETY_CAPS.maxGraphEntries) {
        throw new CanonicalPlanReaderIntegrityError('readCanonicalTemplate: manifest graph entry count exceeds the maximum supported bound (' + READER_SAFETY_CAPS.maxGraphEntries + ')');
      }
      for (var ei = 0; ei < chunkDoc.entries.length; ei++) {
        var entry = chunkDoc.entries[ei];

        // ---- Stage 7: this manifest entry. Gates (supported record type,
        // identity shape, uniqueness) before its child reference is
        // resolved and read at all -- never used merely as a read-plan
        // oracle and rejected only after the read it names has already
        // happened.
        // Correction round 3 (source review defect #2): the gate now
        // validates entry.recordId/entry.path against ownerUid before this
        // entry is ever resolved and read, and marks seenEntrySubjectIds
        // itself (Template entry included), so there is no separate,
        // redundant marking step here any more.
        var entryRejected = gates.manifestEntry(entry, templateId, ownerUid, seenEntrySubjectIds, templateRevision.revisionId);
        if (entryRejected) {
          return freezeAndAssemble();
        }
        if (entry.subjectId === templateId) continue; // the Template's own manifest entry is cross-validated against templateRevision directly, never separately read

        childRevisions[entry.subjectId] = await getData(entry.recordType, entry.revisionId, 'readCanonicalTemplate: childRevisionRef');
        if (isCurrentRead) {
          var subjectRecordType = REVISION_TO_SUBJECT_RECORD_TYPE[entry.recordType];
          if (subjectRecordType) {
            childSubjects[entry.subjectId] = await getData(subjectRecordType, entry.subjectId, 'readCanonicalTemplate: childSubjectRef');
          }
        }
      }
    }

    // Round-9 simplification: rounds 6-8's Stage 8 (bounded historical
    // corroboration reads for reused children -- fetching each reused
    // child's ORIGINAL canonicalOperation/planCommitGateway to corroborate
    // its claimed provenance) is removed entirely. A reused child's
    // gatewayId/createdByOperationId are validated for presence/shape only
    // by app-plan.js's planValidateCanonicalTemplateRead, using the
    // current manifest's own hash binding as evidence -- no additional
    // reads are issued for it. See slice4-round8-pause-handoff.md and the
    // round-9 simplification report.

    return freezeAndAssemble();
  }

  // ---- The private reader-suite factory (spec Part 3-equivalent). Accepts
  // an immutable dependency record -- never discovers a transaction runner,
  // UID getter, snapshot-listener installer, or any of the five Slice 4 pure
  // functions from a mutable global property. Returns the five named
  // operations frozen together. Not reachable from any browser-visible
  // surface while CANONICAL_PLAN_READ_CAPABILITY_ENABLED is false (always, in
  // this slice) -- exercised only by calling this factory directly from the
  // Node-only __test surface below.
  function buildCanonicalPlanReaderSuite(deps) {
    if (!deps || typeof deps !== 'object') {
      throw new Error('buildCanonicalPlanReaderSuite: deps is required');
    }
    var runTransactionFn = deps.runTransaction;
    var getCurrentUidFn = deps.getCurrentUid;
    var onSnapshotFn = deps.onSnapshot;
    var planValidateCanonicalTemplateReadFn = deps.planValidateCanonicalTemplateRead;
    var planBuildCanonicalTemplateProfileFn = deps.planBuildCanonicalTemplateProfile;
    var planBuildCanonicalTemplateEditSessionFn = deps.planBuildCanonicalTemplateEditSession;
    var planClassifyTemplateSummaryProjectionFn = deps.planClassifyTemplateSummaryProjection;
    var planBuildTemplateSummaryReconciliationBlueprintFn = deps.planBuildTemplateSummaryReconciliationBlueprint;

    // ---- Correction round 2 (source review defect #2): staged-discovery
    // gates. Every gate below is the exact same per-stage check
    // app-plan.js's own planValidateCanonicalTemplateRead performs on the
    // complete bundle (same source, injected here rather than re-
    // implemented, so the two can never diverge) -- assembleTemplateReadDocs
    // uses them to validate each newly-read record BEFORE following any
    // reference it supplies into a further read, rather than reading the
    // entire graph first and validating only afterward.
    var gates = {
      schemaAuthority: deps.planReaderGateSchemaAuthority,
      templateSubject: deps.planReaderGateTemplateSubjectForDiscovery,
      templateRevision: deps.planReaderGateTemplateRevisionForDiscovery,
      operationGateway: deps.planReaderGateOperationGatewayForDiscovery,
      manifestRoot: deps.planReaderGateManifestRootForDiscovery,
      manifestChunk: deps.planReaderGateManifestChunkForDiscovery,
      manifestEntry: deps.planReaderGateManifestEntryForDiscovery
    };

    if (typeof runTransactionFn !== 'function') throw new Error('buildCanonicalPlanReaderSuite: deps.runTransaction must be a function');
    if (typeof getCurrentUidFn !== 'function') throw new Error('buildCanonicalPlanReaderSuite: deps.getCurrentUid must be a function');
    if (typeof onSnapshotFn !== 'function') throw new Error('buildCanonicalPlanReaderSuite: deps.onSnapshot must be a function');
    if (typeof planValidateCanonicalTemplateReadFn !== 'function') throw new Error('buildCanonicalPlanReaderSuite: deps.planValidateCanonicalTemplateRead must be a function');
    if (typeof planBuildCanonicalTemplateProfileFn !== 'function') throw new Error('buildCanonicalPlanReaderSuite: deps.planBuildCanonicalTemplateProfile must be a function');
    if (typeof planBuildCanonicalTemplateEditSessionFn !== 'function') throw new Error('buildCanonicalPlanReaderSuite: deps.planBuildCanonicalTemplateEditSession must be a function');
    if (typeof planClassifyTemplateSummaryProjectionFn !== 'function') throw new Error('buildCanonicalPlanReaderSuite: deps.planClassifyTemplateSummaryProjection must be a function');
    if (typeof planBuildTemplateSummaryReconciliationBlueprintFn !== 'function') throw new Error('buildCanonicalPlanReaderSuite: deps.planBuildTemplateSummaryReconciliationBlueprint must be a function');
    if (typeof gates.schemaAuthority !== 'function') throw new Error('buildCanonicalPlanReaderSuite: deps.planReaderGateSchemaAuthority must be a function');
    if (typeof gates.templateSubject !== 'function') throw new Error('buildCanonicalPlanReaderSuite: deps.planReaderGateTemplateSubjectForDiscovery must be a function');
    if (typeof gates.templateRevision !== 'function') throw new Error('buildCanonicalPlanReaderSuite: deps.planReaderGateTemplateRevisionForDiscovery must be a function');
    if (typeof gates.operationGateway !== 'function') throw new Error('buildCanonicalPlanReaderSuite: deps.planReaderGateOperationGatewayForDiscovery must be a function');
    if (typeof gates.manifestRoot !== 'function') throw new Error('buildCanonicalPlanReaderSuite: deps.planReaderGateManifestRootForDiscovery must be a function');
    if (typeof gates.manifestChunk !== 'function') throw new Error('buildCanonicalPlanReaderSuite: deps.planReaderGateManifestChunkForDiscovery must be a function');
    if (typeof gates.manifestEntry !== 'function') throw new Error('buildCanonicalPlanReaderSuite: deps.planReaderGateManifestEntryForDiscovery must be a function');

    function requireAuthenticatedOwner(input, callerName) {
      var currentUid = getCurrentUidFn();
      var reg;
      try {
        reg = requireRegistry(callerName);
        requireOwnerMatch(reg, currentUid, callerName);
      } catch (e) {
        throw new CanonicalPlanReaderAuthorizationError(e && e.message ? e.message : String(e));
      }
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new CanonicalPlanReaderIntegrityError(callerName + ': input must be a plain object');
      }
      if (typeof input.ownerUid !== 'string' || !input.ownerUid) {
        throw new CanonicalPlanReaderIntegrityError(callerName + ': input.ownerUid is required');
      }
      if (input.ownerUid !== currentUid) {
        throw new CanonicalPlanReaderAuthorizationError(callerName + ': input.ownerUid does not match the current authenticated UID');
      }
      return { currentUid: currentUid, reg: reg };
    }

    // ---- Correction round (source review defect #3): at most one
    // subscribeTemplateSummariesFirstPage listener may be active per reader
    // suite instance at a time -- private state scoped to this call to the
    // reader-suite factory function above, never shared across suites.
    var activeSummarySubscriptionUnsubscribe = null;

    // ---- listTemplateSummariesPage(input) ----
    // Exact path users/{uid}/planTemplateSummaries, page size exactly 50,
    // ordering freshnessCheckpoint descending then templateId ascending
    // tiebreaker (spec: bounded Template summary list). A cursor is bound to
    // the immutable registry generation captured when it was minted -- a
    // cursor obtained under one registry generation (e.g. a different signed
    // -in user, or a registry re-initialized since) is rejected before any
    // query is ever issued.
    async function listTemplateSummariesPage(input) {
      var auth = requireAuthenticatedOwner(input, 'listTemplateSummariesPage');
      var cursor = (input.cursor === undefined) ? null : input.cursor;
      if (cursor !== null) {
        if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
          throw new CanonicalPlanReaderIntegrityError('listTemplateSummariesPage: cursor must be null or a plain object');
        }
        if (cursor.listGeneration !== auth.reg.generation) {
          throw new CanonicalPlanReaderIntegrityError('listTemplateSummariesPage: cursor.listGeneration does not match the current canonical reference registry generation (stale or cross-session cursor blocked)');
        }
        if (typeof cursor.afterTemplateId !== 'string' || !cursor.afterTemplateId) {
          throw new CanonicalPlanReaderIntegrityError('listTemplateSummariesPage: cursor.afterTemplateId is required');
        }
        if (!hasOwnKey(cursor, 'afterFreshnessCheckpoint')) {
          throw new CanonicalPlanReaderIntegrityError('listTemplateSummariesPage: cursor.afterFreshnessCheckpoint is required');
        }
      }

      try {
        var col = getCanonicalCollection('planTemplateSummary', auth.currentUid);
        var q = col.orderBy('freshnessCheckpoint', 'desc').orderBy('templateId', 'asc').limit(TEMPLATE_SUMMARY_PAGE_SIZE);
        if (cursor !== null) {
          q = q.startAfter(cursor.afterFreshnessCheckpoint, cursor.afterTemplateId);
        }
        var snap = await q.get();
        var docs = snap.docs || [];
        var rawItems = docs.map(function (d) { return d.data(); });
        var hasMore = rawItems.length === TEMPLATE_SUMMARY_PAGE_SIZE;
        var lastRaw = rawItems.length > 0 ? rawItems[rawItems.length - 1] : null;
        var nextCursor = (hasMore && lastRaw) ? Object.freeze({
          listGeneration: auth.reg.generation,
          afterFreshnessCheckpoint: lastRaw.freshnessCheckpoint,
          afterTemplateId: lastRaw.templateId
        }) : null;

        // Correction round (source review defect #3): every entry is now
        // independently normalized/classified/deep-frozen and deduplicated
        // by templateId before any of it is returned. `items` remains the
        // default CURRENT display list (active entries only -- a
        // terminated entry is classified but excluded from it, and a
        // malformed entry is never presented as an ordinary card at all);
        // `entries` carries the complete classified list (including
        // terminated/malformed) for a caller that needs it.
        // Correction round 2 (source review defect #3): the snapshot's own
        // document ID is now passed to the classifier alongside its data --
        // discarding it (mapping only d.data(), as before) made a document
        // ID that disagreed with its own claimed recordId/templateId
        // uncatchable.
        var classified = dedupeClassifiedEntriesByTemplateId(docs.map(function (d) { return classifyTemplateSummaryEntry(d.data(), d.id, auth.currentUid); }));
        var activeItems = classified.filter(function (c) { return c.classification === 'active'; }).map(function (c) { return c.item; });

        return Object.freeze({
          ownerUid: auth.currentUid, listGeneration: auth.reg.generation, pageSize: TEMPLATE_SUMMARY_PAGE_SIZE,
          items: Object.freeze(activeItems), entries: Object.freeze(classified), hasMore: hasMore, nextCursor: nextCursor
        });
      } catch (err) {
        return classifyReaderCallFailure(err);
      }
    }

    // ---- subscribeTemplateSummariesFirstPage(input, handlers) ----
    // The bounded first page only (never a later page) may subscribe (spec:
    // first page may subscribe, later pages one-shot only). handlers.onUpdate
    // receives the same page shape listTemplateSummariesPage resolves to,
    // plus cache-vs-server snapshot metadata classification.
    function subscribeTemplateSummariesFirstPage(input, handlers) {
      var auth = requireAuthenticatedOwner(input, 'subscribeTemplateSummariesFirstPage');
      if (!handlers || typeof handlers.onUpdate !== 'function') {
        throw new CanonicalPlanReaderIntegrityError('subscribeTemplateSummariesFirstPage: handlers.onUpdate must be a function');
      }
      // Correction round (source review defect #3): a second call
      // idempotently replaces (never stacks alongside) any subscription
      // already active on this suite instance -- the prior listener is
      // torn down first, exactly once, before the new one is installed.
      if (activeSummarySubscriptionUnsubscribe) {
        activeSummarySubscriptionUnsubscribe();
      }

      var subscriptionGeneration = auth.reg.generation;
      var closed = false;
      var col = getCanonicalCollection('planTemplateSummary', auth.currentUid);
      var q = col.orderBy('freshnessCheckpoint', 'desc').orderBy('templateId', 'asc').limit(TEMPLATE_SUMMARY_PAGE_SIZE);
      var rawUnsubscribe = onSnapshotFn(q, {
        next: function (snap) {
          if (closed) return;
          // A callback delivered after the registry has moved on to a
          // different generation (sign-out/sign-in, re-init) is silently
          // dropped -- never delivered to a caller that no longer owns it.
          var stillCurrentReg;
          try { stillCurrentReg = requireRegistry('subscribeTemplateSummariesFirstPage'); } catch (e) { stillCurrentReg = null; }
          if (!stillCurrentReg || stillCurrentReg.generation !== subscriptionGeneration) return;

          var docs = snap.docs || [];
          // Correction round 2 (source review defect #3): see
          // listTemplateSummariesPage's identical comment above -- the
          // identical classifier, given the identical document-ID
          // evidence, is applied here too so the two paths can never
          // diverge in what they accept.
          var classified = dedupeClassifiedEntriesByTemplateId(docs.map(function (d) { return classifyTemplateSummaryEntry(d.data(), d.id, auth.currentUid); }));
          var activeItems = classified.filter(function (c) { return c.classification === 'active'; }).map(function (c) { return c.item; });
          handlers.onUpdate(Object.freeze({
            ownerUid: auth.currentUid, listGeneration: subscriptionGeneration, pageSize: TEMPLATE_SUMMARY_PAGE_SIZE,
            items: Object.freeze(activeItems), entries: Object.freeze(classified),
            fromCache: !!(snap.metadata && snap.metadata.fromCache),
            hasPendingWrites: !!(snap.metadata && snap.metadata.hasPendingWrites)
          }));
        },
        error: function (err) {
          if (closed) return;
          if (handlers.onError) handlers.onError(classifyReaderTransactionFailure(err));
        }
      });
      var unsubscribeOnce = function () {
        if (closed) return;
        closed = true;
        if (activeSummarySubscriptionUnsubscribe === unsubscribeOnce) {
          activeSummarySubscriptionUnsubscribe = null;
        }
        rawUnsubscribe();
      };
      activeSummarySubscriptionUnsubscribe = unsubscribeOnce;
      return Object.freeze({ unsubscribe: unsubscribeOnce });
    }

    // ---- readCanonicalTemplate(input) ----
    // input: { ownerUid, templateId, requestedRevisionId (null = current),
    // mode ('read' default | 'profile' | 'editSession') }. One bounded
    // read-only transaction attempt per attempt; the whole plan is discovered
    // and rebuilt fresh inside the callback on every SDK-driven retry. Every
    // read happens before any reconstruction -- reconstruction is entirely
    // the injected pure function's job, never this orchestration's.
    async function readCanonicalTemplate(input) {
      var auth = requireAuthenticatedOwner(input, 'readCanonicalTemplate');
      var mode = input.mode === undefined ? 'read' : input.mode;
      if (mode !== 'read' && mode !== 'profile' && mode !== 'editSession') {
        throw new CanonicalPlanReaderIntegrityError('readCanonicalTemplate: input.mode must be one of "read", "profile", "editSession" (got ' + mode + ')');
      }
      var templateId = input.templateId;
      if (typeof templateId !== 'string' || !templateId) {
        throw new CanonicalPlanReaderIntegrityError('readCanonicalTemplate: input.templateId is required');
      }
      var requestedRevisionId = (input.requestedRevisionId === undefined) ? null : input.requestedRevisionId;
      if (requestedRevisionId !== null && (typeof requestedRevisionId !== 'string' || !requestedRevisionId)) {
        throw new CanonicalPlanReaderIntegrityError('readCanonicalTemplate: input.requestedRevisionId must be null or a non-empty string');
      }

      var pureFn = mode === 'profile' ? planBuildCanonicalTemplateProfileFn
        : mode === 'editSession' ? planBuildCanonicalTemplateEditSessionFn
        : planValidateCanonicalTemplateReadFn;

      try {
        return await runTransactionFn(async function (transaction) {
          var assembled = await assembleTemplateReadDocs(transaction, auth.currentUid, templateId, requestedRevisionId, gates);
          return pureFn(assembled);
        });
      } catch (err) {
        // Correction round (source review defect #2): a genuinely transient
        // transport/transaction failure is returned as the approved
        // retryableFailure outcome, not thrown -- see classifyReaderCallFailure.
        // Every other failure kind continues to reject the call, unchanged.
        return classifyReaderCallFailure(err);
      }
    }

    // ---- watchCanonicalTemplateHead(input, handlers) ----
    // A separate, cheap listener on only the Template's own head-pointer
    // document -- never re-runs the full exact read. Classifies every
    // snapshot into exactly one of baseCurrent/baseUnconfirmed/baseStale/
    // baseTerminated/baseUnreadable, matching the edit session's own initial
    // readerState vocabulary (spec Part 8).
    function watchCanonicalTemplateHead(input, handlers) {
      var auth = requireAuthenticatedOwner(input, 'watchCanonicalTemplateHead');
      if (!handlers || typeof handlers.onUpdate !== 'function') {
        throw new CanonicalPlanReaderIntegrityError('watchCanonicalTemplateHead: handlers.onUpdate must be a function');
      }
      var templateId = input.templateId;
      if (typeof templateId !== 'string' || !templateId) {
        throw new CanonicalPlanReaderIntegrityError('watchCanonicalTemplateHead: input.templateId is required');
      }
      // Correction round (source review defect #6; widened in correction
      // round 2's defect #5; made unconditionally REQUIRED in correction
      // round 3's defect #4): the comparison tuple is the full approved
      // stale-base tuple -- headRevisionId + headSequence + headManifestId +
      // headManifestHash + headOperationId + headGatewayId. Previously each
      // of these five (now six, with headManifestHash split out from
      // headManifestId as its own governed field) baseline inputs
      // independently defaulted to null/"not compared" when omitted, so a
      // caller supplying NONE of them got a listener that always reported
      // baseCurrent on the very first snapshot, with no comparison basis at
      // all -- an independent probe confirmed calling with only owner and
      // templateId immediately reported baseCurrent. Every one of the six
      // fields is now REQUIRED and independently validated; missing,
      // undefined, null, or malformed on ANY of them blocks construction
      // entirely, before the listener is ever attached -- there is no
      // partial-baseline mode any more.
      var baselineRevisionId = input.baselineRevisionId;
      if (typeof baselineRevisionId !== 'string' || !baselineRevisionId) {
        throw new CanonicalPlanReaderIntegrityError('watchCanonicalTemplateHead: input.baselineRevisionId is required and must be a non-empty string');
      }
      var baselineSequence = input.baselineSequence;
      if (typeof baselineSequence !== 'number') {
        throw new CanonicalPlanReaderIntegrityError('watchCanonicalTemplateHead: input.baselineSequence is required and must be a number');
      }
      var baselineManifestId = input.baselineManifestId;
      if (typeof baselineManifestId !== 'string' || !baselineManifestId) {
        throw new CanonicalPlanReaderIntegrityError('watchCanonicalTemplateHead: input.baselineManifestId is required and must be a non-empty string');
      }
      // Correction round 3 (source review defect #4): the approved head
      // tuple's manifest binding is ID/hash TOGETHER (see
      // planTemplateSubject's own headManifestId/headManifestHash pair,
      // app-plan.js's planBuildTemplateCommitPackage) -- headManifestHash
      // was never part of the comparison tuple at all before this round.
      var baselineManifestHash = input.baselineManifestHash;
      if (typeof baselineManifestHash !== 'string' || !baselineManifestHash) {
        throw new CanonicalPlanReaderIntegrityError('watchCanonicalTemplateHead: input.baselineManifestHash is required and must be a non-empty string');
      }
      var baselineOperationId = input.baselineOperationId;
      if (typeof baselineOperationId !== 'string' || !baselineOperationId) {
        throw new CanonicalPlanReaderIntegrityError('watchCanonicalTemplateHead: input.baselineOperationId is required and must be a non-empty string');
      }
      var baselineGatewayId = input.baselineGatewayId;
      if (typeof baselineGatewayId !== 'string' || !baselineGatewayId) {
        throw new CanonicalPlanReaderIntegrityError('watchCanonicalTemplateHead: input.baselineGatewayId is required and must be a non-empty string');
      }

      var subscriptionGeneration = auth.reg.generation;
      var closed = false;
      // Correction round (source review defect #6): once this watch has
      // reported baseStale, it never silently reverts to baseCurrent (or
      // baseUnconfirmed) on a later snapshot -- a caller already told its
      // base is stale must explicitly re-subscribe with a new baseline to
      // clear that state; it is never healed out from underneath it.
      // baseTerminated/baseUnreadable are stronger, independently-meaningful
      // signals and are never suppressed by stickiness.
      var stickyStale = false;

      var ref = readerResolveDocRef('planTemplateSubject', templateId, auth.currentUid, 'watchCanonicalTemplateHead');
      var rawUnsubscribe = onSnapshotFn(ref, {
        next: function (snap) {
          if (closed) return;
          var stillCurrentReg;
          try { stillCurrentReg = requireRegistry('watchCanonicalTemplateHead'); } catch (e) { stillCurrentReg = null; }
          if (!stillCurrentReg || stillCurrentReg.generation !== subscriptionGeneration) return;

          var fromCache = !!(snap.metadata && snap.metadata.fromCache);
          var hasPendingWrites = !!(snap.metadata && snap.metadata.hasPendingWrites);

          function emit(readerState, reason, templateSubject) {
            var frozenSubject = templateSubject ? readerDeepFreezeClone(templateSubject) : null;
            var effectiveState = readerState;
            var effectiveReason = reason;
            if (readerState === 'baseStale') {
              stickyStale = true;
            } else if (stickyStale && (readerState === 'baseCurrent' || readerState === 'baseUnconfirmed')) {
              effectiveState = 'baseStale';
              effectiveReason = 'headRevisionChanged';
            }
            handlers.onUpdate(Object.freeze({ readerState: effectiveState, reason: effectiveReason, fromCache: fromCache, hasPendingWrites: hasPendingWrites, templateSubject: frozenSubject }));
          }

          if (!snap.exists) {
            emit('baseUnreadable', 'templateSubjectMissing', null);
            return;
          }
          var data;
          try {
            data = snap.data();
          } catch (dataErr) {
            emit('baseUnreadable', 'snapshotDataThrew', null);
            return;
          }
          if (!data || data.recordType !== 'planTemplateSubject' || data.templateId !== templateId || data.ownerUid !== auth.currentUid ||
            typeof data.headRevisionId !== 'string' || !data.headRevisionId || typeof data.lifecycleState !== 'string' ||
            typeof data.headSequence !== 'number' || typeof data.headManifestId !== 'string' || !data.headManifestId ||
            // Correction round 3 (source review defect #4): headManifestHash
            // is now required and shape-checked here too, matching every
            // other member of the head tuple.
            typeof data.headManifestHash !== 'string' || !data.headManifestHash ||
            typeof data.headOperationId !== 'string' || !data.headOperationId ||
            typeof data.headGatewayId !== 'string' || !data.headGatewayId) {
            emit('baseUnreadable', 'malformedTemplateSubject', data || null);
            return;
          }

          // Correction round (source review defect #6): cache/pending-write
          // snapshot metadata is evaluated BEFORE lifecycle or head-tuple
          // comparison -- an unconfirmed (local-only) snapshot is never
          // allowed to report baseTerminated/baseStale/baseCurrent on the
          // strength of data the server hasn't actually confirmed yet.
          if (fromCache || hasPendingWrites) {
            emit('baseUnconfirmed', fromCache ? 'snapshotFromCache' : 'snapshotHasPendingWrites', data);
            return;
          }
          if (data.lifecycleState !== 'active') {
            emit('baseTerminated', 'templateNotActive', data);
            return;
          }
          // Correction round 3 (source review defect #4): every baseline
          // field is now unconditionally required (validated at
          // construction, above), so every member of the tuple is always
          // compared -- there is no more "not supplied, skip this
          // comparison" branch, and baseCurrent can therefore never be
          // reported without a complete basis.
          var tupleChanged = data.headRevisionId !== baselineRevisionId ||
            data.headSequence !== baselineSequence ||
            data.headManifestId !== baselineManifestId ||
            data.headManifestHash !== baselineManifestHash ||
            data.headOperationId !== baselineOperationId ||
            data.headGatewayId !== baselineGatewayId;
          if (tupleChanged) {
            emit('baseStale', 'headRevisionChanged', data);
            return;
          }
          emit('baseCurrent', null, data);
        },
        error: function (err) {
          if (closed) return;
          handlers.onUpdate(Object.freeze({ readerState: 'baseUnreadable', reason: 'listenerError', fromCache: false, hasPendingWrites: false, templateSubject: null, error: classifyReaderTransactionFailure(err) }));
        }
      });
      var unsubscribeOnce = function () {
        if (closed) return;
        closed = true;
        rawUnsubscribe();
      };
      return Object.freeze({ unsubscribe: unsubscribeOnce });
    }

    // ---- reconcileTemplateSummary(input) ----
    // input: { ownerUid, templateId }. Current-only (reconciling a historical
    // revision's projection is not part of Slice 4's scope). Runs the same
    // bounded exact-read-then-profile assembly as readCanonicalTemplate(mode:
    // 'profile'), plus one additional read of the existing planTemplateSummary
    // doc, all inside the same single transaction attempt, then classifies
    // and (only when applicable) builds a non-executable reconciliation
    // blueprint. Never writes -- no transaction.set is ever called here.
    async function reconcileTemplateSummary(input) {
      var auth = requireAuthenticatedOwner(input, 'reconcileTemplateSummary');
      var templateId = input.templateId;
      if (typeof templateId !== 'string' || !templateId) {
        throw new CanonicalPlanReaderIntegrityError('reconcileTemplateSummary: input.templateId is required');
      }

      try {
        return await runTransactionFn(async function (transaction) {
          var assembled = await assembleTemplateReadDocs(transaction, auth.currentUid, templateId, null, gates);
          // Correction round (source review defect #2): the existing
          // summary projection doc is now read BEFORE the verified profile
          // is built -- every read this operation performs happens before
          // any reconstruction/comparison work, matching the "read
          // everything, then judge" ordering the rest of the reader suite
          // already follows.
          var summaryRef = readerResolveDocRef('planTemplateSummary', templateId, auth.currentUid, 'reconcileTemplateSummary: projectionRef');
          var summarySnap = await transaction.get(summaryRef);
          var summaryDoc = summarySnap.exists ? summarySnap.data() : null;
          var profileResult = planBuildCanonicalTemplateProfileFn(assembled);
          var classification = planClassifyTemplateSummaryProjectionFn(profileResult, summaryDoc);
          var blueprint = planBuildTemplateSummaryReconciliationBlueprintFn(profileResult, classification);
          return Object.freeze({ verifiedResult: profileResult, classification: classification, blueprint: blueprint });
        });
      } catch (err) {
        // Correction round (source review defect #2): a genuinely transient
        // transport/transaction failure is returned as the approved
        // retryableFailure outcome, not thrown. Every other failure kind
        // continues to reject the call, unchanged.
        return classifyReaderCallFailure(err);
      }
    }

    return Object.freeze({
      listTemplateSummariesPage: listTemplateSummariesPage,
      subscribeTemplateSummariesFirstPage: subscribeTemplateSummariesFirstPage,
      readCanonicalTemplate: readCanonicalTemplate,
      watchCanonicalTemplateHead: watchCanonicalTemplateHead,
      reconcileTemplateSummary: reconcileTemplateSummary
    });
  }

  // ---- The disabled reader gate. Intentionally unusable, exactly mirroring
  // fsPlanCommitCanonicalPackage's disabled-writer pattern immediately below:
  // it exists only to establish that a guarded entry point checking
  // CANONICAL_PLAN_READ_CAPABILITY_ENABLED first, before anything else,
  // behaves correctly -- proof the Node-only harness can exercise directly.
  // It is NOT added to the seven-key publicSurface (Slice 4 authorizes no new
  // browser-visible entry point at all); it is exposed solely under the
  // guarded __test surface further below. `args` is bound as a parameter but
  // never referenced anywhere in this function body -- no property, getter,
  // proxy trap, iterator, or serialization method on it is ever touched, so
  // rejection happens before any inspection of the argument, before auth,
  // before the registry, before schema-authority access, before any
  // query/transaction/listener is created, and before any pure-reader-helper
  // is called. The real reader suite above (buildCanonicalPlanReaderSuite) is
  // never bound to or called from this function -- it remains reachable only
  // through the Node-only __test surface, structurally absent from a real
  // browser load.
  async function canonicalPlanReaderDisabledGate(args) {
    if (!CANONICAL_PLAN_READ_CAPABILITY_ENABLED) {
      throw new CanonicalPlanReaderDisabledError();
    }
    throw new CanonicalPlanReaderDisabledError();
  }

  // ==================== SLICE 5A -- dormant delegation wiring ====================
  // Round-2 correction §4/§4.5-4.6 (accepted contract:
  // slice5a-bridge-creation-spec-round12.md). commitCanonicalPackage below
  // and the new fsPlanReadCanonicalTemplate further down are rewritten from
  // an unconditional double-throw into a TRUE flag-conditional: while
  // disabled (always, in this slice) both still fail exactly as before --
  // same typed error, same zero-inspection-of-the-argument, same zero
  // registry/Firestore access; the `true` branch (never executed while both
  // capability constants stay their hardcoded `false`) delegates to the
  // already-accepted private executor/reader-suite rather than continuing
  // to throw unconditionally.
  //
  // Ordering note (round-2 correction requirement 2): firebase.js loads and
  // executes its top-level code BEFORE app-plan.js, as classic <script> tags
  // (index.html) -- the same load-order constraint this file's own
  // COMMIT_SAFETY_CAPS comment already documents independently, above. The
  // two production dependency-builder functions immediately below are safe
  // to DEFINE here (at firebase.js's own module-load time) because every
  // reference to an app-plan.js global inside them (planBuildTemplateCommitWrites,
  // PlanCommitBlockedError, planValidateCanonicalTemplateRead, and so on) is
  // an ordinary identifier reference inside a nested function body -- it is
  // never EVALUATED until that nested function actually runs, which can only
  // happen from inside the `enabled` branch of the dispatch helpers below,
  // themselves only reachable through a real call to
  // commitCanonicalPackage/fsPlanReadCanonicalTemplate. No UI code anywhere
  // calls either of those before every script (including app-plan.js) has
  // finished loading and executing, so by the time either builder function
  // is actually CALLED, every app-plan.js global it references already
  // exists. Confirmed against source: fsDb (`firebase.firestore()`, line 12)
  // and auth (`firebase.auth()`, line 11) are the production Firestore/auth
  // handles already used by every legacy Firestore function in this file
  // (fsSet/fsDel and neighbors, ~line 61+); firebase.firestore.FieldValue is
  // the compat-SDK namespaced server-timestamp source matching the
  // firebase-firestore-compat.js 9.22.0 script index.html loads.
  function buildProductionCanonicalCommitDeps() {
    return {
      runTransaction: function (updateFn) { return fsDb.runTransaction(updateFn); },
      serverTimestamp: function () { return firebase.firestore.FieldValue.serverTimestamp(); },
      getCurrentUid: function () { return (auth.currentUser && auth.currentUser.uid) || null; },
      planBuildTemplateCommitWrites: planBuildTemplateCommitWrites,
      isPlanCommitBlockedError: function (e) { return e instanceof PlanCommitBlockedError; }
    };
  }

  function buildProductionCanonicalReaderDeps() {
    return {
      runTransaction: function (updateFn) { return fsDb.runTransaction(updateFn); },
      getCurrentUid: function () { return (auth.currentUser && auth.currentUser.uid) || null; },
      onSnapshot: function (ref, handlers) { return ref.onSnapshot(handlers); },
      planValidateCanonicalTemplateRead: planValidateCanonicalTemplateRead,
      planBuildCanonicalTemplateProfile: planBuildCanonicalTemplateProfile,
      planBuildCanonicalTemplateEditSession: planBuildCanonicalTemplateEditSession,
      planClassifyTemplateSummaryProjection: planClassifyTemplateSummaryProjection,
      planBuildTemplateSummaryReconciliationBlueprint: planBuildTemplateSummaryReconciliationBlueprint,
      planReaderGateSchemaAuthority: planReaderGateSchemaAuthority,
      planReaderGateTemplateSubjectForDiscovery: planReaderGateTemplateSubjectForDiscovery,
      planReaderGateTemplateRevisionForDiscovery: planReaderGateTemplateRevisionForDiscovery,
      planReaderGateOperationGatewayForDiscovery: planReaderGateOperationGatewayForDiscovery,
      planReaderGateManifestRootForDiscovery: planReaderGateManifestRootForDiscovery,
      planReaderGateManifestChunkForDiscovery: planReaderGateManifestChunkForDiscovery,
      planReaderGateManifestEntryForDiscovery: planReaderGateManifestEntryForDiscovery
    };
  }

  // ---- Internal dispatch helpers (round-2 correction requirement 3).
  // Neither function has any opinion of its own about what "enabled" should
  // be -- each is handed an explicit boolean and an explicit deps-builder
  // function, and only routes based on them. The two PRODUCTION public
  // functions (commitCanonicalPackage, fsPlanReadCanonicalTemplate, both
  // below) are the ONLY real callers, and they always pass the real
  // hardcoded capability constant plus the real production deps-builder --
  // never anything else ("the production browser functions must still
  // derive enabled state exclusively from their hardcoded capability
  // constants"). The Node-only __test seam further below calls these exact
  // same two functions with an injected boolean and injected fake deps, so
  // the identical branching logic is exercised by both the real (always
  // disabled) production path and by tests proving the true-branch
  // delegation is correct -- without ever touching, reading, or overriding
  // CANONICAL_PLAN_WRITE_CAPABILITY_ENABLED / CANONICAL_PLAN_READ_CAPABILITY_ENABLED
  // themselves (round-2 correction requirement 4: no mutable override,
  // query parameter, global setter, or local-storage switch exists anywhere
  // in this file; the only seam is the guarded, Node-only __test object).
  async function dispatchCanonicalCommit(enabled, buildDeps, packageValue) {
    if (!enabled) {
      throw new CanonicalPlanWriterDisabledError();
    }
    var executor = buildCanonicalCommitExecutor(buildDeps());
    return executor.commit(packageValue);
  }

  async function dispatchCanonicalTemplateRead(enabled, buildDeps, input) {
    if (!enabled) {
      throw new CanonicalPlanReaderDisabledError();
    }
    validateFsPlanReadCanonicalTemplateInput(input);
    var suite = buildCanonicalPlanReaderSuite(buildDeps());
    return suite.readCanonicalTemplate({ ownerUid: input.ownerUid, templateId: input.templateId, mode: 'editSession' });
  }

  // ---- Strict input contract for fsPlanReadCanonicalTemplate (round-2
  // correction requirement 1; tightened by the Slice 5A completion
  // correction requirement 3; the prototype check itself tightened again
  // by the Slice 5A editor-completion correction requirement 4). Exactly
  // { ownerUid, templateId }, both required non-empty strings -- no other
  // key tolerated, silently or otherwise. Runs only inside the `enabled`
  // branch above, mirroring commitCanonicalPackage's existing rule that the
  // disabled branch never inspects its argument at all.
  //
  // The original version used Object.keys() + Array.isArray(), which left
  // several shapes able to pass despite not being a genuine plain object
  // with exactly these two keys:
  //   - a class/constructor instance (own prototype, not Object.prototype)
  //   - an Object.create(null) instance (no prototype at all)
  //   - a non-enumerable extra own property (Object.keys skips it silently)
  //   - a symbol-keyed extra own property (Object.keys never sees symbols)
  //   - an accessor (getter/setter) standing in for ownerUid/templateId,
  //     which could read as a valid string on first access yet return a
  //     different value or have a side effect on a later access
  // Every one of these is now rejected explicitly, before either value is
  // read for its content.
  //
  // Prototype check (editor-completion correction requirement 4): this is
  // now the strict referential check `Object.getPrototypeOf(input) ===
  // Object.prototype`, replacing a shape-based check (depth-from-a-root-
  // prototype) an earlier correction round used instead. That shape-based
  // version was a test-convenience compromise: it was adopted specifically
  // to avoid a false rejection this suite's OWN cross-realm test
  // construction produced (a plain object literal built in the Node
  // require() realm, checked from code running inside firebase.js's
  // separate vm.createContext() realm, has a different Object.prototype
  // identity even though it is a perfectly ordinary object). That was the
  // wrong place to absorb the mismatch. In the real browser there is
  // exactly one realm -- no iframe, worker, or vm boundary anywhere in this
  // single-page app -- so the public caller (app-plan.js's
  // planCanonicalEditorBuildProductionCtx, calling
  // fsPlanPersistence.fsPlanReadCanonicalTemplate directly) and this
  // function always already share one Object.prototype; the referential
  // check is exactly correct for production and strictly tighter than the
  // shape-based version (which additionally, if only in principle, would
  // have accepted an object whose custom prototype's OWN prototype
  // happened to be null, one level deeper than a real Object.create(null)
  // -- the referential check has no such gap). The test suite is
  // responsible for matching that single-realm reality, not this function:
  // every Category A input below is now constructed inside the same vm
  // context firebase.js itself runs in (see buildRealmValue / rig.context).
  function validateFsPlanReadCanonicalTemplateInput(input) {
    if (input === null || typeof input !== 'object') {
      throw new CanonicalPlanReaderIntegrityError('fsPlanReadCanonicalTemplate: input must be a plain object with exactly { ownerUid, templateId }');
    }
    if (Object.getPrototypeOf(input) !== Object.prototype) {
      throw new CanonicalPlanReaderIntegrityError('fsPlanReadCanonicalTemplate: input must be an ordinary plain object (not an array, class instance, or prototype-less object)');
    }
    if (Object.getOwnPropertySymbols(input).length !== 0) {
      throw new CanonicalPlanReaderIntegrityError('fsPlanReadCanonicalTemplate: input must not carry any symbol-keyed properties');
    }
    // getOwnPropertyNames (unlike Object.keys) also reports a non-enumerable
    // own property, so a hidden extra key cannot slip past this check.
    var ownNames = Object.getOwnPropertyNames(input).slice().sort();
    if (ownNames.length !== 2 || ownNames[0] !== 'ownerUid' || ownNames[1] !== 'templateId') {
      throw new CanonicalPlanReaderIntegrityError('fsPlanReadCanonicalTemplate: input must have exactly the two own properties ownerUid and templateId -- got [' + ownNames.join(', ') + ']');
    }
    ['ownerUid', 'templateId'].forEach(function (key) {
      var desc = Object.getOwnPropertyDescriptor(input, key);
      if (!desc || !Object.prototype.hasOwnProperty.call(desc, 'value') || typeof desc.get === 'function' || typeof desc.set === 'function') {
        throw new CanonicalPlanReaderIntegrityError('fsPlanReadCanonicalTemplate: input.' + key + ' must be an ordinary data property, not an accessor');
      }
    });
    if (typeof input.ownerUid !== 'string' || !input.ownerUid) {
      throw new CanonicalPlanReaderIntegrityError('fsPlanReadCanonicalTemplate: input.ownerUid is required and must be a non-empty string');
    }
    if (typeof input.templateId !== 'string' || !input.templateId) {
      throw new CanonicalPlanReaderIntegrityError('fsPlanReadCanonicalTemplate: input.templateId is required and must be a non-empty string');
    }
  }

  // ---- fsPlanReadCanonicalTemplate(input) ----
  // The eighth public key (round-2 correction §1-2, Blocker 1 resolved via
  // option (a)). Delegates to the already-accepted reader suite's
  // readCanonicalTemplate() in 'editSession' mode -- one of that function's
  // three existing accepted modes, not a new one -- which returns the exact
  // { outcome, draft, canonicalBase, readerState } shape
  // planAdaptCanonicalDraftToEditorState needs. Exposes no reader factory,
  // no arbitrary path/record-type/owner override, no pagination, and no
  // listener -- only this one bounded, owner-scoped Template read.
  async function fsPlanReadCanonicalTemplate(input) {
    return dispatchCanonicalTemplateRead(CANONICAL_PLAN_READ_CAPABILITY_ENABLED, buildProductionCanonicalReaderDeps, input);
  }

  // ---- fsPlanCommitCanonicalPackage(packageValue) ----
  // The disabled writer gate (spec §13; Slice 3 spec Part 2). Intentionally
  // unusable: it exists only to establish the future awaited API shape
  // without making canonical persistence possible. Slice 3 adds exactly one
  // check -- the private immutable CANONICAL_PLAN_WRITE_CAPABILITY_ENABLED
  // constant declared above, checked FIRST, before anything else. `packageValue`
  // is bound as a parameter but never referenced anywhere in this function
  // body -- no property, getter, proxy trap, iterator, or serialization
  // method on it is ever touched, so rejection happens before any inspection
  // of the argument, before auth, before the registry, before Firestore, and
  // before the pure model. No Firestore reference is constructed and no
  // Firestore method is invoked. There is no argument, appDb value, global
  // variable, localStorage value, URL flag, build global, exported property,
  // or caller mutation that can make this resolve instead of reject -- the
  // disabled state is a plain closure constant, never read from anything
  // caller-reachable, and there is no code path anywhere in this file that
  // ever sets it to `true`.
  //
  // Round-2 correction (§4.5-4.6, requirement 3): previously this function's
  // body unconditionally threw twice in a row -- CANONICAL_PLAN_WRITE_CAPABILITY_ENABLED
  // being flipped to `true` in source would not, by itself, have changed
  // browser behavior at all, because the real Slice 3 executor
  // (buildCanonicalCommitExecutor) was never bound to or called from this
  // function. It now delegates to the shared dispatchCanonicalCommit helper
  // above, which performs the identical disabled-branch behavior (same
  // typed error, same zero-inspection-of-packageValue, same zero registry/
  // Firestore access -- see test evidence in the Slice 5A source-change
  // report) while ALSO defining, for the first time, what the `true` branch
  // does: delegate to the real executor with real production dependencies.
  // That branch is still never executed in this slice -- both capability
  // constants remain hardcoded `false` -- and it remains reachable only via
  // this same public function, exactly as before.
  async function commitCanonicalPackage(packageValue) {
    return dispatchCanonicalCommit(CANONICAL_PLAN_WRITE_CAPABILITY_ENABLED, buildProductionCanonicalCommitDeps, packageValue);
  }

  // Approved public methods (spec §7 pseudocode; extended by Slice 5A, round-2
  // correction §1). This is the COMPLETE object in a real browser: `module`
  // does not exist there, so the guard below never adds anything else to it.
  // In any real <script>-tag load, fsPlanPersistence therefore has exactly
  // these EIGHT keys, no more -- seven from Slice 2-4 plus
  // fsPlanReadCanonicalTemplate, added by Slice 5A's round-2 correction
  // (Blocker 1, option (a): "Slice 5A introduces the first browser workflow
  // that genuinely needs canonical reading, so this is the correct point to
  // expand the surface deliberately").
  var publicSurface = {
    fsPlanInitCanonicalReferences: initCanonicalReferences,
    fsPlanGetCanonicalCollection: getCanonicalCollection,
    fsPlanGetCanonicalDocumentRef: getCanonicalDocumentRef,
    fsPlanResolveCanonicalDocumentRef: resolveCanonicalDocumentRef,
    fsPlanGetSchemaAuthorityRef: getSchemaAuthorityRef,
    fsPlanCommitCanonicalPackage: commitCanonicalPackage,
    fsPlanReadCanonicalTemplate: fsPlanReadCanonicalTemplate,
    CanonicalPlanWriterDisabledError: CanonicalPlanWriterDisabledError
  };

  // Round-1 source review correction: this used to be an unconditional member
  // of the object above, which meant it existed in the real browser runtime
  // too (module.exports being guarded elsewhere in the file didn't help --
  // this assignment ran regardless). It now uses the exact same `typeof
  // module !== 'undefined' && module.exports` guard the file's own Node
  // export block uses, evaluated here at construction time, so a real
  // browser load (where `module` is genuinely undefined) never adds this key
  // at all. Both members are read-only and reveal no owner identity or live
  // reference data -- a frozen static schema map, and a boolean for whether
  // any registry currently exists -- but they are still kept out of the
  // approved seven-key production surface entirely, on principle.
  if (typeof module !== 'undefined' && module.exports) {
    publicSurface.__test = Object.freeze({
      canonicalRecordTypeCollectionMap: Object.freeze(Object.assign({}, CANONICAL_COLLECTION_MAP)),
      hasRegistry: function () { return registry !== null; },
      // Slice 3 Node-only test seam (spec Part 3 / §10). Exposes only bounded
      // construction/execution helpers and immutable static metadata required
      // to prove the approved specification -- never the live registry
      // contents, never a mutable capability switch, never a browser-callable
      // bypass. buildCanonicalCommitExecutor is the ONLY way to obtain a
      // callable executor; it must be supplied every dependency explicitly by
      // the caller (see its own comment above) and is never invoked from
      // anywhere else in this file.
      buildCanonicalCommitExecutor: buildCanonicalCommitExecutor,
      isWriteCapabilityEnabled: function () { return CANONICAL_PLAN_WRITE_CAPABILITY_ENABLED; },
      commitSafetyCaps: Object.freeze(Object.assign({}, COMMIT_SAFETY_CAPS)),
      timestampPlaceholder: TIMESTAMP_PLACEHOLDER,
      // Correction defect 3: exposes the independent canonical-encoding byte
      // estimator so the standalone harness can cross-check it, value for
      // value, against the real exported Slice 1 planBuildCanonicalEncoding/
      // planEstimateDocBytes -- proving this is genuinely the SAME byte
      // semantics, not merely a same-shaped but divergent reimplementation.
      fsBuildCanonicalEncoding: fsBuildCanonicalEncoding,
      fsEstimateCanonicalDocBytes: fsEstimateCanonicalDocBytes,
      // Correction round 2, defect 1: exposes the raw UTF-8 byte-length
      // primitive directly, so the standalone harness can cross-check the
      // byte-counting algorithm itself (ASCII, multibyte, valid surrogate
      // pairs, and malformed/unpaired surrogates) against an independent
      // authoritative oracle on plain strings, separately from the
      // canonical-encoding step already cross-checked above.
      utf8ByteLength: utf8ByteLength,
      CanonicalPlanCommitBlockedError: CanonicalPlanCommitBlockedError,
      CanonicalPlanCommitIntegrityError: CanonicalPlanCommitIntegrityError,
      CanonicalPlanCommitAuthorizationError: CanonicalPlanCommitAuthorizationError,
      CanonicalPlanCommitUnavailableError: CanonicalPlanCommitUnavailableError,
      CanonicalPlanCommitPersistenceError: CanonicalPlanCommitPersistenceError,
      // ---- Slice 4 (Canonical PLAN Verified Readers and Projection
      // Reconciliation) Node-only test seam. Mirrors the Slice 3 seam above
      // in every structural respect -- never the live registry contents,
      // never a mutable capability switch, never a browser-callable bypass.
      // buildCanonicalPlanReaderSuite is the ONLY way to obtain a callable
      // reader suite; it must be supplied every dependency explicitly by the
      // caller and is never invoked from anywhere else in this file.
      CanonicalPlanReaderDisabledError: CanonicalPlanReaderDisabledError,
      isReadCapabilityEnabled: function () { return CANONICAL_PLAN_READ_CAPABILITY_ENABLED; },
      canonicalPlanReaderDisabledGate: canonicalPlanReaderDisabledGate,
      buildCanonicalPlanReaderSuite: buildCanonicalPlanReaderSuite,
      readerSafetyCaps: Object.freeze(Object.assign({}, READER_SAFETY_CAPS)),
      templateSummaryPageSize: TEMPLATE_SUMMARY_PAGE_SIZE,
      revisionToSubjectRecordType: Object.freeze(Object.assign({}, REVISION_TO_SUBJECT_RECORD_TYPE)),
      CanonicalPlanReaderIntegrityError: CanonicalPlanReaderIntegrityError,
      CanonicalPlanReaderAuthorizationError: CanonicalPlanReaderAuthorizationError,
      CanonicalPlanReaderUnavailableError: CanonicalPlanReaderUnavailableError,
      CanonicalPlanReaderPersistenceError: CanonicalPlanReaderPersistenceError,
      // ---- Slice 5A (round-2 correction §4.5/§4.6, requirement 3-4)
      // Node-only test seam. These call the SAME dispatchCanonicalCommit /
      // dispatchCanonicalTemplateRead functions the real, always-flag-derived
      // public functions call -- but with an explicitly injected `enabled`
      // boolean and explicitly injected (fake-Firestore-backed) deps, so a
      // test can exercise the `true` branch's delegation to the real
      // executor/reader-suite without ever touching, reading, or overriding
      // CANONICAL_PLAN_WRITE_CAPABILITY_ENABLED / CANONICAL_PLAN_READ_CAPABILITY_ENABLED.
      // Confined to this guarded, Node-only __test object -- absent in a
      // real browser load, per the same `typeof module` guard as everything
      // else here (requirement 4: no browser-reachable bypass of any kind).
      dispatchCanonicalCommitForTest: function (enabled, deps, packageValue) {
        return dispatchCanonicalCommit(enabled, function () { return deps; }, packageValue);
      },
      dispatchCanonicalTemplateReadForTest: function (enabled, deps, input) {
        return dispatchCanonicalTemplateRead(enabled, function () { return deps; }, input);
      },
      validateFsPlanReadCanonicalTemplateInput: validateFsPlanReadCanonicalTemplateInput
    });
  }

  return Object.freeze(publicSurface);
})();

// Round-2 source review correction: each of these six was previously a plain
// top-level `function` declaration -- an ordinary, writable global-object
// property, reassignable from anywhere after this script finishes loading.
// They are now `const` bindings holding a function expression instead, for
// the same reason fsPlanPersistence above is now `const`: no caller, anywhere,
// can repoint what these names resolve to. Each still permanently delegates
// to fsPlanPersistence -- itself now equally non-replaceable -- so there is no
// remaining path from client-controlled state to a forged writer or a forged
// accessor result.
const fsPlanInitCanonicalReferences = function (uid) { return fsPlanPersistence.fsPlanInitCanonicalReferences(uid); };
const fsPlanGetCanonicalCollection = function (recordType, expectedUid) { return fsPlanPersistence.fsPlanGetCanonicalCollection(recordType, expectedUid); };
const fsPlanGetCanonicalDocumentRef = function (recordType, recordId, expectedUid) { return fsPlanPersistence.fsPlanGetCanonicalDocumentRef(recordType, recordId, expectedUid); };
const fsPlanResolveCanonicalDocumentRef = function (descriptor, expectedUid) { return fsPlanPersistence.fsPlanResolveCanonicalDocumentRef(descriptor, expectedUid); };
const fsPlanGetSchemaAuthorityRef = function () { return fsPlanPersistence.fsPlanGetSchemaAuthorityRef(); };
const fsPlanCommitCanonicalPackage = function (packageValue) { return fsPlanPersistence.fsPlanCommitCanonicalPackage(packageValue); };
const fsPlanReadCanonicalTemplate = function (input) { return fsPlanPersistence.fsPlanReadCanonicalTemplate(input); };

// -----------------------------------------------------------------------------
// Guarded Node test surface (Slice 2 authorized item 7). `module` does not
// exist in the browser, so this entire block is a no-op there and changes no
// browser behavior. It exists only so the standalone local mock harness can
// require() this file inside a VM sandbox and reach the Slice 2 surface, plus
// a few narrow, explicitly-labeled hooks proving the pre-existing legacy
// collection-initialization flow is unchanged by this addition.
// -----------------------------------------------------------------------------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    fsPlanPersistence: fsPlanPersistence,
    fsPlanInitCanonicalReferences: fsPlanInitCanonicalReferences,
    fsPlanGetCanonicalCollection: fsPlanGetCanonicalCollection,
    fsPlanGetCanonicalDocumentRef: fsPlanGetCanonicalDocumentRef,
    fsPlanResolveCanonicalDocumentRef: fsPlanResolveCanonicalDocumentRef,
    fsPlanGetSchemaAuthorityRef: fsPlanGetSchemaAuthorityRef,
    fsPlanCommitCanonicalPackage: fsPlanCommitCanonicalPackage,
    CanonicalPlanWriterDisabledError: fsPlanPersistence.CanonicalPlanWriterDisabledError,
    __testGetLegacyCollections: function () {
      return {
        COL_WORKOUTS: COL_WORKOUTS, COL_PROGRAMS: COL_PROGRAMS, COL_CUSTOM_EX: COL_CUSTOM_EX,
        COL_META: COL_META, COL_EX_NOTES: COL_EX_NOTES, COL_IMPORTED_SETS: COL_IMPORTED_SETS,
        COL_EX_VIDEOS: COL_EX_VIDEOS, COL_EX_OVERRIDES: COL_EX_OVERRIDES,
        COL_EX_COLLECTIONS: COL_EX_COLLECTIONS, COL_EX_COLLECTION_MEMBERSHIP: COL_EX_COLLECTION_MEMBERSHIP
      };
    },
    __testInitCollections: initCollections,
    __testGetPersistenceReady: function () { return persistenceReady; }
  };
}
