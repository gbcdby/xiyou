import test from 'node:test';
import assert from 'node:assert/strict';
import { validateContract } from '../../protocol/index.mjs';
import { demoSnapshot } from '../src/domain/demo.ts';

test('界面示例本身遵守授权快照契约，不携带内部受众或NPC信念', () => {
  const snapshot = demoSnapshot();
  assert.equal(validateContract('AuthorizedSnapshot', snapshot).sessionId, 'ui-demo');
  assert.ok(snapshot.projection.observations.every(item => item.observerId === snapshot.projection.self.characterId));
  assert.equal(Object.hasOwn(snapshot.projection, 'beliefs'), false);
  assert.equal(Object.hasOwn(snapshot.projection, 'audience'), false);
});
