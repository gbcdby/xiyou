# 同连接供给协调的有限抽象

模型与各配置的实际执行状态见 [README](README.md) 和 [results.json](results.json)。依据 [#66 已采纳供给合同](https://github.com/gbcdby/xiyou/issues/66#issuecomment-6896744788)。业务源码映射基准为公开提交 [`8593d928115a946bedbae9c662f28c6a90db7796`](https://github.com/gbcdby/xiyou/commit/8593d928115a946bedbae9c662f28c6a90db7796)，逐文件 Git blob 见 [README](README.md)。

## 范围与原子边界

`positive-supply` 的完整组合不计本轮有限子范围门槛；当前完整模型配置为 NOT_RUN。新版按已声明义务划分：`positive-order` 为稳定 link/view 的 2 个读取任务及 2 个前缀增量；`positive-view` 为同连接换 view 的 2 任务/1 增量；`positive-reconnect` 为 2 任务/2 增量、一次新 link 替换且不再叠加换 view；`positive-lane` 为稳定 link 的 3 任务/零内容增量。各配置互不代证，不能汇总成完整组合证明。

每个 link 各有 active/waiting/publisher 槽，旧 link 在途不阻挡新 link；网络只保每条 link 内 FIFO，新旧 link 可独立交付。新增见证要求新 link 已应用新前缀后，旧 link 回调才真正到达并被忽略，另有两 link 同时活动但各自只有一个读的见证。两次发布通知在各 link 合并；任务读取、构造候选、实际发送入队、客户端回调分别发生。纯安装快照也必须真实发送后建立初始 sent 水位。

`Commit` 表示已经提交的前缀；`Read` 抽象原授权事务返回的完整一页，每页一个序号单位，不推断 SQL 耗时。`SnapshotEnqueue/Enqueue` 只抽象真实发送证据的成立，不等于 peer 已收到。`ReceiveBatch` 在 ACK 回调同步应用；`PromiseContinuation` 是独立延迟动作，错误配置把 ACK 应用挪到该动作，以保留已确认的 ACK→push→Promise 竞争。

有限输入用尽、网络永久不接收均允许，所以本模型关闭死锁检查，未加入 Done 使状态假装活跃。没有公平性、liveness 或“最终一定发送”声明。正配置 distinct 下限均 100。每个启用不变量都必须有可达情景和精确命中该性质的负控；超时和工具错误保留原状态。

## 实现对应

| 抽象/性质 | 模块与实现义务 |
| --- | --- |
| `ReadCapacity` | `backend/spatial-supply.mjs::lane/enqueue/drain`：每条真实 handle 最多一个活动任务、一个待处理 RPC、一个合并 publisher 请求。排队不代替原事务权限，控制/动作事务不进入此 lane。模型满槽不证明公平性。 |
| `InstalledSeparate` | 同模块 `sent` WeakMap 与 runtime 安装 view.cursor 分离。`runtime.mjs::canInstallConnectionView` 用安装起点和可信 sent 的较大值拒绝旧安装。读取/发送不能修改安装起点。 |
| `SentPrefix` | `snapshot/sentBatch/sync/publish`：当前绑定已成功发送的完整前缀才前进。旧 cursor 的 RPC 仍跑原授权事务，仅内部使用 throughSeqCeiling；重复完整区间可回但不能推进或裁去重叠片段。模型的 `proof` 是独立真实入队账本，不能从客户端 cursor、构造成功或 emit 真值生成。 |
| `SnapshotEnqueue/Enqueue` | `backend/socket-enqueue.mjs::enqueueSocketPacket/consumeQueuedPacket`：当前真实 socket/Engine.IO/binding、唯一匹配的同步 packetCreate、正常同步返回和后置重核共同建立一次性凭据。模型把该底层事实作为接口前提；真实 Socket 回归另行覆盖其成立，不由数学状态代替库语义。 |
| `NoStaleAdvance` | `spatial-supply.mjs::current/sendChecked/sentBatch` 发送前后重核；同 handle 换 view 不忘记旧活动读取，新 link 与旧 link 分离。模型保留旧任务到其自然 settle，再丢弃旧候选，不允许推进新绑定。 |
| `OrderedApplication` | `frontend/src/network/socket-link.ts` ACK callback 的同步 consumer；`SpatialSessionClient::#reply/#batch` 保留原 serial/generation/revision/link/撤权守卫。模型显式区分队列 FIFO 与回调消费，错误 Promise 延后变体应被检测。 |
| `ExactlyOnce` | `SpatialView::apply` 连续 Batch/重复 Batch 判断及 `#reply` 一次消费标志；已接受 snapshot 经同步 source 逐 owner 传递。模型同时检查每个效果最多一次，当前绑定从 baseline 到 clientCursor 的每个效果恰为一次，游标前缀以外没有提前应用；缺失效果但游标前进的负控必须失败。未证明 Vue/Canvas 的绘制次数。 |

客户端发起换 view 时已使旧请求代次无权安装，是模型 `ReplaceView` 的前提；不是服务端可任意替换客户端授权。发送失败动作只证明水位不前进，不独立证明全体 peer 的 outbox 已发布状态；当前实现保留 Pending 的真实最小 PG 回归仍独立必要。原分页最多 8 页、fixed frontier、03/04 唤醒公平性、异常清理及真实 DOM/paint 并不因此被形式化覆盖。

`supply-verification.json` 与 `supply-expectations.json` 固定全部检查集合和预期结果。负控覆盖并发两读、第二个等待 RPC、不合并 publisher、覆盖 installed、伪发送、信任客户端游标、旧安装回退、旧绑定推进、Promise 延迟、重复及漏应用。见证覆盖真实基线、满槽、旧 view 活动读取与新 view 等待读取共存、installed/sent 分离、两段前缀、旧结果拒绝、旧安装拒绝、发送失败、ACK 后 push 两段实际恰一次应用、新 link 已应用后旧 link 回调、两 link 各一个在途读取。

不覆盖实际网络到达速度、任意多任务、多个 peer 的持久 publisher 完成、数据库隔离证明、Crash、精确超时、渲染/像素/呈现信用或完整 AC05。与方向模型分别通过时，只能报告两组限定结论；二者没有完整组合 refinement 证明。
