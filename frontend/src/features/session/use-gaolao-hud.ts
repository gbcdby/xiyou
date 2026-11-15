import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Ref } from 'vue';

/** HUD只依据容器宽度选布局；人物、动画帧和面板开合不参与场景取景。 */
export function useGaolaoHud(root: Ref<HTMLElement | null>) {
  const width = ref(typeof window === 'undefined' ? 1200 : window.innerWidth);
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
  return { narrow: computed(() => width.value <= 900) };
}
