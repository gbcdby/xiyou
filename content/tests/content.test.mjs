import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { loadContent, rolesForPlayers, validateContent, contentDigest } from '../index.mjs';
import * as contentApi from '../index.mjs';

for (const [label, change] of [
  ['组合名称超长', content => {
    content.roles.find(role => role.roleId === 'A').name = '甲'.repeat(80);
    content.roles.find(role => role.roleId === 'D').name = '丁'.repeat(80);
  }],
  ['能力并集超量', content => {
    while (content.humanCapabilities.length < 32) content.humanCapabilities.push('extra_' + content.humanCapabilities.length);
  }],
]) {
  test('内容装配拒绝无法进入共享投影协议的配置：' + label, async () => {
    const content = structuredClone(await loadContent('trust-repair-fixture-v1'));
    change(content);
    assert.throws(() => validateContent(content), { code: 'INVALID_CONTENT' });
    assert.throws(() => contentApi.assemblePlayers(content, 2), { code: 'INVALID_CONTENT' });
  });
}

test('组合职责只装配一个出生区域，同时保留全部能力和初始知识', async () => {
  const content = await loadContent('trust-repair-fixture-v1');
  assert.equal(typeof contentApi.assemblePlayers, 'function');
  const expectedRegions = {
    2: ['passage', 'store'],
    3: ['passage', 'store', 'passage'],
    4: ['passage', 'store', 'passage', 'side_path'],
    5: ['passage', 'store', 'passage', 'side_path', 'store'],
  };
  for (const count of [2, 3, 4, 5]) {
    const players = contentApi.assemblePlayers(content, count);
    assert.equal(players.length, count);
    assert.deepEqual(players.map(player => player.initialRegionId), expectedRegions[count]);
    assert.deepEqual(players.map(player => player.roles), rolesForPlayers(content, count));
    assert.ok(players.every(player => player.name.length > 0 && player.capabilities.includes('move')));
  }
  const two = contentApi.assemblePlayers(content, 2);
  assert.deepEqual(two[0].initialKnowledgeIds, ['structure_record', 'moving_sighting']);
  assert.deepEqual(two[1].initialKnowledgeIds, ['missing_material_notice', 'passage_conditions', 'register_location']);
  assert.ok(two[0].capabilities.includes('inspect_structure'));
  assert.ok(two[0].capabilities.includes('retrieve_original'));
  for (const capability of ['inspect_inventory', 'grant_passage', 'inspect_records']) {
    assert.ok(two[1].capabilities.includes(capability));
  }
  two[0].roles.push('B');
  two[0].capabilities.length = 0;
  assert.deepEqual(contentApi.assemblePlayers(content, 2)[0].roles, ['A', 'D']);
  assert.ok(contentApi.assemblePlayers(content, 2)[0].capabilities.includes('move'));
  assert.throws(() => contentApi.assemblePlayers(content, 1), /人数/);
  const boundary = structuredClone(content);
  boundary.roles.find(role => role.roleId === 'A').name = '甲'.repeat(60);
  boundary.roles.find(role => role.roleId === 'D').name = '丁'.repeat(59);
  while (boundary.humanCapabilities.length < 29) boundary.humanCapabilities.push('extra_' + boundary.humanCapabilities.length);
  const combined = contentApi.assemblePlayers(boundary, 2)[0];
  assert.equal([...combined.name].length, 120);
  assert.equal(combined.capabilities.length, 32);
});

test('两至五人配置完整分配五项职责，每人始终只有一个职责组合', async () => {
  const content = await loadContent('trust-repair-fixture-v1');
  const expected = {
    2: [['A', 'D'], ['B', 'C', 'E']],
    3: [['A', 'D'], ['B'], ['C', 'E']],
    4: [['A'], ['B'], ['C', 'E'], ['D']],
    5: [['A'], ['B'], ['C'], ['D'], ['E']],
  };
  assert.equal(content.contentVersion, 'trust-repair-fixture-v1');
  for (const count of [2, 3, 4, 5]) {
    const groups = rolesForPlayers(content, count);
    assert.deepEqual(groups, expected[count]);
    assert.deepEqual(groups.flat().sort(), ['A', 'B', 'C', 'D', 'E']);
    assert.equal(groups.length, count);
  }
  assert.throws(() => rolesForPlayers(content, 1), /人数/);
  assert.throws(() => rolesForPlayers(content, 6), /人数/);
  assert.ok(Object.isFrozen(content));
  assert.ok(Object.isFrozen(content.roles));
});

test('已注册版本的文件被意外改写时拒绝装载', async () => {
  const repository = fileURLToPath(new URL('../../', import.meta.url));
  const output = path.join(repository, '.agent-output', 'content-tests');
  await mkdir(output, { recursive: true });
  const copy = await mkdtemp(path.join(output, 'version-'));
  try {
    await cp(path.join(repository, 'content'), path.join(copy, 'content'), { recursive: true });
    await symlink(path.join(repository, 'protocol'), path.join(copy, 'protocol'), 'dir');
    await symlink(path.join(repository, 'game'), path.join(copy, 'game'), 'dir');
    const file = path.join(copy, 'content', 'fixtures', 'trust-repair-fixture-v1.json');
    const modified = JSON.parse(await readFile(file, 'utf8'));
    modified.knowledge.find(entry => entry.knowledgeId === 'register_entry').statement = '相同版本被静默改写。';
    await writeFile(file, JSON.stringify(modified));
    const isolated = await import(pathToFileURL(path.join(copy, 'content', 'index.mjs')).href);
    await assert.rejects(isolated.loadContent('trust-repair-fixture-v1'), { code: 'INVALID_CONTENT' });
  } finally {
    await rm(copy, { recursive: true, force: true });
  }
});

test('内容版本使用规范摘要固定，未知版本不作为文件路径读取', async () => {
  const content = await loadContent('trust-repair-fixture-v1');
  const digest = contentDigest(content);
  assert.match(digest, /^[a-f0-9]{64}$/);
  const reordered = Object.fromEntries(Object.entries(content).reverse());
  assert.equal(contentDigest(reordered), digest);
  const changed = structuredClone(content);
  changed.knowledge.find(entry => entry.knowledgeId === 'register_entry').statement = '登记内容发生了改变。';
  assert.notEqual(contentDigest(changed), digest);
  await assert.rejects(loadContent('../fixtures/trust-repair-fixture-v1.json'), { code: 'INVALID_CONTENT' });
  const roles = rolesForPlayers(content, 2);
  roles[0].push('B');
  assert.deepEqual(rolesForPlayers(content, 2), [['A', 'D'], ['B', 'C', 'E']]);
});

test('内容校验拒绝缺失职责、悬空引用、重复来源和越界配置', async () => {
  const original = await loadContent('trust-repair-fixture-v1');
  assert.equal(validateContent(original).contentVersion, original.contentVersion);
  const invalid = [
    content => { content.partyRoles['2'][1] = ['B', 'C', 'A']; },
    content => { content.targets[0].regionId = 'missing'; },
    content => { content.items[1].initialLocation.roleId = 'Z'; },
    content => { content.targets[0].operationIds.push('missing'); },
    content => { content.knowledge.find(knowledge => knowledge.knowledgeId === 'damage_trace').sourceIds = ['structure-before-arrival']; },
    content => { content.npcs[0].initialBeliefs[0].basedOnKnowledgeIds = ['structure_record']; },
    content => { content.operations[0].humanOnly = false; },
    content => { content.timing.durationSeconds = 0; },
    content => { content.unknown = true; },
  ];
  for (const change of invalid) {
    const content = structuredClone(original);
    change(content);
    assert.throws(() => validateContent(content), { code: 'INVALID_CONTENT' });
  }
});

test('试验场景固定材料、工具、三处场所、真人操作及两组独立来源', async () => {
  const content = await loadContent('trust-repair-fixture-v1');
  assert.equal(content.timing.durationSeconds, 1200);
  assert.equal(content.regions.filter(region => region.kind === 'scene').length, 3);
  const original = content.items.find(item => item.itemId === 'original_material');
  const spare = content.items.find(item => item.itemId === 'spare_material');
  const tool = content.items.find(item => item.itemId === 'repair_tool');
  assert.deepEqual({ ...original.initialLocation }, { kind: 'region', regionId: 'side_path' });
  assert.equal(original.takeCapability, 'retrieve_original');
  assert.deepEqual({ ...spare.initialLocation }, { kind: 'role', roleId: 'B' });
  assert.deepEqual({ ...tool.initialLocation }, { kind: 'role', roleId: 'B' });
  assert.equal(tool.consumedOnUse, false);
  assert.equal(content.operations.find(operation => operation.operationId === 'repair').humanOnly, true);
  assert.equal(content.operations.find(operation => operation.operationId === 'grant_passage').requiredCapability, 'grant_passage');
  assert.deepEqual(content.endingPolicy.requiredNpcIds, ['tangseng', 'wukong']);
  assert.deepEqual(content.endingPolicy.evidenceGroups.map(group => group.knowledgeIds), [
    ['structure_record', 'damage_trace'], ['register_entry', 'material_trace'],
  ]);
  const sources = content.endingPolicy.evidenceGroups.flatMap(group => group.knowledgeIds)
    .flatMap(id => content.knowledge.find(knowledge => knowledge.knowledgeId === id).sourceIds);
  assert.equal(new Set(sources).size, sources.length);
  assert.equal(content.asset_source, 'original_team');
});
