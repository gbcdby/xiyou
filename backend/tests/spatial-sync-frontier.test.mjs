import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { AuthorityRuntime, createRuntime } from '../runtime.mjs';

const directionCaps = ['spatial-v2', 'spatial-direction-v1'];
const now = () => Date.parse('2026-11-15T00:00:00Z');
let database, pool, commitGate;
before(async () => {
  database = await startTestPostgres('sync-frontier', { outputSubdirectory: 'direction-server' });
  pool = { query: (...args) => database.pool.query(...args), connect: async () => {
    const client = await database.pool.connect();
    return new Proxy(client, { get(target, key) {
      if (key === 'query') return async (...args) => {
        const result = await client.query(...args);
        if (args[0] === 'COMMIT' && commitGate && !commitGate.claimed) {
          const gate = commitGate; gate.claimed = true; gate.enter(); await gate.released;
        }
        return result;
      };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
  } };
  const setup = await createRuntime({ pool, now }); await setup.close();
});
after(async () => { commitGate?.release(); await database?.stop(); });

const controlRaw = snapshot => JSON.stringify({ schemaVersion: 2, type: 'control.take', sessionId: snapshot.sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce: crypto.randomUUID() });
async function room(t, { enabled = true, caps = directionCaps, legacy = false } = {}) {
  const runtime = new AuthorityRuntime({ pool, now, ...(enabled ? { spatialDirection: { checkpointMs: 50 } } : {}) });
  t.after(() => runtime.close());
  const users = [await runtime.guest({ name: '前缀玩家甲' }), await runtime.guest({ name: '前缀玩家乙' })];
  const actualCaps = legacy ? [] : caps;
  const { sessionId } = await runtime.create(users[0].token, { nonce: crypto.randomUUID(), contentVersion: legacy ? 'trust-repair-fixture-v1' : 'spatial-graybox-v2', capabilities: actualCaps });
  const handles = [], snapshots = [];
  if (!legacy) {
    await runtime.join(users[1].token, sessionId, { nonce: 'join', capabilities: actualCaps });
    await runtime.start(users[0].token, sessionId, { nonce: 'start' });
  }
  for (const user of legacy ? users.slice(0, 1) : users) {
    const handle = await runtime.openConnection(user.token, actualCaps), snapshot = await runtime.subscribe(handle, sessionId);
    const confirmed = legacy ? snapshot : (await runtime.control(handle, controlRaw(snapshot))).snapshot;
    handles.push(handle); snapshots.push(confirmed);
  }
  return { runtime, users, sessionId, handles, snapshots };
}
const sync = (r, cursor) => r.runtime.sync(r.handles[0], JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId: r.sessionId, viewId: r.snapshots[0].viewId, cursor }));
const persisted = async r => (await pool.query('SELECT session_seq,logical_time,state FROM sessions WHERE session_id=$1', [r.sessionId])).rows[0];
const pending = async r => (await pool.query("SELECT through_seq FROM outbox WHERE session_id=$1 AND status='Pending' ORDER BY through_seq", [r.sessionId])).rows;
function countSync(r) {
  const calls = [], original = r.runtime.sync.bind(r.runtime);
  r.runtime.sync = async (handle, raw) => { const request = JSON.parse(raw); calls.push({ connectionId: handle.connectionId, ...request }); return original(handle, raw); };
  return calls;
}
async function coveredButPending(r) {
  // 真实发送已完成，进度提交前失败；保留原 Pending 与各 installed view 的自身水位。
  const target = (await persisted(r)).session_seq;
  const covered = () => r.handles.every(handle => BigInt(r.runtime.connectionView(handle).cursor) >= BigInt(target));
  r.runtime.hooks.duringPublish = () => { if (covered()) throw new Error('受控进度提交前中断'); };
  try { await assert.rejects(r.runtime.publishPending(), /受控进度提交前中断/); }
  finally { delete r.runtime.hooks.duringPublish; }
  assert.ok(covered(), '夹具必须等两读者真正覆盖当前前缀后才中断进度');
  assert.ok((await pending(r)).length > 0);
}
async function speak(r, index = 0) {
  const s = r.snapshots[index];
  return r.runtime.submit(r.handles[index], JSON.stringify({ schemaVersion: 2, sessionId: r.sessionId, viewId: s.viewId, actorRef: s.projection.self.entityRef,
    controlEpoch: s.projection.self.controlEpoch, baseSeq: s.snapshotSeq, clientActionId: crypto.randomUUID(), action: { kind: 'speak', text: '前缀回归的公开事件', channel: 'public', recipientRefs: [] } }));
}

test('D66 v0.3：真实提交前缀保持整事务分页，frontier是同锁世界末尾且读取不推进时间', async t => {
  const r = await room(t), from = (await persisted(r)).session_seq;
  // 仅构造三个真实提交前缀，不改变逻辑时间或运动；覆盖through小于frontier的非平凡分页。
  for (let group = 0; group < 3; group++) await r.runtime.locked(r.sessionId, { kind: 'frontier-fixture' }, async tx => {
    for (let i = 0; i < 128; i++) tx.emit('spatial.clock', { sceneTimeMs: tx.state.sceneTimeMs, wallAnchorMs: tx.state.wallAnchorMs, paused: tx.state.paused });
  });
  const before = await persisted(r), batch = await sync(r, from);
  assert.equal(batch.fromExclusive, from); assert.equal(batch.throughSeq, String(BigInt(from) + 256n));
  assert.equal(batch.syncFrontierSeq, before.session_seq); assert.ok(BigInt(batch.throughSeq) < BigInt(batch.syncFrontierSeq));
  const empty = await sync(r, before.session_seq);
  assert.equal(empty.throughSeq, before.session_seq); assert.equal(empty.syncFrontierSeq, before.session_seq); assert.deepEqual(empty.events, []);
  assert.deepEqual(await persisted(r), before, 'sync不能追加事件或推进世界时间');
});

test('D66 v0.3：缺方向能力与默认关闭不输出frontier且保留旧发布路径，v1亦不优化', async t => {
  for (const options of [{ caps: ['spatial-v2'] }, { enabled: false, caps: ['spatial-v2'] }, { legacy: true }]) await t.test(JSON.stringify(options), async t => {
    const r = await room(t, options);
    if (!options.legacy) assert.equal(Object.hasOwn(await sync(r, r.snapshots[0].snapshotSeq), 'syncFrontierSeq'), false);
    await coveredButPending(r); const calls = countSync(r);
    await r.runtime.publishPending();
    assert.ok(calls.length > 0, '旧读者仍使用原同步流程'); assert.equal((await pending(r)).length, 0);
  });
});

test('D66 v0.3：同一installed视图覆盖旧通知后重试不再锁读，仍逐记录提交进度', async t => {
  const r = await room(t); await coveredButPending(r);
  const records = await pending(r), calls = countSync(r), marked = [];
  r.runtime.hooks.duringPublish = event => marked.push(event.throughSeq);
  const result = await r.runtime.publishPending();
  assert.equal(calls.length, 0, '已有本view覆盖不能被旧record再触发完整sync');
  assert.equal(result.published, records.length); assert.deepEqual(marked, records.map(row => row.through_seq));
  assert.equal((await pending(r)).length, 0);
});

test('D66 v0.3：发送失败不推进该读者水位，成功读者可跳过而失败读者必须续读', async t => {
  const r = await room(t); await r.runtime.publishPending(); assert.equal((await speak(r)).status, 'Accepted');
  const oldGuest = r.runtime.connectionView(r.handles[1]).cursor;
  await assert.rejects(r.runtime.publishPending(async connectionId => { if (connectionId === r.handles[1].connectionId) throw new Error('受控发送失败'); }), /受控发送失败/);
  assert.equal(r.runtime.connectionView(r.handles[1]).cursor, oldGuest);
  assert.ok(BigInt(r.runtime.connectionView(r.handles[0]).cursor) > BigInt(oldGuest));
  const calls = countSync(r), delivered = [];
  await r.runtime.publishPending(async connectionId => delivered.push(connectionId));
  assert.deepEqual(calls.map(call => call.connectionId), [r.handles[1].connectionId]);
  assert.deepEqual(delivered, [r.handles[1].connectionId]); assert.equal((await pending(r)).length, 0);
});

test('D66 v0.3：控制COMMIT回应未返回时保持Pending，新view不能借旧view覆盖后续事件', { timeout: 15000 }, async t => {
  const r = await room(t); await coveredButPending(r);
  let enter, release; const entered = new Promise(resolve => { enter = resolve; }), released = new Promise(resolve => { release = resolve; });
  commitGate = { enter, release, released, claimed: false };
  const controlling = r.runtime.control(r.handles[0], controlRaw(r.snapshots[0]));
  try {
    await entered; assert.equal(r.runtime.pendingViewInstallation(r.handles[0]), true);
    const records = (await pending(r)).length;
    await r.runtime.publishPending(); assert.equal((await pending(r)).length, records, '可安装新view未完成时不能标Published');
    assert.equal((await speak(r, 1)).status, 'Accepted');
    release(); const installed = await controlling; commitGate = null;
    assert.notEqual(installed.snapshot.viewId, r.snapshots[0].viewId);
    const calls = countSync(r), delivered = [];
    await r.runtime.publishPending(async (connectionId, batch) => delivered.push({ connectionId, batch }));
    assert.ok(calls.some(call => call.connectionId === r.handles[0].connectionId && call.viewId === installed.snapshot.viewId));
    assert.ok(delivered.some(value => value.connectionId === r.handles[0].connectionId && value.batch.viewId === installed.snapshot.viewId));
    assert.equal((await pending(r)).length, 0);
  } finally { release(); await controlling.catch(() => {}); commitGate = null; }
});
