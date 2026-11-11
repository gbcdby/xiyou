import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelGateway } from '../ai/gateway.mjs';
import { deferred } from '../test-support/ai-room.mjs';

const request = { contextVersion: 'legal-memory-v1', sessionId: 'S', actorId: 'N', principalKind: 'core_npc', snapshotSeq: '1', decision: { decisionId: 'D', deadlineAt: '2099-01-01T00:00:00.000Z' } };

test('Gateway：忽略 Abort 的 provider 仍会超时，关闭有界，迟到结果被吸收', async () => {
  const late = deferred(); let signal;
  const gateway = new ModelGateway({ provider: { kind: 'controlled', providerId: 'controlled-test', async generate(input, options) { signal = options.signal; return late.promise; } }, modelId: 'test-v1', timeoutMs: 25 });
  const result = await gateway.generate(request);
  assert.equal(result.status, 'Timeout');
  assert.equal(signal.aborted, true);
  await gateway.close();
  late.resolve({ rawText: '{"decisionId":"D","toolCalls":[{"kind":"wait"}]}' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(gateway.metrics().calls, 1);
  assert.equal(gateway.metrics().timeouts, 1);
  assert.equal(gateway.metrics().active, 0);
  assert.equal(gateway.metrics().externalCalls, 0);
  assert.equal((await gateway.generate(request)).status, 'Cancelled');
});

test('Gateway：严格原文拒绝重复键、未知工具与模型伪造元数据，保留有效原文摘要', async () => {
  const outputs = [
    '不是 JSON', '{"decisionId":"D","decisionId":"D","toolCalls":[{"kind":"wait"}]}',
    '{"decisionId":"D","toolCalls":[{"kind":"invent_world"}]}',
    '{"decisionId":"D","toolCalls":[{"kind":"wait"}],"goalUpdates":[]}',
    '{"decisionId":"another","toolCalls":[{"kind":"wait"}]}',
    '{ "decisionId": "D", "toolCalls": [{"kind":"wait"}] }',
  ];
  const gateway = new ModelGateway({ provider: { kind: 'controlled', providerId: 'controlled-test', async generate() { return { rawText: outputs.shift() }; } }, modelId: 'strict-v1' });
  try {
    for (let index = 0; index < 5; index++) assert.equal((await gateway.generate(request)).status, 'Invalid');
    const valid = await gateway.generate(request);
    assert.equal(valid.status, 'Valid');
    assert.equal(valid.rawText, '{ "decisionId": "D", "toolCalls": [{"kind":"wait"}] }');
    assert.match(valid.semanticDigest, /^[a-f0-9]{64}$/);
    assert.equal(gateway.metrics().invalidRate, 5 / 6);
    assert.equal(gateway.metrics().externalCalls, 0);
  } finally { await gateway.close(); }
  assert.throws(() => new ModelGateway({ provider: { kind: 'external', providerId: 'unconfigured', generate() {} }, modelId: 'unknown' }), /授权/);
});
