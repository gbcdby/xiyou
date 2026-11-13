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
const chapterInteraction = (names, parameters) => object({ kind: lit('interact'), targetRef: entity, operationId: en(...names), expectedTargetRevision: revision, ...(parameters ? { parameters } : {}) });
const gaolaoInteractions = [
    chapterInteraction(['gz-contact','gz-check-seal','gz-try-key','gz-step-back','gz-break-seal','gz-release-appearance','gz-reveal-identity','gz-check-appearance','gz-read-ledger','gz-hear-witness','gz-show-passage','gz-confirm-meeting','gz-release-support','gz-plan-departure','gz-join-party','gz-finish-separation']),
    chapterInteraction(['gz-confirm-settlement','gz-pause-follow','gz-apply-appearance'], object({ consentId: entity, expectedConsentVersion: revision })),
    chapterInteraction(['gz-request-appearance','gz-invite-meeting'], object({ destinationId: ref('Id'), expectedConsentVersion: revision })),
    chapterInteraction(['gz-compare-sources'], object({ evidenceRefs: { ...refs, minItems: 2, maxItems: 2, uniqueItems: true } })),
    chapterInteraction(['gz-recruitment-decision','gz-membership-decision'], object({ expectedDecisionVersion: revision, response: en('accept','decline','defer','withdraw') })),
    chapterInteraction(['gz-return-public'], object({ itemRef: entity, expectedItemRevision: revision })),
    chapterInteraction(['gz-request-private-items'], object({ itemRefs: { ...refs, minItems: 1, maxItems: 8, uniqueItems: true }, expectedConsentVersion: revision })),
];
const defs = {
  SpatialClientCapability: en('spatial-v2', 'spatial-appearance-v1', 'spatial-object-visual-v1'),
  ObjectVisualKeyV1: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-z][a-z0-9-]{0,63}(?![\\s\\S])' },
  AppearanceIdV2: en('neutral', 'gaocai', 'courtyard-helper', 'carpenter', 'kitchen-helper', 'woodcutter', 'tang', 'wukong', 'bajie', 'cuilan', 'gao', 'witness'),
  GaolaoInteractionV2: { oneOf: gaolaoInteractions },
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
    action('interact', { targetRef: entity, operationId: { ...contractSchema.$defs.Id, pattern: '^(?!gz-)' + contractSchema.$defs.Id.pattern.replace(/^\^/, '') }, expectedTargetRevision: revision }),
    ref('GaolaoInteractionV2'),
    action('cooperate', { operationId: ref('Id'), operationVersion: revision, phase: en('prepare', 'ready', 'cancel') }),
    ...['speak', 'make_claim'].map(kind => action(kind, { text: { ...text(2000), minLength: 1 }, channel: en('public', 'directed', 'team'), recipientRefs: refs })),
    action('share_evidence', { evidenceRef: entity, recipientRefs: { ...refs, minItems: 1 } }),
    action('propose_follow', { subjectRef: entity, destinationId: ref('Id'), leaderRef: entity, expectedTargetRevision: revision }),
    action('propose_follow', { subjectRef: entity, destinationId: ref('Id'), leaderRef: entity, expectedConsentVersion: revision }),
    action('respond_consent', { consentId: entity, expectedConsentVersion: revision, response: en('accept', 'decline', 'defer') }),
    action('withdraw_consent', { consentId: entity, expectedConsentVersion: revision }),
    action('request_end', { proposalId: ref('Id'), proposalVersion: revision, scope: en('chapter', 'recruitment') }),
    action('confirm_end', { proposalId: ref('Id'), proposalVersion: revision }),
    action('wait'),
  ] },
  GaolaoOperationId: en('gz-contact', 'gz-check-seal', 'gz-try-key', 'gz-step-back', 'gz-break-seal', 'gz-confirm-settlement', 'gz-pause-follow', 'gz-request-appearance', 'gz-apply-appearance', 'gz-release-appearance', 'gz-reveal-identity', 'gz-check-appearance', 'gz-read-ledger', 'gz-hear-witness', 'gz-compare-sources', 'gz-show-passage', 'gz-invite-meeting', 'gz-confirm-meeting', 'gz-recruitment-decision', 'gz-membership-decision', 'gz-release-support', 'gz-return-public', 'gz-plan-departure', 'gz-join-party', 'gz-finish-separation', 'gz-request-private-items'),
  ChapterInteractionParameters: { oneOf: [
    object({ consentId: entity, expectedConsentVersion: revision }),
    object({ destinationId: ref('Id'), expectedConsentVersion: revision }),
    object({ evidenceRefs: { ...refs, minItems: 2, maxItems: 2, uniqueItems: true } }),
    object({ expectedDecisionVersion: revision, response: en('accept', 'decline', 'defer', 'withdraw') }),
    object({ itemRef: entity, expectedItemRevision: revision }),
    object({ itemRefs: { ...refs, minItems: 1, maxItems: 8, uniqueItems: true }, expectedConsentVersion: revision }),
  ] },
  ConsentPurpose: en('follow', 'appearance', 'private_items', 'meeting', 'membership'),
  ConsentScopeViewV2: object({ destinationId: ref('Id'), leaderRef: entity, itemRefs: refs }, ['destinationId', 'leaderRef', 'itemRefs']),
  ConsentViewV2: object({ consentId: entity, subjectRef: entity, requesterRef: entity, purpose: ref('ConsentPurpose'), scope: ref('ConsentScopeViewV2'), version: revision, status: en('proposed', 'accepted', 'declined', 'deferred', 'withdrawn'), sourceSeq: revision }),
  FollowViewV2: object({ followId: entity, subjectRef: entity, leaderRef: entity, destinationId: ref('Id'), planVersion: revision, consentId: entity, consentVersion: revision, status: en('proposed', 'accepted', 'following', 'paused', 'arrived', 'settled', 'withdrawn', 'cancelled'), reason: text(240) }),
  DecisionViewV2: object({ decisionId: entity, subjectRef: entity, purpose: en('recruitment', 'membership'), version: revision, status: en('undecided', 'accepted', 'declined', 'deferred', 'withdrawn'), sourceSeq: revision }),
  EndProposalViewV2: object({ proposalId: ref('Id'), proposalVersion: revision, scope: en('chapter', 'recruitment'), onlineMembershipVersion: revision, requiredCount: integer(5, 1), confirmedCount: integer(5), ownConfirmed: { type: 'boolean' }, status: en('pending', 'confirmed', 'invalidated') }),
  ChapterViewV2: object({ chapterId: lit('gaolaozhuang'), responsibilities: array(en('A', 'B', 'C', 'D', 'E'), 5), progress: fieldList, consents: array(ref('ConsentViewV2')), follows: array(ref('FollowViewV2')), decisions: array(ref('DecisionViewV2')), destinations: array(object({ destinationId: ref('Id'), label: text(120), sceneId: ref('Id'), position: point, purpose: en('follow', 'meeting', 'departure', 'waiting') })), endProposal: nullable(ref('EndProposalViewV2')), publicItems: array(object({ itemRef: entity, name: text(120), borrowed: { type: 'boolean' }, returned: { type: 'boolean' } })), route: en('undecided', 'public', 'disguise') }, ['route']),
  EndingViewV2: object({ title: text(120), summary: text(500), endingCode: en('GZ-E01', 'GZ-E02', 'GZ-E03'), facts: fieldList }, ['endingCode', 'facts']),
  RecapEntryV2: object({ entryRef: entity, eventSeq: revision, category: en('WorldFact', 'Evidence', 'Claim'), text: text(2000), fields: fieldList, speakerRef: entity, speakerName: text(120) }, ['speakerRef', 'speakerName']),
  RecapV2: object({ schemaVersion: lit(2), type: lit('session.recap'), sessionId: ref('Id'), throughSeq: revision, phase: en('Finished', 'Aborted'), ending: ref('EndingViewV2'), entries: array(ref('RecapEntryV2'), 100), nextBeforeSeq: nullable(revision) }),
  PublicEnvelope: object({ schemaVersion: lit(2), sessionId: ref('Id'), viewId: ref('Id'), actorRef: entity, clientActionId: ref('Id'), controlEpoch: revision, baseSeq: revision, action: ref('ActionV2') }),
  SyncRequestV2: object({ schemaVersion: lit(2), type: lit('sync.request'), sessionId: ref('Id'), viewId: ref('Id'), cursor: revision }),
  ControlRequestV2: object({ schemaVersion: lit(2), type: en('control.resume', 'control.take'), sessionId: ref('Id'), viewId: ref('Id'), actorRef: entity, nonce: ref('Id') }),
  ReceiptResultV2: object({ movementId: entity, planVersion: revision, movementCommandSeq: revision, status: en('accepted', 'moving', 'arrived', 'blocked', 'cancelled', 'locked'), entityRefs: refs, observationRefs: refs, message: text(500) }, ['movementId', 'planVersion', 'movementCommandSeq', 'status', 'entityRefs', 'observationRefs', 'message']),
  ReceiptV2: object({ schemaVersion: lit(2), sessionId: ref('Id'), clientActionId: ref('Id'), status: en('Accepted', 'Rejected'), code: ref('Id'), observedSeq: revision, actionEventRange: nullable(ref('EventRange')), result: ref('ReceiptResultV2') }),
  EntityViewV2: object({ entityRef: entity, name: text(120), appearanceEpoch: revision, appearanceId: ref('AppearanceIdV2'), sceneId: nullable(ref('Id')), position: nullable(point), facing: ref('Facing'), motionTrail: array(point,4096), motionFromSceneTimeMs: integer(), motionThroughSceneTimeMs: integer(), resourceRevision: revision, availableOperations: array(ref('GaolaoOperationId')) }, ['appearanceId','motionTrail','motionFromSceneTimeMs','motionThroughSceneTimeMs','resourceRevision','availableOperations']),
  SelfViewV2: object({ entityRef: entity, name: text(120), appearanceEpoch: revision, appearanceId: ref('AppearanceIdV2'), sceneId: nullable(ref('Id')), position: nullable(point), facing: ref('Facing'), controlEpoch: revision, canControl: { type: 'boolean' }, capabilities: ids, movementCommandHighWater: revision, resourceRevision: revision, availableOperations: array(ref('GaolaoOperationId')) }, ['appearanceId', 'resourceRevision', 'availableOperations']),
  ItemViewV2: object({ entityRef: entity, name: text(120), location: { oneOf: [object({ kind: lit('ground'), sceneId: ref('Id'), position: point }), object({ kind: lit('held'), ownerRef: entity })] }, resourceRevision: revision, transferable: { type: 'boolean' }, publicBorrowable: { type: 'boolean' }, fields: fieldList, reclaimHolderEpoch: revision, visualKey: ref('ObjectVisualKeyV1') }, ['reclaimHolderEpoch', 'visualKey']),
  TargetViewV2: object({ entityRef: entity, name: text(120), sceneId: ref('Id'), position: point, resourceRevision: revision, availableOperations: ids, fields: fieldList, visualKey: ref('ObjectVisualKeyV1') }, ['visualKey']),
  PlanViewV2: object({ movementId: entity, planVersion: revision, movementCommandSeq: revision, sceneId: ref('Id'), mapVersion: ref('Id'), goal: point, path: array(point, 4096), acceptedAtSceneTime: integer(), status: en('accepted', 'moving', 'arrived', 'blocked', 'cancelled'), reason: text(120) }, ['reason']),
  EvidenceSourceViewV2: object({ sourceRef: entity, kind: en('archive', 'testimony', 'material', 'comparison', 'decision', 'arrangement', 'contact'), label: text(240), beforeArrivalDays: integer(36500), receivedSeq: revision }),
  ObservationViewV2: object({ observationRef: entity, category: en('WorldFact', 'Evidence', 'Claim'), statement: text(2000), sourceSeq: revision, fields: fieldList, shareable: { type: 'boolean' }, source: ref('EvidenceSourceViewV2') }, ['source']),
  ClaimViewV2: object({ claimRef: entity, speakerRef: entity, speakerName: text(120), text: text(2000), channel: en('public', 'directed', 'team'), sourceSeq: revision }),
  CooperationViewV2: object({ operationId: ref('Id'), operationVersion: revision, phase: en('preparing', 'locked'), readyCount: integer(5), requiredCount: integer(5, 1), anchors: array(point, 5) }),
  PublicScene: object({ sceneId: ref('Id'), name: text(120), width: integer(1000000, 1), height: integer(1000000, 1), unitsPerPixel: integer(10000, 1), walkableAreas: array(object({ areaId: ref('Id'), polygon: ref('Polygon') })), obstacles: array(object({ obstacleId: ref('Id'), polygon: ref('Polygon'), exceptAreas: ids })), anchors: array(object({ anchorId: ref('Id'), position: point, label: text(120) })), exits: array(object({ exitId: ref('Id'), anchorId: ref('Id'), destinationSceneId: ref('Id'), destination: point, open: { type: 'boolean' } })) }),
  ProjectionV2: object({ protocolCapability: lit('spatial-v2'), chapterVersion: ref('Id'), mapVersion: ref('Id'), variantId: ref('Id'), contentVersion: ref('Id'), reducerVersion: en('spatial-world-v2', 'gaolao-world-v1'), phase: en('Lobby', 'Running', 'Finished', 'Aborted'), sceneTimeMs: integer(), paused: { type: 'boolean' }, self: ref('SelfViewV2'), entities: array(ref('EntityViewV2')), items: array(ref('ItemViewV2')), targets: array(ref('TargetViewV2')), scene: nullable(ref('PublicScene')), movement: nullable(ref('PlanViewV2')), observations: array(ref('ObservationViewV2')), claims: array(ref('ClaimViewV2')), cooperations: array(ref('CooperationViewV2')), objectives: array(object({ objectiveId: ref('Id'), label: text(240), status: en('active', 'completed', 'blocked') })), ending: nullable(ref('EndingViewV2')), chapter: ref('ChapterViewV2') }, ['chapter']),
  SnapshotV2: object({ schemaVersion: lit(2), type: lit('world.snapshot'), sessionId: ref('Id'), viewId: ref('Id'), snapshotSeq: revision, projection: ref('ProjectionV2') }),
  BatchV2: object({ schemaVersion: lit(2), type: lit('world.batch'), sessionId: ref('Id'), viewId: ref('Id'), fromExclusive: revision, throughSeq: revision, events: array(object({ sessionSeq: ref('PositiveDecimalString'), eventId: ref('Id'), kind: lit('projection.replace'), payload: object({ projection: ref('ProjectionV2') }) })) }),
  ControlResponseV2: object({ schemaVersion: lit(2), sessionId: ref('Id'), nonce: ref('Id'), controlEpoch: revision, observedSeq: revision, snapshot: ref('SnapshotV2') }),
  ErrorV2: object({ schemaVersion: lit(2), code: ref('Id'), message: text(500), requiredCapabilities: array(en('spatial-v2'), 1) }, ['requiredCapabilities']),
};
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const spatialSchema = freeze({ $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://github.com/gbcdby/xiyou/protocol/spatial-v2', $defs: defs });
