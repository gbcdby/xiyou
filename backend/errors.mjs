import { validateContract } from '../protocol/index.mjs';
import { validateSpatial } from '../protocol/spatial.mjs';

/** 传输错误不伪装成已经持久化的领域收据。 */
export class RuntimeError extends Error {
  constructor(code, message = '请求未完成。') { super(message); this.code = code; }
}
export function errorResponse(error) {
  if (['UPGRADE_REQUIRED', 'STALE_REFERENCE'].includes(error?.code)) return validateSpatial('ErrorV2', { schemaVersion: 2, code: error.code, message: error.code === 'UPGRADE_REQUIRED' ? '此章节需要 spatial-v2 客户端。' : '该引用已经失效，请刷新视图。', ...(error.code === 'UPGRADE_REQUIRED' ? { requiredCapabilities: ['spatial-v2'] } : {}) });
  const codes = new Set(['INVALID_MESSAGE', 'UNAUTHENTICATED', 'FORBIDDEN', 'SESSION_GONE', 'RESYNC_REQUIRED', 'OUTCOME_UNKNOWN', 'CONTROL_HELD', 'ACTION_ID_REUSE']);
  const known = codes.has(error?.code);
  const source = known && typeof error.message === 'string' ? error.message : known ? '请求未完成。' : '结果尚未确认，请保留原动作身份查询或重试。';
  // 共享契约按 Unicode 码点计数；截断不能拆开代理对，也不能再次产生非法错误正文。
  const points = Array.from(source.toWellFormed());
  const message = points.length > 500 ? points.slice(0, 499).join('') + '…' : points.join('');
  return validateContract('ErrorResponse', { schemaVersion: 1, code: known ? error.code : 'OUTCOME_UNKNOWN', message });
}
