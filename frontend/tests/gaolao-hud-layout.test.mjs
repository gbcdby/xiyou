import test from 'node:test';
import assert from 'node:assert/strict';
import { placeHudCard, cameraForHud } from '../src/domain/gaolao-hud-layout.ts';
import { screenPosition } from '../src/domain/spatial-labels.ts';

const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const protect = r => ({ x: r.x - 16, y: r.y - 16, width: r.width + 32, height: r.height + 32 });
const within = (r, b) => r.x >= b.x && r.y >= b.y && r.x + r.width <= b.x + b.width && r.y + r.height <= b.y + b.height;

test('动作卡换边避让当前身体与名字各16px，不改保护对象坐标', () => {
  const bodies = [{ x: 1260, y: 420, width: 55, height: 85 }, { x: 1220, y: 510, width: 160, height: 44 }];
  const original = structuredClone(bodies), bounds = { x: 30, y: 130, width: 1540, height: 745 };
  const placed = placeHudCard({ bounds, preferred: { x: 1310, y: 470 }, size: { width: 260, height: 240 }, protectedRegions: bodies, reserved: [], minHeight: 140 });
  assert.ok(placed.rect && within(placed.rect, bounds)); assert.equal(placed.collapsed, false);
  for (const body of bodies) assert.equal(overlaps(placed.rect, protect(body)), false);
  assert.deepEqual(bodies, original);
});

test('390窄屏在人物保护区之外压缩阅读高度，仍保留可滚动内容空间', () => {
  const bounds = { x: 12, y: 130, width: 366, height: 501 };
  const bodies = [{ x: 170, y: 285, width: 50, height: 80 }, { x: 112, y: 222, width: 166, height: 44 }];
  const placed = placeHudCard({ bounds, preferred: { x: 12, y: 401 }, size: { width: 366, height: 230 }, protectedRegions: bodies, reserved: [], minHeight: 140 });
  assert.ok(placed.rect && within(placed.rect, bounds)); assert.equal(placed.collapsed, false);
  assert.ok(placed.rect.height >= 140);
  for (const body of bodies) assert.equal(overlaps(placed.rect, protect(body)), false);
});

test('卡片不会覆盖固定停步/目标区域，无完整空间时只返回安全短卡', () => {
  const bounds = { x: 12, y: 130, width: 366, height: 500 };
  const protectedRegions = [{ x: 12, y: 260, width: 366, height: 180 }];
  const reserved = [{ x: 12, y: 500, width: 366, height: 130 }];
  const placed = placeHudCard({ bounds, preferred: { x: 12, y: 200 }, size: { width: 366, height: 440 }, protectedRegions, reserved, minHeight: 140 });
  assert.ok(placed.rect && within(placed.rect, bounds)); assert.equal(placed.collapsed, true);
  assert.ok(placed.rect.height >= 44);
  assert.equal(overlaps(placed.rect, protect(protectedRegions[0])), false);
  assert.equal(overlaps(placed.rect, reserved[0]), false);
});

test('没有任何安全短卡位置时明确报告未放置，不能把遮挡结果冒充可用', () => {
  const bounds = { x: 0, y: 0, width: 390, height: 200 };
  const result = placeHudCard({ bounds, preferred: { x: 0, y: 0 }, size: { width: 300, height: 180 }, protectedRegions: [bounds], reserved: [], minHeight: 140 });
  assert.equal(result.rect, null); assert.equal(result.collapsed, true);
});

test('HUD相机把本人/目标脚底映射到真实可见空域，保持原世界位置与纵横比例', () => {
  const viewport = { width: 390, height: 844 }, scene = { width: 1600, height: 1000 };
  const safe = { x: 28, y: 202, width: 334, height: 183 };
  const positions = [{ x: 950, y: 650 }, { x: 1000, y: 620 }], original = structuredClone(positions);
  const view = cameraForHud({ viewport, scene, safeArea: safe, positions });
  assert.ok(view.width > 0 && view.height > 0);
  assert.ok(Math.abs(view.width / view.height - viewport.width / viewport.height) < 1e-9);
  for (const p of positions) {
    const point = screenPosition(p, view, viewport);
    assert.ok(point.x > safe.x && point.x < safe.x + safe.width);
    assert.ok(point.y > safe.y && point.y < safe.y + safe.height);
  }
  assert.deepEqual(positions, original);
});

test('场景边缘仍有合法取景时，HUD相机保持完整地图覆盖视口，不为让卡片腾空制造大片底色', () => {
  const viewport = { width: 1600, height: 1000 }, scene = { width: 1600, height: 1000 };
  for (const entry of [
    { safeArea: { x: 360, y: 132, width: 804, height: 727 }, positions: [{ x: 315, y: 390 }] },
    { safeArea: { x: 360, y: 132, width: 1194, height: 538 }, positions: [{ x: 1320, y: 300 }, { x: 1250, y: 280 }] },
  ]) {
    const view = cameraForHud({ viewport, scene, ...entry });
    assert.ok(within(view, { x: 0, y: 0, ...scene }), '当前真实地图边界内有可行镜头，不应露出地图外底色');
    for (const position of entry.positions) {
      const point = screenPosition(position, view, viewport);
      assert.ok(point.x - 106 >= entry.safeArea.x && point.x + 106 <= entry.safeArea.x + entry.safeArea.width);
      assert.ok(point.y - 90 * point.scale - 70 >= entry.safeArea.y && point.y + 60 <= entry.safeArea.y + entry.safeArea.height);
    }
  }
});
