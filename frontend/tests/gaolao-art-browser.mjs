import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer as createVite } from 'vite';
import { startTestPostgres } from '../../backend/test-support/postgres.mjs';
import { createAuthorityServer } from '../../backend/server.mjs';
import { repository, sourceIdentity, saveJSON, sha256, until, sleep } from './network-support.mjs';
import { browserRoom, snapshot, clientState, openReading, closeReading } from './gaolao-real-support.mjs';

const output = resolve(process.env.FRONTEND_EVIDENCE_DIR || resolve(repository, '.agent-output/adv001-33-a3-visual/browser'));
await mkdir(output, { recursive: true });
const report = { scope: 'A3视觉首个切片作者自查；真实Vue/Chromium/Socket/HTTP/PostgreSQL，自动操作者，不是真人或真实模型验收', source: await sourceIdentity(), startedAt: new Date().toISOString(), checks: [], humanActions: [], npcActions: [], recapResponses: [], pageErrors: [], screenshots: [], videos: [], assets: [], pointerInputs: [], capabilityRequests: [] };
const check = (name, details = {}) => { report.checks.push({ name, status: 'PASS', ...details }); console.log(JSON.stringify({ check: name })); };
let database, server, vite, browser, room;
async function capture(page, file) { await page.screenshot({ path: resolve(output, file), fullPage: true }); report.screenshots.push({ file, sha256: sha256(await readFile(resolve(output, file))), viewport: page.viewportSize() }); }
async function point(page, position, wait = true) {
  await closeReading(page);
  const previous = (await snapshot(page)).projection.movement?.movementCommandSeq;
  const map = page.getByTestId('spatial-map'); await map.scrollIntoViewIfNeeded();
  const chosen = await map.evaluate((svg, requested) => {
    const transform = svg.getScreenCTM();
    const inspected = [];
    // 标签是实际可点击控件；从附近可见空地选试走点，不把点击穿透控件当作用户操作。
    for (const [dx, dy] of [[0, 0], [30, 0], [-30, 0], [0, 30], [0, -30], [50, 30], [-50, -30]]) {
      const position = { x: requested.x + dx, y: requested.y + dy }; const p = new DOMPoint(position.x, position.y).matrixTransform(transform);
      const node = document.elementFromPoint(p.x, p.y);
      const hit = { tag: node?.tagName || null, class: node?.getAttribute('class') || null, label: node?.getAttribute('aria-label') || node?.textContent?.trim().slice(0, 80) || null };
      inspected.push({ position, screen: { x: p.x, y: p.y }, hit });
      if (node?.closest('svg.spatial-map') === svg && !node.closest('.spatial-person, .spatial-item, .spatial-target')) return { position, screen: { x: p.x, y: p.y }, inspected };
    }
    return null;
  }, position);
  assert.ok(chosen, '存在可见且未被标签或对象覆盖的真实地面试走点');
  const input = { at: new Date().toISOString(), requested: position, ...chosen }; report.pointerInputs.push(input);
  position = chosen.position; const screen = chosen.screen;
  await page.mouse.click(screen.x, screen.y);
  await until(async () => (await snapshot(page)).projection.movement?.movementCommandSeq !== previous, '点地提交新的权威移动');
  const issued = (await snapshot(page)).projection.movement.goal;
  assert.ok(Math.hypot(issued.x - position.x, issued.y - position.y) <= 2, '浏览器像素量化后世界目标误差不超过2地图单位');
  const action = (await clientState(page)).actions.findLast(action => { const request = JSON.parse(action.raw); return request.action.kind === 'move_to' && request.action.destination.x === issued.x && request.action.destination.y === issued.y; });
  assert.ok(action, '实际客户端保留原始发出动作');
  report.humanActions.push({ label: '真实点地', at: input.at, requestedPosition: position, issuedPosition: issued, request: JSON.parse(action.raw), receipt: action.receipt || null });
  if (wait) await until(async () => { const p = (await snapshot(page)).projection; return p.movement?.status === 'arrived' && p.self.position.x === issued.x && p.self.position.y === issued.y; }, '实际发出脚底目标精确到达');
  if (wait) await until(() => page.locator('[data-spatial-self] [data-art-moving="true"]').count().then(n => n === 0), '到达使用独立站姿');
}
async function geometry(page) {
  const values = await page.evaluate(() => {
    const map = document.querySelector('.spatial-map-viewport').getBoundingClientRect();
    const labels = [...document.querySelectorAll('button.spatial-map-label')].map(node => { const b = node.getBoundingClientRect(); return { text: node.textContent.trim(), x: b.x, y: b.y, width: b.width, height: b.height, font: parseFloat(getComputedStyle(node).fontSize) }; });
    const hits = [...document.querySelectorAll('.spatial-hit')].map(node => { const b = node.getBoundingClientRect(); return { width: b.width, height: b.height }; });
    return { content: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth, map: { x: map.x, y: map.y, width: map.width, height: map.height }, labels, hits };
  });
  assert.ok(values.content <= values.viewport + 1, '页面没有横向溢出');
  assert.ok(values.labels.length > 0, '地图实际显示文字标签');
  for (const label of values.labels) { assert.ok(label.font >= 14); assert.ok(label.width >= 44 && label.height >= 44); }
  for (const hit of values.hits) assert.ok(hit.width >= 43.99 && hit.height >= 43.99, '图上对象的实际命中区至少44px');
  return values;
}
try {
  database = await startTestPostgres('art-browser', { outputSubdirectory: 'adv001-33-a3-visual' });
  server = await createAuthorityServer({ pool: database.pool }); const address = await server.listen(0); const origin = `http://127.0.0.1:${address.port}`;
  vite = await createVite({ root: resolve(repository, 'frontend'), configFile: resolve(repository, 'frontend/vite.config.mjs'), configLoader: 'native', cacheDir: resolve(output, 'vite-cache'), server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] }, proxy: { '/api': { target: origin }, '/socket.io': { target: origin, ws: true } } } });
  await vite.listen(); const baseURL = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : [] });
  report.browserVersion = browser.version();
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async options => {
    const context = await newContext({ ...options, recordVideo: { dir: resolve(output, 'raw-video'), size: { width: 1600, height: 1000 } } });
    context.on('request', request => { const url = new URL(request.url()); if (url.pathname.startsWith('/api/sessions') && request.method() === 'POST') { let body; try { body = request.postDataJSON(); } catch {} if (body?.capabilities) report.capabilityRequests.push({ path: url.pathname, method: request.method(), header: request.headers()['x-xiyou-capabilities'], capabilities: body.capabilities }); } });
    return context;
  };
  room = await browserRoom({ server, browser, baseURL, count: 2, report });
  const page = room.pages[0]; const partner = room.pages[1];
  assert.equal((await snapshot(page)).projection.self.appearanceId, 'gaocai');
  await until(() => page.locator('[data-spatial-self] [data-art-frame]').count(), '协商后高才原始资源实际进入地图');
  await page.evaluate(() => {
    window.__a3ArtFrames = [];
    new MutationObserver(records => { for (const record of records) { const node = record.target; if (!node.closest('[data-spatial-self]')) continue; window.__a3ArtFrames.push({ time: performance.now(), file: node.getAttribute('data-art-frame'), moving: node.getAttribute('data-art-moving'), mirror: node.getAttribute('transform') }); } }).observe(document.querySelector('.spatial-map'), { subtree: true, attributes: true, attributeFilter: ['data-art-frame'] });
  });
  const background = await page.locator('.spatial-scene-art').getAttribute('href');
  assert.match(background, /courtyard\.png$/);
  const response = await page.request.get(baseURL + background); assert.equal(response.status(), 200);
  report.assets.push({ file: background, sha256: sha256(await response.body()) });
  await capture(page, 'courtyard-desktop.png'); check('真实房间公开外观、原庭院、脚底渲染及桌面可读', await geometry(page));
  await page.getByRole('button', { name: '查看全图', exact: true }).click(); await capture(page, 'courtyard-full-desktop.png');
  await page.getByRole('button', { name: '回到角色', exact: true }).click();
  await point(page, { x: 800, y: 750 });
  const directions = [{ x: 800, y: 850 }, { x: 900, y: 950 }, { x: 1000, y: 950 }, { x: 1100, y: 850 }, { x: 1100, y: 750 }, { x: 1000, y: 650 }, { x: 900, y: 650 }, { x: 800, y: 750 }];
  for (const destination of directions) await point(page, destination);
  report.animationFrames = await page.evaluate(() => window.__a3ArtFrames);
  for (const direction of ['s', 'se', 'e', 'ne', 'n']) assert.ok(report.animationFrames.some(frame => frame.file?.includes(`/walk/${direction}/`)), '真实移动消费原生方向 ' + direction);
  assert.ok(report.animationFrames.some(frame => frame.mirror === 'scale(-1 1)'), '真实移动消费镜像方向');
  assert.equal(await page.getByRole('button', { name: '重新载入图像', exact: true }).count(), 0, '本次所用素材没有加载失败');
  check('八向真实点地、转向、镜像与到达站姿，连续录像已捕获');
  await point(page, { x: 1200, y: 800 }, false); await sleep(250);
  await page.getByRole('button', { name: '停步 / 取消后续操作', exact: true }).click();
  await until(async () => (await snapshot(page)).projection.movement?.status === 'cancelled', '实际停步');
  const stopped = (await snapshot(page)).projection.self.position; await sleep(400); assert.deepEqual((await snapshot(page)).projection.self.position, stopped);
  assert.equal(await page.locator('[data-spatial-self] [data-art-moving="true"]').count(), 0);
  check('停步保持权威位置与末朝向站姿，不原地播放行走');
  await openReading(page, '行囊'); const partnerBefore = (await snapshot(partner)).projection.self.position;
  await point(partner, { x: 800, y: 700 }); assert.notDeepEqual((await snapshot(partner)).projection.self.position, partnerBefore);
  assert.equal(await page.locator('.spatial-reading-pane').count(), 1); await capture(page, 'inventory-desktop.png');
  check('阅读行囊时另一真实连接持续行走'); await closeReading(page);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await point(page, { x: 1000, y: 800 });
  assert.equal(await page.locator('[data-art-moving="true"]').count(), 0); check('减弱动态仍按权威位置到达，人物使用站姿');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 390, height: 844 }); await sleep(250);
  await capture(page, 'courtyard-narrow.png'); check('390×844重排、地图标签14px与选择区44px', await geometry(page));
  await page.setViewportSize({ width: 1600, height: 1000 }); await sleep(100);
  await room.go(0, room.R('R02')); await capture(page, 'road-desktop.png'); check('通过真实出口进入庄外，原始概念背景仅作本阶段场景输入');
  await page.route('**/assets/gaolaozhuang/gaocai/**', route => route.abort()); await page.reload();
  await until(async () => (await snapshot(page))?.projection.self.appearanceId === 'gaocai', '重连恢复授权外观');
  await page.getByRole('button', { name: '重新载入图像', exact: true }).waitFor(); assert.equal(await page.locator('[data-spatial-self] [data-art-fallback]').count(), 1);
  await page.unroute('**/assets/gaolaozhuang/gaocai/**'); await page.getByRole('button', { name: '重新载入图像', exact: true }).click();
  await until(() => page.locator('[data-spatial-self] [data-art-frame]').count(), '资源重试恢复原站姿');
  check('图像失败保持中性可选回退，显式重试恢复');
  assert.ok(report.capabilityRequests.length >= 2); for (const request of report.capabilityRequests) { assert.equal(request.header, 'spatial-v2,spatial-appearance-v1'); assert.deepEqual(request.capabilities, ['spatial-v2', 'spatial-appearance-v1']); }
  assert.deepEqual(report.pageErrors, []); report.sourceEnd = await sourceIdentity(); assert.deepEqual(report.sourceEnd, report.source);
  const video = page.video(); await room.close(); room = null; await video.saveAs(resolve(output, 'continuous-browser.webm'));
  report.videos.push({ file: 'continuous-browser.webm', sha256: sha256(await readFile(resolve(output, 'continuous-browser.webm'))) });
  report.assessment = 'PASS';
} catch (error) {
  report.assessment = 'FAIL'; report.error = error.stack; console.error(error);
  if (room) for (const [index, page] of room.pages.entries()) { await capture(page, `failure-${index}.png`).catch(() => {}); report['failureState' + index] = await snapshot(page).catch(() => null); }
} finally {
  await room?.close(); await browser?.close(); await vite?.close(); await server?.close(); await database?.stop();
  report.finishedAt = new Date().toISOString(); await saveJSON(resolve(output, 'result.json'), report);
  console.log(JSON.stringify({ assessment: report.assessment, checks: report.checks.length, output })); if (report.assessment !== 'PASS') process.exitCode = 1;
}
