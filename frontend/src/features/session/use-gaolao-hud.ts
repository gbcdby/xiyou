import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { placeHudCards } from '../../domain/gaolao-hud-layout.ts';
import type { HudMapGeometry, HudCameraArea, HudCardRequest } from '../../domain/gaolao-hud-layout.ts';
import type { ScreenRect } from '../../domain/spatial-labels.ts';

/** DOM只提供屏幕尺寸；此处不持有角色身份、章节事实或可写客户端。 */
export function useGaolaoHud(root: Ref<HTMLElement | null>, enabled: ComputedRef<boolean>, kind: ComputedRef<string | null>, hasFollow: ComputedRef<boolean>, road: ComputedRef<boolean>) {
  const mapGeometry = shallowRef<HudMapGeometry>({ viewport: { width: 0, height: 0 }, protectedRegions: [] });
  const measured = shallowRef({ width: 0, height: 0, reserved: [] as ScreenRect[], objectiveBottom: 0, cardHeight: 240, followHeight: 160 });
  let observer: ResizeObserver | null = null; const observed = new Set<Element>(); let frame = 0;
  const fixedSelectors = '.gaolao-chapter-name, .gaolao-party-strip, .spatial-current-objective, .spatial-action-bar, .spatial-tool-dock, .spatial-map-toolbar, .spatial-pending-link, .spatial-map-overflow, .gaolao-scene-page > .notice';
  function measure() {
    frame = 0; const element = root.value; if (!enabled.value || !element) return;
    const outer = element.getBoundingClientRect();
    const rect = (node: Element): ScreenRect => { const b = node.getBoundingClientRect(); return { x: b.x - outer.x, y: b.y - outer.y, width: b.width, height: b.height }; };
    const fixed = [...element.querySelectorAll(fixedSelectors)].filter(node => node.getBoundingClientRect().width > 0);
    const card = element.querySelector('.spatial-sidebar, .spatial-receipts'); const follow = element.querySelector('.spatial-follow-strip');
    const current = new Set<Element>([element, ...fixed, ...(card ? [card] : []), ...(follow ? [follow] : [])]);
    for (const node of current) if (!observed.has(node)) { observed.add(node); observer?.observe(node); }
    for (const node of observed) if (!current.has(node)) { observer?.unobserve(node); observed.delete(node); }
    const objective = element.querySelector('.spatial-current-objective');
    // 短卡不能反过来成为正文的自然高度，否则会在收起/展开之间振荡。
    const contentHeight = card && !card.classList.contains('hud-card-collapsed') ? [...card.children].reduce((sum, child) => sum + child.getBoundingClientRect().height, 0) + 2 : measured.value.cardHeight;
    const followHeight = follow && !follow.classList.contains('hud-card-collapsed') ? Math.max(...[...follow.children].map(child => child.getBoundingClientRect().height), 80) + 38 : measured.value.followHeight;
    const next = { width: outer.width, height: outer.height, reserved: fixed.map(rect), objectiveBottom: objective ? rect(objective).y + rect(objective).height : 110, cardHeight: Math.max(140, contentHeight), followHeight: Math.min(210, followHeight) };
    if (JSON.stringify(next) !== JSON.stringify(measured.value)) measured.value = next;
  }
  function queueMeasure() { if (!frame) frame = requestAnimationFrame(measure); }
  onMounted(() => { observer = new ResizeObserver(queueMeasure); queueMeasure(); });
  onBeforeUnmount(() => { observer?.disconnect(); if (frame) cancelAnimationFrame(frame); });
  watch([enabled, kind, hasFollow, road, root], () => { void nextTick(queueMeasure); }, { flush: 'post', immediate: true });
  const narrow = computed(() => measured.value.width <= 600);
  const cardSize = computed(() => {
    const m = measured.value;
    if (narrow.value) return { width: Math.max(0, m.width - 24), height: Math.max(140, Math.min(230, (m.height - 320) / 2)) };
    const width = kind.value === 'dialogue' ? 560 : kind.value === 'action' ? 260 : 390;
    const height = kind.value === 'dialogue' ? Math.max(160, m.height - 615) : ['action', 'objects', 'receipts'].includes(kind.value || '') ? Math.min(m.cardHeight, m.height - 255) : m.height - 255;
    return { width, height: Math.max(140, height) };
  });
  const bounds = computed<ScreenRect>(() => {
    const m = measured.value; const margin = narrow.value ? 12 : 30;
    const y = narrow.value ? Math.max(130, m.objectiveBottom + 16) : 130;
    return { x: margin, y, width: Math.max(0, m.width - margin * 2), height: Math.max(0, m.height - (narrow.value ? 213 : 125) - y) };
  });
  const panelRequest = computed<HudCardRequest | undefined>(() => {
    if (!enabled.value || !kind.value) return undefined;
    const m = measured.value, size = cardSize.value;
    const preferred = narrow.value ? { x: 12, y: m.height - 213 - size.height } : kind.value === 'dialogue' ? { x: 30, y: 470 } : kind.value === 'receipts' ? { x: 30, y: 132 } : { x: m.width - 30 - size.width, y: kind.value === 'action' && !road.value ? m.height * .47 : road.value && kind.value === 'action' ? 145 : 130 };
    return { bounds: bounds.value, preferred, size, reserved: m.reserved, minHeight: 140 };
  });
  const followRequest = computed<HudCardRequest | undefined>(() => {
    if (!enabled.value || !hasFollow.value) return undefined;
    const m = measured.value, size = { width: Math.min(690, m.width - (narrow.value ? 24 : 60)), height: m.followHeight };
    return { bounds: bounds.value, preferred: { x: (m.width - size.width) / 2, y: m.height - (narrow.value ? 213 : 138) - size.height }, size, reserved: m.reserved, minHeight: 110 };
  });
  // 请求只描述固定屏幕尺寸，不能依赖当前相机回传的几何；避免相机与浮卡互相追逐。
  const placements = computed(() => placeHudCards({ panel: panelRequest.value, follow: followRequest.value, protectedRegions: mapGeometry.value.protectedRegions }));
  const panelPlacement = computed(() => placements.value.panel);
  const followPlacement = computed(() => placements.value.follow);
  const cameraArea = computed<HudCameraArea | undefined>(() => {
    if (!enabled.value || !measured.value.width) return undefined;
    const m = measured.value;
    const cards = { panel: panelRequest.value, follow: followRequest.value };
    // 只排除固定HUD的上/下边；浮卡不是永久占用，理想空域无解时须换边或收短。
    const margin = narrow.value ? 28 : 30, top = Math.max(132, m.objectiveBottom + 16);
    const fallback = { x: margin, y: top, width: Math.max(80, m.width - margin * 2), height: Math.max(120, m.height - (narrow.value ? 224 : 141) - top) };
    if (narrow.value) {
      const y = m.objectiveBottom + 16;
      const bottom = kind.value ? m.height - 213 - cardSize.value.height - 16 : hasFollow.value ? m.height - 213 - m.followHeight - 16 : m.height - 224;
      return { x: 28, y, width: Math.max(80, m.width - 56), height: Math.max(120, bottom - y), fallback, reserved: m.reserved, ...cards };
    }
    const x = kind.value === 'dialogue' ? 620 : 360;
    const right = kind.value && kind.value !== 'dialogue' ? m.width - cardSize.value.width - 46 : m.width - 46;
    const bottom = hasFollow.value ? m.height - 154 - m.followHeight : m.height - 141;
    return { x, y: 132, width: Math.max(200, right - x), height: Math.max(160, bottom - 132), fallback, reserved: m.reserved, ...cards };
  });
  const style = (placement: typeof panelPlacement.value) => placement.rect ? {
    left: placement.rect.x + 'px', top: placement.rect.y + 'px', width: placement.rect.width + 'px', height: placement.rect.height + 'px', maxHeight: placement.rect.height + 'px', right: 'auto', bottom: 'auto', transform: 'none', visibility: 'visible' as const,
  } : { visibility: 'hidden' as const };
  return { mapGeometry, panelPlacement, followPlacement, panelStyle: computed(() => enabled.value ? style(panelPlacement.value) : {}), followStyle: computed(() => enabled.value ? style(followPlacement.value) : {}), cameraArea, measure: queueMeasure };
}
