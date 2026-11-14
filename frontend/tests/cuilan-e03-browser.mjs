// #59 / #29：仅补冻结 M29 §5 的两个 E03 证据缺口，不改变产品或原 driver。
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { evidenceMemoryEstimate, cancellable, createM29PgScope, captureIntegrity } from './cuilan-m29-browser.mjs';

export const workId = 'CS-T05-E03-MINIMAL';
export const cases = Object.freeze([
  Object.freeze({ id: 'E03-U3', count: 3, settled: false, defaultEntry: true, contentVersion: 'gaolaozhuang-scene-v3', destinationId: 'front-guest-room', ending: 'GZ-E03', acceptance: ['GZ-E03', 'GZ-SP-06', 'GZ-CS-09', 'GZ-CS-11', 'N11'] }),
  Object.freeze({ id: 'E03-G2', count: 2, settled: true, defaultEntry: true, contentVersion: 'gaolaozhuang-scene-v3', destinationId: 'front-guest-room', ending: 'GZ-E03', acceptance: ['GZ-E03', 'GZ-CS-06', 'GZ-CS-09', 'GZ-SP-06', 'N11'] }),
]);
export function chooseCase(args) {
  if (!args.length || JSON.stringify(args) === '["--list"]') return null;
  assert.deepEqual(args.slice(0, 2), ['--execute', '--case'], '只接受 --execute --case E03-U3 或 E03-G2');
  assert.equal(args.length, 3); const plan = cases.find(row => row.id === args[2]);
  assert.ok(plan, '只执行已释放的两个最小样本'); return plan;
}
export function executionInputs(env) {
  assert.match(env.CUILAN_E03_EXPECTED_COMMIT ?? '', /^[a-f0-9]{40}$/, '必须固定完整候选 commit');
  assert.match(env.CUILAN_E03_EXPECTED_TREE ?? '', /^[a-f0-9]{40}$/, '必须固定完整候选 tree');
  assert.ok(env.CUILAN_E03_RELEASE_REF?.trim() && !/NOT_RELEASED|待释放|TODO/i.test(env.CUILAN_E03_RELEASE_REF), '必须记录总控实际执行释放依据');
  return { expectedCommit: env.CUILAN_E03_EXPECTED_COMMIT, expectedTree: env.CUILAN_E03_EXPECTED_TREE, releaseRef: env.CUILAN_E03_RELEASE_REF };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const plan = chooseCase(process.argv.slice(2));
  if (!plan) console.log(JSON.stringify({ workId, status: 'PLANNED_NOT_RUN', cases }, null, 2));
  else await execute(plan, executionInputs(process.env));
}
async function bounded(task, milliseconds, label) {
  let timer;
  try { return await Promise.race([task(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + '超过' + milliseconds + 'ms')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

async function execute(plan, release) {
  const [{ createServer: createVite }, { chromium }, { startTestPostgres }, { createAuthorityServer },
    legacy, network, ui, personal] = await Promise.all([
    import('vite'), import('playwright'), import('../../backend/test-support/postgres.mjs'), import('../../backend/server.mjs'),
    import('../../backend/test-support/gaolao-room.mjs'), import('./network-support.mjs'), import('./gaolao-real-support.mjs'),
    import('./cuilan-self-response-support.mjs'),
  ]);
  const { accepted, take, share, cleanupPublic } = legacy;
  const { repository, sourceIdentity, sha256, until, sleep } = network;
  const { browserRoom, snapshot, clientState, openReading } = ui;
  const { productionProfile, describeItems, askItems, personalState, clickAction,
    holdSubmissions, authoritativeState, sceneDecision, assertRoomIdentity, saveCuilanReportJSON, createCuilanReportCollector } = personal;
  assert.equal(typeof saveCuilanReportJSON, 'function', '运行候选必须包含已独审释放的共享完整报告 writer；准备分支不可自行绕过依赖。');
  assert.equal(typeof createCuilanReportCollector, 'function');
  const saveJSON = async (file, value, { signal, timeoutMs = 15000 } = {}) => {
    const controller = new AbortController(), combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    try { return await bounded(() => saveCuilanReportJSON(file, value, { signal: combined }), timeoutMs, '保存 ' + file); }
    catch (error) { controller.abort(error); throw error; }
  };
  const output = resolve(process.env.FRONTEND_EVIDENCE_DIR || resolve(repository, '.agent-output/cuilan-e03', plan.id));
  await mkdir(output, { recursive: true });
  // 与 stdout 预建目录兼容；任何已存在的捕获目录都拒绝覆盖。
  await mkdir(resolve(output, 'capture')); await mkdir(resolve(output, 'authority'));
  const report = {
    workId, executionKind: 'production-browser-e03', assessment: 'RUNNING', case: plan, release,
    startedAt: new Date().toISOString(), source: await sourceIdentity(), nodeVersion: process.version,
    scope: '单场两/三自动化客户端、正常Vue与HTTP/Socket/真实PG；生产翠兰、三受控NPC；仅E03最小交错，不计真人/provider/艺术。',
    humanActions: [], npcActions: [], recapResponses: [], pageErrors: [], externalRequests: [], creationRequests: [],
    requestFrames: [], receiptFrames: [], socketLifetimes: [], connectionSamples: [], stages: [],
    screenshots: [], failureTail: [], cleanup: [], evidenceErrors: [], realProviderCalls: 0,
    notCovered: ['真人四局及贡献指标', '真实provider', '真机与正式艺术', 'E03全人数/变体矩阵', '生产本人迟到intent故障窗', '真实C2撤回', '部署'],
  };
  const driverPath = resolve(repository, 'frontend/tests/cuilan-e03-browser.mjs');
  const documentationPath = resolve(repository, 'frontend/tests/cuilan-e03-browser.md');
  report.driverSha256 = sha256(await readFile(driverPath));
  report.documentationSha256 = sha256(await readFile(documentationPath));
  let database, server, browser, vite, room, sampleTask, runtimePool, mainTask, sampling = false, deadlineExceeded = false;
  const mainAbort = new AbortController(), shutdown = new Map(), creating = new Set(), controlledTasks = new Set();
  const closeOnce = (name, close) => {
    if (!shutdown.has(name)) shutdown.set(name, Promise.resolve().then(close));
    const pending = shutdown.get(name); pending.catch(() => {}); return pending;
  };
  const stopMain = reason => {
    if (!mainAbort.signal.aborted) mainAbort.abort(reason);
    sampling = false; runtimePool?.close(reason);
    for (const gate of restorers) { try { gate.close(); } catch {} }
    if (browser) void closeOnce('browser', () => browser.close());
    if (server) void closeOnce('server', () => server.close());
  };
  const acquire = async (name, task, close) => {
    creating.add(name);
    const creation = Promise.resolve().then(() => { mainAbort.signal.throwIfAborted(); return task(); });
    creation.catch(() => creating.delete(name));
    const resource = await cancellable(() => creation, { signal: mainAbort.signal, label: '创建 ' + name,
      late: resource => bounded(() => close(resource), 15000, '销毁截止后才返回的 ' + name)
        .then(() => { creating.delete(name); console.error('E03 迟到资源已关闭：', name); }, error => console.error('E03 迟到资源未能关闭：', name, error.message)) });
    creating.delete(name); return resource;
  };
  const pageIds = new WeakMap(), restorers = new Set();
  const stamp = () => ({ at: new Date().toISOString(), monotonicMs: performance.now() });
  const collectionKeys = ['humanActions', 'npcActions', 'recapResponses', 'pageErrors', 'externalRequests', 'creationRequests',
    'requestFrames', 'receiptFrames', 'socketLifetimes', 'connectionSamples', 'stages', 'screenshots', 'failureTail'];
  const collectionCounts = Object.fromEntries(collectionKeys.map(key => [key, 0]));
  let retainedBytes = 0, retainedRows = 0, recapIndexBytes = 0, captureClosed = false;
  const recapSeen = new Map();
  const captureLimits = { retainedBytes: 128 * 1024 * 1024, retainedRows: 30000, pageEstimate: 4 * 1024 * 1024,
    pageRows: 100, queuedEstimate: 32 * 1024 * 1024 };
  const capture = { file: 'capture/manifest.json', status: 'OPEN', pages: [], rows: 0, observedCounts: {} };
  const captureAbort = new AbortController();
  let pendingPage = [], pendingEstimate = 0, queuedEstimate = 0, captureWrites = Promise.resolve();
  const recordEvidenceError = (stage, error) => {
    report.assessment = 'FAIL';
    report.evidenceErrors.push({ stage, message: error.message, ...stamp() });
    console.error('E03 证据失败：', stage, error.message);
  };
  const abortCapture = (stage, error) => {
    recordEvidenceError(stage, error);
    stopMain(error);
  };
  const collector = createCuilanReportCollector(error => abortCapture('observer', error));
  function flushCapturePage() {
    if (!pendingPage.length) return;
    const rows = pendingPage, estimate = pendingEstimate; pendingPage = []; pendingEstimate = 0;
    const counts = {};
    for (const row of rows) counts[row.type] = (counts[row.type] ?? 0) + 1;
    const page = { file: 'capture/page-' + String(capture.pages.length + 1).padStart(6, '0') + '.json',
      firstOrdinal: rows[0].ordinal, lastOrdinal: rows.at(-1).ordinal, counts, rows: rows.length, status: 'PENDING' };
    capture.pages.push(page);
    captureWrites = captureWrites.then(async () => {
      try { Object.assign(page, await saveJSON(resolve(output, page.file), { schema: 'e03-client-page-v1', rows }, { signal: captureAbort.signal }), { status: 'COMPLETE' }); }
      catch (error) { page.status = 'FAIL'; page.error = error.message; abortCapture('save-capture-page', error); }
      finally { queuedEstimate -= estimate; }
    });
  }
  function appendObservation(value, { closing = false } = {}) {
    const estimate = evidenceMemoryEstimate(value);
    pendingPage.push({ ordinal: ++capture.rows, ...value }); pendingEstimate += estimate; queuedEstimate += estimate;
    capture.observedCounts[value.type] = (capture.observedCounts[value.type] ?? 0) + 1;
    if (pendingPage.length >= captureLimits.pageRows || pendingEstimate >= captureLimits.pageEstimate) flushCapturePage();
    if (!closing && queuedEstimate > captureLimits.queuedEstimate) {
      sampling = false;
      void collector.stop().catch(error => recordEvidenceError('stop-after-capture-budget', error));
      throw new Error('原始待写页超过32MiB保守估计；立即停止新观察并失败，已观察原页继续完整写入');
    }
  }
  appendObservation({ type: 'capture-header', workId, caseId: plan.id, source: report.source, ...stamp() });
  for (const key of collectionKeys) {
    const values = report[key];
    Object.defineProperty(values, 'push', { value(...rows) {
      for (const row of rows) {
        collectionCounts[key]++;
        try {
          if (captureClosed) throw new Error('采集已冻结后还有 ' + key + ' 回调；该样本证据不完整');
          appendObservation({ type: key, kindOrdinal: collectionCounts[key], observed: stamp(), value: row });
          // 原复盘全文进入完整原页；只把跨页核对所需 entryRef 放在有界内存索引。
          let retained = row;
          if (key === 'recapResponses') {
            const seenKey = row.sessionId + ':' + row.player;
            if (!recapSeen.has(seenKey)) recapSeen.set(seenKey, { entries: new Set(), bytes: 0 });
            const seen = recapSeen.get(seenKey); let duplicates = 0;
            for (const entry of row.value.entries ?? []) {
              if (seen.entries.has(entry.entryRef)) duplicates++;
              else { const bytes = evidenceMemoryEstimate(entry.entryRef) + 64; seen.entries.add(entry.entryRef); seen.bytes += bytes; recapIndexBytes += bytes; }
            }
            retained = { player: row.player, sessionId: row.sessionId, status: row.status, query: row.query, bytes: row.bytes,
              value: { throughSeq: row.value.throughSeq, nextBeforeSeq: row.value.nextBeforeSeq,
                entryCount: row.value.entries?.length ?? 0, duplicates } };
          } else if (key === 'requestFrames') {
            retained = { pageId: row.pageId, request: row.request, at: row.at, monotonicMs: row.monotonicMs };
          } else if (key === 'receiptFrames') {
            retained = { pageId: row.pageId, receipt: row.receipt, at: row.at, monotonicMs: row.monotonicMs };
          } else if (key === 'failureTail') {
            retained = { player: row.player, snapshotSeq: row.snapshot?.snapshotSeq ?? null, textBytes: Buffer.byteLength(row.text || '') };
          }
          const size = evidenceMemoryEstimate(retained);
          if (retainedBytes + recapIndexBytes + size > captureLimits.retainedBytes || retainedRows + 1 > captureLimits.retainedRows)
            throw new Error('完整原值已进入待写原页，但内存核对索引超过明确上限；立即终止，不裁剪后报通过');
          retainedBytes += size; retainedRows++; Array.prototype.push.call(values, retained);
        } catch (error) { abortCapture('collect:' + key, error); }
      }
      return values.length;
    } });
  }
  const reportValue = () => ({ ...Object.fromEntries(Object.entries(report).filter(([key]) => !collectionKeys.includes(key))),
    observations: { ...capture, counts: { ...collectionCounts }, retainedBytes, retainedRows, recapIndexBytes, queuedEstimate,
      limits: captureLimits, frozen: captureClosed } });
  const listen = collector.observe;
  const state = async () => (await authoritativeState(runtimePool.pool, room.sessionId)).state;
  const requestFrame = id => report.requestFrames.find(row => row.request.clientActionId === id);
  const receiptFrame = id => report.receiptFrames.find(row => row.receipt.clientActionId === id);
  const budgetMs = 12 * 60000;
  const deadline = setTimeout(() => { deadlineExceeded = true; stopMain(new Error('E03 主流程达到已登记截止时间')); }, budgetMs);
  deadline.unref();
  const signal = () => { deadlineExceeded = true; stopMain(new Error('E03 收到进程终止信号')); };
  process.once('SIGTERM', signal); process.once('SIGINT', signal);

  function instrument(page) {
    const pageId = crypto.randomUUID(); pageIds.set(page, pageId);
    listen(page, 'request', request => {
      const url = new URL(request.url());
      if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname))
        report.externalRequests.push({ pageId, origin: url.origin, path: url.pathname });
      if (url.pathname === '/api/sessions' && request.method() === 'POST')
        report.creationRequests.push({ pageId, request: request.postDataJSON(), ...stamp() });
    });
    listen(page, 'websocket', socket => {
      if (!new URL(socket.url()).pathname.startsWith('/socket.io/')) return;
      const socketId = crypto.randomUUID();
      report.socketLifetimes.push({ pageId, socketId, event: 'open', ...stamp() });
      listen(socket, 'close', () => report.socketLifetimes.push({ pageId, socketId, event: 'close', ...stamp() }));
      listen(socket, 'framesent', frame => {
        const text = String(frame.payload); if (!/^42\d*\[/.test(text)) return;
        try {
          const [event, raw] = JSON.parse(text.replace(/^42\d*/, ''));
          if (event === 'player.action.request')
            report.requestFrames.push({ pageId, socketId, request: JSON.parse(raw), raw, frame: text, ...stamp() });
        } catch (error) { report.pageErrors.push({ pageId, message: '实际发送帧无法解析：' + error.message }); }
      });
      listen(socket, 'framereceived', frame => {
        const text = String(frame.payload); if (!/^43\d*\[/.test(text)) return;
        try {
          const [receipt] = JSON.parse(text.replace(/^43\d*/, ''));
          if (receipt?.schemaVersion === 2 && receipt.clientActionId && ['Accepted', 'Rejected'].includes(receipt.status))
            report.receiptFrames.push({ pageId, socketId, receipt, frame: text, ...stamp() });
        } catch (error) { report.pageErrors.push({ pageId, message: '实际ACK帧无法解析：' + error.message }); }
      });
    });
    return page;
  }
  async function sampleConnections(label) {
    const participants = await Promise.all(room.pages.map(async (page, player) => {
      try {
        if (page.isClosed()) return { player, pageId: pageIds.get(page), userId: room.users[player].userId, closed: true };
        const [current, client] = await Promise.all([snapshot(page), clientState(page)]);
        return { player, pageId: pageIds.get(page), userId: room.users[player].userId, connection: client.connection,
          inputReady: client.inputReady, canControl: current?.projection.self.canControl ?? null, viewId: current?.viewId ?? null, controlEpoch: current?.projection.self.controlEpoch ?? null,
          snapshotSeq: current?.snapshotSeq ?? null, paused: current?.projection.paused ?? null };
      } catch (error) { return { player, pageId: pageIds.get(page), userId: room.users[player].userId, readingError: error.message }; }
    }));
    const row = { label, ...stamp(), participants }; report.connectionSamples.push(row); return row;
  }
  async function picture(label, player = 0) {
    const file = report.screenshots.length + '-' + label + '.png';
    await room.pages[player].screenshot({ path: resolve(output, file), fullPage: true });
    report.screenshots.push({ file, player, ...stamp(), sha256: sha256(await readFile(resolve(output, file))) });
  }
  async function stage(label, detail = {}) {
    const current = await state();
    const row = { label, ...stamp(), sessionSeq: current.sessionSeq, phase: current.phase, paused: current.paused,
      cuilanSafe: current.chapter.cuilanSafe, ending: current.ending, authorityState: current,
      snapshots: await Promise.all(room.pages.map(async (page, player) => ({ player, ...(page.isClosed() ? { closed: true } : { snapshot: await snapshot(page) }) }))),
      sceneController: server.scenePolicy.status(), ...detail };
    report.stages.push(row);
    console.log(JSON.stringify({ stage: label, at: row.at, sessionSeq: row.sessionSeq, phase: row.phase, paused: row.paused, cuilanSafe: row.cuilanSafe }));
    return row;
  }
  async function nearOwner(player) {
    const current = await state();
    const destination = room.content.chapterRules.safeDestinations.find(row => row.destinationId === current.chapter.safeRecord?.destinationId);
    assert.ok(destination, '必须沿真实安置事实找到本人，不能修改或移动翠兰。');
    await room.go(player, destination);
  }
  async function decision(player, purpose, status, options) {
    const value = await personalState(room, player, purpose, status, options);
    const response = { accepted: 'accept', declined: 'decline', withdrawn: 'withdrawn' }[status];
    const proof = response ? await sceneDecision(runtimePool.pool, room, value.consent.consentId, response) : null;
    return { ...value, proof };
  }
  async function assertBoundProposal(granted, ask) {
    const record = (await state()).chapter.personalRequests[granted.consent.consentId];
    assert.equal(record.proposalBinding.requestActionId, ask.request.clientActionId, '生产回应必须属于这次真实玩家请求。');
    assert.equal(record.execution.acceptedProof.consentVersion, granted.consent.version);
    return record;
  }
  // 导航取自冻结 E03 的正常救援路径，只把自然中间点作为 U3 的停止位置。
  async function rescue() {
    const carer = room.role('B'), craft = room.role('C');
    assert.equal(carer, 0, '本次默认两/三客户端中的请求者固定为第0页');
    await room.go(carer, room.C('C04')); accepted(await room.interact(carer, '侧窗联络点', 'gz-contact'));
    await until(async () => (await state()).chapter.retreated === true, '生产本人实际退让', 25000);
    await room.go(carer, room.C('C01')); accepted(await room.interact(carer, '铜封门', 'gz-check-seal'));
    await room.go('wukong', room.C('C01'));
    await share(room, carer, '侧窗本人回应', '孙悟空'); await share(room, carer, '亲自在门外检查铜封', '孙悟空');
    for (const [player, id, name] of [[carer, 'gz-brace', '公共门撑'], [craft, 'gz-rope', '公共绳索']]) {
      await room.go(player, room.content.items.find(item => item.itemId === id)); await take(room, player, name);
    }
    await room.go(carer, room.C('C02')); await room.go(craft, room.C('C03'));
    for (const player of [carer, craft]) accepted(await room.send(player, { kind: 'cooperate', operationId: 'gz-lock-support', operationVersion: '0', phase: 'ready' }));
    accepted(await room.interact('wukong', '铜封门', 'gz-break-seal')); await room.go(carer, room.C('C08'));
    const p = (await snapshot(room.pages[carer])).projection, owner = await room.entity(carer, '翠兰');
    accepted(await room.send(carer, { kind: 'propose_follow', subjectRef: owner.entityRef, leaderRef: p.self.entityRef,
      destinationId: plan.destinationId, expectedTargetRevision: owner.resourceRevision }));
    const follow = await until(async () => (await snapshot(room.pages[carer])).projection.chapter.consents.findLast(row => row.purpose === 'follow' && row.status === 'accepted'), '生产本人接受随行', 20000);
    const proof = await sceneDecision(runtimePool.pool, room, follow.consentId, 'accept');
    await room.go(carer, room.C('C01'));
    if (plan.settled) {
      for (const destination of [room.C('C13'), room.C('C11'), room.C('C12')]) await room.go(carer, destination);
      await until(async () => (await state()).chapter.cuilanSafe === true, '实际随行抵达并由生产本人确认', 40000);
      await cleanupPublic(room);
    } else {
      const current = await state(), actual = current.chapter.follows[room.content.chapterRules.people.cuilan];
      assert.equal(current.chapter.cuilanSafe, false); assert.equal(current.chapter.retreated, true);
      assert.equal(actual.consentId, follow.consentId); assert.ok(['accepted', 'following'].includes(actual.status));
      assert.equal(current.chapter.consents[follow.consentId].status, 'accepted');
    }
    report.rescue = { followConsentId: follow.consentId, acceptedProof: proof, destinationId: plan.destinationId, settled: plan.settled };
    await stage(plan.settled ? '生产本人实际安置' : '生产本人已退让并接受随行但尚未安置', report.rescue);
    await picture(plan.settled ? 'settled' : 'unsettled-follow', carer);
  }
  const actorId = (current, player) => {
    const member = current.members.find(row => row.userId === room.users[player].userId);
    assert.ok(member); return member.characterId;
  };
  const eventsBetween = async (from, through) => (await runtimePool.pool.query(
    'SELECT * FROM world_events WHERE session_id=$1 AND session_seq>$2 AND session_seq<=$3 ORDER BY session_seq',
    [room.sessionId, from, through])).rows;
  async function requestChapter(player = 0) {
    await openReading(room.pages[player], '进展');
    return clickAction(room, player, '提议暂告一段', { kind: 'request_end' }, page => page.getByRole('button', { name: '提议暂告一段', exact: true }).click());
  }
  async function confirmChapter(player) {
    await openReading(room.pages[player], '进展');
    return clickAction(room, player, '我确认本轮选择', { kind: 'confirm_end' }, page => page.getByRole('button', { name: '我确认本轮选择', exact: true }).click());
  }
  async function disconnectEvidence(before, current, player) {
    const id = actorId(before, player), rows = await eventsBetween(before.sessionSeq, current.sessionSeq);
    const changes = rows.filter(row => row.event.kind === 'control.changed' && row.event.payload.actorId === id && row.event.payload.mode === 'GracePeriod');
    assert.equal(changes.length, 1, '同一次正常页面断开只有一个实际进入宽限事件');
    const changed = changes[0].event;
    assert.match(changed.causedBy.actionId, /^disconnect:/, '必须来自正常连接关闭，不以租约故障替代');
    assert.equal(Date.parse(changed.payload.graceDeadlineAt) - Date.parse(changed.serverTime), 5000);
    assert.equal(changed.payload.controlEpoch, String(BigInt(before.characters[id].controlEpoch) + 1n));
    assert.equal(current.characters[id].activeConnectionId, null);
    return { player, actorId: id, controlChanged: changes[0], rows, graceDeadlineAt: changed.payload.graceDeadlineAt };
  }
  async function unsettledMembership() {
    const begin = await state(), requester = actorId(begin, 0), confirmer = actorId(begin, 1), leaving = actorId(begin, 2);
    assert.equal(begin.chapter.cuilanSafe, false); assert.equal(begin.chapter.onlineActorIds.length, 3);
    const first = await requestChapter(); accepted(first.receipt);
    const proposed = await state(), old = proposed.chapter.endProposal;
    assert.equal(old.status, 'pending'); assert.equal(old.proposalId, first.request.action.proposalId);
    assert.equal(old.proposalVersion, String(BigInt(first.request.action.proposalVersion) + 1n));
    assert.deepEqual(old.requiredIds, [requester, confirmer, leaving].sort()); assert.deepEqual(old.confirmedIds, [requester]);
    await until(async () => (await snapshot(room.pages[1])).projection.chapter.endProposal?.proposalId === old.proposalId, '第二页收到当前有效的三人结束轮');
    await openReading(room.pages[1], '进展');
    const beforeView = await snapshot(room.pages[1]);
    const gate = holdSubmissions(server.runtime, request => request.sessionId === room.sessionId && request.action.kind === 'confirm_end', 1);
    restorers.add(gate); const heldAt = stamp(); let expired = false;
    const timer = setTimeout(() => { expired = true; gate.close(); stopMain(new Error('旧结束轮真实确认屏障超过15秒')); }, 15000);
    let deferred, invalidated, changed, stale, atRelease;
    try {
      deferred = await clickAction(room, 1, '正常页面原结束确认（一次提交屏障）', { kind: 'confirm_end' },
        page => page.getByRole('button', { name: '我确认本轮选择', exact: true }).click(), { deferReceipt: true });
      await bounded(() => gate.ready, 5000, '取得真实页面原confirm');
      assert.equal(gate.held.length, 1); assert.deepEqual(gate.held[0].request, deferred.request);
      assert.deepEqual(deferred.request.action, { kind: 'confirm_end', proposalId: old.proposalId, proposalVersion: old.proposalVersion });
      assert.equal((await state()).chapter.endProposal.status, 'pending', '断开前原轮必须仍有效，不能预先制造拒绝');
      await room.contexts[2].close();
      invalidated = await until(async () => { const value = await state(); return value.chapter.endProposal?.status === 'invalidated' && value.chapter.onlineActorIds.length === 2 ? value : false; }, '第三页真实断开使原轮失效', 5000);
      assert.deepEqual(invalidated.chapter.endProposal, { ...old, status: 'invalidated' });
      assert.equal(invalidated.chapter.endVersion, proposed.chapter.endVersion);
      assert.equal(invalidated.onlineMembershipVersion, String(BigInt(proposed.onlineMembershipVersion) + 1n));
      assert.deepEqual(invalidated.chapter.onlineActorIds, [requester, confirmer].sort());
      assert.equal(invalidated.characters[confirmer].controlEpoch, proposed.characters[confirmer].controlEpoch);
      assert.equal((await snapshot(room.pages[1])).viewId, beforeView.viewId, '原确认者的view未换代');
      changed = await disconnectEvidence(proposed, invalidated, 2);
      const invalidation = changed.rows.find(row => row.event.kind === 'gaolao.chapter' && row.event.payload.chapter.endProposal?.proposalId === old.proposalId && row.event.payload.chapter.endProposal.status === 'invalidated');
      const membership = changed.rows.find(row => row.event.kind === 'gaolao.membership' && row.event.payload.version === invalidated.onlineMembershipVersion);
      assert.ok(invalidation && membership); assert.deepEqual(invalidation.event.causedBy, changed.controlChanged.event.causedBy);
      assert.deepEqual(membership.event.causedBy, changed.controlChanged.event.causedBy);
      assert.ok(BigInt(invalidation.session_seq) > BigInt(changed.controlChanged.session_seq));
      atRelease = stamp(); gate.release(); stale = await deferred.complete();
      assert.equal(expired, false); assert.equal(stale.receipt.status, 'Rejected'); assert.equal(stale.receipt.code, 'STALE_PRECONDITION');
      assert.equal(stale.receipt.actionEventRange, null);
      const after = await state(); assert.equal(after.phase, 'Running'); assert.deepEqual(after.chapter.endProposal, invalidated.chapter.endProposal);
    } finally { clearTimeout(timer); gate.close(); restorers.delete(gate); }
    report.membershipWindow = { first, oldProposal: old, beforeView, proposed, invalidated, disconnect: changed,
      gate: { heldAt, releasedAt: atRelease, maximumMs: 15000, expired, held: gate.held }, stale, claim: '只有原人类confirm交错；没有注入或声称NPC迟到intent' };
    await stage('成员变化使原结束轮失效且同一原确认明确拒绝');
    const fresh = await requestChapter(); accepted(fresh.receipt);
    const freshState = await state(), current = freshState.chapter.endProposal;
    assert.notEqual(current.proposalId, old.proposalId); assert.equal(current.proposalVersion, String(BigInt(old.proposalVersion) + 1n));
    assert.equal(current.onlineMembershipVersion, invalidated.onlineMembershipVersion);
    assert.deepEqual(current.requiredIds, [requester, confirmer].sort()); assert.deepEqual(current.confirmedIds, [requester]);
    await until(async () => (await snapshot(room.pages[1])).projection.chapter.endProposal?.proposalId === current.proposalId, '剩余两页得到新轮');
    const confirmation = await confirmChapter(1); accepted(confirmation.receipt);
    const final = await until(async () => { const value = await state(); return value.phase === 'Finished' ? value : false; }, '新两人轮真实结束未完成章节');
    assert.equal(final.ending.endingCode, 'GZ-E03'); assert.equal(final.chapter.cuilanSafe, false);
    assert.equal(final.ending.facts.find(row => row.key === 'safe').value, false);
    assert.equal(final.ending.facts.find(row => row.key === 'open').value, true);
    assert.equal(final.ending.facts.find(row => row.key === 'returned').value, false);
    assert.deepEqual(final.chapter.endProposal.confirmedIds.slice().sort(), [requester, confirmer].sort());
    report.freshEnding = { fresh, proposal: current, confirmation, finalState: final };
    report.originalReceipt = stale; report.activePlayers = [0, 1];
  }
  async function singleGrace() {
    await nearOwner(0); await describeItems(room, 0);
    const ask = await askItems(room, 0, ['私人信件'], 'single_use'); accepted(ask.receipt);
    const granted = await decision(0, 'private_items', 'accepted'); await assertBoundProposal(granted, ask);
    await room.go(0, room.C('C07')); const takeReceipt = accepted(await take(room, 0, '私人信件'));
    const before = await state(), holder = actorId(before, 0), other = actorId(before, 1);
    const acquisition = Object.values(before.chapter.privateAcquisitions).find(row => row.takeActionId === takeReceipt.clientActionId && row.itemId === 'gz-letter');
    assert.ok(acquisition); assert.equal(acquisition.outcome, 'held'); assert.equal(acquisition.holderId, holder);
    assert.equal(acquisition.originalConsentId, granted.consent.consentId);
    const personal = before.chapter.personalRequests[granted.consent.consentId], consent = before.chapter.consents[granted.consent.consentId];
    assert.equal(personal.lifecycle, 'open'); assert.equal(personal.reasonCode, null);
    assert.equal(personal.proposalBinding.requesterId, holder);
    assert.ok(![personal.proposalBinding.subjectId, personal.proposalBinding.requesterId, personal.proposalBinding.performerId].includes(other), '离线页是本份许可的非参与者');
    report.heldPrivate = { ask, granted, takeReceipt, acquisition, personal, consent, before };
    await stage('已安置且单次许可下真实持有原信件'); await picture('held-letter');
    await openReading(room.pages[0], '进展');
    const beforeClose = await state(); await room.contexts[1].close();
    const paused = await until(async () => { const value = await state(); return value.paused && value.chapter.onlineActorIds.length === 1 && value.characters[other].graceDeadlineAt ? value : false; }, '正常断开后真实单人暂停', 3000);
    const deadlineAt = paused.characters[other].graceDeadlineAt;
    assert.ok(Date.now() < Date.parse(deadlineAt), '必须在真实宽限窗口内发出第一条请求，错过不得算通过');
    const early = await clickAction(room, 0, '真实宽限前提议暂告一段', { kind: 'request_end' },
      page => page.getByRole('button', { name: '提议暂告一段', exact: true }).click());
    const earlyReceivedAt = stamp();
    assert.equal(early.receipt.status, 'Rejected'); assert.equal(early.receipt.code, 'NOT_READY'); assert.equal(early.receipt.actionEventRange, null);
    assert.ok(Date.parse(earlyReceivedAt.at) < Date.parse(deadlineAt), '真实ACK已在宽限截止前收到');
    const afterEarly = await state(); assert.equal(afterEarly.phase, 'Running'); assert.equal(afterEarly.chapter.endProposal, null);
    assert.deepEqual(afterEarly.chapter.personalRequests[consent.consentId], personal, '非参与者断开只暂停，不伪造本人撤回或许可失效');
    const disconnect = await disconnectEvidence(beforeClose, paused, 1);
    assert.equal(disconnect.graceDeadlineAt, deadlineAt);
    // 同主机实际墙钟；等待原deadline，不重写 timing/now，也不主动调用维护以越过宽限。
    const waitStarted = stamp();
    while (Date.now() <= Date.parse(deadlineAt) + 100) { mainAbort.signal.throwIfAborted(); await sleep(30); }
    const afterDeadline = stamp(), late = await requestChapter(); accepted(late.receipt);
    assert.ok(Date.parse(afterDeadline.at) > Date.parse(deadlineAt)); assert.notEqual(late.request.clientActionId, early.request.clientActionId);
    const final = await until(async () => { const value = await state(); return value.phase === 'Finished' ? value : false; }, '真实宽限到期后剩余页明确结束');
    assert.equal(final.ending.endingCode, 'GZ-E03'); assert.equal(final.chapter.cuilanSafe, true);
    assert.deepEqual(final.chapter.endProposal.requiredIds, [holder]); assert.deepEqual(final.chapter.endProposal.confirmedIds, [holder]);
    const closed = final.chapter.personalRequests[consent.consentId];
    assert.equal(closed.lifecycle, 'closed'); assert.equal(closed.reasonCode, 'session_ended'); assert.equal(closed.execution.state, 'return_only');
    assert.deepEqual(closed.execution.acceptedProof, personal.execution.acceptedProof);
    assert.deepEqual(final.chapter.consents[consent.consentId], consent);
    assert.deepEqual(final.chapter.privateAcquisitions[acquisition.acquisitionId], acquisition, '离线与终结不伪归还或改写原取得');
    assert.equal(final.items['gz-letter'].location.characterId, holder);
    const range = late.receipt.actionEventRange; assert.ok(range);
    const terminalRows = await eventsBetween(String(BigInt(range.first) - 1n), range.last);
    const stop = terminalRows.find(row => row.event.kind === 'gaolao.chapter' && row.event.payload.chapter.personalRequests[consent.consentId]?.reasonCode === 'session_ended');
    const ended = terminalRows.find(row => row.event.kind === 'session.finished');
    assert.ok(stop && ended); assert.ok(BigInt(stop.session_seq) < BigInt(ended.session_seq));
    assert.equal(stop.event.causedBy.actionId, late.request.clientActionId); assert.equal(ended.event.causedBy.actionId, late.request.clientActionId);
    const outbox = (await runtimePool.pool.query('SELECT * FROM outbox WHERE session_id=$1 AND from_exclusive<$2 AND through_seq>=$3', [room.sessionId, range.first, range.last])).rows;
    assert.equal(outbox.length, 1, '停权与E03位于同一次实际提交的outbox范围');
    report.graceWindow = { beforeClose, paused, deadlineAt, early, earlyReceivedAt, afterEarly, disconnect, waitStarted, afterDeadline, late,
      terminalRows, outbox, finalState: final, claim: '非参与者断开后终态直接closed/session_ended；本场没有真实C2撤回主张' };
    await until(async () => (await snapshot(room.pages[0])).projection.phase === 'Finished', '剩余页收到终态原投影');
    await openReading(room.pages[0], '行囊');
    const returns = (await snapshot(room.pages[0])).projection.chapter.privateReturns;
    assert.equal(returns.length, 1); assert.equal(returns[0].returnContextId, acquisition.acquisitionId); assert.equal(returns[0].originalConsentId, consent.consentId);
    for (const suffix of ['交回本人', '放回原处']) assert.equal(await room.pages[0].getByRole('button', { name: '将私人信件' + suffix, exact: true }).isDisabled(), true);
    report.terminalPrivate = { returns, snapshot: await snapshot(room.pages[0]) }; await picture('terminal-private-remainder');
    report.originalReceipt = report.humanActions.find(row => row.request.clientActionId === takeReceipt.clientActionId);
    assert.ok(report.originalReceipt); report.activePlayers = [0];
  }
  async function terminalAndRecap() {
    const terminal = await state(); assert.equal(terminal.ending.endingCode, 'GZ-E03');
    const settledScene = await until(() => {
      const value = server.scenePolicy.status(), actor = value.actors.find(row => row.sessionId === room.sessionId);
      return actor && actor.phase === 'Idle' && actor.pendingSemanticSeq === '0' && !actor.bootstrap ? value : false;
    }, '生产本人终态待办自然收束', 5000);
    await sleep(1200);
    assert.deepEqual(await state(), terminal, '终态停止世界推进，不推进旧follow或复活原许可');
    assert.deepEqual(server.scenePolicy.status(), settledScene, '终态没有新本人评估或选择');
    report.terminalStability = { state: terminal, scene: settledScene, observedUntil: stamp(), intervalMs: 1200,
      claim: '真实终态收束和观察窗口；未安排生产本人在途intent，不称迟到intent验证' };
    // 正常授权的历史HTTP只读核对，明确区别于玩家页面动作，不触发重放。
    const original = report.originalReceipt, beforeRead = await state();
    const response = await fetch(new URL('/api/sessions/' + room.sessionId + '/actions/' + original.request.clientActionId, room.pages[0].url()),
      { headers: { Authorization: 'Bearer ' + room.users[original.player].token }, signal: mainAbort.signal });
    assert.equal(response.status, 200); const read = await response.json(); assert.deepEqual(read, original.receipt);
    assert.deepEqual(await state(), beforeRead, '原Receipt历史读取不增加世界效果');
    report.historyRead = { kind: 'diagnostic-authorized-http-original-receipt', actionId: original.request.clientActionId, original: original.receipt, actual: read, throughSeq: beforeRead.sessionSeq };
    for (const player of report.activePlayers) {
      const page = room.pages[player]; await until(async () => (await snapshot(page)).projection.ending?.endingCode === 'GZ-E03', '剩余在线页得到E03');
      await openReading(page, '回看'); const panel = page.locator('.gaolao-recap'); await panel.waitFor();
      await until(async () => (await panel.innerText()).includes('过程已读完') || await panel.locator('.gaolao-recap-entries li').count() > 0, '真实授权复盘显示');
      let expectedPages = 1;
      for (let index = 0; index < 120 && !(await panel.innerText()).includes('过程已读完'); index++) {
        const before = await panel.locator('.gaolao-recap-entries li').count();
        await panel.getByRole('button', { name: '再看更早的过程', exact: true }).click(); expectedPages++;
        await until(async () => await panel.locator('.gaolao-recap-entries li').count() > before || (await panel.innerText()).includes('过程已读完'), '真实逐页复盘前进');
      }
      assert.match(await panel.innerText(), /过程已读完/);
      await until(() => { const rows = report.recapResponses.filter(row => row.sessionId === room.sessionId && row.player === player && row.status === 200);
        return rows.length === expectedPages && rows.some(row => row.value.nextBeforeSeq === null); }, '本端原HTTP分页全部进入完整原页');
      const rows = report.recapResponses.filter(row => row.sessionId === room.sessionId && row.player === player && row.status === 200);
      assert.ok(rows.every(row => row.value.throughSeq === terminal.sessionSeq && row.value.duplicates === 0));
      (report.recapSummaries ??= []).push({ player, pages: rows.length, entryCount: rows.reduce((sum, row) => sum + row.value.entryCount, 0), throughSeq: terminal.sessionSeq });
    }
    await stage('真实E03、原历史可读与剩余在线端授权复盘'); await picture('complete-e03');
  }

  async function archiveAuthority(validate) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(new Error('完整权威证据导出超过60秒')), 60000);
    const scope = createM29PgScope(database.pool, { signal: controller.signal });
    let transaction = false, client, page = [], pageEstimate = 0;
    const pages = [];
    const flush = async ({ signal = controller.signal } = {}) => {
      if (!page.length) return;
      const rows = page; page = []; pageEstimate = 0;
      const descriptor = { file: 'authority/page-' + String(pages.length + 1).padStart(6, '0') + '.json',
        rows: rows.length, status: 'PENDING' };
      pages.push(descriptor);
      try {
        Object.assign(descriptor, await saveJSON(resolve(output, descriptor.file),
          { schema: 'e03-authority-page-v1', rows }, { signal }), { status: 'COMPLETE' });
      } catch (error) { descriptor.status = 'FAIL'; descriptor.error = error.message; throw error; }
    };
    const write = async value => {
      const estimate = evidenceMemoryEstimate(value);
      if (page.length && pageEstimate + estimate > 4 * 1024 * 1024) await flush();
      page.push(value); pageEstimate += estimate;
      if (page.length >= 32 || pageEstimate >= 4 * 1024 * 1024) await flush();
    };
    const counts = { receipts: 0, intents: 0, events: 0 }, problems = []; let problemCount = 0;
    const humanById = new Map(report.humanActions.map(row => [row.request.clientActionId, { row, matches: 0 }]));
    const controlled = new Set(['tang', 'wukong', 'bajie'].map(key => room.content.chapterRules.people[key]));
    const owner = room.content.chapterRules.people.cuilan;
    let ownerCount = 0, badOwner = 0, badControlled = 0, settlement = false, eventSeq = 0n;
    const check = (label, operation) => {
      try { operation(); } catch (error) { problemCount++; if (problems.length < 100) problems.push({ label, message: error.message }); }
    };
    report.authority = { file: 'authority/manifest.json', status: 'CAPTURING', pages, snapshotStarted: stamp(), mode: 'REPEATABLE READ READ ONLY', fetchRows: 1 };
    try {
      client = await scope.pool.connect();
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); transaction = true;
      await client.query("SET LOCAL statement_timeout='5s'");
      const session = (await client.query('SELECT * FROM sessions WHERE session_id=$1', [room.sessionId])).rows[0];
      assert.ok(session);
      const expected = (await client.query('SELECT '
        + '(SELECT count(*) FROM action_receipts WHERE session_id=$1)::text AS receipts,'
        + '(SELECT count(*) FROM spatial_intents WHERE session_id=$1)::text AS intents,'
        + '(SELECT count(*) FROM world_events WHERE session_id=$1)::text AS events,'
        + '(SELECT count(*) FROM ai_runs WHERE session_id=$1)::text AS ai_runs', [room.sessionId])).rows[0];
      await write({ type: 'header', schema: 'e03-authority-pages-v1', source: report.source, caseId: plan.id,
        sessionId: room.sessionId, snapshotStarted: report.authority.snapshotStarted, expected });
      // 同一 PG 只读快照的完整 session 行含 initial_state/content/state 及实际编码标识，可独立回放。
      await write({ type: 'session', row: session });
      for (const [kind, table, order] of [
        ['receipts', 'action_receipts', 'principal_id,client_action_id'],
        ['intents', 'spatial_intents', 'intent_id'],
        ['events', 'world_events', 'session_seq'],
      ]) {
        const cursor = 'e03_' + kind;
        await client.query('DECLARE ' + cursor + ' NO SCROLL CURSOR FOR SELECT * FROM ' + table + ' WHERE session_id=$1 ORDER BY ' + order, [room.sessionId]);
        for (;;) {
          if (controller.signal.aborted) throw controller.signal.reason;
          const rows = (await client.query('FETCH FORWARD 1 FROM ' + cursor)).rows;
          if (!rows.length) break;
          const row = rows[0]; counts[kind]++;
          await write({ type: kind, ordinal: counts[kind], row });
          if (kind === 'receipts') {
            const expectedHuman = humanById.get(row.client_action_id);
            if (expectedHuman) {
              expectedHuman.matches++;
              check('原玩家 Receipt ' + row.client_action_id, () => assert.deepEqual(row.receipt.publicReceipt, expectedHuman.row.receipt));
            }
          } else if (kind === 'intents') {
            const action = row.request.action;
            if (row.actor_id === owner) {
              ownerCount++; settlement ||= action.operationId === 'gz-confirm-settlement';
              if (row.execution_context.mode !== 'scene-policy' || row.execution_context.scenePolicyBasis?.policyVersion !== 'gaolao-cuilan-v2') badOwner++;
            }
            if (row.execution_context.mode !== 'scene-policy' && !controlled.has(row.actor_id)) badControlled++;
          } else {
            check('事件连续水位 ' + row.session_seq, () => assert.equal(BigInt(row.session_seq), eventSeq + 1n));
            eventSeq = BigInt(row.session_seq);
          }
        }
        await client.query('CLOSE ' + cursor);
        check(kind + ' 全量数目', () => assert.equal(BigInt(counts[kind]), BigInt(expected[kind])));
      }
      check('事件完整达到快照水位', () => assert.equal(eventSeq, BigInt(session.session_seq)));
      await write({ type: 'footer', counts, snapshotThroughSeq: session.session_seq, exportedAt: stamp() });
      await flush();
      await client.query('COMMIT'); transaction = false;
      report.authority = { ...report.authority, status: 'COMPLETE', bytes: pages.reduce((sum, item) => sum + item.bytes, 0),
        counts, expected, snapshotThroughSeq: session.session_seq,
        ending: session.state.ending?.endingCode ?? null, snapshotFinished: stamp(), sceneIntentCount: ownerCount,
        humanActionCount: report.humanActions.length, aiRuns: expected.ai_runs, validation: validate ? 'PENDING' : 'SKIPPED_AFTER_CASE_FAILURE' };
      if (validate) {
        check('生产本人真实回应与本场安置边界', () => { assert.ok(ownerCount > 0); assert.equal(settlement, plan.settled); });
        check('本人意图均生产策略', () => assert.equal(badOwner, 0));
        check('其他受控意图仅三角色', () => assert.equal(badControlled, 0));
        check('无 provider', () => assert.equal(expected.ai_runs, '0'));
        check('玩家 actionId 唯一', () => assert.equal(humanById.size, report.humanActions.length));
        for (const [id, { row, matches }] of humanById) check('实际玩家原请求/原 ACK/PG ' + id, () => {
          assert.equal(matches, 1);
          const sent = requestFrame(id), ack = receiptFrame(id);
          assert.ok(sent && ack); assert.deepEqual(sent.request, row.request); assert.deepEqual(ack.receipt, row.receipt);
          assert.ok(sent.monotonicMs <= ack.monotonicMs);
        });
        check('本场真实E03事实', () => { assert.equal(session.state.phase, 'Finished'); assert.equal(session.state.ending.endingCode, 'GZ-E03'); assert.equal(session.state.chapter.cuilanSafe, plan.settled); });
        report.authority.validation = problemCount ? 'FAIL' : 'PASS_WITHIN_CASE';
      }
      report.authority.problemCount = problemCount; report.authority.problems = problems;
      if (problemCount) throw new Error('权威证据核对失败：' + problems[0].label + '：' + problems[0].message);
    } catch (error) {
      if (report.authority.status !== 'COMPLETE') {
        report.authority.status = 'INCOMPLETE'; report.authority.error = error.message;
        report.authority.unwrittenRows = page.length;
      }
      throw error;
    } finally {
      // BEGIN/SET/FETCH/COMMIT/ROLLBACK 都走同一可取消连接；超时连接已销毁，不能再归还重用。
      if (transaction && client && !client.released) try { await client.query('ROLLBACK'); }
      catch (error) { recordEvidenceError('archive-rollback', error); }
      client?.release(); scope.close(); clearTimeout(timer);
      try { await scope.drain(); }
      catch (error) { recordEvidenceError('archive-connection-drain', error); }
      report.authority.connectionCleanup = scope.state();
      // 已从 PG 观察到的尾行独立封存，不使用已经取消的导出信号再次跳过尾页。
      try { await flush({ signal: null }); }
      catch (error) { recordEvidenceError('authority-tail', error); }
      report.authority.unwrittenRows = pages.filter(item => item.status !== 'COMPLETE').reduce((sum, item) => sum + item.rows, page.length);
      if (report.authority.unwrittenRows || scope.state().active || scope.state().pendingOperations || scope.state().pendingConnectionEnds || scope.state().destroyErrors) report.authority.status = 'INCOMPLETE';
      try { await saveJSON(resolve(output, 'authority/manifest.json'), report.authority); }
      catch (error) { recordEvidenceError('authority-manifest', error); }
    }
  }
  try {
    mainTask = (async () => {
    assert.equal(report.source.status, '', '运行必须是已固定clean候选。');
    assert.equal(report.source.commit, release.expectedCommit);
    assert.equal(report.source.tree, release.expectedTree);
    assert.equal(process.env.VITE_GAOLAO_CONTENT_VERSION, undefined, 'driver自选登记变体；默认样本不得用环境覆写。');
    await saveJSON(resolve(output, 'startup.json'), { ...reportValue(), command: 'node frontend/tests/cuilan-e03-browser.mjs --execute --case ' + plan.id });
    database = await acquire('postgres', () => startTestPostgres('cuilan-e03', { outputSubdirectory: 'cuilan-e03' }), value => value.stop());
    runtimePool = createM29PgScope(database.pool, { signal: mainAbort.signal });
    report.postgresOutput = database.output;
    report.postgresVersion = (await runtimePool.pool.query('SHOW server_version')).rows[0].server_version;
    server = await acquire('server', () => createAuthorityServer({ pool: runtimePool.pool }), value => value.close()); // 不传入模拟 now，不改世界/权利事实。
    const address = await server.listen(0), origin = 'http://127.0.0.1:' + address.port;
    vite = await acquire('vite', () => createVite({ root: resolve(repository, 'frontend'), configFile: resolve(repository, 'frontend/vite.config.mjs'),
      configLoader: 'native', cacheDir: resolve(output, 'vite-cache'),
      ...(!plan.defaultEntry ? { define: { 'import.meta.env.VITE_GAOLAO_CONTENT_VERSION': JSON.stringify(plan.contentVersion) } } : {}),
      server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] }, proxy: { '/api': { target: origin }, '/socket.io': { target: origin, ws: true } } } }), value => value.close());
    if (plan.defaultEntry) assert.equal(vite.config.env.VITE_GAOLAO_CONTENT_VERSION, undefined);
    await vite.listen();
    browser = await acquire('browser', () => chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      args: process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : [] }), value => value.close());
    report.chromiumVersion = browser.version();
    const instrumentedBrowser = { async newContext(options) {
      mainAbort.signal.throwIfAborted();
      const context = await acquire('browser-context', () => browser.newContext(options), value => value.close()), original = context.newPage.bind(context);
      context.newPage = async () => { mainAbort.signal.throwIfAborted(); const page = await original(); mainAbort.signal.throwIfAborted(); return instrument(page); }; return context;
    } };
    const controlledRuntime = new Proxy(server.runtime, { get(target, key) {
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? (...args) => cancellable(() => {
        const task = Promise.resolve().then(() => value.apply(target, args)); controlledTasks.add(task);
        task.finally(() => controlledTasks.delete(task)).catch(() => {}); return task;
      }, { signal: mainAbort.signal, label: '受控角色调用 ' + String(key), cancel: reason => runtimePool.close(reason) }) : value;
    } });
    room = await browserRoom({ server: { ...server, runtime: controlledRuntime }, browser: instrumentedBrowser, baseURL: 'http://127.0.0.1:' + vite.httpServer.address().port,
      count: plan.count, contentVersion: plan.contentVersion, profile: productionProfile, report, observe: listen });
    room.report = report;
    report.room = await assertRoomIdentity(room, runtimePool.pool, { defaultEntry: plan.defaultEntry });
    report.participants = room.users.map((user, player) => ({ player, userId: user.userId, pageId: pageIds.get(room.pages[player]) }));
    assert.ok(report.creationRequests.some(row => row.request.contentVersion === plan.contentVersion && row.request.capabilities.includes('gaolao-personal-consent-v1')));
    sampling = true;
    sampleTask = (async () => { while (sampling) { await sampleConnections('连续观察'); await sleep(1000); } })()
      .catch(error => { sampling = false; abortCapture('sampling', error); });
    assert.equal(room.content.timing.gracePeriodSeconds, 5, '默认生产契约必须保持真实5秒宽限');
    await stage('真实客户端进入默认v3');
    await rescue();
    if (plan.id === 'E03-U3') await unsettledMembership();
    else await singleGrace();
    await terminalAndRecap();
    assert.equal(deadlineExceeded, false); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.externalRequests, []);
    assert.deepEqual(report.evidenceErrors, []);
    mainAbort.signal.throwIfAborted(); report.assessment = 'CHECKS_COMPLETE';
    })();
    await cancellable(() => mainTask, { signal: mainAbort.signal, label: 'E03 主流程', cancel: stopMain });
  } catch (error) {
    report.assessment = !room && /EPERM|EACCES|browserType\.launch|Executable doesn't exist|ECONNREFUSED/.test(String(error.stack)) ? 'ENVIRONMENT_BLOCKED' : 'FAIL';
    report.error = { message: error.message, stack: error.stack, deadlineExceeded }; console.error(error);
    if (room && !mainAbort.signal.aborted) try {
      await cancellable(async () => {
      for (let player = 0; player < room.count; player++) {
        report.failureTail.push({ player, snapshot: await snapshot(room.pages[player]).catch(() => null),
          client: await clientState(room.pages[player]).catch(() => null), text: await room.pages[player].locator('body').innerText().catch(() => '') });
      }
      try { await picture('failure'); } catch {}
      }, { timeoutMs: 5000, label: '失败页面尾段', cancel: stopMain });
    } catch (tailError) { recordEvidenceError('failure-tail', tailError); }
  } finally {
    clearTimeout(deadline); process.removeListener('SIGTERM', signal); process.removeListener('SIGINT', signal);
    if (report.assessment !== 'CHECKS_COMPLETE') stopMain(new Error('E03 主链失败，停止本场在途操作'));
    for (const gate of restorers) try { gate.close(); } catch (error) { recordEvidenceError('release-barrier', error); }
    restorers.clear();
    let mainSettled = false;
    try { await bounded(() => Promise.allSettled([mainTask, ...controlledTasks]), 5000, '取消后主链和受控调用收束'); mainSettled = true; }
    catch (error) { recordEvidenceError('main-task-drain', error); }
    sampling = false;
    // 仅停止 harness 的观察监听；不更改产品、连接或世界，再排空已进入的真实回调。
    let collectionDrained = false, writesSettled = false;
    try { [, report.collectionCutoff] = await bounded(() => Promise.all([sampleTask, collector.stop()]), 16000, '冻结后的真实采集排空'); collectionDrained = mainSettled; }
    catch (error) {
      recordEvidenceError('drain-capture', error); stopMain(error);
      try { [, report.collectionCutoff] = await bounded(() => Promise.all([sampleTask, collector.stop()]), 16000, '关闭本场输入后的采集收束'); collectionDrained = mainSettled; }
      catch (lateError) { recordEvidenceError('drain-capture-after-stop', lateError); }
    }
    captureClosed = true;
    try { appendObservation({ type: 'capture-footer', counts: { ...collectionCounts }, frozenAt: stamp() }, { closing: true }); }
    catch (error) { recordEvidenceError('capture-footer', error); }
    finally { flushCapturePage(); }
    try { await bounded(() => captureWrites, 15000, '完整客户端原页写入排空'); writesSettled = true; }
    catch (error) {
      captureAbort.abort(error); recordEvidenceError('capture-write-drain', error);
      try { await bounded(() => captureWrites, 5000, '取消后原页写入收束'); writesSettled = true; }
      catch (lateError) { recordEvidenceError('capture-write-after-abort', lateError); }
    }
    Object.assign(capture, captureIntegrity(capture, collectionCounts, { pendingRows: pendingPage.length, drained: collectionDrained, writesSettled }));
    capture.pages = capture.pages.map(page => Object.freeze({ ...page }));
    if (capture.status !== 'COMPLETE') recordEvidenceError('capture-close', new Error('原始观察页不完整'));
    try { await saveJSON(resolve(output, 'capture/manifest.json'), { ...capture, source: report.source, caseId: plan.id, counts: collectionCounts }); }
    catch (error) { recordEvidenceError('capture-manifest', error); }
    if (room && database) try { await archiveAuthority(report.assessment === 'CHECKS_COMPLETE'); }
    catch (error) { recordEvidenceError('archive-authority', error); }
    try { await saveJSON(resolve(output, 'result-before-cleanup.json'), reportValue()); }
    catch (error) { recordEvidenceError('save-before-cleanup', error); }
    for (const [name, resource, close] of [['browser', browser, () => browser.close()], ['vite', vite, () => vite.close()],
      ['server', server, () => server.close()], ['postgres', database, () => database.stop()]]) {
      if (!resource) { report.cleanup.push({ name, status: creating.has(name) ? 'CREATION_UNSETTLED' : 'NOT_CREATED' }); continue; }
      try {
        if (name === 'postgres') runtimePool?.close(new Error('主场已收尾，销毁本场剩余 PG 连接'));
        await cancellable(() => closeOnce(name, close), { timeoutMs: 15000, label: '关闭 ' + name,
          cancel: reason => runtimePool?.close(reason) });
        report.cleanup.push({ name, status: 'PASS' });
      }
      catch (error) { report.cleanup.push({ name, status: 'FAIL', error: error.message }); report.assessment = 'FAIL'; }
    }
    if (runtimePool) try { await runtimePool.drain(); }
    catch (error) { recordEvidenceError('runtime-connection-drain', error); }
    report.runtimeConnections = runtimePool?.state() ?? null;
    report.pendingControlledCalls = controlledTasks.size;
    report.pendingResourceCreations = [...creating];
    report.resourcesClosed = report.cleanup.every(row => ['PASS', 'NOT_CREATED'].includes(row.status));
    try { report.sourceEnd = await bounded(sourceIdentity, 15000, '真实 sourceEnd'); }
    catch (error) { recordEvidenceError('source-end', error); }
    report.finishedAt = new Date().toISOString();
    try {
      assert.deepEqual(report.sourceEnd, report.source);
      assert.equal(sha256(await readFile(driverPath)), report.driverSha256);
      assert.equal(sha256(await readFile(documentationPath)), report.documentationSha256);
      assert.equal(report.resourcesClosed, true);
      assert.equal(report.runtimeConnections?.active ?? 0, 0);
      assert.equal(report.runtimeConnections?.pendingOperations ?? 0, 0);
      assert.equal(report.runtimeConnections?.pendingConnectionEnds ?? 0, 0);
      assert.equal(report.runtimeConnections?.destroyErrors ?? 0, 0);
      assert.equal(report.pendingControlledCalls, 0);
      assert.deepEqual(report.pendingResourceCreations, []);
      assert.deepEqual(report.evidenceErrors, []);
      assert.equal(capture.status, 'COMPLETE');
      if (report.assessment === 'CHECKS_COMPLETE') assert.equal(report.authority?.validation, 'PASS_WITHIN_CASE');
      if (report.assessment === 'CHECKS_COMPLETE') report.assessment = 'PASS_WITHIN_CASE';
    } catch (error) { report.assessment = 'FAIL'; report.finalAuditError = error.stack; }
    try { await saveJSON(resolve(output, 'result.json'), reportValue()); }
    catch (error) {
      recordEvidenceError('save-final', error);
      // 最终大文件失败也保留明确失败的小回执；该回执绝不替代缺失原始数据。
      try { await saveJSON(resolve(output, 'result-write-error.json'), { assessment: 'FAIL', caseId: plan.id,
        error: error.message, cleanup: report.cleanup, sourceEnd: report.sourceEnd, finishedAt: report.finishedAt }); }
      catch (lastError) { console.error('E03 最终证据回执仍无法保存：', lastError.message); }
    }
    console.log(JSON.stringify({ assessment: report.assessment, case: plan.id, output }));
    if (report.assessment !== 'PASS_WITHIN_CASE') process.exitCode = 1;
  }
}
