# RPC/publisher 竞态增量：有限模型检查报告

## 结论与身份

**模型结论：PASS_WITHIN_SCOPE。** R2 的9个正向配置均启用18项安全不变量并完成穷尽遍历，24个定向负控均产生目标具名性质的真实反例，11个存在性见证均实际到达指定终点。业务实现为 **NOT_ASSESSED**；项目测试 **NOT_RUN**；活性 **NOT_CHECKED**。总控仍需对冻结候选独立复审并决定设计采纳。

本结论只属于 [RpcRace.tla](model/RpcRace.tla) 和 [verification.json](verification.json) 的有限参数，不能升级为任意规模、源代码refinement、真实SQL/adapter或性能通过。正式索引为 [results.json](results.json)，合同和映射为 [CONTRACT.md](CONTRACT.md)，实现方义务见 [HANDOFF.md](HANDOFF.md)。

| 对象 | 固定身份 |
|---|---|
| 业务源码基线 | `bb66dac423a7a306752a7474eabc95d7d4d9edb7` |
| 业务源码tree | `deccc2600f3703f4b158f9b7ef5505680c557f0e` |
| R2模型 | `c8ba941940e555b21071cb6156085e440660664d214fc9c9506b9726e2f028b4` |
| R2运行manifest | `e0bb2289eda2ea6b5d0904fdeb2e9aa705cc1376804a4ea6079d45a1adf03a82` |
| 设计r1 | `f9fee487ebcc60a601a29dfc8c9e5ff8ce8f3a5681cc95173608fb0235bbd98d` |
| 总控独立设计审查r1 | `129a0878c2000b00d6651dff0ac6e8610a1149ee1b100df4a59f146fcfdb1136` |
| 最终44次原始归档 | `ad24914db17497210095dc76aab6af7d076ae187c69580d83e598274837025fc` |
| 历史43次原始归档 | `0823656b9d0dee5404d829f1d87195a9ad11230911e5a51d790b7211f1feaa0c` |

原设计、原审查及其manifest保存在 [inputs](inputs/)；原件不覆写。已对 [project-profile.json](project-profile.json) 中24个源码输入逐个核对工作树SHA与基线Git blob，结果见 [source-audit.json](inputs/source-audit.json)。该身份核对不等于实现证明。

## RRS-DESIGN-01 如何补齐

旧 `WaveProgress.ReturnRPC` 不更新sent，旧 `RPCBoundary` 将旧RPC统一限制在ceiling内，因此不能拿原模型的通过证明新增RPC进展。新合同把history和race明确分开：history保持原R与ceiling；只有R=A、准确前置publisher、同V真实proof使S>A的race，才在原R完整授权后从S读原固定Q内下一页。

本模型在同一状态空间加入RPC实际送包与sent更新、等待W覆盖/结束、旧P逐行G锁内重核/UPDATE/COMMIT/结束。原P固定为已提交行{1,2}；新head3/4绝不补进原P。初始W0映射到 `publishPending` 首次owedProgress=false且头未覆盖时先进行的供给；W0结束后才开始已covered row1的G，后继W1可在G1在途时排队。两个W不同时活动。

关键组合见证 `witness-race-wave-covered-g-settled` 的原始31状态，按TLC状态号：

| 状态 | 实际切点 | 可观察值 |
|---|---|---|
| 3 | RPC入场 | 原R=1、A=1，前置为job1 publisher |
| 7、8 | 初始W0真实发送并结束 | push1→2、sent=2；W0随后settled |
| 11、12 | 原RPC完成固定Q授权读并提交 | mode=race、from=2、through=3、Q=3 |
| 13、14 | G1入场、后继W1排队 | W1冻结target=3，此时sent仍2 |
| 15、16 | RPC真实ACK并结束 | ACK2→3、sent=proof=3；RPC随后settled |
| 18、19 | W1判定covered、自然结束 | 两个不同动作；未制造第二次送包proof |
| 20–24 | G1原事务 | 取排他锁、重核、UPDATE、COMMIT、settle |
| 25–30 | G2原事务 | 入场后同样完成锁/重核/UPDATE/COMMIT/settle |
| 31 | owner返回 | publishedRows=actualRows={1,2}，W0/W1/G均已settle |

该轨迹终点client仍为1、wire中仍有两个包，清楚区分了服务器真实入队与客户端确认。客户端正常顺序应用由另一个实际16状态见证 `witness-race-applied` 展示：applicationLog包含job1的1→2和job2的2→3，client=3，每个前缀仅一次。两个见证不是把两个独立模型拼接成组合证明；同一正向模型的安全检查覆盖所声明的全部交错。

因此本包给出**有限范围内关闭RRS-DESIGN-01的候选证据**。旧W-12/RG-08的具体替换及未改部分已列于合同，旧模型/旧64项原件保持原样。设计采纳与后续业务释放归总控。

## 实际运行与边界

固定工具为TLC2.19 / v1.7.4，官方jar SHA `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`；固定runner SHA `ca5811a8cae5d31961185b0ba53868f3ea885a1ee614150d873d61044ff18f5a`；OpenJDK21.0.13，BFS、单worker、768MB，每配置预算120秒。未使用状态约束、action约束、VIEW、symmetry、随机模拟、Java override或公平性。

最终44项于2026-11-17 14:12:25.993113至14:14:24.007334 UTC顺序运行；每项原始命令、时间、配置、工具版本与输入快照都在归档中。无超时或中断。上述时长仅是本地TLC执行事实，不是产品性能数据。

每配置默认只有一个handle/link、5种有限任务角色、完整事务前缀1..3；identity配置允许一次换view或新link，page-two扩至1..4/页2。PageSize表示抽象完整事务前缀数量，不证明实际event数256、首超大事务回退或轨迹字段。原R的多个具体授权条件被合并为模型守卫，SQL共享/排他语义与真实adapter完整DTO一次性proof是外部接口假设。

所有配置在运行前声明minimum_distinct_states=2；实际正向最少432、最多72,013 distinct。低于声明下限或没有目标反例均不会接受。死锁检查明确关闭：有限输入用尽、无fresh需求、永久网络延后等允许停滞。本包不宣称自动恢复、无限输入或公平调度下活性。

## 9个正向配置

各配置均为 `PASS_WITHIN_SCOPE`、TLC rc=0、completed=true、remaining_states=0；全部启用合同列出的18项不变量。

| 配置 | 范围 | generated | distinct | 剩余队列 |
|---|---|---:|---:|---:|
| `positive-race` | 同V、R=A、前置publisher | 6,669 | 2,856 | 0 |
| `positive-history` | 入场已旧 R=1、A=2 | 16,093 | 7,142 | 0 |
| `positive-predecessor-rpc` | 前置RPC及ACK超时，owner detached | 720 | 432 | 0 |
| `positive-consumer-rejection` | 先行push拒收，页2 | 23,853 | 10,402 | 0 |
| `positive-identity` | 一次同link换view或新link、pending | 175,915 | 72,013 | 0 |
| `positive-failure` | 撤权、closing、读提交未知、发送失败 | 118,043 | 46,338 | 0 |
| `positive-ineligible` | FullCap=false，不授予race | 6,969 | 2,966 | 0 |
| `positive-future-request` | 入场R超前，执行时仍按原守卫 | 6,369 | 2,746 | 0 |
| `positive-page-two` | MaxHead=4、PageSize=2完整前缀页 | 14,717 | 6,198 | 0 |

9项合计generated=369,348、distinct=151,093。这是不同参数配置的计数之和，不能当作单一、互不重叠的大状态空间。

## 24个定向负控

每项均保持runner原状态 `COUNTEREXAMPLE`、TLC rc=12，实际消息2110精确命中表列性质；不是启动、语法、超时、死锁或其它性质失败。每个配置只注入一个具名故障并启用所列目标。24项覆盖了全部18项正向性质的敏感性。

| 注入Fault | 实际违反性质 | 注入变更 | distinct |
|---|---|---|---:|
| `type` | `TypeOK` | head被写为0 | 5 |
| `parallel-lane` | `LaneDiscipline` | 等待RPC错误地立刻成为active | 3 |
| `bypass-rpc` | `LaneDiscipline` | publisher越过已等待RPC | 148 |
| `skip-original` | `OriginalAuthority` | 原R低于安装下界仍构造读取 | 113 |
| `upgrade-old` | `RaceEligibility` | 入场已旧R<A也授予race | 104 |
| `upgrade-rpc` | `RaceEligibility` | 前置RPC也授予race | 71 |
| `force-full` | `RaceEligibility` | 不合格能力也授予race | 113 |
| `fake-proof` | `RaceOrigin` | 无真实wire事实却推进sent | 79 |
| `head-start` | `ReadBoundary` | 内部from取head而非真实sent | 140 |
| `partial-overlap` | `ReadBoundary` | race从原R开始并越过当前sent | 113 |
| `fake-proof` | `SentPrefix` | 无真实wire事实却推进sent | 17 |
| `overwrite-installed` | `InstalledSeparate` | 发送写入installed | 17 |
| `stale-send` | `NoStaleSend` | 旧候选借新key实际发送 | 136 |
| `head-after-read` | `FixedAuthorizedHead` | 候选through追读后的新head | 22 |
| `double-apply` | `ConsumerSafety` | 一次接受将前缀应用两次 | 25 |
| `skip-gap` | `ConsumerSafety` | 跨不连续from强制应用 | 460 |
| `defer-consumer` | `SynchronousConsumption` | 先行push应用延后，后ACK出现空洞 | 603 |
| `read-through-writer` | `LockExclusion` | 授权共享读穿过G排他锁 | 182 |
| `early-g` | `ProgressCut` | 下一G在W未settle时入场 | 562 |
| `early-owner` | `OwnerSettled` | owner提前返回，初始W0尚未settle | 18 |
| `cancel-sql` | `NoCancellation` | 未结束SQL被写作result | 33 |
| `start-after-stop` | `NoNewAfterStop` | 停止后仍排入新W | 415 |
| `timeout-self-demand` | `NoTimeoutSelfWake` | ACK超时自行制造fresh需求 | 460 |
| `unchecked-g` | `ProgressCut` | G跳过锁内pending重核 | 2,768 |

其中初始W0收束负控只有3个轨迹状态：Init中W0仍sql，Close发生，故障FinishOwner立刻done，实际命中OwnerSettled。G重核负控在G1已queued后发生BeginPending，再取锁、跳过重核而提交row1，实际命中ProgressCut。timeout自唤醒负控在没有ExternalFresh时把ignoredAck与demand同时置true，实际命中NoTimeoutSelfWake。它们分别针对总控复审提出的具体边界，不能用运行退出码替代这些语义事实。

## 11个存在性见证

见证以“尚未到达终点”的否定式作为invariant；TLC找到反例即说明存在到达路径。下表原状态仍是 `COUNTEREXAMPLE`、rc=12，不能改标成模型安全PASS或活性保证；remaining_states非零是发现终点后正常提前停止。

| 配置 | 实际命中否定性质 | 轨迹状态 | distinct | 原轨迹终点事实 |
|---|---|---:|---:|---|
| `witness-race-applied` | `NotRaceApplied` | 16 | 664 | push1→2与race ACK2→3均实际应用，client=3 |
| `witness-history-applied` | `NotHistoryApplied` | 15 | 371 | 原RPC history1→2实际应用 |
| `witness-rpc-predecessor` | `NotRPCPredecessor` | 13 | 111 | 前置RPC后原RPC仍history1→2并settle；此见证不声称客户端已应用 |
| `witness-rejected-push-recovered` | `NotRejectRecovered` | 23 | 2,277 | push1→3拒收，空race ACK3→3拒收，fresh history1→3实际应用 |
| `witness-timeout-recovered` | `NotTimeoutRecovered` | 24 | 2,274 | race ACK2→3忽略，ExternalFresh实际发生，history2→3实际应用 |
| `witness-old-view-discard` | `NotOldDiscard` | 4 | 45 | 同link key0/0→0/1，旧任务读结果被拒绝 |
| `witness-late-old-link` | `NotLateOld` | 14 | 5,651 | 新link2→3先应用，随后真实收到旧link包而忽略 |
| `witness-race-wave-covered-g-settled` | `NotWaveCoveredGSettled` | 31 | 2,759 | RPC2→3真实推进；W1 covered并settle；两G实际提交且owner done |
| `witness-commit-before-settle` | `NotCommitBeforeSettle` | 13 | 334 | G1已COMMIT、未settle，W1已queued |
| `witness-stop-drained` | `NotStopDrained` | 19 | 13,781 | closing后W0/W1及已开始G均settle，owner done |
| `witness-timeout-without-fresh` | `NotTimeoutWaiting` | 15 | 516 | ACK忽略、client2<sent3；无ExternalFresh/demand/recovery |

拒收恢复见证的BFS最短路径选择了publisher先1→3、race ACK为空3→3。ACK仍因from与当前client=1不连续而拒绝；由拒收push产生的一次fresh请求从1走history，job4真的应用1→3。这条见证证明拒收后的完整历史恢复，不另声称该路径的新ACK贡献正推进；正推进由race-applied和W/G组合见证实际展示。拒收正向配置检查的是该有限空间所有交错，不仅这条最短路径。

超时恢复见证在状态17明确执行ExternalFresh，状态24才到达history2→3应用完成。另一条15状态等待见证保留ignoredAck=true、client=2<sent=3，但externalFreshUsed/demand/recoveryUsed均false。超时本身没有制造请求；ExternalFresh是可以永不发生的外部动作。前置RPC的见证只证明保持history并settle，终点还没有消费ACK，不冒称实际客户端恢复。

新link见证在新link独立供给2→3已应用之后才接收旧link包，旧包没有修改当前cursor或applied账本。同link换view的4状态见证则实际取key0/0→0/1，旧读结果被拒绝。这些不证明完整绑定安装子协议；合法安装及快照基线被当作环境输入。

## 历史失败和复审修正

历史归档保留43次原件，未计入R2的44项通过范围：

1. explore-01真实返回 `TOOL_ERROR / TLC_REPORTED_ERROR`、TLC rc=150。FinishOwner合取/析取缺少括号导致语法优先级错误；未生成状态。这是模型语法错误，不是业务反例。
2. explore-02修复解析后单次positive-race完整结束（2,856 distinct），但先于后续资格/身份见证收紧，不能替代当前模型结果。
3. batch-01包含41次R1运行。其模型SHA为 `8699cf50662301e12af1460d11272c732f1a255adccfacb7ae8785fe0c41911b`，manifest SHA为 `99c21a46893033cd14cd36b13713c0fc4a7052330704ade385d9e38ab232d020`。运行本身达到当时预声明目标，但总控静读指出timeout不应直接制造fresh，以及关闭时必须等待初始W0自然结束；R1因此被替代。

R2将ExternalFresh分离且可选，增加NoTimeoutSelfWake及其定向负控/无fresh等待见证；同时让FinishOwner与OwnerSettled等待W0，明确W0/W1和原P来源，前置RPC配置不启用publisher owner组合，增加G锁内pending重核负控。R2的所有44项均使用当前固定模型与配置快照，未挪用旧通过结论。没有被省略的超时或取消记录。

## 原件与复核

[final-records.tar.gz](evidence/final-records.tar.gz) 包含44次完整TLC日志、messages、result、manifest、所有输入快照、批次runner stdout、原汇总以及固定runner源码；[history-records.tar.gz](evidence/history-records.tar.gz) 保留上述43次历史记录。原始JSON中的执行绝对路径仅作为历史事实保留，正式文档导航均指向本目录产物。jar和可重建states/runtime-home/tmp不入版本库；固定jar SHA、工具版本和全部命令保留，原本地运行目录也未删。

[results.json](results.json) 对每个原件登记字节数/SHA、实际退出码、状态数量、模型/manifest身份、目标消息与轨迹状态数；[artifact-manifest.json](artifact-manifest.json) 固定包内文件身份。[trace-digest.json](trace-digest.json) 是关键轨迹的派生阅读辅助，原messages/TLC日志优先。

运行 `python3 formal/adv001/direction-supply-rpc-race/audit.py` 可只读核对归档、每次输入快照与当前model/config、9/24/11分组、18性质负控覆盖、目标错误码和历史原件完整性，不启动TLC或项目测试。复跑方式见README；默认必须显式选择配置，不自动扩展矩阵。

## 未覆盖与返回条件

本worker没有编写业务代码/项目测试，没有启动PG、Socket、浏览器或ffmpeg，没有远程写入。源码实现对应关系未被执行验证，动态验收、官方CI和normal/late/five真实结果仍由总控安排。

未覆盖任意多peer/5+1完整组、无限W/G/RPC流量、全部旧模型状态乘积、全量关闭/重启恢复、实际授权项和SQL隔离、实际256数据/超大事务、BigInt/JSON、8页预算全部边界、运动/Canvas或性能。未知读提交只建模为不发送、不推进、自然结束；G提交响应未知等更广旧协议分支沿原合同，本增量不重证。

若实现改变当前模型的sent写点、同handle串行性、准确入场前置、原R授权、consumer连续性、proof、固定Q或原P/W/G完成切点，应返回形式化设计；这些不是实现可随意调整的细节。RRS-DESIGN-01在有限范围内已有明确候选闭合，是否最终采纳仍由独立总控审查决定。
