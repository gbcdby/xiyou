import released from '../assets/gaolao-object-art.json' with { type: 'json' };
import type { ItemViewV2, TargetViewV2, SnapshotV2 } from '../../../game/spatial-types.ts';

export type ObjectArtSurface = 'map' | 'inventory';
export type ObjectArtVariant = 'loose' | 'fixed' | 'icon' | 'default' | 'closed' | 'open';
export type ObjectArtContext = { sessionId: string; viewId: string; contentVersion: string; mapVersion: string; sceneId: string | null };
export type ObjectArtAsset = { file: string; width: number; height: number; pivot: { x: number; y: number }; scale: number; layer: 'object'; offset?: { x: number; y: number } };
export type ObjectArtCatalog = Readonly<Record<string, { contentVersion: string; mapVersion: string; sceneId: string; variants: Partial<Record<ObjectArtVariant, ObjectArtAsset>> }>>;
export type ObjectArtFrame = { file: string; variant: ObjectArtVariant; layer: 'object'; bounds: { x: number; y: number; width: number; height: number } };
type PublicObject = ItemViewV2 | TargetViewV2;

/** 已释放目录目前为空；缺正式资源时保留原图形与操作。 */
export const objectArtCatalog: ObjectArtCatalog = released;
export function objectArtContext(snapshot: SnapshotV2): ObjectArtContext {
  return { sessionId: snapshot.sessionId, viewId: snapshot.viewId, contentVersion: snapshot.projection.contentVersion, mapVersion: snapshot.projection.mapVersion, sceneId: snapshot.projection.scene?.sceneId ?? null };
}
export const objectInstanceKey = (context: ObjectArtContext, object: PublicObject) => JSON.stringify([context.sessionId, context.viewId, object.entityRef]);
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
  if (entry.contentVersion !== context.contentVersion || entry.mapVersion !== context.mapVersion || entry.sceneId !== context.sceneId || !Object.hasOwn(entry.variants, variant)) return null;
  const asset = entry.variants[variant];
  if (!asset) return null;
  // 文件只来自静态目录的明确条目，绝不从 key/ref/name 拼接路径。
  const offset = asset.offset ?? { x: 0, y: 0 };
  return { file: asset.file, variant, layer: asset.layer, bounds: { x: offset.x - asset.pivot.x * asset.scale, y: offset.y - asset.pivot.y * asset.scale, width: asset.width * asset.scale, height: asset.height * asset.scale } };
}
