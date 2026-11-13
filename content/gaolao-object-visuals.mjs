// 只供可信投影使用；公开键描述外表类别，不包含物主、内容或唯一实例身份。
const keys = Object.freeze({
  'gz-rope': 'hemp-rope',
  'gz-brace': 'timber-brace',
  'gz-parcel': 'cloth-parcel',
  'gz-letter': 'folded-letter',
  'gz-rake': 'farm-rake',
  'gz-door': 'timber-door',
  'gz-support': 'support-point',
  'gz-ledger': 'ledger-book',
  'gz-return': 'tool-return-point',
  'gz-window': 'side-window',
  'gz-meeting-C10': 'meeting-point',
  'gz-meeting-C19': 'meeting-point',
  'gz-meeting-R10': 'meeting-point',
});

export function gaolaoObjectVisual(state, id) {
  if (state.contentVersion !== 'gaolaozhuang-scene-v2' || state.reducerVersion !== 'gaolao-world-v1' || !Object.hasOwn(keys, id)) return {};
  return { visualKey: keys[id] };
}
