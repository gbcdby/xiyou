import test from 'node:test';
import assert from 'node:assert/strict';
import { HUD_PREFERENCES_KEY, readHudPreferences, saveHudPreferences } from '../src/domain/gaolao-hud-preferences.ts';

test('首次进入与损坏存储均使用任务/地图收起、工具栏展开的安全默认值', () => {
  const expected = { guidanceExpanded: false, mapExpanded: false, dockExpanded: true };
  assert.deepEqual(readHudPreferences(), expected);
  for (const raw of [null, '坏的JSON', 'null', '[]', '42']) {
    assert.deepEqual(readHudPreferences({ getItem: () => raw }), expected);
  }
  assert.deepEqual(readHudPreferences({ getItem() { throw new Error('存储被禁用'); } }), expected);
});

test('只恢复明确的布尔显示偏好，不接受世界状态或错误类型', () => {
  const raw = JSON.stringify({ guidanceExpanded: true, mapExpanded: 'true', dockExpanded: false, selectedRef: '旧授权对象', position: { x: 1, y: 2 } });
  assert.deepEqual(readHudPreferences({ getItem: key => { assert.equal(key, HUD_PREFERENCES_KEY); return raw; } }), {
    guidanceExpanded: true, mapExpanded: false, dockExpanded: false,
  });
});

test('明确的开合选择可恢复，写入失败不影响本次界面操作', () => {
  const saved = new Map();
  const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  const preference = { guidanceExpanded: true, mapExpanded: true, dockExpanded: false };
  assert.equal(saveHudPreferences(storage, { ...preference, actorRef: '不应持久化' }), true);
  assert.deepEqual(readHudPreferences(storage), preference);
  assert.deepEqual(JSON.parse(saved.get(HUD_PREFERENCES_KEY)), preference);
  assert.equal(saveHudPreferences({ setItem() { throw new Error('配额不足'); } }, preference), false);
  assert.equal(saveHudPreferences(undefined, preference), false);
});
