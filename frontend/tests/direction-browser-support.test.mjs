import test from 'node:test';
import assert from 'node:assert/strict';
import { observeDirectionConnections, assertShortDirectionPlan, assertAcceptedLateEvidence, assertFivePersonSupply, observeDirectionSubmissions } from './direction-browser-support.mjs';
import { observeDirectionClient } from './direction-observer.mjs';
import { SpatialView } from '../src/domain/spatial-view.ts';
import { shallowRef } from 'vue';
import { canonicalize } from '../../protocol/index.mjs';
import { createHash } from 'node:crypto';
import { spatialSnapshot, spatialBatch } from './spatial-fixture.mjs';

test('新模式资格：受控适配层拒绝旧回退、未安装view、错误epoch及未接受能力', async () => {
  const snapshot = spatialSnapshot(), handle = { connectionId: 'controlled-connection' }, capabilities = ['spatial-v2', 'spatial-direction-v1', 'spatial-timed-trail-v1'];
  const state = { connection: 'online', inputReady: true, timedTrail: true, snapshot };
  const view = { active: true, sessionId: snapshot.sessionId, viewId: snapshot.viewId, userId: 'user', ownedEpoch: '2', schemaVersion: 2 };
  let pending = false, called = 0;
  const runtime = { spatialDirection: { checkpointMs: 50 }, async openConnection(...args) { called++; assert.equal(this, runtime); assert.deepEqual(args, ['private-token', capabilities]); return handle; },
    connectionView: value => value === handle ? view : null, connection: () => ({ capabilities }), pendingViewInstallation: () => pending };
  const original = runtime.openConnection, observer = observeDirectionConnections(runtime), page = { evaluate: async () => state };
  try {
    assert.equal(await runtime.openConnection('private-token', capabilities), handle); assert.equal(called, 1);
    const result = await observer.qualify(page, 'user', 'controlled-unit'); assert.deepEqual(result.acceptedCapabilities, capabilities); assert.ok(!JSON.stringify(result).includes('private-token'));
    state.timedTrail = false; await assert.rejects(observer.qualify(page, 'user', 'fallback')); state.timedTrail = true;
    pending = true; await assert.rejects(observer.qualify(page, 'user', 'pending')); pending = false;
    view.ownedEpoch = '1'; await assert.rejects(observer.qualify(page, 'user', 'old-epoch')); view.ownedEpoch = '2';
    view.viewId = 'old-view'; await assert.rejects(observer.qualify(page, 'user', 'old-view')); view.viewId = snapshot.viewId;
    capabilities.pop(); await assert.rejects(observer.qualify(page, 'user', 'direction-only'));
  } finally { observer.close(); }
  assert.equal(runtime.openConnection, original);
});

function lateFixture() {
  const s = spatialSnapshot(), request = { schemaVersion: 2, sessionId: s.sessionId, viewId: s.viewId, actorRef: s.projection.self.entityRef,
    controlEpoch: '2', baseSeq: '10', clientActionId: 'late-se', action: { kind: 'move_direction', sceneId: 'yard', mapVersion: 'gray-map-v1', direction: 'SE', movementCommandSeq: '4' } };
  const raw = canonicalize(request), receipt = { clientActionId: request.clientActionId, status: 'Accepted', observedSeq: '12', result: { movementId: 'movement-se' } };
  return { selected: { raw, request, enteredAt: 1250, submitReturnedAt: 1260, ackReleasedAt: 1440, receipt }, diagonalAt: 1000, downAt: 1350, delayMs: 180,
    stored: [{ actor_id: 'actor', semantic_digest: createHash('sha256').update(raw).digest('hex'), receipt: { publicReceipt: receipt } }],
    plan: { movementId: 'movement-se', movementCommandSeq: '4', controlEpoch: '2', path: [{ x: 100, y: 100 }, { x: 125, y: 125 }] },
    client: { initial: { viewId: request.viewId, controlEpoch: '2' }, errors: [], dropped: 0, inputs: [{ type: 'keyup', key: 'ArrowRight', phase: 'down-only', wallAt: 1350, viewId: request.viewId, epoch: '2', actions: [{ id: 'late-se', status: 'waiting', receipt: null }] }],
      requests: [{ id: 'late-se', wallAt: 1249, action: request.action }, { id: 'new-s', wallAt: 1352, action: { kind: 'move_direction', direction: 'S', movementCommandSeq: '5' } }, { id: 'stop', wallAt: 1799, action: { kind: 'stop_move', movementCommandSeq: '6' } }],
      acknowledgements: [{ id: 'late-se', wallAt: 1441, receipt }], states: [{ id: 'late-se', status: 'accepted', wallAt: 1442, receipt, viewId: request.viewId, controlEpoch: '2' }], maxPendingDirections: 2, maxPendingStops: 1 },
    submissions: [{ request: { clientActionId: 'new-s', action: { kind: 'move_direction', direction: 'S', movementCommandSeq: '5' } }, enteredAt: 1353, submitReturnedAt: 1380, receipt: { status: 'Accepted' } },
      { request: { clientActionId: 'stop', action: { kind: 'stop_move', movementCommandSeq: '6' } }, enteredAt: 1800, submitReturnedAt: 1810, receipt: { status: 'Accepted', observedSeq: '20' } }],
    movementRequests: [request, { clientActionId: 'new-s', action: { kind: 'move_direction', direction: 'S', movementCommandSeq: '5' } }, { clientActionId: 'stop', action: { kind: 'stop_move', movementCommandSeq: '6' } }] };
}

test('lateACK资格：拒绝Rejected、零轴、未跨DOWN、历史提前收束及迟到ACK不复活SE', () => {
  assert.equal(assertAcceptedLateEvidence(lateFixture()).qualified, true);
  const lateAccepted = lateFixture(); lateAccepted.submissions[0].submitReturnedAt = 1442;
  assert.equal(assertAcceptedLateEvidence(lateAccepted).southAcceptedBeforeAck, false);
  for (const change of [
    d => { d.selected.receipt.status = 'Rejected'; },
    d => { d.plan.path[1].x = d.plan.path[0].x; },
    d => { d.client.acknowledgements[0].wallAt = 1349; },
    d => { d.client.inputs[0].actions[0].status = 'accepted'; d.client.inputs[0].actions[0].receipt = d.selected.receipt; },
    d => { d.stored.push(structuredClone(d.stored[0])); },
    d => { d.selected.enteredAt = 1179; },
  ]) { const evidence = lateFixture(); change(evidence); assert.throws(() => assertAcceptedLateEvidence(evidence)); }
});

function fiveFixture() {
  const readers = Array.from({ length: 5 }, (_, index) => ({ initial: { viewId: 'view-' + index, controlEpoch: '2', snapshotSeq: '10' }, errors: [], dropped: 0,
    applications: [{ origin: 'push', result: 'applied', viewId: 'view-' + index, epoch: '2', before: '10', fromExclusive: '10', throughSeq: '11', after: '11', eventCount: 1, person: { moving: true, position: { x: 102, y: 102 }, motionTrail: [{ x: 100, y: 100 }, { x: 102, y: 102 }] } },
      { origin: 'sync', result: 'applied', viewId: 'view-' + index, epoch: '2', before: '11', fromExclusive: '11', throughSeq: '12', after: '12', eventCount: 1, person: { moving: false, position: { x: 104, y: 104 }, motionTrail: [{ x: 102, y: 102 }, { x: 104, y: 104 }] } }] }));
  return { readers, stop: { status: 'Accepted', observedSeq: '12' }, finalPosition: { x: 104, y: 104 },
    sends: readers.flatMap(reader => reader.applications.map(a => ({ origin: a.origin, viewId: a.viewId, fromExclusive: a.fromExclusive, throughSeq: a.throughSeq, sent: true }))) };
}

test('五人供给资格：必须真实连续应用运动及stop前缀，发送或终点快照不能替代', () => {
  assert.equal(assertFivePersonSupply(fiveFixture()).readers.length, 5);
  for (const change of [d => { d.readers[4].applications = []; }, d => { d.readers[3].applications[1].before = '10'; },
    d => { d.readers[2].applications[0].person.moving = false; }, d => { d.readers[1].applications[1].after = '11'; },
    d => { d.sends[0].sent = false; }, d => { d.readers[0].applications[1].viewId = 'new-view'; }]) {
    const evidence = fiveFixture(); change(evidence); assert.throws(() => assertFivePersonSupply(evidence));
  }
});

test('方向观察保持原this/全部参数/ACK回调返回与异常，明确区分sync/push实际应用', () => {
  const snapshot = spatialSnapshot(), view = new SpatialView(), generation = view.begin(snapshot.sessionId); view.acceptSnapshot(snapshot, generation);
  const state = shallowRef({ snapshot, actions: [] }), token = {}, extra = {}, target = new EventTarget(); let callback;
  class ControlledSocket {
    emit(...args) { assert.equal(this, socket); assert.equal(args[2], extra); callback = args.at(-1); return token; }
    emitEvent(...args) { assert.equal(this, socket); assert.equal(args[1], extra); return view.applyBatch(args[0][1], generation); }
  }
  const socket = new ControlledSocket(), original = ControlledSocket.prototype.emit;
  const observer = observeDirectionClient({ SpatialView, spatialState: state, inputTarget: target, SocketClass: ControlledSocket });
  try {
    observer.begin(snapshot.projection.self.entityRef);
    const first = spatialBatch(snapshot, '11');
    assert.equal(socket.emit('sync.request', JSON.stringify(view.syncRequest()), extra, function (...args) { assert.equal(this, token); assert.equal(args[2], extra); assert.equal(view.applyBatch(args[1], generation), 'applied'); return token; }), token);
    assert.equal(callback.call(token, null, first, extra), token);
    assert.equal(socket.emitEvent(['world.batch', spatialBatch(view.snapshot, '12')], extra), 'applied');
    const evidence = observer.read(); assert.deepEqual(evidence.applications.map(row => [row.origin, row.result, row.before, row.after]), [['sync', 'applied', '10', '11'], ['push', 'applied', '11', '12']]);
    socket.emit('sync.request', '{}', extra, () => { throw new Error('原回调错误'); }); assert.throws(() => callback(null, {}), /原回调错误/);
    assert.deepEqual(evidence.errors, []);
  } finally { observer.stop(); }
  assert.equal(ControlledSocket.prototype.emit, original);
});

test('冻结迟到选择：首次SE无论Rejected均不换样本，原submit只执行一次且其后延迟180', async () => {
  let time = 0, calls = 0; const handle = {}, tail = {}, receipt = { status: 'Rejected' };
  const runtime = { spatialSupply: { sync() { return Promise.resolve(); }, publish() { return Promise.resolve(); }, cursor() { return null; } },
    async submit(...args) { assert.equal(this, runtime); assert.equal(args[0], handle); assert.equal(args[2], tail); calls++; time += 10; return receipt; } };
  const observer = observeDirectionSubmissions(runtime, { late: true, now: () => time, delay: async ms => { time += ms; } });
  try {
    observer.mark('diagonal'); time = 180;
    const raw = id => JSON.stringify({ clientActionId: id, action: { kind: 'move_direction', direction: 'SE' } });
    assert.equal(await runtime.submit(handle, raw('first'), tail), receipt);
    assert.equal(observer.read().selected.request.clientActionId, 'first'); assert.equal(time, 370);
    await runtime.submit(handle, raw('later'), tail); assert.equal(time, 380); assert.equal(calls, 2);
    assert.equal(observer.read().selected.request.clientActionId, 'first'); assert.equal(observer.read().selected.ackReleasedAt - observer.read().selected.submitReturnedAt, 180);
  } finally { observer.close(); }
});

test('短按身份取证：受控原Receipt/事件起点检查不接受目标或客户端位置替代', async () => {
  const snapshot = spatialSnapshot(), self = snapshot.projection.self;
  const move = { kind: 'move_direction', sceneId: self.sceneId, mapVersion: snapshot.projection.mapVersion, direction: 'E', movementCommandSeq: '1' };
  const requests = [move, { kind: 'stop_move', movementCommandSeq: '2' }].map((action, index) => ({ schemaVersion: 2, sessionId: snapshot.sessionId, viewId: snapshot.viewId,
    actorRef: self.entityRef, controlEpoch: self.controlEpoch, clientActionId: 'tap-' + index, baseSeq: snapshot.snapshotSeq, action }));
  const receipts = requests.map((request, index) => ({ schemaVersion: 2, sessionId: request.sessionId, clientActionId: request.clientActionId, status: 'Accepted', code: 'OK', observedSeq: String(11 + index),
    actionEventRange: { first: String(11 + index), last: String(11 + index) }, result: index ? { movementCommandSeq: '2', status: 'cancelled' } : { movementId: 'move-1', planVersion: '1', movementCommandSeq: '1', status: 'accepted' } }));
  const drafts = requests.map((request, index) => ({ raw: JSON.stringify(request), receipt: receipts[index] }));
  const plan = { status: 'accepted', movementId: 'move-1', movementCommandSeq: '1', controlEpoch: self.controlEpoch, path: [{ x: 100, y: 100 }, { x: 136, y: 100 }] };
  const pool = { async query(sql, values) {
    assert.ok(sql.startsWith('SELECT '), '取证不得写数据库');
    if (sql.includes('action_receipts')) return { rows: [{ actor_id: 'actor', receipt: { publicReceipt: receipts[Number(values[1].at(-1))] } }] };
    return { rows: [{ event: { sessionSeq: '11', kind: 'spatial.actor', payload: { actor: { characterId: 'actor', movement: plan } } }, event_text_encoding: null }] };
  } };
  const basis = { sessionId: snapshot.sessionId, before: { actorId: 'actor', position: { x: 100, y: 100 }, controlEpoch: self.controlEpoch, sceneId: self.sceneId, mapVersion: snapshot.projection.mapVersion, movementStatus: null },
    clientStart: { x: 100, y: 100 }, clientEnd: { x: 104, y: 100 }, after: { position: { x: 104, y: 100 }, controlEpoch: self.controlEpoch } };
  assert.equal((await assertShortDirectionPlan(pool, drafts, basis)).pathDistance, 36);
  plan.path[0] = { x: 101, y: 100 }; await assert.rejects(assertShortDirectionPlan(pool, drafts, basis)); plan.path[0] = { x: 100, y: 100 };
  plan.path[1] = { x: 137, y: 100 }; await assert.rejects(assertShortDirectionPlan(pool, drafts, basis));
});
