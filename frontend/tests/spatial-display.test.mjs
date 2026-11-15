import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneDisplayProjection } from '../src/domain/spatial-display.ts';
import { spatialSnapshot } from './spatial-fixture.mjs';

test('公开概览合并只用于展示，原授权详情优先且不改权威输入', () => {
  const p = spatialSnapshot().projection;
  const door = { entityRef: 'door_0000000000000000000000000000000', name: '门', sceneId: 'yard', position: { x: 800, y: 100 }, resourceRevision: '4', visualKey: 'timber-door', visualState: 'open' };
  p.sceneOverview = { entities: [], items: [], targets: [door] };
  const before = structuredClone(p), publicDisplay = sceneDisplayProjection(p);
  assert.equal(p.targets.length, 0); assert.deepEqual(p, before);
  assert.deepEqual(publicDisplay.targets[0].fields, [{ key: 'open', label: '门已打开', value: true }]);
  assert.deepEqual(publicDisplay.targets[0].availableOperations, []);
  assert.equal(publicDisplay.targets[0].resourceRevision, '4');
  p.targets.push({ ...door, fields: [{ key: 'known', label: '已知', value: '已授权正文' }], availableOperations: ['inspect-door'] });
  assert.deepEqual(sceneDisplayProjection(p).targets[0].fields, p.targets[0].fields);
  assert.deepEqual(sceneDisplayProjection(p).targets[0].availableOperations, ['inspect-door']);
});

test('离开场景或移走地物后不保留历史概览，未知地物不获得转交能力', () => {
  const p = spatialSnapshot().projection;
  p.sceneOverview = { entities: [], targets: [], items: [{ entityRef: 'item_0000000000000000000000000000000', name: '物件', resourceRevision: '8', location: { kind: 'ground', sceneId: 'yard', position: { x: 300, y: 100 } }, visualState: 'default' }] };
  const first = sceneDisplayProjection(p);
  assert.equal(first.items.length, 1); assert.equal(first.items[0].transferable, false); assert.deepEqual(first.items[0].fields, []);
  p.sceneOverview.items = [];
  assert.equal(sceneDisplayProjection(p).items.length, 0);
});
