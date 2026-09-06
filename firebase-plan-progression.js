(function (root) {
  'use strict';
  // Slice 5B remains dormant until a separate, explicit activation review.
  const CANONICAL_PLAN_PROGRESSION_CAPABILITY_ENABLED = false;
  const STATE_COLLECTION = 'planProgressionState';
  const APPLICATION_COLLECTION = 'planProgressionApplications';
  const STATE_KEYS = ['createdAt','currentValue','exerciseId','initializationSource','lastEvaluatedAt','lastProcessedWorkoutId','needsManualReviewReason','ownerUid','planAssignmentId','planRuleId','planTemplateId','ruleRevisionId','schemaVersion','status','updatedAt'];
  const VALUE_KEYS = ['amount','kind','unit'];
  const REVIEW_REASONS = ['assignmentIdentityMismatch','ruleChangedSinceState','adjustmentTypeChanged','notEvaluable'];
  // Correction round 1 (finding 3): the accepted four-field application-
  // receipt shape, named here so it can actually be validated instead of
  // merely checked for existence.
  const APPLICATION_KEYS = ['appliedAt','ownerUid','planRuleId','workoutId'];

  class CanonicalProgressionWriterDisabledError extends Error { constructor(){super('Canonical progression persistence is disabled.');this.name='CanonicalProgressionWriterDisabledError';} }
  function exact(o,keys){return !!o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join('\n')===keys.slice().sort().join('\n');}
  // Correction round 1 (finding 2): strengthened to also reject NUL bytes
  // and leading/trailing whitespace padding, not just '/' and '\\' -- the
  // same "accepted identifier precedent" app-plan.js's planProgressionId is
  // strengthened with in this same correction round.
  // Correction round 2 (finding 3): additionally rejects '.', '..', '?',
  // '#', and case-insensitive '%2f'/'%5c' -- the same categories the
  // accepted firebase.js isValidRecordId precedent rejects -- on top of the
  // existing empty/overlong/slash/backslash/NUL/whitespace-padding checks
  // and the Slice 5B-specific 200-character bound. Kept byte-for-byte
  // consistent with app-plan.js's own planProgressionId so the two copies
  // cannot silently drift.
  function id(v){
    if(typeof v!=='string'||v.length===0||v.length>200)return false;
    if(v!==v.trim())return false;
    if(/[\/\\\x00]/.test(v))return false;
    if(v==='.'||v==='..')return false;
    if(v.indexOf('?')!==-1||v.indexOf('#')!==-1)return false;
    var lv=v.toLowerCase();
    if(lv.indexOf('%2f')!==-1||lv.indexOf('%5c')!==-1)return false;
    return true;
  }
  function timestamp(v){return !!v&&typeof v==='object'&&Number.isInteger(v.seconds)&&Number.isInteger(v.nanoseconds)&&v.nanoseconds>=0&&v.nanoseconds<1e9;}
  function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
  function stateValid(v){
    if(!exact(v,STATE_KEYS)||!exact(v.currentValue,VALUE_KEYS))return false;
    if(!['workingLoad','trainingMax'].includes(v.currentValue.kind)||typeof v.currentValue.amount!=='number'||!Number.isFinite(v.currentValue.amount)||!['lb','kg'].includes(v.currentValue.unit))return false;
    if(!['active','needsManualReview'].includes(v.status)||!['manual','confirmedFromSuggestion'].includes(v.initializationSource)||v.schemaVersion!==1)return false;
    if(v.status==='active'&&v.needsManualReviewReason!==null)return false;
    if(v.status==='needsManualReview'&&!REVIEW_REASONS.includes(v.needsManualReviewReason))return false;
    if(![v.ownerUid,v.planTemplateId,v.planAssignmentId,v.planRuleId,v.ruleRevisionId,v.exerciseId].every(id))return false;
    return timestamp(v.createdAt)&&timestamp(v.updatedAt)&&(v.lastEvaluatedAt===null||timestamp(v.lastEvaluatedAt))&&(v.lastProcessedWorkoutId===null||id(v.lastProcessedWorkoutId));
  }
  function token(v){return {seconds:v.seconds,nanoseconds:v.nanoseconds};}
  function sameTime(a,b){return timestamp(a)&&timestamp(b)&&a.seconds===b.seconds&&a.nanoseconds===b.nanoseconds;}
  // Correction round 1 (finding 2): a bare '__'-delimited concatenation let
  // two different (planRuleId, workoutId) pairs collide on the same
  // document id whenever the delimiter itself could appear inside either
  // component. Both components are now independently validated as bounded,
  // path-safe, non-empty identifiers first (never coerced from a
  // non-string) -- and the id itself is the SHA-256 hex digest of the
  // canonical encoding of the exact pair, reusing the already-accepted,
  // already-tested app-plan.js canonical-encoding/hash primitives (the same
  // ones every manifest chunk id in the canonical Plan system already uses,
  // app-plan.js:1318/1491). Canonical encoding quotes and separates fields
  // by key, never by a bare delimiter that could appear inside a value, so
  // two different pairs can never encode to the same string -- collision
  // resistance therefore reduces to SHA-256's, not to any delimiter rule.
  // The result is a pure function of the pair: identical inputs always
  // resolve to the same id, so a retry lands on the same document.
  function applicationId(ruleId,workoutId){
    if(!id(ruleId)||!id(workoutId))return null;
    if(typeof root.planBuildCanonicalEncoding!=='function'||typeof root.planSha256Hex!=='function')return null;
    return root.planSha256Hex(root.planBuildCanonicalEncoding({planRuleId:ruleId,workoutId:workoutId}));
  }
  // Correction round 1 (finding 3): a structurally well-formed document can
  // still be the WRONG document -- cross-owner leakage, or a stale/foreign
  // planRuleId sitting at this exact path. This is checked separately from
  // stateValid (which only knows a document's own internal shape, never
  // what path/request it was supposed to answer) and is always treated as
  // an integrity problem (stateIntegrityConflict), never downgraded into an
  // ordinary "Program changed" needsManualReview write.
  function statePathIdentityOk(data,expectedOwnerUid,expectedPlanRuleId){
    return data.ownerUid===expectedOwnerUid&&data.planRuleId===expectedPlanRuleId;
  }
  // Correction round 1 (finding 3): an application record's mere existence
  // at a path is no longer sufficient -- its complete four-field schema and
  // its identity agreement with the exact request are both required before
  // it can ever be treated as a real, trustworthy receipt.
  function applicationRecordValid(v){
    return exact(v,APPLICATION_KEYS)&&id(v.ownerUid)&&id(v.planRuleId)&&id(v.workoutId)&&timestamp(v.appliedAt);
  }
  function applicationRecordIdentityOk(data,expectedOwnerUid,expectedPlanRuleId,expectedWorkoutId){
    return data.ownerUid===expectedOwnerUid&&data.planRuleId===expectedPlanRuleId&&data.workoutId===expectedWorkoutId;
  }
  function validateManualInput(input){
    var common=['amount','expectedUpdatedAt','initializationSource','kind','mode','planRuleId','schemaVersion','unit'];
    if(!exact(input,common)||!['initialize','correct'].includes(input.mode)||!id(input.planRuleId)||!['workingLoad','trainingMax'].includes(input.kind)||typeof input.amount!=='number'||!Number.isFinite(input.amount)||!['lb','kg'].includes(input.unit)||!['manual','confirmedFromSuggestion'].includes(input.initializationSource)||input.schemaVersion!==1)return false;
    return input.mode==='initialize'?input.expectedUpdatedAt===null:timestamp(input.expectedUpdatedAt);
  }

  function createPersistence(deps,enabled){
    var ownerUid=null;
    function disabled(){if(!enabled)throw new CanonicalProgressionWriterDisabledError();}
    function references(uid){return {statePath:'users/'+uid+'/'+STATE_COLLECTION,applicationPath:'users/'+uid+'/'+APPLICATION_COLLECTION};}
    function fsPlanProgressionInitReferences(input){disabled();if(!exact(input,['ownerUid'])||!id(input.ownerUid)||input.ownerUid!==deps.currentUid())return {outcome:'invalidInput'};ownerUid=input.ownerUid;return {outcome:'success',references:references(ownerUid)};}
    function ready(){if(!ownerUid||ownerUid!==deps.currentUid())return false;return true;}
    async function fsPlanProgressionReadState(planRuleId){
      disabled();if(!ready()||!id(planRuleId))return {outcome:'invalidInput'};
      try{var snap=await deps.get(references(ownerUid).statePath+'/'+planRuleId);if(!snap.exists)return {outcome:'notInitialized',reason:'progressionStateMissing'};if(!stateValid(snap.data)||!statePathIdentityOk(snap.data,ownerUid,planRuleId))return {outcome:'stateIntegrityConflict'};return {outcome:'success',state:clone(snap.data),expectedUpdatedAt:token(snap.data.updatedAt)};}catch(e){return {outcome:'uncertain'};}
    }
    async function fsPlanProgressionSetManualState(input,basis){
      disabled();if(!ready()||!validateManualInput(input))return {outcome:'invalidInput',reason:'malformedManualInput'};
      var bv=root.planValidateProgressionBasis(basis);if(!bv.ok)return {outcome:'invalidInput',reason:bv.reason};
      if(input.planRuleId!==basis.planRuleId||input.kind!==(basis.adjustmentType==='addLoad'?'workingLoad':'trainingMax')||basis.ownerUid!==ownerUid)return {outcome:'invalidInput',reason:'identityMismatch'};
      var path=references(ownerUid).statePath+'/'+input.planRuleId;
      try{var outcome=await deps.transaction(async function(tx){var snap=await tx.get(path),now=deps.timestamp();if(snap.exists&&(!stateValid(snap.data)||!statePathIdentityOk(snap.data,ownerUid,input.planRuleId)))return {outcome:'stateIntegrityConflict'};
        if(input.mode==='initialize'){if(snap.exists)return {outcome:'conflict'};tx.set(path,{ownerUid:basis.ownerUid,planTemplateId:basis.planTemplateId,planAssignmentId:basis.planAssignmentId,planRuleId:basis.planRuleId,ruleRevisionId:basis.ruleRevisionId,exerciseId:basis.exerciseId,currentValue:{kind:input.kind,amount:input.amount,unit:input.unit},status:'active',needsManualReviewReason:null,initializationSource:input.initializationSource,lastProcessedWorkoutId:null,lastEvaluatedAt:null,schemaVersion:1,createdAt:now,updatedAt:now});return {outcome:'written'};}
        var s=snap.data;if(!snap.exists)return {outcome:'conflict'};
        if(s.ownerUid!==basis.ownerUid||s.planTemplateId!==basis.planTemplateId||s.planAssignmentId!==basis.planAssignmentId||s.exerciseId!==basis.exerciseId){tx.update(path,{status:'needsManualReview',needsManualReviewReason:'assignmentIdentityMismatch',updatedAt:now});return {outcome:'needsManualReview',reason:'assignmentIdentityMismatch'};}
        if(!sameTime(input.expectedUpdatedAt,s.updatedAt))return {outcome:'conflict'};
        tx.update(path,{currentValue:{kind:input.kind,amount:input.amount,unit:input.unit},ruleRevisionId:basis.ruleRevisionId,status:'active',needsManualReviewReason:null,initializationSource:input.initializationSource,updatedAt:now});return {outcome:'written'};});
        if(outcome.outcome!=='written')return outcome;var reread=await fsPlanProgressionReadState(input.planRuleId);return reread.outcome==='success'?reread:{outcome:'savedButRefreshFailed',planRuleId:input.planRuleId};
      }catch(e){return {outcome:'uncertain'};}
    }
    async function fsPlanProgressionApplyEvaluation(rule,evidence,basis){
      disabled();if(!ready())return {outcome:'invalidInput',reason:'ownerNotInitialized'};
      var valid=root.planValidateProgressionEvaluationInput(rule,evidence,basis);if(!valid.ok)return {outcome:'invalidInput',reason:valid.reason,details:valid.details};
      if(evidence.ownerUid!==ownerUid)return {outcome:'invalidInput',reason:'identityMismatch'};
      if(rule.enabled!==true||!['strict','volume','gateway'].includes(rule.evaluationType)||!['addLoad','increaseTM'].includes(rule.adjustmentType)||rule.failBehavior!=='repeat'||(rule.evaluationType==='gateway'&&(rule.gatewaySetIndex<0||rule.gatewaySetIndex>=basis.orderedSets.length)))return {outcome:'unsupportedRule'};
      var appId=applicationId(rule.planRuleId,evidence.workoutId);if(!appId)return {outcome:'invalidInput',reason:'malformedEvidenceShape'};
      var refs=references(ownerUid),sp=refs.statePath+'/'+rule.planRuleId,ap=refs.applicationPath+'/'+appId;
      try{return await deps.transaction(async function(tx){var pair=await Promise.all([tx.get(ap),tx.get(sp)]),receipt=pair[0],state=pair[1],now=deps.timestamp();
        // Correction round 1 (finding 3): both documents are read and fully
        // classified together before ANY outcome is decided -- a receipt
        // can no longer be trusted on its mere existence, and a malformed
        // or wrong-identity state always wins over a receipt either way.
        if(state.exists&&(!stateValid(state.data)||!statePathIdentityOk(state.data,ownerUid,rule.planRuleId)))return {outcome:'stateIntegrityConflict'};
        if(receipt.exists&&(!applicationRecordValid(receipt.data)||!applicationRecordIdentityOk(receipt.data,ownerUid,rule.planRuleId,evidence.workoutId)))return {outcome:'applicationRecordIntegrityConflict'};
        if(!state.exists&&receipt.exists)return {outcome:'orphanedApplicationRecord'};
        if(state.exists&&receipt.exists)return {outcome:'alreadyProcessed'};
        if(!state.exists&&!receipt.exists)return {outcome:'notInitialized',reason:'progressionStateMissing'};
        var s=state.data,reason=null;if(s.planAssignmentId!==basis.planAssignmentId||s.planTemplateId!==basis.planTemplateId||s.exerciseId!==basis.exerciseId||s.ownerUid!==basis.ownerUid)reason='assignmentIdentityMismatch';else if(s.ruleRevisionId!==null&&s.ruleRevisionId!==basis.ruleRevisionId)reason='ruleChangedSinceState';else if(s.currentValue.kind!==(basis.adjustmentType==='addLoad'?'workingLoad':'trainingMax'))reason='adjustmentTypeChanged';
        if(reason){tx.update(sp,{status:'needsManualReview',needsManualReviewReason:reason,updatedAt:now});return {outcome:'needsManualReview',reason:reason};}
        var evaluated=root.planEvaluateCanonicalProgression(rule,s.currentValue,evidence,basis);if(evaluated.decision==='notEvaluable'){tx.update(sp,{status:'needsManualReview',needsManualReviewReason:'notEvaluable',updatedAt:now});return {outcome:'needsManualReview',reason:'notEvaluable'};}
        tx.set(ap,{ownerUid:ownerUid,planRuleId:rule.planRuleId,workoutId:evidence.workoutId,appliedAt:now});tx.update(sp,{currentValue:evaluated.nextValue,status:'active',needsManualReviewReason:null,lastProcessedWorkoutId:evidence.workoutId,lastEvaluatedAt:now,updatedAt:now});return {outcome:'success',decision:evaluated.decision};});}catch(e){return {outcome:'uncertain'};}
    }
    var surfaceObj={fsPlanProgressionInitReferences,fsPlanProgressionReadState,fsPlanProgressionSetManualState,fsPlanProgressionApplyEvaluation,CanonicalProgressionWriterDisabledError};
    // Correction round 2 (finding 4b): a guarded, Node-only test seam --
    // exactly the established pattern firebase.js's own publicSurface.__test
    // already uses (firebase.js:2891-2963): the SAME `typeof module !==
    // 'undefined' && module.exports` guard, evaluated once here at
    // construction time, so a real browser load (no `module`) never gains
    // this key at all -- proven directly by the TRUE browser-load Category V
    // tests below, which supply no `module`. getCurrentUid is `deps.currentUid`
    // itself -- the EXACT function object this persistence instance was
    // built with (for the real production instance, this is
    // productionDeps()'s own currentUid, the same bare-`auth`-identifier
    // resolver finding 1's Round 1 correction introduced) -- never a
    // duplicated expression re-deriving the same logic independently.
    if(typeof module!=='undefined'&&module.exports){
      surfaceObj.__test=Object.freeze({getCurrentUid:deps.currentUid});
    }
    return Object.freeze(surfaceObj);
  }

  function productionDeps(){
    var db=root.firebase&&root.firebase.firestore?root.firebase.firestore():null;
    function ref(path){var parts=path.split('/'),r=db.collection(parts[0]).doc(parts[1]);for(var i=2;i<parts.length;i+=2)r=r.collection(parts[i]).doc(parts[i+1]);return r;}
    // Correction round 1 (finding 1): `auth` is firebase.js's top-level
    // `const auth = firebase.auth();` -- a lexical binding shared across
    // every later-loaded classic <script> on this page (firebase.js loads
    // before this file, per index.html), exactly like app-plan.js's own
    // already-accepted planCanonicalEditorBuildProductionCtx already relies
    // on (`typeof auth !== 'undefined' && auth.currentUser && ...`,
    // app-plan.js:8752). It is NEVER a property of `root`/globalThis, so
    // `root.auth` was always undefined in the real browser -- only the bare
    // identifier resolves. This reads nothing from `auth` beyond the one
    // narrow uid lookup; it never exposes the `auth` object itself.
    return {currentUid:function(){return (typeof auth!=='undefined'&&auth.currentUser&&auth.currentUser.uid)||null;},timestamp:function(){return root.firebase.firestore.Timestamp.now();},get:async function(path){var s=await ref(path).get();return {exists:s.exists,data:s.exists?s.data():null};},transaction:function(fn){return db.runTransaction(function(t){return fn({get:async function(path){var s=await t.get(ref(path));return {exists:s.exists,data:s.exists?s.data():null};},set:function(path,data){t.set(ref(path),data);},update:function(path,data){t.update(ref(path),data);}});});}};
  }
  var surface=createPersistence(productionDeps(),CANONICAL_PLAN_PROGRESSION_CAPABILITY_ENABLED);
  root.fsPlanProgressionPersistence=surface;
  if(typeof module!=='undefined'&&module.exports)module.exports={CANONICAL_PLAN_PROGRESSION_CAPABILITY_ENABLED,createCanonicalProgressionPersistence:createPersistence,CanonicalProgressionWriterDisabledError};
})(typeof globalThis!=='undefined'?globalThis:this);
