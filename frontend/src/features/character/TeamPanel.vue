<script setup lang="ts">
import type { AuthorizedProjection } from '../../domain/world.ts';
import { controlNames, roleNames } from '../../domain/world.ts';
import AppIcon from '../../components/AppIcon.vue';
defineProps<{ projection: AuthorizedProjection }>();
</script>

<template>
  <section class="panel team-panel" aria-labelledby="team-heading">
    <div class="section-heading"><h2 id="team-heading"><AppIcon name="group" />同行的人</h2><span class="muted tiny">各尽其长</span></div>
    <ul class="team-list">
      <li v-for="character in projection.characters" :key="character.characterId">
        <span class="avatar" :class="{ npc: character.mode === 'CoreNPCControlled' }">{{ character.name.slice(0, 1) }}</span>
        <div class="team-name"><strong>{{ character.name }}<span v-if="character.characterId === projection.self.characterId" class="self-tag">你</span></strong><span>{{ character.roles.length ? character.roles.map(role => roleNames[role] || role).join(' · ') : '核心伙伴' }}</span></div>
        <span class="presence" :class="{ away: !character.online }" :aria-label="character.online ? '在线' : controlNames[character.mode]" :title="character.online ? controlNames[character.mode] : controlNames[character.mode]" />
      </li>
    </ul>
  </section>
</template>
