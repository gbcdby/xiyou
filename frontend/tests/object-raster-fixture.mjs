import { ObjectRasterCache } from '../src/rendering/object-raster-cache.ts';
import { SpatialCanvas, readCanvasFrame } from '../src/rendering/spatial-canvas.ts';
import { SpatialCanvas as BaselineCanvas, readCanvasFrame as readBaselineFrame } from '/src/rendering/__object-raster-baseline.ts';
import { CanvasAssets } from '../src/rendering/canvas-assets.ts';
import { ConfirmedMotion } from '../src/domain/spatial-motion.ts';
import { sceneFit, screenPoint } from '../src/domain/spatial-canvas-geometry.ts';
import { selectObjectArt, objectArtContext } from '../src/domain/gaolao-object-art.ts';
import { sceneLayerCatalog, sceneGroupAssets } from '../src/domain/gaolao-scene-layers.ts';
import { spatialSnapshot } from './spatial-fixture.mjs';
import matrix from './fixtures/object-raster/matrix.json';

const ensure = (value, message) => { if (!value) throw new Error(message); };
const same = (a, b, message) => ensure(JSON.stringify(a) === JSON.stringify(b), message);
const makeCanvas = (width, height) => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas; };
const context = canvas => { const value = canvas.getContext('2d'); ensure(value, '必须有真实2D上下文'); return value; };
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
const imagePath = image => new URL(image.currentSrc || image.src, location.href).pathname;
const objectPaths = new Set(matrix.variants.map(v => v.asset.file));
const bounds = asset => ({ x: (asset.offset?.x ?? 0) - asset.pivot.x * asset.scale, y: (asset.offset?.y ?? 0) - asset.pivot.y * asset.scale, width: asset.width * asset.scale, height: asset.height * asset.scale });
const matrixValues = value => ['a', 'b', 'c', 'd', 'e', 'f'].map(key => value[key]);
const waitFor = async (read, message) => {
  const start = performance.now();
  while (!read()) { ensure(performance.now() - start < 10000, message); await new Promise(resolve => setTimeout(resolve, 10)); }
};
async function loadImage(file) { const image = new Image(); image.src = file; await image.decode(); ensure(image.naturalWidth > 0, '图片解码必须有效'); return image; }

async function comparePixels(before, after) {
  same([before.width, before.height], [after.width, after.height], '两边backing尺寸相同');
  const left = context(before).getImageData(0, 0, before.width, before.height).data;
  const right = context(after).getImageData(0, 0, after.width, after.height).data;
  let differentBytes = 0, differentPixels = 0, maximumDifference = 0; const first = [];
  for (let i = 0; i < left.length; i += 4) {
    let mismatch = false;
    for (let channel = 0; channel < 4; channel++) if (left[i + channel] !== right[i + channel]) {
      mismatch = true; differentBytes++; maximumDifference = Math.max(maximumDifference, Math.abs(left[i + channel] - right[i + channel]));
    }
    if (mismatch) { differentPixels++; if (first.length < 12) first.push({ x: (i / 4) % before.width, y: Math.floor(i / 4 / before.width), baseline: [...left.slice(i, i + 4)], candidate: [...right.slice(i, i + 4)] }); }
  }
  return { width: before.width, height: before.height, comparedBytes: left.length, differentBytes, differentPixels, maximumDifference, first,
    baselineSha256: await digest(left), candidateSha256: await digest(right), status: differentBytes === 0 ? 'PASS' : 'FAIL' };
}

function surface(canvas, geometry, variant, images) {
  const ctx = context(canvas), fit = sceneFit(matrix.scene, geometry);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(geometry.dpr, 0, 0, geometry.dpr, 0, 0);
  if (geometry.background === 'original') { ctx.fillStyle = '#eee3cb'; ctx.fillRect(0, 0, geometry.width, geometry.height); }
  if (geometry.background === 'checker') {
    const size = matrix.checker.cssCell;
    for (let y = 0; y < geometry.height; y += size) for (let x = 0; x < geometry.width; x += size) {
      ctx.fillStyle = matrix.checker.colors[(x / size + y / size) % 2]; ctx.fillRect(x, y, size, size);
    }
  }
  ctx.save(); ctx.translate(fit.x, fit.y); ctx.scale(fit.scale, fit.scale);
  ctx.beginPath(); ctx.rect(0, 0, matrix.scene.width, matrix.scene.height); ctx.clip();
  if (geometry.background === 'original') {
    const group = sceneLayerCatalog[variant.sceneId];
    for (const asset of [group.base, ...group.floors]) { const b = asset.worldRect; ctx.drawImage(images.get(asset.file), b.x, b.y, b.width, b.height); }
  }
  return { ctx, fit };
}

const scratchPixelLimit = 4_194_304;
const resourceSets = () => ({ allocated: new Set(), scratch: new Set(), retained: new Set() });
const active = values => [...values].filter(canvas => canvas.width && canvas.height);
const activeResources = resources => ({ scratch: active(resources.scratch), retained: active(resources.retained) });
const releasedResources = (resources, message) => {
  ensure(resources.scratch.length === 1 && resources.retained.length > 0, message + '前必须确有两类资源');
  ensure([...resources.scratch, ...resources.retained].every(canvas => !canvas.width && !canvas.height), message);
  return { scratch: resources.scratch.length, retained: resources.retained.length };
};

// 以真实源/目的关系归类，不按create顺序或把所有派生canvas都当作tile。
function observeRaster(trace, resources, target) {
  for (const canvas of trace.allocations) resources.allocated.add(canvas);
  for (const call of trace.calls) {
    if (call.object && resources.allocated.has(call.destination)) resources.scratch.add(call.destination);
    if (resources.scratch.has(call.source) && resources.allocated.has(call.destination)) resources.retained.add(call.destination);
  }
  ensure([...resources.scratch].every(canvas => !resources.retained.has(canvas)), 'scratch与retained tile用途必须分离');
  const live = activeResources(resources), scratchPixels = live.scratch.reduce((sum, canvas) => sum + canvas.width * canvas.height, 0);
  const retainedPixels = live.retained.reduce((sum, canvas) => sum + canvas.width * canvas.height, 0);
  ensure(live.scratch.length <= 1 && scratchPixels <= scratchPixelLimit, 'scratch独立守1张/4194304像素上限');
  for (const canvas of live.scratch) same([canvas.width, canvas.height], [target.width, target.height], 'scratch必须与当前目标完整backing相同');
  ensure(live.retained.length <= matrix.limits.entries && retainedPixels <= matrix.limits.pixels, 'retained tile仍守32项/1048576像素上限');
  ensure(live.retained.every(canvas => canvas.width * canvas.height <= matrix.limits.singlePixels), 'retained tile仍守262144单项上限');
  return {
    originalImageDraws: trace.calls.filter(call => call.object).length,
    imageToScratch: trace.calls.filter(call => call.object && resources.scratch.has(call.destination)).length,
    scratchToTile: trace.calls.filter(call => resources.scratch.has(call.source) && resources.retained.has(call.destination)).length,
    tileToTarget: trace.calls.filter(call => resources.retained.has(call.source) && call.destination === target).length,
    canvasAllocations: trace.allocations.length,
    scratchAllocations: trace.allocations.filter(canvas => resources.scratch.has(canvas)).length,
    retainedAllocations: trace.allocations.filter(canvas => resources.retained.has(canvas)).length,
    scratchDraws: trace.calls.filter(call => resources.scratch.has(call.destination)).length,
    scratchClears: trace.clears.filter(call => resources.scratch.has(call.destination)).length,
    scratchTransforms: trace.transforms.filter(call => resources.scratch.has(call.destination)).length,
    scratchTransformOperations: trace.transforms.filter(call => resources.scratch.has(call.destination)).map(call => ({ method: call.method, args: call.args })),
    live: { scratch: { count: live.scratch.length, pixels: scratchPixels }, retained: { count: live.retained.length, pixels: retainedPixels } },
  };
}

function requireHit(observation) {
  for (const key of ['originalImageDraws', 'imageToScratch', 'scratchToTile', 'canvasAllocations', 'scratchAllocations', 'retainedAllocations', 'scratchDraws', 'scratchClears', 'scratchTransforms']) {
    ensure(observation[key] === 0, 'hit不得重触scratch或分配新canvas：' + key);
  }
}

function requireMiss(observation, freshScratch) {
  for (const key of ['originalImageDraws', 'imageToScratch', 'scratchToTile', 'tileToTarget', 'scratchDraws', 'scratchClears', 'retainedAllocations']) {
    ensure(observation[key] === 1, 'miss必须恰好提交一次原图并经scratch生成一个tile：' + key);
  }
  ensure(observation.live.scratch.count === 1 && observation.scratchAllocations === Number(freshScratch), '同backing连续miss复用唯一scratch');
  ensure(observation.canvasAllocations === 1 + Number(freshScratch), 'miss只分配必要的scratch和新tile');
}

function trackedCache(create = () => document.createElement('canvas')) {
  const resources = resourceSets(), cache = new ObjectRasterCache(create);
  return { cache, resources, draw(ctx, image, box, rasterTransform) {
    const trace = traceDraw(() => cache.draw(ctx, image, box, rasterTransform));
    return { usedCache: trace.value, trace, observation: observeRaster(trace, resources, ctx.canvas) };
  } };
}

function drawPair(geometry, variant, images, tracked, position = variant.position) {
  const width = Math.round(geometry.width * geometry.dpr), height = Math.round(geometry.height * geometry.dpr);
  const baseline = makeCanvas(width, height), candidate = makeCanvas(width, height), image = images.get(variant.asset.file), b = bounds(variant.asset);
  const before = surface(baseline, geometry, variant, images), after = surface(candidate, geometry, variant, images);
  before.ctx.translate(position.x, position.y); after.ctx.translate(position.x, position.y);
  const originalTransform = matrixValues(after.ctx.getTransform());
  before.ctx.drawImage(image, b.x, b.y, b.width, b.height);
  const rasterTransform = { dpr: geometry.dpr, fit: after.fit, position };
  const { usedCache, observation } = tracked.draw(after.ctx, image, b, rasterTransform);
  if (!usedCache) after.ctx.drawImage(image, b.x, b.y, b.width, b.height);
  same(matrixValues(after.ctx.getTransform()), originalTransform, 'helper必须还原原CTM');
  before.ctx.restore(); after.ctx.restore();
  return { baseline, candidate, usedCache, observation, transform: originalTransform, bounds: b, fit: before.fit };
}

function fixtureSnapshot(scenario) {
  const value = spatialSnapshot(), p = value.projection;
  Object.assign(p, { contentVersion: 'gaolaozhuang-scene-v2', chapterVersion: 'gaolao-v1', mapVersion: 'gaolao-layout-v1.1', reducerVersion: 'gaolao-world-v2', variantId: 'two' });
  Object.assign(p.scene, { sceneId: 'gaolao-courtyard', name: '像素夹具院落', width: 1600, height: 1000,
    walkableAreas: [{ areaId: 'ground', polygon: [{ x: 0, y: 0 }, { x: 1600, y: 0 }, { x: 1600, y: 1000 }, { x: 0, y: 1000 }] }] });
  Object.assign(p.self, { sceneId: p.scene.sceneId, position: { ...scenario.self } });
  p.entities = [{ entityRef: p.self.entityRef, name: p.self.name, appearanceEpoch: p.self.appearanceEpoch, sceneId: p.self.sceneId, position: { ...scenario.self }, facing: 'S' }];
  p.items = [{ entityRef: 'parcel_00000000000000000000000000000', name: '受控包裹', visualKey: 'cloth-parcel', location: { kind: 'ground', sceneId: p.scene.sceneId, position: { ...scenario.parcel } }, resourceRevision: '0', transferable: false, publicBorrowable: false, fields: [] }];
  p.targets = [{ entityRef: 'door_0000000000000000000000000000000', name: '受控门', visualKey: 'timber-door', sceneId: p.scene.sceneId, position: { x: 1250, y: 425 }, resourceRevision: '0', availableOperations: [], fields: [{ key: 'open', label: '后宅开放', value: scenario.open }] }];
  return value;
}

// 仅包围同步绘制调用，转发原生方法；不改helper、像素、读数或资源状态。
function traceDraw(fn, front) {
  const prototype = CanvasRenderingContext2D.prototype, methods = ['drawImage', 'clearRect', 'setTransform', 'translate', 'scale'];
  const originals = Object.fromEntries(methods.map(name => [name, prototype[name]]));
  const calls = [], clears = [], transforms = [], allocations = [], create = Document.prototype.createElement;
  for (const [name, records] of [['drawImage', calls], ['clearRect', clears], ['setTransform', transforms], ['translate', transforms], ['scale', transforms]]) {
    prototype[name] = function (...args) {
      const source = name === 'drawImage' ? args[0] : null;
      records.push({ method: name, destination: this.canvas, front: this.canvas === front, object: source instanceof HTMLImageElement && objectPaths.has(imagePath(source)), source, args: name === 'drawImage' ? args.slice(1) : args });
      return originals[name].apply(this, args);
    };
  }
  Document.prototype.createElement = function (...args) {
    const element = create.apply(this, args); if (element instanceof HTMLCanvasElement) allocations.push(element); return element;
  };
  try { return { value: fn(calls), calls, clears, transforms, allocations }; }
  finally { for (const name of methods) prototype[name] = originals[name]; Document.prototype.createElement = create; }
}

async function rendererChecks(record, saveFailure) {
  const assets = new CanvasAssets(), baselineFront = makeCanvas(1, 1), candidateFront = makeCanvas(1, 1);
  const before = new BaselineCanvas(baselineFront, assets), after = new SpatialCanvas(candidateFront, assets);
  const motion = new ConfirmedMotion(), resources = resourceSets(); let paintCount = 0;
  const geometry = matrix.geometries[0]; let snapshot = fixtureSnapshot(matrix.rendererCases[0]);
  const paths = [...sceneGroupAssets(sceneLayerCatalog['gaolao-courtyard']).map(a => a.file), ...matrix.variants.filter(v => v.sceneId === 'gaolao-courtyard').map(v => v.asset.file)];
  assets.ensure(paths); await waitFor(() => assets.ready(paths), '完整渲染器真实资源必须ready');
  const paint = async (id, selected, extra = {}) => {
    const previousScratch = active(resources.scratch)[0];
    before.prepare(snapshot); after.prepare(snapshot); motion.update(snapshot, 0);
    const frontState = [readBaselineFrame(baselineFront), readCanvasFrame(candidateFront)];
    let boundaries = 0;
    const render = (renderer, front, read, expected) => traceDraw(calls => renderer.paint(snapshot, motion, 0, { reducedMotion: true, selected,
      beforeFrontWrite() { boundaries++; ensure(calls.filter(c => c.front).length === 0, '回调必须先于本次唯一前台写'); same(read(front), expected, 'buffer准备不能提前替换帧'); } }), front);
    const a = render(before, baselineFront, readBaselineFrame, frontState[0]), b = render(after, candidateFront, readCanvasFrame, frontState[1]); paintCount++;
    ensure(boundaries === 2 && a.calls.filter(c => c.front).length === 1 && b.calls.filter(c => c.front).length === 1, '每边每帧恰好一次边界和完整前台写');
    const buffer = b.calls.find(call => call.front).source, observation = observeRaster(b, resources, buffer);
    if (previousScratch) ensure(active(resources.scratch)[0] === previousScratch && observation.scratchAllocations === 0, '完整renderer同backing连续miss复用scratch');
    ensure(observation.originalImageDraws === observation.imageToScratch && observation.imageToScratch === observation.scratchToTile, 'renderer每次原图提交都必须形成scratch到tile的真实链路');
    ensure(observation.tileToTarget === b.value.objects.filter(object => object.file && objectPaths.has(object.file)).length, '每帧每个ready物件必须合成到原buffer');
    same(a.value, b.value, '完整frame元数据必须相同');
    const samples = [];
    for (const object of a.value.objects) for (const [fx, fy] of [[0, 0], [.25, .25], [.5, .5], [.75, .75], [1, 1]]) {
      const point = screenPoint({ x: object.position.x + object.bounds.x + fx * object.bounds.width, y: object.position.y + object.bounds.y + fy * object.bounds.height }, a.value.fit);
      samples.push({ point, baseline: before.hit(point), candidate: after.hit(point) });
    }
    for (const sample of samples) same(sample.baseline, sample.candidate, '命中保持原图alpha与原bounds规则');
    const pixel = await comparePixels(baselineFront, candidateFront);
    record({ id, category: 'C-R2/C-R3', ...pixel, frame: a.value, hits: samples, frontWrites: [1, 1], boundaries,
      candidateOriginalObjectDraws: observation.originalImageDraws, observation, ...extra });
    if (pixel.status === 'FAIL') saveFailure(id, baselineFront, candidateFront);
    return { a, b, frame: a.value, observation };
  };
  try {
    before.resize(geometry.width, geometry.height, geometry.dpr); after.resize(geometry.width, geometry.height, geometry.dpr);
    for (const scenario of matrix.rendererCases) {
      snapshot = fixtureSnapshot(scenario);
      const selected = scenario.selected === 'self' ? snapshot.projection.self.entityRef : snapshot.projection.items[0].entityRef;
      const result = await paint(scenario.id, selected);
      const leftPost = result.frame.sceneImages.find(v => v.file.endsWith('/left-post.png'));
      ensure(leftPost?.opacity === scenario.foregroundOpacity, '必须真正覆盖原前景透明度');
      ensure(result.frame.objects.find(v => v.kind === 'door')?.variant === (scenario.open ? 'open' : 'closed'), '必须真正覆盖门状态');
      const hit = await paint(scenario.id + '-repeat', selected);
      requireHit(hit.observation);
    }
    const oldResources = activeResources(resources); snapshot = structuredClone(snapshot); snapshot.sessionId += '-scope';
    after.prepare(snapshot);
    await paint('scope-change', snapshot.projection.self.entityRef, { released: releasedResources(oldResources, 'scope变更释放旧scratch和全部tile') });
    const g2 = matrix.geometries[1], beforeBackingChange = activeResources(resources);
    before.resize(g2.width, g2.height, g2.dpr); after.resize(g2.width, g2.height, g2.dpr);
    await paint('resize-G2', snapshot.projection.self.entityRef, { released: releasedResources(beforeBackingChange, 'backing改变释放旧scratch和全部tile') });
    const beforeResize = activeResources(resources), previousBacking = [candidateFront.width, candidateFront.height];
    before.resize(980.6, g2.height, g2.dpr); after.resize(980.6, g2.height, g2.dpr);
    same([candidateFront.width, candidateFront.height], previousBacking, '本例必须保持同一backing尺寸');
    await paint('same-backing-css-resize', snapshot.projection.self.entityRef, { css: [980.5, 980.6], released: releasedResources(beforeResize, '实际CSS小数改变释放scratch和全部tile') });
    const beforeDpr = activeResources(resources); before.resize(980.6, g2.height, 1.25001); after.resize(980.6, g2.height, 1.25001);
    await paint('dpr-change', snapshot.projection.self.entityRef, { dpr: [1.25, 1.25001], released: releasedResources(beforeDpr, '实际DPR改变释放scratch和全部tile') });
    const parcelFrame = selectObjectArt(snapshot.projection.items[0], objectArtContext(snapshot), 'map');
    const originalImage = assets.image(parcelFrame.file); ensure(originalImage, '资源失败前已有ready图片');
    originalImage.onerror(new Event('error'));
    ensure(assets.image(parcelFrame.file) === null && assets.failed([parcelFrame.file]).length === 1, '受控error走原CanvasAssets失败回调');
    const missing = await paint('ready-to-controlled-error', snapshot.projection.self.entityRef, { fault: '原HTMLImageElement的onerror受控触发，不冒称网络失败' });
    ensure(!missing.frame.objects.find(v => v.visualKey === 'cloth-parcel')?.file, 'failed时不得画旧tile');
    after.retry(); await waitFor(() => assets.ready([parcelFrame.file]), '原retry路径等待新图ready');
    ensure(assets.image(parcelFrame.file) !== originalImage, '重试必须新image身份');
    await paint('retry-new-image', snapshot.projection.self.entityRef);
    const cleared = activeResources(resources); before.clear(); after.clear();
    const clearReleased = releasedResources(cleared, 'clear释放scratch和全部tile');
    same(readBaselineFrame(baselineFront), null, '基线clear撤销frame'); same(readCanvasFrame(candidateFront), null, 'candidate clear撤销frame');
    same(before.hit({ x: 20, y: 20 }), after.hit({ x: 20, y: 20 }), 'clear后命中一致');
    record({ id: 'renderer-clear', category: 'C-R3', ...await comparePixels(baselineFront, candidateFront), released: clearReleased });
    await paint('after-clear', snapshot.projection.self.entityRef);
    const disposeResources = activeResources(resources), previousFrame = readCanvasFrame(candidateFront);
    const disposal = traceDraw(() => after.dispose(), candidateFront);
    ensure(disposal.calls.length === 0, 'dispose不能新增前台写');
    const disposeReleased = releasedResources(disposeResources, 'dispose显式释放scratch和全部tile');
    same(readCanvasFrame(candidateFront), previousFrame, 'dispose不冒充clear或新增帧');
    record({ id: 'renderer-dispose', category: 'C-R3', status: 'PASS', released: disposeReleased, frontWrites: 0, paintCount });
  } finally { after.dispose(); before.clear(); after.clear(); }
}

async function helperChecks(images, record, saveFailure) {
  const variant = matrix.variants.find(v => v.visualKey === 'cloth-parcel'), image = images.get(variant.asset.file), geometry = matrix.geometries[0];
  const caches = [], track = create => { const value = trackedCache(create); caches.push(value); return value; };
  // 原受控例仍用单位比例和相同位置；显式执行四步后传原值，不由最终CTM反推。
  const place = (ctx, x, y) => {
    const value = { dpr: 1, fit: { x: 0, y: 0, scale: 1 }, position: { x, y } };
    ctx.setTransform(value.dpr, 0, 0, value.dpr, 0, 0); ctx.translate(value.fit.x, value.fit.y);
    ctx.scale(value.fit.scale, value.fit.scale); ctx.translate(value.position.x, value.position.y);
    return value;
  };
  try {
    const sameURL = await loadImage(variant.asset.file), tracked = track();
    ensure(image !== sameURL && image.src === sameURL.src, '同URL新实例夹具必须精确成立');
    const first = drawPair(geometry, variant, images, tracked); ensure(first.usedCache, '首个image应进入缓存'); requireMiss(first.observation, true);
    const oldScratch = active(tracked.resources.scratch)[0], replaced = new Map(images); replaced.set(variant.asset.file, sameURL);
    const pair = drawPair(geometry, variant, replaced, tracked); ensure(pair.usedCache, '新image应进入缓存'); requireMiss(pair.observation, false);
    ensure(pair.observation.live.retained.count === 2 && active(tracked.resources.scratch)[0] === oldScratch, '同URL新实例生成新tile并复用scratch');
    const replacedPixel = await comparePixels(pair.baseline, pair.candidate), beforeClear = activeResources(tracked.resources);
    tracked.cache.clear();
    record({ id: 'same-url-new-image', category: 'C-R3', ...replacedPixel, observation: pair.observation, released: releasedResources(beforeClear, 'helper.clear释放scratch和全部tile') });
    if (replacedPixel.status === 'FAIL') saveFailure('same-url-new-image', pair.baseline, pair.candidate);
    const counts = track(), target = context(makeCanvas(1000, 1000)), small = { x: 0, y: 0, width: 20, height: 20 };
    let countObservation, areaObservation;
    for (let index = 0; index < 33; index++) {
      const rasterTransform = place(target, index, 0), result = counts.draw(target, image, small, rasterTransform);
      ensure(result.usedCache, '小tile缓存应可用'); requireMiss(result.observation, index === 0); countObservation = result.observation;
    }
    ensure(countObservation.live.retained.count === 32 && ![...counts.resources.retained][0].width, '第33个retained tile必须淘汰最旧项');
    const counted = activeResources(counts.resources); counts.cache.clear();
    const countReleased = releasedResources(counted, '条目容量例clear释放scratch和全部保留tile'), areas = track();
    for (let index = 0; index < 5; index++) {
      const rasterTransform = place(target, index, 0), result = areas.draw(target, image, { x: 0, y: 0, width: 500, height: 500 }, rasterTransform);
      ensure(result.usedCache, '单tile合法'); requireMiss(result.observation, index === 0); areaObservation = result.observation;
    }
    ensure(areaObservation.live.retained.count < 5, 'retained总像素上限必须真实淘汰');
    const areaResources = activeResources(areas.resources); areas.cache.clear();
    record({ id: 'bounded-capacity', category: 'C-R3', status: 'PASS', entriesAfter33: countObservation, afterFiveLargeTiles: areaObservation,
      countReleased, areaReleased: releasedResources(areaResources, '总像素容量例clear释放scratch和全部保留tile') });
    const failing = track(() => { throw new Error('受控设施不可用'); }), single = track(), oversized = track();
    const primeTransform = place(target, 0, 0), primed = oversized.draw(target, image, small, primeTransform);
    ensure(primed.usedCache, 'backing超限前必须确有合法缓存'); requireMiss(primed.observation, true);
    const beforeOverflow = activeResources(oversized.resources);
    for (const [id, trackedFallback, box, size] of [
      ['facility-fallback', failing, bounds(variant.asset), [800, 800]],
      ['single-tile-overflow', single, { x: 0, y: 0, width: 600, height: 600 }, [800, 800]],
      ['backing-overflow', oversized, small, [2049, 2048]],
    ]) {
      const a = makeCanvas(...size), b = makeCanvas(...size), ac = context(a), bc = context(b);
      place(ac, 15.25, 17.5); const rasterTransform = place(bc, 15.25, 17.5);
      const before = matrixValues(bc.getTransform()); ac.drawImage(image, box.x, box.y, box.width, box.height);
      const result = trackedFallback.draw(bc, image, box, rasterTransform); ensure(result.usedCache === false, '设施/容量失败必须明确回退');
      same(matrixValues(bc.getTransform()), before, '回退必须还原CTM'); bc.drawImage(image, box.x, box.y, box.width, box.height);
      ensure(result.observation.canvasAllocations === 0 && result.observation.originalImageDraws === 0, '受控早退不分配canvas或提交原图到缓存');
      const released = id === 'backing-overflow' ? releasedResources(beforeOverflow, 'backing改变即使超限也释放旧scratch和全部tile') : undefined;
      const pixel = await comparePixels(a, b); record({ id, category: 'C-R3', ...pixel, usedCache: result.usedCache, backing: size, observation: result.observation, ...(released ? { released } : {}) });
      if (pixel.status === 'FAIL') saveFailure(id, a, b); trackedFallback.cache.clear();
    }
  } finally { for (const tracked of caches) tracked.cache.clear(); }
}

window.runObjectRasterChecks = async () => {
  const rows = [], failures = [], errors = [], images = new Map();
  const record = row => rows.push(row);
  const saveFailure = (id, baseline, candidate) => { if (failures.length < 3) failures.push({ id, baseline: baseline.toDataURL('image/png'), candidate: candidate.toDataURL('image/png') }); };
  const group = async (id, callback) => { try { await callback(); } catch (error) { rows.push({ id, status: 'FAIL', error: error.stack }); errors.push({ id, error: error.stack }); } };
  const imageFiles = new Set(matrix.variants.map(v => v.asset.file));
  for (const scene of Object.values(sceneLayerCatalog)) for (const asset of [scene.base, ...scene.floors]) imageFiles.add(asset.file);
  for (const file of imageFiles) images.set(file, await loadImage(file));
  for (const variant of matrix.variants) same([images.get(variant.asset.file).naturalWidth, images.get(variant.asset.file).naturalHeight], [variant.asset.width, variant.asset.height], '真实PNG解码尺寸必须匹配冻结目录');
  for (const geometry of matrix.geometries) for (const variant of matrix.variants) {
    const tracked = trackedCache();
    await group(geometry.id + '/' + variant.id, async () => {
      for (const phase of matrix.phases) {
        const pair = drawPair(geometry, variant, images, tracked);
        ensure(pair.usedCache, '合法矩阵不能因始终回退而假通过');
        if (phase === 'miss') requireMiss(pair.observation, true); else requireHit(pair.observation);
        ensure(pair.observation.tileToTarget === 1, '每一miss/hit都必须重新合成tile到已清底的目标');
        const pixel = await comparePixels(pair.baseline, pair.candidate), id = `${geometry.id}/${variant.id}/${phase}`;
        record({ id, category: 'C-R1', geometry: geometry.id, variant: variant.id, phase, ...pixel, transform: pair.transform, bounds: pair.bounds, fit: pair.fit, usedCache: pair.usedCache, sourceDraws: pair.observation.originalImageDraws, observation: pair.observation });
        if (pixel.status === 'FAIL') saveFailure(id, pair.baseline, pair.candidate);
      }
    }); tracked.cache.clear();
  }
  for (const clip of matrix.clips) await group(clip.id, async () => {
    const tracked = trackedCache();
    try {
      const geometry = matrix.geometries.find(g => g.id === clip.geometry), variant = matrix.variants.find(v => v.id === clip.variant);
      const pair = drawPair(geometry, variant, images, tracked, clip.position), pixel = await comparePixels(pair.baseline, pair.candidate);
      ensure(pair.usedCache, '边缘clip应走cache'); requireMiss(pair.observation, true);
      record({ id: clip.id, category: 'C-R1-clip', ...pixel, position: clip.position, transform: pair.transform, usedCache: pair.usedCache, observation: pair.observation });
      if (pixel.status === 'FAIL') saveFailure(clip.id, pair.baseline, pair.candidate);
    } finally { tracked.cache.clear(); }
  });
  await group('renderer-lifecycle', () => rendererChecks(record, saveFailure));
  await group('helper-identity-capacity-fallback', () => helperChecks(images, record, saveFailure));
  const pixelPairs = rows.filter(row => row.category === 'C-R1').length;
  const pass = rows.every(row => row.status === 'PASS') && pixelPairs === 42 && rows.filter(row => row.category === 'C-R1-clip').length === 2;
  return { assessment: pass ? 'PASS' : 'FAIL', rows, pixelPairs, failures, errors, userAgent: navigator.userAgent,
    scope: '严格像素/公开绘制接口/有限生命周期，不等于连续移动或性能验收；renderer使用受控合法形状DTO，不连接PG或动作端' };
};
