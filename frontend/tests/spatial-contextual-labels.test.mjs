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
    const context = new Proxy({ drawImage(...args) { writes.push(args); }, isPointInPath() { return false; } }, {
      get: (target, key) => target[key] ?? (() => {}), set(target, key, value) { target[key] = value; return true; },
    });
    return { dataset: {}, writes, resizes, get width() { return width; }, set width(value) { width = value; resizes.push(value); }, get height() { return height; }, set height(value) { height = value; resizes.push(value); }, getContext() { return context; } };
  }
  globalThis.document = { createElement: makeCanvas }; globalThis.Path2D = class {};
  t.after(() => { globalThis.document = oldDocument; globalThis.Path2D = oldPath; });
  const canvas = makeCanvas(), renderer = new SpatialCanvas(canvas, new CanvasAssets(() => { throw new Error('未知外观不应加载图片'); })), motion = new ConfirmedMotion();
  const snapshot = spatialSnapshot();
  snapshot.projection.entities.push(
    { entityRef: 'elder', name: '高太公', appearanceEpoch: '0', sceneId: 'yard', position: { x: 600, y: 400 }, facing: 'S' },
    { entityRef: 'carpenter', name: '木匠学徒', appearanceEpoch: '0', sceneId: 'yard', position: { x: 600, y: 302 }, facing: 'S' },
  );
  snapshot.projection.targets.push({ entityRef: 'support', name: '门撑承力点', sceneId: 'yard', position: { x: 800, y: 600 }, fields: [], availableOperations: [] });
  snapshot.projection.items.push({ entityRef: 'rope', name: '公共绳索', resourceRevision: '0', location: { kind: 'ground', sceneId: 'yard', position: { x: 300, y: 500 } }, fields: [] });
  motion.update(snapshot, 0); renderer.prepare(snapshot); renderer.resize(1000, 800, 2);
  return { canvas, renderer, motion, snapshot };
}

test('GZ-HC-04：按上下文显示原名称，全量默认与对象身体命中保持兼容', t => {
  const { canvas, renderer, motion, snapshot } = harness(t);
  const options = { reducedMotion: true, personLabels: { elder: '4号 · 高太公' } };
  const all = renderer.paint(snapshot, motion, 0, options), resized = canvas.resizes.length;
  assert.equal(all.labels.find(label => label.key === 'elder').label, '4号 · 高太公', '默认模式保留原编号名称');
  assert.deepEqual(new Set(all.labels.map(label => label.key)), new Set([snapshot.projection.self.entityRef, 'elder', 'carpenter', 'support', 'rope']));

  const quiet = renderer.paint(snapshot, motion, 1, { ...options, labelMode: 'contextual' });
  assert.deepEqual(quiet.labels, [], '未悬停或选中时不常驻名称');
  assert.deepEqual(quiet.actors, all.actors); assert.deepEqual(quiet.objects, all.objects);
  assert.deepEqual(quiet.fit, all.fit); assert.deepEqual(quiet.viewport, all.viewport); assert.deepEqual(quiet.view, all.view);
  for (const object of [...quiet.actors, ...quiet.objects]) assert.equal(renderer.hit(screenPoint(object.position, quiet.fit)), object.ref, '无名称也可命中本体：' + object.ref);

  const hovered = renderer.paint(snapshot, motion, 2, { ...options, labelMode: 'contextual', hovered: 'elder' });
  assert.deepEqual(hovered.labels.map(label => [label.key, label.label]), [['elder', '高太公']], '悬停仅显示原姓名');
  const selected = renderer.paint(snapshot, motion, 3, { ...options, labelMode: 'contextual', selected: 'support', hovered: 'elder' });
  assert.deepEqual(new Set(selected.labels.map(label => label.key)), new Set(['elder', 'support']));
  for (const label of selected.labels) assert.equal(renderer.hit({ x: label.x + label.width / 2, y: label.y + label.height / 2 }), label.key, '可见名称仍可点选');
  const restored = renderer.paint(snapshot, motion, 4, { ...options, labelMode: 'all' });
  assert.deepEqual(restored.labels.map(label => [label.key, label.label]), all.labels.map(label => [label.key, label.label]), '主动全量展开恢复原名称集合与编号');
  assert.equal(canvas.resizes.length, resized, '标签切换不重设画布尺寸');

  assert.throws(() => renderer.paint(snapshot, motion, 5, { ...options, labelMode: 'contextual', selected: 'support', beforeFrontWrite() { throw new Error('受控提交失败'); } }), /受控提交失败/);
  assert.deepEqual(readCanvasFrame(canvas), restored, '失败时保留上次真正提交的名称和画面');
  const elder = restored.labels.find(label => label.key === 'elder');
  assert.equal(renderer.hit({ x: elder.x + elder.width / 2, y: elder.y + elder.height / 2 }), 'elder');
});

test('GZ-HC-04：隐藏名称的人物仍提供避让范围，画外选中名称不贴边出现', t => {
  const { renderer, motion, snapshot } = harness(t);
  const frame = renderer.paint(snapshot, motion, 0, { reducedMotion: true, labelMode: 'contextual', selected: 'elder' });
  assert.equal(frame.labels.length, 1);
  const label = frame.labels[0], hiddenBody = { x: 578, y: 220, width: 44, height: 90 };
  const overlaps = label.x < hiddenBody.x + hiddenBody.width && label.x + label.width > hiddenBody.x && label.y < hiddenBody.y + hiddenBody.height && label.y + label.height > hiddenBody.y;
  assert.equal(overlaps, false, '木匠姓名收起后仍不能被高太公姓名压住身体');
  const moved = structuredClone(snapshot), carpenter = moved.projection.entities.find(person => person.entityRef === 'carpenter');
  carpenter.position = { x: label.x + label.width / 2, y: label.y + label.height };
  motion.update(moved, 1); renderer.prepare(moved);
  const displaced = renderer.paint(moved, motion, 1, { reducedMotion: true, labelMode: 'contextual', selected: 'elder' }).labels[0];
  assert.ok(displaced, '隐藏身体移动后仍保留当前对象名称');
  assert.equal(displaced.x < carpenter.position.x + 22 && displaced.x + displaced.width > carpenter.position.x - 22
    && displaced.y < carpenter.position.y + 8 && displaced.y + displaced.height > carpenter.position.y - 82, false, '几何缓存须跟随隐藏身体的新位置避让');
  renderer.resize(400, 500, 2);
  const outside = renderer.paint(snapshot, motion, 1, { reducedMotion: true, labelMode: 'contextual', selected: snapshot.projection.self.entityRef, cameraCenter: { x: 1000, y: 400 } });
  assert.deepEqual(outside.labels, [], '裁切之外的选中对象不会生成贴边名称');
  assert.equal(outside.actors.length, frame.actors.length, '画外及名称隐藏均不删公开人物');
});
