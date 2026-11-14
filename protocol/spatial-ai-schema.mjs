import { spatialSchema, ref, object, array, text, en, lit, nullable } from './spatial-schema.mjs';

/** 模型字段源只复用授权 DTO；不包含 PublicEnvelope、内部身份或决定依赖。 */
const omit = (schema, names) => ({ ...schema,
  properties: Object.fromEntries(Object.entries(schema.properties).filter(([key]) => !names.includes(key))),
  required: schema.required.filter(key => !names.includes(key)),
});
export const spatialModelKinds = Object.freeze(['move_to', 'stop_move', 'inspect', 'take_item', 'put_item', 'transfer_item', 'interact', 'speak', 'make_claim', 'share_evidence', 'respond_consent', 'withdraw_consent', 'wait']);
const actions = spatialSchema.$defs.ActionV2.oneOf.filter(schema => schema.$ref === '#/$defs/GaolaoInteractionV2' || spatialModelKinds.includes(schema.properties?.kind.const)).map(schema => {
  const kind = schema.properties?.kind.const;
  if (['move_to', 'stop_move'].includes(kind)) return omit(schema, ['movementCommandSeq']);
  if (['speak', 'make_claim'].includes(kind)) return { ...schema, properties: { ...schema.properties, channel: en('public', 'directed') } };
  return schema;
});
const toolProperties = {
  kind: en(...spatialModelKinds), description: text(500), sceneId: ref('Id'), targetRef: ref('EntityRef'),
  itemRef: ref('EntityRef'), expectedItemRevision: ref('DecimalString'), operationId: ref('Id'),
  expectedTargetRevision: ref('DecimalString'), evidenceRef: ref('EntityRef'), consentId: ref('EntityRef'),
  expectedConsentVersion: ref('DecimalString'), purpose: ref('ConsentPurpose'), scope: ref('ConsentScopeViewV2'),
};
const projection = { ...spatialSchema.$defs.ProjectionV2, properties: {
  ...spatialSchema.$defs.ProjectionV2.properties,
  self: ref('SpatialModelSelfV2'), entities: array(ref('SpatialModelEntityV2')),
  items: array(ref('SpatialModelItemV2')), movement: nullable(ref('SpatialModelMovementV2')),
} };
const context = object({
  schemaVersion: lit(2), contextVersion: lit('spatial-ai-context-v1'), sessionId: ref('Id'), viewId: ref('Id'),
  snapshotSeq: ref('DecimalString'), projection: ref('SpatialModelProjectionV2'), tools: array(ref('SpatialModelToolV2'), 4096),
  decision: object({ decisionId: ref('Id') }),
  persona: object({ motives: array(text(400), 8), boundaries: array(text(400), 8) }),
  goals: array(ref('SpatialModelGoalV2'), 32),
}, ['decision', 'persona', 'goals']);
const all = {
  ...spatialSchema.$defs,
  SpatialModelActionV2: { oneOf: actions },
  SpatialProposedIntentV2: object({ schemaVersion: lit(2), decisionId: ref('Id'), toolCalls: { ...array(ref('SpatialModelActionV2'), 1), minItems: 1 } }),
  SpatialModelToolV2: object(toolProperties, Object.keys(toolProperties).filter(key => !['kind', 'description'].includes(key))),
  SpatialModelSelfV2: omit(spatialSchema.$defs.SelfViewV2, ['controlEpoch', 'canControl', 'movementCommandHighWater']),
  SpatialModelEntityV2: omit(spatialSchema.$defs.EntityViewV2, ['motionTrail', 'motionFromSceneTimeMs', 'motionThroughSceneTimeMs']),
  SpatialModelItemV2: omit(spatialSchema.$defs.ItemViewV2, ['reclaimHolderEpoch']),
  SpatialModelMovementV2: omit(spatialSchema.$defs.PlanViewV2, ['movementCommandSeq']),
  SpatialModelProjectionV2: projection,
  SpatialModelGoalV2: object({ goalId: ref('Id'), label: text(240), status: en('active', 'completed', 'blocked'), basedOnObservationRefs: { ...array(ref('EntityRef'), 32), uniqueItems: true }, objectiveId: ref('Id') }, ['objectiveId']),
  SpatialContextV2: context,
  SpatialDecisionContextV2: { ...context, required: [...context.required, 'decision'] },
};
const collect = (name, defs) => {
  if (Object.hasOwn(defs, name)) return;
  defs[name] = all[name];
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) collect(value.$ref.split('/').at(-1), defs);
    Object.values(value).forEach(visit);
  };
  visit(defs[name]);
};
const defs = {};
for (const name of ['SpatialProposedIntentV2', 'SpatialContextV2', 'SpatialDecisionContextV2']) collect(name, defs);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const spatialAISchema = freeze({ $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://github.com/gbcdby/xiyou/protocol/spatial-ai-v2', $defs: defs });

/** 供应商只收到模型输出的可达定义，不包含网络请求和内部状态合同。 */
export function spatialIntentResponseSchema() {
  const outputDefs = {};
  collect('SpatialProposedIntentV2', outputDefs);
  return structuredClone({ $ref: '#/$defs/SpatialProposedIntentV2', $defs: outputDefs });
}
