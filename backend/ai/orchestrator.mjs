import { reserveCall, saveOutput, saveOutcome, callCount } from './persistence.mjs';
import { RuntimeError } from '../errors.mjs';

/** 单进程的有界调度器；数据库仍决定权限、时序及每一项实际效果。 */
export class AIOrchestrator {
  #runtime; #gateway; #actors = new Map(); #tasks = new Set(); #timer = null; #closed = false; #closing;
  #maxConcurrent; #minIntervalMs; #maxCallsPerSession; #onCommit; #onAuthorization;
  constructor({ runtime, gateway, maxConcurrent = 2, minIntervalMs = 1000, maxCallsPerSession = 60 }) {
    for (const [name, value] of Object.entries({ maxConcurrent, minIntervalMs, maxCallsPerSession })) if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name}必须为正整数。`);
    this.#runtime = runtime; this.#gateway = gateway; this.#maxConcurrent = maxConcurrent;
    this.#minIntervalMs = minIntervalMs; this.#maxCallsPerSession = maxCallsPerSession;
    this.#onCommit = ({ sessionId, events }) => {
      for (const actor of this.#actors.values()) if (actor.handle.sessionId === sessionId) {
        if (events.some(event => event.kind === 'session.finished' || event.kind === 'session.aborted' || (event.kind === 'control.changed' && event.payload.actorId === actor.handle.actorId && actor.decision && BigInt(event.payload.controlEpoch) > BigInt(actor.decision.controlEpoch)))) actor.controller?.abort();
        if (actor.autoWake && !events.every(event => event.kind === 'GoalUpdated' && event.payload.holderId === actor.handle.actorId)) this.wake(actor.handle);
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
    if (!existing) this.#actors.set(key, { handle, autoWake, active: false, dirty: false, nextEligibleAt: 0, phase: 'Idle', calls: 0, decision: null, recoveryWork: null, controller: null, lastReceipt: null, lastFallback: null, error: null, retries: 0 });
    if (wake) this.wake(handle);
  }
  #actor(handle) { return this.#actors.get(`${handle.sessionId}/${handle.actorId}/${handle.principalKind}`); }
  wake(handle) {
    const actor = this.#actor(handle);
    if (this.#closed || !actor || actor.handle !== handle) return;
    actor.dirty = true; this.#pump();
  }
  status(handle) {
    const actor = this.#actor(handle);
    if (!actor || actor.handle !== handle) return null;
    return structuredClone({ phase: actor.phase, calls: actor.calls, pendingWake: actor.dirty, decisionId: actor.recoveryWork?.decision.decisionId ?? actor.decision?.decisionId ?? null, lastReceipt: actor.lastReceipt, lastFallback: actor.lastFallback, error: actor.error });
  }
  async #recoverActor(actor) {
    const work = await this.#runtime.recoverDecisions(actor.handle);
    // Receipt 可能已经提交而响应丢失；在途引用保留原键，不能因待办枚举消失便宣称收到结果。
    if (actor.recoveryWork && !work.some(entry => entry.decision.decisionId === actor.recoveryWork.decision.decisionId)) work.unshift(actor.recoveryWork);
    for (const entry of work) {
      actor.recoveryWork = entry;
      const { decision: record, run } = entry;
      if (run?.semantic_digest && run.output_raw !== null) {
        // 即使 Decision 已终态，原提交也先查结果；查询未知绝不被解释成失败。
        let receipt = await this.#runtime.internalReceipt(actor.handle, `${record.decisionId}:submit`);
        if (!receipt) {
          if (this.#closed) return { blocked: true };
          receipt = await this.#runtime.submitIntent(actor.handle, record.decisionId, run.output_raw);
        }
        if (!receipt.status || receipt.semanticDigest !== run.semantic_digest) throw new RuntimeError('ACTION_ID_REUSE', '恢复的原文与已保存收据不匹配。');
        actor.lastReceipt = receipt;
      } else if (record.status === 'Pending') {
        const reason = run?.model_result?.status;
        await this.#runtime.settleDecision(actor.handle, record.decisionId, ['Invalid', 'Timeout', 'ProviderError', 'Blocked'].includes(reason) ? 'Rejected' : 'Cancelled');
      }
      await this.#finishDecision(actor, record.decisionId);
      actor.recoveryWork = null;
    }
    return { blocked: false };
  }
  async #finishDecision(actor, decisionId) {
    const current = await this.#runtime.decisionState(actor.handle, decisionId);
    let fallback = null;
    if (['Rejected', 'Expired'].includes(current.status)) {
      fallback = await this.#runtime.submitFallback(actor.handle, decisionId);
      actor.lastFallback = fallback;
    }
    await saveOutcome(this.#runtime, actor.handle, decisionId, { decisionStatus: current.status, receipt: actor.lastReceipt?.clientActionId === `${decisionId}:submit` ? actor.lastReceipt : null, fallback });
  }
  recover(handle) {
    const actor = this.#actor(handle);
    if (this.#closed || !actor || actor.handle !== handle || actor.active) return Promise.reject(new Error('恢复需要已注册且空闲的角色。'));
    actor.active = true; actor.phase = 'Recovering';
    const task = (async () => {
      try { const result = await this.#recoverActor(actor); actor.error = null; actor.phase = 'Idle'; return result; }
      catch (error) { actor.error = error.code ?? 'INTERNAL_ERROR'; actor.phase = error.code === 'OUTCOME_UNKNOWN' ? 'Unknown' : 'Unavailable'; throw error; }
    })();
    this.#tasks.add(task);
    task.finally(() => { actor.active = false; this.#tasks.delete(task); this.#pump(); }).catch(() => {});
    return task;
  }
  #pump() {
    clearTimeout(this.#timer); this.#timer = null;
    if (this.#closed) return;
    let next = Infinity;
    for (const actor of this.#actors.values()) {
      if (!actor.dirty || actor.active) continue;
      if (this.#tasks.size >= this.#maxConcurrent) break;
      const wait = actor.nextEligibleAt - performance.now();
      if (wait > 0) { next = Math.min(next, wait); continue; }
      actor.active = true; actor.dirty = false; actor.nextEligibleAt = performance.now() + this.#minIntervalMs;
      const task = this.#run(actor);
      this.#tasks.add(task);
      task.finally(() => { actor.active = false; this.#tasks.delete(task); this.#pump(); }).catch(() => {});
    }
    if (next !== Infinity && this.#tasks.size < this.#maxConcurrent) this.#timer = setTimeout(() => this.#pump(), next);
  }
  async #run(actor) {
    actor.controller = new AbortController(); actor.error = null;
    try {
      actor.phase = 'Preparing';
      if ((await this.#recoverActor(actor)).blocked || this.#closed) return;
      if (await callCount(this.#runtime, actor.handle) >= this.#maxCallsPerSession) { actor.phase = 'BudgetExhausted'; actor.dirty = false; return; }
      const prepared = await this.#runtime.prepareDecisionContext(actor.handle);
      actor.decision = prepared.decision;
      if (actor.controller.signal.aborted || this.#closed) {
        await this.#runtime.settleDecision(actor.handle, actor.decision.decisionId, 'Cancelled'); return;
      }
      const reservation = await reserveCall(this.#runtime, actor.handle, prepared, this.#gateway.configuration(), this.#maxCallsPerSession);
      if (!reservation.reserved) { await this.#runtime.settleDecision(actor.handle, actor.decision.decisionId, 'Cancelled'); return; }
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
    for (const actor of this.#actors.values()) { actor.dirty = false; actor.controller?.abort(); }
    this.#closing = (async () => { await this.#gateway.close(); await Promise.allSettled([...this.#tasks]); this.#actors.clear(); })();
    return this.#closing;
  }
}
