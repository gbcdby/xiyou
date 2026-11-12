import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpatial, MovementCommandSource } from '../spatial.mjs';

const envelope = action => ({ schemaVersion: 2, sessionId: 'session', viewId: 'view', actorRef: 'ref-12345678901234567890123456789012', clientActionId: 'action', controlEpoch: '1', baseSeq: '0', action });
test('空间命令严格拒绝未知字段、重复键、精度损失和客户端事实', () => {
  const good = JSON.stringify(envelope({ kind: 'move_to', movementCommandSeq: '1', sceneId: 'yard', destination: { x: 10, y: 20 } }));
  assert.equal(parseSpatial('PublicEnvelope', good).action.kind, 'move_to');
  for (const raw of [good.replace('"x":10', '"x":10,"x":20'), good.replace('"x":10', '"x":1.00000000000000001'), good.replace('"x":10', '"x":-1'), good.replace('"x":10', '"x":1000001'), good.replace('"x":10', '"x":10,"__proto__":{}'), JSON.stringify({ ...envelope({ kind: 'wait' }), actorId: 'real-secret' }), JSON.stringify(envelope({ kind: 'advance_world', arrived: true }))]) assert.throws(() => parseSpatial('PublicEnvelope', raw), { code: 'INVALID_MESSAGE' });
});
test('唯一输入源在发出时给移动与停止分配同一递增序号，重试保留原命令', () => {
  const source = new MovementCommandSource('4');
  const first = source.move('yard', { x: 10, y: 20 });
  const stop = source.stop();
  const second = source.move('yard', { x: 40, y: 20 });
  assert.equal(first.movementCommandSeq, '1');
  assert.equal(stop.movementCommandSeq, '2');
  assert.equal(second.movementCommandSeq, '3');
  assert.equal(first.movementCommandSeq, '1');
  assert.equal(source.controlEpoch, '4');
});
