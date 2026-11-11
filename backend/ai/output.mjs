import { createHash } from 'node:crypto';
import { RuntimeError } from '../errors.mjs';

export const outputEncoding = 'json-string-v1';
export const outputStringDigest = raw => createHash('sha256').update(JSON.stringify(raw)).digest('hex');

/** AI 的持久输入边界：公共 JSON 契约仍允许 NUL，但世界 jsonb 不能存储它。 */
export function isPersistableIntent(value) {
  if (typeof value === 'string') return value.isWellFormed() && !value.includes(String.fromCharCode(0));
  if (Array.isArray(value)) return value.every(isPersistableIntent);
  if (value && typeof value === 'object') return Object.entries(value).every(([key, child]) => isPersistableIntent(key) && isPersistableIntent(child));
  return true;
}

/** JSON 字符串编码保留所有 JS 码元，包含 NUL 和非法的孤立 surrogate。 */
export function encodeOutput(raw) {
  return typeof raw === 'string' ? { raw: JSON.stringify(raw), encoding: outputEncoding } : { raw: null, encoding: null };
}

/** 兼容既有未编码 text 记录；不修补、裁剪或替换持久原文。 */
export function decodeStoredOutput(run) {
  if (run.output_raw === null) return null;
  let raw;
  if (run.output_encoding == null) raw = run.output_raw;
  else if (run.output_encoding === outputEncoding) {
    try { raw = JSON.parse(run.output_raw); }
    catch { throw new RuntimeError('INVALID_MESSAGE', '持久模型原文的编码损坏。'); }
  } else throw new RuntimeError('INVALID_MESSAGE', '持久模型原文的编码版本未知。');
  if (typeof raw !== 'string') throw new RuntimeError('INVALID_MESSAGE', '持久模型原文必须是字符串。');
  if (run.model_result?.outputStringDigest && run.model_result.outputStringDigest !== outputStringDigest(raw)) throw new RuntimeError('INVALID_MESSAGE', '持久模型原文的码元摘要不匹配。');
  return raw;
}
