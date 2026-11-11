import { actionSemanticDigest, canonicalize, compareDecimal, parseClientAction, validateContract } from '../../../protocol/index.mjs';
import type { Action, AuthorizedSnapshot, ClientReceipt, ControlRequest, ErrorResponse } from '../domain/world.ts';
import { ClientView } from '../domain/client-view.ts';
import { prepareAction } from '../domain/action-draft.ts';
import type { ActionDraft } from '../domain/action-draft.ts';
import type { ConnectLink, SessionLink } from './link.ts';
import { ApiFailure } from './http-api.ts';

export type ConnectionState = 'idle' | 'connecting' | 'synchronizing' | 'online' | 'offline' | 'forbidden';
export interface SessionState {
  connection: ConnectionState;
  snapshot: AuthorizedSnapshot | null;
  actions: ActionDraft[];
  message: string;
  controlBusy: boolean;
}
interface ReceiptReader { receipt(sessionId: string, actionId: string): Promise<ClientReceipt | null> }
interface Options {
  onChange?: (state: SessionState) => void;
  id?: () => string;
  heartbeatMs?: number;
  reconnectDelayMs?: number;
}
const rejectionLabels: Record<string, string> = {
  STALE_CONTROL: '控制权已变化，请同步后再决定是否发起新动作。',
  STALE_PRECONDITION: '物品或目标已经变化，请查看最新状态。',
  SESSION_NOT_RUNNING: '本局当前不能执行新动作。',
  TARGET_UNAVAILABLE: '当前无法对这个目标执行动作。',
  RULE_VIOLATION: '当前条件不符合这项操作的规则。',
  NOT_READY: '所需条件尚未满足。', ACTION_ID_REUSE: '此动作身份已用于其他请求。',
};
const errorLabels: Partial<Record<ErrorResponse['code'], string>> = {
  CONTROL_HELD: '此角色仍由另一处连接控制。需要时请明确选择接管。',
  RESYNC_REQUIRED: '正在重新获取授权视图。', OUTCOME_UNKNOWN: '结果仍待确认，请查询原动作。',
};
function asError(value: unknown): ErrorResponse | null {
  try { return validateContract('ErrorResponse', value); } catch { return null; }
}

/** 每条物理连接持有独立代次；异步结果须与连接和视图代次同时匹配。 */
export class SessionClient {
  #view = new ClientView();
  #api: ReceiptReader;
  #connectLink: ConnectLink;
  #options: Required<Options>;
  #link: SessionLink | null = null;
  #serial = 0;
  #sessionId = '';
  #token = '';
  #connection: ConnectionState = 'idle';
  #message = '';
  #actions: ActionDraft[] = [];
  #controlBusy = false;
  #pendingControl: { request: ControlRequest; raw: string; serial: number } | null = null;
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #syncSerial: number | null = null;

  constructor(api: ReceiptReader, connectLink: ConnectLink, options: Options = {}) {
    this.#api = api; this.#connectLink = connectLink;
    this.#options = { onChange: options.onChange || (() => {}), id: options.id || (() => crypto.randomUUID()), heartbeatMs: options.heartbeatMs ?? 1500, reconnectDelayMs: options.reconnectDelayMs ?? 1000 };
  }
  get state(): SessionState {
    const snapshot = this.#view.snapshot;
    return { connection: this.#connection, snapshot, actions: [...this.#actions], message: this.#message, controlBusy: this.#controlBusy };
  }
  #publish() {
    const cursor = this.#view.snapshot?.snapshotSeq;
    this.#actions = this.#actions.map(action => action.status === 'accepted' && action.receipt ? { ...action, detail: cursor && compareDecimal(cursor, action.receipt.observedSeq) >= 0 ? (action.receipt.result.message || '服务器已确认，状态已同步。') : '服务器已确认，状态同步中。' } : action);
    this.#options.onChange(this.state);
  }
  #update(id: string, patch: Partial<ActionDraft>) {
    this.#actions = this.#actions.map(action => {
      if (action.id !== id) return action;
      // 查询、超时与 ACK 可能交错；已验证的终态收据不能被迟到的未知覆盖。
      if (action.receipt && (patch.status === 'unknown' || patch.status === 'waiting')) return action;
      return { ...action, ...patch };
    });
    this.#publish();
  }
  open(sessionId: string, token: string, drafts: ActionDraft[] = []) {
    this.close(); this.#sessionId = sessionId; this.#token = token;
    this.#actions = drafts.filter(action => action.sessionId === sessionId).map(action => ({ ...action, status: 'unknown', receipt: null, detail: '保留的原动作等待服务器确认。' }));
    this.#openConnection();
    if (this.#options.heartbeatMs > 0) this.#heartbeat = setInterval(() => { if (this.#connection === 'online') void this.sync(); }, this.#options.heartbeatMs);
  }
  close() {
    this.#serial += 1;
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#heartbeat = null; this.#retryTimer = null;
    const link = this.#link; this.#link = null; link?.close();
    this.#view.begin(''); this.#sessionId = ''; this.#token = '';
    this.#connection = 'idle'; this.#controlBusy = false; this.#pendingControl = null; this.#syncSerial = null;
    this.#actions = this.#actions.map(action => action.status === 'waiting' ? { ...action, status: 'unknown', detail: '连接已结束，动作结果仍待确认。' } : action);
    this.#publish();
  }
  reconnect() { if (this.#sessionId && this.#token) this.#openConnection(); }
  #openConnection() {
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    const serial = ++this.#serial; const generation = this.#view.begin(this.#sessionId);
    const old = this.#link; this.#link = null; old?.close();
    this.#connection = 'connecting'; this.#message = ''; this.#controlBusy = false; this.#pendingControl = null; this.#syncSerial = null;
    this.#actions = this.#actions.map(action => action.status === 'waiting' ? { ...action, status: 'unknown', detail: '连接发生变化，动作结果待确认。' } : action);
    this.#publish();
    this.#link = this.#connectLink(this.#token, {
      connected: () => { if (serial === this.#serial) void this.#subscribe(serial, generation); },
      disconnected: () => this.#disconnected(serial),
      failed: value => { if (serial === this.#serial && !this.#handleError(value)) this.#disconnected(serial); },
      batch: value => { if (serial === this.#serial) this.#batch(value, generation); },
    });
  }
  #disconnected(serial: number) {
    if (serial !== this.#serial) return;
    this.#serial += 1;
    const link = this.#link; this.#link = null; link?.close();
    this.#view.begin(this.#sessionId); this.#connection = 'offline'; this.#message = '连接已断开，正在等待重新连接。'; this.#controlBusy = false; this.#pendingControl = null; this.#syncSerial = null;
    this.#actions = this.#actions.map(action => action.status === 'waiting' ? { ...action, status: 'unknown', detail: '尚未确认结果。连接恢复后可查询或原样重试。' } : action);
    this.#publish();
    if (this.#sessionId && this.#options.reconnectDelayMs > 0) this.#retryTimer = setTimeout(() => this.#openConnection(), this.#options.reconnectDelayMs);
  }
  #handleError(value: unknown): boolean {
    const error = asError(value); if (!error) return false;
    this.#message = error.message || errorLabels[error.code] || '当前请求未能完成。';
    if (['UNAUTHENTICATED', 'FORBIDDEN', 'SESSION_GONE'].includes(error.code)) {
      this.#serial += 1; this.#view.begin(this.#sessionId); this.#connection = 'forbidden';
      this.#controlBusy = false; this.#pendingControl = null;
      const link = this.#link; this.#link = null; link?.close();
      if (this.#retryTimer) clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    } else if (error.code === 'RESYNC_REQUIRED') { this.#openConnection(); return true; }
    this.#publish(); return true;
  }
  async #subscribe(serial: number, generation: number) {
    const link = this.#link; if (!link) return;
    this.#connection = 'synchronizing'; this.#publish();
    try {
      const value = await link.request('session.subscribe', { sessionId: this.#sessionId });
      if (serial !== this.#serial || generation !== this.#view.generation) return;
      if (this.#handleError(value)) return;
      if (this.#view.acceptSnapshot(value, generation) !== 'applied') { this.#message = '授权视图校验未通过，请重新连接。'; this.#connection = 'offline'; this.#publish(); return; }
      const actorId = this.#view.snapshot!.projection.self.characterId;
      this.#actions = this.#actions.filter(action => action.actorId === actorId);
      this.#connection = 'online'; this.#message = ''; this.#publish();
      void this.sync();
      for (const action of this.#actions.filter(action => action.status === 'unknown')) void this.query(action.id);
    } catch { if (serial === this.#serial) this.#disconnected(serial); }
  }
  #batch(value: unknown, generation: number): boolean {
    if (this.#handleError(value)) return false;
    const result = this.#view.applyBatch(value, generation);
    if (result === 'applied') { this.#publish(); return true; }
    if (result === 'refetch') void this.sync();
    if (result === 'resync') this.#openConnection();
    return false;
  }
  async sync(): Promise<void> {
    const link = this.#link; const serial = this.#serial; const generation = this.#view.generation;
    if (!link?.connected || !this.#view.snapshot || this.#syncSerial === serial) return;
    this.#syncSerial = serial;
    try {
      // 单轮有界补发；持续心跳兜底修复最后一个丢失批次。
      for (let page = 0; page < 8; page += 1) {
        const request = this.#view.syncRequest(); if (!request) break;
        const value = await link.request('sync.request', canonicalize(validateContract('SyncRequest', request)));
        if (serial !== this.#serial || generation !== this.#view.generation) return;
        if (!this.#batch(value, generation)) break;
      }
    } catch { if (serial === this.#serial) { this.#message = '状态同步尚未完成，正在保留当前确认位置重试。'; this.#publish(); } }
    finally { if (this.#syncSerial === serial) this.#syncSerial = null; }
  }
  async send(action: Action): Promise<void> {
    const snapshot = this.#view.snapshot;
    if (!snapshot || !this.#link?.connected || this.#connection !== 'online') throw new Error('请先连接到房间并同步状态。');
    const draft = prepareAction(snapshot, action, this.#options.id());
    this.#actions = [...this.#actions, draft]; this.#publish();
    await this.#deliver(draft);
  }
  async retry(id: string): Promise<void> {
    const action = this.#actions.find(action => action.id === id);
    if (!action || action.status !== 'unknown' || !this.#link?.connected || !this.#view.snapshot) return;
    this.#update(id, { status: 'waiting', detail: '正在原样重试，仍使用原动作身份。' });
    await this.#deliver(action);
  }
  async #deliver(action: ActionDraft) {
    const serial = this.#serial; const link = this.#link; if (!link) return;
    try {
      const value = await link.request('player.action.request', action.raw);
      if (serial !== this.#serial) return;
      if (this.#handleError(value)) { this.#update(action.id, { status: 'unknown', detail: asError(value)?.message || '尚未取得收据，结果仍待确认。' }); return; }
      await this.#receipt(action, value, serial);
    } catch { if (serial === this.#serial) this.#update(action.id, { status: 'unknown', detail: '尚未收到确认；可以查询结果或原样重试。' }); }
  }
  async #receipt(action: ActionDraft, value: unknown, serial: number) {
    try {
      const receipt = validateContract('ClientReceipt', value);
      if (receipt.sessionId !== action.sessionId || receipt.actorId !== action.actorId || receipt.clientActionId !== action.id || receipt.semanticDigest !== await actionSemanticDigest(parseClientAction(action.raw))) throw new Error('Receipt identity mismatch');
      if (serial !== this.#serial) return;
      this.#update(action.id, { receipt, status: receipt.status === 'Accepted' ? 'accepted' : 'rejected', detail: receipt.status === 'Rejected' ? (receipt.result.message || rejectionLabels[receipt.code] || '服务器确认本次未执行。') : undefined });
      void this.sync();
    } catch { if (serial === this.#serial) this.#update(action.id, { status: 'unknown', detail: '收据校验未通过，尚不能确认结果。' }); }
  }
  async query(id: string): Promise<void> {
    const action = this.#actions.find(action => action.id === id); const serial = this.#serial;
    if (!action || !this.#view.snapshot || action.actorId !== this.#view.snapshot.projection.self.characterId) return;
    try {
      const value = await this.#api.receipt(action.sessionId, action.id);
      if (serial !== this.#serial) return;
      if (value === null) { this.#update(id, { status: 'unknown', detail: '服务器暂未查到收据，结果仍未知；可原样重试。' }); return; }
      await this.#receipt(action, value, serial);
    } catch (error) {
      if (serial !== this.#serial) return;
      if (error instanceof ApiFailure) this.#handleError({ schemaVersion: 1, code: error.code, message: error.message });
      this.#update(id, { status: 'unknown', detail: '暂时无法查询，原动作仍然保留。' });
    }
  }
  async control(kind: 'resume' | 'take'): Promise<void> {
    const snapshot = this.#view.snapshot; const link = this.#link; const serial = this.#serial;
    if (!snapshot || !link?.connected || this.#controlBusy || snapshot.projection.phase !== 'Running') return;
    const type = kind === 'take' ? 'control.take' : 'control.resume';
    const old = this.#pendingControl;
    const request = old?.serial === serial && old.request.type === type ? old.request : validateContract('ControlRequest', { schemaVersion: 1, type, sessionId: snapshot.sessionId, actorId: snapshot.projection.self.characterId, nonce: this.#options.id() });
    const raw = old?.request === request ? old.raw : canonicalize(request);
    this.#pendingControl = { request, raw, serial }; this.#controlBusy = true; this.#publish();
    try {
      const value = await link.request(type, raw);
      if (serial !== this.#serial) return;
      const error = asError(value);
      if (error) {
        if (error.code !== 'OUTCOME_UNKNOWN') this.#pendingControl = null;
        this.#handleError(value); return;
      }
      const response = validateContract('ControlResponse', value);
      if (response.sessionId !== request.sessionId || response.actorId !== request.actorId || response.nonce !== request.nonce) throw new Error('Control identity mismatch');
      this.#pendingControl = null; this.#message = '控制请求已确认，正在同步当前授权。'; void this.sync();
    } catch { if (serial === this.#serial) this.#message = '控制请求结果待确认。再次点击会重试本连接上的原请求。'; }
    finally { if (serial === this.#serial) { this.#controlBusy = false; this.#publish(); } }
  }
}
