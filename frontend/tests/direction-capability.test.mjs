import test from 'node:test';
import assert from 'node:assert/strict';
import { negotiatedSpatialLink } from '../src/network/direction-capability.ts';

function fixture(enabled = true, timed = false) {
  const attempts = [], events = [];
  const link = negotiatedSpatialLink({ connected: () => events.push('connected'), disconnected: () => events.push('disconnected'), batch: value => events.push(value), failed: value => events.push(value) }, enabled, (handlers, capabilities) => {
    const transport = { connected: false, closed: false, request: async (event, value) => ({ event, value }), close() { this.closed = true; this.connected = false; } };
    attempts.push({ handlers, capabilities, transport }); return transport;
  }, timed);
  return { link, attempts, events, connect(index = attempts.length - 1) { attempts[index].transport.connected = true; attempts[index].handlers.connected(); } };
}
test('DIR-CLIENT：只有明确新cap且本次握手成功后启用，断开即清除', () => {
  const f = fixture(); assert.deepEqual(f.link.acceptedCapabilities, []); assert.ok(f.attempts[0].capabilities.includes('spatial-direction-v1'));
  f.connect(); assert.ok(f.link.acceptedCapabilities.includes('spatial-direction-v1'));
  f.attempts[0].handlers.disconnected(); assert.deepEqual(f.link.acceptedCapabilities, []); f.link.close();
  const legacy = fixture(false); legacy.connect(); assert.ok(!legacy.link.acceptedCapabilities.includes('spatial-direction-v1')); legacy.link.close();
});
test('DIR-CLIENT：旧服INVALID_MESSAGE只退回一次且旧连接不能迟到获权', async () => {
  const f = fixture(); f.attempts[0].handlers.failed({ code: 'INVALID_MESSAGE' });
  assert.equal(f.attempts.length, 2); assert.ok(f.attempts[0].transport.closed); assert.ok(!f.attempts[1].capabilities.includes('spatial-direction-v1'));
  f.attempts[0].handlers.connected(); assert.deepEqual(f.link.acceptedCapabilities, []);
  f.attempts[1].handlers.failed({ code: 'INVALID_MESSAGE' }); assert.equal(f.attempts.length, 2); assert.equal(f.events.length, 1);
  f.link.close();
});
test('DIR-CLIENT：认证失败或已连接后的错误不触发能力降级', () => {
  const denied = fixture(); denied.attempts[0].handlers.failed({ code: 'UNAUTHENTICATED' }); assert.equal(denied.attempts.length, 1); denied.link.close();
  const connected = fixture(); connected.connect(); connected.attempts[0].handlers.failed({ code: 'INVALID_MESSAGE' }); assert.equal(connected.attempts.length, 1); connected.link.close();
});
test('TIME-03：timed独立显式启用且依赖direction，初始兼容退回同时去掉两项', () => {
  const directionOnly = fixture(); directionOnly.connect(); assert.ok(!directionOnly.link.acceptedCapabilities.includes('spatial-timed-trail-v1')); directionOnly.link.close();
  const noDirection = fixture(false, true); noDirection.connect(); assert.ok(!noDirection.link.acceptedCapabilities.includes('spatial-timed-trail-v1')); noDirection.link.close();
  const timed = fixture(true, true); assert.ok(timed.attempts[0].capabilities.includes('spatial-timed-trail-v1')); assert.deepEqual(timed.link.acceptedCapabilities, []);
  timed.attempts[0].handlers.failed({ code: 'INVALID_MESSAGE' }); assert.equal(timed.attempts.length, 2);
  assert.ok(!timed.attempts[1].capabilities.includes('spatial-timed-trail-v1')); assert.ok(!timed.attempts[1].capabilities.includes('spatial-direction-v1'));
  timed.connect(); assert.ok(!timed.link.acceptedCapabilities.includes('spatial-timed-trail-v1')); timed.link.close();
  const accepted = fixture(true, true); accepted.connect(); assert.ok(accepted.link.acceptedCapabilities.includes('spatial-timed-trail-v1')); accepted.link.close();
});
