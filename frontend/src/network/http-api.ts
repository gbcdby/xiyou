import { validateContract } from '../../../protocol/index.mjs';
import type { AuthorizedSnapshot, ClientReceipt, GuestIdentity, RoomMembership, RoomSummary } from '../domain/world.ts';

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
  constructor(token: () => string | null, fetcher: typeof fetch = fetch) { this.#token = token; this.#fetch = fetcher; }

  async #request(path: string, body?: unknown): Promise<unknown> {
    let response: Response;
    const token = this.#token();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      response = await this.#fetch(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
    } catch { throw new ApiFailure('尚未连接到服务，请确认服务已启动后重试。'); }
    let data: unknown;
    try { data = await response.json(); }
    catch { throw new ApiFailure(response.ok ? '服务器返回的内容无法读取。' : '服务暂时不可用，请稍后重试。', response.status, response.ok ? 'INVALID_RESPONSE' : 'NETWORK_UNAVAILABLE'); }
    if (!response.ok) {
      let code = 'REQUEST_FAILED'; let message = `请求未完成（${response.status}）。`;
      try { const error = validateContract('ErrorResponse', data); code = error.code; message = error.message || message; } catch { /* 非契约错误不作成功结果。 */ }
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
      return { sessionId: text(room.sessionId), name: text(room.name), playerCount: Number(room.playerCount), phase: room.phase as RoomSummary['phase'] };
    });
  }
  async create(nonce: string, contentVersion: string): Promise<{ sessionId: string }> {
    const data = record(await this.#request('/sessions', { nonce, contentVersion }));
    return { sessionId: text(data.sessionId) };
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
  async receipt(sessionId: string, actionId: string): Promise<ClientReceipt | null> {
    try { return validateContract('ClientReceipt', await this.#request(`/sessions/${encodeURIComponent(sessionId)}/actions/${encodeURIComponent(actionId)}`)); }
    catch (error) { if (error instanceof ApiFailure && error.status === 404) return null; throw error; }
  }
}
