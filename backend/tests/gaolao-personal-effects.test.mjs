import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalize } from '../../protocol/index.mjs';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createRuntime } from '../runtime.mjs';
import { executeSpatial } from '../spatial-runtime.mjs';
import { gaolaoRoom, openDoor, accepted, take } from '../test-support/gaolao-room.mjs';
import { personalDecisionBinding, ownPersonalSource } from '../../game/gaolao-personal-contract.mjs';
import { personalAppearancePathAllowed } from '../../game/gaolao-personal.mjs';
import { observeGaolao } from '../../game/gaolao-world.mjs';
import { opaqueRef, spatialProjection } from '../../game/spatial-world.mjs';

let db, runtime;
const clock = { value: Date.parse('2026-11-14T12:00:00Z') };
const caps = ['spatial-v2', 'gaolao-personal-consent-v1'];
const digest = value => createHash('sha256').update(canonicalize(value)).digest('hex');
before(async () => { db = await startTestPostgres('personal-effects', { outputSubdirectory: 'cuilan-authority-implement' }); runtime = await createRuntime({ pool: db.pool, now: () => clock.value }); });
after(async () => { await runtime?.close(); await db?.stop(); });

// AUTHORITY-CONTRACT：仅模拟 T02 重验成功后的 authority 字段；不运行完整 T02 parser/本人选择。
// 位置、开门、随行、安置、物件变化、控制事件、Receipt、恢复均执行实际规则与 PostgreSQL。
async function controlledDecision(r, consentId, response = 'accept', kind = 'respond_consent', mutate = () => {}) {
  const consent = (await runtime.replay(r.sessionId)).chapter.consents[consentId];
  const request = JSON.parse(await r.raw('cuilan', { kind, consentId, expectedConsentVersion: consent.version, ...(kind === 'respond_consent' ? { response } : {}) }));
  const principal = runtime.internal(r.actors.get('cuilan').handle);
  return runtime.locked(r.sessionId, { kind: 'authority-contract-basis' }, async tx => executeSpatial(runtime, tx, request, principal, async actor => actor.mode === 'CoreNPCControlled', { validate: () => {
    const source = ownPersonalSource(tx.state, tx.content, consent.subjectId, consent.purpose);
    const { knowledge, ...sourceBinding } = source ?? {};
    tx.scenePolicyAuthorization = { policyVersion: 'gaolao-cuilan-v2', actionId: request.clientActionId, requestDigest: digest(request), subjectEpoch: tx.state.characters[consent.subjectId].controlEpoch, ...(consent.purpose === 'follow' ? {} : { branch: consent.purpose, personal: personalDecisionBinding(tx.state, consent.subjectId, consent.purpose), sources: [sourceBinding] }) };
    mutate(tx.scenePolicyAuthorization);
  } }));
}
async function settledRoom(version = 'gaolaozhuang-scene-v3', destinationId = 'front-guest-room', count = 2) {
  const r = await gaolaoRoom(runtime, clock, count, version);
  await openDoor(r);
  const leader = r.role('B'), own = (await r.snapshot(leader)).projection.self, subject = await r.entity(leader, '翠兰');
  accepted(await r.send(leader, { kind: 'propose_follow', subjectRef: subject.entityRef, leaderRef: own.entityRef, destinationId, expectedTargetRevision: subject.resourceRevision }));
  const follow = (await r.snapshot('cuilan')).projection.chapter.follows[0];
  accepted(await controlledDecision(r, follow.consentId));
  await r.go(leader, r.content.chapterRules.safeDestinations.find(destination => destination.destinationId === destinationId));
  for (let i = 0; i < 25; i++) {
    await r.step(); const current = (await r.snapshot('cuilan')).projection.chapter.follows[0];
    if (current.status === 'arrived') { accepted(await r.interact('cuilan', 'self', 'gz-confirm-settlement', { consentId: current.consentId, expectedConsentVersion: current.consentVersion })); break; }
  }
  assert.equal((await runtime.replay(r.sessionId)).chapter.cuilanSafe, true);
  return r;
}
async function requestItems(r, who = 0, { both = true, permissionTerm = 'single_use', replacement } = {}) {
  const owner = (await r.snapshot('cuilan')).projection.self; await r.go(who, owner);
  accepted(await r.interact(who, '翠兰', 'gz-describe-private-items'));
  const offer = (await r.snapshot(who)).projection.chapter.privateItemOffers[0];
  accepted(await r.interact(who, '翠兰', 'gz-request-private-items', { offerRef: offer.offerRef, itemOptionRefs: offer.options.slice(0, both ? 2 : 1).map(option => option.optionRef), permissionTerm, ...(replacement ? { replacement } : {}) }));
  return (await r.snapshot(who)).projection.chapter.consents.filter(consent => consent.purpose === 'private_items').at(-1);
}
async function giveOwner(r, name, who = 0) {
  await r.go(who, (await r.snapshot('cuilan')).projection.self);
  const item = await r.entity(who, name), owner = await r.entity(who, '翠兰');
  return r.send(who, { kind: 'transfer_item', itemRef: item.entityRef, expectedItemRevision: item.resourceRevision, recipientRef: owner.entityRef });
}
async function cancel(r, who, consentId) {
  const projection = (await r.snapshot(who)).projection, consent = projection.chapter.consents.find(consent => consent.consentId === consentId), record = projection.chapter.personalRequests.find(record => record.consentId === consentId);
  accepted(await r.send(who, { kind: 'cancel_personal_request', consentId, expectedConsentVersion: consent.version, expectedLifecycleVersion: record.lifecycleVersion }));
}
function itemDefinitions(r) { return r.content.items.filter(item => r.content.chapterRules.privateItems.some(definition => definition.itemId === item.itemId && definition.ownerId === r.content.chapterRules.people.cuilan)); }

for (const version of ['gaolaozhuang-scene-v3', 'gaolaozhuang-tools-east-scene-v3']) test(`权威合同：${version} 两物各一次，先送第一件仍可取第二件；实收观察与 proof 不改写`, async () => {
  const r = await settledRoom(version), consent = await requestItems(r);
  assert.equal((await r.send('cuilan', { kind: 'respond_consent', consentId: consent.consentId, expectedConsentVersion: consent.version, response: 'accept' })).code, 'RULE_VIOLATION', '普通内部意图不能代替已重验 scene basis');
  assert.equal((await controlledDecision(r, consent.consentId, 'accept', 'respond_consent', basis => { basis.branch = 'appearance'; })).code, 'RULE_VIOLATION');
  assert.equal((await controlledDecision(r, consent.consentId, 'accept', 'respond_consent', basis => { basis.personal = { ...basis.personal, lifecycleVersion: '999' }; })).code, 'RULE_VIOLATION');
  accepted(await controlledDecision(r, consent.consentId));
  const initial = await runtime.replay(r.sessionId), proof = structuredClone(initial.chapter.personalRequests[consent.consentId].execution.acceptedProof), definitions = itemDefinitions(r);
  assert.equal(proof.consentVersion, '2');
  for (const [index, item] of definitions.entries()) {
    await r.go(0, item);
    if (index === 0 && version === 'gaolaozhuang-scene-v3') {
      const visible = await r.entity(0, item.name), raw = await r.raw(0, { kind: 'take_item', itemRef: visible.entityRef, expectedItemRevision: visible.resourceRevision });
      let lost = false;
      runtime.hooks.afterCommit = ({ command, events }) => { if (!lost && command === 'spatial-action' && events.some(event => event.kind === 'spatial.item' && event.payload.item.itemId === item.itemId)) { lost = true; throw new Error('受控丢失 COMMIT 后返回。'); } };
      const receipt = accepted(await runtime.submit(r.handles[0], raw));
      runtime.hooks.afterCommit = undefined;
      assert.equal(lost, true); assert.deepEqual(await runtime.submit(r.handles[0], raw), receipt);
      const persisted = await runtime.replay(r.sessionId);
      assert.equal(Object.values(persisted.chapter.privateAcquisitions).filter(acquisition => acquisition.takeActionId === JSON.parse(raw).clientActionId).length, 1);
    } else await take(r, 0, item.name);
    const held = (await r.snapshot(0)).projection.chapter.privateReturns;
    assert.equal(held.length, 1); assert.equal(held[0].mode, 'delivery_pending');
    accepted(await giveOwner(r, item.name));
    const state = await runtime.replay(r.sessionId), record = state.chapter.personalRequests[consent.consentId];
    assert.equal(record.lifecycle, index === 0 ? 'open' : 'closed');
    assert.equal(record.reasonCode, index === 0 ? null : 'fulfilled');
    assert.equal(record.execution.itemUses[index].outcome, 'delivered_to_owner');
    assert.deepEqual(record.execution.acceptedProof, proof);
    assert.equal((await r.snapshot(0)).projection.chapter.privateReturns.length, 0);
    const observation = (await r.snapshot(0)).projection.observations.findLast(observation => observation.fields.some(field => field.key === 'privateItemOutcome'));
    assert.equal(observation.shareable, false); assert.ok(observation.statement.includes('已实际交到本人手中'));
    const event = (await db.pool.query('SELECT event FROM world_events WHERE session_id=$1 AND session_seq=$2', [r.sessionId, observation.sourceSeq])).rows[0].event;
    assert.equal(event.kind, 'spatial.item'); assert.equal(event.payload.item.location.characterId, r.content.chapterRules.people.cuilan);
    assert.ok(!(await r.snapshot(1)).projection.observations.some(other => other.observationRef === observation.observationRef));
  }
});

test('权威合同：两用途交错、公开揭明原子解除、本人 C2 与 single_use 强制守卫', async () => {
  const r = await settledRoom();
  let privateConsent = await requestItems(r, 0, { permissionTerm: 'reusable' });
  assert.equal((await controlledDecision(r, privateConsent.consentId)).code, 'NOT_READY');
  accepted(await controlledDecision(r, privateConsent.consentId, 'decline'));
  privateConsent = await requestItems(r);
  accepted(await controlledDecision(r, privateConsent.consentId));
  accepted(await r.interact(0, '翠兰', 'gz-request-appearance', { destinationId: 'rear-meeting', permissionTerm: 'single_use' }));
  const appearance = (await r.snapshot(0)).projection.chapter.consents.filter(consent => consent.purpose === 'appearance').at(-1);
  accepted(await controlledDecision(r, appearance.consentId));
  await r.go('wukong', r.C('C10')); await r.go(0, r.C('C10'));
  const permission = (await r.snapshot('wukong')).projection.chapter.consents.find(consent => consent.consentId === appearance.consentId);
  accepted(await r.interact('wukong', 'self', 'gz-apply-appearance', { consentId: permission.consentId, expectedConsentVersion: permission.version }));
  const before = await runtime.replay(r.sessionId), destination = r.content.chapterRules.meetingDestinations.find(place => place.destinationId === 'rear-meeting');
  assert.equal(personalAppearancePathAllowed(before, r.content, r.content.chapterRules.people.wukong, destination.sceneId, [destination.position, { x: destination.position.x + 91, y: destination.position.y }, destination.position]), false, '中间段出界不能由终点合法补救');
  const item = itemDefinitions(r)[0]; await r.go(0, item); await take(r, 0, item.name);
  await r.go(0, r.C('C10'));
  const held = await r.entity(0, item.name), falseOwner = await r.entity(0, '孙悟空（借貌）');
  assert.equal((await r.send(0, { kind: 'transfer_item', itemRef: held.entityRef, expectedItemRevision: held.resourceRevision, recipientRef: falseOwner.entityRef })).code, 'CONSENT_REQUIRED');
  const here = (await r.snapshot(0)).projection.self;
  assert.equal((await r.send(0, { kind: 'put_item', itemRef: held.entityRef, expectedItemRevision: held.resourceRevision, sceneId: here.sceneId, position: here.position })).code, 'CONSENT_REQUIRED');
  accepted(await r.interact(0, '孙悟空（借貌）', 'gz-reveal-identity'));
  const revealed = await runtime.replay(r.sessionId), old = revealed.chapter.personalRequests[appearance.consentId];
  assert.equal(revealed.chapter.disguise, null); assert.equal(revealed.chapter.consents[appearance.consentId].status, 'accepted');
  assert.equal(old.reasonCode, 'appearance_disclosed'); assert.equal(old.lifecycle, 'open'); assert.ok(old.notice);
  assert.equal(revealed.chapter.personalRequests[privateConsent.consentId].execution.state, 'active');
  assert.equal((await r.snapshot(0)).projection.chapter.privateReturns[0].mode, 'delivery_pending');
  assert.equal((await r.interact('wukong', 'self', 'gz-apply-appearance', { consentId: permission.consentId, expectedConsentVersion: permission.version })).code, 'CONSENT_REQUIRED');
  accepted(await controlledDecision(r, appearance.consentId, null, 'withdraw_consent'));
  assert.equal((await runtime.replay(r.sessionId)).chapter.consents[appearance.consentId].status, 'withdrawn');
  accepted(await giveOwner(r, item.name));
});

test('权威合同：取消/新槽/落窗/重启后旧持物仍可用 fresh refs 放回；终态保留剩余而无执行', async () => {
  const r = await settledRoom(), original = await requestItems(r);
  accepted(await controlledDecision(r, original.consentId));
  const definitions = itemDefinitions(r); await r.go(0, definitions[0]);
  for (const item of definitions) await take(r, 0, item.name);
  const before = (await r.snapshot(0)).projection.chapter.privateReturns;
  await cancel(r, 0, original.consentId);
  const nextRequest = await requestItems(r, 1); accepted(await controlledDecision(r, nextRequest.consentId));
  await runtime.locked(r.sessionId, { kind: 'authority-observation-window-fixture' }, tx => { for (let index = 0; index < 270; index++) observeGaolao(tx, tx.state.members[0].characterId, { statement: '仅用于检查近期观察窗口的无授权现场记录。', shareable: false }); });
  // 只读投影容量 fixture：附加无执行权的旧 declined 摘要，检验与近期许可预算独立。
  const crowded = structuredClone(await runtime.replay(r.sessionId)), actorId = crowded.members[0].characterId;
  for (let index = 0; index < 260; index++) { const consentId = opaqueRef(); crowded.chapter.consents[consentId] = { ...crowded.chapter.consents[original.consentId], consentId, status: 'declined', sourceSeq: crowded.sessionSeq }; }
  const crowdedProjection = spatialProjection(crowded, r.content, actorId);
  assert.ok(!crowdedProjection.chapter.consents.some(consent => consent.consentId === original.consentId));
  assert.equal(crowdedProjection.chapter.privateReturns.length, 2, '原许可已被公开历史窗口裁掉，独立返还集合仍完整');
  const oldTake = (await db.pool.query("SELECT receipt FROM action_receipts WHERE session_id=$1 AND receipt->'publicReceipt'->'result' ? 'entityRefs' ORDER BY client_action_id", [r.sessionId])).rows.find(row => row.receipt.publicReceipt.status === 'Accepted').receipt.publicReceipt;
  await runtime.close(); runtime = await createRuntime({ pool: db.pool, now: () => clock.value });
  const handles = [];
  for (const user of r.users) { const handle = await runtime.openConnection(user.token, caps), snapshot = await runtime.subscribe(handle, r.sessionId); await runtime.control(handle, JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId: r.sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce: crypto.randomUUID() })); handles.push(handle); }
  let snapshot = await runtime.snapshot(r.users[0].token, r.sessionId, caps);
  assert.equal(snapshot.projection.chapter.privateReturns.length, 2);
  for (const record of snapshot.projection.chapter.privateReturns) { const prior = before.find(prior => prior.returnContextId === record.returnContextId); assert.ok(prior); assert.notEqual(record.itemRef, prior.itemRef); assert.equal(record.mode, 'return_only'); }
  const returned = snapshot.projection.chapter.privateReturns[0];
  const request = { schemaVersion: 2, sessionId: r.sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, clientActionId: crypto.randomUUID(), controlEpoch: snapshot.projection.self.controlEpoch, baseSeq: snapshot.snapshotSeq, action: { kind: 'put_item', itemRef: returned.itemRef, expectedItemRevision: returned.itemRevision, sceneId: returned.origin.sceneId, position: returned.origin.position } };
  const receipt = accepted(await runtime.submit(handles[0], JSON.stringify(request)));
  snapshot = await runtime.snapshot(r.users[0].token, r.sessionId, caps);
  assert.equal(snapshot.projection.chapter.privateReturns.length, 1);
  assert.ok(snapshot.projection.observations.findLast(observation => observation.fields.some(field => field.key === 'privateItemOutcome')).statement.includes('尚未送到本人'));
  const state = await runtime.replay(r.sessionId), acquisition = state.chapter.privateAcquisitions[returned.returnContextId];
  assert.equal(acquisition.outcome, 'restored_origin'); assert.equal(acquisition.originalConsentId, original.consentId);
  assert.notEqual(state.chapter.personalRequests[original.consentId].reasonCode, 'fulfilled');
  assert.equal(state.chapter.personalRequests[nextRequest.consentId].execution.itemUses.find(use => use.itemId === acquisition.itemId).outcome, 'pending');
  await runtime.locked(r.sessionId, { kind: 'authority-terminal-contract' }, tx => tx.emit('session.aborted', { reason: '仅检查终态执行围栏。' }));
  const terminal = await runtime.snapshot(r.users[0].token, r.sessionId, caps);
  assert.equal(terminal.projection.chapter.privateReturns.length, 1); assert.equal(terminal.projection.chapter.privateReturns[0].mode, 'return_only');
  assert.deepEqual(await runtime.submit(handles[0], JSON.stringify(request)), receipt);
  assert.ok(oldTake, '已有原取物 Receipt 不因恢复重建');
  const remaining = terminal.projection.chapter.privateReturns[0];
  const rejected = await runtime.submit(handles[0], JSON.stringify({ ...request, viewId: terminal.viewId, actorRef: terminal.projection.self.entityRef, clientActionId: crypto.randomUUID(), controlEpoch: terminal.projection.self.controlEpoch, baseSeq: terminal.snapshotSeq, action: { kind: 'put_item', itemRef: remaining.itemRef, expectedItemRevision: remaining.itemRevision, sceneId: remaining.origin.sceneId, position: remaining.origin.position } }));
  assert.equal(rejected.status, 'Rejected');
  assert.equal((await runtime.replay(r.sessionId)).items[acquisition.itemId].location.kind, 'ground');
});

test('权威合同：控制中断原子停用；旧 requester epoch 不阻止 C2，另一用途不被误停', async () => {
  const r = await settledRoom(), privateConsent = await requestItems(r, 0);
  accepted(await controlledDecision(r, privateConsent.consentId));
  await r.go(1, (await r.snapshot('cuilan')).projection.self);
  accepted(await r.interact(1, '翠兰', 'gz-request-appearance', { destinationId: 'front-meeting', permissionTerm: 'single_use' }));
  const appearance = (await r.snapshot(1)).projection.chapter.consents.filter(consent => consent.purpose === 'appearance').at(-1);
  accepted(await controlledDecision(r, appearance.consentId));
  await r.go('wukong', r.C('C19'));
  const appearanceNow = (await r.snapshot('wukong')).projection.chapter.consents.find(consent => consent.consentId === appearance.consentId);
  accepted(await r.interact('wukong', 'self', 'gz-apply-appearance', { consentId: appearance.consentId, expectedConsentVersion: appearanceNow.version }));
  const item = itemDefinitions(r)[0]; await r.go(0, item); await take(r, 0, item.name);
  const before = await runtime.replay(r.sessionId), unrelated = before.chapter.personalRequests[privateConsent.consentId].lifecycleVersion;
  await runtime.locked(r.sessionId, { kind: 'authority-control-epoch-contract' }, tx => {
    const actorId = r.content.chapterRules.people.wukong, actor = tx.state.characters[actorId];
    tx.emit('control.changed', { actorId, mode: 'CoreNPCControlled', controlEpoch: String(BigInt(actor.controlEpoch) + 1n), activeConnectionId: null, graceDeadlineAt: null });
  });
  let state = await runtime.replay(r.sessionId);
  assert.equal(state.chapter.disguise, null); assert.equal(state.chapter.personalRequests[appearance.consentId].reasonCode, 'binding_invalidated');
  assert.equal(state.chapter.personalRequests[privateConsent.consentId].lifecycleVersion, unrelated);
  assert.equal(state.chapter.personalRequests[privateConsent.consentId].execution.state, 'active');
  accepted(await controlledDecision(r, appearance.consentId, null, 'withdraw_consent'));
  await runtime.disconnect(r.handles[0]);
  state = await runtime.replay(r.sessionId);
  const interrupted = state.chapter.personalRequests[privateConsent.consentId];
  assert.equal(state.chapter.consents[privateConsent.consentId].status, 'accepted'); assert.equal(interrupted.reasonCode, 'binding_invalidated'); assert.equal(interrupted.execution.state, 'return_only');
  assert.ok(interrupted.notice); assert.equal(state.paused, true);
  const handle = await runtime.openConnection(r.users[0].token, caps), snapshot = await runtime.subscribe(handle, r.sessionId);
  await runtime.control(handle, JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId: r.sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce: crypto.randomUUID() }));
  r.handles[0] = handle; r.actors.get(0).handle = handle;
  accepted(await controlledDecision(r, privateConsent.consentId, null, 'withdraw_consent'));
  state = await runtime.replay(r.sessionId);
  assert.equal(state.chapter.consents[privateConsent.consentId].status, 'withdrawn');
  assert.equal(state.chapter.personalRequests[privateConsent.consentId].reasonCode, 'owner_withdrew');
  accepted(await giveOwner(r, item.name));
  assert.equal((await runtime.replay(r.sessionId)).chapter.personalRequests[privateConsent.consentId].reasonCode, 'owner_withdrew', '归还不能吞掉原本人撤回归因');
});

test('权威合同：放回原处消费本件机会；另一件未耗尽，原处不算 fulfilled', async () => {
  const r = await settledRoom(), consent = await requestItems(r);
  accepted(await controlledDecision(r, consent.consentId));
  const [first, second] = itemDefinitions(r); await r.go(0, first); await take(r, 0, first.name);
  let returned = (await r.snapshot(0)).projection.chapter.privateReturns[0];
  accepted(await r.send(0, { kind: 'put_item', itemRef: returned.itemRef, expectedItemRevision: returned.itemRevision, sceneId: returned.origin.sceneId, position: returned.origin.position }));
  const item = await r.entity(0, first.name);
  assert.equal((await r.send(0, { kind: 'take_item', itemRef: item.entityRef, expectedItemRevision: item.resourceRevision })).code, 'CONSENT_REQUIRED');
  await take(r, 0, second.name); accepted(await giveOwner(r, second.name));
  const state = await runtime.replay(r.sessionId), record = state.chapter.personalRequests[consent.consentId];
  assert.deepEqual(record.execution.itemUses.map(use => use.outcome), ['restored_origin', 'delivered_to_owner']);
  assert.equal(record.lifecycle, 'open'); assert.equal(record.reasonCode, null);
  assert.equal((await r.snapshot(0)).projection.chapter.privateReturns.length, 0, '无当前持物不能被解释为全部实收');
});

test('权威合同：旧持有人交回可满足新安排，但新槽不接管原取得身份', async () => {
  const r = await settledRoom(), original = await requestItems(r, 0);
  accepted(await controlledDecision(r, original.consentId));
  const definitions = itemDefinitions(r); await r.go(0, definitions[0]); for (const item of definitions) await take(r, 0, item.name);
  const acquisitions = (await r.snapshot(0)).projection.chapter.privateReturns.map(record => record.returnContextId);
  await cancel(r, 0, original.consentId);
  const current = await requestItems(r, 1); accepted(await controlledDecision(r, current.consentId));
  for (const [index, item] of definitions.entries()) {
    accepted(await giveOwner(r, item.name));
    const state = await runtime.replay(r.sessionId), oldRecord = state.chapter.personalRequests[original.consentId], nextRecord = state.chapter.personalRequests[current.consentId];
    assert.equal(oldRecord.reasonCode, 'replaced_after_closed');
    assert.equal(nextRecord.execution.itemUses[index].outcome, 'already_at_owner');
    assert.equal(nextRecord.execution.itemUses[index].takeActionId, null); assert.equal(nextRecord.execution.itemUses[index].acquisitionId, null);
    assert.equal(nextRecord.reasonCode, index === 0 ? null : 'fulfilled');
    for (const id of acquisitions) assert.equal(state.chapter.privateAcquisitions[id].originalConsentId, original.consentId);
  }
});

test('权威合同：第三人在场时请求者租约先到期，当前使用不能等下一轮 maintenance 才停', async () => {
  const r = await settledRoom('gaolaozhuang-scene-v3', 'front-guest-room', 3);
  const privateConsent = await requestItems(r, 0); accepted(await controlledDecision(r, privateConsent.consentId));
  accepted(await r.interact(0, '翠兰', 'gz-request-appearance', { destinationId: 'rear-meeting', permissionTerm: 'single_use' }));
  const consent = (await r.snapshot(0)).projection.chapter.consents.filter(consent => consent.purpose === 'appearance').at(-1);
  accepted(await controlledDecision(r, consent.consentId));
  await r.go('wukong', r.C('C10'));
  const current = (await r.snapshot('wukong')).projection.chapter.consents.find(candidate => candidate.consentId === consent.consentId);
  const item = itemDefinitions(r)[0]; await r.go(0, item); await take(r, 0, item.name);
  const previous = await runtime.replay(r.sessionId), actorId = previous.members[0].characterId, epoch = previous.characters[actorId].controlEpoch, original = (await r.snapshot(0)).projection.chapter.privateReturns[0];
  clock.value += 61_000;
  for (const who of [1, 2]) await runtime.heartbeat(r.handles[who]);
  const receipt = await r.interact('wukong', 'self', 'gz-apply-appearance', { consentId: current.consentId, expectedConsentVersion: current.version });
  assert.equal(receipt.status, 'Rejected', '真实租约已失效，即便另两真人仍使房间 Running，也不能首次使用旧授权');
  const state = await runtime.replay(r.sessionId);
  assert.equal(state.chapter.disguise, null); assert.equal(state.chapter.personalRequests[consent.consentId].reasonCode, 'binding_invalidated');
  assert.equal(state.chapter.consents[consent.consentId].status, 'accepted');
  assert.equal(state.characters[actorId].controlEpoch, String(BigInt(epoch) + 1n));
  assert.equal(state.chapter.personalRequests[privateConsent.consentId].execution.state, 'return_only');
  await runtime.maintenance(r.sessionId); await runtime.maintenance(r.sessionId); await r.snapshot(1);
  const repeated = await runtime.replay(r.sessionId);
  assert.equal(repeated.characters[actorId].controlEpoch, String(BigInt(epoch) + 1n));
  const controls = (await db.pool.query("SELECT event FROM world_events WHERE session_id=$1 AND session_seq>$2 AND event->>'kind'='control.changed' AND event->'payload'->>'actorId'=$3", [r.sessionId, previous.sessionSeq, actorId])).rows;
  assert.equal(controls.length, 1, '重复 advance/maintenance 不重复发控制失效');
  const oldHandle = r.handles[0]; assert.equal(runtime.connectionView(oldHandle)?.active ?? false, false, '绑定层也已收束旧连接视图');
  const handle = await runtime.openConnection(r.users[0].token, caps), snapshot = await runtime.subscribe(handle, r.sessionId);
  await runtime.control(handle, JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId: r.sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce: crypto.randomUUID() }));
  r.handles[0] = handle; r.actors.get(0).handle = handle;
  assert.equal((await r.interact('wukong', 'self', 'gz-apply-appearance', { consentId: current.consentId, expectedConsentVersion: current.version })).code, 'CONSENT_REQUIRED');
  const fresh = (await r.snapshot(0)).projection.chapter.privateReturns[0];
  assert.equal(fresh.returnContextId, original.returnContextId); assert.equal(fresh.mode, 'return_only'); assert.notEqual(fresh.itemRef, original.itemRef);
  accepted(await giveOwner(r, item.name));
  const finished = await runtime.replay(r.sessionId), acquisition = finished.chapter.privateAcquisitions[original.returnContextId];
  assert.equal(acquisition.originalConsentId, privateConsent.consentId); assert.equal(acquisition.outcome, 'delivered_to_owner');
  assert.equal(finished.chapter.personalRequests[privateConsent.consentId].reasonCode, 'binding_invalidated');
});
