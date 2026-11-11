import { validateContract } from '../../../protocol/index.mjs';
import type { AuthorizedSnapshot } from './world.ts';

/** 独立界面示例，只包含示例角色可见的 DTO，不导入完整场景配置。 */
export function demoSnapshot(): AuthorizedSnapshot {
  return validateContract('AuthorizedSnapshot', {
    schemaVersion: 1, type: 'world.snapshot', sessionId: 'ui-demo', viewId: 'ui-demo-human', snapshotSeq: '12',
    projection: {
      phase: 'Running', contentVersion: 'ui-demo-v1', reducerVersion: 'world-v1',
      self: { characterId: 'demo-A', name: '青禾', regionId: 'passage', roles: ['A'], mode: 'HumanControlled', controlEpoch: '1', canControl: true, capabilities: ['inspect', 'repair'] },
      characters: [
        { characterId: 'demo-A', name: '青禾', regionId: 'passage', roles: ['A'], mode: 'HumanControlled', online: true },
        { characterId: 'demo-B', name: '松风', regionId: null, roles: ['B'], mode: 'HumanControlled', online: true },
        { characterId: 'demo-C', name: '照水', regionId: 'passage', roles: ['C'], mode: 'HumanControlled', online: true },
        { characterId: 'demo-D', name: '竹隐', regionId: null, roles: ['D'], mode: 'GracePeriod', online: false },
        { characterId: 'demo-E', name: '见山', regionId: null, roles: ['E'], mode: 'HumanControlled', online: true },
        { characterId: 'tangseng', name: '唐僧', regionId: 'passage', roles: [], mode: 'CoreNPCControlled', online: true },
        { characterId: 'wukong', name: '孙悟空', regionId: null, roles: [], mode: 'CoreNPCControlled', online: true },
      ],
      regions: [
        { regionId: 'passage', name: '通路口', description: '山风越过石阶。封闭的通路前，一道旧痕等待被重新看见。', exits: ['store', 'side_path'] },
        { regionId: 'store', name: '材料间', description: '核对库存、登记与实际供给。', exits: ['passage', 'side_path'] },
        { regionId: 'side_path', name: '侧路', description: '沿搬运痕迹寻找材料的去向。', exits: ['passage', 'store'] },
      ],
      items: [{ itemId: 'demo-rope', name: '丈量绳', location: { kind: 'character', characterId: 'demo-A' }, resourceRevision: '0', transferable: true, fields: [] }],
      targets: [{ targetId: 'passage_structure', name: '受损通路', regionId: 'passage', resourceRevision: '1', availableOperations: ['repair'], fields: [{ key: 'safe', label: '结构安全', value: false }, { key: 'permit', label: '通行许可', value: false }] }],
      observations: [
        { observationId: 'demo-evidence', observerId: 'demo-A', category: 'Evidence', source: { kind: 'initial_content', sourceIds: ['demo-old-record'], sourceSeq: '0' }, statement: '到达前的结构记录已有此处损坏。与现场痕迹比对，才能让这份记录成为完整的证据。', subjectId: 'passage_structure', fields: [{ key: 'damageBeforeArrival', label: '损坏早于到达', value: true }], shareable: true },
        { observationId: 'demo-fact', observerId: 'demo-A', category: 'WorldFact', source: { kind: 'inspection', sourceIds: ['demo-inspection'], sourceSeq: '8' }, statement: '通路仍不安全，实际修复尚未完成。', subjectId: 'passage_structure', fields: [{ key: 'safe', label: '安全', value: false }], shareable: true },
      ],
      claims: [
        { claimId: 'demo-claim-1', speakerId: 'tangseng', text: '先确认通路安全，再查清材料的去向。莫让无辜的人承担损失。', channel: 'public', recipientIds: [] },
        { claimId: 'demo-claim-2', speakerId: 'demo-C', text: '等实际修好，我来核对通行条件。', channel: 'directed', recipientIds: ['demo-A'] },
      ],
      objectives: [
        { objectiveId: 'inspect', label: '查明损坏与材料去向', status: 'active', detail: '比较现场与已有记录，向伙伴展示你实际获得的证据。' },
        { objectiveId: 'repair', label: '取得材料与工具，实际修复', status: 'blocked', detail: '口头答应不等于物品已经交付。' },
        { objectiveId: 'pass', label: '取得许可，与师徒继续前行', status: 'blocked' },
      ],
      ending: null, deadlineAt: '2030-01-01T12:20:00.000Z',
    },
  });
}
