// 仅观察生产Socket回调、已接受Batch和原状态发布；不写视图、不调度同步、不调用paint/信用。
import { watch } from 'vue';
import { Socket } from 'socket.io-client';

export function observeDirectionClient({ SpatialView, spatialState, inputTarget = document, SocketClass = Socket }, { limit = 8192, phase = () => null } = {}) {
  let running = false, origin = null, reference = null, initial = null, dropped = 0;
  const requests = [], acknowledgements = [], applications = [], states = [], inputs = [], errors = [], known = new Map(), restorers = [];
  let maxPendingDirections = 0, maxPendingStops = 0;
  const stamp = () => ({ at: performance.now(), wallAt: Date.now() });
  const safe = fn => { try { return fn(); } catch (error) { if (errors.length < 32) errors.push(String(error?.message ?? error)); } };
  const add = (rows, row) => { if (!running) return; if (rows.length >= limit) { dropped++; return; } rows.push(row); };
  const parsed = value => typeof value === 'string' ? JSON.parse(value) : value;
  const binding = snapshot => snapshot ? { sessionId: snapshot.sessionId, viewId: snapshot.viewId, controlEpoch: snapshot.projection.self.controlEpoch, snapshotSeq: snapshot.snapshotSeq } : null;
  const person = snapshot => {
    const p = snapshot?.projection, value = p?.sceneOverview?.entities.find(value => value.entityRef === reference) ?? p?.entities.find(value => value.entityRef === reference);
    return value ? structuredClone({ entityRef: value.entityRef, position: value.position, moving: value.moving, motionTrail: value.motionTrail, motionTimeline: value.motionTimeline }) : null;
  };
  const originalEmit = SocketClass.prototype.emit;
  function observedEmit(...args) {
    const event = args[0], record = running && ['player.action.request', 'sync.request'].includes(event);
    if (!record) return Reflect.apply(originalEmit, this, args);
    let request; safe(() => { request = parsed(args[1]); add(requests, { ...stamp(), event, id: request.clientActionId ?? null, action: request.action ?? null, request: structuredClone(request) }); });
    const callback = args.at(-1), forwarded = [...args];
    if (typeof callback === 'function') forwarded[forwarded.length - 1] = function (...replyArgs) {
      const prior = origin; origin = event === 'sync.request' ? 'sync' : 'action-ack';
      safe(() => { if (event === 'player.action.request') add(acknowledgements, { ...stamp(), id: request?.clientActionId, error: replyArgs[0] ? String(replyArgs[0]) : null, receipt: structuredClone(replyArgs[1]) }); });
      try { return Reflect.apply(callback, this, replyArgs); } finally { origin = prior; }
    };
    return Reflect.apply(originalEmit, this, forwarded);
  }
  SocketClass.prototype.emit = observedEmit;
  restorers.push(() => { if (SocketClass.prototype.emit === observedEmit) SocketClass.prototype.emit = originalEmit; });
  const originalEvent = SocketClass.prototype.emitEvent;
  function observedEvent(...args) {
    const prior = origin; if (args[0]?.[0] === 'world.batch') origin = 'push';
    try { return Reflect.apply(originalEvent, this, args); } finally { origin = prior; }
  }
  SocketClass.prototype.emitEvent = observedEvent;
  restorers.push(() => { if (SocketClass.prototype.emitEvent === observedEvent) SocketClass.prototype.emitEvent = originalEvent; });
  const originalApply = SpatialView.prototype.applyBatch;
  function observedApply(...args) {
    const before = this.snapshot?.snapshotSeq, started = stamp(), channel = origin;
    const result = Reflect.apply(originalApply, this, args);
    safe(() => { if (running) { const batch = args[0], after = this.snapshot;
      add(applications, { ...started, finishedAt: performance.now(), origin: channel ?? 'unattributed', result, before, after: after?.snapshotSeq,
        viewId: after?.viewId, epoch: after?.projection.self.controlEpoch, fromExclusive: batch?.fromExclusive, throughSeq: batch?.throughSeq,
        eventCount: batch?.events?.length ?? 0, person: person(after) });
    } });
    return result;
  }
  SpatialView.prototype.applyBatch = observedApply;
  restorers.push(() => { if (SpatialView.prototype.applyBatch === observedApply) SpatialView.prototype.applyBatch = originalApply; });
  const unwatch = watch(spatialState, state => safe(() => {
    if (!running) return;
    let directions = 0, stops = 0;
    for (const draft of state.actions) {
      const request = parsed(draft.raw), kind = request.action.kind;
      if (!['move_direction', 'stop_move'].includes(kind)) continue;
      if (['waiting', 'unknown'].includes(draft.status)) { if (kind === 'move_direction') directions++; else stops++; }
      const signature = draft.status + ':' + Boolean(draft.receipt);
      if (known.get(draft.id) !== signature) { known.set(draft.id, signature); add(states, { ...stamp(), id: draft.id, status: draft.status, receipt: structuredClone(draft.receipt), ...binding(state.snapshot) }); }
    }
    maxPendingDirections = Math.max(maxPendingDirections, directions); maxPendingStops = Math.max(maxPendingStops, stops);
  }), { flush: 'sync' });
  const input = event => safe(() => {
    if (!running || !['ArrowRight', 'ArrowDown'].includes(event.key)) return;
    const state = spatialState.value;
    add(inputs, { ...stamp(), type: event.type, key: event.key, repeat: event.repeat, phase: phase(), viewId: state.snapshot?.viewId, epoch: state.snapshot?.projection.self.controlEpoch,
      actions: state.actions.map(draft => ({ id: draft.id, status: draft.status, receipt: draft.receipt ? { status: draft.receipt.status, clientActionId: draft.receipt.clientActionId } : null })) });
  });
  inputTarget.addEventListener('keydown', input, true); inputTarget.addEventListener('keyup', input, true);
  return {
    begin(value) { reference = value; initial = binding(spatialState.value.snapshot); running = true; },
    read() { return { initial, reference, requests, acknowledgements, applications, states, inputs, errors, dropped, maxPendingDirections, maxPendingStops }; },
    stop() { running = false; unwatch(); inputTarget.removeEventListener('keydown', input, true); inputTarget.removeEventListener('keyup', input, true); for (const restore of restorers.reverse()) restore(); return this.read(); },
  };
}
