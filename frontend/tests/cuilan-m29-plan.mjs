import assert from 'node:assert/strict';

export const workId = 'CS-T04-M29-PREP-20261114';
export const productionProfile = 'production-cuilan-v1';
export const longCaseId = 'M29-5-PUBLIC-E02';
export const minimumLongMs = 900000;
export const maximumLongRounds = 80;
export const activityWindowMs = 60000;
export const participantWindowMs = 300000;

const variants = {
  public: { contentVersion: 'gaolaozhuang-scene-v3', destinationId: 'front-guest-room', defaultEntry: true },
  disguise: { contentVersion: 'gaolaozhuang-tools-east-scene-v3', destinationId: 'tea-back-room', defaultEntry: false },
};
const rows = [];
for (const count of [2, 5]) for (const route of ['public', 'disguise']) for (const ending of ['GZ-E01', 'GZ-E02']) {
  const id = 'M29-' + count + '-' + route.toUpperCase() + '-' + ending.slice(3);
  rows.push({ id, count, route, ending, ...variants[route], long: id === longCaseId, competition: id === longCaseId });
}
rows.push({ id: 'M29-3-PUBLIC-E01', count: 3, route: 'public', ending: 'GZ-E01', ...variants.public, long: false, competition: true });
rows.push({ id: 'M29-4-DISGUISE-E02', count: 4, route: 'disguise', ending: 'GZ-E02', ...variants.disguise, long: false, competition: true });
export const cases = Object.freeze(rows.map(row => Object.freeze(row)));
export const shortCaseIds = Object.freeze(cases.filter(row => !row.long).map(row => row.id));

export function chooseCase(argv) {
  if (argv.length === 1 && argv[0] === '--list') return null;
  assert.equal(argv.length, 3, '只接受 --execute --case <已登记场次>；--list 仅列计划。');
  assert.equal(argv[0], '--execute'); assert.equal(argv[1], '--case');
  const row = cases.find(row => row.id === argv[2]); assert.ok(row, '未知场次，不静默回退或扩大矩阵。');
  return row;
}

export function executionInputs(environment) {
  assert.match(environment.M29_EXPECTED_TREE || '', /^[0-9a-f]{40}$/, '执行必须明确固定本次实际 tree。');
  assert.ok(environment.M29_RELEASE_REF && !/NOT_RELEASED|待释放|TODO/i.test(environment.M29_RELEASE_REF), '只在 root 实际释放 V2 后登记真实 release 引用；参数本身不是授权凭证。');
  return { expectedTree: environment.M29_EXPECTED_TREE, releaseRef: environment.M29_RELEASE_REF };
}

/** 连续范围来自真实 Socket 请求和对应 ACK，不使用脚本启动时刻或最后空等。 */
export function activityAssessment({ requestFrames, receiptFrames, actions, startActionId, endActionId, count }) {
  const first = requestFrames.find(row => row.request.clientActionId === startActionId);
  const last = receiptFrames.find(row => row.receipt.clientActionId === endActionId);
  assert.ok(first && last, '实际请求起点和实际回执终点必须存在。');
  const start = first.monotonicMs, end = last.monotonicMs;
  const meaningful = actions.filter(row => row.receipt.status === 'Accepted' && row.receipt.actionEventRange !== null
    && !['move_to', 'speak', 'inspect'].includes(row.request.action.kind)).map(row => {
      const sent = requestFrames.find(frame => frame.request.clientActionId === row.request.clientActionId);
      const received = receiptFrames.find(frame => frame.receipt.clientActionId === row.request.clientActionId);
      return sent && received ? { player: row.player, actionId: row.request.clientActionId, at: received.monotonicMs, kind: row.request.action.kind } : null;
    }).filter(row => row && row.at >= start && row.at <= end);
  assert.ok(end - start >= minimumLongMs, '不足900秒不得空等补齐。');
  assert.equal(new Set(meaningful.map(row => row.player)).size, count, '五端都有真实有世界效果的非移动、非聊天操作。');
  const windows = [];
  for (let at = start; at + activityWindowMs <= end; at += activityWindowMs) {
    const hits = meaningful.filter(row => row.at >= at && row.at < at + activityWindowMs);
    assert.ok(hits.length, '一个完整60秒窗口没有有效操作，不能以心跳或空等计连续操作。');
    windows.push({ fromMonotonicMs: at, toMonotonicMs: at + activityWindowMs, actionIds: hits.map(row => row.actionId) });
  }
  const participantWindows = [];
  for (let at = start; at + participantWindowMs <= end; at += participantWindowMs) {
    const hits = meaningful.filter(row => row.at >= at && row.at < at + participantWindowMs);
    const participants = [...new Set(hits.map(row => row.player))].sort((a, b) => a - b);
    assert.equal(participants.length, count, '每个完整五分钟窗口均有五个实际操作者，不能仅保持空连接。');
    participantWindows.push({ fromMonotonicMs: at, toMonotonicMs: at + participantWindowMs, players: participants });
  }
  return { startActionId, endActionId, startedAt: first.at, finishedAt: last.at, durationMs: end - start,
    startMonotonicMs: start, endMonotonicMs: end, meaningfulActions: meaningful.length, windows, participantWindows };
}
