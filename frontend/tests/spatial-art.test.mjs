import test from 'node:test';
import assert from 'node:assert/strict';
import { spriteForAppearance } from '../src/domain/gaolao-art.ts';
import { ConfirmedMotion } from '../src/domain/spatial-motion.ts';
import { spatialSnapshot } from './spatial-fixture.mjs';

test('只以公开外观键选图，未知身份与缺字段保持中性回退', () => {
  assert.equal(spriteForAppearance(undefined, 'S', false, 0), null);
  assert.equal(spriteForAppearance('private-wukong-id', 'S', false, 0), null);
  assert.ok(spriteForAppearance('gaocai', 'SE', false, 0));
});

test('高才停步使用独立站姿，镜像围绕脚底而不改变最终缩放', () => {
  const east = spriteForAppearance('gaocai', 'E', false, 0);
  const west = spriteForAppearance('gaocai', 'W', false, 0);
  assert.match(east.href, /idle\/e\.png$/);
  assert.equal(east.href, west.href);
  assert.equal(east.mirrorX, false); assert.equal(west.mirrorX, true);
  assert.deepEqual(east.bounds, west.bounds);
  const southeast = spriteForAppearance('gaocai', 'SE', false, 0);
  assert.equal(southeast.bounds.y, -527 * 0.14559386973180077);
  assert.equal(southeast.bounds.height, 543 * 0.14559386973180077);
});

test('步态由累计路程推进，减弱动态使用同朝向站姿', () => {
  const start = spriteForAppearance('gaocai', 'N', true, 0);
  const next = spriteForAppearance('gaocai', 'N', true, 18.45);
  const loop = spriteForAppearance('gaocai', 'N', true, 147.6);
  assert.notEqual(start.href, next.href); assert.equal(start.href, loop.href);
  assert.match(spriteForAppearance('gaocai', 'N', true, 32, true).href, /idle\/n\.png$/);
});

test('绘制位置、步态路程和朝向取同一已确认折线，停止后不继续走步', () => {
  const motion = new ConfirmedMotion(); const first = spatialSnapshot();
  first.projection.self.position = { x: 0, y: 0 }; first.projection.self.facing = 'E';
  motion.update(first, 0);
  const second = structuredClone(first); second.projection.sceneTimeMs += 200;
  second.projection.self.position = { x: 10, y: 10 };
  second.projection.movement = { sceneId: 'yard', path: [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }], status: 'arrived' };
  motion.update(second, 200);
  assert.deepEqual(motion.pose(first.projection.self.entityRef, 250), { position: { x: 0, y: 5 }, facing: 'S', moving: true, distance: 5 });
  assert.deepEqual(motion.pose(first.projection.self.entityRef, 350), { position: { x: 5, y: 10 }, facing: 'E', moving: true, distance: 15 });
  const stopped = motion.pose(first.projection.self.entityRef, 400);
  assert.equal(stopped.moving, false); assert.equal(stopped.distance, 20); assert.equal(stopped.facing, 'E');
  assert.deepEqual(motion.pose(first.projection.self.entityRef, 10000), stopped);
});

test('换外观代次或重新取得视图时丢弃旧步态与路径', () => {
  const motion = new ConfirmedMotion(); const snapshot = spatialSnapshot();
  motion.update(snapshot, 0);
  const changed = structuredClone(snapshot); changed.projection.self.appearanceEpoch = '2'; changed.projection.self.facing = 'NW'; changed.projection.self.position = { x: 400, y: 400 };
  motion.update(changed, 10);
  assert.deepEqual(motion.pose(changed.projection.self.entityRef, 20), { position: { x: 400, y: 400 }, facing: 'NW', moving: false, distance: 0 });
});
