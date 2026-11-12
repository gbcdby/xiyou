import { readFile } from 'node:fs/promises';
import { spatialSchema, object, array, ref, integer, lit, text, en, nullable } from '../protocol/spatial-schema.mjs';
import { checkSpatialSchema } from '../protocol/spatial.mjs';
import { canonicalize, parseStrictJSON } from '../protocol/index.mjs';
import { walkable } from '../game/spatial-geometry.mjs';
const point = ref('Position'), fields = array(ref('FactField'), 32), ids = array(ref('Id'));
const condition = object({ targetId: ref('Id'), field: ref('Id'), value: ref('Scalar') });
export const spatialContentSchema = { ...spatialSchema, $defs: { ...spatialSchema.$defs,
        Condition: condition,
        SceneConfig: object({ sceneId: ref('Id'), name: text(120), width: integer(1000000, 1), height: integer(1000000, 1), unitsPerPixel: integer(10000, 1), gridSize: integer(1000, 1), walkableAreas: array(object({ areaId: ref('Id'), polygon: ref('Polygon') })), obstacles: array(object({ obstacleId: ref('Id'), polygon: ref('Polygon'), exceptAreas: ids, disabledWhen: ref('Condition') }, ['disabledWhen'])), anchors: array(object({ anchorId: ref('Id'), position: point, label: text(120) })), exits: array(object({ exitId: ref('Id'), anchorId: ref('Id'), destinationSceneId: ref('Id'), destination: point, requirement: nullable(ref('Condition')) })) }),
        SpatialContent: object({ schemaVersion: lit(2), contentVersion: ref('Id'), protocolCapability: lit('spatial-v2'), reducerVersion: lit('spatial-world-v2'), chapterVersion: ref('Id'), mapVersion: ref('Id'), variantId: ref('Id'), asset_source: en('original_team', 'classical_public_domain_reference'), timing: object({ gracePeriodSeconds: integer(600, 1), decisionTimeoutSeconds: integer(600, 1) }), movement: object({ speedPerSecond: integer(10000, 1), interactionRadius: integer(10000, 1), sightRadius: integer(1000000, 1), hearingRadius: integer(1000000, 1) }), scenes: array(ref('SceneConfig'), 16), spawns: { ...array(object({ sceneId: ref('Id'), position: point }), 5), minItems: 5 }, npcs: array(object({ characterId: ref('Id'), name: text(120), actorKind: en('persistent_core', 'chapter_autonomous', 'scene_role'), sceneId: ref('Id'), position: point })), items: array(object({ itemId: ref('Id'), name: text(120), sceneId: ref('Id'), position: point, transferable: { type: 'boolean' }, publicBorrowable: { type: 'boolean' }, fields })), targets: array(object({ targetId: ref('Id'), name: text(120), sceneId: ref('Id'), position: point, fields, operationIds: ids })), operations: array(object({ operationId: ref('Id'), targetId: ref('Id'), kind: en('interaction', 'cooperation'), requiredCount: integer(5, 1), anchorIds: array(ref('Id'), 5), requiredItemIds: ids, consumedItemIds: ids, requiredFields: fields, effectFields: fields })), objectives: array(object({ objectiveId: ref('Id'), label: text(240), status: en('active', 'completed', 'blocked') })) })
    } };
export function validateSpatialContent(input) {
    const content = parseStrictJSON(canonicalize(input), { maxBytes: 1048576 });
    checkSpatialSchema(ref('SpatialContent'), content, spatialContentSchema.$defs);
    const scenes = new Map(content.scenes.map(s => [s.sceneId, s]));
    const allIds = [...scenes.keys(), ...content.npcs.map(x => x.characterId), ...content.items.map(x => x.itemId), ...content.targets.map(x => x.targetId)];
    if (new Set(allIds).size !== allIds.length)
        throw new Error('空间内容的实体标识重复。');
    for (const row of [...content.spawns, ...content.npcs, ...content.items, ...content.targets]) {
        const scene = scenes.get(row.sceneId);
        if (!scene || !walkable(scene, row.position, () => false))
            throw new Error('空间内容的初始位置不可走。');
    }
    for (const scene of scenes.values()) {
        if (Math.ceil(scene.width / scene.gridSize) * Math.ceil(scene.height / scene.gridSize) > 50000)
            throw new Error('导航网格超过支持规模。');
        for (const o of scene.obstacles)
            if (o.exceptAreas.some(id => !scene.walkableAreas.some(a => a.areaId === id)))
                throw new Error('障碍豁免区域不存在。');
        for (const e of scene.exits)
            if (!scene.anchors.some(a => a.anchorId === e.anchorId) || !scenes.has(e.destinationSceneId) || !walkable(scenes.get(e.destinationSceneId), e.destination, () => false))
                throw new Error('场景入口引用错误。');
    }
    for (const op of content.operations) {
        const target = content.targets.find(t => t.targetId === op.targetId);
        if (!target || !target.operationIds.includes(op.operationId) || op.anchorIds.some(id => !scenes.get(target.sceneId).anchors.some(a => a.anchorId === id)) || op.requiredItemIds.some(id => !content.items.some(i => i.itemId === id)) || op.consumedItemIds.some(id => !op.requiredItemIds.includes(id)) || op.anchorIds.length < op.requiredCount)
            throw new Error('空间操作引用错误。');
    }
    return content;
}
export async function loadSpatialFixture() { return validateSpatialContent(parseStrictJSON(await readFile(new URL('./fixtures/spatial-graybox-v2.json', import.meta.url), 'utf8'))); }
