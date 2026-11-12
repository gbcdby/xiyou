<script setup lang="ts">
import type { EntityViewV2, ItemViewV2 } from '../../../../game/spatial-types.ts';
import SpatialFieldList from '../../components/SpatialFieldList.vue';
defineProps<{ inventory: ItemViewV2[]; people: EntityViewV2[]; personLabels: Record<string, string>; canAct: boolean; recipient: string }>();
defineEmits<{ recipient: [reference: string]; put: [item: ItemViewV2]; transfer: [item: ItemViewV2] }>();
</script>

<template>
  <div class="spatial-inventory-pane">
    <p v-if="!inventory.length" class="muted">暂未携带可见物件。</p>
    <template v-else>
      <p class="spatial-panel-intro">交接前请选定眼前的人。物件要实际交到对方手中才算完成。</p>
      <label class="field-label" for="transfer-recipient">交接给</label>
      <select id="transfer-recipient" :value="recipient" :disabled="!canAct" @change="$emit('recipient', ($event.target as HTMLSelectElement).value)"><option value="">选择当前可见对象</option><option v-for="person in people" :key="person.entityRef" :value="person.entityRef">{{ personLabels[person.entityRef] || person.name }}</option></select>
      <ul class="spatial-inventory"><li v-for="held in inventory" :key="held.entityRef"><h3>{{ held.name }}</h3><p class="spatial-item-kind">{{ held.publicBorrowable ? '公用借物' : '随身保管' }}</p><SpatialFieldList :fields="held.fields" /><div class="button-row"><button class="text-button" :disabled="!canAct" @click="$emit('put', held)">放在脚边</button><button class="secondary-button" :disabled="!canAct || !recipient || !held.transferable" @click="$emit('transfer', held)">交给对方</button></div></li></ul>
    </template>
  </div>
</template>
