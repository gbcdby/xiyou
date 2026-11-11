import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpApi } from '../src/network/http-api.ts';

test('收据 404 保持结果未知，HTTP 只携带登录身份而不声明连接身份', async () => {
  const requests = [];
  const api = new HttpApi(() => 'guest-token', async (path, init) => {
    requests.push({ path, init });
    return new Response(JSON.stringify({ schemaVersion: 1, code: 'OUTCOME_UNKNOWN' }), { status: 404 });
  });
  assert.equal(await api.receipt('session-one', 'action-old'), null);
  assert.equal(requests[0].path, '/api/sessions/session-one/actions/action-old');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer guest-token');
  assert.equal(JSON.stringify(requests).includes('connectionId'), false);
});

test('不可达服务会明确失败，不生成房间、身份或成功回执', async () => {
  const api = new HttpApi(() => null, async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(api.guest('青禾'), error => error.code === 'NETWORK_UNAVAILABLE');
  await assert.rejects(api.rooms(), error => error.code === 'NETWORK_UNAVAILABLE');
});
