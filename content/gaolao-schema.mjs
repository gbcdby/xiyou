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
  }),
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
  for(const [sourceId,kind,category] of [['old-ledger','archive','Evidence'],['tea-witness','testimony','Claim'],['travel-document','material','Evidence']]){const source=r.sources.find(s=>s.sourceId===sourceId);if(!source||source.kind!==kind||source.category!==category||sourceId!=='travel-document'&&source.beforeArrivalDays<=0)throw new Error('章节来源类别或先于到访的时间不完整。');}
  const p=r.people,expectedEndings=[{endingCode:'GZ-E01',decisionActorIds:[p.tang,p.bajie],departureActorIds:[p.tang,p.wukong,p.bajie],waitingActorIds:[]},{endingCode:'GZ-E02',decisionActorIds:[],departureActorIds:[p.tang,p.wukong],waitingActorIds:[p.bajie]},{endingCode:'GZ-E03',decisionActorIds:[],departureActorIds:[],waitingActorIds:[]}];
  for(const expected of expectedEndings){const actual=r.endings.find(e=>e.endingCode===expected.endingCode);if(!actual||['decisionActorIds','departureActorIds','waitingActorIds'].some(key=>JSON.stringify(actual[key])!==JSON.stringify(expected[key])))throw new Error('章节结局的本人决定与实际去向不完整。');}
}
