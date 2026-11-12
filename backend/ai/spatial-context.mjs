import { validateSpatial } from '../../protocol/spatial.mjs';
import { ContractError } from '../../protocol/index.mjs';
import { spatialAISchema, spatialModelKinds, validateSpatialAI } from '../../protocol/spatial-ai.mjs';

export const spatialContextVersion = 'spatial-ai-context-v1';
const modelView = (name, value) => Object.fromEntries(Object.keys(spatialAISchema.$defs[name].properties).filter(key => Object.hasOwn(value, key)).map(key => [key, structuredClone(value[key])]));

/** 输入只能是本观察者的授权快照；可信决定只向模型提供不透明 decisionId。 */
export function buildSpatialContext(snapshot, { decisionId, allowedKinds = spatialModelKinds, persona, goals } = {}) {
  validateSpatial('SnapshotV2', snapshot);
  if (!Array.isArray(allowedKinds) || allowedKinds.some(kind => !spatialModelKinds.includes(kind))) throw new ContractError('模型工具限制无效');
  const p = snapshot.projection;
  const allowed = new Set(p.self.capabilities.filter(kind => spatialModelKinds.includes(kind) && allowedKinds.includes(kind)));
  const projection = {
    ...structuredClone(p), self: modelView('SpatialModelSelfV2', p.self),
    entities: p.entities.map(e => modelView('SpatialModelEntityV2', e)),
    items: p.items.map(i => modelView('SpatialModelItemV2', i)),
    movement: p.movement ? modelView('SpatialModelMovementV2', p.movement) : null,
    claims: p.claims.filter(claim => claim.channel !== 'team').map(claim => structuredClone(claim)),
  };
  projection.self.capabilities = [...allowed];
  const tools = [{ kind: 'wait', description: '等待新的合法观察；等待不产生同意、加入或世界事实。' }];
  const add = (kind, fields, description) => { if (allowed.has(kind)) tools.push({ kind, ...fields, description }); };
  if (p.phase === 'Running') {
    add('stop_move', {}, '停止当前行走；服务端保留原命令顺序。');
    for (const consent of p.chapter?.consents ?? []) if (consent.subjectRef === p.self.entityRef && consent.status !== 'withdrawn') {
      const fields = { consentId: consent.consentId, expectedConsentVersion: consent.version, purpose: consent.purpose, scope: structuredClone(consent.scope) };
      add('withdraw_consent', fields, '仅由本人撤回本次用途与范围。');
      if (!p.paused) add('respond_consent', fields, '仅由本人回应本次用途与范围，可接受、拒绝或暂缓。');
    }
    if (!p.paused) {
      const scenes = new Set([p.scene?.sceneId, ...(p.scene?.exits.filter(exit => exit.open).map(exit => exit.destinationSceneId) ?? [])].filter(Boolean));
      for (const sceneId of scenes) add('move_to', { sceneId }, '提出导航目标；受理后等待权威到达，再重新检查与操作。');
      for (const kind of ['speak', 'make_claim']) add(kind, {}, '公开或向当前可见人物发言；说法不改写世界事实，也不能使用真人队聊。');
      for (const entity of [...p.entities, ...p.targets, ...p.items]) add('inspect', { targetRef: entity.entityRef }, `观察当前可见的${entity.name}。`);
      for (const entity of [p.self, ...p.entities.filter(e => e.entityRef !== p.self.entityRef), ...p.targets]) {
        for (const operationId of entity.availableOperations ?? []) add('interact', { targetRef: entity.entityRef, operationId, expectedTargetRevision: entity.resourceRevision }, `对${entity.name}提出已登记的有限操作；仍需满足本人权限和当前条件。`);
      }
      for (const item of p.items) {
        const fields = { itemRef: item.entityRef, expectedItemRevision: item.resourceRevision };
        if (item.location.kind === 'ground') add('take_item', fields, `靠近后尝试拿取${item.name}；规则重新核验物权。`);
        if (item.location.kind === 'held' && item.location.ownerRef === p.self.entityRef) {
          add('put_item', fields, `放置本人持有的${item.name}。`);
          if (item.transferable) add('transfer_item', fields, `向当前可见且近距的人转交${item.name}；不从名字解析收件者。`);
        }
      }
      for (const observation of p.observations) if (observation.shareable) add('share_evidence', { evidenceRef: observation.observationRef }, '向当前可见接收者展示这份已授权来源；实际送达由规则决定。');
    }
  }
  return validateSpatialAI(decisionId === undefined ? 'SpatialContextV2' : 'SpatialDecisionContextV2', {
    schemaVersion: 2, contextVersion: spatialContextVersion, sessionId: snapshot.sessionId, viewId: snapshot.viewId,
    snapshotSeq: snapshot.snapshotSeq, projection, tools, ...(decisionId === undefined ? {} : { decision: { decisionId } }),
    ...(persona === undefined ? {} : { persona: structuredClone(persona) }), ...(goals === undefined ? {} : { goals: structuredClone(goals) }),
  });
}
