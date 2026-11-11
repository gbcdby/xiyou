<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Action, AuthorizedProjection, ItemView } from '../../domain/world.ts';
import AppIcon from '../../components/AppIcon.vue';
const props = defineProps<{ projection: AuthorizedProjection; disabled: boolean }>();
const emit = defineEmits<{ action: [action: Action] }>();
const items = computed(() => props.projection.items.filter(item => item.location.kind === 'character' && item.location.characterId === props.projection.self.characterId));
const recipients = computed(() => props.projection.characters.filter(item => item.characterId !== props.projection.self.characterId && item.regionId === props.projection.self.regionId));
const selectedItem = ref<string | null>(null);
const recipient = ref('');
function transfer(item: ItemView) {
  if (!recipient.value) return;
  emit('action', { kind: 'transfer_item', itemId: item.itemId, targetId: recipient.value, expectedItemRevision: item.resourceRevision });
  selectedItem.value = null;
}
</script>

<template>
  <section class="panel inventory-panel" aria-labelledby="inventory-heading">
    <div class="section-heading"><h2 id="inventory-heading"><AppIcon name="bag" />我的持物</h2><span class="count-badge">{{ items.length }}</span></div>
    <div v-for="item in items" :key="item.itemId" class="inventory-item">
      <div class="inventory-row"><span class="item-mark"><AppIcon name="bag" :size="19" /></span><div><strong>{{ item.name }}</strong><span class="tiny muted">服务器确认由你持有</span></div><button v-if="item.transferable" class="text-button" :disabled="disabled || !recipients.length" @click="selectedItem = item.itemId; recipient = ''">转交</button></div>
      <form v-if="selectedItem === item.itemId" class="inline-form" @submit.prevent="transfer(item)"><label class="field-label">交给同处的哪位伙伴<select v-model="recipient" required><option value="" disabled>请选择接收者</option><option v-for="person in recipients" :key="person.characterId" :value="person.characterId">{{ person.name }}</option></select></label><div class="button-row"><button class="primary-button" :disabled="disabled || !recipient">确认转交</button><button type="button" class="quiet-button" @click="selectedItem = null">取消</button></div></form>
    </div>
    <p v-if="!items.length" class="empty-copy">暂无持物。实际取得或收到交付后，物品会出现在这里。</p>
  </section>
</template>
