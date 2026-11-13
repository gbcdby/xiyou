import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createRuntime } from '../runtime.mjs';
import { gaolaoRoom, accepted, openDoor } from '../test-support/gaolao-room.mjs';
import { proposeFollow } from '../../frontend/src/domain/gaolao-actions.ts';

let db, runtime;
const clock = { value: Date.parse('2026-11-13T16:00:00Z') };
before(async () => {
  db = await startTestPostgres('gaolao-follow-proposal', { outputSubdirectory: 'follow-proposal' });
  runtime = await createRuntime({ pool: db.pool, now: () => clock.value });
});
after(async () => { await runtime?.close(); await db?.stop(); });

// 使用生产客户端的动作构造函数；人类请求不得取翠兰私有投影中的版本。
async function visibleProposal(r, who, destinationId = 'front-guest-room') {
  const snapshot = await r.snapshot(who), subject = snapshot.projection.entities.find(e => e.name === '翠兰');
  assert.ok(subject, '必须先真实走到可见本人附近');
  const action = proposeFollow(snapshot.projection, subject.entityRef, snapshot.projection.self.entityRef, destinationId, true);
  assert.ok(action, '正常表单必须能由自己的视图准备提议');
  return { snapshot, subject, action, raw: await r.raw(who, action) };
}

test('SP06：未参与旧许可的新领路者只凭自己可见表单即可重新提议，本人未同意前不能随行', async t => {
  const r = await gaolaoRoom(runtime, clock, 2);
  await openDoor(r);
  const leader = r.role('B'), nextLeader = 1 - leader;
  const first = await visibleProposal(r, leader);
  accepted(await runtime.submit(r.handles[leader], first.raw));
  const own = await r.snapshot('cuilan'), oldConsent = own.projection.chapter.consents.find(c => c.purpose === 'follow');
  accepted(await r.send('cuilan', { kind: 'respond_consent', consentId: oldConsent.consentId, expectedConsentVersion: oldConsent.version, response: 'accept' }));
  await r.go(nextLeader, r.C('C08'));
  const fresh = await visibleProposal(r, nextLeader, 'tea-back-room');
  assert.deepEqual(fresh.snapshot.projection.chapter.consents, [], '新领路者不能收到上一份私有许可');
  assert.deepEqual(fresh.snapshot.projection.chapter.follows, [], '新领路者不能收到上一条私有路线');
  const before = await runtime.replay(r.sessionId), receipt = await runtime.submit(r.handles[nextLeader], fresh.raw);
  t.diagnostic(JSON.stringify({ newLeaderAction: fresh.action, receipt, oldConsentVersion: before.chapter.consents[oldConsent.consentId].version }));
  accepted(receipt, '由新领路者自己的可见表单重新提议');
  const after = await runtime.replay(r.sessionId), subjectId = r.content.chapterRules.people.cuilan, follow = after.chapter.follows[subjectId];
  assert.equal(follow.status, 'proposed');
  assert.equal(follow.leaderId, after.members[nextLeader].characterId);
  assert.equal(follow.destinationId, 'tea-back-room');
  assert.notEqual(follow.consentId, oldConsent.consentId);
  assert.equal(after.chapter.consents[oldConsent.consentId].status, 'withdrawn');
  assert.equal(after.chapter.consents[follow.consentId].status, 'proposed');
  assert.deepEqual(after.characters[subjectId].position, before.characters[subjectId].position);
  await r.step(1000);
  assert.deepEqual((await runtime.replay(r.sessionId)).characters[subjectId].position, before.characters[subjectId].position, '提议不能替本人接受或开始移动');
});

async function twoNearbyRequesters(count = 2) {
  const r = await gaolaoRoom(runtime, clock, count);
  await openDoor(r);
  await r.go(1 - r.role('B'), r.C('C08'));
  return r;
}
const consentCount = state => Object.values(state.chapter.consents).filter(c => c.purpose === 'follow').length;
function unchangedRejection(receipt, code) {
  assert.equal(receipt.status, 'Rejected');
  assert.equal(receipt.code, code);
  assert.equal(receipt.actionEventRange, null);
  assert.deepEqual(receipt.result, {});
}

test('SP06：相同公开人物版本的并发提议只提交一次，成功与拒绝的原串都稳定', async () => {
  const r = await twoNearbyRequesters();
  const prepared = await Promise.all([visibleProposal(r, 0), visibleProposal(r, 1, 'tea-back-room')]);
  assert.equal(prepared[0].action.expectedTargetRevision, prepared[1].action.expectedTargetRevision);
  const receipts = await Promise.all(prepared.map((p, who) => runtime.submit(r.handles[who], p.raw)));
  assert.equal(receipts.filter(receipt => receipt.status === 'Accepted').length, 1);
  unchangedRejection(receipts.find(receipt => receipt.status === 'Rejected'), 'STALE_PRECONDITION');
  const committed = await runtime.replay(r.sessionId);
  assert.equal(consentCount(committed), 1);
  for (const [who, p] of prepared.entries()) {
    assert.deepEqual(await runtime.submit(r.handles[who], p.raw), receipts[who]);
    const changed = JSON.parse(p.raw); changed.action.destinationId = who === 0 ? 'tea-back-room' : 'front-guest-room';
    await assert.rejects(runtime.submit(r.handles[who], JSON.stringify(changed)), { code: 'ACTION_ID_REUSE' });
  }
  assert.deepEqual(await runtime.replay(r.sessionId), committed, '重放不能创建第二许可或改写当前安排');
});

for (const legacyFirst of [true, false]) {
  test(`SP06：${legacyFirst ? '旧格式先提交' : '公开参数先提交'}时，另一格式的旧并发依据同样失效`, async () => {
    const r = await twoNearbyRequesters();
    const old = await visibleProposal(r, 0), modern = await visibleProposal(r, 1, 'tea-back-room');
    assert.deepEqual(old.snapshot.projection.chapter.consents, []);
    const { expectedTargetRevision, ...scope } = old.action;
    const legacy = await r.raw(0, { ...scope, expectedConsentVersion: '0' });
    const first = legacyFirst ? [0, legacy] : [1, modern.raw], second = legacyFirst ? [1, modern.raw] : [0, legacy];
    const receipt = accepted(await runtime.submit(r.handles[first[0]], first[1]));
    unchangedRejection(await runtime.submit(r.handles[second[0]], second[1]), legacyFirst ? 'STALE_PRECONDITION' : 'CONSENT_STALE');
    const state = await runtime.replay(r.sessionId);
    assert.equal(consentCount(state), 1);
    assert.equal(state.characters[r.content.chapterRules.people.cuilan].resourceRevision, String(BigInt(expectedTargetRevision) + 1n));
    assert.deepEqual(await runtime.submit(r.handles[first[0]], first[1]), receipt, '兼容格式原串仍能恢复原 Receipt');
  });
}

test('SP06：本人接受或撤回后，准备中的公开参数须重新读取；新请求不能复用旧依据', async () => {
  const r = await twoNearbyRequesters();
  const first = await visibleProposal(r, 0);
  accepted(await runtime.submit(r.handles[0], first.raw));
  const beforeAccept = await visibleProposal(r, 1, 'tea-back-room');
  let consent = (await r.snapshot('cuilan')).projection.chapter.consents.find(c => c.purpose === 'follow');
  accepted(await r.send('cuilan', { kind: 'respond_consent', consentId: consent.consentId, expectedConsentVersion: consent.version, response: 'accept' }));
  unchangedRejection(await runtime.submit(r.handles[1], beforeAccept.raw), 'STALE_PRECONDITION');
  const beforeWithdraw = await visibleProposal(r, 1, 'tea-back-room');
  consent = (await r.snapshot('cuilan')).projection.chapter.consents.find(c => c.purpose === 'follow');
  accepted(await r.send('cuilan', { kind: 'withdraw_consent', consentId: consent.consentId, expectedConsentVersion: consent.version }));
  unchangedRejection(await runtime.submit(r.handles[1], beforeWithdraw.raw), 'STALE_PRECONDITION');
  unchangedRejection(await r.send(1, beforeAccept.action), 'STALE_PRECONDITION');
  const fresh = await visibleProposal(r, 1, 'tea-back-room');
  accepted(await runtime.submit(r.handles[1], fresh.raw));
  const state = await runtime.replay(r.sessionId), follow = state.chapter.follows[r.content.chapterRules.people.cuilan];
  assert.equal(consentCount(state), 2);
  assert.equal(follow.status, 'proposed');
  assert.equal(state.chapter.cuilanSafe, false);
  unchangedRejection(await r.send(1, { kind: 'respond_consent', consentId: follow.consentId, expectedConsentVersion: follow.consentVersion, response: 'accept' }), 'STALE_REFERENCE');
});

test('SP06：公开参数仍绑定当前观察者引用、真实本人、在线领路者与有限目的地', async () => {
  const r = await twoNearbyRequesters(3), own = await visibleProposal(r, 0), other = await visibleProposal(r, 1);
  unchangedRejection(await r.send(0, { ...own.action, subjectRef: other.subject.entityRef }), 'STALE_REFERENCE');
  unchangedRejection(await r.send(0, { ...own.action, subjectRef: own.snapshot.projection.self.entityRef }), 'RULE_VIOLATION');
  unchangedRejection(await r.send(0, { ...own.action, leaderRef: own.subject.entityRef }), 'RULE_VIOLATION');
  unchangedRejection(await r.send(0, { ...own.action, destinationId: 'not-a-follow-destination' }), 'TARGET_UNAVAILABLE');
  await r.go('cuilan', r.C('C08'));
  const moved = await visibleProposal(r, 0);
  assert.equal(moved.action.expectedTargetRevision, own.action.expectedTargetRevision, '普通本人行走不推进语义人物版本');
  const otherName = other.snapshot.projection.self.name;
  const otherInOwnView = (await r.snapshot(0)).projection.entities.find(e => e.name === otherName);
  await runtime.disconnect(r.handles[1]);
  unchangedRejection(await r.send(0, { ...moved.action, leaderRef: otherInOwnView.entityRef }), 'RULE_VIOLATION');
  assert.equal(consentCount(await runtime.replay(r.sessionId)), 0, '所有拒绝都不能创建许可');
});

test('SP06：已知原串在控制与视图变化后恢复原 Receipt，尚未提交的旧身份首次处理仍拒绝', async () => {
  const r = await twoNearbyRequesters(), done = await visibleProposal(r, 0);
  const receipt = accepted(await runtime.submit(r.handles[0], done.raw));
  const pending = await visibleProposal(r, 0, 'tea-back-room'), s = await r.snapshot(0);
  const control = await runtime.control(r.handles[0], JSON.stringify({ schemaVersion: 2, type: 'control.take', sessionId: r.sessionId, viewId: s.viewId, actorRef: s.projection.self.entityRef, nonce: crypto.randomUUID() }));
  assert.notEqual(control.controlEpoch, s.projection.self.controlEpoch);
  assert.notEqual(control.snapshot.viewId, s.viewId);
  assert.deepEqual(await runtime.submit(r.handles[0], done.raw), receipt);
  unchangedRejection(await runtime.submit(r.handles[0], pending.raw), 'STALE_CONTROL');
  const staleView = { ...JSON.parse(pending.raw), clientActionId: crypto.randomUUID(), controlEpoch: control.controlEpoch };
  unchangedRejection(await runtime.submit(r.handles[0], JSON.stringify(staleView)), 'STALE_REFERENCE');
  const changed = JSON.parse(done.raw); changed.controlEpoch = control.controlEpoch;
  await assert.rejects(runtime.submit(r.handles[0], JSON.stringify(changed)), { code: 'ACTION_ID_REUSE' });
  assert.equal(consentCount(await runtime.replay(r.sessionId)), 1);
  const current = await visibleProposal(r, 0, 'tea-back-room');
  accepted(await runtime.submit(r.handles[0], current.raw));
  assert.equal(consentCount(await runtime.replay(r.sessionId)), 2, '当前身份的新提议仍可进行');
});
