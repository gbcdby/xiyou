import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { committedPublisher, attachSpatialDirection } from '../spatial-direction-runtime.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));

/** 在真实发布器最终重查 Pending 时截住执行，以免普通定时兜底掩盖丢唤醒。 */
async function exercise({ wakes, freshCanPublish }) {
  let calls = 0, entered, release, maxRunning = 0;
  const queryEntered = new Promise(resolve => { entered = resolve; });
  const queryReleased = new Promise(resolve => { release = resolve; });
  const tasks = new Set(), delivered = [];
  const runtime = {
    async publishPending(deliver) {
      calls++;
      if (calls > 1 && freshCanPublish) {
        await deliver('connection', { throughSeq: 'new-committed-prefix' });
        return { busy: false, examined: 1, published: 1 };
      }
      return { busy: false, examined: 1, published: 0 };
    },
    pool: { async query() {
      if (calls === 1) { entered(); await queryReleased; }
      return { rowCount: calls > 1 && freshCanPublish ? 0 : 1 };
    } },
  };
  const publisher = committedPublisher({ runtime, deliver: async (_connection, batch) => delivered.push(batch), track(promise) {
    tasks.add(promise); maxRunning = Math.max(maxRunning, tasks.size);
    promise.finally(() => tasks.delete(promise));
  } });
  try {
    publisher.request(); await queryEntered;
    for (let i = 0; i < wakes; i++) publisher.request();
    assert.equal(calls, 1, '当前发布器重查在途时，新的提交只能合并排队');
    release();
    for (let i = 0; i < 6; i++) await turn();
    return { calls, maxRunning, delivered };
  } finally { release(); publisher.close(); await Promise.allSettled([...tasks]); }
}

test('D66-SERVER-01：旧Pending无进展，重查期间的新COMMIT仍得到一次发布机会', async () => {
  const result = await exercise({ wakes: 1, freshCanPublish: true });
  assert.equal(result.calls, 2);
  assert.equal(result.maxRunning, 1);
  assert.deepEqual(result.delivered, [{ throughSeq: 'new-committed-prefix' }]);
});

test('D66-SERVER-01：没有新代次的旧无进展Pending不忙轮询', async () => {
  const result = await exercise({ wakes: 0, freshCanPublish: false });
  assert.equal(result.calls, 1);
  assert.equal(result.maxRunning, 1);
  assert.deepEqual(result.delivered, []);
});

test('D66-SERVER-01：新代次试过仍受阻后停止，保留定时兜底', async () => {
  const result = await exercise({ wakes: 1, freshCanPublish: false });
  assert.equal(result.calls, 2, '每个未尝试代次至多再试一次，不能因Pending常驻空转');
  assert.deepEqual(result.delivered, []);
});

test('D66-SERVER-01：同一轮二十次提交合并为一次后续尝试，发布器不重入', async () => {
  const result = await exercise({ wakes: 20, freshCanPublish: true });
  assert.equal(result.calls, 2);
  assert.equal(result.maxRunning, 1);
  assert.equal(result.delivered.length, 1);
});

function pla01Probe() {
  const called = Promise.withResolvers(), tasks = new Set();
  const runtime = new EventEmitter();
  runtime.spatialDirection = { checkpointMs: 50 };
  runtime.pool = { async query(sql) {
    return sql.startsWith('SELECT session_id') ? { rows: [] } : { rowCount: 0 };
  } };
  runtime.publishPending = async (_deliver, options) => {
    called.resolve(options);
    return { busy: false, examined: 0, published: 0 };
  };
  const options = { runtime, deliver: async () => {}, track(promise) {
    tasks.add(promise);
    void promise.then(() => tasks.delete(promise), () => tasks.delete(promise));
    return promise;
  } };
  return { runtime, options, called: called.promise,
    async finish(owner) { owner.close(); await Promise.allSettled([...tasks]); } };
}

test('PLA-01：默认 request 明确使用 wait', { timeout: 1000 }, async () => {
  const p = pla01Probe(), publisher = committedPublisher(p.options);
  try {
    publisher.request();
    const call = await p.called;
    assert.equal(call.progressLock, 'wait');
    assert.equal(call.capability, 'spatial-v2');
  } finally { await p.finish(publisher); }
});

test('PLA-01：显式 try 传入快速发布轮次', { timeout: 1000 }, async () => {
  const p = pla01Probe(), publisher = committedPublisher(p.options);
  try {
    publisher.request('spatial-v2', { progressLock: 'try' });
    const call = await p.called;
    assert.equal(call.progressLock, 'try');
    assert.equal(call.capability, 'spatial-v2');
  } finally { await p.finish(publisher); }
});

test('PLA-01：attach 的 commit 选 try，ready 保持 wait', { timeout: 1000 }, async t => {
  for (const [event, payload, expected] of [
    ['commit', { events: [{ schemaVersion: 2 }] }, 'try'],
    ['spatial-supply-ready', { connectionId: 'current-handle' }, 'wait'],
  ]) {
    await t.test(event, async () => {
      const p = pla01Probe(), direction = attachSpatialDirection(p.options);
      try {
        assert(direction);
        p.runtime.emit(event, payload);
        const call = await p.called;
        assert.equal(call.progressLock, expected);
        assert.equal(call.capability, 'spatial-v2');
      } finally { await p.finish(direction); }
    });
  }
});

test('PLA-01：公开 publish 的 wait 与 capability 独立', { timeout: 1000 }, async t => {
  for (const capability of ['spatial-v2', null]) {
    await t.test(String(capability), async () => {
      const p = pla01Probe(), direction = attachSpatialDirection(p.options);
      try {
        direction.publish(capability, { progressLock: 'wait' });
        const call = await p.called;
        assert.equal(call.progressLock, 'wait');
        assert.equal(call.capability, capability);
      } finally { await p.finish(direction); }
    });
  }
});

const plaTick = () => new Promise(resolve => setImmediate(resolve));
async function plaTicks(count = 8) { for (let i = 0; i < count; i++) await plaTick(); }
async function plaUntil(predicate, message) {
  for (let i = 0; i < 16; i++) { if (predicate()) return; await plaTick(); }
  assert(predicate(), message);
}
function plaPublisherFixture({ publish = async () => ({}), pending = async () => 1, afterRun } = {}) {
  const calls = [], queries = [], tasks = new Set(), gates = [], errors = [];
  let maxRunning = 0, settled = 0, publisher;
  const runtime = {
    async publishPending(_deliver, options) {
      const call = { number: calls.length + 1, ...options }; calls.push(call);
      return { busy: false, examined: 1, published: 0, ...await publish(call) };
    },
    pool: { async query(sql, values) {
      const query = { number: queries.length + 1, sql, values }; queries.push(query);
      return { rowCount: await pending(query) };
    } },
  };
  publisher = committedPublisher({ runtime, deliver: async () => {}, log: (...args) => errors.push(args),
    track(promise) {
      tasks.add(promise); maxRunning = Math.max(maxRunning, tasks.size);
      const finish = () => { tasks.delete(promise); afterRun?.(++settled, publisher); };
      void promise.then(finish, finish);
      return promise;
    },
  });
  return { publisher, calls, queries, errors,
    gate() { const gate = Promise.withResolvers(); gates.push(gate); return gate; },
    modes: () => calls.map(call => call.progressLock),
    maxRunning: () => maxRunning,
    waitCalls: count => plaUntil(() => calls.length >= count, `expected ${count} public publish calls, got ${calls.length}`),
    waitQueries: count => plaUntil(() => queries.length >= count, `expected ${count} Pending queries, got ${queries.length}`),
    async close() { publisher.close(); for (const gate of gates) gate.resolve(); await Promise.allSettled([...tasks]); },
  };
}

test('PLA-04：在途 try 收到 wait 后，后续 try 不能覆盖它', { timeout: 2000 }, async () => {
  let hold;
  const f = plaPublisherFixture({ publish: async call => { if (call.number === 1) await hold.promise; return {}; } });
  hold = f.gate();
  try {
    f.publisher.request('spatial-v2', { progressLock: 'try' }); await f.waitCalls(1);
    f.publisher.request('spatial-v2', { progressLock: 'wait' });
    for (let i = 0; i < 20; i++) f.publisher.request('spatial-v2', { progressLock: 'try' });
    assert.equal(f.calls.length, 1, 'request must not reenter an active run');
    hold.resolve(); await f.waitCalls(2); await plaTicks();
    assert.deepEqual(f.modes(), ['try', 'wait']);
    assert.equal(f.maxRunning(), 1);
  } finally { await f.close(); }
});

test('PLA-04：wait 在途的新 wait 留给下一轮，完成不清新请求', { timeout: 2000 }, async () => {
  let hold;
  const f = plaPublisherFixture({ publish: async call => { if (call.number === 1) await hold.promise; return {}; } });
  hold = f.gate();
  try {
    f.publisher.request(); await f.waitCalls(1);
    f.publisher.request('spatial-v2', { progressLock: 'wait' });
    f.publisher.request('spatial-v2', { progressLock: 'try' });
    hold.resolve(); await f.waitCalls(2); await plaTicks();
    assert.deepEqual(f.modes(), ['wait', 'wait']);
    assert.equal(f.maxRunning(), 1);
  } finally { await f.close(); }
});

test('PLA-05：busy 恢复 wait 和 capability，等待真实新入口而不自旋', { timeout: 2000 }, async () => {
  const f = plaPublisherFixture({ publish: async call => call.number === 1 ? { busy: true } : {} });
  try {
    f.publisher.request(null, { progressLock: 'wait' }); await f.waitCalls(1); await plaTicks();
    assert.equal(f.calls.length, 1, 'busy alone must not schedule repeated owner attempts');
    f.publisher.request('spatial-v2', { progressLock: 'try' }); await f.waitCalls(2); await plaTicks();
    assert.deepEqual(f.modes(), ['wait', 'wait']);
    assert.deepEqual(f.calls.map(call => call.capability), [null, null]);
    assert.equal(f.maxRunning(), 1);
  } finally { await f.close(); }
});

test('PLA-05：busy 在途到达的新 wait 也不触发立即忙轮询', { timeout: 2000 }, async () => {
  let hold;
  const f = plaPublisherFixture({ publish: async call => {
    if (call.number === 1) { await hold.promise; return { busy: true }; }
    return {};
  } });
  hold = f.gate();
  try {
    f.publisher.request('spatial-v2', { progressLock: 'try' }); await f.waitCalls(1);
    f.publisher.request(null, { progressLock: 'wait' }); hold.resolve(); await plaTicks();
    assert.equal(f.calls.length, 1, 'fresh wait remains queued but does not spin on busy');
    f.publisher.request('spatial-v2', { progressLock: 'try' }); await f.waitCalls(2); await plaTicks();
    assert.deepEqual(f.modes(), ['try', 'wait']);
    assert.equal(f.calls[1].capability, null);
  } finally { await f.close(); }
});

test('PLA-05：publish 或 Pending 查询异常，无新 wait 时保留需求但不自旋', { timeout: 2000 }, async t => {
  for (const site of ['publish', 'pending']) {
    await t.test(site, async () => {
      const f = plaPublisherFixture({
        publish: async call => { if (site === 'publish' && call.number === 1) throw new Error('fixed publish failure'); return {}; },
        pending: async query => { if (site === 'pending' && query.number === 1) throw new Error('fixed Pending failure'); return 1; },
      });
      try {
        f.publisher.request(null, { progressLock: 'wait' }); await f.waitCalls(1); await plaTicks();
        assert.equal(f.calls.length, 1, 'restored wait is not a fresh request');
        assert.equal(f.errors.length, 1);
        f.publisher.request('spatial-v2', { progressLock: 'try' }); await f.waitCalls(2); await plaTicks();
        assert.deepEqual(f.modes(), ['wait', 'wait']);
        assert.deepEqual(f.calls.map(call => call.capability), [null, null]);
      } finally { await f.close(); }
    });
  }
});

test('PLA-05：异常期间的新 wait 获一次后续机会，再失败不能靠恢复位续转', { timeout: 2000 }, async t => {
  for (const site of ['publish', 'pending']) {
    await t.test(site, async () => {
      let hold;
      const f = plaPublisherFixture({
        publish: async call => {
          if (site === 'publish' && call.number <= 2) { if (call.number === 1) await hold.promise; throw new Error('fixed publish failure'); }
          return {};
        },
        pending: async query => {
          if (site === 'pending' && query.number <= 2) { if (query.number === 1) await hold.promise; throw new Error('fixed Pending failure'); }
          return 1;
        },
      });
      hold = f.gate();
      try {
        f.publisher.request('spatial-v2', { progressLock: 'try' });
        if (site === 'publish') await f.waitCalls(1); else await f.waitQueries(1);
        f.publisher.request('spatial-v2', { progressLock: 'wait' }); hold.resolve();
        await f.waitCalls(2); await plaTicks();
        assert.deepEqual(f.modes(), ['try', 'wait']);
        assert.equal(f.errors.length, 2);
        f.publisher.request('spatial-v2', { progressLock: 'try' }); await f.waitCalls(3); await plaTicks();
        assert.deepEqual(f.modes(), ['try', 'wait', 'wait'], 'failed claimed wait still survives the next explicit try wake');
        assert.equal(f.maxRunning(), 1);
      } finally { await f.close(); }
    });
  }
});

test('PLA-11a：正常自续没有新入口时继承本轮 wait 或 try', { timeout: 2000 }, async t => {
  for (const mode of ['wait', 'try']) {
    await t.test(mode, async () => {
      const f = plaPublisherFixture({ publish: async call => ({ published: call.number === 1 ? 1 : 0 }) });
      try {
        f.publisher.request('spatial-v2', { progressLock: mode }); await f.waitCalls(2); await plaTicks();
        assert.deepEqual(f.modes(), [mode, mode], 'Pending plus partial progress is not a new explicit try');
      } finally { await f.close(); }
    });
  }
});

test('PLA-11b/d：wait 在运行或最后 Pending await 收到 fresh try，可转入 try', { timeout: 2000 }, async t => {
  for (const window of ['publish', 'pending']) {
    await t.test(window, async () => {
      let hold;
      const f = plaPublisherFixture({
        publish: async call => { if (window === 'publish' && call.number === 1) await hold.promise; return {}; },
        pending: async query => { if (window === 'pending' && query.number === 1) await hold.promise; return 1; },
      });
      hold = f.gate();
      try {
        f.publisher.request();
        if (window === 'publish') await f.waitCalls(1); else await f.waitQueries(1);
        f.publisher.request('spatial-v2', { progressLock: 'try' }); hold.resolve();
        await f.waitCalls(2); await plaTicks();
        assert.deepEqual(f.modes(), ['wait', 'try'], 'completed wait must not become permanently sticky');
      } finally { await f.close(); }
    });
  }
});

test('PLA-11c/d：最后 Pending await 的 try/wait/try 保留新 wait', { timeout: 2000 }, async t => {
  for (const initialMode of ['wait', 'try']) {
    await t.test(initialMode, async () => {
      let hold;
      const f = plaPublisherFixture({ pending: async query => { if (query.number === 1) await hold.promise; return 1; } });
      hold = f.gate();
      try {
        f.publisher.request('spatial-v2', { progressLock: initialMode }); await f.waitQueries(1);
        for (const mode of ['try', 'wait', 'try']) f.publisher.request('spatial-v2', { progressLock: mode });
        hold.resolve(); await f.waitCalls(2); await plaTicks();
        assert.deepEqual(f.modes(), [initialMode, 'wait']);
      } finally { await f.close(); }
    });
  }
});

test('PLA-11e：wait 零进展且无新入口，不为继承模式而自续', { timeout: 2000 }, async () => {
  const f = plaPublisherFixture();
  try {
    f.publisher.request(); await f.waitCalls(1); await plaTicks();
    assert.deepEqual(f.modes(), ['wait']);
  } finally { await f.close(); }
});

test('PLA-11f：wait 自续已入队后到来的 try 不清掉该次 wait', { timeout: 2000 }, async () => {
  const f = plaPublisherFixture({
    publish: async call => ({ published: call.number === 1 ? 1 : 0 }),
    afterRun: (number, publisher) => { if (number === 1) publisher.request('spatial-v2', { progressLock: 'try' }); },
  });
  try {
    f.publisher.request(); await f.waitCalls(2); await plaTicks();
    assert.deepEqual(f.modes(), ['wait', 'wait']);
    assert.equal(f.maxRunning(), 1);
  } finally { await f.close(); }
});

test('PLA-07：close 取消未开始调度，且不能假取消在途发布', { timeout: 2000 }, async t => {
  await t.test('not started', async () => {
    const f = plaPublisherFixture();
    try {
      f.publisher.request(); f.publisher.close(); await plaTicks();
      assert.equal(f.calls.length, 0);
    } finally { await f.close(); }
  });
  await t.test('in flight', async () => {
    let hold, workFinished = false;
    const f = plaPublisherFixture({ publish: async () => { await hold.promise; workFinished = true; return {}; } });
    hold = f.gate();
    try {
      f.publisher.request('spatial-v2', { progressLock: 'try' }); await f.waitCalls(1);
      f.publisher.request(); f.publisher.close(); await plaTicks();
      assert.equal(workFinished, false);
      assert.equal(f.calls[0].isStopped(), true);
      assert.equal(f.calls.length, 1);
      hold.resolve(); await plaTicks();
      assert.equal(workFinished, true);
      assert.equal(f.calls.length, 1, 'queued wait must not start after close');
    } finally { await f.close(); }
  });
});
