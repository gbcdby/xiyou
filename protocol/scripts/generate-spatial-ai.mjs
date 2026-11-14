import { readFileSync, writeFileSync } from 'node:fs';
import { spatialAISchema } from '../spatial-ai-schema.mjs';

const typeOf = s => s.$ref ? s.$ref.split('/').at(-1) : 'const' in s ? JSON.stringify(s.const) : s.enum ? s.enum.map(JSON.stringify).join(' | ') : s.oneOf ? s.oneOf.map(x => '(' + typeOf(x) + ')').join(' | ') : s.type === 'array' ? 'Array<' + typeOf(s.items) + '>' : s.type === 'object' ? '{ ' + Object.entries(s.properties ?? {}).map(([key, value]) => JSON.stringify(key) + ((s.required ?? []).includes(key) ? '' : '?') + ': ' + typeOf(value) + ';').join(' ') + ' }' : s.type === 'integer' ? 'number' : s.type;
const literal = value => value === true ? 'True' : value === false ? 'False' : value === null ? 'None' : JSON.stringify(value);
const pythonType = (s, name) => s.$ref ? `ForwardRef(${JSON.stringify(s.$ref.split('/').at(-1))})` : 'const' in s ? `Literal[${literal(s.const)}]` : s.enum ? `Literal[${s.enum.map(literal).join(', ')}]` : s.oneOf ? `Union[${s.oneOf.map((choice, index) => pythonType(choice, name + '_' + index)).join(', ')}]` : s.type === 'array' ? `List[${pythonType(s.items, name + '_item')}]` : s.type === 'object' ? `TypedDict(${JSON.stringify(name)}, {${Object.entries(s.properties ?? {}).map(([key, value]) => JSON.stringify(key) + ': ' + ((s.required ?? []).includes(key) ? pythonType(value, name + '_' + key) : `NotRequired[${pythonType(value, name + '_' + key)}]`)).join(', ')}})` : ({ string: 'str', integer: 'int', boolean: 'bool', null: 'type(None)' })[s.type];
const banner = '// 由 protocol/scripts/generate-spatial-ai.mjs 从 spatial-ai-schema.mjs 生成；请修改唯一字段源。\n';
const declarations = banner + `import type * as T from '../game/spatial-ai-types.js';
export type * from '../game/spatial-ai-types.js';
export const spatialAISchema: Readonly<Record<string, unknown>>;
export const spatialModelKinds: readonly string[];
export function spatialIntentResponseSchema(): Record<string, unknown>;
export interface SpatialAIContracts {
${Object.keys(spatialAISchema.$defs).map(name => `  ${name}: T.${name};`).join('\n')}
}
export function validateSpatialAI<K extends keyof SpatialAIContracts>(name: K, value: unknown): SpatialAIContracts[K];
export function parseSpatialAI<K extends keyof SpatialAIContracts>(name: K, raw: string): SpatialAIContracts[K];
export function validateSpatialActionForContext(value: T.SpatialModelActionV2, context: T.SpatialContextV2): T.SpatialModelActionV2;
export function parseSpatialProposedIntent(raw: string, expectedDecisionId: string, context?: T.SpatialDecisionContextV2): T.SpatialProposedIntentV2;
export function canonicalSpatialIntentPayload(value: T.SpatialProposedIntentV2): string;
export function spatialIntentSemanticDigest(value: T.SpatialProposedIntentV2): Promise<string>;
`;
const artifacts = {
  '../../game/spatial-ai-types.ts': banner + Object.entries(spatialAISchema.$defs).map(([name, schema]) => `export type ${name} = ${typeOf(schema)};`).join('\n\n') + '\n',
  '../spatial-ai.schema.json': JSON.stringify(spatialAISchema, null, 2) + '\n',
  '../spatial-ai.d.mts': declarations,
  '../spatial-ai-node.d.mts': banner + `export * from './spatial-ai.mjs';\nimport type { SpatialProposedIntentV2 } from '../game/spatial-ai-types.js';\nexport function spatialIntentSemanticDigestSync(value: SpatialProposedIntentV2): string;\n`,
  '../spatial_ai_types.py': '# 由 protocol/scripts/generate-spatial-ai.mjs 从 spatial-ai-schema.mjs 生成；请修改唯一字段源。\nfrom typing import ForwardRef, List, Literal, NotRequired, TypedDict, Union\n\n' + Object.entries(spatialAISchema.$defs).map(([name, schema]) => `${name} = ${pythonType(schema, name)}`).join('\n\n') + '\n',
};
for (const [path, contents] of Object.entries(artifacts)) {
  const url = new URL(path, import.meta.url);
  if (process.argv.includes('--check')) { if (readFileSync(url, 'utf8') !== contents) throw new Error('空间模型生成产物过期：' + path); }
  else writeFileSync(url, contents);
}
console.log('空间模型 JSON Schema、TypeScript 与 Python 生成产物一致。');
