# 当前实现与有限模型义务的独立对应审计

## 1. 结论及适用身份

**结论：下列 IM-01—10 及相关 INV / LIVE 义务在所审当前源码中都有可定位的实现对应，已完成检查没有显示相反结果。** 这是需求轴的有限源码审计和执行证据对应，不是 TLA+ 到 JavaScript / PostgreSQL 的 refinement 证明，不把模型 PASS 等同于业务源码已被证明。#12 整体需求结论另见本目录最终审查报告；当前新 900 秒长测亦已完成并核验，本文件不单独代替最终归档和整体验收。

| 身份 | 固定值 |
| --- | --- |
| 实际实现候选 | `fa87e221aa1e48cb19eeecc1beafcb83c0a7a21a` |
| 实际实现 tree | `2d81686787d35d3a26747fbd7896ab1ec54c31ed` |
| 同 tree 的远端源码来源 | 主控固定 `78a85960e4c2de64fc36a48ba1ed4c4b5e82f227`，parent 为实际 main；本地执行提交仍是 fa87，二者不混称 |
| 当前接受标准 | `docs/specs/vertical-slice-mock.md`，`acceptanceProfile=mock-20261111`；有效修订 `3690b481d1805f6a7b535584c80a8574c5103d97` |
| 新 #5 本地来源提交 | `d7088ac7c58334454a3f0de8835b49d1e6be245c`，实际读取其 `formal/core-rebuild` tree 与当前候选相等 |
| 新 #5 完整子树 | `d0931a2d91b27f2276f95b4f58cd3d0525082cf0`；源码、配置、说明和证据在当前工作树实际可读 |
| 新 #5 远端发布身份 | 主控提供 `4ca7286936cc4be1739351d55b8810e73391ed37` / PR #21；本审计的直接身份依据为上述本地可读提交和完整子树，不把本地 `d7088ac` 当远端提交 |
| 新模型本体 SHA-256 | `Core.tla`: `bf0838e1b920aa6bb39f99000038c593ef4fad607718cba121e534af2cabf43a` |
| #7 义务来源 | 固定远端 `c78066d9b95eb3657293fd26a6a5d8b325846b38` 的 isolation / reconnect / visibility README，已通过 GitHub connector 只读取得；本地该边界目录是 opaque / skip-worktree，不声称下载其完整模型或本轮重跑其 TLC |

实现基线为主控固定的 main `10fd0f93b069446d34b08fcddb171d98ee4c50a3`，其提交对象在本工作树不可读；本审查实际使用已可读的完整基线 tree `49748fa1b4b32d8723e3fee3aad919e96311afef` 与候选 tree 做差异比较，不虚构 merge-base。该比较、新增复盘协议、实际源码和本轮结果是独立判断依据，未读取另一审查轴的结论。

## 2. 新核心模型材料的实际核验

已读 `formal/core-rebuild/README.md` §2—7、`model/Core.tla`、配置与判据，以及当前执行结果索引。独立脚本 `audit-evidence.py` 对 85 个模型 / 配置输入、84 份当前结果、其日志 / 消息 / runner 输出、原执行 manifest 和输入快照逐一校验 SHA-256；核对实际退出码、已配置性质、预声明最小状态数、正向运行队列耗尽、负对照命中的性质及死锁 / 时序违反。详细摘要在 `evidence-integrity.json`。

84 项由 **20 个正向有限检查和 64 个预期反例**组成：17 个安全性正配置、3 个活性正配置；26 个安全性负对照、2 个活性负对照、1 个死锁负对照和 35 个可达见证。组合安全性实际结果为 904,868 distinct states、队列 0、原始退出码 0。见证中的 `WitnessAbsent` 失败只证明声明轨迹可达，不将其计为安全不变量。此次未重新运行 TLC，也未更改任何原始结果。

该模型明确限定两个分配请求键 / 两个人类身份、一轮交接、一个 AI 决定、最多一次 provider 回调、至多一次崩溃和一次丢 ACK；不同 profile 的刺激有明确分解。它不覆盖任意长操作历史、任意参与者规模、重复 provider 回调的无限序列或所有独立刺激的笛卡尔积。特别是 `callbackSeen` 不复位，重复回调、完整 fallback、授权投影和 Session 隔离不能从核心组合模型单独推出，须看 #7 义务及实际实现检查。

## 3. IM-01—10 的当前源码对应

以下源码路径均相对当前仓库，测试列指向已实际执行的本候选 `.agent-output/final-checks/backend/command.log` 或相应前端日志。审查者已核对测试断言和实现，而非只采纳测试名称或作者摘要。后端 106 / 106、协议 23 / 23、内容 8 / 8、前端 53 / 53，均无失败或跳过；build、生成物一致性、独立 schema 检查的命令退出码均为 0。

**INV-00 / TypeOK** 的实现对应另由 `protocol/schema.mjs`、`protocol/index.mjs` 的严格对象 / 数字字符串 / Unicode 解析、生成的 TS 类型，以及运行层发事件前的 `validateContract` 和 SQL 约束共同承担；协议 23 项、内容 8 项及独立 JSON Schema 的正负样本 / UTC 边界实际通过。形式模型的有限类型域与现实系统的可变长 ID / 事件规模不同，不能把这一对应称为两套类型域的数学等价。

| 实施义务 | 当前代码保持的语义 | 本候选实际支持证据与限度 |
| --- | --- | --- |
| **IM-01 Session 提交** | `backend/runtime.mjs` 的 `locked` 在 SQL 事务内 `SELECT ... FOR UPDATE` 重读 Session；`buildTransaction` 克隆权威状态，动作仅形成暂存事件；`persist` 将事件、outbox、state / head 与同事务中的 Receipt 一起提交。`decisions.mjs`、控制、维护和内部提交复用该锁边界。迁移的 Session 范围主键 / 唯一约束防止重复持久记录。 | `runtime.test.mjs` 并发物品、内外主体竞争、最终动作与终局；`crash.test.mjs` 实际子进程在 COMMIT 前后及发布中退出并重启；`ai-crash.test.mjs` 原意图和 fallback 恢复。对应 INV-01/02/04/12。没有推导多服务进程调度或任意数据库隔离实现。 |
| **IM-02 请求身份** | `executeAction` 在新的 epoch / 终局围栏之前查询 `(session_id, principal_id, client_action_id)`，核对语义摘要和 actor 后返回已存结果。外层 `access` / `authorizeInternal` 先确认当前资格。`confirmOutcome` 对未知提交查原 Receipt 且绑定完整摘要；不同载荷不能覆盖。前端 `ActionDraft` / `SessionClient.retry` 保留原始字符串、ID、epoch 和 baseSeq。 | 实际并发与异载荷、提交后异常恢复、撤权优先于旧 Receipt、归档 / 删除边界；`review-fixes.test.mjs` 异载荷恢复；前端丢 ACK 原文测试。R2 联合轨迹同一原文发送 2 次，仅 1 次物品效果，交还后取得原 Receipt。对应 INV-02/03。 |
| **IM-03 ACK 与发布** | `locked` 先 COMMIT，随后才允许返回成功结果及运行发布 / 控制副作用；网络入口等待其完成再 ACK。`persist` 的 outbox 与事件同事务。COMMIT 结果不明时用 `OUTCOME_UNKNOWN`，不把网络异常构造为持久拒绝。`confirmOutcome` 与调度器恢复原键。 | 真进程崩溃覆盖提交前、COMMIT 后 ACK 前、发布中；`ai-crash.test.mjs` 覆盖模型原文、fallback、原意图 ACK 和发布。恢复核对实际 events、receipts、outbox、重放状态；原文重试没有双效果。对应 INV-04/05、LIVE-01 的有限实例。 |
| **IM-04 所有权** | `game/rules.mjs` 的动作入口在持锁权威 tx 上检查物品当前归属、物品 revision、目标 revision、可见性、同区域和 capability；物品使用按真实规则产生消耗及目标更新。相关 revision 使用对象范围，未因全局 head 增长一概拒绝旧 base。 | 两人同版本取物、真人 / NPC 竞争只有一个成功；合法不相干事件后提交仍通过。R2 原材料 / 备用材料链真实拿取、交付、使用并验证消耗，工具未误消耗；没有用陈述替换所有权。对应 INV-01 和 `PreconditionDiscipline`。 |
| **IM-05 控制授权** | `control` 在当前认证、成员、连接和 Session 锁内执行；nonce 先查持久绑定。Human 新动作同时检查 actor / mode / epoch / 当前 live connection；`disconnect` 只处理仍匹配原连接和 epoch 的授权。Grace 到期才进入 Proxy。提交后控制副作用再次确认当前权威，迟到副作用不能撤新视图。 | `runtime.test.mjs` Human→Grace→Proxy→Human、双连接、只读 resume、显式 take、旧 nonce、旧 disconnect；`review-fixes.test.mjs` 迟到接管副作用不回退新连接 / 视图。R2 联合轨迹旧代理意图得到 `DECISION_STALE`，没有 fallback 或旧意图效果。对应 INV-06、nonce 辅助义务。 |
| **IM-06 决策快照** | `prepareDecisionContext` 在一把 Session 锁中形成合法 Memory / current projection / Goal 与 Decision。`submitIntent` 最终在锁内核对 Pending、最新 generation、mode / epoch、期限、相关实体版本；当前受众决定可用 Observation 白名单。`settleDecision` 只更新 Pending，收束单调；取消不复活。 | `ai-context.test.mjs` 持锁准备和随后竞争写；`runtime.test.mjs` generation / revision / deadline / unrelated 事件；`ai-network.test.mjs` 取消、终局、交还、相关目标真实修复与撤权；R2 旧 AI 迟到联合轨迹。对应 INV-07、`DecisionSettlesOnce`。 |
| **IM-07 意图包** | `decisions.mjs` 严格解析整个 intent，工具、对白和 beliefUpdates 统一进入 `executeAction` 的暂存 tx。工具按顺序检查但没有逐工具持久提交；第二项失败时恢复 state 和 events 到本动作前检查点，保留合法的拒绝 Receipt / Decision 收束。最终 `persist` 只写接受的整包；期限事件独立保留其合法语义。 | `ai-network.test.mjs` 两工具中第二项失败连第一工具与对白一起回滚；批首和批内版本分别验证；`runtime.test.mjs` 合法两工具次序与非法后续工具；真数据库检查没有先前工具事件 / outbox。对应 INV-04/11。不是通过省略拒绝收据来宣称“无任何数据库变化”。 |
| **IM-08 终局** | 新世界写入口调用同一 `deadline`，在 Running 达到期限时只生成一次 `session.finished` 并取消 Pending 决定。`executeAction` 的规则效果与 `evaluateEnding` 的 finished 在同一 tx / Receipt 范围；普通动作、控制、AI 均受终态围栏。旧 Receipt 和已提交发布仍允许按权限读取。新增 recap 只读终态，特意不调用会写入的 deadline。 | 实际截止与最终动作竞争只出现一个终局；终局后普通动作 / 控制 / AI 拒绝；R2 自然三条通行样本与受控 1200 秒 unresolved 路径；浏览器终态动作停用。对应 INV-08 / INV-04。超时专例明确使用受控时钟，不充抵 900 秒。 |
| **IM-09 连续序号** | 序号在锁内从当前 state head 增长，仅在暂存事件中分配；回滚恢复暂存 state / events；已提交事件以 `(session_id, session_seq)` 为主键。原 Receipt 重试不重新发事件。`replay` 从持久事件重建，同 cursor 的 snapshot / batch 均按该前缀投影。 | 实际崩溃恢复和后续操作、并发竞争、批失败、same-head replay；R2 五人完整局 223 个连续事件且 cursor=223，另外三类结局亦核对真实 head / replay。前端丢弃重叠 / 未来批，不猜补序号。对应 INV-12，投影部分另属 #7 INV-09。 |
| **IM-10 活性条件** | 前端断连重建连接 / 视图并周期 sync；Unknown 结果保留原键供查询 / 重试。服务器 maintenance 处理 Grace、Decision 和 Session 期限，不依赖模型返回。Gateway 独立 timeout / Abort 门控，Orchestrator 在事务外等待模型并持久恢复旧输出 / fallback；每角色单在途、全局有界。 | 实际 provider 不返回 / 忽略 Abort 后仍关闭、超时稳定 fallback；真人在模型等待时取得 Receipt；重启恢复旧输出与原 fallback；丢最终批且无后续事件时周期补发恢复。R2 故障解除后原请求收束。活性依赖最终可用的 DB、进程和调度、有效权限及客户端继续查询 / 重试；没有保证无限持续故障或永不重试客户端必然完成。 |

## 4. #7 信息边界及恢复义务的有限补充对应

直接读过的固定 README blob：isolation `a6bfec711187df18b2686318cc02606be09aba60`；reconnect `7cf13753d73c3f56348c3b57312cd6ea68a28aa8`；visibility `b163a8e7fbddd0c9188b62b73cd60e11aa1a69c8`。这些身份也在当前 `backend/recap.md` 留有固定出处。本审计使用其实施义务，不沿用其模型状态数作为新接口执行结果。

| 义务 | 当前源码与受影响路径 | 真实检查 |
| --- | --- | --- |
| **INV-09 / LIVE-02：授权前缀及补发** | `runtime` 服务端 view 绑定、固定 throughSeq / history 前缀、隐藏事件允许空 batch；`frontend/src/domain/client-view.ts` 只原子应用连续区间，错代 / 未来 / 重叠区间要求恢复；`session-client.ts` 心跳主动补发。 | 同水位投影、256 全局序号页、隐藏空批、错序 / 重叠 / 重复、最后一批丢失且没有新事件；新长测实际 900907.627508 ms、25 个同水位检查点 / 125 份逐人比较，Socket / HTTP / 持久重放均按授权上下文对照。原记录由 `network-audit.json` 再次核验。 |
| **INV-10：当前资格及历史受众** | `game/projection.mjs` 限当前可见世界和本角色合法 Memory；`ai/context.mjs` 从授权投影及本角色 Observation 构造输入；`recap.mjs` 先当前认证 / access，再 SQL 限 Session、历史 `humanCharacterIds` 和事件白名单。共享副本是另一次合法传播，不反向展开秘密原事件。 | 真 HTTP / Socket 的跨局、他人信念 / 私聊、后来到场、撤权及内部恢复；当前浏览器 A→C→B 陈述转述、跨局 / 撤权、同水位分页和只读副作用。 |
| **INV-11：意图 / 陈述与事实分离** | 受控 provider 只能返回 ProposedIntent，经 Gateway 严格解析和 `submitIntent` 同一 Validator；`applyAction` 创建 Claim / Observation / Belief 各自记录，真实修复 / 许可 / 移动只由规则动作改变。recap 先按 Observation.category 判断 Claim，receiver 不被标作 speaker 或最初发现者。 | “通路已修好”假话与 A→C→B 分享仍是 Claim，safe=false；belief 不写事实；非法工具 / 越权 / 假 Observation 无原意图效果；四条结局取真实材料、许可及 NPC 位置。 |
| **INV-13：Session 隔离** | 认证 handle、内部 principal、动作 / Receipt / Decision / ai_runs 的 Session 范围绑定；SQL 所有对象以当前 Session 定位。新 recap 不接受外传 actor 参数，角色由 access 结果确定。provider 不持有 runtime / DB / token，Memory 作用域按 Session、角色区分。 | 相同局部对象 ID 的不同 Session 读写拒绝；跨局 / 陌生身份 recap 拒绝；两个实际 Gateway 输入中的另一局唯一标记不泄露；网络长测独立边局的读写 / Receipt 隔离。 |
| **完整 fallback 与重复结果** | 原决定的 `:submit`、`:fallback` 各有稳定身份；fallback 只在 Rejected / Expired 且当前 mode / epoch / Session 仍合法时执行。调度器先恢复持久原输出与 Receipt，不因未知结果换新决定；已取消决定不能产生 fallback。 | 实际超时、非法、原输出 / fallback 持久后进程退出、重启恢复、重复提交以及交还 / 终局迟到；新核心只有一次回调的范围不足以替代这些检查。 |

## 5. 本审计没有作出的证明

- 不宣称无限规模、无限重试、公网时延分布、多设备、多实例调度或滚动升级正确；本轮是同一源码候选、合成身份和受控 provider 的有限执行样本。
- 不把 190 个测试数量本身当需求通过；每项义务要对应实际断言、源路径和场景。模型结果与真实实现结果分别保存。
- 不把 Claim、Belief、计划或可信内部诊断展示给普通玩家作为真实世界事实，也不把自然结局所需条件写入测试世界来制造结果。
- 不称实际 LLM 品质、真人体验或真实供应商可用性已测；它们在本 profile 为 `NOT_REQUIRED`，实际执行状态仍为 `NOT_RUN`。
- 没有修改模型、业务源码或正式测试，未读取另一审查轴报告，未作远端写入。长测已实际完成，最终归档和两轴结论仍由主控结合；这份有限对应审计不能单独授权整体 PASS。
