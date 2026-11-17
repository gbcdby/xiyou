import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io } from 'socket.io-client';
import { mkdir, writeFile } from 'node:fs/promises';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createAuthorityServer } from '../server.mjs';
import { validateSpatial } from '../../protocol/spatial.mjs';

const capabilities = ['spatial-v2', 'spatial-direction-v1', 'spatial-timed-trail-v1'];

test('真实PG冷重启：双人同步从已提交快照续读，不在控制恢复前扫描整局历史', { timeout: 30000 }, async t => {
  const database = await startTestPostgres('p05-cold-recovery', { outputSubdirectory: 'recovery-fix' });
  const sockets = [], reads = [], responses = [];
  let server, sessionId, snapshots;
  const clock = Date.parse('2026-11-17T00:00:00.000Z');
  t.after(async () => {
    await mkdir(new URL('../../.agent-output/recovery-fix/', import.meta.url), { recursive: true });
    await writeFile(new URL('../../.agent-output/recovery-fix/p05-cold-recovery.json', import.meta.url),
      JSON.stringify({ sessionId, snapshotSeqs: snapshots?.map(snapshot => snapshot.snapshotSeq), reads, responses }, null, 2));
    for (const socket of sockets) socket.disconnect();
    await server?.close(); await database.stop();
  });
  const start = () => createAuthorityServer({ pool: database.pool, now: () => clock, spatialDirection: { checkpointMs: 50 } });
  server = await start();
  const users = await Promise.all(['冷恢复甲', '冷恢复乙'].map(name => server.runtime.guest({ name })));
  ({ sessionId } = await server.runtime.create(users[0].token, { nonce: crypto.randomUUID(), contentVersion: 'spatial-graybox-v2', capabilities }));
  for (const user of users) await server.runtime.join(user.token, sessionId, { nonce: crypto.randomUUID(), capabilities });
  await server.runtime.start(users[0].token, sessionId, { nonce: crypto.randomUUID() });
  // 固定时钟的合法已提交事件构造长历史；不合成控制、收据或浏览器验收结果。
  for (let group = 0; group < 32; group++) await server.runtime.locked(sessionId, { kind: 'p05-history' }, async tx => {
    for (let index = 0; index < 128; index++) tx.emit('spatial.clock', {
      sceneTimeMs: tx.state.sceneTimeMs, wallAnchorMs: tx.state.wallAnchorMs, paused: tx.state.paused,
    });
  });
  await server.close(); server = await start();
  const address = await server.listen(0), origin = `http://127.0.0.1:${address.port}`;
  const stateAt = server.runtime.stateAt.bind(server.runtime);
  server.runtime.stateAt = async (tx, throughSeq) => {
    const query = tx.client.query;
    tx.client.query = async function (sql, values) {
      const result = await query.call(this, sql, values);
      if (sql.startsWith('SELECT event,event_text_encoding FROM world_events')) reads.push({
        throughSeq, lower: /session_seq\s*>\s*\$2/.test(sql) ? values[1] : '0', count: result.rows.length,
      });
      return result;
    };
    try { return await stateAt(tx, throughSeq); }
    finally { tx.client.query = query; }
  };
  await Promise.all(users.map(async user => {
    const socket = io(origin, { auth: { token: user.token, capabilities }, transports: ['websocket'], reconnection: false });
    sockets.push(socket); await once(socket, 'connect');
  }));
  const rpc = (socket, event, payload) => socket.timeout(20000).emitWithAck(event, payload);
  snapshots = await Promise.all(sockets.map(socket => rpc(socket, 'session.subscribe', { sessionId })));
  for (const snapshot of snapshots) validateSpatial('SnapshotV2', snapshot);
  await server.runtime.locked(sessionId, { kind: 'p05-following-commit' }, async tx => {
    tx.emit('spatial.clock', { sceneTimeMs: tx.state.sceneTimeMs, wallAnchorMs: tx.state.wallAnchorMs, paused: tx.state.paused });
  });
  const started = performance.now();
  const syncs = sockets.map((socket, index) => rpc(socket, 'sync.request', JSON.stringify({
    schemaVersion: 2, type: 'sync.request', sessionId, viewId: snapshots[index].viewId, cursor: snapshots[index].snapshotSeq,
  })));
  const batches = await Promise.all(syncs);
  for (const batch of batches) validateSpatial('BatchV2', batch);
  // 先完成两条真正的 timed-trail 冷同步，再并行恢复；不把正常的旧视图撤销误记为同步故障。
  const controls = sockets.map((socket, index) => rpc(socket, 'control.resume', JSON.stringify({
    schemaVersion: 2, type: 'control.resume', sessionId, viewId: snapshots[index].viewId,
    actorRef: snapshots[index].projection.self.entityRef, nonce: crypto.randomUUID(),
  })).then(response => {
    validateSpatial('ControlResponseV2', response);
    responses.push({ elapsedMs: performance.now() - started, canControl: response.snapshot.projection.self.canControl });
    assert.equal(response.snapshot.projection.self.canControl, true);
    assert.equal(response.snapshot.projection.self.controlEpoch, response.controlEpoch);
    return response;
  }));
  await Promise.all(controls);
  assert.equal(responses.length, 2);
  assert(responses.every(response => response.elapsedMs < 20000), '真实控制 ACK 必须保持原 20 秒上限');
  const floor = snapshots.map(snapshot => BigInt(snapshot.snapshotSeq)).reduce((a, b) => a < b ? a : b);
  assert(reads.every(read => BigInt(read.lower) >= floor),
    `已经观察的恢复快照不得触发前史重放：${JSON.stringify(reads)}`);
});
