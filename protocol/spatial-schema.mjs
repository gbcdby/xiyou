import { contractSchema } from './schema.mjs';

// spatial-v2 的唯一字段源；region-v1 的字段源及生成产物保持不变。
export const ref = name => ({ $ref: '#/$defs/' + name });
export const object = (properties, optional = []) => ({ type: 'object', properties, required: Object.keys(properties).filter(k => !optional.includes(k)), additionalProperties: false });
export const array = (items, maxItems = 256) => ({ type: 'array', items, maxItems });
export const text = (maxLength = 2000) => ({ type: 'string', maxLength });
export const en = (...values) => ({ enum: values });
export const lit = value => ({ const: value });
export const nullable = value => ({ oneOf: [value, { type: 'null' }] });
export const integer = (maximum = Number.MAX_SAFE_INTEGER, minimum = 0) => ({ type: 'integer', minimum, maximum });
export const dict = value => ({ type: 'object', propertyNames: ref('Id'), additionalProperties: value });
const action = (kind, properties = {}, optional = []) => object({ kind: lit(kind), ...properties }, optional);
const point = ref('Position');
const entity = ref('EntityRef');
const revision = ref('DecimalString');
const ids = array(ref('Id'));
const refs = array(entity);
const fieldList = array(ref('FactField'), 32);
const defs = {
  Id: contractSchema.$defs.Id,
  DecimalString: contractSchema.$defs.DecimalString,
  PositiveDecimalString: contractSchema.$defs.PositiveDecimalString,
  UtcTimestamp: contractSchema.$defs.UtcTimestamp,
  Scalar: contractSchema.$defs.Scalar,
  FactField: contractSchema.$defs.FactField,
  EventRange: contractSchema.$defs.EventRange,
  EntityRef: { type: 'string', pattern: '^[A-Za-z0-9_-]{32,96}(?![\\s\\S])' },
  Position: object({ x: integer(1000000), y: integer(1000000) }),
  Polygon: { ...array(point, 128), minItems: 3 },
  Facing: en('N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'),
  ActionV2: { oneOf: [
    action('move_to', { movementCommandSeq: ref('PositiveDecimalString'), sceneId: ref('Id'), destination: point, targetRef: entity, anchorId: ref('Id') }, ['targetRef', 'anchorId']),
    action('stop_move', { movementCommandSeq: ref('PositiveDecimalString') }),
    action('inspect', { targetRef: entity }),
    action('take_item', { itemRef: entity, expectedItemRevision: revision }),
    action('put_item', { itemRef: entity, expectedItemRevision: revision, sceneId: ref('Id'), position: point }),
    action('transfer_item', { itemRef: entity, expectedItemRevision: revision, recipientRef: entity }),
    action('reclaim_public_item', { itemRef: entity, holderRef: entity, expectedItemRevision: revision, expectedHolderEpoch: revision }),
    action('interact', { targetRef: entity, operationId: ref('Id'), expectedTargetRevision: revision }),
    action('cooperate', { operationId: ref('Id'), operationVersion: revision, phase: en('prepare', 'ready', 'cancel') }),
    ...['speak', 'make_claim'].map(kind => action(kind, { text: { ...text(2000), minLength: 1 }, channel: en('public', 'directed', 'team'), recipientRefs: refs })),
    action('share_evidence', { evidenceRef: entity, recipientRefs: { ...refs, minItems: 1 } }),
    action('wait'),
  ] },
  PublicEnvelope: object({ schemaVersion: lit(2), sessionId: ref('Id'), viewId: ref('Id'), actorRef: entity, clientActionId: ref('Id'), controlEpoch: revision, baseSeq: revision, action: ref('ActionV2') }),
  SyncRequestV2: object({ schemaVersion: lit(2), type: lit('sync.request'), sessionId: ref('Id'), viewId: ref('Id'), cursor: revision }),
  ControlRequestV2: object({ schemaVersion: lit(2), type: en('control.resume', 'control.take'), sessionId: ref('Id'), viewId: ref('Id'), actorRef: entity, nonce: ref('Id') }),
  ReceiptResultV2: object({ movementId: entity, planVersion: revision, movementCommandSeq: revision, status: en('accepted', 'moving', 'arrived', 'blocked', 'cancelled', 'locked'), entityRefs: refs, observationRefs: refs, message: text(500) }, ['movementId', 'planVersion', 'movementCommandSeq', 'status', 'entityRefs', 'observationRefs', 'message']),
  ReceiptV2: object({ schemaVersion: lit(2), sessionId: ref('Id'), clientActionId: ref('Id'), status: en('Accepted', 'Rejected'), code: ref('Id'), observedSeq: revision, actionEventRange: nullable(ref('EventRange')), result: ref('ReceiptResultV2') }),
  EntityViewV2: object({ entityRef: entity, name: text(120), appearanceEpoch: revision, sceneId: nullable(ref('Id')), position: nullable(point), facing: ref('Facing'), motionTrail: array(point,4096), motionFromSceneTimeMs: integer(), motionThroughSceneTimeMs: integer() }, ['motionTrail','motionFromSceneTimeMs','motionThroughSceneTimeMs']),
  SelfViewV2: object({ entityRef: entity, name: text(120), appearanceEpoch: revision, sceneId: nullable(ref('Id')), position: nullable(point), facing: ref('Facing'), controlEpoch: revision, canControl: { type: 'boolean' }, capabilities: ids, movementCommandHighWater: revision }),
  ItemViewV2: object({ entityRef: entity, name: text(120), location: { oneOf: [object({ kind: lit('ground'), sceneId: ref('Id'), position: point }), object({ kind: lit('held'), ownerRef: entity })] }, resourceRevision: revision, transferable: { type: 'boolean' }, publicBorrowable: { type: 'boolean' }, fields: fieldList, reclaimHolderEpoch: revision }, ['reclaimHolderEpoch']),
  TargetViewV2: object({ entityRef: entity, name: text(120), sceneId: ref('Id'), position: point, resourceRevision: revision, availableOperations: ids, fields: fieldList }),
  PlanViewV2: object({ movementId: entity, planVersion: revision, movementCommandSeq: revision, sceneId: ref('Id'), mapVersion: ref('Id'), goal: point, path: array(point, 4096), acceptedAtSceneTime: integer(), status: en('accepted', 'moving', 'arrived', 'blocked', 'cancelled'), reason: text(120) }, ['reason']),
  ObservationViewV2: object({ observationRef: entity, category: en('WorldFact', 'Evidence', 'Claim'), statement: text(2000), sourceSeq: revision, fields: fieldList, shareable: { type: 'boolean' } }),
  ClaimViewV2: object({ claimRef: entity, speakerRef: entity, speakerName: text(120), text: text(2000), channel: en('public', 'directed', 'team'), sourceSeq: revision }),
  CooperationViewV2: object({ operationId: ref('Id'), operationVersion: revision, phase: en('preparing', 'locked'), readyCount: integer(5), requiredCount: integer(5, 1), anchors: array(point, 5) }),
  PublicScene: object({ sceneId: ref('Id'), name: text(120), width: integer(1000000, 1), height: integer(1000000, 1), unitsPerPixel: integer(10000, 1), walkableAreas: array(object({ areaId: ref('Id'), polygon: ref('Polygon') })), obstacles: array(object({ obstacleId: ref('Id'), polygon: ref('Polygon'), exceptAreas: ids })), anchors: array(object({ anchorId: ref('Id'), position: point, label: text(120) })), exits: array(object({ exitId: ref('Id'), anchorId: ref('Id'), destinationSceneId: ref('Id'), destination: point, open: { type: 'boolean' } })) }),
  ProjectionV2: object({ protocolCapability: lit('spatial-v2'), chapterVersion: ref('Id'), mapVersion: ref('Id'), variantId: ref('Id'), contentVersion: ref('Id'), reducerVersion: lit('spatial-world-v2'), phase: en('Lobby', 'Running', 'Finished', 'Aborted'), sceneTimeMs: integer(), paused: { type: 'boolean' }, self: ref('SelfViewV2'), entities: array(ref('EntityViewV2')), items: array(ref('ItemViewV2')), targets: array(ref('TargetViewV2')), scene: nullable(ref('PublicScene')), movement: nullable(ref('PlanViewV2')), observations: array(ref('ObservationViewV2')), claims: array(ref('ClaimViewV2')), cooperations: array(ref('CooperationViewV2')), objectives: array(object({ objectiveId: ref('Id'), label: text(240), status: en('active', 'completed', 'blocked') })), ending: nullable(object({ title: text(120), summary: text(500) })) }),
  SnapshotV2: object({ schemaVersion: lit(2), type: lit('world.snapshot'), sessionId: ref('Id'), viewId: ref('Id'), snapshotSeq: revision, projection: ref('ProjectionV2') }),
  BatchV2: object({ schemaVersion: lit(2), type: lit('world.batch'), sessionId: ref('Id'), viewId: ref('Id'), fromExclusive: revision, throughSeq: revision, events: array(object({ sessionSeq: ref('PositiveDecimalString'), eventId: ref('Id'), kind: lit('projection.replace'), payload: object({ projection: ref('ProjectionV2') }) })) }),
  ControlResponseV2: object({ schemaVersion: lit(2), sessionId: ref('Id'), nonce: ref('Id'), controlEpoch: revision, observedSeq: revision, snapshot: ref('SnapshotV2') }),
  ErrorV2: object({ schemaVersion: lit(2), code: ref('Id'), message: text(500), requiredCapabilities: array(en('spatial-v2'), 1) }, ['requiredCapabilities']),
};
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const spatialSchema = freeze({ $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://github.com/gbcdby/xiyou/protocol/spatial-v2', $defs: defs });
