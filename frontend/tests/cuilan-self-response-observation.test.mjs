// CRO：受控观察器/原 collector/finalizer 检查，不启动页面、PG或生产场景。
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createCuilanReportCollector, finalizeCuilanReport, assertCompleteReport } from './cuilan-self-response-support.mjs';
import { createCuilanResponseObservation, cuilanResponseObservationLimits as limits } from './cuilan-self-response-observation.mjs';

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function pageFixture(path = '/room') {
  const page = new EventEmitter(), frame = { url: () => 'http://localhost' + path + '?secret=not-retained' };
  page.mainFrame = () => frame; page.frame = frame; return page;
}
function requestFixture({ path = '/api/actions/same', method = 'GET', failure = 'net::ERR_ABORTED' } = {}) {
  return { url: () => 'http://localhost' + path + '?token=not-retained', method: () => method, failure: () => ({ errorText: failure }) };
}
function responseFixture(request = requestFixture(), { ok = true, status = ok ? 200 : 404, receipt = { actual: 'receipt' }, body } = {}) {
  const calls = { url: 0, ok: 0, status: 0, request: 0, json: 0 };
  const response = {
    calls, url() { calls.url++; return request.url(); }, ok() { calls.ok++; return ok; },
    status() { calls.status++; return status; }, request() { calls.request++; return request; },
    json() { assert.equal(this, response); calls.json++; return body ? body() : receipt; },
  };
  return response;
}
function fixture({ snapshot = () => ({ viewId: 'view-current' }), drainTimeoutMs = 15000 } = {}) {
  const report = { assessment: 'CHECKS_COMPLETE', executionKind: 'observation_unit', source: { status: '' }, realProviderCalls: 0, pageErrors: [], httpReceipts: [], cleanup: [] };
  const collectorErrors = [], collector = createCuilanReportCollector(error => {
    collectorErrors.push(error); report.pageErrors.push({ message: '证据采集失败：' + error.message });
  }, { drainTimeoutMs });
  let current = 'P-01';
  const observer = createCuilanResponseObservation({ collector, report, currentCase: () => current, readSnapshot: snapshot });
  report.responseObservation = observer.data;
  const context = new EventEmitter(), page = pageFixture(); observer.attach(page, 'page-0', context);
  const stop = async () => { observer.beginCutoff(); const cutoff = await collector.stop(); observer.seal(cutoff); return cutoff; };
  return { report, collector, collectorErrors, observer, context, page, stop, setCase(value) { current = value; } };
}
const readKinds = (observer, id = 1) => observer.data.events.filter(row => row.read === id).map(row => row.kind);
const oldErrorGate = report => assert.throws(() => assertCompleteReport({ ...report, executionKind: 'production_browser', sourceEnd: report.source }), error => error.actual === 1 && error.expected === 0);

test('CRO-02：原成员取值、this、两个读取和同一收据对象的成功顺序', async () => {
  const body = deferred(), snapshot = deferred(), snapshotStarted = deferred(), order = [];
  const f = fixture({ snapshot: page => { assert.equal(page, f.page); order.push('snapshot'); snapshotStarted.resolve(); return snapshot.promise; } });
  const receipts = [], push = Array.prototype.push;
  Object.defineProperty(receipts, 'push', { get() { order.push('push-getter'); return function(value) { assert.equal(this, receipts); order.push('push-call'); return push.call(this, value); }; } });
  Object.defineProperty(f.report, 'httpReceipts', { configurable: true, get() { order.push('array-getter'); return receipts; } });
  const actualReceipt = { preserved: 'identity' }, response = responseFixture(undefined, { body: () => { order.push('body'); return body.promise; } });
  f.page.emit('response', response);
  assert.deepEqual(order, ['array-getter', 'push-getter', 'body']);
  assert.deepEqual(readKinds(f.observer), ['response', 'body-start']);
  body.resolve(actualReceipt); await snapshotStarted.promise;
  assert.equal(receipts.length, 0); assert.deepEqual(order, ['array-getter', 'push-getter', 'body', 'snapshot']);
  let viewReads = 0;
  snapshot.resolve({ get viewId() { viewReads++; return 'actual-view'; } });
  await f.stop();
  assert.deepEqual(order, ['array-getter', 'push-getter', 'body', 'snapshot', 'push-call']);
  assert.equal(viewReads, 1); assert.equal(response.calls.json, 1); assert.equal(response.calls.url, 1); assert.equal(response.calls.ok, 1);
  assert.equal(receipts[0].receipt, actualReceipt); assert.equal(receipts[0].viewId, 'actual-view'); assert.ok(Number.isFinite(Date.parse(receipts[0].receivedAt)));
  assert.deepEqual(Object.keys(receipts[0]), ['pageId', 'receivedAt', 'receipt', 'viewId']);
  assert.deepEqual(readKinds(f.observer), ['response', 'body-start', 'body-ok', 'snapshot-start', 'snapshot-ok', 'receipt-recorded']);
  f.observer.assertComplete(); assert.deepEqual(f.collectorErrors, []);
});

test('CRO-01：同 URL 不同 Request、重复 response、不同 page/context 保留独立身份', async () => {
  const f = fixture(), a = requestFixture(), b = requestFixture({ method: 'POST' });
  const second = pageFixture(), context = new EventEmitter(); f.observer.attach(second, 'page-1', context);
  f.page.emit('request', a); second.emit('request', b);
  const ra = responseFixture(a), rb = responseFixture(b);
  f.page.emit('response', ra); f.page.emit('response', ra); second.emit('response', rb);
  f.page.emit('requestfinished', a); second.emit('requestfinished', b); await f.stop(); f.observer.assertComplete();
  assert.equal(ra.calls.json, 2); assert.equal(rb.calls.json, 1); assert.equal(f.report.httpReceipts.length, 3);
  assert.equal(f.observer.data.requests.length, 2); assert.equal(f.observer.data.counters.readTasksAdmitted, 3);
  assert.deepEqual(f.observer.data.requests.map(row => [row.id, row.page, row.method]), [[1, 0, 'GET'], [2, 1, 'POST']]);
  assert.equal(f.observer.data.contexts.length, 2);
  assert.ok(!JSON.stringify(f.observer.data).includes('not-retained'));
});

test('CRO-04：非 ok、requestfailed 与 finished 不冒充 body 或收据', async () => {
  const f = fixture(), failed = requestFixture(), finished = requestFixture();
  const bad = responseFixture(failed, { ok: false });
  f.page.emit('requestfailed', failed); f.page.emit('requestfinished', finished); f.page.emit('response', bad);
  await f.stop(); f.observer.assertComplete();
  assert.equal(bad.calls.json, 0); assert.equal(f.report.httpReceipts.length, 0); assert.equal(f.report.pageErrors.length, 0);
  assert.deepEqual(readKinds(f.observer), ['response', 'skip-non-ok']);
  assert.deepEqual(f.observer.data.requests.map(row => [row.firstSeen, row.settlementAtCutoff]), [['requestfailed', 'FAILED_OBSERVED'], ['requestfinished', 'FINISHED_OBSERVED']]);
});

test('CRO-03：body 拒绝只读原 message 一次，完整观察仍不能越过旧错误门', async () => {
  let messages = 0, snapshots = 0;
  const error = { get message() { messages++; return 'No resource with given identifier found'; } };
  const f = fixture({ snapshot: () => { snapshots++; } });
  const response = responseFixture(undefined, { body: () => Promise.reject(error) });
  f.page.emit('response', response); await f.stop(); f.observer.assertComplete();
  assert.equal(messages, 1); assert.equal(snapshots, 0); assert.equal(response.calls.json, 1);
  assert.deepEqual(readKinds(f.observer), ['response', 'body-start', 'body-error']);
  assert.equal(f.report.httpReceipts.length, 0); assert.equal(f.report.pageErrors[0].message, '实际收据响应无法读取：No resource with given identifier found');
  assert.equal(f.observer.data.status, 'SEALED'); oldErrorGate(f.report);
});

test('CRO-03：snapshot 失败不伪造已入账收据，原 body 不再读', async () => {
  let count = 0; const error = new Error('snapshot-original');
  const f = fixture({ snapshot: () => { count++; throw error; } }), response = responseFixture();
  f.page.emit('response', response); await f.stop(); f.observer.assertComplete();
  assert.equal(count, 1); assert.equal(response.calls.json, 1); assert.equal(f.report.httpReceipts.length, 0);
  assert.deepEqual(readKinds(f.observer), ['response', 'body-start', 'body-ok', 'snapshot-start', 'snapshot-error']);
  assert.equal(f.report.pageErrors[0].message, '实际收据响应无法读取：snapshot-original'); oldErrorGate(f.report);
});

test('CRO-03/C3：早期 push getter 失败不触发 body/snapshot，不补造阶段', async () => {
  let reads = 0, snapshots = 0, messages = 0;
  const error = { get message() { messages++; return 'push-getter-original'; } };
  const f = fixture({ snapshot: () => { snapshots++; } });
  Object.defineProperty(f.report.httpReceipts, 'push', { get() { reads++; throw error; } });
  const response = responseFixture(); f.page.emit('response', response); await f.stop(); f.observer.assertComplete();
  assert.equal(reads, 1); assert.equal(messages, 1); assert.equal(response.calls.json, 0); assert.equal(snapshots, 0);
  assert.deepEqual(readKinds(f.observer), ['response', 'record-error']); oldErrorGate(f.report);
});

test('CRO-03：晚 push 函数失败保留两个实际读取和相同接收者', async () => {
  let snapshots = 0, pushes = 0;
  const f = fixture({ snapshot: () => { snapshots++; return { viewId: 'v' }; } }), receipts = f.report.httpReceipts;
  receipts.push = function() { assert.equal(this, receipts); pushes++; throw new Error('push-call-original'); };
  const response = responseFixture(); f.page.emit('response', response); await f.stop(); f.observer.assertComplete();
  assert.equal(snapshots, 1); assert.equal(pushes, 1); assert.equal(response.calls.json, 1);
  assert.deepEqual(readKinds(f.observer), ['response', 'body-start', 'body-ok', 'snapshot-start', 'snapshot-ok', 'record-error']); oldErrorGate(f.report);
});

test('CRO-08：原 URL/ok 的 try 外异常仍交同一 collector', async () => {
  const f = fixture(), urlError = new Error('url-original'), okError = new Error('ok-original');
  const a = responseFixture(), b = responseFixture(); a.url = () => { throw urlError; }; b.ok = () => { throw okError; };
  f.page.emit('response', a); f.page.emit('response', b); await f.stop(); f.observer.assertComplete();
  assert.deepEqual(f.collectorErrors, [urlError, okError]); assert.equal(a.calls.json + b.calls.json, 0);
  assert.ok(f.report.pageErrors.every(row => row.message.startsWith('证据采集失败：')));
});

test('CRO-08：新增 getter 或元数据 append 失败不会拦截原成功消费', async () => {
  const f = fixture(), response = responseFixture(); response.status = () => { throw new Error('metadata-only'); };
  f.page.emit('response', response); await f.stop();
  assert.equal(response.calls.json, 1); assert.equal(f.report.httpReceipts.length, 1); assert.equal(f.report.pageErrors.length, 0);
  assert.equal(f.observer.data.status, 'INCOMPLETE'); assert.throws(() => f.observer.assertComplete());
  const g = fixture(), second = responseFixture(); Object.freeze(g.observer.data.events);
  g.page.emit('response', second); await g.stop();
  assert.equal(second.calls.json, 1); assert.equal(g.report.httpReceipts.length, 1); assert.equal(g.report.pageErrors.length, 0);
  assert.equal(g.observer.data.counters.activeReadTasks, 0); assert.throws(() => g.observer.assertComplete());
});

test('CRO-05：cutoff 排空已开始任务，窗口外 finished/close/新 response 不进入', async () => {
  const body = deferred(), f = fixture(), request = requestFixture();
  const old = responseFixture(request, { body: () => body.promise }), late = responseFixture();
  f.page.emit('request', request); f.page.emit('response', old);
  const stopped = f.stop(), firstCutoff = f.observer.data.window.cutoffRequested;
  f.observer.beginCutoff(); assert.equal(f.observer.data.window.cutoffRequested, firstCutoff);
  f.page.emit('requestfinished', request); f.page.emit('close'); f.context.emit('close'); f.page.emit('response', late);
  assert.equal(late.calls.json, 0); body.resolve({ old: 'actual' }); await stopped; f.observer.assertComplete();
  assert.equal(old.calls.json, 1); assert.equal(f.report.httpReceipts.length, 1);
  assert.equal(f.observer.data.requests[0].settlementAtCutoff, 'UNKNOWN_AT_CUTOFF');
  assert.equal(f.observer.data.events.filter(row => ['requestfinished', 'page-close', 'context-close'].includes(row.kind)).length, 0);
  assert.equal(readKinds(f.observer).at(-1), 'receipt-recorded');
});

test('CRO-06：真实 finalizer 等待原 pending，封存后真实 freeze，两次保存稳定', async () => {
  const body = deferred(), f = fixture(), saves = [];
  f.page.emit('response', responseFixture(undefined, { body: () => body.promise }));
  const done = finalizeCuilanReport({ report: f.report, output: '/controlled-save-stub', stopCollecting: f.stop,
    resources: [['controlled-resource', true, async () => {}]], readSource: async () => f.report.source,
    audit: async () => { assert.equal(f.report.pageErrors.length, 0); f.observer.assertComplete(); f.report.assessment = 'PASS'; },
    save: async (path, report) => { assert.ok(Object.isFrozen(report.responseObservation.events)); assert.throws(() => report.responseObservation.events.push({}), TypeError); saves.push({ path, data: JSON.stringify(report.responseObservation) }); return { controlledSaveStub: true }; }, diagnostic: () => {} });
  assert.equal(saves.length, 0); assert.ok(!Object.isFrozen(f.observer.data));
  body.resolve({ genuineFixtureObject: true }); await done;
  assert.equal(saves.length, 2); assert.equal(saves[0].data, saves[1].data); assert.equal(f.report.assessment, 'PASS');
  const before = JSON.stringify(f.observer.data);
  f.observer.beginOperation('room-close', [f.page]); f.observer.endOperation({}); f.observer.attach(pageFixture(), 'late', new EventEmitter()); f.observer.beginCutoff();
  assert.equal(JSON.stringify(f.observer.data), before);
});

test('CRO-06：原 stop 超时保留 FAIL，清理后第二次原排空才 seal/save', async () => {
  const body = deferred(), f = fixture({ drainTimeoutMs: 1 }), saves = [], cutoffs = [];
  f.page.emit('response', responseFixture(undefined, { body: () => body.promise }));
  await finalizeCuilanReport({ report: f.report, output: '/controlled-save-stub', stopCollecting: async () => { cutoffs.push(f.observer.data.window.cutoffRequested); return f.stop(); },
    resources: [['controlled-resource', true, async () => { assert.equal(f.observer.data.window.sealed, null); assert.equal(saves.length, 0); body.resolve({ releasedByOriginalCleanup: true }); }]],
    readSource: async () => f.report.source, audit: async () => f.observer.assertComplete(),
    save: async path => { saves.push(path); return { controlledSaveStub: true }; }, diagnostic: () => {} });
  assert.equal(cutoffs.length, 2); assert.equal(f.report.assessment, 'FAIL'); assert.equal(f.report.evidenceErrors[0].stage, 'stop-collection');
  assert.equal(saves.length, 1); assert.ok(saves[0].endsWith('/result.json')); assert.equal(f.observer.data.status, 'SEALED');
  assert.equal(f.report.collectionCutoff.pending, 0); assert.equal(f.observer.data.counters.activeReadTasks, 0);
});

test('CRO-07：只计实际主 frame 事件，原操作边界同步且失败不读取 Error', async () => {
  const f = fixture(), page = f.page;
  const operation = f.observer.beginOperation('recover-player-reload', [page]); assert.equal(typeof operation.then, 'undefined');
  f.setCase('P-05'); page.emit('framenavigated', { url: () => 'http://localhost/child' }); page.emit('framenavigated', page.frame);
  f.observer.endOperation(operation);
  const failedOperation = f.observer.beginOperation('room-close', [page]), originalError = new Error('same-original'); let caught;
  try { throw originalError; } catch (error) { f.observer.failOperation(failedOperation); caught = error; }
  assert.equal(caught, originalError);
  page.emit('crash'); page.emit('close'); f.context.emit('close');
  f.observer.beginOperation('room-close', [page]); // cutoff 前未结束的操作不新增完成门。
  await f.stop(); f.observer.assertComplete();
  assert.equal(f.observer.data.pages[0].navigationCount, 1);
  assert.equal(f.observer.data.events.find(row => row.kind === 'main-frame-navigated').caseId, 'P-05');
  assert.equal(f.observer.data.events.filter(row => row.kind === 'operation-error').length, 1);
  assert.ok(!JSON.stringify(f.observer.data).includes('secret='));
});

test('CRO-08：重复 attach 不重复消费；身份冲突明确失败但原消费仍一次', async () => {
  const f = fixture(); f.observer.attach(f.page, 'page-0', f.context); f.observer.attach(f.page, 'conflicting-page', f.context);
  const response = responseFixture(); f.page.emit('response', response); await f.stop();
  assert.equal(response.calls.json, 1); assert.equal(f.report.httpReceipts.length, 1);
  assert.equal(f.observer.data.pages.length, 1); assert.throws(() => f.observer.assertComplete());
});

test('CRO-09：page/context 的实际槽位上限，超限仍安装原消费者', async () => {
  for (const separateContexts of [false, true]) {
    const f = fixture(); let last;
    for (let index = 1; index <= 16; index++) { last = pageFixture(); f.observer.attach(last, 'page-' + index, separateContexts ? new EventEmitter() : f.context); }
    const response = responseFixture(); last.emit('response', response); await f.stop();
    assert.equal(f.observer.data.pages.length, 16); assert.equal(f.observer.data.contexts.length, separateContexts ? 16 : 1);
    assert.equal(response.calls.json, 1); assert.equal(f.report.httpReceipts.length, 1); assert.throws(() => f.observer.assertComplete());
    assert.ok(f.observer.data.issues.some(row => row.code === 'PAGE_LIMIT'));
    if (separateContexts) assert.ok(f.observer.data.issues.some(row => row.code === 'CONTEXT_LIMIT'));
  }
});

test('CRO-09：1024 Request/read 上限分别生效，越一不吞原 body', async () => {
  const f = fixture();
  for (let index = 0; index < 1024; index++) f.page.emit('request', requestFixture({ path: '/api/actions/' + index }));
  assert.equal(f.observer.data.requests.length, 1024); assert.equal(f.observer.data.issues.length, 0);
  const overflow = requestFixture(), response = responseFixture(overflow); f.page.emit('request', overflow); f.page.emit('response', response); await f.stop();
  assert.equal(f.observer.data.requests.length, 1024); assert.equal(f.observer.data.counters.requestsUntracked, 1); assert.equal(response.calls.json, 1); assert.throws(() => f.observer.assertComplete());
  const g = fixture(), repeated = responseFixture(undefined, { ok: false });
  for (let index = 0; index < 1024; index++) g.page.emit('response', repeated);
  assert.equal(g.observer.data.counters.readTasksAdmitted, 1024); assert.equal(g.observer.data.issues.length, 0);
  const last = responseFixture(); g.page.emit('response', last); await g.stop();
  assert.equal(g.observer.data.counters.readTasksAdmitted, 1024); assert.equal(g.observer.data.counters.readTasksUntracked, 1); assert.equal(last.calls.json, 1); assert.throws(() => g.observer.assertComplete());
});

test('CRO-09：8448 事件恰上限可封存，越一保留旧记录并明确丢弃', async t => {
  assert.equal(limits.events, 8448); assert.equal(limits.serializedBytes, 32 * 1024 * 1024);
  const f = fixture(), request = requestFixture({ failure: '\u0000'.repeat(256) });
  for (let index = 2; index < 8448; index++) f.page.emit('requestfailed', request);
  assert.equal(f.observer.data.events.length, 8448); await f.stop(); f.observer.assertComplete();
  const bytes = Buffer.byteLength(JSON.stringify(f.observer.data, null, 2)); assert.ok(bytes + 32 < 32 * 1024 * 1024);
  t.diagnostic(JSON.stringify({ scope: 'CRO_CONTROLLED_EVENT_CAPACITY', eventCount: f.observer.data.events.length, serializedBytes: bytes, reservedBytes: limits.serializedBytes }));
  const g = fixture(), repeat = requestFixture(), first = JSON.stringify(g.observer.data.events[0]);
  for (let index = 2; index < 8449; index++) g.page.emit('requestfailed', repeat);
  await g.stop(); assert.equal(g.observer.data.events.length, 8448); assert.equal(JSON.stringify(g.observer.data.events[0]), first);
  assert.equal(g.observer.data.counters.eventsDropped, 1); assert.ok(g.observer.data.issues.some(row => row.code === 'EVENT_LIMIT')); assert.throws(() => g.observer.assertComplete());
});

test('CRO-09：256 生命周期和16 issue 上限不滚动覆盖', async () => {
  const f = fixture(), first = JSON.stringify(f.observer.data.events[0]);
  for (let index = 2; index < 257; index++) f.page.emit('crash');
  await f.stop(); assert.equal(f.observer.data.events.length, 256); assert.equal(JSON.stringify(f.observer.data.events[0]), first);
  assert.equal(f.observer.data.counters.eventsDropped, 1); assert.ok(f.observer.data.issues.some(row => row.code === 'LIFECYCLE_LIMIT')); assert.throws(() => f.observer.assertComplete());
  const g = fixture();
  for (let index = 0; index < 21; index++) { const response = responseFixture(); response.status = () => { throw new Error('metadata'); }; g.page.emit('response', response); }
  await g.stop(); assert.equal(g.observer.data.issues.length, 16); assert.equal(g.observer.data.counters.issuesTotal, 21); assert.equal(g.observer.data.counters.issuesDropped, 5);
  assert.equal(g.report.httpReceipts.length, 21); assert.equal(g.report.pageErrors.length, 0); assert.throws(() => g.observer.assertComplete());
});

test('CRO-09：文本按 UTF-16 上限保留前缀和完整长度，超限不能冒充完整', async () => {
  const f = fixture(), prefix = '/api/actions/';
  const exact = requestFixture({ path: prefix + 'a'.repeat(256 - prefix.length), method: 'M'.repeat(16), failure: '\u0000'.repeat(256) });
  f.page.emit('requestfailed', exact); await f.stop(); f.observer.assertComplete();
  assert.equal(f.observer.data.requests[0].path.length, 256); assert.equal(f.observer.data.requests[0].method.length, 16);
  const g = fixture(), page = pageFixture(); g.observer.attach(page, '界'.repeat(81), g.context);
  const long = requestFixture({ path: prefix + 'x'.repeat(257 - prefix.length), method: 'M'.repeat(17), failure: '😀'.repeat(128) + 'x' });
  g.page.emit('requestfailed', long); const response = responseFixture(long); g.page.emit('response', response); await g.stop();
  const request = g.observer.data.requests[0], failure = g.observer.data.events.find(row => row.kind === 'requestfailed').data;
  assert.equal(request.path.length, 256); assert.equal(request.pathCodeUnits, 257); assert.equal(request.pathTruncated, true);
  assert.equal(request.method.length, 16); assert.equal(request.methodCodeUnits, 17); assert.equal(failure.errorText.length, 256); assert.equal(failure.fullCodeUnits, 257);
  assert.equal(g.observer.data.pages[1].pageId.length, 80); assert.equal(response.calls.json, 1); assert.throws(() => g.observer.assertComplete());
});

test('CRO-10：缺阶段、错索引、非法 kind/data 和越界字段不能取得完整资格', async () => {
  const mutations = [
    data => { data.events.splice(data.events.findIndex(row => row.kind === 'body-ok'), 1); data.events.forEach((row, index) => { row.seq = index + 1; }); },
    data => { data.events.find(row => row.kind === 'receipt-recorded').data.httpReceiptIndex = 1; },
    data => { data.events.find(row => row.kind === 'body-start').data = { httpReceiptIndex: 0 }; },
    data => { data.events[0].kind = 'invented-event'; },
    data => { data.requests[0].fullURL = 'forbidden-extra-field'; },
  ];
  for (const mutate of mutations) {
    const f = fixture(); f.page.emit('response', responseFixture()); f.page.emit('response', responseFixture()); await f.stop(); f.observer.assertComplete();
    mutate(f.observer.data); assert.throws(() => f.observer.assertComplete());
  }
});

test('CRO-10/C3：真实晚期 record-error 不能删除四阶段伪装早期失败', async () => {
  const f = fixture(), response = responseFixture();
  f.report.httpReceipts.push = () => { throw new Error('late-record-error'); };
  f.page.emit('response', response); await f.stop(); f.observer.assertComplete();
  assert.equal(response.calls.json, 1);
  assert.deepEqual(readKinds(f.observer), ['response', 'body-start', 'body-ok', 'snapshot-start', 'snapshot-ok', 'record-error']);
  const removedKinds = new Set(['body-start', 'body-ok', 'snapshot-start', 'snapshot-ok']);
  f.observer.data.events = f.observer.data.events.filter(row => row.read !== 1 || !removedKinds.has(row.kind));
  f.observer.data.events.forEach((row, index) => { row.seq = index + 1; });
  assert.deepEqual(readKinds(f.observer), ['response', 'record-error']);
  assert.throws(() => f.observer.assertComplete(), /实际发生的读取阶段/);
});

test('CRO-08：两种原 push 的未知返回值只使观察不完整，不制造旧错误或强制转换', async () => {
  let conversionCalls = 0;
  for (const returned of [Symbol('unknown'), { valueOf() { conversionCalls++; assert.fail('不得为新增索引转换原返回对象'); } }]) {
    let snapshots = 0;
    const f = fixture({ snapshot: () => { snapshots++; return { viewId: 'actual-view' }; } }), receipts = f.report.httpReceipts;
    receipts.push = function(value) { assert.equal(this, receipts); Array.prototype.push.call(this, value); return returned; };
    const response = responseFixture(); f.page.emit('response', response); await f.stop();
    assert.equal(conversionCalls, 0, '成功入账后不得为观察转换原 push 返回对象');
    assert.equal(response.calls.json, 1); assert.equal(snapshots, 1); assert.equal(receipts.length, 1);
    assert.equal(f.report.pageErrors.length, 0); assert.deepEqual(f.collectorErrors, []);
    assert.equal(f.observer.data.status, 'INCOMPLETE'); assert.throws(() => f.observer.assertComplete());
    const g = fixture(), errors = g.report.pageErrors; let messages = 0;
    errors.push = function(value) { assert.equal(this, errors); Array.prototype.push.call(this, value); return returned; };
    const originalError = { get message() { messages++; return 'original-body-error'; } };
    const failed = responseFixture(undefined, { body: () => Promise.reject(originalError) });
    g.page.emit('response', failed); await g.stop();
    assert.equal(conversionCalls, 0, '原错误入账后不得为观察转换原 push 返回对象');
    assert.equal(failed.calls.json, 1); assert.equal(messages, 1); assert.equal(errors.length, 1);
    assert.equal(errors[0].message, '实际收据响应无法读取：original-body-error');
    assert.equal(g.report.httpReceipts.length, 0); assert.deepEqual(g.collectorErrors, []);
    assert.equal(g.observer.data.status, 'INCOMPLETE'); assert.throws(() => g.observer.assertComplete());
  }
});
