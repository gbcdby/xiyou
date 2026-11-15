// CS-T04：真实页面、生产翠兰、受控三自主 NPC；只有完整 IC 才能执行并计作 E2。
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer as createVite } from 'vite';
import { chromium } from 'playwright';
import { startTestPostgres } from '../../backend/test-support/postgres.mjs';
import { createAuthorityServer } from '../../backend/server.mjs';
import { accepted, take, share, cleanupPublic } from '../../backend/test-support/gaolao-room.mjs';
import { sampleSharedPersonalEffects, assertBothActiveEffects, assertSharedStoppedEffects, assertSharedStopTransaction, assertOriginalReceiptRead, tracePersonalTransactions } from '../../backend/test-support/personal-shared-effects.mjs';
import { repository, sourceIdentity, saveJSON, sha256, until, sleep } from './network-support.mjs';
import { browserRoom, snapshot, clientState, openReading } from './gaolao-real-support.mjs';
import { observeDirectionConnections } from './direction-browser-support.mjs';
import { createCuilanClickObservation } from './cuilan-click-observation.mjs';
import { createCuilanNodeProfile } from './cuilan-node-profile.mjs';
import { productionProfile, caseIds, assertCompleteReport, clickAction, askAppearance, describeItems, askItems, personalState, cancelPersonal, returnItem, holdSubmissions, captureAppearanceCompetition, holdCommittedReceipt, deferLeaseMaintenance, authoritativeState, sceneDecision, assertRoomIdentity, createCuilanReportCollector, finalizeCuilanReport } from './cuilan-self-response-support.mjs';

const output = resolve(process.env.FRONTEND_EVIDENCE_DIR || resolve(repository, '.agent-output/cuilan-production-browser'));
await mkdir(output, { recursive: true });
const report = {
  work_id: 'CS-T04-E2', executionKind: 'production_browser', assessment: 'RUNNING',
  scope: '两名真实浏览器账号/正常Vue控件/HTTP/Socket/PostgreSQL；翠兰为唯一生产scene控制器，唐僧/悟空/八戒为受控技术夹具。A三人租约故障单列；B真实进程重启由独立命令和报告验收；不计真人、真实provider、900秒或#29全部人数。',
  source: await sourceIdentity(), startedAt: new Date().toISOString(), nodeVersion: process.version,
  cases: caseIds.map(id => ({ id, status: 'NOT_RUN', evidence: [] })),
  rooms: [], humanActions: [], npcActions: [], recapResponses: [], pageErrors: [], externalRequests: [],
  creationRequests: [], wireActions: [], httpReceipts: [], authority: [], competitions: [], screenshots: [], cleanup: [],
  leaseFault: { status: 'NOT_RUN' }, realProviderCalls: 0, faults: [], resources: [],
  notCovered: ['真实provider的自然语言因果质量', '真人四局', '真实设备与艺术品质', '五客户端连续900秒', '3/4/5人数完整分支矩阵', '新环境部署'],
};
let database, server, browser, activeRoom, serverPort, activeCase, directionConnections;
const vites = [], rooms = [], restorers = new Set();
const collector = createCuilanReportCollector(error => report.pageErrors.push({ message: '证据采集失败：' + error.message }));
const clickObservation = createCuilanClickObservation({ currentCase: () => activeCase });
report.clickObservation = clickObservation.report; restorers.add(clickObservation);
const nodeProfile = createCuilanNodeProfile({ repository, output, sourcePaths: Object.keys(report.source.sourceHashes) });
report.clickObservation.nodeProfile = nodeProfile.report; restorers.add(nodeProfile);
const workflow = resolve(repository, '.github/workflows/cuilan-self-response.yml');
report.workflowSha256 = sha256(await readFile(workflow));
await saveJSON(resolve(output, 'startup.json'), { source: report.source, startedAt: report.startedAt, command: 'node frontend/tests/cuilan-self-response-browser.mjs', workflowSha256: report.workflowSha256 });
const rowFor = id => report.cases.find(row => row.id === id);
function startCase(id) { activeCase = id; if (rowFor(id).status === 'NOT_RUN') rowFor(id).status = 'RUNNING'; }
function evidence(id, name, data = {}) {
  const row = rowFor(id), room = rooms.find(room => room.sessionId === data.sessionId);
  row.evidence.push({ name, at: new Date().toISOString(), count: room?.count, evidenceType: report.leaseFault.status === 'RUNNING' || data.faultProfile ? 'fault-window' : 'normal-ui-production-scene', ...data });
  if (row.status !== 'PASS') row.status = 'PARTIAL';
  console.log(JSON.stringify({ case: id, name, count: room?.count }));
}
async function state(room) { return (await authoritativeState(database.pool, room.sessionId)).state; }
async function picture(room, label, player = 0) {
  const file = `${report.screenshots.length}-${label}.png`; await room.pages[player].screenshot({ path: resolve(output, file), fullPage: true });
  report.screenshots.push({ sessionId: room.sessionId, player, file, sha256: sha256(await readFile(resolve(output, file))) });
}
async function instrumentPage(page) {
  const pageId = crypto.randomUUID();
  collector.observe(page, 'request', request => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname)) report.externalRequests.push({ pageId, origin: url.origin, path: url.pathname });
    if (url.pathname === '/api/sessions' && request.method() === 'POST') report.creationRequests.push({ pageId, request: request.postDataJSON() });
  });
  collector.observe(page, 'websocket', socket => collector.observe(socket, 'framesent', frame => {
    const text = String(frame.payload); if (!/^42\d*\[/.test(text)) return;
    try {
      const [event, value] = JSON.parse(text.replace(/^42\d*/, ''));
      if (event === 'player.action.request') report.wireActions.push({ pageId, request: JSON.parse(value) });
    } catch (error) { report.pageErrors.push({ message: '实际动作帧无法读取：' + error.message }); }
  }));
  collector.observe(page, 'response', async response => {
    if (!/\/actions\//.test(new URL(response.url()).pathname) || !response.ok()) return;
    try { report.httpReceipts.push({ pageId, receivedAt: new Date().toISOString(), receipt: await response.json(), viewId: (await snapshot(page))?.viewId }); } catch (error) { report.pageErrors.push({ message: '实际收据响应无法读取：' + error.message }); }
  });
  await clickObservation.attach(page, pageId);
  return page;
}
const instrumentedBrowser = {
  async newContext(options) {
    const context = await browser.newContext(options), original = context.newPage.bind(context);
    context.newPage = async () => instrumentPage(await original());
    return context;
  },
};
async function startFrontend(contentVersion) {
  const variant = contentVersion ? 'east' : 'default';
  const vite = await createVite({ root: resolve(repository, 'frontend'), configFile: resolve(repository, 'frontend/vite.config.mjs'), configLoader: 'native',
    cacheDir: resolve(output, 'vite-cache-' + variant),
    ...(contentVersion ? { define: { 'import.meta.env.VITE_GAOLAO_CONTENT_VERSION': JSON.stringify(contentVersion) } } : {}),
    server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] }, proxy: { '/api': { target: `http://127.0.0.1:${serverPort}` }, '/socket.io': { target: `http://127.0.0.1:${serverPort}`, ws: true } } },
  });
  if (!contentVersion) assert.equal(vite.config.env.VITE_GAOLAO_CONTENT_VERSION, undefined, '至少默认样本没有环境或define覆盖');
  await vite.listen(); vites.push(vite); return `http://127.0.0.1:${vite.httpServer.address().port}`;
}
async function newRoom(baseURL, contentVersion, { count = 2, defaultEntry = false } = {}) {
  // getter 只为同一实际服务器重启换 runtime；生产适配器重绑仍限固定三 NPC。
  const facade = { get runtime() { return server.runtime; } };
  const room = await browserRoom({ server: facade, browser: instrumentedBrowser, baseURL, contentVersion, count, profile: productionProfile, report, observe: collector.observe });
  room.report = report; room.baseURL = baseURL; rooms.push(room); activeRoom = room;
  report.directionQualification ??= [];
  for (let player = 0; player < room.count; player++) report.directionQualification.push(await directionConnections.qualify(room.pages[player], room.users[player].userId, 'initial-' + player));
  report.rooms.push(await assertRoomIdentity(room, database.pool, { defaultEntry }));
  assert.ok(report.creationRequests.some(row => row.request.contentVersion === contentVersion && row.request.capabilities.includes('gaolao-personal-consent-v1')));
  return room;
}
async function nearOwner(room, player) {
  const current = await state(room), destination = room.content.chapterRules.safeDestinations.find(place => place.destinationId === current.chapter.settlement?.destinationId)
    ?? room.content.chapterRules.safeDestinations.find(place => { const person = current.characters[room.content.chapterRules.people.cuilan]; return person.sceneId === place.sceneId && Math.hypot(person.position.x - place.position.x, person.position.y - place.position.y) <= 20; });
  assert.ok(destination, '真实本人在登记安置处，不能用诊断强移她'); await room.go(player, destination);
}
async function awaitDecision(room, player, purpose, status, options) {
  const value = await personalState(room, player, purpose, status, options);
  const response = { accepted: 'accept', declined: 'decline', deferred: 'defer', withdrawn: 'withdrawn' }[status];
  if (response) await sceneDecision(database.pool, room, value.consent.consentId, response);
  return value;
}
async function rescue(room, destinationId, { beforeSafe = false } = {}) {
  startCase('P-01');
  const carer = room.role('B'), craft = room.role('C');
  await room.go(carer, room.C('C04')); accepted(await room.interact(carer, '侧窗联络点', 'gz-contact'));
  await until(async () => (await state(room)).chapter.retreated === true, '生产本人实际退让', 25000);
  await room.go(carer, room.C('C01')); accepted(await room.interact(carer, '铜封门', 'gz-check-seal')); await room.go('wukong', room.C('C01'));
  await share(room, carer, '侧窗本人回应', '孙悟空'); await share(room, carer, '亲自在门外检查铜封', '孙悟空');
  for (const [player, id, name] of [[carer, 'gz-brace', '公共门撑'], [craft, 'gz-rope', '公共绳索']]) { await room.go(player, room.content.items.find(item => item.itemId === id)); await take(room, player, name); }
  await room.go(carer, room.C('C02')); await room.go(craft, room.C('C03'));
  for (const player of [carer, craft]) accepted(await room.send(player, { kind: 'cooperate', operationId: 'gz-lock-support', operationVersion: '0', phase: 'ready' }));
  accepted(await room.interact('wukong', '铜封门', 'gz-break-seal')); await room.go(carer, room.C('C08'));
  let deferred;
  if (beforeSafe) {
    await describeItems(room, carer); accepted((await askItems(room, carer, ['私人包裹'], 'single_use')).receipt);
    deferred = await awaitDecision(room, carer, 'private_items', 'deferred');
  }
  const p = (await snapshot(room.pages[carer])).projection, owner = await room.entity(carer, '翠兰');
  accepted(await room.send(carer, { kind: 'propose_follow', subjectRef: owner.entityRef, leaderRef: p.self.entityRef, destinationId, expectedTargetRevision: owner.resourceRevision }));
  const consent = await until(async () => (await snapshot(room.pages[carer])).projection.chapter.consents.findLast(consent => consent.purpose === 'follow' && consent.status === 'accepted'), '生产本人接受随行', 20000);
  await sceneDecision(database.pool, room, consent.consentId, 'accept');
  const route = destinationId === 'front-guest-room' ? [room.C('C01'), room.C('C13'), room.C('C11'), room.C('C12')] : [room.C('C01'), room.C('C20'), room.R('R02'), room.R('R06'), room.R('R04'), room.R('R05')];
  for (const at of route) await room.go(carer, at);
  await until(async () => (await state(room)).chapter.cuilanSafe === true, '生产本人实际走到安置处并确认', 40000);
  if (deferred) assert.equal((await state(room)).chapter.consents[deferred.consent.consentId].status, 'deferred', '安置不把旧暂缓自动改为同意');
  const intents = (await database.pool.query("SELECT request,execution_context FROM spatial_intents WHERE session_id=$1 AND actor_id=$2", [room.sessionId, room.content.chapterRules.people.cuilan])).rows;
  assert.ok(intents.some(row => row.request.action.operationId === 'gz-confirm-settlement'));
  assert.ok(intents.every(row => row.execution_context.mode === 'scene-policy'), '翠兰全部意图只能来自生产scene控制器');
  evidence('P-01', '救援、实际随行和安置', { sessionId: room.sessionId, contentVersion: room.content.contentVersion, destinationId, deferredConsentId: deferred?.consent.consentId ?? null, actualSceneIntentCount: intents.length });
  await cleanupPublic(room);
}
async function permissionTerms(room, purpose, labels = ['私人包裹', '私人信件']) {
  startCase(purpose === 'appearance' ? 'P-02' : 'P-03');
  const player = room.role('B'); await nearOwner(room, player);
  // 旁观 NPC 保持实际在场；不以要求他们离开来获得接受。
  const person = await room.entity(player, '翠兰');
  await room.go('tang', { sceneId: (await snapshot(room.pages[player])).projection.self.sceneId, position: (await snapshot(room.pages[player])).projection.self.position });
  if (purpose === 'private_items') await describeItems(room, player);
  const ask = term => purpose === 'appearance' ? askAppearance(room, player, 'rear-meeting', term) : askItems(room, player, labels, term);
  const reusable = await ask('reusable'); accepted(reusable.receipt);
  const declined = await awaitDecision(room, player, purpose, 'declined');
  const single = await ask('single_use'); accepted(single.receipt);
  const granted = await awaitDecision(room, player, purpose, 'accepted', { differentFrom: declined.consent.consentId });
  assert.notEqual(reusable.request.clientActionId, single.request.clientActionId);
  assert.equal((await state(room)).chapter.consents[declined.consent.consentId].status, 'declined');
  const record = (await state(room)).chapter.personalRequests[granted.consent.consentId];
  assert.equal(record.execution.acceptedProof.consentVersion, granted.consent.version);
  assert.equal(granted.request.permissionTerm, 'single_use');
  await openReading(room.pages[player], '进展');
  assert.match(await room.pages[player].locator(`[data-personal-purpose="${purpose}"]`).innerText(), /本人已同意/);
  evidence(purpose === 'appearance' ? 'P-02' : 'P-03', '正常询问真实拒绝、以新身份询问单次并实际同意', { sessionId: room.sessionId, purpose, subjectRefAtRequest: person.entityRef, declinedId: declined.consent.consentId, acceptedId: granted.consent.consentId, reusableActionId: reusable.request.clientActionId, singleActionId: single.request.clientActionId });
  return { player, granted };
}
async function takeBoth(room, player) {
  await room.go(player, room.C('C07'));
  for (const name of ['私人包裹', '私人信件']) await take(room, player, name);
  await until(async () => (await snapshot(room.pages[player])).projection.chapter.privateReturns.length === 2, '实际拿取后两件独立返还入口');
  const current = await state(room), held = Object.values(current.chapter.privateAcquisitions).filter(row => row.outcome === 'held');
  assert.equal(held.length, 2); assert.equal(new Set(held.map(row => row.acquisitionId)).size, 2);
  return held;
}
async function deliverBoth(room) {
  const { player, granted } = await permissionTerms(room, 'private_items'); const held = await takeBoth(room, player);
  await nearOwner(room, player); await returnItem(room, player, '私人包裹', 'owner');
  await until(async () => (await snapshot(room.pages[player])).projection.chapter.privateReturns.length === 1, '第一件真实交回不吞第二件');
  let current = await state(room); assert.equal(current.chapter.privateAcquisitions[held.find(row => row.itemId === 'gz-parcel').acquisitionId].outcome, 'delivered_to_owner');
  assert.equal(current.chapter.privateAcquisitions[held.find(row => row.itemId === 'gz-letter').acquisitionId].outcome, 'held');
  await returnItem(room, player, '私人信件', 'owner');
  await until(async () => (await snapshot(room.pages[player])).projection.chapter.privateReturns.length === 0, '两件实收后没有虚假剩余');
  current = await state(room);
  for (const row of held) assert.equal(current.chapter.privateAcquisitions[row.acquisitionId].outcome, 'delivered_to_owner');
  assert.ok(current.chapter.personalRequests[granted.consent.consentId].execution.itemUses.every(use => use.outcome === 'delivered_to_owner'));
  evidence('P-03', '两件各实际取还一次、先还第一件保留第二件', { sessionId: room.sessionId, consentId: granted.consent.consentId, acquisitionIds: held.map(row => row.acquisitionId) });
  await picture(room, 'two-items-delivered', player);
}
async function appearancePlaces(room, initial) {
  startCase('P-06');
  const player = room.role('B');
  for (const [index, place] of room.content.chapterRules.meetingDestinations.entries()) {
    let granted = initial;
    if (index > 0) { await nearOwner(room, player); accepted((await askAppearance(room, player, place.destinationId, 'single_use')).receipt); granted = await awaitDecision(room, player, 'appearance', 'accepted'); }
    await room.go('wukong', place); await room.go(player, place);
    const applyReceipt = accepted(await room.interact('wukong', 'self', 'gz-apply-appearance', { consentId: granted.consent.consentId, expectedConsentVersion: granted.consent.version }));
    await until(async () => Boolean((await state(room)).chapter.disguise), '真实悟空实际使用借貌');
    if (index === 0) {
      const performer = await until(async () => {
        const current = await snapshot(room.pages[player]);
        if (!current || BigInt(current.snapshotSeq) < BigInt(applyReceipt.observedSeq)) return false;
        return current.projection.entities.find(entity => entity.name === '孙悟空（借貌）' && entity.availableOperations?.includes('gz-reveal-identity'));
      }, '本次请求者收到借貌提交后的身份与当面揭明操作', 15000);
      assert.ok(performer, '本次请求者具有实际授权身份知识');
      accepted(await room.interact(player, performer.name, 'gz-reveal-identity'));
      assert.equal((await state(room)).chapter.disguise, null, '公开结束事务立即解除外貌');
      await sceneDecision(database.pool, room, granted.consent.consentId, 'withdrawn');
    } else if (index === 1) {
      accepted(await room.interact('wukong', 'self', 'gz-release-appearance'));
      const current = await state(room); assert.equal(current.chapter.disguise, null); assert.equal(current.chapter.consents[granted.consent.consentId].status, 'accepted', '自愿解除不伪称本人撤回');
    } else {
      const applied = await until(async () => {
        const current = await snapshot(room.pages[player]);
        if (!current || current.sessionId !== room.sessionId || BigInt(current.snapshotSeq) < BigInt(applyReceipt.observedSeq)) return false;
        const request = current.projection.chapter.personalRequests.find(row => row.consentId === granted.consent.consentId && row.purpose === 'appearance');
        const consent = current.projection.chapter.consents.find(row => row.consentId === granted.consent.consentId);
        return request?.executionState === 'active' && request.lifecycle === 'open'
          && BigInt(request.lifecycleVersion) > BigInt(granted.request.lifecycleVersion)
          && consent?.status === 'accepted' && consent.version === granted.consent.version
          ? { snapshotSeq: current.snapshotSeq, lifecycleVersion: request.lifecycleVersion, consentVersion: consent.version } : false;
      }, '本次请求者收到原借貌提交及同一许可的实际 active 生命周期', 15000);
      const cancelled = await cancelPersonal(room, player, 'appearance');
      assert.ok(BigInt(cancelled.request.baseSeq) >= BigInt(applyReceipt.observedSeq));
      assert.equal(cancelled.request.action.expectedLifecycleVersion, applied.lifecycleVersion);
      assert.equal(cancelled.request.action.expectedConsentVersion, applied.consentVersion);
      evidence('P-06', '取消前本人客户端实际追上原借貌提交', { sessionId: room.sessionId, destinationId: place.destinationId, consentId: granted.consent.consentId, applyActionId: applyReceipt.clientActionId, applyObservedSeq: applyReceipt.observedSeq, requesterSnapshotSeq: applied.snapshotSeq, lifecycleVersion: applied.lifecycleVersion, cancelActionId: cancelled.request.clientActionId, cancelBaseSeq: cancelled.request.baseSeq });
      const current = await state(room); assert.equal(current.chapter.disguise, null); assert.equal(current.chapter.consents[granted.consent.consentId].status, 'accepted', '请求者取消不伪称本人撤回');
    }
    evidence('P-06', '真实受控悟空在登记会面点使用并合法结束', { sessionId: room.sessionId, destinationId: place.destinationId, consentId: granted.consent.consentId, ending: ['public_disclosure_then_owner_withdrawal', 'performer_release', 'requester_cancel'][index] });
  }
}
async function competition(room) {
  startCase('P-04');
  const a = room.role('B'), b = a === 0 ? 1 : 0; await nearOwner(room, a); await nearOwner(room, b);
  const gate = holdSubmissions(server.runtime, request => request.sessionId === room.sessionId && request.action.operationId === 'gz-request-appearance', 2); restorers.add(gate);
  try {
    const pending = Promise.all([askAppearance(room, a, 'front-meeting', 'single_use'), askAppearance(room, b, 'front-meeting', 'single_use')]);
    await until(() => gate.held.length === 2, '两个正常页面请求都到达提交屏障', 15000);
    const captured = await authoritativeState(database.pool, room.sessionId);
    const basis = captureAppearanceCompetition(captured.state, captured.content_snapshot, gate.held.map(row => row.request), [room.users[a].userId, room.users[b].userId]);
    report.competitions.push(basis);
    gate.release(); const results = await pending;
    assert.deepEqual(results.map(row => row.receipt.status).sort(), ['Accepted', 'Rejected']);
    const rejected = results.find(row => row.receipt.status === 'Rejected');
    assert.equal(rejected.receipt.code, 'STALE_PRECONDITION'); assert.equal(rejected.receipt.actionEventRange, null);
    basis.receipts = (await database.pool.query('SELECT actor_id,client_action_id,receipt FROM action_receipts WHERE session_id=$1 AND client_action_id=ANY($2::text[])', [room.sessionId, basis.contenders.map(row => row.clientActionId)])).rows;
    assert.equal(basis.receipts.length, 2);
    for (const result of results) {
      assert.deepEqual(result.request, gate.held.find(row => row.request.clientActionId === result.request.clientActionId).request, '页面完成的仍是屏障内原请求');
      const contender = basis.contenders.find(row => row.clientActionId === result.request.clientActionId);
      const stored = basis.receipts.find(row => row.client_action_id === contender.clientActionId);
      assert.equal(stored.actor_id, contender.observerId); assert.deepEqual(stored.receipt.publicReceipt, result.receipt, '竞争结果必须是各自原动作的真实 PG 收据');
    }
    const winner = results[0].receipt.status === 'Accepted' ? a : b;
    const old = await awaitDecision(room, winner, 'appearance', 'accepted');
    accepted((await askAppearance(room, winner, 'road-meeting', 'single_use', { replace: true })).receipt);
    const newer = await awaitDecision(room, winner, 'appearance', 'accepted', { differentFrom: old.consent.consentId });
    let current = await state(room); assert.equal(current.chapter.personalRequests[old.consent.consentId].lifecycle, 'superseded'); assert.equal(current.chapter.consents[old.consent.consentId].status, 'accepted');
    await cancelPersonal(room, winner, 'appearance'); current = await state(room);
    assert.equal(current.chapter.personalRequests[newer.consent.consentId].lifecycle, 'cancelled'); assert.equal(current.chapter.consents[newer.consent.consentId].status, 'accepted');
    evidence('P-04', '同底层revision与各自公开别名竞争、明确替换与请求者取消分轴', { sessionId: room.sessionId, actionIds: results.map(row => row.request.clientActionId), statuses: results.map(row => row.receipt.status), capturedSeq: basis.snapshotSeq, staleCode: rejected.receipt.code, oldId: old.consent.consentId, newerId: newer.consent.consentId, faultProfile: 'two-real-ui-submissions-barrier' });
  } finally { gate.close(); restorers.delete(gate); }
}
async function bindingInterruption(room, player, purpose, consentId) {
  startCase('P-04');
  const before = await state(room), member = before.members.find(row => row.userId === room.users[player].userId);
  assert.ok(member); const originalActor = before.characters[member.characterId], oldView = (await snapshot(room.pages[player])).viewId;
  // 普通刷新真实关闭旧Socket；新页面由本人点击恢复，不直接操作控制状态。
  await room.pages[player].reload();
  await until(async () => (await state(room)).paused, '两人中一人刷新后实际暂停', 20000);
  const stopped = await state(room), record = stopped.chapter.personalRequests[consentId];
  assert.ok(!['ready', 'active'].includes(record.execution.state));
  assert.equal(stopped.chapter.consents[consentId].status, 'accepted', '系统即时停用与稍后的本人撤回分开');
  if (purpose === 'appearance') assert.equal(stopped.chapter.disguise, null);
  const connection = (await database.pool.query('SELECT active,lease_until FROM connections WHERE connection_id=$1', [originalActor.activeConnectionId])).rows[0];
  assert.ok(!connection.active || new Date(connection.lease_until).getTime() <= Date.now(), '观察到真实旧连接失效');
  await recoverPlayer(room, player, { reload: false });
  await until(async () => !(await state(room)).paused, '两名本人恢复后继续运行');
  await sceneDecision(database.pool, room, consentId, 'withdrawn');
  const current = await state(room); assert.equal(current.chapter.consents[consentId].status, 'withdrawn');
  assert.notEqual((await snapshot(room.pages[player])).viewId, oldView);
  evidence('P-04', '正常两玩家刷新中断、同事务先停用、恢复后生产本人真实撤回', { sessionId: room.sessionId, purpose, consentId, oldView, newView: (await snapshot(room.pages[player])).viewId, oldEpoch: originalActor.controlEpoch, newEpoch: current.characters[member.characterId].controlEpoch, stoppedExecution: record.execution.state });
}
async function interruptAppearance(room) {
  const player = room.role('B'); await nearOwner(room, player);
  accepted((await askAppearance(room, player, 'front-meeting', 'single_use')).receipt);
  const granted = await awaitDecision(room, player, 'appearance', 'accepted');
  await room.go('wukong', room.content.chapterRules.meetingDestinations.find(row => row.destinationId === 'front-meeting'));
  accepted(await room.interact('wukong', 'self', 'gz-apply-appearance', { consentId: granted.consent.consentId, expectedConsentVersion: granted.consent.version }));
  assert.ok((await state(room)).chapter.disguise);
  await bindingInterruption(room, player, 'appearance', granted.consent.consentId);
}
async function recoverPlayer(room, player, { reload = true } = {}) {
  const page = room.pages[player]; if (reload) await page.reload();
  await until(async () => (await clientState(page)).connection === 'online', '真实页面网络恢复', 20000);
  const resume = page.getByRole('button', { name: '恢复本人控制', exact: true });
  if (await resume.isVisible()) await resume.click();
  await until(async () => (await clientState(page)).inputReady, '真实页面恢复本人控制', 20000);
  report.directionQualification.push(await directionConnections.qualify(page, room.users[player].userId, 'recovery-' + player));
}
async function restartServer(room) {
  const before = (await snapshot(room.pages[0])).viewId;
  directionConnections.close(); restorers.delete(directionConnections);
  await server.close(); server = await createAuthorityServer({ pool: database.pool, spatialDirection: { checkpointMs: 50 } });
  directionConnections = observeDirectionConnections(server.runtime); restorers.add(directionConnections); await server.listen(serverPort);
  for (let player = 0; player < room.count; player++) await recoverPlayer(room, player);
  await assertRoomIdentity(room, database.pool, { defaultEntry: report.rooms.find(row => row.sessionId === room.sessionId).defaultEntry });
  await room.rebindControlledNpcs();
  await until(async () => !(await snapshot(room.pages[0])).projection.paused, '实际服务器重启后正常两人恢复');
  assert.notEqual((await snapshot(room.pages[0])).viewId, before);
  report.faults.push({ profile: 'real-server-restart-same-postgres', sessionId: room.sessionId, beforeView: before, afterView: (await snapshot(room.pages[0])).viewId });
}
async function oldPossessions(room) {
  startCase('P-05');
  const a = room.role('B'), b = a === 0 ? 1 : 0; await nearOwner(room, a); await describeItems(room, a);
  const gate = holdCommittedReceipt(server.runtime, request => request.sessionId === room.sessionId && request.action.operationId === 'gz-request-private-items'); restorers.add(gate);
  let sending, original, granted, held, newSlot;
  try {
    sending = await askItems(room, a, ['私人包裹', '私人信件'], 'single_use', { deferReceipt: true });
    original = await gate.ready; assert.equal(original.receipt.status, 'Accepted');
    assert.equal(original.request.clientActionId, sending.request.clientActionId);
    granted = await awaitDecision(room, a, 'private_items', 'accepted'); held = await takeBoth(room, a);
    await bindingInterruption(room, a, 'private_items', granted.consent.consentId);
    startCase('P-05');
    await nearOwner(room, a); await describeItems(room, a);
    accepted((await askItems(room, a, ['私人信件'], 'single_use')).receipt);
    const cancelled = await awaitDecision(room, a, 'private_items', 'accepted', { differentFrom: granted.consent.consentId });
    await cancelPersonal(room, a, 'private_items');
    assert.equal((await state(room)).chapter.personalRequests[cancelled.consent.consentId].lifecycle, 'cancelled');
    await nearOwner(room, b); await describeItems(room, b); accepted((await askItems(room, b, ['私人信件'], 'single_use')).receipt);
    newSlot = await awaitDecision(room, b, 'private_items', 'accepted'); assert.notEqual(newSlot.consent.consentId, granted.consent.consentId);
    const oldView = (await snapshot(room.pages[a])).viewId;
    await recoverPlayer(room, a);
    await until(async () => !(await snapshot(room.pages[b])).projection.paused, '换view后两人恢复');
    const afterView = await snapshot(room.pages[a]); assert.notEqual(afterView.viewId, oldView);
    assert.equal(afterView.projection.chapter.privateReturns.length, 2);
    const pendingOriginal = (await clientState(room.pages[a])).actions.find(row => row.id === original.request.clientActionId);
    assert.ok(pendingOriginal); assert.equal(pendingOriginal.receipt, null, '新view安装后原Accepted仍真实未送达，不能只延后helper等待');
    assert.equal(pendingOriginal.raw, original.raw, '恢复保留实际原文');
    const beforeRelease = afterView.projection.chapter.privateReturns.map(row => ({ ...row }));
    const releasedAt = new Date().toISOString();
    gate.release(); const response = await sending.complete(); assert.deepEqual(response.receipt, original.receipt);
    const delivery = await until(() => report.httpReceipts.find(row => row.receipt.clientActionId === original.request.clientActionId && row.receipt.sessionId === room.sessionId && row.viewId === afterView.viewId && Date.parse(row.receivedAt) >= Date.parse(releasedAt)), '旧Accepted确实经新view中的HTTP历史读取晚到');
    assert.deepEqual(delivery.receipt, original.receipt);
    await until(async () => (await clientState(room.pages[a])).actions.find(row => row.id === original.request.clientActionId)?.receipt, '旧Accepted通过实际恢复读取收束');
    assert.deepEqual((await snapshot(room.pages[a])).projection.chapter.privateReturns, beforeRelease, '迟旧Accepted不删旧持物或恢复旧授权');
    assert.equal((await state(room)).chapter.consents[granted.consent.consentId].status, 'withdrawn');
    evidence('P-05', 'A旧持物、B新槽、换view后迟到旧Accepted仅收束历史', { sessionId: room.sessionId, originalActionId: original.request.clientActionId, oldConsentId: granted.consent.consentId, newConsentId: newSlot.consent.consentId, oldView, newView: afterView.viewId, committedAt: original.committedAt, releasedAt, receivedAt: delivery.receivedAt, receiptChannel: 'actual-http-history-read', faultProfile: 'committed-ack-and-history-read-delay' });
  } finally { gate.close(); restorers.delete(gate); }
  // 必须真实挤出旧许可历史；聊天不会增长 consent 历史，因此不拿聊天替代。
  await nearOwner(room, a); let generated = 0;
  let historyCompleted = false;
  nodeProfile.start();
  try {
    while ((await snapshot(room.pages[a])).projection.chapter.consents.some(row => row.consentId === granted.consent.consentId) && generated < 262) {
      accepted((await askAppearance(room, a, 'front-meeting', 'reusable')).receipt);
      await awaitDecision(room, a, 'appearance', 'declined'); generated++;
      if (generated % 32 === 0) console.log(JSON.stringify({ stage: '真实许可历史落窗', generated }));
    }
    historyCompleted = true;
  } finally { nodeProfile.end(historyCompleted ? 'history-returned' : 'history-threw'); }
  assert.ok(generated > 0 && generated <= 262);
  assert.ok(!(await snapshot(room.pages[a])).projection.chapter.consents.some(row => row.consentId === granted.consent.consentId), '旧consent须已实际退出近期许可历史');
  assert.equal((await snapshot(room.pages[a])).projection.chapter.privateReturns.length, 2);
  await restartServer(room);
  await sceneDecision(database.pool, room, newSlot.consent.consentId, 'withdrawn');
  await room.go(a, room.C('C07'));
  const remote = (await snapshot(room.pages[a])).projection.chapter.privateReturns;
  assert.equal(remote.length, 2); assert.ok(remote.every(row => row.ownerRef === null), '物主不可见时不补远处引用');
  await openReading(room.pages[a], '行囊');
  for (const name of ['私人包裹', '私人信件']) assert.equal(await room.pages[a].getByRole('button', { name: `将${name}交回本人`, exact: true }).isDisabled(), true);
  const before = await state(room), slot = before.chapter.consentSlots[`${room.content.chapterRules.people.cuilan}:private_items`];
  const beforeCurrent = { consent: before.chapter.consents[slot], request: before.chapter.personalRequests[slot] };
  await nearOwner(room, a); await returnItem(room, a, '私人包裹', 'owner');
  await until(async () => (await snapshot(room.pages[a])).projection.chapter.privateReturns.length === 1, '同slot下第一件归还后第二件仍在');
  const after = await state(room); assert.deepEqual({ consent: after.chapter.consents[slot], request: after.chapter.personalRequests[slot] }, beforeCurrent, '归还范围外第一件不改变新槽单件安排');
  await room.go(a, room.C('C07')); await returnItem(room, a, '私人信件', 'origin');
  await until(async () => (await snapshot(room.pages[a])).projection.chapter.privateReturns.length === 0, '两件分别合法处置后归还列表为空');
  const final = await state(room);
  assert.equal(final.chapter.privateAcquisitions[held.find(row => row.itemId === 'gz-parcel').acquisitionId].outcome, 'delivered_to_owner');
  assert.equal(final.chapter.privateAcquisitions[held.find(row => row.itemId === 'gz-letter').acquisitionId].outcome, 'restored_origin');
  evidence('P-05', '真实落窗、服务重启、fresh refs、ownerRef=null、同槽逐物更新与两种归还结果', { sessionId: room.sessionId, generatedOwnerDeclines: generated, acquisitionIds: held.map(row => row.acquisitionId), beforeSlot: slot, originalConsentId: granted.consent.consentId });
  // 同件原许可不可再次拿取；由普通可见拿取入口产生真实权威拒绝。
  const letter = await room.entity(a, '私人信件'); const refused = await room.send(a, { kind: 'take_item', itemRef: letter.entityRef, expectedItemRevision: letter.resourceRevision });
  assert.equal(refused.status, 'Rejected');
  assert.equal((await state(room)).chapter.privateAcquisitions[held.find(row => row.itemId === 'gz-letter').acquisitionId].outcome, 'restored_origin');
  evidence('P-03', '同件放回后旧许可不能再次取出', { sessionId: room.sessionId, code: refused.code });
  // 新的真实请求可再次安排已放原处之物，终态只展示仍在手中的真实事项。
  await nearOwner(room, a); await describeItems(room, a); accepted((await askItems(room, a, ['私人信件'], 'single_use')).receipt);
  await awaitDecision(room, a, 'private_items', 'accepted'); await room.go(a, room.C('C07')); await take(room, a, '私人信件');
  await finishChapter(room);
  await openReading(room.pages[a], '行囊');
  assert.equal((await snapshot(room.pages[a])).projection.chapter.privateReturns.length, 1);
  for (const suffix of ['交回本人', '放回原处']) assert.equal(await room.pages[a].getByRole('button', { name: `将私人信件${suffix}`, exact: true }).isDisabled(), true);
  evidence('P-05', '新合法单件安排可再次取得，终态只保留实际未处置事项', { sessionId: room.sessionId });
  await picture(room, 'terminal-private-remainder', a);
}
async function finishChapter(room) {
  accepted(await room.send(0, { kind: 'request_end', proposalId: crypto.randomUUID(), proposalVersion: (await snapshot(room.pages[0])).projection.chapter.endProposal?.proposalVersion ?? '0', scope: 'chapter' }));
  for (let player = 1; player < room.count; player++) {
    const proposal = await until(async () => (await snapshot(room.pages[player])).projection.chapter.endProposal, '所有真实页面收到本轮结束提议');
    accepted(await room.send(player, { kind: 'confirm_end', proposalId: proposal.proposalId, proposalVersion: proposal.proposalVersion }));
  }
  await until(async () => (await state(room)).phase === 'Finished', '正常页面一致确认终态');
}
async function auditRoom(room) {
  const receipts = (await database.pool.query('SELECT actor_id,client_action_id,receipt FROM action_receipts WHERE session_id=$1', [room.sessionId])).rows;
  const human = report.humanActions.filter(row => row.request.sessionId === room.sessionId);
  assert.ok(human.length > 0);
  for (const row of human) {
    assert.ok(report.wireActions.some(wire => wire.request.sessionId === room.sessionId && wire.request.clientActionId === row.request.clientActionId), 'UI动作须有实际Socket帧');
    const matches = receipts.filter(receipt => receipt.client_action_id === row.request.clientActionId); assert.equal(matches.length, 1);
    assert.deepEqual(matches[0].receipt.publicReceipt, row.receipt, '页面/PG为同一真实Receipt');
  }
  const intents = (await database.pool.query('SELECT intent_id,actor_id,request,execution_context,scene_outcome FROM spatial_intents WHERE session_id=$1', [room.sessionId])).rows;
  const owner = room.content.chapterRules.people.cuilan, ownerIntents = intents.filter(row => row.actor_id === owner);
  assert.ok(ownerIntents.length > 0); assert.ok(ownerIntents.every(row => row.execution_context.mode === 'scene-policy' && row.execution_context.scenePolicyBasis.policyVersion === 'gaolao-cuilan-v2'));
  const controlled = new Set(['tang', 'wukong', 'bajie'].map(role => room.content.chapterRules.people[role]));
  assert.ok(intents.filter(row => row.execution_context.mode !== 'scene-policy').every(row => controlled.has(row.actor_id)), '任何非scene内部意图都必须来自受控三NPC');
  assert.equal((await database.pool.query('SELECT COUNT(*)::integer AS count FROM ai_runs WHERE session_id=$1', [room.sessionId])).rows[0].count, 0);
  const current = await state(room);
  const worldEvents = (await database.pool.query('SELECT event FROM world_events WHERE session_id=$1 ORDER BY session_seq', [room.sessionId])).rows.map(row => row.event);
  assert.ok(worldEvents.length > 0);
  report.authority.push({ sessionId: room.sessionId, sessionSeq: current.sessionSeq, phase: current.phase, cuilanSafe: current.chapter.cuilanSafe, personalRequests: current.chapter.personalRequests, acquisitions: current.chapter.privateAcquisitions, sceneIntents: ownerIntents, receipts, worldEvents, roleTrace: Object.values(current.characters).map(actor => ({ characterId: actor.characterId, kind: actor.kind, controlMode: actor.mode, controlEpoch: actor.controlEpoch, sceneId: actor.sceneId, position: actor.position })), sceneController: server.scenePolicy.status(), receiptCount: receipts.length, humanActionCount: human.length, controlledIntentCount: intents.length - ownerIntents.length, aiRuns: 0 });
  report.rooms.find(row => row.sessionId === room.sessionId).audited = true;
}
async function leaseFault(baseURL) {
  report.leaseFault = { status: 'RUNNING', profile: 'three-real-pages-wall-clock-lease-with-delayed-maintenance', startedAt: new Date().toISOString(), samples: [] };
  const room = await newRoom(baseURL, 'gaolaozhuang-scene-v3', { count: 3 }); await rescue(room, 'front-guest-room');
  const { player, granted } = await permissionTerms(room, 'appearance');
  await nearOwner(room, player); await describeItems(room, player); accepted((await askItems(room, player, ['私人包裹'], 'single_use')).receipt);
  const privateGrant = await awaitDecision(room, player, 'private_items', 'accepted');
  await room.go(player, room.C('C07')); const takeReceipt = await take(room, player, '私人包裹');
  const original = { raw: (await clientState(room.pages[player])).actions.find(row => JSON.parse(row.raw).clientActionId === takeReceipt.clientActionId)?.raw, receipt: takeReceipt };
  assert.ok(original.raw, '保留实际页面发出的原取得 raw/ID，不在恢复时另造身份');
  await room.go('wukong', room.content.chapterRules.meetingDestinations.find(row => row.destinationId === 'rear-meeting'));
  const applyReceipt = accepted(await room.interact('wukong', 'self', 'gz-apply-appearance', { consentId: granted.consent.consentId, expectedConsentVersion: granted.consent.version }));
  const before = await state(room), actorId = before.members.find(member => member.userId === room.users[player].userId)?.characterId;
  assert.ok(actorId, '实际参与者归属须由持久状态可核对');
  const context = { actorId, itemId: 'gz-parcel', acquisitionId: before.items['gz-parcel'].personalAcquisitionId,
    appearance: granted.consent.consentId, private_items: privateGrant.consent.consentId };
  const active = sampleSharedPersonalEffects(before, context); assertBothActiveEffects(active);
  report.leaseFault.sharedEffects = { before: active, applyReceipt, originalTake: original };
  const actor = before.characters[actorId], connectionId = actor.activeConnectionId;
  const viewBeforeFault = await snapshot(room.pages[player]), oldView = viewBeforeFault?.viewId;
  assert.ok(oldView, '租约故障前保留本次真实页面的原 view 身份');
  report.leaseFault.viewBeforeFault = { viewId: oldView, snapshotSeq: viewBeforeFault.snapshotSeq, observedAt: new Date().toISOString() };
  const gate = deferLeaseMaintenance(server.runtime, room.sessionId, connectionId); restorers.add(gate);
  const trace = tracePersonalTransactions(server.runtime, room.sessionId, context); restorers.add(trace);
  try {
    const connections = Object.values(before.characters).filter(row => row.kind === 'human').map(row => row.activeConnectionId).filter(Boolean);
    const readLeases = async () => (await database.pool.query('SELECT connection_id,active,lease_until FROM connections WHERE connection_id=ANY($1::text[]) ORDER BY connection_id', [connections])).rows;
    const initial = await readLeases(), expiresAt = new Date(initial.find(row => row.connection_id === connectionId).lease_until).getTime();
    report.leaseFault.samples.push({ at: new Date().toISOString(), phase: 'before', leases: initial, originalEpoch: actor.controlEpoch });
    while (Date.now() <= expiresAt + 250) { await sleep(1000); if (Date.now() % 10000 < 1100) console.log(JSON.stringify({ stage: '等待真实租约到期', remainingMs: Math.max(0, expiresAt - Date.now()) })); }
    const expired = await readLeases(), atExpiry = await state(room);
    assert.ok(Date.now() > new Date(expired.find(row => row.connection_id === connectionId).lease_until).getTime());
    assert.ok(expired.filter(row => row.connection_id !== connectionId).every(row => row.active && new Date(row.lease_until).getTime() > Date.now()), '另两名实际连接仍在有效租约内');
    assert.equal(atExpiry.characters[actorId].controlEpoch, actor.controlEpoch, '故障窗口必须真实保留旧epoch，不能把普通断线混入');
    const rejected = await room.interact('wukong', 'self', 'gz-apply-appearance', { consentId: granted.consent.consentId, expectedConsentVersion: granted.consent.version });
    assert.equal(rejected.status, 'Rejected');
    const stopped = await state(room); assertSharedStoppedEffects(active, sampleSharedPersonalEffects(stopped, context), { systemPhase: false });
    const windowEvents = (await database.pool.query('SELECT event FROM world_events WHERE session_id=$1 AND session_seq>$2 ORDER BY session_seq', [room.sessionId, before.sessionSeq])).rows.map(row => row.event);
    const invalidation = windowEvents.find(event => event.kind === 'control.changed' && event.payload.actorId === actorId && event.payload.controlEpoch !== actor.controlEpoch);
    assert.ok(invalidation, '须保存首次实际观测租约失效时的权威事件，不把apply预设为首个操作');
    const transaction = trace.records.find(row => row.committed && row.events?.some(event => event.eventId === invalidation.eventId));
    assert.ok(transaction, '须绑定首次控制失效的已提交事务末态');
    const outbox = (await database.pool.query('SELECT from_exclusive::text,through_seq::text FROM outbox WHERE session_id=$1 AND from_exclusive=$2 AND through_seq=$3', [room.sessionId, transaction.before.sessionSeq, transaction.after.sessionSeq])).rows;
    assert.equal(outbox.length, 1); transaction.outbox = outbox[0];
    assertSharedStopTransaction(active, transaction);
    for (const purpose of ['appearance', 'private_items']) assert.equal(transaction.after.purposes[purpose].request.notice.sourceEventId, invalidation.eventId, '共享请求者失效在同一事件/事务停止两用途');
    assert.deepEqual(sampleSharedPersonalEffects(await server.runtime.replay(room.sessionId, transaction.outbox.through_seq), context), transaction.after);
    const following = trace.records.filter(row => row.committed && row.after && BigInt(row.after.sessionSeq) >= BigInt(transaction.after.sessionSeq));
    for (const row of following) assertSharedStoppedEffects(active, row.after, { systemPhase: false });
    report.leaseFault.sharedEffects.firstStop = transaction;
    report.leaseFault.sharedEffects.followingTransactions = following.map(row => ({ command: row.command, from: row.before.sessionSeq, through: row.after.sessionSeq, states: Object.fromEntries(Object.entries(row.after.purposes).map(([purpose, value]) => [purpose, value.request.execution.state])) }));
    // 这是故障诊断的真实历史 GET，不伪装成普通页面按钮；查询自身须零世界事件。
    const mark = trace.records.length;
    const response = await fetch(`http://127.0.0.1:${serverPort}/api/sessions/${room.sessionId}/actions/${takeReceipt.clientActionId}`, { headers: { Authorization: 'Bearer ' + room.users[player].token } });
    assert.equal(response.status, 200); const actual = await response.json();
    const readTransaction = trace.records.slice(mark).find(row => row.command === 'receipt');
    assert.ok(readTransaction); assertOriginalReceiptRead(original, actual, readTransaction);
    report.leaseFault.sharedEffects.receiptRead = { kind: 'diagnostic-http-original-history', original, actual, transaction: readTransaction };
    report.leaseFault.samples.push({ at: new Date().toISOString(), phase: 'expired-and-checked', leases: expired, epochAtExpiry: atExpiry.characters[actorId].controlEpoch, rejected, calls: { ...gate.calls }, windowEvents, firstInvalidation: invalidation });
    assert.ok(gate.calls.droppedHeartbeat > 0 && gate.calls.otherHeartbeat > 0 && gate.calls.deferredMaintenance > 0);
  } finally { gate.close(); restorers.delete(gate); trace.close(); restorers.delete(trace); }
  await recoverPlayer(room, player); await until(async () => !(await snapshot(room.pages[0])).projection.paused, '故障恢复后人数和控制恢复');
  assert.notEqual((await snapshot(room.pages[player])).viewId, oldView);
  const newView = await snapshot(room.pages[player]), remaining = newView.projection.chapter.privateReturns.find(row => row.returnContextId === context.acquisitionId);
  assert.equal(remaining?.mode, 'return_only'); assert.equal(remaining.originalConsentId, context.private_items);
  await nearOwner(room, player); const returned = await returnItem(room, player, '私人包裹', 'owner');
  const refusedAgain = await room.interact('wukong', 'self', 'gz-apply-appearance', { consentId: granted.consent.consentId, expectedConsentVersion: granted.consent.version }); assert.equal(refusedAgain.status, 'Rejected');
  const c2 = await Promise.all([context.appearance, context.private_items].map(consentId => sceneDecision(database.pool, room, consentId, 'withdrawn')));
  const returnedState = await state(room); assert.equal(returnedState.chapter.privateAcquisitions[context.acquisitionId].outcome, 'delivered_to_owner');
  report.leaseFault.sharedEffects.reconnected = { oldView, newView: newView.viewId, remaining, returned, acquisition: returnedState.chapter.privateAcquisitions[context.acquisitionId], c2, oldApplyRejected: refusedAgain };
  evidence('P-04', '三真实页面租约故障：双实际ACTIVE同事务停权、原Receipt零效果、新view窄归还与真实C2', { sessionId: room.sessionId, faultProfile: report.leaseFault.profile, originalConsentIds: [context.appearance, context.private_items] });
  report.leaseFault.status = 'PASS'; report.leaseFault.finishedAt = new Date().toISOString();
  await auditRoom(room); await room.close();
}

try {
  assert.equal(report.source.status, '', 'E2只能在完整干净候选上运行');
  if (process.env.CUILAN_EXPECTED_TREE) assert.equal(report.source.tree, process.env.CUILAN_EXPECTED_TREE);
  assert.equal(process.env.VITE_GAOLAO_CONTENT_VERSION, undefined, '新默认样本禁止环境覆写');
  const manifest = JSON.parse(await readFile(resolve(repository, 'frontend/runtime-assets.json'), 'utf8'));
  for (const file of manifest.files) {
    const bytes = await readFile(resolve(repository, 'frontend/public/assets/gaolaozhuang', file.file));
    assert.equal(sha256(bytes), file.sha256); report.resources.push({ file: file.file, bytes: bytes.length, sha256: file.sha256 });
  }
  assert.equal(report.resources.length, 65); assert.equal(report.resources.reduce((sum, row) => sum + row.bytes, 0), 29038902);
  database = await startTestPostgres('cuilan-e2', { outputSubdirectory: 'cuilan-production-postgres' });
  report.postgresVersion = (await database.pool.query('SHOW server_version')).rows[0].server_version;
  server = await createAuthorityServer({ pool: database.pool, spatialDirection: { checkpointMs: 50 } });
  directionConnections = observeDirectionConnections(server.runtime); restorers.add(directionConnections); serverPort = (await server.listen(0)).port;
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : [] }); report.chromiumVersion = browser.version();
  const defaultURL = await startFrontend();
  const primary = await newRoom(defaultURL, 'gaolaozhuang-scene-v3', { defaultEntry: true });
  await rescue(primary, 'front-guest-room', { beforeSafe: true });
  const appearance = await permissionTerms(primary, 'appearance'); await appearancePlaces(primary, appearance.granted);
  await deliverBoth(primary); await competition(primary); await interruptAppearance(primary); await finishChapter(primary); await auditRoom(primary); await primary.close();
  const eastURL = await startFrontend('gaolaozhuang-tools-east-scene-v3');
  const east = await newRoom(eastURL, 'gaolaozhuang-tools-east-scene-v3');
  await rescue(east, 'tea-back-room', { beforeSafe: true }); await permissionTerms(east, 'appearance'); await cancelPersonal(east, east.role('B'), 'appearance'); await deliverBoth(east); await finishChapter(east); await auditRoom(east); await east.close();
  const recovery = await newRoom(defaultURL, 'gaolaozhuang-scene-v3');
  await rescue(recovery, 'front-guest-room'); await oldPossessions(recovery); await auditRoom(recovery); await recovery.close();
  for (const row of report.cases) { assert.ok(row.evidence.length); row.status = 'PASS'; }
  await leaseFault(defaultURL);
  report.assessment = 'CHECKS_COMPLETE';
} catch (error) {
  report.assessment = /EPERM|EACCES|browserType\.launch|Executable doesn't exist|ECONNREFUSED/.test(String(error.stack)) && !report.rooms.length ? 'ENVIRONMENT_BLOCKED' : 'FAIL';
  report.error = { message: error.message, stack: error.stack }; console.error(error);
  if (report.leaseFault.status !== 'RUNNING' && activeCase) rowFor(activeCase).status = 'FAIL';
  if (report.leaseFault.status === 'RUNNING') report.leaseFault.status = 'FAIL';
  for (const [player, page] of (activeRoom?.pages ?? []).entries()) {
    try { await picture(activeRoom, 'failure', player); } catch {}
    report.failureTail ??= []; report.failureTail.push({ player, snapshot: await snapshot(page).catch(() => null), client: await clientState(page).catch(() => null), visibleText: await page.locator('body').innerText().catch(() => '') });
  }
} finally {
  await finalizeCuilanReport({ report, output, restorers, stopCollecting: collector.stop,
    resources: [['browser', Boolean(browser), () => browser.close()], ...vites.map((vite, index) => ['vite-' + index, true, () => vite.close()]), ['server', Boolean(server), () => server.close()], ['postgres', Boolean(database), () => database.stop()]],
    readSource: sourceIdentity, audit: async () => {
      assert.equal(sha256(await readFile(workflow)), report.workflowSha256);
      if (report.assessment === 'CHECKS_COMPLETE') { assertCompleteReport(report); report.assessment = 'PASS'; }
    } });
  restorers.clear();
  console.log(JSON.stringify({ assessment: report.assessment, cases: report.cases.map(row => ({ id: row.id, status: row.status })), output }));
  if (report.assessment !== 'PASS') process.exitCode = 1;
}
