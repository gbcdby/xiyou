import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createServer as createVite } from 'vite';
import { startTestPostgres } from '../../backend/test-support/postgres.mjs';
import { createAuthorityServer } from '../../backend/server.mjs';
import { HttpApi } from '../src/network/http-api.ts';
import { SessionClient } from '../src/network/session-client.ts';
import { connectSocket } from '../src/network/socket-link.ts';
import { repository, saveJSON, sourceIdentity, sha256, until } from './network-support.mjs';

const output = resolve(process.env.FRONTEND_EVIDENCE_DIR || resolve(repository, '.agent-output/frontend-network/browser'));
await mkdir(output, { recursive: true });
const started = performance.now();
const report = { scope: '真实 Vue / HTTP / Socket.IO / PostgreSQL 作者检查；自动化，不是真人或真实 AI', startedAt: new Date().toISOString(), nodeVersion: process.version, source: await sourceIdentity(), checks: [], pageErrors: [], resourcesClosed: false };
let database, server, vite, browser, page, partner;
const screenshot = async name => { const path = resolve(output, name); await page.screenshot({ path, fullPage: true }); report.checks.push({ screenshot: name, sha256: sha256(await readFile(path)) }); };
const check = (name, detail = {}) => { report.checks.push({ name, status: 'PASS', ...detail }); console.log(JSON.stringify({ stage: name, elapsedMs: Math.round(performance.now() - started) })); };
try {
  database = await startTestPostgres('frontend-browser');
  report.postgresVersion = (await database.pool.query('SHOW server_version')).rows[0].server_version;
  report.databaseErrors = [];
  database.pool.on('error', error => { report.databaseErrors.push({ code: error.code, message: error.message }); console.error(JSON.stringify({ databaseError: error.code, message: error.message })); });
  server = await createAuthorityServer({ pool: database.pool });
  const address = await server.listen(0); const origin = `http://127.0.0.1:${address.port}`;
  vite = await createVite({ root: resolve(repository, 'frontend'), configFile: resolve(repository, 'frontend/vite.config.mjs'), configLoader: 'native', cacheDir: resolve(output, 'vite-cache'), server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] }, proxy: { '/api': { target: origin }, '/socket.io': { target: origin, ws: true } } } });
  await vite.listen(); const baseURL = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
  let executablePath = process.env.CHROMIUM_PATH; let args = process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : ['--no-sandbox'];
  if (process.env.CHROMIUM_PACKAGE) { const { default: binary } = await import(pathToFileURL(process.env.CHROMIUM_PACKAGE).href); executablePath = await binary.executablePath(); args = binary.args; }
  browser = await chromium.launch({ headless: true, executablePath, args }); report.browserVersion = browser.version();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.goto(baseURL);
  await page.getByRole('textbox', { name: '你的称呼', exact: true }).fill('浏览器青禾');
  await page.getByRole('button', { name: '以此名同行' }).click();
  // 本脚本继续核对旧 region-v1 房间；空间灰盒由独立脚本覆盖。
  await page.getByLabel('选择行程').selectOption('region');
  await page.getByRole('button', { name: '创建同行房间' }).click();
  await page.waitForURL(/\/sessions\/[^/]+$/);
  const sessionId = new URL(page.url()).pathname.split('/').at(-1); report.sessionId = sessionId;
  let partnerToken = null;
  const realFetch = (path, options) => fetch(new URL(path, origin), options);
  const partnerApi = new HttpApi(() => partnerToken, realFetch);
  const guest = await partnerApi.guest('联机松风'); partnerToken = guest.token;
  const partnerMembership = await partnerApi.join(sessionId, crypto.randomUUID());
  partner = new SessionClient(partnerApi, (token, handlers) => connectSocket(token, handlers, origin));
  partner.open(sessionId, partnerToken);
  await until(() => partner.state.snapshot, '伙伴取得真实快照');
  await page.getByRole('heading', { name: '2 位旅伴已相聚' }).waitFor();
  await page.getByRole('button', { name: '开始同行（房主）' }).click();
  await page.getByRole('button', { name: '恢复本人控制' }).click();
  await page.locator('.control-status').filter({ hasText: '由你控制' }).waitFor();
  await until(() => partner.state.snapshot?.projection.phase === 'Running', '伙伴看见真实开局');
  await partner.control('resume'); await until(() => partner.state.snapshot?.projection.self.canControl, '伙伴恢复本人控制');
  check('真实页面登录、创建、两人加入、开始与控制');
  const storedIdentity = await page.evaluate(() => JSON.parse(sessionStorage.getItem('xiyou.guest.v1')));
  assert.notEqual(storedIdentity.userId, guest.userId, '第二位伙伴必须是服务真实签发的独立身份。');
  assert.equal(partner.state.snapshot.projection.self.characterId, partnerMembership.actorId);
  const hostApi = new HttpApi(() => storedIdentity.token, realFetch);
  const nav = page.getByRole('navigation', { name: '可前往的场所' });
  const labels = (await nav.getByRole('button').allTextContents()).map(text => text.trim());
  assert.equal(labels.length, 3); assert.equal(new Set(labels).size, labels.length, '真实授权投影中的多个出口必须逐个可辨认。');
  for (const [exit, title] of [['store', '材料间'], ['side_path', '侧路'], ['passage', '通路口']]) {
    await nav.getByRole('button', { name: new RegExp(exit) }).click();
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    await until(async () => (await hostApi.snapshot(sessionId)).projection.self.regionId === exit, `服务器确认到达 ${exit}`);
  }
  check('真实多出口可辨认并到达对应区域', { initialLabels: labels });
  await nav.getByRole('button', { name: /destination/ }).click();
  await page.locator('.pending-action.rejected').waitFor();
  assert.equal((await hostApi.snapshot(sessionId)).projection.self.regionId, 'passage');
  check('未满足许可的出口收到真实拒绝，位置不提前改变');
  await partner.send({ kind: 'move', regionId: 'passage' });
  await until(() => partner.state.snapshot?.projection.self.regionId === 'passage', '伙伴实际来到同一场所');
  const recipient = await until(async () => {
    const projection = (await hostApi.snapshot(sessionId)).projection;
    return projection.characters.find(person => person.characterId === partnerMembership.actorId && person.regionId === projection.self.regionId);
  }, '房主授权视图确认实际在场的伙伴角色');
  const dialogue = page.getByRole('region', { name: '同行对话' });
  await dialogue.getByLabel('这句话说给谁').selectOption('directed');
  await dialogue.getByLabel('输入你的陈述').fill('真实联机检查：请一起核对通路。');
  assert.equal(await dialogue.getByRole('button', { name: '发送', exact: true }).isDisabled(), true);
  // 访客昵称与关内角色名称不同；接收者必须由当前授权投影的角色身份决定。
  const recipientOption = dialogue.getByRole('checkbox', { name: recipient.name, exact: true });
  assert.equal(await recipientOption.getAttribute('value'), partnerMembership.actorId);
  await recipientOption.check();
  await dialogue.getByRole('button', { name: '发送', exact: true }).click();
  await dialogue.getByRole('log').getByText('真实联机检查：请一起核对通路。', { exact: true }).waitFor();
  const receivedClaim = await until(() => partner.state.snapshot?.projection.claims.find(claim => claim.text === '真实联机检查：请一起核对通路。'), '指定伙伴取得真实陈述');
  assert.equal(receivedClaim.channel, 'directed');
  assert.deepEqual(receivedClaim.recipientIds, [partnerMembership.actorId]);
  assert.equal(receivedClaim.speakerId, (await hostApi.snapshot(sessionId)).projection.self.characterId);
  const before = (await hostApi.snapshot(sessionId)).projection.observations.length;
  await page.getByRole('region', { name: '通路口', exact: true }).getByRole('button', { name: '查看', exact: true }).click();
  await until(async () => (await hostApi.snapshot(sessionId)).projection.observations.length > before, '服务器登记实际查看');
  check('定向接收者、真实陈述与查看记录', { guestName: guest.name, recipientName: recipient.name, recipientId: recipient.characterId, claimId: receivedClaim.claimId, channel: receivedClaim.channel });
  for (const viewport of [{ width: 1440, height: 1000, name: 'desktop' }, { width: 390, height: 844, name: 'mobile' }]) {
    await page.setViewportSize(viewport);
    const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    assert.ok(widths.content <= widths.viewport); check(`${viewport.name} 无横向溢出`, { viewport: { width: viewport.width, height: viewport.height }, document: widths });
    await screenshot(`real-session-${viewport.name}.png`);
  }
  assert.deepEqual(report.pageErrors, []);
  report.assessment = 'PASS';
} catch (error) {
  report.assessment = 'FAIL'; report.error = error.stack;
  if (page) { await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {}); report.visibleText = await page.locator('body').innerText().catch(() => ''); }
  console.error(error);
} finally {
  await saveJSON(resolve(output, 'result-before-cleanup.json'), report);
  report.cleanup = [];
  partner?.close();
  for (const [name, close] of [['browser', () => browser?.close()], ['vite', () => vite?.close()], ['server', () => server?.close()], ['postgres', () => database?.stop()]]) {
    console.log(JSON.stringify({ cleanup: name, state: 'starting' })); await close();
    report.cleanup.push(name); console.log(JSON.stringify({ cleanup: name, state: 'closed' }));
  }
  if (report.databaseErrors?.length) report.assessment = 'FAIL';
  report.resourcesClosed = true; report.finishedAt = new Date().toISOString(); report.elapsedMs = performance.now() - started;
  await saveJSON(resolve(output, 'result.json'), report);
  if (report.assessment !== 'PASS') process.exitCode = 1;
  console.log(JSON.stringify({ assessment: report.assessment, elapsedMs: Math.round(report.elapsedMs), checks: report.checks.length, resourcesClosed: report.resourcesClosed, output }));
}
