/** Node/Page共用的同步有限账本；热端不序列化、clone或安排额外任务。 */
import { SCHEMA } from './schema.mjs';

export const isObject = value => value !== null && (typeof value === 'object' || typeof value === 'function');
export function ownData(value, name) {
  if (!isObject(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : undefined;
}
export const sameDescriptor = (a, b) => a === b || Boolean(a && b
  && ['value', 'get', 'set', 'writable', 'enumerable', 'configurable']
    .every(name => (name in a) === (name in b) && a[name] === b[name]));

export function createCollector(realm, config, fixtures = {}) {
  if (!Object.hasOwn(SCHEMA.kinds, realm)
    || config.productHead !== '16099e191fdc80c52849aa1d67cd075ccca4e01e'
    || config.productTree !== '31f82d6478e2ced1d27875c75160eef626ffe0bf'
    || !['methodSHA256', 'inputSHA256', 'schemaSHA256'].every(key => /^[a-f0-9]{64}$/.test(config[key] ?? '')))
    throw Error('NSO固定身份无效');
  const limits = { ...SCHEMA.limits }, kinds = SCHEMA.kinds[realm];
  for (const [name, value] of Object.entries(fixtures.limits ?? {})) {
    if (!['maxRows', 'maxReceivers', 'maxObjects', 'rawMaxBytes'].includes(name)
      || !Number.isSafeInteger(value) || value < (name === 'rawMaxBytes' ? limits.headerReserveBytes : 1)
      || value > limits[name]) throw Error('NSO有限夹具不得放宽容量');
    limits[name] = value;
  }
  const clock = fixtures.now ?? performance.now.bind(performance);
  const raw = { format: 'NSO_RAW_V1', realm, naturalQualified: false,
    productHead: config.productHead, productTree: config.productTree,
    methodSHA256: config.methodSHA256, inputSHA256: config.inputSHA256, schemaSHA256: config.schemaSHA256,
    kinds: [...kinds], limits,
    setup: { installed: false, installedAt: null, hookCount: 0, listenerCount: 0,
      modules: [], candidates: [], coldImports: [] },
    rows: [], terminal: { stoppedAt: null, admissionClosed: null,
      seen: 0, recorded: 0, dropped: 0, returned: 0, threw: 0, notifications: 0,
      seenByKind: kinds.map(() => 0), recordedByKind: kinds.map(() => 0), droppedByKind: kinds.map(() => 0),
      objects: 0, receivers: 0, errors: [], errorCount: 0, unfinished: 0, activeOnStop: 0,
      restored: 0, restoreConflicts: 0, reservedBytes: limits.headerReserveBytes,
      serializedBytes: 0, valid: false, boundCallbacksMayRemain: true, stoppedWrappersPureDelegate: true } };
  const objects = new WeakMap(), receivers = new WeakMap(), restorers = [];
  let accepting = true, stopped = false, parent = null, active = 0, lastAt = -Infinity;
  function count(object, key) {
    if (object[key] < limits.maxCounter) object[key]++;
    else { accepting = false; raw.terminal.admissionClosed ??= 'COUNTER_CAPACITY';
      if (!raw.terminal.errors.includes('COUNTER_CAPACITY') && raw.terminal.errors.length < limits.maxErrorCodes)
        raw.terminal.errors.push('COUNTER_CAPACITY'); }
  }
  function fail(code) {
    if (stopped) return;
    count(raw.terminal, 'errorCount');
    if (typeof code !== 'string' || !/^[A-Z_]{1,64}$/.test(code)) code = 'UNKNOWN_ERROR';
    if (!raw.terminal.errors.includes(code) && raw.terminal.errors.length < limits.maxErrorCodes) raw.terminal.errors.push(code);
    accepting = false; raw.terminal.admissionClosed ??= code;
  }
  function safe(work, code = 'OBSERVER_EXCEPTION') { try { return work(); } catch { fail(code); return null; } }
  function stamp() {
    const value = clock();
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER || value < lastAt)
      throw Error('NSO单调时钟无效');
    lastAt = value; return value;
  }
  const integer = value => Number.isSafeInteger(value) && value >= 0 && value <= limits.maxCounter ? value : null;
  function text(value) {
    if (typeof value !== 'string') return null;
    if (value.length > limits.maxStringCodeUnits) { fail('FIELD_CAPACITY'); return null; }
    return value;
  }
  function decimal(value) {
    const result = text(value);
    return result !== null && /^(0|[1-9][0-9]{0,127})$/.test(result) ? result : null;
  }
  function identity(map, value, name, bound) {
    if (!isObject(value)) return null;
    if (!map.has(value)) {
      if (raw.terminal[name] >= bound) { fail('IDENTITY_CAPACITY'); return null; }
      map.set(value, ++raw.terminal[name]);
    }
    return map.get(value);
  }
  const objectId = value => identity(objects, value, 'objects', limits.maxObjects);
  const receiverId = value => identity(receivers, value, 'receivers', limits.maxReceivers);
  const charge = row => 3 + row.reduce((sum, value) => sum +
    (typeof value === 'string' ? Math.max(32, 6 * value.length + 3) : 32), 0);
  function dropped(kind) { count(raw.terminal, 'dropped'); count(raw.terminal.droppedByKind, kind); }
  function begin(kind, receiver, args, fields) {
    count(raw.terminal, 'seen'); count(raw.terminal.seenByKind, kind);
    let admitted = false;
    try {
      if (!accepting || raw.rows.length >= limits.maxRows) { fail('ROW_CAPACITY'); return null; }
      const row = [raw.rows.length + 1, kind, parent, null, stamp(), null, null, null, integer(args.length), 0, 0, null, null];
      const extracted = fields(receiver, args);
      row.push(...extracted.tail);
      if (row.length !== SCHEMA.common.length + SCHEMA.tails[kinds[kind]].length
        || row.some(value => value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean'))
        throw Error('NSO行结构无效');
      const reserved = charge(row);
      if (!accepting || reserved > limits.rawMaxBytes - raw.terminal.reservedBytes) { fail('RAW_CAPACITY'); return null; }
      row[3] = receiverId(receiver);
      for (const [index, value] of extracted.references ?? []) row[SCHEMA.common.length + index] = objectId(value);
      if (!accepting) return null;
      raw.terminal.reservedBytes += reserved;
      raw.rows.push(row); count(raw.terminal, 'recorded'); count(raw.terminal.recordedByKind, kind); admitted = true;
      return row;
    } finally { if (!admitted) dropped(kind); }
  }
  function finish(row, result, threw, thrown, outcome = threw ? 2 : 1) {
    if (!row || stopped) return;
    row[6] = stamp(); row[9] = outcome;
    const code = SCHEMA.enums.result.indexOf(result); row[10] = code < 0 ? 0 : code;
    row[11] = objectId(result); row[12] = objectId(thrown);
    count(raw.terminal, outcome === 3 ? 'notifications' : threw ? 'threw' : 'returned'); row[7] = stamp();
  }
  function observe(kind, original, fields) {
    if (!Number.isInteger(kind) || kind < 0 || kind >= kinds.length || typeof original !== 'function') throw Error('NSO包装入口无效');
    return function (...args) {
      // 包括早期已绑定的wrapper：封口后第一分支纯委托，不再计时/反射/记账。
      if (!accepting || stopped) return Reflect.apply(original, this, args);
      const row = safe(() => begin(kind, this, args, fields));
      const prior = parent; if (row) parent = row[0]; active++;
      let result, thrown, threw = false;
      if (row) safe(() => { row[5] = stamp(); });
      try { result = Reflect.apply(original, this, args); return result; }
      catch (error) { threw = true; thrown = error; throw error; }
      finally { safe(() => finish(row, result, threw, thrown)); active--; parent = prior; }
    };
  }
  function notification(kind, receiver, args, fields) {
    if (!accepting || stopped) return;
    safe(() => { const row = begin(kind, receiver, args, fields); if (row) { row[5] = row[4]; finish(row, undefined, false, undefined, 3); } });
  }
  function addRestore(restore) {
    if (restorers.length >= limits.maxRestorers || typeof restore !== 'function') throw Error('NSO恢复槽超过固定界');
    restorers.push(restore);
  }
  function patch(prototype, name, kind, fields) {
    const original = Object.getOwnPropertyDescriptor(prototype, name);
    if (!original || original.get || original.set || !original.configurable || typeof original.value !== 'function') throw Error('NSO原方法描述符无效');
    const installed = { ...original, value: observe(kind, original.value, fields) };
    addRestore(() => {
      const current = Object.getOwnPropertyDescriptor(prototype, name);
      if (!sameDescriptor(current, original)) {
        if (!sameDescriptor(current, installed)) return false;
        Object.defineProperty(prototype, name, original);
      }
      return sameDescriptor(Object.getOwnPropertyDescriptor(prototype, name), original);
    });
    Object.defineProperty(prototype, name, installed);
    if (!sameDescriptor(Object.getOwnPropertyDescriptor(prototype, name), installed)) throw Error('NSO安装描述符不符');
    raw.setup.hookCount++;
    return installed.value;
  }
  function stop() {
    if (stopped) return raw;
    accepting = false;
    // stop期间仍允许固定错误记账，最后封口后不再变更raw。
    raw.terminal.stoppedAt = safe(stamp, 'STOP_CLOCK_ERROR'); raw.terminal.activeOnStop = active;
    for (let index = restorers.length - 1; index >= 0; index--) {
      let restored = false; try { restored = restorers[index]() === true; } catch { fail('RESTORE_EXCEPTION'); }
      if (restored) count(raw.terminal, 'restored'); else { count(raw.terminal, 'restoreConflicts'); fail('RESTORE_CONFLICT'); }
    }
    raw.terminal.unfinished = raw.rows.filter(row => row[9] === 0).length;
    raw.terminal.valid = raw.setup.installed && !raw.terminal.admissionClosed && !raw.terminal.errorCount
      && !raw.terminal.unfinished && active === 0 && !raw.terminal.restoreConflicts
      && raw.terminal.seen === raw.terminal.recorded + raw.terminal.dropped;
    // 仅冷端序列化，数字自身位数用有界固定点收束。
    let settled = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      const bytes = new TextEncoder().encode(JSON.stringify(raw) + '\n').length;
      if (bytes === raw.terminal.serializedBytes) { settled = true; break; }
      raw.terminal.serializedBytes = bytes;
    }
    if (!settled || raw.terminal.serializedBytes > raw.terminal.reservedBytes || raw.terminal.reservedBytes > limits.rawMaxBytes) {
      raw.terminal.valid = false; fail('SERIALIZED_CAPACITY');
      for (let attempt = 0; attempt < 4; attempt++) {
        const bytes = new TextEncoder().encode(JSON.stringify(raw) + '\n').length;
        if (bytes === raw.terminal.serializedBytes) break;
        raw.terminal.serializedBytes = bytes;
      }
    }
    stopped = true; return raw;
  }
  return { raw, limits, kinds, safe, fail, stamp, integer, text, decimal, observe, notification, addRestore, patch, stop,
    accepting: () => accepting && !stopped,
    installed() { raw.setup.installed = true; raw.setup.installedAt = stamp(); } };
}
