import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const arg = name => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const output = resolve(arg('--output') || process.env.FRONTEND_EVIDENCE_DIR || resolve(repository, '.agent-output/background-raster-pixels'));
const fixtureDirectory = resolve(repository, 'frontend/tests/fixtures/background-raster');
const matrix = JSON.parse(await readFile(resolve(fixtureDirectory, 'matrix.json'), 'utf8'));
const baseline = await readFile(resolve(fixtureDirectory, 'spatial-canvas-baseline.txt'), 'utf8');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = async path => { try { await access(path); return true; } catch { return false; } };
const save = async (name, value) => writeFile(resolve(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const git = (...args) => execFileSync('git', ['--no-lazy-fetch', '-c', 'protocol.allow=never', ...args], { cwd: repository, encoding: 'utf8' }).trim();
const requiredFixtureFiles = [
  'frontend/tests/background-raster-browser-check.mjs', 'frontend/tests/background-raster-fixture.mjs',
  'frontend/tests/background-raster-fixture.html', 'frontend/tests/background-raster-browser.md',
  'frontend/tests/spatial-fixture.mjs', 'frontend/tests/fixtures/background-raster/matrix.json',
  'frontend/tests/fixtures/background-raster/spatial-canvas-baseline.txt', '.github/workflows/ci.yml',
];
const geometries = [
  ['G1', 1226, 684, 1, ['miss', 'hit']],
  ['G2', 980.5, 612.25, 1.25, ['fallback', 'fallback']],
  ['G3', 799.5, 600.25, 2, ['fallback', 'fallback']],
  ['G4', 980.25, 612.15, 1.25, ['miss', 'hit']],
];
assert.equal(sha256(baseline), matrix.baseline.sha256, '固定原renderer字节不可被候选改写');
assert.equal(matrix.baseline.sha256, '4500b595c27b6a99300471e5cbc2caaf3b708d3f9bdf0612655b720f0c324204');
assert.ok(baseline.includes('ObjectRasterCache') && !baseline.includes('BackgroundRasterCache'), '背景基线保留原对象缓存且不得导入新背景helper');
assert.deepEqual(matrix.geometries.map(g => [g.id, g.width, g.height, g.dpr, g.expected]), geometries);
assert.deepEqual(matrix.phases, ['first', 'repeat']); assert.deepEqual(matrix.stateByPhase, [0, 1]);
assert.equal(matrix.rendererCases.length, 2); assert.equal(matrix.sceneId, 'gaolao-courtyard');
assert.deepEqual(matrix.threshold, { rgbaDifferentBytes: 0, sourceImagesToBackgroundCache: 0 });
assert.equal(matrix.limits.pixelPairs, 8); assert.equal(matrix.limits.rendererPaintCalls, 16);
assert.equal(Object.keys(matrix.assets).length, 63); assert.equal(matrix.limits.retry, 0);

async function identity() {
  const commit = git('rev-parse', 'HEAD'), tree = git('rev-parse', 'HEAD^{tree}'), status = git('status', '--short');
  assert.equal(status, '', '背景像素输入必须对应干净冻结候选');
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
  for (const [path, expected] of Object.entries(matrix.catalogs)) assert.equal(sources[path], expected, '原图层/物件目录不得改变：' + path);
  for (const [path, expected] of Object.entries(matrix.assets).sort(([a], [b]) => a.localeCompare(b))) {
    assert.ok(path.startsWith('/assets/gaolaozhuang/') && !path.includes('..'), '只允许原public资产');
    const bytes = await readFile(resolve(repository, 'frontend/public', path.slice(1)));
    assets[path] = { bytes: bytes.length, sha256: sha256(bytes) };
    assert.equal(assets[path].bytes, expected.bytes, '原PNG字节数：' + path);
    assert.equal(assets[path].sha256, expected.sha256, '原PNG SHA：' + path);
  }
  assert.ok(sources['frontend/src/rendering/background-raster-cache.ts'], '先整合背景生产候选再冻结');
  return { commit, tree, status, sources, assets };
}
async function bounded(label, work, milliseconds) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + '超时')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

await mkdir(output, { recursive: true });
const current = await identity();
if (process.argv.includes('--freeze-only')) {
  assert.equal(arg('--manifest'), undefined, '冻结与执行不能合为一次操作');
  const path = resolve(output, 'input-manifest.json');
  assert.equal(await exists(path), false, '不得覆盖已冻结manifest；请使用新输出目录');
  await save('input-manifest.json', { schemaVersion: 1, source: current, matrix, baselineSha256: sha256(baseline), requiredPairs: 8, rendererPaintCalls: 16,
    command: 'node frontend/tests/background-raster-browser-check.mjs --manifest <本文件> --output <同一目录>', browserStarted: false });
  console.log(JSON.stringify({ status: 'FROZEN_NOT_RUN', manifest: path, source: current.commit, sourceFiles: Object.keys(current.sources).length, assets: Object.keys(current.assets).length, pairs: 8, rendererPaintCalls: 16 }));
} else {
  assert.ok(arg('--manifest'), '必须显式给出已独审冻结的 --manifest');
  assert.equal(resolve(arg('--manifest')), resolve(output, 'input-manifest.json'), '执行必须使用同一证据目录的原manifest');
  const manifestBytes = await readFile(resolve(arg('--manifest'))), manifest = JSON.parse(manifestBytes);
  assert.deepEqual(manifest.source, current, '冻结后源码、输入和资产不得变化');
  assert.deepEqual(manifest.matrix, matrix); assert.equal(manifest.baselineSha256, sha256(baseline));
  assert.equal(manifest.requiredPairs, 8); assert.equal(manifest.rendererPaintCalls, 16);
  assert.equal(await exists(resolve(output, 'result.json')), false, '不得覆盖原运行结果');
  await save('run-started.json', { startedAt: new Date().toISOString(), manifestSha256: sha256(manifestBytes), source: current.commit, retry: 0 });
  const report = { scope: matrix.scope, startedAt: new Date().toISOString(), manifestSha256: sha256(manifestBytes), source: current,
    pageErrors: [], consoleErrors: [], requestFailures: [], unexpectedAssets: [], droppedErrors: 0, cleanup: [], assessment: 'NOT_RUN' };
  const note = (list, value) => { if (report[list].length < 16) report[list].push(value); else report.droppedErrors++; };
  const servedAssets = new Set();
  let vite, browser, browserContext, page;
  const virtual = resolve(repository, 'frontend/src/rendering/__background-raster-baseline.ts');
  const favicon = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"></svg>';
  try {
    const { createServer } = await import('vite'), { chromium } = await import('playwright');
    vite = await createServer({ root: resolve(repository, 'frontend'), configFile: false, cacheDir: resolve(output, 'vite-cache'),
      // 原renderer文本保留原相对import；冷扫描器不把虚拟基线当实际文件读。
      optimizeDeps: { noDiscovery: true, include: [] },
      plugins: [{ name: 'frozen-background-raster-baseline', enforce: 'pre',
        resolveId(id) { if (id === '/src/rendering/__background-raster-baseline.ts' || id === virtual) return virtual; },
        load(id) { if (id === virtual) return baseline; },
        configureServer(server) { server.middlewares.use((request, response, next) => {
          const path = new URL(request.url, 'http://127.0.0.1').pathname;
          // 保持img-src self，favicon使用同源小SVG；CSP/console错误仍完整判失败。
          if (path === '/__background-raster-favicon.svg') { response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' }); response.end(favicon); return; }
          if (path.endsWith('.png')) {
            if (!Object.hasOwn(matrix.assets, path)) { note('unexpectedAssets', path); response.writeHead(403); response.end('不在冻结PNG清单'); return; }
            servedAssets.add(path);
          }
          next();
        }); },
      }],
      server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [repository] }, headers: { 'Content-Security-Policy': "img-src 'self'" } },
    });
    await bounded('Vite启动', () => vite.listen(), 10000);
    // 使用Playwright自身启动超时，避免外部race超时后失去迟到browser对象的归属。
    browser = await chromium.launch({ headless: true, timeout: 15000, executablePath: process.env.CHROMIUM_PATH, args: process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : [] });
    report.browserVersion = browser.version(); report.nodeVersion = process.version;
    browserContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    page = await browserContext.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => note('pageErrors', error.stack || error.message));
    page.on('console', message => { if (message.type() === 'error') note('consoleErrors', message.text()); });
    page.on('requestfailed', request => note('requestFailures', { url: request.url(), error: request.failure()?.errorText }));
    await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/tests/background-raster-fixture.html`);
    await page.waitForFunction(() => typeof window.backgroundRasterChecks?.run === 'function');
    await bounded('背景像素主体', () => page.evaluate(() => window.backgroundRasterChecks.run()), matrix.limits.bodyMs);
  } catch (error) { report.assessment = 'FAIL'; report.error = error.stack || String(error); }
  finally {
    if (page) {
      try {
        const collected = await bounded('页面证据收集', () => page.evaluate(() => {
          const entry = window.backgroundRasterChecks;
          return entry ? { evidence: entry.evidence(), failures: entry.failures() } : null;
        }), 5000);
        if (collected) {
          const failed = report.assessment === 'FAIL';
          const nodeCleanup = report.cleanup;
          const { startedAt, finishedAt, cleanup, ...evidence } = collected.evidence;
          Object.assign(report, evidence); report.pageTiming = { clock: 'performance.now', startedAt, finishedAt };
          report.cleanup = [...nodeCleanup, ...(cleanup || [])];
          if (failed) report.assessment = 'FAIL';
          assert.ok(collected.failures.length <= 1, '只保留首个真实像素差异的两张原PNG');
          report.failureImages = [];
          for (const failure of collected.failures) for (const [key, side] of [['A', 'baseline'], ['B', 'candidate']]) {
            assert.ok(failure[key].startsWith('data:image/png;base64,'));
            const bytes = Buffer.from(failure[key].slice('data:image/png;base64,'.length), 'base64'), name = `difference-0-${side}.png`;
            await writeFile(resolve(output, name), bytes, { flag: 'wx' });
            report.failureImages.push({ id: failure.id, side, file: name, bytes: bytes.length, sha256: sha256(bytes) });
          }
        } else { report.assessment = 'FAIL'; report.collectionError = '页面入口未安装'; }
      } catch (error) { report.assessment = 'FAIL'; report.collectionError = error.stack || String(error); }
    }
    for (const [name, resource, close] of [['context', browserContext, () => browserContext.close()], ['browser', browser, () => browser.close()], ['vite', vite, () => vite.close()]]) {
      if (!resource) { report.cleanup.push({ name, status: 'not_started' }); continue; }
      try { await bounded(name + '关闭', close, 5000); report.cleanup.push({ name, status: 'closed' }); }
      catch (error) { report.cleanup.push({ name, status: 'failed', error: String(error) }); report.assessment = 'FAIL'; }
    }
    report.servedAssets = [...servedAssets].sort();
    try {
      assert.equal(report.assessment, 'PASS', '页面完整结果必须PASS');
      assert.equal(report.pixelPairs, 8, '固定8对不能减少'); assert.equal(report.pixelRendererPaintCalls, 16);
      assert.deepEqual(report.notReached, []); assert.deepEqual(report.errors, []);
      assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.requestFailures, []);
      assert.deepEqual(report.unexpectedAssets, []); assert.equal(report.droppedErrors, 0);
      assert.deepEqual(report.servedAssets, Object.keys(matrix.assets).sort(), '必须真实请求全部原63 PNG且无额外图');
    } catch (error) { report.assessment = 'FAIL'; report.qualificationError = error.stack || String(error); }
    report.finishedAt = new Date().toISOString();
    try { report.sourceEnd = await identity(); assert.deepEqual(report.sourceEnd, report.source, '源码/输入/PNG首尾必须一致'); }
    catch (error) { report.assessment = 'FAIL'; report.sourceError = error.stack || String(error); }
    const bytes = Buffer.byteLength(JSON.stringify(report, null, 2) + '\n');
    if (bytes > matrix.limits.resultBytes) {
      const limited = { assessment: 'FAIL', scope: report.scope, error: '完整证据超过1MiB，不能解释为合格', fullResultBytes: bytes,
        manifestSha256: report.manifestSha256, sourceCommit: current.commit, cleanup: report.cleanup, finishedAt: report.finishedAt };
      await save('result.json', limited); report.assessment = 'FAIL';
    } else await save('result.json', report);
    console.log(JSON.stringify({ assessment: report.assessment, pairs: report.pixelPairs ?? 0, rendererPaintCalls: report.pixelRendererPaintCalls ?? 0,
      notReached: report.notReached, output: relative(repository, output), cleanup: report.cleanup }));
    if (report.assessment !== 'PASS') process.exitCode = 1;
  }
}
