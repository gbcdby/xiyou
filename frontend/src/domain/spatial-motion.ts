import type { EntityViewV2, Facing, Position, SnapshotV2 } from '../../../game/spatial-types.ts';

const length = (a: Position, b: Position) => Math.hypot(a.x - b.x, a.y - b.y);
const same = (a: Position, b: Position) => a.x === b.x && a.y === b.y;
export function sampleTrail(points: Position[], fraction: number): Position {
  const total = points.slice(1).reduce((sum, p, i) => sum + length(points[i], p), 0);
  let remaining = total * Math.max(0, Math.min(1, fraction));
  for (let i = 1; i < points.length; i++) {
    const size = length(points[i - 1], points[i]);
    if (remaining <= size && size > 0) { const t = remaining / size; return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, y: points[i - 1].y + (points[i].y - points[i - 1].y) * t }; }
    remaining -= size;
  }
  return { ...points.at(-1)! };
}
/** 只截取已知折线上的已确认区间；找不到端点时不猜直线。 */
export function confirmedSegment(path: Position[], from: Position, through: Position): Position[] | null {
  if (!path.length) return null;
  const locate = (point: Position) => {
    let distance = 0; let best: { distance: number; error: number } | null = null;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i]; const size = length(a, b);
      const t = size ? Math.max(0, Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / size ** 2)) : 0;
      const projected = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; const error = length(point, projected);
      if (!best || error < best.error) best = { distance: distance + size * t, error }; distance += size;
    }
    return best;
  };
  const a = locate(from), b = locate(through);
  if (!a || !b || a.error > 1.5 || b.error > 1.5 || b.distance < a.distance) return null;
  let distance = 0; const result = [{ ...from }];
  for (let i = 1; i < path.length; i++) { distance += length(path[i - 1], path[i]); if (distance > a.distance && distance < b.distance) result.push({ ...path[i] }); }
  result.push({ ...through }); return result;
}
const trailLength = (points: Position[]) => points.slice(1).reduce((sum, point, index) => sum + length(points[index], point), 0);
const directionOf = (from: Position, through: Position): Facing => (['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'] as Facing[])[(Math.round(Math.atan2(through.y - from.y, through.x - from.x) / (Math.PI / 4)) + 8) % 8];
interface Motion { position: Position; trail: Position[] | null; startedAt: number; duration: number; distanceBefore: number; facing: Facing }
export interface DrawnPose { position: Position; facing: Facing; moving: boolean; distance: number }

/** 绘制缓存只播放已发生且已授权的轨迹，永远不回写权威投影。 */
export class ConfirmedMotion {
  #previous: SnapshotV2 | null = null; #motions = new Map<string, Motion>();
  update(snapshot: SnapshotV2, now: number) {
    const previous = this.#previous;
    const continuous = previous?.viewId === snapshot.viewId && previous.projection.self.controlEpoch === snapshot.projection.self.controlEpoch;
    if (!continuous) this.#motions.clear();
    const p = snapshot.projection; const seen = new Set<string>();
    const people: EntityViewV2[] = [p.self, ...p.entities.filter(e => e.entityRef !== p.self.entityRef)];
    for (const person of people) {
      if (!person.position || person.sceneId !== p.self.sceneId) continue;
      seen.add(person.entityRef);
      const isSelf = person.entityRef === p.self.entityRef;
      const prior = continuous ? (isSelf ? previous!.projection.self : previous!.projection.entities.find(e => e.entityRef === person.entityRef)) : null;
      const old = this.#motions.get(person.entityRef); let trail: Position[] | null = null; let duration = 0; let distanceBefore = 0;
      if (prior?.position && prior.sceneId === person.sceneId && prior.appearanceEpoch === person.appearanceEpoch) {
        if (same(prior.position, person.position) && old && (isSelf || person.motionTrail)) { this.#motions.set(person.entityRef, old); continue; }
        if (isSelf && p.movement?.sceneId === person.sceneId) {
          trail = confirmedSegment(p.movement.path, prior.position, person.position); duration = p.sceneTimeMs - previous!.projection.sceneTimeMs;
        } else if (person.motionTrail && person.motionFromSceneTimeMs !== undefined && person.motionThroughSceneTimeMs !== undefined && person.motionTrail.length >= 2 && same(person.motionTrail[0], prior.position) && same(person.motionTrail.at(-1)!, person.position)) {
          trail = person.motionTrail; duration = person.motionThroughSceneTimeMs - person.motionFromSceneTimeMs;
        }
        if (trail && old) {
          const pose = this.pose(person.entityRef, now)!;
          distanceBefore = pose.distance;
          if (old.trail && now < old.startedAt + old.duration) {
            const remaining = confirmedSegment(old.trail, pose.position, prior.position);
            if (remaining) trail = [...remaining, ...trail.slice(1)];
          }
        }
      }
      this.#motions.set(person.entityRef, { position: { ...person.position }, trail: duration > 0 ? trail : null, startedAt: now, duration: Math.min(200, Math.max(0, duration)), distanceBefore, facing: person.facing });
    }
    for (const reference of this.#motions.keys()) if (!seen.has(reference)) this.#motions.delete(reference);
    this.#previous = structuredClone(snapshot);
  }
  position(reference: string, now: number): Position | null {
    return this.pose(reference, now)?.position || null;
  }
  /** 位置、朝向和步态共用确认路径；墙钟只采样位置，不能使站立者原地走步。 */
  pose(reference: string, now: number): DrawnPose | null {
    const value = this.#motions.get(reference); if (!value) return null;
    if (!value.trail || value.duration <= 0) return { position: value.position, facing: value.facing, moving: false, distance: value.distanceBefore };
    const fraction = Math.max(0, Math.min(1, (now - value.startedAt) / value.duration));
    const total = trailLength(value.trail); let remaining = total * fraction; let facing = value.facing;
    for (let index = 1; index < value.trail.length; index++) {
      const size = length(value.trail[index - 1], value.trail[index]);
      if (size > 0) facing = directionOf(value.trail[index - 1], value.trail[index]);
      if (remaining <= size && size > 0) break;
      remaining -= size;
    }
    return { position: sampleTrail(value.trail, fraction), facing, moving: fraction < 1 && total > 0, distance: value.distanceBefore + total * fraction };
  }
  settled(reference: string, now: number): boolean { const value = this.#motions.get(reference); return !value?.trail || now >= value.startedAt + value.duration; }
  active(now: number): boolean { return [...this.#motions.values()].some(value => value.trail && now < value.startedAt + value.duration); }
}
