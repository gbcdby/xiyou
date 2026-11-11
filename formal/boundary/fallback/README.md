# 原决策与独立 fallback 的组合边界

归属 [Ticket #7](https://github.com/gbcdby/xiyou/issues/7)，补充 `visibility-model`；依据固定 Spec 修订 `6c2a0b9f6d137ad5fbd41721659404333ad8e16d` 的 [M0 §10 / AC-10](../../../docs/specs/m0-protocol.md) 与[验证计划 §3 / VER-01、VER-04](../../../docs/specs/vertical-slice-verification.md)。模式为 `design`，业务实现为 `NOT_ASSESSED`。

本目录对应独立需求审查 finding **R-vs001-p04-VIS-001**：原 `87dd1ec8a5b74d147a41072f66d3639e4e009189` 候选在原决定 Expired/Rejected 后没有独立 fallback 状态及提交围栏。原 visibility 的 28 项实测仍只说明其原范围；本补充不改动这些输入、结果和历史未知记录，也不把其局部通过改称组合通过。修正候选须经独立复审，作者检查不关闭 finding。

**最终 38 项配置均取得其预声明结果：安全与完整双活性各 150,576 distinct states、队列 0、raw rc=0；15 个安全缺陷、3 个活性缺陷、1 个死锁和 17 个见证逐项目标命中。** 详见 [执行报告](report.md)、[结果索引](results.json)与[证据审计](evidence-audit.json)。本目录只报告有限模型、敏感性与可达性，不代替真实数据库、网络、模型供应商或用户验收。

## 同一个状态图内的契约

模型从一个已保存的 `d1` Pending 决定开始。它的正常工具包用一个已通过原子校验的效果抽象；非法 JSON、无合法工具、超时、取消、epoch/权限变化、终局和迟到回调均可与独立 fallback 交错。原 visibility 模型仍负责两个有序工具、观察过滤和事实来源的内部语义；这里的有限组合重新表达原决定的收束和真实 fallback 命令，不用两个互不相连的局部检查替代该边界。

| 阶段 | 模型动作与必须保留的行为 |
| --- | --- |
| 原回调到达 | `Callback` 与 `SubmitOriginal` 分开。到达不是提交，当前授权与期限仍可改变 |
| 原决定收束 | Pending 只变成 Committed / Rejected / Expired / Cancelled 一次；`sealed` 保存首次终态，迟到或重复回调只读该结果 |
| 独立 fallback 排队 | `QueueFallback` 只因 Rejected / Expired 建立持久待办，保留 `d1:fallback` 和原 epoch。排队不授予写权，不创建效果 |
| 接收及预校验 | `ReceiveFallback`、`ValidateFallback` 与提交分开。预校验只存易失提示，后续控制或权限变化必须重新检查 |
| fallback 提交 | `CommitFallback` 先查原 Receipt；新执行先处理 Session 截止，再检查当前 epoch、工具权限、Session 终态与原收束原因 |
| 合法提交 | 效果、连续事件位置、Receipt、outbox 在同一步保存，原 Decision 保持原终态；fallback 是系统生成的受限等待/重新观察命令 |
| 已有结果 | 原键重试返回已保存结果，即使控制权、写权限或 Session 终态已变化也不重新执行。结果读取仍依赖模型明确假设的当前可信读上下文 |
| 异载荷冲突 | 已有 `d1:fallback` 后改成另一工具载荷被拒绝；原 Receipt 不得被覆盖 |
| 崩溃恢复 | 一次崩溃丢失未提交 fallback 阶段和原回调缓冲；持久队列、Decision、Receipt、效果、事件、outbox 不丢失，恢复后以原键重发 |
| 后续计划 | `NewDecisionId` 只分配新 `d2`，不复活 `d1`。本模型不扩展为完整的第二轮推理生命周期 |

固定系统命令的语义载荷为 `wait`，表示协议允许的受限等待/重新观察操作；其执行记号是抽象效果，不声称每种等待都必须产生具体 WorldEvent。`consume` 仅代表复用同键时不同的非法载荷，不能执行成第二个工具。具体领域规则、观察资格和事件种类由 #9 按既有 Spec 实现。

`d` 是持久权威状态。`v` 中处理阶段、缓存预校验和原回调缓冲可在崩溃中丢失；attempts、crashes 与见证标志是有限环境和诊断记录，不冒充数据库字段。`Effect` 保存实际提交时的 epoch、权限、phase、时间与原决定状态，使性质检查真实提交依据，而非只检查一个最终枚举值。

## 规模、时间与假设

本次在运行前固定为 1 个 Session、1 个原决定、1 个 fallback、最多 2 次 fallback 投递尝试、1 次崩溃、epoch 0..1。第二次尝试可以重放已提交结果，也可以恢复第一次未提交处理；这组界限足以容纳提交后崩溃、同键重试和旧回调竞争，不能推广为无限故障或任意并行决策。

逻辑时间为 0..3；2 表示原决定默认 10 秒超时，3 表示更晚的 Session 截止。它只保留本边界的先后关系，不按统一倍率复刻现实秒数；真人 30 秒宽限及完整 Human→Grace→Proxy→Human 链由 #5 的独立范围承担。处理未结束的新命令时先处理已到的 Session 截止；已存在 Receipt 的读取不造成新世界效果。

模型从固定可信系统主体与本 Session 绑定开始。真实认证、当前结果读取权限、Session 隔离和字段解析没有在本目录重新实现；这些是单独的实施义务与其他 #7 产物的范围。`allowed` 表示受限 fallback 工具在当前时刻仍被授权，不表示模型自行决定权限。epoch 改变时，fallback 保留原 epoch，因此旧决定不能把命令重新标成新 epoch 来获得执行权。

正向与活性在执行前均声明 `distinct_state_min=100`。全部使用固定 v1.7.4 / TLC 2.19、普通 BFS、1 worker、1024 MiB、死锁开启；无 CONSTRAINT、ACTION_CONSTRAINT、VIEW、SYMMETRY 或 Java 覆写。运行预算取冻结清单；不能以中途状态数代替完整通过。

## 性质与逐目标敏感性

| 需求 / 本地操作符 | 禁止的行为 | 独立负对照 |
| --- | --- | --- |
| INV-00 `TypeOK` | epoch 或处理状态超出声明域 | `negative-type` 写 epoch=2 |
| AC-10 `StableReasonKey` | 同一 fallback 因重试换新原因键 | `negative-unstable_key` 第二次接收改用 `d1:fallback:retry` |
| INV-02 `AtMostOneEffect` | 原决定或 fallback 再次产生效果 | `negative-lost_receipt` 首次 fallback 效果后遗漏 Receipt，随后唯一崩溃、恢复与原键重试产生第二次效果 |
| INV-03 `ReceiptPayloadBinding` | 同键不同载荷覆盖保存结果 | `negative-payload_overwrite` 把 Receipt 改成 consume |
| INV-04 `AtomicCommitBundle` | 只有效果而没有完整事件/outbox/Receipt | `negative-split_bundle` 只保存效果，不能把部分包当成功 |
| AC-10 `FallbackAfterSettlement` | Pending / Committed / Cancelled 被擅自安排失败 fallback | `negative-early_queue` 在原决定未失败时排队 |
| INV-07 / AC-10 `CurrentEpochOnly` | fallback 使用旧 epoch 仍执行 | `negative-fallback_epoch` 跳过提交时 epoch 围栏 |
| AC-10 `CurrentToolPermission` | 预校验后撤权，仍执行 fallback | `negative-fallback_permission` 跳过当前工具权限 |
| INV-08 `TerminalBlocksNewEffects` | 终局后或 Session 截止时新增效果 | `negative-fallback_terminal`、`negative-fallback_deadline` 分别移除 phase / 截止处理 |
| AC-10 `NoDecisionRevival` | fallback 重开原 Decision，或后续计划复用 d1 | `negative-revive_decision`、`negative-reuse_decision_id` |
| INV-07 `FreshDecisionOnly` | 原工具包绕过当前 epoch、工具权限或决定 deadline | `negative-original_epoch`、`negative-original_permission`、`negative-original_deadline` 分别撤除一项 |

每个安全负对照仅启用自己的目标不变量，要求原始 TLC rc=12 与日志中的目标名称同时成立。`lost_receipt` 的缺陷调度只允许首次 fallback 效果出现后注入唯一崩溃，并阻止崩溃前的第二次处理；这只用于目标反例存在性，正向模型允许任意时刻的一次崩溃，不据此缩小正向故障范围。

见证以 `NotReached` 的预期反例保存：原决定正常提交、非法 JSON/无工具拒绝、超时、Rejected 与 Expired 各自的合法 fallback、预校验后 epoch/工具权限/终局变化导致拒绝、Session 截止拒绝、成功后的同键重复、崩溃恢复后重试、异载荷拒绝、fallback 成功后迟到原回调、原回调重复、终局读取原 Receipt、新 decisionId。其 rc=12 只证明目标路径可达，不是完整正模型通过。

## 活性与允许的停滞

`DecisionResolvesOrExpires` 检查 Pending 最终收束；`FallbackResolves` 检查 Rejected/Expired 后最终得到确定的 fallback Receipt，结果允许 Accepted 或 Rejected。fallback 被旧授权、撤权或终局拒绝不算活性失败，也不能为了成功而换 epoch 或复活原决定。

`LiveSpec` 仅对 Tick、Expire、SubmitOriginal、Recover、QueueFallback、ReceiveFallback、ValidateFallback、CommitFallback 施加弱公平性。假设一次崩溃后存储/处理最终恢复，有限待办得到处理；不要求 LLM 返回，不增加强公平性，不承诺永久故障下仍有结果。

`negative-no_timeout` 禁用超时处理，原模型永不返回时 Pending 可永久停滞；`negative-no_queue` 和 `negative-no_fallback_commit` 分别关闭排队与实际提交，fallback 无确定结果。三个检查必须获得真实时序违反 raw rc=13。独立 `deadlock` profile 在 Pending 初态关闭 Next，要求 raw rc=11；它不冒充任何业务不变量的负对照。

## 复现与证据身份

```sh
python3 formal/boundary/fallback/check.py --jar /absolute/path/tla2tools.jar --run-id fresh-fallback
```

可用 `--profiles positive live` 只运行指定项。每次使用新的 run-id。jar SHA-256 为 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`；受控 runner 保持仓库原字节，不把模型结果与实现结果混写。

原始 result/log/messages 保存在逐 profile 目录。共享的 input 与 manifest 是从相同字节快照去重归档；各 raw result 内的实际路径与命令保持原样，当前版本化定位由 [results.json](results.json) 给出。原始工具结果不被改写；摘要、实际性质、状态数和原始退出码由只读审计核对。

## #9 / #12 的实施义务

| 模型约束 | 需要实现方提供的场景与断言 |
| --- | --- |
| 原 Decision 与 fallback 同属权威入口 | 保存可核对的 Session/Decision/principal/command 因果身份；原状态先收束一次，fallback 才以独立稳定键处理 |
| 当前围栏在实际提交时重读 | 在预校验后暂停；分别改变 epoch、工具权限或终局，再继续提交；不得产生旧授权效果 |
| 先查 Receipt，再判断新的写权限 | fallback 已提交后丢结果，交还或终局后原样重发，只读取原 Receipt；当前结果读权限仍需先核实 |
| 效果与去重记录不可分离 | 真实数据库 COMMIT 前后、ACK 前、发布阶段注入故障；恢复后同键最多一个效果，outbox 可补发 |
| 不可复活与新 ID | 原决定 Expired/Rejected 后成功 fallback，再放行原 LLM 回调；原决定仍是旧终态。后续重新观察/计划分配新 decisionId |
| 非法输出与受限工具 | 非法 JSON、无合法工具不能产生原意图效果；fallback 只能使用当前仍允许的等待/重新观察行为 |
| 活性条件 | 推理在事务外异步进行；超时与有限待办公平处理，其他玩家不因 LLM 未返回而被阻塞 |

这些是真实回归规格，执行状态为 `NOT_RUN`；数据库、应用、供应商调用和源码对应为 `NOT_ASSESSED`。改变原因键、payload 规范化、重试身份、当前权限来源、原决定终态、事务边界、调度公平性或新增多轮并发决定时，必须重新评估本模型及证据。
