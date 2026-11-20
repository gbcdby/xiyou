// RRS-T02：真实浏览器观察push接受后的通知异常；逻辑交错用例，不是normal或性能验收。
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer as createVite } from 'vite';
import { chromium } from 'playwright';
import { createAuthorityServer } from '../../backend/server.mjs';
import { startTestPostgres } from '../../backend/test-support/postgres.mjs';
import { repository, saveJSON, sha256, until } from './network-support.mjs';

const output = resolve(process.env.FRONTEND_EVIDENCE_DIR || resolve(repository, '.agent-output/rpc-race-implement/t02-push-notify'));
await mkdir(output, { recursive: true });
const fault = 'RRS-T02：先行push接受后的显示通知异常';
const fixtureSource = `
import { SpatialSessionClient } from '/src/network/spatial-session.ts';
import { connectSpatialSocket } from '/src/network/socket-link.ts';
const peers=[], rows=[], errors=[]; let serial=0, armed=null, thrown=null, roundDone=false, roundError=null;
const record=(kind,value={})=>{const row={serial:++serial,at:performance.now(),kind,...value};rows.push(row);return row;};
const cursor=peer=>peer.client.state.snapshot?.snapshotSeq??null;
window.addEventListener('error',event=>{
  // 只观察浏览器原生错误；不preventDefault，不在push调用链捕获或恢复错误。
  const row=record('window.error',{message:event.message,stack:event.error?.stack,defaultPrevented:event.defaultPrevented,
    sameThrownError:event.error===thrown,cursor:peers[0]?cursor(peers[0]):null,notice:document.querySelector('#notice0').textContent});
  errors.push(row);
});
window.addEventListener('unhandledrejection',event=>{
  // 原Socket.IO通过Promise微任务派发push；只记录拒绝，不preventDefault或安装catch。
  const row=record('window.unhandledrejection',{message:event.reason?.message,stack:event.reason?.stack,defaultPrevented:event.defaultPrevented,
    sameThrownError:event.reason===thrown,cursor:peers[0]?cursor(peers[0]):null,notice:document.querySelector('#notice0').textContent});
  errors.push(row);
});
async function wait(check,label){const end=performance.now()+10000;while(performance.now()<end){if(check())return;await new Promise(r=>setTimeout(r,10));}throw new Error('页面准备超时：'+label);}
window.__rpcNotify={
  async boot({sessionId,tokens}){
    for(const [index,token] of tokens.entries()){
      const peer={wire:[],accepted:[],requests:[],packet:null};let lastSnapshot=null;
      peer.client=new SpatialSessionClient({receipt(){throw new Error('该逻辑用例没有动作收据需求');}},(value,handlers)=>{
        const actual=connectSpatialSocket(value,{...handlers,batch(value){
          const row=record('push.before',{peer:index,before:cursor(peer),value});peer.wire.push(row);peer.packet=row;
          // finally仅记实际接受后游标；异常继续沿原socket事件派发逃逸到浏览器。
          try{return handlers.batch(value);}finally{row.after=cursor(peer);record('push.after',{peer:index,cursor:row.after});peer.packet=null;}
        }},undefined,{directionHandoff:true,timedTrail:true});
        return{get connected(){return actual.connected;},get acceptedCapabilities(){return actual.acceptedCapabilities;},close(){return actual.close();},
          request(event,raw,consume){
            peer.requests.push({event,request:typeof raw==='string'?JSON.parse(raw):raw});
            return actual.request(event,raw,typeof consume==='function'?value=>{
              const row=record(event==='sync.request'?'ack.before':event,{peer:index,before:cursor(peer),value});peer.wire.push(row);peer.packet=row;
              try{return consume(value);}finally{row.after=cursor(peer);record('ack.after',{peer:index,cursor:row.after,event});peer.packet=null;}
            }:undefined);
          }};
      },{heartbeatMs:0,reconnectDelayMs:0,onChange(state){
        if(state.snapshot&&state.snapshot!==lastSnapshot){lastSnapshot=state.snapshot;peer.accepted.push(record('snapshot.accepted',{peer:index,cursor:state.snapshot.snapshotSeq,packet:peer.packet?.kind??null}));}
        const notice=document.querySelector('#notice'+index);notice.textContent=state.snapshot?.snapshotSeq??'尚未连接';
        if(index===0&&armed===state.snapshot?.snapshotSeq){
          armed=null;thrown=new Error(${JSON.stringify(fault)});
          record('notice.throw',{peer:index,cursor:cursor(peer),notice:notice.textContent,packet:peer.packet?.kind??null});
          throw thrown;
        }
      }});
      peers.push(peer);peer.client.open(sessionId,token);
      await wait(()=>peer.client.state.connection==='online','原订阅');await peer.client.control('resume');
      if(!peer.client.state.inputReady)throw new Error('真实控制未就绪');
    }
  },
  arm(seq){armed=seq;},
  startSync(){roundDone=false;roundError=null;peers[0].client.sync().then(()=>{roundDone=true;},error=>{roundError=String(error);roundDone=true;});},
  read(){return{rows,errors,roundDone,roundError,peers:peers.map(peer=>({cursor:cursor(peer),connection:peer.client.state.connection,
    timedTrail:peer.client.state.timedTrail,wire:peer.wire,accepted:peer.accepted,requests:peer.requests})),notice:document.querySelector('#notice0').textContent};},
  close(){for(const peer of peers)peer.client.close();}
};
`;
const fixture = {
  name: 'rpc-push-notify-fixture',
  resolveId(id) { if (id === '/rpc-push-notify-fixture.js') return '\0rpc-push-notify-fixture'; },
  load(id) { if (id === '\0rpc-push-notify-fixture') return fixtureSource; },
  configureServer(vite) {
    vite.middlewares.use((request, response, next) => {
      if (request.url !== '/rpc-push-notify-fixture') return next();
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html lang="zh-CN"><body><output id="notice0"></output><output id="notice1"></output><script type="module" src="/rpc-push-notify-fixture.js"></script></body></html>');
    });
  },
};
async function identity() {
  const git = (...args) => execFileSync('git', ['--no-lazy-fetch', '-c', 'protocol.allow=never', ...args], { cwd: repository, encoding: 'utf8' }).trim();
  const paths = ['backend/server.mjs','backend/runtime.mjs','backend/spatial-runtime.mjs','backend/spatial-supply.mjs','backend/socket-enqueue.mjs',
    'frontend/src/network/spatial-session.ts','frontend/src/network/socket-link.ts','frontend/src/network/direction-capability.ts',
    'frontend/src/domain/spatial-view.ts','frontend/tests/spatial-rpc-push-notify-browser.mjs','package-lock.json','frontend/package-lock.json'];
  return { commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), status: git('status', '--short'),
    sourceHashes: Object.fromEntries(await Promise.all(paths.map(async path => [path, sha256(await readFile(resolve(repository, path)))]))) };
}
const report = { workId: 'RRS-CODE-REVIEW-01', scenario: 'RRS-T02-push-notify',
  scope: '真实PG、原server/Socket/proof及浏览器原consumer；onChange的DOM通知抛错。仅一个逻辑交错，不是运动/normal验收。',
  source: await identity(), fixtureSha256: sha256(fixtureSource), startedAt: new Date().toISOString(), pageErrors: [], checks: [], cleanup: [],
  reads: [], rpc: [], publications: [] };
let database, authority, vite, browser, page, runtime, focus, sessionId, failure;
const gates = [], handles = new Map(), context = new AsyncLocalStorage();
const snapshot = () => page.evaluate(() => window.__rpcNotify.read());
function holdRead(handle) {
  const released = Promise.withResolvers(), gate = { handle, entered: false, release: released.resolve, released: released.promise };
  gates.push(gate); return gate;
}
try {
  database = await startTestPostgres('rpc-push-notify', { outputSubdirectory: 'rpc-race-implement' });
  authority = await createAuthorityServer({ pool: database.pool, now: () => Date.parse('2026-11-17T15:00:00Z'), spatialDirection: { checkpointMs: 50 } });
  runtime = authority.runtime;
  const open = runtime.openConnection.bind(runtime), sync = runtime.sync.bind(runtime), rpc = runtime.spatialSupply.sync, publish = runtime.spatialSupply.publish;
  runtime.openConnection = function (token, ...args) { const promise = open(token, ...args); promise.then(handle => handles.set(token, handle), () => {}); return promise; };
  runtime.sync = function (handle, raw, internal) {
    const call = { connectionId: handle.connectionId, request: JSON.parse(raw), internal: internal ?? {}, settled: false }; report.reads.push(call);
    const promise = context.run(handle, () => sync(handle, raw, internal));
    promise.then(value => { call.value = value; call.settled = true; }, error => { call.error = error.code; call.settled = true; }); return promise;
  };
  runtime.hooks.afterCommit = async ({ command }) => {
    const handle = context.getStore(), gate = gates.find(item => !item.entered && item.handle === handle);
    if (command !== 'spatial-sync' || !gate) return;
    gate.entered = true; await gate.released;
  };
  runtime.spatialSupply.sync = function (handle, raw, send) {
    const view = runtime.connectionView(handle), call = { connectionId: handle.connectionId, request: JSON.parse(raw), admitted: runtime.spatialSupply.cursor(view), settled: false }; report.rpc.push(call);
    const promise = rpc.call(this, handle, raw, (value, binding) => { const proof = send(value, binding); call.proof = !!proof && typeof proof === 'object'; return proof; });
    promise.then(value => { call.value = value; call.sent = runtime.spatialSupply.cursor(view); call.settled = true; }, error => { call.error = error.code; call.settled = true; }); return promise;
  };
  runtime.spatialSupply.publish = function (view, target, send) {
    const call = { connectionId: view.handle.connectionId, target, settled: false }; report.publications.push(call);
    const promise = publish.call(this, view, target, (value, binding) => { const proof = send(value, binding); call.value = value; call.proof = !!proof && typeof proof === 'object'; return proof; });
    promise.then(value => { call.result = value; call.sent = runtime.spatialSupply.cursor(view); call.settled = true; }, error => { call.error = error.code; call.settled = true; }); return promise;
  };
  const users = await Promise.all(['通知甲', '通知乙'].map(name => runtime.guest({ name })));
  const capabilities = ['spatial-v2', 'spatial-direction-v1', 'spatial-timed-trail-v1'];
  ({ sessionId } = await runtime.create(users[0].token, { nonce: crypto.randomUUID(), contentVersion: 'spatial-graybox-v2', capabilities }));
  await runtime.join(users[1].token, sessionId, { nonce: crypto.randomUUID(), capabilities });
  await runtime.start(users[0].token, sessionId, { nonce: crypto.randomUUID() });
  const address = await authority.listen(0), origin = `http://127.0.0.1:${address.port}`;
  vite = await createVite({ root: resolve(repository, 'frontend'), configFile: false, cacheDir: resolve(output, 'vite-cache'), plugins: [fixture],
    server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] }, proxy: { '/socket.io': { target: origin, ws: true } } } });
  await vite.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : [] });
  report.environment = { node: process.version, chromium: browser.version(), playwright: JSON.parse(await readFile(resolve(repository, 'frontend/node_modules/playwright/package.json'), 'utf8')).version,
    browserSelection: process.env.CHROMIUM_PATH || 'Playwright锁定默认浏览器' };
  page = await browser.newPage(); page.on('pageerror', error => report.pageErrors.push({ message: error.message, stack: error.stack }));
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/rpc-push-notify-fixture`);
  await until(() => page.evaluate(() => !!window.__rpcNotify), '原浏览器consumer模块载入');
  await page.evaluate(value => window.__rpcNotify.boot(value), { sessionId, tokens: users.map(user => user.token) });
  focus = handles.get(users[0].token); assert(focus);
  const head = async () => (await database.pool.query('SELECT session_seq FROM sessions WHERE session_id=$1', [sessionId])).rows[0].session_seq;
  const sent = handle => runtime.spatialSupply.cursor(runtime.connectionView(handle));
  await until(async () => {
    const through = await head(), current = await snapshot();
    return users.every((user, index) => sent(handles.get(user.token)) === through && current.peers[index].cursor === through)
      && report.reads.every(call => call.settled) && report.rpc.every(call => call.settled)
      && (await database.pool.query("SELECT 1 FROM outbox WHERE session_id=$1 AND status='Pending'", [sessionId])).rowCount === 0;
  }, '初始真实发送及原consumer完成');
  const before = await snapshot(), R = before.peers[0].cursor, view = runtime.connectionView(focus), installed = view.cursor;
  const wireStart = before.peers[0].wire.length, acceptedStart = before.peers[0].accepted.length, requestStart = before.peers[0].requests.length;
  const rpcStart = report.rpc.length, publishStart = report.publications.length;
  const append = () => runtime.locked(sessionId, { kind: 'rpc-push-notify-fixture' }, tx => {
    tx.emit('spatial.clock', { sceneTimeMs: tx.state.sceneTimeMs, wallAnchorMs: tx.state.wallAnchorMs, paused: tx.state.paused }); return tx.state.sessionSeq;
  });
  const pGate = holdRead(focus), S = await append();
  await until(() => pGate.entered, '先行publisher已真实COMMIT'); assert.equal(sent(focus), R);
  const rpcGate = holdRead(focus);
  await page.evaluate(seq => { window.__rpcNotify.arm(seq); window.__rpcNotify.startSync(); }, S);
  await until(() => report.rpc.slice(rpcStart).some(call => call.connectionId === focus.connectionId), 'R=A的原RPC入队');
  const race = report.rpc.slice(rpcStart).find(call => call.connectionId === focus.connectionId);
  assert.equal(race.request.cursor, R); assert.equal(race.admitted, R);
  const T = await append(); assert(BigInt(T) > BigInt(S));
  report.prefix = { R, S, T, installed }; pGate.release();
  await until(() => rpcGate.entered, '后RPC已授权COMMIT但真实ACK尚未发送');
  await until(async () => report.pageErrors.length > 0 && (await snapshot()).errors.some(event => event.kind === 'window.unhandledrejection'), '真实push通知异常到达原生拒绝与pageerror边界');
  const atError = await snapshot(), event = atError.errors[0], notice = atError.rows.find(row => row.kind === 'notice.throw');
  report.atError = atError;
  assert.equal(report.pageErrors.length, 1); assert.equal(report.pageErrors[0].message, fault);
  assert.equal(atError.errors.length, 1); assert.equal(event.kind, 'window.unhandledrejection'); assert.equal(event.message, fault);
  assert.equal(event.sameThrownError, true); assert.equal(event.defaultPrevented, false);
  assert.equal(notice.packet, 'push.before'); assert.equal(notice.cursor, S); assert.equal(notice.notice, S);
  assert.equal(event.cursor, S); assert.equal(atError.peers[0].cursor, S); assert.equal(atError.notice, S);
  assert.equal(atError.peers[0].connection, 'online');
  assert.equal(sent(focus), S); assert.equal(race.settled, false); assert.equal(race.proof, undefined);
  assert(!atError.peers[0].wire.slice(wireStart).some(row => row.kind === 'ack.before'), '先观测异常，不把稍后ACK的恢复当异常时状态');
  report.checks.push({ id: 'T02-PUSH-ERROR', status: 'PASS', description: '合法push已接受到S，onChange真实DOM通知抛错并由浏览器报告；cursor不回退。' });
  rpcGate.release();
  await until(async () => { const value = await snapshot(); return value.roundDone && value.peers[0].cursor === T; }, '原传输在异常后继续派发新ACK');
  await until(() => race.settled, '真实RPC自然settle');
  const after = await snapshot(), wire = after.peers[0].wire.slice(wireStart), push = wire.find(row => row.kind === 'push.before'), ack = wire.find(row => row.kind === 'ack.before');
  assert(push && ack); assert.equal(push.value.fromExclusive, R); assert.equal(push.value.throughSeq, S); assert.equal(push.before, R); assert.equal(push.after, S);
  assert.equal(ack.value.fromExclusive, S); assert.equal(ack.value.throughSeq, T); assert.equal(ack.before, S); assert.equal(ack.after, T);
  assert(push.serial < notice.serial && notice.serial < event.serial && event.serial < ack.serial);
  assert.deepEqual(after.peers[0].accepted.slice(acceptedStart).map(row => row.cursor), [S, T]);
  assert.equal(after.peers[0].requests.slice(requestStart).filter(row => row.event === 'sync.request').length, 1);
  assert.equal(after.roundError, null); assert.equal(after.peers[0].connection, 'online'); assert.equal(after.peers[0].timedTrail, true);
  assert.equal(report.pageErrors.length, 1); assert.equal(after.errors.length, 1); assert.equal(race.proof, true); assert.equal(race.sent, T);
  assert(report.publications.slice(publishStart).some(call => call.connectionId === focus.connectionId && call.value?.throughSeq === S && call.proof === true));
  assert.equal(runtime.connectionView(focus), view); assert.equal(view.cursor, installed); assert.equal(sent(focus), T);
  report.checks.push({ id: 'T02-NEXT-ACK', status: 'PASS', description: '异常后原Socket继续派发ACK(S,T]，原consumer连续接受且S/T各一次；无手工cursor或fakeproof。' });
  report.observed = after; report.assessment = 'PASS';
} catch (error) {
  failure = error; report.assessment = 'FAIL'; report.error = error.stack || String(error);
} finally {
  for (const gate of gates) gate.release();
  if (page && !page.isClosed()) {
    try { report.finalObserved = await snapshot(); } catch (error) { report.captureError = String(error); }
  }
  for (const [name, close] of [
    ['clients', async () => { if (page && !page.isClosed()) await page.evaluate(() => window.__rpcNotify?.close()); }],
    ['browser', async () => browser?.close()], ['vite', async () => vite?.close()],
    ['server', async () => authority?.close()], ['postgres', async () => database?.stop()],
  ]) {
    try { await close(); report.cleanup.push({ name, status: 'closed' }); }
    catch (error) { report.cleanup.push({ name, status: 'failed', error: String(error) }); failure ??= error; report.assessment = 'FAIL'; }
  }
  report.finishedAt = new Date().toISOString(); report.sourceEnd = await identity();
  if (JSON.stringify(report.source) !== JSON.stringify(report.sourceEnd)) { failure ??= new Error('运行中源码身份发生变化'); report.assessment = 'FAIL'; }
  await saveJSON(resolve(output, 'result.json'), report);
}
console.log(JSON.stringify({ scenario: report.scenario, assessment: report.assessment, checks: report.checks, cleanup: report.cleanup, output }));
if (failure) { console.error(failure); process.exitCode = 1; }
