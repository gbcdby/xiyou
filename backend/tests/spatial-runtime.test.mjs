import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createRuntime } from '../runtime.mjs';
import { validateSpatial } from '../../protocol/spatial.mjs';
let database, runtime, clock = Date.parse('2026-11-12T00:00:00.000Z');
const caps = ['spatial-v2'];
before(async () => { database = await startTestPostgres('spatial-runtime', { outputSubdirectory: 'space' }); runtime = await createRuntime({ pool: database.pool, now: () => clock }); });
after(async () => { await runtime?.close(); await database?.stop(); });
async function room(count = 2) {
    const users = [];
    for (let i = 0; i < count; i++)
        users.push(await runtime.guest({ name: `空间玩家${i + 1}` }));
    const { sessionId } = await runtime.create(users[0].token, { nonce: crypto.randomUUID(), contentVersion: 'spatial-graybox-v2', capabilities: caps });
    for (const u of users)
        await runtime.join(u.token, sessionId, { nonce: crypto.randomUUID(), capabilities: caps });
    await runtime.start(users[0].token, sessionId, { nonce: 'start' });
    const r = { sessionId, users, connections: [], snapshots: [] };
    for (const u of users) {
        const h = await runtime.openConnection(u.token, caps);
        const s = await runtime.subscribe(h, sessionId);
        const response = await runtime.control(h, JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId, viewId: s.viewId, actorRef: s.projection.self.entityRef, nonce: crypto.randomUUID() }));
        r.connections.push(h);
        r.snapshots.push(response.snapshot);
    }
    await refresh(r);
    return r;
}
async function refresh(r) { r.snapshots = await Promise.all(r.users.map(u => runtime.snapshot(u.token, r.sessionId, caps))); return r.snapshots; }
function raw(r, index, action, overrides = {}) { const s = r.snapshots[index]; return JSON.stringify({ schemaVersion: 2, sessionId: r.sessionId, viewId: s.viewId, actorRef: s.projection.self.entityRef, controlEpoch: s.projection.self.controlEpoch, clientActionId: crypto.randomUUID(), baseSeq: s.snapshotSeq, action, ...overrides }); }
async function send(r, i, action, overrides = {}) { return runtime.submit(r.connections[i], raw(r, i, action, overrides)); }
const move = (seq, x, y, sceneId = 'gray-yard') => ({ kind: 'move_to', movementCommandSeq: String(seq), sceneId, destination: { x, y } });
const item = (r, i, name = '公共支架') => r.snapshots[i].projection.items.find(x => x.name === name);
async function step(r, ms) {
    clock += ms;
    for (const c of r.connections)
        await runtime.heartbeat(c);
    await runtime.maintenance(r.sessionId);
    await refresh(r);
}
async function saved(r) { return (await database.pool.query('SELECT state FROM sessions WHERE session_id=$1', [r.sessionId])).rows[0].state; }
test('真实数据库：能力协商、严格v2输出及旧region会话仍按原解释器回放', async () => {
    const r = await room(2);
    const snapshot = r.snapshots[0];
    validateSpatial('SnapshotV2', snapshot);
    assert.equal(snapshot.projection.paused, false);
    await assert.rejects(runtime.snapshot(r.users[0].token, r.sessionId), { code: 'UPGRADE_REQUIRED' });
    const old = await runtime.openConnection(r.users[0].token);
    await assert.rejects(runtime.subscribe(old, r.sessionId), { code: 'UPGRADE_REQUIRED' });
    for (const forbidden of ['characterId', 'actorId', 'principalId', 'realName', 'roles', 'controller', 'gray-guide', 'public-tool'])
        assert.ok(!JSON.stringify(snapshot).includes(forbidden), forbidden);
    assert.deepEqual(await runtime.replay(r.sessionId), await saved(r));
    const legacy = await runtime.create(r.users[0].token, { nonce: crypto.randomUUID(), contentVersion: 'trust-repair-fixture-v1' });
    assert.equal((await runtime.snapshot(r.users[0].token, legacy.sessionId)).schemaVersion, 1);
    assert.equal((await runtime.replay(legacy.sessionId)).reducerVersion, 'world-v1');
});
test('真实数据库：并发抢物仅一个owner，原Receipt重放，异载荷复用拒绝', async () => {
    const r = await room(3);
    const requests = [0, 1].map(i => raw(r, i, { kind: 'take_item', itemRef: item(r, i).entityRef, expectedItemRevision: '0' }));
    const results = await Promise.all(requests.map((a, i) => runtime.submit(r.connections[i], a)));
    assert.equal(results.filter(x => x.status === 'Accepted').length, 1);
    assert.equal(results.filter(x => x.status === 'Rejected').length, 1);
    assert.deepEqual(await runtime.submit(r.connections[0], requests[0]), results[0]);
    const changed = JSON.parse(requests[0]);
    changed.action = { kind: 'wait' };
    await assert.rejects(runtime.submit(r.connections[0], JSON.stringify(changed)), { code: 'ACTION_ID_REUSE' });
    const state = await saved(r);
    assert.equal(state.items['public-tool'].resourceRevision, '1');
    assert.equal(state.items['public-tool'].location.kind, 'character');
    assert.deepEqual(await runtime.replay(r.sessionId), state);
});
test('真实数据库：两个目标乱序、停止围栏、领域拒绝也消费新水位而不取消当前路线', async () => {
    const r = await room();
    const older = raw(r, 0, move(1, 180, 120));
    assert.equal((await send(r, 0, move(2, 220, 100))).status, 'Accepted');
    assert.equal((await runtime.submit(r.connections[0], older)).code, 'STALE_MOVEMENT_COMMAND');
    const denied = await send(r, 0, move(4, 290, 200));
    assert.equal(denied.code, 'PATH_UNREACHABLE');
    assert.equal((await send(r, 0, move(3, 100, 200))).code, 'STALE_MOVEMENT_COMMAND');
    assert.equal((await saved(r)).characters[(await saved(r)).members[0].characterId].movement.movementCommandSeq, '2');
    assert.equal((await send(r, 0, { kind: 'stop_move', movementCommandSeq: '5' })).status, 'Accepted');
    assert.equal((await send(r, 0, move(2, 220, 100))).code, 'STALE_MOVEMENT_COMMAND');
    await step(r, 1000);
    assert.deepEqual(r.snapshots[0].projection.self.position, { x: 100, y: 100 });
    assert.equal(r.snapshots[0].projection.self.movementCommandHighWater, '5');
});
test('真实数据库：已提交但ACK未知的旧请求返回原accept，不复活旧路线；同事务水位与回执', async () => {
    const r = await room();
    const first = raw(r, 0, move(1, 220, 100)), accepted = await runtime.submit(r.connections[0], first);
    await send(r, 0, { kind: 'stop_move', movementCommandSeq: '2' });
    assert.deepEqual(await runtime.submit(r.connections[0], first), accepted);
    runtime.hooks.beforeCommit = ({ command }) => {
        if (command === 'spatial-action')
            throw new Error('模拟事务回滚');
    };
    const rolled = raw(r, 0, move(7, 230, 100));
    await assert.rejects(runtime.submit(r.connections[0], rolled));
    delete runtime.hooks.beforeCommit;
    await refresh(r);
    assert.equal(r.snapshots[0].projection.self.movementCommandHighWater, '2');
    assert.equal(await runtime.receipt(r.users[0].token, r.sessionId, JSON.parse(rolled).clientActionId), null);
    assert.equal((await runtime.submit(r.connections[0], rolled)).status, 'Accepted');
    runtime.hooks.afterCommit = ({ command }) => {
        if (command === 'spatial-action')
            throw new Error('模拟ACK丢失');
    };
    const unknown = raw(r, 0, { kind: 'stop_move', movementCommandSeq: '8' });
    assert.equal((await runtime.submit(r.connections[0], unknown)).status, 'Accepted');
    delete runtime.hooks.afterCommit;
    await step(r, 1000);
    assert.deepEqual(r.snapshots[0].projection.self.position, { x: 100, y: 100 });
});
test('真实数据库：连续路径真实到达、跨墙绕行，途中转交在当前时刻复验距离', async () => {
    const r = await room();
    await send(r, 0, { kind: 'take_item', itemRef: item(r, 0).entityRef, expectedItemRevision: '0' });
    await refresh(r);
    const recipient = r.snapshots[0].projection.entities.find(x => x.name === '空间玩家2').entityRef;
    const accepted = await send(r, 0, move(1, 450, 200));
    assert.equal(accepted.result.status, 'accepted');
    await step(r, 1500);
    const mid = r.snapshots[0].projection.self.position;
    assert.notDeepEqual(mid, { x: 450, y: 200 });
    assert.ok(mid.x < 280 || mid.y < 100 || mid.y > 300);
    const transfer = await send(r, 0, { kind: 'transfer_item', itemRef: item(r, 0).entityRef, expectedItemRevision: '1', recipientRef: recipient });
    assert.equal(transfer.status, 'Rejected');
    assert.ok(['OUT_OF_RANGE', 'STALE_REFERENCE', 'OCCLUDED'].includes(transfer.code));
    await step(r, 6000);
    assert.deepEqual(r.snapshots[0].projection.self.position, { x: 450, y: 200 });
    assert.equal(r.snapshots[0].projection.movement.status, 'arrived');
    assert.deepEqual(await runtime.replay(r.sessionId), await saved(r));
});
test('真实数据库：受众按发生时空间冻结，后来走近和重连不补听', async () => {
    const r = await room();
    await send(r, 1, move(1, 450, 200));
    await step(r, 6000);
    await send(r, 0, { kind: 'speak', text: '墙这边发生的一次陈述', channel: 'public', recipientRefs: [] });
    await send(r, 1, move(2, 120, 100));
    await step(r, 6000);
    assert.ok(r.snapshots[0].projection.claims.some(c => c.text === '墙这边发生的一次陈述'));
    assert.ok(!r.snapshots[1].projection.claims.some(c => c.text === '墙这边发生的一次陈述'));
    await send(r, 0, { kind: 'speak', text: '只给真人队伍', channel: 'team', recipientRefs: [] });
    const state = await saved(r);
    assert.ok(!(state.claims['gray-guide'] ?? []).some(c => c.text === '只给真人队伍'));
    const old = r.snapshots[0].projection.claims[0];
    await runtime.subscribe(r.connections[0], r.sessionId);
    await refresh(r);
    assert.deepEqual(r.snapshots[0].projection.claims[0], old);
});
test('真实数据库：合作锁定一次，准备者掉线不能移除已锁支架，物品仍唯一', async () => {
    const r = await room(3);
    await send(r, 0, { kind: 'take_item', itemRef: item(r, 0).entityRef, expectedItemRevision: '0' });
    await send(r, 0, move(1, 140, 180));
    await send(r, 1, move(1, 180, 180));
    await step(r, 1200);
    for (const i of [0, 1]) {
        assert.equal((await send(r, i, { kind: 'cooperate', operationId: 'lock-support', operationVersion: '0', phase: 'prepare' })).status, 'Accepted');
    }
    const first = await send(r, 0, { kind: 'cooperate', operationId: 'lock-support', operationVersion: '0', phase: 'ready' });
    assert.equal(first.status, 'Accepted');
    const firstId = (await saved(r)).members[0].characterId;
    const sameAnchor = (await saved(r)).cooperations['lock-support'].ready[firstId];
    assert.equal((await send(r, 0, { kind: 'cooperate', operationId: 'lock-support', operationVersion: '0', phase: 'prepare' })).status, 'Accepted');
    assert.deepEqual((await saved(r)).cooperations['lock-support'].ready[firstId], sameAnchor);
    assert.equal((await send(r, 0, { kind: 'cooperate', operationId: 'lock-support', operationVersion: '0', phase: 'cancel' })).status, 'Accepted');
    assert.deepEqual((await saved(r)).cooperations['lock-support'].ready, {});
    assert.equal((await send(r, 0, { kind: 'cooperate', operationId: 'lock-support', operationVersion: '0', phase: 'prepare' })).status, 'Accepted');
    assert.deepEqual((await saved(r)).cooperations['lock-support'].ready, {});
    assert.equal((await send(r, 0, { kind: 'cooperate', operationId: 'lock-support', operationVersion: '0', phase: 'ready' })).status, 'Accepted');
    const request = raw(r, 1, { kind: 'cooperate', operationId: 'lock-support', operationVersion: '0', phase: 'ready' });
    const final = await runtime.submit(r.connections[1], request);
    assert.equal(final.result.status, 'locked');
    assert.deepEqual(await runtime.submit(r.connections[1], request), final);
    await runtime.disconnect(r.connections[0]);
    await runtime.maintenance(r.sessionId);
    const state = await saved(r);
    assert.equal(state.targets.support.fields.find(f => f.key === 'locked').value, true);
    assert.equal(state.targets.support.resourceRevision, '1');
    assert.equal(state.items['public-tool'].resourceRevision, '2');
    assert.equal(state.cooperations['lock-support'].phase, 'locked');
    assert.deepEqual(await runtime.replay(r.sessionId), state);
});
test('R-A1-STD-002：取消后重新准备换位使旧ready失效，双方重新确认才锁定一次', async () => {
    const r = await room();
    const cooperate = phase => ({ kind: 'cooperate', operationId: 'lock-support', operationVersion: '0', phase });
    assert.equal((await send(r, 0, { kind: 'take_item', itemRef: item(r, 0).entityRef, expectedItemRevision: '0' })).status, 'Accepted');
    for (const i of [0, 1])
        assert.equal((await send(r, i, move(1, 140, 180))).status, 'Accepted');
    await step(r, 2000);
    const [firstId, secondId] = (await saved(r)).members.map(m => m.characterId);
    assert.equal((await send(r, 1, cooperate('prepare'))).status, 'Accepted');
    assert.equal((await send(r, 0, cooperate('ready'))).status, 'Accepted');
    assert.equal((await saved(r)).cooperations['lock-support'].ready[firstId].anchorId, 'support-right');
    assert.equal((await send(r, 1, cooperate('cancel'))).status, 'Accepted');
    assert.equal((await saved(r)).cooperations['lock-support'].participants[secondId], undefined);
    const prepareRequest = raw(r, 0, cooperate('prepare'));
    const prepared = await runtime.submit(r.connections[0], prepareRequest);
    assert.equal(prepared.status, 'Accepted');
    const rePrepared = (await saved(r)).cooperations['lock-support'];
    assert.equal(rePrepared.participants[firstId], 'support-left');
    assert.equal(rePrepared.ready[firstId], undefined);
    await refresh(r);
    assert.equal(r.snapshots[0].projection.cooperations[0].readyCount, 0);
    const waiting = await send(r, 1, cooperate('ready'));
    assert.equal(waiting.status, 'Accepted');
    assert.notEqual(waiting.result.status, 'locked');
    const pending = await saved(r);
    assert.equal(pending.cooperations['lock-support'].phase, 'preparing');
    assert.deepEqual(Object.keys(pending.cooperations['lock-support'].ready), [secondId]);
    assert.equal(pending.targets.support.resourceRevision, '0');
    assert.equal(pending.targets.support.fields.find(f => f.key === 'locked').value, false);
    assert.equal(pending.items['public-tool'].resourceRevision, '1');
    assert.deepEqual(pending.items['public-tool'].location, { kind: 'character', characterId: firstId });
    const finalRequest = raw(r, 0, cooperate('ready'));
    const final = await runtime.submit(r.connections[0], finalRequest);
    assert.equal(final.status, 'Accepted');
    assert.equal(final.result.status, 'locked');
    assert.deepEqual(await runtime.submit(r.connections[0], finalRequest), final);
    assert.deepEqual(await runtime.receipt(r.users[0].token, r.sessionId, JSON.parse(finalRequest).clientActionId), final);
    assert.deepEqual(await runtime.submit(r.connections[0], prepareRequest), prepared);
    const state = await saved(r), cooperation = state.cooperations['lock-support'];
    assert.equal(cooperation.phase, 'locked');
    assert.equal(cooperation.version, '1');
    assert.deepEqual(Object.values(cooperation.ready).map(value => value.anchorId).sort(), ['support-left', 'support-right']);
    for (const [id, ready] of Object.entries(cooperation.ready))
        assert.equal(ready.anchorId, cooperation.participants[id]);
    assert.equal(state.targets.support.resourceRevision, '1');
    assert.equal(state.items['public-tool'].resourceRevision, '2');
    assert.equal(state.items['public-tool'].lockedBy, 'lock-support');
    assert.deepEqual(state.items['public-tool'].location, { kind: 'ground', sceneId: 'gray-yard', position: state.targets.support.position });
    assert.deepEqual(await runtime.replay(r.sessionId), state);
});
test('真实数据库：离线公共物与重连原子竞争，私人物和旧holder epoch不可领回', async () => {
    const r = await room(3);
    await send(r, 0, { kind: 'take_item', itemRef: item(r, 0).entityRef, expectedItemRevision: '0' });
    await send(r, 0, { kind: 'take_item', itemRef: item(r, 0, '私人信件').entityRef, expectedItemRevision: '0' });
    await runtime.disconnect(r.connections[0]);
    clock += 6000;
    await runtime.maintenance(r.sessionId);
    await refresh(r);
    const publicItem = item(r, 1), holder = r.snapshots[1].projection.entities.find(x => x.name === '空间玩家1');
    assert.ok(publicItem.reclaimHolderEpoch);
    const request = raw(r, 1, { kind: 'reclaim_public_item', itemRef: publicItem.entityRef, holderRef: holder.entityRef, expectedItemRevision: '1', expectedHolderEpoch: publicItem.reclaimHolderEpoch });
    const handle = await runtime.openConnection(r.users[0].token, caps), s = await runtime.subscribe(handle, r.sessionId);
    const resume = runtime.control(handle, JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId: r.sessionId, viewId: s.viewId, actorRef: s.projection.self.entityRef, nonce: crypto.randomUUID() }));
    const [claimed] = await Promise.all([runtime.submit(r.connections[1], request), resume]);
    const state = await saved(r), owner = state.items['public-tool'].location.characterId;
    assert.equal(owner, claimed.status === 'Accepted' ? state.members[1].characterId : state.members[0].characterId);
    assert.equal(state.items['private-letter'].location.characterId, state.members[0].characterId);
    assert.equal(state.items['public-tool'].resourceRevision, claimed.status === 'Accepted' ? '2' : '1');
    assert.deepEqual(await runtime.replay(r.sessionId), state);
});
test('真实数据库：少于两人暂停，重启不追赶，旧epoch与旧内部意图不复活', async () => {
    const r = await room();
    const old = raw(r, 0, move(1, 240, 100));
    await runtime.submit(r.connections[0], old);
    await step(r, 400);
    await runtime.disconnect(r.connections[1]);
    const paused = await saved(r);
    clock += 20000;
    await runtime.maintenance(r.sessionId);
    assert.equal((await saved(r)).sceneTimeMs, paused.sceneTimeMs);
    const npc = await runtime.bindInternal(r.sessionId, 'gray-guide', 'core_npc');
    const reserved = await runtime.reserveSpatialIntent(npc, 'old-nav', { kind: 'move_to', sceneId: 'gray-yard', destination: { x: 100, y: 240 } });
    assert.equal(reserved.action.movementCommandSeq, '1');
    await runtime.close();
    clock += 120000;
    runtime = await createRuntime({ pool: database.pool, now: () => clock });
    const recovered = await saved(r);
    assert.equal(recovered.sceneTimeMs, paused.sceneTimeMs);
    assert.deepEqual(recovered.characters[recovered.members[0].characterId].position, paused.characters[paused.members[0].characterId].position);
    const newConnection = await runtime.openConnection(r.users[0].token, caps);
    assert.equal((await runtime.submit(newConnection, old)).status, 'Accepted');
    const unknown = JSON.parse(old);
    unknown.clientActionId = 'old-unsubmitted';
    unknown.action.movementCommandSeq = '999';
    assert.equal((await runtime.submit(newConnection, JSON.stringify(unknown))).code, 'STALE_CONTROL');
    const newNpc = await runtime.bindInternal(r.sessionId, 'gray-guide', 'core_npc');
    assert.equal((await runtime.submitSpatialIntent(newNpc, 'old-nav')).code, 'STALE_CONTROL');
    assert.deepEqual(await runtime.replay(r.sessionId), await saved(r));
});
test('真实数据库：可见轨迹只含发生时全程可见段，转墙、同期运动和重建视图不补演', async () => {
    const r = await room();
    const other = () => r.snapshots[0].projection.entities.find(e => e.name === '空间玩家2');
    await send(r, 1, move(1, 220, 80));
    await step(r, 1500);
    assert.ok(other().motionTrail.length >= 2);
    assert.equal(other().motionThroughSceneTimeMs, r.snapshots[0].projection.sceneTimeMs);
    await send(r, 1, move(2, 450, 200));
    await step(r, 5000);
    assert.equal(other(), undefined);
    await send(r, 1, move(3, 120, 100));
    await step(r, 6000);
    assert.ok(other());
    assert.equal(other().motionTrail, undefined);
    await send(r, 0, move(1, 110, 100));
    await send(r, 1, move(4, 180, 100));
    await step(r, 1000);
    assert.ok(other());
    assert.equal(other().motionTrail, undefined);
    await send(r, 1, move(5, 220, 100));
    await step(r, 1000);
    assert.ok(other().motionTrail);
    await runtime.subscribe(r.connections[0], r.sessionId);
    await refresh(r);
    assert.equal(other().motionTrail, undefined);
});
test('真实数据库：同epoch源持续编号；丢源后take与新连接resume建立新epoch，旧引用不能首次执行', async () => {
    const r = await room();
    await send(r, 0, move(1, 140, 100));
    const old = r.snapshots[0];
    const resumed = await runtime.control(r.connections[0], JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId: r.sessionId, viewId: old.viewId, actorRef: old.projection.self.entityRef, nonce: 'same-source' }));
    assert.equal(resumed.controlEpoch, old.projection.self.controlEpoch);
    r.snapshots[0] = resumed.snapshot;
    assert.equal((await send(r, 0, { kind: 'stop_move', movementCommandSeq: '2' })).status, 'Accepted');
    assert.equal((await send(r, 0, move(1, 160, 100))).code, 'STALE_MOVEMENT_COMMAND');
    const current = r.snapshots[0];
    const taken = await runtime.control(r.connections[0], JSON.stringify({ schemaVersion: 2, type: 'control.take', sessionId: r.sessionId, viewId: current.viewId, actorRef: current.projection.self.entityRef, nonce: 'lost-source' }));
    assert.ok(BigInt(taken.controlEpoch) > BigInt(current.projection.self.controlEpoch));
    r.snapshots[0] = taken.snapshot;
    assert.equal((await send(r, 0, move(1, 180, 100))).status, 'Accepted');
    const foreignRef = r.snapshots[1].projection.items.find(i => i.name === '公共支架').entityRef;
    assert.equal((await send(r, 0, { kind: 'take_item', itemRef: foreignRef, expectedItemRevision: '0' })).code, 'STALE_REFERENCE');
    await runtime.disconnect(r.connections[0]);
    const replacement = await runtime.openConnection(r.users[0].token, caps), s = await runtime.subscribe(replacement, r.sessionId);
    const replaced = await runtime.control(replacement, JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId: r.sessionId, viewId: s.viewId, actorRef: s.projection.self.entityRef, nonce: 'reconnect' }));
    assert.ok(BigInt(replaced.controlEpoch) > BigInt(taken.controlEpoch));
    const request = raw(r, 0, move(99, 200, 100), { clientActionId: 'never-submitted' });
    assert.equal((await runtime.submit(replacement, request)).code, 'STALE_CONTROL');
});
test('真实数据库：内部导航发出时统一预留，迟到首次提交/停止后回调不能到达，跨主体预留身份拒绝', async () => {
    const r = await room();
    const handle = await runtime.bindInternal(r.sessionId, 'gray-guide', 'core_npc');
    const first = await runtime.reserveSpatialIntent(handle, 'nav-one', { kind: 'move_to', sceneId: 'gray-yard', destination: { x: 120, y: 240 } });
    const second = await runtime.reserveSpatialIntent(handle, 'nav-two', { kind: 'move_to', sceneId: 'gray-yard', destination: { x: 220, y: 240 } });
    const stop = await runtime.reserveSpatialIntent(handle, 'nav-stop', { kind: 'stop_move' });
    assert.deepEqual([first, second, stop].map(x => x.action.movementCommandSeq), ['1', '2', '3']);
    assert.equal((await runtime.submitSpatialIntent(handle, 'nav-two')).status, 'Accepted');
    assert.equal((await runtime.submitSpatialIntent(handle, 'nav-one')).code, 'STALE_MOVEMENT_COMMAND');
    assert.equal((await runtime.submitSpatialIntent(handle, 'nav-stop')).status, 'Accepted');
    await step(r, 5000);
    assert.deepEqual((await saved(r)).characters['gray-guide'].position, { x: 100, y: 200 });
    assert.equal((await saved(r)).characters['gray-guide'].movement.status, 'cancelled');
    await assert.rejects(runtime.reserveSpatialIntent(handle, 'nav-one', { kind: 'move_to', sceneId: 'gray-yard', destination: { x: 140, y: 240 } }), { code: 'ACTION_ID_REUSE' });
    await assert.rejects(runtime.reserveSpatialIntent(handle, 'forged', { kind: 'stop_move', movementCommandSeq: '99' }), { code: 'INVALID_MESSAGE' });
});
test('真实数据库：合作成员掉线或离位使旧ready失效，替补可重新准备；代理看不到队聊', async () => {
    const r = await room(3);
    await send(r, 0, { kind: 'take_item', itemRef: item(r, 0).entityRef, expectedItemRevision: '0' });
    await send(r, 0, move(1, 140, 180));
    await send(r, 1, move(1, 180, 180));
    await step(r, 1500);
    await send(r, 0, { kind: 'cooperate', operationId: 'lock-support', operationVersion: '0', phase: 'ready' });
    await send(r, 1, { kind: 'cooperate', operationId: 'lock-support', operationVersion: '0', phase: 'prepare' });
    await send(r, 0, { kind: 'speak', text: '托管不得看见队伍私聊', channel: 'team', recipientRefs: [] });
    await runtime.disconnect(r.connections[0]);
    clock += 6000;
    await runtime.maintenance(r.sessionId);
    assert.equal((await saved(r)).cooperations['lock-support'].ready[(await saved(r)).members[0].characterId], undefined);
    const proxy = await runtime.bindInternal(r.sessionId, (await saved(r)).members[0].characterId, 'proxy');
    assert.ok(!(await runtime.observeInternal(proxy)).projection.claims.some(c => c.text === '托管不得看见队伍私聊'));
    assert.equal((await send(r, 1, { kind: 'cooperate', operationId: 'lock-support', operationVersion: '0', phase: 'ready' })).status, 'Accepted');
    assert.equal((await saved(r)).cooperations['lock-support'].phase, 'preparing');
});
test('真实数据库：领回先提交与重连先提交的两种次序都保留唯一物权', async () => {
    for (const reclaimFirst of [true, false]) {
        const r = await room(3);
        await send(r, 0, { kind: 'take_item', itemRef: item(r, 0).entityRef, expectedItemRevision: '0' });
        await runtime.disconnect(r.connections[0]);
        clock += 6000;
        await runtime.maintenance(r.sessionId);
        await refresh(r);
        const publicItem = item(r, 1), holder = r.snapshots[1].projection.entities.find(x => x.name === '空间玩家1');
        const claimRaw = raw(r, 1, { kind: 'reclaim_public_item', itemRef: publicItem.entityRef, holderRef: holder.entityRef, expectedItemRevision: '1', expectedHolderEpoch: publicItem.reclaimHolderEpoch });
        const connection = await runtime.openConnection(r.users[0].token, caps), snapshot = await runtime.subscribe(connection, r.sessionId);
        const resume = () => runtime.control(connection, JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId: r.sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce: 'resume-again' }));
        let claimed;
        if (reclaimFirst) {
            claimed = await runtime.submit(r.connections[1], claimRaw);
            await resume();
        }
        else {
            await resume();
            claimed = await runtime.submit(r.connections[1], claimRaw);
        }
        assert.equal(claimed.status, reclaimFirst ? 'Accepted' : 'Rejected');
        const state = await saved(r);
        assert.equal(state.items['public-tool'].location.characterId, state.members[reclaimFirst ? 1 : 0].characterId);
        assert.equal(state.items['public-tool'].resourceRevision, reclaimFirst ? '2' : '1');
        assert.deepEqual(await runtime.replay(r.sessionId), state);
    }
});
test('真实数据库：只读订阅不抢占现有控制视图，未显式接管仍被CONTROL_HELD拒绝', async () => {
    const r = await room();
    const priorView = runtime.connectionView(r.connections[0]);
    const watcher = await runtime.openConnection(r.users[0].token, caps), snapshot = await runtime.subscribe(watcher, r.sessionId);
    await assert.rejects(runtime.control(watcher, JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId: r.sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce: 'read-only-resume' })), { code: 'CONTROL_HELD' });
    await runtime.publishPending(async () => { });
    assert.equal(runtime.connectionView(r.connections[0]), priorView);
    assert.equal(priorView.active, true);
    assert.equal((await send(r, 0, move(1, 200, 100))).status, 'Accepted');
});
test('真实数据库：新障碍阻断原路线、出口近距及门控、地面放置和失效目标重验', async () => {
    const r = await room(3);
    assert.equal((await send(r, 0, move(1, 100, 100, 'gray-road'))).code, 'PATH_UNREACHABLE');
    await send(r, 0, { kind: 'take_item', itemRef: item(r, 0).entityRef, expectedItemRevision: '0' });
    await refresh(r);
    assert.equal((await send(r, 0, { kind: 'put_item', itemRef: item(r, 0).entityRef, expectedItemRevision: '1', sceneId: 'gray-yard', position: { x: 130, y: 110 } })).status, 'Accepted');
    await refresh(r);
    assert.equal(item(r, 0).location.kind, 'ground');
    assert.deepEqual(item(r, 0).location.position, { x: 130, y: 110 });
    await send(r, 0, { kind: 'take_item', itemRef: item(r, 0).entityRef, expectedItemRevision: '2' });
    await send(r, 0, move(2, 140, 180));
    await send(r, 1, move(1, 180, 180));
    await step(r, 1500);
    await send(r, 0, { kind: 'cooperate', operationId: 'lock-support', operationVersion: '0', phase: 'ready' });
    assert.equal((await send(r, 1, { kind: 'cooperate', operationId: 'lock-support', operationVersion: '0', phase: 'ready' })).result.status, 'locked');
    await send(r, 2, move(1, 560, 80));
    await step(r, 1000);
    const checkpoint = r.snapshots[2].projection.self.position;
    await runtime.locked(r.sessionId, { kind: 'test-obstacle', cause: { principalId: 'system', actionId: 'close-gate' } }, async (tx) => { const target = structuredClone(tx.state.targets.support); target.fields.find(f => f.key === 'open').value = false; target.resourceRevision = String(BigInt(target.resourceRevision) + 1n); tx.emit('spatial.target', { target }); });
    await step(r, 6000);
    assert.equal(r.snapshots[2].projection.movement.status, 'blocked');
    assert.deepEqual(r.snapshots[2].projection.self.position, checkpoint);
    await runtime.locked(r.sessionId, { kind: 'test-obstacle', cause: { principalId: 'system', actionId: 'open-gate' } }, async (tx) => { const target = structuredClone(tx.state.targets.support); target.fields.find(f => f.key === 'open').value = true; target.resourceRevision = String(BigInt(target.resourceRevision) + 1n); tx.emit('spatial.target', { target }); });
    await send(r, 2, move(2, 560, 80));
    await step(r, 6000);
    assert.equal((await send(r, 2, move(3, 100, 80, 'gray-road'))).status, 'Accepted');
    await step(r, 1000);
    assert.equal(r.snapshots[2].projection.self.sceneId, 'gray-road');
    assert.deepEqual(r.snapshots[2].projection.self.position, { x: 100, y: 80 });
    await refresh(r);
    const target = r.snapshots[0].projection.targets.find(t => t.name === '待固定支架');
    await send(r, 0, { ...move(3, 160, 200), targetRef: target.entityRef });
    await runtime.locked(r.sessionId, { kind: 'test-target', cause: { principalId: 'system', actionId: 'target-change' } }, async (tx) => { const changed = structuredClone(tx.state.targets.support); changed.resourceRevision = String(BigInt(changed.resourceRevision) + 1n); tx.emit('spatial.target', { target: changed }); });
    await step(r, 1000);
    assert.equal(r.snapshots[0].projection.movement.status, 'cancelled');
    assert.deepEqual(await runtime.replay(r.sessionId), await saved(r));
});
test('真实数据库：批次停在事务末尾，不把有效时间检查点或合作效果拆开；视图前缀不能越代读取', async () => {
    const r = await room(5), snapshot = r.snapshots[0];
    for (let tick = 1; tick <= 55; tick++) {
        for (let i = 0; i < 5; i++)
            await send(r, i, move(tick, 100 + i * 20 + (tick % 2 ? 20 : 0), 100));
        await step(r, 200);
    }
    const batch = await runtime.sync(r.connections[0], JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId: r.sessionId, viewId: snapshot.viewId, cursor: snapshot.snapshotSeq }));
    validateSpatial('BatchV2', batch);
    const savedBoundary = await database.pool.query('SELECT 1 FROM outbox WHERE session_id=$1 AND through_seq=$2', [r.sessionId, batch.throughSeq]);
    assert.equal(savedBoundary.rowCount, 1);
    const replay = await runtime.replay(r.sessionId, batch.throughSeq);
    assert.equal(batch.events.at(-1).payload.projection.sceneTimeMs, replay.sceneTimeMs);
    const newer = await runtime.subscribe(r.connections[0], r.sessionId);
    await assert.rejects(runtime.sync(r.connections[0], JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId: r.sessionId, viewId: newer.viewId, cursor: snapshot.snapshotSeq })), { code: 'RESYNC_REQUIRED' });
});
test('R-31-REQ-001：墙后观察者不获得初始合作入口、动态readyCount或anchors；recap版本分派先核验访问', async () => {
    const r = await room(3);
    await send(r, 2, move(1, 450, 200));
    await send(r, 0, move(1, 140, 180));
    await step(r, 6000);
    assert.deepEqual(r.snapshots[2].projection.targets, []);
    assert.deepEqual(r.snapshots[2].projection.cooperations, []);
    assert.equal((await send(r, 0, { kind: 'cooperate', operationId: 'lock-support', operationVersion: '0', phase: 'ready' })).status, 'Accepted');
    await refresh(r);
    assert.equal(r.snapshots[0].projection.cooperations[0].readyCount, 1);
    assert.deepEqual(r.snapshots[2].projection.cooperations, []);
    await send(r, 0, { kind: 'take_item', itemRef: item(r, 0).entityRef, expectedItemRevision: '0' });
    await send(r, 1, move(1, 180, 180));
    await step(r, 1500);
    await send(r, 0, { kind: 'cooperate', operationId: 'lock-support', operationVersion: '0', phase: 'ready' });
    assert.equal((await send(r, 1, { kind: 'cooperate', operationId: 'lock-support', operationVersion: '0', phase: 'ready' })).result.status, 'locked');
    for (const operationVersion of ['0', '1', '999']) {
        const hidden = await send(r, 2, { kind: 'cooperate', operationId: 'lock-support', operationVersion, phase: 'prepare' });
        assert.equal(hidden.code, 'TARGET_UNAVAILABLE');
        assert.deepEqual(hidden.result, {});
    }
    const outsider = await runtime.guest({ name: '不是本局成员' });
    await assert.rejects(runtime.recap('invalid-token', r.sessionId, {}), { code: 'UNAUTHENTICATED' });
    await assert.rejects(runtime.recap(outsider.token, r.sessionId, {}), { code: 'FORBIDDEN' });
    await assert.rejects(runtime.recap(r.users[0].token, r.sessionId, {}), { code: 'UPGRADE_REQUIRED' });
});
test('真实数据库：200ms快周期只发布空间outbox，旧region继续等待自身周期', async () => {
    const r = await room();
    const legacy = await runtime.create(r.users[0].token, { nonce: crypto.randomUUID(), contentVersion: 'trust-repair-fixture-v1' });
    const pending = async (id) => Number((await database.pool.query("SELECT count(*) FROM outbox WHERE session_id=$1 AND status='Pending'", [id])).rows[0].count);
    const before = await pending(legacy.sessionId);
    assert.ok(before > 0);
    assert.ok(await pending(r.sessionId) > 0);
    await runtime.publishPending(async () => { }, { capability: 'spatial-v2' });
    assert.equal(await pending(r.sessionId), 0);
    assert.equal(await pending(legacy.sessionId), before);
    await runtime.publishPending(async () => { });
    assert.equal(await pending(legacy.sessionId), 0);
});
