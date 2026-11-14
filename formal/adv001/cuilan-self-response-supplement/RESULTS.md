# CS-R2 S1 补证真实结果与逐 MF 边界

日期：2026-11-14 UTC。mode=`check/design`；独立补证审查=`NOT_RUN`；implementation_status=`NOT_ASSESSED`。本轮总体形式结论仍为 **INCONCLUSIVE**，没有新的正常语义设计反例。没有运行业务/镜像测试、PG、Browser、真实provider、图片或公共写入。

固定来源：基础形式包77ace28f526ce9ad905b1842b7353e48e251423c/tree006fc92d3cd261bddf22f698871e44b6434be36e；设计R2 1a7f45ddfeca0d25fb3714e1ce45980b225d5bde/tree6b0130cd6838bf052504994527f05e29aabf521e；计划35d8759aac469eba5a8d9d4b94a787a3e62330c5/treed838c05f22b54601dc9f291df028975347850c47。只读IC为68d2ccb26237c2deb9640b0f2014600929d3feea/tree8f44905939a2cf083ff08196b957cc19064cee64，不能把PG2/2计为形式证明。

## 1. 清单与真实分类

运行前冻结54项，7项正向、31项安全负控、13项可达见证、3项时间负控。最终5项正向完成、2项未穷尽；全部47项负控/见证实际命中预声明目标，因此52/54符合预期，**不是52项正向PASS**。全历史61次运行：5 PASS、50 COUNTEREXAMPLE、4 TIMEOUT/INCONCLUSIVE、2 TOOL_ERROR。2次工具错误与来源版本修正重跑均保留，未洗去。原131项/178次/5项未完不在新统计内，字节与来源不变。

RUN_INDEX.json记录全部真实命令、启用性质、输入SHA、版本/指纹、结果/log/messages/manifest SHA、最终选择和全部历史。已重算所有历史input哈希、当前54项模型/配置传递依赖，均吻合；这只是证据对账，不是新的业务测试或模型运行。

## 2. 正向检查与超时

| 配置 | 结果 | generated | distinct | queue | 实际秒 |
| --- | --- | ---: | ---: | ---: | ---: |
| fence-subject | PASS_WITHIN_SCOPE | 2,045,964 | 228,522 | 0 | 22.596 |
| fence-requester-p1 | PASS_WITHIN_SCOPE | 1,174,545 | 124,812 | 0 | 13.472 |
| fence-requester-p2 | PASS_WITHIN_SCOPE | 2,082,070 | 231,969 | 0 | 23.403 |
| fence-performer | PASS_WITHIN_SCOPE | 1,512,660 | 164,712 | 0 | 17.186 |
| fence-shared | INCONCLUSIVE | null | null | null | 300.662 |
| returns-constructor | INCONCLUSIVE | null | null | null | 60.428 |
| transport-complete | PASS_WITHIN_SCOPE | 9,963 | 596 | 0 | 1.069 |

四个单actor配置都保留双用途、每用途旧新请求、两物、共享Restart/Resume/Terminal，只将允许变化的actor固定为C/p1/p2/W其中之一；它们不是多个actor先后变化的共享系统证明。共享配置允许四actor各变化一次任意顺序，未删危险窗口。传输正向596状态只覆盖合法完整payload的equality/整体赋值接口。

| 未完配置的日志下界 | depth | generated | distinct | queue | 解释 |
| --- | ---: | ---: | ---: | ---: | --- |
| fence-shared | 18 | 20,839,768 | 3,027,439 | 649,705 | raw143 / TIMEOUT；非终值 |
| returns-constructor | 8 | 63,671 | 12,522 | 6,450 | raw143 / TIMEOUT；非终值 |

共享300s是root在原60s实际增长后明确授权的唯一单项扩时，配置与共享模块字节不变；60s原记录保留。constructor先以旧来源版本表达运行60s未完，修正后仍按60s再跑未完；两份各自绑定实际输入。最后进度不是超时瞬间总数。1 worker / 单运行、TLC报告455MB heap/64MB offheap；未发现OOM，未测RSS，不推断资源原因。没有继续扩时。

## 3. 三项真正时间负控

| 配置 | 实际结果 | generated/distinct/queue | 实际末段与公平条件 |
| --- | --- | --- | --- |
| recovery-negative-both-purposes-progress | rc13，2116 Temporal properties violated | 16,752 / 5,081 / 0 | 原身份Reserve→提交前Unknown→原身份Recover→Commit→Consume错误清两用途pending→stutter；未完成purpose无Reserve enabled，原内部弱公平仍成立 |
| transport-negative-live-miss-same-slot | rc13，2116 | 1,669 / 166 / 0 | 新view已接收后，同slot世界变化未发新payload；最新Deliver不enabled，stutter；不声称网络有义务投递不存在的消息 |
| transport-negative-live-receipt-overwrite | rc13，2116 | 24,047 / 1,428 / 0 | 两人已收到seq2/view2，旧Accepted回写p1缓存；DeliverLatest修复后旧Accepted再次回写成循环；弱公平送达仍满足，最终一直当前失败 |

第一项沿原PersonalRecovery字节和LiveSpec，只移除会先拦截的PendingPurposesPreserved安全断言，其余六条安全性质仍启用；不是拿旧rc12冒称时间反例。正常BothPurposesProgress的15,984状态结果复用原R1身份，未重新执行或改绑；完整依赖见reused-recovery-evidence.json。另两项不强迫玩家/NPC配合，不给实际网络公平保证。以上都是时间性质反例，**不叫deadlock**。

## 4. 可达性与负控辨识

混合持有人见证从合法proposed初态产生7个状态：Accept旧private→p1取parcel→停止旧grant→p2新提议占槽→本人Accept新private→p2取letter。后态p1仍持旧parcel/return_only，p2持新letter/delivery_pending；旧取得身份未迁移。此NoReturnWitness反置实际rc12，18,136 generated / 4,312 distinct / 2,486 queue。新view与ownerRef-null的9状态见证到18,289 distinct；同slot两件实际持有和放回非delivered也都有实际rc12见证。

这些是世界状态可达性，不是constructor所有正常性质已穷尽。constructor的七项正常性质仍INCONCLUSIVE；参数化合法输入域、逐件构造代数关系及µA/µP动作帧在MAPPING.md明确，待独立复核其论证充分性。对原七个固定后态没有改写或提升声明。

控制见证实际覆盖W变化保留private、p1变化保留p2新private、双用途实际使用后Restart/Terminal停用、旧槽之后旧take Receipt、旧首次使用被拒，以及实际使用后两个actor相继变化。全部31条安全负控实际rc12，分别辨识类型、遗漏控制依赖、拆分停权、误全停、刷新proof、旧授权使用、重取、第一件吃掉另一件、取得迁移、控制搬物、Resume/Receipt复活、终态残留、返还漏项/泄漏/错来源/旧引用/伪ownerRef/错原处/漏额度、跨observer/旧seq/view/部分payload复制。

## 5. 逐 MF 可用范围和未闭合义务

| MF | 本轮可用事实 | 仍未闭合/模型外 |
| --- | --- | --- |
| MF-EFFECT | 四诊断有限图穷尽；控制依赖在proposal捕获、Accept比较、proof冻结；共同Restart/Resume/Terminal与旧Receipt有负控/见证；µA/µP及逐动作frame明确 | 四actor共享图300s未穷尽，11项安全性质的完整顺序交错仍未关闭。手工归纳/帧论证没有TLAPS或生产refinement，不代改PASS |
| MF-CUSTODY（EFFECT关联） | 双用途模型保留两物、唯一holder、原取得、逐request/item额度、owner/origin差别；实际mixed旧新取得可达；取得迁移/重复额度等负控命中 | constructor全域及共享多actor图未完；真实空间资格/数据库原子性/持久写入没有验证 |
| MF-RETURN/UI | 参数化完整元组/合法生成域/observer过滤已明文；真实双持有人、新view/null见证；transport安全+条件活性596状态穷尽；两项rc13敏感性 | constructor60s未完，不能称全部权威Observable已被机器证明映射。合法域保持/完整snapshot生成仍依赖明确手工动作论证；实际session/generation/连续seq缺口接纳和UI按钮/引用行为未作端到端精化 |
| MF-RECOVERY | 补齐BothPurposesProgress真正时间负控；原正常活性结果按原R1字节/身份复用；原身份、有限重试、两用途待办保留 | 新task必须由当前领域状态合法产生；实际scene水位/持久重启/通知接线仍需固定代码对应 |
| MF-CONSENT / TERM | 未重跑、未改写旧结果；本层Accept入口明确需严格identity/purpose/version/scope/single_use与本人资格 | 没有把这些独立组件自动组成完整实现证明；reusable与本人策略仍由原Terms/Consent范围处理 |
| MF-VERSION / SAFETY | 本轮不改变旧接口/主安全模型与证据身份 | 没有新增旧版本解释器/安全路线/连续几何证明，不从补证外推旧N1–N6/SP06产品PASS |

共享仍需解决的精确义务为：任意actor序列与Restart/Resume/Terminal同一行为下，GrantCurrent、AtomicEffects、ControlFrames、AuthorityUse、QuotaCorrect、CustodyStable、AcquisitionEvidence、ResumptionReadOnly、ReceiptReadOnly、TerminalClosed及TypeOK保持。已给的手工逐动作理由是可供审查的材料，不是机械闭合结论；不要求笼统增加预算。

返还仍需核定的精确义务为：所有相关权威后态落入声明合法Source域；该域上的SnapshotType、ReturnCompleteness、ObserverIsolation、AcquisitionIdentity、CurrentReferences、ReturnTargets、CompleteObservable保持；发送方对完整元组变化发新payload；真实客户端符合已检查的整体接纳/旧Receipt只历史条件。全缓存历史未重新穷举，旧5项INCONCLUSIVE保持。

## 6. 修正、保存与复现

来源版本修正：旧Row的lifecycleVersion误表达当前open/stopped/superseded分类，改为sourceLifecycleVersion，作为本次原取得(q,item)的不可变版本token；OriginalRows增加对应检查。R2 §13.2.1明确历史版本解释原经手来源；只读IC的changePersonalItem保存来源版本、projectPersonal读取持久字段。此修正只影响ReturnSnapshotOperators及依赖它的Cut，不影响独立SharedControlEffects；四个诊断正向的共享模块SHA完全相同。旧/新SHA和发生时点见RUN_NOTES，历史3份源码字节保留historical-inputs/<SHA>/。

工具链：TLC2.19 / rev5a47802 / 官方v1.7.4，jar SHA936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88；绝对路径和官方恢复URL见README。原runnerSHA在每run结果内，BFS、死锁检查，无CONSTRAINT/VIEW/对称归约/随机模拟。全部实际日志位于本工作树.agent-output/cuilan-self-response-supplement-20261114；报告/原始运行证据另保存，Git模型源码不重复装入证据ZIP。

本包不自行释放FM，不负责调度实现/合并/发布；独立review另由root安排。

## 7. 全部54项最终选择

| 配置 | 类别 | 实际分类/rc | distinct | 对应run |
| --- | --- | --- | ---: | --- |
| fence-subject | POSITIVE | PASS_WITHIN_SCOPE / 0 | 228,522 | matrix/fence-subject |
| fence-requester-p1 | POSITIVE | PASS_WITHIN_SCOPE / 0 | 124,812 | matrix/fence-requester-p1 |
| fence-requester-p2 | POSITIVE | PASS_WITHIN_SCOPE / 0 | 231,969 | matrix/fence-requester-p2 |
| fence-performer | POSITIVE | PASS_WITHIN_SCOPE / 0 | 164,712 | initial-corrected/fence-performer |
| fence-shared | POSITIVE | INCONCLUSIVE / 143 | null | shared-extension/fence-shared |
| fence-negative-type | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 12 | initial-corrected/fence-negative-type |
| fence-negative-miss-subject | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 13 | matrix/fence-negative-miss-subject |
| fence-negative-miss-performer | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 13 | matrix/fence-negative-miss-performer |
| fence-negative-split-appearance | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 32 | matrix/fence-negative-split-appearance |
| fence-negative-split-private | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 76 | matrix/fence-negative-split-private |
| fence-negative-overinvalidate | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 22 | matrix/fence-negative-overinvalidate |
| fence-negative-refresh-proof | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 13 | matrix/fence-negative-refresh-proof |
| fence-negative-stale-use | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 38 | matrix/fence-negative-stale-use |
| fence-negative-retake | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 152 | matrix/fence-negative-retake |
| fence-negative-first-closes-all | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 55 | matrix/fence-negative-first-closes-all |
| fence-negative-reassign | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 142 | matrix/fence-negative-reassign |
| fence-negative-control-moves | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 70 | matrix/fence-negative-control-moves |
| fence-negative-acquisition-evidence | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 142 | matrix/fence-negative-acquisition-evidence |
| fence-negative-resume | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 103 | matrix/fence-negative-resume |
| fence-negative-receipt | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 72 | matrix/fence-negative-receipt |
| fence-negative-terminal | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 13 | matrix/fence-negative-terminal |
| fence-witness-performer-isolation | REACHABILITY_WITNESS | COUNTEREXAMPLE / 12 | 44 | matrix/fence-witness-performer-isolation |
| fence-witness-requester-isolation | REACHABILITY_WITNESS | COUNTEREXAMPLE / 12 | 415 | matrix/fence-witness-requester-isolation |
| fence-witness-restart-dual | REACHABILITY_WITNESS | COUNTEREXAMPLE / 12 | 906 | matrix/fence-witness-restart-dual |
| fence-witness-terminal-dual | REACHABILITY_WITNESS | COUNTEREXAMPLE / 12 | 907 | matrix/fence-witness-terminal-dual |
| fence-witness-late-old-take | REACHABILITY_WITNESS | COUNTEREXAMPLE / 12 | 357 | matrix/fence-witness-late-old-take |
| fence-witness-old-first-rejected | REACHABILITY_WITNESS | COUNTEREXAMPLE / 12 | 72 | matrix/fence-witness-old-first-rejected |
| fence-witness-two-actors-after-use | REACHABILITY_WITNESS | COUNTEREXAMPLE / 12 | 2,909 | matrix/fence-witness-two-actors-after-use |
| returns-constructor | POSITIVE | INCONCLUSIVE / 143 | null | return-source-version/returns-constructor |
| returns-negative-type | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | null | return-source-version/returns-negative-type |
| returns-negative-omit-letter | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 53 | matrix/returns-negative-omit-letter |
| returns-negative-current-only | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 690 | matrix/returns-negative-current-only |
| returns-negative-leak | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 52 | matrix/returns-negative-leak |
| returns-negative-wrong-acquisition | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 690 | matrix/returns-negative-wrong-acquisition |
| returns-negative-old-view | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 225 | matrix/returns-negative-old-view |
| returns-negative-synthesize-owner | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 52 | matrix/returns-negative-synthesize-owner |
| returns-negative-wrong-origin | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 52 | matrix/returns-negative-wrong-origin |
| returns-negative-drop-quota | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 52 | matrix/returns-negative-drop-quota |
| returns-witness-mixed-holders | REACHABILITY_WITNESS | COUNTEREXAMPLE / 12 | 4,312 | return-source-version/returns-witness-mixed-holders |
| returns-witness-mixed-new-view-null | REACHABILITY_WITNESS | COUNTEREXAMPLE / 12 | 18,289 | matrix/returns-witness-mixed-new-view-null |
| returns-witness-same-slot-two-items | REACHABILITY_WITNESS | COUNTEREXAMPLE / 12 | 222 | matrix/returns-witness-same-slot-two-items |
| returns-witness-restored-not-delivered | REACHABILITY_WITNESS | COUNTEREXAMPLE / 12 | 223 | matrix/returns-witness-restored-not-delivered |
| transport-complete | POSITIVE | PASS_WITHIN_SCOPE / 0 | 596 | initial-corrected/transport-complete |
| transport-negative-type | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 6 | initial/transport-negative-type |
| transport-negative-wrong-observer | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 6 | matrix/transport-negative-wrong-observer |
| transport-negative-old-view | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 15 | matrix/transport-negative-old-view |
| transport-negative-old-seq | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 38 | matrix/transport-negative-old-seq |
| transport-negative-partial-payload | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 10 | matrix/transport-negative-partial-payload |
| transport-negative-receipt-overwrite | SAFETY_NEGATIVE | COUNTEREXAMPLE / 12 | 38 | matrix/transport-negative-receipt-overwrite |
| transport-negative-live-miss-same-slot | TEMPORAL_NEGATIVE | COUNTEREXAMPLE / 13 | 166 | matrix/transport-negative-live-miss-same-slot |
| transport-negative-live-receipt-overwrite | TEMPORAL_NEGATIVE | COUNTEREXAMPLE / 13 | 1,428 | matrix/transport-negative-live-receipt-overwrite |
| transport-witness-both-observers-current | REACHABILITY_WITNESS | COUNTEREXAMPLE / 12 | 335 | matrix/transport-witness-both-observers-current |
| transport-witness-late-old-accepted | REACHABILITY_WITNESS | COUNTEREXAMPLE / 12 | 75 | matrix/transport-witness-late-old-accepted |
| recovery-negative-both-purposes-progress | TEMPORAL_NEGATIVE | COUNTEREXAMPLE / 13 | 5,081 | initial-corrected/recovery-negative-both-purposes-progress |
