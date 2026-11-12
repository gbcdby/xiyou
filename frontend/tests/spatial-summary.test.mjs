import test from 'node:test';
import assert from 'node:assert/strict';
import { spatialSummary } from '../src/domain/spatial-summary.ts';
import { spatialSnapshot } from './spatial-fixture.mjs';

function chapter() {
  const p = spatialSnapshot().projection;
  p.reducerVersion = 'gaolao-world-v1';
  p.objectives = [{ objectiveId: 'initial', label: '先联系受困者，再准备安全开门。', status: 'active' }];
  p.chapter = { chapterId: 'gaolaozhuang', responsibilities: ['A'], progress: [], consents: [], follows: [], decisions: [], destinations: [], endProposal: null, publicItems: [] };
  return p;
}

test('A2 从初始目标转为当前授权救援及等待本人决定的进展，不重放初始开门任务', () => {
  const p = chapter(); assert.equal(spatialSummary(p).title, p.objectives[0].label);
  for (const [key, label] of [['open', '铜封解除，后宅通路开放。'], ['safe', '真实本人已到达并确认安置；自由出口保持开放。'], ['compared', '来源比较、材料送达和真实会面已完成；去留仍由双方本人决定。']]) {
    p.chapter.progress.push({ key, label, value: true });
    assert.deepEqual(spatialSummary(p), { caption: '已知进展', title: label });
    assert.deepEqual(spatialSummary(structuredClone(p)), spatialSummary(p), '刷新取得同一授权事实时摘要不回到旧目标');
  }
});

test('三类授权终态优先显示真实结局，撤权清空且新房间不继承旧进展', () => {
  const p = chapter(); p.chapter.progress = [{ key: 'safe', label: '本人已确认安置', value: true }]; p.phase = 'Finished';
  for (const [endingCode, title] of [['GZ-E01', '自愿同行'], ['GZ-E02', '各走各路'], ['GZ-E03', '暂告一段']]) {
    p.ending = { endingCode, title, summary: '当前授权结果。', facts: [] };
    assert.deepEqual(spatialSummary(p), { caption: '这一程的结果', title });
  }
  assert.equal(spatialSummary(null), null);
  assert.equal(spatialSummary(chapter()).caption, '眼下事项');
});

test('否定或尚无的进展不显示为完成；A1 继续按已授权目标优先级显示', () => {
  const p = chapter(); p.chapter.progress = [{ key: 'safe', label: '本人确认安置', value: false }];
  assert.equal(spatialSummary(p).title, '本人确认安置：未满足');
  p.chapter.progress[0].value = null; assert.equal(spatialSummary(p).title, '本人确认安置：尚无');
  p.reducerVersion = 'spatial-world-v2';
  assert.equal(spatialSummary(p).title, p.objectives[0].label);
  p.objectives.unshift({ objectiveId: 'blocked', label: '另一阻挡事项', status: 'blocked' });
  assert.equal(spatialSummary(p).title, p.objectives[1].label);
});
