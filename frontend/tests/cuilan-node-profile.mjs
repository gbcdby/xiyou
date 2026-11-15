import { Session } from 'node:inspector';
import { performance, PerformanceObserver } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const limits = Object.freeze({ samples: 65536, nodes: 8192, edges: 32768, bytes: 8 * 1024 * 1024, lockBytes: 2 * 1024 * 1024, packages: 8192, gc: 512, gcBatch: 128, lifecycle: 32, issues: 16, io: 4 });
const filename = 'p05-node-profile.json';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const integer = value => Number.isSafeInteger(value);
const bucket = () => ({ total: 0, dropped: 0, items: [] });
function append(target, maximum, row) { target.total++; if (target.items.length === maximum) target.items.shift(); target.items.push(row); target.dropped = target.total - target.items.length; }
function defaultNow() { const at = performance.now(), wallTime = Date.now(), afterAt = performance.now(); return { at, afterAt, wallTime, timeOrigin: performance.timeOrigin }; }

function clockBounds(profile, bounds) {
  const missing = { status: 'CLOCK_ALIGNMENT_INCONCLUSIVE', offsetMs: null, wallStatus: 'INCONCLUSIVE' };
  const points = [bounds?.start?.before, bounds?.start?.after, bounds?.stop?.before, bounds?.stop?.after];
  if (points.some(p => !p || ![p.at, p.afterAt, p.wallTime, p.timeOrigin].every(finite) || p.afterAt < p.at)) return missing;
  if (points.some((p, i) => p.timeOrigin !== points[0].timeOrigin || i && p.at < points[i - 1].at)) return missing;
  const [a, b, c, d] = points;
  const min = Math.max(a.at - profile.startTime / 1000, c.at - profile.endTime / 1000);
  const max = Math.min(b.afterAt - profile.startTime / 1000, d.afterAt - profile.endTime / 1000);
  // Date.now 的整数毫秒量化与读取前后包络；不把墙钟跳变拟合进 CPU 时间。
  const wallMin = Math.max(...points.map(p => p.wallTime - p.afterAt));
  const wallMax = Math.min(...points.map(p => p.wallTime + 1 - p.at));
  return { status: min <= max ? 'ALIGNED_WITH_BOUNDS' : missing.status, offsetMs: min <= max ? { min, max } : null,
    wallStatus: wallMin <= wallMax ? 'CONSISTENT_WITH_BOUNDS' : 'WALL_CLOCK_DISCONTINUITY',
    wallOffsetMs: wallMin <= wallMax ? { min: wallMin, max: wallMax } : null };
}

function safeFrame(frame, repository, sources, dependencies) {
  let url = '<external>', trusted = false;
  if (typeof frame?.url === 'string' && frame.url.length <= 4096) {
    if (/^node:[a-zA-Z0-9_./-]+$/.test(frame.url)) { url = frame.url; trusted = true; }
    else if (!frame.url && ['(root)', '(program)', '(idle)', '(garbage collector)'].includes(frame.functionName)) { url = ''; trusted = true; }
    else {
      try {
        const parsed = new URL(frame.url); parsed.search = ''; parsed.hash = '';
        if (parsed.protocol === 'file:') {
          const path = relative(repository, fileURLToPath(parsed)).replaceAll('\\', '/');
          const parts = path.split('/'), moduleAt = parts.lastIndexOf('node_modules');
          const packageEnd = moduleAt + (parts[moduleAt + 1]?.startsWith('@') ? 3 : 2);
          const dependency = moduleAt >= 0 && dependencies.has(parts.slice(0, packageEnd).join('/'))
            && packageEnd < parts.length && /\.(?:c?js|mjs|ts)$/.test(path);
          if (path.length <= 256 && !isAbsolute(path) && !path.split('/').includes('..') && (sources.has(path) || dependency)) { url = path; trusted = true; }
        }
      } catch { /* 非已知源码位置不输出原 URL 或函数名。 */ }
    }
  }
  if (url.length > 256) { url = '<external>'; trusted = false; }
  return { functionName: trusted && typeof frame.functionName === 'string' ? (frame.functionName.length <= 160 ? frame.functionName : '<long-name>') : '<external>', url,
    lineNumber: trusted && integer(frame.lineNumber) ? frame.lineNumber : -1, columnNumber: trusted && integer(frame.columnNumber) ? frame.columnNumber : -1 };
}

/** 只生成白名单栈信息；先核各层容量，不递归展开原对象或读源码。 */
export function normalizeCuilanCpuProfile(profile, { repository, sourcePaths = [], dependencyPaths = [], bounds } = {}) {
  try {
    if (!profile || !Array.isArray(profile.nodes) || !Array.isArray(profile.samples) || !Array.isArray(profile.timeDeltas)) return { status: 'INVALID_PROFILE' };
    const counts = { nodes: profile.nodes.length, samples: profile.samples.length, timeDeltas: profile.timeDeltas.length };
    if (counts.nodes > limits.nodes || counts.samples > limits.samples || counts.timeDeltas > limits.samples) return { status: 'CAPACITY_EXCEEDED', counts };
    if (!counts.nodes || counts.samples !== counts.timeDeltas || ![profile.startTime, profile.endTime].every(finite) || profile.endTime < profile.startTime) return { status: 'INVALID_PROFILE', counts };
    const ids = new Set(); let edges = 0;
    for (const node of profile.nodes) {
      if (!node || !integer(node.id) || node.id <= 0 || ids.has(node.id) || !node.callFrame || node.children !== undefined && !Array.isArray(node.children)) return { status: 'INVALID_PROFILE', counts };
      ids.add(node.id); edges += node.children?.length ?? 0;
      if (edges > limits.edges) return { status: 'CAPACITY_EXCEEDED', counts: { ...counts, edges } };
    }
    if (profile.samples.some(id => !ids.has(id)) || profile.timeDeltas.some(delta => !finite(delta) || delta < 0)
      || profile.nodes.some(node => node.children?.some(id => !ids.has(id)))) return { status: 'INVALID_PROFILE', counts };
    const sources = new Set(sourcePaths), dependencies = new Set(dependencyPaths), root = resolve(repository);
    const normalized = { startTime: profile.startTime, endTime: profile.endTime,
      nodes: profile.nodes.map(node => ({ id: node.id, callFrame: safeFrame(node.callFrame, root, sources, dependencies), children: node.children ? [...node.children] : [] })),
      samples: [...profile.samples], timeDeltas: [...profile.timeDeltas] };
    return { status: 'READY', counts: { ...counts, edges }, clock: clockBounds(profile, bounds), profile: normalized };
  } catch { return { status: 'INVALID_PROFILE' }; }
}

/** 单次诊断；不等待动作、修改超时、采集业务对象或向外开放 inspector。 */
export function createCuilanNodeProfile({ repository, output, sourcePaths = [], adapters = {} } = {}) {
  const now = adapters.now ?? defaultNow, makeSession = adapters.makeSession ?? (() => new Session());
  const makeGcObserver = adapters.makeGcObserver ?? (callback => new PerformanceObserver(callback));
  const setTimer = adapters.setTimer ?? setTimeout, clearTimer = adapters.clearTimer ?? clearTimeout;
  const defer = adapters.defer ?? setImmediate, write = adapters.write ?? writeFile, read = adapters.read ?? readFile;
  const report = { status: 'NOT_RUN', sampleIntervalUs: 20000, budgetMs: 600000, commandBudgetMs: 2000, limits,
    interpretation: '公共采样有开销；停采预算为软预算，CPU/墙钟仅按包络关联；不等同函数归因或P05通过。',
    lifecycle: bucket(), issues: bucket(), gc: bucket(), io: bucket(), bounds: {}, budgetOverrunMs: 0, profileStatus: 'NOT_RUN' };
  let begun = false, closing = false, sealed = false, nativeFinished = false, started = false, stopRequested = false, stopIssued = false;
  let session, gc, currentCommand, recordingTimer, rawProfile, closePromise, resolveNative;
  const timers = new Set(), nativeDone = new Promise(resolveDone => { resolveNative = resolveDone; });
  const record = (stage, extra = {}) => { if (!sealed) append(report.lifecycle, limits.lifecycle, { stage, ...now(), ...extra }); };
  const issue = (stage, reason, extra = {}) => { if (!sealed) append(report.issues, limits.issues, { stage, reason, ...now(), ...extra }); };
  function timer(callback, ms) { const handle = setTimer(() => { timers.delete(handle); callback(); }, ms); handle?.unref?.(); timers.add(handle); return handle; }
  function cancel(handle) { if (handle !== undefined) { clearTimer(handle); timers.delete(handle); } }
  function receiveGc(entries) {
    if (sealed || nativeFinished) return;
    try {
      const values = Array.isArray(entries) ? entries : entries.getEntries(), received = now();
      report.gc.total += values.length;
      for (let i = Math.max(0, values.length - limits.gcBatch); i < values.length; i++) {
        const value = values[i]; if (!finite(value.startTime) || !finite(value.duration) || value.duration < 0) continue;
        if (report.gc.items.length === limits.gc) report.gc.items.shift();
        report.gc.items.push({ startTime: value.startTime, duration: value.duration,
          kind: integer(value.detail?.kind) ? value.detail.kind : null, flags: integer(value.detail?.flags) ? value.detail.flags : null, received });
      }
      report.gc.dropped = report.gc.total - report.gc.items.length;
    } catch { issue('gc', 'READ_FAILED'); }
  }
  function finishNative(profile) {
    if (nativeFinished) return;
    try { if (gc) receiveGc(gc.takeRecords()); } catch { issue('gc-close', 'READ_FAILED'); }
    nativeFinished = true; currentCommand = null; rawProfile = profile;
    if (finite(profile?.startTime) && finite(profile?.endTime) && profile.endTime >= profile.startTime) {
      report.captureDurationMs = (profile.endTime - profile.startTime) / 1000;
      report.nativeBudgetOverrunMs = Math.max(0, report.captureDurationMs - 600000);
    }
    if (report.bounds.start?.after && report.bounds.stop?.after) report.completionBudgetOverrunMs = Math.max(0, report.bounds.stop.after.at - report.bounds.start.after.at - 600000);
    report.budgetOverrunMs = Math.max(report.budgetOverrunMs, report.nativeBudgetOverrunMs ?? 0, report.completionBudgetOverrunMs ?? 0);
    for (const handle of timers) clearTimer(handle); timers.clear();
    try { gc?.disconnect(); } catch { issue('gc-close', 'DISCONNECT_FAILED'); }
    try { session?.disconnect(); } catch { issue('inspector-close', 'DISCONNECT_FAILED'); }
    record('native-finished'); resolveNative();
  }
  function post(method, params, completed) {
    if (nativeFinished || sealed) return;
    const command = { method, before: now() }; currentCommand = command;
    record('command-called', { method });
    const timeout = timer(() => {
      if (currentCommand !== command || nativeFinished) return;
      issue(method, 'COMMAND_BUDGET_EXCEEDED', { elapsedMs: now().at - command.before.at }); finishNative();
    }, 2000);
    const callback = (error, response) => {
      if (currentCommand !== command || nativeFinished || sealed) return;
      command.after = now(); const elapsedMs = command.after.at - command.before.at;
      cancel(timeout); currentCommand = null; record('command-returned', { method, elapsedMs });
      if (method === 'Profiler.start') report.bounds.start = command;
      if (method === 'Profiler.stop') report.bounds.stop = command;
      // 同步长段之后回调可能先于逾期 timer 恢复，预算必须再按真实时钟判断。
      if (!finite(elapsedMs) || elapsedMs < 0 || elapsedMs >= 2000) {
        issue(method, elapsedMs >= 2000 ? 'COMMAND_BUDGET_EXCEEDED' : 'COMMAND_CLOCK_INVALID', { elapsedMs }); finishNative(); return;
      }
      if (error) { issue(method, 'COMMAND_FAILED'); finishNative(); return; }
      try { completed(response, command); } catch { issue(method, 'CALLBACK_FAILED'); finishNative(); }
    };
    try { session.post(method, params, callback); } catch (error) { callback(error); }
  }
  function stopNative() {
    if (nativeFinished || stopIssued) return;
    if (currentCommand) return; // 原命令 settle 或其预算收束后处理，不能遗忘在途 start。
    if (!started) { finishNative(); return; }
    stopIssued = true;
    post('Profiler.stop', {}, (response, command) => { report.bounds.stop = command; finishNative(response?.profile); });
  }
  function scheduleStop() { try { defer(stopNative); } catch { issue('stop-schedule', 'SCHEDULE_FAILED'); finishNative(); } }
  function end(reason = 'history-returned') {
    if (sealed || stopRequested) return;
    stopRequested = true; report.scopeEnd = { ...now(), reason: ['history-returned', 'history-threw', 'budget', 'runner-close'].includes(reason) ? reason : 'runner-close' };
    if (report.bounds.start) report.budgetOverrunMs = Math.max(0, report.scopeEnd.at - report.bounds.start.after.at - 600000);
    cancel(recordingTimer); record('scope-ended', { reason: report.scopeEnd.reason }); scheduleStop();
  }
  function start() {
    if (begun || closing || sealed) return;
    begun = true; report.status = 'COLLECTING'; report.scopeStart = now(); record('scope-started');
    try { gc = makeGcObserver(receiveGc); gc.observe({ entryTypes: ['gc'] }); } catch { issue('gc-start', 'UNAVAILABLE'); }
    try {
      session = makeSession(); session.connect();
      post('Profiler.enable', {}, () => {
        if (stopRequested) { finishNative(); return; }
        post('Profiler.setSamplingInterval', { interval: 20000 }, () => {
          if (stopRequested) { finishNative(); return; }
          post('Profiler.start', {}, (_response, command) => {
            started = true; report.bounds.start = command; record('profile-started');
            if (stopRequested) scheduleStop(); else recordingTimer = timer(() => end('budget'), 600000);
          });
        });
      });
    } catch { issue('inspector-start', 'UNAVAILABLE'); finishNative(); }
  }
  async function limitedIO(stage, operation) {
    const controller = new AbortController(), before = now(); let handle, expired = false, outcome = 'FAILED';
    try {
      const timeout = new Promise((_, reject) => { handle = timer(() => { expired = true; controller.abort(); reject(new Error('诊断IO预算到达')); }, 2000); });
      const value = await Promise.race([Promise.resolve().then(() => operation(controller.signal)), timeout]);
      const elapsedMs = now().at - before.at;
      if (!finite(elapsedMs) || elapsedMs < 0 || elapsedMs >= 2000) {
        expired = elapsedMs >= 2000; controller.abort(); issue(stage, expired ? 'IO_BUDGET_EXCEEDED' : 'IO_CLOCK_INVALID', { elapsedMs });
        return { ok: false };
      }
      outcome = 'SUCCEEDED'; return { ok: true, value };
    } catch { issue(stage, expired ? 'IO_BUDGET_EXCEEDED' : 'IO_FAILED'); return { ok: false }; }
    finally { cancel(handle); const after = now(); append(report.io, limits.io, { stage, before, after, elapsedMs: after.at - before.at, outcome }); }
  }
  async function lockedDependencies() {
    // 只在原流程收尾读取两份锁文件；未知/读取失败的包不进入源码白名单。
    const files = ['package-lock.json', 'frontend/package-lock.json'];
    const loaded = await limitedIO('dependency-locks', signal => Promise.all(files.map(file => read(resolve(repository, file), { encoding: 'utf8', signal }))));
    const paths = [], locks = [];
    if (loaded.ok) try {
      for (let i = 0; i < files.length; i++) {
        const text = loaded.value[i];
        if (typeof text !== 'string' || Buffer.byteLength(text) > limits.lockBytes) throw new Error('锁文件容量不符');
        const lock = JSON.parse(text), entries = lock?.packages;
        if (![2, 3].includes(lock.lockfileVersion) || !entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('锁文件结构不符');
        const keys = Object.keys(entries); if (keys.length > limits.packages) throw new Error('锁文件包数超限');
        for (const key of keys) {
          if (key.length > 256 || typeof entries[key]?.version !== 'string') continue;
          if (/^node_modules\/(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+(?:\/node_modules\/(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+)*$/.test(key)) paths.push((i ? 'frontend/' : '') + key);
        }
        locks.push({ file: files[i], sha256: createHash('sha256').update(text).digest('hex') });
      }
      report.dependencyWhitelist = { status: 'READY', packages: paths.length, locks }; return paths;
    } catch { issue('dependency-locks', 'INVALID_LOCK'); }
    report.dependencyWhitelist = { status: 'UNAVAILABLE', packages: 0 }; return [];
  }
  function close() {
    if (closePromise) return closePromise;
    closing = true;
    closePromise = (async () => {
      try {
        if (!begun) { finishNative(); return; }
        end('runner-close'); stopNative(); await nativeDone;
        record('normalization-started');
        if (!rawProfile) { report.status = 'UNAVAILABLE'; return; }
        const dependencyPaths = await lockedDependencies();
        const normalized = normalizeCuilanCpuProfile(rawProfile, { repository, sourcePaths, dependencyPaths, bounds: report.bounds }); rawProfile = undefined;
        report.profileStatus = normalized.status; report.counts = normalized.counts; report.clock = normalized.clock;
        if (normalized.status !== 'READY') { report.status = 'PARTIAL'; return; }
        const body = JSON.stringify({ version: 1, sampleIntervalUs: report.sampleIntervalUs, bounds: report.bounds, clock: normalized.clock,
          counts: normalized.counts, dependencyWhitelist: report.dependencyWhitelist, profile: normalized.profile }) + '\n';
        const bytes = Buffer.byteLength(body); record('normalization-finished', { bytes });
        if (bytes > limits.bytes) { report.profileStatus = 'CAPACITY_EXCEEDED'; report.status = 'PARTIAL'; return; }
        report.file = { name: filename, status: 'WRITING' };
        const saved = await limitedIO('profile-save', signal => write(resolve(output, filename), body, { encoding: 'utf8', flag: 'wx', signal }));
        if (saved.ok) {
          report.file = { name: filename, status: 'SAVED', bytes, sha256: createHash('sha256').update(body).digest('hex') };
        } else report.file.status = 'FAILED';
        report.status = report.issues.total || report.budgetOverrunMs ? 'PARTIAL' : 'COLLECTED';
      } catch { issue('close', 'CLOSE_FAILED'); report.status = 'PARTIAL'; }
      finally {
        rawProfile = undefined; finishNative(); record('closed'); sealed = true;
      }
    })();
    return closePromise;
  }
  return { report, start, end, close };
}
