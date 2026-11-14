import { canonicalize, compareDecimal, validateContract } from '../../../protocol/index.mjs';
import { MovementCommandSource, parseSpatial, validateSpatial } from '../../../protocol/spatial.mjs';
import type { ActionV2, ControlRequestV2, ErrorV2, Position, PublicEnvelope, ReceiptV2, SnapshotV2 } from '../../../game/spatial-types.ts';
import { SpatialView } from '../domain/spatial-view.ts';
import type { ConnectLink, SessionLink } from './link.ts';
import type { ConnectionState } from './session-client.ts';
import { ApiFailure } from './http-api.ts';
import { spatialErrorMessage } from '../domain/spatial-errors.ts';

export interface SpatialDraft { id: string; raw: string; status: 'waiting' | 'unknown' | 'accepted' | 'rejected'; detail: string; receipt: ReceiptV2 | null }
export interface SpatialState { connection: ConnectionState; snapshot: SnapshotV2 | null; actions: SpatialDraft[]; message: string; controlBusy: boolean; inputReady: boolean; queuedAction: string | null }
interface Options { onChange?: (state: SpatialState) => void; onUnauthenticated?: (token: string) => void; id?: () => string; heartbeatMs?: number; reconnectDelayMs?: number; waitForVisualArrival?: boolean }
interface ReceiptReader { receipt(sessionId: string, actionId: string): Promise<ReceiptV2 | null> }
interface QueuedAction { action: ActionV2; sequence: string; epoch: string; viewId: string; mapVersion: string; movementId?: string; targetRef?: string; targetSignature?: string }
function retainActions(actions: SpatialDraft[]): SpatialDraft[] {
  // 只有已有确定结果的历史计入上限；未决请求必须一直保留原串，直到收据确认。
  let confirmed = 80;
  return [...actions].reverse().filter(action => action.status === 'waiting' || action.status === 'unknown' || confirmed-- > 0).reverse();
}
function asError(value: unknown): ErrorV2 | null {
  try { return validateSpatial('ErrorV2', value); } catch {
    try { const error = validateContract('ErrorResponse', value); return { schemaVersion: 2, code: error.code, message: error.message || '请求未完成。' }; } catch { return null; }
  }
}
function targetSignature(snapshot: SnapshotV2, reference?: string): string | undefined {
  if (!reference) return undefined;
  const p = snapshot.projection;
  const value = [...p.targets, ...p.items, ...p.entities].find(value => value.entityRef === reference);
  // 计划依赖只使用当前已授权字段，引用、资源或目标位置变化均取消自动后续操作。
  if (!value) return '';
  return canonicalize(value);
}

/** v2 独立恢复驱动，保留 v1 实现；输入源只在已确认的新控制 epoch 建立。 */
export class SpatialSessionClient {
  #view = new SpatialView(); #api: ReceiptReader; #connect: ConnectLink; #options: Required<Options>;
  #link: SessionLink | null = null; #serial = 0; #sessionId = ''; #token = '';
  #connection: ConnectionState = 'idle'; #message = ''; #actions: SpatialDraft[] = [];
  #source: MovementCommandSource | null = null; #queued: QueuedAction | null = null; #controlBusy = false;
  #pendingControl: { request: ControlRequestV2; raw: string; serial: number } | null = null;
  #heartbeat: ReturnType<typeof setInterval> | null = null; #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #syncKey = ''; #syncRevision = 0;
  #displayedArrival = '';
  constructor(api: ReceiptReader, connect: ConnectLink, options: Options = {}) {
    this.#api = api; this.#connect = connect;
    this.#options = { onChange: options.onChange ?? (() => {}), onUnauthenticated: options.onUnauthenticated ?? (() => {}), id: options.id ?? (() => crypto.randomUUID()), heartbeatMs: options.heartbeatMs ?? 1000, reconnectDelayMs: options.reconnectDelayMs ?? 1000, waitForVisualArrival: options.waitForVisualArrival ?? false };
  }
  get state(): SpatialState {
    const snapshot = this.#view.snapshot;
    return { connection: this.#connection, snapshot, actions: [...this.#actions], message: this.#message, controlBusy: this.#controlBusy, inputReady: Boolean(snapshot?.projection.self.canControl && this.#source?.controlEpoch === snapshot.projection.self.controlEpoch), queuedAction: this.#queued ? '到达后重新检查并操作' : null };
  }
  #publish() { this.#options.onChange(this.state); }
  #update(id: string, patch: Partial<SpatialDraft>) {
    this.#actions = retainActions(this.#actions.map(a => a.id === id ? (a.receipt && (patch.status === 'unknown' || patch.status === 'waiting') ? a : { ...a, ...patch }) : a)); this.#publish();
  }
  open(sessionId: string, token: string, drafts: SpatialDraft[] = []) {
    this.close(); this.#sessionId = sessionId; this.#token = token;
    this.#actions = drafts.flatMap(draft => {
      try { const e = parseSpatial('PublicEnvelope', draft.raw); return e.sessionId === sessionId && e.clientActionId === draft.id ? [{ id: e.clientActionId, raw: draft.raw, status: 'unknown' as const, detail: '原动作等待查询确认。', receipt: null }] : []; } catch { return []; }
    });
    if (this.#options.heartbeatMs > 0) this.#heartbeat = setInterval(() => { if (this.#connection === 'online') void this.sync(); }, this.#options.heartbeatMs);
    this.#openConnection();
  }
  close() {
    this.#serial++; if (this.#heartbeat) clearInterval(this.#heartbeat); if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#heartbeat = null; this.#retryTimer = null; const link = this.#link; this.#link = null; link?.close();
    this.#view.begin(''); this.#sessionId = ''; this.#token = ''; this.#connection = 'idle'; this.#source = null; this.#queued = null; this.#controlBusy = false; this.#pendingControl = null; this.#syncKey = ''; this.#message = '';
    this.#actions = this.#actions.map(a => a.status === 'waiting' ? { ...a, status: 'unknown', detail: '连接已结束，结果待确认。' } : a); this.#publish();
  }
  reconnect() { if (this.#sessionId && this.#token) this.#openConnection(); }
  #openConnection() {
    if (this.#retryTimer) clearTimeout(this.#retryTimer); this.#retryTimer = null;
    const serial = ++this.#serial; const generation = this.#view.begin(this.#sessionId);
    const old = this.#link; this.#link = null; old?.close(); this.#source = null; this.#queued = null; this.#pendingControl = null; this.#controlBusy = false; this.#syncKey = '';
    this.#connection = 'connecting'; this.#message = ''; this.#actions = this.#actions.map(a => a.status === 'waiting' ? { ...a, status: 'unknown', detail: '连接变化，原动作待确认。' } : a); this.#publish();
    if (serial !== this.#serial || generation !== this.#view.generation || !this.#sessionId || !this.#token) return;
    this.#link = this.#connect(this.#token, {
      connected: () => { if (serial === this.#serial) void this.#subscribe(serial, generation); },
      disconnected: () => { if (serial === this.#serial) this.#disconnect(serial); },
      failed: value => { if (serial === this.#serial) this.#initialFailure(value, serial); },
      batch: value => { if (serial === this.#serial) this.#batch(value, this.#view.generation); },
    });
  }
  #initialFailure(value: unknown, serial: number) {
    const error = asError(value);
    if (error && ['UNAUTHENTICATED', 'FORBIDDEN', 'SESSION_GONE', 'UPGRADE_REQUIRED'].includes(error.code)) { this.#handleError(value); return; }
    this.#disconnect(serial, !error || ['OUTCOME_UNKNOWN', 'RESYNC_REQUIRED'].includes(error.code));
    if (error) { this.#message = spatialErrorMessage(error.code); this.#publish(); }
  }
  #disconnect(serial: number, retry = true) {
    if (serial !== this.#serial) return;
    const next = ++this.#serial; const link = this.#link; this.#link = null; link?.close(); this.#view.begin(this.#sessionId);
    this.#source = null; this.#queued = null; this.#controlBusy = false; this.#pendingControl = null; this.#syncKey = ''; this.#connection = 'offline'; this.#message = '连接已断开，正在重新获取授权视图。';
    this.#actions = this.#actions.map(a => a.status === 'waiting' ? { ...a, status: 'unknown', detail: '原动作结果未知，可恢复后查询或原样重试。' } : a); this.#publish();
    if (retry && next === this.#serial && this.#sessionId && this.#token && this.#options.reconnectDelayMs > 0) this.#retryTimer = setTimeout(() => { if (next === this.#serial) this.#openConnection(); }, this.#options.reconnectDelayMs);
  }
  #handleError(value: unknown): boolean {
    const error = asError(value); if (!error) return false;
    this.#message = spatialErrorMessage(error.code);
    if (['UNAUTHENTICATED', 'FORBIDDEN', 'SESSION_GONE', 'UPGRADE_REQUIRED'].includes(error.code)) {
      const token = this.#token; this.#serial++; this.#view.begin(this.#sessionId); this.#source = null; this.#queued = null; this.#connection = 'forbidden';
      const link = this.#link; this.#link = null; link?.close(); this.#controlBusy = false; this.#publish();
      if (error.code === 'UNAUTHENTICATED') this.#options.onUnauthenticated(token);
    } else if (['RESYNC_REQUIRED', 'STALE_REFERENCE'].includes(error.code)) this.#openConnection();
    else this.#publish();
    return true;
  }
  async #subscribe(serial: number, generation: number) {
    const link = this.#link; if (!link) return; this.#connection = 'synchronizing'; this.#publish();
    try {
      const value = await link.request('session.subscribe', { sessionId: this.#sessionId });
      if (serial !== this.#serial || generation !== this.#view.generation) return;
      if (asError(value)) { this.#initialFailure(value, serial); return; }
      if (this.#view.acceptSnapshot(value, generation) !== 'applied') { this.#disconnect(serial, false); this.#message = '空间授权视图校验未通过，请重新连接。'; this.#publish(); return; }
      this.#connection = 'online'; this.#message = ''; this.#publish(); void this.sync();
      for (const draft of this.#actions.filter(a => a.status === 'unknown')) void this.query(draft.id);
    } catch { this.#disconnect(serial); }
  }
  #batch(value: unknown, generation: number) {
    if (this.#handleError(value)) return 'stale';
    const result = this.#view.applyBatch(value, generation);
    if (result === 'applied') { this.#publish(); this.#drainQueued(); }
    else if (result === 'resync') this.#openConnection();
    else if (result === 'refetch') void this.sync();
    return result;
  }
  async sync() {
    const snapshot = this.#view.snapshot; const link = this.#link; const serial = this.#serial; const generation = this.#view.generation;
    const revision = this.#syncRevision; const key = `${serial}:${generation}:${revision}`;
    // 控制事务会替换服务端视图；结果未决时，不用旧视图补发打断同一连接上的原 nonce。
    if (!snapshot || !link?.connected || this.#pendingControl || this.#syncKey === key) return;
    this.#syncKey = key;
    try {
      for (let page = 0; page < 8; page++) {
        if (revision !== this.#syncRevision || this.#pendingControl) break;
        const request = this.#view.syncRequest(); if (!request) break;
        const value = await link.request('sync.request', canonicalize(request));
        if (serial !== this.#serial) return;
        // 访问失效不属于可丢弃的旧视图结果，必须继续立即撤销本连接的授权。
        const error = asError(value);
        if (error && ['UNAUTHENTICATED', 'FORBIDDEN', 'SESSION_GONE', 'UPGRADE_REQUIRED'].includes(error.code)) { this.#handleError(value); return; }
        if (generation !== this.#view.generation || revision !== this.#syncRevision) return;
        if (this.#batch(value, generation) !== 'applied') break;
      }
    } catch { if (serial === this.#serial && generation === this.#view.generation && revision === this.#syncRevision) { this.#message = '状态同步暂未完成，当前位置仍以上次服务器确认为准。'; this.#publish(); } }
    finally { if (this.#syncKey === key) this.#syncKey = ''; }
  }
  #ready(): SnapshotV2 {
    const snapshot = this.#view.snapshot;
    if (!snapshot || !this.#link?.connected || this.#connection !== 'online') throw new Error('请先连接并同步房间。');
    if (!snapshot.projection.self.canControl || this.#source?.controlEpoch !== snapshot.projection.self.controlEpoch) throw new Error('请先恢复本人控制，建立新的输入源。');
    if (snapshot.projection.phase !== 'Running') throw new Error('当前阶段不能执行新动作。');
    return snapshot;
  }
  async move(position: Position, options: { targetRef?: string; anchorId?: string } = {}, after?: ActionV2) {
    const snapshot = this.#ready(); const scene = snapshot.projection.scene; if (!scene) throw new Error('当前没有可行走场景。');
    this.#queued = null; const action = this.#source!.move(scene.sceneId, position, options);
    if (after && action.kind === 'move_to') this.#queued = { action: validateSpatial('ActionV2', after), sequence: action.movementCommandSeq, epoch: snapshot.projection.self.controlEpoch, viewId: snapshot.viewId, mapVersion: snapshot.projection.mapVersion, targetRef: options.targetRef, targetSignature: targetSignature(snapshot, options.targetRef) };
    await this.send(action, true);
  }
  async stop() { this.#ready(); this.#queued = null; await this.send(this.#source!.stop(), true); }
  async traverseExit(exitId: string) {
    const snapshot = this.#ready(); const scene = snapshot.projection.scene;
    const exit = scene?.exits.find(value => value.exitId === exitId && value.open);
    const anchor = scene?.anchors.find(value => value.anchorId === exit?.anchorId);
    if (!scene || !exit || !anchor) throw new Error('当前出口不可用，请查看最新场景。');
    const approach = this.#source!.move(scene.sceneId, anchor.position, { anchorId: anchor.anchorId });
    const crossing = this.#source!.move(exit.destinationSceneId, exit.destination);
    if (approach.kind !== 'move_to') return;
    // 两段属于同一点击计划，在点击时预留顺序；停步/换目标会取消第二段。
    this.#queued = { action: crossing, sequence: approach.movementCommandSeq, epoch: snapshot.projection.self.controlEpoch, viewId: snapshot.viewId, mapVersion: snapshot.projection.mapVersion };
    await this.send(approach, true);
  }
  cancelQueued() { this.#queued = null; this.#publish(); }
  confirmDisplayedArrival(value: { viewId: string; epoch: string; movementId: string; sequence: string; position: Position }) {
    const snapshot = this.#view.snapshot; const p = snapshot?.projection;
    if (!snapshot || !p || snapshot.viewId !== value.viewId || p.self.controlEpoch !== value.epoch || p.movement?.movementId !== value.movementId || p.movement.movementCommandSeq !== value.sequence || p.movement.status !== 'arrived' || p.self.position?.x !== value.position.x || p.self.position?.y !== value.position.y) return;
    // 显示确认可以先于原收据到达；保留事件携带的真实计划身份，不借用同号旧计划。
    this.#displayedArrival = `${value.viewId}:${value.epoch}:${value.movementId}:${value.sequence}`; this.#drainQueued();
  }
  async send(action: ActionV2, preserveQueued = false) {
    const snapshot = this.#ready(); if (!preserveQueued) this.#queued = null;
    const envelope: PublicEnvelope = validateSpatial('PublicEnvelope', { schemaVersion: 2, sessionId: snapshot.sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, clientActionId: this.#options.id(), controlEpoch: snapshot.projection.self.controlEpoch, baseSeq: snapshot.snapshotSeq, action });
    const draft: SpatialDraft = { id: envelope.clientActionId, raw: canonicalize(envelope), status: 'waiting', detail: action.kind === 'move_to' ? '正在提交路线，尚未到达。' : '等待服务器确认。', receipt: null };
    this.#actions = retainActions([...this.#actions, draft]); this.#publish(); await this.#deliver(draft);
  }
  async retry(id: string) {
    const draft = this.#actions.find(a => a.id === id); if (!draft || draft.status !== 'unknown' || !this.#link?.connected || !this.#view.snapshot) return;
    this.#update(id, { status: 'waiting', detail: '正在原样重试，不重新分配命令序号。' }); await this.#deliver(draft);
  }
  async #deliver(draft: SpatialDraft) {
    const serial = this.#serial; const link = this.#link; if (!link) return;
    try {
      const value = await link.request('player.action.request', draft.raw); if (serial !== this.#serial) return;
      if (this.#handleError(value)) { this.#update(draft.id, { status: 'unknown', detail: '请求尚无确定收据，请查询原动作。' }); return; }
      this.#receipt(draft, value);
    } catch { if (serial === this.#serial) this.#update(draft.id, { status: 'unknown', detail: '确认尚未收到；可以查询或原样重试。' }); }
  }
  #receipt(draft: SpatialDraft, value: unknown) {
    try {
      const receipt = validateSpatial('ReceiptV2', value); const envelope = parseSpatial('PublicEnvelope', draft.raw);
      if (receipt.sessionId !== envelope.sessionId || receipt.clientActionId !== envelope.clientActionId) throw new Error('收据与原请求不匹配。');
      const queued = this.#queued;
      if (envelope.action.kind === 'move_to' && queued?.sequence === envelope.action.movementCommandSeq && queued.epoch === envelope.controlEpoch && queued.viewId === envelope.viewId) {
        if (receipt.status === 'Rejected') this.#queued = null;
        else queued.movementId = receipt.result.movementId;
      }
      this.#update(draft.id, { receipt, status: receipt.status === 'Accepted' ? 'accepted' : 'rejected', detail: receipt.status === 'Rejected' ? spatialErrorMessage(receipt.code) : envelope.action.kind === 'move_to' ? '路线已受理；实际到达以后才会操作。' : '服务器已确认。' }); this.#drainQueued(); void this.sync();
    } catch { this.#update(draft.id, { status: 'unknown', detail: '收据校验未通过，结果仍待确认。' }); }
  }
  async query(id: string) {
    const draft = this.#actions.find(a => a.id === id); const serial = this.#serial; if (!draft || !this.#view.snapshot) return;
    try { const value = await this.#api.receipt(this.#sessionId, id); if (serial !== this.#serial) return; if (value) this.#receipt(draft, value); else this.#update(id, { status: 'unknown', detail: '尚未查到收据，可原样重试。' }); }
    catch (error) { if (serial === this.#serial) { if (error instanceof ApiFailure) this.#handleError({ schemaVersion: 2, code: error.code, message: error.message }); this.#update(id, { status: 'unknown', detail: '暂时无法查询，保留原请求。' }); } }
  }
  async control(kind: 'resume' | 'take') {
    const snapshot = this.#view.snapshot; const link = this.#link; const serial = this.#serial; const generation = this.#view.generation;
    if (!snapshot || !link?.connected || this.#controlBusy || snapshot.projection.phase !== 'Running') return;
    this.#queued = null; const type = kind === 'take' ? 'control.take' : 'control.resume';
    const old = this.#pendingControl;
    const request = old?.serial === serial && old.request.type === type ? old.request : validateSpatial('ControlRequestV2', { schemaVersion: 2, type, sessionId: snapshot.sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce: this.#options.id() });
    const raw = old?.request === request ? old.raw : canonicalize(request); this.#pendingControl = { request, raw, serial }; this.#syncRevision++; this.#controlBusy = true; this.#publish();
    try {
      const value = await link.request(type, raw); if (serial !== this.#serial || generation !== this.#view.generation) return;
      const error = asError(value); if (error) { if (error.code !== 'OUTCOME_UNKNOWN') this.#pendingControl = null; this.#handleError(value); return; }
      const response = validateSpatial('ControlResponseV2', value);
      if (response.sessionId !== snapshot.sessionId || response.nonce !== request.nonce || response.snapshot.sessionId !== snapshot.sessionId || response.snapshot.projection.self.controlEpoch !== response.controlEpoch) throw new Error('控制响应身份不匹配。');
      const current = this.#view.snapshot;
      if (!current || current.projection.phase !== 'Running' || compareDecimal(current.projection.self.controlEpoch, response.controlEpoch) > 0) {
        this.#pendingControl = null; this.#message = '控制状态已经更新，旧确认未恢复输入。'; return;
      }
      const knownSource = this.#source?.controlEpoch === response.controlEpoch;
      const newEpoch = compareDecimal(response.controlEpoch, snapshot.projection.self.controlEpoch) > 0;
      const next = this.#view.begin(this.#sessionId);
      if (this.#view.acceptSnapshot(response.snapshot, next) !== 'applied') throw new Error('新控制视图无效。');
      if (!knownSource) this.#source = newEpoch ? new MovementCommandSource(response.controlEpoch) : null;
      this.#pendingControl = null; this.#message = this.#source ? '已恢复本人控制。' : '本地输入序号已丢失，请明确接管以建立新的控制周期。'; this.#publish();
    } catch { if (serial === this.#serial) { this.#message = '控制结果待确认，再次点击会重试原请求。'; this.#publish(); } }
    finally { if (serial === this.#serial) { this.#controlBusy = false; this.#publish(); void this.sync(); } }
  }
  #drainQueued() {
    const queued = this.#queued; const snapshot = this.#view.snapshot; if (!queued || !snapshot) return;
    const p = snapshot.projection; const movement = p.movement;
    if (snapshot.viewId !== queued.viewId || p.self.controlEpoch !== queued.epoch || !p.self.canControl || p.mapVersion !== queued.mapVersion || targetSignature(snapshot, queued.targetRef) !== queued.targetSignature || p.phase !== 'Running') { this.#queued = null; this.#publish(); return; }
    // 投影计划不携带控制 epoch；当前水位只作取消围栏，原收据才绑定本次计划。
    const order = compareDecimal(p.self.movementCommandHighWater, queued.sequence);
    if (order > 0) { this.#queued = null; this.#publish(); return; }
    if (order < 0 || !queued.movementId || movement?.movementId !== queued.movementId) return;
    if (movement.movementCommandSeq !== queued.sequence || ['cancelled', 'blocked'].includes(movement.status)) { this.#queued = null; this.#publish(); return; }
    const visuallyArrived = !this.#options.waitForVisualArrival || this.#displayedArrival === `${snapshot.viewId}:${p.self.controlEpoch}:${movement.movementId}:${movement.movementCommandSeq}`;
    if (movement.status === 'arrived' && visuallyArrived && !p.paused && this.state.inputReady) {
      this.#queued = null; this.#publish(); void this.send(queued.action).catch(error => { this.#message = error instanceof Error ? error.message : '后续操作未提交。'; this.#publish(); });
    }
  }
}
