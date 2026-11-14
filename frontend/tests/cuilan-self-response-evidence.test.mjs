import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCompleteReport, caseIds, holdSubmissions, holdCommittedReceipt, deferLeaseMaintenance } from './cuilan-self-response-support.mjs';
import { assertRestartFaultReport } from './cuilan-self-response-restart.mjs';
import { assertBothActiveEffects, assertSharedStopTransaction, assertOriginalReceiptRead, tracePersonalTransactions } from '../../backend/test-support/personal-shared-effects.mjs';
import { waitForPersonalWithdrawals } from '../../backend/test-support/cuilan-personal-restart-worker.mjs';

test('B真实void等待契约之后保留两条实际C2及Receipt，经IPC序列化仍完整', async () => {
  const rows = ['appearance', 'private_items'].map(consentId => ({ intent_id: 'intent-' + consentId, actor_id: 'cuilan', request: { action: { kind: 'withdraw_consent', consentId } }, execution_context: { mode: 'scene-policy' }, receipt: { publicReceipt: { status: 'Accepted', clientActionId: 'action-' + consentId } } }));
  let calls = 0;
  const pool = { async query(_sql, bindings) { assert.deepEqual(bindings, ['session', 'cuilan']); calls++; return { rows: calls === 1 ? [] : calls === 2 ? [rows[0], { ...rows[1], receipt: { publicReceipt: { status: 'Rejected' } } }] : rows }; } };
  const c2 = await waitForPersonalWithdrawals(pool, 'session', 'cuilan', ['appearance', 'private_items']);
  assert.equal(calls, 3, '缺行或Rejected不能提前收口');
  assert.deepEqual(c2, rows, '等待完成后必须返回真实查询所得两行，不能把void当数组');
  assert.deepEqual(JSON.parse(JSON.stringify({ type: 'complete', result: { c2 } })).result.c2, rows);
  const failure = new Error('保留查询异常');
  await assert.rejects(waitForPersonalWithdrawals({ async query() { throw failure; } }, 'session', 'cuilan', ['appearance', 'private_items']), error => error === failure);
});

test('提交窗口只延迟匹配原请求，this/raw/异常不变，清场释放未满窗口', async () => {
  const calls = [], failure = new Error('原执行失败');
  const runtime = { async submit(handle, raw) { assert.equal(this, runtime); calls.push({ handle, raw }); if (handle === 'fail') throw failure; return raw; } };
  const original = runtime.submit, gate = holdSubmissions(runtime, request => request.operation === 'race', 2);
  const first = JSON.stringify({ operation: 'race', nonce: '1' }), second = JSON.stringify({ operation: 'race', nonce: '2' });
  const a = runtime.submit('a', first), b = runtime.submit('b', second);
  assert.deepEqual((await gate.ready).map(row => row.raw), [first, second]); assert.deepEqual(calls, []);
  gate.release(); assert.deepEqual(await Promise.all([a, b]), [first, second]); gate.close();
  assert.equal(runtime.submit, original);
  await assert.rejects(runtime.submit('fail', '{}'), error => error === failure);
  const incomplete = holdSubmissions(runtime, () => true, 2), pending = runtime.submit('a', first);
  incomplete.close(); assert.equal(await pending, first);
});

test('迟收据窗口仅扣住实际原结果和原历史读取，不重新提交或伪造收据', async () => {
  let submits = 0, reads = 0;
  const value = { status: 'Accepted', clientActionId: 'a' };
  const runtime = { async submit() { assert.equal(this, runtime); submits++; return value; }, async receipt(_token, sessionId, actionId) { assert.equal(this, runtime); reads++; return sessionId === 's' && actionId === 'a' ? value : null; } };
  const gate = holdCommittedReceipt(runtime, request => request.clientActionId === 'a');
  const raw = JSON.stringify({ sessionId: 's', clientActionId: 'a' });
  let originalDelivered = false, retryDelivered = false;
  const pending = runtime.submit({}, raw).then(result => { originalDelivered = true; return result; });
  const held = await gate.ready; assert.equal(held.receipt, value); assert.equal(submits, 1);
  assert.equal(held.raw, raw); assert.ok(Number.isFinite(Date.parse(held.committedAt)));
  const retry = runtime.submit({}, raw).then(result => { retryDelivered = true; return result; });
  const read = runtime.receipt('不记录凭据', 's', 'a'); assert.equal(reads, 0);
  assert.equal(await runtime.receipt('不记录凭据', 's', 'other'), null);
  await new Promise(setImmediate);
  assert.equal(originalDelivered, false); assert.equal(retryDelivered, false, '实际同ID重试不能提前泄露原收据');
  gate.close(); assert.equal(await pending, value); assert.equal(await retry, value); assert.equal(await read, value);
  assert.equal(submits, 2, '只有测试实际发出的原提交和一次重试，窗口自身不重交');
});

test('租约故障只阻止指定连接续租和指定房间维护，其他参与者原路径保持', async () => {
  const heartbeats = [], maintenance = [];
  const runtime = { async heartbeat(handle) { assert.equal(this, runtime); heartbeats.push(handle); }, async maintenance(id) { assert.equal(this, runtime); maintenance.push(id); } };
  const originalHeartbeat = runtime.heartbeat, originalMaintenance = runtime.maintenance;
  const gate = deferLeaseMaintenance(runtime, 's', 'expired');
  await runtime.heartbeat({ connectionId: 'expired' }); await runtime.heartbeat({ connectionId: 'live' });
  await runtime.maintenance('s'); await runtime.maintenance('other');
  assert.deepEqual(heartbeats, [{ connectionId: 'live' }]); assert.deepEqual(maintenance, ['other']);
  assert.deepEqual(gate.calls, { droppedHeartbeat: 1, otherHeartbeat: 1, deferredMaintenance: 1 });
  gate.close(); assert.equal(runtime.heartbeat, originalHeartbeat); assert.equal(runtime.maintenance, originalMaintenance);
});

// 以下仅为判据的正负对照数据，不是任何真实产品或故障执行证据。
function sharedFixture() {
  const purposes = Object.fromEntries(['appearance', 'private_items'].map(purpose => [purpose, {
    consent: { consentId: purpose, status: 'accepted', version: '2', performerId: purpose === 'appearance' ? 'wukong' : null },
    request: { proposalBinding: { requesterEpoch: '1', source: purpose }, execution: { state: 'active', acceptedProof: { consentVersion: '2', sources: [{ sourceId: purpose, sourceRevision: '1' }] }, appearanceStarted: purpose === 'appearance', appearanceEnded: false } },
  }]));
  const before = { sessionSeq: '10', paused: false, actor: { id: 'human', epoch: '1' }, disguise: { actorId: 'wukong', consentId: 'appearance' }, purposes,
    held: { item: { personalAcquisitionId: 'acquisition', location: { kind: 'character', characterId: 'human' } }, acquisition: { acquisitionId: 'acquisition', holderId: 'human', outcome: 'held', originalConsentId: 'private_items', takeActionId: 'take-original' } } };
  const after = structuredClone(before); after.sessionSeq = '15'; after.actor.epoch = '2'; after.disguise = null; after.paused = true;
  for (const purpose of ['appearance', 'private_items']) {
    after.purposes[purpose].request.execution.state = purpose === 'appearance' ? 'ended' : 'return_only';
    after.purposes[purpose].request.notice = { sourceEventId: 'E11', sourceSeq: '11' };
  }
  after.purposes.appearance.request.execution.appearanceEnded = true;
  const transaction = { command: 'spatial-recovery', committed: true, before: structuredClone(before), after,
    events: [{ eventId: 'E11', sessionSeq: '11', kind: 'control.changed', payload: { actorId: 'human', controlEpoch: '2' } }, { eventId: 'E15', sessionSeq: '15', kind: 'gaolao.chapter' }], outbox: { from_exclusive: '10', through_seq: '15' } };
  const original = { player: 0, raw: JSON.stringify({ sessionId: 'room', clientActionId: 'take-original', viewId: 'old-view', controlEpoch: '1', action: { kind: 'take_item' } }), receipt: { status: 'Accepted', clientActionId: 'take-original', observedSeq: '9' } };
  const read = { command: 'receipt', committed: true, before: structuredClone(after), after: structuredClone(after), events: [] };
  const c2 = ['appearance', 'private_items'].map(consentId => ({ request: { action: { kind: 'withdraw_consent', consentId } }, receipt: { publicReceipt: { status: 'Accepted' } }, execution_context: { mode: 'scene-policy' } }));
  return { before, transaction, original, read, c2 };
}
function completed() {
  const source = { commit: 'fixed', tree: 'fixed-tree', status: '' };
  const sample = sharedFixture();
  return { executionKind: 'production_browser', source, sourceEnd: { ...source }, realProviderCalls: 0, pageErrors: [], externalRequests: [],
    cases: caseIds.map(id => ({ id, status: 'PASS', evidence: ['actual'] })),
    rooms: ['gaolaozhuang-scene-v3', 'gaolaozhuang-tools-east-scene-v3'].map((contentVersion, index) => ({ sessionId: 'room-' + index, contentVersion, count: 2, profile: 'production-cuilan-v1', audited: true, defaultEntry: index === 0 })),
    humanActions: [{}], npcActions: [{}], wireActions: [{}], authority: [0, 1].map(index => ({ sessionId: 'room-' + index, humanActionCount: 1, receipts: [{}], sceneIntents: [{}], worldEvents: [{}] })),
    leaseFault: { status: 'PASS', sharedEffects: { before: sample.before, firstStop: sample.transaction, applyReceipt: { status: 'Accepted' }, receiptRead: { original: sample.original, actual: structuredClone(sample.original.receipt), transaction: sample.read },
      reconnected: { oldView: 'old', newView: 'new', remaining: { returnContextId: 'acquisition', mode: 'return_only' }, acquisition: { outcome: 'delivered_to_owner' }, returned: { receipt: { status: 'Accepted' } }, c2: sample.c2 } } }, resources: Array(65).fill({}), resourcesClosed: true, cleanup: [{ status: 'PASS' }] };
}
test('E2收口拒绝未执行/替身/脏树/缺变体/缺真实租约与清场证据', () => {
  assert.doesNotThrow(() => assertCompleteReport(completed()));
  for (const mutate of [r => { r.cases[4].status = 'NOT_RUN'; }, r => { r.cases[4].evidence = []; }, r => { r.executionKind = 'contract'; }, r => { r.source.status = ' M source'; }, r => { r.sourceEnd.tree = 'other'; }, r => { r.rooms.pop(); }, r => { r.wireActions = []; }, r => { r.authority = []; }, r => { r.authority[0].receipts = []; }, r => { r.authority[0].worldEvents = []; }, r => { r.leaseFault.status = 'NOT_RUN'; }, r => { r.resourcesClosed = false; }, r => { r.cleanup[0].status = 'FAIL'; }]) {
    const report = completed(); mutate(report); assert.throws(() => assertCompleteReport(report));
  }
});

test('共享故障收口拒绝READY、假持物、缺同事务水位、改原proof或查询新增事件', () => {
  const legacy = completed(); legacy.leaseFault = { status: 'PASS' }; assert.throws(() => assertCompleteReport(legacy));
  for (const mutate of [s => { s.before.purposes.appearance.request.execution.state = 'ready'; }, s => { s.before.held.item.location = { kind: 'held', ownerId: 'human' }; }, s => { s.firstStop.outbox.through_seq = '16'; }, s => { s.firstStop.after.purposes.private_items.request.execution.acceptedProof.sources[0].sourceRevision = '2'; }, s => { s.firstStop.after.purposes.appearance.consent.status = 'withdrawn'; }, s => { s.receiptRead.transaction.events.push({ kind: 'spatial.item' }); }]) {
    const report = completed(); mutate(report.leaseFault.sharedEffects); assert.throws(() => assertCompleteReport(report));
  }
});

function restartCompleted() {
  const { before, transaction, original, read, c2 } = sharedFixture(), source = { commit: 'fixed', tree: 'fixed-tree', status: '' };
  const beforeKill = { sample: before, sessionSeq: '10', stateSha256: 'pure-fixture' };
  return { executionKind: 'production-process-restart-controlled-clock', source, sourceEnd: { ...source }, crashedExit: { code: null, signal: 'SIGKILL' }, resumedExit: { code: 0, signal: null },
    prepare: { before, originalTake: original, applyReceipt: { status: 'Accepted' } }, beforeKill, afterKill: structuredClone(beforeKill), recovery: transaction,
    postRecovery: { beforeRecovery: structuredClone(before), recovery: structuredClone(transaction), originalTake: structuredClone(original), receiptRead: { actual: structuredClone(original.receipt), transaction: read }, receiptRetry: { actual: structuredClone(original.receipt), transaction: { ...structuredClone(read), command: 'spatial-action' } },
      oldView: 'old', newView: 'new', remaining: { returnContextId: 'acquisition', mode: 'return_only' }, acquisition: { outcome: 'delivered_to_owner' }, returned: { status: 'Accepted' }, oldApplyRejected: { status: 'Rejected' }, c2, realProviderCalls: 0, controlledBindings: ['tang', 'wukong', 'bajie'].map(key => ({ key })) },
    stages: { prepare: 'PASS', crash: 'PASS', recovery: 'PASS', postRecovery: 'PASS' }, cleanup: ['first', 'second', 'postgres'].map(name => ({ name, status: 'PASS' })) };
}
test('B收口要求kill后PG双ACTIVE、真实恢复围栏、原raw/Receipt和分别成功清场', () => {
  assert.doesNotThrow(() => assertRestartFaultReport(restartCompleted()));
  for (const mutate of [r => { r.crashedExit.signal = 'SIGTERM'; }, r => { delete r.afterKill; }, r => { r.afterKill.sample.purposes.private_items.request.execution.state = 'return_only'; }, r => { r.postRecovery.beforeRecovery.held.acquisition.takeActionId = 'new'; }, r => { r.recovery.after.actor.epoch = '1'; }, r => { r.postRecovery.receiptRetry.actual.observedSeq = '100'; }, r => { r.postRecovery.receiptRetry.transaction.events.push({ kind: 'spatial.item' }); }, r => { r.postRecovery.c2.pop(); }, r => { r.stages.postRecovery = 'NOT_RUN'; }, r => { r.cleanup[1].status = 'FAIL'; }]) {
    const report = restartCompleted(); mutate(report); assert.throws(() => assertRestartFaultReport(report));
  }
});
test('只读事务采样保留原this/operation/结果/异常，提交标志不能伪装', async () => {
  const fixture = sharedFixture(), context = { actorId: 'human', itemId: 'item', acquisitionId: 'acquisition', appearance: 'appearance', private_items: 'private_items' };
  const state = { sessionSeq: '10', paused: false, characters: { human: { controlEpoch: '1' } }, chapter: { disguise: fixture.before.disguise, consents: {}, personalRequests: {}, privateAcquisitions: { acquisition: fixture.before.held.acquisition } }, items: { item: fixture.before.held.item } };
  for (const [purpose, value] of Object.entries(fixture.before.purposes)) { state.chapter.consents[purpose] = value.consent; state.chapter.personalRequests[purpose] = value.request; }
  const failure = new Error('保留原异常'), runtime = { async locked(id, command, operation) { assert.equal(this, runtime); const tx = { state, events: [], afterFinish: [] }; let committed = false; try { const value = await operation(tx); committed = true; return value; } finally { tx.afterFinish.forEach(close => close({ committed, committing: false })); } } };
  const original = runtime.locked, trace = tracePersonalTransactions(runtime, 'room', context);
  assert.equal(await runtime.locked('room', { kind: 'receipt' }, () => 'original'), 'original');
  await assert.rejects(runtime.locked('room', { kind: 'receipt' }, () => { throw failure; }), error => error === failure);
  assert.equal(trace.records[0].committed, true); assert.equal(trace.records[1].committed, false);
  assertBothActiveEffects(trace.records[0].before);
  assert.throws(() => assertOriginalReceiptRead(fixture.original, fixture.original.receipt, trace.records[1]));
  assertSharedStopTransaction(fixture.before, fixture.transaction);
  trace.close(); assert.equal(runtime.locked, original);
});
