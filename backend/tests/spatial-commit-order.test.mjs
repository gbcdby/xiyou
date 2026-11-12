import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createRuntime } from '../runtime.mjs';
import { createAuthorityServer } from '../server.mjs';

const capabilities = ['spatial-v2'];
const now = () => Date.parse('2026-11-12T12:00:00.000Z');
let database, runtime, gate, queryFailure;
before(async () => {
  database = await startTestPostgres('spatial-commit-order', { outputSubdirectory: 'commit-repair' });
  const pool = {
    query: (...args) => database.pool.query(...args),
    connect: async () => {
      const client = await database.pool.connect();
      return new Proxy(client, { get(target, key) {
        if (key === 'query') return async (...args) => {
          if (queryFailure?.matches(...args)) {
            queryFailure = null;
            throw new Error('受控数据库返回故障');
          }
          if (gate?.select?.(...args)) gate.selectedClient = client;
          const selected = gate && !gate.claimed && gate.matches(args[0]) && (!gate.select || gate.selectedClient === client) ? gate : null;
          if (selected) {
            selected.claimed = true;
            if (selected.before) { selected.enter(); await selected.released; }
          }
          const result = await client.query(...args);
          if (selected && !selected.before) {
            // PostgreSQL 已真正 COMMIT、释放行锁；只延迟驱动响应，其他事务可完整提交。
            selected.enter();
            await selected.released;
            if (selected.responseLost) throw new Error('真实 COMMIT 后受控响应丢失');
          }
          return result;
        };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    },
  };
  runtime = await createRuntime({ pool, now });
});
after(async () => { gate?.release(); await runtime?.close(); await database?.stop(); });

function delay(matches = sql => sql === 'COMMIT', before = false) {
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const released = new Promise(resolve => { release = resolve; });
  gate = { matches, before, enter, release, entered, released };
  return gate;
}
const controlRaw = (snapshot, type, nonce) => JSON.stringify({ schemaVersion: 2, type, sessionId: snapshot.sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce });
const sync = (handle, snapshot) => runtime.sync(handle, JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId: snapshot.sessionId, viewId: snapshot.viewId, cursor: snapshot.snapshotSeq }));
const actionRaw = (snapshot, text, clientActionId = crypto.randomUUID()) => JSON.stringify({ schemaVersion: 2, sessionId: snapshot.sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, controlEpoch: snapshot.projection.self.controlEpoch, baseSeq: snapshot.snapshotSeq, clientActionId, action: { kind: 'speak', text, channel: 'public', recipientRefs: [] } });
async function room(authority = runtime) {
  const users = [await authority.guest({ name: '提交边界玩家甲' }), await authority.guest({ name: '提交边界玩家乙' })];
  const { sessionId } = await authority.create(users[0].token, { nonce: crypto.randomUUID(), contentVersion: 'spatial-graybox-v2', capabilities });
  await authority.join(users[1].token, sessionId, { nonce: 'join', capabilities });
  await authority.start(users[0].token, sessionId, { nonce: 'start' });
  const handles = [], snapshots = [];
  for (const user of users) {
    const handle = await authority.openConnection(user.token, capabilities);
    const snapshot = await authority.subscribe(handle, sessionId);
    const response = await authority.control(handle, controlRaw(snapshot, 'control.resume', 'initial-control'));
    handles.push(handle); snapshots.push(response.snapshot);
  }
  await authority.publishPending();
  return { users, sessionId, handles, snapshots };
}

test('R-31-STD-001：已 COMMIT 的迟到控制回调不回退新 epoch、感知、Receipt 或事件发布', { timeout: 10000 }, async () => {
  const r = await room(), handle = r.handles[0], delayed = delay();
  const original = controlRaw(r.snapshots[0], 'control.take', 'delayed-take');
  const pending = runtime.control(handle, original);
  const revoked = [];
  const onRevoke = value => revoked.push(value);
  runtime.on('view-revoked', onRevoke);
  try {
    await delayed.entered;
    const committed = await runtime.snapshot(r.users[0].token, r.sessionId, capabilities);
    assert.ok(BigInt(committed.projection.self.controlEpoch) > BigInt(r.snapshots[0].projection.self.controlEpoch));
    const newer = await runtime.control(handle, controlRaw(committed, 'control.take', 'newer-take'));
    const raw = actionRaw(newer.snapshot, '新控制代次的公开陈述', 'newer-speech');
    const accepted = await runtime.submit(handle, raw);
    assert.equal(accepted.status, 'Accepted');
    await sync(handle, newer.snapshot);
    delayed.release();
    const older = await pending;
    assert.ok(BigInt(newer.controlEpoch) > BigInt(older.controlEpoch));
    const batch = await sync(handle, newer.snapshot);
    assert.equal(batch.events.at(-1).payload.projection.self.controlEpoch, newer.controlEpoch);
    assert.ok(batch.events.at(-1).payload.projection.claims.some(claim => claim.text === '新控制代次的公开陈述'));
    assert.deepEqual(await runtime.receipt(r.users[0].token, r.sessionId, 'newer-speech'), accepted);
    assert.deepEqual(await runtime.submit(handle, raw), accepted);
    const rejected = await runtime.submit(handle, actionRaw(older.snapshot, '旧控制不应发言', 'stale-speech'));
    assert.equal(rejected.code, 'STALE_CONTROL');
    assert.deepEqual(await runtime.receipt(r.users[0].token, r.sessionId, 'stale-speech'), rejected);
    const deliveries = [];
    await runtime.publishPending(async (connectionId, published) => { if (connectionId === handle.connectionId) deliveries.push(published); });
    assert.ok(deliveries.length > 0);
    let cursor = newer.snapshot.snapshotSeq;
    for (const published of deliveries) {
      assert.equal(published.viewId, newer.snapshot.viewId);
      assert.equal(published.fromExclusive, cursor);
      assert.ok(BigInt(published.throughSeq) > BigInt(cursor));
      cursor = published.throughSeq;
    }
    const observed = deliveries.at(-1).events.at(-1).payload.projection;
    assert.equal(observed.self.controlEpoch, newer.controlEpoch);
    assert.ok(observed.claims.some(claim => claim.text === '新控制代次的公开陈述'));
    assert.ok(!observed.claims.some(claim => claim.text === '旧控制不应发言'));
    assert.deepEqual(await runtime.control(handle, original), older);
    await sync(handle, newer.snapshot);
    assert.ok(!revoked.some(value => value.connectionId === handle.connectionId));
  } finally { delayed.release(); await pending.catch(() => {}); runtime.off('view-revoked', onRevoke); gate = null; }
});

test('R-31-STD-001：COMMIT 响应在途时发布器保留待发事件，不撤销连接', { timeout: 10000 }, async () => {
  const r = await room(), handle = r.handles[0], delayed = delay();
  const pending = runtime.control(handle, controlRaw(r.snapshots[0], 'control.take', 'publishing-take'));
  const revoked = [], delivered = [];
  const onRevoke = value => revoked.push(value);
  runtime.on('view-revoked', onRevoke);
  try {
    await delayed.entered;
    assert.equal((await runtime.submit(r.handles[1], actionRaw(r.snapshots[1], '安装等待期间的感知'))).status, 'Accepted');
    await runtime.publishPending(async (connectionId, batch) => delivered.push({ connectionId, batch }));
    assert.ok(!revoked.some(value => value.connectionId === handle.connectionId), '提交响应在途不能误报撤权');
    assert.ok(delivered.some(value => value.connectionId === r.handles[1].connectionId), '其他连接仍可读取已提交事件');
    delayed.release();
    const completed = await pending;
    await runtime.publishPending(async (connectionId, batch) => delivered.push({ connectionId, batch }));
    const observed = delivered.filter(value => value.connectionId === handle.connectionId).at(-1)?.batch;
    assert.equal(observed?.viewId, completed.snapshot.viewId);
    assert.ok(observed.events.at(-1).payload.projection.claims.some(claim => claim.text === '安装等待期间的感知'));
    await sync(handle, completed.snapshot);
  } finally { delayed.release(); await pending.catch(() => {}); runtime.off('view-revoked', onRevoke); gate = null; }
});

test('R-31-STD-001：同会话较早提交的订阅回调不能覆盖较新订阅', { timeout: 10000 }, async () => {
  const r = await room(), handle = r.handles[0], delayed = delay(), pending = runtime.subscribe(handle, r.sessionId);
  try {
    await delayed.entered;
    const newer = await runtime.subscribe(handle, r.sessionId);
    delayed.release();
    const older = await pending;
    assert.notEqual(older.viewId, newer.viewId);
    await sync(handle, newer);
    await assert.rejects(sync(handle, older), { code: 'RESYNC_REQUIRED' });
  } finally { delayed.release(); await pending.catch(() => {}); gate = null; }
});

test('R-31-STD-001：同会话请求发起顺序不同仍按实际提交的持久视图安装', { timeout: 10000 }, async () => {
  const r = await room(), handle = r.handles[0];
  const delayed = delay(sql => sql === 'SELECT * FROM sessions WHERE session_id=$1 FOR UPDATE', true);
  const startedEarlier = runtime.subscribe(handle, r.sessionId);
  try {
    await delayed.entered;
    const committedEarlier = await runtime.subscribe(handle, r.sessionId);
    delayed.release();
    const committedLater = await startedEarlier;
    assert.ok(BigInt(committedLater.snapshotSeq) > BigInt(committedEarlier.snapshotSeq));
    await sync(handle, committedLater);
    await assert.rejects(sync(handle, committedEarlier), { code: 'RESYNC_REQUIRED' });
  } finally { delayed.release(); await startedEarlier.catch(() => {}); gate = null; }
});

test('R-31-STD-001：迟到旧会话订阅不覆盖已切换的新会话', { timeout: 10000 }, async () => {
  const r = await room(), handle = r.handles[0];
  const other = await runtime.create(r.users[0].token, { nonce: 'another-room', contentVersion: 'spatial-graybox-v2', capabilities });
  const delayed = delay(), pending = runtime.subscribe(handle, r.sessionId);
  try {
    await delayed.entered;
    const newer = await runtime.subscribe(handle, other.sessionId);
    delayed.release();
    const older = await pending;
    assert.ok(BigInt(older.snapshotSeq) > BigInt(newer.snapshotSeq));
    await sync(handle, newer);
    await assert.rejects(sync(handle, older), { code: 'RESYNC_REQUIRED' });
  } finally { delayed.release(); await pending.catch(() => {}); gate = null; }
});

test('R-31-STD-003：A→B→A 后旧 A 订阅迟到取得行锁不能破坏当前持久视图', { timeout: 10000 }, async () => {
  const r = await room(), handle = r.handles[0];
  const other = await runtime.create(r.users[0].token, { nonce: 'scope-roundtrip', contentVersion: 'spatial-graybox-v2', capabilities });
  const delayed = delay(sql => sql === 'SELECT * FROM sessions WHERE session_id=$1 FOR UPDATE', true);
  const pending = runtime.subscribe(handle, r.sessionId).then(snapshot => ({ snapshot }), error => ({ error }));
  const revoked = [];
  const onRevoke = value => revoked.push(value);
  runtime.on('view-revoked', onRevoke);
  try {
    await delayed.entered;
    const switched = await runtime.subscribe(handle, other.sessionId);
    await sync(handle, switched);
    const latest = await runtime.subscribe(handle, r.sessionId);
    await sync(handle, latest);
    delayed.release();
    const late = await pending;
    const durable = await runtime.snapshot(r.users[0].token, r.sessionId, capabilities);
    assert.equal(durable.viewId, latest.viewId, '过期选择不能旋转已被当前选择采用的持久视图');
    assert.equal(durable.snapshotSeq, latest.snapshotSeq, '拒绝过期选择不追加空间事实');
    assert.equal(durable.projection.self.controlEpoch, latest.projection.self.controlEpoch);
    assert.equal(late.error?.code, 'RESYNC_REQUIRED');
    await sync(handle, latest);
    await runtime.publishPending();
    await sync(handle, latest);
    assert.ok(!revoked.some(value => value.connectionId === handle.connectionId));
  } finally { delayed.release(); await pending; runtime.off('view-revoked', onRevoke); gate = null; }
});

test('R-31-STD-003：B 和返回 A 均已 COMMIT 但未安装时旧 A 不能改写新持久视图', { timeout: 10000 }, async () => {
  const r = await room(), handle = r.handles[0];
  const other = await runtime.create(r.users[0].token, { nonce: 'pending-scope-roundtrip', contentVersion: 'spatial-graybox-v2', capabilities });
  const readGate = delay(sql => sql === 'SELECT * FROM sessions WHERE session_id=$1 FOR UPDATE', true);
  const oldA = runtime.subscribe(handle, r.sessionId).then(snapshot => ({ snapshot }), error => ({ error }));
  let bGate, aGate, pendingB, pendingA;
  const revoked = [];
  const onRevoke = value => revoked.push(value);
  runtime.on('view-revoked', onRevoke);
  try {
    await readGate.entered;
    bGate = delay();
    pendingB = runtime.subscribe(handle, other.sessionId);
    await bGate.entered;
    aGate = delay();
    pendingA = runtime.subscribe(handle, r.sessionId);
    await aGate.entered;
    const committed = await runtime.snapshot(r.users[0].token, r.sessionId, capabilities);
    readGate.release();
    const old = await oldA;
    bGate.release();
    await pendingB;
    aGate.release();
    const latest = await pendingA;
    const durable = await runtime.snapshot(r.users[0].token, r.sessionId, capabilities);
    assert.equal(durable.viewId, committed.viewId, '旧选择不能改写已提交但响应仍在途的最新视图');
    assert.equal(durable.snapshotSeq, committed.snapshotSeq);
    assert.equal(latest.viewId, committed.viewId);
    assert.equal(old.error?.code, 'RESYNC_REQUIRED');
    await sync(handle, latest);
    await runtime.publishPending();
    await sync(handle, latest);
    assert.ok(!revoked.some(value => value.connectionId === handle.connectionId));
  } finally {
    readGate.release(); bGate?.release(); aGate?.release();
    await Promise.allSettled([oldA, pendingB, pendingA]);
    runtime.off('view-revoked', onRevoke); gate = null;
  }
});

test('R-31-STD-003：较新选择回滚保留当前绑定，但不重新授权旧在途订阅', { timeout: 10000 }, async () => {
  const r = await room(), handle = r.handles[0];
  const other = await runtime.create(r.users[0].token, { nonce: 'rolled-scope', contentVersion: 'spatial-graybox-v2', capabilities });
  const delayed = delay(sql => sql === 'SELECT * FROM sessions WHERE session_id=$1 FOR UPDATE', true);
  const oldA = runtime.subscribe(handle, r.sessionId).then(snapshot => ({ snapshot }), error => ({ error }));
  try {
    await delayed.entered;
    runtime.hooks.beforeCommit = ({ command, sessionId }) => {
      if (command === 'subscribe' && sessionId === other.sessionId) throw new Error('受控选择事务回滚');
    };
    await assert.rejects(runtime.subscribe(handle, other.sessionId), { message: '受控选择事务回滚' });
    delete runtime.hooks.beforeCommit;
    await sync(handle, r.snapshots[0]);
    delayed.release();
    const old = await oldA;
    const durable = await runtime.snapshot(r.users[0].token, r.sessionId, capabilities);
    assert.equal(durable.viewId, r.snapshots[0].viewId);
    assert.equal(old.error?.code, 'RESYNC_REQUIRED');
    await sync(handle, r.snapshots[0]);
    const reselected = await runtime.subscribe(handle, r.sessionId);
    await sync(handle, reselected);
  } finally { delete runtime.hooks.beforeCommit; delayed.release(); await oldA; gate = null; }
});

test('R-31-STD-003：历史控制 nonce 查询不挤掉在途的新会话选择', { timeout: 10000 }, async () => {
  const r = await room(), handle = r.handles[0];
  const raw = controlRaw(r.snapshots[0], 'control.take', 'scope-replay-only');
  const response = await runtime.control(handle, raw);
  const other = await runtime.create(r.users[0].token, { nonce: 'nonce-during-scope', contentVersion: 'spatial-graybox-v2', capabilities });
  const delayed = delay(sql => sql === 'SELECT * FROM sessions WHERE session_id=$1 FOR UPDATE', true);
  const selectingB = runtime.subscribe(handle, other.sessionId);
  try {
    await delayed.entered;
    assert.deepEqual(await runtime.control(handle, raw), response);
    delayed.release();
    const latest = await selectingB;
    await sync(handle, latest);
    assert.deepEqual(await runtime.control(handle, raw), response);
    await sync(handle, latest);
  } finally { delayed.release(); await selectingB.catch(() => {}); gate = null; }
});

test('R-31-STD-003：其他选择回滚后原 nonce 仍可恢复已提交的安装', { timeout: 10000 }, async () => {
  const r = await room(), handle = r.handles[0], raw = controlRaw(r.snapshots[0], 'control.take', 'recover-across-choice');
  queryFailure = { matches: (sql, values) => sql === 'SELECT state FROM sessions WHERE session_id=$1 FOR UPDATE' && values[0] === r.sessionId };
  try {
    await assert.rejects(runtime.control(handle, raw), { code: 'OUTCOME_UNKNOWN' });
    const committed = await runtime.snapshot(r.users[0].token, r.sessionId, capabilities);
    const other = await runtime.create(r.users[0].token, { nonce: 'failed-other-choice', contentVersion: 'spatial-graybox-v2', capabilities });
    runtime.hooks.beforeCommit = ({ command, sessionId }) => {
      if (command === 'subscribe' && sessionId === other.sessionId) throw new Error('受控选择事务回滚');
    };
    await assert.rejects(runtime.subscribe(handle, other.sessionId), { message: '受控选择事务回滚' });
    delete runtime.hooks.beforeCommit;
    const recovered = await runtime.control(handle, raw);
    assert.equal(recovered.controlEpoch, committed.projection.self.controlEpoch);
    assert.equal(recovered.snapshot.viewId, committed.viewId);
    await sync(handle, recovered.snapshot);
    assert.deepEqual(await runtime.control(handle, raw), recovered);
    await sync(handle, recovered.snapshot);
  } finally { queryFailure = null; delete runtime.hooks.beforeCommit; }
});

test('R-31-STD-001：关闭连接后迟到的已提交控制回调不能复活旧绑定', { timeout: 10000 }, async () => {
  const r = await room(), handle = r.handles[0], delayed = delay();
  const pending = runtime.control(handle, controlRaw(r.snapshots[0], 'control.take', 'closing-take'));
  try {
    await delayed.entered;
    await runtime.disconnect(handle);
    delayed.release();
    const older = await pending;
    await assert.rejects(sync(handle, older.snapshot), { code: 'RESYNC_REQUIRED' });
    const newHandle = await runtime.openConnection(r.users[0].token, capabilities);
    const subscribed = await runtime.subscribe(newHandle, r.sessionId);
    const resumed = await runtime.control(newHandle, controlRaw(subscribed, 'control.take', 'reconnected-take'));
    assert.ok(BigInt(resumed.controlEpoch) > BigInt(older.controlEpoch));
    await sync(newHandle, resumed.snapshot);
  } finally { delayed.release(); await pending.catch(() => {}); gate = null; }
});

test('R-31-STD-001：提交后安装读取失败可用原 nonce 恢复发布和断线交还', { timeout: 10000 }, async () => {
  const r = await room(), handle = r.handles[0], raw = controlRaw(r.snapshots[0], 'control.take', 'recover-install');
  queryFailure = { matches: (sql, values) => sql === 'SELECT state FROM sessions WHERE session_id=$1 FOR UPDATE' && values[0] === r.sessionId };
  const revoked = [];
  const onRevoke = value => revoked.push(value);
  runtime.on('view-revoked', onRevoke);
  try {
    await assert.rejects(runtime.control(handle, raw), { code: 'OUTCOME_UNKNOWN' });
    const committed = await runtime.snapshot(r.users[0].token, r.sessionId, capabilities);
    assert.equal((await runtime.submit(r.handles[1], actionRaw(r.snapshots[1], '恢复安装前的待发感知'))).status, 'Accepted');
    await runtime.publishPending();
    assert.ok(!revoked.some(value => value.connectionId === handle.connectionId));
    const recovered = await runtime.control(handle, raw);
    assert.equal(recovered.controlEpoch, committed.projection.self.controlEpoch);
    assert.equal(recovered.snapshot.viewId, committed.viewId);
    const delivered = [];
    await runtime.publishPending(async (connectionId, batch) => { if (connectionId === handle.connectionId) delivered.push(batch); });
    assert.ok(delivered.at(-1).events.at(-1).payload.projection.claims.some(claim => claim.text === '恢复安装前的待发感知'));
    await sync(handle, recovered.snapshot);
    await runtime.disconnect(handle);
    const newHandle = await runtime.openConnection(r.users[0].token, capabilities);
    const subscribed = await runtime.subscribe(newHandle, r.sessionId);
    const resumed = await runtime.control(newHandle, controlRaw(subscribed, 'control.resume', 'after-install-recovery'));
    assert.ok(BigInt(resumed.controlEpoch) > BigInt(recovered.controlEpoch));
    await sync(newHandle, resumed.snapshot);
  } finally { queryFailure = null; runtime.off('view-revoked', onRevoke); }
});

test('R-31-STD-001：真实 COMMIT 响应丢失后原 nonce 恢复不重新执行控制', { timeout: 10000 }, async () => {
  const r = await room(), handle = r.handles[0], delayed = delay();
  delayed.responseLost = true;
  const raw = controlRaw(r.snapshots[0], 'control.take', 'lost-commit-response');
  const pending = runtime.control(handle, raw);
  const outcome = assert.rejects(pending, { code: 'OUTCOME_UNKNOWN' });
  try {
    await delayed.entered;
    const committed = await runtime.snapshot(r.users[0].token, r.sessionId, capabilities);
    delayed.release();
    await outcome;
    const recovered = await runtime.control(handle, raw);
    assert.equal(recovered.controlEpoch, committed.projection.self.controlEpoch);
    assert.equal(recovered.snapshot.viewId, committed.viewId);
    assert.deepEqual(await runtime.control(handle, raw), recovered);
    await sync(handle, recovered.snapshot);
    await runtime.disconnect(handle);
    const afterDisconnect = await runtime.snapshot(r.users[0].token, r.sessionId, capabilities);
    assert.ok(BigInt(afterDisconnect.projection.self.controlEpoch) > BigInt(recovered.controlEpoch));
  } finally { delayed.release(); await pending.catch(() => {}); gate = null; }
});

test('R-31-STD-001：切换会话后重放旧控制 nonce 不重新绑定旧会话', { timeout: 10000 }, async () => {
  const r = await room(), handle = r.handles[0], original = controlRaw(r.snapshots[0], 'control.take', 'original-take');
  const response = await runtime.control(handle, original);
  const other = await runtime.create(r.users[0].token, { nonce: 'switch-after-control', contentVersion: 'spatial-graybox-v2', capabilities });
  const snapshot = await runtime.subscribe(handle, other.sessionId);
  for (let repeat = 0; repeat < 2; repeat++) {
    assert.deepEqual(await runtime.control(handle, original), response);
    await sync(handle, snapshot);
    await assert.rejects(sync(handle, response.snapshot), { code: 'RESYNC_REQUIRED' });
  }
});

test('R-31-STD-001：较早丢失的 COMMIT 响应不能覆盖较新待恢复安装', { timeout: 10000 }, async () => {
  const r = await room(), handle = r.handles[0], delayed = delay();
  delayed.responseLost = true;
  const pending = runtime.control(handle, controlRaw(r.snapshots[0], 'control.take', 'older-lost-response'));
  const outcome = assert.rejects(pending, { code: 'OUTCOME_UNKNOWN' });
  try {
    await delayed.entered;
    const committed = await runtime.snapshot(r.users[0].token, r.sessionId, capabilities);
    const newerRaw = controlRaw(committed, 'control.take', 'newer-pending-install');
    queryFailure = { matches: (sql, values) => sql === 'SELECT state FROM sessions WHERE session_id=$1 FOR UPDATE' && values[0] === r.sessionId };
    await assert.rejects(runtime.control(handle, newerRaw), { code: 'OUTCOME_UNKNOWN' });
    const newest = await runtime.snapshot(r.users[0].token, r.sessionId, capabilities);
    delayed.release();
    await outcome;
    const recovered = await runtime.control(handle, newerRaw);
    assert.equal(recovered.controlEpoch, newest.projection.self.controlEpoch);
    await sync(handle, recovered.snapshot);
  } finally { queryFailure = null; delayed.release(); await pending.catch(() => {}); gate = null; }
});

test('R-31-STD-001：真实 Socket.IO 在 COMMIT 返回乱序后仍连接并同步新控制事实', { timeout: 10000 }, async () => {
  const server = await createAuthorityServer({ pool: runtime.pool, now });
  let socket, delayed, pending;
  try {
    const r = await room(server.runtime), { port } = await server.listen(0);
    socket = io(`http://127.0.0.1:${port}`, { auth: { token: r.users[0].token, capabilities }, transports: ['websocket'], reconnection: false });
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    const rpc = (event, value) => socket.timeout(3000).emitWithAck(event, value);
    const subscribed = await rpc('session.subscribe', { sessionId: r.sessionId });
    const initial = await rpc('control.take', controlRaw(subscribed, 'control.take', 'network-initial'));
    assert.ok(initial.snapshot);
    delayed = delay();
    delayed.select = (sql, values) => sql.startsWith('INSERT INTO command_nonces') && values[2] === 'network-delayed';
    pending = rpc('control.take', controlRaw(initial.snapshot, 'control.take', 'network-delayed'));
    await delayed.entered;
    // 直接触发与服务定时器同一发布入口；真实撤销事件会使实际 Socket 断开。
    await server.runtime.publishPending();
    const committed = await server.runtime.snapshot(r.users[0].token, r.sessionId, capabilities);
    const newer = await rpc('control.take', controlRaw(committed, 'control.take', 'network-newer'));
    assert.ok(newer.snapshot);
    delayed.release();
    const older = await pending;
    assert.ok(BigInt(newer.controlEpoch) > BigInt(older.controlEpoch));
    assert.equal(socket.connected, true);
    const raw = actionRaw(newer.snapshot, '网络回调乱序之后的合法陈述', 'network-speech');
    const accepted = await rpc('player.action.request', raw);
    assert.equal(accepted.status, 'Accepted');
    const batch = await rpc('sync.request', JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId: r.sessionId, viewId: newer.snapshot.viewId, cursor: newer.snapshot.snapshotSeq }));
    assert.equal(batch.type, 'world.batch');
    assert.equal(batch.viewId, newer.snapshot.viewId);
    assert.equal(batch.events.at(-1).payload.projection.self.controlEpoch, newer.controlEpoch);
    assert.ok(batch.events.at(-1).payload.projection.claims.some(claim => claim.text === '网络回调乱序之后的合法陈述'));
    assert.deepEqual(await server.runtime.receipt(r.users[0].token, r.sessionId, 'network-speech'), accepted);
    assert.equal(socket.connected, true);
  } finally { delayed?.release(); await pending?.catch(() => {}); gate = null; socket?.disconnect(); await server.close(); }
});
