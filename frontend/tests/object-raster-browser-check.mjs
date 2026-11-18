import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const arg = name => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const output = resolve(arg('--output') || process.env.FRONTEND_EVIDENCE_DIR || resolve(repository, '.agent-output/object-raster-pixels'));
const fixtureDirectory = resolve(repository, 'frontend/tests/fixtures/object-raster');
const matrix = JSON.parse(await readFile(resolve(fixtureDirectory, 'matrix.json'), 'utf8'));
const baseline = await readFile(resolve(fixtureDirectory, 'spatial-canvas-baseline.txt'), 'utf8');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const save = async (name, value) => writeFile(resolve(output, name), JSON.stringify(value, null, 2) + '\n');
const exists = async path => { try { await access(path); return true; } catch { return false; } };
const git = (...args) => execFileSync('git', ['--no-lazy-fetch', '-c', 'protocol.allow=never', ...args], { cwd: repository, encoding: 'utf8' }).trim();
const requiredFixtureFiles = ['frontend/tests/object-raster-browser-check.mjs', 'frontend/tests/object-raster-fixture.mjs', 'frontend/tests/object-raster-fixture.html', 'frontend/tests/object-raster-browser.md', 'frontend/tests/spatial-fixture.mjs', 'frontend/tests/fixtures/object-raster/matrix.json', 'frontend/tests/fixtures/object-raster/spatial-canvas-baseline.txt', '.github/workflows/ci.yml'];

assert.equal(sha256(baseline), matrix.baseline.sha256, '固定原renderer字节不可被候选改写');
assert.deepEqual(matrix.geometries.map(({ width, height, dpr }) => [width, height, dpr]), [[1226, 684, 1], [980.5, 612.25, 1.25], [799.5, 600.25, 2]]);
assert.equal(matrix.variants.length * matrix.geometries.length * matrix.phases.length, 42);
assert.equal(matrix.clips.length, 2); assert.equal(matrix.threshold.rgbaDifferentBytes, 0);
assert.deepEqual(matrix.phases, ['miss', 'hit']);
assert.ok(!baseline.includes('ObjectRasterCache'), '基线不能经过新helper');

async function identity() {
  const sources = {}, assets = {};
  async function collect(directory) {
    for (const entry of (await readdir(resolve(repository, directory), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = directory + '/' + entry.name;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      if (entry.isDirectory()) await collect(path);
      else if (/\.(mjs|ts|vue|css|json|html)$/.test(path)) sources[path] = sha256(await readFile(resolve(repository, path)));
    }
  }
  for (const directory of ['frontend/src', 'game', 'protocol', 'content']) await collect(directory);
  for (const path of [...requiredFixtureFiles, 'package.json', 'package-lock.json', 'frontend/package.json', 'frontend/package-lock.json']) sources[path] = sha256(await readFile(resolve(repository, path)));
  assert.equal(sources['frontend/src/assets/gaolao-object-art.json'], '91fd3f51937bd123e3d92d5021dc03cbd3fe4eaea3594f23904a305d2628904d', '原ObjectArt目录不得改变');
  assert.equal(sources['frontend/src/assets/gaolao-scene-layers.json'], 'b2ce86f27897f7fd437b3c4eab113a53ee89f2790dd7fef806dc793c9244e569', '原场景目录不得改变');
  const scenes = JSON.parse(await readFile(resolve(repository, 'frontend/src/assets/gaolao-scene-layers.json'), 'utf8'));
  const paths = new Set(matrix.variants.map(v => v.asset.file));
  for (const scene of Object.values(scenes)) for (const asset of [scene.base, ...scene.floors, ...scene.foreground, scene.replaceMask]) paths.add(asset.file);
  for (const path of [...paths].sort()) assets[path] = sha256(await readFile(resolve(repository, 'frontend/public', path.slice(1))));
  for (const variant of matrix.variants) assert.equal(assets[variant.asset.file], variant.sha256, '真实PNG必须与冻结矩阵一致');
  assert.ok(sources['frontend/src/rendering/object-raster-cache.ts'], '先整合实现候选再冻结');
  return { commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), status: git('status', '--short'), sources, assets };
}

await mkdir(output, { recursive: true });
const current = await identity();
if (process.argv.includes('--freeze-only')) {
  const path = resolve(output, 'input-manifest.json'); assert.equal(await exists(path), false, '不得覆盖已冻结manifest；请使用新输出目录');
  await save('input-manifest.json', { schemaVersion: 1, source: current, matrix, baselineSha256: sha256(baseline), requiredPairs: 42, requiredClips: 2,
    command: 'node frontend/tests/object-raster-browser-check.mjs --manifest <本文件> --output <同一目录>', browserStarted: false });
  console.log(JSON.stringify({ status: 'FROZEN_NOT_RUN', manifest: path, source: current.commit, sourceFiles: Object.keys(current.sources).length, assets: Object.keys(current.assets).length, pairs: 42, clips: 2 }));
} else {
  assert.ok(arg('--manifest'), '必须显式给出已独审冻结的 --manifest，不能边改输入边运行');
  const manifestBytes = await readFile(resolve(arg('--manifest'))), manifest = JSON.parse(manifestBytes);
  assert.deepEqual(manifest.source, current, '冻结后源码、输入和资产不得变化');
  assert.deepEqual(manifest.matrix, matrix); assert.equal(manifest.baselineSha256, sha256(baseline));
  assert.equal(await exists(resolve(output, 'result.json')), false, '不得覆盖原运行结果或自动重跑');
  const report = { scope: matrix.scope, startedAt: new Date().toISOString(), manifestSha256: sha256(manifestBytes), source: current, pageErrors: [], cleanup: [], assessment: 'NOT_RUN' };
  let vite, browser, browserContext;
  try {
    const { createServer } = await import('vite'), { chromium } = await import('playwright');
    const virtual = resolve(repository, 'frontend/src/rendering/__object-raster-baseline.ts');
    vite = await createServer({ root: resolve(repository, 'frontend'), configFile: false, cacheDir: resolve(output, 'vite-cache'),
      // 此夹具只消费本地ESM；原renderer由load提供，不让冷启动扫描器把虚拟路径当磁盘文件读取。
      optimizeDeps: { noDiscovery: true, include: [] },
      plugins: [{ name: 'frozen-object-raster-baseline', enforce: 'pre', resolveId(id) { if (id === '/src/rendering/__object-raster-baseline.ts' || id === virtual) return virtual; }, load(id) { if (id === virtual) return baseline; } }],
      server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] } } });
    await vite.listen();
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : [] });
    report.browserVersion = browser.version(); report.nodeVersion = process.version;
    browserContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await browserContext.newPage(); page.on('pageerror', error => report.pageErrors.push(error.stack || error.message));
    page.setDefaultTimeout(15000);
    await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/tests/object-raster-fixture.html`);
    await page.waitForFunction(() => typeof window.runObjectRasterChecks === 'function');
    const result = await page.evaluate(() => window.runObjectRasterChecks());
    const failures = result.failures; delete result.failures; Object.assign(report, result);
    report.failureImages = [];
    for (let i = 0; i < failures.length; i++) for (const side of ['baseline', 'candidate']) {
      const bytes = Buffer.from(failures[i][side].split(',')[1], 'base64'), name = `difference-${i}-${side}.png`;
      await writeFile(resolve(output, name), bytes); report.failureImages.push({ id: failures[i].id, side, file: name, sha256: sha256(bytes) });
    }
    assert.equal(report.pixelPairs, 42, '42对不能被skip或夹具错误减少');
    assert.deepEqual(report.pageErrors, [], '真实页面不得有未处理异常');
  } catch (error) { report.assessment = 'FAIL'; report.error = error.stack; }
  finally {
    for (const [name, resource, close] of [['context', browserContext, () => browserContext.close()], ['browser', browser, () => browser.close()], ['vite', vite, () => vite.close()]]) {
      if (!resource) { report.cleanup.push({ name, status: 'not_started' }); continue; }
      try { await close(); report.cleanup.push({ name, status: 'closed' }); } catch (error) { report.cleanup.push({ name, status: 'failed', error: String(error) }); report.assessment = 'FAIL'; }
    }
    report.finishedAt = new Date().toISOString(); report.sourceEnd = await identity();
    try { assert.deepEqual(report.sourceEnd, report.source); } catch (error) { report.assessment = 'FAIL'; report.sourceMismatch = error.message; }
    await save('result.json', report);
    console.log(JSON.stringify({ assessment: report.assessment, pairs: report.pixelPairs ?? 0, failedRows: report.rows?.filter(r => r.status !== 'PASS').map(r => r.id), output: relative(repository, output), cleanup: report.cleanup }));
    if (report.assessment !== 'PASS') process.exitCode = 1;
  }
}
