import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ModelGateway } from './gateway.mjs';

const required = ['providerModule', 'providerId', 'providerKind', 'modelId', 'maxConcurrent', 'minIntervalMs', 'maxCallsPerSession', 'timeoutMs', 'maxContextBytes'];
const external = ['endpoint', 'credentialEnv', 'authorizationReference', 'maxCostPerSessionUsd', 'maxCostPerCallUsd'];
const fail = message => { const error = new Error(message); error.code = 'AI_CONFIGURATION_REQUIRED'; throw error; };

/** 只读取调用方指定的配置文件和一个具名环境变量，不寻找凭据或默认付费服务。 */
export async function configuredGateway(filename, { environment = process.env, importProvider = url => import(url) } = {}) {
  let configuration;
  try { configuration = JSON.parse(await readFile(filename, 'utf8')); }
  catch { fail('模型配置文件缺失或不是合法 JSON。'); }
  if (!configuration || Array.isArray(configuration) || typeof configuration !== 'object' || Object.keys(configuration).some(key => ![...required, ...external].includes(key))) fail('模型配置含未知字段。');
  for (const key of required) if (!Object.hasOwn(configuration, key)) fail(`模型配置缺少 ${key}。`);
  for (const key of ['providerModule', 'providerId', 'modelId']) if (typeof configuration[key] !== 'string' || !configuration[key].trim() || configuration[key].includes('\0')) fail(`${key} 必须明确填写。`);
  if (!['controlled', 'external'].includes(configuration.providerKind)) fail('providerKind 必须明确标记受控或外部来源。');
  for (const key of ['maxConcurrent', 'minIntervalMs', 'maxCallsPerSession', 'timeoutMs', 'maxContextBytes']) if (!Number.isSafeInteger(configuration[key]) || configuration[key] <= 0) fail(`${key} 必须是已确定的正整数。`);
  let apiKey, maxCalls = configuration.maxCallsPerSession;
  if (configuration.providerKind === 'external') {
    for (const key of external) if (!Object.hasOwn(configuration, key)) fail(`外部模型配置缺少 ${key}。`);
    let endpoint;
    try { endpoint = new URL(configuration.endpoint); } catch { fail('外部模型 endpoint 无效。'); }
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) fail('endpoint 必须为不含凭据或查询密钥的 HTTPS 地址。');
    if (typeof configuration.credentialEnv !== 'string' || !/^[A-Z][A-Z0-9_]{1,127}$/.test(configuration.credentialEnv)) fail('credentialEnv 必须是明确授权的环境变量名。');
    if (typeof configuration.authorizationReference !== 'string' || !configuration.authorizationReference.trim()) fail('外部模型缺少本次授权引用。');
    for (const key of ['maxCostPerSessionUsd', 'maxCostPerCallUsd']) if (!Number.isFinite(configuration[key]) || configuration[key] <= 0) fail(`${key} 必须是已批准的正数。`);
    maxCalls = Math.min(maxCalls, Math.floor(configuration.maxCostPerSessionUsd / configuration.maxCostPerCallUsd));
    if (maxCalls < 1) fail('费用上限不足以覆盖一次已声明的调用上限。');
    apiKey = environment[configuration.credentialEnv];
    if (typeof apiKey !== 'string' || !apiKey) fail('指定的授权凭据尚未配置。');
  } else if (external.some(key => Object.hasOwn(configuration, key))) fail('受控模型配置不应包含外部凭据、费用或授权字段。');
  const adapter = await importProvider(pathToFileURL(resolve(dirname(resolve(filename)), configuration.providerModule)).href);
  if (typeof adapter.createProvider !== 'function') fail('供应商适配模块必须导出 createProvider。');
  const provider = await adapter.createProvider({ providerId: configuration.providerId, modelId: configuration.modelId, ...(configuration.providerKind === 'external' ? { endpoint: configuration.endpoint, apiKey, maxCostPerCallUsd: configuration.maxCostPerCallUsd } : {}) });
  if (provider?.providerId !== configuration.providerId || provider?.kind !== configuration.providerKind) fail('适配器返回的供应商身份或来源类型与配置不符。');
  if (configuration.providerKind === 'external' && (!Number.isFinite(provider.maxCostPerCallUsd) || provider.maxCostPerCallUsd <= 0 || provider.maxCostPerCallUsd > configuration.maxCostPerCallUsd)) fail('适配器没有承诺可执行的单次费用上限。');
  const base = new ModelGateway({ provider, modelId: configuration.modelId, timeoutMs: configuration.timeoutMs, maxContextBytes: configuration.maxContextBytes, externalAuthorization: configuration.providerKind === 'external' ? { reference: configuration.authorizationReference, maxCalls } : null });
  const budget = configuration.providerKind === 'external' ? { endpoint: configuration.endpoint, authorizationReference: configuration.authorizationReference, maxCostPerSessionUsd: configuration.maxCostPerSessionUsd, maxCostPerCallUsd: configuration.maxCostPerCallUsd } : {};
  const gateway = { generate: (...args) => base.generate(...args), metrics: () => base.metrics(), close: () => base.close(), configuration: () => ({ ...base.configuration(), ...budget, maxCallsPerSession: maxCalls }) };
  return { gateway, scheduling: { maxConcurrent: configuration.maxConcurrent, minIntervalMs: configuration.minIntervalMs, maxCallsPerSession: maxCalls } };
}
