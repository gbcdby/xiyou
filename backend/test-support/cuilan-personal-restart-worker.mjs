import assert from 'node:assert/strict';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { createAuthorityServer } from '../server.mjs';
import { decodeJsonbText } from '../jsonb-text.mjs';
import { accepted, take } from './gaolao-room.mjs';
import { openSceneDoor, finishSceneRoute } from './scene-policy-room.mjs';
import { personalSceneRoom } from './gaolao-personal-scene-room.mjs';
import { sampleSharedPersonalEffects, assertBothActiveEffects, assertSharedStoppedEffects, assertSharedStopTransaction, assertOriginalReceiptRead, tracePersonalTransactions } from './personal-shared-effects.mjs';
import { until } from './ai-room.mjs';

const send = value => new Promise((resolve, reject) => process.send(value, error => error ? reject(error) : resolve()));

/** 只收集同局两用途由生产本人实际提交的C2；返回值用于IPC证据，不制造收据。 */
export async function waitForPersonalWithdrawals(pool, sessionId, actorId, consentIds) {
  let completed;
  await until(async () => {
    const rows = (await pool.query(`SELECT i.intent_id,i.actor_id,i.request,i.execution_context,r.receipt
      FROM spatial_intents i JOIN action_receipts r ON r.session_id=i.session_id AND r.client_action_id=i.request->>'clientActionId' AND r.actor_id=i.actor_id
      WHERE i.session_id=$1 AND i.actor_id=$2 AND i.execution_context->>'mode'='scene-policy'`, [sessionId, actorId])).rows;
    const decisions = consentIds.map(consentId => rows.find(value => value.request.action.kind === 'withdraw_consent' && value.request.action.consentId === consentId && value.receipt.publicReceipt?.status === 'Accepted'));
    if (!decisions.every(Boolean)) return false;
    completed = decisions; return true;
  }, '恢复后两项中断由生产本人各自真实C2收束', 20000);
  return completed;
}

// 仅测试父进程可以启动两个固定阶段；没有任意动作、SQL写入或状态灌入的IPC接口。
if (process.argv[1] === fileURLToPath(import.meta.url)) process.once('message', async input => {
  let pool, server, room, trace, stage = 'input';
  try {
    assert.ok(['prepare', 'resume'].includes(input.phase));
    const clock = { value: input.phase === 'prepare' ? Date.parse('2026-11-14T18:00:00Z') : input.resume.clockValue };
    pool = new pg.Pool({ ...input.connection, max: 8 });
    if (input.phase === 'prepare') {
      stage = 'create-production-room';
      server = await createAuthorityServer({ pool, now: () => clock.value });
      room = await personalSceneRoom(server, clock);
      assert.deepEqual(room.bindings.map(row => row.key), ['tang', 'wukong', 'bajie']);
      await assert.rejects(room.send('cuilan', { kind: 'wait' }), /禁止控制/);
      await openSceneDoor(room); assert.equal((await room.propose('front-guest-room')).status, 'accepted');
      await finishSceneRoute(room, 'front-guest-room');
      const safe = room.content.chapterRules.safeDestinations.find(row => row.destinationId === 'front-guest-room');
      await room.go(0, safe);
      stage = 'request-real-personal-permissions';
      accepted(await room.interact(0, '翠兰', 'gz-request-appearance', { destinationId: 'rear-meeting', permissionTerm: 'single_use' }));
      await room.drain();
      let current = await room.state();
      const appearance = Object.values(current.chapter.consents).findLast(row => row.purpose === 'appearance');
      assert.equal(appearance.status, 'accepted');
      accepted(await room.interact(0, '翠兰', 'gz-describe-private-items'));
      const offer = (await room.snapshot(0)).projection.chapter.privateItemOffers[0], option = offer.options.find(row => row.label === '私人包裹');
      assert.ok(option);
      accepted(await room.interact(0, '翠兰', 'gz-request-private-items', { offerRef: offer.offerRef, itemOptionRefs: [option.optionRef], permissionTerm: 'single_use' }));
      await room.drain(); current = await room.state();
      const privateConsent = Object.values(current.chapter.consents).findLast(row => row.purpose === 'private_items');
      assert.equal(privateConsent.status, 'accepted');
      stage = 'apply-and-hold-before-crash';
      const item = room.content.items.find(row => row.itemId === 'gz-parcel');
      await room.go(0, item); const taken = await take(room, 0, item.name);
      const originalTake = room.actions.find(row => row.receipt.clientActionId === taken.clientActionId); assert.ok(originalTake);
      await room.go('wukong', room.content.chapterRules.meetingDestinations.find(row => row.destinationId === 'rear-meeting'));
      const applyReceipt = accepted(await room.interact('wukong', 'self', 'gz-apply-appearance', { consentId: appearance.consentId, expectedConsentVersion: appearance.version }));
      await room.drain();
      const oldView = (await room.snapshot(0)).viewId;
      current = await room.state();
      const actorId = current.members.find(row => row.userId === room.users[0].userId).characterId;
      const context = { actorId, itemId: item.itemId, acquisitionId: current.items[item.itemId].personalAcquisitionId, appearance: appearance.consentId, private_items: privateConsent.consentId };
      const before = sampleSharedPersonalEffects(current, context); assertBothActiveEffects(before);
      await send({ type: 'prepared', evidence: { before, applyReceipt, originalTake, oldView, bindings: room.bindings, sceneStatus: room.sceneStatus() },
        // 凭据只在此私有IPC定位旧账号；不含权威state，不进入结果文件。
        resume: { clockValue: clock.value, version: room.content.contentVersion, sessionId: room.sessionId, users: room.users, context, originalTake, oldView } });
      // 不执行close/断线；父进程只对自己fork的这个PID发SIGKILL。
      await new Promise(() => {});
    }

    stage = 'read-persisted-input-before-recovery';
    const resume = input.resume;
    assert.deepEqual(Object.keys(resume).sort(), ['clockValue', 'context', 'oldView', 'originalTake', 'sessionId', 'users', 'version']);
    const row = (await pool.query('SELECT state,state_text_encoding FROM sessions WHERE session_id=$1', [resume.sessionId])).rows[0];
    const before = sampleSharedPersonalEffects(decodeJsonbText(row.state, row.state_text_encoding), resume.context); assertBothActiveEffects(before);
    const recoveryCommits = [];
    stage = 'real-authority-server-recovery';
    server = await createAuthorityServer({ pool, now: () => clock.value, hooks: {
      afterCommit({ command, sessionId, events }) {
        // 只记录生产恢复已经提交的事件；不阻塞、删改或添加事件。
        if (command === 'spatial-recovery' && sessionId === resume.sessionId) recoveryCommits.push(structuredClone(events));
      },
    } });
    assert.equal(recoveryCommits.length, 1);
    const events = recoveryCommits[0], from = String(BigInt(events[0].sessionSeq) - 1n), through = events.at(-1).sessionSeq;
    const outbox = (await pool.query('SELECT from_exclusive::text,through_seq::text FROM outbox WHERE session_id=$1 AND from_exclusive=$2 AND through_seq=$3', [resume.sessionId, from, through])).rows;
    assert.equal(outbox.length, 1);
    const recovery = { command: 'spatial-recovery', committed: true, events, outbox: outbox[0], before,
      after: sampleSharedPersonalEffects(await server.runtime.replay(resume.sessionId, through), resume.context) };
    assertSharedStopTransaction(before, recovery); assert.equal(recovery.after.paused, true);
    assert.equal(recovery.before.sessionSeq, from, '恢复输入必须接续宕机后持久水位');
    await send({ type: 'recovered', recovery });

    stage = 'reconnect-existing-accounts-and-c2';
    room = await personalSceneRoom(server, clock, resume.version, resume.users.length, { existing: { sessionId: resume.sessionId, users: resume.users } });
    const c2 = await waitForPersonalWithdrawals(pool, room.sessionId, room.content.chapterRules.people.cuilan, [resume.context.appearance, resume.context.private_items]);
    const reconnected = await room.snapshot(0); assert.notEqual(reconnected.viewId, resume.oldView);
    const remaining = reconnected.projection.chapter.privateReturns.find(value => value.returnContextId === resume.context.acquisitionId);
    assert.equal(remaining?.mode, 'return_only'); assert.equal(remaining.originalConsentId, resume.context.private_items);
    assertSharedStoppedEffects(before, sampleSharedPersonalEffects(await room.state(), resume.context), { systemPhase: false });
    stage = 'read-and-retry-original-receipt';
    trace = tracePersonalTransactions(server.runtime, room.sessionId, resume.context);
    const readReceipt = await room.readReceipt(0, resume.originalTake.receipt.clientActionId);
    const readTransaction = trace.records.find(value => value.command === 'receipt'); assert.ok(readTransaction);
    assertOriginalReceiptRead(resume.originalTake, readReceipt, readTransaction);
    const marker = trace.records.length;
    const retryReceipt = await room.retryOriginal(0, resume.originalTake.raw);
    const retryTransaction = trace.records.slice(marker).find(value => value.command === 'spatial-action'); assert.ok(retryTransaction);
    assertOriginalReceiptRead(resume.originalTake, retryReceipt, retryTransaction, { command: 'spatial-action' });
    trace.close(); trace = null;
    stage = 'normal-narrow-return';
    const safe = room.content.chapterRules.safeDestinations.find(value => value.destinationId === 'front-guest-room');
    await room.go(0, safe);
    const latest = (await room.snapshot(0)).projection.chapter.privateReturns.find(value => value.returnContextId === resume.context.acquisitionId), owner = await room.entity(0, '翠兰');
    assert.equal(latest.returnContextId, remaining.returnContextId);
    const returned = accepted(await room.send(0, { kind: 'transfer_item', itemRef: latest.itemRef, expectedItemRevision: latest.itemRevision, recipientRef: owner.entityRef }));
    const finalState = await room.state(), acquisition = finalState.chapter.privateAcquisitions[resume.context.acquisitionId];
    assert.equal(acquisition.outcome, 'delivered_to_owner');
    assert.equal(acquisition.originalConsentId, resume.context.private_items);
    assert.equal(finalState.items[resume.context.itemId].location.characterId, room.content.chapterRules.people.cuilan);
    assert.equal((await room.snapshot(0)).projection.chapter.privateReturns.length, 0);
    const refused = await room.interact('wukong', 'self', 'gz-apply-appearance', { consentId: resume.context.appearance, expectedConsentVersion: before.purposes.appearance.consent.version });
    assert.equal(refused.status, 'Rejected');
    const intents = (await pool.query('SELECT actor_id,request,execution_context FROM spatial_intents WHERE session_id=$1', [room.sessionId])).rows;
    const ownerId = room.content.chapterRules.people.cuilan;
    assert.ok(intents.filter(value => value.actor_id === ownerId).every(value => value.execution_context.mode === 'scene-policy' && value.execution_context.scenePolicyBasis.policyVersion === 'gaolao-cuilan-v2'));
    const allowed = new Set(['tang', 'wukong', 'bajie'].map(key => room.content.chapterRules.people[key]));
    assert.ok(intents.filter(value => value.execution_context.mode !== 'scene-policy').every(value => allowed.has(value.actor_id)));
    assert.equal((await pool.query('SELECT count(*)::integer AS count FROM ai_runs WHERE session_id=$1', [room.sessionId])).rows[0].count, 0);
    const result = { beforeRecovery: before, recovery, oldView: resume.oldView, newView: reconnected.viewId, remaining, c2,
      originalTake: resume.originalTake, receiptRead: { actual: readReceipt, transaction: readTransaction }, receiptRetry: { actual: retryReceipt, transaction: retryTransaction },
      returned, acquisition, oldApplyRejected: refused, controlledBindings: room.bindings, sceneIntents: intents.filter(value => value.actor_id === ownerId), realProviderCalls: 0 };
    stage = 'cleanup-own-server';
    await room.close(); room = null; await server.close(); server = null; await pool.end(); pool = null;
    await send({ type: 'complete', result }); process.disconnect();
  } catch (error) {
    // 不输出IPC、数据库连接、账号token或可能包含它们的异常正文。
    await send({ type: 'failed', stage, error: { name: error.name, code: error.code ?? null } }).catch(() => {});
    trace?.close(); await room?.close().catch(() => {}); await server?.close().catch(() => {}); await pool?.end().catch(() => {});
    process.exitCode = 1; process.disconnect();
  }
});
