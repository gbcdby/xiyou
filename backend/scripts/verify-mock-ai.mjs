import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { io } from 'socket.io-client';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { until } from '../test-support/ai-room.mjs';
import { decodeStoredOutput } from '../ai/output.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const output = path.join(repository, '.agent-output/mock-ai');
await mkdir(output, { recursive: true });
const report = { acceptanceProfile: 'mock-20261111', specRef: '3690b481d1805f6a7b535584c80a8574c5103d97', status: 'RUNNING', clock: 'real-monotonic', input: '本轮新建两个合成账号和标准内容房间；正式 HTTP/Socket.IO 输入及独立模拟服务进程', externalModelCalls: 0 };
async function sourceDigests() {
  const argumentsFor = ['-z', '--', 'backend', 'game', 'protocol', 'content', 'package.json', 'package-lock.json'];
  const tracked = execFileSync('git', ['ls-files', ...argumentsFor], { cwd: repository }).toString().split('\0');
  const added = execFileSync('git', ['ls-files', '--others', '--exclude-standard', ...argumentsFor], { cwd: repository }).toString().split('\0');
  const files = [...new Set([...tracked, ...added])].filter(file => /\.(mjs|json|sql)$/.test(file) && !file.includes('/evidence/')).sort();
  return Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(path.join(repository, file))).digest('hex')])));
}
report.sourceBefore = await sourceDigests();
const database = await startTestPostgres('ai-mock-window');
let child; let closed; let childResult; let stdout = ''; let stderr = ''; const sockets = [];
function timeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]).finally(() => clearTimeout(timer));
}
async function stopChild() {
  if (!child || childResult) return;
  child.kill('SIGTERM');
  try { await timeout(closed, 5000, '模拟进程没有完整关闭'); }
  catch (error) { child.kill('SIGKILL'); await closed; throw error; }
  assert.equal(childResult.code, 0); assert.equal(childResult.signal, null);
}
try {
  const script = JSON.parse(await readFile(path.join(repository, 'package.json'), 'utf8')).scripts['start:mock'];
  assert.equal(script, 'node backend/mock-main.mjs');
  const credentials = database.connection;
  const connectionString = `postgresql://${encodeURIComponent(credentials.user)}:${encodeURIComponent(credentials.password)}@${credentials.host}:${credentials.port}/${credentials.database}`;
  const ownPids = new Set();
  database.pool.on('connect', client => ownPids.add(client.processID));
  await database.pool.query('SELECT 1');
  report.initialVerifierPids = [...ownPids];
  child = spawn(process.execPath, ['backend/mock-main.mjs'], { cwd: repository, env: { ...process.env, DATABASE_URL: connectionString, PORT: '0', HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => { childResult = { code, signal }; resolve(childResult); }); });
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  await until(() => {
    if (childResult) throw new Error('模拟入口在监听前退出');
    return /监听端口 (\d+)/.test(stdout);
  }, '模拟入口未开始监听', 5000);
  assert.match(stdout, /模拟角色策略/);
  const base = `http://127.0.0.1:${stdout.match(/监听端口 (\d+)/)[1]}`;
  async function post(endpoint, body, token) {
    const response = await fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    assert.equal(response.status, 200);
    return response.json();
  }
  const users = [];
  for (const name of ['合成自动玩家甲', '合成自动玩家乙']) users.push(await post('/api/auth/guest', { name }));
  const room = await post('/api/sessions', { nonce: crypto.randomUUID(), contentVersion: 'trust-repair-fixture-v1' }, users[0].token);
  const actorIds = [];
  for (const user of users) actorIds.push((await post(`/api/sessions/${room.sessionId}/join`, { nonce: crypto.randomUUID() }, user.token)).actorId);
  for (let index = 0; index < users.length; index++) {
    const socket = io(base, { auth: { token: users[index].token }, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    await timeout(new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); }), 5000, '合成玩家无法建立正式 Socket.IO 连接');
    const response = await socket.timeout(3000).emitWithAck('control.resume', JSON.stringify({ schemaVersion: 1, type: 'control.resume', sessionId: room.sessionId, actorId: actorIds[index], nonce: crypto.randomUUID() }));
    assert.equal(response.mode, 'HumanControlled');
    const snapshot = await socket.timeout(3000).emitWithAck('session.subscribe', { sessionId: room.sessionId });
    assert.equal(snapshot.type, 'world.snapshot');
  }
  await post(`/api/sessions/${room.sessionId}/start`, { nonce: crypto.randomUUID() }, users[0].token);
  report.startedAt = new Date().toISOString();
  report.sessionId = room.sessionId;
  const started = performance.now();
  console.log('真实 60 秒主动观察窗口已开始；窗口内不发送新的玩家输入。');
  await new Promise(resolve => setTimeout(resolve, 60_010));
  report.observedMs = performance.now() - started;
  assert.ok(report.observedMs >= 60_000);
  const runs = (await database.pool.query('SELECT * FROM ai_runs WHERE session_id=$1 ORDER BY created_at,decision_id', [room.sessionId])).rows;
  const events = (await database.pool.query('SELECT event FROM world_events WHERE session_id=$1 ORDER BY session_seq', [room.sessionId])).rows.map(row => row.event);
  report.proposals = runs.map(run => ({ actorId: run.actor_id, decisionId: run.decision_id, contextDigest: run.context_digest, configuration: run.configuration, outputDigest: run.model_result?.outputStringDigest, status: run.status, receipt: run.outcome?.receipt ? { status: run.outcome.receipt.status, code: run.outcome.receipt.code, actionEventRange: run.outcome.receipt.actionEventRange } : null }));
  report.behaviors = {};
  for (const role of ['tangseng', 'wukong']) {
    const purposeful = runs.filter(run => run.actor_id === role && run.outcome?.receipt?.status === 'Accepted' && run.context.memory.goals.some(goal => goal.status === 'active') && JSON.parse(decodeStoredOutput(run)).toolCalls.some(tool => ['inspect', 'share_evidence', 'move'].includes(tool.kind)));
    const accepted = purposeful.flatMap(run => events.filter(event => event.causedBy?.decisionId === run.decision_id && event.serverTime >= report.startedAt && (event.kind === 'character.moved' || (event.kind === 'ObservationRecorded' && event.payload.category !== 'Claim' && ['inspection', 'evidence_share'].includes(event.payload.source.kind))))).map(event => ({ eventSeq: event.sessionSeq, kind: event.kind, decisionId: event.causedBy.decisionId, sourceKind: event.payload.source?.kind ?? null, subjectId: event.payload.subjectId ?? null }));
    assert.ok(accepted.length > 0, `${role} 在真实窗口内缺少有目标的合法主动行为`);
    report.behaviors[role] = accepted;
  }
  const state = (await database.pool.query('SELECT state FROM sessions WHERE session_id=$1', [room.sessionId])).rows[0].state;
  assert.equal(state.phase, 'Running');
  assert.equal(state.targets.passage_structure.fields.find(field => field.key === 'safe').value, false);
  assert.equal(state.targets.passage_structure.fields.find(field => field.key === 'permit').value, false);
  assert.equal((await database.pool.query("SELECT count(*) FROM action_receipts WHERE session_id=$1 AND principal_id LIKE 'human:%'", [room.sessionId])).rows[0].count, '0');
  report.playerActionsDuringWindow = 0;
  report.totalCalls = runs.length;
  assert.ok(runs.length <= 120);
  assert.ok(runs.every(run => run.configuration.providerKind === 'controlled'));
  await stopChild();
  report.process = childResult;
  assert.match(stdout, /权威服务及数据库连接已关闭/);
  await until(async () => {
    report.remainingDatabasePids = (await database.pool.query('SELECT pid FROM pg_stat_activity WHERE datname=current_database()')).rows.map(row => row.pid);
    return report.remainingDatabasePids.every(pid => ownPids.has(pid));
  }, '模拟进程遗留 PostgreSQL 连接');
  report.finalVerifierPids = [...ownPids];
  report.databaseConnectionsClosed = true;
  report.sourceAfter = await sourceDigests();
  assert.deepEqual(report.sourceAfter, report.sourceBefore, '观察窗口内源码发生变化，结果不能代表固定候选');
  report.status = 'PASS';
  console.log(`真实观察 ${Math.round(report.observedMs)} ms；两角色均有合法目标行为；总调用 ${runs.length}；进程及连接完整关闭。`);
} catch (error) {
  report.status = 'FAIL'; report.failure = { name: error.name, code: error.code ?? null, message: error.message };
  throw error;
} finally {
  for (const socket of sockets) socket.disconnect();
  try { await stopChild(); }
  finally {
    await database.stop();
    await writeFile(path.join(output, 'real-window.json'), JSON.stringify(report, null, 2) + '\n');
    await writeFile(path.join(output, 'mock-process.log'), stdout + stderr);
  }
}
