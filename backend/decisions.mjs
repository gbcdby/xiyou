import { parseProposedIntent, intentSemanticDigestSync, actionSemanticDigestSync, validateContract } from '../protocol/node.mjs';
import { randomUUID } from 'node:crypto';
import { applyAction, RuleError } from '../game/rules.mjs';
import { increment, audienceFor } from '../game/world.mjs';
import { authorizedProjection, visibleItem } from '../game/projection.mjs';
import { RuntimeError } from './errors.mjs';

const currentMode = principal => principal.principalKind === 'core_npc' ? 'CoreNPCControlled' : 'AIProxyControlled';
const entity = (state, key) => {
  const colon = key.indexOf(':'); const kind = key.slice(0, colon); const id = key.slice(colon + 1);
  return { kind, id, value: ({ item: state.items, target: state.targets, character: state.characters, belief: state.beliefs, goal: state.goals })[kind]?.[id] };
};
const version = value => value?.resourceRevision ?? value?.revision;
async function readDecision(tx, principal, decisionId) {
  const row = (await tx.client.query('SELECT record FROM decisions WHERE session_id=$1 AND decision_id=$2 AND actor_id=$3', [principal.sessionId, decisionId, principal.actorId])).rows[0];
  if (!row) throw new RuntimeError('FORBIDDEN', '该决策当前不可访问。');
  return row.record;
}

/** 决策只保存可信依据，不在事务中等待任何模型或网络。 */
export async function prepareDecision(runtime, handle, options = {}) {
  const principal = runtime.internal(handle);
  if (Object.keys(options).some(key => !['allowedTools', 'readEntityIds', 'observationIds'].includes(key))) throw new RuntimeError('INVALID_MESSAGE', '决策准备包含未知字段。');
  return runtime.locked(principal.sessionId, { kind: 'prepare-decision' }, async tx => {
    await runtime.authorizeInternal(tx, principal);
    await runtime.deadline(tx);
    const actor = tx.state.characters[principal.actorId];
    if (tx.state.phase !== 'Running' || actor?.mode !== currentMode(principal)) return new RuntimeError('FORBIDDEN', '该角色当前不能创建新决策。');
    const projection = authorizedProjection(tx.state, tx.content, principal.actorId, { principalKind: principal.principalKind });
    const observationIds = options.observationIds ?? projection.observations.slice(-256).map(o => o.observationId);
    if (!Array.isArray(observationIds) || !observationIds.every(id => projection.observations.some(o => o.observationId === id))) throw new RuntimeError('FORBIDDEN', '决策包含未授权的观察引用。');
    const permitted = (principal.principalKind === 'proxy' ? ['move', 'inspect', 'speak', 'wait'] : ['move', 'inspect', 'take_item', 'transfer_item', 'share_evidence', 'speak', 'make_claim', 'wait']).filter(tool => actor.capabilities.includes(tool));
    const allowedTools = options.allowedTools ?? permitted;
    if (!Array.isArray(allowedTools) || !allowedTools.every(tool => permitted.includes(tool))) throw new RuntimeError('FORBIDDEN', '决策工具超过当前角色权限。');
    const readEntityIds = options.readEntityIds ?? [];
    if (!Array.isArray(readEntityIds)) throw new RuntimeError('INVALID_MESSAGE', '读取对象必须为数组。');
    const readVersions = {};
    for (const key of readEntityIds) {
      if (typeof key !== 'string') throw new RuntimeError('INVALID_MESSAGE', '读取对象标识格式无效。');
      const { kind, value } = entity(tx.state, key);
      const visible = value && (kind === 'item' ? visibleItem(tx.state, principal.actorId, value) : kind === 'target' ? value.regionId === actor.regionId : kind === 'character' ? value.characterId === actor.characterId || value.regionId === actor.regionId : value.holderId === actor.characterId);
      if (!visible || version(value) === undefined) throw new RuntimeError('FORBIDDEN', '读取对象当前不可访问。');
      readVersions[key] = version(value);
    }
    const generation = increment((await tx.client.query("SELECT COALESCE(max((record->>'generation')::numeric),0) AS generation FROM decisions WHERE session_id=$1 AND actor_id=$2", [principal.sessionId, principal.actorId])).rows[0].generation);
    const record = validateContract('DecisionRecord', {
      schemaVersion: 1, sessionId: principal.sessionId, actorId: principal.actorId, decisionId: `D-${randomUUID()}`,
      controlEpoch: actor.controlEpoch, generation, observationIds, readVersions, allowedTools,
      createdAt: tx.time, deadlineAt: new Date(Math.min(Date.parse(tx.state.deadlineAt), Date.parse(tx.time) + tx.content.timing.decisionTimeoutSeconds * 1000)).toISOString(), status: 'Pending',
    });
    await tx.client.query("UPDATE decisions SET record=jsonb_set(record,'{status}','\"Cancelled\"') WHERE session_id=$1 AND actor_id=$2 AND record->>'status'='Pending'", [principal.sessionId, principal.actorId]);
    await tx.client.query('INSERT INTO decisions(session_id,decision_id,actor_id,record) VALUES($1,$2,$3,$4)', [principal.sessionId, record.decisionId, principal.actorId, record]);
    return record;
  });
}

export async function settleDecision(runtime, handle, decisionId, status = 'Cancelled') {
  if (!['Rejected', 'Expired', 'Cancelled'].includes(status)) throw new RuntimeError('INVALID_MESSAGE', '决策收束状态无效。');
  const principal = runtime.internal(handle);
  return runtime.locked(principal.sessionId, { kind: 'settle-decision' }, async tx => {
    await runtime.authorizeInternal(tx, principal);
    await runtime.deadline(tx);
    const record = await readDecision(tx, principal, decisionId);
    if (record.status === 'Pending') {
      if (status === 'Expired' && tx.time < record.deadlineAt) return new RuntimeError('FORBIDDEN', '尚未到达决策截止时间。');
      record.status = status;
      await tx.client.query('UPDATE decisions SET record=$3 WHERE session_id=$1 AND decision_id=$2', [principal.sessionId, decisionId, record]);
    }
    return record;
  });
}

export async function submitIntent(runtime, handle, decisionId, raw) {
  const principal = runtime.internal(handle);
  let intent;
  try { intent = parseProposedIntent(raw, decisionId); }
  catch (error) { await settleDecision(runtime, handle, decisionId, 'Rejected'); throw error; }
  return runtime.confirmOutcome(() => runtime.locked(principal.sessionId, { kind: 'intent' }, async tx => {
    await runtime.authorizeInternal(tx, principal);
    const record = await readDecision(tx, principal, decisionId);
    const request = { schemaVersion: 1, sessionId: principal.sessionId, actorId: principal.actorId, clientActionId: `${decisionId}:submit`, controlEpoch: record.controlEpoch, baseSeq: '0' };
    const receipt = await runtime.executeAction(tx, request, intentSemanticDigestSync(intent), principal, async actor => actor.mode === currentMode(principal), {
      decisionId, authorizationCode: 'DECISION_STALE',
      async validate() {
        if (record.status === 'Expired' || (record.status === 'Pending' && tx.time >= record.deadlineAt)) throw new RuleError('DECISION_EXPIRED');
        if (record.status !== 'Pending') throw new RuleError('DECISION_STALE');
        const current = (await tx.client.query("SELECT max((record->>'generation')::numeric) AS generation FROM decisions WHERE session_id=$1 AND actor_id=$2", [principal.sessionId, principal.actorId])).rows[0].generation;
        if (current !== record.generation || Object.entries(record.readVersions).some(([key, value]) => version(entity(tx.state, key).value) !== value)) throw new RuleError('DECISION_STALE');
        if (!intent.toolCalls.length && !intent.dialogue && !intent.beliefUpdates?.length) throw new RuleError('RULE_VIOLATION');
      },
      apply() {
        for (let index = 0; index < intent.toolCalls.length; index++) {
          const tool = intent.toolCalls[index];
          if (!record.allowedTools.includes(tool.kind)) throw new RuleError('RULE_VIOLATION');
          tx.cause = { ...tx.cause, toolCallIndex: index };
          applyAction(tx, principal.actorId, principal.principalKind, tool);
        }
        const { toolCallIndex, ...cause } = tx.cause; tx.cause = cause;
        if (intent.dialogue) {
          if (!record.allowedTools.includes('speak')) throw new RuleError('RULE_VIOLATION');
          applyAction(tx, principal.actorId, principal.principalKind, { kind: 'speak', ...intent.dialogue });
        }
        for (const proposal of intent.beliefUpdates ?? []) {
          const audienceKey = principal.principalKind === 'core_npc' ? 'coreNpcCharacterIds' : 'proxyCharacterIds';
          if (!proposal.basedOnObservationIds.every(id => record.observationIds.includes(id) && tx.state.observations[id]?.observerId === principal.actorId && tx.state.observationAudiences[id][audienceKey].includes(principal.actorId))) throw new RuleError('RULE_VIOLATION');
          const old = tx.state.beliefs[`${principal.actorId}:${proposal.beliefId}`];
          tx.emit('BeliefUpdated', { ...proposal, holderId: principal.actorId, revision: old ? increment(old.revision) : '0' }, audienceFor(tx.state, [principal.actorId]));
        }
      },
    });
    const status = receipt.status === 'Accepted' ? 'Committed' : receipt.code === 'DECISION_EXPIRED' ? 'Expired' : 'Rejected';
    await tx.client.query("UPDATE decisions SET record=jsonb_set(record,'{status}',to_jsonb($3::text)) WHERE session_id=$1 AND decision_id=$2 AND record->>'status'='Pending'", [principal.sessionId, decisionId, status]);
    return receipt;
  }), () => runtime.internalReceipt(handle, `${decisionId}:submit`));
}

/** 受限等待是独立系统命令；调度器是否再请求模型由 #9 决定。 */
export async function submitFallback(runtime, handle, decisionId) {
  const principal = runtime.internal(handle);
  return runtime.confirmOutcome(() => runtime.locked(principal.sessionId, { kind: 'fallback' }, async tx => {
    await runtime.authorizeInternal(tx, principal);
    const record = await readDecision(tx, principal, decisionId);
    const request = { schemaVersion: 1, sessionId: principal.sessionId, actorId: principal.actorId, clientActionId: `${decisionId}:fallback`, controlEpoch: record.controlEpoch, baseSeq: '0', action: { kind: 'wait' } };
    return runtime.executeAction(tx, request, actionSemanticDigestSync(request), { ...principal, principalId: 'system' }, async actor => actor.mode === currentMode(principal), {
      decisionId,
      validate() { if (!['Expired', 'Rejected'].includes(record.status)) throw new RuleError('DECISION_STALE'); },
    });
  }), () => runtime.internalReceipt(handle, `${decisionId}:fallback`, true));
}
