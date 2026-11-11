import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createRuntime } from '../runtime.mjs';

test('真实进程崩溃：提交前、COMMIT 后 ACK 前及发布中的恢复', async t => {
  const database = await startTestPostgres('crash');
  const runtime = await createRuntime({ pool: database.pool });
  t.after(async () => { await runtime.close(); await database.stop(); });
  for (const [phase, expectedExit] of [['before-commit', 71], ['after-commit', 72], ['during-publish', 73]]) {
    await t.test(phase, async childTest => {
      const users = [await runtime.guest({ name: '崩溃检查甲' }), await runtime.guest({ name: '崩溃检查乙' })];
      const { sessionId } = await runtime.create(users[0].token, { nonce: phase, contentVersion: 'trust-repair-fixture-v1' });
      const { actorId } = await runtime.join(users[0].token, sessionId, { nonce: 'join' });
      await runtime.join(users[1].token, sessionId, { nonce: 'join' });
      await runtime.start(users[0].token, sessionId, { nonce: 'start' });
      const child = fork(fileURLToPath(new URL('../test-support/crash-worker.mjs', import.meta.url)), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
      const messages = []; child.on('message', message => messages.push(message));
      childTest.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
      const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
      child.send({ phase, connection: database.connection, token: users[0].token, sessionId, actorId });
      const exit = await Promise.race([exited, new Promise((_, reject) => { const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('故障子进程没有按时退出。')); }, 15000); timer.unref(); child.once('exit', () => clearTimeout(timer)); })]);
      assert.equal(exit.code, expectedExit, stderr);
      assert.equal(exit.signal, null);
      const prepared = messages.find(message => message.type === 'prepared');
      assert.ok(prepared, '子进程必须在提交前交付固定动作原文。');
      const raw = prepared.raw; const request = JSON.parse(raw);
      const recovered = await createRuntime({ pool: database.pool });
      childTest.after(() => recovered.close());
      const receipt = await recovered.receipt(users[0].token, sessionId, request.clientActionId);
      const state = await recovered.replay(sessionId);
      const row = (await database.pool.query('SELECT state,session_seq FROM sessions WHERE session_id=$1', [sessionId])).rows[0];
      assert.deepEqual(state, row.state);
      const counts = (await database.pool.query('SELECT (SELECT count(*) FROM world_events WHERE session_id=$1) AS events,(SELECT count(*) FROM action_receipts WHERE session_id=$1 AND client_action_id=$2) AS receipts,(SELECT count(*) FROM outbox WHERE session_id=$1 AND through_seq>$3) AS outbox', [sessionId, request.clientActionId, request.baseSeq])).rows[0];
      assert.equal(counts.events, row.session_seq);
      if (phase === 'before-commit') {
        assert.equal(receipt, null); assert.equal(row.session_seq, request.baseSeq);
        assert.equal(counts.receipts, '0'); assert.equal(counts.outbox, '0');
        assert.equal(state.characters[actorId].regionId, 'passage');
      } else {
        assert.equal(receipt.status, 'Accepted'); assert.equal(counts.receipts, '1'); assert.equal(counts.outbox, '1');
        assert.equal(state.characters[actorId].regionId, 'store');
      }
      if (phase === 'during-publish') assert.ok(messages.some(message => message.type === 'delivered'));
      else assert.ok(!messages.some(message => message.type === 'ack'));
      const handle = await recovered.openConnection(users[0].token);
      await recovered.control(handle, JSON.stringify({ schemaVersion: 1, type: 'control.take', sessionId, actorId, nonce: 'recover' }));
      const retried = await recovered.submit(handle, raw);
      if (receipt) assert.deepEqual(retried, receipt);
      else { assert.equal(retried.code, 'STALE_CONTROL'); assert.equal(retried.actionEventRange, null); }
      await recovered.publishPending();
      assert.equal((await database.pool.query("SELECT count(*) FROM outbox WHERE session_id=$1 AND status='Pending'", [sessionId])).rows[0].count, '0');
      childTest.diagnostic(`实际子进程 ${child.pid} 退出码 ${exit.code}；回放、收据、连续序号和发布恢复均符合预期。`);
    });
  }
});
