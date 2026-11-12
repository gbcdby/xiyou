// 仅用于客户端协议检查的公开 DTO，不承担服务器事实与权限规则。
export const selfRef = 'self_0000000000000000000000000000000';
export function spatialSnapshot() {
  const result = { schemaVersion: 2, type: 'world.snapshot', sessionId: 'spatial-room', viewId: 'spatial-view-1', snapshotSeq: '10', projection: {
    protocolCapability: 'spatial-v2', chapterVersion: 'gray-v1', mapVersion: 'gray-map-v1', variantId: 'two', contentVersion: 'spatial-graybox-v2', reducerVersion: 'spatial-world-v2', phase: 'Running', sceneTimeMs: 1000, paused: false,
    self: { entityRef: selfRef, name: '旅伴甲', appearanceEpoch: '0', sceneId: 'yard', position: { x: 100, y: 100 }, facing: 'S', controlEpoch: '2', canControl: true, capabilities: [], movementCommandHighWater: '0' },
    entities: [], items: [], targets: [], scene: { sceneId: 'yard', name: '灰盒院落', width: 1000, height: 800, unitsPerPixel: 1, walkableAreas: [{ areaId: 'ground', polygon: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 800 }, { x: 0, y: 800 }] }], obstacles: [], anchors: [], exits: [] },
    movement: null, observations: [], claims: [], cooperations: [], objectives: [], ending: null,
  } };
  const { entityRef, name, appearanceEpoch, sceneId, position, facing } = result.projection.self;
  result.projection.entities.push({ entityRef, name, appearanceEpoch, sceneId, position: { ...position }, facing });
  return result;
}
export function spatialBatch(snapshot, through = '11', projection = snapshot.projection) {
  return { schemaVersion: 2, type: 'world.batch', sessionId: snapshot.sessionId, viewId: snapshot.viewId, fromExclusive: snapshot.snapshotSeq, throughSeq: through, events: [{ sessionSeq: through, eventId: 'event-' + through, kind: 'projection.replace', payload: { projection: structuredClone(projection) } }] };
}
