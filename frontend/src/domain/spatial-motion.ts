import type { EntityViewV2, Facing, PlanViewV2, Position, SnapshotV2 } from '../../../game/spatial-types.ts';
import { sceneDisplayProjection } from './spatial-display.ts';

const length = (a: Position, b: Position) => Math.hypot(a.x - b.x, a.y - b.y);
const same = (a: Position, b: Position) => a.x === b.x && a.y === b.y;
export function sampleTrail(points: Position[], fraction: number): Position {
  const total = points.slice(1).reduce((sum, p, i) => sum + length(points[i], p), 0);
  let remaining = total * Math.max(0, Math.min(1, fraction));
  for (let i = 1; i < points.length; i++) {
    const size = length(points[i - 1], points[i]);
    if (remaining <= size && size > 0) { const t = remaining / size; return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, y: points[i - 1].y + (points[i].y - points[i - 1].y) * t }; }
    remaining -= size;
  }
  return { ...points.at(-1)! };
}
/** 只截取已知折线上的已确认区间；找不到端点时不猜直线。 */
export function confirmedSegment(path: Position[], from: Position, through: Position): Position[] | null {
  if (!path.length) return null;
  const locate = (point: Position) => {
    let distance = 0; let best: { distance: number; error: number } | null = null;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i]; const size = length(a, b);
      const t = size ? Math.max(0, Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / size ** 2)) : 0;
      const projected = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; const error = length(point, projected);
      if (!best || error < best.error) best = { distance: distance + size * t, error }; distance += size;
    }
    return best;
  };
  const a = locate(from), b = locate(through);
  if (!a || !b || a.error > 1.5 || b.error > 1.5 || b.distance < a.distance) return null;
  let distance = 0; const result = [{ ...from }];
  for (let i = 1; i < path.length; i++) { distance += length(path[i - 1], path[i]); if (distance > a.distance && distance < b.distance) result.push({ ...path[i] }); }
  result.push({ ...through }); return result;
}
/** 一次投影跨过相邻计划时，只沿两条权威折线拼接已经走过的区间。 */
function confirmedPlanBridge(previous: PlanViewV2 | null | undefined, current: PlanViewV2, from: Position, through: Position, fromTime: number, throughTime: number, mapVersion: string): Position[] | null {
  if (!previous || !mapVersion || previous.sceneId !== current.sceneId || previous.mapVersion !== mapVersion || current.mapVersion !== mapVersion || previous.movementId === current.movementId) return null;
  const adjacent = (a: string, b: string) => /^(0|[1-9]\d*)$/.test(a) && /^(0|[1-9]\d*)$/.test(b) && BigInt(b) === BigInt(a) + 1n;
  if (!adjacent(previous.movementCommandSeq, current.movementCommandSeq) || !adjacent(previous.planVersion, current.planVersion)) return null;
  if (!['accepted', 'moving', 'arrived'].includes(previous.status) || !['accepted', 'moving', 'arrived'].includes(current.status)) return null;
  if (!Number.isFinite(previous.acceptedAtSceneTime) || !Number.isFinite(current.acceptedAtSceneTime) || previous.acceptedAtSceneTime > fromTime || current.acceptedAtSceneTime < fromTime || current.acceptedAtSceneTime > throughTime) return null;
  const joint = current.path[0]; if (!joint) return null;
  const before = confirmedSegment(previous.path, from, joint), after = confirmedSegment(current.path, joint, through);
  return before && after ? [...before, ...after.slice(1)] : null;
}
const trailLength = (points: Position[]) => points.slice(1).reduce((sum, point, index) => sum + length(points[index], point), 0);
const directionOf = (from: Position, through: Position): Facing => (['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'] as Facing[])[(Math.round(Math.atan2(through.y - from.y, through.x - from.x) / (Math.PI / 4)) + 8) % 8];
interface Motion { position: Position; trail: Position[] | null; startedAt: number; duration: number; distanceBefore: number; facing: Facing; continuing: boolean }
export interface DrawnPose { position: Position; facing: Facing; moving: boolean; distance: number }
export interface MotionPresentation extends DrawnPose {
  identity: string; reference: string; renderer: string; serial: number; sampledAt: number; presentedAt: number;
}
/** 标识来自已接受的完整本人绑定，不以坐标或最新计划代替身份。 */
export function motionPresentationIdentity(snapshot: SnapshotV2): string {
  const p = snapshot.projection, self = p.self;
  return JSON.stringify([snapshot.sessionId, snapshot.viewId, self.entityRef, self.controlEpoch, p.mapVersion, self.sceneId, self.appearanceEpoch, self.appearanceId]);
}
interface TimedPiece { kind: 'motion' | 'hold' | 'legacy'; trail: Position[]; duration: number; sceneFrom?: number; sceneThrough?: number }
interface TimedSegment extends TimedPiece { startedAt: number; before: DrawnPose }
interface TimedMotion { base: DrawnPose; segments: TimedSegment[]; anchor?: number }

function piecePose(piece: TimedSegment, now: number): DrawnPose {
  const fraction = Math.max(0, Math.min(1, (now - piece.startedAt) / piece.duration));
  const total = trailLength(piece.trail); let remaining = total * fraction, facing = piece.before.facing;
  for (let i = 1; i < piece.trail.length; i++) {
    const size = length(piece.trail[i - 1], piece.trail[i]);
    if (size > 0) facing = directionOf(piece.trail[i - 1], piece.trail[i]);
    if (remaining <= size && size > 0) break;
    remaining -= size;
  }
  return { position: sampleTrail(piece.trail, fraction), facing, moving: piece.kind !== 'hold' && total > 0 && fraction < 1,
    distance: piece.before.distance + total * fraction };
}
function timedPose(value: TimedMotion, now: number): DrawnPose {
  let pose = value.base;
  for (const piece of value.segments) {
    if (now < piece.startedAt) return { ...pose, moving: false };
    pose = piecePose(piece, now);
    if (now < piece.startedAt + piece.duration) break;
  }
  return pose;
}
function appendTimed(value: TimedMotion, pieces: TimedPiece[], now: number) {
  while (value.segments[0] && now >= value.segments[0].startedAt + value.segments[0].duration) {
    const completed = value.segments.shift()!; value.base = piecePose(completed, completed.startedAt + completed.duration);
  }
  const timed = pieces.filter(piece => piece.duration > 0 && piece.sceneFrom !== undefined && piece.sceneThrough !== undefined);
  if (timed.length && value.anchor === undefined) value.anchor = now - timed[0].sceneFrom!;
  const last = value.segments.at(-1); let at = last ? last.startedAt + last.duration : now;
  let before = last ? piecePose(last, at) : value.base;
  for (const piece of pieces) {
    if (piece.duration <= 0) continue;
    // 权威端点共用一个墙钟锚点，尚未收到的区间不能被算作已播放。
    // 供给迟到只把新段及其后续锚点向后顺延；旧余段、逐段时长与转角保持。
    const authoritativeAt = value.anchor !== undefined && piece.sceneFrom !== undefined ? piece.sceneFrom + value.anchor : null;
    const startedAt = Math.max(now, at, authoritativeAt ?? now);
    if (authoritativeAt !== null && startedAt > authoritativeAt) value.anchor = startedAt - piece.sceneFrom!;
    const segment: TimedSegment = { ...piece, trail: piece.trail.map(point => ({ ...point })), startedAt, before };
    const end = startedAt + segment.duration;
    value.segments.push(segment); at = end; before = piecePose(segment, end);
  }
}
function remainingTrail(points: Position[], travelled: number, position: Position): Position[] {
  const remaining = [{ ...position }]; let distance = 0;
  for (let i = 1; i < points.length; i++) { distance += length(points[i - 1], points[i]); if (distance > travelled) remaining.push(points[i]); }
  return remaining;
}

/** 绘制缓存只播放已发生且已授权的轨迹，永远不回写权威投影。 */
export class ConfirmedMotion {
  #previous: SnapshotV2 | null = null; #motions = new Map<string, Motion>();
  #timed = new Map<string, TimedMotion>();
  #presented: (MotionPresentation & { eligibleFrom: number }) | null = null;
  #lastPresentation: { renderer: string; serial: number } | null = null;
  #credit: { identity: string; renderer: string; position: Position; through: number; remaining: number } | null = null;
  get presentationCreditMs(): number { return this.#credit?.remaining ?? 0; }
  /** 只有画布owner在成功可见提交后调用；姿态查询与状态应用均不能开启账本。 */
  presentSelf(proof: MotionPresentation): boolean {
    const snapshot = this.#previous;
    if (this.#presented) this.invalidatePresentation();
    if (!snapshot || proof.identity !== motionPresentationIdentity(snapshot) || proof.reference !== snapshot.projection.self.entityRef
      || !Number.isFinite(proof.sampledAt) || !Number.isFinite(proof.presentedAt) || proof.presentedAt < proof.sampledAt
      || !Number.isSafeInteger(proof.serial) || proof.serial <= 0) return false;
    if (this.#lastPresentation?.renderer === proof.renderer && proof.serial <= this.#lastPresentation.serial) return false;
    if (this.#lastPresentation?.renderer !== proof.renderer) this.#credit = null;
    this.#lastPresentation = { renderer: proof.renderer, serial: proof.serial };
    const pose = this.pose(proof.reference, proof.sampledAt);
    if (!pose || !same(pose.position, proof.position) || pose.distance !== proof.distance || pose.facing !== proof.facing || pose.moving || proof.moving
      || this.#motions.get(proof.reference)?.continuing || ['accepted', 'moving'].includes(snapshot.projection.movement?.status ?? '')) return false;
    let eligibleFrom = proof.presentedAt;
    if (!this.settled(proof.reference, proof.sampledAt)) {
      const queue = this.#timed.get(proof.reference);
      const person = sceneDisplayProjection(snapshot.projection).entities.find(value => value.entityRef === proof.reference);
      if (!queue || !person?.motionTimeline) return false;
      // 本次真实帧只保存当场完整纯hold尾；尾时刻本身不产生呈现或余额。
      for (const piece of queue.segments) {
        const endAt = piece.startedAt + piece.duration;
        if (endAt <= proof.sampledAt) continue;
        if (!Number.isFinite(endAt) || piece.kind !== 'hold' || !piece.trail.every(point => same(point, proof.position))) return false;
        const end = piecePose(piece, endAt);
        if (!same(end.position, proof.position) || end.distance !== proof.distance || end.facing !== proof.facing || end.moving) return false;
        eligibleFrom = Math.max(eligibleFrom, endAt);
      }
    }
    if (this.#credit && (this.#credit.identity !== proof.identity || !same(this.#credit.position, proof.position))) this.#credit = null;
    if (this.#credit && proof.presentedAt < this.#credit.through) return false;
    this.#presented = { ...proof, position: { ...proof.position }, eligibleFrom }; return true;
  }
  /** 在下一次画布写入或状态应用前封口；只结算此前真正成功绘出的静止区间。 */
  sealPresentation(at: number) {
    const proof = this.#presented; this.#presented = null;
    if (!proof) return;
    if (!Number.isFinite(at) || at < proof.presentedAt || !this.#previous || proof.identity !== motionPresentationIdentity(this.#previous)) { this.invalidatePresentation(); return; }
    const old = this.#credit;
    const compatible = old?.identity === proof.identity && old.renderer === proof.renderer && same(old.position, proof.position);
    const from = Math.max(proof.eligibleFrom, compatible ? old.through : proof.presentedAt);
    if (at <= from) return; // 未越过完整尾时仍销毁凭据，不能把已计边界推到未来。
    this.#credit = { identity: proof.identity, renderer: proof.renderer, position: { ...proof.position }, through: at,
      remaining: (compatible ? old.remaining : 0) + (at - from) };
  }
  /** 失去可见性或可靠绑定后，旧像素与未用信用都不能跨中断恢复。 */
  invalidatePresentation() { this.#presented = null; this.#credit = null; }
  /** 订阅reset或显示owner失败后，只能以新的当前快照重新建立基线。 */
  reset() { this.#previous = null; this.#motions.clear(); this.#timed.clear(); this.invalidatePresentation(); }
  update(snapshot: SnapshotV2, now: number) {
    // 缺少owner封口是证据缺口，不能由本次update倒推可见起点。
    if (this.#presented) this.invalidatePresentation();
    const previous = this.#previous;
    const continuous = previous?.viewId === snapshot.viewId && previous.projection.self.controlEpoch === snapshot.projection.self.controlEpoch
      && previous.projection.mapVersion === snapshot.projection.mapVersion && previous.projection.self.entityRef === snapshot.projection.self.entityRef
      && previous.projection.self.sceneId === snapshot.projection.self.sceneId && previous.projection.self.appearanceEpoch === snapshot.projection.self.appearanceEpoch
      && previous.projection.self.appearanceId === snapshot.projection.self.appearanceId;
    if (!continuous) { this.#motions.clear(); this.#timed.clear(); this.invalidatePresentation(); }
    const p = sceneDisplayProjection(snapshot.projection), before = previous ? sceneDisplayProjection(previous.projection) : null;
    const seen = new Set<string>();
    const people: EntityViewV2[] = [{ ...p.entities.find(e => e.entityRef === p.self.entityRef), ...p.self }, ...p.entities.filter(e => e.entityRef !== p.self.entityRef)];
    for (const person of people) {
      if (!person.position || person.sceneId !== p.self.sceneId) continue;
      seen.add(person.entityRef);
      const isSelf = person.entityRef === p.self.entityRef;
      const prior = continuous ? (isSelf ? before!.self : before!.entities.find(e => e.entityRef === person.entityRef)) : null;
      const old = this.#motions.get(person.entityRef); let trail: Position[] | null = null; let duration = 0; let distanceBefore = 0;
      const continuing = !p.paused && (isSelf ? ['accepted', 'moving'].includes(p.movement?.status ?? '') : p.sceneOverview?.entities.find(e => e.entityRef === person.entityRef)?.moving === true);
      if (prior?.position && prior.sceneId === person.sceneId && prior.appearanceEpoch === person.appearanceEpoch) {
        const timed = this.#timed.get(person.entityRef);
        if (isSelf && (person.motionTimeline || timed)) {
          const hasTrail = person.motionTrail && person.motionFromSceneTimeMs === before!.sceneTimeMs && person.motionThroughSceneTimeMs !== undefined
            && same(person.motionTrail[0], prior.position) && same(person.motionTrail.at(-1)!, person.position);
          const repeated = snapshot.snapshotSeq === previous!.snapshotSeq && p.sceneTimeMs === before!.sceneTimeMs;
          const alreadyCovered = same(prior.position, person.position) && person.motionThroughSceneTimeMs !== undefined && person.motionThroughSceneTimeMs <= before!.sceneTimeMs;
          if (repeated || alreadyCovered || !person.motionTimeline && !hasTrail && same(prior.position, person.position)) {
            if (timed) { appendTimed(timed, [], now); continue; }
            if (old) { this.#motions.set(person.entityRef, { ...old, continuing }); continue; }
          } else if (hasTrail) {
            const queueWasEmpty = this.settled(person.entityRef, now);
            const beforePose = timedPoseOrLegacy(this, person.entityRef, now, prior.position, person.facing);
            const queue = timed ?? { base: { ...beforePose, moving: false }, segments: [] };
            if (!timed && old?.trail && now < old.startedAt + old.duration) {
              const travelled = trailLength(old.trail) * Math.max(0, Math.min(1, (now - old.startedAt) / old.duration));
              appendTimed(queue, [{ kind: 'legacy', trail: remainingTrail(old.trail, travelled, beforePose.position), duration: old.startedAt + old.duration - now }], now);
            }
            const pieces: TimedPiece[] = person.motionTimeline
              ? person.motionTimeline.map(span => ({ kind: span.kind, trail: person.motionTrail!.slice(span.fromTrailIndex, span.throughTrailIndex + 1), duration: span.throughSceneTimeMs - span.fromSceneTimeMs,
                sceneFrom: span.fromSceneTimeMs, sceneThrough: span.throughSceneTimeMs }))
              : [{ kind: 'legacy', trail: person.motionTrail!, duration: person.motionThroughSceneTimeMs! - person.motionFromSceneTimeMs! }];
            const credit = this.#credit;
            const firstTimed = pieces.find(piece => piece.duration > 0 && piece.sceneFrom !== undefined);
            if (firstTimed && (queue.anchor === undefined || queueWasEmpty)) {
              queue.anchor = Math.max(queue.anchor ?? -Infinity, now - firstTimed.sceneFrom!);
            }
            if (person.motionTimeline && queueWasEmpty && credit?.identity === motionPresentationIdentity(snapshot) && same(credit.position, beforePose.position)) {
              for (let index = 0; index < pieces.length; index++) {
                const piece = pieces[index];
                if (piece.kind !== 'hold' || piece.duration <= 0) break;
                const consumed = Math.min(piece.duration, credit.remaining); piece.duration -= consumed; credit.remaining -= consumed;
                // 只消费在同点真实呈现过的领先hold；权威后续端点不改写。
                // 锚点与剩余hold起点一起移动，避免下一批重新补入已抵扣的静止。
                if (piece.sceneFrom !== undefined) piece.sceneFrom += consumed;
                if (queue.anchor !== undefined) queue.anchor -= consumed;
                if (piece.duration > 0) break;
              }
            }
            // 正常待播段占用自己的时间；一旦将走过运动，旧点的剩余信用不能抵后方hold。
            if (pieces.some(piece => piece.kind !== 'hold')) this.#credit = null;
            appendTimed(queue, pieces, now); this.#timed.set(person.entityRef, queue); this.#motions.delete(person.entityRef); continue;
          }
          // 无法证明覆盖连续时建立当前授权基线，不猜补中间路线。
          const priorDistance = this.pose(person.entityRef, now)?.distance ?? 0;
          this.#timed.delete(person.entityRef);
          this.invalidatePresentation();
          this.#motions.set(person.entityRef, { position: { ...person.position }, trail: null, duration: 0, startedAt: now,
            distanceBefore: priorDistance, facing: person.facing, continuing: false });
          continue;
        }
        if (same(prior.position, person.position) && old && (isSelf || person.motionTrail)) { this.#motions.set(person.entityRef, { ...old, continuing }); continue; }
        if (person.motionTrail && person.motionFromSceneTimeMs !== undefined && person.motionThroughSceneTimeMs !== undefined && person.motionFromSceneTimeMs === before!.sceneTimeMs && person.motionTrail.length >= 2 && same(person.motionTrail[0], prior.position) && same(person.motionTrail.at(-1)!, person.position)) {
          trail = person.motionTrail; duration = person.motionThroughSceneTimeMs - person.motionFromSceneTimeMs;
        } else if (isSelf && p.movement?.sceneId === person.sceneId) {
          // 计划替换时先保留旧计划的已确认区段；从不把两个未知端点直连穿墙。
          trail = confirmedSegment(p.movement.path, prior.position, person.position)
            ?? (before?.movement?.sceneId === person.sceneId ? confirmedSegment(before.movement.path, prior.position, person.position) : null)
            ?? (before?.mapVersion === p.mapVersion ? confirmedPlanBridge(before?.movement, p.movement, prior.position, person.position, before!.sceneTimeMs, p.sceneTimeMs, p.mapVersion) : null);
          duration = p.sceneTimeMs - before!.sceneTimeMs;
        }
        if (trail && old) {
          const pose = this.pose(person.entityRef, now)!;
          distanceBefore = pose.distance;
          if (old.trail && now < old.startedAt + old.duration) {
            // 按已经播过的路程截取，折返路径中的同一坐标不能被误认成更早的端点。
            const travelled = trailLength(old.trail) * Math.max(0, Math.min(1, (now - old.startedAt) / old.duration));
            const remaining = [pose.position]; let distance = 0;
            for (let i = 1; i < old.trail.length; i++) {
              distance += length(old.trail[i - 1], old.trail[i]);
              if (distance > travelled) remaining.push(old.trail[i]);
            }
            trail = [...remaining, ...trail.slice(1)];
            // 已确认的旧余段和其剩余播放时间必须一起保留，不能压入新段而加速。
            duration += old.startedAt + old.duration - now;
          }
        }
      }
      if (isSelf && (!prior?.position || !same(prior.position, person.position))) this.invalidatePresentation();
      this.#motions.set(person.entityRef, { position: { ...person.position }, trail: duration > 0 ? trail : null, startedAt: now, duration: Math.max(0, duration), distanceBefore, facing: person.facing, continuing });
    }
    for (const reference of this.#motions.keys()) if (!seen.has(reference)) this.#motions.delete(reference);
    for (const reference of this.#timed.keys()) if (!seen.has(reference)) this.#timed.delete(reference);
    this.#previous = structuredClone(snapshot);
  }
  position(reference: string, now: number): Position | null {
    return this.pose(reference, now)?.position || null;
  }
  /** 位置、朝向和步态共用确认路径；查询与真实绘制都不能以活动计划掩盖供给断粮。 */
  pose(reference: string, now: number, _sampledForPaint = false): DrawnPose | null {
    const timed = this.#timed.get(reference);
    if (timed) return timedPose(timed, now);
    const value = this.#motions.get(reference); if (!value) return null;
    if (!value.trail || value.duration <= 0) return { position: value.position, facing: value.facing, moving: false, distance: value.distanceBefore };
    const fraction = Math.max(0, Math.min(1, (now - value.startedAt) / value.duration));
    const total = trailLength(value.trail); let remaining = total * fraction; let facing = value.facing;
    for (let index = 1; index < value.trail.length; index++) {
      const size = length(value.trail[index - 1], value.trail[index]);
      if (size > 0) facing = directionOf(value.trail[index - 1], value.trail[index]);
      if (remaining <= size && size > 0) break;
      remaining -= size;
    }
    return { position: sampleTrail(value.trail, fraction), facing, moving: (fraction < 1 || value.continuing) && total > 0, distance: value.distanceBefore + total * fraction };
  }
  /** 视觉到达只排除待播运动；尾部hold仍按原时间播放，不能据此开启呈现信用。 */
  hasPendingMotion(reference: string, now: number): boolean {
    if (!Number.isFinite(now)) return true;
    const timed = this.#timed.get(reference);
    // wire不携带原travelled，motion即使几何为零也必须等到原时间结束。
    if (timed) return timed.segments.some(piece => now < piece.startedAt + piece.duration
      && (piece.kind === 'motion' || piece.kind === 'legacy' && trailLength(piece.trail) > 0));
    const value = this.#motions.get(reference);
    if (!value) return true;
    return Boolean(value.trail && value.duration > 0 && now < value.startedAt + value.duration && trailLength(value.trail) > 0);
  }
  settled(reference: string, now: number): boolean {
    const timed = this.#timed.get(reference); if (timed) { const last = timed.segments.at(-1); return !last || now >= last.startedAt + last.duration; }
    const value = this.#motions.get(reference); return !value?.trail || now >= value.startedAt + value.duration;
  }
  active(now: number): boolean { return [...this.#motions.values()].some(value => value.trail && now < value.startedAt + value.duration)
    || [...this.#timed.values()].some(value => { const last = value.segments.at(-1); return last && now < last.startedAt + last.duration; }); }
}

function timedPoseOrLegacy(motion: ConfirmedMotion, reference: string, now: number, position: Position, facing: Facing): DrawnPose {
  return motion.pose(reference, now) ?? { position: { ...position }, facing, moving: false, distance: 0 };
}
