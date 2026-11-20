import assert from 'node:assert/strict';
import test from 'node:test';
import { observeExit, beginExitObservation, markExitObservation, finishExitObservation, combineExitObservation } from './spatial-exit-observation.mjs';
import { visibleSelf } from '../src/rendering/spatial-presentation.ts';

// 受控DOM/帧与方法替身，只验证测试观察器透明性；不是浏览器、世界或真实paint验收。
function fixture(options = {}) {
  const invocations = [], failure = new Error('原方法异常'), promise = Promise.resolve('原Promise');
  const state = { connection: 'online', inputReady: true, timedTrail: false, queuedAction: '到达后重新检查并操作', navigation: null,
    snapshot: { sessionId: 's', viewId: 'v', snapshotSeq: '8', projection: { sceneTimeMs: 1000, mapVersion: 'map', phase: 'Running', paused: false,
      self: { entityRef: 'self', controlEpoch: '3', sceneId: 'yard', position: { x: 560, y: 80 }, canControl: true, movementCommandHighWater: '6' },
      movement: { movementId: 'approach', movementCommandSeq: '6', status: 'arrived' }, entities: [],
      scene: { exits: [{ exitId: 'to-road', anchorId: 'yard-exit', destinationSceneId: 'road', destination: { x: 60, y: 80 }, open: true }] } } },
    actions: [{ id: 'a', raw: '{\n  "action": {"kind":"move_to","movementCommandSeq":"6"}\n}', status: 'waiting', receipt: null, detail: '原状态' }],
    token: '不得记录的认证信息' };
  const bounds = { left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 };
  const style = { display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible' };
  const doc = { hidden: false, visibilityState: 'visible' };
  const win = { innerWidth: 1600, innerHeight: 1000, scrollX: 0, scrollY: 0, getComputedStyle: () => style }; doc.defaultView = win;
  const canvas = { tagName: 'CANVAS', ownerDocument: doc, isConnected: true, parentElement: null,
    getBoundingClientRect: () => bounds, getClientRects: () => [bounds] };
  const frame = { instance: 'canvas-one', serial: 9, sceneId: 'yard', viewport: { width: 1200, height: 800 }, view: { x: 0, y: 0, width: 1200, height: 800 },
    fit: { x: 0, y: 0, scale: 1 }, actors: [{ ref: 'self', position: { x: 560, y: 80 }, moving: false, distance: 3, facing: 'N' }] };
  const invoked = (kind, owner, args, result) => { invocations.push({ kind, owner, args }); if (owner.fail) throw failure; return result; };
  class Motion {
    presentationCreditMs = 0;
    update(...args) { return invoked('update', this, args, frame); }
    hasPendingMotion(...args) { return invoked('hasPendingMotion', this, args, false); }
    settled(...args) { return invoked('settled', this, args, true); }
    presentSelf(...args) { return invoked('presentSelf', this, args, false); }
    sealPresentation(...args) { return invoked('sealPresentation', this, args); }
    invalidatePresentation(...args) { return invoked('invalidatePresentation', this, args); }
    reset(...args) { return invoked('reset', this, args); }
  }
  class Canvas { paint(...args) { return invoked('paint', this, args, frame); } }
  class Owner { painted(...args) { return invoked('painted', this, args, false); } seal(...args) { return invoked('seal', this, args); } invalidate(...args) { return invoked('invalidate', this, args); } }
  class Client {
    get state() { if (this.stateFailure) throw new Error('观察读取失败'); return state; }
    traverseExit(...args) { return invoked('traverseExit', this, args, promise); }
    confirmDisplayedArrival(...args) { return invoked('confirmDisplayedArrival', this, args, promise); }
  }
  const dependencies = { ConfirmedMotion: Motion, SpatialCanvas: Canvas, CanvasPresentationOwner: Owner, SpatialSessionClient: Client,
    readCanvasFrame: () => structuredClone(frame), visibleSelf };
  let time = 10;
  const observer = observeExit(dependencies, { metadata: { exitId: 'to-road' }, readState: () => state,
    getCanvas: () => canvas, document: doc, window: win, now: () => time++, wall: () => 1000 + time, timeOrigin: 900, ...options });
  return { observer, dependencies, Motion, Canvas, Owner, Client, state, canvas, frame, bounds, doc, win, style, failure, promise, invocations };
}

test('EXIT-OBS-01：实际调用恰一次，this/所有参数/返回对象与Promise原样保留', () => {
  const f = fixture(), motion = new f.Motion(), painter = new f.Canvas(), client = new f.Client(), marker = {};
  try {
    assert.equal(f.invocations.length, 0, '安装不能制造原调用');
    assert.equal(motion.hasPendingMotion('self', 100, marker), false);
    assert.equal(motion.settled('self', 101, marker), true);
    assert.equal(painter.paint(f.state.snapshot, motion, 102, marker), f.frame);
    assert.equal(client.traverseExit('to-road', marker), f.promise);
    const arrival = { movementId: 'approach', sequence: '6' };
    assert.equal(client.confirmDisplayedArrival(arrival, marker), f.promise);
    assert.equal(f.invocations.length, 5);
    assert.equal(f.invocations[0].owner, motion); assert.deepEqual(f.invocations[0].args, ['self', 100, marker]);
    assert.equal(f.invocations[2].owner, painter); assert.equal(f.invocations[2].args[0], f.state.snapshot); assert.equal(f.invocations[2].args[3], marker);
    assert.equal(f.invocations[4].owner, client); assert.equal(f.invocations[4].args[0], arrival); assert.equal(f.invocations[4].args[1], marker);
    assert.equal(f.observer.read().calls.filter(row => row.kind === 'paint').length, 1);
    assert.equal(f.observer.read().calls.find(row => row.kind === 'paint').geometry.currentCanvasFrameMatches, true);
    assert.equal(f.observer.read().calls.find(row => row.kind === 'paint').motionObject, f.observer.read().calls.find(row => row.kind === 'hasPendingMotion').exitObserverObject);
    assert.ok(f.observer.read().calls.every(row => row.originalEnteredAt <= row.originalReturnedAt && row.originalReturnedAt <= row.finishedAt));
  } finally { f.observer.stop(); }
});

test('EXIT-OBS-02：既有帧读取与原始Receipt变化可追溯，但不制造调用/信用或私有队列身份', () => {
  const f = fixture();
  try {
    f.observer.sample('before-click'); f.observer.sample('poll'); f.observer.sample('poll');
    assert.equal(f.observer.read().samples.length, 1, '不变poll不扩记录');
    f.state.actions[0].status = 'accepted'; f.state.actions[0].receipt = { status: 'Accepted', result: { movementId: 'approach' } };
    f.observer.sample('poll');
    const value = f.observer.read(); assert.equal(value.drafts.length, 2); assert.equal(value.drafts[0].raw, f.state.actions[0].raw);
    assert.deepEqual(value.drafts[1].receipt, f.state.actions[0].receipt); assert.equal(value.calls.length, 0); assert.equal(value.presentation.calls.length, 0);
    assert.equal(f.invocations.length, 0); assert.equal(value.samples[0].geometry.kind, 'read-existing-frame');
    assert.equal(value.samples[0].state.queuedAction, f.state.queuedAction); assert.match(value.samples[0].state.privateQueueIdentity, /unavailable/);
    assert.equal(JSON.stringify(value).includes(f.state.token), false);
  } finally { f.observer.stop(); }
});

test('EXIT-OBS-03：使用生产只读可见性判定，hidden/离屏/祖先裁剪不会被旧截图冒充可见paint', () => {
  const f = fixture();
  try {
    f.observer.sample('before-click'); assert.equal(f.observer.read().samples.at(-1).geometry.visibleSelf, true);
    f.doc.hidden = true; f.observer.sample('poll'); assert.equal(f.observer.read().samples.at(-1).geometry.visibleSelf, false);
    f.doc.hidden = false; f.bounds.top = -500; f.bounds.bottom = 300; f.win.scrollY = 500;
    f.observer.sample('poll'); assert.equal(f.observer.read().samples.at(-1).geometry.screen.y, -420); assert.equal(f.observer.read().samples.at(-1).geometry.visibleSelf, false);
    f.bounds.top = 0; f.bounds.bottom = 800;
    const parent = { tagName: 'DIV', parentElement: null, getBoundingClientRect: () => ({ ...f.bounds, top: 200 }) };
    f.canvas.parentElement = parent; f.win.getComputedStyle = node => node === parent ? { ...f.style, overflowY: 'hidden' } : f.style;
    f.observer.sample('poll'); assert.equal(f.observer.read().samples.at(-1).geometry.visibleSelf, false);
    assert.equal(f.invocations.length, 0, '可见性读取不调用paint或信用方法');
  } finally { f.observer.stop(); }
});

test('EXIT-OBS-04：原异常对象保留，观测错误不能替代产品返回或抛错', () => {
  const f = fixture(), client = new f.Client(), painter = new f.Canvas();
  try {
    client.stateFailure = true;
    assert.equal(client.confirmDisplayedArrival({ sequence: '6' }), f.promise);
    client.fail = true;
    assert.throws(() => client.confirmDisplayedArrival({ sequence: '6' }), error => error === f.failure);
    f.canvas.getBoundingClientRect = () => { throw new Error('布局读取失败'); };
    assert.equal(painter.paint(f.state.snapshot, new f.Motion(), 100), f.frame);
    painter.fail = true; assert.throws(() => painter.paint(f.state.snapshot, new f.Motion(), 100), error => error === f.failure);
    assert.equal(f.invocations.length, 4); assert.ok(f.observer.read().errors.some(value => value.includes('观察读取失败')));
    assert.ok(f.observer.read().errors.some(value => value.includes('布局读取失败')));
  } finally { f.observer.stop(); }
});

test('EXIT-OBS-05：所有缓冲有界且截断显式可见，停止后恢复原方法且不继续记录', () => {
  const f = fixture({ sampleLimit: 2, callLimit: 2 }), motion = new f.Motion();
  for (let i = 0; i < 5; i++) { f.state.snapshot.snapshotSeq = String(i); f.state.actions[0].detail = String(i); f.observer.sample('poll'); motion.hasPendingMotion('self', i); }
  const value = f.observer.stop(); assert.equal(value.samples.length, 2); assert.equal(value.drafts.length, 2); assert.equal(value.calls.length, 2);
  assert.ok(value.sampleDropped > 0); assert.ok(value.callDropped > 0);
  const count = value.calls.length; motion.hasPendingMotion('self', 10); f.observer.sample('after-stop'); f.observer.stop();
  assert.equal(value.calls.length, count); assert.equal(f.invocations.length, 6);
});

test('EXIT-OBS-06：重复安装/停止不叠调用，恢复时保留后装的外层方法', () => {
  const f = fixture(); f.observer.stop();
  const second = observeExit(f.dependencies, { readState: () => f.state, getCanvas: () => f.canvas, document: f.doc, window: f.win });
  const observed = f.Client.prototype.traverseExit;
  function external(...args) { return Reflect.apply(observed, this, args); }
  f.Client.prototype.traverseExit = external; second.stop();
  assert.equal(f.Client.prototype.traverseExit, external); assert.equal(new f.Client().traverseExit('to-road'), f.promise);
  assert.equal(f.invocations.length, 1);
});

test('EXIT-OBS-07：安装/收集失败只形成诊断错误，不调用页面操作或冒充已采证据', async () => {
  const failure = new Error('页面读失败'); let reads = 0;
  const page = { async evaluate() { reads++; throw failure; } };
  const handle = await beginExitObservation(page, { exitId: 'to-road' });
  assert.equal(reads, 1); assert.deepEqual(handle.observationErrors, ['页面读失败']);
  markExitObservation(handle, 'click-returned'); assert.equal(reads, 1, '返回边界不增加浏览器RPC');
  const result = await finishExitObservation(page, handle); assert.equal(reads, 2); assert.equal(result.browser, null); assert.equal(result.observationError, '页面读失败');
  assert.ok(handle.node.every(row => row.domain === 'node-performance'));
  assert.equal(combineExitObservation(handle, null, failure).observationError, '页面读失败');
});
