import { shallowRef, ref } from 'vue';
import type { Action, GuestIdentity } from '../domain/world.ts';
import { ActionJournal } from '../domain/action-journal.ts';
import { HttpApi } from '../network/http-api.ts';
import { SessionClient } from '../network/session-client.ts';
import type { SessionState } from '../network/session-client.ts';
import { connectSocket } from '../network/socket-link.ts';

const identityKey = 'xiyou.guest.v1';
function readIdentity(): GuestIdentity | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(identityKey) || 'null');
    return value && ['token', 'userId', 'name'].every(key => typeof value[key] === 'string' && value[key]) ? { token: value.token, userId: value.userId, name: value.name } : null;
  } catch { return null; }
}
export const identity = shallowRef<GuestIdentity | null>(readIdentity());
export const localNotice = ref('');
export const storageNotice = ref('');
export const sessionState = shallowRef<SessionState>({ connection: 'idle', snapshot: null, actions: [], message: '', controlBusy: false });
export const api = new HttpApi(() => identity.value?.token || null);
let journal: ActionJournal | null = null;
try { journal = new ActionJournal(sessionStorage); } catch { /* 浏览器禁用存储时仍可保持当前页内请求。 */ }
let currentSession = '';
let opening = false;
export const sessionClient = new SessionClient(api, connectSocket, {
  onChange(state) {
    sessionState.value = state;
    if (!opening && currentSession && identity.value) {
      const saved = journal?.save(identity.value.userId, currentSession, state.actions) ?? false;
      storageNotice.value = saved ? '' : '此浏览器暂时无法保存待确认动作。请保留当前页面，先确认结果再刷新。';
    }
  },
});

export async function signIn(name: string): Promise<void> {
  const guest = await api.guest(name.trim());
  identity.value = guest;
  try { sessionStorage.setItem(identityKey, JSON.stringify(guest)); } catch { storageNotice.value = '登录仅在当前页面有效；浏览器未允许保存。'; }
}
export function enterSession(sessionId: string) {
  if (!identity.value) return;
  opening = true;
  const drafts = journal?.load(identity.value.userId, sessionId) || [];
  sessionClient.open(sessionId, identity.value.token, drafts);
  currentSession = sessionId; opening = false; localNotice.value = '';
}
export function leaveSession() { sessionClient.close(); currentSession = ''; localNotice.value = ''; }
export async function sendAction(action: Action) {
  localNotice.value = '';
  try { await sessionClient.send(action); }
  catch (error) { localNotice.value = error instanceof Error ? error.message : '动作尚未提交。'; }
}
