import { compareDecimal, validateContract } from '../../../protocol/index.mjs';
import type { AuthorizedRecap, RecapEntry } from '../domain/world.ts';
import { ApiFailure } from './http-api.ts';

export interface RecapBinding {
  sessionId: string; actorId: string; throughSeq: string; phase: 'Finished' | 'Aborted';
  viewId: string; identity: string;
}
export interface RecapState {
  entries: RecapEntry[]; status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable' | 'forbidden';
  message: string; nextBeforeSeq: string | null; complete: boolean;
}
interface Reader { recap(sessionId: string, throughSeq: string, beforeSeq?: string, signal?: AbortSignal): Promise<AuthorizedRecap> }
const empty = (): RecapState => ({ entries: [], status: 'idle', message: '', nextBeforeSeq: null, complete: false });

/** 复盘持有独立读取代次，永远不修改世界投影或动作收据。 */
export class RecapClient {
  #reader: Reader;
  #onChange: (state: RecapState) => void;
  #binding: RecapBinding | null = null;
  #serial = 0;
  #controller: AbortController | null = null;
  #loaded = false;
  #state = empty();
  constructor(reader: Reader, onChange: (state: RecapState) => void = () => {}) { this.#reader = reader; this.#onChange = onChange; }
  get state(): RecapState { return { ...this.#state, entries: [...this.#state.entries] }; }
  #publish() { this.#onChange(this.state); }
  open(binding: RecapBinding | null): Promise<void> {
    if (JSON.stringify(binding) === JSON.stringify(this.#binding)) return Promise.resolve();
    this.#serial++; this.#controller?.abort(); this.#controller = null;
    this.#binding = binding ? { ...binding } : null; this.#loaded = false; this.#state = empty(); this.#publish();
    return binding ? this.loadMore() : Promise.resolve();
  }
  close() { void this.open(null); }
  async loadMore(): Promise<void> {
    const binding = this.#binding;
    if (!binding || this.#state.status === 'loading' || (this.#loaded && this.#state.nextBeforeSeq === null)) return;
    const serial = this.#serial;
    const beforeSeq = this.#loaded ? this.#state.nextBeforeSeq! : undefined;
    const controller = new AbortController(); this.#controller = controller;
    this.#state = { ...this.#state, status: 'loading', message: '', complete: false }; this.#publish();
    try {
      const result = await this.#reader.recap(binding.sessionId, binding.throughSeq, beforeSeq, controller.signal);
      if (serial !== this.#serial || controller.signal.aborted) return;
      const page = validateContract('AuthorizedRecap', result);
      if (page.sessionId !== binding.sessionId || page.actorId !== binding.actorId || page.throughSeq !== binding.throughSeq || page.phase !== binding.phase
        || (beforeSeq !== undefined && page.entries.some(entry => compareDecimal(entry.eventSeq, beforeSeq) >= 0))) throw new ApiFailure('复盘页与当前授权水位不一致。', 0, 'INVALID_RESPONSE');
      const seen = new Set(this.#state.entries.map(entry => entry.entryId));
      if (page.entries.some(entry => seen.has(entry.entryId))) throw new ApiFailure('复盘分页含重复条目。', 0, 'INVALID_RESPONSE');
      this.#loaded = true;
      this.#state = { entries: [...this.#state.entries, ...page.entries], status: 'ready', message: '', nextBeforeSeq: page.nextBeforeSeq, complete: page.nextBeforeSeq === null };
    } catch (error) {
      if (serial !== this.#serial || controller.signal.aborted) return;
      if (error instanceof ApiFailure && ['UNAUTHENTICATED', 'FORBIDDEN', 'SESSION_GONE'].includes(error.code)) {
        this.#serial++; controller.abort(); this.#binding = null; this.#loaded = false;
        this.#state = { ...empty(), status: 'forbidden', message: '当前已不能读取本局过程，请重新核对访问资格。' };
      } else if (error instanceof ApiFailure && (error.status === 404 || (error.status === 400 && error.code === 'INVALID_MESSAGE'))) {
        this.#state = { ...empty(), status: 'unavailable', message: '复盘暂不可用，已确认的结局仍可查看。' };
      } else {
        this.#state = { ...this.#state, status: 'error', complete: false, message: error instanceof Error ? error.message : '过程未能完整读取，可以重试。' };
      }
    } finally {
      if (this.#controller === controller) this.#controller = null;
      if (serial === this.#serial || this.#state.status === 'forbidden') this.#publish();
    }
  }
}
