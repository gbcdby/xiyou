import assert from 'node:assert/strict';
import test from 'node:test';
import { browserRoom } from './gaolao-real-support.mjs';

// 此替身仅检查 harness 的写入能力边界，不提供真实页面或本人选择证据。
function fixture() {
  const calls = { context: [], bind: [], observe: [], reserve: [], submit: [], close: [] };
  let phase = 'Lobby', nextPlayer = 0;
  const browser = {
    async newContext() {
      const player = nextPlayer++;
      calls.context.push(player);
      let url = 'http://harness.invalid/';
      const locator = name => ({
        fill: async () => {}, selectOption: async () => {}, waitFor: async () => {},
        getByRole: (_role, options = {}) => locator(options.name),
        click: async () => { if (name === '开始同行（房主）') phase = 'Running'; },
      });
      const page = {
        setDefaultTimeout() {}, on() {},
        goto: async value => { url = value; },
        waitForURL: async () => { url = 'http://harness.invalid/spatial/profile-contract'; },
        url: () => url,
        getByLabel: name => locator(name),
        getByRole: (_role, options = {}) => locator(options.name),
        locator: name => locator(name),
        evaluate: async () => ({
          userId: `profile-player-${player}`, token: `profile-token-${player}`,
          inputReady: true, projection: { phase, paused: false },
        }),
      };
      return { newPage: async () => page, close: async () => { calls.close.push(player); } };
    },
  };
  const runtime = {
    async bindInternal(sessionId, actorId, kind) {
      const handle = Object.freeze({ actorId, kind });
      calls.bind.push({ sessionId, actorId, kind, handle });
      return handle;
    },
    async observeInternal(handle) { calls.observe.push(handle); throw new Error('此边界样本不应读取内部角色'); },
    async reserveSpatialIntent(handle, intentId, action) {
      calls.reserve.push({ handle, intentId, action }); return { action };
    },
    async submitSpatialIntent(handle, intentId) {
      calls.submit.push({ handle, intentId }); return { status: 'Accepted', code: 'OK' };
    },
  };
  const report = { pageErrors: [], recapResponses: [], npcActions: [], humanActions: [] };
  return { calls, runtime, report, options: {
    server: { runtime }, browser, baseURL: 'http://harness.invalid', count: 2,
    // 仅使用已注册内容检查适配器；此处不冒称新 v3 产品流程运行。
    contentVersion: 'gaolaozhuang-scene-v2', report,
  } };
}

test('生产 profile 只为三自主 NPC 建写 handle，翠兰和其他 scene 人物不进入适配器', async () => {
  const f = fixture();
  const room = await browserRoom({ ...f.options, profile: 'production-cuilan-v1' });
  assert.deepEqual(f.calls.bind.map(({ actorId, kind }) => ({ actorId, kind })).sort((a, b) => a.actorId.localeCompare(b.actorId)), [
    { actorId: 'gz-bajie', kind: 'core_npc' },
    { actorId: 'gz-tang', kind: 'core_npc' },
    { actorId: 'gz-wukong', kind: 'core_npc' },
  ]);
  await room.close();
});

test('生产 profile 的已捕获动作闭包不能经外层覆盖或 actor 表注入代答/移动翠兰', async () => {
  const f = fixture();
  const room = await browserRoom({ ...f.options, profile: 'production-cuilan-v1' });
  const captured = Object.fromEntries(['send', 'move', 'go', 'interact', 'entity', 'snapshot'].map(key => [key, room[key]]));
  let outerCalls = 0;
  room.send = async () => { outerCalls++; return { status: 'Accepted' }; };
  room.profile = 'legacy-controlled-v1';
  // 若内部闭包仍共享返回的可写表，已知 scene handle 会绕过外层方法封装。
  room.actors ??= new Map();
  for (const key of ['cuilan', 'gao', 'witness', 'unknown']) room.actors.set(key, { handle: { actorId: 'gz-cuilan', kind: 'scene_role' }, internal: true });
  room.actors.set('wukong', { handle: { actorId: 'gz-cuilan', kind: 'scene_role' }, internal: true });
  const denied = /生产 profile 不允许操作该角色/;
  for (const key of ['cuilan', 'gao', 'witness', 'unknown']) {
    await assert.rejects(captured.send(key, { kind: 'interact', operationId: 'gz-respond-appearance' }), denied);
    await assert.rejects(captured.move(key, 'gaolao-courtyard', { x: 100, y: 100 }), denied);
    await assert.rejects(captured.go(key, { sceneId: 'gaolao-courtyard', position: { x: 100, y: 100 } }), denied);
    await assert.rejects(captured.interact(key, 'self', 'gz-respond-appearance', { decision: 'accepted' }), denied);
    await assert.rejects(captured.entity(key, '翠兰'), denied);
    await assert.rejects(captured.snapshot(key), denied);
  }
  assert.equal(outerCalls, 0, '拒绝必须发生在闭包内部，而不是替换后的 room.send');
  assert.deepEqual(f.calls.observe, [], '禁用角色不得借内部观察取得可写 handle 或动作引用');
  assert.deepEqual(f.calls.reserve, [], '禁用角色的意图不得进入 reserve');
  assert.deepEqual(f.calls.submit, [], '禁用角色的意图不得进入 submit');
  await captured.send('wukong', { kind: 'interact', operationId: 'gz-open-door' });
  assert.equal(f.calls.reserve.length, 1);
  assert.equal(f.calls.reserve[0].handle.actorId, 'gz-wukong', '返回对象的 actor 表不能把已允许角色替换成翠兰');
  assert.equal(f.calls.submit[0].handle.actorId, 'gz-wukong');
  await room.close();
});

test('生产 profile 保留三自主 NPC 的 reserve/submit 分派，并在证据中明确 profile', async () => {
  const f = fixture();
  const room = await browserRoom({ ...f.options, profile: 'production-cuilan-v1' });
  assert.equal(room.actors, undefined, '生产适配器不得交出内部写 handle');
  assert.equal(room.runtime, undefined, '生产适配器不得交出任意 bind/reserve 通路');
  for (const role of ['tang', 'wukong', 'bajie']) {
    const receipt = await room.send(role, { kind: 'speak', channel: 'local', text: '适配器契约样本' });
    assert.equal(receipt.status, 'Accepted');
  }
  assert.deepEqual(f.calls.reserve.map(call => call.handle.actorId), ['gz-tang', 'gz-wukong', 'gz-bajie']);
  assert.deepEqual(f.calls.submit.map(call => call.intentId), f.calls.reserve.map(call => call.intentId));
  assert.equal(new Set(f.calls.reserve.map(call => call.intentId)).size, 3);
  assert.deepEqual(f.report.npcActions.map(({ profile, role }) => ({ profile, role })), [
    { profile: 'production-cuilan-v1', role: 'tang' },
    { profile: 'production-cuilan-v1', role: 'wukong' },
    { profile: 'production-cuilan-v1', role: 'bajie' },
  ]);
  assert.deepEqual(f.report.harnessProfiles, [{
    sessionId: room.sessionId, count: 2, profile: 'production-cuilan-v1',
    expectedContentVersion: 'gaolaozhuang-scene-v2', controlledNpcRoles: ['tang', 'wukong', 'bajie'],
  }]);
  await room.close();
  assert.deepEqual(f.calls.close, [0, 1]);
});

test('legacy 默认与显式 profile 都保留既有全部受控 NPC 通路，并明确旧证据范围', async () => {
  for (const profile of [undefined, 'legacy-controlled-v1']) {
    const f = fixture();
    const room = await browserRoom({ ...f.options, contentVersion: undefined, profile });
    assert.equal(room.content.contentVersion, 'gaolaozhuang-v1', '未指定版本的旧调用保持旧内容');
    assert.equal(room.profile, 'legacy-controlled-v1');
    assert.equal(room.runtime, f.runtime);
    assert.deepEqual(f.calls.bind.map(call => call.actorId).sort(), ['gz-bajie', 'gz-cuilan', 'gz-gao', 'gz-tang', 'gz-witness', 'gz-wukong']);
    assert.equal(room.actors.get('cuilan').handle.kind, 'scene_role');
    assert.equal((await room.send('cuilan', { kind: 'interact', operationId: 'gz-respond-appearance' })).status, 'Accepted');
    assert.equal(f.calls.reserve[0].handle.actorId, 'gz-cuilan');
    assert.equal(f.report.npcActions[0].profile, 'legacy-controlled-v1');
    assert.equal(f.report.harnessProfiles[0].expectedContentVersion, 'gaolaozhuang-v1');
    await room.close();
  }
});

test('未知 profile 和未显式固定内容的生产 profile 在创建浏览器/绑定角色前失败', async () => {
  const unknown = fixture();
  await assert.rejects(browserRoom({ ...unknown.options, profile: 'production-cuilan-typo' }), /未知高老庄浏览器 profile/);
  assert.deepEqual(unknown.calls.context, []);
  assert.deepEqual(unknown.calls.bind, []);
  const missingContent = fixture();
  await assert.rejects(browserRoom({ ...missingContent.options, contentVersion: undefined, profile: 'production-cuilan-v1' }), /生产 profile 必须显式固定内容版本/);
  assert.deepEqual(missingContent.calls.context, []);
  assert.deepEqual(missingContent.calls.bind, []);
});

test('重启后重绑仍使用最初固定三角色，返回内容对象不能把悟空替换为翠兰', async () => {
  const f = fixture();
  const room = await browserRoom({ ...f.options, profile: 'production-cuilan-v1' });
  room.content.chapterRules.people.wukong = 'gz-cuilan';
  room.content.npcs.find(row => row.characterId === 'gz-cuilan').actorKind = 'persistent_core';
  await room.rebindControlledNpcs(['cuilan']);
  assert.deepEqual(f.calls.bind.slice(3).map(row => row.actorId), ['gz-tang', 'gz-wukong', 'gz-bajie']);
  await assert.rejects(room.send('cuilan', { kind: 'speak', text: '禁止代答' }), /生产 profile 不允许操作该角色/);
  await room.send('wukong', { kind: 'speak', text: '受控悟空' });
  assert.equal(f.calls.reserve[0].handle.actorId, 'gz-wukong');
  await room.close();
});
