import type { Position } from '../../../game/spatial-types.ts';
export interface CanvasFit { scale: number; x: number; y: number }
export interface CanvasSize { width: number; height: number }
export function sceneFit(scene: CanvasSize, viewport: CanvasSize): CanvasFit {
  const scale = Math.min(viewport.width / scene.width, viewport.height / scene.height);
  return { scale, x: (viewport.width - scene.width * scale) / 2, y: (viewport.height - scene.height * scale) / 2 };
}
/** 正式场景保持固定轻微裁切；平移只调整中心，不以人物或HUD改变倍率。 */
export function sceneCoverFit(scene: CanvasSize, viewport: CanvasSize, center: Position): CanvasFit {
  const scale = Math.max(viewport.width / scene.width, viewport.height / scene.height) * 1.1;
  const offset = (pixels: number, units: number, focus: number) => Math.max(pixels - units * scale, Math.min(0, pixels / 2 - focus * scale));
  return { scale, x: offset(viewport.width, scene.width, center.x), y: offset(viewport.height, scene.height, center.y) };
}
export function fitCenter(fit: CanvasFit, viewport: CanvasSize): Position {
  return { x: (viewport.width / 2 - fit.x) / fit.scale, y: (viewport.height / 2 - fit.y) / fit.scale };
}
export function screenPoint(point: Position, fit: CanvasFit): Position { return { x: fit.x + point.x * fit.scale, y: fit.y + point.y * fit.scale }; }
export function worldPoint(point: Position, fit: CanvasFit, scene: CanvasSize): Position | null {
  if (!(fit.scale > 0)) return null;
  const value = { x: (point.x - fit.x) / fit.scale, y: (point.y - fit.y) / fit.scale };
  return value.x < 0 || value.y < 0 || value.x > scene.width || value.y > scene.height ? null : value;
}
