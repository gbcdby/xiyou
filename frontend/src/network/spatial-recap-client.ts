import { canonicalize, compareDecimal } from '../../../protocol/index.mjs';
import { validateSpatial } from '../../../protocol/spatial.mjs';
import type { EndingViewV2, RecapEntryV2, RecapV2 } from '../../../game/spatial-types.ts';
import { ApiFailure } from './http-api.ts';

export interface SpatialRecapBinding {
  sessionId: string; actorRef: string; throughSeq: string; phase: 'Finished' | 'Aborted';
  viewId: string; identity: string;
}
export interface SpatialRecapState {
  entries: RecapEntryV2[]; ending: EndingViewV2 | null;
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable' | 'forbidden';
  message: string; nextBeforeSeq: string | null; complete: boolean;
}
interface Reader { spatialRecap(sessionId: string, throughSeq: string, beforeSeq?: string, signal?: AbortSignal): Promise<RecapV2> }
const empty = (): SpatialRecapState => ({ entries: [], ending: null, status: 'idle', message: '', nextBeforeSeq: null, complete: false });
const sameBinding = (a: SpatialRecapBinding | null, b: SpatialRecapBinding | null): boolean => a === null || b === null ? a === b
  : a.sessionId === b.sessionId && a.actorRef === b.actorRef && a.throughSeq === b.throughSeq && a.phase === b.phase && a.viewId === b.viewId && a.identity === b.identity;

/** 独立读取授权历史，换身份即撤销读取代次；不修改世界投影、动作队列或事件称呼。 */
export class SpatialRecapClient {
  #reader: Reader;
  #onChange: (state: SpatialRecapState) => void;
  #binding: SpatialRecapBinding | null = null;
  #serial = 0;
  #controller: AbortController | null = null;
  #loaded = false;
  #state = empty();
  constructor(reader: Reader, onChange: (state: SpatialRecapState) => void = () => {}) { this.#reader = reader; this.#onChange = onChange; }
  get state(): SpatialRecapState { return structuredClone(this.#state); }
  #publish() { this.#onChange(this.state); }
  open(binding: SpatialRecapBinding | null): Promise<void> {
    if (sameBinding(binding, this.#binding)) return Promise.resolve();
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
      const result = await this.#reader.spatialRecap(binding.sessionId, binding.throughSeq, beforeSeq, controller.signal);
      if (serial !== this.#serial || controller.signal.aborted) return;
      const page = validateSpatial('RecapV2', result);
      const invalid = () => { throw new ApiFailure('复盘页无法核对。', 0, 'INVALID_RESPONSE'); };
      if (page.sessionId !== binding.sessionId || page.throughSeq !== binding.throughSeq || page.phase !== binding.phase) invalid();
      const seen = new Set(this.#state.entries.map(entry => entry.entryRef));
      let previous = beforeSeq;
      for (const entry of page.entries) {
        if (compareDecimal(entry.eventSeq, binding.throughSeq) > 0
          || (beforeSeq !== undefined && compareDecimal(entry.eventSeq, beforeSeq) >= 0)
          || (previous !== undefined && compareDecimal(entry.eventSeq, previous) > 0)
          || seen.has(entry.entryRef)) invalid();
        previous = entry.eventSeq; seen.add(entry.entryRef);
      }
      if (page.nextBeforeSeq !== null && (!page.entries.length || previous === undefined
        || compareDecimal(page.nextBeforeSeq, previous) !== 0
        || (beforeSeq !== undefined && compareDecimal(page.nextBeforeSeq, beforeSeq) >= 0))) invalid();
      if (this.#state.ending && canonicalize(page.ending) !== canonicalize(this.#state.ending)) invalid();
      this.#loaded = true;
      this.#state = {
        entries: [...this.#state.entries, ...structuredClone(page.entries)], ending: structuredClone(page.ending),
        status: 'ready', message: '', nextBeforeSeq: page.nextBeforeSeq, complete: page.nextBeforeSeq === null,
      };
    } catch (error) {
      if (serial !== this.#serial || controller.signal.aborted) return;
      if (error instanceof ApiFailure && ['UNAUTHENTICATED', 'FORBIDDEN', 'SESSION_GONE'].includes(error.code)) {
        this.#serial++; controller.abort(); this.#binding = null; this.#loaded = false;
        this.#state = { ...empty(), status: 'forbidden', message: '当前已不能读取本局过程，请重新核对访问资格。' };
        this.#publish();
      } else if (error instanceof ApiFailure && (error.status === 404 || (error.status === 400 && error.code === 'INVALID_MESSAGE'))) {
        this.#loaded = false;
        this.#state = { ...empty(), status: 'unavailable', message: '过程暂不可用，已确认的结局仍可查看。' };
      } else {
        this.#state = { ...this.#state, status: 'error', complete: false, message: '过程未能完整读取，可以重试。' };
      }
    } finally {
      if (this.#controller === controller) this.#controller = null;
      if (serial === this.#serial) this.#publish();
    }
  }
}
