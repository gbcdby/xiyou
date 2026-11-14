import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createRuntime } from '../runtime.mjs';
import { gaolaoRoom, accepted, rescue, disguise, take } from '../test-support/gaolao-room.mjs';
import { reserveCall, saveOutput } from '../ai/persistence.mjs';
import { parseSpatialProposedIntent } from '../../protocol/spatial-ai.mjs';
import { spatialIntentSemanticDigestSync } from '../../protocol/spatial-ai-node.mjs';
import { decodeJsonbText } from '../jsonb-text.mjs';
import { decodeStoredOutput } from '../ai/output.mjs';
import { RuntimeError } from '../errors.mjs';
import { ModelGateway } from '../ai/gateway.mjs';
import { AIOrchestrator } from '../ai/orchestrator.mjs';

const clock = { value: Date.parse('2026-11-12T22:00:00Z') };
let db, runtime;
const rawIntent = (prepared, action) => JSON.stringify({ schemaVersion: 2, decisionId: prepared.decision.decisionId, toolCalls: [action] });
const outputFor = (prepared, action) => {
  const rawText = rawIntent(prepared, action);
  return { status: 'Valid', rawText, semanticDigest: spatialIntentSemanticDigestSync(parseSpatialProposedIntent(rawText, prepared.decision.decisionId, prepared.context)) };
};
before(async () => { db = await startTestPostgres('spatial-decisions', { outputSubdirectory: 'a3-ai-runtime' }); runtime = await createRuntime({ pool: db.pool, now: () => clock.value }); });
after(async () => { await runtime?.close(); await db?.stop(); });

test('空间决定准备：可信generation与移动顺序先持久，模型仅获合法上下文', async () => {
  const room = await gaolaoRoom(runtime, clock, 2), handle = room.actors.get('wukong').handle;
  const prepared = await runtime.prepareDecisionContext(handle);
  assert.equal(prepared.decision.schemaVersion, 2);
  assert.equal(prepared.context.schemaVersion, 2);
  assert.deepEqual(prepared.context.decision, { decisionId: prepared.decision.decisionId });
  for (const key of ['actorId', 'controlEpoch', 'generation', 'readVersions', 'movementCommandSeq', 'movementCommandHighWater']) assert.ok(!JSON.stringify(prepared.context).includes(`"${key}"`), key);
  assert.equal(prepared.decision.status, 'Pending');
  assert.equal(prepared.decision.movementCommandSeq, '1');
  const next = await runtime.prepareDecisionContext(handle);
  assert.equal(next.decision.generation, '2');
  assert.equal(next.decision.movementCommandSeq, '2');
  assert.equal((await runtime.decisionState(handle, prepared.decision.decisionId)).status, 'Cancelled');
  await assert.rejects(runtime.prepareDecisionContext(room.actors.get('cuilan').handle), { code: 'FORBIDDEN' });
  const persisted = (await db.pool.query('SELECT record FROM decisions WHERE session_id=$1 AND decision_id=$2', [room.sessionId, next.decision.decisionId])).rows[0].record;
  assert.deepEqual(persisted, next.decision);
});

test('无关行走不会饿死决定，单动作重复提交保持原安全Receipt', async () => {
  const room = await gaolaoRoom(runtime, clock, 2), handle = room.actors.get('wukong').handle;
  const prepared = await runtime.prepareDecisionContext(handle);
  const human = (await room.snapshot(0)).projection.self;
  accepted(await room.send(0, { kind: 'move_to', sceneId: human.sceneId, destination: { x: human.position.x + 40, y: human.position.y }, movementCommandSeq: '1' }));
  for (let index = 0; index < 8; index++) await room.step(100);
  const raw = rawIntent(prepared, { kind: 'speak', text: '先按已经见到的材料核对。', channel: 'public', recipientRefs: [] });
  const receipt = accepted(await runtime.submitIntent(handle, prepared.decision.decisionId, raw));
  assert.equal(receipt.schemaVersion, 2); assert.equal(receipt.semanticDigest, undefined);
  assert.deepEqual(await runtime.submitIntent(handle, prepared.decision.decisionId, raw), receipt);
  assert.equal((await runtime.decisionState(handle, prepared.decision.decisionId)).status, 'Committed');
  const internal = await runtime.decisionReceipt(handle, prepared.decision.decisionId);
  assert.equal(internal.semanticDigest, spatialIntentSemanticDigestSync(parseSpatialProposedIntent(raw, prepared.decision.decisionId)));
  assert.deepEqual(internal.receipt, receipt);
  await assert.rejects(runtime.submitIntent(handle, prepared.decision.decisionId, rawIntent(prepared, { kind: 'wait' })), { code: 'ACTION_ID_REUSE' });
});

test('移动顺序在prepare预留，较新停止与新generation挡住迟到模型及旧fallback', async () => {
  const room = await gaolaoRoom(runtime, clock, 2), handle = room.actors.get('wukong').handle;
  const old = await runtime.prepareDecisionContext(handle), self = old.context.projection.self;
  const move = { kind: 'move_to', sceneId: self.sceneId, destination: { x: self.position.x + 30, y: self.position.y } };
  const stop = await runtime.reserveSpatialIntent(handle, 'newer-stop', { kind: 'stop_move' });
  assert.equal(stop.action.movementCommandSeq, '2'); accepted(await runtime.submitSpatialIntent(handle, 'newer-stop'));
  assert.equal((await runtime.submitIntent(handle, old.decision.decisionId, rawIntent(old, move))).code, 'STALE_MOVEMENT_COMMAND');
  const cancelled = await runtime.prepareDecisionContext(handle), current = await runtime.prepareDecisionContext(handle);
  assert.equal((await runtime.submitIntent(handle, cancelled.decision.decisionId, rawIntent(cancelled, move))).code, 'DECISION_STALE');
  assert.equal((await runtime.submitFallback(handle, old.decision.decisionId)).code, 'DECISION_STALE');
  const acceptedMove = accepted(await runtime.submitIntent(handle, current.decision.decisionId, rawIntent(current, move)));
  assert.equal(acceptedMove.result.movementCommandSeq, current.decision.movementCommandSeq);
  assert.equal((await runtime.replay(room.sessionId)).characters[handle.actorId].movement.status, 'accepted');
  const inspection = await runtime.prepareDecisionContext(handle);
  await runtime.reserveSpatialIntent(handle, 'stop-before-inspection', { kind: 'stop_move' });
  accepted(await runtime.submitSpatialIntent(handle, 'stop-before-inspection'));
  assert.equal((await runtime.submitIntent(handle, inspection.decision.decisionId, rawIntent(inspection, { kind: 'inspect', targetRef: inspection.context.projection.self.entityRef }))).code, 'DECISION_STALE');
});

test('导航受理不是到达：到达前取物拒绝，权威到达后新决定才实际拿取', async () => {
  const room = await gaolaoRoom(runtime, clock, 2), handle = room.actors.get('wukong').handle, brace = room.content.items.find(item => item.itemId === 'gz-brace');
  await room.go('wukong', { sceneId: brace.sceneId, position: { x: brace.position.x + 150, y: brace.position.y } });
  const nav = await runtime.prepareDecisionContext(handle), item = nav.context.projection.items.find(value => value.name === '公共门撑');
  assert.ok(item);
  accepted(await runtime.submitIntent(handle, nav.decision.decisionId, rawIntent(nav, { kind: 'move_to', sceneId: brace.sceneId, destination: brace.position, targetRef: item.entityRef })));
  const early = await runtime.prepareDecisionContext(handle), take = { kind: 'take_item', itemRef: item.entityRef, expectedItemRevision: item.resourceRevision };
  assert.equal((await runtime.submitIntent(handle, early.decision.decisionId, rawIntent(early, take))).code, 'OUT_OF_RANGE');
  await room.step(2000);
  assert.equal((await room.snapshot('wukong')).projection.movement.status, 'arrived');
  const after = await runtime.prepareDecisionContext(handle);
  accepted(await runtime.submitIntent(handle, after.decision.decisionId, rawIntent(after, take)));
  assert.equal((await runtime.replay(room.sessionId)).items['gz-brace'].location.characterId, handle.actorId);
});

test('持久预算与原文：可信上下文不可替换，NUL观察可逆保存，重复输出不覆盖', async () => {
  const room = await gaolaoRoom(runtime, clock, 2), handle = room.actors.get('wukong').handle;
  accepted(await room.send('wukong', { kind: 'speak', text: '合法现场原文\u0000保留。', channel: 'public', recipientRefs: [] }));
  const prepared = await runtime.prepareDecisionContext(handle), changed = structuredClone(prepared);
  changed.context.projection.self.name = '替换名字';
  await assert.rejects(reserveCall(runtime, handle, changed, { providerKind: 'controlled' }, 1), { code: 'FORBIDDEN' });
  assert.equal((await reserveCall(runtime, handle, prepared, { providerKind: 'controlled' }, 1)).reserved, true);
  const output = outputFor(prepared, { kind: 'wait' });
  await saveOutput(runtime, handle, prepared.decision.decisionId, output);
  await saveOutput(runtime, handle, prepared.decision.decisionId, output);
  await assert.rejects(saveOutput(runtime, handle, prepared.decision.decisionId, { ...output, rawText: output.rawText + ' ' }), { code: 'ACTION_ID_REUSE' });
  const row = (await db.pool.query('SELECT * FROM ai_runs WHERE session_id=$1 AND decision_id=$2', [room.sessionId, prepared.decision.decisionId])).rows[0];
  assert.equal(decodeStoredOutput(row), output.rawText);
  assert.equal(decodeJsonbText(row.context, row.context_text_encoding).projection.claims.at(-1).text, '合法现场原文\u0000保留。');
  const next = await runtime.prepareDecisionContext(room.actors.get('bajie').handle);
  assert.equal((await reserveCall(runtime, room.actors.get('bajie').handle, next, { providerKind: 'controlled' }, 1)).reason, 'CALL_BUDGET');
});

test('Unknown恢复：原语义与原请求分别核对，重启只恢复收据且不再调用模型', async () => {
  const room = await gaolaoRoom(runtime, clock, 2), handle = room.actors.get('wukong').handle, prepared = await runtime.prepareDecisionContext(handle);
  await reserveCall(runtime, handle, prepared, { providerKind: 'controlled' }, 3);
  const output = outputFor(prepared, { kind: 'speak', text: '只有这一次原始发言。', channel: 'public', recipientRefs: [] });
  await saveOutput(runtime, handle, prepared.decision.decisionId, output);
  const previous = runtime.hooks;
  runtime.hooks = { afterCommit({ command }) { if (command === 'spatial-decision-submit') throw new RuntimeError('OUTCOME_UNKNOWN'); }, beforeCommit({ command }) { if (command === 'internal-decision-receipt') throw new RuntimeError('OUTCOME_UNKNOWN'); } };
  try { await assert.rejects(runtime.submitIntent(handle, prepared.decision.decisionId, output.rawText), { code: 'OUTCOME_UNKNOWN' }); }
  finally { runtime.hooks = previous; }
  const original = await runtime.internalReceipt(handle, `${prepared.decision.decisionId}:submit`);
  assert.equal(original.status, 'Accepted');
  const recovered = await createRuntime({ pool: db.pool, now: () => clock.value }), fresh = await recovered.bindInternal(room.sessionId, handle.actorId, 'core_npc');
  const gateway = new ModelGateway({ provider: { kind: 'controlled', providerId: 'unused-recovery', generate() { throw new Error('恢复不应调用供应商'); } }, modelId: 'unused' });
  const orchestrator = new AIOrchestrator({ runtime: recovered, gateway });
  try {
    orchestrator.watch(fresh, { wake: false, autoWake: false });
    await orchestrator.recover(fresh);
    assert.deepEqual(orchestrator.status(fresh).lastReceipt, original);
    assert.equal(gateway.metrics().calls, 0);
    const state = await recovered.replay(room.sessionId);
    assert.equal(state.claims[handle.actorId].filter(value => value.text === '只有这一次原始发言。').length, 1);
    assert.equal(await recovered.internalReceipt(fresh, `${prepared.decision.decisionId}:fallback`, true), null);
    assert.equal((await db.pool.query('SELECT status FROM ai_runs WHERE session_id=$1 AND decision_id=$2', [room.sessionId, prepared.decision.decisionId])).rows[0].status, 'Resolved');
  } finally { await orchestrator.close(); await recovered.close(); }
});

test('真实目标revision与竞争物权重验，别局引用和模型注入不能绕过当前工具', async () => {
  const room = await gaolaoRoom(runtime, clock, 2), another = await gaolaoRoom(runtime, clock, 2), handle = room.actors.get('wukong').handle, brace = room.content.items.find(item => item.itemId === 'gz-brace');
  await room.go('wukong', brace); await room.go(0, brace);
  const prepared = await runtime.prepareDecisionContext(handle), item = prepared.context.projection.items.find(value => value.name === '公共门撑');
  await take(room, 0, '公共门撑');
  assert.equal((await runtime.submitIntent(handle, prepared.decision.decisionId, rawIntent(prepared, { kind: 'take_item', itemRef: item.entityRef, expectedItemRevision: item.resourceRevision }))).code, 'DECISION_STALE');
  assert.notEqual((await runtime.replay(room.sessionId)).items['gz-brace'].location.characterId, handle.actorId);
  const next = await runtime.prepareDecisionContext(handle), foreign = (await another.snapshot('wukong')).projection.self;
  await assert.rejects(runtime.submitIntent(handle, next.decision.decisionId, rawIntent(next, { kind: 'inspect', targetRef: foreign.entityRef })), { code: 'INVALID_MESSAGE' });
  assert.equal((await runtime.decisionState(handle, next.decision.decisionId)).status, 'Rejected');
  const injected = await runtime.prepareDecisionContext(handle);
  await assert.rejects(runtime.submitIntent(handle, injected.decision.decisionId, JSON.stringify({ schemaVersion: 2, decisionId: injected.decision.decisionId, actorId: handle.actorId, toolCalls: [{ kind: 'wait' }] })), { code: 'INVALID_MESSAGE' });
});

test('借貌、许可与epoch：旧模型不重定向同貌实体，不复用撤回许可，终态不再创建决定', async () => {
  const room = await gaolaoRoom(runtime, clock, 2);
  await rescue(room); await disguise(room);
  const handle = room.actors.get('bajie').handle, prepared = await runtime.prepareDecisionContext(handle), fake = prepared.context.projection.entities.find(entity => entity.name === '翠兰');
  for (const forbidden of ['gz-wukong', '孙悟空', 'actorId', 'readVersions', 'controlEpoch']) assert.ok(!JSON.stringify(prepared.context).includes(forbidden), forbidden);
  assert.ok(fake);
  const consent = (await room.snapshot('cuilan')).projection.chapter.consents.findLast(value => value.purpose === 'appearance');
  accepted(await room.send('cuilan', { kind: 'withdraw_consent', consentId: consent.consentId, expectedConsentVersion: consent.version }));
  assert.equal((await runtime.submitIntent(handle, prepared.decision.decisionId, rawIntent(prepared, { kind: 'inspect', targetRef: fake.entityRef }))).code, 'STALE_REFERENCE');
  await room.go('tang', room.C('C19')); await room.go(0, room.C('C19'));
  accepted(await room.interact(0, '唐僧', 'gz-invite-meeting', { destinationId: 'front-meeting', expectedConsentVersion: '0' }));
  let meeting = (await room.snapshot('tang')).projection.chapter.consents.findLast(value => value.purpose === 'meeting');
  accepted(await room.send('tang', { kind: 'respond_consent', consentId: meeting.consentId, expectedConsentVersion: meeting.version, response: 'accept' }));
  const tang = room.actors.get('tang').handle, navigation = await runtime.prepareDecisionContext(tang);
  meeting = (await room.snapshot('tang')).projection.chapter.consents.findLast(value => value.purpose === 'meeting');
  accepted(await room.send('tang', { kind: 'withdraw_consent', consentId: meeting.consentId, expectedConsentVersion: meeting.version }));
  assert.equal((await runtime.submitIntent(tang, navigation.decision.decisionId, rawIntent(navigation, { kind: 'move_to', sceneId: room.C('C19').sceneId, destination: room.C('C19').position }))).code, 'CONSENT_STALE');
  const late = await runtime.prepareDecisionContext(tang);
  await runtime.abortSession(room.sessionId, '完成旧模型围栏检查');
  assert.equal((await runtime.submitIntent(tang, late.decision.decisionId, rawIntent(late, { kind: 'wait' }))).code, 'STALE_CONTROL');
  await assert.rejects(runtime.prepareDecisionContext(tang), { code: 'FORBIDDEN' });
});
