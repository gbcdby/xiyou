// 恢复入口的一次点击只属于当前连接代次；重新进入 connecting/online 后本人仍可再次点击。
export const RECOVERY_TAKE_MESSAGES = ['另一处连接正在控制此角色，需要时请明确接管。', '本地输入序号已丢失，请明确接管以建立新的控制周期。'];

export function nextRecoveryAction(state, latches, allowExplicitTake = false) {
  if (state.inputReady) return { kind: 'ready' };
  if (state.connection !== 'online') return { kind: 'reset' };
  if (!latches.clicked) return { kind: 'resume' };
  if (allowExplicitTake && !latches.explicitTakeClicked && !state.controlBusy && RECOVERY_TAKE_MESSAGES.includes(state.message))
    return { kind: 'take', reason: state.message };
  return { kind: 'wait' };
}
