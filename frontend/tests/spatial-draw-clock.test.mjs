import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { ConfirmedMotion } from '../src/domain/spatial-motion.ts';
import { spatialSnapshot, selfRef } from './spatial-fixture.mjs';
import { createSpatialSnapshotSource } from '../src/domain/spatial-snapshot-source.ts';
import { visibleSelf } from '../src/rendering/spatial-presentation.ts';
import { assertPaintContinuity } from './canvas-browser-support.mjs';

// 隔离执行真实 SFC 的 draw 回调；不复制绘制决策，不冒称运行过 DOM/浏览器。
const source = await readFile(new URL('../src/features/world/SpatialMap.vue', import.meta.url), 'utf8');
const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1]; assert.ok(script);
const parsed = ts.createSourceFile('SpatialMap.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const drawNodes = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && ['displayInput', 'draw'].includes(node.name?.text)); assert.equal(drawNodes.length, 2);
const drawCode = ts.transpileModule(drawNodes.map(node => node.getText(parsed)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
function drawCallback(bindings) {
  // 该隔离回调没有DOM呈现owner；不以paint替身建立呈现信用。
  return new Function('bindings', `const { painter, props, motion, canvas, visibleSelf, displaySnapshot, snapshotSubscription=null, failed, performance, reducedMotion, emit, schedule } = bindings; const presentation=null, renderingError={value:''}; const displayFailed=error=>{throw error;}; let frame=1, settledKey='', stopped=false; ${drawCode}; return draw;`)({ ...bindings, visibleSelf });
}

// 只给生产可见性函数提供受控几何；不把这些替身当作真实DOM或Canvas呈现证据。
function controlledCanvas() {
  const bounds = { left: 0, top: 0, right: 2000, bottom: 1200, width: 2000, height: 1200 };
  const style = { display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible' };
  return { value: { ownerDocument: { hidden: false, visibilityState: 'visible', defaultView: { innerWidth: 2000, innerHeight: 1200, getComputedStyle: () => style } },
    isConnected: true, parentElement: null, getBoundingClientRect: () => bounds, getClientRects: () => [bounds] } };
}
function drawnFrame(snapshot, pose) {
  return { sceneId: snapshot.projection.self.sceneId, instance: 'isolated-draw', serial: 1, failed: [],
    view: { x: 0, y: 0, width: 2000, height: 1200 }, viewport: { width: 2000, height: 1200, dpr: 1 }, fit: { x: 0, y: 0, scale: 1 },
    actors: [{ ref: snapshot.projection.self.entityRef, ...pose }] };
}

const trace = JSON.parse(await readFile(new URL('./fixtures/motion-delayed-draw.json', import.meta.url), 'utf8'));
function snapshot(update) {
  const identity = trace.identity;
  const self = { entityRef: identity.entityRef, sceneId: identity.sceneId, controlEpoch: identity.controlEpoch, appearanceEpoch: identity.appearanceEpoch, position: structuredClone(update.position), facing: update.facing };
  return { schemaVersion: 2, sessionId: 'captured-motion', viewId: identity.viewId, snapshotSeq: update.snapshotSeq, projection: {
    self, movement: structuredClone(update.movement), scene: { sceneId: identity.sceneId }, sceneTimeMs: update.sceneTimeMs, paused: update.paused, entities: [], items: [], targets: [],
    sceneOverview: { entities: [{ ...self, ...structuredClone(update.person) }], items: [], targets: [] },
  } };
}
function replay(useDraw) {
  const events = [...trace.updates.map(value => ({ kind: 'update', time: value.startedAt, value })), ...trace.paints.map(value => ({ kind: 'paint', time: value.startedAt, value }))].sort((a, b) => a.time - b.time);
  const motion = new ConfirmedMotion(), props = { snapshot: snapshot(trace.updates[0]) }, displaySnapshot = { value: props.snapshot }, captures = []; let actualTime = 0, painted, latest;
  motion.update(props.snapshot, Math.min(events[0].time, trace.paints[0].motionAt) - 1);
  const draw = drawCallback({ props, motion, canvas: controlledCanvas(), displaySnapshot, failed: { value: false }, reducedMotion: false,
    performance: { now: () => actualTime }, emit() {}, schedule() {}, painter: { paint(actualSnapshot, actualMotion, now) { painted = { motionAt: now, pose: actualMotion.pose(trace.identity.entityRef, now) }; return drawnFrame(actualSnapshot, painted.pose); } } });
  for (const event of events) {
    const value = event.value;
    if (event.kind === 'update') { props.snapshot = snapshot(value); motion.update(props.snapshot, value.at); displaySnapshot.value = props.snapshot; latest = value; continue; }
    if (latest) assert.equal(latest.snapshotSeq, value.snapshotSeq, '重放保持实际更新与绘制先后');
    if (useDraw) { actualTime = value.startedAt; draw(value.motionAt); }
    else painted = { motionAt: value.motionAt, pose: motion.pose(trace.identity.entityRef, value.motionAt) };
    captures.push({ ...trace.identity, serial: value.serial, snapshotSeq: value.snapshotSeq, motionAt: painted.motionAt, self: { ref: trace.identity.entityRef, ...painted.pose } });
  }
  return { paints: captures };
}

test('第三轮真实CI前缀逐项复演原29帧，并保留46→47超门槛的负对照', () => {
  assert.equal(trace.updates.length, 10); assert.equal(trace.paints.length, 29);
  const captured = replay(false);
  for (const [index, frame] of captured.paints.entries()) {
    const expected = trace.paints[index].pose;
    assert.ok(Math.abs(frame.self.position.x - expected.position.x) < 1e-9); assert.ok(Math.abs(frame.self.position.y - expected.position.y) < 1e-9);
    assert.ok(Math.abs(frame.self.distance - expected.distance) < 1e-9); assert.equal(frame.self.facing, expected.facing); assert.equal(frame.self.moving, expected.moving);
  }
  assert.throws(() => assertPaintContinuity(captured), /确认段不发生超速跳点/);
  assert.equal(captured.failedInterval.from.serial, 46); assert.equal(captured.failedInterval.to.serial, 47);
  assert.equal(captured.failedInterval.delta, trace.failure.delta); assert.equal(captured.failedInterval.dt, trace.failure.dt); assert.equal(captured.failedInterval.limit, trace.failure.limit);
});

test('同一真实更新/绘制顺序经生产draw重新采样位置，原速度门槛通过且不靠改日志时间', () => {
  const captured = replay(true); assert.doesNotThrow(() => assertPaintContinuity(captured));
  const corrected = captured.paints.find(frame => frame.serial === 47), previous = trace.paints.find(frame => frame.serial === 47);
  assert.equal(corrected.motionAt, previous.startedAt, '真正传给painter/pose的是实际draw时钟');
  assert.notEqual(corrected.self.position.x, previous.pose.position.x, '必须在新时刻重新求pose，不能仅给旧位置换时间戳');
  assert.ok(corrected.self.position.x > previous.pose.position.x);
});

test('draw只采一次当前时钟，paint、视觉到达与下一帧判断消费同一个值', () => {
  const calls = []; let clockReads = 0, scheduled = 0;
  const current = snapshot(trace.updates.at(-1)); current.projection.movement.status = 'arrived';
  current.snapshotSeq = '2'; current.projection.sceneTimeMs = 200;
  const point = current.projection.self.position;
  for (const person of [current.projection.self, current.projection.sceneOverview.entities[0]]) Object.assign(person, {
    motionTrail: [structuredClone(point), structuredClone(point)], motionFromSceneTimeMs: 100, motionThroughSceneTimeMs: 200,
    motionTimeline: [{ kind: 'motion', fromTrailIndex: 0, throughTrailIndex: 1, fromSceneTimeMs: 100, throughSceneTimeMs: 200 }],
  });
  const primer = structuredClone(current); primer.snapshotSeq = '1'; primer.projection.sceneTimeMs = 100;
  for (const person of [primer.projection.self, primer.projection.sceneOverview.entities[0]]) Object.assign(person, {
    motionTrail: [structuredClone(point), structuredClone(point)], motionFromSceneTimeMs: 0, motionThroughSceneTimeMs: 100,
    motionTimeline: [{ kind: 'hold', fromTrailIndex: 0, throughTrailIndex: 1, fromSceneTimeMs: 0, throughSceneTimeMs: 100 }],
  });
  const baseline = structuredClone(current); baseline.snapshotSeq = '0'; baseline.projection.sceneTimeMs = 0; baseline.projection.movement = null;
  for (const person of [baseline.projection.self, baseline.projection.sceneOverview.entities[0]]) {
    delete person.motionTrail; delete person.motionFromSceneTimeMs; delete person.motionThroughSceneTimeMs; delete person.motionTimeline;
  }
  // 已确认的零几何motion仍有真实待播时间；用生产Motion触发门控，不能靠固定布尔跳过依赖。
  const motion = new ConfirmedMotion();
  motion.update(baseline, 0); motion.update(primer, 100); motion.update(current, 100);
  assert.equal(motion.hasPendingMotion(trace.identity.entityRef, 150), true); assert.equal(motion.active(150), true);
  const pendingMotion = motion.hasPendingMotion.bind(motion), needsFrame = motion.needsFrame.bind(motion);
  motion.hasPendingMotion = (reference, now) => { calls.push(['hasPendingMotion', now]); return pendingMotion(reference, now); };
  motion.needsFrame = now => { calls.push(['needsFrame', now]); return needsFrame(now); };
  const input = createSpatialSnapshotSource(), stale = snapshot(trace.updates[0]);
  const subscription = input.source.subscribe(() => {}, assert.fail); input.publish(current);
  const draw = drawCallback({ props: { snapshot: stale, snapshotSource: input.source }, canvas: controlledCanvas(), displaySnapshot: { value: stale }, snapshotSubscription: subscription, failed: { value: false }, reducedMotion: false,
    performance: { now: () => { clockReads++; return 150 + clockReads - 1; } },
    painter: { paint(actualSnapshot, actualMotion, now) { assert.equal(actualSnapshot, current, '生产displayInput读取成功source订阅，不能退回迟到props'); calls.push(['paint', now]); return drawnFrame(actualSnapshot, actualMotion.pose(trace.identity.entityRef, now)); } },
    motion,
    emit() {}, schedule() { scheduled++; } });
  draw(266.6666666667);
  subscription.close();
  assert.equal(clockReads, 1); assert.deepEqual(calls, [['paint', 150], ['hasPendingMotion', 150], ['needsFrame', 150]]); assert.equal(scheduled, 1);
});

test('RD-07：实际draw采样在运动尾前，paint跨尾后仍安排最后idle帧', () => {
  const first = spatialSnapshot(); first.projection.sceneTimeMs = 0; first.snapshotSeq = '1';
  const point = first.projection.self.position, current = structuredClone(first), end = { x: point.x + 10, y: point.y };
  current.snapshotSeq = '2'; current.projection.sceneTimeMs = 100; current.projection.self.position = end;
  Object.assign(current.projection.entities[0], { position: end, motionTrail: [point, end], motionFromSceneTimeMs: 0, motionThroughSceneTimeMs: 100,
    motionTimeline: [{ kind: 'motion', fromTrailIndex: 0, throughTrailIndex: 1, fromSceneTimeMs: 0, throughSceneTimeMs: 100 }] });
  const motion = new ConfirmedMotion(); motion.update(first, 0); motion.update(current, 0);
  let clock = 99, scheduled = 0; const painted = [], queryAt = [], needsFrame = motion.needsFrame.bind(motion);
  motion.needsFrame = now => { queryAt.push(now); return needsFrame(now); };
  const draw = drawCallback({ props: { snapshot: current }, displaySnapshot: { value: current }, motion, canvas: controlledCanvas(), failed: { value: false }, reducedMotion: false,
    performance: { now: () => clock }, emit() {}, schedule() { scheduled++; },
    painter: { paint(value, actualMotion, now) { const pose = actualMotion.pose(selfRef, now); painted.push(pose); clock += 2; return drawnFrame(value, pose); } } });
  draw(); assert.equal(painted[0].moving, true); assert.equal(clock, 101); assert.equal(scheduled, 1);
  draw(); assert.equal(painted[1].moving, false); assert.deepEqual(painted[1].position, end); assert.equal(scheduled, 1);
  assert.deepEqual(queryAt, [99, 101], '续绘消费本帧采样值，不能用跨尾后的完成时刻停掉最后idle');
});
