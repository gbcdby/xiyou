import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createRuntime } from '../runtime.mjs';
import { gaolaoRoom, accepted } from '../test-support/gaolao-room.mjs';
import { deferred, until } from '../test-support/ai-room.mjs';
import { ModelGateway } from '../ai/gateway.mjs';
import { AIOrchestrator } from '../ai/orchestrator.mjs';
import { attachSpatialAI } from '../ai/spatial-runtime.mjs';
import { spatialEvaluationReport } from '../scripts/evaluate-spatial-ai.mjs';

let db, runtime;
const clock = { value: Date.parse('2026-11-12T23:00:00Z') };
const output = (context, action = { kind: 'wait' }) => ({ rawText: JSON.stringify({ schemaVersion: 2, decisionId: context.decision.decisionId, toolCalls: [action] }) });
before(async () => { db = await startTestPostgres('spatial-orchestrator', { outputSubdirectory: 'a3-ai-runtime' }); runtime = await createRuntime({ pool: db.pool, now: () => clock.value }); });
after(async () => { await runtime?.close(); await db?.stop(); });

test('并发1/2公平轮转：持续唤醒的首角色不能挤掉悟空与八戒，超时释放槽位', async () => {
  for (const maxConcurrent of [1, 2]) {
    const room = await gaolaoRoom(runtime, clock, 2), handles = ['tang', 'wukong', 'bajie'].map(key => room.actors.get(key).handle), order = [];
    let orchestrator, active = 0, maximum = 0;
    const gateway = new ModelGateway({ provider: { kind: 'controlled', providerId: 'fair-spatial', async generate({ context }, { signal }) {
      const name = context.projection.self.name; order.push(name); active++; maximum = Math.max(maximum, active);
      orchestrator.wake(handles[0]);
      try {
        if (order.length === 1) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
        else await new Promise(resolve => setTimeout(resolve, 15));
        return output(context);
      } finally { active--; }
    } }, modelId: 'controlled-fairness', timeoutMs: 60 });
    orchestrator = new AIOrchestrator({ runtime, gateway, maxConcurrent, minIntervalMs: 1, maxCallsPerSession: 5 });
    try {
      for (const handle of handles) orchestrator.watch(handle, { autoWake: false });
      await until(() => order.length >= 5 && handles.every(handle => !['Preparing', 'Inferring', 'Submitting', 'Recovering'].includes(orchestrator.status(handle).phase)), '有限预算内三人应分别获得完整模型周期', 5000);
      assert.ok(maximum <= maxConcurrent);
      assert.ok(order.slice(0, 3).includes('唐僧')); assert.ok(order.slice(0, 3).includes('孙悟空')); assert.ok(order.slice(0, 3).includes('猪刚鬣'));
      assert.equal(gateway.metrics().timeouts, 1);
      assert.equal((await db.pool.query('SELECT count(*) FROM ai_runs WHERE session_id=$1', [room.sessionId])).rows[0].count, '5');
      const report = await spatialEvaluationReport(db.pool, room.sessionId);
      assert.equal(report.evaluation, 'NOT_RUN'); assert.equal(report.controlledSamples, 5); assert.equal(report.externalSamples, 0);
    } finally { await orchestrator.close(); }
  }
});

test('内容动态注册三自治角色，场景角色不调用模型；连续空间步进不消耗额外预算', async () => {
  const room = await gaolaoRoom(runtime, clock, 5);
  const gateway = new ModelGateway({ provider: { kind: 'controlled', providerId: 'registry-spatial', async generate({ context }) { return output(context); } }, modelId: 'controlled-registry' });
  const ai = await attachSpatialAI({ runtime, gateway, maxConcurrent: 2, minIntervalMs: 1, maxCallsPerSession: 6 });
  try {
    const current = () => ai.status().sessions.find(value => value.sessionId === room.sessionId);
    await until(() => current()?.actors.length === 3 && current().actors.every(actor => actor.lastReceipt?.status === 'Accepted' && actor.phase === 'Idle'), '三名自治角色必须各完成一次规则提交', 5000);
    assert.deepEqual(current().actors.map(actor => actor.actorKind), ['persistent_core', 'persistent_core', 'chapter_autonomous']);
    assert.equal(current().sceneRoles.length, 3);
    const before = Number((await db.pool.query('SELECT count(*) FROM ai_runs WHERE session_id=$1', [room.sessionId])).rows[0].count);
    for (let index = 0; index < 18; index++) {
      const self = (await room.snapshot(0)).projection.self;
      accepted(await room.send(0, { kind: 'move_to', sceneId: self.sceneId, destination: { x: self.position.x + (index % 2 ? -20 : 20), y: self.position.y }, movementCommandSeq: String(index + 1) }));
      await room.step(30);
    }
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(Number((await db.pool.query('SELECT count(*) FROM ai_runs WHERE session_id=$1', [room.sessionId])).rows[0].count), before);
    assert.equal(before, 3);
  } finally { await ai.close(); }
});

test('模型在途时普通动作继续；非法JSON/超时只执行原安全fallback，不产生去留或借貌决定', async () => {
  const room = await gaolaoRoom(runtime, clock, 2), handles = ['tang', 'wukong', 'bajie'].map(key => room.actors.get(key).handle), entered = deferred(), late = deferred();
  const gateway = new ModelGateway({ provider: { kind: 'controlled', providerId: 'fault-spatial', generate({ context }) {
    entered.resolve();
    if (context.projection.self.name === '唐僧') return late.promise;
    return { rawText: '{"schemaVersion":2,"toolCalls":[' };
  } }, modelId: 'controlled-faults', timeoutMs: 100 });
  const orchestrator = new AIOrchestrator({ runtime, gateway, maxConcurrent: 1, minIntervalMs: 1, maxCallsPerSession: 3 });
  try {
    for (const handle of handles) orchestrator.watch(handle, { autoWake: false });
    await entered.promise;
    const claim = accepted(await room.send(0, { kind: 'speak', text: '模型等待时普通现场交谈继续。', channel: 'public', recipientRefs: [] }));
    assert.ok(claim.actionEventRange);
    await until(() => handles.every(handle => orchestrator.status(handle).lastFallback?.status === 'Accepted'), '三名故障角色应完成有限安全降级', 5000);
    const state = await runtime.replay(room.sessionId);
    assert.equal(state.chapter.disguise, null); assert.deepEqual(state.chapter.decisions, {}); assert.deepEqual(state.chapter.consents, {});
    const reasons = state.observations[handles[0].actorId].flatMap(observation => observation.fields).filter(field => field.key === 'reason');
    assert.ok(reasons.some(reason => reason.value === 'model_timeout'));
    const original = structuredClone(state);
    late.resolve(output({ decision: { decisionId: orchestrator.status(handles[0]).decisionId } }, { kind: 'wait' }));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(await runtime.replay(room.sessionId), original);
  } finally { late.resolve({ rawText: '{}' }); await orchestrator.close(); }
});

test('生产启动顺序：暂停房间先注册不消费模型，第二名真人上线后自动唤醒三角色', async () => {
  const gateway = new ModelGateway({ provider: { kind: 'controlled', providerId: 'startup-spatial', generate({ context }) { return output(context); } }, modelId: 'controlled-startup' });
  const ai = await attachSpatialAI({ runtime, gateway, maxConcurrent: 2, minIntervalMs: 1, maxCallsPerSession: 3 });
  const caps = ['spatial-v2'], users = await Promise.all([1, 2].map(index => runtime.guest({ name: `启动检查${index}` })));
  try {
    const { sessionId } = await runtime.create(users[0].token, { nonce: crypto.randomUUID(), contentVersion: 'gaolaozhuang-v1', capabilities: caps });
    for (const user of users) await runtime.join(user.token, sessionId, { nonce: crypto.randomUUID(), capabilities: caps });
    await runtime.start(users[0].token, sessionId, { nonce: 'start' });
    const current = () => ai.status().sessions.find(value => value.sessionId === sessionId);
    await until(() => current()?.actors.length === 3 && current().actors.every(actor => actor.error === 'SESSION_PAUSED'), '房间暂停时注册必须停在有界等待状态');
    assert.equal((await db.pool.query('SELECT count(*) FROM ai_runs WHERE session_id=$1', [sessionId])).rows[0].count, '0');
    for (const user of users) {
      const handle = await runtime.openConnection(user.token, caps), snapshot = await runtime.subscribe(handle, sessionId);
      await runtime.control(handle, JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce: crypto.randomUUID() }));
    }
    await until(() => current().actors.every(actor => actor.lastReceipt?.status === 'Accepted' && actor.phase === 'Idle'), '从暂停恢复必须实际唤醒已注册的三名角色', 1500);
    assert.equal((await db.pool.query('SELECT count(*) FROM ai_runs WHERE session_id=$1', [sessionId])).rows[0].count, '3');
  } finally { await ai.close(); }
});
