import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { rpcRaceRoom } from '../test-support/rpc-race-room.mjs';
import { until } from '../test-support/spatial-supply-room.mjs';

let database;
before(async () => { database = await startTestPostgres('rpc-race', { outputSubdirectory: 'rpc-race-implement' }); });
after(async () => { await database?.stop(); });
const projection = batch => batch.events.at(-1)?.payload.projection;
const self = p => p.entities.find(entity => entity.entityRef === p.self.entityRef);

test('RRS-T01/T02：真实运动push之后RPC续读S，轨迹从S开始且已排W只确认覆盖', { timeout: 15000 }, async t => {
  const r = await rpcRaceRoom(t, database.pool), peer = r.clients[0], initial = peer.client.state.snapshot;
  const receipt = await r.runtime.submit(peer.handle, JSON.stringify({ schemaVersion: 2, sessionId: r.sessionId,
    viewId: initial.viewId, actorRef: initial.projection.self.entityRef, clientActionId: crypto.randomUUID(),
    controlEpoch: initial.projection.self.controlEpoch, baseSeq: initial.snapshotSeq,
    action: { kind: 'move_direction', movementCommandSeq: '1', sceneId: initial.projection.self.sceneId, mapVersion: initial.projection.mapVersion, direction: 'E' } }));
  assert.equal(receipt.status, 'Accepted'); await r.settle();
  const before = peer.client.state.snapshot, R = before.snapshotSeq, view = r.runtime.connectionView(peer.handle), installed = view.cursor;
  const gate = r.holdRead(peer), rpcCount = r.rpc.length, wireStart = peer.wire.length, readCount = r.reads.length;
  const label = process.env.XIYOU_RRS_EVIDENCE_PREFIX ?? crypto.randomUUID();
  assert.match(label, /^[A-Za-z0-9_-]+$/);
  let round, rpcGate, S, B;
  try {
    S = await r.step(50); await gate.entered;
    assert.equal(r.sent(peer), R); assert.equal(peer.client.state.snapshot.snapshotSeq, R);
    rpcGate = r.holdRead(peer);
    round = peer.client.sync(); round.catch(() => {});
    await until(() => r.rpc.length > rpcCount, '真实RPC须排到活动publisher之后', 5000);
    const admitted = r.rpc.find((call, index) => index >= rpcCount && call.handle === peer.handle);
    assert.equal(admitted.request.cursor, R); assert.equal(admitted.sent, R);
    assert.equal(r.reads.slice(readCount).filter(call => call.handle === peer.handle).length, 1);
    B = await r.step(50); assert(BigInt(B) > BigInt(S));
    assert.equal(r.sent(peer), R, 'P函数被门控但其SQL已COMMIT；B真实提交不能伪造发送水位');
    gate.release(); await rpcGate.entered;
    await until(() => r.publications.some(call => call.handle === peer.handle && call.target === B && !call.settled), '未发送的RPC候选须占lane，后继W只能排队', 5000);
    rpcGate.release(); await round;
    await until(() => r.publications.some(call => call.handle === peer.handle && call.target === B && call.settled), '后W必须自然settle', 5000);
    await r.settle();
    const wire = peer.wire.slice(wireStart), push = wire.find(item => item.kind === 'push' && item.value.throughSeq === S);
    const ack = wire.find(item => item.kind === 'ack');
    assert(push && ack);
    const pS = projection(push.value), pB = projection(ack.value), own = self(pB);
    assert(pS.sceneTimeMs > before.projection.sceneTimeMs);
    assert(pS.self.position.x > before.projection.self.position.x, 'S必须已经包含真实移动，clock-only不能证明轨迹起点');
    assert.equal(own.motionFromSceneTimeMs, pS.sceneTimeMs, '新ACK轨迹必须从先行push覆盖的sceneTime开始');
    assert.deepEqual(own.motionTrail[0], pS.self.position, '新ACK不能重新包含R→S的旧运动');
    assert.equal(own.motionTimeline[0].fromSceneTimeMs, pS.sceneTimeMs);
    assert(pB.sceneTimeMs > pS.sceneTimeMs); assert(pB.self.position.x > pS.self.position.x);
    assert.equal(ack.value.fromExclusive, S); assert.equal(ack.value.throughSeq, B); assert.equal(ack.value.syncFrontierSeq, B);
    assert(wire.indexOf(push) < wire.indexOf(ack)); assert.equal(push.after, S); assert.equal(ack.before, S); assert.equal(ack.after, B);
    assert.equal(peer.snapshots.filter(value => value.snapshotSeq === S).length, 1);
    assert.equal(peer.snapshots.filter(value => value.snapshotSeq === B).length, 1);
    assert.equal(admitted.proof, true); assert.equal(admitted.sentAfter, B);
    assert.equal(r.runtime.connectionView(peer.handle), view); assert.equal(view.cursor, installed);
    await until(() => r.publications.some(call => call.handle === peer.handle && call.target === B && call.settled && call.result?.covered), '后W须自然完成covered机会', 5000);
    assert.equal(r.reads.slice(readCount).filter(call => call.handle === peer.handle).length, 2, 'RPC供给B之后后W不能重建同一完整前缀');
  } finally {
    gate.release(); rpcGate?.release(); await round?.catch(() => {});
    const output = new URL('../../.agent-output/rpc-race-implement/', import.meta.url);
    await mkdir(output, { recursive: true });
    await writeFile(new URL(`movement-${label}.json`, output), JSON.stringify({ R, S, B, before, wire: peer.wire.slice(wireStart),
      snapshots: peer.snapshots.map(value => ({ cursor: value.snapshotSeq, sceneTimeMs: value.projection.sceneTimeMs, position: value.projection.self.position })),
      reads: r.reads.slice(readCount).filter(call => call.handle === peer.handle).map(({ request, internal, settled, error, value }) => ({ request, internal, settled, error, value })),
      publications: r.publications.filter(call => call.handle === peer.handle).map(({ target, settled, result, error }) => ({ target, settled, result, error })) }, null, 2));
  }
});

test('RRS-T03：push拒收后本轮refetch补历史，独立fresh只追加一次空重复', { timeout: 15000 }, async t => {
  const r = await rpcRaceRoom(t, database.pool), peer = r.clients[0], R = peer.client.state.snapshot.snapshotSeq;
  const gate = r.holdRead(peer), wireStart = peer.wire.length, requestStart = peer.requests.length, rpcCount = r.rpc.length;
  let round, corrupted = 0;
  try {
    const S = await r.append(); await gate.entered;
    peer.transformPush = value => {
      if (value.throughSeq !== S || corrupted) return value;
      corrupted++; return { ...value, events: '受控损坏输入' };
    };
    round = peer.client.sync(); round.catch(() => {});
    await until(() => r.rpc.length > rpcCount, '真实RPC须先入队', 5000);
    const B = await r.append(); gate.release(); await round;
    await until(() => peer.wire.slice(wireStart).filter(item => item.kind === 'ack' && Object.hasOwn(item, 'after')).length >= 3,
      '原consumer须完成本轮补取与独立fresh的三次ACK', 5000);
    await r.settle();
    const wire = peer.wire.slice(wireStart), push = wire.find(item => item.kind === 'push' && item.value.throughSeq === S);
    const race = wire.find(item => item.kind === 'ack' && item.value.fromExclusive === S);
    const history = wire.find(item => item.kind === 'ack' && item.value.fromExclusive === R && item.value.throughSeq === B);
    const requests = peer.requests.slice(requestStart).filter(item => item.event === 'sync.request').map(item => item.request);
    const acks = wire.filter(item => item.kind === 'ack');
    t.diagnostic(JSON.stringify({ case: 'RRS-T03', R, S, B, requestCursors: requests.map(request => request.cursor),
      acks: acks.map(item => ({ type: item.value.type, fromExclusive: item.value.fromExclusive, throughSeq: item.value.throughSeq,
        syncFrontierSeq: item.value.syncFrontierSeq, eventCount: Array.isArray(item.value.events) ? item.value.events.length : null,
        before: item.before, after: item.after })), installedB: peer.snapshots.filter(value => value.snapshotSeq === B).length, sent: r.sent(peer) }));
    assert.equal(corrupted, 1); assert(push && race && history);
    assert.equal(push.before, R); assert.equal(push.after, R);
    assert.equal(race.before, R); assert.equal(race.after, R, '不连续的新ACK不能跳过拒收前缀');
    assert.equal(history.before, R); assert.equal(history.after, B);
    assert(wire.indexOf(race) < wire.indexOf(history));
    // 回复自身的refetch从R续本轮；push已登记的独立fresh仍须从B服务一次，不能被历史补取吞掉。
    assert.deepEqual(requests.map(request => request.cursor), [R, R, B], '本轮历史补取与独立fresh各一次，ACK不能制造第四次请求');
    assert(requests.every(request => request.sessionId === r.sessionId && request.viewId === peer.client.state.snapshot.viewId));
    assert.deepEqual(acks.map(item => [item.value.type, item.value.fromExclusive, item.value.throughSeq, item.before, item.after]), [
      ['world.batch', S, B, R, R], ['world.batch', R, B, R, B], ['world.batch', B, B, B, B],
    ]);
    assert.deepEqual(acks[2].value.events, [], '独立fresh回复必须是合法空重复，不能再次重放历史');
    assert.equal(acks[2].value.syncFrontierSeq, B);
    assert.equal(peer.snapshots.filter(value => value.snapshotSeq === B).length, 1);
    assert.equal(r.sent(peer), B);
  } finally { gate.release(); delete peer.transformPush; await round?.catch(() => {}); }
});

test('RRS-T10：竞态RPC真实读COMMIT后错误不生成Batch证明，后W从成功push水位恢复', { timeout: 15000 }, async t => {
  const r = await rpcRaceRoom(t, database.pool), peer = r.clients[0], R = peer.client.state.snapshot.snapshotSeq;
  const gate = r.holdRead(peer), wireStart = peer.wire.length, rpcCount = r.rpc.length;
  let round, rpcGate;
  try {
    const S = await r.append(); await gate.entered; rpcGate = r.holdRead(peer);
    round = peer.client.sync(); round.catch(() => {});
    await until(() => r.rpc.length > rpcCount, '真实RPC须先入队', 5000);
    const admitted = r.rpc.find((call, index) => index >= rpcCount && call.handle === peer.handle);
    const B = await r.append(); gate.release(); await rpcGate.entered;
    assert.equal(r.sent(peer), S); rpcGate.fail(new Error('受控读COMMIT后结果未知'));
    await round; await r.settle();
    assert.equal(admitted.error, 'OUTCOME_UNKNOWN'); assert.equal(admitted.proof, undefined);
    const wire = peer.wire.slice(wireStart), failure = wire.find(item => item.kind === 'ack' && item.value.code === 'OUTCOME_UNKNOWN');
    assert(failure); assert(!wire.some(item => item.kind === 'ack' && item.value.type === 'world.batch'));
    assert(wire.some(item => item.kind === 'push' && item.value.fromExclusive === R && item.value.throughSeq === S));
    assert(wire.some(item => item.kind === 'push' && item.value.fromExclusive === S && item.value.throughSeq === B));
    assert.equal(r.sent(peer), B); assert.equal(peer.client.state.snapshot.snapshotSeq, B);
    assert.equal((await database.pool.query('SELECT 1 AS alive')).rows[0].alive, 1, '未知结果后连接仍正常释放可复用');
  } finally { gate.release(); rpcGate?.release(); await round?.catch(() => {}); }
});
