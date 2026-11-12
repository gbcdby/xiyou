import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSpatial } from '../../protocol/spatial.mjs';

const ref = letter => 'R' + letter.repeat(32);
const target = () => ({ entityRef: ref('a'), name: '会面比较处', sceneId: 'yard', position: { x: 40, y: 60 }, resourceRevision: '12', availableOperations: ['gz-compare-sources'], fields: [] });
const observation = (letter, kind, sourceLetter) => ({ observationRef: ref(letter), category: 'Evidence', statement: '已经获准阅读的材料。', sourceSeq: '8', fields: [], shareable: true, source: { sourceRef: ref(sourceLetter), kind, label: kind === 'archive' ? '旧饭账' : '茶棚见闻', beforeArrivalDays: 3, receivedSeq: '8' } });

test('来源比较只从当下授权观察构造有限操作，保留目标与材料的原公开引用和版本', async () => {
  const { comparisonAction } = await import('../src/domain/gaolao-actions.ts');
  const observations = [observation('b', 'archive', 'c'), observation('d', 'testimony', 'e')];
  const action = comparisonAction(target(), observations.map(o => o.observationRef), observations, true);
  assert.deepEqual(action, { kind: 'interact', operationId: 'gz-compare-sources', targetRef: ref('a'), expectedTargetRevision: '12', parameters: { evidenceRefs: [ref('b'), ref('d')] } });
  validateSpatial('GaolaoInteractionV2', action);
  assert.equal(observations[0].category, 'Evidence');
  assert.equal(Object.hasOwn(action.parameters, 'AccountsCompared'), false);
});

test('失去可用操作/控制/目标/材料或重复原来源时不构造比较请求', async () => {
  const { comparisonAction } = await import('../src/domain/gaolao-actions.ts');
  const observations = [observation('b', 'archive', 'c'), observation('d', 'testimony', 'e')]; const refs = observations.map(o => o.observationRef);
  for (const args of [[null, refs, observations, true], [{ ...target(), availableOperations: [] }, refs, observations, true], [target(), refs, observations, false], [target(), refs, [observations[0]], true], [target(), [refs[0], refs[0]], observations, true], [target(), refs, [observations[0], observation('d', 'testimony', 'c')], true], [target(), refs, [observations[0], observation('d', 'archive', 'e')], true]]) assert.equal(comparisonAction(...args), null);
});

test('同意回应与撤回只允许本人当前记录，拒绝用同名和旧用途代签', async () => {
  const { consentResponse, consentWithdrawal, endingConfirmation } = await import('../src/domain/gaolao-actions.ts');
  const consent = { consentId: ref('f'), subjectRef: ref('g'), requesterRef: ref('h'), purpose: 'follow', scope: { destinationId: 'safe-court', leaderRef: ref('h') }, version: '7', status: 'proposed', sourceSeq: '8' };
  assert.deepEqual(consentResponse(consent, ref('g'), 'defer', true), { kind: 'respond_consent', consentId: ref('f'), expectedConsentVersion: '7', response: 'defer' });
  assert.equal(consentResponse(consent, ref('x'), 'accept', true), null);
  assert.equal(consentResponse(consent, ref('g'), 'accept', false), null);
  assert.equal(consentResponse({ ...consent, status: 'withdrawn' }, ref('g'), 'accept', true), null);
  assert.deepEqual(consentWithdrawal({ ...consent, status: 'accepted' }, ref('g'), true), { kind: 'withdraw_consent', consentId: ref('f'), expectedConsentVersion: '7' });
  assert.equal(consentWithdrawal(consent, ref('x'), true), null);
  const proposal = { proposalId: 'finish-1', proposalVersion: '4', scope: 'recruitment', onlineMembershipVersion: '8', requiredCount: 3, confirmedCount: 1, ownConfirmed: false, status: 'pending' };
  assert.deepEqual(endingConfirmation(proposal, true), { kind: 'confirm_end', proposalId: 'finish-1', proposalVersion: '4' });
  for (const invalid of [{ ...proposal, status: 'invalidated' }, { ...proposal, ownConfirmed: true }, null]) assert.equal(endingConfirmation(invalid, true), null);
  assert.equal(endingConfirmation(proposal, false), null);
});

function projection() {
  const self = { entityRef: ref('s'), name: '旅伴', appearanceEpoch: '0', sceneId: 'yard', position: { x: 100, y: 100 }, facing: 'S', resourceRevision: '2', availableOperations: [] };
  const person = { ...self, entityRef: ref('p'), name: '眼前的人', position: { x: 140, y: 100 }, resourceRevision: '21', availableOperations: ['gz-request-appearance', 'gz-invite-meeting', 'gz-request-private-items'] };
  return validateSpatial('ProjectionV2', {
    protocolCapability: 'spatial-v2', chapterVersion: 'gaolao-test', mapVersion: 'map-test', variantId: 'test', contentVersion: 'gaolao-test', reducerVersion: 'gaolao-world-v1', phase: 'Running', sceneTimeMs: 100, paused: false,
    self: { ...self, controlEpoch: '2', canControl: true, capabilities: ['propose_follow', 'request_end'], movementCommandHighWater: '0' }, entities: [self, person],
    items: [{ entityRef: ref('i'), name: '地面私物', location: { kind: 'ground', sceneId: 'yard', position: { x: 120, y: 120 } }, resourceRevision: '7', transferable: true, publicBorrowable: false, fields: [] }, { entityRef: ref('j'), name: '携带的公用物', location: { kind: 'held', ownerRef: ref('s') }, resourceRevision: '8', transferable: true, publicBorrowable: true, fields: [] }],
    targets: [target()], scene: null, movement: null, observations: [], claims: [], cooperations: [], objectives: [], ending: null,
    chapter: { chapterId: 'gaolaozhuang', responsibilities: ['A'], progress: [], consents: [], follows: [], decisions: [], destinations: [{ destinationId: 'safe-yard', label: '院内安置点', purpose: 'follow', sceneId: 'yard', position: { x: 200, y: 200 } }, { destinationId: 'meeting-yard', label: '院内会面点', purpose: 'meeting', sceneId: 'yard', position: { x: 300, y: 200 } }], endProposal: null, publicItems: [] },
  });
}
function consent(letter, purpose, version, sourceSeq = version) {
  return { consentId: ref(letter), subjectRef: ref('p'), requesterRef: ref('s'), purpose, scope: {}, version, status: 'proposed', sourceSeq };
}

test('许可当前值按同一公开对象与用途的十进制版本取最新，不把有界历史首项当当前', async () => {
  const { currentConsent, currentConsents } = await import('../src/domain/gaolao-actions.ts');
  const p = projection();
  p.chapter.consents = [consent('a', 'follow', '9007199254740992'), consent('b', 'follow', '9007199254740993'), consent('c', 'appearance', '2'), { ...consent('d', 'follow', '99'), subjectRef: ref('q') }];
  const original = structuredClone(p.chapter.consents);
  assert.equal(currentConsent(p.chapter, ref('p'), 'follow').consentId, ref('b'));
  assert.equal(currentConsent(p.chapter, ref('p'), 'meeting'), null);
  assert.deepEqual(currentConsents(p.chapter).map(c => c.consentId), [ref('b'), ref('c'), ref('d')]);
  assert.deepEqual(p.chapter.consents, original, '显示当前安排不能删改授权历史');
});

test('有限人物操作只使用当前可用入口和原目标版本；NPC 本人的决定不进入玩家操作清单', async () => {
  const { humanGaolaoOperations, simpleGaolaoAction, requestMeetingOrAppearance } = await import('../src/domain/gaolao-actions.ts');
  const p = projection(); const person = p.entities[1];
  p.chapter.consents = [consent('c', 'appearance', '9'), consent('d', 'appearance', '10'), consent('e', 'meeting', '3')];
  assert.deepEqual(requestMeetingOrAppearance(person, 'gz-request-appearance', 'meeting-yard', p.chapter, true), { kind: 'interact', targetRef: ref('p'), operationId: 'gz-request-appearance', expectedTargetRevision: '21', parameters: { destinationId: 'meeting-yard', expectedConsentVersion: '10' } });
  assert.equal(requestMeetingOrAppearance(person, 'gz-request-appearance', 'safe-yard', p.chapter, true), null);
  assert.equal(requestMeetingOrAppearance({ ...person, availableOperations: [] }, 'gz-request-appearance', 'meeting-yard', p.chapter, true), null);
  assert.equal(requestMeetingOrAppearance(person, 'gz-invite-meeting', 'meeting-yard', p.chapter, false), null);
  assert.ok(humanGaolaoOperations.every(({ operationId }) => !['gz-break-seal', 'gz-confirm-settlement', 'gz-recruitment-decision', 'gz-membership-decision', 'gz-join-party'].includes(operationId)));
  const door = { ...target(), availableOperations: ['gz-contact'], resourceRevision: '19' };
  assert.deepEqual(simpleGaolaoAction(door, 'gz-contact', true), { kind: 'interact', targetRef: ref('a'), operationId: 'gz-contact', expectedTargetRevision: '19' });
  for (const args of [[null, 'gz-contact', true], [{ ...door, resourceRevision: undefined }, 'gz-contact', true], [door, 'gz-contact', false], [door, 'gz-check-seal', true]]) assert.equal(simpleGaolaoAction(...args), null);
});

test('随行改约保留当前许可版本，只接受当前可见主体、带路者与该用途地点', async () => {
  const { proposeFollow } = await import('../src/domain/gaolao-actions.ts');
  const p = projection(); p.chapter.consents = [consent('c', 'follow', '4'), { ...consent('d', 'follow', '5'), status: 'withdrawn' }];
  const action = proposeFollow(p, ref('p'), ref('s'), 'safe-yard', true);
  assert.deepEqual(action, { kind: 'propose_follow', subjectRef: ref('p'), leaderRef: ref('s'), destinationId: 'safe-yard', expectedConsentVersion: '5' });
  for (const args of [[p, ref('p'), ref('s'), 'safe-yard', false], [p, ref('s'), ref('s'), 'safe-yard', true], [p, ref('p'), ref('x'), 'safe-yard', true], [p, ref('p'), ref('s'), 'meeting-yard', true]]) assert.equal(proposeFollow(...args), null);
  const hidden = structuredClone(p); hidden.entities[1].position = null;
  assert.equal(proposeFollow(hidden, ref('p'), ref('s'), 'safe-yard', true), null);
  p.self.capabilities = [];
  assert.equal(proposeFollow(p, ref('p'), ref('s'), 'safe-yard', true), null);
});

test('私物请求允许授权地面物件，不猜物主；拒绝不可见、公用、重复物件及已消失入口', async () => {
  const { requestPrivateItems } = await import('../src/domain/gaolao-actions.ts');
  const p = projection(); const person = p.entities[1]; p.chapter.consents = [consent('c', 'private_items', '3')];
  const action = requestPrivateItems(person, [ref('i')], p, true);
  assert.deepEqual(action, { kind: 'interact', targetRef: ref('p'), operationId: 'gz-request-private-items', expectedTargetRevision: '21', parameters: { itemRefs: [ref('i')], expectedConsentVersion: '3' } });
  assert.equal(Object.hasOwn(p.items[0].location, 'ownerRef'), false, '请求不需要也不创造隐藏物主字段');
  for (const references of [[], [ref('x')], [ref('j')], [ref('i'), ref('i')]]) assert.equal(requestPrivateItems(person, references, p, true), null);
  assert.equal(requestPrivateItems(person, [ref('i')], p, false), null);
  assert.equal(requestPrivateItems({ ...person, availableOperations: [] }, [ref('i')], p, true), null);
});

test('实际归还必须是自己持有的可见公用物，提议收束只携带当前轮版本', async () => {
  const { returnPublicItem, proposeEnding } = await import('../src/domain/gaolao-actions.ts');
  const p = projection(); const returnTarget = { ...target(), availableOperations: ['gz-return-public'] };
  assert.deepEqual(returnPublicItem(returnTarget, ref('j'), p, true), { kind: 'interact', targetRef: ref('a'), operationId: 'gz-return-public', expectedTargetRevision: '12', parameters: { itemRef: ref('j'), expectedItemRevision: '8' } });
  assert.equal(returnPublicItem(returnTarget, ref('i'), p, true), null);
  p.items[1].location.ownerRef = ref('p'); assert.equal(returnPublicItem(returnTarget, ref('j'), p, true), null);
  assert.deepEqual(proposeEnding(p.chapter, 'chapter', 'end-round-one', true), { kind: 'request_end', proposalId: 'end-round-one', proposalVersion: '0', scope: 'chapter' });
  p.chapter.endProposal = { proposalId: 'old-round', proposalVersion: '8', scope: 'chapter', onlineMembershipVersion: '3', requiredCount: 2, confirmedCount: 1, ownConfirmed: true, status: 'invalidated' };
  assert.deepEqual(proposeEnding(p.chapter, 'recruitment', 'end-round-two', true), { kind: 'request_end', proposalId: 'end-round-two', proposalVersion: '8', scope: 'recruitment' });
  assert.equal(p.chapter.endProposal.status, 'invalidated', '发出新提议不把本地旧轮改成已确认');
  assert.equal(proposeEnding(p.chapter, 'chapter', 'end-round-three', false), null);
});
