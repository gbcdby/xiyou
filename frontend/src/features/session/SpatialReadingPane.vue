<script setup lang="ts">
import AppIcon from '../../components/AppIcon.vue';
defineProps<{ title: string; closeLabel: string }>();
defineEmits<{ close: [] }>();
</script>

<template>
  <section id="spatial-reading-pane" class="panel spatial-reading-pane" aria-labelledby="spatial-reading-title">
    <header class="spatial-reading-heading"><h2 id="spatial-reading-title" tabindex="-1">{{ title }}</h2><button class="icon-button" :aria-label="closeLabel" @click="$emit('close')"><AppIcon name="x" /></button></header>
    <div class="spatial-reading-content"><slot /></div>
  </section>
</template>
