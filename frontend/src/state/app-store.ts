import { shallowRef, ref } from 'vue';
import type { Action, GuestIdentity } from '../domain/world.ts';
import { ActionJournal } from '../domain/action-journal.ts';
import { HttpApi } from '../network/http-api.ts';
import { SessionClient } from '../network/session-client.ts';
import type { SessionState } from '../network/session-client.ts';
import type { ConnectLink } from '../network/link.ts';
import { connectSocket } from '../network/socket-link.ts';

const identityKey = 'xiyou.guest.v1';
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
interface AppStoreOptions { storage?: StoragePort | null; fetcher?: typeof fetch; connectLink?: ConnectLink }
function browserStorage(): StoragePort | null {
  try { return sessionStorage; } catch { return null; }
}
function readIdentity(storage: StoragePort | null): GuestIdentity | null {
  try {
    const value = JSON.parse(storage?.getItem(identityKey) || 'null');
    return value && ['token', 'userId', 'name'].every(key => typeof value[key] === 'string' && value[key]) ? { token: value.token, userId: value.userId, name: value.name } : null;
  } catch { return null; }
}

/** 身份和缓存由本层拥有；传输层只报告被拒绝的原 token。依赖可替换以隔离检查宿主边界。 */
export function createAppStore(options: AppStoreOptions = {}) {
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const identity = shallowRef<GuestIdentity | null>(readIdentity(storage));
  const localNotice = ref(''); const authNotice = ref(''); const storageNotice = ref('');
  const sessionState = shallowRef<SessionState>({ connection: 'idle', snapshot: null, actions: [], message: '', controlBusy: false });
  const api = new HttpApi(() => identity.value?.token || null, options.fetcher || fetch, invalidateIdentity);
  const journal = storage ? new ActionJournal(storage) : null;
  let currentSession = '';
  let opening = false;
  const sessionClient = new SessionClient(api, options.connectLink || connectSocket, {
    onUnauthenticated: invalidateIdentity,
    onChange(state) {
      sessionState.value = state;
      if (!opening && currentSession && identity.value) {
        const saved = journal?.save(identity.value.userId, currentSession, state.actions) ?? false;
        storageNotice.value = saved ? '' : '此浏览器暂时无法保存待确认动作。请保留当前页面，先确认结果再刷新。';
      }
    },
  });

  function invalidateIdentity(token: string) {
    // 迟到的旧身份请求不能清除之后已登录的新身份。
    if (!identity.value || identity.value.token !== token) return;
    sessionClient.close(); currentSession = '';
    identity.value = null; localNotice.value = '';
    authNotice.value = '登录已失效，请重新以访客身份登录。新访客不能取回原身份的房间成员资格或待确认动作。';
    try { storage?.removeItem(identityKey); }
    catch { storageNotice.value = '浏览器未允许清除失效登录缓存，请关闭当前标签页后重新进入。'; }
  }
  async function signIn(name: string): Promise<void> {
    const guest = await api.guest(name.trim());
    identity.value = guest; authNotice.value = '';
    try {
      if (!storage) throw new Error('浏览器未允许保存。');
      storage.setItem(identityKey, JSON.stringify(guest));
    } catch { storageNotice.value = '登录仅在当前页面有效；浏览器未允许保存。'; }
  }
  function enterSession(sessionId: string) {
    if (!identity.value) return;
    opening = true;
    const drafts = journal?.load(identity.value.userId, sessionId) || [];
    sessionClient.open(sessionId, identity.value.token, drafts);
    currentSession = sessionId; opening = false; localNotice.value = '';
  }
  function leaveSession() { sessionClient.close(); currentSession = ''; localNotice.value = ''; }
  async function sendAction(action: Action) {
    localNotice.value = '';
    try { await sessionClient.send(action); }
    catch (error) { localNotice.value = error instanceof Error ? error.message : '动作尚未提交。'; }
  }
  return { identity, localNotice, authNotice, storageNotice, sessionState, api, sessionClient, signIn, enterSession, leaveSession, sendAction };
}

export const { identity, localNotice, authNotice, storageNotice, sessionState, api, sessionClient, signIn, enterSession, leaveSession, sendAction } = createAppStore();
