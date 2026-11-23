export interface HudPreferences {
  guidanceExpanded: boolean;
  mapExpanded: boolean;
  dockExpanded: boolean;
}

export const HUD_PREFERENCES_KEY = 'xiyou.gaolao-hud.v1';
const defaults: HudPreferences = { guidanceExpanded: false, mapExpanded: false, dockExpanded: true };

/** 只保存本机界面开合；旧授权对象、动作和世界状态不能进入偏好。 */
export function readHudPreferences(storage?: Pick<Storage, 'getItem'>): HudPreferences {
  try {
    const value: unknown = JSON.parse(storage?.getItem(HUD_PREFERENCES_KEY) || 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...defaults };
    const record = value as Record<string, unknown>;
    return {
      guidanceExpanded: typeof record.guidanceExpanded === 'boolean' ? record.guidanceExpanded : defaults.guidanceExpanded,
      mapExpanded: typeof record.mapExpanded === 'boolean' ? record.mapExpanded : defaults.mapExpanded,
      dockExpanded: typeof record.dockExpanded === 'boolean' ? record.dockExpanded : defaults.dockExpanded,
    };
  } catch { return { ...defaults }; }
}

export function saveHudPreferences(storage: Pick<Storage, 'setItem'> | undefined, value: HudPreferences): boolean {
  if (!storage) return false;
  try {
    storage.setItem(HUD_PREFERENCES_KEY, JSON.stringify({
      guidanceExpanded: value.guidanceExpanded,
      mapExpanded: value.mapExpanded,
      dockExpanded: value.dockExpanded,
    }));
    return true;
  } catch { return false; }
}
