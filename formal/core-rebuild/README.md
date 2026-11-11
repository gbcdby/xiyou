# M0 核心协议：新的有限模型候选

本目录是 `vs001-p02` / [Issue #5](https://github.com/gbcdby/xiyou/issues/5) 在 2026-11-11 新建的候选，负责 Ownership、RoleHandoff 及其组合的设计模型检查。它不是旧模型的恢复副本，也不声称真实数据库、业务源码或部署已经正确。运行结论与证据索引见 [report.md](report.md)；实现对应状态保持 `NOT_ASSESSED`，独立需求/标准审查由外层交付流程记录。

## 1. 来源与候选身份

模型以固定 Spec 修订 `6c2a0b9f6d137ad5fbd41721659404333ad8e16d` 为协议来源：

- [M0 协议](https://github.com/gbcdby/xiyou/blob/6c2a0b9f6d137ad5fbd41721659404333ad8e16d/docs/specs/m0-protocol.md)，Git blob `ab1378574320f13bb609c97baa8640cf7de2481f`。
- [验证计划](https://github.com/gbcdby/xiyou/blob/6c2a0b9f6d137ad5fbd41721659404333ad8e16d/docs/specs/vertical-slice-verification.md)，Git blob `2e4279c145f0f192787ffa8fae16c7757fa3bf30`。
- 当前工作区这两份文档的 `git hash-object` 与上述固定远端 blob 一致。用户授权用合成参与者和可控模型响应完成验收，不改变这里的权威、权限或提交规则。

历史候选 `31766d6c0166cc61c49578dc353514292dfacc5e` / tree `56ffaa72590c3395525d42b0a9b741e79709839d` 的 67 项、组合 27,113,004 distinct 及两轴 PASS 只作为原轮次历史保留。本轮未取得该原件，不把它重新标为实测，不重建其日志，也不重试原先被拒绝的原始日志上传。本目录所有输入、模型状态和运行记录均由本轮新建的有限模型产生。

可执行入口为 [model/Core.tla](model/Core.tla)、[verification.json](verification.json)；配置由 [build_manifest.py](build_manifest.py) 生成，预声明判据单列在 [expectations.json](expectations.json)。所有正式 `.cfg` 使用同一模型摘要；`Fault` 仅在隔离负对照启用，交付正配置全部为 `none`。

## 2. 状态与原子步骤

`d` 是持久权威状态：物品位置和版本、每个请求的成功记录、Receipt 与首次载荷绑定、事件及 outbox、序号与终局边界、控制模式/epoch/连接、决策快照及收束结果。`v` 是请求管线、运行可用性、客户端已收到的结果、发布观察和见证辅助状态。崩溃清除尚未完成的处理管线和易失响应，保留 `d`、客户端已知结果及测试环境记录。客户端和探针不与服务进程共用持久性假设。

| 模型动作 | 协议含义与可交错位置 |
| --- | --- |
| `Receive` → `Validate` → `Commit` | 接收、进入预检、取得权威状态后提交是不同步骤；客户端携带的版本和授权不会因预检而成为最终授权 |
| `CommitEffect` / `WriteReceipt` / `AppendEvents` | 正配置将世界效果、成功记录、连续事件、Receipt 与 outbox 一步提交；这是实现义务，不是对源码原子性的已核实事实 |
| `Reply` / `DropAck` / `Crash` / `Recover` | COMMIT 与 ACK 分开；允许已提交但丢 ACK，允许提交前后崩溃；恢复仍使用同一请求键和原载荷 |
| `Publish` | 读取已经提交的 outbox；可以在终局后补发，不能制造新的世界事件 |
| `Disconnect` → `Proxy` → `ReturnHuman` | 断线立即撤销旧连接并增长 epoch；宽限到期才托管；交还绑定新物理连接并再次增长 epoch |
| `Take` / `ResumeHeld` / `RetryControl` / `StaleDisconnect` | 显式接管、已有控制时只读接入、nonce 去重及旧断开通知分别建模 |
| `PrepareAI` → `CallbackAI` | 推理不持有事务；提交时逐项重读 mode、epoch、generation、相关版本、决策状态、决策期限和 Session 终局 |
| `CancelAI` / `ExpireAI` / `InvalidAI` | 无需供应商成功返回也可收束决定；已经收束的决定不能复活 |
| `DeadlineClose` / 普通结束命令 / `Abort` | 到期优先、正常终局双事件包、异常终止分别建模；终局后允许读取旧 Receipt 和补发，但不允许新世界效果 |

请求键代表已经通过认证与结果读取权限检查的 `(session, principal, actionId)` 等价类。这里不证明身份认证、结果可见性、schema 解析或摘要碰撞性质。载荷 `0/1` 代表两个不同的语义摘要；连接 ID 不进入载荷，而旧 epoch、baseSeq 和动作内容在原样重试时保持不变。

## 3. 有限范围与分解矩阵

共同分配两个请求键和两个真人身份。Ownership 配置有两个物品；组合/交接配置只有一个与决策相关的物品。`competition` 中两个客户端的物品选择包含同物品竞争和不同物品并行，固定读取版本为 0，成功后版本增长。一次模型运行只覆盖这一代已读前置条件，不推导任意长的物品转移/消耗历史。代理效果是协议允许的安全行为，不转移/消耗物品或完成重大不可逆选择。

| 正配置 / Scenario | 活跃请求与刺激 | 保留的竞争、故障或边界 | 单配置排除的独立刺激 |
| --- | --- | --- | --- |
| `ownership-competition` / `competition` | 两请求、两物品，分别选择目标 | 相同版本抢物、不同物品成功、终局竞争 | 控制交接、AI、进程崩溃、变载荷、发布调度 |
| `ownership-idempotence` / `receipt` | 一个请求、同键重放 | 一次崩溃、一次丢 ACK、原键恢复、一次显式重试 | 控制/AI、变载荷、发布调度 |
| `ownership-payload` / `payload` | 一个请求、两个载荷摘要 | 成功/拒绝后复用键改载荷，旧绑定不变 | 崩溃、控制/AI、发布调度 |
| `ownership-publication` / `publication` | 两请求及多个提交事件 | 事件已提交后独立发布，终局后发布 | 崩溃、控制/AI、变载荷 |
| `ownership-ending` / `ending` | 一普通请求、一结束请求 | 两个命令竞争；效果与 finished 同包；异常终止 | 崩溃、控制/AI |
| `ownership-future` / `future` | 两请求和一次无关事件 | future base 拒绝；旧 base 不单独阻止合法请求 | 崩溃、控制/AI |
| `handoff` / `control` | 一旧授权请求、旧/新连接 | Grace、Proxy、交还、显式接管、held、nonce 重放、旧断开 | AI 推理、进程崩溃、变载荷 |
| `handoff-ai-epoch` / `ai-epoch` | 一请求、一个决定 | 交还/epoch 失效与迟到回调 | 其他独立 AI 失效刺激、崩溃 |
| `handoff-ai-generation` / `ai-generation` | 同上 | 下一代计划使旧回调失效 | 同上 |
| `handoff-ai-revision` / `ai-revision` | 同上 | 相关对象版本变化使回调失效 | 同上 |
| `handoff-ai-unrelated` / `ai-unrelated` | 同上 | 无关事件推进 head 后仍可合法提交 | 同上 |
| `handoff-ai-cancel` / `ai-cancel` | 同上 | 取消及收束后迟到回调 | 同上 |
| `handoff-ai-invalid` / `ai-invalid` | 同上 | 无效输出拒绝 | 同上 |
| `handoff-ai-package` / `ai-package` | 同上，意图包可合法或含后续非法工具 | 整包校验后提交或完全拒绝 | 同上 |
| `handoff-ai-expiry` / `ai-expiry` | 同上 | 决策期限、无返回超时、有效提交 | 同上 |
| `handoff-ai-terminal` / `ai-terminal` | 同上 | 系统终止/到期与 Pending 回调交错 | 同上 |
| `composed` / `combined` | 两个竞争请求、一个决定、完整交还链 | 竞争、提交、丢 ACK、崩溃/恢复、换控、原 ID 重发、迟到 AI、终局 | 变载荷、发布调度、独立 generation/revision/取消刺激 |

每行单独使用其 `.cfg`；没有把组件 PASS 当作组合 PASS。组合配置同时启用核心的全部 13 个不变量，并有严格有序的跨组件见证。其他 AI 围栏通过逐项独立刺激和独立负对照检验，不宣称所有刺激的笛卡尔积均穷尽。

### 3.1 时间、历史及次数边界

一个逻辑 tick 表示 10 秒：宽限为 3、决策期限为 1、Session 截止为 120。模型只推进到当前已登记的 grace / decision / session 期限，以及截止前 3 / 1 tick 的末段切点。`Tick` 选严格大于当前时间的最小切点；不逐个枚举守卫真值不变的空闲秒数。该模型检查这些有限到达时点和相应动作次序，不声称证明任意实时时刻到达的 timed refinement。它仍包含宽限先于 Session 截止、宽限与截止重合、决策与截止重合和回调迟到等边界。

只含一轮控制交接、一个 AI 决定、一次 generation 变化、一次相关版本变化、一个无关事件；相应刺激是否启用由上表决定。崩溃和 ACK 丢失各最多一次；未确认请求在丢 ACK 或崩溃后继续用原键恢复。`receipt` / `payload` 另有一次已确认请求的显式重试；`combined` 只保留故障造成的未确认重发，以避免与核心故障链无关的已确认重放历史反复交叉。这些次数是有限检查边界，不是产品保证。状态类型上界不会用作搜索约束：超界会违反 `TypeOK`。模型没有 `CONSTRAINT`、`ACTION_CONSTRAINT`、`VIEW`、对称归约、真实时间、随机选择或 Java 覆写。

`CallbackAI` 还受 `~v.callbackSeen` 限制，且该位不复位，因此**每局最多一次 provider 回调**。已有运行 manifest 中“一个 AI 决定”的范围也同时受此回调次数上限约束；这里不覆盖同一决定的第二次或重复供应商回调。`DecisionSettlesOnce` 检查决定收束后不复活，不能据此宣称重复回调去重已经验证。重复回调与稳定 fallback 必须分别引用适用的 #7 边界模型及 #9／#12 的真实实现检查。此补充仅明确实际模型边界，不修改 Core、配置、性质或已有运行 manifest／原始结果。

`RevokeEpoch` 是保守的独立失效刺激：它允许旧 Pending 行尚未清理时，权威 epoch 已变化。这样可以单独删除 epoch 围栏而不被 mode/status 围栏提前挡住。它不是新增产品控制接口，不证明该数据库中间形态可达。实际交还路径另外通过 `ReturnHuman` 覆盖。`NewGeneration` 同理保留一个旧快照与新代次并存的提交前输入。

### 3.2 分解理由及失败保留

首个宽草稿把所有请求反复收发、所有观察历史、载荷变化、发布、控制和 AI 刺激同时做笛卡尔积。它在 180 秒预算内没有完整结束；该 `INCONCLUSIVE` 结果保留。随后将无关的外部刺激明确拆为上表有限配置，把客户端已收到结果的管线归一化为 `Done`，只保留声明次数的额外重试。时钟恢复准确的 1200 秒截止后，带已确认重放的组合安全/活性仍在 180 秒超时；最终组合保留故障恢复重发，已确认显式重放在 `receipt/payload` 独立范围检查。它们是新配置与新结果，不借用宽草稿的探索进度。

新候选保留共同权威状态及原子提交入口；接收、预检、提交、ACK、控制、计时和回调仍可交错。没有以不变量为条件丢弃状态，也没有下调既定 `distinct_state_min` 适配检查结果。状态数下限与预算在 [expectations.json](expectations.json) 和运行快照里可核对。

## 4. 性质、目标负对照与非真空证据

| 义务 | 正式操作符 | 目标负对照配置 | 主要非真空路径 |
| --- | --- | --- | --- |
| INV-00 | `TypeOK` | `negative-type`：将 epoch 写到域外 | 非空初态及各 profile 的完成状态数 |
| INV-01 | `SingleEffectiveOwner` | `negative-stale_item`、`negative-duplicate_owner` | 两客户端读取版本 0 后相争；成功记录与持有集合同时检查 |
| INV-02 | `AtMostOneEffect` | `negative-split_receipt` | `witness-effect-crash-retry-negative` 强制效果→崩溃→原键再次效果 |
| INV-03 | `ReceiptPayloadBinding` | `negative-payload_overwrite` | `witness-payload-conflict`；原 Receipt 不被覆盖 |
| INV-04 | `AtomicCommitBundle` | `negative-split_bundle`、`negative-split_terminal`、`negative-partial_ai` | `witness-partial-bundle-crash`、正常终局双事件包、非法后续工具整包拒绝 |
| INV-05 | `AckRequiresCommit` | `negative-early_ack` | `witness-early-ack-crash`：预检提前成功 ACK 后崩溃 |
| INV-06 | `NoDualControl` | `negative-old_human`、`negative-old_proxy`、`negative-stale_disconnect` | 交还、人类旧请求、旧代理回调及旧断开通知 |
| INV-07 | `FreshDecisionOnly` | `negative-decision_epoch/generation/revision/deadline/status`、`negative-ai_terminal` | 每种围栏失效分别触发；无关事件不误拒合法回调 |
| INV-08 | `TerminalBlocksNewEffects` | `negative-post_terminal`、`negative-deadline_control` | 普通结束、到期拒绝、异常终止与终局后 AI |
| INV-12 | `ContinuousCommittedSequence` | `negative-sequence_gap`、`negative-sequence_repeat` | 多个提交及普通终局的连续双事件 |
| 辅助前置条件 | `PreconditionDiscipline` | `negative-future_base`、`negative-stale-item-precondition` | future base 拒绝、同版本竞争、无关状态变化 |
| 控制 nonce | `ControlNonceIdempotent` | `negative-control_nonce` | 成功接管后重复 nonce 不换绑 |
| 决策收束单调性 | `DecisionSettlesOnce` | `negative-decision-finality` | 取消/超时/拒绝后旧决定不复活 |
| LIVE-01 | `AdmittedRequestResolves` | `negative-no_retry`（实际 temporal violation） | 三个 `live-*` 配置中的有限工作集最终收到确定结果 |
| LIVE-03 | `DecisionResolvesOrExpires` | `negative-no_timeout`（实际 temporal violation） | `live-handoff`、`live-composed`，允许供应商永不返回 |
| 死锁敏感性 | TLC deadlock check | `negative-deadlock`（原始 rc 11） | 非终态收到请求后故意禁用所有动作 |

所有安全性负对照只启用目标性质，逐项要求原始 TLC rc 12、消息明确命中该名称。`WitnessAbsent` 仅用于否定目标到达状态的探针，其预期反例也是 rc 12；它不属于交付安全性不变量。普通负对照和可达见证不会被重新标成正模型 PASS。

组合见证 `witness-effect-crash-handoff-retry` 的辅助进度只随以下事件顺序增长：键 1 效果→键 2 物品冲突→丢 ACK→崩溃→恢复后的 Proxy→AI Pending→交还 Human→键 1 原载荷取旧 Receipt→旧 AI 拒绝。它不限制模型可走的动作，只检查这条完整路径确实可达。`witness-terminal-late-ai` 另保存终局之后的回调拒绝轨迹。

### 4.1 活性条件

`LiveSpec` 使用弱公平性，明确要求 `Stabilize`、`Recover`、`Tick`、`DeadlineClose`、各已接纳请求的 `Receive/Validate/Commit/Reply/FlushReceipt` 及 `ExpireAI` 最终获得调度。没有对供应商回调添加公平性，也没有强公平性。有限崩溃/丢包后客户端保持重试资格；期限处理不依赖模型返回。

安全性与活性分别配置。正向活性运行只启用 `TypeOK` 和声明的 temporal properties；它的成功不替代同范围安全性运行。关闭重试处理和关闭到期收束分别产生实际活性反例，保留循环/停滞轨迹。

## 5. 给实现与验收的义务

下表是设计交接，不是已经完成 `align`；实现者须为当前源码版本提供独立证据。

| 实施义务 | 必须保留的语义 | 接收方应提供的证据 |
| --- | --- | --- |
| IM-01 Session 提交 | 所有写入路径在统一权威边界重读并串行裁定；成功提交包不可拆分 | 数据库事务范围、锁/条件更新、唯一约束及部分写入失败后的恢复 |
| IM-02 请求身份 | 原键原载荷重试先查 Receipt；跨 epoch/终局也不重做，异摘要不覆盖 | 丢 ACK、提交后进程退出、旧 epoch 重放及异 payload 的结果和世界效果 |
| IM-03 ACK 与发布 | 成功 ACK 必须晚于 COMMIT；outbox 只引用已提交事件 | 提交前后故障注入、重启查收据、终局后补发；不将网络超时断言为失败 |
| IM-04 所有权 | 版本、当前归属与目标合法性在提交时复核；投影与成功记录一致 | 两并发客户端读相同版本，最多一个互斥成功；不同物品不会相互误拒 |
| IM-05 控制授权 | 主体、mode、epoch、当前连接同时校验；旧断开通知不能撤销新连接 | 完整往返、显式接管/只读恢复、旧连接与旧代理回调、nonce 重放 |
| IM-06 决策快照 | status/generation/epoch/deadline/相关对象版本均在提交前校验 | 各围栏分别制造失效；无关事件不误拒；取消/超时后回调不复活 |
| IM-07 意图包 | 先校验整包，再一次提交；任何后续工具失败均不能留下先前效果 | 两工具批中第二项非法，检查第一项、对白、Receipt、outbox 的实际结果 |
| IM-08 终局 | 到期检查覆盖所有写入口；正常终局效果和 finished 事件同事务同 Receipt 区间 | 截止时普通/控制/AI 入口、结束与普通动作竞争、终局后原收据查询 |
| IM-09 连续序号 | 回滚不耗已提交序号；重复提交不复用旧 head | 故障回滚后继续提交、并发提交、重放与持久 head 对比 |
| IM-10 活性 | 最终恢复、稳定连接、重试/期限处理的真实调度条件 | 可控故障解除后最终收束，供应商不返回时期限处理仍执行 |

真实实现回归规格可直接采用第 4 节的事件顺序，但需由实现方确定屏障、时钟与可观察数据库记录；TLC 状态不是可跨语言直接重放的业务测试。当前实现测试状态为 `NOT_RUN`，与外层已完成或新完成的运行验收分开记录。

## 6. 复现与证据判读

工具固定为官方 `tla2tools.jar` v1.7.4 / TLC 2.19，SHA-256：

```text
936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88
```

当前环境使用 OpenJDK 21。运行调用仓库已有受控 runner，不修改其约束。jar 不进入 Git；使用绝对路径提供。以下命令必须给出新的输出目录：

```bash
python formal/core-rebuild/check.py \
  --jar /absolute/path/to/tla2tools.jar \
  --out .agent-output/core-rebuild/reproduction-01 \
  --jobs 2
```

`--profile` 可重复选择少量配置；默认执行全部。每个 TLC 进程 BFS、一个 worker、最大 1,024 MB heap；`live-composed` 预算 360 秒，其余为 180 秒，批量最多两个并发进程。组合活性在相同模型/配置的 180 秒尝试中超时后，仅增加该配置预算；其他 83 项不因无关预算字段变化重复执行。正式正配置全部开启死锁检查；时序性质只在 `live-*` 和相应敏感性配置开启。`check.py` 审计真实返回码、性质名称、输入摘要、状态数、队列和完成标志，不生成或替换 TLC 结果。

稳定证据归档保留原始 `result.json`、`tlc.log`、`messages.json` 与输入摘要/快照；结果中的原执行绝对路径保持原样，正式索引提供归档对应位置。无需原工作目录即可查看完整检查消息和轨迹。归档不含 jar、TLC 工作队列、业务数据库、凭据、真人对话或旧受拒绝的日志。

## 7. 结论边界与返回条件

有限模型检查不证明任意参与者数量、无限重试、完整重连投影、Session 隔离、秘密可见性、自然语言质量、真实时间调度、数据库隔离或源码 refinement。#7 的 `formal/boundary` 独立负责重连、可见性、隔离与完整 fallback；本目录不把其历史结果计入本轮核心检查。

如果更改提交原子性、结果保留、请求身份、控制/决策代次、期限处理、相关版本判据、终局规则或可交错故障边界，应重新固定范围并返回模型检查。纯源码移动可以由实现者核对语义后更新映射；不能据此无条件沿用本报告。
