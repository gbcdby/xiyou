import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../../content/index.mjs';

test('个人 scope 合同保留可被拒绝的 reusable，并严格绑定用途与不可变摘要', async () => {
  const { validatePersonalScope, personalScopeDigest } = await import('../../game/gaolao-personal-contract.mjs');
  const scope = { destinationId: 'front-meeting', permissionTerm: 'reusable', usage: 'inquiry_meeting', radius: 90 };
  assert.deepEqual(validatePersonalScope('appearance', scope), scope);
  assert.notEqual(personalScopeDigest('appearance', scope), personalScopeDigest('appearance', { ...scope, permissionTerm: 'single_use' }));
  assert.throws(() => validatePersonalScope('appearance', { ...scope, permissionTerm: 'permanent' }));
  assert.throws(() => validatePersonalScope('private_items', scope));
  const missing = { ...scope }; delete missing.permissionTerm;
  assert.throws(() => validatePersonalScope('appearance', missing));
});

test('请求与实际接受证明分开，缺 term、旧接受版本和改写 scope 不能得到可用执行记录', async () => {
  const api = await import('../../game/gaolao-personal-contract.mjs');
  const content = await loadContent('gaolaozhuang-scene-v3');
  const scope = { destinationId: 'front-meeting', permissionTerm: 'single_use', usage: 'inquiry_meeting', radius: 90 };
  const consent = { consentId: 'C'.repeat(40), subjectId: 'gz-cuilan', requesterId: 'human-a', performerId: 'gz-wukong', purpose: 'appearance', scope, version: '1', status: 'proposed' };
  const shared = { subjectId: consent.subjectId, subjectEpoch: '3', requesterId: consent.requesterId, requesterEpoch: '2', performerId: consent.performerId, performerEpoch: '4', scopeDigest: api.personalScopeDigest('appearance', scope), contentVersion: content.contentVersion, chapterVersion: content.chapterVersion, mapVersion: content.mapVersion, policyVersion: 'gaolao-cuilan-v2' };
  const record = { consentId: consent.consentId, lifecycleVersion: '1', lifecycle: 'open', reasonCode: null, transitionActor: 'human-a', transitionSeq: '10', proposalBinding: { ...shared, consentVersion: '1', requestActionId: 'request-a', requestDigest: 'a'.repeat(64), sourceSeq: '10', requestObservationRef: 'Q'.repeat(40), receivedSeq: '10' }, execution: { state: 'none', acceptedProof: null, appearanceStarted: false, appearanceEnded: false, itemUses: [] }, notice: null };
  assert.deepEqual(api.validatePersonalRequestRecord(record, consent), record);
  const source = api.personalSources(content)[0];
  const accepted = structuredClone(record), acceptedConsent = { ...consent, version: '2', status: 'accepted' };
  accepted.execution.state = 'ready';
  accepted.execution.acceptedProof = { ...shared, consentVersion: '2', actionId: 'owner-accept', requestDigest: 'b'.repeat(64), sources: [{ sourceId: source.sourceId, sourceRevision: '1', sourceRef: 'S'.repeat(40), observationRef: 'O'.repeat(40), sourceSeq: '1', receivedSeq: '1', digest: source.digest }] };
  assert.doesNotThrow(() => api.validatePersonalRequestRecord(accepted, acceptedConsent));
  for (const mutate of [
    r => { r.execution.acceptedProof.consentVersion = '1'; },
    r => { r.execution.acceptedProof.requesterEpoch = '3'; },
    r => { r.proposalBinding.scopeDigest = 'f'.repeat(64); },
    r => { r.execution.acceptedProof = null; },
    r => { delete r.lifecycleVersion; },
  ]) { const bad = structuredClone(accepted); mutate(bad); assert.throws(() => api.validatePersonalRequestRecord(bad, acceptedConsent)); }
  assert.throws(() => api.validatePersonalRequestRecord(accepted, { ...acceptedConsent, scope: { ...scope, permissionTerm: 'reusable' } }));
  const privateBinding = api.personalDecisionBinding({ chapter: { consents: { [consent.consentId]: acceptedConsent }, consentSlots: { 'gz-cuilan:appearance': consent.consentId }, personalRequests: { [consent.consentId]: accepted } } }, 'gz-cuilan', 'appearance');
  assert.equal(privateBinding.consentVersion, '2'); assert.equal(privateBinding.lifecycleVersion, '1'); assert.equal(privateBinding.permissionTerm, 'single_use');
});

test('逐物返还集合只随当前真实经手选择，旧槽被替换或历史清空不吞另一件', async () => {
  const api = await import('../../game/gaolao-personal-contract.mjs');
  const content = await loadContent('gaolaozhuang-scene-v3');
  const acquisition = (itemId, letter) => ({ acquisitionId: letter.repeat(40), itemId, holderId: 'human-a', ownerId: content.chapterRules.people.cuilan, originalConsentId: 'C'.repeat(40), acceptedConsentVersion: '2', sourceLifecycleVersion: '2', scopeDigest: 'a'.repeat(64), takeActionId: 'take-' + letter, requestDigest: 'b'.repeat(64), takenAtSeq: '30', origin: { sceneId: 'gaolao-courtyard', position: { x: 100, y: 100 }, label: '登记原处' }, outcome: 'held', resolvedByActionId: null, resolvedAtSeq: null });
  const parcel = acquisition('gz-parcel', 'P'), letter = acquisition('gz-letter', 'L');
  const state = { ...content, items: Object.fromEntries([parcel, letter].map(a => [a.itemId, { itemId: a.itemId, location: { kind: 'character', characterId: 'human-a' }, personalAcquisitionId: a.acquisitionId }])), observations: {}, chapter: { consentSlots: { 'gz-cuilan:private_items': 'new-request' }, consents: {}, personalRequests: {}, privateAcquisitions: { [parcel.acquisitionId]: parcel, [letter.acquisitionId]: letter } } };
  assert.equal(api.privateReturnAcquisitions(state, content, 'human-a').length, 2);
  assert.deepEqual(api.privateReturnAcquisitions(state, content, 'human-b'), []);
  state.items[parcel.itemId].location = { kind: 'character', characterId: parcel.ownerId };
  parcel.outcome = 'delivered_to_owner'; parcel.resolvedByActionId = 'return-parcel'; parcel.resolvedAtSeq = '35';
  assert.deepEqual(api.privateReturnAcquisitions(state, content, 'human-a').map(a => a.itemId), ['gz-letter']);
  const broken = structuredClone(state); delete broken.items['gz-letter'].personalAcquisitionId;
  assert.throws(() => api.privateReturnAcquisitions(broken, content, 'human-a'));
  assert.throws(() => api.validatePrivateAcquisition({ ...letter, outcome: 'restored_origin' }));
});

test('本人来源只从登记内容导出有限声明、会面范围和两私物原处，旧内容不注入', async () => {
  const { personalSources } = await import('../../game/gaolao-personal-contract.mjs');
  const content = await loadContent('gaolaozhuang-scene-v3');
  const sources = personalSources(content);
  assert.equal(sources.length, 2);
  assert.equal(sources[0].knowledge.meetingDestinations.length, 3);
  assert.equal(sources[0].knowledge.radius, 90);
  assert.deepEqual(sources[1].knowledge.items.map(item => item.itemId).sort(), ['gz-letter', 'gz-parcel']);
  assert.ok(sources.every(source => source.digest.length === 64 && source.sourceRevision === '1' && source.knowledge.declaration.category === 'Claim'));
  assert.equal(JSON.stringify(sources).includes('live'), false);
  assert.deepEqual(personalSources(await loadContent('gaolaozhuang-scene-v2')), []);
});

test('本人来源落窗仍读取原持久依据，不能借别人的来源或损坏摘要作选择', async () => {
  const api = await import('../../game/gaolao-personal-contract.mjs');
  const content = await loadContent('gaolaozhuang-scene-v3'), personalSource = api.personalSources(content)[0], declaration = personalSource.knowledge.declaration;
  const actorId = content.chapterRules.people.cuilan, observationRef = 'O'.repeat(40), sourceRef = 'S'.repeat(40);
  const retainedObservation = { observationRef, category: declaration.category, statement: declaration.statement, sourceSeq: '4', fields: declaration.fields, shareable: false, source: { sourceRef, kind: declaration.kind, label: declaration.label, beforeArrivalDays: declaration.beforeArrivalDays, receivedSeq: '4' } };
  const state = { ...content, observations: { [actorId]: [] }, chapter: { sourceTokens: { [personalSource.sourceId]: sourceRef }, provenance: { [actorId]: { [observationRef]: { sourceId: personalSource.sourceId, personalSource, retainedObservation } } } } };
  assert.equal(api.ownPersonalSource(state, content, actorId, 'appearance').sourceRef, sourceRef);
  assert.equal(api.ownPersonalSource(state, content, 'human-a', 'appearance'), null);
  assert.equal(api.ownPersonalSource(state, content, actorId, 'private_items'), null);
  const bad = structuredClone(state); bad.chapter.provenance[actorId][observationRef].personalSource.digest = '0'.repeat(64);
  assert.equal(api.ownPersonalSource(bad, content, actorId, 'appearance'), null);
});
