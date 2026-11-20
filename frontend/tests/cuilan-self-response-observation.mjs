// 只补充原收据消费者的身份、阶段和窗口事实；不补读、不重试、不改变故障时序。
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

export const cuilanResponseObservationLimits = Object.freeze({
  contexts: 16, pages: 16, requests: 1024, reads: 1024, lifecycleEvents: 256,
  events: 8448, issues: 16, pathCodeUnits: 256, methodCodeUnits: 16,
  pageIdCodeUnits: 80, requestFailureCodeUnits: 256, serializedBytes: 33554432,
});
const limits = cuilanResponseObservationLimits;
const caseIds = new Set(['P-01', 'P-02', 'P-03', 'P-04', 'P-05', 'P-06']);
const operationNames = new Set(['binding-interruption-reload', 'recover-player-reload', 'room-close']);
const lifecycleKinds = new Set(['context-attached', 'page-attached', 'main-frame-navigated', 'page-close', 'context-close', 'page-crash', 'operation-start', 'operation-end', 'operation-error']);
const emptyKinds = new Set(['request', 'requestfinished', 'skip-non-ok', 'body-start', 'body-ok', 'snapshot-start', 'snapshot-ok', 'context-attached', 'page-attached', 'page-close', 'context-close', 'page-crash', 'operation-end', 'operation-error']);
const errorKinds = new Set(['body-error', 'snapshot-error', 'record-error']);
const counterNames = ['targetRequestEvents', 'targetResponseEvents', 'requestFinishedEvents', 'requestFailedEvents', 'readTasksAdmitted', 'readTasksUntracked', 'activeReadTasks', 'lifecycleEvents', 'eventsDropped', 'requestsUntracked', 'issuesTotal', 'issuesDropped'];
const errorPrefix = '实际收据响应无法读取：';
const phases = [
  ['response', 'skip-non-ok'],
  ['response', 'body-start', 'body-error'],
  ['response', 'body-start', 'body-ok', 'snapshot-start', 'snapshot-error'],
  ['response', 'body-start', 'body-ok', 'snapshot-start', 'snapshot-ok', 'record-error'],
  ['response', 'record-error'], // 原 push 成员取值可早于 body，不能补造尝试阶段。
  ['response', 'body-start', 'body-ok', 'snapshot-start', 'snapshot-ok', 'receipt-recorded'],
];
function uint(value, max = Number.MAX_SAFE_INTEGER) { assert.ok(Number.isSafeInteger(value) && value >= 0 && value <= max); }
function shape(value, keys) {
  assert.ok(value && Object.getPrototypeOf(value) === Object.prototype);
  assert.deepEqual(Object.keys(value).sort(), keys.slice().sort());
}
function stampShape(value) {
  shape(value, ['monoMs', 'utcMs']); assert.ok(Number.isFinite(value.monoMs) && value.monoMs >= 0); uint(value.utcMs);
}
function textShape(value, max) { assert.equal(typeof value, 'string'); assert.ok(value.length <= max); }

export function createCuilanResponseObservation({ collector, report, currentCase, readSnapshot }) {
  const contexts = new WeakMap(), pages = new WeakMap(), requests = new WeakMap(), operations = new WeakMap();
  const reads = new Map();
  let accepting = true, sealed = false, failed = false, activeReads = 0, nextOperation = 0;
  let lastClock = { monoMs: 0, utcMs: 0 };
  const data = {
    version: 1, scope: 'cuilan-response-observation-v1', status: 'COLLECTING', limits,
    window: { started: lastClock, cutoffRequested: null, collector: null, sealed: null },
    counters: Object.fromEntries(counterNames.map(name => [name, 0])),
    contexts: [], pages: [], requests: [], events: [], issues: [],
  };
  function rawClock() {
    const value = { monoMs: performance.now(), utcMs: Date.now() };
    stampShape(value); return value;
  }
  function issue(code, subjectType = 'observer', subject = null) {
    failed = true;
    if (sealed) return;
    // 记录失败本身也不能替换原消费者异常；私有 failed 仍使完整性检查拒绝通过。
    try {
      data.status = 'INCOMPLETE';
      data.counters.issuesTotal = Math.min(Number.MAX_SAFE_INTEGER, data.counters.issuesTotal + 1);
      if (data.issues.length >= limits.issues) {
        data.counters.issuesDropped = Math.min(Number.MAX_SAFE_INTEGER, data.counters.issuesDropped + 1); return;
      }
      let at = lastClock;
      try { at = rawClock(); } catch { /* 不伪造有效时钟，使用最后实际值并保留失败。 */ }
      data.issues.push({ code, subjectType, subject, at });
    } catch { /* 原报告写入故障由 failed 锁存，不向业务传播。 */ }
  }
  function safely(action, code = 'OBSERVER_INTERNAL_ERROR', type = 'observer', subject = null) {
    if (sealed) return undefined;
    try { return action(); } catch { issue(code, type, subject); return undefined; }
  }
  function clock() {
    try { lastClock = rawClock(); } catch { issue('CLOCK_INVALID', 'clock'); }
    return lastClock;
  }
  data.window.started = clock();
  function bump(name) {
    const value = data.counters[name]; uint(value);
    if (value === Number.MAX_SAFE_INTEGER) { issue('OBSERVER_INTERNAL_ERROR'); return; }
    data.counters[name] = value + 1;
  }
  function bounded(value, maximum, type, subject) {
    assert.equal(typeof value, 'string');
    const truncated = value.length > maximum;
    if (truncated) issue('TEXT_LIMIT', type, subject);
    return { value: value.slice(0, maximum), fullCodeUnits: value.length, truncated };
  }
  function event(kind, page, { request = null, read = null, operation = null, context = page?.context ?? null, detail = {} } = {}) {
    if (sealed) return false;
    if (lifecycleKinds.has(kind)) {
      bump('lifecycleEvents');
      if (data.counters.lifecycleEvents > limits.lifecycleEvents) { bump('eventsDropped'); issue('LIFECYCLE_LIMIT', 'lifecycle'); return false; }
    }
    if (data.events.length >= limits.events) { bump('eventsDropped'); issue('EVENT_LIMIT', 'event'); return false; }
    const caseId = currentCase() ?? null;
    assert.ok(caseId === null || caseIds.has(caseId));
    data.events.push({ seq: data.events.length + 1, ...clock(), caseId,
      page: page?.index ?? null, context, navigation: page?.index === null || !page ? null : page.navigationCount,
      request, read, operation, kind, data: detail });
    return true;
  }
  function requestIdentity(request, page, firstSeen, knownPath) {
    if (requests.has(request)) {
      const old = requests.get(request);
      if (old && old.page !== page.index) issue('IDENTITY_ACCESS_FAILED', 'request', old.id);
      return old;
    }
    if (data.requests.length >= limits.requests || page.index === null) {
      bump('requestsUntracked'); requests.set(request, null); issue('REQUEST_LIMIT', 'request'); return null;
    }
    const id = data.requests.length + 1;
    const path = bounded(knownPath ?? new URL(request.url()).pathname, limits.pathCodeUnits, 'request', id);
    const method = bounded(request.method(), limits.methodCodeUnits, 'request', id);
    const row = { id, page: page.index, firstSeen, method: method.value, methodCodeUnits: method.fullCodeUnits, methodTruncated: method.truncated,
      path: path.value, pathCodeUnits: path.fullCodeUnits, pathTruncated: path.truncated, settlementAtCutoff: null };
    const identity = { id, page: page.index, row, finished: false, failed: false };
    data.requests.push(row); requests.set(request, identity); return identity;
  }
  function networkEvent(kind, page, request) {
    if (!accepting) return;
    safely(() => {
      const path = new URL(request.url()).pathname;
      if (!/\/actions\//.test(path)) return;
      bump({ request: 'targetRequestEvents', requestfinished: 'requestFinishedEvents', requestfailed: 'requestFailedEvents' }[kind]);
      const identity = requestIdentity(request, page, kind, path);
      let detail = {};
      if (kind === 'requestfinished' && identity) identity.finished = true;
      if (kind === 'requestfailed') {
        if (identity) identity.failed = true;
        const value = bounded(request.failure().errorText, limits.requestFailureCodeUnits, 'request', identity?.id ?? null);
        detail = { errorText: value.value, fullCodeUnits: value.fullCodeUnits, truncated: value.truncated };
      }
      event(kind, page, { request: identity?.id ?? null, detail });
    }, 'IDENTITY_ACCESS_FAILED', 'request');
  }
  function beginRead(response, page, ok) {
    bump('targetResponseEvents');
    if (reads.size >= limits.reads) { bump('readTasksUntracked'); issue('READ_LIMIT', 'read'); return null; }
    const read = { id: reads.size + 1, page, request: null, terminal: null,
      bodyStarted: false, bodyFinished: false, snapshotStarted: false, snapshotFinished: false };
    reads.set(read.id, read); activeReads++;
    safely(() => {
      bump('readTasksAdmitted'); data.counters.activeReadTasks = activeReads;
      read.request = requestIdentity(response.request(), page, 'response')?.id ?? null;
      const status = response.status(); uint(status, 999); assert.equal(typeof ok, 'boolean');
      event('response', page, { request: read.request, read: read.id, detail: { status, ok } });
    }, 'IDENTITY_ACCESS_FAILED', 'read', read.id);
    return read;
  }
  function mark(read, kind, detail = {}) {
    if (!read) return;
    // 私有事实来自原执行点，不从待验证的公开事件倒推早晚失败。
    if (kind === 'body-start') read.bodyStarted = true;
    if (kind === 'body-ok') read.bodyFinished = true;
    if (kind === 'snapshot-start') read.snapshotStarted = true;
    if (kind === 'snapshot-ok') read.snapshotFinished = true;
    safely(() => {
      const recorded = event(kind, read.page, { request: read.request, read: read.id, detail });
      if (recorded && (kind === 'skip-non-ok' || kind === 'receipt-recorded' || errorKinds.has(kind))) read.terminal = { kind, detail: { ...detail } };
    }, 'OBSERVER_INTERNAL_ERROR', 'read', read.id);
  }
  function markIndex(read, kind, field, length) {
    if (!read) return;
    safely(() => {
      // 原代码忽略 push 返回值；未知值不得触发新增强制转换或旧错误路径。
      uint(length); assert.ok(length > 0);
      mark(read, kind, { [field]: length - 1 });
    }, 'OBSERVER_INTERNAL_ERROR', 'read', read.id);
  }
  function attach(page, pageId, context) {
    if (!accepting || sealed) return;
    if (pages.has(page)) {
      const old = pages.get(page);
      if (old.originalPageId !== pageId || old.originalContext !== context) issue('IDENTITY_ACCESS_FAILED', 'page', old.index);
      return;
    }
    const state = { index: null, context: null, navigationCount: 0, originalPageId: pageId, originalContext: context };
    pages.set(page, state);
    // 先安装原 async consumer；此 Promise 由原 collector 跟踪，不另起异步任务。
    collector.observe(page, 'response', async response => {
      if (!accepting) return;
      const path = new URL(response.url()).pathname;
      if (!/\/actions\//.test(path)) return;
      const ok = response.ok(); // 原 try 外异常仍由原 collector.onError 接住。
      const read = safely(() => beginRead(response, state, ok));
      try {
        if (!ok) { mark(read, 'skip-non-ok'); return; }
        let phase = 'record';
        const snapshotFinished = viewId => { phase = 'record'; mark(read, 'snapshot-ok'); return viewId; };
        try {
          // 保留原成员调用、this、参数顺序与两个 await；原 push getter 仍先于 body。
          const length = report.httpReceipts.push({ pageId, receivedAt: new Date().toISOString(),
            receipt: await (phase = 'body', mark(read, 'body-start'), response.json()),
            viewId: snapshotFinished((mark(read, 'body-ok'), phase = 'snapshot', mark(read, 'snapshot-start'), await readSnapshot(page))?.viewId) });
          markIndex(read, 'receipt-recorded', 'httpReceiptIndex', length);
        } catch (error) {
          const length = report.pageErrors.push({ message: errorPrefix + error.message });
          markIndex(read, phase + '-error', 'pageErrorIndex', length);
        }
      } finally {
        if (read) {
          activeReads--;
          safely(() => { data.counters.activeReadTasks = activeReads; });
          if (!read.terminal) issue('INVALID_READ_PHASE', 'read', read.id);
        }
      }
    });
    safely(() => {
      if (!contexts.has(context)) {
        if (data.contexts.length >= limits.contexts) { contexts.set(context, null); issue('CONTEXT_LIMIT', 'context'); }
        else {
          const index = data.contexts.length; contexts.set(context, index); data.contexts.push({ index });
          event('context-attached', null, { context: index });
          safely(() => collector.observe(context, 'close', () => { if (accepting) safely(() => event('context-close', null, { context: index })); }));
        }
      }
      state.context = contexts.get(context);
      if (data.pages.length >= limits.pages || state.context === null) { issue('PAGE_LIMIT', 'page'); return; }
      state.index = data.pages.length;
      const id = bounded(pageId, limits.pageIdCodeUnits, 'page', state.index);
      data.pages.push({ index: state.index, pageId: id.value, context: state.context, navigationCount: 0 });
      event('page-attached', state);
    }, 'IDENTITY_ACCESS_FAILED', 'page');
    for (const kind of ['request', 'requestfinished', 'requestfailed']) safely(() => collector.observe(page, kind, request => networkEvent(kind, state, request)));
    safely(() => collector.observe(page, 'framenavigated', frame => {
      if (!accepting) return;
      safely(() => {
        if (frame !== page.mainFrame()) return;
        uint(state.navigationCount);
        if (state.navigationCount === Number.MAX_SAFE_INTEGER) throw new Error('导航计数超出精确整数');
        state.navigationCount++;
        if (state.index !== null) data.pages[state.index].navigationCount = state.navigationCount;
        const path = bounded(new URL(frame.url()).pathname, limits.pathCodeUnits, 'page', state.index);
        event('main-frame-navigated', state, { detail: { path: path.value, fullCodeUnits: path.fullCodeUnits, truncated: path.truncated } });
      }, 'IDENTITY_ACCESS_FAILED', 'page', state.index);
    }));
    for (const [native, kind] of [['close', 'page-close'], ['crash', 'page-crash']]) safely(() => collector.observe(page, native, () => { if (accepting) safely(() => event(kind, state)); }));
  }
  function beginOperation(name, actualPages) {
    if (!accepting || sealed) return undefined;
    return safely(() => {
      assert.ok(operationNames.has(name)); assert.ok(actualPages.length <= limits.pages);
      const indices = actualPages.map(page => { const index = pages.get(page)?.index; uint(index, limits.pages - 1); return index; });
      assert.equal(new Set(indices).size, indices.length);
      if (nextOperation >= limits.lifecycleEvents) { issue('LIFECYCLE_LIMIT', 'lifecycle'); return undefined; }
      const token = {}, identity = { id: ++nextOperation, ended: false };
      operations.set(token, identity);
      event('operation-start', null, { operation: identity.id, detail: { name, pages: indices } });
      return token;
    });
  }
  function finishOperation(token, kind) {
    if (!accepting || sealed || token === undefined) return;
    safely(() => {
      const identity = operations.get(token); assert.ok(identity && !identity.ended);
      identity.ended = true; event(kind, null, { operation: identity.id });
    });
  }
  function beginCutoff() {
    if (!accepting || sealed) return;
    accepting = false; safely(() => { data.window.cutoffRequested = clock(); });
  }
  function seal(cutoff) {
    if (sealed) return;
    if (accepting || activeReads !== 0 || cutoff?.pending !== 0) {
      issue('SEAL_WITH_PENDING', 'seal'); throw new Error('观察必须等待原 collector 排空后封存');
    }
    safely(() => {
      textShape(cutoff.stoppedAt, 32); textShape(cutoff.drainedAt, 32);
      data.window.collector = { stoppedAt: cutoff.stoppedAt, drainedAt: cutoff.drainedAt, pending: cutoff.pending };
      for (const row of data.requests) {
        const events = data.events.filter(event => event.request === row.id);
        const finished = events.some(event => event.kind === 'requestfinished'), failedRequest = events.some(event => event.kind === 'requestfailed');
        row.settlementAtCutoff = finished && failedRequest ? 'BOTH_OBSERVED' : finished ? 'FINISHED_OBSERVED' : failedRequest ? 'FAILED_OBSERVED' : 'UNKNOWN_AT_CUTOFF';
      }
      data.window.sealed = clock(); data.status = failed ? 'INCOMPLETE' : 'SEALED';
    });
    sealed = true;
  }
  function assertComplete() {
    assert.ok(sealed && !failed, '观察未完整封存或发生记录故障');
    shape(data, ['version', 'scope', 'status', 'limits', 'window', 'counters', 'contexts', 'pages', 'requests', 'events', 'issues']);
    assert.equal(data.version, 1); assert.equal(data.scope, 'cuilan-response-observation-v1'); assert.equal(data.status, 'SEALED');
    assert.deepEqual(data.limits, limits);
    shape(data.window, ['started', 'cutoffRequested', 'collector', 'sealed']);
    for (const key of ['started', 'cutoffRequested', 'sealed']) stampShape(data.window[key]);
    assert.ok(data.window.started.monoMs <= data.window.cutoffRequested.monoMs && data.window.cutoffRequested.monoMs <= data.window.sealed.monoMs);
    shape(data.window.collector, ['stoppedAt', 'drainedAt', 'pending']);
    for (const key of ['stoppedAt', 'drainedAt']) { textShape(data.window.collector[key], 32); assert.ok(Number.isFinite(Date.parse(data.window.collector[key]))); }
    assert.equal(data.window.collector.pending, 0); assert.equal(activeReads, 0);
    shape(data.counters, counterNames); for (const value of Object.values(data.counters)) uint(value);
    for (const key of ['activeReadTasks', 'readTasksUntracked', 'requestsUntracked', 'eventsDropped', 'issuesTotal', 'issuesDropped']) assert.equal(data.counters[key], 0);
    assert.deepEqual(data.issues, []);
    for (const key of ['contexts', 'pages', 'requests', 'events']) { assert.ok(Array.isArray(data[key])); assert.ok(data[key].length <= limits[key]); }
    data.contexts.forEach((row, index) => { shape(row, ['index']); assert.equal(row.index, index); });
    data.pages.forEach((row, index) => {
      shape(row, ['index', 'pageId', 'context', 'navigationCount']); assert.equal(row.index, index); textShape(row.pageId, limits.pageIdCodeUnits);
      uint(row.context, data.contexts.length - 1); uint(row.navigationCount);
    });
    assert.equal(new Set(data.pages.map(row => row.pageId)).size, data.pages.length);
    data.requests.forEach((row, index) => {
      shape(row, ['id', 'page', 'firstSeen', 'method', 'methodCodeUnits', 'methodTruncated', 'path', 'pathCodeUnits', 'pathTruncated', 'settlementAtCutoff']);
      assert.equal(row.id, index + 1); uint(row.page, data.pages.length - 1);
      assert.ok(['request', 'response', 'requestfinished', 'requestfailed'].includes(row.firstSeen));
      for (const [field, maximum] of [['method', limits.methodCodeUnits], ['path', limits.pathCodeUnits]]) {
        textShape(row[field], maximum); assert.equal(row[field + 'CodeUnits'], row[field].length); assert.equal(row[field + 'Truncated'], false);
      }
      assert.match(row.path, /\/actions\//);
    });
    const byRead = new Map(), operationStarts = new Map(), endedOperations = new Set(), navigation = data.pages.map(() => 0);
    const receiptIndices = new Set(), errorIndices = new Set();
    let previousMono = data.window.started.monoMs;
    for (const [index, row] of data.events.entries()) {
      shape(row, ['seq', 'monoMs', 'utcMs', 'caseId', 'page', 'context', 'navigation', 'request', 'read', 'operation', 'kind', 'data']);
      assert.equal(row.seq, index + 1); assert.ok(Number.isFinite(row.monoMs) && row.monoMs >= previousMono && row.monoMs <= data.window.sealed.monoMs); previousMono = row.monoMs; uint(row.utcMs);
      assert.ok(row.caseId === null || caseIds.has(row.caseId));
      if (row.page === null) assert.equal(row.navigation, null);
      else {
        uint(row.page, data.pages.length - 1); assert.equal(row.context, data.pages[row.page].context);
        if (row.kind === 'main-frame-navigated') navigation[row.page]++;
        assert.equal(row.navigation, navigation[row.page]);
      }
      if (row.context !== null) uint(row.context, data.contexts.length - 1);
      if (row.request !== null) { uint(row.request, data.requests.length); assert.ok(row.request > 0); assert.equal(data.requests[row.request - 1].page, row.page); }
      if (row.read !== null) {
        uint(row.read, limits.reads); assert.ok(row.read > 0); assert.ok(row.request !== null);
        if (!byRead.has(row.read)) byRead.set(row.read, []);
        byRead.get(row.read).push(row);
      }
      if (emptyKinds.has(row.kind)) shape(row.data, []);
      else if (row.kind === 'response') { shape(row.data, ['status', 'ok']); uint(row.data.status, 999); assert.equal(typeof row.data.ok, 'boolean'); }
      else if (row.kind === 'requestfailed' || row.kind === 'main-frame-navigated') {
        const field = row.kind === 'requestfailed' ? 'errorText' : 'path';
        shape(row.data, [field, 'fullCodeUnits', 'truncated']); textShape(row.data[field], 256); assert.equal(row.data.fullCodeUnits, row.data[field].length); assert.equal(row.data.truncated, false);
      } else if (errorKinds.has(row.kind)) {
        shape(row.data, ['pageErrorIndex']); uint(row.data.pageErrorIndex, report.pageErrors.length - 1);
        assert.ok(!errorIndices.has(row.data.pageErrorIndex)); errorIndices.add(row.data.pageErrorIndex);
        assert.ok(report.pageErrors[row.data.pageErrorIndex].message.startsWith(errorPrefix));
      } else if (row.kind === 'receipt-recorded') {
        shape(row.data, ['httpReceiptIndex']); uint(row.data.httpReceiptIndex, report.httpReceipts.length - 1);
        assert.ok(!receiptIndices.has(row.data.httpReceiptIndex)); receiptIndices.add(row.data.httpReceiptIndex);
        assert.equal(report.httpReceipts[row.data.httpReceiptIndex].pageId, data.pages[row.page].pageId);
      } else if (row.kind === 'operation-start') {
        shape(row.data, ['name', 'pages']); assert.ok(operationNames.has(row.data.name)); assert.ok(Array.isArray(row.data.pages) && row.data.pages.length <= limits.pages);
        assert.equal(new Set(row.data.pages).size, row.data.pages.length); row.data.pages.forEach(page => uint(page, data.pages.length - 1));
      } else assert.fail('未知观察事件类型');
      if (row.kind.startsWith('operation-')) {
        uint(row.operation, limits.lifecycleEvents); assert.ok(row.operation > 0);
        if (row.kind === 'operation-start') { assert.ok(!operationStarts.has(row.operation)); operationStarts.set(row.operation, row); }
        else { assert.ok(operationStarts.has(row.operation) && !endedOperations.has(row.operation)); endedOperations.add(row.operation); }
      } else assert.equal(row.operation, null);
      if (['request', 'requestfinished', 'requestfailed'].includes(row.kind)) { assert.ok(row.request !== null); assert.equal(row.read, null); }
      else if (lifecycleKinds.has(row.kind)) { assert.equal(row.request, null); assert.equal(row.read, null); }
      else assert.ok(row.read !== null);
    }
    data.pages.forEach((row, index) => assert.equal(row.navigationCount, navigation[index]));
    data.requests.forEach(row => {
      const observed = data.events.filter(event => event.request === row.id);
      assert.equal(observed[0]?.kind, row.firstSeen);
      const finished = observed.some(event => event.kind === 'requestfinished'), failedRequest = observed.some(event => event.kind === 'requestfailed');
      assert.equal(row.settlementAtCutoff, finished && failedRequest ? 'BOTH_OBSERVED' : finished ? 'FINISHED_OBSERVED' : failedRequest ? 'FAILED_OBSERVED' : 'UNKNOWN_AT_CUTOFF');
    });
    assert.equal(byRead.size, reads.size); assert.equal(data.counters.readTasksAdmitted, reads.size);
    for (const [id, entries] of byRead) {
      const original = reads.get(id); assert.ok(original?.terminal);
      assert.ok(phases.some(sequence => sequence.join('|') === entries.map(row => row.kind).join('|')), '读取阶段必须具有实际唯一终态');
      for (const [kind, fact] of [['body-start', 'bodyStarted'], ['body-ok', 'bodyFinished'], ['snapshot-start', 'snapshotStarted'], ['snapshot-ok', 'snapshotFinished']]) {
        assert.equal(entries.some(row => row.kind === kind), original[fact], '不得缺失或伪造实际发生的读取阶段');
      }
      for (const row of entries) { assert.equal(row.page, original.page.index); assert.equal(row.request, original.request); }
      const last = entries.at(-1); assert.equal(last.kind, original.terminal.kind); assert.deepEqual(last.data, original.terminal.detail);
      assert.equal(entries[0].data.ok, last.kind !== 'skip-non-ok');
    }
    for (const [counter, kind] of [['targetRequestEvents', 'request'], ['targetResponseEvents', 'response'], ['requestFinishedEvents', 'requestfinished'], ['requestFailedEvents', 'requestfailed']]) assert.equal(data.counters[counter], data.events.filter(row => row.kind === kind).length);
    assert.equal(data.counters.lifecycleEvents, data.events.filter(row => lifecycleKinds.has(row.kind)).length);
    assert.ok(data.counters.lifecycleEvents <= limits.lifecycleEvents);
    assert.ok(Buffer.byteLength(JSON.stringify(data, null, 2)) + 32 <= limits.serializedBytes);
  }
  return { data, attach, beginOperation, endOperation: token => finishOperation(token, 'operation-end'), failOperation: token => finishOperation(token, 'operation-error'), beginCutoff, seal, assertComplete };
}
