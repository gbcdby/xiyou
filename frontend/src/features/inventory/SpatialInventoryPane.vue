<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { EntityViewV2, ItemViewV2, SnapshotV2 } from '../../../../game/spatial-types.ts';
import SpatialFieldList from '../../components/SpatialFieldList.vue';
import SpatialObjectArt from '../world/SpatialObjectArt.vue';
import { objectArtContext, objectInstanceKey, objectVisualVariant, selectObjectArt } from '../../domain/gaolao-object-art.ts';
const props = defineProps<{ inventory: ItemViewV2[]; people: EntityViewV2[]; personLabels: Record<string, string>; canAct: boolean; recipient: string; snapshot?: SnapshotV2 }>();
defineEmits<{ recipient: [reference: string]; put: [item: ItemViewV2]; transfer: [item: ItemViewV2] }>();
const context = computed(() => props.snapshot ? objectArtContext(props.snapshot) : null);
const attempt = ref(0), failures = ref(new Set<string>());
const keys = computed(() => new Set(context.value ? props.inventory.map(item => objectInstanceKey(context.value!, item)) : []));
const invalidState = computed(() => context.value && props.inventory.some(item => objectVisualVariant(item, context.value!, 'inventory') === 'invalid'));
function resource(value: { instanceKey: string; failed: boolean }) {
  const next = new Set(failures.value);
  if (value.failed && keys.value.has(value.instanceKey)) next.add(value.instanceKey); else next.delete(value.instanceKey);
  failures.value = next;
}
watch(keys, active => { failures.value = new Set([...failures.value].filter(key => active.has(key))); });
function retry() { failures.value = new Set(); attempt.value++; }
</script>

<template>
  <div class="spatial-inventory-pane">
    <p v-if="!inventory.length" class="muted">暂未携带可见物件。</p>
    <template v-else>
      <p class="spatial-panel-intro">交接前请选定眼前的人。物件要实际交到对方手中才算完成。</p>
      <label class="field-label" for="transfer-recipient">交接给</label>
      <select id="transfer-recipient" :value="recipient" :disabled="!canAct" @change="$emit('recipient', ($event.target as HTMLSelectElement).value)"><option value="">选择当前可见对象</option><option v-for="person in people" :key="person.entityRef" :value="person.entityRef">{{ personLabels[person.entityRef] || person.name }}</option></select>
      <ul class="spatial-inventory"><li v-for="held in inventory" :key="context ? objectInstanceKey(context, held) : held.entityRef"><svg v-if="context && selectObjectArt(held, context, 'inventory')" class="spatial-inventory-art" viewBox="-20 -20 40 40" aria-hidden="true"><SpatialObjectArt :frame="selectObjectArt(held, context, 'inventory')" :instance-key="objectInstanceKey(context, held)" :attempt="attempt" @resource="resource"><path d="M0 -10 L12 0 L0 10 L-12 0 Z" fill="#f7d898" stroke="#976d35" /></SpatialObjectArt></svg><h3>{{ held.name }}</h3><p class="spatial-item-kind">{{ held.publicBorrowable ? '公用借物' : '随身保管' }}</p><SpatialFieldList :fields="held.fields" /><div class="button-row"><button class="text-button" :disabled="!canAct" @click="$emit('put', held)">放在脚边</button><button class="secondary-button" :disabled="!canAct || !recipient || !held.transferable" @click="$emit('transfer', held)">交给对方</button></div></li></ul>
      <p v-if="failures.size" role="status">部分图像暂未载入，仍可继续操作。<button class="text-button" @click="retry">重新载入图像</button></p>
      <p v-if="invalidState" role="status">部分物件状态暂无法显示，仍可继续操作。</p>
    </template>
  </div>
</template>
