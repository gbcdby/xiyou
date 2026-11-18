interface Bounds { x: number; y: number; width: number; height: number }
interface ObjectTransform { dpr: number; fit: { x: number; y: number; scale: number }; position: { x: number; y: number } }
interface Entry { image: HTMLImageElement; key: string; tile: HTMLCanvasElement; left: number; top: number; pixels: number }
const maxEntries = 32, maxPixels = 1_048_576, maxTilePixels = 262_144, maxScratchPixels = 4_194_304;
const defaultFormat = (context: CanvasRenderingContext2D) => {
  // 当前 DOM 类型库尚未声明该浏览器返回项；缺少实际格式信息时保守回退。
  const value = context.getContextAttributes() as CanvasRenderingContext2DSettings & { colorType?: string };
  return value.alpha === true && value.colorSpace === 'srgb' && value.colorType === 'unorm8'
    && value.desynchronized === false && value.willReadFrequently === false;
};
const release = (canvas: HTMLCanvasElement) => { canvas.width = 0; canvas.height = 0; };

/** 只缓存当前物件原图的设备像素缩图；选择、资源资格和命中仍由原 renderer 决定。 */
export class ObjectRasterCache {
  #entries: Entry[] = []; #pixels = 0; #disabled = false; #create: () => HTMLCanvasElement;
  #scratch: HTMLCanvasElement | undefined; #scratchContext: CanvasRenderingContext2D | undefined;
  #backingWidth: number | undefined; #backingHeight: number | undefined;
  constructor(create: () => HTMLCanvasElement = () => document.createElement('canvas')) { this.#create = create; }
  #release() {
    for (const entry of this.#entries) release(entry.tile);
    if (this.#scratch) release(this.#scratch);
    this.#entries = []; this.#pixels = 0; this.#scratch = undefined; this.#scratchContext = undefined;
  }
  clear() {
    this.#release(); this.#backingWidth = undefined; this.#backingHeight = undefined; this.#disabled = false;
  }
  #disable() {
    // 保留失败代的 backing 身份，避免下一帧把同代误判为 resize 而重试分配。
    this.#release(); this.#disabled = true;
  }
  draw(context: CanvasRenderingContext2D, image: HTMLImageElement, bounds: Bounds, transform: ObjectTransform): boolean {
    const backingWidth = context.canvas.width, backingHeight = context.canvas.height;
    if (!Object.is(backingWidth, this.#backingWidth) || !Object.is(backingHeight, this.#backingHeight)) {
      this.clear(); this.#backingWidth = backingWidth; this.#backingHeight = backingHeight;
    }
    if (this.#disabled) return false;
    if (![backingWidth, backingHeight, backingWidth * backingHeight].every(Number.isSafeInteger)
      || backingWidth <= 0 || backingHeight <= 0 || backingWidth * backingHeight > maxScratchPixels) return false;
    let matrix: DOMMatrix, key: string, left: number, top: number, width: number, height: number;
    let sequence: [number, number, number, number, number, number];
    let sx: number, sy: number, sw: number, sh: number, dx: number, dy: number;
    try {
      if (!defaultFormat(context) || context.globalAlpha !== 1 || context.globalCompositeOperation !== 'source-over'
        || context.filter !== 'none' || context.shadowColor !== 'rgba(0, 0, 0, 0)'
        || context.shadowBlur !== 0 || context.shadowOffsetX !== 0 || context.shadowOffsetY !== 0
        || !image.complete || !image.naturalWidth || !image.naturalHeight) return false;
      sequence = [transform.dpr, transform.fit.x, transform.fit.y, transform.fit.scale, transform.position.x, transform.position.y];
      if (!sequence.every(Number.isFinite) || sequence[0] <= 0 || sequence[3] <= 0) return false;
      matrix = context.getTransform();
      const numbers = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f, bounds.x, bounds.y, bounds.width, bounds.height];
      if (!numbers.every(Number.isFinite) || matrix.b !== 0 || matrix.c !== 0 || matrix.a <= 0 || matrix.d <= 0 || bounds.width <= 0 || bounds.height <= 0) return false;
      left = Math.floor(matrix.a * bounds.x + matrix.e) - 2; top = Math.floor(matrix.d * bounds.y + matrix.f) - 2;
      width = Math.ceil(matrix.a * (bounds.x + bounds.width) + matrix.e) + 2 - left;
      height = Math.ceil(matrix.d * (bounds.y + bounds.height) + matrix.f) + 2 - top;
      if (![left, top, width, height].every(Number.isSafeInteger) || width <= 0 || height <= 0 || width * height > maxTilePixels) return false;
      sx = Math.max(0, left); sy = Math.max(0, top);
      const right = Math.min(backingWidth, left + width), bottom = Math.min(backingHeight, top + height);
      sw = right - sx; sh = bottom - sy; dx = sx - left; dy = sy - top;
      if (![left + width, top + height, sx, sy, right, bottom, sw, sh, dx, dy].every(Number.isSafeInteger) || sw <= 0 || sh <= 0) return false;
      key = JSON.stringify([image.src, image.currentSrc, image.naturalWidth, image.naturalHeight, backingWidth, backingHeight,
        ...numbers, context.imageSmoothingEnabled, context.imageSmoothingQuality, ...sequence]);
    } catch { return false; }
    const index = this.#entries.findIndex(entry => entry.image === image && entry.key === key);
    let entry = index < 0 ? undefined : this.#entries.splice(index, 1)[0];
    if (!entry) {
      let tile: HTMLCanvasElement | undefined;
      try {
        if (!this.#scratch) {
          this.#scratch = this.#create(); this.#scratch.width = backingWidth; this.#scratch.height = backingHeight;
          const scratchContext = this.#scratch.getContext('2d');
          if (!scratchContext || !defaultFormat(scratchContext)) throw new Error('物件采样画布格式不兼容。');
          this.#scratchContext = scratchContext;
        }
        const scratchContext = this.#scratchContext!;
        scratchContext.setTransform(1, 0, 0, 1, 0, 0);
        scratchContext.clearRect(0, 0, backingWidth, backingHeight);
        scratchContext.imageSmoothingEnabled = context.imageSmoothingEnabled; scratchContext.imageSmoothingQuality = context.imageSmoothingQuality;
        // 复用调用方真实四步数值与顺序，不能由公开 CTM 反推或折叠重建。
        const [dpr, fitX, fitY, scale, positionX, positionY] = sequence;
        scratchContext.setTransform(dpr, 0, 0, dpr, 0, 0); scratchContext.translate(fitX, fitY);
        scratchContext.scale(scale, scale); scratchContext.translate(positionX, positionY);
        const replay = scratchContext.getTransform();
        if (replay.a !== matrix.a || replay.b !== matrix.b || replay.c !== matrix.c
          || replay.d !== matrix.d || replay.e !== matrix.e || replay.f !== matrix.f) throw new Error('物件采样变换与目标不一致。');
        scratchContext.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height);
        tile = this.#create(); tile.width = width; tile.height = height;
        const target = tile.getContext('2d');
        if (!target || !defaultFormat(target)) throw new Error('物件派生画布格式不兼容。');
        target.imageSmoothingEnabled = context.imageSmoothingEnabled; target.imageSmoothingQuality = context.imageSmoothingQuality;
        target.setTransform(1, 0, 0, 1, 0, 0);
        target.drawImage(this.#scratch, sx, sy, sw, sh, dx, dy, sw, sh);
        entry = { image, key, tile, left, top, pixels: width * height };
      } catch {
        if (tile) release(tile);
        this.#disable(); return false;
      }
      while (this.#entries.length >= maxEntries || this.#pixels + entry.pixels > maxPixels) {
        const oldest = this.#entries.shift()!; this.#pixels -= oldest.pixels; release(oldest.tile);
      }
      this.#pixels += entry.pixels;
    }
    this.#entries.push(entry);
    let saved = false;
    try {
      context.save(); saved = true;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.drawImage(entry.tile, entry.left, entry.top);
      return true;
    } catch {
      this.#disable(); return false;
    } finally { if (saved) context.restore(); }
  }
}
