<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Position, SnapshotV2 } from '../../../../game/spatial-types.ts';
import type { HudMapGeometry, HudCameraArea } from '../../domain/gaolao-hud-layout.ts';
import { ConfirmedMotion } from '../../domain/spatial-motion.ts';
import { directionFromKeys, directionKeys } from '../../domain/spatial-direction.ts';
import { SpatialCanvas } from '../../rendering/spatial-canvas.ts';
import { sharedCanvasAssets } from '../../rendering/canvas-assets.ts';

const props = defineProps<{ snapshot: SnapshotV2; disabled: boolean; selected?: string; personLabels?: Record<string, string>; immersive?: boolean; cameraArea?: HudCameraArea; hudNotice?: string; hudRestoreLabel?: string }>();
const emit = defineEmits<{ move: [position: Position]; direction: [vector: Position | null]; select: [reference: string]; stop: []; objects: []; restore: []; geometry: [value: HudMapGeometry]; settled: [value: { viewId: string; epoch: string; movementId: string; sequence: string; position: Position }] }>();
const projection = computed(() => props.snapshot.projection), scene = computed(() => projection.value.scene);
const canvas = ref<HTMLCanvasElement | null>(null), viewport = ref<HTMLElement | null>(null), failed = ref(false), renderingError = ref('');
const motion = new ConfirmedMotion(), held = new Set<string>();
let painter: SpatialCanvas | null = null, frame = 0, settledKey = '', stopped = false;
let observer: ResizeObserver | null = null, unsubscribe: (() => void) | null = null, reduced: MediaQueryList | null = null;
let reducedMotion = false, geometryKey = '';

function schedule() { if (!stopped && painter && !frame) frame = requestAnimationFrame(draw); }
function draw(now: number) {
  frame = 0; if (!painter || stopped) return;
  if (!scene.value) { painter.clear(); failed.value = false; return; }
  const value = painter.paint(props.snapshot, motion, now, { selected: props.selected, personLabels: props.personLabels, reducedMotion });
  failed.value = Boolean(value?.failed.length);
  const p = projection.value;
  if (p.movement?.status === 'arrived' && p.self.position && (reducedMotion || motion.settled(p.self.entityRef, now))) {
    const key = `${props.snapshot.viewId}:${p.self.controlEpoch}:${p.movement.movementId}:${p.movement.movementCommandSeq}`;
    if (settledKey !== key) { settledKey = key; emit('settled', { viewId: props.snapshot.viewId, epoch: p.self.controlEpoch, movementId: p.movement.movementId, sequence: p.movement.movementCommandSeq, position: p.self.position }); }
  }
  if (!reducedMotion && motion.active(now)) schedule();
}
function resize() {
  const size = viewport.value?.getBoundingClientRect(); if (!size || !painter) return;
  painter.resize(size.width, size.height, window.devicePixelRatio || 1);
  const key = `${size.width}:${size.height}`;
  if (key !== geometryKey) { geometryKey = key; emit('geometry', { viewport: { width: size.width, height: size.height }, protectedRegions: [] }); }
  schedule();
}
function releaseKeys(notify = true) { if (!held.size) return; held.clear(); if (notify) emit('direction', null); }
function blockedTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return true;
  if (target.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"]')) return true;
  const scope = target.closest('[data-keyboard-scope]')?.getAttribute('data-keyboard-scope');
  return scope === 'map' || scope === 'panel';
}
function keydown(event: KeyboardEvent) {
  if (props.disabled || event.isComposing || event.target !== canvas.value || blockedTarget(event.target)) return;
  if (event.key === 'Escape') { event.preventDefault(); releaseKeys(false); emit('stop'); return; }
  if (event.key === 'Enter') { event.preventDefault(); emit('select', projection.value.self.entityRef); return; }
  if (!directionKeys.has(event.key)) return;
  event.preventDefault(); if (event.repeat || held.has(event.key)) return;
  held.add(event.key); emit('direction', directionFromKeys(held));
}
function keyup(event: KeyboardEvent) {
  if (!held.delete(event.key)) return;
  if (!blockedTarget(event.target)) event.preventDefault();
  emit('direction', directionFromKeys(held));
}
function hidden() { if (document.hidden) releaseKeys(); }
function blur() { releaseKeys(); }
function local(event: MouseEvent): Position | null { const bounds = canvas.value?.getBoundingClientRect(); return bounds ? { x: event.clientX - bounds.left, y: event.clientY - bounds.top } : null; }
function click(event: MouseEvent) {
  if (props.disabled || !painter || !canvas.value) return;
  canvas.value.focus({ preventScroll: true }); const point = local(event); if (!point) return;
  const reference = painter.hit(point);
  if (reference) { releaseKeys(); emit('select', reference); return; }
  const position = painter.point(point); if (position) { releaseKeys(false); emit('move', { x: Math.round(position.x), y: Math.round(position.y) }); }
}
function pointer(event: MouseEvent) { const point = local(event); if (canvas.value && point) canvas.value.style.cursor = painter?.hit(point) ? 'pointer' : 'crosshair'; }
function retry() { painter?.retry(); schedule(); }
function motionPreference() { reducedMotion = Boolean(reduced?.matches); schedule(); }
/** 旧页面调用仍可恢复键盘焦点；固定视角不再因此改变取景。 */
function returnToSelf() { canvas.value?.focus({ preventScroll: true }); schedule(); }
defineExpose({ returnToSelf });

watch(() => props.snapshot, snapshot => {
  motion.update(snapshot, performance.now()); painter?.prepare(snapshot);
  if (!snapshot.projection.self.canControl || snapshot.projection.paused || snapshot.projection.phase !== 'Running') releaseKeys();
  schedule();
}, { immediate: true, flush: 'sync' });
watch(() => props.disabled, disabled => { if (disabled) releaseKeys(); });
watch([() => props.selected, () => props.personLabels], schedule, { deep: true });
onMounted(() => {
  if (!canvas.value || !viewport.value) return;
  try { painter = new SpatialCanvas(canvas.value); } catch (error) { renderingError.value = error instanceof Error ? error.message : '场景画布暂不可用。'; return; }
  painter.prepare(props.snapshot); unsubscribe = sharedCanvasAssets.subscribe(schedule);
  reduced = matchMedia('(prefers-reduced-motion: reduce)'); motionPreference(); reduced.addEventListener('change', motionPreference);
  observer = new ResizeObserver(resize); observer.observe(viewport.value); resize();
  window.addEventListener('resize', resize); window.addEventListener('keyup', keyup, true); window.addEventListener('blur', blur); document.addEventListener('visibilitychange', hidden);
});
onBeforeUnmount(() => {
  releaseKeys(); stopped = true; if (frame) cancelAnimationFrame(frame); observer?.disconnect(); unsubscribe?.(); reduced?.removeEventListener('change', motionPreference);
  window.removeEventListener('resize', resize); window.removeEventListener('keyup', keyup, true); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hidden);
});
</script>

<template>
  <section class="spatial-map-card" :class="{ 'is-immersive': immersive }" aria-label="授权行走场景">
    <header class="spatial-map-toolbar"><div v-if="!immersive"><strong>{{ scene?.name || '等待场景' }}</strong><span>按住方向键行走，也可点击地面。</span></div><button class="secondary-button" @click="emit('objects')">场景对象</button></header>
    <div ref="viewport" class="spatial-map-viewport">
      <canvas ref="canvas" class="spatial-map" data-testid="spatial-map" data-keyboard-scope="world" tabindex="0" role="application" aria-label="行走场景；方向键组合移动，松键停步，Enter选择本人，Escape取消路线" @click="click" @mousemove="pointer" @keydown="keydown" @blur="blur">场景绘制在画布上，可从场景对象列表选择人物和物件。</canvas>
    </div>
    <p v-if="failed || renderingError" class="spatial-map-note" role="status">{{ renderingError || '部分图像暂未载入，仍可继续操作。' }}<button v-if="failed" class="text-button" @click="retry">重新载入图像</button></p>
  </section>
</template>

<style scoped>
.spatial-map-card:not(.is-immersive) { position: relative; }
.spatial-map-card:not(.is-immersive) .spatial-map-toolbar { position: absolute; z-index: 2; top: 12px; left: 12px; right: auto; bottom: auto; transform: none; width: auto; min-height: 44px; border: 0; padding: 0; background: transparent; }
.spatial-map-toolbar button { min-height: 44px; background: #fff8e9ee; }
.spatial-map:focus-visible { outline: 2px solid #365e52; outline-offset: -3px; }
.spatial-map-card:not(.is-immersive) .spatial-map-note { position: absolute; z-index: 2; left: 12px; bottom: 12px; max-width: min(420px, calc(100% - 24px)); border-radius: 8px; }
</style>
