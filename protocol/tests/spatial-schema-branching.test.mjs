import test from 'node:test';
import assert from 'node:assert/strict';
import { ContractError } from '../index.mjs';
import { checkSpatialSchema, parseSpatial, validateSpatial } from '../spatial.mjs';

const spatialError = path => error => {
  assert.equal(error.constructor, ContractError);
  assert.equal(error.name, 'ContractError');
  assert.equal(error.code, 'INVALID_MESSAGE');
  assert.equal(error.path, path);
  assert.equal(error.message, `消息不符合空间协议（${path}）`);
  return true;
};
const envelope = action => ({ schemaVersion: 2, sessionId: 'session', viewId: 'view', actorRef: 'R' + 'a'.repeat(32), clientActionId: 'action', controlEpoch: '1', baseSeq: '0', action });
const movement = () => ({ kind: 'move_direction', sceneId: 'yard', mapVersion: 'map-v1', direction: 'E', movementCommandSeq: '1' });

test('oneOf只允许恰好一个匹配，最终失败保留公共错误元数据和嵌套路径', () => {
  const schema = { oneOf: [{ const: 1 }, { const: 2 }] };
  assert.equal(checkSpatialSchema(schema, 1), undefined);
  assert.throws(() => checkSpatialSchema(schema, 3), spatialError('$'));
  assert.throws(() => checkSpatialSchema({ oneOf: [{ const: 1 }, { type: 'integer' }] }, 1), spatialError('$'));
  const nested = { type: 'object', properties: { choice: schema } };
  assert.throws(() => checkSpatialSchema(nested, { choice: 3 }), spatialError('$.choice'));
  assert.equal(checkSpatialSchema({ oneOf: [schema, { const: 3 }] }, 2), undefined);
  assert.throws(() => checkSpatialSchema({ oneOf: [] }, 1, undefined, ''), spatialError(''));
});

test('已有零、一、两个匹配都必须访问后续分支并原样传播非ContractError', () => {
  for (const matches of [0, 1, 2]) {
    const failure = new RangeError('后续分支读取失败'), visited = [];
    const later = { get type() { visited.push('later'); throw failure; } };
    const choices = [...Array.from({ length: matches }, () => ({ const: 2 })), later];
    assert.throws(() => checkSpatialSchema({ oneOf: choices }, 2), error => error === failure);
    assert.deepEqual(visited, ['later']);
  }
  const failure = Symbol('外部错误');
  assert.throws(() => checkSpatialSchema({ oneOf: [{ const: 2 }, { get type() { throw failure; } }] }, 2), error => error === failure);
  assert.throws(() => checkSpatialSchema({ oneOf: [{ const: 'a' }, { type: 'string', pattern: '[' }] }, 'a'), SyntaxError);
});

test('外部ContractError只在oneOf试探中被吸收，直接检查仍抛原对象', () => {
  const failure = new ContractError('外部合同失败', '$.external');
  const external = { get type() { throw failure; } };
  assert.throws(() => checkSpatialSchema(external, 2), error => error === failure);
  assert.equal(checkSpatialSchema({ oneOf: [external, { const: 2 }] }, 2), undefined);
  assert.throws(() => checkSpatialSchema({ oneOf: [external, { const: 3 }] }, 2), error => {
    assert.notEqual(error, failure);
    return spatialError('$')(error);
  });
});

test('自定义forEach可观察的callback继续使用公共错误，不能泄漏试探标记', () => {
  const value = [null], seen = [];
  value.forEach = callback => {
    try { callback(null, 0); }
    catch (error) { spatialError('$[0]')(error); seen.push(error); }
  };
  const schema = { oneOf: [{ type: 'array', items: { type: 'string' } }] };
  assert.equal(checkSpatialSchema(schema, value), undefined, '调用方吸收callback错误后的返回行为保留');
  assert.equal(seen.length, 1);
  const failure = new TypeError('调用方改报的错误');
  value.forEach = callback => {
    try { callback(null, 0); }
    catch (error) { spatialError('$[0]')(error); throw failure; }
  };
  assert.throws(() => checkSpatialSchema(schema, value), error => error === failure);
  assert.throws(() => checkSpatialSchema({ type: 'array', items: { type: 'string' } }, [null]), spatialError('$[0]'));
});

test('非string path保留构造时的转换次数、副作用和外部异常', () => {
  const trace = [], path = { toString() { trace.push('convert'); return '$.custom'; } };
  assert.equal(checkSpatialSchema({ oneOf: [{ const: 1 }, { const: 3 }, { const: 2 }] }, 2, undefined, path), undefined);
  assert.deepEqual(trace, ['convert', 'convert']);
  const failure = new RangeError('路径转换失败'), failingPath = { toString() { throw failure; } };
  assert.throws(() => checkSpatialSchema({ oneOf: [{ const: 1 }, { const: 2 }] }, 2, undefined, failingPath), error => error === failure);
  assert.throws(() => checkSpatialSchema({ type: 'integer' }, 'bad', undefined, 7), spatialError(7));
});

test('defs、pattern、oneOf可变字段仍在每次检查中读取，不缓存schema身份', () => {
  const defs = { Word: { type: 'string', pattern: '^a$' } }, schema = { $ref: '#/$defs/Word' };
  assert.equal(checkSpatialSchema(schema, 'a', defs), undefined);
  defs.Word.pattern = '^b$';
  assert.throws(() => checkSpatialSchema(schema, 'a', defs), spatialError('$'));
  defs.Word = { const: 2 };
  assert.equal(checkSpatialSchema(schema, 2, defs), undefined);
  const union = { oneOf: [{ const: 2 }] };
  assert.equal(checkSpatialSchema(union, 2), undefined);
  union.oneOf.push({ type: 'integer' });
  assert.throws(() => checkSpatialSchema(union, 2), spatialError('$'));
  union.oneOf[0].const = 3;
  assert.equal(checkSpatialSchema(union, 2), undefined);
  const trace = [], choices = [{ const: 2 }];
  assert.equal(checkSpatialSchema({ get oneOf() { trace.push('oneOf'); return choices; } }, 2), undefined);
  assert.deepEqual(trace, ['oneOf', 'oneOf']);
});

test('失败字段不会求值后续getter，属性枚举与引用解析的异常仍传播', () => {
  const failure = new RangeError('不应访问后续字段'), value = { a: 'bad', get b() { throw failure; } };
  const schema = { oneOf: [{ type: 'object', properties: { a: { type: 'integer' }, b: {} } }, {}] };
  assert.equal(checkSpatialSchema(schema, value), undefined);
  const enumerating = new Proxy({}, { ownKeys() { throw failure; } });
  assert.throws(() => checkSpatialSchema({ oneOf: [{ const: enumerating }, { type: 'object' }] }, enumerating), error => error === failure);
  assert.throws(() => checkSpatialSchema({ oneOf: [{ const: 2 }, { $ref: '#/$defs/Missing' }] }, 2, {}), TypeError);
});

test('公开入口保持严格JSON、动作字段和原始值守卫', () => {
  const good = envelope(movement()), raw = JSON.stringify(good);
  assert.deepEqual(JSON.parse(JSON.stringify(parseSpatial('PublicEnvelope', raw))), good);
  for (const invalid of [
    raw.replace('"schemaVersion":2', '"schemaVersion":2,"schemaVersion":2'),
    raw.replace('"schemaVersion":2', '"schemaVersion":2.00000000000000001'),
    raw.replace('"schemaVersion":2', '"schemaVersion":1e-400'),
    raw.replace('"direction":"E"', '"direction":"E","authoritativePosition":{"x":1,"y":2}'),
    raw + 'null',
  ]) assert.throws(() => parseSpatial('PublicEnvelope', invalid), error => error instanceof ContractError && error.code === 'INVALID_MESSAGE');
  assert.throws(() => validateSpatial('PublicEnvelope', envelope({ ...movement(), extra: true })), spatialError('$.action'));
  const getter = { ...good }; let reads = 0;
  Object.defineProperty(getter, 'action', { enumerable: true, get() { reads++; return movement(); } });
  assert.throws(() => validateSpatial('PublicEnvelope', getter), ContractError);
  assert.equal(reads, 0);
  const sparse = Array(1); sparse.extra = 'R' + 'b'.repeat(32);
  assert.throws(() => validateSpatial('PublicEnvelope', envelope({ kind: 'speak', channel: 'directed', text: '请听清', recipientRefs: sparse })), ContractError);
  assert.throws(() => validateSpatial('PublicEnvelope', envelope({ kind: 'speak', channel: 'public', text: '\ud800', recipientRefs: [] })), ContractError);
  assert.throws(() => validateSpatial('PublicEnvelope', Object.assign(Object.create({ inherited: true }), good)), ContractError);
});
