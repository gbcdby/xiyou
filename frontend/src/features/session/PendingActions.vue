<script setup lang="ts">
import type { ActionDraft } from '../../domain/action-draft.ts';
import AppIcon from '../../components/AppIcon.vue';
defineProps<{ actions: ActionDraft[]; disabled: boolean }>();
defineEmits<{ retry: [id: string]; query: [id: string] }>();
const labels = { waiting: '等待服务器确认', unknown: '结果待确认', accepted: '已提交，正在同步', rejected: '本次未执行' };
</script>

<template>
  <section v-if="actions.length" class="pending-actions" aria-label="动作结果" aria-live="polite">
    <article v-for="action in actions" :key="action.id" class="pending-action" :class="action.status"><AppIcon :name="action.status === 'rejected' ? 'warn' : action.status === 'accepted' ? 'check' : 'clock'" :size="19" /><div><strong>{{ action.label }}</strong><span>{{ action.detail || labels[action.status] }}</span></div><div v-if="action.status === 'unknown'" class="button-row"><button class="text-button" :disabled="disabled" @click="$emit('query', action.id)">查询结果</button><button class="text-button" :disabled="disabled" @click="$emit('retry', action.id)">原样重试</button></div></article>
  </section>
</template>
