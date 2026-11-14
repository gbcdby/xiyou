import released from '../assets/gaolao-object-art.json' with { type: 'json' };
import type { ItemViewV2, TargetViewV2, SnapshotV2 } from '../../../game/spatial-types.ts';
import { gaolaoPersonalProfile, gaolaoPersonalProfiles } from '../../../protocol/spatial.mjs';

export type ObjectArtSurface = 'map' | 'inventory';
export type ObjectArtVariant = 'loose' | 'fixed' | 'icon' | 'default' | 'closed' | 'open';
export type ObjectArtContext = { sessionId: string; viewId: string; contentVersion: string; mapVersion: string; sceneId: string | null; chapterVersion?: string; reducerVersion?: string; variantId?: string };
export type ObjectArtAsset = { file: string; width: number; height: number; pivot: { x: number; y: number }; scale: number; layer: 'object'; offset?: { x: number; y: number } };
export type ObjectArtCatalog = Readonly<Record<string, { contentVersion: string; mapVersion: string; sceneId: string; variants: Partial<Record<ObjectArtVariant, ObjectArtAsset>> }>>;
export type ObjectArtFrame = { file: string; variant: ObjectArtVariant; layer: 'object'; bounds: { x: number; y: number; width: number; height: number } };
export type ObjectArtResourceState = { instanceKey: string; requestKey: string; ready: boolean; failed: boolean };
type PublicObject = ItemViewV2 | TargetViewV2;

/** 已获准的明确条目；构建检查校验 JSON 合同，缺变体或 scope 不匹配时仍保留原图形与操作。 */
export const objectArtCatalog = released as ObjectArtCatalog;
export function objectArtContext(snapshot: SnapshotV2): ObjectArtContext {
  const p = snapshot.projection;
  return { sessionId: snapshot.sessionId, viewId: snapshot.viewId, contentVersion: p.contentVersion, mapVersion: p.mapVersion, sceneId: p.scene?.sceneId ?? null, chapterVersion: p.chapterVersion, reducerVersion: p.reducerVersion, variantId: p.variantId };
}
/** 仅固定新默认复用同几何 catalog；不以版本前缀或未知布局借用默认资源。 */
export function objectArtContentVersion(context: ObjectArtContext): string | null {
  if (!gaolaoPersonalProfiles.some(profile => profile.contentVersion === context.contentVersion)) return context.contentVersion;
  const profile = gaolaoPersonalProfile(context);
  if (!profile) return null;
  return profile.contentVersion === 'gaolaozhuang-scene-v3' ? 'gaolaozhuang-scene-v2' : profile.contentVersion;
}
export const objectInstanceKey = (context: ObjectArtContext, object: PublicObject) => JSON.stringify([context.sessionId, context.viewId, object.entityRef]);
/** 同一ref换图或重试也必须撤销旧几何；未失败不等于已经画出图片。 */
export const objectArtRequestKey = (instanceKey: string, frame: ObjectArtFrame | null, attempt: number) => JSON.stringify([instanceKey, frame, attempt]);
export function readyObjectArtFrame(frame: ObjectArtFrame | null, instanceKey: string, attempt: number, state?: ObjectArtResourceState | null): ObjectArtFrame | null {
  return frame && state?.ready && !state.failed && state.instanceKey === instanceKey && state.requestKey === objectArtRequestKey(instanceKey, frame, attempt) ? frame : null;
}
/** 承力点的锁定值是已提交的协作历史，当前装配仍只看各物件 fixed。 */
export function objectDisplayFields(object: PublicObject) {
  return !('location' in object) && object.visualKey === 'support-point'
    ? object.fields.map(field => field.key === 'locked' ? { ...field, label: '协作已提交' } : field)
    : object.fields;
}

function booleanField(object: PublicObject, key: string): boolean | 'missing' | 'invalid' {
  const matches = object.fields.filter(field => field.key === key);
  if (!matches.length) return 'missing';
  return matches.length === 1 && typeof matches[0].value === 'boolean' ? matches[0].value : 'invalid';
}
/** 只解释当前授权事实；held 优先撤去地面实例，历史协作锁定不参与装配。 */
export function objectVisualVariant(object: PublicObject, context: ObjectArtContext, surface: ObjectArtSurface): ObjectArtVariant | 'hidden' | 'invalid' {
  if ('location' in object) {
    if (surface === 'map' && (object.location.kind !== 'ground' || object.location.sceneId !== context.sceneId)) return 'hidden';
    if (surface === 'inventory' && object.location.kind !== 'held') return 'hidden';
    const fixed = booleanField(object, 'fixed');
    if (fixed === 'invalid' || object.location.kind === 'held' && fixed === true) return 'invalid';
    return surface === 'inventory' ? 'icon' : fixed === true ? 'fixed' : 'loose';
  }
  if (surface !== 'map' || object.sceneId !== context.sceneId) return 'hidden';
  if (object.visualKey !== 'timber-door') return 'default';
  const open = booleanField(object, 'open');
  return open === true ? 'open' : open === false ? 'closed' : 'invalid';
}

export function selectObjectArt(object: PublicObject, context: ObjectArtContext, surface: ObjectArtSurface, catalog: ObjectArtCatalog = objectArtCatalog): ObjectArtFrame | null {
  const variant = objectVisualVariant(object, context, surface), key = object.visualKey;
  if (variant === 'hidden' || variant === 'invalid' || !key || !Object.hasOwn(catalog, key)) return null;
  const entry = catalog[key];
  if (entry.contentVersion !== objectArtContentVersion(context) || entry.mapVersion !== context.mapVersion || entry.sceneId !== context.sceneId || !Object.hasOwn(entry.variants, variant)) return null;
  const asset = entry.variants[variant];
  if (!asset) return null;
  // 文件只来自静态目录的明确条目，绝不从 key/ref/name 拼接路径。
  const offset = asset.offset ?? { x: 0, y: 0 };
  return { file: asset.file, variant, layer: asset.layer, bounds: { x: offset.x - asset.pivot.x * asset.scale, y: offset.y - asset.pivot.y * asset.scale, width: asset.width * asset.scale, height: asset.height * asset.scale } };
}
