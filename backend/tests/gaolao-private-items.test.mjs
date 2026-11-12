import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createRuntime } from '../runtime.mjs';
import { gaolaoRoom, accepted, rescue, disguise } from '../test-support/gaolao-room.mjs';

let db, runtime;
const clock = { value: Date.parse('2026-11-13T10:00:00Z') };
before(async () => {
  db = await startTestPostgres('gaolao-private-items', { outputSubdirectory: 'r32req004' });
  runtime = await createRuntime({ pool: db.pool, now: () => clock.value });
});
after(async () => { await runtime?.close(); await db?.stop(); });

for (const version of ['gaolaozhuang-v1', 'gaolaozhuang-tools-east-v1']) {
  test(`R32REQ004：${version} 的可见物主公布私物请求，仍须本人按范围与版本授权`, async t => {
    const r = await gaolaoRoom(runtime, clock, 2, version);
    const initial = (await r.snapshot(0)).projection;
    assert.ok(!initial.entities.some(e => e.name === '猪刚鬣'));
    assert.ok(!initial.items.some(i => i.name === '私人钉耙'));

    const person = (await r.snapshot('bajie')).projection.self;
    await r.go(0, { sceneId: person.sceneId, position: person.position });
    const visible = (await r.snapshot(0)).projection;
    const owner = visible.entities.find(e => e.name === '猪刚鬣');
    const item = visible.items.find(i => i.name === '私人钉耙');
    assert.ok(owner && item, '真人实际走近后才能取得当前实体与物品引用');
    t.diagnostic(JSON.stringify({ version, owner: owner.name, operations: owner.availableOperations, item: item.name, location: item.location.kind }));
    const operationId = owner.availableOperations.find(op => op === 'gz-request-private-items');
    assert.equal(operationId, 'gz-request-private-items', '正常消费者必须能从 availableOperations 发起物主请求');
    assert.ok(!owner.availableOperations.includes('gz-request-appearance'));
    assert.equal(item.publicBorrowable, false);
    assert.equal(item.location.kind, 'ground');
    for (const forbidden of ['ownerId', 'itemIds', 'characterId', 'gz-bajie', 'gz-rake']) {
      assert.ok(!JSON.stringify({ owner, item }).includes(forbidden), forbidden);
    }

    const action = { kind: 'interact', targetRef: owner.entityRef, operationId, expectedTargetRevision: owner.resourceRevision, parameters: { itemRefs: [item.entityRef], expectedConsentVersion: '0' } };
    const raw = await r.raw(0, action);
    const receipt = accepted(await runtime.submit(r.handles[0], raw));
    let consent = (await r.snapshot('bajie')).projection.chapter.consents.find(c => c.purpose === 'private_items');
    assert.equal(consent.status, 'proposed');
    const requester = (await r.snapshot(0)).projection.chapter.consents.find(c => c.consentId === consent.consentId);
    assert.equal(requester.subjectRef, owner.entityRef);
    assert.deepEqual(requester.scope.itemRefs, [item.entityRef]);

    await r.go(0, item.location);
    await r.go(1, item.location);
    assert.equal((await r.send(0, { kind: 'take_item', itemRef: item.entityRef, expectedItemRevision: item.resourceRevision })).code, 'CONSENT_REQUIRED');
    assert.ok(!(await r.snapshot(1)).projection.chapter.consents.some(c => c.consentId === consent.consentId));
    assert.equal((await r.send(1, { kind: 'respond_consent', consentId: consent.consentId, expectedConsentVersion: consent.version, response: 'accept' })).code, 'STALE_REFERENCE');
    accepted(await r.send('bajie', { kind: 'respond_consent', consentId: consent.consentId, expectedConsentVersion: consent.version, response: 'accept' }));
    consent = (await r.snapshot('bajie')).projection.chapter.consents.find(c => c.consentId === consent.consentId);
    assert.equal(consent.status, 'accepted');
    assert.equal(consent.version, '2');
    const outsiderItem = await r.entity(1, '私人钉耙');
    assert.equal((await r.send(1, { kind: 'take_item', itemRef: outsiderItem.entityRef, expectedItemRevision: outsiderItem.resourceRevision })).code, 'CONSENT_REQUIRED');

    accepted(await r.send(0, { kind: 'take_item', itemRef: item.entityRef, expectedItemRevision: item.resourceRevision }));
    const held = await r.entity(0, '私人钉耙');
    assert.equal(held.location.kind, 'held');
    assert.equal(held.location.ownerRef, (await r.snapshot(0)).projection.self.entityRef);
    const outsider = (await r.snapshot(1)).projection;
    assert.ok(!outsider.items.some(i => i.name === '私人钉耙'), '近处第三人不因物主菜单得到他人所持私物');
    assert.ok(outsider.entities.find(e => e.name === '猪刚鬣').availableOperations.includes('gz-request-private-items'));
    assert.equal((await r.send(1, { kind: 'take_item', itemRef: outsiderItem.entityRef, expectedItemRevision: held.resourceRevision })).code, 'STALE_REFERENCE');

    await r.go(0, { sceneId: person.sceneId, position: person.position });
    const currentOwner = await r.entity(0, '猪刚鬣');
    assert.equal((await r.send(0, { ...action, expectedTargetRevision: currentOwner.resourceRevision })).code, 'CONSENT_STALE');
    assert.deepEqual(await runtime.submit(r.handles[0], raw), receipt, '原 nonce 只恢复原 Receipt');
    assert.equal(Object.keys((await runtime.replay(r.sessionId)).chapter.consents).length, 1);

    accepted(await r.send('bajie', { kind: 'withdraw_consent', consentId: consent.consentId, expectedConsentVersion: consent.version }));
    const here = (await r.snapshot(0)).projection.self;
    assert.equal((await r.send(0, { kind: 'put_item', itemRef: held.entityRef, expectedItemRevision: held.resourceRevision, sceneId: here.sceneId, position: here.position })).code, 'CONSENT_REQUIRED');
    assert.deepEqual(await runtime.submit(r.handles[0], raw), receipt);
  });
}

test('R32REQ004：私物入口不区分未识破的同貌实体，也不授予NPC请求能力', async () => {
  const r = await gaolaoRoom(runtime, clock, 3);
  await r.go(2, r.R('R03'));
  await rescue(r);
  await disguise(r);
  await r.go(2, r.C('C10'));
  await r.go('cuilan', r.C('C10'));

  const known = (await r.snapshot(0)).projection;
  const borrowed = known.entities.find(e => e.name === '孙悟空（借貌）');
  assert.ok(borrowed?.availableOperations.includes('gz-reveal-identity'));
  assert.ok(borrowed.availableOperations.includes('gz-request-private-items'));
  const unknown = (await r.snapshot(2)).projection;
  const doubles = unknown.entities.filter(e => e.name === '翠兰');
  assert.equal(doubles.length, 2);
  assert.notEqual(doubles[0].entityRef, doubles[1].entityRef);
  assert.deepEqual(doubles[0].availableOperations, doubles[1].availableOperations);
  assert.ok(doubles.every(e => e.availableOperations.includes('gz-request-private-items')));
  assert.ok(doubles.every(e => !e.availableOperations.includes('gz-reveal-identity')));
  assert.ok(!unknown.entities.some(e => e.name.includes('孙悟空')));
  for (const forbidden of ['gz-wukong', 'gz-cuilan', 'characterId', 'actorKind', 'ownerId']) {
    assert.ok(!JSON.stringify(unknown).includes(forbidden), forbidden);
  }

  const npc = (await runtime.spatialContext(r.actors.get('bajie').handle)).projection;
  const npcDoubles = npc.entities.filter(e => e.name === '翠兰');
  assert.equal(npcDoubles.length, 2);
  assert.deepEqual(npcDoubles[0].availableOperations, npcDoubles[1].availableOperations);
  assert.ok(npc.entities.every(e => !e.availableOperations.includes('gz-request-private-items')));
});
