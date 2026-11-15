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

/** 一个move窗口与一个紧急stop槽；普通stop只合并最新持键，确认前不续发，原身份由网络层保留。 */
export class ContinuousDirection {
  #options: Options; #clock: DirectionClock; #direction: Position | null = null;
  #timer: unknown = null; #pending = false; #sentAt = -Infinity; #nextAt = -Infinity; #stopRequested = true;
  #generation = 0; #stopPending = false;
  #stopGeneration = 0; #resumeAfterStop = false; #stopTimer: unknown = null;
  constructor(options: Options) { this.#options = options; this.#clock = options.clock ?? directionClock; }
  get canResumeAfterStop() { return this.#stopPending && this.#resumeAfterStop && this.#stopGeneration === this.#generation; }
  set(vector: Position | null) {
    const size = vector ? Math.hypot(vector.x, vector.y) : 0;
    const direction = size && Number.isFinite(size) ? { x: vector!.x / size, y: vector!.y / size } : null;
    if (!direction) { if (this.#stopPending) this.#direction = null; else if (this.#direction) this.#halt(); return; }
    if (this.#stopPending) {
      if (this.canResumeAfterStop) this.#direction = direction;
      else this.#options.fail?.('停步结果仍在确认，请等待确认后重新按方向键。');
      return;
    }
    if (this.#direction?.x === direction.x && this.#direction?.y === direction.y) return;
    if (!this.#direction && this.#pending) { this.#options.fail?.('上一段移动的结果仍在确认，请先查询原请求。'); return; }
    this.#direction = direction; this.#stopRequested = false; this.#schedule();
  }
  /** 由另一项明确输入接管或连接撤销时只取消续发，接管方负责更高序号动作。 */
  clear() { this.#generation++; this.#direction = null; this.#stopRequested = true; this.#resumeAfterStop = false; this.#cancelTimer(); this.#cancelStopTimer(); }
  #cancelTimer() { if (this.#timer !== null) this.#clock.clearTimeout(this.#timer); this.#timer = null; }
  #cancelStopTimer() { if (this.#stopTimer !== null) this.#clock.clearTimeout(this.#stopTimer); this.#stopTimer = null; }
  #halt(message?: string) {
    this.#generation++; this.#direction = null; this.#resumeAfterStop = false; this.#cancelTimer(); this.#cancelStopTimer();
    if (message) this.#options.fail?.(message);
    if (!this.#stopRequested) {
      this.#stopRequested = true; this.#stopPending = true;
      const generation = this.#generation; this.#stopGeneration = generation; this.#resumeAfterStop = !message;
      if (this.#resumeAfterStop) this.#stopTimer = this.#clock.setTimeout(() => {
        this.#stopTimer = null; this.#resumeAfterStop = false; this.#direction = null;
        this.#options.fail?.('停步确认延迟，请查询原请求后重新按方向键。');
      }, DIRECTION_RECEIPT_DEADLINE_MS);
      let accepted = false;
      void this.#options.stop().then(() => { accepted = true; }).catch(() => {
        if (generation === this.#generation) { this.clear(); this.#options.fail?.('停步结果尚未确认，请查询原请求。'); }
      }).finally(() => {
        const resume = accepted && this.canResumeAfterStop;
        this.#stopPending = false; this.#resumeAfterStop = false; this.#cancelStopTimer();
        if (resume && this.#direction) { this.#stopRequested = false; this.#schedule(); }
      });
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
