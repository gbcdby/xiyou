import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canonicalize, ContractError, canonicalActionPayload, actionSemanticDigest, validateContract,
} from '../index.mjs';

const read = name => JSON.parse(readFileSync(new URL('../fixtures/' + name, import.meta.url), 'utf8'));
const valid = read('valid-v1.json');
const digest = read('digest-v1.json');
const nest = (value, count) => { for (let i = 0; i < count; i++) value = [value]; return value; };

function rejects(value, message, path) {
  let caught;
  try { canonicalize(value); } catch (error) { caught = error; }
  assert.ok(caught instanceof ContractError);
  assert.deepEqual(
    { name: caught.name, code: caught.code, path: caught.path, message: caught.message },
    { name: 'ContractError', code: 'INVALID_MESSAGE', path, message: message + '（' + path + '）' },
  );
}

test('CE-01：规范字节保留 UTF-16 排序、数组顺序、Unicode 内容、负零与固定摘要', async () => {
  const value = Object.assign(Object.create(null), {
    '\ue000': 'bmp', '\ud83d\ude00': 'astral', '2': 'two', '10': 'ten',
    a: [-0, false, null, 9007199254740991, -9007199254740991, '"\\\b\f\n\r\t', '\u0000', 'é', 'e\u0301', '\u2028\u2029', '😀'],
  });
  // 期望字节独立手写；不调用待测编码器生成期望或归一化组合 Unicode。
  const expected = '{"10":"ten","2":"two","a":[0,false,null,9007199254740991,-9007199254740991,"\\"\\\\\\b\\f\\n\\r\\t","\\u0000","é","e\u0301","\u2028\u2029","😀"],"😀":"astral","\ue000":"bmp"}';
  assert.equal(canonicalize(value), expected);
  validateContract('ClientAction', valid.ClientAction);
  assert.equal(canonicalActionPayload(valid.ClientAction), digest.canonical);
  assert.equal(await actionSemanticDigest(valid.ClientAction), digest.sha256);
});

test('CE-02：32/33 层、键的 Unicode 与深度检查仍按 descriptor、键、值的顺序报告', () => {
  const depth32 = '$' + '[0]'.repeat(32);
  const depth33 = depth32 + '[0]';
  assert.equal(canonicalize(nest(0, 32)), '['.repeat(32) + '0' + ']'.repeat(32));
  assert.equal(canonicalize(nest({}, 32)), '['.repeat(32) + '{}' + ']'.repeat(32));
  assert.equal(canonicalize(nest({ x: 1 }, 31)), '['.repeat(31) + '{"x":1}' + ']'.repeat(31));
  rejects(nest(0, 33), '消息嵌套过深', depth33);
  rejects(nest({ x: 1 }, 32), '消息嵌套过深', depth32);
  rejects(nest({ '\ud800': 1 }, 32), '消息嵌套过深', depth32);
  rejects({ '\ud800': undefined }, '字符串含不完整的 Unicode 代理对', '$');
  rejects({ a: '\udc00' }, '字符串含不完整的 Unicode 代理对', '$.a');
  let calls = 0;
  const accessor = Object.defineProperty({}, 'x', { enumerable: true, get() { calls++; return 1; } });
  rejects(nest(accessor, 32), 'JSON 对象不能含访问器', depth32);
  assert.equal(calls, 0);
});

test('CE-03：数组双重检查、对象形状及原型边界不变，getter 与 toJSON 不执行', () => {
  let calls = 0;
  const ignored = Object.defineProperties({}, {
    hidden: { get() { calls++; return 9; } },
    toJSON: { value() { calls++; return '不应运行'; } },
  });
  assert.equal(canonicalize(ignored), '{}');
  const ownGetter = Object.defineProperty({}, 'x', { enumerable: true, get() { calls++; return 9; } });
  rejects(ownGetter, 'JSON 对象不能含访问器', '$');
  rejects({ toJSON() { calls++; return '不应运行'; } }, '值不能规范编码', '$.toJSON');
  const symbolObject = Object.defineProperty({}, Symbol('私有'), { value: 1 });
  rejects(symbolObject, 'JSON 对象不能含 Symbol 键', '$');
  for (const value of [new Date(0), new Map(), new Set(), new Number(1), Object.create({ inherited: 1 })]) {
    rejects(value, '值必须是普通 JSON 对象', '$');
  }
  assert.equal(canonicalize(Object.assign(Object.create(null), { x: 1 })), '{"x":1}');
  const customArray = [1, 2];
  Object.setPrototypeOf(customArray, { get toJSON() { calls++; return () => '不应运行'; } });
  assert.equal(canonicalize(customArray), '[1,2]');
  rejects(new Array(1), '数组不能含稀疏项或额外属性', '$');
  const holeWithExtra = new Array(1);
  holeWithExtra.extra = '补不回空洞';
  rejects(holeWithExtra, '数组必须只包含连续的自有数据项', '$[0]');
  const extra = [1]; extra.extra = 2;
  rejects(extra, '数组不能含稀疏项或额外属性', '$');
  const symbolArray = [1]; symbolArray[Symbol('私有')] = 2;
  rejects(symbolArray, '数组不能含稀疏项或额外属性', '$');
  const nonEnumerable = [1]; Object.defineProperty(nonEnumerable, '0', { enumerable: false });
  rejects(nonEnumerable, '数组必须只包含连续的自有数据项', '$[0]');
  const arrayGetter = [1]; Object.defineProperty(arrayGetter, '0', { enumerable: true, get() { calls++; return 1; } });
  rejects(arrayGetter, '数组必须只包含连续的自有数据项', '$[0]');
  for (const value of [undefined, NaN, Infinity, -Infinity, 1.25, 9007199254740992, 1n, Symbol('值'), () => 1]) {
    rejects(value, '值不能规范编码', '$');
  }
  assert.equal(calls, 0);
});

test('CE-04：重复共享引用合法，祖先环拒绝，修改后重编码与失败后调用不继承状态', () => {
  const shared = { b: 2, a: 1 };
  const value = { second: shared, first: shared };
  assert.equal(canonicalize(value), '{"first":{"a":1,"b":2},"second":{"a":1,"b":2}}');
  shared.a = 7;
  assert.equal(canonicalize(value), '{"first":{"a":7,"b":2},"second":{"a":7,"b":2}}');
  value.loop = value;
  rejects(value, '值不能规范编码', '$.loop');
  delete value.loop;
  assert.equal(canonicalize(value), '{"first":{"a":7,"b":2},"second":{"a":7,"b":2}}');
  const array = []; array.push(array);
  rejects(array, '值不能规范编码', '$[0]');
  array[0] = null;
  assert.equal(canonicalize(array), '[null]');
  const a = {}; const b = { parent: a }; a.child = b;
  rejects(a, '值不能规范编码', '$.child.parent');
  assert.equal(canonicalize({ after: true }), '{"after":true}');
});

test('CE-05：多重错误首报及 Proxy 反射顺序、输入原异常身份保持', () => {
  rejects({ z: NaN, a: undefined }, '值不能规范编码', '$.a');
  const invalidKeyAccessor = Object.defineProperty({}, '\ud800', { enumerable: true, get() { throw new Error('不应执行'); } });
  rejects(invalidKeyAccessor, 'JSON 对象不能含访问器', '$');
  const symbolBeforeKey = { '\ud800': undefined }; symbolBeforeKey[Symbol('私有')] = 1;
  rejects(symbolBeforeKey, 'JSON 对象不能含 Symbol 键', '$');
  const prototypeBeforeSymbol = Object.create({}); prototypeBeforeSymbol[Symbol('私有')] = 1;
  rejects(prototypeBeforeSymbol, '值必须是普通 JSON 对象', '$');
  let calls = 0;
  const laterGetter = Object.defineProperty({}, 'later', { enumerable: true, get() { calls++; return 1; } });
  rejects([undefined, laterGetter], '值不能规范编码', '$[0]');
  assert.equal(calls, 0);

  function checkReflections(array, failure) {
    const trace = [];
    const marker = new Error('输入本来的原异常');
    const target = array ? [1, { z: 2, a: 3 }] : { z: 2, a: [1, 3] };
    const value = new Proxy(target, {
      getPrototypeOf(object) { trace.push('prototype'); return Reflect.getPrototypeOf(object); },
      ownKeys(object) { trace.push('keys'); if (failure) throw marker; return Reflect.ownKeys(object); },
      getOwnPropertyDescriptor(object, key) { trace.push('descriptor:' + String(key)); return Reflect.getOwnPropertyDescriptor(object, key); },
      get(object, key, receiver) { trace.push('get:' + String(key)); return Reflect.get(object, key, receiver); },
    });
    if (failure) {
      assert.throws(() => canonicalize(value), error => error === marker);
      assert.deepEqual(trace, ['prototype', 'keys']);
      return;
    }
    assert.equal(canonicalize(value), array ? '[1,{"a":3,"z":2}]' : '{"a":[1,3],"z":2}');
    // 固定序列从原公开行为推导：对象先检查 Symbol，再枚举并排序；数组保留各次 length 读取。
    const expected = array
      ? ['prototype', 'keys', 'get:length', 'get:length', 'descriptor:0', 'get:length', 'descriptor:1', 'get:length']
      : ['prototype', 'keys', 'keys', 'descriptor:z', 'descriptor:a', 'descriptor:a', 'descriptor:z'];
    assert.deepEqual(trace, expected);
  }
  for (const array of [false, true]) {
    checkReflections(array, false);
    checkReflections(array, true);
  }
});
