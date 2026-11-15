import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { SpatialSessionClient } from '../src/network/spatial-session.ts';
import { directionClock, directionFromKeys, directionKeys } from '../src/domain/spatial-direction.ts';
import { spatialBatch, spatialSnapshot } from './spatial-fixture.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
// 执行真实 SFC 的键处理函数和真实网络客户端；仅替换时间、DOM目标与收据传输。
const source = await readFile(new URL('../src/features/world/SpatialMap.vue', import.meta.url), 'utf8');
const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1]; assert.ok(script);
const parsed = ts.createSourceFile('SpatialMap.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const functions = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && ['releaseKeys', 'blockedTarget', 'keydown', 'keyup', 'hidden', 'blur'].includes(node.name?.text));
assert.equal(functions.length, 6);
const keyboardCode = ts.transpileModule(functions.map(node => node.getText(parsed)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;

async function keyboardRoom(t, { holdFirstMove = false } = {}) {
  let now = 0, next = 0, handlers, finishStop, failStop, finishMove, failMove, queriedStop = null;
  const jobs = new Map(), requests = [];
  const originalClock = { ...directionClock };
  Object.assign(directionClock, {
    now: () => now,
    setTimeout(callback, delay) { const id = ++next; jobs.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { jobs.delete(id); },
  });
  const initial = spatialSnapshot(); initial.projection.self.canControl = false;
  const accepted = request => ({ schemaVersion: 2, sessionId: request.sessionId, clientActionId: request.clientActionId, status: 'Accepted', code: 'OK', observedSeq: '10', actionEventRange: null,
    result: request.action.kind === 'move_to' ? { movementId: 'move_' + request.action.movementCommandSeq.padStart(31, '0'), planVersion: request.action.movementCommandSeq, movementCommandSeq: request.action.movementCommandSeq, status: 'accepted' } : { status: 'cancelled' } });
  const link = { connected: true, close() {}, async request(event, raw) {
    if (event === 'session.subscribe') return structuredClone(initial);
    const request = JSON.parse(raw);
    if (event === 'sync.request') return { schemaVersion: 2, type: 'world.batch', sessionId: request.sessionId, viewId: request.viewId, fromExclusive: request.cursor, throughSeq: request.cursor, events: [] };
    if (event.startsWith('control.')) {
      const snapshot = spatialSnapshot(); snapshot.viewId = 'control-view'; snapshot.projection.self.controlEpoch = '3';
      return { schemaVersion: 2, sessionId: request.sessionId, nonce: request.nonce, controlEpoch: '3', observedSeq: snapshot.snapshotSeq, snapshot };
    }
    requests.push({ at: now, raw, request });
    if (request.action.kind === 'stop_move') return new Promise((resolve, reject) => {
      finishStop = () => resolve(accepted(request)); failStop = () => reject(new Error('停步 ACK 丢失'));
    });
    if (holdFirstMove && !finishMove) return new Promise((resolve, reject) => {
      finishMove = () => resolve(accepted(request)); failMove = () => reject(new Error('移动 ACK 丢失'));
    });
    return accepted(request);
  } };
  const client = new SpatialSessionClient({ receipt: async () => queriedStop }, (_token, callbacks) => { handlers = callbacks; return link; }, { heartbeatMs: 0, reconnectDelayMs: 0 });
  t.after(() => { client.close(); Object.assign(directionClock, originalClock); });
  client.open('spatial-room', 'token'); handlers.connected(); await flush(); await client.control('resume');
  class Element { closest() { return null; } }
  const world = new Element(), document = { hidden: false }, props = { disabled: false };
  const keyboard = new Function('bindings', `const {props, canvas, projection, emit, directionFromKeys, directionKeys, Element, document}=bindings; const held=new Set(); ${keyboardCode}; return {keydown,keyup,blur,hidden,held};`)({
    props, canvas: { value: world }, projection: { get value() { return client.state.snapshot.projection; } }, Element, document, directionFromKeys, directionKeys,
    emit(kind, value) { if (kind === 'direction') client.setDirection(value); else if (kind === 'stop') void client.stop(); },
  });
  return {
    client, requests, keyboard, document, props, handlers,
    down(key, repeat = false) { keyboard.keydown({ key, repeat, isComposing: false, target: world, preventDefault() {} }); },
    up(key) { keyboard.keyup({ key, target: world, preventDefault() {} }); },
    async acknowledgeStop() { assert.ok(finishStop); finishStop(); await flush(); },
    async loseStopAck() { assert.ok(failStop); failStop(); await flush(); },
    async acknowledgeMove() { assert.ok(finishMove); finishMove(); await flush(); },
    async loseMoveAck() { assert.ok(failMove); failMove(); await flush(); },
    async queryStop() {
      const stop = requests.find(value => value.request.action.kind === 'stop_move').request;
      queriedStop = accepted(stop); await client.query(stop.clientActionId); await flush();
    },
    async advance(through) {
      while (true) {
        const entry = [...jobs].sort((a, b) => a[1].at - b[1].at).find(([, job]) => job.at <= through);
        if (!entry) break;
        jobs.delete(entry[0]); now = entry[1].at; entry[1].callback(); await flush();
      }
      now = through; await flush();
    },
  };
}

test('R66-INPUT-001：真实键回调经网络客户端，在正常stop确认后恢复仍按住的方向', async t => {
  const h = await keyboardRoom(t);
  h.down('ArrowRight'); await flush(); await h.advance(50);
  h.down('ArrowLeft'); await flush(); await h.advance(70);
  h.up('ArrowLeft'); await flush();
  assert.deepEqual(h.requests.map(value => value.request.action.kind), ['move_to', 'stop_move'], 'stop未决期间只合并方向，不续发');
  await h.advance(100); await h.acknowledgeStop();
  for (const at of [150, 250, 350, 450, 550, 650]) { await h.advance(at); h.down('ArrowRight', true); }
  assert.deepEqual([...h.keyboard.held], ['ArrowRight']);
  const resumed = h.requests.filter(value => value.at >= 100 && value.request.action.kind === 'move_to');
  assert.ok(resumed.length > 0, '正常stop ACK后应恢复当前合成方向，不要求重新松按Right');
  assert.ok(resumed.every(value => value.request.action.destination.x > 100 && value.request.action.destination.y === 100));
  assert.ok(h.requests.filter(value => value.request.action.kind === 'move_to').length <= 8, 'repeat不增加调度频率');
  const stopSequence = BigInt(h.requests[1].request.action.movementCommandSeq);
  assert.ok(resumed.every(value => BigInt(value.request.action.movementCommandSeq) > stopSequence), '恢复续发分配新的更高序号，不重放旧move');
});

async function waitWithRightHeld(h) {
  h.down('ArrowRight'); await flush(); await h.advance(50);
  h.down('ArrowLeft'); await flush(); await h.advance(70);
  h.up('ArrowLeft'); await flush();
}

test('R66-INPUT-001：stop 未决只保存最新合成方向，不回放中间按键', async t => {
  const h = await keyboardRoom(t); await waitWithRightHeld(h);
  h.down('ArrowUp'); h.up('ArrowRight'); await flush();
  assert.equal(h.requests.length, 2);
  await h.advance(100); await h.acknowledgeStop();
  assert.equal(h.requests.length, 3);
  assert.deepEqual(h.requests[2].request.action.destination, { x: 100, y: 64 });
});

test('R66-INPUT-001：松开全部、失焦、隐藏、接管或控制失效后，旧stop确认不恢复持键', async t => {
  for (const change of ['全部松开', '失焦', '隐藏', '明确取消', '控制周期变化', '控制丢失', '断线']) await t.test(change, async t => {
    const h = await keyboardRoom(t); await waitWithRightHeld(h);
    if (change === '全部松开') h.up('ArrowRight');
    else if (change === '失焦') h.keyboard.blur();
    else if (change === '隐藏') { h.document.hidden = true; h.keyboard.hidden(); }
    else if (change === '明确取消') h.client.cancelQueued();
    else if (change === '断线') h.handlers.disconnected();
    else {
      const snapshot = structuredClone(h.client.state.snapshot);
      if (change === '控制周期变化') snapshot.projection.self.controlEpoch = '4';
      else snapshot.projection.self.canControl = false;
      h.handlers.batch(spatialBatch(snapshot, String(BigInt(snapshot.snapshotSeq) + 1n)));
    }
    await flush(); await h.advance(100); await h.acknowledgeStop(); await h.advance(650);
    assert.deepEqual(h.requests.map(value => value.request.action.kind), ['move_to', 'stop_move']);
  });
});

test('R66-INPUT-001：未知stop保留原请求并冻结，查询成功也不恢复此前持键', async t => {
  const h = await keyboardRoom(t); await waitWithRightHeld(h);
  const originalStop = h.requests[1];
  await h.advance(100); await h.loseStopAck();
  h.down('ArrowUp'); await h.advance(650);
  assert.equal(h.requests.length, 2);
  assert.equal(h.client.state.actions[1].status, 'unknown');
  assert.equal(h.client.state.actions[1].raw, originalStop.raw);
  await h.queryStop(); await h.advance(1000);
  assert.equal(h.client.state.actions[1].status, 'accepted');
  assert.equal(h.requests.length, 2, '查询原收据只解除未知状态，不重放旧持键');
  h.keyboard.blur(); h.down('ArrowRight'); await flush();
  assert.equal(h.requests.length, 3, '确认后明确重新按键才开始新的移动');
});

test('R66-INPUT-001：stop先确认仍等待旧move，旧move变未知时不可自动绕过冻结', async t => {
  for (const outcome of ['确认', '未知']) await t.test(outcome, async t => {
    const h = await keyboardRoom(t, { holdFirstMove: true }); await waitWithRightHeld(h);
    await h.advance(100); await h.acknowledgeStop(); await h.advance(120);
    assert.equal(h.requests.length, 2, '旧move尚未返回时不能创建第二个move');
    if (outcome === '确认') await h.acknowledgeMove();
    else await h.loseMoveAck();
    await h.advance(250);
    const moves = h.requests.filter(value => value.request.action.kind === 'move_to');
    assert.equal(moves.length, outcome === '确认' ? 3 : 1, '旧move未知时，自动恢复须遵守手动输入相同的冻结守卫');
    if (outcome === '未知') assert.equal(h.client.state.actions[0].status, 'unknown');
  });
});

test('R66-INPUT-001：stop超过确认期限后，即使迟到成功也不恢复旧持键', async t => {
  const h = await keyboardRoom(t); await waitWithRightHeld(h);
  await h.advance(450); assert.match(h.client.state.message, /停步确认延迟/);
  await h.advance(500); await h.acknowledgeStop();
  h.down('ArrowRight', true); await h.advance(1000);
  assert.equal(h.requests.length, 2);
  h.up('ArrowRight'); h.down('ArrowRight'); await flush();
  assert.equal(h.requests.length, 3, '迟到确认后新的按键可开始新一段');
});
