import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { consumeQueuedPacket, enqueueSocketPacket } from '../socket-enqueue.mjs';
import { supplyLoopback } from '../test-support/supply-loopback.mjs';

test('D66-SUP-02：真实ACK/EVENT完整DTO入队证据仅同绑定同类型消费一次', async t => {
  const h = await supplyLoopback(t), binding = {}, value = { fromExclusive: '40', throughSeq: '45', events: [] };
  const slot = await h.reserve(), proof = slot.send(value, binding);
  assert.equal(consumeQueuedPacket(proof, h.handle, binding, value, 'ack'), true);
  assert.equal(consumeQueuedPacket(proof, h.handle, binding, value, 'ack'), false);
  assert.deepEqual(await slot.reply, value);
  const receiving = once(h.client, 'world.batch'), push = h.push(value, binding);
  assert.equal(consumeQueuedPacket(push, h.handle, binding, value, 'push'), true); assert.deepEqual((await receiving)[0], value);
  const wrong = await h.reserve();
  assert.equal(h.enqueue(value, binding, 'ack', () => wrong.ack({ ...value, throughSeq: '48' })), null, '相似marker不等于完整DTO');
  await wrong.reply;
  const channel = await h.reserve();
  assert.equal(h.enqueue(value, binding, 'push', () => channel.ack(value)), null); await channel.reply;
  const other = h.push(value, binding);
  assert.equal(consumeQueuedPacket(other, h.handle, {}, value, 'push'), false, '不得跨binding使用真实证明');
  assert.equal(consumeQueuedPacket(other, h.handle, binding, value, 'push'), false);
});
test('D66-SUP-02：空发送、缺映射、错内容、异常与发送中替换/关闭均不能授权水位', async t => {
  const h = await supplyLoopback(t), binding = {}, value = { throughSeq: '45' };
  for (const send of [undefined, () => {}, () => true, () => { throw new Error('受控编码失败'); }, () => Promise.reject(new Error('异步包装不可作证'))]) assert.equal(h.enqueue(value, binding, 'push', send), null);
  assert.equal(enqueueSocketPacket({ sockets: new Map(), handle: h.handle, binding, value, kind: 'push', send: () => true, current: () => true }), null);
  assert.equal(h.enqueue(value, binding, 'push', () => h.socket.emit('world.batch', value), () => false), null);
  assert.equal(h.enqueue(value, binding, 'push', () => { h.socket.emit('world.batch', value); h.socket.emit('world.batch', value); }), null, '多包不算本项一次入队');
  const replace = () => h.sockets.set(h.handle.connectionId, {});
  h.socket.conn.once('packetCreate', replace);
  assert.equal(h.push(value, binding), null); h.sockets.set(h.handle.connectionId, h.socket);
  h.socket.conn.once('packetCreate', () => h.socket.disconnect(true));
  assert.equal(h.push(value, binding), null);
  assert.equal(h.socket.emit('world.batch', value), true, '库闭合后emit仍返回true');
  assert.equal(h.push(value, binding), null);
});
test('D66-SUP-02：受控背压已入队可未flush，恢复才到达，不能混作peer确认', async t => {
  const h = await supplyLoopback(t), binding = {}, value = { throughSeq: '45' };
  let flushes = 0; const flushed = () => flushes++; h.socket.conn.on('flush', flushed);
  const receiving = once(h.client, 'world.batch'); h.socket.conn.transport.writable = false;
  const proof = h.push(value, binding);
  assert.equal(consumeQueuedPacket(proof, h.handle, binding, value, 'push'), true); assert.equal(flushes, 0);
  h.socket.conn.transport.writable = true; h.socket.emit('flush-marker', {});
  assert.deepEqual((await receiving)[0], value); assert.ok(flushes > 0); h.socket.conn.off('flush', flushed);
});
