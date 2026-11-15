import type { Position } from '../../../game/spatial-types.ts';

export const DIRECTION_INTERVAL_MS = 100;
export const DIRECTION_LOOKAHEAD = 36;
export const DIRECTION_RECEIPT_DEADLINE_MS = 400;
export const directionKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
export function directionFromKeys(keys: ReadonlySet<string>): Position | null {
  const x = Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'));
  const y = Number(keys.has('ArrowDown')) - Number(keys.has('ArrowUp'));
  return x || y ? { x, y } : null;
}
export interface DirectionClock { now(): number; setTimeout(callback: () => void, delay: number): unknown; clearTimeout(timer: unknown): void }
export const directionClock: DirectionClock = {
  now: () => performance.now(), setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
};
interface Options { send(direction: Position): Promise<void>; stop(): Promise<void>; fail?(message: string): void; clock?: DirectionClock }

/** 一个move窗口与一个紧急stop槽；stop不等旧move，但它未决时冻结后续输入，原身份由网络层保留。 */
export class ContinuousDirection {
  #options: Options; #clock: DirectionClock; #direction: Position | null = null;
  #timer: unknown = null; #pending = false; #sentAt = -Infinity; #nextAt = -Infinity; #stopRequested = true;
  #generation = 0; #stopPending = false;
  constructor(options: Options) { this.#options = options; this.#clock = options.clock ?? directionClock; }
  set(vector: Position | null) {
    const size = vector ? Math.hypot(vector.x, vector.y) : 0;
    const direction = size && Number.isFinite(size) ? { x: vector!.x / size, y: vector!.y / size } : null;
    if (!direction) { if (this.#direction) this.#halt(); return; }
    if (this.#stopPending) { this.#options.fail?.('停步结果仍在确认，请等待确认后重新按方向键。'); return; }
    if (this.#direction?.x === direction.x && this.#direction?.y === direction.y) return;
    if (!this.#direction && this.#pending) { this.#options.fail?.('上一段移动的结果仍在确认，请先查询原请求。'); return; }
    this.#direction = direction; this.#stopRequested = false; this.#schedule();
  }
  /** 由另一项明确输入接管或连接撤销时只取消续发，接管方负责更高序号动作。 */
  clear() { this.#generation++; this.#direction = null; this.#stopRequested = true; this.#cancelTimer(); }
  #cancelTimer() { if (this.#timer !== null) this.#clock.clearTimeout(this.#timer); this.#timer = null; }
  #halt(message?: string) {
    this.#generation++; this.#direction = null; this.#cancelTimer();
    if (message) this.#options.fail?.(message);
    if (!this.#stopRequested) {
      this.#stopRequested = true; this.#stopPending = true;
      void this.#options.stop().catch(() => {
        this.clear(); this.#options.fail?.('停步结果尚未确认，请查询原请求。');
      }).finally(() => { this.#stopPending = false; });
    }
  }
  #schedule() {
    this.#cancelTimer(); if (!this.#direction || this.#stopPending) return;
    const due = this.#pending ? this.#sentAt + DIRECTION_RECEIPT_DEADLINE_MS : this.#nextAt;
    const delay = Math.max(0, due - this.#clock.now());
    if (!delay) this.#tick(); else this.#timer = this.#clock.setTimeout(() => { this.#timer = null; this.#tick(); }, delay);
  }
  #tick() {
    if (!this.#direction) return;
    if (this.#pending) { this.#halt('移动确认延迟，已请求停步；请在动作记录中查询原请求。'); return; }
    const generation = this.#generation, vector = { ...this.#direction }; this.#pending = true; this.#sentAt = this.#clock.now(); this.#nextAt = this.#sentAt + DIRECTION_INTERVAL_MS;
    this.#schedule();
    void this.#options.send(vector).catch(error => { if (generation === this.#generation) this.#halt(error instanceof Error ? error.message : '移动结果尚未确认，已请求停步。'); }).finally(() => {
      this.#pending = false; this.#schedule();
    });
  }
}
