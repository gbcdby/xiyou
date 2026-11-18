import { canonicalize, compareDecimal, validateContract } from '../../../protocol/index.mjs';
import { MovementCommandSource, parseSpatial, validateSpatial } from '../../../protocol/spatial.mjs';
import type { ActionV2, BatchV2, ControlRequestV2, ErrorV2, Facing, Position, PublicEnvelope, ReceiptV2, SnapshotV2 } from '../../../game/spatial-types.ts';
import { SpatialView } from '../domain/spatial-view.ts';
import type { ConnectLink, RequestEvent, SessionLink } from './link.ts';
import type { BatchResult } from '../domain/client-view.ts';
import type { ConnectionState } from './session-client.ts';
import { ApiFailure } from './http-api.ts';
import { spatialErrorMessage } from '../domain/spatial-errors.ts';
import { sceneDisplayProjection } from '../domain/spatial-display.ts';
import { ContinuousDirection, directionClock, DIRECTION_RECEIPT_DEADLINE_MS } from '../domain/spatial-direction.ts';
import { DirectionIntent } from '../domain/direction-intent.ts';
import { DIRECTION_CAPABILITY, TIMED_TRAIL_CAPABILITY } from './direction-capability.ts';
import { directionTarget, mapRoute } from '../domain/spatial-navigation.ts';

export interface SpatialDraft { id: string; raw: string; status: 'waiting' | 'unknown' | 'accepted' | 'rejected'; detail: string; receipt: ReceiptV2 | null }
export interface NavigationState { destinationSceneId: string; destination: Position; phase: 'approaching-exit' | 'crossing' | 'approaching-destination' }
export interface SpatialState { connection: ConnectionState; snapshot: SnapshotV2 | null; actions: SpatialDraft[]; message: string; controlBusy: boolean; inputReady: boolean; queuedAction: string | null; navigation: NavigationState | null; timedTrail?: boolean }
interface Options { onChange?: (state: SpatialState) => void; onUnauthenticated?: (token: string) => void; id?: () => string; heartbeatMs?: number; reconnectDelayMs?: number; waitForVisualArrival?: boolean }
interface ReceiptReader { receipt(sessionId: string, actionId: string): Promise<ReceiptV2 | null> }
interface QueuedAction { action: ActionV2; sequence: string; epoch: string; viewId: string; mapVersion: string; movementId?: string; targetRef?: string; targetSignature?: string }
interface NavigationStep { sequence: string; sceneId: string; originSceneId: string; movementId?: string; crossing?: ActionV2; exitId?: string }
interface NavigationPlan extends NavigationState { viewId: string; epoch: string; mapVersion: string; step: NavigationStep | null }
function retainActions(actions: SpatialDraft[]): SpatialDraft[] {
  // 只有已有确定结果的历史计入上限；未决请求必须一直保留原串，直到收据确认。
  let confirmed = 80;
  return [...actions].reverse().filter(action => action.status === 'waiting' || action.status === 'unknown' || confirmed-- > 0).reverse();
}
// 重连回放逐个查询原动作，但最多保留三条在途请求，为控制恢复保留连接池容量。
const RECEIPT_REPLAY_LIMIT = 3;
function asError(value: unknown): ErrorV2 | null {
  // 两版错误都必须有自有code；正常批次直接进入原批次校验，避免先做两次完整错误校验。
  if (value === null || typeof value !== 'object') return null;
  try { if (!Object.hasOwn(value, 'code')) return null; } catch {
    // 属性探测异常仍交给原完整校验，不能增加异常出口。
  }
  try { return validateSpatial('ErrorV2', value); } catch {
    try { const error = validateContract('ErrorResponse', value); return { schemaVersion: 2, code: error.code, message: error.message || '请求未完成。' }; } catch { return null; }
  }
}
function targetSignature(snapshot: SnapshotV2, reference?: string): string | undefined {
  if (!reference) return undefined;
  const p = sceneDisplayProjection(snapshot.projection);
  const value = [...p.targets, ...p.items, ...p.entities].find(value => value.entityRef === reference);
  // 计划依赖只使用当前已授权字段，引用、资源或目标位置变化均取消自动后续操作。
  if (!value) return '';
  return canonicalize(value ? { entityRef: value.entityRef, ...('appearanceEpoch' in value ? { appearanceEpoch: value.appearanceEpoch } : {}), ...('resourceRevision' in value ? { resourceRevision: value.resourceRevision } : {}), ...('location' in value ? { location: value.location } : { sceneId: value.sceneId, position: value.position }) } : null);
}

/** v2 独立恢复驱动，保留 v1 实现；输入源只在已确认的新控制 epoch 建立。 */
export class SpatialSessionClient {
  #view = new SpatialView(); #api: ReceiptReader; #connect: ConnectLink; #options: Required<Options>;
  #link: SessionLink | null = null; #serial = 0; #sessionId = ''; #token = '';
  #connection: ConnectionState = 'idle'; #message = ''; #actions: SpatialDraft[] = [];
  #source: MovementCommandSource | null = null; #queued: QueuedAction | null = null; #controlBusy = false;
  #pendingControl: { request: ControlRequestV2; raw: string; serial: number } | null = null;
  #heartbeat: ReturnType<typeof setInterval> | null = null; #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #syncActive = new Set<SessionLink>(); #syncDemand = ''; #syncRevision = 0;
  #displayedArrival = '';
  #replayQueue: string[] = []; #replaying = false; #replaySerial = 0;
  #controlIdleWaiters: (() => void)[] = [];
  #direction: ContinuousDirection | DirectionIntent; #navigation: NavigationPlan | null = null;
  #directionBinding = '';
  #directionDeadlines = new Map<string, unknown>();
  #directionAnchor: { vector: Position; position: Position; identity: string } | null = null;
  constructor(api: ReceiptReader, connect: ConnectLink, options: Options = {}) {
    this.#api = api; this.#connect = connect;
    this.#options = { onChange: options.onChange ?? (() => {}), onUnauthenticated: options.onUnauthenticated ?? (() => {}), id: options.id ?? (() => crypto.randomUUID()), heartbeatMs: options.heartbeatMs ?? 1000, reconnectDelayMs: options.reconnectDelayMs ?? 1000, waitForVisualArrival: options.waitForVisualArrival ?? false };
    this.#direction = new ContinuousDirection({ send: vector => this.#moveDirection(vector), stop: () => this.#stopDirection(), reset: () => { this.#directionAnchor = null; }, fail: message => { this.#message = message; this.#publish(); } });
  }
  get state(): SpatialState {
    const snapshot = this.#view.snapshot;
    const navigation = this.#navigation ? { destinationSceneId: this.#navigation.destinationSceneId, destination: { ...this.#navigation.destination }, phase: this.#navigation.phase } : null;
    return { connection: this.#connection, snapshot, actions: [...this.#actions], message: this.#message, controlBusy: this.#controlBusy, inputReady: Boolean(snapshot?.projection.self.canControl && this.#source?.controlEpoch === snapshot.projection.self.controlEpoch), queuedAction: this.#queued ? '到达后重新检查并操作' : null, navigation,
      timedTrail: this.#connection === 'online' && this.#timedLink(this.#link) };
  }
  #timedLink(link: SessionLink | null): boolean { return Boolean(link?.acceptedCapabilities?.includes(DIRECTION_CAPABILITY) && link.acceptedCapabilities.includes(TIMED_TRAIL_CAPABILITY)); }
  async #reply(link: SessionLink, event: RequestEvent, request: string | { sessionId: string }, consume: (value: unknown) => void) {
    let consumed = false;
    const once = (value: unknown) => { if (consumed) return; consumed = true; consume(value); };
    const value = await link.request(event, request, this.#timedLink(link) ? once : undefined);
    // 旧传输可忽略可选hook；只在尚未同步消费时使用原Promise路径。
    if (!consumed) once(value);
  }
  #publish() {
    const snapshot = this.#view.snapshot, p = snapshot?.projection;
    const enabled = this.#link?.acceptedCapabilities?.includes(DIRECTION_CAPABILITY) && this.#connection === 'online' && p?.self.canControl && this.#source?.controlEpoch === p.self.controlEpoch && p.phase === 'Running';
    const binding = enabled ? JSON.stringify([this.#serial, snapshot!.sessionId, snapshot!.viewId, p!.self.controlEpoch, p!.self.entityRef, p!.self.appearanceEpoch, p!.self.sceneId, p!.mapVersion]) : '';
    if (binding !== this.#directionBinding) {
      this.#direction.clear(); this.#directionBinding = binding;
      const fail = (message: string) => { this.#message = message; this.#publish(); };
      this.#direction = enabled ? new DirectionIntent({ send: vector => this.#sendDirectionIntent(vector), stop: () => this.#stopDirection(), canSend: () => this.#hasDirectionCapacity(), fail, uncertain: () => {
        this.#actions = this.#actions.map(draft => draft.status === 'waiting' && ['move_direction', 'stop_move'].includes(parseSpatial('PublicEnvelope', draft.raw).action.kind)
          ? { ...draft, status: 'unknown', detail: '原移动结果尚未确认，请查询或原样重试。' } : draft);
      } }) : new ContinuousDirection({ send: vector => this.#moveDirection(vector), stop: () => this.#stopDirection(), reset: () => { this.#directionAnchor = null; }, fail });
    }
    if (this.#connection !== 'online' || !p?.self.canControl || p.phase !== 'Running' || this.#source?.controlEpoch !== p.self.controlEpoch) this.#direction.clear();
    else if (p.paused) this.#direction.set(null);
    this.#options.onChange(this.state);
  }
  #update(id: string, patch: Partial<SpatialDraft>) {
    const before = this.#actions.find(draft => draft.id === id);
    this.#actions = retainActions(this.#actions.map(a => a.id === id ? (a.receipt && (patch.status === 'unknown' || patch.status === 'waiting') ? a : { ...a, ...patch }) : a));
    const draft = this.#actions.find(value => value.id === id);
    if (draft?.status !== 'waiting') this.#clearDirectionDeadline(id);
    const kind = draft && parseSpatial('PublicEnvelope', draft.raw).action.kind;
    const becameUnknown = draft?.status === 'unknown' && before?.status !== 'unknown' && (kind === 'move_direction' || kind === 'stop_move' && this.#direction instanceof DirectionIntent);
    // Unknown冻结会话待发意图；后续查询只收束原串，不能恢复未知前的持键。
    if (becameUnknown) this.#direction.clear();
    // 原Receipt已收束，即使旧网络Promise仍未返回也可重建空意图代次；准入仍检查原账本。
    if (before?.status === 'unknown' && draft?.receipt && this.#direction instanceof DirectionIntent) this.#directionBinding = '';
    this.#publish();
    if (becameUnknown && kind === 'move_direction' && !this.#pendingStop() && this.#needsDirectionStop()) void this.#stopDirection().catch(() => {});
    if (this.#direction instanceof DirectionIntent) this.#direction.refresh();
  }
  #hasDirectionCapacity() {
    let directions = 0;
    for (const draft of this.#actions) {
      if (!['waiting', 'unknown'].includes(draft.status)) continue;
      const kind = parseSpatial('PublicEnvelope', draft.raw).action.kind;
      if (kind === 'stop_move' || draft.status === 'unknown' && ['move_to', 'move_direction'].includes(kind)) return false;
      if (kind === 'move_direction') directions++;
    }
    return directions < 2;
  }
  #pendingStop() { return this.#actions.some(draft => ['waiting', 'unknown'].includes(draft.status) && parseSpatial('PublicEnvelope', draft.raw).action.kind === 'stop_move'); }
  #needsDirectionStop() {
    let move = '0', stop = '0';
    for (const draft of this.#actions) {
      const envelope = parseSpatial('PublicEnvelope', draft.raw), action = envelope.action;
      if (envelope.sessionId !== this.#sessionId || envelope.controlEpoch !== this.#source?.controlEpoch) continue;
      if (action.kind === 'move_direction' && compareDecimal(action.movementCommandSeq, move) > 0) move = action.movementCommandSeq;
      if (action.kind === 'stop_move' && draft.status !== 'rejected' && compareDecimal(action.movementCommandSeq, stop) > 0) stop = action.movementCommandSeq;
    }
    // 一个更高序号stop已覆盖该批原方向；多个超时不能重复发送新的stop。
    return compareDecimal(move, stop) > 0;
  }
  #clearDirectionDeadline(id: string) {
    const timer = this.#directionDeadlines.get(id); if (timer !== undefined) directionClock.clearTimeout(timer);
    this.#directionDeadlines.delete(id);
  }
  #clearDirectionDeadlines() { for (const id of this.#directionDeadlines.keys()) this.#clearDirectionDeadline(id); }
  #releaseControlIdle() { for (const resolve of this.#controlIdleWaiters.splice(0)) resolve(); }
  #armDirectionDeadline(draft: SpatialDraft) {
    const kind = parseSpatial('PublicEnvelope', draft.raw).action.kind;
    if (kind !== 'move_direction' && !(kind === 'stop_move' && this.#direction instanceof DirectionIntent)) return;
    this.#clearDirectionDeadline(draft.id);
    // 原请求在会话账本计时；地图/视图重新绑定不延长400ms，也不丢失未决原串。
    this.#directionDeadlines.set(draft.id, directionClock.setTimeout(() => {
      this.#directionDeadlines.delete(draft.id);
      if (this.#actions.find(value => value.id === draft.id)?.status === 'waiting') this.#update(draft.id, { status: 'unknown', detail: '原移动确认已超过400ms，请查询原请求。' });
    }, DIRECTION_RECEIPT_DEADLINE_MS));
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
    this.#direction.clear(); this.#clearDirectionDeadlines(); this.#navigation = null; this.#releaseControlIdle();
    this.#serial++; if (this.#heartbeat) clearInterval(this.#heartbeat); if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#heartbeat = null; this.#retryTimer = null; const link = this.#link; this.#link = null; link?.close();
    this.#view.begin(''); this.#sessionId = ''; this.#token = ''; this.#connection = 'idle'; this.#source = null; this.#queued = null; this.#controlBusy = false; this.#pendingControl = null; this.#syncDemand = ''; this.#message = '';
    this.#actions = this.#actions.map(a => a.status === 'waiting' ? { ...a, status: 'unknown', detail: '连接已结束，结果待确认。' } : a); this.#publish();
  }
  reconnect() { if (this.#sessionId && this.#token) this.#openConnection(); }
  #openConnection() {
    this.#direction.clear(); this.#clearDirectionDeadlines(); this.#navigation = null; this.#releaseControlIdle();
    if (this.#retryTimer) clearTimeout(this.#retryTimer); this.#retryTimer = null;
    const serial = ++this.#serial; const generation = this.#view.begin(this.#sessionId);
    const old = this.#link; this.#link = null; old?.close(); this.#source = null; this.#queued = null; this.#pendingControl = null; this.#controlBusy = false; this.#syncDemand = '';
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
    this.#direction.clear(); this.#clearDirectionDeadlines(); this.#navigation = null; this.#releaseControlIdle();
    const next = ++this.#serial; const link = this.#link; this.#link = null; link?.close(); this.#view.begin(this.#sessionId);
    this.#source = null; this.#queued = null; this.#controlBusy = false; this.#pendingControl = null; this.#syncDemand = ''; this.#connection = 'offline'; this.#message = '连接已断开，正在重新获取授权视图。';
    this.#actions = this.#actions.map(a => a.status === 'waiting' ? { ...a, status: 'unknown', detail: '原动作结果未知，可恢复后查询或原样重试。' } : a); this.#publish();
    if (retry && next === this.#serial && this.#sessionId && this.#token && this.#options.reconnectDelayMs > 0) this.#retryTimer = setTimeout(() => { if (next === this.#serial) this.#openConnection(); }, this.#options.reconnectDelayMs);
  }
  #handleError(value: unknown): boolean {
    const error = asError(value); if (!error) return false;
    this.#message = spatialErrorMessage(error.code);
    if (['UNAUTHENTICATED', 'FORBIDDEN', 'SESSION_GONE', 'UPGRADE_REQUIRED'].includes(error.code)) {
      const token = this.#token; this.#serial++; this.#view.begin(this.#sessionId); this.#source = null; this.#queued = null; this.#connection = 'forbidden';
      this.#navigation = null; this.#direction.clear();
      const link = this.#link; this.#link = null; link?.close(); this.#controlBusy = false; this.#publish();
      if (error.code === 'UNAUTHENTICATED') this.#options.onUnauthenticated(token);
    } else if (['RESYNC_REQUIRED', 'STALE_REFERENCE'].includes(error.code)) this.#openConnection();
    else this.#publish();
    return true;
  }
  async #subscribe(serial: number, generation: number) {
    const link = this.#link; if (!link) return; this.#connection = 'synchronizing'; this.#publish();
    try {
      await this.#reply(link, 'session.subscribe', { sessionId: this.#sessionId }, value => {
        if (serial !== this.#serial || link !== this.#link || generation !== this.#view.generation) return;
        if (asError(value)) { this.#initialFailure(value, serial); return; }
        if (this.#view.acceptSnapshot(value, generation) !== 'applied') { this.#disconnect(serial, false); this.#message = '空间授权视图校验未通过，请重新连接。'; this.#publish(); return; }
        this.#connection = 'online'; this.#message = ''; this.#publish(); void this.sync();
        // 逐个查询旧未知动作，但在途数量有界，避免重连瞬间用收据请求占满数据库连接/行锁，
        // 饿死紧随其后的 control.resume。连接更换后旧队列即作废。
        this.#replayUnknown(this.#actions.filter(a => a.status === 'unknown').map(a => a.id), serial);
      });
    } catch { this.#disconnect(serial); }
  }
  #batch(value: unknown, generation: number, requestRefetch = true, record?: (result: BatchResult) => void) {
    if (this.#handleError(value)) return 'stale';
    const result = this.#view.applyBatch(value, generation);
    record?.(result); // View已接受的结果先固定，后续显示订阅者失败不能重放本批。
    if (result === 'applied') { this.#publish(); this.#drainQueued(); this.#drainNavigation(); }
    else if (result === 'resync') this.#openConnection();
    else if (result === 'refetch' && requestRefetch) void this.sync();
    return result;
  }
  async sync() {
    const snapshot = this.#view.snapshot; const link = this.#link; const serial = this.#serial; const generation = this.#view.generation;
    const revision = this.#syncRevision; const key = `${serial}:${generation}:${revision}`;
    // 控制事务会替换服务端视图；结果未决时，不用旧视图补发打断同一连接上的原 nonce。
    if (!snapshot || !link?.connected || this.#pendingControl) return;
    // 同一物理link的旧请求直到settle仍占槽；控制安装新view只替换最新待读需求。
    if (this.#syncActive.has(link)) { this.#syncDemand = key; return; }
    this.#syncActive.add(link); this.#syncDemand = '';
    let frontier: string | undefined;
    try {
      for (let page = 0; page < 8; page++) {
        if (revision !== this.#syncRevision || this.#pendingControl) break;
        const request = this.#view.syncRequest(); if (!request) break;
        const outcome: { result: BatchResult; frontier?: string } = { result: 'stale' };
        await this.#reply(link, 'sync.request', canonicalize(request), value => {
          if (serial !== this.#serial || link !== this.#link) return;
          // 同连接真实撤权仍优先于旧view/revision；旧link不能影响新连接。
          const error = asError(value);
          if (error && ['UNAUTHENTICATED', 'FORBIDDEN', 'SESSION_GONE', 'UPGRADE_REQUIRED'].includes(error.code)) { this.#handleError(value); return; }
          if (generation !== this.#view.generation || revision !== this.#syncRevision) return;
          this.#batch(value, generation, false, result => { outcome.result = result; if (result === 'applied') outcome.frontier = (value as BatchV2).syncFrontierSeq; });
        });
        // 本次回复自身无法应用，不算外部fresh需求，避免无限refetch自循环。
        if (outcome.result !== 'applied') break;
        if (serial !== this.#serial || generation !== this.#view.generation || revision !== this.#syncRevision) return;
        if (link.acceptedCapabilities?.includes(DIRECTION_CAPABILITY)) {
          // 整批已严格校验且连续应用；目标只取首个有效回复，不裁轨迹或追逐后页新提交。
          frontier ??= outcome.frontier;
          const cursor = this.#view.snapshot?.snapshotSeq;
          if (frontier !== undefined && cursor !== undefined && compareDecimal(cursor, frontier) >= 0) break;
        }
      }
    } catch { if (serial === this.#serial && generation === this.#view.generation && revision === this.#syncRevision) { this.#message = '状态同步暂未完成，当前位置仍以上次服务器确认为准。'; this.#publish(); } }
    finally {
      this.#syncActive.delete(link);
      if (this.#link === link && serial === this.#serial) {
        const requested = this.#syncDemand; this.#syncDemand = '';
        // 活动期间的ACK/推送/心跳合并为一次后续轮；每轮仍只有8页。
        if (requested) queueMicrotask(() => {
          const current = `${this.#serial}:${this.#view.generation}:${this.#syncRevision}`;
          if (requested === current && serial === this.#serial && this.#link === link && link.connected
            && !this.#pendingControl && !this.#syncActive.has(link)) void this.sync();
        });
      }
    }
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
    this.#direction.clear(); this.#navigation = null;
    this.#queued = null; const action = this.#source!.move(scene.sceneId, position, options);
    if (after && action.kind === 'move_to') this.#queued = { action: validateSpatial('ActionV2', after), sequence: action.movementCommandSeq, epoch: snapshot.projection.self.controlEpoch, viewId: snapshot.viewId, mapVersion: snapshot.projection.mapVersion, targetRef: options.targetRef, targetSignature: targetSignature(snapshot, options.targetRef) };
    await this.send(action, true);
  }
  async stop() { this.#ready(); this.#direction.clear(); this.#queued = null; this.#navigation = null; await this.send(this.#source!.stop(), true); }
  async traverseExit(exitId: string) {
    this.#direction.clear(); this.#navigation = null;
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
  cancelQueued() { this.#queued = null; this.#navigation = null; this.#direction.clear(); this.#publish(); }
  confirmDisplayedArrival(value: { viewId: string; epoch: string; movementId: string; sequence: string; position: Position }) {
    const snapshot = this.#view.snapshot; const p = snapshot?.projection;
    if (!snapshot || !p || snapshot.viewId !== value.viewId || p.self.controlEpoch !== value.epoch || p.movement?.movementId !== value.movementId || p.movement.movementCommandSeq !== value.sequence || p.movement.status !== 'arrived' || p.self.position?.x !== value.position.x || p.self.position?.y !== value.position.y) return;
    // 显示确认可以先于原收据到达；保留事件携带的真实计划身份，不借用同号旧计划。
    this.#displayedArrival = `${value.viewId}:${value.epoch}:${value.movementId}:${value.sequence}`; this.#drainQueued(); this.#drainNavigation();
  }
  async send(action: ActionV2, preserveQueued = false) {
    const snapshot = this.#ready(); if (!preserveQueued) { this.#queued = null; this.#navigation = null; this.#direction.clear(); }
    if (action.kind === 'move_direction' && !this.#link?.acceptedCapabilities?.includes(DIRECTION_CAPABILITY)) throw new Error('当前连接未确认方向行走能力。');
    if (action.kind === 'move_direction' && !this.#hasDirectionCapacity()) throw new Error('原方向请求仍未决，请等待确认或查询原请求。');
    if (action.kind === 'stop_move' && this.#direction instanceof DirectionIntent && this.#pendingStop()) throw new Error('原停步请求仍未决，请查询原请求。');
    const envelope: PublicEnvelope = validateSpatial('PublicEnvelope', { schemaVersion: 2, sessionId: snapshot.sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, clientActionId: this.#options.id(), controlEpoch: snapshot.projection.self.controlEpoch, baseSeq: snapshot.snapshotSeq, action });
    const draft: SpatialDraft = { id: envelope.clientActionId, raw: canonicalize(envelope), status: 'waiting', detail: action.kind === 'move_to' ? '正在提交路线，尚未到达。' : '等待服务器确认。', receipt: null };
    this.#actions = retainActions([...this.#actions, draft]); this.#armDirectionDeadline(draft); this.#publish(); await this.#deliver(draft);
    return this.#actions.find(value => value.id === draft.id);
  }
  async retry(id: string) {
    const draft = this.#actions.find(a => a.id === id); if (!draft || draft.status !== 'unknown' || !this.#link?.connected || !this.#view.snapshot) return;
    const kind = parseSpatial('PublicEnvelope', draft.raw).action.kind;
    if (kind === 'move_direction' && !this.#link.acceptedCapabilities?.includes(DIRECTION_CAPABILITY)) { this.#message = '当前兼容连接不能重发该方向请求，请查询原结果。'; this.#publish(); return; }
    // 原方向重试仍属于同一个Unknown；只有原Receipt能解除冻结，不重新开始400ms。
    const frozen = kind === 'move_direction' || kind === 'stop_move' && this.#direction instanceof DirectionIntent;
    this.#update(id, { status: frozen ? 'unknown' : 'waiting', detail: '正在原样重试，不重新分配命令序号。' }); await this.#deliver(draft);
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
      const navigation = this.#navigation;
      if (envelope.action.kind === 'move_to' && navigation?.step?.sequence === envelope.action.movementCommandSeq && navigation.epoch === envelope.controlEpoch && navigation.viewId === envelope.viewId) {
        if (receipt.status === 'Rejected') this.#cancelNavigation(spatialErrorMessage(receipt.code));
        else navigation.step.movementId = receipt.result.movementId;
      }
      this.#update(draft.id, { receipt, status: receipt.status === 'Accepted' ? 'accepted' : 'rejected', detail: receipt.status === 'Rejected' ? spatialErrorMessage(receipt.code) : envelope.action.kind === 'move_to' ? '路线已受理；实际到达以后才会操作。' : '服务器已确认。' }); this.#drainQueued(); this.#drainNavigation(); void this.sync();
    } catch { this.#update(draft.id, { status: 'unknown', detail: '收据校验未通过，结果仍待确认。' }); }
  }
  // 每批至多三条；本批全部收束后才启动下一批。连接代次变化使旧队列失效。
  #replayUnknown(ids: string[], serial: number) {
    this.#replaySerial = serial; this.#replayQueue = [...ids];
    if (this.#replaying) return;
    this.#replaying = true;
    queueMicrotask(() => void this.#drainReplay());
  }
  async #drainReplay() {
    while (this.#replayQueue.length && this.#serial === this.#replaySerial) {
      // 控制恢复期间不再启动新一批收据查询；已在途的原查询继续按原语义收束。
      if (this.#controlBusy || this.#pendingControl) {
        await new Promise<void>(resolve => this.#controlIdleWaiters.push(resolve));
        continue;
      }
      const active: Promise<unknown>[] = [];
      while (active.length < RECEIPT_REPLAY_LIMIT && this.#replayQueue.length && this.#serial === this.#replaySerial) {
        const id = this.#replayQueue.shift()!;
        active.push(this.query(id).catch(() => {}));
      }
      if (!active.length) break;
      await Promise.all(active);
    }
    this.#replaying = false;
  }
  async query(id: string) {
    const draft = this.#actions.find(a => a.id === id); const serial = this.#serial; if (!draft || !this.#view.snapshot) return;
    try { const value = await this.#api.receipt(this.#sessionId, id); if (serial !== this.#serial) return; if (value) this.#receipt(draft, value); else this.#update(id, { status: 'unknown', detail: '尚未查到收据，可原样重试。' }); }
    catch (error) { if (serial === this.#serial) { if (error instanceof ApiFailure) this.#handleError({ schemaVersion: 2, code: error.code, message: error.message }); this.#update(id, { status: 'unknown', detail: '暂时无法查询，保留原请求。' }); } }
  }
  async control(kind: 'resume' | 'take') {
    const snapshot = this.#view.snapshot; const link = this.#link; const serial = this.#serial; const generation = this.#view.generation;
    if (!snapshot || !link?.connected || this.#controlBusy || snapshot.projection.phase !== 'Running') return;
    this.#queued = null; this.#navigation = null; this.#direction.clear(); const type = kind === 'take' ? 'control.take' : 'control.resume';
    const old = this.#pendingControl;
    const request = old?.serial === serial && old.request.type === type ? old.request : validateSpatial('ControlRequestV2', { schemaVersion: 2, type, sessionId: snapshot.sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce: this.#options.id() });
    const raw = old?.request === request ? old.raw : canonicalize(request); this.#pendingControl = { request, raw, serial }; const revision = ++this.#syncRevision; this.#controlBusy = true; this.#publish();
    let installed = false;
    try {
      await this.#reply(link, type, raw, value => {
        if (serial !== this.#serial || link !== this.#link) return;
        const error = asError(value);
        if (error && ['UNAUTHENTICATED', 'FORBIDDEN', 'SESSION_GONE', 'UPGRADE_REQUIRED'].includes(error.code)) { this.#pendingControl = null; this.#handleError(value); return; }
        if (generation !== this.#view.generation || revision !== this.#syncRevision || this.#pendingControl?.request.nonce !== request.nonce) return;
        if (error) { if (error.code !== 'OUTCOME_UNKNOWN') this.#pendingControl = null; this.#handleError(value); return; }
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
        installed = true;
        if (!knownSource) this.#source = newEpoch ? new MovementCommandSource(response.controlEpoch) : null;
        this.#pendingControl = null; this.#message = this.#source ? '已恢复本人控制。' : '本地输入序号已丢失，请明确接管以建立新的控制周期。'; this.#publish();
      });
    } catch { if (serial === this.#serial) { this.#message = installed ? '控制视图已确认，显示更新暂未完成。' : '控制结果待确认，再次点击会重试原请求。'; this.#publish(); } }
    finally { if (serial === this.#serial) { this.#controlBusy = false; this.#publish(); this.#releaseControlIdle(); void this.sync(); } }
  }
  #readyDirection() {
    const snapshot = this.#ready();
    if (this.#actions.some(draft => {
      const kind = parseSpatial('PublicEnvelope', draft.raw).action.kind;
      return (draft.status === 'unknown' && ['move_to', 'move_direction', 'stop_move'].includes(kind)) || (draft.status === 'waiting' && kind === 'stop_move' && !this.#direction.canResumeAfterStop);
    })) throw new Error('上一项移动或停步结果尚未确认，请先查询或原样重试。');
    return snapshot;
  }
  setDirection(vector: Position | null) {
    const size = vector ? Math.hypot(vector.x, vector.y) : 0;
    if (!size || !Number.isFinite(size) || (this.#directionAnchor && (this.#directionAnchor.vector.x !== vector!.x / size || this.#directionAnchor.vector.y !== vector!.y / size))) this.#directionAnchor = null;
    if (vector && (vector.x || vector.y)) {
      try {
        this.#readyDirection();
        this.#queued = null; this.#navigation = null;
        if (this.#direction instanceof DirectionIntent) this.#direction.recover();
        if (this.#link?.capabilityFallback) this.#message = '当前服务器使用兼容行走模式。';
      } catch (error) { this.#direction.clear(); this.#message = error instanceof Error ? error.message : '当前不能继续行走。'; this.#publish(); return; }
    }
    this.#direction.set(vector);
  }
  async #sendDirectionIntent(vector: Position) {
    const snapshot = this.#readyDirection(), p = snapshot.projection;
    if (!p.scene || !p.self.position || p.paused || !this.#directionBinding) throw new Error('当前不能继续方向行走。');
    const facing = (['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'] as Facing[])[(Math.round(Math.atan2(vector.y, vector.x) / (Math.PI / 4)) + 8) % 8]!;
    const draft = await this.send(this.#source!.direction(p.scene.sceneId, p.mapVersion, facing), true);
    return draft?.status === 'accepted' || draft?.status === 'rejected' ? draft.status : 'unknown' as const;
  }
  async #moveDirection(vector: Position) {
    // 停步成功后的自动续发也重查原请求；不能绕过稍后变为未知的旧move。
    const snapshot = this.#readyDirection(), p = snapshot.projection;
    if (!p.scene || !p.self.position || p.paused) throw new Error('当前场景暂停行走。');
    const identity = JSON.stringify([snapshot.viewId, p.self.controlEpoch, p.self.entityRef, p.self.appearanceEpoch, p.self.sceneId, p.mapVersion]);
    if (!this.#directionAnchor || this.#directionAnchor.identity !== identity) this.#directionAnchor = { vector: { ...vector }, position: { ...p.self.position }, identity };
    // 只保存输入意图的零轴，不让滞后授权坐标在每次续发时反复改变纯横/竖方向。
    const destination = directionTarget(p.scene, p.self.position, vector, this.#directionAnchor.position);
    if (!destination) throw new Error('这个方向已到达边界或被挡住。');
    const draft = await this.send(this.#source!.move(p.scene.sceneId, destination), true);
    if (draft?.status !== 'accepted') throw new Error(draft?.status === 'rejected' ? draft.detail : '移动结果尚未确认，已请求停步；请查询原请求。');
  }
  async #stopDirection() {
    if (this.#connection !== 'online' || !this.state.inputReady || this.#view.snapshot?.projection.phase !== 'Running') return;
    if (this.#pendingStop()) throw new Error('原停步请求仍未决，请查询原请求。');
    this.#queued = null; this.#navigation = null;
    const draft = await this.send(this.#source!.stop(), true);
    if (draft?.status !== 'accepted') throw new Error('停步结果尚未确认。');
  }
  async navigateTo(sceneId: string, position: Position): Promise<void> {
    const snapshot = this.#ready(), p = snapshot.projection, destination = p.mapCatalog?.find(scene => scene.sceneId === sceneId);
    if (!destination || !p.scene || !Number.isSafeInteger(position.x) || !Number.isSafeInteger(position.y) || position.x < 0 || position.y < 0 || position.x > destination.width || position.y > destination.height || !mapRoute(p.mapCatalog!, p.scene.sceneId, sceneId)) throw new Error('目的地没有可用的公开路线。');
    this.#direction.clear(); this.#queued = null;
    this.#navigation = { destinationSceneId: sceneId, destination: { ...position }, phase: 'approaching-destination', viewId: snapshot.viewId, epoch: p.self.controlEpoch, mapVersion: p.mapVersion, step: null };
    try { await this.#advanceNavigation(); }
    catch (error) { this.#navigation = null; this.#publish(); throw error; }
  }
  #cancelNavigation(message?: string) {
    if (!this.#navigation) return;
    this.#navigation = null; if (message) this.#message = message; this.#publish();
  }
  async #advanceNavigation() {
    const navigation = this.#navigation; if (!navigation) return;
    const snapshot = this.#ready(), p = snapshot.projection, scene = p.scene;
    if (!scene || snapshot.viewId !== navigation.viewId || p.self.controlEpoch !== navigation.epoch || p.mapVersion !== navigation.mapVersion) { this.#cancelNavigation('场景或控制状态已改变，请重新选择路线。'); return; }
    let action: ActionV2;
    if (scene.sceneId === navigation.destinationSceneId) {
      action = this.#source!.move(scene.sceneId, navigation.destination);
      if (action.kind !== 'move_to') return;
      navigation.phase = 'approaching-destination'; navigation.step = { sequence: action.movementCommandSeq, sceneId: scene.sceneId, originSceneId: scene.sceneId };
    } else {
      const route = mapRoute(p.mapCatalog ?? [], scene.sceneId, navigation.destinationSceneId);
      const exit = route?.[0] && scene.exits.find(value => value.exitId === route[0].exitId && value.destinationSceneId === route[0].destinationSceneId && value.open);
      const anchor = exit && scene.anchors.find(value => value.anchorId === exit.anchorId);
      if (!exit || !anchor) throw new Error('当前路线的出口尚未开放或不可达。');
      action = this.#source!.move(scene.sceneId, anchor.position, { anchorId: anchor.anchorId });
      const crossing = this.#source!.move(exit.destinationSceneId, exit.destination);
      if (action.kind !== 'move_to') return;
      navigation.phase = 'approaching-exit'; navigation.step = { sequence: action.movementCommandSeq, sceneId: scene.sceneId, originSceneId: scene.sceneId, crossing, exitId: exit.exitId };
    }
    this.#publish(); await this.send(action, true);
  }
  #drainNavigation() {
    const navigation = this.#navigation, snapshot = this.#view.snapshot, step = navigation?.step;
    if (!navigation || !snapshot || !step) return;
    const p = snapshot.projection, movement = p.movement;
    if (snapshot.viewId !== navigation.viewId || p.self.controlEpoch !== navigation.epoch || p.mapVersion !== navigation.mapVersion || !p.self.canControl || p.phase !== 'Running') { this.#cancelNavigation('控制或场景版本已改变，原路线已取消。'); return; }
    const order = compareDecimal(p.self.movementCommandHighWater, step.sequence);
    if (order > 0) { this.#cancelNavigation(); return; }
    if (p.self.sceneId !== step.sceneId) {
      // crossing发出到确认之间仍可暂时留在来源场景；其他跨景绝不沿用旧链。
      if (navigation.phase === 'crossing' && p.self.sceneId === step.originSceneId && order < 0) return;
      this.#cancelNavigation('已离开原路线，自动前往已取消。'); return;
    }
    if (order < 0 || !step.movementId || movement?.movementId !== step.movementId) return;
    if (movement.movementCommandSeq !== step.sequence || ['cancelled', 'blocked'].includes(movement.status)) { this.#cancelNavigation(movement.reason || '路线已中止。'); return; }
    const visual = !this.#options.waitForVisualArrival || this.#displayedArrival === `${snapshot.viewId}:${p.self.controlEpoch}:${movement.movementId}:${movement.movementCommandSeq}`;
    if (movement.status !== 'arrived' || !visual || p.paused || !this.state.inputReady) return;
    if (navigation.phase === 'approaching-exit') {
      const crossing = step.crossing, exit = p.scene?.exits.find(value => value.exitId === step.exitId && value.open);
      if (crossing?.kind !== 'move_to' || !exit || exit.destinationSceneId !== crossing.sceneId) { this.#cancelNavigation('出口状态已改变，原路线已取消。'); return; }
      navigation.phase = 'crossing'; navigation.step = { sequence: crossing.movementCommandSeq, originSceneId: step.sceneId, sceneId: crossing.sceneId };
      this.#publish(); void this.send(crossing, true).catch(error => this.#cancelNavigation(error instanceof Error ? error.message : '出口前往尚未确认。'));
    } else if (navigation.phase === 'crossing') {
      navigation.step = null;
      void this.#advanceNavigation().catch(error => this.#cancelNavigation(error instanceof Error ? error.message : '下一段路线不可用。'));
    } else { this.#navigation = null; this.#publish(); }
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
