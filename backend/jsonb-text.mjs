const encoding = 'nul-escaped-v1';

function mapStrings(value, transform) {
  if (typeof value === 'string') return transform(value);
  if (Array.isArray(value)) return value.map(item => mapStrings(item, transform));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [transform(key), mapStrings(item, transform)]));
  return value;
}

/** 仅含 NUL 的 JSON 文档启用编码；反斜杠同时转义，字面量 \\0 与 NUL 不会混淆。 */
export function encodeJsonbText(value) {
  let required = false;
  const encoded = mapStrings(value, text => {
    if (text.includes('\u0000')) required = true;
    return text.replace(/\\/g, '\\\\').replace(/\u0000/g, '\\0');
  });
  return { value: required ? encoded : value, encoding: required ? encoding : null };
}

/** 标记存于独立数据库列，旧行及其原有反斜杠按原文读取。键和值均无损恢复。 */
export function decodeJsonbText(value, storedEncoding) {
  if (storedEncoding === null || storedEncoding === undefined) return value;
  if (storedEncoding !== encoding) throw new Error('未知的 JSONB 文本存储编码。');
  return mapStrings(value, text => text.replace(/\\([\\0])/g, (_, escaped) => escaped === '0' ? '\u0000' : '\\'));
}
