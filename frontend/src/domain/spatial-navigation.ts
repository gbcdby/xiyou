import type { Position, PublicMapScene, PublicScene } from '../../../game/spatial-types.ts';
import { clearSegment } from '../../../game/spatial-geometry.mjs';
import { DIRECTION_LOOKAHEAD } from './spatial-direction.ts';

/** 只用当前公开几何选短目标；服务器仍重新寻路与校验，键盘不绕墙寻找远端折线。 */
export function directionTarget(scene: PublicScene, origin: Position, direction: Position): Position | null {
  for (let length = DIRECTION_LOOKAHEAD; length >= 1; length--) {
    const target = { x: origin.x + Math.trunc(direction.x * length), y: origin.y + Math.trunc(direction.y * length) };
    if (target.x === origin.x && target.y === origin.y) continue;
    if (clearSegment(scene, origin, target)) return target;
  }
  return null;
}
export function mapRoute(catalog: PublicMapScene[], from: string, destination: string): PublicMapScene['exits'] | null {
  const scenes = new Map(catalog.map(scene => [scene.sceneId, scene]));
  if (!scenes.has(from) || !scenes.has(destination)) return null;
  const seen = new Set([from]), queue: { sceneId: string; route: PublicMapScene['exits'] }[] = [{ sceneId: from, route: [] }];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]; if (current.sceneId === destination) return current.route;
    for (const exit of scenes.get(current.sceneId)!.exits) if (scenes.has(exit.destinationSceneId) && !seen.has(exit.destinationSceneId)) {
      seen.add(exit.destinationSceneId); queue.push({ sceneId: exit.destinationSceneId, route: [...current.route, exit] });
    }
  }
  return null;
}
