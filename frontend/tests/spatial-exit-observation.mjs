import { observePresentation } from './presentation-observer.mjs';

const copy = value => value === undefined ? null : JSON.parse(JSON.stringify(value));
const message = error => String(error?.message ?? error);
const rect = value => value ? Object.fromEntries(['left', 'top', 'right', 'bottom', 'width', 'height'].map(key => [key, value[key]])) : null;
const identity = snapshot => snapshot ? { sessionId: snapshot.sessionId, viewId: snapshot.viewId, snapshotSeq: snapshot.snapshotSeq,
  entityRef: snapshot.projection.self.entityRef, epoch: snapshot.projection.self.controlEpoch, mapVersion: snapshot.projection.mapVersion,
  sceneId: snapshot.projection.self.sceneId, sceneTimeMs: snapshot.projection.sceneTimeMs } : null;

/** 只读测试记录器；实际方法才生成调用行，读取旧帧不充当一次paint。 */
export function observeExit(dependencies, { metadata, readState, getCanvas, document: doc, window: win,
  now = () => performance.now(), wall = () => Date.now(), timeOrigin = performance.timeOrigin,
  sampleLimit = 1024, callLimit = 16384 } = {}) {
  if (!Number.isSafeInteger(sampleLimit) || sampleLimit < 1 || !Number.isSafeInteger(callLimit) || callLimit < 1) throw new TypeError('观察上限必须为正整数。');
  const { ConfirmedMotion, SpatialCanvas, CanvasPresentationOwner, SpatialSessionClient, readCanvasFrame, visibleSelf } = dependencies;
  const samples = [], calls = [], drafts = [], errors = [], restorers = [], draftKeys = new Map(), objects = new WeakMap();
  let active = true, phase = 'before-click', sampleDropped = 0, callDropped = 0, lastSample = '', nextObject = 0;
  const objectId = value => { if (!value || !['object', 'function'].includes(typeof value)) return null; if (!objects.has(value)) objects.set(value, ++nextObject); return objects.get(value); };
  const error = failure => { if (errors.length < 32) errors.push(message(failure)); };
  const stamp = () => ({ at: now(), wallTime: wall(), phase });
  function geometry(frame, snapshot, kind) {
    const canvas = getCanvas(), current = canvas ? readCanvasFrame(canvas) : null;
    const actual = kind === 'read-existing-frame' ? current : frame;
    const self = actual?.actors.find(actor => actor.ref === snapshot?.projection.self.entityRef);
    const box = canvas ? rect(canvas.getBoundingClientRect()) : null;
    const clips = [];
    if (canvas) for (let node = canvas; node; node = node.parentElement) {
      const style = win.getComputedStyle(node);
      clips.push({ tag: node.tagName ?? null, rect: rect(node.getBoundingClientRect()), display: style.display,
        visibility: style.visibility, opacity: style.opacity, overflowX: style.overflowX, overflowY: style.overflowY });
    }
    const screen = box && actual && self && actual.viewport.width > 0 && actual.viewport.height > 0 ? {
      x: box.left + (actual.fit.x + self.position.x * actual.fit.scale) * box.width / actual.viewport.width,
      y: box.top + (actual.fit.y + self.position.y * actual.fit.scale) * box.height / actual.viewport.height,
    } : null;
    return { kind, hidden: doc.hidden, visibilityState: doc.visibilityState, viewport: { width: win.innerWidth, height: win.innerHeight },
      scroll: { x: win.scrollX, y: win.scrollY }, canvas: box, connected: canvas?.isConnected ?? false,
      clientRects: canvas ? [...canvas.getClientRects()].map(rect) : [], clips, screen,
      frame: actual ? { instance: actual.instance, serial: actual.serial, sceneId: actual.sceneId, view: copy(actual.view), fit: copy(actual.fit), viewport: copy(actual.viewport), self: copy(self) } : null,
      currentCanvasFrameMatches: Boolean(frame && current && frame.instance === current.instance && frame.serial === current.serial && frame.sceneId === current.sceneId),
      visibleSelf: Boolean(canvas && actual && snapshot && visibleSelf(canvas, actual, snapshot.projection.self.entityRef)) };
  }
  function publicState(state) {
    const snapshot = state.snapshot, p = snapshot?.projection;
    return { identity: identity(snapshot), connection: state.connection, inputReady: state.inputReady, timedTrail: state.timedTrail ?? false,
      queuedAction: state.queuedAction, navigation: copy(state.navigation), movement: copy(p?.movement), self: p ? {
        position: copy(p.self.position), canControl: p.self.canControl, movementCommandHighWater: p.self.movementCommandHighWater } : null,
      phase: p?.phase, paused: p?.paused,
      selectedExit: copy(p?.scene?.exits.find(exit => exit.exitId === metadata?.exitId)),
      privateQueueIdentity: 'unavailable: #queued has no public read interface',
      unsentCrossing: 'unavailable: reserved sequence is not evidence of a sent action' };
  }
  function captureDrafts(state) {
    for (const draft of state.actions ?? []) {
      const value = { id: draft.id, raw: draft.raw, status: draft.status, receipt: copy(draft.receipt), detail: draft.detail };
      const key = JSON.stringify(value); if (draftKeys.get(draft.id) === key) continue;
      if (drafts.length >= sampleLimit) { sampleDropped++; continue; }
      draftKeys.set(draft.id, key); drafts.push({ ...stamp(), ...value });
    }
  }
  function sample(kind, state) {
    if (!active) return;
    try {
      state ??= readState();
      captureDrafts(state);
      const value = { state: publicState(state), geometry: geometry(null, state.snapshot, 'read-existing-frame') };
      const key = JSON.stringify(value);
      if (kind === 'poll' && key === lastSample) return;
      if (samples.length >= sampleLimit) { sampleDropped++; return; }
      lastSample = key; samples.push({ ...stamp(), kind, ...value });
    } catch (failure) { error(failure); }
  }
  function record(kind, object) {
    if (!active) return null;
    if (calls.length >= callLimit) { callDropped++; return null; }
    const row = { ...stamp(), kind, exitObserverObject: objectId(object) }; calls.push(row); return row;
  }
  function wrap(prototype, name, before, after) {
    const original = prototype[name]; if (typeof original !== 'function') throw new TypeError('缺少原方法：' + name);
    function observed(...args) {
      let row;
      try { row = record(name, this); if (row) { Object.assign(row, before?.call(this, args)); row.originalEnteredAt = now(); } } catch (failure) { error(failure); }
      try {
        const result = Reflect.apply(original, this, args);
        if (row) try { row.originalReturnedAt = now(); Object.assign(row, after?.call(this, result, args), { finishedAt: now() }); } catch (failure) { error(failure); }
        return result;
      } catch (failure) {
        if (row) try { row.threw = message(failure); row.finishedAt = now(); } catch (observingFailure) { error(observingFailure); }
        throw failure;
      }
    }
    prototype[name] = observed;
    restorers.push(() => { if (prototype[name] === observed) prototype[name] = original; });
  }
  let presentation;
  try {
    // 两个实际调用缓冲区各16384，合计上限32768；状态/动作各有明确限量。
    presentation = observePresentation({ ConfirmedMotion, SpatialCanvas, CanvasPresentationOwner }, { limit: callLimit, now, phase: () => phase });
    for (const method of ['hasPendingMotion', 'settled']) wrap(ConfirmedMotion.prototype, method,
      ([reference, sampledAt]) => ({ reference, sampledAt, meaning: method === 'settled' ? 'strict-time-queue-query' : 'pending-motion-query' }), result => ({ returned: result }));
    wrap(SpatialCanvas.prototype, 'paint', ([snapshot, motion, sampledAt]) => ({ basis: identity(snapshot), movement: copy(snapshot.projection.movement), sampledAt, motionObject: objectId(motion) }),
      (frame, [snapshot]) => ({ geometry: geometry(frame, snapshot, frame ? 'actual-paint-return' : 'empty-paint-return') }));
    wrap(SpatialSessionClient.prototype, 'confirmDisplayedArrival', function ([value]) {
      sample('before-displayed-arrival', this.state); return { value: copy(value), before: publicState(this.state) };
    }, function () { sample('after-displayed-arrival', this.state); return { after: publicState(this.state) }; });
    wrap(SpatialSessionClient.prototype, 'traverseExit', function ([exitId]) { return { exitId, before: publicState(this.state) }; });
  } catch (failure) {
    for (const restore of restorers.reverse()) restore(); presentation?.stop(); throw failure;
  }
  const read = () => ({ metadata: copy(metadata), clock: { domain: 'browser-performance', timeOrigin }, phase,
    limits: { stateSamples: sampleLimit, draftChanges: sampleLimit, presentationCalls: callLimit, extraCalls: callLimit },
    samples, drafts, calls, sampleDropped, callDropped, errors, presentation: presentation.read() });
  return { sample,
    phase(value) { phase = value; },
    read,
    stop() { if (active) { active = false; for (const restore of restorers.reverse()) restore(); presentation.stop(); } return read(); },
  };
}

const nodeStamp = kind => ({ kind, domain: 'node-performance', timeOrigin: performance.timeOrigin, at: performance.now(), wallTime: Date.now() });
export function markExitObservation(handle, kind, failure) {
  if (!handle) return;
  handle.node.push({ ...nodeStamp(kind), ...(failure ? { error: message(failure) } : {}) });
}
/** 安装不点击/滚动/聚焦，也不调用世界、Receipt或呈现方法。 */
export async function beginExitObservation(page, metadata) {
  const handle = { metadata, node: [], observationErrors: [] };
  markExitObservation(handle, 'observation-install-start');
  try {
    await page.evaluate(async metadata => {
      const [{ ConfirmedMotion }, { SpatialCanvas, readCanvasFrame }, { CanvasPresentationOwner, visibleSelf }, { SpatialSessionClient }, { spatialState }, { observeExit }] = await Promise.all([
        import('/src/domain/spatial-motion.ts'), import('/src/rendering/spatial-canvas.ts'), import('/src/rendering/spatial-presentation.ts'),
        import('/src/network/spatial-session.ts'), import('/src/state/spatial-store.ts'), import('/tests/spatial-exit-observation.mjs'),
      ]);
      window.__xiyouExitObservation?.stop();
      const observer = observeExit({ ConfirmedMotion, SpatialCanvas, CanvasPresentationOwner, SpatialSessionClient, readCanvasFrame, visibleSelf }, {
        metadata, readState: () => spatialState.value, getCanvas: () => document.querySelector('[data-testid="spatial-map"]'), document, window,
      });
      window.__xiyouExitObservation = observer; observer.sample('before-click', spatialState.value);
    }, metadata);
  } catch (failure) { handle.observationErrors.push(message(failure)); }
  markExitObservation(handle, 'click-before'); return handle;
}
export function combineExitObservation(handle, browser, failure) {
  return { ...handle, browser: browser ?? null, ...(failure ? { observationError: message(failure) } : {}) };
}
/** 成功后收集；失败时runner复用原state读取完成同样收束，避免增加失败尾RPC。 */
export async function finishExitObservation(page, handle) {
  try {
    const browser = await page.evaluate(async () => {
      const observer = window.__xiyouExitObservation; if (!observer) return null;
      observer.phase('completed'); observer.sample('completed', (await import('/src/state/spatial-store.ts')).spatialState.value);
      const result = observer.stop(); delete window.__xiyouExitObservation; return result;
    });
    return combineExitObservation(handle, browser);
  } catch (failure) { return combineExitObservation(handle, null, failure); }
}
