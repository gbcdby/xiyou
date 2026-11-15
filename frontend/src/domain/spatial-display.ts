import type { EntityViewV2, ItemViewV2, ProjectionV2, TargetViewV2 } from '../../../game/spatial-types.ts';

/** 公开外观仅供绘图/选取；它不增加操作、观测或私人库存，也不回写权威快照。 */
export function sceneDisplayProjection(projection: ProjectionV2): ProjectionV2 {
  const overview = projection.sceneOverview;
  if (!overview) return projection;
  const entities = new Map<string, EntityViewV2>(overview.entities.map(value => [value.entityRef, value]));
  for (const value of projection.entities) {
    const physical = entities.get(value.entityRef);
    entities.set(value.entityRef, { ...physical, ...value, ...(physical?.motionTrail ? {
      motionTrail: physical.motionTrail, motionFromSceneTimeMs: physical.motionFromSceneTimeMs,
      motionThroughSceneTimeMs: physical.motionThroughSceneTimeMs,
      motionTimeline: physical.motionTimeline,
    } : {}) });
  }
  const items = new Map<string, ItemViewV2>(overview.items.map(value => [value.entityRef, {
    entityRef: value.entityRef, name: value.name, resourceRevision: value.resourceRevision, location: value.location,
    ...(value.visualKey ? { visualKey: value.visualKey } : {}),
    // 未提供的操作能力按不可用处理；此处不猜物权或转交许可。
    transferable: false, publicBorrowable: false,
    fields: value.visualState === 'default' ? [] : [{ key: 'fixed', label: '已装配', value: value.visualState === 'fixed' }],
  }]));
  for (const value of projection.items) items.set(value.entityRef, value);
  const targets = new Map<string, TargetViewV2>(overview.targets.map(value => [value.entityRef, {
    entityRef: value.entityRef, name: value.name, resourceRevision: value.resourceRevision,
    sceneId: value.sceneId, position: value.position, ...(value.visualKey ? { visualKey: value.visualKey } : {}),
    availableOperations: [], fields: value.visualState === 'default' ? [] : [{ key: 'open', label: '门已打开', value: value.visualState === 'open' }],
  }]));
  for (const value of projection.targets) targets.set(value.entityRef, value);
  return { ...projection, entities: [...entities.values()], items: [...items.values()], targets: [...targets.values()] };
}
