import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { canonicalize } from '../../protocol/index.mjs';

export const repository = fileURLToPath(new URL('../../', import.meta.url));
export const sha256 = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonicalize(value)).digest('hex');
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(read, label, timeout = 15000) {
  const start = performance.now(); let last;
  while (performance.now() - start < timeout) {
    last = await read(); if (last) return last;
    await sleep(30);
  }
  throw new Error(`等待超时：${label}（${timeout} ms）`);
}
export async function saveJSON(path, value) {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
}
export async function sourceIdentity() {
  const sourceHashes = {};
  async function collect(directory) {
    for (const entry of await readdir(resolve(repository, directory), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['node_modules', 'evidence', 'dist'].includes(entry.name)) continue;
      const name = directory + '/' + entry.name;
      if (entry.isDirectory()) await collect(name);
      else if (/\.(mjs|ts|vue|css|json|html|sql)$/.test(name)) sourceHashes[name] = sha256(await readFile(resolve(repository, name)));
    }
  }
  for (const name of ['frontend', 'backend', 'game', 'protocol', 'content']) await collect(name);
  for (const name of ['package.json', 'package-lock.json']) sourceHashes[name] = sha256(await readFile(resolve(repository, name)));
  const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
  return { commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), status: git('status', '--short'), sourceHashes };
}
export function comparableProjection(projection) {
  const copy = structuredClone(projection);
  delete copy.self.canControl;
  return copy;
}
export function sameProjection(left, right, label) {
  assert.deepEqual(comparableProjection(left), comparableProjection(right), label);
}
