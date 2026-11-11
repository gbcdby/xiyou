import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStrictJSON, canonicalize, ContractError } from '../index.mjs';

test('重复键和转义后同名键在原始 JSON 入口拒绝', () => {
  for (const raw of ['{"a":1,"a":2}', '{"a":{"x":1,"\\u0078":2}}']) {
    assert.throws(() => parseStrictJSON(raw), error => error instanceof ContractError && error.code === 'INVALID_MESSAGE');
  }
});

test('JSON 入口保留精确字符串并拒绝无法精确表达的数字', () => {
  const value = parseStrictJSON('{"seq":"9007199254740993","number":1,"text":"甲"}');
  assert.equal(value.seq, '9007199254740993');
  assert.equal(value.text, '甲');
  for (const raw of ['{"n":9007199254740993}', '{"n":1.25}', '{"n":1e-400}', '{"n":1.00000000000000001}', '{"x":1}x', '{"a":1,}', '{"a":"\\ud800"}']) {
    assert.throws(() => parseStrictJSON(raw), ContractError);
  }
});

test('规范编码按键名排序且不改写数组顺序或 Unicode 内容', () => {
  assert.equal(canonicalize({ z: [2, 1], a: { y: true, x: '甲' } }), '{"a":{"x":"甲","y":true},"z":[2,1]}');
  assert.throws(() => canonicalize({ missing: undefined }), ContractError);
  assert.throws(() => canonicalize({ n: NaN }), ContractError);
});
