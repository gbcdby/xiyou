<script setup lang="ts">
import type { ClaimViewV2, EntityViewV2 } from '../../../../game/spatial-types.ts';
defineProps<{ claims: ClaimViewV2[]; people: EntityViewV2[]; personLabels: Record<string, string>; canAct: boolean; recipient: string; message: string; channel: 'public' | 'team' | 'directed' }>();
defineEmits<{ recipient: [reference: string]; message: [text: string]; channel: [channel: 'public' | 'team' | 'directed']; speak: [] }>();
</script>

<template>
  <div class="spatial-dialogue">
    <div class="spatial-claims" aria-live="polite"><p v-if="!claims.length" class="muted">当前还没有你获准听到的交谈。</p><p v-for="claim in claims.slice(-20)" :key="claim.claimRef"><strong>{{ claim.speakerName }}</strong><small>{{ claim.channel === 'team' ? '真人队聊' : claim.channel === 'directed' ? '定向' : '当面' }} · 陈述</small><span>{{ claim.text }}</span></p></div>
    <form class="spatial-speech" @submit.prevent="$emit('speak')"><label class="field-label" for="spatial-speech-channel">交谈范围</label><select id="spatial-speech-channel" :value="channel" :disabled="!canAct" @change="$emit('channel', ($event.target as HTMLSelectElement).value as 'public' | 'team' | 'directed')"><option value="public">当面说</option><option value="team">真人队聊</option><option value="directed">对选定对象说</option></select><template v-if="channel === 'directed'"><label class="field-label" for="spatial-speech-recipient">交谈对象</label><select id="spatial-speech-recipient" :value="recipient" :disabled="!canAct" @change="$emit('recipient', ($event.target as HTMLSelectElement).value)"><option value="">选择对象</option><option v-for="person in people" :key="person.entityRef" :value="person.entityRef">{{ personLabels[person.entityRef] || person.name }}</option></select></template><label class="field-label" for="spatial-speech-message">交谈内容</label><textarea id="spatial-speech-message" :value="message" maxlength="2000" :disabled="!canAct" placeholder="说出你想让对方听到的话" @input="$emit('message', ($event.target as HTMLTextAreaElement).value)" /><button class="primary-button" :disabled="!canAct || !message.trim() || (channel === 'directed' && !recipient)">说话</button></form>
    <p class="spatial-panel-intro">当面交谈只让现场能听见的人知晓。真人队聊不会传给 NPC。</p>
  </div>
</template>
