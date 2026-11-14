import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createRuntime } from '../runtime.mjs';
import { executeSpatial } from '../spatial-runtime.mjs';
import { gaolaoRoom, openDoor, accepted } from '../test-support/gaolao-room.mjs';
import { personalDecisionBinding } from '../../game/gaolao-personal-contract.mjs';

let db, runtime;
const clock = { value: Date.parse('2026-11-14T10:00:00Z') };
before(async () => { db = await startTestPostgres('personal-requests', { outputSubdirectory: 'cuilan-authority-implement' }); runtime = await createRuntime({ pool: db.pool, now: () => clock.value }); });
after(async () => { await runtime?.close(); await db?.stop(); });

// 这里只验证权威请求合同；开门 fixture 明确控制本人退让，不能代表生产场景选择。
async function roomAtOwner() {
  const r = await gaolaoRoom(runtime, clock, 2, 'gaolaozhuang-scene-v3');
  await openDoor(r);
  const owner = (await r.snapshot('cuilan')).projection.self;
  for (const who of [0, 1]) await r.go(who, owner);
  return r;
}
async function describe(r, who) {
  accepted(await r.interact(who, '翠兰', 'gz-describe-private-items'));
  return (await r.snapshot(who)).projection.chapter.privateItemOffers[0];
}
async function request(r, who, offer, extra = {}) {
  return r.interact(who, '翠兰', 'gz-request-private-items', { offerRef: offer.offerRef, itemOptionRefs: offer.options.map(option => option.optionRef), permissionTerm: 'single_use', ...extra });
}

test('目录只给有限名目：不是实体引用，旧字段不能授权新本人请求', async () => {
  const r = await roomAtOwner(), offer = await describe(r, 0), other = await describe(r, 1);
  assert.equal(offer.options.length, 2); assert.notEqual(offer.offerRef, other.offerRef);
  assert.ok(!JSON.stringify(offer).includes('itemRef')); assert.ok(!JSON.stringify(offer).includes('position'));
  assert.equal((await r.send(0, { kind: 'take_item', itemRef: offer.options[0].optionRef, expectedItemRevision: '0' })).code, 'STALE_REFERENCE');
  assert.equal((await request(r, 1, offer)).code, 'STALE_REFERENCE');
  assert.equal((await r.interact(0, '翠兰', 'gz-request-private-items', { itemRefs: [offer.options[0].optionRef], expectedConsentVersion: '0' })).code, 'RULE_VIOLATION');
  accepted(await request(r, 0, offer, { permissionTerm: 'reusable' }));
  const state = await runtime.replay(r.sessionId), ownerId = r.content.chapterRules.people.cuilan;
  const binding = personalDecisionBinding(state, ownerId, 'private_items');
  assert.equal(binding.status, 'proposed'); assert.equal(binding.permissionTerm, 'reusable'); assert.equal(binding.lifecycle, 'open');
  const received = state.chapter.provenance[ownerId][binding.proposalBinding.requestObservationRef].retainedObservation;
  assert.ok(received.fields.some(field => field.key === 'permissionTerm' && field.value === 'reusable'));
  assert.equal(received.sourceSeq, binding.proposalBinding.sourceSeq); assert.equal(received.source.receivedSeq, binding.proposalBinding.receivedSeq);
  assert.equal(received.shareable, false); assert.equal(state.chapter.cuilanSafe, false);
});

test('公开 CAS、两版本取消与同人显式替换保留本人决定及旧 Receipt', async () => {
  const r = await roomAtOwner(), first = await describe(r, 0), second = await describe(r, 1);
  const owner0 = await r.entity(0, '翠兰'), owner1 = await r.entity(1, '翠兰');
  const action = (owner, offer) => ({ kind: 'interact', operationId: 'gz-request-private-items', targetRef: owner.entityRef, expectedTargetRevision: owner.resourceRevision, parameters: { offerRef: offer.offerRef, itemOptionRefs: [offer.options[0].optionRef], permissionTerm: 'single_use' } });
  const raw = await r.raw(0, action(owner0, first));
  const receipt = accepted(await runtime.submit(r.handles[0], raw));
  assert.equal((await r.send(1, action(owner1, second))).code, 'STALE_PRECONDITION');
  assert.equal((await request(r, 1, second)).code, 'NOT_READY');
  assert.equal((await request(r, 0, first)).code, 'NOT_READY');
  let projection = (await r.snapshot(0)).projection, current = projection.chapter.personalRequests[0], consent = projection.chapter.consents.find(c => c.consentId === current.consentId);
  const replacement = { consentId: consent.consentId, expectedConsentVersion: consent.version, expectedLifecycleVersion: current.lifecycleVersion };
  accepted(await request(r, 0, first, { replacement, permissionTerm: 'reusable' }));
  let state = await runtime.replay(r.sessionId);
  assert.equal(state.chapter.consents[consent.consentId].status, 'proposed');
  assert.equal(state.chapter.personalRequests[consent.consentId].lifecycle, 'superseded');
  assert.equal(state.chapter.personalRequests[consent.consentId].reasonCode, 'replaced_by_requester');
  assert.equal((await r.send(0, { kind: 'cancel_personal_request', ...replacement })).code, 'CONSENT_STALE');
  projection = (await r.snapshot(0)).projection; current = projection.chapter.personalRequests[0]; consent = projection.chapter.consents.find(c => c.consentId === current.consentId);
  accepted(await r.send(0, { kind: 'cancel_personal_request', consentId: consent.consentId, expectedConsentVersion: consent.version, expectedLifecycleVersion: current.lifecycleVersion }));
  accepted(await request(r, 1, second));
  state = await runtime.replay(r.sessionId);
  assert.equal(state.chapter.consents[consent.consentId].status, 'proposed'); assert.equal(state.chapter.consents[consent.consentId].decidedBy, null);
  assert.equal(state.chapter.personalRequests[consent.consentId].reasonCode, 'replaced_after_closed');
  assert.deepEqual(await runtime.submit(r.handles[0], raw), receipt);
  assert.equal(Object.keys(state.chapter.consents).length, 3);
});

test('两个真实并发请求只接纳一份；待答绑定变化只结束提议，不造本人撤回', async () => {
  const r = await roomAtOwner(), offers = await Promise.all([describe(r, 0), describe(r, 1)]), raws = [];
  for (const who of [0, 1]) { const owner = await r.entity(who, '翠兰'); raws.push(await r.raw(who, { kind: 'interact', targetRef: owner.entityRef, operationId: 'gz-request-private-items', expectedTargetRevision: owner.resourceRevision, parameters: { offerRef: offers[who].offerRef, itemOptionRefs: [offers[who].options[0].optionRef], permissionTerm: 'single_use' } })); }
  const receipts = await Promise.all(raws.map((raw, who) => runtime.submit(r.handles[who], raw)));
  assert.equal(receipts.filter(receipt => receipt.status === 'Accepted').length, 1);
  assert.equal(receipts.filter(receipt => receipt.code === 'STALE_PRECONDITION').length, 1);
  const winner = receipts.findIndex(receipt => receipt.status === 'Accepted'), before = await runtime.replay(r.sessionId), subjectId = r.content.chapterRules.people.cuilan;
  const binding = personalDecisionBinding(before, subjectId, 'private_items');
  const snapshot = await r.snapshot(winner);
  await runtime.control(r.handles[winner], JSON.stringify({ schemaVersion: 2, type: 'control.take', sessionId: r.sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce: crypto.randomUUID() }));
  const after = await runtime.replay(r.sessionId), record = after.chapter.personalRequests[binding.consentId];
  assert.equal(record.lifecycle, 'closed'); assert.equal(record.reasonCode, 'proposal_invalidated'); assert.equal(record.execution.state, 'none'); assert.equal(record.notice, null);
  assert.equal(after.chapter.consents[binding.consentId].status, 'proposed'); assert.equal(after.chapter.consents[binding.consentId].decidedBy, null);
  assert.deepEqual(record.proposalBinding, binding.proposalBinding);
  assert.deepEqual(await runtime.submit(r.handles[winner], raws[winner]), receipts[winner]);
  const other = 1 - winner; accepted(await request(r, other, offers[other]));
  assert.equal(personalDecisionBinding(await runtime.replay(r.sessionId), subjectId, 'private_items').consentVersion, '2');
});

test('原 Receipt 先于首次领域读取：当前新记录损坏且租约已过期仍可只读恢复历史', async () => {
  const r = await roomAtOwner(), offer = await describe(r, 0), owner = await r.entity(0, '翠兰');
  const raw = await r.raw(0, { kind: 'interact', targetRef: owner.entityRef, operationId: 'gz-request-private-items', expectedTargetRevision: owner.resourceRevision, parameters: { offerRef: offer.offerRef, itemOptionRefs: [offer.options[0].optionRef], permissionTerm: 'single_use' } });
  const receipt = accepted(await runtime.submit(r.handles[0], raw));
  clock.value += 61_000;
  const recovered = await runtime.locked(r.sessionId, { kind: 'authority-corrupt-readonly-fixture' }, async tx => {
    const principal = await runtime.access(tx.client, tx.row, r.users[0].token);
    // 仅破坏本次事务内克隆；原 Receipt 读取应不产生事件，不把此 fixture 存入世界。
    delete tx.state.chapter.personalRequests;
    const result = await executeSpatial(runtime, tx, JSON.parse(raw), { ...principal, principalKind: 'human' }, async () => false);
    assert.equal(tx.events.length, 0); return result;
  });
  assert.deepEqual(recovered, receipt);
  assert.ok((await runtime.replay(r.sessionId)).chapter.personalRequests, '没有把损坏 fixture 写回数据库');
});
