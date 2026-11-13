<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import type { ObjectArtFrame } from '../../domain/gaolao-object-art.ts';

const props = defineProps<{ frame: ObjectArtFrame | null; instanceKey: string; attempt: number }>();
const emit = defineEmits<{ resource: [value: { instanceKey: string; failed: boolean }] }>();
const ready = ref(false), source = ref('');
let request: HTMLImageElement | null = null, owner = '';
function cancel() {
  if (request) { request.onload = null; request.onerror = null; request = null; }
  if (owner) emit('resource', { instanceKey: owner, failed: false });
  ready.value = false;
}
function displayFailure(event: Event) {
  if ((event.currentTarget as SVGImageElement).getAttribute('href') !== source.value) return;
  ready.value = false; emit('resource', { instanceKey: owner, failed: true });
}
watch([() => props.instanceKey, () => JSON.stringify(props.frame), () => props.attempt], () => {
  cancel(); owner = props.instanceKey;
  const frame = props.frame;
  if (!frame) return;
  const image = new Image(), instanceKey = owner; request = image;
  source.value = props.attempt ? `${frame.file}?retry=${props.attempt}` : frame.file;
  const unavailable = () => {
    if (request !== image) return;
    ready.value = false; emit('resource', { instanceKey, failed: true });
  };
  image.onload = async () => {
    if (request !== image) return;
    try {
      await image.decode();
      if (request !== image) return;
      if (!image.naturalWidth || !image.naturalHeight) { unavailable(); return; }
      ready.value = true; emit('resource', { instanceKey, failed: false });
    } catch { unavailable(); }
  };
  image.onerror = unavailable;
  image.src = source.value;
}, { immediate: true, flush: 'sync' });
onBeforeUnmount(cancel);
</script>

<template>
  <g class="spatial-object-art" :data-object-instance="instanceKey" :data-object-variant="ready && frame ? frame.variant : undefined" :data-art-layer="ready && frame ? frame.layer : undefined" aria-hidden="true">
    <image v-if="ready && frame" :href="source" :x="frame.bounds.x" :y="frame.bounds.y" :width="frame.bounds.width" :height="frame.bounds.height" pointer-events="none" @error="displayFailure" />
    <slot v-else />
  </g>
</template>
