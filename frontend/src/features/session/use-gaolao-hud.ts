import { computed, onBeforeUnmount, onMounted, reactive, ref, toRefs, watch } from 'vue';
import type { Ref } from 'vue';
import { readHudPreferences, saveHudPreferences } from '../../domain/gaolao-hud-preferences.ts';

/** HUD只依据容器宽度选布局；人物、动画帧和面板开合不参与场景取景。 */
export function useGaolaoHud(root: Ref<HTMLElement | null>) {
  const width = ref(typeof window === 'undefined' ? 1200 : window.innerWidth);
  let storage: Storage | undefined;
  try { storage = typeof window === 'undefined' ? undefined : window.localStorage; } catch { /* 禁用存储时仍可在本次页面内开合。 */ }
  const preferences = reactive(readHudPreferences(storage));
  watch(preferences, value => saveHudPreferences(storage, value), { flush: 'sync' });
  let observer: ResizeObserver | null = null;
  function measure() { if (root.value) width.value = root.value.clientWidth; }
  onMounted(() => {
    observer = new ResizeObserver(measure);
    if (root.value) observer.observe(root.value);
    measure();
  });
  watch(root, (element, previous) => {
    if (previous) observer?.unobserve(previous);
    if (element) observer?.observe(element);
    measure();
  }, { flush: 'post' });
  onBeforeUnmount(() => observer?.disconnect());
  return { narrow: computed(() => width.value <= 900), ...toRefs(preferences) };
}
