import test from 'node:test';
import assert from 'node:assert/strict';
import { createAIServer } from '../ai-main.mjs';
import { ModelGateway } from '../ai/gateway.mjs';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { gaolaoRoom, accepted } from '../test-support/gaolao-room.mjs';
import { gaolaoNetworkAdapter } from '../test-support/gaolao-network.mjs';
import { until } from '../test-support/ai-room.mjs';

test('真实HTTP/Socket启动入口：三自治角色共享Gateway完成提交，普通客户端继续操作并完整关闭', async t => {
  const db = await startTestPostgres('spatial-ai-server', { outputSubdirectory: 'a3-ai-runtime' }), clock = { value: Date.parse('2026-11-13T00:00:00Z') };
  let server, network;
  const gateway = new ModelGateway({ provider: { kind: 'controlled', providerId: 'network-spatial', generate({ context }) { return { rawText: JSON.stringify({ schemaVersion: 2, decisionId: context.decision.decisionId, toolCalls: [{ kind: 'wait' }] }) }; } }, modelId: 'controlled-network' });
  t.after(async () => { await network?.close(); await server?.close(); await db.stop(); });
  server = await createAIServer({ pool: db.pool, now: () => clock.value, gateway, maxConcurrent: 2, minIntervalMs: 1, maxCallsPerSession: 3 });
  network = gaolaoNetworkAdapter(server, `http://127.0.0.1:${(await server.listen(0)).port}`);
  const room = await gaolaoRoom(network, clock, 2);
  await until(() => server.ai.status().sessions.find(value => value.sessionId === room.sessionId)?.actors.every(actor => actor.lastReceipt?.status === 'Accepted' && actor.phase === 'Idle'), '正式服务入口必须实际完成三角色决定', 5000);
  accepted(await room.send(0, { kind: 'speak', text: '三名角色在场时真人仍可正常行动。', channel: 'public', recipientRefs: [] }));
  const snapshot = await room.snapshot(1);
  assert.equal(snapshot.projection.phase, 'Running');
  assert.equal((await db.pool.query('SELECT count(DISTINCT actor_id) FROM ai_runs WHERE session_id=$1', [room.sessionId])).rows[0].count, '3');
  assert.equal(gateway.metrics().externalCalls, 0); assert.deepEqual(network.errors, []);
  await network.close(); await server.close();
  assert.equal(gateway.metrics().active, 0); assert.equal(server.ai.status().closed, true);
});
