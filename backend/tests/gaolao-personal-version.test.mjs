import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createRuntime } from '../runtime.mjs';
import { gaolaoRoom } from '../test-support/gaolao-room.mjs';
import { ownPersonalSource } from '../../game/gaolao-personal-contract.mjs';

let db, runtime;
const clock = { value: Date.parse('2026-11-14T09:00:00Z') };
const caps = ['spatial-v2', 'gaolao-personal-consent-v1'];
before(async () => { db = await startTestPostgres('gaolao-personal-version', { outputSubdirectory: 'cuilan-authority-implement' }); runtime = await createRuntime({ pool: db.pool, now: () => clock.value }); });
after(async () => { await runtime?.close(); await db?.stop(); });

test('新内容真实创建/加入/订阅/读取以独立 capability 围栏，旧内容仍可访问', async () => {
  const first = await runtime.guest({ name: '版本检查甲' }), second = await runtime.guest({ name: '版本检查乙' });
  await assert.rejects(runtime.create(first.token, { nonce: crypto.randomUUID(), contentVersion: 'gaolaozhuang-scene-v3', capabilities: ['spatial-v2'] }), { code: 'UPGRADE_REQUIRED' });
  const { sessionId } = await runtime.create(first.token, { nonce: crypto.randomUUID(), contentVersion: 'gaolaozhuang-scene-v3', capabilities: caps });
  await assert.rejects(runtime.join(second.token, sessionId, { nonce: crypto.randomUUID(), capabilities: ['spatial-v2'] }), { code: 'UPGRADE_REQUIRED' });
  await runtime.join(second.token, sessionId, { nonce: crypto.randomUUID(), capabilities: caps });
  await assert.rejects(runtime.snapshot(first.token, sessionId, ['spatial-v2']), { code: 'UPGRADE_REQUIRED' });
  const oldConnection = await runtime.openConnection(first.token, ['spatial-v2']);
  await assert.rejects(runtime.subscribe(oldConnection, sessionId), { code: 'UPGRADE_REQUIRED' });
  const lobby = await runtime.snapshot(first.token, sessionId, caps);
  assert.equal(lobby.projection.reducerVersion, 'gaolao-world-v2');
  assert.deepEqual(lobby.projection.chapter.privateReturns, []);
  assert.deepEqual((await runtime.listSessions(first.token)).find(row => row.sessionId === sessionId).requiredCapabilities, caps);
  const legacy = await runtime.create(first.token, { nonce: crypto.randomUUID(), contentVersion: 'gaolaozhuang-scene-v2', capabilities: ['spatial-v2'] });
  assert.equal((await runtime.snapshot(first.token, legacy.sessionId, ['spatial-v2'])).projection.reducerVersion, 'gaolao-world-v1');
});

for (const contentVersion of ['gaolaozhuang-scene-v3', 'gaolaozhuang-tools-east-scene-v3']) {
  test(`${contentVersion} 开局仅给本人两份持久来源，原事件回放保持精确版本`, async () => {
    const room = await gaolaoRoom(runtime, clock, 2, contentVersion);
    const state = await runtime.replay(room.sessionId), owner = room.content.chapterRules.people.cuilan;
    assert.equal(state.reducerVersion, 'gaolao-world-v2'); assert.equal(state.chapterVersion, 'gaolaozhuang-chapter-v3');
    for (const purpose of ['appearance', 'private_items']) {
      const source = ownPersonalSource(state, room.content, owner, purpose);
      assert.ok(source); assert.ok(BigInt(source.receivedSeq) > 0n);
      assert.equal(ownPersonalSource(state, room.content, state.members[0].characterId, purpose), null);
      const entries = Object.values(state.chapter.provenance[owner]).filter(entry => entry.sourceId === source.sourceId);
      assert.equal(entries.length, 1); assert.equal(entries[0].retainedObservation.shareable, false);
    }
    for (let player = 0; player < 2; player++) {
      const projection = (await room.snapshot(player)).projection;
      assert.deepEqual(projection.chapter.personalRequests, []); assert.deepEqual(projection.chapter.privateReturns, []);
      assert.ok(!JSON.stringify(projection).includes('cuilan-private-items-v1'));
    }
    const stored = (await db.pool.query('SELECT state,content_snapshot,reducer_version FROM sessions WHERE session_id=$1', [room.sessionId])).rows[0];
    assert.equal(stored.reducer_version, 'gaolao-world-v2'); assert.equal(stored.content_snapshot.contentVersion, contentVersion);
  });
}
