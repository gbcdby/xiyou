import test from 'node:test';
import assert from 'node:assert/strict';
import { findPath, walkable, clearSegment, pointAlongPath, visibleSegment } from '../../game/spatial-geometry.mjs';
const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const scene = { width: 400, height: 300, gridSize: 10, walkableAreas: [{ areaId: 'floor', polygon: rect(0, 0, 400, 300) }, { areaId: 'room', polygon: rect(160, 80, 80, 140) }], obstacles: [{ obstacleId: 'house', polygon: rect(150, 50, 100, 200), exceptAreas: ['room'] }] };
test('多边形障碍绕行、显式内室扣除与真实路程', () => {
    assert.equal(walkable(scene, { x: 200, y: 100 }), true);
    assert.equal(walkable(scene, { x: 155, y: 100 }), false);
    const a = { x: 50, y: 150 }, b = { x: 350, y: 150 };
    assert.equal(clearSegment(scene, a, b), false);
    const path = findPath(scene, a, b);
    assert.ok(path.length > 2);
    assert.ok(path.every((p, i) => !i || clearSegment(scene, path[i - 1], p)));
    assert.notDeepEqual(pointAlongPath(path, 100).position, b);
    assert.deepEqual(pointAlongPath(path, 10000).position, b);
    assert.equal(findPath(scene, a, { x: 155, y: 100 }), null);
});
test('轨迹可见性不能用两个可见端点跨过中间遮挡', () => {
    const pillar = { width: 400, height: 300, gridSize: 10, walkableAreas: [{ areaId: 'floor', polygon: rect(0, 0, 400, 300) }], obstacles: [{ obstacleId: 'pillar', polygon: rect(180, 120, 40, 40), exceptAreas: [] }] };
    const observer = { x: 100, y: 140 }, a = { x: 300, y: 50 }, b = { x: 300, y: 250 };
    assert.equal(clearSegment(pillar, observer, a), true);
    assert.equal(clearSegment(pillar, observer, b), true);
    assert.equal(visibleSegment(pillar, observer, a, b, 500), false);
    assert.equal(visibleSegment(pillar, observer, { x: 120, y: 50 }, { x: 160, y: 80 }, 500), true);
});
