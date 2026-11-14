import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpApi, ApiFailure } from '../src/network/http-api.ts';

test('空间创建与加入声明能力，旧成员响应仍路由到原玩法', async () => {
  const calls = []; let legacy = false;
  const api = new HttpApi(() => 'token', async (url, init) => { calls.push({ url, init }); return Response.json(url.endsWith('/join') && legacy ? { sessionId: 'old-room', actorId: 'old-character' } : { sessionId: 'new-room' }); });
  await api.createSpatial('create-once');
  assert.deepEqual(JSON.parse(calls[0].init.body), { nonce: 'create-once', contentVersion: 'spatial-graybox-v2', capabilities: ['spatial-v2', 'spatial-appearance-v1', 'spatial-object-visual-v1'] });
  assert.equal(calls[0].init.headers['X-Xiyou-Capabilities'], 'spatial-v2,spatial-appearance-v1,spatial-object-visual-v1');
  assert.deepEqual(await api.joinCompatible('new-room', 'join-once'), { sessionId: 'new-room', protocolCapability: 'spatial-v2' });
  legacy = true; assert.deepEqual(await api.joinCompatible('old-room', 'join-old'), { sessionId: 'old-room', protocolCapability: 'region-v1' });
});

test('空间收据查询声明能力，升级和撤权错误保持可辨别且不当作未知结果', async () => {
  let code = 'UPGRADE_REQUIRED'; let seen;
  const api = new HttpApi(() => 'token', async (_url, init) => { seen = init; return Response.json({ schemaVersion: 2, code, message: '请使用当前版本。', ...(code === 'UPGRADE_REQUIRED' ? { requiredCapabilities: ['spatial-v2'] } : {}) }, { status: code === 'UPGRADE_REQUIRED' ? 426 : 404 }); });
  await assert.rejects(api.spatialReceipt('room', 'action'), e => e instanceof ApiFailure && e.code === 'UPGRADE_REQUIRED');
  assert.equal(seen.headers['X-Xiyou-Capabilities'], 'spatial-v2,spatial-appearance-v1,spatial-object-visual-v1');
  code = 'SESSION_GONE'; await assert.rejects(api.spatialReceipt('room', 'action'), e => e.code === 'SESSION_GONE');
});
