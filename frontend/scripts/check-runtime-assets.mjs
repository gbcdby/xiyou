import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../runtime-assets.json', import.meta.url), 'utf8'));
const gaocai = JSON.parse(await readFile(new URL('../src/assets/gaocai-manifest.json', import.meta.url), 'utf8'));
const frames = Object.values(gaocai.native).flatMap(group => [group.idle, ...group.walk]);
const required = [...frames.map(frame => 'gaocai/' + frame.file), 'scenes/courtyard.png', 'scenes/village-road.png'].sort();
assert.equal(manifest.schemaVersion, 1, '运行素材清单版本有效');
assert.equal(manifest.asset_source, 'original_team', '保持已采用素材来源');
assert.equal(required.length, 47, '本次固定为高才45帧与2张场景');
assert.deepEqual(manifest.files.map(file => file.file).sort(), required, '运行素材清单必须覆盖精确必要文件集合且没有重复');
let bytes = 0;
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
  bytes += value.length;
}
console.log(`运行素材检查通过：${manifest.files.length} 张原 PNG，${bytes} 字节，逐项 SHA-256 一致。`);
