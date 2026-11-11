import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createAuthorityServer } from '../server.mjs';
import { createRunningRoom, actionRaw } from '../test-support/ai-room.mjs';
import { validateContract } from '../../protocol/index.mjs';

let database, server, origin;
const clock = Date.parse('2026-11-11T12:00:00.000Z');
before(async () => {
  database = await startTestPostgres('recap');
  server = await createAuthorityServer({ pool: database.pool, now: () => clock });
  const address = await server.listen(0); origin = `http://127.0.0.1:${address.port}`;
});
after(async () => { await server?.close(); await database?.stop(); });
async function get(sessionId, token, query) {
  const response = await fetch(`${origin}/api/sessions/${sessionId}/recap?${query}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: response.status, body: await response.json() };
}
const head = async r => (await server.runtime.snapshot(r.users[0].token, r.sessionId)).snapshotSeq;
async function send(r, index, action) {
  const receipt = await server.runtime.submit(r.connections[index], actionRaw(r, index, action));
  assert.equal(receipt.status, 'Accepted', JSON.stringify(receipt)); return receipt;
}

test('实际 HTTP 终态复盘只读，并沿用当前认证与终态水位', async () => {
  const r = await createRunningRoom(server.runtime);
  assert.equal((await get(r.sessionId, r.users[0].token, `throughSeq=${await head(r)}`)).body.code, 'FORBIDDEN');
  await server.runtime.abortSession(r.sessionId, '复盘合成检查');
  const throughSeq = await head(r);
  const before = await server.runtime.replay(r.sessionId);
  const result = await get(r.sessionId, r.users[0].token, `throughSeq=${throughSeq}`);
  assert.equal(result.status, 200);
  validateContract('AuthorizedRecap', result.body);
  assert.equal(result.body.phase, 'Aborted');
  assert.equal(result.body.actorId, r.actors[0]);
  assert.ok(result.body.entries.some(e => e.kind === 'aborted' && e.text === '复盘合成检查'));
  assert.deepEqual(await server.runtime.replay(r.sessionId), before);
  assert.equal(await head(r), throughSeq);
});

test('实际传播 A→C→B 保留 Claim 接收者，不提升假陈述或追授历史受众', async () => {
  const r = await createRunningRoom(server.runtime, 5);
  const text = '通路已修好';
  await send(r, 0, { kind: 'inspect', targetId: 'passage_structure' });
  await send(r, 0, { kind: 'speak', text: '后来到场者不能看到的旧公开说法', channel: 'public', recipientIds: [] });
  await send(r, 0, { kind: 'speak', text: 'PRIVATE-只给协调者', channel: 'private', recipientIds: [r.actors[2]] });
  await send(r, 0, { kind: 'speak', text, channel: 'directed', recipientIds: [r.actors[2]] });
  const cSnapshot = await server.runtime.snapshot(r.users[2].token, r.sessionId);
  const heard = cSnapshot.projection.observations.find(o => o.category === 'Claim' && o.statement === text);
  const privateObservation = cSnapshot.projection.observations.find(o => o.statement === 'PRIVATE-只给协调者');
  assert.equal(privateObservation.shareable, false);
  const originalClaim = cSnapshot.projection.claims.find(c => c.text === text);
  await send(r, 1, { kind: 'move', regionId: 'passage' });
  await send(r, 2, { kind: 'share_evidence', evidenceId: heard.observationId, recipientIds: [r.actors[1]] });
  const ownEvidence = (await server.runtime.snapshot(r.users[0].token, r.sessionId)).projection.observations.find(o => o.category === 'Evidence');
  await send(r, 0, { kind: 'share_evidence', evidenceId: ownEvidence.observationId, recipientIds: [r.actors[1]] });
  assert.equal((await server.runtime.replay(r.sessionId)).targets.passage_structure.fields.find(f => f.key === 'safe').value, false);
  await server.runtime.abortSession(r.sessionId, '陈述语义检查');
  const throughSeq = await head(r);
  const [b, c, a] = await Promise.all([1, 2, 0].map(async index => (await get(r.sessionId, r.users[index].token, `throughSeq=${throughSeq}`)).body));
  const shared = b.entries.find(e => e.text === text);
  assert.equal(shared.category, 'Claim'); assert.equal(shared.kind, 'received_claim'); assert.equal(shared.actorId, r.actors[1]);
  assert.ok(c.entries.some(e => e.text === text && e.category === 'Claim' && e.kind === 'heard_claim' && e.actorId === r.actors[2]));
  assert.ok(a.entries.some(e => e.text === text && e.kind === 'said' && e.actorId === r.actors[0]));
  assert.equal(b.entries.some(e => e.kind === 'said' && e.references.some(ref => ref.id === originalClaim.claimId)), false);
  assert.equal(JSON.stringify(b).includes('后来到场者不能看到'), false);
  assert.equal(JSON.stringify(b).includes('PRIVATE-只给协调者'), false);
  assert.ok(c.entries.some(e => e.kind === 'heard_claim' && e.text === 'PRIVATE-只给协调者'));
  assert.ok(b.entries.some(e => e.kind === 'received_evidence' && e.actorId === r.actors[1] && e.references.some(ref => ownEvidence.source.sourceIds.includes(ref.id))));
  const receivedEvidence = b.entries.find(e => e.kind === 'received_evidence' && e.references.some(ref => ownEvidence.source.sourceIds.includes(ref.id)));
  assert.ok(receivedEvidence.references.some(ref => ref.kind === 'source' && ref.id === ownEvidence.subjectId));
  assert.equal(receivedEvidence.references.some(ref => ref.kind === 'target' && ref.id === ownEvidence.subjectId), false);
  assert.ok(a.entries.some(e => e.kind === 'observed' && e.fields.some(f => f.key === 'safe' && f.value === false)));
  assert.equal([...a.entries, ...b.entries, ...c.entries].some(e => e.category === 'WorldFact' && e.fields.some(f => f.key === 'safe' && f.value === true)), false);
  for (const forbidden of ['humanCharacterIds', 'principalId', 'connectionId', 'decisionId', 'beliefId', 'causedBy', 'token']) assert.equal(JSON.stringify(b).includes(`"${forbidden}"`), false, forbidden);
});

test('分页按授权条目计数，稳定水位和严格游标；读取不产生世界或决策写入', async () => {
  const r = await createRunningRoom(server.runtime);
  for (let i = 0; i < 105; i++) {
    await send(r, 0, { kind: 'inspect', targetId: 'passage_structure' });
    await send(r, 1, { kind: 'speak', text: `隐藏分页记录${i}`, channel: 'private', recipientIds: [r.actors[1]] });
  }
  await server.runtime.abortSession(r.sessionId, '分页检查');
  const throughSeq = await head(r);
  const counts = async () => {
    const result = {};
    for (const table of ['world_events', 'action_receipts', 'outbox', 'decisions', 'ai_runs']) result[table] = (await database.pool.query(`SELECT count(*)::integer AS n FROM ${table} WHERE session_id=$1`, [r.sessionId])).rows[0].n;
    result.state = (await database.pool.query('SELECT state,logical_time FROM sessions WHERE session_id=$1', [r.sessionId])).rows[0];
    return result;
  };
  const before = await counts();
  const first = (await get(r.sessionId, r.users[0].token, `throughSeq=${throughSeq}`)).body;
  assert.equal(first.entries.length, 100); assert.equal(first.nextBeforeSeq, first.entries.at(-1).eventSeq);
  assert.deepEqual((await get(r.sessionId, r.users[0].token, `throughSeq=${throughSeq}`)).body, first);
  const all = [...first.entries]; let cursor = first.nextBeforeSeq;
  while (cursor) {
    const page = (await get(r.sessionId, r.users[0].token, `throughSeq=${throughSeq}&beforeSeq=${cursor}`)).body;
    assert.equal(page.throughSeq, throughSeq); assert.ok(page.entries.every(e => BigInt(e.eventSeq) < BigInt(cursor)));
    all.push(...page.entries); cursor = page.nextBeforeSeq;
  }
  assert.ok(all.length > 105); assert.equal(new Set(all.map(e => e.entryId)).size, all.length);
  assert.equal(JSON.stringify(all).includes('隐藏分页记录'), false);
  const empty = (await get(r.sessionId, r.users[0].token, `throughSeq=${throughSeq}&beforeSeq=1`)).body;
  assert.deepEqual(empty.entries, []); assert.equal(empty.nextBeforeSeq, null);
  assert.deepEqual(await counts(), before);
});

test('当前撤权、跨局、删除与身份失效均拒绝；非法查询不被宽松解释', async () => {
  const r = await createRunningRoom(server.runtime);
  await server.runtime.abortSession(r.sessionId, '权限检查');
  const throughSeq = await head(r);
  for (const query of ['', 'throughSeq=', 'throughSeq=01', 'throughSeq=-1', `throughSeq=${throughSeq}&beforeSeq=0`, `throughSeq=${throughSeq}&beforeSeq=${BigInt(throughSeq) + 1n}`, `throughSeq=${throughSeq}&unknown=1`, `throughSeq=${throughSeq}&throughSeq=${throughSeq}`, `throughSeq=${throughSeq}&beforeSeq=1&beforeSeq=2`]) {
    const response = await get(r.sessionId, r.users[0].token, query);
    assert.equal(response.status, 400, query); assert.equal(response.body.code, 'INVALID_MESSAGE', query);
  }
  assert.equal((await get(r.sessionId, r.users[0].token, 'throughSeq=0')).body.code, 'RESYNC_REQUIRED');
  assert.equal((await get(r.sessionId, 'missing-token', `throughSeq=${throughSeq}`)).status, 401);
  const stranger = await server.runtime.guest({ name: '无本局资格的合成人物' });
  assert.equal((await get(r.sessionId, stranger.token, `throughSeq=${throughSeq}`)).body.code, 'FORBIDDEN');
  await server.runtime.revokeAccess(r.sessionId, r.users[1].userId);
  assert.equal((await get(r.sessionId, r.users[1].token, `throughSeq=${throughSeq}`)).body.code, 'FORBIDDEN');
  await server.runtime.deleteSession(r.sessionId);
  assert.equal((await get(r.sessionId, r.users[0].token, `throughSeq=${throughSeq}`)).body.code, 'SESSION_GONE');
});
