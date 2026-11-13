# 恢复后新候选的只读源码对应

## 固定对象与结论

本次重新读取的源码为 `0ac2bf5f34e49f4508daac74b1d6b38196f15ad6` / tree `047cdcc3a4a2a7239e29e66b31796d5098e6c491`，parent 为 `316ede70eb26133c743ad49f6d294d4ca5be2b89`。不是旧 `8df/77546` 整树。实际读取的 10 个文件与 SHA-256/Git blob 见 [project-profile.json](project-profile.json)。本次没有执行真实业务测试或修改产品代码。

**已覆盖转移 `IN_SYNC`，整体源码对应 `PARTIAL`。** 模型与新源码在下述状态所有权、步骤和成功路径相符；SQL 幂等/权限模块内部、完整新推理失败恢复及 provider 真实网络取消未做细化证明。模型通过不能被表述为完整实现 verified。

## 恢复来源需要保留的区别

| 文件 | 本次完整 Git blob | 来源与本次核对 |
| --- | --- | --- |
| `backend/ai/orchestrator.mjs` | `adc051b3ead230d3c1c29376dcd40884fc941062` | 与已记录历史 blob 一致；本次重新读相关转移 |
| `backend/runtime.mjs` | `6e4c442b9e068ee489e7a63e74e1854362609dce` | 与已记录历史 blob 一致；重核事务前态与提交后通知 |
| `backend/ai/spatial-runtime.md` | `23e7172e78c6c792808b5a467e4796685c569c31` | 与已记录历史 blob 一致；契约不改变 |
| `backend/ai/spatial-decisions.mjs` | `49e61f419d7798ebff9e71da9019639198471e94` | 001 分类和确认逻辑为本次重建的 13+/2-，不声称逐字找回旧全文 |
| `backend/decisions.mjs` | `f201ff0759a19d1357ef4466dbd04ea85ce1528e` | 与本次 parent 一致；历史另一 blob 无对象可读，不能证明旧版本等价，但当前实际接口可核 |

原 `da7f297` 对象与原运行日志不可读。本次模型和 manifest 已按精确历史工具输入恢复并匹配旧摘要；这不证明完整旧提交或旧产物都已恢复。所有 TLC 结果是本次重新产生。

## 状态和原子步骤

| 模型动作／性质 | 当前源码事实 | 判断 |
| --- | --- | --- |
| `MakeTx`、`Commit`、`Deliver` | `buildTransaction` 保留解码后的 `tx.row.state`，以 `structuredClone` 建立可变 `tx.state`；`locked` 在真实 COMMIT 后发送 `spatialPauseBefore: tx.row.state.paused`。后续 effect/hook 可以延迟通知 | `IN_SYNC`。模型不假设 COMMIT 与通知同步相邻 |
| `NotifySemantic` | `spatialResumes` 用事务起点折叠本批所有 clock，只把 true→false 记为 resume。原 `spatialWake` 保留本人观察、可见陈述、相关目标/控制变化等筛选 | `IN_SYNC` 于水位入口；完整相关性/隐私算法为既有前提 |
| `Deliver`、`PendingSemanticPreserved` | `#onCommit` 先按 `sessionSeq > lastSemanticSeq` 去重，再推进 `lastSemanticSeq` 与 `pendingSemanticSeq`；与恢复读是否开始、完成无关 | `IN_SYNC`。普通 false→false、无关移动和重复旧通知没有新触发权 |
| `RecoveryRead/RecoveryReturn/FinishOld` | 当前 `recoverDecisions` 授权后按 Session/actor/principalKind 查询原 decision/run，返回这两个成员；orchestrator 不消费 `sessionPaused`。恢复路径不清 pending，空间旧请求收束后提前返回 | `IN_SYNC`。历史 decisions 文件身份冲突不被当作已解决；本次只判断当前接口和调用关系 |
| `OriginalRequestPreserved`、`UnknownKeepsOriginalOutcome` | 先查原 Receipt，原 raw 解码并核对原语义摘要；仍以原 decisionId 提交，原导航序号来自持久 record。技术查询错误保持原 Unknown；确定权限/规则/合同错误透传 | `IN_SYNC` 于本次分类与调用关系；摘要与数据库原子性仍是前提 |
| `AutomaticRetryBound` | `#run` / 显式 `recover` 仅在 `OUTCOME_UNKNOWN` 且 `++retries <= 3` 时置技术 dirty；`queued` 挂起 Unknown/Unavailable/BudgetExhausted 的纯 pending | `IN_SYNC`。模型数已经启动的自动重试，源码字段数失败；源码第四次失败值为 4 并不表示启动了第四次自动重试 |
| `StartNormal`、`ReadContext` | 旧结果收束后 Idle 中 pending 获得独立正常周期；`prepareSpatialDecision` 在事务内核当前模式/运行态/paused，保存授权快照及 `baseSeq` | `IN_SYNC`。全体角色公平/共享并发预算沿用 #27 前提 |
| `ReserveNormal` | `reserveCall` 在独立 Session 事务中核主体、Pending、epoch、运行态、deadline、context digest 和持久预算，成功预留后提交 | `IN_SYNC`。不重验 paused；守卫绑定提交点而不是返回时 |
| `AdmitNormal`、`OnlyContextConsumes` | 成功 reserve 返回后，同步将 last 提到 `context.baseSeq`，只在 pending ≤ baseSeq 时清空；该同步段没有 await | `IN_SYNC`。prepare/成功reserve/返回消费三步间都可插入新通知，新水位留给下一轮 |
| `NormalDenied` | reserve 的 STALE 是普通 `reserved:false`，收束取消后正常返回；没有 error 时 finally 回到 Idle。明确授权拒绝才进入 Unavailable | `IN_SYNC`。此前把 STALE 错建成永久 Unavailable 的活性反例是模型错误，不是产品 bug |
| 终态 | `#onCommit` 收到 finished/aborted 后清 pending/dirty、置 ended、abort controller，阻止后续新调度 | `IN_SYNC` 于停止新接纳和水位清理；已有成功预留的调用分支另见边界 |

## 本次重建的 001 分类

`isSpatialRecoveryUnknown` 对 `RuntimeError` 仅接纳 `OUTCOME_UNKNOWN`；`RuleError` 和 `ContractError` 不作为技术未知；其他错误（例如原生 PG 查询异常）可保留技术 Unknown。`protocol/node.mjs` 重导出 `protocol/index.mjs`，与空间解析器引用同一 `ContractError` 定义。

`confirm` 只在原 operation 已是 `OUTCOME_UNKNOWN` 时查询原 Receipt。二次查询若为确定拒绝，透传该拒绝；若是技术故障，重抛原 Unknown，既不返回成功，也不把旧结果写成 Rejected。找到 Receipt 后仍比较语义摘要。`#recoverActor` 对已有空间决定的后续技术查询故障同样保留 Unknown，原 work/raw/身份仍在。当前这些分支满足模型的“技术失败不改变原确定结果、不创建新请求”义务；本模型不形式化证明 JavaScript `instanceof`、所有依赖错误类型或 SQL 执行语义。

## 暂停与授权的准确边界

1. 已暂停时不新 prepare：`prepareSpatialDecision` 抛 `SESSION_PAUSED`，对应 `ReadContext` 要求未暂停。
2. 在 prepare 之后暂停：已有 context 可以继续 reserve/进入调用分支；`reserveCall` 没有 paused 守卫。模型不添加更强政策，`witness-prepared-pause` 保留其可达性。
3. 实际动作仍由 `game/spatial-rules.mjs` 按暂停允许项/拒绝执行；本模型没有重新验证全部动作类型或世界效果细节。

当前权限、epoch 和运行态保证绑定成功 reserve 的提交点。若其后、返回消费之前发生撤权或终态，源码可能仍执行 `calls++` 和带已 abort signal 的 Gateway 分支。模型 calls 表示进入该分支的次数，不代表外部供应商网络请求数，不能从本报告推出这段窗口零成本。

## 未覆盖和返回条件

- 模型的旧原请求只有一份；成功 reserve 后发生 COMMIT 返回异常、保存输出/保存 outcome 失败等完整新请求恢复，没有与所有通知状态组合。
- pending/last 是进程内水位，不是持久队列；跨进程丢通知、注册前事件、永久通知失败或永久不调度不在活性保证。
- 显式普通 wake 可以独立要求规划；本模型显式操作仅覆盖旧请求的显式恢复，不能用普通事件零调用保证否定用户显式 wake。
- 原 SQL 一次效果/Receipt、完整授权投影、原摘要/文字编码、真实动作暂停围栏、共享调度和预算模块内部均为继承前提；任意规模、外部模型质量和全 A3 不在范围。
- 源码对应是工程核对，不是 refinement 证明；runner 的 `implementation_status` 保持 `NOT_ASSESSED`。独立业务标准轴已有另一份新报告，但本工作不把其测试写成本人的执行。

改变通知来源/相关性、顺序保证、baseSeq 含义、成功预留与消费边界、错误分类、重试身份、权限/暂停/终态门槛或部署多编排器时须返回模型重评。当前范围达到交接条件后停止扩展。
