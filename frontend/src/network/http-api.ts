import { SPATIAL_CAPABILITIES } from './spatial-capabilities.ts';
import { validateContract } from '../../../protocol/index.mjs';
import { validateSpatial } from '../../../protocol/spatial.mjs';
import type { ReceiptV2, RecapV2 } from '../../../game/spatial-types.ts';
import { spatialErrorMessage } from '../domain/spatial-errors.ts';
import type { AuthorizedSnapshot, AuthorizedRecap, ClientReceipt, GuestIdentity, RoomMembership, RoomSummary } from '../domain/world.ts';

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status = 0, code = 'NETWORK_UNAVAILABLE') {
    super(message); this.status = status; this.code = code;
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiFailure('服务器返回的内容无法读取。', 0, 'INVALID_RESPONSE');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new ApiFailure('服务器返回的内容缺少必要字段。', 0, 'INVALID_RESPONSE');
  return value;
}

/** HTTP 只承载登录主体。连接控制只能通过真实 Socket.IO 连接处理。 */
export class HttpApi {
  #token: () => string | null;
  #fetch: typeof fetch;
  #onUnauthenticated: (token: string) => void;
  constructor(token: () => string | null, fetcher: typeof fetch = fetch, onUnauthenticated: (token: string) => void = () => {}) {
    this.#token = token; this.#fetch = fetcher; this.#onUnauthenticated = onUnauthenticated;
  }

  async #request(path: string, body?: unknown, signal?: AbortSignal, spatial = false): Promise<unknown> {
    let response: Response;
    const token = this.#token();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (spatial) headers['X-Xiyou-Capabilities'] = SPATIAL_CAPABILITIES.join(',');
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      // 浏览器原生 fetch 不接受 HttpApi 作为 this；提取后按普通函数调用。
      const fetcher = this.#fetch;
      const timeout = AbortSignal.timeout(10000);
      response = await fetcher(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: signal ? AbortSignal.any([timeout, signal]) : timeout });
    } catch {
      if (signal?.aborted) throw new ApiFailure('读取已取消。', 0, 'ABORTED');
      throw new ApiFailure('尚未连接到服务，请确认服务已启动后重试。');
    }
    let data: unknown;
    try { data = await response.json(); }
    catch { throw new ApiFailure(response.ok ? '服务器返回的内容无法读取。' : '服务暂时不可用，请稍后重试。', response.status, response.ok ? 'INVALID_RESPONSE' : 'NETWORK_UNAVAILABLE'); }
    if (!response.ok) {
      let code = 'REQUEST_FAILED'; let message = `请求未完成（${response.status}）。`;
      try { const error = spatial ? validateSpatial('ErrorV2', data) : validateContract('ErrorResponse', data); code = error.code; message = error.message || message; }
      catch { try { const error = validateContract('ErrorResponse', data); code = error.code; message = error.message || message; } catch { /* 非契约错误不作成功结果。 */ } }
      if (code === 'UNAUTHENTICATED' && token) this.#onUnauthenticated(token);
      if (spatial) message = spatialErrorMessage(code);
      throw new ApiFailure(message, response.status, code);
    }
    return data;
  }

  async guest(name: string): Promise<GuestIdentity> {
    const data = record(await this.#request('/auth/guest', { name }));
    return { token: text(data.token), userId: text(data.userId), name: text(data.name) };
  }
  async rooms(): Promise<RoomSummary[]> {
    const value = await this.#request('/sessions');
    if (!Array.isArray(value)) throw new ApiFailure('房间列表无法读取。', 0, 'INVALID_RESPONSE');
    return value.map(value => {
      const room = record(value);
      if (!['Lobby', 'Running', 'Finished', 'Aborted'].includes(String(room.phase)) || !Number.isInteger(room.playerCount) || Number(room.playerCount) < 0 || Number(room.playerCount) > 5) throw new ApiFailure('房间列表字段无效。', 0, 'INVALID_RESPONSE');
      return { sessionId: text(room.sessionId), name: text(room.name), playerCount: Number(room.playerCount), phase: room.phase as RoomSummary['phase'], ...(room.protocolCapability === 'spatial-v2' ? { protocolCapability: 'spatial-v2' as const } : {}), ...(typeof room.contentVersion === 'string' ? { contentVersion: room.contentVersion } : {}) };
    });
  }
  async create(nonce: string, contentVersion: string): Promise<{ sessionId: string }> {
    const data = record(await this.#request('/sessions', { nonce, contentVersion }));
    return { sessionId: text(data.sessionId) };
  }
  async createSpatial(nonce: string, contentVersion = 'spatial-graybox-v2'): Promise<{ sessionId: string }> {
    const data = record(await this.#request('/sessions', { nonce, contentVersion, capabilities: SPATIAL_CAPABILITIES }, undefined, true));
    return { sessionId: text(data.sessionId) };
  }
  async joinCompatible(sessionId: string, nonce: string): Promise<{ sessionId: string; protocolCapability: 'region-v1' | 'spatial-v2' }> {
    const data = record(await this.#request(`/sessions/${encodeURIComponent(sessionId)}/join`, { nonce, capabilities: SPATIAL_CAPABILITIES }, undefined, true));
    // 旧房间仍返回其 v1 成员 DTO；v2 从不返回真实 actorId。
    const protocolCapability = data.protocolCapability === 'spatial-v2' || !Object.hasOwn(data, 'actorId') ? 'spatial-v2' : 'region-v1';
    if (protocolCapability === 'region-v1') text(data.actorId);
    return { sessionId: text(data.sessionId), protocolCapability };
  }
  async spatialReceipt(sessionId: string, actionId: string): Promise<ReceiptV2 | null> {
    try { return validateSpatial('ReceiptV2', await this.#request(`/sessions/${encodeURIComponent(sessionId)}/actions/${encodeURIComponent(actionId)}`, undefined, undefined, true)); }
    catch (error) { if (error instanceof ApiFailure && error.status === 404 && ['OUTCOME_UNKNOWN', 'REQUEST_FAILED'].includes(error.code)) return null; throw error; }
  }
  async spatialRecap(sessionId: string, throughSeq: string, beforeSeq?: string, signal?: AbortSignal): Promise<RecapV2> {
    const query = new URLSearchParams({ throughSeq });
    if (beforeSeq !== undefined) query.set('beforeSeq', beforeSeq);
    return validateSpatial('RecapV2', await this.#request(`/sessions/${encodeURIComponent(sessionId)}/recap?${query}`, undefined, signal, true));
  }
  async join(sessionId: string, nonce: string): Promise<RoomMembership> {
    const data = record(await this.#request(`/sessions/${encodeURIComponent(sessionId)}/join`, { nonce }));
    return { sessionId: text(data.sessionId), actorId: text(data.actorId) };
  }
  async start(sessionId: string, nonce: string): Promise<void> {
    await this.#request(`/sessions/${encodeURIComponent(sessionId)}/start`, { nonce });
  }
  async snapshot(sessionId: string): Promise<AuthorizedSnapshot> {
    return validateContract('AuthorizedSnapshot', await this.#request(`/sessions/${encodeURIComponent(sessionId)}`));
  }
  async recap(sessionId: string, throughSeq: string, beforeSeq?: string, signal?: AbortSignal): Promise<AuthorizedRecap> {
    const query = new URLSearchParams({ throughSeq });
    if (beforeSeq !== undefined) query.set('beforeSeq', beforeSeq);
    return validateContract('AuthorizedRecap', await this.#request(`/sessions/${encodeURIComponent(sessionId)}/recap?${query}`, undefined, signal));
  }
  async receipt(sessionId: string, actionId: string): Promise<ClientReceipt | null> {
    try { return validateContract('ClientReceipt', await this.#request(`/sessions/${encodeURIComponent(sessionId)}/actions/${encodeURIComponent(actionId)}`)); }
    catch (error) {
      // 确定的契约错误优先于 HTTP 状态；不能把失效的授权降格成尚无收据。
      if (error instanceof ApiFailure && error.status === 404 && ['OUTCOME_UNKNOWN', 'REQUEST_FAILED', 'NETWORK_UNAVAILABLE'].includes(error.code)) return null;
      throw error;
    }
  }
}
