# 方向受理与原账本的有限抽象

模型与各配置的实际执行状态见 [README](README.md) 和 [results.json](results.json)。源码映射是限定只读对应，不是 refinement 证明。交付范围来自 [#66 方向合同](https://github.com/gbcdby/xiyou/issues/66#issuecomment-6894942789)。

## 身份与边界

业务源码映射以公开提交 [`8593d928115a946bedbae9c662f28c6a90db7796`](https://github.com/gbcdby/xiyou/commit/8593d928115a946bedbae9c662f28c6a90db7796) 为基准，逐文件 Git blob 见 [README](README.md)。本包提供有限模型和证据；源码实现未由 TLC 评估。

`positive-authority` 是一个角色、一个物理连接、最多 2 条全局请求身份、2 个控制 epoch、一次同连接 binding 变化、E/SE/S/stop 四种输入、坐标 0..2 的完整有限交错。完整探索配置不纳入本轮子范围通过声明；当前完整模型配置为 NOT_RUN。输入身份不随重试改变；每条最多丢一次请求、重发一次，ACK 可丢失。`Walk` 表示已有计划的一次权威推进；`Handle` 的当前位置是原事务完成时间推进后的当前点，不模拟物理速度。

交付正配置分解为：`positive-order` 保留两命令、同连接 binding 变化、迟到 ACK、原 Receipt、较新 Accepted/领域 Rejected 水位的全部有限交错，只固定 epoch；`positive-epoch` 保留一命令跨 epoch 的首次拒绝与原 Receipt 重放，不能代证新 epoch 又有第二动作的组合。前者新增真正重复 Handle 发生在较新动作/拒绝水位以及新 binding 新动作之后的见证，`ReplayPreservesCurrent` 同时要求该重复处理不改当前路线、应用序号或处理水位。另有实际晚 Receive 发生在新 binding 已发更高序号动作之后的见证。

`positive-budget` 独立使用 3 条请求，保留跨 binding 的 waiting/unknown 账本，刻意不安排服务端响应，检查满槽阶段的准入。该配置关闭死锁检查并在 manifest 说明理由；不能用它声称响应活性或三条请求的完整服务端组合。权威配置开启死锁检查；没有公平性和 liveness 声明。预声明正配置 distinct 下限分别 100 和 20，负控/见证至少 2；超时不能写 PASS。

## 实现对应

| 模型动作/性质 | 固定源码符号与义务 |
| --- | --- |
| `Handle` / `ReceiptStable` | `backend/spatial-runtime.mjs::executeSpatial` 先按原主键及 digest 读取既有 Receipt，再为首次 direction 推进时间、校验和执行；原 Receipt 优先于新的 epoch/seq/方向重解。`effects` 只数动作应用，不数世界时钟推进。 |
| `CommandWatermark` | 同函数在领域规则之前写 `spatial_command_sources.handled_seq`；RuleError 只回退 `tx.state` 与本次领域事件，不回滚该 SQL 水位。模型的 `handled` 因此包括领域拒绝。 |
| `AppliedOrder` | `lastApplied` 只对应成功应用的方向/stop，不能再用旧 `CommandOrder` 把拒绝水位当作成功动作。 |
| `DirectionOriginCurrent` | `game/spatial-rules.mjs::applySpatialAction` 将 direction 转为原 move_to；`game/spatial-direction.mjs::directionDestination` 从事务里的 actor.position 解短段。模型检查各方向目标来自 Receipt 记录的实际处理原点。坐标步长仅为有限替身。 |
| `RejectedRoutePreserved` | `executeSpatial` 的 `before` 在推进旧运动之后取值；领域拒绝保留该基线旧路线。模型的 route/active/lastApplied 不能被拒绝清空。 |
| `StopFence` / `EpochFence` | 同一 handled_seq 比较覆盖 move/stop；控制 epoch 检查先于领域应用。`ChangeEpoch` 清当前动作，但保留历史 Receipt。 |
| `Issue` / `OutstandingBudget` | 客户端 `SpatialSessionClient::send`、`#directionCapacity`、`#pendingStop` 读取整个 `#actions` 原账本；新 binding 不重置 waiting/unknown 限额。最多两条方向与一条 stop，stop 存在时不再发方向。 |
| `Unknown` / `RetryOriginal` / `OriginalRequestIdentity` | `SpatialSessionClient::retry/#deliver/#receipt/query` 保留原 draft.id/raw；新方向模式的原重试仍 Unknown，不能释放账本或分配新 seq。模型只抽象“结果未知”，精确 400ms 和 timer 不续期留现有受控时钟回归。 |
| `ReplayPreservesCurrent` | `executeSpatial` 的原 Receipt 直接返回，不重新解释 direction，不改已经由较新命令建立的目标、活动状态或 handled_seq；领域拒绝后保留的新水位同样不能被旧重试回退。 |

所有 Handle 的持久原子性以当前单 Session 原数据库事务为前提；JavaScript 的单线程本身不提供这个保证。`Rebind` 抽象同连接 map/view 身份变化，不清命令账本。查询原 Receipt 不计“已重复处理”见证：`replayed` 只由真实第二次 `Handle`、先前 ACK 丢失及原重试共同建立，`replayedMoved` 还要求该 Handle 时位置已改变。

## 可证伪性

全部启用性质与实际 cfg 集合列于 `authority-verification.json`；期望退出码、目标性质和 distinct 下限列于 `authority-expectations.json`。负控分别破坏类型、拒绝水位、较旧序号处理、重复效果/Receipt 重解、stop 水位、epoch、拒绝清路线、跨绑定/stop 容量、陈旧原点和重试 payload。见证分别到达首次发出、领域拒绝消耗水位、较旧请求拒绝、丢 ACK 后实际重放（含位置已变化）、stop 后旧请求、旧 epoch、运动中的领域拒绝、跨绑定两方向加一 stop、处理原点不同于发出原点。

模型不覆盖任意命令数量、Crash/重启、多实例事务隔离证明、实际寻路/碰撞、精确时间/速度、held 意图活性、实际 Canvas、真实呈现信用或原 150–450ms 门槛。模型结果不得改变旧性能 FAIL。
