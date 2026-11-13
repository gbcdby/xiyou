<script setup lang="ts">
import { computed } from 'vue';
import type { SpatialDraft } from '../../network/spatial-session.ts';
import SpatialStatus from '../../components/SpatialStatus.vue';
const props = defineProps<{ actions: SpatialDraft[]; online: boolean; closable?: boolean; condensed?: boolean; restoreLabel?: string }>();
defineEmits<{ query: [id: string]; retry: [id: string]; close: []; restore: [] }>();
const visibleActions = computed(() => {
  // 未决请求始终全部展示；只对已确定历史取最近八条，不能让历史把恢复入口挤掉。
  const pending = props.actions.filter(action => action.status === 'waiting' || action.status === 'unknown');
  const confirmed = props.actions.filter(action => action.status === 'accepted' || action.status === 'rejected').slice(-8);
  return [...pending.reverse(), ...confirmed.reverse()];
});
</script>

<template>
  <section v-if="actions.length" id="spatial-receipts" class="panel spatial-receipts" aria-labelledby="spatial-receipts-heading"><div v-if="condensed" class="gaolao-condensed" role="status"><span>动作确认暂收</span><button class="text-button" @click="$emit('restore')">{{ restoreLabel || '回到角色' }}</button><button class="text-button" @click="$emit('close')">关闭</button></div><button v-if="closable" class="text-button gaolao-close-receipts" @click="$emit('close')">关闭动作确认</button><h2 id="spatial-receipts-heading" tabindex="-1">动作确认</h2><p class="spatial-panel-intro">结果未知时，先查询或原样重试这一次操作。</p><ol><li v-for="action in visibleActions" :key="action.id" :data-action-id="action.id"><SpatialStatus :label="action.status === 'accepted' ? '已确认' : action.status === 'rejected' ? '未执行' : action.status === 'unknown' ? '结果未知' : '等待确认'" :tone="action.status === 'accepted' ? 'confirmed' : action.status === 'unknown' ? 'uncertain' : 'pending'" /><p>{{ action.detail }}</p><div v-if="action.status === 'unknown'" class="button-row"><button class="text-button" :disabled="!online" @click="$emit('query', action.id)">查询结果</button><button class="text-button" :disabled="!online" @click="$emit('retry', action.id)">原样重试</button></div></li></ol></section>
</template>
