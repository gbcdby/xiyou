import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { ConfirmedMotion } from '../src/domain/spatial-motion.ts';
import { spatialSnapshot } from './spatial-fixture.mjs';

const trace = JSON.parse(await readFile(new URL('./fixtures/motion-plan-transition.json', import.meta.url), 'utf8'));
function fromUpdate(update) {
  const snapshot = spatialSnapshot(), p = snapshot.projection;
  snapshot.viewId = update.viewId; snapshot.snapshotSeq = update.snapshotSeq;
  Object.assign(p, { self: structuredClone(update.self), movement: structuredClone(update.movement), sceneTimeMs: update.sceneTimeMs, paused: update.paused, mapVersion: update.movement.mapVersion });
  p.entities = [{ ...structuredClone(update.person) }];
  p.sceneOverview = { entities: [{ ...structuredClone(update.person) }], items: [], targets: [] };
  return snapshot;
}

test('PR68原CI跨过连续计划交接的三次确认更新不跳点、归零步态或插入idle', () => {
  const motion = new ConfirmedMotion(), ref = trace.updates[0].self.entityRef;
  for (const update of trace.updates.slice(0, 2)) motion.update(fromUpdate(update), update.at);
  const last = trace.updates[2], before = motion.pose(ref, last.at);
  motion.update(fromUpdate(last), last.at);
  const after = motion.pose(ref, last.at), paint = motion.pose(ref, trace.failedPaint.motionAt);
  assert.deepEqual(after.position, before.position, '新确认段从当前显示位置继续，不能跳到新计划已走到的位置');
  assert.equal(after.distance, before.distance, '计划变化不能清空累计步态距离');
  assert.equal(paint.moving, true, '原serial38只因桥接丢失而插入的idle必须消失');
  assert.ok(paint.distance > before.distance);
  assert.notDeepEqual(paint.position, trace.failedPaint.self.position, '必须重建已确认的路径，不能只改moving标志');
  const end = motion.pose(ref, last.at + last.sceneTimeMs - trace.updates[1].sceneTimeMs + 1);
  assert.deepEqual(end.position, last.self.position, '不能越过已确认位置去播放新计划的未来部分');
});

function turnSnapshots() {
  const previous = spatialSnapshot(), p = previous.projection;
  p.self.position = { x: 0, y: 5 }; p.sceneTimeMs = 1000;
  p.movement = { movementId: 'old-plan', planVersion: '1', movementCommandSeq: '1', sceneId: p.self.sceneId, mapVersion: p.mapVersion, goal: { x: 10, y: 10 }, path: [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }], acceptedAtSceneTime: 900, status: 'moving' };
  const current = structuredClone(previous), q = current.projection;
  current.snapshotSeq = '11'; q.sceneTimeMs = 1300; q.self.position = { x: 15, y: 20 };
  q.movement = { movementId: 'new-plan', planVersion: '2', movementCommandSeq: '2', sceneId: q.self.sceneId, mapVersion: q.mapVersion, goal: { x: 30, y: 20 }, path: [{ x: 10, y: 10 }, { x: 10, y: 20 }, { x: 30, y: 20 }], acceptedAtSceneTime: 1150, status: 'moving' };
  return { previous, current, ref: p.self.entityRef };
}

test('相邻确认计划跨两个折线转弯，保留旧路径与新路径拐点而不直线穿墙', () => {
  const { previous, current, ref } = turnSnapshots(), motion = new ConfirmedMotion();
  motion.update(previous, 1000); motion.update(current, 1300);
  assert.deepEqual(motion.position(ref, 1350), { x: 0, y: 10 });
  assert.deepEqual(motion.position(ref, 1450), { x: 10, y: 10 });
  assert.deepEqual(motion.position(ref, 1550), { x: 10, y: 20 });
  assert.deepEqual(motion.position(ref, 1600), { x: 15, y: 20 });
  assert.equal(motion.pose(ref, 1600).distance, 30);
});

test('跨计划桥接保留尚未播放的旧余段及其剩余时长', () => {
  const { previous, current, ref } = turnSnapshots(), motion = new ConfirmedMotion();
  const initial = structuredClone(previous); initial.projection.sceneTimeMs = 900; initial.projection.self.position = { x: 0, y: 0 };
  motion.update(initial, 1000); motion.update(previous, 1300);
  const before = motion.pose(ref, 1350); assert.deepEqual(before.position, { x: 0, y: 2.5 });
  motion.update(current, 1350);
  assert.deepEqual(motion.pose(ref, 1350), before, '已确认的新段接在显示余段之后，不改变当前显示姿态');
  assert.equal(motion.settled(ref, 1699), false, '新段300ms以外仍须保留旧段未播完的50ms');
  assert.equal(motion.settled(ref, 1700), true);
  const end = motion.pose(ref, 1700); assert.deepEqual(end.position, current.projection.self.position); assert.equal(end.distance, 35);
});

test('大于安全整数的相邻命令和计划版本仍按原十进制序号连接', () => {
  const { previous, current, ref } = turnSnapshots(), motion = new ConfirmedMotion();
  Object.assign(previous.projection.movement, { movementCommandSeq: '9007199254740992', planVersion: '9007199254740992' });
  Object.assign(current.projection.movement, { movementCommandSeq: '9007199254740993', planVersion: '9007199254740993' });
  motion.update(previous, 1000); motion.update(current, 1300);
  assert.deepEqual(motion.position(ref, 1350), { x: 0, y: 10 }); assert.equal(motion.pose(ref, 1350).moving, true);
});

for (const [name, change] of [
  ['新起点不在旧路径', ({ current }) => { current.projection.movement.path[0] = { x: 11, y: 13 }; }],
  ['跨过未见的中间命令', ({ current }) => { current.projection.movement.movementCommandSeq = '3'; }],
  ['跨过未见的中间计划版本', ({ current }) => { current.projection.movement.planVersion = '3'; }],
  ['重复命令序号', ({ current }) => { current.projection.movement.movementCommandSeq = '1'; }],
  ['逆序命令', ({ current }) => { current.projection.movement.movementCommandSeq = '0'; }],
  ['复用旧计划身份', ({ current }) => { current.projection.movement.movementId = 'old-plan'; }],
  ['更换地图', ({ current }) => { current.projection.mapVersion = 'new-map'; current.projection.movement.mapVersion = 'new-map'; }],
  ['计划接纳早于前快照', ({ current }) => { current.projection.movement.acceptedAtSceneTime = 999; }],
  ['计划接纳晚于当前快照', ({ current }) => { current.projection.movement.acceptedAtSceneTime = 1301; }],
  ['旧计划已经取消', ({ previous }) => { previous.projection.movement.status = 'cancelled'; }],
  ['更换控制周期', ({ current }) => { current.projection.self.controlEpoch = '3'; }],
  ['更换本人公开ref', values => { values.ref = values.current.projection.self.entityRef = 'new-self-ref'; values.current.projection.entities = []; }],
  ['更换外观身份', ({ current }) => { current.projection.self.appearanceEpoch = '1'; }],
  ['更换view', ({ current }) => { current.viewId = 'new-view'; }],
  ['更换场景', ({ current }) => { current.projection.self.sceneId = 'new-scene'; current.projection.movement.sceneId = 'new-scene'; }],
]) test(`${name}时不能猜测缺失路径，直接采用当前确认点并重置步态`, () => {
  const values = turnSnapshots(); change(values); const { previous, current, ref } = values, motion = new ConfirmedMotion();
  motion.update(previous, 1000); motion.update(current, 1300);
  const pose = motion.pose(ref, 1350);
  assert.deepEqual(pose.position, current.projection.self.position); assert.equal(pose.moving, false); assert.equal(pose.distance, 0);
});
