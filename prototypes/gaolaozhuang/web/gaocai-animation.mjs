// 高才试用动画的纯计算：y 向下，朝向只取实际位移，帧相位只取实际路程。
const directions = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'];
const mirrors = { w: 'e', sw: 'se', nw: 'ne' };

export function facingFromDisplacement(dx, dy, previous = 's') {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return previous;
  const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return directions[(sector + 8) % 8];
}

export function gaocaiDirection(facing = 's') {
  const direction = directions.includes(facing) ? facing : 's';
  return { nativeDirection: mirrors[direction] ?? direction, mirrorX: Boolean(mirrors[direction]) };
}

export function gaocaiFrameIndex(walkDistance = 0, frameDurationMs = 90, frameCount = 8) {
  // 205 地图单位/秒 × 90ms × 8帧 = 147.6单位/周期；仅为试接初值，未做物理配速验收。
  const distancePerFrame = 205 * frameDurationMs / 1000;
  return Math.floor(Math.max(0, walkDistance) / distancePerFrame) % frameCount;
}
