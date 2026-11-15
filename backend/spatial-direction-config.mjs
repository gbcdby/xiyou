import { RuntimeError } from './errors.mjs';

export const directionCapability = 'spatial-direction-v1';
export const timedTrailCapability = 'spatial-timed-trail-v1';

/** 仅供已采纳的有界双人切片；缺省保持旧行为，不接受任意调参。 */
export function spatialDirectionConfig(value) {
  if (value === undefined || value === null || value === false) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => key !== 'checkpointMs') || ![25, 50].includes(value.checkpointMs)) {
    throw new TypeError('方向交接实验只能显式使用 50 或 25 毫秒检查点。');
  }
  return Object.freeze({ checkpointMs: value.checkpointMs });
}

export function checkDirectionCapability(config, capabilities) {
  if (Array.isArray(capabilities) && capabilities.includes(directionCapability) && (!config || !capabilities.includes('spatial-v2'))) {
    throw new RuntimeError('INVALID_MESSAGE', '本连接未获准使用方向短段能力。');
  }
  if (Array.isArray(capabilities) && capabilities.includes(timedTrailCapability) && (!config || !capabilities.includes('spatial-v2') || !capabilities.includes(directionCapability))) {
    throw new RuntimeError('INVALID_MESSAGE', '分段显示必须同时协商当前方向与空间能力。');
  }
}
