<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Action, AuthorizedProjection } from '../../domain/world.ts';
import AppIcon from '../../components/AppIcon.vue';
const props = defineProps<{ projection: AuthorizedProjection; disabled: boolean }>();
const emit = defineEmits<{ action: [action: Action] }>();
const text = ref('');
const channel = ref<'public' | 'directed' | 'private'>('public');
const recipientIds = ref<string[]>([]);
const recipients = computed(() => props.projection.characters.filter(person => person.characterId !== props.projection.self.characterId && person.regionId === props.projection.self.regionId && (channel.value !== 'private' || person.mode !== 'CoreNPCControlled')));
const personName = (id: string) => props.projection.characters.find(person => person.characterId === id)?.name || '同行者';
watch(channel, () => { recipientIds.value = []; });
function submit() {
  if (!text.value.trim() || (channel.value !== 'public' && !recipientIds.value.length)) return;
  emit('action', { kind: 'speak', text: text.value.trim(), channel: channel.value, recipientIds: channel.value === 'public' ? [] : [...recipientIds.value] });
  text.value = '';
}
</script>

<template>
  <section class="panel dialogue-panel" aria-labelledby="dialogue-heading">
    <div class="section-heading"><h2 id="dialogue-heading"><AppIcon name="chat" />同行对话</h2><span class="tiny muted">说过 ≠ 做到</span></div>
    <div class="dialogue-log" role="log" aria-label="已确认的陈述" aria-live="polite" aria-relevant="additions">
      <article v-for="claim in projection.claims" :key="claim.claimId" class="claim"><div class="claim-meta"><strong>{{ personName(claim.speakerId) }}</strong><span>{{ claim.channel === 'public' ? '场所公开' : claim.channel === 'private' ? '私人对话' : '定向陈述' }}</span><span class="claim-tag">陈述</span></div><blockquote>{{ claim.text }}</blockquote><p v-if="claim.recipientIds.length" class="tiny muted">给 {{ claim.recipientIds.map(personName).join('、') }}</p></article>
      <p v-if="!projection.claims.length" class="empty-copy">暂时还没有对话。你可以询问线索、表达判断，或提出具体的协作请求。</p>
    </div>
    <form class="dialogue-composer" @submit.prevent="submit">
      <label class="field-label">这句话说给谁<select v-model="channel" :disabled="disabled"><option value="public">当前场所 · 公开</option><option value="directed">指定在场伙伴</option><option value="private">指定真人 · 私人对话</option></select></label>
      <fieldset v-if="channel !== 'public'" class="recipient-options"><legend>明确选择接收者</legend><label v-for="person in recipients" :key="person.characterId" class="check-label"><input v-model="recipientIds" type="checkbox" :value="person.characterId" :disabled="disabled" />{{ person.name }}</label><p v-if="!recipients.length" class="small muted">当前没有可选择的在场接收者。</p></fieldset>
      <label class="sr-only" for="dialogue-text">输入你的陈述</label><textarea id="dialogue-text" v-model="text" rows="3" maxlength="2000" placeholder="我发现了…… 或许我们可以……" :disabled="disabled" />
      <div class="composer-footer"><span class="tiny muted">{{ text.length }}/2000 · 陈述不会直接改变世界</span><button class="primary-button" :disabled="disabled || !text.trim() || (channel !== 'public' && !recipientIds.length)"><AppIcon name="send" :size="16" />发送</button></div>
    </form>
  </section>
</template>
