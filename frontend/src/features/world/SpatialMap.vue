<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Position, SnapshotV2 } from '../../../../game/spatial-types.ts';
import { ConfirmedMotion } from '../../domain/spatial-motion.ts';
import { layoutSpatialLabels, screenPosition } from '../../domain/spatial-labels.ts';
import type { SpatialLabelInput } from '../../domain/spatial-labels.ts';
const props = defineProps<{ snapshot: SnapshotV2; disabled: boolean; selected?: string; personLabels?: Record<string, string> }>();
const emit = defineEmits<{ move: [position: Position]; select: [reference: string]; stop: []; objects: []; settled: [value: { viewId: string; epoch: string; sequence: string; position: Position }] }>();
const projection = computed(() => props.snapshot.projection);
const motion = new ConfirmedMotion(); const frameTime = ref(performance.now()); let frame = 0; let settledKey = '';
function draw(now: number) {
  frame = 0; frameTime.value = now; const p = projection.value;
  if (p.movement?.status === 'arrived' && p.self.position && motion.settled(p.self.entityRef, now)) {
    const key = `${props.snapshot.viewId}:${p.self.controlEpoch}:${p.movement.movementCommandSeq}`;
    if (key !== settledKey) { settledKey = key; emit('settled', { viewId: props.snapshot.viewId, epoch: p.self.controlEpoch, sequence: p.movement.movementCommandSeq, position: p.self.position }); }
  }
  if (motion.active(now)) frame = requestAnimationFrame(draw);
}
watch(() => props.snapshot, snapshot => { if (frame) cancelAnimationFrame(frame); const now = performance.now(); motion.update(snapshot, now); draw(now); }, { immediate: true, flush: 'sync' });
const viewport = ref<HTMLElement | null>(null);
const viewportSize = ref({ width: 0, height: 0 });
let resize: ResizeObserver | null = null;
onMounted(() => {
  resize = new ResizeObserver(() => { const rect = viewport.value?.getBoundingClientRect(); if (rect) viewportSize.value = { width: rect.width, height: rect.height }; });
  if (viewport.value) resize.observe(viewport.value);
});
watch(viewport, (element, previous) => { if (previous) resize?.unobserve(previous); if (element) resize?.observe(element); });
onBeforeUnmount(() => { if (frame) cancelAnimationFrame(frame); resize?.disconnect(); });
const svg = ref<SVGSVGElement | null>(null); const follow = ref(true);
const scene = computed(() => projection.value.scene);
const people = computed(() => [...projection.value.entities.filter(e => e.entityRef !== projection.value.self.entityRef), projection.value.self].filter(e => e.sceneId === scene.value?.sceneId && e.position).map(e => ({ ...e, position: motion.position(e.entityRef, frameTime.value) || e.position })));
const groundItems = computed(() => projection.value.items.filter(i => i.location.kind === 'ground' && i.location.sceneId === scene.value?.sceneId));
const box = computed(() => {
  const map = scene.value; if (!map) return '0 0 1000 700';
  const position = motion.position(projection.value.self.entityRef, frameTime.value) || projection.value.self.position;
  if (!follow.value || !position) return `0 0 ${map.width} ${map.height}`;
  const width = Math.min(map.width, 1000); const height = Math.min(map.height, 700);
  const x = Math.max(0, Math.min(map.width - width, position.x - width / 2));
  const y = Math.max(0, Math.min(map.height - height, position.y - height / 2));
  return `${x} ${y} ${width} ${height}`;
});
const labels = computed(() => {
  const [x, y, width, height] = box.value.split(' ').map(Number);
  const view = { x, y, width, height }; const size = viewportSize.value;
  const inputs: SpatialLabelInput[] = [];
  function add(key: string, label: string, position: Position, kind: 'person' | 'object' | 'anchor') {
    const point = screenPosition(position, view, size);
    if (point.x < 0 || point.y < 0 || point.x > size.width || point.y > size.height) return;
    const radius = (kind === 'anchor' ? 6 : 20) * point.scale;
    const above = (kind === 'person' ? 30 : kind === 'anchor' ? 6 : 16) * point.scale;
    const below = (kind === 'person' ? 20 : kind === 'anchor' ? 6 : 16) * point.scale;
    inputs.push({ key, label, point, footprint: { x: point.x - radius, y: point.y - above, width: radius * 2, height: above + below }, selectable: kind !== 'anchor', priority: key === projection.value.self.entityRef || key === props.selected ? 0 : kind === 'person' ? 1 : kind === 'object' ? 2 : 3 });
  }
  for (const person of people.value) if (person.position) add(person.entityRef, (props.personLabels?.[person.entityRef] || person.name) + (person.entityRef === projection.value.self.entityRef ? ' · 你' : ''), person.position, 'person');
  for (const target of projection.value.targets) if (target.sceneId === scene.value?.sceneId) add(target.entityRef, target.name, target.position, 'object');
  for (const item of groundItems.value) if (item.location.kind === 'ground') add(item.entityRef, item.name, item.location.position, 'object');
  for (const anchor of scene.value?.anchors || []) add('anchor:' + anchor.anchorId, anchor.label, anchor.position, 'anchor');
  return layoutSpatialLabels(inputs, size);
});
const points = (values: Position[]) => values.map(p => `${p.x},${p.y}`).join(' ');
const angle = (facing: string) => ({ N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 })[facing] || 0;
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
    <header class="spatial-map-toolbar"><div><strong>{{ scene?.name || '等待场景' }}</strong><span>点地行走 · 选中物件后靠近操作</span></div><div class="button-row"><button class="secondary-button" @click="follow = !follow">{{ follow ? '查看全图' : '跟随角色' }}</button><button class="secondary-button" @click="follow = true">回到角色</button></div></header>
    <div v-if="scene" ref="viewport" class="spatial-map-viewport">
    <svg ref="svg" class="spatial-map" data-testid="spatial-map" :viewBox="box" tabindex="0" role="application" aria-label="行走地图，点击地面或使用方向键移动，Escape停步" @click="click" @keydown="keyboard">
      <defs><mask v-for="(obstacle, index) in scene.obstacles" :id="`obstacle-mask-${index}`" :key="obstacle.obstacleId" maskUnits="userSpaceOnUse" :x="0" :y="0" :width="scene.width" :height="scene.height"><rect :width="scene.width" :height="scene.height" fill="white" /><template v-for="area in scene.walkableAreas" :key="area.areaId"><polygon v-if="obstacle.exceptAreas.includes(area.areaId)" :points="points(area.polygon)" fill="black" /></template></mask></defs>
      <rect :width="scene.width" :height="scene.height" fill="#d9dfd6" />
      <polygon v-for="area in scene.walkableAreas" :key="area.areaId" :points="points(area.polygon)" class="spatial-ground" />
      <polygon v-for="(obstacle, index) in scene.obstacles" :key="obstacle.obstacleId" :points="points(obstacle.polygon)" class="spatial-obstacle" :mask="`url(#obstacle-mask-${index})`" />
      <g v-for="anchor in scene.anchors" :key="anchor.anchorId" class="spatial-anchor"><circle :cx="anchor.position.x" :cy="anchor.position.y" r="5" /></g>
      <polyline v-if="projection.movement && ['accepted', 'moving'].includes(projection.movement.status)" class="spatial-route" :points="points(projection.movement.path)" />
      <g v-for="target in projection.targets.filter(t => t.sceneId === scene!.sceneId)" :key="target.entityRef" :transform="`translate(${target.position.x} ${target.position.y})`" class="spatial-target" :class="{ selected: selected === target.entityRef }" tabindex="0" role="button" :aria-label="`选择${target.name}`" @click.stop="emit('select', target.entityRef)" @keydown.enter.stop="emit('select', target.entityRef)"><rect x="-13" y="-13" width="26" height="26" rx="4" /></g>
      <g v-for="item in groundItems" :key="item.entityRef" :transform="item.location.kind === 'ground' ? `translate(${item.location.position.x} ${item.location.position.y})` : ''" class="spatial-item" :class="{ selected: selected === item.entityRef }" tabindex="0" role="button" :aria-label="`选择${item.name}`" @click.stop="emit('select', item.entityRef)" @keydown.enter.stop="emit('select', item.entityRef)"><path d="M0 -10 L12 0 L0 10 L-12 0 Z" /></g>
      <g v-for="person in people" :key="person.entityRef" :transform="`translate(${person.position!.x} ${person.position!.y})`" :data-spatial-self="person.entityRef === projection.self.entityRef ? 'true' : undefined" class="spatial-person" :class="{ self: person.entityRef === projection.self.entityRef, selected: selected === person.entityRef }" tabindex="0" role="button" :aria-label="`${personLabels?.[person.entityRef] || person.name}${person.entityRef === projection.self.entityRef ? '，本人' : ''}`" @click.stop="emit('select', person.entityRef)" @keydown.enter.stop="emit('select', person.entityRef)"><ellipse cy="13" rx="18" ry="7" class="spatial-shadow" /><circle r="13" /><path d="M0 -28 L-5 -20 L5 -20 Z" :transform="`rotate(${angle(person.facing)})`" class="spatial-facing" /><text text-anchor="middle" y="5" class="spatial-person-initial">{{ person.name.slice(0, 1) }}</text></g>
    </svg>
    <svg class="spatial-label-guides" :viewBox="'0 0 ' + viewportSize.width + ' ' + viewportSize.height" aria-hidden="true"><line v-for="label in labels.labels" :key="label.key" :x1="label.point.x" :y1="label.point.y" :x2="label.lineX" :y2="label.lineY" /></svg>
    <div class="spatial-map-labels"><template v-for="label in labels.labels" :key="label.key"><button v-if="label.selectable" class="spatial-map-label" :class="{ selected: selected === label.key, self: projection.self.entityRef === label.key }" :style="{ left: label.x + 'px', top: label.y + 'px', width: label.width + 'px', height: label.height + 'px' }" :title="label.label" :aria-label="'选择' + label.label" @click.stop="emit('select', label.key)"><span>{{ label.label }}</span></button><span v-else class="spatial-map-label spatial-map-label-anchor" :style="{ left: label.x + 'px', top: label.y + 'px', width: label.width + 'px', height: label.height + 'px' }">{{ label.label }}</span></template></div>
    </div>
    <button v-if="labels.omitted" class="text-button spatial-map-overflow" @click="emit('objects')">另有 {{ labels.omitted }} 个标记，查看对象与地点</button>
    <p class="spatial-map-note">{{ projection.paused ? '等待至少两位真人在线，场景时间已暂停。' : '位置与操作结果由服务器确认。' }}灰盒场景用于验证行走与联机，尚未采用正式角色和场景素材。</p>
  </section>
</template>
