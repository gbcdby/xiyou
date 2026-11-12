<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { GaolaoInteractionV2, ObservationViewV2, TargetViewV2 } from '../../../../game/spatial-types.ts';
import { comparisonAction } from '../../domain/gaolao-actions.ts';
import SpatialFieldList from '../../components/SpatialFieldList.vue';
import SpatialStatus from '../../components/SpatialStatus.vue';
const props = defineProps<{ target: TargetViewV2 | null; observations: ObservationViewV2[]; canAct: boolean; viewKey: string }>();
const emit = defineEmits<{ action: [action: GaolaoInteractionV2] }>();
const selected = ref<string[]>([]);
const candidates = computed(() => props.observations.filter(observation => observation.source && ['archive', 'testimony'].includes(observation.source.kind)));
const action = computed(() => comparisonAction(props.target, selected.value, props.observations, props.canAct));
watch(() => props.viewKey, () => { selected.value = []; });
watch(candidates, observations => { selected.value = selected.value.filter(reference => observations.some(observation => observation.observationRef === reference)); });
function submit() { if (action.value) emit('action', action.value); }
</script>

<template>
  <section class="gaolao-comparison">
    <h3>核对材料的来源与时间</h3><p class="spatial-panel-intro">选一份旧账记录和一份独立见闻。比较结果须等现场核实，材料不会替任何人作出决定。</p>
    <p v-if="!candidates.length" class="muted">当前还没有获准比较的材料。</p>
    <label v-for="observation in candidates" :key="observation.observationRef" class="gaolao-source-card"><span class="gaolao-source-choice"><input v-model="selected" type="checkbox" :value="observation.observationRef" :disabled="!canAct"><strong>{{ observation.source!.label }}</strong></span><SpatialStatus :label="observation.category === 'WorldFact' ? '世界事实' : observation.category === 'Evidence' ? '证据' : '他人陈述'" :tone="observation.category === 'WorldFact' ? 'confirmed' : 'pending'" /><span class="gaolao-source-time">来客到访前 {{ observation.source!.beforeArrivalDays }} 天</span><p>{{ observation.statement }}</p><SpatialFieldList :fields="observation.fields" /></label>
    <p v-if="selected.length && !action" class="muted">需要两份当前可用、原始来源不同的旧账与见闻，并到可比较的地点操作。</p>
    <button class="primary-button" :disabled="!action" @click="submit">提交来源比较</button>
  </section>
</template>

<style scoped>
.gaolao-comparison h3 { margin-top: 0; font-size: 18px; }.gaolao-source-card { display: block; margin: 14px 0; padding: 14px; border: 1px solid #cbb993; border-radius: 8px; line-height: 1.75; overflow-wrap: anywhere; }.gaolao-source-choice { display: flex; align-items: center; gap: 10px; min-height: 44px; }.gaolao-source-choice input { flex: 0 0 auto; width: 20px; height: 20px; }.gaolao-source-time { display: block; margin-top: 6px; font-size: 14px; color: #74644f; }
</style>
