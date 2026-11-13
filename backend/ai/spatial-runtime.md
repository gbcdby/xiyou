# 空间自主角色运行链

适用 [#34](https://github.com/gbcdby/xiyou/issues/34)、ADV-001 v0.2 §7、§9.3–9.8，以及[已释放空间协议](../../docs/specs/adv-protocol.md) AP-01/03/04/05/06/07。模型字段合同见 [spatial-ai-v2.md](../../protocol/spatial-ai-v2.md)。

## 权威准备、持久调用和单次提交

`prepareDecisionContext` 按会话版本分派。region-v1 保留原决定和工具；spatial-v2 从本人的授权快照构造 context。内部 `Decision` 保存控制 epoch、generation、创建时统一预留的移动序号、地图/计划版本、来源观察、可见目标语义版本及相关许可；模型只得到 `decisionId`、合法投影和工具。人格取自主 Spec 的本人稳定目标，不填入未感知的世界秘密；这些稳定目标使用空观察来源，授权来源观察在投影中单独保留，不将无关观察伪记成目标依据。

准备事务结束后，`reserveCall` 核对可信 context 摘要并计入本局持久预算，再调用 Gateway。推理不持有 Session 行锁。空间 context 可能含玩家原文，`007-spatial-ai-context.sql` 使用已有可逆文本编码保存 NUL；模型原始输出继续按 `json-string-v1` 无损保存。有效输出摘要、原文和供应商元数据先持久，再执行意图。相同决定不能覆盖另一份输出。

模型只给一个动作。移动使用决定创建时的预留序号，晚返回和重试不能重新领号；普通内部导航使用同一分配器。移动受理后，权威步进产生真实到达，再唤醒下一次决定、重新检查并执行取物或交互。较新的停止、替换、控制变更及终态保留原围栏。无关旁观者移动不改变语义依赖；本次动作真正使用的目标 revision、外观、相关许可和计划才参与失效判断，最终规则仍重验距离、遮挡、物权和同意。

V2 公开 Receipt 没有摘要。`decisionReceipt` 是可信内部恢复入口：它同时核对原模型意图摘要、持久完整请求摘要和安全 Receipt，返回二者关联；HTTP、Socket 与模型投影不增加内部字段。Unknown 只用原决定、原动作 ID、原文和原序号查询或重试。查询未知不会改成失败，不触发另一份模型输出或另一个动作 ID。进程恢复先提升空间控制 epoch，使未提交的旧计划失效；已提交 Receipt 继续原样恢复。

提交已经 Unknown 后，收据查询中的技术异常（例如 PostgreSQL `57014` 查询超时）保留原 Unknown；恢复待办的后续技术异常也沿用原决定，不改写为已拒绝。合同、权限、会话、版本或摘要错误仍原样透传，`ACTION_ID_REUSE` 不进入技术重试。调度器在初次失败后最多自动重试三次，每次至少间隔 `minIntervalMs`；耗尽后停留 Unknown，仍可显式恢复。成功恢复只收束原决定，即使调用预算有余额也不顺带推理。显式恢复接替尚未执行的旧重试唤醒，避免它在结果已确认后触发额外调用；真正的新语义唤醒仍按既有调度规则处理。

### 恢复期间的语义唤醒

`spatial.clock(paused=false)` 既可能是恢复，也可能是普通运行步进，不能靠新运行器的一次读取猜测。`AuthorityRuntime` 的进程内 `commit` 通知在空间局附带 `spatialPauseBefore`，来源为该已提交事务起点的 `tx.row.state.paused`。调度器按同一通知的原事件顺序折叠，只把真实 true→false 当作恢复。此值只供内部订阅者使用，不写入 WorldEvent、HTTP/Socket DTO、数据库表或模型上下文；region 通知不增加该字段。

调度器把启动/显式唤醒/技术重试的 `dirty` 与已收到的合法语义水位 `pendingSemanticSeq` 分开。语义来源仍限既有的本人观察、可见陈述、相关目标/自己的到达及控制变化等筛选；不扩大任何感知或操作权限。水位复用既有 `sessionSeq`，不新增事件身份或持久队列。已接收语义水位与新 context 的 `baseSeq` 共同去重，普通时钟、无关移动和重复通知不能追加调用。

| 阶段 | 合法新语义事件 | 恢复及消费规则 |
| --- | --- | --- |
| 恢复读之前，包括已 checkout 尚未 BEGIN | 去重后保留水位 | 读取的 paused 真/假不影响已收到事件 |
| 读取后至返回，包括 COMMIT 后延迟 | 同样保留水位 | 返回待办不消费语义水位 |
| 原 Receipt / outcome 尚未收束 | 排在本人原请求之后 | Unknown 仍使用原请求及有限重试，不开始新规划 |
| 原结果收束，Idle | 有保留水位则进入独立正常规划周期 | 只有新 context 已授权并成功预留预算，才消费其 baseSeq 已覆盖的水位 |
| 新推理在途 | context 之后的新水位保留为下一轮 | 当前原文提交不换身份；共享并发、间隔和预算继续适用 |
| Unknown 重试耗尽、确定拒绝或预算耗尽 | 水位保留，但不能单独造成无限恢复循环 | 新合法触发或显式恢复仍先过原结果和授权；终态清理待执行唤醒 |

因此纯技术恢复不产生新的语义触发，成功收束也不清掉已经收到的真实 resume/Observation。显式恢复接替旧 retry 时只清技术触发；真正的新语义继续保留。同一通知只消费一次，多个已被同一个新 context 包含的事件合并为一次规划。读取、收据收束和事件接收采用同一规则，不再按异步窗口分别猜测暂停状态。

## 注册、轮转与故障

`attachSpatialAI` 从当前内容的 `actorKind` 注册 `persistent_core` 和 `chapter_autonomous`，共享一个 `AIOrchestrator`、并发上限和每局持久调用预算。高老庄为唐僧、悟空、八戒三人；真人席位不变。`scene_role` 不进入模型队列，现有章节交互规则保持；生产自动场景策略留在后续独立切片，当前入口不自动为场景角色答复同意或移动。

轮转从上次实际领槽的角色之后继续，支持并发 1 或 2，也不会因某角色持续唤醒挤掉刚注册的第三人。公平性以仍合资格、有限处理/超时、运行器继续运行、预算足够为前提。自己的到达、合法新观察、他人的现场陈述、相关目标变化和暂停后恢复可唤醒；普通移动检查点和场景时钟不会每帧调用模型。

降级动作在准备时固定：默认等待；只有悟空已经合法获得救援来源、当前授权投影可见铜封时，才可固定安全导航或尝试原救援动作。提交时依然经过原授权、依赖和救援规则。后来的新信息不能把旧 fallback 改成新许可。超时、非法 JSON、供应商异常不能生成借貌、私物处理同意、招徒、加入或原谅决定。场景策略后续切片须与该降级入口分开，本切片不新增场景角色的默认同意。

## 明确供应商配置后启动

默认 `backend/main.mjs` 不选择供应商。需要模型时，调用方可注入明确的 Gateway 到 `createAIServer`，或为 `backend/ai-main.mjs` 设置 `XIYOU_AI_CONFIG`，同时提供既有 `DATABASE_URL`。配置文件必须完整声明：

| 字段 | 要求 |
| --- | --- |
| `providerModule` | 相对该配置文件的本地适配模块，导出 `createProvider` |
| `providerId / providerKind / modelId` | 明确供应商、`controlled` 或 `external`、模型身份；不自动选择 |
| `maxConcurrent / minIntervalMs / maxCallsPerSession` | 有界并发、调用间隔和整局持久调用预算 |
| `timeoutMs / maxContextBytes` | 明确超时和 context 大小上限 |
| 外部 `endpoint` | HTTPS 地址，不含用户名、密码或查询密钥 |
| 外部 `credentialEnv` | 本次获准使用的一个环境变量引用；只读取该具名变量 |
| 外部 `authorizationReference` | 本次实际授权依据，不由工具生成或推定 |
| 外部 `maxCostPerSessionUsd / maxCostPerCallUsd` | 已批准总额和适配器可强制执行的单次上限 |

外部适配器接收明确 endpoint、具名凭据值及单次费用上限，只向 Gateway 返回 `{kind, providerId, maxCostPerCallUsd, generate}`。`generate` 仍只接收过滤后的模型输入和 AbortSignal，不能获得 Runtime 或数据库。适配器必须承诺其实际可执行的调用上限；未提供或超过已批准上限时拒绝启用。会话调用预算取配置次数和 `floor(总额 / 单次上限)` 的较小值，并由 `ai_runs` 跨重启计数。该折算依赖适配器真实执行单次限额，实际供应商集成仍须独立核对计费和最大输出配置。

配置验证在导入适配器之前检查缺项和凭据；不读取密码箱，不扫描其他项目，不输出密钥。持久元数据只有安全的配置、授权引用和费用上限。缺少真实供应商、endpoint、modelId、获准凭据引用或费用上限时，真实评价为 `NOT_RUN`；受控测试不会填补这些输入。

## 样本导出和验收范围

`node backend/scripts/evaluate-spatial-ai.mjs <sessionId>` 通过已指定的数据库读取本局持久样本，输出 JSON；脚本本身不调用模型。每个样本保留供应商来源、配置、generation、合法来源观察、已听陈述、人格/目标、原意图、等待时间、决定结果、Receipt 和 fallback。

有外部样本仅标记 `SAMPLES_COLLECTED`；无外部样本保持 `NOT_RUN`，即使受控样本全部通过也一样。不同信息顺序、合理拒绝后补证、NPC 沟通改变后续行动、完整分支、三角色公平、身份权限和真人趣味均保留独立检查项，不由脚本把未评价项写成 PASS。

针对性工程入口：

```sh
node --test backend/tests/ai-spatial-decisions.test.mjs
node --test backend/tests/ai-spatial-orchestrator.test.mjs
node --test backend/tests/ai-spatial-unknown.test.mjs
node --test backend/tests/ai-spatial-config.test.mjs
npm run test:ai
```

这些检查覆盖真实 PostgreSQL 的持久决定、原文、旧序号、Unknown、竞争物权及受控故障。正式真实模型质量、真人 2/5 人及复玩、正式运行视觉、手机真机和全章阶段释放由集成票分别判定。
