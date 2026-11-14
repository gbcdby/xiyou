import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSpatial } from '../spatial.mjs';

const ref = letter => letter.repeat(40);
const interaction = (operationId, parameters) => ({
  kind: 'interact', targetRef: ref('T'), expectedTargetRevision: '17', operationId,
  ...(parameters === undefined ? {} : { parameters }),
});

test('本人目录只说明有限名目，不能夹带物品操作引用、远处位置或重复名目 token', () => {
  const offer = { offerRef: ref('O'), subjectRef: ref('T'), sourceRef: ref('S'), sourceRevision: '1', options: [{ optionRef: ref('P'), label: '包裹', handling: 'retrieve_to_owner' }, { optionRef: ref('L'), label: '信件', handling: 'retrieve_to_owner' }] };
  assert.deepEqual(validateSpatial('PrivateItemOfferV1', offer), offer);
  for (const mutate of [
    value => { value.options[0].itemRef = ref('X'); },
    value => { value.options[0].position = { x: 3, y: 4 }; },
    value => { value.options[1].optionRef = ref('P'); },
    value => { value.options[0].handling = 'read_and_share'; },
  ]) { const bad = structuredClone(offer); mutate(bad); assert.throws(() => validateSpatial('PrivateItemOfferV1', bad)); }
});

test('取消和显式改约保留两版本身份，不接纳伪造本人决定或省略 lifecycle', () => {
  const replacement = { consentId: ref('C'), expectedConsentVersion: '4', expectedLifecycleVersion: '9' };
  assert.doesNotThrow(() => validateSpatial('ActionV2', { kind: 'cancel_personal_request', ...replacement }));
  assert.doesNotThrow(() => validateSpatial('ActionV2', interaction('gz-request-appearance', { destinationId: 'rear-meeting', permissionTerm: 'single_use', replacement })));
  for (const bad of [{ consentId: ref('C'), expectedConsentVersion: '4' }, { ...replacement, response: 'withdraw' }, { ...replacement, expectedLifecycleVersion: 9 }]) {
    assert.throws(() => validateSpatial('ActionV2', { kind: 'cancel_personal_request', ...bad }));
    assert.throws(() => validateSpatial('ActionV2', interaction('gz-request-appearance', { destinationId: 'rear-meeting', permissionTerm: 'single_use', replacement: bad })));
  }
});

const actor = { entityRef: ref('H'), name: '玩家', appearanceEpoch: '0', sceneId: 'gaolao-courtyard', position: { x: 100, y: 100 }, facing: 'S' };
const origin = { sceneId: 'gaolao-courtyard', position: { x: 140, y: 130 }, label: '本人说明的原放物处' };
const privateReturn = letter => ({ returnContextId: ref(letter), originalConsentId: ref('C'), acceptedConsentVersion: '4', sourceLifecycleVersion: '7', itemRef: ref(letter.toLowerCase()), itemRevision: '2', mode: 'return_only', ownerLabel: '翠兰', ownerRef: null, origin });
const projection = () => ({
  protocolCapability: 'spatial-v2', contentVersion: 'gaolaozhuang-scene-v3', reducerVersion: 'gaolao-world-v2', chapterVersion: 'gaolaozhuang-chapter-v3', mapVersion: 'gaolao-layout-v1.1', variantId: 'west-tools',
  phase: 'Running', sceneTimeMs: 0, paused: false, self: { ...actor, controlEpoch: '1', canControl: true, capabilities: [], movementCommandHighWater: '0' }, entities: [actor],
  items: ['p', 'l'].map(letter => ({ entityRef: ref(letter), name: '私物', location: { kind: 'held', ownerRef: actor.entityRef }, resourceRevision: '2', transferable: true, publicBorrowable: false, fields: [] })),
  targets: [], scene: null, movement: null, observations: [], claims: [], cooperations: [], objectives: [], ending: null,
  chapter: { chapterId: 'gaolaozhuang', responsibilities: ['A'], progress: [], consents: [], follows: [], decisions: [], destinations: [], endProposal: null, publicItems: [], personalRequests: [], privateItemOffers: [], privateReturns: [privateReturn('P'), privateReturn('L')] },
});

test('新投影独立保留两件旧持物；缺新字段、旧解释器混装和不可见 ownerRef 被拒绝', () => {
  const value = projection();
  assert.deepEqual(validateSpatial('ProjectionV2', value).chapter.privateReturns, value.chapter.privateReturns);
  for (const mutate of [
    p => { delete p.chapter.privateReturns; },
    p => { delete p.chapter.personalRequests; },
    p => { delete p.chapter.privateItemOffers; },
    p => { p.reducerVersion = 'gaolao-world-v1'; },
    p => { p.chapter.privateReturns[0].ownerRef = ref('X'); },
    p => { p.chapter.privateReturns[0].itemRevision = '1'; },
    p => { p.chapter.privateReturns[1] = structuredClone(p.chapter.privateReturns[0]); },
    p => { p.items[0].location = { kind: 'ground', sceneId: origin.sceneId, position: origin.position }; },
  ]) {
    const bad = projection(); mutate(bad);
    assert.throws(() => validateSpatial('ProjectionV2', bad));
    assert.throws(() => validateSpatial('BatchV2', { schemaVersion: 2, type: 'world.batch', sessionId: 'session-a', viewId: 'view-a', fromExclusive: '0', throughSeq: '1', events: [{ sessionSeq: '1', eventId: 'event-a', kind: 'projection.replace', payload: { projection: bad } }] }));
  }
  const old = projection(); old.contentVersion = 'gaolaozhuang-scene-v2'; old.chapterVersion = 'gaolaozhuang-chapter-v2'; old.reducerVersion = 'gaolao-world-v1';
  delete old.chapter.personalRequests; delete old.chapter.privateItemOffers; delete old.chapter.privateReturns;
  assert.doesNotThrow(() => validateSpatial('ProjectionV2', old));
});

test('CS-R2 的两种期限是合法询问，提议使用公开人物 revision，旧请求合同保留', () => {
  for (const permissionTerm of ['single_use', 'reusable']) {
    const appearance = interaction('gz-request-appearance', { destinationId: 'front-meeting', permissionTerm });
    const items = interaction('gz-request-private-items', { offerRef: ref('O'), itemOptionRefs: [ref('P'), ref('L')], permissionTerm });
    assert.deepEqual(validateSpatial('ActionV2', appearance), appearance);
    assert.deepEqual(validateSpatial('ActionV2', items), items);
  }
  const old = interaction('gz-request-appearance', { destinationId: 'front-meeting', expectedConsentVersion: '0' });
  assert.deepEqual(validateSpatial('ActionV2', old), old);
  assert.deepEqual(validateSpatial('ActionV2', interaction('gz-describe-private-items')), interaction('gz-describe-private-items'));
  for (const parameters of [
    { destinationId: 'front-meeting' },
    { destinationId: 'front-meeting', permissionTerm: 'permanent' },
    { destinationId: 'front-meeting', permissionTerm: 'single_use', expectedConsentVersion: '0' },
    { destinationId: 'front-meeting', permissionTerm: 'single_use', performerId: 'wukong' },
  ]) assert.throws(() => validateSpatial('ActionV2', interaction('gz-request-appearance', parameters)));
  for (const itemOptionRefs of [[], [ref('P'), ref('P')], [ref('P'), ref('L'), ref('X')]]) {
    assert.throws(() => validateSpatial('ActionV2', interaction('gz-request-private-items', { offerRef: ref('O'), itemOptionRefs, permissionTerm: 'single_use' })));
  }
});
