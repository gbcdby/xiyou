import { gaolaoObjectVisual } from '../content/gaolao-object-visuals.mjs';
import { createHmac, randomBytes } from 'node:crypto';
import { validateSpatial, gaolaoPersonalProfile } from '../protocol/spatial.mjs';
import { distance, clearSegment } from './spatial-geometry.mjs';
import { isGaolao, emptyGaolaoChapter, setupGaolaoState, observerName, projectGaolao, gaolaoOperations } from './gaolao-world.mjs';
import { createPersonalState } from './gaolao-personal-contract.mjs';
import { RuleError } from './rules.mjs';
import { visibleAppearance } from './spatial-appearance.mjs';
export const opaqueRef = () => 'R' + randomBytes(24).toString('base64url');
export const isSpatial = state => state.protocolCapability === 'spatial-v2';
export const next = value => String(BigInt(value) + 1n);
function safeProjection(value) {
    try {
        return validateSpatial('ProjectionV2', value);
    }
    catch (error) {
        throw new Error('空间投影生成失败。', { cause: error });
    }
}
export function emptySpatialWorld(sessionId, content) {
    return { sessionId, sessionSeq: '0', protocolCapability: 'spatial-v2', contentVersion: content.contentVersion, reducerVersion: content.reducerVersion, chapterVersion: content.chapterVersion, mapVersion: content.mapVersion, variantId: content.variantId, hostUserId: null, seed: null, phase: 'Lobby', members: [], characters: {}, items: {}, targets: {}, observations: {}, claims: {}, cooperations: {}, views: {}, sceneTimeMs: 0, wallAnchorMs: null, paused: true, onlineMembershipVersion: '0', ending: null, ...(gaolaoPersonalProfile(content)?{chapter:{...emptyGaolaoChapter(),...createPersonalState()}}:{}) };
}
function actor(id, name, actorKind = 'human') {
    return { characterId: id, name, appearanceName: name, appearanceEpoch: '0', kind: actorKind === 'human' ? 'human' : 'core_npc', actorKind, sceneId: null, position: null, facing: 'S', spatialRevision: '0', resourceRevision: '0', controlEpoch: '0', mode: 'Revoked', activeConnectionId: null, graceDeadlineAt: null, movement: null, planVersion: '0', capabilities: ['move_to', 'stop_move', 'inspect', 'take_item', 'put_item', 'transfer_item', 'reclaim_public_item', 'cooperate', 'interact', 'speak', 'make_claim', 'share_evidence', 'wait'] };
}
export function reduceSpatialWorld(previous, event, content) {
    if ((!['spatial-world-v2','gaolao-world-v1'].includes(previous.reducerVersion) && !(gaolaoPersonalProfile(previous)&&gaolaoPersonalProfile(content))) || content.reducerVersion !== previous.reducerVersion || event.schemaVersion !== 2 || event.sessionId !== previous.sessionId || event.sessionSeq !== next(previous.sessionSeq))
        throw new Error('空间事件不属于当前解释器的连续前缀。');
    // 旧版本曾在终态记录 spatial.view；保留原日志回放，新读取由 ensureView 保持只读。
    if (['Finished', 'Aborted'].includes(previous.phase) && event.kind !== 'spatial.view')
        throw new Error('终局之后不能追加空间事实。');
    const state = structuredClone(previous), p = event.payload;
    switch (event.kind) {
        case 'session.created':
            state.hostUserId = p.hostUserId;
            state.seed = p.seed;
            break;
        case 'session.member_joined':
            state.members.push(p);
            state.characters[p.characterId] = actor(p.characterId, p.name);
            break;
        case 'spatial.started':
            state.phase = 'Running';
            state.wallAnchorMs = p.wallAnchorMs;
            state.members.forEach((m, i) => Object.assign(state.characters[m.characterId], content.spawns[i]));
            for (const npc of content.npcs)
                state.characters[npc.characterId] = { ...actor(npc.characterId, npc.name, npc.actorKind), sceneId: npc.sceneId, position: npc.position, mode: 'CoreNPCControlled', controlEpoch: '1' };
            for (const item of content.items)
                state.items[item.itemId] = { itemId: item.itemId, name: item.name, appearanceEpoch: '0', location: { kind: 'ground', sceneId: item.sceneId, position: item.position }, resourceRevision: '0', transferable: item.transferable, publicBorrowable: item.publicBorrowable, fields: item.fields, lockedBy: null };
            for (const target of content.targets)
                state.targets[target.targetId] = { ...target, appearanceEpoch: '0', resourceRevision: '0' };
            setupGaolaoState(state,content);
            break;
        case 'gaolao.membership':
            if(!isGaolao(state))throw new Error('旧解释器不支持章节成员事件。');
            state.onlineMembershipVersion=p.version;
            break;
        case 'gaolao.chapter':
            if(!isGaolao(state)||state.chapter?.cuilanSafe&&!p.chapter.cuilanSafe)throw new Error('安全事实不得回滚。');
            state.chapter=p.chapter;
            break;
        case 'control.changed': {
            const a = state.characters[p.actorId];
            Object.assign(a, p);
            if (a.movement && ['accepted', 'moving'].includes(a.movement.status))
                a.movement = { ...a.movement, status: 'cancelled', reason: '控制来源已经变更。' };
            for (const c of Object.values(state.cooperations))
                if (c.phase !== 'locked')
                    delete c.ready[p.actorId];
            if(!isGaolao(state))state.onlineMembershipVersion = next(state.onlineMembershipVersion);
            if(isGaolao(state)&&state.chapter){for(const f of Object.values(state.chapter.follows)){if([f.subjectId,f.leaderId].includes(p.actorId)&&['accepted','following','arrived'].includes(f.status)){f.status='paused';f.reason='控制来源变化，请本人重新确认。';f.planVersion=next(f.planVersion);}}}
            break;
        }
        case 'spatial.clock':
            state.sceneTimeMs = p.sceneTimeMs;
            state.wallAnchorMs = p.wallAnchorMs;
            state.paused = p.paused;
            break;
        case 'spatial.actor':
            state.characters[p.actor.characterId] = p.actor;
            break;
        case 'spatial.item':
            state.items[p.item.itemId] = p.item;
            break;
        case 'spatial.target':
            state.targets[p.target.targetId] = p.target;
            break;
        case 'spatial.cooperation':
            state.cooperations[p.cooperation.operationId] = p.cooperation;
            break;
        case 'spatial.view':
            state.views[p.actorId] = p.view;
            break;
        case 'spatial.observation':
            state.observations[p.observerId] ??= [];
            state.observations[p.observerId].push(p.observation);
            break;
        case 'spatial.claim':
            for (const [id, claim] of Object.entries(p.views)) {
                state.claims[id] ??= [];
                state.claims[id].push(claim);
            }
            break;
        case 'session.aborted':
        case 'session.finished':
            state.phase = event.kind === 'session.aborted' ? 'Aborted' : 'Finished';
            state.ending = { title: p.title ?? '本局已经结束', summary: p.reason ?? p.summary ?? '本局已经结束。',...(isGaolao(state)?{...(p.endingCode?{endingCode:p.endingCode}:{}),facts:p.facts??[]}: {}) };
            for (const a of Object.values(state.characters)) {
                a.mode = 'Revoked';
                a.controlEpoch = next(a.controlEpoch);
                a.activeConnectionId = null;
                if (a.movement && ['accepted', 'moving'].includes(a.movement.status))
                    a.movement = { ...a.movement, status: 'cancelled', reason: '本局已经结束。' };
            }
            break;
        default: throw new Error('当前空间解释器不支持该事件。');
    }
    state.sessionSeq = event.sessionSeq;
    return state;
}
export const sceneOf = (content, id) => content.scenes.find(s => s.sceneId === id);
export const conditionMet = (state, condition) => !condition || state.targets[condition.targetId]?.fields.some(f => f.key === condition.field && f.value === condition.value);
export const obstacleEnabled = (state) => o => !o.disabledWhen || !conditionMet(state, o.disabledWhen);
export function locationOf(state, entity) {
    if (entity.position)
        return { sceneId: entity.sceneId, position: entity.position };
    if (entity.location?.kind === 'ground')
        return entity.location;
    if (entity.location?.kind === 'character')
        return state.characters[entity.location.characterId];
    return null;
}
export function inRange(state, content, a, b, radius) { return !!(a?.position && b?.position && a.sceneId === b.sceneId && distance(a.position, b.position) <= radius); }
export function unoccluded(state, content, a, b) { const scene = sceneOf(content, a?.sceneId); return !!(scene && a?.position && b?.position && a.sceneId === b.sceneId && clearSegment(scene, a.position, b.position, obstacleEnabled(state))); }
export function canSee(state, content, observerId, entity) { const a = state.characters[observerId], b = locationOf(state, entity); return state.phase === 'Lobby' && entity.kind === 'human' || entity.characterId === observerId || entity.location?.characterId === observerId || inRange(state, content, a, b, content.movement.sightRadius) && unoccluded(state, content, a, b); }
/** 真人的物理显示范围独立于事件感知；他人的持有物从不进入场景地物。 */
export function publicPhysical(state, observerId, entity) {
    const observer = state.characters[observerId], at = locationOf(state, entity);
    return Boolean(observer?.sceneId && at?.sceneId === observer.sceneId && at.position && (!entity.itemId || entity.location.kind === 'ground'));
}
/** 只记录已发生的同场轨迹；与 NPC 的视距/遮挡轨迹分开保存和输出。 */
export function publicMotionViews(state, actor, segments, from, through) {
    return Object.fromEntries(Object.values(state.characters).filter(observer => observer.kind === 'human' && observer.sceneId === actor.sceneId && state.views[observer.characterId]).map(observer => [observer.characterId, {
        viewId: state.views[observer.characterId].viewId, sceneId: actor.sceneId, appearanceEpoch: actor.appearanceEpoch,
        motionTrail: segments, motionFromSceneTimeMs: from, motionThroughSceneTimeMs: through,
    }]));
}
function sceneOverview(state, content, actorId, view, includeAppearance, includeObjectVisual) {
    const motionFor = actor => {
        const motion = actor.publicMotionViews?.[actorId];
        return motion?.viewId === view.viewId && motion.sceneId === actor.sceneId && motion.appearanceEpoch === actor.appearanceEpoch && JSON.stringify(motion.motionTrail.at(-1)) === JSON.stringify(actor.position)
            ? { motionTrail: motion.motionTrail, motionFromSceneTimeMs: motion.motionFromSceneTimeMs, motionThroughSceneTimeMs: motion.motionThroughSceneTimeMs } : {};
    };
    const visualFor = (object, id) => {
        const visual = includeObjectVisual ? gaolaoObjectVisual(state, id) : {};
        let visualState = 'default';
        if (visual.visualKey === 'timber-door') {
            const value = object.fields.find(field => field.key === 'open')?.value;
            if (typeof value === 'boolean') visualState = value ? 'open' : 'closed';
        } else if (object.itemId && visual.visualKey) visualState = object.fields.find(field => field.key === 'fixed')?.value === true ? 'fixed' : 'loose';
        return { ...visual, visualState };
    };
    return {
        entities: Object.values(state.characters).filter(c => publicPhysical(state, actorId, c)).map(c => ({ entityRef: entityRef(view, c.characterId), name: observerName(state, actorId, c), appearanceEpoch: publicAppearanceEpoch(state,actorId,view,c), resourceRevision: publicResourceRevision(state,actorId,view,c), moving: ['accepted', 'moving'].includes(c.movement?.status) || state.chapter?.follows?.[c.characterId]?.status === 'following', ...(includeAppearance ? { appearanceId: visibleAppearance(state, content, c) } : {}), sceneId: c.sceneId, position: c.position, facing: c.facing, ...motionFor(c) })).sort((x, y) => x.entityRef.localeCompare(y.entityRef)),
        items: Object.values(state.items).filter(i => publicPhysical(state, actorId, i)).map(i => ({ entityRef: entityRef(view, i.itemId), name: i.name, resourceRevision: i.resourceRevision, location: i.location, ...visualFor(i, i.itemId) })).sort((x, y) => x.entityRef.localeCompare(y.entityRef)),
        targets: Object.values(state.targets).filter(t => publicPhysical(state, actorId, t)).map(t => ({ entityRef: entityRef(view, t.targetId), name: t.name, resourceRevision: t.resourceRevision, sceneId: t.sceneId, position: t.position, ...visualFor(t, t.targetId) })).sort((x, y) => x.entityRef.localeCompare(y.entityRef)),
    };
}
// 原世界锚点还服务剧情、私物与测试站位；公开地图只发布已确认的导航地标，不复制内部标签。
const gaolaoMapLabels = {
    'gaolao-courtyard': { C01: '铜封门', C02: '门撑左侧', C03: '门撑右侧', C04: '侧窗', C11: '客房门口', C14: '公用工具架', C15: '旧饭账', C16: '待客座席', C17: '前厅', C18: '前庭', C19: '庄口', C20: '去庄外短路' },
    'gaolao-village-road': { R01: '回高家院落', R03: '茶棚', R04: '茶棚后间门口', R08: '云栈洞口', R10: '庄外会面处', R11: '离庄路口', R13: '茶棚座席', R15: '道路岔口' },
};
function publicMapCatalog(content) {
    return content.scenes.map(({ sceneId, name, width, height, unitsPerPixel, walkableAreas, anchors, exits }) => {
        const labels = isGaolao(content) ? gaolaoMapLabels[sceneId] ?? {} : {};
        const publicAnchors = anchors.flatMap(({ anchorId, position }) => {
            const exit = exits.find(exit => exit.anchorId === anchorId);
            const label = labels[anchorId] ?? (exit ? `前往${content.scenes.find(scene => scene.sceneId === exit.destinationSceneId)?.name ?? '下一处场景'}` : undefined);
            return label ? [{ anchorId, label, position }] : [];
        });
        return { sceneId, name, width, height, unitsPerPixel, walkableAreas, anchors: publicAnchors, exits: exits.map(({ exitId, anchorId, destinationSceneId, destination }) => ({ exitId, anchorId, destinationSceneId, destination })) };
    });
}
export function ensureView(tx, actorId, { rotate = false, viewId = opaqueRef() } = {}) {
    const old = tx.state.views[actorId], readOnly = ['Finished', 'Aborted'].includes(tx.state.phase);
    if (old && !rotate && Object.values({ ...tx.state.characters, ...tx.state.items, ...tx.state.targets }).every(e => old.bindings[e.characterId ?? e.itemId ?? e.targetId]?.appearanceEpoch === (e.appearanceEpoch ?? '0')))
        return old;
    const bindings = rotate ? {} : structuredClone(old?.bindings ?? {});
    for (const [id, e] of Object.entries({ ...tx.state.characters, ...tx.state.items, ...tx.state.targets }))
        if (!bindings[id] || bindings[id].appearanceEpoch !== e.appearanceEpoch)
            bindings[id] = { ref: opaqueRef(), appearanceEpoch: e.appearanceEpoch };
    const view = { viewId: rotate || !old ? viewId : old.viewId, viewEpoch: rotate || !old ? next(old?.viewEpoch ?? '0') : old.viewEpoch, createdAtSeq: rotate || !old ? (readOnly ? tx.state.sessionSeq : next(tx.state.sessionSeq)) : old.createdAtSeq ?? '0', bindings };
    if (!readOnly) tx.emit('spatial.view', { actorId, view }, { humanCharacterIds: [], coreNpcCharacterIds: [], proxyCharacterIds: [] });
    return view;
}
export const entityRef = (view, id) => view.bindings[id]?.ref;
/** wire 版本只作相等比较；私有随机 seed 使公开 ref + 小计数不能被穷举还原。 */
function publicCharacterVersion(state, observerId, view, character, field) {
    if (typeof state.seed !== 'string' || !state.seed || !view?.bindings[character.characterId])
        throw new Error('空间公开版本缺少已持久会话或观察者绑定。');
    const message = JSON.stringify(['spatial-character-version-v1', state.sessionId, observerId, view.viewId, entityRef(view, character.characterId), field, character[field]]);
    return BigInt('0x' + createHmac('sha256', state.seed).update(message).digest('hex')).toString(10);
}
export const publicAppearanceEpoch = (state, observerId, view, character) => publicCharacterVersion(state, observerId, view, character, 'appearanceEpoch');
// 人物资源版本也随变貌变化，不能成为另一条身份计数信道；静态物件原合同保持。
export const publicResourceRevision = (state, observerId, view, entity) => entity.characterId ? publicCharacterVersion(state, observerId, view, entity, 'resourceRevision') : entity.resourceRevision;
export function resolveRef(tx, actorId, ref, viewId, { visible = true } = {}) {
    const view = tx.state.views[actorId];
    if (!view || view.viewId !== viewId)
        throw new RuleError('STALE_REFERENCE');
    const pair = Object.entries(view.bindings).find(([, b]) => b.ref === ref);
    const id = pair?.[0], entity = tx.state.characters[id] ?? tx.state.items[id] ?? tx.state.targets[id];
    if (!entity || pair[1].appearanceEpoch !== entity.appearanceEpoch || visible && !canSee(tx.state, tx.content, actorId, entity))
        throw new RuleError('STALE_REFERENCE');
    if (entity.itemId && entity.location.kind === 'character' && entity.location.characterId !== actorId && !entity.publicBorrowable)
        throw new RuleError('STALE_REFERENCE');
    return entity;
}
export function spatialProjection(state, content, actorId, { connectionId = null, highWater = '0', view = state.views[actorId], principalKind = 'human', includeAppearance = false, includeObjectVisual = false, includeSceneOverview = false, includeDirection = false } = {}) {
    const a = state.characters[actorId];
    const publicActor = c => ({ entityRef: entityRef(view, c.characterId), name: observerName(state,actorId,c), ...(includeAppearance ? { appearanceId: visibleAppearance(state, content, c) } : {}), ...(isGaolao(state)&&state.chapter?{resourceRevision:publicResourceRevision(state,actorId,view,c),availableOperations:gaolaoOperations(state,content,actorId,c)}:{}), appearanceEpoch: publicAppearanceEpoch(state,actorId,view,c), sceneId: c.sceneId, position: c.position, facing: c.facing });
    const visible = Object.values(state.characters).filter(c => canSee(state, content, actorId, c));
    const entities = visible.map(c => { const motion = c.motionViews?.[actorId]; return { ...publicActor(c), ...(motion?.viewId === view.viewId ? { motionTrail: motion.motionTrail, motionFromSceneTimeMs: motion.motionFromSceneTimeMs, motionThroughSceneTimeMs: motion.motionThroughSceneTimeMs } : {}) }; }).sort((x, y) => x.entityRef.localeCompare(y.entityRef));
    const items = Object.values(state.items).filter(i => i.location.kind !== 'consumed' && canSee(state, content, actorId, i) && (i.location.kind === 'ground' || i.location.characterId === actorId || i.publicBorrowable)).map(i => ({ ...(includeObjectVisual ? gaolaoObjectVisual(state, i.itemId) : {}), entityRef: entityRef(view, i.itemId), name: i.name, location: i.location.kind === 'ground' ? i.location : { kind: 'held', ownerRef: entityRef(view, i.location.characterId) }, resourceRevision: i.resourceRevision, transferable: i.transferable, publicBorrowable: i.publicBorrowable, fields: i.fields, ...(i.publicBorrowable && i.location.kind === 'character' && state.characters[i.location.characterId]?.mode === 'AIProxyControlled' ? { reclaimHolderEpoch: state.characters[i.location.characterId].controlEpoch } : {}) }));
    const targets = Object.values(state.targets).filter(t => canSee(state, content, actorId, t)).map(t => ({ ...(includeObjectVisual ? gaolaoObjectVisual(state, t.targetId) : {}), entityRef: entityRef(view, t.targetId), name: t.name, sceneId: t.sceneId, position: t.position, resourceRevision: t.resourceRevision, availableOperations: t.operationIds.filter(id => content.operations.some(op => op.operationId === id && op.kind === 'interaction')), fields: t.fields }));
    const currentScene = sceneOf(content, a.sceneId);
    const scene = currentScene ? { sceneId: currentScene.sceneId, name: currentScene.name, width: currentScene.width, height: currentScene.height, unitsPerPixel: currentScene.unitsPerPixel, walkableAreas: currentScene.walkableAreas, obstacles: currentScene.obstacles.filter(obstacleEnabled(state)).map(({ obstacleId, polygon, exceptAreas }) => ({ obstacleId, polygon, exceptAreas })), anchors: currentScene.anchors, exits: currentScene.exits.map(({ exitId, anchorId, destinationSceneId, destination, requirement }) => ({ exitId, anchorId, destinationSceneId, destination, open: conditionMet(state, requirement) })) } : null;
    const movement = a.movement ? Object.fromEntries(['movementId', 'planVersion', 'movementCommandSeq', 'sceneId', 'mapVersion', 'goal', 'path', 'acceptedAtSceneTime', 'status', 'reason'].filter(k => a.movement[k] !== undefined).map(k => [k, a.movement[k]])) : null;
    return safeProjection({ protocolCapability: 'spatial-v2', chapterVersion: state.chapterVersion, mapVersion: state.mapVersion, variantId: state.variantId, contentVersion: state.contentVersion, reducerVersion: state.reducerVersion, phase: state.phase, sceneTimeMs: state.sceneTimeMs, paused: state.paused, self: { ...publicActor(a), controlEpoch: a.controlEpoch, canControl: principalKind === 'human' && a.mode === 'HumanControlled' && connectionId === a.activeConnectionId, capabilities: [...a.capabilities, ...(includeDirection && principalKind === 'human' ? ['move_direction'] : [])], movementCommandHighWater: highWater }, entities, items, targets, scene, movement, ...(includeSceneOverview && principalKind === 'human' ? { sceneOverview: sceneOverview(state, content, actorId, view, includeAppearance, includeObjectVisual), mapCatalog: publicMapCatalog(content) } : {}), observations: (state.observations[actorId] ?? []).filter(o => principalKind !== 'proxy' || o.shareable).slice(-256), claims: (state.claims[actorId] ?? []).filter(c => principalKind === 'human' || c.channel !== 'team').slice(-256), cooperations: content.operations.filter(def => def.kind === 'cooperation' && state.targets[def.targetId] && canSee(state, content, actorId, state.targets[def.targetId])).map(def => { const record = state.cooperations[def.operationId]; return { operationId: def.operationId, operationVersion: record?.version ?? '0', phase: record?.phase ?? 'preparing', readyCount: Object.keys(record?.ready ?? {}).length, requiredCount: def.requiredCount, anchors: def.anchorIds.map(id => currentScene.anchors.find(anchor => anchor.anchorId === id).position) }; }), objectives: content.objectives, ending: state.ending,...(isGaolao(state)&&state.chapter?{chapter:projectGaolao(state,content,actorId,view)}:{}) });
}
