import assert from 'node:assert/strict';
import test from 'node:test';
import { nextRecoveryAction, RECOVERY_TAKE_MESSAGES } from './cuilan-self-response-recovery.mjs';

const online = (message = '', controlBusy = false) => ({ connection: 'online', inputReady: false, message, controlBusy });
const latches = () => ({ clicked: false, explicitTakeClicked: false });

/** 模拟一次 until 轮询：按决策更新闩锁并收集本轮真实控件点击。 */
function drive(states, { allowExplicitTake = false } = {}) {
  const memory = latches(), clicks = [];
  for (const state of states) {
    const action = nextRecoveryAction(state, memory, allowExplicitTake);
    if (action.kind === 'reset') { memory.clicked = false; memory.explicitTakeClicked = false; continue; }
    if (action.kind === 'resume') { memory.clicked = true; clicks.push('resume'); continue; }
    if (action.kind === 'take') { memory.explicitTakeClicked = true; clicks.push('take'); continue; }
    if (action.kind === 'ready') break;
  }
  return clicks;
}

test('普通重连只在当前 online 代次点击一次恢复入口', () => {
  assert.deepEqual(drive([online(), online(), online()]), ['resume']);
});

test('control.resume 发出后连接代次回退再上线，本人可再次点击恢复入口', () => {
  // 对应 run 43879506145：两条 packetId=2 的 control.resume 只有 sent，
  // 超时时页面 connection=connecting/inputReady=false；旧的一次性 clicked 闩锁吞掉第二次点击。
  const states = [
    { connection: 'connecting', inputReady: false, message: '', controlBusy: false },
    online(), online(),
    { connection: 'connecting', inputReady: false, message: '', controlBusy: false },
    online(), online(),
    { connection: 'online', inputReady: true, message: '已恢复本人控制。', controlBusy: false },
  ];
  assert.deepEqual(drive(states), ['resume', 'resume']);
});

test('重启路径在 CONTROL_HELD 后点击明确接管，且不在等待中重复点击', () => {
  const states = [
    online(), online(RECOVERY_TAKE_MESSAGES[0]), online(RECOVERY_TAKE_MESSAGES[0]),
    { ...online(RECOVERY_TAKE_MESSAGES[0]), controlBusy: true },
    online('控制结果待确认，再次点击会重试原请求。'),
    { ...online(), inputReady: true },
  ];
  assert.deepEqual(drive(states, { allowExplicitTake: true }), ['resume', 'take']);
  assert.deepEqual(drive(states), ['resume'], '非重启路径不得借错误消息越权明确接管');
});

test('只有权威 inputReady 才结束恢复等待', () => {
  const memory = latches();
  assert.equal(nextRecoveryAction({ connection: 'online', inputReady: false, message: '', controlBusy: false }, memory, true).kind, 'resume');
  memory.clicked = true;
  assert.equal(nextRecoveryAction(online('另一处连接正在控制此角色，需要时请明确接管。'), memory, false).kind, 'wait');
  assert.equal(nextRecoveryAction(online('已恢复本人控制。'), memory, true).kind, 'wait');
  assert.equal(nextRecoveryAction({ ...online('已恢复本人控制。'), inputReady: true }, memory, true).kind, 'ready');
});
