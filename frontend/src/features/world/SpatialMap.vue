<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Position, SnapshotV2, ItemViewV2, TargetViewV2 } from '../../../../game/spatial-types.ts';
import { ConfirmedMotion } from '../../domain/spatial-motion.ts';
import { layoutSpatialLabels, screenPosition } from '../../domain/spatial-labels.ts';
import { sceneArtwork, spriteForAppearance } from '../../domain/gaolao-art.ts';
import SpatialActorArt from './SpatialActorArt.vue';
import SpatialObjectArt from './SpatialObjectArt.vue';
import { objectArtContext, objectInstanceKey, objectVisualVariant, selectObjectArt, objectArtRequestKey, readyObjectArtFrame } from '../../domain/gaolao-object-art.ts';
import type { ObjectArtResourceState } from '../../domain/gaolao-object-art.ts';
import { foregroundOpacity, orderSceneEntries, selectSceneDoor, sceneLayerPresentation } from '../../domain/gaolao-scene-layers.ts';
import type { SceneForeground, SceneDoorGeometry } from '../../domain/gaolao-scene-layers.ts';
import { useSceneLayerImages } from './use-scene-layer-images.ts';
import type { SpatialLabelInput } from '../../domain/spatial-labels.ts';
import type { ScreenRect } from '../../domain/spatial-labels.ts';
import { cameraForHud, hudCameraAlternatives, fullMapHudAlternatives, placeHudCards } from '../../domain/gaolao-hud-layout.ts';
import type { HudMapGeometry, HudCameraArea, HudCardPlacement } from '../../domain/gaolao-hud-layout.ts';
const props = defineProps<{ snapshot: SnapshotV2; disabled: boolean; selected?: string; personLabels?: Record<string, string>; immersive?: boolean; cameraArea?: HudCameraArea; hudNotice?: string; hudRestoreLabel?: string }>();
const emit = defineEmits<{ move: [position: Position]; select: [reference: string]; stop: []; objects: []; restore: []; geometry: [value: HudMapGeometry]; settled: [value: { viewId: string; epoch: string; movementId: string; sequence: string; position: Position }] }>();
const projection = computed(() => props.snapshot.projection);
const motion = new ConfirmedMotion(); const frameTime = ref(performance.now()); let frame = 0; let settledKey = '';
function draw(now: number) {
  frame = 0; frameTime.value = now; const p = projection.value;
  if (p.movement?.status === 'arrived' && p.self.position && motion.settled(p.self.entityRef, now)) {
    const key = `${props.snapshot.viewId}:${p.self.controlEpoch}:${p.movement.movementId}:${p.movement.movementCommandSeq}`;
    if (key !== settledKey) { settledKey = key; emit('settled', { viewId: props.snapshot.viewId, epoch: p.self.controlEpoch, movementId: p.movement.movementId, sequence: p.movement.movementCommandSeq, position: p.self.position }); }
  }
  if (motion.active(now)) frame = requestAnimationFrame(draw);
}
watch(() => props.snapshot, snapshot => { if (frame) cancelAnimationFrame(frame); const now = performance.now(); motion.update(snapshot, now); draw(now); }, { immediate: true, flush: 'sync' });
const viewport = ref<HTMLElement | null>(null);
const reducedMotion = ref(false); let motionPreference: MediaQueryList | null = null;
const updateMotionPreference = () => { reducedMotion.value = Boolean(motionPreference?.matches); };
const artAttempt = ref(0); const missingResources = ref(new Set<string>()); const objectResources = ref(new Map<string, ObjectArtResourceState>());
function resource(value: { file: string; available: boolean }) { const next = new Set(missingResources.value); if (value.available) next.delete(value.file); else next.add(value.file); missingResources.value = next; }
function retryArtwork() { missingResources.value = new Set(); objectResources.value = new Map(); artAttempt.value++; backgroundFailed.value = false; }
const viewportSize = ref({ width: 0, height: 0 });
let resize: ResizeObserver | null = null; let resizeFrame = 0;
function measureViewport() {
  resizeFrame = 0; const rect = viewport.value?.getBoundingClientRect();
  if (rect && (rect.width !== viewportSize.value.width || rect.height !== viewportSize.value.height)) viewportSize.value = { width: rect.width, height: rect.height };
}
onMounted(() => {
  motionPreference = matchMedia('(prefers-reduced-motion: reduce)'); updateMotionPreference(); motionPreference.addEventListener('change', updateMotionPreference);
  // 下一帧再发布尺寸，避免观察回调内的相机/标签更新再次改变被观察布局。
  resize = new ResizeObserver(() => { if (!resizeFrame) resizeFrame = requestAnimationFrame(measureViewport); });
  if (viewport.value) resize.observe(viewport.value);
});
watch(viewport, (element, previous) => { if (previous) resize?.unobserve(previous); if (element) resize?.observe(element); });
onBeforeUnmount(() => { if (frame) cancelAnimationFrame(frame); if (resizeFrame) cancelAnimationFrame(resizeFrame); resize?.disconnect(); motionPreference?.removeEventListener('change', updateMotionPreference); });
const svg = ref<SVGSVGElement | null>(null); const follow = ref(true);
function toggleCamera() { follow.value = !follow.value; }
function returnToSelf() { follow.value = true; }
defineExpose({ returnToSelf });
const scene = computed(() => projection.value.scene);
const artContext = computed(() => objectArtContext(props.snapshot));
const layerPresentation = computed(() => sceneLayerPresentation(artContext.value));
const layerGroup = computed(() => layerPresentation.value.registered);
const layerResources = computed(() => layerPresentation.value.resources);
const sceneDoor = computed(() => layerPresentation.value.door);
const layerContextKey = computed(() => JSON.stringify(artContext.value));
const { ready: layersReady, failed: layersFailed, instance: layerInstance, source: layerSource, displayFailure: sceneResourceFailed } = useSceneLayerImages(layerGroup, layerContextKey, artAttempt);
const backgroundFailed = ref(false);
const artwork = computed(() => layerGroup.value ? null : sceneArtwork(scene.value?.sceneId));
const backgroundUrl = computed(() => artwork.value && (artAttempt.value ? `${artwork.value}?retry=${artAttempt.value}` : artwork.value));
watch(artwork, () => { backgroundFailed.value = false; });
const displayObstacles = computed(() => scene.value?.obstacles.filter(obstacle => !(sceneDoor.value && scene.value?.sceneId === 'gaolao-courtyard' && obstacle.obstacleId === 'sealed-door')) ?? []);
const people = computed(() => [...projection.value.entities.filter(e => e.entityRef !== projection.value.self.entityRef), projection.value.self].filter(e => e.sceneId === scene.value?.sceneId && e.position).map(e => {
  const pose = motion.pose(e.entityRef, frameTime.value);
  const appearanceId = 'appearanceId' in e && typeof e.appearanceId === 'string' ? e.appearanceId : undefined;
  return { ...e, appearanceId, position: reducedMotion.value ? e.position : pose?.position || e.position, drawnFacing: pose?.facing || e.facing, moving: !projection.value.paused && !reducedMotion.value && Boolean(pose?.moving), distance: pose?.distance || 0 };
}).sort((a, b) => a.position!.y - b.position!.y));
const groundItems = computed(() => projection.value.items.filter(i => i.location.kind === 'ground' && i.location.sceneId === scene.value?.sceneId));
const mapObjects = computed(() => [...groundItems.value, ...projection.value.targets.filter(target => target.sceneId === scene.value?.sceneId)]);
function objectFrame(object: ItemViewV2 | TargetViewV2) { return !('location' in object) && sceneDoor.value && object.visualKey === 'timber-door' ? null : selectObjectArt(object, artContext.value, 'map'); }
const objectFrames = computed(() => new Map(mapObjects.value.map(object => [objectInstanceKey(artContext.value, object), objectFrame(object)])));
const invalidObjectState = computed(() => mapObjects.value.some(object => objectVisualVariant(object, artContext.value, 'map') === 'invalid'));
function currentObjectResource(value: ObjectArtResourceState) {
  return objectFrames.value.has(value.instanceKey) && value.requestKey === objectArtRequestKey(value.instanceKey, objectFrames.value.get(value.instanceKey)!, artAttempt.value);
}
function objectResource(value: ObjectArtResourceState) { if (currentObjectResource(value)) objectResources.value = new Map(objectResources.value).set(value.instanceKey, value); }
watch([objectFrames, artAttempt], () => { objectResources.value = new Map([...objectResources.value].filter(([, value]) => currentObjectResource(value))); }, { flush: 'sync' });
const missingObjects = computed(() => new Set([...objectResources.value].filter(([, value]) => value.failed && currentObjectResource(value)).map(([key]) => key)));
const protectedRefs = computed(() => new Set([projection.value.self.entityRef, props.selected, ...(projection.value.chapter?.follows.filter(follow => ['accepted', 'following', 'paused', 'arrived'].includes(follow.status)).map(follow => follow.subjectRef) || [])]));
const selectedObjects = computed(() => [
  ...projection.value.targets.filter(target => target.entityRef === props.selected && target.sceneId === scene.value?.sceneId).map(target => ({ key: target.entityRef, position: target.position, bounds: renderedObjectFrame(target)?.bounds })),
  ...groundItems.value.flatMap(item => item.entityRef === props.selected && item.location.kind === 'ground' ? [{ key: item.entityRef, position: item.location.position, bounds: renderedObjectFrame(item)?.bounds }] : []),
]);
const doorSelection = computed(() => selectSceneDoor(layerResources.value, artContext.value, projection.value.targets, undefined, layersReady.value));
const doorInstanceKey = computed(() => JSON.stringify([layerContextKey.value, layerResources.value?.groupVersion, doorSelection.value.target?.entityRef, doorSelection.value.target?.resourceRevision, doorSelection.value.frame?.variant, layersReady.value]));
const doorState = ref<ObjectArtResourceState | null>(null);
watch(doorInstanceKey, () => { doorState.value = null; }, { flush: 'sync' });
function currentDoorResource(value: ObjectArtResourceState) { return value.instanceKey === doorInstanceKey.value && value.requestKey === objectArtRequestKey(doorInstanceKey.value, doorSelection.value.frame, artAttempt.value); }
function doorResource(value: ObjectArtResourceState) { if (currentDoorResource(value)) doorState.value = value; }
const doorFailed = computed(() => Boolean(doorState.value?.failed && currentDoorResource(doorState.value)));
function renderedObjectFrame(object: ItemViewV2 | TargetViewV2) {
  if (!('location' in object) && sceneDoor.value && object.visualKey === 'timber-door') return doorSelection.value.target?.entityRef === object.entityRef ? readyObjectArtFrame(doorSelection.value.frame, doorInstanceKey.value, artAttempt.value, doorState.value) : null;
  const key = objectInstanceKey(artContext.value, object);
  return readyObjectArtFrame(objectFrame(object), key, artAttempt.value, objectResources.value.get(key));
}
const protectedBodies = computed(() => [
  ...people.value.filter(person => protectedRefs.value.has(person.entityRef)).map(person => {
    const sprite = spriteForAppearance(person.appearanceId, person.drawnFacing, person.moving, person.distance, reducedMotion.value);
    const b = sprite ? { ...sprite.bounds, x: sprite.mirrorX ? -sprite.bounds.x - sprite.bounds.width : sprite.bounds.x } : { x: -22, y: -82, width: 44, height: 90 };
    return { depthY: person.position!.y, bounds: { ...b, x: person.position!.x + b.x, y: person.position!.y + b.y } };
  }),
  ...mapObjects.value.filter(object => protectedRefs.value.has(object.entityRef)).flatMap(object => {
    const position = 'location' in object ? object.location.kind === 'ground' ? object.location.position : null : object.position;
    if (!position) return [];
    const b = renderedObjectFrame(object)?.bounds ?? { x: -18, y: -18, width: 36, height: 36 };
    return [{ depthY: position.y, bounds: { ...b, x: position.x + b.x, y: position.y + b.y } }];
  }),
]);
type DrawnPerson = (typeof people.value)[number];
type LayerEntry = { key: string; depthY: number } & (
  { kind: 'target'; target: TargetViewV2 } | { kind: 'item'; item: ItemViewV2 } | { kind: 'person'; person: DrawnPerson } |
  { kind: 'foreground'; fragment: SceneForeground } | { kind: 'door'; door: SceneDoorGeometry }
);
const drawEntries = computed(() => {
  const entries: LayerEntry[] = [
    ...projection.value.targets.filter(target => target.sceneId === scene.value?.sceneId).map(target => ({ kind: 'target' as const, key: objectInstanceKey(artContext.value, target), depthY: target.position.y, target })),
    ...groundItems.value.map(item => ({ kind: 'item' as const, key: objectInstanceKey(artContext.value, item), depthY: item.location.kind === 'ground' ? item.location.position.y : 0, item })),
    ...people.value.map(person => ({ kind: 'person' as const, key: person.entityRef + ':' + person.appearanceEpoch, depthY: person.position!.y, person })),
  ];
  // 未登记时保留原 targets→items→按脚底排序人物的既有顺序。
  if (!layerGroup.value) return entries;
  if (layerResources.value && layersReady.value) for (const fragment of layerResources.value.foreground) entries.push({ kind: 'foreground', key: 'foreground:' + fragment.id, depthY: fragment.depthY, fragment });
  if (sceneDoor.value) entries.push({ kind: 'door', key: 'scene-door', depthY: sceneDoor.value.depthY, door: sceneDoor.value });
  return orderSceneEntries(entries);
});
function labelsFor(view: ScreenRect, cardSpace: ScreenRect[] = []) {
  const size = viewportSize.value;
  const inputs: SpatialLabelInput[] = [];
  function add(key: string, label: string, position: Position, kind: 'person' | 'object' | 'anchor', bounds?: { x: number; y: number; width: number; height: number }) {
    const point = screenPosition(position, view, size);
    if (point.x < 0 || point.y < 0 || point.x > size.width || point.y > size.height) return;
    const local = bounds || (kind === 'person' ? { x: -22, y: -82, width: 44, height: 90 } : kind === 'anchor' ? { x: -6, y: -6, width: 12, height: 12 } : { x: -18, y: -18, width: 36, height: 36 });
    const protection = protectedRefs.value.has(key) ? 8 : 0;
    inputs.push({ key, label, point, footprint: { x: point.x + local.x * point.scale - protection, y: point.y + local.y * point.scale - protection, width: local.width * point.scale + protection * 2, height: local.height * point.scale + protection * 2 }, selectable: kind !== 'anchor', priority: protectedRefs.value.has(key) ? 0 : kind === 'person' ? 1 : kind === 'object' ? 2 : 3 });
  }
  for (const person of people.value) if (person.position) {
    const sprite = spriteForAppearance(person.appearanceId, person.drawnFacing, person.moving, person.distance, reducedMotion.value);
    const bounds = sprite ? { ...sprite.bounds, x: sprite.mirrorX ? -sprite.bounds.x - sprite.bounds.width : sprite.bounds.x } : undefined;
    add(person.entityRef, (props.personLabels?.[person.entityRef] || person.name) + (person.entityRef === projection.value.self.entityRef ? ' · 你' : ''), person.position, 'person', bounds);
  }
  for (const target of projection.value.targets) if (target.sceneId === scene.value?.sceneId) add(target.entityRef, target.name, target.position, 'object', renderedObjectFrame(target)?.bounds);
  for (const item of groundItems.value) if (item.location.kind === 'ground') add(item.entityRef, item.name, item.location.position, 'object', renderedObjectFrame(item)?.bounds);
  for (const anchor of scene.value?.anchors || []) if (scene.value?.exits.some(exit => exit.anchorId === anchor.anchorId)) add('anchor:' + anchor.anchorId, anchor.label, anchor.position, 'anchor');
  return layoutSpatialLabels(inputs, size, props.immersive ? [...(props.cameraArea?.reserved || []), ...cardSpace] : undefined);
}
function geometryFor(view: ScreenRect, placed: ReturnType<typeof labelsFor>): HudMapGeometry {
  const size = viewportSize.value;
  const protectedRegions: ScreenRect[] = [];
  if (props.immersive && size.width && size.height) {
    for (const person of people.value) if (protectedRefs.value.has(person.entityRef) && person.position) {
      const point = screenPosition(person.position, view, size);
      const sprite = spriteForAppearance(person.appearanceId, person.drawnFacing, person.moving, person.distance, reducedMotion.value);
      const b = sprite ? { ...sprite.bounds, x: sprite.mirrorX ? -sprite.bounds.x - sprite.bounds.width : sprite.bounds.x } : { x: -22, y: -82, width: 44, height: 90 };
      protectedRegions.push({ x: point.x + b.x * point.scale, y: point.y + b.y * point.scale, width: b.width * point.scale, height: b.height * point.scale });
    }
    for (const object of selectedObjects.value) {
      const point = screenPosition(object.position, view, size);
      const b = object.bounds ?? { x: -18, y: -18, width: 36, height: 36 };
      // 选中物的保护不依赖标签能否排下，不能靠略去名字让卡片获得虚假的空域。
      protectedRegions.push({ x: point.x + b.x * point.scale - 8, y: point.y + b.y * point.scale - 8, width: b.width * point.scale + 16, height: b.height * point.scale + 16 });
    }
    for (const label of placed.labels) if (protectedRefs.value.has(label.key)) {
      protectedRegions.push({ x: label.x, y: label.y, width: label.width, height: label.height });
    }
  }
  return { viewport: size, protectedRegions };
}
const framing = computed(() => {
  const map = scene.value, size = viewportSize.value;
  const position = motion.position(projection.value.self.entityRef, frameTime.value) || projection.value.self.position;
  const assemble = (view: ScreenRect, cardSpace: ScreenRect[] = []) => { const labels = labelsFor(view, cardSpace); return { view, labels, geometry: geometryFor(view, labels) }; };
  if (!map) return assemble({ x: 0, y: 0, width: 1000, height: 700 });
  const fullMap = !follow.value || !position;
  const width = Math.min(map.width, Math.max(400, size.width / .9)), height = Math.min(map.height, Math.max(400, size.height / .9));
  let preferred = fullMap ? { x: 0, y: 0, width: map.width, height: map.height } : { x: Math.max(0, Math.min(map.width - width, position!.x - width / 2)), y: Math.max(0, Math.min(map.height - height, position!.y - height / 2)), width, height };
  const area = props.cameraArea;
  if (!props.immersive || !area || !size.width || !size.height) return assemble(preferred);
  const actors = people.value.filter(person => protectedRefs.value.has(person.entityRef));
  // 素材偏移只扩充镜头候选范围；命中、选择与世界动作仍使用原权威点。
  const positions = [...actors.map(person => person.position!), ...selectedObjects.value.flatMap(object => object.bounds ? [object.position, { x: object.position.x + object.bounds.x, y: object.position.y + object.bounds.y }, { x: object.position.x + object.bounds.x + object.bounds.width, y: object.position.y + object.bounds.y + object.bounds.height }] : [object.position])];
  const scale = Math.min(size.width / width, size.height / height);
  const covers = width * scale >= size.width - .01 && height * scale >= size.height - .01;
  const alreadyVisible = positions.every(point => { const screen = screenPosition(point, preferred, size); return screen.x - 106 >= area.x && screen.x + 106 <= area.x + area.width && screen.y - 90 * screen.scale - 70 >= area.y && screen.y + 60 <= area.y + area.height; });
  if (!fullMap && (!covers || !alreadyVisible)) preferred = cameraForHud({ viewport: size, scene: map, safeArea: area, positions });
  const requiredLabels = [...actors.map(person => person.entityRef), ...selectedObjects.value.map(object => object.key)];
  const state = (card: HudCardPlacement) => !card.rect ? 2 : card.collapsed ? 1 : 0;
  const overlaps = (a: ScreenRect, b: ScreenRect) => a.x < b.x + b.width + 8 && a.x + a.width > b.x - 8 && a.y < b.y + b.height + 8 && a.y + a.height > b.y - 8;
  function rank(value: ReturnType<typeof assemble>) {
    const regions = value.geometry.protectedRegions;
    const hidden = requiredLabels.filter(key => !value.labels.labels.some(label => label.key === key)).length + regions.filter(rect => rect.x < 0 || rect.y < 0 || rect.x + rect.width > size.width || rect.y + rect.height > size.height || area!.reserved?.some(fixed => overlaps(rect, fixed))).length;
    const cards = placeHudCards({ panel: area!.panel, follow: area!.follow, protectedRegions: regions });
    return { ...value, rank: [hidden, area!.panel ? state(cards.panel) : 0, area!.follow ? state(cards.follow) : 0] };
  }
  const better = (next: ReturnType<typeof rank>, previous: ReturnType<typeof rank>) => {
    const difference = next.rank.findIndex((value, index) => value !== previous.rank[index]);
    return difference >= 0 && next.rank[difference] < previous.rank[difference];
  };
  function evaluate(view: ScreenRect) {
    const initial = rank(assemble(view));
    if (initial.rank.every(value => value === 0)) return initial;
    // 姓名先占位可能把原本可用的正文空间切碎。只补一次联合排布候选，
    // 最终仍逐项核对所有必要姓名、当前身体、固定HUD和16px，不能靠省略姓名腾空。
    const bodies = geometryFor(view, { labels: [], omitted: 0 }).protectedRegions;
    const cards = placeHudCards({ panel: area!.panel, follow: area!.follow, protectedRegions: bodies });
    const cardSpace = [cards.panel, cards.follow].flatMap(card => card.rect && !card.collapsed ? [{ x: card.rect.x - 8, y: card.rect.y - 8, width: card.rect.width + 16, height: card.rect.height + 16 }] : []);
    if (!cardSpace.length) return initial;
    const alternative = rank(assemble(view, cardSpace));
    return better(alternative, initial) ? alternative : initial;
  }
  if (fullMap) {
    const conflict = selectedObjects.value.some(object => {
      if (!object.bounds) return false;
      const point = screenPosition(object.position, preferred, size), b = object.bounds;
      const region = { x: point.x + b.x * point.scale - 8, y: point.y + b.y * point.scale - 8, width: b.width * point.scale + 16, height: b.height * point.scale + 16 };
      return area.reserved?.some(rect => overlaps(region, rect));
    });
    if (!conflict) return assemble(preferred);
    let best = evaluate(preferred);
    for (const candidate of fullMapHudAlternatives(size, map, area.reserved || [])) {
      const next = evaluate(candidate);
      if (better(next, best)) best = next;
      if (best.rank.every(value => value === 0)) break;
    }
    return best;
  }
  // 跟随仍受原地图四边约束；只在正文/姓名无法同时容纳时评估有限换边。
  let best = evaluate(preferred);
  if (best.rank.every(value => value === 0)) return best;
  for (const candidate of hudCameraAlternatives(size, map, positions, area, preferred)) {
    const next = evaluate(candidate);
    if (better(next, best)) best = next;
    if (best.rank.every(value => value === 0)) break;
  }
  return best;
});
const box = computed(() => { const { x, y, width, height } = framing.value.view; return `${x} ${y} ${width} ${height}`; });
const labels = computed(() => framing.value.labels);
const hudGeometry = computed(() => framing.value.geometry);
const mapScale = computed(() => Math.max(.01, Math.min(viewportSize.value.width / framing.value.view.width, viewportSize.value.height / framing.value.view.height)));
const hitRadius = computed(() => Math.max(18, 22 / mapScale.value));
let lastHudGeometry = '';
watch(hudGeometry, value => { const key = JSON.stringify(value); if (key !== lastHudGeometry) { lastHudGeometry = key; emit('geometry', value); } }, { immediate: true, flush: 'post' });
const points = (values: Position[]) => values.map(p => `${p.x},${p.y}`).join(' ');
function click(event: MouseEvent) {
  if (props.disabled || !svg.value || !scene.value) return;
  const transform = svg.value.getScreenCTM(); if (!transform) return;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse());
  if (point.x < 0 || point.y < 0 || point.x > scene.value.width || point.y > scene.value.height) return;
  emit('move', { x: Math.round(point.x), y: Math.round(point.y) });
}
function keyboard(event: KeyboardEvent) {
  const position = projection.value.self.position; if (!position || props.disabled || event.target !== svg.value) return;
  const delta: Record<string, [number, number]> = { ArrowUp: [0, -60], ArrowDown: [0, 60], ArrowLeft: [-60, 0], ArrowRight: [60, 0] };
  if (event.key === 'Escape') { event.preventDefault(); emit('stop'); return; }
  const shift = delta[event.key]; if (!shift) return;
  event.preventDefault(); emit('move', { x: Math.max(0, Math.min(scene.value!.width, position.x + shift[0])), y: Math.max(0, Math.min(scene.value!.height, position.y + shift[1])) });
}
</script>

<template>
  <section class="spatial-map-card" aria-label="授权行走场景">
    <header class="spatial-map-toolbar"><div><strong>{{ scene?.name || '等待场景' }}</strong><span>点地行走 · 选中物件后靠近操作</span></div><div class="button-row"><button class="secondary-button" @click="toggleCamera">{{ follow ? '查看全图' : '跟随角色' }}</button><button class="secondary-button" @click="returnToSelf">回到角色</button><button v-if="immersive" class="secondary-button" @click="emit('objects')">附近对象与出口</button></div><p v-if="immersive && hudNotice" class="gaolao-space-notice" role="status">{{ hudNotice }}<button class="text-button" @click="emit('restore')">{{ hudRestoreLabel || '回到角色' }}</button></p></header>
    <div v-if="scene" ref="viewport" class="spatial-map-viewport">
    <svg ref="svg" class="spatial-map" :class="{ 'has-artwork': layerGroup ? layersReady : artwork && !backgroundFailed }" :data-scene-layer-status="!layerGroup ? 'legacy' : layersReady ? 'ready' : layersFailed ? 'failed' : 'pending'" data-testid="spatial-map" :viewBox="box" tabindex="0" role="application" aria-label="行走地图，点击地面或使用方向键移动，Escape停步" @click="click" @keydown="keyboard">
      <defs><mask v-for="(obstacle, index) in displayObstacles" :id="`obstacle-mask-${index}`" :key="obstacle.obstacleId" maskUnits="userSpaceOnUse" :x="0" :y="0" :width="scene.width" :height="scene.height"><rect :width="scene.width" :height="scene.height" fill="white" /><template v-for="area in scene.walkableAreas" :key="area.areaId"><polygon v-if="obstacle.exceptAreas.includes(area.areaId)" :points="points(area.polygon)" fill="black" /></template></mask></defs>
      <rect :width="scene.width" :height="scene.height" fill="#eee3cb" />
      <image v-if="backgroundUrl && !backgroundFailed" class="spatial-scene-art" :href="backgroundUrl" :width="scene.width" :height="scene.height" preserveAspectRatio="none" aria-hidden="true" @error="backgroundFailed = true" />
      <g v-if="layerResources && layersReady" class="spatial-scene-layers" pointer-events="none" aria-hidden="true">
        <image class="spatial-scene-base" :data-scene-instance="layerInstance" :href="layerSource(layerResources.base)" :x="layerResources.base.worldRect.x" :y="layerResources.base.worldRect.y" :width="layerResources.base.worldRect.width" :height="layerResources.base.worldRect.height" preserveAspectRatio="none" @error="sceneResourceFailed" />
        <image v-for="floor in layerResources.floors" :key="floor.file" class="spatial-scene-floor" :data-scene-instance="layerInstance" :href="layerSource(floor)" :x="floor.worldRect.x" :y="floor.worldRect.y" :width="floor.worldRect.width" :height="floor.worldRect.height" preserveAspectRatio="none" @error="sceneResourceFailed" />
      </g>
      <g v-if="layerGroup ? !layersReady : !artwork || backgroundFailed" class="spatial-geometric-fallback">
      <polygon v-for="area in scene.walkableAreas" :key="area.areaId" :points="points(area.polygon)" class="spatial-ground" />
      <polygon v-for="(obstacle, index) in displayObstacles" :key="obstacle.obstacleId" :points="points(obstacle.polygon)" class="spatial-obstacle" :mask="`url(#obstacle-mask-${index})`" />
      </g>
      <polyline v-if="projection.movement && ['accepted', 'moving'].includes(projection.movement.status)" class="spatial-route" :points="points(projection.movement.path)" />
      <template v-for="entry in drawEntries" :key="entry.key">
      <g v-if="entry.kind === 'target'" :transform="`translate(${entry.target.position.x} ${entry.target.position.y})`" class="spatial-target" :class="{ selected: selected === entry.target.entityRef }" :data-depth-y="entry.depthY" tabindex="0" role="button" :aria-label="`选择${entry.target.name}`" @click.stop="emit('select', entry.target.entityRef)" @keydown.enter.stop="emit('select', entry.target.entityRef)"><SpatialObjectArt :frame="objectFrame(entry.target)" :instance-key="entry.key" :attempt="artAttempt" @resource="objectResource"><rect x="-13" y="-13" width="26" height="26" rx="4" /></SpatialObjectArt><circle class="spatial-object-selection" r="18" /><circle class="spatial-hit" :r="hitRadius" /></g>
      <g v-else-if="entry.kind === 'item'" :transform="entry.item.location.kind === 'ground' ? `translate(${entry.item.location.position.x} ${entry.item.location.position.y})` : ''" class="spatial-item" :class="{ selected: selected === entry.item.entityRef }" :data-depth-y="entry.depthY" tabindex="0" role="button" :aria-label="`选择${entry.item.name}`" @click.stop="emit('select', entry.item.entityRef)" @keydown.enter.stop="emit('select', entry.item.entityRef)"><SpatialObjectArt :frame="objectFrame(entry.item)" :instance-key="entry.key" :attempt="artAttempt" @resource="objectResource"><path d="M0 -10 L12 0 L0 10 L-12 0 Z" /></SpatialObjectArt><circle class="spatial-object-selection" r="18" /><circle class="spatial-hit" :r="hitRadius" /></g>
      <g v-else-if="entry.kind === 'person'" :transform="`translate(${entry.person.position!.x} ${entry.person.position!.y})`" :data-spatial-self="entry.person.entityRef === projection.self.entityRef ? 'true' : undefined" :data-depth-y="entry.depthY" class="spatial-person" :class="{ self: entry.person.entityRef === projection.self.entityRef, selected: selected === entry.person.entityRef }" tabindex="0" role="button" :aria-label="`${personLabels?.[entry.person.entityRef] || entry.person.name}${entry.person.entityRef === projection.self.entityRef ? '，本人' : ''}`" @click.stop="emit('select', entry.person.entityRef)" @keydown.enter.stop="emit('select', entry.person.entityRef)" @keydown.space.prevent.stop="emit('select', entry.person.entityRef)">
        <ellipse cy="-1" rx="17" ry="6" class="spatial-shadow" />
        <ellipse v-if="!layerGroup && (entry.person.entityRef === projection.self.entityRef || selected === entry.person.entityRef)" cy="-1" rx="24" ry="9" class="spatial-selection-ring" />
        <SpatialActorArt :appearance-id="entry.person.appearanceId" :facing="entry.person.drawnFacing" :moving="entry.person.moving" :distance="entry.person.distance" :reduced-motion="reducedMotion" :attempt="artAttempt" @resource="resource" />
        <circle class="spatial-hit" :r="hitRadius" fill="transparent" />
      </g>
      <image v-else-if="entry.kind === 'foreground'" class="spatial-scene-foreground" :data-foreground="entry.fragment.id" :data-depth-y="entry.depthY" :data-scene-instance="layerInstance" :href="layerSource(entry.fragment)" :x="entry.fragment.worldRect.x" :y="entry.fragment.worldRect.y" :width="entry.fragment.worldRect.width" :height="entry.fragment.worldRect.height" :opacity="foregroundOpacity(entry.fragment, protectedBodies)" preserveAspectRatio="none" pointer-events="none" aria-hidden="true" @error="sceneResourceFailed" />
      <g v-else-if="entry.kind === 'door'" class="spatial-scene-door" :data-depth-y="entry.depthY" :transform="`translate(${entry.door.targetPosition.x} ${entry.door.targetPosition.y})`" pointer-events="none" aria-hidden="true">
        <SpatialObjectArt :key="doorInstanceKey" :frame="doorSelection.frame" :instance-key="doorInstanceKey" :attempt="artAttempt" @resource="doorResource">
          <svg class="spatial-neutral-door" :x="entry.door.neutralBounds.x - entry.door.targetPosition.x" :y="entry.door.neutralBounds.y - entry.door.targetPosition.y" :width="entry.door.neutralBounds.width" :height="entry.door.neutralBounds.height" viewBox="0 0 100 100" preserveAspectRatio="none">
            <rect x="0" y="0" width="100" height="100" rx="8" fill="#edece5" stroke="#9b9e94" stroke-width="2" />
            <path d="M5 25L25 5 M5 50L50 5 M5 75L75 5 M5 95L95 5 M25 95L95 25 M50 95L95 50 M75 95L95 75" stroke="#b8bdb2" stroke-width="2" fill="none" />
            <circle cx="50" cy="50" r="18" fill="#f6f2e7" /><text x="50" y="61" text-anchor="middle" font-size="32" fill="#596963">?</text>
          </svg>
        </SpatialObjectArt>
      </g>
      </template>
      <g v-if="layerGroup" class="spatial-layer-feedback" pointer-events="none" aria-hidden="true">
        <ellipse v-for="person in people.filter(value => value.entityRef === projection.self.entityRef || value.entityRef === selected)" :key="person.entityRef" :cx="person.position!.x" :cy="person.position!.y - 1" rx="24" ry="9" class="spatial-selection-ring" :class="{ self: person.entityRef === projection.self.entityRef, selected: person.entityRef === selected }" />
        <circle v-for="object in selectedObjects" :key="object.key" :cx="object.position.x" :cy="object.position.y" r="18" class="spatial-layer-object-selection" />
      </g>
    </svg>
    <svg class="spatial-label-guides" :viewBox="'0 0 ' + viewportSize.width + ' ' + viewportSize.height" aria-hidden="true"><line v-for="label in labels.labels" :key="label.key" :x1="label.point.x" :y1="label.point.y" :x2="label.lineX" :y2="label.lineY" /></svg>
    <div class="spatial-map-labels"><template v-for="label in labels.labels" :key="label.key"><button v-if="label.selectable" class="spatial-map-label" :class="{ selected: selected === label.key, self: projection.self.entityRef === label.key }" :style="{ left: label.x + 'px', top: label.y + 'px', width: label.width + 'px', height: label.height + 'px' }" :title="label.label" :aria-label="'选择' + label.label" @click.stop="emit('select', label.key)"><span>{{ label.label }}</span></button><span v-else class="spatial-map-label spatial-map-label-anchor" :style="{ left: label.x + 'px', top: label.y + 'px', width: label.width + 'px', height: label.height + 'px' }">{{ label.label }}</span></template></div>
    </div>
    <button v-if="labels.omitted" class="text-button spatial-map-overflow" @click="emit('objects')">另有 {{ labels.omitted }} 个标记，查看对象与地点</button>
    <p v-if="!immersive || projection.paused || backgroundFailed || layersFailed || doorFailed || missingResources.size || missingObjects.size || invalidObjectState" class="spatial-map-note" role="status">{{ projection.paused ? '等待同伴回来，眼下的准备会保留。' : '点地行走，靠近后再看一看。' }}<template v-if="backgroundFailed || layersFailed || doorFailed || missingResources.size || missingObjects.size"> 部分图像暂未载入，仍可继续操作。<button class="text-button" @click="retryArtwork">重新载入图像</button></template><template v-if="invalidObjectState"> 部分物件状态暂无法显示，仍可继续操作。</template></p>
  </section>
</template>
