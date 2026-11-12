<script setup lang="ts">
import { computed } from 'vue';
import type { EndingViewV2 } from '../../../../game/spatial-types.ts';
import type { SpatialRecapState } from '../../network/spatial-recap-client.ts';
import SpatialFieldList from '../../components/SpatialFieldList.vue';
import SpatialStatus from '../../components/SpatialStatus.vue';
const props = defineProps<{ state: SpatialRecapState; ending: EndingViewV2 | null }>();
defineEmits<{ load: [] }>();
const visibleEnding = computed(() => props.state.status === 'forbidden' ? null : props.state.ending || props.ending);
const visibleEntries = computed(() => props.state.status === 'forbidden' ? [] : props.state.entries);
</script>

<template>
  <div class="gaolao-recap">
    <section v-if="visibleEnding" class="gaolao-recap-ending"><SpatialStatus v-if="visibleEnding.endingCode" :label="visibleEnding.endingCode === 'GZ-E01' ? '自愿同行' : visibleEnding.endingCode === 'GZ-E02' ? '各走各路' : '暂告一段'" :tone="visibleEnding.endingCode === 'GZ-E03' ? 'paused' : 'confirmed'" /><h3>{{ visibleEnding.title }}</h3><p>{{ visibleEnding.summary }}</p><SpatialFieldList :fields="visibleEnding.facts || []" /></section>
    <h3>你有权查看的过程</h3><p class="spatial-panel-intro">保留发生时的称呼与已知内容。陈述、材料和实际发生的事分别记下。</p>
    <p v-if="state.message" class="notice warning" role="status">{{ state.message }}</p>
    <ol class="gaolao-recap-entries"><li v-for="entry in visibleEntries" :key="entry.entryRef"><SpatialStatus :label="entry.category === 'WorldFact' ? '已确认事实' : entry.category === 'Evidence' ? '证据' : '陈述'" :tone="entry.category === 'WorldFact' ? 'confirmed' : 'pending'" /><p v-if="entry.speakerName" class="gaolao-recap-speaker">当时称呼：{{ entry.speakerName }}</p><p>{{ entry.text }}</p><SpatialFieldList :fields="entry.fields" /></li></ol>
    <p v-if="state.complete && state.status !== 'forbidden'" class="muted">你有权查看的过程已读完。</p><p v-else-if="visibleEntries.length" class="muted">过程还未读完。</p>
    <button v-if="state.status !== 'forbidden' && !state.complete" class="secondary-button" :disabled="state.status === 'loading'" @click="$emit('load')">{{ state.status === 'loading' ? '正在读取…' : state.status === 'error' || state.status === 'unavailable' ? '重试读取过程' : state.entries.length ? '再看更早的过程' : '读取本局过程' }}</button>
  </div>
</template>

<style scoped>
.gaolao-recap h3 { font-size: 18px; }.gaolao-recap p { line-height: 1.8; overflow-wrap: anywhere; white-space: pre-wrap; }.gaolao-recap-ending { padding-bottom: 20px; border-bottom: 1px solid #cbb993; }.gaolao-recap-entries { list-style: none; margin: 0; padding: 0; }.gaolao-recap-entries li { padding: 16px 0; border-bottom: 1px solid #ddd1b7; }.gaolao-recap-speaker { color: #74644f; font-size: 14px; }
</style>
