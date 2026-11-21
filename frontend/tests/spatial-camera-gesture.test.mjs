import test from 'node:test';
import assert from 'node:assert/strict';
import { ScenePointerGesture } from '../src/domain/spatial-camera-gesture.ts';

const pointer = (id = 1, extra = {}) => ({ id, point: { x: 100, y: 100 }, button: 0, primary: true, ...extra });

test('GZ-FS-02/04：小幅点击保留点击，跨阈值拖动只产出平移且结束不误点', () => {
  const gesture = new ScenePointerGesture();
  assert.equal(gesture.begin(pointer()), true);
  assert.equal(gesture.move(1, { x: 104, y: 103 }), null);
  assert.equal(gesture.end(1).click, true);
  assert.equal(gesture.pointerId, null);
  gesture.begin(pointer());
  assert.deepEqual(gesture.move(1, { x: 112, y: 105 }), { x: 12, y: 5 });
  assert.deepEqual(gesture.move(1, { x: 116, y: 109 }), { x: 4, y: 4 });
  assert.equal(gesture.dragging, true);
  assert.equal(gesture.end(1).click, false);
  assert.equal(gesture.move(1, { x: 200, y: 200 }), null);
});

test('GZ-FS-02：多指中断、取消和捕获丢失均不保留旧点击或黏住拖动', () => {
  const gesture = new ScenePointerGesture();
  gesture.begin(pointer()); gesture.move(1, { x: 120, y: 100 });
  assert.equal(gesture.begin(pointer(2, { primary: false })), false);
  assert.equal(gesture.pointerId, null);
  assert.equal(gesture.move(1, { x: 150, y: 100 }), null);
  assert.equal(gesture.end(1).click, false);
  assert.equal(gesture.end(2).click, false);
  assert.equal(gesture.begin(pointer(3)), true);
  gesture.cancel(3);
  assert.equal(gesture.end(3).click, false);
  assert.equal(gesture.begin(pointer(4)), true);
  gesture.cancel();
  assert.equal(gesture.end(4).click, false);
  assert.equal(gesture.begin(pointer(5, { button: 2 })), false);
  assert.equal(gesture.end(5).click, false);
  assert.equal(gesture.begin(pointer(6)), true, '收束后新的主指针可以正常操作');
});

test('GZ-FS-02：第二指仍按住期间不能从第三指重新开始点击', () => {
  const gesture = new ScenePointerGesture();
  gesture.begin(pointer(1)); gesture.begin(pointer(2, { primary: false })); gesture.end(1);
  assert.equal(gesture.begin(pointer(3, { primary: false })), false);
  assert.equal(gesture.end(3).click, false); gesture.end(2);
  assert.equal(gesture.begin(pointer(4)), true); assert.equal(gesture.end(4).click, true);
});
