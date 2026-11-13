<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import type { SnapshotV2 } from '../../game/spatial-types.ts';
import { validateSpatial } from '../../protocol/spatial.mjs';
import SpatialMap from '../src/features/world/SpatialMap.vue';
import SpatialInventoryPane from '../src/features/inventory/SpatialInventoryPane.vue';

// 仅消费者检查入口；输入来自测试保存的授权快照，不连接世界动作端。
const snapshot = shallowRef<SnapshotV2 | null>(null), selected = ref('');
const selections: string[] = [], actions: string[] = [];
const inventory = computed(() => snapshot.value?.projection.items.filter(item => item.location.kind === 'held' && item.location.ownerRef === snapshot.value!.projection.self.entityRef) ?? []);
Object.assign(window, { objectVisualFixture: {
  setSnapshot(value: SnapshotV2 | null) { snapshot.value = value ? validateSpatial('SnapshotV2', value) : null; selected.value = ''; },
  selections: () => [...selections], actions: () => [...actions],
} });
function select(reference: string) { selected.value = reference; selections.push(reference); }
</script>

<template>
  <main class="object-visual-fixture"><h1>物件消费者受控检查</h1><p>只检查组件与受控加载；不证明正式图片已发布或艺术验收通过。</p>
    <template v-if="snapshot"><SpatialMap :snapshot="snapshot" :disabled="false" :selected="selected" @select="select" @move="actions.push('move')" /><SpatialInventoryPane :snapshot="snapshot" :inventory="inventory" :people="snapshot.projection.entities" :person-labels="{}" :can-act="true" recipient="" @put="actions.push('put')" @transfer="actions.push('transfer')" /></template>
  </main>
</template>

<style scoped>.object-visual-fixture { max-width: 1200px; padding: 24px; margin: auto; }</style>
