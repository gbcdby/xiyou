# scene_role 请求与跟随围栏：STD-002 修正对应

本目录只为高老庄首章当前机制提供证据，包含前院、茶棚等本章分支；不建模或交付后续章节。检查采用合同 N1–N6 中的两个有限协议：原请求与语义水位、本人跟随执行围栏。本轮把 STD-002 的真实修法纳入请求模型并对固定源码做只读对应。**这是有限模型与工程对应结论，不是整体产品证明。** 旧 `recovery-wake` 的 40 项没有修改、重跑或计入本目录结果。

## 当前结论

当前模型的 64 项配置均符合运行前声明的判据。其中只有正例使用 `PASS_WITHIN_SCOPE`；预期反例和可达见证仍记录为 TLC `COUNTEREXAMPLE`。旧阶段 52 项单独保留，没有累计成新增通过。

| 类别 | 数量 | 实际判据 |
| --- | ---: | --- |
| 有限范围正例 | 20 | 原始退出码 0、检查完成、剩余状态 0；其中 13 项带活性性质 |
| 安全敏感负控 | 27 | 原始退出码 12，命中预声明的不变量 |
| 活性反例 | 5 | 原始退出码 13，单一预声明活性性质违例 |
| 因果可达见证 | 12 | 原始退出码 12，刻意否定的 `NoWitness` 被打破 |

请求模型更新后实际运行 47 项；路线模型 17 项沿用已完成的运行。已逐字核对路线模块、17 份配置、清单以及四份相关执行源码未变，未将旧请求模块的历史结果贴到新哈希上。[results.json](results.json) 给出逐项性质、状态数、输入和日志摘要；[RESULTS.md](RESULTS.md) 是便于阅读的矩阵。

源码对应以 [source-files.json](source-files.json) 的产品文件 SHA-256 为准：当前源 `955850241093332353cbb8b84fc2a7df40ecb827`，树 `b23c8f7aa296799c38767a2cb438bcc98602582c`，parent 为 `7f48f5f2cff6ad39bd7d55c2da600607f0ebc05b`。该产品树已在 PR 47 公开保存为 `a217805297139d9a3f2905ce864a64585f78fc7f`，与 955 完整同树。公开对应来自已核实的发布交接，本任务未另行访问远端。固定文件哈希用于核对产品内容，复现模型不需要本地 955 Git 对象。

**955 已覆盖转移的只读对应为 `IN_SYNC / ASSESSED_WITHIN_SCOPE`，整体仍为 `PARTIAL`。** 旧 7f 的 STD-002 失败和旧抽象对照保持历史身份；当前 `req-resume-after-rejection` 已改为真实水位机制。具体对应见 [SOURCE_MAP.md](SOURCE_MAP.md)。原始 runner 的 `implementation_status` 保持 `NOT_ASSESSED`，工程对应记录独立保存。

## 两个模型

### SceneRequest

`w` 保存有限权威状态；`d` 保存不可变原请求、原 Receipt 及其原子 `receiptSeq`、收束结果的 `outcomeSeq` 副本和成功逻辑步骤；`a` 保存控制器阶段、入口捕获水位、实际读态水位、消费界线及 last/pending；通知可重复两次并可倒序；`e` 仅用于检查历史事实。

`Start` 在正常调用入口捕获当时已收到的 pending；稍后的 `Evaluate` 表示一次授权 prepare 事务；`Consume` 表示该调用返回后的唯一水位确认。`Submit` 与其返回分离；原请求恢复读与返回也分离。事务内部原子性是继承前提。一个主体、一个逻辑效果、最多三个持久请求、最多两个外部事件、一次易失控制器重建以及有限 Unknown，构成当前穷举范围。每个正例都检查 `CapacitySufficient`，防止请求上限静默截断所需工作。

同依据旧 Rejected 只有入口真实信号晚于原 Receipt 水位才放行关联的新身份；依据确实改变的原路径保持。缓存等待只确认入口输入，成功预留、Accepted 去重及真正 NoAction 确认实际读态。Receipt 水位不能被恢复时的世界水位替换，Unknown 未决不得另起身份。新性质 `ReceiptWatermarkStable`、`AttemptLinked`、`RejectedAttemptAuthorized`、`RejectedWaitKeepsInputBoundary`、`TrustedPrepareInput` 与原 13 个安全性质一起在全部请求正例启用。

完整 basis 保留；`Projection` 只选择该动作的相关比较字段。独立的 `DecisionProjection` 表示真实决策依赖，因此删除共同围栏的负控不能用错误实现反过来定义正确性。`common` 汇总仍必须检查的内容、地图、本人资料、许可、双控制代次、引用和资源版本；`dep` 表示对应动作的资格；`inc` 表示 withdraw 不依赖的领路者位置资格。模型不枚举全部 P2 决策表。

主要性质包括请求和 Receipt 不变、一次逻辑效果、原 Receipt 优先于首次领域校验、当前选择和接受后的实际版本关联、最多一个未收束原请求、恢复不消费语义、仅启动或真实语义触发独立评估、最多三次自动技术重试、普通通知不触发评估、控制器直接模型成本为零。单独的间接唤醒见证允许合法 scene 事件成为自主 NPC 的信息源。

终态可停止新工作；撤权后不保证自动恢复。`Crash` 保留既有名称，但此处只表达易失控制器重建和一次启动扫描，不模拟完整进程重启中的代次提升，也不能解释为跨进程通知水位已持久化。`repeatable` 流仅隔离成功逻辑步骤的持久去重性质；真实退让导航可在依据变化后重新尝试，不在这一单效果抽象中。

### SceneFollow

位置抽象为有限区域与连接点。B 为客房与通道的闭集并优先于 U；`exit` 表示本人实际到达 C13。模型分离新提议、本人接受、领路者前行、本人步进、确认准备和确认提交。最多两份安排、一项失效事件，覆盖许可、双代次、地图、暂停及终态变化。

安全性质检查来源与起点分类、本人退出证据、全路径先验检查、当前执行关联、旧暂停安排不得自动复活、确认提交必须仍有效、arrived 尚未 settled 时继续检查领路者路线、安全成果保持。新的提议从实际当前位置重算退出状态。负控分别破坏 B 优先、用领路者代替本人退出、沿用旧退出标记、仅检查端点、先移动后校验、跳过当前围栏、自动恢复旧安排、接受旧确认回调、跳过 arrived 围栏。

## 历史产品反例与当前修正

### STD-001：无关资格变化使原 withdraw 失效，但没有新语义

`req-old9b-counterexample` 实际得到 `DecisionProgress` 反例：准备 withdraw → 领路者位置资格变化 → 该通知不相关 → 旧的全 guards 比较使原请求 Rejected → 原请求收束 → 持续 Running、未暂停且当前选择仍为 withdraw，但 Idle/pending=0 永久停滞。当前模型运行有 62 个不同状态，原始退出码 13。

`req-withdraw-return` 保留共同绑定和当前选择校验，只移除 withdraw 不依赖的位置资格，实际通过 274 个不同状态。`req-common-change` 与删除共同围栏的负控防止把“缩窄真实依赖”误解为无条件放行。这个有限对应与 `7f48f5f` 的动作依赖投影一致。

### STD-002：新 resume 被旧确定 Rejected 的准备 basis 缓存吞掉

旧阶段 `cb52c73` 的 `req-cached-rejection-counterexample` 实际得到 282 个不同状态、原始退出码 13；以下状态表属于该历史输入。当前细化模型保留同一旧缓存变体，仍产生原始退出码 13 的反例，390 个不同状态。两份输入和日志均保留，没有把旧失败改判为通过。

| 状态 | 动作与事实 |
| --- | --- |
| 8–9 | prepare withdraw 并返回，原 basis 固定 |
| 10–13 | Session 暂停；原提交 Rejected |
| 15–16 | 原 Receipt 已收束，控制器 Idle |
| 17–19 | 真正 resume；重复通知仍只留下 pending=2 |
| 21 | 正常 Evaluate，当前仍可 withdraw，却因相同旧准备 basis 返回 idle |
| 22 | Consume 后 last=2、pending=0 |
| 23–27 | 原 Receipt 重放保持 Rejected，没有新逻辑效果 |
| 28 | 在持续可运行条件下无限停顿 |

这说明 `SemanticProgress` 所表达的“水位最终被评估/确认”不足以证明合法决策完成；必须同时检查 `DecisionProgress`。历史失败对应独立生产探针中 observedSeq=181 的旧拒绝、seq=186 的 resume，以及最终 last=187/pending=0。955 的独立实测则报告原 Rejected 保持、较晚 resume 触发关联的新 Accepted；其报告与原探针摘要见 [identity.json](identity.json)。本任务仅读取这些外部证据，没有运行产品或业务测试。

旧阶段的最小抽象对照曾通过 766 个不同状态，它不承担 955 的实现证明。本轮在实际机制下检查如下配置，均启用 18 个安全性质以及 `DecisionProgress`、`SemanticProgress`，原始退出码 0、完成且队列为 0：

| 配置 | 具体交错 | 不同状态 |
| --- | --- | ---: |
| `req-resume-after-rejection` | 原请求 Rejected 收束后收到 resume，再准备关联的新尝试 | 1178 |
| `req-resume-before-read-late-input` | 入口捕获 0，resume 在实际读取前提交且通知已送达；等待分支保留新 pending | 1218 |
| `req-resume-late-delivery` | resume 已提交，但通知在读取后或返回后才到；窄 last 不过滤晚通知 | 2380 |
| `req-rejected-return-unknown` | 原 Rejected 已提交但返回丢失，恢复前收到 resume；先收束原结果 | 1070 |

后三个窗口均有独立可达见证，证明相应因果前缀和新尝试成功确实可达。所有通知允许重复与倒序；成功步骤、原身份、旧 Receipt 及关联新 attempt 的检查没有移除。

新增负控分别命中：扩大等待分支的消费界线、只把 last 错误推进到全读态、用恢复时 seq 覆盖原 Receipt 水位、用全局 seq 冒充已收到语义、跳过 Unknown 原恢复、关联错误的上一个请求。其中 `req-wide-last-counterexample` 得到 372 个不同状态的活性反例：即使没有先清 pending，过大的 last 仍会过滤之后到达的通知。它说明窄界线必须同时约束确认与旧通知过滤。

## 假设与未证明范围

请求活性要求授权、Running、未暂停最终持续成立，技术失败最终有限，原请求恢复最终能够收束，已提交通知至少一次最终送达。内部启用动作和首次通知使用弱公平；显式恢复及第二份重复通知不靠公平性强迫发生。两个 late-input 配置指定了一次真实 detach/attach 场景，只有这两个配置对该计划中的控制器重建增加弱公平；不是假设系统必然自行重启。自动重试耗尽和撤权配置只检查安全。外部输入是配置中的有限计划；没有证明无限高频噪声下的调度器公平性，也没有穷举任意多次连续 Rejected 的世界历史。

路线活性仅在 cooperative 配置检查：当前许可和版本稳定、领路者合作、整段几何安全、内部推进弱公平。adversarial 配置检查安全，不承诺玩家离线、反复改约或阻路时仍完成路线。

SQL 事务隔离、唯一索引、真实原文/摘要/nonce、授权及投影算法、完整动作分类、连续几何与碰撞计算、真实数据布局、HTTP/Socket、多进程通知可靠性、所有 NPC 的组合和模型供应商行为均未证明。可信内部输入的来源在源码中核对；公开注入、伪句柄及未来水位拒绝属于独立实现验收证据，不冒充 TLC 的权限算法证明。两个模型分别检查，未进行全产品精化或组合证明。独立模型复核为 `NOT_RUN`，本轮没有另起模型审查者。

## 复现

正常 clone 后只需本目录、仓库已有 `.agents/skills/worker-tla/scripts/run_tlc.py`、Python 3、Java 21 与固定 TLC jar；脚本不读取上述候选 Git 对象，不依赖私有包、工作区路径或业务服务。

本次实际使用 OpenJDK 21.0.13，`TLC2 Version 2.19 of 08 August 2024 (rev: 5a47802)`；jar SHA-256 为 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`。每项 BFS、一个 TLC worker、512 MiB、120 秒上限，最多并行两项；未使用约束、VIEW、对称归约或随机模拟。

```sh
python3 formal/adv001/scene-policy/verify.py \
  --jar "$TLC_JAR" --out "$SCENE_CHECK_OUTPUT" --jobs 2
```

`TLC_JAR` 指向上述固定 jar；`SCENE_CHECK_OUTPUT` 必须是尚不存在的输出目录。单项可加 `--profile req-cached-rejection-counterexample` 或 `--profile req-resume-after-rejection`。封装脚本退出 0 表示**所有预声明判据得到满足**，包括预期反例，不表示所有配置都无反例。

首次建模留下的字符串词法错误、受控场景窗口错误导致的死锁，以及初版汇总脚本误认活性目标，均是模型/工具错误。本轮旧 rewrite 负控出现字符串与 tuple 不同类型比较，修正时又出现 `=<<` 的词法错误；二者都不是产品缺陷。修正后先确认负控，再以最终模型哈希完成全部受影响请求检查。旧封存包、两轮失败及当前最终运行都保留；[evidence-manifest.json](evidence-manifest.json) 记录文件哈希和版本，[历史结果](history/stage1-results.json) 保持原身份。当前 Git 目录保留全部可恢复模型、配置、判据与复现脚本。
