import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { types } from 'node:util';
import { gaolaoPersonalProfile, validateSpatial } from '../../protocol/spatial.mjs';
import { contentDigest } from '../../content/index.mjs';
import { until } from './network-support.mjs';
import { snapshot, clientState, selectObject, openReading, waitHumanReceipt } from './gaolao-real-support.mjs';
import { assertBothActiveEffects, assertSharedStopTransaction, assertOriginalReceiptRead } from '../../backend/test-support/personal-shared-effects.mjs';

export const productionProfile = 'production-cuilan-v1';
export const caseIds = Object.freeze(['P-01', 'P-02', 'P-03', 'P-04', 'P-05', 'P-06']);

const omittedJSONValue = Symbol('omitted JSON value');
function jsonValue(value, key) {
  if (value !== null && ['object', 'function', 'bigint'].includes(typeof value)) {
    const toJSON = value.toJSON; if (typeof toJSON === 'function') value = toJSON.call(value, key);
  }
  // 原始字段占报告绝大多数；仅对象需要包装类型检查，toJSON 仍先且只调用一次。
  if (value !== null && typeof value === 'object') {
    if (types.isNumberObject(value)) value = +value;
    else if (types.isStringObject(value)) value = String(value);
    else if (types.isBooleanObject(value)) value = Boolean.prototype.valueOf.call(value);
    else if (types.isBigIntObject(value)) value = BigInt.prototype.valueOf.call(value);
  }
  if (typeof value === 'bigint') throw new TypeError('Do not know how to serialize a BigInt');
  return ['undefined', 'function', 'symbol'].includes(typeof value) ? omittedJSONValue : value;
}
function* jsonStringParts(value, quoted = true) {
  if (quoted) yield '"';
  for (let start = 0; start < value.length;) {
    let end = Math.min(start + 8192, value.length);
    // 不拆开合法 UTF-16 代理对，否则分段 stringify/UTF-8 编码会改变原值。
    if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1]) && /[\uDC00-\uDFFF]/.test(value[end])) end--;
    const part = value.slice(start, end); yield quoted ? JSON.stringify(part).slice(1, -1) : part; start = end;
  }
  if (quoted) yield '"';
}
function* jsonParts(value, depth, ancestors, indentation) {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') { yield JSON.stringify(value); return; }
  if (typeof value === 'string') {
    if (value.length <= 8192) yield JSON.stringify(value);
    else yield* jsonStringParts(value);
    return;
  }
  if (JSON.isRawJSON?.(value)) { yield* jsonStringParts(value.rawJSON, false); return; }
  if (ancestors.has(value)) throw new TypeError('Converting circular structure to JSON');
  ancestors.add(value);
  try {
    const array = Array.isArray(value), keys = array ? undefined : Object.keys(value), length = array ? value.length : keys.length;
    const currentIndent = indentation[depth] ??= '  '.repeat(depth), childIndent = indentation[depth + 1] ??= currentIndent + '  ';
    yield array ? '[' : '{'; let first = true;
    for (let index = 0; index < length; index++) {
      const key = array ? String(index) : keys[index], child = jsonValue(value[key], key);
      if (!array && child === omittedJSONValue) continue;
      yield (first ? '\n' : ',\n') + childIndent; first = false;
      if (!array) {
        if (key.length <= 8192) yield JSON.stringify(key) + ': ';
        else { yield* jsonStringParts(key); yield ': '; }
      }
      yield* jsonParts(child === omittedJSONValue ? null : child, depth + 1, ancestors, indentation);
    }
    if (!first) yield '\n' + currentIndent;
    yield array ? ']' : '}';
  } finally { ancestors.delete(value); }
}
function* reportJSONChunks(report, chunkBytes) {
  const value = jsonValue(report, '');
  if (value === omittedJSONValue) throw new TypeError('报告根值必须可序列化为 JSON');
  // 先有界合并文本，再做 UTF-8 编码；避免每个标点、缩进和短字段都分配 Buffer。
  // 仅按完整文本片段合并，不拆 UTF-16 代理对；长字符串本身仍分段转义。
  function* encoded() {
    let parts = [], characters = 0;
    for (const part of (function* () { yield* jsonParts(value, 0, new Set(), ['']); yield '\n'; })()) {
      parts.push(part); characters += part.length;
      if (characters >= chunkBytes) { yield Buffer.from(parts.join('')); parts = []; characters = 0; }
    }
    if (parts.length) yield Buffer.from(parts.join(''));
  }
  let chunk = Buffer.allocUnsafe(chunkBytes), bytes = 0;
  for (const buffer of encoded()) {
    for (let start = 0; start < buffer.length;) {
      const length = Math.min(chunkBytes - bytes, buffer.length - start);
      buffer.copy(chunk, bytes, start, start + length); bytes += length; start += length;
      if (bytes === chunkBytes) { yield chunk; chunk = Buffer.allocUnsafe(chunkBytes); bytes = 0; }
    }
  }
  if (bytes) yield chunk.subarray(0, bytes);
}

/** 完整保留原 JSON 格式和值；任意数组/对象都逐项写出，不把历史事件拼成一个 V8 字符串。 */
export async function saveCuilanReportJSON(path, report, { chunkBytes = 65536, signal } = {}) {
  assert.ok(Number.isSafeInteger(chunkBytes) && chunkBytes > 0 && chunkBytes <= 65536, '报告写入块必须有界');
  signal?.throwIfAborted();
  await mkdir(dirname(path), { recursive: true });
  signal?.throwIfAborted();
  const temporary = path + '.tmp-' + crypto.randomUUID(), hash = createHash('sha256'); let bytes = 0;
  function* chunks() { for (const chunk of reportJSONChunks(report, chunkBytes)) { bytes += chunk.length; hash.update(chunk); yield chunk; } }
  try {
    await pipeline(Readable.from(chunks(), { objectMode: false }), createWriteStream(temporary, { flags: 'wx' }), { signal });
    signal?.throwIfAborted();
    await rename(temporary, path);
    return { bytes, sha256: hash.digest('hex') };
  } finally { await rm(temporary, { force: true }); }
}

/** 停止新采集后排空已经开始的异步读取；不改变产品网络请求或回包。 */
export function createCuilanReportCollector(onError, { drainTimeoutMs = 15000 } = {}) {
  const pending = new Set(), detach = new Set(); let stoppedAt;
  function observe(target, event, listener) {
    if (stoppedAt) return target;
    function handler(...args) {
      if (stoppedAt) return;
      try {
        const result = listener.apply(this, args);
        if (result && typeof result.then === 'function') {
          const task = Promise.resolve(result).catch(onError).finally(() => pending.delete(task)); pending.add(task);
        }
      } catch (error) { onError(error); }
    }
    target.on(event, handler); detach.add(() => target.off(event, handler)); return target;
  }
  async function stop() {
    stoppedAt ??= new Date().toISOString();
    for (const remove of detach) { try { remove(); } catch (error) { onError(error); } } detach.clear();
    let timer;
    try {
      await Promise.race([Promise.all([...pending]), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('证据采集排空超时，不能把仍变化的数据保存为完整报告')), drainTimeoutMs); })]);
    } finally { clearTimeout(timer); }
    return { stoppedAt, drainedAt: new Date().toISOString(), pending: pending.size };
  }
  return { observe, stop };
}
function freezeCollectedReport(report) {
  const seen = new WeakSet();
  function freeze(value) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value); for (const child of Object.values(value)) freeze(child); Object.freeze(value);
  }
  for (const [key, value] of Object.entries(report)) if (!['cleanup', 'evidenceErrors'].includes(key)) freeze(value);
}

/** 保存和清场各自留真实结果；首份保存失败也不能跳过清理或 sourceEnd。 */
export async function finalizeCuilanReport({ report, output, restorers = [], stopCollecting, resources, readSource, audit, save = saveCuilanReportJSON, saveTimeoutMs = 120000, diagnostic = value => console.error(JSON.stringify(value)) }) {
  report.cleanup ??= []; report.evidenceErrors ??= [];
  const saves = []; let sealed = false;
  const fail = (stage, error) => { report.assessment = 'FAIL'; report.evidenceErrors.push({ stage, message: error.message, stack: error.stack }); };
  async function seal() { report.collectionCutoff = await stopCollecting(); freezeCollectedReport(report); sealed = true; }
  async function saveReport(file) {
    const controller = new AbortController(); let timer;
    try {
      assert.ok(Number.isSafeInteger(saveTimeoutMs) && saveTimeoutMs > 0, '报告保存必须有明确期限');
      const expired = new Promise((_, reject) => {
        timer = setTimeout(() => { const error = new Error(`完整报告保存超时（${saveTimeoutMs} ms）`); controller.abort(error); reject(error); }, saveTimeoutMs);
      });
      // 期限同时取消实际流；不能只停止等待而让旧写入继续 rename。
      const result = await Promise.race([save(output + '/' + file, report, { signal: controller.signal }), expired]);
      saves.push({ file, status: 'PASS', ...result });
    } catch (error) { fail('save:' + file, error); saves.push({ file, status: 'FAIL', aborted: controller.signal.aborted }); }
    finally { clearTimeout(timer); }
  }
  try {
    for (const [index, restore] of [...restorers].entries()) { try { await restore.close(); } catch (error) { fail('restore:' + index, error); } }
    try { await seal(); } catch (error) { fail('stop-collection', error); }
    if (sealed) await saveReport('result-before-cleanup.json');
  } finally {
    for (const [name, created, close] of resources) {
      if (!created) { report.cleanup.push({ name, status: 'NOT_CREATED' }); continue; }
      try { await close(); report.cleanup.push({ name, status: 'PASS' }); }
      catch (error) { report.cleanup.push({ name, status: 'FAIL', error: error.message }); fail('cleanup:' + name, error); }
    }
    report.resourcesClosed = report.cleanup.every(row => ['PASS', 'NOT_CREATED'].includes(row.status)); report.finishedAt = new Date().toISOString();
    try { report.sourceEnd = await readSource(); } catch (error) { report.sourceEndError = { message: error.message, stack: error.stack }; fail('sourceEnd', error); }
    // 若先前排空超时，关闭浏览器后再有界排空；未封存的数据绝不能边变化边保存或判 PASS。
    if (!sealed) { try { await seal(); } catch (error) { fail('stop-collection-after-cleanup', error); } }
    try { await audit(); } catch (error) { report.finalAuditError = error.stack; fail('final-audit', error); }
    if (report.evidenceErrors.length) report.assessment = 'FAIL';
    if (sealed) await saveReport('result.json');
    diagnostic({ type: 'cuilan-report-finalization', assessment: report.assessment, source: report.source, sourceEnd: report.sourceEnd, sourceEndError: report.sourceEndError, cleanup: report.cleanup, evidenceErrors: report.evidenceErrors, collectionSealed: sealed, completeReportSaved: saves.some(row => row.file === 'result.json' && row.status === 'PASS'), saves });
  }
}

/** 只允许完整真实候选报告通过；单元替身和编写阶段不能借此升级成 E2。 */
export function assertCompleteReport(report) {
  assert.equal(report.executionKind, 'production_browser');
  assert.equal(report.source.status, '');
  assert.deepEqual(report.sourceEnd, report.source);
  assert.equal(report.realProviderCalls, 0);
  assert.equal(report.pageErrors.length, 0);
  assert.equal(report.externalRequests.length, 0);
  assert.ok(report.humanActions.length > 0 && report.npcActions.length > 0 && report.wireActions.length > 0, '须保留实际UI、受控角色与原始网络动作');
  for (const room of report.rooms) {
    assert.equal(room.audited, true);
    const trace = report.authority.find(row => row.sessionId === room.sessionId);
    assert.ok(trace?.humanActionCount > 0 && trace.receipts.length > 0 && trace.sceneIntents.length > 0 && trace.worldEvents.length > 0, '须保留同房间真实Intent/Receipt/PG事件');
  }
  for (const id of caseIds) assert.ok(report.cases.some(row => row.id === id && row.status === 'PASS' && row.evidence.length > 0), '缺少实际样本：' + id);
  for (const row of report.cases) assert.equal(row.status, 'PASS', '不以其它样本通过掩盖未执行/失败：' + row.id);
  for (const contentVersion of ['gaolaozhuang-scene-v3', 'gaolaozhuang-tools-east-scene-v3']) {
    assert.ok(report.rooms.some(room => room.contentVersion === contentVersion && room.count === 2 && room.profile === productionProfile && room.audited), '两内容变体均须有真实两人证据');
  }
  assert.ok(report.rooms.some(room => room.defaultEntry && room.contentVersion === 'gaolaozhuang-scene-v3'));
  assert.equal(report.leaseFault.status, 'PASS');
  const shared = report.leaseFault.sharedEffects;
  assertBothActiveEffects(shared.before); assertSharedStopTransaction(shared.before, shared.firstStop);
  assert.equal(shared.applyReceipt.status, 'Accepted');
  assertOriginalReceiptRead(shared.receiptRead.original, shared.receiptRead.actual, shared.receiptRead.transaction);
  assert.notEqual(shared.reconnected.oldView, shared.reconnected.newView);
  assert.equal(shared.reconnected.remaining.returnContextId, shared.before.held.acquisition.acquisitionId);
  assert.equal(shared.reconnected.remaining.mode, 'return_only');
  assert.equal(shared.reconnected.acquisition.outcome, 'delivered_to_owner');
  assert.equal(shared.reconnected.returned.receipt.status, 'Accepted');
  assert.equal(shared.reconnected.c2.length, 2);
  for (const purpose of ['appearance', 'private_items']) assert.ok(shared.reconnected.c2.some(row => row.request.action.consentId === shared.before.purposes[purpose].consent.consentId && row.request.action.kind === 'withdraw_consent' && row.receipt.publicReceipt.status === 'Accepted' && row.execution_context.mode === 'scene-policy'));
  assert.equal(report.resources.length, 65);
  assert.equal(report.resourcesClosed, true);
  assert.ok(report.cleanup.every(row => row.status === 'PASS'));
}

export async function clickAction(room, player, label, expected, click, { deferReceipt = false } = {}) {
  const page = room.pages[player], previous = (await clientState(page)).actions.map(action => action.id);
  await click(page);
  const draft = await until(async () => (await clientState(page)).actions.find(row => {
    if (previous.includes(row.id)) return false;
    const action = JSON.parse(row.raw).action;
    return action.kind === expected.kind && (expected.operationId === undefined || action.operationId === expected.operationId);
  }), '正常控件实际发出原动作');
  const request = validateSpatial('PublicEnvelope', JSON.parse(draft.raw));
  assert.equal(request.sessionId, room.sessionId);
  const complete = async () => {
    const receipt = await waitHumanReceipt(page, previous, { ...expected, clientActionId: request.clientActionId }, room.report, player, label);
    const record = room.report.humanActions.findLast(row => row.request.sessionId === room.sessionId && row.request.clientActionId === request.clientActionId && row.player === player);
    assert.ok(record);
    await until(async () => BigInt((await snapshot(page)).snapshotSeq) >= BigInt(receipt.observedSeq), '当前投影达到实际请求提交水位');
    return { ...record, receipt };
  };
  return deferReceipt ? { request, complete } : complete();
}

export async function selectCuilan(room, player) {
  const person = await room.entity(player, '翠兰');
  await selectObject(room.pages[player], person.entityRef);
  const area = room.pages[player].locator('.gaolao-interaction');
  const approach = room.pages[player].locator('.spatial-sidebar.hud-card-collapsed').getByRole('button', { name: '走近并查看', exact: true });
  if (await approach.isVisible()) {
    await clickAction(room, player, '走近并查看本人', { kind: 'inspect' }, () => approach.click());
  }
  await area.waitFor();
  return area;
}

export async function askAppearance(room, player, destinationId, permissionTerm, { replace = false } = {}) {
  const area = await selectCuilan(room, player);
  await area.locator('#gaolao-meeting-destination').selectOption(destinationId);
  await area.locator('#gaolao-appearance-term').selectOption(permissionTerm);
  if (replace) await area.getByRole('checkbox', { name: '明确替换我仍开放的借貌请求', exact: true }).check();
  const label = replace ? '替换并提出借貌询问' : '提出借貌询问';
  const result = await clickAction(room, player, label, { kind: 'interact', operationId: 'gz-request-appearance' }, () => area.getByRole('button', { name: label, exact: true }).click());
  assert.equal(result.request.action.parameters.destinationId, destinationId);
  assert.equal(result.request.action.parameters.permissionTerm, permissionTerm);
  assert.equal(Object.hasOwn(result.request.action.parameters, 'replacement'), replace);
  return result;
}

export async function describeItems(room, player) {
  const area = await selectCuilan(room, player);
  const result = await clickAction(room, player, '本人说明私物清单', { kind: 'interact', operationId: 'gz-describe-private-items' }, () => area.getByRole('button', { name: /^(请本人说明私物清单|重新询问私物清单)$/ }).click());
  assert.equal(result.receipt.status, 'Accepted');
  const offer = await until(async () => (await snapshot(room.pages[player])).projection.chapter.privateItemOffers[0], '实际目录到达当前玩家');
  assert.equal(offer.options.length, 2);
  for (const option of offer.options) assert.deepEqual(Object.keys(option).sort(), ['handling', 'label', 'optionRef']);
  return offer;
}

export async function askItems(room, player, labels, permissionTerm, { replace = false, deferReceipt = false } = {}) {
  const area = await selectCuilan(room, player);
  const offer = (await snapshot(room.pages[player])).projection.chapter.privateItemOffers[0];
  assert.ok(offer, '须先经正常按钮取得本人目录');
  for (const option of offer.options) await area.getByRole('checkbox', { name: option.label, exact: true }).setChecked(labels.includes(option.label));
  await area.locator('#gaolao-private-term').selectOption(permissionTerm);
  if (replace) await area.getByRole('checkbox', { name: '明确替换我仍开放的私物请求', exact: true }).check();
  const label = replace ? '替换并提出私物取送询问' : '提出私物取送询问';
  const result = await clickAction(room, player, label, { kind: 'interact', operationId: 'gz-request-private-items' }, () => area.getByRole('button', { name: label, exact: true }).click(), { deferReceipt });
  assert.equal(result.request.action.parameters.offerRef, offer.offerRef);
  assert.deepEqual(result.request.action.parameters.itemOptionRefs.slice().sort(), offer.options.filter(option => labels.includes(option.label)).map(option => option.optionRef).sort());
  assert.equal(result.request.action.parameters.permissionTerm, permissionTerm);
  assert.equal(Object.hasOwn(result.request.action.parameters, 'replacement'), replace);
  return result;
}

export async function personalState(room, player, purpose, status, { differentFrom = null } = {}) {
  return until(async () => {
    const projection = (await snapshot(room.pages[player])).projection;
    const request = projection.chapter.personalRequests.find(request => request.purpose === purpose);
    const consent = projection.chapter.consents.find(consent => consent.consentId === request?.consentId);
    return request && consent?.status === status && consent.consentId !== differentFrom ? { request, consent } : false;
  }, `生产本人 ${purpose} 实际 ${status}`, 20000);
}

export async function cancelPersonal(room, player, purpose) {
  await openReading(room.pages[player], '进展');
  const card = room.pages[player].locator(`[data-personal-purpose="${purpose}"]`);
  const before = (await snapshot(room.pages[player])).projection.chapter.personalRequests.find(request => request.purpose === purpose);
  const label = purpose === 'appearance' ? '取消我的借貌请求' : '取消我的私物请求';
  const result = await clickAction(room, player, label, { kind: 'cancel_personal_request' }, () => card.getByRole('button', { name: label, exact: true }).click());
  assert.equal(result.receipt.status, 'Accepted');
  assert.equal(result.request.action.consentId, before.consentId);
  return result;
}

export async function returnItem(room, player, name, destination) {
  await openReading(room.pages[player], '行囊');
  const card = room.pages[player].locator('.spatial-inventory [data-private-return]').filter({ has: room.pages[player].getByRole('heading', { name, exact: true }) });
  assert.equal(await card.count(), 1);
  const label = `将${name}${destination === 'owner' ? '交回本人' : '放回原处'}`;
  const result = await clickAction(room, player, label, { kind: destination === 'owner' ? 'transfer_item' : 'put_item' }, () => card.getByRole('button', { name: label, exact: true }).click());
  assert.equal(result.receipt.status, 'Accepted');
  return result;
}

/** 故障只安排提交窗口；原 raw、this、返回与异常都不改写。 */
export function holdSubmissions(runtime, predicate, expectedCount = 2) {
  const original = runtime.submit, held = [];
  let release, announce;
  const barrier = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { announce = resolve; });
  runtime.submit = async function(handle, raw) {
    const request = JSON.parse(raw);
    if (held.length < expectedCount && predicate(request, handle)) {
      held.push({ request, raw });
      if (held.length === expectedCount) announce(held);
      await barrier;
    }
    return original.call(this, handle, raw);
  };
  return { ready, held, release, close() { release(); runtime.submit = original; } };
}

/** 延迟真实已提交 ACK 及其历史读取；不制造 Receipt、不再次提交。 */
export function holdCommittedReceipt(runtime, predicate) {
  const submit = runtime.submit, receipt = runtime.receipt;
  let held, release, announce;
  const barrier = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { announce = resolve; });
  runtime.submit = async function(handle, raw) {
    const request = JSON.parse(raw), result = await submit.call(this, handle, raw);
    if (!held && predicate(request)) { held = { request, raw, receipt: result, committedAt: new Date().toISOString() }; announce(held); }
    if (held?.request.sessionId === request.sessionId && held.request.clientActionId === request.clientActionId) await barrier;
    return result;
  };
  runtime.receipt = async function(token, sessionId, actionId) {
    if (held?.request.sessionId === sessionId && held.request.clientActionId === actionId) await barrier;
    return receipt.call(this, token, sessionId, actionId);
  };
  return { ready, release, get held() { return held; }, close() { release(); runtime.submit = submit; runtime.receipt = receipt; } };
}

/** 此真实墙钟故障不改 lease/epoch/世界；只丢指定连接续租并延后该房间维护。 */
export function deferLeaseMaintenance(runtime, sessionId, connectionId) {
  const heartbeat = runtime.heartbeat, maintenance = runtime.maintenance;
  const calls = { droppedHeartbeat: 0, otherHeartbeat: 0, deferredMaintenance: 0 };
  runtime.heartbeat = async function(handle) {
    if (handle.connectionId === connectionId) { calls.droppedHeartbeat++; return; }
    calls.otherHeartbeat++; return heartbeat.call(this, handle);
  };
  runtime.maintenance = async function(id) {
    if (id === sessionId) { calls.deferredMaintenance++; return; }
    return maintenance.call(this, id);
  };
  return { calls, close() { runtime.heartbeat = heartbeat; runtime.maintenance = maintenance; } };
}

export async function authoritativeState(pool, sessionId) {
  const row = (await pool.query('SELECT state,content_snapshot FROM sessions WHERE session_id=$1', [sessionId])).rows[0];
  assert.ok(row, '实际持久房间存在');
  return row;
}

export async function sceneDecision(pool, room, consentId, response) {
  return until(async () => {
    const rows = (await pool.query(`SELECT i.intent_id,i.actor_id,i.request,i.execution_context,i.scene_outcome,r.receipt
      FROM spatial_intents i JOIN action_receipts r ON r.session_id=i.session_id AND r.client_action_id=i.request->>'clientActionId' AND r.actor_id=i.actor_id
      WHERE i.session_id=$1 AND i.actor_id=$2 AND i.execution_context->>'mode'='scene-policy'`, [room.sessionId, room.content.chapterRules.people.cuilan])).rows;
    const row = rows.find(row => row.request.action.consentId === consentId && row.request.action.kind === (response === 'withdrawn' ? 'withdraw_consent' : 'respond_consent') && (response === 'withdrawn' || row.request.action.response === response) && row.receipt.publicReceipt?.status === 'Accepted');
    if (!row) return false;
    assert.equal(row.execution_context.scenePolicyBasis.policyVersion, 'gaolao-cuilan-v2');
    return row;
  }, 'PG 中生产本人原意图与实际 Receipt 对应：' + response, 20000);
}

export async function assertRoomIdentity(room, pool, { defaultEntry = false } = {}) {
  assert.equal(room.profile, productionProfile);
  assert.equal(room.actors, undefined); assert.equal(room.runtime, undefined);
  const { state, content_snapshot: content } = await authoritativeState(pool, room.sessionId);
  assert.equal(contentDigest(content), contentDigest(room.content));
  const profile = gaolaoPersonalProfile(state); assert.ok(profile, '真实持久五维版本必须精确匹配登记 v3');
  assert.equal(profile.policyVersion, content.chapterRules.sceneRolePolicies[0].policyVersion);
  assert.equal(state.contentVersion, room.content.contentVersion);
  assert.equal(new Set(room.users.map(user => user.userId)).size, room.count);
  for (const page of room.pages) {
    const current = await snapshot(page); validateSpatial('SnapshotV2', current);
    assert.equal(current.sessionId, room.sessionId);
    assert.deepEqual(gaolaoPersonalProfile(current.projection), profile);
  }
  return { sessionId: room.sessionId, count: room.count, ...profile, seed: state.seed, profile: productionProfile, contentDigest: contentDigest(content), defaultEntry, audited: false };
}
