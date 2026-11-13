import { RuleError } from './rules.mjs';
import { opaqueRef,next,sceneOf,obstacleEnabled,resolveRef,ensureView,inRange,unoccluded,canSee } from './spatial-world.mjs';
import { findPath,pointAlongPath,facingAlongPath,distance,inPolygon,clearSegment,walkable } from './spatial-geometry.mjs';
import {scenePolicy,routeSources,createPolicyRoute,policyRouteValid,checkPolicyLeader,policyLocalPath,actualFrontExit,policySummary} from './gaolao-policy-route.mjs';
import { isGaolao,chapterPeople,changeChapter,consentFor,consentVersion,observeGaolao,observeConsentChange,knowsSource,nearbyObservers,recordProgress,currentDecision,publicItemsReturned } from './gaolao-world.mjs';
import {cancelGaolaoNavigation} from './gaolao-navigation.mjs';
const refuse=code=>{throw new RuleError(code);};
const actorEvent=(tx,a)=>tx.emit('spatial.actor',{actor:a});
const near=(tx,a,b)=>{if(!inRange(tx.state,tx.content,a,b,tx.content.movement.interactionRadius))refuse('OUT_OF_RANGE');if(!unoccluded(tx.state,tx.content,a,b))refuse('OCCLUDED');};
const own=(actorId,target,id,principalKind)=>{if(actorId!==id||target.characterId!==id||!['core_npc','scene_role'].includes(principalKind))refuse('RULE_VIOLATION');};
const human=(tx,id,principalKind)=>{if(principalKind!=='human'||!tx.liveActorIds?.has(id))refuse('RULE_VIOLATION');};
const bump=(tx,id)=>{const a=tx.state.characters[id];actorEvent(tx,{...a,resourceRevision:next(a.resourceRevision)});};
const fact=(state,id,key)=>state.targets[id]?.fields.find(f=>f.key===key)?.value;
const doorOpen=tx=>fact(tx.state,tx.content.chapterRules.sealTargetId,'open')===true;
const activeFollow=f=>f&&['accepted','following','arrived'].includes(f.status);
function targetField(tx,id,key,label,value){const t=structuredClone(tx.state.targets[id]),old=t.fields.find(f=>f.key===key);if(old)old.value=value;else t.fields.push({key,label,value});t.resourceRevision=next(t.resourceRevision);tx.emit('spatial.target',{target:t});}
function cancelDeparture(tx){const arrangement=tx.state.chapter.departureArrangement;if(!arrangement)return;changeChapter(tx,c=>{c.departureArrangement=null;});for(const id of arrangement.recipientIds)cancelGaolaoNavigation(tx,id,d=>d.departure?.sourceSeq===arrangement.sourceSeq,'当事人安排或决定已经变化。');}
function endFacts(tx){return [{key:'safe',label:'真实本人已安全安置',value:tx.state.chapter.cuilanSafe},{key:'open',label:'后宅可自由出入',value:doorOpen(tx)},{key:'returned',label:'本队借出公共物实际归还',value:publicItemsReturned(tx.state,tx.content)},{key:'compared',label:'材料送达及真实会面已完成',value:tx.state.chapter.accountsCompared},{key:'recruitmentEnded',label:'团队明确结束未决招徒',value:tx.state.chapter.recruitmentEnded}];}
function finish(tx,code){const names={'GZ-E01':['自愿同行','双方有效选择已经落实为实际同行。救援与入队分别记录。'],'GZ-E02':['各走各路','已经安全分别；未达成同行不代表所有财物或承诺已和解。'],'GZ-E03':['暂告一段','按当前实际进展结束；尚未完成的事项保持未完成。']};tx.emit('session.finished',{endingCode:code,title:names[code][0],summary:names[code][1],facts:endFacts(tx)});}
function releaseAppearance(tx){const d=tx.state.chapter.disguise;if(!d)return;const a=tx.state.characters[d.actorId],witnesses=nearbyObservers(tx,a).filter(id=>canSee(tx.state,tx.content,id,a));changeChapter(tx,c=>{c.disguise=null;c.route='public';for(const id of witnesses){c.identityKnowledge[id]??={};c.identityKnowledge[id][a.characterId]=next(tx.state.sessionSeq);}});actorEvent(tx,{...a,appearanceName:a.name,appearanceEpoch:next(a.appearanceEpoch),resourceRevision:next(a.resourceRevision),motionViews:{},movement:a.movement?{...a.movement,status:'cancelled',reason:'外观已经改变。'}:null});for(const id of witnesses)observeGaolao(tx,id,{statement:'亲眼看到外貌解除，确认了眼前人的身份。',fields:[{key:'identity',label:'本人显现身份',value:a.name}]});}
function consentRequest(tx,actorId,subjectId,purpose,scope,expectedVersion,performerId=null){
  if(consentVersion(tx.state,subjectId,purpose)!==expectedVersion)refuse('CONSENT_STALE');
  const previous=consentFor(tx.state,subjectId,purpose),consent={consentId:opaqueRef(),subjectId,requesterId:actorId,purpose,scope,version:next(expectedVersion),status:'proposed',decidedBy:null,sourceSeq:next(tx.state.sessionSeq),...(performerId?{performerId}:{})};
  changeChapter(tx,c=>{if(previous)c.consents[previous.consentId].status='withdrawn';c.consentSlots[`${subjectId}:${purpose}`]=consent.consentId;c.consents[consent.consentId]=consent;});
  if(previous)observeConsentChange(tx,tx.state.chapter.consents[previous.consentId]);
  observeConsentChange(tx,consent);
  if(previous)cancelGaolaoNavigation(tx,subjectId,d=>d.consent?.consentId===previous.consentId,'本次许可已改约，原会面导航取消。');
  if(purpose==='appearance'&&previous?.consentId===tx.state.chapter.disguise?.consentId)releaseAppearance(tx);
  return consent;
}
function consentResponse(tx,actorId,action){
  const consent=tx.state.chapter.consents[action.consentId];if(!consent||consent.subjectId!==actorId)refuse('STALE_REFERENCE');
  if(consent.version!==action.expectedConsentVersion||tx.state.chapter.consentSlots[`${actorId}:${consent.purpose}`]!==consent.consentId)refuse('CONSENT_STALE');
  if(consent.status==='withdrawn')refuse('CONSENT_STALE');
  if(scenePolicy(tx.content)&&consent.purpose==='follow'&&action.kind==='respond_consent'&&!tx.scenePolicyAuthorization)refuse('RULE_VIOLATION');
  const status=action.kind==='withdraw_consent'?'withdrawn':{accept:'accepted',decline:'declined',defer:'deferred'}[action.response];
  if(consent.purpose==='follow'&&status==='accepted'){
    const f=tx.state.chapter.follows[actorId],leader=tx.state.characters[consent.scope.leaderId];
    if(!f||f.consentId!==consent.consentId||!doorOpen(tx)||!tx.liveActorIds.has(leader?.characterId))refuse('NOT_READY');
    near(tx,tx.state.characters[actorId],leader);
  }
  if(consent.purpose==='appearance'&&status==='accepted'&&!tx.state.chapter.cuilanSafe)refuse('NOT_READY');
  changeChapter(tx,c=>{const x=c.consents[action.consentId];x.status=status;x.decidedBy=actorId;x.version=next(x.version);x.sourceSeq=next(tx.state.sessionSeq);if(x.purpose==='follow'){const f=c.follows[actorId];if(f?.consentId===x.consentId){f.consentVersion=x.version;f.planVersion=next(f.planVersion);f.status=status==='accepted'?'accepted':status==='withdrawn'?'withdrawn':status==='deferred'?'paused':'cancelled';f.reason=status==='accepted'?'':'本人尚未同意继续当前安排。';f.subjectEpoch=tx.state.characters[actorId].controlEpoch;f.leaderEpoch=tx.state.characters[f.leaderId].controlEpoch;f.lastSceneTime=tx.state.sceneTimeMs;}}});
  if(status==='accepted'&&consent.purpose==='follow'&&tx.scenePolicyAuthorization)changeChapter(tx,c=>{
    const f=c.follows[actorId];
    // 原准备 basis 不改写；执行关联指向实际增长后的版本和同事务原 Receipt 身份。
    f.policyRoute.acceptance={consentId:f.consentId,consentVersion:f.consentVersion,planVersion:f.planVersion,actionId:tx.cause.actionId,requestDigest:tx.scenePolicyAuthorization.requestDigest};
  });
  // 重复原请求由 Receipt 恢复；新的回应改变版本，原外貌许可必须立即失效。
  if(consent.purpose==='appearance'&&tx.state.chapter.disguise?.consentId===consent.consentId)releaseAppearance(tx);
  cancelGaolaoNavigation(tx,actorId,d=>d.consent?.consentId===consent.consentId,'本人回应改变了许可版本，原会面导航取消。');
  observeConsentChange(tx,tx.state.chapter.consents[consent.consentId]);
  bump(tx,actorId);return {};
}
function followProposal(tx,actorId,principalKind,request){
  human(tx,actorId,principalKind);const action=request.action,subject=resolveRef(tx,actorId,action.subjectRef,request.viewId),leader=resolveRef(tx,actorId,action.leaderRef,request.viewId),p=chapterPeople(tx.content);
  if(subject.characterId!==p.cuilan||leader.kind!=='human'||!tx.liveActorIds.has(leader.characterId))refuse('RULE_VIOLATION');
  near(tx,tx.state.characters[actorId],subject);near(tx,subject,leader);if(!doorOpen(tx))refuse('NOT_READY');
  const destination=tx.content.chapterRules.safeDestinations.find(d=>d.destinationId===action.destinationId);if(!destination)refuse('TARGET_UNAVAILABLE');
  // 新领路者只持有合法可见的人物版本；不要求读取上一份私有许可。
  const publicRevision=Object.hasOwn(action,'expectedTargetRevision');
  if(publicRevision&&subject.resourceRevision!==action.expectedTargetRevision)refuse('STALE_PRECONDITION');
  const expectedVersion=publicRevision?consentVersion(tx.state,p.cuilan,'follow'):action.expectedConsentVersion;
  const old=tx.state.chapter.follows[p.cuilan],consent=consentRequest(tx,actorId,p.cuilan,'follow',{destinationId:destination.destinationId,leaderId:leader.characterId},expectedVersion);
  const follow={followId:opaqueRef(),subjectId:p.cuilan,requesterId:actorId,leaderId:leader.characterId,destinationId:destination.destinationId,planVersion:next(old?.planVersion??'0'),routeVersion:tx.state.mapVersion,consentId:consent.consentId,consentVersion:consent.version,status:'proposed',reason:'等待本人确认这次安排。',subjectEpoch:subject.controlEpoch,leaderEpoch:leader.controlEpoch,lastSceneTime:tx.state.sceneTimeMs};
  if(scenePolicy(tx.content))follow.policyRoute=createPolicyRoute(tx.state,tx.content,subject,leader,destination.destinationId);
  changeChapter(tx,c=>{c.follows[p.cuilan]=follow;});
  // 兼容的旧格式也推进公开围栏，防止同一人物版本的另一提议覆盖本次安排。
  bump(tx,p.cuilan);
  if(follow.policyRoute)for(const id of new Set([subject.characterId,actorId,leader.characterId]))observeGaolao(tx,id,{statement:policySummary(tx.content,follow.policyRoute,destination.destinationId),shareable:false,fields:[{key:'destination',label:'本次提议地点',value:destination.destinationId},{key:'consent',label:'待回应许可',value:consent.consentId},{key:'version',label:'提议版本',value:consent.version}]});
  return {};
}
export function initializeGaolao(tx){if(!isGaolao(tx.state))return;const r=tx.content.chapterRules,p=r.people;for(const m of tx.state.members){const roles=tx.state.characters[m.characterId].responsibilities;for(const role of r.roles.filter(x=>roles.includes(x.roleId)))for(const statement of role.knowledge)observeGaolao(tx,m.characterId,{statement,shareable:true});}changeChapter(tx,c=>{c.identityKnowledge[p.wukong]={[p.wukong]:'0'};});
  if(scenePolicy(tx.content))for(const route of routeSources(tx.content)){
    if(knowsSource(tx.state,p.cuilan,route.sourceId))continue;
    const source=r.sources.find(s=>s.sourceId===route.sourceId);
    observeGaolao(tx,p.cuilan,{...source,fields:[...source.fields,...route.knowledge.landmarks.map(a=>({key:a.anchorId,label:'公开路线锚点 '+a.anchorId,value:`${a.sceneId} (${a.position.x},${a.position.y})`}))],metadata:{routeKnowledge:route.knowledge,routeDigest:route.digest}});
  }
}
export function updateGaolaoPresence(tx){if(!isGaolao(tx.state)||!tx.state.chapter)return;const ids=[...tx.liveActorIds].sort();if(JSON.stringify(ids)!==JSON.stringify(tx.state.chapter.onlineActorIds)){changeChapter(tx,c=>{c.onlineActorIds=ids;if(c.endProposal?.status==='pending')c.endProposal.status='invalidated';});tx.emit('gaolao.membership',{version:next(tx.state.onlineMembershipVersion)});}}
export function advanceGaolaoFollow(tx,sceneTimeMs,paused){
  if(!isGaolao(tx.state)||!tx.state.chapter)return;
  for(const old of Object.values(tx.state.chapter.follows)){
    if(!activeFollow(old)&&!(old.policyRoute&&old.status==='proposed'))continue;const f=structuredClone(old),subject=tx.state.characters[f.subjectId],leader=tx.state.characters[f.leaderId],consent=tx.state.chapter.consents[f.consentId];
    const pause=(reason,policyPause='unavailable')=>{changeChapter(tx,c=>{c.follows[f.subjectId]={...f,status:'paused',reason,planVersion:next(f.planVersion),lastSceneTime:sceneTimeMs,...(f.policyRoute?{policyPause}:{})};});if(f.policyRoute)for(const id of new Set([f.subjectId,f.requesterId,f.leaderId]))observeGaolao(tx,id,{statement:reason+' 请在真实本人附近重新提议。',shareable:false,fields:[{key:'follow',label:'本次安排',value:f.followId},{key:'pause',label:'停止原因',value:policyPause}]});};
    if(f.policyRoute&&!f.policyRoute.origin){pause('本人当前位置缺少已知公共路线资料。','unsupported-origin');continue;}
    if(f.policyRoute&&(f.routeVersion!==tx.state.mapVersion||!policyRouteValid(tx.state,tx.content,f)||subject.controlEpoch!==f.subjectEpoch||leader.controlEpoch!==f.leaderEpoch)){pause('本次路线或控制版本已变更。','stale');continue;}
    if(f.status==='proposed')continue;
    if(f.policyRoute){const accepted=f.policyRoute.acceptance;if(!accepted||accepted.consentId!==f.consentId||accepted.consentVersion!==f.consentVersion||accepted.planVersion!==f.planVersion){pause('本次本人接受的执行关联已失效。','stale');continue;}}
    if(paused||f.routeVersion!==tx.state.mapVersion||!tx.liveActorIds?.has(f.leaderId)||subject.controlEpoch!==f.subjectEpoch||leader.controlEpoch!==f.leaderEpoch||!consent||consent.version!==f.consentVersion||consent.status!=='accepted'){pause('当前安排暂停，请本人重新确认后继续。');continue;}
    if(f.status==='arrived'&&!f.policyRoute)continue;
    if(f.policyRoute){
      const route=checkPolicyLeader(tx.content,f.policyRoute,leader);
      if(!route){pause('当前实际带路已不符合约定的公共路线。','deviation');continue;}
      // 到达尚不等于本人确认；未 settled 的安排仍受路线与许可约束。
      if(f.status==='arrived'){if(JSON.stringify(route)!==JSON.stringify(f.policyRoute))changeChapter(tx,c=>{c.follows[f.subjectId].policyRoute=route;});continue;}
      const elapsed=Math.max(0,sceneTimeMs-f.lastSceneTime);
      if(!elapsed){if(JSON.stringify(route)!==JSON.stringify(f.policyRoute))changeChapter(tx,c=>{c.follows[f.subjectId].policyRoute=route;});continue;}
      const local=policyLocalPath(tx.content,route,subject,leader,obstacleEnabled(tx.state));
      if(!local){pause('本人的当前通路受阻，等待重新安排。','obstructed');continue;}
      const moved=pointAlongPath(local.path,elapsed*tx.content.movement.speedPerSecond/1000),segments=[subject.position,...local.path.slice(1,moved.index),moved.position];
      if(segments.some((point,i)=>i&&!clearSegment(local.scene,segments[i-1],point,obstacleEnabled(tx.state)))){pause('本人的当前通路受阻，等待重新安排。','obstructed');continue;}
      const changed=distance(subject.position,moved.position)>0;
      const a={...subject,position:moved.position,facing:changed?facingAlongPath(segments,subject.facing):subject.facing,spatialRevision:changed?next(subject.spatialRevision):subject.spatialRevision,motionViews:{}};
      if(route.frontExitRequired&&!route.frontExitDone&&moved.arrived&&actualFrontExit(tx.content,a))route.frontExitDone=true;
      if(local.cross&&moved.arrived){
        const requirement=local.cross.requirement;if(requirement&&fact(tx.state,requirement.targetId,requirement.field)!==requirement.value){pause('约定入口目前不能通过。','obstructed');continue;}
        // 只在实际跨入时核对这一个入口的物理位置；不预读远处房间路径。
        if(!walkable(sceneOf(tx.content,local.cross.destinationSceneId),local.cross.destination,obstacleEnabled(tx.state))){pause('约定入口目前受阻。','obstructed');continue;}
        a.sceneId=local.cross.destinationSceneId;a.position=local.cross.destination;a.spatialRevision=next(a.spatialRevision);route.stage++;
      }
      actorEvent(tx,a);f.policyRoute=route;f.lastSceneTime=sceneTimeMs;f.status='following';
      const d=tx.content.chapterRules.safeDestinations.find(d=>d.destinationId===f.destinationId),area=sceneOf(tx.content,d.sceneId).walkableAreas.find(x=>x.areaId===d.areaId);
      if(a.sceneId===d.sceneId&&inPolygon(a.position,area.polygon)&&distance(a.position,d.position)<=20&&inRange(tx.state,tx.content,a,leader,tx.content.movement.interactionRadius)&&unoccluded(tx.state,tx.content,a,leader))f.status='arrived';
      changeChapter(tx,c=>{c.follows[f.subjectId]=f;});continue;
    }
    const elapsed=Math.max(0,sceneTimeMs-f.lastSceneTime);if(!elapsed)continue;const scene=sceneOf(tx.content,subject.sceneId);let goal=leader.position,cross=null;
    if(leader.sceneId!==subject.sceneId){cross=scene.exits.find(e=>e.destinationSceneId===leader.sceneId);if(!cross){pause('带路者已离开可达路线。');continue;}goal=scene.anchors.find(x=>x.anchorId===cross.anchorId).position;}
    const path=findPath(scene,subject.position,goal,obstacleEnabled(tx.state));if(!path){pause('通路受阻，等待重新安排。');continue;}
    const moved=pointAlongPath(path,elapsed*tx.content.movement.speedPerSecond/1000),segments=[subject.position,...path.slice(1,moved.index),moved.position],changed=distance(subject.position,moved.position)>0;
    const a={...subject,position:moved.position,facing:changed?facingAlongPath(segments,subject.facing):subject.facing,spatialRevision:changed?next(subject.spatialRevision):subject.spatialRevision,motionViews:{}};
    if(cross&&moved.arrived){a.sceneId=cross.destinationSceneId;a.position=cross.destination;a.spatialRevision=next(a.spatialRevision);}
    actorEvent(tx,a);f.lastSceneTime=sceneTimeMs;f.status='following';
    const d=tx.content.chapterRules.safeDestinations.find(d=>d.destinationId===f.destinationId),area=sceneOf(tx.content,d.sceneId).walkableAreas.find(x=>x.areaId===d.areaId);
    if(a.sceneId===d.sceneId&&inPolygon(a.position,area.polygon)&&distance(a.position,d.position)<=20&&inRange(tx.state,tx.content,a,leader,tx.content.movement.interactionRadius)&&unoccluded(tx.state,tx.content,a,leader))f.status='arrived';
    changeChapter(tx,c=>{c.follows[f.subjectId]=f;});
  }
}
export function checkGaolaoMovement(tx,actorId,action){
  if(!isGaolao(tx.state)||action.kind!=='move_to')return;
  const p=chapterPeople(tx.content),a=tx.state.characters[actorId],f=tx.state.chapter.follows[actorId];
  if(activeFollow(f))refuse('CONSENT_REQUIRED');
  if(tx.state.chapter.disguise?.actorId===actorId){const c=tx.state.chapter.consents[tx.state.chapter.disguise.consentId],d=tx.content.chapterRules.meetingDestinations.find(d=>d.destinationId===c?.scope.destinationId);if(!d||c.status!=='accepted'||c.version!==tx.state.chapter.disguise.consentVersion||action.sceneId!==d.sceneId||distance(action.destination,d.position)>90)refuse('CONSENT_REQUIRED');}
  if(actorId===p.bajie&&!tx.state.chapter.cuilanSafe&&action.sceneId!==a.sceneId)refuse('NOT_READY');
  const destination=tx.content.chapterRules.departure;
  if([p.tang,p.wukong,p.bajie].includes(actorId)&&action.sceneId===destination.sceneId&&distance(action.destination,destination.position)<=90&&!tx.state.chapter.departureArrangement)refuse('NOT_READY');
}
export function checkGaolaoItem(tx,actorId,item,action){
  if(!isGaolao(tx.state))return;
  const privateItem=tx.content.chapterRules.privateItems.find(x=>x.itemId===item.itemId);
  if(privateItem&&privateItem.ownerId!==actorId){const consent=consentFor(tx.state,privateItem.ownerId,'private_items');if(!consent||consent.status!=='accepted'||consent.requesterId!==actorId||!consent.scope.itemIds.includes(item.itemId))refuse('CONSENT_REQUIRED');}
  if(item.publicBorrowable&&action.kind==='take_item')changeChapter(tx,c=>{if(!c.borrowedItems.includes(item.itemId))c.borrowedItems.push(item.itemId);});
}
function requestEnd(tx,actorId,principalKind,action){
  human(tx,actorId,principalKind);const ids=[...tx.liveActorIds].sort();if(!ids.length)refuse('NOT_READY');
  if(ids.length===1){if(action.scope==='recruitment')refuse('SESSION_PAUSED');if(Object.values(tx.state.characters).some(a=>a.kind==='human'&&a.characterId!==actorId&&a.graceDeadlineAt&&Date.parse(a.graceDeadlineAt)>Date.parse(tx.time)))refuse('NOT_READY');}
  let e=tx.state.chapter.endProposal;
  if(action.kind==='request_end'){
    if(tx.state.chapter.endVersion!==action.proposalVersion)refuse('STALE_PRECONDITION');
    e={proposalId:action.proposalId,proposalVersion:next(action.proposalVersion),scope:action.scope,onlineMembershipVersion:tx.state.onlineMembershipVersion,requiredIds:ids,confirmedIds:[actorId],status:'pending'};
  }else{
    if(!e||e.status!=='pending'||e.proposalId!==action.proposalId||e.proposalVersion!==action.proposalVersion||e.onlineMembershipVersion!==tx.state.onlineMembershipVersion||JSON.stringify(e.requiredIds)!==JSON.stringify(ids))refuse('STALE_PRECONDITION');
    e=structuredClone(e);if(!e.confirmedIds.includes(actorId))e.confirmedIds.push(actorId);
  }
  if(e.confirmedIds.length===e.requiredIds.length)e.status='confirmed';
  if(e.status==='confirmed'&&e.scope==='recruitment')cancelDeparture(tx);
  changeChapter(tx,c=>{c.endProposal=e;c.endVersion=e.proposalVersion;if(e.status==='confirmed'&&e.scope==='recruitment')c.recruitmentEnded=true;});
  if(e.status==='confirmed'&&e.scope==='chapter')finish(tx,'GZ-E03');return {};
}
export function applyGaolaoAction(tx,actorId,principalKind,request){
  const a=tx.state.characters[actorId],action=request.action,p=chapterPeople(tx.content),r=tx.content.chapterRules;
  if(action.kind==='propose_follow')return followProposal(tx,actorId,principalKind,request);
  if(['respond_consent','withdraw_consent'].includes(action.kind)){if(!['human','core_npc','scene_role'].includes(principalKind))refuse('RULE_VIOLATION');return consentResponse(tx,actorId,action);}
  if(['request_end','confirm_end'].includes(action.kind))return requestEnd(tx,actorId,principalKind,action);
  if(action.kind!=='interact'||!action.operationId.startsWith('gz-'))return null;
  const target=resolveRef(tx,actorId,action.targetRef,request.viewId),op=action.operationId,params=action.parameters;
  near(tx,a,target);if(target.resourceRevision!==action.expectedTargetRevision)refuse('STALE_PRECONDITION');
  if(principalKind==='proxy')refuse('RULE_VIOLATION');
  if(op==='gz-contact'){
    if(target.targetId!==r.contactTargetId||!inRange(tx.state,tx.content,tx.state.characters[p.cuilan],r.contactInside,30))refuse('NOT_READY');
    // 侧窗是内容明确的近距联络通道，不是步行穿墙或全院广播。
    changeChapter(tx,c=>{c.contact=true;});for(const id of [actorId,p.cuilan])observeGaolao(tx,id,{statement:'翠兰本人从侧窗说明：希望离开后宅，愿意在开门前退到门内安全处。',category:'Claim',sourceId:'rescue-contact',label:'侧窗本人回应'});return {};
  }
  if(op==='gz-check-seal'||op==='gz-try-key'){
    if(target.targetId!==r.sealTargetId)refuse('TARGET_UNAVAILABLE');
    observeGaolao(tx,actorId,{statement:op==='gz-try-key'?'普通钥匙不适用于灌铜封住的门锁，未消耗任何物件。':'检查确认铜封与门扇受力；先固定门撑并确认门内安全。',sourceId:'seal-observed',label:'亲自在门外检查铜封',fields:[{key:'seal',label:'实际问题',value:'铜封'}]});return {};
  }
  if(op==='gz-step-back'){
    own(actorId,target,p.cuilan,principalKind);if(!tx.state.chapter.contact||!inRange(tx.state,tx.content,a,r.retreat,20))refuse('NOT_READY');changeChapter(tx,c=>{c.retreated=true;});observeGaolao(tx,p.cuilan,{statement:'本人已经实际退到门内安全位置。'});return {};
  }
  if(op==='gz-break-seal'){
    if(actorId!==p.wukong||principalKind!=='core_npc'||target.targetId!==r.sealTargetId)refuse('RULE_VIOLATION');
    if(!tx.state.chapter.retreated||!inRange(tx.state,tx.content,tx.state.characters[p.cuilan],r.retreat,20)||!fact(tx.state,r.supportTargetId,'locked')||!knowsSource(tx.state,actorId,'rescue-contact')||!knowsSource(tx.state,actorId,'seal-observed'))refuse('NOT_READY');
    if(!doorOpen(tx))targetField(tx,r.sealTargetId,'open','后宅开放',true);recordProgress(tx,nearbyObservers(tx,a),'open','铜封解除，后宅通路开放。',true);return {};
  }
  if(op==='gz-confirm-settlement'||op==='gz-pause-follow'){
    own(actorId,target,p.cuilan,principalKind);const f=tx.state.chapter.follows[actorId],c=tx.state.chapter.consents[params.consentId];
    if(!f||!c||f.consentId!==c.consentId||c.version!==params.expectedConsentVersion||f.consentVersion!==c.version||c.status!=='accepted')refuse('CONSENT_STALE');
    if(op==='gz-pause-follow'){changeChapter(tx,ch=>{ch.follows[actorId]={...f,status:'paused',reason:'本人暂停了随行。',planVersion:next(f.planVersion)};});return {};}
    const d=r.safeDestinations.find(x=>x.destinationId===f.destinationId),scene=sceneOf(tx.content,d.sceneId),area=scene.walkableAreas.find(x=>x.areaId===d.areaId);
    if(f.status!=='arrived'||f.routeVersion!==tx.state.mapVersion||f.subjectEpoch!==a.controlEpoch||f.leaderEpoch!==tx.state.characters[f.leaderId].controlEpoch||a.sceneId!==d.sceneId||distance(a.position,d.position)>20||!inPolygon(a.position,area.polygon)||!findPath(scene,a.position,d.exitPosition,obstacleEnabled(tx.state)))refuse('NOT_READY');
    changeChapter(tx,ch=>{ch.follows[actorId]={...f,status:'settled'};ch.cuilanSafe=true;ch.safeRecord??={subjectId:actorId,consentId:c.consentId,consentVersion:c.version,followId:f.followId,planVersion:f.planVersion,destinationId:d.destinationId,sourceSeq:next(tx.state.sessionSeq)};});recordProgress(tx,[actorId,f.leaderId,f.requesterId,...nearbyObservers(tx,a)],'safe','真实本人已到达并确认安置；自由出口保持开放。',true);return {};
  }
  if(op==='gz-request-appearance'){
    human(tx,actorId,principalKind);if(target.characterId!==p.cuilan)refuse('TARGET_UNAVAILABLE');if(!tx.state.chapter.cuilanSafe||!r.meetingDestinations.some(d=>d.destinationId===params.destinationId))refuse('NOT_READY');consentRequest(tx,actorId,p.cuilan,'appearance',{destinationId:params.destinationId},params.expectedConsentVersion,p.wukong);return {};
  }
  if(op==='gz-apply-appearance'){
    own(actorId,target,p.wukong,principalKind);const c=tx.state.chapter.consents[params.consentId],d=r.meetingDestinations.find(d=>d.destinationId===c?.scope.destinationId);
    if(!c||c.subjectId!==p.cuilan||c.purpose!=='appearance'||c.status!=='accepted'||c.version!==params.expectedConsentVersion||consentFor(tx.state,p.cuilan,'appearance')?.consentId!==c.consentId)refuse('CONSENT_REQUIRED');
    if(!tx.state.chapter.cuilanSafe||!d||!inRange(tx.state,tx.content,a,d,90)||tx.state.chapter.disguise)refuse('NOT_READY');
    const witnesses=nearbyObservers(tx,a).filter(id=>canSee(tx.state,tx.content,id,a));changeChapter(tx,ch=>{ch.disguise={actorId,consentId:c.consentId,consentVersion:c.version};ch.route='disguise';for(const id of [actorId,...witnesses]){ch.identityKnowledge[id]??={};ch.identityKnowledge[id][actorId]=next(tx.state.sessionSeq);}});actorEvent(tx,{...a,appearanceName:'翠兰',appearanceEpoch:next(a.appearanceEpoch),resourceRevision:next(a.resourceRevision),motionViews:{},movement:a.movement?{...a.movement,status:'cancelled',reason:'外观已经改变。'}:null});for(const id of witnesses)observeGaolao(tx,id,{statement:'亲眼看见悟空按本次许可借用外貌。'});return {};
  }
  if(op==='gz-release-appearance'){own(actorId,target,p.wukong,principalKind);releaseAppearance(tx);return {};}
  if(op==='gz-reveal-identity'){
    if(target.characterId!==p.wukong||!tx.state.chapter.disguise||!(actorId===p.wukong||tx.state.chapter.identityKnowledge[actorId]?.[p.wukong]))refuse('RULE_VIOLATION');
    const ids=nearbyObservers(tx,a);changeChapter(tx,c=>{c.route='public';for(const id of ids){c.identityKnowledge[id]??={};c.identityKnowledge[id][p.wukong]=next(tx.state.sessionSeq);}});for(const id of ids)observeGaolao(tx,id,{statement:'现场获知：眼前借用外貌的人是孙悟空。'});bump(tx,p.wukong);return {};
  }
  if(op==='gz-check-appearance'){
    if(!tx.state.chapter.disguise||![p.wukong,p.cuilan].includes(target.characterId)||![p.wukong,p.cuilan].every(id=>canSee(tx.state,tx.content,actorId,tx.state.characters[id])))refuse('NOT_READY');
    observeGaolao(tx,actorId,{statement:'现场同时出现两个相同外貌的人，需要当面核验；这条观察不单独证明各自真身。',category:'Evidence'});changeChapter(tx,c=>{c.route='public';});return {};
  }
  if(op==='gz-read-ledger'||op==='gz-hear-witness'||op==='gz-show-passage'){
    const key=op==='gz-read-ledger'?'old-ledger':op==='gz-hear-witness'?'tea-witness':'travel-document';if(op==='gz-read-ledger'&&target.targetId!==r.ledgerTargetId||op==='gz-hear-witness'&&target.characterId!==p.witness)refuse('TARGET_UNAVAILABLE');if(op==='gz-show-passage')own(actorId,target,p.tang,principalKind);
    observeGaolao(tx,actorId,r.sources.find(s=>s.sourceId===key));return {};
  }
  if(op==='gz-compare-sources'){
    if(!target.targetId?.startsWith('gz-meeting-'))refuse('TARGET_UNAVAILABLE');const metas=params.evidenceRefs.map(id=>tx.state.chapter.provenance[actorId]?.[id]);if(!metas.some(m=>m?.sourceId==='old-ledger')||!metas.some(m=>m?.sourceId==='tea-witness'))refuse('NOT_READY');
    observeGaolao(tx,actorId,{statement:'在现场比较两个独立来源和时间：两条记录均先于来客到达，支持曾提前候客的说法。',category:'Evidence',sourceId:'sources-compared',kind:'comparison',label:'旧饭账与独立证言的现场比较',metadata:{sources:['old-ledger','tea-witness']},fields:[{key:'comparison',label:'可支持的结论',value:'曾提前候客；不能据此替本人作出去留决定。'}]});return {};
  }
  if(op==='gz-invite-meeting'){
    human(tx,actorId,principalKind);if(![p.tang,p.bajie].includes(target.characterId)||!tx.state.chapter.cuilanSafe||!r.meetingDestinations.some(d=>d.destinationId===params.destinationId))refuse('NOT_READY');consentRequest(tx,actorId,target.characterId,'meeting',{destinationId:params.destinationId},params.expectedConsentVersion);return {};
  }
  if(op==='gz-confirm-meeting'){
    if(![p.tang,p.bajie].includes(actorId)||target.characterId!==actorId||principalKind!=='core_npc')refuse('RULE_VIOLATION');const cs=[p.tang,p.bajie].map(id=>consentFor(tx.state,id,'meeting')),d=r.meetingDestinations.find(d=>d.destinationId===cs[0]?.scope.destinationId);
    if(!d||cs.some(c=>!c||c.status!=='accepted'||c.scope.destinationId!==d.destinationId)||[p.tang,p.bajie].some(id=>!inRange(tx.state,tx.content,tx.state.characters[id],d,90))||!unoccluded(tx.state,tx.content,tx.state.characters[p.tang],tx.state.characters[p.bajie])||[p.tang,p.bajie].some(id=>['old-ledger','tea-witness','travel-document','sources-compared'].some(source=>!knowsSource(tx.state,id,source))))refuse('NOT_READY');
    changeChapter(tx,c=>{c.explanations[actorId]={destinationId:d.destinationId,consentVersion:consentFor(tx.state,actorId,'meeting').version};});
    if([p.tang,p.bajie].every(id=>tx.state.chapter.explanations[id]?.destinationId===d.destinationId&&tx.state.chapter.explanations[id]?.consentVersion===consentFor(tx.state,id,'meeting').version)){changeChapter(tx,c=>{c.accountsCompared=true;});recordProgress(tx,nearbyObservers(tx,a),'compared','来源比较、材料送达和真实会面已完成；去留仍由双方本人决定。',true);}return {};
  }
  if(op==='gz-recruitment-decision'||op==='gz-membership-decision'){
    const subjectId=op==='gz-recruitment-decision'?p.tang:p.bajie,purpose=op==='gz-recruitment-decision'?'recruitment':'membership';own(actorId,target,subjectId,principalKind);const old=currentDecision(tx.state,actorId,purpose);
    if(tx.state.chapter.recruitmentEnded&&(params.response!=='withdraw'||!old.decisionId))refuse('NOT_READY');
    if(old.version!==params.expectedDecisionVersion)refuse('STALE_PRECONDITION');if(params.response==='accept'&&!tx.state.chapter.accountsCompared)refuse('NOT_READY');if(!tx.state.chapter.cuilanSafe)refuse('NOT_READY');
    cancelDeparture(tx);const decision={decisionId:old.decisionId??opaqueRef(),subjectId:actorId,purpose,version:next(old.version),status:{accept:'accepted',decline:'declined',defer:'deferred',withdraw:'withdrawn'}[params.response],sourceSeq:next(tx.state.sessionSeq)};changeChapter(tx,c=>{c.decisions[actorId]=decision;});bump(tx,actorId);observeGaolao(tx,actorId,{statement:'本人提交了有版本的决定；口头意向和实际同行分别记录。',sourceId:opaqueRef(),kind:'decision',label:'本人提交的决定',metadata:{decision},fields:[{key:'decision',label:'本人决定',value:decision.status}]});return {};
  }
  if(op==='gz-release-support'){
    human(tx,actorId,principalKind);if(target.targetId!==r.supportTargetId||!doorOpen(tx))refuse('NOT_READY');for(const old of Object.values(tx.state.items).filter(i=>i.lockedBy==='gz-lock-support'))tx.emit('spatial.item',{item:{...old,lockedBy:null,resourceRevision:next(old.resourceRevision),fields:old.fields.filter(f=>f.key!=='fixed')}});return {};
  }
  if(op==='gz-return-public'){
    human(tx,actorId,principalKind);if(target.targetId!==r.returnTargetId)refuse('TARGET_UNAVAILABLE');const item=resolveRef(tx,actorId,params.itemRef,request.viewId);if(!item.itemId||!item.publicBorrowable||item.lockedBy||item.resourceRevision!==params.expectedItemRevision||item.location.kind!=='character'||item.location.characterId!==actorId)refuse('STALE_PRECONDITION');tx.emit('spatial.item',{item:{...item,resourceRevision:next(item.resourceRevision),location:{kind:'ground',sceneId:target.sceneId,position:target.position}}});return {};
  }
  if(op==='gz-request-private-items'){
    human(tx,actorId,principalKind);const items=params.itemRefs.map(ref=>resolveRef(tx,actorId,ref,request.viewId));if(!target.characterId||items.some(i=>!r.privateItems.some(p=>p.itemId===i.itemId&&p.ownerId===target.characterId)))refuse('CONSENT_REQUIRED');consentRequest(tx,actorId,target.characterId,'private_items',{itemIds:items.map(i=>i.itemId)},params.expectedConsentVersion);return {};
  }
  if(op==='gz-plan-departure'){
    if(!target.targetId?.startsWith('gz-meeting-')||!tx.state.chapter.cuilanSafe||!doorOpen(tx)||!publicItemsReturned(tx.state,tx.content)||tx.state.chapter.disguise)refuse('NOT_READY');
    const td=currentDecision(tx.state,p.tang,'recruitment'),bd=currentDecision(tx.state,p.bajie,'membership'),together=!tx.state.chapter.recruitmentEnded&&td.status==='accepted'&&bd.status==='accepted';
    if(together){if(!tx.state.chapter.accountsCompared||[td,bd].some(d=>tx.state.chapter.knownDecisions[p.wukong]?.[d.subjectId]?.version!==d.version))refuse('NOT_READY');}else if(!tx.state.chapter.recruitmentEnded&&![td,bd].some(d=>d.status==='declined'))refuse('NOT_READY');
    const ids=[p.tang,p.wukong,p.bajie];if(ids.some(id=>!inRange(tx.state,tx.content,a,tx.state.characters[id],tx.content.movement.hearingRadius)||!unoccluded(tx.state,tx.content,a,tx.state.characters[id])))refuse('OUT_OF_RANGE');
    const arrangement={branch:together?'GZ-E01':'GZ-E02',decisionVersions:{[p.tang]:td.version,[p.bajie]:bd.version},recipientIds:ids,sourceSeq:next(tx.state.sessionSeq)};changeChapter(tx,c=>{c.departureArrangement=arrangement;});for(const id of ids)observeGaolao(tx,id,{statement:together?'已合法获知：救援与公共物收尾完成，按双方仍有效决定到出发点同行。':'已合法获知：救援与公共物收尾完成，师徒离庄，另一方到公开等待或归处；未决不写成拒绝。',sourceId:opaqueRef(),kind:'arrangement',label:'现场通知的实际离庄安排'});return {};
  }
  if(op==='gz-join-party'||op==='gz-finish-separation'){
    const together=op==='gz-join-party';own(actorId,target,together?p.bajie:p.tang,principalKind);const arrangement=tx.state.chapter.departureArrangement,td=currentDecision(tx.state,p.tang,'recruitment'),bd=currentDecision(tx.state,p.bajie,'membership');
    if(!arrangement||arrangement.branch!==(together?'GZ-E01':'GZ-E02')||!tx.state.chapter.cuilanSafe||!doorOpen(tx)||!publicItemsReturned(tx.state,tx.content)||[td,bd].some(d=>arrangement.decisionVersions[d.subjectId]!==d.version))refuse('NOT_READY');
    if(together&&(tx.state.chapter.recruitmentEnded||!tx.state.chapter.accountsCompared||td.status!=='accepted'||bd.status!=='accepted'||[td,bd].some(d=>tx.state.chapter.knownDecisions[p.wukong]?.[d.subjectId]?.version!==d.version)))refuse('NOT_READY');
    const ending=r.endings.find(e=>e.endingCode===arrangement.branch);if(ending.departureActorIds.some(id=>!inRange(tx.state,tx.content,tx.state.characters[id],r.departure,30))||ending.waitingActorIds.some(id=>!r.waiting.some(w=>inRange(tx.state,tx.content,tx.state.characters[id],w,30))))refuse('NOT_READY');
    finish(tx,arrangement.branch);return {};
  }
  refuse('RULE_VIOLATION');
}

/** 降级入口只执行原目标和现有许可的安全动作，不能生成任何主观决定。 */
export function checkGaolaoFallback(tx,actorId,action){
  if(!isGaolao(tx.state))refuse('RULE_VIOLATION');
  const p=chapterPeople(tx.content),r=tx.content.chapterRules,a=tx.state.characters[actorId];
  if(['wait','stop_move'].includes(action.kind))return;
  if(action.kind==='interact'&&action.operationId==='gz-break-seal'&&actorId===p.wukong)return;
  if(action.kind!=='move_to')refuse('RULE_VIOLATION');
  let goals=[];
  if(actorId===p.wukong&&knowsSource(tx.state,actorId,'rescue-contact'))goals.push(tx.state.targets[r.sealTargetId]);
  if(actorId===p.bajie)goals.push(...r.waiting);
  const arrangement=tx.state.chapter.departureArrangement;
  if(arrangement?.recipientIds.includes(actorId)){
    const td=currentDecision(tx.state,p.tang,'recruitment'),bd=currentDecision(tx.state,p.bajie,'membership');
    if([td,bd].every(d=>arrangement.decisionVersions[d.subjectId]===d.version)&&(actorId!==p.bajie||arrangement.branch==='GZ-E01'&&bd.status==='accepted'))goals.push(r.departure);
  }
  const allowed=goals.some(g=>{if(a.sceneId===g.sceneId)return action.sceneId===g.sceneId&&distance(action.destination,g.position)<=30;const scene=sceneOf(tx.content,a.sceneId),exit=scene.exits.find(e=>e.destinationSceneId===g.sceneId);return exit&&(action.sceneId===a.sceneId&&distance(action.destination,scene.anchors.find(x=>x.anchorId===exit.anchorId).position)<=20||action.sceneId===g.sceneId&&distance(action.destination,g.position)<=30);});
  if(!allowed)refuse('RULE_VIOLATION');
}
