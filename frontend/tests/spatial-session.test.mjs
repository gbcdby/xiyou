import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialSessionClient } from '../src/network/spatial-session.ts';
import { spatialSnapshot, spatialBatch } from './spatial-fixture.mjs';
import { ApiFailure } from '../src/network/http-api.ts';

const flush = () => new Promise(resolve => setImmediate(resolve));
function harness(options = {}, readReceipt = async () => null) {
  let handlers; const requests = []; let actionReplies = [];
  const initial = spatialSnapshot(); initial.projection.self.canControl = false;
  const link = { connected: true, close() {}, async request(event, value) {
    requests.push({ event, value });
    if (event === 'session.subscribe') return structuredClone(initial);
    if (event === 'sync.request') { const r = JSON.parse(value); return { schemaVersion: 2, type: 'world.batch', sessionId: r.sessionId, viewId: r.viewId, fromExclusive: r.cursor, throughSeq: r.cursor, events: [] }; }
    if (event.startsWith('control.')) { const r = JSON.parse(value); const snapshot = spatialSnapshot(); snapshot.viewId = 'control-view'; snapshot.projection.self.controlEpoch = '3'; return { schemaVersion: 2, sessionId: r.sessionId, nonce: r.nonce, controlEpoch: '3', observedSeq: snapshot.snapshotSeq, snapshot }; }
    if (actionReplies.length) return await actionReplies.shift()(JSON.parse(value));
    const r = JSON.parse(value); return { schemaVersion: 2, sessionId: r.sessionId, clientActionId: r.clientActionId, status: 'Accepted', code: 'OK', observedSeq: '10', actionEventRange: null, result: r.action.kind === 'move_to' ? { movementId: 'move_' + String(BigInt(r.action.movementCommandSeq) - 1n).padStart(31, '0'), planVersion: r.action.movementCommandSeq, movementCommandSeq: r.action.movementCommandSeq, status: 'accepted' } : { status: 'cancelled' } };
  } };
  const client = new SpatialSessionClient({ receipt: readReceipt }, (_token, h) => { handlers = h; return link; }, { heartbeatMs: 0, reconnectDelayMs: 0, ...options });
  return { client, requests, initial, get handlers() { return handlers; }, actionReplies };
}

function navigationRoom(h) {
  const snapshot = structuredClone(h.client.state.snapshot), p = snapshot.projection;
  p.scene.anchors = [{ anchorId: 'east', position: { x: 900, y: 100 }, label: '东出口' }];
  p.scene.exits = [{ exitId: 'to-road', anchorId: 'east', destinationSceneId: 'road', destination: { x: 100, y: 100 }, open: true }];
  const catalog = scene => { const { sceneId, name, width, height, unitsPerPixel, walkableAreas, anchors, exits } = scene; return { sceneId, name, width, height, unitsPerPixel, walkableAreas, anchors, exits: exits.map(({open,...rest})=>rest) }; };
  p.mapCatalog = [catalog(p.scene), catalog({ ...p.scene, sceneId: 'road', name: '村路', anchors: [], exits: [] })];
  p.sceneOverview = { entities: p.entities.map(e=>({...e,resourceRevision:'0',moving:false})), items: [], targets: [] };
  h.handlers.batch(spatialBatch(snapshot, String(BigInt(snapshot.snapshotSeq)+1n)));
}
function arrive(h, command, { visual = true } = {}) {
  const snapshot = structuredClone(h.client.state.snapshot), p = snapshot.projection;
  const from = p.self.sceneId === command.sceneId ? p.self.position : command.destination;
  p.self.position = { ...command.destination }; p.self.sceneId = command.sceneId; p.self.movementCommandHighWater = command.movementCommandSeq;
  if (p.scene.sceneId !== command.sceneId) p.scene = { ...p.mapCatalog.find(s=>s.sceneId===command.sceneId), obstacles: [], exits: [] };
  p.entities = [{ entityRef:p.self.entityRef,name:p.self.name,appearanceEpoch:p.self.appearanceEpoch,sceneId:command.sceneId,position:{...command.destination},facing:'E' }];
  p.sceneOverview = { entities:p.entities.map(e=>({...e,resourceRevision:'0',moving:false})),items:[],targets:[] };
  p.movement = { movementId:'move_'+String(BigInt(command.movementCommandSeq)-1n).padStart(31,'0'),planVersion:command.movementCommandSeq,movementCommandSeq:command.movementCommandSeq,sceneId:command.sceneId,mapVersion:p.mapVersion,goal:{...command.destination},path:[from,command.destination],acceptedAtSceneTime:p.sceneTimeMs,status:'arrived' };
  h.handlers.batch(spatialBatch(snapshot,String(BigInt(snapshot.snapshotSeq)+1n)));
  if (visual) h.client.confirmDisplayedArrival({viewId:snapshot.viewId,epoch:p.self.controlEpoch,movementId:p.movement.movementId,sequence:command.movementCommandSeq,position:command.destination});
}

test('GZ-UX-AC-05：连续方向使用更小目标，松键stop不被旧move收据阻塞', async () => {
  const h=harness();h.client.open('spatial-room','token');h.handlers.connected();await flush();await h.client.control('resume');
  let finish; h.actionReplies.push(request=>new Promise(resolve=>{finish=()=>resolve({schemaVersion:2,sessionId:request.sessionId,clientActionId:request.clientActionId,status:'Accepted',code:'OK',observedSeq:'10',actionEventRange:null,result:{movementId:'move_0000000000000000000000000000000',planVersion:'1',movementCommandSeq:'1',status:'accepted'}});}));
  h.client.setDirection({x:1,y:1});h.client.setDirection(null);await flush();
  const commands=h.requests.filter(r=>r.event==='player.action.request').map(r=>JSON.parse(r.value).action);
  assert.equal(commands.length,2);assert.equal(commands[0].kind,'move_to');assert.ok(Math.hypot(commands[0].destination.x-100,commands[0].destination.y-100)<=36);
  assert.equal(commands[1].kind,'stop_move');assert.ok(BigInt(commands[1].movementCommandSeq)>BigInt(commands[0].movementCommandSeq));
  finish();await flush();h.client.close();
});

test('R66-STD-001：停步waiting/unknown均阻止新方向，查询原停步确认后才恢复', async t => {
  let receipt=null, rejectStop;const h=harness({},async()=>receipt);
  t.after(()=>h.client.close());
  h.client.open('spatial-room','token');h.handlers.connected();await flush();await h.client.control('resume');
  h.client.setDirection({x:1,y:0});await flush();
  h.actionReplies.push(()=>new Promise((_resolve,reject)=>{rejectStop=reject;}));
  h.client.setDirection(null);await flush();
  const wires=()=>h.requests.filter(r=>r.event==='player.action.request');
  for(let i=0;i<12;i++){h.client.setDirection({x:0,y:1});await flush();h.client.setDirection(null);await flush();}
  assert.equal(wires().length,2);const original=wires()[1].value,request=JSON.parse(original);
  rejectStop(new Error('ACK丢失'));await flush();assert.equal(h.client.state.actions.find(a=>a.id===request.clientActionId).status,'unknown');
  h.client.setDirection({x:-1,y:0});await flush();assert.equal(wires().length,2);
  receipt={schemaVersion:2,sessionId:request.sessionId,clientActionId:request.clientActionId,status:'Accepted',code:'OK',observedSeq:'10',actionEventRange:null,result:{status:'cancelled'}};
  await h.client.query(request.clientActionId);h.client.setDirection({x:0,y:1});await new Promise(resolve=>setTimeout(resolve,120));
  assert.equal(wires().length,3);assert.equal(h.client.state.actions.find(a=>a.id===request.clientActionId).raw,original);h.client.close();
});

test('GZ-UX-AC-03：地图导航只走合法出口，计划内跨景继续，等显示到达才下一段', async () => {
  const h=harness({waitForVisualArrival:true});h.client.open('spatial-room','token');h.handlers.connected();await flush();await h.client.control('resume');navigationRoom(h);await flush();
  await h.client.navigateTo('road',{x:220,y:100});
  const commands=()=>h.requests.filter(r=>r.event==='player.action.request').map(r=>JSON.parse(r.value).action);
  assert.equal(h.client.state.navigation.phase,'approaching-exit');assert.equal(commands()[0].sceneId,'yard');assert.deepEqual(commands()[0].destination,{x:900,y:100});
  arrive(h,commands()[0],{visual:false});await flush();assert.equal(commands().length,1);
  arrive(h,commands()[0]);await flush();assert.equal(commands().length,2);assert.equal(commands()[1].sceneId,'road');assert.deepEqual(commands()[1].destination,{x:100,y:100});
  arrive(h,commands()[1]);await flush();assert.equal(commands().length,3);assert.equal(h.client.state.navigation.phase,'approaching-destination');assert.deepEqual(commands()[2].destination,{x:220,y:100});
  arrive(h,commands()[2]);await flush();assert.equal(h.client.state.navigation,null);h.client.close();
});

test('GZ-UX-AC-03：停止取消未发crossing；不可达、未开放出口不产生瞬移请求', async () => {
  const h=harness();h.client.open('spatial-room','token');h.handlers.connected();await flush();await h.client.control('resume');navigationRoom(h);await flush();
  await assert.rejects(h.client.navigateTo('missing',{x:1,y:1}),/目的地|路线/);
  const blocked=structuredClone(h.client.state.snapshot);blocked.projection.scene.exits[0].open=false;h.handlers.batch(spatialBatch(blocked,String(BigInt(blocked.snapshotSeq)+1n)));await flush();
  await assert.rejects(h.client.navigateTo('road',{x:220,y:100}),/出口/);
  assert.equal(h.requests.filter(r=>r.event==='player.action.request').length,0);
  navigationRoom(h);await flush();await h.client.navigateTo('road',{x:220,y:100});const move=JSON.parse(h.requests.filter(r=>r.event==='player.action.request')[0].value).action;
  await h.client.stop();assert.equal(h.client.state.navigation,null);arrive(h,move);await flush();
  const kinds=h.requests.filter(r=>r.event==='player.action.request').map(r=>JSON.parse(r.value).action.kind);assert.deepEqual(kinds,['move_to','stop_move']);h.client.close();
});

test('GZ-UX-AC-03：手动接管、非预期跨景与控制变化都撤销自动导航', async () => {
  for (const change of ['manual','scene','epoch']) {
    const h=harness();h.client.open('spatial-room','token');h.handlers.connected();await flush();await h.client.control('resume');navigationRoom(h);await flush();
    await h.client.navigateTo('road',{x:220,y:100});const first=JSON.parse(h.requests.filter(r=>r.event==='player.action.request')[0].value).action;
    if (change==='manual') await h.client.move({x:300,y:100});
    else if (change==='scene') arrive(h,{...first,sceneId:'road'});
    else { const changed=structuredClone(h.client.state.snapshot);changed.projection.self.controlEpoch='4';h.handlers.batch(spatialBatch(changed,String(BigInt(changed.snapshotSeq)+1n))); }
    await flush();assert.equal(h.client.state.navigation,null);h.client.close();
  }
});

test('GZ-UX-AC-03：自己的crossing批次先于ACK仍绑定原seq，原收据回来才推进', async () => {
  const h=harness({waitForVisualArrival:true});h.client.open('spatial-room','token');h.handlers.connected();await flush();await h.client.control('resume');navigationRoom(h);await flush();
  await h.client.navigateTo('road',{x:220,y:100});const commands=()=>h.requests.filter(r=>r.event==='player.action.request').map(r=>JSON.parse(r.value).action);
  let finish;h.actionReplies.push(request=>new Promise(resolve=>{finish=()=>resolve({schemaVersion:2,sessionId:request.sessionId,clientActionId:request.clientActionId,status:'Accepted',code:'OK',observedSeq:'13',actionEventRange:null,result:{movementId:'move_0000000000000000000000000000001',planVersion:'2',movementCommandSeq:'2',status:'accepted'}});}));
  arrive(h,commands()[0]);await flush();arrive(h,commands()[1]);await flush();assert.equal(commands().length,2);assert.equal(h.client.state.navigation.phase,'crossing');
  finish();await flush();assert.equal(commands().length,3);assert.equal(h.client.state.navigation.phase,'approaching-destination');h.client.close();
});

test('未知移动重试原串，后发停止的序号更高；控制响应替换视图', async () => {
  const h = harness(); h.client.open('spatial-room', 'token'); h.handlers.connected(); await flush(); await h.client.control('resume');
  assert.equal(h.client.state.snapshot.viewId, 'control-view');
  h.actionReplies.push(async () => { throw new Error('ACK丢失'); });
  await h.client.move({ x: 200, y: 100 });
  const first = h.requests.find(r => r.event === 'player.action.request'); const id = JSON.parse(first.value).clientActionId;
  assert.equal(h.client.state.actions[0].status, 'unknown');
  await h.client.stop(); await h.client.retry(id);
  const wires = h.requests.filter(r => r.event === 'player.action.request').map(r => r.value);
  assert.equal(JSON.parse(wires[0]).action.movementCommandSeq, '1'); assert.equal(JSON.parse(wires[1]).action.movementCommandSeq, '2'); assert.equal(wires[2], wires[0]);
  h.client.close();
});

test('绘制落后于确认点时等待，对应视图与序号追上后才提交排队操作', async () => {
  const h = harness({ waitForVisualArrival: true }); h.client.open('spatial-room', 'token'); h.handlers.connected(); await flush(); await h.client.control('resume');
  await h.client.move({ x: 200, y: 100 }, {}, { kind: 'wait' });
  const arrived = structuredClone(h.client.state.snapshot); arrived.projection.self.position = { x: 200, y: 100 }; arrived.projection.self.movementCommandHighWater = '1';
  arrived.projection.movement = { movementId: 'move_0000000000000000000000000000000', planVersion: '1', movementCommandSeq: '1', sceneId: 'yard', mapVersion: 'gray-map-v1', goal: { x: 200, y: 100 }, path: [{ x: 100, y: 100 }, { x: 200, y: 100 }], acceptedAtSceneTime: 1000, status: 'arrived' };
  h.handlers.batch(spatialBatch(arrived, '11')); await flush();
  const requests = () => h.requests.filter(r => r.event === 'player.action.request'); assert.equal(requests().length, 1);
  h.client.confirmDisplayedArrival({ viewId: 'old-view', epoch: '3', movementId: arrived.projection.movement.movementId, sequence: '1', position: { x: 200, y: 100 } }); assert.equal(requests().length, 1);
  h.client.confirmDisplayedArrival({ viewId: 'control-view', epoch: '3', movementId: arrived.projection.movement.movementId, sequence: '1', position: { x: 200, y: 100 } }); await flush();
  assert.equal(JSON.parse(requests()[1].value).action.kind, 'wait'); h.client.close();
});

test('导航后操作只由对应服务端arrived触发，停止会取消排队操作', async () => {
  const h = harness(); h.client.open('spatial-room', 'token'); h.handlers.connected(); await flush(); await h.client.control('resume');
  await h.client.move({ x: 200, y: 100 }, {}, { kind: 'wait' });
  assert.equal(h.requests.filter(r => r.event === 'player.action.request').length, 1);
  const current = structuredClone(h.client.state.snapshot); const projection = current.projection; projection.self.movementCommandHighWater = '1';
  projection.movement = { movementId: 'move_0000000000000000000000000000000', planVersion: '1', movementCommandSeq: '1', sceneId: 'yard', mapVersion: 'gray-map-v1', goal: { x: 200, y: 100 }, path: [{ x: 100, y: 100 }, { x: 200, y: 100 }], acceptedAtSceneTime: 1000, status: 'moving' };
  h.handlers.batch(spatialBatch(current, '11', projection)); await flush(); assert.equal(h.requests.filter(r => r.event === 'player.action.request').length, 1);
  const arrived = structuredClone(h.client.state.snapshot); arrived.projection.movement.status = 'arrived'; arrived.projection.self.position = { x: 200, y: 100 };
  h.handlers.batch(spatialBatch(arrived, '12')); await flush();
  assert.equal(JSON.parse(h.requests.filter(r => r.event === 'player.action.request').at(-1).value).action.kind, 'wait');
  await h.client.move({ x: 300, y: 100 }, {}, { kind: 'wait' }); await h.client.stop();
  assert.equal(h.client.state.queuedAction, null); h.client.close();
});

test('更换连接丢弃旧订阅和控制返回，不凭服务器highWater重建旧epoch输入源', async () => {
  const h = harness(); h.initial.projection.self.canControl = true; h.initial.projection.self.movementCommandHighWater = '8';
  h.client.open('spatial-room', 'token'); h.handlers.connected(); await flush();
  await assert.rejects(h.client.move({ x: 200, y: 100 }), /控制|输入源/);
  const old = h.handlers; h.client.close(); old.batch(spatialBatch(spatialSnapshot())); assert.equal(h.client.state.snapshot, null);
});

test('订阅暂态错误重新建连，查询撤权立即清空空间投影', async () => {
  let handlers; let attempts = 0;
  const client = new SpatialSessionClient({ receipt: async () => { throw new ApiFailure('本局权限已撤销。', 403, 'FORBIDDEN'); } }, (_token, h) => {
    handlers = h; attempts++; const attempt = attempts;
    queueMicrotask(() => h.connected());
    return { connected: true, close() {}, async request(event, value) {
      if (event === 'session.subscribe') return attempt === 1 ? { schemaVersion: 2, code: 'OUTCOME_UNKNOWN', message: '暂未完成。' } : spatialSnapshot();
      if (event === 'sync.request') { const r = JSON.parse(value); return { schemaVersion: 2, type: 'world.batch', sessionId: r.sessionId, viewId: r.viewId, fromExclusive: r.cursor, throughSeq: r.cursor, events: [] }; }
    } };
  }, { heartbeatMs: 0, reconnectDelayMs: 5 });
  const snapshot = spatialSnapshot();
  const raw = JSON.stringify({ schemaVersion: 2, sessionId: snapshot.sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, clientActionId: 'old-action', controlEpoch: '1', baseSeq: '1', action: { kind: 'wait' } });
  client.open('spatial-room', 'token', [{ id: 'old-action', raw }]);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(attempts, 2); assert.equal(client.state.connection, 'forbidden'); assert.equal(client.state.snapshot, null); client.close();
});

test('发布连接状态时同步关闭，不会继续创建废弃连接', () => {
  let attempts = 0; let client;
  client = new SpatialSessionClient({ receipt: async () => null }, () => { attempts++; throw new Error('不应启动'); }, { heartbeatMs: 0, onChange: state => { if (state.connection === 'connecting') client.close(); } });
  client.open('spatial-room', 'token'); assert.equal(attempts, 0); assert.equal(client.state.connection, 'idle');
});

test('未知移动经过九十次确认和持久恢复，仍能查询并原串重试', async () => {
  let saved = '[]';
  const h = harness({ onChange: state => { saved = JSON.stringify(state.actions); } });
  h.client.open('spatial-room', 'token'); h.handlers.connected(); await flush(); await h.client.control('resume');
  h.actionReplies.push(async () => { throw new Error('服务器收下移动后确认丢失'); });
  await h.client.move({ x: 200, y: 100 });
  const original = h.requests.find(request => request.event === 'player.action.request').value;
  const id = JSON.parse(original).clientActionId;
  for (let count = 0; count < 90; count++) await h.client.send({ kind: 'wait' });
  assert.equal(h.client.state.actions.find(action => action.id === id)?.raw, original, '已确认历史不得挤走未知移动的完整原请求');
  assert.equal(JSON.parse(saved).find(action => action.id === id)?.raw, original, '持久化输入必须保留同一原请求');
  assert.ok(h.client.state.actions.filter(action => action.receipt).length <= 80, '已确认历史仍有界');
  h.client.close();

  const queried = [];
  const restored = harness({}, async (_sessionId, actionId) => { queried.push(actionId); return null; });
  restored.client.open('spatial-room', 'token', JSON.parse(saved)); restored.handlers.connected(); await flush();
  assert.ok(queried.includes(id), '重新进入房间必须查询旧未知动作');
  assert.equal(restored.client.state.actions.find(action => action.id === id)?.raw, original);
  await restored.client.control('take');
  await restored.client.retry(id);
  const retried = restored.requests.filter(request => request.event === 'player.action.request');
  assert.deepEqual(retried.map(request => request.value), [original], '新控制视图不得改写旧动作的 ID、view、epoch、baseSeq 或移动序号');
  restored.client.close();
});

test('超过八十个等待中的动作保留到各自确认，迟到收据仍能找到原动作', async () => {
  const h = harness(); h.client.open('spatial-room', 'token'); h.handlers.connected(); await flush(); await h.client.control('resume');
  const completions = [];
  for (let count = 0; count < 81; count++) h.actionReplies.push(request => new Promise(resolve => completions.push(() => resolve({ schemaVersion: 2, sessionId: request.sessionId, clientActionId: request.clientActionId, status: 'Accepted', code: 'NO_CHANGE', observedSeq: '10', actionEventRange: null, result: {} }))));
  const sends = Array.from({ length: 81 }, () => h.client.send({ kind: 'wait' }));
  try {
    const originalIds = h.requests.filter(request => request.event === 'player.action.request').map(request => JSON.parse(request.value).clientActionId);
    assert.deepEqual(h.client.state.actions.map(action => action.id), originalIds, '尚未得到收据的请求不得受历史上限裁剪');
    completions.shift()(); await flush();
    assert.equal(h.client.state.actions.find(action => action.id === originalIds[0])?.status, 'accepted');
    assert.equal(h.client.state.actions.filter(action => action.status === 'waiting').length, 80);
  } finally { completions.forEach(complete => complete()); await Promise.all(sends); h.client.close(); }
});

test('超过八十个未知动作从持久数据恢复时仍逐个查询，首个动作可原样重试', async () => {
  const h = harness(); h.client.open('spatial-room', 'token'); h.handlers.connected(); await flush(); await h.client.control('resume');
  for (let count = 0; count < 81; count++) {
    h.actionReplies.push(async () => { throw new Error('确认丢失'); });
    await h.client.send({ kind: 'wait' });
  }
  const originals = h.requests.filter(request => request.event === 'player.action.request').map(request => request.value);
  const saved = JSON.stringify(h.client.state.actions); h.client.close();
  const queried = [];
  const restored = harness({}, async (_sessionId, actionId) => { queried.push(actionId); return null; });
  restored.client.open('spatial-room', 'token', JSON.parse(saved)); restored.handlers.connected(); await flush();
  const ids = originals.map(raw => JSON.parse(raw).clientActionId);
  assert.deepEqual(restored.client.state.actions.map(action => action.raw), originals, '恢复不得截断未决动作');
  assert.deepEqual(queried, ids);
  await restored.client.retry(ids[0]);
  assert.equal(restored.requests.find(request => request.event === 'player.action.request')?.value, originals[0]);
  restored.client.close();
});

test('重连回放未知收据时在途查询有界，逐个查询完成后仍能继续控制恢复', async () => {
  const h = harness(); h.client.open('spatial-room', 'token'); h.handlers.connected(); await flush(); await h.client.control('resume');
  for (let count = 0; count < 81; count++) {
    h.actionReplies.push(async () => { throw new Error('确认丢失'); });
    await h.client.send({ kind: 'wait' });
  }
  const saved = JSON.stringify(h.client.state.actions); h.client.close();
  let inFlight = 0, peak = 0; const queried = []; const completions = [];
  const restored = harness({}, (_sessionId, actionId) => {
    queried.push(actionId); inFlight++; peak = Math.max(peak, inFlight);
    return new Promise(resolve => completions.push(() => { inFlight--; resolve(null); }));
  });
  restored.client.open('spatial-room', 'token', JSON.parse(saved)); restored.handlers.connected();
  await flush(); await flush();
  assert.ok(queried.length > 0 && queried.length <= 3, `首批在途查询必须不超过3，实际 ${queried.length}`);
  assert.equal(peak, queried.length, '峰值等于首批，尚未放行完成');
  // 先放行第一批，控制恢复（独立 Socket 事件）无需等待剩余队列即可完成。
  const controlReply = restored.client.control('take');
  while (completions.length) completions.shift()();
  await controlReply;
  assert.equal(restored.client.state.snapshot.viewId, 'control-view');
  // 后续批次的完成回调在微任务中逐个登记；每轮放行后让出事件循环直到全部查完。
  let guard = 0;
  while (queried.length < 81 && guard++ < 200) {
    while (completions.length) completions.shift()();
    await flush();
  }
  assert.ok(peak <= 3, `全过程的在途查询峰值不得超过3，实际 ${peak}`);
  assert.equal(queried.length, 81, '所有未知动作最终都被逐个查询');
  assert.equal(new Set(queried).size, 81, '不重复查询');
  restored.client.close();
});

test('A2 用途参数与结束轮在未知确认、恢复换视图后逐字重试，不改成新许可或新轮', async () => {
  const reference = letter => 'R' + letter.repeat(32);
  const h = harness(); h.client.open('spatial-room', 'token'); h.handlers.connected(); await flush(); await h.client.control('resume');
  const actions = [
    { kind: 'interact', operationId: 'gz-request-private-items', targetRef: reference('p'), expectedTargetRevision: '13', parameters: { itemRefs: [reference('i'), reference('j')], expectedConsentVersion: '7' } },
    { kind: 'propose_follow', subjectRef: reference('p'), leaderRef: reference('s'), destinationId: 'safe-yard', expectedConsentVersion: '8' },
    { kind: 'propose_follow', subjectRef: reference('p'), leaderRef: reference('s'), destinationId: 'safe-yard', expectedTargetRevision: '13' },
    { kind: 'confirm_end', proposalId: 'precise-round', proposalVersion: '9' },
  ];
  for (const action of actions) { h.actionReplies.push(async () => { throw new Error('A2 确认丢失'); }); await h.client.send(action); }
  const originals = h.requests.filter(r => r.event === 'player.action.request').map(r => r.value);
  const saved = structuredClone(h.client.state.actions); h.client.close();
  const restored = harness(); restored.client.open('spatial-room', 'token', saved); restored.handlers.connected(); await flush(); await restored.client.control('take');
  for (const raw of originals) await restored.client.retry(JSON.parse(raw).clientActionId);
  assert.deepEqual(restored.requests.filter(r => r.event === 'player.action.request').map(r => r.value), originals);
  assert.deepEqual(originals.map(raw => JSON.parse(raw).action), actions);
  restored.client.close();
});
