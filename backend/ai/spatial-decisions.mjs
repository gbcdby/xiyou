import { createHash, randomUUID } from 'node:crypto';
import { canonicalize } from '../../protocol/node.mjs';
import { parseSpatialProposedIntent, spatialModelKinds } from '../../protocol/spatial-ai.mjs';
import { spatialIntentSemanticDigestSync } from '../../protocol/spatial-ai-node.mjs';
import { RuntimeError } from '../errors.mjs';
import { RuleError } from '../../game/rules.mjs';
import { isSpatial, entityRef, next } from '../../game/spatial-world.mjs';
import { isGaolao, knowsSource } from '../../game/gaolao-world.mjs';
import { gaolaoNavigationDependencies } from '../../game/gaolao-navigation.mjs';
import { snapshotSpatial, executeSpatial, highWater } from '../spatial-runtime.mjs';
import { encodeJsonbText, decodeJsonbText } from '../jsonb-text.mjs';
import { buildSpatialContext } from './spatial-context.mjs';
import { isPersistableIntent } from './output.mjs';

const digest = value => createHash('sha256').update(canonicalize(value)).digest('hex');
const navigation = action => ['move_to', 'stop_move'].includes(action.kind);
const mode = principal => principal.principalKind === 'proxy' ? 'AIProxyControlled' : 'CoreNPCControlled';
const personaByRole = Object.freeze({
  tang: { motives: ['保护人，辨明是非，尊重承诺，继续取经。'], boundaries: ['救出和安置翠兰不与收徒交换。', '只依已经合法获得的材料判断；允许要求补证、暂缓或拒绝。'] },
  wukong: { motives: ['保护师父，解救受困者，查明现场阻碍。'], boundaries: ['借用外貌不获得对方物权或同意。', '只执行合法授权的行动，不替所有玩家完成任务，不凭未知真相识破他人。'] },
  bajie: { motives: ['维护自己的生活与名誉，核实所等之人，自己决定去留。'], boundaries: ['不阻碍救出翠兰，不让唯一证据失去可达去向。', '允许询问、解释、补证、暂缓或拒绝；客观证据齐全也不自动等于加入。'] },
});

export function spatialPersona(state, content, actorId) {
  if (!isGaolao(state)) return { motives: ['根据合法观察协助本章目标。'], boundaries: ['世界事实由规则确定；不偷看未知信息，不替他人同意。'] };
  const role = Object.entries(content.chapterRules.people).find(([, id]) => id === actorId)?.[0];
  return structuredClone(personaByRole[role] ?? { motives: ['维持已授权的安全行动。'], boundaries: ['不作重大不可逆决定，不使用私人频道内容。'] });
}

/** 来源及版本保留在内部决定；只有过滤后的 context 交给 Gateway。 */
export async function prepareSpatialDecision(tx, principal, options = {}) {
  if (!isSpatial(tx.state) || principal.principalKind === 'scene_role') throw new RuntimeError('FORBIDDEN', '场景策略不能领取自主模型决定。');
  if (Object.keys(options).some(key => key !== 'allowedTools')) throw new RuntimeError('INVALID_MESSAGE', '空间决定的来源由权威投影确定。');
  const actor = tx.state.characters[principal.actorId];
  if (tx.state.phase !== 'Running' || actor.mode !== mode(principal)) throw new RuntimeError('FORBIDDEN', '当前角色不能创建空间决定。');
  if (tx.state.paused) throw new RuntimeError('SESSION_PAUSED');
  const permitted = actor.capabilities.filter(kind => spatialModelKinds.includes(kind) && (principal.principalKind !== 'proxy' || ['move_to', 'stop_move', 'inspect', 'speak', 'wait'].includes(kind)));
  const allowedTools = options.allowedTools ?? permitted;
  if (!Array.isArray(allowedTools) || !allowedTools.every(kind => permitted.includes(kind))) throw new RuntimeError('FORBIDDEN', '决定工具超过当前授权。');
  const snapshot = await snapshotSpatial(tx, principal.actorId, { principalKind: principal.principalKind, capabilities: ['spatial-v2', 'spatial-appearance-v1'] });
  const decisionId = `D-${randomUUID()}`, persona = spatialPersona(tx.state, tx.content, principal.actorId);
  const goals = persona.motives.map((label, index) => ({ goalId: `personal-${index + 1}`, label, status: 'active', basedOnObservationRefs: [] }));
  const context = buildSpatialContext(snapshot, { decisionId, allowedKinds: allowedTools, persona, goals });
  const generation = next((await tx.client.query("SELECT COALESCE(max((record->>'generation')::numeric),0) AS generation FROM decisions WHERE session_id=$1 AND actor_id=$2", [principal.sessionId, principal.actorId])).rows[0].generation);
  // 与场景导航共用一个分配器；模型返回时不再领号，未使用的顺序允许留空。
  const sequence = (await tx.client.query('INSERT INTO spatial_command_sources(session_id,actor_id,control_epoch,issued_seq) VALUES($1,$2,$3,1) ON CONFLICT(session_id,actor_id,control_epoch) DO UPDATE SET issued_seq=GREATEST(spatial_command_sources.issued_seq,spatial_command_sources.handled_seq)+1 RETURNING issued_seq', [principal.sessionId, principal.actorId, actor.controlEpoch])).rows[0].issued_seq;
  const view = tx.state.views[principal.actorId], visibleRefs = new Set([snapshot.projection.self, ...snapshot.projection.entities, ...snapshot.projection.items, ...snapshot.projection.targets].map(value => value.entityRef));
  const readVersions = {};
  for (const [id, value] of Object.entries({ ...tx.state.characters, ...tx.state.items, ...tx.state.targets })) {
    const ref = entityRef(view, id);
    if (visibleRefs.has(ref)) readVersions[ref] = { id, appearanceEpoch: value.appearanceEpoch, resourceRevision: value.resourceRevision, ...(value.spatialRevision !== undefined ? { spatialRevision: value.spatialRevision } : {}) };
  }
  const source = encodeJsonbText(context);
  const chapter = tx.state.chapter, meeting = chapter?.consentSlots[`${principal.actorId}:meeting`], appearance = chapter?.disguise?.actorId === principal.actorId ? chapter.disguise : null;
  const navigationBasis = { reducerVersion: tx.state.reducerVersion, characters: { [principal.actorId]: { sceneId: actor.sceneId, position: actor.position } }, chapter: chapter ? { consents: meeting ? { [meeting]: chapter.consents[meeting] } : {}, consentSlots: meeting ? { [`${principal.actorId}:meeting`]: meeting } : {}, departureArrangement: chapter.departureArrangement?.recipientIds.includes(principal.actorId) ? chapter.departureArrangement : null, recruitmentEnded: chapter.recruitmentEnded } : null };
  let fallback = { kind: 'wait' };
  if (isGaolao(tx.state) && principal.actorId === tx.content.chapterRules.people.wukong && knowsSource(tx.state, principal.actorId, 'rescue-contact')) {
    const seal = snapshot.projection.targets.find(target => target.availableOperations.includes('gz-break-seal'));
    if (seal && !seal.fields.some(field => field.key === 'open' && field.value === true)) {
      const near = seal.sceneId === actor.sceneId && Math.hypot(actor.position.x - seal.position.x, actor.position.y - seal.position.y) <= tx.content.movement.interactionRadius;
      fallback = near ? { kind: 'interact', targetRef: seal.entityRef, operationId: 'gz-break-seal', expectedTargetRevision: seal.resourceRevision } : { kind: 'move_to', sceneId: seal.sceneId, destination: seal.position, targetRef: seal.entityRef };
    }
  }
  const record = { schemaVersion: 2, sessionId: principal.sessionId, actorId: principal.actorId, decisionId, controlEpoch: actor.controlEpoch, generation, movementCommandSeq: sequence, planVersion: actor.planVersion, appearanceEpoch: actor.appearanceEpoch, mapVersion: tx.state.mapVersion, observationRefs: snapshot.projection.observations.map(value => value.observationRef), readVersions, allowedTools, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, baseSeq: snapshot.snapshotSeq, contextDigest: digest(context), contextSnapshot: source.value, contextEncoding: source.encoding, navigationBasis, appearance, fallback, createdAt: tx.time, deadlineAt: new Date(Date.parse(tx.time) + tx.content.timing.decisionTimeoutSeconds * 1000).toISOString(), status: 'Pending' };
  await tx.client.query("UPDATE decisions SET record=jsonb_set(record,'{status}','\"Cancelled\"') WHERE session_id=$1 AND actor_id=$2 AND record->>'status'='Pending'", [principal.sessionId, principal.actorId]);
  await tx.client.query('INSERT INTO decisions(session_id,decision_id,actor_id,record) VALUES($1,$2,$3,$4)', [principal.sessionId, decisionId, principal.actorId, record]);
  return { decision: record, context };
}

export const storedSpatialContext = record => decodeJsonbText(record.contextSnapshot, record.contextEncoding);
const readRecord = async (tx, principal, decisionId) => {
  const record = (await tx.client.query('SELECT record FROM decisions WHERE session_id=$1 AND actor_id=$2 AND decision_id=$3', [principal.sessionId, principal.actorId, decisionId])).rows[0]?.record;
  if (record?.schemaVersion !== 2) throw new RuntimeError('FORBIDDEN', '空间决定不属于当前主体。');
  return record;
};

function actionRefs(action) {
  return [...new Set([action.targetRef, action.itemRef, action.recipientRef, action.subjectRef, action.leaderRef, ...(action.recipientRefs ?? []), action.parameters?.itemRef, ...(action.parameters?.itemRefs ?? [])].filter(Boolean))];
}

async function validateDecision(tx, principal, record, action, fallback) {
  if (fallback ? !['Rejected', 'Expired'].includes(record.status) : record.status !== 'Pending') throw new RuleError('DECISION_STALE');
  if (!fallback && tx.time >= record.deadlineAt) throw new RuleError('DECISION_EXPIRED');
  const generation = (await tx.client.query("SELECT max((record->>'generation')::numeric) AS generation FROM decisions WHERE session_id=$1 AND actor_id=$2", [principal.sessionId, principal.actorId])).rows[0].generation;
  if (generation !== record.generation) throw new RuleError('DECISION_STALE');
  if (!record.allowedTools.includes(action.kind)) throw new RuleError('RULE_VIOLATION');
  const actor = tx.state.characters[principal.actorId];
  if (actor.appearanceEpoch !== record.appearanceEpoch) throw new RuleError('DECISION_STALE');
  const physical = !['wait', 'speak', 'make_claim', 'respond_consent', 'withdraw_consent'].includes(action.kind);
  if (physical && (actor.planVersion !== record.planVersion || tx.state.mapVersion !== record.mapVersion)) throw new RuleError('DECISION_STALE');
  if (physical && !navigation(action) && BigInt(await highWater(tx, actor)) > BigInt(record.movementCommandSeq)) throw new RuleError('DECISION_STALE');
  const observations = (tx.state.observations[principal.actorId] ?? []).filter(value => principal.principalKind !== 'proxy' || value.shareable);
  if (!record.observationRefs.every(ref => observations.some(value => value.observationRef === ref))) throw new RuleError('DECISION_STALE');
  for (const ref of actionRefs(action)) {
    const source = record.readVersions[ref], current = source && (tx.state.characters[source.id] ?? tx.state.items[source.id] ?? tx.state.targets[source.id]);
    if (!current || current.appearanceEpoch !== source.appearanceEpoch) throw new RuleError('STALE_REFERENCE');
    // 只有本次动作真正读取的对象形成依赖；旁人的空间变化不会使对白或等待过期。
    if (!['speak', 'make_claim'].includes(action.kind) && current.resourceRevision !== source.resourceRevision) throw new RuleError('DECISION_STALE');
    if (action.kind === 'move_to' && action.targetRef === ref && source.spatialRevision !== undefined && current.spatialRevision !== source.spatialRevision) throw new RuleError('DECISION_STALE');
  }
  const context = storedSpatialContext(record), consentId = action.consentId ?? action.parameters?.consentId;
  if (consentId) {
    const original = context.projection.chapter?.consents.find(value => value.consentId === consentId), current = tx.state.chapter?.consents[consentId];
    if (!original || !current || current.version !== original.version || current.status !== original.status) throw new RuleError('CONSENT_STALE');
  }
  if (navigation(action) && record.appearance) {
    const current = tx.state.chapter?.disguise;
    if (!current || current.consentId !== record.appearance.consentId || current.consentVersion !== record.appearance.consentVersion) throw new RuleError('CONSENT_STALE');
  }
}

async function persistRequest(tx, principal, record, action, intentDigest, fallback, reason = 'invalid_output') {
  const intentId = `${record.decisionId}:${fallback ? 'fallback' : 'submit'}`;
  const row = (await tx.client.query('SELECT request,request_text_encoding,execution_context,actor_id FROM spatial_intents WHERE session_id=$1 AND intent_id=$2', [principal.sessionId, intentId])).rows[0];
  if (row) {
    if (row.actor_id !== principal.actorId) throw new RuntimeError('FORBIDDEN');
    if (row.execution_context.intentDigest !== intentDigest) throw new RuntimeError('ACTION_ID_REUSE');
    return { request: decodeJsonbText(row.request, row.request_text_encoding), context: row.execution_context };
  }
  const request = { schemaVersion: 2, sessionId: principal.sessionId, viewId: record.viewId, actorRef: record.actorRef, clientActionId: intentId, controlEpoch: record.controlEpoch, baseSeq: record.baseSeq, action: { ...action, ...(navigation(action) ? { movementCommandSeq: record.movementCommandSeq } : {}) } };
  const context = { mode: fallback ? 'fallback' : 'intent', ...(fallback ? { reason } : {}), decisionId: record.decisionId, generation: record.generation, intentDigest, navigationDependencies: gaolaoNavigationDependencies(record.navigationBasis, tx.content, principal.actorId, action) };
  const encoded = encodeJsonbText(request);
  await tx.client.query('INSERT INTO spatial_intents(session_id,intent_id,actor_id,control_epoch,request,execution_context,request_text_encoding) VALUES($1,$2,$3,$4,$5,$6,$7)', [principal.sessionId, intentId, principal.actorId, record.controlEpoch, encoded.value, context, encoded.encoding]);
  return { request, context };
}

/** 公开 Receipt 不包含摘要；可信恢复独立核对原模型语义与原完整请求，不能混淆两者。 */
export async function spatialDecisionReceipt(runtime, handle, decisionId, fallback = false) {
  const principal = runtime.internal(handle);
  return runtime.locked(principal.sessionId, { kind: 'internal-decision-receipt' }, async tx => {
    await runtime.authorizeInternal(tx, principal);
    await readRecord(tx, principal, decisionId);
    const actionId = `${decisionId}:${fallback ? 'fallback' : 'submit'}`;
    const row = (await tx.client.query('SELECT r.receipt,r.semantic_digest,i.request,i.request_text_encoding,i.execution_context FROM action_receipts r JOIN spatial_intents i ON i.session_id=r.session_id AND i.intent_id=r.client_action_id AND i.actor_id=r.actor_id WHERE r.session_id=$1 AND r.actor_id=$2 AND r.principal_id=$3 AND r.client_action_id=$4', [principal.sessionId, principal.actorId, fallback ? 'system' : principal.principalId, actionId])).rows[0];
    if (!row) return null;
    if (row.semantic_digest !== digest(decodeJsonbText(row.request, row.request_text_encoding)) || row.receipt.semanticDigest !== row.semantic_digest || row.execution_context.decisionId !== decisionId) throw new RuntimeError('ACTION_ID_REUSE', '持久收据与原决定请求不匹配。');
    return { receipt: row.receipt.publicReceipt, semanticDigest: row.execution_context.intentDigest };
  });
}

async function confirm(runtime, handle, decisionId, fallback, expectedDigest, operation) {
  try { return await operation(); }
  catch (error) {
    if (error.code !== 'OUTCOME_UNKNOWN') throw error;
    const found = await spatialDecisionReceipt(runtime, handle, decisionId, fallback);
    if (!found) throw error;
    if (found.semanticDigest !== expectedDigest) throw new RuntimeError('ACTION_ID_REUSE');
    return found.receipt;
  }
}

export async function submitSpatialDecision(runtime, handle, record, raw) {
  let intent;
  try {
    intent = parseSpatialProposedIntent(raw, record.decisionId, storedSpatialContext(record));
    if (!isPersistableIntent(intent)) throw new RuntimeError('INVALID_MESSAGE', '模型原文不满足持久输入边界。');
  }
  catch (error) { await runtime.settleDecision(handle, record.decisionId, 'Rejected'); throw error; }
  const principal = runtime.internal(handle), intentDigest = spatialIntentSemanticDigestSync(intent), action = intent.toolCalls[0];
  return confirm(runtime, handle, record.decisionId, false, intentDigest, () => runtime.locked(principal.sessionId, { kind: 'spatial-decision-submit' }, async tx => {
    await runtime.authorizeInternal(tx, principal);
    const current = await readRecord(tx, principal, record.decisionId);
    const original = await persistRequest(tx, principal, current, action, intentDigest, false);
    const receipt = await executeSpatial(runtime, tx, original.request, { ...principal, executionContext: original.context }, actor => actor.mode === mode(principal), { validate: () => validateDecision(tx, principal, current, action, false) });
    const status = receipt.status === 'Accepted' ? 'Committed' : receipt.code === 'DECISION_EXPIRED' ? 'Expired' : 'Rejected';
    await tx.client.query("UPDATE decisions SET record=jsonb_set(record,'{status}',to_jsonb($3::text)) WHERE session_id=$1 AND decision_id=$2 AND record->>'status'='Pending'", [principal.sessionId, record.decisionId, status]);
    return receipt;
  }));
}

export async function submitSpatialDecisionFallback(runtime, handle, record) {
  const principal = runtime.internal(handle), intentDigest = digest({ decisionId: record.decisionId, fallback: record.fallback });
  return confirm(runtime, handle, record.decisionId, true, intentDigest, () => runtime.locked(principal.sessionId, { kind: 'spatial-decision-fallback' }, async tx => {
    await runtime.authorizeInternal(tx, principal);
    const current = await readRecord(tx, principal, record.decisionId), action = current.fallback;
    const run = (await tx.client.query('SELECT model_result FROM ai_runs WHERE session_id=$1 AND decision_id=$2', [principal.sessionId, record.decisionId])).rows[0];
    const reason = run?.model_result?.status === 'Timeout' ? 'model_timeout' : 'invalid_output';
    const original = await persistRequest(tx, principal, current, action, intentDigest, true, reason);
    return executeSpatial(runtime, tx, original.request, { ...principal, principalId: 'system', executionContext: original.context }, actor => actor.mode === mode(principal), { validate: () => validateDecision(tx, principal, current, action, true) });
  }));
}
