import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';
import { startTestPostgres } from '../../backend/test-support/postgres.mjs';
import { createAuthorityServer } from '../../backend/server.mjs';
import { canonicalize } from '../../protocol/index.mjs';
import { Participant, NetworkRecorder, observeConnections, checkpoint, assertPrivateBoundary } from './network-harness.mjs';
import { repository, saveJSON, sourceIdentity, sha256, sleep, until } from './network-support.mjs';

const durationMs = Number(process.env.NETWORK_DURATION_MS || 900000);
assert.ok(Number.isFinite(durationMs) && durationMs >= 900000 && durationMs <= 1050000, '正式技术检查至少 900000 ms，不允许缩短或快进。');
const output = resolve(process.env.FRONTEND_EVIDENCE_DIR || resolve(repository, '.agent-output/frontend-network/long-run'));
await mkdir(output, { recursive: true });
const source = await sourceIdentity();
assert.equal(source.status, '', '正式长测前必须固定干净源码候选。');
const recorder = new NetworkRecorder(resolve(output, 'trace.jsonl'));
const report = { scope: '五个独立自动身份的真实前端网络类 + HTTP / Socket.IO / PostgreSQL 技术验收；不是真人、真实 AI 或完整玩法结局', startedAt: new Date().toISOString(), requestedDurationMs: durationMs, source, cases: [], checkpoints: [], databaseErrors: [], cleanup: [], resourcesClosed: false, notCovered: ['真人试玩', '供应商真实 AI', '自然玩法终局', '服务端迟到旧 disconnect / 旧 AI 回调的本轮联合注入；仅引用已释放 #6 对应证据'] };
let database, server, timerStart = null, tick = 0;
const all = []; let active = []; let sessionId; let historyObservers = [];
const mainMarkers = [];
const elapsed = () => timerStart === null ? 0 : performance.now() - timerStart;
const pass = (name, detail = {}) => { const record = { name, status: 'PASS', elapsedMs: elapsed(), ...detail }; report.cases.push(record); recorder.write('case', record); console.log(JSON.stringify({ stage: name, elapsedMs: Math.round(elapsed()), ...detail })); };
const accepted = async (person, action) => { const draft = await person.action(action); assert.equal(draft.receipt.status, 'Accepted', `${person.label}/${action.kind} 应为合法动作`); return draft; };
const stable = async label => { const result = await checkpoint({ participants: active, server, sessionId, recorder, label }); report.checkpoints.push({ label, cursor: result.cursor, comparisons: result.comparisons, stateDigest: sha256(result.state) }); return result; };
const drainOutbox = () => until(async () => Number((await database.pool.query("SELECT count(*) AS n FROM outbox WHERE session_id=$1 AND status='Pending'", [sessionId])).rows[0].n) === 0, '已提交 outbox 发布收束');
const moveTo = async (person, regionId) => { if (person.client.state.snapshot.projection.self.regionId !== regionId) { await accepted(person, { kind: 'move', regionId }); await until(() => person.client.state.snapshot?.projection.self.regionId === regionId, `${person.label} 到达 ${regionId}`); } };
async function activity(people = active) {
  tick += 1;
  for (const person of people) {
    const snapshot = person.client.state.snapshot;
    assert.ok(snapshot?.projection.self.canControl, `${person.label} 在本轮持续操作中应保持真实控制`);
    const region = snapshot.projection.regions.find(value => value.regionId === snapshot.projection.self.regionId);
    const choices = region.exits.filter(id => id !== 'destination');
    const action = tick % 3 === 0 ? { kind: 'wait' } : { kind: 'move', regionId: choices[tick % choices.length] };
    await accepted(person, action);
  }
}
function counts() {
  const records = recorder.records;
  return [...new Set(active.map(person => person.userId))].map(userId => ({ userId, uniqueOutboundActions: new Set(records.filter(row => row.kind === 'outbound' && row.userId === userId && row.event === 'player.action.request').map(row => JSON.parse(row.value).clientActionId)).size, acceptedActionIds: new Set(records.filter(row => row.kind === 'inbound' && row.userId === userId && row.event === 'player.action.request' && row.value.status === 'Accepted').map(row => row.value.clientActionId)).size }));
}

try {
  database = await startTestPostgres('frontend-network');
  database.pool.on('error', error => { report.databaseErrors.push({ code: error.code, message: error.message }); recorder.write('database-error', { code: error.code, message: error.message }); });
  server = await createAuthorityServer({ pool: database.pool, log: (message, data) => recorder.write('server-log', { message, ...data }) });
  const connections = observeConnections(server.runtime, recorder);
  const address = await server.listen(0); const origin = `http://127.0.0.1:${address.port}`;
  report.environment = { node: process.version, postgres: (await database.pool.query('SHOW server_version')).rows[0].server_version, frontendSocketVersion: JSON.parse(await readFile(resolve(repository, 'frontend/package.json'))).dependencies['socket.io-client'], serverSocketVersion: JSON.parse(await readFile(resolve(repository, 'package.json'))).dependencies['socket.io'], serverOrigin: origin, clock: '默认 Date.now；未注入或快进时钟' };
  for (let i = 0; i < 5; i += 1) { const person = new Participant({ label: `P${i + 1}`, origin, recorder, connections }); all.push(person); active.push(person); await person.guest(`技术旅伴${i + 1}`); }
  historyObservers = [...active];
  const [A, B, C, D, E] = active;
  sessionId = (await A.api.create(crypto.randomUUID(), 'trust-repair-fixture-v1')).sessionId; report.sessionId = sessionId;
  for (const person of active) await person.join(sessionId);
  assert.equal((await A.api.rooms()).find(room => room.sessionId === sessionId).playerCount, 5);
  await A.api.start(sessionId, crypto.randomUUID());
  for (const person of active) person.open(sessionId);
  await Promise.all(active.map(person => person.controlled()));
  const initial = await stable('初始五身份控制与授权');
  assert.equal(initial.content.timing.durationSeconds, 1200); assert.equal(initial.content.timing.gracePeriodSeconds, 30);
  timerStart = performance.now(); report.longStartedAt = new Date().toISOString(); report.longMonotonicStartMs = timerStart; report.deadlineAt = initial.state.deadlineAt;
  report.identities = active.map(person => ({ label: person.label, userId: person.userId, actorId: person.actorId }));
  pass('五身份真实开局，固定 1200 秒期限并开始实际计时');

  // 唯一标记独立于服务端过滤器，检查完整真实入站载荷。
  await drainOutbox();
  const hiddenBefore = E.client.state.snapshot; const privateMarker = `private-${crypto.randomUUID()}`; mainMarkers.push({ marker: privateMarker, allowed: [A.userId, C.userId] });
  const privateAction = await accepted(A, { kind: 'speak', text: privateMarker, channel: 'private', recipientIds: [C.actorId] });
  await until(() => BigInt(E.client.state.snapshot?.snapshotSeq || '0') >= BigInt(privateAction.receipt.observedSeq), '隐藏空区间推进');
  const emptyBatch = E.inbound.find(row => row.value?.type === 'world.batch' && row.value.fromExclusive === hiddenBefore.snapshotSeq && BigInt(row.value.throughSeq) >= BigInt(privateAction.receipt.observedSeq) && row.value.events.length === 0);
  assert.ok(emptyBatch, '必须实际取得全隐藏区间的空 WorldBatch');
  assert.deepEqual(E.client.state.snapshot.projection, hiddenBefore.projection);
  const privateEvents = (await database.pool.query('SELECT event FROM world_events WHERE session_id=$1 AND session_seq>$2 AND session_seq<=$3 ORDER BY session_seq', [sessionId, hiddenBefore.snapshotSeq, privateAction.receipt.observedSeq])).rows.map(row => row.event);
  assert.ok(privateEvents.length > 0 && privateEvents.every(event => !event.audience.humanCharacterIds.includes(E.actorId)));
  await stable('私人消息后的空区间');
  assertPrivateBoundary(historyObservers, privateMarker, [A.userId, C.userId], recorder);
  pass('真实隐藏空批次推进且不交付私人载荷', { fromExclusive: emptyBatch.value.fromExclusive, throughSeq: emptyBatch.value.throughSeq, messageIndex: emptyBatch.index });
  const directedMarker = `directed-${crypto.randomUUID()}`; mainMarkers.push({ marker: directedMarker, allowed: [A.userId, C.userId] });
  await accepted(A, { kind: 'speak', text: directedMarker, channel: 'directed', recipientIds: [C.actorId] });
  await moveTo(B, 'passage'); await moveTo(A, 'store'); await moveTo(A, 'passage'); await stable('原接收者离开与新进入者');
  for (const { marker, allowed } of mainMarkers) {
    assertPrivateBoundary(historyObservers, marker, allowed, recorder);
    for (const person of active) assert.equal(canonicalize((await person.api.snapshot(sessionId)).projection).includes(marker), allowed.includes(person.userId));
  }
  pass('合法私有与定向历史保留，后来进入者没有补获秘密');
  await moveTo(B, 'store'); await moveTo(A, 'store'); await stable('乱序前稳定游标'); await drainOutbox();

  // 延迟原始 sync 请求到两个真实推送之后，取得真实重叠区间；不手造批次。
  E.requestPolicy = event => event === 'sync.request' ? 'hold' : 'deliver';
  E.responsePolicy = packet => packet.kind === 'sync.request' ? 'hold' : 'deliver'; E.pushPolicy = () => 'hold';
  const delayedRequest = await until(() => E.held.find(packet => packet.kind === 'outbound:sync.request'), '心跳原始同步请求进入调度队列');
  const c0 = E.client.state.snapshot.snapshotSeq;
  await moveTo(A, 'passage');
  const first = await until(() => E.held.find(packet => packet.kind === 'world.batch' && packet.value.fromExclusive === c0 && BigInt(packet.value.throughSeq) > BigInt(c0)), '第一完整真实批次');
  await moveTo(B, 'side_path');
  const second = await until(() => E.held.find(packet => packet.kind === 'world.batch' && packet.value.fromExclusive === first.value.throughSeq && BigInt(packet.value.throughSeq) > BigInt(first.value.throughSeq)), '第二完整真实批次');
  E.requestPolicy = () => 'deliver'; E.release(delayedRequest);
  const overlap = await until(() => E.held.find(packet => packet.kind === 'sync.request' && packet.value.fromExclusive === c0 && packet.value.throughSeq === second.value.throughSeq), '真实服务返回覆盖两批的重叠区间');
  E.release(second); assert.equal(E.client.state.snapshot.snapshotSeq, c0, '未来区间不得猜测应用');
  E.release(first); assert.equal(E.client.state.snapshot.snapshotSeq, first.value.throughSeq);
  E.requestPolicy = event => event === 'sync.request' ? 'hold' : 'deliver';
  E.release(overlap); await sleep(0); assert.equal(E.client.state.snapshot.snapshotSeq, first.value.throughSeq, '重叠区间不得跳过前缀守卫');
  E.responsePolicy = () => 'deliver'; E.pushPolicy = () => 'deliver'; E.requestPolicy = () => 'deliver';
  for (const packet of [...E.held].filter(packet => packet.kind === 'outbound:sync.request')) E.release(packet);
  await until(() => E.client.state.snapshot.snapshotSeq === second.value.throughSeq, '心跳从当前游标恢复缺失区间');
  const beforeDuplicate = sha256(E.client.state.snapshot); first.deliver(); second.deliver(); assert.equal(sha256(E.client.state.snapshot), beforeDuplicate);
  E.releaseAll(); await stable('完整批次乱序重叠与重复恢复');
  pass('完整真实批次的乱序、重叠、重复均按游标恢复', { ranges: [first.value, second.value, overlap.value].map(batch => ({ fromExclusive: batch.fromExclusive, throughSeq: batch.throughSeq })) });

  await drainOutbox(); await stable('丢尾包前');
  const tailStart = E.client.state.snapshot.snapshotSeq; let dropped = null;
  E.responsePolicy = packet => packet.kind === 'sync.request' ? 'hold' : 'deliver';
  E.pushPolicy = packet => { if (!dropped && BigInt(packet.value.throughSeq) > BigInt(tailStart)) { dropped = packet; return 'drop'; } return 'deliver'; };
  await moveTo(A, 'store'); await until(() => dropped, '最后真实推送已丢弃');
  const tailHead = (await A.api.snapshot(sessionId)).snapshotSeq;
  assert.ok(BigInt(E.client.state.snapshot.snapshotSeq) < BigInt(tailHead), '尚未补发前不能冒充追赶完成');
  E.responsePolicy = () => 'deliver'; for (const packet of [...E.held]) E.release(packet);
  await until(() => E.client.state.snapshot.snapshotSeq === tailHead, '无后续动作时由周期补发追回最后推送');
  assert.equal((await A.api.snapshot(sessionId)).snapshotSeq, tailHead, '恢复期间没有追加新的世界动作'); E.pushPolicy = () => 'deliver';
  await stable('丢最后推送后心跳追赶'); pass('最后推送丢失后，没有新世界事件仍由心跳补发追赶', { droppedIndex: dropped.receivedIndex, targetCursor: tailHead });

  // 把物品交接 ACK 扣留到真实 Grace / Proxy / Human 之后；原请求字节保持不变。
  await moveTo(B, 'store'); await moveTo(E, 'store'); await stable('交付 ACK 丢失前');
  const owned = B.client.state.snapshot.projection.items.find(item => item.transferable && item.location.kind === 'character' && item.location.characterId === B.actorId);
  assert.ok(owned, '保管者实际持有可交付物品'); let heldAction = false;
  B.responsePolicy = packet => { if (!heldAction && packet.kind === 'player.action.request') { heldAction = true; return 'hold'; } return 'deliver'; };
  const originalSend = B.client.send({ kind: 'transfer_item', itemId: owned.itemId, targetId: E.actorId, expectedItemRevision: owned.resourceRevision });
  const lostAck = await until(() => B.held.find(packet => packet.kind === 'player.action.request'), '实际交付 ACK 已收到但未交付客户端');
  assert.equal(lostAck.value.status, 'Accepted');
  const originalDraft = B.client.state.actions.at(-1); const originalRaw = originalDraft.raw;
  B.holdReceiptQueries = true; const disconnectedAt = performance.now(); B.client.close();
  const grace = await until(async () => { const snapshot = await B.api.snapshot(sessionId); return snapshot.projection.self.mode === 'GracePeriod' && snapshot; }, '真实断开进入 Grace');
  const graceState = await server.runtime.replay(sessionId, grace.snapshotSeq); const graceDeadlineAt = graceState.characters[B.actorId].graceDeadlineAt;
  for (let step = 0; performance.now() - disconnectedAt < 31000; step += 1) { await activity(active.filter(person => person !== B)); await sleep(Math.min(10000, Math.max(0, 31000 - (performance.now() - disconnectedAt)))); }
  const proxy = await until(async () => { const snapshot = await B.api.snapshot(sessionId); return snapshot.projection.self.mode === 'AIProxyControlled' && snapshot; }, '真实 30 秒宽限后进入受限托管', 10000);
  assert.ok(performance.now() - disconnectedAt >= 30000);
  const proxyObservedAt = new Date().toISOString(); const proxyAfterMs = performance.now() - disconnectedAt;
  B.open(sessionId, [originalDraft]); await B.controlled();
  assert.ok(BigInt(B.client.state.snapshot.projection.self.controlEpoch) > BigInt(JSON.parse(originalRaw).controlEpoch));
  await until(() => B.held.some(packet => packet.kind === 'http-receipt'), '真实自动 Receipt 查询已被扣留以观察显式 retry');
  await B.client.retry(originalDraft.id);
  assert.equal(B.client.state.actions.find(action => action.id === originalDraft.id).raw, originalRaw);
  assert.deepEqual(B.client.state.actions.find(action => action.id === originalDraft.id).receipt, lostAck.value);
  const retries = B.outbound.filter(row => row.event === 'player.action.request' && JSON.parse(row.value).clientActionId === originalDraft.id);
  assert.equal(retries.length, 2); assert.ok(retries.every(row => row.value === originalRaw));
  B.releaseAll(); await originalSend;
  assert.deepEqual(await B.api.receipt(sessionId, originalDraft.id), lostAck.value);
  const afterRetry = await server.runtime.replay(sessionId);
  assert.deepEqual(afterRetry.items[owned.itemId].location, { kind: 'character', characterId: E.actorId });
  assert.equal(afterRetry.items[owned.itemId].resourceRevision, String(BigInt(owned.resourceRevision) + 1n));
  const effectCount = Number((await database.pool.query("SELECT count(*) AS n FROM world_events WHERE session_id=$1 AND event->'causedBy'->>'actionId'=$2", [sessionId, originalDraft.id])).rows[0].n); assert.equal(effectCount, 1);
  await stable('ACK 丢失跨真实 Grace 与新 epoch 原样重试');
  pass('ACK 扣留后真实 Grace→Proxy→Human，原字节发送两次但交付只有一次', { actionId: originalDraft.id, raw: originalRaw, rawDigest: sha256(originalRaw), outboundIndexes: retries.map(row => row.index), receipt: lostAck.value, graceDeadlineAt, proxyObservedAt, proxyAfterMs, proxyEpoch: proxy.projection.self.controlEpoch, effectCount });

  const replacement = B.duplicate('P2-replacement'); all.push(replacement); historyObservers.push(replacement); replacement.open(sessionId); await replacement.online();
  await replacement.client.control('resume');
  assert.equal(replacement.inbound.filter(row => row.event === 'control.resume').at(-1).value.code, 'CONTROL_HELD');
  assert.equal(replacement.client.state.snapshot.projection.self.canControl, false);
  await replacement.client.control('take'); await until(() => replacement.client.state.snapshot?.projection.self.canControl, '明确接管取得新控制');
  await B.online(); await until(() => B.client.state.snapshot?.projection.self.canControl === false, '原连接恢复为只读视角');
  const beforeOldCallbacks = sha256(B.client.state.snapshot); for (const packet of B.held.filter(packet => packet.kind === 'world.batch')) B.release(packet); assert.equal(sha256(B.client.state.snapshot), beforeOldCallbacks);
  B.client.close(); active[1] = replacement;
  await stable('双连接明确接管');
  pass('第二真实连接 resume 被拒，显式 take 后只有新绑定可写', { userId: B.userId, originalConnectionId: B.currentLink.serverConnectionId, replacementConnectionId: replacement.currentLink.serverConnectionId });

  // 隔离边界用局：不损坏持续操作主局，也不新增普通玩家调试接口。
  const otherSession = (await A.api.create(crypto.randomUUID(), 'trust-repair-fixture-v1')).sessionId;
  const sideA = A.duplicate('boundary-A'); const sideB = B.duplicate('boundary-B'); all.push(sideA, sideB);
  await sideA.join(otherSession); await sideB.join(otherSession); await sideA.api.start(otherSession, crypto.randomUUID());
  sideA.open(otherSession); sideB.open(otherSession); await sideA.controlled(); await sideB.controlled();
  const sideReceipt = await accepted(sideB, { kind: 'wait' }); const aReceipt = await accepted(sideA, { kind: 'wait' });
  await assert.rejects(C.api.snapshot(otherSession), error => error.code === 'FORBIDDEN');
  await assert.rejects(C.api.receipt(otherSession, sideReceipt.id), error => error.code === 'FORBIDDEN');
  const foreignRaw = canonicalize({ ...JSON.parse(sideReceipt.raw), clientActionId: crypto.randomUUID() });
  const rejected = await C.currentLink.link.request('player.action.request', foreignRaw); assert.equal(rejected.code, 'FORBIDDEN');
  for (const marker of mainMarkers) assert.ok(![...sideA.inbound, ...sideB.inbound].some(row => canonicalize(row.value).includes(marker.marker)), '另一局不能取得主局历史私人载荷');
  await server.runtime.revokeAccess(otherSession, sideB.userId);
  await until(() => sideB.client.state.connection === 'forbidden' && sideB.client.state.snapshot === null, '撤权后停止旧视图与订阅');
  await assert.rejects(sideB.api.receipt(otherSession, sideReceipt.id), error => error.code === 'FORBIDDEN');
  assert.equal(await sideA.api.receipt(otherSession, `unseen-${crypto.randomUUID()}`), null);
  await server.runtime.abortSession(otherSession, '技术边界检查结束，非自然玩法结局。');
  await until(() => sideA.client.state.snapshot?.projection.phase === 'Aborted', '真实终态投影');
  assert.deepEqual(await sideA.api.receipt(otherSession, aReceipt.id), aReceipt.receipt);
  await assert.rejects(sideA.client.send({ kind: 'wait' }));
  await server.runtime.deleteSession(otherSession);
  await assert.rejects(sideA.api.receipt(otherSession, aReceipt.id), error => error.code === 'SESSION_GONE' && error.status === 410);
  await until(() => sideA.client.state.connection === 'forbidden' && !sideA.client.state.snapshot, '已删除 Session 的旧视图清空');
  await sideA.settle(); await sideB.settle();
  pass('跨局、撤权、未知收据、终态读取与删除边界', { otherSession, retainedActionId: aReceipt.id });

  // 后续维持真实操作，不扩关卡期限；每分钟保存可核对的进度与同游标检查点。
  let nextProgress = elapsed() + 30000; let nextCheckpoint = elapsed() + 60000;
  while (elapsed() < durationMs) {
    assert.ok(elapsed() < 1100000, '本轮总技术时长预算被超过'); assert.deepEqual(report.databaseErrors, []);
    await activity();
    if (elapsed() >= nextCheckpoint) { await stable(`持续操作 ${Math.floor(elapsed() / 1000)} 秒`); nextCheckpoint = elapsed() + 60000; }
    if (elapsed() >= nextProgress) { const progress = { elapsedMs: Math.round(elapsed()), remainingMs: Math.max(0, Math.round(durationMs - elapsed())), identities: counts() }; recorder.write('progress', progress); console.log(JSON.stringify(progress)); nextProgress = elapsed() + 30000; }
    await sleep(Math.min(10000, Math.max(0, durationMs - elapsed())));
  }
  const final = await stable('至少 900 秒后的最终同前缀回放');
  for (const { marker, allowed } of mainMarkers) {
    assertPrivateBoundary(historyObservers, marker, allowed, recorder);
    for (const person of active) assert.equal(canonicalize((await person.api.snapshot(sessionId)).projection).includes(marker), allowed.includes(person.userId));
  }
  const sequences = (await database.pool.query('SELECT session_seq FROM world_events WHERE session_id=$1 ORDER BY session_seq', [sessionId])).rows.map(row => row.session_seq);
  assert.equal(sequences.length, Number(final.cursor)); assert.ok(sequences.every((seq, index) => seq === String(index + 1)));
  assert.deepEqual(report.databaseErrors, []);
  report.actualDurationMs = elapsed(); assert.ok(report.actualDurationMs >= 900000);
  report.final = { cursor: final.cursor, stateDigest: sha256(final.state), phase: final.state.phase, contentVersion: final.state.contentVersion, reducerVersion: final.state.reducerVersion, eventCount: sequences.length, counts: counts() };
  pass('达到实际 900 秒，连续事件与最终世界 / 各自授权前缀回放一致', report.final);
  report.assessment = 'PASS';
} catch (error) {
  report.assessment = 'FAIL'; report.error = { name: error.name, message: error.message, stack: error.stack }; report.actualDurationMs = elapsed();
  recorder.write('failure', report.error); console.error(JSON.stringify({ assessment: 'FAIL', elapsedMs: Math.round(elapsed()), error: report.error }));
} finally {
  report.finishedAt = new Date().toISOString(); await saveJSON(resolve(output, 'result-before-cleanup.json'), report);
  for (const person of all) { try { await person.settle(); report.cleanup.push({ participant: person.label, status: 'closed' }); } catch (error) { report.cleanup.push({ participant: person.label, error: error.message }); report.assessment = 'FAIL'; } }
  try { await server?.close(); report.cleanup.push({ resource: 'authority-server', status: 'closed' }); } catch (error) { report.cleanup.push({ resource: 'authority-server', error: error.message }); report.assessment = 'FAIL'; }
  try { await database?.stop(); report.cleanup.push({ resource: 'postgres', status: 'closed' }); } catch (error) { report.cleanup.push({ resource: 'postgres', error: error.message }); report.assessment = 'FAIL'; }
  report.resourcesClosed = report.cleanup.every(row => row.status === 'closed'); report.closedAt = new Date().toISOString();
  const endingSource = await sourceIdentity(); assert.deepEqual(endingSource.sourceHashes, source.sourceHashes, '检查期间源码不得改变'); report.sourceUnchanged = true;
  recorder.write('cleanup', { resourcesClosed: report.resourcesClosed, pendingRequests: all.reduce((sum, person) => sum + person.pending.size, 0) }); await recorder.close();
  const trace = await readFile(resolve(output, 'trace.jsonl')); const compressed = gzipSync(trace); await writeFile(resolve(output, 'trace.jsonl.gz'), compressed);
  report.trace = { file: 'trace.jsonl.gz', sha256: sha256(compressed), uncompressedSha256: sha256(trace), records: recorder.count, bytes: trace.length };
  await saveJSON(resolve(output, 'result.json'), report);
  console.log(JSON.stringify({ assessment: report.assessment, actualDurationMs: report.actualDurationMs, resourcesClosed: report.resourcesClosed, output }));
  if (report.assessment !== 'PASS') process.exitCode = 1;
}
