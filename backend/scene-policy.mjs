import {createHash,randomUUID} from 'node:crypto';
import {canonicalize} from '../protocol/index.mjs';
import {checkSpatialSchema,validateSpatial} from '../protocol/spatial.mjs';
import {object,array,ref,lit,en,integer,nullable,spatialSchema} from '../protocol/spatial-schema.mjs';
import {RuntimeError} from './errors.mjs';
import {RuleError} from '../game/rules.mjs';
import {encodeJsonbText,decodeJsonbText} from './jsonb-text.mjs';
import {advanceSpatialTime,snapshotSpatial} from './spatial-runtime.mjs';
import {sceneOf,obstacleEnabled,inRange,unoccluded,canSee} from '../game/spatial-world.mjs';
import {findPath,distance,inPolygon} from '../game/spatial-geometry.mjs';
import {scenePolicy,routeSources,policyRouteValid,positionPermitted,policyLocalPath,FRONT,TEA} from '../game/gaolao-policy-route.mjs';
import {decideGaolaoScenePolicy} from '../game/gaolao-scene-policy.mjs';

const digest=value=>createHash('sha256').update(canonicalize(value)).digest('hex');
const id=ref('Id'),seq=ref('DecimalString'),bool={type:'boolean'},hex={type:'string',pattern:'^[a-f0-9]{64}$',minLength:64,maxLength:64};
const guardNames=['authorized','versionsCurrent','leaderHuman','leaderOnline','near','visible','los','inRoute','localPathReachable','doorOpen','exitReachable','arrived','atRetreat','retreatReachable'];
const basisSchema=object({policyVersion:lit('gaolao-cuilan-v1'),stepKey:id,actionId:id,requestDigest:hex,evaluatedThroughSeq:seq,contentVersion:id,chapterVersion:id,mapVersion:id,
  sources:array(object({sourceId:en('rescue-contact',FRONT,TEA),sourceRef:ref('EntityRef'),observationRef:ref('EntityRef'),sourceSeq:seq,receivedSeq:seq,digest:hex}),3),
  consent:nullable(object({consentId:id,version:seq,status:id,purpose:lit('follow')})),follow:nullable(object({followId:id,planVersion:seq,consentVersion:seq,routeDigest:hex})),
  subjectEpoch:seq,leaderEpoch:nullable(seq),viewId:ref('EntityRef'),subjectRef:ref('EntityRef'),subjectRevision:seq,
  guards:object(Object.fromEntries(guardNames.map(name=>[name,bool]))),previousIntentId:nullable(id),attempt:integer(1000000,1)});
export function validateScenePolicyBasis(basis){checkSpatialSchema(basisSchema,basis,spatialSchema.$defs);return basis;}
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
export async function scenePolicyInput(tx,principal){
  const actor=tx.state.characters[principal.actorId],chapter=tx.state.chapter,rules=tx.content.chapterRules;
  const snapshot=await snapshotSpatial(tx,principal.actorId,{principalKind:'scene_role',capabilities:['spatial-v2']}),p=snapshot.projection;
  const f=chapter.follows[principal.actorId],c=chapter.consents[chapter.consentSlots[`${principal.actorId}:follow`]],leader=f?tx.state.characters[f.leaderId]:null;
  const consent=p.chapter.consents.find(x=>x.consentId===c?.consentId)??null,follow=p.chapter.follows.find(x=>x.followId===f?.followId)??null;
  const sources=ownSources(tx,principal.actorId),needed=f?.policyRoute?.sourceIds??[];
  const knowledge={rescue:sources.some(s=>s.sourceId==='rescue-contact'),routesReady:needed.length>0&&needed.every(sourceId=>sources.some(s=>s.sourceId===sourceId))};
  const scene=sceneOf(tx.content,actor.sceneId),enabled=obstacleEnabled(tx.state),d=rules.safeDestinations.find(d=>d.destinationId===f?.destinationId);
  const inDestination=!!d&&d.sceneId===actor.sceneId&&distance(actor.position,d.position)<=20&&inPolygon(actor.position,scene.walkableAreas.find(a=>a.areaId===d.areaId)?.polygon??[]);
  const qualified=actor.mode==='CoreNPCControlled'&&actor.actorKind==='scene_role';
  const eligibility={authorized:qualified,versionsCurrent:!!f&&!!c&&f.consentId===c.consentId&&f.consentVersion===c.version&&f.subjectEpoch===actor.controlEpoch&&f.leaderEpoch===leader?.controlEpoch&&policyRouteValid(tx.state,tx.content,f),
    leaderHuman:leader?.kind==='human',leaderOnline:!!leader&&tx.liveActorIds?.has(leader.characterId)===true,near:!!leader&&inRange(tx.state,tx.content,actor,leader,tx.content.movement.interactionRadius),visible:!!leader&&canSee(tx.state,tx.content,actor.characterId,leader),los:!!leader&&unoccluded(tx.state,tx.content,actor,leader),
    inRoute:!!leader&&!!f?.policyRoute&&positionPermitted(tx.content,f.policyRoute,leader,{leader:true}),localPathReachable:!!leader&&!!f?.policyRoute&&!!policyLocalPath(tx.content,f.policyRoute,actor,leader,enabled),
    doorOpen:tx.state.targets[rules.sealTargetId].fields.some(x=>x.key==='open'&&x.value===true),exitReachable:inDestination&&!!findPath(scene,actor.position,d.exitPosition,enabled),arrived:f?.status==='arrived'&&inDestination,
    atRetreat:actor.sceneId===rules.retreat.sceneId&&distance(actor.position,rules.retreat.position)<=20,retreatReachable:actor.sceneId===rules.retreat.sceneId&&!!findPath(scene,actor.position,rules.retreat.position,enabled)};
  const input={snapshot,knowledge,participant:{consent,follow,retreated:chapter.retreated,safe:chapter.cuilanSafe,pause:f?.policyPause??null},eligibility,retreat:structuredClone(rules.retreat)};
  return {input,sources,actor,leader,f,c};
}
function bindings(tx,principal,read){
  const {actor,leader,f,c,input,sources}=read;
  return {contentVersion:tx.state.contentVersion,chapterVersion:tx.state.chapterVersion,mapVersion:tx.state.mapVersion,sources,
    consent:c?{consentId:c.consentId,version:c.version,status:c.status,purpose:c.purpose}:null,
    follow:f?{followId:f.followId,planVersion:f.planVersion,consentVersion:f.consentVersion,routeDigest:digest(routeBinding(f.policyRoute))}:null,
    subjectEpoch:actor.controlEpoch,leaderEpoch:leader?.controlEpoch??null,viewId:input.snapshot.viewId,subjectRef:input.snapshot.projection.self.entityRef,subjectRevision:actor.resourceRevision,guards:input.eligibility};
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
  return {phase:state.phase,mapVersion:state.mapVersion,chapterVersion:state.chapterVersion,contentVersion:state.contentVersion,mode:actor.mode,epoch:actor.controlEpoch,viewId:state.views[actorId]?.viewId??null,
    sourceCount,status:sceneStatusSignature(chapter,actorId),movement:['arrived','blocked','cancelled'].includes(actor.movement?.status)?[actor.movement.movementId,actor.movement.status]:null,
    localObstacles:scene?.obstacles.map(o=>[o.obstacleId,obstacleEnabled(state)(o)])??[],
    proposal:f?.status==='proposed'&&leader?{leaderId:f.leaderId,epoch:leader.controlEpoch,online:chapter.onlineActorIds.includes(f.leaderId),human:leader.kind==='human',near:inRange(state,content,actor,leader,content.movement.interactionRadius),los:unoccluded(state,content,actor,leader),visible:canSee(state,content,actorId,leader),inRoute:!!f.policyRoute&&positionPermitted(content,f.policyRoute,leader,{leader:true})}:null};
}
/** 事务起点与最终提交状态的资格变化，只进入进程内通知，不写事件/DTO/模型。 */
export function scenePolicyWake(tx){
  const policy=scenePolicy(tx.content);if(!policy)return null;
  return {actorId:policy.actorId,throughSeq:tx.state.sessionSeq,relevant:canonicalize(wakeDependencies(tx.row.state,tx.content,policy.actorId))!==canonicalize(wakeDependencies(tx.state,tx.content,policy.actorId))};
}
const pendingQuery="SELECT * FROM spatial_intents WHERE session_id=$1 AND actor_id=$2 AND execution_context->>'mode'='scene-policy' AND scene_outcome IS NULL ORDER BY intent_id";
export async function prepareScenePolicy(runtime,handle){
  const principal=runtime.internal(handle);
  return runtime.locked(principal.sessionId,{kind:'scene-policy-prepare'},async tx=>{
    await authorize(runtime,tx,principal);
    const pending=(await tx.client.query(pendingQuery,[principal.sessionId,principal.actorId])).rows;
    if(pending.length)return {kind:'recovery',intentId:pending[0].intent_id};
    await advanceSpatialTime(tx);
    const read=await scenePolicyInput(tx,principal),choice=decideGaolaoScenePolicy(read.input),evaluatedThroughSeq=tx.state.sessionSeq;
    if(!read.input.eligibility.authorized)throw new RuntimeError('FORBIDDEN');
    if(choice.kind!=='action')return {kind:'idle',reason:choice.reason,evaluatedThroughSeq};
    const current=bindings(tx,principal,read);
    const old=(await tx.client.query("SELECT intent_id,execution_context,scene_outcome FROM spatial_intents WHERE session_id=$1 AND actor_id=$2 AND execution_context->>'mode'='scene-policy' AND execution_context->'scenePolicyBasis'->>'stepKey'=$3 ORDER BY (execution_context->'scenePolicyBasis'->>'attempt')::integer DESC LIMIT 1",[principal.sessionId,principal.actorId,choice.stepKey])).rows[0];
    if(old){
      const previous=old.execution_context.scenePolicyBasis;
      const previousBindings=Object.fromEntries(Object.keys(current).map(k=>[k,previous[k]]));
      if(old.scene_outcome?.status==='Accepted'&&choice.stepKey!=='retreat-navigation'||canonicalize(previousBindings)===canonicalize(current))return {kind:'idle',reason:'当前逻辑步骤已有确定原结果。',evaluatedThroughSeq};
    }
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
  const read=await scenePolicyInput(tx,principal),choice=decideGaolaoScenePolicy(read.input),current=bindings(tx,principal,read);
  const original=Object.fromEntries(Object.keys(current).map(k=>[k,basis[k]])),{movementCommandSeq,...action}=request.action;
  if(choice.kind!=='action'||choice.stepKey!==basis.stepKey||canonicalize(choice.action)!==canonicalize(action)||canonicalize(current)!==canonicalize(original))throw new RuleError('STALE_PRECONDITION');
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
