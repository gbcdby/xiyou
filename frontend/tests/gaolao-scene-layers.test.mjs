import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSceneDoor, selectSceneLayerGroup, sceneLayerCatalog, validSceneLayerGroup, sceneLayerPresentation, orderSceneEntries, foregroundOpacity } from '../src/domain/gaolao-scene-layers.ts';
import { sceneLayerFixtures } from './scene-layer-fixtures.mjs';

const context = { sessionId: 'scene-fixture', viewId: 'view-one', contentVersion: 'gaolaozhuang-scene-v2', mapVersion: 'gaolao-layout-v1.1', sceneId: 'gaolao-courtyard' };
const group = { ...context, enabled: true, groupVersion: 'controlled-layer-v1', door: { visualKey: 'timber-door', targetPosition: { x: 1250, y: 425 }, depthY: 395, neutralBounds: { x: 1210, y: 300, width: 80, height: 95 }, objectArtVersion: 'controlled-door-v1' } };
const door = { entityRef: 'R' + 'a'.repeat(32), name: '合法公开门', visualKey: 'timber-door', sceneId: context.sceneId, position: { x: 1250, y: 425 }, resourceRevision: '1', fields: [{ key: 'open', label: '开放', value: false }] };
const asset = { file: '/tests/controlled-door-closed.svg', width: 80, height: 95, pivot: { x: 40, y: 65 }, offset: { x: 0, y: -60 }, scale: 1, layer: 'object' };
const catalog = { 'timber-door': { ...context, version: 'controlled-door-v1', variants: { closed: asset, open: { ...asset, file: '/tests/controlled-door-open.svg' } } } };

test('门只由唯一当前授权目标与有效boolean选图，不以全局障碍或名称推断', () => {
  assert.equal(selectSceneDoor(group, context, [], catalog, true).frame, null);
  const closed = selectSceneDoor(group, context, [door], catalog, true);
  assert.equal(closed.target.entityRef, door.entityRef);
  assert.equal(closed.frame.variant, 'closed');
  const open = { ...door, fields: [{ key: 'open', label: '开放', value: true }] };
  assert.equal(selectSceneDoor(group, context, [open], catalog, true).frame.variant, 'open');
  assert.deepEqual(selectSceneDoor(group, context, [{ ...door, name: '任意公开名称', entityRef: 'R' + 'b'.repeat(32) }], catalog, true).frame, closed.frame);
  for (const fields of [[], [{ key: 'open', label: '开放', value: 'false' }], [door.fields[0], door.fields[0]]]) assert.equal(selectSceneDoor(group, context, [{ ...door, fields }], catalog, true).frame, null);
  for (const wrong of [{ ...door, visualKey: undefined }, { ...door, position: { x: 1250, y: 365 } }, { ...door, sceneId: 'unknown-scene' }]) assert.equal(selectSceneDoor(group, context, [wrong], catalog, true).frame, null);
});

test('同key仍是不同引用；多目标、旧scope、未登记或不兼容门资源均中性', () => {
  assert.equal(selectSceneDoor(group, context, [door, { ...door, entityRef: 'R' + 'b'.repeat(32) }], catalog, true).frame, null);
  assert.equal(selectSceneDoor(group, { ...context, sceneId: 'other-scene' }, [door], catalog, true).frame, null);
  assert.equal(selectSceneDoor(group, context, [door], {}, true).frame, null);
  assert.equal(selectSceneDoor(group, context, [door], Object.create(catalog), true).frame, null);
  const mismatched = { 'timber-door': { ...catalog['timber-door'], version: 'other-version' } };
  assert.equal(selectSceneDoor(group, context, [door], mismatched, true).frame, null);
  assert.equal(selectSceneDoor(null, context, [door], catalog, true).frame, null);
});


test('静态组未就绪时即使门资源可用也保持中性，授权目标事实不被改写', () => {
  const before = structuredClone(door);
  const selected = selectSceneDoor(group, context, [door], catalog, false);
  assert.equal(selected.frame, null);
  assert.equal(selected.target.entityRef, door.entityRef);
  assert.deepEqual(door, before);
});

test('空目录、未启用、未知scope和继承登记均不接管原背景', () => {
  assert.deepEqual(sceneLayerCatalog, {});
  assert.equal(selectSceneLayerGroup(context), null);
  const groups = { [context.sceneId]: group };
  assert.equal(selectSceneLayerGroup(context, groups), group);
  assert.equal(selectSceneLayerGroup(context, Object.create(groups)), null);
  assert.equal(selectSceneLayerGroup(context, { [context.sceneId]: { ...group, enabled: false } }), null);
  for (const key of ['contentVersion', 'mapVersion', 'sceneId']) assert.equal(selectSceneLayerGroup({ ...context, [key]: 'unknown' }, groups), null);
  const foreign = { ...context, contentVersion: 'gaolaozhuang-tools-east-scene-v2' };
  assert.equal(selectSceneLayerGroup(foreign, { [context.sceneId]: { ...group, ...foreign } }), null);
});

test('深度稳定排序不合并同点；只有之后绘制且覆盖当前保护对象的静态小片淡化', () => {
  const entries = [{ kind: 'foreground', key: 'front', depthY: 335 }, { kind: 'person', key: 'self', depthY: 300 }, { kind: 'item', key: 'b', depthY: 300 }, { kind: 'item', key: 'a', depthY: 300 }];
  assert.deepEqual(orderSceneEntries(entries).map(value => value.key), ['a', 'b', 'self', 'front']);
  assert.equal(entries.length, 4);
  const fragment = { depthY: 335, bounds: { x: 10, y: 20, width: 20, height: 20 } };
  const body = { depthY: 300, bounds: { x: 20, y: 10, width: 20, height: 20 } };
  assert.equal(foregroundOpacity(fragment, [body]), .35);
  assert.equal(foregroundOpacity(fragment, []), 1);
  assert.equal(foregroundOpacity(fragment, [{ ...body, depthY: 400 }]), 1);
  assert.equal(foregroundOpacity(fragment, [{ ...body, bounds: { ...body.bounds, x: 80 } }]), 1);
});

test('完整组接受合入底层的地面；错误裁窗映射、缺mask或重复前景不启用半组', () => {
  const original = sceneLayerFixtures().group;
  assert.equal(validSceneLayerGroup(original), true);
  const baked = structuredClone(original); baked.floors = [];
  assert.equal(validSceneLayerGroup(baked), true, '地面已合入底层时不重复绘制');
  const mutations = [
    value => { value.base.worldRect.x = 1; },
    value => { value.foreground[0].pixelSize.width = 1; },
    value => { delete value.replaceMask; },
    value => { value.foreground.push(structuredClone(value.foreground[0])); },
    value => { value.base.file = 'https://example.invalid/foreign.png'; },
  ];
  for (const mutate of mutations) { const invalid = structuredClone(original); mutate(invalid); assert.equal(validSceneLayerGroup(invalid), false); }
});

test('登记组的坏门/静态元数据只返回可信中性几何，不向绘制方传递非法资源', () => {
  const fixture = sceneLayerFixtures(), expected = { targetPosition: { x: 1250, y: 425 }, depthY: 395, neutralBounds: { x: 1210, y: 350, width: 80, height: 45 } };
  const mutations = [
    value => { delete value.door; }, value => { delete value.door.neutralBounds; },
    value => { value.door.neutralBounds.width = 0; }, value => { delete value.door.targetPosition; },
    value => { value.door.depthY = NaN; }, value => { delete value.foreground; },
    value => { value.base.worldRect.x = 1; },
  ];
  for (const mutate of mutations) {
    const bad = structuredClone(fixture.group); mutate(bad);
    const selected = sceneLayerPresentation(context, { [context.sceneId]: bad });
    assert.equal(selected.registered, bad); assert.equal(selected.resources, null); assert.deepEqual(selected.door, expected);
    assert.equal(selectSceneDoor(selected.resources, context, [door], catalog, true).frame, null);
  }
  const valid = sceneLayerPresentation(context, fixture.catalog);
  assert.equal(valid.resources, fixture.group); assert.equal(valid.door, fixture.group.door);
});

test('安全降级不扩大登记scope；合法庄外无门，坏庄外也不借院落门槽', () => {
  const fixture = sceneLayerFixtures(); delete fixture.group.door;
  for (const [c, entries] of [
    [context, {}], [context, { [context.sceneId]: { ...fixture.group, enabled: false } }],
    [{ ...context, contentVersion: 'gaolaozhuang-tools-east-scene-v2' }, fixture.catalog],
    [{ ...context, mapVersion: 'unknown-map' }, fixture.catalog],
  ]) assert.deepEqual(sceneLayerPresentation(c, entries), { registered: null, resources: null, door: null });
  const roadContext = { ...context, sceneId: 'gaolao-village-road' }, road = { ...fixture.group, sceneId: roadContext.sceneId };
  const roadCatalog = { [roadContext.sceneId]: road };
  assert.equal(sceneLayerPresentation(roadContext, roadCatalog).resources, road);
  assert.equal(sceneLayerPresentation(roadContext, roadCatalog).door, null);
  road.base.worldRect.x = 1;
  assert.equal(sceneLayerPresentation(roadContext, roadCatalog).resources, null);
  assert.equal(sceneLayerPresentation(roadContext, roadCatalog).door, null);
});
