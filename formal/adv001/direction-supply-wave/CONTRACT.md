# 单 publisher 内逐行进度与有限波次：形式化合同

## 对象与状态

这是 #66 本轮交付总控委派的独立 `design/check`，检查尚未实现的调度提案。输入是三份冻结 r1 和总控的 r1a 终止补充；字节快照及 SHA 见 [inputs.json](inputs.json) 与 [设计输入归档](evidence/design-inputs-r1a.tar.gz)。源码阅读基线为 `aacbf377e3cb94cb2c9ec77c3609eac9e773b1e5`，tree `e760d4cfa13e99146177651db3029ba6794f6191`。根总控决定采纳及后续实现；本包不构成采纳记录。

**implementation_status：NOT_ASSESSED。** 本轮没有业务改动、项目测试、PG、浏览器或远端操作。已有自然方向无 idle 门槛的 FAIL 不因本包而改变；翠兰既有 PASS 属于另一项验收。

## 相对旧合同的明确变化

旧 [ParallelPublish](../direction-supply-parallel/model/ParallelPublish.tla) 的 `SettledBeforeProgress` 要求进度阶段全局无未收束发送工作。它适用于旧逐 record 串行调度。新合同允许旧 G 已开始后，新已提交前缀引出 W；因此不再以该全局性质约束新模型。旧文件、44 份结果及更早 59 份结果保持原样，不能替本次新交错背书。

新的 `AdmissionSettled` 是**入场证书**：启动 G 的那个状态，已经开始的 W 必须全部收束，旧 R 的当前可信覆盖及全局 pending 初检也成立。它不要求证书成为永远成立的当前状态。G 锁内仍重新检查；之后启动的 W 不给旧证书补授权，也不能使下一条 G 越过当前 W。`witness-lock-wait` 的状态实际出现 G 持锁且 W 已入 SQL 等待，显示旧全局无发送断言不适用于此合同。

`R`、`H`、`rowHead`、实际 `through` 和绑定上的可信 `sent` 必须分开：R 是原有限 P 中的进度目标；H 只是最新已提交需求；rowHead 在授权读获得锁时固定；through 是该页实际可发送边界；sent 只有真实证明才能增加。本模型允许读到比启动 W 时 H 更新的权威头，但不能事后用新 H 扩写已经读完的 DTO。

## r1a 与失败解释

最后 G **实际 settle** 后才进入不可撤销 draining。游标在 G 启动时前移只是避免重复尝试；P=1 时，G 尚在途仍可启动 W。P 不追加任何新记录。进入 draining 后不再创建 W，但已冻结的 W 可以完成后续有限组。stop/error/mixed 更严格：禁止新 W、新组、新 peer、新 G，已有 lane 等待、SQL、发送和 G 自然收束。

新 W 失败时，已经启动的旧 G 仍沿原函数完成。若它在原锁内重新确认旧 R 的当前覆盖且没有阻断 pending，可以实际 COMMIT；尚未启动的后续 G 停止。这个解释由总控明确确认，依据 r1 的“已开始任务必须收束”，也与基线 `#publishOutboxProgress` 不接收取消信号的行为相符。它不把新 H 标为已发送，也不撤销已经真实提交的旧 R。不能将“未完成行保留 Pending”误写成取消已经排队的 SQL。

## 状态及动作切点

| 状态 | 模型含义与可交错步骤 |
| --- | --- |
| `owner`、`gslots`、`wslots` | 一次 publisher 生命周期、至多一个 G、一个 W；额外槽位有独立负控。 |
| `next`、`attempts`、`draining` | 固定一或两条 P，按原序启动 G 或跳过 blocked；最后 G settle 后关闭新波次入口。 |
| `demand`、`demandPending`、`ready` | 有限 COMMIT/安装 ready 合并提示；没有授权效力。 |
| `wave`、`frozen`、`selected`、`group` | 启动时固定目标与有限 peer 集合；预算 1/2 缩小抽象，整组 settle 后才开下一组。 |
| `jobs[p]` | `lane → sql → read → candidate → result → settled`。lane 等待与已提交 SQL 不同；后者即使关闭也不能直接丢弃。 |
| `sqlOutstanding` | 从 EnterSQL 到真实返回/错误期间一直存在。授权拒绝必须先等待读取得锁并返回；停止不等于取消。 |
| `gphase` | `queued → locked → checked → updated → committed → none`，另有真实失败路径；真实 COMMIT 与函数返回分开。 |
| `writer`、`readers` | 新 G 的排他锁与 W 的共享读锁互斥；其他 world/control 写在无此锁时折叠为原子变更。 |
| `view`、`pending`、`closing`、`full` | 当前绑定、安装阻断、关闭、完整能力；用于读前/读后/发送及最终进度复核。 |
| `sent`、`proof`、`everSent` | 以 peer 与绑定为键；失败不前推，其他成功水位不回退，旧绑定证明不转移到新绑定。 |
| `owed`、`due` | 已结束有限 W 为可完成旧行保留一次选择机会；新 hint 不能擦掉它。属于安全性预算，不是活性。 |

`WaveWitnesses.tla` 只给同一 `Next` 添加观察历史，不过滤任何转换、不改变 s。它确认“真实 COMMIT 先发生、新 W 发送失败后发生”等顺序，避免从终态错误推断先后。

## 需求与实际启用性质

每个性质的实际结果、负控及 distinct 数见 [REPORT.md](REPORT.md)，详细记录见 [results.json](results.json)。

| ID | 要求 | 启用性质 |
| --- | --- | --- |
| W-01 | 核心序号、水位与集合在声明域内 | TypeOK |
| W-02 | 唯一 owner，至多一个 G、一个 W | SingleSlots |
| W-03 | 每组受预算限制，W 固定 H、每 peer 最多一次页机会 | PeerBudget、FiniteWave |
| W-04 | G 排他锁与 W 共享锁互斥；不把排队当授锁 | LockExclusion |
| W-05 | G 启动时，先前波次已 settle 且旧行初检成立 | AdmissionSettled |
| W-06 | owner 释放前，所有本轮 W/G/SQL 已收束 | DrainedOwner、NoSQLCancellation |
| W-07 | stop/error/mixed 无新工作；普通 draining 无新 W | NoNewAfterStop |
| W-08 | 有限原 P 按序逐条尝试，精确单行真实 COMMIT | OrderedAttempts、ExactRowCommit、ActualCommitOnly |
| W-09 | 锁内检查后至 COMMIT 的当前 pending/覆盖仍合法 | PendingBlocks、CurrentCoverage |
| W-10 | 可信证明才前推；新失败不前推，也不回退他人成功 | SentProof、FailureDoesNotAdvance、SuccessfulSentRetained |
| W-11 | 旧绑定、关闭或失效对象不能发送，授权头固定 | NoStaleSend、FixedAuthorizedHead |
| W-12 | 本 handle 不能越过旧 RPC；旧 cursor 回包受可信 ceiling 限制 | RPCBoundary |
| W-13 | 同需求、同 ready、同水位的 blocked 不自旋 | NoBusyRetry |
| W-14 | 一个有限 W 后，已具备条件的旧行保有一次 G 机会 | ProgressOpportunity |

## 抽象假设与限制

1. 一会话、两 peer、一次 publisher 生命周期；P 为 1/2 行，初始权威头 2，未来最多提交到 3/4；各配置只打开一个具名环境扰动。没有运行所有故障的任意组合，也不宣称任意规模或真实预算 5、六 handle 已证明。
2. 初始旧绑定可信 sent 为 2；分页配置为 1。新绑定的 0 表示不足以覆盖旧行的独立低水位，模型没有完整重建 snapshot/安装握手。未来头不追加到 P，其后续轮次、outbox 创建原子性与外层重试不在本状态机中。
3. G 和 W 的读写锁持有期明确拆开；其他 world/control/安装写的授锁到提交折叠为原子环境动作，必须满足 `CanMutate`。这不是 PostgreSQL 授锁队列、权限表或所有内存 binding 被锁冻结的证明。heartbeat、无 grant disconnect、失效处理的实际旁路须由真实实现证据核验。
4. pending 是显式候选阻断接口，**不是对生产 eligible pending 全状态机的精化证明，也不声称保守抽象自动覆盖全部交错**。实际 current/sent/retire 会影响候选资格。只有受本模型接口约束的变更被检查；真实 adapter 的 retire→同步 closing 路径必须在新 W/G 重叠下重新实证，不能注入任意 `retire(false)` 就称产品反例。
5. 授权、scope/fence 与 liveConnection 压缩为当前对象/能力/pending/closing 守卫。完整数据库权限、控制 epoch、跨 session、终态、SESSION_GONE、缓存和 256 页边界没有逐字段建模。模型把失效页直接丢弃，原 publish 内至多两次 binding 尝试没有逐步展开；不能把该抽象当成完整 lane 的 refinement。
6. 真实 proof 是外部输入假设；本包验证其水位使用规则，**不证明**一次性 token、完整 DTO 相等、同步 packetCreate 窗口或 Socket.IO 适配器代码。RPC 从旧 SQL 已结束而 packet/proof 尚在途的切点开始，只含一个初始 RPC 与至多一个后续排队 RPC；不是任意 RPC 流量证明。
7. COMMIT hint 在环境动作中送达。接线窗口、唤醒 Promise、generation 丢唤醒、监听器拆除、200ms 兜底、连接池和跨 session 转换须后续实现核验。没有以丢弃 SQL、取消 Promise 或缩短关闭等待来保证返回。
8. BFS、单 worker、每次 768 MiB/180 秒，无 `CONSTRAINT`、对称归约、VIEW、模拟或主动终止。关闭死锁检查，因为有限输入会耗尽且允许外部永久等待；没有任何公平性或时序性质，没有活性、实时性或毫秒预算结论。

如上述接口假设、失败范围、单 owner/双槽、有限 P、每波固定集合或提交切点改变，必须返回本合同评估。仅改变文档引用不要求重跑无关旧模型。
