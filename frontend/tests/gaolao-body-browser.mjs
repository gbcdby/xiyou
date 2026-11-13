import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer as createVite } from 'vite';
import { chromium } from 'playwright';
import { startTestPostgres } from '../../backend/test-support/postgres.mjs';
import { createAuthorityServer } from '../../backend/server.mjs';
import { repository, sourceIdentity, saveJSON, sha256, until, sleep } from './network-support.mjs';
import { browserRoom, snapshot, clientState, closeReading } from './gaolao-real-support.mjs';

const output = resolve(process.env.FRONTEND_EVIDENCE_DIR || resolve(repository, '.agent-output/visual-recovery/body'));
await mkdir(output, { recursive: true });
const report = { scope: '恢复候选的身体命中作者自查：真实PG/HTTP/Socket/Vue双账号、真实鼠标；非旧f5原证据、非真人或真机', source: await sourceIdentity(), startedAt: new Date().toISOString(), checks: [], humanActions: [], npcActions: [], recapResponses: [], pageErrors: [], clicks: [], screenshots: [] };
let database, server, vite, browser, room;
const check = name => { report.checks.push({ name, status: 'PASS' }); console.log(JSON.stringify({ check: name })); };
async function capture(page, name) { await page.screenshot({ path: resolve(output, name), fullPage: true }); report.screenshots.push({ name, sha256: sha256(await readFile(resolve(output, name))) }); }
async function mapPoint(page, position) {
  await page.locator('svg.spatial-map').scrollIntoViewIfNeeded();
  return page.locator('svg.spatial-map').evaluate((svg, position) => {
    const p = new DOMPoint(position.x, position.y).matrixTransform(svg.getScreenCTM()), hit = document.elementFromPoint(p.x, p.y);
    return { position, screen: { x: p.x, y: p.y }, hit: { tag: hit?.tagName, class: hit?.getAttribute('class'), person: hit?.closest('.spatial-person')?.getAttribute('aria-label') || null } };
  }, position);
}
async function ids(page) { return (await clientState(page)).actions.map(action => action.id); }
async function after(page, old) { return (await clientState(page)).actions.filter(action => !old.includes(action.id)); }
async function selectBody(page, name, point, expectedRef) {
  const old = await ids(page); await page.mouse.click(point.screen.x, point.screen.y); await sleep(120);
  const actions = (await after(page, old)).map(action => JSON.parse(action.raw)), heading = await page.locator('#spatial-selection-heading').innerText();
  report.clicks.push({ name, ...point, expectedRef, actions, heading });
  assert.equal(actions.some(action => action.action.kind === 'move_to'), false, '可见身体点击不能穿透成为移动');
  assert.ok(heading.endsWith(name), '选中卡显示当前公开称呼');
  const self = (await snapshot(page)).projection.self;
  if (expectedRef === self.entityRef) {
    // 产品对本人只显示选中态，不提供查看自己的操作；本人标记由当前公开self引用派生。
    assert.equal(await page.locator('.spatial-person.selected[data-spatial-self="true"]').count(), 1, '当前本人公开引用被选中');
    assert.equal(await page.getByRole('button', { name: '在当前位置查看', exact: true }).count(), 0);
    report.clicks.at(-1).selectedSelf = { entityRef: self.entityRef, name: self.name }; return;
  }
  const beforeInspect = await ids(page); await page.getByRole('button', { name: '在当前位置查看', exact: true }).click();
  const inspect = await until(async () => (await after(page, beforeInspect)).find(action => JSON.parse(action.raw).action.kind === 'inspect'), '选中后实际查看当前引用');
  const request = JSON.parse(inspect.raw); assert.equal(request.action.targetRef, expectedRef, '身体选中当前授权ref'); report.clicks.at(-1).inspectRequest = request;
}
async function ground(page, point) {
  const record = { name: '透明或空地', ...point }; report.clicks.push(record);
  assert.equal(point.hit.person, null, '见证点没有被人物命中区覆盖');
  const old = await ids(page); await page.mouse.click(point.screen.x, point.screen.y);
  const action = await until(async () => (await after(page, old)).find(action => JSON.parse(action.raw).action.kind === 'move_to'), '真实点地发出移动');
  const request = JSON.parse(action.raw), goal = request.action.destination;
  assert.ok(Math.hypot(goal.x - point.position.x, goal.y - point.position.y) <= 2, '屏幕量化后仍是所点世界位置');
  await until(async () => { const p = (await snapshot(page)).projection; return p.movement?.status === 'arrived' && p.self.position.x === goal.x && p.self.position.y === goal.y; }, '实际请求目标精确到达');
  const receipt = (await clientState(page)).actions.find(item => item.id === action.id).receipt; assert.equal(receipt.status, 'Accepted');
  Object.assign(record, { request, receipt }); await sleep(260);
}
async function rasterPoint(page, transparent, actor = '[data-spatial-self="true"]') {
  await page.locator('svg.spatial-map').scrollIntoViewIfNeeded();
  return page.locator(actor + ' .spatial-actor-art image').evaluate(async (element, transparent) => {
    const image = new Image(); image.src = element.getAttribute('href'); await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); const rgba = context.getImageData(0, 0, image.width, image.height).data;
    const svg = element.closest('svg'), actor = element.closest('.spatial-person'), candidates = [];
    for (let y = Math.floor(image.height * 0.38); y < image.height * 0.60; y += 3) for (let x = 4; x < image.width - 4; x += 3) {
      let valid = true;
      for (let dy = -3; dy <= 3 && valid; dy++) for (let dx = -3; dx <= 3; dx++) { const a = rgba[((y + dy) * image.width + x + dx) * 4 + 3]; if (transparent ? a !== 0 : a < 220) { valid = false; break; } }
      if (!valid) continue;
      const p = new DOMPoint(element.x.baseVal.value + (x + 0.5) * element.width.baseVal.value / image.width, element.y.baseVal.value + (y + 0.5) * element.height.baseVal.value / image.height).matrixTransform(element.getScreenCTM());
      const hit = document.elementFromPoint(p.x, p.y); if (hit?.closest('svg') !== svg || (hit.closest('.spatial-person') && hit.closest('.spatial-person') !== actor)) continue;
      const world = new DOMPoint(p.x, p.y).matrixTransform(svg.getScreenCTM().inverse());
      candidates.push({ screen: { x: p.x, y: p.y }, position: { x: world.x, y: world.y }, pixel: { x, y, alpha: rgba[(y * image.width + x) * 4 + 3] }, hit: { tag: hit.tagName, class: hit.getAttribute('class'), person: hit.closest('.spatial-person')?.getAttribute('aria-label') || null }, file: element.getAttribute('href'), mirror: element.parentElement.getAttribute('transform'), score: Math.abs(x - image.width / 2) + Math.abs(y - image.height / 2) });
    }
    candidates.sort((a, b) => a.score - b.score); if (!candidates.length) throw new Error('没有当前可见的PNG像素见证点'); return candidates[0];
  }, transparent);
}
try {
  database = await startTestPostgres('body-recovery', { outputSubdirectory: 'visual-recovery' }); server = await createAuthorityServer({ pool: database.pool });
  const address = await server.listen(0), origin = `http://127.0.0.1:${address.port}`;
  vite = await createVite({ root: resolve(repository, 'frontend'), configFile: resolve(repository, 'frontend/vite.config.mjs'), configLoader: 'native', cacheDir: resolve(output, 'vite-cache'), server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] }, proxy: { '/api': { target: origin }, '/socket.io': { target: origin, ws: true } } } }); await vite.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: [] }); report.browserVersion = browser.version();
  room = await browserRoom({ server, browser, baseURL: `http://127.0.0.1:${vite.httpServer.address().port}`, count: 2, report });
  const page = room.pages[0]; await room.go(0, room.C('C18')); await room.go(1, room.C('C22')); await closeReading(page);
  const other = (await snapshot(page)).projection.entities.find(person => person.name === '木匠学徒'); assert.deepEqual(other.position, { x: 708, y: 640 });
  await selectBody(page, other.name, await mapPoint(page, { x: 708, y: 598 }), other.entityRef); await capture(page, 'neutral-body.png'); check('原木匠身体反例选择当前ref，不穿透发移动');
  await selectBody(page, other.name, await mapPoint(page, other.position), other.entityRef);
  const visibleLabel = (await page.locator('#spatial-selection-heading').innerText()).trim();
  const labelPoint = await page.getByRole('button', { name: '选择' + visibleLabel, exact: true }).evaluate(element => {
    const box = element.closest('button').getBoundingClientRect(), screen = { x: box.x + box.width / 2, y: box.y + box.height / 2 }, hit = document.elementFromPoint(screen.x, screen.y);
    return { screen, hit: { tag: hit?.tagName, class: hit?.getAttribute('class'), label: hit?.closest('button')?.getAttribute('aria-label') } };
  });
  await selectBody(page, other.name, labelPoint, other.entityRef); check('原脚底圆与可见标签仍实际选中当前ref');
  await ground(page, await mapPoint(page, { x: 1150, y: 650 }));
  await until(() => page.locator('[data-spatial-self="true"] [data-art-frame$="/idle/e.png"]').count(), '实际向东后使用原生站姿');
  for (const [name, mirror] of [['原生高才', null], ['镜像高才', 'scale(-1 1)']]) {
    const self = (await snapshot(page)).projection.self, body = await rasterPoint(page, false); assert.equal(body.mirror, mirror);
    await selectBody(page, self.name, body, self.entityRef); await capture(page, name === '原生高才' ? 'gaocai-native-body.png' : 'gaocai-mirror-body.png');
    const observer = room.pages[1], visibleGaocai = (await snapshot(observer)).projection.entities.find(person => person.name === self.name);
    assert.ok(visibleGaocai); const observedBody = await rasterPoint(observer, false, '.spatial-person:not([data-spatial-self="true"])'); assert.equal(observedBody.mirror, mirror);
    await selectBody(observer, visibleGaocai.name, observedBody, visibleGaocai.entityRef);
    await ground(page, await rasterPoint(page, true)); check(name + '不透明身体选择与alpha0透明点地');
    if (mirror === null) { const position = (await snapshot(page)).projection.self.position; await ground(page, await mapPoint(page, { x: 1080, y: position.y })); await until(() => page.locator('[data-spatial-self="true"] [data-art-frame$="/idle/e.png"][transform="scale(-1 1)"]').count(), '实际向西后镜像站姿'); }
  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('svg.spatial-map').scrollIntoViewIfNeeded();
  const self = (await snapshot(page)).projection.self; await selectBody(page, self.name, await rasterPoint(page, false), self.entityRef);
  const geometry = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth, labels: [...document.querySelectorAll('button.spatial-map-label')].map(node => { const r = node.getBoundingClientRect(); return { width: r.width, height: r.height, font: parseFloat(getComputedStyle(node).fontSize) }; }), feet: [...document.querySelectorAll('.spatial-hit')].map(node => { const r = node.getBoundingClientRect(); return { width: r.width, height: r.height }; }) }));
  assert.ok(geometry.content <= geometry.width); assert.ok(geometry.labels.every(x => x.width >= 44 && x.height >= 44 && x.font >= 14)); assert.ok(geometry.feet.every(x => x.width >= 43.99 && x.height >= 43.99)); report.geometry = geometry;
  await capture(page, 'narrow-body.png'); check('390窄屏身体选择与14px标签/44px入口保持');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.route('**/assets/gaolaozhuang/gaocai/**', route => route.abort()); await page.reload(); await page.getByRole('button', { name: '恢复本人控制', exact: true }).click();
  await until(async () => (await clientState(page)).inputReady, '刷新取得新控制'); await page.getByRole('button', { name: '重新载入图像', exact: true }).waitFor();
  const fallback = (await snapshot(page)).projection.self; await selectBody(page, fallback.name, await mapPoint(page, { x: fallback.position.x, y: fallback.position.y - 40 }), fallback.entityRef); await capture(page, 'resource-fallback-body.png');
  await page.unroute('**/assets/gaolaozhuang/gaocai/**'); await page.getByRole('button', { name: '重新载入图像', exact: true }).click(); await until(() => page.locator('[data-spatial-self="true"] .spatial-actor-art').count(), '显式重试恢复图像'); check('图像失败仍可身体选择，显式重试恢复当前造型');
  report.sourceEnd = await sourceIdentity(); assert.deepEqual(report.sourceEnd, report.source); assert.deepEqual(report.pageErrors, []); report.assessment = 'PASS';
} catch (error) { report.assessment = 'FAIL'; report.error = error.stack; console.error(error); if (room) await capture(room.pages[0], 'failure.png').catch(() => {}); }
finally { await room?.close(); await browser?.close(); await vite?.close(); await server?.close(); await database?.stop(); report.finishedAt = new Date().toISOString(); await saveJSON(resolve(output, 'result.json'), report); console.log(JSON.stringify({ assessment: report.assessment, output })); if (report.assessment !== 'PASS') process.exitCode = 1; }
