# 供给增量的设计与实现义务

模式 `design`。本次业务源码对应状态为 `NOT_ASSESSED`，真实应用测试 `NOT_RUN`。模型检查与其边界见 [README.md](README.md)；只把这份表作为原总控继续实现、独审与验收的输入。

## 已读取的基准

基准 `7b0d3846fad50b2c73598cdda2ddd350b7d83cb6` 的内容没有本轮优化。以下 blob 固定用于理解现有边界，不表示新设计已在这些文件中完成。

| 文件 | Git blob |
| --- | --- |
| `backend/runtime.mjs` | `23259be6d735af6f8f4f0d86b1b8894e135fde0a` |
| `backend/spatial-runtime.mjs` | `bf9e39827e3709912e56307a4ddf99773a0aba71` |
| `backend/spatial-supply.mjs` | `751e93a4abded7e904ed468675e26a2cea7bc9d3` |
| `backend/socket-enqueue.mjs` | `521092a9746a42e651acbb3ad3bf7ebc9414739e` |
| `backend/spatial-direction-runtime.mjs` | `2ddf5635829c0196d5d563da0fedf729a2413569` |
| `backend/server.mjs` | `b5148430e9f14e2aa9b910b25cf348441a68a4bb` |

## 原子步骤如何对应

| 模型/义务 | 目标位置与必须保留的语义 | 尚需真实证据 |
| --- | --- | --- |
| PS-01/02，`SharedRead.Acquire/Finish` | `runtime.mjs::#lockedBody`、`spatial-runtime.mjs::syncSpatial`：仅显式方向 ON、v2、direction、timed 三能力的同步选 `FOR SHARE`；持有至同页 COMMIT。普通同步与所有相关写仍走原排他路径。 | 真实 PG 两个不同 handle 能同时持读锁；world/control/revoke/install 等相关 session 写不能穿过；普通与混合兼容路径不被误选。 |
| PS-03，`Authorize/Build/Return` | 每页仍调用原 `access`、能力、持久 view、current installed、actor/epoch、终态与 liveConnection 守卫。`buildTransaction`、prefix capture、原 fixed row head、完整事务分页、high-water 与 trail 同处原写排斥区。 | 共享读不是现 `readOnly:true` receipt 无锁分支。空 events/clockTouched=false 不变，不推进世界/时间、不登记控制效果，不从 cache 获得授权。源码与 warm/cold 对等结果未由模型检查。 |
| PS-04，`OldCursorCeiling` | `spatial-supply.mjs::sync` 只用该 handle/绑定真入队头生成内部 `throughSeqCeiling`；同步仍重核授权和完整边界。 | 旧 cursor 请求不吸入新 prefix；新 cursor 不由客户端声明推进 trusted sent。原客户端 8 页上限与 DTO 不变。 |
| PS-05，`StartPeer/PeerBudget` | `publishPending` 捕获有限 handle 候选，每 handle 调既有 lane；最多 5 个不同 peer 工作，余下候选分组等待。 | 第 6 个真实 handle 必须被尝试或明确留 Pending，不能丢掉。旧 lane 的一个 active、一个 waiting RPC、一个合并 publisher 与 RPC 优先不变。模型预算 1 的反例不证明实际常量 5。 |
| PS-06，`Read/Send/Settle/BeginProgress` | 不能把第一项 rejected 当成整轮已结束。已开始的所有工作自然 settle 后才返回/抛错、进入本行进度或释放 `#publishing`/外层 running；关闭同样收束。 | A 成功、B 失败、C 已启动未结束时，第二次 publish 仍 busy；服务关闭仍等 C。成功 A 的 sent 保留。 |
| PS-07，`BeginProgress/CheckProgress` | 每 record 独立 BEGIN，取 `SELECT session_id ... FOR UPDATE` 后，重新枚举当前 session 所有真实 active view，并重核全局 pending、current/scope/fence/能力及各自 trusted sent。进度锁内不启动 sync、不等 Socket。 | 安装候选、actual eligibility、view 退休与新加入的全部写入者要核对。共享 session 锁不冻结 heartbeat 或全部内存状态。特别检查复核后、UPDATE/COMMIT 的 await 间隙。 |
| PS-08/10，`Send/ReadFailure/SendFailure/Discard` | 真实一次性 `consumeQueuedPacket` 与发送前后 current 守卫继续生效。任何失败/blocked 行不发布；旧结果不能写新 binding 的 sent。 | 空 deliver、构造 Batch、emit 真值、失败返回和客户端 cursor 都不得造 proof。读已完成但 view 被替换/关闭必须丢旧结果并 settle。 |
| PS-09，`UpdateRow/CommitRow` | 只 UPDATE 当前 `(session_id, through_seq)`，每行独立 COMMIT；不走世界 state decode/clone/build/cache/persist，不批量 `<=head`。 | 第一行成功后第二行 UPDATE 故障，第一行独立成立、第二行 Pending；SESSION_GONE、rollback、COMMIT 响应未知、client release 与必要 hooks/control priority 保留。COMMIT unknown 的实现恢复不在本模型内。 |

## pending 抽象与尚未封闭的映射

`ParallelPublish.pending` 是“存在候选就先阻塞”的保守状态，不是缓存过的 pending 布尔值。`BeginRecord` 的初检结果会阻塞该次 record，`CheckProgress` 又检查当前集合；`CommitRow` 的证据记录取提交时实际集合与实际当前 view，因而可发现复核后的变动。历史记录证据固定在提交点，不要求之后新加入的 view 自动追溯改变旧 Published 状态。

正模型仅允许 session 锁保护的新 binding/pending 建立和 installed 安装；无锁关闭可从当前集合移除 peer。真实 `pendingViewInstallation` 的资格有更多条件：`canInstallConnectionView` 比较 current/sent 水位、scope、terminal generation 与 closing；`retireView` 可以在同步发送失败后无锁删除 current。这份模型**没有证明**“存在但当时不可安装”的候选在 current 退休后仍不可安装。需要核对这样的状态是否可达、相关 retired/current 边界如何序列化，以及最终 check 到 COMMIT 间隙是否仍满足契约。不能将该未知写成已证伪的真实漏洞，也不能用保守模型通过宣布它已排除。

基准生产 adapter 的静态调用链提供了收束依据：`spatial-supply::sendChecked` 失败及 runtime 的撤权/发布错误路径使用 `retireView(view,true)`；`server.mjs` 的 `view-revoked` 监听调用当前 socket 的 `disconnect(true)`，disconnect 回调调用 `runtime.disconnect`，其第一个 await 之前先设置 `connection.closing=true`。不通知的 `setConnectionView` 在原 session 锁内同步 retire/set；disconnect 末尾已有 closing，runtime close 则在服务 tracked 工作收束之后执行。当前未发现一个既不 closing、又不持相应锁的真实生产 retire 路径。任意直接调用内部方法不能被当作已可达的产品反例；Socket.IO 的真实回调顺序及该固定 adapter 映射仍由实际验证确认。

`negative-pending-after-check` 的业务含义是：两 peer 已覆盖 record → 进度持锁并复核成功 → 另一条允许的无锁路径使 pending 重新成立 → UPDATE/COMMIT → Published 证据不再满足无 pending。`negative-join-after-check` 同理让一个未覆盖 view 在复核之后出现。两者是对原子边界义务的错误变体，只有实现确实允许对应路径时才构成真实偏离。它们不是已经运行过的 PG 复现。

## 反例回归规格

以下均交给实现方转写和运行；本包未添加或运行项目测试。

1. **共享读与授权头。** 门住两个不同 handle 的共享读，同时发 world/control 写；写只能在读事务结束后取得 session 行锁。读完成后再推进 head，早先那一页仍返回自己的固定授权头。反向先提交 control，再让旧绑定读取得锁，必须拒绝旧授权。
2. **旧 cursor。** 已真实发送到 1、会话 head 为 2/3，发 cursor 0。仍读授权事务，完整返回上界不超过 1。不得用实时新 head 改写历史请求的上界。
3. **收束与失败。** A 真入队，B 读失败或发送失败，C 若已启动则继续自然 settle。本行保持 Pending，发布占用在最后子任务结束前不释放；A 的 sent 不回退。模型使用两个 peer 已足以触发早退错误，真实三项场景负责覆盖成功/失败/未结束同时存在。
4. **安装与当前 view。** 在 peer 枚举后加入新 view，或在旧读取完成后换 binding。最终进度复核必须发现新 view 未覆盖或尚无发送基线；旧页不能推进新绑定。全局 pending 不仅遍历最初选中的 active views。
5. **逐行进度。** 第一行成功 COMMIT，第二行出错。第一行独立 Published、第二行 Pending；任何一次 UPDATE 均只能对应一个精确 record。COMMIT 响应丢失后的持久状态重查由真实 PG 场景补充。
6. **关闭。** SQL 读完成之前或之后令 handle closing；已开始的工作仍 settle，发送守卫拒绝旧连接，关闭返回时没有遗留发布子任务。session 行锁不得被误认为锁住连接租期或 closing。
7. **完成切点。** 将现存候选的资格变化、RPC 发送失败导致 retire、duringPublish hook、新订阅放在最终锁内复核周围。若有路径可在复核后使 pending/当前未覆盖 view 增加，应先修订原子边界并返回模型，不能只再读一次旧快照。

## 返回建模条件与停止点

任何放开 session 锁的读、缓存授权、扩大并行到跨 record、批量进度、提前释放 publisher、改变安装资格/退休边界、改变可信 proof 或真实实现发现上述无锁间隙，都需要重新评估本模型。新增任意重试、Crash、多实例或活性保证也不能直接沿用有限安全性结论。

本次交接止于模型、反例、运行证据与义务。形式核验不会修改 defaultOFF、协议字段、事件/轨迹/时钟、200ms 兜底、浏览器 no-idle/速度/diagonal/DOWN 150–450ms 与 abs(dx)<4 门槛，也不替代真实完整候选的 normal→late→five/P05 验收。
