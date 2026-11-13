import test from 'node:test';
import assert from 'node:assert/strict';
import { objectArtCatalog, objectDisplayFields, objectInstanceKey, objectVisualVariant, selectObjectArt } from '../src/domain/gaolao-object-art.ts';

const context = { sessionId: 'fixture-session', viewId: 'fixture-view', contentVersion: 'gaolaozhuang-scene-v2', mapVersion: 'fixture-map', sceneId: 'yard' };
const ref = letter => 'R' + letter.repeat(32);
const item = { entityRef: ref('a'), name: '公开绳索', visualKey: 'hemp-rope', location: { kind: 'ground', sceneId: 'yard', position: { x: 365, y: 425 } }, resourceRevision: '1', transferable: true, publicBorrowable: true, fields: [] };
const asset = { file: '/tests/controlled-object.svg', width: 1254, height: 1254, pivot: { x: 627, y: 680 }, scale: 32 / 1003, layer: 'object' };
const entry = variants => ({ contentVersion: context.contentVersion, mapVersion: context.mapVersion, sceneId: context.sceneId, variants });
const catalog = { 'hemp-rope': entry({ loose: asset, icon: { ...asset, scale: 40 / 1254, pivot: { x: 627, y: 627 } } }), 'timber-door': entry({ closed: { ...asset, offset: { x: 0, y: -60 } }, open: { ...asset, file: '/tests/controlled-open.svg', offset: { x: 0, y: -60 } } }), 'support-point': entry({ default: asset }) };
const fixed = value => ({ key: 'fixed', label: '已固定', value });

test('未释放/未知/继承键均回退；不能从名称、ref或key猜资源路径', () => {
  assert.deepEqual(objectArtCatalog, {});
  assert.equal(selectObjectArt(item, context, 'map'), null);
  for (const visualKey of [undefined, 'future-object', 'constructor']) assert.equal(selectObjectArt({ ...item, visualKey }, context, 'map', catalog), null);
  const prototype = { 'hemp-rope': catalog['hemp-rope'] };
  Object.defineProperty(prototype, 'constructor', { get() { throw new Error('不能读取继承资源'); } });
  const inherited = Object.create(prototype);
  assert.equal(selectObjectArt(item, context, 'map', inherited), null);
  assert.equal(selectObjectArt({ ...item, visualKey: 'constructor' }, context, 'map', inherited), null);
  const known = selectObjectArt(item, context, 'map', catalog);
  assert.deepEqual(selectObjectArt({ ...item, entityRef: ref('z'), name: '另一个可见称呼' }, context, 'map', catalog), known);
  for (const field of ['contentVersion', 'mapVersion', 'sceneId']) assert.equal(selectObjectArt(item, { ...context, [field]: 'other' }, 'map', catalog), null);
});

test('固定层必须独立存在；held、跨场景、重复或非布尔事实不画散放图', () => {
  assert.equal(selectObjectArt(item, context, 'map', catalog).variant, 'loose');
  assert.equal(selectObjectArt({ ...item, fields: [fixed(false)] }, context, 'map', catalog).variant, 'loose');
  const attached = { ...item, fields: [fixed(true)] };
  assert.equal(objectVisualVariant(attached, context, 'map'), 'fixed');
  assert.equal(selectObjectArt(attached, context, 'map', catalog), null, '无固定层不可拿散放层顶替');
  const withFixed = { ...catalog, 'hemp-rope': entry({ ...catalog['hemp-rope'].variants, fixed: { ...asset, file: '/tests/controlled-fixed.svg' } }) };
  assert.equal(selectObjectArt(attached, context, 'map', withFixed).variant, 'fixed');
  for (const fields of [[fixed('true')], [fixed(true), fixed(false)], [fixed(false), fixed(false)]]) {
    assert.equal(objectVisualVariant({ ...item, fields }, context, 'map'), 'invalid');
    assert.equal(selectObjectArt({ ...item, fields }, context, 'map', withFixed), null);
  }
  const held = { ...item, location: { kind: 'held', ownerRef: ref('s') } };
  assert.equal(objectVisualVariant(held, context, 'map'), 'hidden');
  assert.equal(selectObjectArt(held, context, 'map', catalog), null);
  assert.equal(selectObjectArt(held, context, 'inventory', catalog).variant, 'icon');
  assert.equal(selectObjectArt({ ...held, fields: [fixed(true)] }, context, 'inventory', catalog), null);
  assert.equal(selectObjectArt(item, context, 'inventory', catalog), null);
  assert.equal(selectObjectArt({ ...item, location: { ...item.location, sceneId: 'other' } }, context, 'map', catalog), null);
});

test('门只按唯一公开open选两态；support锁定历史不能补装配或ready侧别', () => {
  const door = { entityRef: ref('d'), name: '公开目标', visualKey: 'timber-door', sceneId: 'yard', position: { x: 1250, y: 425 }, resourceRevision: '1', availableOperations: [], fields: [] };
  const open = value => ({ key: 'open', label: '已打开', value });
  for (const [value, variant] of [[false, 'closed'], [true, 'open']]) {
    const frame = selectObjectArt({ ...door, fields: [open(value)] }, context, 'map', catalog);
    assert.equal(frame.variant, variant); assert.equal(frame.bounds.y, -60 - 680 * (32 / 1003));
    assert.deepEqual(door.position, { x: 1250, y: 425 });
  }
  for (const fields of [[], [open('true')], [open(true), open(false)]]) assert.equal(selectObjectArt({ ...door, fields }, context, 'map', catalog), null);
  const support = { ...door, visualKey: 'support-point', fields: [{ key: 'locked', label: '协作已提交', value: true }] };
  assert.deepEqual(selectObjectArt(support, context, 'map', catalog), selectObjectArt({ ...support, fields: [] }, context, 'map', catalog));
  const original = { ...support, fields: [{ key: 'locked', label: '门撑锁定', value: true }] };
  assert.equal(objectDisplayFields(original)[0].label, '协作已提交'); assert.equal(original.fields[0].label, '门撑锁定');
  assert.equal(objectDisplayFields({ ...original, visualKey: undefined })[0].label, '门撑锁定');
});

test('几何倍率只施一次，局部偏移不改原权威位置；两ref/新view独立', () => {
  const original = structuredClone(item), frame = selectObjectArt(item, context, 'map', catalog);
  for (const [key, expected] of Object.entries({ x: -627 * 32 / 1003, y: -680 * 32 / 1003, width: 1254 * 32 / 1003, height: 1254 * 32 / 1003 })) assert.ok(Math.abs(frame.bounds[key] - expected) < 1e-10);
  const returned = { ...item, location: { ...item.location, position: { x: 315, y: 390 } } };
  assert.deepEqual(selectObjectArt(returned, context, 'map', catalog), frame, '当前地面根点由地图原location平移，图层不回填初始位置');
  assert.deepEqual(item, original);
  assert.notEqual(objectInstanceKey(context, item), objectInstanceKey(context, { ...item, entityRef: ref('b') }));
  assert.notEqual(objectInstanceKey(context, item), objectInstanceKey({ ...context, viewId: 'new-view' }, item));
  assert.notEqual(objectInstanceKey(context, item), objectInstanceKey({ ...context, sessionId: 'new-session' }, item));
});
