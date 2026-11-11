import pg from 'pg';
import { createRuntime } from '../runtime.mjs';

const send = message => new Promise((resolve, reject) => process.send(message, error => error ? reject(error) : resolve()));

// 只由测试父进程通过 IPC 提供连接资料；任何网络接口均不提供故障开关。
process.once('message', async input => {
  const pool = new pg.Pool({ ...input.connection, max: 4 });
  let runtime; let armed = false;
  try {
    runtime = await createRuntime({ pool, hooks: {
      beforeCommit({ command }) { if (armed && command === 'action' && input.phase === 'before-commit') process.exit(71); },
      afterCommit({ command }) { if (armed && command === 'action' && input.phase === 'after-commit') process.exit(72); },
      duringPublish({ sessionId }) { if (armed && sessionId === input.sessionId && input.phase === 'during-publish') process.exit(73); },
    } });
    const handle = await runtime.openConnection(input.token);
    const control = await runtime.control(handle, JSON.stringify({ schemaVersion: 1, type: 'control.take', sessionId: input.sessionId, actorId: input.actorId, nonce: 'crash-control' }));
    await runtime.publishPending();
    const snapshot = await runtime.subscribe(handle, input.sessionId);
    const raw = JSON.stringify({ schemaVersion: 1, sessionId: input.sessionId, actorId: input.actorId, clientActionId: `crash-${input.phase}`, controlEpoch: control.controlEpoch, baseSeq: snapshot.snapshotSeq, action: { kind: 'move', regionId: 'store' } });
    await send({ type: 'prepared', raw });
    armed = true;
    const receipt = await runtime.submit(handle, raw);
    await send({ type: 'ack', receipt });
    await runtime.publishPending(async (_connectionId, batch) => { await send({ type: 'delivered', throughSeq: batch.throughSeq }); });
    throw new Error('预定故障点没有终止进程。');
  } catch (error) {
    // 不把数据库连接配置或认证信息写入故障输出。
    console.error('故障检查未达到预期阶段。', error.code ?? error.name);
    await runtime?.close(); await pool.end(); process.exit(2);
  }
});
