import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfirmedMotion, motionPresentationIdentity } from '../src/domain/spatial-motion.ts';
import { spatialSnapshot, selfRef } from './spatial-fixture.mjs';
import { SpatialView } from '../src/domain/spatial-view.ts';

function baseline(sceneTimeMs = 34, position = { x: 950, y: 650 }) {
  const snapshot = spatialSnapshot(); snapshot.snapshotSeq = '40';
  const p = snapshot.projection; p.sceneTimeMs = sceneTimeMs;
  p.self.position = { ...position }; p.entities[0].position = { ...position }; return snapshot;
}
function timed(previous, through, points, spans, status = 'moving') {
  const snapshot = structuredClone(previous), p = snapshot.projection;
  snapshot.snapshotSeq = String(BigInt(previous.snapshotSeq) + 1n); p.sceneTimeMs = through;
  p.self.position = { ...points.at(-1) }; p.movement = status ? { movementId: 'confirmed-only', sceneId: p.self.sceneId, status, path: points } : null;
  Object.assign(p.entities[0], { position: { ...p.self.position }, motionTrail: points, motionFromSceneTimeMs: previous.projection.sceneTimeMs,
    motionThroughSceneTimeMs: through, motionTimeline: spans.map(([kind, from, to, first, last]) => ({ kind, fromSceneTimeMs: from, throughSceneTimeMs: to, fromTrailIndex: first, throughTrailIndex: last })) });
  return snapshot;
}

test('TIME-01：无实际呈现时141ms静止与原28ms运动分开，查询不抵扣静止', () => {
  const motion = new ConfirmedMotion(), first = baseline(); motion.update(first, 0);
  const second = timed(first, 203, [{ x: 950, y: 650 }, { x: 955, y: 650 }], [['hold', 34, 175, 0, 0], ['motion', 175, 203, 0, 1]]);
  motion.pose(selfRef, 200); motion.settled(selfRef, 200); motion.active(200);
  motion.update(second, 200);
  assert.deepEqual(motion.pose(selfRef, 228), { position: { x: 950, y: 650 }, facing: 'S', moving: false, distance: 0 });
  assert.equal(motion.pose(selfRef, 355).position.x, 952.5, '运动只使用原28ms，不把领先静止摊入速度');
  assert.equal(motion.pose(selfRef, 369).position.x, 955);
  assert.equal(motion.pose(selfRef, 369).moving, false, '确认队列耗尽时不以Accepted或continuing假装走步');
});

function present(motion, snapshot, at, serial = 1, renderer = 'controlled-visible-canvas') {
  const pose = motion.pose(selfRef, at);
  return motion.presentSelf({ identity: motionPresentationIdentity(snapshot), reference: selfRef, renderer, serial,
    ...pose, sampledAt: at, presentedAt: at });
}

for (const credit of [0, 80, 141]) test(`TIME-03：受控呈现单元仅抵扣实际封存的${credit}ms，不是Canvas运行证据`, () => {
  const motion = new ConfirmedMotion(), first = baseline(); motion.update(first, 0);
  if (credit) { assert.equal(present(motion, first, 200 - credit), true); motion.sealPresentation(200); }
  const second = timed(first, 203, [{ x: 950, y: 650 }, { x: 955, y: 650 }], [['hold', 34, 175, 0, 0], ['motion', 175, 203, 0, 1]]);
  motion.update(second, 200);
  const remaining = 141 - credit;
  assert.equal(motion.pose(selfRef, 200 + remaining + 14).position.x, 952.5);
  assert.equal(motion.pose(selfRef, 200 + remaining + 28).position.x, 955);
  assert.equal(motion.presentationCreditMs, 0);
});

test('TIME-04：旧余段和下一方向/速度分别保时，不合成平均速度', () => {
  const motion = new ConfirmedMotion(), first = baseline(0, { x: 0, y: 0 }); motion.update(first, 0);
  const second = timed(first, 100, [{ x: 0, y: 0 }, { x: 10, y: 0 }], [['motion', 0, 100, 0, 1]]); motion.update(second, 100);
  const third = timed(second, 300, [{ x: 10, y: 0 }, { x: 10, y: 30 }], [['motion', 100, 300, 0, 1]]); motion.update(third, 150);
  assert.deepEqual(motion.pose(selfRef, 175).position, { x: 7.5, y: 0 });
  assert.deepEqual(motion.pose(selfRef, 200).position, { x: 10, y: 0 });
  assert.deepEqual(motion.pose(selfRef, 300).position, { x: 10, y: 15 });
  assert.equal(motion.pose(selfRef, 400).distance, 40); assert.equal(motion.pose(selfRef, 400).moving, false);
});

test('TIME-03/04：内部与尾部hold保持原位置和时长，不花领先信用', () => {
  const motion = new ConfirmedMotion(), first = baseline(0, { x: 0, y: 0 }); motion.update(first, 0);
  present(motion, first, 0); motion.sealPresentation(200);
  const second = timed(first, 300, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], [
    ['motion', 0, 100, 0, 1], ['hold', 100, 150, 1, 1], ['motion', 150, 250, 1, 2], ['hold', 250, 300, 2, 2],
  ]); motion.update(second, 200);
  assert.equal(motion.pose(selfRef, 250).position.x, 5);
  assert.deepEqual(motion.pose(selfRef, 325).position, { x: 10, y: 0 }); assert.equal(motion.pose(selfRef, 325).moving, false);
  assert.equal(motion.pose(selfRef, 400).position.y, 5);
  assert.equal(motion.pose(selfRef, 475).moving, false); assert.equal(motion.settled(selfRef, 499), false); assert.equal(motion.settled(selfRef, 500), true);
  assert.equal(motion.presentationCreditMs, 0);
});

test('TIME-03：正常播完旧hold的50ms不能抵扣下一hold30ms', () => {
  const motion = new ConfirmedMotion(), first = baseline(0); motion.update(first, 0);
  const point = first.projection.self.position;
  const old = timed(first, 50, [point, point], [['hold', 0, 50, 0, 1]], null); motion.update(old, 0);
  assert.equal(present(motion, old, 25), false); motion.sealPresentation(50); assert.equal(motion.presentationCreditMs, 0);
  assert.equal(present(motion, old, 50, 2), true); motion.sealPresentation(50);
  const next = timed(old, 80, [point, point], [['hold', 50, 80, 0, 1]], null); motion.update(next, 50);
  assert.equal(motion.settled(selfRef, 79), false); assert.equal(motion.settled(selfRef, 80), true);
});

test('TIME-03：同点Accepted只封存旧信用，查询/再次绘制不增加；只能消费一次', () => {
  const motion = new ConfirmedMotion(), first = baseline(0, { x: 0, y: 0 }); motion.update(first, 0);
  present(motion, first, 0); motion.sealPresentation(100);
  const accepted = structuredClone(first); accepted.snapshotSeq = '41'; accepted.projection.movement = { status: 'accepted' }; motion.update(accepted, 100);
  assert.equal(present(motion, accepted, 100, 2), false); motion.sealPresentation(150); motion.pose(selfRef, 150);
  assert.equal(motion.presentationCreditMs, 100);
  const next = timed(accepted, 128, [{ x: 0, y: 0 }, { x: 5, y: 0 }], [['hold', 0, 100, 0, 0], ['motion', 100, 128, 0, 1]]); motion.update(next, 150);
  assert.equal(motion.pose(selfRef, 164).position.x, 2.5); assert.equal(motion.presentationCreditMs, 0);
  motion.update(next, 160); assert.equal(motion.pose(selfRef, 178).position.x, 5, '重复同游标输入不重排或再次花信用');
});

test('TIME-03：隐藏/失效及旧帧重放不恢复信用，未封口update不倒推显示时间', () => {
  const motion = new ConfirmedMotion(), first = baseline(); motion.update(first, 0);
  present(motion, first, 0); motion.sealPresentation(100); motion.invalidatePresentation();
  assert.equal(present(motion, first, 0), false, '同renderer旧serial不能再次打开区间'); assert.equal(motion.presentationCreditMs, 0);
  present(motion, first, 100, 2); motion.update(first, 200); assert.equal(motion.presentationCreditMs, 0, 'owner漏封口时不能凭update推断可见');
});

test('TIME-04：同端点折返不被同位置快路径吞掉，零几何motion保持真实静止', () => {
  const motion = new ConfirmedMotion(), first = baseline(0, { x: 0, y: 0 }); motion.update(first, 0);
  const loop = timed(first, 200, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }], [['motion', 0, 200, 0, 2]]); motion.update(loop, 0);
  assert.equal(motion.pose(selfRef, 100).position.x, 10); assert.equal(motion.pose(selfRef, 200).distance, 20);
  const still = timed(loop, 250, [{ x: 0, y: 0 }, { x: 0, y: 0 }], [['motion', 200, 250, 0, 1]], null); motion.update(still, 200);
  assert.equal(motion.pose(selfRef, 225).moving, false); assert.equal(motion.settled(selfRef, 225), false);
  assert.equal(present(motion, still, 225), false, '零几何motion不是自由静止余额');
});

test('TIME-03/04：中途缺字段只接原合法段，保timed余段、不制造hold信用', () => {
  const motion = new ConfirmedMotion(), first = baseline(0, { x: 0, y: 0 }); motion.update(first, 0);
  const second = timed(first, 100, [{ x: 0, y: 0 }, { x: 10, y: 0 }], [['motion', 0, 100, 0, 1]]); motion.update(second, 0);
  const third = timed(second, 200, [{ x: 10, y: 0 }, { x: 10, y: 20 }], [['motion', 100, 200, 0, 1]]); delete third.projection.entities[0].motionTimeline;
  motion.update(third, 50); assert.deepEqual(motion.pose(selfRef, 75).position, { x: 7.5, y: 0 });
  assert.deepEqual(motion.pose(selfRef, 150).position, { x: 10, y: 10 }); assert.equal(motion.pose(selfRef, 200).distance, 30);
});

test('TIME-03：完整身份/renderer变化清空未用余额和旧待播段', () => {
  for (const change of [s => s.viewId += '-new', s => s.projection.mapVersion += '-new', s => s.projection.self.controlEpoch = '3',
    s => s.projection.self.entityRef += '-new', s => s.projection.self.sceneId = 'another', s => s.projection.self.appearanceEpoch = '1']) {
    const motion = new ConfirmedMotion(), first = baseline(); motion.update(first, 0); present(motion, first, 0); motion.sealPresentation(100);
    const next = structuredClone(first); change(next); motion.update(next, 100); assert.equal(motion.presentationCreditMs, 0);
  }
  const motion = new ConfirmedMotion(), first = baseline(); motion.update(first, 0); present(motion, first, 0); motion.sealPresentation(100);
  present(motion, first, 100, 1, 'replacement-canvas'); assert.equal(motion.presentationCreditMs, 0);
});

test('TIME-03：空但推进游标的Batch不重播继承timeline；重复/部分重叠/非法字段整批不入队', () => {
  const first = baseline(0, { x: 0, y: 0 }), view = new SpatialView(), generation = view.begin(first.sessionId), motion = new ConfirmedMotion();
  assert.equal(view.acceptSnapshot(first, generation), 'applied'); motion.update(view.snapshot, 0);
  const second = timed(first, 100, [{ x: 0, y: 0 }, { x: 10, y: 0 }], [['motion', 0, 100, 0, 1]], null);
  const batch = { schemaVersion: 2, type: 'world.batch', sessionId: first.sessionId, viewId: first.viewId, fromExclusive: '40', throughSeq: '41',
    events: [{ sessionSeq: '41', eventId: 'event41', kind: 'projection.replace', payload: { projection: second.projection } }] };
  assert.equal(view.applyBatch(batch, generation), 'applied'); motion.update(view.snapshot, 0);
  assert.equal(view.applyBatch({ ...batch, fromExclusive: '41', throughSeq: '42', events: [] }, generation), 'applied'); motion.update(view.snapshot, 25);
  assert.equal(motion.pose(selfRef, 50).position.x, 5); assert.equal(motion.pose(selfRef, 100).distance, 10);
  assert.equal(view.applyBatch(batch, generation), 'duplicate');
  assert.equal(view.applyBatch({ ...batch, throughSeq: '43' }, generation), 'refetch');
  const bad = structuredClone(batch); bad.fromExclusive = '42'; bad.throughSeq = '43'; bad.events[0].sessionSeq = '43';
  bad.events[0].payload.projection.entities[0].motionTimeline[0].throughTrailIndex = 0;
  const installed = view.snapshot; assert.equal(view.applyBatch(bad, generation), 'refetch'); assert.equal(view.snapshot, installed);
});

test('TIME-03：零跨度唯一hold不进入队列也不消费已封存信用', () => {
  const first = baseline(0), motion = new ConfirmedMotion(); motion.update(first, 0); present(motion, first, 0); motion.sealPresentation(100);
  const point = first.projection.self.position, zero = timed(first, 0, [point, point], [['hold', 0, 0, 0, 1]], null); motion.update(zero, 100);
  assert.equal(motion.settled(selfRef, 100), true); assert.equal(motion.presentationCreditMs, 100);
});
