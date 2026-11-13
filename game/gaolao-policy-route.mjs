import {createHash} from 'node:crypto';
import {canonicalize} from '../protocol/index.mjs';
import {inPolygon,findPath,clearSegment,distance,pointAlongPath} from './spatial-geometry.mjs';

export const COURT='gaolao-courtyard', ROAD='gaolao-village-road';
export const FRONT='cuilan-route-front-v1', TEA='cuilan-route-tea-v1';
const U=['rear-room','rear-side-corridor','rear-door-passage','court-ground'];
const B=['guest-room','guest-passage'];
const T=['road-ground','tea-front','tea-passage','tea-room'];
const hash=value=>createHash('sha256').update(canonicalize(value)).digest('hex');
export const scenePolicy=content=>content.chapterRules?.sceneRolePolicies?.[0]??null;
export const routeAnchor=(content,sceneId,anchorId)=>content.scenes.find(s=>s.sceneId===sceneId).anchors.find(a=>a.anchorId===anchorId).position;
const areas=(content,sceneId,ids)=>content.scenes.find(s=>s.sceneId===sceneId).walkableAreas.filter(a=>ids.includes(a.areaId));
const within=(point,list)=>list.some(a=>inPolygon(point,a.polygon));

/** 单半平面裁剪复用原多边形，不按格点抽样生成许可区域。 */
function westOf(polygon,maxX){
  const result=[];
  for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length],ai=a.x<=maxX,bi=b.x<=maxX;
    if(ai)result.push(a);
    if(ai!==bi)result.push({x:maxX,y:a.y+(b.y-a.y)*(maxX-a.x)/(b.x-a.x)});
  }
  return result;
}
export function publicRouteAreas(content,sceneId,branch=false){
  if(sceneId===COURT)return areas(content,sceneId,branch?[...U,...B]:U);
  if(sceneId!==ROAD)return [];
  const maxX=routeAnchor(content,ROAD,'R15').x;
  return areas(content,sceneId,T).map(a=>a.areaId==='road-ground'?{...a,polygon:westOf(a.polygon,maxX)}:a);
}
export function routeOrigin(content,actor){
  if(actor.sceneId===COURT){
    // B 为闭集且优先于 U；不能依赖配置的区域排列顺序。
    if(within(actor.position,areas(content,COURT,B)))return 'front-branch';
    if(within(actor.position,publicRouteAreas(content,COURT)))return 'court';
  }
  if(actor.sceneId===ROAD&&within(actor.position,publicRouteAreas(content,ROAD)))return 'road';
  return null;
}
export const actualFrontExit=(content,actor)=>actor.sceneId===COURT&&distance(actor.position,routeAnchor(content,COURT,'C13'))===0&&within(actor.position,areas(content,COURT,['court-ground']));

/** 资料只能由有限公开节点/边界组成；不读取人物、其他来源、私物或 live 障碍。 */
export function routeKnowledge(content,spec){
  const sceneIds=spec.sourceId===FRONT?[COURT]:[COURT,ROAD];
  const landmarks=spec.anchors.map(({sceneId,anchorId})=>({sceneId,anchorId,position:routeAnchor(content,sceneId,anchorId)}));
  return {contentVersion:content.contentVersion,chapterVersion:content.chapterVersion,mapVersion:content.mapVersion,routeSpecId:spec.routeSpecId,revision:spec.revision,
    landmarks,exit:spec.exitAnchors.map(({sceneId,anchorId})=>({sceneId,anchorId,position:routeAnchor(content,sceneId,anchorId)})),
    areas:sceneIds.map(sceneId=>({sceneId,areas:publicRouteAreas(content,sceneId,spec.sourceId===FRONT)})),
    connections:spec.sourceId===TEA?[{fromSceneId:COURT,exitId:'court-road',anchorId:'C20',toSceneId:ROAD,arrivalAnchorId:'R02'},{fromSceneId:ROAD,exitId:'road-court',anchorId:'R01',toSceneId:COURT,arrivalAnchorId:'C21'}]:[]};
}
export function routeSources(content){return (content.chapterRules?.routeSpecs??[]).map(spec=>({sourceId:spec.sourceId,knowledge:routeKnowledge(content,spec),digest:hash(routeKnowledge(content,spec))}));}
export function createPolicyRoute(state,content,subject,leader,destinationId){
  if(!scenePolicy(content))return null;
  const origin=routeOrigin(content,subject),spec=content.chapterRules.routeSpecs.find(r=>r.destinationId===destinationId);
  const front=destinationId==='front-guest-room';
  const sourceIds=front?(origin==='road'?[FRONT,TEA]:[FRONT]):origin==='front-branch'?[FRONT,TEA]:[TEA];
  return {policyVersion:scenePolicy(content).policyVersion,contentVersion:content.contentVersion,chapterVersion:content.chapterVersion,mapVersion:state.mapVersion,
    routeSpecId:spec.routeSpecId,revision:spec.revision,origin,sourceIds,sources:routeSources(content).filter(s=>sourceIds.includes(s.sourceId)).map(({sourceId,digest})=>({sourceId,digest})),
    itinerary:!origin?[]:origin==='road'?(front?[ROAD,COURT]:[ROAD]):front?[COURT]:[COURT,ROAD],stage:0,
    frontExitRequired:!front&&origin==='front-branch',frontExitDone:!front&&origin==='front-branch'&&actualFrontExit(content,subject),
    leaderStage:0,leaderExitDone:!front&&origin==='front-branch'&&within(leader.position,areas(content,COURT,['court-ground'])),
    leaderCheckpoint:{sceneId:leader.sceneId,position:structuredClone(leader.position),movementId:leader.movement?.movementId??null,travelled:leader.movement?.travelled??0}};
}
export function policyRouteValid(state,content,follow){
  const r=follow.policyRoute,spec=content.chapterRules?.routeSpecs?.find(s=>s.routeSpecId===r?.routeSpecId);
  return !!r&&!!r.origin&&r.policyVersion===scenePolicy(content)?.policyVersion&&r.contentVersion===state.contentVersion&&r.chapterVersion===state.chapterVersion&&r.mapVersion===state.mapVersion&&spec?.revision===r.revision&&spec.destinationId===follow.destinationId&&canonicalize(r.sources)===canonicalize(routeSources(content).filter(s=>r.sourceIds.includes(s.sourceId)).map(({sourceId,digest})=>({sourceId,digest})));
}
export function policyScene(content,route,sceneId,{leader=false}={}){
  const branch=route.routeSpecId==='cuilan-front-public-v1'||route.frontExitRequired&&!(leader?route.leaderExitDone:route.frontExitDone);
  const source=content.scenes.find(s=>s.sceneId===sceneId);
  return source?{...source,walkableAreas:publicRouteAreas(content,sceneId,branch)}:null;
}
export function positionPermitted(content,route,actor,{leader=false}={}){
  const stage=leader?route.leaderStage:route.stage;
  return actor.sceneId===route.itinerary[stage]&&within(actor.position,policyScene(content,route,actor.sceneId,{leader})?.walkableAreas??[]);
}
function checkpointSegments(checkpoint,actor){
  const p=actor.movement;
  if(p&&p.sceneId===actor.sceneId){
    const start=pointAlongPath(p.path,p.movementId===checkpoint.movementId?checkpoint.travelled:0),end=pointAlongPath(p.path,p.travelled??0);
    return [checkpoint.position,...p.path.slice(start.index,end.index),actor.position];
  }
  return [checkpoint.position,actor.position];
}
/** 领路者可先经同一连接进入下一段；检查实际经过的折线，不修改其位置。 */
export function checkPolicyLeader(content,route,leader){
  const r=structuredClone(route),old=r.leaderCheckpoint;
  if(leader.sceneId!==old.sceneId){
    const next=r.itinerary[r.leaderStage+1],scene=content.scenes.find(s=>s.sceneId===old.sceneId),exit=scene?.exits.find(e=>e.destinationSceneId===next);
    if(next!==leader.sceneId||!exit||distance(old.position,routeAnchor(content,old.sceneId,exit.anchorId))>content.movement.interactionRadius)return null;
    r.leaderStage++;
    const start={...old,sceneId:next,position:exit.destination,movementId:null,travelled:0};
    const limited=policyScene(content,r,next,{leader:true});
    const segments=checkpointSegments(start,leader);
    if(segments.some((p,i)=>i&&!clearSegment(limited,segments[i-1],p,()=>false)))return null;
  }else{
    const limited=policyScene(content,r,leader.sceneId,{leader:true}),segments=checkpointSegments(old,leader);
    if(!limited||segments.some((p,i)=>i&&!clearSegment(limited,segments[i-1],p,()=>false)))return null;
  }
  if(!positionPermitted(content,r,leader,{leader:true}))return null;
  if(r.frontExitRequired&&!r.leaderExitDone&&leader.sceneId===COURT&&within(leader.position,areas(content,COURT,['court-ground'])))r.leaderExitDone=true;
  r.leaderCheckpoint={sceneId:leader.sceneId,position:structuredClone(leader.position),movementId:leader.movement?.movementId??null,travelled:leader.movement?.travelled??0};
  return r;
}
/** 只查看本人当前场景；下一场景的房间/障碍在实际进入后才用于寻路。 */
export function policyLocalPath(content,route,subject,leader,enabled){
  const scene=policyScene(content,route,subject.sceneId);if(!scene||!positionPermitted(content,route,subject))return null;
  let goal=leader.position,cross=null;
  if(route.frontExitRequired&&!route.frontExitDone){
    if(route.leaderExitDone||leader.sceneId!==subject.sceneId)goal=routeAnchor(content,COURT,'C13');
    else if(subject.position.y>=327&&leader.position.y<subject.position.y)goal=subject.position;
  }else if(leader.sceneId!==subject.sceneId){
    if(leader.sceneId!==route.itinerary[route.stage+1])return null;
    cross=scene.exits.find(e=>e.destinationSceneId===leader.sceneId);if(!cross)return null;
    goal=routeAnchor(content,scene.sceneId,cross.anchorId);
  }
  const path=findPath(scene,subject.position,goal,enabled);return path?{path,scene,goal,cross}:null;
}
export function policySummary(content,route,destinationId){
  const destination=content.chapterRules.safeDestinations.find(d=>d.destinationId===destinationId);
  if(!route.origin)return `这是提议，等待本人回应：去${destination.label}。本人当前位置没有对应的已知公共路线资料，本次尚无可执行的路线安排。`;
  return `这是提议，等待本人回应：去${destination.label}。院内沿后宅公共通路、院内公共地面${destinationId==='front-guest-room'?'与前院客房过道':'，经 C20/庄口至茶棚前厅、过道及后间；庄外只走 R15（x≤1030）西侧道路'}。${route.frontExitRequired?'先从当前位置经 C13 前庭出口离开客房支线；退出后不再进入支线专有部分。':''}${route.origin==='road'&&destinationId==='front-guest-room'?'先经 R01/C21 返回院落。':''}下一入口：${route.frontExitRequired&&!route.frontExitDone?'C13':route.itinerary.length>1?route.itinerary[0]===COURT?'C20/R02':'R01/C21':'本场景安置房间'}。离开约定路线会停止；图记不保证远处当前没有障碍。`;
}
