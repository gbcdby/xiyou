import {validateSpatial} from '../../protocol/spatial.mjs';
/** 输入只能是本观察者的公开投影，工具索引不得读取内部世界或隐藏依赖表。 */
export function buildSpatialContext(snapshot){
  validateSpatial('SnapshotV2',snapshot);
  const p=snapshot.projection;
  return {schemaVersion:2,sessionId:snapshot.sessionId,viewId:snapshot.viewId,snapshotSeq:snapshot.snapshotSeq,projection:structuredClone(p),tools:[
    {kind:'wait',description:'等待新的合法观察。'},
    ...p.entities.map(e=>({kind:'inspect',targetRef:e.entityRef,description:`观察眼前的${e.name}。`})),
    ...[p.self,...p.entities.filter(e=>e.entityRef!==p.self.entityRef),...p.targets].flatMap(e=>(e.availableOperations??[]).map(operationId=>({kind:'interact',targetRef:e.entityRef,operationId,expectedTargetRevision:e.resourceRevision,description:`对${e.name}提出已登记的有限操作；仍需满足本人权限和当前条件。`}))),
    ...(p.chapter?.consents??[]).filter(c=>c.subjectRef===p.self.entityRef&&c.status!=='withdrawn').map(c=>({kind:'respond_consent',consentId:c.consentId,expectedConsentVersion:c.version,purpose:c.purpose,scope:c.scope,description:'仅由本人回应本次用途与范围。'})),
  ]};
}
