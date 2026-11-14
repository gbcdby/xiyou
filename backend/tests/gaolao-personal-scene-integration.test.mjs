import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createAuthorityServer } from '../server.mjs';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { accepted, take } from '../test-support/gaolao-room.mjs';
import { openSceneDoor, finishSceneRoute } from '../test-support/scene-policy-room.mjs';
import { personalSceneRoom } from '../test-support/gaolao-personal-scene-room.mjs';

const output = new URL('../../.agent-output/cuilan-integration-20261114/', import.meta.url);

for (const [version, destinationId] of [
  ['gaolaozhuang-scene-v3', 'front-guest-room'],
  ['gaolaozhuang-tools-east-scene-v3', 'tea-back-room'],
]) test(`真实 v3 权威与生产本人联合：${version}/${destinationId} 拒绝后新询问、双用途、C2 与旧物归还`, async t => {
  const db = await startTestPostgres('personal-scene-integration', { outputSubdirectory: 'cuilan-integration-20261114' });
  const clock = { value: Date.parse('2026-11-14T18:00:00Z') }, logs = [];
  let server, room;
  t.after(async () => {
    await mkdir(output, { recursive: true });
    if (room) {
      const intents = (await db.pool.query("SELECT intent_id, request, execution_context, execution_context->'scenePolicyBasis' AS scene_basis, scene_outcome FROM spatial_intents WHERE session_id=$1 ORDER BY intent_id", [room.sessionId])).rows;
      await writeFile(new URL(`scene-${version}-${destinationId}.json`, output), JSON.stringify({ version, destinationId, sessionId: room.sessionId, status: room.sceneStatus(), state: await room.state(), intents, logs }, null, 2));
    }
    await room?.close(); await server?.close(); await db.stop();
  });
  server = await createAuthorityServer({ pool: db.pool, now: () => clock.value, log: (message, fields) => logs.push({ message, fields }) });
  room = await personalSceneRoom(server, clock, version);
  assert.deepEqual(room.bindings.map(binding => binding.key), ['tang', 'wukong', 'bajie']);
  await assert.rejects(room.send('cuilan', { kind: 'wait' }), /禁止控制/);
  await openSceneDoor(room);
  assert.equal((await room.propose(destinationId)).status, 'accepted');
  await finishSceneRoute(room, destinationId);
  const safe = room.content.chapterRules.safeDestinations.find(place => place.destinationId === destinationId);
  await room.go(0, safe);
  accepted(await room.interact(0, '翠兰', 'gz-request-appearance', { destinationId: 'rear-meeting', permissionTerm: 'reusable' }));
  await room.drain();
  let state = await room.state();
  const declined = Object.values(state.chapter.consents).findLast(consent => consent.purpose === 'appearance');
  assert.equal(declined.status, 'declined', JSON.stringify({ declined, status: room.sceneStatus() }));
  assert.equal(declined.decidedBy, room.content.chapterRules.people.cuilan);
  accepted(await room.interact(0, '翠兰', 'gz-request-appearance', { destinationId: 'rear-meeting', permissionTerm: 'single_use' }));
  await room.drain();
  state = await room.state();
  const appearance = Object.values(state.chapter.consents).findLast(consent => consent.purpose === 'appearance');
  assert.notEqual(appearance.consentId, declined.consentId);
  assert.equal(appearance.status, 'accepted');
  accepted(await room.interact(0, '翠兰', 'gz-describe-private-items'));
  const offer = (await room.snapshot(0)).projection.chapter.privateItemOffers[0];
  accepted(await room.interact(0, '翠兰', 'gz-request-private-items', { offerRef: offer.offerRef, itemOptionRefs: offer.options.map(option => option.optionRef), permissionTerm: 'single_use' }));
  await room.drain();
  state = await room.state();
  const privateConsent = Object.values(state.chapter.consents).findLast(consent => consent.purpose === 'private_items');
  assert.equal(privateConsent.status, 'accepted');
  assert.equal(state.chapter.consents[appearance.consentId].status, 'accepted');
  const item = room.content.items.find(item => room.content.chapterRules.privateItems.some(definition => definition.itemId === item.itemId && definition.ownerId === room.content.chapterRules.people.cuilan));
  await room.go(0, item); await take(room, 0, item.name);
  const held = (await room.snapshot(0)).projection.chapter.privateReturns[0];
  assert.ok(held.returnContextId);
  await room.interruptControl(0); await room.drain();
  state = await room.state();
  assert.equal(state.chapter.consents[privateConsent.consentId].status, 'withdrawn', 'C2 必须由生产本人关闭原许可');
  assert.equal(state.chapter.consents[appearance.consentId].status, 'withdrawn', '同次中断产生的另一用途待办也由本人收束');
  assert.equal(state.chapter.consents[privateConsent.consentId].decidedBy, room.content.chapterRules.people.cuilan);
  assert.equal(state.chapter.personalRequests[privateConsent.consentId].reasonCode, 'owner_withdrew');
  await room.go(0, safe);
  const latest = (await room.snapshot(0)).projection.chapter.privateReturns[0], owner = await room.entity(0, '翠兰');
  assert.equal(latest.returnContextId, held.returnContextId);
  accepted(await room.send(0, { kind: 'transfer_item', itemRef: latest.itemRef, expectedItemRevision: latest.itemRevision, recipientRef: owner.entityRef }));
  state = await room.state();
  assert.equal(state.items[item.itemId].location.characterId, room.content.chapterRules.people.cuilan);
  assert.equal((await room.snapshot(0)).projection.chapter.privateReturns.length, 0);
  assert.equal(state.chapter.privateAcquisitions[held.returnContextId].originalConsentId, privateConsent.consentId);
  const rows = (await db.pool.query("SELECT request, execution_context, execution_context->'scenePolicyBasis' AS scene_basis, scene_outcome FROM spatial_intents WHERE session_id=$1 AND execution_context->>'mode'='scene-policy'", [room.sessionId])).rows;
  for (const consent of [declined, appearance, privateConsent]) {
    const response = rows.find(row => row.request.action.kind === 'respond_consent' && row.request.action.consentId === consent.consentId && row.scene_outcome?.status === 'Accepted');
    assert.ok(response, '实际本人回应有 PostgreSQL 持久意图/结果');
    assert.equal(response.scene_basis.policyVersion, 'gaolao-cuilan-v2');
    assert.equal(response.scene_basis.personal.consentId, consent.consentId);
  }
  for (const consent of [appearance, privateConsent]) assert.ok(rows.some(row => row.request.action.kind === 'withdraw_consent' && row.request.action.consentId === consent.consentId && row.scene_outcome?.status === 'Accepted'));
  assert.equal(room.sceneStatus().phase, 'Idle');
  assert.equal(room.sceneStatus().pendingSemanticSeq, '0');
  assert.deepEqual(state, (await db.pool.query('SELECT state FROM sessions WHERE session_id=$1', [room.sessionId])).rows[0].state);
});
