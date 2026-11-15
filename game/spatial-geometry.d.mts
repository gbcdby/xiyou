import type { Position, PublicScene } from './spatial-types.js';
export function distance(a: Position, b: Position): number;
export function inPolygon(point: Position, polygon: Position[]): boolean;
export function walkable(scene: PublicScene, point: Position, enabled?: (obstacle: PublicScene['obstacles'][number]) => boolean): boolean;
export function clearSegment(scene: PublicScene, a: Position, b: Position, enabled?: (obstacle: PublicScene['obstacles'][number]) => boolean): boolean;
