<script setup lang="ts">
withDefaults(defineProps<{ label: string; tone?: 'confirmed' | 'pending' | 'uncertain' | 'paused' | 'withdrawn' | 'neutral' }>(), { tone: 'neutral' });
const symbols = { confirmed: '✓', pending: '◇', uncertain: '?', paused: 'Ⅱ', withdrawn: '—', neutral: '·' };
</script>

<template>
  <span class="spatial-status" :class="`spatial-status-${tone}`"><span aria-hidden="true">{{ symbols[tone] }}</span>{{ label }}</span>
</template>
