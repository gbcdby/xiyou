import { assemblePlayers } from '../content/index.mjs';
import { validateContract } from '../protocol/index.mjs';
import { ownRecord } from './records.mjs';

export const increment = value => String(BigInt(value) + 1n);
export const terminal = state => state.phase === 'Finished' || state.phase === 'Aborted';
export const emptyAudience = () => ({ humanCharacterIds: [], coreNpcCharacterIds: [], proxyCharacterIds: [] });
export function audienceFor(state, actorIds, { privateChannel = false } = {}) {
  const audience = emptyAudience();
  for (const id of [...new Set(actorIds)]) {
    const actor = ownRecord(state.characters, id);
    if (!actor) continue;
    if (actor.kind === 'core_npc') { if (!privateChannel) audience.coreNpcCharacterIds.push(id); }
    else { audience.humanCharacterIds.push(id); if (!privateChannel) audience.proxyCharacterIds.push(id); }
  }
  return audience;
}
export const everyone = state => audienceFor(state, Object.keys(state.characters));
export function emptyWorld(sessionId, content) {
  return {
    sessionId, sessionSeq: '0', phase: 'Lobby', contentVersion: content.contentVersion,
    reducerVersion: content.reducerVersion, hostUserId: null, seed: null,
    members: [], characters: {}, items: {}, targets: {}, observations: {}, observationAudiences: {},
    claims: {}, claimAudiences: {}, beliefs: {}, goals: {}, deadlineAt: null, ending: null,
  };
}
function character(characterId, name, kind, roles = []) {
  return { characterId, name, kind, roles, regionId: null, capabilities: [], resourceRevision: '0', mode: 'Revoked', controlEpoch: '0', activeConnectionId: null, graceDeadlineAt: null };
}

/** 固定规则只消费已记录的事件和本局内容快照；不读取时钟、随机数、数据库或模型。 */
export function reduceWorld(previous, event, content) {
  if (previous.reducerVersion !== 'world-v1' || content.reducerVersion !== previous.reducerVersion) throw new Error('本服务不能回放该规则版本。');
  validateContract('WorldEvent', event);
  if (event.sessionId !== previous.sessionId || event.sessionSeq !== increment(previous.sessionSeq)) throw new Error('事件不属于本局的连续前缀。');
  if (terminal(previous)) throw new Error('终局后不能追加世界事件。');
  const state = structuredClone(previous);
  const p = event.payload;
  switch (event.kind) {
    case 'session.created': state.hostUserId = p.hostUserId; state.seed = p.seed; break;
    case 'session.member_joined':
      state.members.push({ ...p });
      state.characters[p.characterId] = character(p.characterId, p.name, 'human');
      break;
    case 'session.started': {
      state.phase = 'Running'; state.deadlineAt = p.deadlineAt;
      const assembly = assemblePlayers(content, state.members.length);
      state.members.forEach((member, index) => Object.assign(ownRecord(state.characters, member.characterId), { ...assembly[index], regionId: assembly[index].initialRegionId }));
      for (const npc of content.npcs) {
        const actor = character(npc.characterId, npc.name, 'core_npc');
        Object.assign(actor, { regionId: npc.initialRegionId, mode: 'CoreNPCControlled', controlEpoch: '1', capabilities: ['move', 'inspect', 'speak', 'make_claim', 'share_evidence', 'take_item', 'transfer_item', 'wait', ...new Set(content.targets.flatMap(t => t.inspections.map(i => i.requiredCapability))), ...new Set(content.items.map(i => i.takeCapability).filter(Boolean))] });
        state.characters[npc.characterId] = actor;
      }
      for (const item of content.items) {
        const location = item.initialLocation.kind === 'role'
          ? { kind: 'character', characterId: Object.values(state.characters).find(c => c.roles.includes(item.initialLocation.roleId)).characterId }
          : structuredClone(item.initialLocation);
        state.items[item.itemId] = { itemId: item.itemId, name: item.name, kind: item.kind, location, resourceRevision: '0', transferable: item.transferable, fields: structuredClone(item.fields) };
      }
      for (const target of content.targets) state.targets[target.targetId] = { targetId: target.targetId, name: target.name, regionId: target.regionId, resourceRevision: '0', fields: structuredClone(target.fields) };
      break;
    }
    case 'control.changed': Object.assign(ownRecord(state.characters, p.actorId), p); break;
    case 'character.moved': Object.assign(ownRecord(state.characters, p.actorId), { regionId: p.to, resourceRevision: p.resourceRevision }); break;
    case 'item.transferred': Object.assign(ownRecord(state.items, p.itemId), { location: { kind: 'character', characterId: p.to }, resourceRevision: p.resourceRevision }); break;
    case 'item.taken': Object.assign(ownRecord(state.items, p.itemId), { location: { kind: 'character', characterId: p.to }, resourceRevision: p.resourceRevision }); break;
    case 'item.used':
      ownRecord(state.items, p.itemId).resourceRevision = p.resourceRevision;
      if (p.consumed) ownRecord(state.items, p.itemId).location = { kind: 'consumed' };
      break;
    case 'target.updated': Object.assign(ownRecord(state.targets, p.targetId), { fields: p.fields, resourceRevision: p.resourceRevision }); break;
    case 'ClaimRecorded': state.claims[p.claimId] = p; state.claimAudiences[p.claimId] = event.audience; break;
    case 'ObservationRecorded': state.observations[p.observationId] = p; state.observationAudiences[p.observationId] = event.audience; break;
    case 'BeliefUpdated': state.beliefs[`${p.holderId}:${p.beliefId}`] = p; break;
    case 'GoalUpdated': state.goals[`${p.holderId}:${p.goalId}`] = p; break;
    case 'session.finished':
    case 'session.aborted':
      state.phase = event.kind === 'session.finished' ? 'Finished' : 'Aborted';
      state.ending = event.kind === 'session.finished' ? p : { endingCode: 'aborted', facts: [], reason: p.reason };
      for (const actor of Object.values(state.characters)) Object.assign(actor, { mode: 'Revoked', controlEpoch: increment(actor.controlEpoch), activeConnectionId: null, graceDeadlineAt: null });
      break;
    default: throw new Error('当前 reducer 尚不支持该事件。');
  }
  state.sessionSeq = event.sessionSeq;
  return state;
}

export function registerKnowledge(tx, actorId, knowledgeId, kind = 'initial_content') {
  const knowledge = tx.content.knowledge.find(k => k.knowledgeId === knowledgeId);
  if (!knowledge) throw new Error('固定内容的知识引用不存在。');
  const sourceSeq = increment(tx.state.sessionSeq);
  const observation = {
    observationId: `${tx.state.sessionId}:O${sourceSeq}`, observerId: actorId,
    category: knowledge.category, statement: knowledge.statement, subjectId: knowledge.subjectId,
    source: { kind, sourceIds: [...knowledge.sourceIds], sourceSeq },
    fields: structuredClone(knowledge.fields), shareable: knowledge.shareable,
  };
  tx.emit('ObservationRecorded', observation, audienceFor(tx.state, [actorId]));
  return observation.observationId;
}
