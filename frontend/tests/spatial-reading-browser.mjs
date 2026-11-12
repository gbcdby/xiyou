import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Server } from 'socket.io';
import { createServer as createVite } from 'vite';
import { spatialSnapshot } from './spatial-fixture.mjs';
import { validateSpatial } from '../../protocol/spatial.mjs';
import { repository, saveJSON, sha256, sourceIdentity, until } from './network-support.mjs';

// 只检查现有公开 DTO 的阅读、选择与撤权表现；可控服务不承担高老庄规则或真实后端验收。
const output = resolve(process.env.FRONTEND_EVIDENCE_DIR || resolve(repository, '.agent-output/adv001-33-a2/reading-browser'));
await mkdir(output, { recursive: true });
const report = { scope: '真实 Vue/Chromium 与受控 Socket DTO；阅读区、同名引用及授权清除的作者自查', source: await sourceIdentity(), startedAt: new Date().toISOString(), checks: [], pageErrors: [], screenshots: [] };
const firstRef = 'actor_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const secondRef = 'actor_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const heldRef = 'item_cccccccccccccccccccccccccccccccc';
const hiddenOwner = 'actor_dddddddddddddddddddddddddddddddd';
const snapshot = spatialSnapshot(); snapshot.projection.self.canControl = false;
snapshot.projection.scene.name = '授权阅读检查院落';
snapshot.projection.entities.push(...[firstRef, secondRef].map((entityRef, index) => ({ entityRef, name: '翠兰', appearanceEpoch: '0', sceneId: 'yard', position: { x: 230 + index * 130, y: 180 }, facing: 'S' })));
snapshot.projection.entities.push(...['翠兰 · 1号', '灶房帮手'].map((name, index) => ({ entityRef: 'actor_' + String(index).repeat(32), name, appearanceEpoch: '0', sceneId: 'yard', position: { x: 250 + index * 20, y: 180 }, facing: 'S' })));
snapshot.projection.entities.push({ entityRef: hiddenOwner, name: '获准显示的持有人', appearanceEpoch: '0', sceneId: null, position: null, facing: 'S' });
snapshot.projection.items.push({ entityRef: heldRef, name: '借用的工具', location: { kind: 'held', ownerRef: snapshot.projection.self.entityRef }, resourceRevision: '1', transferable: true, publicBorrowable: true, fields: [{ key: 'loan', label: '借用情况', value: '待实际归还' }] });
snapshot.projection.items.push({ entityRef: 'item_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', name: '当前获准查看的物件', location: { kind: 'held', ownerRef: hiddenOwner }, resourceRevision: '1', transferable: false, publicBorrowable: false, fields: [] });
snapshot.projection.observations.push({ observationRef: 'note_ffffffffffffffffffffffffffffffff', category: 'Claim', statement: '这是一条尚未核实的现场陈述。', sourceSeq: '9', fields: [{ key: 'source', label: '来源', value: '当面听闻' }], shareable: true });
snapshot.projection.objectives.push({ objectiveId: 'current', label: '核对当前已知的准备', status: 'active' });
snapshot.projection.claims.push({ claimRef: 'claim_gggggggggggggggggggggggggggggggg', speakerRef: firstRef, speakerName: '翠兰', text: '我想先看看安排。', channel: 'public', sourceSeq: '8' });
validateSpatial('SnapshotV2', snapshot);
let denied = false; let socket;
const wires = [];
const http = createServer((_request, response) => { response.writeHead(404, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ schemaVersion: 2, code: 'OUTCOME_UNKNOWN' })); });
const io = new Server(http);
io.on('connection', connected => {
  socket = connected;
  connected.on('session.subscribe', (_request, reply) => reply(structuredClone(snapshot)));
  for (const type of ['control.resume', 'control.take']) connected.on(type, (raw, reply) => {
    const request = JSON.parse(raw); snapshot.viewId = 'reading-view-controlled'; snapshot.projection.self.controlEpoch = '3'; snapshot.projection.self.canControl = true;
    reply({ schemaVersion: 2, sessionId: request.sessionId, nonce: request.nonce, controlEpoch: '3', observedSeq: snapshot.snapshotSeq, snapshot: structuredClone(snapshot) });
  });
  connected.on('sync.request', (raw, reply) => {
    const request = JSON.parse(raw);
    reply(denied ? { schemaVersion: 2, code: 'FORBIDDEN', message: '当前已无权读取。' } : { schemaVersion: 2, type: 'world.batch', sessionId: request.sessionId, viewId: request.viewId, fromExclusive: request.cursor, throughSeq: request.cursor, events: [] });
  });
  connected.on('player.action.request', (raw, reply) => {
    const request = JSON.parse(raw); wires.push(request);
    reply({ schemaVersion: 2, sessionId: request.sessionId, clientActionId: request.clientActionId, status: 'Accepted', code: 'NO_CHANGE', observedSeq: snapshot.snapshotSeq, actionEventRange: null, result: {} });
  });
});
function publish(change) {
  const fromExclusive = snapshot.snapshotSeq;
  change(snapshot.projection); snapshot.snapshotSeq = String(BigInt(fromExclusive) + 1n);
  socket.emit('world.batch', { schemaVersion: 2, type: 'world.batch', sessionId: snapshot.sessionId, viewId: snapshot.viewId, fromExclusive, throughSeq: snapshot.snapshotSeq, events: [{ sessionSeq: snapshot.snapshotSeq, eventId: `reading-${snapshot.snapshotSeq}`, kind: 'projection.replace', payload: { projection: structuredClone(snapshot.projection) } }] });
}
const check = name => { report.checks.push({ name, status: 'PASS' }); console.log(JSON.stringify({ check: name })); };
let vite; let browser; let page;
try {
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${http.address().port}`;
  vite = await createVite({ root: resolve(repository, 'frontend'), configFile: resolve(repository, 'frontend/vite.config.mjs'), configLoader: 'native', cacheDir: resolve(output, 'vite-cache'), server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] }, proxy: { '/api': { target: origin }, '/socket.io': { target: origin, ws: true } } } });
  await vite.listen();
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : [] });
  report.browserVersion = browser.version();
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 }); page.setDefaultTimeout(5000);
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.addInitScript(() => sessionStorage.setItem('xiyou.guest.v1', JSON.stringify({ token: 'reading-fixture', userId: 'reading-user', name: '阅读检查' })));
  await page.goto(`${vite.resolvedUrls.local[0]}spatial/spatial-room`);
  await page.getByRole('button', { name: '恢复本人控制', exact: true }).click();
  await until(() => page.evaluate(async () => (await import('/src/state/spatial-store.ts')).spatialState.value.inputReady), '取得页面输入控制');
  await page.getByRole('button', { name: '行囊', exact: true }).click();
  const recipientNames = await page.getByLabel('交接给', { exact: true }).locator('option').allTextContents();
  const sameNamePeople = recipientNames.filter(name => name.endsWith(' · 翠兰'));
  assert.equal(new Set(recipientNames).size, recipientNames.length, '合法姓名含旧编号格式时完整收件人标签也不碰撞');
  assert.equal(sameNamePeople.length, 2);
  assert.equal(new Set(sameNamePeople).size, 2, '同名收件人必须有玩家可辨认的不同标记');
  await page.getByLabel('交接给', { exact: true }).selectOption({ label: sameNamePeople[0] });
  await page.getByRole('button', { name: '关闭行囊', exact: true }).click();
  const secondPersonPixel = await page.getByTestId('spatial-map').evaluate(svg => {
    const point = new DOMPoint(360, 180).matrixTransform(svg.getScreenCTM());
    return { x: Math.round(point.x), y: Math.round(point.y) };
  });
  await page.mouse.click(secondPersonPixel.x, secondPersonPixel.y);
  assert.equal(await page.locator('#spatial-selection-heading').innerText(), sameNamePeople[1], '地图所点人物与可见收件人标记一致');
  await page.getByRole('button', { name: '行囊', exact: true }).click();
  assert.equal(await page.getByLabel('交接给', { exact: true }).inputValue(), '', '地图换选另一个人时不保留旧收件人');
  assert.equal(await page.locator('.spatial-inventory').getByRole('button', { name: '交给对方', exact: true }).isDisabled(), true);
  await page.getByLabel('交接给', { exact: true }).selectOption({ label: sameNamePeople[1] });
  await page.locator('.spatial-inventory').getByRole('button', { name: '交给对方', exact: true }).click();
  await until(() => wires.some(w => w.action.kind === 'transfer_item'), '按可见标记选择的交接请求发出');
  assert.equal(wires.find(w => w.action.kind === 'transfer_item').action.recipientRef, secondRef);
  const recipientImage = resolve(output, 'same-name-recipient.png'); await page.screenshot({ path: recipientImage, fullPage: true });
  report.screenshots.push({ file: 'same-name-recipient.png', sha256: sha256(await readFile(recipientImage)), viewport: { width: 1600, height: 1000 }, sameNamePeople, secondPersonPixel });
  await page.getByRole('button', { name: '手记', exact: true }).click();
  assert.deepEqual((await page.getByLabel('分享给', { exact: true }).locator('option').allTextContents()).filter(name => name.endsWith(' · 翠兰')), sameNamePeople);
  await page.getByRole('button', { name: '交谈', exact: true }).click();
  await page.getByLabel('交谈范围', { exact: true }).selectOption('directed');
  assert.deepEqual((await page.getByLabel('交谈对象', { exact: true }).locator('option').allTextContents()).filter(name => name.endsWith(' · 翠兰')), sameNamePeople);
  await page.getByRole('button', { name: '关闭交谈', exact: true }).click();
  const collisionPixel = await page.getByTestId('spatial-map').evaluate(svg => {
    const point = new DOMPoint(250, 180).matrixTransform(svg.getScreenCTM()); return { x: Math.round(point.x), y: Math.round(point.y) };
  });
  await page.mouse.click(collisionPixel.x, collisionPixel.y);
  const collisionLabel = await page.locator('#spatial-selection-heading').innerText();
  assert.match(collisionLabel, /号 · 翠兰 · 1号$/);
  await page.getByRole('button', { name: '行囊', exact: true }).click();
  await page.getByLabel('交接给', { exact: true }).selectOption({ label: collisionLabel });
  await page.locator('.spatial-inventory').getByRole('button', { name: '交给对方', exact: true }).click();
  await until(() => wires.filter(w => w.action.kind === 'transfer_item').length === 2, '含编号的合法姓名收件人请求发出');
  assert.equal(wires.filter(w => w.action.kind === 'transfer_item').at(-1).action.recipientRef, 'actor_' + '0'.repeat(32));
  const collisionImage = resolve(output, 'legal-name-recipient.png'); await page.screenshot({ path: collisionImage, fullPage: true });
  report.screenshots.push({ file: 'legal-name-recipient.png', sha256: sha256(await readFile(collisionImage)), viewport: { width: 1600, height: 1000 }, collisionPixel, collisionLabel });
  await page.getByRole('button', { name: '关闭行囊', exact: true }).click();
  check('真实点选第二位同名人物后清除旧收件人；地图/交接/分享/定向标记一致，按可见标记发送准确引用');
  await page.setViewportSize({ width: 390, height: 844 });
  await until(() => page.locator('button.spatial-map-label').count().then(count => count === 5), '五个密集人物具有独立屏幕标签');
  await until(() => page.evaluate(() => {
    const map = document.querySelector('.spatial-map-viewport').getBoundingClientRect(); const box = document.querySelector('.spatial-label-guides').viewBox.baseVal;
    return Math.abs(box.width - map.width) < 0.01 && Math.abs(box.height - map.height) < 0.01;
  }), '标签排布已收到当前窄视口真实尺寸');
  const geometry = await page.evaluate(() => {
    const map = document.querySelector('.spatial-map-viewport').getBoundingClientRect();
    const labels = [...document.querySelectorAll('button.spatial-map-label')].map(element => { const r = element.getBoundingClientRect(); return { name: element.textContent, x: r.x, y: r.y, width: r.width, height: r.height, fontSize: Number.parseFloat(getComputedStyle(element).fontSize) }; });
    const bodies = [...document.querySelectorAll('.spatial-person')].map(element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    return { map: { x: map.x, y: map.y, width: map.width, height: map.height }, labels, bodies };
  });
  const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  for (const label of geometry.labels) {
    assert.ok(label.fontSize >= 14 && label.width >= 44 && label.height >= 44, '文字与点击区不随地图缩小');
    assert.ok(label.x >= geometry.map.x && label.y >= geometry.map.y && label.x + label.width <= geometry.map.x + geometry.map.width && label.y + label.height <= geometry.map.y + geometry.map.height, '边缘文字留在地图显示范围内');
    for (const other of geometry.labels) if (other !== label) assert.equal(intersects(label, other), false, '人物标签不能互相覆盖');
    for (const body of geometry.bodies) assert.equal(intersects(label, body), false, '人物图形与脚底不能被文字卡覆盖');
  }
  await page.locator('button.spatial-map-label').filter({ hasText: sameNamePeople[1] }).click();
  await page.getByRole('button', { name: '在当前位置查看', exact: true }).click();
  await until(() => wires.some(w => w.action.kind === 'inspect'), '点击同名标签的查看请求发出');
  assert.equal(wires.find(w => w.action.kind === 'inspect').action.targetRef, secondRef, '独立标签不能把同名对象换成另一个实体');
  const labelsImage = resolve(output, 'labels-narrow-five.png'); await page.screenshot({ path: labelsImage, fullPage: true });
  report.screenshots.push({ file: 'labels-narrow-five.png', sha256: sha256(await readFile(labelsImage)), viewport: { width: 390, height: 844 }, geometry });
  await page.setViewportSize({ width: 1600, height: 1000 });
  check('五人密集标签在窄视口保持14px文字/44px入口、不裁切重叠，点击同名标签仍选中原引用');
  assert.equal(await page.locator('.spatial-reading-pane').count(), 0, '阅读区按需展开');
  await page.getByRole('button', { name: '行囊', exact: true }).click();
  await page.getByRole('heading', { name: '行囊与交接', exact: true }).waitFor();
  assert.equal(await page.getByTestId('spatial-map').isVisible(), true, '阅读时保留实际地图');
  await page.getByLabel('交接给', { exact: true }).selectOption({ label: sameNamePeople[1] });
  await page.locator('.spatial-inventory').getByRole('button', { name: '交给对方', exact: true }).click();
  await until(() => wires.some(w => w.action.kind === 'transfer_item'), '交接请求发出');
  assert.equal(wires.find(w => w.action.kind === 'transfer_item').action.recipientRef, secondRef, '同名人物仍使用所选公开引用');
  assert.equal((await page.locator('body').innerText()).includes(firstRef), false);
  assert.equal((await page.locator('body').innerText()).includes(hiddenOwner), false);
  check('按需行囊保留地图，同名人物交接使用准确引用且不展示内部标识');

  const beforeStops = wires.filter(w => w.action.kind === 'stop_move').length;
  publish(p => { p.self.position = { x: 150, y: 100 }; p.sceneTimeMs += 100; p.entities = p.entities.filter(e => e.entityRef !== secondRef); });
  await until(() => page.getByLabel('交接给', { exact: true }).inputValue().then(value => value === ''), '人物消失后清除交接对象');
  assert.equal(await page.locator('.spatial-inventory').getByRole('button', { name: '交给对方', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('heading', { name: '行囊与交接', exact: true }).isVisible(), true);
  const selfX = await page.evaluate(async () => (await import('/src/state/spatial-store.ts')).spatialState.value.snapshot.projection.self.position.x);
  assert.equal(selfX, 150, '面板打开时权威更新继续消费');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.spatial-reading-pane').count(), 0);
  assert.equal(wires.filter(w => w.action.kind === 'stop_move').length, beforeStops, '先关闭面板，不偷发停步');
  assert.equal(await page.getByRole('button', { name: '行囊', exact: true }).evaluate(button => button === document.activeElement), true, '关闭后焦点返回入口');
  await page.keyboard.press('Escape');
  await until(() => wires.filter(w => w.action.kind === 'stop_move').length === beforeStops + 1, '无面板时Escape只提交一次停步');
  check('阅读不暂停更新；引用失效清除收件人；Escape先关面板后停步且恢复焦点');

  await page.getByRole('button', { name: '手记', exact: true }).click();
  const notebook = page.locator('.spatial-notebook');
  assert.match(await notebook.innerText(), /他人陈述/);
  assert.match(await notebook.innerText(), /当面听闻/);
  assert.doesNotMatch(await notebook.innerText(), /世界事实/);
  publish(p => { p.observations = []; p.claims = []; p.objectives = [{ objectiveId: 'later', label: '后来已授权的下一步', status: 'active' }]; });
  await until(() => notebook.innerText().then(text => !text.includes('这是一条尚未核实的现场陈述')), '阅读区及时去除新投影中已无的记录');
  await page.getByRole('button', { name: '关闭手记', exact: true }).click();
  assert.match(await page.locator('.spatial-current-objective').innerText(), /后来已授权的下一步/);
  check('手记保留陈述与来源语义，关闭后回到当前投影而非旧阶段');

  await page.getByRole('button', { name: '交谈', exact: true }).click();
  await page.getByLabel('交谈内容', { exact: true }).fill('只在当前视角内的草稿');
  const desktop = resolve(output, 'reading-desktop.png'); await page.screenshot({ path: desktop, fullPage: true });
  report.screenshots.push({ file: 'reading-desktop.png', sha256: sha256(await readFile(desktop)), viewport: { width: 1600, height: 1000 } });
  await page.setViewportSize({ width: 390, height: 844 });
  const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  assert.ok(widths.content <= widths.viewport, '窄视口阅读区不能造成横向溢出');
  const narrow = resolve(output, 'reading-narrow.png'); await page.screenshot({ path: narrow, fullPage: true });
  report.screenshots.push({ file: 'reading-narrow.png', sha256: sha256(await readFile(narrow)), viewport: { width: 390, height: 844 } });
  denied = true;
  await page.evaluate(async () => (await import('/src/state/spatial-store.ts')).spatialClient.sync());
  await until(() => page.locator('.spatial-reading-pane').count().then(count => count === 0), '撤权后移除阅读区');
  const body = await page.locator('body').innerText();
  assert.doesNotMatch(body, /翠兰|当面听闻|只在当前视角内的草稿|授权阅读检查院落/);
  check('桌面与窄视口实际渲染；权限撤销时地图、人物、阅读区与草稿全部清除');
  assert.deepEqual(report.pageErrors, []); report.assessment = 'PASS';
} catch (error) {
  report.assessment = 'FAIL'; report.error = error.stack; console.error(error);
  if (page) await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  await browser?.close(); await vite?.close(); await new Promise(resolve => io.close(resolve));
  if (http.listening) await new Promise(resolve => http.close(resolve));
  report.finishedAt = new Date().toISOString(); report.resourcesClosed = true;
  await saveJSON(resolve(output, 'result.json'), report);
  console.log(JSON.stringify({ assessment: report.assessment, checks: report.checks.length, output }));
  if (report.assessment !== 'PASS') process.exitCode = 1;
}
