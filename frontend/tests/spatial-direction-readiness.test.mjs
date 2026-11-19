import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { computed, ref, shallowRef } from 'vue';
import ts from 'typescript';
import { SpatialSessionClient } from '../src/network/spatial-session.ts';
import { spatialSnapshot, spatialBatch, selfRef } from './spatial-fixture.mjs';
import { validateSpatial } from '../../protocol/spatial.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { await flush(); await flush(); };
const pendingMessage = '上一项移动或停步结果尚未确认，请先查询或原样重试。';
const ready = { ready: true, blocker: null };
const blocked = blocker => ({ ready: false, blocker });

function accepted(request) {
  const sequence = request.action.movementCommandSeq;
  return { schemaVersion: 2, sessionId: request.sessionId, clientActionId: request.clientActionId,
    status: 'Accepted', code: 'OK', observedSeq: '10', actionEventRange: null,
    result: ['move_to', 'move_direction'].includes(request.action.kind)
      ? { movementId: 'move_0000000000000000000000000000001', planVersion: sequence, movementCommandSeq: sequence, status: 'accepted' }
      : request.action.kind === 'stop_move' ? { status: 'cancelled', movementCommandSeq: sequence } : { status: 'cancelled' } };
}
function saved(kind, index = 0) {
  const sequence = String(index + 1), id = 'rdy-original-' + index;
  const action = kind === 'move_to' ? { kind, movementCommandSeq: sequence, sceneId: 'yard', destination: { x: 136, y: 100 } }
    : kind === 'move_direction' ? { kind, movementCommandSeq: sequence, sceneId: 'yard', mapVersion: 'gray-map-v1', direction: 'E' }
      : kind === 'stop_move' ? { kind, movementCommandSeq: sequence } : { kind };
  const request = { schemaVersion: 2, sessionId: 'spatial-room', viewId: 'spatial-view-1',
    actorRef: selfRef, clientActionId: id, controlEpoch: '2', baseSeq: '10', action };
  return { id, raw: JSON.stringify(request), status: 'accepted', detail: '刷新前已确认，缓存不能代替原收据', receipt: accepted(request) };
}
async function room(t, { drafts = [], direction = true, control = true } = {}) {
  let handlers, nextId = 0, count = 0, peak = 0;
  const queries = [], pendingQueries = new Map(), known = new Map(), wires = [], requests = [], pendingActions = [];
  const actionReplies = [], queryReplies = [];
  const initial = spatialSnapshot(); initial.projection.self.canControl = false;
  const link = { connected: true,
    acceptedCapabilities: ['spatial-v2', ...(direction ? ['spatial-direction-v1', 'spatial-timed-trail-v1'] : [])],
    close() { this.connected = false; }, async request(event, raw, consume) {
      const request = typeof raw === 'string' ? JSON.parse(raw) : raw; requests.push({ event, request });
      let value;
      if (event === 'session.subscribe') value = structuredClone(initial);
      else if (event === 'sync.request') value = { schemaVersion: 2, type: 'world.batch', sessionId: request.sessionId,
        viewId: request.viewId, fromExclusive: request.cursor, throughSeq: request.cursor, events: [] };
      else if (event.startsWith('control.')) {
        const snapshot = spatialSnapshot(); snapshot.viewId = 'rdy-control-view'; snapshot.projection.self.controlEpoch = '4';
        value = { schemaVersion: 2, sessionId: request.sessionId, nonce: request.nonce, controlEpoch: '4', observedSeq: '10', snapshot };
      } else {
        assert.equal(event, 'player.action.request'); wires.push({ raw, request });
        value = actionReplies.length ? await actionReplies.shift()(request) : accepted(request);
      }
      consume?.(value); return value;
    } };
  const client = new SpatialSessionClient({ async receipt(sessionId, id) {
    queries.push({ sessionId, id }); count++; peak = Math.max(peak, count);
    try {
      if (queryReplies.length) return await queryReplies.shift()(id);
      if (known.has(id)) return known.get(id);
      return await new Promise(resolve => pendingQueries.set(id, resolve));
    } finally { count--; }
  } }, (_token, value) => { handlers = value; return link; }, {
    heartbeatMs: 0, reconnectDelayMs: 0, id: () => 'rdy-new-' + ++nextId,
  });
  t.after(() => {
    client.close();
    for (const resolve of pendingQueries.values()) resolve(null);
    for (const resolve of pendingActions) resolve();
  });
  client.open(initial.sessionId, 'controlled-token', structuredClone(drafts)); handlers.connected(); await settle();
  if (control) { await client.control('resume'); await settle(); }
  return { client, link, queries, wires, requests, known, pendingQueries, actionReplies, queryReplies,
    get handlers() { return handlers; }, get peak() { return peak; },
    resolveQueries(value = id => drafts.find(draft => draft.id === id)?.receipt ?? null) {
      for (const [id, resolve] of [...pendingQueries]) { pendingQueries.delete(id); resolve(value(id)); }
    },
    holdAction() {
      let release; actionReplies.push(request => new Promise(resolve => {
        release = () => resolve(accepted(request)); pendingActions.push(release);
      }));
      return () => { assert.ok(release); release(); };
    },
    push(change) {
      const snapshot = structuredClone(client.state.snapshot); change(snapshot.projection);
      validateSpatial('SnapshotV2', snapshot);
      handlers.batch(spatialBatch(snapshot, String(BigInt(snapshot.snapshotSeq) + 1n)));
    },
  };
}

test('RDY-01/03：控制先完成而移动历史仍待查；原Receipt收束后只接受新的明确方向', async t => {
  for (const kind of ['move_to', 'move_direction', 'stop_move']) await t.test(kind, async t => {
    const draft = saved(kind), h = await room(t, { drafts: [draft], control: false });
    assert.deepEqual(h.client.state.directionInput, blocked('control'));
    assert.equal(h.client.state.actions[0].status, 'unknown'); assert.equal(h.client.state.actions[0].receipt, null);
    await h.client.control('resume'); await settle();
    assert.equal(h.client.state.inputReady, true, '原控制恢复不等待历史收据');
    assert.deepEqual(h.client.state.directionInput, blocked('movement'));
    h.client.setDirection({ x: 1, y: 0 }); h.client.setDirection(null); await settle();
    assert.equal(h.wires.length, 0); assert.equal(h.client.state.message, pendingMessage);
    h.resolveQueries(() => null); await settle();
    assert.deepEqual(h.client.state.directionInput, blocked('movement'), 'null不能补造旧结果');
    h.known.set(draft.id, draft.receipt); await h.client.query(draft.id); await settle();
    assert.deepEqual(h.client.state.directionInput, ready);
    assert.equal(h.client.state.message, '', '自身过期方向阻塞提示随原结果收束消失');
    assert.equal(h.wires.length, 0, '查询不复活先前被拒绝的持键');
    assert.equal(h.client.state.actions[0].raw, draft.raw);
    assert.deepEqual(h.client.state.actions[0].receipt, draft.receipt);
    h.client.setDirection({ x: 1, y: 0 }); h.client.setDirection(null); await settle();
    assert.deepEqual(h.wires.map(w => [w.request.action.kind, w.request.controlEpoch, w.request.action.movementCommandSeq]),
      [['move_direction', '4', '1'], ['stop_move', '4', '2']]);
    assert.deepEqual(h.client.state.actions.slice(1).map(a => a.status), ['accepted', 'accepted']);
  });
});


test('RDY-01：四条非移动Unknown不阻塞控制或方向，原收据仍按三并发逐个恢复', async t => {
  const drafts = Array.from({ length: 4 }, (_, i) => saved('wait', i)), h = await room(t, { drafts });
  assert.equal(h.client.state.inputReady, true); assert.deepEqual(h.client.state.directionInput, ready);
  assert.equal(h.queries.length, 3); assert.equal(h.peak, 3);
  assert.equal(h.client.state.actions.filter(a => a.status === 'unknown').length, 4);
  assert.equal(await reloadPredicate()(h.client.state), true, '新等待点不能变成等待所有非移动历史');
  h.client.setDirection({ x: 1, y: 0 }); h.client.setDirection(null); await settle();
  assert.deepEqual(h.wires.map(w => w.request.action.kind), ['move_direction', 'stop_move']);
  h.resolveQueries(); await settle(); h.resolveQueries(); await settle();
  assert.deepEqual(h.queries.map(q => q.id), drafts.map(d => d.id)); assert.equal(h.peak, 3);
  assert.deepEqual(h.client.state.actions.slice(0, 4).map(a => [a.raw, a.receipt]), drafts.map(d => [d.raw, d.receipt]));
});

test('RDY-02：来源/阶段/连接守卫共用原判定；暂停和兼容仍由原后续路径负责', async t => {
  for (const direction of [true, false]) await t.test(direction ? '双能力' : '兼容', async t => {
    const h = await room(t, { direction });
    assert.deepEqual(h.client.state.directionInput, ready);
    const detached = h.client.state.directionInput; detached.ready = false;
    assert.deepEqual(h.client.state.directionInput, ready, '观察对象不能写回原资格');
    const requestCount = h.requests.length;
    for (let i = 0; i < 4; i++) assert.deepEqual(h.client.state.directionInput, ready);
    assert.equal(h.requests.length, requestCount, '读取不触发控制、查询、补读或世界动作');
    h.push(p => { p.paused = true; });
    assert.deepEqual(h.client.state.directionInput, ready, '原方向准入不等于Page的未暂停或服务端Accepted');
    // 仅核公开DTO的非Running守卫；终态本身按协议必先撤销canControl。
    h.push(p => { p.paused = false; p.phase = 'Lobby'; });
    assert.equal(h.client.state.snapshot.projection.phase, 'Lobby');
    assert.deepEqual(h.client.state.directionInput, blocked('phase'));
    h.client.setDirection({ x: 1, y: 0 }); assert.equal(h.wires.length, 0); assert.match(h.client.state.message, /当前阶段/);
    h.push(p => { p.phase = 'Running'; p.self.controlEpoch = '5'; });
    assert.deepEqual(h.client.state.directionInput, blocked('control'));
    h.client.setDirection({ x: 1, y: 0 }); assert.equal(h.wires.length, 0); assert.match(h.client.state.message, /恢复本人控制/);
    h.handlers.disconnected(); assert.deepEqual(h.client.state.directionInput, blocked('connection'));
    assert.equal(h.client.state.inputReady, false);
  });
});

test('RDY-02：两方向满槽仍可接受最新意图，停步保持独立而不新增第三方向', async t => {
  const h = await room(t), first = h.holdAction(), second = h.holdAction();
  h.client.setDirection({ x: 1, y: 0 }); h.client.setDirection({ x: 0, y: 1 }); await settle();
  assert.equal(h.wires.length, 2); assert.deepEqual(h.client.state.directionInput, ready);
  h.client.setDirection({ x: -1, y: 0 }); await settle();
  assert.equal(h.wires.length, 2, '只读ready不绕过原两槽容量');
  h.client.setDirection(null); await settle();
  assert.deepEqual(h.wires.map(w => w.request.action.kind), ['move_direction', 'move_direction', 'stop_move']);
  assert.equal(h.wires.at(-1).request.action.movementCommandSeq, '3');
  first(); second(); await settle();
  assert.equal(h.wires.length, 3, '旧ACK不复活松开的方向');
});

test('RDY-02：waiting stop保留原可恢复意图例外，明确stop的未决仍阻挡新方向', async t => {
  for (const direction of [true, false]) await t.test(direction ? '新方向' : '兼容', async t => {
    const h = await room(t, { direction });
    h.client.setDirection({ x: 1, y: 0 }); await settle();
    const release = h.holdAction(); h.client.setDirection(null); await settle();
    assert.equal(h.client.state.actions.at(-1).status, 'waiting');
    assert.deepEqual(h.client.state.directionInput, ready, '正常松键stop原本允许合并最新意图');
    release(); await settle();
    const explicit = h.holdAction(), stopping = h.client.stop(); await settle();
    assert.equal(h.client.state.actions.at(-1).status, 'waiting');
    assert.deepEqual(h.client.state.directionInput, blocked('movement'));
    const count = h.wires.length; h.client.setDirection({ x: 0, y: 1 }); assert.equal(h.wires.length, count);
    explicit(); await stopping; await settle();
    assert.deepEqual(h.client.state.directionInput, ready);
    assert.equal(h.wires.length, count, '明确stop完成不重放被拒绝的输入');
  });
});

test('RDY-02/04：非法raw只读fail-closed，实际准入严格拒绝；不同错误不随资格恢复而清空', async t => {
  const h = await room(t); await h.client.send({ kind: 'wait' });
  const draft = h.client.state.actions[0], raw = draft.raw, count = h.wires.length;
  draft.raw = raw.replace('"schemaVersion":2', '"schemaVersion":2,"schemaVersion":2');
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(h.client.state.directionInput, blocked('invalid-draft'));
    h.client.setDirection({ x: 1, y: 0 }); assert.equal(h.wires.length, count, '状态查询没有放宽原严格校验');
  }
  const error = h.client.state.message; assert.ok(error); assert.notEqual(error, pendingMessage);
  draft.raw = raw;
  assert.deepEqual(h.client.state.directionInput, ready); assert.equal(h.client.state.message, error, '只过滤自己精确的过期movement原因');
});

test('RDY-03：查询错误保原Unknown，当前撤权立即清资格且不吞原访问错误', async t => {
  const draft = saved('move_direction'), h = await room(t, { drafts: [draft] });
  h.resolveQueries(() => null); await settle();
  h.queryReplies.push(() => { throw new Error('查询暂不可用'); }); await h.client.query(draft.id);
  assert.deepEqual(h.client.state.directionInput, blocked('movement'));
  assert.equal(h.client.state.actions[0].raw, draft.raw); assert.equal(h.client.state.actions[0].status, 'unknown');
  h.client.setDirection({ x: 1, y: 0 }); assert.equal(h.wires.length, 0);
  h.handlers.failed({ schemaVersion: 2, code: 'FORBIDDEN', message: '撤权' });
  assert.equal(h.client.state.connection, 'forbidden'); assert.equal(h.client.state.snapshot, null);
  assert.deepEqual(h.client.state.directionInput, blocked('connection'));
  assert.ok(h.client.state.message); assert.notEqual(h.client.state.message, pendingMessage);
});

test('RDY-04：旧movement提示消失后，新真实Unknown可再次表达当前阻塞', async t => {
  const draft = saved('move_to'), h = await room(t, { drafts: [draft] });
  h.client.setDirection({ x: 1, y: 0 }); assert.equal(h.client.state.message, pendingMessage);
  h.resolveQueries(); await settle(); assert.equal(h.client.state.message, '');
  h.actionReplies.push(() => { throw new Error('新方向ACK丢失'); });
  h.client.setDirection({ x: 1, y: 0 }); await settle();
  assert.deepEqual(h.client.state.directionInput, blocked('movement'));
  const count = h.wires.length; h.client.setDirection({ x: 0, y: 1 });
  assert.equal(h.wires.length, count); assert.equal(h.client.state.message, pendingMessage);
});



// 只执行真实Page的状态计算；没有挂载页面、DOM、HTTP或浏览器。
const pageSource = await readFile(new URL('../src/features/session/SpatialSessionPage.vue', import.meta.url), 'utf8');
function pageStatus(state, hudValue) {
  const script = pageSource.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1]; assert.ok(script);
  const parsed = ts.createSourceFile('SpatialSessionPage.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = ['canAct', 'canStop', 'directionNotice', 'visibleNetworkMessage', 'currentNotice', 'currentStatus'];
  const declarations = parsed.statements.filter(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(d => ts.isIdentifier(d.name) && names.includes(d.name.text)));
  assert.ok(declarations.some(node => node.getText(parsed).includes('const currentStatus =')));
  const code = ts.transpileModule(declarations.map(node => node.getText(parsed)).join('\n'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const spatialState = shallowRef(state), spatialNotice = ref(''), spatialStorageNotice = ref(''), hud = ref(hudValue);
  const projection = computed(() => spatialState.value.snapshot?.projection || null);
  const bindings = { computed, spatialState, spatialNotice, spatialStorageNotice, hud, projection,
    online: computed(() => spatialState.value.connection === 'online'),
    guidance: ref({ status: { text: '历史动作等待确认', tone: 'uncertain' } }),
    DIRECTION_MOVEMENT_PENDING_MESSAGE: pendingMessage };
  const result = new Function('bindings',
    'const {computed, spatialState, spatialNotice, spatialStorageNotice, hud, projection, online, guidance, DIRECTION_MOVEMENT_PENDING_MESSAGE}=bindings;\n'
    + code + '\nreturn {currentStatus, get notice(){return typeof currentNotice === "undefined" ? spatialNotice.value || spatialStorageNotice.value || spatialState.value.message : currentNotice.value;}};')(bindings);
  return { ...bindings, currentStatus: result.currentStatus, get notice() { return result.notice; } };
}
test('RDY-04：真实Page当前原因在HUD/非HUD提前可读，不被恢复成功或自身旧提示遮挡', async t => {
  const h = await room(t, { drafts: [saved('move_to')] });
  const text = '上次移动或停步还待确认，请查询原动作；确认后重新按方向键。';
  for (const hud of [true, false]) await t.test(hud ? 'HUD' : '非HUD', () => {
    const view = pageStatus(h.client.state, hud);
    assert.equal(view.currentStatus.value.text, text);
    assert.equal(view.notice, text);
    view.spatialState.value = { ...view.spatialState.value, message: pendingMessage };
    assert.equal(view.currentStatus.value.text, text);
    view.spatialState.value = { ...view.spatialState.value, message: '另一项真实网络错误' };
    assert.equal(view.currentStatus.value.text, '另一项真实网络错误');
    assert.equal(view.notice, '另一项真实网络错误');
    view.spatialStorageNotice.value = '未允许保存原动作'; assert.equal(view.currentStatus.value.text, '未允许保存原动作');
    assert.equal(view.notice, '未允许保存原动作');
    view.spatialNotice.value = '当前操作未提交'; assert.equal(view.currentStatus.value.text, '当前操作未提交');
    assert.equal(view.notice, '当前操作未提交');
    view.spatialNotice.value = ''; view.spatialStorageNotice.value = '';
    view.spatialState.value = { ...view.spatialState.value, message: '', directionInput: ready };
    assert.notEqual(view.currentStatus.value.text, text, '当前方向阻塞已解除，不能保留旧方向原因');
  });
});

const browserSource = await readFile(new URL('./client-experience-browser.mjs', import.meta.url), 'utf8');
function reloadPredicate() {
  const parsed = ts.createSourceFile('client-experience-browser.mjs', browserSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const calls = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'until'
      && ts.isStringLiteral(node.arguments[1]) && node.arguments[1].text.startsWith('刷新后')) calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(parsed); assert.equal(calls.length, 1, '原reload只有这一个等待点');
  const expression = calls[0].arguments[0].getText(parsed);
  const code = ts.transpileModule('const check = ' + expression + ';', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return state => new Function('clientState', 'page', code + '\nreturn check();')(async () => state, {});
}
test('RDY-05：原reload等待点不把控制源就绪当成方向资格，原Receipt完成后才通过', async t => {
  const h = await room(t, { drafts: [saved('move_direction')] }), read = reloadPredicate();
  assert.equal(h.client.state.inputReady, true);
  assert.equal(await read(h.client.state), false, '原移动Unknown尚在，不能提前按新方向');
  h.resolveQueries(() => null); await settle();
  assert.equal(await read(h.client.state), false, '查询null不等于方向恢复完成');
  const draft = saved('move_direction'); h.known.set(draft.id, draft.receipt);
  await h.client.query(draft.id); await settle();
  assert.equal(await read(h.client.state), true);
  assert.equal(h.wires.length, 0, '等待谓词不提交动作或复活输入');
});


