import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../../content/index.mjs';
import { clearSegment, distance, findPath, pointAlongPath, walkable } from '../../game/spatial-geometry.mjs';

const content = await loadContent('gaolaozhuang-v1');
const scene = content.scenes.find(s => s.sceneId === 'gaolao-courtyard');
const doorOpen = obstacle => obstacle.obstacleId !== 'sealed-door';
const start = { x: 1250, y: 425 }, goal = { x: 1320, y: 820 };

function checkRoute(map, path, enabled = () => true, allChords = false) {
    assert.ok(path?.length >= 2);
    let travelled = 0;
    for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i], length = distance(a, b), samples = new Set([0, 1]);
        assert.ok(clearSegment(map, a, b, enabled));
        // 检查所有半整数跨界时刻及两侧，而非只固定几个维护周期。
        for (const axis of ['x', 'y'])
            for (let n = 0; n < Math.abs(b[axis] - a[axis]); n++) {
                const t = (n + 0.5) / Math.abs(b[axis] - a[axis]);
                for (const offset of [-1e-8, 0, 1e-8]) samples.add(t + offset);
            }
        const points = new Map();
        for (const t of [...samples].sort((x, y) => x - y)) {
            const { position } = pointAlongPath(path, travelled + length * t);
            assert.ok(Number.isInteger(position.x) && Number.isInteger(position.y));
            assert.ok(walkable(map, position, enabled), JSON.stringify({ a, b, t, position }));
            assert.ok(distance(position, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }) <= Math.SQRT1_2 + 1e-7, '量化误差不得造成跳坐标');
            points.set(`${position.x},${position.y}`, position);
        }
        const values = [...points.values()];
        for (let j = 1; j < values.length; j++) {
            assert.ok(clearSegment(map, values[j - 1], values[j], enabled));
            if (allChords)
                for (let k = 0; k < j; k++)
                    assert.ok(clearSegment(map, values[k], values[j], enabled), JSON.stringify({ from: values[k], to: values[j] }));
        }
        travelled += length;
    }
    const final = pointAlongPath(path, travelled + 1);
    assert.equal(final.arrived, true);
    assert.deepEqual(final.position, path.at(-1));
}

test('R32REQ005：C01 到 C19 原反例及邻近检查点保持合法整数位置', () => {
    const original = [start, { x: 1330, y: 800 }, goal];
    assert.ok(original.slice(1).every((p, i) => clearSegment(scene, original[i], p, doorOpen)));
    assert.equal(walkable(scene, { x: 1320, y: 755 }, doorOpen), false);
    const path = findPath(scene, start, goal, doorOpen);
    assert.ok(path);
    for (let elapsedMs = 1860; elapsedMs <= 1890; elapsedMs++) {
        const { position } = pointAlongPath(path, elapsedMs * content.movement.speedPerSecond / 1000);
        assert.ok(Number.isInteger(position.x) && Number.isInteger(position.y));
        assert.ok(walkable(scene, position, doorOpen), `${elapsedMs}ms: ${JSON.stringify(position)}`);
    }
});

test('负斜率网格边的半格取整仍留在合法边界上', () => {
    const triangle = { width: 20, height: 20, gridSize: 10, walkableAreas: [{ areaId: 'floor', polygon: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 20 }] }], obstacles: [] };
    const path = findPath(triangle, { x: 0, y: 20 }, { x: 20, y: 0 });
    assert.ok(path);
    for (let step = 0; step < 20; step++) {
        const { position } = pointAlongPath(path, (step + 0.5) * Math.SQRT2);
        assert.ok(walkable(triangle, position), JSON.stringify(position));
        assert.equal(position.x + position.y, 20);
    }
});

test('C01/C19 邻域与反向路径的全部量化跨界位置合法，两个任意检查点间不穿墙', () => {
    for (const [from, to] of [[start, goal], [goal, start]]) {
        checkRoute(scene, findPath(scene, from, to, doorOpen), doorOpen, true);
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nearStart = { x: from.x + dx, y: from.y + dy }, nearGoal = { x: to.x - dx, y: to.y - dy };
            checkRoute(scene, findPath(scene, nearStart, nearGoal, doorOpen), doorOpen);
        }
    }
});

test('静态薄墙、真实关闭的门及障碍顶点仍不可穿越', () => {
    const rectangle = (x, y, width, height) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
    const barrier = { width: 40, height: 40, gridSize: 5, walkableAreas: [{ areaId: 'floor', polygon: rectangle(0, 0, 40, 40) }], obstacles: [{ obstacleId: 'gate', polygon: rectangle(20, 0, 1, 40) }] };
    const left = { x: 10, y: 12 }, right = { x: 30, y: 27 };
    assert.equal(clearSegment(barrier, left, right), false);
    assert.equal(findPath(barrier, left, right), null);
    const openPath = findPath(barrier, left, right, () => false);
    checkRoute(barrier, openPath, () => false, true);
    assert.equal(clearSegment(barrier, openPath[0], openPath.at(-1)), false);
    assert.equal(findPath(scene, start, { x: 1320, y: 755 }, doorOpen), null);
});

test('沿长斜墙的合法原线段不能让取整点碰墙，即使附近没有障碍顶点', () => {
    const diagonalWall = { width: 100, height: 100, gridSize: 5, walkableAreas: [{ areaId: 'floor', polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] }], obstacles: [{ obstacleId: 'wall', polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }] }] };
    const from = { x: 1, y: 1 }, to = { x: 99, y: 50 };
    assert.equal(clearSegment(diagonalWall, from, to), true);
    assert.equal(walkable(diagonalWall, { x: 2, y: 1 }), false);
    for (const [a, b] of [[from, to], [to, from]])
        checkRoute(diagonalWall, findPath(diagonalWall, a, b), () => true, true);
});

test('网格直线不能把相切的真实障碍顶点当作可站位点', () => {
    const tangent = { width: 20, height: 20, gridSize: 5, walkableAreas: [{ areaId: 'floor', polygon: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }] }], obstacles: [{ obstacleId: 'tip', polygon: [{ x: 5, y: 10 }, { x: 8, y: 6 }, { x: 2, y: 6 }] }] };
    assert.equal(walkable(tangent, { x: 5, y: 10 }), false);
    checkRoute(tangent, findPath(tangent, { x: 0, y: 10 }, { x: 20, y: 10 }), () => true, true);
});

test('预审G1：短斜窄走区仍接受所有量化站位与检查点连线均合法的直路', () => {
    const narrow = { width: 20, height: 10, gridSize: 10, walkableAreas: [{ areaId: 'narrow', polygon: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 2 }, { x: 2, y: 2 }] }], obstacles: [] };
    const points = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 2 }];
    for (const p of points) {
        assert.ok(walkable(narrow, p));
        for (const q of points) assert.ok(clearSegment(narrow, p, q));
    }
    checkRoute(narrow, findPath(narrow, points[0], points.at(-1)), () => true, true);
});

test('预审G2：公开整数和网格预算内的大坐标相切障碍顶点仍被避开', () => {
    const large = { width: 50000, height: 900000, gridSize: 1000, walkableAreas: [{ areaId: 'floor', polygon: [{ x: 0, y: 0 }, { x: 50000, y: 0 }, { x: 50000, y: 900000 }, { x: 0, y: 900000 }] }], obstacles: [{ obstacleId: 'tip', polygon: [{ x: 29000, y: 100 }, { x: 28999, y: 900000 }, { x: 29001, y: 900000 }] }] };
    assert.ok((Math.floor(large.width / large.gridSize) + 1) * (Math.floor(large.height / large.gridSize) + 1) <= 50000);
    assert.equal(walkable(large, { x: 29000, y: 100 }), false);
    const path = findPath(large, { x: 0, y: 100 }, { x: 50000, y: 100 });
    assert.ok(path);
    assert.ok(path.slice(1).every((p, i) => clearSegment(large, path[i], p)));
    for (const travel of [28999.5, 29000, 29000.5])
        assert.ok(walkable(large, pointAlongPath(path, travel).position));
});

test('预审G1：超过64跨度的合法长斜窄走区仍可直达', () => {
    const narrow = { width: 100, height: 100, gridSize: 10, walkableAreas: [{ areaId: 'narrow', polygon: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 66, y: 33 }, { x: 67, y: 34 }, { x: 66, y: 34 }, { x: 2, y: 2 }] }], obstacles: [] };
    const from = { x: 1, y: 1 }, to = { x: 67, y: 34 };
    assert.equal(clearSegment(narrow, from, to), true);
    const path = findPath(narrow, from, to);
    assert.deepEqual(path, [from, to]);
    checkRoute(narrow, path, () => true, true);
    checkRoute(narrow, findPath(narrow, to, from), () => true, true);
});

test('同时跨越半格时，浮点误差不能把同一量化事件拆成带外站位', () => {
    const narrow = { width: 10, height: 30, gridSize: 5, walkableAreas: [{ areaId: 'narrow', polygon: [{ x: 0, y: 0 }, { x: 0, y: 4 }, { x: 2, y: 22 }, { x: 3, y: 27 }, { x: 3, y: 23 }, { x: 1, y: 5 }] }], obstacles: [] };
    const path = [{ x: 0, y: 0 }, { x: 3, y: 27 }], travel = Math.hypot(3, 27) * 5 / 6;
    assert.ok(walkable(narrow, pointAlongPath(path, travel).position));
});

test('公开坐标上限的互质长窄带有界回退仍可直达', t => {
    const size = 1000000, from = { x: 0, y: 0 }, to = { x: size, y: size - 1 };
    const narrow = { width: size, height: size - 1, gridSize: 10000, walkableAreas: [{ areaId: 'narrow', polygon: [from, { x: 1, y: 0 }, to, { x: size - 1, y: size - 1 }] }], obstacles: [] };
    const started = performance.now(), path = findPath(narrow, from, to), elapsedMs = performance.now() - started;
    assert.deepEqual(path, [from, to]);
    for (const fraction of [0, 0.12345, 0.5, 0.999999, 1])
        assert.ok(walkable(narrow, pointAlongPath(path, distance(from, to) * fraction).position));
    t.diagnostic(JSON.stringify({ scope: '公开坐标上限互质回退样本，不是整局运行性能', dx: size, dy: size - 1, gcd: 1, derivedAddCalls: 2 * size, elapsedMs, processMaxRssKiB: process.resourceUsage().maxRSS }));
});
