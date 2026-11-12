import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createRuntime } from '../runtime.mjs';
import { accepted, gaolaoRoom, rescue, cleanupPublic } from '../test-support/gaolao-room.mjs';
import { clearSegment, walkable } from '../../game/spatial-geometry.mjs';
import { obstacleEnabled } from '../../game/spatial-world.mjs';
import { validateSpatial } from '../../protocol/spatial.mjs';

let db, runtime;
const clock = { value: Date.parse('2026-11-12T19:00:00Z') };
before(async () => {
    db = await startTestPostgres('gaolao-navigation-rounding', { outputSubdirectory: 'a2-navigation-rounding' });
    runtime = await createRuntime({ pool: db.pool, now: () => clock.value });
});
after(async () => { await runtime?.close(); await db?.stop(); });

test('真实PG R32REQ005：原受信意图经过 1874ms 检查点后实际到达，不靠新意图恢复', async t => {
    const r = await gaolaoRoom(runtime, clock, 2);
    await rescue(r);
    await cleanupPublic(r);
    const id = r.content.chapterRules.people.wukong, handle = r.actors.get('wukong').handle;
    const before = await runtime.replay(r.sessionId), scene = r.content.scenes.find(s => s.sceneId === before.characters[id].sceneId);
    assert.deepEqual(before.characters[id].position, { x: 1250, y: 425 });
    const intentId = crypto.randomUUID();
    await runtime.reserveSpatialIntent(handle, intentId, { kind: 'move_to', sceneId: r.C('C19').sceneId, destination: r.C('C19').position });
    const receipt = accepted(await runtime.submitSpatialIntent(handle, intentId));
    const plan = (await runtime.replay(r.sessionId)).characters[id].movement;
    assert.ok(plan.path.slice(1).every((p, i) => clearSegment(scene, plan.path[i], p, obstacleEnabled(before))));
    await r.step(1874);
    const middle = await runtime.replay(r.sessionId), actor = middle.characters[id];
    assert.equal(actor.movement.status, 'moving', actor.movement.reason);
    assert.equal(actor.movement.movementId, plan.movementId);
    assert.ok(walkable(scene, actor.position, obstacleEnabled(middle)));
    assert.deepEqual(middle.targets, before.targets);
    assert.deepEqual(middle.chapter.consents, before.chapter.consents);
    validateSpatial('ProjectionV2', (await r.snapshot('wukong')).projection);
    await r.step(1000);
    const final = await runtime.replay(r.sessionId), arrived = final.characters[id];
    assert.equal(arrived.movement.status, 'arrived');
    assert.equal(arrived.movement.movementId, plan.movementId);
    assert.equal(arrived.position.x, r.C('C19').position.x);
    assert.equal(arrived.position.y, r.C('C19').position.y);
    assert.deepEqual(await runtime.submitSpatialIntent(handle, intentId), receipt);
    assert.deepEqual(final, (await db.pool.query('SELECT state FROM sessions WHERE session_id=$1', [r.sessionId])).rows[0].state);
    t.diagnostic(JSON.stringify({ scope: '真实PG/Runtime，受控场景时间；不是900秒浏览器验收', sessionId: r.sessionId, intentId, receipt: receipt.status, movementId: plan.movementId, path: plan.path, checkpointMs: 1874, checkpoint: { position: actor.position, status: actor.movement.status }, final: { position: arrived.position, status: arrived.movement.status }, targetsAndConsentsUnchanged: true }));
});
