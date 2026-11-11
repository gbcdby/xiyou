export const mockPolicies = Object.freeze({
  tangseng: Object.freeze({ providerId: 'controlled-tangseng', modelId: 'tangseng-safety-v2', policyVersion: 'tangseng-safety-v2' }),
  wukong: Object.freeze({ providerId: 'controlled-wukong', modelId: 'wukong-inspection-v2', policyVersion: 'wukong-inspection-v2' }),
});

const field = (value, key) => value?.fields?.find(entry => entry.key === key)?.value;
const short = (value, length = 240) => [...value].slice(0, length).join('');
const stable = value => JSON.stringify(value);
const byId = key => (a, b) => a[key].localeCompare(b[key], 'en');

/** 策略无进程记忆：知识、已说过的话和工具白名单只来自这次 Gateway 输入。 */
function plan(context, role) {
  const { current, memory, decision } = context;
  const allowed = new Set(decision.allowedTools.filter(kind => current.self.capabilities.includes(kind)));
  const observations = memory.observations.filter(o => o.observerId === context.actorId && decision.observationIds.includes(o.observationId));
  const ownClaims = memory.claims.filter(claim => claim.speakerId === context.actorId);
  const said = text => ownClaims.some(claim => claim.text === text);
  const peers = current.characters.filter(actor => actor.characterId !== context.actorId && actor.regionId === current.self.regionId).sort(byId('characterId'));
  const result = (tools = [], beliefs = []) => ({
    decisionId: decision.decisionId,
    toolCalls: tools.filter(tool => allowed.has(tool.kind)),
    ...(beliefs.length ? { beliefUpdates: beliefs } : {}),
  });
  const say = text => ({ kind: allowed.has('make_claim') ? 'make_claim' : 'speak', channel: 'public', recipientIds: [], text });
  const wait = () => result([{ kind: 'wait' }]);
  const inspect = targetId => ({ kind: 'inspect', targetId });
  const inspected = entity => observations.some(o => o.category === 'WorldFact' && o.source.kind === 'inspection' && o.subjectId === (entity.targetId ?? entity.itemId) && stable(o.fields) === stable(entity.fields));
  const gate = current.targets.find(target => typeof field(target, 'safe') === 'boolean' && typeof field(target, 'permit') === 'boolean');
  const safe = field(gate, 'safe') === true;
  const permit = field(gate, 'permit') === true;
  if (current.phase !== 'Running' || !memory.goals.some(goal => goal.status === 'active')) return wait();

  // 同一来源的转述不算独立印证；Claim 即使带相同措辞，也不参与事实判断。
  function latestEvidence(key) {
    return observations.filter(o => o.category === 'Evidence' && o.fields.some(entry => entry.key === key))
      .sort((a, b) => BigInt(a.source.sourceSeq) > BigInt(b.source.sourceSeq) ? -1 : BigInt(a.source.sourceSeq) < BigInt(b.source.sourceSeq) ? 1 : byId('observationId')(a, b))[0];
  }
  function evidencePair(firstKey, secondKey) {
    const first = latestEvidence(firstKey); const second = latestEvidence(secondKey);
    if (field(first, firstKey) !== true || field(second, secondKey) !== true || first.source.sourceIds.some(source => second.source.sourceIds.includes(source))) return null;
    return [first, second];
  }
  const conclusions = [
    {
      pair: evidencePair('damageBeforeArrival', 'recordMatchesTrace'),
      beliefId: 'mock-damage-assessment',
      text: role === 'tangseng'
        ? '旧记录与现场痕迹已相互印证，损坏早于到达。我不再把损坏归咎同行；请按核验来源自愿协调材料，仍须实际修复和合法许可。'
        : '旧记录与现场痕迹已相互印证，不能凭封路争执任意定责。我改为展示核验来源，并继续检查实际通行条件。',
    },
    {
      pair: evidencePair('authorizedMove', 'registerMatchesSite'),
      beliefId: 'mock-material-assessment',
      text: role === 'tangseng'
        ? '登记与现场标记已相互印证，材料属于合法搬运，不能按盗取定责。请有职责的玩家自愿取回原材料，备用垫付也不代表认罪。'
        : '登记与现场标记已相互印证，我改为支持取回原材料并展示来源，不再根据口头指责追责；实际修复仍由玩家执行。',
    },
  ];
  for (const conclusion of conclusions) {
    if (!conclusion.pair || said(conclusion.text)) continue;
    const source = conclusion.pair.find(o => o.shareable);
    const target = current.targets.find(t => conclusion.pair.some(o => o.subjectId === t.targetId));
    const follow = source && peers.length && allowed.has('share_evidence')
      ? { kind: 'share_evidence', evidenceId: source.observationId, recipientIds: peers.map(actor => actor.characterId) }
      : target && allowed.has('inspect') ? inspect(target.targetId) : { kind: 'wait' };
    return result([say(conclusion.text), follow], [{
      beliefId: conclusion.beliefId, statement: conclusion.text, confidence: 'likely',
      basedOnObservationIds: conclusion.pair.map(o => o.observationId),
    }]);
  }

  if (gate) {
    const text = safe && permit
      ? role === 'tangseng'
        ? '当前可见状态已确认实际修复与有效许可，我愿意按已见出口通行。请明确希望前往的出口；我的同意不代表已经抵达。'
        : '当前可见状态已确认实际修复与有效许可，我改为核对通行路线；沿已见出口行动，抵达与否以实际移动为准。'
      : safe
        ? role === 'tangseng'
          ? '我已看到实际修复，但许可尚未生效，暂不通行。请有通行职责的玩家确认并授予许可，我不能代为授权。'
          : '实际修复已经可见，我改为核对通行许可。请有职责的玩家完成许可，不能靠一句“已修好”越过条件。'
        : role === 'tangseng'
          ? '当前通路尚未实际修复，暂不通行。先核查安全，再请玩家自愿协调材料、实际修复并取得许可；垫付不代表认罪。'
          : '我先亲自检查通路，不凭口头说法认定已修好或任意定责。请提供可核验来源，实际修复和许可由有职责的玩家完成。';
    if (!said(text)) return result([say(text), ...(allowed.has('inspect') ? [inspect(gate.targetId)] : [])]);
    if (!inspected(gate)) return result([inspect(gate.targetId)]);
  }

  // 必要核验之后先推进明确目标；最新建议已抵达或不可见时，不复活更旧路线。
  const exits = current.regions.find(region => region.regionId === current.self.regionId)?.exits ?? [];
  const requests = memory.claims.filter(claim => claim.speakerId !== context.actorId).toReversed();
  const requested = requests.map(claim => [...claim.text.matchAll(/(?:^|[，。！？\n])\s*(?:请(?:从|沿|走|去|到|前往)\s*)?出口(?:\s+|「)([A-Za-z0-9][A-Za-z0-9_.:-]*)(?:」)?/g)].at(-1)?.[1]).find(value => value !== undefined);
  if (requested && requested !== current.self.regionId && exits.includes(requested) && allowed.has('move') && (gate ? safe && permit : role === 'wukong')) {
    const text = `我按当前可见的出口 ${requested} 前往核验或通行，实际效果仍由通路规则决定。`;
    return result([say(text), { kind: 'move', regionId: requested }]);
  }

  const visible = role === 'wukong' ? [...current.items, ...current.targets] : [...current.targets, ...current.items];
  const unchecked = visible.find(entity => !inspected(entity));
  if (unchecked && allowed.has('inspect')) {
    const text = role === 'wukong'
      ? `我先亲自检查${short(unchecked.name)}，查找材料和现场来源；仅凭口头说法不能定责。我不会替玩家最终修复。`
      : `我先核查${short(unchecked.name)}的可见状态，请各位按证据自愿协调，不把承诺当成已完成。`;
    return result([...(said(text) ? [] : [say(text)]), inspect(unchecked.targetId ?? unchecked.itemId)]);
  }

  // 主动展示合法证据；共享副本保留原来源，不能升级成第二个独立发现。
  if (allowed.has('share_evidence') && peers.length) for (const source of observations) {
    if (!source.shareable || source.category === 'Claim' || (source.category !== 'Evidence' && source.source.kind !== 'inspection')) continue;
    const details = short(source.fields.map(entry => `${entry.label}=${String(entry.value)}`).join('，'), 240);
    const text = `我把关于 ${source.subjectId ?? '当前情况'} 的“${short(source.statement, 160)}”${details ? `（${details}）` : ''}及其原来源分享给各位，供自行核验。`;
    const recipientIds = peers.filter(peer => !ownClaims.some(claim => claim.text === text && claim.channel === 'directed' && claim.recipientIds.includes(peer.characterId))).map(peer => peer.characterId);
    if (!recipientIds.length) continue;
    // 同一来源合并给尚未展示过的当前同行者；使用正常定向 Claim 的受众去重。
    return result([{ ...say(text), channel: 'directed', recipientIds }, { kind: 'share_evidence', evidenceId: source.observationId, recipientIds }]);
  }
  const question = role === 'wukong'
    ? '此处可见现场已检查。请把登记、痕迹等原来源分享过来，或明确一个当前可见出口，我再前往核验；不凭转述定责。'
    : '请继续提供有来源的记录，并由玩家完成修复和许可；若条件已满足，请明确当前可见出口，我再实际通行。';
  return said(question) ? wait() : result([say(question)]);
}

export function createMockProvider(role) {
  if (!Object.hasOwn(mockPolicies, role)) throw new Error('未知的模拟角色策略。');
  const policy = mockPolicies[role];
  return { kind: 'controlled', ...policy, async generate({ context }) {
    if (context.principalKind !== 'core_npc' || context.actorId !== role || context.current.self.characterId !== role || context.decision.actorId !== role || context.decision.sessionId !== context.sessionId) throw new Error('模拟策略仅供已绑定的核心角色使用。');
    return { rawText: JSON.stringify(plan(context, role)) };
  } };
}
