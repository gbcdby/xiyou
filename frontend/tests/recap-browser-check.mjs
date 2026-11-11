import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createServer as createVite } from 'vite';
import { startTestPostgres } from '../../backend/test-support/postgres.mjs';
import { createAuthorityServer } from '../../backend/server.mjs';
import { HttpApi } from '../src/network/http-api.ts';
import { repository, saveJSON, sourceIdentity, sha256, until } from './network-support.mjs';

const output = resolve(process.env.FRONTEND_EVIDENCE_DIR || resolve(repository, '.agent-output/mock-ui/browser'));
await mkdir(output, { recursive: true });
const started = performance.now();
const report = { scope: '合成玩家的实际 Vue/HTTP/Socket.IO/PostgreSQL 证据与复盘检查；NPC移动使用合法内部受控意图，非#10策略或#12最终整局验收', startedAt: new Date().toISOString(), source: await sourceIdentity(), nodeVersion: process.version, checks: [], pageErrors: [], databaseErrors: [], resourcesClosed: false, externalModelCalls: 0 };
let database, server, vite, browser, baseURL, origin;
const people = [];
const check = (name, details = {}) => { report.checks.push({ name, status: 'PASS', ...details }); console.log(JSON.stringify({ stage: name, elapsedMs: Math.round(performance.now() - started) })); };
const realFetch = (path, options) => fetch(new URL(path, origin), options);

async function createParty(count, label) {
  const members = []; let sessionId;
  for (let i = 0; i < count; i++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(); page.on('pageerror', error => report.pageErrors.push(error.message));
    await page.goto(baseURL);
    await page.getByLabel('你的称呼', { exact: true }).fill(`${label}${i + 1}`);
    await page.getByRole('button', { name: '以此名同行' }).click();
    if (i === 0) await page.getByRole('button', { name: '创建同行房间' }).click();
    else { await page.getByLabel('房间号', { exact: true }).fill(sessionId); await page.locator('.join-form').getByRole('button', { name: '加入', exact: true }).click(); }
    await page.waitForURL(/\/sessions\/[^/]+$/);
    sessionId ||= new URL(page.url()).pathname.split('/').at(-1);
    const identity = await page.evaluate(() => JSON.parse(sessionStorage.getItem('xiyou.guest.v1')));
    const api = new HttpApi(() => identity.token, realFetch);
    const member = { page, context, identity, api, sessionId }; people.push(member); members.push(member);
  }
  await members[0].page.getByRole('heading', { name: `${count} 位旅伴已相聚` }).waitFor();
  await members[0].page.getByRole('button', { name: '开始同行（房主）' }).click();
  for (const person of members) {
    await person.page.getByRole('button', { name: '恢复本人控制' }).click();
    await person.page.locator('.control-status').filter({ hasText: '由你控制' }).waitFor();
    const state = await person.api.snapshot(sessionId); person.actorId = state.projection.self.characterId;
  }
  assert.equal(new Set(members.map(p => p.identity.userId)).size, count);
  check(`${count}个独立浏览器身份经页面创建、加入、开局和恢复控制`);
  return members;
}
const snapshot = p => p.api.snapshot(p.sessionId);
async function browserGet(person, path) {
  return person.page.evaluate(async path => {
    const identity = JSON.parse(sessionStorage.getItem('xiyou.guest.v1'));
    const response = await fetch(path, { headers: { Authorization: `Bearer ${identity.token}` } });
    return { status: response.status, body: await response.json() };
  }, path);
}
const recapIds = person => person.page.locator('.recap-entry').evaluateAll(entries => entries.map(entry => entry.dataset.recapId));
async function move(person, regionId) {
  if ((await snapshot(person)).projection.self.regionId === regionId) return;
  const nav = person.page.getByRole('navigation', { name: '可前往的场所' });
  const current = await snapshot(person); const region = current.projection.regions.find(r => r.regionId === regionId);
  await nav.getByRole('button', { name: region?.name || new RegExp(regionId), exact: Boolean(region) }).click();
  await until(async () => (await snapshot(person)).projection.self.regionId === regionId, '页面移动到' + regionId);
}
async function inspect(person, targetName) {
  const count = (await snapshot(person)).projection.observations.length;
  await person.page.locator('.target-card').filter({ has: person.page.getByRole('heading', { name: targetName, exact: true }) }).getByRole('button', { name: '查看', exact: true }).click();
  await until(async () => (await snapshot(person)).projection.observations.length > count, '实际检查登记新观察');
}
async function transfer(person, itemId, recipient) {
  const current = (await snapshot(person)).projection;
  const item = current.items.find(i => i.itemId === itemId); assert.ok(item);
  const card = person.page.locator('.inventory-item').filter({ has: person.page.getByText(item.name, { exact: true }) });
  await card.getByRole('button', { name: '转交', exact: true }).click();
  await card.getByLabel('交给同处的哪位伙伴').selectOption(recipient.actorId);
  await card.getByRole('button', { name: '确认转交', exact: true }).click();
  await until(async () => (await snapshot(recipient)).projection.items.some(i => i.itemId === itemId && i.location.kind === 'character' && i.location.characterId === recipient.actorId), '真实交付' + itemId);
}
async function speak(person, text, channel, recipients = []) {
  const panel = person.page.getByRole('region', { name: '同行对话' });
  await panel.getByLabel('这句话说给谁').selectOption(channel);
  await panel.getByLabel('输入你的陈述').fill(text);
  for (const actorId of recipients) await panel.locator(`input[type="checkbox"][value="${actorId}"]`).check();
  await panel.getByRole('button', { name: '发送', exact: true }).click();
  await until(async () => (await snapshot(person)).projection.claims.some(c => c.text === text), '真实陈述提交');
}
async function share(person, observationId, recipient) {
  const card = person.page.locator(`[data-observation-id="${observationId}"]`);
  await card.getByRole('button', { name: '展示这份记录' }).click();
  await card.locator(`input[type="checkbox"][value="${recipient.actorId}"]`).check();
  const count = (await snapshot(recipient)).projection.observations.length;
  await card.getByRole('button', { name: '确认展示' }).click();
  await until(async () => (await snapshot(recipient)).projection.observations.length > count, '真实分享登记');
}
async function endWithLegalNpcMoves(sessionId) {
  for (const [actorId, regions] of [['tangseng', ['destination']], ['wukong', ['passage', 'destination']]]) {
    const handle = await server.runtime.bindInternal(sessionId, actorId, 'core_npc');
    for (const regionId of regions) {
      const decision = await server.runtime.prepareDecision(handle);
      const receipt = await server.runtime.submitIntent(handle, decision.decisionId, JSON.stringify({ decisionId: decision.decisionId, toolCalls: [{ kind: 'move', regionId }] }));
      assert.equal(receipt.status, 'Accepted');
    }
  }
}
async function fullChain(count) {
  const party = await createParty(count, `合成${count}人`);
  const seeker = count === 2 ? party[0] : party[3];
  const keeper = party[1]; const repairer = count === 2 ? keeper : party[0]; const coordinator = count === 2 ? keeper : party[2];
  await inspect(party[0], '受损通路');
  const observed = (await snapshot(party[0])).projection.observations.find(o => o.source.kind === 'inspection' && o.fields.some(f => f.key === 'safe'));
  const card = party[0].page.locator(`[data-observation-id="${observed.observationId}"]`);
  await card.getByText('适用对象', { exact: true }).waitFor();
  assert.match(await card.innerText(), /安全[\s\S]*未满足[\s\S]*布尔值/);
  assert.match(await card.innerText(), /来源引用/);
  await move(seeker, 'side_path'); await inspect(seeker, '临时存放处');
  await seeker.page.locator('.ground-item').filter({ has: seeker.page.getByText('原材料', { exact: true }) }).getByRole('button', { name: '拿取' }).click();
  await until(async () => (await snapshot(seeker)).projection.items.some(i => i.itemId === 'original_material' && i.location.kind === 'character' && i.location.characterId === seeker.actorId), '原材料真实拿取');
  await move(seeker, 'passage'); await move(keeper, 'passage');
  await transfer(seeker, 'original_material', repairer);
  if (count === 5) await transfer(keeper, 'repair_tool', repairer);
  const target = repairer.page.locator('.target-card').filter({ has: repairer.page.getByRole('heading', { name: '受损通路', exact: true }) });
  await target.getByRole('button', { name: '修复通路' }).click();
  await target.getByLabel('原材料', { exact: true }).check(); await target.getByLabel('修复工具', { exact: true }).check();
  await target.getByRole('button', { name: '提交修复' }).click();
  await until(async () => (await snapshot(repairer)).projection.targets.find(t => t.targetId === 'passage_structure')?.fields.some(f => f.key === 'safe' && f.value === true), '实际修复生效');
  // 许可必须使用 C 自己实际收到的修复后视图；其他客户端的快照不能替它确认新版本。
  const coordinatorTarget = coordinator.page.locator('.target-card').filter({ has: coordinator.page.getByRole('heading', { name: '受损通路', exact: true }) });
  await coordinatorTarget.locator('.fact-grid > div').filter({ has: coordinator.page.locator('dt').filter({ hasText: /^安全$/ }) }).locator('dd').filter({ hasText: /^已满足$/ }).waitFor();
  await coordinator.page.getByRole('button', { name: '授予通行许可' }).click();
  await until(async () => (await snapshot(coordinator)).projection.targets.find(t => t.targetId === 'passage_structure')?.fields.some(f => f.key === 'permit' && f.value === true), '实际许可生效');
  await endWithLegalNpcMoves(party[0].sessionId);
  for (const person of party) {
    await person.page.getByRole('heading', { name: '你有权查看的过程' }).waitFor();
    await person.page.getByText('已读完你有权查看的过程。', { exact: true }).waitFor();
    assert.equal(await person.page.getByRole('navigation', { name: '可前往的场所' }).getByRole('button').evaluateAll(buttons => buttons.every(button => button.disabled)), true);
  }
  const recap = await keeper.api.recap(keeper.sessionId, (await snapshot(keeper)).snapshotSeq);
  assert.ok(recap.entries.some(e => e.kind === 'used' && e.fields.some(f => f.key === 'consumed' && f.value === true)));
  assert.ok(recap.entries.some(e => e.kind === 'updated' && e.actorId === null));
  check(`${count}人实际页面完成查看、拿取、交付、修复、许可、终局与只读复盘`, { ending: (await snapshot(keeper)).projection.ending.endingCode, recapEntries: recap.entries.length });
  return party;
}

async function pagingAndCancellation() {
  const [reader] = await createParty(2, '分页检查');
  // 记录来自真实页面检查动作，每次都等实际 Observation 提交；不是直接写入历史。
  for (let i = 0; i < 55; i++) await inspect(reader, '受损通路');
  const requests = [];
  reader.page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/recap')) requests.push(Object.fromEntries(url.searchParams));
  });
  await server.runtime.abortSession(reader.sessionId, '分页合成检查');
  await reader.page.getByRole('button', { name: '加载更早的过程', exact: true }).waitFor();
  const first = await recapIds(reader); assert.equal(first.length, 100);
  let failed = false;
  await reader.page.route('**/recap?**', async route => {
    if (!failed && new URL(route.request().url()).searchParams.has('beforeSeq')) {
      failed = true;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ schemaVersion: 1, code: 'INTERNAL', message: '合成分页传输故障。' }) });
    } else await route.continue();
  });
  await reader.page.getByRole('button', { name: '加载更早的过程', exact: true }).click();
  await reader.page.getByRole('button', { name: '重试读取过程', exact: true }).waitFor();
  assert.deepEqual(await recapIds(reader), first);
  assert.equal(await reader.page.getByText('已读完你有权查看的过程。', { exact: true }).count(), 0);
  await reader.page.getByRole('button', { name: '重试读取过程', exact: true }).click();
  await reader.page.getByText('已读完你有权查看的过程。', { exact: true }).waitFor();
  const all = await recapIds(reader); assert.ok(all.length > 100); assert.equal(new Set(all).size, all.length);
  assert.equal(requests.length, 3); assert.equal(new Set(requests.map(request => request.throughSeq)).size, 1);
  assert.equal(requests[1].beforeSeq, requests[2].beforeSeq);
  const state = await snapshot(reader);
  const actual = await reader.api.recap(reader.sessionId, state.snapshotSeq);
  const older = await reader.api.recap(reader.sessionId, state.snapshotSeq, actual.nextBeforeSeq);
  assert.deepEqual(all, [...actual.entries, ...older.entries].map(entry => entry.entryId));
  check('实际浏览器按100条授权记录分页，故障保留已读页，同水位原游标重试且排序无重复', { totalEntries: all.length, pages: 2 });
  await reader.page.unroute('**/recap?**');

  // 延迟的是实际服务返回值；旧响应不能填回新房间，也不能与下一代视图合并。
  async function delayedReload() {
    let release, entered, finished;
    const gate = new Promise(resolve => { release = resolve; });
    const reached = new Promise(resolve => { entered = resolve; });
    const done = new Promise(resolve => { finished = resolve; });
    let held = false;
    await reader.page.route('**/recap?**', async route => {
      if (held) { await route.continue(); return; }
      held = true;
      try {
        const response = await route.fetch(); entered(); await gate;
        await route.fulfill({ response });
      } catch (error) {
        // AbortController 取消网络请求时，浏览器可在 fulfill 之前关闭路由。
        if (!/abort|closed|cancel|Target page/i.test(String(error))) throw error;
      } finally { finished(); }
    });
    await reader.page.reload(); await reached;
    return { release, done };
  }
  const oldView = await delayedReload();
  await reader.context.setOffline(true);
  await until(async () => await reader.page.locator('.recap-entry').count() === 0 && await reader.page.getByText('房间未连接', { exact: true }).count() > 0, '断连视图清空');
  await reader.context.setOffline(false);
  await reader.page.getByRole('button', { name: '加载更早的过程', exact: true }).waitFor();
  const current = await recapIds(reader); assert.equal(current.length, 100);
  oldView.release(); await oldView.done;
  assert.deepEqual(await recapIds(reader), current);
  check('实际断连重建视图后迟到的旧复盘回包不能重填或追加');
  await reader.page.unroute('**/recap?**');

  const oldRoom = await delayedReload();
  await reader.page.locator('.back-link').click();
  await reader.page.getByRole('button', { name: '创建同行房间', exact: true }).click();
  await reader.page.getByRole('heading', { name: '1 位旅伴已相聚', exact: true }).waitFor();
  assert.notEqual(new URL(reader.page.url()).pathname.split('/').at(-1), reader.sessionId);
  oldRoom.release(); await oldRoom.done;
  assert.equal(await reader.page.locator('.authorized-recap').count(), 0);
  check('实际经大厅切换房间后迟到旧复盘不能进入新房间');
  await reader.page.unroute('**/recap?**');

  await reader.page.goto(`${baseURL}/sessions/${reader.sessionId}`);
  await reader.page.getByRole('button', { name: '加载更早的过程', exact: true }).waitFor();
  const oldAccount = await delayedReload();
  // 仅撤销合成账号认证，触发实际服务的 UNAUTHENTICATED；不修改世界或结局。
  await database.pool.query('UPDATE runtime_users SET active=false WHERE user_id=$1', [reader.identity.userId]);
  await reader.page.getByRole('heading', { name: '登录已失效，请重新进入大厅', exact: true }).waitFor();
  assert.equal(await reader.page.locator('.authorized-recap').count(), 0);
  await reader.page.getByRole('link', { name: '返回大厅重新登录', exact: true }).click();
  await reader.page.getByLabel('你的称呼', { exact: true }).fill('换身份合成玩家');
  await reader.page.getByRole('button', { name: '以此名同行', exact: true }).click();
  await reader.page.getByRole('button', { name: '创建同行房间', exact: true }).click();
  await reader.page.getByRole('heading', { name: '1 位旅伴已相聚', exact: true }).waitFor();
  const currentUser = await reader.page.evaluate(() => JSON.parse(sessionStorage.getItem('xiyou.guest.v1')).userId);
  assert.notEqual(currentUser, reader.identity.userId);
  oldAccount.release(); await oldAccount.done;
  assert.equal(await reader.page.locator('.authorized-recap').count(), 0);
  check('实际认证失效清空复盘，新访客登录后迟到旧身份回包不恢复旧记录');
  await reader.page.unroute('**/recap?**');
}

try {
  database = await startTestPostgres('recap-browser');
  report.postgresVersion = (await database.pool.query('SHOW server_version')).rows[0].server_version;
  database.pool.on('error', error => report.databaseErrors.push({ code: error.code, message: error.message }));
  server = await createAuthorityServer({ pool: database.pool }); const address = await server.listen(0); origin = `http://127.0.0.1:${address.port}`;
  vite = await createVite({ root: resolve(repository, 'frontend'), configFile: resolve(repository, 'frontend/vite.config.mjs'), configLoader: 'native', cacheDir: resolve(output, 'vite-cache'), server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] }, proxy: { '/api': { target: origin }, '/socket.io': { target: origin, ws: true } } } });
  await vite.listen(); baseURL = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
  let executablePath = process.env.CHROMIUM_PATH; let args = process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : ['--no-sandbox'];
  if (process.env.CHROMIUM_PACKAGE) { const { default: binary } = await import(pathToFileURL(process.env.CHROMIUM_PACKAGE).href); executablePath = await binary.executablePath(); args = binary.args; }
  browser = await chromium.launch({ headless: true, executablePath, args }); report.browserVersion = browser.version();
  await fullChain(2); const five = await fullChain(5);
  const [a, b, c] = await createParty(3, '陈述检查');
  const falseClaim = '通路已修好';
  await inspect(a, '受损通路');
  const direct = (await snapshot(a)).projection.observations.find(observation => observation.category === 'Evidence');
  await speak(a, '晚到者不能追溯的旧公开说法', 'public');
  await speak(a, falseClaim, 'directed', [c.actorId]);
  await speak(a, '<img src=x onerror=alert(1)>', 'private', [c.actorId]);
  const heard = (await snapshot(c)).projection.observations.find(o => o.category === 'Claim' && o.statement === falseClaim);
  await move(b, 'passage'); await share(c, heard.observationId, b); await share(a, direct.observationId, b);
  const received = (await snapshot(b)).projection.observations.find(o => o.category === 'Claim' && o.statement === falseClaim);
  const receivedCard = b.page.locator(`[data-observation-id="${received.observationId}"]`);
  assert.match(await receivedCard.innerText(), /陈述/); assert.match(await receivedCard.innerText(), /记录接收者/);
  await server.runtime.abortSession(a.sessionId, '陈述语义合成负例');
  for (const person of [a, b, c]) await person.page.getByText('已读完你有权查看的过程。', { exact: true }).waitFor();
  for (const [person, kind] of [[b, 'received_claim'], [c, 'heard_claim']]) {
    const row = person.page.locator(`.recap-entry[data-kind="${kind}"]`).filter({ has: person.page.getByText(falseClaim, { exact: true }) });
    await row.waitFor(); assert.equal(await row.getAttribute('data-category'), 'Claim');
    assert.match(await row.innerText(), new RegExp('接收者：' + (await snapshot(person)).projection.self.name));
  }
  assert.equal(await b.page.locator('.recap-entry[data-kind="said"]').filter({ hasText: falseClaim }).count(), 0);
  assert.equal(await b.page.locator('.authorized-recap').getByText('晚到者不能追溯的旧公开说法', { exact: true }).count(), 0);
  assert.equal(await b.page.locator('.authorized-recap').getByText('<img src=x onerror=alert(1)>', { exact: true }).count(), 0);
  assert.equal(await c.page.locator('.recap-text img').count(), 0);
  assert.equal((await snapshot(b)).projection.targets.find(target => target.targetId === 'passage_structure').fields.find(field => field.key === 'safe').value, false);
  assert.ok(await a.page.locator('.recap-entry[data-kind="observed"]').count());
  assert.ok(await b.page.locator('.recap-entry[data-kind="received_evidence"]').count());
  check('实际页面区分 A→C→B 分享陈述与未修复事实，私有和晚到记录未泄露，文本不解释为HTML');
  const throughSeq = (await snapshot(b)).snapshotSeq;
  const endpoint = `/api/sessions/${b.sessionId}/recap?throughSeq=${throughSeq}`;
  for (const suffix of ['&unknown=1', '&beforeSeq=0', '&beforeSeq=01', '&throughSeq=1']) assert.equal((await browserGet(b, endpoint + suffix)).body.code, 'INVALID_MESSAGE');
  const empty = await browserGet(b, endpoint + '&beforeSeq=1');
  assert.equal(empty.status, 200); assert.deepEqual(empty.body.entries, []); assert.equal(empty.body.nextBeforeSeq, null);
  assert.equal((await browserGet(b, `/api/sessions/${five[0].sessionId}/recap?throughSeq=${(await snapshot(five[0])).snapshotSeq}`)).body.code, 'FORBIDDEN');
  check('实际浏览器请求覆盖空结果、未知参数、非法和重复游标、跨局拒绝');
  for (const viewport of [{ width: 1440, height: 1000, name: 'desktop' }, { width: 390, height: 844, name: 'mobile' }]) {
    await b.page.setViewportSize(viewport);
    assert.ok(await b.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    const name = `recap-${viewport.name}.png`; const path = resolve(output, name);
    await b.page.screenshot({ path, fullPage: false }); report.checks.push({ screenshot: name, sha256: sha256(await readFile(path)) });
  }
  check('复盘与长引用在桌面及390像素页面没有横向溢出');
  await server.runtime.revokeAccess(b.sessionId, b.identity.userId);
  await until(async () => await b.page.locator('.authorized-recap').count() === 0, '撤权后清空旧复盘');
  assert.equal((await browserGet(b, endpoint)).body.code, 'FORBIDDEN');
  check('实际撤权后授权投影与复盘区域均清空');
  // 只模拟旧服务缺少新增端点的失败响应，结局来自上面已完成的真实运行。
  await five[0].page.route('**/recap?**', route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ schemaVersion: 1, code: 'INVALID_MESSAGE', message: '旧服务没有复盘接口。' }) }));
  await five[0].page.reload();
  await five[0].page.getByText('复盘暂不可用，已确认的结局仍可查看。', { exact: true }).waitFor();
  assert.ok(await five[0].page.locator('.recap-panel h2').innerText());
  check('受控旧服务缺端点响应仅影响过程区，真实结局仍可读');
  await pagingAndCancellation();
  assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.databaseErrors, []); report.assessment = 'PASS';
} catch (error) {
  report.assessment = 'FAIL'; report.error = error.stack; console.error(error);
  for (let i = Math.max(0, people.length - 3); i < people.length; i++) await people[i].page.screenshot({ path: resolve(output, `failure-${i}.png`), fullPage: false }).catch(() => {});
} finally {
  await saveJSON(resolve(output, 'result-before-cleanup.json'), report);
  for (const [name, close] of [['browser', () => browser?.close()], ['vite', () => vite?.close()], ['server', () => server?.close()], ['postgres', () => database?.stop()]]) { await close(); console.log(JSON.stringify({ cleanup: name, state: 'closed' })); }
  report.resourcesClosed = true; report.finishedAt = new Date().toISOString(); report.elapsedMs = performance.now() - started;
  await saveJSON(resolve(output, 'result.json'), report);
  if (report.assessment !== 'PASS') process.exitCode = 1;
  console.log(JSON.stringify({ assessment: report.assessment, elapsedMs: Math.round(report.elapsedMs), checks: report.checks.length, resourcesClosed: report.resourcesClosed }));
}
