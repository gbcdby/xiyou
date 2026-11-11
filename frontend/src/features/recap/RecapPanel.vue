<script setup lang="ts">
import type { AuthorizedProjection } from '../../domain/world.ts';
import { fieldValue } from '../../domain/world.ts';
import AppIcon from '../../components/AppIcon.vue';
defineProps<{ projection: AuthorizedProjection }>();
</script>

<template>
  <section v-if="projection.ending" class="panel recap-panel" aria-labelledby="recap-heading">
    <span class="eyebrow"><AppIcon name="book" :size="16" />本局回顾</span>
    <h2 id="recap-heading">{{ projection.ending.title }}</h2>
    <p>{{ projection.ending.summary }}</p>
    <dl class="fact-grid"><div v-for="field in projection.ending.facts" :key="field.key"><dt>{{ field.label }}</dt><dd>{{ fieldValue(field.value) }}</dd></div></dl>
    <div v-if="projection.ending.unresolved.length" class="unresolved"><h3>仍未厘清</h3><ul><li v-for="item in projection.ending.unresolved" :key="item">{{ item }}</li></ul></div>
    <p class="muted small">本局已结束。以上回顾只展示你有权查看的已确认结果。</p>
  </section>
</template>
