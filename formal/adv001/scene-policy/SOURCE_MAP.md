# 固定源码与抽象转移对应

> 本页“当前源”、逐转移对应和 TLC 结果限定于原 955 阶段。CUI-OBS-01 对 gaolao-rules 的新增朝向写回及相关依赖闭包，另见 [有限来源复核](../facing-source-review.md)。旧来源清单保留原摘要；新记录只说明已审查覆盖切片仍适用，不能把本文历史字节相同说明或 64 项结果解释为新候选重新运行。

绑定文件见 [source-files.json](source-files.json)。当前源是 `955850241093332353cbb8b84fc2a7df40ecb827` / 树 `b23c8f7aa296799c38767a2cb438bcc98602582c`；直接 parent 为 7f，生产变化仅 14+/5-。公开同树源为 `a217805297139d9a3f2905ce864a64585f78fc7f`，发布对应依据交接记录。范围仅为高老庄首章的当前机制及前院/茶棚分支，不涉及后续章节。下表的 `IN_SYNC` 表示有限只读对应已经核对，必要请求 TLC 已完成；它不是机器检查的源码精化证明。已覆盖范围 `ASSESSED_WITHIN_SCOPE`，整体仍为 `PARTIAL`。

| 模型转移/事实 | 固定源码位置与对应 | 状态与边界 |
| --- | --- | --- |
| `Start` 的 `a.semantic` / `a.callBootstrap` | `backend/scene-policy-runtime.mjs::run` 在普通评估调用入口传 `{semanticSeq:a.pendingSemanticSeq}`，值复制后才等待数据库读取；`backend/runtime.mjs` 只转发该私有参数 | IN_SYNC；`callBootstrap` 只是进入原因的 ghost 记录；来源是已过滤通知；原子参数校验为合法 seq 且不大于实际读态 |
| `Evaluate` / 未收束原请求优先 | `backend/scene-policy.mjs`：`prepareScenePolicy` 先授权并查询 `scene_outcome IS NULL`，再独立读取当前上下文 | IN_SYNC；SQL 原子性及单主体唯一索引继承实现前提 |
| `RequestImmutable` / `AttemptLinked` | `prepareScenePolicy` 保存完整请求、basis；新的同一步尝试使用新 actionId、摘要和实际评估水位，`previousIntentId/attempt` 指向旧记录；不更新旧行的 request/basis | IN_SYNC；模型使用离散身份 token，UUID/摘要编码算法未形式化 |
| `receiptSeq` / `outcomeSeq` / `RecoveryRead` | `executeSpatial` 在原 Session 行锁事务内确定结果并保存原 `observedSeq`；`recoverScenePolicy` 在当前读权、原 actor/digest 核对后把原 publicReceipt 复制至 `scene_outcome` | IN_SYNC；不能用恢复返回时的最新世界 seq 替代原拒绝水位；原字段和收束副本均由不变量检查 |
| `Submit` 的原 Receipt 优先 | `backend/spatial-runtime.mjs`：`executeSpatial` 先检查原 Receipt 的 actor/digest，再执行首次 `options.validate`；场景提交传入 `revalidateScenePolicy` | IN_SYNC；不能将恢复查重错误地置于新 basis 校验之后 |
| `Projection` 与权威 `DecisionProjection` | `7f48f5f` 的 `actionGuardNames`、`sameChoiceBindings` 同时用于 prepare 去重和原子重验；完整 guards 仍保留 | IN_SYNC，限动作相关与共同依赖的抽象；不是逐项证明完整 P2 选择表 |
| `External` / `Deliver` | `scenePolicyWake` 对提交前后白名单依赖比较；`Runtime.locked` 只在提交后发私有通知；控制器另外折叠 `spatialPauseBefore` 的真实 resume | IN_SYNC；不证明白名单已覆盖所有未来事件、不保证跨进程送达 |
| `NewSignalAfterRejection` / `KnownResult` | 955 对相同有效依据的旧 Rejected 检查入口 `semanticSeq > scene_outcome.observedSeq`；Accepted 仍持久去重，当前纯选择必须有动作；真实依据变化保留原路径 | IN_SYNC；模型独立的 `RejectedAttemptAuthorized` 使用原 Receipt 水位及真实已送达信号检查资格，不能由实现的错误全局水位定义真值 |
| `Evaluate` 的 `waiting/consumeThrough` | 仅旧 Rejected、相同依据且没有更晚已接收信号的等待分支返回 `consumeThroughSeq=semanticSeq`；实际 `evaluatedThroughSeq` 保持真实读态 | IN_SYNC；Start→Evaluate 可插入 resume 提交/通知，Evaluate→Consume 可插入迟通知 |
| `Consume` / `Deliver` | `run` 唯一调用 `consume(a,prepared.consumeThroughSeq??prepared.evaluatedThroughSeq)`；同一界线推进 last、清已覆盖 pending，通知以 last 过滤 | IN_SYNC；真正 NoAction、成功预留及成功步骤缓存仍确认实际读态；纯恢复不确认新语义 |
| 历史 `cached-rejection` 变体 | 模型保留旧 7f 的缓存拒绝分支及其吞信号行为 | HISTORICAL FAIL；不作为 955 的当前行为；旧 282 状态反例与新细化 390 状态反例分别保存 |
| `Unknown` / `Retry` / 启动恢复 | 控制器 `needsRecovery`、三次定时恢复、显式恢复及一次启动扫描 | IN_SYNC；原 Rejected COMMIT 返回丢失时先原恢复，再按独立 pending 评估；完整进程重启与永久故障没有活性结论 |
| `ExecutionLinkCurrent` / `Accept` | `game/gaolao-rules.mjs` 在接受后把实际新 consent/plan 版本及原 action/digest 写入 `policyRoute.acceptance` | IN_SYNC；basis 不回写；真实版本计算是继承前提 |
| `Propose` / `OriginAndSources` | `game/gaolao-policy-route.mjs`：`createPolicyRoute` 从当前真实位置重新判 B 优先、来源和退出要求 | IN_SYNC；有限区域抽象不证明多边形实现 |
| `Advance` / `Fence` | `advanceGaolaoFollow` 先检查实际许可、双 epoch、地图、接受关联，再验证领路者路线和本人路径；不合法即保持最后合法位置并暂停 | IN_SYNC；`WholeSafe` 和 `Available` 是抽象谓词，连续几何/在线条件仍由实现验收 |
| `ExitBySubject` | 本人实际运动到 C13 且位于公共地面后才设置 `frontExitDone`；领路者可以先行但不能替代本人退出 | IN_SYNC；实际坐标等值、全段几何须由真实布局检查 |
| `CheckArrivedLeader` / `Confirm` | arrived 未 settled 仍经过领路者路线检查；确认准备与实际提交分别重验当前许可、版本和真实到达 | IN_SYNC；模型保留旧回调和新安排的交错 |
| 直接模型成本零 / 间接唤醒 | 场景控制器不调用 Gateway、ai_runs 或三 NPC 预算；合法世界事件仍可进入正常 NPC 信息流 | IN_SYNC 架构对应；成本模块本身继承已验前提 |

## 依赖投影不能删除共同围栏

`7f48f5f` 对 response 保留 authorized、versionsCurrent、leaderHuman、leaderOnline、near、visible、los、inRoute、localPathReachable、doorOpen；对 withdraw 保留 authorized 并重新判断当前 P2-09；settlement 保留 authorized、versionsCurrent、arrived、exitReachable；退让确认保留 authorized、atRetreat；退让导航再保留 retreatReachable。

各类动作均继续比较内容/章节/地图、本人资料、consent/follow/routeDigest、双方 epoch、view/selfRef/resourceRevision。通知新增本人资源版本、当前跟随领路者 epoch 和 proposed 局部路径资格；普通每坐标变化不是普遍语义信号。模型的 `drop-common`、`miss-wake`、`global-seq` 分别检查删除围栏、漏相关通知、扩大到全局序列的风险。

## 原子性、输入与外部证据边界

`Runtime.locked` 先获取连接，再 BEGIN / `SELECT ... FOR UPDATE`，在同一事务执行操作、持久化、COMMIT，随后才通知和返回。模型把该事务视为原子转移，保留入口捕获之前、读取之前、COMMIT 后返回之前和通知迟到的独立时序。实际锁实现、SQL 隔离和唯一索引正确性仍由实现验收承担，不因为函数名含 locked 就视为已证明。

生产 `semanticSeq` 调用点只有控制器普通评估入口；私有参数不加入请求、basis、WorldEvent 或 DTO。模型按真实已投递合法信号构造输入，不能推出完整授权算法的正确性。独立复审报告在固定 955 上记录两份逐字原 probe、三个真实窗口和权限/输出边界共 6 项 PASS；本任务仅读取和绑定它们，未运行产品。公开注入、伪句柄、未来水位及真实 PG/Socket 由这些外部证据覆盖，不能计入 TLC 项数。

17 项跟随结果继续绑定相同 `SceneFollow.tla`、配置和清单；`gaolao-policy-route.mjs`、`gaolao-rules.mjs`、`gaolao-scene-policy.mjs`、`spatial-runtime.mjs` 与旧已读范围逐字相同。没有为本轮重复运行路线或旧 recovery 40 项。两个模型仍未做组合精化；连续几何和完整动作决策表保留边界。
