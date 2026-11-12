import { readFileSync, writeFileSync } from 'node:fs';
import { spatialSchema } from '../spatial-schema.mjs';
const typeOf = s => s.$ref ? s.$ref.split('/').at(-1) : 'const' in s ? JSON.stringify(s.const) : s.enum ? s.enum.map(JSON.stringify).join(' | ') : s.oneOf ? s.oneOf.map(x => '(' + typeOf(x) + ')').join(' | ') : s.type === 'array' ? 'Array<' + typeOf(s.items) + '>' : s.type === 'object' ? (typeof s.additionalProperties === 'object' ? 'Record<string, ' + typeOf(s.additionalProperties) + '>' : '{ ' + Object.entries(s.properties ?? {}).map(([k, v]) => JSON.stringify(k) + ((s.required ?? []).includes(k) ? '' : '?') + ': ' + typeOf(v) + ';').join(' ') + ' }') : s.type === 'integer' ? 'number' : s.type;
const banner = '// 由 protocol/scripts/generate-spatial.mjs 从 spatial-schema.mjs 生成；请修改唯一字段源。\n';
const artifacts = {
  '../../game/spatial-types.ts': banner + Object.entries(spatialSchema.$defs).map(([name, s]) => 'export type ' + name + ' = ' + typeOf(s) + ';').join('\n\n') + '\n',
  '../spatial.schema.json': JSON.stringify(spatialSchema, null, 2) + '\n',
  '../spatial.d.mts': banner + `import type * as T from '../game/spatial-types.js';\nexport type * from '../game/spatial-types.js';\nexport function parseSpatial<K extends keyof SpatialContracts>(name: K, raw: string): SpatialContracts[K];\nexport function validateSpatial<K extends keyof SpatialContracts>(name: K, value: unknown): SpatialContracts[K];\nexport interface SpatialContracts {\n${Object.keys(spatialSchema.$defs).map(k => '  ' + k + ': T.' + k + ';').join('\n')}\n}\nexport class MovementCommandSource { readonly controlEpoch: string; constructor(controlEpoch: string); move(sceneId: string, destination: T.Position, options?: { targetRef?: string; anchorId?: string }): T.ActionV2; stop(): T.ActionV2; }\n`,
};
for (const [path, contents] of Object.entries(artifacts)) {
  const url = new URL(path, import.meta.url);
  if (process.argv.includes('--check')) { if (readFileSync(url, 'utf8') !== contents) throw new Error('空间协议生成产物过期：' + path); }
  else writeFileSync(url, contents);
}
console.log('空间协议生成产物一致。');
