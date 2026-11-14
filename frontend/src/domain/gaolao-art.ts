import gaocai from '../assets/gaocai-manifest.json' with { type: 'json' };
import type { Facing } from '../../../game/spatial-types.ts';

export interface SpriteFrame {
  href: string;
  mirrorX: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}

export function spriteResourcePaths(appearanceId: string | undefined): string[] {
  if (appearanceId !== 'gaocai') return [];
  return Object.values(gaocai.native).flatMap(group => [group.idle, ...group.walk].map(frame => `/assets/gaolaozhuang/gaocai/${frame.file}`));
}

/** 输入仅为服务端授权的当前外观键；不解析 entityRef、称呼或真实角色。 */
export function spriteForAppearance(appearanceId: string | undefined, facing: Facing, moving: boolean, distance: number, reducedMotion = false): SpriteFrame | null {
  if (appearanceId !== 'gaocai') return null;
  const direction = gaocai.directions[facing.toLowerCase() as keyof typeof gaocai.directions];
  if (!direction) return null;
  const native = gaocai.native[direction.nativeDirection as keyof typeof gaocai.native];
  const frame = moving && !reducedMotion
    ? native.walk[Math.floor(Math.max(0, distance) / gaocai.cycleDistance * native.walk.length) % native.walk.length]
    : native.idle;
  // scale 已是源组校准后的最终值；不再次乘 groupScale 或按每帧边界归一化。
  return { href: `/assets/gaolaozhuang/gaocai/${frame.file}`, mirrorX: direction.mirrorX, bounds: { x: -frame.footPivot.x * frame.scale, y: -frame.footPivot.y * frame.scale, width: frame.width * frame.scale, height: frame.height * frame.scale } };
}

export function sceneArtwork(sceneId: string | undefined): string | null {
  return sceneId === 'gaolao-courtyard' ? '/assets/gaolaozhuang/scenes/courtyard.png'
    : sceneId === 'gaolao-village-road' ? '/assets/gaolaozhuang/scenes/village-road.png' : null;
}
