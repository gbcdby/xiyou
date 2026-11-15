import type { Position, PublicMapScene, PublicScene } from '../../../game/spatial-types.ts';

/** 原scene锚点也供剧情规则使用；可见导航入口只读服务端安全目录。 */
export function navigationScene(scene: PublicScene | null, catalog: PublicMapScene[] = []): PublicMapScene | null {
  if (!scene) return null;
  const published = catalog.find(value => value.sceneId === scene.sceneId);
  if (published) return published;
  // 未协商目录的旧响应只保留确实存在的出口坐标，不沿用内部标签或动态门状态。
  const anchors = scene.exits.flatMap((exit, index) => {
    const anchor = scene.anchors.find(value => value.anchorId === exit.anchorId);
    return anchor ? [{ anchorId: anchor.anchorId, position: { ...anchor.position }, label: `场景出口 ${index + 1}` }] : [];
  });
  return { sceneId: scene.sceneId, name: scene.name, width: scene.width, height: scene.height, unitsPerPixel: scene.unitsPerPixel, walkableAreas: scene.walkableAreas, anchors, exits: scene.exits.map(({ exitId, anchorId, destinationSceneId, destination }) => ({ exitId, anchorId, destinationSceneId, destination })) };
}

export function navigationScenes(scene: PublicScene | null, catalog: PublicMapScene[] = []): PublicMapScene[] {
  const current = navigationScene(scene, catalog);
  return current && !catalog.some(value => value.sceneId === current.sceneId) ? [...catalog, current] : [...catalog];
}

export function mapFit(scene: { width: number; height: number }, size: { width: number; height: number }, padding = 8) {
  const scale = Math.min(Math.max(0, size.width - padding * 2) / scene.width, Math.max(0, size.height - padding * 2) / scene.height);
  return { scale, x: (size.width - scene.width * scale) / 2, y: (size.height - scene.height * scale) / 2 };
}

/** 逆变换只接受地图内容区；留白不是可走世界坐标。 */
export function mapPoint(scene: { width: number; height: number }, size: { width: number; height: number }, point: Position): Position | null {
  const fit = mapFit(scene, size);
  if (fit.scale <= 0) return null;
  const x = (point.x - fit.x) / fit.scale, y = (point.y - fit.y) / fit.scale;
  if (x < 0 || y < 0 || x > scene.width || y > scene.height) return null;
  return { x: Math.round(x), y: Math.round(y) };
}
