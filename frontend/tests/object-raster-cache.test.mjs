import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectRasterCache } from '../src/rendering/object-raster-cache.ts';

const format = { alpha: true, colorSpace: 'srgb', colorType: 'unorm8', desynchronized: false, willReadFrequently: false };
const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const picture = (src = '/objects/letter.png') => ({ complete: true, naturalWidth: 1254, naturalHeight: 1254, src, currentSrc: src });
function context(attributes = format) {
  const states = [], draws = [], clears = [], transforms = [], operations = [];
  return {
    canvas: { width: 1024, height: 768 },
    globalAlpha: 1, globalCompositeOperation: 'source-over', filter: 'none', shadowColor: 'rgba(0, 0, 0, 0)',
    shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, imageSmoothingEnabled: true, imageSmoothingQuality: 'low',
    matrix: { ...identity }, clipToken: '原场景裁剪', draws, clears, transforms, operations, transformReads: 0,
    getContextAttributes: () => ({ ...attributes }), getTransform() { this.transformReads++; return { ...this.matrix }; },
    save() { states.push({ matrix: { ...this.matrix }, clipToken: this.clipToken }); },
    restore() { Object.assign(this, states.pop()); },
    setTransform(a, b, c, d, e, f) { this.matrix = { a, b, c, d, e, f }; transforms.push({ ...this.matrix }); operations.push(['setTransform', a, b, c, d, e, f]); },
    translate(x, y) { const m = this.matrix; m.e += m.a * x + m.c * y; m.f += m.b * x + m.d * y; operations.push(['translate', x, y]); },
    scale(x, y) { const m = this.matrix; m.a *= x; m.b *= x; m.c *= y; m.d *= y; operations.push(['scale', x, y]); },
    clearRect(...args) { clears.push({ args, matrix: { ...this.matrix } }); },
    drawImage(...args) { draws.push({ args, matrix: { ...this.matrix }, clipToken: this.clipToken }); },
  };
}

const originTransform = () => ({ dpr: 1, fit: { x: 0, y: 0, scale: 1 }, position: { x: 0, y: 0 } });
function applyTransform(target, transform) {
  const { dpr, fit, position } = transform;
  target.setTransform(dpr, 0, 0, dpr, 0, 0); target.translate(fit.x, fit.y);
  target.scale(fit.scale, fit.scale); target.translate(position.x, position.y);
}
function facility() {
  const surfaces = [];
  return { surfaces, create() {
    const ctx = context(), tile = { width: 0, height: 0, getContext: () => ctx, ctx };
    ctx.canvas = tile;
    surfaces.push(tile); return tile;
  } };
}

function byUse(made) {
  const scratches = made.surfaces.filter(surface => surface.ctx.draws.some(draw => draw.args[0]?.naturalWidth > 0));
  const tiles = made.surfaces.filter(surface => surface.ctx.draws.some(draw => scratches.includes(draw.args[0])));
  return { scratches, tiles };
}

test('C-R1/C-R4：同图同相位只生成一次缩图，每次仍在原裁剪中合成并还原变换', () => {
  const made = facility(), cache = new ObjectRasterCache(() => made.create()), target = context(), image = picture();
  const original = { a: .75, b: 0, c: 0, d: .75, e: 12.25, f: 18.5 }, bounds = { x: -3.5, y: -7.25, width: 20, height: 30 };
  const transform = { dpr: 1.25, fit: { x: 5, y: 10, scale: .6 }, position: { x: 8, y: 8 } };
  applyTransform(target, transform);
  assert.equal(cache.draw(target, image, bounds, transform), true);
  assert.equal(cache.draw(target, image, bounds, transform), true);
  assert.equal(made.surfaces.length, 2, '同一图与完整相位只生成一个scratch和一个retained tile');
  const [scratch, tile] = made.surfaces;
  assert.deepEqual([scratch.width, scratch.height], [1024, 768]);
  assert.equal(scratch.ctx.draws.length, 1, '原大图只在首次miss时提交');
  assert.deepEqual(scratch.ctx.draws[0].args, [image, -3.5, -7.25, 20, 30]);
  assert.deepEqual(scratch.ctx.draws[0].matrix, original, '原四步重放得到相同CTM，不减整数tile原点');
  assert.deepEqual(scratch.ctx.clears, [{ args: [0, 0, 1024, 768], matrix: identity }], 'hit不清空或改写scratch');
  assert.deepEqual(scratch.ctx.transforms, [identity, { a: 1.25, b: 0, c: 0, d: 1.25, e: 0, f: 0 }], 'hit不设置scratch变换');
  assert.equal(tile.ctx.draws.length, 1);
  assert.deepEqual(tile.ctx.draws[0].args, [scratch, 7, 11, 20, 27, 0, 0, 20, 27]);
  assert.deepEqual(tile.ctx.draws[0].matrix, identity, '整数交集等大复制不再缩放');
  assert.deepEqual([tile.width, tile.height], [20, 27]);
  assert.equal(target.draws.length, 2, '命中缓存仍每帧完成对象合成');
  for (const draw of target.draws) {
    assert.deepEqual(draw.args, [tile, 7, 11]);
    assert.deepEqual(draw.matrix, identity, '按整数设备像素1:1合成，不再次缩放');
    assert.equal(draw.clipToken, '原场景裁剪');
  }
  assert.deepEqual(target.matrix, original); assert.equal(target.clipToken, '原场景裁剪');
});

test('C-R3：原图实例、来源、尺寸、完整相位、bounds和smoothing变化都重新生成', () => {
  const made = facility(), cache = new ObjectRasterCache(() => made.create()), target = context();
  const bounds = { x: -5.5, y: -8.25, width: 20, height: 30 }, first = picture();
  const transform = originTransform();
  const draw = image => { applyTransform(target, transform); assert.equal(cache.draw(target, image, bounds, transform), true); };
  draw(first); draw(first); assert.equal(made.surfaces.length, 2);
  const replacement = picture(); draw(replacement); assert.equal(made.surfaces.length, 3, '同 URL 的新资源不能命中旧实例');
  replacement.currentSrc += '?retry=1'; draw(replacement);
  replacement.src += '?retry=1'; draw(replacement);
  replacement.naturalWidth++; draw(replacement);
  replacement.naturalHeight++; draw(replacement);
  transform.position.x += .00001; draw(replacement);
  transform.position.y += .00001; draw(replacement);
  transform.fit.scale += .00001; draw(replacement);
  transform.dpr += .00001; draw(replacement);
  bounds.x += .00001; draw(replacement);
  bounds.y += .00001; draw(replacement);
  bounds.width += .00001; draw(replacement);
  bounds.height += .00001; draw(replacement);
  target.imageSmoothingEnabled = false; draw(replacement);
  target.imageSmoothingQuality = 'high'; draw(replacement);
  const { scratches, tiles } = byUse(made);
  assert.equal(made.surfaces.length, 17, '小数相位不量化，图像/几何/平滑参数各自失效');
  assert.equal(scratches.length, 1); assert.equal(tiles.length, 16);
  assert.equal(scratches[0].ctx.draws.length, 16); assert.equal(scratches[0].ctx.clears.length, 16, '同backing连续miss复用同一个scratch');
  assert.equal(scratches[0].ctx.imageSmoothingEnabled, false); assert.equal(scratches[0].ctx.imageSmoothingQuality, 'high');
  assert.equal(tiles.at(-1).ctx.imageSmoothingEnabled, false); assert.equal(tiles.at(-1).ctx.imageSmoothingQuality, 'high');
});

test('C-R3：非默认合成、格式、变换、无效图像与超限tile直接回退且不分配', () => {
  const made = facility(), cache = new ObjectRasterCache(() => made.create()), image = picture(), bounds = { x: 0, y: 0, width: 20, height: 30 };
  const changes = [
    ctx => { ctx.globalAlpha = .5; }, ctx => { ctx.globalCompositeOperation = 'copy'; }, ctx => { ctx.filter = 'blur(1px)'; },
    ctx => { ctx.shadowColor = 'black'; }, ctx => { ctx.shadowBlur = 1; }, ctx => { ctx.shadowOffsetX = 1; }, ctx => { ctx.shadowOffsetY = 1; },
    ctx => { ctx.matrix.b = .1; }, ctx => { ctx.matrix.c = .1; }, ctx => { ctx.matrix.a = -1; }, ctx => { ctx.matrix.d = 0; }, ctx => { ctx.matrix.e = Infinity; },
  ];
  for (const change of changes) { const target = context(); change(target); assert.equal(cache.draw(target, image, bounds, originTransform()), false); assert.equal(target.draws.length, 0); }
  for (const altered of [{ alpha: false }, { colorSpace: 'display-p3' }, { colorType: 'float16' }, { desynchronized: true }, { willReadFrequently: true }, { colorType: undefined }]) {
    assert.equal(cache.draw(context({ ...format, ...altered }), image, bounds, originTransform()), false);
  }
  for (const altered of [{ complete: false }, { naturalWidth: 0 }, { naturalHeight: 0 }]) assert.equal(cache.draw(context(), { ...image, ...altered }, bounds, originTransform()), false);
  for (const altered of [{ x: NaN }, { width: 0 }, { height: -1 }, { width: 600, height: 600 }]) assert.equal(cache.draw(context(), image, { ...bounds, ...altered }, originTransform()), false);
  assert.equal(made.surfaces.length, 0);
  assert.equal(cache.draw(context(), image, bounds, originTransform()), true, '不支持的状态不污染下一次可支持绘制');
});

test('C-R3：LRU最多32项，触及项保留，clear归零全部派生backing并允许重建', () => {
  const made = facility(), cache = new ObjectRasterCache(() => made.create()), target = context(), bounds = { x: 0, y: 0, width: 10, height: 10 };
  const images = Array.from({ length: 33 }, (_, index) => picture('/object/' + index));
  for (const image of images.slice(0, 32)) assert.equal(cache.draw(target, image, bounds, originTransform()), true);
  assert.equal(cache.draw(target, images[0], bounds, originTransform()), true);
  assert.equal(cache.draw(target, images[32], bounds, originTransform()), true);
  const { scratches, tiles } = byUse(made);
  assert.equal(scratches.length, 1); assert.equal(tiles.length, 33);
  assert.equal(tiles[1].width, 0, '第二项成为最旧项并释放');
  assert.ok(tiles[0].width > 0, '最近触及的首项保留');
  assert.equal(tiles.filter(tile => tile.width > 0).length, 32, 'retained条目预算不包含scratch');
  assert.equal(scratches[0].width * scratches[0].height, 1024 * 768);
  cache.clear(); assert.ok(made.surfaces.every(tile => tile.width === 0 && tile.height === 0));
  assert.equal(cache.draw(target, images[0], bounds, originTransform()), true); assert.equal(made.surfaces.length, 36);
});

test('C-R3：总backing像素上限与单tile上限分别生效', () => {
  const made = facility(), cache = new ObjectRasterCache(() => made.create()), target = context(), bounds = { x: 0, y: 0, width: 508, height: 508 };
  for (let i = 0; i < 5; i++) assert.equal(cache.draw(target, picture('/object/' + i), bounds, originTransform()), true);
  const { scratches, tiles } = byUse(made);
  assert.equal(scratches.length, 1); assert.equal(tiles.length, 5);
  assert.equal(tiles[0].width, 0);
  assert.equal(tiles.reduce((pixels, tile) => pixels + tile.width * tile.height, 0), 1_048_576);
  assert.equal(scratches[0].width * scratches[0].height, 1024 * 768, 'scratch单列而不占用或扩张原tile预算');
  assert.equal(cache.draw(target, picture('/large'), { ...bounds, width: 509 }, originTransform()), false);
  assert.equal(made.surfaces.length, 6, '超单tile限制不分配');
});

test('C-R3：scratch与tile每个设施阶段失败均释放，同代不重试，clear后可恢复', () => {
  const image = picture(), bounds = { x: 0, y: 0, width: 10, height: 10 };
  for (const stage of ['scratch-create', 'scratch-context', 'scratch-format', 'scratch-transform', 'scratch-clear', 'scratch-translate', 'scratch-scale', 'scratch-matrix-read', 'scratch-source', 'tile-create', 'tile-context', 'tile-format', 'tile-transform', 'tile-crop']) {
    const made = facility(); let attempts = 0, fail = true;
    const failNow = () => { throw new Error('受控设施失败：' + stage); };
    const cache = new ObjectRasterCache(() => {
      attempts++; const role = attempts === 1 ? 'scratch' : 'tile';
      if (fail && stage === role + '-create') failNow();
      const surface = made.create();
      if (fail && stage === role + '-context') surface.getContext = () => null;
      if (fail && stage === role + '-format') surface.ctx.getContextAttributes = () => ({ ...format, colorSpace: 'display-p3' });
      if (fail && stage === role + '-transform') surface.ctx.setTransform = failNow;
      if (fail && stage === 'scratch-clear') surface.ctx.clearRect = failNow;
      if (fail && stage === 'scratch-translate') surface.ctx.translate = failNow;
      if (fail && stage === 'scratch-scale') surface.ctx.scale = failNow;
      if (fail && stage === 'scratch-matrix-read') surface.ctx.getTransform = failNow;
      if (fail && (stage === 'scratch-source' || stage === 'tile-crop') && stage.startsWith(role)) surface.ctx.drawImage = failNow;
      return surface;
    });
    const target = context(), transform = originTransform(); transform.position.x = 3.75; applyTransform(target, transform);
    assert.equal(cache.draw(target, image, bounds, transform), false, stage); assert.equal(cache.draw(target, image, bounds, transform), false, stage);
    const failedAttempts = stage.startsWith('scratch') ? 1 : 2;
    assert.equal(attempts, failedAttempts, stage + '：同backing失败代不重试');
    assert.equal(target.draws.length, 0); assert.equal(target.matrix.e, 3.75);
    assert.ok(made.surfaces.every(surface => surface.width === 0 && surface.height === 0), stage + '：半成品也归零');
    fail = false; cache.clear(); assert.equal(cache.draw(target, image, bounds, transform), true, stage);
    assert.equal(attempts, failedAttempts + 2, stage + '：clear后重新创建scratch和tile');
  }
});

test('C-R3：目标合成失败先完整restore，再回退；原图异常由调用方照常保留', () => {
  const made = facility(), cache = new ObjectRasterCache(() => made.create()), target = context(), image = picture(), bounds = { x: 0, y: 0, width: 10, height: 10 };
  const transform = originTransform(); transform.position.x = 12.25; applyTransform(target, transform); const originalError = new Error('原图绘制失败'), attempts = [];
  target.drawImage = source => { attempts.push({ source, matrix: { ...target.matrix } }); throw source === image ? originalError : new Error('派生合成失败'); };
  const draw = () => { if (!cache.draw(target, image, bounds, transform)) target.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height); };
  assert.throws(draw, error => error === originalError);
  assert.deepEqual(attempts.map(attempt => attempt.matrix.e), [0, 12.25]);
  assert.equal(target.clipToken, '原场景裁剪'); assert.ok(made.surfaces.every(tile => tile.width === 0 && tile.height === 0));
});

test('C-R3：负origin与右下越界只裁整数交集，原tile尺寸及透明padding不缩小', () => {
  for (const sample of [
    { backing: [1599, 1201], bounds: { x: -114, y: 264, width: 243, height: 243 }, size: [247, 247], copy: [0, 262, 131, 247, 116, 0, 131, 247], origin: [-116, 262] },
    { backing: [100, 80], bounds: { x: -7, y: -5, width: 20, height: 15 }, size: [24, 19], copy: [0, 0, 15, 12, 9, 7, 15, 12], origin: [-9, -7] },
    { backing: [100, 80], bounds: { x: 90, y: 70, width: 20, height: 15 }, size: [24, 19], copy: [88, 68, 12, 12, 0, 0, 12, 12], origin: [88, 68] },
  ]) {
    const made = facility(), cache = new ObjectRasterCache(() => made.create()), target = context(), image = picture();
    [target.canvas.width, target.canvas.height] = sample.backing;
    assert.equal(cache.draw(target, image, sample.bounds, originTransform()), true);
    const { scratches: [scratch], tiles: [tile] } = byUse(made);
    assert.deepEqual([scratch.width, scratch.height], sample.backing);
    assert.deepEqual([tile.width, tile.height], sample.size);
    assert.deepEqual(tile.ctx.draws[0].args, [scratch, ...sample.copy]);
    assert.deepEqual(tile.ctx.draws[0].matrix, identity);
    assert.deepEqual(target.draws[0].args, [tile, ...sample.origin]);
    assert.deepEqual(scratch.ctx.draws[0].args, [image, sample.bounds.x, sample.bounds.y, sample.bounds.width, sample.bounds.height]);
  }
  const made = facility(), cache = new ObjectRasterCache(() => made.create()), target = context();
  for (const bounds of [
    { x: -30, y: 0, width: 10, height: 10 }, { x: 0, y: -30, width: 10, height: 10 },
    { x: 1030, y: 0, width: 10, height: 10 }, { x: 0, y: 780, width: 10, height: 10 },
    { x: -500, y: 0, width: 600, height: 600 },
  ]) assert.equal(cache.draw(target, picture(), bounds, originTransform()), false);
  assert.equal(made.surfaces.length, 0, '完全屏外不分配；部分可见也不能裁小tile绕过单项预算');
});

test('C-R3：backing变化先释放旧代，容量与输入早退不阻挡失效', () => {
  const made = facility(), cache = new ObjectRasterCache(() => made.create()), target = context(), image = picture(), bounds = { x: 0, y: 0, width: 10, height: 10 };
  for (const [width, height, change, drawBounds] of [
    [1000, 768, () => { target.globalAlpha = .5; }, bounds],
    [1000, 800, () => {}, { ...bounds, width: 600, height: 600 }],
    [2049, 2048, () => {}, bounds],
    [0, 768, () => {}, bounds],
  ]) {
    target.canvas.width = 1024; target.canvas.height = 768; target.globalAlpha = 1;
    assert.equal(cache.draw(target, image, bounds, originTransform()), true);
    const old = made.surfaces.filter(surface => surface.width > 0), count = made.surfaces.length;
    target.canvas.width = width; target.canvas.height = height; change();
    assert.equal(cache.draw(target, image, drawBounds, originTransform()), false);
    assert.ok(old.every(surface => surface.width === 0 && surface.height === 0));
    assert.equal(made.surfaces.length, count, '早退不分配新表面');
  }
  target.globalAlpha = 1;
  for (const [width, height] of [[1.5, 768], [1024, -1], [NaN, 768], [Number.MAX_SAFE_INTEGER, 2]]) {
    target.canvas.width = width; target.canvas.height = height;
    assert.equal(cache.draw(target, image, bounds, originTransform()), false);
  }
  target.canvas.width = target.canvas.height = 2048;
  assert.equal(cache.draw(target, image, bounds, originTransform()), true, '独立scratch预算的4194304像素边界可用');
  const { scratches, tiles } = byUse(made);
  assert.equal(scratches.filter(surface => surface.width > 0).length, 1);
  assert.equal(scratches.at(-1).width * scratches.at(-1).height, 4_194_304);
  assert.equal(tiles.filter(surface => surface.width > 0).length, 1);
  cache.clear(); assert.ok(made.surfaces.every(surface => surface.width === 0 && surface.height === 0));
});

test('C-R3：已有缓存后的crop失败清理新旧表面，同代禁用而新backing恢复', () => {
  const made = facility(); let failCrop = false;
  const cache = new ObjectRasterCache(() => {
    const surface = made.create();
    if (failCrop) surface.ctx.drawImage = () => { throw new Error('受控crop失败'); };
    return surface;
  });
  const target = context(), bounds = { x: 0, y: 0, width: 10, height: 10 }, first = picture(), second = picture('/second');
  assert.equal(cache.draw(target, first, bounds, originTransform()), true); failCrop = true;
  assert.equal(cache.draw(target, second, bounds, originTransform()), false);
  assert.equal(made.surfaces.length, 3, '沿用scratch，只尝试一个新tile');
  assert.ok(made.surfaces.every(surface => surface.width === 0 && surface.height === 0));
  failCrop = false;
  assert.equal(cache.draw(target, first, bounds, originTransform()), false); assert.equal(made.surfaces.length, 3);
  target.canvas.width++;
  assert.equal(cache.draw(target, first, bounds, originTransform()), true, '尺寸变化在disabled早退前处理');
  assert.equal(made.surfaces.length, 5);
  assert.deepEqual(made.surfaces.slice(3).map(surface => [surface.width, surface.height]), [[1025, 768], [14, 14]]);
});

test('C-R5：miss重放原四步变换且绘图前核对CTM，hit不操作或读取scratch', () => {
  const made = facility(), cache = new ObjectRasterCache(() => made.create()), target = context(), image = picture();
  const transform = { dpr: 1.25, fit: { x: 5, y: 10, scale: .6 }, position: { x: 8, y: 8 } };
  const bounds = { x: -3.5, y: -7.25, width: 20, height: 30 };
  applyTransform(target, transform);
  assert.equal(cache.draw(target, image, bounds, transform), true);
  assert.equal(cache.draw(target, image, bounds, transform), true);
  const { scratches: [scratch] } = byUse(made);
  assert.deepEqual(scratch.ctx.operations, [
    ['setTransform', 1, 0, 0, 1, 0, 0],
    ['setTransform', 1.25, 0, 0, 1.25, 0, 0], ['translate', 5, 10], ['scale', .6, .6], ['translate', 8, 8],
  ]);
  assert.equal(scratch.ctx.transformReads, 1, '只有miss在画图前读取重放CTM，hit不触及scratch');
  assert.deepEqual(scratch.ctx.draws[0].matrix, target.matrix);
  assert.equal(scratch.ctx.draws.length, 1); assert.equal(scratch.ctx.clears.length, 1);
});

test('C-R5：缺失或非法序列参数直接回退，backing失效先于参数早退', () => {
  const made = facility(), cache = new ObjectRasterCache(() => made.create()), target = context(), image = picture(), bounds = { x: 0, y: 0, width: 10, height: 10 };
  const invalid = [undefined, null, {}, { dpr: 1 }, { dpr: 1, fit: null, position: { x: 0, y: 0 } }];
  for (const [path, values] of [
    [['dpr'], [undefined, NaN, Infinity, 0, -1]], [['fit', 'x'], [undefined, NaN, Infinity]],
    [['fit', 'y'], [undefined, NaN, -Infinity]], [['fit', 'scale'], [undefined, NaN, Infinity, 0, -1]],
    [['position', 'x'], [undefined, NaN, Infinity]], [['position', 'y'], [undefined, NaN, -Infinity]],
  ]) for (const value of values) {
    const transform = originTransform();
    if (path.length === 1) transform[path[0]] = value; else transform[path[0]][path[1]] = value;
    invalid.push(transform);
  }
  for (const transform of invalid) assert.equal(cache.draw(target, image, bounds, transform), false);
  assert.equal(made.surfaces.length, 0); assert.equal(target.draws.length, 0);
  assert.equal(cache.draw(target, image, bounds, originTransform()), true);
  target.canvas.width++;
  assert.equal(cache.draw(target, image, bounds), false, '运行时缺第四参也回退');
  assert.ok(made.surfaces.every(surface => surface.width === 0 && surface.height === 0));
  assert.equal(made.surfaces.length, 2, '非法参数不分配新表面');
  assert.equal(cache.draw(target, image, bounds, originTransform()), true, '非法输入不永久禁用');
});

test('C-R5：公开CTM相同的不同原序列不能复用tile，同值新参数对象可命中', () => {
  const made = facility(), cache = new ObjectRasterCache(() => made.create()), target = context(), image = picture(), bounds = { x: 0, y: 0, width: 10, height: 10 };
  const sequences = [
    { dpr: 1, fit: { x: 0, y: 0, scale: 1 }, position: { x: 20, y: 30 } },
    { dpr: 2, fit: { x: 0, y: 0, scale: .5 }, position: { x: 20, y: 30 } },
    { dpr: 1, fit: { x: 10, y: 0, scale: 1 }, position: { x: 10, y: 30 } },
    { dpr: 1, fit: { x: 0, y: 10, scale: 1 }, position: { x: 20, y: 20 } },
  ];
  for (const transform of sequences) {
    applyTransform(target, transform);
    assert.deepEqual(target.matrix, { ...identity, e: 20, f: 30 });
    assert.equal(cache.draw(target, image, bounds, transform), true);
    assert.equal(cache.draw(target, image, bounds, structuredClone(transform)), true);
  }
  const { scratches: [scratch], tiles } = byUse(made);
  assert.equal(made.surfaces.length, 5); assert.equal(tiles.length, 4);
  assert.equal(scratch.ctx.draws.length, 4); assert.equal(scratch.ctx.clears.length, 4);
  assert.equal(scratch.ctx.transformReads, 4); assert.equal(scratch.ctx.operations.length, 20);
});

test('C-R5：重放CTM任一分量的微小不一致均不画原图或目标，清理并同代禁用', () => {
  const bounds = { x: 0, y: 0, width: 10, height: 10 }, image = picture();
  for (const component of ['a', 'b', 'c', 'd', 'e', 'f']) {
    const made = facility(); let mismatch = false;
    const cache = new ObjectRasterCache(() => {
      const surface = made.create(), original = surface.ctx.getTransform;
      surface.ctx.getTransform = function () { const matrix = original.call(this); if (mismatch) matrix[component] += 1e-12; return matrix; };
      return surface;
    });
    const target = context(), transform = originTransform();
    assert.equal(cache.draw(target, image, bounds, transform), true);
    const scratch = made.surfaces[0], beforeDraws = target.draws.length;
    mismatch = true;
    assert.equal(cache.draw(target, picture('/next'), bounds, transform), false, component);
    assert.equal(scratch.ctx.draws.length, 1, component + '：第二次miss在原图提交前终止');
    assert.equal(target.draws.length, beforeDraws); assert.deepEqual(target.matrix, identity);
    assert.equal(made.surfaces.length, 2, '不创建不一致序列的半成品tile');
    assert.ok(made.surfaces.every(surface => surface.width === 0 && surface.height === 0));
    mismatch = false;
    assert.equal(cache.draw(target, image, bounds, transform), false, '同代不再分配或画目标');
    cache.clear(); assert.equal(cache.draw(target, image, bounds, transform), true);
  }
});
