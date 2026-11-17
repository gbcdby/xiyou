# 方向供给并行增量的有限检查

本包为 [#66 窄供给设计 r1](https://github.com/gbcdby/xiyou/issues/66#issuecomment-6943056327) 提供独立增量模型。模式为 `design`：核对拟议共享读、有界 peer 工作与逐行进度的安全义务；不实现业务，不运行应用测试，不批准设计采纳。原 [direction-supply](../direction-supply/README.md) 的 59 条证据不修改，也不重跑。

**本轮 9 个正配置均为 `PASS_WITHIN_SCOPE`；21 个负控、14 个可达见证均以原始 TLC `rc=12` 命中预声明性质。** 正配置清空搜索队列，负控和见证保留 `COUNTEREXAMPLE`，不改写为通过。逐项统计、摘要、启用性质和证据位置见 [results.json](results.json)。所有 runner 结果的 `implementation_status` 保持 `NOT_ASSESSED`；实际 PG、浏览器、CI、合并与部署不由本包结论代替。

## 范围与输入身份

- 设计冻结稿 SHA256：`cd899058342ac9e5d571db675255946ac27eb00b46f5f2418a7e706d15285fbe`，内容见上述 #66 记录。
- 读取的业务基准：`7b0d3846fad50b2c73598cdda2ddd350b7d83cb6`，Git tree `0648491f24960557cdf303b94a77b392e84ce1bc`。它尚未实现本次优化。
- 新模型与配置的逐文件 SHA256 固定在 `results.json`；本目录的提交身份由包含本包的 Git commit 给出。
- 检查只覆盖本次变化。完整旧供给协议、客户端 ACK/应用、动作权威、PrefixStateCache 及其原有证据仍各自成立或待核对，不从两个新模型组合推出完整系统 refinement。

`SharedRead` 使用两个 handle，每个最多一次同步；已发送头为 1、初始会话 head 为 2，一次 world 提交可使 head 达到 3，或一次 control 提交改变持久绑定。`Acquire → Authorize → Build → Finish` 在共享或回退排他锁内，`Return` 与 COMMIT 分开，允许返回时世界已推进。旧 cursor 请求来自 0，可信上界仍为 1。

`ParallelPublish` 使用两个真实 handle、两个待处理 outbox record、一个 publisher。record 内的启动、取共享读锁、读完成、发送、settle、进度取锁、复核、UPDATE 与 COMMIT 均分开。最多一次 peer 2 新加入和一次安装；control 提交可使 head 从 2 到 3，新增的第三个世界前缀不属于本轮最初选中的两行通知。读失败、发送失败、进度失败、关闭均可交错；失败不回退其他 peer 已真实发送的前缀。每个 record 本轮最多尝试一次，失败行交给后续轮次，模型不承诺重试终将成功。

实际预算 5 抽象为 `active <= Budget`。两个 peer、`Budget=1` 的配置能证伪越界启动；`Budget=2` 允许两个任务真实重叠。**本包没有检查 5 个实际槽位与第 6 个 handle 的实现**，这一映射需要代码及真实 PG 用例。每 handle 内的 RPC 优先、一个活动/一个等待 RPC/一个合并 publisher 仍属于原 lane 合同；本包不新增同 handle 第二个工作流，也不重证原容量模型。

## 实际正检查

各配置 BFS、1 worker、768 MiB heap、180 秒预算。预声明 distinct 下限为 50，负控/见证下限为 2。最初两个语义探针之后，按紧凑状态图固定本包下限；探针未作为正式门槛记录。TLC 内置 SANY 解析完成，没有另称运行独立 SANY。

| 配置 | 检查范围 | distinct | 队列剩余 |
| --- | --- | ---: | ---: |
| read / positive-shared | 两个合格共享读与一次 world/control 写 | 412 | 0 |
| read / positive-mixed | 一个共享读、一个普通排他读 | 393 | 0 |
| read / positive-old-cursor | 旧 cursor 的可信已发送上界 | 412 | 0 |
| publish / positive-publish | 两个 peer、两行独立成功 | 82 | 0 |
| publish / positive-install | 一次 pending/持久绑定/安装/快照入队 | 1,858 | 0 |
| publish / positive-join | 枚举前后可加入新 view | 349 | 0 |
| publish / positive-failure | 读、发送、进度失败与关闭 | 5,453 | 0 |
| publish / positive-budget | 两 peer、预算 1，剩余候选等待 | 50 | 0 |
| publish / positive-combined | 新加入、安装、失败和关闭的有限组合 | 70,181 | 0 |

所有配置关闭死锁检查，没有公平性或时序性质。有限输入用尽、未发送 snapshot、SQL/网络永久等待均是允许的环境停滞。`PASS_WITHIN_SCOPE` 只回答已启用的安全性质，不回答最终进展、尾延迟、公平调度或实时性能。

## 需求、性质与负控

| 需求 | 业务保证与启用性质 | 精确命中的错误变体 |
| --- | --- | --- |
| PS-01 | 共享读与 world/control/进度排他写互斥；`LockExclusion` | `negative-write-overlap`、`negative-progress-lock` |
| PS-02 | 普通同步不误用共享路径；`EligibleSharedOnly` | `negative-ordinary-share` |
| PS-03 | 同锁授权绑定固定、结果不超过授权 row head；`AuthorizedBinding`、`FixedAuthorizedHead` | `negative-stale-authorization`、`negative-live-head` |
| PS-04 | 旧 cursor 不越过可信发送头；`OldCursorCeiling` | `negative-old-cursor` |
| PS-05 | 跨 peer 工作不超过预算；`PeerBudget` | `negative-unbounded`，预算 1 时启动第二个 peer |
| PS-06 | 全员收束后才进入进度；publisher 释放时没有遗留工作；`SettledBeforeProgress`、`NoLeakedTasks` | `negative-early-progress`、`negative-early-release`、`negative-close-release` |
| PS-07 | Published 切点没有安装 pending，所有当时当前 view 已覆盖；`PendingPreventsPublish`、`CurrentViewsCovered` | `negative-ignore-pending`、`negative-stale-views`、`negative-pending-after-check`、`negative-join-after-check` |
| PS-08 | 任一失败/blocked 不被当成完成；`FailureKeepsPending` | `negative-ignore-failure` |
| PS-09 | 每次提交只改变指定 record；`ExactRowCommit` | `negative-batch-progress` |
| PS-10 | 真发送 proof 才推进且不能跨绑定或关闭发送；`SentProof`、`NoStaleSend` | `negative-fake-proof`、`negative-stale-binding`、`negative-closed-send` |
| 域约束 | 两个模块各自的 `TypeOK` | `negative-read-type`、`negative-publish-type` |

14 个见证分别到达：两个共享读同时持锁、读后世界写、旧授权拒绝、读失败、两个 peer 同时读取、两行成功、第一行提交但第二行仍 Pending、成功 peer 的 sent 与失败行 Pending 共存、pending 阻止进度、新 binding 无发送基线阻止进度、新 view 未覆盖阻止进度、关闭后全部 settle，以及分别只发生读失败或只发生发送失败且保留成功 peer 前缀。见证的否定式仅在各自探针配置启用，没有被当作搜索约束。

## 安装资格的限定

本包 `pending` 代表仍存在的安装候选，是**保守接口假设**。它不是 `pendingViewInstallation()`、`canInstallConnectionView()` 的完整实现模型。真实谓词还依赖 current 对象、sent 水位、scope/fence、terminal generation、closing 与 handles；其资格可能非单调。模型没有证明“所有内存安装资格都被 session 行锁冻结”。

`CheckProgress → UpdateRow → CommitRow` 显式保留间隙。正模型要求新候选/新 installed view 的建立与安装受同一个 session 排他边界约束；无锁关闭仍可发生。`negative-pending-after-check` 和 `negative-join-after-check` 分别在已复核后改变 pending 或加入未覆盖 view，实际触发 Published 安全性反例。因此，锁内复核本身不足以证明未知的无锁变化不会穿过切点；实现方必须核对该间隙、现存但暂不 eligible 候选在 `retireView` 后资格变化的路径，以及已有 RPC 在读完之后失效/发送失败的路径。若真实路径超出本假设，须回到模型，不能引用本包通过消除缺口。

heartbeat、无 grant disconnect 的 connections 表变化及内存 closing 不被本模型错误纳入 session 行锁。发送期关闭在 `Close` 与 `Send/Discard/Settle` 交错中处理，实际 lease/liveConnection 谓词仍由原授权与发送守卫及独立 PG 检查负责。

## 实现交接与复现

语义映射、原子边界、回归场景及未覆盖项见 [HANDOFF.md](HANDOFF.md)。这是一份待实现义务表，不是已经完成的源码对应证明。

固定工具如下：

```text
TLC 2.19 / v1.7.4
jar SHA256 936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88
runner SHA256 ca5811a8cae5d31961185b0ba53868f3ea885a1ee614150d873d61044ff18f5a
OpenJDK 21.0.13
```

从仓库根运行，输出目录须为新目录；复现全部 44 项或指定组/配置均可：

```sh
python3 formal/adv001/direction-supply-parallel/check.py \
  --jar /absolute/path/to/tla2tools.jar \
  --out .agent-output/supply-parallel/reproduction
```

可加 `--group publish --profile positive-combined`。输入清单和实际性质必须一致，wrapper 同时核原始状态、TLC exit、distinct 下限及负控具体不变量，不能只匹配成功字符串。

[原始记录压缩包](evidence/r1-records.tar.gz) 保留 44 次原始 `result.json`、`manifest.json`、`messages.json`、`tlc.log`，以及共同的模型/配置输入快照、runner 与工具锁定文件。压缩包内结果原文含实际运行时绝对路径，未重写；正式定位用 `results.json` 中的归档路径。jar 可由仓库固定 fetch 脚本获取并核上述摘要，不把重复 jar、状态队列或机器临时目录入库。

本包不证明任意 peer/record 数、真实 PostgreSQL 实现、Commit 响应丢失与进程崩溃恢复、多实例、控制优先公平性、精确 200/400ms、完整 256 分页/8 页循环、实际 Socket 库语义、Canvas、像素、呈现信用或 normal/late/five/P05 体验。没有业务源码或阈值修改。
