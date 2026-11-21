import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Server } from 'socket.io';
import { validateSpatial } from '../../protocol/spatial.mjs';
import { spatialSnapshot } from './spatial-fixture.mjs';

// 只提供受控公开 DTO 与可观察的请求/收据；不承担剧情、寻路、权限或真实后端验收。
const content = JSON.parse(await readFile(new URL('../../content/fixtures/gaolaozhuang-scene-v3.json', import.meta.url)));
export const fullscreenRefs = {
  self: 'self_0000000000000000000000000000000',
  near: 'actor_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  far: 'actor_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  parcel: 'item_cccccccccccccccccccccccccccccccc',
};

function publicScene(source) {
  const { sceneId, name, width, height, unitsPerPixel, walkableAreas, anchors } = source;
  return structuredClone({ sceneId, name, width, height, unitsPerPixel, walkableAreas, anchors,
    obstacles: source.obstacles.map(({ obstacleId, polygon, exceptAreas }) => ({ obstacleId, polygon, exceptAreas })),
    exits: source.exits.map(({ exitId, anchorId, destinationSceneId, destination }) => ({ exitId, anchorId, destinationSceneId, destination, open: true })),
  });
}

export function fullscreenSnapshot() {
  const snapshot = spatialSnapshot(), p = snapshot.projection;
  snapshot.sessionId = 'fullscreen-fixture'; snapshot.viewId = 'fullscreen-view-1';
  for (const key of ['contentVersion', 'chapterVersion', 'mapVersion', 'variantId', 'reducerVersion']) p[key] = content[key];
  p.scene = publicScene(content.scenes[0]);
  Object.assign(p.self, { name: '高才', canControl: false, appearanceId: 'gaocai', sceneId: p.scene.sceneId, position: { x: 800, y: 600 } });
  // 同外观旅伴是空间检查站位，不声称代表正式剧情的其他角色素材。
  p.entities = [
    { entityRef: p.self.entityRef, name: p.self.name, appearanceEpoch: '0', appearanceId: 'gaocai', sceneId: p.scene.sceneId, position: { ...p.self.position }, facing: 'S' },
    { entityRef: fullscreenRefs.near, name: '近处站位旅伴', appearanceEpoch: '0', appearanceId: 'gaocai', sceneId: p.scene.sceneId, position: { x: 975, y: 675 }, facing: 'S' },
    { entityRef: fullscreenRefs.far, name: '远处站位旅伴', appearanceEpoch: '0', appearanceId: 'gaocai', sceneId: p.scene.sceneId, position: { x: 1490, y: 510 }, facing: 'W' },
  ];
  p.items = [{ entityRef: fullscreenRefs.parcel, name: '场景检查包裹', visualKey: 'cloth-parcel', location: { kind: 'ground', sceneId: p.scene.sceneId, position: { x: 700, y: 720 } }, resourceRevision: '1', transferable: true, publicBorrowable: false, fields: [] }];
  p.targets = [];
  p.observations = Array.from({ length: 24 }, (_, i) => ({ observationRef: 'note_' + String(i).padStart(32, '0'), category: 'Evidence', statement: `受控阅读记录 ${i + 1}：这条记录只检查长内容在屏幕内阅读，不代表游戏中的已发生事实。`, sourceSeq: '9', fields: [], shareable: true }));
  p.objectives = [{ objectiveId: 'fullscreen-objective', label: '与旅伴一起了解眼前情况，确认本次安排。', status: 'active' }];
  p.chapter = { chapterId: 'gaolaozhuang', responsibilities: ['A'], progress: [], consents: [], follows: [], decisions: [], destinations: [], endProposal: null, publicItems: [], personalRequests: [], privateItemOffers: [], privateReturns: [] };
  p.mapCatalog = content.scenes.map(source => {
    const scene = publicScene(source), { obstacles, ...map } = scene;
    return { ...map, exits: map.exits.map(({ open, ...exit }) => exit) };
  });
  refreshOverview(p);
  return validateSpatial('SnapshotV2', snapshot);
}

function refreshOverview(p) {
  p.sceneOverview = {
    entities: p.entities.filter(entity => entity.sceneId === p.self.sceneId && entity.position).map(entity => ({ ...entity, resourceRevision: '1', moving: false })),
    items: p.items.filter(item => item.location.kind === 'ground' && item.location.sceneId === p.self.sceneId).map(item => ({ entityRef: item.entityRef, name: item.name, visualKey: item.visualKey, location: item.location, resourceRevision: item.resourceRevision, visualState: 'loose' })),
    targets: [],
  };
}

export async function createFullscreenFixture() {
  let snapshot = fullscreenSnapshot(), socket = null, epoch = 2, unknownNext = false;
  const wires = [], queries = [], receipts = new Map();
  const http = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/sessions') {
      response.end(JSON.stringify([{ sessionId: snapshot.sessionId, name: '全屏镜头受控检查', phase: 'Running', playerCount: 1, protocolCapability: 'spatial-v2', contentVersion: snapshot.projection.contentVersion }])); return;
    }
    if (request.url?.startsWith(`/api/sessions/${snapshot.sessionId}/recap?`) && snapshot.projection.ending) {
      response.end(JSON.stringify({ schemaVersion: 2, type: 'session.recap', sessionId: snapshot.sessionId, throughSeq: snapshot.snapshotSeq, phase: snapshot.projection.phase, ending: snapshot.projection.ending,
        entries: [{ entryRef: 'recap_' + 'r'.repeat(32), eventSeq: snapshot.snapshotSeq, category: 'WorldFact', text: '受控历史条目：只检查回看面板的可达性。', fields: [] }], nextBeforeSeq: null,
      })); return;
    }
    const match = request.url?.match(/^\/api\/sessions\/[^/]+\/actions\/([^/?]+)$/);
    if (match) {
      const id = decodeURIComponent(match[1]); queries.push(id);
      if (receipts.has(id)) { response.end(JSON.stringify(receipts.get(id))); return; }
    }
    response.statusCode = 404; response.end(JSON.stringify({ schemaVersion: 2, code: 'OUTCOME_UNKNOWN' }));
  });
  const io = new Server(http);
  io.on('connection', connected => {
    socket = connected;
    connected.on('session.subscribe', (_raw, reply) => reply(structuredClone(snapshot)));
    for (const event of ['control.resume', 'control.take']) connected.on(event, (raw, reply) => {
      const request = JSON.parse(raw); epoch++;
      snapshot.viewId = `fullscreen-view-${epoch}`;
      Object.assign(snapshot.projection.self, { controlEpoch: String(epoch), canControl: true });
      reply({ schemaVersion: 2, sessionId: request.sessionId, nonce: request.nonce, controlEpoch: String(epoch), observedSeq: snapshot.snapshotSeq, snapshot: structuredClone(snapshot) });
    });
    connected.on('sync.request', (raw, reply) => {
      const request = JSON.parse(raw);
      reply({ schemaVersion: 2, type: 'world.batch', sessionId: request.sessionId, viewId: request.viewId, fromExclusive: request.cursor, throughSeq: request.cursor, events: [] });
    });
    connected.on('player.action.request', (raw, reply) => {
      const request = JSON.parse(raw); validateSpatial('PublicEnvelope', request);
      wires.push({ raw, request: structuredClone(request) });
      const receipt = { schemaVersion: 2, sessionId: request.sessionId, clientActionId: request.clientActionId, status: 'Accepted', code: 'NO_CHANGE', observedSeq: snapshot.snapshotSeq, actionEventRange: null, result: {} };
      receipts.set(request.clientActionId, receipt);
      if (unknownNext) { unknownNext = false; reply({ schemaVersion: 2, code: 'OUTCOME_UNKNOWN', message: '受控收据暂不可知。' }); }
      else reply(receipt);
    });
  });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const publish = change => {
    const fromExclusive = snapshot.snapshotSeq;
    change(snapshot.projection); snapshot.snapshotSeq = String(BigInt(snapshot.snapshotSeq) + 1n);
    validateSpatial('SnapshotV2', snapshot);
    socket?.emit('world.batch', { schemaVersion: 2, type: 'world.batch', sessionId: snapshot.sessionId, viewId: snapshot.viewId, fromExclusive, throughSeq: snapshot.snapshotSeq,
      events: [{ sessionSeq: snapshot.snapshotSeq, eventId: `fullscreen-${snapshot.snapshotSeq}`, kind: 'projection.replace', payload: { projection: structuredClone(snapshot.projection) } }],
    });
    return structuredClone(snapshot);
  };
  return {
    origin: `http://127.0.0.1:${http.address().port}`,
    snapshot: () => structuredClone(snapshot), wires, queries,
    reset() { snapshot = fullscreenSnapshot(); epoch = 2; unknownNext = false; wires.length = 0; queries.length = 0; receipts.clear(); },
    unknownNext() { unknownNext = true; },
    publish,
    moveSelf(position, duration = 700) {
      return publish(p => {
        const from = p.sceneTimeMs, start = { ...p.self.position };
        p.sceneTimeMs += duration; p.self.position = { ...position };
        const actor = p.entities.find(value => value.entityRef === p.self.entityRef);
        Object.assign(actor, { position: { ...position }, motionTrail: [start, { ...position }], motionFromSceneTimeMs: from, motionThroughSceneTimeMs: p.sceneTimeMs,
          motionTimeline: [{ kind: 'motion', fromSceneTimeMs: from, throughSceneTimeMs: p.sceneTimeMs, fromTrailIndex: 0, throughTrailIndex: 1 }] });
        refreshOverview(p);
      });
    },
    changeScene() {
      return publish(p => {
        const next = content.scenes.find(value => value.sceneId !== p.self.sceneId);
        p.scene = publicScene(next); p.self.sceneId = next.sceneId; p.self.position = { x: 850, y: 650 }; p.sceneTimeMs += 100;
        p.entities = [{ entityRef: p.self.entityRef, name: p.self.name, appearanceEpoch: p.self.appearanceEpoch, appearanceId: p.self.appearanceId, sceneId: next.sceneId, position: { ...p.self.position }, facing: 'S' }];
        p.items = []; refreshOverview(p);
      });
    },
    async close() { await new Promise(resolve => io.close(resolve)); if (http.listening) await new Promise(resolve => http.close(resolve)); },
  };
}
