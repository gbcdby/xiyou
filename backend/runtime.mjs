import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { loadContent, contentDigest } from '../content/index.mjs';
import { canonicalize, validateContract, parseContract, parseClientAction, actionSemanticDigestSync } from '../protocol/node.mjs';
import { emptyWorld, reduceWorld, increment, emptyAudience, everyone, audienceFor, registerKnowledge, terminal } from '../game/world.mjs';
import { authorizedProjection } from '../game/projection.mjs';
import { applyAction, evaluateEnding, endingFacts, RuleError } from '../game/rules.mjs';
import { RuntimeError } from './errors.mjs';
import * as decisions from './decisions.mjs';
import { ownRecord } from '../game/records.mjs';
import { readGaolaoRecap } from './gaolao-recap.mjs';
import { buildSpatialContext } from './ai/spatial-context.mjs';
import { readRecap } from './recap.mjs';
import { parseStrictJSON } from '../protocol/index.mjs';
import { parseSpatial, validateSpatial } from '../protocol/spatial.mjs';
import { isGaolao } from '../game/gaolao-world.mjs';
import { stopPersonalForEvent } from '../game/gaolao-personal.mjs';
import { isSpatial, ensureView } from '../game/spatial-world.mjs';
import * as spatial from './spatial-runtime.mjs';
import * as scenePolicy from './scene-policy.mjs';
import { encodeJsonbText, decodeJsonbText } from './jsonb-text.mjs';
import { spatialDirectionConfig, checkDirectionCapability, directionCapability } from './spatial-direction-config.mjs';
import { createSpatialSupply } from './spatial-supply.mjs';
import { PrefixStateCache } from './prefix-state-cache.mjs';

const digest = value => createHash('sha256').update(typeof value === 'string' ? value : canonicalize(value)).digest('hex');
const id = prefix => `${prefix}-${randomUUID()}`;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}(?![\s\S])/.test(value);
const requireId = value => { if (!validId(value)) throw new RuntimeError('INVALID_MESSAGE', '标识格式无效。'); };
// 普通事务最多让位这么久；到点后不再被后来到达的控制请求续期。
export const CONTROL_PRIORITY_WAIT_MS = 250;
export function clientReceipt(receipt) {
  if (receipt.schemaVersion === 2) return validateSpatial('ReceiptV2', receipt.publicReceipt);
  const { key, ...fields } = receipt;
  return validateContract('ClientReceipt', { ...fields, sessionId: key.sessionId, clientActionId: key.clientActionId });
}

export async function createRuntime(options) {
  const runtime = new AuthorityRuntime(options);
  await runtime.migrate();
  await spatial.recoverSpatial(runtime);
  return runtime;
}

export class AuthorityRuntime extends EventEmitter {
  #connections = new WeakMap();
  #handles = new Map();
  #internals = new WeakMap();
  #views = new Map();
  #publishing = false;
  #prefixStates;
  #controlPriority = new Map();
  constructor({ pool, now = Date.now, hooks = {}, spatialDirection = false }) {
    super(); this.pool = pool; this.now = now; this.hooks = hooks;
    this.#prefixStates = new PrefixStateCache(pool);
    this.spatialDirection = spatialDirectionConfig(spatialDirection);
    this.spatialSupply = createSpatialSupply(this);
  }
  async migrate() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(617248302)');
      await client.query(await readFile(new URL('./migrations/001-authority.sql', import.meta.url), 'utf8'));
      await client.query(await readFile(new URL('./migrations/002-ai.sql', import.meta.url), 'utf8'));
      await client.query(await readFile(new URL('./migrations/003-ai-output-encoding.sql', import.meta.url), 'utf8'));
      await client.query(await readFile(new URL('./migrations/004-spatial.sql', import.meta.url), 'utf8'));
      await client.query(await readFile(new URL('./migrations/005-spatial-text-encoding.sql', import.meta.url), 'utf8'));
      await client.query(await readFile(new URL('./migrations/006-spatial-intent-context.sql', import.meta.url), 'utf8'));
      await client.query(await readFile(new URL('./migrations/007-spatial-ai-context.sql', import.meta.url), 'utf8'));
      await client.query(await readFile(new URL('./migrations/008-scene-policy.sql', import.meta.url), 'utf8'));
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  retireView(view, notify = false) {
    if (!view) return;
    const wasActive = view.active;
    view.active = false;
    const connectionId = view.handle.connectionId;
    // 在途任务可持有旧 view，但不能删除或撤销同一连接的新订阅。
    if (this.#views.get(connectionId) !== view) return;
    this.#views.delete(connectionId);
    if (notify && wasActive) this.emit('view-revoked', { connectionId, sessionId: view.sessionId });
  }
  async close() {
    this.#prefixStates.close();
    for (const gate of this.#controlPriority.values()) for (const entry of gate.pending.values()) entry.resolve();
    this.#controlPriority.clear();
    for (const view of this.#views.values()) this.retireView(view);
    this.#handles.clear(); this.removeAllListeners();
  }
  async guest({ name }) {
    if (typeof name !== 'string' || !name.trim() || name.length > 120) throw new RuntimeError('INVALID_MESSAGE', '姓名必须为一至一百二十个字符。');
    const token = randomBytes(32).toString('base64url');
    const userId = id('U');
    await this.pool.query('INSERT INTO runtime_users(user_id,name,token_hash) VALUES($1,$2,$3)', [userId, name.trim(), digest(token)]);
    return { token, userId, name: name.trim() };
  }
  async authenticate(token, client = this.pool) {
    if (typeof token !== 'string' || token.length > 256) throw new RuntimeError('UNAUTHENTICATED', '请重新登录。');
    const user = (await client.query('SELECT user_id, name FROM runtime_users WHERE token_hash=$1 AND active', [digest(token)])).rows[0];
    if (!user) throw new RuntimeError('UNAUTHENTICATED', '请重新登录。');
    return { userId: user.user_id, name: user.name, principalId: `human:${user.user_id}` };
  }
  async access(client, row, token) {
    const user = await this.authenticate(token, client);
    const access = (await client.query('SELECT actor_id FROM session_access WHERE session_id=$1 AND user_id=$2 AND active', [row.session_id, user.userId])).rows[0];
    if (!access) throw new RuntimeError('FORBIDDEN', '当前账号无权访问本局。');
    return { ...user, actorId: access.actor_id };
  }
  buildTransaction(client, row, cause) {
    const runtime = this;
    row = { ...row, state: decodeJsonbText(row.state, row.state_text_encoding) };
    const tx = {
      client, row, content: row.content_snapshot, state: structuredClone(row.state), events: [], invalidated: new Map(), afterCommit: [], afterFinish: [], cause,
      time: new Date(Math.max(runtime.now(), new Date(row.logical_time).getTime())).toISOString(), clockTouched: false,
      emit(kind, payload, audience = everyone(tx.state), eventCause = tx.cause) {
        if (['session.finished','session.aborted'].includes(kind)) stopPersonalForEvent(tx, {kind});
        if (kind === 'control.changed') {
          const oldActor = ownRecord(tx.state.characters, payload.actorId);
          const oldConnection = oldActor?.activeConnectionId;
          if (oldConnection && oldConnection !== payload.activeConnectionId) tx.invalidated.set(oldConnection, {
            actorId: payload.actorId, controlEpoch: oldActor.controlEpoch, viewId: runtime.#views.get(oldConnection)?.viewId,
          });
        }
        const sessionSeq = increment(tx.state.sessionSeq);
        const candidate = { schemaVersion: isSpatial(tx.state) ? 2 : 1, sessionId: row.session_id, sessionSeq, eventId: `${row.session_id}:E${sessionSeq}`, causedBy: eventCause ?? { principalId: 'system', actionId: 'spatial-view' }, serverTime: tx.time, audience, kind, payload };
        const event = isSpatial(tx.state) ? candidate : validateContract('WorldEvent', candidate);
        tx.state = reduceWorld(tx.state, event, tx.content); tx.events.push(event);
        if(kind==='control.changed')stopPersonalForEvent(tx,event);
        return event;
      },
    };
    return tx;
  }
  async persist(tx) {
    if (tx.events.length) {
      for (const event of tx.events) {
        const stored = isSpatial(tx.state) ? encodeJsonbText(event) : { value: event, encoding: null };
        await tx.client.query('INSERT INTO world_events(session_id,session_seq,event,event_text_encoding) VALUES($1,$2,$3,$4)', [tx.row.session_id, event.sessionSeq, stored.value, stored.encoding]);
      }
      await tx.client.query('INSERT INTO outbox(session_id,from_exclusive,through_seq) VALUES($1,$2,$3)', [tx.row.session_id, tx.row.state.sessionSeq, tx.state.sessionSeq]);
    }
    if (tx.events.length || tx.clockTouched) {
      const stored = isSpatial(tx.state) ? encodeJsonbText(tx.state) : { value: tx.state, encoding: null };
      await tx.client.query('UPDATE sessions SET state=$2, session_seq=$3, logical_time=$4, state_text_encoding=$5 WHERE session_id=$1', [tx.row.session_id, stored.value, tx.state.sessionSeq, tx.time, stored.encoding]);
    }
  }
  async #lockedBody(sessionId, command, operation) {
    const readOnly = command?.readOnly === true;
    const sharedRead = command?.kind === 'spatial-sync' && command.sessionLock === 'share';
    requireId(sessionId);
    const client = await this.pool.connect();
    let committed = false;
    let committing = false;
    let tx;
    let deferredError;
    let result;
    try {
      await client.query(readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
      // 收据只读不取会话行锁，避免重连回放把 control.resume 堵在同一行的锁队列后。
      const row = (await client.query(readOnly ? 'SELECT * FROM sessions WHERE session_id=$1'
        : sharedRead ? 'SELECT * FROM sessions WHERE session_id=$1 FOR SHARE' : 'SELECT * FROM sessions WHERE session_id=$1 FOR UPDATE', [sessionId])).rows[0];
      if (!row) throw new RuntimeError('SESSION_GONE', '本局不可访问。');
      tx = this.buildTransaction(client, row, command.cause);
      if (!readOnly) this.#prefixStates.capture(tx, this.pool);
      result = await operation(tx);
      if (result instanceof RuntimeError) { deferredError = result; result = null; }
      if (!readOnly) await this.persist(tx);
      if (!readOnly) await this.hooks.beforeCommit?.({ command: command.kind, sessionId, events: tx.events });
      committing = true; await client.query('COMMIT'); committed = true;
      if (!readOnly) {
        for (const effect of tx.afterCommit) await effect();
        await this.hooks.afterCommit?.({ command: command.kind, sessionId, events: tx.events });
        await this.applyControlEffects(tx);
        // 仅进程内提交订阅者使用事务起点；不写入 WorldEvent、客户端投影或模型上下文。
        if (tx.events.length) {
          const policyWake=isSpatial(tx.row.state)?scenePolicy.scenePolicyWake(tx):null;
          this.emit('commit', { sessionId, events: tx.events, ...(isSpatial(tx.row.state) ? { spatialPauseBefore: tx.row.state.paused } : {}), ...(policyWake?{scenePolicyWake:policyWake}:{}) });
        }
      }
    } catch (error) {
      if (!committed) await client.query('ROLLBACK').catch(() => {});
      if (committed || committing) throw new RuntimeError('OUTCOME_UNKNOWN', '提交结果尚未确认，请查询原动作身份。');
      throw error;
    } finally { for (const cleanup of tx?.afterFinish ?? []) cleanup({ committed, committing }); client.release(); }
    if (deferredError) throw deferredError;
    return result;
  }
  async locked(sessionId, command, operation) {
    return this.#withControlPriority(sessionId, command, () => this.#lockedBody(sessionId, command, operation));
  }
  async #withControlPriority(sessionId, command, operation) {
    requireId(sessionId);
    const priority = command?.kind === 'control.resume' || command?.kind === 'control.take';
    let gate = this.#controlPriority.get(sessionId);
    let ticket;
    if (priority) {
      if (!gate) { gate = { sequence: 0, pending: new Map() }; this.#controlPriority.set(sessionId, gate); }
      ticket = ++gate.sequence;
      let resolve;
      const settled = new Promise(done => { resolve = done; });
      gate.pending.set(ticket, { settled, resolve });
    } else if (gate?.pending.size) {
      // 只让位于到达时已在门内的控制请求；后来的控制不能无限续期普通事务的等待。
      const waitingFor = [...gate.pending.values()];
      let timer;
      const expired = new Promise(resolve => { timer = setTimeout(resolve, CONTROL_PRIORITY_WAIT_MS); timer.unref?.(); });
      try { await Promise.race([Promise.all(waitingFor.map(entry => entry.settled)), expired]); }
      finally { clearTimeout(timer); }
    }
    try { return await operation(); }
    finally {
      if (priority) {
        const entry = gate.pending.get(ticket);
        entry?.resolve?.();
        gate.pending.delete(ticket);
        if (!gate.pending.size && this.#controlPriority.get(sessionId) === gate) this.#controlPriority.delete(sessionId);
      }
    }
  }
  #outboxRecordCovered(record) {
    if ([...this.#handles.values()].some(handle => this.pendingViewInstallation(handle, record.session_id))) return false;
    for (const view of this.#views.values()) {
      if (!view.active || view.sessionId !== record.session_id) continue;
      if (view.schemaVersion !== 2 || !this.spatialSupply.enabled(view.handle) || !this.spatialSupply.current(view.handle, view)) return false;
      const through = this.spatialSupply.cursor(view);
      if (through === null || BigInt(through) < BigInt(record.through_seq)) return false;
    }
    return true;
  }
  async #publishOutboxProgress(record) {
    const sessionId = record.session_id, command = 'outbox-progress', events = [];
    return this.#withControlPriority(sessionId, { kind: command }, async () => {
      const client = await this.pool.connect(); let committed = false, committing = false;
      try {
        await client.query('BEGIN');
        const row = (await client.query('SELECT session_id FROM sessions WHERE session_id=$1 FOR UPDATE', [sessionId])).rows[0];
        if (!row) throw new RuntimeError('SESSION_GONE', '本局不可访问。');
        // 同一排他切点重枚举当前读者与非单调的安装资格；旧枚举或旧binding不授予进度。
        const covered = this.#outboxRecordCovered(record);
        if (covered) {
          await client.query("UPDATE outbox SET status='Published',attempts=attempts+1 WHERE session_id=$1 AND through_seq=$2", [sessionId, record.through_seq]);
          await this.hooks.beforeCommit?.({ command, sessionId, events });
        }
        committing = true; await client.query('COMMIT'); committed = true;
        if (covered) await this.hooks.afterCommit?.({ command, sessionId, events });
        return covered;
      } catch (error) {
        if (!committed) await client.query('ROLLBACK').catch(() => {});
        if (committed || committing) throw new RuntimeError('OUTCOME_UNKNOWN', '提交结果尚未确认，请查询原动作身份。');
        throw error;
      } finally { client.release(); }
    }).catch(error => { if (error.code === 'SESSION_GONE') return true; throw error; });
  }
  async applyControlEffects(tx) {
    const actorIds = new Set(tx.events.filter(event => event.kind === 'control.changed').map(event => event.payload.actorId));
    if (!actorIds.size) return;
    const sessionId = tx.row.session_id;
    // 钩子期间不持锁；只在副作用执行时短暂重读当前绑定，避免检查与撤销之间再发生接管。
    await tx.client.query('BEGIN');
    try {
      const row = (await tx.client.query('SELECT state FROM sessions WHERE session_id=$1 FOR UPDATE', [sessionId])).rows[0];
      if (row) {
        for (const actorId of actorIds) {
          const actor = ownRecord(row.state.characters, actorId);
          if (terminal(row.state) || actor?.mode !== 'HumanControlled') continue;
          const handle = this.#handles.get(actor.activeConnectionId);
          if (handle) this.connection(handle).grants.set(sessionId, actor.controlEpoch);
          const view = this.#views.get(actor.activeConnectionId);
          if (view?.active && view.sessionId === sessionId && view.actorId === actorId) view.ownedEpoch = actor.controlEpoch;
        }
      }
      for (const [connectionId, previous] of tx.invalidated) {
        const current = ownRecord(row?.state.characters, previous.actorId);
        // 重新获权、终局后的合法读取及新订阅，都不属于旧事务可撤销的绑定。
        if (row && (terminal(row.state) || current?.activeConnectionId === connectionId)) continue;
        const view = this.#views.get(connectionId);
        if (view?.active && view.sessionId === sessionId && view.viewId === previous.viewId
          && (view.ownedEpoch === null || BigInt(view.ownedEpoch) <= BigInt(previous.controlEpoch))) {
          this.retireView(view, true);
        }
      }
      await tx.client.query('COMMIT');
    } catch (error) { await tx.client.query('ROLLBACK').catch(() => {}); throw error; }
  }
  async deadline(tx) {
    if (isSpatial(tx.state)) return spatial.advanceSpatialTime(tx);
    tx.clockTouched = true;
    if (tx.state.phase === 'Running' && tx.time >= tx.state.deadlineAt) {
      tx.emit('session.finished', { endingCode: tx.content.endingPolicy.codes.unresolved, facts: endingFacts(tx.state, tx.content) }, everyone(tx.state), { principalId: 'system', actionId: 'deadline' });
      await tx.client.query("UPDATE decisions SET record=jsonb_set(record,'{status}','\"Cancelled\"') WHERE session_id=$1 AND record->>'status'='Pending'", [tx.row.session_id]);
    }
  }
  async knownNonce(tx, principalId, nonce, semantic) {
    requireId(nonce);
    const found = (await tx.client.query('SELECT semantic_digest,response,response_text_encoding FROM command_nonces WHERE session_id=$1 AND principal_id=$2 AND nonce=$3', [tx.row.session_id, principalId, nonce])).rows[0];
    if (!found) return null;
    if (found.semantic_digest !== digest(semantic)) throw new RuntimeError('ACTION_ID_REUSE', '请求身份已用于其他内容。');
    return decodeJsonbText(found.response, found.response_text_encoding);
  }
  async saveNonce(tx, principalId, nonce, semantic, response) {
    const stored = isSpatial(tx.state) ? encodeJsonbText(response) : { value: response, encoding: null };
    await tx.client.query('INSERT INTO command_nonces(session_id,principal_id,nonce,semantic_digest,response,response_text_encoding) VALUES($1,$2,$3,$4,$5,$6)', [tx.row.session_id, principalId, nonce, digest(semantic), stored.value, stored.encoding]);
    return response;
  }
  async create(token, { nonce, contentVersion, capabilities = [] }) {
    checkDirectionCapability(this.spatialDirection, capabilities);
    requireId(nonce);
    await this.authenticate(token);
    let content;
    try { content = await loadContent(contentVersion); }
    catch { throw new RuntimeError('INVALID_MESSAGE', '内容版本当前不可用。'); }
    if (content.protocolCapability === 'spatial-v2') spatial.requireSpatialCapability(capabilities, content);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const user = await this.authenticate(token, client);
      await client.query('SELECT user_id FROM runtime_users WHERE user_id=$1 FOR UPDATE', [user.userId]);
      await this.authenticate(token, client);
      const prior = (await client.query('SELECT * FROM creation_nonces WHERE user_id=$1 AND nonce=$2', [user.userId, nonce])).rows[0];
      if (prior) {
        if (prior.content_version !== contentVersion) throw new RuntimeError('ACTION_ID_REUSE', '创建身份已用于其他内容。');
        if (!(await client.query('SELECT 1 FROM sessions WHERE session_id=$1', [prior.session_id])).rowCount) throw new RuntimeError('SESSION_GONE', '本局不可访问。');
        await client.query('COMMIT'); return { sessionId: prior.session_id };
      }
      const sessionId = id('S');
      const state = emptyWorld(sessionId, content);
      const time = new Date(this.now()).toISOString();
      const row = (await client.query('INSERT INTO sessions(session_id,host_user_id,name,session_seq,state,initial_state,content_snapshot,content_digest,reducer_version,logical_time) VALUES($1,$2,$3,0,$4,$4,$5,$6,$7,$8) RETURNING *', [sessionId, user.userId, `${user.name}的同行局`, state, content, contentDigest(content), content.reducerVersion, time])).rows[0];
      const tx = this.buildTransaction(client, row, { principalId: user.principalId, actionId: nonce });
      tx.emit('session.created', { contentVersion, reducerVersion: content.reducerVersion, hostUserId: user.userId, seed: id('seed') }, emptyAudience());
      const actorId = id('C');
      tx.emit('session.member_joined', { userId: user.userId, characterId: actorId, name: user.name }, { humanCharacterIds: [actorId], coreNpcCharacterIds: [], proxyCharacterIds: [actorId] });
      await client.query('INSERT INTO session_access(session_id,user_id,actor_id) VALUES($1,$2,$3)', [sessionId, user.userId, actorId]);
      await client.query('INSERT INTO creation_nonces(user_id,nonce,content_version,session_id) VALUES($1,$2,$3,$4)', [user.userId, nonce, contentVersion, sessionId]);
      await this.persist(tx); await client.query('COMMIT');
      return { sessionId };
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  async listSessions(token) {
    const user = await this.authenticate(token);
    const rows = (await this.pool.query("SELECT session_id,name,jsonb_array_length(state->'members') AS player_count,state->>'phase' AS phase,state->>'protocolCapability' AS capability,state->>'contentVersion' AS content_version,jsonb_build_object('contentVersion',state->>'contentVersion','chapterVersion',state->>'chapterVersion','mapVersion',state->>'mapVersion','variantId',state->>'variantId','reducerVersion',state->>'reducerVersion') AS profile FROM sessions s WHERE NOT archived AND (state->>'phase'='Lobby' OR EXISTS (SELECT 1 FROM session_access a WHERE a.session_id=s.session_id AND a.user_id=$1 AND a.active)) ORDER BY session_id", [user.userId])).rows;
    return rows.map(row => ({ sessionId: row.session_id, name: row.name, playerCount: row.player_count, phase: row.phase, ...(row.capability === 'spatial-v2' ? { protocolCapability: 'spatial-v2', contentVersion: row.content_version, requiredCapabilities: spatial.requiredSpatialCapabilities(row.profile) } : {}) }));
  }
  async join(token, sessionId, { nonce, capabilities = [] }) {
    checkDirectionCapability(this.spatialDirection, capabilities);
    await this.authenticate(token);
    return this.locked(sessionId, { kind: 'join' }, async tx => {
      if (isSpatial(tx.state)) spatial.requireSpatialCapability(capabilities, tx.state);
      const user = await this.authenticate(token, tx.client);
      if (tx.state.members.some(m => m.userId === user.userId)) await this.access(tx.client, tx.row, token);
      tx.cause = { principalId: user.principalId, actionId: nonce };
      const semantic = { kind: 'join', sessionId };
      const prior = await this.knownNonce(tx, user.principalId, nonce, semantic);
      if (prior) { await this.access(tx.client, tx.row, token); return prior; }
      await this.deadline(tx);
      const member = tx.state.members.find(m => m.userId === user.userId);
      if (member) {
        await this.access(tx.client, tx.row, token);
        return this.saveNonce(tx, user.principalId, nonce, semantic, isSpatial(tx.state) ? { sessionId } : { sessionId, actorId: member.characterId });
      }
      if (tx.state.phase !== 'Lobby' || tx.state.members.length >= 5) return new RuntimeError('FORBIDDEN', '本局当前不能加入新成员。');
      const actorId = id('C');
      tx.emit('session.member_joined', { userId: user.userId, characterId: actorId, name: user.name }, { ...everyone(tx.state), humanCharacterIds: [...everyone(tx.state).humanCharacterIds, actorId], proxyCharacterIds: [...everyone(tx.state).proxyCharacterIds, actorId] });
      if (isSpatial(tx.state)) spatial.refreshSpatialViews(tx);
      await tx.client.query('INSERT INTO session_access(session_id,user_id,actor_id) VALUES($1,$2,$3)', [sessionId, user.userId, actorId]);
      return this.saveNonce(tx, user.principalId, nonce, semantic, isSpatial(tx.state) ? { sessionId } : { sessionId, actorId });
    });
  }
  async start(token, sessionId, { nonce }) {
    await this.authenticate(token);
    return this.locked(sessionId, { kind: 'start' }, async tx => {
      const user = await this.access(tx.client, tx.row, token);
      tx.cause = { principalId: user.principalId, actionId: nonce, actorId: user.actorId };
      const semantic = { kind: 'start', sessionId };
      const prior = await this.knownNonce(tx, user.principalId, nonce, semantic); if (prior) return prior;
      await this.deadline(tx);
      if (user.userId !== tx.state.hostUserId || tx.state.phase !== 'Lobby' || tx.state.members.length < 2) return new RuntimeError('FORBIDDEN', '仅房主可在二至五名成员就绪后开始。');
      if (isSpatial(tx.state)) { await spatial.startSpatial(tx); return this.saveNonce(tx, user.principalId, nonce, semantic, { sessionId }); }
      const deadlineAt = new Date(Date.parse(tx.time) + tx.content.timing.durationSeconds * 1000).toISOString();
      tx.emit('session.started', { deadlineAt, characterIds: [...tx.state.members.map(m => m.characterId), ...tx.content.npcs.map(n => n.characterId)] });
      for (const actor of Object.values(tx.state.characters)) {
        const knowledgeIds = actor.kind === 'human' ? actor.initialKnowledgeIds : tx.content.npcs.find(n => n.characterId === actor.characterId).initialKnowledgeIds;
        const observationByKnowledge = new Map();
        for (const knowledgeId of knowledgeIds) observationByKnowledge.set(knowledgeId, registerKnowledge(tx, actor.characterId, knowledgeId));
        if (actor.kind === 'core_npc') {
          for (const belief of tx.content.npcs.find(n => n.characterId === actor.characterId).initialBeliefs) tx.emit('BeliefUpdated', { beliefId: belief.beliefId, holderId: actor.characterId, statement: belief.statement, confidence: belief.confidence, basedOnObservationIds: belief.basedOnKnowledgeIds.map(k => observationByKnowledge.get(k)), revision: '0' }, audienceFor(tx.state, [actor.characterId]));
        } else if (actor.mode !== 'HumanControlled') {
          tx.emit('control.changed', { actorId: actor.characterId, mode: 'GracePeriod', controlEpoch: increment(actor.controlEpoch), activeConnectionId: null, graceDeadlineAt: new Date(Date.parse(tx.time) + tx.content.timing.gracePeriodSeconds * 1000).toISOString() });
        }
      }
      return this.saveNonce(tx, user.principalId, nonce, semantic, { sessionId });
    });
  }
  async cancel(token, sessionId, { nonce }) {
    await this.authenticate(token);
    return this.locked(sessionId, { kind: 'cancel' }, async tx => {
      const user = await this.access(tx.client, tx.row, token);
      tx.cause = { principalId: user.principalId, actionId: nonce, actorId: user.actorId };
      const semantic = { kind: 'cancel', sessionId };
      const prior = await this.knownNonce(tx, user.principalId, nonce, semantic); if (prior) return prior;
      await this.deadline(tx);
      if (user.userId !== tx.state.hostUserId || tx.state.phase !== 'Lobby') return new RuntimeError('FORBIDDEN', '只有房主可以取消尚未开始的本局。');
      tx.emit('session.aborted', { reason: '房主取消开局。' });
      return this.saveNonce(tx, user.principalId, nonce, semantic, { sessionId });
    });
  }
  async snapshot(token, sessionId, capabilities = []) {
    checkDirectionCapability(this.spatialDirection, capabilities);
    await this.authenticate(token);
    return this.locked(sessionId, { kind: 'snapshot' }, async tx => {
      const user = await this.access(tx.client, tx.row, token);
      if (isSpatial(tx.state)) { spatial.requireSpatialCapability(capabilities, tx.state); await spatial.advanceSpatialTime(tx); return spatial.snapshotSpatial(tx, user.actorId, { capabilities }); }
      return validateContract('AuthorizedSnapshot', { schemaVersion: 1, type: 'world.snapshot', sessionId, viewId: `${user.actorId}:http-v1`, snapshotSeq: tx.state.sessionSeq, projection: authorizedProjection(tx.state, tx.content, user.actorId) });
    });
  }
  async recap(token, sessionId, query) {
    await this.authenticate(token);
    const spatialSession = await this.locked(sessionId, { kind: 'recap-version' }, async tx => {
      await this.access(tx.client, tx.row, token);
      return isGaolao(tx.state)?'gaolao':isSpatial(tx.state);
    });
    if(spatialSession==='gaolao')return readGaolaoRecap(this,token,sessionId,query);
    if (spatialSession) throw new RuntimeError('UPGRADE_REQUIRED', '空间历史请使用当前授权快照中的发生时记录。');
    return readRecap(this, token, sessionId, query);
  }
  connectionView(handle) { return this.#views.get(handle.connectionId); }
  connectionViewScope(handle, sessionId) {
    const connection = this.connection(handle);
    // 同会话由持久提交裁定；跨会话只允许较新的本地选择替换已安装的选择。
    if (connection.requestedViewScope?.sessionId !== sessionId) connection.requestedViewScope = { sessionId, generation: ++connection.viewScopeGeneration };
    return connection.requestedViewScope;
  }
  canInstallConnectionView(handle, view, scope) {
    const connection = this.connection(handle), current = this.#views.get(handle.connectionId);
    const sent = this.spatialSupply.cursor(current);
    const currentWater = sent !== null && BigInt(sent) > BigInt(current.cursor) ? sent : current?.cursor;
    return !connection.closing && this.#handles.get(handle.connectionId) === handle
      && scope.generation >= connection.installedViewScopeGeneration
      && (view.terminalGeneration === undefined || view.terminalGeneration === connection.terminalViewGeneration)
      && !(current?.sessionId === view.sessionId && current.scope.generation === scope.generation && BigInt(currentWater) > BigInt(view.cursor));
  }
  setConnectionView(handle, view, scope) {
    if (!this.canInstallConnectionView(handle, view, scope)) return false;
    const connection = this.connection(handle);
    this.retireView(this.#views.get(handle.connectionId));
    connection.viewScopeFence = Math.max(connection.viewScopeFence, scope.generation);
    connection.installedViewScopeGeneration = scope.generation;
    this.#views.set(handle.connectionId, { ...view, scope });
    if (connection.recoverableView && scope.generation >= connection.recoverableView.scope.generation) connection.recoverableView = null;
    return true;
  }
  rememberRecoverableView(handle, pending) {
    const connection = this.connection(handle), previous = connection.recoverableView;
    if (!this.canInstallConnectionView(handle, pending.view, pending.scope)) return;
    if (previous && (previous.scope.generation > pending.scope.generation
      || previous.scope.generation === pending.scope.generation && previous.view.sessionId === pending.view.sessionId && BigInt(previous.view.cursor) > BigInt(pending.view.cursor))) return;
    connection.recoverableView = pending;
  }
  stageSpatialView(tx, handle, view, scope, { recovery = false } = {}) {
    const connection = this.connection(handle);
    if (!recovery) {
      if (scope.generation < connection.viewScopeFence) throw new RuntimeError('RESYNC_REQUIRED', '当前连接已经采用较新的会话选择。');
      // 候选入事务即推进选择围栏；这不是提交成功标志，回滚也不重新授权旧请求。
      connection.viewScopeFence = scope.generation;
      // 终态读取共享固定水位；通过选择围栏后才分配安装代次，过期选择不能干扰新读取。
      if (view.terminalBinding) view = { ...view, terminalGeneration: ++connection.terminalViewGeneration };
    }
    const pending = { view, scope };
    connection.pendingViews.add(pending);
    tx.afterFinish.push(({ committed, committing }) => {
      connection.pendingViews.delete(pending);
      // COMMIT 响应丢失时仍可凭原 nonce 找回已提交结果，不再次提高 epoch。
      if (committing && !committed) this.rememberRecoverableView(handle, pending);
    });
    tx.afterCommit.push(async () => {
      // COMMIT 响应可能乱序；安装时短暂重取行锁，核对当前持久视图、控制与读权。
      try {
        await tx.client.query('BEGIN');
        const row = (await tx.client.query('SELECT state FROM sessions WHERE session_id=$1 FOR UPDATE', [view.sessionId])).rows[0];
        const binding = row?.state.views?.[view.actorId], actor = row?.state.characters?.[view.actorId];
        const access = (await tx.client.query('SELECT 1 FROM session_access WHERE session_id=$1 AND user_id=$2 AND actor_id=$3 AND active', [view.sessionId, view.userId, view.actorId])).rowCount;
        const currentBinding = row && (view.terminalBinding
          ? terminal(row.state) && row.state.sessionSeq === view.cursor
          : !terminal(row.state) && binding?.viewId === view.viewId);
        if (currentBinding && access && await this.liveConnection({ client: tx.client, time: new Date(this.now()).toISOString() }, handle)
          && (view.ownedEpoch === null || actor?.activeConnectionId === handle.connectionId && actor.controlEpoch === view.ownedEpoch)) {
          const installed = this.setConnectionView(handle, view, scope);
          if (installed && actor?.mode === 'HumanControlled' && actor.activeConnectionId === handle.connectionId) connection.grants.set(view.sessionId, actor.controlEpoch);
        }
        if (connection.recoverableView?.view.viewId === view.viewId) connection.recoverableView = null;
        await tx.client.query('COMMIT');
      } catch (error) {
        await tx.client.query('ROLLBACK').catch(() => {});
        this.rememberRecoverableView(handle, pending);
        throw error;
      }
    });
  }
  pendingViewInstallation(handle, sessionId = null) {
    const connection = this.connection(handle), current = this.#views.get(handle.connectionId);
    return [...connection.pendingViews, connection.recoverableView].some(pending => pending
      && (sessionId === null || pending.view.sessionId === sessionId)
      && (current?.sessionId !== pending.view.sessionId || current.viewId !== pending.view.viewId)
      && this.canInstallConnectionView(handle, pending.view, pending.scope));
  }
  async subscribe(handle, sessionId) {
    const connection = this.connection(handle);
    const scope = this.connectionViewScope(handle, sessionId);
    await this.authenticate(connection.token);
    return this.locked(sessionId, { kind: 'subscribe' }, async tx => {
      const user = await this.access(tx.client, tx.row, connection.token);
      if (!await this.liveConnection(tx, handle)) throw new RuntimeError('UNAUTHENTICATED', '当前连接已经失效。');
      if (isSpatial(tx.state)) {
        // 取得同会话行锁后再裁定选择代次；不能旋转一个已不允许安装的旧选择。
        if (scope.generation < connection.viewScopeFence) throw new RuntimeError('RESYNC_REQUIRED', '当前连接已经采用较新的会话选择。');
        spatial.requireSpatialCapability(connection.capabilities, tx.state); await spatial.advanceSpatialTime(tx);
        const current = tx.state.characters[user.actorId];
        // 另一条只读连接不能借订阅撤销当前控制者的引用；真正接管才更换控制视图。
        const heldElsewhere = current.mode === 'HumanControlled' && current.activeConnectionId !== handle.connectionId;
        const terminalBinding = terminal(tx.state) ? ensureView(tx, user.actorId, { rotate: true }) : null;
        const snapshot = await spatial.snapshotSpatial(tx, user.actorId, { connectionId: handle.connectionId, rotate: !heldElsewhere, binding: terminalBinding, capabilities: connection.capabilities });
        this.stageSpatialView(tx, handle, { active: true, sessionId, actorId: user.actorId, userId: user.userId, viewId: snapshot.viewId, cursor: snapshot.snapshotSeq, handle, ownedEpoch: current.activeConnectionId === handle.connectionId ? current.controlEpoch : null, schemaVersion: 2, ...(terminalBinding ? { terminalBinding } : {}) }, scope);
        return snapshot;
      }
      const viewId = id('view');
      const actor = ownRecord(tx.state.characters, user.actorId);
      this.setConnectionView(handle, { active: true, sessionId, actorId: user.actorId, userId: user.userId, viewId, cursor: tx.state.sessionSeq, handle, ownedEpoch: actor.activeConnectionId === handle.connectionId ? actor.controlEpoch : null }, scope);
      return validateContract('AuthorizedSnapshot', { schemaVersion: 1, type: 'world.snapshot', sessionId, viewId, snapshotSeq: tx.state.sessionSeq, projection: authorizedProjection(tx.state, tx.content, user.actorId, { connectionId: handle.connectionId }) });
    });
  }
  async stateAt(tx, throughSeq) {
    if (throughSeq === tx.state.sessionSeq) return tx.state;
    const read = this.#prefixStates.begin(tx, throughSeq, this.pool);
    if (read?.sequence === throughSeq) return read.state;
    const events = read?.sequence !== null && read?.sequence !== undefined
      ? (await tx.client.query('SELECT event,event_text_encoding FROM world_events WHERE session_id=$1 AND session_seq>$2 AND session_seq<=$3 ORDER BY session_seq', [tx.row.session_id, read.sequence, throughSeq])).rows
      : (await tx.client.query('SELECT event,event_text_encoding FROM world_events WHERE session_id=$1 AND session_seq<=$2 ORDER BY session_seq', [tx.row.session_id, throughSeq])).rows;
    let state = read?.state ?? tx.row.initial_state;
    for (const { event, event_text_encoding } of events) state = reduceWorld(state, decodeJsonbText(event, event_text_encoding), tx.content);
    if (state.sessionSeq !== throughSeq) throw new RuntimeError('RESYNC_REQUIRED', '所需事件前缀当前不可用。');
    this.#prefixStates.complete(read, tx, state, this.pool);
    return state;
  }
  async sync(handle, raw, internal = {}) {
    if (parseStrictJSON(raw)?.schemaVersion === 2) return spatial.syncSpatial(this, handle, parseSpatial('SyncRequestV2', raw), internal);
    const request = parseContract('SyncRequest', raw);
    const connection = this.connection(handle);
    await this.authenticate(connection.token);
    return this.locked(request.sessionId, { kind: 'sync' }, async tx => {
      const user = await this.access(tx.client, tx.row, connection.token);
      if (isSpatial(tx.state)) throw new RuntimeError('UPGRADE_REQUIRED', '此章节需要空间同步协议。');
      const view = this.#views.get(handle.connectionId);
      if (!view?.active || view.sessionId !== request.sessionId || view.viewId !== request.viewId || view.actorId !== user.actorId || BigInt(request.cursor) > BigInt(tx.state.sessionSeq)) throw new RuntimeError('RESYNC_REQUIRED', '请重新取得当前连接的授权快照。');
      const current = ownRecord(tx.state.characters, user.actorId);
      if (!terminal(tx.state) && view.ownedEpoch !== null && (current.activeConnectionId !== handle.connectionId || current.controlEpoch !== view.ownedEpoch)) {
        this.retireView(view); throw new RuntimeError('RESYNC_REQUIRED', '原连接的控制绑定已经失效。');
      }
      const throughSeq = String(BigInt(request.cursor) + 256n < BigInt(tx.state.sessionSeq) ? BigInt(request.cursor) + 256n : BigInt(tx.state.sessionSeq));
      const before = await this.stateAt(tx, request.cursor);
      const after = await this.stateAt(tx, throughSeq);
      const options = { connectionId: handle.connectionId };
      const beforeProjection = ownRecord(before.characters, user.actorId) ? authorizedProjection(before, tx.content, user.actorId, options) : null;
      const afterProjection = ownRecord(after.characters, user.actorId) ? authorizedProjection(after, tx.content, user.actorId, options) : null;
      const events = afterProjection && canonicalize(beforeProjection) !== canonicalize(afterProjection)
        ? [{ sessionSeq: throughSeq, eventId: `${request.sessionId}:E${throughSeq}`, kind: 'projection.replace', payload: { projection: afterProjection } }] : [];
      return validateContract('WorldBatch', { schemaVersion: 1, type: 'world.batch', sessionId: request.sessionId, viewId: view.viewId, fromExclusive: request.cursor, throughSeq, events });
    });
  }
  /** 原owner内只协调一个session；有限P逐行进度G与有限发送波次W各至多一个。 */
  async #publishSessionWaves(records, deliver, isStopped) {
    const sessionId = records[0].session_id;
    let head = records.at(-1).through_seq, generation = 0, attempted = -1, retryPage = false;
    let index = 0, published = 0, wave = null, progress = null, owedProgress = false;
    let draining = false, closed = false, mixed = false, firstError = null;
    let wake = Promise.withResolvers();
    const signal = () => { const previous = wake; wake = Promise.withResolvers(); previous.resolve(); };
    const views = () => [...this.#views.values()].filter(view => view.active && view.sessionId === sessionId);
    const halted = () => {
      mixed ||= views().some(view => view.schemaVersion !== 2 || !this.spatialSupply.enabled(view.handle));
      return isStopped() || mixed || firstError !== null;
    };
    const demand = through => {
      if (closed || draining) return;
      if (through !== null && through !== undefined && BigInt(through) > BigInt(head)) head = through;
      generation++; signal();
    };
    const onCommit = ({ sessionId: committedSession, events }) => {
      if (committedSession === sessionId && events.length) demand(events.at(-1).sessionSeq);
    };
    const onReady = ({ connectionId }) => { if (this.#views.get(connectionId)?.sessionId === sessionId) demand(null); };
    const fail = error => { firstError ??= error; signal(); };
    const covered = through => this.#outboxRecordCovered({ session_id: sessionId, through_seq: through });

    const startWave = () => {
      // H与候选集合在波次开始冻结；H不进入DTO，也不是读权或可信sent。
      const target = head, selected = views();
      attempted = generation; retryPage = false;
      wave = (async () => {
        let advanced = false;
        for (let offset = 0; offset < selected.length; offset += 5) {
          // 普通draining仍完成已冻结的后续组；stop/error/mixed则不再开始任何peer。
          if (halted()) break;
          const settled = await Promise.allSettled(selected.slice(offset, offset + 5).map(async view => {
            if (halted() || !view.active || this.pendingViewInstallation(view.handle)) return;
            try {
              const result = await this.spatialSupply.publish(view, target,
                (batch, binding) => deliver(binding.handle.connectionId, batch, binding));
              advanced ||= result.progressed === true;
            } catch (error) {
              if (error.keepSpatialPending) { fail(error); throw error; }
              if (error.code === 'RESYNC_REQUIRED' && this.pendingViewInstallation(view.handle)) return;
              if (['FORBIDDEN', 'UNAUTHENTICATED', 'RESYNC_REQUIRED', 'SESSION_GONE'].includes(error.code)) this.retireView(view, true);
              else { fail(error); throw error; }
            }
          }));
          const failed = settled.find(result => result.status === 'rejected');
          if (failed) fail(failed.reason);
        }
        // 每handle只有一次原lane调用；真实分页前进才允许同需求再获一个波次。
        retryPage = advanced && !covered(target);
      })().then(() => { wave = null; owedProgress = true; signal(); }, error => { wave = null; fail(error); });
    };
    const startProgress = record => {
      index++; owedProgress = false;
      progress = (async () => {
        await this.hooks.duringPublish?.({ sessionId, throughSeq: record.through_seq });
        // G已接纳后沿原helper自然收束；后来的W失败不能假取消它或撤销真实COMMIT。
        if (await this.#publishOutboxProgress(record)) published++;
      })().then(() => {
        progress = null;
        // 游标到尾不是终止：最后G实际settle后才禁新W，既有W仍须完成有限分组。
        if (index === records.length) draining = true;
        signal();
      }, error => { progress = null; if (index === records.length) draining = true; fail(error); });
    };

    // 先接线，再查询权威已提交提示；查询窗口内的通知与查询结果取最大值，不丢唤醒。
    this.on('commit', onCommit); this.on('spatial-supply-ready', onReady);
    try {
      const initial = (await this.pool.query('SELECT max(through_seq) AS through_seq FROM outbox WHERE session_id=$1', [sessionId])).rows[0]?.through_seq;
      if (initial !== null && initial !== undefined && BigInt(initial) > BigInt(head)) head = initial;
      for (;;) {
        const notified = wake.promise;
        if (halted()) break;
        if (!progress && index === records.length) draining = true;
        if (draining && !wave && !progress) break;
        if (!wave) {
          const record = records[index], ready = record && covered(record.through_seq);
          // 一个有限W结束后，可完成旧行保有下一次G机会，新hint不能擦掉它。
          if (!progress && ready && owedProgress) startProgress(record);
          else if (!draining && (generation !== attempted || retryPage) && !covered(head)) startWave();
          else if (!progress && record) {
            if (ready) startProgress(record);
            else { index++; owedProgress = false; continue; }
          }
        }
        if (!wave && !progress) continue;
        // 只等轻量通知，不以首个失败/停止冒充已排入lane、SQL或G的实际结束。
        await notified;
      }
    } finally {
      await Promise.allSettled([wave, progress].filter(Boolean));
      closed = true; this.off('commit', onCommit); this.off('spatial-supply-ready', onReady);
    }
    if (firstError) throw firstError;
    return published;
  }
  /** 发布器只读取已提交前缀；新计时模式须有可信入队证据，失败保留Pending。 */
  async publishPending(deliver = async () => {}, { capability = null, isStopped = () => false } = {}) {
    if (this.#publishing) return { busy: true, examined: 0, published: 0 };
    this.#publishing = true;
    let examined = 0, published = 0;
    try {
      const pending = (await this.pool.query("SELECT o.session_id,o.through_seq FROM outbox o JOIN sessions s ON s.session_id=o.session_id WHERE o.status='Pending' AND ($1::text IS NULL OR s.state->>'protocolCapability'=$1) ORDER BY o.session_id,o.through_seq", [capability])).rows;
      examined = pending.length;
      for (let recordIndex = 0; recordIndex < pending.length; recordIndex++) {
        const record = pending[recordIndex];
        if (isStopped()) break;
        let installationPending = [...this.#handles.values()].some(handle => this.pendingViewInstallation(handle, record.session_id));
        const views = [...this.#views.values()].filter(view => view.active && view.sessionId === record.session_id);
        const parallel = views.length > 0 && views.every(view => view.schemaVersion === 2 && this.spatialSupply.enabled(view.handle));
        if (parallel) {
          let end = recordIndex + 1;
          while (end < pending.length && pending[end].session_id === record.session_id) end++;
          published += await this.#publishSessionWaves(pending.slice(recordIndex, end), deliver, isStopped);
          recordIndex = end - 1;
          continue;
        }
        const publishView = async view => {
          try {
            for (;;) {
              if (!view.active) break;
              if (this.pendingViewInstallation(view.handle)) { installationPending = true; break; }
              if (view.schemaVersion === 2 && this.spatialSupply.enabled(view.handle)) {
                const result = await this.spatialSupply.publish(view, record.through_seq, (batch, binding) => deliver(binding.handle.connectionId, batch, binding));
                if (result.blocked) installationPending = true;
                if (result.blocked || result.ignored || result.covered) break;
                continue;
              }
              // 仅复用当前已安装视图自身的覆盖水位；旧通知不再次锁读动态新前缀。
              if (this.spatialDirection && view.schemaVersion === 2 && this.connectionView(view.handle) === view
                && this.connection(view.handle).capabilities.includes(directionCapability)
                && BigInt(view.cursor) >= BigInt(record.through_seq)) break;
              const batch = await this.sync(view.handle, JSON.stringify({ schemaVersion: view.schemaVersion ?? 1, type: 'sync.request', sessionId: view.sessionId, viewId: view.viewId, cursor: view.cursor }));
              if (batch.throughSeq === view.cursor) break;
              if (!view.active) break;
              await deliver(view.handle.connectionId, batch);
              view.cursor = batch.throughSeq;
              if (BigInt(batch.throughSeq) >= BigInt(record.through_seq)) break;
            }
          } catch (error) {
            if (error.keepSpatialPending) throw error;
            if (error.code === 'RESYNC_REQUIRED' && this.pendingViewInstallation(view.handle)) installationPending = true;
            else if (['FORBIDDEN', 'UNAUTHENTICATED', 'RESYNC_REQUIRED', 'SESSION_GONE'].includes(error.code)) this.retireView(view, true);
            else throw error;
          }
        };
        for (const view of this.#views.values()) {
          if (view.active && view.sessionId === record.session_id) await publishView(view);
        }
        // 安装等待不阻塞其他读者，也不能把等待中的新视图尚未收到的事件标为已发布。
        if (installationPending) continue;
        if (isStopped()) break;
        await this.hooks.duringPublish?.({ sessionId: record.session_id, throughSeq: record.through_seq });
        if (isStopped()) break;
        await this.locked(record.session_id, { kind: 'outbox-progress' }, async tx => {
          await tx.client.query("UPDATE outbox SET status='Published',attempts=attempts+1 WHERE session_id=$1 AND through_seq=$2", [record.session_id, record.through_seq]);
        }).catch(error => { if (error.code !== 'SESSION_GONE') throw error; });
        published++;
      }
      return { busy: false, examined, published };
    } finally { this.#publishing = false; }
  }
  /** 仅由可信传输适配器在真实连接建立后调用；请求正文不能创建此句柄。 */
  async openConnection(token, capabilities = []) {
    const user = await this.authenticate(token);
    checkDirectionCapability(this.spatialDirection, capabilities);
    const handle = Object.freeze({ connectionId: id('connection') });
    await this.pool.query('INSERT INTO connections(connection_id,user_id,lease_until) VALUES($1,$2,$3)', [handle.connectionId, user.userId, new Date(this.now() + 60_000).toISOString()]);
    this.#connections.set(handle, { ...user, token, capabilities: Object.freeze([...capabilities]), grants: new Map(), viewScopeGeneration: 0, viewScopeFence: 0, installedViewScopeGeneration: 0, terminalViewGeneration: 0, requestedViewScope: null, pendingViews: new Set(), recoverableView: null, closing: false });
    this.#handles.set(handle.connectionId, handle);
    return handle;
  }
  connection(handle) {
    const connection = this.#connections.get(handle);
    if (!connection) throw new RuntimeError('UNAUTHENTICATED', '连接身份无效。');
    return connection;
  }
  async liveConnection(tx, handle) {
    const connection = this.connection(handle);
    const result = await tx.client.query('SELECT 1 FROM connections WHERE connection_id=$1 AND user_id=$2 AND active AND lease_until>$3', [handle.connectionId, connection.userId, tx.time]);
    return result.rowCount > 0;
  }
  async control(handle, raw) {
    if (parseStrictJSON(raw)?.schemaVersion === 2) return spatial.controlSpatial(this, handle, parseSpatial('ControlRequestV2', raw));
    const request = parseContract('ControlRequest', raw);
    const connection = this.connection(handle);
    await this.authenticate(connection.token);
    const result = await this.locked(request.sessionId, { kind: request.type }, async tx => {
      const user = await this.access(tx.client, tx.row, connection.token);
      if (isSpatial(tx.state)) throw new RuntimeError('UPGRADE_REQUIRED', '此章节需要空间控制协议。');
      if (user.actorId !== request.actorId) throw new RuntimeError('FORBIDDEN', '当前账号没有该角色的控制权限。');
      const semantic = { ...request };
      const prior = await this.knownNonce(tx, user.principalId, request.nonce, semantic); if (prior) return prior;
      await this.deadline(tx);
      tx.cause = { principalId: user.principalId, actionId: request.nonce, actorId: user.actorId };
      let actor = ownRecord(tx.state.characters, user.actorId);
      let response;
      if (terminal(tx.state)) response = { schemaVersion: 1, code: 'FORBIDDEN', message: '本局已经结束，当前连接仅可读取。' };
      else if (!await this.liveConnection(tx, handle)) response = { schemaVersion: 1, code: 'UNAUTHENTICATED', message: '当前连接已经失效。' };
      else if (request.type === 'control.resume' && actor.mode === 'HumanControlled' && actor.activeConnectionId !== handle.connectionId) response = { schemaVersion: 1, code: 'CONTROL_HELD', message: '该角色由另一条连接控制；需要本人明确接管。' };
      else {
        if (actor.mode !== 'HumanControlled' || actor.activeConnectionId !== handle.connectionId || request.type === 'control.take') {
          tx.emit('control.changed', { actorId: user.actorId, mode: 'HumanControlled', controlEpoch: increment(actor.controlEpoch), activeConnectionId: handle.connectionId, graceDeadlineAt: null });
          await tx.client.query("UPDATE decisions SET record=jsonb_set(record,'{status}','\"Cancelled\"') WHERE session_id=$1 AND actor_id=$2 AND record->>'status'='Pending'", [request.sessionId, user.actorId]);
        }
        actor = ownRecord(tx.state.characters, user.actorId);
        response = validateContract('ControlResponse', { schemaVersion: 1, sessionId: request.sessionId, actorId: user.actorId, nonce: request.nonce, controlEpoch: actor.controlEpoch, mode: actor.mode, observedSeq: tx.state.sessionSeq });
      }
      return this.saveNonce(tx, user.principalId, request.nonce, semantic, response);
    });
    return result;
  }
  async disconnect(handle) {
    const connection = this.connection(handle);
    connection.closing = true;
    const grants = [...connection.grants.entries()];
    for (const [sessionId, epoch] of grants) {
      await this.locked(sessionId, { kind: 'disconnect', cause: { principalId: 'system', actionId: `disconnect:${handle.connectionId}` } }, async tx => {
        await this.deadline(tx);
        await tx.client.query('UPDATE connections SET active=false WHERE connection_id=$1', [handle.connectionId]);
        const member = tx.state.members.find(m => m.userId === connection.userId);
        const actor = member && ownRecord(tx.state.characters, member.characterId);
        if (!terminal(tx.state) && actor?.mode === 'HumanControlled' && actor.activeConnectionId === handle.connectionId && actor.controlEpoch === epoch) {
          tx.emit('control.changed', { actorId: actor.characterId, mode: 'GracePeriod', controlEpoch: increment(actor.controlEpoch), activeConnectionId: null, graceDeadlineAt: new Date(Date.parse(tx.time) + tx.content.timing.gracePeriodSeconds * 1000).toISOString() });
        }
        if (isSpatial(tx.state)) await spatial.advanceSpatialTime(tx);
      }).catch(error => { if (error.code !== 'SESSION_GONE') throw error; });
    }
    if (!grants.length) await this.pool.query('UPDATE connections SET active=false WHERE connection_id=$1', [handle.connectionId]);
    this.#handles.delete(handle.connectionId);
    this.retireView(this.#views.get(handle.connectionId));
  }
  async heartbeat(handle) {
    const connection = this.connection(handle);
    await this.authenticate(connection.token);
    await this.pool.query('UPDATE connections SET lease_until=$2 WHERE connection_id=$1 AND active', [handle.connectionId, new Date(this.now() + 60_000).toISOString()]);
  }
  async maintenance(sessionId) {
    return this.locked(sessionId, { kind: 'maintenance', cause: { principalId: 'system', actionId: 'maintenance' } }, async tx => {
      await this.deadline(tx);
      if (terminal(tx.state)) return;
      for (const actor of Object.values(tx.state.characters)) {
        if (actor.mode === 'HumanControlled') {
          const live = (await tx.client.query('SELECT 1 FROM connections WHERE connection_id=$1 AND active AND lease_until>$2', [actor.activeConnectionId, tx.time])).rowCount;
          if (!live) tx.emit('control.changed', { actorId: actor.characterId, mode: 'GracePeriod', controlEpoch: increment(actor.controlEpoch), activeConnectionId: null, graceDeadlineAt: new Date(Date.parse(tx.time) + tx.content.timing.gracePeriodSeconds * 1000).toISOString() });
        } else if (actor.mode === 'GracePeriod' && tx.time >= actor.graceDeadlineAt) {
          tx.emit('control.changed', { actorId: actor.characterId, mode: 'AIProxyControlled', controlEpoch: increment(actor.controlEpoch), activeConnectionId: null, graceDeadlineAt: null });
        }
      }
      await tx.client.query("UPDATE decisions SET record=jsonb_set(record,'{status}','\"Expired\"') WHERE session_id=$1 AND record->>'status'='Pending' AND (record->>'deadlineAt')::timestamptz<=$2", [sessionId, tx.time]);
    });
  }
  /** 高频切片只推进原共享空间时钟，不提前执行代理接管或决定过期维护。 */
  async spatialCheckpoint(sessionId) {
    if (!this.spatialDirection) return false;
    return this.locked(sessionId, { kind: 'spatial-checkpoint', cause: { principalId: 'system', actionId: 'spatial-checkpoint' } }, async tx => {
      const activeHuman = () => isSpatial(tx.state) && tx.state.phase === 'Running' && !tx.state.paused && Object.values(tx.state.characters).some(actor => actor.kind === 'human' && actor.mode === 'HumanControlled' && ['accepted', 'moving'].includes(actor.movement?.status));
      if (!activeHuman()) return false;
      await spatial.advanceSpatialTime(tx);
      return activeHuman();
    });
  }
  prepareDecision(handle, options) { return decisions.prepareDecision(this, handle, options); }
  prepareDecisionContext(handle) { return decisions.prepareDecisionContext(this, handle); }
  recoverDecisions(handle) { return decisions.recoverDecisions(this, handle); }
  decisionState(handle, decisionId) { return decisions.decisionState(this, handle, decisionId); }
  decisionReceipt(handle, decisionId, system = false) { return decisions.decisionReceipt(this, handle, decisionId, system); }
  submitIntent(handle, decisionId, raw) { return decisions.submitIntent(this, handle, decisionId, raw); }
  settleDecision(handle, decisionId, status) { return decisions.settleDecision(this, handle, decisionId, status); }
  submitFallback(handle, decisionId) { return decisions.submitFallback(this, handle, decisionId); }
  async receipt(token, sessionId, actionId) {
    requireId(actionId);
    await this.authenticate(token);
    // 收据读取不写世界状态，也不取会话行锁；仍复用原事务采样与返回校验。
    return this.locked(sessionId, { kind: 'receipt', readOnly: true }, async tx => {
      const user = await this.access(tx.client, tx.row, token);
      const row = (await tx.client.query('SELECT receipt,actor_id FROM action_receipts WHERE session_id=$1 AND principal_id=$2 AND client_action_id=$3', [sessionId, user.principalId, actionId])).rows[0];
      if (!row) return null;
      if (row.actor_id !== user.actorId) throw new RuntimeError('FORBIDDEN', '当前账号无权读取该角色的结果。');
      return clientReceipt(row.receipt);
    });
  }
  async submit(handle, raw) {
    if (parseStrictJSON(raw)?.schemaVersion === 2) return spatial.submitSpatial(this, handle, raw);
    const request = parseClientAction(raw);
    const semanticDigest = actionSemanticDigestSync(request);
    const connection = this.connection(handle);
    await this.authenticate(connection.token);
    return this.confirmOutcome(() => this.locked(request.sessionId, { kind: 'action' }, async tx => {
      const user = await this.access(tx.client, tx.row, connection.token);
      if (isSpatial(tx.state)) throw new RuntimeError('UPGRADE_REQUIRED', '此章节需要空间动作协议。');
      if (request.actorId !== user.actorId) throw new RuntimeError('FORBIDDEN', '当前账号没有该角色的结果读取权限。');
      return this.executeAction(tx, request, semanticDigest, { ...user, principalKind: 'human' }, async actor => actor.mode === 'HumanControlled' && actor.activeConnectionId === handle.connectionId && await this.liveConnection(tx, handle));
    }), () => this.receipt(connection.token, request.sessionId, request.clientActionId), () => semanticDigest);
  }
  async confirmOutcome(operation, lookup, expectedDigest) {
    try { return await operation(); }
    catch (error) {
      if (error.code === 'OUTCOME_UNKNOWN') {
        try {
          // lookup 先重新验证当前读权；同键结果还必须对应本次原始语义载荷。
          const found = await lookup();
          const semanticDigest = expectedDigest();
          if (found && semanticDigest) {
            if (found.semanticDigest !== semanticDigest) return { schemaVersion: 1, code: 'ACTION_ID_REUSE', message: '该动作身份已经用于其他内容。' };
            return found;
          }
        }
        catch (lookupError) { if (['FORBIDDEN', 'UNAUTHENTICATED', 'SESSION_GONE'].includes(lookupError.code)) throw lookupError; }
      }
      throw error;
    }
  }
  async internalReceipt(handle, actionId, system = false) {
    const principal = this.internal(handle);
    return this.locked(principal.sessionId, { kind: 'internal-receipt' }, async tx => {
      await this.authorizeInternal(tx, principal);
      const row = (await tx.client.query('SELECT receipt FROM action_receipts WHERE session_id=$1 AND principal_id=$2 AND client_action_id=$3 AND actor_id=$4', [principal.sessionId, system ? 'system' : principal.principalId, actionId, principal.actorId])).rows[0];
      return row ? row.receipt.schemaVersion===2?row.receipt.publicReceipt:clientReceipt(row.receipt) : null;
    });
  }
  /** 服务端内部模块领取限定 Session/角色的句柄；HTTP/Socket.IO 不暴露此入口。 */
  async bindInternal(sessionId, actorId, principalKind) {
    if (!['core_npc', 'scene_role', 'proxy'].includes(principalKind)) throw new RuntimeError('FORBIDDEN', '内部主体类型无效。');
    const result = await this.locked(sessionId, { kind: 'bind-internal' }, async tx => {
      const principal = { sessionId, actorId, principalKind, principalId: `${principalKind}:${actorId}` };
      await this.authorizeInternal(tx, principal);
      return principal;
    });
    const handle = Object.freeze({ sessionId, actorId, principalKind });
    this.#internals.set(handle, result); return handle;
  }
  async observeInternal(handle) {
    const principal = this.internal(handle);
    return this.locked(principal.sessionId, { kind: 'internal-observation' }, async tx => {
      await this.authorizeInternal(tx, principal);
      const actor = ownRecord(tx.state.characters, principal.actorId);
      if (!actor || actor.mode !== (principal.principalKind !== 'proxy' ? 'CoreNPCControlled' : 'AIProxyControlled') && !(isGaolao(tx.state)&&['Finished','Aborted'].includes(tx.state.phase))) throw new RuntimeError('FORBIDDEN', '该角色当前没有内部控制授权。');
      if (isSpatial(tx.state)) return spatial.snapshotSpatial(tx, principal.actorId, { principalKind: principal.principalKind, capabilities: ['spatial-v2', 'spatial-appearance-v1'] });
      return {
        sessionId: principal.sessionId, snapshotSeq: tx.state.sessionSeq,
        projection: authorizedProjection(tx.state, tx.content, principal.actorId, { principalKind: principal.principalKind }),
        beliefs: Object.values(tx.state.beliefs).filter(b => b.holderId === principal.actorId),
        goals: Object.values(tx.state.goals).filter(g => g.holderId === principal.actorId),
      };
    });
  }
  internal(handle) {
    const principal = this.#internals.get(handle);
    if (!principal) throw new RuntimeError('FORBIDDEN', '内部主体身份无效。');
    return principal;
  }
  async spatialContext(handle) { return buildSpatialContext(await this.observeInternal(handle)); }
  reserveSpatialIntent(handle, intentId, action) { return spatial.reserveSpatialIntent(this, handle, intentId, action); }
  reserveSpatialFallback(handle,intentId,action,reason) { return spatial.reserveSpatialIntent(this,handle,intentId,action,{mode:'fallback',reason}); }
  submitSpatialIntent(handle, intentId) { return spatial.submitSpatialIntent(this, handle, intentId); }
  prepareScenePolicy(handle,options) { return scenePolicy.prepareScenePolicy(this,handle,options); }
  recoverScenePolicy(handle) { return scenePolicy.recoverScenePolicy(this,handle); }
  async authorizeInternal(tx, principal) {
    const actor = ownRecord(tx.state.characters, principal.actorId);
    if (principal.sessionId !== tx.row.session_id || !actor || (principal.principalKind !== 'proxy' ? actor.kind !== 'core_npc' : actor.kind !== 'human')) throw new RuntimeError('FORBIDDEN', '内部主体绑定失效。');
    if(isGaolao(tx.state)&&principal.principalKind!=='proxy'&&(principal.principalKind==='scene_role' ? actor.actorKind!=='scene_role' : !['persistent_core','chapter_autonomous'].includes(actor.actorKind)))throw new RuntimeError('FORBIDDEN','内部角色职责不符。');
    if (principal.principalKind === 'proxy') {
      const access = await tx.client.query('SELECT 1 FROM session_access a JOIN runtime_users u ON u.user_id=a.user_id WHERE a.session_id=$1 AND a.actor_id=$2 AND a.active AND u.active', [principal.sessionId, principal.actorId]);
      if (!access.rowCount) throw new RuntimeError('FORBIDDEN', '该代理的当前访问权限已经撤销。');
    }
  }
  async executeAction(tx, request, semanticDigest, principal, authorized, options = {}) {
    tx.cause = { principalId: principal.principalId, actionId: request.clientActionId, actorId: principal.actorId, ...(options.decisionId ? { decisionId: options.decisionId } : {}) };
    const prior = (await tx.client.query('SELECT receipt,semantic_digest,actor_id FROM action_receipts WHERE session_id=$1 AND principal_id=$2 AND client_action_id=$3', [request.sessionId, principal.principalId, request.clientActionId])).rows[0];
    if (prior) {
      if (prior.actor_id !== principal.actorId) throw new RuntimeError('FORBIDDEN', '当前主体无权读取该角色的结果。');
      if (prior.semantic_digest !== semanticDigest) return { schemaVersion: 1, code: 'ACTION_ID_REUSE', message: '该动作身份已经用于其他内容。' };
      return clientReceipt(prior.receipt);
    }
    await this.deadline(tx);
    const before = tx.state;
    const eventCount = tx.events.length;
    let code = 'OK'; let status = 'Accepted';
    try {
      if (tx.state.phase !== 'Running') throw new RuleError('SESSION_NOT_RUNNING');
      const actor = ownRecord(tx.state.characters, principal.actorId);
      if (actor.controlEpoch !== request.controlEpoch || !await authorized(actor)) throw new RuleError(options.authorizationCode ?? 'STALE_CONTROL');
      if (BigInt(request.baseSeq) > BigInt(tx.state.sessionSeq)) throw new RuleError('FUTURE_BASE_SEQ');
      await options.validate?.();
      if (options.apply) options.apply(); else applyAction(tx, principal.actorId, principal.principalKind, request.action);
      const ending = evaluateEnding(tx.state, tx.content);
      if (ending) {
        tx.emit('session.finished', ending, everyone(tx.state), tx.events.at(-1)?.causedBy ?? tx.cause);
        await tx.client.query("UPDATE decisions SET record=jsonb_set(record,'{status}','\"Cancelled\"') WHERE session_id=$1 AND decision_id IS DISTINCT FROM $2 AND record->>'status'='Pending'", [request.sessionId, options.decisionId ?? null]);
      }
    } catch (error) {
      if (!(error instanceof RuleError)) throw error;
      tx.state = before; tx.events.length = eventCount;
      code = error.code; status = 'Rejected';
    }
    const effectEvents = tx.events.slice(eventCount);
    if (status === 'Accepted' && !effectEvents.length) code = 'NO_CHANGE';
    const receipt = validateContract('ActionReceipt', {
      schemaVersion: 1, key: { sessionId: request.sessionId, principalId: principal.principalId, clientActionId: request.clientActionId },
      semanticDigest, actorId: principal.actorId, observedSeq: tx.state.sessionSeq,
      actionEventRange: effectEvents.length ? { first: effectEvents[0].sessionSeq, last: effectEvents.at(-1).sessionSeq } : null,
      status, code, result: {},
    });
    await tx.client.query('INSERT INTO action_receipts(session_id,principal_id,client_action_id,actor_id,semantic_digest,receipt) VALUES($1,$2,$3,$4,$5,$6)', [request.sessionId, principal.principalId, request.clientActionId, principal.actorId, semanticDigest, receipt]);
    return clientReceipt(receipt);
  }
  /** 运维授权由调用方掌握；以下入口不注册为客户端或模型工具。 */
  async revokeAccess(sessionId, userId) {
    await this.locked(sessionId, { kind: 'revoke-access', cause: { principalId: 'system', actionId: `revoke:${userId}` } }, async tx => {
      await this.deadline(tx);
      const member = tx.state.members.find(m => m.userId === userId);
      if (!member) return;
      await tx.client.query('UPDATE session_access SET active=false WHERE session_id=$1 AND user_id=$2', [sessionId, userId]);
      if (!terminal(tx.state)) {
        const actor = ownRecord(tx.state.characters, member.characterId);
        tx.emit('control.changed', { actorId: actor.characterId, mode: 'Revoked', controlEpoch: increment(actor.controlEpoch), activeConnectionId: null, graceDeadlineAt: null });
      }
      await tx.client.query("UPDATE decisions SET record=jsonb_set(record,'{status}','\"Cancelled\"') WHERE session_id=$1 AND actor_id=$2 AND record->>'status'='Pending'", [sessionId, member.characterId]);
    });
    for (const view of this.#views.values()) if (view.sessionId === sessionId && view.userId === userId) this.retireView(view, true);
    this.emit('authorization', { sessionId, userId });
  }
  async abortSession(sessionId, reason) {
    if (typeof reason !== 'string' || !reason || reason.length > 500) throw new RuntimeError('INVALID_MESSAGE', '终止原因格式无效。');
    return this.locked(sessionId, { kind: 'abort', cause: { principalId: 'system', actionId: 'abort' } }, async tx => {
      await this.deadline(tx);
      if (terminal(tx.state)) return;
      tx.emit('session.aborted', { reason });
      await tx.client.query("UPDATE decisions SET record=jsonb_set(record,'{status}','\"Cancelled\"') WHERE session_id=$1 AND record->>'status'='Pending'", [sessionId]);
    });
  }
  async archiveSession(sessionId) {
    return this.locked(sessionId, { kind: 'archive' }, async tx => {
      await this.deadline(tx);
      if (!terminal(tx.state)) return new RuntimeError('FORBIDDEN', '只有结束后的 Session 可以归档。');
      await tx.client.query('UPDATE sessions SET archived=true WHERE session_id=$1', [sessionId]);
    });
  }
  async deleteSession(sessionId) {
    const result = await this.locked(sessionId, { kind: 'delete' }, async tx => {
      await this.deadline(tx);
      if (!terminal(tx.row.state)) return new RuntimeError('FORBIDDEN', '只有已经结束的 Session 可以删除。');
      await tx.client.query('DELETE FROM sessions WHERE session_id=$1', [sessionId]);
      tx.afterCommit.push(() => this.#prefixStates.clearSession(sessionId));
    });
    for (const view of this.#views.values()) if (view.sessionId === sessionId) this.retireView(view, true);
    return result;
  }
  async replay(sessionId, throughSeq) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const row = (await client.query('SELECT * FROM sessions WHERE session_id=$1', [sessionId])).rows[0];
      if (!row) throw new RuntimeError('SESSION_GONE', '本局不可访问。');
      if (row.content_digest !== contentDigest(row.content_snapshot)) throw new Error('本局固定内容摘要不一致。');
      const persistedState = decodeJsonbText(row.state, row.state_text_encoding);
      const through = throughSeq ?? persistedState.sessionSeq;
      if (BigInt(through) > BigInt(persistedState.sessionSeq) || BigInt(through) < 0n) throw new RuntimeError('RESYNC_REQUIRED', '回放水位无效。');
      const events = (await client.query('SELECT event,event_text_encoding FROM world_events WHERE session_id=$1 AND session_seq<=$2 ORDER BY session_seq', [sessionId, through])).rows;
      let state = row.initial_state;
      for (const { event, event_text_encoding } of events) state = reduceWorld(state, decodeJsonbText(event, event_text_encoding), row.content_snapshot);
      if (state.sessionSeq !== through) throw new Error('持久日志缺少连续前缀。');
      await client.query('COMMIT'); return state;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
}
