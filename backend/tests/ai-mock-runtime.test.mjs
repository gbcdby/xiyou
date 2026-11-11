import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createRunningRoom, actionRaw, deferred, until } from '../test-support/ai-room.mjs';
import { createRuntime } from '../runtime.mjs';
import { createMockServer } from '../mock-main.mjs';
import { attachMockAI } from '../ai/mock-runtime.mjs';
import { createMockProvider, mockPolicies } from '../ai/mock-provider.mjs';
import { ModelGateway } from '../ai/gateway.mjs';
import { AIOrchestrator } from '../ai/orchestrator.mjs';
import { reserveCall, saveOutput } from '../ai/persistence.mjs';

let database;
before(async () => { database = await startTestPostgres('ai-mock-runtime'); });
after(async () => { await database?.stop(); });
const calls = async sessionId => Number((await database.pool.query('SELECT count(*) FROM ai_runs WHERE session_id=$1', [sessionId])).rows[0].count);

test('未向核心角色授权的观察不唤醒策略，不消耗其他区域等待角色的共享预算', async () => {
  const server = await createMockServer({ pool: database.pool, minIntervalMs: 10 });
  try {
    const room = await createRunningRoom(server.runtime, 5);
    const state = () => server.ai.status().roles.map(role => ({ actorId: role.actorId, ...role.sessions.find(session => session.sessionId === room.sessionId) }));
    await until(() => state().every(role => role.phase === 'Idle' && !role.pendingWake), '初始合法主动行为必须先收束', 10_000);
    const before = state();
    const hidden = await server.runtime.submit(room.connections[3], actionRaw(room, 3, { kind: 'inspect', targetId: 'material_cache' }));
    assert.equal(hidden.status, 'Accepted');
    assert.deepEqual(state(), before, '只向真人授权的检查不能唤醒两位NPC');
    await server.runtime.submit(room.connections[0], actionRaw(room, 0, { kind: 'speak', channel: 'public', recipientIds: [], text: '出口 destination' }));
    await until(() => state()[0].calls > before[0].calls && state()[0].phase === 'Idle' && !state()[0].pendingWake, '唐僧必须响应自己合法听到的新建议');
    assert.equal(state()[1].calls, before[1].calls, '远处悟空不应为未听到的公开话语消耗预算');
  } finally { await server.close(); }
});

test('显式入口自动登记新开局，关闭全部角色任务；重启恢复已有局且预算不重置', async () => {
  let server = await createMockServer({ pool: database.pool, minIntervalMs: 15, maxCallsPerSession: 2 });
  let restarted;
  try {
    const address = await server.listen(0);
    assert.equal((await fetch(`http://127.0.0.1:${address.port}/health`)).status, 200);
    const room = await createRunningRoom(server.runtime);
    await until(() => server.ai.status().roles.every(role => role.sessions.some(session => session.sessionId === room.sessionId)), '新开局必须自动登记两角色');
    await until(async () => await calls(room.sessionId) === 2 && server.ai.status().roles.every(role => role.metrics.active === 0 && role.sessions.every(session => ['Idle', 'BudgetExhausted'].includes(session.phase))), '两角色首轮必须实际完成');
    const records = (await database.pool.query('SELECT actor_id,configuration,outcome FROM ai_runs WHERE session_id=$1', [room.sessionId])).rows;
    assert.deepEqual(records.map(row => row.actor_id).sort(), ['tangseng', 'wukong']);
    assert.ok(records.every(row => row.configuration.providerKind === 'controlled' && row.outcome?.receipt?.status === 'Accepted'));
    await assert.rejects(attachMockAI({ runtime: server.runtime }), /已登记/);
    const beforeClose = await server.runtime.replay(room.sessionId);
    await server.close(); await server.close();
    assert.equal(server.ai.status().closed, true);
    assert.ok(server.ai.status().roles.every(role => role.metrics.active === 0 && role.sessions.length === 0));
    await assert.rejects(fetch(`http://127.0.0.1:${address.port}/health`));
    restarted = await createMockServer({ pool: database.pool, minIntervalMs: 15, maxCallsPerSession: 2 });
    await until(() => restarted.ai.status().roles.every(role => role.sessions.some(session => session.sessionId === room.sessionId && session.phase === 'BudgetExhausted')), '已有 Running 局必须恢复登记并读取持久预算');
    assert.equal(await calls(room.sessionId), 2);
    assert.ok(restarted.ai.status().roles.every(role => role.metrics.calls === 0));
    assert.deepEqual(await restarted.runtime.replay(room.sessionId), beforeClose);
  } finally { await server.close(); await restarted?.close(); }
});

test('入口恢复两份已保存的旧意图，每项只提交一次，不消耗新的模型调用', async () => {
  const runtime = await createRuntime({ pool: database.pool });
  const room = await createRunningRoom(runtime); const ids = [];
  let server; let next;
  try {
    for (const role of ['tangseng', 'wukong']) {
      const handle = await runtime.bindInternal(room.sessionId, role, 'core_npc');
      const prepared = await runtime.prepareDecisionContext(handle);
      const gateway = new ModelGateway({ provider: createMockProvider(role), modelId: mockPolicies[role].modelId });
      try {
        assert.equal((await reserveCall(runtime, handle, prepared, gateway.configuration(), 2)).reserved, true);
        const output = await gateway.generate(prepared.context);
        assert.equal(output.status, 'Valid');
        await saveOutput(runtime, handle, prepared.decision.decisionId, output);
        ids.push(prepared.decision.decisionId);
      } finally { await gateway.close(); }
    }
    await runtime.close();
    server = await createMockServer({ pool: database.pool, minIntervalMs: 15, maxCallsPerSession: 2 });
    await until(() => server.ai.status().roles.every(role => role.sessions.some(session => session.sessionId === room.sessionId && session.phase === 'BudgetExhausted')), '恢复后必须先查旧结果再受持久预算约束');
    assert.ok(server.ai.status().roles.every(role => role.metrics.calls === 0));
    const state = await server.runtime.replay(room.sessionId);
    await server.close();
    next = await createMockServer({ pool: database.pool, minIntervalMs: 15, maxCallsPerSession: 2 });
    await until(() => next.ai.status().roles.every(role => role.sessions.some(session => session.sessionId === room.sessionId && session.phase === 'BudgetExhausted')), '再次启动不应重复旧意图');
    assert.deepEqual(await next.runtime.replay(room.sessionId), state);
    for (const decisionId of ids) {
      const rows = (await database.pool.query('SELECT receipt FROM action_receipts WHERE session_id=$1 AND client_action_id=$2', [room.sessionId, `${decisionId}:submit`])).rows;
      assert.equal(rows.length, 1); assert.equal(rows[0].receipt.status, 'Accepted');
    }
    assert.equal(await calls(room.sessionId), 2);
  } finally { await runtime.close(); await server?.close(); await next?.close(); }
});

test('双角色组合：验证适配器超时和非法 JSON 各只收束一次，等待时玩家仍有 Receipt', async () => {
  const runtime = await createRuntime({ pool: database.pool });
  const room = await createRunningRoom(runtime);
  const late = deferred(); const inputs = new Map(); const workers = [];
  try {
    for (const role of ['tangseng', 'wukong']) {
      const handle = await runtime.bindInternal(room.sessionId, role, 'core_npc');
      const provider = createMockProvider(role);
      const gateway = new ModelGateway({ provider: { kind: 'controlled', providerId: `verification-${role}`, generate(input) {
        inputs.set(role, input);
        return role === 'tangseng' ? late.promise : { rawText: '{bad' };
      } }, modelId: mockPolicies[role].modelId, timeoutMs: 500 });
      const orchestrator = new AIOrchestrator({ runtime, gateway, minIntervalMs: 10, maxCallsPerSession: 2 });
      workers.push({ role, handle, provider, gateway, orchestrator });
      orchestrator.watch(handle, { autoWake: false });
    }
    await until(() => inputs.size === 2, '两角色必须并行进入同一流水线');
    const receipt = await runtime.submit(room.connections[1], actionRaw(room, 1, { kind: 'inspect', targetId: 'stock_record' }));
    assert.equal(receipt.status, 'Accepted');
    assert.equal(workers[0].orchestrator.status(workers[0].handle).phase, 'Inferring');
    await until(() => workers.every(worker => worker.orchestrator.status(worker.handle).lastFallback && worker.orchestrator.status(worker.handle).phase === 'Idle'), '非法和超时都必须产生稳定 fallback');
    assert.equal(workers[0].gateway.metrics().timeouts, 1);
    assert.equal(workers[1].gateway.metrics().invalid, 1);
    const beforeLate = await runtime.replay(room.sessionId);
    late.resolve(await workers[0].provider.generate(inputs.get('tangseng')));
    await new Promise(resolve => setImmediate(resolve));
    for (const worker of workers) { await worker.orchestrator.recover(worker.handle); await worker.orchestrator.recover(worker.handle); }
    assert.deepEqual(await runtime.replay(room.sessionId), beforeLate);
    for (const worker of workers) {
      const decisionId = inputs.get(worker.role).context.decision.decisionId;
      assert.equal((await runtime.decisionState(worker.handle, decisionId)).status, 'Rejected');
      assert.equal(await runtime.internalReceipt(worker.handle, `${decisionId}:submit`), null);
      assert.equal((await database.pool.query('SELECT count(*) FROM action_receipts WHERE session_id=$1 AND client_action_id=$2', [room.sessionId, `${decisionId}:fallback`])).rows[0].count, '1');
    }
  } finally { late.resolve({ rawText: '{}' }); await Promise.all(workers.map(worker => worker.orchestrator.close())); await runtime.close(); }
});

test('双角色组合：终局取消在途输出，两个迟到合法意图均不能提交', async () => {
  const runtime = await createRuntime({ pool: database.pool });
  const room = await createRunningRoom(runtime);
  const workers = [];
  try {
    for (const role of ['tangseng', 'wukong']) {
      const handle = await runtime.bindInternal(room.sessionId, role, 'core_npc');
      const gate = deferred(); const provider = createMockProvider(role); const worker = { handle, gate, provider };
      const gateway = new ModelGateway({ provider: { kind: 'controlled', providerId: `verification-late-${role}`, generate(input) { worker.input = input; return gate.promise; } }, modelId: mockPolicies[role].modelId });
      worker.orchestrator = new AIOrchestrator({ runtime, gateway, minIntervalMs: 10, maxCallsPerSession: 2 });
      workers.push(worker); worker.orchestrator.watch(handle, { autoWake: false });
    }
    await until(() => workers.every(worker => worker.input), '两角色必须先取得合法在途输入');
    await runtime.abortSession(room.sessionId, '合成终局取消样本');
    await until(() => workers.every(worker => worker.orchestrator.status(worker.handle).phase === 'Idle'), '终局必须取消两次推理');
    const ending = await runtime.replay(room.sessionId);
    for (const worker of workers) worker.gate.resolve(await worker.provider.generate(worker.input));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(await runtime.replay(room.sessionId), ending);
    for (const worker of workers) {
      const decisionId = worker.input.context.decision.decisionId;
      assert.equal((await runtime.decisionState(worker.handle, decisionId)).status, 'Cancelled');
      assert.equal(await runtime.internalReceipt(worker.handle, `${decisionId}:submit`), null);
    }
  } finally { for (const worker of workers) worker.gate.resolve({ rawText: '{}' }); await Promise.all(workers.map(worker => worker.orchestrator.close())); await runtime.close(); }
});
