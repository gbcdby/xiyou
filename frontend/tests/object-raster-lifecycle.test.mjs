import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialCanvas, readCanvasFrame } from '../src/rendering/spatial-canvas.ts';
import { ConfirmedMotion } from '../src/domain/spatial-motion.ts';
import { objectArtCatalog } from '../src/domain/gaolao-object-art.ts';
import { gaolaoPersonalProfiles } from '../../protocol/spatial.mjs';
import { spatialSnapshot } from './spatial-fixture.mjs';

function harness(t) {
  const originalDocument = globalThis.document, originalPath = globalThis.Path2D, made = [];
  const identity = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  function canvas() {
    const draws = [], clears = [], operations = [], states = [], state = {
      matrix: identity(), globalAlpha: 1, globalCompositeOperation: 'source-over', filter: 'none', shadowColor: 'rgba(0, 0, 0, 0)',
      shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, imageSmoothingEnabled: true, imageSmoothingQuality: 'low',
      getContextAttributes: () => ({ alpha: true, colorSpace: 'srgb', colorType: 'unorm8', desynchronized: false, willReadFrequently: false }),
      getTransform() { return { ...this.matrix }; },
      setTransform(a, b, c, d, e, f) { this.matrix = { a, b, c, d, e, f }; operations.push(['setTransform', a, b, c, d, e, f]); },
      save() { states.push({ matrix: { ...this.matrix }, globalAlpha: this.globalAlpha }); }, restore() { Object.assign(this, states.pop()); },
      translate(x, y) { this.matrix.e += this.matrix.a * x; this.matrix.f += this.matrix.d * y; operations.push(['translate', x, y]); },
      scale(x, y) { this.matrix.a *= x; this.matrix.d *= y; operations.push(['scale', x, y]); }, drawImage(...args) { draws.push(args); },
      clearRect(...args) { clears.push(args); }, isPointInPath() { return false; },
    };
    const context = new Proxy(state, { get(target, key) { return target[key] ?? (() => {}); } });
    const result = { width: 0, height: 0, dataset: {}, draws, clears, operations, getContext: () => context };
    state.canvas = result; return result;
  }
  globalThis.document = { createElement() { const result = canvas(); made.push(result); return result; } }; globalThis.Path2D = class {};
  t.after(() => { globalThis.document = originalDocument; globalThis.Path2D = originalPath; });
  const snapshot = spatialSnapshot(); Object.assign(snapshot.projection, gaolaoPersonalProfiles.find(profile => profile.contentVersion === 'gaolaozhuang-scene-v3'));
  const p = snapshot.projection; p.scene.sceneId = p.self.sceneId = 'gaolao-courtyard'; p.scene.width = 1600; p.scene.height = 1000;
  for (const entity of p.entities) entity.sceneId = p.scene.sceneId;
  p.items.push({ entityRef: 'parcel_000000000000000000000000000', name: '包裹', visualKey: 'cloth-parcel', resourceRevision: '0', fields: [], location: { kind: 'ground', sceneId: p.scene.sceneId, position: { x: 700, y: 600 } } });
  const file = objectArtCatalog['cloth-parcel'].variants.loose.file;
  const picture = () => ({ complete: true, naturalWidth: 1254, naturalHeight: 1254, src: file, currentSrc: file });
  let current = picture(), opaque = true; const hitReads = [], assets = {
    ensure() {}, ready: () => false, failed: () => [], resources: () => [], actorFrame: () => null,
    image: path => path === file ? current : null,
    opaqueAt(...args) { hitReads.push(args); return opaque; }, retry() {},
  };
  const front = canvas(), renderer = new SpatialCanvas(front, assets), motion = new ConfirmedMotion();
  motion.update(snapshot, 0); renderer.prepare(snapshot); renderer.resize(980.5, 612.25, 1.25);
  const paint = () => renderer.paint(snapshot, motion, 0, { reducedMotion: true });
  return { made, front, renderer, snapshot, paint, file, picture, hitReads, setImage(value) { current = value; }, setOpaque(value) { opaque = value; } };
}

test('C-R3/C-R4：生产renderer逐帧合成，实际CSS/DPR、scope、clear与dispose释放scratch及tile', t => {
  const h = harness(t), first = h.paint();
  assert.equal(h.made.length, 3, '一个buffer、一个scratch和一个物件派生tile');
  let [scratch, tile] = h.made.slice(1);
  const object = first.objects.find(item => item.file === h.file);
  const expectedReplay = [
    ['setTransform', 1, 0, 0, 1, 0, 0], ['setTransform', 1.25, 0, 0, 1.25, 0, 0],
    ['translate', first.fit.x, first.fit.y], ['scale', first.fit.scale, first.fit.scale], ['translate', object.position.x, object.position.y],
  ];
  assert.deepEqual(scratch.operations, expectedReplay, '生产caller直接传本帧真实DPR、fit与物件位置');
  const released = () => { assert.equal(scratch.width, 0); assert.equal(scratch.height, 0); assert.equal(tile.width, 0); assert.equal(tile.height, 0); };
  const repainted = () => {
    h.paint(); [scratch, tile] = h.made.slice(-2);
    assert.deepEqual([scratch.width, scratch.height], [h.made[0].width, h.made[0].height]);
    assert.equal(scratch.draws.length, 1); assert.equal(tile.draws[0][0], scratch);
  };
  assert.equal(scratch.draws.length, 1); assert.equal(tile.draws.length, 1); assert.equal(h.front.draws.length, 1);
  h.renderer.resize(980.5, 612.25, 1.25); h.renderer.prepare(h.snapshot); h.paint();
  assert.equal(h.made.length, 3); assert.equal(scratch.draws.length, 1); assert.equal(scratch.clears.length, 1);
  assert.deepEqual(scratch.operations, expectedReplay, '生产重复帧命中不重放任何scratch操作');
  assert.equal(tile.draws.length, 1); assert.equal(h.front.draws.length, 2);
  assert.equal(h.made[0].draws.filter(args => args[0] === tile).length, 2, '每帧在原buffer合成，不省略输出');
  const backingWidth = h.front.width;
  h.renderer.resize(980.6, 612.25, 1.25);
  assert.equal(h.front.width, backingWidth); released(); repainted(); assert.equal(h.made.length, 5);
  h.renderer.resize(980.6, 612.25, 1.250001); released(); repainted();
  h.snapshot.viewId += '-next'; h.renderer.prepare(h.snapshot); released(); repainted();
  assert.notEqual(readCanvasFrame(h.front).instance, first.instance);
  h.renderer.clear(); released(); assert.equal(readCanvasFrame(h.front), null);
  h.renderer.prepare(h.snapshot); repainted(); const writes = h.front.draws.length;
  h.renderer.dispose(); released(); assert.equal(h.front.draws.length, writes, '卸载释放不再写前台');
  assert.ok(h.made.slice(1).every(surface => surface.width === 0 && surface.height === 0));
});

test('C-R3：ready缺失不显示旧tile，原图alpha命中保持，新实例重试重新生成，无scene清理', t => {
  const h = harness(t), first = h.paint(), object = first.objects.find(item => item.file === h.file), scratch = h.made[1], tile = h.made[2];
  assert.ok(object); assert.ok(tile);
  const point = { x: first.fit.x + (object.position.x + object.bounds.x + object.bounds.width / 2) * first.fit.scale, y: first.fit.y + (object.position.y + object.bounds.y + object.bounds.height / 2) * first.fit.scale };
  assert.equal(h.renderer.hit(point), object.ref); assert.equal(h.hitReads.at(-1)[0], h.file);
  assert.ok(Math.abs(h.hitReads.at(-1)[1] - 627) < 1e-8); assert.ok(Math.abs(h.hitReads.at(-1)[2] - 627) < 1e-8);
  h.setOpaque(false); assert.notEqual(h.renderer.hit(point), object.ref, '原图透明位置不能因派生tile变成命中');
  const oldDraws = h.made[0].draws.filter(args => args[0] === tile).length;
  h.setImage(null); const missing = h.paint();
  assert.equal(missing.objects.find(item => item.ref === object.ref).file, undefined);
  assert.equal(h.made[0].draws.filter(args => args[0] === tile).length, oldDraws, 'loading/failed不回显旧tile');
  h.setImage(h.picture()); assert.equal(h.paint().objects.find(item => item.ref === object.ref).file, h.file);
  assert.equal(h.made.length, 4, '同URL的新ready实例重新生成tile，仍复用scratch');
  assert.equal(scratch.draws.length, 2); assert.equal(h.made[3].draws[0][0], scratch);
  h.snapshot.projection.scene = null; assert.equal(h.paint(), null);
  assert.ok(h.made.slice(1).every(value => value.width === 0 && value.height === 0));
  assert.equal(readCanvasFrame(h.front), null); assert.equal(h.renderer.hit(point), null);
});
