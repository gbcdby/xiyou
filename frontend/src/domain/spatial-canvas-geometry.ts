import type { Position } from '../../../game/spatial-types.ts';
export interface CanvasFit { scale: number; x: number; y: number }
export interface CanvasSize { width: number; height: number }
export function sceneFit(scene: CanvasSize, viewport: CanvasSize): CanvasFit {
  const scale = Math.min(viewport.width / scene.width, viewport.height / scene.height);
  return { scale, x: (viewport.width - scene.width * scale) / 2, y: (viewport.height - scene.height * scale) / 2 };
}
export function screenPoint(point: Position, fit: CanvasFit): Position { return { x: fit.x + point.x * fit.scale, y: fit.y + point.y * fit.scale }; }
export function worldPoint(point: Position, fit: CanvasFit, scene: CanvasSize): Position | null {
  if (!(fit.scale > 0)) return null;
  const value = { x: (point.x - fit.x) / fit.scale, y: (point.y - fit.y) / fit.scale };
  return value.x < 0 || value.y < 0 || value.x > scene.width || value.y > scene.height ? null : value;
}
