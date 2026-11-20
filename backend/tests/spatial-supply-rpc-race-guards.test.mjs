import test from 'node:test';
import assert from 'node:assert/strict';
import { room, capabilities } from '../test-support/spatial-supply-room.mjs';

const query = (r, peer, cursor) => JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId: r.sessionId,
  viewId: r.runtime.connectionView(peer.handle).viewId, cursor });
const sent = (r, peer) => r.runtime.spatialSupply.cursor(r.runtime.connectionView(peer.handle));

test('RRS-T05：内部连续起点不能洗白原R、伪造sent或跳过真实撤权', { timeout: 15000 }, async t => {
  const r = await room(t), peer = r.peers[0], S = sent(r, peer), raw = query(r, peer, S);
  const B = await r.append(); assert(BigInt(B) > BigInt(S));
  const persisted = () => r.database.pool.query('SELECT session_seq,state,logical_time FROM sessions WHERE session_id=$1', [r.sessionId]).then(value => value.rows);
  const before = await persisted();
  await assert.rejects(r.runtime.sync(peer.handle, query(r, peer, '0'), { sentPrefixStart: S }), { code: 'RESYNC_REQUIRED' });
  for (const internal of [{ sentPrefixStart: B }, { sentPrefixStart: Number(S) }, { sentPrefixStart: null },
    { sentPrefixStart: S, throughSeqCeiling: S }]) {
    await assert.rejects(r.runtime.sync(peer.handle, raw, internal), { code: 'RESYNC_REQUIRED' });
  }
  await assert.rejects(r.runtime.sync(peer.handle, query(r, peer, B), { sentPrefixStart: S }), { code: 'RESYNC_REQUIRED' });
  const valid = await r.runtime.sync(peer.handle, raw, { sentPrefixStart: S });
  assert.equal(valid.fromExclusive, S); assert.equal(valid.throughSeq, B); assert.equal(sent(r, peer), S, '构造候选不是发送证明');
  assert.deepEqual(await persisted(), before, '校验与授权读取不追加世界事件');
  // 真正撤权须先于内部参数校验；不能把原FORBIDDEN改成内部起点错误。
  await r.runtime.revokeAccess(r.sessionId, r.users[0].userId);
  await assert.rejects(r.runtime.sync(peer.handle, raw, { sentPrefixStart: '不可信内部值' }), { code: 'FORBIDDEN' });
  const other = r.peers[1], otherRaw = query(r, other, sent(r, other));
  await r.database.pool.query('UPDATE runtime_users SET active=false WHERE user_id=$1', [r.users[1].userId]);
  await assert.rejects(r.runtime.sync(other.handle, otherRaw, { sentPrefixStart: '不可信内部值' }), { code: 'UNAUTHENTICATED' });
});

test('RRS-T06：同viewId重新安装对象和授权后的真实closing都使旧内部起点失效', { timeout: 15000 }, async t => {
  const r = await room(t), peer = await r.addPeer(capabilities, 0, false);
  // 原subscribe仅在同角色已由另一连接控制时保留viewId；本人控制连接会合法旋转。
  const old = r.runtime.connectionView(peer.handle), S = sent(r, peer), raw = query(r, peer, S);
  const connect = r.database.pool.connect.bind(r.database.pool), borrowed = Promise.withResolvers(), releaseBorrow = Promise.withResolvers();
  let intercepted = false, reading, disconnecting;
  r.database.pool.connect = async (...args) => {
    const client = await connect(...args);
    if (!intercepted) { intercepted = true; borrowed.resolve(); await releaseBorrow.promise; }
    return client;
  };
  try {
    reading = r.runtime.sync(peer.handle, raw, { sentPrefixStart: S }); reading.catch(() => {}); await borrowed.promise;
    r.database.pool.connect = connect;
    const snapshot = await r.rpc(peer, 'session.subscribe', { sessionId: r.sessionId });
    const replacement = r.runtime.connectionView(peer.handle);
    assert.notEqual(replacement, old); assert.equal(replacement.viewId, old.viewId); assert.equal(snapshot.snapshotSeq, S);
    releaseBorrow.resolve(); await assert.rejects(reading, { code: 'RESYNC_REQUIRED' });
    assert.equal(sent(r, peer), S); assert.equal(replacement.active, true);
  } finally { releaseBorrow.resolve(); r.database.pool.connect = connect; await reading?.catch(() => {}); }

  const controller = r.peers[0], controlCursor = sent(r, controller);
  const access = r.runtime.access.bind(r.runtime), authorized = Promise.withResolvers(), releaseAccess = Promise.withResolvers();
  let held = false;
  r.runtime.access = async (...args) => {
    const user = await access(...args);
    if (!held) { held = true; authorized.resolve(); await releaseAccess.promise; }
    return user;
  };
  try {
    reading = r.runtime.sync(controller.handle, query(r, controller, controlCursor), { sentPrefixStart: controlCursor }); reading.catch(() => {}); await authorized.promise;
    disconnecting = r.runtime.disconnect(controller.handle); disconnecting.catch(() => {});
    assert.equal(r.runtime.connection(controller.handle).closing, true, '真实disconnect在首个await前关闭发送资格');
    releaseAccess.resolve(); await assert.rejects(reading, { code: 'RESYNC_REQUIRED' }); await disconnecting;
  } finally { releaseAccess.resolve(); r.runtime.access = access; await Promise.allSettled([reading, disconnecting].filter(Boolean)); }
});

test('RRS-T07：有效起点统一决定256分页、首完整事务回退、空批和固定Q', { timeout: 15000 }, async t => {
  const r = await room(t), peer = r.peers[0], view = r.runtime.connectionView(peer.handle), installed = view.cursor;
  const R = sent(r, peer), raw = query(r, peer, R), plus = (value, count) => String(BigInt(value) + BigInt(count));
  await r.append(128); await r.append(128); const head = await r.append(128);
  const first = await r.runtime.sync(peer.handle, raw, { sentPrefixStart: R });
  assert.equal(first.fromExclusive, R); assert.equal(first.throughSeq, plus(R, 256)); assert.equal(first.syncFrontierSeq, head);
  await r.query(peer); await r.query(peer); assert.equal(sent(r, peer), head);
  const large = await r.append(300);
  const whole = await r.runtime.sync(peer.handle, raw, { sentPrefixStart: head });
  assert.equal(whole.fromExclusive, head); assert.equal(whole.throughSeq, large, '首完整事务超过256时仍整批返回');
  assert.equal(whole.syncFrontierSeq, large); assert.equal(whole.events.at(-1).sessionSeq, large);
  await r.query(peer); assert.equal(sent(r, peer), large);
  const empty = await r.runtime.sync(peer.handle, raw, { sentPrefixStart: large });
  assert.equal(empty.fromExclusive, large); assert.equal(empty.throughSeq, large); assert.deepEqual(empty.events, []);
  const direct = await r.runtime.sync(peer.handle, raw);
  assert.equal(direct.fromExclusive, R, '没有内部参数的直接runtime入口仍按原请求重放');
  assert.equal(view.cursor, installed);

  const Q = await r.append(), entered = Promise.withResolvers(), release = Promise.withResolvers();
  r.runtime.hooks.afterCommit = async ({ command }) => { if (command === 'spatial-sync') { entered.resolve(); await release.promise; } };
  let reading;
  try {
    reading = r.runtime.sync(peer.handle, raw, { sentPrefixStart: large }); await entered.promise;
    const later = await r.append(); assert(BigInt(later) > BigInt(Q)); release.resolve();
    const fixed = await reading; assert.equal(fixed.fromExclusive, large); assert.equal(fixed.throughSeq, Q); assert.equal(fixed.syncFrontierSeq, Q);
  } finally { release.resolve(); await reading?.catch(() => {}); delete r.runtime.hooks.afterCommit; }
});

test('RRS-T09：混合房间仅完整能力handle采用竞态续读，旧reader仍按原请求读取', { timeout: 15000 }, async t => {
  const r = await room(t, { mixed: true }), peer = r.peers[0], oldPeer = r.peers[1];
  const view = r.runtime.connectionView(peer.handle), R = sent(r, peer), oldRaw = query(r, oldPeer, oldPeer.snapshot.snapshotSeq);
  const entered = Promise.withResolvers(), release = Promise.withResolvers(), sync = r.runtime.sync.bind(r.runtime);
  let gated = false, publishing, reply;
  r.runtime.sync = async (...args) => {
    const result = await sync(...args);
    if (args[0] === peer.handle && !gated) { gated = true; entered.resolve(); await release.promise; }
    return result;
  };
  try {
    const S = await r.append();
    publishing = r.runtime.spatialSupply.publish(view, S, (batch, binding) => r.deliver(binding.handle.connectionId, batch, binding));
    await entered.promise;
    const admitted = Promise.withResolvers(); peer.socket.once('sync.request', admitted.resolve);
    reply = r.rpc(peer, 'sync.request', query(r, peer, R)); reply.catch(() => {}); await admitted.promise;
    const B = await r.append(); release.resolve(); const ack = await reply; await publishing;
    assert.equal(ack.fromExclusive, S); assert.equal(ack.throughSeq, B); assert.equal(sent(r, peer), B);
    const legacy = await r.rpc(oldPeer, 'sync.request', oldRaw);
    assert.equal(legacy.fromExclusive, oldPeer.snapshot.snapshotSeq); assert.equal(legacy.throughSeq, B);
    assert.equal(r.runtime.spatialSupply.enabled(oldPeer.handle), false);
    await assert.rejects(r.runtime.sync(oldPeer.handle, oldRaw, { sentPrefixStart: oldPeer.snapshot.snapshotSeq }), { code: 'RESYNC_REQUIRED' });
  } finally { release.resolve(); await Promise.allSettled([publishing, reply].filter(Boolean)); r.runtime.sync = sync; }
});
