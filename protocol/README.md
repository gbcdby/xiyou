# VS-001 v1 协议契约

本目录实现 [Ticket #4](https://github.com/gbcdby/xiyou/issues/4) 的结构、编码与 TypeScript 边界，依据固定 Spec 修订 `6c2a0b9f6d137ad5fbd41721659404333ad8e16d` 的 [M0 协议](../docs/specs/m0-protocol.md)。当前为可审查实现候选；任务是否完成及下游产物是否释放，以 Issue 中的独立审查与 PR 记录为准。

这里没有数据库、世界提交器、权限引擎或网络服务。通过结构校验的消息仍须经过当前认证、Session/角色/连接绑定、epoch、对象版本、可见性、终局和领域规则检查。

## 文件与消费入口

| 文件 | 用途 |
| --- | --- |
| `schema.mjs` | 字段与联合类型的唯一来源，发布时递归冻结 |
| `contracts.schema.json` | 从唯一来源生成的 JSON Schema 2020-12；不同后端语言可直接消费 |
| `../game/types.ts` | 从同一来源生成的领域与传输类型 |
| `index.mjs` / `index.d.mts` | 浏览器与服务端共用的严格解析、契约校验、排序与异步摘要 |
| `node.mjs` / `node.d.mts` | Node 同步 SHA-256 包装；不增加另一套规范化规则 |
| `fixtures/` | 固定正反消息、M0 示例与独立计算的摘要向量 |
| `tests/` | 公开入口行为检查、TypeScript 消费端编译样本 |

原始客户端或模型 JSON **必须在框架 body parser / 普通 `JSON.parse` 之前**进入严格解析器。普通 JSON 解析后无法再发现被覆盖的重复键。

```js
import {
  parseClientAction,
  actionSemanticDigestSync,
  validateContract,
} from './protocol/node.mjs';

const request = parseClientAction(rawBody);
const digest = actionSemanticDigestSync(request);

// 此上下文只能由已认证连接构造，不能从 request.body 读取。
validateContract('TrustedExecutionContext', serverBuiltContext);
// 然后交给同一个权威提交入口；本模块不执行权限或提交。
```

通用入口是 `parseContract(name, raw)`、`validateContract(name, value)`。前者同时发现原始重复键，后者供已经由可信入口解析的对象使用。错误抛出 `ContractError`，其 `code` 固定为 `INVALID_MESSAGE`；错误内容不包含请求值。

模型输出使用 `parseProposedIntent(raw, expectedDecisionId)`；`expectedDecisionId` 必须来自服务端已保存记录。此检查只阻止替换决策 ID，不能代替 Pending/generation/epoch/deadline/Observation/工具权限检查。

## 持久记录与客户端 DTO

| 契约 | 边界 |
| --- | --- |
| `ClientAction` | 只包含版本、Session、角色请求值、动作 ID、旧 epoch、旧 baseSeq 和动作。不得夹带 principal、连接、服务器时间、可见性或事件序号 |
| `TrustedExecutionContext` | 服务端构造的主体与认证绑定；形状正确不构成身份认证 |
| `ActionReceipt` | 持久收据，包含完整去重键和语义摘要 |
| `ClientReceipt` | 已授权的收据 DTO，不携带内部 principalId；读取前仍检查当前结果权限 |
| `WorldEvent` | 持久事件，包含服务端因果、时间和三类受众；不得直接送往客户端 |
| `DecisionRecord` | 服务端保存的 generation、epoch、读取版本、Observation 引用、允许工具和期限 |
| `ProposedIntent` | 模型候选：有序动作数组、可选对白、候选信念；没有可信版本与工具权限字段 |
| `AuthorizedSnapshot` / `WorldBatch` | 角色授权投影和完整区间；不包含持久事件内部受众、凭据或全量决策 |
| `OutboxRecord` | 指向已提交区间的发布记录，不含另一份可任意修改的世界状态 |

`WorldEvent` 的 payload 按 kind 区分生命周期、控制、位置、物品、目标变化、`ClaimRecorded`、`ObservationRecorded`、`BeliefUpdated` 和 `GoalUpdated`。陈述、信念与物品/目标效果不能混用同一个 payload；信念记录必须携带 Observation 来源。服务端还必须验证这些来源确实存在且该角色有权读取。

`AuthorizedProjection` 明确包含当前场所、本人能力与控制状态、公开队伍、可见物品/目标、本人已登记观察、可读陈述、目标和结局。可扩展的事实字段仅允许标识、标签和标量，不能嵌入任意完整世界 JSON。字段形状并不证明其中内容有权公开，投影仍由服务端生成。

合法累计 Observation 和 Claim 不设千条等任意历史截断。客户端投影消息也不在本层施加会截断知识的固定总字节上限；网络层可分帧或选择等价传输方案，但不能静默丢弃合法历史。外部动作、模型输出等原始输入默认限制为 64 KiB、32 层嵌套。

## 确定性同步

客户端批次事件使用 `projection.replace`，其 payload 为 `{ projection: AuthorizedProjection }`。这是 M0 §9.2 允许的安全投影效果：服务端针对某个已提交前缀生成该角色的完整授权投影，客户端将其确定性替换，因此离开区域后的可见字段移除也能正确表达。

批次保留 `(fromExclusive, throughSeq]` 的完整覆盖，最多 256 个全局序号；其中事件序号严格递增并位于区间内。隐藏事件可形成空 `events`，同样推进游标。完整 wire 消息携带 `schemaVersion: 1`，遵从 M0 §2；§9.2 的简示省略了该公共字段。

本模块只检查区间和事件结构。客户端还必须先核对 Session、服务器绑定的 viewId 和本地 cursor，整批校验并原子应用后才保存新游标；重叠、未来、过期身份及 RESYNC 的处置由同步实现负责。批次额外支持受控的陈述/观察显示事件；如果使用它们，客户端 reducer 必须按同一前缀保持投影一致，不得重复插入已有观察。

## 动作细化与重试摘要

M0 §7/§11 及玩法中的内容操作细化为以下 wire 字段，不增加世界写入权限：

- `move`、`inspect`、`take_item`、`transfer_item` 沿用各自区域、目标及物品版本。
- `use_item` 带 `itemIds`、一一对应的 `expectedItemRevisions`、`targetId`、`expectedTargetRevision` 和内容定义的 `operation`。修复等操作的能力、实际材料与消耗由内容规则核对。
- `interact` 带 `targetId`、`operation`、`expectedTargetRevision`，承载办理许可等已有场景行为。其存在不授予 NPC/代理办理最终许可的权限。
- `share_evidence` 明确证据及接收者；`speak`/`make_claim` 明确 public/directed/private 频道和接收者。public 不列接收者，其他频道必须列接收者；真正接收资格仍由服务器决定。
- `wait` 是不产生自主世界写入的候选行为。代理只允许的安全工具集仍由可信 DecisionRecord 和规则器限制，不能凭 Action 联合类型获得其余工具权限。

序号、epoch、对象 revision 使用无前导零的非负十进制字符串。事件序号从 `1` 开始，游标可为 `0`；`compareDecimal` 按数值比较，支持超过 JavaScript 安全整数范围的序号。

`canonicalActionPayload` 精确覆盖版本、Session、角色、epoch、baseSeq 及动作全部字段，按 UTF-16 键名次序编码，保留数组顺序，不对 Unicode 做归一化。其 UTF-8 字节以 SHA-256 生成小写十六进制摘要。动作 ID 属于去重定位键，不参与语义摘要；同一 ID 与不同摘要仍须在持久层产生 ACTION_ID_REUSE。

`canonicalIntentPayload` 覆盖整个有序 ProposedIntent。缺失可选字段不自动注入默认值；省略、显式空数组与显式空值保持不同表达（不允许的空值会先拒绝）。重试必须保留原包，不根据当前 epoch、cursor 或连接改写旧请求。令牌、连接和重试次数不进入动作语义摘要。

JSON 入口检查解码后的重复键、完整 Unicode 代理对及十进制数字的精确整数值。不能先把 `1e-400` 或 `1.00000000000000001` 舍入后再接受；协议中的数字必须能精确表示为安全整数，序号仍必须为字符串。对象入口中的数组必须具有连续的自有数据索引，不能用额外属性抵消空洞。

身份、序号、摘要与时间的字符串模式使用跨 JavaScript/Python 一致的绝对结尾断言，避免 Python `$` 在最后一个换行符之前匹配的差异；固定反样本同时经过两个消费入口。

## JSON Schema 之外的关系检查

独立 JSON Schema 消费者还需实现以下关系检查，才能与 `validateContract` 等价：

| 关系 | 检查 |
| --- | --- |
| 使用物品 | 物品 ID 集合与前置版本字典键集合完全相同 |
| 频道 | public 的接收者为空，其余频道非空；所有 ClaimRecorded 包装一致执行，AI 意图不可使用真人 private 频道 |
| 收据 | 事件范围 first ≤ last ≤ observedSeq；Rejected 范围必须为空 |
| 决策 | deadlineAt 不早于 createdAt；输出 decisionId 与可信记录匹配 |
| 控制记录 | HumanControlled 才携带活动连接，GracePeriod 才携带宽限期限 |
| 事件/批次 | eventId 等于 Session 与序号的 `S:Eseq` 编码；有序区间不超过 256；持久事件与批次中的 ObservationRecorded 来源不能晚于所在事件 |
| 投影 | 标识唯一、包含本人、本人 Observation 归属和来源游标有效、定向陈述不越过接收结构、终态与结局一致 |
| Outbox | 引用非空且有序的已提交区间 |
| 可信上下文 | human 需要账号/角色/连接；服务主体不能带真人连接绑定 |

这些检查仍不能判断世界中的权限、控制权有效性、事实真假、跨局对象存在性或事务原子性。

## 验收映射与检查

| M0 条款 / 验收 | 本票证据范围 |
| --- | --- |
| §2/4/11，M0-AC-01 | 版本、身份字段、事件编码、可信上下文与外部输入分开 |
| §5，M0-AC-03 | 固定摘要向量、键序稳定、完整语义字段覆盖；不证明持久去重 |
| §7，M0-AC-05 | 字符串序号与显式对象前置版本；不判断世界当前版本 |
| §9，M0-AC-09 | DTO 与内部受众分离、授权投影结构、完整区间形状；不证明资格过滤 |
| §10，M0-AC-11 | 事实/陈述/信念分型，模型候选与可信决策记录分开 |
| INT-AC-01 / VER-01 | 提供可消费契约与样本；TLC、数据库、真实网络与 AI 运行仍由对应任务提供 |

从仓库根目录运行：

```bash
node --test protocol/tests/*.test.mjs
node protocol/scripts/generate.mjs --check
python3 protocol/scripts/check-schema.py
tsc --noEmit --strict --module nodenext --target es2022 protocol/tests/consumer.mts
```

Node 测试与生成器不需要额外运行库。独立交叉检查需要 Python 的 `jsonschema`；编译检查需要 TypeScript。Python 入口通过 `scripts/utc_time.py` 显式注册本协议的 UTC 毫秒日历检查，不依赖可选格式插件；没有启用检查器时直接失败。检查包含闰年、有效日期、小时/分/秒、精确三位毫秒和四位年份；不接受闰秒、偏移时区或额外后缀。跨语言后端应复用固定样本、原始重复键规则、关系检查与摘要向量，不能只通过 JSON Schema 后就省略其余边界。

2026-11-11 的日期检查补充候选使用 Node 24.22.1 和 TypeScript 7.0.2；21 项行为测试、15 类正样本、17 类反样本、23 个共用 UTC 日历边界、独立 JSON Schema 与摘要、生成一致性和 TypeScript 消费编译通过。原始检查与输入摘要保存于 [自查证据](evidence/self-check.json)，独立审查发现的来源和修正映射见 [审查修正记录](evidence/review-fixes.md)。日期检查补充为作者自查，STD-003 最终状态等待复审；此前已验证修正仍绑定原候选，TLC、持久数据库和运行验收不属于本票结论。
