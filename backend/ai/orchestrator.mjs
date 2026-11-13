import { reserveCall, saveOutput, saveOutcome, callCount } from './persistence.mjs';
import { RuntimeError } from '../errors.mjs';
import { decodeStoredOutput, isPersistableIntent } from './output.mjs';
import { parseProposedIntent, intentSemanticDigestSync } from '../../protocol/node.mjs';
import { parseSpatialProposedIntent } from '../../protocol/spatial-ai.mjs';
import { spatialIntentSemanticDigestSync } from '../../protocol/spatial-ai-node.mjs';
import { storedSpatialContext, isSpatialRecoveryUnknown } from './spatial-decisions.mjs';

/** 移动检查点只用于规则模拟；到达、许可、观察与真正使用的资源变化才唤醒模型。 */
function spatialWake(actor, event, resumes) {
  const id = actor.handle.actorId, p = event.payload;
  if ([actor.decision?.decisionId, actor.recoveryWork?.decision.decisionId].some(decisionId => decisionId && event.causedBy?.actionId === `${decisionId}:fallback`)) return false;
  if (event.kind === 'spatial.clock') return resumes.has(event.sessionSeq);
  if (event.kind === 'spatial.observation') return p.observerId === id;
  if (event.kind === 'spatial.claim') return Object.hasOwn(p.views, id) && event.causedBy?.actorId !== id;
  if (event.kind === 'control.changed') return p.actorId === id;
  if (event.kind === 'spatial.started') return true;
  if (event.kind === 'spatial.actor') {
    const current = p.actor, own = current.characterId === id;
    const semantic = `${current.appearanceEpoch}/${current.resourceRevision}/${own ? current.movement?.movementId ?? '' : ''}/${own ? ['accepted', 'moving'].includes(current.movement?.status) ? 'moving' : current.movement?.status ?? '' : ''}`;
    const previous = actor.semanticStates.get(current.characterId);
    if (previous && BigInt(event.sessionSeq) <= BigInt(previous.seq)) return false;
    actor.semanticStates.set(current.characterId, { semantic, seq: event.sessionSeq });
    const relevant = own || Object.values(actor.decision?.readVersions ?? {}).some(value => value.id === current.characterId);
    return relevant && previous !== undefined && previous.semantic !== semantic;
  }
  if (['spatial.item', 'spatial.target'].includes(event.kind)) {
    const current = p.item ?? p.target, id = current.itemId ?? current.targetId;
    return Object.values(actor.decision?.readVersions ?? {}).some(value => value.id === id && value.resourceRevision !== current.resourceRevision);
  }
  return false;
}

const recoveryBlocked = new Set(['Unknown', 'Unavailable', 'BudgetExhausted']);
const queued = actor => !actor.ended && (actor.dirty || (actor.pendingSemanticSeq !== null && !recoveryBlocked.has(actor.phase)));

/** 从本次已提交事务的真实前态折叠；单个 false 时钟不能被猜作恢复。 */
function spatialResumes(events, before) {
  const resumes = new Set();
  for (const event of events) if (event.kind === 'spatial.clock') {
    if (before === true && event.payload.paused === false) resumes.add(event.sessionSeq);
    before = event.payload.paused;
  }
  return resumes;
}

/** 单进程的有界调度器；数据库仍决定权限、时序及每一项实际效果。 */
export class AIOrchestrator {
  #runtime; #gateway; #actors = new Map(); #tasks = new Set(); #timer = null; #closed = false; #closing;
  #maxConcurrent; #minIntervalMs; #maxCallsPerSession; #onCommit; #onAuthorization;
  #lastServedKey = null;
  constructor({ runtime, gateway, maxConcurrent = 2, minIntervalMs = 1000, maxCallsPerSession = 60 }) {
    for (const [name, value] of Object.entries({ maxConcurrent, minIntervalMs, maxCallsPerSession })) if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name}必须为正整数。`);
    this.#runtime = runtime; this.#gateway = gateway; this.#maxConcurrent = maxConcurrent;
    this.#minIntervalMs = minIntervalMs; this.#maxCallsPerSession = maxCallsPerSession;
    this.#onCommit = ({ sessionId, events, spatialPauseBefore }) => {
      const resumes = spatialResumes(events, spatialPauseBefore);
      for (const actor of this.#actors.values()) if (actor.handle.sessionId === sessionId) {
        if (events.some(event => event.kind === 'session.finished' || event.kind === 'session.aborted' || (event.kind === 'control.changed' && event.payload.actorId === actor.handle.actorId && actor.decision && BigInt(event.payload.controlEpoch) > BigInt(actor.decision.controlEpoch)))) actor.controller?.abort();
        const ended = events.some(event => event.kind === 'session.finished' || event.kind === 'session.aborted');
        if (ended) { actor.ended = true; actor.dirty = false; actor.pendingSemanticSeq = null; continue; }
        if (actor.ended) continue;
        const spatialEvents = events.some(event => event.schemaVersion === 2);
        if (spatialEvents) {
          for (const event of events) if (spatialWake(actor, event, resumes) && actor.autoWake && BigInt(event.sessionSeq) > BigInt(actor.lastSemanticSeq)) {
            actor.lastSemanticSeq = event.sessionSeq; actor.pendingSemanticSeq = event.sessionSeq;
            // 新语义可请求一次恢复；未决结果仍先走001的有限重试，不让保留水位自行循环。
            if (recoveryBlocked.has(actor.phase)) actor.dirty = true;
          }
          this.#pump();
        } else if (actor.autoWake && !events.every(event => event.kind === 'GoalUpdated' && event.payload.holderId === actor.handle.actorId)) this.wake(actor.handle);
      }
    };
    this.#onAuthorization = ({ sessionId }) => {
      for (const actor of this.#actors.values()) if (actor.handle.sessionId === sessionId && actor.handle.principalKind === 'proxy') { actor.controller?.abort(); if (actor.autoWake) this.wake(actor.handle); }
    };
    runtime.on('commit', this.#onCommit); runtime.on('authorization', this.#onAuthorization);
  }
  watch(handle, { wake = true, autoWake = true } = {}) {
    if (this.#closed) throw new Error('调度器已经关闭。');
    this.#runtime.internal(handle);
    const key = `${handle.sessionId}/${handle.actorId}/${handle.principalKind}`;
    const existing = this.#actors.get(key);
    if (existing && existing.handle !== handle) throw new Error('同一角色已经注册，必须复用可信句柄。');
    if (!existing) this.#actors.set(key, { handle, autoWake, active: false, dirty: false, ended: false, pendingSemanticSeq: null, lastSemanticSeq: '0', nextEligibleAt: 0, phase: 'Idle', calls: 0, decision: null, recoveryWork: null, controller: null, lastReceipt: null, lastFallback: null, error: null, retries: 0, semanticStates: new Map() });
    if (wake) this.wake(handle);
  }
  #actor(handle) { return this.#actors.get(`${handle.sessionId}/${handle.actorId}/${handle.principalKind}`); }
  wake(handle) {
    const actor = this.#actor(handle);
    if (this.#closed || !actor || actor.handle !== handle || actor.ended) return;
    actor.dirty = true; this.#pump();
  }
  status(handle) {
    const actor = this.#actor(handle);
    if (!actor || actor.handle !== handle) return null;
    return structuredClone({ phase: actor.phase, calls: actor.calls, pendingWake: queued(actor), decisionId: actor.recoveryWork?.decision.decisionId ?? actor.decision?.decisionId ?? null, lastReceipt: actor.lastReceipt, lastFallback: actor.lastFallback, error: actor.error });
  }
  async #recoverActor(actor) {
    try { return await this.#recoverPersisted(actor); }
    catch (error) {
      if ((actor.recoveryWork?.decision ?? actor.decision)?.schemaVersion !== 2 || !isSpatialRecoveryUnknown(error) || error.code === 'OUTCOME_UNKNOWN') throw error;
      const unknown = new RuntimeError('OUTCOME_UNKNOWN', '原空间决定的持久结果尚未确认，请保留原请求继续查询。');
      unknown.cause = error;
      throw unknown;
    }
  }
  async #recoverPersisted(actor) {
    const work = await this.#runtime.recoverDecisions(actor.handle);
    // Receipt 可能已经提交而响应丢失；在途引用保留原键，不能因待办枚举消失便宣称收到结果。
    if (actor.recoveryWork && !work.some(entry => entry.decision.decisionId === actor.recoveryWork.decision.decisionId)) work.unshift(actor.recoveryWork);
    for (const entry of work) {
      actor.recoveryWork = entry;
      const { decision: record, run } = entry;
      if (run?.semantic_digest && run.output_raw !== null) {
        // 即使 Decision 已终态，原提交也先查结果；查询未知绝不被解释成失败。
        let found = await this.#runtime.decisionReceipt(actor.handle, record.decisionId);
        if (!found) {
          if (this.#closed) return { blocked: true };
          const raw = decodeStoredOutput(run);
          const intent = record.schemaVersion === 2 ? parseSpatialProposedIntent(raw, record.decisionId, storedSpatialContext(record)) : parseProposedIntent(raw, record.decisionId);
          const semanticDigest = record.schemaVersion === 2 ? spatialIntentSemanticDigestSync(intent) : intentSemanticDigestSync(intent);
          if (semanticDigest !== run.semantic_digest) throw new RuntimeError('ACTION_ID_REUSE', '恢复的原文与已保存摘要不匹配。');
          // 旧版本可能把带 NUL 的 JSON 记为 Valid；确认无原收据后才拒绝，不能覆盖 Unknown。
          if (!isPersistableIntent(intent)) {
            await this.#runtime.settleDecision(actor.handle, record.decisionId, 'Rejected');
            await this.#finishDecision(actor, record.decisionId, 'UNPERSISTABLE_INTENT');
            actor.recoveryWork = null;
            continue;
          }
          const receipt = await this.#runtime.submitIntent(actor.handle, record.decisionId, raw);
          found = record.schemaVersion === 2 ? await this.#runtime.decisionReceipt(actor.handle, record.decisionId) : { receipt, semanticDigest: receipt.semanticDigest };
        }
        if (!found?.receipt.status || found.semanticDigest !== run.semantic_digest) throw new RuntimeError('ACTION_ID_REUSE', '恢复的原文与已保存收据不匹配。');
        actor.lastReceipt = found.receipt;
      } else if (record.status === 'Pending') {
        const reason = run?.model_result?.status;
        await this.#runtime.settleDecision(actor.handle, record.decisionId, ['Invalid', 'Timeout', 'ProviderError', 'Blocked'].includes(reason) ? 'Rejected' : 'Cancelled');
      }
      await this.#finishDecision(actor, record.decisionId);
      actor.recoveryWork = null;
    }
    return { blocked: false, recoveredSpatial: work.some(entry => entry.decision.schemaVersion === 2) };
  }
  async #finishDecision(actor, decisionId, rejectionReason = null) {
    const current = await this.#runtime.decisionState(actor.handle, decisionId);
    let fallback = null;
    if (['Rejected', 'Expired'].includes(current.status)) {
      fallback = await this.#runtime.submitFallback(actor.handle, decisionId);
      actor.lastFallback = fallback;
    }
    await saveOutcome(this.#runtime, actor.handle, decisionId, { decisionStatus: current.status, receipt: actor.lastReceipt?.clientActionId === `${decisionId}:submit` ? actor.lastReceipt : null, fallback, ...(rejectionReason ? { rejectionReason } : {}) });
  }
  recover(handle) {
    const actor = this.#actor(handle);
    if (this.#closed || !actor || actor.handle !== handle || actor.active) return Promise.reject(new Error('恢复需要已注册且空闲的角色。'));
    const recoveringSpatial = actor.phase === 'Unknown' && (actor.recoveryWork?.decision ?? actor.decision)?.schemaVersion === 2;
    // 显式恢复接替尚未执行的技术重试；期间真正的新唤醒仍可重新置 dirty。
    if (recoveringSpatial) actor.dirty = false;
    actor.active = true; actor.phase = 'Recovering';
    const task = (async () => {
      try { const result = await this.#recoverActor(actor); if (recoveringSpatial || result.recoveredSpatial) actor.retries = 0; actor.error = null; actor.phase = 'Idle'; return result; }
      catch (error) {
        actor.error = error.code ?? 'INTERNAL_ERROR'; actor.phase = error.code === 'OUTCOME_UNKNOWN' ? 'Unknown' : 'Unavailable';
        if (recoveringSpatial && error.code === 'OUTCOME_UNKNOWN' && ++actor.retries <= 3) { actor.dirty = true; actor.nextEligibleAt = performance.now() + this.#minIntervalMs; }
        throw error;
      }
    })();
    this.#tasks.add(task);
    task.finally(() => { actor.active = false; this.#tasks.delete(task); this.#pump(); }).catch(() => {});
    return task;
  }
  #pump() {
    clearTimeout(this.#timer); this.#timer = null;
    if (this.#closed) return;
    let next = Infinity;
    const entries = [...this.#actors], start = Math.max(0, entries.findIndex(([key]) => key === this.#lastServedKey) + 1);
    for (const [key, actor] of [...entries.slice(start), ...entries.slice(0, start)]) {
      if (!queued(actor) || actor.active) continue;
      if (this.#tasks.size >= this.#maxConcurrent) break;
      const wait = actor.nextEligibleAt - performance.now();
      if (wait > 0) { next = Math.min(next, wait); continue; }
      actor.active = true; actor.dirty = false; actor.nextEligibleAt = performance.now() + this.#minIntervalMs;
      // 从上次实际领槽角色之后继续；后来注册的第三人也在同一轮转中。
      this.#lastServedKey = key;
      const task = this.#run(actor);
      this.#tasks.add(task);
      task.finally(() => { actor.active = false; this.#tasks.delete(task); this.#pump(); }).catch(() => {});
    }
    if (next !== Infinity && this.#tasks.size < this.#maxConcurrent) this.#timer = setTimeout(() => this.#pump(), next);
  }
  async #run(actor) {
    const recoveringSpatial = actor.phase === 'Unknown' && (actor.recoveryWork?.decision ?? actor.decision)?.schemaVersion === 2;
    actor.controller = new AbortController(); actor.error = null;
    try {
      actor.phase = 'Preparing';
      const recovery = await this.#recoverActor(actor);
      if (recovery.blocked || this.#closed) return;
      // 恢复只收束原决定；有剩余预算也不能把一次技术重试变成新的推理。
      if (recoveringSpatial || recovery.recoveredSpatial) { actor.retries = 0; return; }
      if (await callCount(this.#runtime, actor.handle) >= this.#maxCallsPerSession) { actor.phase = 'BudgetExhausted'; actor.dirty = false; return; }
      const prepared = await this.#runtime.prepareDecisionContext(actor.handle);
      actor.decision = prepared.decision;
      if (actor.controller.signal.aborted || this.#closed) {
        await this.#runtime.settleDecision(actor.handle, actor.decision.decisionId, 'Cancelled'); return;
      }
      const reservation = await reserveCall(this.#runtime, actor.handle, prepared, this.#gateway.configuration(), this.#maxCallsPerSession);
      if (!reservation.reserved) { await this.#runtime.settleDecision(actor.handle, actor.decision.decisionId, 'Cancelled'); return; }
      if (prepared.decision.schemaVersion === 2) {
        const included = prepared.decision.baseSeq;
        if (BigInt(included) > BigInt(actor.lastSemanticSeq)) actor.lastSemanticSeq = included;
        if (actor.pendingSemanticSeq !== null && BigInt(actor.pendingSemanticSeq) <= BigInt(included)) actor.pendingSemanticSeq = null;
      }
      actor.calls++;
      actor.phase = 'Inferring';
      actor.nextEligibleAt = performance.now() + this.#minIntervalMs;
      const output = await this.#gateway.generate(prepared.context, { signal: actor.controller.signal, remainingMs: Math.max(1, Date.parse(actor.decision.deadlineAt) - this.#runtime.now()) });
      // 请求结束后保留完整间隔；序列化开销也不能压缩两次真实调用之间的距离。
      actor.nextEligibleAt = performance.now() + this.#minIntervalMs;
      await saveOutput(this.#runtime, actor.handle, actor.decision.decisionId, output);
      if (output.status === 'Valid' && !actor.controller.signal.aborted && !this.#closed) {
        actor.phase = 'Submitting';
        actor.lastReceipt = await this.#runtime.submitIntent(actor.handle, actor.decision.decisionId, output.rawText);
      } else {
        const status = output.status === 'Cancelled' || actor.controller.signal.aborted || this.#closed ? 'Cancelled' : this.#runtime.now() >= Date.parse(actor.decision.deadlineAt) ? 'Expired' : 'Rejected';
        await this.#runtime.settleDecision(actor.handle, actor.decision.decisionId, status);
      }
      await this.#finishDecision(actor, actor.decision.decisionId);
      actor.retries = 0;
    } catch (error) {
      actor.error = error.code ?? 'INTERNAL_ERROR'; actor.phase = error.code === 'OUTCOME_UNKNOWN' ? 'Unknown' : 'Unavailable';
      if (error.code === 'OUTCOME_UNKNOWN' && ++actor.retries <= 3) { actor.dirty = true; actor.nextEligibleAt = performance.now() + this.#minIntervalMs; }
    } finally { actor.controller = null; if (!actor.error && actor.phase !== 'BudgetExhausted') actor.phase = 'Idle'; }
  }
  close() {
    if (this.#closing) return this.#closing;
    this.#closed = true; clearTimeout(this.#timer); this.#timer = null;
    this.#runtime.off('commit', this.#onCommit); this.#runtime.off('authorization', this.#onAuthorization);
    for (const actor of this.#actors.values()) { actor.dirty = false; actor.pendingSemanticSeq = null; actor.controller?.abort(); }
    this.#closing = (async () => { await this.#gateway.close(); await Promise.allSettled([...this.#tasks]); this.#actors.clear(); })();
    return this.#closing;
  }
}
