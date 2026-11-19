import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createRuntime } from '../runtime.mjs';
import { advanceSpatialTime } from '../spatial-runtime.mjs';
import { decodeJsonbText } from '../jsonb-text.mjs';
import { gaolaoRoom } from '../test-support/gaolao-room.mjs';

const BULK = 'SELECT connection_id,active,lease_until FROM connections WHERE connection_id=ANY($1::text[])';
const SINGLE = 'SELECT active,lease_until FROM connections WHERE connection_id=$1';
const LIVE = 'SELECT 1 FROM connections WHERE connection_id=$1 AND user_id=$2 AND active AND lease_until>$3';
const caps = ['spatial-v2', 'spatial-direction-v1', 'spatial-timed-trail-v1'];
const clock = { value: Date.parse('2026-11-19T00:00:00Z') };
let database, runtime;
before(async () => {
  database = await startTestPostgres('spatial-lease-batch', { outputSubdirectory: 'lease-batch-tests' });
  runtime = await createRuntime({ pool: database.pool, now: () => clock.value, spatialDirection: { checkpointMs: 50 } });
});
after(async () => { await runtime?.close(); await database?.stop(); });

// 沿用 spatial-runtime / spatial-direction 的真实建房步骤，不启动发布器或后台计时器。
async function room(count = 2) {
  const users = [];
  for (let i = 0; i < count; i++) users.push(await runtime.guest({ name: `租约玩家${i + 1}` }));
  const { sessionId } = await runtime.create(users[0].token, { nonce: crypto.randomUUID(), contentVersion: 'spatial-graybox-v2', capabilities: caps });
  for (const user of users) await runtime.join(user.token, sessionId, { nonce: crypto.randomUUID(), capabilities: caps });
  await runtime.start(users[0].token, sessionId, { nonce: crypto.randomUUID() });
  const handles = [], snapshots = [];
  for (const user of users) {
    const handle = await runtime.openConnection(user.token, caps), snapshot = await runtime.subscribe(handle, sessionId);
    const result = await runtime.control(handle, JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId,
      viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce: crypto.randomUUID() }));
    handles.push(handle); snapshots.push(result.snapshot);
  }
  const r = { sessionId, users, handles, snapshots };
  Object.assign(r, actorBindings(r, await saved(r)));
  return r;
}
async function saved(r) {
  const row = (await database.pool.query('SELECT state,state_text_encoding FROM sessions WHERE session_id=$1', [r.sessionId])).rows[0];
  return decodeJsonbText(row.state, row.state_text_encoding);
}
// actors顺序来自持久化characters的原枚举；连接归属另按userId关联，不能按加入下标配对。
function actorBindings(r, state) {
  const actors = Object.values(state.characters).filter(actor => actor.kind === 'human' && actor.mode === 'HumanControlled');
  const memberByActor = new Map(state.members.map(member => [member.characterId, member]));
  const handleByUser = new Map(r.handles.map(handle => [runtime.connection(handle).userId, handle]));
  const orderedHandles = actors.map(actor => {
    const handle = handleByUser.get(memberByActor.get(actor.characterId)?.userId);
    assert.ok(handle, '每个真实actor必须找到同userId的handle');
    assert.equal(handle.connectionId, actor.activeConnectionId, '真实控制绑定必须与持久化actor一致');
    return handle;
  });
  return { actorIds: actors.map(actor => actor.characterId), orderedHandles };
}
// 只包 runtime 的 Promise client；database.pool.query 的 callback 路径保持原样。
function observe({ beforeQuery, afterQuery } = {}) {
  const pool = runtime.pool, entries = [];
  runtime.pool = { query: pool.query.bind(pool), connect: async () => {
    const client = await pool.connect();
    return new Proxy(client, { get(target, key) {
      if (key === 'query') return async (sql, ...args) => {
        const entry = { sql, values: args[0], returned: false, code: null }; entries.push(entry);
        const realQuery = (...queryArgs) => target.query(...queryArgs);
        try {
          await beforeQuery?.({ sql, args, realQuery });
          const result = await realQuery(sql, ...args); entry.returned = true;
          await afterQuery?.({ sql, args, result, realQuery }); return result;
        } catch (error) { entry.code = error.code; throw error; }
      };
      if (key === 'release') return (...args) => { entries.push({ release: true, error: args[0] }); return target.release(...args); };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
  } };
  return { entries, restore() { runtime.pool = pool; } };
}
const leases = audit => audit.entries.filter(entry => entry.sql === BULK || entry.sql === SINGLE);
const advancing = (r, operation = async tx => { await advanceSpatialTime(tx); return [...tx.liveActorIds]; }) =>
  runtime.locked(r.sessionId, { kind: 'lease-batch-test' }, operation);

for (const count of [2, 5]) test(`LB-01：真实${count}人只发一次租约批读并保持时钟与回放`, { timeout: 15000 }, async () => {
  const r = await room(count), before = await saved(r); clock.value += 50;
  const audit = observe(); let live;
  try { live = await advancing(r); } finally { audit.restore(); }
  assert.equal(audit.entries.filter(entry => entry.sql === BULK && entry.returned).length, 1,
    '本次真实 advance 必须只完成一个 bulk SELECT；旧逐人实现应在这里失败');
  assert.equal(audit.entries.filter(entry => entry.sql === SINGLE).length, 0);
  assert.deepEqual(leases(audit)[0].values, [r.actorIds.map(id => before.characters[id].activeConnectionId)]);
  assert.deepEqual(live, r.actorIds);
  const after = await saved(r); assert.equal(after.paused, false);
  assert.equal(after.sceneTimeMs, before.sceneTimeMs + 50);
  assert.deepEqual(await runtime.replay(r.sessionId), after);
});

async function isolated(r, operation) {
  const rollback = new Error('仅回滚隔离边界fixture'); let result;
  await assert.rejects(advancing(r, async tx => { result = await operation(tx); throw rollback; }), error => error === rollback);
  return result;
}
async function persisted(r) {
  const read = sql => database.pool.query(sql, [r.sessionId]).then(result => result.rows);
  return { session: await read('SELECT state,state_text_encoding,session_seq,logical_time FROM sessions WHERE session_id=$1'),
    events: await read('SELECT * FROM world_events WHERE session_id=$1 ORDER BY session_seq'),
    receipts: await read('SELECT * FROM action_receipts WHERE session_id=$1 ORDER BY principal_id,client_action_id'),
    sources: await read('SELECT * FROM spatial_command_sources WHERE session_id=$1 ORDER BY actor_id,control_epoch'),
    outbox: await read('SELECT * FROM outbox WHERE session_id=$1 ORDER BY through_seq'),
    connections: (await database.pool.query('SELECT connection_id,active,lease_until FROM connections WHERE connection_id=ANY($1::text[]) ORDER BY connection_id', [r.handles.map(handle => handle.connectionId)])).rows };
}
function directionRaw(r, seq, direction = 'E') {
  const s = r.snapshots[0];
  return JSON.stringify({ schemaVersion: 2, sessionId: r.sessionId, viewId: s.viewId, actorRef: s.projection.self.entityRef,
    controlEpoch: s.projection.self.controlEpoch, baseSeq: s.snapshotSeq, clientActionId: crypto.randomUUID(),
    action: { kind: 'move_direction', movementCommandSeq: String(seq), sceneId: s.projection.self.sceneId,
      mapVersion: s.projection.mapVersion, direction } });
}

test('LB-01：空actors零租约SQL，非空间与终态保留早退', async () => {
  const r = await room(), before = await persisted(r);
  const audit = observe();
  try {
    const live = await isolated(r, async tx => {
      for (const id of r.actorIds) tx.state.characters[id].mode = 'GracePeriod';
      await advanceSpatialTime(tx); return [...tx.liveActorIds];
    });
    assert.deepEqual(live, []);
    for (const kind of ['Finished', 'Aborted', 'non-spatial']) await isolated(r, async tx => {
      if (kind === 'non-spatial') delete tx.state.protocolCapability; else tx.state.phase = kind;
      await advanceSpatialTime(tx); assert.equal(tx.events.length, 0);
    });
    assert.equal(leases(audit).length, 0);
  } finally { audit.restore(); }
  assert.deepEqual(await persisted(r), before, '人工边界状态始终回滚，不能写成公共会话状态');
});

for (const personal of [false, true]) test(`LB-02：真实到期/停用/缺失行与${personal ? '个人' : '普通'}控制语义`, { timeout: 15000 }, async () => {
  const r = personal ? await gaolaoRoom(runtime, clock, 5, 'gaolaozhuang-scene-v3') : await room(5);
  const before = await saved(r), { actorIds, orderedHandles } = actorBindings(r, before); clock.value += 50;
  const wall = clock.value, ids = orderedHandles.map(handle => handle.connectionId);
  const invalidConnections = new Set(ids.slice(1));
  const invalidActors = actorIds.filter(id => invalidConnections.has(before.characters[id].activeConnectionId));
  await database.pool.query('UPDATE connections SET lease_until=$2 WHERE connection_id=$1', [ids[0], new Date(wall + 1000).toISOString()]);
  await database.pool.query('UPDATE connections SET lease_until=$2 WHERE connection_id=$1', [ids[1], new Date(wall - 1).toISOString()]);
  await database.pool.query('UPDATE connections SET lease_until=$2 WHERE connection_id=$1', [ids[2], new Date(wall).toISOString()]);
  await database.pool.query('UPDATE connections SET active=false,lease_until=$2 WHERE connection_id=$1', [ids[3], new Date(wall + 2000).toISOString()]);
  await database.pool.query('DELETE FROM connections WHERE connection_id=$1', [ids[4]]);
  const audit = observe(); let actual;
  try {
    actual = await advancing(r, async tx => {
      await advanceSpatialTime(tx);
      return { live: [...tx.liveActorIds], changes: tx.events.filter(event => event.kind === 'control.changed').map(event => event.payload) };
    });
  } finally { audit.restore(); }
  assert.equal(audit.entries.filter(entry => entry.sql === BULK && entry.returned).length, 1);
  assert.deepEqual(actual.live, [actorIds[0]], 'until必须严格大于wall；inactive及无行均不live');
  assert.deepEqual(actual.changes.map(change => change.actorId), personal ? invalidActors : [], '失效控制事件按原actors顺序过滤真实失效connection集合');
  const after = await saved(r); assert.equal(after.paused, true); assert.equal(after.sceneTimeMs, before.sceneTimeMs + 50);
  for (const id of invalidActors) {
    assert.equal(after.characters[id].mode, personal ? 'GracePeriod' : 'HumanControlled');
    assert.equal(after.characters[id].controlEpoch, personal ? String(BigInt(before.characters[id].controlEpoch) + 1n) : before.characters[id].controlEpoch);
    if (personal) assert.equal(after.characters[id].activeConnectionId, null);
  }
  assert.deepEqual(await runtime.replay(r.sessionId), after);
});

test('LB-02：inactive行仍参与原cutoff，不能顺便改成仅live租约排序', async () => {
  const r = await room(), before = await saved(r); clock.value += 50;
  await database.pool.query('UPDATE connections SET active=false WHERE connection_id=$1', [r.orderedHandles[1].connectionId]);
  assert.deepEqual(await advancing(r), [r.actorIds[0]]);
  const after = await saved(r);
  assert.equal(after.paused, true);
  assert.equal(after.sceneTimeMs, before.sceneTimeMs + 50, '两个原lease行都未到期，即使一个inactive，原第二个until仍推进cutoff');
});

test('LB-03：真实行重复/null/缺失映射按actor计数，不依赖结果行顺序', async () => {
  const r = await room(5), before = await persisted(r); clock.value += 50;
  // 只置换真实PG已返回的行顺序，不造行、不改行内容，验证SQL未承诺的排序不参与语义。
  const audit = observe({ afterQuery: ({ sql, result }) => { if (sql === BULK) result.rows.reverse(); } });
  let actual;
  try {
    actual = await isolated(r, async tx => {
      const actors = r.actorIds.map(id => tx.state.characters[id]);
      actors[0].activeConnectionId = r.orderedHandles[3].connectionId;
      actors[1].activeConnectionId = r.orderedHandles[3].connectionId;
      actors[2].activeConnectionId = null;
      actors[3].activeConnectionId = 'lease-batch-missing-connection';
      actors[4].activeConnectionId = r.orderedHandles[0].connectionId;
      await tx.client.query('UPDATE connections SET active=false WHERE connection_id=$1', [r.orderedHandles[0].connectionId]);
      await advanceSpatialTime(tx);
      return { live: [...tx.liveActorIds], paused: tx.state.paused, sceneTimeMs: tx.state.sceneTimeMs };
    });
  } finally { audit.restore(); }
  assert.equal(audit.entries.filter(entry => entry.sql === BULK && entry.returned).length, 1);
  assert.deepEqual(actual.live, r.actorIds.slice(0, 2));
  assert.equal(actual.paused, false, '两个actor共享连接仍计为两个live actor，不能按Map.size暂停');
  assert.equal(actual.sceneTimeMs, decodeJsonbText(before.session[0].state, before.session[0].state_text_encoding).sceneTimeMs + 50);
  assert.deepEqual(await persisted(r), before, '异常绑定及同client UPDATE均真实回滚');
});

test('LB-04：每次advance新读真实续租/停用，正常disconnect仍串行收束', async () => {
  const r = await room(); clock.value += 25;
  const renewedHandle = r.orderedHandles[0], revokedHandle = r.orderedHandles[1];
  await database.pool.query('UPDATE connections SET lease_until=$2 WHERE connection_id=$1', [renewedHandle.connectionId, new Date(clock.value).toISOString()]);
  const audit = observe(); let actual;
  try {
    actual = await advancing(r, async tx => {
      assert.equal((await tx.client.query('SHOW transaction_isolation')).rows[0].transaction_isolation, 'read committed');
      await advanceSpatialTime(tx); const first = [...tx.liveActorIds];
      // heartbeat真实更新另一连接上的lease；同一tx.time下下一statement也必须重新读到续期。
      await runtime.heartbeat(renewedHandle);
      await advanceSpatialTime(tx); const renewed = [...tx.liveActorIds], resumed = tx.state.paused === false;
      // 真实独立连接上的已提交存储撤权；不是声称granted disconnect能穿过本session行锁。
      await database.pool.query('UPDATE connections SET active=false WHERE connection_id=$1', [revokedHandle.connectionId]);
      await advanceSpatialTime(tx); return { first, renewed, resumed, revoked: [...tx.liveActorIds], paused: tx.state.paused };
    });
  } finally { audit.restore(); }
  assert.equal(audit.entries.filter(entry => entry.sql === BULK && entry.returned).length, 3);
  assert.deepEqual(actual.first, [r.actorIds[1]], '恰好到期的一方不live');
  assert.deepEqual(actual.renewed, r.actorIds, '真实续租后按原actor顺序恢复'); assert.equal(actual.resumed, true);
  assert.deepEqual(actual.revoked, [r.actorIds[0]]); assert.equal(actual.paused, true);
  await runtime.disconnect(revokedHandle);
  const disconnected = await saved(r); assert.equal(disconnected.characters[r.actorIds[1]].mode, 'GracePeriod');
  const later = observe(); let live;
  try { live = await advancing(r); } finally { later.restore(); }
  assert.equal(later.entries.filter(entry => entry.sql === BULK && entry.returned).length, 1);
  assert.deepEqual(live, [r.actorIds[0]]);
});

test('LB-05：bulk之后撤权仍由独立liveConnection拒绝，原Accepted Receipt优先恢复', async () => {
  const r = await room(), original = directionRaw(r, 1);
  const accepted = await runtime.submit(r.handles[0], original); assert.equal(accepted.status, 'Accepted');
  let revoked = false;
  const audit = observe({ afterQuery: async ({ sql }) => {
    if (!revoked && (sql === BULK || sql === SINGLE)) {
      revoked = true;
      await database.pool.query('UPDATE connections SET active=false WHERE connection_id=$1', [r.handles[0].connectionId]);
    }
  } });
  let rejected;
  try { rejected = await runtime.submit(r.handles[0], directionRaw(r, 2, 'S')); } finally { audit.restore(); }
  assert.equal(revoked, true); assert.equal(rejected.status, 'Rejected'); assert.equal(rejected.code, 'STALE_CONTROL');
  const leaseIndex = audit.entries.findIndex(entry => entry.sql === BULK);
  const liveIndex = audit.entries.findIndex(entry => entry.sql === LIVE && entry.returned);
  assert(leaseIndex >= 0 && liveIndex > leaseIndex, '后续独立动作授权查询必须真实执行，不能复用bulk结果');
  assert.equal(audit.entries.some(entry => entry.sql?.startsWith('INSERT INTO spatial_command_sources')), false);
  const beforeReplay = await persisted(r), replayAudit = observe();
  try { assert.deepEqual(await runtime.submit(r.handles[0], original), accepted); } finally { replayAudit.restore(); }
  assert.equal(leases(replayAudit).length, 0, '已有Receipt在advance前恢复');
  assert.equal(replayAudit.entries.some(entry => entry.sql === LIVE || entry.sql?.startsWith('INSERT INTO action_receipts') || entry.sql?.startsWith('INSERT INTO spatial_command_sources')), false);
  assert.deepEqual(await persisted(r), beforeReplay);
});

test('LB-06：租约批读边界真实PG错误保留原异常并整事务回滚', async () => {
  const r = await room(), before = await persisted(r); let injected = false;
  const audit = observe({ beforeQuery: async ({ sql, realQuery }) => {
    if (!injected && (sql === BULK || sql === SINGLE)) {
      injected = true;
      // 同一真实事务先写可核回滚的探针，再由PG生成22012；不使用mock throw替代数据库失败态。
      await realQuery("UPDATE connections SET lease_until=lease_until+interval '1 second' WHERE connection_id=$1", [r.handles[0].connectionId]);
      await realQuery('SELECT 1/0');
    }
  } });
  try { await assert.rejects(runtime.submit(r.handles[0], directionRaw(r, 1)), { code: '22012' }); }
  finally { audit.restore(); }
  assert.equal(injected, true);
  assert.equal(audit.entries.filter(entry => entry.sql === 'ROLLBACK' && entry.returned).length, 1);
  assert.equal(audit.entries.some(entry => entry.sql === 'COMMIT'), false);
  assert.equal(audit.entries.filter(entry => entry.release).length, 1);
  assert.deepEqual(await persisted(r), before, '会话、事件、Receipt、水位、outbox与连接探针写入全部保持事务前值');
});
