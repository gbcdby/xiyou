import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer as createVite } from 'vite';
import { startTestPostgres } from '../../backend/test-support/postgres.mjs';
import { createAuthorityServer } from '../../backend/server.mjs';
import { accepted, openDoor, cleanupPublic, disguise, gatherSources, investigate, endTogether, take } from '../../backend/test-support/gaolao-room.mjs';
import { repository, sourceIdentity, saveJSON, sha256, until, sleep } from './network-support.mjs';
import { browserRoom, snapshot, clientState, openReading, closeReading, selectObject, waitHumanReceipt } from './gaolao-real-support.mjs';
import { recordOfflineRecovery } from './gaolao-offline-diagnostics.mjs';

const output = resolve(process.env.FRONTEND_EVIDENCE_DIR || resolve(repository, '.agent-output/adv001-33-a2-integration/real-browser'));
await mkdir(output, { recursive: true });
const report = { scope: 'A2作者自查：真实Vue/独立Chromium账号/HTTP/Socket/PostgreSQL；人类动作经UI，NPC为正式受信受控策略；不是模型或真人趣味验收', source: await sourceIdentity(), startedAt: new Date().toISOString(), clock: '真实墙钟与服务端场景维护；不是900秒矩阵', checks: [], humanActions: [], npcActions: [], recapResponses: [], pageErrors: [], screenshots: [], cleanup: [] };
report.workflowSha256 = sha256(await readFile(resolve(repository, '.github/workflows/ci.yml')));
const check = (name, details = {}) => { report.checks.push({ name, status: 'PASS', ...details }); console.log(JSON.stringify({ check: name })); };
let database, server, vite, browser, activeRoom, heldAck;
const rooms = [];
async function image(page, name, fullPage = true) { const path = resolve(output, name); await page.screenshot({ path, fullPage }); report.screenshots.push({ file: name, sha256: sha256(await readFile(path)), viewport: page.viewportSize() }); }
const latestConsent = async (r, actor, purpose) => (await r.snapshot(actor)).projection.chapter.consents.filter(consent => consent.purpose === purpose).sort((a, b) => BigInt(a.version) > BigInt(b.version) ? -1 : 1)[0];

async function stageSummary(page, label) {
  const p = (await snapshot(page)).projection;
  const expected = p.ending?.title || p.chapter.progress.at(-1)?.label || p.objectives.find(objective => objective.status === 'active')?.label;
  await until(async () => (await page.locator('.spatial-current-objective h2').innerText()) === expected, label + '显示当前授权进展');
  if (p.ending || p.chapter.progress.length) assert.doesNotMatch(await page.locator('.spatial-current-objective').innerText(), /先联系受困者，再准备安全开门/);
}

async function narrowReady(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await until(() => page.evaluate(() => { const map = document.querySelector('.spatial-map-viewport').getBoundingClientRect(), box = document.querySelector('.spatial-label-guides').viewBox.baseVal; return Math.abs(box.width - map.width) < 1 && Math.abs(box.height - map.height) < 1; }), '窄屏 ResizeObserver 与实际地图尺寸一致');
  const geometry = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth, labels: [...document.querySelectorAll('button.spatial-map-label')].map(label => ({ font: Number.parseFloat(getComputedStyle(label).fontSize), width: label.getBoundingClientRect().width, height: label.getBoundingClientRect().height })) }));
  assert.ok(geometry.content <= geometry.viewport);
  for (const label of geometry.labels) assert.ok(label.font >= 14 && label.width >= 44 && label.height >= 44);
  return geometry;
}

async function confirmEndViaUI(r, scope) {
  const old = (await r.snapshot(0)).projection.chapter.endProposal;
  accepted(await r.send(0, { kind: 'request_end', proposalId: crypto.randomUUID(), proposalVersion: old?.proposalVersion || '0', scope }));
  const request = report.humanActions.at(-1).request.action;
  for (let index = 1; index < r.count; index++) {
    const proposal = await until(async () => { const current = (await r.snapshot(index)).projection.chapter.endProposal; return current?.proposalId === request.proposalId && current.status === 'pending' ? current : false; }, '该玩家实际收到同一轮确认');
    await openReading(r.pages[index], '进展');
    await r.pages[index].getByRole('button', { name: '我确认本轮选择', exact: true }).waitFor();
    accepted(await r.send(index, { kind: 'confirm_end', proposalId: proposal.proposalId, proposalVersion: proposal.proposalVersion }));
  }
}

async function endSeparatelyViaUI(r) {
  await r.go(0, r.C('C19')); for (const key of ['tang', 'wukong', 'bajie']) await r.go(key, r.C('C19'));
  await confirmEndViaUI(r, 'recruitment'); accepted(await r.interact(0, '庄口会面点', 'gz-plan-departure'));
  for (const key of ['tang', 'wukong']) await r.go(key, r.content.chapterRules.departure);
  await r.go('bajie', r.content.chapterRules.waiting[0]); accepted(await r.interact('tang', 'self', 'gz-finish-separation'));
}

async function rescueViaUI(r, { changes = false } = {}) {
  await openDoor(r); const carer = r.role('B');
  if (changes) await privateItemsViaUI(r);
  let p = (await r.snapshot(carer)).projection; let cuilan = await r.entity(carer, '翠兰');
  accepted(await r.send(carer, { kind: 'propose_follow', subjectRef: cuilan.entityRef, leaderRef: p.self.entityRef, destinationId: 'front-guest-room', expectedConsentVersion: '0' }));
  let consent = await latestConsent(r, 'cuilan', 'follow');
  await openReading(r.pages[carer], '进展');
  assert.equal(await r.pages[carer].getByRole('button', { name: '我同意这次安排', exact: true }).count(), 0, '真人不能替翠兰本人回应');
  if (changes) {
    accepted(await r.send('cuilan', { kind: 'respond_consent', consentId: consent.consentId, expectedConsentVersion: consent.version, response: 'defer' }));
    await until(async () => (await r.pages[carer].locator('.gaolao-chapter-state').innerText()).includes('本人暂缓'), '真实本人暂缓显示');
    consent = await latestConsent(r, 'cuilan', 'follow');
    p = (await r.snapshot(carer)).projection; cuilan = await r.entity(carer, '翠兰');
    accepted(await r.send(carer, { kind: 'propose_follow', subjectRef: cuilan.entityRef, leaderRef: p.self.entityRef, destinationId: 'tea-back-room', expectedConsentVersion: consent.version }));
    consent = await latestConsent(r, 'cuilan', 'follow');
    accepted(await r.send('cuilan', { kind: 'respond_consent', consentId: consent.consentId, expectedConsentVersion: consent.version, response: 'accept' }));
    consent = await latestConsent(r, 'cuilan', 'follow');
    accepted(await r.send('cuilan', { kind: 'withdraw_consent', consentId: consent.consentId, expectedConsentVersion: consent.version }));
    await openReading(r.pages[carer], '进展');
    await until(async () => (await r.pages[carer].locator('.gaolao-chapter-state').innerText()).includes('已撤回或被新安排替代'), '真实本人撤回显示');
    consent = await latestConsent(r, 'cuilan', 'follow'); p = (await r.snapshot(carer)).projection; cuilan = await r.entity(carer, '翠兰');
    accepted(await r.send(carer, { kind: 'propose_follow', subjectRef: cuilan.entityRef, leaderRef: p.self.entityRef, destinationId: 'tea-back-room', expectedConsentVersion: consent.version }));
    consent = await latestConsent(r, 'cuilan', 'follow');
  }
  accepted(await r.send('cuilan', { kind: 'respond_consent', consentId: consent.consentId, expectedConsentVersion: consent.version, response: 'accept' }));
  const destination = r.content.chapterRules.safeDestinations.find(destination => destination.destinationId === (changes ? 'tea-back-room' : 'front-guest-room'));
  await r.go(carer, destination);
  const follow = await until(async () => { const follow = (await r.snapshot('cuilan')).projection.chapter.follows[0]; return follow.status === 'arrived' ? follow : false; }, '翠兰实际到达所选安置点');
  await openReading(r.pages[carer], '进展');
  await until(async () => (await r.pages[carer].locator('.gaolao-chapter-state').innerText()).includes('已到达，尚未确认安置'), '到达与本人安置确认分开');
  accepted(await r.interact('cuilan', 'self', 'gz-confirm-settlement', { consentId: follow.consentId, expectedConsentVersion: follow.consentVersion }));
  await until(async () => (await r.snapshot(carer)).projection.chapter.progress.some(field => field.key === 'CuilanSafe' && field.value === true) || (await r.pages[carer].locator('.gaolao-chapter-state').innerText()).includes('已确认安置'), '服务端确认安置后显示');
  await stageSummary(r.pages[carer], '救援安置后');
  check(`${r.count}人：真实救援、本人回应与实际安置`, { changes, destination: destination.destinationId });
}

async function privateItemPublication(r, receipt, label) {
  const player = r.role('B'), matches = report.humanActions.filter(entry => entry.player === player && entry.request.clientActionId === receipt.clientActionId);
  assert.equal(matches.length, 1, '私物屏障必须绑定本次页面动作的真实收据');
  const { request } = matches[0]; assert.deepEqual(matches[0].receipt, receipt); assert.equal(receipt.sessionId, request.sessionId);
  const itemRef = request.action.itemRef ?? request.action.parameters.itemRefs[0];
  const started = Date.now(), publication = { label, player, clientActionId: request.clientActionId, sessionId: request.sessionId, viewId: request.viewId, itemRef, receiptSeq: receipt.observedSeq, samples: [] };
  (report.privateItemPublications ??= []).push(publication);
  // 只等待同一授权视图到达回执水位；物权断言在屏障之后执行，绝不以正确物主作为等待条件。
  return until(async () => {
    const current = await snapshot(r.pages[player]); publication.snapshot = current;
    const item = current?.projection.items.find(item => item.entityRef === itemRef);
    publication.samples.push({ ms: Date.now() - started, viewId: current?.viewId, snapshotSeq: current?.snapshotSeq, self: current?.projection.self, movement: current?.projection.movement, item });
    assert.equal(current?.sessionId, request.sessionId, '私物读写仍在原房间');
    assert.equal(current.viewId, request.viewId, '私物精确引用仍属于原授权视图');
    assert.equal(current.projection.self.entityRef, request.actorRef, '私物读写仍由原玩家观察');
    return BigInt(current.snapshotSeq) >= BigInt(receipt.observedSeq) ? current : false;
  }, label + '公开投影到达本次回执水位');
}

async function privateItemsViaUI(r) {
  const carer = r.role('B'); const geometry = await narrowReady(r.pages[carer]); let parcel = await r.entity(carer, '私人包裹');
  let receipt = await r.send(carer, { kind: 'take_item', itemRef: parcel.entityRef, expectedItemRevision: parcel.resourceRevision });
  assert.equal(receipt.status, 'Rejected'); assert.equal(receipt.code, 'CONSENT_REQUIRED');
  const refused = await privateItemPublication(r, receipt, '未许可拿取');
  assert.deepEqual(refused.projection.items.find(item => item.entityRef === parcel.entityRef).location, parcel.location, '未许可的拿取不改变原物权');
  const requested = accepted(await r.interact(carer, '翠兰', 'gz-request-private-items', { itemRefs: [parcel.entityRef], expectedConsentVersion: '0' }));
  const requestedSnapshot = await privateItemPublication(r, requested, '提出私物请求');
  await image(r.pages[carer], `gaolao-${r.count}-private-request-narrow.png`);
  let consent = await latestConsent(r, 'cuilan', 'private_items');
  const privateRecord = requestedSnapshot.projection.observations.findLast(observation => observation.fields.some(field => field.key === 'consent' && field.value === consent.consentId));
  assert.ok(privateRecord && !privateRecord.shareable);
  await openReading(r.pages[carer], '手记');
  const card = r.pages[carer].locator('.spatial-notebook article').filter({ hasText: consent.consentId });
  assert.equal(await card.getByRole('button', { name: '分享给选定对象', exact: true }).count(), 0, '本次私有许可观察不能分享');
  for (let other = 0; other < r.count; other++) if (other !== carer) {
    const current = await until(async () => { const s = await r.snapshot(other); assert.equal(s.sessionId, requested.sessionId); return BigInt(s.snapshotSeq) >= BigInt(requested.observedSeq) ? s : false; }, '未参与者投影达到本次私物请求水位');
    assert.ok(!current.projection.observations.some(observation => observation.fields.some(field => field.key === 'consent' && field.value === consent.consentId)), '未参与者不见私有许可观察');
  }
  accepted(await r.send('cuilan', { kind: 'respond_consent', consentId: consent.consentId, expectedConsentVersion: consent.version, response: 'accept' }));
  parcel = await r.entity(carer, '私人包裹'); const ground = parcel.location; assert.equal(ground.kind, 'ground');
  receipt = accepted(await r.send(carer, { kind: 'take_item', itemRef: parcel.entityRef, expectedItemRevision: parcel.resourceRevision }));
  let p = (await privateItemPublication(r, receipt, '本人许可后拿取')).projection;
  assert.equal(p.items.filter(item => item.entityRef === parcel.entityRef).length, 1, '本次精确私物在当前投影中唯一');
  assert.equal(p.self.sceneId, ground.sceneId); assert.ok(Math.hypot(p.self.position.x - ground.position.x, p.self.position.y - ground.position.y) <= r.content.movement.interactionRadius, '真实当前位置在原私物可操作距离内');
  parcel = p.items.find(item => item.entityRef === parcel.entityRef);
  assert.deepEqual(parcel.location, { kind: 'held', ownerRef: p.self.entityRef });
  const placed = { kind: 'ground', sceneId: p.self.sceneId, position: p.self.position };
  receipt = accepted(await r.send(carer, { kind: 'put_item', itemRef: parcel.entityRef, expectedItemRevision: parcel.resourceRevision, sceneId: placed.sceneId, position: placed.position }));
  p = (await privateItemPublication(r, receipt, '放在脚边')).projection; parcel = p.items.find(item => item.entityRef === parcel.entityRef);
  assert.deepEqual(parcel.location, placed, '本次放下已经发布为原精确位置，之后才撤回许可');
  consent = await latestConsent(r, 'cuilan', 'private_items'); accepted(await r.send('cuilan', { kind: 'withdraw_consent', consentId: consent.consentId, expectedConsentVersion: consent.version }));
  parcel = await r.entity(carer, '私人包裹'); receipt = await r.send(carer, { kind: 'take_item', itemRef: parcel.entityRef, expectedItemRevision: parcel.resourceRevision });
  assert.equal(receipt.status, 'Rejected'); assert.equal(receipt.code, 'CONSENT_REQUIRED');
  const withdrawn = await privateItemPublication(r, receipt, '本人撤回后拒绝拿取');
  const unchanged = withdrawn.projection.items.find(item => item.entityRef === parcel.entityRef);
  assert.deepEqual(unchanged.location, placed); assert.equal(unchanged.resourceRevision, parcel.resourceRevision, '撤回后的拒绝不改变私物版本');
  await r.go(carer, r.C('C08')); await r.pages[carer].setViewportSize({ width: 1600, height: 1000 });
  check(`${r.count}人：当前私物请求、本人许可/撤回与实际持有，私有观察不传播`, { geometry });
}

async function recovery(r) {
  const page = r.pages[0], partner = r.pages[1], originalEpoch = (await snapshot(page)).projection.self.controlEpoch;
  await recordOfflineRecovery({ runtime: server.runtime, pool: database.pool, room: r, report }, async diagnostics => {
    await page.reload(); await page.getByRole('button', { name: '恢复本人控制', exact: true }).click();
    await until(async () => (await clientState(page)).inputReady, '刷新后取得新控制周期');
    await stageSummary(page, '等待本人决定时刷新');
    assert.ok(BigInt((await snapshot(page)).projection.self.controlEpoch) > BigInt(originalEpoch));
    await diagnostics.beginOffline();
    await partner.context().setOffline(true); diagnostics.mark('offline-applied');
    try {
      await until(async () => (await snapshot(page)).projection.paused, '两人中一人断线后暂停');
      diagnostics.mark('pause-assertion-passed');
    } catch (error) {
      // 只延后清场取证；原 15 秒失败和同一 error 不因尾段观察到暂停而翻绿。
      try { await diagnostics.observeAfterPauseFailure(error); } finally { throw error; }
    }
    const at = (await snapshot(page)).projection.sceneTimeMs; await sleep(700); assert.equal((await snapshot(page)).projection.sceneTimeMs, at); diagnostics.mark('clock-freeze-verified');
    await partner.context().setOffline(false); diagnostics.mark('network-restored'); await until(async () => (await clientState(partner)).connection === 'online', '断线页面重新获得授权');
    await partner.getByRole('button', { name: '恢复本人控制', exact: true }).click(); await until(async () => (await clientState(partner)).inputReady && !(await snapshot(page)).projection.paused, '实际控制恢复场景时间'); diagnostics.mark('control-restored');
  });
  let committed; const observed = new Promise(resolve => { committed = resolve; });
  const message = '本局恢复核对：保留原请求。'; let release;
  heldAck = { message, observed: committed, wait: new Promise(resolve => { release = resolve; }), release };
  const sending = r.send(0, { kind: 'speak', text: message, channel: 'team', recipientRefs: [] });
  await observed; const request = heldAck.request, receipt = heldAck.receipt;
  await page.context().setOffline(true);
  await until(async () => (await clientState(page)).actions.some(action => action.id === request.clientActionId && action.status === 'unknown'), '真实提交后ACK丢失保留未知原请求');
  const raw = (await clientState(page)).actions.find(action => action.id === request.clientActionId).raw;
  assert.deepEqual(JSON.parse(raw), request);
  heldAck.release(); await page.context().setOffline(false);
  await until(async () => (await clientState(page)).connection === 'online', '未知结果恢复连接');
  await page.getByRole('button', { name: '恢复本人控制', exact: true }).click(); await until(async () => (await clientState(page)).inputReady, '未知结果恢复当前控制');
  const returned = await sending; assert.deepEqual(returned, receipt);
  const recovered = (await clientState(page)).actions.find(action => action.id === request.clientActionId); assert.equal(recovered.raw, raw); assert.deepEqual(recovered.receipt, receipt);
  assert.equal((await snapshot(page)).projection.claims.filter(claim => claim.text === message).length, 1, '原请求恢复只发生一次');
  heldAck = null; check('2人：刷新、断线暂停与真实提交后丢ACK，原nonce/原串恢复且效果一次');
}

async function recap(r, ending, { historicalText } = {}) {
  for (let index = 0; index < r.count; index++) {
    const page = r.pages[index];
    await until(async () => (await snapshot(page))?.projection.ending?.endingCode === ending, '各浏览器实际终态结局');
    await stageSummary(page, '实际终态');
    await openReading(page, '回看');
    const panel = page.locator('.gaolao-recap'); await panel.waitFor();
    await until(async () => (await panel.innerText()).includes('过程已读完') || await panel.locator('.gaolao-recap-entries li').count() > 0, '真实HTTP复盘开始呈现');
    for (let pageIndex = 0; pageIndex < 20 && !(await panel.innerText()).includes('过程已读完'); pageIndex++) {
      const before = await panel.locator('.gaolao-recap-entries li').count();
      const more = panel.getByRole('button', { name: '再看更早的过程', exact: true }); await more.waitFor(); await more.click();
      await until(async () => (await panel.locator('.gaolao-recap-entries li').count()) > before || (await panel.innerText()).includes('过程已读完'), '同终态水位读取下一页');
    }
    assert.match(await panel.innerText(), /过程已读完/);
    if (historicalText && index === r.role('E')) {
      const history = panel.locator('.gaolao-recap-entries li').filter({ hasText: historicalText });
      assert.equal(await history.count(), 1); assert.match(await history.innerText(), /当时称呼：翠兰/); assert.doesNotMatch(await history.innerText(), /孙悟空/);
    }
  }
  const pages = report.recapResponses.filter(response => response.sessionId === r.sessionId && response.status === 200);
  assert.ok(pages.length >= r.count); assert.equal(new Set(pages.map(page => page.value.throughSeq)).size, 1);
  for (let index = 0; index < r.count; index++) {
    const responses = pages.filter(page => page.player === index); const entries = responses.flatMap(page => page.value.entries);
    assert.equal(new Set(entries.map(entry => entry.entryRef)).size, entries.length, '分页不重复授权条目');
  }
  await image(r.pages[0], `gaolao-${r.count}-${ending}-desktop.png`);
  const widths = await narrowReady(r.pages[0]);
  await image(r.pages[0], `gaolao-${r.count}-${ending}-narrow.png`); await r.pages[0].setViewportSize({ width: 1600, height: 1000 });
  await r.pages[0].locator('.gaolao-recap-entries li').first().scrollIntoViewIfNeeded();
  await image(r.pages[0], `gaolao-${r.count}-${ending}-history.png`);
  if (ending === 'GZ-E01') {
    await r.pages[0].reload(); await until(async () => (await snapshot(r.pages[0]))?.projection.ending?.endingCode === ending, '刷新保留真实终态');
    await stageSummary(r.pages[0], '终态刷新与回看'); await openReading(r.pages[0], '回看');
    await until(async () => await r.pages[0].locator('.gaolao-recap-entries li').count() > 0, '终态刷新后真实授权过程重新读取');
    const stable = await snapshot(r.pages[0]); const entries = await r.pages[0].locator('.gaolao-recap-entries li').count();
    // 覆盖至少两个现有补发周期；短暂读到第一页不等于终态授权已经停止互相重连。
    for (let tick = 0; tick < 16; tick++) {
      await sleep(200); const current = await snapshot(r.pages[0]);
      assert.equal((await clientState(r.pages[0])).connection, 'online', '终态刷新不能引发无止境重连');
      assert.equal(current?.viewId, stable.viewId, '无新的授权变更时终态视图保持稳定');
      assert.equal(current.snapshotSeq, stable.snapshotSeq, '终态读取不自行推进世界水位');
      assert.equal(await r.pages[0].locator('.gaolao-recap-entries li').count(), entries, '普通阅读不能被终态订阅循环清空');
    }
  }
  check(`${r.count}人：${ending}真实终态与逐人授权分页复盘`, { responses: pages.length, widths });
}

async function disguiseAndDoubles(r) {
  const carer = r.role('B'), outsider = r.role('E'), craft = r.role('C');
  await disguise(r); await r.go(outsider, r.C('C10')); await r.go('cuilan', r.C('C10'));
  const page = r.pages[outsider];
  await until(async () => (await snapshot(page)).projection.entities.filter(entity => entity.name === '翠兰').length === 2, '未获知玩家实际看见两个同貌人物');
  const doubles = (await snapshot(page)).projection.entities.filter(entity => entity.name === '翠兰'); assert.notEqual(doubles[0].entityRef, doubles[1].entityRef);
  // 玩家依可见编号选择任意一位；不以服务端真身选择正确答案。
  await closeReading(page); const labels = page.locator('.spatial-object-list').getByRole('button', { name: /^\d+号 · 翠兰$/ });
  assert.equal(await labels.count(), 2); const chosenLabel = (await labels.nth(1).innerText()).trim(); await labels.nth(1).click();
  const selectedLabel = (await page.locator('#spatial-selection-heading').innerText()).trim(); assert.equal(selectedLabel, chosenLabel);
  const inspectBefore = (await clientState(page)).actions.map(action => action.id); await page.getByRole('button', { name: '在当前位置查看', exact: true }).click();
  await waitHumanReceipt(page, inspectBefore, { kind: 'inspect' }, report, outsider, '按可见编号查看同貌人物');
  await image(page, 'gaolao-5-doubles.png');
  const historicalText = '当时仍以翠兰的称呼在这里交谈。'; accepted(await r.send('wukong', { kind: 'speak', text: historicalText, channel: 'public', recipientRefs: [] }));
  await until(async () => (await snapshot(page)).projection.claims.some(claim => claim.text === historicalText && claim.speakerName === '翠兰'), '历史台词使用发生时授权称呼');
  await r.go(craft, r.C('C14')); await take(r, craft, '公共绳索'); await r.go(craft, r.C('C10'));
  let rope = await r.entity(craft, '公共绳索'); const recipient = await r.entity(craft, (await r.snapshot(outsider)).projection.self.name);
  accepted(await r.send(craft, { kind: 'transfer_item', itemRef: rope.entityRef, expectedItemRevision: rope.resourceRevision, recipientRef: recipient.entityRef }));
  await openReading(page, '行囊'); await page.getByLabel('交接给', { exact: true }).selectOption({ label: chosenLabel });
  const transferBefore = (await clientState(page)).actions.map(action => action.id); await page.locator('.spatial-inventory li').filter({ has: page.getByRole('heading', { name: '公共绳索', exact: true }) }).getByRole('button', { name: '交给对方', exact: true }).click();
  accepted(await waitHumanReceipt(page, transferBefore, { kind: 'transfer_item' }, report, outsider, '向可见编号所选同貌人物交接'));
  const inspect = report.humanActions.findLast(action => action.label === '按可见编号查看同貌人物'); const transferred = report.humanActions.at(-1);
  assert.equal(transferred.request.action.recipientRef, inspect.request.action.targetRef, '同貌交接与玩家可见选中对象一致');
  // Receipt 可以先于公开投影到达；仅等对应水位，随后立即核对原精确物主。
  const started = Date.now(), publication = { receiptSeq: transferred.receipt.observedSeq, clientActionId: transferred.request.clientActionId, itemRef: transferred.request.action.itemRef, recipientRef: transferred.request.action.recipientRef, samples: [] };
  report.transferPublication = publication;
  const published = await until(async () => {
    const current = await snapshot(page), item = current.projection.items.find(item => item.entityRef === publication.itemRef);
    publication.samples.push({ ms: Date.now() - started, viewId: current.viewId, snapshotSeq: current.snapshotSeq, item: item && { resourceRevision: item.resourceRevision, location: item.location } });
    return BigInt(current.snapshotSeq) >= BigInt(publication.receiptSeq) ? current : false;
  }, '同貌交接的公开投影到达本次回执水位');
  assert.equal(published.viewId, transferred.request.viewId, '精确引用仍属于原授权视图');
  const held = published.projection.items.find(item => item.entityRef === publication.itemRef);
  assert.deepEqual(held?.location, { kind: 'held', ownerRef: transferred.request.action.recipientRef }, '同一提交水位的精确物件实际交给原选中收件人');
  // 两位受控角色各自观察本人行囊；实际持有者按其授权视图归还给木匠，不读取真身来代玩家选择。
  for (const key of ['cuilan', 'wukong']) {
    const own = (await r.snapshot(key)).projection; const item = own.items.find(item => item.name === '公共绳索' && item.location.kind === 'held' && item.location.ownerRef === own.self.entityRef);
    if (item) { const receiver = await r.entity(key, (await r.snapshot(craft)).projection.self.name); accepted(await r.send(key, { kind: 'transfer_item', itemRef: item.entityRef, expectedItemRevision: item.resourceRevision, recipientRef: receiver.entityRef })); }
  }
  accepted(await r.interact(carer, '孙悟空（借貌）', 'gz-reveal-identity'));
  await until(async () => (await snapshot(page)).projection.entities.some(entity => entity.name === '孙悟空（借貌）'), '实际在场受众合法获知身份');
  assert.equal((await snapshot(page)).projection.claims.find(claim => claim.text === historicalText).speakerName, '翠兰');
  const consent = await latestConsent(r, 'cuilan', 'appearance'); accepted(await r.send('cuilan', { kind: 'withdraw_consent', consentId: consent.consentId, expectedConsentVersion: consent.version }));
  await until(async () => !(await snapshot(page)).projection.entities.some(entity => entity.name === '孙悟空（借貌）'), '本人撤回后借貌实际结束');
  await r.go(craft, r.C('C14')); rope = await r.entity(craft, '公共绳索'); accepted(await r.interact(craft, '公共工具借还架', 'gz-return-public', { itemRef: rope.entityRef, expectedItemRevision: rope.resourceRevision }));
  check('5人：借貌本人许可、双同貌可见选择/实际物权、合法揭示与撤回，历史称呼保持'); return historicalText;
}

try {
  assert.equal(report.source.status, '', '完整章证据只在生产与脚本都冻结的干净源码上运行');
  database = await startTestPostgres('gaolao-ui', { outputSubdirectory: 'adv001-33-a2-integration' }); report.postgresVersion = (await database.pool.query('SHOW server_version')).rows[0].server_version;
  server = await createAuthorityServer({ pool: database.pool }); const address = await server.listen(0); const origin = `http://127.0.0.1:${address.port}`;
  const submit = server.runtime.submit.bind(server.runtime);
  server.runtime.submit = async (handle, raw) => {
    const receipt = await submit(handle, raw); const request = JSON.parse(raw);
    if (heldAck && !heldAck.request && request.action.kind === 'speak' && request.action.text === heldAck.message) {
      heldAck.request = request; heldAck.receipt = receipt; heldAck.observed(); await heldAck.wait;
    }
    return receipt;
  };
  vite = await createVite({ root: resolve(repository, 'frontend'), configFile: resolve(repository, 'frontend/vite.config.mjs'), configLoader: 'native', cacheDir: resolve(output, 'vite-cache'), server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] }, proxy: { '/api': { target: origin }, '/socket.io': { target: origin, ws: true } } } }); await vite.listen();
  const baseURL = `http://127.0.0.1:${vite.httpServer.address().port}`; const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : [] }); report.browserVersion = browser.version();
  activeRoom = await browserRoom({ server, browser, baseURL, count: 2, report }); rooms.push(activeRoom);
  await rescueViaUI(activeRoom, { changes: true }); await cleanupPublic(activeRoom); await investigate(activeRoom); await recovery(activeRoom); await endTogether(activeRoom); await recap(activeRoom, 'GZ-E01'); await activeRoom.close();
  activeRoom = await browserRoom({ server, browser, baseURL, count: 5, report }); rooms.push(activeRoom);
  await activeRoom.go(activeRoom.role('E'), activeRoom.R('R03')); await rescueViaUI(activeRoom); await cleanupPublic(activeRoom); const historicalText = await disguiseAndDoubles(activeRoom);
  await gatherSources(activeRoom); await endSeparatelyViaUI(activeRoom); await recap(activeRoom, 'GZ-E02', { historicalText }); await activeRoom.close();
  activeRoom = await browserRoom({ server, browser, baseURL, count: 2, report }); rooms.push(activeRoom);
  await activeRoom.go('wukong', activeRoom.C('C18'));
  for (let index = 0; index < 104; index++) accepted(await activeRoom.send('wukong', { kind: 'speak', text: `历史分页检查${index}：` + '这条记录只给当时有资格听到的人。'.repeat(45), channel: 'public', recipientRefs: [] }));
  await confirmEndViaUI(activeRoom, 'chapter'); await recap(activeRoom, 'GZ-E03');
  const responsePages = report.recapResponses.filter(response => response.sessionId === activeRoom.sessionId && response.player === 0 && response.status === 200);
  assert.ok(responsePages.length >= 2); assert.ok(responsePages[0].bytes > 65536, '真实授权长页超过64KiB仍完整呈现');
  const historical = responsePages.flatMap(response => response.value.entries).filter(entry => entry.text.startsWith('历史分页检查')); assert.equal(historical.length, 104);
  await server.runtime.revokeAccess(activeRoom.sessionId, activeRoom.users[0].userId);
  await until(async () => (await clientState(activeRoom.pages[0])).connection === 'forbidden', '当前资格撤销后真实客户端拒绝继续读取');
  assert.doesNotMatch(await activeRoom.pages[0].locator('body').innerText(), /历史分页检查|这条记录只给当时/); check('2人：主动暂告一段、超过64KiB授权分页与明确撤权清除');
  for (const r of rooms) {
    const state = await server.runtime.replay(r.sessionId); report.checks.push({ name: `${r.count}人真实持久终态`, status: 'PASS', sessionId: r.sessionId, ending: state.ending?.endingCode, sessionSeq: state.sessionSeq });
  }
  assert.deepEqual(report.pageErrors, []);
  report.assessment = 'PASS';
} catch (error) {
  report.assessment = 'FAIL'; report.error = error.stack; console.error(error);
  report.failureCapture = { at: new Date().toISOString(), stage: report.offlineRecovery?.failureTail ? '只读尾段之后；原失败时点见 offlineRecovery.originalAssertion' : '原失败之后' };
  for (const [index, page] of (activeRoom?.pages || []).entries()) {
    await page.screenshot({ path: resolve(output, `failure-${index}.png`), fullPage: true }).catch(() => {});
    report[`snapshot-${index}`] = await snapshot(page).catch(() => null);
    report[`page-${index}`] = await page.locator('body').innerText().catch(() => ''); report[`state-${index}`] = await clientState(page).catch(() => null);
  }
} finally {
  report.cleanupStartedAt = new Date().toISOString();
  heldAck?.release(); await saveJSON(resolve(output, 'result-before-cleanup.json'), report);
  for (const [name, close] of [['browser', () => browser?.close()], ['vite', () => vite?.close()], ['server', () => server?.close()], ['postgres', () => database?.stop()]]) { await close(); report.cleanup.push(name); }
  report.finishedAt = new Date().toISOString(); report.resourcesClosed = true;
  try {
    report.sourceEnd = await sourceIdentity();
    assert.deepEqual(report.sourceEnd, report.source, '运行期间生产与脚本源码必须保持同一固定候选');
    assert.equal(sha256(await readFile(resolve(repository, '.github/workflows/ci.yml'))), report.workflowSha256);
  } catch (error) {
    report.sourceAuditError = error.stack;
    if (report.assessment !== 'FAIL') { report.assessment = 'FAIL'; report.error = error.stack; }
  }
  await saveJSON(resolve(output, 'result.json'), report);
  console.log(JSON.stringify({ assessment: report.assessment, checks: report.checks.length, output })); if (report.assessment !== 'PASS') process.exitCode = 1;
}
