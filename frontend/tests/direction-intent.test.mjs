import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectionIntent } from '../src/domain/direction-intent.ts';
import { DIRECTION_INTERVAL_MS } from '../src/domain/spatial-direction.ts';

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

test('GZ-UX-AC-05：新DirectionIntent的30/60/120Hz重复输入保持相同时刻、预算和两方向一stop上限', async () => {
  const traces = [];
  for (const hz of [30, 60, 120]) {
    const time = clock(), calls = [], pending = new Map(); let serial = 0, held = { x: 1, y: 0 }, moves = 0, stops = 0, maxMoves = 0, maxStops = 0;
    const finish = (id, kind, resolve, result) => { pending.delete(id); if (kind === 'move') moves--; else stops--; resolve(result); };
    const controller = new DirectionIntent({ clock: time,
      send(vector) { const id = ++serial; moves++; maxMoves = Math.max(maxMoves, moves); calls.push({ kind: 'move', at: time.now(), vector });
        return new Promise(resolve => { pending.set(id, 'move'); time.setTimeout(() => finish(id, 'move', resolve, 'accepted'), 180); }); },
      stop() { const id = ++serial; stops++; maxStops = Math.max(maxStops, stops); calls.push({ kind: 'stop', at: time.now() });
        return new Promise(resolve => { pending.set(id, 'stop'); time.setTimeout(() => finish(id, 'stop', resolve), 80); }); },
    });
    const changes = [{ at: 0, vector: { x: 1, y: 0 } }, { at: 500, vector: { x: 1, y: 1 } }, { at: 850, vector: { x: 0, y: 1 } }, { at: 1300, vector: null }];
    const events = [...changes.map(change => ({ ...change, change: true })), ...Array.from({ length: Math.floor(1300 * hz / 1000) }, (_, i) => ({ at: (i + 1) * 1000 / hz, change: false }))]
      .sort((a, b) => a.at - b.at || Number(b.change) - Number(a.change));
    for (const event of events) { await time.advance(event.at); if (event.change) held = event.vector; controller.set(held); await flush(); }
    await time.advance(2000); controller.clear();
    assert.equal(pending.size, 0); assert.ok(maxMoves <= 2 && maxStops <= 1); assert.deepEqual(calls.filter(call => call.kind === 'stop'), [{ kind: 'stop', at: 1300 }]);
    const sent = calls.filter(call => call.kind === 'move');
    for (let end = 0; end < sent.length; end++) for (let start = 0; start <= end; start++) assert.ok(end - start + 1 <= 2 + (sent[end].at - sent[start].at) / DIRECTION_INTERVAL_MS + 1e-8, '相同100ms补充预算，不因帧率增加请求');
    const directions = sent.map(call => Math.abs(call.vector.x) < 1e-8 ? 'S' : Math.abs(call.vector.y) < 1e-8 ? 'E' : 'SE');
    assert.deepEqual(directions.filter((value, index) => !index || value !== directions[index - 1]), ['E', 'SE', 'S']);
    traces.push(calls);
  }
  assert.deepEqual(traces[0], traces[1]); assert.deepEqual(traces[1], traces[2]);
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
  const input = new DirectionIntent({ clock: time, send: async () => { calls.push({ kind: 'move', at: time.now() }); return new Promise(() => {}); }, stop: async () => { calls.push({ kind: 'stop', at: time.now() }); }, fail: message => errors.push(message) });
  t.after(() => input.clear()); input.set({ x: 1, y: 0 }); await time.advance(1000); input.set({ x: 0, y: 1 }); await time.advance(2000);
  assert.deepEqual(calls, [{ kind: 'move', at: 0 }, { kind: 'move', at: 100 }, { kind: 'stop', at: 400 }]); assert.equal(errors.length, 1);
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


test('DS2-01/02：同向按原100ms占用第二槽，原ACK不提前下一次同向续发', async t => {
  const time = clock(), calls = [], complete = [];
  const input = new DirectionIntent({ clock: time,
    send: vector => { calls.push({ vector, at: time.now() }); return new Promise(resolve => complete.push(resolve)); }, stop: async () => {} });
  t.after(() => input.clear());
  input.set({ x: 1, y: 0 }); await flush();
  await time.advance(99); assert.equal(calls.length, 1, '同向不能在100ms前用第二槽');
  await time.advance(100);
  assert.deepEqual(calls, [{ vector: { x: 1, y: 0 }, at: 0 }, { vector: { x: 1, y: 0 }, at: 100 }], '同向原ACK未回也可使用空第二槽');
  await time.advance(180); assert.equal(calls.length, 2, '两条原方向都在途时不得增发');
  complete[0]('accepted'); await flush();
  assert.equal(calls.length, 2, '释放槽不把同向nextAt提前到ACK时刻');
  await time.advance(199); assert.equal(calls.length, 2);
  await time.advance(200); assert.deepEqual(calls[2], { vector: { x: 1, y: 0 }, at: 200 });
  await time.advance(299); assert.equal(calls.length, 3, '第二和第三条占满两个原槽');
  input.clear(); complete[1]('accepted'); complete[2]('accepted'); await flush();
  await time.advance(1000); assert.equal(calls.length, 3, '取消后原回调只收束自己的槽');
});


test('DS2-03/04：两旧同向满槽只续最新改向，旧拒绝不误停而最新拒绝仍停', async t => {
  const time = clock(), calls = [], complete = [];
  const input = new DirectionIntent({ clock: time,
    send: vector => { calls.push({ kind: 'move', vector, at: time.now() }); return new Promise(resolve => complete.push(resolve)); },
    stop: async () => { calls.push({ kind: 'stop', at: time.now() }); } });
  t.after(() => input.clear());
  input.set({ x: 1, y: 0 }); await flush(); await time.advance(100);
  assert.deepEqual(calls.map(call => call.at), [0, 100]);
  await time.advance(110); input.set({ x: 0, y: 1 });
  await time.advance(120); input.set({ x: -1, y: 0 }); await flush();
  assert.equal(calls.length, 2, '两条已发同向不为改向假释放');
  await time.advance(180); complete[1]('accepted'); await flush();
  assert.deepEqual(calls[2], { kind: 'move', vector: { x: -1, y: 0 }, at: 180 }, '只发送当时最新W，不能补发已被替换的S或E');
  complete[0]('rejected'); await flush();
  assert.equal(calls.length, 3, 'E1旧拒绝不得停掉已发送的新W');
  await time.advance(200); complete[2]('rejected'); await flush();
  assert.deepEqual(calls[3], { kind: 'stop', at: 200 }, '当前最新已发送请求拒绝仍停止');
  input.set({ x: 0, y: 1 }); await time.advance(1000);
  assert.equal(calls.length, 4, '拒绝冻结后不由旧回调或新set直接复活');
});

test('DS2-04：较新同向Accepted不能冲销较旧原请求Unknown或原400ms截止', async t => {
  for (const ending of ['原请求返回Unknown', '原请求到400ms']) await t.test(ending, async t => {
    const time = clock(), calls = [], complete = [], errors = [];
    const input = new DirectionIntent({ clock: time,
      send: vector => { calls.push({ kind: 'move', vector, at: time.now() }); return new Promise(resolve => complete.push(resolve)); },
      stop: async () => { calls.push({ kind: 'stop', at: time.now() }); }, fail: message => errors.push(message) });
    t.after(() => input.clear());
    input.set({ x: 1, y: 0 }); await flush(); await time.advance(100);
    assert.deepEqual(calls.map(call => call.at), [0, 100]);
    await time.advance(150); complete[1]('accepted'); await flush();
    if (ending === '原请求返回Unknown') {
      await time.advance(160); complete[0]('unknown'); await flush();
      assert.deepEqual(calls.map(({ kind, at }) => ({ kind, at })), [{ kind: 'move', at: 0 }, { kind: 'move', at: 100 }, { kind: 'stop', at: 160 }]);
    } else {
      await time.advance(399); assert.deepEqual(calls.map(call => call.at), [0, 100, 200]);
      await time.advance(400);
      assert.deepEqual(calls.map(({ kind, at }) => ({ kind, at })), [{ kind: 'move', at: 0 }, { kind: 'move', at: 100 }, { kind: 'move', at: 200 }, { kind: 'stop', at: 400 }], '第二次发送和较新成功都不延长E1的原截止');
      complete[0]('accepted'); complete[2]('accepted'); await flush();
    }
    const count = calls.length; input.set({ x: 0, y: 1 }); await time.advance(1000);
    assert.equal(calls.length, count, 'Unknown后的迟到成功不复活持键');
    assert.equal(calls.filter(call => call.kind === 'stop').length, 1); assert.equal(errors.length, 1);
  });
});


test('DS2-04：同intent较新E2已Accepted，E1迟到Rejected不误停且200ms仍续E', async t => {
  const time = clock(), calls = [], complete = [];
  const input = new DirectionIntent({ clock: time,
    send: vector => { calls.push({ kind: 'move', vector, at: time.now() }); return new Promise(resolve => complete.push(resolve)); },
    stop: async () => { calls.push({ kind: 'stop', at: time.now() }); } });
  t.after(() => input.clear());
  input.set({ x: 1, y: 0 }); await flush(); await time.advance(100);
  assert.deepEqual(calls.map(call => call.at), [0, 100]);
  await time.advance(150); complete[1]('accepted'); await flush();
  await time.advance(160); complete[0]('rejected'); await flush();
  assert.equal(calls.filter(call => call.kind === 'stop').length, 0, '同intent仍必须按已发送id区分旧拒绝');
  assert.equal(calls.length, 2);
  await time.advance(199); assert.equal(calls.length, 2, 'E2确认与E1拒绝均不提前100ms原节奏');
  await time.advance(200);
  assert.deepEqual(calls[2], { kind: 'move', vector: { x: 1, y: 0 }, at: 200 }, '旧拒绝不能取消当前同向续发');
  input.clear(); complete[2]('accepted'); await flush(); await time.advance(700);
  assert.equal(calls.length, 3);
});
