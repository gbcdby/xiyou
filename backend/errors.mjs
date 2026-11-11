/** 传输错误不伪装成已经持久化的领域收据。 */
export class RuntimeError extends Error {
  constructor(code, message = '请求未完成。') { super(message); this.code = code; }
}
export function errorResponse(error) {
  const codes = new Set(['INVALID_MESSAGE', 'UNAUTHENTICATED', 'FORBIDDEN', 'SESSION_GONE', 'RESYNC_REQUIRED', 'OUTCOME_UNKNOWN', 'CONTROL_HELD', 'ACTION_ID_REUSE']);
  return { schemaVersion: 1, code: codes.has(error?.code) ? error.code : 'OUTCOME_UNKNOWN', message: codes.has(error?.code) ? error.message : '结果尚未确认，请保留原动作身份查询或重试。' };
}
