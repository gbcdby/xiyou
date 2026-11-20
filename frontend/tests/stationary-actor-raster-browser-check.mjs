// S-A1：先冻结同一候选，再单次读取真实 Chromium 像素；不连接 PG 或游戏动作端。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { relative, resolve } from 'node:path';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const argv = process.argv.slice(2), options = {};
for (let index = 0; index < argv.length; index++) {
  const name = argv[index];
  assert.ok(['--freeze-only', '--manifest', '--output'].includes(name), '未知参数：' + name);
  assert.equal(Object.hasOwn(options, name), false, '参数不得重复：' + name);
  if (name === '--freeze-only') options[name] = true;
  else { const value = argv[++index]; assert.ok(value && !value.startsWith('--'), '参数缺少值：' + name); options[name] = value; }
}
assert.ok(options['--freeze-only'] ? !options['--manifest'] : options['--manifest'], '冻结和执行必须分开，执行必须指定原 manifest');
const output = resolve(options['--output'] || process.env.FRONTEND_EVIDENCE_DIR || resolve(repository, '.agent-output/stationary-actor-raster-pixels'));
const fixtureDirectory = resolve(repository, 'frontend/tests/fixtures/stationary-actor-raster');
const matrixBytes = await readFile(resolve(fixtureDirectory, 'matrix.json')), matrix = JSON.parse(matrixBytes);
const baseline = await readFile(resolve(fixtureDirectory, 'spatial-canvas-baseline.txt'), 'utf8');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = async path => { try { await access(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const save = async (name, value) => writeFile(resolve(output, name), JSON.stringify(value) + '\n', { flag: 'wx' });
const git = (...args) => execFileSync('git', ['--no-lazy-fetch', '-c', 'protocol.allow=never', ...args], { cwd: repository, encoding: 'utf8' }).trim();
const requiredFiles = [
  'frontend/tests/stationary-actor-raster-browser-check.mjs', 'frontend/tests/stationary-actor-raster-browser.md',
  'frontend/tests/stationary-actor-raster-fixture.mjs', 'frontend/tests/stationary-actor-raster-fixture.html',
  'frontend/tests/fixtures/stationary-actor-raster/matrix.json', 'frontend/tests/fixtures/stationary-actor-raster/spatial-canvas-baseline.txt',
  'frontend/tests/spatial-fixture.mjs', '.github/workflows/ci.yml',
  'package.json', 'package-lock.json', 'frontend/package.json', 'frontend/package-lock.json',
];
const runArtifacts = ['run-started.json', 'result.json', 'result-meta.json', 'difference-0-baseline.png', 'difference-0-candidate.png'];
const expectedPixels = matrix.geometries.flatMap(g => matrix.variants.flatMap(v => matrix.phases.map(phase => g.id + '/' + v.id + '/' + phase)));
const browserArgs = process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : [];
assert.ok(Array.isArray(browserArgs) && browserArgs.every(value => typeof value === 'string'), 'CHROMIUM_ARGS 必须为字符串数组');
const runtime = { node: process.version, chromiumPath: process.env.CHROMIUM_PATH || null, chromiumArgs: browserArgs };

assert.equal(sha256(matrixBytes), '4a2472ffeccbce4b14fbc21aae30f7edf375522fa043d82baf5c4c71eb17279e', '只使用已固定的 S-A1 矩阵');
assert.equal(sha256(baseline), matrix.baseline.sha256);
assert.equal(matrix.baseline.sha256, '7a772e93e8922eea59aa64117d19e6c868aa91ecc05c1514f8b1d84c5cb0cb04');
assert.equal(matrix.candidateRendererSha256, '80e0c31e05257a36b657b9d83f0fcc6fc921949d71a2ce05e0b9ef204179cb3d');
assert.ok(baseline.includes('ObjectRasterCache') && baseline.includes('BackgroundRasterCache'), 'A 保留当前原两种缓存');
assert.deepEqual(matrix.geometries.map(g => [g.width, g.height, g.dpr]), [[1226, 684, 1], [980.5, 612.25, 1.25], [799.5, 600.25, 2]]);
assert.deepEqual(matrix.variants.map(v => v.facing), ['S', 'SE', 'E', 'NE', 'N']);
assert.deepEqual(matrix.phases, ['miss', 'hit']);
assert.equal(expectedPixels.length, 30); assert.equal(new Set(expectedPixels).size, 30);
assert.equal(matrix.threshold.requiredPixelPairs, 30); assert.equal(matrix.threshold.rgbaDifferentBytes, 0);
assert.equal(matrix.threshold.allThirtyBeforeRenderer, true); assert.equal(matrix.threshold.requireObservedCache, true);
assert.equal(matrix.rendererPairIds.length, 23); assert.equal(new Set(matrix.rendererPairIds).size, 23);
assert.deepEqual(matrix.postRows, ['renderer-clear', 'renderer-dispose']);
assert.equal(matrix.limits.rendererPaintCalls, 46); assert.ok(matrix.limits.rendererPaintCalls <= 64); assert.equal(matrix.limits.rendererPaintCallsMaximum, 64);
assert.equal(Object.keys(matrix.assets).length, 54); assert.equal(matrix.limits.originalPNG, 54);
assert.equal(matrix.limits.resultBytes, 1_048_576); assert.equal(matrix.limits.failureImagePairs, 1);
assert.equal(matrix.limits.bodyMs, 90000); assert.equal(matrix.limits.outerSeconds, 120);
assert.equal(matrix.limits.termSeconds, 10); assert.equal(matrix.limits.killSeconds, 2); assert.equal(matrix.limits.retry, 0);
assert.deepEqual(matrix.browser, { viewport: { width: 2600, height: 1100 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });

async function identity() {
  // 先收实际值，资格另判；末端脏树也保留真实 sourceEnd，不能只留下一个断言。
  const commit = git('rev-parse', 'HEAD'), tree = git('rev-parse', 'HEAD^{tree}'), status = git('status', '--porcelain=v1', '--untracked-files=all');
  const sources = {}, assets = {};
  async function collect(directory) {
    for (const entry of (await readdir(resolve(repository, directory), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const path = directory + '/' + entry.name;
      if (entry.isDirectory()) await collect(path);
      else if (/\.(mjs|ts|vue|css|json|html)$/.test(path)) sources[path] = sha256(await readFile(resolve(repository, path)));
    }
  }
  for (const directory of ['frontend/src', 'game', 'protocol', 'content']) await collect(directory);
  for (const path of requiredFiles) sources[path] = sha256(await readFile(resolve(repository, path)));
  for (const path of Object.keys(matrix.assets).sort()) {
    assert.ok(path.startsWith('/assets/gaolaozhuang/') && path.endsWith('.png') && !path.includes('..'), '只允许冻结的本地原 PNG');
    const bytes = await readFile(resolve(repository, 'frontend/public', path.slice(1)));
    assets[path] = { bytes: bytes.length, sha256: sha256(bytes) };
  }
  return { commit, tree, status, sources, assets };
}
function qualifyIdentity(value) {
  assert.equal(value.status, '', '必须先提交完整检查候选并保持 clean');
  assert.equal(value.sources['frontend/src/rendering/spatial-canvas.ts'], matrix.candidateRendererSha256);
  for (const [path, expected] of Object.entries(matrix.unchangedSources)) assert.equal(value.sources[path], expected, '保护来源必须原样：' + path);
  for (const [path, expected] of Object.entries(matrix.assets)) assert.deepEqual(value.assets[path], { bytes: expected.bytes, sha256: expected.sha256 }, 'PNG 原件必须匹配：' + path);
}
async function bounded(label, work, milliseconds) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + '超时')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
function exactPixels(value) {
  assert.ok(value && Number.isSafeInteger(value.width) && value.width > 0 && Number.isSafeInteger(value.height) && value.height > 0, '实际比较尺寸');
  assert.equal(value.comparedBytes, value.width * value.height * 4, '必须比较完整 RGBA');
  assert.equal(value.differentBytes, 0); assert.equal(value.differentPixels, 0); assert.equal(value.maximumDifference, 0);
  assert.deepEqual(value.first, []); assert.match(value.A, /^[a-f0-9]{64}$/); assert.equal(value.A, value.B);
}
function qualifyFixture(value) {
  assert.ok(value && typeof value === 'object', '必须取到原页面证据');
  assert.equal(value.schemaVersion, 1); assert.equal(value.scope, matrix.scope); assert.deepEqual(value.limits, matrix.limits);
  assert.equal(value.assessment, 'PASS'); assert.equal(value.stage1, 'PASS'); assert.equal(value.stage2, 'PASS');
  assert.equal(value.pixelPairs, 30); assert.deepEqual(value.pixelRows.map(row => row.id), expectedPixels);
  for (const row of value.pixelRows) {
    assert.equal(row.status, 'PASS'); assert.deepEqual(row.errors, []); assert.equal(row.usedCache, true);
    assert.ok(row.cache && typeof row.cache === 'object', '必须有真实 cache 链路记录'); exactPixels(row.pixels);
    const geometry = matrix.geometries.find(g => g.id === row.geometry);
    assert.ok(geometry); assert.equal(row.pixels.width, Math.round(geometry.width * geometry.dpr)); assert.equal(row.pixels.height, Math.round(geometry.height * geometry.dpr));
    for (const format of [row.formatA, row.formatB]) {
      assert.equal(format.alpha, true); assert.equal(format.colorSpace, 'srgb'); assert.equal(format.colorType, 'unorm8');
      assert.equal(format.desynchronized, false); assert.equal(format.willReadFrequently, false);
    }
  }
  assert.equal(value.rendererPaintCalls, 46); assert.ok(value.rendererPaintCalls <= 64);
  assert.deepEqual(value.rendererRows.map(row => row.id), matrix.rendererPairIds);
  for (const row of value.rendererRows) {
    assert.equal(row.status, 'PASS'); exactPixels(row.pixels); assert.equal(row.frameComparedBoth, true);
    assert.equal(sha256(JSON.stringify(row.frame)), row.frameSha256, '保存完整实际 frame');
    for (const side of ['A', 'B']) {
      const owner = row.owner[side]; assert.equal(owner.beforeFrontWrites, 1); assert.equal(owner.frontWrites, 1);
      assert.equal(owner.serial, row.frame.serial); assert.equal(owner.ownerAccepted, row.id !== 'moving-s');
      for (const key of ['sealAt', 'sampledAt', 'presentedAt', 'creditMs']) assert.ok(Number.isFinite(owner[key]) && owner[key] >= 0, '原呈现时点/信用必须有限：' + key);
    }
  }
  assert.deepEqual(value.postRows.map(row => row.id), matrix.postRows); assert.ok(value.postRows.every(row => row.status === 'PASS'));
  assert.deepEqual(value.errors, []); assert.deepEqual(value.notReached, []);
  assert.ok(Number.isFinite(value.startedAt) && Number.isFinite(value.finishedAt) && value.finishedAt >= value.startedAt);
  assert.ok(value.finishedAt - value.startedAt <= matrix.limits.bodyMs, '页面实际主体完成必须在原90秒预算内');
  assert.ok(Number.isSafeInteger(value.observedCanvases) && value.observedCanvases > 0 && value.observedCanvases <= matrix.limits.observedCanvasMaximum);
  assert.ok(Array.isArray(value.cleanup) && !value.cleanup.some(row => row.status === 'failed'));
  assert.ok(value.cleanup.some(row => row.name === 'observed-backings' && row.status === 'released' && row.live === 0));
  for (const side of ['A', 'B']) assert.ok(value.cleanup.some(row => row.name === 'renderer-' + side && row.status === 'disposed'));
  assert.deepEqual(value.resources.map(row => row.file).sort(), Object.keys(matrix.assets).sort());
  for (const resource of value.resources) {
    assert.equal(resource.status, 'ready'); assert.equal(resource.width, matrix.assets[resource.file].width); assert.equal(resource.height, matrix.assets[resource.file].height);
  }
}

await mkdir(output, { recursive: true });
for (const name of runArtifacts) assert.equal(await exists(resolve(output, name)), false, '原运行产物已存在，禁止重跑：' + name);
const current = await identity(); qualifyIdentity(current);
if (options['--freeze-only']) {
  await save('input-manifest.json', { schemaVersion: 1, source: current, runtime, matrix, matrixSha256: sha256(matrixBytes),
    baselineSha256: sha256(baseline), requiredPixelPairs: 30, rendererPairs: 23, rendererPaintCalls: 46, rendererPaintCallsMaximum: 64,
    command: 'node frontend/tests/stationary-actor-raster-browser-check.mjs --manifest <本文件> --output <同一目录>',
    browserStarted: false, frozenAt: new Date().toISOString() });
  console.log(JSON.stringify({ status: 'FROZEN_NOT_RUN', manifest: resolve(output, 'input-manifest.json'), source: current.commit, sourceFiles: Object.keys(current.sources).length, assets: Object.keys(current.assets).length }));
} else {
  assert.equal(resolve(options['--manifest']), resolve(output, 'input-manifest.json'), '执行必须使用同一目录的原 manifest');
  const manifestBytes = await readFile(resolve(options['--manifest'])), manifest = JSON.parse(manifestBytes), manifestSha256 = sha256(manifestBytes);
  assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.browserStarted, false);
  assert.deepEqual(manifest.source, current); assert.deepEqual(manifest.runtime, runtime); assert.deepEqual(manifest.matrix, matrix);
  assert.equal(manifest.matrixSha256, sha256(matrixBytes)); assert.equal(manifest.baselineSha256, sha256(baseline));
  assert.equal(manifest.requiredPixelPairs, 30); assert.equal(manifest.rendererPairs, 23); assert.equal(manifest.rendererPaintCalls, 46); assert.equal(manifest.rendererPaintCallsMaximum, 64);
  const startedAt = new Date().toISOString();
  await save('run-started.json', { startedAt, manifestSha256, source: current.commit, retry: 0 });
  const report = { schemaVersion: 1, scope: matrix.scope, startedAt, manifestSha256, source: current, runtime,
    assessment: 'NOT_RUN', fixture: null, pixelPairs: 0, rendererPaintCalls: 0, pageErrors: [], consoleErrors: [],
    requestFailures: [], unexpectedAssets: [], droppedErrors: 0, nodeErrors: [], cleanup: [], failureImages: [] };
  const note = (list, value) => { if (report[list].length < 16) report[list].push(value); else report.droppedErrors++; };
  const fail = (stage, error) => { note('nodeErrors', { stage, error: error?.stack || String(error) }); report.assessment = 'FAIL'; };
  const servedAssets = new Set();
  let vite, browser, browserContext, page, runPromise, runSettled = false;
  const virtual = resolve(repository, 'frontend/src/rendering/__stationary-actor-raster-baseline.ts');
  const favicon = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"></svg>';
  try {
    const { createServer } = await import('vite'), { chromium } = await import('playwright');
    vite = await createServer({ root: resolve(repository, 'frontend'), configFile: false, cacheDir: resolve(output, 'vite-cache'),
      optimizeDeps: { noDiscovery: true, include: [] },
      plugins: [{ name: 'frozen-stationary-actor-raster-baseline', enforce: 'pre',
        resolveId(id) { if (id === '/src/rendering/__stationary-actor-raster-baseline.ts' || id === virtual) return virtual; },
        load(id) { if (id === virtual) return baseline; },
        configureServer(server) { server.middlewares.use((request, response, next) => {
          const path = new URL(request.url, 'http://127.0.0.1').pathname;
          if (path === '/__stationary-actor-raster-favicon.svg') { response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' }); response.end(favicon); return; }
          if (path.endsWith('.png')) {
            if (!Object.hasOwn(matrix.assets, path)) { note('unexpectedAssets', path); response.writeHead(403); response.end('不在冻结 PNG 清单'); return; }
            servedAssets.add(path);
          }
          next();
        }); },
      }],
      server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [repository] }, headers: { 'Content-Security-Policy': "img-src 'self'" } },
    });
    await bounded('Vite 启动', () => vite.listen(), 10000);
    browser = await chromium.launch({ headless: true, timeout: 15000, executablePath: runtime.chromiumPath || undefined, args: runtime.chromiumArgs });
    report.browserVersion = browser.version(); browserContext = await browser.newContext(matrix.browser);
    page = await browserContext.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => note('pageErrors', error.stack || error.message));
    page.on('console', message => { if (message.type() === 'error') note('consoleErrors', message.text()); });
    page.on('requestfailed', request => note('requestFailures', { url: request.url(), error: request.failure()?.errorText }));
    await page.goto('http://127.0.0.1:' + vite.httpServer.address().port + '/tests/stationary-actor-raster-fixture.html');
    await page.waitForFunction(() => typeof window.stationaryActorRasterChecks?.run === 'function');
    runPromise = page.evaluate(() => window.stationaryActorRasterChecks.run()).then(value => { runSettled = true; return value; }, error => { runSettled = true; throw error; });
    await bounded('站姿像素主体', () => runPromise, matrix.limits.bodyMs);
  } catch (error) { fail('run', error); }
  finally {
    if (page) {
      try { await bounded('关闭新行准入', () => page.evaluate(() => window.stationaryActorRasterChecks?.cancel()), 2000); }
      catch (error) { fail('cancel', error); }
      if (runPromise && !runSettled) {
        try { await bounded('原主体收束', () => runPromise, 3000); } catch (error) { fail('settle', error); }
      }
      try {
        const collected = await bounded('页面原证据收集', () => page.evaluate(() => {
          const entry = window.stationaryActorRasterChecks;
          return entry ? { evidence: entry.evidence(), failures: entry.failures() } : null;
        }), 5000);
        assert.ok(collected, '页面入口未安装');
        report.fixture = collected.evidence; report.pixelPairs = collected.evidence.pixelPairs; report.rendererPaintCalls = collected.evidence.rendererPaintCalls;
        assert.ok(Array.isArray(collected.failures) && collected.failures.length <= 1, '只保留首个差异的两张原 PNG');
        for (const failure of collected.failures) for (const [key, side] of [['A', 'baseline'], ['B', 'candidate']]) {
          assert.match(failure[key], /^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/);
          const bytes = Buffer.from(failure[key].slice('data:image/png;base64,'.length), 'base64'), name = 'difference-0-' + side + '.png';
          assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', '保存原 PNG，不能替换或重绘');
          await writeFile(resolve(output, name), bytes, { flag: 'wx' });
          report.failureImages.push({ id: failure.id, side, file: name, bytes: bytes.length, sha256: sha256(bytes) });
        }
      } catch (error) { fail('collection', error); }
    }
    report.pageRunSettled = runSettled;
    for (const [name, resource, close] of [
      ['page', page, () => page.close()], ['context', browserContext, () => browserContext.close()],
      ['browser', browser, () => browser.close()], ['vite', vite, () => vite.close()],
    ]) {
      if (!resource) { report.cleanup.push({ name, status: 'not_started' }); continue; }
      try { await bounded(name + '关闭', close, 5000); report.cleanup.push({ name, status: 'closed' }); }
      catch (error) { report.cleanup.push({ name, status: 'failed', error: String(error) }); fail('cleanup-' + name, error); }
    }
    report.servedAssets = [...servedAssets].sort();
    try {
      qualifyFixture(report.fixture);
      assert.equal(report.pageRunSettled, true); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []);
      assert.deepEqual(report.requestFailures, []); assert.deepEqual(report.unexpectedAssets, []); assert.equal(report.droppedErrors, 0);
      assert.deepEqual(report.servedAssets, Object.keys(matrix.assets).sort(), '必须实际请求全部54张原PNG');
      assert.deepEqual(report.cleanup.map(row => [row.name, row.status]), [['page', 'closed'], ['context', 'closed'], ['browser', 'closed'], ['vite', 'closed']]);
    } catch (error) { fail('qualification', error); }
    try {
      report.sourceEnd = await identity(); qualifyIdentity(report.sourceEnd); assert.deepEqual(report.sourceEnd, report.source, '来源首尾必须相同');
      report.manifestEndSha256 = sha256(await readFile(resolve(options['--manifest']))); assert.equal(report.manifestEndSha256, manifestSha256);
    } catch (error) { fail('source-end', error); }
    report.finishedAt = new Date().toISOString();
    report.assessment = report.nodeErrors.length === 0 && report.droppedErrors === 0 ? 'PASS' : 'FAIL';
    let text = JSON.stringify(report) + '\n', bytes = Buffer.byteLength(text);
    if (bytes > matrix.limits.resultBytes) {
      report.assessment = 'FAIL';
      report.outputLimit = { limit: matrix.limits.resultBytes, measuredBytesBeforeFlag: bytes, completeEvidencePreserved: true };
      text = JSON.stringify(report) + '\n'; bytes = Buffer.byteLength(text);
    }
    // 超限仍保存同一完整原件并判 FAIL；不得用小摘要替换已采30对或后段记录。
    await writeFile(resolve(output, 'result.json'), text, { flag: 'wx' });
    await save('result-meta.json', { bytes, sha256: sha256(text), limit: matrix.limits.resultBytes, exceeded: bytes > matrix.limits.resultBytes, assessment: report.assessment, completeEvidencePreserved: true });
    console.log(JSON.stringify({ assessment: report.assessment, pixelPairs: report.pixelPairs, rendererPaintCalls: report.rendererPaintCalls,
      stage1: report.fixture?.stage1 ?? null, stage2: report.fixture?.stage2 ?? null, notReached: report.fixture?.notReached?.length ?? null,
      resultBytes: bytes, output: relative(repository, output), cleanup: report.cleanup }));
    if (report.assessment !== 'PASS') process.exitCode = 1;
  }
}
