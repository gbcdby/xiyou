import { canonicalize, parseStrictJSON } from '../protocol/index.mjs';
import { contentSchema } from './schema.mjs';

export class ContentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ContentError';
    this.code = 'INVALID_CONTENT';
  }
}

const requireCondition = (value, message) => { if (!value) throw new ContentError(message); };

/** 只实现本结构源使用的关键字；新增 schema 关键字时必须同步审查。 */
function check(schema, value, path = '$') {
  if (schema.$ref) return check(contentSchema.$defs[schema.$ref.split('/').at(-1)], value, path);
  if (schema.oneOf) {
    const matches = schema.oneOf.filter(option => {
      try { check(option, value, path); return true; } catch (error) { if (!(error instanceof ContentError)) throw error; return false; }
    });
    requireCondition(matches.length === 1, '配置结构分支不匹配：' + path);
    return;
  }
  if (Object.hasOwn(schema, 'const')) requireCondition(value === schema.const, '配置固定值不匹配：' + path);
  if (schema.enum) requireCondition(schema.enum.includes(value), '配置枚举不匹配：' + path);
  if (!schema.type) return;
  if (schema.type === 'null') return requireCondition(value === null, '配置需要空值：' + path);
  if (schema.type === 'boolean') return requireCondition(typeof value === 'boolean', '配置需要布尔值：' + path);
  if (schema.type === 'integer') {
    requireCondition(Number.isSafeInteger(value) && value >= schema.minimum && value <= schema.maximum, '配置整数越界：' + path);
    return;
  }
  if (schema.type === 'string') {
    requireCondition(typeof value === 'string', '配置需要字符串：' + path);
    const length = [...value].length;
    requireCondition((schema.minLength === undefined || length >= schema.minLength) && (schema.maxLength === undefined || length <= schema.maxLength), '配置文本长度越界：' + path);
    if (schema.pattern) requireCondition(new RegExp(schema.pattern, 'u').test(value), '配置标识格式错误：' + path);
    return;
  }
  if (schema.type === 'array') {
    requireCondition(Array.isArray(value), '配置需要数组：' + path);
    requireCondition((schema.minItems === undefined || value.length >= schema.minItems) && (schema.maxItems === undefined || value.length <= schema.maxItems), '配置数组规模越界：' + path);
    if (schema.uniqueItems) requireCondition(new Set(value.map(item => JSON.stringify(item))).size === value.length, '配置数组存在重复值：' + path);
    value.forEach((item, index) => check(schema.items, item, path + '[' + index + ']'));
    return;
  }
  requireCondition(schema.type === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value), '配置需要对象：' + path);
  const keys = Object.keys(value);
  if (schema.maxProperties !== undefined) requireCondition(keys.length <= schema.maxProperties, '配置字段数量越界：' + path);
  for (const key of schema.required ?? []) requireCondition(Object.hasOwn(value, key), '配置缺少必需字段：' + path + '.' + key);
  for (const key of keys) {
    if (schema.propertyNames) check(schema.propertyNames, key, path + '.<key>');
    if (Object.hasOwn(schema.properties ?? {}, key)) check(schema.properties[key], value[key], path + '.' + key);
    else if (schema.additionalProperties === false) throw new ContentError('配置含未知字段：' + path + '.' + key);
    else if (typeof schema.additionalProperties === 'object') check(schema.additionalProperties, value[key], path + '.' + key);
  }
}

function indexBy(rows, key) {
  const result = new Map();
  for (const row of rows) {
    requireCondition(!result.has(row[key]), '配置标识重复：' + key);
    result.set(row[key], row);
  }
  return result;
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** 验证内容结构与静态引用，不执行世界动作或生成 NPC 感知。 */
export function validateContent(input) {
  let content;
  try { content = parseStrictJSON(canonicalize(input), { maxBytes: 262144 }); }
  catch { throw new ContentError('配置不是无歧义的有限 JSON'); }
  check(contentSchema, content);
  const roles = indexBy(content.roles, 'roleId');
  const regions = indexBy(content.regions, 'regionId');
  const targets = indexBy(content.targets, 'targetId');
  const items = indexBy(content.items, 'itemId');
  const knowledge = indexBy(content.knowledge, 'knowledgeId');
  const operations = indexBy(content.operations, 'operationId');
  const npcs = indexBy(content.npcs, 'characterId');
  const capabilities = new Set([...content.humanCapabilities, ...content.roles.flatMap(role => role.capabilities)]);
  const entities = [...regions.keys(), ...targets.keys(), ...items.keys(), ...npcs.keys()];
  requireCondition(new Set(entities).size === entities.length, '对象标识不能跨种类重复');
  const reference = (map, id) => requireCondition(map.has(id), '配置存在悬空引用');
  const known = ids => ids.forEach(id => reference(knowledge, id));
  const fields = target => new Set(target.fields.map(field => field.key));
  for (const group of Object.values(content.partyRoles)) {
    const assigned = group.flat();
    requireCondition(assigned.length === roles.size && new Set(assigned).size === roles.size && assigned.every(id => roles.has(id)), '开局职责必须完整且不重复');
  }
  for (const role of content.roles) {
    reference(regions, role.initialRegionId);
    requireCondition(regions.get(role.initialRegionId).kind === 'scene', '角色必须从可交互场所开始');
    known(role.initialKnowledgeIds);
  }
  for (const region of content.regions) {
    region.exits.forEach(id => reference(regions, id));
    if (region.entryRequirement) {
      reference(targets, region.entryRequirement.targetId);
      requireCondition(Object.keys(region.entryRequirement.fields).every(key => fields(targets.get(region.entryRequirement.targetId)).has(key)), '区域条件引用未知状态字段');
    }
  }
  for (const target of content.targets) {
    reference(regions, target.regionId);
    indexBy(target.fields, 'key');
    for (const inspection of target.inspections) {
      requireCondition(capabilities.has(inspection.requiredCapability), '检查需要未分配的能力');
      known(inspection.knowledgeIds);
    }
    for (const id of target.operationIds) {
      reference(operations, id);
      requireCondition(operations.get(id).targetId === target.targetId, '操作和目标引用不一致');
    }
  }
  for (const item of content.items) {
    reference(item.initialLocation.kind === 'role' ? roles : regions, item.initialLocation.roleId ?? item.initialLocation.regionId);
    if (item.takeCapability !== null) requireCondition(capabilities.has(item.takeCapability), '拿取需要未分配的能力');
    requireCondition(item.kind !== 'tool' || !item.consumedOnUse, '本切片修复工具不得消耗');
    indexBy(item.fields, 'key');
  }
  for (const entry of content.knowledge) {
    requireCondition(entities.includes(entry.subjectId), '知识引用未知对象');
    indexBy(entry.fields, 'key');
  }
  for (const operation of content.operations) {
    reference(targets, operation.targetId);
    const target = targets.get(operation.targetId);
    requireCondition(target.operationIds.includes(operation.operationId), '目标未声明对应操作');
    requireCondition(capabilities.has(operation.requiredCapability), '操作需要未分配的能力');
    requireCondition([...Object.keys(operation.requiredTargetValues), ...Object.keys(operation.effectValues)].every(key => fields(target).has(key)), '操作引用未知状态字段');
    requireCondition(operation.consumedItemKinds.every(kind => operation.requiredItemKinds.includes(kind)), '不能消耗未要求的物品');
    if (operation.recordMaterialField !== null) requireCondition(fields(target).has(operation.recordMaterialField), '修复记录字段不存在');
    if (operation.kind === 'repair') requireCondition(operation.requiredItemKinds.includes('material') && operation.requiredItemKinds.includes('tool') && operation.consumedItemKinds.length === 1 && operation.consumedItemKinds[0] === 'material', '修复必须消耗材料并使用工具');
    if (operation.kind === 'permit') requireCondition(operation.requiredItemKinds.length === 0 && operation.consumedItemKinds.length === 0, '许可不能隐含消耗物品');
  }
  for (const npc of content.npcs) {
    reference(regions, npc.initialRegionId);
    known(npc.initialKnowledgeIds);
    indexBy(npc.initialBeliefs, 'beliefId');
    for (const belief of npc.initialBeliefs) requireCondition(belief.basedOnKnowledgeIds.every(id => npc.initialKnowledgeIds.includes(id)), '初始信念只能引用该 NPC 的初始观察');
  }
  const policy = content.endingPolicy;
  reference(targets, policy.gateTargetId);
  reference(regions, policy.exitRegionId);
  requireCondition(regions.get(policy.exitRegionId).kind === 'exit', '结局必须引用通行终点');
  policy.requiredNpcIds.forEach(id => reference(npcs, id));
  for (const id of [policy.originalMaterialId, policy.spareMaterialId]) { reference(items, id); requireCondition(items.get(id).kind === 'material', '结局必须引用真实材料'); }
  requireCondition(policy.originalMaterialId !== policy.spareMaterialId, '原材料与备用材料必须独立');
  indexBy(policy.evidenceGroups, 'groupId');
  const evidenceIds = policy.evidenceGroups.flatMap(group => group.knowledgeIds);
  requireCondition(new Set(evidenceIds).size === evidenceIds.length, '证据链不能重复计算同一观察');
  known(evidenceIds);
  const sourceIds = evidenceIds.flatMap(id => {
    const entry = knowledge.get(id);
    requireCondition(entry.category === 'Evidence' && entry.shareable, '结局证据必须可合法展示');
    return entry.sourceIds;
  });
  requireCondition(new Set(sourceIds).size === sourceIds.length, '结局证据必须来自独立来源');
  return freeze(content);
}
