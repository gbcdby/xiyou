import test from 'node:test';
import assert from 'node:assert/strict';
import { observePresentation } from './presentation-observer.mjs';
import { assertPresentationEvidence } from './direction-browser-support.mjs';
import { spatialSnapshot } from './spatial-fixture.mjs';

function controlled() {
  const invocations = [], snapshot = spatialSnapshot(), failure = new Error('原绘制失败'), frame = { instance: 9, serial: 1, sceneId: 'yard', actors: [{ ref: snapshot.projection.self.entityRef, position: { x: 100, y: 100 }, moving: false, distance: 0 }] };
  class Motion {
    balance = 0;
    get presentationCreditMs() { return this.balance; }
    update(...args) { invocations.push({ kind: 'update', owner: this, args }); return frame; }
    presentSelf(...args) { invocations.push({ kind: 'present', owner: this, args }); return true; }
    sealPresentation(...args) { invocations.push({ kind: 'seal', owner: this, args }); this.balance = 25; }
    invalidatePresentation() { this.balance = 0; }
    reset() { this.invalidatePresentation(); }
  }
  class Canvas {
    paint(...args) { invocations.push({ kind: 'paint', owner: this, args }); if (this.fail) throw failure; return frame; }
  }
  class Owner {
    constructor(motion) { this.motion = motion; }
    painted(value, state, sampledAt, presentedAt, allowed) {
      return this.motion.presentSelf({ identity: 'controlled-only', reference: state.projection.self.entityRef, renderer: 'owner:' + value.instance,
        serial: value.serial, position: value.actors[0].position, moving: false, distance: 0, sampledAt, presentedAt });
    }
    seal(at) { this.motion.sealPresentation(at); }
    invalidate() { this.motion.invalidatePresentation(); }
  }
  return { Motion, Canvas, Owner, snapshot, frame, failure, invocations };
}

test('只读呈现观察器：受控方法的this/原参数/返回值/采样时钟保持，安装不产生调用', () => {
  const f = controlled(), originals = [f.Motion.prototype.update, f.Canvas.prototype.paint, f.Owner.prototype.painted];
  let clock = 200;
  const observer = observePresentation({ ConfirmedMotion: f.Motion, SpatialCanvas: f.Canvas, CanvasPresentationOwner: f.Owner }, { now: () => clock++, phase: () => 'controlled-unit' });
  const motion = new f.Motion(), canvas = new f.Canvas(), owner = new f.Owner(motion), poses = new Map();
  try {
    assert.equal(f.invocations.length, 0); observer.snapshot(f.snapshot);
    assert.equal(motion.update(f.snapshot, 100), f.frame);
    assert.equal(canvas.paint(f.snapshot, poses, 100), f.frame);
    assert.equal(owner.painted(f.frame, f.snapshot, 100, 230, true), true); owner.seal(260, true);
    assert.deepEqual(f.invocations.map(row => row.kind), ['update', 'paint', 'present', 'seal']);
    assert.equal(f.invocations[0].owner, motion); assert.equal(f.invocations[0].args[0], f.snapshot); assert.equal(f.invocations[0].args[1], 100);
    assert.equal(f.invocations[1].owner, canvas); assert.equal(f.invocations[1].args[1], poses); assert.equal(f.invocations[1].args[2], 100);
    assert.equal(f.invocations[2].args[0].sampledAt, 100); assert.equal(f.invocations[2].args[0].presentedAt, 230);
    assert.equal(f.invocations[3].args[0], 260);
    const evidence = observer.read(); assert.equal(evidence.dropped, 0); assert.deepEqual(evidence.errors, []);
    assert.equal(assertPresentationEvidence(evidence).acceptedPresentations, 1);
    const missingPaint = { ...evidence, calls: evidence.calls.filter(row => row.kind !== 'canvas.paint') };
    assert.throws(() => assertPresentationEvidence(missingPaint), '没有真实调用记录不能仅凭credit方法返回值获资格');
  } finally { observer.stop(); }
  assert.deepEqual([f.Motion.prototype.update, f.Canvas.prototype.paint, f.Owner.prototype.painted], originals);
});

test('只读呈现观察器：原异常同对象抛出、记录限量不阻止后续原调用，cleanup可重复', () => {
  const f = controlled(), original = f.Canvas.prototype.paint;
  const observer = observePresentation({ ConfirmedMotion: f.Motion, SpatialCanvas: f.Canvas, CanvasPresentationOwner: f.Owner }, { limit: 2, now: () => 1 });
  const canvas = new f.Canvas(); canvas.fail = true;
  try {
    for (let index = 0; index < 4; index++) assert.throws(() => canvas.paint(f.snapshot, null, 123), error => error === f.failure);
    assert.equal(f.invocations.length, 4); assert.equal(observer.read().calls.length, 2); assert.equal(observer.read().dropped, 2);
    assert.equal(observer.read().calls[0].threw, f.failure.message);
  } finally { observer.stop(); observer.stop(); }
  assert.equal(f.Canvas.prototype.paint, original);
});
