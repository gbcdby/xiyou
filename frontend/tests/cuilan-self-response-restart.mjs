import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { startTestPostgres } from '../../backend/test-support/postgres.mjs';
import { decodeJsonbText } from '../../backend/jsonb-text.mjs';
import { sampleSharedPersonalEffects, assertBothActiveEffects, assertSharedStopTransaction, assertOriginalReceiptRead } from '../../backend/test-support/personal-shared-effects.mjs';
import { repository, sourceIdentity, saveJSON, sha256, until } from './network-support.mjs';

/** B单列真实进程故障，不使用Chromium，不计入六组普通Vue样本。 */
export function assertRestartFaultReport(report) {
  assert.equal(report.executionKind, 'production-process-restart-controlled-clock');
  assert.equal(report.source.status, ''); assert.deepEqual(report.sourceEnd, report.source);
  assert.equal(report.crashedExit.signal, 'SIGKILL'); assert.equal(report.crashedExit.code, null);
  assert.equal(report.resumedExit.code, 0); assert.equal(report.resumedExit.signal, null);
  assertBothActiveEffects(report.prepare.before);
  assert.deepEqual(report.beforeKill.sample, report.prepare.before);
  assert.deepEqual(report.afterKill, report.beforeKill, 'kill后、新服务启动前的真实PG输入仍完整双ACTIVE');
  assert.deepEqual(report.postRecovery.beforeRecovery, report.afterKill.sample);
  assertSharedStopTransaction(report.afterKill.sample, report.recovery);
  assert.deepEqual(report.postRecovery.recovery, report.recovery);
  assert.equal(report.recovery.after.paused, true);
  assert.equal(report.prepare.applyReceipt.status, 'Accepted');
  assert.equal(report.prepare.originalTake.receipt.status, 'Accepted');
  assert.deepEqual(report.postRecovery.originalTake, report.prepare.originalTake);
  assertOriginalReceiptRead(report.prepare.originalTake, report.postRecovery.receiptRead.actual, report.postRecovery.receiptRead.transaction);
  assertOriginalReceiptRead(report.prepare.originalTake, report.postRecovery.receiptRetry.actual, report.postRecovery.receiptRetry.transaction, { command: 'spatial-action' });
  assert.notEqual(report.postRecovery.oldView, report.postRecovery.newView);
  assert.equal(report.postRecovery.remaining.returnContextId, report.prepare.before.held.acquisition.acquisitionId);
  assert.equal(report.postRecovery.remaining.mode, 'return_only');
  assert.equal(report.postRecovery.acquisition.outcome, 'delivered_to_owner');
  assert.equal(report.postRecovery.returned.status, 'Accepted');
  assert.equal(report.postRecovery.oldApplyRejected.status, 'Rejected');
  assert.equal(report.postRecovery.c2.length, 2);
  for (const purpose of ['appearance', 'private_items']) {
    const consentId = report.prepare.before.purposes[purpose].consent.consentId;
    assert.ok(report.postRecovery.c2.some(row => row.request.action.kind === 'withdraw_consent' && row.request.action.consentId === consentId && row.receipt.publicReceipt.status === 'Accepted' && row.execution_context.mode === 'scene-policy'));
  }
  assert.equal(report.postRecovery.realProviderCalls, 0);
  assert.deepEqual(report.postRecovery.controlledBindings.map(row => row.key), ['tang', 'wukong', 'bajie']);
  assert.ok(Object.values(report.stages).every(value => value === 'PASS'));
  assert.ok(report.cleanup.length >= 3 && report.cleanup.every(row => row.status === 'PASS'));
}

function ownedWorker() {
  const child = fork(fileURLToPath(new URL('../../backend/test-support/cuilan-personal-restart-worker.mjs', import.meta.url)), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const messages = [], observers = new Set(); let exitValue, processError;
  child.on('message', value => { messages.push(value); for (const observe of observers) observe(); });
  child.on('error', error => { processError = error; for (const observe of observers) observe(); });
  const exited = new Promise(resolveExit => child.once('exit', (code, signal) => { exitValue = { code, signal }; resolveExit(exitValue); for (const observe of observers) observe(); }));
  const waitForExit = async () => {
    let timer;
    try { return await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('自身子进程未在约定阶段后退出')), 10000); })]); }
    finally { clearTimeout(timer); }
  };
  return {
    child, waitForExit,
    send: value => new Promise((resolveSend, reject) => child.send(value, error => error ? reject(error) : resolveSend())),
    message(type, timeout = 120000) {
      return new Promise((resolveMessage, reject) => {
        const finish = (error, value) => { clearTimeout(timer); observers.delete(observe); error ? reject(error) : resolveMessage(value); };
        const observe = () => {
          const value = messages.find(row => row.type === type), failed = messages.find(row => row.type === 'failed');
          if (value) return finish(null, value);
          if (failed) return finish(Object.assign(new Error(`子进程未完成固定阶段：${failed.stage}`), { code: failed.error.code ?? failed.error.name }));
          if (processError) return finish(processError);
          if (exitValue) finish(new Error('子进程已退出而没有所需握手：' + type));
        };
        const timer = setTimeout(() => finish(new Error('等待真实子进程握手超时：' + type)), timeout);
        observers.add(observe); observe();
      });
    },
    async killAndWait() {
      if (processError && !child.pid) return { code: null, signal: null, notStarted: true };
      if (!exitValue) { assert.ok(child.pid); assert.equal(child.kill('SIGKILL'), true); }
      return waitForExit();
    },
  };
}

export async function runPersonalRestartFault(output = resolve(process.env.CUILAN_RESTART_EVIDENCE_DIR || resolve(repository, '.agent-output/cuilan-process-restart'))) {
  const report = { work_id: 'CS-T04-MF-RECOVERY-B', executionKind: 'production-process-restart-controlled-clock', assessment: 'RUNNING',
    scope: '单列真实PG/HTTP/Socket/生产scene故障：固定测试钟，实际双ACTIVE后只杀自建服务；恢复依真实epoch围栏停权。不是普通Vue、真实模型、全部FM或产品总验收。',
    source: await sourceIdentity(), startedAt: new Date().toISOString(), stages: { prepare: 'NOT_RUN', crash: 'NOT_RUN', recovery: 'NOT_RUN', postRecovery: 'NOT_RUN' }, cleanup: [] };
  await saveJSON(resolve(output, 'startup.json'), { source: report.source, command: 'npm run test:fault:cuilan-restart --prefix frontend', scope: report.scope });
  let database; const workers = [];
  try {
    assert.equal(report.source.status, '', '真实故障只能在干净固定候选执行');
    if (process.env.CUILAN_EXPECTED_TREE) assert.equal(report.source.tree, process.env.CUILAN_EXPECTED_TREE);
    database = await startTestPostgres('cuilan-process-restart', { outputSubdirectory: 'cuilan-process-restart-postgres' });
    report.postgresVersion = (await database.pool.query('SHOW server_version')).rows[0].server_version;
    const first = ownedWorker(); workers.push(first); report.stages.prepare = 'RUNNING';
    const firstName = 'cuilan-restart-' + crypto.randomUUID();
    await first.send({ phase: 'prepare', connection: { ...database.connection, application_name: firstName } });
    const prepared = await first.message('prepared');
    // resume含临时凭据，始终只留内存/私有IPC；结果仅选取明确的游戏证据字段。
    report.prepare = prepared.evidence;
    const readPersisted = async () => {
      const row = (await database.pool.query('SELECT state,state_text_encoding FROM sessions WHERE session_id=$1', [prepared.resume.sessionId])).rows[0];
      const state = decodeJsonbText(row.state, row.state_text_encoding);
      return { sample: sampleSharedPersonalEffects(state, prepared.resume.context), stateSha256: sha256(state), sessionSeq: state.sessionSeq };
    };
    report.beforeKill = await readPersisted(); assertBothActiveEffects(report.beforeKill.sample);
    assert.deepEqual(report.beforeKill.sample, prepared.evidence.before, '待办收束后真实持久水位仍与已准备双ACTIVE一致');
    report.stages.prepare = 'PASS'; report.stages.crash = 'RUNNING';
    report.crashedExit = await first.killAndWait();
    assert.equal(report.crashedExit.signal, 'SIGKILL');
    await until(async () => Number((await database.pool.query('SELECT count(*) AS count FROM pg_stat_activity WHERE application_name=$1', [firstName])).rows[0].count) === 0, '已杀自身服务的PG连接全部退出后才读恢复输入', 10000);
    report.afterKill = await readPersisted(); assertBothActiveEffects(report.afterKill.sample);
    assert.deepEqual(report.afterKill, report.beforeKill, '不能用orderly close或断线已提前停权的状态冒充双ACTIVE重启输入');
    report.stages.crash = 'PASS'; report.stages.recovery = 'RUNNING';
    const second = ownedWorker(); workers.push(second);
    await second.send({ phase: 'resume', connection: { ...database.connection, application_name: 'cuilan-restart-' + crypto.randomUUID() }, resume: prepared.resume });
    const recovered = await second.message('recovered');
    report.recovery = recovered.recovery;
    report.spatialDirection = { prepare: prepared.evidence.spatialDirection, resume: recovered.spatialDirection,
      transportScope: prepared.evidence.transportScope };
    assert.deepEqual(report.spatialDirection.prepare, { checkpointMs: 50 });
    assert.deepEqual(report.spatialDirection.resume, report.spatialDirection.prepare);
    assertSharedStopTransaction(report.afterKill.sample, report.recovery);
    report.stages.recovery = 'PASS'; report.stages.postRecovery = 'RUNNING';
    report.postRecovery = (await second.message('complete')).result;
    report.resumedExit = await second.waitForExit(); assert.equal(report.resumedExit.code, 0);
    report.stages.postRecovery = 'PASS'; report.assessment = 'CHECKS_COMPLETE';
  } catch (error) {
    report.assessment = ['EPERM', 'EACCES', 'ECONNREFUSED'].includes(error.code) && report.stages.prepare !== 'PASS' ? 'ENVIRONMENT_BLOCKED' : 'FAIL';
    report.error = { name: error.name, code: error.code ?? null, message: error.message };
    for (const [stage, value] of Object.entries(report.stages)) if (value === 'RUNNING') report.stages[stage] = 'FAIL';
  } finally {
    await saveJSON(resolve(output, 'result-before-cleanup.json'), report);
    for (const [index, worker] of workers.entries()) {
      try { const exit = await worker.killAndWait(); report.cleanup.push({ name: 'owned-child-' + index, status: 'PASS', exit }); }
      catch (error) { report.cleanup.push({ name: 'owned-child-' + index, status: 'FAIL', error: error.message }); }
    }
    if (database) {
      try { await database.stop(); report.cleanup.push({ name: 'owned-postgres', status: 'PASS' }); }
      catch (error) { report.cleanup.push({ name: 'owned-postgres', status: 'FAIL', error: error.name }); }
    }
    report.sourceEnd = await sourceIdentity(); report.finishedAt = new Date().toISOString();
    if (report.assessment === 'CHECKS_COMPLETE') {
      try { assertRestartFaultReport(report); report.assessment = 'PASS'; }
      catch (error) { report.assessment = 'FAIL'; report.finalAuditError = error.message; }
    }
    await saveJSON(resolve(output, 'result.json'), report);
  }
  return report;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const report = await runPersonalRestartFault();
  console.log(JSON.stringify({ assessment: report.assessment, stages: report.stages, executionKind: report.executionKind }));
  if (report.assessment !== 'PASS') process.exitCode = 1;
}
