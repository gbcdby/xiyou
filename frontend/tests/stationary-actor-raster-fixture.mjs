// S-A1 资格检查：全部 30 对原站姿先完成；任一不合格就不准入后续 renderer。
import { SpatialCanvas as BaselineCanvas, readCanvasFrame as readA } from '/src/rendering/__stationary-actor-raster-baseline.ts';
import { SpatialCanvas as CandidateCanvas, readCanvasFrame as readB } from '/src/rendering/spatial-canvas.ts';
import { ObjectRasterCache } from '/src/rendering/object-raster-cache.ts';
import { CanvasAssets } from '/src/rendering/canvas-assets.ts';
import { CanvasPresentationOwner } from '/src/rendering/spatial-presentation.ts';
import { ConfirmedMotion } from '/src/domain/spatial-motion.ts';
import { sceneLayerCatalog, sceneGroupAssets } from '/src/domain/gaolao-scene-layers.ts';
import { sceneFit, screenPoint } from '/src/domain/spatial-canvas-geometry.ts';
import { spriteForAppearance, spriteResourcePaths } from '/src/domain/gaolao-art.ts';
import { spatialSnapshot } from './spatial-fixture.mjs';
import input from './fixtures/stationary-actor-raster/matrix.json';

const ensure = (value, message) => { if (!value) throw new Error(message); };
const same = (a, b, message) => ensure(JSON.stringify(a) === JSON.stringify(b), message);
const sha = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
const jsonSha = value => sha(new TextEncoder().encode(JSON.stringify(value)));
const matrixOf = m => ['a', 'b', 'c', 'd', 'e', 'f'].map(k => m[k]);
const isCanvas = value => value instanceof HTMLCanvasElement;
const ctx = canvas => { const value = canvas.getContext('2d'); ensure(value, '必须取得真实默认 2D context'); return value; };
const live = set => [...set].filter(c => c.width > 0 && c.height > 0);
const failures = [], surfaces = new Set(), caches = new Set(), arms = new Set(), buckets = new Map();
const ids = new WeakMap(); let nextId = 0;
const idOf = object => { if (!ids.has(object)) ids.set(object, ++nextId); return ids.get(object); };
const report = { schemaVersion: 1, scope: input.scope, assessment: 'NOT_RUN', pixelRows: [], pixelPairs: 0,
  rendererRows: [], rendererPaintCalls: 0, postRows: [], errors: [], cleanup: [], notReached: [], limits: input.limits };
let started = false, cancelled = false, deadline = Infinity, ordinal = 0;
function check() { ensure(!cancelled, '检查已取消，不再准入新行'); ensure(performance.now() < deadline, '超过固定 90 秒主体预算'); }
function remember(canvas) {
  if (!surfaces.has(canvas) && surfaces.size >= input.limits.observedCanvasMaximum) { release(canvas); throw new Error('已观测 canvas 超过固定上限'); }
  surfaces.add(canvas); return canvas;
}
function canvas(width = 1, height = 1) { const value = remember(document.createElement('canvas')); value.width = width; value.height = height; return value; }
function release(canvas) { canvas.width = 0; canvas.height = 0; canvas.remove(); }
function bucket(cache) { if (!buckets.has(cache)) buckets.set(cache, { scratch: new Set(), tiles: new Set() }); return buckets.get(cache); }
function resources(cache) {
  const value = bucket(cache), scratch = live(value.scratch), tiles = live(value.tiles);
  return { cache: idOf(cache), scratch: scratch.length, scratchPixels: scratch.reduce((n, c) => n + c.width * c.height, 0),
    tiles: tiles.length, tilePixels: tiles.reduce((n, c) => n + c.width * c.height, 0), maxTilePixels: Math.max(0, ...tiles.map(c => c.width * c.height)) };
}
function resourceLimits(value) {
  ensure(value.scratch <= input.limits.scratchCount && value.scratchPixels <= input.limits.scratchPixels, '同实例 scratch 必须满足原预算');
  ensure(value.tiles <= input.limits.entries && value.tilePixels <= input.limits.pixels && value.maxTilePixels <= input.limits.singlePixels, '同实例 actor/object 共用原 tile 预算');
}
function captureResources(invocation, calls) {
  const value = bucket(invocation.cache), part = calls.slice(invocation.start, invocation.end);
  for (const call of part) if (call.name === 'drawImage' && call.source === invocation.image && call.target !== invocation.target) value.scratch.add(call.target);
  for (const call of part) if (call.name === 'drawImage' && value.scratch.has(call.source) && call.target !== invocation.target) value.tiles.add(call.target);
  invocation.resources = resources(invocation.cache); resourceLimits(invocation.resources);
}

// 只在同步 draw/paint 周围观测真实原生调用；finally 恢复。受控故障只用于既定 facility 行。
function trace(action, inject = null) {
  const proto = CanvasRenderingContext2D.prototype;
  const names = ['drawImage', 'clearRect', 'fillRect', 'setTransform', 'translate', 'scale', 'clip', 'ellipse', 'arc', 'fillText'];
  const originals = Object.fromEntries(names.map(name => [name, proto[name]]));
  const create = Document.prototype.createElement, originalDraw = ObjectRasterCache.prototype.draw;
  const calls = [], allocations = [], cacheCalls = [], stack = [];
  const result = { calls, allocations, cacheCalls, injected: false, overflow: false, error: null, value: undefined };
  for (const name of names) proto[name] = function (...args) {
    if (calls.length >= input.limits.nativeCallsPerTrace) { result.overflow = true; throw new Error('单同步 trace 超过固定原生调用上限'); }
    const call = { name, target: this.canvas, source: name === 'drawImage' ? args[0] : null,
      args: name === 'drawImage' ? args.slice(1) : args, matrix: matrixOf(this.getTransform()), alpha: this.globalAlpha, completed: false };
    calls.push(call);
    if (inject && !result.injected && name === 'drawImage' && args[0] === inject.image && this.canvas !== inject.buffer
      && stack.at(-1)?.image === inject.image && stack.at(-1)?.target === inject.buffer) {
      result.injected = true; call.injected = true; throw new Error('S-A1 夹具唯一原 scratch drawImage 受控失败');
    }
    const value = Reflect.apply(originals[name], this, args); call.completed = true; return value;
  };
  Document.prototype.createElement = function (...args) {
    const value = Reflect.apply(create, this, args); if (isCanvas(value)) { allocations.push(value); remember(value); } return value;
  };
  ObjectRasterCache.prototype.draw = function (context, image, bounds, transform) {
    const invocation = { cache: this, target: context.canvas, image, bounds: { ...bounds }, transform: structuredClone(transform),
      before: matrixOf(context.getTransform()), start: calls.length, allocationStart: allocations.length, used: null };
    cacheCalls.push(invocation); stack.push(invocation);
    try { invocation.used = Reflect.apply(originalDraw, this, [context, image, bounds, transform]); return invocation.used; }
    finally {
      stack.pop(); invocation.end = calls.length; invocation.allocations = allocations.slice(invocation.allocationStart);
      invocation.after = matrixOf(context.getTransform()); captureResources(invocation, calls);
    }
  };
  try { result.value = action(calls); } catch (error) { result.error = error; }
  finally { for (const name of names) proto[name] = originals[name]; Document.prototype.createElement = create; ObjectRasterCache.prototype.draw = originalDraw; }
  ensure(!result.overflow, 'trace 超限使该行不合格，不能把回退解释为命中'); return result;
}

function cacheObservation(t, invocation, expected) {
  ensure(invocation, '必须观察到真实 ObjectRasterCache.draw');
  const part = t.calls.slice(invocation.start, invocation.end), value = bucket(invocation.cache);
  const samples = part.filter(c => c.name === 'drawImage' && c.source === invocation.image && c.target !== invocation.target);
  const crops = part.filter(c => c.name === 'drawImage' && value.scratch.has(c.source) && c.target !== invocation.target);
  const copies = part.filter(c => c.name === 'drawImage' && value.tiles.has(c.source) && c.target === invocation.target);
  const clears = part.filter(c => c.name === 'clearRect' && value.scratch.has(c.target));
  same(invocation.after, invocation.before, '缓存必须恢复调用方 CTM');
  if (expected === 'miss') {
    ensure(invocation.used === true && samples.length === 1 && samples[0].completed && crops.length === 1 && copies.length === 1 && clears.length === 1, 'miss 必须是真实原图→scratch→tile→target，不接受回退');
    same(samples[0].matrix, invocation.before, 'scratch 重放原 CTM');
    same(samples[0].args, [invocation.bounds.x, invocation.bounds.y, invocation.bounds.width, invocation.bounds.height], 'scratch 使用原 bounds');
    same(crops[0].matrix, [1, 0, 0, 1, 0, 0], 'tile 以 identity 裁取设备像素');
    ensure(crops[0].args.length === 8 && crops[0].args.every(Number.isInteger) && crops[0].args[2] === crops[0].args[6] && crops[0].args[3] === crops[0].args[7], 'tile 只能整数 1:1 裁取');
    ensure(invocation.allocations.length >= 1 && invocation.allocations.length <= 2, 'miss 仅创建 tile 与按需唯一 scratch');
  } else if (expected === 'hit') {
    ensure(invocation.used === true && samples.length === 0 && crops.length === 0 && clears.length === 0 && copies.length === 1 && invocation.allocations.length === 0, 'hit 必须实际复用旧 tile，无原图重采样/分配');
    ensure(!part.some(c => value.scratch.has(c.target)), 'hit 不操作 scratch');
  } else {
    ensure(expected === 'fallback' && invocation.used === false && copies.length === 0, '失败代必须真实回退，不能发布失效 tile');
  }
  for (const copy of copies) { same(copy.matrix, [1, 0, 0, 1, 0, 0], '最终设备 tile identity 写入'); ensure(copy.args.length === 2 && copy.args.every(Number.isInteger), '最终 tile 1:1 整数定位'); }
  return { tile: copies[0]?.source ?? null, summary: { expected, cache: idOf(invocation.cache), image: idOf(invocation.image),
    used: invocation.used, sourceSamples: samples.length, tileCrops: crops.length, targetCopies: copies.length, scratchClears: clears.length,
    allocations: invocation.allocations.length, before: invocation.before, after: invocation.after, resources: invocation.resources } };
}

async function compare(id, leftCanvas, rightCanvas) {
  check(); same([leftCanvas.width, leftCanvas.height], [rightCanvas.width, rightCanvas.height], 'A/B 完整 backing 尺寸相同');
  const left = ctx(leftCanvas).getImageData(0, 0, leftCanvas.width, leftCanvas.height).data;
  const right = ctx(rightCanvas).getImageData(0, 0, rightCanvas.width, rightCanvas.height).data;
  let differentBytes = 0, differentPixels = 0, maximumDifference = 0; const first = [];
  for (let i = 0; i < left.length; i += 4) {
    let mismatch = false;
    for (let k = 0; k < 4; k++) if (left[i + k] !== right[i + k]) { differentBytes++; mismatch = true; maximumDifference = Math.max(maximumDifference, Math.abs(left[i + k] - right[i + k])); }
    if (mismatch) { differentPixels++; if (first.length < 12) first.push({ x: i / 4 % leftCanvas.width, y: Math.floor(i / 4 / leftCanvas.width), A: [...left.slice(i, i + 4)], B: [...right.slice(i, i + 4)] }); }
  }
  if (differentBytes && failures.length < input.limits.failureImagePairs) failures.push({ id, A: leftCanvas.toDataURL('image/png'), B: rightCanvas.toDataURL('image/png') });
  return { width: leftCanvas.width, height: leftCanvas.height, comparedBytes: left.length, differentBytes, differentPixels, maximumDifference, first, A: await sha(left), B: await sha(right) };
}
async function ready(assets, paths, label) {
  const began = performance.now(); assets.ensure(paths);
  while (!assets.ready(paths)) { check(); ensure(performance.now() - began < input.limits.assetReadyMs, label + ' 超过固定 20 秒 ready 上限'); ensure(assets.failed(paths).length === 0, label + ' 有真实 failed 原图'); await new Promise(resolve => setTimeout(resolve, 10)); }
  ensure(performance.now() - began < input.limits.assetReadyMs, label + ' ready 结束时超时');
}
function surface(canvas, geometry, variant, assets, group) {
  const context = ctx(canvas), fit = sceneFit(input.scene, geometry);
  context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, canvas.width, canvas.height);
  context.setTransform(geometry.dpr, 0, 0, geometry.dpr, 0, 0);
  if (geometry.background === 'original') { context.fillStyle = '#eee3cb'; context.fillRect(0, 0, geometry.width, geometry.height); }
  else if (geometry.background === 'checker') {
    const size = input.checker.cssCell;
    for (let y = 0; y < geometry.height; y += size) for (let x = 0; x < geometry.width; x += size) { context.fillStyle = input.checker.colors[(x / size + y / size) % 2]; context.fillRect(x, y, size, size); }
  } else ensure(geometry.background === 'transparent', '只接受原三种背景');
  context.save(); context.translate(fit.x, fit.y); context.scale(fit.scale, fit.scale); context.beginPath(); context.rect(0, 0, input.scene.width, input.scene.height); context.clip();
  if (geometry.background === 'original') for (const asset of [group.base, ...group.floors]) { const b = asset.worldRect; context.drawImage(assets.image(asset.file), b.x, b.y, b.width, b.height); }
  context.translate(variant.position.x, variant.position.y); return { context, fit };
}
async function pixels(assets, group) {
  for (const geometry of input.geometries) for (const variant of input.variants) {
    check(); const cache = new ObjectRasterCache(); caches.add(cache); let firstTile = null;
    const art = spriteForAppearance(variant.appearanceId, variant.facing, false, 0, false), image = assets.image(variant.asset.file);
    ensure(art && art.href === variant.asset.file && art.mirrorX === false, '必须使用原生非镜像 idle SpriteFrame');
    const bounds = { x: -variant.asset.footPivot.x * variant.asset.scale, y: -variant.asset.footPivot.y * variant.asset.scale, width: variant.asset.width * variant.asset.scale, height: variant.asset.height * variant.asset.scale };
    same(art.bounds, bounds, '原 footPivot/scale 不得为缓存适配修改');
    try {
      for (const phase of input.phases) {
        check(); const id = `${geometry.id}/${variant.id}/${phase}`, row = { id, geometry: geometry.id, variant: variant.id, phase, status: 'RUNNING', errors: [] };
        report.pixelRows.push(row);
        const width = Math.round(geometry.width * geometry.dpr), height = Math.round(geometry.height * geometry.dpr), A = canvas(width, height), B = canvas(width, height);
        try {
          const a = surface(A, geometry, variant, assets, group), b = surface(B, geometry, variant, assets, group);
          a.context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height); a.context.restore();
          const observed = trace(() => { const used = cache.draw(b.context, image, bounds, { dpr: geometry.dpr, fit: b.fit, position: variant.position }); if (!used) b.context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height); return used; });
          b.context.restore(); row.usedCache = observed.value; row.formatA = ctx(A).getContextAttributes(); row.formatB = ctx(B).getContextAttributes();
          if (observed.error) row.errors.push(String(observed.error.stack || observed.error));
          try {
            ensure(observed.cacheCalls.length === 1, '固定单 actor cache 调用'); const observation = cacheObservation(observed, observed.cacheCalls[0], phase); row.cache = observation.summary;
            if (phase === 'miss') firstTile = observation.tile; else ensure(firstTile === observation.tile, 'hit 必须复用前一 miss 的同一个真实 tile');
          } catch (error) { row.errors.push(String(error.stack || error)); }
          row.pixels = await compare(id, A, B); report.pixelPairs++; row.status = row.pixels.differentBytes === 0 && row.errors.length === 0 && row.usedCache === true ? 'PASS' : 'FAIL';
          // 像素不等继续固定矩阵，保留全部 30 对；不会因此执行后段。
        } finally { release(A); release(B); }
      }
    } finally { cache.clear(); ensure(live(bucket(cache).tiles).length === 0 && live(bucket(cache).scratch).length === 0, '站姿对照结束释放真实派生 backing'); caches.delete(cache); }
  }
  same(report.pixelRows.map(row => row.id), input.geometries.flatMap(g => input.variants.flatMap(v => input.phases.map(phase => `${g.id}/${v.id}/${phase}`))), '完整 30 对固定顺序');
  return report.pixelPairs === input.threshold.requiredPixelPairs && report.pixelRows.every(row => row.status === 'PASS');
}

function snapshot(state = 1, overrides = {}) {
  const value = spatialSnapshot(), p = value.projection, definition = input.rendererCases[state];
  ordinal++; value.snapshotSeq = String(10 + ordinal);
  Object.assign(p, { contentVersion: 'gaolaozhuang-scene-v2', chapterVersion: 'gaolao-v1', mapVersion: 'gaolao-layout-v1.1', reducerVersion: 'gaolao-world-v2', variantId: 'two', sceneTimeMs: 1000 + ordinal * 50 });
  Object.assign(p.scene, { sceneId: input.scene.id, name: 'S-A1 实际 renderer 隔离场景', width: input.scene.width, height: input.scene.height,
    walkableAreas: [{ areaId: 'ground', polygon: [{ x: 0, y: 0 }, { x: 1600, y: 0 }, { x: 1600, y: 1000 }, { x: 0, y: 1000 }] }] });
  const position = { ...(overrides.position || definition.self) }, facing = overrides.facing || 'S';
  Object.assign(p.self, { sceneId: input.scene.id, position, facing, appearanceId: 'gaocai' });
  p.entities = [{ entityRef: p.self.entityRef, name: p.self.name, appearanceEpoch: p.self.appearanceEpoch, appearanceId: 'gaocai', sceneId: input.scene.id, position: { ...position }, facing }];
  p.items = [{ entityRef: 'item_0000000000000000000000000000000', name: '原布包', visualKey: 'cloth-parcel', location: { kind: 'ground', sceneId: input.scene.id, position: { ...definition.parcel } }, resourceRevision: '0', transferable: false, publicBorrowable: false, fields: [] }];
  p.targets = [{ entityRef: 'door_0000000000000000000000000000000', name: '原木门', visualKey: 'timber-door', sceneId: input.scene.id, position: { x: 1250, y: 425 }, resourceRevision: '0', availableOperations: [], fields: [{ key: 'open', label: '后宅开放', value: definition.open }] }];
  if (overrides.sessionId) value.sessionId = overrides.sessionId;
  return value;
}
function createArm(side, assets, geometry) {
  const front = canvas(), created = [], original = Document.prototype.createElement; let renderer;
  Document.prototype.createElement = function (...args) { const value = Reflect.apply(original, this, args); if (isCanvas(value)) created.push(remember(value)); return value; };
  try { renderer = new (side === 'A' ? BaselineCanvas : CandidateCanvas)(front, assets); } finally { Document.prototype.createElement = original; }
  ensure(created.length === 1, '真实 renderer 构造恰一个 buffer'); const motion = new ConfirmedMotion();
  const arm = { side, renderer, front, buffer: created[0], motion, owner: new CanvasPresentationOwner(motion, front), read: side === 'A' ? readA : readB,
    geometry, previousSnapshot: null, lastSerial: 0, caches: new Set(), lastTrace: null };
  document.querySelector('#stage').append(front); resize(arm, geometry); arms.add(arm); return arm;
}
function resize(arm, geometry) { arm.geometry = { ...geometry }; arm.renderer.resize(geometry.width, geometry.height, geometry.dpr); arm.front.style.width = geometry.width + 'px'; arm.front.style.height = geometry.height + 'px'; }
function cacheCanvases(arm) { return [...arm.caches].flatMap(cache => [...bucket(cache).scratch, ...bucket(cache).tiles]); }
function sealBeforeUpdate(arm) { arm.owner.seal(performance.now(), true); }
function updateMotion(arm, value, sampledAt, mode) {
  if (mode === 'moving') {
    sealBeforeUpdate(arm); arm.motion.reset();
    const old = structuredClone(value), start = { x: value.projection.self.position.x, y: value.projection.self.position.y - 30 };
    old.projection.sceneTimeMs = 1000; old.projection.self.position = { ...start }; old.projection.entities[0].position = { ...start };
    const current = structuredClone(value); current.projection.sceneTimeMs = 1100;
    for (const person of [current.projection.self, current.projection.entities[0]]) Object.assign(person, { motionTrail: [start, { ...person.position }], motionFromSceneTimeMs: 1000, motionThroughSceneTimeMs: 1100 });
    arm.motion.update(old, sampledAt - 100); arm.motion.update(current, sampledAt - 50); arm.previousSnapshot = current; return current;
  }
  if (arm.previousSnapshot !== value) { sealBeforeUpdate(arm); arm.motion.reset(); arm.motion.update(value, sampledAt); arm.previousSnapshot = value; }
  return value;
}
function paintArm(arm, value, sampledAt, options) {
  check(); ensure(report.rendererPaintCalls < input.limits.rendererPaintCallsMaximum, 'renderer 调用硬上限 64');
  const actual = updateMotion(arm, value, sampledAt, options.moving ? 'moving' : 'stationary');
  arm.renderer.prepare(actual); const before = arm.read(arm.front); let beforeFrontWrites = 0, sealAt = null;
  const t = trace(calls => {
    report.rendererPaintCalls++;
    return arm.renderer.paint(actual, arm.motion, sampledAt, { reducedMotion: false, selected: options.selected === 'parcel' ? actual.projection.items[0]?.entityRef : actual.projection.self.entityRef,
      beforeFrontWrite() {
        beforeFrontWrites++; same(arm.read(arm.front), before, 'beforeFrontWrite 仍是原已发布帧');
        ensure(!calls.some(c => c.name === 'drawImage' && c.target === arm.front), 'owner.seal 必须在唯一前台写入之前');
        sealAt = performance.now(); arm.owner.seal(sealAt, true);
      } });
  }, options.inject && arm.side === 'B' ? { image: options.inject, buffer: arm.buffer } : null);
  arm.lastTrace = t; for (const invocation of t.cacheCalls) arm.caches.add(invocation.cache);
  if (t.error) throw t.error; ensure(beforeFrontWrites === 1, '每个 paint 包括 cache hit 恰一次 beforeFrontWrite');
  const frame = t.value; ensure(frame, '真实 renderer 必须完成帧');
  ensure(frame.serial === arm.lastSerial + 1, '每次真实 paint 都递增 serial'); arm.lastSerial = frame.serial;
  same(arm.read(arm.front), frame, '真实 front copy 之后才发布 frame');
  const frontWrites = t.calls.filter(c => c.name === 'drawImage' && c.target === arm.front);
  ensure(frontWrites.length === 1 && frontWrites[0].source === arm.buffer, '每次恰一个原 buffer→front 写入'); same(frontWrites[0].args, [0, 0], '原 front copy 不缩放'); same(frontWrites[0].matrix, [1, 0, 0, 1, 0, 0], 'front copy identity');
  ensure(t.calls.some(c => c.name === 'clip' && c.target === arm.buffer), '保留真实 scene clip');
  const presentedAt = performance.now(), ownerAccepted = arm.owner.painted(frame, actual, sampledAt, presentedAt, true);
  ensure(ownerAccepted === !options.moving, '真实 owner 仅接受可见静止帧，不把 moving 当作静止信用');
  ensure(Number.isFinite(arm.motion.presentationCreditMs) && arm.motion.presentationCreditMs >= 0, '真实呈现信用为有限非负数');
  same([arm.front.dataset.sceneId, arm.front.dataset.sceneLayerStatus, arm.front.dataset.sceneView, arm.front.dataset.renderedEntities],
    [frame.sceneId, frame.layerStatus, '0 0 1600 1000', String(frame.actors.length + frame.objects.length)], '原 dataset 在发布后正确');
  return { t, frame, actual, owner: { beforeFrontWrites, sealAt, sampledAt, presentedAt, ownerAccepted, creditMs: arm.motion.presentationCreditMs, frontWrites: 1, serial: frame.serial } };
}
function actorObservation(painted, arm, assets, expected, options) {
  const { t, frame } = painted, actor = frame.actors.find(a => a.ref === painted.actual.projection.self.entityRef);
  ensure(actor?.appearanceId === 'gaocai', '实际 self 使用 gaocai'); ensure(actor.moving === Boolean(options.moving), '实际 ConfirmedMotion moving 值');
  const image = actor.art && assets.image(actor.art.href), invocations = t.cacheCalls.filter(c => c.image === image);
  const direct = t.calls.filter(c => c.name === 'drawImage' && c.source === image && c.target === arm.buffer);
  const shadow = t.calls.filter(c => c.name === 'ellipse' && c.target === arm.buffer && c.args[0] === 0 && c.args[1] === -1 && c.args[2] === 17 && c.args[3] === 6);
  ensure(shadow.length === 1, '脚影仍在原 actor 循环');
  let observed = null, artIndex = Infinity;
  if (!actor.art) { ensure(expected === 'no-art' && invocations.length === 0 && direct.length === 0, '真实资源失败时中性人物不命中旧 tile'); }
  else if (arm.side === 'A' || expected === 'original') {
    ensure(invocations.length === 0 && direct.length === 1, 'A / moving / mirror 必须原图直接绘入 buffer'); artIndex = t.calls.indexOf(direct[0]);
  } else {
    ensure(invocations.length === 1, '非镜像静止 actor 恰一个原共享 helper 调用'); observed = cacheObservation(t, invocations[0], expected);
    if (expected === 'fallback') { ensure(direct.length === 1, 'helper false 后必须原图直接回退'); artIndex = t.calls.indexOf(direct[0]); }
    else { ensure(direct.length === 0, '真 cache 命中不得再直接采样原图'); artIndex = t.calls.findIndex(c => c.name === 'drawImage' && c.source === observed.tile && c.target === arm.buffer); }
  }
  ensure(t.calls.indexOf(shadow[0]) < artIndex, '原脚影在角色图像之前');
  const shared = new Set(t.cacheCalls.map(c => c.cache)); ensure(shared.size <= 1, 'actor 和物件只能共享该 renderer 的同一 ObjectRasterCache');
  for (const invocation of t.cacheCalls) resourceLimits(invocation.resources);
  if (options.mirror) ensure(actor.art?.mirrorX === true && expected === 'original', '西向必须真实镜像且不进入新 cache');
  if (options.moving) ensure(actor.art?.href.includes('/walk/') && actor.art.mirrorX === false, '真实运动使用 walk 原图');
  if (options.clip) {
    const b = actor.art.bounds, x = actor.position.x + b.x, y = actor.position.y + b.y;
    ensure(x < 0 || y < 0 || x + b.width > input.scene.width || y + b.height > input.scene.height, 'clip 行的真实人物 bounds 必须跨 scene 边界');
  }
  return { tile: observed?.tile, image, artIndex, summary: { appearanceId: actor.appearanceId, moving: actor.moving, mirrorX: actor.art?.mirrorX ?? null,
    file: actor.art?.href ?? null, directImageDraws: direct.length, actorCacheCalls: invocations.length, sharedCacheInstances: shared.size,
    objectCacheCalls: t.cacheCalls.filter(c => input.objectPaths.includes(new URL(c.image.src, location.href).pathname)).length,
    cache: observed?.summary ?? null, footShadowCalls: shadow.length, nativeCalls: t.calls.length, injected: t.injected } };
}
function alphaHits(arm, frame, assets) {
  const actor = frame.actors[0], art = actor.art, image = art && assets.image(art.href); ensure(image && !art.mirrorX, 'alphaHit 行使用真实非镜像已就绪原图');
  const rows = []; let opaque = 0, transparent = 0;
  for (let iy = 1; iy <= 7; iy++) for (let ix = 1; ix <= 7; ix++) {
    // 取真实源像素中心，避免 world↔screen 浮点往返刚好落在整数像素边界。
    const px = Math.floor(image.naturalWidth * ix / 8) + .5, py = Math.floor(image.naturalHeight * iy / 8) + .5;
    const local = { x: art.bounds.x + px / image.naturalWidth * art.bounds.width, y: art.bounds.y + py / image.naturalHeight * art.bounds.height };
    if ((local.x / 17) ** 2 + ((local.y + 1) / 6) ** 2 <= 1) continue;
    const point = screenPoint({ x: actor.position.x + local.x, y: actor.position.y + local.y }, frame.fit);
    if (frame.labels.some(l => l.selectable && point.x >= l.x && point.x <= l.x + l.width && point.y >= l.y && point.y <= l.y + l.height)) continue;
    const isOpaque = assets.opaqueAt(art.href, px, py), hit = arm.renderer.hit(point);
    ensure((hit === actor.ref) === isOpaque, '实际 renderer alphaHit 与原图 alpha 一致，透明区不以 tile 矩形命中');
    if (isOpaque) opaque++; else transparent++; rows.push({ px, py, opaque: isOpaque, hit });
  }
  ensure(opaque > 0 && transparent > 0, 'alphaHit 必须同时有真实不透明与透明见证'); return { opaque, transparent, samples: rows };
}
function layerChecks(painted, actor, arm, definition) {
  const { frame, t } = painted;
  ensure(frame.layerStatus === 'ready' && frame.artwork && !frame.geometricFallback, '真实原场景图层必须 ready');
  const post = frame.sceneImages.find(v => v.file.endsWith('/foreground/left-post.png'));
  ensure(post?.opacity === definition.foregroundOpacity, '前景透明让位仍由原身体决定');
  ensure(frame.objects.some(v => v.kind === 'door' && v.variant === (definition.open ? 'open' : 'closed')), '门仍按原开放状态选择');
  const parcelImageCalls = t.cacheCalls.filter(c => new URL(c.image.src, location.href).pathname === input.objectPaths[0]); ensure(parcelImageCalls.length === 1, '实际原布包共享 helper 一次');
  const parcel = parcelImageCalls[0], parcelIndex = t.calls.findIndex((c, index) => index >= parcel.start && index < parcel.end && c.name === 'drawImage' && c.target === arm.buffer);
  ensure(parcelIndex >= 0 && (definition.self.y < definition.parcel.y ? actor.artIndex < parcelIndex : actor.artIndex > parcelIndex), '原脚底深度次序');
  ensure(frame.labels.some(l => l.key === painted.actual.projection.self.entityRef) && frame.labels.some(l => l.key === painted.actual.projection.items[0].entityRef), '原人物/物件标签仍存在');
  const selectedRef = definition.selected === 'parcel' ? painted.actual.projection.items[0].entityRef : painted.actual.projection.self.entityRef;
  ensure(frame.labels.some(l => l.key === selectedRef), '选择标签仍由原 renderer 发布');
}
async function rendererPair(id, pair, assets, value, options = {}) {
  check(); ensure(input.rendererPairIds[report.rendererRows.length] === id, '后段固定顺序，不新增补跑');
  const row = { id, status: 'RUNNING' }; report.rendererRows.push(row);
  try {
    const sampledAt = performance.now(), A = paintArm(pair.A, value, sampledAt, options), B = paintArm(pair.B, value, sampledAt, options);
    same(A.frame, B.frame, 'A/B 完整实际 frame（含原 labels/hits 资料/resources）一致');
    row.frame = A.frame; row.frameSha256 = await jsonSha(A.frame); row.frameComparedBoth = true; row.owner = { A: A.owner, B: B.owner };
    const expected = options.expected || 'miss';
    const a = actorObservation(A, pair.A, assets, expected === 'no-art' ? 'no-art' : 'original', options);
    const b = actorObservation(B, pair.B, assets, expected, options); row.actor = { A: a.summary, B: b.summary };
    if (options.layer) { layerChecks(A, a, pair.A, options.layer); layerChecks(B, b, pair.B, options.layer); row.layers = { expected: options.layer, verified: true }; }
    if (options.alpha) { const aa = alphaHits(pair.A, A.frame, assets), bb = alphaHits(pair.B, B.frame, assets); same(aa, bb, '实际 A/B alphaHit 全部采样同'); row.alphaHit = aa; }
    if (options.extra) options.extra({ row, A, B, a, b });
    row.pixels = await compare(id, pair.A.front, pair.B.front); ensure(row.pixels.differentBytes === 0, '后段严格完整 RGBA 不等'); row.status = 'PASS'; return { row, A, B, a, b };
  } catch (error) { row.status = 'FAIL'; row.error = String(error.stack || error); throw error; }
}
function clearPair(pair, record) {
  const prior = [...cacheCanvases(pair.A), ...cacheCanvases(pair.B)];
  for (const arm of [pair.A, pair.B]) { arm.owner.invalidate(); arm.renderer.clear(); ensure(arm.read(arm.front) === null && arm.renderer.hit({ x: 0, y: 0 }) === null, 'clear 清除 frame 与命中'); }
  ensure(prior.every(c => c.width === 0 && c.height === 0), 'clear 释放已有 actor/object 派生 backing');
  if (record) report.postRows.push({ id: 'renderer-clear', status: 'PASS', releasedDerivedCanvases: prior.length, framesNull: true, hitsNull: true });
}
async function renderers(assets) {
  const pair = { A: createArm('A', assets, input.geometries[0]), B: createArm('B', assets, input.geometries[0]) };
  const behind = snapshot(0), front = snapshot(1);
  await rendererPair('behind-miss', pair, assets, behind, { expected: 'miss', selected: 'parcel', layer: input.rendererCases[0] });
  await rendererPair('behind-hit', pair, assets, behind, { expected: 'hit', selected: 'parcel', layer: input.rendererCases[0] });
  await rendererPair('front-miss', pair, assets, front, { expected: 'miss', layer: input.rendererCases[1] });
  await rendererPair('front-hit', pair, assets, front, { expected: 'hit', layer: input.rendererCases[1] });
  await rendererPair('clip-left', pair, assets, snapshot(1, { position: { x: 0, y: 425 } }), { expected: 'miss', clip: true });
  await rendererPair('clip-bottom-right', pair, assets, snapshot(1, { position: { x: 1599.75, y: 999.75 } }), { expected: 'miss', clip: true });
  for (const facing of ['W', 'SW', 'NW']) await rendererPair('mirror-' + facing.toLowerCase(), pair, assets, snapshot(1, { position: { x: 950, y: 650 }, facing }), { expected: 'original', mirror: true });
  await rendererPair('moving-s', pair, assets, snapshot(1, { position: { x: 950, y: 650 } }), { expected: 'original', moving: true });
  const path = input.variants[0].asset.file, oldImage = assets.image(path); ensure(oldImage, 'ready→error 前真实原 image');
  oldImage.onerror(new Event('error')); ensure(assets.image(path) === null && assets.failed([path]).length === 1, '通过真实 CanvasAssets error 回调进入 failed');
  const stable = snapshot(1, { position: { x: 950, y: 650 } });
  await rendererPair('ready-to-error', pair, assets, stable, { expected: 'no-art' });
  pair.B.renderer.retry(); await ready(assets, input.actorPaths, '原 renderer.retry');
  const retryImage = assets.image(path); ensure(retryImage && retryImage !== oldImage, '真实 retry 必须新 HTMLImageElement');
  await rendererPair('retry-new-image', pair, assets, stable, { expected: 'miss', alpha: true, extra({ row }) { row.resourceTransition = { kind: 'REAL_CANVAS_ASSETS_RETRY', sameImage: false, oldURL: oldImage.src, newURL: retryImage.src }; } });
  // 真实 retry URL 含 ?retry；同 URL 替换单独明确为 fixture 的 image provider 控制，二者不混称。
  const replacement = new Image(); replacement.src = retryImage.src; await replacement.decode(); check();
  ensure(replacement !== retryImage && replacement.src === retryImage.src && replacement.naturalWidth === retryImage.naturalWidth && replacement.naturalHeight === retryImage.naturalHeight, '同 URL 新真实 Image 身份');
  const originalImage = assets.image;
  assets.image = function (file) { return file === path ? replacement : Reflect.apply(originalImage, this, [file]); };
  try {
    await rendererPair('same-url-new-image', pair, assets, stable, { expected: 'miss', alpha: true, extra({ row }) { row.resourceTransition = { kind: 'CONTROLLED_IMAGE_PROVIDER_REPLACEMENT', sameURL: true, sameImage: false, source: replacement.src }; } });
  } finally { assets.image = originalImage; }
  const scoped = snapshot(1, { position: { x: 950, y: 650 }, sessionId: stable.sessionId + '-new-scope' }), oldDerived = [...cacheCanvases(pair.A), ...cacheCanvases(pair.B)];
  await rendererPair('scope-change', pair, assets, scoped, { expected: 'miss', alpha: true, extra({ row }) { ensure(oldDerived.every(c => c.width === 0 && c.height === 0), 'scope 变化释放旧派生 backing'); row.releasedOldDerived = oldDerived.length; } });
  for (const [id, geometry, sameBacking] of [
    ['resize-g2', input.geometries[1], false],
    ['resize-same-backing', { ...input.geometries[1], width: 980.6 }, true],
    ['resize-dpr', { ...input.geometries[1], width: 980.6, dpr: 1.25001 }, true],
  ]) {
    const derived = [...cacheCanvases(pair.A), ...cacheCanvases(pair.B)], previousBacking = [pair.A.front.width, pair.A.front.height];
    for (const arm of [pair.A, pair.B]) resize(arm, geometry);
    if (sameBacking) same([pair.A.front.width, pair.A.front.height], previousBacking, '该尺寸/DPR 变化故意保持原 backing');
    ensure(derived.every(c => c.width === 0 && c.height === 0), '任一 CSS/DPR 变化释放旧派生 backing');
    await rendererPair(id, pair, assets, scoped, { expected: 'miss', extra({ row }) { row.resize = { geometry, sameBacking, releasedOldDerived: derived.length }; } });
  }
  clearPair(pair, true); await rendererPair('after-clear', pair, assets, scoped, { expected: 'miss', alpha: true });
  clearPair(pair, false); for (const arm of [pair.A, pair.B]) resize(arm, input.geometries[0]);
  const full = snapshot(1, { position: { x: 950, y: 300 }, sessionId: scoped.sessionId }); full.projection.targets = [];
  const parcel = full.projection.items[0]; full.projection.items = Array.from({ length: 32 }, (_, index) => ({ ...structuredClone(parcel), entityRef: 'bounded-parcel-' + index,
    name: '原布包 ' + index, location: { kind: 'ground', sceneId: input.scene.id, position: { x: 180 + index % 8 * 150, y: 450 + Math.floor(index / 8) * 110 } } }));
  let evictedTile;
  await rendererPair('shared-lru-first', pair, assets, full, { expected: 'miss', extra({ row, B, b }) {
    ensure(B.t.cacheCalls.length === 33 && new Set(B.t.cacheCalls.map(c => c.cache)).size === 1, '1 actor +32 物件真实共享一个 32-entry helper');
    evictedTile = b.tile; ensure(evictedTile && evictedTile.width === 0 && evictedTile.height === 0, '后续 32 物件使 actor tile 真实 LRU 淘汰'); row.sharedLRU = { helperCalls: 33, actorEvicted: true, final: resources(B.t.cacheCalls[0].cache) };
  } });
  await rendererPair('shared-lru-revisit', pair, assets, full, { expected: 'miss', extra({ row, b }) { ensure(b.tile !== evictedTile, '已淘汰 actor 必须真实重建 tile'); row.sharedLRU = { rebuiltActor: true, sharedWithObjects: true }; } });
  const fault = snapshot(1, { position: { x: 900, y: 320 }, sessionId: scoped.sessionId });
  await rendererPair('facility-fallback', pair, assets, fault, { expected: 'fallback', inject: assets.image(path), extra({ row, B }) {
    ensure(B.t.injected && B.t.cacheCalls.length >= 2, '唯一故障必须到达真实 actor scratch，后续物件同代回退');
    ensure(B.t.cacheCalls.every(c => c.used === false), '共享 helper 失败代不再创建物件/actor tile');
    ensure(cacheCanvases(pair.B).every(c => c.width === 0 && c.height === 0), '失败代释放共享 actor/物件 backing'); row.controlledFailure = 'ONE_REAL_SCRATCH_DRAWIMAGE_THROW';
  } });
  await rendererPair('facility-disabled-repeat', pair, assets, fault, { expected: 'fallback', extra({ row, B }) { ensure(B.t.allocations.length === 0 && B.t.cacheCalls.every(c => c.used === false), '同失败代重复 paint 不重分配'); row.sameGenerationNoRetry = true; } });
  clearPair(pair, false); await rendererPair('after-facility-clear', pair, assets, fault, { expected: 'miss' });
  const before = [...cacheCanvases(pair.A), ...cacheCanvases(pair.B)], frames = [pair.A.read(pair.A.front), pair.B.read(pair.B.front)];
  for (const arm of [pair.A, pair.B]) {
    const observed = trace(() => arm.renderer.dispose()); if (observed.error) throw observed.error;
    ensure(!observed.calls.some(c => c.target === arm.front), 'dispose 不新写前台');
  }
  ensure(before.every(c => c.width === 0 && c.height === 0), 'dispose 释放真实共享派生 backing');
  same([pair.A.read(pair.A.front), pair.B.read(pair.B.front)], frames, 'dispose 保持原已发布 frame 合同');
  report.postRows.push({ id: 'renderer-dispose', status: 'PASS', frontWrites: 0, releasedDerivedCanvases: before.length });
}

function markNotReached(reason) {
  const pixelReached = new Set(report.pixelRows.map(r => r.id));
  for (const geometry of input.geometries) for (const variant of input.variants) for (const phase of input.phases) {
    const id = `${geometry.id}/${variant.id}/${phase}`;
    if (!pixelReached.has(id)) { report.pixelRows.push({ id, geometry: geometry.id, variant: variant.id, phase, status: 'NOT_RUN', reason }); report.notReached.push(id); }
  }
  const reached = new Set(report.rendererRows.map(r => r.id));
  for (const id of input.rendererPairIds) if (!reached.has(id)) { report.rendererRows.push({ id, status: 'NOT_RUN', reason }); report.notReached.push(id); }
  const postReached = new Set(report.postRows.map(r => r.id));
  for (const id of input.postRows) if (!postReached.has(id)) { report.postRows.push({ id, status: 'NOT_RUN', reason }); report.notReached.push(id); }
}
async function run() {
  ensure(!started, '此页面只能实际执行一次'); started = true; report.startedAt = performance.now(); deadline = report.startedAt + input.limits.bodyMs;
  try {
    const assets = new CanvasAssets(), group = sceneLayerCatalog[input.scene.id];
    ensure(group, '必须存在原 courtyard group'); same(spriteResourcePaths('gaocai'), input.actorPaths, '原 45 个 sprite 路径及顺序');
    const paths = Object.keys(input.assets); await ready(assets, paths, '固定 54 张原 PNG');
    for (const [path, expected] of Object.entries(input.assets)) { const image = assets.image(path); ensure(image && image.naturalWidth === expected.width && image.naturalHeight === expected.height, '实际 PNG native 尺寸：' + path); }
    same(sceneGroupAssets(group).map(a => a.file).sort(), paths.filter(path => path.includes('/scenes/')).sort(), '固定原 courtyard scene 资源');
    report.resources = assets.resources(paths); report.stage1 = 'RUNNING';
    if (!await pixels(assets, group)) { report.stage1 = 'FAIL'; report.assessment = 'FAIL'; markNotReached('STAGE1_FULL_30_PAIRS_NOT_ALL_PASS'); return; }
    report.stage1 = 'PASS'; report.stage2 = 'RUNNING'; await renderers(assets);
    same(report.rendererRows.map(row => row.id), input.rendererPairIds, '全部 23 renderer pairs 固定顺序');
    ensure(report.rendererPaintCalls === input.limits.rendererPaintCalls, '成功必须恰 46 实际 paint，不减少或追加');
    ensure(report.rendererRows.every(row => row.status === 'PASS') && report.postRows.every(row => row.status === 'PASS'), '全部后置合同完成');
    report.stage2 = 'PASS'; report.assessment = 'PASS';
  } catch (error) {
    const message = String(error.stack || error); report.errors.push(message); report.assessment = 'FAIL';
    for (const row of [...report.pixelRows, ...report.rendererRows]) if (row.status === 'RUNNING') { row.status = 'FAIL'; row.error = message; }
    markNotReached('PREVIOUS_ROW_OR_ENVIRONMENT_FAILED');
  }
  finally {
    for (const cache of caches) { try { cache.clear(); } catch (error) { report.cleanup.push({ name: 'pixel-cache', status: 'failed', error: String(error) }); } } caches.clear();
    for (const arm of arms) { try { arm.owner.invalidate(); arm.renderer.dispose(); report.cleanup.push({ name: 'renderer-' + arm.side, status: 'disposed' }); } catch (error) { report.cleanup.push({ name: 'renderer-' + arm.side, status: 'failed', error: String(error) }); } }
    arms.clear(); for (const value of surfaces) release(value);
    report.observedCanvases = surfaces.size; report.cleanup.push({ name: 'observed-backings', status: live(surfaces).length === 0 ? 'released' : 'failed', live: live(surfaces).length });
    if (report.cleanup.some(value => value.status === 'failed')) report.assessment = 'FAIL'; report.finishedAt = performance.now();
  }
}
window.stationaryActorRasterChecks = { run, evidence: () => structuredClone(report), failures: () => structuredClone(failures),
  cancel() { cancelled = true; } };
