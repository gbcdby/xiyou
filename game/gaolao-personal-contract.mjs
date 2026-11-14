import { createHash } from 'node:crypto';
import { canonicalize, ContractError } from '../protocol/index.mjs';
import { checkSpatialSchema, gaolaoPersonalProfile, gaolaoPersonalProfiles } from '../protocol/spatial.mjs';
import { spatialSchema, object, array, ref, lit, en, nullable } from '../protocol/spatial-schema.mjs';

export const PERSONAL_CAPABILITY = 'gaolao-personal-consent-v1';
export const PERSONAL_SOURCE_IDS = Object.freeze({ appearance: 'cuilan-appearance-boundaries-v1', private_items: 'cuilan-private-items-v1' });
const digest = value => createHash('sha256').update(canonicalize(value)).digest('hex');
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const invalid = path => { throw new ContractError('个人许可持久合同不完整或不一致', path); };
const id = ref('Id'), token = ref('EntityRef'), seq = ref('DecimalString');
const hash = { type: 'string', pattern: '^[a-f0-9]{64}(?![\\s\\S])' };
const scopeSchemas = freeze({
  appearance: object({ destinationId: id, permissionTerm: ref('PersonalPermissionTermV1'), usage: lit('inquiry_meeting'), radius: lit(90) }),
  private_items: object({ itemIds: { ...array(id, 2), minItems: 1, uniqueItems: true }, ownerId: id, handling: lit('retrieve_to_owner'), permissionTerm: ref('PersonalPermissionTermV1'), offerRef: token, sourceRevision: lit('1'), sourceDigest: hash }),
});
const identities = { subjectId: id, subjectEpoch: seq, requesterId: id, requesterEpoch: seq, performerId: nullable(id), performerEpoch: nullable(seq), scopeDigest: hash, contentVersion: id, chapterVersion: id, mapVersion: id, policyVersion: lit('gaolao-cuilan-v2') };
const sourceBinding = object({ sourceId: en(...Object.values(PERSONAL_SOURCE_IDS)), sourceRevision: lit('1'), sourceRef: token, observationRef: token, sourceSeq: seq, receivedSeq: seq, digest: hash });
const proposalBinding = object({ ...identities, consentVersion: seq, requestActionId: id, requestDigest: hash, sourceSeq: seq, requestObservationRef: token, receivedSeq: seq });
const acceptedProof = object({ ...identities, consentVersion: seq, actionId: id, requestDigest: hash, sources: { ...array(sourceBinding, 1), minItems: 1 } });
const noticeSchema = object({ noticeId: token, consentId: token, acceptedConsentVersion: seq, reasonCode: en('binding_invalidated', 'appearance_disclosed'), sourceEventId: id, sourceSeq: seq, receivedSeq: seq });
const itemUse = object({ itemId: id, takeActionId: nullable(id), acquisitionId: nullable(token), outcome: en('pending', 'held', 'delivered_to_owner', 'restored_origin', 'already_at_owner') });
export const personalRequestRecordSchema = freeze(object({
  consentId: token, lifecycleVersion: seq, lifecycle: ref('PersonalLifecycleV1'), reasonCode: nullable(ref('PersonalReasonCodeV1')), transitionActor: nullable(id), transitionSeq: seq, proposalBinding,
  execution: object({ state: ref('PersonalExecutionStateV1'), acceptedProof: nullable(acceptedProof), appearanceStarted: { type: 'boolean' }, appearanceEnded: { type: 'boolean' }, itemUses: array(itemUse, 2) }), notice: nullable(noticeSchema),
}));
export const privateAcquisitionSchema = freeze(object({ acquisitionId: token, itemId: id, holderId: id, ownerId: id, originalConsentId: token, acceptedConsentVersion: seq, sourceLifecycleVersion: seq, scopeDigest: hash, takeActionId: id, requestDigest: hash, takenAtSeq: seq, origin: ref('PersonalOriginV1'), outcome: en('held', 'delivered_to_owner', 'restored_origin'), resolvedByActionId: nullable(id), resolvedAtSeq: nullable(seq) }));
export const privateItemOfferRecordSchema = freeze(object({ offerRef: token, sessionId: id, requesterId: id, subjectId: id, viewId: id, contentVersion: id, sourceRevision: lit('1'), sourceDigest: hash, sourceRef: token, describedAtSeq: seq, options: { ...array(object({ optionRef: token, itemId: id }), 2), minItems: 1 } }));
export const personalDecisionBindingSchema = freeze(object({ purpose: ref('PersonalPurposeV1'), consentId: token, consentVersion: seq, status: en('proposed', 'accepted', 'declined', 'deferred', 'withdrawn'), scope: { oneOf: Object.values(scopeSchemas) }, scopeDigest: hash, permissionTerm: ref('PersonalPermissionTermV1'), lifecycleVersion: seq, lifecycle: ref('PersonalLifecycleV1'), reasonCode: nullable(ref('PersonalReasonCodeV1')), executionState: ref('PersonalExecutionStateV1'), proposalBinding, acceptedProof: nullable(acceptedProof), notice: nullable(noticeSchema) }));

export const createPersonalState = () => ({ personalRequests: {}, privateAcquisitions: {}, privateItemOffers: {} });
export function requirePersonalState(state) {
  const chapter = state.chapter;
  for (const key of ['personalRequests', 'privateAcquisitions', 'privateItemOffers']) {
    if (!chapter || !Object.hasOwn(chapter, key) || !chapter[key] || typeof chapter[key] !== 'object' || Array.isArray(chapter[key])) invalid('$.chapter.' + key);
  }
  return chapter;
}
export function validatePersonalSourceBinding(value) { checkSpatialSchema(sourceBinding, value, spatialSchema.$defs); return value; }
export function validatePersonalNotice(value) { checkSpatialSchema(noticeSchema, value, spatialSchema.$defs); return value; }
export function validatePersonalDecisionBinding(value) {
  checkSpatialSchema(personalDecisionBindingSchema, value, spatialSchema.$defs);
  if (value.scopeDigest !== personalScopeDigest(value.purpose, value.scope) || value.permissionTerm !== value.scope.permissionTerm) invalid('$.personal.scopeDigest');
  return value;
}
export function validatePrivateItemOfferRecord(value) {
  checkSpatialSchema(privateItemOfferRecordSchema, value, spatialSchema.$defs);
  if (new Set(value.options.map(option => option.optionRef)).size !== value.options.length || new Set(value.options.map(option => option.itemId)).size !== value.options.length) invalid('$.options');
  return value;
}

/** 校验已有记录，不补字段、不迁移旧局，也不根据缺失 proof 推定 accepted。 */
export function validatePersonalRequestRecord(record, consent) {
  checkSpatialSchema(personalRequestRecordSchema, record, spatialSchema.$defs);
  if (!consent || record.consentId !== consent.consentId) invalid('$.consentId');
  validatePersonalScope(consent.purpose, consent.scope);
  const binding = record.proposalBinding, proof = record.execution.acceptedProof, expectedDigest = personalScopeDigest(consent.purpose, consent.scope);
  const profile = gaolaoPersonalProfiles.find(profile => profile.contentVersion === binding.contentVersion);
  if (!profile || ['chapterVersion', 'mapVersion', 'policyVersion'].some(key => binding[key] !== profile[key])) invalid('$.proposalBinding.contentVersion');
  if (binding.scopeDigest !== expectedDigest || binding.subjectId !== consent.subjectId || binding.requesterId !== consent.requesterId || binding.performerId !== (consent.performerId ?? null) || (binding.performerId === null) !== (binding.performerEpoch === null)) invalid('$.proposalBinding');
  if (BigInt(binding.consentVersion) > BigInt(consent.version)) invalid('$.proposalBinding.consentVersion');
  if (proof) {
    if (consent.scope.permissionTerm !== 'single_use' || !['accepted', 'withdrawn'].includes(consent.status)) invalid('$.execution.acceptedProof');
    if (Object.keys(identities).some(key => proof[key] !== binding[key]) || BigInt(proof.consentVersion) <= BigInt(binding.consentVersion) || BigInt(proof.consentVersion) > BigInt(consent.version)) invalid('$.execution.acceptedProof');
    if (proof.sources[0].sourceId !== PERSONAL_SOURCE_IDS[consent.purpose]) invalid('$.execution.acceptedProof.sources');
  } else if (['accepted', 'withdrawn'].includes(consent.status) || record.execution.state !== 'none') invalid('$.execution.acceptedProof');
  if (['ready', 'active'].includes(record.execution.state) && (record.lifecycle !== 'open' || record.reasonCode !== null)) invalid('$.execution.state');
  if (record.lifecycle === 'cancelled' && (record.reasonCode !== 'requester_cancelled' || record.transitionActor !== consent.requesterId)) invalid('$.lifecycle');
  if (record.notice && (!proof || record.notice.consentId !== record.consentId || record.notice.acceptedConsentVersion !== proof.consentVersion)) invalid('$.notice');
  const uses = record.execution.itemUses;
  if (new Set(uses.map(use => use.itemId)).size !== uses.length || consent.purpose === 'appearance' && uses.length || consent.purpose === 'private_items' && uses.some(use => !consent.scope.itemIds.includes(use.itemId))) invalid('$.execution.itemUses');
  if (proof && consent.purpose === 'private_items' && uses.length !== consent.scope.itemIds.length) invalid('$.execution.itemUses');
  for (const use of uses) {
    if (['pending', 'already_at_owner'].includes(use.outcome) ? use.takeActionId !== null || use.acquisitionId !== null : use.takeActionId === null || use.acquisitionId === null) invalid('$.execution.itemUses');
  }
  return record;
}

export function validatePrivateAcquisition(value) {
  checkSpatialSchema(privateAcquisitionSchema, value, spatialSchema.$defs);
  if (value.outcome === 'held' ? value.resolvedByActionId !== null || value.resolvedAtSeq !== null : value.resolvedByActionId === null || value.resolvedAtSeq === null || BigInt(value.resolvedAtSeq) <= BigInt(value.takenAtSeq)) invalid('$.acquisition.outcome');
  if (value.holderId === value.ownerId) invalid('$.acquisition.holderId');
  return value;
}

/** 供本人控制器读取的固定请求依赖；不读取另一用途、当前远处物件或旁人模式。 */
export function personalDecisionBinding(state, subjectId, purpose) {
  if (!Object.hasOwn(PERSONAL_SOURCE_IDS, purpose)) invalid('$.purpose');
  const chapter = state.chapter, consentId = chapter.consentSlots[`${subjectId}:${purpose}`];
  if (!consentId) return null;
  const consent = chapter.consents[consentId], record = chapter.personalRequests?.[consentId];
  validatePersonalRequestRecord(record, consent);
  return freeze(validatePersonalDecisionBinding(structuredClone({ purpose, consentId, consentVersion: consent.version, status: consent.status, scope: consent.scope, scopeDigest: record.proposalBinding.scopeDigest, permissionTerm: consent.scope.permissionTerm, lifecycleVersion: record.lifecycleVersion, lifecycle: record.lifecycle, reasonCode: record.reasonCode, executionState: record.execution.state, proposalBinding: record.proposalBinding, acceptedProof: record.execution.acceptedProof, notice: record.notice })));
}

/** 原取得指针属于真实 item；当前用途槽和最近观察都不是选择前置。 */
export function privateReturnAcquisitions(state, content, actorId) {
  if (!gaolaoPersonalProfile(state)) return [];
  const result = [];
  for (const definition of content.chapterRules.privateItems.filter(item => item.ownerId === content.chapterRules.people.cuilan)) {
    const item = state.items[definition.itemId];
    if (actorId === definition.ownerId || item?.location.kind !== 'character' || item.location.characterId !== actorId) continue;
    const acquisition = state.chapter.privateAcquisitions?.[item.personalAcquisitionId];
    validatePrivateAcquisition(acquisition);
    if (acquisition.acquisitionId !== item.personalAcquisitionId || acquisition.itemId !== definition.itemId || acquisition.holderId !== actorId || acquisition.ownerId !== definition.ownerId || acquisition.outcome !== 'held') invalid('$.privateAcquisitions');
    result.push(freeze(structuredClone(acquisition)));
  }
  if (result.length > 2) invalid('$.privateAcquisitions.capacity');
  return result;
}

/** 这是不可变请求的形状，reusable 合法；能否成为 grant 由接受/使用守卫另验。 */
export function validatePersonalScope(purpose, scope) {
  if (!Object.hasOwn(scopeSchemas, purpose)) invalid('$.purpose');
  checkSpatialSchema(scopeSchemas[purpose], scope, spatialSchema.$defs, '$.scope');
  return scope;
}
export const personalScopeDigest = (purpose, scope) => digest({ purpose, scope: validatePersonalScope(purpose, scope) });

/** 仅内容中的固定本人声明和有限地点；不读取当前人物、物件或远处状态。 */
export function personalSources(content) {
  const profile = gaolaoPersonalProfile(content);
  if (!profile) return [];
  const rules = content.chapterRules;
  return rules.personalSourceSpecs.map(spec => {
    const declaration = rules.sources.find(source => source.sourceId === spec.sourceId);
    const common = { contentVersion: profile.contentVersion, chapterVersion: profile.chapterVersion, mapVersion: profile.mapVersion, policyVersion: profile.policyVersion, sourceRevision: String(spec.revision), declaration: structuredClone(declaration) };
    const knowledge = spec.purpose === 'appearance'
      ? { ...common, meetingDestinations: structuredClone(rules.meetingDestinations), radius: 90, usage: 'inquiry_meeting' }
      : { ...common, handling: 'retrieve_to_owner', items: rules.privateItems.filter(item => item.ownerId === rules.people.cuilan).map(item => {
          const original = content.items.find(candidate => candidate.itemId === item.itemId);
          return { itemId: item.itemId, ownerId: item.ownerId, label: original.name, origin: { sceneId: original.sceneId, position: structuredClone(original.position), label: '后宅原放物处（C07）' } };
        }) };
    return freeze({ purpose: spec.purpose, sourceId: spec.sourceId, sourceRevision: String(spec.revision), knowledge, digest: digest(knowledge) });
  });
}

/** metadata.personalSource 与 retainedObservation 同存；近期观察窗不参与查询。 */
export function ownPersonalSource(state, content, actorId, purpose) {
  if (!gaolaoPersonalProfile(state) || actorId !== content.chapterRules.people.cuilan) return null;
  const expected = personalSources(content).find(source => source.purpose === purpose);
  if (!expected) return null;
  const entries = Object.values(state.chapter.provenance[actorId] ?? {}).filter(entry => entry.sourceId === expected.sourceId && entry.retainedObservation);
  if (entries.length !== 1) return null;
  const entry = entries[0], observation = entry.retainedObservation, declaration = expected.knowledge.declaration;
  if (canonicalize(entry.personalSource ?? null) !== canonicalize(expected) || !observation.source || observation.source.sourceRef !== state.chapter.sourceTokens[expected.sourceId]) return null;
  if (observation.category !== declaration.category || observation.statement !== declaration.statement || canonicalize(observation.fields) !== canonicalize(declaration.fields) || observation.shareable !== false) return null;
  if (['kind', 'label', 'beforeArrivalDays'].some(key => observation.source[key] !== declaration[key])) return null;
  const binding = validatePersonalSourceBinding({ sourceId: expected.sourceId, sourceRevision: expected.sourceRevision, sourceRef: observation.source.sourceRef, observationRef: observation.observationRef, sourceSeq: observation.sourceSeq, receivedSeq: observation.source.receivedSeq, digest: expected.digest });
  if (BigInt(binding.receivedSeq) < BigInt(binding.sourceSeq)) return null;
  return freeze({ ...binding, knowledge: structuredClone(expected.knowledge) });
}
