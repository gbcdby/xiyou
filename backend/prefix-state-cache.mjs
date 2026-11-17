// 字节数是序列化代理，不是实际堆占用。全进程预算只负责淘汰，绝不跨 owner 查状态。
export const PREFIX_CACHE_LIMITS = Object.freeze({ bytes: 16 * 1024 * 1024, entries: 64, sessionEntries: 16, itemBytes: 4 * 1024 * 1024 });
const decimal = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);

export class PrefixStateBudget {
  #entries = new Map();
  #bytes = 0;
  constructor(limits = PREFIX_CACHE_LIMITS) {
    this.limits = Object.freeze({ ...limits });
    for (const key of Object.keys(PREFIX_CACHE_LIMITS)) {
      if (!Number.isSafeInteger(this.limits[key]) || this.limits[key] < 1) throw new Error('历史前缀缓存预算无效。');
    }
  }
  get usage() { return { entries: this.#entries.size, bytes: this.#bytes }; }
  touch(entry) {
    if (!this.#entries.has(entry)) return;
    this.#entries.delete(entry); this.#entries.set(entry, true);
  }
  remove(entry) {
    if (!this.#entries.delete(entry)) return;
    this.#bytes -= entry.bytes; entry.evict();
  }
  add(entry) {
    this.#entries.set(entry, true); this.#bytes += entry.bytes;
    while (this.#entries.size > this.limits.entries || this.#bytes > this.limits.bytes) this.remove(this.#entries.keys().next().value);
  }
}

const processBudget = new PrefixStateBudget();

/**
 * 每个 runtime 独占状态；同 pool 的新 runtime 也不能继承旧命名空间。
 * 同一存活实例只支持固定数据库/初态/内容与追加历史；外部恢复须关闭旧实例后重建。
 * 只保存原 reducer 已算出的提交前缀，不保存可变 tx.state 或权限/Receipt/发送水位。
 */
export class PrefixStateCache {
  #pool;
  #budget;
  #active = true;
  #generation = 0;
  #contexts = new WeakMap();
  #entries = new Map();
  constructor(pool, budget = processBudget) { this.#pool = pool; this.#budget = budget; }
  #usable(pool) {
    if (pool !== this.#pool) this.close();
    return this.#active;
  }
  capture(tx, pool) {
    if (!this.#usable(pool)) return;
    const row = tx.row, head = row.state?.sessionSeq;
    // 只核缓存资格，不给原业务增加新的失败分支。
    if (!decimal(head) || String(row.session_seq) !== head || row.state.sessionId !== row.session_id
      || typeof row.content_digest !== 'string' || typeof row.reducer_version !== 'string') {
      this.clearSession(row.session_id); return;
    }
    const context = { generation: this.#generation, head, sessionId: row.session_id,
      namespace: JSON.stringify([row.session_id, row.content_digest, row.reducer_version]),
      contentDigest: row.content_digest, reducerVersion: row.reducer_version, content: tx.content, initial: row.initial_state };
    this.#contexts.set(tx, context);
    // 锁定行已经提交；先保留其不可变副本，下一次 timed-trail 同步才无需从零重放快照之前的历史。
    // 不使用本事务可变 tx.state，也不等待本事务提交；其回滚不能撤销先前已提交的行头。
    this.complete({ context, throughSeq: head }, tx, row.state, pool);
  }
  #valid(context, tx, pool) {
    return this.#usable(pool) && context && context.generation === this.#generation
      && context.sessionId === tx.row.session_id && context.contentDigest === tx.row.content_digest
      && context.reducerVersion === tx.row.reducer_version && context.content === tx.content && context.initial === tx.row.initial_state;
  }
  begin(tx, throughSeq, pool) {
    const context = this.#contexts.get(tx);
    if (!this.#valid(context, tx, pool) || !decimal(throughSeq) || BigInt(throughSeq) > BigInt(context.head)) return null;
    const read = { context, throughSeq, sequence: null, state: null };
    let nearest = null;
    for (const entry of this.#entries.values()) {
      if (entry.namespace === context.namespace && BigInt(entry.sequence) <= BigInt(throughSeq)
        && (!nearest || BigInt(entry.sequence) > BigInt(nearest.sequence))) nearest = entry;
    }
    if (nearest) {
      try { read.state = structuredClone(nearest.state); read.sequence = nearest.sequence; }
      catch { this.#budget.remove(nearest); return read; }
      this.#entries.delete(nearest.key); this.#entries.set(nearest.key, nearest); this.#budget.touch(nearest);
    }
    return read;
  }
  complete(read, tx, state, pool) {
    if (!read || !this.#valid(read.context, tx, pool) || state.sessionSeq !== read.throughSeq
      || state.sessionId !== read.context.sessionId) return;
    const { context, throughSeq } = read;
    const key = JSON.stringify([context.namespace, throughSeq]);
    if (this.#entries.has(key)) return;
    let copy, bytes;
    try { copy = structuredClone(state); bytes = Buffer.byteLength(JSON.stringify(copy), 'utf8'); }
    catch { return; } // 缓存失败只回到原算法，不能改业务结果或吞掉 reducer/SQL 的错误。
    const limits = this.#budget.limits;
    if (bytes > limits.itemBytes || bytes > limits.bytes) return;
    const entry = { key, namespace: context.namespace, sessionId: context.sessionId, sequence: throughSeq, state: copy, bytes,
      evict: () => { if (this.#entries.get(key) === entry) this.#entries.delete(key); } };
    while ([...this.#entries.values()].filter(value => value.sessionId === context.sessionId).length >= limits.sessionEntries) {
      this.#budget.remove([...this.#entries.values()].find(value => value.sessionId === context.sessionId));
    }
    this.#entries.set(key, entry); this.#budget.add(entry);
  }
  clearSession(sessionId) {
    // 失效代次使删除前仍在途的计算不能重新填回；其他会话的已提交项可以继续保留。
    this.#generation += 1;
    for (const entry of this.#entries.values()) if (entry.sessionId === sessionId) this.#budget.remove(entry);
  }
  close() {
    this.#active = false; this.#generation += 1;
    for (const entry of this.#entries.values()) this.#budget.remove(entry);
  }
}
