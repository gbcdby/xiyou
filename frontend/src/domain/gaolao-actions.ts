import { gaolaoInteraction, validateSpatial } from '../../../protocol/spatial.mjs';
import { compareDecimal } from '../../../protocol/index.mjs';
import type { ActionV2, ChapterViewV2, ConsentPurpose, ConsentViewV2, EndProposalViewV2, GaolaoInteractionV2, ObservationViewV2, ProjectionV2, TargetViewV2 } from '../../../game/spatial-types.ts';

export interface GaolaoTarget { entityRef: string; resourceRevision?: string; availableOperations?: string[] }
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
