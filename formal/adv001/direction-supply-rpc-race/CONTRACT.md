# RPC 与前置 publisher 竞态：有限增量合同

状态：**拟议合同，等待总控采纳；业务实现 NOT_ASSESSED**。任务为 [#66](https://github.com/gbcdby/xiyou/issues/66)。输入是设计 r1（SHA `f9fee487ebcc60a601a29dfc8c9e5ff8ce8f3a5681cc95173608fb0235bbd98d`）及独立设计问题 RRS-DESIGN-01。基线为 `bb66dac423a7a306752a7474eabc95d7d4d9edb7`，tree `deccc2600f3703f4b158f9b7ef5505680c557f0e`。

本目录在一个有限状态模型中同时表达入场资格、授权读、实际入队、消费者、有限 W 与原固定 P 的 G 收束。它不是原三个模型各自通过后的组合推断，也不是源码 refinement 或性能证明。实际结果见 [REPORT.md](REPORT.md)。

## RRS 的唯一行为变化

原请求游标为 R，入场该 binding 真实 sent 为 A，准确前置活动任务为 P，执行时当前 sent 为 S，授权事务固定头为 Q。

只允许已具完整能力的同 handle/current V、`R=A`、前置 P 为 publisher、其真实 push/proof 使同 V 的 `S>A` 的 RPC，在原 R 的全部授权及安装下界检查后，把内部有效读取起点设为 S。`from=S`，后续完整页仍由原固定 Q 与原提交边界算法生成。此字段只在服务端内部存在，不改协议 DTO。

请求入场已经落后、前置是 RPC（包括客户端超时的 ACK）、未真正推进 sent、能力不合格、换 V、pending/closing/scope 不再 current 的情况，不能借此取得新资格。原本排队时游标超前但执行时已合法的请求，继续执行时判断，不因为本改动提前拒绝。

原 R 的 access、schema/capability、session/actor、持久 binding、createdAtSeq、epoch/active connection、terminal/live connection 检查必须先完成。不得先把原请求改成 S，再用合法 S 掩盖非法 R。内部 S 还须核为事务内当前 V 的真实 sent，并与旧 throughSeqCeiling 互斥。

RPC 仍占原活动槽、优先于等待 publisher。只有完整真实 packet 的一次性证明，以及发送前后 current 检查成功，才能推进 sent；installed cursor 不动。旧历史页可重复发送但不裁掉部分重叠或伪造新前缀。无候选、未知提交或发送失败不复制旧 proof、不补第二次隐式读、不假取消原工作。

## 对旧条款的精确替换

| 旧对象 | 本增量拟议替换 | 保留范围 |
|---|---|---|
| `direction-supply/SUPPLY_MAP.md` 的 SentPrefix | history RPC 维持旧 ceiling；符合 RRS 的 RPC 在原授权事务内从真实 S 续读 | 真实入队水位、installed 分离、当前 binding、完整 DTO/proof |
| `direction-supply-parallel/HANDOFF.md` 的 PS-04 / OldCursorCeiling | history 模式 `from=R, through<=S`；race 模式 `from=S, through<=Q`，资格与原 R 授权另核 | 原 FOR SHARE、排他写、固定 Q、原事务页界和错误 |
| `direction-supply-wave/CONTRACT.md` 的 **W-12** | 不越过 RPC 的要求保持；旧 cursor 必须区分历史与 RRS 两种模式，不能再把 `through<=旧ceiling` 写为两种模式共同不变量 | RPC 优先、有限 P/W、每 handle lane、真实送达证明和自然收束 |
| `direction-supply-wave/HANDOFF.md` 的 RG-08 / WaveProgress.RPCBoundary | history ceiling 保持；race 的新 sent 只由真实发送推进，W 可据此 covered，但仍须自己的任务 settle，G 仍取原锁并重核/COMMIT/settle | 完成切点、未开始组与已开始任务边界、closing/pending/current检查 |

旧 `WaveProgress.ReturnRPC` 仅记录旧 RPC 返回，不写 sent，原 `RPCBoundary` 只检验旧 ceiling。本目录**不声称该旧抽象已经包含新 RPC 推进**。新 `RpcRace.Send(2)` 实际更新真实账本及 sent；`CoveredWave`、`Settle(3)`、`AdmitG/CheckG/CommitG/SettleG` 是不同动作，组合见证要求走到 owner 完成与两行实际提交。由此在声明的有限范围内补齐 RRS-DESIGN-01 的缺失，而非直接复用旧 RPC 模型结论。

旧文件和旧64项证据均不覆盖重写。正式业务采纳后，以本表作为对应例外；未采纳前原业务合同仍然有效。

## 状态所有权和模型切点

| 状态 / 动作 | 含义及可交错边界 |
|---|---|
| jobs 1–5 / RequestPrimary / Start | publisher配置中1为初始W0，2为原RPC，3为随后至多一次W1，4为一次 fresh 恢复RPC，5为新link一次独立供给。前置RPC配置令owner detached，仅检验RPC资格/消费者。每link活动任务和等待RPC各至多1，等待publisher只有W1这一槽。 |
| admitted / pred / predKind | 在入队同一个同步切点捕获 A 和准确前置身份。后续不能按后来 active.kind 重新推资格。 |
| Acquire / Build / CommitRead | 共享锁授予、固定 Q 与原请求授权、完整候选构建、事务提交释放分别表达；世界/G/绑定持久变化取排他切点。 |
| Send / result / Settle | 真实入队事实与 sent 更新同切点；函数返回/活动任务settle单列。构造成功不能推进水位，成功后不能随其它失败回滚。 |
| wire / Receive / Deferred | 每link FIFO，但不同link可独立到达；当前view、校验拒收、ACK回调超时与同步应用单独判断。 |
| fixed P / G | 原 P 固定为初始已提交的两行1、2。新 head3/4只产生供给需求，绝不补入原 P。G每行独立锁内重核、更新、COMMIT、settle。 |
| W | 原 `publishPending` 在首次owedProgress=false且头未覆盖时，先开始初始W0；W0自然settle后才给已covered的原row1启动G。此时RPC可活动，新提交引发W1排在RPC后；新RPC真实送至目标后W1可covered，仍须settle。W0/W1不同时活动，owner关闭必须等待两者中已开始的任务。 |
| Rebind / BeginPending / Close | 一次已授权view/link基线安装为外部完成动作；pending/持久替换排斥G/共享读；连接closing可在等待中发生，已开始工作自然走拒绝/失败/settle。 |

`Rebind` 假设新快照及基线已经合法取得，不证明安装子协议；它保留旧任务/旧 wire，检查这些旧结果不能写入新 V。当前性在读、发送和应用三个不同位置检查。

## 性质与有限覆盖

所有正向配置启用以下18项，负控清单逐项连接 [expectations.json](expectations.json)。

| 性质 | 业务要求 |
|---|---|
| TypeOK | 状态和前缀范围有效 |
| LaneDiscipline | 每link单活动、单等待RPC，等待RPC优先于publisher |
| OriginalAuthority | 原 R 的权限/下界/当前性检查不能被内部起点替代 |
| RaceEligibility | R=A、前置publisher、完整能力、同V真实sent前进 |
| RaceOrigin | race读取所用S有被捕获publisher的真实送包账本支持 |
| ReadBoundary | history不越可信ceiling；race从可信S开始并受固定Q/有限页界约束 |
| SentPrefix | sent等于真实入队账本，且不低于安装基线 |
| InstalledSeparate | 发送不修改installed基线 |
| NoStaleSend | 旧binding/关闭/pending候选不能实际发送 |
| FixedAuthorizedHead | 读后新head不能灌入旧候选 |
| ConsumerSafety | 应用必须匹配当前身份和连续from；已接受前缀恰一次 |
| SynchronousConsumption | 在无拒收、无ACK超时且无初始缺页时，合法先行包不能因应用延后制造后包空洞 |
| LockExclusion | G排他切点与授权共享读互斥 |
| ProgressCut | G入场等待既有W收束；锁内重核pending/coverage，且只有实际COMMIT才发布原行 |
| OwnerSettled | owner返回不能早于已开始W及G的自然settle |
| NoCancellation | closing/取消不把仍未结束的SQL虚写为完成 |
| NoNewAfterStop | 停止后不启动新的W |
| NoTimeoutSelfWake | ACK超时本身不制造fresh需求或递归补读 |

正向分配置覆盖正常竞态、入场已旧、前置RPC/timeout、consumer拒收、换view/link、撤权/closing/读提交未知/发送失败、不合格能力、入场超前游标，以及两完整前缀页。每配置至多两个link和一次绑定变更，不含无限输入或任意多peer。

本模型整数代表**完整事务前缀的抽象序位**；PageSize=1/2表示可容纳的抽象完整前缀数量，不是实际event数256。生产中首个完整事务超出256时的原回退算法、稀疏序号、highWater和具体运动轨迹数据，需要真实项目验证；这里不能证明数值实现正确。

## 客户端失败边界

正常同link/current V的合法push先同步原子接受snapshot，再处理新ACK。发送先后不是应用确认。

先行push被拒收时，模型保存fresh demand，新ACK若from不连续也拒绝。一次后续请求从真实客户端cursor发出，入场已经落后于sent，必须history重放。配置见证要求该恢复RPC实际被应用、最终到MaxHead；未将仅存在历史候选冒充恢复。

ACK超时本身不创建demand。`ExternalFresh` 是之后可选的一次外部心跳/显式同步需求，无公平性要求，可永不发生；超时恢复见证必须真实经历它。另保留ACK已被忽略而无fresh、cursor仍落后且不递归补读的等待见证。前置RPC不取得race资格。

无fresh demand、永久拒收、永久不调度或撤权后不承诺最终恢复；未添加公平性。死锁检查关闭，因为输入用尽/无fresh需求/网络永久延迟是许可停滞，不是业务完成保证。安全检查与存在性见证不等于活性证明。

## 假设、排除与返回条件

真实 adapter 的完整DTO相等、同步packetCreate窗口、一次proof消费是接口假设；模型用独立真实账本检验水位使用，不证明adapter代码。PostgreSQL隔离、授权数据读取、原始token/epoch等具体检查由原完整事务提供，模型以原R合法性和固定Q代表它们。

未覆盖：任意多peer/5+1完整组、无限W/G、任意RPC流量、所有旧模型完整积、重启持久恢复、实际PG实现、全部终态与claim组合、JavaScript BigInt/JSON细节、8页循环的全部计数、网络时延、运动/Canvas和性能。旧波次64项并未因此重跑或升级成新方案证明。

如果实现新增sent旁路写点、覆盖active work、同V重置sent、并行同handle读、删原R守卫、取消RPC优先、放宽consumer连续性、改proof/锁/原P/W完成边界，必须返回模型；不能当实施自由度。混合房间中仅合格handle满足精确竞态是拟议变化，混合publisher fallback不改；真实兼容性仍待实现方验收。
