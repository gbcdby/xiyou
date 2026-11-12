import { opaqueRef, next, entityRef, canSee, inRange, unoccluded } from './spatial-world.mjs';
import {spatialSchema} from '../protocol/spatial-schema.mjs';
export const isGaolao = state => state.reducerVersion === 'gaolao-world-v1';
export const chapterPeople = content => content.chapterRules.people;
export function setupGaolaoState(state, content) {
  if (!isGaolao(state)) return;
  const groups=content.chapterRules.partyRoles[String(state.members.length)];
  state.members.forEach((m,i)=>{const a=state.characters[m.characterId],roles=groups[i];a.responsibilities=roles;a.name=content.chapterRules.roles.find(r=>r.roleId===roles[0]).name;a.appearanceName=a.name;a.capabilities.push('propose_follow','respond_consent','withdraw_consent','request_end','confirm_end');});
  for(const a of Object.values(state.characters)) if(a.kind!=='human')a.capabilities.push('respond_consent','withdraw_consent');
  state.chapter={consents:{},consentSlots:{},follows:{},decisions:{},knownDecisions:{},provenance:{},sourceTokens:{},identityKnowledge:{},progressKnown:{},borrowedItems:[],contact:false,retreated:false,cuilanSafe:false,safeRecord:null,accountsCompared:false,explanations:{},route:'undecided',disguise:null,recruitmentEnded:false,endProposal:null,endVersion:'0',departureArrangement:null,onlineActorIds:[]};
}
export function changeChapter(tx, update) { const chapter=structuredClone(tx.state.chapter);update(chapter);tx.emit('gaolao.chapter',{chapter});return tx.state.chapter; }
export function observerName(state, observerId, actor) {
  if(!isGaolao(state)||!state.chapter?.disguise||state.chapter.disguise.actorId!==actor.characterId)return actor.appearanceName;
  return observerId===actor.characterId||state.chapter.identityKnowledge[observerId]?.[actor.characterId] ? '孙悟空（借貌）' : actor.appearanceName;
}
export const consentFor = (state,subjectId,purpose) => state.chapter.consents[state.chapter.consentSlots[`${subjectId}:${purpose}`]];
export const consentVersion = (state,subjectId,purpose) => consentFor(state,subjectId,purpose)?.version ?? '0';
export function observeGaolao(tx,observerId,{statement,fields=[],category='WorldFact',sourceId=null,kind='contact',label='现场观察',beforeArrivalDays=0,metadata={},shareable=true,sourceSeq=null}){
  const observationRef=opaqueRef();
  let token=sourceId?tx.state.chapter.sourceTokens[sourceId]:null;
  if(sourceId&&!token){token=opaqueRef();changeChapter(tx,c=>{c.sourceTokens[sourceId]=token;});}
  const seq=sourceSeq??next(tx.state.sessionSeq);
  const observation={observationRef,category,statement,sourceSeq:seq,fields:structuredClone(fields),shareable,...(sourceId?{source:{sourceRef:token,kind,label,beforeArrivalDays,receivedSeq:next(tx.state.sessionSeq)}}:{})};
  tx.emit('spatial.observation',{observerId,observation},{humanCharacterIds:[observerId],coreNpcCharacterIds:[observerId],proxyCharacterIds:shareable?[observerId]:[]});
  if(sourceId)changeChapter(tx,c=>{c.provenance[observerId]??={};c.provenance[observerId][observationRef]={sourceId,...structuredClone(metadata)};});
  return observation;
}
export const knowsSource=(state,actorId,sourceId)=>Object.values(state.chapter.provenance[actorId]??{}).some(m=>m.sourceId===sourceId);
/** 许可状态在发生时只交给参与者；完整历史复用原授权观察与复盘分页。 */
export function observeConsentChange(tx,consent){
  const purpose={follow:'随行',appearance:'借用外貌',private_items:'私物处理',meeting:'会面',membership:'加入'}[consent.purpose];
  const status={proposed:'等待本人回应',accepted:'本人接受',declined:'本人拒绝',deferred:'本人暂缓',withdrawn:'本次许可撤回或由新安排替代'}[consent.status];
  const sourceSeq=tx.state.sessionSeq,fields=[{key:'consent',label:'许可记录',value:consent.consentId},{key:'purpose',label:'用途',value:consent.purpose},{key:'version',label:'当时版本',value:consent.version},{key:'status',label:'当时状态',value:consent.status}];
  if(consent.scope.destinationId)fields.push({key:'destination',label:'本次目的地',value:consent.scope.destinationId});
  for(const id of new Set([consent.subjectId,consent.requesterId,consent.scope.leaderId,consent.performerId].filter(Boolean)))observeGaolao(tx,id,{statement:`${purpose}许可：${status}。`,fields,shareable:false,sourceSeq});
}
export function nearbyObservers(tx,actor,radius=tx.content.movement.hearingRadius){return Object.values(tx.state.characters).filter(c=>inRange(tx.state,tx.content,actor,c,radius)&&unoccluded(tx.state,tx.content,actor,c)).map(c=>c.characterId);}
export function recordProgress(tx,ids,key,label,value){for(const id of new Set(ids)){changeChapter(tx,c=>{c.progressKnown[id]??={};c.progressKnown[id][key]={key,label,value};});observeGaolao(tx,id,{statement:label,fields:[{key,label,value}]});}}
export function copyGaolaoEvidence(tx,actorId,observation,recipientIds){
  const meta=tx.state.chapter.provenance[actorId]?.[observation.observationRef];
  for(const id of new Set(recipientIds)){
    const copy={...structuredClone(observation),observationRef:opaqueRef(),...(observation.source?{source:{...observation.source,receivedSeq:next(tx.state.sessionSeq)}}:{})};
    tx.emit('spatial.observation',{observerId:id,observation:copy},{humanCharacterIds:[id],coreNpcCharacterIds:[id],proxyCharacterIds:copy.shareable?[id]:[]});
    if(meta)changeChapter(tx,c=>{c.provenance[id]??={};c.provenance[id][copy.observationRef]=structuredClone(meta);if(meta.decision){c.knownDecisions[id]??={};c.knownDecisions[id][meta.decision.subjectId]=structuredClone(meta.decision);}});
  }
}
export function currentDecision(state,subjectId,purpose){return state.chapter.decisions[subjectId]??{subjectId,purpose,version:'0',status:'undecided',sourceSeq:'0'};}
export function publicItemsReturned(state,content){const at=state.targets[content.chapterRules.returnTargetId];return state.chapter.borrowedItems.every(id=>{const item=state.items[id];return !item.lockedBy&&item.location.kind==='ground'&&item.location.sceneId===at.sceneId&&Math.hypot(item.location.position.x-at.position.x,item.location.position.y-at.position.y)<=20;});}
export function gaolaoOperations(state,content,observerId,entity){
  if(!isGaolao(state)||!state.chapter)return [];
  const p=chapterPeople(content),id=entity.characterId,own=id===observerId,observer=state.characters[observerId];
  if(!id)return entity.operationIds?.filter(x=>x!=='gz-lock-support')??[];
  let ops=[];
  if(own){if(id===p.cuilan)ops.push('gz-step-back','gz-confirm-settlement','gz-pause-follow');if(id===p.wukong)ops.push('gz-apply-appearance','gz-release-appearance');if(id===p.tang)ops.push('gz-show-passage','gz-confirm-meeting','gz-recruitment-decision','gz-finish-separation');if(id===p.bajie)ops.push('gz-confirm-meeting','gz-membership-decision','gz-join-party');}
  // 未识破时两个同貌对象提供同一类请求入口；只有规则解析真身后才能授予许可。
  if(observer.kind==='human'){
    if(id===p.cuilan||state.chapter.disguise?.actorId===id)ops.push('gz-request-appearance','gz-request-private-items');
    if([p.tang,p.bajie].includes(id)&&entity.appearanceName!=='翠兰')ops.push('gz-invite-meeting');
    if(id===p.witness)ops.push('gz-hear-witness');
  }
  if(state.chapter.disguise&&[p.wukong,p.cuilan].includes(id)){ops.push('gz-check-appearance');if(id===p.wukong&&(state.chapter.identityKnowledge[observerId]?.[id]||own))ops.push('gz-reveal-identity');}
  return ops;
}
export function projectGaolao(state,content,actorId,view){
  const c=state.chapter,a=state.characters[actorId],p=chapterPeople(content),r=id=>entityRef(view,id);
  const permitted=x=>[x.subjectId,x.requesterId,x.scope?.leaderId,x.performerId].includes(actorId);
  const chronological=(a,b)=>BigInt(a.sourceSeq)<BigInt(b.sourceSeq)?-1:BigInt(a.sourceSeq)>BigInt(b.sourceSeq)?1:0;
  const allowed=Object.values(c.consents).filter(permitted).sort(chronological),currentIds=new Set(Object.values(c.consentSlots));
  // 当前用途槽必须保留；剩余位置才给最近历史。持久同意与发生时事件不删改。
  const current=allowed.filter(x=>currentIds.has(x.consentId)),remaining=spatialSchema.$defs.ChapterViewV2.properties.consents.maxItems-current.length;
  const history=remaining>0?allowed.filter(x=>!currentIds.has(x.consentId)).slice(-remaining):[];
  const consents=[...current,...history].sort(chronological).map(x=>({consentId:x.consentId,subjectRef:r(x.subjectId),requesterRef:r(x.requesterId),purpose:x.purpose,scope:{...(x.scope.destinationId?{destinationId:x.scope.destinationId}:{}),...(x.scope.leaderId?{leaderRef:r(x.scope.leaderId)}:{}),...(x.scope.itemIds?{itemRefs:x.scope.itemIds.map(r)}:{})},version:x.version,status:x.status,sourceSeq:x.sourceSeq}));
  const follows=Object.values(c.follows).filter(x=>[x.subjectId,x.leaderId,x.requesterId].includes(actorId)).map(x=>({followId:x.followId,subjectRef:r(x.subjectId),leaderRef:r(x.leaderId),destinationId:x.destinationId,planVersion:x.planVersion,consentId:x.consentId,consentVersion:x.consentVersion,status:x.status,reason:x.reason??''}));
  const known={...(c.knownDecisions[actorId]??{}),...(c.decisions[actorId]?{[actorId]:c.decisions[actorId]}:{})};
  const decisions=Object.values(known).map(x=>({decisionId:x.decisionId,subjectRef:r(x.subjectId),purpose:x.purpose,version:x.version,status:x.status,sourceSeq:x.sourceSeq}));
  const e=c.endProposal,endProposal=a.kind==='human'&&e?{proposalId:e.proposalId,proposalVersion:e.proposalVersion,scope:e.scope,onlineMembershipVersion:e.onlineMembershipVersion,requiredCount:e.requiredIds.length,confirmedCount:e.confirmedIds.length,ownConfirmed:e.confirmedIds.includes(actorId),status:e.status}:null;
  return {chapterId:'gaolaozhuang',responsibilities:a.responsibilities??[],progress:Object.values(c.progressKnown[actorId]??{}),consents,follows,decisions,destinations:[...content.chapterRules.safeDestinations.map(({destinationId,label,sceneId,position})=>({destinationId,label,sceneId,position,purpose:'follow'})),...content.chapterRules.meetingDestinations.map(x=>({...x,purpose:'meeting'})),{destinationId:'departure',label:'离庄出发点',...content.chapterRules.departure,purpose:'departure'},...content.chapterRules.waiting.map((x,i)=>({destinationId:'waiting-'+i,label:'公开等待或归处',...x,purpose:'waiting'}))],endProposal,publicItems:a.kind==='human'?content.items.filter(x=>x.publicBorrowable).map(x=>({itemRef:r(x.itemId),name:x.name,borrowed:c.borrowedItems.includes(x.itemId),returned:c.borrowedItems.includes(x.itemId)&&publicItemsReturned({...state,chapter:{...c,borrowedItems:[x.itemId]}},content)})):[],...(actorId===p.wukong||c.identityKnowledge[actorId]?.[p.wukong]?{route:c.route}:{})};
}
