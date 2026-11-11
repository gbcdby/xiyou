/** 测试经真实公开入口创建房间，不直接写入世界状态。 */
export async function createRunningRoom(runtime, count = 2) {
  const users = [];
  for (let index = 0; index < count; index++) users.push(await runtime.guest({ name: `协作玩家${index + 1}` }));
  const { sessionId } = await runtime.create(users[0].token, { nonce: crypto.randomUUID(), contentVersion: 'trust-repair-fixture-v1' });
  const actors = [];
  for (const user of users) actors.push((await runtime.join(user.token, sessionId, { nonce: crypto.randomUUID() })).actorId);
  await runtime.start(users[0].token, sessionId, { nonce: 'start' });
  const connections = []; const epochs = [];
  for (let index = 0; index < count; index++) {
    const handle = await runtime.openConnection(users[index].token);
    const control = await runtime.control(handle, controlRaw(sessionId, actors[index]));
    connections.push(handle); epochs.push(control.controlEpoch);
  }
  return { sessionId, users, actors, connections, epochs };
}

export function controlRaw(sessionId, actorId, type = 'control.resume') {
  return JSON.stringify({ schemaVersion: 1, type, sessionId, actorId, nonce: crypto.randomUUID() });
}

export function actionRaw(room, index, action, overrides = {}) {
  return JSON.stringify({ schemaVersion: 1, sessionId: room.sessionId, actorId: room.actors[index], clientActionId: crypto.randomUUID(), controlEpoch: room.epochs[index], baseSeq: '0', action, ...overrides });
}

export function deferred() {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** 只为测试等待明确事件；超时给出失败，不把时序概率当成功。 */
export async function until(predicate, message, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
