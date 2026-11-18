import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { AuthorityRuntime, createRuntime } from '../runtime.mjs';
import { decodeJsonbText } from '../jsonb-text.mjs';
import { committedPublisher } from '../spatial-direction-runtime.mjs';
import { executeSpatial } from '../spatial-runtime.mjs';

const capabilities = ['spatial-v2', 'spatial-direction-v1', 'spatial-scene-overview-v1'];
const timedCapabilities = [...capabilities, 'spatial-timed-trail-v1'];
let database, runtime, clock = Date.parse('2026-11-15T00:00:00Z');
before(async () => {
  database = await startTestPostgres('direction-authority', { outputSubdirectory: 'direction-server' });
  runtime = await createRuntime({ pool: database.pool, now: () => clock, spatialDirection: { checkpointMs: 50 } });
});
after(async () => { await runtime?.close(); await database?.stop(); });
async function room(caps = capabilities) {
  const users = [await runtime.guest({ name: '方向玩家甲' }), await runtime.guest({ name: '方向玩家乙' })];
  const { sessionId } = await runtime.create(users[0].token, { nonce: crypto.randomUUID(), contentVersion: 'spatial-graybox-v2', capabilities: caps });
  await runtime.join(users[1].token, sessionId, { nonce: 'join', capabilities: caps });
  await runtime.start(users[0].token, sessionId, { nonce: 'start' });
  const handles = [];
  for (const user of users) {
    const handle = await runtime.openConnection(user.token, caps), snapshot = await runtime.subscribe(handle, sessionId);
    await runtime.control(handle, JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce: crypto.randomUUID() }));
    handles.push(handle);
  }
  const snapshot = await runtime.snapshot(users[0].token, sessionId, caps);
  assert.equal(snapshot.projection.paused, false);
  await runtime.publishPending();
  return { users, sessionId, handles, snapshot };
}
const request = (r, action) => JSON.stringify({ schemaVersion: 2, sessionId: r.sessionId, viewId: r.snapshot.viewId, actorRef: r.snapshot.projection.self.entityRef, controlEpoch: r.snapshot.projection.self.controlEpoch, baseSeq: r.snapshot.snapshotSeq, clientActionId: crypto.randomUUID(), action });
const direction = (r, seq, facing) => ({ kind: 'move_direction', movementCommandSeq: String(seq), sceneId: r.snapshot.projection.self.sceneId, mapVersion: r.snapshot.projection.mapVersion, direction: facing });
const submit = (r, action) => runtime.submit(r.handles[0], request(r, action));
async function state(r) {
  const row = (await database.pool.query('SELECT state,state_text_encoding FROM sessions WHERE session_id=$1', [r.sessionId])).rows[0];
  return decodeJsonbText(row.state, row.state_text_encoding);
}
const own = s => s.characters[s.members[0].characterId];
const sync = (r, cursor) => runtime.sync(r.handles[0], JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId: r.sessionId, viewId: r.snapshot.viewId, cursor }));

// 只观察真实事务与方法边界；不记录令牌/SQL参数，不替换授权或动作实现。
function observeSubmission({ joinedFault } = {}) {
  const pool = runtime.pool, access = runtime.access, authenticate = runtime.authenticate, build = runtime.buildTransaction;
  const trace = { order: [], queries: [], contexts: [], authentication: [], finished: [], releases: 0 };
  const query = target => (sql, ...args) => {
    trace.queries.push(sql); trace.order.push(sql);
    if (joinedFault && sql.includes('LEFT JOIN session_access')) throw joinedFault;
    return target.query(sql, ...args);
  };
  runtime.pool = { query: query(pool), connect: async () => {
    const client = await pool.connect();
    return new Proxy(client, { get(target, key) {
      if (key === 'query') return query(target);
      if (key === 'release') return (...args) => { trace.releases++; return target.release(...args); };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
  } };
  runtime.access = function (...args) {
    trace.contexts.push(args[3]?.sessionLock); trace.order.push('access');
    return access.apply(this, args);
  };
  runtime.authenticate = function (...args) {
    trace.authentication.push({ inTransaction: args[1] !== undefined, sessionId: args[2] });
    trace.order.push(args[1] === undefined ? '锁前认证' : '锁后认证');
    return authenticate.apply(this, args);
  };
  runtime.buildTransaction = function (...args) {
    const tx = build.apply(this, args); tx.afterFinish.push(flags => trace.finished.push(flags)); return tx;
  };
  return { trace, restore() { runtime.pool = pool; runtime.access = access; runtime.authenticate = authenticate; runtime.buildTransaction = build; } };
}
function assertActionAuthorization(trace, r, joined) {
  assert.deepEqual(trace.contexts, [joined ? 'update' : undefined]);
  assert.deepEqual(trace.authentication, [{ inTransaction: false, sessionId: undefined }, { inTransaction: true, sessionId: joined ? r.sessionId : undefined }]);
  const lock = trace.order.indexOf('SELECT * FROM sessions WHERE session_id=$1 FOR UPDATE');
  assert.ok(trace.order.indexOf('锁前认证') < trace.order.indexOf('BEGIN'));
  assert.ok(trace.order.indexOf('BEGIN') < lock && lock < trace.order.indexOf('access'));
  assert.ok(trace.order.indexOf('access') < trace.order.indexOf('锁后认证'));
  assert.equal(trace.queries.filter(sql => sql.includes('FROM runtime_users')).length, 2);
  assert.equal(trace.queries.filter(sql => sql.includes('LEFT JOIN session_access')).length, joined ? 1 : 0);
  assert.equal(trace.queries.filter(sql => sql.includes('FROM session_access')).length, joined ? 0 : 1);
}
async function persistedActionState(r) {
  const read = sql => database.pool.query(sql, [r.sessionId]).then(result => result.rows);
  return { session: await read('SELECT state,state_text_encoding,session_seq,logical_time FROM sessions WHERE session_id=$1'),
    events: await read('SELECT * FROM world_events WHERE session_id=$1 ORDER BY session_seq'),
    receipts: await read('SELECT * FROM action_receipts WHERE session_id=$1 ORDER BY principal_id,client_action_id'),
    sources: await read('SELECT * FROM spatial_command_sources WHERE session_id=$1 ORDER BY actor_id,control_epoch'),
    outbox: await read('SELECT * FROM outbox WHERE session_id=$1 ORDER BY through_seq') };
}
async function bounded(promise, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 3000); })]); }
  finally { clearTimeout(timer); }
}

test('方向锁内授权：三能力命中，旧两能力和其他动作保持默认查询', async () => {
  for (const caps of [capabilities, timedCapabilities]) {
    const r = await room(caps), joined = caps.includes('spatial-timed-trail-v1');
    for (const action of [direction(r, 1, 'E'), { kind: 'stop_move', movementCommandSeq: '2' }, { kind: 'move_to', movementCommandSeq: '3', sceneId: 'gray-yard', destination: { x: 180, y: 100 } }]) {
      const observed = observeSubmission();
      try {
        assert.equal((await submit(r, action)).status, 'Accepted');
        assertActionAuthorization(observed.trace, r, joined && action.kind !== 'move_to');
        assert.equal(observed.trace.queries.filter(sql => sql.startsWith('SELECT handled_seq FROM spatial_command_sources')).length, action.kind === 'move_direction' ? 0 : 1);
        assert.equal(observed.trace.queries.filter(sql => sql.startsWith('INSERT INTO spatial_command_sources')).length, 1);
      } finally { observed.restore(); }
    }
  }
});

test('公开方向水位：正序号、大整数、相等回退、issued保留与新epoch原Receipt', async () => {
  const r = await room(timedCapabilities), actorId = own(await state(r)).characterId;
  const epoch = r.snapshot.projection.self.controlEpoch;
  const sources = async () => (await database.pool.query('SELECT control_epoch,issued_seq,handled_seq FROM spatial_command_sources WHERE session_id=$1 AND actor_id=$2 ORDER BY control_epoch', [r.sessionId, actorId])).rows;
  assert.deepEqual(await sources(), []);
  const original = request(r, direction(r, 1, 'E'));
  const accepted = await runtime.submit(r.handles[0], original);
  assert.equal(accepted.status, 'Accepted');
  assert.deepEqual(await sources(), [{ control_epoch: epoch, issued_seq: '0', handled_seq: '1' }]);
  const issued = '9007199254741009', larger = '9007199254740993';
  await database.pool.query('UPDATE spatial_command_sources SET issued_seq=$4 WHERE session_id=$1 AND actor_id=$2 AND control_epoch=$3', [r.sessionId, actorId, epoch, issued]);
  assert.equal((await submit(r, direction(r, larger, 'S'))).status, 'Accepted');
  const advanced = [{ control_epoch: epoch, issued_seq: issued, handled_seq: larger }];
  assert.deepEqual(await sources(), advanced, '方向处理不能覆盖已有issued_seq，也不能把大序号转成Number');
  for (const action of [direction(r, larger, 'W'), direction(r, 2, 'W'), { ...direction(r, larger, 'N'), mapVersion: 'stale-map' }]) {
    assert.equal((await submit(r, action)).code, 'STALE_MOVEMENT_COMMAND');
    assert.deepEqual(await sources(), advanced, '相等/回退拒绝不能改变任一水位');
  }
  const taken = await runtime.control(r.handles[0], JSON.stringify({ schemaVersion: 2, type: 'control.take', sessionId: r.sessionId,
    viewId: r.snapshot.viewId, actorRef: r.snapshot.projection.self.entityRef, nonce: crypto.randomUUID() }));
  assert.ok(BigInt(taken.controlEpoch) > BigInt(epoch));
  r.snapshot = taken.snapshot;
  assert.equal((await submit(r, direction(r, 1, 'E'))).status, 'Accepted');
  const afterTake = [...advanced, { control_epoch: taken.controlEpoch, issued_seq: '0', handled_seq: '1' }];
  assert.deepEqual(await sources(), afterTake, '新epoch独立从1开始，旧epoch的两项水位保留');
  const replayed = observeSubmission();
  try {
    assert.deepEqual(await runtime.submit(r.handles[0], original), accepted);
    assert.equal(replayed.trace.queries.some(sql => sql.includes('spatial_command_sources')), false, '原Receipt先返回，不重新检查或写入当前epoch水位');
  } finally { replayed.restore(); }
  assert.deepEqual(await sources(), afterTake);
});

test('公开方向入口资格：未带内部开关的直接调用保留原查询与validate', async () => {
  const r = await room(timedCapabilities), envelope = JSON.parse(request(r, direction(r, 1, 'E')));
  const observed = observeSubmission(); let validations = 0;
  try {
    const receipt = await runtime.locked(r.sessionId, { kind: 'direction-entry-qualification' }, async tx => {
      const user = await runtime.access(tx.client, tx.row, r.users[0].token, { sessionLock: 'update' });
      return executeSpatial(runtime, tx, envelope, { ...user, principalKind: 'human' },
        async actor => actor.mode === 'HumanControlled' && actor.activeConnectionId === r.handles[0].connectionId && await runtime.liveConnection(tx, r.handles[0]),
        { validate: () => { validations++; } });
    });
    assert.equal(receipt.status, 'Accepted'); assert.equal(validations, 1);
    assert.equal(observed.trace.queries.filter(sql => sql.startsWith('SELECT handled_seq FROM spatial_command_sources')).length, 1);
    assert.equal(observed.trace.queries.filter(sql => sql.startsWith('INSERT INTO spatial_command_sources')).length, 1);
  } finally { observed.restore(); }
});

test('方向锁内授权：原Receipt、停止围栏、领域拒绝水位与控制授权保留', async () => {
  const r = await room(timedCapabilities), raw = request(r, direction(r, 1, 'E'));
  const accepted = await runtime.submit(r.handles[0], raw); assert.equal(accepted.status, 'Accepted');
  assert.equal((await submit(r, { ...direction(r, 3, 'S'), mapVersion: 'stale-map' })).code, 'STALE_REFERENCE');
  assert.equal(own(await state(r)).movement.movementCommandSeq, '1');
  assert.equal((await submit(r, direction(r, 2, 'W'))).code, 'STALE_MOVEMENT_COMMAND');
  assert.equal((await submit(r, { kind: 'stop_move', movementCommandSeq: '4' })).status, 'Accepted');
  const stopped = await persistedActionState(r); clock += 100;
  const original = observeSubmission(), access = runtime.access;
  runtime.access = function (client, row, token) { return access.call(this, client, row, token); };
  try { assert.deepEqual(await runtime.submit(r.handles[0], raw), accepted); assertActionAuthorization(original.trace, r, false); }
  finally { original.restore(); }
  const joined = observeSubmission();
  try { assert.deepEqual(await runtime.submit(r.handles[0], raw), accepted); assertActionAuthorization(joined.trace, r, true); }
  finally { joined.restore(); }
  assert.deepEqual(await persistedActionState(r), stopped, '两种授权路径均恢复同一原方向结果，不复活停止后的路线');
  const reused = JSON.parse(raw); reused.action.direction = 'S';
  await assert.rejects(runtime.submit(r.handles[0], JSON.stringify(reused)), { code: 'ACTION_ID_REUSE' });
  const stale = JSON.parse(request(r, direction(r, 5, 'S'))); stale.controlEpoch = String(BigInt(stale.controlEpoch) - 1n);
  assert.equal((await runtime.submit(r.handles[0], JSON.stringify(stale))).code, 'STALE_CONTROL');
  assert.deepEqual((await persistedActionState(r)).sources, stopped.sources, '旧控制来源不能消费移动命令水位');
  await database.pool.query('UPDATE connections SET active=false WHERE connection_id=$1', [r.handles[0].connectionId]);
  const inactive = observeSubmission();
  try {
    assert.equal((await submit(r, direction(r, 5, 'S'))).code, 'STALE_CONTROL');
    assert.ok(inactive.trace.queries.some(sql => sql.startsWith('SELECT 1 FROM connections')), '保留真实liveConnection读取，不能借前面的lease结果');
    assert.deepEqual((await persistedActionState(r)).sources, stopped.sources);
  } finally { inactive.restore(); await database.pool.query('UPDATE connections SET active=true WHERE connection_id=$1', [r.handles[0].connectionId]); }
  assert.deepEqual(await runtime.replay(r.sessionId), await state(r));
});

test('方向锁内授权：锁前认证后仍新读停用用户、缺失ACL和先提交的真实撤权', { timeout: 30000 }, async t => {
  for (const scenario of [
    { name: '锁前认证后停用用户', code: 'UNAUTHENTICATED', mutate: r => database.pool.query('UPDATE runtime_users SET active=false WHERE user_id=$1', [r.users[0].userId]) },
    { name: '锁前认证后缺失本局ACL', code: 'FORBIDDEN', mutate: r => database.pool.query('DELETE FROM session_access WHERE session_id=$1 AND user_id=$2', [r.sessionId, r.users[0].userId]) },
    { name: '锁前认证后真实撤权先提交', code: 'FORBIDDEN', mutate: r => runtime.revokeAccess(r.sessionId, r.users[0].userId) },
  ]) await t.test(scenario.name, async () => {
    const r = await room(timedCapabilities), raw = request(r, { kind: 'stop_move', movementCommandSeq: '1' });
    const authenticate = runtime.authenticate, entered = Promise.withResolvers(), release = Promise.withResolvers();
    let intercepted = false, pending, observed;
    runtime.authenticate = async function (...args) {
      const user = await authenticate.apply(this, args);
      if (!intercepted && args[1] === undefined) { intercepted = true; entered.resolve(); await release.promise; }
      return user;
    };
    try {
      pending = runtime.submit(r.handles[0], raw); pending.catch(() => {});
      await bounded(entered.promise, '必须先完成真实锁前认证');
      await scenario.mutate(r); const before = await persistedActionState(r);
      observed = observeSubmission(); release.resolve();
      await assert.rejects(pending, { code: scenario.code });
      assert.deepEqual(observed.trace.contexts, ['update']);
      assert.deepEqual(observed.trace.authentication, [{ inTransaction: true, sessionId: r.sessionId }]);
      assert.equal(observed.trace.queries.filter(sql => sql.includes('LEFT JOIN session_access')).length, 1);
      assert.equal(observed.trace.queries.some(sql => sql.includes('FROM action_receipts')), false, '当前授权失败必须先于读取私密原结果');
      assert.deepEqual(observed.trace.finished, [{ committed: false, committing: false }]);
      assert.equal(observed.trace.releases, 1);
      assert.deepEqual(await persistedActionState(r), before, '认证失败不能保存Receipt、高水位、世界、事件或outbox');
    } finally { release.resolve(); observed?.restore(); runtime.authenticate = authenticate; await pending?.catch(() => {}); }
  });
});

test('方向锁内授权：动作先持排他锁时真实撤权等待，撤权后原Receipt也不可读', { timeout: 15000 }, async () => {
  const r = await room(timedCapabilities), raw = request(r, direction(r, 1, 'E'));
  const access = runtime.access, pool = runtime.pool, entered = Promise.withResolvers(), release = Promise.withResolvers(), borrowed = Promise.withResolvers();
  let intercepted = false, pending, revoking, revoked = false;
  runtime.access = async function (...args) {
    if (!intercepted && args[3]?.sessionLock === 'update') {
      intercepted = true; entered.resolve((await args[0].query('SELECT pg_backend_pid() AS pid')).rows[0].pid); await release.promise;
    }
    return access.apply(this, args);
  };
  try {
    pending = runtime.submit(r.handles[0], raw); pending.catch(() => {});
    const actionPid = await bounded(entered.promise, '方向动作必须先取得原Session排他锁');
    runtime.pool = { query: (...args) => pool.query(...args), connect: async () => {
      const client = await pool.connect(); borrowed.resolve((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid); return client;
    } };
    revoking = runtime.revokeAccess(r.sessionId, r.users[0].userId).then(() => { revoked = true; }); revoking.catch(() => {});
    const writerPid = await bounded(borrowed.promise, '真实撤权必须借到独立数据库连接'); runtime.pool = pool;
    let blocked = false; const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      blocked = (await database.pool.query('SELECT $1::integer = ANY(pg_blocking_pids($2::integer)) AS blocked', [actionPid, writerPid])).rows[0].blocked;
      if (blocked) break; await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(blocked, true, '真实PG必须证明撤权被此动作的Session行锁阻塞'); assert.equal(revoked, false);
    release.resolve(); assert.equal((await pending).status, 'Accepted'); await revoking;
    runtime.access = access;
    const before = await persistedActionState(r), observed = observeSubmission();
    try {
      await assert.rejects(runtime.submit(r.handles[0], raw), { code: 'FORBIDDEN' });
      assert.equal(observed.trace.queries.some(sql => sql.includes('FROM action_receipts')), false);
      assert.deepEqual(await persistedActionState(r), before);
    } finally { observed.restore(); }
  } finally { release.resolve(); runtime.pool = pool; runtime.access = access; await Promise.allSettled([pending, revoking].filter(Boolean)); }
});

test('方向锁内授权：联合SQL与提交故障整体回滚，ACK未知沿原恢复路径', async () => {
  const r = await room(timedCapabilities), raw = request(r, direction(r, 1, 'E')), before = await persistedActionState(r);
  const failure = new Error('方向联合授权受控失败'), joined = observeSubmission({ joinedFault: failure });
  try {
    await assert.rejects(runtime.submit(r.handles[0], raw), error => error === failure);
    assertActionAuthorization(joined.trace, r, true);
    assert.equal(joined.trace.queries.some(sql => sql.includes('FROM action_receipts')), false);
    assert.ok(joined.trace.queries.includes('ROLLBACK'));
    assert.deepEqual(joined.trace.finished, [{ committed: false, committing: false }]); assert.equal(joined.trace.releases, 1);
  } finally { joined.restore(); }
  assert.deepEqual(await persistedActionState(r), before);
  const commitFailure = new Error('方向动作提交前受控失败'), hook = runtime.hooks.beforeCommit, rolled = observeSubmission();
  runtime.hooks.beforeCommit = ({ command }) => { if (command === 'spatial-action') throw commitFailure; };
  try {
    await assert.rejects(runtime.submit(r.handles[0], raw), error => error === commitFailure);
    assert.ok(rolled.trace.queries.some(sql => sql.startsWith('INSERT INTO action_receipts')));
    assert.deepEqual(rolled.trace.finished, [{ committed: false, committing: false }]); assert.equal(rolled.trace.releases, 1);
  } finally { runtime.hooks.beforeCommit = hook; rolled.restore(); }
  assert.deepEqual(await persistedActionState(r), before, '提交前失败必须同时回滚方向效果、Receipt、高水位和发布记录');
  const accepted = await runtime.submit(r.handles[0], raw); assert.equal(accepted.status, 'Accepted');
  const unknown = request(r, { kind: 'stop_move', movementCommandSeq: '2' }), after = runtime.hooks.afterCommit, recovered = observeSubmission();
  runtime.hooks.afterCommit = ({ command }) => { if (command === 'spatial-action') throw new Error('停止动作提交后ACK受控丢失'); };
  let receipt;
  try {
    receipt = await runtime.submit(r.handles[0], unknown); assert.equal(receipt.status, 'Accepted');
    assert.deepEqual(recovered.trace.contexts, ['update', undefined]);
    assert.equal(recovered.trace.queries.filter(sql => sql.includes('LEFT JOIN session_access')).length, 1);
    assert.equal(recovered.trace.queries.filter(sql => sql.includes('FROM session_access')).length, 1, '原receipt-recovery必须保留独立ACL查询');
    assert.deepEqual(recovered.trace.finished, [{ committed: true, committing: true }, { committed: true, committing: true }]);
    assert.equal(recovered.trace.releases, 2);
  } finally { runtime.hooks.afterCommit = after; recovered.restore(); }
  assert.equal(own(await state(r)).movement.status, 'cancelled');
  const saved = await persistedActionState(r), actorId = own(await state(r)).characterId;
  assert.equal(saved.receipts.filter(row => row.client_action_id === JSON.parse(unknown).clientActionId).length, 1);
  assert.equal(saved.sources.find(row => row.actor_id === actorId).handled_seq, '2');
  assert.deepEqual(await runtime.receipt(r.users[0].token, r.sessionId, JSON.parse(unknown).clientActionId), receipt);
  assert.deepEqual(await runtime.submit(r.handles[0], raw), accepted);
  assert.deepEqual(await runtime.replay(r.sessionId), await state(r));
});

test('默认关闭、能力绑定当前连接；旧 move_to/stop_move 继续可用', async () => {
  const r = await room(), disabled = new AuthorityRuntime({ pool: database.pool, now: () => clock });
  assert.equal(disabled.spatialDirection, null);
  assert.throws(() => new AuthorityRuntime({ pool: database.pool, spatialDirection: { checkpointMs: 10 } }), TypeError);
  await assert.rejects(disabled.openConnection(r.users[0].token, capabilities), { code: 'INVALID_MESSAGE' });
  const legacyHandle = await runtime.openConnection(r.users[0].token, ['spatial-v2']);
  await assert.rejects(runtime.submit(legacyHandle, request(r, direction(r, 1, 'S'))), { code: 'INVALID_MESSAGE' });
  assert.equal((await submit(r, { kind: 'move_to', movementCommandSeq: '1', sceneId: 'gray-yard', destination: { x: 180, y: 100 } })).status, 'Accepted');
  assert.equal((await submit(r, { kind: 'stop_move', movementCommandSeq: '2' })).status, 'Accepted');
  assert.equal((await state(r)).characters[(await state(r)).members[0].characterId].movement.status, 'cancelled');
  await disabled.close();
});

test('真实 PG：受理时原点、不插入 stop、领域拒绝水位与原 Receipt 重放', async () => {
  const r = await room();
  const first = await submit(r, { kind: 'move_to', movementCommandSeq: '1', sceneId: 'gray-yard', destination: { x: 220, y: 100 } });
  assert.equal(first.status, 'Accepted');
  clock += 100;
  const raw = request(r, direction(r, 2, 'S')), accepted = await runtime.submit(r.handles[0], raw);
  assert.equal(accepted.status, 'Accepted');
  const turned = own(await state(r));
  assert.ok(turned.position.x > r.snapshot.projection.self.position.x, '必须先结算仍在推进的旧路线');
  assert.equal(turned.movement.goal.x, turned.position.x, '南向目标必须保持受理点的零轴');
  assert.deepEqual(turned.movement.path[0], turned.position);
  assert.ok(Math.hypot(turned.movement.goal.x - turned.position.x, turned.movement.goal.y - turned.position.y) <= 36);
  const events = (await database.pool.query('SELECT event,event_text_encoding FROM world_events WHERE session_id=$1 AND session_seq>$2 AND session_seq<=$3 ORDER BY session_seq', [r.sessionId, first.observedSeq, accepted.observedSeq])).rows.map(row => decodeJsonbText(row.event, row.event_text_encoding));
  assert.ok(!events.some(event => event.kind === 'spatial.actor' && event.payload.actor.movement?.status === 'cancelled'));
  const rejected = await submit(r, { ...direction(r, 4, 'E'), mapVersion: 'stale-map' });
  assert.equal(rejected.code, 'STALE_REFERENCE');
  assert.equal(own(await state(r)).movement.movementCommandSeq, '2');
  assert.equal((await submit(r, direction(r, 3, 'W'))).code, 'STALE_MOVEMENT_COMMAND');
  assert.equal((await submit(r, { kind: 'stop_move', movementCommandSeq: '5' })).status, 'Accepted');
  const stopped = await state(r);
  clock += 100;
  assert.deepEqual(await runtime.submit(r.handles[0], raw), accepted);
  assert.equal((await state(r)).sessionSeq, stopped.sessionSeq, '重放不能重新解释方向或推进新路线');
  assert.deepEqual(await runtime.receipt(r.users[0].token, r.sessionId, JSON.parse(raw).clientActionId), accepted);
  assert.equal((await database.pool.query('SELECT COUNT(*)::int AS count FROM action_receipts WHERE session_id=$1 AND client_action_id=$2', [r.sessionId, JSON.parse(raw).clientActionId])).rows[0].count, 1);
  assert.deepEqual(await runtime.replay(r.sessionId), await state(r));
});

test('真实 PG：游标区间跨计划保留已执行转折，显式旧 cursor 不借用发布游标', async () => {
  const r = await room(), from = r.snapshot.snapshotSeq, origin = r.snapshot.projection.self.position;
  assert.equal((await submit(r, direction(r, 1, 'E'))).status, 'Accepted');
  clock += 50; await runtime.spatialCheckpoint(r.sessionId);
  const cornerState = await state(r), corner = own(cornerState).position;
  assert.equal((await submit(r, direction(r, 2, 'S'))).status, 'Accepted');
  clock += 50; await runtime.spatialCheckpoint(r.sessionId);
  const endState = await state(r), endpoint = own(endState).position;
  await runtime.publishPending();
  const batch = await sync(r, from), projection = batch.events.at(-1).payload.projection;
  const entity = projection.entities.find(entity => entity.entityRef === projection.self.entityRef);
  assert.equal(batch.fromExclusive, from);
  assert.deepEqual(entity.motionTrail, [origin, corner, endpoint]);
  assert.equal(entity.motionFromSceneTimeMs, r.snapshot.projection.sceneTimeMs);
  assert.equal(entity.motionThroughSceneTimeMs, endState.sceneTimeMs);
  assert.notDeepEqual(entity.motionTrail.at(-1), own(endState).movement.goal, '不能把未来短段尾加入已执行轨迹');
  const overview = projection.sceneOverview.entities.find(entity => entity.entityRef === projection.self.entityRef);
  assert.deepEqual(overview.motionTrail, entity.motionTrail);
  const tail = (await sync(r, cornerState.sessionSeq)).events.at(-1).payload.projection;
  assert.deepEqual(tail.entities.find(entity => entity.entityRef === tail.self.entityRef).motionTrail, [corner, endpoint]);
  await submit(r, { kind: 'stop_move', movementCommandSeq: '3' });
  const stopped = await state(r);
  clock += 50;
  assert.equal(await runtime.spatialCheckpoint(r.sessionId), false);
  assert.equal((await state(r)).sessionSeq, stopped.sessionSeq, '没有活动真人移动时不追加高频时钟');
});

test('真实 PG：发布中再次 COMMIT 不丢最后一次唤醒，无需定时兜底', { timeout: 10000 }, async () => {
  const r = await room(), deliveries = [], tasks = new Set();
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; }), released = new Promise(resolve => { release = resolve; });
  let blocked = false;
  runtime.hooks.duringPublish = async () => { if (!blocked) { blocked = true; enter(); await released; } };
  const publisher = committedPublisher({ runtime, deliver: async (connectionId, batch) => deliveries.push({ connectionId, batch }), track: promise => { tasks.add(promise); promise.finally(() => tasks.delete(promise)); } });
  const notify = () => publisher.request();
  runtime.on('commit', notify);
  try {
    assert.equal((await submit(r, direction(r, 1, 'E'))).status, 'Accepted');
    await entered;
    clock += 50;
    await runtime.spatialCheckpoint(r.sessionId);
    const expected = (await state(r)).sessionSeq;
    release();
    const deadline = Date.now() + 3000;
    while (!deliveries.some(item => item.connectionId === r.handles[0].connectionId && BigInt(item.batch.throughSeq) >= BigInt(expected))) {
      assert.ok(Date.now() < deadline, '没有额外 pulse 时也必须发布最后的已提交前缀');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  } finally {
    release(); delete runtime.hooks.duringPublish; runtime.off('commit', notify); publisher.close();
    while (tasks.size) await Promise.allSettled([...tasks]);
  }
});
