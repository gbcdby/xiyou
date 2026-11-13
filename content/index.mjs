import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { canonicalize, parseStrictJSON } from '../protocol/index.mjs';
import { ContentError, validateContent } from './validate.mjs';
import versions from './versions.json' with { type: 'json' };

export { ContentError, validateContent } from './validate.mjs';
export { contentSchema } from './schema.mjs';

const registry = new Map([
  ['trust-repair-fixture-v1', new URL('./fixtures/trust-repair-fixture-v1.json', import.meta.url)],
  ['gaolaozhuang-v1', new URL('./fixtures/gaolaozhuang-v1.json', import.meta.url)],
  ['gaolaozhuang-tools-east-v1', new URL('./fixtures/gaolaozhuang-tools-east-v1.json', import.meta.url)],
  ['gaolaozhuang-scene-v2', new URL('./fixtures/gaolaozhuang-scene-v2.json', import.meta.url)],
  ['gaolaozhuang-tools-east-scene-v2', new URL('./fixtures/gaolaozhuang-tools-east-scene-v2.json', import.meta.url)],
  ['spatial-graybox-v2', new URL('./fixtures/spatial-graybox-v2.json', import.meta.url)],
]);

/** 仅按受控注册表读取版本，不能用外部输入组成文件路径。 */
export async function loadContent(version) {
  const file = registry.get(version);
  if (!file) throw new ContentError('未知内容版本');
  const content = validateContent(parseStrictJSON(await readFile(file, 'utf8'), { maxBytes: 262144 }));
  if (content.contentVersion !== version) throw new ContentError('注册版本与配置版本不一致');
  const expected = versions[version];
  if (!expected || content.reducerVersion !== expected.reducerVersion || contentDigest(content) !== expected.sha256) throw new ContentError('已注册内容版本的摘要不一致');
  return content;
}

/** 返回开局装配数据；运行中的 Session 不因在线人数变化再次调用。 */
export function rolesForPlayers(content, count) {
  if (!Number.isInteger(count) || count < 2 || count > 5) throw new Error('人数必须为二至五人');
  return structuredClone(validateContent(content).partyRoles[String(count)]);
}

/** 每个固定槽位装配一个角色；首项职责决定唯一起始场所，全部职责贡献能力与知识。 */
export function assemblePlayers(content, count) {
  const validated = validateContent(content);
  const groups = rolesForPlayers(validated, count);
  const roles = new Map(validated.roles.map(role => [role.roleId, role]));
  return groups.map(group => {
    const assigned = group.map(id => roles.get(id));
    return {
      roles: [...group],
      name: assigned.map(role => role.name).join('兼'),
      initialRegionId: assigned[0].initialRegionId,
      capabilities: [...new Set([...validated.humanCapabilities, ...assigned.flatMap(role => role.capabilities)])],
      initialKnowledgeIds: [...new Set(assigned.flatMap(role => role.initialKnowledgeIds))],
    };
  });
}

/** Session 保存此摘要和完整配置快照，回放不重新读取正在变化的配置文件。 */
export function contentDigest(content) {
  return createHash('sha256').update(canonicalize(validateContent(content)), 'utf8').digest('hex');
}
