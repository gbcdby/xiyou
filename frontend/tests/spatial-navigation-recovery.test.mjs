import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialSessionClient } from '../src/network/spatial-session.ts';
import { spatialSnapshot, spatialBatch } from './spatial-fixture.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
const ref = letter => 'R' + letter.repeat(32);
const historicalId = ref('h'), approachId = ref('a');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const plan = (id, sequence, status, position) => ({ movementId: id, movementCommandSeq: sequence, planVersion: id === historicalId ? '5' : '6', sceneId: 'yard', mapVersion: 'gray-map-v1', goal: position, path: [{ x: 100, y: 100 }, position], acceptedAtSceneTime: 1000, status });

async function harness({ oldSequence = '5', atExit = false } = {}) {
    const initial = spatialSnapshot(), requests = [], receipts = new Map(), gate = deferred();
    initial.projection.self.canControl = false;
    initial.projection.self.position = atExit ? { x: 200, y: 100 } : { x: 100, y: 100 };
    initial.projection.movement = plan(historicalId, oldSequence, 'arrived', initial.projection.self.position);
    initial.projection.scene.anchors = [{ anchorId: 'exit-anchor', label: '公开出口', position: { x: 200, y: 100 } }];
    initial.projection.scene.exits = [{ exitId: 'to-road', anchorId: 'exit-anchor', destinationSceneId: 'road', destination: { x: 50, y: 80 }, open: true }];
    let handlers, first = true;
    const receipt = (request, status = 'Accepted') => ({ schemaVersion: 2, sessionId: request.sessionId, clientActionId: request.clientActionId, status, code: status === 'Accepted' ? 'OK' : 'PATH_UNREACHABLE', observedSeq: String(BigInt(client.state.snapshot?.snapshotSeq ?? '10') + 1n), actionEventRange: null, result: status === 'Accepted' && request.action.kind === 'move_to' ? { movementId: approachId, planVersion: '6', movementCommandSeq: request.action.movementCommandSeq, status: 'accepted' } : {} });
    const client = new SpatialSessionClient({ receipt: async (_sessionId, id) => receipts.get(id) ?? null }, (_token, next) => {
        handlers = next;
        return { connected: true, close() {}, async request(event, value) {
            const request = typeof value === 'string' ? JSON.parse(value) : value;
            requests.push({ event, raw: value, request });
            if (event === 'session.subscribe') return structuredClone(initial);
            if (event.startsWith('control.')) {
                const snapshot = structuredClone(initial); snapshot.viewId = 'recovered-view'; snapshot.projection.self.controlEpoch = '4'; snapshot.projection.self.canControl = true;
                return { schemaVersion: 2, sessionId: snapshot.sessionId, nonce: request.nonce, controlEpoch: '4', observedSeq: snapshot.snapshotSeq, snapshot };
            }
            if (event === 'sync.request') return { schemaVersion: 2, type: 'world.batch', sessionId: request.sessionId, viewId: request.viewId, fromExclusive: request.cursor, throughSeq: request.cursor, events: [] };
            let lost;
            if (first) { first = false; try { await gate.promise; } catch (error) { lost = error; } }
            const result = receipts.get(request.clientActionId) ?? receipt(request); receipts.set(request.clientActionId, result);
            if (lost) throw lost;
            return result;
        } };
    }, { heartbeatMs: 0, reconnectDelayMs: 0, waitForVisualArrival: true });
    const wires = () => requests.filter(r => r.event === 'player.action.request');
    const crossings = () => wires().filter(r => r.request.action.sceneId === 'road');
    const publish = async change => {
        const current = structuredClone(client.state.snapshot); change(current.projection);
        handlers.batch(spatialBatch(current, String(BigInt(current.snapshotSeq) + 1n))); await flush();
    };
    const arrive = (highWater = '1', status = 'arrived', id = approachId) => publish(p => {
        p.self.movementCommandHighWater = highWater; p.self.position = { x: 200, y: 100 };
        p.movement = plan(id, '1', status, p.self.position);
    });
    const visual = (movementId = approachId) => {
        const s = client.state.snapshot;
        client.confirmDisplayedArrival({ viewId: s.viewId, epoch: s.projection.self.controlEpoch, movementId, sequence: '1', position: s.projection.self.position });
    };
    client.open('spatial-room', 'token'); handlers.connected(); await flush(); await client.control('resume');
    return { client, requests, receipts, gate, wires, crossings, publish, arrive, visual, receipt, get handlers() { return handlers; } };
}

test('NAV-01：恢复后旧较大或同号计划不取消新出口，也不触发第二段', async t => {
    for (const oldSequence of ['5', '1']) await t.test('历史序号 ' + oldSequence, async () => {
        const h = await harness({ oldSequence }), sending = h.client.traverseExit('to-road');
        try {
            await h.publish(() => {});
            assert.ok(h.client.state.queuedAction, '普通批次的旧计划必须保留当前出口选择');
            await h.publish(p => { p.movement.movementId = ref('z'); });
            assert.equal(h.crossings().length, 0, '不同历史ID也不能在当前epoch水位0时冒充本次移动');
            assert.ok(h.client.state.queuedAction);
            h.gate.resolve(); await sending;
            assert.equal(h.crossings().length, 0, 'Accepted本身不是权威到达');
            await h.arrive();
            assert.equal(h.crossings().length, 0, '权威到达仍须等本次真实显示确认');
            h.visual(); await flush();
            assert.equal(h.crossings().length, 1);
            const [approach, crossing] = h.wires();
            assert.equal(approach.request.controlEpoch, '4'); assert.equal(approach.request.action.movementCommandSeq, '1');
            assert.equal(crossing.request.controlEpoch, '4'); assert.equal(crossing.request.action.movementCommandSeq, '2');
            await h.arrive(); h.visual(); await h.client.query(approach.request.clientActionId); await flush();
            assert.equal(h.crossings().length, 1, '重复批次、回调和原Receipt不能再发第二段');
        } finally { h.gate.resolve(); await sending; h.client.close(); }
    });
});

test('NAV-01/03：同坐标旧同号视觉回调必须带原movementId，新计划不能借旧确认跨出', async () => {
    const h = await harness({ oldSequence: '1', atExit: true }), sending = h.client.traverseExit('to-road');
    try {
        h.visual(historicalId);
        h.gate.resolve(); await sending; await h.arrive();
        assert.equal(h.crossings().length, 0);
        h.visual(historicalId); await flush();
        assert.equal(h.crossings().length, 0, '迟到的旧事件即使seq和脚点均相同也不能贴上当前ID');
        h.visual(); await flush(); assert.equal(h.crossings().length, 1);
    } finally { h.gate.resolve(); await sending; h.client.close(); }
});

test('NAV-03：首段ACK未知时只等待原Receipt，查询或原串重试只释放一次第二段', async t => {
    for (const recovery of ['query', 'retry']) await t.test(recovery, async () => {
        const h = await harness(), sending = h.client.traverseExit('to-road');
        h.gate.reject(new Error('原首段已提交，ACK丢失')); await sending;
        const first = h.wires()[0], id = first.request.clientActionId;
        try {
            await h.arrive(); h.visual(); await flush();
            assert.equal(h.crossings().length, 0, '未确定原首段结果时不猜当前计划归属');
            assert.equal(h.client.state.actions.find(a => a.id === id).status, 'unknown');
            await h.client[recovery](id); await flush();
            assert.equal(h.crossings().length, 1);
            if (recovery === 'retry') assert.equal(h.wires()[1].raw, first.raw, '原请求ID/view/ref/epoch/seq/baseSeq逐字不变');
            await h.client.query(id); await h.arrive(); h.visual(); await flush();
            assert.equal(h.crossings().length, 1);
        } finally { h.client.close(); }
    });
});

test('NAV-02：同epoch停止、换目标、明确取消或较新处理水位仍撤销原后续', async t => {
    const cancellations = {
        '停止': h => h.client.stop(),
        '换目标': h => h.client.move({ x: 300, y: 100 }),
        '明确取消': h => h.client.cancelQueued(),
        '较新停止或拒绝水位': h => h.publish(p => { p.self.movementCommandHighWater = '3'; }),
    };
    for (const [label, cancel] of Object.entries(cancellations)) await t.test(label, async () => {
        const h = await harness(), sending = h.client.traverseExit('to-road');
        try {
            await cancel(h); assert.equal(h.client.state.queuedAction, null);
            h.gate.resolve(); await sending; await h.arrive('3'); h.visual(); await flush();
            assert.equal(h.crossings().length, 0);
        } finally { h.gate.resolve(); await sending; h.client.close(); }
    });
});

test('NAV-04：连接、view/ref、epoch、地图和终态失效后迟到首段不能复活', async t => {
    const invalidations = {
        '断线': h => h.handlers.disconnected(),
        'view重建': h => h.client.reconnect(),
        'ref失效': h => h.publish(p => { p.self.entityRef = ref('r'); }),
        'epoch变化': h => h.publish(p => { p.self.controlEpoch = '6'; }),
        '地图变化': h => h.publish(p => { p.mapVersion = 'another-map'; }),
        '终态': h => h.publish(p => { p.phase = 'Finished'; p.self.canControl = false; }),
    };
    for (const [label, invalidate] of Object.entries(invalidations)) await t.test(label, async () => {
        const h = await harness(), sending = h.client.traverseExit('to-road');
        try {
            await invalidate(h); h.gate.resolve(); await sending; await flush();
            assert.equal(h.client.state.queuedAction, null); assert.equal(h.crossings().length, 0);
        } finally { h.gate.resolve(); await sending; h.client.close(); }
    });
});

test('NAV-05：首段拒绝、blocked或cancelled不产生第二段', async t => {
    for (const status of ['Rejected', 'blocked', 'cancelled']) await t.test(status, async () => {
        const h = await harness(), sending = h.client.traverseExit('to-road');
        try {
            if (status === 'Rejected') {
                h.gate.reject(new Error('先保留原请求以查询确定拒绝')); await sending;
                const first = h.wires()[0]; h.receipts.set(first.request.clientActionId, h.receipt(first.request, 'Rejected'));
                await h.client.query(first.request.clientActionId);
            } else { h.gate.resolve(); await sending; await h.arrive('1', status); }
            assert.equal(h.client.state.queuedAction, null); assert.equal(h.crossings().length, 0);
        } finally { h.gate.resolve(); await sending; h.client.close(); }
    });
});
