import type { Position } from '../../../game/spatial-types.ts';
import { fitCenter, sceneCoverFit, type CanvasFit, type CanvasSize } from './spatial-canvas-geometry.ts';

export interface CameraState { mode: 'follow' | 'free'; canReturn: boolean }
export interface CameraSample extends CameraState { center: Position; fit: CanvasFit; animating: boolean }
export interface CameraInput {
  scope: string; scene: CanvasSize; viewport: CanvasSize; self: Position; now: number; reducedMotion: boolean;
}
const returnDuration = 240, returnTolerance = 6;

/** 只持有本地取景；传入的self必须来自调用方本次绘制的同一运动采样。 */
export class SceneCamera {
  #scope = ''; #mode: CameraState['mode'] = 'follow'; #center: Position | null = null;
  #scene: CanvasSize | null = null; #viewport: CanvasSize | null = null; #last: CameraSample | null = null;
  #returning: { from: Position; at: number } | null = null;
  reset() {
    this.#scope = ''; this.#mode = 'follow'; this.#center = null; this.#last = null;
    this.#scene = null; this.#viewport = null; this.#returning = null;
  }
  sample(input: CameraInput): CameraSample {
    const { scope, scene, viewport, self, now, reducedMotion } = input;
    if (scope !== this.#scope) { this.reset(); this.#scope = scope; }
    const target = fitCenter(sceneCoverFit(scene, viewport, self), viewport);
    let center = this.#center ?? target;
    if (this.#mode === 'follow') {
      const progress = this.#returning && !reducedMotion ? Math.max(0, Math.min(1, (now - this.#returning.at) / returnDuration)) : 1;
      if (this.#returning && progress < 1) {
        const ease = 1 - (1 - progress) ** 3, from = this.#returning.from;
        center = { x: from.x + (target.x - from.x) * ease, y: from.y + (target.y - from.y) * ease };
      } else { center = target; this.#returning = null; }
    }
    const fit = sceneCoverFit(scene, viewport, center);
    this.#center = fitCenter(fit, viewport); this.#scene = { ...scene }; this.#viewport = { ...viewport };
    this.#last = { mode: this.#mode, canReturn: Math.hypot(target.x - this.#center.x, target.y - this.#center.y) * fit.scale > returnTolerance,
      center: { ...this.#center }, fit, animating: this.#returning !== null };
    return { ...this.#last, center: { ...this.#center }, fit: { ...fit } };
  }
  pan(delta: Position): boolean {
    if (!this.#last || !this.#center || !this.#scene || !this.#viewport) return false;
    const next = { x: this.#center.x - delta.x / this.#last.fit.scale, y: this.#center.y - delta.y / this.#last.fit.scale };
    this.#center = fitCenter(sceneCoverFit(this.#scene, this.#viewport, next), this.#viewport);
    this.#mode = 'free'; this.#returning = null; return true;
  }
  returnToSelf(now: number) {
    this.#mode = 'follow';
    this.#returning = this.#center && this.#last?.canReturn ? { from: { ...this.#center }, at: now } : null;
  }
}
