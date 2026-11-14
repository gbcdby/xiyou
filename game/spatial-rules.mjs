import { RuleError } from './rules.mjs';
import { opaqueRef, next, sceneOf, obstacleEnabled, conditionMet, locationOf, inRange, unoccluded, canSee, ensureView, entityRef, resolveRef } from './spatial-world.mjs';
import { findPath, walkable, clearSegment, pointAlongPath, facingAlongPath, distance, visibleSegment } from './spatial-geometry.mjs';
import { isGaolao, observerName, copyGaolaoEvidence } from './gaolao-world.mjs';
import { applyGaolaoAction,checkGaolaoMovement,checkGaolaoItem } from './gaolao-rules.mjs';
import {gaolaoNavigationRejection} from './gaolao-navigation.mjs';
const refuse = code => { throw new RuleError(code); };
const active = plan => plan && ['accepted', 'moving'].includes(plan.status);
const online = (tx, a) => a?.kind === 'human' && a.mode === 'HumanControlled' && tx.liveActorIds?.has(a.characterId);
const emitActor = (tx, a) => tx.emit('spatial.actor', { actor: a });
const emitItem = (tx, item) => tx.emit('spatial.item', { item });
const emitTarget = (tx, target) => tx.emit('spatial.target', { target });
const near = (tx, a, b) => {
    if (!inRange(tx.state, tx.content, a, locationOf(tx.state, b), tx.content.movement.interactionRadius))
        refuse('OUT_OF_RANGE');
    if (!unoccluded(tx.state, tx.content, a, locationOf(tx.state, b)))
        refuse('OCCLUDED');
};
/** 所有角色以同一场景时间结算，生成可回放检查点；不接受客户端位置。 */
export function advanceSpatialPositions(tx, sceneTimeMs) {
    const before = tx.state;
    for (const current of Object.values(tx.state.characters)) {
        if (!active(current.movement))
            continue;
        const a = structuredClone(current), p = a.movement, scene = sceneOf(tx.content, a.sceneId);
        const related = tx.state.characters[p.relatedTarget?.id] ?? tx.state.items[p.relatedTarget?.id] ?? tx.state.targets[p.relatedTarget?.id];
        if (p.controlEpoch !== a.controlEpoch || p.mapVersion !== tx.state.mapVersion || gaolaoNavigationRejection(tx.state,a.characterId,p.chapterDependencies) || p.relatedTarget && (!related || related.appearanceEpoch !== p.relatedTarget.appearanceEpoch || related.resourceRevision !== p.relatedTarget.resourceRevision || related.spatialRevision !== p.relatedTarget.spatialRevision || active(related.movement))) {
            p.status = 'cancelled';
            p.reason = '导航目标或控制版本已经失效。';
            emitActor(tx, a);
            continue;
        }
        const travel = (sceneTimeMs - p.acceptedAtSceneTime) * tx.content.movement.speedPerSecond / 1000;
        const nextPoint = pointAlongPath(p.path, travel);
        // 检查自上个检查点至新检查点经过的每一段，不能从折线路径跨墙抄近路。
        const previousPoint = pointAlongPath(p.path, p.travelled ?? 0);
        const segments = [a.position, ...p.path.slice(previousPoint.index, nextPoint.index), nextPoint.position];
        if (segments.some((point, i) => i && !clearSegment(scene, segments[i - 1], point, obstacleEnabled(tx.state)))) {
            p.status = 'blocked';
            p.reason = '通路状态已经改变。';
            emitActor(tx, a);
            continue;
        }
        if (distance(a.position, nextPoint.position) > 0) {
            a.facing = facingAlongPath(segments, a.facing);
            a.position = nextPoint.position;
            a.spatialRevision = next(a.spatialRevision);
        }
        p.travelled = travel;
        p.status = nextPoint.arrived ? 'arrived' : 'moving';
        a.motionViews = {};
        for (const observer of Object.values(before.characters)) {
            const view = before.views[observer.characterId];
            // 观察者同期运动或重建视图时宁可不给轨迹，也不能追补当时未看见的区段。
            if (!view || observer.sceneId !== a.sceneId || !observer.position || active(observer.movement))
                continue;
            if (segments.every((point, i) => i === 0 || visibleSegment(scene, observer.position, segments[i - 1], point, tx.content.movement.sightRadius, obstacleEnabled(before))))
                a.motionViews[observer.characterId] = { viewId: view.viewId, motionTrail: segments, motionFromSceneTimeMs: before.sceneTimeMs, motionThroughSceneTimeMs: sceneTimeMs };
        }
        emitActor(tx, a);
    }
    invalidateReady(tx);
}
export function invalidateReady(tx) {
    for (const old of Object.values(tx.state.cooperations)) {
        if (old.phase === 'locked')
            continue;
        const op = tx.content.operations.find(o => o.operationId === old.operationId), target = tx.state.targets[op.targetId], scene = sceneOf(tx.content, target.sceneId), ready = {}, participants = {};
        for (const [id, anchorId] of Object.entries(old.participants)) {
            const a = tx.state.characters[id], anchor = scene.anchors.find(x => x.anchorId === anchorId);
            if (online(tx, a) && inRange(tx.state, tx.content, a, { sceneId: target.sceneId, position: anchor.position }, tx.content.movement.interactionRadius) && unoccluded(tx.state, tx.content, a, target))
                participants[id] = anchorId;
        }
        for (const [id, r] of Object.entries(old.ready)) {
            const a = tx.state.characters[id], anchor = scene.anchors.find(x => x.anchorId === r.anchorId);
            if (participants[id] === r.anchorId && op.anchorIds.includes(r.anchorId) && online(tx, a) && a.controlEpoch === r.epoch && target.resourceRevision === r.targetRevision && Object.entries(r.itemRevisions).every(([id, revision]) => tx.state.items[id].resourceRevision === revision) && inRange(tx.state, tx.content, a, { sceneId: target.sceneId, position: anchor.position }, tx.content.movement.interactionRadius) && unoccluded(tx.state, tx.content, a, target))
                ready[id] = r;
        }
        if (Object.keys(ready).length !== Object.keys(old.ready).length || Object.keys(participants).length !== Object.keys(old.participants).length)
            tx.emit('spatial.cooperation', { cooperation: { ...old, ready, participants } });
    }
}
function itemChange(tx, item, location) { emitItem(tx, { ...item, location, resourceRevision: next(item.resourceRevision) }); }
function observed(tx, observerId, statement, fields, category = 'WorldFact', shareable = true, sourceSeq = next(tx.state.sessionSeq)) {
    const observation = { observationRef: opaqueRef(), category, statement, sourceSeq, fields: structuredClone(fields), shareable };
    tx.emit('spatial.observation', { observerId, observation }, { humanCharacterIds: [observerId], coreNpcCharacterIds: [], proxyCharacterIds: shareable ? [observerId] : [] });
    return observation;
}
function cooperate(tx, actorId, action) {
    const op = tx.content.operations.find(o => o.operationId === action.operationId && o.kind === 'cooperation');
    if (!op)
        refuse('TARGET_UNAVAILABLE');
    const a = tx.state.characters[actorId], target = tx.state.targets[op.targetId];
    let record = structuredClone(tx.state.cooperations[op.operationId] ?? { operationId: op.operationId, targetId: op.targetId, version: '0', targetRevision: target.resourceRevision, participants: {}, ready: {}, phase: 'preparing' });
    const ownCancellation = action.phase === 'cancel' && record.phase !== 'locked' && (Object.hasOwn(record.participants, actorId) || Object.hasOwn(record.ready, actorId));
    // 首次请求先检查当前观察资格，不能借版本错误或 locked 早返探测墙后的操作状态。
    if (!ownCancellation) {
        if (!canSee(tx.state, tx.content, actorId, target))
            refuse('TARGET_UNAVAILABLE');
        near(tx, a, target);
    }
    if (record.version !== action.operationVersion)
        refuse('STALE_PRECONDITION');
    if (record.phase === 'locked')
        return { status: 'locked' };
    if (action.phase === 'cancel') {
        delete record.participants[actorId];
        delete record.ready[actorId];
        tx.emit('spatial.cooperation', { cooperation: record });
        return {};
    }
    if (tx.state.paused)
        refuse('SESSION_PAUSED');
    if (!online(tx, a))
        refuse('RULE_VIOLATION');
    const scene = sceneOf(tx.content, target.sceneId);
    const occupied = new Set(Object.entries(record.participants).filter(([id]) => id !== actorId).map(([, value]) => value));
    const anchor = op.anchorIds.map(id => scene.anchors.find(x => x.anchorId === id)).filter(x => !occupied.has(x.anchorId) && inRange(tx.state, tx.content, a, { sceneId: target.sceneId, position: x.position }, tx.content.movement.interactionRadius)).sort((x, y) => distance(a.position, x.position) - distance(a.position, y.position))[0];
    if (!anchor)
        refuse('OUT_OF_RANGE');
    // 就位确认绑定原站位；重新选择锚点后必须由本人再次确认。
    if (record.participants[actorId] !== anchor.anchorId)
        delete record.ready[actorId];
    record.participants[actorId] = anchor.anchorId;
    if (action.phase === 'ready')
        record.ready[actorId] = { epoch: a.controlEpoch, anchorId: anchor.anchorId, targetRevision: target.resourceRevision, itemRevisions: Object.fromEntries(op.requiredItemIds.map(id => [id, tx.state.items[id].resourceRevision])) };
    if (Object.keys(record.ready).length >= op.requiredCount) {
        const participants = Object.keys(record.ready);
        const allReady = new Set(participants.map(id => record.ready[id].anchorId)).size === participants.length && participants.every(id => {
            const member = tx.state.characters[id], r = record.ready[id], at = scene.anchors.find(x => x.anchorId === r.anchorId);
            return record.participants[id] === r.anchorId && op.anchorIds.includes(r.anchorId) && online(tx, member) && member.controlEpoch === r.epoch && r.targetRevision === target.resourceRevision && inRange(tx.state, tx.content, member, { sceneId: target.sceneId, position: at.position }, tx.content.movement.interactionRadius) && unoccluded(tx.state, tx.content, member, target) && Object.entries(r.itemRevisions).every(([id, rev]) => tx.state.items[id].resourceRevision === rev);
        });
        if (!allReady)
            refuse('STALE_PRECONDITION');
        if (!op.requiredFields.every(f => target.fields.some(t => t.key === f.key && t.value === f.value)))
            refuse('RULE_VIOLATION');
        const items = op.requiredItemIds.map(id => tx.state.items[id]);
        if (items.some(i => i.lockedBy || i.location.kind !== 'character' || !participants.includes(i.location.characterId)))
            refuse('NOT_READY');
        for (const item of items)
            emitItem(tx, { ...item, resourceRevision: next(item.resourceRevision), location: op.consumedItemIds.includes(item.itemId) ? { kind: 'consumed' } : { kind: 'ground', sceneId: target.sceneId, position: target.position }, fields: [...item.fields, { key: 'fixed', label: '已固定', value: true }], lockedBy: op.operationId });
        const fields = structuredClone(target.fields);
        for (const effect of op.effectFields) {
            const old = fields.find(f => f.key === effect.key);
            if (old)
                Object.assign(old, effect);
            else
                fields.push(effect);
        }
        emitTarget(tx, { ...target, fields, resourceRevision: next(target.resourceRevision) });
        record.phase = 'locked';
        record.version = next(record.version);
    }
    tx.emit('spatial.cooperation', { cooperation: record });
    return record.phase === 'locked' ? { status: 'locked' } : {};
}
export function applySpatialAction(tx, actorId, principalKind, request, navigationDependencies = null) {
    const a = tx.state.characters[actorId], action = request.action;
    const resolve = ref => resolveRef(tx, actorId, ref, request.viewId);
    if (principalKind === 'proxy' && !['move_to', 'stop_move', 'inspect', 'speak', 'wait'].includes(action.kind))
        refuse('RULE_VIOLATION');
    if (tx.state.paused && !['stop_move', 'wait', ...(isGaolao(tx.state)?['withdraw_consent','request_end','confirm_end']:[])].includes(action.kind) && !(action.kind === 'cooperate' && action.phase === 'cancel'))
        refuse('SESSION_PAUSED');
    if(isGaolao(tx.state)){const result=applyGaolaoAction(tx,actorId,principalKind,request);if(result!==null)return result;}
    if (action.kind === 'wait')
        return {};
    if (action.kind === 'stop_move') {
        if (active(a.movement))
            emitActor(tx, { ...a, movement: { ...a.movement, status: 'cancelled', reason: '已停止行走。' } });
        return { movementCommandSeq: action.movementCommandSeq, status: 'cancelled' };
    }
    if (action.kind === 'move_to') {
        checkGaolaoMovement(tx,actorId,action);
        const destinationScene = sceneOf(tx.content, action.sceneId);
        if (!destinationScene)
            refuse('PATH_UNREACHABLE');
        let origin = a.position;
        if (action.sceneId !== a.sceneId) {
            const current = sceneOf(tx.content, a.sceneId);
            const exit = current.exits.find(e => e.destinationSceneId === action.sceneId && inRange(tx.state, tx.content, a, { sceneId: a.sceneId, position: current.anchors.find(x => x.anchorId === e.anchorId).position }, tx.content.movement.interactionRadius) && conditionMet(tx.state, e.requirement));
            if (!exit)
                refuse('PATH_UNREACHABLE');
            near(tx, a, { sceneId: a.sceneId, position: current.anchors.find(x => x.anchorId === exit.anchorId).position });
            origin = exit.destination;
        }
        const target = action.targetRef ? resolve(action.targetRef) : null;
        if (target && locationOf(tx.state, target)?.sceneId !== action.sceneId)
            refuse('STALE_REFERENCE');
        if (action.anchorId && !destinationScene.anchors.some(x => x.anchorId === action.anchorId && distance(x.position, action.destination) === 0))
            refuse('PATH_UNREACHABLE');
        const path = findPath(destinationScene, origin, action.destination, obstacleEnabled(tx.state));
        if (!path)
            refuse('PATH_UNREACHABLE');
        const planVersion = next(a.planVersion), movement = { movementId: opaqueRef(), planVersion, movementCommandSeq: action.movementCommandSeq, actorId, controlEpoch: a.controlEpoch, sceneId: action.sceneId, mapVersion: tx.state.mapVersion, goal: action.destination, path, acceptedAtSceneTime: tx.state.sceneTimeMs, status: 'accepted', travelled: 0, ...(target ? { relatedTarget: { id: target.characterId ?? target.itemId ?? target.targetId, appearanceEpoch: target.appearanceEpoch, resourceRevision: target.resourceRevision, ...(target.spatialRevision !== undefined ? { spatialRevision: target.spatialRevision } : {}) } } : {}) };
        if(navigationDependencies)movement.chapterDependencies=structuredClone(navigationDependencies);
        emitActor(tx, { ...a, sceneId: action.sceneId, position: origin, spatialRevision: next(a.spatialRevision), planVersion, movement });
        for (const old of Object.values(tx.state.cooperations))
            if (old.phase !== 'locked' && old.ready[actorId]) {
                const changed = structuredClone(old);
                delete changed.ready[actorId];
                tx.emit('spatial.cooperation', { cooperation: changed });
            }
        return { movementId: movement.movementId, planVersion, movementCommandSeq: action.movementCommandSeq, status: 'accepted' };
    }
    if (['take_item', 'put_item', 'transfer_item', 'reclaim_public_item'].includes(action.kind)) {
        const item = resolve(action.itemRef);
        if (!item.itemId)
            refuse('TARGET_UNAVAILABLE');
        if (item.resourceRevision !== action.expectedItemRevision)
            refuse('STALE_PRECONDITION');
        if (item.lockedBy)
            refuse('RULE_VIOLATION');
        checkGaolaoItem(tx,actorId,item,action);
        if (action.kind === 'take_item') {
            if (item.location.kind !== 'ground')
                refuse('RULE_VIOLATION');
            near(tx, a, item);
            itemChange(tx, item, { kind: 'character', characterId: actorId });
        }
        else if (action.kind === 'reclaim_public_item') {
            const holder = resolve(action.holderRef);
            if (!holder.characterId || !online(tx, a) || !item.publicBorrowable || !item.transferable || holder.mode !== 'AIProxyControlled' || holder.controlEpoch !== action.expectedHolderEpoch || item.location.kind !== 'character' || item.location.characterId !== holder.characterId)
                refuse('RULE_VIOLATION');
            near(tx, a, holder);
            itemChange(tx, item, { kind: 'character', characterId: actorId });
        }
        else {
            if (item.location.kind !== 'character' || item.location.characterId !== actorId || !item.transferable)
                refuse('RULE_VIOLATION');
            if (action.kind === 'put_item') {
                const at = { sceneId: action.sceneId, position: action.position };
                near(tx, a, at);
                if (!walkable(sceneOf(tx.content, action.sceneId), action.position, obstacleEnabled(tx.state)))
                    refuse('PATH_UNREACHABLE');
                itemChange(tx, item, { kind: 'ground', ...at });
            }
            else {
                const recipient = resolve(action.recipientRef);
                if (!recipient.characterId)
                    refuse('TARGET_UNAVAILABLE');
                near(tx, a, recipient);
                if (recipient.characterId !== actorId)
                    itemChange(tx, item, { kind: 'character', characterId: recipient.characterId });
            }
        }
        return { entityRefs: [action.itemRef] };
    }
    if (action.kind === 'cooperate')
        return cooperate(tx, actorId, action);
    if (action.kind === 'inspect') {
        const entity = resolve(action.targetRef);
        near(tx, a, entity);
        const record = observed(tx, actorId, '亲自在现场检查了当前状态。', entity.fields ?? []);
        return { observationRefs: [record.observationRef] };
    }
    if (action.kind === 'interact') {
        const target = resolve(action.targetRef);
        if (!target.targetId)
            refuse('TARGET_UNAVAILABLE');
        near(tx, a, target);
        if (target.resourceRevision !== action.expectedTargetRevision)
            refuse('STALE_PRECONDITION');
        const op = tx.content.operations.find(o => o.operationId === action.operationId && o.targetId === target.targetId && o.kind === 'interaction');
        if (!op || op.requiredCount !== 1 || op.requiredItemIds.length || !op.requiredFields.every(f => target.fields.some(t => t.key === f.key && t.value === f.value)))
            refuse('RULE_VIOLATION');
        const fields = structuredClone(target.fields);
        for (const effect of op.effectFields) {
            const field = fields.find(f => f.key === effect.key);
            if (field)
                Object.assign(field, effect);
            else
                fields.push(effect);
        }
        emitTarget(tx, { ...target, fields, resourceRevision: next(target.resourceRevision) });
        return {};
    }
    if (action.kind === 'speak' || action.kind === 'make_claim') {
        if (principalKind !== 'human' && action.channel === 'team')
            refuse('RULE_VIOLATION');
        if (principalKind === 'proxy' && (action.channel !== 'public' || !/[?？]\s*$/.test(action.text)))
            refuse('RULE_VIOLATION');
        let recipients;
        if (action.channel === 'team')
            recipients = Object.values(tx.state.characters).filter(c => c.kind === 'human');
        else if (action.channel === 'public')
            recipients = Object.values(tx.state.characters).filter(c => inRange(tx.state, tx.content, a, c, tx.content.movement.hearingRadius) && unoccluded(tx.state, tx.content, a, c));
        else {
            recipients = [a, ...action.recipientRefs.map(resolve)];
            if (recipients.some(c => !c.characterId || !inRange(tx.state, tx.content, a, c, tx.content.movement.hearingRadius) || !unoccluded(tx.state, tx.content, a, c)))
                refuse('OUT_OF_RANGE');
        }
        const unique = [...new Map(recipients.map(c => [c.characterId, c])).values()];
        for (const c of unique)
            ensureView(tx, c.characterId);
        const sourceSeq = next(tx.state.sessionSeq), views = Object.fromEntries(unique.map(c => [c.characterId, { claimRef: opaqueRef(), speakerRef: entityRef(tx.state.views[c.characterId], actorId), speakerName: observerName(tx.state,c.characterId,a), text: action.text, channel: action.channel, sourceSeq }]));
        tx.emit('spatial.claim', { views }, { humanCharacterIds: unique.filter(c => c.kind === 'human').map(c => c.characterId), coreNpcCharacterIds: action.channel === 'team' ? [] : unique.filter(c => c.kind !== 'human').map(c => c.characterId), proxyCharacterIds: action.channel === 'team' ? [] : unique.filter(c => c.kind === 'human').map(c => c.characterId) });
        return {};
    }
    if (action.kind === 'share_evidence') {
        const observation = tx.state.observations[actorId]?.find(o => o.observationRef === action.evidenceRef && o.shareable);
        if (!observation)
            refuse('STALE_REFERENCE');
        const recipients = action.recipientRefs.map(resolve);
        for (const c of recipients) {
            if (!c.characterId)
                refuse('TARGET_UNAVAILABLE');
            near(tx, a, c);
        }
        if(isGaolao(tx.state))copyGaolaoEvidence(tx,actorId,observation,recipients.map(c=>c.characterId));
        else for (const c of recipients)
            observed(tx, c.characterId, observation.statement, observation.fields, observation.category, true, observation.sourceSeq);
        return {};
    }
    refuse('RULE_VIOLATION');
}
