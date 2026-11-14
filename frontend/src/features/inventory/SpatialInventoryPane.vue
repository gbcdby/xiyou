<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { gaolaoPersonalProfile } from '../../../../protocol/spatial.mjs';
import type { ActionV2, EntityViewV2, ItemViewV2, PrivateReturnViewV1, SnapshotV2 } from '../../../../game/spatial-types.ts';
import SpatialFieldList from '../../components/SpatialFieldList.vue';
import SpatialObjectArt from '../world/SpatialObjectArt.vue';
import { objectArtContext, objectInstanceKey, objectVisualVariant, selectObjectArt } from '../../domain/gaolao-object-art.ts';
import { privateReturnAction, privateReturnEntries } from '../../domain/gaolao-actions.ts';
const props = defineProps<{ inventory: ItemViewV2[]; people: EntityViewV2[]; personLabels: Record<string, string>; canAct: boolean; recipient: string; snapshot?: SnapshotV2 }>();
const emit = defineEmits<{ recipient: [reference: string]; put: [item: ItemViewV2]; transfer: [item: ItemViewV2]; action: [action: ActionV2] }>();
const context = computed(() => props.snapshot ? objectArtContext(props.snapshot) : null);
const personal = computed(() => Boolean(gaolaoPersonalProfile(props.snapshot?.projection)));
const returns = computed(() => new Map(privateReturnEntries(props.snapshot?.projection).map(entry => [entry.item.entityRef, entry.context])));
const hasOrdinaryItems = computed(() => props.inventory.some(item => !returns.value.has(item.entityRef)));
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
function returnAction(value: PrivateReturnViewV1, destination: 'owner' | 'origin') {
  return props.snapshot ? privateReturnAction(props.snapshot.projection, value.returnContextId, destination, props.canAct) : null;
}
function submitReturn(value: PrivateReturnViewV1, destination: 'owner' | 'origin') { const action = returnAction(value, destination); if (action) emit('action', action); }
</script>

<template>
  <div class="spatial-inventory-pane">
    <p v-if="!inventory.length" class="muted">暂未携带可见物件。</p>
    <p v-if="personal && !returns.size" class="spatial-panel-intro">目前手中没有待交回的私物。是否已经送达，请查看手记中的实际交接记录；放回原处不等于本人实收。</p>
    <template v-if="inventory.length">
      <template v-if="hasOrdinaryItems"><p class="spatial-panel-intro">交接前请选定眼前的人。物件要实际交到对方手中才算完成。</p><label class="field-label" for="transfer-recipient">交接给</label><select id="transfer-recipient" :value="recipient" :disabled="!canAct" @change="$emit('recipient', ($event.target as HTMLSelectElement).value)"><option value="">选择当前可见对象</option><option v-for="person in people" :key="person.entityRef" :value="person.entityRef">{{ personLabels[person.entityRef] || person.name }}</option></select></template>
      <ul class="spatial-inventory"><li v-for="held in inventory" :key="context ? objectInstanceKey(context, held) : held.entityRef" :data-private-return="returns.get(held.entityRef)?.returnContextId"><svg v-if="context && selectObjectArt(held, context, 'inventory')" class="spatial-inventory-art" viewBox="-20 -20 40 40" aria-hidden="true"><SpatialObjectArt :frame="selectObjectArt(held, context, 'inventory')" :instance-key="objectInstanceKey(context, held)" :attempt="attempt" @resource="resource"><path d="M0 -10 L12 0 L0 10 L-12 0 Z" fill="#f7d898" stroke="#976d35" /></SpatialObjectArt></svg><h3>{{ held.name }}</h3><p class="spatial-item-kind">{{ held.publicBorrowable ? '公用借物' : '随身保管' }}</p><SpatialFieldList :fields="held.fields" />
        <template v-if="returns.has(held.entityRef)">
          <p>{{ returns.get(held.entityRef)!.mode === 'return_only' ? '原许可已不可继续使用；这件物仍在你手中，只可归还。' : '这件物仍在你手中，待实际交给本人。' }}</p>
          <p>物主：{{ returns.get(held.entityRef)!.ownerLabel }}。原处：{{ returns.get(held.entityRef)!.origin.label }}。</p>
          <p v-if="!returns.get(held.entityRef)!.ownerRef" class="muted">物主暂不在眼前，请先走近本人再交回；不能按同名人物代收。</p>
          <p class="muted">交回前请用地图走近本人；放回前请回到登记原处。距离过远或位置尚未同步时暂不能提交，请等待当前位置更新后再试。放回只记原处收置，仍未送到本人。</p>
          <div class="button-row"><button class="secondary-button" :aria-label="'将' + held.name + '交回本人'" :disabled="!returnAction(returns.get(held.entityRef)!, 'owner')" @click="submitReturn(returns.get(held.entityRef)!, 'owner')">交回本人</button><button class="text-button" :aria-label="'将' + held.name + '放回原处'" :disabled="!returnAction(returns.get(held.entityRef)!, 'origin')" @click="submitReturn(returns.get(held.entityRef)!, 'origin')">放回原处</button></div>
        </template>
        <div v-else class="button-row"><button class="text-button" :disabled="!canAct" @click="$emit('put', held)">放在脚边</button><button class="secondary-button" :disabled="!canAct || !recipient || !held.transferable" @click="$emit('transfer', held)">交给对方</button></div>
      </li></ul>
      <p v-if="failures.size" role="status">部分图像暂未载入，仍可继续操作。<button class="text-button" @click="retry">重新载入图像</button></p>
      <p v-if="invalidState" role="status">部分物件状态暂无法显示，仍可继续操作。</p>
    </template>
  </div>
</template>
