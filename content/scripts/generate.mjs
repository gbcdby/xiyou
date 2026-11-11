import { readFile, writeFile } from 'node:fs/promises';
import { contentSchema } from '../schema.mjs';

const file = new URL('../content.schema.json', import.meta.url);
const expected = JSON.stringify(contentSchema, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (await readFile(file, 'utf8') !== expected) throw new Error('内容 Schema 与唯一来源不一致');
  console.log('内容 Schema 生成一致。');
} else {
  await writeFile(file, expected);
  console.log('内容 Schema 已生成。');
}
