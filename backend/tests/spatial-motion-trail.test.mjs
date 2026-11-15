import test from 'node:test';
import assert from 'node:assert/strict';
import { executedSelfTrail } from '../spatial-motion-trail.mjs';

const P = { x: 10, y: 20 }, Q = { x: 15, y: 20 }, R = { x: 15, y: 25 };
const motion = (from, through, trail) => ({ viewId: 'view', sceneId: 'yard', appearanceEpoch: '0', motionFromSceneTimeMs: from, motionThroughSceneTimeMs: through, motionTrail: trail });
const actor = (position, status = null, value) => ({ characterId: 'actor', sceneId: 'yard', controlEpoch: '2', appearanceEpoch: '0', position, movement: status ? { status } : null, ...(value ? { publicMotionViews: { actor: value } } : {}) });
const step = (position, status, value) => ['spatial.actor', { actor: actor(position, status, value) }];
const clock = sceneTimeMs => ['spatial.clock', { sceneTimeMs, paused: false }];
const span = (kind, fromSceneTimeMs, throughSceneTimeMs, fromTrailIndex, throughTrailIndex) => ({ kind, fromSceneTimeMs, throughSceneTimeMs, fromTrailIndex, throughTrailIndex });
async function build(steps, { from = 0, active = false, timed = true, alterRows } = {}) {
  const first = { mapVersion: 'map', sceneTimeMs: from, characters: { actor: actor({ ...P }, active ? 'accepted' : null) }, views: { actor: { viewId: 'view', bindings: { actor: { ref: 'R' + 'a'.repeat(32) } } } } };
  const last = structuredClone(first), rows = steps.map(([kind, payload], i) => {
    if (kind === 'spatial.actor') last.characters.actor = structuredClone(payload.actor);
    if (kind === 'spatial.clock') last.sceneTimeMs = payload.sceneTimeMs;
    return { event: { sessionId: 'room', sessionSeq: String(41 + i), kind, payload } };
  });
  alterRows?.(rows);
  const runtime = { stateAt: async () => structuredClone(first) };
  const tx = { client: { query: async sql => { assert.match(sql, /^SELECT event,event_text_encoding FROM world_events/); return { rows }; } } };
  return executedSelfTrail(runtime, tx, 'actor', { sessionId: 'room', viewId: 'view', cursor: '40' }, String(40 + steps.length), last, { timed });
}

test('D66-TIME-01：原34→175静止和175→203移动保持分段，方向-only旧输出不变', async () => {
  const steps = [clock(94), clock(175), step(P, 'accepted'), step(Q, 'moving', motion(175, 203, [P, Q])), clock(203)];
  const value = await build(steps, { from: 34 });
  assert.deepEqual(value.motionTrail, [P, Q]);
  assert.deepEqual(value.motionTimeline, [span('hold', 34, 175, 0, 0), span('motion', 175, 203, 0, 1)]);
  const old = await build(steps, { from: 34, timed: false });
  assert.deepEqual(old, { motionTrail: [P, Q], motionFromSceneTimeMs: 34, motionThroughSceneTimeMs: 203 });
});
test('D66-TIME-02：中途与尾部静止留在原点，复制的旧运动记录不重复', async () => {
  const first = motion(0, 20, [P, Q]), second = motion(70, 90, [Q, R]);
  const value = await build([step(Q, 'moving', first), clock(20), step(Q, 'cancelled', first), clock(70), step(Q, 'accepted', first), step(R, 'moving', second), clock(90), step(R, 'cancelled', second), clock(110)], { active: true });
  assert.deepEqual(value.motionTrail, [P, Q, R]);
  assert.deepEqual(value.motionTimeline, [span('motion', 0, 20, 0, 1), span('hold', 20, 70, 1, 1), span('motion', 70, 90, 1, 2), span('hold', 90, 110, 2, 2)]);
});
test('D66-TIME-02：纯静止、零跨度与原零几何运动可区分', async () => {
  const held = await build([clock(100)]); assert.deepEqual(held.motionTrail, [P, P]); assert.deepEqual(held.motionTimeline, [span('hold', 0, 100, 0, 1)]);
  const zero = await build([step(P, 'accepted')]); assert.deepEqual(zero.motionTimeline, [span('hold', 0, 0, 0, 1)]);
  const moving = await build([step(P, 'moving', motion(0, 10, [P, P])), clock(10)], { active: true });
  assert.deepEqual(moving.motionTimeline, [span('motion', 0, 10, 0, 1)], '原零几何执行区间不能变成可抵扣hold');
});
test('D66-TIME-02：同端点折返仍包含真实中间路线', async () => {
  const value = await build([step(P, 'moving', motion(0, 20, [P, Q, P])), clock(20)], { active: true });
  assert.deepEqual(value.motionTrail, [P, Q, P]); assert.deepEqual(value.motionTimeline, [span('motion', 0, 20, 0, 2)]);
});
test('D66-TIME-02：缺执行记录、时间缺口和零时间位移不能猜成hold', async () => {
  for (const steps of [[clock(20)], [step(Q, 'moving', motion(10, 20, [P, Q])), clock(20)], [step(Q, 'moving', motion(0, 0, [P, Q]))], [step(Q, 'moving'), clock(20)]]) {
    await assert.rejects(build(steps, { active: true }), { code: 'RESYNC_REQUIRED' });
  }
  await assert.rejects(build([clock(20)], { alterRows: rows => { rows[0].event.sessionSeq = '42'; } }), { code: 'RESYNC_REQUIRED' });
});
test('D66-TIME-02：身份边界不跨接，超4096段不截断', async () => {
  for (const field of ['sceneId', 'controlEpoch', 'appearanceEpoch']) {
    const changed = step(P, null); changed[1].actor[field] = 'changed'; assert.equal(await build([changed]), null);
  }
  const steps = [];
  for (let i = 0; i < 4097; i++) steps.push(step(P, 'moving', motion(i, i + 1, [P, P])), clock(i + 1));
  await assert.rejects(build(steps, { active: true }), { code: 'RESYNC_REQUIRED' });
});
