/** 仅在已释放normal启动前冷安装两个精确导出；原harness与产品磁盘字节不改。 */
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import fs from 'node:fs';
import { verifyInvocation, repository, writeExclusive, assert } from './guard.mjs';

const binding = verifyInvocation('normal'), { config, input, output } = binding;
const { createNodeProbe } = await import('./node-probe.mjs');
const { createColdHooks } = await import('./cold-hooks.mjs');
const { sameDescriptor } = await import('./collector.mjs');
const { validateRaw, validateCold } = await import('./envelope.mjs');
const { DEFINITIONS, createLoadHook } = await import('./loader-hooks.mjs');
const nodeProbe = createNodeProbe(config);
const controller = createColdHooks({ config, nodeProbe,
  installPageHandle: (page, values) => page.evaluateHandle(async options => {
    const { installPageProbe } = await import('/tests/normal-supply-observation/page-probe.mjs');
    return installPageProbe(options);
  }, values),
  onRaw(realm, raw) {
    const value = validateRaw(raw, config);
    return writeExclusive(output, realm + '-boundaries.json', value.text, 16777216);
  },
  onStatus(cold) { const value = validateCold(cold); writeExclusive(output, 'cold-status.json', value.text, 32768); },
});
process.once('exit', () => { try { controller.exit(); } catch {
  try { fs.writeSync(2, 'NSO冷收取未完成；保留本次原件与原退出。\n'); } catch {} }
});
const key = Symbol.for('xiyou.normal-supply.cold.v1');
assert(!Object.getOwnPropertyDescriptor(globalThis, key), 'NSO临时桥已被占用');
const bridge = { enqueue: nodeProbe.bind, harness: controller.harness };
Object.defineProperty(globalThis, key, { configurable: true, value: bridge });
const installed = Object.getOwnPropertyDescriptor(globalThis, key);
const loader = registerHooks({ load: createLoadHook({ repository, sources: input.bindings.sources,
  transforms: binding.method.transforms, status: controller.status, nodeRaw: nodeProbe.raw }) });
try {
  for (const definition of DEFINITIONS) await import(pathToFileURL(resolve(repository, definition.path)).href);
  assert(controller.status.enqueueLoaded && controller.status.harnessLoaded, 'NSO冷入口未全部安装');
} finally {
  loader.deregister(); controller.status.loaderRemoved = true;
  const current = Object.getOwnPropertyDescriptor(globalThis, key);
  if (sameDescriptor(current, installed)) {
    delete globalThis[key]; controller.status.temporaryBridgeRemoved = !Object.getOwnPropertyDescriptor(globalThis, key);
  }
  assert(controller.status.temporaryBridgeRemoved, 'NSO临时桥未恢复');
}
