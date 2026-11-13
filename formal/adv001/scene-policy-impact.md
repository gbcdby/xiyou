# scene_role D2-R1：限定形式化影响核对

## 结论与身份

**本次为设计影响核对，`source_inspection / OBSERVED`；新增模型与 TLC 为 `NOT_RUN`，业务源码对应为 `NOT_ASSESSED`。** 未发现 N5/N6 与已采纳合同必须修改的矛盾。建议后续只补原请求/依据/水位和路线执行围栏两个小抽象焦点，不扩大旧恢复矩阵；是否建模、运行及核对冻结源码由后续任务决定。

| 依据 | 固定身份 |
| --- | --- |
| [采纳设计](../../docs/specs/gaolao-scene-policy.md) | 本候选中的公开合同 blob `f206953fe093d4d0a3e36bd773cf6a1819fadc47`；公开实现基线 [`201f18349e0baca60a00f3b5ccaa32dc5278b101`](https://github.com/gbcdby/xiyou/commit/201f18349e0baca60a00f3b5ccaa32dc5278b101) |
| 原采纳输入文档（历史身份） | blob `c49c01e9fd96b2767b983bb95fb8dbacf3b23bd0`；SHA-256 `d554fdcbc372698aaee4d109e6b58fe82ed03563ffde7abee128da1baaca5430`。公开版仅更新来源记录，合同正文未改。 |
| 原 D2-R1 需求正文 | commit `b0aac5521bfebb6719eff827ec44c81558e48649`；采纳提交只追加 9 行状态/来源元数据 |
| [共同协议](../../docs/specs/adv-protocol.md) | SHA-256 `8a124c275b3548b7ee65118086eb46197de33a2778a1b577264308adf4e8e220` |
| [旧 RecoveryWake](recovery-wake/README.md) | 模型 SHA-256 `cefc90a3bc05805ade0e60c2d253d520c15fd52f0f35c85dd649d17d503334ae`；manifest `0a5a8a0c51d26a6cb47619cf388bace41b1e64e9c159b0510d6169f4a975f0a8` |

已阅读 D2-R1 需求复审与标准设计审查的限定 PASS；它们均为设计证据。旧恢复的本次 40 项执行及对 core `0ac2bf5` 的对应只覆盖旧合同，不能证明新 scene 策略。此次没有运行产品、修改业务或建立新 TLC 配置；实现候选尚未冻结，不给 `SOURCE_IN_SYNC` 结论。

## 旧模型的可复用部分与新增义务

| AP / 已有模型 | 可复用的抽象与性质 | N5/N6 需要补充，旧结果不覆盖 |
| --- | --- | --- |
| AP-01：[MovementCommands](model/MovementCommands.tla)、[Movement](model/Movement.tla) | 原身份、`ReceiptStable`、epoch 与旧回调围栏、实际到达区别于 Accepted | 私有 basis 的首次提交重验；接受后新执行版本；itinerary/C13 段与整段越界前停止 |
| AP-02：Movement、RecoveryWake | 暂停不推进、真实 resume 的事务前态、技术恢复与语义分离 | 重启清易失水位、保留持久预留/效果、提升 epoch 并暂停旧 follow；独立初始化扫描不能自动续用旧接受 |
| AP-03：[Consent](model/Consent.tla) | `SettlementAuthorized`、`SafetyDurable`、真实本人和当前安排 | 每个 proposed 版本的有限回应、不可变准备依据与实际新版本关联、改约/撤回/到达确认的竞争 |
| AP-04：[Identity](model/Identity.tla) | 固定受众、观察历史、引用目标稳定等性质模式 | 两份持久本人来源、受限白名单 basis、分享保持来源、进入前无远处 live 状态；具体投影和字段出口仍须实现验证 |
| AP-06：[Scheduler](model/Scheduler.tla) | 三自主角色原预算/轮转义务继续独立 | scene 直接执行不改变 Gateway/ai_runs/模型预算；合法 scene 事件仍可触发相关自主 NPC 的正常周期；锁和事件处理负载不能由局部模型推出公平 |
| RecoveryWake | 恢复三窗口、原请求不变、有限重试、重复/乱序通知、晚到水位保留 | scene 的消费点是授权评估及原子预留/确定无动作结果，不是模型调用 reserve；逻辑步骤持久去重、无动作评估、重启扫描均需新增 |

## 最小后续模型边界

以下是建议的模型边界，不是已经创建的文件或已运行配置。两个焦点共享“当前安排身份、成功响应生成的执行关联、持久原结果”接口；分别通过也不能自动推出组合正确。

### A. scene 原请求、依据与语义水位

先取一个真实 scene actor、最多两个先后安排/请求、两个可替换领路者、有限 epoch/版本、少量语义事件、最多三次自动重试及一次显式恢复/重启。身份和资料摘要作为不透明有限值，禁止用同一变量同时充当待验依据和权威真值。

- 持久状态：逻辑步骤键、尝试 ID/前一终结尝试、原文/摘要/epoch/ref/适用 nonce 与移动序号、不可变 `scenePolicyBasis`、原 Receipt、成功步骤集合、当前 consent/follow/版本、接受后执行关联、本人来源身份/版本。
- 易失状态：恢复阶段、技术触发/次数、last/pending/evaluated 水位、初始化扫描标记、评估返回待处理状态。崩溃只清易失部分，不能清成功步骤或伪装持久化 pending。
- 环境依赖：本人/领路者 epoch、有效安排、近距/LOS/在线/路线范围、本地通路、地图/来源修订、paused/终态分别可变；无关角色移动只增加事件序号，不改变这些真实依赖。
- 动作边界：恢复读/返回/原结果收束；授权评估与预留；提交首次 basis 校验/领域效果/Receipt；返回后消费。设计允许读取、纯判断、预留合并短事务，但事务返回与水位消费仍可插入通知。实际冻结源码若拆开其他步骤，模型应相应拆开，不能套用旧模型的 provider reserve 名称冒充对应。
- 正常评估可以产生 accept/defer/decline/withdraw/确认，也可以确定无动作。只有当前授权评估与原子预留或确定无动作结果成功，才消费 `pending <= evaluatedThroughSeq`；失败、Unknown 和晚到序号保留。确定无动作不要求虚构一份动作 Receipt。

### B. 当前执行关联与有限路线围栏

空间只抽象成 `B∖U`、`B∩U`、`U∖B`、范围外，以及本人实际 C13 条件；另有当前场景、约定相邻入口、有限 itinerary 段和 next-step 全段合法性。B/U 是合同中的闭合集合，C13 真值独立于区域标签和领路者位置。连续几何真值由实现验证，不能在模型中假定“端点合法即整段合法”。

保留不同的准备 basis、接受执行关联、当前权威版本；执行关联只由本次合法响应原子建立。跟随状态区分 proposed/accepted/following/paused/arrived/settled，暂停原因区分真实路线偏离与离线/人数/阻挡。旧接受、旧到达、旧 exitDone 不能给新安排授权。正常相邻转换允许领路者先进入下一段，本人的段只因本人达到检查点而前进；新提议根据当前位置重建，若已实际满足 C13 可初始化完成，仍需本次资料和接受。

## 最小安全义务

| 建议性质名 | 必须表达的保证 | 设计依据 |
| --- | --- | --- |
| `ReceiptReplayStable` | 经原授权读权及同身份/摘要检查找到 Receipt 后，返回原结果；首次领域 basis 校验不能把已提交结果改成拒绝 | §0、§4.3、§6.3 |
| `PreparedRequestImmutable` | Unknown 不换请求、准备 basis、选择或序号；确定拒绝先终结原尝试，新尝试须有当前依据 | §4.3、§6.3 |
| `ChoiceCurrentAtCommit` | 无原 Receipt 的首次效果与当前本人权限、真实依赖重验同事务；不能在 prepare 合法后盲交旧 accept，也不能同 ID 改成 defer | §4.2–4.3 |
| `ExecutionBoundToActualResponse` | 合法回应关联实际生成的新 consent/plan 版本和原 Receipt；准备原文不被改写；后续变化不“刷新关联”续用旧许可 | §4.3 |
| `LogicalStepEffectOnce` | 去重约束成功效果，不把请求尝试数误当效果数；重启/重复 contact/通知重放不重复人物回应、退让或安置 | §6.3 |
| `EvaluationWatermarkPreserved` | 恢复不消费；正常预留或确定无动作只消费已覆盖水位；晚到和失败时 pending 保留，纯 pending 不使耗尽技术重试自旋 | §6.2 |
| `CurrentRouteOnly` | 当前许可、双方 epoch、地图/路线、段与指定入口匹配才推进；已 paused 不能因 resume/重启自动 following | §3.2、§5.3–5.4 |
| `ExitAndWholeStepSafe` | 起点 B 优先；本人实际 C13 且 court-ground 才退出；退出后 U 交叠合法、B∖U 禁入；任何实际步进在越界前停止 | §3.2、§5.3 |
| `PauseAndSafetyFence` | 暂停/终态不新推进；迟返回只收束原结果；Accepted 不是 arrived，settlement 重验当前安排且 safe 单调 | §2、§4.2、§5.4 |
| `SceneDirectBudgetIsolation` | scene 动作及恢复不直接预留模型预算、不进入 ai_runs/Gateway；随后合法通知引起自主 NPC 决策是另一动作，不应被禁止 | §6.1–6.2 |

`scene_role` 的可信授权不等于真人 UI `self.canControl`，basis 必须严格白名单。模型可抽象成可信主体/合法来源谓词，不能借此声称完整 HTTP/Socket、JSON、日志或隐私出口已经证明。

## 活性前提与最小敏感性场景

后续语义活性应改成“当前合法信号最终得到一次正常授权评估结果”，而非“每个事件最终 accept/调用模型”。原请求最终收束、通知/调度/事务步骤弱公平、授权与 Running/非暂停最终持续具备是前提；scene 活性不依赖模型预算。无关 sessionSeq 变化不能使有效 basis 永久过期。路线最终到达还依赖真人确实继续合法带路、本地可通行且实际步进公平，不能由策略代玩家保证；新提议不是自动发生的环境假设。

至少保留下面七类独立风险场景；冻结实现后只为实际改动选择具体错误变体，不机械复制旧 40 配置或凑数量。全部为**待运行的静态反例设计**：

| 场景/最小错误变体 | 允许的时序与应检出的错误 |
| --- | --- |
| 原结果前错误重验 basis | accept 已提交、版本增长、响应丢失、随后撤回；重试先比较旧 basis 而返回新拒绝，违反 Receipt 稳定性 |
| 省略提交时重验或改写准备依据 | prepare accept 后领路者 epoch/资格变化；仍执行旧选择，或同 ID 改成另一回应；应触发当前选择/不可变请求性质 |
| 用 proposed 旧版本或任意刷新执行关联 | accept 从 v0 产生 v1，却把执行绑定 v0 导致立即暂停；或后续撤回 v2 后刷新并继续；安全断言与正常接受可达见证分别检测 |
| 清掉全部 pending / 恢复隐含新动作 | 评估水位 q 后到达 q+1，再预留/无动作返回或恢复收束；q+1 必须保留，纯恢复不能生成第二身份；重试耗尽不能自旋 |
| 仅内存步骤去重 | 成功效果已提交、响应丢失、重启清内存、初始化扫描；不能用新 ID 再做同一步骤，也不能自动复活旧 follow |
| 错误空间和段守卫 | 分别变异为仅看端点、用领路者 C13/首个 area 代本人出口、复制旧 exitDone；覆盖端点在内但中段越界、B∩U、旧计划重提议三种不同真值 |
| 错误资源/新鲜度依赖 | scene 直接扣模型预算应失败；用全局 seq 相等作提交门槛时，无关移动不应饿死回应。合法 scene 事件再唤醒自主 NPC 是必须保留的正对照 |

另需正向见证：接受后实际新版本可以推进；B-only、交叠/共有边界、C13 已实际完成三类起点可经新安排继续；领路者先过约定相邻连接不会误停；pause/撤回/重启/换领路者后在过道新提议可成立；defer/decline 与内部无动作确实不同。单纯证明所有动作被守卫挡住不构成可玩性通过。

## 留给冻结实现及实际验证的边界

- **几何和路径：** 闭合多边形、全线段/曲折路径、量化误差、C13 到达容差和 court-ground 交集、两个布局、远近场景的实际通路及两客户端完整路线。有限区域抽象只能验证用对守卫的协议，不能证明这些几何真值。
- **SQL 与恢复：** 白名单编码、原文/摘要字节、预留/效果/Receipt/执行关联的原子性、逻辑步骤唯一性、COMMIT 前后未知结果、查询分类、来源落出窗口和重启枚举完整性。抽象原子动作是实现义务。
- **权限与信息：** 真实内部 actorKind/epoch、本人来源/provenance、参与者受众、不可伪造引用、公开 Action 不接纳私有 basis、无远处 live 查询、日志及八类出口。有限身份标签不是保密证明。
- **调度与预算：** AuthorityServer/AIServer 共用单实例、不嵌套 Session 锁或持锁等待外部服务、普通 tick 不重评、边界变更一次通知、合法自主 NPC 因果唤醒和共享调度仍有进展。不得以“scene 零直接模型预算”推导“scene 事件永远不产生 NPC 模型成本”。

上述风险均已有合同约束，此次未发现需另改设计的必要反例；所列错误时序是待防实现偏离，不是已观察产品 bug。后续只在冻结了新源码身份、私有 schema 与具体事务/返回边界后决定必要模型增量和运行；本次到此交接，不推进旧模型通过基线。
