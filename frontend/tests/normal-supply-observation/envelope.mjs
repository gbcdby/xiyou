/** 冷端严格检查完整封套；不参与产品热调用。 */
import { SCHEMA } from './schema.mjs';
import { ENVELOPE } from './envelope-schema.mjs';

export function validateShape(value, rule) {
  if (Object.hasOwn(rule, 'const')) { if (value !== rule.const) throw Error('NSO封套常量不符'); return; }
  if (value === null && rule.type.endsWith('-or-null')) return;
  if (rule.type.startsWith('string')) {
    if (typeof value !== 'string' || value.length > rule.maxCodeUnits) throw Error('NSO封套字符串越界'); return;
  }
  if (rule.type.startsWith('number')) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < rule.minimum || value > rule.maximum) throw Error('NSO封套数值越界'); return;
  }
  if (rule.type === 'boolean') { if (typeof value !== 'boolean') throw Error('NSO封套布尔值无效'); return; }
  if (rule.type === 'array') {
    if (!Array.isArray(value) || value.length > rule.maxItems) throw Error('NSO封套数组越界');
    for (const item of value) validateShape(item, rule.items); return;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('\0') !== Object.keys(rule.fields).sort().join('\0')) throw Error('NSO封套字段不闭合');
  for (const [name, field] of Object.entries(rule.fields)) validateShape(value[name], field);
}

export function validateRaw(raw, config) {
  validateShape({ ...raw, rows: [] }, ENVELOPE.rawHeader);
  if (!Object.hasOwn(SCHEMA.kinds, raw.realm) || JSON.stringify(raw.kinds) !== JSON.stringify(SCHEMA.kinds[raw.realm])) throw Error('NSO原件realm无效');
  for (const key of ['productHead', 'productTree', 'methodSHA256', 'inputSHA256', 'schemaSHA256'])
    if (raw[key] !== config[key]) throw Error('NSO原件身份不符');
  if (!Array.isArray(raw.rows) || raw.rows.length > raw.limits.maxRows
    || raw.rows.length !== raw.terminal.recorded || raw.terminal.seen !== raw.terminal.recorded + raw.terminal.dropped)
    throw Error('NSO原件行数不闭合');
  for (const [index, row] of raw.rows.entries()) {
    const kind = raw.kinds[row[1]];
    if (!Array.isArray(row) || row[0] !== index + 1 || !kind
      || row.length !== SCHEMA.common.length + SCHEMA.tails[kind].length) throw Error('NSO原件行结构不符');
    for (const value of row) if (value !== null && (typeof value === 'string'
      ? value.length > raw.limits.maxStringCodeUnits
      : typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER))
      throw Error('NSO原件标量越界');
  }
  for (let kind = 0; kind < raw.kinds.length; kind++) {
    if (raw.terminal.seenByKind[kind] !== raw.terminal.recordedByKind[kind] + raw.terminal.droppedByKind[kind]
      || raw.rows.filter(row => row[1] === kind).length !== raw.terminal.recordedByKind[kind]) throw Error('NSO分类账不闭合');
  }
  const text = JSON.stringify(raw) + '\n', bytes = new TextEncoder().encode(text).length;
  if (bytes !== raw.terminal.serializedBytes || bytes > raw.terminal.reservedBytes || raw.terminal.reservedBytes > SCHEMA.limits.rawMaxBytes)
    throw Error('NSO原件字节账不闭合');
  return { text, bytes };
}
export function validateCold(cold) {
  validateShape(cold, ENVELOPE.cold);
  const text = JSON.stringify(cold) + '\n', bytes = new TextEncoder().encode(text).length;
  if (bytes > SCHEMA.limits.coldMaxBytes) throw Error('NSO冷封套越界');
  return { text, bytes };
}
