import test from 'node:test';
import assert from 'node:assert/strict';
import { observeDirectionConnections, assertShortDirectionPlan, collectAcceptedLateEvidence, assertAcceptedLateEvidence, assertFivePersonSupply, observeDirectionSubmissions } from './direction-browser-support.mjs';
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

function lateFixture(lateMode = 'free-slot') {
  const snapshot = spatialSnapshot(), binding = { sessionId: snapshot.sessionId, viewId: snapshot.viewId, controlEpoch: '2' };
  const wall = at => 1000000 + at, full = lateMode === 'full-slots';
  const request = (id, direction, seq) => ({ schemaVersion: 2, ...binding, actorRef: snapshot.projection.self.entityRef,
    baseSeq: '10', clientActionId: id, action: direction === 'stop' ? { kind: 'stop_move', movementCommandSeq: String(seq) }
      : { kind: 'move_direction', sceneId: 'yard', mapVersion: 'gray-map-v1', direction, movementCommandSeq: String(seq) } });
  const receipt = r => ({ schemaVersion: 2, sessionId: r.sessionId, clientActionId: r.clientActionId, status: 'Accepted', code: 'OK',
    observedSeq: String(10 + Number(r.action.movementCommandSeq)), actionEventRange: { first: String(10 + Number(r.action.movementCommandSeq)), last: String(10 + Number(r.action.movementCommandSeq)) },
    result: { movementCommandSeq: r.action.movementCommandSeq, ...(r.action.kind === 'stop_move' ? { status: 'cancelled' } : { movementId: ('movement_' + r.clientActionId).padEnd(36, '0'), status: 'accepted' }) } });
  const specs = [['P', 'E', 1, 0, 1, 10, 10, 11], ['R', 'stop', 2, 20, 21, 30, 230, 231], ['A', 'SE', 3, 233, 234, 270, 450, 451],
    ...(full ? [['B', 'SE', 4, 333, 334, 350, 500, 501]] : []),
    ['S', 'S', full ? 5 : 4, full ? 453 : 261, full ? 454 : 262, full ? 480 : 290, full ? 480 : 290, full ? 481 : 291],
    ['stop', 'stop', full ? 6 : 5, 850, 851, 860, 860, 861]];
  const requests = [], acknowledgements = [], states = [], rows = [];
  for (const [id, direction, seq, send, entered, returned, released, ack] of specs) {
    const r = request(id, direction, seq), accepted = receipt(r);
    requests.push({ id, at: send, wallAt: wall(send), event: 'player.action.request', action: r.action, request: structuredClone(r) });
    acknowledgements.push({ id, at: ack, wallAt: wall(ack), error: null, receipt: structuredClone(accepted) });
    states.push({ id, at: send, wallAt: wall(send), status: 'waiting', receipt: null, ...binding },
      { id, at: ack + 0.5, wallAt: wall(ack + 0.5), status: 'accepted', receipt: structuredClone(accepted), ...binding });
    rows.push({ request: r, raw: canonicalize(r), receipt: accepted, enteredAt: wall(entered), submitStartedAt: wall(id === 'S' && !full ? 270 : entered),
      submitReturnedAt: wall(returned), ackReleasedAt: wall(released),
      ...(['R', 'A', 'B'].includes(id) ? { ackDeadlineAt: wall(released) } : {}) });
  }
  const byId = Object.fromEntries(rows.map(row => [row.request.clientActionId, row]));
  const proof = row => ({ stored: [{ actor_id: 'actor', semantic_digest: createHash('sha256').update(row.raw).digest('hex'), receipt: { publicReceipt: structuredClone(row.receipt) } }],
    acceptedEventSeq: row.receipt.observedSeq, plan: { status: 'accepted', movementId: row.receipt.result.movementId,
      movementCommandSeq: row.request.action.movementCommandSeq, controlEpoch: '2', path: [{ x: 100, y: 100 }, { x: 125, y: 125 }] } });
  const draft = (id, status) => ({ id, status, receipt: status === 'waiting' ? null : { status: 'Accepted', clientActionId: id } });
  const input = (type, key, phase, at, actions) => ({ type, key, phase, at, wallAt: wall(at), viewId: binding.viewId, epoch: '2', actions });
  const downAt = full ? 340 : 260;
  return { lateMode, binding, errors: [], startedAt: wall(0), preludeRightAt: wall(0), preludeStopAt: wall(20), diagonalAt: wall(40), downAt: wall(downAt), delayMs: 180,
    preludeDirection: byId.P, preludeStop: byId.R, selected: byId.A, second: full ? byId.B : null, ...proof(byId.A), secondEvidence: full ? proof(byId.B) : null,
    submissions: rows, movementRequests: rows.map(row => structuredClone(row.request)),
    client: { initial: { ...binding }, errors: [], dropped: 0, requests, acknowledgements, states, maxPendingDirections: 2, maxPendingStops: 1,
      inputs: [input('keydown', 'ArrowRight', 'prelude-right', 0, []), input('keyup', 'ArrowRight', 'prelude-stop', 20, []),
        input('keydown', 'ArrowRight', 'diagonal', 40, [draft('P', 'accepted'), draft('R', 'waiting')]),
        input('keydown', 'ArrowDown', 'diagonal', 45, [draft('P', 'accepted'), draft('R', 'waiting')]),
        input('keyup', 'ArrowRight', 'down-only', downAt, [draft('P', 'accepted'), draft('R', 'accepted'), draft('A', 'waiting'), ...(full ? [draft('B', 'waiting')] : [])])] } };
}

test('late-r2：空槽与满槽预先固定；A可在DOWN后真实提交，严格先后使用同一浏览器at时钟', () => {
  for (const mode of ['free-slot', 'full-slots']) {
    const evidence = lateFixture(mode); assert.equal(assertAcceptedLateEvidence(evidence).qualified, true);
    for (const rows of [evidence.client.inputs, evidence.client.requests, evidence.client.acknowledgements, evidence.client.states])
      for (const row of rows) row.wallAt = 7;
    assert.equal(assertAcceptedLateEvidence(evidence).qualified, true, 'Date.now相同不改变已记录的真实at先后');
  }
  const late = lateFixture(); late.submissions.find(row => row.request.clientActionId === 'S').submitReturnedAt = 1000460;
  assert.equal(assertAcceptedLateEvidence(late).southAcceptedBeforeAck, false);
});

test('late-r2前奏资格：P网络入站可晚于Node的stop标记，不附加20ms网络时限', () => {
  const evidence = lateFixture();
  Object.assign(evidence.preludeDirection, { enteredAt: 1000025, submitStartedAt: 1000025, submitReturnedAt: 1000028, ackReleasedAt: 1000028 });
  Object.assign(evidence.preludeStop, { enteredAt: 1000026, submitStartedAt: 1000028 });
  Object.assign(evidence.client.acknowledgements.find(row => row.id === 'P'), { at: 29, wallAt: 1000029 });
  Object.assign(evidence.client.states.find(row => row.id === 'P' && row.receipt), { at: 29.5, wallAt: 1000029.5 });
  assert.equal(assertAcceptedLateEvidence(evidence).qualified, true);
  evidence.preludeDirection.enteredAt = evidence.preludeStop.enteredAt + 1;
  assert.throws(() => assertAcceptedLateEvidence(evidence), 'P仍须是原同连接先入站的前驱');
});

test('late-r2负例：前置、槽位、原身份、库中双轴与全部实际请求缺一不可', () => {
  for (const mode of ['free-slot', 'full-slots']) {
    for (const change of [
      d => { d.errors.push('夹具超时'); },
      d => { d.preludeDirection.receipt.status = 'Rejected'; },
      d => { d.preludeStop.receipt.status = 'Rejected'; },
      d => { d.preludeStop.ackReleasedAt--; },
      d => { d.client.requests.find(row => row.id === 'A').at = 199; },
      d => { d.client.acknowledgements.find(row => row.id === 'R').at = 420; },
      d => { d.selected.receipt.status = 'Rejected'; },
      d => { d.selected.receipt.clientActionId = 'other'; },
      d => { d.selected.raw += ' '; },
      d => { d.binding.controlEpoch = '9'; },
      d => { d.plan.path[1].x = d.plan.path[0].x; },
      d => { d.stored.push(structuredClone(d.stored[0])); },
      d => { d.stored[0].semantic_digest = 'wrong'; },
      d => { d.client.inputs.at(-1).actions.find(row => row.id === 'A').status = 'unknown'; },
      d => { d.client.inputs.at(-1).actions.find(row => row.id === 'P').status = 'waiting'; },
      d => { d.client.inputs.at(-1).actions.push({ id: 'unrelated', status: 'unknown', receipt: null }); },
      d => { d.client.inputs.at(-1).epoch = 'old'; },
      d => { d.client.requests.push({ id: 'omitted', at: 600, wallAt: 1000600, action: { kind: 'stop_move' } }); },
      d => { d.client.requests.find(row => row.id === 'S').action.direction = 'SE'; },
      d => { d.submissions.at(-1).receipt.status = 'Rejected'; },
    ]) { const evidence = lateFixture(mode); change(evidence); assert.throws(() => assertAcceptedLateEvidence(evidence), mode + '必须拒绝破坏证据'); }
  }
  for (const change of [
    d => { d.client.requests.find(row => row.id === 'S').at = 451; },
    d => { d.second = structuredClone(d.selected); },
    d => { d.client.inputs.at(-1).actions.push({ id: 'B', status: 'waiting', receipt: null }); },
  ]) { const evidence = lateFixture(); change(evidence); assert.throws(() => assertAcceptedLateEvidence(evidence)); }
  for (const change of [
    d => { d.second = null; },
    d => { d.secondEvidence = null; },
    d => { d.second.receipt.status = 'Rejected'; },
    d => { d.secondEvidence.plan.path[1].y = d.secondEvidence.plan.path[0].y; },
    d => { d.secondEvidence.stored[0].actor_id = 'another'; },
    d => { d.client.inputs.at(-1).actions.find(row => row.id === 'B').receipt = d.second.receipt; },
    d => { d.client.requests.find(row => row.id === 'S').at = 450; },
    d => { d.client.states.find(row => row.id === 'A' && row.receipt).at = 454; },
    d => { d.client.acknowledgements.find(row => row.id === 'B').at = 450; },
    d => { d.second.ackReleasedAt = d.selected.ackReleasedAt + 49; },
  ]) { const evidence = lateFixture('full-slots'); change(evidence); assert.throws(() => assertAcceptedLateEvidence(evidence)); }
});

test('late-r2取证：A/B分别读取原身份持久Receipt和唯一Accepted事件，缺失或重复不能替代', async () => {
  const basis = lateFixture('full-slots'), queries = [];
  let duplicate = false;
  const pool = { async query(sql, values) {
    assert.ok(sql.startsWith('SELECT ')); queries.push({ sql, values });
    const row = [basis.selected, basis.second].find(row => sql.includes('action_receipts')
      ? row.request.clientActionId === values[1] : row.receipt.actionEventRange.first === values[1]);
    assert.ok(row, '只能读取预定A/B');
    const proof = row === basis.selected ? basis : basis.secondEvidence;
    if (sql.includes('action_receipts')) return { rows: structuredClone(proof.stored) };
    const event = { sessionSeq: proof.acceptedEventSeq, kind: 'spatial.actor', payload: { actor: { characterId: 'actor', movement: proof.plan } } };
    return { rows: Array.from({ length: duplicate && row === basis.second ? 2 : 1 }, () => ({ event: structuredClone(event), event_text_encoding: null })) };
  } };
  const observer = { read: () => basis };
  const evidence = await collectAcceptedLateEvidence(pool, observer, basis.client, basis.movementRequests);
  assert.equal(queries.length, 4); assert.deepEqual(evidence.secondEvidence, basis.secondEvidence); assert.equal(assertAcceptedLateEvidence(evidence).qualified, true);
  duplicate = true;
  const invalid = await collectAcceptedLateEvidence(pool, observer, basis.client, basis.movementRequests);
  assert.equal(invalid.secondEvidence.plan, null); assert.throws(() => assertAcceptedLateEvidence(invalid));
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

test('冻结迟到选择：预定首次SE无论Rejected均不换样本，原submit只执行一次且其后延迟180', async () => {
  let time = 0, calls = 0; const handle = {}, tail = {}, receipt = { status: 'Rejected' };
  const runtime = { spatialSupply: { sync() { return Promise.resolve(); }, publish() { return Promise.resolve(); }, cursor() { return null; } },
    async submit(...args) { assert.equal(this, runtime); assert.equal(args[0], handle); assert.equal(args[2], tail); calls++; time += 10; return receipt; } };
  const observer = observeDirectionSubmissions(runtime, { late: 'free-slot', now: () => time, delay: async ms => { time += ms; } });
  try {
    observer.armLate({ sessionId: 'session', viewId: 'view', controlEpoch: '2' });
    observer.mark('diagonal'); time = 180;
    const raw = id => JSON.stringify({ sessionId: 'session', viewId: 'view', controlEpoch: '2', clientActionId: id, action: { kind: 'move_direction', direction: 'SE' } });
    assert.equal(await runtime.submit(handle, raw('first'), tail), receipt);
    assert.equal(observer.read().selected.request.clientActionId, 'first'); assert.equal(time, 370);
    await runtime.submit(handle, raw('later'), tail); assert.equal(time, 380); assert.equal(calls, 2);
    assert.equal(observer.read().selected.request.clientActionId, 'first'); assert.equal(observer.read().selected.ackReleasedAt - observer.read().selected.submitReturnedAt, 180);
  } finally { observer.close(); }
});

const flushSubmissions = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function submissionClock() {
  let at = 0; const timers = [];
  return { now: () => at, delay: ms => new Promise(resolve => timers.push({ at: at + ms, resolve })),
    async advance(to) {
      while (true) {
        timers.sort((a, b) => a.at - b.at);
        if (!timers.length || timers[0].at > to) break;
        const timer = timers.shift(); at = timer.at; timer.resolve(); await flushSubmissions();
      }
      at = to; await flushSubmissions();
    } };
}
function submissionFixture(late = 'free-slot') {
  const clock = submissionClock(), calls = [], pending = new Map(), handle = {}, tail = {};
  const binding = { sessionId: 'session', viewId: 'view', controlEpoch: '2' };
  const runtime = { spatialSupply: { sync: async () => {}, publish: async () => {}, cursor: () => null },
    submit(...args) {
      assert.equal(this, runtime); assert.equal(args[0], handle); assert.equal(args[2], tail);
      const request = JSON.parse(args[1]), gate = Promise.withResolvers();
      calls.push({ id: request.clientActionId, at: clock.now(), args }); pending.set(request.clientActionId, gate); return gate.promise;
    } };
  const original = runtime.submit, observer = observeDirectionSubmissions(runtime, { late, ...clock }); observer.armLate(binding);
  const send = (id, direction, changes = {}) => runtime.submit(handle, JSON.stringify({ ...binding, ...changes, clientActionId: id,
    action: direction === 'stop' ? { kind: 'stop_move' } : { kind: 'move_direction', direction } }), tail);
  const finish = async (id, receipt = { clientActionId: id, status: 'Accepted' }) => { pending.get(id).resolve(receipt); await flushSubmissions(); return receipt; };
  return { clock, calls, pending, observer, runtime, original, send, finish };
}

test('late前置：P→R只排序真实提交，R原Receipt固定扣留200ms并保留this/全部参数', async () => {
  const f = submissionFixture();
  try {
    f.observer.mark('prelude-right'); const p = f.send('P', 'E'); await flushSubmissions();
    await f.clock.advance(20); f.observer.mark('prelude-stop'); let returned = false;
    const r = f.send('R', 'stop').then(value => { returned = true; return value; }); await flushSubmissions();
    assert.deepEqual(f.calls.map(x => x.id), ['P']);
    await f.clock.advance(30); const pReceipt = await f.finish('P'); assert.equal(await p, pReceipt);
    assert.deepEqual(f.calls.map(x => [x.id, x.at]), [['P', 0], ['R', 30]]);
    await f.clock.advance(40); const rReceipt = await f.finish('R');
    await f.clock.advance(239); assert.equal(returned, false);
    await f.clock.advance(240); assert.equal(await r, rReceipt);
    assert.equal(f.observer.read().preludeStop.ackReleasedAt, 240); assert.deepEqual(f.observer.read().errors, []);
  } finally { f.observer.close(); }
  assert.equal(f.runtime.submit, f.original);
});

test('late前置：mark stop后首E才入站仍固定为P，R等待其原提交收束', async () => {
  const f = submissionFixture();
  try {
    f.observer.mark('prelude-right'); await f.clock.advance(20); f.observer.mark('prelude-stop');
    await f.clock.advance(25); const p = f.send('P', 'E'); await flushSubmissions();
    assert.equal(f.observer.read().preludeDirection?.request.clientActionId, 'P');
    await f.clock.advance(26); const r = f.send('R', 'stop'); await flushSubmissions(); assert.deepEqual(f.calls.map(row => row.id), ['P']);
    await f.clock.advance(28); await f.finish('P'); await p;
    assert.deepEqual(f.calls.map(row => [row.id, row.at]), [['P', 25], ['R', 28]]);
    await f.clock.advance(30); const receipt = await f.finish('R');
    await f.clock.advance(230); assert.equal(await r, receipt); assert.deepEqual(f.observer.read().errors, []);
  } finally { f.observer.close(); }
});

test('late空槽：后继只等A原提交，不等180ms ACK；独立stop始终直接进入原提交', async () => {
  const f = submissionFixture();
  try {
    f.observer.mark('diagonal'); const a = f.send('A', 'SE'); await flushSubmissions();
    await f.clock.advance(20); f.observer.mark('down-only'); const s = f.send('S', 'S'); await flushSubmissions();
    const stop = f.send('stop', 'stop'); await flushSubmissions(); assert.deepEqual(f.calls.map(x => x.id), ['A', 'stop']);
    const stopReceipt = await f.finish('stop'); assert.equal(await stop, stopReceipt);
    await f.clock.advance(40); const aReceipt = await f.finish('A');
    assert.deepEqual(f.calls.map(x => [x.id, x.at]), [['A', 0], ['stop', 20], ['S', 40]]);
    const sReceipt = await f.finish('S'); assert.equal(await s, sReceipt);
    assert.equal(f.observer.read().selected.ackReleasedAt, undefined);
    await f.clock.advance(220); assert.equal(await a, aReceipt); assert.deepEqual(f.observer.read().errors, []);
  } finally { f.observer.close(); }
});

test('late满槽：B按max(真实返回,A实际释放+50)放回，既不等S也不从迟到返回另加50', async t => {
  for (const returnedAt of [130, 300]) await t.test('B真实返回于' + returnedAt, async () => {
    const f = submissionFixture('full-slots');
    try {
      f.observer.mark('diagonal'); const a = f.send('A', 'SE'); await flushSubmissions();
      await f.clock.advance(20); const aReceipt = await f.finish('A');
      await f.clock.advance(100); let returned = false;
      const b = f.send('B', 'SE').then(value => { returned = true; return value; }); await flushSubmissions();
      if (returnedAt > 200) { await f.clock.advance(200); assert.equal(await a, aReceipt); }
      await f.clock.advance(returnedAt); const bReceipt = await f.finish('B');
      if (returnedAt < 200) { await f.clock.advance(200); assert.equal(await a, aReceipt); }
      const expected = Math.max(returnedAt, 250);
      if (expected > returnedAt) { await f.clock.advance(expected - 1); assert.equal(returned, false); }
      await f.clock.advance(expected); assert.equal(await b, bReceipt);
      assert.equal(f.observer.read().second.request.clientActionId, 'B'); assert.equal(f.observer.read().second.ackReleasedAt, expected);
      assert.deepEqual(f.observer.read().errors, []);
    } finally { f.observer.close(); }
  });
});

test('late等待前驱400ms到期及cleanup均放开原提交，原Receipt/异常透传且失败记录不清除', async t => {
  for (const close of [false, true]) await t.test(close ? 'cleanup解除等待' : '前驱入站400ms上界', async () => {
    const f = submissionFixture();
    f.observer.mark('diagonal'); const a = f.send('A', 'SE'); await flushSubmissions();
    await f.clock.advance(10); f.observer.mark('down-only'); const s = f.send('S', 'S'); await flushSubmissions();
    assert.deepEqual(f.calls.map(x => x.id), ['A']);
    if (close) { f.observer.close(); await flushSubmissions(); } else await f.clock.advance(400);
    assert.deepEqual(f.calls.map(x => x.id), ['A', 'S']); const sReceipt = await f.finish('S'); assert.equal(await s, sReceipt);
    assert.ok(f.observer.read().errors.length > 0); const errors = [...f.observer.read().errors];
    const originalError = new Error('原A事务错误'); f.pending.get('A').reject(originalError);
    await assert.rejects(a, error => error === originalError); f.observer.close();
    for (const error of errors) assert.ok(f.observer.read().errors.includes(error)); assert.equal(f.runtime.submit, f.original);
  });
});

test('late绑定与模式：外绑定不选样不扣留，一次arm不可换绑定，非late透明透传', async () => {
  const f = submissionFixture();
  try {
    assert.throws(() => f.observer.armLate({ sessionId: 'another', viewId: 'view', controlEpoch: '2' }));
    f.observer.mark('diagonal'); const request = f.send('foreign', 'SE', { controlEpoch: '9' }); await flushSubmissions();
    const receipt = await f.finish('foreign'); assert.equal(await request, receipt); assert.equal(f.observer.read().selected, null);
    assert.deepEqual(f.observer.read().errors, []);
  } finally { f.observer.close(); }
  const value = {}, args = [{}, '{}', {}], runtime = { spatialSupply: { sync: async () => {}, publish: async () => {}, cursor: () => null },
    async submit(...actual) { assert.equal(this, runtime); assert.deepEqual(actual, args); return value; } };
  args[1] = JSON.stringify({ action: { kind: 'stop_move' } });
  const observer = observeDirectionSubmissions(runtime);
  try { assert.equal(await runtime.submit(...args), value); assert.equal(observer.read().delayMs, 0); assert.throws(() => observer.armLate({})); }
  finally { observer.close(); }
});

test('late满槽：后继S不额外等待B原事务，B原异常也保持原异常身份', async () => {
  const f = submissionFixture('full-slots');
  try {
    f.observer.mark('diagonal'); const a = f.send('A', 'SE'); await flushSubmissions();
    await f.clock.advance(20); await f.finish('A');
    await f.clock.advance(100); const b = f.send('B', 'SE'); await flushSubmissions();
    await f.clock.advance(200); await a; f.observer.mark('down-only'); const s = f.send('S', 'S'); await flushSubmissions();
    assert.deepEqual(f.calls.map(x => [x.id, x.at]), [['A', 0], ['B', 100], ['S', 200]]);
    const sReceipt = await f.finish('S'); assert.equal(await s, sReceipt);
    const originalError = new Error('原B事务错误'); f.pending.get('B').reject(originalError); await assert.rejects(b, error => error === originalError);
  } finally { f.observer.close(); }
});

test('late cleanup：B已取得原Receipt但等待A ACK时，清理解除A/B扣留并保留原Receipt', async () => {
  const f = submissionFixture('full-slots');
  f.observer.mark('diagonal'); const a = f.send('A', 'SE'); await flushSubmissions();
  await f.clock.advance(20); const aReceipt = await f.finish('A');
  await f.clock.advance(100); const b = f.send('B', 'SE'); await flushSubmissions(); const bReceipt = await f.finish('B');
  f.observer.close(); await flushSubmissions();
  assert.equal(await a, aReceipt); assert.equal(await b, bReceipt); assert.ok(f.observer.read().errors.length > 0);
  assert.equal(f.runtime.submit, f.original);
});

test('late满槽：B等待A释放以A入站+400为界，超时仍返回B原Receipt并锁定失败', async () => {
  const f = submissionFixture('full-slots');
  f.observer.mark('diagonal'); const a = f.send('A', 'SE'); await flushSubmissions();
  await f.clock.advance(100); const b = f.send('B', 'SE'); await flushSubmissions();
  await f.clock.advance(300); const aReceipt = await f.finish('A');
  await f.clock.advance(310); const bReceipt = await f.finish('B');
  await f.clock.advance(400); assert.equal(await b, bReceipt); assert.equal(f.observer.read().selected.ackReleasedAt, undefined);
  assert.ok(f.observer.read().errors.some(error => error.includes('400ms')));
  f.observer.close(); assert.equal(await a, aReceipt);
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
