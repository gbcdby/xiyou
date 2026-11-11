<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Action, AuthorizedProjection, TargetView } from '../../domain/world.ts';
import { fieldValue, operationNames } from '../../domain/world.ts';
import AppIcon from '../../components/AppIcon.vue';

const props = defineProps<{ projection: AuthorizedProjection; disabled: boolean }>();
const emit = defineEmits<{ action: [action: Action] }>();
const region = computed(() => props.projection.regions.find(item => item.regionId === props.projection.self.regionId));
const targets = computed(() => props.projection.targets.filter(item => item.regionId === props.projection.self.regionId));
const groundItems = computed(() => props.projection.items.filter(item => item.location.kind === 'region' && item.location.regionId === props.projection.self.regionId));
const ownItems = computed(() => props.projection.items.filter(item => item.location.kind === 'character' && item.location.characterId === props.projection.self.characterId));
const selectedItems = ref<string[]>([]);
const repairTarget = ref<string | null>(null);

function operate(target: TargetView, operation: string) {
  if (operation === 'repair') { repairTarget.value = target.targetId; selectedItems.value = []; return; }
  emit('action', { kind: 'interact', targetId: target.targetId, operation, expectedTargetRevision: target.resourceRevision });
}
function repair(target: TargetView) {
  const items = ownItems.value.filter(item => selectedItems.value.includes(item.itemId));
  if (!items.length) return;
  emit('action', { kind: 'use_item', itemIds: items.map(item => item.itemId), expectedItemRevisions: Object.fromEntries(items.map(item => [item.itemId, item.resourceRevision])), targetId: target.targetId, expectedTargetRevision: target.resourceRevision, operation: 'repair' });
  repairTarget.value = null;
}
</script>

<template>
  <section class="panel world-panel" aria-labelledby="place-heading">
    <div class="place-hero">
      <span class="eyebrow"><AppIcon name="location" :size="16" />你所在的场所</span>
      <h2 id="place-heading">{{ region?.name || '等待进入场所' }}</h2>
      <p>{{ region?.description || '开始后将由服务器确认位置与可见线索。' }}</p>
      <div class="place-mark" aria-hidden="true"><span>山</span><i /><i /><i /></div>
    </div>
    <nav v-if="region" class="place-nav" aria-label="可前往的场所">
      <button v-for="exit in region.exits" :key="exit" class="quiet-button" :disabled="disabled" @click="emit('action', { kind: 'move', regionId: exit })"><AppIcon name="compass" :size="16" />{{ projection.regions.find(item => item.regionId === exit)?.name || `前往 ${exit}` }}<AppIcon name="arrow" :size="15" /></button>
    </nav>
    <div class="world-content">
      <div class="section-heading"><h3>眼前的事物</h3><span class="tiny muted">仅显示当前可见内容</span></div>
      <article v-for="target in targets" :key="target.targetId" class="target-card">
        <div class="target-top"><span class="object-icon"><AppIcon name="shield" :size="24" /></span><div><h4>{{ target.name }}</h4><span class="tiny muted">世界状态 · 以实际行动改变</span></div><button class="text-button" :disabled="disabled" @click="emit('action', { kind: 'inspect', targetId: target.targetId })"><AppIcon name="eye" :size="16" />查看</button></div>
        <dl class="fact-grid"><div v-for="field in target.fields" :key="field.key"><dt>{{ field.label }}</dt><dd :class="{ 'status-good': field.value === true, 'status-wait': field.value === false }">{{ fieldValue(field.value) }}</dd></div></dl>
        <div v-if="target.availableOperations.length" class="button-row"><button v-for="operation in target.availableOperations" :key="operation" class="secondary-button" :disabled="disabled" @click="operate(target, operation)">{{ operationNames[operation] || operation }}<AppIcon name="arrow" :size="15" /></button></div>
        <form v-if="repairTarget === target.targetId" class="inline-form" @submit.prevent="repair(target)">
          <fieldset><legend>选择你已持有的材料和工具</legend><label v-for="item in ownItems" :key="item.itemId" class="check-label"><input v-model="selectedItems" type="checkbox" :value="item.itemId" />{{ item.name }}</label><p v-if="!ownItems.length" class="muted small">你暂未持有物品，可以与保管者协调实际交付。</p></fieldset>
          <div class="button-row"><button class="primary-button" :disabled="disabled || !selectedItems.length">提交修复</button><button type="button" class="quiet-button" @click="repairTarget = null">取消</button></div>
        </form>
      </article>
      <article v-for="item in groundItems" :key="item.itemId" class="ground-item"><AppIcon name="bag" /><div><strong>{{ item.name }}</strong><span class="tiny muted">位于当前场所</span></div><button class="secondary-button" :disabled="disabled" @click="emit('action', { kind: 'take_item', itemId: item.itemId, expectedItemRevision: item.resourceRevision })">拿取</button></article>
      <p v-if="!targets.length && !groundItems.length" class="empty-copy">这里暂时没有可交互的物件。你仍可与在场的伙伴交流。</p>
    </div>
  </section>
</template>
