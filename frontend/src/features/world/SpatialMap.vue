<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { Position, SnapshotV2 } from '../../../../game/spatial-types.ts';
import type { HudMapGeometry, HudCameraArea } from '../../domain/gaolao-hud-layout.ts';
import { ConfirmedMotion } from '../../domain/spatial-motion.ts';
import { directionFromKeys, directionKeys } from '../../domain/spatial-direction.ts';
import { SpatialCanvas } from '../../rendering/spatial-canvas.ts';
import { CanvasPresentationOwner, visibleSelf } from '../../rendering/spatial-presentation.ts';
import type { SnapshotSubscription, SpatialSnapshotSource } from '../../domain/spatial-snapshot-source.ts';
import { sharedCanvasAssets } from '../../rendering/canvas-assets.ts';

const props = defineProps<{ snapshot: SnapshotV2; snapshotSource?: SpatialSnapshotSource; disabled: boolean; selected?: string; personLabels?: Record<string, string>; immersive?: boolean; cameraArea?: HudCameraArea; hudNotice?: string; hudRestoreLabel?: string }>();
const emit = defineEmits<{ move: [position: Position]; direction: [vector: Position | null]; select: [reference: string]; stop: []; objects: []; restore: []; geometry: [value: HudMapGeometry]; settled: [value: { viewId: string; epoch: string; movementId: string; sequence: string; position: Position }] }>();
const displaySnapshot = shallowRef<SnapshotV2 | null>(null);
const projection = computed(() => displaySnapshot.value?.projection ?? props.snapshot.projection), scene = computed(() => projection.value.scene);
const canvas = ref<HTMLCanvasElement | null>(null), viewport = ref<HTMLElement | null>(null), failed = ref(false), renderingError = ref('');
const motion = new ConfirmedMotion(), held = new Set<string>();
let painter: SpatialCanvas | null = null, frame = 0, settledKey = '', stopped = false;
let observer: ResizeObserver | null = null, unsubscribe: (() => void) | null = null, reduced: MediaQueryList | null = null;
let presentation: CanvasPresentationOwner | null = null, intersection: IntersectionObserver | null = null, visibility: MutationObserver | null = null;
let snapshotSubscription: SnapshotSubscription | null = null, mounted = false;
let reducedMotion = false, geometryKey = '';

function schedule() { if (!stopped && painter && !frame) frame = requestAnimationFrame(draw); }
function displayInput(): SnapshotV2 | null { return props.snapshotSource ? snapshotSubscription?.current ?? null : displaySnapshot.value; }
function presentationAllowed(snapshot: SnapshotV2) {
  const p = snapshot.projection;
  return !props.disabled && !reducedMotion && p.self.canControl && p.phase === 'Running' && !p.paused;
}
function resetDisplay() {
  presentation?.invalidate(); motion.reset(); displaySnapshot.value = null; settledKey = ''; releaseKeys(); painter?.clear();
}
function receiveSnapshot(snapshot: SnapshotV2 | null) {
  if (!snapshot) { resetDisplay(); return; }
  const now = performance.now();
  presentation?.seal(now, presentationAllowed(snapshot));
  motion.update(snapshot, now); painter?.prepare(snapshot);
  displaySnapshot.value = snapshot; renderingError.value = '';
  if (!snapshot.projection.self.canControl || snapshot.projection.paused || snapshot.projection.phase !== 'Running') releaseKeys();
  schedule();
}
function displayFailed(_error: unknown) {
  snapshotSubscription?.close(); renderingError.value = '场景显示更新失败，请重新载入场景。';
  try { resetDisplay(); } catch { /* 画布清理失败仍已撤销Motion与呈现信用，等待明确重新载入。 */ }
}
function bindSnapshotSource() {
  snapshotSubscription?.close(); snapshotSubscription = null; resetDisplay();
  if (props.snapshotSource) snapshotSubscription = props.snapshotSource.subscribe(receiveSnapshot, displayFailed);
  else receiveSnapshot(props.snapshot);
}
function draw() {
  frame = 0; if (!painter || stopped) return;
  const snapshot = displayInput();
  if (!snapshot?.projection.scene) { presentation?.invalidate(); painter.clear(); failed.value = false; return; }
  // 排队的 rAF 时间可能早于已收到的状态更新；本次绘制与完成判断共用实际执行时钟。
  const now = performance.now();
  const renderer = painter;
  let value;
  try {
    value = renderer.paint(snapshot, motion, now, { selected: props.selected, personLabels: props.personLabels, reducedMotion,
      beforeFrontWrite: () => presentation?.seal(performance.now(), presentationAllowed(snapshot)) });
    if (value) presentation?.painted(value, snapshot, now, performance.now(), painter === renderer && !stopped && presentationAllowed(snapshot));
    else presentation?.invalidate();
  }
  catch (error) { if (props.snapshotSource) displayFailed(error); else { presentation?.invalidate(); renderingError.value = error instanceof Error ? error.message : '场景画布暂不可用。'; } return; }
  failed.value = Boolean(value?.failed.length);
  const p = snapshot.projection;
  const drawn = value?.actors.find(actor => actor.ref === p.self.entityRef);
  const currentFrame = value && canvas.value && painter === renderer && !stopped && displayInput() === snapshot
    && value.sceneId === p.self.sceneId && visibleSelf(canvas.value, value, p.self.entityRef);
  if (p.movement?.status === 'arrived' && p.self.position && currentFrame && drawn && !drawn.moving
    && drawn.position.x === p.self.position.x && drawn.position.y === p.self.position.y
    && (reducedMotion || !motion.hasPendingMotion(p.self.entityRef, now))) {
    const key = `${snapshot.viewId}:${p.self.controlEpoch}:${p.movement.movementId}:${p.movement.movementCommandSeq}`;
    if (settledKey !== key) { settledKey = key; emit('settled', { viewId: snapshot.viewId, epoch: p.self.controlEpoch, movementId: p.movement.movementId, sequence: p.movement.movementCommandSeq, position: p.self.position }); }
  }
  if (!reducedMotion && motion.active(now)) schedule();
}
function resize() {
  presentation?.invalidate();
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
  const snapshot = displayInput();
  if (!snapshot || props.disabled || event.isComposing || event.target !== canvas.value || blockedTarget(event.target)) return;
  if (event.key === 'Escape') { event.preventDefault(); releaseKeys(false); emit('stop'); return; }
  if (event.key === 'Enter') { event.preventDefault(); emit('select', snapshot.projection.self.entityRef); return; }
  if (!directionKeys.has(event.key)) return;
  event.preventDefault(); if (event.repeat || held.has(event.key)) return;
  held.add(event.key); emit('direction', directionFromKeys(held));
}
function keyup(event: KeyboardEvent) {
  if (!held.delete(event.key)) return;
  if (!blockedTarget(event.target)) event.preventDefault();
  emit('direction', directionFromKeys(held));
}
function hidden() { presentation?.invalidate(); if (document.hidden) releaseKeys(); else schedule(); }
function visibilityChanged() { presentation?.invalidate(); schedule(); }
function blur() { releaseKeys(); }
function local(event: MouseEvent): Position | null { const bounds = canvas.value?.getBoundingClientRect(); return bounds ? { x: event.clientX - bounds.left, y: event.clientY - bounds.top } : null; }
function click(event: MouseEvent) {
  if (!displayInput() || props.disabled || !painter || !canvas.value) return;
  canvas.value.focus({ preventScroll: true }); const point = local(event); if (!point) return;
  const reference = painter.hit(point);
  if (reference) { releaseKeys(); emit('select', reference); return; }
  const position = painter.point(point); if (position) { releaseKeys(false); emit('move', { x: Math.round(position.x), y: Math.round(position.y) }); }
}
function pointer(event: MouseEvent) { const point = local(event); if (canvas.value && point) canvas.value.style.cursor = painter?.hit(point) ? 'pointer' : 'crosshair'; }
function retry() { if (props.snapshotSource && renderingError.value) bindSnapshotSource(); painter?.retry(); schedule(); }
function motionPreference() { presentation?.invalidate(); reducedMotion = Boolean(reduced?.matches); schedule(); }
/** 旧页面调用仍可恢复键盘焦点；固定视角不再因此改变取景。 */
function returnToSelf() { canvas.value?.focus({ preventScroll: true }); schedule(); }
/** 出口明确操作只恢复页面中的场景可见范围；到达仍由正常paint守卫确认。 */
function revealScene() {
  const element = canvas.value;
  if (!element?.isConnected) return;
  element.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' });
  schedule();
}
defineExpose({ returnToSelf, revealScene });

watch(() => props.snapshot, snapshot => {
  if (!props.snapshotSource) {
    try { receiveSnapshot(snapshot); } catch (error) { displayFailed(error); }
  }
}, { immediate: true, flush: 'sync' });
watch(() => props.snapshotSource, () => { if (mounted) bindSnapshotSource(); }, { flush: 'sync' });
watch(() => props.disabled, disabled => { if (disabled) { presentation?.invalidate(); releaseKeys(); } else schedule(); }, { flush: 'sync' });
watch([() => props.selected, () => props.personLabels], schedule, { deep: true });
onMounted(() => {
  if (!canvas.value || !viewport.value) return;
  try { painter = new SpatialCanvas(canvas.value); } catch (error) { renderingError.value = error instanceof Error ? error.message : '场景画布暂不可用。'; return; }
  presentation = new CanvasPresentationOwner(motion, canvas.value);
  mounted = true;
  if (props.snapshotSource) bindSnapshotSource();
  else if (displaySnapshot.value) {
    try { painter.prepare(displaySnapshot.value); } catch (error) { displayFailed(error); }
  }
  unsubscribe = sharedCanvasAssets.subscribe(schedule);
  reduced = matchMedia('(prefers-reduced-motion: reduce)'); motionPreference(); reduced.addEventListener('change', motionPreference);
  observer = new ResizeObserver(resize); observer.observe(viewport.value); resize();
  intersection = new IntersectionObserver(visibilityChanged); intersection.observe(canvas.value);
  visibility = new MutationObserver(visibilityChanged);
  for (let node: Element | null = canvas.value; node; node = node.parentElement) visibility.observe(node, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
  window.addEventListener('resize', resize); window.addEventListener('keyup', keyup, true); window.addEventListener('blur', blur); document.addEventListener('visibilitychange', hidden);
  window.addEventListener('scroll', visibilityChanged, true);
});
onBeforeUnmount(() => {
  snapshotSubscription?.close(); snapshotSubscription = null; presentation?.invalidate(); motion.reset(); releaseKeys(); stopped = true; mounted = false; if (frame) cancelAnimationFrame(frame); observer?.disconnect(); intersection?.disconnect(); visibility?.disconnect(); unsubscribe?.(); reduced?.removeEventListener('change', motionPreference);
  window.removeEventListener('resize', resize); window.removeEventListener('keyup', keyup, true); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hidden);
  window.removeEventListener('scroll', visibilityChanged, true);
});
</script>

<template>
  <section class="spatial-map-card" :class="{ 'is-immersive': immersive }" aria-label="授权行走场景">
    <header class="spatial-map-toolbar"><div v-if="!immersive"><strong>{{ scene?.name || '等待场景' }}</strong><span>按住方向键行走，也可点击地面。</span></div><button class="secondary-button" @click="emit('objects')">场景对象</button></header>
    <div ref="viewport" class="spatial-map-viewport">
      <canvas ref="canvas" class="spatial-map" data-testid="spatial-map" data-keyboard-scope="world" tabindex="0" role="application" aria-label="行走场景；方向键组合移动，松键停步，Enter选择本人，Escape取消路线" @click="click" @mousemove="pointer" @keydown="keydown" @blur="blur">场景绘制在画布上，可从场景对象列表选择人物和物件。</canvas>
    </div>
    <p v-if="failed || renderingError" class="spatial-map-note" role="status">{{ renderingError || '部分图像暂未载入，仍可继续操作。' }}<button class="text-button" @click="retry">重新载入场景</button></p>
  </section>
</template>

<style scoped>
.spatial-map-card:not(.is-immersive) { position: relative; }
.spatial-map-card:not(.is-immersive) .spatial-map-toolbar { position: absolute; z-index: 2; top: 12px; left: 12px; right: auto; bottom: auto; transform: none; width: auto; min-height: 44px; border: 0; padding: 0; background: transparent; }
.spatial-map-toolbar button { min-height: 44px; background: #fff8e9ee; }
.spatial-map:focus-visible { outline: 2px solid #365e52; outline-offset: -3px; }
.spatial-map-card:not(.is-immersive) .spatial-map-note { position: absolute; z-index: 2; left: 12px; bottom: 12px; max-width: min(420px, calc(100% - 24px)); border-radius: 8px; }
</style>
