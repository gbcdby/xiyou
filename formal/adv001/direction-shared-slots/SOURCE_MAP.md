# D66-DS2 模型合同与源码导航

## 固定输入与结论边界

设计模式 `worker-tla/design`。正式合同为 [#66 D66-DS2采用记录](https://github.com/gbcdby/xiyou/issues/66#issuecomment-7000269439) 对应 r2 SHA `3f9286fb6896b4e346c2899db0705881b710e08fca0cd0512eac2f0ae35e0800`。初次只读源码调查读取的是 d51 历史版本，direction-intent.ts 为6607B/94e1f456，仍含旧同intent guard。随后root并行应用已采纳的一行删除；本作者冻结 core-r1-snapshot.json 时记录的已是6558B/e31fabd4交付候选，不能把该快照误称为历史94e版本。正模型按已采纳合同及这一行差量取消同intent串行；其它源码字节和导航行号保持。此处是设计边界与精确身份说明，不冒称形式化源码精化或非作者实现独审，**implementation_status=NOT_ASSESSED**。

- 历史 d51 direction-intent.ts（初次源码读取）：6607B / SHA `94e1f456de1a619c8865edb764b7e64aea7b8e6500001bff3d6a22d2547bb338`，available含旧同intent guard。
- 交付快照 direction-intent.ts（core-r1-snapshot.json 实际记录）：6558B / SHA `e31fabd4b41d3e522c62ae02f104094d5be46925fb8808e946ab9aabb1f2462b`，已删除该guard，line79位置不变。该快照不是历史d51完整源码快照。
- 原 spatial-session.ts：47061B / SHA `a0491042133d9135009e06ddac6662d0ec9753d7a6f084e1b183207eef29333f`。
- 原 spatial-direction.ts：5466B / SHA `c44f0a991fa5fc71be06e16174b8f31f6b5c256c332fc9d4bf5affb488858e90`。

全部源码导航相对仓库 `frontend/src/`；上述一行差量不改变导航行号。spatial-session/spatial-direction 两份哈希在初读和交付快照间一致。已编制的模型、配置与manifest由root独占执行；本作者没有运行Java/TLC或应用测试。已有四个超时原件保持INCONCLUSIVE；当前入库准备包仅汇总25个已结束记录，两个正profile的新完整探索结果仍由root填写RESULTS.md。

## 状态／动作映射

| 真实责任与代码位置 | 模型状态／动作 | 原子性及保留边界 |
| --- | --- | --- |
| domain/direction-intent.ts:18–22、72–104 局部Map、generation/intent、latest及速率字段 | `ctrl[c]`、`req[r].owner/generation/intent/local`；`Send` | `local`只是该实例原Promise entry。旧entry不因clear消失。发送时读取当下唯一vector；实例token与global ledger不同。 |
| domain/direction-intent.ts:28–45 set/null/clear | `Input`、`Release`、`ClearState` | 新明确意图可覆盖最新值；两槽满时不创建原身份。clear改代次/清向量但不重置token、不删local或ledger。 |
| domain/direction-intent.ts:72–94 due、100ms/2token、局部400ms优先 | `CanSend`、`Tick`、`LocalDeadline`、`OriginalDeadline` | Tick只推进离散时钟；局部调度发现当前代次entry到due时先halt。全会话准入不偷加age检查。小数token与真实timer误差不在有限模型内。 |
| domain/direction-intent.ts:95–104 catch/then/finally | `Capture → Handle → Finally` | 结果捕获、对当前代次的handler、释放原entry分开，允许其间clear/换绑定。旧Rejected还必须满足latest-id及当前intent；旧Unknown与账本冻结另分。 |
| domain/direction-intent.ts:47–70 halt、独立stop、stop deadline/finish | `HaltState`、`IssueStop`、`StopDeadline`、stop的`Handle/Finally` | stop不等两move。普通全松允许stop后接受已明确输入；Unknown/旧代次不能恢复已取消vector。网络自动stop用owner=0，表示没有DirectionIntent.stopPending所有者。 |
| network/spatial-session.ts:86–98 绑定改变、新controller | `Bind/InstallState`；Unknown原Receipt的`RenewState` | 两个真实构造实例各有局部Map/token。旧实例仍保留其异步entry；global原身份及原due保留。超过配置实例上限时明确mustBind停在人工边界，不复用旧实例偷丢状态。 |
| network/spatial-session.ts:102–115 原draft更新、Unknown冻结、查询后空意图重建 | `ApplyOutcome`、`LedgerUnknown`、`Query`、`Response` | 有效Receipt只收原ID；已定案原身份不降回Unknown。查询能先释放ledger资格，而旧网络Promise仍pending。Unknown会清当前意图；查询本身不恢复键值。 |
| network/spatial-session.ts:125–161 跨绑定2 move/1stop、覆盖序号、每原draft due | `SessionAdmission`、`UnresolvedMoves/Stops`、`NeedsStop`、`LedgerDeadline` | waiting/unknown都占原身份；Unknown/未决stop禁止新move。deadline固定原发送+4tick；到期任务可晚派发，ACK先/timeout先都允许。stop序号仅同controlEpoch内比较。 |
| network/spatial-session.ts:323–364 最终send guard、原串追加及Receipt身份匹配 | `Send`与`Response/Query`、`ReceiptIdentity` | 将首次await前同步段视为一步，未把guard提前到Init或全局约束。`omit-global-guard`变体同时漏掉controller与send的全局检查，第三身份可达。 |
| network/spatial-session.ts:427–453 ready/recover/sendDirectionIntent | `ReadyInput`与`Input`、`Capture` | 新明确输入先重查原ledger；恢复不凭较新成功吞掉旧Unknown。`Capture`从当时原draft状态取得结果，不直接把ACK消息当最终local结果。 |

同步`#update`中的通知和调度、以及`Input`后的`Send`被表示为随后可交错的模型动作，以覆盖回调/输入顺序；真实`set()`在具备准入时会同步schedule/tick，模型允许额外交错。这是有说明的安全过近似，不构成逐行JS任务队列精化证明。独审指出已实际出现的`negative-old-generation`最短模型反例为Input→Release（尚未Send）→stop Unknown→clear→旧stop handler误改blocked；不能把该轨迹称为真实源码可重放，灵敏度结论只限模型。有效服务端Receipt对同一身份结果一致是环境假设；错误/无收据以Unknown表示，不模拟服务端业务或欺骗性假Receipt。

## 需求—性质—区分力

| 模型义务 | 设计对应 | 正性质／独立见证 | 负控 |
| --- | --- | --- | --- |
| DS2M-01 局部与会话容量分离 | DS2-01、05 | LocalMoveCapacity、SessionMoveCapacity；two-same、cross-binding、ledger-reuse | negative-session-capacity；旧guard缺席配对 |
| DS2M-02 原节奏与预算 | DS2-02 | PerInstanceBudget、SameIntentCadence | negative-clear-budget、negative-cadence |
| DS2M-03 单个最新意图与释放后选择 | DS2-03 | LatestIntentOnly；latest-release只展示满槽后W，不展示满槽后S→W | negative-latest-intent |
| DS2M-04 原截止不可延期 | DS2-04、05 | OriginalDeadline、LocalDeadlineFirst | negative-old-deadline |
| DS2M-05 较新成功不吞旧Unknown | DS2-04 | UnknownFreezes；old-unknown只展示两状态共存，实际旧Unknown先到 | negative-unknown-freeze |
| DS2M-06 旧同intent拒绝不误停 | DS2-04 | ObsoleteRejectIgnored；same-reject实际先旧Rejected/Handle、后新Accepted | negative-same-intent-latest-id（一次输入，排除旧intent较弱反例） |
| DS2M-07 clear/旧代次不污染或复活 | DS2-04、05 | OldCallbackIsolation、NoCallbackResurrection、ClearRetainsLocal、CallbackOwnRelease；原old-finally为stop，加强old-move为自身halt后move释放 | negative-old-generation |
| DS2M-08 独立stop及同epoch更高seq | DS2-05 | SessionStopCapacity、PendingStopBlocks、StopSequenceCoverage；stop-with-two实迹为S/E异向＋Unknown自动stop | 未单独变异stop序号；正性质与存在见证覆盖，敏感性缺口明确保留 |
| DS2M-09 原ID与真实收据 | DS2-05 | OriginalIdentity、ReceiptOnlySettlement、ReceiptIdentity；query-before-return | negative-receipt-id |
| DS2M-10 有限类型与非空行为 | 全部 | TypeOK；各独立可达性探针 | TypeOK不包含容量限制；空初始或没找到见证不能当通过 |

没有 temporal property。LatestIntentOnly 是“若实际发送，则发送当前最新”的全称安全性质；latest-release只要求确有一条满槽→真实释放→发最新的轨迹。它们**没有证明永久外部失败下进度**，也不证明任意公平环境下最终发送；如验收要求这样的活性结论，必须另明确最终callback收束/真实调度/不被新输入撤销等环境前提并返回建模，不能把当前存在见证升级为活性。

## 未覆盖与人工约束

1. 一tick为100ms；同tick仍允许多个不同意图及乱序回调，但没有50ms分数token的数值精度。只维持完整tick预算和原due。真实30/60/120Hz等效、180ms同向nextAt及400ms边界由实现针对测试独立核验。
2. 两实例在同controlEpoch内；跨epoch fencing、旧能力ContinuousDirection、原wire验证、服务器36/180动作和PG/呈现/完整history不在本模型内，均不能因该有限模型通过而省略原合同。
3. 有限请求/输入/clear/实例/时间上限逐profile列出。stop发出后永远无Receipt、原deadline晚派发、外部永久不回调均可停顿；关闭死锁只承认这些环境与探索终态，不提供进度证据。
4. 各现有profile最多3个原身份；没有完成“E1/E2两同向→释放→W→独立stop”需要4个身份的合成trace全状态检查。当前共享、释放、stop、Unknown与跨绑定义务分面覆盖，不拼成4身份合成证明。
5. root任何实际失败/timeout和相应原件须保留。seen投影只减少无业务反馈的历史标签；其原20性质中的TypeOK含seen子项已单独论证闭包，Never见证继续使用原模型，不能在投影上跑成“不可达通过”。

## 已收到实际结果的窄解释

root报告9个负控已命中目标，独审已核对应性质；最终统计/身份仍以root原result为准，本文不冒充执行者。旧同intent负控最短反例中的E2仍是waiting，证明latest-id guard必要；不能把该反例写成“较新Accepted后旧Rejected”。较新Accepted先、旧Rejected后的严格先后由root已有针对单元证据承担；本次same-reject最短见证先处理旧Rejected，随后才收到新Accepted，不承担该严格先后。本页不承载完整执行结果；本包已收录的有限结果见README.md与EVIDENCE_INDEX.json，最终结果由root填写RESULTS.md，本页不将源码导航写成模型通过。

## 映射r2的身份纠正

本r2仅纠正开头对core-r1-snapshot源码身份的错误引用。旧映射 `contract-source-map.md` 9238B / SHAf30c731931623ac9ce8c1819611283c4d7825fbdb85b1d1e23086d40c445db31 保留原字节；未改TLA、cfg、任何实际运行或其结果。本仓库SOURCE_MAP据此r2整理；仅将执行结果的临时待填措辞改为README/RESULTS索引，业务映射与范围不变。

## 仓库路径说明

本文提到的core-r1-snapshot与历史映射文件名是原私有证据身份，不是当前仓库的运行依赖。原文件由root保留；入库位置、模型分根和实际运行清单的区别见README.md与EVIDENCE_INDEX.json。

## 实际见证资格纠正（入库准备r2）

本次指定Never谓词均被实际命中，old-guard缺席配对也完整完成；这不自动证明名称暗示的严格先后。安全20性质与原合同义务未变，下面只限定真实存在轨迹的证据。

| 原profile | 已观察到的前缀／资格 | 不能扩大为 |
| --- | --- | --- |
| witness-old-unknown | 实际原前缀：id1先Unknown，随后id2Accepted，最终旧Unknown与较新Accepted共存。不证明较新Accepted先到。 | 较新Accepted先、旧Unknown后 |
| witness-same-reject-ignored | 实际原前缀：id1先Rejected并Handle，随后id2Accepted；旧拒绝未误halt。不证明较新Accepted先到。 | 较新Accepted先、旧Rejected后 |
| witness-stop-with-two | 实际原前缀：两未决move为S/E异向，Unknown触发自动stop；证明独立stop与两个move共存，不证明两同向全松stop。 | 两旧同向全松触发stop |
| witness-latest-release | 实际原前缀：两个初始Input发生在E/E发送前；两同向满槽后仅改W，真实释放后发W。不证明满槽后先S再W。 | 满槽后先S再W两个输入都已展示 |
| witness-old-finally | 实际原前缀：旧stop finally，local一直FALSE；本原profile不承担旧move entry从TRUE到FALSE的释放资格。 | 旧move local entry释放 |
| witness-old-move-finally | 加强profile实际前缀：唯一move自身最新Rejected的Handle触发halt，之后Finally令该move local从TRUE到FALSE；clears=0/current=1，不是外部clear或bind的见证。 | 外部clear或绑定后旧move释放 |

严格“较新Accepted先／旧Unknown或Rejected后”、“两旧同向满槽后S再W”、“全松触发独立stop”与外部clear/bind的针对顺序归root已实际完成的69项单元／session测试；本包不把那些测试结果升级成TLC见证，也不声称现有最短前缀已展示这些严格顺序。

加强old-move仅新增原模型上的R=1/I=1存在探针配置，主模型c50、Probes及20正安全性质不改。它排除了stop冒充move entry释放的资格问题；实际命中由唯一move自己的最新Rejected Handle触发halt，随后旧generation Finally使local TRUE→FALSE，clears=0、current=1。该见证的378 distinct和1.82094秒不是全状态安全穷尽。旧stop命中原件保留，不再承担move释放证据。
