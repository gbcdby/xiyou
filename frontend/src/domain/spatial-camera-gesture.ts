import type { Position } from '../../../game/spatial-types.ts';

interface PointerStart { id: number; point: Position; button: number; primary: boolean }
interface ActivePointer { id: number; start: Position; last: Position; dragging: boolean }
const dragThreshold = 8;

/** 将一轮指针输入排他地判为点击或拖动；多指和取消不产生世界操作。 */
export class ScenePointerGesture {
  #pointers = new Set<number>(); #active: ActivePointer | null = null;
  get pointerId(): number | null { return this.#active?.id ?? null; }
  get dragging(): boolean { return this.#active?.dragging ?? false; }
  has(id: number): boolean { return this.#pointers.has(id); }
  begin(pointer: PointerStart): boolean {
    if (pointer.button !== 0 || this.#pointers.has(pointer.id)) return false;
    this.#pointers.add(pointer.id);
    if (!pointer.primary || this.#pointers.size !== 1) { this.#active = null; return false; }
    this.#active = { id: pointer.id, start: { ...pointer.point }, last: { ...pointer.point }, dragging: false };
    return true;
  }
  move(id: number, point: Position): Position | null {
    const active = this.#active;
    if (!active || active.id !== id) return null;
    if (!active.dragging && Math.hypot(point.x - active.start.x, point.y - active.start.y) < dragThreshold) return null;
    const delta = { x: point.x - active.last.x, y: point.y - active.last.y };
    active.dragging = true; active.last = { ...point }; return delta;
  }
  end(id: number): { click: boolean } {
    const active = this.#active; this.#pointers.delete(id);
    if (!active || active.id !== id) return { click: false };
    this.#active = null; return { click: !active.dragging };
  }
  cancel(id?: number) {
    this.#active = null;
    if (id === undefined) this.#pointers.clear(); else this.#pointers.delete(id);
  }
}
