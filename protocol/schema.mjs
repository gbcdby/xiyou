/** 机器契约的唯一字段来源；生成 JSON Schema 与 TypeScript 声明。 */
const ref = name => ({ $ref: '#/$defs/' + name });
const object = (properties, optional = []) => ({
  type: 'object', properties,
  required: Object.keys(properties).filter(key => !optional.includes(key)),
  additionalProperties: false,
});
const array = (items, options = {}) => ({ type: 'array', items, ...options });
const text = (maxLength = 2000) => ({ type: 'string', maxLength });
const enumeration = (...values) => ({ enum: values });
const literal = value => ({ const: value });
const nullable = schema => ({ oneOf: [schema, { type: 'null' }] });
const dictionary = value => ({ type: 'object', propertyNames: ref('Id'), additionalProperties: value });
const ids = (options = {}) => array(ref('Id'), { uniqueItems: true, ...options });
const action = (kind, fields = {}, optional = []) => object({ kind: literal(kind), ...fields }, optional);
const event = (kind, payload) => object({ kind: literal(kind), payload });
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };

const defs = {
  Id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}(?![\\s\\S])' },
  UserId: ref('Id'),
  CharacterId: ref('Id'),
  SessionId: ref('Id'),
  DecimalString: { type: 'string', pattern: '^(0|[1-9][0-9]*)(?![\\s\\S])' },
  PositiveDecimalString: { type: 'string', pattern: '^[1-9][0-9]*(?![\\s\\S])' },
  UtcTimestamp: { type: 'string', format: 'date-time', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z(?![\\s\\S])' },
  Digest: { type: 'string', pattern: '^[0-9a-f]{64}(?![\\s\\S])' },
  SessionPhase: enumeration('Lobby', 'Running', 'Finished', 'Aborted'),
  ControlMode: enumeration('HumanControlled', 'GracePeriod', 'AIProxyControlled', 'CoreNPCControlled', 'Revoked'),
  DecisionStatus: enumeration('Pending', 'Committed', 'Rejected', 'Expired', 'Cancelled'),
  ActionKind: enumeration('move', 'inspect', 'take_item', 'transfer_item', 'use_item', 'interact', 'share_evidence', 'speak', 'make_claim', 'wait'),
  Scalar: { oneOf: [text(2000), integer, { type: 'boolean' }, { type: 'null' }] },
  FactField: object({ key: ref('Id'), label: text(120), value: ref('Scalar') }),
  ItemLocation: { oneOf: [
    object({ kind: literal('character'), characterId: ref('CharacterId') }),
    object({ kind: literal('region'), regionId: ref('Id') }),
    object({ kind: literal('consumed') }),
  ] },
  Dialogue: object({ text: { ...text(2000), minLength: 1 }, channel: enumeration('public', 'directed', 'private'), recipientIds: ids({ maxItems: 7 }) }),
  PublicDialogue: object({ text: { ...text(2000), minLength: 1 }, channel: enumeration('public', 'directed'), recipientIds: ids({ maxItems: 7 }) }),
  Action: { oneOf: [
    action('move', { regionId: ref('Id') }),
    action('inspect', { targetId: ref('Id') }),
    action('take_item', { itemId: ref('Id'), expectedItemRevision: ref('DecimalString') }),
    action('transfer_item', { itemId: ref('Id'), targetId: ref('CharacterId'), expectedItemRevision: ref('DecimalString') }),
    action('use_item', { itemIds: ids({ minItems: 1, maxItems: 16 }), expectedItemRevisions: dictionary(ref('DecimalString')), targetId: ref('Id'), expectedTargetRevision: ref('DecimalString'), operation: ref('Id') }),
    action('interact', { targetId: ref('Id'), operation: ref('Id'), expectedTargetRevision: ref('DecimalString') }),
    action('share_evidence', { evidenceId: ref('Id'), recipientIds: ids({ minItems: 1, maxItems: 7 }) }),
    action('speak', { text: { ...text(2000), minLength: 1 }, channel: enumeration('public', 'directed', 'private'), recipientIds: ids({ maxItems: 7 }) }),
    action('make_claim', { text: { ...text(2000), minLength: 1 }, channel: enumeration('public', 'directed', 'private'), recipientIds: ids({ maxItems: 7 }) }),
    action('wait'),
  ] },
  ClientAction: object({
    schemaVersion: literal(1), sessionId: ref('SessionId'), actorId: ref('CharacterId'),
    clientActionId: ref('Id'), controlEpoch: ref('DecimalString'), baseSeq: ref('DecimalString'), action: ref('Action'),
  }),
  DedupeKey: object({ sessionId: ref('SessionId'), principalId: ref('Id'), clientActionId: ref('Id') }),
  EventRange: object({ first: ref('PositiveDecimalString'), last: ref('PositiveDecimalString') }),
  ReceiptResult: object({ message: text(500), observationIds: ids({ maxItems: 32 }), changedEntityIds: ids({ maxItems: 32 }) }, ['message', 'observationIds', 'changedEntityIds']),
  AcceptedCode: enumeration('OK', 'NO_CHANGE'),
  RejectedCode: enumeration('SESSION_NOT_RUNNING', 'STALE_CONTROL', 'TARGET_UNAVAILABLE', 'STALE_PRECONDITION', 'ACTION_ID_REUSE', 'DECISION_STALE', 'DECISION_EXPIRED', 'FUTURE_BASE_SEQ', 'CONTROL_HELD', 'RULE_VIOLATION', 'NOT_READY', 'ROOM_FULL'),
  ErrorCode: enumeration('INVALID_MESSAGE', 'UNAUTHENTICATED', 'FORBIDDEN', 'SESSION_GONE', 'RESYNC_REQUIRED', 'OUTCOME_UNKNOWN', 'CONTROL_HELD', 'ACTION_ID_REUSE'),
  ErrorResponse: object({ schemaVersion: literal(1), code: ref('ErrorCode'), message: text(500) }, ['message']),
  TrustedExecutionContext: object({
    principalId: ref('Id'), principalKind: enumeration('human', 'core_npc', 'proxy', 'system'),
    sessionId: ref('SessionId'), actorId: ref('CharacterId'), userId: ref('UserId'),
    connectionId: ref('Id'), authenticatedAt: ref('UtcTimestamp'),
  }, ['actorId', 'userId', 'connectionId']),
  ObservationSource: object({
    kind: enumeration('initial_content', 'inspection', 'event', 'speech', 'evidence_share'),
    sourceIds: ids({ minItems: 1, maxItems: 32 }), sourceSeq: ref('DecimalString'),
  }),
  Observation: object({
    observationId: ref('Id'), observerId: ref('CharacterId'),
    category: enumeration('WorldFact', 'Claim', 'Evidence'), source: ref('ObservationSource'),
    statement: text(2000), subjectId: ref('Id'), fields: array(ref('FactField'), { maxItems: 32 }),
    shareable: { type: 'boolean' },
  }, ['subjectId']),
  Claim: object({
    claimId: ref('Id'), speakerId: ref('CharacterId'), text: { ...text(2000), minLength: 1 },
    channel: enumeration('public', 'directed', 'private'), recipientIds: ids({ maxItems: 7 }),
  }),
  Belief: object({
    beliefId: ref('Id'), holderId: ref('CharacterId'), statement: text(2000),
    confidence: enumeration('uncertain', 'likely', 'confident'),
    basedOnObservationIds: ids({ minItems: 1, maxItems: 32 }), revision: ref('DecimalString'),
  }),
  BeliefProposal: object({
    beliefId: ref('Id'), statement: text(2000), confidence: enumeration('uncertain', 'likely', 'confident'),
    basedOnObservationIds: ids({ minItems: 1, maxItems: 32 }),
  }),
  Goal: object({ goalId: ref('Id'), holderId: ref('CharacterId'), label: text(240), status: enumeration('active', 'completed', 'abandoned'), revision: ref('DecimalString') }),
  ProposedIntent: object({
    decisionId: ref('Id'), toolCalls: array(ref('Action'), { maxItems: 8 }),
    dialogue: ref('PublicDialogue'), beliefUpdates: array(ref('BeliefProposal'), { maxItems: 16 }),
  }, ['dialogue', 'beliefUpdates']),
  DecisionRecord: object({
    schemaVersion: literal(1), sessionId: ref('SessionId'), actorId: ref('CharacterId'), decisionId: ref('Id'),
    controlEpoch: ref('DecimalString'), generation: ref('DecimalString'),
    observationIds: ids({ maxItems: 256 }), readVersions: dictionary(ref('DecimalString')),
    allowedTools: array(ref('ActionKind'), { uniqueItems: true, maxItems: 10 }),
    createdAt: ref('UtcTimestamp'), deadlineAt: ref('UtcTimestamp'), status: ref('DecisionStatus'),
  }),
  Audience: object({
    humanCharacterIds: ids({ maxItems: 5 }), coreNpcCharacterIds: ids({ maxItems: 2 }), proxyCharacterIds: ids({ maxItems: 5 }),
  }),
  EventCause: object({
    principalId: ref('Id'), actionId: ref('Id'), actorId: ref('CharacterId'),
    decisionId: ref('Id'), toolCallIndex: { type: 'integer', minimum: 0, maximum: 7 },
  }, ['actorId', 'decisionId', 'toolCallIndex']),
  CharacterView: object({
    characterId: ref('CharacterId'), name: text(120), regionId: nullable(ref('Id')),
    roles: ids({ maxItems: 5 }), mode: ref('ControlMode'), online: { type: 'boolean' },
  }),
  SelfView: object({
    characterId: ref('CharacterId'), name: text(120), regionId: nullable(ref('Id')),
    roles: ids({ maxItems: 5 }), mode: ref('ControlMode'), controlEpoch: ref('DecimalString'),
    canControl: { type: 'boolean' }, capabilities: ids({ maxItems: 32 }),
  }),
  RegionView: object({ regionId: ref('Id'), name: text(120), description: text(1000), exits: ids({ maxItems: 16 }) }),
  ItemView: object({ itemId: ref('Id'), name: text(120), location: ref('ItemLocation'), resourceRevision: ref('DecimalString'), transferable: { type: 'boolean' }, fields: array(ref('FactField'), { maxItems: 32 }) }),
  TargetView: object({ targetId: ref('Id'), name: text(120), regionId: ref('Id'), resourceRevision: ref('DecimalString'), availableOperations: ids({ maxItems: 32 }), fields: array(ref('FactField'), { maxItems: 32 }) }),
  ObjectiveView: object({ objectiveId: ref('Id'), label: text(240), status: enumeration('active', 'completed', 'blocked'), detail: text(500) }, ['detail']),
  EndingView: object({ endingCode: ref('Id'), title: text(120), summary: text(2000), facts: array(ref('FactField'), { maxItems: 32 }), unresolved: array(text(500), { maxItems: 16 }) }),
  RecapReference: object({ kind: enumeration('observation', 'claim', 'character', 'item', 'target', 'region', 'source'), id: ref('Id') }),
  RecapEntry: object({
    entryId: ref('Id'), eventSeq: ref('PositiveDecimalString'), serverTime: ref('UtcTimestamp'),
    category: enumeration('Observation', 'Claim', 'WorldFact'),
    kind: enumeration('observed', 'received_evidence', 'heard_claim', 'received_claim', 'said', 'moved', 'took', 'transferred', 'used', 'updated', 'finished', 'aborted'),
    actorId: nullable(ref('CharacterId')), text: text(2000), fields: array(ref('FactField'), { maxItems: 32 }),
    references: array(ref('RecapReference'), { maxItems: 40 }),
  }),
  AuthorizedRecap: object({
    schemaVersion: literal(1), type: literal('session.recap'), sessionId: ref('SessionId'), actorId: ref('CharacterId'),
    throughSeq: ref('DecimalString'), phase: enumeration('Finished', 'Aborted'),
    entries: array(ref('RecapEntry'), { maxItems: 100 }), nextBeforeSeq: nullable(ref('PositiveDecimalString')),
  }),
  AuthorizedProjection: object({
    phase: ref('SessionPhase'), contentVersion: ref('Id'), reducerVersion: ref('Id'),
    self: ref('SelfView'), characters: array(ref('CharacterView'), { maxItems: 7 }),
    regions: array(ref('RegionView'), { maxItems: 32 }), items: array(ref('ItemView'), { maxItems: 256 }),
    targets: array(ref('TargetView'), { maxItems: 256 }), observations: array(ref('Observation')),
    claims: array(ref('Claim')), objectives: array(ref('ObjectiveView'), { maxItems: 32 }),
    ending: nullable(ref('EndingView')), deadlineAt: nullable(ref('UtcTimestamp')),
  }),
  AuthorizedSnapshot: object({
    schemaVersion: literal(1), type: literal('world.snapshot'), sessionId: ref('SessionId'),
    viewId: ref('Id'), snapshotSeq: ref('DecimalString'), projection: ref('AuthorizedProjection'),
  }),
  SyncRequest: object({
    schemaVersion: literal(1), type: literal('sync.request'), sessionId: ref('SessionId'), viewId: ref('Id'), cursor: ref('DecimalString'),
  }),
  ControlRequest: object({
    schemaVersion: literal(1), type: enumeration('control.resume', 'control.take'),
    sessionId: ref('SessionId'), actorId: ref('CharacterId'), nonce: ref('Id'),
  }),
  ControlResponse: object({
    schemaVersion: literal(1), sessionId: ref('SessionId'), actorId: ref('CharacterId'), nonce: ref('Id'),
    controlEpoch: ref('DecimalString'), mode: ref('ControlMode'), observedSeq: ref('DecimalString'),
  }),
  OutboxRecord: object({
    schemaVersion: literal(1), sessionId: ref('SessionId'), fromExclusive: ref('DecimalString'),
    throughSeq: ref('DecimalString'), status: enumeration('Pending', 'Published'), attempts: integer,
  }),
};

const receiptFields = {
  schemaVersion: literal(1), semanticDigest: ref('Digest'), actorId: ref('CharacterId'),
  observedSeq: ref('DecimalString'), actionEventRange: nullable(ref('EventRange')), result: ref('ReceiptResult'),
};
defs.ActionReceipt = { oneOf: [
  object({ ...receiptFields, key: ref('DedupeKey'), status: literal('Accepted'), code: ref('AcceptedCode') }),
  object({ ...receiptFields, key: ref('DedupeKey'), status: literal('Rejected'), code: ref('RejectedCode'), actionEventRange: { type: 'null' } }),
] };
defs.ClientReceipt = { oneOf: [
  object({ ...receiptFields, sessionId: ref('SessionId'), clientActionId: ref('Id'), status: literal('Accepted'), code: ref('AcceptedCode') }),
  object({ ...receiptFields, sessionId: ref('SessionId'), clientActionId: ref('Id'), status: literal('Rejected'), code: ref('RejectedCode'), actionEventRange: { type: 'null' } }),
] };

const eventVariants = [
  event('session.created', object({ contentVersion: ref('Id'), reducerVersion: ref('Id'), hostUserId: ref('UserId'), seed: ref('Id') })),
  event('session.member_joined', object({ userId: ref('UserId'), characterId: ref('CharacterId'), name: text(120) })),
  event('session.started', object({ deadlineAt: ref('UtcTimestamp'), characterIds: ids({ minItems: 2, maxItems: 7 }) })),
  event('session.finished', object({ endingCode: ref('Id'), facts: array(ref('FactField'), { maxItems: 32 }) })),
  event('session.aborted', object({ reason: text(500) })),
  event('control.changed', object({
    actorId: ref('CharacterId'), mode: ref('ControlMode'), controlEpoch: ref('DecimalString'),
    activeConnectionId: nullable(ref('Id')), graceDeadlineAt: nullable(ref('UtcTimestamp')),
  })),
  event('character.moved', object({ actorId: ref('CharacterId'), from: ref('Id'), to: ref('Id'), resourceRevision: ref('DecimalString') })),
  event('item.taken', object({ itemId: ref('Id'), from: ref('ItemLocation'), to: ref('CharacterId'), resourceRevision: ref('DecimalString') })),
  event('item.transferred', object({ itemId: ref('Id'), from: ref('CharacterId'), to: ref('CharacterId'), resourceRevision: ref('DecimalString') })),
  event('item.used', object({ itemId: ref('Id'), actorId: ref('CharacterId'), targetId: ref('Id'), operation: ref('Id'), consumed: { type: 'boolean' }, resourceRevision: ref('DecimalString') })),
  event('target.updated', object({ targetId: ref('Id'), resourceRevision: ref('DecimalString'), fields: array(ref('FactField'), { maxItems: 32 }) })),
  event('ClaimRecorded', ref('Claim')),
  event('ObservationRecorded', ref('Observation')),
  event('BeliefUpdated', ref('Belief')),
  event('GoalUpdated', ref('Goal')),
];
defs.WorldEvent = { oneOf: eventVariants.map(variant => object({
  schemaVersion: literal(1), sessionId: ref('SessionId'), sessionSeq: ref('PositiveDecimalString'),
  eventId: text(260), causedBy: ref('EventCause'), serverTime: ref('UtcTimestamp'), audience: ref('Audience'),
  ...variant.properties,
})) };
const clientVariants = [
  event('projection.replace', object({ projection: ref('AuthorizedProjection') })),
  event('ClaimRecorded', ref('Claim')),
  event('ObservationRecorded', ref('Observation')),
];
defs.ClientEvent = { oneOf: clientVariants.map(variant => object({
  sessionSeq: ref('PositiveDecimalString'), eventId: text(260), ...variant.properties,
})) };
defs.WorldBatch = object({
  schemaVersion: literal(1), type: literal('world.batch'), sessionId: ref('SessionId'), viewId: ref('Id'),
  fromExclusive: ref('DecimalString'), throughSeq: ref('DecimalString'), events: array(ref('ClientEvent'), { maxItems: 256 }),
});

export const contractNames = Object.freeze([
  'ClientAction', 'ActionReceipt', 'ClientReceipt', 'WorldEvent', 'DecisionRecord', 'ProposedIntent',
  'AuthorizedSnapshot', 'WorldBatch', 'SyncRequest', 'ControlRequest', 'ControlResponse', 'ErrorResponse',
  'OutboxRecord', 'TrustedExecutionContext', 'AuthorizedProjection', 'AuthorizedRecap',
]);

const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export const contractSchema = freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://github.com/gbcdby/xiyou/protocol/contracts-v1',
  title: 'xiyou VS-001 v1 契约',
  description: '仅检验结构和确定性编码，不授予权限或提交世界事实。',
  $defs: defs,
  oneOf: contractNames.map(ref),
});
