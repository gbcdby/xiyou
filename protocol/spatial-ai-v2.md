# 空间模型 context 与意图合同

适用 [#34](https://github.com/gbcdby/xiyou/issues/34)、ADV-001 v0.2 与[空间协议](../docs/specs/adv-protocol.md) §3.1/3.2、§5、§8。A2→A3 的正式释放见 [#29](https://github.com/gbcdby/xiyou/issues/29#issuecomment-6836691891)。本合同只规定授权模型输入、候选输出和 Gateway；可信决定、持久调度、调用预算及权威提交由运行时负责。

## 版本与消费入口

region-v1 继续使用既有 `ProposedIntent`、`protocol/node.mjs` 与原 Gateway 输入形状。空间模型独立使用 `schemaVersion: 2`，不把旧 `move(regionId)` 翻译成持续移动。

| 入口 | 返回或职责 |
| --- | --- |
| `buildSpatialContext(snapshot, options?)` | 从已授权 `SnapshotV2` 生成 `SpatialContextV2`；有 decisionId 时生成 `SpatialDecisionContextV2` |
| `validateSpatialAI(name, value)` | 严格 JSON 对象、字段形状及频道/目标来源关系 |
| `parseSpatialAI(name, raw)` | 先检查字节、重复键、精确数字、Unicode 和深度，再校验合同 |
| `parseSpatialProposedIntent(raw, expectedDecisionId, context?)` | 绑定服务端决定；给定 context 时还核对当前工具、引用和公开前置版本 |
| `canonicalSpatialIntentPayload(intent)` | 覆盖完整意图的规范 JSON，不补默认字段 |
| `spatialIntentSemanticDigestSync(intent)` | Node SHA-256，从 `protocol/spatial-ai-node.mjs` 导入 |
| `spatialIntentSemanticDigest(intent)` | WebCrypto 版同一摘要，从 `protocol/spatial-ai.mjs` 导入 |
| `parse_spatial_proposed_intent(raw, expected_decision_id)` | Python 严格原文、输出结构和决定绑定，从 `protocol.spatial_ai` 导入 |

JavaScript 类型从 `protocol/spatial-ai.mjs` 导入，生成文件为 `game/spatial-ai-types.ts` 与对应 `.d.mts`。Python 的 TypedDict/联合类型生成于 `protocol/spatial_ai_types.py`。唯一字段源为 `spatial-ai-schema.mjs`，它只复用必要授权 DTO 和动作定义。Python 不执行世界授权，也不接受 context 参数；当前工具/引用核对由 JavaScript Gateway 与权威提交负责，单独通过 Python 或 JSON Schema 不代表有权执行。

## 安全 context

顶层字段为 `schemaVersion/contextVersion/sessionId/viewId/snapshotSeq/projection/tools`；推理时还必须含 `decision: {decisionId}`，`contextVersion` 固定为 `spatial-ai-context-v1`。不得附上 actorId、principalKind、generation、controlEpoch、readVersions 或完整 DecisionRecord。

`projection` 只来自本观察者的授权快照，保留合法场景、人物、物件、有限操作、观察来源、陈述、公开目标、本人已知的许可/决定及当前移动状态。构造器不读取世界、数据库、隐藏角色表或真实目标索引。模型副本移除本人控制 epoch、控制资格、移动高水位、移动命令序号、他人领回 epoch 和绘制轨迹；队聊陈述不进入模型。

`appearanceId` 若存在，沿用[公开造型合同](spatial-appearance-v1.md)，只描述当前外形，不授予真身、物权或许可。内部授权读取是否包含扩展由可信入口决定。

`options` 的可选字段如下：

| 选项 | 边界 |
| --- | --- |
| `decisionId` | 服务端已创建的不透明决定 ID，不携带 epoch 或代次 |
| `allowedKinds` | 在模型动作集合与本人可见能力内进一步缩小工具；proxy 由运行时传入安全集合 |
| `persona` | `{motives: string[], boundaries: string[]}`，各最多 8 条，每条 400 码点；只来自本人稳定人格 |
| `goals` | 至多 32 个 `{goalId,label,status,basedOnObservationRefs,objectiveId?}`；状态 active/completed/blocked；观察引用属于本次 observations，objectiveId 属于本次公开 objectives |

无观察来源的 goal 仅用于本人稳定目标。字段形状不能证明人格文字没有秘密，安全来源仍是运行时义务。人格和目标是模型输入，不授予模型更新世界 Goal/Belief 的权限。不能在 build 后任意追加字段；可信准备应把 context 摘要与内部决定绑定。

`tools` 每项至少有 kind/description，其余固定字段与对应动作一致，例如目标 ref/版本、物品 ref/版本、证据 ref 或许可 ID/版本。purpose/scope 是同意工具的语义说明。只有本人对应的未撤回许可产生 respond/withdraw 工具。等待始终是安全候选，不能产生重大选择；其他入口仍受阶段、当前能力及最终规则约束。

## 单动作输出

```json
{
  "schemaVersion": 2,
  "decisionId": "服务端提供的决定ID",
  "toolCalls": [{ "kind": "wait" }]
}
```

toolCalls 必须恰好一个动作。发言使用 speak/make_claim，没有独立 dialogue、beliefUpdates 或 goalUpdates。此限制将“导航 → 权威到达 → 重新观察 → 实际交互”拆成可验证步骤，不能受理路线后就在同包中视为到达拿取。

允许种类为 `move_to/stop_move/inspect/take_item/put_item/transfer_item/interact/speak/make_claim/share_evidence/respond_consent/withdraw_consent/wait`。业务参数复用有限空间动作，移动/停止不接受 movementCommandSeq；序号只能由服务端在创建可信有序决定时预留，迟到输出不得重新编号。模型不能提交真人结束确认、公共物领回 epoch、合作就位、内部推进命令或权威外观。

发言仅 public/directed；public 接收列表为空，directed 非空。工具/目标出自本次 context，收件者为当前可见人物，分享证据是合法可分享观察，同意回应只面向本人许可。物件、目标、同意及本人决定的公开版本不能任意替换。历史观察的实体引用不会因此成为当前对象，同名对象也不互相替代。

interact 按 GaolaoInteractionV2 逐操作判别参数。本人可以提出接受、拒绝、暂缓或撤回，但仍经过同一规则；资料齐全不自动变成同意，故障策略也不能制造这些决定。来源观察与意图可持久用于评价，不等于直接写入世界 Belief。

## Gateway 与错误边界

`ModelGateway.generate(context, {signal,remainingMs})` 对 V2 先严格验证并复制 context，再派发。非法 context 返回 `Blocked / INVALID_CONTEXT` 且不调用供应商；超预算返回 `Blocked / CONTEXT_BUDGET`，不静默剪掉知识。V1 继续原解析路径，Gateway 配置版本为 `intent-gateway-v2`。

供应商仍只接受 `{modelId,instructions,context,responseSchema,limits}` 和 AbortSignal，返回 rawText；没有 Runtime、数据库或世界写入口。V2 responseSchema 只含模型意图可达定义，没有 PublicEnvelope、控制请求或完整投影。输出上限 65536 UTF-8 字节、深度 32；重复解码键、不完整 Unicode、非精确安全整数、未知字段/动作或错误决定均为 `Invalid / INVALID_INTENT`，不披露解析内部细节。

共享 JSON 仍允许解码后的 NUL；Gateway 保留原文，将不满足既有 AI 持久输入边界的意图记为 `Invalid / UNPERSISTABLE_INTENT` 并附 parsedSemanticDigest，不修补或执行。原文无损持久化沿用 json-string-v1；提交/恢复由运行时选择 V2 摘要校验。

超时、取消、供应商抛错与迟到拒绝复用有界 gate；忽略 Abort 也不能留住槽位。结构有效不等于合法提交：运行时仍须检查 Pending/generation/epoch、期限、当前授权、语义依赖、原预留序号、规则与原 Receipt。模型推理不持有 Session 事务。

本切片使用 controlled 供应商测试，未新增默认付费服务、endpoint、凭证发现或真实外部调用。真实供应商、endpoint、modelId、获准凭证引用和费用上限缺失时只报告缺项，真实模型评价保持 NOT_RUN。受控检查不代表模型质量或真人体验通过。

## 生成与检查

```sh
node protocol/scripts/generate-spatial.mjs --check
npm run test:protocol
python protocol/scripts/check-schema.py
frontend/node_modules/.bin/tsc --noEmit --strict --module nodenext --target es2022 protocol/tests/consumer.mts
node --test backend/tests/ai-spatial-gateway.test.mjs backend/tests/ai-spatial-context-runtime.test.mjs
```

空间生成器和独立 Python 检查接入现有 CI 入口，旧 v1 检查保留。真实 PostgreSQL 定向检查覆盖三名角色授权快照→受控 Gateway→原规则、借貌双实体的模型请求/工具隔离及队聊不进入八戒知识；不替代 A3 持久决定、公平调度、恢复和完整章集成验收。
