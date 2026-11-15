import assert from 'node:assert/strict';
import { validateSpatial } from '../../protocol/spatial.mjs';
import { decodeJsonbText } from '../../backend/jsonb-text.mjs';
import { canonicalize } from '../../protocol/index.mjs';
import { createHash } from 'node:crypto';
import { entityRef } from '../../game/spatial-world.mjs';

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

/** 只选冻结窗口的第一条SE，不按Accepted挑下一条；仅扣住原submit已经返回的ACK。 */
export function observeDirectionSubmissions(runtime, { late = false, now = Date.now, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const original = runtime.submit, submissions = [], sends = [], errors = [], restorers = [];
  let diagonalAt = null, downAt = null, startedAt = null, selected = null;
  async function observed(...args) {
    const request = JSON.parse(args[1]), row = { enteredAt: now(), raw: args[1], request };
    submissions.push(row);
    if (late && !selected && diagonalAt !== null && downAt === null && row.enteredAt >= diagonalAt + 180
      && request.action.kind === 'move_direction' && request.action.direction === 'SE') selected = row;
    const receipt = await Reflect.apply(original, this, args); row.submitReturnedAt = now(); row.receipt = structuredClone(receipt);
    if (row === selected) {
      // 定时器可能提前唤醒；仅补足同一个固定180ms截止，不等下一动作或扩展观察窗。
      const deadline = row.submitReturnedAt + 180;
      do { await delay(Math.max(0, deadline - now())); } while (now() < deadline);
    }
    row.ackReleasedAt = now(); return receipt;
  }
  runtime.submit = observed;
  restorers.push(() => { if (runtime.submit === observed) runtime.submit = original; });
  for (const [name, origin] of [['sync', 'sync'], ['publish', 'push']]) {
    const original = runtime.spatialSupply[name];
    function wrapped(...args) {
      const send = args[2], forwarded = [...args], delivered = [];
      forwarded[2] = function (...values) {
        const batch = values[0], binding = values[1], row = { at: now(), origin, viewId: batch?.viewId, fromExclusive: batch?.fromExclusive, throughSeq: batch?.throughSeq, eventCount: batch?.events?.length ?? 0, sent: false };
        const result = Reflect.apply(send, this, values); row.returnedProof = !!result && typeof result === 'object';
        delivered.push({ row, binding }); sends.push(row); return result;
      };
      const result = Reflect.apply(original, this, forwarded);
      // 仅在原供给方法成功消费真实入队证明并推进可信水位后记录发送成功；不消费/伪造证明。
      void result.then(() => { try { for (const { row, binding } of delivered) {
        const cursor = runtime.spatialSupply.cursor(binding);
        row.sent = row.returnedProof && cursor !== null && BigInt(cursor) >= BigInt(row.throughSeq);
      } } catch (error) { errors.push(String(error?.message ?? error)); } }, () => {});
      return result;
    }
    runtime.spatialSupply[name] = wrapped;
    restorers.push(() => { if (runtime.spatialSupply[name] === wrapped) runtime.spatialSupply[name] = original; });
  }
  return { mark(phase) { if (phase === 'right') startedAt = now(); if (phase === 'diagonal') diagonalAt = now(); if (phase === 'down-only') downAt = now(); },
    read() { return { startedAt, diagonalAt, downAt, selected, submissions, sends, errors, delayMs: late ? 180 : 0 }; },
    close() { for (const restore of restorers.reverse()) restore(); } };
}

export async function installDirectionObservation(page) {
  assert.equal(await page.getByTestId('spatial-map').count(), 0);
  await page.evaluate(async () => {
    const { SpatialView } = await import('/src/domain/spatial-view.ts');
    const { spatialState } = await import('/src/state/spatial-store.ts');
    const { observeDirectionClient } = await import('/tests/direction-observer.mjs');
    window.uxDirection = observeDirectionClient({ SpatialView, spatialState }, { phase: () => window.uxCapture?.phase ?? null });
  });
}

/** 在运动前解析各读者当前授权别名；不把真实角色ID用于页面输入。 */
export async function beginDirectionObservations(runtime, room) {
  const state = await runtime.replay(room.sessionId), mover = state.members.find(member => member.userId === room.users[0].userId).characterId;
  for (const [index, page] of room.pages.entries()) {
    const actorId = state.members.find(member => member.userId === room.users[index].userId).characterId;
    const reference = entityRef(state.views[actorId], mover); assert.ok(reference);
    await page.evaluate(reference => window.uxDirection.begin(reference), reference);
  }
}

export function assertAcceptedLateEvidence(evidence) {
  const { selected, diagonalAt, downAt, stored, plan, client, submissions, movementRequests } = evidence;
  assert.ok(selected, '冻结窗口未取得SE样本，不能挑下一条或算PASS'); assert.equal(evidence.delayMs, 180);
  assert.ok(selected.enteredAt >= diagonalAt + 180 && selected.enteredAt < downAt);
  assert.equal(selected.request.action.kind, 'move_direction'); assert.equal(selected.request.action.direction, 'SE');
  assert.equal(selected.receipt.status, 'Accepted'); assert.ok(selected.submitReturnedAt < downAt);
  assert.ok(selected.ackReleasedAt - selected.submitReturnedAt >= 180);
  assert.equal(stored.length, 1); assert.deepEqual(stored[0].receipt.publicReceipt, selected.receipt);
  assert.equal(stored[0].semantic_digest, createHash('sha256').update(canonicalize(selected.request)).digest('hex'));
  assert.equal(selected.raw, canonicalize(selected.request)); assert.ok(plan); assert.equal(plan.movementId, selected.receipt.result.movementId);
  assert.equal(plan.movementCommandSeq, selected.request.action.movementCommandSeq); assert.equal(plan.controlEpoch, selected.request.controlEpoch);
  assert.ok(plan.path[0].x !== plan.path.at(-1).x && plan.path[0].y !== plan.path.at(-1).y, '必须为真实权威双轴Accepted路径');
  assert.deepEqual(client.errors, []); assert.equal(client.dropped, 0); assert.ok(client.maxPendingDirections <= 2 && client.maxPendingStops <= 1);
  assert.equal(client.initial.viewId, selected.request.viewId); assert.equal(client.initial.controlEpoch, selected.request.controlEpoch);
  const down = client.inputs.find(row => row.type === 'keyup' && row.key === 'ArrowRight' && row.phase === 'down-only'); assert.ok(down);
  assert.equal(down.viewId, selected.request.viewId); assert.equal(down.epoch, selected.request.controlEpoch);
  const pending = down.actions.find(row => row.id === selected.request.clientActionId); assert.ok(pending && ['waiting', 'unknown'].includes(pending.status) && !pending.receipt, 'DOWN时原请求不能已被历史查询收束');
  const ack = client.acknowledgements.find(row => row.id === selected.request.clientActionId), applied = client.states.find(row => row.id === selected.request.clientActionId && row.receipt);
  assert.ok(ack && applied); assert.deepEqual(ack.receipt, selected.receipt); assert.deepEqual(applied.receipt, selected.receipt);
  assert.equal(applied.viewId, selected.request.viewId); assert.equal(applied.controlEpoch, selected.request.controlEpoch);
  assert.ok(ack.wallAt > down.wallAt && applied.wallAt >= ack.wallAt);
  assert.ok(!client.states.some(row => row.id === selected.request.clientActionId && row.receipt && row.wallAt <= down.wallAt));
  const south = client.requests.find(row => row.action?.kind === 'move_direction' && row.action.direction === 'S' && row.wallAt >= down.wallAt);
  assert.ok(south && south.wallAt < ack.wallAt);
  const acceptedSouth = submissions.find(row => row.request.clientActionId === south.id);
  assert.equal(acceptedSouth?.receipt.status, 'Accepted'); assert.ok(acceptedSouth.submitReturnedAt < ack.wallAt, '新S须在旧ACK客户端收到前实际Accepted');
  assert.ok(!client.requests.some(row => row.action?.kind === 'move_direction' && row.action.direction === 'SE' && row.wallAt >= down.wallAt), '迟到ACK不得复活SE');
  const stop = movementRequests.at(-1); assert.equal(stop.action.kind, 'stop_move');
  const actualRequests = client.requests.filter(row => ['move_direction', 'stop_move'].includes(row.action?.kind));
  assert.deepEqual(actualRequests.map(row => row.id), movementRequests.map(request => request.clientActionId), '原账本须覆盖所有实际发送，不能遗漏更高seq');
  assert.ok(movementRequests.slice(0, -1).every(request => BigInt(request.action.movementCommandSeq) < BigInt(stop.action.movementCommandSeq)));
  assert.equal(submissions.find(row => row.request.clientActionId === stop.clientActionId)?.receipt.status, 'Accepted');
  return { qualified: true, selectedId: selected.request.clientActionId, down, ack, applied, south, acceptedSouth, stop, heldMs: selected.ackReleasedAt - selected.submitReturnedAt };
}

export async function collectAcceptedLateEvidence(pool, observer, client, movementRequests) {
  const timing = observer.read(), selected = timing.selected;
  if (!selected) return { ...timing, stored: [], plan: null, client, movementRequests };
  const request = selected.request;
  const stored = (await pool.query('SELECT actor_id,semantic_digest,receipt FROM action_receipts WHERE session_id=$1 AND client_action_id=$2', [request.sessionId, request.clientActionId])).rows;
  const range = selected.receipt.actionEventRange;
  const events = range ? (await pool.query('SELECT event,event_text_encoding FROM world_events WHERE session_id=$1 AND session_seq>=$2 AND session_seq<=$3 ORDER BY session_seq', [request.sessionId, range.first, range.last])).rows.map(row => decodeJsonbText(row.event, row.event_text_encoding)) : [];
  const plans = events.filter(event => event.kind === 'spatial.actor' && event.payload.actor.characterId === stored[0]?.actor_id
    && event.payload.actor.movement?.movementId === selected.receipt.result?.movementId && event.payload.actor.movement.status === 'accepted');
  return { ...timing, stored, acceptedEventSeq: plans[0]?.sessionSeq, plan: plans.length === 1 ? plans[0].payload.actor.movement : null, client, movementRequests };
}

export function assertFivePersonSupply({ readers, sends, stop, finalPosition }) {
  assert.equal(readers.length, 5); assert.equal(new Set(readers.map(reader => reader.initial.viewId)).size, 5); assert.equal(stop.status, 'Accepted');
  const summaries = readers.map(reader => {
    assert.deepEqual(reader.errors, []); assert.equal(reader.dropped, 0);
    const rows = reader.applications.filter(row => row.result === 'applied'); assert.ok(rows.length >= 2, '每个真实读者必须连续应用，不得只有连接或终点快照');
    let cursor = reader.initial.snapshotSeq;
    for (const row of rows) {
      assert.equal(row.viewId, reader.initial.viewId); assert.equal(row.epoch, reader.initial.controlEpoch);
      assert.equal(row.before, cursor); assert.equal(row.fromExclusive, cursor); assert.equal(row.after, row.throughSeq); assert.ok(BigInt(row.after) > BigInt(cursor)); cursor = row.after;
      assert.ok(['sync', 'push'].includes(row.origin));
      assert.ok(sends.some(send => send.sent && send.origin === row.origin && send.viewId === row.viewId && send.fromExclusive === row.fromExclusive && send.throughSeq === row.throughSeq), '客户端实际应用须关联成功服务端发送');
    }
    const moving = rows.filter(row => row.eventCount > 0 && row.person?.moving && row.person.motionTrail?.some(point => point.x !== row.person.motionTrail[0].x || point.y !== row.person.motionTrail[0].y));
    assert.ok(moving.length > 0, '每个读者必须实际应用主运动者的已执行移动轨迹');
    const stopped = rows.find(row => BigInt(row.after) >= BigInt(stop.observedSeq) && row.person?.moving === false
      && row.person.position.x === finalPosition.x && row.person.position.y === finalPosition.y); assert.ok(stopped, '每个读者必须实际应用终止前缀');
    return { viewId: reader.initial.viewId, initialCursor: reader.initial.snapshotSeq, finalCursor: cursor, applications: rows.length,
      push: rows.filter(row => row.origin === 'push').length, sync: rows.filter(row => row.origin === 'sync').length, motionApplications: moving.length, stoppedAt: stopped.after };
  });
  return { readers: summaries, scope: '一名运动者向五个真实当前读者供给；不代表五人同时全速输入' };
}
