import test from 'node:test';
import assert from 'node:assert/strict';
import { room, pause, until, holdNextInstallation } from '../test-support/spatial-supply-room.mjs';
import { validateSpatial } from '../../protocol/spatial.mjs';

// 两类门分别代表“真COMMIT后函数未返回”与“真实SQL锁仍被持有”；不能混用。
test('RG01/RG12：单条P的G已真提交但未返回时，新COMMIT形成W并进入原lane', { timeout: 15000 }, async t => {
  const r = await room(t), entered = Promise.withResolvers(), release = Promise.withResolvers();
  const old = await r.append(); await Promise.all(r.peers.map(r.query));
  const original = r.runtime.spatialSupply.publish, starts = [];
  r.runtime.spatialSupply.publish = function (view, target, ...rest) { starts.push({ handle: view.handle, target }); return original.call(this, view, target, ...rest); };
  let gated = false, publishing;
  r.runtime.hooks.afterCommit = async ({ command }) => {
    if (command === 'outbox-progress' && !gated) { gated = true; entered.resolve(); await release.promise; }
  };
  try {
    publishing = r.flush(); await entered.promise;
    assert.deepEqual((await r.database.pool.query('SELECT status,attempts FROM outbox WHERE session_id=$1 AND through_seq=$2', [r.sessionId, old])).rows,
      [{ status: 'Published', attempts: 1 }], '门位于真实COMMIT之后，不是假定仍持旧写锁');
    const head = await r.append();
    await until(() => starts.filter(row => row.target === head).length === 2, '旧G尚未返回时，新提交必须让两条真实handle进入原publisher lane');
    await until(() => r.peers.every(peer => r.runtime.spatialSupply.cursor(r.runtime.connectionView(peer.handle)) === head), '空闲lane应实际发送新前缀');
    assert.equal((await r.flush()).busy, true, 'G仍占有原publisher生命周期');
    release.resolve(); const result = await publishing;
    assert.equal(result.examined, 1); assert.equal(result.published, 1, '新H不追加进原P');
    assert.deepEqual((await r.pending()).map(row => row.through_seq), [head]);
    assert.equal(r.runtime.listenerCount('spatial-supply-ready'), 0);
    assert.equal(r.runtime.listenerCount('commit'), 0);
  } finally { release.resolve(); await publishing?.catch(() => {}); delete r.runtime.hooks.afterCommit; r.runtime.spatialSupply.publish = original; }
});

test('RG01/RG02：世界写先持锁，释放后G取写锁时W已入原lane但共享读不得穿锁', { timeout: 15000 }, async t => {
  const r = await room(t), old = await r.append(); await Promise.all(r.peers.map(r.query));
  const writerEntered = Promise.withResolvers(), releaseWriter = Promise.withResolvers(), progressLocked = Promise.withResolvers(), releaseProgress = Promise.withResolvers();
  const original = r.runtime.spatialSupply.publish, starts = []; let holdWorld = true, holdProgress = true;
  r.runtime.spatialSupply.publish = function (view, target, ...rest) { starts.push({ handle: view.handle, target }); return original.call(this, view, target, ...rest); };
  r.runtime.hooks.beforeCommit = async ({ command }) => {
    if (command === 'parallel-supply-fixture' && holdWorld) { holdWorld = false; writerEntered.resolve(); await releaseWriter.promise; }
    if (command === 'outbox-progress' && holdProgress) { holdProgress = false; progressLocked.resolve(); await releaseProgress.promise; }
  };
  let publishing, writing;
  try {
    writing = r.append(); await writerEntered.promise;
    publishing = r.flush(); await pause(30);
    releaseWriter.resolve(); const head = await writing; await progressLocked.promise;
    await until(() => starts.filter(row => row.target === head).length === 2, '新W必须在G持锁期间进入原lane，不能等旧G返回');
    await pause(25);
    assert(r.peers.every(peer => r.runtime.spatialSupply.cursor(r.runtime.connectionView(peer.handle)) === old), 'FOR SHARE不能穿透真实G排他锁');
    releaseProgress.resolve(); await publishing;
    assert(r.peers.every(peer => r.runtime.spatialSupply.cursor(r.runtime.connectionView(peer.handle)) === head));
    assert.deepEqual((await r.pending()).map(row => row.through_seq), [head]);
  } finally { releaseWriter.resolve(); releaseProgress.resolve(); await Promise.allSettled([writing,publishing].filter(Boolean)); delete r.runtime.hooks.beforeCommit; r.runtime.spatialSupply.publish = original; }
});

test('RG03/RG10：G1返回时W未收束，G2等待；连续新hint不抹掉旧行机会', { timeout: 15000 }, async t => {
  const r = await room(t), first = await r.append(), second = await r.append(); await Promise.all(r.peers.map(r.query));
  const gEntered = Promise.withResolvers(), releaseG = Promise.withResolvers(), wEntered = Promise.withResolvers(), releaseW = Promise.withResolvers();
  const originalSync = r.runtime.sync.bind(r.runtime), originalPublish = r.runtime.spatialSupply.publish, events = [];
  let gCount = 0, heldRead = false, publishing;
  r.runtime.hooks.duringPublish = ({ throughSeq }) => { events.push({ kind: 'G', through: throughSeq }); };
  r.runtime.hooks.afterCommit = async ({ command }) => { if (command === 'outbox-progress' && ++gCount === 1) { gEntered.resolve(); await releaseG.promise; } };
  r.runtime.sync = async (handle, ...args) => {
    const result = await originalSync(handle, ...args);
    if (handle === r.peers[0].handle && !heldRead) { heldRead = true; wEntered.resolve(); await releaseW.promise; }
    return result;
  };
  r.runtime.spatialSupply.publish = function (view, target, ...args) { events.push({ kind: 'W', through: target }); return originalPublish.call(this, view, target, ...args); };
  try {
    publishing = r.flush(); await gEntered.promise;
    const head = await r.append(); await wEntered.promise;
    releaseG.resolve(); await pause(25);
    assert.deepEqual(events.filter(e => e.kind === 'G').map(e => e.through), [first], '第二条旧进度不能越过仍未收束的W');
    assert.equal((await r.flush()).busy, true);
    const later = await r.append(); releaseW.resolve(); const result = await publishing;
    assert.equal(result.examined, 2); assert.equal(result.published, 2);
    assert.deepEqual(events.filter(e => e.kind === 'G').map(e => e.through), [first, second]);
    const nextG = events.findIndex(e => e.kind === 'G' && e.through === second), nextWave = events.findIndex(e => e.kind === 'W' && e.through === later);
    assert(nextWave < 0 || nextG < nextWave, '有限W后旧行机会不被更新hint抢走');
    const rows = (await r.database.pool.query('SELECT through_seq,status,attempts FROM outbox WHERE session_id=$1 AND through_seq>=$2 ORDER BY through_seq', [r.sessionId, first])).rows;
    assert.deepEqual(rows, [first,second].map(through_seq => ({ through_seq, status: 'Published', attempts: 1 })).concat([head,later].map(through_seq => ({ through_seq, status: 'Pending', attempts: 0 }))));
  } finally { releaseG.resolve(); releaseW.resolve(); await publishing?.catch(() => {}); delete r.runtime.hooks.afterCommit; delete r.runtime.hooks.duringPublish; r.runtime.sync = originalSync; r.runtime.spatialSupply.publish = originalPublish; }
});

test('RG04/RG12：单条P最后G收束进入draining，冻结W的第六真实handle仍完成', { timeout: 15000 }, async t => {
  const r = await room(t, { count: 6 }), old = await r.append(); await Promise.all(r.peers.map(r.query));
  const gEntered = Promise.withResolvers(), releaseG = Promise.withResolvers(), releases = Array.from({ length: 5 }, () => Promise.withResolvers());
  const original = r.runtime.sync.bind(r.runtime), started = []; let publishing, returned = false, active = 0, peak = 0;
  r.runtime.hooks.afterCommit = async ({ command }) => { if (command === 'outbox-progress') { gEntered.resolve(); await releaseG.promise; } };
  r.runtime.sync = async (handle, ...args) => {
    const index = started.length; started.push(handle); active++; peak = Math.max(peak, active);
    try { if (index < 5) await releases[index].promise; return await original(handle, ...args); } finally { active--; }
  };
  try {
    publishing = r.flush(); publishing.then(() => { returned = true; }); await gEntered.promise;
    const head = await r.append(); await until(() => started.length === 5, '首组必须是五条真实handle');
    releaseG.resolve(); await pause(20);
    assert.equal(returned, false); assert.equal((await r.flush()).busy, true);
    releases.slice(0,4).forEach(g => g.resolve()); await until(() => active === 1, '四个读者应完成');
    assert.equal(started.length, 5, '第六条仍等整组');
    const later = await r.append(); releases[4].resolve(); const result = await publishing;
    assert.equal(started.length, 6, 'draining允许冻结波次的第六条，不开启额外波次'); assert.equal(peak, 5);
    assert.equal(new Set(started).size, 6); assert.equal(result.published, 1); assert.equal(result.examined, 1);
    for (const peer of r.peers) assert(BigInt(r.runtime.spatialSupply.cursor(r.runtime.connectionView(peer.handle))) >= BigInt(head));
    assert.deepEqual((await r.pending()).map(row => row.through_seq), [head,later]);
    assert.equal(r.runtime.listenerCount('commit'), 0); assert.equal(r.runtime.listenerCount('spatial-supply-ready'), 0);
  } finally { releaseG.resolve(); releases.forEach(g => g.resolve()); await publishing?.catch(() => {}); r.runtime.sync = original; delete r.runtime.hooks.afterCommit; }
});

for (const afterCommit of [false, true]) test(`RG05：三peer失败发生在旧G${afterCommit ? '真实COMMIT后' : '真实COMMIT前'}，成功水位与旧进度保留且等待第三者`, { timeout: 15000 }, async t => {
  const r = await room(t, { count: 3 }), old = await r.append(); await Promise.all(r.peers.map(r.query));
  const gEntered = Promise.withResolvers(), releaseG = Promise.withResolvers(), cEntered = Promise.withResolvers(), releaseC = Promise.withResolvers();
  const original = r.runtime.sync.bind(r.runtime), counts = new Map(), failure = new Error('受控新波次读取失败');
  let heldG = false, failedB = false, settled = false, publishing;
  const gate = async () => { if (!heldG) { heldG = true; gEntered.resolve(); await releaseG.promise; } };
  // 提交前变体停在G准备阶段，尚未持写锁；此时世界新提交是合法的真实交错。
  if (afterCommit) r.runtime.hooks.afterCommit = async ({ command }) => { if (command === 'outbox-progress') await gate(); };
  else r.runtime.hooks.duringPublish = gate;
  r.runtime.sync = async (handle, ...args) => {
    counts.set(handle, (counts.get(handle) ?? 0) + 1);
    if (handle === r.peers[1].handle && !failedB) { failedB = true; throw failure; }
    const result = await original(handle, ...args);
    if (handle === r.peers[2].handle) { cEntered.resolve(); await releaseC.promise; }
    return result;
  };
  try {
    publishing = r.flush(); publishing.then(() => { settled = true; }, () => { settled = true; }); await gEntered.promise;
    const head = await r.append(); await cEntered.promise;
    await until(() => r.runtime.spatialSupply.cursor(r.runtime.connectionView(r.peers[0].handle)) === head, 'A须取得真实packet证明后前进');
    assert.equal(failedB, true); assert.equal(settled, false); assert.equal((await r.flush()).busy, true);
    assert.equal(r.runtime.spatialSupply.cursor(r.runtime.connectionView(r.peers[1].handle)), old, 'B失败不能伪增水位');
    releaseG.resolve();
    await until(async () => (await r.database.pool.query('SELECT status FROM outbox WHERE session_id=$1 AND through_seq=$2', [r.sessionId, old])).rows[0].status === 'Published', '新W失败不能取消已经接纳且合法的旧G');
    assert.equal(settled, false, 'C未返回仍保有publisher'); assert.equal((await r.flush()).busy, true);
    releaseC.resolve(); await assert.rejects(publishing, error => error === failure);
    assert.equal(r.runtime.spatialSupply.cursor(r.runtime.connectionView(r.peers[0].handle)), head);
    assert.deepEqual((await r.pending()).map(row => row.through_seq), [head]);
    await r.flush(); assert.deepEqual(r.peers.map(peer => counts.get(peer.handle)), [1, 2, 1]);
    assert.deepEqual(await r.pending(), []);
    assert.deepEqual((await r.database.pool.query('SELECT status,attempts FROM outbox WHERE session_id=$1 AND through_seq=$2', [r.sessionId, old])).rows, [{ status: 'Published', attempts: 1 }]);
  } finally { releaseG.resolve(); releaseC.resolve(); await publishing?.catch(() => {}); r.runtime.sync = original; delete r.runtime.hooks.duringPublish; delete r.runtime.hooks.afterCommit; }
});

test('RG06：五个真实SQL已排队时停止并断开一peer，等待锁返回且不开第六个工作', { timeout: 15000 }, async t => {
  const r = await room(t, { count: 6 }), old = await r.append(); await Promise.all(r.peers.map(r.query));
  const worldEntered = Promise.withResolvers(), releaseWorld = Promise.withResolvers(), gEntered = Promise.withResolvers(), releaseG = Promise.withResolvers();
  const original = r.runtime.sync.bind(r.runtime), starts = []; let heldWorld = false, heldG = false, stopped = false, settled = false, writing, publishing;
  r.runtime.hooks.beforeCommit = async ({ command }) => {
    if (command === 'parallel-supply-fixture' && !heldWorld) { heldWorld = true; worldEntered.resolve(); await releaseWorld.promise; }
    if (command === 'outbox-progress' && !heldG) { heldG = true; gEntered.resolve(); await releaseG.promise; }
  };
  r.runtime.sync = async (handle, ...args) => { starts.push(handle); return original(handle, ...args); };
  try {
    writing = r.append(); await worldEntered.promise; publishing = r.flush({ isStopped: () => stopped });
    publishing.then(() => { settled = true; }, () => { settled = true; }); await pause(25);
    releaseWorld.resolve(); const head = await writing; await gEntered.promise;
    await until(async () => Number((await r.database.pool.query("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%FOR SHARE%'")).rows[0].count) === 5, '五条共享读SQL必须实际排入PostgreSQL锁等待');
    stopped = true; r.peers[0].socket.disconnect(true);
    assert.equal(r.runtime.connection(r.peers[0].handle).closing, true, '真实disconnect回调同步封闭旧连接');
    await pause(25); assert.equal(settled, false); assert.equal((await r.flush()).busy, true);
    const oldPackets = r.peers[0].batches.length;
    releaseG.resolve(); await publishing;
    assert.equal(starts.length, 5); assert.equal(r.peers[0].batches.length, oldPackets, '关闭后的旧SQL结果不能推送');
    assert((await r.pending()).some(row => row.through_seq === head));
    assert.equal(r.runtime.listenerCount('commit'), 0); assert.equal(r.database.pool.waitingCount, 0);
  } finally { releaseWorld.resolve(); releaseG.resolve(); await Promise.allSettled([writing,publishing].filter(Boolean)); r.runtime.sync = original; delete r.runtime.hooks.beforeCommit; }
});

test('RG11：双槽在途新增真实mixed读者时停止新组与G，既有peer自然收束', { timeout: 15000 }, async t => {
  const r = await room(t, { count: 6 }), first = await r.append(), second = await r.append(); await Promise.all(r.peers.map(r.query));
  const gEntered = Promise.withResolvers(), releaseG = Promise.withResolvers(), releaseW = Promise.withResolvers();
  const original = r.runtime.sync.bind(r.runtime); let gCount = 0, started = 0, publishing, settled = false;
  r.runtime.hooks.afterCommit = async ({ command }) => { if (command === 'outbox-progress' && ++gCount === 1) { gEntered.resolve(); await releaseG.promise; } };
  r.runtime.sync = async (...args) => { started++; const result = await original(...args); await releaseW.promise; return result; };
  try {
    publishing = r.flush(); publishing.then(() => { settled = true; }, () => { settled = true; }); await gEntered.promise;
    const head = await r.append(); await until(() => started === 5, '完整模式首组须已开始');
    const mixed = await r.addPeer(['spatial-v2']); assert.equal(r.runtime.spatialSupply.enabled(mixed.handle), false);
    releaseG.resolve(); await pause(20); assert.equal(settled, false); assert.equal((await r.flush()).busy, true);
    releaseW.resolve(); const result = await publishing;
    assert.equal(started, 5, 'mixed退出不能继续第六个完整能力peer'); assert.equal(gCount, 1); assert.equal(result.published, 1);
    const rows = (await r.pending()).map(row => row.through_seq); assert(rows.includes(second)); assert(rows.includes(head));
    assert.deepEqual((await r.database.pool.query('SELECT status,attempts FROM outbox WHERE session_id=$1 AND through_seq=$2', [r.sessionId, first])).rows, [{ status: 'Published', attempts: 1 }]);
    r.runtime.sync = original; delete r.runtime.hooks.afterCommit;
    await r.flush(); assert.deepEqual(await r.pending(), [], '后续轮次由原mixed路径完成剩余义务');
  } finally { releaseG.resolve(); releaseW.resolve(); await publishing?.catch(() => {}); r.runtime.sync = original; delete r.runtime.hooks.afterCommit; }
});

test('RG07：G初检后出现真实安装pending，最终持锁重枚举保留旧行', { timeout: 15000 }, async t => {
  const r = await room(t), old = await r.append(); await Promise.all(r.peers.map(r.query));
  const gEntered = Promise.withResolvers(), releaseG = Promise.withResolvers(), hold = holdNextInstallation(r.runtime);
  let publishing, subscribing, once = false;
  r.runtime.hooks.duringPublish = async () => { if (!once) { once = true; gEntered.resolve(); await releaseG.promise; } };
  try {
    publishing = r.flush(); await gEntered.promise;
    subscribing = r.rpc(r.peers[0], 'session.subscribe', { sessionId: r.sessionId }); await hold.entered;
    assert.equal(r.runtime.pendingViewInstallation(r.peers[0].handle), true);
    await r.append(); releaseG.resolve(); const result = await publishing;
    assert.equal(result.published, 0, '原helper锁内复核不能被G入场时旧覆盖替代');
    assert((await r.pending()).some(row => row.through_seq === old));
    hold.release(); validateSpatial('SnapshotV2', await subscribing); delete r.runtime.hooks.duringPublish;
    await r.flush(); assert.deepEqual(await r.pending(), []);
  } finally { releaseG.resolve(); hold.restore(); await Promise.allSettled([publishing,subscribing].filter(Boolean)); delete r.runtime.hooks.duringPublish; }
});

test('RG08：旧G在途时读完的旧授权头不会被新hint改写，换binding不发送旧结果', { timeout: 15000 }, async t => {
  const r = await room(t), old = await r.append(); await Promise.all(r.peers.map(r.query));
  const gEntered = Promise.withResolvers(), releaseG = Promise.withResolvers(), read = Promise.withResolvers(), releaseRead = Promise.withResolvers();
  const original = r.runtime.sync.bind(r.runtime), captured = []; let once = false, publishing;
  r.runtime.hooks.afterCommit = async ({ command }) => { if (command === 'outbox-progress') { gEntered.resolve(); await releaseG.promise; } };
  r.runtime.sync = async (handle, ...args) => {
    const result = await original(handle, ...args);
    if (handle === r.peers[0].handle && !once) { once = true; captured.push(structuredClone(result)); read.resolve(); await releaseRead.promise; }
    return result;
  };
  try {
    publishing = r.flush(); await gEntered.promise; const head = await r.append(); await read.promise;
    const previous = r.runtime.connectionView(r.peers[0].handle), before = r.peers[0].batches.length;
    const later = await r.append(); const taken = await r.control(r.peers[0]); validateSpatial('ControlResponseV2', taken);
    const current = r.runtime.connectionView(r.peers[0].handle); assert.notEqual(current.viewId, previous.viewId);
    assert.equal(captured[0].throughSeq, head); assert(BigInt(captured[0].throughSeq) < BigInt(later), '真实授权读已定头，新hint不能补写DTO');
    releaseG.resolve(); releaseRead.resolve(); await publishing; await pause(10);
    assert(r.peers[0].batches.slice(before).every(batch => batch.viewId !== previous.viewId), '旧结果不能跨binding发送');
    assert.equal(r.runtime.spatialSupply.cursor(current), taken.snapshot.snapshotSeq, '新binding仅沿真实snapshot证明取得baseline');
    await r.append(); validateSpatial('BatchV2', await r.query(r.peers[0]));
    const sent = r.runtime.spatialSupply.cursor(current), newer = await r.append();
    const repeated = await r.rpc(r.peers[0], 'sync.request', JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId: r.sessionId,
      viewId: current.viewId, cursor: taken.snapshot.snapshotSeq }));
    validateSpatial('BatchV2', repeated); assert(BigInt(repeated.throughSeq) <= BigInt(sent)); assert(BigInt(repeated.throughSeq) < BigInt(newer));
    assert.equal(r.runtime.spatialSupply.cursor(current), sent, '合法旧cursor授权重读不能抬高可信ceiling');
  } finally { releaseG.resolve(); releaseRead.resolve(); await publishing?.catch(() => {}); r.runtime.sync = original; delete r.runtime.hooks.afterCommit; }
});

test('RG09：W仍在途时旧G真COMMIT丢回应，owner等待W且重查不重记旧行', { timeout: 15000 }, async t => {
  const r = await room(t), first = await r.append(), second = await r.append(); await Promise.all(r.peers.map(r.query));
  const gEntered = Promise.withResolvers(), releaseG = Promise.withResolvers(), wEntered = Promise.withResolvers(), releaseW = Promise.withResolvers();
  const originalSync = r.runtime.sync.bind(r.runtime), originalConnect = r.database.pool.connect;
  let admitted = false, heldRead = false, loseCommit = false, lost = false, settled = false, publishing;
  r.runtime.hooks.duringPublish = async () => { if (!admitted) { admitted = true; gEntered.resolve(); await releaseG.promise; } };
  r.runtime.hooks.beforeCommit = ({ command }) => { if (command === 'outbox-progress' && !lost) loseCommit = true; };
  r.runtime.sync = async (...args) => {
    const result = await originalSync(...args);
    if (!heldRead) { heldRead = true; wEntered.resolve(); await releaseW.promise; }
    return result;
  };
  r.database.pool.connect = function (...args) {
    const connecting = originalConnect.apply(this, args); if (!connecting?.then) return connecting;
    return connecting.then(client => {
      const query = client.query, release = client.release;
      client.query = async function (sql, ...values) {
        const result = await query.call(this, sql, ...values);
        if (sql === 'COMMIT' && loseCommit) { loseCommit = false; lost = true; throw new Error('旧G真实COMMIT回应丢失'); }
        return result;
      };
      client.release = function (...values) { client.query = query; client.release = release; return release.apply(this, values); }; return client;
    });
  };
  const rows = () => r.database.pool.query('SELECT through_seq,status,attempts FROM outbox WHERE session_id=$1 AND through_seq IN ($2,$3) ORDER BY through_seq', [r.sessionId, first, second]).then(result => result.rows);
  try {
    publishing = r.flush(); publishing.then(() => { settled = true; }, () => { settled = true; }); await gEntered.promise;
    await r.append(); await wEntered.promise; releaseG.resolve(); await until(() => lost, '必须真实执行COMMIT后再丢回应');
    assert.equal(settled, false); assert.equal((await r.flush()).busy, true);
    assert.deepEqual(await rows(), [{ through_seq: first, status: 'Published', attempts: 1 }, { through_seq: second, status: 'Pending', attempts: 0 }]);
    releaseW.resolve(); await assert.rejects(publishing, { code: 'OUTCOME_UNKNOWN' });
    r.database.pool.connect = originalConnect; r.runtime.sync = originalSync; delete r.runtime.hooks.beforeCommit; delete r.runtime.hooks.duringPublish;
    await r.flush(); assert.deepEqual(await rows(), [first,second].map(through_seq => ({ through_seq, status: 'Published', attempts: 1 })));
    assert.equal(r.database.pool.waitingCount, 0); assert.equal(r.runtime.listenerCount('commit'), 0);
  } finally { releaseG.resolve(); releaseW.resolve(); await publishing?.catch(() => {}); r.database.pool.connect = originalConnect; r.runtime.sync = originalSync; delete r.runtime.hooks.beforeCommit; delete r.runtime.hooks.duringPublish; }
});

test('RG10：保留256分页与事务边界，每个有限W一页后旧行仍有机会', { timeout: 15000 }, async t => {
  const r = await room(t), first = await r.append(130), second = await r.append(130), third = await r.append(130);
  const original = r.runtime.spatialSupply.publish, calls = [], progress = [];
  r.runtime.spatialSupply.publish = async function (view, target, ...args) {
    const before = r.runtime.spatialSupply.cursor(view), result = await original.call(this, view, target, ...args);
    calls.push({ handle: view.handle, target, before, after: r.runtime.spatialSupply.cursor(view) }); return result;
  };
  r.runtime.hooks.duringPublish = ({ throughSeq }) => { progress.push({ throughSeq, calls: calls.length }); };
  try {
    const result = await r.flush(); assert.equal(result.examined, 3); assert.equal(result.published, 3);
    for (const peer of r.peers) {
      const pages = calls.filter(call => call.handle === peer.handle);
      assert.deepEqual(pages.map(page => page.after), [first,second,third]); assert(pages.every(page => page.target === third));
      assert(pages.every(page => BigInt(page.after) - BigInt(page.before) === 130n), '256上限内按原事务边界返回130条，不擅自拼成390条');
    }
    assert.deepEqual(progress, [{ throughSeq: first, calls: 2 }, { throughSeq: second, calls: 4 }, { throughSeq: third, calls: 6 }]);
    assert.deepEqual(await r.pending(), []);
  } finally { r.runtime.spatialSupply.publish = original; delete r.runtime.hooks.duringPublish; }
});

test('RG10/RG12：同generation安装blocked无前进不自旋，完成安装交给后续轮次', { timeout: 15000 }, async t => {
  const r = await room(t), old = await r.append(), hold = holdNextInstallation(r.runtime);
  const original = r.runtime.spatialSupply.publish; let calls = 0, subscribing;
  r.runtime.spatialSupply.publish = function (...args) { calls++; return original.apply(this, args); };
  try {
    subscribing = r.rpc(r.peers[0], 'session.subscribe', { sessionId: r.sessionId }); await hold.entered;
    const result = await r.flush(); assert.equal(result.published, 0); assert(calls <= 2, '一peer前进至多允许一次补页机会，不能追blocked自旋');
    assert((await r.pending()).some(row => row.through_seq === old));
    assert.equal(r.runtime.listenerCount('commit'), 0); assert.equal(r.runtime.listenerCount('spatial-supply-ready'), 0);
    hold.release(); validateSpatial('SnapshotV2', await subscribing); const previous = calls;
    await pause(20); assert.equal(calls, previous, '已拆除协调器的晚ready不能复活旧owner');
    await r.flush(); assert.deepEqual(await r.pending(), []);
  } finally { hold.restore(); await subscribing?.catch(() => {}); r.runtime.spatialSupply.publish = original; }
});

test('RG12：初始权威hint查询已返回但函数未放行时的新COMMIT不丢失', { timeout: 15000 }, async t => {
  const r = await room(t), old = await r.append(); await Promise.all(r.peers.map(r.query));
  const entered = Promise.withResolvers(), release = Promise.withResolvers(), original = r.database.pool.query;
  let intercepted = false, publishing;
  r.database.pool.query = async function (sql, ...args) {
    const result = await original.call(this, sql, ...args);
    if (!intercepted && sql === 'SELECT max(through_seq) AS through_seq FROM outbox WHERE session_id=$1') {
      intercepted = true; entered.resolve(); await release.promise;
    }
    return result;
  };
  try {
    publishing = r.flush(); await entered.promise;
    assert.equal(r.runtime.listenerCount('commit'), 1, '先接监听再做初始已提交查询');
    const head = await r.append(); release.resolve(); const result = await publishing;
    assert.equal(result.published, 1); assert.equal(result.examined, 1);
    for (const peer of r.peers) assert.equal(r.runtime.spatialSupply.cursor(r.runtime.connectionView(peer.handle)), head);
    assert.deepEqual((await r.pending()).map(row => row.through_seq), [head]);
    assert.equal(r.runtime.listenerCount('commit'), 0);
    const count = r.peers[0].batches.length; await r.append(); await pause(20);
    assert.equal(r.peers[0].batches.length, count, '退出后的commit不能复活原协调器');
  } finally { release.resolve(); await publishing?.catch(() => {}); r.database.pool.query = original; }
});
