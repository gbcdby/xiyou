interface Bounds { x: number; y: number; width: number; height: number }
interface BackgroundTransform { viewport: { width: number; height: number; dpr: number }; fit: { x: number; y: number; scale: number } }
interface Entry { key: string; canvas: HTMLCanvasElement }
interface Pending { key: string; context: CanvasRenderingContext2D; width: number; height: number }
const maxPixels = 4_194_304;
const release = (canvas: HTMLCanvasElement) => { canvas.width = 0; canvas.height = 0; };
const defaultFormat = (context: CanvasRenderingContext2D) => {
  const value = context.getContextAttributes() as CanvasRenderingContext2DSettings & { colorType?: string };
  return value.alpha === true && value.colorSpace === 'srgb' && value.colorType === 'unorm8'
    && value.desynchronized === false && value.willReadFrequently === false;
};

/** 捕获原buffer已完成的paper＋base；不重新采样源图，不替代后续层次或前台提交。 */
export class BackgroundRasterCache {
  #entry: Entry | undefined; #pending: Pending | undefined; #image: HTMLImageElement | undefined;
  #width: number | undefined; #height: number | undefined; #disabledKey: string | undefined;
  #clipBoundaryKnown = true; #create: () => HTMLCanvasElement;
  constructor(create: () => HTMLCanvasElement = () => document.createElement('canvas')) { this.#create = create; }
  #release() { if (this.#entry) release(this.#entry.canvas); this.#entry = undefined; this.#pending = undefined; }
  clear() {
    this.#release(); this.#image = undefined; this.#width = undefined; this.#height = undefined; this.#disabledKey = undefined;
    // 普通资源释放、scope或clearRect不能证明未知clip已被重置。
  }
  contextReset() { this.clear(); this.#clipBoundaryKnown = true; }
  finish(complete: boolean) { this.#pending = undefined; if (!complete) { this.clear(); this.#clipBoundaryKnown = false; } }
  #disable(key: string) { this.#release(); this.#disabledKey = key; }
  begin(context: CanvasRenderingContext2D, image: HTMLImageElement, bounds: Bounds, transform: BackgroundTransform, scene: { width: number; height: number }): boolean {
    const width = context.canvas.width, height = context.canvas.height;
    if (!Object.is(width, this.#width) || !Object.is(height, this.#height)) { this.clear(); this.#width = width; this.#height = height; }
    this.#pending = undefined;
    let key: string;
    try {
      const { viewport, fit } = transform;
      const invalid = () => { this.clear(); return false; };
      if (!this.#clipBoundaryKnown || ![width, height, width * height].every(Number.isSafeInteger)
        || width <= 0 || height <= 0 || width * height > maxPixels) return invalid();
      if (!defaultFormat(context) || context.globalAlpha !== 1 || context.globalCompositeOperation !== 'source-over'
        || context.fillStyle !== '#eee3cb' || context.filter !== 'none' || context.shadowColor !== 'rgba(0, 0, 0, 0)'
        || context.shadowBlur !== 0 || context.shadowOffsetX !== 0 || context.shadowOffsetY !== 0
        || !image.complete || !image.naturalWidth || !image.naturalHeight) return invalid();
      const matrix = context.getTransform();
      const values = [viewport.width, viewport.height, viewport.dpr, fit.x, fit.y, fit.scale, scene.width, scene.height,
        bounds.x, bounds.y, bounds.width, bounds.height, matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
      if (!values.every(Number.isFinite) || viewport.width <= 0 || viewport.height <= 0 || viewport.dpr <= 0
        || fit.scale <= 0 || scene.width <= 0 || scene.height <= 0 || bounds.width <= 0 || bounds.height <= 0
        || matrix.a <= 0 || matrix.d <= 0 || matrix.b !== 0 || matrix.c !== 0 || matrix.e !== 0 || matrix.f !== 0) return invalid();
      const right = matrix.a * viewport.width, bottom = matrix.d * viewport.height;
      if (!Number.isFinite(right) || !Number.isFinite(bottom) || right < width || bottom < height) return invalid();
      key = JSON.stringify([image.src, image.currentSrc, image.naturalWidth, image.naturalHeight, image.complete,
        width, height, ...values, context.imageSmoothingEnabled, context.imageSmoothingQuality]);
      if (this.#image !== image) { this.#release(); this.#disabledKey = undefined; this.#image = image; }
      if (this.#disabledKey === key) return false;
      if (!this.#entry || this.#entry.key !== key) {
        this.#release(); this.#pending = { key, context, width, height }; return false;
      }
    } catch { this.clear(); return false; }
    let saved = false;
    try {
      context.save(); saved = true; context.setTransform(1, 0, 0, 1, 0, 0);
      context.drawImage(this.#entry!.canvas, 0, 0);
      return true;
    } catch (error) { this.#disable(key); throw error; }
    finally { if (saved) context.restore(); }
  }
  capture(context: CanvasRenderingContext2D): void {
    const pending = this.#pending; this.#pending = undefined;
    if (!pending) return;
    let canvas: HTMLCanvasElement | undefined;
    try {
      if (pending.context !== context || context.canvas.width !== pending.width || context.canvas.height !== pending.height) throw new Error('背景捕获目标已改变。');
      const created = this.#create();
      if (created === context.canvas) throw new Error('背景缓存不得与原buffer相同。');
      canvas = created; canvas.width = pending.width; canvas.height = pending.height;
      const sampling = canvas.getContext('2d');
      if (!sampling || !defaultFormat(sampling)) throw new Error('背景捕获格式不兼容。');
      sampling.imageSmoothingEnabled = context.imageSmoothingEnabled; sampling.imageSmoothingQuality = context.imageSmoothingQuality;
      sampling.setTransform(1, 0, 0, 1, 0, 0);
      sampling.drawImage(context.canvas, 0, 0);
      this.#entry = { key: pending.key, canvas };
    } catch {
      if (canvas) release(canvas);
      this.#disable(pending.key); // 原buffer已经画好背景，设施失败不再写目标。
    }
  }
}
