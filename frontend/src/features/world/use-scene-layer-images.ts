import { onBeforeUnmount, ref, watch } from 'vue';
import type { Ref } from 'vue';
import { sceneGroupAssets, validSceneLayerGroup } from '../../domain/gaolao-scene-layers.ts';
import type { SceneAsset, SceneLayerGroup } from '../../domain/gaolao-scene-layers.ts';

/** 本章静态资源组共用一次请求代次；任何一片失败都不显示半组。 */
export function useSceneLayerImages(group: Ref<SceneLayerGroup | null>, contextKey: Ref<string>, attempt: Ref<number>) {
  const ready = ref(false), failed = ref(false), instance = ref('');
  let generation = 0;
  const requests = new Set<HTMLImageElement>();
  const source = (asset: SceneAsset) => attempt.value ? `${asset.file}?retry=${attempt.value}` : asset.file;
  function cancel() {
    generation++;
    for (const request of requests) { request.onload = null; request.onerror = null; }
    requests.clear(); ready.value = false; failed.value = false;
  }
  watch([() => JSON.stringify(group.value), contextKey, attempt], () => {
    cancel();
    const current = group.value, requestGeneration = generation;
    instance.value = JSON.stringify([contextKey.value, current?.groupVersion, attempt.value, generation]);
    if (!current) return;
    if (!validSceneLayerGroup(current)) { failed.value = true; return; }
    const assets = sceneGroupAssets(current);
    let remaining = assets.length;
    const unavailable = () => { if (requestGeneration !== generation) return; failed.value = true; ready.value = false; };
    for (const asset of assets) {
      const request = new Image(); requests.add(request);
      request.onload = async () => {
        if (requestGeneration !== generation || !requests.has(request)) return;
        try {
          await request.decode();
          if (requestGeneration !== generation || !requests.has(request)) return;
          if (request.naturalWidth !== asset.pixelSize.width || request.naturalHeight !== asset.pixelSize.height) { unavailable(); return; }
          requests.delete(request);
          if (--remaining === 0 && !failed.value) ready.value = true;
        } catch { unavailable(); }
      };
      request.onerror = unavailable;
      request.src = source(asset);
    }
  }, { immediate: true, flush: 'sync' });
  onBeforeUnmount(cancel);
  function displayFailure(event: Event) {
    const element = event.currentTarget as SVGImageElement;
    if (element.getAttribute('data-scene-instance') !== instance.value) return;
    failed.value = true; ready.value = false;
  }
  return { ready, failed, instance, source, displayFailure };
}
