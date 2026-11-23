<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { SelfViewV2 } from '../../../../game/spatial-types.ts';
import { spriteForAppearance } from '../../domain/gaolao-art.ts';
import AppIcon from '../../components/AppIcon.vue';

type ReadingPanel = 'identity' | 'inventory' | 'notebook' | 'dialogue' | 'chapter' | 'recap';
const props = defineProps<{
  self: SelfViewV2; expanded: boolean; reading: ReadingPanel | null;
  canStop: boolean; canRecap: boolean; canReadReceipts: boolean;
  objectsOpen: boolean; receiptsOpen: boolean; unknownCount: number; contextKey: string;
}>();
const emit = defineEmits<{
  'update:expanded': [value: boolean]; reading: [panel: ReadingPanel, event: MouseEvent];
  stop: []; objects: []; receipts: [];
}>();
const root = ref<HTMLElement | null>(null), moreToggle = ref<HTMLButtonElement | null>(null), foldToggle = ref<HTMLButtonElement | null>(null);
const moreOpen = ref(false), portraitFailed = ref(false);
const portrait = computed(() => spriteForAppearance(props.self.appearanceId, 'S', false, 0)?.href);
const entries = [
  { panel: 'inventory', icon: 'bag', label: '行囊' },
  { panel: 'notebook', icon: 'book', label: '手记' },
  { panel: 'dialogue', icon: 'chat', label: '交谈' },
  { panel: 'chapter', icon: 'group', label: '队伍' },
] as const;

function closeMore(restoreFocus = true) {
  if (!moreOpen.value) return false;
  moreOpen.value = false;
  if (restoreFocus) void nextTick(() => moreToggle.value?.focus({ preventScroll: true }));
  return true;
}
function focusFallback() { (props.expanded ? moreToggle.value : foldToggle.value)?.focus({ preventScroll: true }); }
function openReading(panel: ReadingPanel, event: MouseEvent) { closeMore(false); emit('reading', panel, event); }
function openObjects() { closeMore(false); emit('objects'); }
function openReceipts() { closeMore(false); emit('receipts'); }
function toggleDock() {
  closeMore(false); emit('update:expanded', !props.expanded);
  void nextTick(() => foldToggle.value?.focus({ preventScroll: true }));
}
function dismissOutside(event: PointerEvent) {
  if (event.target instanceof Node && !root.value?.contains(event.target)) closeMore(false);
}
watch(portrait, () => { portraitFailed.value = false; });
watch(() => props.contextKey, () => closeMore(false));
watch(() => props.expanded, value => { if (!value) closeMore(false); });
onMounted(() => document.addEventListener('pointerdown', dismissOutside));
onBeforeUnmount(() => document.removeEventListener('pointerdown', dismissOutside));
defineExpose({ closeMore, focusFallback });
</script>

<template>
  <div ref="root" class="gaolao-dock-anchor" data-keyboard-scope="panel" @pointerdown.stop @click.stop>
    <button v-if="unknownCount && !moreOpen && !receiptsOpen" class="gaolao-urgent-receipts" @click="openReceipts"><AppIcon name="warn" :size="16" />{{ unknownCount }} 条动作待确认<span>查看回执</span></button>
    <section v-if="moreOpen" id="gaolao-more-tools" class="gaolao-more-panel" aria-label="更多功能">
      <p class="gaolao-more-heading">随身工具</p>
      <button aria-label="场景对象" :aria-expanded="objectsOpen" @click="openObjects"><AppIcon name="eye" :size="19" /><span>场景对象</span><small>查看人与物</small></button>
      <button aria-label="回执" :aria-expanded="receiptsOpen" :disabled="!canReadReceipts" @click="openReceipts"><AppIcon name="check" :size="19" /><span>回执</span><small v-if="unknownCount">{{ unknownCount }} 条待确认</small></button>
      <button aria-label="回看" :aria-expanded="reading === 'recap'" :disabled="!canRecap" :title="canRecap ? '查看这一程的过程与结果' : '这一程结束后可回看'" @click="openReading('recap', $event)"><AppIcon name="clock" :size="19" /><span>回看</span><small v-if="!canRecap">结束后开启</small></button>
      <p class="gaolao-dock-help">点地行走 · 拖动画面查看远处</p>
    </section>
    <div class="gaolao-compact-dock" :class="{ 'is-collapsed': !expanded }">
      <button class="gaolao-player-button" :aria-label="'查看' + self.name + '的角色信息'" :aria-expanded="reading === 'identity'" aria-controls="spatial-reading-pane" @click="openReading('identity', $event)">
        <span class="gaolao-player-portrait" aria-hidden="true"><img v-if="portrait && !portraitFailed" :src="portrait" alt="" @error="portraitFailed = true"><span v-else>{{ self.name.slice(0, 1) }}</span></span><strong>{{ self.name }}</strong>
      </button>
      <button class="gaolao-stop-button" aria-label="停步 / 取消后续操作" :disabled="!canStop" @click="emit('stop')"><AppIcon name="pause" :size="21" /><span>停步</span></button>
      <nav v-if="expanded" id="gaolao-primary-tools" class="gaolao-primary-tools spatial-tool-dock" aria-label="随身功能">
        <button v-for="entry in entries" :key="entry.panel" aria-controls="spatial-reading-pane" :aria-expanded="reading === entry.panel" @click="openReading(entry.panel, $event)"><AppIcon :name="entry.icon" :size="21" /><span>{{ entry.label }}</span></button>
        <button ref="moreToggle" class="gaolao-more-toggle" :aria-expanded="moreOpen" aria-controls="gaolao-more-tools" @click="moreOpen = !moreOpen"><AppIcon name="more" :size="23" /><span>更多</span><span v-if="unknownCount" class="gaolao-unread-dot" aria-hidden="true" /></button>
      </nav>
      <button ref="foldToggle" class="gaolao-dock-fold" :aria-label="expanded ? '收起工具栏' : '展开工具栏'" :title="expanded ? '收起工具栏' : '展开工具栏'" :aria-expanded="expanded" aria-controls="gaolao-primary-tools" @click="toggleDock"><AppIcon :name="expanded ? 'chevron-down' : 'chevron-up'" :size="20" /><span v-if="!expanded">工具</span></button>
    </div>
  </div>
</template>

<style scoped>
.gaolao-dock-anchor { position: absolute; z-index: 9; bottom: var(--hud-bottom); left: 50%; transform: translateX(-50%); width: max-content; max-width: calc(100% - var(--hud-left) - var(--hud-right)); pointer-events: auto; }
.gaolao-compact-dock { display: flex; align-items: center; gap: 6px; padding: 6px 10px; min-height: 68px; border: 1px solid #c9b996aa; border-radius: 12px; background: var(--hud-paper); box-shadow: 0 3px 18px #3e32191a; }
button { border: 1px solid transparent; border-radius: 6px; background: transparent; color: #385c4e; min-width: 44px; min-height: 44px; font: inherit; cursor: pointer; }
button:hover, button[aria-expanded="true"] { background: #e7ecdf; }
button:focus-visible { outline: 2px solid #365e52; outline-offset: 2px; }
button:disabled { opacity: .45; cursor: not-allowed; }
.gaolao-player-button { display: flex; align-items: center; gap: 9px; padding: 3px 12px 3px 2px; color: var(--hud-ink); border-radius: 5px; }
.gaolao-player-button strong { max-width: 8em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 600 18px/1.4 var(--serif); }
.gaolao-player-portrait { display: grid; place-items: center; overflow: hidden; width: 39px; height: 39px; flex: none; border: 1px solid #bcae8d; border-radius: 50%; background: #e9e2d0; color: #675b42; font: 24px var(--serif); }
.gaolao-player-portrait img { width: 100%; height: 100%; object-fit: cover; object-position: center top; }
.gaolao-primary-tools { display: flex; flex-wrap: nowrap; align-items: center; justify-content: flex-start; gap: 3px; padding-left: 7px; border-left: 1px solid #c9b9969c; }
.gaolao-primary-tools button, .gaolao-stop-button { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; width: 56px; min-height: 54px; padding: 3px; font-size: 13px; white-space: nowrap; }
.gaolao-primary-tools button { border: 1px solid transparent; border-radius: 6px; background: transparent; color: #385c4e; }
.gaolao-primary-tools button:hover, .gaolao-primary-tools button[aria-expanded="true"] { border-color: transparent; background: #e7ecdf; }
.gaolao-dock-fold { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; padding: 3px 6px; margin-left: 4px; border-left: 1px solid #c9b9969c; border-radius: 0; font-size: 12px; }
.gaolao-unread-dot { position: absolute; top: 2px; right: 7px; width: 6px; height: 6px; border-radius: 50%; background: #98513c; }
.gaolao-more-panel { position: absolute; right: 0; bottom: calc(100% + 9px); width: 260px; max-width: calc(100vw - var(--hud-left) - var(--hud-right)); max-height: calc(100dvh - 160px); overflow: auto; overscroll-behavior: contain; padding: 10px; border: 1px solid var(--hud-line); border-radius: 9px; background: #faf6ebfa; box-shadow: 0 7px 24px #332c2326; }
.gaolao-more-heading { margin: 0 8px 7px; font: 600 15px var(--serif); color: var(--hud-muted); }
.gaolao-more-panel > button { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 48px; padding: 8px; text-align: left; font-size: 14px; }
.gaolao-more-panel small { margin-left: auto; font-size: 11px; color: var(--hud-muted); }
.gaolao-dock-help { margin: 8px 0 0; padding: 10px 7px 0; border-top: 1px solid #d5c9ad; color: var(--hud-muted); font-size: 11px; line-height: 1.7; }
.gaolao-urgent-receipts { position: absolute; bottom: calc(100% + 9px); right: 0; display: flex; align-items: center; gap: 7px; width: max-content; max-width: calc(100vw - var(--hud-left) - var(--hud-right)); padding: 6px 10px; background: #fff5e7f5; border-color: #c5a47c; color: #8f4c34; font-size: 12px; box-shadow: 0 2px 10px #3e32191a; }
.gaolao-urgent-receipts span { text-decoration: underline; text-underline-offset: 3px; }
@media (max-width: 640px) {
  .gaolao-dock-anchor:has(.gaolao-compact-dock:not(.is-collapsed)) { width: min(370px, calc(100% - var(--hud-left) - var(--hud-right))); }
  .gaolao-compact-dock:not(.is-collapsed) { display: grid; grid-template-columns: minmax(0, 1fr) 48px 44px; gap: 1px 5px; padding: 5px 8px; }
  .gaolao-player-button { justify-content: flex-start; min-width: 0; padding-right: 4px; }
  .gaolao-player-button strong { font-size: 16px; }
  .gaolao-player-portrait { width: 32px; height: 32px; }
  .gaolao-stop-button { min-height: 44px; width: 48px; font-size: 12px; gap: 2px; }
  .gaolao-dock-fold { grid-column: 3; grid-row: 1; margin: 0; }
  .gaolao-primary-tools { grid-column: 1 / -1; grid-row: 2; display: flex; justify-content: space-between; padding: 3px 0 0; border-left: 0; border-top: 1px solid #c9b9969c; }
  .gaolao-primary-tools button { width: auto; flex: 1; min-height: 48px; font-size: 12px; }
  .gaolao-compact-dock.is-collapsed { min-height: 54px; padding: 4px 7px; }
}
@media (prefers-reduced-motion: reduce) { button { transition: none; } }
</style>
