import { createHash } from 'node:crypto';
import { canonicalize } from '../../protocol/node.mjs';
import { authorizedProjection } from '../../game/projection.mjs';
import { audienceFor, increment } from '../../game/world.mjs';
import { ownRecord } from '../../game/records.mjs';

export const contextVersion = 'legal-memory-v1';
export const goalPolicyVersion = 'visible-objectives-v1';
const hash = value => createHash('sha256').update(canonicalize(value)).digest('hex');
const label = value => [...value].slice(0, 240).join('');
const goalId = (principal, kind, sourceId) => `G-${hash([principal.principalKind, kind, sourceId]).slice(0, 32)}`;
const project = (tx, principal) => authorizedProjection(tx.state, tx.content, principal.actorId, { principalKind: principal.principalKind });

/** 只从本角色合法投影派生目标；来源语义不包含会无故变化的全局水位。 */
export async function refreshGoals(tx, principal) {
  const projection = project(tx, principal);
  const desired = projection.objectives.map(objective => ({
    goalId: goalId(principal, 'objective', objective.objectiveId), label: label(objective.label),
    status: objective.status === 'blocked' ? 'abandoned' : objective.status,
    basis: { kind: 'objective', sourceId: objective.objectiveId, value: objective, observationIds: [] },
  }));
  if (projection.self.capabilities.includes('inspect')) for (const target of projection.targets) {
    const evidence = projection.observations.find(o => o.category === 'WorldFact' && o.source.kind === 'inspection' && o.subjectId === target.targetId && hash(o.fields) === hash(target.fields));
    desired.push({
      goalId: goalId(principal, 'inspection', target.targetId), label: label(`核查${target.name}的当前状态`), status: evidence ? 'completed' : 'active',
      basis: { kind: 'inspection', sourceId: target.targetId, sourceRevision: target.resourceRevision, fieldsDigest: hash(target.fields), observationIds: evidence ? [evidence.observationId] : [] },
    });
  }
  const rows = (await tx.client.query('SELECT goal_id,source FROM ai_goal_sources WHERE session_id=$1 AND actor_id=$2 AND principal_kind=$3', [principal.sessionId, principal.actorId, principal.principalKind])).rows;
  const sources = new Map(rows.map(row => [row.goal_id, row.source]));
  for (const proposed of desired) {
    const { basis, ...fields } = proposed;
    const semanticDigest = hash({ policyVersion: goalPolicyVersion, ...fields, basis });
    const old = ownRecord(tx.state.goals, `${principal.actorId}:${fields.goalId}`);
    if (sources.get(fields.goalId)?.semanticDigest === semanticDigest && old) continue;
    const goal = { ...fields, holderId: principal.actorId, revision: old ? increment(old.revision) : '0' };
    tx.emit('GoalUpdated', goal, audienceFor(tx.state, [principal.actorId]), { principalId: 'system', actionId: `goal:${fields.goalId}:${goal.revision}`, actorId: principal.actorId });
    const source = { goalId: fields.goalId, principalKind: principal.principalKind, policyVersion: goalPolicyVersion, ...basis, sourceSnapshotSeq: tx.state.sessionSeq, goalRevision: goal.revision, semanticDigest };
    await tx.client.query('INSERT INTO ai_goal_sources(session_id,actor_id,principal_kind,goal_id,source) VALUES($1,$2,$3,$4,$5) ON CONFLICT(session_id,actor_id,principal_kind,goal_id) DO UPDATE SET source=EXCLUDED.source', [principal.sessionId, principal.actorId, principal.principalKind, fields.goalId, source]);
    sources.set(fields.goalId, source);
  }
  return [...sources.values()].sort((a, b) => a.goalId.localeCompare(b.goalId));
}

/** Memory 复用持久合法 Observation/Claim/Belief/Goal，不复制全量事件或真人私人缓存。 */
export function buildContextBasis(tx, principal, goalSources) {
  const projection = project(tx, principal);
  const observations = projection.observations.slice(-256);
  const observationIds = new Set(observations.map(o => o.observationId));
  const beliefs = Object.values(tx.state.beliefs).filter(b => b.holderId === principal.actorId && b.basedOnObservationIds.every(id => observationIds.has(id))).slice(-64);
  const sources = goalSources.filter(s => s.observationIds.every(id => observationIds.has(id)));
  const goals = sources.map(s => ownRecord(tx.state.goals, `${principal.actorId}:${s.goalId}`)).filter(Boolean);
  const claimIds = new Set(observations.filter(o => o.category === 'Claim').flatMap(o => o.source.sourceIds));
  const claims = projection.claims.filter(c => claimIds.has(c.claimId));
  const readEntityIds = [
    ...projection.items.map(i => `item:${i.itemId}`), ...projection.targets.map(t => `target:${t.targetId}`),
    ...projection.characters.filter(c => c.regionId !== null).map(c => `character:${c.characterId}`),
    ...beliefs.map(b => `belief:${principal.actorId}:${b.beliefId}`), ...goals.map(g => `goal:${principal.actorId}:${g.goalId}`),
  ];
  const { observations: ignoredObservations, claims: ignoredClaims, ...current } = projection;
  return {
    observationIds: observations.map(o => o.observationId), readEntityIds,
    context: {
      contextVersion, sessionId: principal.sessionId, actorId: principal.actorId, principalKind: principal.principalKind,
      snapshotSeq: tx.state.sessionSeq, current,
      memory: { observations, claims, beliefs, goals, goalSources: sources },
    },
  };
}
