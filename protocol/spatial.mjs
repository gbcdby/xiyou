import { ContractError, parseStrictJSON, canonicalize } from './index.mjs';
import { spatialSchema } from './spatial-schema.mjs';
export { spatialSchema } from './spatial-schema.mjs';
const fail = path => { throw new ContractError('消息不符合空间协议', path); };
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
export function validateSpatial(name, value) {
    canonicalize(value);
    if (!Object.hasOwn(spatialSchema.$defs, name))
        fail('$');
    checkSpatialSchema(spatialSchema.$defs[name], value);
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
    stop() { return Object.freeze({ kind: 'stop_move', movementCommandSeq: String(++this.#next) }); }
}
