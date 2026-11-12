import { createHash } from 'node:crypto';
import { canonicalize } from '../protocol/index.mjs';
import { validateSpatial, parseSpatial } from '../protocol/spatial.mjs';
import { RuntimeError } from './errors.mjs';
import { RuleError } from '../game/rules.mjs';
import { encodeJsonbText, decodeJsonbText } from './jsonb-text.mjs';
import { isSpatial, opaqueRef, next, ensureView, entityRef, spatialProjection, resolveRef } from '../game/spatial-world.mjs';
import { applySpatialAction, advanceSpatialPositions, invalidateReady } from '../game/spatial-rules.mjs';
import { isGaolao, observeGaolao } from '../game/gaolao-world.mjs';
import { initializeGaolao,updateGaolaoPresence,advanceGaolaoFollow,checkGaolaoFallback } from '../game/gaolao-rules.mjs';
import {gaolaoNavigationDependencies,gaolaoNavigationRejection} from '../game/gaolao-navigation.mjs';
const digest = value => createHash('sha256').update(canonicalize(value)).digest('hex');
export function requireSpatialCapability(capabilities) {
    if (!Array.isArray(capabilities) || !capabilities.includes('spatial-v2'))
        throw new RuntimeError('UPGRADE_REQUIRED', '此章节需要 spatial-v2 客户端。');
}
export async function highWater(tx, actor) { const row = (await tx.client.query('SELECT handled_seq FROM spatial_command_sources WHERE session_id=$1 AND actor_id=$2 AND control_epoch=$3', [tx.row.session_id, actor.characterId, actor.controlEpoch])).rows[0]; return row?.handled_seq ?? '0'; }
export async function advanceSpatialTime(tx) {
    if (!isSpatial(tx.state) || ['Finished', 'Aborted'].includes(tx.state.phase))
        return;
    const wall = Date.parse(tx.time), actors = Object.values(tx.state.characters).filter(a => a.kind === 'human' && a.mode === 'HumanControlled');
    const leases = [];
    for (const a of actors) {
        const row = (await tx.client.query('SELECT active,lease_until FROM connections WHERE connection_id=$1', [a.activeConnectionId])).rows[0];
        if (row)
            leases.push({ actorId: a.characterId, active: row.active, until: Date.parse(row.lease_until) });
    }
    tx.liveActorIds = new Set(leases.filter(l => l.active && l.until > wall).map(l => l.actorId));
    updateGaolaoPresence(tx);
    const activeCount = leases.filter(l => l.active && l.until > wall).length;
    const sorted = leases.map(l => l.until).sort((a, b) => b - a), cutoff = sorted.length >= 2 ? Math.min(wall, sorted[1]) : tx.state.wallAnchorMs;
    const delta = tx.state.phase === 'Running' && !tx.state.paused && tx.state.wallAnchorMs !== null ? Math.max(0, cutoff - tx.state.wallAnchorMs) : 0;
    const sceneTimeMs = tx.state.sceneTimeMs + delta, paused = tx.state.phase !== 'Running' || activeCount < 2;
    if (delta)
        advanceSpatialPositions(tx, sceneTimeMs);
    else
        invalidateReady(tx);
    advanceGaolaoFollow(tx,sceneTimeMs,paused);
    if (delta || tx.state.wallAnchorMs === null || paused !== tx.state.paused)
        tx.emit('spatial.clock', { sceneTimeMs, wallAnchorMs: wall, paused });
}
export async function startSpatial(tx) {
    tx.emit('spatial.started', { wallAnchorMs: Date.parse(tx.time) });
    initializeGaolao(tx);
    // Lobby 已有的视图继续使用；开局新实体的绑定必须与开局事实同事务提交。
    for (const actorId of Object.keys(tx.state.views))
        ensureView(tx, actorId);
    for (const actor of Object.values(tx.state.characters))
        if (actor.kind === 'human' && actor.mode !== 'HumanControlled')
            tx.emit('control.changed', { actorId: actor.characterId, mode: 'GracePeriod', controlEpoch: next(actor.controlEpoch), activeConnectionId: null, graceDeadlineAt: new Date(Date.parse(tx.time) + tx.content.timing.gracePeriodSeconds * 1000).toISOString() });
    await advanceSpatialTime(tx);
}
export function refreshSpatialViews(tx) {
    for (const actorId of Object.keys(tx.state.views))
        ensureView(tx, actorId);
}
export async function snapshotSpatial(tx, actorId, { connectionId = null, rotate = false, viewId, principalKind = 'human' } = {}) {
    const view = ensureView(tx, actorId, { rotate, ...(viewId ? { viewId } : {}) });
    return validateSpatial('SnapshotV2', { schemaVersion: 2, type: 'world.snapshot', sessionId: tx.row.session_id, viewId: view.viewId, snapshotSeq: tx.state.sessionSeq, projection: spatialProjection(tx.state, tx.content, actorId, { connectionId, principalKind, highWater: await highWater(tx, tx.state.characters[actorId]) }) });
}
export async function recoverSpatial(runtime) {
    const rows = (await runtime.pool.query("SELECT session_id FROM sessions WHERE state->>'protocolCapability'='spatial-v2' AND state->>'phase' IN ('Lobby','Running')")).rows;
    for (const row of rows)
        await runtime.locked(row.session_id, { kind: 'spatial-recovery', cause: { principalId: 'system', actionId: 'spatial-recovery' } }, async (tx) => {
            // 恢复先持久提高每个控制来源的 epoch；宕机时间不进入场景时钟。
            tx.emit('spatial.clock', { sceneTimeMs: tx.state.sceneTimeMs, wallAnchorMs: Date.parse(tx.time), paused: true });
            for (const a of Object.values(tx.state.characters))
                tx.emit('control.changed', { actorId: a.characterId, mode: a.kind === 'human' ? 'GracePeriod' : 'CoreNPCControlled', controlEpoch: next(a.controlEpoch), activeConnectionId: null, graceDeadlineAt: a.kind === 'human' ? new Date(Date.parse(tx.time) + tx.content.timing.gracePeriodSeconds * 1000).toISOString() : null });
            await tx.client.query("UPDATE decisions SET record=jsonb_set(record,'{status}','\"Cancelled\"') WHERE session_id=$1 AND record->>'status'='Pending'", [row.session_id]);
        });
}
export async function controlSpatial(runtime, handle, request) {
    const connection = runtime.connection(handle);
    requireSpatialCapability(connection.capabilities);
    const scope = runtime.connectionViewScope(handle, request.sessionId);
    return runtime.locked(request.sessionId, { kind: request.type }, async (tx) => {
        const user = await runtime.access(tx.client, tx.row, connection.token);
        if (!isSpatial(tx.state))
            throw new RuntimeError('INVALID_MESSAGE');
        tx.cause = { principalId: user.principalId, actionId: request.nonce, actorId: user.actorId };
        const prior = await runtime.knownNonce(tx, user.principalId, request.nonce, request);
        if (prior) {
            // 只恢复本连接待安装的原结果；重放历史 nonce 不重新选择或绑定旧会话。
            const recovery = connection.recoverableView;
            if (recovery?.view.viewId === prior.snapshot.viewId && recovery.view.sessionId === request.sessionId) runtime.stageSpatialView(tx, handle, recovery.view, recovery.scope, { recovery: true });
            return prior;
        }
        await advanceSpatialTime(tx);
        if (['Finished', 'Aborted'].includes(tx.state.phase))
            throw new RuntimeError('FORBIDDEN', '本局已经结束。');
        const view = tx.state.views[user.actorId];
        if (view?.viewId !== request.viewId || entityRef(view, user.actorId) !== request.actorRef)
            throw new RuntimeError('STALE_REFERENCE', '请重新读取当前视图。');
        const actor = tx.state.characters[user.actorId];
        if (!await runtime.liveConnection(tx, handle))
            throw new RuntimeError('UNAUTHENTICATED');
        if (request.type === 'control.resume' && actor.mode === 'HumanControlled' && actor.activeConnectionId !== handle.connectionId)
            throw new RuntimeError('CONTROL_HELD', '该角色由另一条连接控制。');
        if (actor.activeConnectionId !== handle.connectionId || actor.mode !== 'HumanControlled' || request.type === 'control.take')
            tx.emit('control.changed', { actorId: user.actorId, mode: 'HumanControlled', controlEpoch: next(actor.controlEpoch), activeConnectionId: handle.connectionId, graceDeadlineAt: null });
        await advanceSpatialTime(tx);
        const snapshot = await snapshotSpatial(tx, user.actorId, { connectionId: handle.connectionId, rotate: true });
        runtime.stageSpatialView(tx, handle, { active: true, sessionId: request.sessionId, actorId: user.actorId, userId: user.userId, viewId: snapshot.viewId, cursor: snapshot.snapshotSeq, handle, ownedEpoch: tx.state.characters[user.actorId].controlEpoch, schemaVersion: 2 }, scope);
        const response = validateSpatial('ControlResponseV2', { schemaVersion: 2, sessionId: request.sessionId, nonce: request.nonce, controlEpoch: tx.state.characters[user.actorId].controlEpoch, observedSeq: tx.state.sessionSeq, snapshot });
        return runtime.saveNonce(tx, user.principalId, request.nonce, request, response);
    });
}
export async function executeSpatial(runtime, tx, request, principal, authorized) {
    tx.cause = { principalId: principal.principalId, actionId: request.clientActionId, actorId: principal.actorId };
    await advanceSpatialTime(tx);
    const semanticDigest = digest(request), key = [request.sessionId, principal.principalId, request.clientActionId];
    const prior = (await tx.client.query('SELECT receipt,semantic_digest,actor_id FROM action_receipts WHERE session_id=$1 AND principal_id=$2 AND client_action_id=$3', key)).rows[0];
    if (prior) {
        if (prior.actor_id !== principal.actorId)
            throw new RuntimeError('FORBIDDEN');
        if (prior.semantic_digest !== semanticDigest)
            throw new RuntimeError('ACTION_ID_REUSE');
        return prior.receipt.publicReceipt;
    }
    let code = 'OK', status = 'Accepted', result = {}, before = tx.state, eventCount = tx.events.length;
    try {
        const actor = tx.state.characters[principal.actorId];
        if (actor.controlEpoch !== request.controlEpoch || !await authorized(actor))
            throw new RuleError('STALE_CONTROL');
        if (['move_to', 'stop_move'].includes(request.action.kind)) {
            const current = await highWater(tx, actor);
            if (BigInt(request.action.movementCommandSeq) <= BigInt(current))
                throw new RuleError('STALE_MOVEMENT_COMMAND');
            await tx.client.query('INSERT INTO spatial_command_sources(session_id,actor_id,control_epoch,handled_seq) VALUES($1,$2,$3,$4) ON CONFLICT(session_id,actor_id,control_epoch) DO UPDATE SET handled_seq=EXCLUDED.handled_seq', [request.sessionId, actor.characterId, actor.controlEpoch, request.action.movementCommandSeq]);
        }
        if (tx.state.phase !== 'Running')
            throw new RuleError('SESSION_NOT_RUNNING');
        if (BigInt(request.baseSeq) > BigInt(tx.state.sessionSeq))
            throw new RuleError('FUTURE_BASE_SEQ');
        const view = tx.state.views[principal.actorId];
        if (view?.viewId !== request.viewId || entityRef(view, principal.actorId) !== request.actorRef)
            throw new RuleError('STALE_REFERENCE');
        const navigationDependencies=principal.executionContext?.navigationDependencies??null,rejection=gaolaoNavigationRejection(tx.state,principal.actorId,navigationDependencies);
        if(rejection)throw new RuleError(rejection);
        if(principal.executionContext?.mode==='fallback'){checkGaolaoFallback(tx,principal.actorId,request.action);observeGaolao(tx,principal.actorId,{statement:'技术降级按现有授权与稳定安全目标执行；不代作新的同意或去留决定。',fields:[{key:'reason',label:'技术原因',value:principal.executionContext.reason}]});}
        result = applySpatialAction(tx, principal.actorId, principal.principalKind, request,navigationDependencies);
        if(isGaolao(tx.state))refreshSpatialViews(tx);
    }
    catch (error) {
        if (!(error instanceof RuleError))
            throw error;
        tx.state = before;
        tx.events.length = eventCount;
        status = 'Rejected';
        code = error.code;
        result = {};
    }
    const events = tx.events.slice(eventCount);
    if (status === 'Accepted' && !events.length)
        code = 'NO_CHANGE';
    const publicReceipt = validateSpatial('ReceiptV2', { schemaVersion: 2, sessionId: request.sessionId, clientActionId: request.clientActionId, status, code, observedSeq: tx.state.sessionSeq, actionEventRange: events.length ? { first: events[0].sessionSeq, last: events.at(-1).sessionSeq } : null, result });
    const receipt = { schemaVersion: 2, actorId: principal.actorId, semanticDigest, publicReceipt };
    await tx.client.query('INSERT INTO action_receipts(session_id,principal_id,client_action_id,actor_id,semantic_digest,receipt) VALUES($1,$2,$3,$4,$5,$6)', [...key, principal.actorId, semanticDigest, receipt]);
    return publicReceipt;
}
export async function submitSpatial(runtime, handle, raw) {
    const request = parseSpatial('PublicEnvelope', raw), connection = runtime.connection(handle);
    requireSpatialCapability(connection.capabilities);
    await runtime.authenticate(connection.token);
    try {
        return await runtime.locked(request.sessionId, { kind: 'spatial-action' }, async (tx) => {
            const user = await runtime.access(tx.client, tx.row, connection.token);
            if (!isSpatial(tx.state))
                throw new RuntimeError('INVALID_MESSAGE');
            return executeSpatial(runtime, tx, request, { ...user, principalKind: 'human' }, async (actor) => actor.mode === 'HumanControlled' && actor.activeConnectionId === handle.connectionId && await runtime.liveConnection(tx, handle));
        });
    }
    catch (error) {
        if (error.code !== 'OUTCOME_UNKNOWN')
            throw error;
        return runtime.locked(request.sessionId, { kind: 'spatial-receipt-recovery' }, async (tx) => {
            const user = await runtime.access(tx.client, tx.row, connection.token);
            const found = (await tx.client.query('SELECT receipt,semantic_digest FROM action_receipts WHERE session_id=$1 AND principal_id=$2 AND client_action_id=$3', [request.sessionId, user.principalId, request.clientActionId])).rows[0];
            if (!found)
                throw error;
            if (found.semantic_digest !== digest(request))
                throw new RuntimeError('ACTION_ID_REUSE');
            return found.receipt.publicReceipt;
        });
    }
}
export async function syncSpatial(runtime, handle, request) {
    const connection = runtime.connection(handle);
    requireSpatialCapability(connection.capabilities);
    return runtime.locked(request.sessionId, { kind: 'spatial-sync' }, async (tx) => {
        const user = await runtime.access(tx.client, tx.row, connection.token), view = runtime.connectionView(handle), binding = tx.state.views[user.actorId], actor = tx.state.characters[user.actorId];
        if (!view?.active || view.viewId !== request.viewId || binding?.viewId !== request.viewId || view.sessionId !== request.sessionId || view.actorId !== user.actorId || BigInt(request.cursor) > BigInt(tx.state.sessionSeq) || BigInt(request.cursor) < BigInt(binding?.createdAtSeq ?? '0'))
            throw new RuntimeError('RESYNC_REQUIRED');
        if (view.ownedEpoch !== null && !['Finished', 'Aborted'].includes(tx.state.phase) && (actor.activeConnectionId !== handle.connectionId || actor.controlEpoch !== view.ownedEpoch))
            throw new RuntimeError('RESYNC_REQUIRED');
        // 公开投影停在已提交事务末尾，不能把空间检查点/合作效果拆在分页两侧。
        const limit = String(BigInt(request.cursor) + 256n < BigInt(tx.state.sessionSeq) ? BigInt(request.cursor) + 256n : BigInt(tx.state.sessionSeq));
        const boundary = (await tx.client.query('SELECT through_seq FROM outbox WHERE session_id=$1 AND through_seq>$2 AND through_seq<=$3 ORDER BY through_seq DESC LIMIT 1', [request.sessionId, request.cursor, limit])).rows[0]
            ?? (await tx.client.query('SELECT through_seq FROM outbox WHERE session_id=$1 AND through_seq>$2 AND through_seq<=$3 ORDER BY through_seq LIMIT 1', [request.sessionId, request.cursor, tx.state.sessionSeq])).rows[0];
        const throughSeq = boundary?.through_seq ?? request.cursor;
        const state = await runtime.stateAt(tx, throughSeq);
        const events = throughSeq === request.cursor ? [] : [{ sessionSeq: throughSeq, eventId: `${request.sessionId}:E${throughSeq}`, kind: 'projection.replace', payload: { projection: spatialProjection(state, tx.content, user.actorId, { connectionId: handle.connectionId, highWater: await highWater(tx, actor) }) } }];
        return validateSpatial('BatchV2', { schemaVersion: 2, type: 'world.batch', sessionId: request.sessionId, viewId: request.viewId, fromExclusive: request.cursor, throughSeq, events });
    });
}
/** 内部导航在意图创建时预留序号；后续提交/降级均使用原持久请求。 */
export async function reserveSpatialIntent(runtime, handle, intentId, action, executionContext={mode:'intent'}) {
    if(!executionContext||Object.keys(executionContext).some(k=>!['mode','reason'].includes(k))||!(executionContext.mode==='intent'&&executionContext.reason===undefined||executionContext.mode==='fallback'&&['model_timeout','invalid_output','ineffective_twice'].includes(executionContext.reason)))throw new RuntimeError('INVALID_MESSAGE');
    const principal = runtime.internal(handle);
    validateSpatial('Id', intentId);
    if (Object.hasOwn(action, 'movementCommandSeq'))
        throw new RuntimeError('INVALID_MESSAGE', '内部导航序号只能由可信分配器生成。');
    const navigation=['move_to','stop_move'].includes(action.kind);
    validateSpatial('ActionV2', navigation?{ ...action, movementCommandSeq: '1' }:action);
    return runtime.locked(principal.sessionId, { kind: 'spatial-intent-reserve' }, async (tx) => {
        await runtime.authorizeInternal(tx, principal);
        if (!isSpatial(tx.state))
            throw new RuntimeError('INVALID_MESSAGE');
        await advanceSpatialTime(tx);
        const old = (await tx.client.query('SELECT request,request_text_encoding,actor_id,execution_context FROM spatial_intents WHERE session_id=$1 AND intent_id=$2', [principal.sessionId, intentId])).rows[0];
        if (old) {
            if (old.actor_id !== principal.actorId)
                throw new RuntimeError('FORBIDDEN');
            const original=decodeJsonbText(old.request,old.request_text_encoding);
            const { movementCommandSeq, ...oldAction } = original.action;
            const {navigationDependencies,...originalExecutionContext}=old.execution_context;
            if (canonicalize(oldAction) !== canonicalize(action) || canonicalize(originalExecutionContext)!==canonicalize(executionContext))
                throw new RuntimeError('ACTION_ID_REUSE');
            return original;
        }
        if(!navigation&&!isGaolao(tx.state))throw new RuntimeError('INVALID_MESSAGE');
        const actor = tx.state.characters[principal.actorId], mode = principal.principalKind === 'proxy' ? 'AIProxyControlled' : 'CoreNPCControlled';
        if (actor.mode !== mode)
            throw new RuntimeError('FORBIDDEN');
        const row = navigation ? (await tx.client.query('INSERT INTO spatial_command_sources(session_id,actor_id,control_epoch,issued_seq) VALUES($1,$2,$3,1) ON CONFLICT(session_id,actor_id,control_epoch) DO UPDATE SET issued_seq=GREATEST(spatial_command_sources.issued_seq,spatial_command_sources.handled_seq)+1 RETURNING issued_seq', [principal.sessionId, principal.actorId, actor.controlEpoch])).rows[0] : null;
        const view = ensureView(tx, principal.actorId), request = { schemaVersion: 2, sessionId: principal.sessionId, viewId: view.viewId, actorRef: entityRef(view, principal.actorId), clientActionId: intentId, controlEpoch: actor.controlEpoch, baseSeq: tx.state.sessionSeq, action: { ...action, ...(navigation?{movementCommandSeq:row.issued_seq}:{}) } };
        const stored=encodeJsonbText(request),context={...executionContext,...(isGaolao(tx.state)&&action.kind==='move_to'?{navigationDependencies:gaolaoNavigationDependencies(tx.state,tx.content,principal.actorId,action)}:{})};
        await tx.client.query('INSERT INTO spatial_intents(session_id,intent_id,actor_id,control_epoch,request,execution_context,request_text_encoding) VALUES($1,$2,$3,$4,$5,$6,$7)', [principal.sessionId, intentId, principal.actorId, actor.controlEpoch, stored.value,context,stored.encoding]);
        return request;
    });
}
export async function submitSpatialIntent(runtime, handle, intentId) {
    const principal = runtime.internal(handle);
    return runtime.locked(principal.sessionId, { kind: 'spatial-intent-submit' }, async (tx) => {
        await runtime.authorizeInternal(tx, principal);
        const row = (await tx.client.query('SELECT request,request_text_encoding,execution_context FROM spatial_intents WHERE session_id=$1 AND intent_id=$2 AND actor_id=$3', [principal.sessionId, intentId, principal.actorId])).rows[0];
        if (!row)
            throw new RuntimeError('FORBIDDEN');
        return executeSpatial(runtime, tx, decodeJsonbText(row.request,row.request_text_encoding), {...principal,executionContext:row.execution_context}, async (actor) => actor.mode === (principal.principalKind === 'proxy' ? 'AIProxyControlled' : 'CoreNPCControlled'));
    });
}
