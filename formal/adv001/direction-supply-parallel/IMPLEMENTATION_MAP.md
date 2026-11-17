# ed6a4d2 供给增量的限定源码对应核验

**结论：`ASSESSED_WITHIN_SCOPE`。** 本次为本轮交付总控委派的限定 `align`：只读核对下列生产路径、12 项新增测试源码及实现方已有运行证据，未发现这些范围内需要修改模型安全义务的实现偏离。原模型/配置/44 条 TLC 结果及旧 59 条记录均未改变，未重跑整套 TLC 或应用测试。本结论不是源码 refinement，也不是完整产品或性能通过。

## 1. 固定身份与证据层次

| 对象 | 身份 / 本次状态 |
| --- | --- |
| 实现候选 | `ed6a4d2fdeea9fa47159c2fee3590f94431624b1`，tree `d5a24d66f0770cdbc15859d4be9a02bd7163499e`；读取前后工作树干净 |
| 生产来源 | `cb822f80ef2a755371bdd6e464dcc6aa6a169cde`；ed6a4d2 只增加测试，三个生产修改文件逐 blob 相同 |
| 模型候选 | `0a3f95686a90b1d1aabf3630b2f845a9c7fbd621`，tree `a8b401563c8b2ec7b1cba6ecc2c6947656157e01` |
| 有限模型 | 原 9 个正配置通过；21 负控与 14 见证仍是预期 `COUNTEREXAMPLE`，没有新 TLC 运行 |
| 独立模型审查 | `/root/inspect_local_state` 对 0a3f956 的需求轴、标准轴均 `PASS_WITHIN_SCOPE`；状态 `REVIEWED`。审查者独立复跑预算正例及检查后 pending 负控两项，本次只核其原记录 |
| 实现方新增检查 | `/root/recovery_fix`，12/12 PASS，0 fail/cancelled/skipped，28,273.048633 ms |
| 实现方既有回归 | 同一提供方，80/80 PASS，0 fail/cancelled/skipped，45,534.90797 ms；本次逐项核日志与命令身份，重点读取原 lane、可信发送、旧 cursor 和完整 frontier 测试，不称重新独审了全部 80 项测试体 |
| 浏览器 | 总控同生产 cb822f8 的原 `normal` 为 **FAIL**：未观察到真实可见静止 paint 建立呈现资格；`late/five` 为 `NOT_RUN`。本次没有重跑或改判 |

本次源对应状态只写入本报告和 [implementation-map.json](implementation-map.json)。旧 `results.json` 及所有 runner 的 `implementation_status: NOT_ASSESSED` 是模型运行时的原始事实，保持原文；模型独立审查的后续状态也不倒写旧结果。

本报告由模型作者执行限定 `align`，不代替业务候选的独立需求/标准审查；表中的独立模型审查只指固定 0a3f956，不表示本次新增映射报告已经独立复审。

六个核心生产文件与新增测试的内容身份如下。完整 SHA256、其余相关测试/锁文件身份、原日志摘要和复核命令保存在 JSON 记录中。

| 文件 | ed6a4d2 Git blob |
| --- | --- |
| `backend/runtime.mjs` | `11bd85ed81ed23213934a6a55d6e4c32608aa635` |
| `backend/spatial-runtime.mjs` | `7ab36f3d871d3391e6c1838308bb5605dc9bd49b` |
| `backend/spatial-direction-runtime.mjs` | `c96c03c48514ff7b052b869ea6017e52f311b8d5` |
| `backend/spatial-supply.mjs` | `751e93a4abded7e904ed468675e26a2cea7bc9d3` |
| `backend/socket-enqueue.mjs` | `521092a9746a42e651acbb3ad3bf7ebc9414739e` |
| `backend/server.mjs` | `b5148430e9f14e2aa9b910b25cf348441a68a4bb` |
| `backend/tests/spatial-parallel-supply.test.mjs` | `1536e8d0d5dc1392c93abcc7d2145b6874ae8606` |

## 2. 逐义务对应

| 模型义务 | 本次核到的真实机制 | 对应证据与结论边界 |
| --- | --- | --- |
| PS-01/02，共享锁与合格入口 | `syncSpatial` 仅在当前 installed schema 2 且 `spatialSupply.enabled(handle)` 时传 `sessionLock:'share'`；enabled 同时要求方向 ON 与 v2/direction/timed 三能力。`#lockedBody` 只允许 `kind='spatial-sync'` 使用该标志，其余仍走原 FOR UPDATE 或独立 receipt readOnly 分支。 | T01/T03 验证真实共享读重叠与双向读写排斥；T11 验证混合 record 原串行。原 defaultOFF/direction-only/v1 回归仍通过。模型 `Eligible` 不等于不重核授权。 |
| PS-03，授权、row head 与完整前缀 | `BEGIN → SELECT * FOR SHARE → buildTransaction/capture → 原 sync 函数体 → COMMIT`；原 access、能力、view/binding、actor/epoch、终态、适用的 liveConnection、outbox 完整边界、highWater/trail 校验保留。构造的 Batch 和 `syncFrontierSeq` 均使用该 tx 的 row/state。没有将同步改为无锁 receipt 路径。 | T01/T03、T09 与原 `spatial-sync-frontier`/terminal 回归；源码 diff 显示 sync 只新增锁选择。T09 实际比较数据库 state/seq/time 未变，warm/cold DTO 相等，cache 命中后撤权仍拒绝。租期与 closing 没有被扩大成 session 锁保护对象。 |
| PS-04，旧 cursor 上界 | 原 `spatial-supply::sync` 仍从该 handle/current view 的可信 sent 产生内部 `throughSeqCeiling`；`syncSpatial` 在本次授权事务内验证 ceiling 并选完整 outbox 事务边界。 | 既有真实 `D66-SUP-01/02` PG/Socket 测试验证旧 cursor 截在已发 256 前缀、frontier 仍为当前 tx head、installed/sent 分离、空 deliver 保 Pending。其本轮 PASS 在 80 项日志中。 |
| PS-05，真实预算与 handle lane | `publishPending` 对当前有限 `views` 数组按 `slice(index,index+5)` 分组；每组 await `Promise.allSettled` 后才启动下一组。#views 每 connectionId 一个当前对象；内部仍调用原 `spatialSupply.publish` 和相同 handle lane。 | T02 用两成员加四条真实只读 handle，观察首组 5、释放四项后第六项仍未开始、最后首组收束后第六项确实处理。原同 handle RPC 优先/容量测试本轮 PASS。模型预算 1 的检查不被扩称为这项真实 5 槽证明。 |
| PS-06，全部 settle、single publisher 与关闭 | `Promise.allSettled` 收齐后才查 rejected；异常继续穿过外层 finally，最后释放 `#publishing`。`committedPublisher` 把 stopped 查询传入，停止后不再查询/安排下一轮。server close 等 tracked tasks 之后才 runtime.close。 | T04 同时有 A 已真入队、B 失败、C 在途；第二次 flush busy，C 放行后才抛错。T10 关闭时首组不提前返回、第六项不启动、该行 Pending。不同记录不并行。模型 NoLeakedTasks 只针对 publisher 子工作，不声称独立 RPC 不存在。 |
| PS-07，安装/当前 view 完成切点 | `#publishOutboxProgress` 每行独立取 session_id FOR UPDATE 后调用 `#outboxRecordCovered`；先扫所有 handles 的 eligible pending，再扫当时当前 active views，逐一核 schema/能力/current/sent≥target。未覆盖就不 UPDATE。最后成功发送或最初选中集合不能代替该检查。 | T05 让 duringPublish 之后产生已提交但未安装候选，检查该行留 Pending；原 commit-order/terminal 回归覆盖安装围栏。T12 另核检查后 RPC 发送失败的实际 adapter 路径，见下一节。完整 pending 资格自动机仍没有形式化穷举。 |
| PS-08/10，失败与可信发送/绑定隔离 | 原 `sendChecked/current/sentBatch` 与一次性 `consumeQueuedPacket` 没有改动；证明匹配 handle、binding、完整 DTO、ack/push 且发送前后仍 current。`keepSpatialPending` 或未被原撤权规则消化的错误会 rejected，阻止本行进度；blocked 会设置本 record 的 installationPending。 | T04 验证成功前缀不回退及重试只补失败者；T12 和原空 deliver/旧绑定/旧游标 PG、lane 回归共同支撑接口。原可撤权错误仍 notify retirement，不能把这一分支误写成模型每个 `ReadFailure` 的逐状态等价；本报告不声称覆盖所有错误码组合。 |
| PS-09，精确行与独立持久边界 | 窄事务只 SELECT session_id，按 `(session_id,through_seq)` UPDATE，随后独立 COMMIT；没有世界 decode/clone/build/capture/persist。控制优先门抽到 `#withControlPriority` 后由普通事务与窄进度共用。hooks/rollback/committing/committed/release 保留。 | T06 验证第一行 Published、第二行回滚 Pending，重试不重记第一行。T07 的 COMMIT 实际已提交后才丢回应，返回 OUTCOME_UNKNOWN 并查到持久 Published；T08 合法删除沿 SESSION_GONE 收束。这两种错误细节由 PG 证据补充，不在原两行模型中。 |

读取失败、发送失败和退休在模型中是有限业务分支；真实代码还区分 `RESYNC_REQUIRED` 的安装等待、合法撤权退休、SQL 错误和提交未知。此表核对其安全责任，不建立每个错误分支与模型动作的一一 trace refinement。特别是全员 `settle` 不等于每个 peer 都发送成功；只有失败规则与最终当前读者覆盖都允许时才能推进该行。

预算 5 限定本 publisher 当前 record 的 peer 工作，不是全服务 SQL 并发上限；独立客户端 RPC 和其他 session 事务不计入该外层预算。它们仍受各自 handle lane、授权与数据库锁约束。

## 3. 非单调 pending：已补的证据与仍然的限制

新增测试 T12 使用实际 `createAuthorityServer`、真实 PostgreSQL、两个真实 Socket.IO 客户端。它只冻结后台 publisher 调度并保存原 publish 方法以显式执行，不替换授权、发送 proof、断连 handler 或数据库事务。

实际受控顺序为：旧订阅已 COMMIT，安装 callback 暂停；较新订阅安装并真实 ACK，令旧候选因 current 水位较高而不 eligible。当前读者均以真实 ACK 覆盖后，在 duringPublish 发起客户端不带 ACK 的 sync。原 PG 读取完成才暂缓返回，保留后续真实发送；在 outbox 进度最终检查和 UPDATE 之后的 beforeCommit 放行。

放行后，生产适配器无法为无 ACK 返回建立入队证明，原 `sendChecked` 调 `retireView(view,true)`。实际 server 的 `view-revoked → socket.disconnect(true) → runtime.disconnect` 链在首个 await 前将 handle 标成 closing。测试随后断言 closing=true、旧 pending 仍不 eligible、旧候选仍不能安装；最终记录 Published、旧 view 不复活且客户端真实断连。没有直接调用 `retire(false)`，没有伪造 proof，也没有新增门闩。

因此，先前标出的**这条具体生产路径**已有静态调用链和实际 adapter/PG 的一致证据，不能再仅凭任意内部 retire 注入声称是产品反例。该测试不是对全部 pending 资格的数学证明：scope/fence、terminal generation、跨会话切换、recoverable 候选、closing 与 handles 的所有组合仍未形式化。旧安装/终态回归提供不同具名场景的运行证据，不与 T12 相加冒充完整状态空间覆盖。

模型的“候选存在就阻塞”比实际 eligible 谓词更强；更保守地阻塞并不自动构成真实程序的安全 over-approximation。此次没有据此更改模型或把两个检查后变化的负控移除。以后若新增不触发同步 closing、也不受相应安装边界约束的 current/pending 写入者，或 adapter 回调顺序改变，必须重新评估 PS-07 与相关负控。

## 4. 12 项新增测试的映射索引

T01–T12 按固定测试文件中的声明顺序编号，只用于本报告；JSON 记录保存原始完整测试名称。

| 索引 | 实际场景 | 义务 / 模型外补充 |
| --- | --- | --- |
| T01 | 两 handle 共享读同时停在 COMMIT 前，control 写等待 | PS-01/03 |
| T02 | 6 条真实 Socket，首组 5，第六项等整组 | PS-05 |
| T03 | 普通写先持锁，后读等待提交头；旧 control binding 拒绝 | PS-01/03/10 |
| T04 | A 成功+B 失败+C 在途，全收束后抛错并精确续读 | PS-06/08/10 |
| T05 | duringPublish 的新安装 pending 被锁内重核发现 | PS-07 |
| T06 | 两 record 第一行提交、第二行回滚及重试计数 | PS-09 |
| T07 | 真实 COMMIT 成功后丢回应，持久重查与连接释放 | PS-09 的实现补证；模型外 |
| T08 | 合法终态会话删除，SESSION_GONE 与连接释放 | PS-09 的实现补证；模型外 |
| T09 | 新 runtime 冷缓存与暖缓存同 DTO，命中后撤权拒绝且无世界写 | PS-03；cache 机制不在模型内 |
| T10 | 关闭不提前结束在途组，不启动第六项，行 Pending | PS-06 |
| T11 | 混合能力仍逐读者串行 | PS-02/05 的兼容路径 |
| T12 | 真实生产 adapter 的检查后无 ACK 退休与同步 closing | PS-07/10 的具名边界 |

这些是实现方已经执行的检查，本次只读核对源码、日志和摘要。测试门用于固定交错，不把 SQL/proof 的结果替换成总成功假件。T09 的“冷”是同一数据库的新 runtime/cache 命名空间，不是服务宕机；80 项中的 p05-cold-recovery 是另一项真实冷重启检查，不替代完整 P05 浏览器。

T10 通过真实 `publishPending` 的 `isStopped` 回调注入停止标志，核其在途组与后续组行为；它不是外部 SIGTERM 或服务宕机试验。完整 server 关闭的 tracked 等待链在本次属于源码对应，不因该单测扩大为所有服务关闭交错已执行。

## 5. 证据保留与停止点

[implementation-ed6a4d2.tar.gz](evidence/implementation-ed6a4d2.tar.gz) 保存实现方交接、原 12 项/adapter/80 项日志、作者摘要及独立模型审查原件；另附明确标记为摘录的 normal 失败元数据。归档 SHA256 和每项原件摘要见 [implementation-map.json](implementation-map.json)。浏览器原 result 的 SHA256 为 `60029109090423acfec5a23f8da203d50966868d04d91023b20071aa868ebec2`；该结果的起止 source 均固定 cb822f8，工作树干净，不能由当前 PG/TLC 通过改判。

本次没有新增或修正模型语义，因而复用已核一致的 44 条有限结果，没有重复全套 TLC。已核到的实际原子边界与接口责任可供总控使用；任意规模、多实例/Crash、完整重试/取消自动机、连接租期、全部非单调安装资格、真实网络时延、控制优先公平性、256 分页/8 页活性、Canvas/像素/呈现信用及 normal→late→five/P05 性能均不由本次对应结论证明。没有修改实现、项目测试、UI 或验收阈值。
