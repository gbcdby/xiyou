import type { Facing } from '../../../game/spatial-types.ts';
import { spriteForAppearance, spriteResourcePaths, type SpriteFrame } from '../domain/gaolao-art.ts';
interface Entry { image: HTMLImageElement; status: 'loading' | 'ready' | 'failed'; attempt: number; alpha?: Uint8Array }

/** 图片只按可信目录URL创建和解码；同角色多个实例以及每个RAF共享同一份资源。 */
export class CanvasAssets {
  #entries = new Map<string, Entry>(); #listeners = new Set<() => void>(); #create: () => HTMLImageElement;
  constructor(create: () => HTMLImageElement = () => new Image()) { this.#create = create; }
  subscribe(listener: () => void) { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; }
  #notify() { for (const listener of this.#listeners) listener(); }
  ensure(paths: Iterable<string>) { for (const path of new Set(paths)) if (!this.#entries.has(path)) this.#load(path, 0); }
  #load(path: string, attempt: number) {
    const image = this.#create(), entry: Entry = { image, status: 'loading', attempt }; this.#entries.set(path, entry);
    const failed = () => { if (this.#entries.get(path) !== entry) return; entry.status = 'failed'; this.#notify(); };
    image.onload = async () => {
      try {
        await image.decode();
        if (this.#entries.get(path) !== entry) return;
        if (!image.naturalWidth || !image.naturalHeight) { failed(); return; }
        entry.status = 'ready'; this.#notify();
      } catch { failed(); }
    };
    image.onerror = failed; image.src = attempt ? `${path}?retry=${attempt}` : path;
  }
  retry(paths: Iterable<string>) { for (const path of new Set(paths)) { const entry = this.#entries.get(path); if (entry?.status === 'failed') this.#load(path, entry.attempt + 1); } }
  image(path: string): HTMLImageElement | null { const entry = this.#entries.get(path); return entry?.status === 'ready' ? entry.image : null; }
  ready(paths: Iterable<string>): boolean { return [...paths].every(path => this.#entries.get(path)?.status === 'ready'); }
  failed(paths: Iterable<string>): string[] { return [...paths].filter(path => this.#entries.get(path)?.status === 'failed'); }
  resources(paths: Iterable<string>) { return [...new Set(paths)].map(file => { const entry = this.#entries.get(file); return { file, source: entry?.image.src ?? file, status: entry?.status ?? 'loading', width: entry?.image.naturalWidth ?? 0, height: entry?.image.naturalHeight ?? 0 }; }); }
  actorFrame(appearanceId: string | undefined, facing: Facing, moving: boolean, distance: number, reducedMotion: boolean): SpriteFrame | null {
    const paths = spriteResourcePaths(appearanceId);
    // 整套走步未ready时不按帧号轮流切换角色与占位。
    const frame = this.ready(paths) ? spriteForAppearance(appearanceId, facing, moving, distance, reducedMotion) : null;
    if (frame && this.image(frame.href)) return frame;
    const idle = spriteForAppearance(appearanceId, facing, false, 0, true);
    return idle && this.image(idle.href) ? idle : null;
  }
  opaqueAt(path: string, x: number, y: number): boolean {
    const entry = this.#entries.get(path), image = this.image(path);
    if (!entry || !image || x < 0 || y < 0 || x >= image.naturalWidth || y >= image.naturalHeight) return false;
    if (!entry.alpha) {
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) return false;
      context.drawImage(image, 0, 0); const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      entry.alpha = new Uint8Array(canvas.width * canvas.height);
      for (let index = 0; index < entry.alpha.length; index++) entry.alpha[index] = rgba[index * 4 + 3];
    }
    return entry.alpha[Math.floor(y) * image.naturalWidth + Math.floor(x)] > 0;
  }
}
export const sharedCanvasAssets = new CanvasAssets();
