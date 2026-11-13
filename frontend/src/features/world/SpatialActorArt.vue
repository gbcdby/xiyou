<script setup lang="ts">
import { computed, onBeforeUnmount, shallowReactive, watch } from 'vue';
import type { Facing } from '../../../../game/spatial-types.ts';
import { spriteForAppearance, spriteResourcePaths } from '../../domain/gaolao-art.ts';
import { spriteHitRegion, type SpriteHitRegion } from '../../domain/sprite-hit-region.ts';

const props = defineProps<{ appearanceId?: string; facing: Facing; moving: boolean; distance: number; reducedMotion: boolean; attempt: number }>();
const emit = defineEmits<{ resource: [value: { file: string; available: boolean }] }>();
const ready = shallowReactive(new Set<string>());
const failed = shallowReactive(new Set<string>());
const regions = shallowReactive(new Map<string, SpriteHitRegion>());
const requests = new Map<string, HTMLImageElement>();
const source = (file: string) => props.attempt ? `${file}?retry=${props.attempt}` : file;
watch([() => props.appearanceId, () => props.attempt], () => {
  for (const request of requests.values()) { request.onload = null; request.onerror = null; }
  requests.clear(); ready.clear(); failed.clear(); regions.clear();
  for (const file of spriteResourcePaths(props.appearanceId)) {
    const request = new Image(); requests.set(file, request);
    const unavailable = () => { if (requests.get(file) !== request) return; ready.delete(file); regions.delete(file); failed.add(file); emit('resource', { file, available: false }); };
    request.onload = () => {
      if (requests.get(file) !== request) return;
      try {
        const canvas = document.createElement('canvas'); canvas.width = request.naturalWidth; canvas.height = request.naturalHeight;
        const context = canvas.getContext('2d'); if (!context) throw new Error('图像像素不可读取');
        context.drawImage(request, 0, 0);
        const region = spriteHitRegion(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
        if (!region.path) throw new Error('图像没有可见身体');
        regions.set(file, region); ready.add(file); failed.delete(file); emit('resource', { file, available: true });
      } catch { unavailable(); }
    };
    request.onerror = unavailable;
    request.src = source(file);
  }
}, { immediate: true });
onBeforeUnmount(() => { for (const request of requests.values()) { request.onload = null; request.onerror = null; } });
const art = computed(() => {
  const frame = spriteForAppearance(props.appearanceId, props.facing, props.moving, props.distance, props.reducedMotion);
  if (frame && ready.has(frame.href) && !failed.has(frame.href)) return frame;
  const idle = spriteForAppearance(props.appearanceId, props.facing, false, 0);
  return idle && ready.has(idle.href) && !failed.has(idle.href) ? idle : null;
});
const region = computed(() => art.value ? regions.get(art.value.href) : null);
</script>

<template>
  <g v-if="art" class="spatial-actor-art" :transform="art.mirrorX ? 'scale(-1 1)' : undefined" :data-art-frame="art.href" :data-art-moving="moving && !reducedMotion ? 'true' : 'false'" aria-hidden="true">
    <image :href="source(art.href)" :x="art.bounds.x" :y="art.bounds.y" :width="art.bounds.width" :height="art.bounds.height" />
    <path v-if="region" class="spatial-actor-body-hit" :d="region.path" :transform="`translate(${art.bounds.x} ${art.bounds.y}) scale(${art.bounds.width / region.width} ${art.bounds.height / region.height})`" />
  </g>
  <g v-else class="spatial-actor-fallback" data-art-fallback="true" aria-hidden="true">
    <ellipse cy="-64" rx="8" ry="9" /><path d="M-7 -54 Q-15 -48 -16 -24 L-12 -12 L-12 -2 L-3 -2 L0 -21 L4 -2 L13 -2 L12 -15 L16 -23 Q14 -48 7 -54 Z" />
    <path d="M-6 -74 Q0 -82 6 -74 L7 -70 L-7 -70 Z" />
  </g>
</template>
