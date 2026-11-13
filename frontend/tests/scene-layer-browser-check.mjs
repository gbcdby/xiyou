import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer as createVite } from 'vite';
import { chromium } from 'playwright';
import { startTestPostgres } from '../../backend/test-support/postgres.mjs';
import { createAuthorityServer } from '../../backend/server.mjs';
import { accepted, take } from '../../backend/test-support/gaolao-room.mjs';
import { browserRoom, snapshot, selectObject, clientState } from './gaolao-real-support.mjs';
import { repository, sourceIdentity, saveJSON, sha256, until } from './network-support.mjs';
import { sceneLayerFixtures } from './scene-layer-fixtures.mjs';

const output = resolve(process.env.FRONTEND_EVIDENCE_DIR || resolve(repository, '.agent-output/scene-layers/browser'));
await mkdir(output, { recursive: true });
const navigationOnly = process.argv.includes('--navigation-only');
const report = { scope: '首章分层：真实Vue/两账号/HTTP/Socket/PostgreSQL；受控技术图，不是正式美术或真人重玩', phase: navigationOnly ? 'navigation-only' : 'all', source: await sourceIdentity(), checks: [], humanActions: [], npcActions: [], recapResponses: [], pageErrors: [], screenshots: [], samples: {}, cleanup: [] };
let database, server, vite, browser, room;
let rejectBase = !navigationOnly;
const fixture = sceneLayerFixtures();
const check = (name, details = {}) => { report.checks.push({ name, status: 'PASS', ...details }); console.log(JSON.stringify({ check: name })); };
async function picture(page, name) { const path = resolve(output, name); await page.screenshot({ path, fullPage: true }); report.screenshots.push({ file: name, sha256: sha256(await readFile(path)) }); }
async function state(name) {
  const current = await snapshot(room.pages[0]); report.samples[name] = current;
  const ground = current.projection.items.filter(item => item.location.kind === 'ground' && item.location.sceneId === current.projection.scene.sceneId);
  await until(async () => await room.pages[0].locator('.spatial-item').count() === ground.length, name + '地面实例等于当前授权数组');
  for (const item of ground) assert.equal(await room.pages[0].locator('.spatial-item[aria-label="选择' + item.name + '"]').getAttribute('transform'), `translate(${item.location.position.x} ${item.location.position.y})`);
  return current.projection;
}
try {
  database = await startTestPostgres('scene-layer-ui', { outputSubdirectory: 'scene-layers' });
  server = await createAuthorityServer({ pool: database.pool });
  const origin = `http://127.0.0.1:${(await server.listen(0)).port}`;
  vite = await createVite({ root: resolve(repository, 'frontend'), configFile: resolve(repository, 'frontend/vite.config.mjs'), configLoader: 'native', cacheDir: resolve(output, 'vite-cache'),
    plugins: [{ name: 'controlled-scene-ui-fixture', enforce: 'pre', load(id) {
      if (id === resolve(repository, 'frontend/src/assets/gaolao-scene-layers.json')) return JSON.stringify(fixture.catalog);
      if (id === resolve(repository, 'frontend/src/assets/gaolao-object-art.json')) return JSON.stringify(fixture.objectCatalog);
    }, configureServer(service) { service.middlewares.use((request, response, next) => {
      const path = new URL(request.url, 'http://localhost').pathname;
      if (!Object.hasOwn(fixture.files, path)) return next();
      response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', 'image/svg+xml');
      if (rejectBase && path === fixture.group.base.file) { response.statusCode = 503; response.end('受控静态组失败'); }
      else response.end(fixture.files[path]);
    }); } }], server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] }, proxy: { '/api': { target: origin }, '/socket.io': { target: origin, ws: true } } } });
  await vite.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : [] });
  room = await browserRoom({ server, browser, baseURL: `http://127.0.0.1:${vite.httpServer.address().port}`, count: 2, contentVersion: 'gaolaozhuang-scene-v2', report });
  const page = room.pages[0];
  if (!navigationOnly) {
  await until(async () => await page.getByTestId('spatial-map').getAttribute('data-scene-layer-status') === 'failed', '静态组失败进入几何降级');
  assert.equal(await page.locator('.spatial-scene-base,.spatial-scene-art,.spatial-scene-door image').count(), 0);
  assert.equal(await page.locator('.spatial-neutral-door').count(), 1);
  await room.go(0, room.C('C14'));
  const item = await room.entity(0, '公共门撑');
  await selectObject(page, item.entityRef);
  accepted(await room.send(0, { kind: 'inspect', targetRef: item.entityRef }));
  await state('loose'); await picture(page, 'failed-group-selection.png');
  await take(room, 0, '公共门撑');
  const held = await state('held');
  assert.equal(held.items.find(value => value.entityRef === item.entityRef).location.kind, 'held');
  assert.equal(await page.locator('.spatial-item[aria-label="选择公共门撑"]').count(), 0);
  const carried = await room.entity(0, '公共门撑');
  accepted(await room.interact(0, '公共工具借还架', 'gz-return-public', { itemRef: carried.entityRef, expectedItemRevision: carried.resourceRevision }));
  const returned = await state('returned');
  assert.deepEqual(returned.items.find(value => value.entityRef === item.entityRef).location, { kind: 'ground', sceneId: 'gaolao-courtyard', position: { x: 315, y: 390 } });
  check('静态组真实失败仍能选取/查看/拿取/归还同一引用，held撤地图、归还按权威点恢复');

  const actionIds = async () => (await clientState(page)).actions.map(action => action.id);
  const beforeRetry = await actionIds();
  rejectBase = false;
  await page.locator('.spatial-map-note').getByRole('button', { name: '重新载入图像', exact: true }).click();
  await until(async () => await page.getByTestId('spatial-map').getAttribute('data-scene-layer-status') === 'ready', '重试完整静态组');
  assert.equal(await page.locator('.spatial-scene-base').count(), 1); assert.equal(await page.locator('.spatial-scene-art').count(), 0);
  assert.deepEqual(await actionIds(), beforeRetry, '图像重试不提交世界动作');
  } else await until(async () => await page.getByTestId('spatial-map').getAttribute('data-scene-layer-status') === 'ready', '导航段完整静态组');
  for (const id of ['C13', 'C11', 'C12', 'C11', 'C13']) {
    await room.go(0, room.C(id)); const p = await state('courtyard-' + id + '-' + report.checks.length);
    assert.equal(p.self.position.x, room.C(id).position.x); assert.equal(p.self.position.y, room.C(id).position.y); assert.equal(p.self.sceneId, 'gaolao-courtyard');
    assert.equal(await page.getByTestId('spatial-map').getAttribute('data-scene-layer-status'), 'ready');
    check('客房原通道实际到达 ' + id, { position: p.self.position, movement: p.movement });
  }
  for (const id of ['R06', 'R04', 'R05', 'R04', 'R06']) {
    await room.go(0, room.R(id)); const p = await state('road-' + id + '-' + report.checks.length);
    assert.equal(p.self.position.x, room.R(id).position.x); assert.equal(p.self.position.y, room.R(id).position.y); assert.equal(p.self.sceneId, 'gaolao-village-road');
    assert.equal(await page.getByTestId('spatial-map').getAttribute('data-scene-layer-status'), 'legacy');
    assert.equal(await page.locator('.spatial-scene-door,.spatial-scene-base').count(), 0);
    const background = new URL(await page.locator('.spatial-scene-art').getAttribute('href'), page.url());
    assert.equal(background.pathname, '/assets/gaolaozhuang/scenes/village-road.png');
    check('茶棚原通道实际到达 ' + id, { position: p.self.position, movement: p.movement });
  }
  await picture(page, 'road-returned.png');
  assert.equal(report.npcActions.length, 0, '本检查不代NPC发动作');
  assert.ok(report.humanActions.every(action => action.receipt.status === 'Accepted'));
  assert.deepEqual(report.pageErrors, []);
  report.sourceEnd = await sourceIdentity(); assert.deepEqual(report.sourceEnd, report.source, '检查期间源码保持同一身份');
  report.assessment = 'PASS';
} catch (error) {
  report.assessment = 'FAIL'; report.error = error.stack; console.error(error);
  for (const [index, page] of (room?.pages || []).entries()) await page.screenshot({ path: resolve(output, `failure-${index}.png`), fullPage: true }).catch(() => {});
} finally {
  for (const [name, close] of [['browser', () => browser?.close()], ['vite', () => vite?.close()], ['server', () => server?.close()], ['postgres', () => database?.stop()]]) { await close(); report.cleanup.push(name); }
  report.resourcesClosed = true; await saveJSON(resolve(output, 'result.json'), report);
  console.log(JSON.stringify({ assessment: report.assessment, checks: report.checks.length, humanReceipts: report.humanActions.length, output }));
  if (report.assessment !== 'PASS') process.exitCode = 1;
}
