import { contractSchema } from '../protocol/schema.mjs';

const ref = name => ({ $ref: '#/$defs/' + name });
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const array = (items, minItems = 0, maxItems = 64) => ({ type: 'array', items, minItems, maxItems });
const ids = (minItems = 0, maxItems = 32) => ({ ...array(ref('Id'), minItems, maxItems), uniqueItems: true });
const text = maxLength => ({ type: 'string', minLength: 1, maxLength });
const nullable = value => ({ oneOf: [value, { type: 'null' }] });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const values = { type: 'object', propertyNames: ref('Id'), additionalProperties: ref('Scalar'), maxProperties: 32 };

/** 本轮机制配置的唯一结构来源；关系约束由 index.mjs 检查。 */
const defs = {
  Id: contractSchema.$defs.Id,
  Scalar: contractSchema.$defs.Scalar,
  FactField: contractSchema.$defs.FactField,
  Location: { oneOf: [
    object({ kind: { const: 'region' }, regionId: ref('Id') }),
    object({ kind: { const: 'role' }, roleId: ref('Id') }),
  ] },
  Role: object({ roleId: ref('Id'), name: text(120), motivation: text(500), capabilities: ids(), initialKnowledgeIds: ids(), initialRegionId: ref('Id') }),
  Region: object({
    regionId: ref('Id'), kind: { enum: ['scene', 'exit'] }, name: text(120), description: text(1000), exits: ids(0, 16),
    entryRequirement: nullable(object({ targetId: ref('Id'), fields: values })),
  }),
  Target: object({
    targetId: ref('Id'), name: text(120), regionId: ref('Id'), fields: array(ref('FactField'), 0, 32),
    inspections: array(object({ requiredCapability: ref('Id'), knowledgeIds: ids(1) }), 0, 16), operationIds: ids(),
  }),
  Item: object({
    itemId: ref('Id'), name: text(120), kind: { enum: ['material', 'tool'] }, initialLocation: ref('Location'),
    takeCapability: nullable(ref('Id')), transferable: { type: 'boolean' }, consumedOnUse: { type: 'boolean' }, fields: array(ref('FactField'), 0, 32),
  }),
  Knowledge: object({
    knowledgeId: ref('Id'), category: { enum: ['WorldFact', 'Claim', 'Evidence'] }, statement: text(2000),
    subjectId: ref('Id'), sourceIds: ids(1), fields: array(ref('FactField'), 0, 32), shareable: { type: 'boolean' },
  }),
  Operation: object({
    operationId: ref('Id'), label: text(120), kind: { enum: ['repair', 'permit'] }, targetId: ref('Id'), humanOnly: { const: true },
    requiredCapability: ref('Id'), requiredTargetValues: values, requiredItemKinds: { ...array({ enum: ['material', 'tool'] }, 0, 2), uniqueItems: true },
    consumedItemKinds: { ...array({ enum: ['material', 'tool'] }, 0, 2), uniqueItems: true }, effectValues: values, recordMaterialField: nullable(ref('Id')),
  }),
  Npc: object({
    characterId: ref('Id'), name: text(120), initialRegionId: ref('Id'), initialKnowledgeIds: ids(),
    initialBeliefs: array(object({ beliefId: ref('Id'), statement: text(2000), confidence: { enum: ['uncertain', 'likely', 'confident'] }, basedOnKnowledgeIds: ids(1) }), 0, 16),
  }),
  EndingPolicy: object({
    gateTargetId: ref('Id'), exitRegionId: ref('Id'), requiredNpcIds: ids(2, 2), originalMaterialId: ref('Id'), spareMaterialId: ref('Id'),
    evidenceGroups: array(object({ groupId: ref('Id'), knowledgeIds: ids(2) }), 2, 2),
    codes: object({ clarified: ref('Id'), costly: ref('Id'), unresolved: ref('Id') }),
  }),
};
defs.Content = object({
  schemaVersion: { const: 1 }, contentVersion: ref('Id'), reducerVersion: ref('Id'), asset_source: { const: 'original_team' }, title: text(120),
  timing: object({ durationSeconds: integer(900, 1800), gracePeriodSeconds: integer(1, 300), decisionTimeoutSeconds: integer(1, 120) }),
  humanCapabilities: ids(1), roles: array(ref('Role'), 5, 5),
  partyRoles: object(Object.fromEntries([2, 3, 4, 5].map(count => [String(count), array(ids(1, 5), count, count)]))),
  regions: array(ref('Region'), 4, 32), targets: array(ref('Target'), 1, 256), items: array(ref('Item'), 3, 256),
  knowledge: array(ref('Knowledge'), 1, 256), operations: array(ref('Operation'), 2, 32), npcs: array(ref('Npc'), 2, 2), endingPolicy: ref('EndingPolicy'),
});

export const contentSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://github.com/gbcdby/xiyou/content/schema-v1',
  title: 'xiyou 首个机制场景内容结构',
  description: '仅定义配置结构；运行时权限、提交、感知和结局必须由权威服务执行。',
  $defs: defs, $ref: '#/$defs/Content',
};
