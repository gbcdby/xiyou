import { createHash } from 'node:crypto';
import { canonicalize, ContractError } from '../protocol/index.mjs';
import { gaolaoPersonalProfile, validateSpatial } from '../protocol/spatial.mjs';
import { RuleError } from './rules.mjs';
import { opaqueRef, next, entityRef, canSee, inRange, unoccluded, sceneOf, obstacleEnabled, resolveRef } from './spatial-world.mjs';
import { distance, findPath, inPolygon } from './spatial-geometry.mjs';
import { changeChapter, consentFor, observeGaolao } from './gaolao-world.mjs';
import { releaseAppearance } from './gaolao-rules.mjs';
import { requirePersonalState, validatePersonalScope, personalScopeDigest, validatePersonalRequestRecord, validatePrivateAcquisition, validatePrivateItemOfferRecord, personalDecisionBinding, ownPersonalSource, privateReturnAcquisitions } from './gaolao-personal-contract.mjs';

const refuse = code => { throw new RuleError(code); };
const digest = value => createHash('sha256').update(canonicalize(value)).digest('hex');
const same = (a, b) => canonicalize(a) === canonicalize(b);
const profile = tx => gaolaoPersonalProfile(tx.state);
const ownerId = content => content.chapterRules.people.cuilan;
const bump = tx => { const actor = tx.state.characters[ownerId(tx.content)]; tx.emit('spatial.actor', { actor: { ...actor, resourceRevision: next(actor.resourceRevision) } }); };
const sourceOnly = ({ knowledge, ...binding }) => binding;
const names = { appearance: '本次借貌', private_items: '本次私物取送' };
const reasons = {
  requester_cancelled: '请求者已取消本次安排。', replaced_by_requester: '请求者已明确改约，旧安排不能继续使用。',
  replaced_after_closed: '原安排结束后已有新的请求。', replaced_after_invalidation: '原安排失效后已有新的请求。',
  proposal_invalidated: '本次提议的控制身份已变化，请重新询问。', owner_declined: '本人拒绝这次请求；以后再用，请再问本人。',
  owner_deferred: '本人暂缓这次请求；完成安置并回到近处后，请重新询问。', owner_withdrew: '本人已撤回这次许可。',
  fulfilled: '本次枚举私物已实际在本人处。', usage_ended: '悟空已结束本次借貌。',
  appearance_disclosed: '本次借貌的隐瞒已经结束，等待本人后续回应。', binding_invalidated: '本次安排已中断，等待本人后续回应。',
  session_ended: '本局已经结束；仍未归还的事项按实际情况保留。',
};

export const isPersonalConsent = (state, content, consent) => !!gaolaoPersonalProfile(state) && consent?.subjectId === ownerId(content) && ['appearance', 'private_items'].includes(consent.purpose);
function recordFor(state, consent) {
  requirePersonalState(state);
  return validatePersonalRequestRecord(state.chapter.personalRequests[consent.consentId], consent);
}
/** 此处只核对真实绑定；请求者离开近距不是身份失效，另由本人作 defer。 */
export function personalBindingCurrent(state, content, record) {
  const registered = gaolaoPersonalProfile(state), binding = record.proposalBinding;
  if (!registered || !gaolaoPersonalProfile(content) || ['contentVersion', 'chapterVersion', 'mapVersion', 'variantId', 'reducerVersion'].some(key => state[key] !== content[key]) || ['contentVersion', 'chapterVersion', 'mapVersion', 'policyVersion'].some(key => registered[key] !== binding[key])) return false;
  if (binding.subjectId !== ownerId(content) || content.chapterRules.sceneRolePolicies?.[0]?.actorId !== binding.subjectId || content.chapterRules.sceneRolePolicies[0].policyVersion !== binding.policyVersion) return false;
  const subject = state.characters[binding.subjectId], requester = state.characters[binding.requesterId], performer = binding.performerId && state.characters[binding.performerId];
  return subject?.controlEpoch === binding.subjectEpoch && subject.mode === 'CoreNPCControlled' && subject.actorKind === 'scene_role'
    && requester?.controlEpoch === binding.requesterEpoch && requester.kind === 'human' && requester.mode === 'HumanControlled'
    && (!binding.performerId || performer?.controlEpoch === binding.performerEpoch && performer.mode === 'CoreNPCControlled' && binding.performerId === content.chapterRules.people.wukong);
}
export function personalGrantUsable(state, content, consent) {
  if (!isPersonalConsent(state, content, consent)) return false;
  const record = recordFor(state, consent), proof = record.execution.acceptedProof;
  const source = ownPersonalSource(state, content, consent.subjectId, consent.purpose);
  return consent.status === 'accepted' && consent.scope.permissionTerm === 'single_use' && state.chapter.consentSlots[`${consent.subjectId}:${consent.purpose}`] === consent.consentId
    && record.lifecycle === 'open' && record.reasonCode === null && ['ready', 'active'].includes(record.execution.state)
    && proof?.consentVersion === consent.version && personalBindingCurrent(state, content, record) && personalScopeCurrent(content, consent, source) && same(proof.sources, [sourceOnly(source)]);
}
function personalScopeCurrent(content, consent, source) {
  if (!source) return false;
  const scope = consent.scope;
  return consent.purpose === 'appearance' ? content.chapterRules.meetingDestinations.some(place => place.destinationId === scope.destinationId) && consent.performerId === content.chapterRules.people.wukong
    : scope.ownerId === consent.subjectId && scope.sourceRevision === source.sourceRevision && scope.sourceDigest === source.digest && scope.itemIds.every(id => source.knowledge.items.some(item => item.itemId === id && item.ownerId === consent.subjectId));
}
function heldFor(state, consentId) {
  return Object.values(state.chapter.privateAcquisitions).filter(acquisition => acquisition.originalConsentId === consentId && acquisition.outcome === 'held' && state.items[acquisition.itemId]?.personalAcquisitionId === acquisition.acquisitionId && state.items[acquisition.itemId].location.kind === 'character' && state.items[acquisition.itemId].location.characterId === acquisition.holderId);
}
function transition(record, tx, { lifecycle = record.lifecycle, reasonCode = record.reasonCode, actorId = null } = {}) {
  record.lifecycleVersion = next(record.lifecycleVersion); record.lifecycle = lifecycle; record.reasonCode = reasonCode;
  record.transitionActor = actorId; record.transitionSeq = next(tx.state.sessionSeq);
}
function notifyParticipants(tx, consent, statement, fields = [], sourceSeq = tx.state.sessionSeq, omitSubject = false) {
  for (const actor of new Set([omitSubject ? null : consent.subjectId, consent.requesterId, consent.performerId].filter(Boolean))) observeGaolao(tx, actor, { statement, fields, sourceSeq, shareable: false });
}
/** 结束使用不改写最后的本人决定；同事务保存停权、返还模式与必要通知。 */
function stopRequest(tx, consent, { lifecycle, reasonCode, actorId = null, sourceEvent = null, notify = true }) {
  const old = recordFor(tx.state, consent);
  if (tx.state.chapter.disguise?.consentId === consent.consentId) releaseAppearance(tx);
  changeChapter(tx, chapter => {
    const record = chapter.personalRequests[consent.consentId];
    transition(record, tx, { lifecycle, reasonCode, actorId });
    record.execution.state = old.execution.acceptedProof ? (heldFor(tx.state, consent.consentId).length ? 'return_only' : 'ended') : 'none';
    if (record.execution.appearanceStarted) record.execution.appearanceEnded = true;
  });
  const hasNotice = sourceEvent && old.execution.acceptedProof && ['binding_invalidated', 'appearance_disclosed'].includes(reasonCode);
  if (hasNotice) {
    const noticeId = opaqueRef();
    const observation = observeGaolao(tx, consent.subjectId, { statement: reasons[reasonCode], shareable: false, sourceId: `personal-notice:${noticeId}`, label: '本次许可中断通知', sourceSeq: sourceEvent.sessionSeq, fields: [{ key: 'consent', label: '本次许可', value: consent.consentId }, { key: 'acceptedVersion', label: '原接受版本', value: old.execution.acceptedProof.consentVersion }, { key: 'reason', label: '中断原因', value: reasonCode }] });
    changeChapter(tx, chapter => { chapter.personalRequests[consent.consentId].notice = { noticeId, consentId: consent.consentId, acceptedConsentVersion: old.execution.acceptedProof.consentVersion, reasonCode, sourceEventId: sourceEvent.eventId, sourceSeq: sourceEvent.sessionSeq, receivedSeq: observation.source.receivedSeq }; });
  }
  if (notify) notifyParticipants(tx, consent, reasons[reasonCode], [], sourceEvent?.sessionSeq ?? tx.state.sessionSeq, !!hasNotice);
  bump(tx);
}
/** runtime 只在已发生控制变化后，或终态事实之前调用；不等 scene 下次回调。 */
export function stopPersonalForEvent(tx, event) {
  if (!profile(tx) || !tx.state.chapter) return;
  requirePersonalState(tx.state);
  const ended = ['session.finished', 'session.aborted'].includes(event.kind);
  if (!ended && event.kind !== 'control.changed') return;
  for (const purpose of ['appearance', 'private_items']) {
    const consent = consentFor(tx.state, ownerId(tx.content), purpose);
    if (!consent) continue;
    const record = recordFor(tx.state, consent);
    if (record.lifecycle !== 'open') continue;
    if (ended) stopRequest(tx, consent, { lifecycle: 'closed', reasonCode: 'session_ended' });
    else if (!personalBindingCurrent(tx.state, tx.content, record) && !record.reasonCode) stopRequest(tx, consent, { lifecycle: consent.status === 'proposed' ? 'closed' : 'open', reasonCode: consent.status === 'proposed' ? 'proposal_invalidated' : 'binding_invalidated', sourceEvent: event });
  }
}
function sourceFor(tx, purpose) {
  const source = ownPersonalSource(tx.state, tx.content, ownerId(tx.content), purpose);
  if (!source) throw new ContractError('本人的固定来源缺失或已错配，不能形成个人许可。', '$.personalSource');
  return source;
}
function requireHuman(tx, actorId, principalKind) {
  if (principalKind !== 'human' || !tx.liveActorIds?.has(actorId)) refuse('RULE_VIOLATION');
}
function validateReplacement(consent, record, requesterId, replacement) {
  if (!consent || consent.requesterId !== requesterId || replacement.consentId !== consent.consentId || replacement.expectedConsentVersion !== consent.version || replacement.expectedLifecycleVersion !== record.lifecycleVersion) refuse('CONSENT_STALE');
}
function requestPersonal(tx, actorId, purpose, scope, replacement, request) {
  validatePersonalScope(purpose, scope);
  const subjectId = ownerId(tx.content), previous = consentFor(tx.state, subjectId, purpose), old = previous && recordFor(tx.state, previous);
  if (replacement) { validateReplacement(previous, old, actorId, replacement); if(old.lifecycle !== 'open')refuse('CONSENT_STALE'); }
  else if (old && old.lifecycle === 'open' && old.reasonCode === null && ['proposed', 'accepted'].includes(previous.status)) refuse('NOT_READY');
  if (previous) stopRequest(tx, previous, { lifecycle: 'superseded', reasonCode: replacement ? 'replaced_by_requester' : ['binding_invalidated', 'appearance_disclosed', 'proposal_invalidated'].includes(old.reasonCode) ? 'replaced_after_invalidation' : 'replaced_after_closed', actorId });
  const consentId = opaqueRef(), version = next(previous?.version ?? '0'), performerId = purpose === 'appearance' ? tx.content.chapterRules.people.wukong : null;
  const source = sourceFor(tx, purpose), labels = purpose === 'private_items' ? source.knowledge.items.filter(item => scope.itemIds.includes(item.itemId)).map(item => item.label).join('、') : tx.content.chapterRules.meetingDestinations.find(place => place.destinationId === scope.destinationId).label;
  const fields = [{ key: 'consent', label: '本次请求', value: consentId }, { key: 'purpose', label: '用途', value: purpose }, { key: 'permissionTerm', label: '期限意向', value: scope.permissionTerm }, { key: 'scope', label: '明确范围', value: labels }];
  const statement = `${names[purpose]}请求：${labels}；${scope.permissionTerm === 'single_use' ? '只询问这一次安排' : '询问以后能否沿用'}。这只是请求，尚未得到本人同意。`;
  const received = observeGaolao(tx, subjectId, { statement, fields, shareable: false, sourceId: `personal-request:${consentId}`, label: '本人收到的本次请求', metadata: { personalRequest: { consentId, purpose } } });
  const consent = { consentId, subjectId, requesterId: actorId, purpose, scope: structuredClone(scope), version, status: 'proposed', decidedBy: null, sourceSeq: received.sourceSeq, ...(performerId ? { performerId } : {}) };
  const binding = { subjectId, subjectEpoch: tx.state.characters[subjectId].controlEpoch, requesterId: actorId, requesterEpoch: tx.state.characters[actorId].controlEpoch, performerId, performerEpoch: performerId ? tx.state.characters[performerId].controlEpoch : null, scopeDigest: personalScopeDigest(purpose, scope), contentVersion: tx.state.contentVersion, chapterVersion: tx.state.chapterVersion, mapVersion: tx.state.mapVersion, policyVersion: profile(tx).policyVersion, consentVersion: version, requestActionId: request.clientActionId, requestDigest: digest(request), sourceSeq: received.sourceSeq, requestObservationRef: received.observationRef, receivedSeq: received.source.receivedSeq };
  const record = { consentId, lifecycleVersion: '1', lifecycle: 'open', reasonCode: null, transitionActor: actorId, transitionSeq: next(tx.state.sessionSeq), proposalBinding: binding, execution: { state: 'none', acceptedProof: null, appearanceStarted: false, appearanceEnded: false, itemUses: [] }, notice: null };
  validatePersonalRequestRecord(record, consent);
  changeChapter(tx, chapter => { chapter.consents[consentId] = consent; chapter.consentSlots[`${subjectId}:${purpose}`] = consentId; chapter.personalRequests[consentId] = record; });
  for (const id of new Set([actorId, performerId].filter(Boolean))) observeGaolao(tx, id, { statement, fields, sourceSeq: received.sourceSeq, shareable: false });
  bump(tx); return {};
}
/** 在原 interact 的 ref/距离/LOS/公开 revision 检查之后分派。 */
export function personalInteraction(tx, actorId, principalKind, request, target) {
  if (!profile(tx)) return null;
  const { operationId, parameters } = request.action;
  if (!['gz-describe-private-items', 'gz-request-private-items', 'gz-request-appearance'].includes(operationId)) return null;
  if (operationId === 'gz-request-private-items' && target.characterId === tx.content.chapterRules.people.bajie) {
    if (!Array.isArray(parameters?.itemRefs) || typeof parameters.expectedConsentVersion !== 'string') refuse('RULE_VIOLATION');
    return null;
  }
  requireHuman(tx, actorId, principalKind);
  if (target.characterId !== ownerId(tx.content)) refuse('TARGET_UNAVAILABLE');
  if (operationId === 'gz-describe-private-items') {
    const source = sourceFor(tx, 'private_items');
    const offer = validatePrivateItemOfferRecord({ offerRef: opaqueRef(), sessionId: tx.state.sessionId, requesterId: actorId, subjectId: target.characterId, viewId: request.viewId, contentVersion: tx.state.contentVersion, sourceRevision: source.sourceRevision, sourceDigest: source.digest, sourceRef: source.sourceRef, describedAtSeq: next(tx.state.sessionSeq), options: source.knowledge.items.map(item => ({ optionRef: opaqueRef(), itemId: item.itemId })) });
    changeChapter(tx, chapter => { chapter.privateItemOffers[actorId] = offer; });
    for (const observerId of [actorId, target.characterId]) observeGaolao(tx, observerId, { statement: '本人愿意说明包裹与信件这两个名目；可以询问原样取回本人，尚未授予拿取、拆阅或转交他人的许可。', shareable: false });
    return {};
  }
  if (!parameters || !Object.hasOwn(parameters, 'permissionTerm') || Object.hasOwn(parameters, 'expectedConsentVersion') || Object.hasOwn(parameters, 'itemRefs')) refuse('RULE_VIOLATION');
  validateSpatial(operationId === 'gz-request-appearance' ? 'PersonalAppearanceParametersV1' : 'PersonalPrivateItemsParametersV1', parameters);
  if (operationId === 'gz-request-appearance') {
    if (!tx.state.chapter.cuilanSafe || !tx.content.chapterRules.meetingDestinations.some(place => place.destinationId === parameters.destinationId)) refuse('NOT_READY');
    return requestPersonal(tx, actorId, 'appearance', { destinationId: parameters.destinationId, permissionTerm: parameters.permissionTerm, usage: 'inquiry_meeting', radius: 90 }, parameters.replacement, request);
  }
  const offer = tx.state.chapter.privateItemOffers[actorId], source = sourceFor(tx, 'private_items');
  if (!offer) refuse('STALE_REFERENCE'); validatePrivateItemOfferRecord(offer);
  if (offer.offerRef !== parameters.offerRef || offer.sessionId !== tx.state.sessionId || offer.requesterId !== actorId || offer.subjectId !== target.characterId || offer.viewId !== request.viewId || offer.contentVersion !== tx.state.contentVersion || offer.sourceRevision !== source.sourceRevision || offer.sourceDigest !== source.digest || offer.sourceRef !== source.sourceRef) refuse('STALE_REFERENCE');
  const items = parameters.itemOptionRefs.map(ref => offer.options.find(option => option.optionRef === ref)?.itemId);
  if (items.some(item => !item)) refuse('STALE_REFERENCE');
  return requestPersonal(tx, actorId, 'private_items', { itemIds: items, ownerId: target.characterId, handling: 'retrieve_to_owner', permissionTerm: parameters.permissionTerm, offerRef: offer.offerRef, sourceRevision: offer.sourceRevision, sourceDigest: offer.sourceDigest }, parameters.replacement, request);
}
export function cancelPersonalRequest(tx, actorId, principalKind, action) {
  if (!profile(tx)) refuse('RULE_VIOLATION'); requireHuman(tx, actorId, principalKind);
  const consent = tx.state.chapter.consents[action.consentId];
  if (!isPersonalConsent(tx.state, tx.content, consent) || consent.requesterId !== actorId) refuse('STALE_REFERENCE');
  const record = recordFor(tx.state, consent);
  validateReplacement(consent, record, actorId, action);
  if (tx.state.chapter.consentSlots[`${consent.subjectId}:${consent.purpose}`] !== consent.consentId || record.lifecycle !== 'open') refuse('CONSENT_STALE');
  stopRequest(tx, consent, { lifecycle: 'cancelled', reasonCode: 'requester_cancelled', actorId }); return {};
}
function acceptLocalConditions(tx, consent) {
  const subject = tx.state.characters[consent.subjectId], requester = tx.state.characters[consent.requesterId], safe = tx.state.chapter.safeRecord;
  const destination = safe && tx.content.chapterRules.safeDestinations.find(place => place.destinationId === safe.destinationId), scene = destination && sceneOf(tx.content, destination.sceneId), area = scene?.walkableAreas.find(area => area.areaId === destination.areaId);
  return tx.state.chapter.cuilanSafe && safe?.subjectId === consent.subjectId && !!destination && subject.sceneId === destination.sceneId && inPolygon(subject.position, area.polygon)
    && inRange(tx.state, tx.content, subject, requester, tx.content.movement.interactionRadius) && canSee(tx.state, tx.content, subject.characterId, requester) && unoccluded(tx.state, tx.content, subject, requester)
    && !!findPath(scene, subject.position, destination.exitPosition, obstacleEnabled(tx.state));
}
export function respondPersonal(tx, actorId, principalKind, request, consent) {
  if (!isPersonalConsent(tx.state, tx.content, consent)) return null;
  const action = request.action, record = recordFor(tx.state, consent), source = sourceFor(tx, consent.purpose), basis = tx.scenePolicyAuthorization;
  if (actorId !== consent.subjectId || principalKind !== 'scene_role') refuse('STALE_REFERENCE');
  if (consent.version !== action.expectedConsentVersion || tx.state.chapter.consentSlots[`${actorId}:${consent.purpose}`] !== consent.consentId || record.lifecycle !== 'open') refuse('CONSENT_STALE');
  if (!basis || basis.policyVersion !== profile(tx).policyVersion || basis.branch !== consent.purpose || basis.actionId !== request.clientActionId || basis.requestDigest !== digest(request) || basis.subjectEpoch !== tx.state.characters[actorId].controlEpoch || !same(basis.personal, personalDecisionBinding(tx.state, actorId, consent.purpose)) || !same(basis.sources, [sourceOnly(source)])) refuse('RULE_VIOLATION');
  if (tx.state.phase !== 'Running' || tx.state.paused || tx.state.characters[actorId].mode !== 'CoreNPCControlled') refuse('SESSION_PAUSED');
  const withdrawal = action.kind === 'withdraw_consent';
  if (withdrawal) {
    if (consent.status !== 'accepted' || !['binding_invalidated', 'appearance_disclosed'].includes(record.reasonCode) || !record.notice) refuse('CONSENT_STALE');
  } else {
    if (consent.status !== 'proposed' || record.reasonCode !== null || !personalBindingCurrent(tx.state, tx.content, record) || !personalScopeCurrent(tx.content, consent, source)) refuse('CONSENT_STALE');
    if (action.response === 'accept' && (consent.scope.permissionTerm !== 'single_use' || !acceptLocalConditions(tx, consent))) refuse('NOT_READY');
  }
  const status = withdrawal ? 'withdrawn' : { accept: 'accepted', decline: 'declined', defer: 'deferred' }[action.response];
  changeChapter(tx, chapter => {
    const current = chapter.consents[consent.consentId], target = chapter.personalRequests[consent.consentId];
    current.status = status; current.decidedBy = actorId; current.version = next(current.version); current.sourceSeq = next(tx.state.sessionSeq);
    if (status === 'accepted') {
      const { consentVersion, requestActionId, requestDigest, sourceSeq, requestObservationRef, receivedSeq, ...identities } = target.proposalBinding;
      target.execution.acceptedProof = { ...identities, consentVersion: current.version, actionId: request.clientActionId, requestDigest: digest(request), sources: [sourceOnly(source)] };
      target.execution.state = 'ready';
      if (consent.purpose === 'private_items') target.execution.itemUses = consent.scope.itemIds.map(itemId => ({ itemId, takeActionId: null, acquisitionId: null, outcome: tx.state.items[itemId].location.kind === 'character' && tx.state.items[itemId].location.characterId === consent.subjectId ? 'already_at_owner' : 'pending' }));
      transition(target, tx);
      if (target.execution.itemUses.length && target.execution.itemUses.every(use => use.outcome === 'already_at_owner')) { target.lifecycle = 'closed'; target.reasonCode = 'fulfilled'; target.execution.state = 'ended'; }
    } else if (!withdrawal) transition(target, tx, { lifecycle: 'closed', reasonCode: status === 'declined' ? 'owner_declined' : 'owner_deferred', actorId });
  });
  if (withdrawal) stopRequest(tx, tx.state.chapter.consents[consent.consentId], { lifecycle: 'closed', reasonCode: 'owner_withdrew', actorId, notify: false });
  else bump(tx);
  const changed = tx.state.chapter.consents[consent.consentId], updated = recordFor(tx.state, changed);
  notifyParticipants(tx, changed, status === 'accepted' ? `${names[consent.purpose]}：本人已接受这一次明确安排，实际使用仍需按范围执行。` : reasons[updated.reasonCode], [{ key: 'consent', label: '本人决定记录', value: changed.consentId }, { key: 'status', label: '本人实际回应', value: status }, { key: 'version', label: '回应版本', value: changed.version }]);
  return {};
}

export function checkPersonalAppearance(tx, consent, actorId, expectedVersion) {
  if (!isPersonalConsent(tx.state, tx.content, consent)) refuse('CONSENT_REQUIRED');
  const record = recordFor(tx.state, consent);
  if (actorId !== consent.performerId || consent.version !== expectedVersion || !personalGrantUsable(tx.state, tx.content, consent) || record.execution.appearanceStarted || record.execution.appearanceEnded) refuse('CONSENT_REQUIRED');
}
export function startedPersonalAppearance(tx, consent) {
  changeChapter(tx, chapter => { const record = chapter.personalRequests[consent.consentId]; record.execution.appearanceStarted = true; record.execution.state = 'active'; transition(record, tx); }); bump(tx);
}
export function endedPersonalAppearance(tx, disclosed = false, sourceEvent = null) {
  const disguise = tx.state.chapter.disguise;
  if (!profile(tx) || !disguise) return false;
  const consent = tx.state.chapter.consents[disguise.consentId];
  if (!isPersonalConsent(tx.state, tx.content, consent)) return false;
  const event = sourceEvent ?? tx.events.at(-1) ?? { eventId: `${tx.state.sessionId}:E${tx.state.sessionSeq}`, sessionSeq: tx.state.sessionSeq };
  stopRequest(tx, consent, { lifecycle: disclosed ? 'open' : 'closed', reasonCode: disclosed ? 'appearance_disclosed' : 'usage_ended', actorId: disclosed ? null : disguise.actorId, sourceEvent: disclosed ? event : null }); return true;
}
/** 圆域是凸集；逐个折线端点合法可推出整段合法，而不是只检查目标终点。 */
export function personalAppearancePathAllowed(state, content, actorId, sceneId, points) {
  if (!gaolaoPersonalProfile(state) || state.chapter.disguise?.actorId !== actorId) return true;
  const consent = state.chapter.consents[state.chapter.disguise.consentId], destination = content.chapterRules.meetingDestinations.find(place => place.destinationId === consent?.scope.destinationId);
  return !!destination && personalGrantUsable(state, content, consent) && state.chapter.disguise.consentVersion === consent.version && sceneId === destination.sceneId && points.every(point => distance(point, destination.position) <= 90);
}

export function checkPersonalItem(tx, actorId, item, action, request) {
  if (!profile(tx) || !tx.content.chapterRules.privateItems.some(definition => definition.itemId === item.itemId && definition.ownerId === ownerId(tx.content))) return false;
  if (actorId === ownerId(tx.content)) { if (action.kind === 'transfer_item' && resolveRef(tx, actorId, action.recipientRef, request.viewId).characterId !== actorId) refuse('RULE_VIOLATION'); return true; }
  if (action.kind === 'take_item') {
    const consent = consentFor(tx.state, ownerId(tx.content), 'private_items');
    if (!consent || consent.requesterId !== actorId || !consent.scope.itemIds.includes(item.itemId) || !personalGrantUsable(tx.state, tx.content, consent)) refuse('CONSENT_REQUIRED');
    if (recordFor(tx.state, consent).execution.itemUses.find(use => use.itemId === item.itemId)?.outcome !== 'pending') refuse('CONSENT_REQUIRED');
  } else {
    const acquisition = privateReturnAcquisitions(tx.state, tx.content, actorId).find(record => record.itemId === item.itemId);
    if (!acquisition) refuse('CONSENT_REQUIRED');
    if (action.kind === 'put_item') { if (action.sceneId !== acquisition.origin.sceneId || !same(action.position, acquisition.origin.position)) refuse('CONSENT_REQUIRED'); }
    else if (action.kind === 'transfer_item') { if (resolveRef(tx, actorId, action.recipientRef, request.viewId).characterId !== acquisition.ownerId) refuse('CONSENT_REQUIRED'); }
    else refuse('CONSENT_REQUIRED');
  }
  return true;
}
function finishIfDelivered(record, tx) {
  if (record.lifecycle === 'open' && record.reasonCode === null && record.execution.acceptedProof && record.execution.itemUses.every(use => ['delivered_to_owner', 'already_at_owner'].includes(use.outcome))) {
    record.lifecycle = 'closed'; record.reasonCode = 'fulfilled'; record.execution.state = 'ended';
  } else if (record.execution.state === 'return_only' && !heldFor(tx.state, record.consentId).length) record.execution.state = 'ended';
}
/** 普通 itemChange 的唯一窄扩展；真实位置和原取得事实在同一 Session 事务提交。 */
export function changePersonalItem(tx, item, location) {
  if (!profile(tx) || !tx.content.chapterRules.privateItems.some(definition => definition.itemId === item.itemId && definition.ownerId === ownerId(tx.content))) return false;
  const actorId = tx.cause.actorId;
  if (actorId === ownerId(tx.content)) return false;
  if (item.location.kind === 'ground') {
    const consent = consentFor(tx.state, ownerId(tx.content), 'private_items'), record = recordFor(tx.state, consent), source = sourceFor(tx, 'private_items');
    const acquisitionId = opaqueRef(), takenAtSeq = next(tx.state.sessionSeq);
    const acquisition = validatePrivateAcquisition({ acquisitionId, itemId: item.itemId, holderId: actorId, ownerId: consent.subjectId, originalConsentId: consent.consentId, acceptedConsentVersion: record.execution.acceptedProof.consentVersion, sourceLifecycleVersion: record.lifecycleVersion, scopeDigest: record.proposalBinding.scopeDigest, takeActionId: tx.cause.actionId, requestDigest: tx.requestDigest, takenAtSeq, origin: structuredClone(source.knowledge.items.find(definition => definition.itemId === item.itemId).origin), outcome: 'held', resolvedByActionId: null, resolvedAtSeq: null });
    tx.emit('spatial.item', { item: { ...item, location, resourceRevision: next(item.resourceRevision), personalAcquisitionId: acquisitionId } });
    changeChapter(tx, chapter => { chapter.privateAcquisitions[acquisitionId] = acquisition; const current = chapter.personalRequests[consent.consentId], use = current.execution.itemUses.find(use => use.itemId === item.itemId); Object.assign(use, { takeActionId: tx.cause.actionId, acquisitionId, outcome: 'held' }); current.execution.state = 'active'; transition(current, tx); });
    bump(tx); return true;
  }
  const acquisition = validatePrivateAcquisition(tx.state.chapter.privateAcquisitions[item.personalAcquisitionId]), delivered = location.kind === 'character' && location.characterId === acquisition.ownerId, outcome = delivered ? 'delivered_to_owner' : 'restored_origin';
  tx.emit('spatial.item', { item: { ...item, location, resourceRevision: next(item.resourceRevision) } });
  const resolvedAtSeq = tx.state.sessionSeq;
  changeChapter(tx, chapter => {
    Object.assign(chapter.privateAcquisitions[acquisition.acquisitionId], { outcome, resolvedByActionId: tx.cause.actionId, resolvedAtSeq });
    const original = chapter.personalRequests[acquisition.originalConsentId], use = original.execution.itemUses.find(use => use.acquisitionId === acquisition.acquisitionId);
    use.outcome = outcome; transition(original, tx);
    // 持有选择使用更新后的同事务位置；原取消/替换/失效原因不被 fulfilled 吞掉。
    finishIfDelivered(original, { ...tx, state: { ...tx.state, chapter } });
    if (delivered) {
      const currentId = chapter.consentSlots[`${acquisition.ownerId}:private_items`], current = chapter.personalRequests[currentId], consent = chapter.consents[currentId];
      if (current && currentId !== original.consentId && current.lifecycle === 'open' && current.reasonCode === null && consent.status === 'accepted') {
        const pending = current.execution.itemUses.find(use => use.itemId === item.itemId && use.outcome === 'pending');
        if (pending) { pending.outcome = 'already_at_owner'; transition(current, tx); finishIfDelivered(current, { ...tx, state: { ...tx.state, chapter } }); }
      }
    }
  });
  notifyParticipants(tx, tx.state.chapter.consents[acquisition.originalConsentId], delivered ? `${item.name}已实际交到本人手中。` : `${item.name}已放回登记原处，尚未送到本人。`, [
    { key: 'privateItemOutcome', label: '实际私物处置', value: delivered ? '已交到本人' : '已放回原处，尚未送到本人' },
    { key: 'itemLabel', label: '本次物件', value: item.name },
  ], resolvedAtSeq);
  bump(tx); return true;
}

export function projectPersonal(state, content, actorId, view) {
  if (!gaolaoPersonalProfile(state)) return {};
  requirePersonalState(state);
  const chapter = state.chapter, subjectId = ownerId(content), r = id => entityRef(view, id);
  const personalRequests = ['appearance', 'private_items'].flatMap(purpose => {
    const consent = consentFor(state, subjectId, purpose);
    if (!consent || ![consent.subjectId, consent.requesterId, consent.performerId].includes(actorId)) return [];
    const record = recordFor(state, consent), source = ownPersonalSource(state, content, subjectId, purpose);
    const scope = purpose === 'appearance' ? { destinationId: consent.scope.destinationId, performerLabel: '孙悟空', usage: 'inquiry_meeting' }
      : { handling: 'retrieve_to_owner', ownerLabel: '翠兰本人', items: consent.scope.itemIds.map(id => ({ label: content.items.find(item => item.itemId === id).name, origin: record.execution.acceptedProof ? structuredClone(source?.knowledge.items.find(item => item.itemId === id)?.origin ?? null) : null })) };
    return [{ consentId: consent.consentId, purpose, lifecycleVersion: record.lifecycleVersion, lifecycle: record.lifecycle, executionState: record.execution.state, reasonCode: record.reasonCode, reason: record.reasonCode ? reasons[record.reasonCode] : consent.status === 'proposed' ? '等待本人回应；目前没有使用许可。' : '本人已接受本次明确范围；实际操作仍须满足当前条件。', permissionTerm: consent.scope.permissionTerm, scope }];
  });
  const offer = chapter.privateItemOffers[actorId], source = offer && ownPersonalSource(state, content, subjectId, 'private_items');
  const privateItemOffers = offer && offer.viewId === view.viewId && source && offer.sourceDigest === source.digest ? [{ offerRef: offer.offerRef, subjectRef: r(subjectId), sourceRef: offer.sourceRef, sourceRevision: offer.sourceRevision, options: offer.options.map(option => ({ optionRef: option.optionRef, label: content.items.find(item => item.itemId === option.itemId).name, handling: 'retrieve_to_owner' })) }] : [];
  const privateReturns = privateReturnAcquisitions(state, content, actorId).map(acquisition => ({ returnContextId: acquisition.acquisitionId, originalConsentId: acquisition.originalConsentId, acceptedConsentVersion: acquisition.acceptedConsentVersion, sourceLifecycleVersion: acquisition.sourceLifecycleVersion, itemRef: r(acquisition.itemId), itemRevision: state.items[acquisition.itemId].resourceRevision, mode: personalGrantUsable(state, content, chapter.consents[acquisition.originalConsentId]) ? 'delivery_pending' : 'return_only', ownerLabel: '翠兰本人', ownerRef: canSee(state, content, actorId, state.characters[acquisition.ownerId]) ? r(acquisition.ownerId) : null, origin: structuredClone(acquisition.origin) }));
  return { personalRequests, privateItemOffers, privateReturns };
}
