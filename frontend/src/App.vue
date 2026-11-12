<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { identity, sessionState } from './state/app-store.ts';
import { spatialState } from './state/spatial-store.ts';
import AppIcon from './components/AppIcon.vue';
const route = useRoute();
const connected = computed(() => (sessionState.value.connection === 'online' && route.name === 'session') || (spatialState.value.connection === 'online' && route.name === 'spatial-session'));
</script>

<template>
  <a class="skip-link" href="#main">跳到主要内容</a>
  <header class="app-header">
    <div class="header-inner">
      <RouterLink to="/" class="brand" aria-label="西游同行，返回房间大厅"><span class="brand-seal">西</span><span>西游<span class="brand-dot">·</span>同行<small>一程山水，一同求证</small></span></RouterLink>
      <nav class="main-nav" aria-label="主要导航"><RouterLink to="/" :class="{ active: route.name === 'lobby' }">房间大厅</RouterLink><RouterLink to="/demo" :class="{ active: route.name === 'demo' }">界面演示</RouterLink></nav>
      <div class="header-status"><span class="connection-dot" :class="{ connected }" /><span>{{ route.name === 'demo' ? '静态演示' : connected ? '房间已连接' : '房间未连接' }}</span><span v-if="identity" class="user-chip"><AppIcon name="leaf" :size="15" />{{ identity.name }}</span></div>
    </div>
  </header>
  <main id="main"><RouterView /></main>
  <footer class="app-footer"><span>西游 · 同行</span><span>有所闻，也有所证。</span></footer>
</template>
