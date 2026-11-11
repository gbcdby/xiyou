import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { canonicalize, contractSchema, parseProposedIntent, intentSemanticDigestSync } from '../../protocol/node.mjs';

export const gatewayVersion = 'intent-gateway-v1';
export const instructions = '你只扮演指定角色。current 是当前合法可见状态；memory 是带来源的历史知识。Claim 是说法，Belief 是信念，均不能升级为世界事实。只输出符合 ProposedIntent 的单个 JSON，使用给定 decisionId 和 allowedTools；不输出 WorldEvent，不更新目标，不执行外部工具。代理仅可安全移动、观察、公开询问或等待。';
const hash = value => createHash('sha256').update(value).digest('hex');
const positive = (value, name) => { if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name}必须是正整数。`); return value; };

/** 供应商适配器只收到过滤后的值，不持有 Runtime、数据库或世界事件入口。 */
export class ModelGateway {
  #provider; #modelId; #timeoutMs; #maxContextBytes; #closed = false; #active = new Map(); #durations = [];
  #counts = { calls: 0, externalCalls: 0, valid: 0, invalid: 0, timeouts: 0, cancelled: 0, providerErrors: 0 };
  constructor({ provider, modelId, timeoutMs = 10000, maxContextBytes = 262144, externalAuthorization = null }) {
    if (!provider || typeof provider.generate !== 'function' || !['controlled', 'external'].includes(provider.kind) || typeof provider.providerId !== 'string' || !provider.providerId) throw new Error('必须注入标明来源种类的模型适配器。');
    if (typeof modelId !== 'string' || !modelId) throw new Error('必须明确模型标识。');
    if (provider.kind === 'external' && (!externalAuthorization?.reference || !Number.isSafeInteger(externalAuthorization.maxCalls) || externalAuthorization.maxCalls <= 0)) throw new Error('外部模型缺少已授权预算与引用，当前不可调用。');
    this.#provider = provider; this.#modelId = modelId;
    this.#timeoutMs = positive(timeoutMs, '超时'); this.#maxContextBytes = positive(maxContextBytes, '上下文大小');
    this.externalAuthorization = externalAuthorization ? structuredClone(externalAuthorization) : null;
  }
  configuration() { return { gatewayVersion, providerId: this.#provider.providerId, providerKind: this.#provider.kind, modelId: this.#modelId, timeoutMs: this.#timeoutMs, maxContextBytes: this.#maxContextBytes }; }
  metrics() {
    const values = [...this.#durations].sort((a, b) => a - b);
    const percentile = p => values.length ? values[Math.max(0, Math.ceil(values.length * p) - 1)] : null;
    return { ...this.#counts, active: this.#active.size, p50Ms: percentile(0.5), p95Ms: percentile(0.95), invalidRate: this.#counts.calls ? this.#counts.invalid / this.#counts.calls : 0 };
  }
  async generate(context, { signal, remainingMs = this.#timeoutMs } = {}) {
    if (this.#closed || signal?.aborted) return { status: 'Cancelled' };
    if (this.#provider.kind === 'external' && this.#counts.externalCalls >= this.externalAuthorization.maxCalls) return { status: 'Blocked', reason: 'CALL_BUDGET' };
    const text = canonicalize(context);
    if (Buffer.byteLength(text) > this.#maxContextBytes) return { status: 'Blocked', reason: 'CONTEXT_BUDGET' };
    const timeoutMs = Math.max(1, Math.min(this.#timeoutMs, remainingMs));
    const controller = new AbortController(); const started = performance.now();
    let finish; let timer;
    const gate = new Promise(resolve => { finish = resolve; });
    const cancel = () => { controller.abort(); finish({ status: 'Cancelled' }); };
    signal?.addEventListener('abort', cancel, { once: true });
    const key = Symbol();
    this.#active.set(key, { cancel, done: gate });
    this.#counts.calls++;
    if (this.#provider.kind === 'external') this.#counts.externalCalls++;
    timer = setTimeout(() => { controller.abort(); finish({ status: 'Timeout' }); }, timeoutMs);
    const input = {
      modelId: this.#modelId, instructions, context: structuredClone(context),
      responseSchema: { $ref: '#/$defs/ProposedIntent', $defs: structuredClone(contractSchema.$defs) },
      limits: { timeoutMs, maxOutputBytes: 65536 },
    };
    // 为供应商同步抛错和迟到拒绝安装处理器；它们不能再次完成 gate。
    Promise.resolve().then(() => this.#provider.generate(input, { signal: controller.signal })).then(
      output => finish({ status: 'Returned', output }),
      () => finish({ status: 'ProviderError' }),
    );
    let result;
    try {
      result = await gate;
      if (result.status === 'Returned') {
        const rawText = result.output?.rawText;
        try {
          const intent = parseProposedIntent(rawText, context.decision.decisionId);
          result = { status: 'Valid', rawText, semanticDigest: intentSemanticDigestSync(intent) };
        } catch {
          result = { status: 'Invalid', reason: 'INVALID_INTENT', ...(typeof rawText === 'string' && Buffer.byteLength(rawText) <= 65536 ? { rawText } : {}) };
        }
      }
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); this.#active.delete(key); }
    const durationMs = Math.round((performance.now() - started) * 1000) / 1000;
    this.#durations.push(durationMs);
    if (this.#durations.length > 4096) this.#durations.shift();
    const counter = { Valid: 'valid', Invalid: 'invalid', Timeout: 'timeouts', Cancelled: 'cancelled', ProviderError: 'providerErrors' }[result.status];
    if (counter) this.#counts[counter]++;
    return { ...result, contextDigest: hash(text), ...(result.rawText !== undefined ? { outputDigest: hash(result.rawText) } : {}), durationMs, configuration: this.configuration() };
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    const active = [...this.#active.values()];
    for (const task of active) task.cancel();
    await Promise.all(active.map(task => task.done));
  }
}
