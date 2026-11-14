export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function onEdge(a, b, p) { return Math.abs(cross(a, b, p)) < 1e-7 && p.x >= Math.min(a.x, b.x) - 1e-7 && p.x <= Math.max(a.x, b.x) + 1e-7 && p.y >= Math.min(a.y, b.y) - 1e-7 && p.y <= Math.max(a.y, b.y) + 1e-7; }
export function inPolygon(p, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[j], b = polygon[i];
        if (onEdge(a, b, p))
            return true;
        if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x)
            inside = !inside;
    }
    return inside;
}
export function walkable(scene, p, enabled = () => true) {
    if (p.x < 0 || p.y < 0 || p.x > scene.width || p.y > scene.height)
        return false;
    if (!scene.walkableAreas.some(a => inPolygon(p, a.polygon)))
        return false;
    return !scene.obstacles.some(o => enabled(o) && inPolygon(p, o.polygon) && !(o.exceptAreas ?? []).some(id => scene.walkableAreas.some(a => a.areaId === id && inPolygon(p, a.polygon))));
}
// 对每个多边形边界交点划分区间，避免细墙被离散采样跨过。
export function clearSegment(scene, a, b, enabled = () => true) {
    if (!walkable(scene, a, enabled) || !walkable(scene, b, enabled))
        return false;
    const cuts = [0, 1], dx = b.x - a.x, dy = b.y - a.y;
    for (const { polygon } of [...scene.walkableAreas, ...scene.obstacles])
        for (let i = 0; i < polygon.length; i++) {
            const c = polygon[i], d = polygon[(i + 1) % polygon.length], ex = d.x - c.x, ey = d.y - c.y, den = dx * ey - dy * ex;
            if (Math.abs(den) < 1e-9)
                continue;
            const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / den, u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / den;
            if (t > 0 && t < 1 && u >= 0 && u <= 1)
                cuts.push(t);
        }
    cuts.sort((x, y) => x - y);
    for (let i = 1; i < cuts.length; i++) {
        const t = (cuts[i - 1] + cuts[i]) / 2;
        if (!walkable(scene, { x: a.x + dx * t, y: a.y + dy * t }, enabled))
            return false;
    }
    return true;
}
// 实际量化点的凸包：一段直线的整数事件按最大公因数重复。
// 每行只保留两个端点；重复段只需第一段和最后一段，不保存整条像素轨迹。
function quantizedPathHull(a, b) {
    const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y), majorX = dx >= dy;
    const major = Math.max(dx, dy), minor = Math.min(dx, dy);
    let divisor = major, remainder = minor;
    while (remainder) [divisor, remainder] = [remainder, divisor % remainder];
    const width = major / divisor, height = minor / divisor, lower = [], upper = [];
    const add = p => {
        if (lower.at(-1)?.x === p.x && lower.at(-1)?.y === p.y)
            return;
        while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
        while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), p) >= 0) upper.pop();
        lower.push(p);
        upper.push(p);
    };
    // Position 的每轴上限为 1,000,000；互质极限最多约二百万次 add，
    // 与坐标值成线性关系，内存只保留上下凸链；不按包围盒面积枚举。
    for (const repeat of divisor === 1 ? [0] : [0, divisor - 1])
        for (let y = 0; y <= height; y++) {
            const first = y === 0 ? 0 : Math.floor(((2 * y - 1) * width + height) / (2 * height));
            const last = y === height ? width : Math.ceil(((2 * y + 1) * width + height) / (2 * height)) - 1;
            add({ x: first + repeat * width, y: y + repeat * height });
            add({ x: last + repeat * width, y: y + repeat * height });
        }
    return [...lower, ...upper.slice(1, -1).reverse()].map(p => ({ x: a.x + Math.sign(b.x - a.x) * (majorX ? p.x : p.y), y: a.y + Math.sign(b.y - a.y) * (majorX ? p.y : p.x) }));
}
function clearQuantizedHull(scene, a, b, enabled, geometry, clearLine) {
    const polygon = quantizedPathHull(a, b), levels = polygon.map(p => p.y);
    const minY = Math.min(...levels), maxY = Math.max(...levels);
    if (polygon.some(p => !walkable(scene, p, enabled)))
        return false;
    for (const p of geometry.vertices) {
        levels.push(p.y);
        if (inPolygon(p, polygon) && !walkable(scene, p, enabled))
            return false;
    }
    for (const [p, q] of geometry.edges)
        for (let i = 0; i < polygon.length; i++) {
            const r = polygon[i], s = polygon[(i + 1) % polygon.length];
            const ex = q.x - p.x, ey = q.y - p.y, fx = s.x - r.x, fy = s.y - r.y, den = ex * fy - ey * fx;
            if (Math.abs(den) < 1e-9)
                continue;
            const t = ((r.x - p.x) * fy - (r.y - p.y) * fx) / den, u = ((r.x - p.x) * ey - (r.y - p.y) * ex) / den;
            if (t >= 0 && t <= 1 && u >= 0 && u <= 1)
                levels.push(p.y + ey * t);
        }
    const cuts = [...new Set(levels.filter(y => y >= minY && y <= maxY))].sort((x, y) => x - y);
    const clearRow = y => {
        const xs = [];
        for (let i = 0; i < polygon.length; i++) {
            const p = polygon[i], q = polygon[(i + 1) % polygon.length];
            if (y < Math.min(p.y, q.y) || y > Math.max(p.y, q.y))
                continue;
            if (p.y === q.y) xs.push(p.x, q.x);
            else xs.push(p.x + (q.x - p.x) * (y - p.y) / (q.y - p.y));
        }
        return xs.length > 0 && clearLine({ x: Math.min(...xs), y }, { x: Math.max(...xs), y });
    };
    return cuts.every(clearRow) && cuts.slice(1).every((y, i) => clearRow((cuts[i] + y) / 2));
}
// 取整后的点及任意两个检查点之间的连线都在这个凸走廊内。
// 仅寻路使用走廊；感知、交互和运行时真实阻挡仍用 clearSegment。
function movementSegmentTester(scene, enabled) {
    let geometry;
    const obstacleVertices = scene.obstacles.filter(enabled).flatMap(o => o.polygon);
    // 整数叉积显式排除相切禁区顶点，避免大坐标交点除法的舍入漏检。
    const clearLine = (a, b) => clearSegment(scene, a, b, enabled) && !obstacleVertices.some(p => onEdge(a, b, p) && !walkable(scene, p, enabled));
    return (a, b) => {
        if (!clearLine(a, b))
            return false;
        const dx = b.x - a.x, dy = b.y - a.y;
        // 按起点的有向位移取整时，这些网格边的整数点仍共线。
        if (!dx || !dy || Math.abs(dx) === Math.abs(dy))
            return true;
        if (!geometry) {
            const polygons = [...scene.walkableAreas, ...scene.obstacles].map(p => p.polygon);
            const edges = polygons.flatMap(p => p.map((v, i) => [v, p[(i + 1) % p.length]]));
            const vertices = polygons.flat();
            for (let i = 0; i < edges.length; i++)
                for (let j = 0; j < i; j++) {
                    const [p, q] = edges[i], [r, s] = edges[j];
                    const ex = q.x - p.x, ey = q.y - p.y, fx = s.x - r.x, fy = s.y - r.y, den = ex * fy - ey * fx;
                    if (Math.abs(den) < 1e-9)
                        continue;
                    const t = ((r.x - p.x) * fy - (r.y - p.y) * fx) / den, u = ((r.x - p.x) * ey - (r.y - p.y) * ex) / den;
                    if (t >= 0 && t <= 1 && u >= 0 && u <= 1)
                        vertices.push({ x: p.x + ex * t, y: p.y + ey * t });
                }
            geometry = { edges, vertices };
        }
        // 每轴误差至多半单位，且整数端点之间的取整不会超出端点包围盒。
        const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x), minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
        const radius = (Math.abs(dx) + Math.abs(dy)) / 2, side = p => cross(a, b, p);
        const inside = p => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY && Math.abs(side(p)) <= radius;
        const exact = () => clearQuantizedHull(scene, a, b, enabled, geometry, clearLine);
        const levels = [minY, maxY];
        for (const p of geometry.vertices) {
            levels.push(p.y);
            if (inside(p) && !walkable(scene, p, enabled)) {
                const x = Math.abs(p.x - a.x), y = Math.abs(p.y - a.y), ax = Math.abs(dx), ay = Math.abs(dy);
                // 已确认是实际量化禁区点时直接拒绝，常见障碍旁寻路无需构造凸包。
                if (Number.isInteger(p.x) && Number.isInteger(p.y) && Math.max(0, (2 * x - 1) * ay, (2 * y - 1) * ax) < Math.min(2 * ax * ay, (2 * x + 1) * ay, (2 * y + 1) * ax))
                    return false;
                return exact();
            }
        }
        // 横切线只在地图边界交点、顶点及走廊交点处改变拓扑；逐区间检查，
        // 不用固定采样步长漏过薄墙、扣除区形成的洞或检查点之间的碰撞。
        for (const x of [minX, maxX])
            for (const sign of [-1, 1])
                levels.push(a.y + (dy * (x - a.x) + sign * radius) / dx);
        for (const [p, q] of geometry.edges)
            for (const [value, bounds] of [[v => v.x, [minX, maxX]], [side, [-radius, radius]]]) {
                const from = value(p), delta = value(q) - from;
                if (Math.abs(delta) < 1e-9)
                    continue;
                for (const bound of bounds) {
                    const t = (bound - from) / delta;
                    if (t >= 0 && t <= 1)
                        levels.push(p.y + (q.y - p.y) * t);
                }
            }
        const cuts = [...new Set(levels.filter(y => y >= minY && y <= maxY))].sort((x, y) => x - y);
        const clearRow = y => {
            const center = a.x + dx * (y - a.y) / dy, margin = radius / Math.abs(dy);
            return clearSegment(scene, { x: Math.max(minX, center - margin), y }, { x: Math.min(maxX, center + margin), y }, enabled);
        };
        return cuts.every(clearRow) && cuts.slice(1).every((y, i) => clearRow((cuts[i] + y) / 2)) || exact();
    };
}
export function findPath(scene, start, goal, enabled = () => true) {
    if (!walkable(scene, start, enabled) || !walkable(scene, goal, enabled))
        return null;
    const clearMovementSegment = movementSegmentTester(scene, enabled);
    if (clearMovementSegment(start, goal))
        return [start, goal];
    const step = scene.gridSize, cols = Math.floor(scene.width / step) + 1, rows = Math.floor(scene.height / step) + 1;
    if (cols * rows > 50000)
        return null;
    const key = p => `${p.x},${p.y}`, positions = new Map(), parent = new Map(), cost = new Map(), open = [];
    const add = (p, from, g) => {
        const k = key(p);
        if (g >= (cost.get(k) ?? Infinity))
            return;
        cost.set(k, g);
        positions.set(k, p);
        parent.set(k, from);
        open.push({ k, g, f: g + distance(p, goal) });
    };
    for (let x = Math.max(0, Math.floor(start.x / step) - 1); x <= Math.min(cols - 1, Math.ceil(start.x / step) + 1); x++)
        for (let y = Math.max(0, Math.floor(start.y / step) - 1); y <= Math.min(rows - 1, Math.ceil(start.y / step) + 1); y++) {
            const p = { x: x * step, y: y * step };
            if (clearMovementSegment(start, p))
                add(p, null, distance(start, p));
        }
    let reached = null;
    while (open.length) {
        open.sort((a, b) => b.f - a.f);
        const node = open.pop();
        if (node.g !== cost.get(node.k))
            continue;
        const p = positions.get(node.k);
        if (distance(p, goal) <= step * 2 && clearMovementSegment(p, goal)) {
            reached = node.k;
            break;
        }
        for (let x = -1; x <= 1; x++)
            for (let y = -1; y <= 1; y++) {
                if (!x && !y)
                    continue;
                const q = { x: p.x + x * step, y: p.y + y * step };
                if (clearMovementSegment(p, q))
                    add(q, node.k, node.g + distance(p, q));
            }
    }
    if (reached === null)
        return null;
    const reverse = [];
    for (let k = reached; k !== null; k = parent.get(k))
        reverse.push(positions.get(k));
    const raw = [start, ...reverse.reverse(), goal], path = [start];
    for (let i = 0; i < raw.length - 1;) {
        let next = raw.length - 1;
        while (next > i + 1 && !clearMovementSegment(raw[i], raw[next]))
            next--;
        path.push(raw[next]);
        i = next;
    }
    return path;
}
/** 当前站姿取最后实际经过的非零段；与绘制端的八向角度及零长度约定一致。 */
export function facingAlongPath(path, previousFacing) {
    for (let i = path.length - 1; i > 0; i--) {
        const from = path[i - 1], through = path[i];
        if (distance(from, through) > 0)
            return ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'][(Math.round(Math.atan2(through.y - from.y, through.x - from.x) / (Math.PI / 4)) + 8) % 8];
    }
    return previousFacing;
}
export function pointAlongPath(path, travel) {
    for (let i = 1; i < path.length; i++) {
        const length = distance(path[i - 1], path[i]);
        if (travel < length) {
            const t = length ? travel / length : 1;
            const a = path[i - 1], dx = path[i].x - a.x, dy = path[i].y - a.y;
            let x = Math.round(Math.abs(dx) * t), y = Math.round(Math.abs(dy) * t);
            // 两轴本应同时跨半格时，浮点乘法可能一边先取整；用整数事件
            // 相等关系合并到同一侧，使插值严格落在认证的量化点集合中。
            if (dx && dy) {
                if ((2 * x - 1) * Math.abs(dy) === (2 * y + 1) * Math.abs(dx)) y++;
                else if ((2 * y - 1) * Math.abs(dx) === (2 * x + 1) * Math.abs(dy)) x++;
            }
            return { position: { x: a.x + Math.sign(dx) * x, y: a.y + Math.sign(dy) * y }, arrived: false, index: i };
        }
        travel -= length;
    }
    return { position: { ...path.at(-1) }, arrived: true, index: path.length - 1 };
}
/** 静止观察者对整段轨迹的可见性：按障碍顶点射线切开，不能只检查端点。 */
export function visibleSegment(scene, observer, a, b, radius, enabled = () => true) {
    if (distance(observer, a) > radius || distance(observer, b) > radius)
        return false;
    const cuts = [0, 1], dx = b.x - a.x, dy = b.y - a.y;
    for (const { polygon } of [...scene.walkableAreas, ...scene.obstacles])
        for (const vertex of polygon) {
            const rx = vertex.x - observer.x, ry = vertex.y - observer.y, den = dx * ry - dy * rx;
            if (Math.abs(den) < 1e-9)
                continue;
            const t = ((observer.x - a.x) * ry - (observer.y - a.y) * rx) / den;
            const ray = ((observer.x - a.x) * dy - (observer.y - a.y) * dx) / den;
            if (t > 0 && t < 1 && ray >= 0)
                cuts.push(t);
        }
    cuts.sort((x, y) => x - y);
    const visible = t => clearSegment(scene, observer, { x: a.x + dx * t, y: a.y + dy * t }, enabled);
    if (!cuts.every(visible))
        return false;
    for (let i = 1; i < cuts.length; i++)
        if (!visible((cuts[i - 1] + cuts[i]) / 2))
            return false;
    return true;
}
