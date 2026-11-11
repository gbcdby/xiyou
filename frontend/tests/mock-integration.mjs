import assert from 'node:assert/strict';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { startTestPostgres } from '../../backend/test-support/postgres.mjs';
import { createAuthorityServer } from '../../backend/server.mjs';
import { createMockServer } from '../../backend/mock-main.mjs';
import { ModelGateway } from '../../backend/ai/gateway.mjs';
import { AIOrchestrator } from '../../backend/ai/orchestrator.mjs';
import { validateContract } from '../../protocol/index.mjs';
import { Participant, observeConnections, checkpoint } from './network-harness.mjs';
import { repository, saveJSON, sourceIdentity, sha256, until } from './network-support.mjs';

// 新合成样本只保存必要诊断。完整载荷用于内存断言，不把它们全部写到发布日志。
class ProofRecorder {
  constructor(path) { this.stream = createWriteStream(path); this.count = 0; }
  write(kind, value) {
    const record = { index: ++this.count, utc: new Date().toISOString(), kind, ...value };
    const { value: payload, body, raw, ...minimal } = record;
    this.stream.write(JSON.stringify(minimal) + '\n');
    return record;
  }
  async close() { this.stream.end(); await finished(this.stream); }
}

const output = resolve(process.env.MOCK_EVIDENCE_DIR || resolve(repository, '.agent-output/mock-integration'));
await mkdir(output, { recursive: true });
const source = await sourceIdentity();
assert.equal(source.status, '', '正式集成检查必须绑定干净候选。');
const recorder = new ProofRecorder(resolve(output, 'events.jsonl'));
const report = { acceptanceProfile: 'mock-20261111', source, startedAt: new Date().toISOString(), participants: '合成独立身份', externalModelCalls: 0, cases: [], actions: [], contributions: [], databaseErrors: [], cleanup: [], resourcesClosed: false };
const environments = [], people = [], started = performance.now();
const pass = (name, detail = {}) => { const value = { name, status: 'PASS', ...detail }; report.cases.push(value); recorder.write('case', value); console.log(JSON.stringify(value)); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function environment(label, { mock = true, now } = {}) {
  const database = await startTestPostgres(`mock-${label}`);
  const entry = { label, database, server: null };
  environments.push(entry);
  database.pool.on('error', error => report.databaseErrors.push({ environment: label, code: error.code, message: error.message }));
  const server = mock
    ? await createMockServer({ pool: database.pool, ...(now ? { now } : {}) })
    : await createAuthorityServer({ pool: database.pool, ...(now ? { now } : {}) });
  entry.server = server;
  entry.connections = observeConnections(server.runtime, recorder);
  const address = await server.listen(0);
  entry.origin = `http://127.0.0.1:${address.port}`;
  return entry;
}

async function room(env, count, label) {
  const members = [];
  for (let i = 0; i < count; i++) {
    const person = new Participant({ label: `${label}-P${i + 1}`, origin: env.origin, recorder, connections: env.connections });
    people.push(person); members.push(person); await person.guest(`模拟旅伴${i + 1}`);
  }
  const sessionId = (await members[0].api.create(crypto.randomUUID(), 'trust-repair-fixture-v1')).sessionId;
  for (const person of members) await person.join(sessionId);
  await members[0].api.start(sessionId, crypto.randomUUID());
  for (const person of members) person.open(sessionId);
  await Promise.all(members.map(person => person.controlled()));
  const state = await env.server.runtime.replay(sessionId);
  const actors = members.map(person => state.characters[person.actorId]);
  assert.equal(new Set(actors.map(actor => actor.characterId)).size, count);
  assert.deepEqual(actors.flatMap(actor => actor.roles).sort(), ['A', 'B', 'C', 'D', 'E']);
  assert.ok(actors.every(actor => actor.roles.length && actor.capabilities.length));
  const roles = Object.fromEntries(['A', 'B', 'C', 'D', 'E'].map(role => [role, members[actors.findIndex(actor => actor.roles.includes(role))]]));
  return { env, label, sessionId, members, roles, clock: '真实 Date.now' };
}

async function view(person) { return (await person.api.snapshot(person.sessionId)).projection; }
async function act(person, action, purpose, usedObservationIds = []) {
  if (usedObservationIds.length) {
    const current = await view(person);
    assert.ok(usedObservationIds.every(id => current.observations.some(o => o.observationId === id)), '自动玩家只能依据自己的合法观察。');
  }
  const result = await person.action(action);
  assert.equal(result.receipt.status, 'Accepted', `${purpose}: ${result.receipt.code}`);
  await until(() => BigInt(person.client.state.snapshot?.snapshotSeq || '0') >= BigInt(result.receipt.observedSeq), `${purpose}：授权游标确认`);
  const record = { sessionId: person.sessionId, actorId: person.actorId, participant: person.label, actionId: result.id, kind: action.kind, purpose, usedObservationIds, rawDigest: sha256(result.raw), receipt: result.receipt };
  report.actions.push(record); return record;
}
async function move(person, regionId) {
  const current = await view(person);
  if (current.self.regionId === regionId) return;
  assert.ok(current.regions.find(r => r.regionId === current.self.regionId).exits.includes(regionId), '路线必须来自当前可见出口。');
  return act(person, { kind: 'move', regionId }, `前往${regionId}`);
}
async function inspect(person, targetId, used = []) {
  assert.ok((await view(person)).targets.some(t => t.targetId === targetId), '检查对象必须已在授权视野内。');
  return act(person, { kind: 'inspect', targetId }, `检查${targetId}`, used);
}
async function transfer(person, itemId, recipient) {
  const item = (await view(person)).items.find(item => item.itemId === itemId);
  assert.ok(item && item.location.kind === 'character' && item.location.characterId === person.actorId);
  return act(person, { kind: 'transfer_item', itemId, targetId: recipient.actorId, expectedItemRevision: item.resourceRevision }, `交付${itemId}`);
}
async function events(r) {
  return (await r.env.database.pool.query('SELECT event FROM world_events WHERE session_id=$1 ORDER BY session_seq', [r.sessionId])).rows.map(row => row.event);
}
async function actionEvents(r, action) { return (await events(r)).filter(event => event.causedBy.actionId === action.actionId); }
async function shared(r, person, observation, recipients, purpose) {
  const action = await act(person, { kind: 'share_evidence', evidenceId: observation.observationId, recipientIds: recipients }, purpose, [observation.observationId]);
  const copies = (await actionEvents(r, action)).filter(event => event.kind === 'ObservationRecorded').map(event => event.payload);
  assert.ok(recipients.every(id => copies.some(o => o.observerId === id)));
  assert.ok(copies.every(o => o.category === observation.category && JSON.stringify(o.source.sourceIds) === JSON.stringify(observation.source.sourceIds)));
  return { action, copies };
}
function contribution(r, role, action, downstream) {
  assert.equal(r.roles[role].actorId, action.actorId);
  assert.ok(downstream.length, '有效贡献必须有本轮实际下游。');
  report.contributions.push({ sessionId: r.sessionId, role, actorId: action.actorId, actionId: action.actionId, kind: action.kind, purpose: action.purpose, downstream });
}

async function recap(r, state) {
  const allEvents = await events(r), bySeq = new Map(allEvents.map(event => [event.sessionSeq, event]));
  const results = [];
  for (const person of r.members) {
    await until(() => person.client.state.snapshot?.projection.phase === state.phase && person.client.state.snapshot.snapshotSeq === state.sessionSeq, '终态投影实际到达后读取复盘');
    const entries = []; let before;
    do {
      const page = await person.api.recap(r.sessionId, state.sessionSeq, before);
      validateContract('AuthorizedRecap', page);
      assert.equal(page.actorId, person.actorId); assert.equal(page.throughSeq, state.sessionSeq);
      assert.ok(page.entries.length <= 100);
      for (const entry of page.entries) {
        const event = bySeq.get(entry.eventSeq);
        assert.ok(event?.audience.humanCharacterIds.includes(person.actorId), '复盘条目必须有发生时的合法受众。');
        if (event.kind === 'ObservationRecorded' && event.payload.category === 'Claim') {
          assert.equal(entry.category, 'Claim'); assert.equal(entry.actorId, person.actorId);
        }
        if (entries.length) assert.ok(BigInt(entries.at(-1).eventSeq) > BigInt(entry.eventSeq));
        entries.push(entry);
      }
      before = page.nextBeforeSeq ?? undefined;
    } while (before);
    assert.equal(new Set(entries.map(entry => entry.entryId)).size, entries.length);
    await assert.rejects(person.client.send({ kind: 'wait' }));
    results.push({ actorId: person.actorId, count: entries.length, digest: sha256(entries) });
  }
  assert.equal((await r.env.server.runtime.replay(r.sessionId)).sessionSeq, state.sessionSeq, '只读复盘和终态客户端不能追加世界效果。');
  return results;
}

async function finishGame(env, count, { label, material, completeEvidence }) {
  const r = await room(env, count, label), { A, B, C, D, E } = r.roles;
  await inspect(A, 'passage_structure');
  const stock = await inspect(B, 'stock_record');
  const stockObservation = (await view(B)).observations.find(o => o.subjectId === 'stock_record' && o.fields.some(f => f.key === 'originalPresent' && f.value === false));
  assert.ok(stockObservation);
  let shortage = null, register = stock;
  if (B !== E) {
    shortage = await shared(r, B, stockObservation, [E.actorId], '将库存短缺交给记事者核对登记');
    const received = shortage.copies.find(o => o.observerId === E.actorId);
    assert.ok(received.fields.some(f => f.key === 'originalPresent' && f.value === false));
    register = await inspect(E, 'stock_record', [received.observationId]);
    contribution(r, 'B', shortage.action, [{ actionId: register.actionId, observationId: received.observationId }]);
  }
  await move(D, 'side_path'); await inspect(D, 'material_cache');
  let retrieved;
  if (material === 'original_material') {
    const item = (await view(D)).items.find(item => item.itemId === material);
    assert.ok(item?.location.kind === 'region');
    retrieved = await act(D, { kind: 'take_item', itemId: material, expectedItemRevision: item.resourceRevision }, '找回可见原材料');
  }
  await move(B, 'side_path');
  await act(B, { kind: 'speak', channel: 'public', recipientIds: [], text: '我会把工具送到通路口。出口 passage。请在通路口汇合。' }, '协调悟空与工具供给汇合');
  await until(async () => (await env.server.runtime.replay(r.sessionId)).characters.wukong.regionId === 'passage', '悟空经受控策略和正式规则到达通路口', 25000);
  for (const person of new Set([A, B, C, D, E])) await move(person, 'passage');
  const suppliedTool = B === A ? null : await transfer(B, 'repair_tool', A);
  let suppliedMaterial;
  if (material === 'original_material') {
    if (D !== A) suppliedMaterial = await transfer(D, material, A);
  } else if (B !== A) suppliedMaterial = await transfer(B, material, A);

  const evidenceCopies = [];
  for (const person of new Set([A, B, D, E])) {
    const observations = (await view(person)).observations.filter(o => o.category === 'Evidence');
    for (const observation of observations) {
      if (!completeEvidence && observation.source.sourceIds.includes('authorized-movement-register')) continue;
      const copied = await shared(r, person, observation, ['tangseng', 'wukong'], '将独立证据交给两位核心角色');
      evidenceCopies.push({ owner: person.actorId, observation, ...copied });
    }
  }
  const repairView = await view(A);
  const itemIds = [material, 'repair_tool'];
  const repair = await act(A, { kind: 'use_item', itemIds, expectedItemRevisions: Object.fromEntries(itemIds.map(id => [id, repairView.items.find(i => i.itemId === id).resourceRevision])), targetId: 'passage_structure', expectedTargetRevision: repairView.targets.find(t => t.targetId === 'passage_structure').resourceRevision, operation: 'repair' }, '由玩家提交实际修复');
  const permitView = await view(C);
  const permit = await act(C, { kind: 'interact', targetId: 'passage_structure', expectedTargetRevision: permitView.targets.find(t => t.targetId === 'passage_structure').resourceRevision, operation: 'grant_passage' }, '由通行协调者核对修复后授予许可');
  const routeView = await view(C);
  assert.ok(routeView.regions.find(region => region.regionId === routeView.self.regionId).exits.includes('destination'));
  const route = await act(C, { kind: 'speak', channel: 'public', recipientIds: [], text: '修复与通行许可已由规则确认。出口 destination。请前往另一端。' }, '基于当前合法出口协调最终通行');
  const state = await until(async () => { const value = await env.server.runtime.replay(r.sessionId); return value.phase === 'Finished' && value; }, '两位核心NPC实际抵达后自然结算', 90000);
  const expected = completeEvidence && material === 'original_material' ? 'clarified_passage' : 'costly_passage';
  assert.equal(state.ending.endingCode, expected);
  assert.equal(state.items[material].location.kind, 'consumed');
  assert.equal(state.items.repair_tool.location.kind, 'character');
  assert.equal(state.ending.facts.find(f => f.key === 'spareConsumed').value, material === 'spare_material');
  assert.equal(state.ending.facts.find(f => f.key === 'evidenceComplete').value, completeEvidence);
  assert.ok(['tangseng', 'wukong'].every(id => state.characters[id].regionId === 'destination'));
  const worldEvents = await events(r);
  const runs = (await env.database.pool.query('SELECT decision_id,actor_id,context FROM ai_runs WHERE session_id=$1 ORDER BY created_at,decision_id', [r.sessionId])).rows;
  const routeClaim = (await actionEvents(r, route)).find(event => event.kind === 'ClaimRecorded').payload;
  const npcMoves = worldEvents.filter(event => event.kind === 'character.moved' && ['tangseng', 'wukong'].includes(event.payload.actorId) && event.payload.to === 'destination');
  assert.equal(npcMoves.length, 2);
  const causal = npcMoves.map(event => {
    const run = runs.find(run => `${run.decision_id}:submit` === event.causedBy.actionId);
    assert.ok(run && run.context.memory.claims.some(claim => claim.claimId === routeClaim.claimId), '最终移动必须关联真正收到路线建议的Gateway输入。');
    const receipt = report.actions.find(action => action.actionId === route.actionId).receipt;
    assert.ok(BigInt(event.sessionSeq) > BigInt(receipt.observedSeq));
    return { actorId: event.payload.actorId, decisionId: run.decision_id, routeClaimId: routeClaim.claimId, inputObservationIds: run.context.memory.observations.map(o => o.observationId), eventSeq: event.sessionSeq, contextDigest: sha256(run.context) };
  });
  if (count === 5) {
    const structure = evidenceCopies.find(e => e.owner === A.actorId && e.observation.source.sourceIds.includes('structure-before-arrival'));
    const registry = evidenceCopies.find(e => e.owner === E.actorId && e.observation.source.sourceIds.includes('authorized-movement-register'));
    assert.ok(structure && registry && suppliedTool && suppliedMaterial && retrieved && shortage);
    for (const proof of [structure, registry]) assert.ok(['tangseng', 'wukong'].every(id => runs.some(run => run.actor_id === id && run.context.memory.observations.some(o => proof.copies.some(c => c.observationId === o.observationId)))), '共享证据必须真正进入两角色的后续Decision。');
    contribution(r, 'A', structure.action, causal.map(c => ({ decisionId: c.decisionId, sourceId: 'structure-before-arrival' })));
    contribution(r, 'A', repair, [{ actionId: permit.actionId, endingCode: expected }]);
    contribution(r, 'B', suppliedTool, [{ actionId: repair.actionId, itemId: 'repair_tool' }]);
    contribution(r, 'C', permit, npcMoves.map(e => ({ eventSeq: e.sessionSeq })));
    contribution(r, 'C', route, causal.map(c => ({ decisionId: c.decisionId, eventSeq: c.eventSeq })));
    contribution(r, 'D', retrieved, [{ actionId: suppliedMaterial.actionId, itemId: material }]);
    contribution(r, 'D', suppliedMaterial, [{ actionId: repair.actionId, itemId: material }]);
    contribution(r, 'E', register, [{ actionId: registry.action.actionId, observationId: registry.observation.observationId }]);
    contribution(r, 'E', registry.action, causal.map(c => ({ decisionId: c.decisionId, sourceId: 'authorized-movement-register' })));
    for (const role of ['A', 'B', 'C', 'D', 'E']) {
      const own = report.contributions.filter(c => c.sessionId === r.sessionId && c.role === role);
      assert.ok(own.length >= 2 && own.some(c => !['speak', 'make_claim', 'wait', 'move'].includes(c.kind)), `${role} 至少两次有效贡献且一项非聊天。`);
    }
  }
  const recaps = await recap(r, state);
  pass(label, { sessionId: r.sessionId, players: count, endingCode: expected, material, completeEvidence, cursor: state.sessionSeq, events: worldEvents.length, aiDecisions: runs.length, causal, recaps, clock: r.clock });
  for (const person of r.members) await person.settle();
}

async function combinedFault() {
  let clock = Date.now();
  const env = await environment('joint-fault', { mock: false, now: () => clock });
  const r = await room(env, 2, '联合恢复'), [A, B] = r.members;
  await move(B, 'passage');
  const item = (await view(B)).items.find(item => item.itemId === 'repair_tool');
  let held = false;
  B.responsePolicy = packet => !held && packet.kind === 'player.action.request' ? (held = true, 'hold') : 'deliver';
  const pending = B.client.send({ kind: 'transfer_item', itemId: item.itemId, targetId: A.actorId, expectedItemRevision: item.resourceRevision });
  const lost = await until(() => B.held.find(packet => packet.kind === 'player.action.request'), '扣留已提交交付的真实ACK');
  assert.equal(lost.value.status, 'Accepted');
  const draft = B.client.state.actions.at(-1), raw = draft.raw;
  B.holdReceiptQueries = true; B.client.close();
  await until(async () => (await env.server.runtime.replay(r.sessionId)).characters[B.actorId].mode === 'GracePeriod', '真实断开进入Grace');
  clock += 31000; await env.server.runtime.maintenance(r.sessionId);
  assert.equal((await env.server.runtime.replay(r.sessionId)).characters[B.actorId].mode, 'AIProxyControlled');
  const handle = await env.server.runtime.bindInternal(r.sessionId, B.actorId, 'proxy');
  const entered = deferred(), release = deferred(); let oldRaw, decisionId;
  const gateway = new ModelGateway({ provider: { kind: 'controlled', providerId: 'mock-joint-late-v1', async generate(input) {
    decisionId = input.context.decision.decisionId;
    const next = input.context.current.regions.find(region => region.regionId === input.context.current.self.regionId).exits.find(id => id !== 'destination');
    oldRaw = JSON.stringify({ decisionId, toolCalls: [{ kind: 'move', regionId: next }] });
    entered.resolve(); await release.promise; return { rawText: oldRaw };
  } }, modelId: 'mock-joint-late-v1', timeoutMs: 10000 });
  const ai = new AIOrchestrator({ runtime: env.server.runtime, gateway, minIntervalMs: 1000, maxCallsPerSession: 1 });
  try {
    ai.watch(handle, { autoWake: false }); await entered.promise;
    await inspect(A, 'passage_structure');
    B.open(r.sessionId, [draft]); await B.controlled();
    assert.ok(BigInt(B.client.state.snapshot.projection.self.controlEpoch) > BigInt(JSON.parse(raw).controlEpoch));
    await until(() => B.held.some(packet => packet.kind === 'http-receipt'), '保留未知结果并扣留自动查询回包');
    const retry = B.client.retry(draft.id); release.resolve(); await retry;
    const rejected = await env.server.runtime.submitIntent(handle, decisionId, oldRaw);
    assert.equal(rejected.code, 'DECISION_STALE');
    assert.equal(rejected.actionEventRange, null);
    B.releaseAll(); await pending;
    assert.equal(B.client.state.actions.find(action => action.id === draft.id).raw, raw);
    assert.deepEqual(await B.api.receipt(r.sessionId, draft.id), lost.value);
    const sends = B.outbound.filter(row => row.event === 'player.action.request' && JSON.parse(row.value).clientActionId === draft.id);
    assert.equal(sends.length, 2); assert.ok(sends.every(row => row.value === raw));
    const state = await env.server.runtime.replay(r.sessionId), worldEvents = await events(r);
    assert.equal(worldEvents.filter(event => event.causedBy.actionId === draft.id).length, 1);
    assert.equal(worldEvents.filter(event => event.causedBy.actionId === `${decisionId}:submit`).length, 0);
    assert.deepEqual(state.items[item.itemId].location, { kind: 'character', characterId: A.actorId });
    assert.equal(state.items[item.itemId].resourceRevision, String(BigInt(item.resourceRevision) + 1n));
    assert.equal((await env.server.runtime.decisionState(handle, decisionId)).status, 'Cancelled');
    assert.equal(await env.server.runtime.internalReceipt(handle, `${decisionId}:fallback`, true), null);
    await checkpoint({ participants: r.members, server: env.server, sessionId: r.sessionId, recorder, label: '联合故障后的同前缀投影' });
    pass('真实ACK丢失→断线/代理→交还/原键重试与旧AI迟到联合轨迹', { sessionId: r.sessionId, clientActionId: draft.id, rawDigest: sha256(raw), sends: sends.length, effects: 1, oldDecisionId: decisionId, oldIntentCode: rejected.code, clock: '仅此期限专例使用受控时钟前进31000ms；不计900秒真实时长', gateway: gateway.metrics() });
  } finally { release.resolve(); B.releaseAll(); await ai.close(); }
}

try {
  const env = await environment('full-games');
  report.environment = { node: process.version, postgres: (await env.database.pool.query('SHOW server_version')).rows[0].server_version, controlledPolicies: env.server.ai.status() };
  for (const count of [3, 4]) {
    const r = await room(env, count, `${count}人职责装配`);
    pass(`${count}人实际开局覆盖全部五职责`, { sessionId: r.sessionId, roles: Object.fromEntries(Object.entries(r.roles).map(([role, person]) => [role, person.actorId])) });
    await env.server.runtime.abortSession(r.sessionId, '职责装配样本完成，不作为自然结局。');
    for (const person of r.members) await person.settle();
  }
  await finishGame(env, 5, { label: '五人查证原材料完整局', material: 'original_material', completeEvidence: true });
  await finishGame(env, 2, { label: '两人备用材料完整局', material: 'spare_material', completeEvidence: false });
  await finishGame(env, 2, { label: '两人原材料调查未齐完整局', material: 'original_material', completeEvidence: false });
  let clock = Date.now();
  const timed = await environment('deadline', { now: () => clock });
  const r = await room(timed, 2, '超时未解决');
  const initial = await timed.server.runtime.replay(r.sessionId);
  assert.equal(Date.parse(initial.deadlineAt) - clock, 1200000);
  clock = Date.parse(initial.deadlineAt);
  await timed.server.runtime.maintenance(r.sessionId);
  const ended = await timed.server.runtime.replay(r.sessionId);
  assert.equal(ended.phase, 'Finished'); assert.equal(ended.ending.endingCode, 'unresolved');
  assert.equal(ended.ending.facts.find(f => f.key === 'safe').value, false);
  pass('原1200秒规则的超时未解决路径', { sessionId: r.sessionId, endingCode: ended.ending.endingCode, cursor: ended.sessionSeq, clock: '期限专例受控时钟，不计900秒真实运行', recaps: await recap(r, ended) });
  await combinedFault();
  assert.deepEqual(report.databaseErrors, []);
  report.assessment = 'PASS';
} catch (error) {
  report.assessment = 'FAIL'; report.error = { name: error.name, message: error.message, stack: error.stack };
  report.failureDiagnostics = [];
  for (const env of environments) if (env.server) {
    const rows = (await env.database.pool.query('SELECT session_id,state FROM sessions ORDER BY session_id')).rows;
    report.failureDiagnostics.push({ environment: env.label, ai: env.server.ai?.status(), sessions: rows.map(({ session_id, state }) => ({ sessionId: session_id, phase: state.phase, cursor: state.sessionSeq, npcs: Object.values(state.characters).filter(actor => actor.kind === 'core_npc').map(actor => ({ actorId: actor.characterId, regionId: actor.regionId, mode: actor.mode })) })) });
  }
  console.error(JSON.stringify({ assessment: 'FAIL', error: report.error }));
} finally {
  for (const person of people) {
    try { await person.settle(); report.cleanup.push({ participant: person.label, status: 'closed' }); }
    catch (error) { report.cleanup.push({ participant: person.label, error: error.message }); report.assessment = 'FAIL'; }
  }
  for (const env of [...environments].reverse()) {
    try { await env.server?.close(); report.cleanup.push({ resource: `${env.label}/server`, status: 'closed' }); }
    catch (error) { report.cleanup.push({ resource: `${env.label}/server`, error: error.message }); report.assessment = 'FAIL'; }
    try { await env.database.stop(); report.cleanup.push({ resource: `${env.label}/postgres`, status: 'closed' }); }
    catch (error) { report.cleanup.push({ resource: `${env.label}/postgres`, error: error.message }); report.assessment = 'FAIL'; }
  }
  const after = await sourceIdentity();
  report.sourceUnchanged = JSON.stringify(after.sourceHashes) === JSON.stringify(source.sourceHashes);
  if (!report.sourceUnchanged) report.assessment = 'FAIL';
  report.resourcesClosed = report.cleanup.every(item => item.status === 'closed');
  report.finishedAt = new Date().toISOString(); report.actualElapsedMs = performance.now() - started;
  await recorder.close(); await saveJSON(resolve(output, 'result.json'), report);
  console.log(JSON.stringify({ assessment: report.assessment, cases: report.cases.length, resourcesClosed: report.resourcesClosed, sourceUnchanged: report.sourceUnchanged, output }));
  if (report.assessment !== 'PASS') process.exitCode = 1;
}
