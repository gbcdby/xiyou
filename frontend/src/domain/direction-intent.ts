import type { Position } from '../../../game/spatial-types.ts';
import { directionClock, DIRECTION_INTERVAL_MS, DIRECTION_RECEIPT_DEADLINE_MS } from './spatial-direction.ts';
import type { DirectionClock } from './spatial-direction.ts';

export type DirectionOutcome = 'accepted' | 'rejected' | 'unknown';
interface Options {
  send(vector: Position): Promise<DirectionOutcome>;
  stop(): Promise<void>;
  fail?(message: string): void;
  uncertain?(): void;
  canSend?(): boolean;
  clock?: DirectionClock;
}
interface Pending { generation: number; intent: number; at: number }

/** 两个原请求槽、独立停步槽和一个最新意图；回调只释放自己的槽。 */
export class DirectionIntent {
  #options: Options; #clock: DirectionClock;
  #vector: Position | null = null; #intent = 0; #sentIntent = -1; #generation = 0;
  #pending = new Map<number, Pending>(); #serial = 0; #latest = 0;
  #timer: unknown = null; #stopTimer: unknown = null; #nextAt = -Infinity;
  #credits = 2; #creditAt: number; #stopPending = false; #resume = false; #stopped = true; #blocked = false;
  constructor(options: Options) { this.#options = options; this.#clock = options.clock ?? directionClock; this.#creditAt = this.#clock.now(); }
  get canResumeAfterStop() { return this.#stopPending && this.#resume && !this.#blocked; }
  /** 网络层仅在原账本已无未知/停步未决后，接受新的明确按键。 */
  recover() { if (!this.#stopPending) this.#blocked = false; }
  /** 原会话账本收束一个槽后，重新检查唯一待发意图。 */
  refresh() { this.#schedule(); }
  set(vector: Position | null) {
    const size = vector ? Math.hypot(vector.x, vector.y) : 0;
    const value = size && Number.isFinite(size) ? { x: vector!.x / size, y: vector!.y / size } : null;
    if (!value) {
      // 原stop仍负责同一次停止；再次全松只撤回暂存方向，不废弃其确认代次。
      if (this.#stopPending) { if (this.#vector) { this.#vector = null; this.#intent++; } }
      else if (this.#vector) this.#halt();
      return;
    }
    if (this.#blocked || this.#stopPending && !this.#resume) return;
    if (this.#vector?.x === value.x && this.#vector?.y === value.y) return;
    this.#vector = value; this.#intent++; if (!this.#stopPending) this.#stopped = false; this.#schedule();
  }
  clear() {
    this.#generation++; this.#vector = null; this.#intent++; this.#stopped = true; this.#resume = false; this.#blocked = false;
    this.#cancel(); if (this.#stopTimer !== null) this.#clock.clearTimeout(this.#stopTimer); this.#stopTimer = null;
  }
  #cancel() { if (this.#timer !== null) this.#clock.clearTimeout(this.#timer); this.#timer = null; }
  #halt(message?: string) {
    this.#vector = null; this.#intent++; this.#generation++; this.#cancel();
    this.#blocked = Boolean(message); this.#resume = !message;
    if (message) { this.#options.uncertain?.(); this.#options.fail?.(message); }
    if (this.#stopped || this.#stopPending) return;
    this.#stopped = true; this.#stopPending = true; const generation = this.#generation;
    this.#stopTimer = this.#clock.setTimeout(() => {
      this.#stopTimer = null;
      if (generation !== this.#generation || !this.#stopPending) return;
      this.#blocked = true; this.#resume = false; this.#vector = null;
      this.#options.uncertain?.(); this.#options.fail?.('停步确认延迟，请查询原请求。');
    }, DIRECTION_RECEIPT_DEADLINE_MS);
    let accepted = false;
    void this.#options.stop().then(() => { accepted = true; }).catch(() => {
      if (generation !== this.#generation) return;
      this.#blocked = true; this.#resume = false; this.#vector = null;
      this.#options.uncertain?.(); this.#options.fail?.('停步结果尚未确认，请查询原请求。');
    }).finally(() => {
      this.#stopPending = false;
      if (this.#stopTimer !== null) this.#clock.clearTimeout(this.#stopTimer); this.#stopTimer = null;
      if (generation !== this.#generation) return;
      const resume = accepted && this.#resume && !this.#blocked; this.#resume = false;
      if (resume && this.#vector) this.#schedule();
    });
  }
  #schedule() {
    this.#cancel(); if (!this.#vector || this.#blocked || this.#stopPending) return;
    const now = this.#clock.now();
    const current = [...this.#pending.values()].filter(p => p.generation === this.#generation);
    const deadline = Math.min(...current.map(p => p.at + DIRECTION_RECEIPT_DEADLINE_MS));
    const credits = Math.min(2, this.#credits + (now - this.#creditAt) / DIRECTION_INTERVAL_MS);
    const budgetAt = now + (credits >= 1 - 1e-9 ? 0 : (1 - credits) * DIRECTION_INTERVAL_MS);
    const available = this.#pending.size < 2 && (this.#options.canSend?.() ?? true) && !current.some(p => p.intent === this.#intent);
    const sendAt = available ? Math.max(this.#sentIntent === this.#intent ? this.#nextAt : now, budgetAt) : Infinity;
    const due = Math.min(deadline, sendAt); if (!Number.isFinite(due)) return;
    if (due <= now + 1e-8) this.#tick();
    else this.#timer = this.#clock.setTimeout(() => { this.#timer = null; this.#tick(); }, due - now);
  }
  #tick() {
    if (!this.#vector || this.#blocked || this.#stopPending) return;
    const now = this.#clock.now();
    if ([...this.#pending.values()].some(p => p.generation === this.#generation && now >= p.at + DIRECTION_RECEIPT_DEADLINE_MS - 1e-8)) {
      this.#halt('移动确认延迟，已请求停步；请查询原请求。'); return;
    }
    if (!(this.#options.canSend?.() ?? true)) { this.#schedule(); return; }
    const id = ++this.#serial, generation = this.#generation, intent = this.#intent, vector = { ...this.#vector };
    this.#pending.set(id, { generation, intent, at: now }); this.#latest = id; this.#sentIntent = intent;
    this.#stopped = false; this.#nextAt = now + DIRECTION_INTERVAL_MS;
    this.#credits = Math.max(0, Math.min(2, this.#credits + (now - this.#creditAt) / DIRECTION_INTERVAL_MS) - 1); this.#creditAt = now;
    let request: Promise<DirectionOutcome>;
    try { request = this.#options.send(vector); } catch { request = Promise.resolve('unknown'); }
    void request.catch(() => 'unknown' as const).then(result => {
      if (generation !== this.#generation) return;
      if (result === 'unknown') this.#halt('移动结果尚未确认，已请求停步；请查询原请求。');
      else if (result === 'rejected' && id === this.#latest && intent === this.#intent) this.#halt('当前方向未获接纳，已请求停步。');
    }).finally(() => { this.#pending.delete(id); this.#schedule(); });
    this.#schedule();
  }
}
