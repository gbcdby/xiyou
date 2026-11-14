const localAppearances = Object.freeze({ A: 'gaocai', B: 'courtyard-helper', C: 'carpenter', D: 'kitchen-helper', E: 'woodcutter' });

/** 公开造型由权威角色配置及当前变貌决定；观察者知识和显示名均不参与选择。 */
export function visibleAppearance(state, content, actor) {
  if (state.reducerVersion !== 'gaolao-world-v1' || !state.chapter) return 'neutral';
  if (state.chapter.disguise?.actorId === actor.characterId) return 'cuilan';
  if (actor.kind === 'human') return localAppearances[actor.responsibilities?.[0]] ?? 'neutral';
  const role = Object.entries(content.chapterRules.people).find(([, id]) => id === actor.characterId)?.[0];
  return ['tang', 'wukong', 'bajie', 'cuilan', 'gao', 'witness'].includes(role) ? role : 'neutral';
}
