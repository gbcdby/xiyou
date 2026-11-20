import test from 'node:test';
import assert from 'node:assert/strict';
import { gaolaoGuidance } from '../src/domain/gaolao-guidance.ts';
import { spatialSnapshot } from './spatial-fixture.mjs';

function chapter() {
  const p = spatialSnapshot().projection;
  p.reducerVersion = 'gaolao-world-v1';
  p.objectives = [{ objectiveId: 'rescue', label: '先联系受困者，再准备安全开门。', status: 'active' }];
  p.chapter = { chapterId: 'gaolaozhuang', responsibilities: ['A'], progress: [], consents: [], follows: [], decisions: [], destinations: [], endProposal: null, publicItems: [] };
  return p;
}
const ready = { online: true, inputReady: true, unknownCount: 0 };

test('新局同时给出共同目标和基于真实操作入口的下一步，指引本身不提交动作', () => {
  const p = chapter();
  p.targets = [{ entityRef: 'contact-ref', name: '侧窗', sceneId: 'yard', position: { x: 420, y: 230 }, resourceRevision: '2', fields: [], availableOperations: ['gz-contact'] }];
  const before = structuredClone(p);
  const result = gaolaoGuidance(p, ready);
  assert.equal(result.goal, p.objectives[0].label);
  assert.match(result.next.title, /联系/);
  assert.deepEqual(result.next.action, { kind: 'select', reference: 'contact-ref', label: '查看侧窗' });
  assert.deepEqual(p, before, '派生指引不写投影或自动执行世界动作');
});

test('只按已授权完成事实调整目标；未提供和未知不伪装为未完成', () => {
  const p = chapter();
  p.chapter.progress = [{ key: 'safe', label: '本人确认安置', value: null }];
  let result = gaolaoGuidance(p, ready);
  assert.equal(result.knownProgress, null);
  assert.doesNotMatch(JSON.stringify(result), /安置尚未完成|未同意|真实身份|悟空借貌/);
  p.chapter.progress = [{ key: 'open', label: '铜封解除，后宅通路开放。', value: true }];
  result = gaolaoGuidance(p, ready);
  assert.match(result.goal, /本人|安置/);
  assert.doesNotMatch(result.goal, /准备安全开门/);
  assert.equal(result.knownProgress, p.chapter.progress[0].label);
  p.chapter.progress.push({ key: 'safe', label: '本人已确认安置', value: true });
  assert.match(gaolaoGuidance(p, ready).goal, /材料|商量/);
});

test('未知动作和断线优先解释阻塞，保留查询原请求入口', () => {
  const p = chapter();
  const unknown = gaolaoGuidance(p, { ...ready, unknownCount: 2 });
  assert.equal(unknown.next.action.kind, 'receipts');
  assert.match(unknown.status.text, /2.*确认/);
  assert.match(unknown.next.description, /原样重试/);
  const offline = gaolaoGuidance(p, { ...ready, online: false, inputReady: false, unknownCount: 2 });
  assert.match(offline.status.text, /重连|连接/);
  assert.equal(offline.next.action.kind, 'receipts', '断线也不隐藏已存在的待确认记录');
  const readonly = gaolaoGuidance(p, { ...ready, inputReady: false });
  assert.match(readonly.next.title, /恢复.*控制/);
});

test('随行只定位当前获准目的地；到达不冒充本人确认安置', () => {
  const p = chapter();
  p.chapter.destinations = [{ destinationId: 'safe-room', label: '约定客房', sceneId: 'yard', position: { x: 620, y: 290 }, purpose: 'follow' }];
  p.chapter.follows = [{ followId: 'f1', subjectRef: 'subject', leaderRef: p.self.entityRef, destinationId: 'safe-room', planVersion: '1', consentId: 'c1', consentVersion: '1', status: 'following', reason: '' }];
  let result = gaolaoGuidance(p, ready);
  assert.deepEqual(result.next.action, { kind: 'navigate', sceneId: 'yard', position: { x: 620, y: 290 }, label: '前往约定客房' });
  p.chapter.follows[0].status = 'arrived';
  result = gaolaoGuidance(p, ready);
  assert.match(result.next.title, /等待本人确认/);
  assert.equal(result.next.action.kind, 'chapter');
  assert.doesNotMatch(result.goal, /已完成安置/);
  p.chapter.follows[0].status = 'following'; p.chapter.destinations = [];
  assert.notEqual(gaolaoGuidance(p, ready).next.action?.kind, 'navigate', '不猜造未授权地点');
});

test('本人待回应、明确拒绝和终局从授权状态显示，不按玩家愿望改写', () => {
  const p = chapter();
  p.chapter.consents = [{ consentId: 'c1', subjectRef: p.self.entityRef, requesterRef: 'someone', purpose: 'meeting', scope: {}, version: '1', status: 'proposed', sourceSeq: '2' }];
  assert.match(gaolaoGuidance(p, ready).next.title, /由你回应/);
  p.chapter.consents = [];
  p.chapter.personalRequests = [{ consentId: 'c2', lifecycle: 'open', executionState: 'none', reason: '请等我安顿好再谈。' }];
  p.chapter.consents = [{ consentId: 'c2', subjectRef: 'subject', requesterRef: p.self.entityRef, purpose: 'appearance', scope: {}, version: '2', status: 'deferred', sourceSeq: '3' }];
  const deferred = gaolaoGuidance(p, ready);
  assert.match(deferred.next.title, /暂缓/);
  assert.equal(deferred.next.description, '请等我安顿好再谈。');
  assert.equal(deferred.next.action.kind, 'chapter');
  p.phase = 'Finished'; p.ending = { title: '各走各路', summary: '按本局已发生的事实分别。', facts: [] };
  const ended = gaolaoGuidance(p, ready);
  assert.equal(ended.goal, '各走各路');
  assert.equal(ended.next.action.kind, 'recap');
  assert.equal(gaolaoGuidance(null, ready), null);
});

test('远处新玩家按职责得到真实公开地点，已联系后不反复指向联络动作', () => {
  const p = chapter();
  p.scene.anchors = [{ anchorId: 'C04', label: '侧窗外联络', position: { x: 1080, y: 415 } }, { anchorId: 'C01', label: '铜封门外', position: { x: 1250, y: 425 } }, { anchorId: 'C14', label: '公用工具架', position: { x: 315, y: 390 } }];
  p.mapCatalog = [{ ...p.scene, anchors: structuredClone(p.scene.anchors) }];
  let result = gaolaoGuidance(p, ready);
  assert.equal(result.next.action.kind, 'navigate');
  assert.deepEqual(result.next.action.position, { x: 1080, y: 415 });
  assert.match(result.next.title, /侧窗/);
  p.chapter.responsibilities = ['C', 'D', 'E'];
  result = gaolaoGuidance(p, ready);
  assert.deepEqual(result.next.action.position, { x: 315, y: 390 });
  assert.match(result.next.description, /借用|工具/);
  p.chapter.responsibilities = ['A'];
  p.observations = [{ observationRef: 'heard', category: 'Claim', statement: '本人已回应', sourceSeq: '12', fields: [], shareable: true, source: { sourceRef: 'opaque', kind: 'contact', label: '侧窗本人回应', beforeArrivalDays: 0, receivedSeq: '12' } }];
  result = gaolaoGuidance(p, ready);
  assert.deepEqual(result.next.action.position, { x: 1250, y: 425 });
  assert.doesNotMatch(result.next.title, /先联系/);
});

test('承力准备只复述实际人数与操作，提交不冒充开门或AI将会自动行动', () => {
  const p = chapter();
  p.observations = [{ fields: [{ key: 'seal', label: '实际问题', value: '铜封' }] }];
  p.cooperations = [{ operationId: 'gz-lock-support', phase: 'preparing', readyCount: 1, requiredCount: 2, operationVersion: '4', anchors: [{ x: 1210, y: 425 }, { x: 1290, y: 425 }] }];
  let result = gaolaoGuidance(p, ready);
  assert.match(result.next.description, /1\/2/);
  assert.equal(result.next.action.kind, 'objects');
  p.cooperations[0].phase = 'locked';
  result = gaolaoGuidance(p, ready);
  assert.match(result.next.description, /不代表门已打开|仍须.*实际行动/);
  assert.doesNotMatch(JSON.stringify(result), /悟空会自动|正在自动|门已打开/);
});

test('同用途历史请求已被新许可替代时，不把旧proposed再次当作本人待回应', () => {
  const p = chapter();
  p.chapter.consents = [
    { consentId: 'old', subjectRef: p.self.entityRef, requesterRef: 'partner', purpose: 'meeting', scope: {}, version: '1', status: 'proposed', sourceSeq: '4' },
    { consentId: 'current', subjectRef: p.self.entityRef, requesterRef: 'partner', purpose: 'meeting', scope: {}, version: '2', status: 'accepted', sourceSeq: '8' },
  ];
  assert.doesNotMatch(gaolaoGuidance(p, ready).next.title, /由你回应/);
  p.chapter.consents[1].status = 'deferred';
  assert.match(gaolaoGuidance(p, ready).next.title, /由你回应/);
});

function laterChapter() {
  const p = chapter();
  p.chapter.responsibilities = ['C'];
  p.mapCatalog = [{ ...p.scene, anchors: [{ anchorId: 'C14', label: '公用工具架', position: { x: 315, y: 390 } }, { anchorId: 'C15', label: '旧饭账', position: { x: 330, y: 620 } }, { anchorId: 'C19', label: '庄口', position: { x: 700, y: 710 } }, { anchorId: 'C11', label: '客房门口', position: { x: 800, y: 500 } }] }];
  p.targets = [{ entityRef: 'compare-ref', name: '公开会面点', sceneId: p.scene.sceneId, position: { x: 700, y: 710 }, resourceRevision: '2', fields: [], availableOperations: ['gz-compare-sources', 'gz-contact', 'gz-check-seal'] }];
  p.observations = [{ observationRef: 'seal', fields: [{ key: 'seal', label: '实际问题', value: '铜封' }] }];
  p.cooperations = [{ operationId: 'gz-lock-support', phase: 'locked', readyCount: 2, requiredCount: 2, operationVersion: '4', anchors: [{ x: 1210, y: 425 }, { x: 1290, y: 425 }] }];
  return p;
}
const sourceRecord = (kind, ref) => ({ observationRef: ref, fields: [], source: { kind, sourceRef: 'source-' + ref, label: '已获知的来源', beforeArrivalDays: 1, receivedSeq: '20' } });

test('仅获知compared后阶段且compare仍可重复提供时，下一步进入收尾而不退回救援或比较', () => {
  const p = laterChapter();
  p.chapter.progress = [{ key: 'compared', label: '来源比较、材料送达和真实会面已完成', value: true }];
  p.observations.push(sourceRecord('archive', 'ledger'), sourceRecord('testimony', 'witness'), sourceRecord('comparison', 'compared'));
  const result = gaolaoGuidance(p, ready);
  assert.match(result.goal, /去留|归还/);
  assert.match(result.next.title, /收尾/);
  assert.deepEqual(result.next.action.position, { x: 700, y: 710 });
  assert.doesNotMatch(result.next.title, /支撑|工具|铜封|联系|可比较/);
  p.chapter.progress.unshift({ key: 'safe', label: '本人已确认安置', value: true }, { key: 'open', label: '通路开放', value: true });
  assert.match(gaolaoGuidance(p, ready).next.title, /收尾/, '完整早期历史也不能使重复比较截断收尾');
});

test('仅获知safe时不补猜open失败；材料缺省先找来源，已获知比较结果后推进交付或会面', () => {
  const p = laterChapter();
  p.chapter.progress = [{ key: 'safe', label: '本人已确认安置', value: true }];
  let result = gaolaoGuidance(p, ready);
  assert.match(result.next.title, /饭账|材料/);
  assert.doesNotMatch(result.next.title, /铜封|支撑|开门|可比较/);
  p.observations.push(sourceRecord('archive', 'ledger'), sourceRecord('testimony', 'witness'));
  result = gaolaoGuidance(p, ready);
  assert.equal(result.next.action.kind, 'select');
  assert.equal(result.next.action.reference, 'compare-ref');
  p.observations.push(sourceRecord('comparison', 'compared'));
  result = gaolaoGuidance(p, ready);
  assert.match(result.next.title, /交付|会面/);
  assert.doesNotMatch(result.next.title, /可比较|支撑|工具/);
});

test('开门后只定位公开接应地点，缺公开目录时不从C08等规则锚点猜造路线', () => {
  const p = laterChapter();
  p.chapter.progress = [{ key: 'open', label: '通路开放', value: true }];
  p.scene.anchors = [{ anchorId: 'C08', label: '内室接人／安排', position: { x: 1400, y: 320 } }, { anchorId: 'C11', label: '客房门口', position: { x: 800, y: 500 } }];
  assert.deepEqual(gaolaoGuidance(p, ready).next.action.position, { x: 800, y: 500 });
  delete p.mapCatalog;
  const result = gaolaoGuidance(p, ready);
  assert.notEqual(result.next.action.kind, 'navigate');
  assert.doesNotMatch(JSON.stringify(result), /C08|内室接人/);
});
