// 只在组件回归中安装：读取真实前台像素与调用顺序，受控异常不伪造成功帧。
import { ConfirmedMotion } from '../src/domain/spatial-motion.ts';
import { SpatialCanvas, readCanvasFrame } from '../src/rendering/spatial-canvas.ts';
import { CanvasPresentationOwner } from '../src/rendering/spatial-presentation.ts';
import { spatialSnapshot } from './spatial-fixture.mjs';

export function installCanvasBoundaryProbe() {
  const rows = []; let pending = null, current = null, last = null, presenting = null, owner = null;
  const front = () => document.querySelector('[data-testid="spatial-map"]');
  const pixels = canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  const unchanged = run => pixels(run.canvas).every((value, index) => value === run.pixels[index]);
  const mark = (run, kind) => run.row.events.push({ kind, at: performance.now(), oldFrontIntact: unchanged(run) });
  const originalPaint = SpatialCanvas.prototype.paint, originalPrepare = SpatialCanvas.prototype.prepare;
  SpatialCanvas.prototype.prepare = function (...args) {
    if (pending === 'prepare-error') {
      pending = null; rows.push({ mode: 'prepare-error', events: [{ kind: 'prepare-error', at: performance.now() }], completed: true });
      throw new Error('受控prepare失败');
    }
    return Reflect.apply(originalPrepare, this, args);
  };
  SpatialCanvas.prototype.paint = function (snapshot, motion, sampledAt, options) {
    if (!pending) return Reflect.apply(originalPaint, this, arguments);
    const canvas = front(), row = { mode: pending, sampledAt, hasProductionCallback: typeof options.beforeFrontWrite === 'function',
      previousSerial: readCanvasFrame(canvas)?.serial, events: [], queries: [] };
    const run = { row, canvas, motion, pixels: pixels(canvas), bufferSeen: false, waitingActive: false };
    pending = null; rows.push(row); current = run; last = run;
    try {
      if (row.mode === 'null-result') { row.nullResult = true; return null; }
      const frame = originalPaint.call(this, snapshot, motion, sampledAt, { ...options, beforeFrontWrite: () => {
        mark(run, 'before-front');
        if (row.mode === 'callback-error') throw new Error('受控封口回调失败');
        options.beforeFrontWrite?.(); row.creditAtSeal = motion.presentationCreditMs;
      } });
      row.serial = frame?.serial; row.events.push({ kind: 'paint-return', at: performance.now() });
      return frame;
    } catch (error) { row.error = String(error); throw error; }
    finally { row.completed = true; current = null; }
  };
  for (const name of ['fillRect', 'setTransform', 'drawImage']) {
    const original = CanvasRenderingContext2D.prototype[name];
    CanvasRenderingContext2D.prototype[name] = function (...args) {
      const run = current;
      if (run && name === 'fillRect' && this.canvas !== run.canvas && !run.bufferSeen) {
        run.bufferSeen = true; mark(run, 'buffer-start');
        if (run.row.mode === 'buffer-error') throw new Error('受控buffer准备失败');
      }
      if (run && this.canvas === run.canvas) {
        mark(run, name === 'setTransform' ? 'front-transform' : 'front-write');
        if (run.row.mode === 'front-error' && name === 'drawImage') throw new Error('受控front写入失败');
      }
      return Reflect.apply(original, this, args);
    };
  }
  const originalPainted = CanvasPresentationOwner.prototype.painted;
  CanvasPresentationOwner.prototype.painted = function (frame, snapshot, sampledAt, presentedAt, allowed) {
    owner = this;
    const run = last?.row.serial === frame?.serial ? last : null;
    if (!run) return Reflect.apply(originalPainted, this, arguments);
    run.row.events.push({ kind: 'owner-painted', at: performance.now() });
    run.row.presentedAt = presentedAt; presenting = run;
    try {
      if (run.row.mode === 'painted-error') throw new Error('受控成功返回后资格失败');
      const accepted = Reflect.apply(originalPainted, this, arguments);
      run.row.accepted = accepted; run.row.creditAfterPaint = run.motion.presentationCreditMs; run.waitingActive = true; return accepted;
    } finally { presenting = null; }
  };
  for (const name of ['settled', 'active']) {
    const original = ConfirmedMotion.prototype[name];
    ConfirmedMotion.prototype[name] = function (...args) {
      const run = presenting ?? (name === 'active' && last?.waitingActive ? last : null);
      if (run?.motion === this) { run.row.queries.push({ name, at: args.at(-1) }); if (name === 'active') run.waitingActive = false; }
      return Reflect.apply(original, this, args);
    };
  }
  return { arm(mode) { pending = mode; return rows.length; }, read: () => structuredClone(rows), seal: () => owner?.seal(performance.now(), true) };
}

export async function realHoldSuffix() {
  const scenarios = [];
  for (const earlySeal of [false, true]) {
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'position:fixed;left:0;top:0;width:600px;height:480px'; document.body.append(canvas);
    const motion = new ConfirmedMotion(), renderer = new SpatialCanvas(canvas), owner = new CanvasPresentationOwner(motion, canvas);
    try {
      renderer.resize(600, 480, 1); const initial = spatialSnapshot(); initial.projection.sceneTimeMs = 0; motion.update(initial, performance.now());
      const snapshot = structuredClone(initial), point = snapshot.projection.self.position; snapshot.snapshotSeq = '11'; snapshot.projection.sceneTimeMs = 200;
      Object.assign(snapshot.projection.entities[0], { motionTrail: [{ ...point }, { ...point }], motionFromSceneTimeMs: 0, motionThroughSceneTimeMs: 200,
        motionTimeline: [{ kind: 'hold', fromSceneTimeMs: 0, throughSceneTimeMs: 200, fromTrailIndex: 0, throughTrailIndex: 1 }] });
      const installedAt = performance.now(); motion.update(snapshot, installedAt); renderer.prepare(snapshot);
      const afterPrepare = motion.presentationCreditMs, sampledAt = performance.now();
      const frame = renderer.paint(snapshot, motion, sampledAt, { reducedMotion: false, beforeFrontWrite: () => owner.seal(performance.now(), true) });
      const presentedAt = performance.now(), accepted = owner.painted(frame, snapshot, sampledAt, presentedAt, true), tail = installedAt + 200;
      const beforeSeal = motion.presentationCreditMs, sampledPending = !motion.settled(snapshot.projection.self.entityRef, sampledAt);
      const firstSeal = earlySeal ? performance.now() : null; if (earlySeal) owner.seal(firstSeal, true);
      await new Promise(resolve => setTimeout(resolve, Math.max(0, tail + 25 - performance.now())));
      const sealedAt = performance.now(); owner.seal(sealedAt, true); const credit = motion.presentationCreditMs;
      owner.seal(sealedAt + 10, true); const repeatedCredit = motion.presentationCreditMs;
      // 原clear责任仍由owner调用方承担；真实无scene路径返回null不能重新开账。
      owner.invalidate(); const absent = structuredClone(snapshot); absent.projection.scene = null;
      const empty = renderer.paint(absent, motion, performance.now(), { reducedMotion: false });
      const nullAccepted = owner.painted(empty, absent, performance.now(), performance.now(), true); owner.seal(performance.now(), true);
      scenarios.push({ earlySeal, serial: frame?.serial, sampledAt, presentedAt, tail, sampledPending, accepted, afterPrepare, beforeSeal,
        firstSeal, sealedAt, credit, repeatedCredit, nullFrame: empty, nullAccepted, afterNull: motion.presentationCreditMs });
    } finally { owner.invalidate(); renderer.clear(); canvas.remove(); }
  }
  return scenarios;
}
