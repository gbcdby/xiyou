import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

const selectionObservers = new WeakMap();

/** 仅显式安装的 runner 观察选择点击；同步钩子不参与原动作 Promise。 */
export function observeSelectionClicks(page, observer) {
  selectionObservers.set(page, observer);
  return () => { if (selectionObservers.get(page) === observer) selectionObservers.delete(page); };
}
export function beginSelectionClick(page, metadata) {
  const observer = selectionObservers.get(page);
  if (!observer) return;
  try { return { observer, id: observer({ phase: 'called', ...metadata }) }; } catch { /* 观察失败不能阻止原点击。 */ }
}
export function endSelectionClick(token, phase, error) {
  if (!token) return;
  try { token.observer({ phase, clickId: token.id, ...(phase === 'threw' ? { error } : {}) }); } catch { /* 保留原动作结果与异常。 */ }
}

const limits = Object.freeze({ pages: 16, clicks: 256, events: 128, browser: 128, node: 120, issues: 16 });
const prefix = '[xiyou-cuilan-click-observation-v1]';
const text = (value, size = 256) => typeof value === 'string' ? value.slice(0, size) : null;
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const bucket = () => ({ total: 0, dropped: 0, items: [] });
function append(target, maximum, value) {
  target.total++; if (target.items.length === maximum) { target.items.shift(); target.dropped++; } target.items.push(value);
}
function location(url) { const value = new URL(url); return { origin: value.origin, path: text(value.pathname) }; }

/** 仅公共页面事件和低频元数据；不调用 evaluate、动作、等待或 Playwright 私有接口。 */
export function createCuilanClickObservation({ currentCase = () => null } = {}) {
  const report = {
    version: 1, status: 'COLLECTING', limits, pulseMs: 1000, nodeResolutionMs: 50,
    interpretation: '观测有小量调度成本；缺脉冲可能来自后台限速、页面、传输或Node延迟，不能独自证明页面卡死；不证明P05已修复。',
    pages: [], clicks: bucket(), events: bucket(), browser: bucket(), node: bucket(), issues: bucket(),
  };
  const pages = new Map(), requests = new WeakMap(); let nextClick = 0, nextRequest = 0, closed = false, sealed = false, timer, histogram, previousUtilization;
  const stamp = () => ({ receivedAt: performance.now(), receivedWallTime: Date.now(), caseId: text(currentCase(), 80) });
  function issue(stage, error) {
    if (sealed) return;
    report.status = 'PARTIAL';
    append(report.issues, limits.issues, { stage, receivedAt: performance.now(), name: text(error?.name, 80), message: text(error?.message, 256) });
  }
  function safely(stage, action) { if (!closed) { try { return action(); } catch (error) { issue(stage, error); } } }
  function record(kind, value) { if (!closed) append(report[kind], limits[kind], { ...stamp(), ...value }); }
  function closePage(page) {
    const state = pages.get(page); if (!state) return;
    pages.delete(page); state.row.closedAt = performance.now();
    for (const remove of state.remove) { try { remove(); } catch (error) { issue('detach-page', error); } }
  }
  try {
    histogram = monitorEventLoopDelay({ resolution: 50 }); histogram.enable(); previousUtilization = performance.eventLoopUtilization();
    timer = setInterval(() => safely('node-sample', () => {
      const current = performance.eventLoopUtilization(), delta = performance.eventLoopUtilization(current, previousUtilization); previousUtilization = current;
      record('node', { count: histogram.count, maxMs: histogram.count ? histogram.max / 1e6 : null, meanMs: histogram.count ? histogram.mean / 1e6 : null,
        p99Ms: histogram.count ? histogram.percentile(99) / 1e6 : null, utilization: delta.utilization, activeMs: delta.active, idleMs: delta.idle });
      histogram.reset();
    }), 1000); timer.unref?.();
  } catch (error) { issue('node-monitor', error); }

  async function attach(page, pageId) {
    if (closed || pages.has(page)) return;
    if (report.pages.length >= limits.pages) { issue('page-limit', new Error('超过有限页数，仅停止新增该页观测')); return; }
    const row = { pageId: text(pageId, 80), installation: 'pending', pulsesReceived: 0 }, state = { row, remove: [] };
    report.pages.push(row); pages.set(page, state);
    function observe(event, listener) {
      const handle = (...args) => safely('page:' + event, () => listener(...args));
      page.on(event, handle); state.remove.push(() => page.off(event, handle));
    }
    function navigation(request) {
      if (!request.isNavigationRequest() || request.resourceType() !== 'document' || request.frame() !== page.mainFrame()) return null;
      if (!requests.has(request)) requests.set(request, ++nextRequest);
      return { requestId: requests.get(request), ...location(request.url()), method: text(request.method(), 16) };
    }
    try {
      state.remove.push(observeSelectionClicks(page, event => safely('click-hook', () => {
        const clickId = event.phase === 'called' ? ++nextClick : event.clickId;
        record('clicks', { pageId: row.pageId, clickId, phase: event.phase,
          ...(event.phase === 'called' ? { reference: text(event.reference), branch: text(event.branch, 32) } : {}),
          ...(event.phase === 'threw' ? { error: { name: text(event.error?.name, 80), message: text(event.error?.message, 512) } } : {}) });
        return clickId;
      })));
      observe('request', request => { const nav = navigation(request); if (nav) record('events', { pageId: row.pageId, event: 'document-request', ...nav }); });
      observe('response', response => { const nav = navigation(response.request()); if (nav) record('events', { pageId: row.pageId, event: 'document-response', ...nav, status: response.status() }); });
      observe('requestfailed', request => { const nav = navigation(request); if (nav) record('events', { pageId: row.pageId, event: 'document-requestfailed', ...nav, error: text(request.failure()?.errorText) }); });
      observe('framenavigated', frame => { if (frame === page.mainFrame()) record('events', { pageId: row.pageId, event: 'main-frame-navigated', ...location(frame.url()) }); });
      for (const event of ['domcontentloaded', 'load', 'crash']) observe(event, () => record('events', { pageId: row.pageId, event, ...location(page.url()) }));
      observe('close', () => { record('events', { pageId: row.pageId, event: 'close' }); closePage(page); });
      observe('console', message => {
        if (message.type() !== 'debug') return;
        const raw = message.text(); if (!raw.startsWith(prefix)) return;
        if (raw.length > 4096) throw new Error('浏览器观测消息超过4096字符，不读取内容');
        const value = JSON.parse(raw.slice(prefix.length));
        const produced = { timeOrigin: number(value.timeOrigin), at: number(value.at), wallTime: number(value.wallTime), visibility: text(value.visibility, 24), readyState: text(value.readyState, 24) };
        if ([produced.timeOrigin, produced.at, produced.wallTime].includes(null)) throw new Error('浏览器观测时钟缺失');
        if (value.kind === 'pulse') {
          const longTasks = value.longTasks;
          record('browser', { pageId: row.pageId, produced, longTaskSupport: text(value.longTaskSupport, 24), longTasks: {
            count: number(longTasks?.count), totalDuration: number(longTasks?.totalDuration), maxDuration: number(longTasks?.maxDuration),
            recent: Array.isArray(longTasks?.recent) ? longTasks.recent.slice(-8).map(task => ({ startTime: number(task.startTime), duration: number(task.duration) })) : [],
          } }); row.pulsesReceived++;
          row.longTaskSupport = text(value.longTaskSupport, 24);
          if (row.longTaskSupport !== 'supported' && !state.longTaskIssue) {
            state.longTaskIssue = true; issue('browser-longtask', new Error('该页 longtask 观察不可用或发生错误，脉冲仍按实际记录'));
          }
        } else if (value.kind === 'event' && ['document-start', 'DOMContentLoaded', 'load', 'pageshow', 'pagehide', 'visibilitychange', 'trusted-object-click'].includes(value.event)) {
          record('events', { pageId: row.pageId, event: 'browser:' + value.event, produced, ...(value.event === 'trusted-object-click' ? { ariaPressedAtCapture: value.ariaPressed === 'true' ? true : value.ariaPressed === 'false' ? false : null } : {}) });
        }
      });
      // 首次 goto 前的一次准备注册；点击附近不执行 RPC、额外等待或页内读取。
      await page.addInitScript(browserObservation, { prefix, pulseMs: 1000 });
      if (!closed && pages.has(page)) row.installation = 'registered';
    } catch (error) { if (!closed) { row.installation = 'failed'; issue('page-installation', error); } }
  }
  function close() {
    if (closed) return;
    closed = true; clearInterval(timer);
    try { histogram?.disable(); } catch (error) { issue('node-monitor-close', error); }
    for (const page of pages.keys()) closePage(page);
    report.closedAt = performance.now(); report.closedWallTime = Date.now();
    report.status = report.issues.total ? 'PARTIAL' : report.pages.length ? 'COLLECTED' : 'UNAVAILABLE'; sealed = true;
  }
  return { report, attach, close };
}

/** addInitScript 的独立函数：只读文档事件，不创建页面动作或虚构呈现。 */
function browserObservation({ prefix, pulseMs }) {
  if (window.top !== window) return;
  const debug = console.debug.bind(console);
  let longTaskSupport = 'unsupported', count = 0, totalDuration = 0, maxDuration = 0, recent = [];
  function emit(value) {
    try { debug(prefix + JSON.stringify({ timeOrigin: performance.timeOrigin, at: performance.now(), wallTime: Date.now(), visibility: document.visibilityState, readyState: document.readyState, ...value })); } catch { /* 观测输出不能影响页面事件。 */ }
  }
  try {
    if (typeof PerformanceObserver === 'function' && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      const observer = new PerformanceObserver(list => {
        try { for (const task of list.getEntries()) {
          if (!Number.isFinite(task.startTime) || !Number.isFinite(task.duration)) continue;
          count++; totalDuration += task.duration; maxDuration = Math.max(maxDuration, task.duration);
          if (recent.length === 8) recent.shift(); recent.push({ startTime: task.startTime, duration: task.duration });
        } } catch { longTaskSupport = 'error'; }
      });
      observer.observe({ type: 'longtask', buffered: true }); longTaskSupport = 'supported';
    }
  } catch { longTaskSupport = 'error'; }
  for (const event of ['DOMContentLoaded', 'visibilitychange']) document.addEventListener(event, () => emit({ kind: 'event', event }), { passive: true });
  for (const event of ['load', 'pageshow', 'pagehide']) window.addEventListener(event, () => emit({ kind: 'event', event }), { passive: true });
  document.addEventListener('click', event => {
    try { const button = event.isTrusted && event.target?.closest?.('.spatial-object-list button');
      if (button) emit({ kind: 'event', event: 'trusted-object-click', ariaPressed: button.getAttribute('aria-pressed') });
    } catch { /* 观察不截断原事件传播。 */ }
  }, { capture: true, passive: true });
  emit({ kind: 'event', event: 'document-start' });
  setInterval(() => {
    emit({ kind: 'pulse', longTaskSupport, longTasks: { count, totalDuration, maxDuration, recent } });
    count = 0; totalDuration = 0; maxDuration = 0; recent = [];
  }, pulseMs);
}
