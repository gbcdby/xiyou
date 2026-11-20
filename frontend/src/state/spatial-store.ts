import { ref, shallowRef } from 'vue';
import { api, identity, invalidateIdentity } from './app-store.ts';
import { SpatialSessionClient } from '../network/spatial-session.ts';
import type { SpatialDraft, SpatialState } from '../network/spatial-session.ts';
import { connectSpatialSocket } from '../network/socket-link.ts';
import { createSpatialSnapshotSource } from '../domain/spatial-snapshot-source.ts';

export const spatialState = shallowRef<SpatialState>({ connection: 'idle', snapshot: null, actions: [], message: '', controlBusy: false, inputReady: false, directionInput: { ready: false, blocker: 'connection' }, queuedAction: null, navigation: null });
export const spatialNotice = ref('');
export const spatialStorageNotice = ref('');
const snapshotChannel = createSpatialSnapshotSource();
export const spatialSnapshots = snapshotChannel.source;
let currentKey = ''; let opening = false;
export const spatialClient = new SpatialSessionClient({ receipt: (sessionId, id) => api.spatialReceipt(sessionId, id) },
  (token, handlers) => connectSpatialSocket(token, handlers, undefined, { directionHandoff: true, timedTrail: true }), {
  waitForVisualArrival: true,
  onUnauthenticated: invalidateIdentity,
  onChange(state) {
    // 在Vue父render可能合并props之前，逐条交给已挂载的timed显示owner。
    snapshotChannel.publish(state.connection === 'online' && state.timedTrail ? state.snapshot : null);
    spatialState.value = state;
    if (!currentKey || opening) return;
    try { sessionStorage.setItem(currentKey, JSON.stringify(state.actions)); spatialStorageNotice.value = ''; }
    catch { spatialStorageNotice.value = '浏览器未允许保存待确认动作，请先确认结果再刷新页面。'; }
  },
});
export function enterSpatialSession(sessionId: string) {
  if (!identity.value) return;
  opening = true; currentKey = `xiyou.spatial-actions.v2:${identity.value.userId}:${sessionId}`;
  let drafts: SpatialDraft[] = [];
  try { const parsed = JSON.parse(sessionStorage.getItem(currentKey) || '[]'); if (Array.isArray(parsed)) drafts = parsed; } catch { /* 无有效缓存时使用新输入源。 */ }
  spatialClient.open(sessionId, identity.value.token, drafts); opening = false; spatialNotice.value = '';
}
export function leaveSpatialSession() { spatialClient.close(); currentKey = ''; spatialNotice.value = ''; }
export async function performSpatial(action: () => Promise<unknown>) {
  spatialNotice.value = '';
  try { await action(); } catch (error) { spatialNotice.value = error instanceof Error ? error.message : '操作尚未提交。'; }
}
