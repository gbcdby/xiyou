export interface SpriteHitRegion { width: number; height: number; path: string }
interface Run { x: number; y: number; width: number; height: number }

/** 按原始非零alpha的像素并集构造命中区；透明边缘和内部空隙不属于身体。 */
export function spriteHitRegion(rgba: Uint8ClampedArray, width: number, height: number): SpriteHitRegion {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || rgba.length !== width * height * 4) throw new Error('图像命中区需要完整RGBA像素');
  const finished: Run[] = []; let active = new Map<string, Run>();
  for (let y = 0; y < height; y++) {
    const next = new Map<string, Run>(); let x = 0;
    while (x < width) {
      if (rgba[(y * width + x) * 4 + 3] === 0) { x++; continue; }
      const start = x;
      while (x < width && rgba[(y * width + x) * 4 + 3] !== 0) x++;
      const key = `${start}:${x}`, prior = active.get(key);
      if (prior) { prior.height++; next.set(key, prior); active.delete(key); }
      else next.set(key, { x: start, y, width: x - start, height: 1 });
    }
    finished.push(...active.values()); active = next;
  }
  finished.push(...active.values());
  return { width, height, path: finished.map(run => `M${run.x} ${run.y}h${run.width}v${run.height}h-${run.width}z`).join('') };
}
