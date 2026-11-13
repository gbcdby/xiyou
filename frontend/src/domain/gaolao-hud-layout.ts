import type { Position } from '../../../game/spatial-types.ts';
import type { ScreenRect, ScreenSize } from './spatial-labels.ts';

export interface HudMapGeometry { viewport: ScreenSize; protectedRegions: ScreenRect[] }
export interface HudCardPlacement { rect: ScreenRect | null; collapsed: boolean }
export interface HudCardRequest {
  bounds: ScreenRect; preferred: Position; size: ScreenSize;
  reserved: ScreenRect[]; minHeight: number;
}
export interface HudCameraArea extends ScreenRect { fallback?: ScreenRect; reserved?: ScreenRect[]; panel?: HudCardRequest; follow?: HudCardRequest }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const overlaps = (a: ScreenRect, b: ScreenRect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const expand = (r: ScreenRect, by: number): ScreenRect => ({ x: r.x - by, y: r.y - by, width: r.width + by * 2, height: r.height + by * 2 });

/** 只在屏幕空域放卡；身体与名字各保留16px，绝不修改世界位置或授权对象。 */
export function placeHudCard(request: HudCardRequest & { protectedRegions: ScreenRect[] }): HudCardPlacement {
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

/** 正文至少保留原最小高度；必要时收短其滚动区，为随行提示留出真实空域。 */
export function placeHudCards({ panel, follow, protectedRegions }: { panel?: HudCardRequest; follow?: HudCardRequest; protectedRegions: ScreenRect[] }) {
  const empty: HudCardPlacement = { rect: null, collapsed: false };
  const arrange = (request?: HudCardRequest) => {
    const placed = request ? placeHudCard({ ...request, protectedRegions }) : empty;
    const following = follow ? placeHudCard({ ...follow, protectedRegions, reserved: [...follow.reserved, ...(placed.rect ? [placed.rect] : [])] }) : empty;
    return { panel: placed, follow: following };
  };
  const initial = arrange(panel);
  if (!panel || !follow || initial.panel.collapsed || !initial.panel.rect || (initial.follow.rect && !initial.follow.collapsed)) return initial;
  const status = (card: HudCardPlacement) => !card.rect ? 2 : card.collapsed ? 1 : 0;
  let best = initial;
  const height = Math.min(panel.size.height, panel.minHeight);
  // 同一段空域中居中放卡会把剩余高度切碎；同时尝试靠上/靠下，保留原16px间隔。
  for (const y of [panel.bounds.y, panel.bounds.y + panel.bounds.height - height]) {
    const compact = arrange({ ...panel, preferred: { ...panel.preferred, y }, size: { ...panel.size, height } });
    if (!compact.panel.collapsed && compact.panel.rect && status(compact.follow) < status(best.follow)) best = compact;
  }
  return best;
}

/** 当最终姓名排布挤占阅读区时，只补少量场景内候选；由真实几何决定是否换边。 */
export function hudCameraAlternatives(viewport: ScreenSize, scene: ScreenSize, positions: Position[], safeArea?: ScreenRect, preferred?: ScreenRect): ScreenRect[] {
  if (!positions.length || viewport.width <= 0 || viewport.height <= 0) return [];
  const scale = Math.max(viewport.width / scene.width, viewport.height / scene.height);
  const width = viewport.width / scale, height = viewport.height / scale;
  const center = { x: (Math.min(...positions.map(p => p.x)) + Math.max(...positions.map(p => p.x))) / 2, y: (Math.min(...positions.map(p => p.y)) + Math.max(...positions.map(p => p.y))) / 2 };
  // 先在已有合法倍率下换边；直接退回最小覆盖倍率会漏掉身体/姓名旁的可用空域。
  const candidates = preferred ? [.25, .75].map(fraction => ({ ...preferred, x: clamp(center.x - preferred.width * fraction, 0, scene.width - preferred.width) })) : [];
  candidates.push(...[.25, .75, .5].map(fraction => ({ x: clamp(center.x - width * fraction, 0, scene.width - width), y: clamp(center.y - height / 2, 0, scene.height - height), width, height })));
  if (safeArea) for (const fraction of [.25, .75, .5]) {
    // 最小覆盖倍率可能无法向上移动镜头；只增加满足地图四边约束所必需的倍率。
    const x = viewport.width * fraction, y = safeArea.y + Math.min(80, safeArea.height / 2);
    const needed = (pixels: number, units: number) => pixels <= 0 ? 0 : units > 0 ? pixels / units : Infinity;
    const zoom = Math.max(scale, needed(x, center.x), needed(viewport.width - x, scene.width - center.x), needed(y, center.y), needed(viewport.height - y, scene.height - center.y));
    if (!Number.isFinite(zoom) || zoom > 3) continue;
    candidates.push({ x: clamp(center.x - x / zoom, 0, scene.width - viewport.width / zoom), y: clamp(center.y - y / zoom, 0, scene.height - viewport.height / zoom), width: viewport.width / zoom, height: viewport.height / zoom });
  }
  return candidates;
}

/** 地图边界是硬约束；浮卡的理想空域无解时由卡片换边/收短，不能用图外底色腾空。 */
export function cameraForHud({ viewport, scene, safeArea, positions }: { viewport: ScreenSize; scene: ScreenSize; safeArea: HudCameraArea; positions: Position[] }): ScreenRect {
  if (!positions.length || viewport.width <= 0 || viewport.height <= 0) return { x: 0, y: 0, ...scene };
  const xs = positions.map(p => p.x), ys = positions.map(p => p.y);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  const coverScale = Math.max(viewport.width / scene.width, viewport.height / scene.height);
  const lower = (space: number, distance: number) => space <= 0 ? 0 : distance > 0 ? space / distance : Infinity;
  function fit(area: ScreenRect, body: boolean): ScreenRect | null {
    const side = body ? 106 : 1, above = body ? 90 : 0, topGap = body ? 70 : 1, bottomGap = body ? 60 : 1;
    if (area.width <= side * 2 || area.height <= topGap + bottomGap) return null;
    // 直接求连续倍率区间；离散尝试1.5/1.75会漏掉两者之间真实可行的镜头。
    const scale = Math.max(coverScale,
      lower(area.x + side, left), lower(viewport.width - area.x - area.width + side, scene.width - right),
      lower(area.y + topGap, top - above), lower(viewport.height - area.y - area.height + bottomGap, scene.height - bottom));
    const maximum = Math.min(3,
      right > left ? (area.width - side * 2) / (right - left) : Infinity,
      bottom - top + above > 0 ? (area.height - topGap - bottomGap) / (bottom - top + above) : Infinity);
    if (!Number.isFinite(scale) || scale > maximum) return null;
    const width = viewport.width / scale, height = viewport.height / scale;
    const minX = Math.max(0, right - (area.x + area.width - side) / scale);
    const maxX = Math.min(scene.width - width, left - (area.x + side) / scale);
    const minY = Math.max(0, bottom - (area.y + area.height - bottomGap) / scale);
    const maxY = Math.min(scene.height - height, top - above - (area.y + topGap) / scale);
    if (minX > maxX + 1e-8 || minY > maxY + 1e-8) return null;
    const centerX = area.x + area.width / 2, centerY = area.y + area.height / 2 + Math.min(40, area.height * .22);
    return { x: clamp((left + right) / 2 - centerX / scale, minX, Math.max(minX, maxX)), y: clamp((top + bottom) / 2 - centerY / scale, minY, Math.max(minY, maxY)), width, height };
  }
  // 先留理想阅读区；无解时释放浮卡占用，卡片会按最终身体/姓名几何另找空域。
  const preferred = fit(safeArea, true) || (safeArea.fallback && fit(safeArea.fallback, true));
  if (preferred) return preferred;
  const visible = fit(safeArea, false) || fit({ x: 16, y: 16, width: viewport.width - 32, height: viewport.height - 32 }, true);
  if (visible) return visible;
  // 极端视口不能同时框住全部目标时仍保持真实地图；选择和短卡恢复入口不丢失。
  const width = viewport.width / coverScale, height = viewport.height / coverScale;
  return { x: clamp((left + right) / 2 - width / 2, 0, scene.width - width), y: clamp((top + bottom) / 2 - height / 2, 0, scene.height - height), width, height };
}
