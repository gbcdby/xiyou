import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { startTestPostgres } from '../../backend/test-support/postgres.mjs';
import { createRunningRoom, actionRaw, until } from '../../backend/test-support/ai-room.mjs';
import { createRuntime } from '../../backend/runtime.mjs';
import { createMockServer } from '../../backend/mock-main.mjs';
import { createMockProvider, mockPolicies } from '../../backend/ai/mock-provider.mjs';
import { ModelGateway } from '../../backend/ai/gateway.mjs';
import { reserveCall, saveOutput, saveOutcome } from '../../backend/ai/persistence.mjs';

const report = { scope: '独立标准探针：真实双Session唤醒隔离、终态不调用及最新不可见路线不退回旧请求', profile: 'mock-20261111', clock: '真实Runtime时钟；唤醒样本minIntervalMs=25，不计60秒窗口', checks: [], decisions: [], status: 'RUNNING', startedAt: new Date().toISOString() };
const started = performance.now();
const db = await startTestPostgres('std-mock-isolation');
let server; let runtime; let gateway;
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const check = (name, details = {}) => { report.checks.push({ name, assessment: 'PASS', ...details }); console.log(JSON.stringify({ name, assessment: 'PASS' })); };
async function send(authority, room, index, action) {
  const receipt = await authority.submit(room.connections[index], actionRaw(room, index, action));
  assert.equal(receipt.status, 'Accepted', receipt.code); return receipt;
}
try {
  server = await createMockServer({ pool: db.pool, minIntervalMs: 25 });
  const first = await createRunningRoom(server.runtime, 5);
  const second = await createRunningRoom(server.runtime, 2);
  const status = room => server.ai.status().roles.map(role => ({ actorId: role.actorId, ...role.sessions.find(session => session.sessionId === room.sessionId) }));
  const count = async room => (await db.pool.query('SELECT actor_id,count(*)::integer AS count FROM ai_runs WHERE session_id=$1 GROUP BY actor_id ORDER BY actor_id', [room.sessionId])).rows;
  async function settle(room) {
    await until(() => status(room).every(role => role.sessionId === room.sessionId && role.phase === 'Idle' && !role.pendingWake), '独立探针等待角色空闲', 15000);
  }
  await settle(first); await settle(second);
  const initial = await count(first);
  await send(server.runtime, first, 0, { kind: 'speak', text: '独立探针：私人对话不进入NPC调度', channel: 'private', recipientIds: [first.actors[2]] });
  await send(server.runtime, first, 3, { kind: 'inspect', targetId: 'material_cache' });
  await delay(175);
  assert.deepEqual(await count(first), initial);
  check('私人Claim与仅真人取得的Observation均不唤醒核心角色', { callsBefore: initial, callsAfter: await count(first) });

  const otherBefore = await count(second);
  await send(server.runtime, second, 0, { kind: 'speak', text: '独立探针：这一局的新公开建议', channel: 'public', recipientIds: [] });
  await until(async () => (await count(second)).some(row => row.count > otherBefore.find(old => old.actor_id === row.actor_id).count), '另一局自身合法话语应唤醒当地角色', 5000);
  await settle(second); await delay(75);
  assert.deepEqual(await count(first), initial);
  check('另一Session的合法唤醒不消耗本局持久预算', { otherBefore, otherAfter: await count(second), firstUnchanged: true });

  const beforeTerminal = await count(first);
  await server.runtime.abortSession(first.sessionId, '独立标准探针终止');
  await delay(175);
  assert.deepEqual(await count(first), beforeTerminal);
  assert.ok(server.ai.status().roles.every(role => role.metrics.externalCalls === 0));
  check('空闲角色终态后没有新provider调用，两个Gateway外部调用为0');
  await server.close();
  assert.ok(server.ai.status().roles.every(role => role.metrics.active === 0 && role.sessions.length === 0));

  // 使用新Runtime且不安装自动调度；两次合法请求都提交之后，再取得真实Gateway输入。
  runtime = await createRuntime({ pool: db.pool });
  const room = await createRunningRoom(runtime, 2);
  await send(runtime, room, 0, { kind: 'move', regionId: 'side_path' });
  await send(runtime, room, 0, { kind: 'speak', text: '出口 store', channel: 'public', recipientIds: [] });
  await send(runtime, room, 0, { kind: 'speak', text: '出口 not_visible_exit', channel: 'public', recipientIds: [] });
  const handle = await runtime.bindInternal(room.sessionId, 'wukong', 'core_npc');
  gateway = new ModelGateway({ provider: createMockProvider('wukong'), modelId: mockPolicies.wukong.modelId });
  for (let index = 0; index < 14; index++) {
    const prepared = await runtime.prepareDecisionContext(handle);
    const incoming = prepared.context.memory.claims.filter(claim => claim.speakerId !== 'wukong' && claim.text.startsWith('出口 '));
    assert.equal(incoming.at(-1).text, '出口 not_visible_exit');
    assert.equal((await reserveCall(runtime, handle, prepared, gateway.configuration(), 120)).reserved, true);
    const result = await gateway.generate(prepared.context);
    assert.equal(result.status, 'Valid');
    const intent = JSON.parse(result.rawText);
    assert.equal(intent.toolCalls.some(tool => tool.kind === 'move'), false, '最新请求不可见时不能回退旧store请求');
    await saveOutput(runtime, handle, prepared.decision.decisionId, result);
    const receipt = await runtime.submitIntent(handle, prepared.decision.decisionId, result.rawText);
    assert.equal(receipt.status, 'Accepted');
    await saveOutcome(runtime, handle, prepared.decision.decisionId, { decisionStatus: (await runtime.decisionState(handle, prepared.decision.decisionId)).status, receipt, fallback: null });
    assert.equal((await runtime.replay(room.sessionId)).characters.wukong.regionId, 'side_path');
    report.decisions.push({ decisionId: prepared.decision.decisionId, contextDigest: result.contextDigest, outputSha256: createHash('sha256').update(result.rawText).digest('hex'), tools: intent.toolCalls.map(tool => tool.kind), receiptStatus: receipt.status, eventRange: receipt.actionEventRange });
  }
  assert.equal(gateway.metrics().externalCalls, 0);
  check('最新不可见出口阻止旧合法请求复活：14次真实Decision/预留/提交均无移动', { calls: gateway.metrics().calls, latestRoute: 'not_visible_exit', previousRoute: 'store', finalRegion: 'side_path' });
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.error = { name: error.name, message: error.message, stack: error.stack }; process.exitCode = 1;
} finally {
  await gateway?.close(); await runtime?.close(); await server?.close(); await db.stop();
  report.elapsedMs = performance.now() - started;
  report.resourcesClosed = true;
  await writeFile(new URL('./isolation-probe.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, elapsedMs: report.elapsedMs, error: report.error?.message }));
}
