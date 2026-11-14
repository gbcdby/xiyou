import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent, contentDigest } from '../index.mjs';
import { validateSpatialContent } from '../spatial.mjs';
import { gaolaoObjectVisual } from '../gaolao-object-visuals.mjs';

test('新本人内容逐个注册语义版本，继承对应旧地图/物件/路线且旧内容摘要不变', async () => {
  const oldDigests = {
    'gaolaozhuang-v1': '0d901f5ee4ff85ce9eca658628e7d9f5c8fa052100ba1f001fea550ac525f93c',
    'gaolaozhuang-tools-east-v1': '8b405833b5f84d2a2e72d60b6b6da0ab69c2a33b26a33eb4126855e1fc626e3e',
    'gaolaozhuang-scene-v2': '6e00c51236a9db250a5d420b90c0e94e7058920f807e75fc27d36717692ff787',
    'gaolaozhuang-tools-east-scene-v2': '2e6ce04bc500671e28a8026e1615953fea5e46e2b8c3c7781787f10231e0b917',
  };
  for (const [version, digest] of Object.entries(oldDigests)) assert.equal(contentDigest(await loadContent(version)), digest);
  for (const [newVersion, oldVersion, variantId] of [
    ['gaolaozhuang-scene-v3', 'gaolaozhuang-scene-v2', 'west-tools'],
    ['gaolaozhuang-tools-east-scene-v3', 'gaolaozhuang-tools-east-scene-v2', 'east-tools'],
  ]) {
    const current = await loadContent(newVersion), old = await loadContent(oldVersion);
    assert.equal(current.reducerVersion, 'gaolao-world-v2');
    assert.equal(current.chapterVersion, 'gaolaozhuang-chapter-v3');
    assert.equal(current.mapVersion, 'gaolao-layout-v1.1');
    assert.equal(current.variantId, variantId);
    assert.equal(current.chapterRules.sceneRolePolicies[0].policyVersion, 'gaolao-cuilan-v2');
    for (const key of ['scenes', 'spawns', 'npcs', 'items', 'targets', 'operations']) assert.deepEqual(current[key], old[key]);
    assert.deepEqual(current.chapterRules.routeSpecs, old.chapterRules.routeSpecs);
    assert.deepEqual(current.chapterRules.personalSourceSpecs.map(source => [source.purpose, source.sourceId, source.revision]), [
      ['appearance', 'cuilan-appearance-boundaries-v1', 1], ['private_items', 'cuilan-private-items-v1', 1],
    ]);
    for (const spec of current.chapterRules.personalSourceSpecs) {
      const source = current.chapterRules.sources.find(source => source.sourceId === spec.sourceId);
      assert.equal(source.category, 'Claim'); assert.equal(source.kind, 'testimony'); assert.equal(source.beforeArrivalDays, 0);
    }
  }
});

test('缺本人来源或混用 policy/content/reducer 的新配置被拒绝，旧局不接受新来源注入', async () => {
  const current = await loadContent('gaolaozhuang-scene-v3');
  for (const mutate of [
    c => { delete c.chapterRules.personalSourceSpecs; },
    c => { c.chapterRules.sources = c.chapterRules.sources.filter(source => source.sourceId !== 'cuilan-private-items-v1'); },
    c => { c.chapterRules.sceneRolePolicies[0].policyVersion = 'gaolao-cuilan-v1'; },
    c => { c.reducerVersion = 'gaolao-world-v1'; },
    c => { c.contentVersion = 'gaolaozhuang-scene-v4'; },
    c => { c.chapterRules.sources.find(source => source.sourceId === 'cuilan-private-items-v1').category = 'Evidence'; },
  ]) { const bad = structuredClone(current); mutate(bad); assert.throws(() => validateSpatialContent(bad)); }
  const old = await loadContent('gaolaozhuang-scene-v2');
  old.chapterRules.personalSourceSpecs = current.chapterRules.personalSourceSpecs;
  assert.throws(() => validateSpatialContent(old));
});

test('新默认版本只映射既有默认布局的视觉键，东侧/未知版本不套用', async () => {
  const current = await loadContent('gaolaozhuang-scene-v3');
  assert.deepEqual(gaolaoObjectVisual(current, 'gz-parcel'), { visualKey: 'cloth-parcel' });
  assert.deepEqual(gaolaoObjectVisual(await loadContent('gaolaozhuang-tools-east-scene-v3'), 'gz-parcel'), {});
  assert.deepEqual(gaolaoObjectVisual({ ...current, contentVersion: 'gaolaozhuang-scene-v4' }, 'gz-parcel'), {});
  assert.deepEqual(gaolaoObjectVisual({ ...current, mapVersion: 'other-layout' }, 'gz-parcel'), {});
  assert.deepEqual(gaolaoObjectVisual({ ...current, variantId: 'east-tools' }, 'gz-parcel'), {});
});
