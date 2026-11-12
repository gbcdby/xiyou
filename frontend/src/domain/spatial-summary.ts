import type { ProjectionV2 } from '../../../game/spatial-types.ts';

/** 场景摘要只复述当前授权字段；不从客户端推断下一阶段或补造世界进展。 */
export function spatialSummary(projection: ProjectionV2 | null): { caption: string; title: string } | null {
  if (!projection) return null;
  if (projection.reducerVersion === 'gaolao-world-v1' && projection.chapter) {
    if (projection.phase === 'Finished' || projection.phase === 'Aborted') return { caption: '这一程的结果', title: projection.ending?.title || '这一程已结束' };
    const progress = projection.chapter.progress.at(-1);
    if (progress) return { caption: '已知进展', title: progress.value === true ? progress.label : `${progress.label}：${progress.value === false ? '未满足' : progress.value ?? '尚无'}` };
  }
  const objective = projection.objectives.find(objective => objective.status === 'active') || projection.objectives.find(objective => objective.status === 'blocked');
  return objective ? { caption: '眼下事项', title: objective.label } : null;
}
