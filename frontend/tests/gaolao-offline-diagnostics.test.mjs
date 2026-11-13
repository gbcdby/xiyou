import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { recordOfflineRecovery } from './gaolao-offline-diagnostics.mjs';

const row = (player, connection, overrides = {}) => ({
  user_id: `user-private-${player}`, actor_id: `actor-private-${player}`,
  phase: 'Running', paused: false, scene_time_ms: '123', session_seq: '90',
  mode: 'HumanControlled', control_epoch: '2', current_connection_id: `conn-private-${player}`,
  connection_id: connection, active: true, lease_remaining_ms: 59000, row_count: '3', ...overrides,
});

function fixture(rows = [row(0, 'conn-private-old'), row(0, 'conn-private-0'), row(1, 'conn-private-1')]) {
  const runtime = new EventEmitter(), calls = [];
  runtime.connection = handle => ({ userId: handle.owner, token: 'NEVER_LOG_TOKEN' });
  runtime.heartbeat = function (handle) { calls.push({ method: 'heartbeat', receiver: this, handle }); return Promise.resolve('heartbeat-result'); };
  runtime.disconnect = function (handle) { calls.push({ method: 'disconnect', receiver: this, handle }); return Promise.resolve('disconnect-result'); };
  const queries = [], pool = { query: async query => { queries.push(query); return { rows }; } };
  const room = {
    sessionId: 'session-private', users: [0, 1].map(i => ({ userId: `user-private-${i}`, token: 'NEVER_LOG_TOKEN' })),
    pages: [0, 1].map(i => ({ evaluate: async () => ({ connection: 'online', inputReady: true, snapshotPresent: true, sessionId: 'session-private', viewId: `view-private-${i}`, snapshotSeq: '90', phase: 'Running', paused: false, sceneTimeMs: 123, controlEpoch: '2', secret: 'NEVER_LOG_DIALOGUE' }) })),
  };
  return { runtime, pool, room, report: {}, calls, queries };
}

test('失联诊断原样传递原 Promise、this、参数和同步异常，并在收尾恢复方法与监听', async () => {
  const f = fixture(), handle = { connectionId: 'conn-private-1', owner: 'user-private-1' };
  let resolve; const pending = new Promise(done => { resolve = done; });
  const expected = new Error('原生产异常');
  f.runtime.heartbeat = function (value) { assert.equal(this, f.runtime); assert.equal(value, handle); return pending; };
  f.runtime.disconnect = function (value) { assert.equal(this, f.runtime); assert.equal(value, handle); throw expected; };
  const heartbeat = f.runtime.heartbeat, disconnect = f.runtime.disconnect;
  const sentinel = {}; const result = await recordOfflineRecovery(f, async trace => {
    trace.mark('offline-requested');
    assert.equal(f.runtime.heartbeat(handle), pending, '包装器不能替换生产 Promise');
    assert.throws(() => f.runtime.disconnect(handle), error => error === expected);
    resolve('原结果'); assert.equal(await pending, '原结果'); return sentinel;
  });
  assert.equal(result, sentinel);
  assert.equal(f.runtime.heartbeat, heartbeat); assert.equal(f.runtime.disconnect, disconnect);
  assert.equal(f.runtime.listenerCount('commit'), 0);
  assert.equal(f.report.offlineRecovery.outcome, 'PASS');
  assert.ok(f.report.offlineRecovery.events.some(e => e.kind === 'disconnect.throw'));
});

test('诊断读取失败不吞原验收 FAIL，末事件保留，异常文字和私密字段不入日志', async () => {
  const f = fixture(); const original = new Error('原 15000 ms 暂停断言失败');
  f.pool.query = async () => { throw new Error('postgres://NEVER_LOG_PASSWORD'); };
  for (const page of f.room.pages) page.evaluate = async () => { throw new Error('NEVER_LOG_DIALOGUE'); };
  const heartbeat = f.runtime.heartbeat, disconnect = f.runtime.disconnect;
  await assert.rejects(recordOfflineRecovery(f, async () => { throw original; }), error => error === original);
  const d = f.report.offlineRecovery;
  assert.equal(d.outcome, 'FAIL'); assert.ok(d.diagnosticErrors > 0);
  assert.ok(d.events.some(e => e.kind === 'assertion-failed'));
  assert.equal(d.events.at(-1).kind, 'diagnostic-stopped');
  assert.equal(f.runtime.heartbeat, heartbeat); assert.equal(f.runtime.disconnect, disconnect);
  assert.equal(f.runtime.listenerCount('commit'), 0);
  assert.doesNotMatch(JSON.stringify(d), /NEVER_LOG|postgres:|原 15000|user-private|session-private/);
});

test('只查询指定局两人，旧 active lease 单列且不当作当前控制者人数', async () => {
  const f = fixture([
    row(0, 'conn-private-old'), row(0, 'conn-private-0'),
    row(1, 'conn-private-1', { active: false, mode: 'GracePeriod', current_connection_id: null }),
  ]);
  await recordOfflineRecovery(f, async () => {});
  const d = f.report.offlineRecovery, s = d.baseline;
  assert.equal(s.database.connections.length, 3);
  assert.equal(s.database.derivedCurrentLiveHumanCount, 1);
  assert.equal(s.database.connections.filter(c => c.active && !c.isCurrentControl).length, 1);
  assert.ok(s.database.connections.some(c => c.player === 'P0' && !c.isCurrentControl));
  for (const q of f.queries) {
    assert.deepEqual(q.values, ['session-private', ['user-private-0', 'user-private-1']]);
    assert.match(q.text, /session_access/); assert.match(q.text, /LIMIT 33/);
    assert.equal(q.query_timeout, 1000);
  }
  assert.doesNotMatch(JSON.stringify(d), /private|NEVER_LOG/);
});

test('大量事件和连接行有硬上限并标截断，保留最后失败且不写其他局或剧情载荷', async () => {
  const f = fixture(Array.from({ length: 33 }, (_, i) => row(i % 2, `conn-private-${i}`, { row_count: '99', secret: 'NEVER_LOG_DIALOGUE' })));
  const failure = new Error('保留这一失败');
  await assert.rejects(recordOfflineRecovery(f, async () => {
    f.runtime.emit('commit', { sessionId: 'other-session', events: [{ kind: 'spatial.clock', sessionSeq: '999999', payload: { paused: false, sceneTimeMs: 999999 } }] });
    for (let i = 0; i < 600; i++) f.runtime.emit('commit', { sessionId: f.room.sessionId, events: [{ kind: 'spatial.clock', sessionSeq: String(i), payload: { paused: false, sceneTimeMs: i, secret: 'NEVER_LOG_DIALOGUE' } }] });
    throw failure;
  }), error => error === failure);
  const d = f.report.offlineRecovery;
  assert.equal(d.events.length, 256); assert.ok(d.droppedEvents > 0);
  assert.equal(d.baseline.database.connections.length, 32); assert.equal(d.baseline.database.truncated, true);
  assert.equal(d.baseline.database.derivedCurrentLiveHumanCount, null);
  assert.ok(d.events.some(e => e.kind === 'assertion-failed')); assert.equal(d.events.at(-1).kind, 'diagnostic-stopped');
  assert.doesNotMatch(JSON.stringify(d), /NEVER_LOG|999999|other-session|private/);
});

test('失败尾段看到自然断开与暂停也仍抛原错，固定起点与失败快照不会被普通事件挤掉', async t => {
  let now = 0; t.mock.method(performance, 'now', () => now);
  const rows = [row(0, 'conn-private-0'), row(1, 'conn-private-1')], f = fixture(rows);
  const failure = new Error('等待超时：两人中一人断线后暂停（15000 ms）');
  await assert.rejects(recordOfflineRecovery(f, async trace => {
    await trace.beginOffline(); now = 15010;
    await f.runtime.heartbeat({ connectionId: 'conn-private-1', owner: 'user-private-1' });
    await f.runtime.disconnect({ connectionId: 'conn-private-1', owner: 'user-private-1' });
    for (const value of rows) { value.paused = true; value.session_seq = '100'; }
    Object.assign(rows[1], { mode: 'GracePeriod', current_connection_id: null, active: false });
    for (const page of f.room.pages) page.evaluate = async () => ({ connection: 'online', inputReady: true, snapshotPresent: true, sessionId: f.room.sessionId, viewId: 'view-private-latest', snapshotSeq: '100', phase: 'Running', paused: true, sceneTimeMs: 123, controlEpoch: '2' });
    f.room.pages[1].evaluate = async () => ({ connection: 'offline', inputReady: false, snapshotPresent: false });
    await trace.observeAfterPauseFailure(failure);
    now = 16000;
    for (let i = 0; i < 600; i++) f.runtime.emit('commit', { sessionId: f.room.sessionId, events: [{ kind: 'spatial.clock', sessionSeq: String(i), payload: { paused: true, sceneTimeMs: 123 } }] });
    throw failure;
  }), error => error === failure);
  const d = f.report.offlineRecovery;
  assert.equal(d.outcome, 'FAIL'); assert.equal(d.originalAssertion.status, 'FAIL');
  assert.equal(d.originalAssertion.ms, 15010); assert.equal(d.originalAssertion.original15000msTimeout, true);
  assert.equal(d.failureTail.reason, 'natural-disconnect-and-pause-observed'); assert.equal(d.failureTail.acceptanceStatus, 'FAIL');
  assert.equal(d.baseline.database.paused, false); assert.equal(d.offlineBaseline.database.paused, false); assert.equal(d.offlineStart.ms, 0);
  assert.equal(d.firstTransitions.partnerDisconnect.ms, 15010); assert.ok(d.droppedEvents > 0);
  assert.equal(d.firstTransitions.partnerHeartbeatAttempt.ms, 15010);
  assert.equal(d.firstTransitions.partnerClientOffline.ms, 15010); assert.equal(d.firstTransitions.partnerClientOffline.snapshotPresent, false);
  assert.equal(d.firstTransitions.partnerLeaseNotLive.ms, 15010); assert.equal(d.firstTransitions.partnerLeaseNotLive.active, false);
  assert.equal(d.originalAssertion.observedAfterFailure.database.paused, true);
});

test('75 秒尾段预算耗尽后不再发起读取，仍保留原失败且不发动作', async t => {
  let now = 0; t.mock.method(performance, 'now', () => now);
  const f = fixture(), failure = new Error('原暂停超时'); let queryCount;
  await assert.rejects(recordOfflineRecovery(f, async trace => {
    await trace.beginOffline(); queryCount = f.queries.length; now = 75000;
    await trace.observeAfterPauseFailure(failure); throw failure;
  }), error => error === failure);
  assert.equal(f.report.offlineRecovery.failureTail.reason, '75s-deadline');
  assert.equal(f.report.offlineRecovery.failureTail.deadlineMs, 75000);
  assert.equal(f.queries.length, queryCount); assert.deepEqual(f.calls, []);
});

test('尾段中在线领队状态未知或离线时立即停止，不能把缺人暂停归因到伙伴', async t => {
  let now = 0; t.mock.method(performance, 'now', () => now);
  const f = fixture(), failure = new Error('原暂停超时');
  await assert.rejects(recordOfflineRecovery(f, async trace => {
    await trace.beginOffline(); now = 15000;
    f.room.pages[0].evaluate = async () => ({ connection: 'offline', inputReady: false, snapshotPresent: false });
    await trace.observeAfterPauseFailure(failure); throw failure;
  }), error => error === failure);
  assert.equal(f.report.offlineRecovery.failureTail.reason, 'unknown-or-leader-offline');
  assert.deepEqual(f.calls, []); assert.equal(f.report.offlineRecovery.outcome, 'FAIL');
});
