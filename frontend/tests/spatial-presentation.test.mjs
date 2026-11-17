import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfirmedMotion } from '../src/domain/spatial-motion.ts';
import { CanvasPresentationOwner } from '../src/rendering/spatial-presentation.ts';
import { spatialSnapshot, selfRef } from './spatial-fixture.mjs';

// 明确的受控DOM/帧替身，只检验owner资格与封口协议，不代表真实Canvas运行。
function fixture() {
  const snapshot = spatialSnapshot(), motion = new ConfirmedMotion(); motion.update(snapshot, 0);
  const style = { display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible' };
  const bounds = { left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 };
  const doc = { hidden: false, visibilityState: 'visible', defaultView: { innerWidth: 1000, innerHeight: 800, getComputedStyle: () => style } };
  const canvas = { ownerDocument: doc, isConnected: true, parentElement: null, getBoundingClientRect: () => bounds, getClientRects: () => [bounds] };
  const frame = { sceneId: 'yard', instance: 'paint-instance-1', serial: 1, viewport: { width: 1000, height: 800, dpr: 1 },
    view: { x: 0, y: 0, width: 1000, height: 800 }, fit: { x: 0, y: 0, scale: 1 }, actors: [{ ref: selfRef, ...motion.pose(selfRef, 0) }] };
  return { snapshot, motion, style, bounds, doc, canvas, frame, owner: new CanvasPresentationOwner(motion, canvas) };
}

test('TIME-03：受控owner仅成功可见帧开账，封口重复调用不重算或清除封存信用', () => {
  const f = fixture(); f.owner.painted(null, f.snapshot, 0, 0, true); f.owner.seal(100, true); assert.equal(f.motion.presentationCreditMs, 0);
  assert.equal(f.owner.painted(f.frame, f.snapshot, 100, 110, true), true);
  f.owner.seal(210, true); assert.equal(f.motion.presentationCreditMs, 100, '以提交完成110起算，不回填姿态采样100');
  f.owner.seal(250, true); assert.equal(f.motion.presentationCreditMs, 100, '没有新成功帧，不追加时间');
});

test('TIME-03：hidden、移出可见区、卸载、disabled或reducedMotion中断丢弃全部信用', () => {
  const invalidations = [f => f.doc.hidden = true, f => f.doc.visibilityState = 'hidden', f => f.canvas.isConnected = false,
    f => f.style.display = 'none', f => f.style.visibility = 'hidden', f => f.style.opacity = '0',
    f => { f.bounds.left = 1500; f.bounds.right = 2500; }, f => { f.bounds.width = 0; f.bounds.right = 0; }];
  for (const invalidate of invalidations) {
    const f = fixture(); f.owner.painted(f.frame, f.snapshot, 0, 0, true); f.owner.seal(50, true);
    f.owner.painted({ ...f.frame, serial: 2 }, f.snapshot, 50, 50, true); invalidate(f); f.owner.seal(100, true);
    assert.equal(f.motion.presentationCreditMs, 0); assert.equal(f.owner.painted({ ...f.frame, serial: 3 }, f.snapshot, 100, 100, true), false);
  }
  const disabled = fixture(); disabled.owner.painted(disabled.frame, disabled.snapshot, 0, 0, true); disabled.owner.seal(100, false);
  assert.equal(disabled.motion.presentationCreditMs, 0); assert.equal(disabled.owner.painted({ ...disabled.frame, serial: 2 }, disabled.snapshot, 100, 100, false), false);
});

test('TIME-03：成功帧仍需本人处于显示范围，不可用离屏同点换取信用', () => {
  const f = fixture(); f.frame.actors[0].position = { x: 1200, y: 100 };
  assert.equal(f.owner.painted(f.frame, f.snapshot, 0, 0, true), false); f.owner.seal(200, true); assert.equal(f.motion.presentationCreditMs, 0);
  const clipped = fixture(); clipped.canvas.parentElement = { parentElement: null, getBoundingClientRect: () => ({ left: 200, right: 1000, top: 0, bottom: 800 }) };
  clipped.doc.defaultView.getComputedStyle = node => node === clipped.canvas ? clipped.style : { ...clipped.style, overflowX: 'hidden' };
  assert.equal(clipped.owner.painted(clipped.frame, clipped.snapshot, 0, 0, true), false);
});

test('TIME-03：画布clear/resize/异常显式失效后必须新成功帧，替换owner不继承旧renderer信用', () => {
  const f = fixture(); f.owner.painted(f.frame, f.snapshot, 0, 0, true); f.owner.seal(100, true); f.owner.invalidate();
  assert.equal(f.motion.presentationCreditMs, 0); assert.equal(f.owner.painted(f.frame, f.snapshot, 100, 100, true), false, '旧serial不能重播成新凭据');
  f.owner.painted({ ...f.frame, serial: 2 }, f.snapshot, 100, 100, true); f.owner.seal(150, true); assert.equal(f.motion.presentationCreditMs, 50);
  const replacement = new CanvasPresentationOwner(f.motion, f.canvas); replacement.painted(f.frame, f.snapshot, 150, 150, true);
  assert.equal(f.motion.presentationCreditMs, 0); replacement.seal(175, true); assert.equal(f.motion.presentationCreditMs, 25);
});

test('TIME-03：纯hold延后凭据在尾前/尾后失效均清零，renderer替换只能从新帧起算', () => {
  const holding = () => {
    const f = fixture(), first = structuredClone(f.snapshot), point = first.projection.self.position;
    f.snapshot.snapshotSeq = '11'; f.snapshot.projection.sceneTimeMs += 50;
    Object.assign(f.snapshot.projection.entities[0], { motionTrail: [point, point], motionFromSceneTimeMs: first.projection.sceneTimeMs,
      motionThroughSceneTimeMs: f.snapshot.projection.sceneTimeMs, motionTimeline: [{ kind: 'hold', fromSceneTimeMs: first.projection.sceneTimeMs,
        throughSceneTimeMs: f.snapshot.projection.sceneTimeMs, fromTrailIndex: 0, throughTrailIndex: 1 }] });
    f.motion.update(f.snapshot, 0); assert.equal(f.owner.painted(f.frame, f.snapshot, 25, 25, true), true); return f;
  };
  for (const at of [40, 70]) for (const invalidate of [
    f => { f.doc.hidden = true; f.owner.seal(at, true); },
    f => { f.canvas.isConnected = false; f.owner.seal(at, true); },
    f => { f.style.visibility = 'hidden'; f.owner.seal(at, true); },
    f => f.owner.seal(at, false), f => f.owner.invalidate(),
  ]) {
    const f = holding(); invalidate(f); f.doc.hidden = false; f.canvas.isConnected = true; f.style.visibility = 'visible';
    f.owner.seal(100, true); assert.equal(f.motion.presentationCreditMs, 0, '重新可见不能复活之前的延后凭据');
  }
  const f = holding(); f.owner.invalidate();
  const replacement = new CanvasPresentationOwner(f.motion, f.canvas);
  assert.equal(replacement.painted(f.frame, f.snapshot, 60, 60, true), true); replacement.seal(70, true);
  assert.equal(f.motion.presentationCreditMs, 10, '新owner不能赚取旧hold尾到新提交前的时间');
});
