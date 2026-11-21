import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneCoverFit, screenPoint, worldPoint } from '../src/domain/spatial-canvas-geometry.ts';
import { SceneCamera } from '../src/domain/spatial-camera.ts';

test('GZ-FS-01/04：cover四边铺满，镜头夹在世界边界，拖动后的坐标可逆', () => {
  const scene = { width: 1600, height: 1000 }, viewport = { width: 1440, height: 900 };
  const centered = sceneCoverFit(scene, viewport, { x: 800, y: 500 });
  assert.ok(centered.scale > .9, '固定轻微裁切保留两个方向的拖动空间');
  for (const center of [{ x: -100, y: -100 }, { x: 800, y: 500 }, { x: 1800, y: 1200 }]) {
    const fit = sceneCoverFit(scene, viewport, center);
    assert.equal(fit.scale, centered.scale, '平移不改变比例');
    assert.ok(fit.x <= 0 && fit.y <= 0);
    assert.ok(fit.x + scene.width * fit.scale >= viewport.width);
    assert.ok(fit.y + scene.height * fit.scale >= viewport.height);
    const point = { x: 1260, y: 700 }, pixel = screenPoint(point, fit);
    const restored = worldPoint(pixel, fit, scene);
    assert.ok(Math.abs(restored.x - point.x) < 1e-9 && Math.abs(restored.y - point.y) < 1e-9);
  }
  const upper = sceneCoverFit(scene, viewport, { x: 0, y: 0 });
  assert.equal(upper.x, 0); assert.equal(upper.y, 0);
  const lower = sceneCoverFit(scene, viewport, { x: scene.width, y: scene.height });
  assert.ok(Math.abs(lower.x + scene.width * lower.scale - viewport.width) < 1e-9);
  assert.ok(Math.abs(lower.y + scene.height * lower.scale - viewport.height) < 1e-9);
});

const input = (self = { x: 800, y: 500 }, extra = {}) => ({ scope: 'room:view:yard', scene: { width: 1600, height: 1000 }, viewport: { width: 1440, height: 900 }, self, now: 0, reducedMotion: false, ...extra });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('GZ-FS-02/03：跟随采样位置，拖动后不自动拉回，明确回中持续到静止角色位置', () => {
  const camera = new SceneCamera();
  const first = camera.sample(input());
  assert.equal(first.mode, 'follow'); assert.equal(first.canReturn, false);
  const walking = camera.sample(input({ x: 825, y: 510 }, { now: 40 }));
  assert.deepEqual(walking.center, { x: 825, y: 510 });
  assert.equal(walking.fit.scale, first.fit.scale);
  camera.pan({ x: 48, y: -25 });
  const free = camera.sample(input({ x: 850, y: 520 }, { now: 60 }));
  assert.equal(free.mode, 'free'); assert.equal(free.canReturn, true);
  assert.ok(free.center.x < walking.center.x && free.center.y > walking.center.y);
  const moved = camera.sample(input({ x: 860, y: 530 }, { now: 80 }));
  assert.deepEqual(moved.center, free.center, '人物位置改变不会改变自由取景');
  camera.returnToSelf(100);
  const returning = camera.sample(input({ x: 860, y: 530 }, { now: 200 }));
  assert.equal(returning.mode, 'follow'); assert.equal(returning.animating, true);
  assert.ok(distance(returning.center, { x: 860, y: 530 }) < distance(free.center, { x: 860, y: 530 }));
  const done = camera.sample(input({ x: 860, y: 530 }, { now: 500 }));
  assert.deepEqual(done.center, { x: 860, y: 530 });
  assert.equal(done.animating, false); assert.equal(done.canReturn, false);
});

test('GZ-FS-03：自由视角resize保留中心，换授权场景复位，边缘回中不会常亮', () => {
  const camera = new SceneCamera();
  camera.sample(input()); camera.pan({ x: 35, y: 0 });
  const free = camera.sample(input());
  const resized = camera.sample(input(undefined, { viewport: { width: 390, height: 844 } }));
  assert.equal(resized.mode, 'free');
  assert.ok(distance(resized.center, free.center) < 1e-9);
  const reset = camera.sample(input({ x: 0, y: 0 }, { scope: 'room:new-view:road' }));
  assert.equal(reset.mode, 'follow'); assert.equal(reset.canReturn, false);
  assert.equal(reset.fit.x, 0); assert.equal(reset.fit.y, 0);
  camera.pan({ x: 100, y: 100 });
  const edge = camera.sample(input({ x: 0, y: 0 }, { scope: 'room:new-view:road' }));
  assert.equal(edge.mode, 'free'); assert.equal(edge.canReturn, false, '边缘内最近位置已算回中');
  camera.reset();
  assert.equal(camera.sample(input()).mode, 'follow');
});

test('GZ-FS-03：减少动态立即回中，回中途中的新拖动接管镜头', () => {
  const camera = new SceneCamera(); camera.sample(input()); camera.pan({ x: 40, y: 0 }); camera.sample(input());
  camera.returnToSelf(20);
  const reduced = camera.sample(input(undefined, { now: 20, reducedMotion: true }));
  assert.equal(reduced.animating, false); assert.equal(reduced.canReturn, false);
  camera.pan({ x: 40, y: 0 }); camera.sample(input()); camera.returnToSelf(40);
  camera.sample(input(undefined, { now: 80 })); camera.pan({ x: -12, y: 10 });
  const interrupted = camera.sample(input(undefined, { now: 100 }));
  assert.equal(interrupted.mode, 'free'); assert.equal(interrupted.animating, false);
  assert.deepEqual(camera.sample(input({ x: 860, y: 520 }, { now: 500 })).center, interrupted.center);
});
