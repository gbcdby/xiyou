# A3 恢复与语义唤醒：恢复后重新模型检查

> 后续来源补充：下文“本次”和 40 项结果均指固定 0ac 阶段。CUI-OBS-01 朝向组合的有限源码复核见 [朝向来源记录](../facing-source-review.md)；其 TLC 为 `NOT_RUN`，旧 profile/模型/运行身份保留。已有 runtime 场景扩展与本轮 spatial-rules 变化分别记录，不把旧 40 项扩为新增分支证明。

## 本次结论

2026-11-13 对新固定候选 `0ac2bf5f34e49f4508daac74b1d6b38196f15ad6` / tree `047cdcc3a4a2a7239e29e66b31796d5098e6c491` 重新核对源码，并重新执行完整既定矩阵。**40 项均符合各自预声明判据；模型正例结论为 `PASS_WITHIN_SCOPE`，已覆盖源码转移为 `IN_SYNC`，整体源码对应为 `PARTIAL`。** 没有业务代码改动，没有执行真实 PG、HTTP、Socket 或 provider 验收，也不声明完整 A3 通过。

这次恢复与重新运行必须分开记录：

- 原 `da7f297` 提交对象、旧工作树与旧 40 项日志不可读，旧结果没有移入本次结论。
- [RecoveryWake.tla](model/RecoveryWake.tla) 按原始写入及后续变换的精确历史工具输入恢复，SHA-256 与既有记录完全一致：`cefc90a3bc05805ade0e60c2d253d520c15fd52f0f35c85dd649d17d503334ae`。
- [verification.json](verification.json) 同样匹配旧摘要：`0a5a8a0c51d26a6cb47619cf388bace41b1e64e9c159b0510d6169f4a975f0a8`。40 个配置、独立判据和调用脚本也按历史工具输入恢复，并在本次实际执行中核验。
- [state-contract.md](state-contract.md) 的冻结摘要仍为 `782983172b61f5b094fb6a3ba73554f160cffb96f7f611d53f3041760817f678`。该文件保留实现前契约原文；实际新源码对应见下文，不把计划表当运行证据。
- 本目录的源码对应、结果清单、身份清单和报告是本次新产物；精确恢复两个摘要不意味着完整旧提交已经找回。

| 检查类别 | 数量 | 本次实际结果 | 含义 |
| --- | ---: | --- | --- |
| 正例安全与活性 | 11 | `PASS_WITHIN_SCOPE`，原始退出码 0 | 8 个安全配置，加 3 个带 `SemanticProgress` 的配置；均检查完整有限状态空间 |
| 安全敏感性负控 | 12 | 指定不变量反例，退出码 12 | 每个变体必须击穿预声明目标，不能用任意工具失败充数 |
| 旧 25c 抽象对照 | 1 | `SemanticProgress` 活性反例，退出码 13 | 复现恢复读取前漏 resume 的同类机制 |
| 因果可达见证 | 16 | `NoWitness` 反例，退出码 12 | 指定窗口和后续因果路径存在；不当成产品缺陷 |

原始运行时间为 `2026-11-13T06:24:30.962669+00:00` 至 `2026-11-13T06:25:34.840445+00:00`。`40/40` 指符合上述不同判据，不能简写成 40 个正例全部通过。详细索引见 [results.json](results.json)，核验清单见 [evidence-audit.json](evidence-audit.json)，摘要见 [identity.json](identity.json)。原始日志、输入快照、消息和固定源码快照单独封存为 `runs.tar.gz`，不纳入 Git；归档 SHA-256 为 `a1aad3319aef02bd06b15fffc612a1b9b5b2f3bbaacaa4806035db26e2afe8a4`。

## 问题和采用的边界

本模型只研究一个角色在恢复旧请求时，已经提交并通知的合法语义事件能否保留到后续正常规划。它补充既有 [Scheduler.tla](../model/Scheduler.tla) 与 [MovementCommands.tla](../model/MovementCommands.tla)，没有扩大为完整游戏模型。既有共享并发、轮转、公平预算、授权投影以及原请求数据库幂等作为前提，没有在本次重新证明。

原失败机制在 actor 尚无暂停基线时，从恢复查询读回的当前 `paused` 猜测此前是否发生 resume。真实 resume 可在连接 checkout 后、恢复 BEGIN/读取前提交并送达；此时通知只带 `paused=false`，稍后查询也读到 false。只补初始化读或读后返回窗口，不能区分普通 false→false 与真实 true→false。

契约使用已提交事务的初始暂停事实 `spatialPauseBefore`，按同批既有 clock 的事件顺序折叠，得到真实 true→false；该字段属于私有进程内通知。语义通知通过已有相关性与权限筛选后，以既有 `sessionSeq` 去重并更新 pending；恢复读取不再决定语义是否存在。模型没有增加 WorldEvent、DTO、表、模型输入或事件 ID。

恢复与正常规划的状态所有权为：

| 状态或阶段 | 模型含义 | 可以改变的内容 |
| --- | --- | --- |
| `w` | Session 权威状态、epoch、有限已提交日志 | 事务提交改变运行/暂停/授权事实 |
| `a.pending` / `a.last` | 未消费语义水位与接收/消费去重水位 | 合法通知增加水位；成功 reserve 返回后的正常消费只清已覆盖水位 |
| `a.dirty` | 技术重试、显式恢复等一次触发的抽象 | 可以重新检查授权，但不能让纯 pending 无限技术重试 |
| `BeforeRead` / `DuringRead` / `AfterReturn` | 恢复读取之前、读取期间、返回之后 | 查询原请求；不消费新语义、不新推理 |
| `NeedSubmit` / `ReceiptReturned` | 原收据未收束 | 沿用原身份重试或读收据；仍不消费 pending |
| `ContextRead` / `ContextHeld` | 独立正常周期与已准备 context | prepare 取当前授权快照和 baseSeq，未暂停才可新 prepare |
| `Reserved` | reserve 已成功提交，返回尚未消费 | 当前权限/epoch/运行/预算接纳点已发生；通知仍可到达 |
| `Inferring` | reserve 返回后的正常调用分支 | 只消费该 context 已覆盖水位，并累计 calls |

模型保留 prepare、reserve 成功提交、返回后消费 **三步**。`calls` 计编排器进入调用分支，`reservations` 计持久预算接纳，不等于真实外部网络调用次数。同一事件可以出现在后续历史 context；“最多消费一次”指它不会再次独立触发额外规划。

## 有限环境、假设与公平性

每个配置是一个 Session、一个 actor、一份持久旧请求和一个固定的有限事务计划。计划长度最多 4；事务最多包含 2 个有序 clock，因此序号上界为 8。事务类型包括真实 resume、普通 clock、pause、同批 pause→resume、本人 Observation、无关 Observation、move、revoke、grant、end。事务通知可以乱序，每份最多递送两次；同一通知内部的事件顺序不打乱。

真实语义集合由权威事务的类型和提交前事实独立计算；通知机制另行折叠事件，不用同一个“结果变量”同时充当判据。较晚通知先到达可提高水位，较早通知随后被去重。正确性依赖 `sessionSeq` 按提交递增、当前 context 包含其 baseSeq 之前有资格感知的相关事实；内部通知本身不是授权。

旧请求抽象保留 raw、digest、nonce、movementSeq、receiptKey。模型允许查询未发现收据后，旧操作晚提交，再与恢复重提交交错；原子幂等保障由继承的持久层契约提供。技术 Unknown 最多启动三次自动重试，部分配置允许一次显式恢复。原 SQL 错误、连接、编码与哈希本身没有被翻译成 TLA+。

安全配置不要求公平性。活性配置使用 `LiveSpec`，为外部计划提交、每份通知的第一次送达、恢复和正常内部步骤、冷却间隔流逝添加弱公平性；不要求重复通知一定发生。具体性质是：

```tla
(<>[]Ready /\ <>old.settled) =>
  (\A s \in Seqs: (s \in evidence.required ~> s \in evidence.covered))
```

`Ready` 包括当前授权、运行、未暂停与剩余预算。只有这些条件最终持续具备，且旧原请求最终收束，才承诺已收到的合法语义最终被新正常 context 覆盖。模型没有强行让永久 Unknown、永久撤权、耗尽预算、永久不送通知或永久不调度产生进展。有限自动重试耗尽后，保留 pending 并等待新合法触发或显式恢复是允许的停点。

`Rest` 仅在有限输入已经提交/送达且处于合法空闲或阻塞状态时自环；没有给每个中间状态添加无条件动作来遮掩死锁。全部配置启用死锁检查，没有 STATE/ACTION CONSTRAINT、VIEW、SYMMETRY 或随机模拟裁剪。本结果是这些有限计划内的穷举，不是任意规模定理。

## 检查的性质与敏感性

| 正例不变量 | 检查内容 | 对应负控 |
| --- | --- | --- |
| `TypeOK` | 有限状态及计数范围 | `negative-type` |
| `OriginalRequestPreserved` | 原请求身份不被替换 | `negative-identity` |
| `OldEffectAtMostOnce` | 原请求抽象效果最多一次 | `negative-repeat-effect` |
| `RecoveryDoesNotPlan` | 原请求未收束时恢复不新规划 | `negative-recovery-plan` |
| `PendingSemanticPreserved` | 运行中未覆盖语义仍在 pending 水位之下 | `negative-clear-newer` |
| `PlannedForFreshCause` | 新调用由未消费合法语义或模型内明确许可的显式原因触发 | `negative-ordinary`、`negative-duplicate` |
| `AuthorizedAdmission` | 成功 reserve 时的权限/epoch/运行/预算门槛 | `negative-gate` |
| `AutomaticRetryBound` | 自动恢复最多三次 | `negative-overretry`、`negative-pending-spin` |
| `OnlyContextConsumes` | 恢复不消费语义，只有正常 context 消费 | `negative-recovery-consume` |
| `UnknownKeepsOriginalOutcome` | 技术 Unknown 不覆写原确定收据、不冒称已经收束 | `negative-unknown-reject` |

负控是在 `Fault` 中明确隔离的错误变体；正例均为 `Fault="none"`。每个负控必须命中对应目标不变量，退出码 12；单纯解析失败、工具失败或任意其他性质失败都不满足判据。旧机制对照仅配置 `SemanticProgress`，因此退出码 13 与该性质的实际时序反例单独核验。

正例的本次独立状态数如下，11 项均完成、待探索队列为 0、TLC 原始退出码为 0：

| 配置 | 独立状态数 | 性质 |
| --- | ---: | --- |
| `positive-resume-observation` | 1,017 | 10 个安全不变量 |
| `positive-observation-resume` | 785 | 同上 |
| `positive-ordinary` | 536 | 同上；普通 clock/move/无关观察 |
| `positive-batch` | 520 | 同上；同批 pause→resume |
| `positive-control` | 22,604 | 同上；撤权/恢复与 epoch |
| `positive-terminal` | 548 | 同上；终态清理 |
| `positive-unknown` | 26,560 | 同上；技术失败、三次自动重试、显式接替 |
| `positive-budget` | 953 | 同上；有限持久预算 |
| `live-resume-observation` | 1,017 | 安全不变量与 `SemanticProgress` |
| `live-batch` | 520 | 安全不变量与 `SemanticProgress` |
| `live-control` | 22,604 | 安全不变量与 `SemanticProgress` |

16 个 `NoWitness` 配置分别要求：resume 和本人 Observation 在读取前、读取期间、原收据收束前的六条路径；context 读取后新事件；reserve 提交后返回前新事件；重复去重；同批 clock；重试耗尽仍保留 pending；显式恢复保留已有 pending；授权阻塞；终态清理已有 pending；纯恢复零新调用；prepare 后暂停仍可继续 reserve。它们的目标都包含后续状态或因果水位，不以单纯“经过某一行”作为成功。关键轨迹见 [traces.md](traces.md)。

## 旧反例与新水位的因果对照

旧 25c 抽象使用未初始化的暂停缓存。`before-read-only` 配置明确约束第一份通知在恢复读取前送达，固定的可行时序是：resume 提交 → 通知送达但未辨认 → 恢复读到 false → 读取返回 → 找到原 Receipt → 原请求收束 → Idle、pending=0、calls=0。TLC 在本次运行得到 8 个显示状态及持续停顿，`SemanticProgress` 失败。这里没有恢复旧产品代码或重跑其数据库反例；只是用已知缺陷的必要机制提供可重现模型对照。

新机制的 `witness-reserve-race` 则实际得到：context=1 → reserve 成功 → 序号 2 通知送达 → 返回消费保留 pending=2 → 第二次正常周期 context=2 → 消费完成。错误变体 `negative-clear-newer` 在同类交错中将 pending 全部清空，立即击穿 `PendingSemanticPreserved`。这两类证据区分了“场景可达”与“错误清理会被判据检测”。

## 新源码对应与不能推导的保证

[implementation-map.md](implementation-map.md) 按本次固定 Git 对象重新核对通知前态、语义接收、旧请求恢复、有限技术重试、三阶段正常规划、水位消费和错误分类。完整文件身份见 [project-profile.json](project-profile.json)。orchestrator、runtime、说明文件匹配已记录历史 blob；`backend/ai/spatial-decisions.mjs` 的 001 分类/保留 Unknown 为本次明示重建，blob 为 `49e61f419d7798ebff9e71da9019639198471e94`。当前 `backend/decisions.mjs` 为 `f201ff0759a19d1357ef4466dbd04ea85ce1528e`；历史另一身份无对象可核，不能声明旧整树等价。

本次的暂停结论严格分三层：已暂停不能新 prepare；暂停前 prepare 的 context 可以继续 reserve；实际世界动作由既有规则按允许项/拒绝执行。模型没有假设源码不存在的 reserve 时 paused 重验。成功 reserve 后、返回前若发生撤权或终态，调用分支仍可能被进入并携带已 abort signal；模型不能证明这段窗口零外部成本。

整体对应仍是 `PARTIAL`，原因包括：SQL 一次效果/Receipt 原子性、摘要和原文字节保持、完整相关性/权限投影、真实动作围栏、共享调度预算内部为继承前提；新 provider 调用的全部保存失败/未知返回恢复组合未纳入；pending/last 不持久化，不覆盖进程重启丢通知或永久传输故障。工程对应不是源码 refinement 证明。runner 的 `implementation_status` 为 `NOT_ASSESSED`，独立形式化复审为 `NOT_RUN`；另一独立标准报告的业务实测不能替代本模型检查，本工作也未冒领其执行。

历史中曾把 STALE 返回错误建模为永久 Unavailable，由此产生的假活性反例只属于建模错误。当前模型按实际失败分支回 Idle，且保留三阶段边界。旧中间日志已经缺失；不伪造恢复、不列为本次产品 bug。

## 复现与证据判据

使用仓库已有固定 [run_tlc.py](../../../.agents/skills/worker-tla/scripts/run_tlc.py)，经 [check.py](check.py) 调用。本次复用本地已存在的官方 TLC 2.19，SHA-256 为 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`；实际报告 `TLC2 Version 2.19 of 08 August 2024 (rev: 5a47802)`，Java 为 OpenJDK 21.0.13。没有下载新工具或外部模型。

在仓库根执行，`TLC_JAR` 指向上述摘要的 jar，`RECOVERY_CHECK_OUTPUT` 指向一个尚不存在且符合项目临时产物约定的输出目录：

```bash
python3 formal/adv001/recovery-wake/check.py \
  --jar "$TLC_JAR" \
  --out "$RECOVERY_CHECK_OUTPUT" \
  --jobs 2
```

每项为 BFS、1 worker、512 MiB、120 秒上限；脚本最多同时运行 2 项。可用重复的 `--profile` 只重跑指定配置。脚本使用 [expectations.json](expectations.json) 中的独立预声明判据，逐项核验配置和实际启用的不变量/性质、死锁检查、原始退出码、指定反例目标；正例还要求完成、队列为 0 和至少 50 个独立状态。全部满足才返回 0。

本次额外逐项核验全部输入快照、manifest、jar、runner、原始日志/消息摘要和固定源码快照；公开清单不含本机私有路径。修改通知来源、相关性、baseSeq 含义、三阶段消费边界、错误分类、原请求身份、重试规则或部署多编排器时，应重新评估模型。当前原问题范围已完成检查，不扩展新的形式化领域。
