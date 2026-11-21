<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { Position, SnapshotV2 } from '../../../../game/spatial-types.ts';
import type { HudMapGeometry, HudCameraArea } from '../../domain/gaolao-hud-layout.ts';
import { ConfirmedMotion } from '../../domain/spatial-motion.ts';
import { directionFromKeys, directionKeys } from '../../domain/spatial-direction.ts';
import { SceneCamera, type CameraState } from '../../domain/spatial-camera.ts';
import { ScenePointerGesture } from '../../domain/spatial-camera-gesture.ts';
import { SpatialCanvas, type CanvasSceneFrame } from '../../rendering/spatial-canvas.ts';
import { CanvasPresentationOwner, visibleSelf } from '../../rendering/spatial-presentation.ts';
import type { SnapshotSubscription, SpatialSnapshotSource } from '../../domain/spatial-snapshot-source.ts';
import { sharedCanvasAssets } from '../../rendering/canvas-assets.ts';

const props = defineProps<{ snapshot: SnapshotV2; snapshotSource?: SpatialSnapshotSource; disabled: boolean; selected?: string; personLabels?: Record<string, string>; labelMode?: 'all' | 'contextual'; immersive?: boolean; cameraArea?: HudCameraArea; hudNotice?: string; hudRestoreLabel?: string }>();
const emit = defineEmits<{ move: [position: Position]; direction: [vector: Position | null]; select: [reference: string]; stop: []; objects: []; restore: []; geometry: [value: HudMapGeometry]; 'camera-change': [value: CameraState]; settled: [value: { viewId: string; epoch: string; movementId: string; sequence: string; position: Position }] }>();
const displaySnapshot = shallowRef<SnapshotV2 | null>(null);
const projection = computed(() => displaySnapshot.value?.projection ?? props.snapshot.projection), scene = computed(() => projection.value.scene);
const canvas = ref<HTMLCanvasElement | null>(null), viewport = ref<HTMLElement | null>(null), failed = ref(false), renderingError = ref('');
const motion = new ConfirmedMotion(), held = new Set<string>();
const camera = new SceneCamera(), gesture = new ScenePointerGesture();
const cameraState = ref<CameraState>({ mode: 'follow', canReturn: false }), dragging = ref(false);
let painter: SpatialCanvas | null = null, frame = 0, settledKey = '', stopped = false;
let renderedFrame: CanvasSceneFrame | null = null, capturedPointer: number | null = null, cameraScope = '';
let canvasSize = { width: 1, height: 1 };
let observer: ResizeObserver | null = null, unsubscribe: (() => void) | null = null, reduced: MediaQueryList | null = null;
let presentation: CanvasPresentationOwner | null = null, intersection: IntersectionObserver | null = null, visibility: MutationObserver | null = null;
let snapshotSubscription: SnapshotSubscription | null = null, mounted = false;
let reducedMotion = false, geometryKey = '';
let hovered: string | undefined, hoverPoint: Position | null = null;

function schedule() { if (!stopped && painter && !frame) frame = requestAnimationFrame(draw); }
function setHovered(reference: string | null) {
  const next = reference ?? undefined;
  if (hovered === next) return;
  hovered = next; schedule();
}
function clearHover() { hoverPoint = null; setHovered(null); }
function clearHiddenHover() { if (document.hidden) clearHover(); }
function displayInput(): SnapshotV2 | null { return props.snapshotSource ? snapshotSubscription?.current ?? null : displaySnapshot.value; }
function presentationAllowed(snapshot: SnapshotV2) {
  const p = snapshot.projection;
  return !props.disabled && !reducedMotion && p.self.canControl && p.phase === 'Running' && !p.paused;
}
function publishCamera(value: CameraState) {
  if (cameraState.value.mode === value.mode && cameraState.value.canReturn === value.canReturn) return;
  cameraState.value = { mode: value.mode, canReturn: value.canReturn }; emit('camera-change', { ...cameraState.value });
}
function scopeOf(snapshot: SnapshotV2) {
  const p = snapshot.projection;
  return JSON.stringify([snapshot.sessionId, snapshot.viewId, p.self.entityRef, p.self.controlEpoch, p.self.sceneId, p.mapVersion, p.scene?.width, p.scene?.height]);
}
function resetCamera() {
  clearHover(); cancelGesture(); camera.reset(); cameraScope = ''; renderedFrame = null; publishCamera({ mode: 'follow', canReturn: false });
}
function resetDisplay() {
  presentation?.invalidate(); motion.reset(); displaySnapshot.value = null; settledKey = ''; releaseKeys(); resetCamera(); painter?.clear();
}
function receiveSnapshot(snapshot: SnapshotV2 | null) {
  if (!snapshot) { resetDisplay(); return; }
  const scope = scopeOf(snapshot);
  if (scope !== cameraScope) { resetCamera(); cameraScope = scope; }
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
  if (!snapshot?.projection.scene) { presentation?.invalidate(); renderedFrame = null; painter.clear(); failed.value = false; return; }
  // 排队的 rAF 时间可能早于已收到的状态更新；本次绘制与完成判断共用实际执行时钟。
  const now = performance.now();
  const renderer = painter;
  const p = snapshot.projection, currentScene = p.scene!;
  const selfPosition = reducedMotion ? p.self.position : motion.pose(p.self.entityRef, now)?.position ?? p.self.position;
  const cameraFrame = props.immersive ? camera.sample({ scope: cameraScope, scene: currentScene, viewport: canvasSize,
    self: selfPosition ?? { x: currentScene.width / 2, y: currentScene.height / 2 }, now, reducedMotion }) : null;
  let value;
  try {
    value = renderer.paint(snapshot, motion, now, { selected: props.selected, personLabels: props.personLabels, labelMode: props.labelMode, hovered, reducedMotion,
      ...(cameraFrame ? { cameraCenter: cameraFrame.center } : {}),
      beforeFrontWrite: () => presentation?.seal(performance.now(), presentationAllowed(snapshot)) });
    if (value) presentation?.painted(value, snapshot, now, performance.now(), painter === renderer && !stopped && presentationAllowed(snapshot));
    else presentation?.invalidate();
  }
  catch (error) { if (props.snapshotSource) displayFailed(error); else { presentation?.invalidate(); renderingError.value = error instanceof Error ? error.message : '场景画布暂不可用。'; } return; }
  failed.value = Boolean(value?.failed.length);
  renderedFrame = painter === renderer && !stopped && displayInput() === snapshot ? value : null;
  // 对象或镜头运动后按新完成帧复核原鼠标位置，不为 hover 启动连续动画循环。
  if (renderedFrame && hoverPoint && props.labelMode === 'contextual' && gesture.pointerId === null) setHovered(renderer.hit(hoverPoint));
  if (renderedFrame && cameraFrame) publishCamera(cameraFrame);
  const drawn = value?.actors.find(actor => actor.ref === p.self.entityRef);
  const currentFrame = value && canvas.value && painter === renderer && !stopped && displayInput() === snapshot
    && value.sceneId === p.self.sceneId && visibleSelf(canvas.value, value, p.self.entityRef);
  if (p.movement?.status === 'arrived' && p.self.position && currentFrame && drawn && !drawn.moving
    && drawn.position.x === p.self.position.x && drawn.position.y === p.self.position.y
    && (reducedMotion || !motion.hasPendingMotion(p.self.entityRef, now))) {
    const key = `${snapshot.viewId}:${p.self.controlEpoch}:${p.movement.movementId}:${p.movement.movementCommandSeq}`;
    if (settledKey !== key) { settledKey = key; emit('settled', { viewId: snapshot.viewId, epoch: p.self.controlEpoch, movementId: p.movement.movementId, sequence: p.movement.movementCommandSeq, position: p.self.position }); }
  }
  if (!reducedMotion && motion.needsFrame(now) || cameraFrame?.animating) schedule();
}
function resize() {
  presentation?.invalidate();
  const size = viewport.value?.getBoundingClientRect(); if (!size || !painter) return;
  if (canvasSize.width !== size.width || canvasSize.height !== size.height || renderedFrame?.viewport.dpr !== Math.max(1, window.devicePixelRatio || 1)) {
    clearHover(); cancelGesture(); renderedFrame = null;
  }
  canvasSize = { width: Math.max(1, size.width), height: Math.max(1, size.height) };
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
function hidden() { presentation?.invalidate(); if (document.hidden) { releaseKeys(); cancelGesture(); } else schedule(); }
function visibilityChanged() { presentation?.invalidate(); schedule(); }
function blur() { releaseKeys(); cancelGesture(); }
function local(event: MouseEvent): Position | null {
  const bounds = canvas.value?.getBoundingClientRect();
  return bounds && bounds.width > 0 && bounds.height > 0 && renderedFrame ? {
    x: (event.clientX - bounds.left) * renderedFrame.viewport.width / bounds.width,
    y: (event.clientY - bounds.top) * renderedFrame.viewport.height / bounds.height,
  } : null;
}
function activate(event: MouseEvent) {
  if (!displayInput() || props.disabled || !painter || !canvas.value) return;
  canvas.value.focus({ preventScroll: true }); const point = local(event); if (!point) return;
  const reference = painter.hit(point);
  if (reference) { releaseKeys(); emit('select', reference); return; }
  const position = painter.point(point); if (position) { releaseKeys(false); emit('move', { x: Math.round(position.x), y: Math.round(position.y) }); }
}
function click(event: MouseEvent) { if (!props.immersive) activate(event); }
function pointer(event: MouseEvent) {
  const point = local(event), reference = point ? painter?.hit(point) ?? null : null;
  if (canvas.value && point) canvas.value.style.cursor = reference ? 'pointer' : props.immersive ? 'grab' : 'crosshair';
  if (props.labelMode !== 'contextual' || (event as PointerEvent).pointerType === 'touch' || event.buttons > 0) { clearHover(); return; }
  hoverPoint = point; setHovered(reference);
}
function releaseCapture(id: number | null) {
  if (id === null) return;
  if (capturedPointer === id) capturedPointer = null;
  try { if (canvas.value?.hasPointerCapture(id)) canvas.value.releasePointerCapture(id); } catch { /* 指针已取消或画布已卸载时不重建手势。 */ }
}
function cancelGesture() {
  const id = capturedPointer; gesture.cancel(); dragging.value = false; releaseCapture(id);
  if (canvas.value) canvas.value.style.cursor = props.immersive ? 'grab' : 'crosshair';
}
function pointerDown(event: PointerEvent) {
  if (!props.immersive || !displayInput()?.projection.scene || !canvas.value || event.button !== 0) return;
  const point = local(event); if (!point) return;
  const previous = gesture.pointerId;
  if (!gesture.begin({ id: event.pointerId, point, button: event.button, primary: event.isPrimary })) { clearHover(); releaseCapture(previous); dragging.value = false; return; }
  if (event.pointerType === 'touch') clearHover();
  event.preventDefault(); canvas.value.focus({ preventScroll: true });
  try { canvas.value.setPointerCapture(event.pointerId); capturedPointer = event.pointerId; }
  catch { cancelGesture(); }
}
function otherPointerDown(event: PointerEvent) {
  if (props.immersive && gesture.pointerId !== null && gesture.pointerId !== event.pointerId) cancelGesture();
}
function pointerMove(event: PointerEvent) {
  if (!props.immersive || !gesture.has(event.pointerId)) { pointer(event); return; }
  const point = local(event); if (!point) { cancelGesture(); return; }
  const delta = gesture.move(event.pointerId, point);
  if (delta) {
    clearHover();
    if (camera.pan(delta)) { event.preventDefault(); dragging.value = true; if (canvas.value) canvas.value.style.cursor = 'grabbing'; schedule(); }
  }
}
function pointerUp(event: PointerEvent) {
  if (!props.immersive || !gesture.has(event.pointerId)) return;
  const result = gesture.end(event.pointerId); dragging.value = false; releaseCapture(event.pointerId);
  if (result.click) activate(event);
  pointer(event);
}
function pointerCancel(event: PointerEvent) { if (gesture.has(event.pointerId)) { clearHover(); cancelGesture(); } }
function lostCapture(event: PointerEvent) { if (gesture.has(event.pointerId)) { clearHover(); cancelGesture(); } }
function retry() { if (props.snapshotSource && renderingError.value) bindSnapshotSource(); painter?.retry(); schedule(); }
function motionPreference() { presentation?.invalidate(); reducedMotion = Boolean(reduced?.matches); schedule(); }
/** 关闭面板只归还键盘焦点，不改变用户的自由取景。 */
function focusScene() { canvas.value?.focus({ preventScroll: true }); }
function returnToSelf() { cancelGesture(); if (props.immersive) camera.returnToSelf(performance.now()); focusScene(); schedule(); }
/** 出口明确操作只恢复页面中的场景可见范围；到达仍由正常paint守卫确认。 */
function revealScene() {
  const element = canvas.value;
  if (!element?.isConnected) return;
  if (props.immersive) focusScene(); else element.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' });
  schedule();
}
defineExpose({ returnToSelf, focusScene, revealScene });

watch(() => props.snapshot, snapshot => {
  if (!props.snapshotSource) {
    try { receiveSnapshot(snapshot); } catch (error) { displayFailed(error); }
  }
}, { immediate: true, flush: 'sync' });
watch(() => props.snapshotSource, () => { if (mounted) bindSnapshotSource(); }, { flush: 'sync' });
watch(() => props.disabled, disabled => { if (disabled) { presentation?.invalidate(); clearHover(); releaseKeys(); cancelGesture(); } else schedule(); }, { flush: 'sync' });
watch(() => props.immersive, () => { resetCamera(); cameraScope = displayInput() ? scopeOf(displayInput()!) : ''; schedule(); }, { flush: 'sync' });
watch(() => props.labelMode, () => { clearHover(); schedule(); }, { flush: 'sync' });
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
  window.addEventListener('blur', clearHover); document.addEventListener('visibilitychange', clearHiddenHover);
  window.addEventListener('pointerdown', otherPointerDown, true); window.addEventListener('pointerup', pointerUp); window.addEventListener('pointercancel', pointerCancel);
  window.addEventListener('scroll', visibilityChanged, true);
});
onBeforeUnmount(() => {
  snapshotSubscription?.close(); snapshotSubscription = null; presentation?.invalidate(); motion.reset(); releaseKeys(); cancelGesture(); stopped = true; mounted = false; if (frame) cancelAnimationFrame(frame); observer?.disconnect(); intersection?.disconnect(); visibility?.disconnect(); unsubscribe?.(); reduced?.removeEventListener('change', motionPreference);
  window.removeEventListener('resize', resize); window.removeEventListener('keyup', keyup, true); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hidden);
  window.removeEventListener('blur', clearHover); document.removeEventListener('visibilitychange', clearHiddenHover);
  window.removeEventListener('pointerdown', otherPointerDown, true); window.removeEventListener('pointerup', pointerUp); window.removeEventListener('pointercancel', pointerCancel);
  window.removeEventListener('scroll', visibilityChanged, true);
  painter?.dispose(); painter = null;
});
</script>

<template>
  <section class="spatial-map-card" :class="{ 'is-immersive': immersive }" aria-label="授权行走场景">
    <header class="spatial-map-toolbar"><div v-if="!immersive"><strong>{{ scene?.name || '等待场景' }}</strong><span>按住方向键行走，也可点击地面。</span></div><button class="secondary-button" @click="emit('objects')">场景对象</button></header>
    <div ref="viewport" class="spatial-map-viewport">
      <canvas ref="canvas" class="spatial-map" :class="{ 'is-dragging': dragging }" data-testid="spatial-map" :data-label-mode="labelMode || 'all'" :data-camera-mode="immersive ? cameraState.mode : 'fit'" :data-camera-can-return="immersive && cameraState.canReturn" data-keyboard-scope="world" tabindex="0" role="application" :aria-label="immersive ? '行走场景；拖动查看，点击地面行走，方向键组合移动，松键停步，Enter选择本人，Escape取消路线' : '行走场景；方向键组合移动，松键停步，Enter选择本人，Escape取消路线'" @click="click" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerleave="clearHover" @lostpointercapture="lostCapture" @keydown="keydown" @blur="blur(); clearHover()">场景绘制在画布上，可从场景对象列表选择人物和物件。</canvas>
    </div>
    <p v-if="failed || renderingError" class="spatial-map-note" role="status">{{ renderingError || '部分图像暂未载入，仍可继续操作。' }}<button class="text-button" @click="retry">重新载入场景</button></p>
  </section>
</template>

<style scoped>
.spatial-map-card:not(.is-immersive) { position: relative; }
.spatial-map-card:not(.is-immersive) .spatial-map-toolbar { position: absolute; z-index: 2; top: 12px; left: 12px; right: auto; bottom: auto; transform: none; width: auto; min-height: 44px; border: 0; padding: 0; background: transparent; }
.spatial-map-toolbar button { min-height: 44px; background: #fff8e9ee; }
.spatial-map:focus-visible { outline: 2px solid #365e52; outline-offset: -3px; }
.is-immersive .spatial-map { touch-action: none; user-select: none; cursor: grab; }
.is-immersive .spatial-map.is-dragging { cursor: grabbing; }
.spatial-map-card:not(.is-immersive) .spatial-map-note { position: absolute; z-index: 2; left: 12px; bottom: 12px; max-width: min(420px, calc(100% - 24px)); border-radius: 8px; }
</style>
