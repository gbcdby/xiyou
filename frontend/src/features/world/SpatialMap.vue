<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { Position, SnapshotV2 } from '../../../../game/spatial-types.ts';
import { ConfirmedMotion } from '../../domain/spatial-motion.ts';
const props = defineProps<{ snapshot: SnapshotV2; disabled: boolean; selected?: string }>();
const emit = defineEmits<{ move: [position: Position]; select: [reference: string]; stop: []; settled: [value: { viewId: string; epoch: string; sequence: string; position: Position }] }>();
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
onBeforeUnmount(() => { if (frame) cancelAnimationFrame(frame); });
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
    <svg v-if="scene" ref="svg" class="spatial-map" data-testid="spatial-map" :viewBox="box" tabindex="0" role="application" aria-label="行走地图，点击地面或使用方向键移动，Escape停步" @click="click" @keydown="keyboard">
      <defs><mask v-for="(obstacle, index) in scene.obstacles" :id="`obstacle-mask-${index}`" :key="obstacle.obstacleId" maskUnits="userSpaceOnUse" :x="0" :y="0" :width="scene.width" :height="scene.height"><rect :width="scene.width" :height="scene.height" fill="white" /><template v-for="area in scene.walkableAreas" :key="area.areaId"><polygon v-if="obstacle.exceptAreas.includes(area.areaId)" :points="points(area.polygon)" fill="black" /></template></mask></defs>
      <rect :width="scene.width" :height="scene.height" fill="#d9dfd6" />
      <polygon v-for="area in scene.walkableAreas" :key="area.areaId" :points="points(area.polygon)" class="spatial-ground" />
      <polygon v-for="(obstacle, index) in scene.obstacles" :key="obstacle.obstacleId" :points="points(obstacle.polygon)" class="spatial-obstacle" :mask="`url(#obstacle-mask-${index})`" />
      <g v-for="anchor in scene.anchors" :key="anchor.anchorId" class="spatial-anchor"><circle :cx="anchor.position.x" :cy="anchor.position.y" r="5" /><text :x="anchor.position.x + 9" :y="anchor.position.y - 8">{{ anchor.label }}</text></g>
      <polyline v-if="projection.movement && ['accepted', 'moving'].includes(projection.movement.status)" class="spatial-route" :points="points(projection.movement.path)" />
      <g v-for="target in projection.targets.filter(t => t.sceneId === scene!.sceneId)" :key="target.entityRef" :transform="`translate(${target.position.x} ${target.position.y})`" class="spatial-target" :class="{ selected: selected === target.entityRef }" tabindex="0" role="button" :aria-label="`选择${target.name}`" @click.stop="emit('select', target.entityRef)" @keydown.enter.stop="emit('select', target.entityRef)"><rect x="-13" y="-13" width="26" height="26" rx="4" /><text y="-22" text-anchor="middle">{{ target.name }}</text></g>
      <g v-for="item in groundItems" :key="item.entityRef" :transform="item.location.kind === 'ground' ? `translate(${item.location.position.x} ${item.location.position.y})` : ''" class="spatial-item" :class="{ selected: selected === item.entityRef }" tabindex="0" role="button" :aria-label="`选择${item.name}`" @click.stop="emit('select', item.entityRef)" @keydown.enter.stop="emit('select', item.entityRef)"><path d="M0 -10 L12 0 L0 10 L-12 0 Z" /><text y="-19" text-anchor="middle">{{ item.name }}</text></g>
      <g v-for="(person, personIndex) in people" :key="person.entityRef" :transform="`translate(${person.position!.x} ${person.position!.y})`" :data-spatial-self="person.entityRef === projection.self.entityRef ? 'true' : undefined" class="spatial-person" :class="{ self: person.entityRef === projection.self.entityRef, selected: selected === person.entityRef }" tabindex="0" role="button" :aria-label="`${person.name}${person.entityRef === projection.self.entityRef ? '，本人' : ''}`" @click.stop="emit('select', person.entityRef)" @keydown.enter.stop="emit('select', person.entityRef)"><ellipse cy="13" rx="18" ry="7" class="spatial-shadow" /><circle r="13" /><path d="M0 -28 L-5 -20 L5 -20 Z" :transform="`rotate(${angle(person.facing)})`" class="spatial-facing" /><text text-anchor="middle" y="5" class="spatial-person-initial">{{ person.name.slice(0, 1) }}</text><text text-anchor="middle" :y="-35 - (personIndex % 3) * 17">{{ person.name }}{{ person.entityRef === projection.self.entityRef ? ' · 你' : '' }}</text></g>
    </svg>
    <p class="spatial-map-note">{{ projection.paused ? '等待至少两位真人在线，场景时间已暂停。' : '位置与操作结果由服务器确认。' }}灰盒场景用于验证行走与联机，尚未采用正式角色和场景素材。</p>
  </section>
</template>
