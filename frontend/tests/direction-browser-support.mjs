import assert from 'node:assert/strict';
import { validateSpatial } from '../../protocol/spatial.mjs';
import { decodeJsonbText } from '../../backend/jsonb-text.mjs';

const requiredCapabilities = ['spatial-direction-v1', 'spatial-timed-trail-v1'];

/** 仅记录真实 openConnection 成功后的受信能力；不更改握手、请求或安装流程。 */
export function observeDirectionConnections(runtime) {
  const original = runtime.openConnection, handles = [];
  async function observed(...args) {
    const handle = await Reflect.apply(original, this, args);
    handles.push(handle);
    return handle;
  }
  runtime.openConnection = observed;
  return {
    async qualify(page, userId, label) {
      assert.equal(runtime.spatialDirection?.checkpointMs, 50, '当前实际服务采用正式50ms配置');
      const state = await page.evaluate(async () => {
        const state = (await import('/src/state/spatial-store.ts')).spatialState.value;
        return { connection: state.connection, inputReady: state.inputReady, timedTrail: state.timedTrail, snapshot: state.snapshot };
      });
      assert.equal(state.connection, 'online'); assert.equal(state.inputReady, true);
      // timedTrail仅由本次成功握手的acceptedCapabilities产生；单次旧服回退不会得到此值。
      assert.equal(state.timedTrail, true, '旧模式兼容回退不能计作本次新模式验收');
      validateSpatial('SnapshotV2', state.snapshot);
      const snapshot = state.snapshot;
      const matching = handles.flatMap(handle => {
        const view = runtime.connectionView(handle);
        if (!view?.active || view.sessionId !== snapshot.sessionId || view.viewId !== snapshot.viewId || view.userId !== userId) return [];
        const connection = runtime.connection(handle);
        return [{ handle, view, connection }];
      });
      assert.equal(matching.length, 1, '页面必须对应唯一当前已安装的真实连接视图');
      const { handle, view, connection } = matching[0];
      assert.equal(runtime.pendingViewInstallation(handle, snapshot.sessionId), false);
      assert.equal(view.ownedEpoch, snapshot.projection.self.controlEpoch);
      assert.equal(view.schemaVersion, 2);
      for (const capability of requiredCapabilities) assert.ok(connection.capabilities.includes(capability), '服务端必须实际接受 ' + capability);
      return { label, sessionId: snapshot.sessionId, viewId: snapshot.viewId, controlEpoch: view.ownedEpoch,
        connectionId: handle.connectionId, checkpointMs: runtime.spatialDirection.checkpointMs,
        acceptedCapabilities: [...connection.capabilities], inputReady: state.inputReady, timedTrail: state.timedTrail };
    },
    close() { if (runtime.openConnection === observed) runtime.openConnection = original; },
  };
}

/** 安装时页面尚未进入SpatialMap；只观察实际调用，不补画或创建信用。 */
export async function installPresentationObservation(page) {
  assert.equal(await page.getByTestId('spatial-map').count(), 0, '呈现观察器必须早于地图挂载');
  await page.evaluate(async () => {
    const { ConfirmedMotion } = await import('/src/domain/spatial-motion.ts');
    const { SpatialCanvas } = await import('/src/rendering/spatial-canvas.ts');
    const { CanvasPresentationOwner } = await import('/src/rendering/spatial-presentation.ts');
    const { observePresentation } = await import('/tests/presentation-observer.mjs');
    const { spatialSnapshots } = await import('/src/state/spatial-store.ts');
    const observer = observePresentation({ ConfirmedMotion, SpatialCanvas, CanvasPresentationOwner }, {
      phase: () => window.uxCapture?.phase ?? 'before-capture',
    });
    const subscription = spatialSnapshots.subscribe(snapshot => observer.snapshot(snapshot), error => observer.error(error));
    window.uxPresentation = {
      read: () => observer.read(),
      stop() { subscription.close(); observer.stop(); return observer.read(); },
    };
  });
}

export function assertPresentationEvidence(evidence) {
  assert.ok(evidence); assert.equal(evidence.dropped, 0, '呈现原件不能被限量截断'); assert.deepEqual(evidence.errors, []);
  const byCall = new Map(evidence.calls.map(row => [row.call, row]));
  const paints = evidence.calls.filter(row => row.kind === 'canvas.paint' && row.frame);
  assert.ok(paints.length > 0); assert.ok(paints.every(row => row.startedAt >= evidence.installedAt));
  const accepted = evidence.calls.filter(row => row.kind === 'motion.presentSelf' && row.returned === true);
  assert.ok(accepted.length > 0, '必须观察到真实可见静止paint建立的呈现资格');
  for (const row of accepted) {
    const owner = byCall.get(row.parent);
    assert.equal(owner?.kind, 'owner.painted'); assert.equal(owner.allowed, true); assert.equal(owner.returned, true);
    assert.equal(row.proof.serial, owner.serial); assert.equal(row.proof.sampledAt, owner.sampledAt); assert.equal(row.proof.presentedAt, owner.presentedAt);
    const paint = paints.find(paint => paint.frame.instance === owner.instance && paint.frame.serial === owner.serial
      && paint.finishedAt <= owner.startedAt && paint.snapshotSeq === owner.snapshotSeq);
    assert.ok(paint, '信用必须可追溯到同一真实成功paint');
    assert.equal(row.proof.reference, owner.entityRef); assert.equal(row.proof.renderer.endsWith(':' + owner.instance), true);
    assert.equal(row.proof.sampledAt, paint.sampledAt); assert.deepEqual(row.proof.position, paint.frame.self.position);
    assert.equal(row.proof.distance, paint.frame.self.distance); assert.equal(row.proof.moving, false); assert.equal(paint.frame.self.moving, false);
  }
  return { successfulPaints: paints.length, acceptedPresentations: accepted.length,
    earned: evidence.calls.filter(row => row.kind === 'motion.sealPresentation' && row.creditAfter > row.creditBefore).length,
    updateBalanceDecreases: evidence.calls.filter(row => row.kind === 'motion.update' && row.creditBefore > row.creditAfter).length,
    sourceUpdates: evidence.calls.filter(row => row.kind === 'source.accept' && row.snapshotSeq).length };
}

/** 在短按结束后只读已提交Receipt/event，不为取证增加运动热路径锁读。 */
export async function assertShortDirectionPlan(pool, drafts, { sessionId, before, clientStart, clientEnd, after }) {
  const requests = drafts.map(draft => JSON.parse(draft.raw));
  assert.deepEqual(requests.map(request => request.action.kind), ['move_direction', 'stop_move']);
  assert.equal(requests[0].action.direction, 'E');
  assert.equal(requests[0].sessionId, sessionId); assert.equal(requests[1].sessionId, sessionId);
  assert.equal(requests[0].controlEpoch, before.controlEpoch); assert.equal(requests[1].controlEpoch, before.controlEpoch);
  assert.equal(requests[0].action.sceneId, before.sceneId); assert.equal(requests[0].action.mapVersion, before.mapVersion);
  assert.ok(BigInt(requests[1].action.movementCommandSeq) > BigInt(requests[0].action.movementCommandSeq));
  assert.deepEqual(clientStart, before.position, '短按前的客户端权威点须等于实际静止点');
  assert.ok(!['accepted', 'moving'].includes(before.movementStatus));
  const receipts = [];
  for (const [index, request] of requests.entries()) {
    validateSpatial('PublicEnvelope', request);
    const rows = (await pool.query('SELECT actor_id,receipt FROM action_receipts WHERE session_id=$1 AND client_action_id=$2', [sessionId, request.clientActionId])).rows;
    assert.equal(rows.length, 1); const stored = rows[0];
    assert.equal(stored.actor_id, before.actorId); assert.deepEqual(stored.receipt.publicReceipt, drafts[index].receipt);
    assert.equal(stored.receipt.publicReceipt.status, 'Accepted');
    receipts.push(stored.receipt.publicReceipt);
  }
  const range = receipts[0].actionEventRange; assert.ok(range);
  const events = (await pool.query('SELECT event,event_text_encoding FROM world_events WHERE session_id=$1 AND session_seq>=$2 AND session_seq<=$3 ORDER BY session_seq', [sessionId, range.first, range.last])).rows.map(row => decodeJsonbText(row.event, row.event_text_encoding));
  const accepted = events.filter(event => event.kind === 'spatial.actor' && event.payload.actor.characterId === before.actorId
    && event.payload.actor.movement?.movementId === receipts[0].result.movementId && event.payload.actor.movement.status === 'accepted');
  assert.equal(accepted.length, 1); const plan = accepted[0].payload.actor.movement, origin = plan.path[0];
  assert.equal(plan.movementCommandSeq, requests[0].action.movementCommandSeq); assert.equal(plan.controlEpoch, requests[0].controlEpoch);
  assert.deepEqual(origin, before.position); assert.equal(after.controlEpoch, before.controlEpoch);
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const pathDistance = plan.path.slice(1).reduce((sum, point, index) => sum + distance(plan.path[index], point), 0);
  assert.ok(pathDistance <= 36, '实际Accepted短段路径仍至多36');
  assert.ok(distance(clientStart, clientEnd) <= 36, '原客户端权威位移门槛保持');
  assert.ok(distance(origin, after.position) <= 36 && distance(before.position, after.position) <= 36, '实际起点与最终权威位移仍至多36');
  return { requests, receipts, before, clientStart, clientEnd, origin, path: plan.path, pathDistance, after, acceptedEventSeq: accepted[0].sessionSeq };
}
