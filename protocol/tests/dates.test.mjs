import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateContract, ContractError } from '../index.mjs';

const read = name => JSON.parse(readFileSync(new URL('../fixtures/' + name, import.meta.url), 'utf8'));

test('UTC 日历正反边界与独立 Python 检查共用固定输入', () => {
  const event = read('valid-v1.json').WorldEvent;
  for (const sample of read('dates-v1.json')) {
    const value = { ...event, serverTime: sample.value };
    if (sample.valid) assert.doesNotThrow(() => validateContract('WorldEvent', value), sample.value);
    else assert.throws(() => validateContract('WorldEvent', value), ContractError, sample.value);
  }
});
