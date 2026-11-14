import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer as createVite } from 'vite';
import { startTestPostgres } from '../../backend/test-support/postgres.mjs';
import { createAuthorityServer } from '../../backend/server.mjs';
import { repository, saveJSON, sourceIdentity, sha256, until } from './network-support.mjs';
import { checkObjectGeometry } from './object-geometry-resources.mjs';

const output = resolve(process.env.FRONTEND_EVIDENCE_DIR || resolve(repository, '.agent-output/ui-implementer/spatial-browser'));
await mkdir(output, { recursive: true });
const report = { scope: 'A1灰盒作者自查：真实Vue/独立浏览器/HTTP/Socket.IO/PostgreSQL；自动化，不是真人、正式视觉或完整章节验收', source: await sourceIdentity(), startedAt: new Date().toISOString(), checks: [], pointerChecks: [], pageErrors: [], cleanup: [] };
let database, server, vite, browser, activePages = []; const contexts = [];
const check = (name, details = {}) => { report.checks.push({ name, status: 'PASS', ...details }); console.log(JSON.stringify({ check: name })); };
const snapshot = page => page.evaluate(async () => (await import('/src/state/spatial-store.ts')).spatialState.value.snapshot);
const state = page => page.evaluate(async () => { const s = (await import('/src/state/spatial-store.ts')).spatialState.value; return { connection: s.connection, inputReady: s.inputReady, paused: s.snapshot?.projection.paused, movement: s.snapshot?.projection.movement, position: s.snapshot?.projection.self.position, message: s.message, actions: s.actions.map(a => ({ status: a.status, detail: a.detail })) }; });
async function arrived(page, previousSequence, position, description) {
  await until(async () => { const p = (await snapshot(page))?.projection; return p?.movement?.movementCommandSeq !== previousSequence && p?.movement?.status === 'arrived' && p.self.position.x === position.x && p.self.position.y === position.y; }, description);
}
async function point(page, position) {
  await until(async () => (await state(page)).inputReady && !(await snapshot(page))?.projection.paused, '本地授权场景已恢复运行');
  const previousSequence = (await snapshot(page))?.projection.movement?.movementCommandSeq;
  const previousIds = await page.evaluate(async () => (await import('/src/state/spatial-store.ts')).spatialState.value.actions.map(action => action.id));
  await page.bringToFront();
  const map = page.getByTestId('spatial-map');
  await map.scrollIntoViewIfNeeded();
  // 浏览器实际指针按屏幕像素落点，先取最近整数像素，避免分数坐标被截断后偏到相邻世界坐标。
  const location = await map.evaluate((svg, position) => {
    const transform = svg.getScreenCTM(); const p = new DOMPoint(position.x, position.y).matrixTransform(transform); const box = svg.getBoundingClientRect();
    const pixel = { x: Math.round(p.x), y: Math.round(p.y) }; const world = new DOMPoint(pixel.x, pixel.y).matrixTransform(transform.inverse());
    const hit = document.elementFromPoint(pixel.x, pixel.y);
    return { click: { x: pixel.x - box.left, y: pixel.y - box.top }, pixel, mappedWorld: { x: Math.round(world.x), y: Math.round(world.y) }, hit: { tag: hit?.tagName, class: hit?.getAttribute('class'), label: hit?.closest('button')?.getAttribute('aria-label') || null } };
  }, position);
  assert.deepEqual(location.mappedWorld, position, '当前缩放须存在能命中原精确世界目标的屏幕像素');
  await map.click({ position: location.click });
  const outgoing = await until(() => page.evaluate(async previousIds => {
    const drafts = (await import('/src/state/spatial-store.ts')).spatialState.value.actions;
    return drafts.filter(draft => !previousIds.includes(draft.id)).map(draft => JSON.parse(draft.raw)).find(request => request.action.kind === 'move_to');
  }, previousIds), '本次真实地图点击发出移动请求');
  assert.deepEqual(outgoing.action.destination, position, '实际发出世界坐标与原精确目标一致');
  report.pointerChecks.push({ target: position, screenPixel: location.pixel, mappedWorld: location.mappedWorld, hit: location.hit, sentDestination: outgoing.action.destination, movementCommandSeq: outgoing.action.movementCommandSeq });
  return previousSequence;
}
async function screenshot(page, name) { const path = resolve(output, name); await page.screenshot({ path, fullPage: true }); report.checks.push({ screenshot: name, sha256: sha256(await readFile(path)) }); }
try {
  database = await startTestPostgres('spatial-ui', { outputSubdirectory: 'ui' });
  report.postgresVersion = (await database.pool.query('SHOW server_version')).rows[0].server_version;
  server = await createAuthorityServer({ pool: database.pool });
  const address = await server.listen(0); const origin = `http://127.0.0.1:${address.port}`;
  vite = await createVite({ root: resolve(repository, 'frontend'), configFile: resolve(repository, 'frontend/vite.config.mjs'), configLoader: 'native', cacheDir: resolve(output, 'vite-cache'), server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] }, proxy: { '/api': { target: origin }, '/socket.io': { target: origin, ws: true } } } });
  await vite.listen(); const baseURL = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : [] }); report.browserVersion = browser.version();
  for (const count of [2, 3, 4, 5]) {
    const pages = []; const groupContexts = []; let sessionId;
    for (let i = 0; i < count; i++) {
      const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 }); contexts.push(context); groupContexts.push(context);
      const page = await context.newPage(); pages.push(page); activePages = pages;
      page.on('pageerror', error => report.pageErrors.push({ group: count, player: i, message: error.message }));
      await page.goto(baseURL); await page.getByLabel('你的称呼', { exact: true }).fill(`灰盒${count}人旅伴${i + 1}`); await page.getByRole('button', { name: '以此名同行' }).click();
      if (i === 0) { await page.getByLabel('选择行程').selectOption('spatial'); await page.getByRole('button', { name: '创建同行房间' }).click(); await page.waitForURL(/\/spatial\/[^/]+$/); sessionId = new URL(page.url()).pathname.split('/').at(-1); }
      else { await page.getByLabel('房间号', { exact: true }).fill(sessionId); await page.locator('.join-form').getByRole('button', { name: '加入', exact: true }).click(); await page.waitForURL(/\/spatial\/[^/]+$/); }
      await until(async () => (await snapshot(page))?.projection.phase === 'Lobby', '浏览器取得实际空间大厅');
    }
    const [host, partner] = pages;
    await host.getByRole('heading', { name: `${count} 位旅伴已相聚` }).waitFor();
    await host.getByRole('button', { name: '开始同行（房主）' }).click();
    for (const page of pages) { await page.getByRole('button', { name: '恢复本人控制', exact: true }).click(); await until(async () => (await state(page)).inputReady, '每位真人独立取得控制'); }
    for (const page of pages) await until(async () => !(await snapshot(page))?.projection.paused, '全部控制完成后，各观察者收到场景恢复');
    const ids = await Promise.all(pages.map(page => page.evaluate(() => JSON.parse(sessionStorage.getItem('xiyou.guest.v1')).userId)));
    assert.equal(new Set(ids).size, count);
    check(`${count}人：真实页面登录、创建、独立加入和控制`);
    for (let i = 0; i < pages.length; i++) await point(pages[i], { x: 210 + i * 15, y: 60 });
    for (let i = 0; i < pages.length; i++) await until(async () => { const p = (await snapshot(pages[i]))?.projection; return p?.movement?.status === 'arrived' && p.self.position.x === 210 + i * 15 && p.self.position.y === 60; }, `${count}人各自实际行走到达`);
    check(`${count}人：点地行走由服务端连续推进，独立角色实际到达`);
    await host.bringToFront(); await point(host, { x: 450, y: 200 });
    await until(async () => ['accepted', 'moving'].includes((await snapshot(host))?.projection.movement?.status), '服务器受理绕墙路线');
    await host.getByRole('button', { name: '停步 / 取消后续操作' }).click();
    await until(async () => (await snapshot(host))?.projection.movement?.status === 'cancelled', '服务器实际停步');
    const stopped = (await snapshot(host)).projection.self.position;
    await new Promise(resolve => setTimeout(resolve, 500)); assert.deepEqual((await snapshot(host)).projection.self.position, stopped);
    check(`${count}人：换目标后停步，旧路线不继续改变位置`);
    if (count === 2 || count === 5) {
      await host.locator('.spatial-object-list').getByRole('button', { name: '公共支架', exact: true }).click();
      await host.getByRole('button', { name: '走近并拿取', exact: true }).click();
      await until(async () => { const p = (await snapshot(host)).projection; return p.items.some(i => i.name === '公共支架' && i.location.kind === 'held' && i.location.ownerRef === p.self.entityRef); }, '到达后实际拿取公共物');
      const previousFixture = await partner.getByTestId('spatial-map').evaluate(svg => {
        const point = new DOMPoint(180, 110).matrixTransform(svg.getScreenCTM()), hit = document.elementFromPoint(point.x, point.y);
        return { world: { x: 180, y: 110 }, screen: { x: point.x, y: point.y }, hit: { tag: hit?.tagName, class: hit?.getAttribute('class'), label: hit?.closest('button')?.getAttribute('aria-label') || null } };
      });
      const approachSequence = await point(partner, { x: 180, y: 150 });
      await arrived(partner, approachSequence, { x: 180, y: 150 }, '收件人本次路线实际到达交接处');
      const partnerName = (await snapshot(partner)).projection.self.name;
      const recipient = (await snapshot(host)).projection.entities.find(e => e.name === partnerName);
      const holder = (await snapshot(host)).projection.self.position;
      const handoffDistance = Math.hypot(holder.x - recipient.position.x, holder.y - recipient.position.y);
      assert.ok(handoffDistance < 80, '替代空地仍位于原近距交接范围内');
      report.pointerChecks.push({ group: count, previousFixture, handoff: { holder, recipient: recipient.position, distance: handoffDistance, limit: 80 } });
      assert.ok(recipient); await host.getByRole('button', { name: '行囊', exact: true }).click();
      await host.getByLabel('交接给', { exact: true }).selectOption(recipient.entityRef);
      await host.locator('.spatial-inventory').getByRole('button', { name: '交给对方', exact: true }).click();
      await until(async () => { const p = (await snapshot(partner)).projection; return p.items.some(i => i.name === '公共支架' && i.location.kind === 'held' && i.location.ownerRef === p.self.entityRef); }, '唯一持物权实际转交');
      await host.getByRole('button', { name: '关闭行囊', exact: true }).click();
      const anchors = (await snapshot(host)).projection.cooperations[0].anchors;
      const anchorSequences = await Promise.all([host, partner].map(async page => (await snapshot(page)).projection.movement?.movementCommandSeq));
      await host.getByRole('button', { name: '前往位置1', exact: true }).click(); await partner.getByRole('button', { name: '前往位置2', exact: true }).click();
      for (const [index, page] of [host, partner].entries()) { await arrived(page, anchorSequences[index], anchors[index], '本次路线实际到达协作站位'); await page.getByRole('button', { name: '参与准备', exact: true }).click(); }
      await host.getByRole('button', { name: '我已就位', exact: true }).click(); await partner.getByRole('button', { name: '我已就位', exact: true }).click();
      await until(async () => (await snapshot(host)).projection.cooperations.some(c => c.phase === 'locked'), '两人协作锁定');
      check(`${count}人：到达后拿取、近距唯一交接、两人协作锁定`);
      await host.getByRole('button', { name: '走向出口 · 院落出口', exact: true }).click();
      await until(async () => (await snapshot(host)).projection.self.sceneId === 'gray-road', '沿实际出口进入短路', 20000);
      await host.getByRole('button', { name: '走向出口 · 返回院落', exact: true }).click(); await until(async () => (await snapshot(host)).projection.self.sceneId === 'gray-yard', '返回院落');
      check(`${count}人：场景出口按授权条件来回行走`);
      await screenshot(host, `spatial-${count}players-desktop.png`);
    }
    if (count === 2) {
      const before = (await snapshot(host)).projection.self.controlEpoch;
      await host.reload(); await host.getByRole('button', { name: '恢复本人控制', exact: true }).click();
      await until(async () => (await state(host)).inputReady, '刷新后重新取得输入源');
      assert.ok(BigInt((await snapshot(host)).projection.self.controlEpoch) > BigInt(before));
      const refreshedSequence = await point(host, { x: 550, y: 200 }); await arrived(host, refreshedSequence, { x: 550, y: 200 }, '刷新后新epoch可走动');
      await partner.context().setOffline(true); await until(async () => (await snapshot(host)).projection.paused, '少于两人时暂停');
      const pausedAt = (await snapshot(host)).projection.sceneTimeMs; await new Promise(resolve => setTimeout(resolve, 700)); assert.equal((await snapshot(host)).projection.sceneTimeMs, pausedAt);
      await partner.context().setOffline(false); await until(async () => (await state(partner)).connection === 'online', '掉线玩家重新建立实际连接');
      await partner.getByRole('button', { name: '恢复本人控制', exact: true }).click(); await until(async () => (await state(partner)).inputReady && !(await snapshot(host)).projection.paused, '重连恢复有效场景时钟');
      check('2人：刷新与掉线恢复建立新控制周期，人数不足暂停且不补走');
      await host.setViewportSize({ width: 390, height: 844 });
      const widths = await host.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth })); assert.ok(widths.content <= widths.viewport);
      await screenshot(host, 'spatial-narrow-layout.png'); check('窄屏布局无横向溢出（浏览器尺寸模拟，非手机真机）', { widths });
    }
    for (const context of groupContexts) await context.close(); activePages = [];
  }
  await checkObjectGeometry({ browser, output, report });
  assert.deepEqual(report.pageErrors, []); report.assessment = 'PASS';
} catch (error) {
  report.assessment = 'FAIL'; report.error = error.stack; console.error(error);
  for (let i = 0; i < activePages.length; i++) { await activePages[i].screenshot({ path: resolve(output, `failure-${i}.png`), fullPage: true }).catch(() => {}); report[`page-${i}`] = await activePages[i].locator('body').innerText().catch(() => ''); report[`state-${i}`] = await state(activePages[i]).catch(() => null); }
} finally {
  await saveJSON(resolve(output, 'result-before-cleanup.json'), report);
  for (const [name, close] of [['browser', () => browser?.close()], ['vite', () => vite?.close()], ['server', () => server?.close()], ['postgres', () => database?.stop()]]) { await close(); report.cleanup.push(name); }
  report.finishedAt = new Date().toISOString(); report.resourcesClosed = true; await saveJSON(resolve(output, 'result.json'), report);
  console.log(JSON.stringify({ assessment: report.assessment, checks: report.checks.length, resourcesClosed: report.resourcesClosed, output })); if (report.assessment !== 'PASS') process.exitCode = 1;
}
