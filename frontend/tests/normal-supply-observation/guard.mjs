/** 进入新方法前核对真实输入；无默认执行、无任意命令入口。 */
import fs from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const methodDirectory = dirname(fileURLToPath(import.meta.url));
export const repository = resolve(methodDirectory, '../../..');
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function assert(value, message) { if (!value) throw Error(message); }
export function readJSON(path) { return JSON.parse(fs.readFileSync(path, 'utf8')); }
export function verifyFile(path, expected) {
  assert(isAbsolute(path) && !fs.lstatSync(path).isSymbolicLink() && fs.statSync(path).isFile(), 'NSO文件路径形状不符');
  const bytes = fs.readFileSync(path);
  assert(bytes.length === expected.bytes && sha256(bytes) === expected.sha256, 'NSO冻结字节不符');
  return bytes;
}
export function writeExclusive(directory, name, text, limit) {
  assert(/^[a-z0-9-]+\.json$/.test(name), 'NSO输出名称不在闭集');
  assert(Buffer.byteLength(text) <= limit, 'NSO输出超过明确界');
  const identity = { bytes: Buffer.byteLength(text), sha256: sha256(text) };
  const partial = resolve(directory, name + '.part'), final = resolve(directory, name);
  fs.writeFileSync(partial, text, { flag: 'wx' }); fs.linkSync(partial, final); fs.unlinkSync(partial);
  return identity;
}
export function verifyInvocation(stage) {
  assert(stage === 'finite' || stage === 'normal', 'NSO未知阶段');
  assert(process.cwd() === repository && process.version === 'v24.22.3', 'NSO源路径或Node版本不符');
  const inputPath = process.env.XIYOU_NSO_INPUT, releasePath = process.env.XIYOU_NSO_RELEASE;
  assert(inputPath && releasePath && isAbsolute(inputPath) && isAbsolute(releasePath), 'NSO输入/释放缺失');
  const inputBytes = fs.readFileSync(inputPath), releaseBytes = fs.readFileSync(releasePath);
  assert(sha256(inputBytes) === process.env.XIYOU_NSO_INPUT_SHA256
    && sha256(releaseBytes) === process.env.XIYOU_NSO_RELEASE_SHA256, 'NSO输入/释放摘要不符');
  const input = JSON.parse(inputBytes), release = JSON.parse(releaseBytes);
  const manifestPath = resolve(methodDirectory, 'method-manifest.json'), manifestBytes = fs.readFileSync(manifestPath);
  const methodSHA256 = sha256(manifestBytes), method = JSON.parse(manifestBytes);
  assert(methodSHA256 === process.env.XIYOU_NSO_METHOD_SHA256 && methodSHA256 === release.methodSHA256
    && input.methodSHA256 === methodSHA256
    && (stage === 'finite' ? input.releaseSHA256 === null && release.inputSHA256 === sha256(inputBytes)
      : release.inputSHA256 === null && input.releaseSHA256 === sha256(releaseBytes)), 'NSO方法绑定不符');
  assert(input.format === 'NSO_INPUT_V1' && input.stage === stage && process.env.XIYOU_NSO_STAGE === stage
    && release.state === (stage === 'normal' ? 'ROOT_RELEASE_NSO_NORMAL_ONCE' : 'ROOT_RELEASE_NSO_FINITE_ONCE')
    && release.productHead === '16099e191fdc80c52849aa1d67cd075ccca4e01e'
    && release.productTree === '31f82d6478e2ced1d27875c75160eef626ffe0bf'
    && release.attempts === 1 && release.retries === 0 && release.previousAttemptsRefunded === false,
  'NSO不是本次明确释放');
  const expectedBudget = stage === 'normal' ? { wallSeconds: 120, termSeconds: 10, killSeconds: 2 }
    : { wallSeconds: 10, termSeconds: 2, killSeconds: 1 };
  assert(Object.keys(release.budget ?? {}).sort().join('\0') === Object.keys(expectedBudget).sort().join('\0')
    && Object.entries(expectedBudget).every(([key, value]) => release.budget[key] === value), 'NSO预算不符');
  const actualEnvironment = { ...input.childEnvironmentBase,
    XIYOU_NSO_INPUT: inputPath, XIYOU_NSO_INPUT_SHA256: sha256(inputBytes),
    XIYOU_NSO_RELEASE: releasePath, XIYOU_NSO_RELEASE_SHA256: sha256(releaseBytes),
    XIYOU_NSO_METHOD_SHA256: methodSHA256, XIYOU_NSO_STAGE: stage };
  assert(Object.keys(process.env).sort().join('\0') === Object.keys(actualEnvironment).sort().join('\0')
    && Object.entries(actualEnvironment).every(([name, value]) => process.env[name] === value), 'NSO实际child env不符');
  assert(fs.realpathSync(process.execPath) === input.bindings.runtime.node.physicalPath, 'NSO实际Node路径不符');
  verifyFile(fs.realpathSync(process.execPath), input.bindings.runtime.node);
  for (const file of method.files) verifyFile(resolve(repository, file.path), file);
  for (const file of input.bindings.sources) verifyFile(resolve(repository, file.path), file);
  const expectedArguments = stage === 'normal' ? [resolve(repository, 'frontend/tests/client-experience-browser.mjs'), 'normal']
    : [resolve(methodDirectory, 'finite-check.mjs')];
  assert(JSON.stringify(process.argv.slice(1)) === JSON.stringify(expectedArguments), 'NSO原命令或scenario不符');
  assert(JSON.stringify(process.execArgv) === JSON.stringify(stage === 'normal'
    ? ['--import', resolve(methodDirectory, 'preload.mjs')] : ['--test-reporter=tap']), 'NSO额外Node开关不符');
  const output = process.env.XIYOU_NSO_OUTPUT;
  assert(output === resolve(input.outputDirectory, 'diagnostic') && isAbsolute(output), 'NSO输出归属不符');
  fs.mkdirSync(output);
  const config = { productHead: release.productHead, productTree: release.productTree,
    methodSHA256, inputSHA256: sha256(inputBytes), schemaSHA256: sha256(fs.readFileSync(resolve(methodDirectory, 'schema.json'))) };
  return { input, release, method, config, output };
}
