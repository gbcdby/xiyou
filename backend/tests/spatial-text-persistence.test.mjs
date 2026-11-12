import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createRuntime } from '../runtime.mjs';
import { errorResponse } from '../errors.mjs';
import { parseSpatial } from '../../protocol/spatial.mjs';
import { canonicalize } from '../../protocol/index.mjs';

const capabilities = ['spatial-v2'];
const now = () => Date.parse('2026-11-12T10:00:00.000Z');
let database, runtime;
before(async () => {
  database = await startTestPostgres('spatial-text', { outputSubdirectory: 'text-repair' });
  runtime = await createRuntime({ pool: database.pool, now });
});
after(async () => { await runtime?.close(); await database?.stop(); });

async function room(authority = runtime) {
  const users = await Promise.all(['文本甲', '文本乙'].map(name => authority.guest({ name })));
  const { sessionId } = await authority.create(users[0].token, { nonce: randomUUID(), contentVersion: 'spatial-graybox-v2', capabilities });
  await authority.join(users[1].token, sessionId, { nonce: randomUUID(), capabilities });
  const handles = [];
  for (const user of users) {
    const handle = await authority.openConnection(user.token, capabilities);
    const snapshot = await authority.subscribe(handle, sessionId);
    await authority.control(handle, JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce: randomUUID() }));
    handles.push(handle);
  }
  await authority.start(users[0].token, sessionId, { nonce: randomUUID() });
  const snapshot = await authority.snapshot(users[0].token, sessionId, capabilities);
  return { sessionId, users, handles, snapshot };
}

function speech(r, text, clientActionId = randomUUID()) {
  const s = r.snapshot;
  return JSON.stringify({ schemaVersion: 2, sessionId: r.sessionId, viewId: s.viewId, actorRef: s.projection.self.entityRef, clientActionId, controlEpoch: s.projection.self.controlEpoch, baseSeq: s.snapshotSeq, action: { kind: 'speak', text, channel: 'public', recipientRefs: [] } });
}

test('真实 PostgreSQL：合法 NUL 正文原样提交、Receipt 重试和回放一致', async t => {
  const r = await room();
  // 原标准反例：保持当前协议与原始输入，不把合法文本改成非法。
  const text = '不可存储\u0000测试';
  const originalRaw = speech(r, text, 'nul-speech');
  const request = parseSpatial('PublicEnvelope', originalRaw);
  assert.equal(request.action.text, text);
  let accepted, failure;
  try { accepted = await runtime.submit(r.handles[0], originalRaw); }
  catch (error) { failure = error; }
  const receipt = await runtime.receipt(r.users[0].token, r.sessionId, request.clientActionId);
  const healthy = await runtime.submit(r.handles[0], speech(r, '正常消息', 'normal-speech'));
  t.diagnostic(JSON.stringify({ parsed: true, databaseCode: failure?.code ?? null, publicError: failure ? errorResponse(failure).code : null, receipt: receipt?.status ?? null, nextNormalSpeech: healthy.status }));
  assert.ifError(failure);
  assert.equal(accepted.status, 'Accepted');
  assert.deepEqual(receipt, accepted);
  assert.equal(healthy.status, 'Accepted');
  assert.deepEqual(await runtime.submit(r.handles[0], originalRaw), accepted);
  const changed = JSON.parse(originalRaw);
  changed.action.text = '不可存储\\u0000测试';
  await assert.rejects(runtime.submit(r.handles[0], JSON.stringify(changed)), { code: 'ACTION_ID_REUSE' });
  const stored = (await database.pool.query('SELECT semantic_digest FROM action_receipts WHERE session_id=$1 AND client_action_id=$2', [r.sessionId, request.clientActionId])).rows;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].semantic_digest, createHash('sha256').update(canonicalize(request)).digest('hex'));
  for (const user of r.users) {
    const snapshot = await runtime.snapshot(user.token, r.sessionId, capabilities);
    assert.equal(snapshot.projection.claims.filter(claim => claim.text === text).length, 1);
  }
  const delivered = [];
  await runtime.publishPending(async (connectionId, batch) => { delivered.push({ connectionId, batch }); }, { capability: 'spatial-v2' });
  for (const handle of r.handles) assert.ok(delivered.some(({ connectionId, batch }) => connectionId === handle.connectionId && batch.events.some(event => event.payload.projection.claims.some(claim => claim.text === text))));
  const replay = await runtime.replay(r.sessionId);
  assert.equal(replay.claims[replay.members[0].characterId].filter(claim => claim.text === text).length, 1);
  assert.deepEqual(replay, await runtime.locked(r.sessionId, { kind: 'text-readback' }, async tx => tx.state));
  const prefix = await runtime.locked(r.sessionId, { kind: 'text-prefix' }, tx => runtime.stateAt(tx, accepted.observedSeq));
  assert.deepEqual(prefix.claims[prefix.members[0].characterId].map(claim => claim.text), [text]);

  // 控制 nonce 保存的是授权快照，亦须保留正文；原 nonce 跨重启仍读回原响应。
  const s = await runtime.snapshot(r.users[0].token, r.sessionId, capabilities);
  const controlRaw = JSON.stringify({ schemaVersion: 2, type: 'control.take', sessionId: r.sessionId, viewId: s.viewId, actorRef: s.projection.self.entityRef, nonce: 'text-control' });
  const control = await runtime.control(r.handles[0], controlRaw);
  assert.ok(control.snapshot.projection.claims.some(claim => claim.text === text));
  assert.deepEqual(await runtime.control(r.handles[0], controlRaw), control);
  await runtime.close();
  runtime = await createRuntime({ pool: database.pool, now });
  const reconnected = await runtime.openConnection(r.users[0].token, capabilities);
  assert.deepEqual(await runtime.control(reconnected, controlRaw), control);
  assert.deepEqual(await runtime.submit(reconnected, originalRaw), accepted);
  assert.deepEqual(await runtime.receipt(r.users[0].token, r.sessionId, request.clientActionId), accepted);
  const restored = await runtime.snapshot(r.users[0].token, r.sessionId, capabilities);
  assert.equal(restored.projection.claims.filter(claim => claim.text === text).length, 1);
  assert.deepEqual(await runtime.replay(r.sessionId), await runtime.locked(r.sessionId, { kind: 'text-recovery-readback' }, async tx => tx.state));
});

test('真实 PostgreSQL：NUL、字面转义与 Unicode 边界不混淆、不归一化', async () => {
  const r = await room();
  const texts = [
    '字面\\0、\\u0000、\\\\与普通中文',
    '混合\u0000与字面\\0、\\u0000、\\\\、\u0000末尾',
    '边界\u0001\b\t\n\f\r\u001f\u007f\uD7FF\uE000\uFFFD\uFFFE\uFFFF\u{10000}\u{10FFFF}😀𠮷',
    '组合 e\u0301 与 é；👩🏽‍🚀；\u2028\u2029；\u0000',
    '\u0000' + '甲'.repeat(1999),
  ];
  for (const [index, text] of texts.entries()) {
    const raw = speech(r, text);
    const request = parseSpatial('PublicEnvelope', raw);
    if (index === 1) request.action.kind = 'make_claim';
    const originalRaw = index === 1 ? JSON.stringify(request) : raw;
    const accepted = await runtime.submit(r.handles[0], originalRaw);
    assert.equal(accepted.status, 'Accepted');
    assert.deepEqual(await runtime.submit(r.handles[0], originalRaw), accepted);
    assert.deepEqual(await runtime.receipt(r.users[0].token, r.sessionId, request.clientActionId), accepted);
  }
  for (const user of r.users) {
    const snapshot = await runtime.snapshot(user.token, r.sessionId, capabilities);
    assert.deepEqual(snapshot.projection.claims.map(claim => claim.text), texts);
  }
  const replay = await runtime.replay(r.sessionId);
  assert.deepEqual(replay.claims[replay.members[0].characterId].map(claim => claim.text), texts);
  assert.deepEqual(replay, await runtime.locked(r.sessionId, { kind: 'unicode-readback' }, async tx => tx.state));
  const count = (await database.pool.query("SELECT count(*) FROM world_events WHERE session_id=$1 AND event->>'kind'='spatial.claim'", [r.sessionId])).rows[0].count;
  assert.equal(count, String(texts.length));
  // 孤立代理码本来就不符合严格 JSON 契约；保留这一既有边界。
  for (const surrogate of ['\uD800', '\uDFFF']) assert.throws(() => parseSpatial('PublicEnvelope', speech(r, surrogate)));
});

test('真实 PostgreSQL：004 未编码历史升级与重复迁移保留字面文本和旧 region', async () => {
  const oldDatabase = await startTestPostgres('spatial-text-migration', { outputSubdirectory: 'text-repair' });
  let authority;
  try {
    authority = await createRuntime({ pool: oldDatabase.pool, now });
    const r = await room(authority);
    const text = '旧行\\0与\\u0000、路径\\\\、😀与 e\u0301';
    const originalRaw = speech(r, text, 'legacy-text');
    const accepted = await authority.submit(r.handles[0], originalRaw);
    const s = await authority.snapshot(r.users[0].token, r.sessionId, capabilities);
    const controlRaw = JSON.stringify({ schemaVersion: 2, type: 'control.take', sessionId: r.sessionId, viewId: s.viewId, actorRef: s.projection.self.entityRef, nonce: 'legacy-control' });
    const control = await authority.control(r.handles[0], controlRaw);
    const legacy = await authority.create(r.users[0].token, { nonce: 'legacy-region', contentVersion: 'trust-repair-fixture-v1' });
    const region = await authority.snapshot(r.users[0].token, legacy.sessionId);
    const regionReplay = await authority.replay(legacy.sessionId);
    await authority.close();

    // 内容为原生 JSONB；去掉新增空标记列后，实际以 004 表结构运行升级。
    // 此 fixture 验证旧布局，不声称运行了旧服务二进制。
    await oldDatabase.pool.query('ALTER TABLE sessions DROP COLUMN state_text_encoding; ALTER TABLE world_events DROP COLUMN event_text_encoding; ALTER TABLE command_nonces DROP COLUMN response_text_encoding');
    const capture = async () => ({
      sessions: (await oldDatabase.pool.query('SELECT session_id,state::text FROM sessions ORDER BY session_id')).rows,
      events: (await oldDatabase.pool.query('SELECT session_id,session_seq,event::text FROM world_events ORDER BY session_id,session_seq')).rows,
      nonces: (await oldDatabase.pool.query('SELECT session_id,nonce,response::text FROM command_nonces ORDER BY session_id,nonce')).rows,
    });
    const previous = await capture();
    await authority.migrate();
    await authority.migrate();
    assert.deepEqual(await capture(), previous);
    for (const [table, column] of [['sessions', 'state_text_encoding'], ['world_events', 'event_text_encoding'], ['command_nonces', 'response_text_encoding']]) {
      assert.equal((await oldDatabase.pool.query(`SELECT count(*) FROM ${table} WHERE ${column} IS NOT NULL`)).rows[0].count, '0');
    }

    authority = await createRuntime({ pool: oldDatabase.pool, now });
    const reconnected = await authority.openConnection(r.users[0].token, capabilities);
    assert.deepEqual(await authority.control(reconnected, controlRaw), control);
    assert.deepEqual(await authority.submit(reconnected, originalRaw), accepted);
    assert.deepEqual((await authority.snapshot(r.users[0].token, r.sessionId, capabilities)).projection.claims.map(claim => claim.text), [text]);
    const snapshot = await authority.subscribe(reconnected, r.sessionId);
    const resumed = await authority.control(reconnected, JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId: r.sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce: 'new-text-control' }));
    r.snapshot = resumed.snapshot;
    const partner = await authority.openConnection(r.users[1].token, capabilities);
    const partnerSnapshot = await authority.subscribe(partner, r.sessionId);
    await authority.control(partner, JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId: r.sessionId, viewId: partnerSnapshot.viewId, actorRef: partnerSnapshot.projection.self.entityRef, nonce: 'partner-text-control' }));
    const newText = '升级后\u0000与字面\\0';
    assert.equal((await authority.submit(reconnected, speech(r, newText))).status, 'Accepted');
    assert.deepEqual((await authority.snapshot(r.users[0].token, r.sessionId, capabilities)).projection.claims.map(claim => claim.text), [text, newText]);
    assert.deepEqual(await authority.snapshot(r.users[0].token, legacy.sessionId), region);
    assert.deepEqual(await authority.replay(legacy.sessionId), regionReplay);
    assert.deepEqual(await authority.replay(r.sessionId), await authority.locked(r.sessionId, { kind: 'migration-readback' }, async tx => tx.state));
  } finally {
    await authority?.close();
    await oldDatabase.stop();
  }
});
