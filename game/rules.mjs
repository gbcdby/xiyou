import { increment, audienceFor, registerKnowledge } from './world.mjs';
import { visibleItem } from './projection.mjs';

export class RuleError extends Error {
  constructor(code, message = '当前条件不允许这项操作。') { super(message); this.code = code; }
}
const refuse = code => { throw new RuleError(code); };
export const nearby = (state, actorId) => Object.values(state.characters).filter(c => c.regionId === state.characters[actorId].regionId).map(c => c.characterId);

function observation(tx, actorId, fields, source, options = {}) {
  const record = { observationId: `${tx.state.sessionId}:O${increment(tx.state.sessionSeq)}`, observerId: actorId, category: 'WorldFact', statement: '亲自检查当前可见状态。', source, fields, shareable: true, ...options };
  tx.emit('ObservationRecorded', record, audienceFor(tx.state, [actorId]));
  return record;
}

/** 所有规则在持锁后的候选状态上执行；此模块不会直接写数据库或发送消息。 */
export function applyAction(tx, actorId, principalKind, action) {
  const actor = tx.state.characters[actorId];
  if (!['use_item', 'interact'].includes(action.kind) && !actor.capabilities.includes(action.kind)) refuse('RULE_VIOLATION');
  if (principalKind === 'proxy' && !['move', 'inspect', 'speak', 'wait'].includes(action.kind)) refuse('RULE_VIOLATION');
  if (action.kind === 'wait') return;
  if (action.kind === 'move') {
    const current = tx.content.regions.find(r => r.regionId === actor.regionId);
    const destination = tx.content.regions.find(r => r.regionId === action.regionId);
    if (!destination || !current.exits.includes(destination.regionId)) refuse('TARGET_UNAVAILABLE');
    if (destination.entryRequirement) {
      const target = tx.state.targets[destination.entryRequirement.targetId];
      if (!Object.entries(destination.entryRequirement.fields).every(([key, value]) => target.fields.some(f => f.key === key && f.value === value))) refuse('RULE_VIOLATION');
    }
    if (principalKind === 'proxy' && destination.kind === 'exit') refuse('RULE_VIOLATION');
    const audience = audienceFor(tx.state, [...nearby(tx.state, actorId), ...Object.values(tx.state.characters).filter(c => c.regionId === destination.regionId).map(c => c.characterId)]);
    tx.emit('character.moved', { actorId, from: actor.regionId, to: destination.regionId, resourceRevision: increment(actor.resourceRevision) }, audience);
    return;
  }
  if (action.kind === 'transfer_item') {
    const item = tx.state.items[action.itemId];
    const target = tx.state.characters[action.targetId];
    if (!item || !visibleItem(tx.state, actorId, item) || !target || target.regionId !== actor.regionId) refuse('TARGET_UNAVAILABLE');
    if (item.resourceRevision !== action.expectedItemRevision) refuse('STALE_PRECONDITION');
    if (item.location.kind !== 'character' || item.location.characterId !== actorId || !item.transferable) refuse('RULE_VIOLATION');
    if (target.characterId === actorId) return;
    tx.emit('item.transferred', { itemId: item.itemId, from: actorId, to: target.characterId, resourceRevision: increment(item.resourceRevision) }, audienceFor(tx.state, nearby(tx.state, actorId)));
    return;
  }
  if (action.kind === 'take_item') {
    const item = tx.state.items[action.itemId];
    if (!item || !visibleItem(tx.state, actorId, item)) refuse('TARGET_UNAVAILABLE');
    if (item.resourceRevision !== action.expectedItemRevision) refuse('STALE_PRECONDITION');
    const definition = tx.content.items.find(i => i.itemId === item.itemId);
    if (item.location.kind !== 'region' || item.location.regionId !== actor.regionId || (definition.takeCapability && !actor.capabilities.includes(definition.takeCapability))) refuse('RULE_VIOLATION');
    tx.emit('item.taken', { itemId: item.itemId, from: item.location, to: actorId, resourceRevision: increment(item.resourceRevision) }, audienceFor(tx.state, nearby(tx.state, actorId)));
    return;
  }
  if (action.kind === 'inspect') {
    const target = tx.state.targets[action.targetId];
    const item = tx.state.items[action.targetId];
    const entity = target?.regionId === actor.regionId ? target : item && visibleItem(tx.state, actorId, item) ? item : null;
    if (!entity) refuse('TARGET_UNAVAILABLE');
    observation(tx, actorId, structuredClone(entity.fields), { kind: 'inspection', sourceIds: [action.targetId], sourceSeq: increment(tx.state.sessionSeq) }, { subjectId: action.targetId });
    if (target) {
      for (const inspection of tx.content.targets.find(t => t.targetId === action.targetId).inspections) {
        if (actor.capabilities.includes(inspection.requiredCapability)) for (const knowledgeId of inspection.knowledgeIds) registerKnowledge(tx, actorId, knowledgeId, 'inspection');
      }
    }
    return;
  }
  if (action.kind === 'speak' || action.kind === 'make_claim') {
    if (principalKind !== 'human' && action.channel === 'private') refuse('RULE_VIOLATION');
    if (principalKind === 'proxy' && (action.channel !== 'public' || !/[?？]\s*$/.test(action.text))) refuse('RULE_VIOLATION');
    const recipients = action.channel === 'public' ? nearby(tx.state, actorId) : [...new Set([actorId, ...action.recipientIds])];
    if (!recipients.every(recipient => tx.state.characters[recipient] && (action.channel === 'private' ? tx.state.characters[recipient].kind === 'human' : tx.state.characters[recipient].regionId === actor.regionId))) refuse('TARGET_UNAVAILABLE');
    const audience = audienceFor(tx.state, recipients, { privateChannel: action.channel === 'private' });
    const claim = { claimId: `${tx.state.sessionId}:Q${increment(tx.state.sessionSeq)}`, speakerId: actorId, text: action.text, channel: action.channel, recipientIds: action.recipientIds };
    const event = tx.emit('ClaimRecorded', claim, audience);
    for (const recipient of recipients) {
      const record = { observationId: `${tx.state.sessionId}:O${increment(tx.state.sessionSeq)}`, observerId: recipient, category: 'Claim', source: { kind: 'speech', sourceIds: [claim.claimId], sourceSeq: event.sessionSeq }, statement: action.text, subjectId: actorId, fields: [], shareable: action.channel !== 'private' };
      tx.emit('ObservationRecorded', record, audienceFor(tx.state, [recipient], { privateChannel: action.channel === 'private' }));
    }
    return;
  }
  if (action.kind === 'share_evidence') {
    const source = tx.state.observations[action.evidenceId];
    const audienceKey = principalKind === 'human' ? 'humanCharacterIds' : principalKind === 'core_npc' ? 'coreNpcCharacterIds' : 'proxyCharacterIds';
    if (!source || source.observerId !== actorId || !source.shareable || !tx.state.observationAudiences[source.observationId][audienceKey].includes(actorId)) refuse('TARGET_UNAVAILABLE');
    if (!action.recipientIds.every(recipient => tx.state.characters[recipient]?.regionId === actor.regionId)) refuse('TARGET_UNAVAILABLE');
    for (const recipient of action.recipientIds) {
      const record = { ...structuredClone(source), observationId: `${tx.state.sessionId}:O${increment(tx.state.sessionSeq)}`, observerId: recipient, source: { ...source.source, kind: 'evidence_share' } };
      tx.emit('ObservationRecorded', record, audienceFor(tx.state, [recipient]));
    }
    return;
  }
  if (action.kind === 'use_item' || action.kind === 'interact') {
    const target = tx.state.targets[action.targetId];
    if (!target || target.regionId !== actor.regionId) refuse('TARGET_UNAVAILABLE');
    if (target.resourceRevision !== action.expectedTargetRevision) refuse('STALE_PRECONDITION');
    const operation = tx.content.operations.find(op => op.operationId === action.operation && op.targetId === target.targetId);
    if (!operation || !tx.content.targets.find(t => t.targetId === target.targetId).operationIds.includes(operation.operationId)) refuse('RULE_VIOLATION');
    if ((operation.humanOnly && principalKind !== 'human') || !actor.capabilities.includes(operation.requiredCapability)) refuse('RULE_VIOLATION');
    if (!Object.entries(operation.requiredTargetValues).every(([key, value]) => target.fields.some(f => f.key === key && f.value === value))) refuse('RULE_VIOLATION');
    const items = (action.itemIds ?? []).map(itemId => tx.state.items[itemId]);
    if (items.some(item => !item || !visibleItem(tx.state, actorId, item))) refuse('TARGET_UNAVAILABLE');
    if (items.some(item => item.resourceRevision !== action.expectedItemRevisions[item.itemId])) refuse('STALE_PRECONDITION');
    if (items.some(item => item.location.kind !== 'character' || item.location.characterId !== actorId)) refuse('RULE_VIOLATION');
    if (JSON.stringify(items.map(item => item.kind).sort()) !== JSON.stringify([...operation.requiredItemKinds].sort())) refuse('RULE_VIOLATION');
    const audience = audienceFor(tx.state, nearby(tx.state, actorId));
    const values = { ...operation.effectValues };
    if (operation.recordMaterialField) values[operation.recordMaterialField] = items.find(item => operation.consumedItemKinds.includes(item.kind)).itemId;
    for (const item of items) {
      const definition = tx.content.items.find(i => i.itemId === item.itemId);
      tx.emit('item.used', { itemId: item.itemId, actorId, targetId: target.targetId, operation: operation.operationId, consumed: definition.consumedOnUse && operation.consumedItemKinds.includes(item.kind), resourceRevision: increment(item.resourceRevision) }, audience);
    }
    const fields = structuredClone(target.fields);
    for (const [key, value] of Object.entries(values)) {
      const field = fields.find(f => f.key === key);
      if (field) field.value = value; else fields.push({ key, label: key, value });
    }
    tx.emit('target.updated', { targetId: target.targetId, resourceRevision: increment(target.resourceRevision), fields }, audience);
    return;
  }
  refuse('RULE_VIOLATION');
}

/** 结局读取实际世界及两位 NPC 的合法来源，不读取对白中的成功宣称。 */
export function endingFacts(state, content) {
  const policy = content.endingPolicy;
  const gate = state.targets[policy.gateTargetId];
  const field = key => gate.fields.find(f => f.key === key)?.value;
  const operation = content.operations.find(op => op.targetId === gate.targetId && op.recordMaterialField);
  const materialId = operation ? field(operation.recordMaterialField) : null;
  const allEvidence = policy.requiredNpcIds.every(actorId => policy.evidenceGroups.every(group => group.knowledgeIds.every(knowledgeId => {
    const knowledge = content.knowledge.find(k => k.knowledgeId === knowledgeId);
    return Object.values(state.observations).some(o => o.observerId === actorId && o.category === 'Evidence' && knowledge.sourceIds.every(source => o.source.sourceIds.includes(source)) && state.observationAudiences[o.observationId].coreNpcCharacterIds.includes(actorId));
  })));
  return [
      { key: 'safe', label: '通路安全', value: field('safe') === true },
      { key: 'permit', label: '通行许可有效', value: field('permit') === true },
      { key: 'arrived', label: '师徒实际到达终点', value: policy.requiredNpcIds.every(id => state.characters[id]?.regionId === policy.exitRegionId) },
      { key: 'spareConsumed', label: '备用材料实际消耗', value: materialId === policy.spareMaterialId && state.items[policy.spareMaterialId]?.location.kind === 'consumed' },
      { key: 'originalConsumed', label: '原材料实际用于修复', value: materialId === policy.originalMaterialId && state.items[policy.originalMaterialId]?.location.kind === 'consumed' },
      { key: 'evidenceComplete', label: '双方已取得完整核验来源', value: allEvidence },
  ];
}
export function evaluateEnding(state, content) {
  const facts = endingFacts(state, content);
  const value = key => facts.find(f => f.key === key).value;
  if (!value('safe') || !value('permit') || !value('arrived')) return null;
  return { endingCode: value('originalConsumed') && value('evidenceComplete') ? content.endingPolicy.codes.clarified : content.endingPolicy.codes.costly, facts };
}
