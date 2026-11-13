<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { objectArtRequestKey } from '../../domain/gaolao-object-art.ts';
import type { ObjectArtFrame, ObjectArtResourceState } from '../../domain/gaolao-object-art.ts';

const props = defineProps<{ frame: ObjectArtFrame | null; instanceKey: string; attempt: number }>();
const emit = defineEmits<{ resource: [value: ObjectArtResourceState] }>();
const ready = ref(false), source = ref('');
const displayedImage = ref<SVGImageElement | null>(null);
let request: HTMLImageElement | null = null, owner: ObjectArtResourceState | null = null;
function cancel() {
  if (request) { request.onload = null; request.onerror = null; request = null; }
  ready.value = false;
  if (owner) emit('resource', { ...owner, ready: false, failed: false });
}
function displayFailure(event: Event) {
  if (!ready.value || !owner || event.currentTarget !== displayedImage.value || displayedImage.value?.getAttribute('href') !== source.value) return;
  ready.value = false; emit('resource', { ...owner, ready: false, failed: true });
}
watch([() => props.instanceKey, () => JSON.stringify(props.frame), () => props.attempt], () => {
  cancel();
  const frame = props.frame;
  owner = { instanceKey: props.instanceKey, requestKey: objectArtRequestKey(props.instanceKey, frame, props.attempt), ready: false, failed: false };
  emit('resource', owner);
  if (!frame) return;
  const image = new Image(), state = owner; request = image;
  source.value = props.attempt ? `${frame.file}?retry=${props.attempt}` : frame.file;
  const unavailable = () => {
    if (request !== image) return;
    ready.value = false; emit('resource', { ...state, ready: false, failed: true });
  };
  image.onload = async () => {
    if (request !== image) return;
    try {
      await image.decode();
      if (request !== image) return;
      if (!image.naturalWidth || !image.naturalHeight) { unavailable(); return; }
      ready.value = true; emit('resource', { ...state, ready: true, failed: false });
    } catch { unavailable(); }
  };
  image.onerror = unavailable;
  image.src = source.value;
}, { immediate: true, flush: 'sync' });
onBeforeUnmount(cancel);
</script>

<template>
  <g class="spatial-object-art" :data-object-instance="instanceKey" :data-object-variant="ready && frame ? frame.variant : undefined" :data-art-layer="ready && frame ? frame.layer : undefined" aria-hidden="true">
    <image v-if="ready && frame" ref="displayedImage" :href="source" :x="frame.bounds.x" :y="frame.bounds.y" :width="frame.bounds.width" :height="frame.bounds.height" pointer-events="none" @error="displayFailure" />
    <slot v-else />
  </g>
</template>
