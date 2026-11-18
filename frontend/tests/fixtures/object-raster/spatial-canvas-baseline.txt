import type { EntityViewV2, Facing, ItemViewV2, Position, SnapshotV2, TargetViewV2 } from '../../../game/spatial-types.ts';
import { sceneDisplayProjection } from '../domain/spatial-display.ts';
import { ConfirmedMotion } from '../domain/spatial-motion.ts';
import { sceneArtwork, spriteResourcePaths, type SpriteFrame } from '../domain/gaolao-art.ts';
import { objectArtContext, objectInstanceKey, selectObjectArt, type ObjectArtFrame } from '../domain/gaolao-object-art.ts';
import { foregroundOpacity, orderSceneEntries, sceneGroupAssets, sceneLayerPresentation, selectSceneDoor, type SceneAsset, type SceneForeground, type SceneRect } from '../domain/gaolao-scene-layers.ts';
import { layoutSpatialLabels, type SpatialLabel, type SpatialLabelInput } from '../domain/spatial-labels.ts';
import { sceneFit, screenPoint, worldPoint, type CanvasFit } from '../domain/spatial-canvas-geometry.ts';
import { CanvasAssets, sharedCanvasAssets } from './canvas-assets.ts';

interface DrawPerson extends EntityViewV2 { position: Position; drawnFacing: Facing; moving: boolean; distance: number; art: SpriteFrame | null }
interface DrawObject { ref: string; key: string; kind: 'item' | 'target' | 'door'; name: string; position: Position; depthY: number; visualKey?: string; file?: string; variant?: string; bounds: SceneRect }
interface Hit { ref: string | null; position: Position; bounds: SceneRect; file?: string; mirror?: boolean; foot?: boolean; shape?: 'person' | 'diamond' | 'rect' }
type Entry = { key: string; depthY: number } & ({ kind: 'person'; person: DrawPerson } | { kind: 'item' | 'target'; object: ItemViewV2 | TargetViewV2; position: Position } | { kind: 'foreground'; asset: SceneForeground } | { kind: 'door' });
export interface CanvasSceneFrame {
  sceneId: string; view: SceneRect; viewport: { width: number; height: number; dpr: number }; fit: CanvasFit; serial: number; instance: string;
  layerStatus: 'legacy' | 'ready' | 'pending' | 'failed'; artwork: boolean; geometricFallback: boolean; neutralDoor: SceneRect | null;
  sceneImages: { file: string; bounds: SceneRect; kind: string; depthY?: number; opacity: number }[];
  objects: DrawObject[]; actors: { ref: string; appearanceId?: string; position: Position; facing: Facing; moving: boolean; distance: number; art: SpriteFrame | null }[];
  labels: SpatialLabel[]; labelFont: string; omittedLabels: number; resources: ReturnType<CanvasAssets['resources']>; failed: string[];
}
const frames = new WeakMap<HTMLCanvasElement, CanvasSceneFrame>();
/** 只读已实际完成合成的帧，供几何验收和诊断；不生成额外DOM或世界事实。 */
export const readCanvasFrame = (canvas: HTMLCanvasElement): CanvasSceneFrame | null => frames.has(canvas) ? structuredClone(frames.get(canvas)!) : null;
const fallbackBody = { x: -22, y: -82, width: 44, height: 90 };
const bodyPath = 'M-7 -54 Q-15 -48 -16 -24 L-12 -12 L-12 -2 L-3 -2 L0 -21 L4 -2 L13 -2 L12 -15 L16 -23 Q14 -48 7 -54 Z';
const hatPath = 'M-6 -74 Q0 -82 6 -74 L7 -70 L-7 -70 Z';
const clamp = (value: number, lower: number, upper: number) => Math.max(lower, Math.min(upper, value));
const polygon = (context: CanvasRenderingContext2D, points: Position[]) => { context.beginPath(); points.forEach((p, index) => index ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y)); context.closePath(); };
const absolute = (position: Position, bounds: SceneRect, mirror = false): SceneRect => ({ x: position.x + (mirror ? -bounds.x - bounds.width : bounds.x), y: position.y + bounds.y, width: bounds.width, height: bounds.height });

export class SpatialCanvas {
  #canvas: HTMLCanvasElement; #front: CanvasRenderingContext2D; #buffer: HTMLCanvasElement; #context: CanvasRenderingContext2D;
  #assets: CanvasAssets; #paths = new Set<string>(); #hits: Hit[] = []; #width = 1; #height = 1; #dpr = 1; #serial = 0;
  #scope = ''; #scopeGeneration = 0; #labelKey = ''; #labelLayout: ReturnType<typeof layoutSpatialLabels> = { labels: [], omitted: 0 };
  constructor(canvas: HTMLCanvasElement, assets = sharedCanvasAssets) {
    this.#canvas = canvas; this.#assets = assets;
    const front = canvas.getContext('2d'); const buffer = document.createElement('canvas'), context = buffer.getContext('2d');
    if (!front || !context) throw new Error('当前浏览器无法建立场景画布。');
    this.#front = front; this.#buffer = buffer; this.#context = context;
  }
  resize(width: number, height: number, dpr: number) {
    this.#width = Math.max(1, width); this.#height = Math.max(1, height); this.#dpr = Math.max(1, dpr || 1);
    const pixels = { width: Math.max(1, Math.round(this.#width * this.#dpr)), height: Math.max(1, Math.round(this.#height * this.#dpr)) };
    for (const canvas of [this.#canvas, this.#buffer]) {
      if (canvas.width !== pixels.width) canvas.width = pixels.width;
      if (canvas.height !== pixels.height) canvas.height = pixels.height;
    }
  }
  prepare(snapshot: SnapshotV2) {
    const p = sceneDisplayProjection(snapshot.projection), context = objectArtContext(snapshot), presentation = sceneLayerPresentation(context);
    const scope = JSON.stringify(context); if (scope !== this.#scope) { this.#scope = scope; this.#scopeGeneration++; this.#labelKey = ''; }
    const paths = new Set<string>();
    if (presentation.resources) for (const asset of sceneGroupAssets(presentation.resources)) paths.add(asset.file);
    else if (!presentation.registered) { const artwork = sceneArtwork(p.scene?.sceneId); if (artwork) paths.add(artwork); }
    for (const actor of [p.self, ...p.entities]) for (const file of spriteResourcePaths(actor.appearanceId)) paths.add(file);
    for (const object of [...p.items, ...p.targets]) { const frame = selectObjectArt(object, context, 'map'); if (frame) paths.add(frame.file); }
    this.#paths = paths; this.#assets.ensure(paths);
  }
  retry() { this.#assets.retry(this.#paths); }
  clear() {
    this.#front.setTransform(1, 0, 0, 1, 0, 0); this.#front.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    this.#context.setTransform(1, 0, 0, 1, 0, 0); this.#context.clearRect(0, 0, this.#buffer.width, this.#buffer.height);
    frames.delete(this.#canvas); this.#hits = []; this.#labelKey = ''; this.#paths = new Set();
    delete this.#canvas.dataset.sceneId; delete this.#canvas.dataset.sceneView; delete this.#canvas.dataset.sceneLayerStatus; this.#canvas.dataset.renderedEntities = '0';
  }
  point(point: Position): Position | null { const frame = frames.get(this.#canvas); return frame ? worldPoint(point, frame.fit, frame.view) : null; }
  hit(point: Position): string | null {
    const frame = frames.get(this.#canvas); if (!frame) return null;
    for (const label of [...frame.labels].reverse()) if (label.selectable && point.x >= label.x && point.y >= label.y && point.x <= label.x + label.width && point.y <= label.y + label.height) return label.key;
    const world = this.point(point); if (!world) return null;
    for (const hit of [...this.#hits].reverse()) {
      const x = (world.x - hit.position.x) * (hit.mirror ? -1 : 1), y = world.y - hit.position.y;
      if (hit.foot && (x / 17) ** 2 + ((y + 1) / 6) ** 2 <= 1) return hit.ref;
      const b = hit.bounds; if (x < b.x || y < b.y || x > b.x + b.width || y > b.y + b.height) continue;
      if (hit.file) {
        const image = this.#assets.image(hit.file);
        if (!image || !this.#assets.opaqueAt(hit.file, (x - b.x) / b.width * image.naturalWidth, (y - b.y) / b.height * image.naturalHeight)) continue;
      } else if (hit.shape === 'person') {
        const head = (x / 8) ** 2 + ((y + 64) / 9) ** 2 <= 1;
        this.#context.save(); this.#context.setTransform(1, 0, 0, 1, 0, 0);
        const body = this.#context.isPointInPath(new Path2D(bodyPath), x, y) || this.#context.isPointInPath(new Path2D(hatPath), x, y); this.#context.restore();
        if (!head && !body) continue;
      } else if (hit.shape === 'diamond' && Math.abs(x) / 12 + Math.abs(y) / 10 > 1) continue;
      return hit.ref;
    }
    return null;
  }
  paint(snapshot: SnapshotV2, motion: ConfirmedMotion, now: number, options: { selected?: string; personLabels?: Record<string, string>; reducedMotion: boolean; beforeFrontWrite?: () => void }): CanvasSceneFrame | null {
    const p = sceneDisplayProjection(snapshot.projection), scene = p.scene; if (!scene) { this.clear(); return null; }
    const context = this.#context, artContext = objectArtContext(snapshot), presentation = sceneLayerPresentation(artContext), group = presentation.resources;
    const groupAssets = group ? sceneGroupAssets(group) : [], dimensionsValid = groupAssets.every(asset => { const image = this.#assets.image(asset.file); return !image || image.naturalWidth === asset.pixelSize.width && image.naturalHeight === asset.pixelSize.height; });
    const groupReady = Boolean(group && dimensionsValid && this.#assets.ready(groupAssets.map(asset => asset.file)));
    const groupFailed = Boolean(presentation.registered && (!group || !dimensionsValid || this.#assets.failed(groupAssets.map(asset => asset.file)).length));
    const background = !presentation.registered ? sceneArtwork(scene.sceneId) : null, backgroundImage = background ? this.#assets.image(background) : null;
    const fit = sceneFit(scene, { width: this.#width, height: this.#height }), frame: CanvasSceneFrame = {
      sceneId: scene.sceneId, view: { x: 0, y: 0, width: scene.width, height: scene.height }, viewport: { width: this.#width, height: this.#height, dpr: this.#dpr }, fit, serial: ++this.#serial,
      instance: `${this.#scope}:${this.#scopeGeneration}`, layerStatus: !presentation.registered ? 'legacy' : groupReady ? 'ready' : groupFailed ? 'failed' : 'pending', artwork: groupReady || Boolean(backgroundImage), geometricFallback: !groupReady && !backgroundImage, neutralDoor: null,
      sceneImages: [], objects: [], actors: [], labels: [], labelFont: '', omittedLabels: 0, resources: this.#assets.resources(this.#paths), failed: this.#assets.failed(this.#paths),
    };
    if (groupFailed && !frame.failed.length) frame.failed.push('scene-metadata');
    this.#hits = [];
    context.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0); context.globalAlpha = 1; context.fillStyle = '#eee3cb'; context.fillRect(0, 0, this.#width, this.#height);
    context.save(); context.translate(fit.x, fit.y); context.scale(fit.scale, fit.scale); context.beginPath(); context.rect(0, 0, scene.width, scene.height); context.clip();
    const drawSceneImage = (asset: SceneAsset, kind: string, opacity = 1, depthY?: number) => {
      const image = this.#assets.image(asset.file); if (!image) return;
      const b = asset.worldRect; context.save(); context.globalAlpha = opacity; context.drawImage(image, b.x, b.y, b.width, b.height); context.restore();
      frame.sceneImages.push({ file: asset.file, bounds: b, kind, opacity, ...(depthY !== undefined ? { depthY } : {}) });
    };
    if (group && groupReady) { drawSceneImage(group.base, 'base'); for (const floor of group.floors) drawSceneImage(floor, 'floor'); }
    else if (backgroundImage) { context.drawImage(backgroundImage, 0, 0, scene.width, scene.height); frame.sceneImages.push({ file: background!, bounds: frame.view, kind: 'legacy', opacity: 1 }); }
    else {
      context.fillStyle = '#e5ecd9'; context.strokeStyle = '#bccbad'; context.lineWidth = 2;
      for (const area of scene.walkableAreas) { polygon(context, area.polygon); context.fill(); context.stroke(); }
      for (const obstacle of scene.obstacles.filter(o => !(presentation.door && o.obstacleId === 'sealed-door'))) {
        context.save(); polygon(context, obstacle.polygon); context.fillStyle = '#b9ad91'; context.fill(); context.clip();
        context.fillStyle = '#e5ecd9'; for (const area of scene.walkableAreas.filter(a => obstacle.exceptAreas.includes(a.areaId))) { polygon(context, area.polygon); context.fill(); } context.restore();
      }
    }
    if (p.movement && p.movement.sceneId === scene.sceneId && ['accepted', 'moving'].includes(p.movement.status)) {
      context.beginPath(); p.movement.path.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.strokeStyle = '#365e52'; context.lineWidth = 3; context.setLineDash([5, 8]); context.stroke(); context.setLineDash([]);
    }
    const people: DrawPerson[] = [...p.entities.filter(value => value.entityRef !== p.self.entityRef), { ...p.entities.find(value => value.entityRef === p.self.entityRef), ...p.self }].flatMap(person => {
      if (!person.position || person.sceneId !== scene.sceneId) return [];
      const pose = motion.pose(person.entityRef, now, true), position = options.reducedMotion ? person.position : pose?.position ?? person.position, drawnFacing = pose?.facing ?? person.facing;
      const moving = !p.paused && !options.reducedMotion && Boolean(pose?.moving), distance = pose?.distance ?? 0;
      return [{ ...person, position, drawnFacing, moving, distance, art: this.#assets.actorFrame(person.appearanceId, drawnFacing, moving, distance, options.reducedMotion) }];
    });
    const ground = p.items.filter(item => item.location.kind === 'ground' && item.location.sceneId === scene.sceneId);
    const door = selectSceneDoor(group, artContext, p.targets, undefined, groupReady), slot = presentation.door;
    const doorTarget = slot ? p.targets.find(target => target.sceneId === scene.sceneId && target.visualKey === 'timber-door' && target.position.x === slot.targetPosition.x && target.position.y === slot.targetPosition.y) : null;
    const entries: Entry[] = [
      ...p.targets.filter(target => target.sceneId === scene.sceneId && target !== doorTarget).map(object => ({ kind: 'target' as const, key: objectInstanceKey(artContext, object), depthY: object.position.y, object, position: object.position })),
      ...ground.flatMap(object => object.location.kind === 'ground' ? [{ kind: 'item' as const, key: objectInstanceKey(artContext, object), depthY: object.location.position.y, object, position: object.location.position }] : []),
      ...people.map(person => ({ kind: 'person' as const, key: person.entityRef, depthY: person.position.y, person })),
      ...(group && groupReady ? group.foreground.map(asset => ({ kind: 'foreground' as const, key: `foreground:${asset.id}`, depthY: asset.depthY, asset })) : []),
      ...(slot ? [{ kind: 'door' as const, key: 'scene-door', depthY: slot.depthY }] : []),
    ];
    const protectedRefs = new Set([p.self.entityRef, options.selected, ...(p.chapter?.follows.filter(f => ['accepted', 'following', 'paused', 'arrived'].includes(f.status)).map(f => f.subjectRef) ?? [])]);
    const protectedBodies = people.filter(person => protectedRefs.has(person.entityRef)).map(person => ({ depthY: person.position.y, bounds: absolute(person.position, person.art?.bounds ?? fallbackBody, person.art?.mirrorX) }));
    for (const object of [...p.targets, ...ground].filter(value => protectedRefs.has(value.entityRef))) {
      const position = 'location' in object ? object.location.kind === 'ground' ? object.location.position : null : object.position;
      const frame = selectObjectArt(object, artContext, 'map');
      if (position) protectedBodies.push({ depthY: position.y, bounds: absolute(position, frame && this.#assets.image(frame.file) ? frame.bounds : { x: -13, y: -13, width: 26, height: 26 }) });
    }
    const drawObject = (object: ItemViewV2 | TargetViewV2, position: Position, kind: DrawObject['kind'], depthY: number, selectedFrame: ObjectArtFrame | null = selectObjectArt(object, artContext, 'map')) => {
      const image = selectedFrame && this.#assets.image(selectedFrame.file), bounds = image ? selectedFrame!.bounds : { x: -13, y: -13, width: 26, height: 26 };
      context.save(); context.translate(position.x, position.y);
      if (image && selectedFrame) context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height);
      else { context.fillStyle = kind === 'item' ? '#f8e3ac' : '#e8d6b3'; context.strokeStyle = '#76572e'; context.lineWidth = 2; context.beginPath(); if (kind === 'item') { context.moveTo(0, -10); context.lineTo(12, 0); context.lineTo(0, 10); context.lineTo(-12, 0); context.closePath(); } else context.roundRect(-13, -13, 26, 26, 4); context.fill(); context.stroke(); }
      context.restore();
      frame.objects.push({ ref: object.entityRef, key: objectInstanceKey(artContext, object), kind, name: object.name, position, depthY, visualKey: object.visualKey, bounds, ...(image && selectedFrame ? { file: selectedFrame.file, variant: selectedFrame.variant } : {}) });
      this.#hits.push({ ref: object.entityRef, position, bounds, ...(image && selectedFrame ? { file: selectedFrame.file } : { shape: kind === 'item' ? 'diamond' : 'rect' }) });
    };
    for (const entry of orderSceneEntries(entries)) {
      if (entry.kind === 'foreground') {
        const opacity = foregroundOpacity(entry.asset, protectedBodies); drawSceneImage(entry.asset, 'foreground', opacity, entry.depthY);
        if (opacity === 1) this.#hits.push({ ref: null, position: { x: 0, y: 0 }, bounds: entry.asset.worldRect, file: entry.asset.file });
      } else if (entry.kind === 'item' || entry.kind === 'target') drawObject(entry.object, entry.position, entry.kind, entry.depthY);
      else if (entry.kind === 'door' && slot) {
        if (doorTarget && door.frame && this.#assets.image(door.frame.file)) drawObject(doorTarget, slot.targetPosition, 'door', entry.depthY, door.frame);
        else {
          const b = slot.neutralBounds; frame.neutralDoor = b;
          context.save(); context.fillStyle = '#edece5'; context.strokeStyle = '#9b9e94'; context.lineWidth = 2; context.beginPath(); context.roundRect(b.x, b.y, b.width, b.height, 5); context.fill(); context.stroke(); context.font = '22px sans-serif'; context.textAlign = 'center'; context.fillStyle = '#596963'; context.fillText('?', b.x + b.width / 2, b.y + b.height / 2 + 8); context.restore();
          this.#hits.push({ ref: doorTarget?.entityRef ?? null, position: { x: 0, y: 0 }, bounds: b, shape: 'rect' });
          if (doorTarget) frame.objects.push({ ref: doorTarget.entityRef, key: objectInstanceKey(artContext, doorTarget), kind: 'door', name: doorTarget.name, position: slot.targetPosition, bounds: { ...b, x: b.x - slot.targetPosition.x, y: b.y - slot.targetPosition.y }, depthY: entry.depthY, visualKey: doorTarget.visualKey });
        }
      } else if (entry.kind === 'person') {
        const person = entry.person, art = person.art; context.save(); context.translate(person.position.x, person.position.y);
        context.fillStyle = '#2f3c2940'; context.beginPath(); context.ellipse(0, -1, 17, 6, 0, 0, Math.PI * 2); context.fill();
        if (art) { if (art.mirrorX) context.scale(-1, 1); context.drawImage(this.#assets.image(art.href)!, art.bounds.x, art.bounds.y, art.bounds.width, art.bounds.height); }
        else {
          context.fillStyle = person.entityRef === p.self.entityRef ? '#7b9283' : '#c7b99b'; context.strokeStyle = '#365e52'; context.lineWidth = 1.5;
          context.beginPath(); context.ellipse(0, -64, 8, 9, 0, 0, Math.PI * 2); context.fill(); context.stroke(); context.fill(new Path2D(bodyPath)); context.stroke(new Path2D(bodyPath)); context.fill(new Path2D(hatPath)); context.stroke(new Path2D(hatPath));
        }
        context.restore();
        this.#hits.push({ ref: person.entityRef, position: person.position, bounds: art?.bounds ?? fallbackBody, foot: true, ...(art ? { file: art.href, mirror: art.mirrorX } : { shape: 'person' }) });
        frame.actors.push({ ref: person.entityRef, appearanceId: person.appearanceId, position: person.position, facing: person.drawnFacing, moving: person.moving, distance: person.distance, art });
      }
    }
    // 选择反馈最后绘制；不再由反馈/身体边界改变相机。
    context.fillStyle = '#fff7e43d';
    for (const person of people.filter(person => person.entityRef === p.self.entityRef || person.entityRef === options.selected)) { context.strokeStyle = person.entityRef === options.selected ? '#963f2f' : '#365e52'; context.lineWidth = person.entityRef === options.selected ? 3 : 2; context.beginPath(); context.ellipse(person.position.x, person.position.y - 1, 24, 9, 0, 0, Math.PI * 2); context.fill(); context.stroke(); }
    context.strokeStyle = '#963f2f'; context.lineWidth = 2;
    for (const object of frame.objects.filter(object => object.ref === options.selected)) { context.beginPath(); context.arc(object.position.x, object.position.y, 18, 0, Math.PI * 2); context.stroke(); }
    context.restore();
    const points = new Map<string, Position>(), inputs: SpatialLabelInput[] = [];
    const addLabel = (key: string, label: string, position: Position, bounds: SceneRect, priority: number, selectable = true) => { const point = screenPoint(position, fit); points.set(key, point); inputs.push({ key, label, point, footprint: { x: point.x + bounds.x * fit.scale, y: point.y + bounds.y * fit.scale, width: bounds.width * fit.scale, height: bounds.height * fit.scale }, selectable, priority }); };
    for (const person of people) addLabel(person.entityRef, options.personLabels?.[person.entityRef] || person.name, person.position, fallbackBody, protectedRefs.has(person.entityRef) ? 0 : 1);
    for (const object of frame.objects) addLabel(object.ref, object.name, object.position, object.bounds, object.ref === options.selected ? 0 : 2);
    for (const anchor of scene.anchors.filter(anchor => scene.exits.some(exit => exit.anchorId === anchor.anchorId))) addLabel(`anchor:${anchor.anchorId}`, anchor.label, anchor.position, { x: -10, y: -10, width: 20, height: 20 }, 3, false);
    const labelKey = JSON.stringify([this.#scope, this.#width, this.#height, options.selected, inputs.map(input => [input.key, input.label]), frame.objects.map(object => [object.ref, object.file, object.bounds])]);
    if (labelKey !== this.#labelKey) { this.#labelKey = labelKey; this.#labelLayout = layoutSpatialLabels(inputs, { width: this.#width, height: this.#height }); }
    frame.labels = this.#labelLayout.labels.flatMap(label => {
      const point = points.get(label.key); if (!point) return [];
      const x = clamp(point.x + label.x - label.point.x, 8, this.#width - label.width - 8), y = clamp(point.y + label.y - label.point.y, 8, this.#height - label.height - 8);
      return [{ ...label, point, x, y, lineX: clamp(point.x, x + 8, x + label.width - 8), lineY: clamp(point.y, y, y + label.height) }];
    });
    frame.omittedLabels = this.#labelLayout.omitted;
    context.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0); context.font = '14px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
    frame.labelFont = context.font;
    for (const label of frame.labels) {
      context.strokeStyle = '#8c8b7180'; context.lineWidth = 1; context.beginPath(); context.moveTo(label.point.x, label.point.y); context.lineTo(label.lineX, label.lineY); context.stroke();
      context.fillStyle = label.key === options.selected ? '#fff4d9f5' : '#fff8e9f2'; context.strokeStyle = label.key === options.selected ? '#963f2f' : '#a9957280'; context.lineWidth = label.key === options.selected ? 2 : 1;
      context.beginPath(); context.roundRect(label.x, label.y, label.width, label.height, 12); context.fill(); context.stroke();
      context.fillStyle = label.key === p.self.entityRef ? '#365e52' : '#332c23';
      const limit = Math.max(1, Math.floor((label.width - 16) / 14)), characters = [...label.label];
      if (characters.length > limit) { context.fillText(characters.slice(0, limit).join(''), label.x + label.width / 2, label.y + label.height / 2 - 8); context.fillText(characters.slice(limit, limit * 2).join(''), label.x + label.width / 2, label.y + label.height / 2 + 8); }
      else context.fillText(label.label, label.x + label.width / 2, label.y + label.height / 2);
    }
    options.beforeFrontWrite?.();
    this.#front.setTransform(1, 0, 0, 1, 0, 0); this.#front.drawImage(this.#buffer, 0, 0);
    frames.set(this.#canvas, frame);
    this.#canvas.dataset.sceneId = scene.sceneId; this.#canvas.dataset.sceneLayerStatus = frame.layerStatus; this.#canvas.dataset.sceneView = `0 0 ${scene.width} ${scene.height}`; this.#canvas.dataset.renderedEntities = String(frame.objects.length + frame.actors.length);
    return frame;
  }
}
