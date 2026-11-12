import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import { spatialSnapshot } from './spatial-fixture.mjs';

// 使用真实页面、Socket.IO 客户端和 sessionStorage；服务端仅为可控收据替身，不代表权威规则验收。
const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(process.env.FRONTEND_EVIDENCE_DIR || `${root}/../.agent-output/adv001-a1-repairs/browser-retention`);
await mkdir(output, { recursive: true });
const receipts = new Map(); const queries = []; const wires = []; const unknownIds = [];
let unknown = true; let epoch = 2; let allowRetry = false;
const server = createServer((request, response) => {
  const id = /\/actions\/([^/?]+)/.exec(request.url)?.[1];
  if (id) queries.push(id);
  const receipt = id && receipts.get(id);
  response.writeHead(receipt ? 200 : 404, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(receipt || { schemaVersion: 2, code: 'OUTCOME_UNKNOWN', message: '受控故障：尚未查到确认。' }));
});
const io = new Server(server);
io.on('connection', socket => {
  socket.on('session.subscribe', (_value, acknowledge) => { const snapshot = spatialSnapshot(); snapshot.projection.self.canControl = false; acknowledge(snapshot); });
  for (const type of ['control.resume', 'control.take']) socket.on(type, (raw, acknowledge) => {
    const request = JSON.parse(raw); const snapshot = spatialSnapshot();
    snapshot.viewId = `retention-view-${++epoch}`; snapshot.projection.self.controlEpoch = String(epoch);
    acknowledge({ schemaVersion: 2, sessionId: request.sessionId, nonce: request.nonce, controlEpoch: String(epoch), observedSeq: snapshot.snapshotSeq, snapshot });
  });
  socket.on('sync.request', (raw, acknowledge) => {
    const request = JSON.parse(raw);
    acknowledge({ schemaVersion: 2, type: 'world.batch', sessionId: request.sessionId, viewId: request.viewId, fromExclusive: request.cursor, throughSeq: request.cursor, events: [] });
  });
  socket.on('player.action.request', (raw, acknowledge) => {
    wires.push(raw); const request = JSON.parse(raw);
    if (unknown && !allowRetry) {
      unknownIds.push(request.clientActionId);
      acknowledge({ schemaVersion: 2, code: 'OUTCOME_UNKNOWN', message: '受控故障：确认暂未返回。' }); return;
    }
    const receipt = { schemaVersion: 2, sessionId: request.sessionId, clientActionId: request.clientActionId, status: 'Accepted', code: 'NO_CHANGE', observedSeq: '10', actionEventRange: null, result: {} };
    receipts.set(request.clientActionId, receipt); acknowledge(receipt);
  });
});
let vite; let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const backend = `http://127.0.0.1:${server.address().port}`;
  vite = await createViteServer({ root, cacheDir: `${output}/vite-cache`, server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: backend }, '/socket.io': { target: backend, ws: true } } }, logLevel: 'error' });
  await vite.listen();
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
  const args = process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : [];
  browser = await chromium.launch({ headless: true, args, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => sessionStorage.setItem('xiyou.guest.v1', JSON.stringify({ token: 'retention-fixture', userId: 'retention-user', name: '保留检查' })));
  await page.goto(`${vite.resolvedUrls.local[0]}spatial/spatial-room`);
  const readStore = () => page.evaluate(async () => { window.retentionStore = await import('/src/state/spatial-store.ts'); });
  await readStore();
  await page.getByRole('button', { name: '恢复本人控制' }).click();
  await page.waitForFunction(() => window.retentionStore.spatialState.value.inputReady);
  const sendWaits = count => page.evaluate(async count => {
    const { spatialClient } = await import('/src/state/spatial-store.ts');
    for (let index = 0; index < count; index++) await spatialClient.send({ kind: 'wait' });
  }, count);
  await sendWaits(1); const original = wires[0]; const originalId = JSON.parse(original).clientActionId;
  unknown = false; await sendWaits(8);
  assert.equal(await page.getByRole('button', { name: '查询结果', exact: true }).count(), 1, '八条已确认历史之后，旧未知动作仍有查询入口');
  assert.equal(await page.getByRole('button', { name: '原样重试', exact: true }).count(), 1);
  await page.getByRole('button', { name: '查询结果', exact: true }).click();
  await page.waitForFunction(() => window.retentionStore.spatialState.value.actions.some(action => action.detail === '尚未查到收据，可原样重试。'));
  assert.ok(queries.includes(originalId));
  unknown = true; await sendWaits(80); unknown = false; await sendWaits(82);
  assert.equal(await page.getByRole('button', { name: '查询结果', exact: true }).count(), 81, '全部未决动作可访问');
  const storageKey = 'xiyou.spatial-actions.v2:retention-user:spatial-room';
  const saved = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), storageKey);
  assert.equal(saved.find(action => action.id === originalId)?.raw, original, '真实 store 写入的缓存保留原请求');
  assert.deepEqual(saved.filter(action => action.status === 'unknown').map(action => action.id), unknownIds);
  assert.ok(saved.filter(action => action.receipt).length <= 80);
  await page.reload();
  await readStore();
  await page.waitForFunction(() => {
    const pending = window.retentionStore.spatialState.value.actions.filter(action => action.status === 'unknown');
    return pending.length === 81 && pending.every(action => action.detail === '尚未查到收据，可原样重试。');
  });
  assert.deepEqual(unknownIds.filter(id => !queries.includes(id)), [], '恢复时逐个查询所有未知动作');
  await page.getByRole('button', { name: '明确接管此角色' }).click();
  await page.waitForFunction(() => window.retentionStore.spatialState.value.inputReady);
  const resumedEpoch = await page.evaluate(() => window.retentionStore.spatialState.value.snapshot.projection.self.controlEpoch);
  assert.notEqual(resumedEpoch, JSON.parse(original).controlEpoch, '本次恢复已经进入新的控制周期');
  const row = page.locator(`[data-action-id="${originalId}"]`);
  await row.getByRole('button', { name: '查询结果', exact: true }).click();
  allowRetry = true;
  const beforeRetry = wires.length;
  await row.getByRole('button', { name: '原样重试', exact: true }).click();
  await page.waitForFunction(id => {
    const action = window.retentionStore.spatialState.value.actions.find(action => action.id === id);
    // 取得确定收据后，最早的已确认历史可以被裁出。
    return !action || action.status === 'accepted';
  }, originalId);
  assert.deepEqual(wires.slice(beforeRetry), [original], '页面按钮在新控制周期仍发送字节完全相同的原请求');
  assert.equal(receipts.get(originalId)?.status, 'Accepted');
  assert.equal(await page.getByRole('button', { name: '查询结果', exact: true }).count(), 80);
  assert.deepEqual(errors, []);
  await page.locator('.spatial-receipts').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/pending-actions.png` });
  const report = { passed: true, scope: '真实页面、Socket.IO 和 sessionStorage；可控收据替身', unknownBeforeReload: unknownIds.length, confirmedHistory: saved.filter(action => action.receipt).length, restoredOriginalRetry: wires.at(-1) === original, pageErrors: errors, browserVersion: browser.version() };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close(); await vite?.close();
  await new Promise(resolve => io.close(resolve));
  if (server.listening) await new Promise(resolve => server.close(resolve));
}
