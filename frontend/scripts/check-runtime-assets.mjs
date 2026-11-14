import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { sceneGroupAssets, validSceneLayerGroup } from '../src/domain/gaolao-scene-layers.ts';

const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const manifest = await json('../runtime-assets.json');
const gaocai = await json('../src/assets/gaocai-manifest.json');
const objects = await json('../src/assets/gaolao-object-art.json');
const scenes = await json('../src/assets/gaolao-scene-layers.json');
const frames = Object.values(gaocai.native).flatMap(group => [group.idle, ...group.walk]);
const original = [...frames.map(frame => 'gaocai/' + frame.file), 'scenes/courtyard.png', 'scenes/village-road.png'].sort();
assert.equal(manifest.schemaVersion, 1, '运行素材清单版本有效');
assert.equal(manifest.asset_source, 'original_team', '保持原47项已采用素材来源字段');
assert.equal(original.length, 47, '原基线固定为高才45帧与2张场景');

const staticFiles = new Map();
function relativeFile(file) {
  const prefix = '/assets/gaolaozhuang/';
  assert.ok(typeof file === 'string' && file.startsWith(prefix), '资源只能使用明确的本地公开路径');
  const relative = file.slice(prefix.length);
  assert.match(relative, /^(?:[a-z0-9-]+\/)*[a-z0-9-]+\.png$/, '资源路径不得含跳转、查询或通配符');
  return relative;
}
function register(file, width, height, sha256) {
  const relative = relativeFile(file);
  assert.ok(relative.startsWith('static-v1/'), '新增资源限已批准的 static-v1 目录');
  assert.ok(Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0, '资源尺寸有效');
  const previous = staticFiles.get(relative);
  const metadata = { width, height, ...(sha256 ? { sha256 } : {}) };
  if (previous) assert.deepEqual(metadata, previous, '共用 PNG 的原尺寸和摘要必须一致：' + relative);
  else staticFiles.set(relative, metadata);
}
const variants = {
  'timber-door': ['closed', 'open'], 'cloth-parcel': ['icon', 'loose'],
  'folded-letter': ['icon', 'loose'], 'hemp-rope': ['icon', 'loose'],
  'ledger-book': ['default'], 'farm-rake': ['icon', 'loose'],
};
assert.deepEqual(Object.keys(objects).sort(), Object.keys(variants).sort(), '本批仅登记六个已批准的物件键');
for (const [key, entry] of Object.entries(objects)) {
  assert.equal(entry.contentVersion, 'gaolaozhuang-scene-v2');
  assert.equal(entry.mapVersion, 'gaolao-layout-v1.1');
  assert.equal(entry.sceneId, key === 'farm-rake' ? 'gaolao-village-road' : 'gaolao-courtyard');
  assert.deepEqual(Object.keys(entry.variants).sort(), variants[key], '物件只登记已批准变体：' + key);
  for (const asset of Object.values(entry.variants)) {
    assert.equal(asset.layer, 'object');
    assert.ok([asset.pivot?.x, asset.pivot?.y, asset.scale].every(Number.isFinite) && asset.scale > 0, '物件 pivot 和单一倍率有效');
    if (asset.offset !== undefined) assert.ok([asset.offset?.x, asset.offset?.y].every(Number.isFinite), '物件偏移有效');
    register(asset.file, asset.width, asset.height);
  }
}
assert.equal(staticFiles.size, 7, '六个物件键共用7张原PNG，图标不重复计数');
assert.deepEqual(Object.keys(scenes).sort(), ['gaolao-courtyard', 'gaolao-village-road']);
for (const [sceneId, group] of Object.entries(scenes)) {
  assert.equal(group.enabled, true, '本批完整场景组明确启用');
  assert.equal(group.sceneId, sceneId);
  assert.equal(group.contentVersion, 'gaolaozhuang-scene-v2');
  assert.equal(group.mapVersion, 'gaolao-layout-v1.1');
  assert.ok(validSceneLayerGroup(group), '场景组尺寸、裁窗、映射、mask及门槽合同有效：' + sceneId);
  const courtyard = sceneId === 'gaolao-courtyard';
  assert.equal(group.floors.length, courtyard ? 0 : 1, '后宅地面已合底层，茶棚必须保留独立floor');
  assert.equal(group.foreground.length, courtyard ? 4 : 2);
  const assets = sceneGroupAssets(group);
  assert.equal(assets.length, courtyard ? 6 : 5, '必须包含全部静态依赖，含replaceMask');
  assert.equal(new Set(assets.map(asset => asset.file)).size, assets.length, '必要图层不复用同一文件冒充齐备');
  for (const asset of assets) register(asset.file, asset.pixelSize.width, asset.pixelSize.height, asset.sha256);
  const source = manifest.files.find(file => file.file === relativeFile(group.source.file));
  assert.ok(source && original.includes(source.file), '场景来源必须是保留的原背景');
  assert.equal(group.source.sha256, source.sha256);
  assert.deepEqual(group.source.pixelSize, { width: source.width, height: source.height });
  if (courtyard) assert.equal(objects['timber-door'].version, group.door.objectArtVersion, '后宅静态组和两态门版本配对');
}
assert.equal(staticFiles.size, 18, '本批新增固定为18个去重PNG');
const required = [...original, ...staticFiles.keys()].sort();
assert.equal(required.length, 65, '保留47项基线并追加18项');
assert.deepEqual(manifest.files.map(file => file.file).sort(), required, '运行素材清单必须覆盖精确必要文件集合且没有重复');
const rules = (await readFile(new URL('../public/assets/gaolaozhuang/.gitignore', import.meta.url), 'utf8')).split(/\r?\n/).filter(line => line && !line.startsWith('#'));
assert.deepEqual(rules.filter(line => !line.startsWith('!')), ['*.png', '**/*.png'], '保留PNG默认忽略');
assert.deepEqual(rules.filter(line => line.startsWith('!')).sort(), required.map(file => '!/' + file).sort(), '仅逐文件放行精确65项，不使用宽泛例外');
let originalBytes = 0, staticBytes = 0;
for (const file of manifest.files) {
  let value;
  try { value = await readFile(new URL('../public/assets/gaolaozhuang/' + file.file, import.meta.url)); }
  catch { throw new Error('运行素材缺失或不可读：' + file.file); }
  assert.equal(value.length, file.bytes, '运行素材长度不符：' + file.file);
  assert.equal(createHash('sha256').update(value).digest('hex'), file.sha256, '运行素材摘要不符：' + file.file);
  assert.equal(value.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', '运行素材必须为原 PNG：' + file.file);
  assert.equal(value.readUInt32BE(16), file.width); assert.equal(value.readUInt32BE(20), file.height);
  const frame = frames.find(frame => 'gaocai/' + frame.file === file.file);
  if (frame) { assert.equal(frame.sha256, file.sha256); assert.equal(frame.width, file.width); assert.equal(frame.height, file.height); }
  const asset = staticFiles.get(file.file);
  if (asset) {
    assert.equal(asset.width, file.width); assert.equal(asset.height, file.height);
    if (asset.sha256) assert.equal(asset.sha256, file.sha256, '场景catalog摘要与字节清单一致：' + file.file);
    staticBytes += value.length;
  } else originalBytes += value.length;
}
assert.equal(originalBytes, 13913035, '原47项字节总量不变');
assert.equal(staticBytes, 15125867, '新增18项为明确批准的字节总量');
console.log(`运行素材检查通过：原47项 ${originalBytes} 字节 + 静态18项 ${staticBytes} 字节 = ${manifest.files.length} PNG / ${originalBytes + staticBytes} 字节；逐项 SHA-256、尺寸、catalog与allowlist一致。`);
