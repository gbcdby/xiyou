import gaocai from '../assets/gaocai-manifest.json' with { type: 'json' };
import courtyardHelper from '../assets/courtyard-helper-manifest.json' with { type: 'json' };
import carpenter from '../assets/carpenter-manifest.json' with { type: 'json' };
import kitchenHelper from '../assets/kitchen-helper-manifest.json' with { type: 'json' };
import woodcutter from '../assets/woodcutter-manifest.json' with { type: 'json' };
import wukong from '../assets/wukong-manifest.json' with { type: 'json' };
import bajie from '../assets/bajie-manifest.json' with { type: 'json' };
import gao from '../assets/gao-manifest.json' with { type: 'json' };
import witness from '../assets/witness-manifest.json' with { type: 'json' };
import type { Facing } from '../../../game/spatial-types.ts';

export interface SpriteFrame {
  href: string;
  mirrorX: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface SpriteAsset {
  file: string; width: number; height: number;
  footPivot: { x: number; y: number }; scale: number;
}
export interface SpriteManifest {
  cycleDistance: number;
  directions: Readonly<Record<string, { nativeDirection: string; mirrorX: boolean }>>;
  native: Readonly<Record<string, { idle: SpriteAsset; walk: readonly SpriteAsset[] }>>;
}
export type SpriteCatalog = Readonly<Record<string, { basePath: string; manifest: SpriteManifest }>>;

/** 只注册已验资源；角色扩展只改目录，不改变 Canvas 的通用消费接口。 */
export const appearanceSpriteCatalog: SpriteCatalog = Object.freeze({
  gaocai: { basePath: '/assets/gaolaozhuang/gaocai', manifest: gaocai },
  'courtyard-helper': { basePath: '/assets/gaolaozhuang/courtyard-helper', manifest: courtyardHelper },
  carpenter: { basePath: '/assets/gaolaozhuang/carpenter', manifest: carpenter },
  'kitchen-helper': { basePath: '/assets/gaolaozhuang/kitchen-helper', manifest: kitchenHelper },
  woodcutter: { basePath: '/assets/gaolaozhuang/woodcutter', manifest: woodcutter },
  wukong: { basePath: '/assets/gaolaozhuang/wukong', manifest: wukong },
  bajie: { basePath: '/assets/gaolaozhuang/bajie', manifest: bajie },
  gao: { basePath: '/assets/gaolaozhuang/gao', manifest: gao },
  witness: { basePath: '/assets/gaolaozhuang/witness', manifest: witness },
});
function entryFor(appearanceId: string | undefined, catalog: SpriteCatalog) {
  return appearanceId && Object.hasOwn(catalog, appearanceId) ? catalog[appearanceId] : null;
}
export function spriteResourcePaths(appearanceId: string | undefined, catalog: SpriteCatalog = appearanceSpriteCatalog): string[] {
  const entry = entryFor(appearanceId, catalog);
  if (!entry) return [];
  return [...new Set(Object.values(entry.manifest.native).flatMap(group => [group.idle, ...group.walk].map(frame => `${entry.basePath}/${frame.file}`)))];
}

/** 输入仅为服务端授权的当前外观键；不解析 entityRef、称呼或真实角色。 */
export function spriteForAppearance(appearanceId: string | undefined, facing: Facing, moving: boolean, distance: number, reducedMotion = false, catalog: SpriteCatalog = appearanceSpriteCatalog): SpriteFrame | null {
  const entry = entryFor(appearanceId, catalog);
  if (!entry) return null;
  const manifest = entry.manifest;
  const direction = manifest.directions[facing.toLowerCase()];
  if (!direction) return null;
  const native = manifest.native[direction.nativeDirection];
  if (!native || !native.walk.length || !(manifest.cycleDistance > 0)) return null;
  const frame = moving && !reducedMotion
    ? native.walk[Math.floor(Math.max(0, distance) / manifest.cycleDistance * native.walk.length) % native.walk.length]
    : native.idle;
  // scale 已是源组校准后的最终值；不再次乘 groupScale 或按每帧边界归一化。
  return { href: `${entry.basePath}/${frame.file}`, mirrorX: direction.mirrorX, bounds: { x: -frame.footPivot.x * frame.scale, y: -frame.footPivot.y * frame.scale, width: frame.width * frame.scale, height: frame.height * frame.scale } };
}

export function sceneArtwork(sceneId: string | undefined): string | null {
  return sceneId === 'gaolao-courtyard' ? '/assets/gaolaozhuang/scenes/courtyard.png'
    : sceneId === 'gaolao-village-road' ? '/assets/gaolaozhuang/scenes/village-road.png' : null;
}
