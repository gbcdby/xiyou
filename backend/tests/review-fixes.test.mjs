import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createRuntime } from '../runtime.mjs';
import { createAuthorityServer } from '../server.mjs';
import { validateContract } from '../../protocol/index.mjs';
import { applyAction } from '../../game/rules.mjs';
import { visibleItem } from '../../game/projection.mjs';
import { RuntimeError, errorResponse } from '../errors.mjs';

let database;
const now = () => Date.parse('2026-11-11T10:00:00.000Z');
before(async () => { database = await startTestPostgres('review-fixes'); });
after(async () => { await database?.stop(); });

function barrier() {
  let enter, release;
  return { entered: new Promise(resolve => { enter = resolve; }), gate: new Promise(resolve => { release = resolve; }), enter: () => enter(), release: () => release() };
}
function controlRaw(room, nonce, type = 'control.take') {
  return JSON.stringify({ schemaVersion: 1, type, sessionId: room.sessionId, actorId: room.actorId, nonce });
}
function syncRaw(room, snapshot) {
  return JSON.stringify({ schemaVersion: 1, type: 'sync.request', sessionId: room.sessionId, viewId: snapshot.viewId, cursor: snapshot.snapshotSeq });
}
async function running(runtime) {
  const users = [await runtime.guest({ name: '修正检查甲' }), await runtime.guest({ name: '修正检查乙' })];
  const { sessionId } = await runtime.create(users[0].token, { nonce: crypto.randomUUID(), contentVersion: 'trust-repair-fixture-v1' });
  const { actorId } = await runtime.join(users[0].token, sessionId, { nonce: 'join' });
  await runtime.join(users[1].token, sessionId, { nonce: 'join' });
  await runtime.start(users[0].token, sessionId, { nonce: 'start' });
  return { users, sessionId, actorId };
}
async function connect(origin, token) {
  const socket = io(origin, { auth: { token }, transports: ['websocket'], reconnection: false });
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  return socket;
}
const rpc = (socket, event, raw) => socket.timeout(2000).emitWithAck(event, raw);
function actionRaw(room, controlEpoch, clientActionId, action = { kind: 'wait' }) {
  return JSON.stringify({ schemaVersion: 1, sessionId: room.sessionId, actorId: room.actorId, controlEpoch, clientActionId, baseSeq: '0', action });
}
function failResponseOnce(runtime, command) {
  let pending = true;
  runtime.hooks.afterCommit = async context => {
    if (pending && context.command === command) { pending = false; throw new Error('可信测试：已提交但响应失败。'); }
  };
}

test('REQ-001：迟到的接管副作用不能断开重新获权的真实连接', { timeout: 10000 }, async () => {
  const b = barrier();
  const server = await createAuthorityServer({ pool: database.pool, now, hooks: {
    async afterCommit({ events }) {
      if (events.some(event => event.causedBy.actionId === 'delayed-replacement')) { b.enter(); await b.gate; }
    },
  } });
  const sockets = []; let earlier;
  try {
    const { port } = await server.listen(0);
    const room = await running(server.runtime);
    const origin = `http://127.0.0.1:${port}`;
    const first = await connect(origin, room.users[0].token); sockets.push(first);
    const second = await connect(origin, room.users[0].token); sockets.push(second);
    const snapshot = await rpc(first, 'session.subscribe', { sessionId: room.sessionId });
    await rpc(second, 'session.subscribe', { sessionId: room.sessionId });
    const initial = await rpc(first, 'control.resume', controlRaw(room, 'initial', 'control.resume'));
    const delayedEffects = new Promise(resolve => server.runtime.on('commit', ({ events }) => {
      if (events.some(event => event.causedBy.actionId === 'delayed-replacement')) resolve();
    }));
    earlier = rpc(second, 'control.take', controlRaw(room, 'delayed-replacement')).catch(error => ({ transportError: error.message }));
    await b.entered;
    const intermediate = await server.runtime.replay(room.sessionId);
    assert.equal(BigInt(intermediate.characters[room.actorId].controlEpoch), BigInt(initial.controlEpoch) + 1n);
    const latest = await rpc(first, 'control.take', controlRaw(room, 'latest-replacement'));
    validateContract('ControlResponse', latest);
    assert.equal(BigInt(latest.controlEpoch), BigInt(initial.controlEpoch) + 2n);
    b.release(); await delayedEffects;
    const synced = await rpc(first, 'sync.request', syncRaw(room, snapshot)).catch(error => ({ transportError: error.message }));
    assert.equal(synced.type, 'world.batch', '当前获权连接必须仍能同步，迟到回调不能关闭它。');
    const current = await server.runtime.replay(room.sessionId);
    assert.equal(first.connected, true);
    assert.equal(current.characters[room.actorId].mode, 'HumanControlled');
    assert.equal(current.characters[room.actorId].controlEpoch, latest.controlEpoch);
  } finally {
    b.release(); for (const socket of sockets) socket.disconnect();
    await earlier; await server.close();
  }
});

test('REQ-001：同一连接的迟到接管回调不能回退视图代次', { timeout: 10000 }, async () => {
  const runtime = await createRuntime({ pool: database.pool, now });
  const b = barrier(); let earlier;
  try {
    const room = await running(runtime);
    const handle = await runtime.openConnection(room.users[0].token);
    await runtime.control(handle, controlRaw(room, 'initial', 'control.resume'));
    const snapshot = await runtime.subscribe(handle, room.sessionId);
    runtime.hooks.afterCommit = async ({ events }) => {
      if (events.some(event => event.causedBy.actionId === 'delayed-same')) { b.enter(); await b.gate; }
    };
    earlier = runtime.control(handle, controlRaw(room, 'delayed-same'));
    await b.entered;
    const latest = await runtime.control(handle, controlRaw(room, 'latest-same'));
    b.release(); await earlier;
    const synced = await runtime.sync(handle, syncRaw(room, snapshot));
    validateContract('WorldBatch', synced);
    assert.equal(synced.events.at(-1).payload.projection.self.controlEpoch, latest.controlEpoch);
    const beforeDisconnect = await runtime.replay(room.sessionId);
    await runtime.disconnect(handle);
    const afterDisconnect = await runtime.replay(room.sessionId);
    assert.equal(afterDisconnect.characters[room.actorId].mode, 'GracePeriod');
    assert.equal(BigInt(afterDisconnect.characters[room.actorId].controlEpoch), BigInt(beforeDisconnect.characters[room.actorId].controlEpoch) + 1n);
  } finally { b.release(); await earlier; await runtime.close(); }
});

test('REQ-001 邻近回归：迟到回调不能恢复撤权或终局控制', async () => {
  for (const outcome of ['revoked', 'finished']) {
    const runtime = await createRuntime({ pool: database.pool, now });
    const b = barrier(); let earlier;
    try {
      const room = await running(runtime);
      const handle = await runtime.openConnection(room.users[0].token);
      await runtime.control(handle, controlRaw(room, 'initial', 'control.resume'));
      const snapshot = await runtime.subscribe(handle, room.sessionId);
      runtime.hooks.afterCommit = async ({ events }) => {
        if (events.some(event => event.causedBy.actionId === 'delayed-neighbor')) { b.enter(); await b.gate; }
      };
      earlier = runtime.control(handle, controlRaw(room, 'delayed-neighbor'));
      await b.entered;
      if (outcome === 'revoked') await runtime.revokeAccess(room.sessionId, room.users[0].userId);
      else await runtime.abortSession(room.sessionId, '检查终局控制撤销。');
      const settled = await runtime.replay(room.sessionId);
      b.release(); await earlier;
      assert.deepEqual(await runtime.replay(room.sessionId), settled);
      if (outcome === 'revoked') await assert.rejects(runtime.sync(handle, syncRaw(room, snapshot)), { code: 'FORBIDDEN' });
      else {
        const batch = await runtime.sync(handle, syncRaw(room, snapshot));
        assert.equal(batch.events.at(-1).payload.projection.self.canControl, false);
        assert.equal(batch.events.at(-1).payload.projection.phase, 'Aborted');
      }
    } finally { b.release(); await earlier; await runtime.close(); }
  }
});

test('REQ-001 邻近回归：旧事务只撤原订阅，不撤换绑后新建的只读视图', async () => {
  const runtime = await createRuntime({ pool: database.pool, now });
  const b = barrier(); let earlier;
  try {
    const room = await running(runtime);
    const first = await runtime.openConnection(room.users[0].token);
    const second = await runtime.openConnection(room.users[0].token);
    await runtime.control(first, controlRaw(room, 'initial', 'control.resume'));
    const original = await runtime.subscribe(first, room.sessionId);
    runtime.hooks.afterCommit = async ({ events }) => {
      if (events.some(event => event.causedBy.actionId === 'delayed-view')) { b.enter(); await b.gate; }
    };
    earlier = runtime.control(second, controlRaw(room, 'delayed-view'));
    await b.entered;
    const current = await runtime.subscribe(first, room.sessionId);
    assert.notEqual(current.viewId, original.viewId);
    assert.equal(current.projection.self.canControl, false);
    b.release(); await earlier;
    validateContract('WorldBatch', await runtime.sync(first, syncRaw(room, current)));
    await assert.rejects(runtime.sync(first, syncRaw(room, original)), { code: 'RESYNC_REQUIRED' });
  } finally { b.release(); await earlier; await runtime.close(); }
});

test('STD-001：提交后响应故障仍须拒绝真人同 ID 的异载荷', async () => {
  const runtime = await createRuntime({ pool: database.pool, now });
  try {
    const room = await running(runtime);
    const handle = await runtime.openConnection(room.users[0].token);
    const control = await runtime.control(handle, controlRaw(room, 'initial', 'control.resume'));
    const raw = actionRaw(room, control.controlEpoch, 'payload-bound');
    const original = await runtime.submit(handle, raw);
    const state = await runtime.replay(room.sessionId);
    const changed = actionRaw(room, control.controlEpoch, 'payload-bound', { kind: 'move', regionId: 'store' });
    assert.equal((await runtime.submit(handle, changed)).code, 'ACTION_ID_REUSE');
    failResponseOnce(runtime, 'action');
    const recovered = await runtime.submit(handle, changed);
    assert.equal(recovered.code, 'ACTION_ID_REUSE');
    validateContract('ErrorResponse', recovered);
    assert.deepEqual(await runtime.receipt(room.users[0].token, room.sessionId, 'payload-bound'), original);
    assert.deepEqual(await runtime.replay(room.sessionId), state);
    failResponseOnce(runtime, 'action');
    assert.deepEqual(await runtime.submit(handle, raw), original);
    let revoke = true;
    runtime.hooks.afterCommit = async ({ command }) => {
      if (revoke && command === 'action') {
        revoke = false; await runtime.revokeAccess(room.sessionId, room.users[0].userId);
        throw new Error('可信测试：回复前撤销成员权限。');
      }
    };
    await assert.rejects(runtime.submit(handle, changed), { code: 'FORBIDDEN' });
  } finally { await runtime.close(); }
});

test('STD-001：内部意图恢复也绑定完整包摘要，fallback 原键恢复保持幂等', async () => {
  const runtime = await createRuntime({ pool: database.pool, now });
  try {
    const room = await running(runtime);
    const handle = await runtime.bindInternal(room.sessionId, 'tangseng', 'core_npc');
    const decision = await runtime.prepareDecision(handle, { allowedTools: ['wait', 'move'] });
    const raw = JSON.stringify({ decisionId: decision.decisionId, toolCalls: [{ kind: 'wait' }] });
    const original = await runtime.submitIntent(handle, decision.decisionId, raw);
    const state = await runtime.replay(room.sessionId);
    const changed = JSON.stringify({ decisionId: decision.decisionId, toolCalls: [{ kind: 'move', regionId: 'store' }] });
    failResponseOnce(runtime, 'intent');
    const recovered = await runtime.submitIntent(handle, decision.decisionId, changed);
    assert.equal(recovered.code, 'ACTION_ID_REUSE');
    validateContract('ErrorResponse', recovered);
    assert.deepEqual(await runtime.internalReceipt(handle, `${decision.decisionId}:submit`), original);
    assert.deepEqual(await runtime.replay(room.sessionId), state);
    failResponseOnce(runtime, 'intent');
    assert.deepEqual(await runtime.submitIntent(handle, decision.decisionId, raw), original);
    const fallback = await runtime.prepareDecision(handle, { allowedTools: ['wait'] });
    await runtime.settleDecision(handle, fallback.decisionId, 'Rejected');
    failResponseOnce(runtime, 'fallback');
    const fallbackReceipt = await runtime.submitFallback(handle, fallback.decisionId);
    assert.equal(fallbackReceipt.status, 'Accepted');
    const final = await runtime.replay(room.sessionId);
    failResponseOnce(runtime, 'fallback');
    assert.deepEqual(await runtime.submitFallback(handle, fallback.decisionId), fallbackReceipt);
    assert.deepEqual(await runtime.replay(room.sessionId), final);
  } finally { await runtime.close(); }
});

test('STD-002：合法但不存在的原型属性名经真实网络得到持久目标拒绝', async () => {
  const server = await createAuthorityServer({ pool: database.pool, now });
  let socket;
  try {
    const { port } = await server.listen(0);
    const origin = `http://127.0.0.1:${port}`;
    const room = await running(server.runtime);
    socket = await connect(origin, room.users[0].token);
    await rpc(socket, 'session.subscribe', { sessionId: room.sessionId });
    const control = await rpc(socket, 'control.resume', controlRaw(room, 'initial', 'control.resume'));
    const state = await server.runtime.replay(room.sessionId);
    const actions = [
      { kind: 'take_item', itemId: 'does-not-exist', expectedItemRevision: '0' },
      { kind: 'take_item', itemId: 'constructor', expectedItemRevision: '0' },
      { kind: 'take_item', itemId: 'toString', expectedItemRevision: '0' },
      { kind: 'inspect', targetId: 'constructor' },
      { kind: 'inspect', targetId: 'toString' },
      { kind: 'transfer_item', itemId: 'constructor', targetId: room.actorId, expectedItemRevision: '0' },
      { kind: 'interact', targetId: 'constructor', expectedTargetRevision: '0', operation: 'grant_passage' },
      { kind: 'share_evidence', evidenceId: 'constructor', recipientIds: [room.actorId] },
      { kind: 'speak', text: '私下询问。', channel: 'private', recipientIds: ['constructor'] },
    ];
    for (const [index, action] of actions.entries()) {
      const actionId = `missing-${index}`;
      const raw = actionRaw(room, control.controlEpoch, actionId, action);
      const receipt = await rpc(socket, 'player.action.request', raw);
      assert.equal(receipt.code, 'TARGET_UNAVAILABLE', JSON.stringify(action));
      validateContract('ClientReceipt', receipt);
      assert.equal(receipt.status, 'Rejected'); assert.equal(receipt.actionEventRange, null);
      const lookup = await fetch(`${origin}/api/sessions/${room.sessionId}/actions/${actionId}`, { headers: { Authorization: `Bearer ${room.users[0].token}` } });
      assert.equal(lookup.status, 200);
      assert.deepEqual(await lookup.json(), receipt);
      assert.deepEqual(await rpc(socket, 'player.action.request', raw), receipt);
    }
    const forged = { ...JSON.parse(actionRaw(room, control.controlEpoch, 'forged-actor')), actorId: 'constructor' };
    assert.equal((await rpc(socket, 'player.action.request', JSON.stringify(forged))).code, 'FORBIDDEN');
    assert.deepEqual(await server.runtime.replay(room.sessionId), state);
    const internal = await server.runtime.bindInternal(room.sessionId, 'tangseng', 'core_npc');
    for (const key of ['item:constructor', 'target:toString', 'character:constructor', 'constructor:prototype']) {
      await assert.rejects(server.runtime.prepareDecision(internal, { readEntityIds: [key] }), { code: 'FORBIDDEN' });
    }
    await assert.rejects(server.runtime.bindInternal(room.sessionId, 'constructor', 'core_npc'), { code: 'FORBIDDEN' });
  } finally { socket?.disconnect(); await server.close(); }
});

test('STD-002：合法同名自有角色与物品仍可观察，不把继承目标当真实对象', () => {
  const item = { itemId: 'toString', name: '自有物品', location: { kind: 'character', characterId: 'constructor' }, resourceRevision: '0', fields: [{ key: 'intact', label: '完整', value: true }] };
  const state = {
    sessionId: 'S-own', sessionSeq: '0',
    characters: { constructor: { characterId: 'constructor', kind: 'human', regionId: 'store', capabilities: ['inspect'] } },
    items: { toString: item }, targets: {},
  };
  const events = [];
  assert.equal(visibleItem(state, 'constructor', item), true);
  applyAction({ state, content: { targets: [] }, emit(kind, payload) { events.push({ kind, payload }); } }, 'constructor', 'human', { kind: 'inspect', targetId: 'toString' });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'ObservationRecorded');
  assert.equal(events[0].payload.observerId, 'constructor');
  assert.equal(events[0].payload.subjectId, 'toString');
  assert.deepEqual(events[0].payload.fields, item.fields);
});

test('STD-003：断开的只读订阅及时释放句柄，无需关闭整个运行层', async () => {
  assert.equal(typeof global.gc, 'function', '生命周期检查通过 --expose-gc 启用显式回收。');
  const runtime = await createRuntime({ pool: database.pool, now });
  try {
    const room = await running(runtime);
    const references = [];
    for (let index = 0; index < 4; index++) {
      let handle = await runtime.openConnection(room.users[0].token);
      await runtime.subscribe(handle, room.sessionId);
      references.push(new WeakRef(handle));
      await runtime.disconnect(handle);
      handle = null;
    }
    for (let index = 0; index < 4; index++) { await new Promise(setImmediate); global.gc(); }
    assert.equal(references.filter(reference => reference.deref()).length, 0, '断线后的视图不能强引用已经结束的连接。');
    assert.equal((await runtime.snapshot(room.users[0].token, room.sessionId)).projection.phase, 'Running');
  } finally { await runtime.close(); }
});

test('STD-003：换订阅会停止在途旧批次，旧任务不能撤销新视图', async () => {
  const runtime = await createRuntime({ pool: database.pool, now });
  const b = barrier(); let publishing;
  try {
    const room = await running(runtime);
    const handle = await runtime.openConnection(room.users[0].token);
    const control = await runtime.control(handle, controlRaw(room, 'initial', 'control.resume'));
    const original = await runtime.subscribe(handle, room.sessionId);
    await runtime.submit(handle, actionRaw(room, control.controlEpoch, 'move-before-publish', { kind: 'move', regionId: 'store' }));
    let pause = true;
    runtime.hooks.afterCommit = async ({ command }) => {
      if (pause && command === 'sync') { pause = false; b.enter(); await b.gate; }
    };
    const delivered = []; const revoked = [];
    runtime.on('view-revoked', event => revoked.push(event));
    publishing = runtime.publishPending(async (_connectionId, batch) => delivered.push(batch));
    await b.entered;
    const replacement = await runtime.subscribe(handle, room.sessionId);
    b.release(); await publishing;
    assert.ok(delivered.every(batch => batch.viewId !== original.viewId), '已经替换的旧视图不能继续投递批次。');
    assert.equal(revoked.length, 0, '旧任务不能撤销当前订阅。');
    validateContract('WorldBatch', await runtime.sync(handle, syncRaw(room, replacement)));
  } finally { b.release(); await publishing; await runtime.close(); }
});

test('STD-004：长未知字段的真实 ACK 保持有效且有界的协议错误', async () => {
  const server = await createAuthorityServer({ pool: database.pool, now });
  let socket;
  try {
    const { port } = await server.listen(0);
    const room = await running(server.runtime);
    socket = await connect(`http://127.0.0.1:${port}`, room.users[0].token);
    const control = await rpc(socket, 'control.resume', controlRaw(room, 'initial', 'control.resume'));
    const state = await server.runtime.replay(room.sessionId);
    for (const [index, field] of ['a'.repeat(600), '😀'.repeat(600), '\ud800'].entries()) {
      const actionId = `invalid-field-${index}`;
      const request = { ...JSON.parse(actionRaw(room, control.controlEpoch, actionId)), [field]: true };
      const response = await rpc(socket, 'player.action.request', JSON.stringify(request));
      assert.equal(response.code, 'INVALID_MESSAGE');
      validateContract('ErrorResponse', response);
      assert.ok([...response.message].length <= 500);
      assert.equal(await server.runtime.receipt(room.users[0].token, room.sessionId, actionId), null);
    }
    assert.deepEqual(await server.runtime.replay(room.sessionId), state);
  } finally { socket?.disconnect(); await server.close(); }
});

test('STD-004：错误正文按码点保留边界并修复不完整代理对', () => {
  const exact = '甲'.repeat(499) + '😀';
  assert.equal(errorResponse(new RuntimeError('INVALID_MESSAGE', exact)).message, exact);
  const messages = ['甲'.repeat(501), '😀'.repeat(500), '😀'.repeat(501), '甲'.repeat(499) + '\ud800', '\udc00' + '😀'.repeat(500)];
  for (const message of messages) {
    const response = errorResponse(new RuntimeError('INVALID_MESSAGE', message));
    validateContract('ErrorResponse', response);
    assert.equal(response.code, 'INVALID_MESSAGE');
    assert.ok([...response.message].length <= 500);
    assert.equal(response.message.isWellFormed(), true);
  }
  validateContract('ErrorResponse', errorResponse({ code: 'FORBIDDEN', message: 42 }));
  const unknown = errorResponse(new Error('未向客户端公开的内部错误。'));
  assert.equal(unknown.code, 'OUTCOME_UNKNOWN'); validateContract('ErrorResponse', unknown);
});
