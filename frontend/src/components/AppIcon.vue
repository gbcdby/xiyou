<script setup lang="ts">
defineProps<{ name: string; size?: number }>();
const paths: Record<string, string> = {
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  bag: 'M6 7h12l2 13H4L6 7Zm3 0V5a3 3 0 0 1 6 0v2',
  book: 'M4 4h6a3 3 0 0 1 2 1 3 3 0 0 1 2-1h6v15h-6a3 3 0 0 0-2 1 3 3 0 0 0-2-1H4V4Zm8 1v15',
  chat: 'M4 4h16v12H9l-5 4V4Z',
  check: 'm5 12 4 4L19 6',
  clock: 'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  compass: 'm16 8-3 5-5 3 3-5 5-3ZM21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  group: 'M8 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-1a3 3 0 1 0 0-6M2 20v-2a5 5 0 0 1 10 0v2m3-6a5 5 0 0 1 7 4v2',
  leaf: 'M20 3C8 2 3 7 4 14c1 6 7 7 11 3 3-3 4-9 5-14ZM4 21 15 9',
  link: 'm9 15 6-6M8 14l-2 2a3 3 0 0 0 4 4l4-4a3 3 0 0 0 0-4m2-2 2-2a3 3 0 0 0-4-4l-4 4a3 3 0 0 0 0 4',
  location: 'M19 9c0 5-7 12-7 12S5 14 5 9a7 7 0 1 1 14 0Zm-5 0a2 2 0 1 0-4 0 2 2 0 0 0 4 0Z',
  refresh: 'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2M5 16a8 8 0 0 0 13 2',
  send: 'm3 3 19 9-19 9 4-9-4-9Zm4 9h15',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6',
  spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
  warn: 'M12 3 2 21h20L12 3Zm0 6v5m0 3v1',
  x: 'm6 6 12 12M18 6 6 18',
};
</script>

<template>
  <svg :width="size || 20" :height="size || 20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path :d="paths[name] || paths.leaf" />
  </svg>
</template>
