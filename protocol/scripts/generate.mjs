import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contractSchema, contractNames } from '../schema.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const checkOnly = process.argv.includes('--check');
function typeOf(schema) {
  if (schema.$ref) return schema.$ref.split('/').at(-1);
  if ('const' in schema) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map(JSON.stringify).join(' | ');
  if (schema.oneOf) return schema.oneOf.map(s => '(' + typeOf(s) + ')').join(' | ');
  if (schema.type === 'null') return 'null';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type === 'string') return 'string';
  if (schema.type === 'integer') return 'number';
  if (schema.type === 'array') return 'Array<' + typeOf(schema.items) + '>';
  if (schema.type === 'object') {
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') return 'Record<string, ' + typeOf(schema.additionalProperties) + '>';
    return '{ ' + Object.entries(schema.properties ?? {}).map(([key, value]) => JSON.stringify(key) + ((schema.required ?? []).includes(key) ? '' : '?') + ': ' + typeOf(value) + ';').join(' ') + ' }';
  }
  throw new Error('不能生成此契约类型');
}

const banner = '// 本文件由 protocol/scripts/generate.mjs 从 schema.mjs 生成，请修改唯一字段源后重新生成。\n';
const types = banner + Object.entries(contractSchema.$defs).map(([name, schema]) => 'export type ' + name + ' = ' + typeOf(schema) + ';').join('\n\n') + '\n';
const declarations = banner + `import type { ClientAction, ProposedIntent, ${contractNames.filter(name => !['ClientAction', 'ProposedIntent'].includes(name)).join(', ')} } from '../game/types.js';
export type * from '../game/types.js';
export interface ContractMap {
${contractNames.map(name => '  ' + name + ': ' + name + ';').join('\n')}
}
export type ContractName = keyof ContractMap;
export class ContractError extends Error {
  readonly code: 'INVALID_MESSAGE';
  readonly path: string;
  constructor(message?: string, path?: string);
}
export const contractNames: readonly ContractName[];
export const contractSchema: Readonly<Record<string, unknown>>;
export function parseStrictJSON(raw: string, options?: { maxBytes?: number; maxDepth?: number }): unknown;
export function canonicalize(value: unknown): string;
export function compareDecimal(a: string, b: string): -1 | 0 | 1;
export function validateContract<K extends ContractName>(name: K, value: unknown): ContractMap[K];
export function parseContract<K extends ContractName>(name: K, raw: string): ContractMap[K];
export function parseClientAction(raw: string): ClientAction;
export function parseProposedIntent(raw: string, expectedDecisionId: string): ProposedIntent;
export function canonicalActionPayload(value: ClientAction): string;
export function canonicalIntentPayload(value: ProposedIntent): string;
export function sha256Canonical(encoded: string): Promise<string>;
export function actionSemanticDigest(value: ClientAction): Promise<string>;
export function intentSemanticDigest(value: ProposedIntent): Promise<string>;
`;
const nodeDeclarations = banner + `export * from './index.js';
import type { ClientAction, ProposedIntent } from '../game/types.js';
export function actionSemanticDigestSync(value: ClientAction): string;
export function intentSemanticDigestSync(value: ProposedIntent): string;
`;
const artifacts = {
  'protocol/contracts.schema.json': JSON.stringify(contractSchema, null, 2) + '\n',
  'game/types.ts': types,
  'protocol/index.d.mts': declarations,
  'protocol/node.d.mts': nodeDeclarations.replace("'./index.js'", "'./index.mjs'"),
};
for (const [path, contents] of Object.entries(artifacts)) {
  const absolute = resolve(root, path);
  if (checkOnly) {
    if (readFileSync(absolute, 'utf8') !== contents) throw new Error('生成产物已过期：' + path);
  } else {
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents);
  }
}
console.log(checkOnly ? '机器契约与 TypeScript 生成产物一致' : '已生成机器契约与 TypeScript 绑定');
