/** 真实preload与有限反例共享的唯一load变换；此模块本身不注册loader。 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const require = (value, message) => { if (!value) throw Error(message); };
export const DEFINITIONS = [
  { path: 'backend/socket-enqueue.mjs', marker: 'export function enqueueSocketPacket(', status: 'enqueueLoaded',
    suffix: '\n;globalThis[Symbol.for("xiyou.normal-supply.cold.v1")].enqueue(enqueueSocketPacket,()=>enqueueSocketPacket,value=>{enqueueSocketPacket=value;});\n' },
  { path: 'frontend/tests/gaolao-real-support.mjs', marker: 'export async function browserRoom(', status: 'harnessLoaded',
    suffix: '\n;globalThis[Symbol.for("xiyou.normal-supply.cold.v1")].harness(browserRoom,()=>browserRoom,value=>{browserRoom=value;});\n' },
];
export function createLoadHook({ repository, sources, transforms, status, nodeRaw }) {
  return function load(url, context, nextLoad) {
    const loaded = nextLoad(url, context), definition = DEFINITIONS.find(item => url === pathToFileURL(resolve(repository, item.path)).href);
    if (!definition) return loaded;
    const source = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString('utf8');
    const expected = sources.find(item => item.path === definition.path);
    require(expected && loaded.format === 'module' && hash(source) === expected.sha256
      && source.split(definition.marker).length === 2 && !status[definition.status], 'NSO原导出来源或唯一性不符');
    const transformed = source + definition.suffix, transform = transforms.find(item => item.path === definition.path);
    require(transform && transform.beforeSHA256 === hash(source) && transform.afterSHA256 === hash(transformed), 'NSO变换后源码未绑定');
    const moduleURL = pathToFileURL(resolve(repository, definition.path)).href;
    require(moduleURL.length <= 1024, 'NSO模块URL超过封套界');
    status[definition.status] = true;
    status.transformedModules.push({ path: definition.path, beforeSHA256: hash(source), afterSHA256: hash(transformed) });
    nodeRaw.setup.modules.push(moduleURL);
    return { ...loaded, source: transformed };
  };
}
