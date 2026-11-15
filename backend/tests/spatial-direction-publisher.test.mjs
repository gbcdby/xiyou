import test from 'node:test';
import assert from 'node:assert/strict';
import { committedPublisher } from '../spatial-direction-runtime.mjs';

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
