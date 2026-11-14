import { ContractError, canonicalize, parseStrictJSON, sha256Canonical } from './index.mjs';
import { checkSpatialSchema } from './spatial.mjs';
import { spatialAISchema } from './spatial-ai-schema.mjs';
export { spatialAISchema, spatialModelKinds, spatialIntentResponseSchema } from './spatial-ai-schema.mjs';

const fail = (path = '$') => { throw new ContractError('消息不符合空间模型合同', path); };
const speech = (action, path) => {
  if (['speak', 'make_claim'].includes(action.kind) && (action.channel === 'public' ? action.recipientRefs.length !== 0 : action.recipientRefs.length === 0)) fail(path + '.recipientRefs');
};
export function validateSpatialAI(name, value) {
  canonicalize(value);
  if (!Object.hasOwn(spatialAISchema.$defs, name)) fail();
  checkSpatialSchema(spatialAISchema.$defs[name], value, spatialAISchema.$defs);
  if (name === 'SpatialModelActionV2') speech(value, '$');
  if (name === 'SpatialProposedIntentV2') value.toolCalls.forEach((action, index) => speech(action, '$.toolCalls[' + index + ']'));
  if (['SpatialContextV2', 'SpatialDecisionContextV2'].includes(name)) {
    if (value.projection.claims.some(claim => claim.channel === 'team')) fail('$.projection.claims');
    const observations = new Set(value.projection.observations.map(o => o.observationRef));
    const objectives = new Set(value.projection.objectives.map(o => o.objectiveId));
    for (const goal of value.goals ?? []) if (goal.basedOnObservationRefs.some(reference => !observations.has(reference)) || goal.objectiveId !== undefined && !objectives.has(goal.objectiveId)) fail('$.goals');
    if (new Set((value.goals ?? []).map(goal => goal.goalId)).size !== (value.goals ?? []).length) fail('$.goals');
  }
  return value;
}
export function parseSpatialAI(name, raw) {
  return validateSpatialAI(name, parseStrictJSON(raw, { maxBytes: name.includes('Context') ? 262144 : 65536 }));
}

/** 工具允许列表与可见引用来自同次可信投影；通过此处仍须在提交时重新授权。 */
export function validateSpatialActionForContext(action, context) {
  validateSpatialAI('SpatialModelActionV2', action);
  validateSpatialAI('SpatialContextV2', context);
  const p = context.projection;
  if (!context.tools.some(tool => tool.kind === action.kind && Object.entries(tool).every(([key, value]) => ['description', 'purpose', 'scope'].includes(key) || canonicalize(action[key] ?? null) === canonicalize(value)))) fail('$.toolCalls');
  const people = new Set([p.self, ...p.entities].filter(e => e.sceneId !== null && e.position !== null).map(e => e.entityRef));
  const targets = new Set([...people, ...p.targets.map(e => e.entityRef), ...p.items.map(e => e.entityRef)]);
  const observations = new Set(p.observations.map(o => o.observationRef));
  const item = reference => p.items.find(i => i.entityRef === reference);
  if (action.targetRef && !targets.has(action.targetRef)) fail('$.toolCalls.targetRef');
  if (action.itemRef && (!item(action.itemRef) || item(action.itemRef).resourceRevision !== action.expectedItemRevision)) fail('$.toolCalls.itemRef');
  if (action.recipientRef && !people.has(action.recipientRef)) fail('$.toolCalls.recipientRef');
  if (action.recipientRefs?.some(reference => !people.has(reference))) fail('$.toolCalls.recipientRefs');
  if (action.evidenceRef && !p.observations.some(o => o.observationRef === action.evidenceRef && o.shareable)) fail('$.toolCalls.evidenceRef');
  if (['respond_consent', 'withdraw_consent'].includes(action.kind) && !(p.chapter?.consents ?? []).some(c => c.consentId === action.consentId && c.subjectRef === p.self.entityRef && c.version === action.expectedConsentVersion && c.status !== 'withdrawn')) fail('$.toolCalls.consentId');
  if (action.kind === 'move_to') {
    const current = p.scene?.sceneId === action.sceneId;
    if (!current && !p.scene?.exits.some(e => e.open && e.destinationSceneId === action.sceneId)) fail('$.toolCalls.sceneId');
    if (current && (action.destination.x > p.scene.width || action.destination.y > p.scene.height)) fail('$.toolCalls.destination');
    if (action.anchorId && (!current || !p.scene.anchors.some(a => a.anchorId === action.anchorId))) fail('$.toolCalls.anchorId');
  }
  if (action.kind === 'put_item' && (action.sceneId !== p.scene?.sceneId || action.position.x > p.scene.width || action.position.y > p.scene.height)) fail('$.toolCalls.position');
  const parameters = action.parameters;
  if (parameters?.evidenceRefs?.some(reference => !observations.has(reference))) fail('$.toolCalls.parameters.evidenceRefs');
  if (parameters?.consentId && !(p.chapter?.consents ?? []).some(c => c.consentId === parameters.consentId && c.version === parameters.expectedConsentVersion && c.status !== 'withdrawn')) fail('$.toolCalls.parameters.consentId');
  if (parameters?.destinationId && !p.chapter?.destinations.some(d => d.destinationId === parameters.destinationId)) fail('$.toolCalls.parameters.destinationId');
  if (parameters?.itemRef && (!item(parameters.itemRef) || item(parameters.itemRef).resourceRevision !== parameters.expectedItemRevision)) fail('$.toolCalls.parameters.itemRef');
  if (parameters?.itemRefs?.some(reference => !item(reference))) fail('$.toolCalls.parameters.itemRefs');
  if (parameters?.expectedDecisionVersion !== undefined) {
    const purpose = action.operationId === 'gz-recruitment-decision' ? 'recruitment' : 'membership';
    const current = p.chapter?.decisions.find(d => d.subjectRef === p.self.entityRef && d.purpose === purpose);
    if (action.targetRef !== p.self.entityRef || parameters.expectedDecisionVersion !== (current?.version ?? '0')) fail('$.toolCalls.parameters.expectedDecisionVersion');
  }
  return action;
}
export function parseSpatialProposedIntent(raw, expectedDecisionId, context) {
  const intent = parseSpatialAI('SpatialProposedIntentV2', raw);
  if (intent.decisionId !== expectedDecisionId) fail('$.decisionId');
  if (context) {
    validateSpatialAI('SpatialDecisionContextV2', context);
    if (context.decision.decisionId !== expectedDecisionId) fail('$.decisionId');
    intent.toolCalls.forEach(action => validateSpatialActionForContext(action, context));
  }
  return intent;
}
export function canonicalSpatialIntentPayload(value) {
  return canonicalize(validateSpatialAI('SpatialProposedIntentV2', value));
}
export const spatialIntentSemanticDigest = value => sha256Canonical(canonicalSpatialIntentPayload(value));
