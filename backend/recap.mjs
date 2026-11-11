import { createHash } from 'node:crypto';
import { compareDecimal, validateContract } from '../protocol/index.mjs';
import { RuntimeError } from './errors.mjs';

const kinds = Object.freeze(['ObservationRecorded', 'ClaimRecorded', 'character.moved', 'item.taken', 'item.transferred', 'item.used', 'target.updated', 'session.finished', 'session.aborted']);
const decimal = /^(0|[1-9][0-9]*)(?![\s\S])/;
const positive = /^[1-9][0-9]*(?![\s\S])/;
const invalid = () => { throw new RuntimeError('INVALID_MESSAGE', '复盘水位或分页参数无效。'); };

export function parseRecapQuery(parameters) {
  const names = [...parameters.keys()];
  if (!names.includes('throughSeq') || names.some(key => !['throughSeq', 'beforeSeq'].includes(key)) || new Set(names).size !== names.length) invalid();
  return validateQuery(Object.fromEntries(parameters));
}

function validateQuery(query) {
  if (!query || typeof query !== 'object' || Array.isArray(query) || Object.keys(query).some(key => !['throughSeq', 'beforeSeq'].includes(key))) invalid();
  if (!Object.hasOwn(query, 'throughSeq') || typeof query.throughSeq !== 'string' || !decimal.test(query.throughSeq)) invalid();
  if (Object.hasOwn(query, 'beforeSeq') && (typeof query.beforeSeq !== 'string' || !positive.test(query.beforeSeq) || compareDecimal(query.beforeSeq, query.throughSeq) > 0)) invalid();
  return query;
}

/** 只使用该条已经授权的 payload；不跟随 source/subject 反查隐藏对象。 */
function projectEvent(event) {
  const p = event.payload;
  const entry = {
    entryId: 'R-' + createHash('sha256').update(event.sessionId + ':' + event.sessionSeq).digest('hex'),
    eventSeq: event.sessionSeq, serverTime: event.serverTime,
    category: 'WorldFact', kind: '', actorId: null, text: '', fields: [], references: [],
  };
  const reference = (kind, id) => { if (id && !entry.references.some(item => item.kind === kind && item.id === id)) entry.references.push({ kind, id }); };
  const field = (key, label, value) => entry.fields.push({ key, label, value });
  switch (event.kind) {
    case 'ObservationRecorded': {
      const shared = p.source.kind === 'evidence_share';
      // 陈述优先于来源分类。合法分享不改变其真伪性质或接收者身份。
      entry.category = p.category === 'Claim' ? 'Claim' : 'Observation';
      entry.kind = p.category === 'Claim' ? (shared ? 'received_claim' : 'heard_claim') : (shared ? 'received_evidence' : 'observed');
      entry.actorId = p.observerId; entry.text = p.statement; entry.fields = structuredClone(p.fields);
      reference('observation', p.observationId);
      // subjectId 未携带公开类型，作为相关引用保留，不向全量世界查类型或名称。
      reference('source', p.subjectId);
      for (const id of p.source.sourceIds) reference(p.source.kind === 'speech' ? 'claim' : 'source', id);
      break;
    }
    case 'ClaimRecorded':
      entry.category = 'Claim'; entry.kind = 'said'; entry.actorId = p.speakerId; entry.text = p.text;
      reference('claim', p.claimId); break;
    case 'character.moved':
      entry.kind = 'moved'; entry.actorId = p.actorId; entry.text = '角色已移动。';
      field('from', '离开区域', p.from); field('to', '到达区域', p.to);
      reference('region', p.from); reference('region', p.to); break;
    case 'item.taken':
      entry.kind = 'took'; entry.actorId = p.to; entry.text = '物品已被拿取。';
      reference('item', p.itemId); reference('character', p.to);
      if (p.from.kind === 'region') { reference('region', p.from.regionId); field('fromRegion', '原所在区域', p.from.regionId); }
      if (p.from.kind === 'character') reference('character', p.from.characterId);
      break;
    case 'item.transferred':
      entry.kind = 'transferred'; entry.actorId = p.from; entry.text = '物品已实际交付。';
      reference('item', p.itemId); reference('character', p.from); reference('character', p.to);
      field('from', '交付角色', p.from); field('to', '接收角色', p.to); break;
    case 'item.used':
      entry.kind = 'used'; entry.actorId = p.actorId; entry.text = p.consumed ? '物品已使用并消耗。' : '物品已使用，未消耗。';
      reference('item', p.itemId); reference('target', p.targetId);
      field('operation', '执行操作', p.operation); field('consumed', '是否消耗', p.consumed); break;
    case 'target.updated':
      entry.kind = 'updated'; entry.text = '对象状态已改变。'; entry.fields = structuredClone(p.fields);
      reference('target', p.targetId); break;
    case 'session.finished':
      entry.kind = 'finished'; entry.text = p.endingCode; entry.fields = structuredClone(p.facts); break;
    case 'session.aborted':
      entry.kind = 'aborted'; entry.text = p.reason; break;
    default: throw new Error('未列入复盘白名单的事件。');
  }
  return entry;
}

/** 当前资格与历史受众共同约束只读查询；不会调用领域动作或模型。 */
export async function readRecap(runtime, token, sessionId, query) {
  validateQuery(query);
  await runtime.authenticate(token);
  return runtime.locked(sessionId, { kind: 'recap' }, async tx => {
    const user = await runtime.access(tx.client, tx.row, token);
    if (!['Finished', 'Aborted'].includes(tx.state.phase)) throw new RuntimeError('FORBIDDEN', '本局尚未结束，暂不能读取复盘。');
    if (query.throughSeq !== tx.state.sessionSeq) throw new RuntimeError('RESYNC_REQUIRED', '复盘水位已变化，请重新取得终态授权视图。');
    // LIMIT 作用于已经具备历史受众资格且属于白名单的记录，不泄露隐藏记录计数。
    const rows = (await tx.client.query(`SELECT event FROM world_events
      WHERE session_id=$1 AND session_seq<=$2::numeric
        AND ($3::numeric IS NULL OR session_seq<$3::numeric)
        AND event->>'kind'=ANY($4::text[])
        AND (event->'audience'->'humanCharacterIds') ? $5
      ORDER BY session_seq DESC LIMIT 101`, [sessionId, query.throughSeq, query.beforeSeq ?? null, kinds, user.actorId])).rows;
    const entries = rows.slice(0, 100).map(row => projectEvent(row.event));
    return validateContract('AuthorizedRecap', {
      schemaVersion: 1, type: 'session.recap', sessionId, actorId: user.actorId,
      throughSeq: query.throughSeq, phase: tx.state.phase, entries,
      nextBeforeSeq: rows.length > 100 ? entries.at(-1).eventSeq : null,
    });
  });
}
