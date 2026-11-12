/** 产品错误只使用公开错误码的固定措辞，不把校验路径或内部异常直接呈给玩家。 */
const labels: Record<string, string> = {
  UNAUTHENTICATED: '登录已失效，请返回大厅重新登录。', FORBIDDEN: '当前身份无法访问这间房间。', SESSION_GONE: '这间房间已不可访问。',
  UPGRADE_REQUIRED: '这间房间需要支持行走场景的客户端，请更新页面后重试。', CONTROL_HELD: '另一处连接正在控制此角色，需要时请明确接管。',
  RESYNC_REQUIRED: '正在重新同步当前视图。', OUTCOME_UNKNOWN: '结果尚未确认，请查询或原样重试。', INVALID_MESSAGE: '请求内容未通过检查，请同步后重新操作。',
  STALE_CONTROL: '控制权已变化，请恢复控制后再操作。', STALE_REFERENCE: '当前已无法操作这个对象，请查看最新场景。',
  STALE_MOVEMENT_COMMAND: '已有更新的行走或停步指令，本次旧指令未执行。', STALE_PRECONDITION: '物件或目标状态已变化，请查看最新情况。',
  PATH_UNREACHABLE: '当前无法走到这个位置，请选择可达的地面。', OUT_OF_RANGE: '距离还不够近，请走近以后操作。', OCCLUDED: '中间仍有遮挡，请先找到可以接近的路线。',
  TARGET_UNAVAILABLE: '当前无法对这个对象执行这项操作。', SESSION_PAUSED: '等待至少两位真人在线后继续。', SESSION_NOT_RUNNING: '当前阶段不能执行这项操作。',
  RULE_VIOLATION: '当前条件不满足这项操作。', NOT_READY: '所需准备尚未完成。', ACTION_ID_REUSE: '原动作身份与请求不一致，请先查询原结果。',
  CONSENT_REQUIRED: '这次用途或安排尚未取得本人的有效许可，请先征求本人意见。',
  CONSENT_STALE: '本次许可已经回应、撤回或改约，请查看最新安排后再操作。',
};
export const spatialErrorMessage = (code: string): string => labels[code] || '请求未完成，请同步当前场景后重试。';
