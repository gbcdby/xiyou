import type { SnapshotV2 } from '../../../game/spatial-types.ts';
import { ConfirmedMotion, motionPresentationIdentity } from '../domain/spatial-motion.ts';
import type { CanvasSceneFrame } from './spatial-canvas.ts';

/** 可见性只服务于已成功绘制的帧，不能由此产生任何世界位置或运动。 */
export function visibleSelf(canvas: HTMLCanvasElement, frame: CanvasSceneFrame, reference: string): boolean {
  const doc = canvas.ownerDocument, win = doc.defaultView, actor = frame.actors.find(value => value.ref === reference);
  if (!win || doc.hidden || doc.visibilityState !== 'visible' || !canvas.isConnected || !actor || !canvas.getClientRects().length) return false;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || frame.viewport.width <= 0 || frame.viewport.height <= 0) return false;
  let left = Math.max(0, rect.left), top = Math.max(0, rect.top), right = Math.min(win.innerWidth, rect.right), bottom = Math.min(win.innerHeight, rect.bottom);
  for (let node: Element | null = canvas; node; node = node.parentElement) {
    const style = win.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
    if (node !== canvas) {
      const clip = node.getBoundingClientRect();
      if (/(hidden|clip|scroll|auto)/.test(style.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
      if (/(hidden|clip|scroll|auto)/.test(style.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
    }
  }
  const x = rect.left + (frame.fit.x + actor.position.x * frame.fit.scale) * rect.width / frame.viewport.width;
  const y = rect.top + (frame.fit.y + actor.position.y * frame.fit.scale) * rect.height / frame.viewport.height;
  return right > left && bottom > top && actor.position.x >= frame.view.x && actor.position.x <= frame.view.x + frame.view.width
    && actor.position.y >= frame.view.y && actor.position.y <= frame.view.y + frame.view.height && x >= left && x <= right && y >= top && y <= bottom;
}

let nextOwner = 0;
/** SpatialMap持有此owner；painted只能接收该次真实paint成功返回的frame。 */
export class CanvasPresentationOwner {
  #motion: ConfirmedMotion; #canvas: HTMLCanvasElement; #frame: CanvasSceneFrame | null = null; #reference = '';
  #generation = ++nextOwner;
  constructor(motion: ConfirmedMotion, canvas: HTMLCanvasElement) { this.#motion = motion; this.#canvas = canvas; }
  seal(now: number, allowed: boolean) {
    if (!allowed) this.#motion.invalidatePresentation();
    else if (this.#frame) {
      if (visibleSelf(this.#canvas, this.#frame, this.#reference)) this.#motion.sealPresentation(now);
      else this.#motion.invalidatePresentation();
    }
    this.#frame = null;
  }
  painted(frame: CanvasSceneFrame | null, snapshot: SnapshotV2, sampledAt: number, presentedAt: number, allowed: boolean): boolean {
    const reference = snapshot.projection.self.entityRef;
    if (!allowed || !frame || frame.sceneId !== snapshot.projection.self.sceneId || !visibleSelf(this.#canvas, frame, reference)) { this.invalidate(); return false; }
    const actor = frame.actors.find(value => value.ref === reference)!;
    this.#frame = frame; this.#reference = reference;
    return this.#motion.presentSelf({ identity: motionPresentationIdentity(snapshot), reference, renderer: `${this.#generation}:${frame.instance}`, serial: frame.serial,
      position: actor.position, facing: actor.facing, moving: actor.moving, distance: actor.distance, sampledAt, presentedAt });
  }
  invalidate() { this.#frame = null; this.#motion.invalidatePresentation(); }
}
