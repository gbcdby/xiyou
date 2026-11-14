import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { preview } from 'vite';
import { chromium } from 'playwright';
import { repository, sourceIdentity, saveJSON } from './network-support.mjs';

const output = resolve(process.env.FRONTEND_EVIDENCE_DIR || resolve(repository, '.agent-output/visual-recovery/runtime-assets'));
const manifest = JSON.parse(await readFile(resolve(repository, 'frontend/runtime-assets.json'), 'utf8'));
const report = { scope: '恢复候选作者自查：干净Git构建的真实HTTP响应与Chromium PNG解码，不代替全章节运行', source: await sourceIdentity(), startedAt: new Date().toISOString(), assets: [] };
let previewServer, browser;
try {
  assert.equal(report.source.status, '', '运行资产交付检查须从干净Git候选执行');
  report.trackedPng = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', 'frontend/public/assets/gaolaozhuang'], { cwd: repository, encoding: 'utf8' }).trim().split('\n').filter(file => file.endsWith('.png'));
  assert.deepEqual(report.trackedPng.map(file => file.replace('frontend/public/assets/gaolaozhuang/', '')).sort(), manifest.files.map(file => file.file).sort(), 'Git须完整交付清单中的全部运行图像');
  previewServer = await preview({ root: resolve(repository, 'frontend'), configFile: resolve(repository, 'frontend/vite.config.mjs'), configLoader: 'native', preview: { host: '127.0.0.1', port: 0 } });
  const baseURL = `http://127.0.0.1:${previewServer.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: [] }); report.browserVersion = browser.version();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }); await page.goto(baseURL + '/assets/gaolaozhuang/scenes/courtyard.png');
  for (const expected of manifest.files) {
    const actual = await page.evaluate(async file => {
      const url = '/assets/gaolaozhuang/' + file, response = await fetch(url), buffer = await response.arrayBuffer();
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      const image = new Image(); image.src = url; await image.decode();
      return { file, status: response.status, type: response.headers.get('content-type'), bytes: buffer.byteLength, sha256: digest, width: image.naturalWidth, height: image.naturalHeight, decoded: image.complete };
    }, expected.file);
    report.assets.push(actual); assert.equal(actual.status, 200); assert.match(actual.type, /^image\/png/); assert.equal(actual.decoded, true);
    for (const key of ['bytes', 'sha256', 'width', 'height']) assert.equal(actual[key], expected[key], expected.file + ' 实际加载值保持：' + key);
  }
  report.sourceEnd = await sourceIdentity(); assert.deepEqual(report.sourceEnd, report.source); report.assessment = 'PASS';
} catch (error) { report.assessment = 'FAIL'; report.error = error.stack; console.error(error); }
finally { await browser?.close(); await new Promise(resolveClose => previewServer ? previewServer.httpServer.close(resolveClose) : resolveClose()); report.finishedAt = new Date().toISOString(); await saveJSON(resolve(output, 'result.json'), report); console.log(JSON.stringify({ assessment: report.assessment, decodedPng: report.assets.length, output })); if (report.assessment !== 'PASS') process.exitCode = 1; }
