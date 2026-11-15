// 真实浏览器的只读观察器；本模块没有DOM写入、定时调度或呈现信用调用。
const point = value => value ? { x: value.x, y: value.y } : null;
const input = snapshot => snapshot ? { sessionId: snapshot.sessionId, viewId: snapshot.viewId, snapshotSeq: snapshot.snapshotSeq,
  sceneTimeMs: snapshot.projection.sceneTimeMs, entityRef: snapshot.projection.self.entityRef,
  controlEpoch: snapshot.projection.self.controlEpoch, sceneId: snapshot.projection.self.sceneId } : { snapshotSeq: null };

export function observePresentation({ ConfirmedMotion, SpatialCanvas, CanvasPresentationOwner }, { limit = 32768, now = () => performance.now(), phase = () => null } = {}) {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError('观察记录上限必须为正整数。');
  const calls = [], errors = [], restorers = [], identities = new WeakMap();
  let nextIdentity = 0, nextCall = 0, parent = null, dropped = 0, active = true;
  const installedAt = now();
  const identity = object => { if (!identities.has(object)) identities.set(object, ++nextIdentity); return identities.get(object); };
  const error = value => { if (errors.length < 32) errors.push(String(value?.message ?? value)); };
  const record = (kind, object) => {
    if (!active) return null;
    if (calls.length >= limit) { dropped++; return null; }
    const row = { call: ++nextCall, parent, kind, object: object ? identity(object) : null, startedAt: now(), phase: phase() };
    calls.push(row); return row;
  };
  function wrap(prototype, name, kind, before = () => ({}), after = () => ({})) {
    const original = prototype[name];
    function observed(...args) {
      let row;
      try { row = record(kind, this); if (row) Object.assign(row, before.call(this, args)); } catch (failure) { error(failure); }
      const previous = parent; if (row) parent = row.call;
      try {
        const result = Reflect.apply(original, this, args);
        if (row) { try { Object.assign(row, after.call(this, result, args)); row.finishedAt = now(); } catch (failure) { error(failure); } }
        return result;
      } catch (failure) {
        if (row) { row.threw = String(failure?.message ?? failure); row.finishedAt = now(); }
        throw failure;
      } finally { parent = previous; }
    }
    prototype[name] = observed;
    restorers.push(() => { if (prototype[name] === observed) prototype[name] = original; });
  }
  const credit = function () { return { creditBefore: this.presentationCreditMs }; };
  const settledCredit = function (result) { return { creditAfter: this.presentationCreditMs, ...(typeof result === 'boolean' ? { returned: result } : {}) }; };
  wrap(ConfirmedMotion.prototype, 'update', 'motion.update', function ([snapshot, sampledAt]) {
    const self = snapshot.projection.self, person = snapshot.projection.sceneOverview?.entities.find(value => value.entityRef === self.entityRef)
      ?? snapshot.projection.entities.find(value => value.entityRef === self.entityRef), timeline = person?.motionTimeline;
    return { ...input(snapshot), sampledAt, position: point(self.position), creditBefore: this.presentationCreditMs,
      timelineSpans: timeline?.length ?? 0, firstSpan: timeline?.[0] ? { ...timeline[0] } : null,
      lastSpan: timeline?.at(-1) ? { ...timeline.at(-1) } : null };
  }, settledCredit);
  wrap(ConfirmedMotion.prototype, 'presentSelf', 'motion.presentSelf', function ([proof]) {
    return { ...credit.call(this), proof: { ...proof, position: point(proof.position) } };
  }, settledCredit);
  wrap(ConfirmedMotion.prototype, 'sealPresentation', 'motion.sealPresentation', function ([at]) { return { ...credit.call(this), sealedAt: at }; }, settledCredit);
  wrap(ConfirmedMotion.prototype, 'invalidatePresentation', 'motion.invalidatePresentation', credit, settledCredit);
  wrap(ConfirmedMotion.prototype, 'reset', 'motion.reset', credit, settledCredit);
  wrap(SpatialCanvas.prototype, 'paint', 'canvas.paint', ([snapshot, , sampledAt]) => ({ ...input(snapshot), sampledAt }), (frame, [snapshot]) => ({
    frame: frame ? { instance: frame.instance, serial: frame.serial, sceneId: frame.sceneId,
      self: (() => { const actor = frame.actors.find(value => value.ref === snapshot.projection.self.entityRef); return actor ? { ref: actor.ref, position: point(actor.position), moving: actor.moving, distance: actor.distance } : null; })() } : null,
  }));
  wrap(CanvasPresentationOwner.prototype, 'painted', 'owner.painted', ([frame, snapshot, sampledAt, presentedAt, allowed]) => ({
    ...input(snapshot), instance: frame?.instance, serial: frame?.serial, sampledAt, presentedAt, allowed,
  }), result => ({ returned: result }));
  wrap(CanvasPresentationOwner.prototype, 'seal', 'owner.seal', ([sealedAt, allowed]) => ({ sealedAt, allowed }));
  wrap(CanvasPresentationOwner.prototype, 'invalidate', 'owner.invalidate');
  return {
    snapshot(snapshot) { try { const row = record(snapshot ? 'source.accept' : 'source.reset'); if (row) Object.assign(row, input(snapshot), { finishedAt: now() }); } catch (failure) { error(failure); } },
    error,
    read() { return { installedAt, limit, dropped, calls, errors }; },
    stop() { active = false; for (const restore of restorers.reverse()) restore(); },
  };
}
