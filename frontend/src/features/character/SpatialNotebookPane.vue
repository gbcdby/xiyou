<script setup lang="ts">
import type { EntityViewV2, ObservationViewV2 } from '../../../../game/spatial-types.ts';
import SpatialFieldList from '../../components/SpatialFieldList.vue';
import SpatialStatus from '../../components/SpatialStatus.vue';
defineProps<{ observations: ObservationViewV2[]; people: EntityViewV2[]; personLabels: Record<string, string>; canAct: boolean; recipient: string }>();
defineEmits<{ recipient: [reference: string]; share: [observation: ObservationViewV2] }>();
</script>

<template>
  <div class="spatial-notebook">
    <p class="spatial-panel-intro">陈述、证据与已确认事实分别记下。听闻不等于核实，分享也不替人物作出决定。</p>
    <p v-if="!observations.length" class="muted">当前没有可阅读的记录。</p>
    <template v-else>
      <label class="field-label" for="evidence-recipient">分享给</label><select id="evidence-recipient" :value="recipient" :disabled="!canAct" @change="$emit('recipient', ($event.target as HTMLSelectElement).value)"><option value="">选择当前可见对象</option><option v-for="person in people" :key="person.entityRef" :value="person.entityRef">{{ personLabels[person.entityRef] || person.name }}</option></select>
      <article v-for="observation in observations" :key="observation.observationRef"><SpatialStatus :label="observation.category === 'WorldFact' ? '世界事实' : observation.category === 'Evidence' ? '证据' : '他人陈述'" :tone="observation.category === 'WorldFact' ? 'confirmed' : 'pending'" /><p class="spatial-record-statement">{{ observation.statement }}</p><p v-if="observation.source" class="spatial-record-source">来源：{{ observation.source.label }}<span>来客到访前 {{ observation.source.beforeArrivalDays }} 天</span></p><SpatialFieldList :fields="observation.fields" /><button v-if="observation.shareable" class="text-button" :disabled="!canAct || !recipient" @click="$emit('share', observation)">分享给选定对象</button></article>
    </template>
  </div>
</template>
