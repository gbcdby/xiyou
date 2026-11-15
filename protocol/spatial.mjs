import { ContractError, parseStrictJSON, canonicalize } from './index.mjs';
import { spatialSchema, gaolaoPersonalProfiles } from './spatial-schema.mjs';
export { spatialSchema, gaolaoPersonalProfiles } from './spatial-schema.mjs';
const fail = path => { throw new ContractError('消息不符合空间协议', path); };
/** 精确身份匹配，不将未知同 family 内容解释成已登记的新版本。 */
export function gaolaoPersonalProfile(value) {
    return gaolaoPersonalProfiles.find(profile => ['contentVersion', 'chapterVersion', 'reducerVersion', 'mapVersion', 'variantId'].every(key => value?.[key] === profile[key])) ?? null;
}
function validatePersonalOffer(offer) {
    if (new Set(offer.options.map(option => option.optionRef)).size !== offer.options.length) fail('$.options.optionRef');
}
function validatePersonalProjection(projection) {
    const fields = ['personalRequests', 'privateItemOffers', 'privateReturns'];
    const registeredContent = gaolaoPersonalProfiles.some(profile => profile.contentVersion === projection.contentVersion);
    const personal = gaolaoPersonalProfile(projection);
    if ((registeredContent || projection.reducerVersion === 'gaolao-world-v2' || projection.chapterVersion === 'gaolaozhuang-chapter-v3') && !personal) fail('$.projection.contentVersion');
    if (!personal) {
        if (fields.some(key => Object.hasOwn(projection.chapter ?? {}, key))) fail('$.projection.chapter');
        return;
    }
    if (!projection.chapter || fields.some(key => !Object.hasOwn(projection.chapter, key))) fail('$.projection.chapter');
    projection.chapter.privateItemOffers.forEach(validatePersonalOffer);
    const requests = projection.chapter.personalRequests;
    if (new Set(requests.map(request => request.purpose)).size !== requests.length) fail('$.projection.chapter.personalRequests');
    for (const request of requests) {
        if ((request.purpose === 'appearance') !== Object.hasOwn(request.scope, 'destinationId')) fail('$.projection.chapter.personalRequests.scope');
        const consent = projection.chapter.consents.find(consent => consent.consentId === request.consentId);
        if (!consent || consent.purpose !== request.purpose) fail('$.projection.chapter.personalRequests.consentId');
    }
    const returns = projection.chapter.privateReturns;
    if (new Set(returns.map(entry => entry.returnContextId)).size !== returns.length || new Set(returns.map(entry => entry.itemRef)).size !== returns.length) fail('$.projection.chapter.privateReturns');
    for (const entry of returns) {
        const item = projection.items.find(item => item.entityRef === entry.itemRef);
        if (item?.location.kind !== 'held' || item.location.ownerRef !== projection.self.entityRef || item.resourceRevision !== entry.itemRevision) fail('$.projection.chapter.privateReturns.itemRef');
        if (entry.ownerRef !== null && !projection.entities.some(entity => entity.entityRef === entry.ownerRef)) fail('$.projection.chapter.privateReturns.ownerRef');
    }
}
export function checkSpatialSchema(schema, value, defs = spatialSchema.$defs, path = '$') {
    if (schema.$ref)
        return checkSpatialSchema(defs[schema.$ref.split('/').at(-1)], value, defs, path);
    if (schema.oneOf) {
        let matches = 0;
        for (const choice of schema.oneOf) {
            try {
                checkSpatialSchema(choice, value, defs, path);
                matches++;
            }
            catch (error) {
                if (!(error instanceof ContractError))
                    throw error;
            }
        }
        if (matches !== 1)
            fail(path);
        return;
    }
    if ('const' in schema && value !== schema.const)
        fail(path);
    if (schema.enum && !schema.enum.includes(value))
        fail(path);
    if (schema.type === 'null' && value !== null)
        fail(path);
    if (schema.type === 'boolean' && typeof value !== 'boolean')
        fail(path);
    if (schema.type === 'integer' && (!Number.isSafeInteger(value) || value < schema.minimum || value > schema.maximum))
        fail(path);
    if (schema.type === 'string') {
        if (typeof value !== 'string' || [...value].length > (schema.maxLength ?? Infinity) || [...value].length < (schema.minLength ?? 0) || (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)))
            fail(path);
    }
    if (schema.type === 'array') {
        if (!Array.isArray(value) || value.length > (schema.maxItems ?? Infinity) || value.length < (schema.minItems ?? 0))
            fail(path);
        if (schema.uniqueItems && new Set(value.map(canonicalize)).size !== value.length)
            fail(path);
        value.forEach((item, index) => checkSpatialSchema(schema.items, item, defs, path + '[' + index + ']'));
    }
    if (schema.type === 'object') {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            fail(path);
        for (const key of schema.required ?? [])
            if (!Object.hasOwn(value, key))
                fail(path + '.' + key);
        for (const key of Object.keys(value)) {
            if (['__proto__', 'prototype', 'constructor'].includes(key))
                fail(path + '.' + key);
            if (schema.propertyNames)
                checkSpatialSchema(schema.propertyNames, key, defs, path);
            if (Object.hasOwn(schema.properties ?? {}, key))
                checkSpatialSchema(schema.properties[key], value[key], defs, path + '.' + key);
            else if (schema.additionalProperties === false)
                fail(path + '.' + key);
            else if (typeof schema.additionalProperties === 'object')
                checkSpatialSchema(schema.additionalProperties, value[key], defs, path + '.' + key);
        }
    }
}
const sameMotionPoint = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y;
/** 时间与点索引同时覆盖；重复端点不能掩盖折返或把已执行运动改成静止。 */
function validateMotionTimeline(entity, sceneTimeMs = Number.MAX_SAFE_INTEGER) {
    if (!Object.hasOwn(entity, 'motionTimeline')) return;
    const trail = entity.motionTrail, spans = entity.motionTimeline, from = entity.motionFromSceneTimeMs, through = entity.motionThroughSceneTimeMs;
    if (!Array.isArray(trail) || trail.length < 2 || !Number.isSafeInteger(from) || !Number.isSafeInteger(through)
        || from > through || through > sceneTimeMs || !sameMotionPoint(trail.at(-1), entity.position) || !spans.length) fail('$.motionTimeline');
    const zero = from === through;
    if (zero && (spans.length !== 1 || spans[0].kind !== 'hold')) fail('$.motionTimeline');
    let time = from, index = 0;
    for (const span of spans) {
        if (span.fromSceneTimeMs !== time || span.fromTrailIndex !== index || span.throughTrailIndex < index || span.throughTrailIndex >= trail.length
            || (zero ? span.throughSceneTimeMs !== time : span.throughSceneTimeMs <= time)) fail('$.motionTimeline');
        if (span.kind === 'hold') {
            for (let at = index + 1; at <= span.throughTrailIndex; at++) if (!sameMotionPoint(trail[index], trail[at])) fail('$.motionTimeline.hold');
        }
        time = span.throughSceneTimeMs; index = span.throughTrailIndex;
    }
    if (time !== through || index !== trail.length - 1) fail('$.motionTimeline');
}
function validateTimedProjection(projection) {
    const entries = [...projection.entities, ...(projection.sceneOverview?.entities ?? [])];
    for (const entity of entries) {
        if (Object.hasOwn(entity, 'motionTimeline') && entity.entityRef !== projection.self.entityRef) fail('$.motionTimeline.self');
        validateMotionTimeline(entity, projection.sceneTimeMs);
    }
    if (!projection.sceneOverview) return;
    const entity = projection.entities.find(value => value.entityRef === projection.self.entityRef);
    const overview = projection.sceneOverview.entities.find(value => value.entityRef === projection.self.entityRef);
    if (!entity?.motionTimeline && !overview?.motionTimeline) return;
    for (const key of ['motionTrail', 'motionFromSceneTimeMs', 'motionThroughSceneTimeMs', 'motionTimeline']) {
        if (!entity || !overview || !Object.hasOwn(entity, key) || !Object.hasOwn(overview, key) || canonicalize(entity[key]) !== canonicalize(overview[key])) fail('$.motionTimeline.mirror');
    }
}
function validateSceneOverview(projection) {
    const overview = projection.sceneOverview, catalog = projection.mapCatalog;
    if (Boolean(overview) !== Boolean(catalog)) fail('$.sceneOverview');
    if (!overview) return;
    const sceneId = projection.scene?.sceneId;
    const values = [...overview.entities, ...overview.items, ...overview.targets];
    if (new Set(values.map(value => value.entityRef)).size !== values.length) fail('$.sceneOverview.entities');
    if (sceneId && !overview.entities.some(entity => entity.entityRef === projection.self.entityRef)) fail('$.sceneOverview.self');
    if (values.some(value => (value.location?.sceneId ?? value.sceneId) !== sceneId)) fail('$.sceneOverview.sceneId');
    for (const entity of overview.entities) {
        const count = ['motionTrail', 'motionFromSceneTimeMs', 'motionThroughSceneTimeMs'].filter(key => Object.hasOwn(entity, key)).length;
        if (count !== 0 && count !== 3) fail('$.sceneOverview.motionTrail');
        if (count && (entity.motionTrail.length < 2 || entity.motionFromSceneTimeMs > entity.motionThroughSceneTimeMs || entity.motionThroughSceneTimeMs > projection.sceneTimeMs || canonicalize(entity.motionTrail.at(-1)) !== canonicalize(entity.position))) fail('$.sceneOverview.motionTrail');
    }
    if (new Set(catalog.map(scene => scene.sceneId)).size !== catalog.length || sceneId && !catalog.some(scene => scene.sceneId === sceneId)) fail('$.mapCatalog');
}
export function validateSpatial(name, value) {
    canonicalize(value);
    if (!Object.hasOwn(spatialSchema.$defs, name))
        fail('$');
    checkSpatialSchema(spatialSchema.$defs[name], value);
    if (name === 'PrivateItemOfferV1') validatePersonalOffer(value);
    const personalProjections = name === 'ProjectionV2' ? [value] : name === 'SnapshotV2' ? [value.projection] : name === 'BatchV2' ? value.events.map(event => event.payload.projection) : name === 'ControlResponseV2' ? [value.snapshot.projection] : [];
    personalProjections.forEach(validatePersonalProjection);
    personalProjections.forEach(validateSceneOverview);
    personalProjections.forEach(validateTimedProjection);
    if (['EntityViewV2', 'SceneEntityViewV1'].includes(name)) validateMotionTimeline(value);
    if (name === 'MotionTimelineSpanV1' && (value.fromTrailIndex > value.throughTrailIndex || value.fromSceneTimeMs > value.throughSceneTimeMs
        || value.kind === 'motion' && value.fromSceneTimeMs === value.throughSceneTimeMs)) fail('$.motionTimeline');
    const action = name === 'PublicEnvelope' ? value.action : name === 'ActionV2' ? value : null;
    if (action && ['speak', 'make_claim'].includes(action.kind) && ((action.channel === 'public' || action.channel === 'team') ? action.recipientRefs.length !== 0 : action.recipientRefs.length === 0))
        fail('$.action.recipientRefs');
    if (name === 'ReceiptV2') {
        if (value.status === 'Accepted' ? !['OK', 'NO_CHANGE'].includes(value.code) : ['OK', 'NO_CHANGE'].includes(value.code) || value.actionEventRange !== null)
            fail('$.status');
        const range = value.actionEventRange;
        if (range && (BigInt(range.first) > BigInt(range.last) || BigInt(range.last) > BigInt(value.observedSeq)))
            fail('$.actionEventRange');
    }
    if (name === 'BatchV2') {
        let cursor = BigInt(value.fromExclusive);
        if (cursor > BigInt(value.throughSeq))
            fail('$.throughSeq');
        if (Object.hasOwn(value, 'syncFrontierSeq') && BigInt(value.throughSeq) > BigInt(value.syncFrontierSeq))
            fail('$.syncFrontierSeq');
        for (const event of value.events) {
            if (BigInt(event.sessionSeq) <= cursor || BigInt(event.sessionSeq) > BigInt(value.throughSeq))
                fail('$.events');
            cursor = BigInt(event.sessionSeq);
        }
    }
    const projection = name === 'ProjectionV2' ? value : name === 'SnapshotV2' ? value.projection : null;
    if (projection) {
        if (!projection.entities.some(e => e.entityRef === projection.self.entityRef))
            fail('$.self');
        const refs = [...projection.entities, ...projection.items, ...projection.targets].map(e => e.entityRef);
        if (new Set(refs).size !== refs.length)
            fail('$.entities');
        if (['Finished', 'Aborted'].includes(projection.phase) && projection.self.canControl)
            fail('$.self.canControl');
        for (const entity of projection.entities) {
            const trailKeys = ['motionTrail', 'motionFromSceneTimeMs', 'motionThroughSceneTimeMs'];
            const present = trailKeys.filter(key => Object.hasOwn(entity, key)).length;
            if (present !== 0 && present !== 3)
                fail('$.entities.motionTrail');
            if (present && (entity.motionTrail.length < 2 || entity.motionFromSceneTimeMs > entity.motionThroughSceneTimeMs || entity.motionThroughSceneTimeMs > projection.sceneTimeMs || canonicalize(entity.motionTrail.at(-1)) !== canonicalize(entity.position)))
                fail('$.entities.motionTrail');
        }
        for (const item of projection.items)
            if (item.location.kind === 'held' && !projection.entities.some(entity => entity.entityRef === item.location.ownerRef))
                fail('$.items.location');
    }
    return value;
}
export const parseSpatial = (name, raw) => validateSpatial(name, parseStrictJSON(raw, { maxBytes: ['ProjectionV2','SnapshotV2','BatchV2','ControlResponseV2','RecapV2'].includes(name) ? Infinity : 65536 }));
/** 有限章节动作的严格构造入口；旧内容字符串操作仍由公开解析器校验。 */
export const gaolaoInteraction = value => validateSpatial('GaolaoInteractionV2', structuredClone(value));
export const isGaolaoInteraction = value => value?.kind==='interact' && typeof value.operationId==='string' && value.operationId.startsWith('gz-') && (()=>{try{validateSpatial('GaolaoInteractionV2',value);return true;}catch{return false;}})();
/** 一个新控制 epoch 只能创建一个输入源；刷新丢失计数器时须重新取得 epoch。 */
export class MovementCommandSource {
    #next = 0n;
    constructor(controlEpoch) { validateSpatial('DecimalString', controlEpoch); Object.defineProperty(this, 'controlEpoch', { value: controlEpoch, enumerable: true }); }
    move(sceneId, destination, options = {}) { const command = validateSpatial('ActionV2', { kind: 'move_to', sceneId, destination: { ...destination }, ...options, movementCommandSeq: String(++this.#next) }); Object.freeze(command.destination); return Object.freeze(command); }
    direction(sceneId, mapVersion, direction) { return Object.freeze(validateSpatial('ActionV2', { kind: 'move_direction', sceneId, mapVersion, direction, movementCommandSeq: String(++this.#next) })); }
    stop() { return Object.freeze({ kind: 'stop_move', movementCommandSeq: String(++this.#next) }); }
}
