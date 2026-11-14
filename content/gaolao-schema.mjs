import { object, array, ref, integer, lit, text, en, spatialSchema } from '../protocol/spatial-schema.mjs';
import { findPath, inPolygon } from '../game/spatial-geometry.mjs';
const id=ref('Id'), point=ref('Position'), ids=array(id);
const at=object({sceneId:id,position:point});
const destination=object({destinationId:id,label:text(120),sceneId:id,position:point});
export const gaolaoDefs={
  GaolaoRules: object({
    chapterId:lit('gaolaozhuang'), layoutBaseline:lit('GZ-VIS-01/v1.1'),
    people:object({tang:id,wukong:id,bajie:id,cuilan:id,gao:id,witness:id}),
    roles:array(object({roleId:en('A','B','C','D','E'),name:text(120),knowledge:array(text(240),8)}),5),
    partyRoles:object(Object.fromEntries(['2','3','4','5'].map(n=>[n,array(array(en('A','B','C','D','E'),5),5)]))),
    contactTargetId:id, sealTargetId:id, supportTargetId:id, ledgerTargetId:id, returnTargetId:id,
    contactInside:at, retreat:at,
    safeDestinations:array(object({...destination.properties,areaId:id,exitPosition:point}),2),
    meetingDestinations:array(destination,4), departure:at, waiting:array(at,2),
    sources:array(object({sourceId:id,kind:en('archive','testimony','material'),label:text(240),beforeArrivalDays:integer(36500),category:en('Evidence','Claim'),statement:text(2000),fields:array(ref('FactField'),32)}),8),
    privateItems:array(object({itemId:id,ownerId:id}),8),
    endings:array(object({endingCode:en('GZ-E01','GZ-E02','GZ-E03'),decisionActorIds:ids,departureActorIds:ids,waitingActorIds:ids}),3),
    sceneRolePolicies:array(object({actorId:id,policyVersion:lit('gaolao-cuilan-v1')}),1),
    routeSpecs:array(object({routeSpecId:id,revision:lit(1),sourceId:id,destinationId:id,anchors:array(object({sceneId:id,anchorId:id}),12),exitAnchors:array(object({sceneId:id,anchorId:id}),3)}),2),
  },['sceneRolePolicies','routeSpecs']),
};
export function validateGaolaoContent(c){
  if(c.reducerVersion!=='gaolao-world-v1'){if(c.chapterRules)throw new Error('旧空间解释器不得加载高老庄规则。');return;}
  const r=c.chapterRules;if(!r)throw new Error('高老庄解释器缺少章节规则。');
  const expected={'2':[['A','B','D'],['C','E']],'3':[['A','B'],['C'],['D','E']],'4':[['A'],['B'],['C'],['D','E']],'5':[['A'],['B'],['C'],['D'],['E']]};
  if(JSON.stringify(r.partyRoles)!==JSON.stringify(expected))throw new Error('人数职责与冻结章节合同不符。');
  if(new Set(r.roles.map(x=>x.roleId)).size!==5)throw new Error('职责配置不完整。');
  if(new Set(Object.values(r.people)).size!==6)throw new Error('章节本人实体不能共用标识。');
  for(const [key,kind] of Object.entries({tang:'persistent_core',wukong:'persistent_core',bajie:'chapter_autonomous',cuilan:'scene_role',gao:'scene_role',witness:'scene_role'}))if(c.npcs.find(n=>n.characterId===r.people[key])?.actorKind!==kind)throw new Error('章节角色类型不符。');
  if(r.safeDestinations.length!==2||r.endings.length!==3)throw new Error('安置点或结局不完整。');
  for(const d of r.safeDestinations){const s=c.scenes.find(x=>x.sceneId===d.sceneId),area=s?.walkableAreas.find(x=>x.areaId===d.areaId);if(!area||!inPolygon(d.position,area.polygon)||!findPath(s,d.position,d.exitPosition,()=>false))throw new Error('安置点缺少真实内室或自由出口。');}
  for(const item of r.privateItems)if(!c.items.some(i=>i.itemId===item.itemId&&!i.publicBorrowable)||!c.npcs.some(n=>n.characterId===item.ownerId))throw new Error('私物归属错误。');
  const finiteOperations=new Set([...spatialSchema.$defs.GaolaoOperationId.enum,'gz-lock-support']);
  if(c.targets.some(t=>t.operationIds.some(id=>!finiteOperations.has(id))))throw new Error('章节目标包含未登记的操作。');
  for(const [key,operationId] of Object.entries({contactTargetId:'gz-contact',sealTargetId:'gz-check-seal',supportTargetId:'gz-lock-support',ledgerTargetId:'gz-read-ledger',returnTargetId:'gz-return-public'}))if(!c.targets.some(t=>t.targetId===r[key]&&t.operationIds.includes(operationId)))throw new Error('章节关键入口引用错误。');
  if(c.operations.find(o=>o.operationId==='gz-lock-support'&&o.kind==='cooperation')?.requiredCount!==2)throw new Error('门撑必须保留两人解法。');
  if(new Set(r.sources.map(s=>s.sourceId)).size!==r.sources.length)throw new Error('原始证据来源标识重复。');
  if(r.sceneRolePolicies||r.routeSpecs){
    if(c.chapterVersion!=='gaolaozhuang-chapter-v2'||c.mapVersion!=='gaolao-layout-v1.1'||r.sceneRolePolicies?.length!==1||r.sceneRolePolicies[0].actorId!==r.people.cuilan||r.routeSpecs?.length!==2)throw new Error('场景本人策略必须绑定新章节及固定路线。');
    for(const [name,destination] of [['front','front-guest-room'],['tea','tea-back-room']]){
      const route=r.routeSpecs.find(x=>x.routeSpecId===`cuilan-${name}-public-v1`),source=r.sources.find(x=>x.sourceId===`cuilan-route-${name}-v1`);
      if(!route||route.destinationId!==destination||route.sourceId!==source?.sourceId||source.kind!=='archive'||source.category!=='Evidence'||source.beforeArrivalDays!==0)throw new Error('场景本人图记与路线必须一一绑定。');
      for(const at of [...route.anchors,...route.exitAnchors])if(!c.scenes.find(s=>s.sceneId===at.sceneId)?.anchors.some(a=>a.anchorId===at.anchorId))throw new Error('公开图记包含未知锚点。');
      const expected=name==='front'?['C08','C01','C13','C11','C12']:['C20','R02','R06','R04','R05','R15','R01','C21'],exits=name==='front'?['C12','C11','C13']:['R05','R04','R06'];
      if(JSON.stringify(route.anchors.map(a=>a.anchorId))!==JSON.stringify(expected)||JSON.stringify(route.exitAnchors.map(a=>a.anchorId))!==JSON.stringify(exits)||[...route.anchors,...route.exitAnchors].some(a=>a.sceneId!==(a.anchorId.startsWith('C')?'gaolao-courtyard':'gaolao-village-road')))throw new Error('公开图记必须遵守有限锚点白名单。');
    }
  }
  for(const [sourceId,kind,category] of [['old-ledger','archive','Evidence'],['tea-witness','testimony','Claim'],['travel-document','material','Evidence']]){const source=r.sources.find(s=>s.sourceId===sourceId);if(!source||source.kind!==kind||source.category!==category||sourceId!=='travel-document'&&source.beforeArrivalDays<=0)throw new Error('章节来源类别或先于到访的时间不完整。');}
  const p=r.people,expectedEndings=[{endingCode:'GZ-E01',decisionActorIds:[p.tang,p.bajie],departureActorIds:[p.tang,p.wukong,p.bajie],waitingActorIds:[]},{endingCode:'GZ-E02',decisionActorIds:[],departureActorIds:[p.tang,p.wukong],waitingActorIds:[p.bajie]},{endingCode:'GZ-E03',decisionActorIds:[],departureActorIds:[],waitingActorIds:[]}];
  for(const expected of expectedEndings){const actual=r.endings.find(e=>e.endingCode===expected.endingCode);if(!actual||['decisionActorIds','departureActorIds','waitingActorIds'].some(key=>JSON.stringify(actual[key])!==JSON.stringify(expected[key])))throw new Error('章节结局的本人决定与实际去向不完整。');}
}
