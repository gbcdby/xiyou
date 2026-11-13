import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createRuntime } from '../runtime.mjs';
import { gaolaoRoom, rescue, disguise, accepted } from '../test-support/gaolao-room.mjs';
import { buildSpatialContext } from '../ai/spatial-context.mjs';
import { ModelGateway } from '../ai/gateway.mjs';
import { validateSpatialAI } from '../../protocol/spatial-ai.mjs';

let db, runtime;
const clock = { value: Date.parse('2026-11-13T14:00:00Z') };
before(async () => {
  db = await startTestPostgres('spatial-ai-context', { outputSubdirectory: 'a3-ai-protocol' });
  runtime = await createRuntime({ pool: db.pool, now: () => clock.value });
});
after(async () => { await runtime?.close(); await db?.stop(); });

test('真实PG授权快照：三名自主角色均可通过V2 Gateway，但意图仍交给原规则', async () => {
  const room = await gaolaoRoom(runtime, clock, 2);
  const gateway = new ModelGateway({ provider: { kind: 'controlled', providerId: 'controlled-real-snapshot', async generate({ context }) {
    validateSpatialAI('SpatialDecisionContextV2', context);
    for (const name of ['actorId', 'characterId', 'principalId', 'actorKind', 'readVersions', 'controlEpoch', 'generation']) assert.ok(!JSON.stringify(context).includes('"' + name + '"'), name);
    return { rawText: JSON.stringify({ schemaVersion: 2, decisionId: context.decision.decisionId, toolCalls: [{ kind: 'speak', text: '我先听清来源，再作本人决定。', channel: 'public', recipientRefs: [] }] }) };
  } }, modelId: 'controlled-v2' });
  try {
    for (const key of ['tang', 'wukong', 'bajie']) {
      const handle = room.actors.get(key).handle, decisionId = crypto.randomUUID();
      const output = await gateway.generate(buildSpatialContext(await runtime.observeInternal(handle), { decisionId }));
      assert.equal(output.status, 'Valid', key);
      const intent = JSON.parse(output.rawText), intentId = crypto.randomUUID();
      await runtime.reserveSpatialIntent(handle, intentId, intent.toolCalls[0]);
      accepted(await runtime.submitSpatialIntent(handle, intentId));
      assert.ok((await room.snapshot(key)).projection.claims.some(claim => claim.text === intent.toolCalls[0].text));
    }
    assert.equal(gateway.metrics().valid, 3); assert.equal(gateway.metrics().externalCalls, 0);
  } finally { await gateway.close(); }
});

test('真实PG借貌快照：八戒的模型请求与工具不泄露真身，队聊不进入模型知识', async () => {
  const room = await gaolaoRoom(runtime, clock, 2);
  await rescue(room); await disguise(room); await room.go('cuilan', room.C('C10'));
  accepted(await room.send(0, { kind: 'speak', text: '队聊中的孙悟空真身说明。', channel: 'team', recipientRefs: [] }));
  const snapshot = await room.snapshot('bajie'), twins = snapshot.projection.entities.filter(e => e.name === '翠兰');
  assert.equal(twins.length, 2); assert.notEqual(twins[0].entityRef, twins[1].entityRef);
  let providerSaw = false;
  const gateway = new ModelGateway({ provider: { kind: 'controlled', providerId: 'controlled-private-snapshot', async generate(input) {
    providerSaw = true;
    for (const forbidden of ['孙悟空', 'gz-wukong', 'actorKind', 'characterId', 'principalId', 'appearanceName', '队聊中的']) assert.ok(!JSON.stringify(input).includes(forbidden), forbidden);
    assert.deepEqual(input.context.projection.entities.filter(e => e.name === '翠兰').map(e => e.entityRef).sort(), twins.map(e => e.entityRef).sort());
    return { rawText: JSON.stringify({ schemaVersion: 2, decisionId: input.context.decision.decisionId, toolCalls: [{ kind: 'wait' }] }) };
  } }, modelId: 'controlled-private-v2' });
  try {
    const output = await gateway.generate(buildSpatialContext(snapshot, { decisionId: crypto.randomUUID() }));
    assert.equal(output.status, 'Valid'); assert.equal(providerSaw, true); assert.equal(gateway.metrics().externalCalls, 0);
  } finally { await gateway.close(); }
});
