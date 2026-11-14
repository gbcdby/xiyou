import {createPersonalState,personalSources,personalScopeDigest,personalDecisionBinding,ownPersonalSource} from '../../game/gaolao-personal-contract.mjs';

/** 仅供纯策略/私有合同检查；不写数据库，不充当正常玩家或生产初始化证据。 */
export function personalFixture(content,{destinationId='front-guest-room',safe=true}={}){
  const own=content.chapterRules.people.cuilan,destination=content.chapterRules.safeDestinations.find(d=>d.destinationId===destinationId);
  const characters=Object.fromEntries(content.npcs.map(n=>[n.characterId,{...structuredClone(n),kind:'core_npc',mode:'CoreNPCControlled',controlEpoch:'1',resourceRevision:'0',movement:null}]));
  Object.assign(characters[own],{sceneId:destination.sceneId,position:structuredClone(destination.position)});
  for(const id of ['human-a','human-b'])characters[id]={characterId:id,kind:'human',actorKind:'human',mode:'HumanControlled',controlEpoch:'1',resourceRevision:'0',sceneId:destination.sceneId,position:structuredClone(destination.position),movement:null};
  const state={sessionSeq:'100',contentVersion:content.contentVersion,chapterVersion:content.chapterVersion,reducerVersion:content.reducerVersion,mapVersion:content.mapVersion,variantId:content.variantId,phase:'Running',paused:false,characters,
    targets:Object.fromEntries(content.targets.map(t=>[t.targetId,structuredClone(t)])),observations:{[own]:[]},views:{[own]:{viewId:'V'.repeat(40)}},chapter:{...createPersonalState(),consents:{},consentSlots:{},follows:{},provenance:{[own]:{}},sourceTokens:{},retreated:true,cuilanSafe:safe,onlineActorIds:['human-a','human-b'],
      safeRecord:safe?{subjectId:own,consentId:'F'.repeat(40),consentVersion:'2',followId:'L'.repeat(40),planVersion:'3',destinationId,sourceSeq:'9'}:null}};
  for(const [i,source] of personalSources(content).entries()){
    const declaration=source.knowledge.declaration,sourceRef=(i?'P':'A').repeat(40),observationRef=(i?'Q':'O').repeat(40);
    state.chapter.sourceTokens[source.sourceId]=sourceRef;
    state.chapter.provenance[own][observationRef]={sourceId:source.sourceId,personalSource:source,retainedObservation:{observationRef,category:declaration.category,statement:declaration.statement,fields:structuredClone(declaration.fields),sourceSeq:'4',shareable:false,
      source:{sourceRef,kind:declaration.kind,label:declaration.label,beforeArrivalDays:declaration.beforeArrivalDays,receivedSeq:'4'}}};
  }
  return state;
}

export function proposePersonalFixture(state,content,purpose,{term='single_use',destinationId='front-meeting',requesterId='human-a',sourceSeq='20',consentId=(purpose==='appearance'?'C':'I').repeat(40),itemIds=['gz-parcel','gz-letter']}={}){
  const subjectId=content.chapterRules.people.cuilan,source=personalSources(content).find(s=>s.purpose===purpose);
  const scope=purpose==='appearance'?{destinationId,permissionTerm:term,usage:'inquiry_meeting',radius:90}:{itemIds,ownerId:subjectId,handling:'retrieve_to_owner',permissionTerm:term,offerRef:'T'.repeat(40),sourceRevision:source.sourceRevision,sourceDigest:source.digest};
  const performerId=purpose==='appearance'?content.chapterRules.people.wukong:null;
  const consent={consentId,subjectId,requesterId,performerId,purpose,scope,version:'1',status:'proposed',sourceSeq};
  const proposalBinding={subjectId,subjectEpoch:state.characters[subjectId].controlEpoch,requesterId,requesterEpoch:state.characters[requesterId].controlEpoch,performerId,performerEpoch:performerId?state.characters[performerId].controlEpoch:null,scopeDigest:personalScopeDigest(purpose,scope),contentVersion:content.contentVersion,chapterVersion:content.chapterVersion,mapVersion:content.mapVersion,policyVersion:'gaolao-cuilan-v2',consentVersion:'1',requestActionId:'request-'+purpose,requestDigest:'a'.repeat(64),sourceSeq,requestObservationRef:'R'.repeat(40),receivedSeq:sourceSeq};
  state.chapter.consents[consentId]=consent;state.chapter.consentSlots[`${subjectId}:${purpose}`]=consentId;
  state.chapter.personalRequests[consentId]={consentId,lifecycleVersion:'1',lifecycle:'open',reasonCode:null,transitionActor:requesterId,transitionSeq:sourceSeq,proposalBinding,execution:{state:'none',acceptedProof:null,appearanceStarted:false,appearanceEnded:false,itemUses:[]},notice:null};
  return consent;
}

/** 合法 accepted 后收到停权通知的合同切面；不伪称本辅助器执行过本人响应。 */
export function invalidatedPersonalFixture(state,content,consent){
  const record=state.chapter.personalRequests[consent.consentId],binding=record.proposalBinding,{knowledge,...source}=ownPersonalSource(state,content,consent.subjectId,consent.purpose);
  const identityKeys=['subjectId','subjectEpoch','requesterId','requesterEpoch','performerId','performerEpoch','scopeDigest','contentVersion','chapterVersion','mapVersion','policyVersion'];
  consent.status='accepted';consent.version='2';consent.decidedBy=consent.subjectId;
  record.lifecycleVersion='3';record.reasonCode='binding_invalidated';record.transitionActor=null;record.transitionSeq='31';
  record.execution={state:consent.purpose==='appearance'?'ended':'return_only',acceptedProof:{...Object.fromEntries(identityKeys.map(key=>[key,binding[key]])),consentVersion:'2',actionId:'owner-accept-'+consent.purpose,requestDigest:'b'.repeat(64),sources:[source]},appearanceStarted:false,appearanceEnded:consent.purpose==='appearance',itemUses:consent.purpose==='private_items'?consent.scope.itemIds.map(itemId=>({itemId,takeActionId:null,acquisitionId:null,outcome:'pending'})):[]};
  record.notice={noticeId:'N'.repeat(40),consentId:consent.consentId,acceptedConsentVersion:'2',reasonCode:'binding_invalidated',sourceEventId:'session:E30',sourceSeq:'30',receivedSeq:'31'};
  return record;
}

export function personalBasisFixture(state,content,purpose,{actionId='scene-a',requestDigest='b'.repeat(64)}={}){
  const actorId=content.chapterRules.people.cuilan,personal=personalDecisionBinding(state,actorId,purpose),{knowledge,...source}=ownPersonalSource(state,content,actorId,purpose);
  return {policyVersion:'gaolao-cuilan-v2',branch:purpose,stepKey:`${purpose}:${personal.consentId}:${personal.consentVersion}:${personal.lifecycleVersion}:${personal.status==='accepted'?'withdraw':'response'}`,actionId,requestDigest,evaluatedThroughSeq:state.sessionSeq,
    contentVersion:content.contentVersion,chapterVersion:content.chapterVersion,mapVersion:content.mapVersion,subjectEpoch:state.characters[actorId].controlEpoch,viewId:'V'.repeat(40),subjectRef:'S'.repeat(40),subjectRevision:'5',previousIntentId:null,attempt:1,personal,sources:[source],safeRecord:structuredClone(state.chapter.safeRecord),
    guards:{authorized:true,proposalCurrent:personal.status==='proposed',scopeKnown:true,safeCurrent:true,near:true,visible:true,los:true,exitReachable:true,noticeCurrent:!!personal.notice}};
}
