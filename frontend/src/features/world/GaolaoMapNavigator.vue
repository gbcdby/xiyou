<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { EntityViewV2, Position, PublicMapScene, PublicScene, SelfViewV2 } from '../../../../game/spatial-types.ts';
import { mapFit, mapPoint, navigationScene, navigationScenes } from '../../domain/gaolao-map-overview.ts';
import AppIcon from '../../components/AppIcon.vue';

const props = withDefaults(defineProps<{ scene: PublicScene | null; catalog: PublicMapScene[]; self: SelfViewV2; people: EntityViewV2[]; disabled: boolean; compact?: boolean; panelOpen?: boolean; expanded?: boolean }>(), { expanded: undefined });
const emit = defineEmits<{ move: [position: Position]; navigate: [sceneId: string, position: Position]; open: []; 'update:expanded': [value: boolean] }>();
const mode = ref<'current' | 'all'>('current');
const localExpanded = ref(false);
const expanded = computed(() => props.expanded ?? localExpanded.value);
// 窄屏阅读区临时遮住地图，不覆盖玩家保存的开合偏好。
const visibleExpanded = computed(() => expanded.value && (!props.compact || !props.panelOpen));
const selectedSceneId = ref('');
const selectedAnchorId = ref('');
const destination = ref<Position | null>(null);
const notice = ref('');
const canvas = ref<HTMLCanvasElement | null>(null);
const mapRoot = ref<HTMLElement | null>(null);
const size = ref({ width: 256, height: 176 });
let resize: ResizeObserver | null = null;
let frame = 0;
const scenes = computed(() => navigationScenes(props.scene, props.catalog));
const selectedScene = computed(() => mode.value === 'current' ? navigationScene(props.scene, props.catalog) : scenes.value.find(scene => scene.sceneId === selectedSceneId.value) || null);
const showingOverview = computed(() => mode.value === 'all' && !selectedScene.value);
const canvasVisible = computed(() => !props.compact || visibleExpanded.value);
const destinationControlsVisible = computed(() => expanded.value || mode.value === 'all');
function setExpanded(value: boolean) { localExpanded.value = value; emit('update:expanded', value); }
function toggleMap() { const next = !visibleExpanded.value; setExpanded(next); if (next) emit('open'); }
function closeMap() {
  setExpanded(false);
  if (!props.compact) changeMode('current');
  mapRoot.value?.querySelector<HTMLButtonElement>('header button')?.focus({ preventScroll: true });
}
function changeMode(next: 'current' | 'all') { mode.value = next; selectedSceneId.value = ''; selectedAnchorId.value = ''; destination.value = null; notice.value = ''; if (next === 'all') emit('open'); }
function selectScene(id: string) { selectedSceneId.value = id; selectedAnchorId.value = ''; destination.value = null; notice.value = ''; }
function selectAnchor(event: Event) {
  selectedAnchorId.value = (event.target as HTMLSelectElement).value;
  const anchor = selectedScene.value?.anchors.find(value => value.anchorId === selectedAnchorId.value);
  destination.value = anchor ? { ...anchor.position } : null;
}
function overviewBoxes() {
  const gap = 8, height = Math.max(40, (size.value.height - gap * (scenes.value.length + 1)) / Math.max(1, scenes.value.length));
  return scenes.value.map((scene, index) => ({ scene, x: gap, y: gap + index * (height + gap), width: size.value.width - gap * 2, height }));
}
function terrain(context: CanvasRenderingContext2D, scene: PublicMapScene, rect: { x: number; y: number; width: number; height: number }) {
  const fit = mapFit(scene, rect);
  const point = (value: Position) => ({ x: rect.x + fit.x + value.x * fit.scale, y: rect.y + fit.y + value.y * fit.scale });
  context.fillStyle = '#e8dfcb'; context.fillRect(rect.x + fit.x, rect.y + fit.y, scene.width * fit.scale, scene.height * fit.scale);
  context.strokeStyle = '#c1b393'; context.lineWidth = 1; context.strokeRect(rect.x + fit.x, rect.y + fit.y, scene.width * fit.scale, scene.height * fit.scale);
  for (const area of scene.walkableAreas) {
    if (!area.polygon.length) continue;
    context.beginPath(); area.polygon.forEach((value, i) => { const p = point(value); if (i === 0) context.moveTo(p.x, p.y); else context.lineTo(p.x, p.y); }); context.closePath();
    context.fillStyle = '#f7f2e7'; context.fill(); context.strokeStyle = '#b8bca1'; context.stroke();
  }
  for (const anchor of scene.anchors) { const p = point(anchor.position); context.beginPath(); context.arc(p.x, p.y, 1.7, 0, Math.PI * 2); context.fillStyle = '#887951'; context.fill(); }
  for (const exit of scene.exits) {
    const anchor = scene.anchors.find(value => value.anchorId === exit.anchorId); if (!anchor) continue;
    const p = point(anchor.position); context.fillStyle = '#477565'; context.fillRect(p.x - 3, p.y - 3, 6, 6);
  }
  return point;
}
function draw() {
  frame = 0; const element = canvas.value, context = element?.getContext('2d'); if (!element || !context) return;
  const rect = element.getBoundingClientRect(); if (!rect.width || !rect.height) return;
  const dpr = window.devicePixelRatio || 1;
  size.value = { width: rect.width, height: rect.height };
  const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
  if (element.width !== width || element.height !== height) { element.width = width; element.height = height; }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = '#f5efdf'; context.fillRect(0, 0, rect.width, rect.height);
  if (showingOverview.value) {
    const boxes = overviewBoxes();
    context.strokeStyle = '#8f9d7b'; context.lineWidth = 1.5;
    for (const box of boxes) for (const exit of box.scene.exits) {
      const target = boxes.find(value => value.scene.sceneId === exit.destinationSceneId);
      if (target && box.y < target.y) { context.beginPath(); context.moveTo(rect.width / 2, box.y + box.height); context.lineTo(rect.width / 2, target.y); context.stroke(); }
    }
    for (const box of boxes) {
      context.fillStyle = box.scene.sceneId === props.self.sceneId ? '#e9eedf' : '#faf6ec'; context.fillRect(box.x, box.y, box.width, box.height);
      context.strokeStyle = box.scene.sceneId === props.self.sceneId ? '#477565' : '#c4b798'; context.strokeRect(box.x, box.y, box.width, box.height);
      terrain(context, box.scene, { x: box.x + box.width * .52, y: box.y + 3, width: box.width * .46, height: box.height - 6 });
      context.fillStyle = '#383a2d'; context.font = '14px serif';
      const label = box.scene.name.length > 9 ? box.scene.name.slice(0, 9) + '…' : box.scene.name;
      context.fillText(label, box.x + 10, box.y + box.height / 2 - 3, box.width * .48);
      context.fillStyle = '#65725a'; context.font = '12px sans-serif'; context.fillText(box.scene.sceneId === props.self.sceneId ? '你在这里' : '点选查看', box.x + 10, box.y + box.height / 2 + 17);
    }
    return;
  }
  const scene = selectedScene.value; if (!scene) return;
  const point = terrain(context, scene, { x: 0, y: 0, width: rect.width, height: rect.height });
  // 远场只画公开静态目录，不沿用本人所在场景的动态位置。
  if (scene.sceneId === props.self.sceneId) {
    for (const person of props.people) if (person.sceneId === scene.sceneId && person.position && person.entityRef !== props.self.entityRef) {
      const p = point(person.position); context.beginPath(); context.arc(p.x, p.y, 2.5, 0, Math.PI * 2); context.fillStyle = '#8e7963'; context.fill();
    }
    if (props.self.position) { const p = point(props.self.position); context.beginPath(); context.arc(p.x, p.y, 4, 0, Math.PI * 2); context.fillStyle = '#356b58'; context.fill(); context.strokeStyle = '#fffdf6'; context.lineWidth = 1.5; context.stroke(); }
  }
  if (destination.value && mode.value === 'all') { const p = point(destination.value); context.strokeStyle = '#a04d3e'; context.lineWidth = 2; context.beginPath(); context.arc(p.x, p.y, 5, 0, Math.PI * 2); context.stroke(); }
}
function scheduleDraw() { if (!frame) frame = requestAnimationFrame(draw); }
function clickMap(event: MouseEvent) {
  const element = canvas.value; if (!element) return;
  const rect = element.getBoundingClientRect(), point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  if (showingOverview.value) {
    const box = overviewBoxes().find(box => point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height);
    if (box) selectScene(box.scene.sceneId);
    return;
  }
  const scene = selectedScene.value; if (!scene) return;
  const position = mapPoint(scene, size.value, point); if (!position) return;
  if (mode.value === 'current') { if (!props.disabled) { selectedAnchorId.value = ''; destination.value = null; emit('move', position); notice.value = '已选择路线，等待实际行走。'; } }
  else { destination.value = position; selectedAnchorId.value = ''; notice.value = '地点已选中，点击前往后才开始行走。'; }
}
function travel() {
  const scene = selectedScene.value; if (!scene || !destination.value || props.disabled) return;
  if (mode.value === 'current' || (scene.sceneId === props.self.sceneId && !props.catalog.some(value => value.sceneId === scene.sceneId))) emit('move', destination.value);
  else emit('navigate', scene.sceneId, destination.value);
  notice.value = '已提交前往请求，仍须按实际通路行走。';
}
watch([mode, selectedSceneId, destination, () => props.scene, () => props.catalog, () => props.self, () => props.people, canvasVisible], scheduleDraw, { deep: true, flush: 'post' });
watch(() => props.self.sceneId, () => { selectedAnchorId.value = ''; destination.value = null; notice.value = ''; });
watch(() => props.catalog, () => { if (selectedSceneId.value && !scenes.value.some(scene => scene.sceneId === selectedSceneId.value)) selectScene(''); });
onMounted(() => { resize = new ResizeObserver(scheduleDraw); if (canvas.value) resize.observe(canvas.value); window.addEventListener('resize', scheduleDraw); scheduleDraw(); });
watch(canvas, (element, previous) => { if (previous) resize?.unobserve(previous); if (element) { resize?.observe(element); scheduleDraw(); } });
onBeforeUnmount(() => { resize?.disconnect(); window.removeEventListener('resize', scheduleDraw); if (frame) cancelAnimationFrame(frame); });
</script>

<template>
  <section ref="mapRoot" class="gaolao-map-navigator" :class="{ 'is-compact': compact, 'is-expanded': compact ? visibleExpanded : destinationControlsVisible }" aria-label="场景地图" data-keyboard-scope="map" @keydown.esc.prevent.stop="closeMap">
    <header>
      <button v-if="compact" type="button" class="map-toggle" :aria-expanded="visibleExpanded" :aria-label="visibleExpanded ? '收起地图' : '展开地图'" aria-controls="gaolao-map-content" @click="toggleMap"><span class="map-caption"><AppIcon name="compass" :size="18" /><span>地图</span></span><AppIcon :name="visibleExpanded ? 'chevron-up' : 'chevron-down'" :size="16" /></button>
      <template v-else><h2><AppIcon name="compass" :size="18" />地图</h2><div class="map-mode" role="group" aria-label="地图范围"><button :aria-pressed="mode === 'current'" @click="changeMode('current')">当前</button><button :aria-pressed="mode === 'all'" @click="changeMode('all')">全部</button></div></template>
    </header>
    <div v-if="canvasVisible" id="gaolao-map-content" class="map-content">
      <div v-if="compact" class="map-mode" role="group" aria-label="地图范围"><button :aria-pressed="mode === 'current'" @click="changeMode('current')">当前</button><button :aria-pressed="mode === 'all'" @click="changeMode('all')">全部</button></div>
      <p class="map-place">{{ showingOverview ? '本章全部场景' : selectedScene?.name || '等待场景同步' }}</p>
      <canvas ref="canvas" data-testid="gaolao-minimap" :data-map-mode="mode" :data-scene-id="selectedScene?.sceneId || ''" role="img" :aria-label="showingOverview ? '全部公开场景与出口连接，可用下方选择框查看' : '地点示意图，可点击选点，也可用下方地点选择框'" @click="clickMap" />
      <label v-if="mode === 'all'" class="map-select"><span>查看场景</span><select aria-label="查看地图场景" :value="selectedSceneId" @change="selectScene(($event.target as HTMLSelectElement).value)"><option value="">全部场景概览</option><option v-for="scene in scenes" :key="scene.sceneId" :value="scene.sceneId">{{ scene.name }}</option></select></label>
      <button v-if="!compact && mode === 'current'" class="text-button map-destinations-toggle" :aria-expanded="expanded" aria-controls="gaolao-map-destination" @click="toggleMap">{{ expanded ? '收起地点' : '选择地点' }}<AppIcon :name="expanded ? 'x' : 'arrow'" :size="14" /></button>
      <label v-if="selectedScene && destinationControlsVisible" id="gaolao-map-destination" class="map-select"><span>{{ mode === 'current' ? '或选择地点' : '选择目的地' }}</span><select aria-label="地图目的地" :value="selectedAnchorId" @change="selectAnchor"><option value="">{{ destination ? '地图上的位置' : '选择公开地点' }}</option><option v-for="anchor in selectedScene.anchors" :key="anchor.anchorId" :value="anchor.anchorId">{{ anchor.label }}</option></select></label>
      <button v-if="destination && selectedScene" class="secondary-button map-travel" :disabled="disabled" @click="travel">{{ mode === 'all' && selectedScene.sceneId !== self.sceneId ? '沿出口前往' : '前往所选地点' }}</button>
      <p class="map-hint" role="status">{{ notice || (mode === 'current' ? '点地图行走 · 绿点是你' : '先查看场景与地点，再确认前往') }}</p>
    </div>
  </section>
</template>

<style scoped>
.gaolao-map-navigator { display: flex; flex-direction: column; color: var(--hud-ink, #332c23); background: var(--hud-paper, #f8f2e5); border: 1px solid var(--hud-line, #c9b996); border-radius: 8px; overflow: hidden; box-shadow: 0 3px 18px #3e32191a; }
header { flex: none; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px; padding: 3px 9px; border-bottom: 1px solid #ded4bd; }
h2 { display: flex; align-items: center; gap: 6px; margin: 0; font: 600 17px var(--serif); white-space: nowrap; }
.is-compact:not(.is-expanded) { align-self: flex-end; width: max-content; min-width: 104px; max-width: 100%; }
.is-compact header { padding: 0; border-bottom: 0; }
.map-toggle { display: flex; align-items: center; justify-content: space-between; gap: 14px; width: 100%; min-height: 44px; margin: 0; padding: 8px 12px; border: 0; border-radius: 7px; color: #315f4e; background: transparent; font-size: 15px; text-align: left; cursor: pointer; }
.map-toggle:hover { background: #e9eddf; }
.map-caption { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
.is-compact .map-content { padding-top: 8px; border-top: 1px solid #ded4bd; }
.map-mode { display: flex; gap: 3px; }
.map-mode button { flex: none; min-height: 44px; min-width: 44px; padding: 5px 6px; background: transparent; border: 1px solid transparent; border-radius: 4px; font-size: 13px; color: #665c4b; white-space: nowrap; }
.map-mode button[aria-pressed="true"] { color: #315f4e; border-color: #a7b39a; background: #e9eddf; }
.map-content { min-height: 0; padding: 0 10px 8px; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.map-place { margin: 8px 0 5px; color: #665c4b; font-size: 13px; }
canvas { display: block; width: 100%; height: 112px; border-radius: 3px; cursor: crosshair; touch-action: manipulation; }
.is-expanded canvas { height: 160px; }
.map-destinations-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 44px; padding: 4px 0; color: #456550; font-size: 13px; }
.map-select { display: grid; gap: 4px; margin-top: 7px; font-size: 13px; color: #665c4b; }
.map-select select { width: 100%; min-height: 44px; padding: 6px 8px; font-size: 14px; background: #fffaf0; border: 1px solid #c9b996; border-radius: 4px; color: #383a2d; }
.map-travel { width: 100%; min-height: 44px; margin-top: 7px; font-size: 14px; }
.map-hint { margin: 7px 0 0; min-height: 18px; color: #68715c; font-size: 12px; line-height: 1.5; }
@media (max-width: 900px) {
  .gaolao-map-navigator.is-expanded { display: flex; flex-direction: column; }
  header { flex: none; border-bottom: 0; padding: 4px 10px; min-height: 40px; }
  .gaolao-map-navigator:not(.is-compact):not(.is-expanded) header h2 { display: none; }
  .map-content { min-height: 0; border-top: 1px solid #ded4bd; max-height: calc(100dvh - 230px); overflow: auto; scroll-padding-block: 8px; }
  canvas { height: 176px; }
  .map-mode button { min-height: 44px; }
}
</style>
