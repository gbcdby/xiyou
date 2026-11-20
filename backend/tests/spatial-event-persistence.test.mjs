import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createRuntime } from '../runtime.mjs';
import { encodeJsonbText, decodeJsonbText } from '../jsonb-text.mjs';
import { errorResponse } from '../errors.mjs';
import { isSpatial } from '../../game/spatial-world.mjs';

const capabilities = ['spatial-v2'];
let database, runtime, clock = Date.parse('2026-11-17T00:00:00Z');
let eventFault = null, loseCommit = false, insertSizes = [], traceSession = null, trace = [], beforeFault = false;
const eventInsert = sql => typeof sql === 'string' && sql.startsWith('INSERT INTO world_events(');
before(async () => {
  database = await startTestPostgres('spatial-event-batch', { outputSubdirectory: 'event-batch-tests' });
  const pool = {
    query: (...args) => database.pool.query(...args),
    connect: async () => {
      const client = await database.pool.connect();
      return new Proxy(client, { get(target, key) {
        if (key === 'query') return async (sql, values) => {
          if (eventInsert(sql)) {
            insertSizes.push(values.length / 4);
            if (eventFault) values = eventFault([...values]);
          }
          const result = await client.query(sql, values);
          if (sql === 'COMMIT' && loseCommit) { loseCommit = false; throw new Error('真实COMMIT后的受控响应丢失'); }
          return result;
        };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    },
  };
  runtime = await createRuntime({ pool, now: () => clock, hooks: {
    beforeCommit({ sessionId, command }) {
      if (sessionId !== traceSession) return;
      trace.push('before:' + command);
      if (beforeFault) throw new Error('原beforeCommit受控失败');
    },
    afterCommit({ sessionId, command }) { if (sessionId === traceSession) trace.push('after:' + command); },
  } });
  const build = runtime.buildTransaction.bind(runtime);
  runtime.buildTransaction = (...args) => {
    const tx = build(...args);
    if (tx.row.session_id === traceSession) {
      tx.afterCommit.push(() => trace.push('effect'));
      tx.afterFinish.push(flags => trace.push(['finish', flags]));
    }
    return tx;
  };
  runtime.on('commit', ({ sessionId }) => { if (sessionId === traceSession) trace.push('notice'); });
});
after(async () => { await runtime?.close(); await database?.stop(); });

async function createRoom(contentVersion = 'spatial-graybox-v2') {
  const user = await runtime.guest({ name: '批量事件玩家' }), nonce = crypto.randomUUID();
  const created = await runtime.create(user.token, { nonce, contentVersion, capabilities });
  return { ...created, user, nonce, contentVersion };
}
async function runningRoom() {
  const room = await createRoom(), other = await runtime.guest({ name: '批量事件同行者' });
  await runtime.join(other.token, room.sessionId, { nonce: crypto.randomUUID(), capabilities });
  await runtime.start(room.user.token, room.sessionId, { nonce: crypto.randomUUID() });
  const handles = [];
  for (const user of [room.user, other]) {
    const handle = await runtime.openConnection(user.token, capabilities), snapshot = await runtime.subscribe(handle, room.sessionId);
    await runtime.control(handle, JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId: room.sessionId,
      viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce: crypto.randomUUID() }));
    handles.push(handle);
  }
  return { ...room, handle: handles[0], snapshot: await runtime.snapshot(room.user.token, room.sessionId, capabilities) };
}
const speech = (room, id = crypto.randomUUID()) => JSON.stringify({ schemaVersion: 2, sessionId: room.sessionId,
  viewId: room.snapshot.viewId, actorRef: room.snapshot.projection.self.entityRef, controlEpoch: room.snapshot.projection.self.controlEpoch,
  baseSeq: room.snapshot.snapshotSeq, clientActionId: id, action: { kind: 'speak', text: '原事务中的实际陈述', channel: 'public', recipientRefs: [] } });
async function image(client, sessionId) {
  const session = (await client.query('SELECT state,state_text_encoding,session_seq,logical_time FROM sessions WHERE session_id=$1', [sessionId])).rows;
  const events = (await client.query('SELECT session_seq,event,event_text_encoding FROM world_events WHERE session_id=$1 ORDER BY session_seq', [sessionId])).rows;
  const outbox = (await client.query('SELECT from_exclusive,through_seq,status,attempts FROM outbox WHERE session_id=$1 ORDER BY through_seq', [sessionId])).rows;
  const receipts = (await client.query('SELECT principal_id,client_action_id,receipt FROM action_receipts WHERE session_id=$1 ORDER BY principal_id,client_action_id', [sessionId])).rows;
  return { session, events, outbox, receipts };
}
function clocks(tx, count) {
  for (let i = 0; i < count; i++) tx.emit('spatial.clock', { sceneTimeMs: i, wallAnchorMs: clock + i, paused: true });
}

// 固定f560原逐条方法作存储等值对照，不作性能测量，也不替代原自然验收。
async function originalPersist(tx) {
  if (tx.events.length) {
    for (const event of tx.events) {
      const stored = isSpatial(tx.state) ? encodeJsonbText(event) : { value: event, encoding: null };
      await tx.client.query('INSERT INTO world_events(session_id,session_seq,event,event_text_encoding) VALUES($1,$2,$3,$4)', [tx.row.session_id, event.sessionSeq, stored.value, stored.encoding]);
    }
    await tx.client.query('INSERT INTO outbox(session_id,from_exclusive,through_seq) VALUES($1,$2,$3)', [tx.row.session_id, tx.row.state.sessionSeq, tx.state.sessionSeq]);
  }
  if (tx.events.length || tx.clockTouched) {
    const stored = isSpatial(tx.state) ? encodeJsonbText(tx.state) : { value: tx.state, encoding: null };
    await tx.client.query('UPDATE sessions SET state=$2, session_seq=$3, logical_time=$4, state_text_encoding=$5 WHERE session_id=$1', [tx.row.session_id, stored.value, tx.state.sessionSeq, tx.time, stored.encoding]);
  }
}
async function persistImage(method, fixture) {
  const client = await runtime.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT session_id FROM sessions WHERE session_id=$1 FOR UPDATE', [fixture.row.session_id]);
    insertSizes = [];
    await method.call(runtime, { ...structuredClone(fixture), client });
    return { image: await image(client, fixture.row.session_id), sizes: [...insertSizes] };
  } finally { await client.query('ROLLBACK'); client.release(); }
}

test('批量持久化：相同输入与原逐条结果相等，257事件和逐行文本编码完整保留', async () => {
  const room = await createRoom(), initial = await image(database.pool, room.sessionId);
  for (const count of [0, 1, 257]) {
    const abort = new Error('只构造固定事务输入，原数据库保持不变'); let fixture;
    await assert.rejects(runtime.locked(room.sessionId, { kind: 'event-storage-fixture' }, async tx => {
      clocks(tx, count);
      if (count > 1) {
        // 仅存储边界夹具：附带键和值验证JSONB编码，不宣称它是公开游戏动作。
        tx.events[1].payload.storageFixture = { ['零\u0000键']: 'NUL\u0000、字面\\0、\\u0000、反斜杠\\\\、e\u0301、😀𠮷' };
      }
      fixture = structuredClone({ row: tx.row, state: tx.state, events: tx.events, clockTouched: tx.clockTouched, time: tx.time });
      throw abort;
    }), error => error === abort);
    const expected = await persistImage(originalPersist, fixture), actual = await persistImage(runtime.persist, fixture);
    assert.deepEqual(actual.image, expected.image);
    const added = actual.image.events.filter(row => BigInt(row.session_seq) > BigInt(fixture.row.state.sessionSeq));
    assert.equal(added.length, count);
    assert.deepEqual(added.map(row => decodeJsonbText(row.event, row.event_text_encoding)), fixture.events);
    if (count > 1) {
      assert.ok(actual.sizes.some(size => size > 1), '真实PG实际经过多事件语句');
      assert.ok(actual.sizes.every(size => size <= 256), '每批有界，不能越过约定参数预算');
      assert.equal(actual.sizes.reduce((sum, size) => sum + size, 0), count);
      assert.equal(added[0].event_text_encoding, null); assert.equal(added[1].event_text_encoding, 'nul-escaped-v1');
      assert.equal(added.at(-1).event_text_encoding, null);
    } else assert.deepEqual(actual.sizes, expected.sizes);
  }
  assert.deepEqual(await image(database.pool, room.sessionId), initial, '两个存储对照均已回滚，不改真实基线');
});

test('批量持久化：空间创建与原nonce重试完整，region保持逐条，创建失败无残留', async () => {
  const user = await runtime.guest({ name: '创建原子性玩家' }), nonce = crypto.randomUUID();
  insertSizes = [];
  const created = await runtime.create(user.token, { nonce, contentVersion: 'spatial-graybox-v2', capabilities });
  assert.ok(insertSizes.some(size => size > 1), '真实空间create的两事件进入批量路径');
  const stored = await image(database.pool, created.sessionId);
  assert.equal(stored.events.length, 2); assert.equal(stored.outbox.length, 1); assert.equal(stored.session[0].session_seq, '2');
  assert.deepEqual(await runtime.create(user.token, { nonce, contentVersion: 'spatial-graybox-v2', capabilities }), created);
  assert.deepEqual(await image(database.pool, created.sessionId), stored);
  insertSizes = [];
  const legacy = await createRoom('trust-repair-fixture-v1');
  assert.ok(insertSizes.length > 1 && insertSizes.every(size => size === 1));
  assert.deepEqual(await runtime.replay(legacy.sessionId), (await image(database.pool, legacy.sessionId)).session[0].state);
  const failedNonce = crypto.randomUUID(); let failedSession;
  eventFault = values => { eventFault = null; failedSession = values[0]; values[1] = '0'; return values; };
  try {
    await assert.rejects(runtime.create(user.token, { nonce: failedNonce, contentVersion: 'spatial-graybox-v2', capabilities }), error => error.code === '23514' && errorResponse(error).code === 'OUTCOME_UNKNOWN');
  } finally { eventFault = null; }
  assert.ok(failedSession);
  for (const table of ['sessions', 'session_access', 'world_events', 'outbox']) {
    assert.equal((await database.pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE session_id=$1`, [failedSession])).rows[0].count, 0);
  }
  assert.equal((await database.pool.query('SELECT count(*)::int AS count FROM creation_nonces WHERE user_id=$1 AND nonce=$2', [user.userId, failedNonce])).rows[0].count, 0);
});

test('批量持久化：真实PK、FK与CHECK失败回滚原动作Receipt和全部世界事实', async t => {
  const room = await runningRoom();
  for (const [label, code, alter] of [
    ['PK', '23505', values => { values[1] = '1'; }],
    ['FK', '23503', values => { values[0] = 'missing-event-batch-session'; }],
    ['CHECK', '23514', values => { values[1] = '0'; }],
  ]) await t.test(label, async () => {
    const previous = await image(database.pool, room.sessionId), raw = speech(room);
    traceSession = room.sessionId; trace = []; clock += 50; insertSizes = [];
    eventFault = values => { eventFault = null; alter(values); return values; };
    try {
      await assert.rejects(runtime.submit(room.handle, raw), error => error.code === code && errorResponse(error).code === 'OUTCOME_UNKNOWN');
      assert.ok(insertSizes.some(size => size > 1));
      assert.deepEqual(trace, [['finish', { committed: false, committing: false }]]);
      assert.deepEqual(await image(database.pool, room.sessionId), previous);
      assert.equal(await runtime.receipt(room.user.token, room.sessionId, JSON.parse(raw).clientActionId), null);
    } finally { eventFault = null; traceSession = null; }
  });
});

test('批量持久化：257条的后块失败回滚先块，beforeCommit故障仍无部分提交', async () => {
  const room = await createRoom(), previous = await image(database.pool, room.sessionId);
  const last = String(BigInt(previous.session[0].session_seq) + 257n);
  traceSession = room.sessionId; trace = [];
  eventFault = values => {
    for (let i = 1; i < values.length; i += 4) if (values[i] === last) { values[i] = '1'; eventFault = null; }
    return values;
  };
  try {
    await assert.rejects(runtime.locked(room.sessionId, { kind: 'late-event-fault' }, async tx => clocks(tx, 257)), { code: '23505' });
    assert.deepEqual(trace, [['finish', { committed: false, committing: false }]]);
    assert.deepEqual(await image(database.pool, room.sessionId), previous);
    trace = []; beforeFault = true;
    await assert.rejects(runtime.locked(room.sessionId, { kind: 'before-commit-fault' }, async tx => clocks(tx, 2)), /原beforeCommit受控失败/);
    assert.deepEqual(trace, ['before:before-commit-fault', ['finish', { committed: false, committing: false }]]);
    assert.deepEqual(await image(database.pool, room.sessionId), previous);
    beforeFault = false; trace = [];
    await runtime.locked(room.sessionId, { kind: 'successful-events' }, async tx => clocks(tx, 2));
    assert.deepEqual(trace, ['before:successful-events', 'effect', 'after:successful-events', 'notice', ['finish', { committed: true, committing: true }]]);
    assert.deepEqual(await runtime.replay(room.sessionId), (await image(database.pool, room.sessionId)).session[0].state);
  } finally { eventFault = null; beforeFault = false; traceSession = null; }
});

test('批量持久化：真实动作COMMIT后丢响应仍返回原Receipt，重发不重做', async () => {
  const room = await runningRoom(), raw = speech(room), request = JSON.parse(raw);
  clock += 50; insertSizes = []; traceSession = room.sessionId; trace = []; loseCommit = true;
  try {
    const receipt = await runtime.submit(room.handle, raw);
    assert.equal(receipt.status, 'Accepted'); assert.equal(loseCommit, false);
    assert.ok(insertSizes.some(size => size > 1));
    assert.deepEqual(trace.filter(value => Array.isArray(value)), [
      ['finish', { committed: false, committing: true }],
      ['finish', { committed: true, committing: true }],
    ]);
    traceSession = null;
    const committed = await image(database.pool, room.sessionId);
    assert.deepEqual(await runtime.receipt(room.user.token, room.sessionId, request.clientActionId), receipt);
    assert.deepEqual(await runtime.submit(room.handle, raw), receipt);
    assert.deepEqual(await image(database.pool, room.sessionId), committed);
    assert.deepEqual(await runtime.replay(room.sessionId), decodeJsonbText(committed.session[0].state, committed.session[0].state_text_encoding));
  } finally { loseCommit = false; traceSession = null; }
});
