import assert from 'node:assert/strict';
import test from 'node:test';
import * as canvasEvidence from './canvas-browser-support.mjs';

const { assertPaintContinuity, assertLateCanvasEvidence } = canvasEvidence;

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

function lateFixture(paintCount = 11) {
  const binding = { sceneId: 'yard', viewId: 'observer-view', controlEpoch: '2', selfRef: 'observer-self' };
  const submission = (direction, clientActionId, observedSeq) => {
    const request = { sessionId: 'session', viewId: binding.viewId, controlEpoch: binding.controlEpoch, actorRef: binding.selfRef, clientActionId,
      action: { kind: 'move_direction', sceneId: binding.sceneId, direction, movementCommandSeq: direction === 'SE' ? '3' : '4' } };
    return { enteredAt: direction === 'SE' ? 10 : 20, raw: JSON.stringify(request), request,
      receipt: { sessionId: request.sessionId, clientActionId, status: 'Accepted', observedSeq } };
  };
  const paints = Array.from({ length: paintCount }, (_, index) => {
    const row = paint(index + 1, 100 + index * 20, index);
    return { ...row, phase: index === paintCount - 1 ? 'stopped' : 'down-only', snapshotSeq: index === 0 ? '19' : index === 1 ? '20' : '30',
      self: { ...row.self, moving: index > 0, facing: index === 1 ? 'SE' : 'S' } };
  });
  return { capture: { paints, frames: [] }, options: { ...binding, selected: submission('SE', 'original-A', '20'), firstSouth: submission('S', 'first-S', '30') } };
}

test('late在原捕获内按真实SE/S paint计数，stopped中的已确认播放不被输入标签截断', () => {
  const { capture, options } = lateFixture();
  const result = assertLateCanvasEvidence(capture, options);
  assert.equal(result.unit, 'actual-paint'); assert.equal(result.qualifiedPaints, 10);
  assert.equal(result.totalPaints, 11); assert.equal(result.continuityIntervals, 10);
  assert.deepEqual(result.phaseCounts, { 'down-only': 9, stopped: 1 });
  assert.deepEqual(result.anchors, { SE: { clientActionId: 'original-A', observedSeq: '20' }, S: { clientActionId: 'first-S', observedSeq: '30' } });
  assert.equal(result.binding.selfRef, 'observer-self'); assert.equal(result.binding.instance, 'scene-instance');
});

test('late仅9个真实合格paint时，重复读取、前导E、静态或原覆盖线前历史均不能凑够10次', () => {
  for (const alter of [
    paints => { paints.at(-1).self.moving = false; },
    paints => { paints.at(-1).self.facing = 'E'; },
    paints => { paints.at(-1).snapshotSeq = '29'; },
    paints => { paints[1].snapshotSeq = '19'; },
  ]) {
    const { capture, options } = lateFixture(); alter(capture.paints);
    capture.frames = Array.from({ length: 200 }, () => ({ ...capture.paints[2], phase: 'down-only' }));
    assert.throws(() => assertLateCanvasEvidence(capture, options), /至少10次/);
  }
});

test('late必须保持原场景和本人绑定，不能用同数量的其他view或epoch绘制替代', () => {
  for (const [key, value] of [['sceneId', 'other-yard'], ['viewId', 'other-view'], ['controlEpoch', '3'], ['selfRef', 'other-self']]) {
    const { capture, options } = lateFixture();
    for (const row of capture.paints) { if (key === 'selfRef') row.self.ref = value; else row[key] = value; }
    assert.throws(() => assertLateCanvasEvidence(capture, options), /原场景和本人绑定/);
  }
});

test('late不跨renderer、instance或appearance身份边界合并数量，即使剩余区间超过10', () => {
  for (const [key, value] of [['rendererId', 2], ['instance', 'second-instance'], ['appearanceEpoch', 'second-appearance']]) {
    const { capture, options } = lateFixture(13); capture.paints.at(-1)[key] = value;
    assert.throws(() => assertLateCanvasEvidence(capture, options), /身份或实例边界/);
  }
});

test('late必须检查完整paint流，不能筛掉E或静态超速帧、遗漏或重复serial', () => {
  for (const alter of [
    row => { row.self.facing = 'E'; row.self.position.x = 30; },
    row => { row.self.moving = false; row.self.position.x = 30; },
    row => { row.serial += 1; },
    row => { row.serial -= 1; },
  ]) {
    const { capture, options } = lateFixture(13); alter(capture.paints[1]);
    assert.throws(() => assertLateCanvasEvidence(capture, options), /超速跳点|不能遗漏实际绘制/);
  }
});

test('late覆盖线必须属于传入的原A和首S Accepted收据，不能以其他成功结果替换', () => {
  for (const name of ['selected', 'firstSouth']) {
    for (const alter of [
      options => { options[name].receipt.status = 'Rejected'; },
      options => { options[name].receipt.clientActionId = 'another-accepted'; },
      options => { options[name].receipt.sessionId = 'another-session'; },
      options => { options[name] = null; },
      options => { options[name].raw = JSON.stringify({ ...options[name].request, clientActionId: 'original-but-different' }); },
      options => { options[name].request.action.direction = 'E'; options[name].raw = JSON.stringify(options[name].request); },
    ]) {
      const { capture, options } = lateFixture(); alter(options);
      assert.throws(() => assertLateCanvasEvidence(capture, options), /覆盖锚点|原Accepted|Receipt身份|原始请求|原方向/);
    }
  }
});

test('late原请求也须属于同场景和本人绑定，两个锚点不能来自不同房间或同一动作ID', () => {
  for (const name of ['selected', 'firstSouth']) {
    for (const [key, value] of [['sceneId', 'other-yard'], ['viewId', 'other-view'], ['controlEpoch', '3'], ['actorRef', 'other-self']]) {
      const { capture, options } = lateFixture(), row = options[name];
      if (key === 'sceneId') row.request.action.sceneId = value; else row.request[key] = value;
      row.raw = JSON.stringify(row.request);
      assert.throws(() => assertLateCanvasEvidence(capture, options), /原请求绑定/);
    }
  }
  for (const alter of [
    row => { row.request.sessionId = 'second-session'; row.receipt.sessionId = 'second-session'; },
    row => { row.request.clientActionId = 'original-A'; row.receipt.clientActionId = 'original-A'; },
  ]) {
    const { capture, options } = lateFixture(); alter(options.firstSouth); options.firstSouth.raw = JSON.stringify(options.firstSouth.request);
    assert.throws(() => assertLateCanvasEvidence(capture, options), /同一房间|不同原动作/);
  }
});

test('late的原Receipt覆盖线和候选paint序号必须为无精度损失的十进制字符串', () => {
  for (const value of [0, undefined, '', '-1', '30.5']) {
    for (const name of ['selected', 'firstSouth']) {
      const { capture, options } = lateFixture(); options[name].receipt.observedSeq = value;
      assert.throws(() => assertLateCanvasEvidence(capture, options), /observedSeq/);
    }
    const { capture, options } = lateFixture(); capture.paints[2].snapshotSeq = value;
    assert.throws(() => assertLateCanvasEvidence(capture, options), /snapshotSeq/);
  }
});
