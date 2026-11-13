import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer as createVite } from 'vite';
import { startTestPostgres } from '../../backend/test-support/postgres.mjs';
import { createAuthorityServer } from '../../backend/server.mjs';
import { openDoor, startFollow, accepted } from '../../backend/test-support/gaolao-room.mjs';
import { repository, sourceIdentity, saveJSON, sha256, until } from './network-support.mjs';
import { browserRoom, snapshot, clientState, openReading, closeReading, selectObject } from './gaolao-real-support.mjs';

const checkGroup = process.env.HUD_CHECK_GROUP || 'all';
assert.ok(['all', 'remaining', 'camera'].includes(checkGroup), '只允许完整HUD或已说明的补证/相机组');
const output = resolve(process.env.FRONTEND_EVIDENCE_DIR || resolve(repository, '.agent-output/hud-v11/seven-states'));
await mkdir(output, { recursive: true });
const report = { checkGroup, scope: 'GZ-VIS-01/v1.1 HUD作者自查：两个真实Vue/HTTP/Socket/PG账号；玩家只走可见UI，NPC走官方受信受控策略。不是scene_role模型、真人手机或完整章矩阵。', source: await sourceIdentity(), startedAt: new Date().toISOString(), checks: [], humanActions: [], npcActions: [], recapResponses: [], pageErrors: [], screenshots: [], videos: [], windowErrors: [], geometrySamples: [] };
const check = (name, details = {}) => { report.checks.push({ name, status: 'PASS', ...details }); console.log(JSON.stringify({ check: name })); };
let database, server, vite, browser, room;

async function stable(page) {
  await page.evaluate(() => document.fonts.ready);
  await until(() => page.evaluate(() => {
    const map = document.querySelector('.spatial-map-viewport'), guide = document.querySelector('.spatial-label-guides');
    if (!map || !guide) return false;
    const b = map.getBoundingClientRect(), v = guide.viewBox.baseVal;
    return b.width > 0 && Math.abs(b.width - v.width) < 1 && Math.abs(b.height - v.height) < 1;
  }), '实际ResizeObserver尺寸与地图标签层一致');
  // 连续真实绘制帧布局不再变化才截图，不以固定sleep代替可见就绪状态。
  await until(() => page.evaluate(async () => {
    const key = () => JSON.stringify([...document.querySelectorAll('.spatial-map,.spatial-sidebar,.spatial-follow-strip,.spatial-action-bar,.spatial-tool-dock')].map(node => { const b = node.getBoundingClientRect(); return [node.getAttribute('viewBox'), b.x, b.y, b.width, b.height]; }));
    const first = key(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return first === key();
  }), 'HUD已到稳定布局帧');
}

async function geometry(page) {
  await stable(page);
  const p = (await snapshot(page)).projection;
  const followerNames = p.chapter.follows.filter(f => ['accepted', 'following', 'paused', 'arrived'].includes(f.status)).map(f => p.entities.find(e => e.entityRef === f.subjectRef)?.name).filter(Boolean);
  const g = await page.evaluate(followerNames => {
    const rect = node => { const b = node.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
    const visible = node => { const b = node.getBoundingClientRect(), s = getComputedStyle(node); return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const protectedPeople = [...document.querySelectorAll('.spatial-person')].filter(node => node.classList.contains('self') || node.classList.contains('selected') || followerNames.some(name => node.getAttribute('aria-label')?.endsWith(name)));
    const protectedNames = protectedPeople.map(node => node.getAttribute('aria-label')?.replace(/，本人$/, ''));
    const protectedRegions = protectedPeople.map(node => ({ kind: 'body', name: node.getAttribute('aria-label'), ...rect(node.querySelector('image,.spatial-actor-fallback')) }));
    for (const node of document.querySelectorAll('.spatial-target.selected,.spatial-item.selected')) protectedRegions.push({ kind: 'target', name: node.getAttribute('aria-label'), ...rect(node.querySelector('rect,path')) });
    for (const node of document.querySelectorAll('.spatial-map-label')) if (node.classList.contains('self') || node.classList.contains('selected') || protectedNames.includes(node.getAttribute('title'))) protectedRegions.push({ kind: 'name', name: node.textContent.trim(), ...rect(node) });
    const cards = [...document.querySelectorAll('.spatial-sidebar,.spatial-follow-strip,.spatial-receipts')].filter(visible).map(node => ({ kind: node.className, ...rect(node) }));
    const labels = [...document.querySelectorAll('button.spatial-map-label')].filter(visible).map(node => ({ text: node.textContent.trim(), font: parseFloat(getComputedStyle(node).fontSize), ...rect(node) }));
    const controls = [...document.querySelectorAll('.spatial-action-bar button,.spatial-tool-dock button,.spatial-map-toolbar button')].filter(visible).map(node => ({ text: node.textContent.trim(), ...rect(node) }));
    return { viewport: { width: innerWidth, height: innerHeight }, document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }, map: rect(document.querySelector('.spatial-map-viewport')), mapViewBox: document.querySelector('.spatial-map').getAttribute('viewBox'), cards, protectedRegions, labels, controls };
  }, followerNames);
  assert.equal(g.map.x, 0); assert.equal(g.map.y, 0);
  assert.equal(g.map.width, g.viewport.width, '阅读区不挤窄地图'); assert.equal(g.map.height, g.viewport.height, '地图占满当前视口');
  assert.ok(g.document.width <= g.viewport.width + 1 && g.document.height <= g.viewport.height + 1, '首屏无页面溢出');
  for (const label of g.labels) assert.ok(label.font >= 14 && label.width >= 44 && label.height >= 44, '地图字号14px/点击44px：' + label.text);
  for (const control of g.controls) {
    assert.ok(control.width >= 44 && control.height >= 44, '固定控件至少44px：' + control.text);
    assert.ok(control.x >= -1 && control.y >= -1 && control.x + control.width <= g.viewport.width + 1 && control.y + control.height <= g.viewport.height + 1, '固定控件留在首屏：' + control.text);
  }
  for (const card of g.cards) for (const protectedRegion of g.protectedRegions) {
    const r = protectedRegion;
    const separated = card.x + card.width <= r.x - 15.9 || card.x >= r.x + r.width + 15.9 || card.y + card.height <= r.y - 15.9 || card.y >= r.y + r.height + 15.9;
    assert.ok(separated, '浮卡与当前身体/姓名保持16px：' + JSON.stringify({ card, protectedRegion }));
  }
  return g;
}

async function capture(page, state, name = state) {
  const g = await geometry(page); const current = await snapshot(page); const file = name + '.png';
  report.geometrySamples.push({ state, name, geometry: g, snapshotSeq: current.snapshotSeq });
  if (checkGroup === 'camera' && ['main', 'dialogue'].includes(state)) return;
  await page.screenshot({ path: resolve(output, file) });
  report.screenshots.push({ state, file, sha256: sha256(await readFile(resolve(output, file))), geometry: g, authorization: { sessionId: current.sessionId, viewId: current.viewId, snapshotSeq: current.snapshotSeq, phase: current.projection.phase, contentVersion: current.projection.contentVersion, sceneId: current.projection.self.sceneId, follows: current.projection.chapter.follows, ending: current.projection.ending?.endingCode || null }, capturedAt: new Date().toISOString() });
  console.log(JSON.stringify({ capture: name, cards: g.cards }));
}

async function closeObjects(page) {
  const close = page.getByRole('button', { name: '关闭对象区', exact: true });
  if (await close.isVisible()) await close.click();
}
async function published(page, receipt) {
  return until(async () => { const s = await snapshot(page); return BigInt(s.snapshotSeq) >= BigInt(receipt.observedSeq) ? s : false; }, '本端授权投影达到实际收据水位');
}
async function endTogether(r) {
  const old = (await r.snapshot(0)).projection.chapter.endProposal;
  const receipt = accepted(await r.send(0, { kind: 'request_end', proposalId: crypto.randomUUID(), proposalVersion: old?.proposalVersion || '0', scope: 'chapter' }));
  const first = (await published(r.pages[0], receipt)).projection.chapter.endProposal;
  const second = await until(async () => { const e = (await r.snapshot(1)).projection.chapter.endProposal; return e?.proposalId === first.proposalId && e.status === 'pending' ? e : false; }, '第二账号实际看见同一确认轮');
  accepted(await r.send(1, { kind: 'confirm_end', proposalId: second.proposalId, proposalVersion: second.proposalVersion }));
  for (const page of r.pages) await until(async () => (await snapshot(page)).projection.ending?.endingCode === 'GZ-E03', '所有客户端收到实际暂告一段');
}

try {
  assert.equal(report.source.status, '', '生产与载体均须冻结后取证');
  database = await startTestPostgres('hud-v11', { outputSubdirectory: 'hud-v11' });
  server = await createAuthorityServer({ pool: database.pool }); const address = await server.listen(0), origin = 'http://127.0.0.1:' + address.port;
  vite = await createVite({ root: resolve(repository, 'frontend'), configFile: resolve(repository, 'frontend/vite.config.mjs'), configLoader: 'native', cacheDir: resolve(output, 'vite-cache'), server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] }, proxy: { '/api': { target: origin }, '/socket.io': { target: origin, ws: true } } } });
  await vite.listen(); const baseURL = 'http://127.0.0.1:' + vite.httpServer.address().port;
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : [] }); report.browserVersion = browser.version();
  const recordingBrowser = { newContext: async options => {
    const context = await browser.newContext({ ...options, recordVideo: { dir: resolve(output, 'recordings'), size: { width: 1600, height: 1000 } } });
    await context.addInitScript(() => { window.__hudErrors = []; window.addEventListener('error', event => window.__hudErrors.push({ message: event.message, time: performance.now() })); });
    return context;
  } };
  room = await browserRoom({ server, browser: recordingBrowser, baseURL, count: 2, report });
  const main = room.pages[0], carer = room.role('B'), leader = room.pages[carer];
  await until(() => main.locator('[data-spatial-self] [data-art-frame]').count(), '已公开高才原图实际载入');
  if (checkGroup !== 'remaining') {
  await capture(main, 'main');
  assert.equal(await main.getByRole('button', { name: '回看', exact: true }).isDisabled(), true, '运行中不冒充完整回顾');
  await main.setViewportSize({ width: 390, height: 844 }); await capture(main, 'main', 'narrow-main');
  await main.setViewportSize({ width: 1600, height: 1000 }); await stable(main);
  check('全屏首屏、固定入口、14px/44px及运行中回看边界');

  const dialogueText = '先联系门内的人，再准备安全开门。';
  const spoken = accepted(await room.send(0, { kind: 'speak', text: dialogueText, channel: 'public', recipientRefs: [] }));
  await published(main, spoken); await until(() => main.locator('.spatial-claims').getByText(dialogueText, { exact: true }).count(), '真实说话进入授权交谈');
  await main.locator('.spatial-reading-content').evaluate(node => { node.scrollTop = 0; });
  await capture(main, 'dialogue');
  const before = (await room.snapshot(1)).projection.self.position;
  await room.go(1, room.C('C19'));
  assert.notDeepEqual((await room.snapshot(1)).projection.self.position, before); assert.equal(await main.locator('.spatial-reading-pane').isVisible(), true, '个人阅读不会暂停其他真实玩家');
  const ownBeforeEscape = (await snapshot(main)).projection.movement;
  await main.keyboard.press('Escape'); assert.equal(await main.locator('.spatial-reading-pane').count(), 0);
  assert.equal(await main.getByRole('button', { name: '交谈', exact: true }).evaluate(node => document.activeElement === node), true, '关闭阅读返回实际触发控件焦点');
  assert.deepEqual((await snapshot(main)).projection.movement, ownBeforeEscape, 'Escape先关闭阅读，不另发停步');
  check('560px对话、内部滚动、其他玩家继续行走及Esc焦点');

  // 复用原正式救援路径；仅在真实得到观察/物品后插入截图，不改变动作、超时或世界状态。
  const send = room.send; let inventoryCaptured = false, notebookCaptured = false;
  room.send = async (key, action) => {
    const receipt = await send(key, action);
    if (key === carer && action.kind === 'take_item' && !inventoryCaptured) {
      const visible = (await published(leader, receipt)).projection;
      assert.ok(visible.items.some(item => item.entityRef === action.itemRef && item.location.kind === 'held' && item.location.ownerRef === visible.self.entityRef));
      const craft = room.role('C'); await room.go(craft, room.C('C14'));
      const craftName = (await room.snapshot(craft)).projection.self.name;
      const recipient = await until(async () => (await snapshot(leader)).projection.entities.find(person => person.name === craftName), '另一真人实际走近后出现在可选收件人中');
      await openReading(leader, '行囊'); await leader.locator('.spatial-reading-content').evaluate(node => { node.scrollTop = 0; });
      await capture(leader, 'inventory'); await leader.setViewportSize({ width: 390, height: 844 }); await capture(leader, 'inventory', 'narrow-reading');
      const held = (await snapshot(leader)).projection.items.find(item => item.entityRef === action.itemRef);
      const handed = accepted(await send(carer, { kind: 'transfer_item', itemRef: held.entityRef, expectedItemRevision: held.resourceRevision, recipientRef: recipient.entityRef }));
      const received = (await published(room.pages[craft], handed)).projection;
      const receivedItem = received.items.find(item => item.name === held.name);
      assert.equal(receivedItem.location.ownerRef, received.self.entityRef, '390px实际近距交接到唯一可见收件人');
      const originalOwner = received.entities.find(person => person.name === visible.self.name); assert.ok(originalOwner);
      const returned = accepted(await send(craft, { kind: 'transfer_item', itemRef: receivedItem.entityRef, expectedItemRevision: receivedItem.resourceRevision, recipientRef: originalOwner.entityRef }));
      const restored = (await published(leader, returned)).projection;
      assert.equal(restored.items.find(item => item.entityRef === action.itemRef).location.ownerRef, restored.self.entityRef, '正常归还后继续原救援路径');
      await leader.setViewportSize({ width: 1600, height: 1000 }); await closeReading(leader); inventoryCaptured = true;
    }
    return receipt;
  };
  const interact = room.interact;
  room.interact = async (key, name, operationId, parameters) => {
    const receipt = await interact(key, name, operationId, parameters);
    if (key === carer && operationId === 'gz-contact' && !notebookCaptured) {
      await published(leader, receipt); await openReading(leader, '手记');
      await until(() => leader.locator('.spatial-notebook article').count(), '实际联络后有授权手记');
      await capture(leader, 'notebook'); await closeReading(leader); notebookCaptured = true;
    }
    return receipt;
  };
  await openDoor(room); assert.ok(inventoryCaptured && notebookCaptured, '截图来自实际持物和实际授权记录');
  room.send = send; room.interact = interact;
  } else {
    // 补证组只重建原CI风险窗口必需的合法开门前置，不重复已完成的主态/阅读/随行截图。
    await openDoor(room);
  }
  // H1两次CI原错：390px下点击私人包裹被常驻收据遮住。沿原可见入口、原5000ms点击和水位断言复核。
  await leader.setViewportSize({ width: 390, height: 844 }); await stable(leader);
  const retained = (await clientState(leader)).actions.filter(action => action.receipt); assert.ok(retained.length > 0, '原风险窗口已有真实动作收据');
  await closeReading(leader); await leader.getByRole('button', { name: '动作确认', exact: true }).click();
  assert.ok(await leader.locator('.spatial-receipts li').count(), '先从真实入口展开已有收据，再进入对象区');
  const parcel = await room.entity(carer, '私人包裹');
  const refused = await room.send(carer, { kind: 'take_item', itemRef: parcel.entityRef, expectedItemRevision: parcel.resourceRevision });
  assert.equal(refused.status, 'Rejected'); assert.equal(refused.code, 'CONSENT_REQUIRED');
  const refusalView = await published(leader, refused);
  assert.deepEqual(refusalView.projection.items.find(item => item.entityRef === parcel.entityRef).location, parcel.location, '未许可的精确物件保持原物权');
  assert.equal(await leader.locator('.spatial-receipts').count(), 0, '收据须经可见入口打开，不盖住当前对象');
  await capture(leader, 'interaction', 'private-rejected-390');
  check('H1原CI私物入口：可见选择/真实拿取被规则拒绝，收据不截获指针');
  await leader.setViewportSize({ width: 1600, height: 1000 });
  await closeReading(leader); await closeObjects(leader);
  if (checkGroup !== 'remaining') {
  await startFollow(room);
  await until(async () => (await snapshot(leader)).projection.chapter.follows.some(f => ['accepted', 'following', 'arrived'].includes(f.status)), '本人接受的真实随行投影');
  await closeObjects(leader); await capture(leader, 'follow');
  assert.equal(await leader.getByRole('button', { name: '停下我的脚步', exact: true }).isVisible(), true);
  assert.equal(await leader.getByRole('button', { name: '暂停带路', exact: true }).count(), 0, '玩家不代提交NPC本人暂停');
  check('真实联系/持物/手记/本人同意随行七态入口，无世界事实注入');

  const destination = room.content.chapterRules.safeDestinations.find(d => d.destinationId === 'front-guest-room');
  await room.go(carer, destination);
  const arrived = await until(async () => { const f = (await room.snapshot('cuilan')).projection.chapter.follows[0]; return f.status === 'arrived' ? f : false; }, '随行者按权威路线实际到达');
  accepted(await room.interact('cuilan', 'self', 'gz-confirm-settlement', { consentId: arrived.consentId, expectedConsentVersion: arrived.consentVersion }));
  }
  await room.go(carer, room.R('R03')); await closeObjects(leader);
  const witness = await room.entity(carer, '茶棚见证人'); await selectObject(leader, witness.entityRef); await capture(leader, 'road');
  await leader.getByRole('button', { name: '关闭对象区', exact: true }).click();
  await leader.getByRole('button', { name: '动作确认', exact: true }).click();
  await geometry(leader); assert.ok(await leader.locator('.spatial-receipts li').count(), '折叠确认入口仍展示真实收据');
  await leader.getByRole('button', { name: '关闭动作确认', exact: true }).click();
  check('正式出口到庄外、选中目标16px保护及真实收据面板');

  await endTogether(room); await openReading(main, '回看');
  await until(() => main.locator('.gaolao-recap-entries li').count(), '实际终态HTTP授权回顾');
  await capture(main, 'recap');
  await main.reload(); await until(async () => (await clientState(main)).connection === 'online' && (await snapshot(main))?.projection.ending?.endingCode === 'GZ-E03', '终态刷新授权就绪');
  await openReading(main, '回看'); await until(() => main.locator('.gaolao-recap-entries li').count(), '终态刷新后回顾实际恢复');
  await geometry(main); assert.equal(await main.getByRole('button', { name: '恢复本人控制', exact: true }).count(), 0);
  check('真实终局回顾与刷新恢复，未放开运行中回顾或终态控制');

  for (const state of (checkGroup === 'all' ? ['main', 'follow', 'road', 'dialogue', 'inventory', 'notebook', 'recap'] : checkGroup === 'camera' ? ['follow', 'road', 'inventory', 'notebook', 'recap'] : ['road', 'recap'])) assert.ok(report.screenshots.some(s => s.state === state), '采用基准七态齐全：' + state);
  report.windowErrors = await Promise.all(room.pages.map(page => page.evaluate(() => window.__hudErrors)));
  assert.deepEqual(report.windowErrors, [[], []]); assert.deepEqual(report.pageErrors, []);
  report.sourceEnd = await sourceIdentity(); assert.deepEqual(report.sourceEnd, report.source);
  const videos = room.pages.map(page => page.video()); await room.close(); room = null;
  for (let i = 0; i < videos.length; i++) { const file = 'actual-ui-' + (i + 1) + '.webm'; await videos[i].saveAs(resolve(output, file)); report.videos.push({ file, sha256: sha256(await readFile(resolve(output, file))) }); }
  report.assessment = 'PASS';
} catch (error) {
  report.assessment = 'FAIL'; report.error = error.stack; console.error(error); process.exitCode = 1;
  if (room) for (let i = 0; i < room.pages.length; i++) {
    try { await room.pages[i].screenshot({ path: resolve(output, 'failed-' + i + '.png') }); report['failedSnapshot' + i] = await snapshot(room.pages[i]); report.windowErrors.push(await room.pages[i].evaluate(() => window.__hudErrors)); } catch (captureError) { report.pageErrors.push({ message: captureError.message }); }
  }
} finally {
  await room?.close(); await browser?.close(); await vite?.close(); await server?.close(); await database?.stop();
  report.finishedAt = new Date().toISOString(); await saveJSON(resolve(output, 'result.json'), report);
  console.log(JSON.stringify({ assessment: report.assessment, output, checks: report.checks.length, screenshots: report.screenshots.length }));
}
