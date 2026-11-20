import { RuntimeError } from './errors.mjs';
import { decodeJsonbText } from './jsonb-text.mjs';
import { entityRef } from '../game/spatial-world.mjs';

const caches = new WeakMap();
const samePoint = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y;
const invalid = () => { throw new RuntimeError('RESYNC_REQUIRED', '所需游标区间没有完整连续的已执行轨迹。'); };
function anchor(state, actorId) {
  const actor = state.characters[actorId], view = state.views[actorId];
  return actor?.position && view ? {
    viewId: view.viewId, entityRef: entityRef(view, actorId), mapVersion: state.mapVersion,
    sceneId: actor.sceneId, controlEpoch: actor.controlEpoch, appearanceEpoch: actor.appearanceEpoch,
    position: { ...actor.position }, sceneTimeMs: state.sceneTimeMs,
    movementActive: ['accepted', 'moving'].includes(actor.movement?.status),
  } : null;
}
const sameIdentity = (a, b) => a && b && ['viewId', 'entityRef', 'mapVersion', 'sceneId', 'controlEpoch', 'appearanceEpoch'].every(key => a[key] === b[key]);

/** 缓存仅保存已提交游标的本人锚点；显式旧 cursor 从不借用发布器当前游标。 */
function cacheFor(runtime) {
  let cache = caches.get(runtime);
  if (!cache) { cache = new Map(); caches.set(runtime, cache); }
  return cache;
}
function remember(cache, key, value) {
  cache.set(key, value);
  if (cache.size > 1024) cache.delete(cache.keys().next().value);
}

export async function executedSelfTrail(runtime, tx, actorId, request, throughSeq, after, { timed = false } = {}) {
  const cache = cacheFor(runtime), key = seq => JSON.stringify([request.sessionId, actorId, request.viewId, seq]);
  let first = cache.get(key(request.cursor));
  if (first === undefined) {
    first = anchor(await runtime.stateAt(tx, request.cursor), actorId);
    remember(cache, key(request.cursor), first);
  }
  const last = anchor(after, actorId);
  remember(cache, key(throughSeq), last);
  // 新场景、控制代次、外观或视图必须交给客户端建立新基线，不能跨身份续画。
  if (!sameIdentity(first, last)) return null;
  const rows = (await tx.client.query('SELECT event,event_text_encoding FROM world_events WHERE session_id=$1 AND session_seq>$2 AND session_seq<=$3 ORDER BY session_seq', [request.sessionId, request.cursor, throughSeq])).rows;
  const trail = [{ ...first.position }];
  let position = first.position, sequence = BigInt(request.cursor), clock = first.sceneTimeMs, motionThrough = first.sceneTimeMs;
  let movementActive = first.movementActive;
  const timeline = [];
  const appendSpan = (kind, from, through, fromIndex, throughIndex) => {
    const previous = timeline.at(-1);
    // 完整事件已证明的相邻静止可合并，真实运动区间仍逐事件保留原时长。
    if (kind === 'hold' && previous?.kind === 'hold' && previous.throughSceneTimeMs === from && previous.throughTrailIndex === fromIndex) {
      previous.throughSceneTimeMs = through; previous.throughTrailIndex = throughIndex;
    } else timeline.push({ kind, fromSceneTimeMs: from, throughSceneTimeMs: through, fromTrailIndex: fromIndex, throughTrailIndex: throughIndex });
    if (timeline.length > 4096) invalid();
  };
  for (const row of rows) {
    const event = decodeJsonbText(row.event, row.event_text_encoding);
    if (event.sessionId !== request.sessionId || BigInt(event.sessionSeq) !== ++sequence) invalid();
    const payload = event.payload;
    if (event.kind === 'control.changed' && payload.actorId === actorId || ['session.finished', 'session.aborted'].includes(event.kind)) return null;
    if (event.kind === 'spatial.view' && payload.actorId === actorId && (payload.view.viewId !== first.viewId || entityRef(payload.view, actorId) !== first.entityRef)) return null;
    if (event.kind === 'spatial.clock') {
      if (payload.sceneTimeMs < clock) invalid();
      clock = payload.sceneTimeMs;
      if (timed && clock > motionThrough) {
        // 活动计划缺少对应执行事件时，不能把未知区间猜成可抵扣的静止。
        if (movementActive) invalid();
        appendSpan('hold', motionThrough, clock, trail.length - 1, trail.length - 1);
        motionThrough = clock;
      }
    }
    if (event.kind !== 'spatial.actor' || payload.actor.characterId !== actorId) continue;
    const actor = payload.actor;
    if (actor.sceneId !== first.sceneId || actor.controlEpoch !== first.controlEpoch || actor.appearanceEpoch !== first.appearanceEpoch) return null;
    const motion = actor.publicMotionViews?.[actorId];
    if (timed) {
      movementActive = ['accepted', 'moving'].includes(actor.movement?.status);
      // 新计划可复制上次publicMotion；只有新时间区间才入队，零几何也不能漏掉。
      if (samePoint(position, actor.position) && (!motion || motion.motionThroughSceneTimeMs <= motionThrough)) continue;
    } else if (samePoint(position, actor.position)) continue;
    if (!motion || motion.viewId !== first.viewId || motion.sceneId !== first.sceneId || motion.appearanceEpoch !== first.appearanceEpoch || !Array.isArray(motion.motionTrail) || motion.motionTrail.length < 2 || !samePoint(motion.motionTrail[0], position) || !samePoint(motion.motionTrail.at(-1), actor.position) || motion.motionFromSceneTimeMs < motionThrough || motion.motionThroughSceneTimeMs < motion.motionFromSceneTimeMs || motion.motionThroughSceneTimeMs > last.sceneTimeMs) invalid();
    if (timed && (motion.motionFromSceneTimeMs !== motionThrough || motion.motionThroughSceneTimeMs <= motion.motionFromSceneTimeMs)) invalid();
    const fromIndex = trail.length - 1;
    for (const point of motion.motionTrail.slice(1)) {
      if (!samePoint(trail.at(-1), point)) trail.push({ ...point });
      if (trail.length > 4096) invalid();
    }
    position = actor.position;
    if (timed) appendSpan('motion', motion.motionFromSceneTimeMs, motion.motionThroughSceneTimeMs, fromIndex, trail.length - 1);
    motionThrough = motion.motionThroughSceneTimeMs;
  }
  if (sequence !== BigInt(throughSeq) || clock !== last.sceneTimeMs || !samePoint(position, last.position)) invalid();
  if (timed && motionThrough !== last.sceneTimeMs) invalid();
  if (trail.length === 1) {
    trail.push({ ...trail[0] });
    if (timed && timeline.length) timeline.at(-1).throughTrailIndex = 1;
  }
  if (timed && !timeline.length) appendSpan('hold', first.sceneTimeMs, last.sceneTimeMs, 0, 1);
  return { motionTrail: trail, motionFromSceneTimeMs: first.sceneTimeMs, motionThroughSceneTimeMs: last.sceneTimeMs, ...(timed ? { motionTimeline: timeline } : {}) };
}

/** 本人实体及全景中的同 ref 使用同一区间；其他角色继续原授权投影。 */
export function applySelfTrail(projection, motion) {
  for (const entity of [...projection.entities, ...(projection.sceneOverview?.entities ?? [])]) {
    if (entity.entityRef !== projection.self.entityRef) continue;
    delete entity.motionTrail; delete entity.motionFromSceneTimeMs; delete entity.motionThroughSceneTimeMs;
    delete entity.motionTimeline;
    if (motion) Object.assign(entity, motion);
  }
}
