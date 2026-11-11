import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createRuntime } from '../runtime.mjs';
import { createRunningRoom, actionRaw, deferred, until } from '../test-support/ai-room.mjs';

let database; let runtime;
before(async () => {
  database = await startTestPostgres('ai-context');
  runtime = await createRuntime({ pool: database.pool });
});

test('真实 PostgreSQL：合法检查刷新目标来源，无关动作不制造目标事件，终局不补写', async () => {
  const room = await createRunningRoom(runtime);
  const handle = await runtime.bindInternal(room.sessionId, 'tangseng', 'core_npc');
  const first = await runtime.prepareDecisionContext(handle);
  const before = first.context.memory.goalSources.find(s => s.kind === 'inspection');
  assert.equal(first.context.memory.goals.find(g => g.goalId === before.goalId).status, 'active');
  const raw = JSON.stringify({ decisionId: first.decision.decisionId, toolCalls: [{ kind: 'inspect', targetId: 'passage_structure' }] });
  assert.equal((await runtime.submitIntent(handle, first.decision.decisionId, raw)).status, 'Accepted');
  const second = await runtime.prepareDecisionContext(handle);
  const goal = second.context.memory.goals.find(g => g.goalId === before.goalId);
  assert.equal(goal.status, 'completed');
  assert.equal(goal.revision, '1');
  const source = second.context.memory.goalSources.find(s => s.goalId === goal.goalId);
  assert.equal(source.observationIds.length, 1);
  assert.ok(second.decision.observationIds.includes(source.observationIds[0]));
  await runtime.submit(room.connections[1], actionRaw(room, 1, { kind: 'speak', text: '库房还有线索吗？', channel: 'public', recipientIds: [] }));
  const head = (await runtime.replay(room.sessionId)).sessionSeq;
  const third = await runtime.prepareDecisionContext(handle);
  assert.equal(third.context.snapshotSeq, head);
  assert.deepEqual(third.context.memory.goals, second.context.memory.goals);
  await runtime.abortSession(room.sessionId, '受控结束');
  const ended = await runtime.replay(room.sessionId);
  await assert.rejects(runtime.prepareDecisionContext(handle), { code: 'FORBIDDEN' });
  assert.deepEqual(await runtime.replay(room.sessionId), ended);
});

test('真实 PostgreSQL：准备持锁期间竞争写入等待，同水位上下文后相关变更使旧决定过期', async () => {
  const room = await createRunningRoom(runtime);
  const handle = await runtime.bindInternal(room.sessionId, 'tangseng', 'core_npc');
  const entered = deferred(); const release = deferred();
  const previous = runtime.hooks.beforeCommit;
  runtime.hooks.beforeCommit = async ({ command, sessionId }) => {
    if (command === 'prepare-decision-context' && sessionId === room.sessionId) { entered.resolve(); await release.promise; }
  };
  let preparing; let competing;
  try {
    preparing = runtime.prepareDecisionContext(handle);
    await Promise.race([entered.promise, preparing.then(() => { throw new Error('准备操作未经过预定屏障'); })]);
    competing = runtime.submit(room.connections[0], actionRaw(room, 0, { kind: 'move', regionId: 'store' }));
    await until(async () => (await database.pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%sessions%FOR UPDATE%'")).rowCount > 0, '竞争操作必须真正等待 Session 行锁');
    release.resolve();
    const prepared = await preparing;
    assert.equal((await competing).status, 'Accepted');
    const atPreparation = await runtime.replay(room.sessionId, prepared.context.snapshotSeq);
    assert.equal(prepared.context.current.characters.find(c => c.characterId === room.actors[0]).regionId, atPreparation.characters[room.actors[0]].regionId);
    assert.equal(prepared.decision.readVersions[`character:${room.actors[0]}`], atPreparation.characters[room.actors[0]].resourceRevision);
    const receipt = await runtime.submitIntent(handle, prepared.decision.decisionId, JSON.stringify({ decisionId: prepared.decision.decisionId, toolCalls: [{ kind: 'wait' }] }));
    assert.equal(receipt.code, 'DECISION_STALE');
    assert.equal(receipt.actionEventRange, null);
  } finally { release.resolve(); await Promise.allSettled([preparing, competing]); runtime.hooks.beforeCommit = previous; }
});
after(async () => { await runtime?.close(); await database?.stop(); });

test('真实 PostgreSQL：原子准备将合法 Memory、持久目标和 Decision 绑定同一水位', async () => {
  const room = await createRunningRoom(runtime);
  const handle = await runtime.bindInternal(room.sessionId, 'tangseng', 'core_npc');
  const prepared = await runtime.prepareDecisionContext(handle);
  const { decision, context } = prepared;
  assert.equal(context.sessionId, room.sessionId);
  assert.equal(context.actorId, 'tangseng');
  assert.equal(context.principalKind, 'core_npc');
  assert.equal(context.decision.decisionId, decision.decisionId);
  assert.deepEqual(context.memory.observations.map(o => o.observationId), decision.observationIds);
  assert.ok(context.memory.goals.length > 0);
  assert.ok(context.memory.goals.every(g => g.holderId === 'tangseng'));
  assert.ok(context.memory.beliefs.every(b => b.holderId === 'tangseng'));
  assert.equal(decision.readVersions['target:passage_structure'], '0');
  const saved = (await database.pool.query('SELECT state FROM sessions WHERE session_id=$1', [room.sessionId])).rows[0].state;
  assert.equal(context.snapshotSeq, saved.sessionSeq);
  for (const goal of context.memory.goals) {
    assert.deepEqual(saved.goals[`tangseng:${goal.goalId}`], goal);
    const source = context.memory.goalSources.find(s => s.goalId === goal.goalId);
    assert.equal(source.goalRevision, goal.revision);
    assert.equal(source.principalKind, 'core_npc');
  }
  assert.deepEqual(await runtime.replay(room.sessionId), saved);
  const again = await runtime.prepareDecisionContext(handle);
  assert.equal(again.context.snapshotSeq, context.snapshotSeq, '无变化的重新准备不能新增目标事件');
  assert.notEqual(again.decision.decisionId, decision.decisionId);
  assert.deepEqual(again.context.memory.goals, context.memory.goals);
});
