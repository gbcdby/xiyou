import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { ConfirmedMotion } from '../src/domain/spatial-motion.ts';
import { createSpatialSnapshotSource } from '../src/domain/spatial-snapshot-source.ts';
import * as presentationModule from '../src/rendering/spatial-presentation.ts';
import { spatialSnapshot, selfRef } from './spatial-fixture.mjs';

// 真实 SFC draw + Motion/Source，DOM和绘图返回为明确受控替身；不是Canvas验收。
const source = await readFile(new URL('../src/features/world/SpatialMap.vue', import.meta.url), 'utf8');
const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1];
const parsed = ts.createSourceFile('SpatialMap.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const drawNode = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'draw');
const drawCode = ts.transpileModule(drawNode.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
function drawCallback(bindings) {
  return new Function('bindings', `const { props, motion, failed, performance, reducedMotion, emit, schedule, displayInput, presentation, presentationAllowed, visibleSelf, canvas } = bindings;
    let painter=bindings.painter, frame=1, settledKey='', stopped=false; const renderingError={value:''};
    const displayFailed=error=>{ throw error; }; ${drawCode}; return { draw, replacePainter(value){painter=value;}, stop(){stopped=true;} };`)(bindings);
}
function baseline() {
  const s = spatialSnapshot(), p = s.projection; p.sceneTimeMs = 0;
  p.self.position = { x: 365, y: 425 }; p.entities[0].position = { ...p.self.position };
  p.movement = { movementId: 'previous-plan', movementCommandSeq: '1', planVersion: '1', sceneId: p.self.sceneId,
    mapVersion: p.mapVersion, goal: { ...p.self.position }, path: [{ ...p.self.position }, { ...p.self.position }], status: 'arrived', acceptedAtSceneTime: 0 };
  p.self.movementCommandHighWater = '1'; return s;
}
function timed(previous, through, points, spans, plan = {}) {
  const s = structuredClone(previous), p = s.projection;
  s.snapshotSeq = String(BigInt(previous.snapshotSeq) + 1n); p.sceneTimeMs = through;
  p.self.position = { ...points.at(-1) }; p.self.movementCommandHighWater = plan.movementCommandSeq ?? '2';
  p.movement = { ...p.movement, movementId: 'next-plan', movementCommandSeq: '2', planVersion: '2',
    goal: { ...p.self.position }, path: points, ...plan };
  Object.assign(p.entities[0], { position: { ...p.self.position }, motionTrail: points,
    motionFromSceneTimeMs: previous.projection.sceneTimeMs, motionThroughSceneTimeMs: through,
    motionTimeline: spans.map(([kind, from, to, first, last]) => ({ kind, fromSceneTimeMs: from, throughSceneTimeMs: to, fromTrailIndex: first, throughTrailIndex: last })) });
  return s;
}
function fixture(options = {}) {
  const motion = new ConfirmedMotion(), publisher = createSpatialSnapshotSource(), emissions = [];
  const style = { display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible' };
  const bounds = { left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 };
  const doc = { hidden: false, visibilityState: 'visible', defaultView: { innerWidth: 1000, innerHeight: 800, getComputedStyle: () => style } };
  const canvas = { ownerDocument: doc, isConnected: true, parentElement: null, getBoundingClientRect: () => bounds, getClientRects: () => [bounds] };
  const presentation = new presentationModule.CanvasPresentationOwner(motion, canvas);
  let now = 0, serial = 0;
  const subscription = publisher.source.subscribe(s => { presentation.seal(now, true); if (s) motion.update(s, now); else motion.reset(); }, e => { throw e; });
  const painter = { clear() {}, paint(s, m, at) {
    if (options.throwPaint) throw Error('controlled-paint-failure');
    if (options.emptyPaint) return null;
    const pose = options.reducedMotion ? { position: s.projection.self.position, moving: false, distance: 0, facing: 'S' } : m.pose(selfRef, at);
    const frame = { sceneId: s.projection.self.sceneId, instance: 'controlled-instance', serial: ++serial,
      view: { x: 0, y: 0, width: 1000, height: 800 }, viewport: { width: 1000, height: 800, dpr: 1 }, fit: { x: 0, y: 0, scale: 1 },
      actors: [{ ref: selfRef, ...pose }], failed: [] };
    options.afterPaint?.(frame); return frame;
  } };
  const handle = drawCallback({ props: { snapshotSource: publisher.source }, motion, painter, presentation,
    canvas: { value: canvas }, visibleSelf: presentationModule.visibleSelf, displayInput: () => subscription.current,
    presentationAllowed: () => !options.reducedMotion, reducedMotion: Boolean(options.reducedMotion), failed: { value: false },
    performance: { now: () => now }, emit: (event, value) => emissions.push({ event, value }), schedule() {} });
  return { motion, emissions, doc, style, bounds, canvas, handle,
    update(s, at) { now = at; publisher.publish(s); }, draw(at) { now = at; handle.draw(); } };
}

test('ARRIVAL-01：持续纯hold下成功绘出同点新计划，可回报到达且不清空hold或创建信用', () => {
  const f = fixture(); let s = baseline(); f.update(s, 0);
  for (let i = 1; i <= 4; i++) {
    const p = s.projection.self.position;
    s = timed(s, i * 200, [{ ...p }, { ...p }], [['hold', (i - 1) * 200, i * 200, 0, 1]]);
    f.update(s, i * 200); f.draw(i * 200 + 16);
    assert.equal(f.motion.settled(selfRef, i * 200 + 16), false, '严格队列仍有原hold');
    assert.equal(f.motion.presentationCreditMs, 0, '到达回报不是呈现信用');
  }
  assert.equal(f.emissions.length, 1, '当前计划的真实绘制到达只回报一次');
  assert.deepEqual(f.emissions[0], { event: 'settled', value: { viewId: s.viewId, epoch: s.projection.self.controlEpoch,
    movementId: 'next-plan', sequence: '2', position: { x: 365, y: 425 } } });
});

test('ARRIVAL-02：最后运动播完而尾hold未完时回报，原时长与严格settled不变', () => {
  const f = fixture(), first = baseline(); f.update(first, 0);
  const points = [{ x: 365, y: 425 }, { x: 375, y: 425 }];
  const next = timed(first, 200, points, [['motion', 0, 100, 0, 1], ['hold', 100, 200, 1, 1]]);
  f.update(next, 200); f.draw(250);
  assert.deepEqual(f.motion.pose(selfRef, 250).position, { x: 370, y: 425 }); assert.equal(f.emissions.length, 0);
  f.draw(300); assert.equal(f.emissions.length, 1); assert.equal(f.motion.hasPendingMotion(selfRef, 300), false);
  assert.equal(f.motion.settled(selfRef, 399), false); assert.equal(f.motion.settled(selfRef, 400), true);
  assert.equal(f.motion.pose(selfRef, 399).distance, 10); assert.equal(f.motion.presentationCreditMs, 0);
});

test('ARRIVAL-03：内部hold后还有闭环运动，即使当前位置已等于终点也不能提前回报', () => {
  const f = fixture(), first = baseline(); f.update(first, 0);
  const points = [{ x: 365, y: 425 }, { x: 375, y: 425 }, { x: 365, y: 425 }];
  const next = timed(first, 300, points, [['hold', 0, 100, 0, 0], ['motion', 100, 200, 0, 2], ['hold', 200, 300, 2, 2]]);
  f.update(next, 300);
  for (const at of [350, 400]) {
    assert.deepEqual(f.motion.pose(selfRef, at).position, first.projection.self.position);
    assert.equal(f.motion.hasPendingMotion(selfRef, at), true); f.draw(at); assert.equal(f.emissions.length, 0);
  }
  f.draw(500); assert.equal(f.emissions.length, 1); assert.equal(f.motion.settled(selfRef, 500), false);
  assert.equal(f.motion.pose(selfRef, 500).distance, 20); assert.equal(f.motion.presentationCreditMs, 0);
});

test('ARRIVAL-04：未结束timed motion即使几何为0仍等待，不把它当hold', () => {
  const f = fixture(), first = baseline(); f.update(first, 0);
  const point = first.projection.self.position;
  const next = timed(first, 100, [{ ...point }, { ...point }], [['motion', 0, 100, 0, 1]]);
  f.update(next, 100); f.draw(150);
  assert.equal(f.motion.pose(selfRef, 150).moving, false); assert.equal(f.motion.hasPendingMotion(selfRef, 150), true);
  assert.equal(f.emissions.length, 0); assert.equal(f.motion.presentationCreditMs, 0);
  f.draw(200); assert.equal(f.emissions.length, 1);
});

test('ARRIVAL-05：legacy完整余折线仍含返回路径时不得只用当前点提前到达', () => {
  const f = fixture(), first = baseline(); f.update(first, 0);
  const points = [{ x: 365, y: 425 }, { x: 375, y: 425 }, { x: 365, y: 425 }, { x: 375, y: 425 }];
  const next = timed(first, 300, points, [['motion', 0, 300, 0, 3]]); delete next.projection.entities[0].motionTimeline;
  f.update(next, 300); f.draw(400);
  assert.deepEqual(f.motion.pose(selfRef, 400).position, next.projection.self.position);
  assert.equal(f.motion.hasPendingMotion(selfRef, 400), true); assert.equal(f.emissions.length, 0);
  f.draw(600); assert.equal(f.emissions.length, 1); assert.equal(f.motion.pose(selfRef, 600).distance, 30);
});

test('ARRIVAL-06：查询不冒充显示，空帧/隐藏/离屏/错误本人或点/旧source或renderer均不回报', () => {
  const cases = [
    ['无成功帧', (f, options) => options.emptyPaint = true],
    ['document隐藏', f => f.doc.hidden = true],
    ['visibilityState隐藏', f => f.doc.visibilityState = 'hidden'],
    ['卸载canvas', f => f.canvas.isConnected = false],
    ['display:none', f => f.style.display = 'none'],
    ['visibility:hidden', f => f.style.visibility = 'hidden'],
    ['透明', f => f.style.opacity = '0'],
    ['离屏', f => Object.assign(f.bounds, { left: 1500, right: 2500 })],
    ['错误本人', (_f, options) => options.afterPaint = frame => frame.actors[0].ref = 'other'],
    ['错误位置', (_f, options) => options.afterPaint = frame => frame.actors[0].position = { x: 366, y: 425 }],
    ['错误场景', (_f, options) => options.afterPaint = frame => frame.sceneId = 'other-scene'],
    ['source重置', (f, options) => options.afterPaint = () => f.update(null, 216)],
    ['renderer替换', (f, options) => options.afterPaint = () => f.handle.replacePainter({})],
    ['owner停止', (f, options) => options.afterPaint = () => f.handle.stop()],
  ];
  for (const [label, change] of cases) {
    const options = {}, f = fixture(options), first = baseline(); f.update(first, 0);
    const point = first.projection.self.position;
    const next = timed(first, 200, [{ ...point }, { ...point }], [['hold', 0, 200, 0, 1]]); f.update(next, 200);
    f.motion.pose(selfRef, 216); f.motion.hasPendingMotion(selfRef, 216); assert.equal(f.emissions.length, 0, '纯查询不回报');
    change(f, options); f.draw(216); assert.equal(f.emissions.length, 0, label); assert.equal(f.motion.presentationCreditMs, 0, label);
  }
  const options = { throwPaint: true }, f = fixture(options), first = baseline(); f.update(first, 0);
  assert.throws(() => f.draw(0), /controlled-paint-failure/); assert.equal(f.emissions.length, 0);
});

test('ARRIVAL-07：只有当前arrived计划可回报，同点新计划身份仍单独回报', () => {
  for (const status of ['accepted', 'moving', 'blocked', 'cancelled']) {
    const f = fixture(), first = baseline(); f.update(first, 0); const point = first.projection.self.position;
    f.update(timed(first, 200, [{ ...point }, { ...point }], [['hold', 0, 200, 0, 1]], { status }), 200);
    f.draw(216); assert.equal(f.emissions.length, 0, status);
  }
  const f = fixture(), first = baseline(); f.update(first, 0); const point = first.projection.self.position;
  const second = timed(first, 200, [{ ...point }, { ...point }], [['hold', 0, 200, 0, 1]]); f.update(second, 200); f.draw(216);
  const third = timed(second, 400, [{ ...point }, { ...point }], [['hold', 200, 400, 0, 1]], { movementId: 'third-plan', movementCommandSeq: '3', planVersion: '3' });
  f.update(third, 400); f.draw(416); f.draw(432);
  assert.deepEqual(f.emissions.map(row => [row.value.movementId, row.value.sequence]), [['next-plan', '2'], ['third-plan', '3']]);
  assert.equal(f.motion.presentationCreditMs, 0);
});

test('ARRIVAL-08：reduced-motion沿用直接绘出确认点的到达语义，不获得呈现信用', () => {
  const f = fixture({ reducedMotion: true }), first = baseline(); f.update(first, 0);
  const next = timed(first, 100, [{ x: 365, y: 425 }, { x: 375, y: 425 }], [['motion', 0, 100, 0, 1]]);
  f.update(next, 100); f.draw(116);
  assert.equal(f.motion.hasPendingMotion(selfRef, 116), true, '原运动段仍在，无时间压缩或删除');
  assert.equal(f.emissions.length, 1); assert.equal(f.motion.presentationCreditMs, 0);
});
