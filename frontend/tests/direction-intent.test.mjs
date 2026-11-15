import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectionIntent } from '../src/domain/direction-intent.ts';

const flush = () => new Promise(resolve => setImmediate(resolve));
function clock() {
  let now = 0, serial = 0; const jobs = new Map();
  return { now: () => now, setTimeout(fn, ms) { jobs.set(++serial, { fn, at: now + ms }); return serial; }, clearTimeout(id) { jobs.delete(id); }, async advance(to) {
    for (;;) { const next = [...jobs].sort((a, b) => a[1].at - b[1].at).find(([, v]) => v.at <= to); if (!next) break;
      jobs.delete(next[0]); now = next[1].at; next[1].fn(); await flush(); }
    now = to; await flush();
  } };
}

test('DIR-CLIENT：旧Accepted回执未到时抢先改向，旧拒绝不能停掉新方向', async t => {
  const time = clock(), calls = [], complete = [];
  const input = new DirectionIntent({ clock: time, send: vector => { calls.push({ vector, at: time.now() }); return new Promise(resolve => complete.push(resolve)); }, stop: async () => { calls.push('stop'); } });
  t.after(() => input.clear());
  input.set({ x: 1, y: 1 }); await flush(); await time.advance(50); input.set({ x: 0, y: 1 }); await flush();
  assert.equal(calls.length, 2); assert.deepEqual(calls[1], { vector: { x: 0, y: 1 }, at: 50 });
  complete[1]('accepted'); complete[0]('rejected'); await flush(); await time.advance(150);
  assert.equal(calls.filter(x => x === 'stop').length, 0); assert.deepEqual(calls[2].vector, { x: 0, y: 1 });
});

test('DIR-CLIENT：两槽满只保留最新意图，全松stop不等待两条旧回执', async t => {
  const time = clock(), calls = [], complete = [];
  const input = new DirectionIntent({ clock: time, send: vector => { calls.push(vector); return new Promise(resolve => complete.push(resolve)); }, stop: async () => { calls.push('stop'); } });
  t.after(() => input.clear());
  input.set({ x: 1, y: 0 }); input.set({ x: 0, y: 1 }); await flush();
  for (let i = 0; i < 20; i++) input.set({ x: i % 2 ? -1 : 1, y: 0 });
  await time.advance(150); assert.equal(calls.length, 2);
  complete[0]('accepted'); await flush(); assert.equal(calls.length, 3); assert.deepEqual(calls[2], { x: -1, y: 0 });
  input.set(null); await flush(); assert.equal(calls.at(-1), 'stop');
  complete[1]('accepted'); complete[2]('accepted'); await flush(); await time.advance(500);
  assert.equal(calls.length, 4, '迟到回执不恢复已取消持键');
});

test('DIR-CLIENT：原请求400ms未定案只发一次stop并冻结，不积压续发', async t => {
  const time = clock(), calls = [], errors = [];
  const input = new DirectionIntent({ clock: time, send: async () => { calls.push('move'); return new Promise(() => {}); }, stop: async () => { calls.push('stop'); }, fail: message => errors.push(message) });
  t.after(() => input.clear()); input.set({ x: 1, y: 0 }); await time.advance(1000); input.set({ x: 0, y: 1 }); await time.advance(2000);
  assert.deepEqual(calls, ['move', 'stop']); assert.equal(errors.length, 1);
});

test('D66-CLIENT-01：原stop在途时重复全松只合并意图，确认后续发最新持键', async t => {
  for (const ending of ['及时确认', '超时后确认', '明确清除']) await t.test(ending, async t => {
    const time = clock(), calls = []; let finishStop;
    const input = new DirectionIntent({ clock: time, send: async vector => { calls.push({ kind: 'move', at: time.now(), vector }); return 'accepted'; },
      stop: () => { calls.push({ kind: 'stop', at: time.now() }); return new Promise(resolve => { finishStop = resolve; }); } });
    t.after(() => input.clear());
    input.set({ x: 1, y: 0 }); await flush();
    await time.advance(20); input.set(null); await flush();
    await time.advance(30); input.set({ x: 0, y: 1 });
    await time.advance(40); input.set(null);
    await time.advance(50); input.set({ x: 1, y: 0 });
    if (ending === '明确清除') input.clear();
    await time.advance(ending === '超时后确认' ? 450 : 60); finishStop(); await flush(); await time.advance(700);
    const resumed = calls.filter(call => call.kind === 'move' && call.at >= 60);
    assert.equal(calls.filter(call => call.kind === 'stop').length, 1);
    if (ending === '及时确认') { assert.ok(resumed.length > 0); assert.deepEqual(resumed[0].vector, { x: 1, y: 0 }); }
    else assert.equal(resumed.length, 0, '未知/取消代次的迟到stop不能恢复持键');
  });
});
