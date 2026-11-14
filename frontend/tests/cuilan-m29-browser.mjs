// CS-T04/M29：仅在 V2 实际释放后执行；准备提交不代表产品运行。
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { cases, chooseCase, executionInputs, workId, minimumLongMs, maximumLongRounds, activityAssessment } from './cuilan-m29-plan.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const selection = chooseCase(process.argv.slice(2));
  if (!selection) console.log(JSON.stringify({ workId, status: 'PLANNED_NOT_RUN', cases }, null, 2));
  else await execute(selection, executionInputs(process.env));
}

/** 保守估计用于索引/待写页预算，绝不作为原始字节摘要或 JSON 编码器。 */
export function evidenceMemoryEstimate(value) {
  if (value === null || value === undefined) return 8;
  if (typeof value === 'string') return 32 + Buffer.byteLength(value) * 6;
  if (typeof value !== 'object') return 24;
  if (value instanceof Date) return 64;
  let size = 128;
  if (Array.isArray(value)) for (const child of value) size += 16 + evidenceMemoryEstimate(child);
  else for (const key of Object.keys(value)) size += 64 + Buffer.byteLength(key) * 6 + evidenceMemoryEstimate(value[key]);
  return size;
}
async function bounded(task, milliseconds, label) {
  let timer;
  try { return await Promise.race([task(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + '超过' + milliseconds + 'ms')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

/** 截止必须调用资源自己的取消入口；晚到值只能交回清理，不能继续主链。 */
export function cancellable(task, { signal, timeoutMs, label = '操作', cancel = () => {}, late = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    let finished = false, timer;
    const clear = () => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); };
    const stop = reason => {
      if (finished) return;
      finished = true; clear();
      try { cancel(reason); } catch (error) { reason = new AggregateError([reason, error], label + '取消时也发生错误'); }
      reject(reason);
    };
    const aborted = () => stop(signal.reason ?? new Error(label + '已取消'));
    if (signal?.aborted) { aborted(); return; }
    signal?.addEventListener('abort', aborted, { once: true });
    if (timeoutMs !== undefined) timer = setTimeout(() => stop(new Error(label + '超过' + timeoutMs + 'ms')), timeoutMs);
    Promise.resolve().then(() => { signal?.throwIfAborted(); return task(); }).then(value => {
      if (finished) { Promise.resolve().then(() => late(value)).catch(() => {}); return; }
      finished = true; clear(); resolve(value);
    }, error => { if (!finished) { finished = true; clear(); reject(error); } });
  });
}

/** 只管理调用者交给本场的 Pool；所有借出的连接均可通过公开 release(true) 销毁。 */
export function createM29PgScope(pool, { signal, timeoutMs = 5000 } = {}) {
  const controller = new AbortController(), current = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const leases = new Set(), pending = new Set(), closing = new Set();
  const counts = { acquired: 0, released: 0, destroyed: 0, lateDestroyed: 0, ended: 0, destroyErrors: 0 };
  const track = promise => { pending.add(promise); promise.finally(() => pending.delete(promise)).catch(() => {}); return promise; };
  const ending = raw => new Promise(resolve => raw.once('end', () => { counts.ended++; resolve(); }));
  const destroy = (raw, ended) => {
    closing.add(ended); ended.finally(() => closing.delete(ended)).catch(() => {});
    try { raw.release(true); } catch (error) { counts.destroyErrors++; throw error; }
  };
  async function connect() {
    current.throwIfAborted();
    const raw = await cancellable(() => track(Promise.resolve().then(() => pool.connect())), {
      signal: current, timeoutMs, label: '取得本场 PG 连接',
      late: client => { counts.lateDestroyed++; destroy(client, ending(client)); },
    });
    let released = false;
    const release = (destroy = false) => {
      if (released) return;
      released = true; leases.delete(release); counts.released++;
      if (destroy) counts.destroyed++;
      if (destroy) {
        const ended = ending(raw);
        closing.add(ended); ended.finally(() => closing.delete(ended)).catch(() => {});
      }
      try { raw.release(destroy); } catch (error) { counts.destroyErrors++; throw error; }
    };
    counts.acquired++; leases.add(release);
    if (current.aborted) { release(true); throw current.reason; }
    return {
      async query(...args) {
        current.throwIfAborted();
        assert.equal(released, false, '已释放的本场 PG 连接不能再次查询');
        return cancellable(() => track(Promise.resolve().then(() => raw.query(...args))), {
          signal: current, timeoutMs, label: '本场 PG 查询', cancel: () => release(true),
        });
      },
      release,
      get released() { return released; },
    };
  }
  const close = reason => {
    if (!controller.signal.aborted) controller.abort(reason ?? new Error('本场 PG 作用域已关闭'));
    for (const release of [...leases]) { try { release(true); } catch {} }
  };
  current.addEventListener('abort', () => { for (const release of [...leases]) { try { release(true); } catch {} } }, { once: true });
  return {
    pool: { connect, async query(...args) { const client = await connect(); try { return await client.query(...args); } finally { client.release(); } } },
    close,
    drain: () => bounded(async () => { while (pending.size || closing.size) await Promise.allSettled([...pending, ...closing]); }, timeoutMs, '本场 PG 在途查询与真实连接关闭'),
    state: () => ({ ...counts, active: leases.size, pendingOperations: pending.size, pendingConnectionEnds: closing.size, closed: current.aborted }),
  };
}

/** 完整性必须由实写行、全局/类别序和停止状态一起证明，空页集合不能证明完整。 */
export function captureIntegrity(capture, counts, { pendingRows, drained, writesSettled }) {
  const writtenCounts = {}, declaredCounts = {}; let next = 1, writtenRows = 0, contiguous = true;
  for (const page of capture.pages) {
    contiguous &&= page.firstOrdinal === next && page.lastOrdinal === next + page.rows - 1;
    next += page.rows;
    for (const [kind, count] of Object.entries(page.counts)) declaredCounts[kind] = (declaredCounts[kind] ?? 0) + count;
    if (page.status === 'COMPLETE') {
      writtenRows += page.rows;
      for (const [kind, count] of Object.entries(page.counts)) writtenCounts[kind] = (writtenCounts[kind] ?? 0) + count;
    }
  }
  const same = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].every(key => (a[key] ?? 0) === (b[key] ?? 0));
  const categoryCountsMatch = same(capture.observedCounts, declaredCounts) && same(capture.observedCounts, writtenCounts)
    && Object.entries(counts).every(([key, value]) => (writtenCounts[key] ?? 0) === value);
  const complete = drained && writesSettled && capture.pages.length > 0 && pendingRows === 0 && contiguous
    && next - 1 === capture.rows && writtenRows === capture.rows && categoryCountsMatch
    && capture.pages.every(page => page.status === 'COMPLETE' && Number.isSafeInteger(page.bytes) && /^[a-f0-9]{64}$/.test(page.sha256));
  return { status: complete ? 'COMPLETE' : 'INCOMPLETE', observedRows: capture.rows, writtenRows,
    unwrittenRows: capture.rows - writtenRows, pendingRows, contiguous, categoryCountsMatch, writtenCounts, drained, writesSettled };
}

async function execute(plan, release) {
  const [{ createServer: createVite }, { chromium }, { startTestPostgres }, { createAuthorityServer },
    legacy, network, ui, personal] = await Promise.all([
    import('vite'), import('playwright'), import('../../backend/test-support/postgres.mjs'), import('../../backend/server.mjs'),
    import('../../backend/test-support/gaolao-room.mjs'), import('./network-support.mjs'), import('./gaolao-real-support.mjs'),
    import('./cuilan-self-response-support.mjs'),
  ]);
  const { accepted, take, share, cleanupPublic, gatherSources, investigate, endTogether } = legacy;
  const { repository, sourceIdentity, sha256, until, sleep } = network;
  const { browserRoom, snapshot, clientState, openReading } = ui;
  const { productionProfile, askAppearance, describeItems, askItems, personalState, cancelPersonal, returnItem,
    holdSubmissions, authoritativeState, sceneDecision, assertRoomIdentity, saveCuilanReportJSON, createCuilanReportCollector } = personal;
  assert.equal(typeof saveCuilanReportJSON, 'function', '运行候选必须包含已独审释放的共享完整报告 writer；准备分支不可自行绕过依赖。');
  assert.equal(typeof createCuilanReportCollector, 'function');
  const saveJSON = async (file, value, { signal, timeoutMs = 15000 } = {}) => {
    const controller = new AbortController(), combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    try { return await bounded(() => saveCuilanReportJSON(file, value, { signal: combined }), timeoutMs, '保存 ' + file); }
    catch (error) { controller.abort(error); throw error; }
  };
  const output = resolve(process.env.FRONTEND_EVIDENCE_DIR || resolve(repository, '.agent-output/cuilan-m29', plan.id));
  await mkdir(output, { recursive: true });
  // 与 stdout 预建目录兼容；任何已存在的捕获目录都拒绝覆盖。
  await mkdir(resolve(output, 'capture')); await mkdir(resolve(output, 'authority'));
  const report = {
    workId, executionKind: 'production-browser-m29', assessment: 'RUNNING', case: plan, release,
    startedAt: new Date().toISOString(), source: await sourceIdentity(), nodeVersion: process.version,
    scope: '固定人数/分支的正常Vue与HTTP/Socket/真实PG；生产翠兰、三受控NPC；不计真人/provider/艺术或部署。',
    humanActions: [], npcActions: [], recapResponses: [], pageErrors: [], externalRequests: [], creationRequests: [],
    requestFrames: [], receiptFrames: [], socketLifetimes: [], connectionSamples: [], stages: [], cycles: [],
    screenshots: [], failureTail: [], cleanup: [], evidenceErrors: [], competition: null, recovery: null, longWindow: null, realProviderCalls: 0,
    notCovered: ['真人四局及贡献指标', '真实provider', '真机与正式艺术', '未登记人数/变体/条款/故障组合', 'E03两类完整新矩阵', '部署'],
  };
  const driverPath = resolve(repository, 'frontend/tests/cuilan-m29-browser.mjs');
  const planPath = resolve(repository, 'frontend/tests/cuilan-m29-plan.mjs');
  const draftPath = resolve(repository, 'frontend/tests/cuilan-m29.workflow.yml.example');
  report.driverSha256 = sha256(await readFile(driverPath));
  report.planSha256 = sha256(await readFile(planPath));
  report.workflowDraftSha256 = sha256(await readFile(draftPath));
  // 实际注册后的 workflow 另取摘要；草案与实际流水线不可混称。
  if (process.env.GITHUB_WORKFLOW_REF) {
    const workflowPath = process.env.GITHUB_WORKFLOW_REF.split('@')[0].split('/').slice(2).join('/');
    assert.ok(workflowPath.startsWith('.github/workflows/') && !workflowPath.includes('..'));
    report.actualWorkflow = { ref: process.env.GITHUB_WORKFLOW_REF, sha256: sha256(await readFile(resolve(repository, workflowPath))) };
  }
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
        .then(() => { creating.delete(name); console.error('M29 迟到资源已关闭：', name); }, error => console.error('M29 迟到资源未能关闭：', name, error.message)) });
    creating.delete(name); return resource;
  };
  const pageIds = new WeakMap(), restorers = new Set();
  const stamp = () => ({ at: new Date().toISOString(), monotonicMs: performance.now() });
  const collectionKeys = ['humanActions', 'npcActions', 'recapResponses', 'pageErrors', 'externalRequests', 'creationRequests',
    'requestFrames', 'receiptFrames', 'socketLifetimes', 'connectionSamples', 'stages', 'cycles', 'screenshots', 'failureTail'];
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
    console.error('M29 证据失败：', stage, error.message);
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
      try { Object.assign(page, await saveJSON(resolve(output, page.file), { schema: 'm29-client-page-v1', rows }, { signal: captureAbort.signal }), { status: 'COMPLETE' }); }
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
  const budgetMs = (plan.long ? 25 : 12) * 60000;
  const deadline = setTimeout(() => { deadlineExceeded = true; stopMain(new Error('M29 主流程达到已登记截止时间')); }, budgetMs);
  deadline.unref();
  const signal = () => { deadlineExceeded = true; stopMain(new Error('M29 收到进程终止信号')); };
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
            report.requestFrames.push({ pageId, socketId, request: JSON.parse(raw), raw, ...stamp() });
        } catch (error) { report.pageErrors.push({ pageId, message: '实际发送帧无法解析：' + error.message }); }
      });
      listen(socket, 'framereceived', frame => {
        const text = String(frame.payload); if (!/^43\d*\[/.test(text)) return;
        try {
          const [receipt] = JSON.parse(text.replace(/^43\d*/, ''));
          if (receipt?.schemaVersion === 2 && receipt.clientActionId && ['Accepted', 'Rejected'].includes(receipt.status))
            report.receiptFrames.push({ pageId, socketId, receipt, ...stamp() });
        } catch (error) { report.pageErrors.push({ pageId, message: '实际ACK帧无法解析：' + error.message }); }
      });
    });
    return page;
  }
  async function sampleConnections(label) {
    const participants = await Promise.all(room.pages.map(async (page, player) => {
      try {
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
      cuilanSafe: current.chapter.cuilanSafe, ending: current.ending, ...detail };
    report.stages.push(row); console.log(JSON.stringify(row)); return row;
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
  async function rescue() {
    const carer = room.role('B'), craft = room.role('C');
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
    await sceneDecision(runtimePool.pool, room, follow.consentId, 'accept');
    const path = plan.destinationId === 'front-guest-room'
      ? [room.C('C01'), room.C('C13'), room.C('C11'), room.C('C12')]
      : [room.C('C01'), room.C('C20'), room.R('R02'), room.R('R06'), room.R('R04'), room.R('R05')];
    for (const destination of path) await room.go(carer, destination);
    await until(async () => (await state()).chapter.cuilanSafe === true, '实际随行抵达并由生产本人确认', 40000);
    await cleanupPublic(room);
    await stage('生产本人救援与安置', { followConsentId: follow.consentId, destinationId: plan.destinationId });
    await picture('settled', carer);
  }
  async function beginPrivate(player, name, itemId) {
    await nearOwner(player); await describeItems(room, player);
    const ask = await askItems(room, player, [name], 'single_use'); accepted(ask.receipt);
    const granted = await decision(player, 'private_items', 'accepted'); await assertBoundProposal(granted, ask);
    await room.go(player, room.C('C07')); const receipt = accepted(await take(room, player, name));
    const current = await state();
    const acquisition = Object.values(current.chapter.privateAcquisitions).find(row => row.takeActionId === receipt.clientActionId && row.itemId === itemId);
    assert.ok(acquisition && acquisition.outcome === 'held');
    assert.equal(acquisition.originalConsentId, granted.consent.consentId);
    return { player, name, itemId, consentId: granted.consent.consentId, acquisitionId: acquisition.acquisitionId,
      proposalActionId: ask.request.clientActionId, takeActionId: receipt.clientActionId, startedAt: stamp() };
  }
  async function finishPrivate(record, destination) {
    if (destination === 'owner') await nearOwner(record.player);
    else await room.go(record.player, room.C('C07'));
    const returned = await returnItem(room, record.player, record.name, destination);
    const current = await state(), acquisition = current.chapter.privateAcquisitions[record.acquisitionId];
    assert.equal(acquisition.outcome, destination === 'owner' ? 'delivered_to_owner' : 'restored_origin');
    assert.equal(acquisition.resolvedByActionId, returned.request.clientActionId);
    const request = current.chapter.personalRequests[record.consentId];
    if (request.lifecycle === 'open') {
      await until(async () => (await snapshot(room.pages[record.player])).projection.chapter.personalRequests.some(row => row.consentId === record.consentId && row.lifecycleVersion === request.lifecycleVersion), '返还后的本人请求投影到达');
      await cancelPersonal(room, record.player, 'private_items');
    }
    assert.equal((await state()).chapter.privateAcquisitions[record.acquisitionId].outcome, acquisition.outcome);
    return { ...record, outcome: acquisition.outcome, returnActionId: returned.request.clientActionId,
      lastActionId: report.humanActions.at(-1).request.clientActionId, finishedAt: stamp() };
  }
  async function competition(held) {
    const a = room.role('B'), b = a === 0 ? 1 : 0;
    for (const player of [a, b]) await nearOwner(player);
    const before = await state(), privateBefore = before.chapter.personalRequests[held.consentId];
    const grantBefore = before.chapter.privateAcquisitions[held.acquisitionId];
    const gate = holdSubmissions(server.runtime, request => request.sessionId === room.sessionId && request.action.operationId === 'gz-request-appearance', 2);
    restorers.add(gate);
    let timedOut = false, timer, pending;
    const expired = new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; gate.release(); reject(new Error('两真实请求屏障在15秒内未齐，原样失败并释放。')); }, 15000); });
    try {
      pending = Promise.allSettled([a, b].map(player => askAppearance(room, player, 'rear-meeting', 'single_use')));
      await Promise.race([gate.ready, expired]); clearTimeout(timer);
      assert.equal(gate.held.length, 2); assert.equal(gate.held[0].request.action.expectedTargetRevision, gate.held[1].request.action.expectedTargetRevision);
      const heldAt = stamp(); gate.release(); const releasedAt = stamp();
      const settled = await pending;
      for (const row of settled) if (row.status === 'rejected') throw row.reason;
      const results = settled.map(row => row.value);
      assert.deepEqual(results.map(row => row.receipt.status).sort(), ['Accepted', 'Rejected']);
      const winnerIndex = results.findIndex(row => row.receipt.status === 'Accepted'), winner = [a, b][winnerIndex];
      const granted = await decision(winner, 'appearance', 'accepted'); await assertBoundProposal(granted, results[winnerIndex]);
      await cancelPersonal(room, winner, 'appearance');
      const after = await state();
      assert.deepEqual(after.chapter.personalRequests[held.consentId], privateBefore, '另一私物用途不被竞争/取消改变。');
      assert.deepEqual(after.chapter.privateAcquisitions[held.acquisitionId], grantBefore, '真实持物原取得保持。');
      report.competition = { profile: 'bounded-two-real-ui-pre-submit-barrier', players: [a, b], heldAt, releasedAt,
        requests: gate.held.map(row => row.request), results, winner, consentId: granted.consent.consentId,
        privateConsentId: held.consentId, acquisitionId: held.acquisitionId, timedOut };
      await stage('多人真实请求竞争和另一用途保持');
    } finally {
      clearTimeout(timer); gate.close(); restorers.delete(gate); if (pending) await pending;
    }
  }
  async function recoverDuringLong(held) {
    // 五人场景仅一人失联不会暂停；四个正常页面刷新令 activeCount < 2，再逐人正常恢复。
    const old = await Promise.all(room.pages.map(page => snapshot(page)));
    const started = stamp(), reloaded = [1, 2, 3, 4];
    await Promise.all(reloaded.map(player => room.pages[player].reload()));
    await until(async () => (await state()).paused, '四页刷新后权威实际暂停', 20000);
    const paused = await state(); await sampleConnections('实际暂停');
    const stopped = paused.chapter.personalRequests[held.consentId];
    assert.ok(!['ready', 'active'].includes(stopped.execution.state), '被刷新持有人原许可先停止执行');
    for (const player of reloaded) {
      await until(async () => (await clientState(room.pages[player])).connection === 'online', '原账号真实网络恢复', 20000);
      const resume = room.pages[player].getByRole('button', { name: '恢复本人控制', exact: true });
      await resume.waitFor(); await resume.click();
      await until(async () => (await clientState(room.pages[player])).inputReady, '原账号正常恢复本人控制', 20000);
    }
    await until(async () => !(await state()).paused, '实际恢复继续运行');
    const proof = await sceneDecision(runtimePool.pool, room, held.consentId, 'withdrawn');
    const current = await state(); assert.equal(current.chapter.privateAcquisitions[held.acquisitionId].outcome, 'held');
    report.recovery = { profile: 'four-normal-page-reloads-in-five-player-room', started, finished: stamp(), reloaded,
      oldViews: old.map(row => row.viewId), newViews: await Promise.all(room.pages.map(async page => (await snapshot(page)).viewId)),
      pausedSeq: paused.sessionSeq, resumedSeq: current.sessionSeq, consentId: held.consentId, acquisitionId: held.acquisitionId,
      stoppedExecution: stopped.execution.state, productionWithdrawal: proof };
    for (const player of reloaded) assert.notEqual(report.recovery.oldViews[player], report.recovery.newViews[player]);
    await stage('五人场次的真实暂停和正常页面恢复'); await sampleConnections('五端恢复');
  }
  async function longOperations() {
    const boundary = await sampleConnections('900秒窗前五端已恢复');
    for (const participant of boundary.participants) {
      assert.equal(participant.connection, 'online'); assert.equal(participant.inputReady, true);
      assert.equal(participant.canControl, true); assert.equal(participant.paused, false);
    }
    const firstRequestIndex = report.requestFrames.length;
    let startActionId, endActionId, reached = false;
    for (let round = 0; round < maximumLongRounds; round++) {
      assert.equal(deadlineExceeded, false);
      const player = round % 5;
      const held = await beginPrivate(player, '私人包裹', 'gz-parcel');
      if (!startActionId) startActionId = report.requestFrames[firstRequestIndex]?.request.clientActionId;
      assert.ok(startActionId);
      const complete = await finishPrivate(held, 'origin');
      report.cycles.push({ round: round + 1, ...complete }); endActionId = complete.lastActionId;
      const start = requestFrame(startActionId), end = await until(() => receiptFrame(endActionId), '本轮最后真实ACK已记录');
      await sampleConnections('合法取还轮次' + (round + 1));
      if (end.monotonicMs - start.monotonicMs >= minimumLongMs && report.recovery) { reached = true; break; }
    }
    assert.ok(reached, '合法有因果轮次预算耗尽仍不足900秒，失败；绝不加空等/无目的点击补时长。');
    assert.equal(new Set(report.cycles.map(row => row.acquisitionId)).size, report.cycles.length, '每轮确实新取得，不重计原收据。');
    assert.equal(new Set(report.cycles.map(row => row.consentId)).size, report.cycles.length, '每轮确实正常新许可。');
    report.longWindow = activityAssessment({ requestFrames: report.requestFrames, receiptFrames: report.receiptFrames,
      actions: report.humanActions, startActionId, endActionId, count: 5 });
    const samples = report.connectionSamples.filter(row => row.monotonicMs >= report.longWindow.startMonotonicMs && row.monotonicMs <= report.longWindow.endMonotonicMs);
    assert.ok(samples.length >= 450, '一秒级五端观察序列不可缺失大半。');
    for (const sample of samples) {
      assert.equal(new Set(sample.participants.map(row => row.userId)).size, 5);
      for (const participant of sample.participants) {
        const original = boundary.participants.find(row => row.player === participant.player);
        assert.equal(participant.readingError, undefined, '900秒窗内不能丢失某端观察。');
        assert.equal(participant.connection, 'online', '900秒窗内五个实际客户端均在线。');
        assert.equal(participant.canControl, true, '900秒窗内五端保持当前权威控制。');
        assert.equal(participant.paused, false, '900秒窗内场景实际继续。');
        assert.equal(participant.viewId, original.viewId); assert.equal(participant.controlEpoch, original.controlEpoch);
      }
    }
    for (let index = 1; index < samples.length; index++) assert.ok(samples[index].monotonicMs - samples[index - 1].monotonicMs <= 15000, '连续观察不能有超过15秒的未解释空洞。');
    for (const participant of boundary.participants) {
      const active = new Set();
      for (const event of report.socketLifetimes.filter(row => row.pageId === participant.pageId && row.monotonicMs <= report.longWindow.startMonotonicMs)) {
        if (event.event === 'open') active.add(event.socketId); else active.delete(event.socketId);
      }
      assert.equal(active.size, 1, '起点每端恰有一条真实Socket。');
      assert.equal(report.socketLifetimes.filter(row => row.pageId === participant.pageId && row.monotonicMs > report.longWindow.startMonotonicMs && row.monotonicMs <= report.longWindow.endMonotonicMs).length, 0, '连续计数窗内任何断开或重连均失败，不拼接。');
    }
    assert.ok(report.longWindow.startMonotonicMs > report.recoveryReturn.finishedAt.monotonicMs, '暂停恢复与原物收束必须完全在900秒窗外。');
    report.longWindow.connectionSamples = samples.length;
    report.longWindow.boundary = boundary;
    report.longWindow.recoveryOutsideWindow = true;
    report.longWindow.scope = '恢复并处理原持物后重新起算；五条Socket、view和控制epoch在同一实际请求/回执区间持续，未拼接暂停前后。';
    await stage('五客户端连续有效操作达到900秒', { durationMs: report.longWindow.durationMs, actualRounds: report.cycles.length });
  }
  async function disguiseRoute() {
    const player = room.role('B'); await nearOwner(player);
    const ask = await askAppearance(room, player, 'rear-meeting', 'single_use'); accepted(ask.receipt);
    const granted = await decision(player, 'appearance', 'accepted'); await assertBoundProposal(granted, ask);
    const destination = room.content.chapterRules.meetingDestinations.find(row => row.destinationId === 'rear-meeting');
    await room.go('wukong', destination); await room.go(player, destination);
    const used = accepted(await room.interact('wukong', 'self', 'gz-apply-appearance', { consentId: granted.consent.consentId, expectedConsentVersion: granted.consent.version }));
    await until(async () => Boolean((await state()).chapter.disguise), '授权借貌实际生效');
    await room.go('bajie', destination);
    accepted(await room.send('wukong', { kind: 'speak', text: '请说说你在这里等候谁。', channel: 'public', recipientRefs: [] }));
    accepted(await room.interact('wukong', 'self', 'gz-release-appearance'));
    await until(async () => (await state()).chapter.disguise === null, '真实借貌使用后正常解除');
    report.disguise = { consentId: granted.consent.consentId, applyActionId: used.clientActionId, destinationId: destination.destinationId };
    await stage('乔装路线实际使用与正常解除', report.disguise);
  }
  async function separation() {
    await gatherSources(room); await room.go(0, room.C('C19'));
    for (const key of ['tang', 'wukong', 'bajie']) await room.go(key, room.C('C19'));
    const old = (await snapshot(room.pages[0])).projection.chapter.endProposal;
    const receipt = accepted(await room.send(0, { kind: 'request_end', proposalId: crypto.randomUUID(), proposalVersion: old?.proposalVersion ?? '0', scope: 'recruitment' }));
    const actual = report.humanActions.find(row => row.request.clientActionId === receipt.clientActionId).request.action;
    assert.equal(actual.scope, 'recruitment');
    for (let player = 1; player < room.count; player++) {
      const proposal = await until(async () => {
        const p = (await snapshot(room.pages[player])).projection.chapter.endProposal;
        return p?.proposalId === actual.proposalId && p.status === 'pending' ? p : false;
      }, '每端实际收到同一轮结束招徒提议');
      accepted(await room.send(player, { kind: 'confirm_end', proposalId: proposal.proposalId, proposalVersion: proposal.proposalVersion }));
    }
    accepted(await room.interact(0, '庄口会面点', 'gz-plan-departure'));
    for (const key of ['tang', 'wukong']) await room.go(key, room.content.chapterRules.departure);
    await room.go('bajie', room.content.chapterRules.waiting[0]);
    accepted(await room.interact('tang', 'self', 'gz-finish-separation'));
  }
  async function endingAndRecap() {
    if (plan.ending === 'GZ-E01') { await investigate(room); await endTogether(room); }
    else await separation();
    const final = await state();
    assert.equal(final.phase, 'Finished'); assert.equal(final.ending.endingCode, plan.ending); assert.equal(final.chapter.cuilanSafe, true);
    assert.equal(Object.values(final.chapter.privateAcquisitions).filter(row => row.outcome === 'held').length, 0);
    for (let player = 0; player < room.count; player++) {
      const page = room.pages[player];
      await until(async () => (await snapshot(page))?.projection.ending?.endingCode === plan.ending, '每端得到真实完整章终点');
      await openReading(page, '回看'); const panel = page.locator('.gaolao-recap'); await panel.waitFor();
      await until(async () => (await panel.innerText()).includes('过程已读完') || await panel.locator('.gaolao-recap-entries li').count() > 0, '实际授权HTTP复盘呈现');
      let expectedPages = 1;
      for (let index = 0; index < 120 && !(await panel.innerText()).includes('过程已读完'); index++) {
        const before = await panel.locator('.gaolao-recap-entries li').count();
        await panel.getByRole('button', { name: '再看更早的过程', exact: true }).click(); expectedPages++;
        await until(async () => await panel.locator('.gaolao-recap-entries li').count() > before || (await panel.innerText()).includes('过程已读完'), '真实逐页复盘前进');
      }
      assert.match(await panel.innerText(), /过程已读完/);
      await until(() => {
        const rows = report.recapResponses.filter(row => row.sessionId === room.sessionId && row.player === player && row.status === 200);
        return rows.length === expectedPages && rows.some(row => row.value.nextBeforeSeq === null);
      }, '本端原始HTTP分页回调全部进入已登记原页');
      const responses = report.recapResponses.filter(row => row.sessionId === room.sessionId && row.player === player && row.status === 200);
      assert.ok(responses.length); assert.ok(responses.every(row => row.value.throughSeq === final.sessionSeq));
      assert.ok(responses.every(row => row.value.duplicates === 0), '每端授权分页无重复');
      (report.recapSummaries ??= []).push({ player, pages: responses.length,
        entryCount: responses.reduce((sum, row) => sum + row.value.entryCount, 0), throughSeq: final.sessionSeq });
      const seenKey = room.sessionId + ':' + player;
      recapIndexBytes -= recapSeen.get(seenKey)?.bytes ?? 0; recapSeen.delete(seenKey);
    }
    await stage('实际完整章终点与各端授权复盘', { ending: plan.ending }); await picture('complete-ending');
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
          { schema: 'm29-authority-page-v1', rows }, { signal }), { status: 'COMPLETE' });
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
    let ownerCount = 0, badOwner = 0, badControlled = 0, settlement = false, apply = false, exactApply = false, eventSeq = 0n;
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
      await write({ type: 'header', schema: 'm29-authority-pages-v1', source: report.source, caseId: plan.id,
        sessionId: room.sessionId, snapshotStarted: report.authority.snapshotStarted, expected });
      // 同一 PG 只读快照的完整 session 行含 initial_state/content/state 及实际编码标识，可独立回放。
      await write({ type: 'session', row: session });
      for (const [kind, table, order] of [
        ['receipts', 'action_receipts', 'principal_id,client_action_id'],
        ['intents', 'spatial_intents', 'intent_id'],
        ['events', 'world_events', 'session_seq'],
      ]) {
        const cursor = 'm29_' + kind;
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
            apply ||= action.operationId === 'gz-apply-appearance';
            exactApply ||= row.request.clientActionId === report.disguise?.applyActionId;
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
        check('生产本人实际安置', () => assert.ok(settlement && ownerCount > 0));
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
        check('实际公开/乔装路线', () => { if (plan.route === 'public') assert.equal(apply, false); else assert.ok(exactApply); });
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
    assert.equal(report.source.tree, release.expectedTree);
    assert.equal(process.env.VITE_GAOLAO_CONTENT_VERSION, undefined, 'driver自选登记变体；默认样本不得用环境覆写。');
    await saveJSON(resolve(output, 'startup.json'), { ...reportValue(), command: 'node frontend/tests/cuilan-m29-browser.mjs --execute --case ' + plan.id });
    database = await acquire('postgres', () => startTestPostgres('cuilan-m29', { outputSubdirectory: 'cuilan-m29' }), value => value.stop());
    runtimePool = createM29PgScope(database.pool, { signal: mainAbort.signal });
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
    await rescue();
    const held = await beginPrivate(room.role('B'), '私人信件', 'gz-letter');
    if (plan.competition) await competition(held);
    report.initialPrivateDelivery = await finishPrivate(held, 'owner');
    await stage('新许可下的真实取得和交回', report.initialPrivateDelivery);
    if (plan.long) {
      const recoveryHeld = await beginPrivate(4, '私人包裹', 'gz-parcel');
      await recoverDuringLong(recoveryHeld);
      report.recoveryReturn = await finishPrivate(recoveryHeld, 'origin');
      await longOperations();
    }
    if (plan.route === 'disguise') await disguiseRoute();
    await endingAndRecap();
    assert.equal(deadlineExceeded, false); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.externalRequests, []);
    assert.deepEqual(report.evidenceErrors, []);
    mainAbort.signal.throwIfAborted(); report.assessment = 'CHECKS_COMPLETE';
    })();
    await cancellable(() => mainTask, { signal: mainAbort.signal, label: 'M29 主流程', cancel: stopMain });
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
    if (report.assessment !== 'CHECKS_COMPLETE') stopMain(new Error('M29 主链失败，停止本场在途操作'));
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
      assert.equal(sha256(await readFile(planPath)), report.planSha256);
      assert.equal(sha256(await readFile(draftPath)), report.workflowDraftSha256);
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
      catch (lastError) { console.error('M29 最终证据回执仍无法保存：', lastError.message); }
    }
    console.log(JSON.stringify({ assessment: report.assessment, case: plan.id, longWindowMs: report.longWindow?.durationMs ?? null, output }));
    if (report.assessment !== 'PASS_WITHIN_CASE') process.exitCode = 1;
  }
}
