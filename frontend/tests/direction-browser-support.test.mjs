import test from 'node:test';
import assert from 'node:assert/strict';
import { observeDirectionConnections, assertShortDirectionPlan } from './direction-browser-support.mjs';
import { spatialSnapshot } from './spatial-fixture.mjs';

test('新模式资格：受控适配层拒绝旧回退、未安装view、错误epoch及未接受能力', async () => {
  const snapshot = spatialSnapshot(), handle = { connectionId: 'controlled-connection' }, capabilities = ['spatial-v2', 'spatial-direction-v1', 'spatial-timed-trail-v1'];
  const state = { connection: 'online', inputReady: true, timedTrail: true, snapshot };
  const view = { active: true, sessionId: snapshot.sessionId, viewId: snapshot.viewId, userId: 'user', ownedEpoch: '2', schemaVersion: 2 };
  let pending = false, called = 0;
  const runtime = { spatialDirection: { checkpointMs: 50 }, async openConnection(...args) { called++; assert.equal(this, runtime); assert.deepEqual(args, ['private-token', capabilities]); return handle; },
    connectionView: value => value === handle ? view : null, connection: () => ({ capabilities }), pendingViewInstallation: () => pending };
  const original = runtime.openConnection, observer = observeDirectionConnections(runtime), page = { evaluate: async () => state };
  try {
    assert.equal(await runtime.openConnection('private-token', capabilities), handle); assert.equal(called, 1);
    const result = await observer.qualify(page, 'user', 'controlled-unit'); assert.deepEqual(result.acceptedCapabilities, capabilities); assert.ok(!JSON.stringify(result).includes('private-token'));
    state.timedTrail = false; await assert.rejects(observer.qualify(page, 'user', 'fallback')); state.timedTrail = true;
    pending = true; await assert.rejects(observer.qualify(page, 'user', 'pending')); pending = false;
    view.ownedEpoch = '1'; await assert.rejects(observer.qualify(page, 'user', 'old-epoch')); view.ownedEpoch = '2';
    view.viewId = 'old-view'; await assert.rejects(observer.qualify(page, 'user', 'old-view')); view.viewId = snapshot.viewId;
    capabilities.pop(); await assert.rejects(observer.qualify(page, 'user', 'direction-only'));
  } finally { observer.close(); }
  assert.equal(runtime.openConnection, original);
});

test('短按身份取证：受控原Receipt/事件起点检查不接受目标或客户端位置替代', async () => {
  const snapshot = spatialSnapshot(), self = snapshot.projection.self;
  const move = { kind: 'move_direction', sceneId: self.sceneId, mapVersion: snapshot.projection.mapVersion, direction: 'E', movementCommandSeq: '1' };
  const requests = [move, { kind: 'stop_move', movementCommandSeq: '2' }].map((action, index) => ({ schemaVersion: 2, sessionId: snapshot.sessionId, viewId: snapshot.viewId,
    actorRef: self.entityRef, controlEpoch: self.controlEpoch, clientActionId: 'tap-' + index, baseSeq: snapshot.snapshotSeq, action }));
  const receipts = requests.map((request, index) => ({ schemaVersion: 2, sessionId: request.sessionId, clientActionId: request.clientActionId, status: 'Accepted', code: 'OK', observedSeq: String(11 + index),
    actionEventRange: { first: String(11 + index), last: String(11 + index) }, result: index ? { movementCommandSeq: '2', status: 'cancelled' } : { movementId: 'move-1', planVersion: '1', movementCommandSeq: '1', status: 'accepted' } }));
  const drafts = requests.map((request, index) => ({ raw: JSON.stringify(request), receipt: receipts[index] }));
  const plan = { status: 'accepted', movementId: 'move-1', movementCommandSeq: '1', controlEpoch: self.controlEpoch, path: [{ x: 100, y: 100 }, { x: 136, y: 100 }] };
  const pool = { async query(sql, values) {
    assert.ok(sql.startsWith('SELECT '), '取证不得写数据库');
    if (sql.includes('action_receipts')) return { rows: [{ actor_id: 'actor', receipt: { publicReceipt: receipts[Number(values[1].at(-1))] } }] };
    return { rows: [{ event: { sessionSeq: '11', kind: 'spatial.actor', payload: { actor: { characterId: 'actor', movement: plan } } }, event_text_encoding: null }] };
  } };
  const basis = { sessionId: snapshot.sessionId, before: { actorId: 'actor', position: { x: 100, y: 100 }, controlEpoch: self.controlEpoch, sceneId: self.sceneId, mapVersion: snapshot.projection.mapVersion, movementStatus: null },
    clientStart: { x: 100, y: 100 }, clientEnd: { x: 104, y: 100 }, after: { position: { x: 104, y: 100 }, controlEpoch: self.controlEpoch } };
  assert.equal((await assertShortDirectionPlan(pool, drafts, basis)).pathDistance, 36);
  plan.path[0] = { x: 101, y: 100 }; await assert.rejects(assertShortDirectionPlan(pool, drafts, basis)); plan.path[0] = { x: 100, y: 100 };
  plan.path[1] = { x: 137, y: 100 }; await assert.rejects(assertShortDirectionPlan(pool, drafts, basis));
});
