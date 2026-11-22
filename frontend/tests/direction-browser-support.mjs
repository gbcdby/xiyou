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

/** 按预定阶段冻结原身份；只安排测试传输，原submit、Receipt与独立stop不被替代。 */
export function observeDirectionSubmissions(runtime, { late = false, now = Date.now, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  assert.ok([false, 'free-slot', 'full-slots'].includes(late), 'late必须预先固定为空槽或满槽');
  const original = runtime.submit, submissions = [], sends = [], errors = [], restorers = [];
  const gates = new WeakMap(), cleanup = Promise.withResolvers();
  let phase = null, binding = null, closed = false, diagonalAt = null, downAt = null, startedAt = null, selected = null;
  let preludeRightAt = null, preludeStopAt = null, preludeDirection = null, preludeStop = null, second = null;
  const sameBinding = request => binding && ['sessionId', 'viewId', 'controlEpoch'].every(key => request[key] === binding[key]);
  const signal = () => ({ done: false, ...Promise.withResolvers() });
  const complete = value => { value.done = true; value.resolve(); };
  const fail = message => { errors.push(message); };
  async function holdUntil(deadline, label) {
    while (now() < deadline && !closed) await Promise.race([delay(deadline - now()), cleanup.promise]);
    if (closed && now() < deadline) fail('cleanup提前解除测试扣留：' + label);
  }
  async function waitFor(row, field, label) {
    if (!row) { fail('缺少预定前驱：' + label); return false; }
    const gate = gates.get(row)[field]; if (gate.done) return true;
    let finished = false;
    const deadline = row.enteredAt + 400;
    const timeout = async () => {
      while (!finished && !closed && now() < deadline) await delay(deadline - now());
      return 'timeout';
    };
    const result = await Promise.race([gate.promise.then(() => 'ready'), cleanup.promise.then(() => 'cleanup'), timeout()]);
    finished = true;
    if (result !== 'ready') fail(`${label}：${result === 'cleanup' ? 'cleanup解除等待' : '前驱入站400ms上界已到'}`);
    return result === 'ready';
  }
  async function observed(...args) {
    const request = JSON.parse(args[1]), row = { enteredAt: now(), raw: args[1], request };
    submissions.push(row); const gate = { service: signal(), released: signal() }; gates.set(row, gate);
    const bound = late && sameBinding(request), direction = request.action.kind === 'move_direction';
    // Node的20ms输入阶段可以先结束；首E仍按已声明的原身份冻结，不要求网络在20ms内到达。
    if (bound && preludeRightAt !== null && !preludeDirection && direction && request.action.direction === 'E') preludeDirection = row;
    if (bound && phase === 'prelude-stop' && !preludeStop && request.action.kind === 'stop_move') preludeStop = row;
    if (bound && phase === 'diagonal' && downAt === null && direction && request.action.direction === 'SE') {
      if (!selected) selected = row;
      else if (late === 'full-slots' && !second) second = row;
    }
    if (row === preludeStop) await waitFor(preludeDirection, 'service', '前奏E→stop');
    else if (bound && selected && row !== selected && direction) await waitFor(selected, 'service', 'A→后继方向');
    try {
      row.submitStartedAt = now();
      const receipt = await Reflect.apply(original, this, args); row.submitReturnedAt = now(); row.receipt = structuredClone(receipt);
      complete(gate.service);
      if (row === preludeStop || row === selected) {
        row.ackDeadlineAt = row.submitReturnedAt + (row === preludeStop ? 200 : 180);
        await holdUntil(row.ackDeadlineAt, request.clientActionId);
      } else if (row === second) {
        const released = await waitFor(selected, 'released', 'A原ACK→B原ACK');
        if (released && Number.isFinite(selected.ackReleasedAt)) {
          row.ackDeadlineAt = Math.max(row.submitReturnedAt, selected.ackReleasedAt + 50);
          await holdUntil(row.ackDeadlineAt, request.clientActionId);
        } else if (released) fail('A原调用失败，不能取得ACK释放时刻');
      }
      row.ackReleasedAt = now(); return receipt;
    } catch (error) {
      fail('原submit异常：' + request.clientActionId + '：' + String(error?.message ?? error)); throw error;
    } finally {
      complete(gate.service); complete(gate.released);
    }
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
  return {
    armLate(value) {
      assert.ok(late && !binding, 'late绑定只能在场景开始时声明一次');
      assert.ok(['sessionId', 'viewId', 'controlEpoch'].every(key => typeof value?.[key] === 'string' && value[key].length), 'late绑定必须完整');
      binding = Object.freeze(Object.fromEntries(['sessionId', 'viewId', 'controlEpoch'].map(key => [key, value[key]])));
    },
    mark(value) {
      phase = value;
      if (value === 'right' || value === 'prelude-right') startedAt = now();
      if (value === 'prelude-right') preludeRightAt = now(); if (value === 'prelude-stop') preludeStopAt = now();
      if (value === 'diagonal') diagonalAt = now(); if (value === 'down-only') downAt = now();
    },
    read() { return { startedAt, diagonalAt, downAt, selected, submissions, sends, errors, delayMs: late ? 180 : 0,
      lateMode: late, binding, preludeRightAt, preludeStopAt, preludeDirection, preludeStop, second }; },
    close() { closed = true; cleanup.resolve(); for (const restore of restorers.reverse()) restore(); }
  };
}

export async function installDirectionObservation(page) {
  assert.equal(await page.getByTestId('spatial-map').count(), 0);
  await page.evaluate(async () => {
    const { SpatialView } = await import('/src/domain/spatial-view.ts');
    const { spatialState } = await import('/src/state/spatial-store.ts');
    const { observeDirectionClient } = await import('/tests/direction-observer.mjs');
    // 挂载地图前先在 window capture 记输入，避免生产 keyup 同步发送先于 document 观察。
    window.uxDirection = observeDirectionClient({ SpatialView, spatialState, inputTarget: window }, { phase: () => window.uxCapture?.phase ?? null });
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
  const { lateMode, binding, preludeDirection: prelude, preludeStop, selected, second, diagonalAt, downAt, client, submissions, movementRequests } = evidence;
  assert.ok(['free-slot', 'full-slots'].includes(lateMode), '场景必须在输入前固定为空槽或满槽');
  const full = lateMode === 'full-slots';
  assert.deepEqual(evidence.errors, [], '测试传输等待失败不能计为合格样本');
  assert.equal(evidence.delayMs, 180); assert.ok(binding && prelude && preludeStop && selected);
  assert.equal(Boolean(second), full, '不得按结果更换空槽/满槽前提');
  const original = (row, label) => {
    assert.ok(row, label + '缺少原请求');
    validateSpatial('PublicEnvelope', row.request); validateSpatial('ReceiptV2', row.receipt);
    assert.equal(row.raw, canonicalize(row.request), label + '保留精确原串');
    for (const key of ['sessionId', 'viewId', 'controlEpoch']) assert.equal(row.request[key], binding[key], label + '保留原绑定');
    assert.equal(row.request.actorRef, prelude.request.actorRef);
    assert.equal(row.receipt.sessionId, row.request.sessionId); assert.equal(row.receipt.clientActionId, row.request.clientActionId);
    assert.equal(row.receipt.status, 'Accepted', label + '必须真实Accepted，不能挑另一条');
    assert.equal(row.receipt.result.movementCommandSeq, row.request.action.movementCommandSeq);
    return row.request.clientActionId;
  };
  const pId = original(prelude, '前奏E'), rId = original(preludeStop, '前置stop'), aId = original(selected, 'A');
  assert.equal(prelude.request.action.direction, 'E'); assert.equal(prelude.request.action.kind, 'move_direction');
  assert.equal(preludeStop.request.action.kind, 'stop_move');
  assert.ok(prelude.enteredAt >= evidence.preludeRightAt && prelude.enteredAt <= preludeStop.enteredAt);
  assert.ok(preludeStop.enteredAt >= evidence.preludeStopAt && preludeStop.enteredAt <= diagonalAt);
  assert.ok(preludeStop.submitStartedAt >= prelude.submitReturnedAt, '前置stop只在原E提交收束后进入');
  assert.equal(preludeStop.ackDeadlineAt, preludeStop.submitReturnedAt + 200);
  assert.ok(preludeStop.ackReleasedAt >= preludeStop.ackDeadlineAt);

  assert.deepEqual(client.errors, []); assert.equal(client.dropped, 0);
  assert.ok(client.maxPendingDirections <= 2 && client.maxPendingStops <= 1);
  for (const key of ['sessionId', 'viewId', 'controlEpoch']) assert.equal(client.initial[key], binding[key]);
  const actualRequests = client.requests.filter(row => ['move_direction', 'stop_move'].includes(row.action?.kind));
  assert.deepEqual(actualRequests.map(row => row.id), movementRequests.map(request => request.clientActionId), '原账本须覆盖全部实际发送，包括前奏');
  assert.equal(new Set(actualRequests.map(row => row.id)).size, actualRequests.length, '资格场景不能用重试或重复身份替换原发送');
  for (const [index, sent] of actualRequests.entries()) {
    assert.ok(Number.isFinite(sent.at)); assert.deepEqual(sent.request, movementRequests[index]);
    for (const key of ['sessionId', 'viewId', 'controlEpoch']) assert.equal(sent.request[key], binding[key]);
  }
  const sent = id => {
    const matches = actualRequests.filter(row => row.id === id); assert.equal(matches.length, 1); return matches[0];
  };
  const confirmed = row => {
    const id = row.request.clientActionId, request = sent(id);
    assert.deepEqual(request.request, row.request, '客户端实际发送必须对应服务端同一精确原请求');
    const acknowledgements = client.acknowledgements.filter(value => value.id === id); assert.equal(acknowledgements.length, 1);
    const ack = acknowledgements[0], applied = client.states.find(value => value.id === id && value.receipt);
    assert.ok(Number.isFinite(ack.at) && ack.at >= request.at && !ack.error); assert.ok(applied && Number.isFinite(applied.at));
    assert.deepEqual(ack.receipt, row.receipt); assert.deepEqual(applied.receipt, row.receipt); assert.equal(applied.status, 'accepted');
    assert.equal(applied.viewId, binding.viewId); assert.equal(applied.controlEpoch, binding.controlEpoch);
    assert.ok(applied.at >= ack.at);
    assert.ok(ack.at - request.at < 400, '原400ms截止从首次发送起算，不能用历史收据补成合格');
    assert.ok(!client.states.some(value => value.id === id && value.status === 'unknown'));
    return { ack, applied };
  };
  const p = confirmed(prelude), r = confirmed(preludeStop), a = confirmed(selected);
  assert.deepEqual(actualRequests.slice(0, 3).map(row => row.id), [pId, rId, aId], '前奏只能是预定E/stop，随后首条SE固定为A');
  const pDown = client.inputs.find(row => row.type === 'keydown' && row.key === 'ArrowRight' && row.phase === 'prelude-right');
  const pUp = client.inputs.find(row => row.type === 'keyup' && row.key === 'ArrowRight' && row.phase === 'prelude-stop');
  assert.ok(pDown && pUp && pUp.at - pDown.at >= 20, '前奏仍为原20ms真实短按');
  assert.ok(pDown.at <= sent(pId).at && sent(pId).at <= pUp.at && pUp.at <= sent(rId).at, '原E/stop来自预定真实按下和松键');
  for (const key of [pDown, pUp]) { assert.equal(key.viewId, binding.viewId); assert.equal(key.epoch, binding.controlEpoch); }
  assert.ok(sent(aId).at - sent(pId).at >= 200, '同一实例从最后前奏方向到A已自然补满二token');
  assert.ok(sent(aId).at >= r.applied.at);

  const keys = ['ArrowRight', 'ArrowDown'].map(key => client.inputs.find(row => row.type === 'keydown' && row.key === key && row.phase === 'diagonal'));
  assert.ok(keys.every(Boolean)); assert.ok(keys[0].at <= keys[1].at);
  for (const key of keys) {
    assert.equal(key.viewId, binding.viewId); assert.equal(key.epoch, binding.controlEpoch);
    assert.ok(key.at >= sent(rId).at && key.at < r.ack.at, '真实两键在原stop等待期间暂存');
    const stop = key.actions.find(row => row.id === rId); assert.ok(stop && stop.status === 'waiting' && !stop.receipt);
  }
  const down = client.inputs.find(row => row.type === 'keyup' && row.key === 'ArrowRight' && row.phase === 'down-only');
  assert.ok(down && Number.isFinite(down.at)); assert.equal(down.viewId, binding.viewId); assert.equal(down.epoch, binding.controlEpoch);
  assert.ok(p.applied.at <= down.at && r.applied.at <= down.at);
  for (const id of [pId, rId]) {
    const draft = down.actions.find(row => row.id === id); assert.ok(draft && draft.status === 'accepted' && draft.receipt?.status === 'Accepted');
    assert.equal(draft.receipt.clientActionId, id);
  }
  const bId = full ? original(second, 'B') : null;
  const expected = full ? [aId, bId] : [aId], pending = down.actions.filter(row => ['waiting', 'unknown'].includes(row.status));
  assert.deepEqual(pending.map(row => row.id).sort(), [...expected].sort(), 'DOWN必须恰好保留预定槽位，不能有其他未决/Unknown');
  for (const row of pending) assert.ok(row.status === 'waiting' && !row.receipt);
  assert.ok(selected.enteredAt >= diagonalAt && selected.enteredAt <= downAt);
  assert.equal(selected.ackDeadlineAt, selected.submitReturnedAt + 180);
  assert.ok(selected.ackReleasedAt >= selected.ackDeadlineAt);
  assert.ok(sent(aId).at <= down.at && a.ack.at > down.at);
  assert.ok(!client.states.some(row => row.id === aId && row.receipt && row.at <= down.at));

  const provePlan = (row, proof, label) => {
    assert.equal(row.request.action.kind, 'move_direction'); assert.equal(row.request.action.direction, 'SE');
    assert.ok(proof && proof.plan); assert.equal(proof.stored.length, 1);
    assert.deepEqual(proof.stored[0].receipt.publicReceipt, row.receipt);
    assert.equal(proof.stored[0].semantic_digest, createHash('sha256').update(row.raw).digest('hex'));
    const plan = proof.plan; assert.equal(plan.status, 'accepted'); assert.equal(plan.movementId, row.receipt.result.movementId);
    assert.equal(plan.movementCommandSeq, row.request.action.movementCommandSeq); assert.equal(plan.controlEpoch, row.request.controlEpoch);
    assert.ok(plan.path.length >= 2 && plan.path[0].x !== plan.path.at(-1).x && plan.path[0].y !== plan.path.at(-1).y, label + '必须是原库中的真实双轴Accepted路径');
    assert.ok(row.receipt.actionEventRange && BigInt(proof.acceptedEventSeq) >= BigInt(row.receipt.actionEventRange.first)
      && BigInt(proof.acceptedEventSeq) <= BigInt(row.receipt.actionEventRange.last));
  };
  provePlan(selected, evidence, 'A');
  const south = actualRequests.find(row => row.action.kind === 'move_direction' && row.at >= down.at);
  assert.ok(south && south.action.direction === 'S', 'DOWN后的首个新方向只能是最新S');
  const acceptedSouth = submissions.find(row => row.request.clientActionId === south.id); original(acceptedSouth, 'S'); confirmed(acceptedSouth);
  assert.ok(acceptedSouth.submitStartedAt >= selected.submitReturnedAt, 'S只等待A原提交，不能伪造原事务次序');
  if (full) {
    provePlan(second, evidence.secondEvidence, 'B');
    assert.equal(evidence.secondEvidence.stored[0].actor_id, evidence.stored[0].actor_id);
    assert.equal(actualRequests[3]?.id, bId, 'B固定为A之后第二条SE');
    const b = confirmed(second);
    assert.ok(second.enteredAt >= selected.enteredAt && second.enteredAt <= downAt && sent(bId).at <= down.at);
    assert.ok(second.submitStartedAt >= selected.submitReturnedAt);
    assert.equal(second.ackDeadlineAt, Math.max(second.submitReturnedAt, selected.ackReleasedAt + 50));
    assert.ok(second.ackReleasedAt >= second.ackDeadlineAt && b.ack.at > a.ack.at);
    assert.ok(a.applied.at <= south.at, '原A的ACK/账本收束之后才可发首S');
    assert.ok(!actualRequests.some(row => row.action.kind === 'move_direction' && row.at >= down.at && row.at < a.ack.at), '两条原方向未决时不得发第三条');
  } else {
    assert.equal(evidence.secondEvidence, null);
    assert.ok(south.at < a.ack.at, '空槽新S必须在原A ACK之前发出');
  }
  assert.ok(!actualRequests.some(row => row.action.kind === 'move_direction' && row.action.direction === 'SE' && row.at >= down.at), '迟到ACK不得复活SE');
  const stop = movementRequests.at(-1); assert.equal(stop.action.kind, 'stop_move');
  assert.ok(movementRequests.slice(0, -1).every(request => BigInt(request.action.movementCommandSeq) < BigInt(stop.action.movementCommandSeq)));
  const stopRow = submissions.find(row => row.request.clientActionId === stop.clientActionId); original(stopRow, '最终stop'); confirmed(stopRow);
  return { qualified: true, lateMode, selectedId: aId, secondId: bId, down, ack: a.ack, applied: a.applied, south, acceptedSouth,
    southAcceptedBeforeAck: acceptedSouth.submitReturnedAt < a.ack.wallAt, stop, heldMs: selected.ackReleasedAt - selected.submitReturnedAt,
    budgetQuietMs: sent(aId).at - sent(pId).at, pendingAtDown: pending.map(row => row.id) };
}

export async function collectAcceptedLateEvidence(pool, observer, client, movementRequests) {
  const timing = observer.read();
  const collect = async row => {
    if (!row) return { stored: [], plan: null, acceptedEventSeq: null };
    const request = row.request;
    const stored = (await pool.query('SELECT actor_id,semantic_digest,receipt FROM action_receipts WHERE session_id=$1 AND client_action_id=$2', [request.sessionId, request.clientActionId])).rows;
    const range = row.receipt?.actionEventRange;
    const events = range ? (await pool.query('SELECT event,event_text_encoding FROM world_events WHERE session_id=$1 AND session_seq>=$2 AND session_seq<=$3 ORDER BY session_seq', [request.sessionId, range.first, range.last])).rows.map(value => decodeJsonbText(value.event, value.event_text_encoding)) : [];
    const plans = events.filter(event => event.kind === 'spatial.actor' && event.payload.actor.characterId === stored[0]?.actor_id
      && event.payload.actor.movement?.movementId === row.receipt.result?.movementId && event.payload.actor.movement.status === 'accepted');
    return { stored, acceptedEventSeq: plans[0]?.sessionSeq ?? null, plan: plans.length === 1 ? plans[0].payload.actor.movement : null };
  };
  return { ...timing, ...await collect(timing.selected), secondEvidence: timing.second ? await collect(timing.second) : null, client, movementRequests };
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
