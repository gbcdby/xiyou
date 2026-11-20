import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPaintContinuity } from './canvas-browser-support.mjs';

const paint = (serial, motionAt, x, distance = x) => ({ rendererId: 1, instance: 'scene-instance', serial, sceneId: 'yard', viewId: 'observer-view', controlEpoch: '2', appearanceEpoch: 'opaque-appearance', motionAt,
  self: { ref: 'observer-self', position: { x, y: 0 }, distance, moving: true } });

test('take先于draw且50→16.667ms调度时，用全部真实paint时钟保持原速度门槛', () => {
  const paints = [paint(1, 200, 0), paint(2, 250, 9), paint(3, 266.6666666667, 12)];
  const frames = [{ at: 250, serial: 1, self: paints[0].self }, { at: 260, serial: 1, self: paints[0].self }, { at: 266.6666666667, serial: 2, self: paints[1].self }];
  const oldDelta = frames[2].self.position.x - frames[0].self.position.x, oldDt = frames[2].at - frames[0].at;
  assert.ok(oldDelta > 180 * oldDt / 1000 + 4, '原读取时钟确实把合法绘制误判为超速');
  const capture = { paints, frames }, intervals = assertPaintContinuity(capture);
  assert.equal(intervals.length, 2); assert.equal(intervals[0].delta, 9); assert.equal(intervals[0].dt, 50); assert.equal(intervals[0].limit, 13);
  assert.equal(intervals[1].to.serial, 3, '未被take读到的实际paint也必须检查'); assert.equal(capture.failedInterval, undefined);
});

test('真实360/450单位每秒的三条产品反例仍被同一180*dt+4检查器拒绝', () => {
  for (const paints of [
    [paint(1, 300, 18), paint(2, 333.3333333333, 30)],
    [paint(1, 350, 9), paint(2, 366.6666666667, 16.5)],
    [paint(1, 500, 0), paint(2, 516.6666666667, 7.5)],
  ]) {
    const capture = { paints }; assert.throws(() => assertPaintContinuity(capture), /确认段不发生超速跳点/);
    assert.ok(capture.failedInterval.delta > capture.failedInterval.limit);
  }
});

test('不能丢掉take未读到的中间超速帧、同时间位移或伪造重复serial', () => {
  const middle = { paints: [paint(1, 0, 0), paint(2, 16.667, 20), paint(3, 33.334, 0, 40)], frames: [{ serial: 1 }, { serial: 3 }] };
  assert.throws(() => assertPaintContinuity(middle), /确认段不发生超速跳点/); assert.equal(middle.failedInterval.to.serial, 2);
  assert.throws(() => assertPaintContinuity({ paints: [paint(1, 100, 0), paint(2, 100, 6)] }), /确认段不发生超速跳点/);
  for (const serial of [1, 3]) assert.throws(() => assertPaintContinuity({ paints: [paint(1, 100, 0), paint(serial, 117, 3)] }), /连续实例不能遗漏实际绘制/);
  assert.throws(() => assertPaintContinuity({ paints: [paint(1, 100, 10), paint(2, 117, 13, 0)] }), /步态相位不重置/);
});

test('真实实例或身份边界显式记录，不能把新场景首帧与旧角色位置配对', () => {
  const first = paint(12, 100, 100), next = { ...paint(1, 117, 0), rendererId: 2, instance: 'new-scene', sceneId: 'road', viewId: 'new-view', controlEpoch: '3', appearanceEpoch: 'new-opaque-appearance' };
  const capture = { paints: [first, next] }; assert.deepEqual(assertPaintContinuity(capture), []);
  assert.equal(capture.motionBoundaries.length, 1); assert.ok(capture.motionBoundaries[0].changed.includes('rendererId'));
});
