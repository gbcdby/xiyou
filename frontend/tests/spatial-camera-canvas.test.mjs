import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialCanvas, readCanvasFrame } from '../src/rendering/spatial-canvas.ts';
import { CanvasAssets } from '../src/rendering/canvas-assets.ts';
import { ConfirmedMotion } from '../src/domain/spatial-motion.ts';
import { screenPoint } from '../src/domain/spatial-canvas-geometry.ts';
import { spatialSnapshot } from './spatial-fixture.mjs';

function harness(t) {
  const oldDocument = globalThis.document, oldPath = globalThis.Path2D;
  function makeCanvas() {
    let width = 0, height = 0; const writes = [], resizes = [];
    const context = new Proxy({ drawImage(...args) { writes.push(args); }, isPointInPath() { return false; } }, { get: (target, key) => target[key] ?? (() => {}), set(target, key, value) { target[key] = value; return true; } });
    return { dataset: {}, writes, resizes, get width() { return width; }, set width(value) { width = value; resizes.push(value); }, get height() { return height; }, set height(value) { height = value; resizes.push(value); }, getContext() { return context; } };
  }
  globalThis.document = { createElement: makeCanvas }; globalThis.Path2D = class {};
  t.after(() => { globalThis.document = oldDocument; globalThis.Path2D = oldPath; });
  const canvas = makeCanvas(), renderer = new SpatialCanvas(canvas, new CanvasAssets(() => { throw new Error('未知外观不应加载图片'); })), motion = new ConfirmedMotion();
  const snapshot = spatialSnapshot();
  snapshot.projection.entities.push({ entityRef: 'east-person', name: '东侧旅伴', appearanceEpoch: '0', sceneId: 'yard', position: { x: 900, y: 600 }, facing: 'W' });
  motion.update(snapshot, 0); renderer.prepare(snapshot); renderer.resize(400, 500, 2);
  return { canvas, renderer, motion, snapshot };
}

test('GZ-FS-04：裁切镜头绘图/点地/命中共用真实fit，画外标签不贴边且实体集合不变', t => {
  const h = harness(t), { canvas, renderer, motion, snapshot } = h;
  const frame = renderer.paint(snapshot, motion, 0, { reducedMotion: false, cameraCenter: { x: 1000, y: 400 }, selected: snapshot.projection.self.entityRef });
  assert.ok(frame.fit.scale > .625);
  assert.deepEqual(frame.view, { x: 0, y: 0, width: 1000, height: 800 }, '完整场景边界与镜头可见区域分开');
  assert.ok(frame.cameraView.width < frame.view.width);
  assert.equal(frame.actors.length, 2, '镜头裁切不删除公开实体');
  assert.equal(frame.labels.some(label => label.key === snapshot.projection.self.entityRef), false, '画外本人也不能夹名字到边缘');
  const position = { x: 950, y: 700 }, point = screenPoint(position, frame.fit);
  const mapped = renderer.point(point);
  assert.ok(Math.abs(mapped.x - position.x) < 1e-9 && Math.abs(mapped.y - position.y) < 1e-9);
  assert.equal(renderer.hit(screenPoint({ x: 900, y: 600 }, frame.fit)), 'east-person');
  assert.equal(renderer.point({ x: -1, y: 200 }), null, 'Canvas之外不产生不可见点地');
  const resizes = canvas.resizes.length;
  renderer.paint(snapshot, motion, 10, { reducedMotion: false, cameraCenter: { x: 0, y: 400 } });
  assert.equal(canvas.writes.length, 2, '每次平移仍只完整提交一次');
  assert.equal(canvas.resizes.length, resizes, '平移不重设画布尺寸');
  assert.ok(readCanvasFrame(canvas).labels.some(label => label.key === snapshot.projection.self.entityRef));
  assert.equal(readCanvasFrame(canvas).labels.some(label => label.key === 'east-person'), false);
});

test('GZ-FS-04：未完成的新取景不能替换旧画面命中', t => {
  const { canvas, renderer, motion, snapshot } = harness(t);
  const frame = renderer.paint(snapshot, motion, 0, { reducedMotion: false, cameraCenter: { x: 1000, y: 400 } });
  const foot = screenPoint({ x: 900, y: 600 }, frame.fit);
  const next = structuredClone(snapshot); next.projection.entities[1].position = { x: 920, y: 600 }; motion.update(next, 20);
  assert.throws(() => renderer.paint(next, motion, 30, { reducedMotion: false, cameraCenter: { x: 0, y: 400 }, beforeFrontWrite() { throw new Error('合成未提交'); } }), /合成未提交/);
  assert.deepEqual(readCanvasFrame(canvas), frame);
  assert.equal(renderer.hit(foot), 'east-person');
});
