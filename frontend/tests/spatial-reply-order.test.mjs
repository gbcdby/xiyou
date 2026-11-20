import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { connectSocket } from '../src/network/socket-link.ts';

test('SUP-03：真实Socket同turn ACK先同步消费再push，hook异常收束Promise且不逃逸listener', async t => {
  const http = createServer(), io = new Server(http, { path: '/socket.io' }); let link, deadline, pushDeadline, receivedPush;
  const pushed = new Promise(resolve => { receivedPush = resolve; });
  t.after(async () => { clearTimeout(deadline); clearTimeout(pushDeadline); link?.close(); await new Promise(resolve => io.close(resolve)); });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  io.on('connection', socket => socket.on('sync.request', (raw, ack) => { ack({ through: '45' }); socket.emit('world.batch', { through: '48' }); }));
  const order = [];
  await new Promise((resolve, reject) => {
    deadline = setTimeout(() => reject(new Error('回环未连接')), 2000);
    link = connectSocket('reply-fixture', { connected: resolve, disconnected() {}, failed: reject, batch: value => { order.push(`push${value.through}`); receivedPush(); } }, `http://127.0.0.1:${http.address().port}`);
  }); clearTimeout(deadline);
  await link.request('sync.request', '{}', value => order.push(`ack${value.through}`)); order.push('continuation');
  await Promise.race([pushed, new Promise((_, reject) => { pushDeadline = setTimeout(() => reject(new Error('回环未收到push')), 2000); })]); clearTimeout(pushDeadline);
  assert.ok(order.indexOf('ack45') >= 0 && order.indexOf('ack45') < order.indexOf('push48'));
  assert.ok(order.indexOf('ack45') < order.indexOf('continuation'), 'ACK应用必须早于Promise续体；传输到达可跨事件轮次');
  await assert.rejects(link.request('sync.request', '{}', () => { throw new Error('受控消费失败'); }), /受控消费失败/);
  assert.equal(link.connected, true); assert.deepEqual(await link.request('sync.request', '{}'), { through: '45' });
});
