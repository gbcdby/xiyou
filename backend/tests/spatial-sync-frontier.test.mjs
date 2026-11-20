import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { AuthorityRuntime, createRuntime } from '../runtime.mjs';

const directionCaps = ['spatial-v2', 'spatial-direction-v1'];
const now = () => Date.parse('2026-11-15T00:00:00Z');
let database, pool, commitGate, syncTrace;
before(async () => {
  database = await startTestPostgres('sync-frontier', { outputSubdirectory: 'direction-server' });
  pool = { query: (...args) => database.pool.query(...args), connect: async () => {
    const client = await database.pool.connect(), trace = syncTrace;
    return new Proxy(client, { get(target, key) {
      if (key === 'query') return async (...args) => {
        trace?.queries.push(args[0]);
        const result = await client.query(...args);
        if (args[0] === 'COMMIT' && commitGate && !commitGate.claimed) {
          const gate = commitGate; gate.claimed = true; gate.enter(); await gate.released;
        }
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(args[0])) trace?.steps.push(args[0]);
        return result;
      };
      if (key === 'release') return (...args) => { trace?.steps.push('release'); return client.release(...args); };
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
const sync = (r, cursor, internal = {}) => r.runtime.sync(r.handles[0], JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId: r.sessionId, viewId: r.snapshots[0].viewId, cursor }), internal);
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

function observeEmptySync(r, { beforeFault = false } = {}) {
  const trace = { queries: [], stateAt: [], steps: [] }, runtime = r.runtime;
  const build = runtime.buildTransaction, stateAt = runtime.stateAt, persist = runtime.persist, hooks = runtime.hooks;
  syncTrace = trace;
  runtime.buildTransaction = function (...args) {
    const tx = build.apply(this, args);
    tx.afterCommit.push(() => trace.steps.push('effect'));
    tx.afterFinish.push(flags => trace.steps.push(['afterFinish', flags]));
    return tx;
  };
  runtime.stateAt = function (tx, throughSeq) {
    trace.stateAt.push(throughSeq); trace.steps.push('stateAt');
    return stateAt.call(this, tx, throughSeq);
  };
  runtime.persist = function (tx) { trace.steps.push('persist'); return persist.call(this, tx); };
  runtime.hooks = {
    beforeCommit() { trace.steps.push('beforeCommit'); if (beforeFault) throw new Error('空批提交前受控失败'); },
    afterCommit() { trace.steps.push('afterCommit'); },
  };
  return { trace, restore() {
    syncTrace = undefined; runtime.buildTransaction = build; runtime.stateAt = stateAt; runtime.persist = persist; runtime.hooks = hooks;
  } };
}
const boundaryReads = trace => trace.queries.filter(sql => sql.startsWith('SELECT through_seq FROM outbox'));

async function appendBoundaryEvents(r, count = 1) {
  return r.runtime.locked(r.sessionId, { kind: 'head-boundary-fixture' }, tx => {
    for (let i = 0; i < count; i++) tx.emit('spatial.clock', {
      sceneTimeMs: tx.state.sceneTimeMs, wallAnchorMs: tx.state.wallAnchorMs, paused: tx.state.paused,
    });
    return tx.state.sessionSeq;
  });
}

test('锁内授权：共享读与原两语句结果等值，默认只读收据保留原路径', async t => {
  const r = await room(t, { caps: [...directionCaps, 'spatial-timed-trail-v1'] });
  assert.equal(r.runtime.spatialSupply.enabled(r.handles[0]), true);
  const from = (await persisted(r)).session_seq, head = await appendBoundaryEvents(r), before = await persisted(r);
  const access = r.runtime.access, authenticate = r.runtime.authenticate;
  const authCalls = [];
  r.runtime.authenticate = function (...args) { authCalls.push(args[2]); return authenticate.apply(this, args); };
  try {
    for (const cursor of [head, from]) {
      let actual;
      const joined = observeEmptySync(r), count = authCalls.length;
      try {
        actual = await sync(r, cursor);
        assert.equal(authCalls.length, count + 1, '联合读取仍经过真实authenticate方法边界');
        assert.equal(authCalls.at(-1), r.sessionId);
        assert.ok(joined.trace.queries.some(sql => sql.endsWith('FOR SHARE')));
        assert.equal(joined.trace.queries.filter(sql => sql.includes('FROM runtime_users')).length, 1);
        assert.equal(joined.trace.queries.filter(sql => sql.includes('LEFT JOIN session_access')).length, 1);
        assert.equal(joined.trace.queries.filter(sql => sql.includes('FROM session_access')).length, 0);
      } finally { joined.restore(); }
      const original = observeEmptySync(r);
      r.runtime.access = function (client, row, token) { return access.call(this, client, row, token); };
      try {
        assert.deepEqual(await sync(r, cursor), actual, '原默认两语句授权仍给出同一完整空/非空Batch');
        assert.equal(original.trace.queries.filter(sql => sql.includes('FROM runtime_users')).length, 1);
        assert.equal(original.trace.queries.filter(sql => sql.includes('FROM session_access')).length, 1);
        assert.equal(original.trace.queries.some(sql => sql.includes('LEFT JOIN session_access')), false);
      } finally { r.runtime.access = access; original.restore(); }
    }
    const receipt = observeEmptySync(r);
    try {
      assert.equal(await r.runtime.receipt(r.users[0].token, r.sessionId, crypto.randomUUID()), null);
      assert.ok(receipt.trace.queries.includes('BEGIN READ ONLY'));
      assert.ok(receipt.trace.queries.includes('SELECT * FROM sessions WHERE session_id=$1'));
      assert.equal(receipt.trace.queries.some(sql => sql.includes('LEFT JOIN session_access')), false);
      assert.equal(receipt.trace.queries.filter(sql => sql.includes('FROM runtime_users')).length, 1);
      assert.equal(receipt.trace.queries.filter(sql => sql.includes('FROM session_access')).length, 1);
    } finally { receipt.restore(); }
  } finally { r.runtime.access = access; r.runtime.authenticate = authenticate; }
  assert.deepEqual(await persisted(r), before);
});

test('锁内授权：联合查询故障仍回滚，缺本局ACL先于内部参数拒绝', async t => {
  const r = await room(t, { caps: [...directionCaps, 'spatial-timed-trail-v1'] });
  const before = await persisted(r), oldPending = await pending(r), head = before.session_seq;
  const authenticate = r.runtime.authenticate, failure = new Error('联合授权查询受控失败'); let faults = 0;
  r.runtime.authenticate = function (token, client, ...options) {
    const faulted = new Proxy(client, { get(target, key) {
      if (key === 'query') return (sql, ...args) => {
        if (sql.includes('LEFT JOIN session_access')) { faults++; throw failure; }
        return target.query(sql, ...args);
      };
      return Reflect.get(target, key);
    } });
    return authenticate.call(this, token, faulted, ...options);
  };
  const failed = observeEmptySync(r);
  try {
    await assert.rejects(sync(r, head), error => error === failure);
    assert.equal(faults, 1); assert.deepEqual(failed.trace.stateAt, []);
    assert.deepEqual(failed.trace.steps, ['BEGIN', 'ROLLBACK', ['afterFinish', { committed: false, committing: false }], 'release']);
  } finally { failed.restore(); r.runtime.authenticate = authenticate; }
  assert.deepEqual(await persisted(r), before); assert.deepEqual(await pending(r), oldPending);
  await database.pool.query('DELETE FROM session_access WHERE session_id=$1 AND user_id=$2', [r.sessionId, r.users[0].userId]);
  const denied = observeEmptySync(r);
  try {
    await assert.rejects(sync(r, head, { sentPrefixStart: '不可信内部值' }), { code: 'FORBIDDEN' });
    assert.equal(denied.trace.queries.filter(sql => sql.includes('LEFT JOIN session_access')).length, 1);
    assert.deepEqual(denied.trace.stateAt, []);
    assert.deepEqual(denied.trace.steps, ['BEGIN', 'ROLLBACK', ['afterFinish', { committed: false, committing: false }], 'release']);
  } finally { denied.restore(); }
});

test('锁内授权：真实撤权等待当前共享读，后继读取必须拒绝', { timeout: 15000 }, async t => {
  const r = await room(t, { caps: [...directionCaps, 'spatial-timed-trail-v1'] }), head = (await persisted(r)).session_seq;
  const access = r.runtime.access, connect = pool.connect;
  const locked = Promise.withResolvers(), releaseRead = Promise.withResolvers(), writerBorrowed = Promise.withResolvers();
  let reading, revoking, intercepted = false, revoked = false;
  r.runtime.access = async function (...args) {
    if (!intercepted && args[3]?.sessionLock === 'share') {
      intercepted = true;
      const row = (await args[0].query('SELECT pg_backend_pid() AS pid')).rows[0];
      locked.resolve(row.pid); await releaseRead.promise;
    }
    return access.apply(this, args);
  };
  try {
    reading = sync(r, head); reading.catch(() => {}); const readerPid = await locked.promise;
    pool.connect = async (...args) => {
      const client = await connect(...args), row = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0];
      writerBorrowed.resolve(row.pid); return client;
    };
    revoking = r.runtime.revokeAccess(r.sessionId, r.users[0].userId).then(() => { revoked = true; }); revoking.catch(() => {});
    const writerPid = await writerBorrowed.promise; pool.connect = connect;
    let blocked = false; const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      blocked = (await database.pool.query('SELECT $1::integer = ANY(pg_blocking_pids($2::integer)) AS blocked', [readerPid, writerPid])).rows[0].blocked;
      if (blocked) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(blocked, true, '真实PG必须观察到撤权事务被当前共享读的Session行锁阻塞');
    assert.equal(revoked, false);
    releaseRead.resolve(); assert.equal((await reading).throughSeq, head); await revoking;
    await assert.rejects(sync(r, head), { code: 'FORBIDDEN' });
  } finally {
    releaseRead.resolve(); pool.connect = connect; r.runtime.access = access;
    await Promise.allSettled([reading, revoking].filter(Boolean));
  }
});

test('已提交头边界：三能力非空读取等于原SQL结果，显式上界与事务回滚保留', async t => {
  const r = await room(t, { caps: [...directionCaps, 'spatial-timed-trail-v1'] });
  assert.equal(r.runtime.connectionView(r.handles[0]).schemaVersion, 2);
  assert.equal(r.runtime.spatialSupply.enabled(r.handles[0]), true);
  const from = (await persisted(r)).session_seq, earlier = await appendBoundaryEvents(r), head = await appendBoundaryEvents(r, 2);
  await pool.query("UPDATE outbox SET status='Published' WHERE session_id=$1 AND through_seq=$2", [r.sessionId, head]);
  const oracle = (await pool.query('SELECT through_seq FROM outbox WHERE session_id=$1 AND through_seq>$2 AND through_seq<=$3 ORDER BY through_seq DESC LIMIT 1', [r.sessionId, from, head])).rows[0];
  assert.equal(oracle.through_seq, head, '原边界SQL仍选择已Published的当前完整事务头');
  const outbox = () => pool.query('SELECT from_exclusive,through_seq,status,attempts FROM outbox WHERE session_id=$1 ORDER BY through_seq', [r.sessionId]).then(result => result.rows);
  const eventCount = () => pool.query('SELECT count(*) AS count FROM world_events WHERE session_id=$1', [r.sessionId]).then(result => result.rows[0].count);
  const before = await persisted(r), oldOutbox = await outbox(), oldEvents = await eventCount();
  let actual;
  const fast = observeEmptySync(r);
  try {
    actual = await sync(r, from);
    assert.equal(actual.fromExclusive, from); assert.equal(actual.throughSeq, oracle.through_seq); assert.equal(actual.syncFrontierSeq, head);
    assert.equal(actual.events[0].sessionSeq, head);
    assert.deepEqual(boundaryReads(fast.trace), []);
    assert.equal(fast.trace.stateAt[0], head, '省去边界SQL仍调用原stateAt(head)');
    assert.ok(fast.trace.queries.some(sql => sql.endsWith('FOR SHARE')));
    assert.ok(fast.trace.queries.some(sql => sql.startsWith('SELECT event,event_text_encoding FROM world_events')), '本人轨迹仍读取原连续事件');
    assert.equal(fast.trace.queries.some(sql => /^(INSERT|UPDATE|DELETE)\b/.test(sql)), false);
    assert.deepEqual(fast.trace.steps.filter(step => step !== 'stateAt'), ['BEGIN', 'persist', 'beforeCommit', 'COMMIT', 'effect', 'afterCommit',
      ['afterFinish', { committed: true, committing: true }], 'release']);
  } finally { fast.restore(); }
  const bounded = observeEmptySync(r);
  try {
    assert.deepEqual(await sync(r, from, { throughSeqCeiling: head }), actual, '显式head上界走原SQL，完整Batch与快路等值');
    assert.equal(boundaryReads(bounded.trace).length, 1);
    const old = await sync(r, from, { throughSeqCeiling: String(BigInt(earlier) + 1n) });
    assert.equal(old.throughSeq, earlier, '事务中间的旧上界仍退到原完整提交边界');
    assert.equal(old.syncFrontierSeq, head); assert.equal(old.events[0].sessionSeq, earlier);
    assert.equal(boundaryReads(bounded.trace).length, 2);
    assert.ok(boundaryReads(bounded.trace).every(sql => sql.includes('DESC LIMIT 1')));
  } finally { bounded.restore(); }
  const failed = observeEmptySync(r, { beforeFault: true });
  try {
    await assert.rejects(sync(r, from), /空批提交前受控失败/);
    assert.deepEqual(boundaryReads(failed.trace), []);
    assert.equal(failed.trace.stateAt[0], head);
    assert.deepEqual(failed.trace.steps.filter(step => step !== 'stateAt'), ['BEGIN', 'persist', 'beforeCommit', 'ROLLBACK',
      ['afterFinish', { committed: false, committing: false }], 'release']);
  } finally { failed.restore(); }
  assert.deepEqual(await persisted(r), before); assert.deepEqual(await outbox(), oldOutbox); assert.equal(await eventCount(), oldEvents);
});

test('已提交头边界：三能力正差恰256仍选择当前完整事务头', async t => {
  const r = await room(t, { caps: [...directionCaps, 'spatial-timed-trail-v1'] });
  assert.equal(r.runtime.spatialSupply.enabled(r.handles[0]), true);
  const from = (await persisted(r)).session_seq, head = await appendBoundaryEvents(r, 256), before = await persisted(r);
  assert.equal(BigInt(head) - BigInt(from), 256n);
  const observed = observeEmptySync(r);
  try {
    const batch = await sync(r, from);
    assert.equal(batch.throughSeq, head); assert.equal(batch.syncFrontierSeq, head); assert.equal(batch.events[0].sessionSeq, head);
    assert.deepEqual(boundaryReads(observed.trace), []); assert.equal(observed.trace.stateAt[0], head);
  } finally { observed.restore(); }
  assert.deepEqual(await persisted(r), before);
});

test('已提交头边界：缺timed-trail能力的非空头读取仍走原边界SQL', async t => {
  const r = await room(t);
  assert.equal(r.runtime.spatialSupply.enabled(r.handles[0]), false);
  const from = (await persisted(r)).session_seq, head = await appendBoundaryEvents(r);
  const observed = observeEmptySync(r);
  try {
    const batch = await sync(r, from);
    assert.equal(batch.throughSeq, head); assert.equal(batch.syncFrontierSeq, head);
    assert.equal(boundaryReads(observed.trace).length, 1);
    assert.ok(boundaryReads(observed.trace)[0].includes('DESC LIMIT 1'));
    assert.ok(observed.trace.queries.some(sql => sql.endsWith('FOR UPDATE')));
  } finally { observed.restore(); }
});

test('空读取区间：同头空批省去边界SQL，仍保留提交与回滚生命周期', async t => {
  const r = await room(t, { caps: [...directionCaps, 'spatial-timed-trail-v1'] });
  const before = await persisted(r), oldPending = await pending(r), head = before.session_seq;
  const successful = observeEmptySync(r);
  try {
    assert.deepEqual(await sync(r, head), { schemaVersion: 2, type: 'world.batch', sessionId: r.sessionId,
      viewId: r.snapshots[0].viewId, fromExclusive: head, throughSeq: head, syncFrontierSeq: head, events: [] });
    assert.deepEqual(successful.trace.stateAt, [head]);
    assert.deepEqual(boundaryReads(successful.trace), []);
    assert.ok(successful.trace.queries.some(sql => sql.endsWith('FOR SHARE')), '同头仍取得原会话共享锁');
    assert.ok(successful.trace.queries.some(sql => sql.includes('FROM runtime_users')));
    assert.ok(successful.trace.queries.some(sql => sql.includes('LEFT JOIN session_access')));
    assert.equal(successful.trace.queries.some(sql => /^(INSERT|UPDATE|DELETE)\b/.test(sql)), false);
    assert.deepEqual(successful.trace.steps, ['BEGIN', 'stateAt', 'persist', 'beforeCommit', 'COMMIT', 'effect', 'afterCommit',
      ['afterFinish', { committed: true, committing: true }], 'release']);
  } finally { successful.restore(); }
  const failed = observeEmptySync(r, { beforeFault: true });
  try {
    await assert.rejects(sync(r, head), /空批提交前受控失败/);
    assert.deepEqual(failed.trace.stateAt, [head]);
    assert.deepEqual(boundaryReads(failed.trace), []);
    assert.deepEqual(failed.trace.steps, ['BEGIN', 'stateAt', 'persist', 'beforeCommit', 'ROLLBACK',
      ['afterFinish', { committed: false, committing: false }], 'release']);
  } finally { failed.restore(); }
  assert.deepEqual(await persisted(r), before);
  assert.deepEqual(await pending(r), oldPending);
});

test('空读取区间：旧上界等于起点仍读取真实历史，缺失前缀保持原失败', async t => {
  const r = await room(t, { caps: [...directionCaps, 'spatial-timed-trail-v1'] });
  // 独立writer使新前缀从未进入reader缓存；不能用暖缓存掩盖真实缺失。
  const writer = new AuthorityRuntime({ pool, now }); t.after(() => writer.close());
  const append = () => writer.locked(r.sessionId, { kind: 'empty-range-history-fixture' }, tx => {
    tx.emit('spatial.clock', { sceneTimeMs: tx.state.sceneTimeMs, wallAnchorMs: tx.state.wallAnchorMs, paused: tx.state.paused });
    return tx.state.sessionSeq;
  });
  const from = await append(), head = await append(), before = await persisted(r);
  const removed = (await database.pool.query('DELETE FROM world_events WHERE session_id=$1 AND session_seq=$2 RETURNING event,event_text_encoding', [r.sessionId, from])).rows[0];
  assert.ok(removed, '负例必须实际移除未缓存的目标事件');
  const observed = observeEmptySync(r);
  try {
    await assert.rejects(sync(r, from, { throughSeqCeiling: from }), error => error.code === 'RESYNC_REQUIRED' && error.message === '所需事件前缀当前不可用。');
    assert.deepEqual(observed.trace.stateAt, [from]);
    assert.deepEqual(boundaryReads(observed.trace), []);
    assert.ok(observed.trace.queries.some(sql => sql.startsWith('SELECT event,event_text_encoding FROM world_events')), '须实际查询缺失的PG历史');
    assert.deepEqual(observed.trace.steps, ['BEGIN', 'stateAt', 'ROLLBACK',
      ['afterFinish', { committed: false, committing: false }], 'release']);
  } finally {
    observed.restore();
    await database.pool.query('INSERT INTO world_events(session_id,session_seq,event,event_text_encoding) VALUES($1,$2,$3,$4)', [r.sessionId, from, removed.event, removed.event_text_encoding]);
  }
  assert.deepEqual(await sync(r, from, { throughSeqCeiling: from }), { schemaVersion: 2, type: 'world.batch', sessionId: r.sessionId,
    viewId: r.snapshots[0].viewId, fromExclusive: from, throughSeq: from, syncFrontierSeq: head, events: [] });
  assert.deepEqual(await persisted(r), before);
});

test('空读取区间：相等边界不能跳过原视图、安装下界、上界和读权守卫', async t => {
  const r = await room(t, { caps: [...directionCaps, 'spatial-timed-trail-v1'] }), head = (await persisted(r)).session_seq;
  const observed = observeEmptySync(r);
  try {
    await assert.rejects(r.runtime.sync(r.handles[0], JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId: r.sessionId, viewId: 'old-view', cursor: head })), { code: 'RESYNC_REQUIRED' });
    await assert.rejects(sync(r, '0', { throughSeqCeiling: '0' }), { code: 'RESYNC_REQUIRED' });
    await assert.rejects(sync(r, head, { throughSeqCeiling: String(BigInt(head) + 1n) }), { code: 'RESYNC_REQUIRED' });
    await assert.rejects(sync(r, head, { sentPrefixStart: head }), { code: 'RESYNC_REQUIRED' });
    await database.pool.query('UPDATE session_access SET active=false WHERE session_id=$1 AND user_id=$2', [r.sessionId, r.users[0].userId]);
    await assert.rejects(sync(r, head), { code: 'FORBIDDEN' });
    await database.pool.query('UPDATE runtime_users SET active=false WHERE user_id=$1', [r.users[0].userId]);
    await assert.rejects(sync(r, head), { code: 'UNAUTHENTICATED' });
    assert.deepEqual(observed.trace.stateAt, []);
    assert.deepEqual(boundaryReads(observed.trace), []);
    assert.equal(observed.trace.steps.filter(step => step === 'ROLLBACK').length, 6);
    assert.equal(observed.trace.steps.filter(step => step === 'release').length, 6);
  } finally { observed.restore(); }
});

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
