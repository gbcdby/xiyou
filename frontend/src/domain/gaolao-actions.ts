import { gaolaoInteraction, gaolaoPersonalProfile, gaolaoPersonalProfiles, validateSpatial } from '../../../protocol/spatial.mjs';
import { compareDecimal } from '../../../protocol/index.mjs';
import type { ActionV2, ChapterViewV2, ConsentPurpose, ConsentViewV2, EndProposalViewV2, GaolaoInteractionV2, ItemViewV2, ObservationViewV2, PersonalPermissionTermV1, PersonalPurposeV1, PersonalRequestReplacementV1, PersonalRequestViewV1, Position, PrivateReturnViewV1, ProjectionV2, TargetViewV2 } from '../../../game/spatial-types.ts';

export interface GaolaoTarget { entityRef: string; resourceRevision?: string; availableOperations?: string[] }
export function isGaolaoProjection(projection: ProjectionV2 | null | undefined): boolean {
  if (!projection?.chapter) return false;
  if (gaolaoPersonalProfiles.some(profile => profile.contentVersion === projection.contentVersion) || projection.reducerVersion === 'gaolao-world-v2') return Boolean(gaolaoPersonalProfile(projection));
  return projection.reducerVersion === 'gaolao-world-v1';
}
function personalAvailable(projection: ProjectionV2, canAct: boolean): boolean {
  return Boolean(canAct && gaolaoPersonalProfile(projection) && projection.chapter && projection.phase === 'Running' && !projection.paused && projection.self.canControl);
}
function personalTerm(term: PersonalPermissionTermV1): boolean { return term === 'single_use' || term === 'reusable'; }
export function currentPersonalRequest(projection: ProjectionV2, subjectRef: string, purpose: PersonalPurposeV1): { request: PersonalRequestViewV1; consent: ConsentViewV2 } | null {
  if (!gaolaoPersonalProfile(projection) || !projection.chapter) return null;
  for (const request of projection.chapter.personalRequests ?? []) {
    const consent = projection.chapter.consents.find(value => value.consentId === request.consentId && value.subjectRef === subjectRef && value.purpose === purpose);
    if (request.purpose === purpose && consent) return { request, consent };
  }
  return null;
}
function personalReplacement(projection: ProjectionV2, consentId: string): PersonalRequestReplacementV1 | null {
  const chapter = projection.chapter, request = chapter?.personalRequests?.find(value => value.consentId === consentId);
  const consent = chapter?.consents.find(value => value.consentId === consentId);
  return request?.lifecycle === 'open' && consent?.requesterRef === projection.self.entityRef && consent.purpose === request.purpose
    ? { consentId, expectedConsentVersion: consent.version, expectedLifecycleVersion: request.lifecycleVersion } : null;
}
function replacementForProposal(projection: ProjectionV2, subjectRef: string, purpose: PersonalPurposeV1, replacementId?: string): PersonalRequestReplacementV1 | null | false {
  const current = currentPersonalRequest(projection, subjectRef, purpose);
  if (replacementId) return current?.request.consentId === replacementId ? personalReplacement(projection, replacementId) ?? false : false;
  // 现有自己的开放安排不能靠普通“询问”按钮暗中替换；须明确勾选改约。
  return current?.request.lifecycle === 'open' && current.consent.requesterRef === projection.self.entityRef ? false : null;
}

/** 新询问只使用公开人物 revision；两种期限都须由本人实际回应。 */
export function requestPersonalAppearance(target: GaolaoTarget | null, destinationId: string, permissionTerm: PersonalPermissionTermV1, projection: ProjectionV2, canAct: boolean, replacementId?: string): GaolaoInteractionV2 | null {
  if (!personalAvailable(projection, canAct) || !personalTerm(permissionTerm) || !offered(target, 'gz-request-appearance', canAct)
    || !projection.chapter!.destinations.some(destination => destination.purpose === 'meeting' && destination.destinationId === destinationId)) return null;
  const replacement = replacementForProposal(projection, target.entityRef, 'appearance', replacementId); if (replacement === false) return null;
  return gaolaoInteraction({ kind: 'interact', targetRef: target.entityRef, operationId: 'gz-request-appearance', expectedTargetRevision: target.resourceRevision, parameters: { destinationId, permissionTerm, ...(replacement ? { replacement } : {}) } });
}
export function describePersonalItems(target: GaolaoTarget | null, projection: ProjectionV2, canAct: boolean): GaolaoInteractionV2 | null {
  if (!personalAvailable(projection, canAct) || !offered(target, 'gz-describe-private-items', canAct)) return null;
  return gaolaoInteraction({ kind: 'interact', targetRef: target.entityRef, operationId: 'gz-describe-private-items', expectedTargetRevision: target.resourceRevision });
}
/** 目录名目不是物品操作引用；不要求私物或其原处在当前视野。 */
export function requestPersonalItems(target: GaolaoTarget | null, offerRef: string, itemOptionRefs: string[], permissionTerm: PersonalPermissionTermV1, projection: ProjectionV2, canAct: boolean, replacementId?: string): GaolaoInteractionV2 | null {
  if (!personalAvailable(projection, canAct) || !personalTerm(permissionTerm) || !offered(target, 'gz-request-private-items', canAct) || !target.availableOperations?.includes('gz-describe-private-items')) return null;
  const offer = projection.chapter!.privateItemOffers?.find(value => value.offerRef === offerRef && value.subjectRef === target.entityRef);
  if (!offer || itemOptionRefs.length < 1 || itemOptionRefs.length > 2 || new Set(itemOptionRefs).size !== itemOptionRefs.length
    || itemOptionRefs.some(reference => !offer.options.some(option => option.optionRef === reference))) return null;
  const replacement = replacementForProposal(projection, target.entityRef, 'private_items', replacementId); if (replacement === false) return null;
  return gaolaoInteraction({ kind: 'interact', targetRef: target.entityRef, operationId: 'gz-request-private-items', expectedTargetRevision: target.resourceRevision, parameters: { offerRef, itemOptionRefs: [...itemOptionRefs], permissionTerm, ...(replacement ? { replacement } : {}) } });
}
export function cancelPersonalRequest(projection: ProjectionV2, consentId: string, canAct: boolean): ActionV2 | null {
  if (!personalAvailable(projection, canAct)) return null;
  const replacement = personalReplacement(projection, consentId);
  return replacement ? validateSpatial('ActionV2', { kind: 'cancel_personal_request', ...replacement }) : null;
}
export function personalRequestFeedback(request: PersonalRequestViewV1, consent: ConsentViewV2) {
  const decisions = { proposed: '等待本人回应', accepted: '本人已同意', declined: '本人已拒绝', deferred: '本人暂缓', withdrawn: '本人已撤回' };
  const lifecycle = { open: '本次请求仍开放', cancelled: '请求者已取消本次安排', superseded: '请求已被新安排替代', closed: '本次请求已结束' };
  const execution = { none: '尚未取得可用许可', ready: '本次安排可使用，实际动作尚未完成', active: '本次安排正在进行', return_only: '只可处理原持物归还，不可继续使用许可', ended: '本次使用已结束' };
  return { decision: decisions[consent.status], lifecycle: lifecycle[request.lifecycle], execution: execution[request.executionState] };
}
/** 只与真实当前持物匹配，不读取当前用途槽或已裁剪的许可历史。 */
export function privateReturnEntries(projection: ProjectionV2 | null | undefined): { context: PrivateReturnViewV1; item: ItemViewV2 }[] {
  if (!projection || !gaolaoPersonalProfile(projection)) return [];
  return (projection.chapter?.privateReturns ?? []).flatMap(context => {
    const item = projection.items.find(value => value.entityRef === context.itemRef && value.resourceRevision === context.itemRevision && value.location.kind === 'held' && value.location.ownerRef === projection.self.entityRef);
    return item ? [{ context, item }] : [];
  });
}
function privateReturnInRange(projection: ProjectionV2, destination: Position | null): boolean {
  // 已登记的两份精确 v3 内容 interactionRadius 均为 90，契约检查与内容对照。
  // 这里只按当前公开位置提示距离；实际 LOS、取得事实与操作权限仍由服务端核验。
  const position = projection.self.position;
  return Boolean(position && destination && Math.hypot(position.x - destination.x, position.y - destination.y) <= 90);
}
export function privateReturnAction(projection: ProjectionV2, returnContextId: string, destination: 'owner' | 'origin', canAct: boolean): ActionV2 | null {
  if (!personalAvailable(projection, canAct)) return null;
  const entry = privateReturnEntries(projection).find(value => value.context.returnContextId === returnContextId);
  if (!entry) return null;
  const { context, item } = entry;
  if (destination === 'owner') {
    const owner = projection.entities.find(person => person.entityRef === context.ownerRef && person.position && person.sceneId === projection.self.sceneId);
    return context.ownerRef && owner && item.transferable && privateReturnInRange(projection, owner.position) ? validateSpatial('ActionV2', { kind: 'transfer_item', itemRef: item.entityRef, expectedItemRevision: item.resourceRevision, recipientRef: context.ownerRef }) : null;
  }
  if (destination !== 'origin' || projection.self.sceneId !== context.origin.sceneId || !privateReturnInRange(projection, context.origin.position)) return null;
  return validateSpatial('ActionV2', { kind: 'put_item', itemRef: item.entityRef, expectedItemRevision: item.resourceRevision, sceneId: context.origin.sceneId, position: { ...context.origin.position } });
}
export const humanGaolaoOperations = [
  { operationId: 'gz-contact', label: '联系门内的人' }, { operationId: 'gz-check-seal', label: '检查铜封' },
  { operationId: 'gz-try-key', label: '试用普通钥匙' }, { operationId: 'gz-read-ledger', label: '阅读旧饭账' },
  { operationId: 'gz-hear-witness', label: '询问见证人' }, { operationId: 'gz-release-support', label: '撤收门撑' },
  { operationId: 'gz-check-appearance', label: '核验同貌人物' }, { operationId: 'gz-reveal-identity', label: '当面说明已知身份' },
  { operationId: 'gz-plan-departure', label: '通知离庄安排' },
] as const;
type HumanSimpleOperation = typeof humanGaolaoOperations[number]['operationId'];
function offered(target: GaolaoTarget | null, operation: string, canAct: boolean): target is GaolaoTarget & { resourceRevision: string } {
  return Boolean(canAct && target && typeof target.resourceRevision === 'string' && target.availableOperations?.includes(operation));
}
export function currentConsent(chapter: ChapterViewV2, subjectRef: string, purpose: ConsentPurpose): ConsentViewV2 | null {
  return chapter.consents.filter(consent => consent.subjectRef === subjectRef && consent.purpose === purpose)
    .sort((a, b) => compareDecimal(b.version, a.version) || compareDecimal(b.sourceSeq, a.sourceSeq))[0] || null;
}
export function currentConsents(chapter: ChapterViewV2): ConsentViewV2[] {
  return chapter.consents.filter(consent => currentConsent(chapter, consent.subjectRef, consent.purpose)?.consentId === consent.consentId);
}
export function simpleGaolaoAction(target: GaolaoTarget | null, operationId: HumanSimpleOperation, canAct: boolean): GaolaoInteractionV2 | null {
  if (!offered(target, operationId, canAct)) return null;
  return gaolaoInteraction({ kind: 'interact', targetRef: target.entityRef, operationId, expectedTargetRevision: target.resourceRevision });
}
export function requestMeetingOrAppearance(target: GaolaoTarget | null, operationId: 'gz-request-appearance' | 'gz-invite-meeting', destinationId: string, chapter: ChapterViewV2, canAct: boolean): GaolaoInteractionV2 | null {
  if (!offered(target, operationId, canAct) || !chapter.destinations.some(destination => destination.purpose === 'meeting' && destination.destinationId === destinationId)) return null;
  const consent = currentConsent(chapter, target.entityRef, operationId === 'gz-request-appearance' ? 'appearance' : 'meeting');
  return gaolaoInteraction({ kind: 'interact', targetRef: target.entityRef, operationId, expectedTargetRevision: target.resourceRevision, parameters: { destinationId, expectedConsentVersion: consent?.version || '0' } });
}
export function proposeFollow(projection: ProjectionV2, subjectRef: string, leaderRef: string, destinationId: string, canAct: boolean): ActionV2 | null {
  const chapter = projection.chapter, subject = projection.entities.find(person => person.entityRef === subjectRef);
  if (!canAct || !chapter || !projection.self.capabilities.includes('propose_follow')
    || !subject || subject.resourceRevision === undefined || subject.entityRef === projection.self.entityRef || !subject.position || subject.sceneId !== projection.self.sceneId
    || !projection.entities.some(person => person.entityRef === leaderRef && person.position && person.sceneId === projection.self.sceneId)
    || !chapter.destinations.some(destination => destination.purpose === 'follow' && destination.destinationId === destinationId)) return null;
  return validateSpatial('ActionV2', { kind: 'propose_follow', subjectRef, leaderRef, destinationId, expectedTargetRevision: subject.resourceRevision });
}
export function returnPublicItem(target: GaolaoTarget | null, itemRef: string, projection: ProjectionV2, canAct: boolean): GaolaoInteractionV2 | null {
  const item = projection.items.find(item => item.entityRef === itemRef && item.publicBorrowable && item.location.kind === 'held' && item.location.ownerRef === projection.self.entityRef);
  if (!item || !offered(target, 'gz-return-public', canAct)) return null;
  return gaolaoInteraction({ kind: 'interact', targetRef: target.entityRef, operationId: 'gz-return-public', expectedTargetRevision: target.resourceRevision, parameters: { itemRef, expectedItemRevision: item.resourceRevision } });
}
export function requestPrivateItems(target: GaolaoTarget | null, itemRefs: string[], projection: ProjectionV2, canAct: boolean): GaolaoInteractionV2 | null {
  if (!projection.chapter || !offered(target, 'gz-request-private-items', canAct) || !itemRefs.length || new Set(itemRefs).size !== itemRefs.length
    || itemRefs.some(reference => !projection.items.some(item => item.entityRef === reference && !item.publicBorrowable))) return null;
  // 地面物件没有公开物主，持有人也不等于物主；本次物主与许可范围由服务端重验。
  return gaolaoInteraction({ kind: 'interact', targetRef: target.entityRef, operationId: 'gz-request-private-items', expectedTargetRevision: target.resourceRevision, parameters: { itemRefs: [...itemRefs], expectedConsentVersion: currentConsent(projection.chapter, target.entityRef, 'private_items')?.version || '0' } });
}
export function proposeEnding(chapter: ChapterViewV2, scope: 'chapter' | 'recruitment', proposalId: string, canAct: boolean): ActionV2 | null {
  if (!canAct) return null;
  return validateSpatial('ActionV2', { kind: 'request_end', proposalId, proposalVersion: chapter.endProposal?.proposalVersion || '0', scope });
}

/** 这里只准备请求；比较、本人决定、同意效果始终等待服务端确认。 */
export function comparisonAction(target: TargetViewV2 | null, references: string[], observations: ObservationViewV2[], canAct: boolean): GaolaoInteractionV2 | null {
  if (!canAct || !target?.availableOperations.includes('gz-compare-sources') || references.length !== 2 || new Set(references).size !== 2) return null;
  const selected = references.map(reference => observations.find(observation => observation.observationRef === reference));
  if (selected.some(observation => !observation?.source)) return null;
  const sources = selected.map(observation => observation!.source!);
  if (!sources.some(source => source.kind === 'archive') || !sources.some(source => source.kind === 'testimony') || sources[0]!.sourceRef === sources[1]!.sourceRef) return null;
  return gaolaoInteraction({ kind: 'interact', operationId: 'gz-compare-sources', targetRef: target.entityRef, expectedTargetRevision: target.resourceRevision, parameters: { evidenceRefs: [...references] } });
}

export function consentResponse(consent: ConsentViewV2, selfRef: string, response: 'accept' | 'decline' | 'defer', canAct: boolean): ActionV2 | null {
  if (!canAct || consent.subjectRef !== selfRef || !['proposed', 'deferred'].includes(consent.status)) return null;
  return validateSpatial('ActionV2', { kind: 'respond_consent', consentId: consent.consentId, expectedConsentVersion: consent.version, response });
}

export function consentWithdrawal(consent: ConsentViewV2, selfRef: string, canAct: boolean): ActionV2 | null {
  if (!canAct || consent.subjectRef !== selfRef || !['proposed', 'accepted', 'deferred'].includes(consent.status)) return null;
  return validateSpatial('ActionV2', { kind: 'withdraw_consent', consentId: consent.consentId, expectedConsentVersion: consent.version });
}

export function endingConfirmation(proposal: EndProposalViewV2 | null, canAct: boolean): ActionV2 | null {
  if (!canAct || !proposal || proposal.status !== 'pending' || proposal.ownConfirmed) return null;
  return validateSpatial('ActionV2', { kind: 'confirm_end', proposalId: proposal.proposalId, proposalVersion: proposal.proposalVersion });
}
