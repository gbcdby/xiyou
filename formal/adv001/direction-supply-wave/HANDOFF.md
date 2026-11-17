# 交接：旧进度在途时的有限新波次

状态：形式化交接 **COMPLETE**；具体模型状态见 [REPORT.md](REPORT.md)。实现对应 **NOT_ASSESSED**，真实项目回归、PG、浏览器 **NOT_RUN**；没有独立作者之外的本包复核结论。是否采用本提案与后续交付由总控决定。

## 必须保留的边界

沿用一个 `#publishing` owner、原 session、原 handle lane、原完整授权 sync 和逐行 helper。改变的是 W 的启动时点，不是读写锁、证明、当前覆盖或 COMMIT 语义。原 [CONTRACT.md](CONTRACT.md) 明确了旧 `SettledBeforeProgress` 的替代关系、r1a 单行终止切点与未覆盖范围。

特别区分三种状态：

- G 已启动但仍等待锁或函数返回：保留其槽，可合并新需求并启动一个 W。
- 最后 G 实际 settle：进入不可撤销 draining，不再开 W；已冻结 W 的后续组继续完成。
- stop/error/mixed：立即禁止新 W、组、peer、G；已 started 的 lane/SQL/G 都必须真实收束后才释放 owner。

新 W 失败不能假取消旧 G；旧 R 经原 helper 最终复核后仍可能真实 COMMIT。已 COMMIT 的旧行、其他 peer 的成功 sent 保留，新 H 的未覆盖前缀不能凭错误成为成功。这两种先后均有见证：W 先失败、旧 G 随后完成；旧 G 先 COMMIT、W 随后失败。

## 拟议实现对应与未评估项

下表是设计映射，不是 `align` 或 refinement。已读取的当前源身份在 [project-profile.json](project-profile.json)，以下五个业务文件与 ed6a4d2 的相关字节一致；新协调器尚不存在。

| 模型动作/状态 | 当前基线位置 | 新实现应提供的证据 |
| --- | --- | --- |
| owner、G/W 槽、attempts、draining、owed | `backend/runtime.mjs` / `publishPending` | 同一个 owner 内的有界协调器；G 全生命周期占槽，W 固定候选；有限 P 不追加。 |
| `AdmitProgress` / `CheckProgress` | `#outboxRecordCovered`、`#publishOutboxProgress` | 初检不代替 helper 的锁内复核；保留 SELECT session_id FOR UPDATE、精确单行 UPDATE、独立 COMMIT 与异常/release。 |
| lane/sql/read/candidate | `backend/spatial-supply.mjs` / `enqueue`、`drain`、`publish` | 原 1 active + 1 RPC + 1 coalesced publisher；不能因为 W 被创建便声称 SQL 已入列或得锁。保留两次绑定尝试上限。 |
| rowHead/through/current/proof | `backend/spatial-runtime.mjs` / `syncSpatial`，`spatial-supply` / `sentBatch`、`sendChecked`，`socket-enqueue.mjs` | H 只提示需求；旧固定授权头、prefix capture、页边界、当前 binding 与完整 DTO 的真实一次性 proof 均不改。 |
| CommitWorld/ready、demandPending | `backend/spatial-direction-runtime.mjs` / `committedPublisher`、`attachSpatialDirection` | 新本地唤醒与原 generation/pending 重查协调，监听仅标脏；200ms 与 checkpoint 不变。模型未覆盖接线/监听清理竞态。 |
| stop/mixed、SQL outstanding、释放 | 以上生命周期及服务关闭路径 | 不能 Promise.race 首失败后退出；未started 可停止，已提交 SQL/G 必须真实 settle；普通 draining 的后续组不得丢。 |

## 可交给实现方的回归场景与断言

下列均为**待实现的场景规格**，本 worker 未编写或运行测试。预算 1/2 的模型不替代真实 5+1 handle；模型状态不能自动当 PostgreSQL/Socket 事件。

| 场景 | 必须控制的先后 | 独立可观察断言 |
| --- | --- | --- |
| RG-01 单条 P 的核心重叠 | 只有一条已覆盖旧 R；先使 G 进入等待，之后才真实 COMMIT 新头。另一个变体用真实 COMMIT 后、函数返回前的门。 | G 未 settle 前 W 已进入原 lane；旧串行基线不能满足此顺序。空闲 peer 的 SQL 入列与有旧 RPC peer 的 lane 等待分别记录。 |
| RG-02 原锁与旧 RPC | 世界写先持原锁，G/W 排队；释放后控制 G 已获 FOR UPDATE，另一个 W 等 FOR SHARE。本人旧 cursor RPC 的 packet/proof 延迟。 | W 不穿透排他锁；旧 RPC 不被越过。新 hint 时刻不是 SQL 授锁或 packet 时刻。 |
| RG-03 第二条旧进度 | P 有两条；G1 返回时 W 尚在途。 | G2 尚未开始；W 全部 settle 后按 P 原序尝试，独立 COMMIT，精确 WHERE 对应各 R，attempts 不批量增加。 |
| RG-04 draining 的第六 handle | P=1，冻结 W 有六真实 handle；首组五个已开始，G 实际 settle；保持最后 peer/组门。 | owner 仍忙；第六个属于既有 W，在普通 draining 中最终启动并完成；后来的 H 不开启新 W、不扩 P，留外层下一轮。 |
| RG-05 失败与旧 G 分属不同前缀 | A 已真发送、B 读/发失败、C 仍在途，同时旧 G 排队或提交。分别让错误发生在旧 COMMIT 之前与之后。 | 无新组/G；再次 publish 仍 busy，等 C 与 G 全部 settle 才返回/上抛。A sent 不倒退，B 不伪增，新 H 未覆盖保持 Pending；旧 G 若合法实际提交则保留其结果。两 peer 模型未覆盖真实 A/B/C 三者并存。 |
| RG-06 停止时 SQL 已提交 | W 已提交 SQL 但被 G/写锁阻塞；再关闭或混合模式转换，之后释放锁/返回查询。 | 不通过丢弃 Promise 冒充 SQL 结束；owner/连接释放只能在实际返回、授权拒绝或真实错误后。关闭后的旧候选不得发送。 |
| RG-07 pending 与真实 adapter | G 等锁前新增 pending 或当前 reader；另在 check+UPDATE 后让实际 W/RPC 无 proof→retire→disconnect。 | 锁内重新枚举阻断未覆盖行。使用实际 server adapter 验证同步 closing 让旧候选不复活；旧 T12 的单阶段结果不能替代新 W/G 重叠窗口；禁止用任意内部 retire(false) 当生产反例。 |
| RG-08 授权头、绑定与证明 | 读完成后产生新头/新绑定/关闭；向旧绑定返回旧结果；故意不发 packet、复用 proof 或缺 ACK。 | 不把 H 填进 DTO，不跨绑定推进；完整真实 packet 一次证明方可更新 sent。合法旧 cursor 仍做授权重读且 through 不越过可信 ceiling。 |
| RG-09 COMMIT 回应未知 | 真正执行旧 R COMMIT 后丢回应；另使下一 R 在 COMMIT 前失败。 | 数据库真实结果保留：已 Published 不伪回滚/重复 attempts；下一未提交行 Pending。重试重新查询持久 Pending。合法 SESSION_GONE 沿旧语义；该分支未建模。 |
| RG-10 有限页与选择机会 | 新 hint 连续合并；一页不足 H；另使同一 generation 因 pending 无前进。 | W 不追无限新 H/页，不重复同 peer 页机会；有真实分页前进才可再开波次；旧行的 owed 机会不被 hint 擦掉；blocked 不自旋。保留真实 256 页边界与原 RPC 客户端页数限制。 |
| RG-11 能力边界 | default OFF、direction-only、legacy、初始混合；以及双槽在途后当前 reader 变 mixed。 | 旧路径保持；新模式退出只禁止新工作，原在途任务收束，剩余由原串行入口/后续轮次处理。模型只覆盖从完整模式变 mixed 的接口。 |
| RG-12 唤醒与收尾 | COMMIT 落在监听安装/初始查询窗口；另落在最后 G settle/拆监听窗口；晚回调重入。 | 不丢新需求，不重新打开 draining；无后台拒绝、泄漏监听或第二 publisher；旧 generation/pending 重查与 200ms 兜底继续有效。此竞态不在模型内。 |

这些协议门通过后，原 normal、适用 late/five、no-idle、速度、diagonal/DOWN、自然 CI 仍须按未改门槛独立验收。模型没有消除原观察中的客户端 native→source 延迟，也不预告能节省任何毫秒。

## 返回形式化的条件

增加跨 session/跨 publisher 并发、两个 G/W、无限追加 P、改变波次重试/分页预算、弱化锁、移动最终覆盖检查、改变 failure/stop 或 draining 边界、以缓存/H 代替授权/证明，均需要重新审视受影响模型。实际生产出现本接口假设不能表示的 pending/retire 交错，也应返回建模；不得把它直接归为“已有 PASS”。
