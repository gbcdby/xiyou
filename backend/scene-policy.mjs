import {createHash,randomUUID} from 'node:crypto';
import {canonicalize} from '../protocol/index.mjs';
import {checkSpatialSchema,validateSpatial,gaolaoPersonalProfile,gaolaoPersonalProfiles} from '../protocol/spatial.mjs';
import {object,array,ref,lit,en,integer,nullable,spatialSchema} from '../protocol/spatial-schema.mjs';
import {RuntimeError} from './errors.mjs';
import {RuleError} from '../game/rules.mjs';
import {encodeJsonbText,decodeJsonbText} from './jsonb-text.mjs';
import {advanceSpatialTime,snapshotSpatial} from './spatial-runtime.mjs';
import {sceneOf,obstacleEnabled,inRange,unoccluded,canSee} from '../game/spatial-world.mjs';
import {findPath,distance,inPolygon} from '../game/spatial-geometry.mjs';
import {scenePolicy,routeSources,policyRouteValid,positionPermitted,policyLocalPath,FRONT,TEA} from '../game/gaolao-policy-route.mjs';
import {decideGaolaoScenePolicy,gaolaoScenePolicyCandidates} from '../game/gaolao-scene-policy.mjs';
import {PERSONAL_CAPABILITY,PERSONAL_SOURCE_IDS,requirePersonalState,personalDecisionBinding,personalDecisionBindingSchema,validatePersonalDecisionBinding,ownPersonalSource,validatePersonalSourceBinding} from '../game/gaolao-personal-contract.mjs';

const digest=value=>createHash('sha256').update(canonicalize(value)).digest('hex');
const id=ref('Id'),seq=ref('DecimalString'),bool={type:'boolean'},hex={type:'string',pattern:'^[a-f0-9]{64}$',minLength:64,maxLength:64};
const guardNames=['authorized','versionsCurrent','leaderHuman','leaderOnline','near','visible','los','inRoute','localPathReachable','doorOpen','exitReachable','arrived','atRetreat','retreatReachable'];
const personalPurposes=Object.keys(PERSONAL_SOURCE_IDS);
const personalGuardNames=['authorized','proposalCurrent','scopeKnown','safeCurrent','near','visible','los','exitReachable','noticeCurrent'];
// N5 要求重验相应选择的真实依赖；完整 guards 仍保留在不可变 basis 中。
const actionGuardNames={
  respond_consent:['authorized','versionsCurrent','leaderHuman','leaderOnline','near','visible','los','inRoute','localPathReachable','doorOpen'],
  withdraw_consent:['authorized'],
  'gz-confirm-settlement':['authorized','versionsCurrent','arrived','exitReachable'],
  'gz-step-back':['authorized','atRetreat'],
  move_to:['authorized','atRetreat','retreatReachable'],
};
function sameChoiceBindings(original,current,action){
  if(personalPurposes.includes(current.branch)){
    // 完整准备记录留存；别的用途会推进公开人物 revision，但不改变这份回应/撤回的依据。
    const names=action.kind==='withdraw_consent'?['authorized','noticeCurrent']:
      current.branch==='private_items'&&!current.guards.safeCurrent?['authorized','proposalCurrent','scopeKnown','safeCurrent']:
      personalGuardNames.filter(name=>name!=='noticeCurrent');
    const project=({subjectRevision,guards,safeRecord,...common})=>({...common,...(action.kind==='withdraw_consent'?{}:{safeRecord}),guards:Object.fromEntries(names.map(name=>[name,guards[name]]))});
    return canonicalize(project(original))===canonicalize(project(current));
  }
  const names=actionGuardNames[action.kind==='interact'?action.operationId:action.kind];
  if(!Array.isArray(names))throw new RuntimeError('INVALID_MESSAGE','当前场景策略没有该动作的依赖声明。');
  const project=({guards,...common})=>{
    if(current.branch&&action.kind!=='interact')delete common.subjectRevision;
    return {...common,guards:Object.fromEntries(names.map(name=>[name,guards[name]]))};
  };
  return canonicalize(project(original))===canonicalize(project(current));
}
const basisSchema=object({policyVersion:lit('gaolao-cuilan-v1'),stepKey:id,actionId:id,requestDigest:hex,evaluatedThroughSeq:seq,contentVersion:id,chapterVersion:id,mapVersion:id,
  sources:array(object({sourceId:en('rescue-contact',FRONT,TEA),sourceRef:ref('EntityRef'),observationRef:ref('EntityRef'),sourceSeq:seq,receivedSeq:seq,digest:hex}),3),
  consent:nullable(object({consentId:id,version:seq,status:id,purpose:lit('follow')})),follow:nullable(object({followId:id,planVersion:seq,consentVersion:seq,routeDigest:hex})),
  subjectEpoch:seq,leaderEpoch:nullable(seq),viewId:ref('EntityRef'),subjectRef:ref('EntityRef'),subjectRevision:seq,
  guards:object(Object.fromEntries(guardNames.map(name=>[name,bool]))),previousIntentId:nullable(id),attempt:integer(1000000,1)});
const safeRecordSchema=object({subjectId:id,consentId:ref('EntityRef'),consentVersion:seq,followId:ref('EntityRef'),planVersion:seq,destinationId:id,sourceSeq:seq});
const personalSourceSchema=object({sourceId:en(...Object.values(PERSONAL_SOURCE_IDS)),sourceRevision:lit('1'),sourceRef:ref('EntityRef'),observationRef:ref('EntityRef'),sourceSeq:seq,receivedSeq:seq,digest:hex});
const personalBasisSchema=object({...Object.fromEntries(Object.entries(basisSchema.properties).filter(([key])=>!['consent','follow','leaderEpoch','sources','guards'].includes(key))),
  policyVersion:lit('gaolao-cuilan-v2'),branch:en(...personalPurposes),personal:personalDecisionBindingSchema,safeRecord:nullable(safeRecordSchema),
  sources:{...array(personalSourceSchema,1),minItems:1},guards:object(Object.fromEntries(personalGuardNames.map(name=>[name,bool])))});
const rescueBasisV2Schema=object({...basisSchema.properties,policyVersion:lit('gaolao-cuilan-v2'),branch:en('rescue','follow')});
export function validateScenePolicyBasis(basis){
  const personal=basis?.policyVersion==='gaolao-cuilan-v2'&&personalPurposes.includes(basis.branch);
  checkSpatialSchema(personal?personalBasisSchema:basis?.policyVersion==='gaolao-cuilan-v2'?rescueBasisV2Schema:basisSchema,basis,spatialSchema.$defs);
  if(basis.policyVersion==='gaolao-cuilan-v2'){
    const profile=gaolaoPersonalProfiles.find(p=>p.contentVersion===basis.contentVersion);
    if(!profile||['chapterVersion','mapVersion','policyVersion'].some(key=>basis[key]!==profile[key]))throw new RuntimeError('INVALID_MESSAGE','本人依据的精确内容版本不匹配。');
  }
  if(personal){
    const p=validatePersonalDecisionBinding(basis.personal),proposal=p.proposalBinding,proof=p.acceptedProof,notice=p.notice;
    basis.sources.forEach(validatePersonalSourceBinding);
    if(p.purpose!==basis.branch||basis.sources[0].sourceId!==PERSONAL_SOURCE_IDS[basis.branch]||proposal.scopeDigest!==p.scopeDigest||['contentVersion','chapterVersion','mapVersion','policyVersion'].some(key=>proposal[key]!==basis[key]))throw new RuntimeError('INVALID_MESSAGE','本人依据的用途、来源或原提议不匹配。');
    const receivedBeforeEvaluation=source=>BigInt(source.sourceSeq)<=BigInt(source.receivedSeq)&&BigInt(source.receivedSeq)<=BigInt(basis.evaluatedThroughSeq);
    if(!receivedBeforeEvaluation(proposal)||!basis.sources.every(receivedBeforeEvaluation)||p.lifecycle!=='open'||!['proposed','accepted'].includes(p.status)||
      basis.stepKey!==`${p.purpose}:${p.consentId}:${p.consentVersion}:${p.lifecycleVersion}:${p.status==='accepted'?'withdraw':'response'}`)throw new RuntimeError('INVALID_MESSAGE','本人依据必须是已实际收到的当前开放步骤。');
    if(p.status==='proposed'&&(proof||notice||proposal.consentVersion!==p.consentVersion||p.executionState!=='none'))throw new RuntimeError('INVALID_MESSAGE','未接受的原提议不能带执行证明。');
    if(p.status==='accepted'){
      const identityKeys=['subjectId','subjectEpoch','requesterId','requesterEpoch','performerId','performerEpoch','scopeDigest','contentVersion','chapterVersion','mapVersion','policyVersion'];
      if(!proof||!notice||p.permissionTerm!=='single_use'||identityKeys.some(key=>proof[key]!==proposal[key])||BigInt(proof.consentVersion)<=BigInt(proposal.consentVersion)||BigInt(proof.consentVersion)>BigInt(p.consentVersion)||
        proof.sources[0].sourceId!==PERSONAL_SOURCE_IDS[p.purpose]||!proof.sources.every(receivedBeforeEvaluation)||notice.consentId!==p.consentId||notice.acceptedConsentVersion!==proof.consentVersion||notice.reasonCode!==p.reasonCode||!receivedBeforeEvaluation(notice))throw new RuntimeError('INVALID_MESSAGE','本人撤回依据缺少原实际接受或本份中断通知。');
    }
  }
  return basis;
}
function routeBinding(route){if(!route)return null;const {leaderCheckpoint,leaderStage,leaderExitDone,...rest}=route;return rest;}
async function authorize(runtime,tx,principal){
  await runtime.authorizeInternal(tx,principal);
  const policy=scenePolicy(tx.content);
  if(principal.principalKind!=='scene_role'||policy?.actorId!==principal.actorId)throw new RuntimeError('FORBIDDEN','本角色没有登记此场景策略。');
}
/** 原持久来源即使不在最近 256 观察窗，也只能按本人/三个允许 sourceId 读取。 */
function ownSources(tx,actorId){
  const expected=routeSources(tx.content),records=[];
  for(const sourceId of ['rescue-contact',FRONT,TEA]){
    const entry=Object.values(tx.state.chapter.provenance[actorId]??{}).find(m=>m.sourceId===sourceId&&m.retainedObservation);
    if(!entry)continue;
    const o=entry.retainedObservation,route=expected.find(r=>r.sourceId===sourceId);
    if(route&&(entry.routeDigest!==route.digest||canonicalize(entry.routeKnowledge)!==canonicalize(route.knowledge)))continue;
    records.push({sourceId,sourceRef:o.source.sourceRef,observationRef:o.observationRef,sourceSeq:o.sourceSeq,receivedSeq:o.source.receivedSeq,digest:route?.digest??digest(o)});
  }
  return records;
}
/** 当前领路者的布尔资格；只用本人本地通路，供读取与事务前后通知共用。 */
function leaderEligibility(state,content,actor,leader,follow,online){
  return {leaderHuman:leader?.kind==='human',leaderOnline:online,
    near:!!leader&&inRange(state,content,actor,leader,content.movement.interactionRadius),visible:!!leader&&canSee(state,content,actor.characterId,leader),los:!!leader&&unoccluded(state,content,actor,leader),
    inRoute:!!leader&&!!follow?.policyRoute&&positionPermitted(content,follow.policyRoute,leader,{leader:true}),
    localPathReachable:!!leader&&!!follow?.policyRoute&&!!policyLocalPath(content,follow.policyRoute,actor,leader,obstacleEnabled(state))};
}
function pointSegmentDistance(point,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/length)):0;
  return distance(point,{x:a.x+t*dx,y:a.y+t*dy});
}
/** 只比较本人已知登记点与自己安置处的静态范围，不查询远处当前准备/障碍/人物。 */
function separatedMeeting(content,destination,safe){
  if(!destination||!safe)return false;
  if(destination.sceneId!==safe.sceneId)return true;
  const scene=sceneOf(content,safe.sceneId),areaIds=[safe.areaId,safe.areaId==='guest-room'?'guest-passage':'tea-passage'];
  for(const area of scene.walkableAreas.filter(area=>areaIds.includes(area.areaId))){
    if(inPolygon(destination.position,area.polygon)||area.polygon.some((point,i)=>pointSegmentDistance(destination.position,point,area.polygon[(i+1)%area.polygon.length])<=90))return false;
  }
  return pointSegmentDistance(destination.position,safe.position,safe.exitPosition)>90;
}
/** F1 只读接点：本人来源与每个当前用途分别读取，不查看远处私物或其他人物的知识。 */
export function personalScenePolicyState(state,content,actorId){
  const profile=gaolaoPersonalProfile(state),policy=scenePolicy(content);
  if(!profile||!gaolaoPersonalProfile(content)||profile.contentVersion!==content.contentVersion||policy?.policyVersion!==profile.policyVersion||policy.actorId!==actorId||content.chapterRules.people.cuilan!==actorId)throw new RuntimeError('INVALID_MESSAGE','新本人策略必须绑定完整登记内容和真实本人。');
  const chapter=requirePersonalState(state),actor=state.characters[actorId],safeRecord=chapter.safeRecord;
  if(chapter.cuilanSafe)checkSpatialSchema(safeRecordSchema,safeRecord,spatialSchema.$defs);
  const safe=content.chapterRules.safeDestinations.find(d=>d.destinationId===safeRecord?.destinationId),safeCurrent=chapter.cuilanSafe&&safeRecord?.subjectId===actorId&&!!safe;
  const authorized=actor?.actorKind==='scene_role'&&actor.mode==='CoreNPCControlled',scene=actor?sceneOf(content,actor.sceneId):null;
  const exitReachable=!!safeCurrent&&actor?.sceneId===safe.sceneId&&!!findPath(scene,actor.position,safe.exitPosition,obstacleEnabled(state));
  const records={},sources={},knowledge={},guards={},requests=[];
  for(const purpose of personalPurposes){
    const personal=personalDecisionBinding(state,actorId,purpose),receivedSource=ownPersonalSource(state,content,actorId,purpose);
    const source=receivedSource&&BigInt(receivedSource.receivedSeq)<=BigInt(state.sessionSeq)?receivedSource:null;
    records[purpose]=personal;
    if(source){const {knowledge:ownKnowledge,...binding}=source;sources[purpose]=binding;knowledge[purpose]=ownKnowledge;}
    if(!personal)continue;
    const binding=personal.proposalBinding,scope=personal.scope,isProposed=personal.status==='proposed';
    // 撤回只读原 proof/notice；旧经手人掉线或换 epoch 不再成为本人收口条件。
    const requester=isProposed?state.characters[binding.requesterId]:null,performer=isProposed&&binding.performerId?state.characters[binding.performerId]:null;
    const received=BigInt(binding.sourceSeq)<=BigInt(binding.receivedSeq)&&BigInt(binding.receivedSeq)<=BigInt(state.sessionSeq);
    const current=received&&binding.subjectId===actorId&&binding.subjectEpoch===actor?.controlEpoch&&binding.consentVersion===personal.consentVersion&&
      ['contentVersion','chapterVersion','mapVersion'].every(key=>binding[key]===state[key])&&binding.policyVersion===profile.policyVersion&&
      requester?.kind==='human'&&requester.mode==='HumanControlled'&&requester.controlEpoch===binding.requesterEpoch&&chapter.onlineActorIds.includes(requester.characterId)&&
      (purpose==='appearance'?binding.performerId===content.chapterRules.people.wukong&&performer?.mode==='CoreNPCControlled'&&performer.controlEpoch===binding.performerEpoch:binding.performerId===null&&binding.performerEpoch===null);
    const known=purpose==='appearance'?
      !!source&&scope.usage===source.knowledge.usage&&scope.radius===source.knowledge.radius&&binding.performerId===content.chapterRules.people.wukong&&separatedMeeting(content,source.knowledge.meetingDestinations.find(d=>d.destinationId===scope.destinationId),safe):
      !!source&&scope.ownerId===actorId&&scope.handling===source.knowledge.handling&&scope.sourceRevision===source.sourceRevision&&scope.sourceDigest===source.digest&&scope.itemIds.every(id=>source.knowledge.items.some(item=>item.itemId===id&&item.ownerId===actorId));
    const notice=personal.notice,proof=personal.acceptedProof;
    const noticeCurrent=!!notice&&!!proof&&notice.consentId===personal.consentId&&notice.acceptedConsentVersion===proof.consentVersion&&notice.reasonCode===personal.reasonCode&&BigInt(notice.sourceSeq)<=BigInt(notice.receivedSeq)&&BigInt(notice.receivedSeq)<=BigInt(state.sessionSeq);
    guards[purpose]={authorized:!!authorized,proposalCurrent:!!current,scopeKnown:!!known,safeCurrent:!!safeCurrent,
      near:!!requester&&inRange(state,content,actor,requester,content.movement.interactionRadius),visible:!!requester&&canSee(state,content,actorId,requester),los:!!requester&&unoccluded(state,content,actor,requester),exitReachable:!!exitReachable,noticeCurrent};
    requests.push({purpose,consentId:personal.consentId,version:personal.consentVersion,lifecycleVersion:personal.lifecycleVersion,lifecycle:personal.lifecycle,status:personal.status,reasonCode:personal.reasonCode,permissionTerm:personal.permissionTerm,sourceSeq:binding.sourceSeq});
  }
  return {records,sources,knowledge,guards,requests,safeRecord:structuredClone(safeRecord??null)};
}
export async function scenePolicyInput(tx,principal){
  const actor=tx.state.characters[principal.actorId],chapter=tx.state.chapter,rules=tx.content.chapterRules;
  const policyVersion=scenePolicy(tx.content)?.policyVersion,personal=policyVersion==='gaolao-cuilan-v2'?personalScenePolicyState(tx.state,tx.content,principal.actorId):null;
  if(!['gaolao-cuilan-v1','gaolao-cuilan-v2'].includes(policyVersion)||!personal&&gaolaoPersonalProfile(tx.state))throw new RuntimeError('INVALID_MESSAGE','未登记或错配的场景策略版本。');
  const snapshot=await snapshotSpatial(tx,principal.actorId,{principalKind:'scene_role',capabilities:['spatial-v2',...(personal?[PERSONAL_CAPABILITY]:[])]}),p=snapshot.projection;
  const f=chapter.follows[principal.actorId],c=chapter.consents[chapter.consentSlots[`${principal.actorId}:follow`]],leader=f?tx.state.characters[f.leaderId]:null;
  const consent=p.chapter.consents.find(x=>x.consentId===c?.consentId)??null,follow=p.chapter.follows.find(x=>x.followId===f?.followId)??null;
  const sources=ownSources(tx,principal.actorId),needed=f?.policyRoute?.sourceIds??[];
  const knowledge={rescue:sources.some(s=>s.sourceId==='rescue-contact'),routesReady:needed.length>0&&needed.every(sourceId=>sources.some(s=>s.sourceId===sourceId))};
  const scene=sceneOf(tx.content,actor.sceneId),enabled=obstacleEnabled(tx.state),d=rules.safeDestinations.find(d=>d.destinationId===f?.destinationId);
  const inDestination=!!d&&d.sceneId===actor.sceneId&&distance(actor.position,d.position)<=20&&inPolygon(actor.position,scene.walkableAreas.find(a=>a.areaId===d.areaId)?.polygon??[]);
  const qualified=actor.mode==='CoreNPCControlled'&&actor.actorKind==='scene_role';
  const eligibility={authorized:qualified,versionsCurrent:!!f&&!!c&&f.consentId===c.consentId&&f.consentVersion===c.version&&f.subjectEpoch===actor.controlEpoch&&f.leaderEpoch===leader?.controlEpoch&&policyRouteValid(tx.state,tx.content,f),
    ...leaderEligibility(tx.state,tx.content,actor,leader,f,!!leader&&tx.liveActorIds?.has(leader.characterId)===true),
    doorOpen:tx.state.targets[rules.sealTargetId].fields.some(x=>x.key==='open'&&x.value===true),exitReachable:inDestination&&!!findPath(scene,actor.position,d.exitPosition,enabled),arrived:f?.status==='arrived'&&inDestination,
    atRetreat:actor.sceneId===rules.retreat.sceneId&&distance(actor.position,rules.retreat.position)<=20,retreatReachable:actor.sceneId===rules.retreat.sceneId&&!!findPath(scene,actor.position,rules.retreat.position,enabled)};
  const input={policyVersion,snapshot,knowledge:{...knowledge,...(personal?{personal:personal.knowledge}:{})},participant:{consent,follow,retreated:chapter.retreated,safe:chapter.cuilanSafe,pause:f?.policyPause??null,...(personal?{personalRequests:personal.requests}:{})},eligibility:{...eligibility,...(personal?{personal:personal.guards}:{})},retreat:structuredClone(rules.retreat)};
  return {input,sources,actor,leader,f,c,personal};
}
function bindings(tx,principal,read,choice){
  const {actor,leader,f,c,input,sources}=read;
  if(personalPurposes.includes(choice.branch))return {branch:choice.branch,personal:read.personal.records[choice.branch],sources:[read.personal.sources[choice.branch]],safeRecord:read.personal.safeRecord,
    contentVersion:tx.state.contentVersion,chapterVersion:tx.state.chapterVersion,mapVersion:tx.state.mapVersion,
    subjectEpoch:actor.controlEpoch,viewId:input.snapshot.viewId,subjectRef:input.snapshot.projection.self.entityRef,subjectRevision:actor.resourceRevision,guards:read.personal.guards[choice.branch]};
  return {contentVersion:tx.state.contentVersion,chapterVersion:tx.state.chapterVersion,mapVersion:tx.state.mapVersion,sources,
    ...(choice.branch?{branch:choice.branch}:{}),
    consent:c?{consentId:c.consentId,version:c.version,status:c.status,purpose:c.purpose}:null,
    follow:f?{followId:f.followId,planVersion:f.planVersion,consentVersion:f.consentVersion,routeDigest:digest(routeBinding(f.policyRoute))}:null,
    subjectEpoch:actor.controlEpoch,leaderEpoch:leader?.controlEpoch??null,viewId:input.snapshot.viewId,subjectRef:input.snapshot.projection.self.entityRef,subjectRevision:actor.resourceRevision,guards:Object.fromEntries(guardNames.map(name=>[name,input.eligibility[name]]))};
}
export function sceneStatusSignature(chapter,actorId){
  const f=chapter.follows[actorId],c=chapter.consents[chapter.consentSlots[`${actorId}:follow`]];
  return canonicalize({retreated:chapter.retreated,safe:chapter.cuilanSafe,consent:c?{id:c.consentId,version:c.version,status:c.status}:null,follow:f?{id:f.followId,planVersion:f.planVersion,status:f.status,pause:f.policyPause??null,stage:f.policyRoute?.stage??null,exit:f.policyRoute?.frontExitDone??null}:null});
}
/** 仅可信事务通知使用的本人相关性白名单；不构造Snapshot、不寻远处通路。 */
function wakeDependencies(state,content,actorId){
  const actor=state.characters[actorId],chapter=state.chapter;
  if(!actor||!chapter)return null;
  const f=chapter.follows[actorId],leader=f?state.characters[f.leaderId]:null,scene=sceneOf(content,actor.sceneId);
  const sourceCount=Object.values(chapter.provenance[actorId]??{}).filter(x=>['rescue-contact',FRONT,TEA].includes(x.sourceId)).length;
  const personal=gaolaoPersonalProfile(state)?personalScenePolicyState(state,content,actorId):null;
  const personalDependencies=personal?{records:personal.records,sources:personal.sources,safeRecord:personal.safeRecord,
    guards:Object.fromEntries(personalPurposes.filter(purpose=>personal.records[purpose]).map(purpose=>[purpose,personal.records[purpose].status==='proposed'?personal.guards[purpose]:{authorized:personal.guards[purpose].authorized,noticeCurrent:personal.guards[purpose].noticeCurrent}]))}:null;
  return {phase:state.phase,mapVersion:state.mapVersion,chapterVersion:state.chapterVersion,contentVersion:state.contentVersion,mode:actor.mode,epoch:actor.controlEpoch,viewId:state.views[actorId]?.viewId??null,subjectRevision:actor.resourceRevision,leaderEpoch:leader?.controlEpoch??null,
    ...(personal?{personal:personalDependencies}:{}),
    sourceCount,status:sceneStatusSignature(chapter,actorId),movement:['arrived','blocked','cancelled'].includes(actor.movement?.status)?[actor.movement.movementId,actor.movement.status]:null,
    localObstacles:scene?.obstacles.map(o=>[o.obstacleId,obstacleEnabled(state)(o)])??[],
    proposal:f?.status==='proposed'&&leader?{leaderId:f.leaderId,...leaderEligibility(state,content,actor,leader,f,chapter.onlineActorIds.includes(f.leaderId))}:null};
}
/** 事务起点与最终提交状态的资格变化，只进入进程内通知，不写事件/DTO/模型。 */
export function scenePolicyWake(tx){
  const policy=scenePolicy(tx.content);if(!policy)return null;
  return {actorId:policy.actorId,throughSeq:tx.state.sessionSeq,relevant:canonicalize(wakeDependencies(tx.row.state,tx.content,policy.actorId))!==canonicalize(wakeDependencies(tx.state,tx.content,policy.actorId))};
}
const pendingQuery="SELECT * FROM spatial_intents WHERE session_id=$1 AND actor_id=$2 AND execution_context->>'mode'='scene-policy' AND scene_outcome IS NULL ORDER BY intent_id";
export async function prepareScenePolicy(runtime,handle,{semanticSeq='0'}={}){
  const principal=runtime.internal(handle);
  return runtime.locked(principal.sessionId,{kind:'scene-policy-prepare'},async tx=>{
    await authorize(runtime,tx,principal);
    const pending=(await tx.client.query(pendingQuery,[principal.sessionId,principal.actorId])).rows;
    if(pending.length)return {kind:'recovery',intentId:pending[0].intent_id};
    await advanceSpatialTime(tx);
    const read=await scenePolicyInput(tx,principal),candidates=gaolaoScenePolicyCandidates(read.input),evaluatedThroughSeq=tx.state.sessionSeq;
    checkSpatialSchema(seq,semanticSeq,spatialSchema.$defs);
    if(BigInt(semanticSeq)>BigInt(evaluatedThroughSeq))throw new RuntimeError('INVALID_MESSAGE','场景语义水位不能晚于当前权威状态。');
    if(!read.input.eligibility.authorized)throw new RuntimeError('FORBIDDEN');
    let selected=null,waitingForSemantic=false,reason=candidates[0].reason;
    for(const choice of candidates){
      if(choice.kind!=='action')continue;
      const current=bindings(tx,principal,read,choice);
      const old=(await tx.client.query("SELECT intent_id,execution_context,scene_outcome FROM spatial_intents WHERE session_id=$1 AND actor_id=$2 AND execution_context->>'mode'='scene-policy' AND execution_context->'scenePolicyBasis'->>'stepKey'=$3 ORDER BY (execution_context->'scenePolicyBasis'->>'attempt')::integer DESC LIMIT 1",[principal.sessionId,principal.actorId,choice.stepKey])).rows[0];
      if(old){
        const previous=validateScenePolicyBasis(old.execution_context.scenePolicyBasis);
        const previousBindings=Object.fromEntries(Object.keys(current).map(k=>[k,previous[k]]));
        const succeeded=old.scene_outcome?.status==='Accepted';
        const newSemanticAfterRejection=old.scene_outcome?.status==='Rejected'&&BigInt(semanticSeq)>BigInt(old.scene_outcome.observedSeq);
        if(succeeded&&choice.stepKey!=='retreat-navigation'){reason='当前逻辑步骤已有成功原结果。';continue;}
        if(sameChoiceBindings(previousBindings,current,choice.action)&&!newSemanticAfterRejection){
          // 缓存只挡住本步骤；另一用途仍可预留。读前/迟送达的新语义不被较大读态吞掉。
          reason=succeeded?'当前导航已有成功原结果。':'当前逻辑步骤等待拒绝后的新语义。';waitingForSemantic ||= !succeeded;continue;
        }
      }
      selected={choice,current,old};break;
    }
    if(!selected)return {kind:'idle',reason,evaluatedThroughSeq,...(waitingForSemantic?{consumeThroughSeq:semanticSeq}:{})};
    const {choice,current,old}=selected;
    const intentId=`scene-${randomUUID()}`,action=choice.action,navigation=action.kind==='move_to';
    const issued=navigation?(await tx.client.query('INSERT INTO spatial_command_sources(session_id,actor_id,control_epoch,issued_seq) VALUES($1,$2,$3,1) ON CONFLICT(session_id,actor_id,control_epoch) DO UPDATE SET issued_seq=GREATEST(spatial_command_sources.issued_seq,spatial_command_sources.handled_seq)+1 RETURNING issued_seq',[principal.sessionId,principal.actorId,read.actor.controlEpoch])).rows[0].issued_seq:null;
    const request=validateSpatial('PublicEnvelope',{schemaVersion:2,sessionId:principal.sessionId,viewId:read.input.snapshot.viewId,actorRef:read.input.snapshot.projection.self.entityRef,clientActionId:intentId,controlEpoch:read.actor.controlEpoch,baseSeq:evaluatedThroughSeq,action:{...action,...(navigation?{movementCommandSeq:issued}:{})}});
    const basis=validateScenePolicyBasis({policyVersion:scenePolicy(tx.content).policyVersion,stepKey:choice.stepKey,actionId:intentId,requestDigest:digest(request),evaluatedThroughSeq,...current,previousIntentId:old?.intent_id??null,attempt:(old?.execution_context.scenePolicyBasis.attempt??0)+1});
    const stored=encodeJsonbText(request);
    await tx.client.query('INSERT INTO spatial_intents(session_id,intent_id,actor_id,control_epoch,request,execution_context,request_text_encoding) VALUES($1,$2,$3,$4,$5,$6,$7)',[principal.sessionId,intentId,principal.actorId,request.controlEpoch,stored.value,{mode:'scene-policy',scenePolicyBasis:basis},stored.encoding]);
    return {kind:'prepared',intentId,evaluatedThroughSeq};
  });
}
/** 必须在 executeSpatial 的原 Receipt 查重后、首次世界动作之前调用。 */
export async function revalidateScenePolicy(runtime,tx,principal,request,context){
  if(Object.keys(context).some(k=>!['mode','scenePolicyBasis'].includes(k)))throw new RuntimeError('INVALID_MESSAGE');
  const basis=validateScenePolicyBasis(context.scenePolicyBasis);
  await authorize(runtime,tx,principal);
  if(basis.actionId!==request.clientActionId||basis.requestDigest!==digest(request))throw new RuntimeError('ACTION_ID_REUSE');
  if(basis.policyVersion!==scenePolicy(tx.content)?.policyVersion)throw new RuleError('STALE_PRECONDITION');
  const read=await scenePolicyInput(tx,principal),choice=decideGaolaoScenePolicy(read.input,{branch:basis.branch??null});
  if(choice.kind!=='action')throw new RuleError('STALE_PRECONDITION');
  const current=bindings(tx,principal,read,choice);
  const original=Object.fromEntries(Object.keys(current).map(k=>[k,basis[k]])),{movementCommandSeq,...action}=request.action;
  if(choice.kind!=='action'||choice.stepKey!==basis.stepKey||canonicalize(choice.action)!==canonicalize(action)||!sameChoiceBindings(original,current,action))throw new RuleError('STALE_PRECONDITION');
  tx.scenePolicyAuthorization=basis;
}
/** 查旧 Receipt 不经过首次选择谓词；读权、原演员、原摘要仍必须成立。 */
export async function recoverScenePolicy(runtime,handle){
  const principal=runtime.internal(handle);
  return runtime.locked(principal.sessionId,{kind:'scene-policy-recover'},async tx=>{
    await authorize(runtime,tx,principal);
    let rows=(await tx.client.query(pendingQuery,[principal.sessionId,principal.actorId])).rows;const receipts=[];
    // 核对标记的 COMMIT 返回本身也可能丢失；账本已标记不能等同于调用者已看见结果。
    // 无未收束行时读回本策略最近原结果，仍逐项验证原请求摘要和当前收据读权。
    if(!rows.length)rows=(await tx.client.query("SELECT * FROM spatial_intents WHERE session_id=$1 AND actor_id=$2 AND execution_context->>'mode'='scene-policy' AND scene_outcome IS NOT NULL ORDER BY (execution_context->'scenePolicyBasis'->>'evaluatedThroughSeq')::numeric DESC,(execution_context->'scenePolicyBasis'->>'attempt')::integer DESC LIMIT 1",[principal.sessionId,principal.actorId])).rows;
    for(const row of rows){
      const request=decodeJsonbText(row.request,row.request_text_encoding),basis=validateScenePolicyBasis(row.execution_context.scenePolicyBasis);
      if(basis.actionId!==request.clientActionId||basis.requestDigest!==digest(request))throw new RuntimeError('ACTION_ID_REUSE');
      const prior=(await tx.client.query('SELECT receipt,semantic_digest,actor_id FROM action_receipts WHERE session_id=$1 AND principal_id=$2 AND client_action_id=$3',[principal.sessionId,principal.principalId,row.intent_id])).rows[0];
      if(!prior)return {pending:row.intent_id,receipts,phase:tx.state.phase};
      if(prior.actor_id!==principal.actorId)throw new RuntimeError('FORBIDDEN');
      if(prior.semantic_digest!==basis.requestDigest)throw new RuntimeError('ACTION_ID_REUSE');
      await tx.client.query('UPDATE spatial_intents SET scene_outcome=$3 WHERE session_id=$1 AND intent_id=$2 AND scene_outcome IS NULL',[principal.sessionId,row.intent_id,prior.receipt.publicReceipt]);
      receipts.push(prior.receipt.publicReceipt);
    }
    return {pending:null,receipts,phase:tx.state.phase};
  });
}
