import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createRuntime } from '../runtime.mjs';
import { createAuthorityServer } from '../server.mjs';
import { gaolaoNetworkAdapter } from '../test-support/gaolao-network.mjs';
import { gaolaoRoom, confirmEnd } from '../test-support/gaolao-room.mjs';
import { SpatialView } from '../../frontend/src/domain/spatial-view.ts';
import { parseSpatial } from '../../protocol/spatial.mjs';

const capabilities = ['spatial-v2'];
const syncRaw = snapshot => JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId: snapshot.sessionId, viewId: snapshot.viewId, cursor: snapshot.snapshotSeq });
const controlRaw = snapshot => JSON.stringify({ schemaVersion: 2, type: 'control.take', sessionId: snapshot.sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce: crypto.randomUUID() });
async function historyCounts(pool, sessionId) {
  const { rows } = await pool.query('SELECT (SELECT count(*) FROM world_events WHERE session_id=$1) AS events,(SELECT count(*) FROM outbox WHERE session_id=$1) AS outbox', [sessionId]);
  return rows[0];
}

test('R33STD002：真实双Socket终态刷新后读取复盘并持续15秒，不因只读订阅互相重同步', { timeout: 30000 }, async t => {
  const db = await startTestPostgres('terminal-network', { outputSubdirectory: 'r33std002' });
  let server, net;
  t.after(async () => { await net?.close(); await server?.close(); await db.stop(); });
  // 使用真实墙钟和原200ms发布器；不改生产客户端的终态批次围栏。
  server = await createAuthorityServer({ pool: db.pool });
  const address = await server.listen(0), origin = `http://127.0.0.1:${address.port}`;
  net = gaolaoNetworkAdapter(server, origin);
  const r = await gaolaoRoom(net, { value: Date.now() }, 2);
  await confirmEnd(r, 'chapter');
  const clients = [];
  function install(index, socket, snapshot) {
    const view = new SpatialView(), generation = view.begin(r.sessionId);
    assert.equal(view.acceptSnapshot(snapshot, generation), 'applied');
    clients[index] = { socket, view, generation };
  }
  for (let i = 0; i < 2; i++) install(i, r.handles[i], await r.snapshot(i));
  const terminal = clients[0].view.snapshot.snapshotSeq;
  assert.equal(clients[0].view.snapshot.projection.ending.endingCode, 'GZ-E03');
  const before = await historyCounts(db.pool, r.sessionId);
  async function refresh(index) {
    clients[index].socket.disconnect();
    const socket = await net.openConnection(r.users[index].token, capabilities);
    install(index, socket, await net.subscribe(socket, r.sessionId));
  }
  await refresh(0);
  const fixedThroughSeq = clients[0].view.snapshot.snapshotSeq;
  const first = await net.recap(r.users[0].token, r.sessionId, { throughSeq: fixedThroughSeq });
  assert.ok(first.entries.length);
  const started = performance.now(), changes = [], viewIds = clients.map(c => new Set([c.view.snapshot.viewId]));
  let checks = 0;
  while (performance.now() - started < 15000) {
    for (let i = 0; i < clients.length; i++) {
      const client = clients[i], batch = await net.sync(client.socket, syncRaw(client.view.snapshot));
      const result = client.view.applyBatch(batch, client.generation);
      if (result === 'resync') {
        changes.push({ player: i, from: client.view.snapshot.snapshotSeq, through: batch.throughSeq });
        await refresh(i);
        viewIds[i].add(clients[i].view.snapshot.viewId);
      } else assert.equal(result, 'duplicate', JSON.stringify({ result, batch }));
    }
    checks++;
    await pause(250);
  }
  const elapsedMs = performance.now() - started;
  const response = await fetch(origin + `/api/sessions/${r.sessionId}/recap?throughSeq=${fixedThroughSeq}`, { headers: { Authorization: 'Bearer ' + r.users[0].token } });
  const after = await historyCounts(db.pool, r.sessionId), final = await server.runtime.replay(r.sessionId);
  t.diagnostic(JSON.stringify({ terminal, refreshed: fixedThroughSeq, final: final.sessionSeq, checks, elapsedMs, resyncs: changes.length, views: viewIds.map(s => s.size), retainedRecapStatus: response.status, before, after, changes: changes.slice(0, 4) }));
  assert.equal(changes.length, 0, '终态只读重订阅不能使另一端反复resync');
  assert.equal(fixedThroughSeq, terminal);
  assert.equal(final.sessionSeq, terminal);
  assert.deepEqual(after, before);
  assert.equal(response.status, 200);
  assert.deepEqual(parseSpatial('RecapV2', await response.text()), first);
  assert.ok(elapsedMs >= 15000 && checks > 1);
  assert.deepEqual(net.errors, []);
});

test('R33STD002：首次无视图的终态HTTP/订阅/内部上下文读取不追加事实，重启后仍可读', async t => {
  const db = await startTestPostgres('terminal-first-read', { outputSubdirectory: 'r33std002' });
  let runtime = await createRuntime({ pool: db.pool });
  t.after(async () => { await runtime.close(); await db.stop(); });
  const users = [await runtime.guest({ name: '首次终态甲' }), await runtime.guest({ name: '首次终态乙' })];
  const { sessionId } = await runtime.create(users[0].token, { nonce: crypto.randomUUID(), contentVersion: 'gaolaozhuang-v1', capabilities });
  await runtime.join(users[1].token, sessionId, { nonce: crypto.randomUUID(), capabilities });
  await runtime.cancel(users[0].token, sessionId, { nonce: crypto.randomUUID() });
  const before = await runtime.replay(sessionId), counts = await historyCounts(db.pool, sessionId);
  assert.deepEqual(before.views, {});
  for (const user of users) {
    const http = await runtime.snapshot(user.token, sessionId, capabilities);
    assert.equal(http.snapshotSeq, before.sessionSeq, '首次HTTP读取不能补写终态view事件');
    const handle = await runtime.openConnection(user.token, capabilities);
    const snapshot = await runtime.subscribe(handle, sessionId);
    assert.equal(snapshot.snapshotSeq, before.sessionSeq);
    assert.equal(snapshot.projection.phase, 'Aborted');
    assert.equal(snapshot.projection.self.canControl, false);
    const batch = await runtime.sync(handle, syncRaw(snapshot));
    assert.equal(batch.throughSeq, before.sessionSeq);
    assert.deepEqual(batch.events, []);
    assert.equal((await runtime.recap(user.token, sessionId, { throughSeq: before.sessionSeq })).phase, 'Aborted');
    await assert.rejects(runtime.control(handle, controlRaw(snapshot)), { code: 'FORBIDDEN' });
  }
  assert.deepEqual(await runtime.replay(sessionId), before);
  assert.deepEqual(await historyCounts(db.pool, sessionId), counts);
  await runtime.close();
  runtime = await createRuntime({ pool: db.pool });
  const renewed = await runtime.openConnection(users[0].token, capabilities), snapshot = await runtime.subscribe(renewed, sessionId);
  assert.equal(snapshot.snapshotSeq, before.sessionSeq);
  assert.equal((await runtime.sync(renewed, syncRaw(snapshot))).throughSeq, before.sessionSeq);
  assert.deepEqual(await runtime.replay(sessionId), before);

  const r = await gaolaoRoom(runtime, { value: Date.now() }, 2);
  await confirmEnd(r, 'chapter');
  const finished = await runtime.replay(r.sessionId), npcId = r.content.chapterRules.people.witness;
  assert.equal(finished.views[npcId], undefined);
  const internal = await runtime.observeInternal(r.actors.get('witness').handle);
  assert.equal(internal.snapshotSeq, finished.sessionSeq);
  assert.equal(internal.projection.self.name, '茶棚见证人');
  const context = await runtime.spatialContext(r.actors.get('witness').handle);
  assert.equal(context.projection.self.name, '茶棚见证人');
  assert.deepEqual(await runtime.replay(r.sessionId), finished);
});
