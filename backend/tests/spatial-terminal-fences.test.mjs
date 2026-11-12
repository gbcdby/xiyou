import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createRuntime } from '../runtime.mjs';
import { gaolaoRoom, accepted, confirmEnd } from '../test-support/gaolao-room.mjs';
import { reduceSpatialWorld } from '../../game/spatial-world.mjs';

const capabilities = ['spatial-v2'];
const clock = { value: Date.parse('2026-11-13T14:00:00Z') };
let db, runtime, gate;
before(async () => {
  db = await startTestPostgres('terminal-fences', { outputSubdirectory: 'r33std002' });
  const pool = {
    query: (...args) => db.pool.query(...args),
    connect: async () => {
      const client = await db.pool.connect();
      return new Proxy(client, { get(target, key) {
        if (key === 'query') return async (...args) => {
          const selected = gate && !gate.claimed && gate.matches(args[0]) ? gate : null;
          if (selected) {
            selected.claimed = true;
            if (selected.before) { selected.enter(); await selected.released; }
          }
          const result = await client.query(...args);
          if (selected && !selected.before) {
            // 已真实COMMIT并释放行锁，仅延迟驱动返回，不用内存替身代替提交。
            selected.enter(); await selected.released;
          }
          return result;
        };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    },
  };
  runtime = await createRuntime({ pool, now: () => clock.value });
});
after(async () => { gate?.release(); await runtime?.close(); await db?.stop(); });
function delay(matches = sql => sql === 'COMMIT', before = false) {
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; }), released = new Promise(resolve => { release = resolve; });
  return gate = { matches, before, enter, release, entered, released };
}
const sync = (handle, snapshot) => runtime.sync(handle, JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId: snapshot.sessionId, viewId: snapshot.viewId, cursor: snapshot.snapshotSeq }));
const control = (snapshot, nonce = crypto.randomUUID()) => JSON.stringify({ schemaVersion: 2, type: 'control.take', sessionId: snapshot.sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce });
async function endedRoom() {
  const r = await gaolaoRoom(runtime, clock, 2);
  await confirmEnd(r, 'chapter');
  return r;
}

test('R33STD002：终态旧视图、活连接与当前读权仍会失效，旧动作原结果可恢复但不能继续写事实', async () => {
  const r = await gaolaoRoom(runtime, clock, 2);
  const originalRaw = await r.raw(0, { kind: 'speak', text: '结束前原文\u0000仍可恢复。', channel: 'team', recipientRefs: [] });
  const original = accepted(await runtime.submit(r.handles[0], originalRaw));
  const pending = await r.raw(0, { kind: 'wait' });
  await confirmEnd(r, 'chapter');
  const frozen = await runtime.replay(r.sessionId), first = await runtime.subscribe(r.handles[0], r.sessionId), second = await runtime.subscribe(r.handles[0], r.sessionId);
  assert.equal(first.snapshotSeq, frozen.sessionSeq);
  assert.equal(second.snapshotSeq, frozen.sessionSeq);
  assert.notEqual(first.viewId, second.viewId);
  assert.notEqual(first.projection.self.entityRef, second.projection.self.entityRef);
  await assert.rejects(sync(r.handles[0], first), { code: 'RESYNC_REQUIRED' });
  assert.equal((await sync(r.handles[0], second)).throughSeq, frozen.sessionSeq);
  assert.deepEqual(await runtime.submit(r.handles[0], originalRaw), original);
  assert.deepEqual(await runtime.receipt(r.users[0].token, r.sessionId, JSON.parse(originalRaw).clientActionId), original);
  assert.equal((await runtime.submit(r.handles[0], pending)).code, 'STALE_CONTROL');
  await assert.rejects(runtime.control(r.handles[0], control(second)), { code: 'FORBIDDEN' });
  await runtime.maintenance(r.sessionId);
  assert.deepEqual(await runtime.replay(r.sessionId), frozen);

  clock.value += 61000;
  await assert.rejects(sync(r.handles[0], second), { code: 'UNAUTHENTICATED' });
  const replacement = await runtime.openConnection(r.users[0].token, capabilities), current = await runtime.subscribe(replacement, r.sessionId);
  await runtime.disconnect(replacement);
  await assert.rejects(sync(replacement, current), error => ['UNAUTHENTICATED', 'RESYNC_REQUIRED'].includes(error.code));
  await runtime.revokeAccess(r.sessionId, r.users[0].userId);
  await assert.rejects(runtime.snapshot(r.users[0].token, r.sessionId, capabilities), { code: 'FORBIDDEN' });
  await assert.rejects(runtime.recap(r.users[0].token, r.sessionId, { throughSeq: frozen.sessionSeq }), { code: 'FORBIDDEN' });
  const denied = await runtime.openConnection(r.users[0].token, capabilities);
  await assert.rejects(runtime.subscribe(denied, r.sessionId), { code: 'FORBIDDEN' });
  assert.deepEqual(await runtime.replay(r.sessionId), frozen, '撤读权与终态事实水位分开');
});

test('R33STD002：同水位较早COMMIT迟到返回不能覆盖较新终态订阅', async () => {
  const r = await endedRoom(), delayed = delay(), pending = runtime.subscribe(r.handles[0], r.sessionId);
  try {
    await delayed.entered;
    const newer = await runtime.subscribe(r.handles[0], r.sessionId);
    delayed.release();
    const older = await pending;
    assert.equal(older.snapshotSeq, newer.snapshotSeq);
    assert.notEqual(older.viewId, newer.viewId);
    await sync(r.handles[0], newer);
    await assert.rejects(sync(r.handles[0], older), { code: 'RESYNC_REQUIRED' });
    assert.equal(runtime.connectionView(r.handles[0]).viewId, newer.viewId);
  } finally { delayed.release(); await pending.catch(() => {}); gate = null; }
});

test('R33STD002：终态同水位仍按取得行锁后的提交顺序安装，不按调用开始排序', async () => {
  const r = await endedRoom(), delayed = delay(sql => sql === 'SELECT * FROM sessions WHERE session_id=$1 FOR UPDATE', true);
  const startedEarlier = runtime.subscribe(r.handles[0], r.sessionId);
  try {
    await delayed.entered;
    const committedEarlier = await runtime.subscribe(r.handles[0], r.sessionId);
    delayed.release();
    const committedLater = await startedEarlier;
    assert.equal(committedLater.snapshotSeq, committedEarlier.snapshotSeq);
    await sync(r.handles[0], committedLater);
    await assert.rejects(sync(r.handles[0], committedEarlier), { code: 'RESYNC_REQUIRED' });
  } finally { delayed.release(); await startedEarlier.catch(() => {}); gate = null; }
});

test('R33STD002：终态A→B→A保留选择围栏，较新读取回滚不复活旧在途安装', async () => {
  const r = await endedRoom(), handle = r.handles[0];
  const other = await runtime.create(r.users[0].token, { nonce: crypto.randomUUID(), contentVersion: 'spatial-graybox-v2', capabilities });
  const delayed = delay(sql => sql === 'SELECT * FROM sessions WHERE session_id=$1 FOR UPDATE', true);
  const oldA = runtime.subscribe(handle, r.sessionId).then(snapshot => ({ snapshot }), error => ({ error }));
  try {
    await delayed.entered;
    await runtime.subscribe(handle, other.sessionId);
    const latest = await runtime.subscribe(handle, r.sessionId);
    delayed.release();
    assert.equal((await oldA).error.code, 'RESYNC_REQUIRED');
    await sync(handle, latest);

    gate = null;
    const delayedCommit = delay(), old = runtime.subscribe(handle, r.sessionId);
    try {
      await delayedCommit.entered;
      runtime.hooks.beforeCommit = ({ command }) => { if (command === 'subscribe') throw new Error('受控终态读取回滚'); };
      await assert.rejects(runtime.subscribe(handle, r.sessionId), { message: '受控终态读取回滚' });
      delete runtime.hooks.beforeCommit;
      delayedCommit.release();
      const late = await old;
      await sync(handle, latest);
      await assert.rejects(sync(handle, late), { code: 'RESYNC_REQUIRED' });
      assert.equal(runtime.connectionView(handle).viewId, latest.viewId);
    } finally { delete runtime.hooks.beforeCommit; delayedCommit.release(); await old.catch(() => {}); }
  } finally { delayed.release(); await oldA; gate = null; }
});

test('R33STD002：旧选择通过初检后迟到准备，不得占用新终态读取的安装代次', async () => {
  const r = await endedRoom(), handle = r.handles[0];
  const other = await runtime.create(r.users[0].token, { nonce: crypto.randomUUID(), contentVersion: 'gaolaozhuang-v1', capabilities });
  await runtime.cancel(r.users[0].token, other.sessionId, { nonce: crypto.randomUUID() });
  const snapshotGate = delay(sql => sql.startsWith('SELECT handled_seq FROM spatial_command_sources'), true);
  const oldA = runtime.subscribe(handle, r.sessionId).then(snapshot => ({ snapshot }), error => ({ error }));
  let commitGate, pendingB;
  try {
    await snapshotGate.entered;
    commitGate = delay();
    pendingB = runtime.subscribe(handle, other.sessionId);
    await commitGate.entered;
    snapshotGate.release();
    assert.equal((await oldA).error.code, 'RESYNC_REQUIRED');
    commitGate.release();
    const current = await pendingB;
    assert.equal((await sync(handle, current)).throughSeq, current.snapshotSeq);
    assert.equal(runtime.connectionView(handle).viewId, current.viewId);
  } finally { snapshotGate.release(); commitGate?.release(); await oldA; await pendingB?.catch(() => {}); gate = null; }
});

test('R33STD002：已COMMIT的Running控制迟回调跨终局不得覆盖新只读绑定，原nonce仍恢复', async () => {
  const r = await gaolaoRoom(runtime, clock, 2), before = await r.snapshot(0), request = control(before, 'terminal-delayed-control');
  const delayed = delay(), pending = runtime.control(r.handles[0], request);
  try {
    await delayed.entered;
    await confirmEnd(r, 'chapter');
    const frozen = await runtime.replay(r.sessionId), terminal = await runtime.subscribe(r.handles[0], r.sessionId);
    delayed.release();
    const original = await pending;
    assert.equal(original.snapshot.projection.phase, 'Running');
    assert.equal(terminal.projection.phase, 'Finished');
    assert.equal(terminal.projection.self.canControl, false);
    assert.deepEqual(await runtime.control(r.handles[0], request), original);
    await sync(r.handles[0], terminal);
    assert.equal(runtime.connectionView(r.handles[0]).viewId, terminal.viewId);
    await assert.rejects(sync(r.handles[0], original.snapshot), { code: 'RESYNC_REQUIRED' });
    assert.deepEqual(await runtime.replay(r.sessionId), frozen);
  } finally { delayed.release(); await pending.catch(() => {}); gate = null; }
});

test('R33STD002：授权撤销或断开在真实COMMIT后发生，迟终态读取不能安装', async () => {
  for (const cause of ['revoke', 'disconnect']) {
    const r = await endedRoom(), handle = r.handles[0], frozen = await runtime.replay(r.sessionId), delayed = delay();
    const pending = runtime.subscribe(handle, r.sessionId);
    try {
      await delayed.entered;
      if (cause === 'revoke') await runtime.revokeAccess(r.sessionId, r.users[0].userId);
      else await runtime.disconnect(handle);
      delayed.release();
      const stale = await pending;
      assert.equal(runtime.connectionView(handle), undefined);
      await assert.rejects(sync(handle, stale), error => ['FORBIDDEN', 'UNAUTHENTICATED', 'RESYNC_REQUIRED'].includes(error.code));
      assert.deepEqual(await runtime.replay(r.sessionId), frozen);
    } finally { delayed.release(); await pending.catch(() => {}); gate = null; }
  }
});

test('R33STD002：旧终态view日志保留回放兼容，其他后续世界事实仍拒绝', async () => {
  const r = await endedRoom(), state = await runtime.replay(r.sessionId), actorId = state.members[0].characterId;
  const event = { schemaVersion: 2, sessionId: state.sessionId, sessionSeq: String(BigInt(state.sessionSeq) + 1n), kind: 'spatial.view', payload: { actorId, view: structuredClone(state.views[actorId]) } };
  const historical = reduceSpatialWorld(state, event, r.content);
  assert.equal(historical.sessionSeq, event.sessionSeq, '仅检验旧事件形状的解释器兼容，不经新运行入口追加它');
  assert.deepEqual(historical.chapter, state.chapter);
  assert.deepEqual(historical.ending, state.ending);
  assert.throws(() => reduceSpatialWorld(state, { ...event, kind: 'gaolao.chapter', payload: { chapter: state.chapter } }, r.content), /终局之后不能追加空间事实/);
});
