import type { Position } from '../../../game/spatial-types.ts';

export interface ScreenRect { x: number; y: number; width: number; height: number }
export interface ScreenSize { width: number; height: number }
export interface SpatialLabelInput {
  key: string;
  label: string;
  point: Position;
  footprint: ScreenRect;
  selectable: boolean;
  priority: number;
}
export interface SpatialLabel extends SpatialLabelInput, ScreenRect { lineX: number; lineY: number }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const overlap = (a: ScreenRect, b: ScreenRect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const expand = (rect: ScreenRect, by: number): ScreenRect => ({ x: rect.x - by, y: rect.y - by, width: rect.width + by * 2, height: rect.height + by * 2 });

/** 与 SVG 的 xMidYMid meet 同一映射；文字保留 CSS px，世界坐标不因标签避让而改变。 */
export function screenPosition(position: Position, view: ScreenRect, viewport: ScreenSize) {
  const scale = Math.min(viewport.width / view.width, viewport.height / view.height);
  return { x: (viewport.width - view.width * scale) / 2 + (position.x - view.x) * scale, y: (viewport.height - view.height * scale) / 2 + (position.y - view.y) * scale, scale };
}

/** 按本人/选择优先，在屏幕空域排布；容不下的对象仍保留地图标记及独立对象列表入口。 */
export function layoutSpatialLabels(inputs: SpatialLabelInput[], viewport: ScreenSize): { labels: SpatialLabel[]; omitted: number } {
  if (viewport.width < 64 || viewport.height < 60) return { labels: [], omitted: inputs.length };
  const margin = 8;
  const bodies = inputs.map(input => expand(input.footprint, 8));
  const labels: SpatialLabel[] = [];
  for (const input of [...inputs].sort((a, b) => a.priority - b.priority)) {
    const width = Math.min(viewport.width - margin * 2, Math.max(64, Math.min(180, [...input.label].length * 14 + 22)));
    const height = input.selectable ? 44 : 30;
    const candidates: ScreenRect[] = [];
    const add = (x: number, y: number) => candidates.push({ x: clamp(x, margin, viewport.width - margin - width), y: clamp(y, margin, viewport.height - margin - height), width, height });
    const head = input.footprint.y - height - 14;
    add(input.point.x - width / 2, head);
    add(input.point.x - width / 2, input.footprint.y + input.footprint.height + 14);
    add(input.footprint.x + input.footprint.width + 14, input.point.y - height / 2);
    add(input.footprint.x - width - 14, input.point.y - height / 2);
    // 有限的整屏候选使边缘/密集对象有可见退路，不在每帧进行像素级全图搜索。
    for (let y = margin; y <= viewport.height - margin - height; y += height + 8) {
      add(input.point.x - width / 2, y);
      for (let x = margin; x <= viewport.width - margin - width; x += width + 8) add(x, y);
      add(viewport.width - margin - width, y);
    }
    const distance = (rect: ScreenRect) => Math.hypot(rect.x + width / 2 - input.point.x, rect.y + height - input.footprint.y);
    candidates.sort((a, b) => distance(a) - distance(b));
    const placed = candidates.find(candidate => !bodies.some(body => overlap(candidate, body)) && !labels.some(label => overlap(expand(candidate, 3), expand(label, 3))));
    if (placed) labels.push({ ...input, ...placed, lineX: clamp(input.point.x, placed.x + 8, placed.x + width - 8), lineY: clamp(input.point.y, placed.y, placed.y + height) });
  }
  return { labels, omitted: inputs.length - labels.length };
}
