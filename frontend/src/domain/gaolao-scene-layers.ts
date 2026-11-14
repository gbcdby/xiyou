import type { TargetViewV2 } from '../../../game/spatial-types.ts';
import released from '../assets/gaolao-scene-layers.json' with { type: 'json' };
import { objectArtCatalog, selectObjectArt } from './gaolao-object-art.ts';
import type { ObjectArtCatalog, ObjectArtContext, ObjectArtFrame } from './gaolao-object-art.ts';

export type SceneRect = { x: number; y: number; width: number; height: number };
export type SceneAsset = { file: string; pixelSize: { width: number; height: number }; sourceCrop: SceneRect; worldRect: SceneRect; sha256: string };
export type SceneForeground = SceneAsset & { id: string; depthY: number; bounds: SceneRect };
export type SceneDoorGeometry = { targetPosition: { x: number; y: number }; depthY: number; neutralBounds: SceneRect };
export type SceneDoor = SceneDoorGeometry & { visualKey: 'timber-door'; objectArtVersion: string };
export type SceneLayerGroup = {
  enabled: boolean; groupVersion: string; contentVersion: string; mapVersion: string; sceneId: string;
  source: { file: string; pixelSize: { width: number; height: number }; sha256: string };
  base: SceneAsset; floors: SceneAsset[]; foreground: SceneForeground[]; replaceMask: SceneAsset; door?: SceneDoor;
};
export type SceneDoorCatalog = Readonly<Record<string, ObjectArtCatalog[string] & { version?: string }>>;
const sameScope = (group: SceneLayerGroup, context: ObjectArtContext) =>
  group.contentVersion === context.contentVersion && group.mapVersion === context.mapVersion && group.sceneId === context.sceneId;

export type SceneLayerCatalog = Readonly<Record<string, SceneLayerGroup>>;
/** 只有已获准发布的明确条目进入此目录；JSON 由构建检查和运行时组校验共同约束。 */
export const sceneLayerCatalog = released as SceneLayerCatalog;
export function selectSceneLayerGroup(context: ObjectArtContext, catalog: SceneLayerCatalog = sceneLayerCatalog): SceneLayerGroup | null {
  if (context.contentVersion !== 'gaolaozhuang-scene-v2' || context.mapVersion !== 'gaolao-layout-v1.1' || !['gaolao-courtyard', 'gaolao-village-road'].includes(context.sceneId ?? '')) return null;
  if (!context.sceneId || !Object.hasOwn(catalog, context.sceneId)) return null;
  const group = catalog[context.sceneId];
  return group?.enabled === true && sameScope(group, context) ? group : null;
}

const finite = (value: number) => Number.isFinite(value);
const rect = (value: SceneRect | undefined) => Boolean(value && [value.x, value.y, value.width, value.height].every(finite) && value.width > 0 && value.height > 0);
const digest = (value: string) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function sceneGroupAssets(group: SceneLayerGroup): SceneAsset[] { return [group.base, ...group.floors, ...group.foreground, group.replaceMask]; }
/** 已登记组的尺寸与映射校验；像素内容与mask的艺术正确性仍须独立验收。 */
export function validSceneLayerGroup(group: SceneLayerGroup): boolean {
  const source = group.source;
  if (!group.groupVersion || !source || source.pixelSize?.width !== 1586 || source.pixelSize?.height !== 992 || !digest(source.sha256) || !Array.isArray(group.floors) || !Array.isArray(group.foreground)) return false;
  for (const asset of sceneGroupAssets(group)) {
    if (!asset || typeof asset.file !== 'string' || !asset.file.startsWith('/') || asset.file.startsWith('//') || /[?#]/.test(asset.file) || !digest(asset.sha256) || !rect(asset.sourceCrop) || !rect(asset.worldRect)) return false;
    const size = asset.pixelSize, crop = asset.sourceCrop, world = asset.worldRect;
    if (!size || !Number.isSafeInteger(size.width) || !Number.isSafeInteger(size.height) || size.width <= 0 || size.height <= 0 || crop.x < 0 || crop.y < 0 || crop.x + crop.width > source.pixelSize.width || crop.y + crop.height > source.pixelSize.height || crop.width !== size.width || crop.height !== size.height) return false;
    const expected = [crop.x * 1600 / 1586, crop.y * 1000 / 992, crop.width * 1600 / 1586, crop.height * 1000 / 992];
    if ([world.x, world.y, world.width, world.height].some((value, index) => Math.abs(value - expected[index]) > 1e-6)) return false;
  }
  if (group.base.sourceCrop.x !== 0 || group.base.sourceCrop.y !== 0 || group.base.pixelSize.width !== 1586 || group.base.pixelSize.height !== 992) return false;
  const ids = new Set<string>();
  for (const fragment of group.foreground) {
    if (!fragment.id || ids.has(fragment.id) || !finite(fragment.depthY) || !rect(fragment.bounds)) return false;
    ids.add(fragment.id);
  }
  if (group.sceneId === 'gaolao-courtyard') {
    const door = group.door;
    if (!door || door.visualKey !== 'timber-door' || door.targetPosition?.x !== 1250 || door.targetPosition?.y !== 425 || door.depthY !== 395 || !rect(door.neutralBounds) || !door.objectArtVersion) return false;
  } else if (group.door) return false;
  return true;
}

// 仅供已登记院落组校验失败时使用：合同C01、门区和深度，不读取全局障碍是否存在。
const courtyardNeutralDoor: SceneDoorGeometry = Object.freeze({
  targetPosition: Object.freeze({ x: 1250, y: 425 }), depthY: 395,
  neutralBounds: Object.freeze({ x: 1210, y: 350, width: 80, height: 45 }),
});
/** 登记决定是否接管；只有验证后的资源能进入模板，坏元数据不能成为降级输入。 */
export function sceneLayerPresentation(context: ObjectArtContext, catalog: SceneLayerCatalog = sceneLayerCatalog): { registered: SceneLayerGroup | null; resources: SceneLayerGroup | null; door: SceneDoorGeometry | null } {
  const registered = selectSceneLayerGroup(context, catalog);
  const resources = registered && validSceneLayerGroup(registered) ? registered : null;
  const door = resources?.door ?? (registered?.sceneId === 'gaolao-courtyard' ? courtyardNeutralDoor : null);
  return { registered, resources, door };
}

export type SceneDepthEntry = { kind: 'target' | 'item' | 'person' | 'foreground' | 'door'; key: string; depthY: number };
const order = { target: 0, item: 1, person: 2, foreground: 3, door: 4 };
export function orderSceneEntries<T extends SceneDepthEntry>(entries: T[]): T[] {
  return [...entries].sort((a, b) => a.depthY - b.depthY || order[a.kind] - order[b.kind] || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
export function foregroundOpacity(fragment: { depthY: number; bounds: SceneRect }, protectedBodies: { depthY: number; bounds: SceneRect }[]): number {
  return protectedBodies.some(body => {
    const a = fragment.bounds, b = body.bounds;
    return body.depthY <= fragment.depthY && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  }) ? .35 : 1;
}

/** 门槽只消费当前授权目标；其他场景、全局障碍及历史均不是门态输入。 */
export function selectSceneDoor(group: SceneLayerGroup | null, context: ObjectArtContext, targets: TargetViewV2[], catalog: SceneDoorCatalog = objectArtCatalog, staticReady = false): { target: TargetViewV2 | null; frame: ObjectArtFrame | null } {
  const empty = { target: null, frame: null };
  if (!group?.door || !sameScope(group, context)) return empty;
  const slot = group.door;
  const matches = targets.filter(target => target.sceneId === context.sceneId && target.visualKey === slot.visualKey && target.position.x === slot.targetPosition.x && target.position.y === slot.targetPosition.y);
  if (matches.length !== 1) return empty;
  const target = matches[0];
  if (!staticReady || !Object.hasOwn(catalog, slot.visualKey) || catalog[slot.visualKey].version !== slot.objectArtVersion) return { target, frame: null };
  return { target, frame: selectObjectArt(target, context, 'map', catalog) };
}
