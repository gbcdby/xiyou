import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { ConfirmedMotion } from '../src/domain/spatial-motion.ts';
import { assertPaintContinuity } from './canvas-browser-support.mjs';

// 隔离执行真实 SFC 的 draw 回调；不复制绘制决策，不冒称运行过 DOM/浏览器。
const source = await readFile(new URL('../src/features/world/SpatialMap.vue', import.meta.url), 'utf8');
const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1]; assert.ok(script);
const parsed = ts.createSourceFile('SpatialMap.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const drawNode = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'draw'); assert.ok(drawNode);
const drawCode = ts.transpileModule(drawNode.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
function drawCallback(bindings) {
  return new Function('bindings', `const { painter, props, motion, projection, scene, failed, performance, reducedMotion, emit, schedule } = bindings; let frame=1, settledKey='', stopped=false; ${drawCode}; return draw;`)(bindings);
}

const trace = JSON.parse(await readFile(new URL('./fixtures/motion-delayed-draw.json', import.meta.url), 'utf8'));
function snapshot(update) {
  const identity = trace.identity;
  const self = { entityRef: identity.entityRef, sceneId: identity.sceneId, controlEpoch: identity.controlEpoch, appearanceEpoch: identity.appearanceEpoch, position: structuredClone(update.position), facing: update.facing };
  return { schemaVersion: 2, sessionId: 'captured-motion', viewId: identity.viewId, snapshotSeq: update.snapshotSeq, projection: {
    self, movement: structuredClone(update.movement), sceneTimeMs: update.sceneTimeMs, paused: update.paused, entities: [], items: [], targets: [],
    sceneOverview: { entities: [{ ...self, ...structuredClone(update.person) }], items: [], targets: [] },
  } };
}
function replay(useDraw) {
  const events = [...trace.updates.map(value => ({ kind: 'update', time: value.startedAt, value })), ...trace.paints.map(value => ({ kind: 'paint', time: value.startedAt, value }))].sort((a, b) => a.time - b.time);
  const motion = new ConfirmedMotion(), props = { snapshot: snapshot(trace.updates[0]) }, captures = []; let actualTime = 0, painted, latest;
  motion.update(props.snapshot, Math.min(events[0].time, trace.paints[0].motionAt) - 1);
  const draw = drawCallback({ props, motion, projection: { get value() { return props.snapshot.projection; } }, scene: { value: {} }, failed: { value: false }, reducedMotion: false,
    performance: { now: () => actualTime }, emit() {}, schedule() {}, painter: { paint(_snapshot, actualMotion, now) { painted = { motionAt: now, pose: actualMotion.pose(trace.identity.entityRef, now) }; return { failed: [] }; } } });
  for (const event of events) {
    const value = event.value;
    if (event.kind === 'update') { props.snapshot = snapshot(value); motion.update(props.snapshot, value.at); latest = value; continue; }
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
  const draw = drawCallback({ props: { snapshot: current }, projection: { value: current.projection }, scene: { value: {} }, failed: { value: false }, reducedMotion: false,
    performance: { now: () => { clockReads++; return 310 + clockReads - 1; } },
    painter: { paint(_snapshot, _motion, now) { calls.push(['paint', now]); return { failed: [] }; } },
    motion: { settled(_ref, now) { calls.push(['settled', now]); return false; }, active(now) { calls.push(['active', now]); return true; } },
    emit() {}, schedule() { scheduled++; } });
  draw(266.6666666667);
  assert.equal(clockReads, 1); assert.deepEqual(calls, [['paint', 310], ['settled', 310], ['active', 310]]); assert.equal(scheduled, 1);
});
