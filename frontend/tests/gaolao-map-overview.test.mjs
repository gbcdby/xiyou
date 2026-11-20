import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapPoint, navigationScene, navigationScenes } from '../src/domain/gaolao-map-overview.ts';

test('地图点击使用等比留白后的逆变换，纸边不产生越界世界动作', () => {
  const scene = { width: 1600, height: 1000 };
  const size = { width: 256, height: 176 };
  assert.deepEqual(mapPoint(scene, size, { x: 128, y: 88 }), { x: 800, y: 500 });
  assert.deepEqual(mapPoint(scene, size, { x: 8, y: 13 }), { x: 0, y: 0 });
  assert.equal(mapPoint(scene, size, { x: 128, y: 4 }), null);
  assert.equal(mapPoint(scene, size, { x: 255, y: 88 }), null);
});

test('当前图与全图使用同一公开地点目录，真实剧情/样例锚点不会被当前scene补回', () => {
  const content = JSON.parse(readFileSync(new URL('../../content/fixtures/gaolaozhuang-scene-v3.json', import.meta.url), 'utf8'));
  const scene = content.scenes.find(value => value.sceneId === 'gaolao-courtyard');
  const publicScene = { ...scene, anchors: scene.anchors.filter(value => ['C04', 'C11', 'C20'].includes(value.anchorId)).map(value => ({ ...value, label: { C04: '侧窗', C11: '客房门口', C20: '去庄外短路' }[value.anchorId] })) };
  const before = structuredClone(scene);
  assert.deepEqual(navigationScene(scene, [publicScene]).anchors, publicScene.anchors);
  assert.deepEqual(navigationScenes(scene, [publicScene])[0].anchors, publicScene.anchors);
  assert.doesNotMatch(JSON.stringify(navigationScene(scene, [publicScene]).anchors), /包裹|信件|乔装|样例|脚底/);
  assert.deepEqual(navigationScene(scene, [{ ...publicScene, anchors: [] }]).anchors, [], '已提供的空目录不能回退原始锚点');
  assert.deepEqual(scene, before, '不裁改供规则使用的原始scene');
});

test('旧客户端目录缺失时仅保留实际出口位置，并以出口文案替代原始标签', () => {
  const scene = { sceneId: 'room', name: '本场', width: 100, height: 80, unitsPerPixel: 1, walkableAreas: [], anchors: [{ anchorId: 'private', label: '本人包裹／信件', position: { x: 5, y: 6 } }, { anchorId: 'exit', label: '样例演员脚底', position: { x: 30, y: 40 } }], exits: [{ exitId: 'door', anchorId: 'exit', destinationSceneId: 'road', destination: { x: 2, y: 3 }, open: true }] };
  const current = navigationScene(scene, []);
  assert.deepEqual(current.anchors, [{ anchorId: 'exit', label: '场景出口 1', position: { x: 30, y: 40 } }]);
  assert.deepEqual(navigationScenes(scene, []).map(value => value.anchors), [current.anchors]);
  assert.doesNotMatch(JSON.stringify(current), /包裹|信件|样例|脚底|"open"/);
  assert.equal(navigationScene(null, []), null);
});
