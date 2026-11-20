import { RuleError } from './rules.mjs';
import { clearSegment, findPath } from './spatial-geometry.mjs';
import { obstacleEnabled, sceneOf } from './spatial-world.mjs';

const vectors = Object.freeze({ N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1] });

/** 在原受理事务已经结算的权威点解释短段；不改写原请求身份或寻路语义。 */
export function directionDestination(state, content, actor, action) {
  if (actor.sceneId !== action.sceneId || state.mapVersion !== action.mapVersion) throw new RuleError('STALE_REFERENCE');
  const scene = sceneOf(content, actor.sceneId), origin = actor.position, vector = vectors[action.direction];
  if (!scene || !origin || !vector) throw new RuleError('PATH_UNREACHABLE');
  const [dx, dy] = vector, length = Math.hypot(dx, dy), enabled = obstacleEnabled(state);
  // 向零取整使对角线也不超过 36；阻挡时只缩短原方向，不自动绕行或跨出口。
  for (let extent = 36; extent >= 1; extent--) {
    const step = Math.floor(extent / length);
    if (!step) continue;
    const destination = { x: origin.x + dx * step, y: origin.y + dy * step };
    if (!clearSegment(scene, origin, destination, enabled)) continue;
    const path = findPath(scene, origin, destination, enabled);
    if (path?.length === 2) return destination;
  }
  throw new RuleError('PATH_UNREACHABLE');
}
