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
export function findPath(scene, start, goal, enabled = () => true) {
    if (!walkable(scene, start, enabled) || !walkable(scene, goal, enabled))
        return null;
    if (clearSegment(scene, start, goal, enabled))
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
            if (clearSegment(scene, start, p, enabled))
                add(p, null, distance(start, p));
        }
    let reached = null;
    while (open.length) {
        open.sort((a, b) => b.f - a.f);
        const node = open.pop();
        if (node.g !== cost.get(node.k))
            continue;
        const p = positions.get(node.k);
        if (distance(p, goal) <= step * 2 && clearSegment(scene, p, goal, enabled)) {
            reached = node.k;
            break;
        }
        for (let x = -1; x <= 1; x++)
            for (let y = -1; y <= 1; y++) {
                if (!x && !y)
                    continue;
                const q = { x: p.x + x * step, y: p.y + y * step };
                if (clearSegment(scene, p, q, enabled))
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
        while (next > i + 1 && !clearSegment(scene, raw[i], raw[next], enabled))
            next--;
        path.push(raw[next]);
        i = next;
    }
    return path;
}
export function pointAlongPath(path, travel) {
    for (let i = 1; i < path.length; i++) {
        const length = distance(path[i - 1], path[i]);
        if (travel < length) {
            const t = length ? travel / length : 1;
            return { position: { x: Math.round(path[i - 1].x + (path[i].x - path[i - 1].x) * t), y: Math.round(path[i - 1].y + (path[i].y - path[i - 1].y) * t) }, arrived: false, index: i };
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
