import { validateContract } from '../protocol/index.mjs';

// jsonb 不保留对象键的插入顺序，投影数组必须使用稳定顺序。
const ordered = (record, key) => Object.values(record).sort((a, b) => a[key].length - b[key].length || (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0));
function endingView(state, content) {
  if (!state.ending) return null;
  const { endingCode, facts } = state.ending;
  const value = key => facts.find(f => f.key === key)?.value;
  const codes = content.endingPolicy.codes;
  if (state.phase === 'Aborted') return { endingCode, title: '本局已终止', summary: state.ending.reason, facts, unresolved: [] };
  const unresolved = [];
  if (!value('safe')) unresolved.push('通路尚未实际修复。');
  if (!value('permit')) unresolved.push('通行许可尚未生效。');
  if (!value('arrived')) unresolved.push('师徒尚未全部到达终点。');
  if (!value('evidenceComplete')) unresolved.push('仍有核验来源尚未合法提供给双方。');
  return {
    endingCode, facts, unresolved,
    title: endingCode === codes.clarified ? '查证后通行' : endingCode === codes.costly ? '带代价通行' : '未解决',
    summary: endingCode === codes.unresolved ? '时限已到，通行条件仍未全部满足。' : value('spareConsumed') ? '备用材料已经实际用于修复，师徒完成通行；垫付不代表认罪。' : value('evidenceComplete') ? '原材料完成修复，双方取得核验来源并实际通行。' : '原材料完成修复，师徒实际通行，仍有调查问题未解。',
  };
}

export function visibleItem(state, actorId, item) {
  const actor = state.characters[actorId];
  if (!actor) return false;
  const location = item.location;
  return location.kind === 'region' ? location.regionId === actor.regionId
    : location.kind === 'character' && (location.characterId === actorId || state.characters[location.characterId]?.regionId === actor.regionId);
}
export function authorizedProjection(state, content, actorId, { connectionId = null, principalKind = 'human' } = {}) {
  const actor = state.characters[actorId];
  if (!actor) throw new Error('授权角色不在本局。');
  const { characterId, name, regionId, roles, mode, controlEpoch, capabilities } = actor;
  const audienceKey = principalKind === 'proxy' ? 'proxyCharacterIds' : principalKind === 'core_npc' ? 'coreNpcCharacterIds' : 'humanCharacterIds';
  const projection = {
    phase: state.phase, contentVersion: state.contentVersion, reducerVersion: state.reducerVersion,
    self: { characterId, name, regionId, roles, mode, controlEpoch, capabilities, canControl: principalKind === 'human' && mode === 'HumanControlled' && connectionId !== null && actor.activeConnectionId === connectionId },
    characters: ordered(state.characters, 'characterId').map(c => ({ characterId: c.characterId, name: c.name, regionId: c.characterId === actorId || c.regionId === regionId ? c.regionId : null, roles: c.roles, mode: c.mode, online: c.mode === 'HumanControlled' || c.mode === 'CoreNPCControlled' })),
    regions: content.regions.filter(r => r.regionId === regionId).map(({ regionId, name, description, exits }) => ({ regionId, name, description, exits })),
    items: ordered(state.items, 'itemId').filter(item => visibleItem(state, actorId, item)).map(({ kind, ...item }) => item),
    targets: ordered(state.targets, 'targetId').filter(target => target.regionId === regionId).map(target => ({ ...target, availableOperations: content.targets.find(t => t.targetId === target.targetId).operationIds.filter(id => capabilities.includes(content.operations.find(o => o.operationId === id).requiredCapability)) })),
    observations: ordered(state.observations, 'observationId').filter(o => o.observerId === actorId && state.observationAudiences[o.observationId][audienceKey].includes(actorId)),
    claims: ordered(state.claims, 'claimId').filter(c => state.claimAudiences[c.claimId][audienceKey].includes(actorId)),
    objectives: state.phase === 'Lobby' ? [{ objectiveId: 'prepare', label: '等待房主开始', status: 'active' }] : [{ objectiveId: 'passage', label: '调查、修复并协助师徒通行', status: state.ending ? [content.endingPolicy.codes.clarified, content.endingPolicy.codes.costly].includes(state.ending.endingCode) ? 'completed' : 'blocked' : 'active' }],
    ending: endingView(state, content),
    deadlineAt: state.deadlineAt,
  };
  return validateContract('AuthorizedProjection', structuredClone(projection));
}
