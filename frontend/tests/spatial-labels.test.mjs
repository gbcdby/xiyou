import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutSpatialLabels, screenPosition } from '../src/domain/spatial-labels.ts';

function intersects(a, b) { return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y; }
const actor = (key, x, y, extra = {}) => ({ key, label: '同名人物', point: { x, y }, footprint: { x: x - 10, y: y - 17, width: 20, height: 30 }, selectable: true, priority: 1, ...extra });

test('五人密集站位在窄视口仍有独立44px入口，文字不重叠也不压住脚底人物', () => {
  const actors = [actor('self', 80, 55, { priority: 0 }), ...[1, 2, 3, 4].map(i => actor('person-' + i, 80 + i * 12, 55))];
  const result = layoutSpatialLabels(actors, { width: 358, height: 330 });
  assert.equal(result.labels.length, 5);
  for (const label of result.labels) {
    assert.ok(label.width >= 44 && label.height >= 44);
    assert.ok(label.x >= 8 && label.y >= 8 && label.x + label.width <= 350 && label.y + label.height <= 322);
    for (const other of result.labels) if (other.key !== label.key) assert.equal(intersects(label, other), false);
    for (const person of actors) assert.equal(intersects(label, person.footprint), false);
  }
});

test('地图边缘对象的屏幕文字不裁切，授权引用保持各自独立', () => {
  const result = layoutSpatialLabels([actor('left', 2, 2), actor('right', 354, 325)], { width: 358, height: 330 });
  assert.deepEqual(new Set(result.labels.map(label => label.key)), new Set(['left', 'right']));
  for (const label of result.labels) assert.ok(label.x >= 8 && label.y >= 8 && label.x + label.width <= 350 && label.y + label.height <= 322);
});

test('超过屏幕容量时保留本人/选中对象，其他标签明确计入待列表查看项', () => {
  const inputs = [actor('self', 90, 100, { priority: 0 }), actor('selected', 110, 100, { priority: 0 }), ...Array.from({ length: 25 }, (_, i) => actor('other-' + i, 180, 120, { priority: 2 }))];
  const result = layoutSpatialLabels(inputs, { width: 358, height: 330 });
  assert.ok(result.labels.some(label => label.key === 'self'));
  assert.ok(result.labels.some(label => label.key === 'selected'));
  assert.ok(result.omitted > 0);
  assert.equal(result.omitted + result.labels.length, inputs.length);
});

test('CSS像素映射保留SVG等比留白，放大或缩小不改变原世界脚底', () => {
  assert.deepEqual(screenPosition({ x: 100, y: 100 }, { x: 0, y: 0, width: 1000, height: 800 }, { width: 350, height: 350 }), { x: 35, y: 70, scale: .35 });
  assert.deepEqual(screenPosition({ x: 500, y: 400 }, { x: 200, y: 100, width: 600, height: 600 }, { width: 900, height: 600 }), { x: 450, y: 300, scale: 1 });
});
