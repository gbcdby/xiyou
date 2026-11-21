import test from 'node:test';
import assert from 'node:assert/strict';
import { validateContract } from '../../protocol/index.mjs';
import { authorizedSnapshotFixture } from './fixtures/authorized-snapshot.ts';

test('组件测试快照遵守授权契约，不携带内部受众或NPC信念', () => {
  const snapshot = authorizedSnapshotFixture();
  assert.equal(validateContract('AuthorizedSnapshot', snapshot).sessionId, 'ui-component-fixture');
  assert.ok(snapshot.projection.observations.every(item => item.observerId === snapshot.projection.self.characterId));
  assert.equal(Object.hasOwn(snapshot.projection, 'beliefs'), false);
  assert.equal(Object.hasOwn(snapshot.projection, 'audience'), false);
});
