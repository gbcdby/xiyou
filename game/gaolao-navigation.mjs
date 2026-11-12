import {isGaolao,consentFor} from './gaolao-world.mjs';
import {sceneOf} from './spatial-world.mjs';
import {distance} from './spatial-geometry.mjs';

const active=movement=>movement&&['accepted','moving'].includes(movement.status);
/** 目的地及跨场景的第一段出口均来自已声明范围；同场景其他目标不继承会面许可。 */
function towards(state,content,actorId,action,destination){
  if(action.sceneId===destination.sceneId&&distance(action.destination,destination.position)<=90)return true;
  const actor=state.characters[actorId];
  if(actor.sceneId===destination.sceneId||action.sceneId!==actor.sceneId)return false;
  const scene=sceneOf(content,actor.sceneId),exit=scene.exits.find(e=>e.destinationSceneId===destination.sceneId);
  return !!exit&&distance(action.destination,scene.anchors.find(a=>a.anchorId===exit.anchorId).position)<=20;
}

/** 只在受信意图预留时生成依赖；公共动作不能自填，也不能在晚到提交时改绑新版许可。 */
export function gaolaoNavigationDependencies(state,content,actorId,action){
  if(!isGaolao(state)||action.kind!=='move_to')return null;
  const dependencies={},consent=consentFor(state,actorId,'meeting'),rules=content.chapterRules;
  const meeting=rules.meetingDestinations.find(d=>d.destinationId===consent?.scope.destinationId);
  if(consent?.status==='accepted'&&meeting&&towards(state,content,actorId,action,meeting))dependencies.consent={subjectId:actorId,consentId:consent.consentId,purpose:'meeting',version:consent.version,destinationId:meeting.destinationId};
  const arrangement=state.chapter.departureArrangement,ending=rules.endings.find(e=>e.endingCode===arrangement?.branch);
  if(arrangement?.recipientIds.includes(actorId)){
    const destinations=ending.departureActorIds.includes(actorId)?[rules.departure]:ending.waitingActorIds.includes(actorId)?rules.waiting:[];
    if(destinations.some(d=>towards(state,content,actorId,action,d)))dependencies.departure={sourceSeq:arrangement.sourceSeq,branch:arrangement.branch};
  }
  return Object.keys(dependencies).length?dependencies:null;
}

export function gaolaoNavigationRejection(state,actorId,dependencies){
  if(!dependencies)return null;
  if(!isGaolao(state))return 'NOT_READY';
  const basis=dependencies.consent;
  if(basis){
    const current=consentFor(state,actorId,'meeting');
    if(basis.subjectId!==actorId||basis.purpose!=='meeting'||!current||current.consentId!==basis.consentId||current.version!==basis.version||current.status!=='accepted'||current.scope.destinationId!==basis.destinationId)return 'CONSENT_STALE';
  }
  const departure=dependencies.departure,arrangement=state.chapter.departureArrangement;
  if(departure&&(!arrangement||arrangement.sourceSeq!==departure.sourceSeq||arrangement.branch!==departure.branch||departure.branch==='GZ-E01'&&state.chapter.recruitmentEnded))return 'NOT_READY';
  return null;
}

export function cancelGaolaoNavigation(tx,actorId,matches,reason){
  const actor=tx.state.characters[actorId];
  if(active(actor.movement)&&matches(actor.movement.chapterDependencies??{}))tx.emit('spatial.actor',{actor:{...actor,movement:{...actor.movement,status:'cancelled',reason}}});
}
