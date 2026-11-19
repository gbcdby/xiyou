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

function present(motion, snapshot, at, serial = 1, renderer = 'controlled-visible-canvas', presentedAt = at) {
  const pose = motion.pose(selfRef, at);
  return motion.presentSelf({ identity: motionPresentationIdentity(snapshot), reference: selfRef, renderer, serial,
    ...pose, sampledAt: at, presentedAt });
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
  assert.equal(present(motion, old, 25), true, '纯hold真实帧可保留凭据，但播放期间没有余额'); motion.sealPresentation(50); assert.equal(motion.presentationCreditMs, 0);
  assert.equal(present(motion, old, 50, 2), true); motion.sealPresentation(50);
  const next = timed(old, 80, [point, point], [['hold', 50, 80, 0, 1]], null); motion.update(next, 50);
  assert.equal(motion.settled(selfRef, 79), false); assert.equal(motion.settled(selfRef, 80), true);
});

function holding(through = 50, spans = [['hold', 0, through, 0, 1]]) {
  const motion = new ConfirmedMotion(), first = baseline(0); motion.update(first, 0);
  const point = first.projection.self.position, snapshot = timed(first, through, [point, point], spans, null);
  motion.update(snapshot, 0); return { motion, snapshot, point };
}

test('RD-01/04：纯hold不需自动续绘，但完整时长和真实封口信用保持', () => {
  const { motion, snapshot } = holding(100, [['hold', 0, 50, 0, 0], ['hold', 50, 100, 0, 1]]);
  const before = [motion.pose(selfRef, 25), motion.pose(selfRef, 75), motion.pose(selfRef, 100)];
  assert.equal(present(motion, snapshot, 25, 1, 'canvas', 30), true);
  for (const at of [25, 75, 100, 120, 25]) assert.equal(motion.needsFrame(at), false);
  assert.equal(motion.active(25), true); assert.equal(motion.settled(selfRef, 99), false);
  assert.equal(motion.settled(selfRef, 100), true); assert.equal(motion.presentationCreditMs, 0);
  assert.deepEqual([motion.pose(selfRef, 25), motion.pose(selfRef, 75), motion.pose(selfRef, 100)], before, '查询不剪段、不快进、不移动锚点');
  motion.sealPresentation(120); assert.equal(motion.presentationCreditMs, 20, '只有真实封口计算完整hold尾后的后缀');
  motion.needsFrame(150); motion.sealPresentation(150); assert.equal(motion.presentationCreditMs, 20, '查询不能重开或重复计入凭据');
});

test('RD-02：只看当前moving不足，未来运动、折返、零几何与legacy均继续绘制', () => {
  const point = { x: 950, y: 650 }, other = { x: 960, y: 650 };
  for (const [points, spans, queryAt] of [
    [[point, other], [['hold', 0, 50, 0, 0], ['motion', 50, 100, 0, 1]], 25],
    [[point, other, point], [['motion', 0, 30, 0, 1], ['hold', 30, 60, 1, 1], ['motion', 60, 100, 1, 2]], 45],
    [[point, other, point], [['hold', 0, 50, 0, 0], ['motion', 50, 100, 0, 2]], 25],
    [[point, point], [['hold', 0, 50, 0, 0], ['motion', 50, 100, 0, 1]], 25],
  ]) {
    const motion = new ConfirmedMotion(), first = baseline(0); motion.update(first, 0);
    motion.update(timed(first, 100, points, spans, null), 0);
    assert.equal(motion.pose(selfRef, queryAt).moving, false);
    assert.equal(motion.needsFrame(queryAt), true); assert.equal(motion.needsFrame(99), true);
    assert.equal(motion.needsFrame(100), false); assert.equal(motion.settled(selfRef, 100), true);
  }
  const legacy = holding(), next = timed(legacy.snapshot, 100, [point, point], [['hold', 50, 100, 0, 1]], null);
  delete next.projection.entities[0].motionTimeline; legacy.motion.update(next, 25);
  assert.equal(legacy.motion.pose(selfRef, 30).moving, false); assert.equal(legacy.motion.needsFrame(30), true);
  assert.equal(legacy.motion.needsFrame(99), true); assert.equal(legacy.motion.needsFrame(100), false);
});

test('RD-03：本人纯hold不能停止另一实体的旧协议运动', () => {
  const first = baseline(0), npc = { ...structuredClone(first.projection.entities[0]), entityRef: 'npc-redraw', position: { x: 700, y: 500 } };
  first.projection.entities.push(npc); const motion = new ConfirmedMotion(); motion.update(first, 0);
  const point = first.projection.self.position, next = timed(first, 200, [point, point], [['hold', 0, 200, 0, 1]], null);
  const end = { x: 718, y: 500 };
  Object.assign(next.projection.entities[1], { position: end, motionTrail: [npc.position, end], motionFromSceneTimeMs: 0, motionThroughSceneTimeMs: 100 });
  motion.update(next, 0);
  assert.equal(motion.pose(selfRef, 25).moving, false); assert.equal(motion.pose(npc.entityRef, 25).moving, true);
  assert.equal(motion.needsFrame(25), true); assert.equal(motion.needsFrame(100), false);
  assert.equal(motion.active(100), true); assert.equal(motion.settled(selfRef, 199), false);
});

test('RD-01：非有限时间、异点或无法证明的hold保守续绘', () => {
  const valid = holding(); for (const now of [NaN, Infinity, -Infinity]) assert.equal(valid.motion.needsFrame(now), true);
  const point = { x: 950, y: 650 }, other = { x: 960, y: 650 };
  for (const [points, spans, updateAt] of [
    [[point, other], [['hold', 0, 100, 0, 1]], 0],
    [[point, point], [['hold', 0, 100, 1, 0]], 0],
    [[point, point], [['hold', 0, Infinity, 0, 1]], 0],
    [[point, point], [['hold', 0, 100, 0, 1]], NaN],
    [[point, point], [['unknown', 0, 100, 0, 1]], 0],
    [[point, { x: NaN, y: 650 }, point], [['hold', 0, 100, 0, 2]], 0],
  ]) {
    const motion = new ConfirmedMotion(), first = baseline(0); motion.update(first, 0);
    const next = timed(first, 100, points, spans, null), original = structuredClone(next);
    motion.update(next, updateAt); assert.equal(motion.needsFrame(25), true); assert.deepEqual(next, original, '防御查询不更改输入');
  }
});

test('TIME-03：纯hold帧凭据只在封口时计入完整队列尾后的历史后缀', () => {
  const { motion, snapshot } = holding();
  assert.equal(present(motion, snapshot, 25), true); assert.equal(motion.presentationCreditMs, 0);
  assert.equal(motion.settled(selfRef, 25), false); assert.equal(motion.active(25), true);
  motion.pose(selfRef, 70); motion.settled(selfRef, 70); motion.active(70);
  assert.equal(motion.presentationCreditMs, 0, '到尾/查询均不自动增加余额');
  motion.sealPresentation(70); assert.equal(motion.presentationCreditMs, 20);
  motion.sealPresentation(90); assert.equal(motion.presentationCreditMs, 20, '同一凭据只封口一次');
});

test('TIME-03：跨hold尾的成功提交不能回填采样时刻，早封口不污染未来水位', () => {
  const first = holding();
  assert.equal(present(first.motion, first.snapshot, 49, 1, 'canvas', 55), true);
  first.motion.sealPresentation(70); assert.equal(first.motion.presentationCreditMs, 15);
  const future = holding(100);
  assert.equal(present(future.motion, future.snapshot, 30, 1, 'canvas', 33), true);
  future.motion.sealPresentation(90); assert.equal(future.motion.presentationCreditMs, 0);
  assert.equal(present(future.motion, future.snapshot, 95, 2, 'canvas', 96), true, 'seal90不能把已消费边界写到未来100');
  future.motion.sealPresentation(110); assert.equal(future.motion.presentationCreditMs, 10);
});

test('TIME-03：尚未开始的多个确认纯hold也纳入完整尾T，不能只看当前段', () => {
  for (const [sealAt, expected] of [[75, 0], [120, 20]]) {
    const { motion, snapshot } = holding(100, [['hold', 0, 50, 0, 0], ['hold', 50, 100, 0, 1]]);
    assert.equal(present(motion, snapshot, 25), true); motion.sealPresentation(sealAt);
    assert.equal(motion.presentationCreditMs, expected);
  }
});

test('TIME-03：纯hold凭据早封口、失效、漏封口update及时间回退均不能复活', () => {
  for (const interrupt of [
    motion => motion.sealPresentation(40), motion => motion.sealPresentation(50), motion => motion.invalidatePresentation(),
    (motion, snapshot) => motion.update(snapshot, 40), motion => motion.sealPresentation(20),
  ]) {
    const { motion, snapshot } = holding();
    assert.equal(present(motion, snapshot, 25), true); interrupt(motion, snapshot);
    motion.sealPresentation(70); assert.equal(motion.presentationCreditMs, 0);
    assert.equal(present(motion, snapshot, 25), false, '旧serial不能重新开启');
    assert.equal(present(motion, snapshot, 75, 2), true); motion.sealPresentation(85);
    assert.equal(motion.presentationCreditMs, 10, '失效后只有新成功帧可以重新累计');
  }
});

test('TIME-03：新包早于旧hold尾到达，不能把旧播放区间抵扣或漏掉延长的尾', () => {
  const { motion, snapshot, point } = holding(); present(motion, snapshot, 25); motion.sealPresentation(40);
  const next = timed(snapshot, 80, [point, point], [['hold', 50, 80, 0, 1]], null); motion.update(next, 40);
  assert.equal(present(motion, next, 45, 2), true); motion.sealPresentation(70);
  assert.equal(motion.presentationCreditMs, 0); assert.equal(motion.settled(selfRef, 79), false); assert.equal(motion.settled(selfRef, 80), true);
});

test('TIME-03：纯hold尾后余额仅消费下一领先hold，不越过motion抵内部hold', () => {
  const { motion, snapshot, point } = holding(); present(motion, snapshot, 25); motion.sealPresentation(70);
  const end = { x: point.x + 10, y: point.y }, next = timed(snapshot, 140, [point, end], [
    ['hold', 50, 80, 0, 0], ['motion', 80, 110, 0, 1], ['hold', 110, 140, 1, 1],
  ], null); motion.update(next, 70);
  assert.equal(motion.presentationCreditMs, 0); assert.equal(motion.pose(selfRef, 79).position.x, point.x);
  assert.equal(motion.pose(selfRef, 95).position.x, point.x + 5);
  assert.equal(motion.settled(selfRef, 139), false); assert.equal(motion.settled(selfRef, 140), true);
});

test('TIME-03：延后资格只接受全队列同点纯hold，运动/闭环/零几何/legacy/异点均拒绝', () => {
  const point = { x: 950, y: 650 }, other = { x: 960, y: 650 };
  const cases = [
    { points: [point, other], spans: [['hold', 0, 50, 0, 0], ['motion', 50, 100, 0, 1]] },
    { points: [point, other, point], spans: [['hold', 0, 50, 0, 0], ['motion', 50, 100, 0, 2]] },
    { points: [point, point], spans: [['hold', 0, 50, 0, 0], ['motion', 50, 100, 0, 1]] },
    // 领域防御：协议应已拒绝异点hold；不能仅因其moving=false而接受呈现凭据。
    { points: [point, other], spans: [['hold', 0, 100, 0, 1]] },
  ];
  for (const item of cases) {
    const motion = new ConfirmedMotion(), first = baseline(0); motion.update(first, 0);
    const next = timed(first, 100, item.points, item.spans, null);
    motion.update(next, 0); assert.equal(present(motion, next, 25), false);
    motion.sealPresentation(120); assert.equal(motion.presentationCreditMs, 0);
  }
  const legacy = holding(), noTimeline = timed(legacy.snapshot, 100, [point, point], [['hold', 50, 100, 0, 1]], null);
  delete noTimeline.projection.entities[0].motionTimeline; legacy.motion.update(noTimeline, 25);
  assert.equal(present(legacy.motion, noTimeline, 30), false, '已排timed后的零几何legacy仍有原待播时长');
  legacy.motion.sealPresentation(120); assert.equal(legacy.motion.presentationCreditMs, 0);
  for (const status of ['accepted', 'moving']) {
    const { motion, snapshot } = holding(); snapshot.projection.movement = { status }; motion.update(snapshot, 0);
    assert.equal(present(motion, snapshot, 25), false); motion.sealPresentation(70); assert.equal(motion.presentationCreditMs, 0);
  }
});

test('TIME-03：已结束运动不复活旧帧；新成功同点帧可证明后续纯hold，朝向仍需一致', () => {
  const motion = new ConfirmedMotion(), first = baseline(0), point = first.projection.self.position; motion.update(first, 0);
  const next = timed(first, 100, [point, { x: point.x + 10, y: point.y }, point], [
    ['motion', 0, 50, 0, 2], ['hold', 50, 100, 2, 2],
  ], null); motion.update(next, 0);
  assert.equal(present(motion, next, 0), false); motion.sealPresentation(60); assert.equal(motion.presentationCreditMs, 0);
  const pose = motion.pose(selfRef, 75); assert.equal(pose.distance, 20);
  assert.equal(motion.presentSelf({ identity: motionPresentationIdentity(next), reference: selfRef, renderer: 'controlled-visible-canvas', serial: 2,
    ...pose, facing: 'E', sampledAt: 75, presentedAt: 75 }), false);
  assert.equal(present(motion, next, 75, 3), true); motion.sealPresentation(120); assert.equal(motion.presentationCreditMs, 20);
});

test('TIME-03：中途缺少timeline不能为尚未结束的旧hold开启新延后资格', () => {
  const { motion, snapshot } = holding(), missing = structuredClone(snapshot); missing.snapshotSeq = '42';
  for (const key of ['motionTrail', 'motionTimeline', 'motionFromSceneTimeMs', 'motionThroughSceneTimeMs']) delete missing.projection.entities[0][key];
  motion.update(missing, 20); assert.equal(motion.settled(selfRef, 49), false, '缺字段保留旧hold原时长');
  assert.equal(present(motion, missing, 25), false); motion.sealPresentation(70); assert.equal(motion.presentationCreditMs, 0);
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
