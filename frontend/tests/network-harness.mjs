import assert from 'node:assert/strict';
import { createWriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import { performance } from 'node:perf_hooks';
import { canonicalize } from '../../protocol/index.mjs';
import { authorizedProjection } from '../../game/projection.mjs';
import { HttpApi } from '../src/network/http-api.ts';
import { SessionClient } from '../src/network/session-client.ts';
import { connectSocket } from '../src/network/socket-link.ts';
import { comparableProjection, sha256, until } from './network-support.mjs';

/** 诊断日志从不接收 token、Authorization 或数据库连接配置。 */
export class NetworkRecorder {
  constructor(path) { this.stream = createWriteStream(path); this.start = performance.now(); this.count = 0; this.records = []; }
  write(kind, value) {
    const record = { index: ++this.count, utc: new Date().toISOString(), monotonicMs: performance.now() - this.start, kind, ...value };
    this.stream.write(JSON.stringify(record) + '\n'); this.records.push(record); return record;
  }
  async close() { this.stream.end(); await finished(this.stream); }
}

/** 仅观察真实 openConnection 返回的可信句柄，不制造或替换连接身份。 */
export function observeConnections(runtime, recorder) {
  const pending = new Map();
  const original = runtime.openConnection.bind(runtime);
  runtime.openConnection = async token => {
    const handle = await original(token);
    const candidates = (pending.get(token) || []).filter(link => !link.serverConnectionId && !link.closed);
    assert.equal(candidates.length, 1, '真实握手必须对应一个明确的测试传输尝试。');
    const link = candidates[0]; link.serverConnectionId = handle.connectionId;
    recorder.write('trusted-connection', { participant: link.participant.label, userId: link.participant.userId, linkId: link.id, connectionId: handle.connectionId });
    return handle;
  };
  return { register(token, link) { const list = pending.get(token) || []; list.push(link); pending.set(token, list); } };
}

export class Participant {
  #token;
  constructor({ label, origin, recorder, connections, credentials = null }) {
    this.label = label; this.origin = origin; this.recorder = recorder; this.connections = connections;
    this.#token = credentials?.token || null; this.userId = credentials?.userId || null; this.actorId = credentials?.actorId || null;
    this.links = []; this.inbound = []; this.outbound = []; this.held = []; this.pending = new Set();
    this.pushPolicy = () => 'deliver'; this.responsePolicy = () => 'deliver'; this.requestPolicy = () => 'deliver'; this.holdReceiptQueries = false;
    this.api = new HttpApi(() => this.#token, async (path, options) => {
      const response = await fetch(new URL(path, this.origin), options);
      const body = await response.clone().json();
      const safeBody = String(path).endsWith('/auth/guest') ? { userId: body.userId, name: body.name } : body;
      this.recorder.write('http', { participant: this.label, userId: this.userId, path: String(path), status: response.status, body: safeBody });
      if (this.holdReceiptQueries && String(path).includes('/actions/')) {
        return new Promise(resolve => this.held.push({ kind: 'http-receipt', value: body, digest: sha256(body), deliver: () => resolve(response) }));
      }
      return response;
    });
    this.client = new SessionClient(this.api, (token, handlers) => this.connect(token, handlers), {
      onChange: state => {
        const snapshot = state.snapshot;
        this.recorder.write('client-state', { participant: this.label, userId: this.userId, connection: state.connection, cursor: snapshot?.snapshotSeq || null, viewId: snapshot?.viewId || null, projectionDigest: snapshot ? sha256(snapshot.projection) : null, mode: snapshot?.projection.self.mode || null, epoch: snapshot?.projection.self.controlEpoch || null, canControl: snapshot?.projection.self.canControl ?? null, actions: state.actions.map(action => ({ id: action.id, status: action.status, rawDigest: sha256(action.raw), receiptDigest: action.receipt ? sha256(action.receipt) : null })) });
      },
    });
  }
  async guest(name) {
    const identity = await this.api.guest(name); this.#token = identity.token; this.userId = identity.userId;
    this.recorder.write('identity', { participant: this.label, userId: this.userId, name }); return { userId: this.userId, name };
  }
  duplicate(label) { return new Participant({ label, origin: this.origin, recorder: this.recorder, connections: this.connections, credentials: { token: this.#token, userId: this.userId, actorId: this.actorId } }); }
  async join(sessionId) { const member = await this.api.join(sessionId, crypto.randomUUID()); this.actorId = member.actorId; return member; }
  open(sessionId, drafts = []) { this.sessionId = sessionId; this.client.open(sessionId, this.#token, drafts); }
  connect(token, handlers) {
    const context = { id: `${this.label}-link-${this.links.length + 1}`, participant: this, closed: false, serverConnectionId: null };
    this.links.push(context); this.currentLink = context; this.connections.register(token, context);
    const incoming = (kind, value, deliver) => {
      const record = this.recorder.write('inbound', { participant: this.label, userId: this.userId, linkId: context.id, event: kind, digest: sha256(value), value });
      this.inbound.push(record);
      const packet = { kind, value, linkId: context.id, digest: record.digest, receivedIndex: record.index, deliver: () => { assert.equal(sha256(value), record.digest, '故障调度不得改写真实载荷。'); this.recorder.write('delivery', { participant: this.label, linkId: context.id, sourceIndex: record.index, digest: record.digest }); deliver(value); } };
      return packet;
    };
    const real = connectSocket(token, {
      connected: () => { this.recorder.write('connected', { participant: this.label, linkId: context.id, connectionId: context.serverConnectionId }); handlers.connected(); },
      disconnected: () => { this.recorder.write('disconnected', { participant: this.label, linkId: context.id }); handlers.disconnected(); },
      failed: value => { this.recorder.write('connect-failed', { participant: this.label, linkId: context.id, error: value ?? null }); handlers.failed(value); },
      batch: value => {
        const packet = incoming('world.batch', value, handlers.batch); const policy = this.pushPolicy(packet);
        if (policy === 'hold') this.held.push(packet);
        else if (policy === 'drop') this.recorder.write('dropped', { participant: this.label, linkId: context.id, sourceIndex: packet.receivedIndex, digest: packet.digest });
        else packet.deliver();
      },
    }, this.origin);
    const request = (event, value) => {
      const operation = (async () => {
        if (this.requestPolicy(event, value) === 'hold') {
          await new Promise(resolve => this.held.push({ kind: `outbound:${event}`, value, digest: sha256(value), deliver: () => resolve() }));
        }
        const record = this.recorder.write('outbound', { participant: this.label, userId: this.userId, linkId: context.id, event, digest: sha256(value), value }); this.outbound.push(record);
        const response = await real.request(event, value);
        let release;
        const responsePromise = new Promise(resolve => { release = resolve; });
        const packet = incoming(event, response, release);
        if (this.responsePolicy(packet) === 'hold') this.held.push(packet); else packet.deliver();
        return responsePromise;
      })();
      this.pending.add(operation); operation.finally(() => this.pending.delete(operation)).catch(() => {}); return operation;
    };
    const link = { get connected() { return real.connected; }, request, close: () => { context.closed = true; real.close(); } };
    context.link = link; return link;
  }
  release(packet) { const index = this.held.indexOf(packet); if (index >= 0) this.held.splice(index, 1); packet.deliver(); }
  releaseAll() { this.pushPolicy = () => 'deliver'; this.responsePolicy = () => 'deliver'; this.requestPolicy = () => 'deliver'; this.holdReceiptQueries = false; for (const packet of [...this.held]) this.release(packet); }
  async online() { return until(() => this.client.state.connection === 'online' && this.client.state.snapshot, `${this.label} 取得真实授权快照`); }
  async controlled() { await this.online(); await this.client.control('resume'); return until(() => this.client.state.snapshot?.projection.self.canControl, `${this.label} 恢复控制`); }
  async action(action) {
    await this.client.send(action);
    const draft = this.client.state.actions.at(-1);
    assert.ok(draft?.receipt, `${this.label} 的动作缺少确定收据`);
    return draft;
  }
  async settle() { this.client.close(); this.releaseAll(); await until(() => this.pending.size === 0, `${this.label} 传输收束`, 12000); }
}

export async function checkpoint({ participants, server, sessionId, recorder, label }) {
  const pair = await until(async () => {
    await Promise.all(participants.map(person => person.client.sync()));
    const snapshots = participants.map(person => person.client.state.snapshot);
    if (snapshots.some(snapshot => !snapshot)) return null;
    const http = await Promise.all(participants.map(person => person.api.snapshot(sessionId)));
    const cursor = http[0].snapshotSeq;
    if (!http.every(snapshot => snapshot.snapshotSeq === cursor) || !snapshots.every(snapshot => snapshot.snapshotSeq === cursor)) return null;
    return { snapshots, http, cursor };
  }, `${label}：五身份同游标`, 15000);
  const replay = await server.runtime.replay(sessionId, pair.cursor);
  const saved = (await server.runtime.pool.query('SELECT state,content_snapshot,content_digest,reducer_version FROM sessions WHERE session_id=$1', [sessionId])).rows[0];
  const liveRows = (await server.runtime.pool.query('SELECT connection_id,user_id,active,lease_until FROM connections')).rows;
  const comparisons = [];
  for (let i = 0; i < participants.length; i += 1) {
    const person = participants[i]; const socket = pair.snapshots[i]; const http = pair.http[i];
    assert.equal(socket.projection.self.characterId, person.actorId);
    assert.equal(http.projection.self.canControl, false);
    assert.deepEqual(comparableProjection(socket.projection), comparableProjection(http.projection), `${label}/${person.label} HTTP 投影`);
    const connectionId = person.currentLink.serverConnectionId;
    assert.ok(connectionId, '控制对照必须使用真实可信连接 ID');
    const authority = replay.characters[person.actorId];
    const row = liveRows.find(item => item.connection_id === connectionId);
    const expectedControl = authority.mode === 'HumanControlled' && authority.activeConnectionId === connectionId && row?.active && Date.parse(row.lease_until) > Date.now();
    assert.equal(socket.projection.self.canControl, Boolean(expectedControl), `${label}/${person.label} 真实连接控制`);
    const expected = authorizedProjection(replay, saved.content_snapshot, person.actorId, { connectionId });
    assert.deepEqual(socket.projection, expected, `${label}/${person.label} 历史前缀投影`);
    comparisons.push({ participant: person.label, userId: person.userId, actorId: person.actorId, connectionId, socketViewId: socket.viewId, httpViewId: http.viewId, cursor: pair.cursor, projectionDigest: sha256(socket.projection), httpProjectionDigest: sha256(http.projection), canControl: socket.projection.self.canControl });
  }
  const projections = pair.snapshots.map(snapshot => snapshot.projection);
  const common = projection => ({ phase: projection.phase, contentVersion: projection.contentVersion, reducerVersion: projection.reducerVersion, deadlineAt: projection.deadlineAt, ending: projection.ending, characters: projection.characters.map(({ regionId, ...person }) => person) });
  for (const projection of projections.slice(1)) assert.deepEqual(common(projection), common(projections[0]), '共同授权的公共状态一致');
  for (let i = 0; i < projections.length; i += 1) for (let j = i + 1; j < projections.length; j += 1) {
    for (const item of projections[i].items) { const other = projections[j].items.find(value => value.itemId === item.itemId); if (other) assert.deepEqual(item, other, '共同可见物品一致'); }
    for (const target of projections[i].targets) { const other = projections[j].targets.find(value => value.targetId === target.targetId); if (other) { const { availableOperations, ...a } = target; const { availableOperations: ignored, ...b } = other; assert.deepEqual(a, b, '共同可见目标事实一致'); } }
  }
  recorder.write('checkpoint', { label, sessionId, cursor: pair.cursor, comparisons, publicDigest: sha256(common(projections[0])), replayDigest: sha256(replay), storedAtSameCursor: saved.state.sessionSeq === pair.cursor });
  if (saved.state.sessionSeq === pair.cursor) assert.deepEqual(replay, saved.state, `${label} 持久世界与同前缀回放`);
  return { cursor: pair.cursor, comparisons, state: replay, content: saved.content_snapshot };
}

export function assertPrivateBoundary(people, marker, allowedUserIds, recorder) {
  const observed = people.map(person => ({ participant: person.label, userId: person.userId, matching: person.inbound.filter(record => canonicalize(record.value).includes(marker)).map(record => record.index) }));
  for (const row of observed) {
    if (allowedUserIds.includes(row.userId)) assert.ok(row.matching.length > 0, `合法接收者 ${row.participant} 实际收到标记`);
    else assert.equal(row.matching.length, 0, `未授权 ${row.participant} 的完整入站载荷不得含私人标记`);
  }
  recorder.write('privacy-check', { marker, allowedUserIds, observed }); return observed;
}
