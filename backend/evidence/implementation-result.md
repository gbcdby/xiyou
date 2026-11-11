# #6 权威运行层实现结果

## 结论与固定对象

**作者实现：COMPLETE；必需作者自查：PASS_WITHIN_SCOPE。** 本报告不替代独立需求／标准审查，不表示 Ticket 已 ready、已合并、已部署或父 Spec 已完成。

- work_id：`vs001-p03`；Ticket：[xiyou #6](https://github.com/gbcdby/xiyou/issues/6)。
- 有效 Spec：`6c2a0b9f6d137ad5fbd41721659404333ad8e16d`，覆盖 M0 协议、玩法和验证计划中的本票范围。
- 分派基线：`19016f85656018064176d866f0906441077fbb1a`。
- 本次受总控授权额外接入内容边界修正 `7e04e4ad94b7f409318b0bc35847fa98cf0208e6`，本地集成为 `a076ae3`；既有 fixture／digest 与开局装配输出未改变。
- 固定源码提交：**`3443884069953eaf8da7ded49a520130b4d618f9`**，tree **`404a4bd4fabeba4ed7815529e8cd5672b56b244f`**。报告所在的后续提交只增加证据；同一源码由清单逐文件确认。
- 54 个运行、测试、协议、内容及 Spec 输入的集合 SHA-256：**`2e95209c14fc6912420d3f77dfc769749db6d71cfea36cce21de3cb4ef14074f`**；算法和逐文件摘要见 [source-manifest.json](source-manifest.json)。

完整执行索引见 [self-check.json](self-check.json)，版本见 [environment.json](environment.json)。证据中历史绝对路径是原始执行输出，不是复现所需依赖；当前复现从仓库根目录运行 [后端说明](../README.md) 中的命令。

冻结输入以分派基线 `19016f8` 的实际文件字节再次比较。原始远端 Spec 提交对象不在此本地仓库的对象集合中，其身份沿用总控提供的固定来源记录；本次没有据此伪造一次跨远端提交的本地 diff。测试框架原始差异输出含行尾空格，证据目录仅对该类原始日志保留格式，业务源码仍执行默认空白检查。

## 实际交付

实现选择是原生 Node ESM + HTTP + `pg` + Socket.IO，没有新增依赖、框架、微服务或内存权威替身。新增运行代码位于 `backend/` 和 `game/` 非生成模块；根 package.json 只添加运行／检查脚本。未修改生成的 game/types.ts、protocol、Formal 或 Spec；content 修改仅来自总控指定的已审提交。

世界、连续事件、Receipt 和 outbox 在同一个 Session 行锁事务中提交。当前认证／成员／角色权限在锁后重查；已知收据先于当前 epoch、终局和新的截止处理。新动作使用原始 JSON 与共享摘要，旧 ID 异载荷不能覆盖。事务计数回滚，不以 sequence 占号。COMMIT、ACK、发布分别处理，未知结果查询原键。

实现了 Lobby 创建／加入／开局／房主取消、2–5 人固定装配、控制交还、系统终止、截止和正常终局、授权读取、归档与删除边界。物品操作使用真实位置、持有者与版本，内容机制包含修复、工具／材料和许可。正常最终动作及最后 finished 在同一收据范围内，终局取消 Pending、撤销控制，后续世界序号不增长。

授权投影保存当前可见状态和合法历史知识；Observation、Claim、Belief 分开。服务端绑定 view，固定历史受众，完整批次最多 256 全局序号，隐藏区间可空推进。HTTP 快照无控制权，Socket.IO 只使用真实连接句柄。后续 #9 通过固定 Decision 身份的 prepareDecision／submitIntent 提交，当前没有真实模型推理。

## 最终同源码检查

| 检查 | 实际结果 | 原始输出 |
| --- | --- | --- |
| `npm run test:backend` | **26/26 PASS**，0 fail／skip；其中运行层 21 项、真实网络 1 项、进程故障父测试及 3 个子场景共 4 计数 | [final-backend.txt](raw/final-backend.txt) |
| `npm run test:protocol` | **21/21 PASS** | [final-protocol.txt](raw/final-protocol.txt) |
| `npm run test:content` | **8/8 PASS**，包含新内容组合上限检查 | [final-content.txt](raw/final-content.txt) |
| 两份 Schema 生成一致性 | 两项退出码均 0；没有生成产物漂移 | [final-static.txt](raw/final-static.txt) |
| 两份 Python 独立 Schema／摘要检查 | 协议 15 正／17 反及 23 日期边界；内容 1 正／4 反；全部符合预期 | [final-static.txt](raw/final-static.txt) |
| 源码和文档收口 | 源码摘要、相对链接、JSON、语法与 diff 检查 | [freeze-check.txt](raw/freeze-check.txt) |

数据库实际版本为 PostgreSQL 18.6，UTF8／UTC，Node v24.22.1；pg 8.23.1、Socket.IO server/client 4.8.4。控制、截止和 Decision 交错使用可信可控时钟；网络与进程故障场景使用正常服务端时钟。它们全部使用真实 PostgreSQL 事务。

### 实际进程故障

父检查进程持续持有 PostgreSQL，服务子进程使用独立连接池。在构造参数提供的钩子中实际 `process.exit`，等待 exit 事件后创建新的服务实例查询／重试。没有把抛异常当作进程崩溃。

| 故障点 | 本次实际子进程／退出码 | 观察结果 |
| --- | --- | --- |
| 所有 SQL 写入之后、COMMIT 之前 | PID 145／71 | 世界、事件、Receipt、outbox 全部回滚；head 不占号，原键查询 null；新连接原样重试按旧 epoch 得到无效果的 STALE_CONTROL |
| COMMIT 成功之后、调用返回 ACK 之前 | PID 159／72 | 没有 ACK，但状态、事件、Receipt、outbox 完整存在；恢复后原 payload／旧 epoch 返回原 Accepted，无第二次效果 |
| 已实际投递批次、发布记录完成前 | PID 173／73 | 已提交世界保留，Pending outbox 仍可恢复；原 Receipt 可读，重新发布不执行世界动作 |

另有“提交后响应异常”检查，验证服务端主动查询原键。该异常检查只是补充，不替代上表的实际进程退出。全部测试子进程和数据库在检查退出前收束；不交接任何 pending exec 句柄。

## 义务到源码及实际场景的映射

下表消费总控已释放的核心／隔离／恢复模型义务，**不构成 TLA+ refinement 证明**。本轮没有重新运行 TLC，没有发布或复制被审批阻止的核心模型原始日志。

| 义务／验收 | 实现位置 | 当前候选的真实检查 |
| --- | --- | --- |
| M0-AC-01、INV-12／13：唯一权威入口、Session 范围、连续序号 | runtime.locked／executeAction／persist；migrations；world.reduceWorld | 跨 Session 读写拒绝；真人与 NPC 同版本抢物；每个事件序号连续；同水位 replay 等于保存世界 |
| M0-AC-02、INV-01：物品唯一位置和同版本至多一次成功 | rules.take_item／transfer_item／use_item；WorldEvent reducer | 两真人转交竞争、真人与 NPC 拿取竞争各只有一个成功；材料只消耗一次，工具保留 |
| M0-AC-03、INV-02／03：当前读权先于旧收据、原 payload 幂等 | runtime.access／authorizeInternal／receipt／executeAction；唯一 Receipt 键 | 同键重试／异 payload、旧 epoch／终局查询、真人及代理撤权后旧结果拒绝；归档保留／删除不重做 |
| M0-AC-04、INV-04／05：原子提交包和提交后 ACK | runtime.locked／persist／publishPending；crash-worker | 三种实际进程退出及新实例恢复；没有孤立世界、事件、收据或区间 |
| M0-AC-05：旧游标与相关版本 | executeAction、rules、decisions | 旧 baseSeq 经无关移动仍可合法提交；相关物品／目标版本拒绝；未来游标拒绝；同 ID 不允许改字段 |
| M0-AC-06、INV-06：连接、epoch 和代理交还 | control／disconnect／maintenance；已提交事件驱动 grants | Human→Grace→Proxy→Human、双连接 resume／take、旧断开、新连接旧 nonce、旧 nonce 不回退当前断开代次 |
| M0-AC-07、INV-08：截止优先和单一终局 | deadline／evaluateEnding／executeAction；终局 reducer | 截止与最终动作两种真实锁竞争顺序只产生一个 ending；正常 Receipt 包含 finished；截止拒绝范围 null；终局后无新事件 |
| M0-AC-08：固定受众、完整区间、准确前缀 | projection、stateAt／subscribe／sync／publishPending | 全隐藏空批次推进；最多 256 全局序号；中间水位仍显示当时区域；离开后移除旧可见物品；旧 view 拒绝 |
| M0-AC-09：读取／错误／NPC 上下文的当前权限 | access／authorizeInternal、projection、server | 无效认证优先；秘密／不存在目标同码；新进入者看不到旧私聊；代理看不到私人频道；HTTP 不能伪造连接 |
| INV-07、M0-AC-10 的基础层：Decision 新鲜度与原子包 | decisions.prepareDecision／submitIntent／settleDecision／submitFallback | 多工具后项失败全拒；generation 替换、相关版本、期限、控制交还、终局取消；稳定 fallback 去重 |
| M0-AC-11 的确定性基础：Fact／Claim／Belief | world、rules、decisions、projection | “已修好”的 Claim 和候选 Belief 均不修复世界；伪造观察拒绝；纯事件回放不运行模型或发布 |
| GP-AC-03／05、INT-AC-07 的规则部分 | 内容装配、修复／许可、证据来源与 endingPolicy | 原材料查证、原材料证据未齐、备用材料、截止未解决；世界效果和来源可追溯到动作／Decision／事件区间 |
| 生命周期 | create／join／start／cancel／abortSession／archiveSession／deleteSession | 房主重复加入、四／五人装配和人数上限、Lobby 取消幂等、终止后不能重开 |

## 小步实现与历史证据

保留 32 份未改写的阶段输出；索引与文件 SHA-256 在 self-check.json。早期接口随实现收敛，阶段输出是当时执行事实，不将其移作最终源码的 PASS。最终结论只使用上方固定源码和最终原始输出。

| 阶段 | 观察与修正 |
| --- | --- |
| 01—05 | 创建／开局、连接控制、收据与物品、分型与受众、材料机制逐行为先失败后实现；见 [01 红](tdd/01-lifecycle-red.txt)、[01 绿](tdd/01-lifecycle-green.txt)至 [05 绿](tdd/05-materials-green.txt) |
| 06—09 | 内部行为及终局、当前权限、过滤批次、真实网络逐步完成；[08 首次实现](tdd/08-sync-first-attempt.txt) 暴露 jsonb 键序导致伪投影变化，修正为稳定数组顺序后通过 |
| 10 | [首次故障检查](tdd/10-crash-red.txt) 是测试驱动尚不存在的工具错误，不作为业务红灯；补齐驱动后实际子进程退出通过，见 [10 实际运行](tdd/10-crash-green.txt) |
| 11—12 | Decision 围栏；[12 红](tdd/12-current-authority-red.txt) 实际暴露旧 nonce 回退断开代次及代理旧收据绕过当前权限，两项修正后通过 |
| 13 | 收敛为只经 Decision 提交内部意图；[首次回归](tdd/13-internal-entry-first-attempt.txt) 暴露终局因果丢失 toolCallIndex，随后保留最后效果完整 cause |
| 14 | [边界红灯](tdd/14-boundaries-red.txt) 暴露认证优先、未解决结局事实和提交后结果查询缺口，修正后通过；分页与相关版本在补查时原已通过，没有制造红灯 |
| 15—16 | 终局竞争、四类结果、人数装配补查原有行为通过；最后补齐 Lobby 房主取消，见 [取消红](tdd/16-cancel-red.txt)／[取消绿](tdd/16-cancel-green.txt) |

阶段采用本仓 worker-implement 的 TDD 方法，没有声称调用外部人工专用技能。

## 未覆盖及下一步

本次没有独立需求／标准审查，也没有新的正式模型检查、源码 refinement 证明、真实模型输出、供应商接入、NPC 自主行为或 AI 质量结论。内部意图与 fallback 检查由确定性的可信测试构造输入，不计真实 AI 体验。

没有把 Socket.IO 技术检查当作前端最终候选集成，没有执行五客户端 900 秒，也没有两人／五人真人试玩。真实数据库证据覆盖服务进程退出，不覆盖 PostgreSQL 自身宕机、宿主机断电、主备切换、长期容量或生产 SLO。

固定候选交回总控，先执行独立需求／标准审查；满足释放条件后作为 #8／#9／#11 的集成基础。五客户端、真实模型和真人整体验收继续由对应 Ticket 与 #12 汇总。当前没有推送、PR、合并、部署或源分支删除操作。
