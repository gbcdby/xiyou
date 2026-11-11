import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { connectSocket } from '../src/network/socket-link.ts';

test('真实传输入口可指定 Node 服务地址，仍使用 token 握手和原始动作字符串', async t => {
  const http = createServer();
  const io = new Server(http, { path: '/socket.io' });
  let link; let deadline;
  t.after(async () => { clearTimeout(deadline); link?.close(); await new Promise(resolve => io.close(resolve)); });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  let observedToken; let observedRaw;
  io.on('connection', socket => {
    observedToken = socket.handshake.auth.token;
    socket.on('player.action.request', (raw, acknowledge) => { observedRaw = raw; acknowledge({ received: true }); });
  });
  const connected = new Promise((resolve, reject) => {
    deadline = setTimeout(() => reject(new Error('真实传输未连接到指定 origin。')), 2000);
    link = connectSocket('transport-fixture-token', {
      connected: resolve, disconnected() {}, batch() {},
      failed: error => reject(new Error(`真实传输握手失败：${JSON.stringify(error)}`)),
    }, `http://127.0.0.1:${http.address().port}`);
  });
  await connected; clearTimeout(deadline);
  const raw = '{"clientActionId":"unchanged","baseSeq":"1","controlEpoch":"2"}';
  assert.deepEqual(await link.request('player.action.request', raw), { received: true });
  assert.equal(observedToken, 'transport-fixture-token');
  assert.equal(observedRaw, raw);
  assert.equal(link.connected, true);
});
