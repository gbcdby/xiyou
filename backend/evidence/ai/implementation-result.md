# Ticket #9 受控实现与作者自查

## 结论与固定对象

**已完成本次授权的受控实现及必要作者自查。真实模型闭环仍为 BLOCKED／NOT_RUN，实际外部模型调用为 0；不释放 `single-ai-runtime`，不宣称 VER-04 整项完成。** 独立需求／标准审查尚未由本作者执行，交由总控安排。

- Ticket：[Issue #9](https://github.com/gbcdby/xiyou/issues/9)，`work_id=vs001-p06`。读取的范围快照保留于 [ticket-input.json](ticket-input.json)；该快照中的历史计划状态不是本次 GitHub 当前状态声明。
- 固定 Spec：`6c2a0b9f6d137ad5fbd41721659404333ad8e16d`，对应 M0 感知／Decision／代理、玩法目标／信念和 VER-04 的本票范围。
- 运行基线：`5d3e16fa46c4719471092d0567e9bfd1e28737f7`，tree `3ffdfeb5a9e1ea084ca0b487996c15b5bda2c929`。总控已释放 #6；原 `e32c579` 与 review-fix-r1 证据保留原身份、原字节，没有重写旧结论。
- **本轮被测源码**：`726e96edff61f71caa2123494f2e9f6795e4a6ca`，tree `1a9ea3a5f52e8b3ec0b7410989a6ede27ee97f14`。包含本报告及证据的最终提交由 Git HEAD 和总控交接确定；后续证据提交不改变被测源码。
- 80 个源码／输入文件的汇总 SHA-256：`4690d0fa76196fb6d44350ca380c73c25b24e42876d121bcc62f6b932b99db67`，算法与逐文件值见 [source-manifest.json](source-manifest.json)。
- visibility／fallback 实施义务固定读取 `2a23c6ea31ea04dee9271612afe9c4248e93efb9`；没有重跑无关 TLC，没有修改 Spec、协议、内容或正式模型，没有复制／上传受阻的 core 原始日志。

## 实际改动

原子 `prepareDecisionContext` 在同一 Session 锁内复核当前主体、处理截止、更新可信目标、形成过滤上下文及相关版本、保存 Decision。目标事件之后再固定水位；推理不在事务内。旧 `observeInternal` 和 `prepareDecision` 的独立调用契约保留；此前发现的是 #9 组合静态风险，并不是一次新的 #6 确认失败。

`context.mjs` 按 Session／角色／主体种类读取合法 Memory，保留 Observation、Claim、Belief 的不同含义。目标由当前 objective 和可见目标的检查状态确定性派生；已有 Goal／GoalUpdated 不扩字段，来源／策略／版本放内部 `ai_goal_sources`。只在目标或来源语义变化时写世界事件。目标在原子准备时刷新，来源水位表示已确认依据；预算耗尽后不把旧来源宣称为实时全知状态。没有模型 goalUpdates，也没有 #10 人格与分歧策略。

`gateway.mjs` 仅接收过滤上下文与共享工具 Schema，严格解析原始输出，保留原文和摘要。供应商使用注入接口，默认没有外部供应商配置；超时／取消与供应商 Promise 竞争，忽略 Abort 的迟到结果不会再次完成请求。`orchestrator.mjs` 按角色保持单在途、合并通知，限制并发、请求结束后的最小间隔以及持久本局预算。事件只作唤醒提示；最终写入仍由 Runtime 当前权限、generation、epoch、期限和版本裁定。

`ai_runs` 在模型调用前预留本局预算并保存合法上下文，提交前保存原始有效输出与完整摘要。Unknown 先查原 Receipt 并比摘要；不存在时重试原 ID／原文，不能直接改拒绝或 fallback。失败决定和缺失 Receipt 推导稳定 fallback，恢复没有新增队列服务。纯恢复显式关闭自动唤醒，避免恢复旧效果时额外启动模型；在途恢复结果丢失时保留原原因键和 Unknown。运行与关闭方式见 [AI 模块说明](../../ai/README.md)。

## 固定源码的最终检查

所有最终检查于 **2026-11-11 09:08:39 UTC** 启动。记录直接保留实际命令、退出码／信号、源码摘要与原始输出，没有用进度断言数代替进程结果。

| 检查 | 实际结果 | 原始输出与执行身份 |
| --- | --- | --- |
| 完整后端，真实 PostgreSQL／HTTP／Socket.IO | **82／82，PASS**；含原 38 项回归及新增 44 项；退出 0，信号空 | [TAP](raw/final-backend.log)、[执行记录](raw/final-backend.json) |
| 共享协议 | **21／21，PASS**；退出 0，信号空 | [原输出](raw/final-protocol.log)、[执行记录](raw/final-protocol.json) |
| 内容装配 | **8／8，PASS**；退出 0，信号空 | [原输出](raw/final-content.log)、[执行记录](raw/final-content.json) |
| 协议／内容生成一致性、独立 Schema 检查、diff 检查 | **PASS**；每项退出 0 | [原输出](raw/final-static.log)、[执行记录](raw/final-static.json) |

完整后端命令与根 `test:backend` 的测试集合和 `--expose-gc` 相同，额外指定 TAP reporter，以保留文件级异常的 exitCode／signal。此次固定源码整套只执行了一次，未出现文件级异常。早期过程中的失败／中止另外保留，见下节。

环境为 Node 24.22.1、PostgreSQL 18.6、pg 8.23.1、Socket.IO 4.8.4。最终 8 个真实 PostgreSQL 集群均记录正常 shutdown；5 个 AI 故障子进程真实退出码分别为 81–85，信号为空。原运行层的 71–73 崩溃回归也在同次 82 项中通过。全部自有执行句柄已收束，详情及数据库原日志入口见 [进程生命周期](process-lifecycle.json)。

## 七组风险及实施义务对应

| 范围／义务 | 实现位置 | 当前候选实际证据 |
| --- | --- | --- |
| 同锁同水位上下文、可信目标与回放 | `decisions.mjs`、`ai/context.mjs`、`002-ai.sql` | `ai-context.test.mjs`：竞争写入真正进入 PG Lock 等待；上下文／相关版本对应同一回放前缀；检查推进目标 revision，无关事件不制造目标事件，终局不补写 |
| 推理不阻塞真人；单在途、并发和间隔 | `ai/orchestrator.mjs`、`ai/gateway.mjs` | Runtime 与真实 Socket 的玩家都在模型未返回时得到 Accepted；全局并发 1 的受控检查、20 次合并唤醒、实际调用间隔、本局预算重启保持 |
| 当前视野／历史 Memory／跨局／私人频道 | `ai/context.mjs`、既有 projection | `ai-network.test.mjs` 实际 Gateway 输入断言：另一 Session、他人 Belief、真人私聊均不进入；合法传播产生新 Observation，旧受众不改写；离开后保留来源但移除旧当前视野 |
| 非法 JSON、重复键、未知工具、伪造字段和观察 | `ai/gateway.mjs`、共享严格解析、既有 Validator | 真实服务九个受控坏输出场景；非法格式在解析前拒绝，合法格式但目标／观察无权得到确定拒绝；原意图没有 WorldEvent |
| 取消、过期、交还、终局、撤权 | Orchestrator 生命周期与 Runtime 当前检查 | 新 generation、权威过期、Session 结束、真实 Socket 交还、成员撤权后结果均不能执行；原 Decision 不复活；撤权后新上下文和恢复读取也拒绝 |
| 相关版本与无关 seq；包级原子性 | 原子准备自动读集合、既有 `submitIntent` | 相关目标真实修复导致 DECISION_STALE；无关观察／seq 增长仍能提交；拿取后转交使用批内新版本；第二工具旧版本错误时第一工具及对白全部回滚；重复回调读同一 Receipt |
| 超时、Unknown、持久 fallback 与恢复生命周期 | `ai/persistence.mjs`、Orchestrator 恢复、既有 fallback | 实际受控超时、忽略 Abort 后关闭有界、迟到结果无效、新 ID 重新规划；原文落库／fallback 提交前后／原意图提交后／发布中真实进程退出，新 Runtime 原键恢复且不发起新模型调用 |

对应 Ticket 的 M0-AC-09／10／11、INT-AC-04／07、GP-AC-02／07 及 VER-01／03／04／07，只报告本票受控实现覆盖。共享验收编号的整体结论仍由后续总控核对；尤其 INT-AC-04／VER-04 的实际模型部分没有通过。

## 实际关联输入、结果和受控指标

- [network.json](captures/network.json)：真实网络检查中的 Session 内容摘要、过滤上下文、目标来源、Decision、供应商配置、原始输出、完整语义摘要、Receipt／fallback 和模型关联事件。实际 provider 收到的克隆上下文另由测试直接断言隔离及白名单一致。
- [orchestrator.json](captures/orchestrator.json)：调用预算、间隔、未知结果、超时、关闭与恢复的实际记录和 Gateway 指标。
- [crash.json](captures/crash.json)：5 个真实退出点、实际退出码／信号、供应商入口调用计数和恢复后的持久结果。
- [metrics.json](metrics.json)：带口径的汇总。提示词和工具 envelope 固定于被测 Gateway 源码及共享 Schema，版本／文件摘要一并保留，没有拿另一次候选的输入补作本轮证据。

本次真实数据库／服务及崩溃检查发生 **38 次受控供应商调用**，其中格式合法 26、格式非法 7、超时 1、取消 4；实际外部调用 **0**。合法格式的原提交产生 Accepted 14、Rejected 12，说明格式合法不等于获准执行。格式非法率为 `7/38 = 18.42%`，这是有意安排故障的样本分布，不是模型质量估计。

持久耗时样本 37 条，p50 **1.4 ms**、p95 **39.89 ms**。另 1 次模型调用在成员撤权后无权再写新诊断结果，留下原 Reserved 预留；取消由 Gateway 指标观测，Decision 已 Cancelled，真实进程和请求均已收束。该记录不表示仍有活动调用。分位数只针对 37 条样本，既不补造缺失值，也不能推广到真实模型延迟。本口径不包含独立 Gateway 单元检查的额外受控调用。

## TDD 与失败历史

| 行为 | 实际红灯 | 后续绿色证据 |
| --- | --- | --- |
| 原子上下文和持久目标 | [缺少新 API](raw/context-red-01.log) | [首项通过](raw/context-green-01.log)，[三项当前检查](raw/context-current-03.log) |
| Gateway 超时／关闭 | [缺少新模块](raw/gateway-red-01.log) | [对应通过](raw/gateway-green-01.log) |
| 异步调度闭环 | [缺少新模块](raw/orchestrator-red-01.log) | [真人先取得 Receipt](raw/orchestrator-green-01.log) |
| 持久失败恢复 | [缺少恢复入口](raw/recovery-red-01.log) | [对应通过](raw/recovery-green-01.log) |
| Unknown 原文／摘要恢复 | [新实例未读回旧 Receipt](raw/unknown-red-01.log) | [持久恢复通过](raw/unknown-green-01.log) |
| 实际调用间隔 | [配置 150 ms 实测约 45 ms](raw/interval-red-01.log) | [对应修正通过](raw/interval-green-01.log)；最终源码进一步在请求结束后保留完整间隔，82 项复核通过 |
| 纯恢复关闭自动唤醒 | [恢复效果触发额外调度](raw/recovery-only-red-01.log) | [5 个真实退出点通过](raw/recovery-only-green-01.log) |
| 显式恢复保持 Unknown | [错误显示 Idle](raw/manual-unknown-red-01.log) | [原键与未知状态保持](raw/manual-unknown-green-01.log) |

早期阶段在独占工作树逐项红绿，尚未逐阶段创建源码提交；这些原输出只作过程历史，不能替代最终候选的源码摘要与整套绿色。最终检查记录逐文件摘要并与当前源码读回比对。

还保留以下非产品红灯，不写成通过：

- [context-current-02.log](raw/context-current-02.log)：测试屏障把钩子 `command` 写成 `kind`，该执行被人工中止，工具退出 130，未捕获子进程信号；没有正常 PG shutdown 日志。修正后取得真正行锁等待及通过证据。执行单元已结束，旧监听端口后续实测连接拒绝；见生命周期记录。
- [network-current-02.log](raw/network-current-02.log)、[network-current-03.log](raw/network-current-03.log)：新增测试误用角色初始位置／能力，并把共享协议已前置拒绝的 AI 私聊误期望为领域 Receipt；另把交还后的正常 Unavailable 状态误限定为 Idle。依据固定 fixture 和共享解析器修正测试前置／断言，没有放宽协议或删除世界效果检查。[针对性修正检查](raw/network-current-04.log)和最终 82 项均通过。
- [crash-current-01.log](raw/crash-current-01.log) 保留纯恢复自动唤醒问题的首次实际表现；其中已通过的其余退出阶段不被覆盖或改写。

原运行层 review-fix-r1 中曾有“断言全绿但文件进程失败”的旧候选历史，本轮不替它编造根因或改写为通过；本次固定源码的最终 TAP 与退出记录完整且没有同类异常。归档的 [运行器](tooling/run-check.py)和[静态检查命令](tooling/check-static.py)保留实际取证方法；复现时应复制到自己的任务临时目录，或直接使用模块说明中的测试命令。

证据冻结后的全量 diff 空白检查仅命中原始 TAP／PostgreSQL 日志自带的尾随空格及末尾空行，非零退出记录见 [原警告](raw/evidence-whitespace-check.log)及[检查口径](raw/evidence-whitespace-check.json)。为保留原输出和摘要，没有裁剪这些字节；源码范围排除版本化原始证据后检查退出 0。上表静态 PASS 对应归档前的被测源码，不冒充归档日志没有空白警告。其他产物读回见 [审计结果](audit.json)。

## 剩余边界与交接

实际供应商、endpoint、模型标识、凭据引用和费用授权均缺失，因此真实模型项 **BLOCKED／NOT_RUN**。本次没有主动发现凭据、发起外部模型调用或替用户选择费用。受控 provider 证明接口、事务和信息边界，不能证明自然语言真实性、提示注入下的模型质量或人物表现。

本票没有实施 #10 双 NPC 策略、#11 完整局、#8 真实浏览器联合检查／900 秒、两人／五人真人验收，没有推送、PR、合并、部署或整体 Spec 完成声明。没有把作者自查当成独立审查。后续动作是总控针对固定候选进行需求／标准两轴审查，保持实际模型阻塞项，再按已有授权决定后续真实模型输入与执行。
