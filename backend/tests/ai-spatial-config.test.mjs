import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { configuredGateway } from '../ai/provider-config.mjs';

const root = fileURLToPath(new URL('../../.agent-output/a3-ai-runtime/', import.meta.url));
const base = { providerModule: './explicit-adapter.mjs', providerId: 'controlled-config-fixture', providerKind: 'external', modelId: 'configured-model-fixture', maxConcurrent: 2, minIntervalMs: 10, maxCallsPerSession: 10, timeoutMs: 100, maxContextBytes: 262144, endpoint: 'https://approved.invalid/api', credentialEnv: 'XIYOU_TEST_APPROVED_KEY', authorizationReference: '仅用于不出网的构造检查', maxCostPerSessionUsd: 1, maxCostPerCallUsd: 0.4 };
async function config(value) { await mkdir(root, { recursive: true }); const directory = await mkdtemp(join(root, 'config-')); const path = join(directory, 'provider.json'); await writeFile(path, JSON.stringify(value)); return path; }

test('供应商配置缺项、凭据缺失或不安全endpoint均在导入适配器前拒绝', async () => {
  let imports = 0;
  for (const value of [{ ...base, endpoint: 'https://token:secret@approved.invalid/api' }, { ...base, maxCostPerSessionUsd: 0 }, { ...base }, { ...base, providerKind: 'controlled' }]) {
    await assert.rejects(configuredGateway(await config(value), { environment: {}, importProvider() { imports++; throw new Error('不应导入'); } }), { code: 'AI_CONFIGURATION_REQUIRED' });
  }
  assert.equal(imports, 0);
});

test('已明确配置的费用上限折算为持久调用预算，凭据不进入configuration或评价记录', async () => {
  const dummy = '只供构造测试使用的占位值'; let received, calls = 0;
  const configured = await configuredGateway(await config(base), { environment: { XIYOU_TEST_APPROVED_KEY: dummy }, importProvider: async () => ({ createProvider(options) { received = options; return { kind: 'external', providerId: base.providerId, maxCostPerCallUsd: 0.4, generate() { calls++; throw new Error('本检查不允许外部调用'); } }; } }) });
  try {
    assert.equal(configured.scheduling.maxCallsPerSession, 2);
    assert.equal(received.apiKey, dummy);
    assert.ok(!JSON.stringify(configured.gateway.configuration()).includes(dummy));
    assert.equal(configured.gateway.configuration().maxCostPerSessionUsd, 1);
    assert.equal(configured.gateway.metrics().externalCalls, 0); assert.equal(calls, 0);
  } finally { await configured.gateway.close(); }
  await assert.rejects(configuredGateway(await config(base), { environment: { XIYOU_TEST_APPROVED_KEY: dummy }, importProvider: async () => ({ createProvider() { return { kind: 'external', providerId: base.providerId, generate() {} }; } }) }), { code: 'AI_CONFIGURATION_REQUIRED' });
});
