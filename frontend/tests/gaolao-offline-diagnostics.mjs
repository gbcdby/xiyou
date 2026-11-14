import { performance } from 'node:perf_hooks';

const limits = Object.freeze({ events: 256, samples: 40, connectionRows: 32, identityLabels: 96, sampleIntervalMs: 500, readTimeoutMs: 1000, offlineTotalMs: 75000 });
const sequence = value => typeof value === 'string' && /^\d{1,32}$/.test(value) ? value : null;
const number = value => value !== null && value !== undefined && Number.isFinite(Number(value)) && Math.abs(Number(value)) < Number.MAX_SAFE_INTEGER ? Number(value) : null;
const member = (value, values) => values.includes(value) ? value : 'unknown';

// 本局两名受控账号的所有连接都保留，旧连接不能因只取最新记录而消失。
const connectionQuery = `
SELECT sa.user_id, sa.actor_id, s.state->>'phase' AS phase,
       (s.state->>'paused')::boolean AS paused, s.state->>'sceneTimeMs' AS scene_time_ms,
       s.session_seq::text AS session_seq, s.state->'characters'->sa.actor_id->>'mode' AS mode,
       s.state->'characters'->sa.actor_id->>'controlEpoch' AS control_epoch,
       s.state->'characters'->sa.actor_id->>'activeConnectionId' AS current_connection_id,
       c.connection_id, c.active,
       EXTRACT(EPOCH FROM (c.lease_until - clock_timestamp())) * 1000 AS lease_remaining_ms,
       COUNT(*) OVER()::text AS row_count
FROM sessions s JOIN session_access sa ON sa.session_id=s.session_id
LEFT JOIN connections c ON c.user_id=sa.user_id
WHERE s.session_id=$1 AND sa.user_id=ANY($2::text[])
ORDER BY sa.user_id,c.connection_id LIMIT 33`;

/** 仅原 A2 恢复段使用；诊断失败单列，原操作的结果和异常保持。 */
export async function recordOfflineRecovery({ runtime, pool, room, report }, operation) {
  const start = performance.now(), ms = () => Math.round((performance.now() - start) * 1000) / 1000;
  const data = report.offlineRecovery = {
    schemaVersion: 1, scope: '原 A2 两人网络失联；尾段只观察，不能将原失败翻绿', limits,
    registryEvidence: '仅 runtime.heartbeat 调用证明服务端当时仍尝试续租；无直接 socket registry 快照，transport reason 未暴露，记 unknown',
    fieldSources: {
      database: '只读同局两名成员的持久 phase/paused/clock/seq/control 及连接 active/lease 行；不是调用生产 quorum 函数',
      derivedCurrentLiveHumanCount: '诊断按 HumanControlled + 当前 activeConnectionId 对应 active 行 + lease_until > SQL clock_timestamp() 重算；不同于生产事务的逻辑时间，截断/成员缺失时为 null',
      pages: '两页当前授权 store 的连接状态及有限公开投影字段',
      authorityEvents: 'runtime commit 事件的公开时钟字段和这两人的控制字段；不复制原始载荷',
    },
    events: [], samples: [], droppedEvents: 0, droppedSamples: 0, diagnosticErrors: 0,
    firstTransitions: {}, outcome: 'RUNNING', cleanupEventsExcluded: true,
  };
  const users = room.users.slice(0, 2).map(user => user.userId), players = new Map(users.map((id, i) => [id, `P${i}`]));
  const actors = new Map(), connections = new Map(), views = new Map(), currentConnections = new Map();
  let stopped = false, sampling = null, timer, offlineStart = null, partnerConnection = null, tailDeadline = null;
  const restore = [];
  const label = (map, id, prefix) => {
    if (typeof id !== 'string') return null;
    if (map.has(id)) return map.get(id);
    if (map.size >= limits.identityLabels) { data.identityLabelsTruncated = true; return `${prefix}-overflow`; }
    const value = `${prefix}${map.size + 1}`; map.set(id, value); return value;
  };
  const append = (kind, fields = {}) => {
    const value = { ms: ms(), kind, ...fields };
    if (data.events.length === limits.events) { data.events.shift(); data.droppedEvents++; }
    data.events.push(value); return value;
  };
  const first = (key, value) => { if (offlineStart !== null && !data.firstTransitions[key]) data.firstTransitions[key] = value; };
  const error = stage => { data.diagnosticErrors++; append('diagnostic-error', { stage }); };
  const safe = (stage, task) => { try { return task(); } catch { error(stage); return undefined; } };
  const bounded = promise => new Promise((resolve, reject) => {
    const budget = tailDeadline === null ? limits.readTimeoutMs : Math.max(1, Math.min(limits.readTimeoutMs, tailDeadline - ms()));
    const timeout = setTimeout(() => reject(new Error('诊断读取超时')), budget);
    Promise.resolve(promise).then(value => { clearTimeout(timeout); resolve(value); }, failure => { clearTimeout(timeout); reject(failure); });
  });

  async function readDatabase() {
    const result = await bounded(pool.query({ text: connectionQuery, values: [room.sessionId, users], query_timeout: limits.readTimeoutMs }));
    const rows = result.rows.slice(0, limits.connectionRows), truncated = result.rows.length > limits.connectionRows || Number(result.rows[0]?.row_count) > limits.connectionRows;
    const controls = new Map(), leases = [];
    for (const row of rows) {
      const player = players.get(row.user_id); if (!player) continue;
      actors.set(row.actor_id, player); currentConnections.set(player, row.current_connection_id);
      const mode = member(row.mode, ['HumanControlled', 'GracePeriod', 'AIProxyControlled']);
      controls.set(player, { player, mode, controlEpoch: sequence(row.control_epoch), currentConnection: label(connections, row.current_connection_id, 'C') });
      if (row.connection_id) leases.push({ player, connection: label(connections, row.connection_id, 'C'), active: row.active === true,
        leaseRemainingMs: number(row.lease_remaining_ms), isCurrentControl: row.connection_id === row.current_connection_id });
    }
    const top = rows[0];
    const value = { phase: member(top?.phase, ['Lobby', 'Running', 'Finished', 'Aborted']), paused: typeof top?.paused === 'boolean' ? top.paused : null,
      sceneTimeMs: number(top?.scene_time_ms), sessionSeq: sequence(top?.session_seq), controls: [...controls.values()], connections: leases, truncated,
      derivedCurrentLiveHumanCount: truncated || controls.size !== 2 ? null : [...controls.values()].filter(control => control.mode === 'HumanControlled' && leases.some(c => c.player === control.player && c.isCurrentControl && c.active && c.leaseRemainingMs > 0)).length };
    if (value.paused) first('databasePaused', { ms: ms(), sessionSeq: value.sessionSeq });
    const oldPartner = offlineStart === null ? null : leases.find(c => c.connection === data.offlineStart.partnerConnection);
    if (oldPartner && (!oldPartner.active || (oldPartner.leaseRemainingMs !== null && oldPartner.leaseRemainingMs <= 0))) first('partnerLeaseNotLive', { ms: ms(), ...oldPartner, observedBy: 'SQL-read' });
    return value;
  }

  async function readPage(page, index) {
    const value = await bounded(page.evaluate(async () => {
      const value = (await import('/src/state/spatial-store.ts')).spatialState.value, s = value.snapshot, p = s?.projection;
      return { connection: value.connection, inputReady: value.inputReady, snapshotPresent: !!s, sessionId: s?.sessionId, viewId: s?.viewId,
        snapshotSeq: s?.snapshotSeq, phase: p?.phase, paused: p?.paused, sceneTimeMs: p?.sceneTimeMs, controlEpoch: p?.self.controlEpoch };
    }));
    const result = { player: `P${index}`, connection: member(value.connection, ['idle', 'connecting', 'online', 'offline', 'forbidden']), inputReady: value.inputReady === true,
      snapshotPresent: value.snapshotPresent === true, sameSession: value.sessionId === room.sessionId, view: label(views, value.viewId, 'V'), snapshotSeq: sequence(value.snapshotSeq),
      phase: member(value.phase, ['Lobby', 'Running', 'Finished', 'Aborted']), paused: typeof value.paused === 'boolean' ? value.paused : null, sceneTimeMs: number(value.sceneTimeMs), controlEpoch: sequence(value.controlEpoch) };
    if (index === 0 && result.sameSession && result.paused) first('publicPaused', { ms: ms(), view: result.view, snapshotSeq: result.snapshotSeq });
    if (index === 0 && result.connection !== 'online') first('leaderNotOnline', { ms: ms(), connection: result.connection });
    if (index === 1 && result.connection === 'offline') first('partnerClientOffline', { ms: ms(), connection: result.connection, snapshotPresent: result.snapshotPresent });
    return result;
  }

  function sample(reason) {
    if (stopped) return Promise.resolve(null);
    if (tailDeadline !== null && ms() >= tailDeadline) return Promise.resolve(data.samples.at(-1) ?? null);
    if (sampling) return sampling;
    sampling = (async () => {
      const began = ms();
      const values = await Promise.allSettled([readDatabase(), ...room.pages.slice(0, 2).map(readPage)]);
      if (stopped) return null;
      for (const [index, value] of values.entries()) if (value.status === 'rejected') error(index === 0 ? 'database-read' : `P${index - 1}-read`);
      const value = { reason, startedMs: began, endedMs: ms(), database: values[0].status === 'fulfilled' ? values[0].value : null,
        pages: values.slice(1).map(value => value.status === 'fulfilled' ? value.value : null) };
      if (data.samples.length === limits.samples) { data.samples.shift(); data.droppedSamples++; }
      data.samples.push(value); return value;
    })().catch(() => { error('sample'); return null; }).finally(() => { sampling = null; });
    return sampling;
  }

  function observeMethod(name) {
    const original = runtime[name], own = Object.getOwnPropertyDescriptor(runtime, name);
    const wrapped = function (...args) {
      const handle = args[0];
      const identity = safe(`${name}-identity`, () => {
        const player = players.get(runtime.connection(handle).userId);
        return player ? { player, connection: label(connections, handle.connectionId, 'C') } : null;
      });
      const observe = phase => safe(`${name}-event`, () => {
        if (!stopped && identity) {
          const e = append(`${name}.${phase}`, { ...identity, ...(name === 'disconnect' ? { reason: 'unknown' } : {}) });
          if (name === 'disconnect' && phase === 'enter' && handle.connectionId === partnerConnection) first('partnerDisconnect', e);
          if (name === 'heartbeat' && phase === 'enter' && handle.connectionId === partnerConnection) first('partnerHeartbeatAttempt', e);
        }
      });
      observe('enter'); let result;
      try { result = Reflect.apply(original, this, args); }
      catch (failure) { observe('throw'); throw failure; }
      // 只旁听完成；仍向原调用方返回同一对象，异常也不替换。
      if (result && typeof result.then === 'function') result.then(() => observe('resolved'), () => observe('rejected'));
      else observe('returned');
      return result;
    };
    runtime[name] = wrapped;
    restore.push(() => { if (runtime[name] === wrapped) { if (own) Object.defineProperty(runtime, name, own); else delete runtime[name]; } else error(`${name}-restore-conflict`); });
  }
  const committed = value => safe('commit-event', () => {
    if (stopped || value.sessionId !== room.sessionId) return;
    for (const e of value.events) {
      if (e.kind === 'spatial.clock') {
        const event = append('authority-clock', { sessionSeq: sequence(e.sessionSeq), paused: e.payload.paused === true, sceneTimeMs: number(e.payload.sceneTimeMs) });
        if (event.paused) first('authorityPaused', event);
      } else if (e.kind === 'control.changed' && actors.has(e.payload.actorId)) {
        const player = actors.get(e.payload.actorId);
        const event = append('authority-control', { player, sessionSeq: sequence(e.sessionSeq), mode: member(e.payload.mode, ['HumanControlled', 'GracePeriod', 'AIProxyControlled']), controlEpoch: sequence(e.payload.controlEpoch), connection: label(connections, e.payload.activeConnectionId, 'C') });
        if (player === 'P1' && event.mode !== 'HumanControlled') first('partnerControlChanged', event);
      }
    }
  });

  const trace = {
    mark(phase) {
      if (!['offline-requested', 'offline-applied', 'pause-assertion-passed', 'clock-freeze-verified', 'network-restored', 'control-restored'].includes(phase)) return;
      const event = append(phase);
      if (phase === 'pause-assertion-passed') data.originalAssertion = { status: 'PASS', ms: event.ms };
    },
    async beginOffline() {
      await sampling; data.offlineBaseline = await sample('offline-baseline');
      partnerConnection = currentConnections.get('P1'); offlineStart = ms();
      data.offlineStart = { ms: offlineStart, partnerConnection: label(connections, partnerConnection, 'C') };
      trace.mark('offline-requested');
    },
    async observeAfterPauseFailure(failure) {
      const at = ms();
      data.originalAssertion = { status: 'FAIL', ms: at, errorName: member(failure?.name, ['Error', 'AssertionError', 'TypeError']), original15000msTimeout: failure?.message === '等待超时：两人中一人断线后暂停（15000 ms）', latestSampleAtFailure: data.samples.at(-1) ?? null };
      append('pause-assertion-failed', { original15000msTimeout: data.originalAssertion.original15000msTimeout });
      data.failureTail = { startedMs: at, deadlineMs: offlineStart === null ? at : offlineStart + limits.offlineTotalMs, acceptanceStatus: 'FAIL', reason: 'observing' };
      tailDeadline = data.failureTail.deadlineMs;
      await sampling; data.originalAssertion.observedAfterFailure = await sample('original-failure');
      while (ms() < data.failureTail.deadlineMs) {
        const latest = data.samples.at(-1), leader = latest?.pages[0], world = latest?.database;
        if (!leader || leader.connection !== 'online' || !leader.sameSession || !world || world.truncated || world.derivedCurrentLiveHumanCount === null || data.firstTransitions.leaderNotOnline || data.identityLabelsTruncated) { data.failureTail.reason = 'unknown-or-leader-offline'; break; }
        const lead = world.controls.find(c => c.player === 'P0');
        const partner = world.controls.find(c => c.player === 'P1');
        const old = world.connections.find(c => c.connection === data.offlineStart.partnerConnection);
        if (!old || !partner || partner.mode === 'unknown' || lead?.mode !== 'HumanControlled' || !world.connections.some(c => c.player === 'P0' && c.isCurrentControl && c.active && c.leaseRemainingMs > 0)) { data.failureTail.reason = 'unknown-or-leader-offline'; break; }
        if (data.firstTransitions.partnerDisconnect && old?.active === false && partner?.mode !== 'HumanControlled' && world.paused && leader.paused) { data.failureTail.reason = 'natural-disconnect-and-pause-observed'; break; }
        await new Promise(resolve => setTimeout(resolve, Math.min(limits.sampleIntervalMs, data.failureTail.deadlineMs - ms())));
        await sample('failure-tail');
      }
      if (data.failureTail.reason === 'observing') data.failureTail.reason = '75s-deadline';
      data.failureTail.finishedMs = ms();
      append('failure-tail-ended', { reason: data.failureTail.reason });
    },
  };

  try {
    safe('disconnect-observer', () => observeMethod('disconnect')); safe('heartbeat-observer', () => observeMethod('heartbeat'));
    safe('commit-listener', () => runtime.on('commit', committed));
    data.baseline = await sample('baseline');
    timer = setInterval(() => { void sample('periodic'); }, limits.sampleIntervalMs); timer.unref?.();
    const result = await operation(trace); data.outcome = 'PASS'; return result;
  } catch (failure) {
    data.outcome = 'FAIL'; data.operationFailureMs = ms(); append('assertion-failed'); throw failure;
  } finally {
    clearInterval(timer);
    await sampling; await sample('operation-end');
    stopped = true; safe('commit-unsubscribe', () => runtime.off('commit', committed));
    for (const undo of restore.reverse()) safe('method-restore', undo);
    append('diagnostic-stopped', { outcome: data.outcome }); data.finishedMs = ms();
  }
}
