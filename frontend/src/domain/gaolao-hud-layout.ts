import type { Position } from '../../../game/spatial-types.ts';
import type { ScreenRect, ScreenSize } from './spatial-labels.ts';

export interface HudMapGeometry { viewport: ScreenSize; protectedRegions: ScreenRect[] }
export interface HudCardPlacement { rect: ScreenRect | null; collapsed: boolean }
interface CardRequest {
  bounds: ScreenRect; preferred: Position; size: ScreenSize;
  protectedRegions: ScreenRect[]; reserved: ScreenRect[]; minHeight: number;
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const overlaps = (a: ScreenRect, b: ScreenRect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const expand = (r: ScreenRect, by: number): ScreenRect => ({ x: r.x - by, y: r.y - by, width: r.width + by * 2, height: r.height + by * 2 });

/** 只在屏幕空域放卡；身体与名字各保留16px，绝不修改世界位置或授权对象。 */
export function placeHudCard(request: CardRequest): HudCardPlacement {
  const { bounds, preferred, size } = request;
  if (bounds.width <= 0 || bounds.height < 44) return { rect: null, collapsed: true };
  const width = Math.min(size.width, bounds.width), wantedHeight = Math.min(size.height, bounds.height);
  const blocked = [...request.protectedRegions.map(r => expand(r, 16)), ...request.reserved.map(r => expand(r, 8))];
  const xs = [preferred.x, bounds.x, bounds.x + bounds.width - width, bounds.x + (bounds.width - width) / 2];
  for (const r of blocked) xs.push(r.x - width, r.x + r.width);
  function choose(minHeight: number, height: number) {
    const ys = [preferred.y, bounds.y, bounds.y + bounds.height - height];
    for (const r of blocked) ys.push(r.y - height, r.y + r.height);
    let best: ScreenRect | null = null; let score = Infinity;
    for (const rawX of xs) for (const rawY of ys) {
      const x = clamp(rawX, bounds.x, bounds.x + bounds.width - width);
      const y = clamp(rawY, bounds.y, bounds.y + bounds.height - minHeight);
      let available = Math.min(height, bounds.y + bounds.height - y);
      for (const r of blocked) if (x < r.x + r.width && x + width > r.x && r.y >= y) available = Math.min(available, r.y - y);
      if (available < minHeight) continue;
      const candidate = { x, y, width, height: available };
      if (blocked.some(r => overlaps(candidate, r))) continue;
      const cost = (wantedHeight - available) * 3 + Math.hypot(x - preferred.x, y - preferred.y) * .15;
      if (cost < score) { best = candidate; score = cost; }
    }
    return best;
  }
  const normal = choose(Math.min(request.minHeight, wantedHeight), wantedHeight);
  if (normal) return { rect: normal, collapsed: false };
  return { rect: choose(44, Math.min(52, bounds.height)), collapsed: true };
}

/** HUD遮住边缘时只调整相机；优先在原地图内取景，不能挪动角色或伪造地图。 */
export function cameraForHud({ viewport, scene, safeArea, positions }: { viewport: ScreenSize; scene: ScreenSize; safeArea: ScreenRect; positions: Position[] }): ScreenRect {
  if (!positions.length || viewport.width <= 0 || viewport.height <= 0) return { x: 0, y: 0, ...scene };
  const xs = positions.map(p => p.x), ys = positions.map(p => p.y);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  const centerX = safeArea.x + safeArea.width / 2;
  const centerY = safeArea.y + safeArea.height / 2 + Math.min(40, safeArea.height * .22);
  const coverScale = Math.max(viewport.width / scene.width, viewport.height / scene.height);
  // 边缘人物不能靠把整幅地图推到画布外来避让。选择最小可行放大倍率，
  // 并求所有受保护脚底同时满足屏幕空域与真实地图边界的相机区间。
  const scales = [...new Set([coverScale, .9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3])].filter(scale => scale >= coverScale).sort((a, b) => a - b);
  for (const scale of scales) {
    const width = viewport.width / scale, height = viewport.height / scale;
    const minX = Math.max(0, right - (safeArea.x + safeArea.width - 106) / scale);
    const maxX = Math.min(scene.width - width, left - (safeArea.x + 106) / scale);
    const minY = Math.max(0, bottom - (safeArea.y + safeArea.height - 60) / scale);
    const maxY = Math.min(scene.height - height, top - 90 - (safeArea.y + 70) / scale);
    if (minX <= maxX && minY <= maxY) return { x: clamp((left + right) / 2 - centerX / scale, minX, maxX), y: clamp((top + bottom) / 2 - centerY / scale, minY, maxY), width, height };
  }
  // 极窄空域或相距很远的授权目标无法同时在图内框住时，保留短卡/纸色边缘退路。
  const scale = Math.max(.1, Math.min(.9, Math.max(20, safeArea.width - 48) / (right - left + 80), Math.max(20, safeArea.height - 96) / (bottom - top + 90)));
  const width = viewport.width / scale, height = viewport.height / scale;
  let x = (left + right) / 2 - centerX / scale;
  let y = (top + bottom) / 2 - centerY / scale;
  // 只约束实际可见的安全区；被HUD遮住的边缘不能反过来把人物挤回卡片后。
  const minX = -safeArea.x / scale, maxX = scene.width - (safeArea.x + safeArea.width) / scale;
  const minY = -safeArea.y / scale, maxY = scene.height - (safeArea.y + safeArea.height) / scale;
  if (minX <= maxX) x = clamp(x, minX, maxX);
  if (minY <= maxY) y = clamp(y, minY, maxY);
  return { x, y, width, height };
}
