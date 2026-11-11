export class ContractError extends Error {
  constructor(message = '消息不符合协议', path = '$') {
    super(`${message}（${path}）`);
    this.name = 'ContractError';
    this.code = 'INVALID_MESSAGE';
    this.path = path;
  }
}

const fail = (message, path) => { throw new ContractError(message, path); };

function validUnicode(value) {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

function parseExactInteger(token) {
  const [, sign, whole, fraction = '', exponent = '0'] = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(token);
  let digits = (whole + fraction).replace(/^0+/, '');
  if (digits === '') return 0;
  const power = Number(exponent);
  if (!Number.isSafeInteger(power)) fail('数字必须是可精确表示的整数');
  const scale = fraction.length - power;
  if (scale > 0) {
    if (scale >= digits.length || !digits.endsWith('0'.repeat(scale))) fail('数字必须是可精确表示的整数');
    digits = digits.slice(0, -scale);
  } else if (scale < 0) {
    if (digits.length - scale > 16) fail('数字必须是可精确表示的整数');
    digits += '0'.repeat(-scale);
  }
  if (digits.length > 16) fail('数字必须是可精确表示的整数');
  const value = Number(sign + digits);
  if (!Number.isSafeInteger(value)) fail('数字必须是可精确表示的整数');
  return value;
}

/** 必须在 JSON.parse、框架 body parser 或模型 JSON 解析之前调用。 */
export function parseStrictJSON(raw, { maxBytes = 65536, maxDepth = 32 } = {}) {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > maxBytes) fail('消息格式或大小无效');
  let position = 0;
  const whitespace = () => { while (/[\x20\t\r\n]/.test(raw[position] ?? '') && position < raw.length) position++; };
  const readString = () => {
    if (raw[position] !== '"') fail('应为 JSON 字符串');
    const start = position++;
    while (position < raw.length) {
      const char = raw[position++];
      if (char === '\\') { position++; continue; }
      if (char !== '"') continue;
      let value;
      try { value = JSON.parse(raw.slice(start, position)); } catch { fail('字符串编码无效'); }
      if (!validUnicode(value)) fail('字符串含不完整的 Unicode 代理对');
      return value;
    }
    fail('字符串未结束');
  };
  const readValue = depth => {
    if (depth > maxDepth) fail('消息嵌套过深');
    whitespace();
    const char = raw[position];
    if (char === '"') return readString();
    if (char === '{') {
      position++;
      const value = Object.create(null);
      const keys = new Set();
      whitespace();
      if (raw[position] === '}') { position++; return value; }
      while (position < raw.length) {
        whitespace();
        const key = readString();
        if (keys.has(key)) fail('JSON 对象包含重复键');
        keys.add(key);
        whitespace();
        if (raw[position++] !== ':') fail('JSON 对象缺少冒号');
        value[key] = readValue(depth + 1);
        whitespace();
        const ending = raw[position++];
        if (ending === '}') return value;
        if (ending !== ',') fail('JSON 对象分隔符无效');
      }
      fail('JSON 对象未结束');
    }
    if (char === '[') {
      position++;
      const value = [];
      whitespace();
      if (raw[position] === ']') { position++; return value; }
      while (position < raw.length) {
        value.push(readValue(depth + 1));
        whitespace();
        const ending = raw[position++];
        if (ending === ']') return value;
        if (ending !== ',') fail('JSON 数组分隔符无效');
      }
      fail('JSON 数组未结束');
    }
    for (const [token, value] of [['true', true], ['false', false], ['null', null]]) {
      if (raw.startsWith(token, position)) { position += token.length; return value; }
    }
    const token = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(raw.slice(position))?.[0];
    if (!token) fail('JSON 值无效');
    position += token.length;
    // 协议数值只允许安全整数；序号和版本使用十进制字符串。
    // 先检查十进制的精确值，避免 1e-400 / 1.00000000000000001 被浮点舍入成合法值。
    return parseExactInteger(token);
  };
  const result = readValue(0);
  whitespace();
  if (position !== raw.length) fail('JSON 后包含多余内容');
  return result;
}

/** UTF-8 输入、UTF-16 键名排序、无 Unicode 归一化；数组顺序有语义。 */
export function canonicalize(value) {
  const seen = new Set();
  const encode = (item, path, depth) => {
    if (depth > 32) fail('消息嵌套过深', path);
    if (item === null) return 'null';
    if (typeof item === 'boolean') return item ? 'true' : 'false';
    if (typeof item === 'string') {
      if (!validUnicode(item)) fail('字符串含不完整的 Unicode 代理对', path);
      return JSON.stringify(item);
    }
    if (typeof item === 'number' && Number.isSafeInteger(item)) return JSON.stringify(item);
    if (typeof item !== 'object' || seen.has(item)) fail('值不能规范编码', path);
    const prototype = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) fail('值必须是普通 JSON 对象', path);
    seen.add(item);
    let result;
    if (Array.isArray(item)) {
      if (Reflect.ownKeys(item).length !== item.length + 1) fail('数组不能含稀疏项或额外属性', path);
      const values = [];
      for (let i = 0; i < item.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) fail('数组必须只包含连续的自有数据项', path + '[' + i + ']');
        values.push(encode(descriptor.value, path + '[' + i + ']', depth + 1));
      }
      result = '[' + values.join(',') + ']';
    } else {
      if (Object.getOwnPropertySymbols(item).length) fail('JSON 对象不能含 Symbol 键', path);
      result = '{' + Object.keys(item).sort().map(key => {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !('value' in descriptor)) fail('JSON 对象不能含访问器', path);
        return encode(key, path, depth + 1) + ':' + encode(descriptor.value, `${path}.${key}`, depth + 1);
      }).join(',') + '}';
    }
    seen.delete(item);
    return result;
  };
  return encode(value, '$', 0);
}

import { contractSchema, contractNames } from './schema.mjs';

export { contractSchema, contractNames };

function checkSchema(schema, value, path) {
  if (schema.$ref) return checkSchema(contractSchema.$defs[schema.$ref.split('/').at(-1)], value, path);
  if ('const' in schema && value !== schema.const) fail('固定字段值不匹配', path);
  if (schema.enum && !schema.enum.includes(value)) fail('字段值不在允许范围', path);
  if (schema.oneOf) {
    let matches = 0;
    for (const option of schema.oneOf) {
      try { checkSchema(option, value, path); matches++; } catch (error) { if (!(error instanceof ContractError)) throw error; }
    }
    if (matches !== 1) fail('消息必须符合且只符合一个允许的结构', path);
    return;
  }
  if (schema.type === 'null' && value !== null) fail('字段必须为空', path);
  if (schema.type === 'boolean' && typeof value !== 'boolean') fail('字段必须为布尔值', path);
  if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value) || (schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum)) fail('整数字段超出范围', path);
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string' || !validUnicode(value)) fail('字段必须为有效字符串', path);
    const length = [...value].length;
    if ((schema.minLength !== undefined && length < schema.minLength) || (schema.maxLength !== undefined && length > schema.maxLength)) fail('字符串长度超出范围', path);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) fail('字符串格式无效', path);
    if (schema.format === 'date-time') {
      const date = new Date(value);
      if (!Number.isFinite(date.valueOf()) || date.toISOString() !== value) fail('时间必须是有效的 UTC 毫秒时间', path);
    }
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) fail('字段必须为数组', path);
    if ((schema.minItems !== undefined && value.length < schema.minItems) || (schema.maxItems !== undefined && value.length > schema.maxItems)) fail('数组长度超出范围', path);
    if (schema.uniqueItems && new Set(value.map(canonicalize)).size !== value.length) fail('数组元素必须唯一', path);
    value.forEach((item, i) => checkSchema(schema.items, item, path + '[' + i + ']'));
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('字段必须为对象', path);
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) fail('缺少必需字段', path + '.' + key);
    for (const key of Object.keys(value)) {
      if (schema.propertyNames) checkSchema(schema.propertyNames, key, path + '.<key>');
      if (Object.hasOwn(schema.properties ?? {}, key)) checkSchema(schema.properties[key], value[key], path + '.' + key);
      else if (schema.additionalProperties === false) fail('不允许未知字段', path + '.' + key);
      else if (typeof schema.additionalProperties === 'object') checkSchema(schema.additionalProperties, value[key], path + '.' + key);
    }
  }
}

export function compareDecimal(a, b) {
  checkSchema(contractSchema.$defs.DecimalString, a, '$.left');
  checkSchema(contractSchema.$defs.DecimalString, b, '$.right');
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

function checkDialogue(value, path) {
  if (value.channel === 'public' ? value.recipientIds.length !== 0 : value.recipientIds.length === 0) fail('公开频道不列接收者，定向或私人频道必须列接收者', path);
}

function checkAction(value, path) {
  if (value.kind === 'use_item') {
    const keys = Object.keys(value.expectedItemRevisions).sort();
    if (canonicalize(keys) !== canonicalize([...value.itemIds].sort())) fail('每件使用物品必须且只能提供一个前置版本', path);
  }
  if (value.kind === 'speak' || value.kind === 'make_claim') checkDialogue(value, path);
}

function checkProjection(projection, path) {
  const lists = [
    ['characters', 'characterId'], ['regions', 'regionId'], ['items', 'itemId'],
    ['targets', 'targetId'], ['observations', 'observationId'], ['claims', 'claimId'], ['objectives', 'objectiveId'],
  ];
  for (const [list, key] of lists) {
    if (new Set(projection[list].map(item => item[key])).size !== projection[list].length) fail('投影实体标识重复', path + '.' + list);
  }
  if (!projection.characters.some(character => character.characterId === projection.self.characterId)) fail('队伍投影必须包含本人', path + '.characters');
  if (projection.self.canControl && projection.self.mode !== 'HumanControlled') fail('当前投影不能声明真人控制授权', path + '.self');
  if (['Lobby', 'Running'].includes(projection.phase) && projection.ending !== null) fail('未终局投影不能带结局', path + '.ending');
  if (['Finished', 'Aborted'].includes(projection.phase) && projection.ending === null) fail('终局投影必须有结局摘要', path + '.ending');
  if (projection.phase === 'Running' && projection.deadlineAt === null) fail('运行中的局必须有截止时间', path + '.deadlineAt');
  for (const observation of projection.observations) if (observation.observerId !== projection.self.characterId) fail('投影不能携带其他角色的 Observation', path + '.observations');
  for (const claim of projection.claims) {
    checkDialogue(claim, path + '.claims');
    if (claim.channel !== 'public' && claim.speakerId !== projection.self.characterId && !claim.recipientIds.includes(projection.self.characterId)) fail('投影不能携带无接收资格的定向陈述', path + '.claims');
  }
}

function checkEventIdentity(event, sessionId, path) {
  if (event.eventId !== sessionId + ':E' + event.sessionSeq) fail('事件标识与 Session/序号不一致', path + '.eventId');
}

function checkObservationSource(observation, throughSeq, path) {
  if (compareDecimal(observation.source.sourceSeq, throughSeq) > 0) fail('观察不能携带未来来源', path + '.source.sourceSeq');
}

function checkEventPayload(event, path) {
  if (event.kind === 'ClaimRecorded') checkDialogue(event.payload, path + '.payload');
  if (event.kind === 'ObservationRecorded') checkObservationSource(event.payload, event.sessionSeq, path + '.payload');
}

function checkReceipt(value) {
  const range = value.actionEventRange;
  if (range && (compareDecimal(range.first, range.last) > 0 || compareDecimal(range.last, value.observedSeq) > 0)) fail('动作事件区间超出收据观察游标', '$.actionEventRange');
}

function checkRelations(name, value) {
  if (name === 'ClientAction') checkAction(value.action, '$.action');
  if (name === 'ProposedIntent') {
    value.toolCalls.forEach((call, index) => {
      checkAction(call, '$.toolCalls[' + index + ']');
      if (call.channel === 'private') fail('AI 意图不能使用真人私人频道', '$.toolCalls[' + index + ']');
    });
    if (value.dialogue) checkDialogue(value.dialogue, '$.dialogue');
  }
  if (name === 'ActionReceipt' || name === 'ClientReceipt') checkReceipt(value);
  if (name === 'DecisionRecord' && value.deadlineAt < value.createdAt) fail('决策截止时间早于创建时间', '$.deadlineAt');
  if (name === 'TrustedExecutionContext') {
    if (value.principalKind === 'human' && (!value.userId || !value.connectionId || !value.actorId)) fail('真人执行上下文缺少认证绑定', '$');
    if (value.principalKind !== 'human' && (value.userId || value.connectionId)) fail('服务主体不能携带真人连接绑定', '$');
    if (['core_npc', 'proxy'].includes(value.principalKind) && !value.actorId) fail('AI 执行上下文必须绑定角色', '$');
  }
  if (name === 'WorldEvent') {
    checkEventIdentity(value, value.sessionId, '$');
    if (value.causedBy.toolCallIndex !== undefined && !value.causedBy.decisionId) fail('工具下标必须关联决策', '$.causedBy');
    checkEventPayload(value, '$');
    if (value.kind === 'control.changed') {
      const p = value.payload;
      if ((p.mode === 'HumanControlled') !== (p.activeConnectionId !== null)) fail('真人控制模式与当前连接不匹配', '$.payload');
      if ((p.mode === 'GracePeriod') !== (p.graceDeadlineAt !== null)) fail('宽限模式与截止时间不匹配', '$.payload');
    }
  }
  if (name === 'AuthorizedProjection') checkProjection(value, '$');
  if (name === 'AuthorizedSnapshot') {
    checkProjection(value.projection, '$.projection');
    value.projection.observations.forEach((item, index) => checkObservationSource(item, value.snapshotSeq, '$.projection.observations[' + index + ']'));
  }
  if (name === 'WorldBatch') {
    if (compareDecimal(value.fromExclusive, value.throughSeq) > 0 || BigInt(value.throughSeq) - BigInt(value.fromExclusive) > 256n) fail('批次完整区间无效或超过 256 个序号', '$');
    let previous = value.fromExclusive;
    for (let i = 0; i < value.events.length; i++) {
      const event = value.events[i];
      checkEventIdentity(event, value.sessionId, '$.events[' + i + ']');
      checkEventPayload(event, '$.events[' + i + ']');
      if (compareDecimal(event.sessionSeq, previous) <= 0 || compareDecimal(event.sessionSeq, value.throughSeq) > 0) fail('批次事件必须在区间内严格递增', '$.events[' + i + ']');
      previous = event.sessionSeq;
      if (event.kind === 'projection.replace') {
        checkProjection(event.payload.projection, '$.events[' + i + '].payload.projection');
        event.payload.projection.observations.forEach((item, index) => checkObservationSource(item, event.sessionSeq, '$.events[' + i + '].payload.projection.observations[' + index + ']'));
      }
    }
  }
  if (name === 'OutboxRecord' && compareDecimal(value.fromExclusive, value.throughSeq) >= 0) fail('outbox 必须引用非空已提交区间', '$');
  if (name === 'AuthorizedRecap') {
    const categories = { observed: 'Observation', received_evidence: 'Observation', heard_claim: 'Claim', received_claim: 'Claim', said: 'Claim', moved: 'WorldFact', took: 'WorldFact', transferred: 'WorldFact', used: 'WorldFact', updated: 'WorldFact', finished: 'WorldFact', aborted: 'WorldFact' };
    const seen = new Set();
    let previous = null;
    for (const [index, entry] of value.entries.entries()) {
      const path = '$.entries[' + index + ']';
      if (seen.has(entry.entryId)) fail('复盘条目标识重复', path);
      seen.add(entry.entryId);
      if (compareDecimal(entry.eventSeq, value.throughSeq) > 0 || (previous !== null && compareDecimal(entry.eventSeq, previous) >= 0)) fail('复盘条目必须在固定水位内严格递减', path);
      if (categories[entry.kind] !== entry.category) fail('复盘类别与取得方式不一致', path);
      if (['updated', 'finished', 'aborted'].includes(entry.kind) !== (entry.actorId === null)) fail('复盘条目角色归属无效', path);
      previous = entry.eventSeq;
    }
    if (value.nextBeforeSeq !== null && value.nextBeforeSeq !== previous) fail('复盘下一页游标必须是最后可见条目的序号', '$.nextBeforeSeq');
  }
}

/** 只检查结构与内部关系；认证、可见性和提交规则仍由服务端执行。 */
export function validateContract(name, value) {
  if (!contractNames.includes(name)) fail('未知契约名称');
  canonicalize(value);
  checkSchema(contractSchema.$defs[name], value, '$');
  checkRelations(name, value);
  return value;
}

export function parseContract(name, raw) {
  // 累积知识不按任意消息大小截断；传输层可分帧，但不能静默丢失合法历史。
  const maxBytes = ['AuthorizedSnapshot', 'AuthorizedProjection', 'WorldBatch', 'AuthorizedRecap'].includes(name) ? Infinity : 65536;
  return validateContract(name, parseStrictJSON(raw, { maxBytes }));
}

export const parseClientAction = raw => parseContract('ClientAction', raw);

export function parseProposedIntent(raw, expectedDecisionId) {
  const intent = parseContract('ProposedIntent', raw);
  if (intent.decisionId !== expectedDecisionId) fail('模型不能替换服务端的决策身份', '$.decisionId');
  return intent;
}

export function canonicalActionPayload(value) {
  validateContract('ClientAction', value);
  const { schemaVersion, sessionId, actorId, controlEpoch, baseSeq, action } = value;
  return canonicalize({ schemaVersion, sessionId, actorId, controlEpoch, baseSeq, action });
}

export function canonicalIntentPayload(value) {
  validateContract('ProposedIntent', value);
  return canonicalize(value);
}

export async function sha256Canonical(encoded) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(encoded));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export const actionSemanticDigest = value => sha256Canonical(canonicalActionPayload(value));
export const intentSemanticDigest = value => sha256Canonical(canonicalIntentPayload(value));
