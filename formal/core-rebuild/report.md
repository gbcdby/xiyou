# M0 核心模型检查报告

**本轮 84 项检查均满足各自预声明判据。** 17 项安全性正配置、3 项活性正配置完整结束；26 项不变量负对照、2 项活性负对照、1 项死锁敏感性及 35 项可达见证取得预期反例。没有把超时、中断或其他性质先失败计为通过。

这是新的有限模型候选的实际 TLC 证据；不复用旧 `31766d6c` 的 67 项或 27,113,004 状态记录。模型设计、假设、分解边界、实现义务与复现命令见 [README.md](README.md)。


**回调次数边界补充（STD-002）：** 当前全部配置最多触发一次 `CallbackAI`，因为 `callbackSeen` 首次回调后不复位。`DecisionSettlesOnce` 仅检查一次收束后的不复活，当前84项不证明同决定第二次／重复回调的去重。已有 manifest、输入和原始输出保持其实际执行身份；重复回调／fallback 另由适用的 #7、#9 和 #12 证据承担。详见 [README §3.1](README.md#31-时间历史及次数边界)。

## 1. 固定身份与分轴结论

| 层次 | 本次结论 |
| --- | --- |
| 模型检查 | `PASS_WITHIN_SCOPE`；逐配置结果如下，不能推广到未声明规模 |
| 敏感性与非真空 | `DEMONSTRATED`；全部启用的 13 个不变量有目标 rc 12，另有实际活性/死锁反例与关键组合轨迹 |
| 源码对应 | `NOT_ASSESSED`；没有实施或运行业务代码、数据库测试 |
| 独立需求/标准复核 | 本次作者交接时 `NOT_RUN`；交外层流程针对固定候选分别审查 |
| 交接材料 | `COMPLETE`，可进入独立审查；不代替 PR ready、合并或发布 |

- 模型/配置源码固定提交：`3fccc1f2888c5f026903306739afa361b568d30e`。本报告和归档为后续证据提交，模型字节保持不变。
- `Core.tla` SHA-256：`bf0838e1b920aa6bb39f99000038c593ef4fad607718cba121e534af2cabf43a`。
- 当前 `verification.json` SHA-256：`88aef88a5ec30603bd9e44ea95bd7534236f5ae064137232db90b5ef21f5a08e`。
- `expectations.json` SHA-256：`574510d976ec71982829acbdf751a3bf2405b4273bb7d1a53c11f80b1e172609`。
- 仓库受控 runner SHA-256：`ca5811a8cae5d31961185b0ba53868f3ea885a1ee614150d873d61044ff18f5a`。
- 工具：TLC 2.19 / v1.7.4，jar SHA-256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`；OpenJDK 21.0.13。
- 所有正式检查均为 BFS、1 个 worker、1,024 MB heap、开启死锁检查，无状态裁剪、VIEW 或对称归约。`live-composed` 预算 360 秒，其余配置 180 秒。
- 83 项取自第二批原始结果；最后组合活性来自同模型/同 `.cfg` 的单项加时运行。两份 manifest 的唯一差异是 `live-composed.timeout_seconds` 从 180 改成 360；归档时逐项检查本次真正生效的 profile 与当前清单完全相同。

## 2. 完整正向结果

所有下列运行均为 runner `PASS_WITHIN_SCOPE`、TLC 原始 rc 0、`completed=true`、剩余队列 0，并达到运行前声明的下限。活性图与安全图的状态数相同并不代表只执行了一次；它们有独立命令、run_id、消息和结果。

| 配置 | distinct states | 预声明下限 | 秒数 | 原始证据 |
| --- | ---: | ---: | ---: | --- |
| `ownership-competition` | 1,696 | 200 | 1.48 | [结果](evidence/current/ownership-competition/result.json) · [日志](evidence/current/ownership-competition/tlc.log) |
| `ownership-idempotence` | 920 | 200 | 1.34 | [结果](evidence/current/ownership-idempotence/result.json) · [日志](evidence/current/ownership-idempotence/tlc.log) |
| `ownership-ending` | 750 | 200 | 1.12 | [结果](evidence/current/ownership-ending/result.json) · [日志](evidence/current/ownership-ending/tlc.log) |
| `ownership-future` | 1,570 | 200 | 1.17 | [结果](evidence/current/ownership-future/result.json) · [日志](evidence/current/ownership-future/tlc.log) |
| `handoff` | 8,512 | 500 | 1.53 | [结果](evidence/current/handoff/result.json) · [日志](evidence/current/handoff/tlc.log) |
| `composed` | 904,868 | 500 | 43.19 | [结果](evidence/current/composed/result.json) · [日志](evidence/current/composed/tlc.log) |
| `ownership-payload` | 296 | 200 | 0.99 | [结果](evidence/current/ownership-payload/result.json) · [日志](evidence/current/ownership-payload/tlc.log) |
| `ownership-publication` | 1,546 | 200 | 1.27 | [结果](evidence/current/ownership-publication/result.json) · [日志](evidence/current/ownership-publication/tlc.log) |
| `handoff-ai-epoch` | 12,452 | 500 | 1.67 | [结果](evidence/current/handoff-ai-epoch/result.json) · [日志](evidence/current/handoff-ai-epoch/tlc.log) |
| `handoff-ai-generation` | 3,160 | 500 | 1.23 | [结果](evidence/current/handoff-ai-generation/result.json) · [日志](evidence/current/handoff-ai-generation/tlc.log) |
| `handoff-ai-revision` | 4,616 | 500 | 1.39 | [结果](evidence/current/handoff-ai-revision/result.json) · [日志](evidence/current/handoff-ai-revision/tlc.log) |
| `handoff-ai-unrelated` | 13,932 | 500 | 1.56 | [结果](evidence/current/handoff-ai-unrelated/result.json) · [日志](evidence/current/handoff-ai-unrelated/tlc.log) |
| `handoff-ai-cancel` | 2,628 | 500 | 1.20 | [结果](evidence/current/handoff-ai-cancel/result.json) · [日志](evidence/current/handoff-ai-cancel/tlc.log) |
| `handoff-ai-invalid` | 2,362 | 500 | 1.21 | [结果](evidence/current/handoff-ai-invalid/result.json) · [日志](evidence/current/handoff-ai-invalid/tlc.log) |
| `handoff-ai-package` | 3,160 | 500 | 1.21 | [结果](evidence/current/handoff-ai-package/result.json) · [日志](evidence/current/handoff-ai-package/tlc.log) |
| `handoff-ai-expiry` | 1,928 | 500 | 1.12 | [结果](evidence/current/handoff-ai-expiry/result.json) · [日志](evidence/current/handoff-ai-expiry/tlc.log) |
| `handoff-ai-terminal` | 4,946 | 500 | 1.31 | [结果](evidence/current/handoff-ai-terminal/result.json) · [日志](evidence/current/handoff-ai-terminal/tlc.log) |
| `live-ownership` | 920 | 200 | 1.16 | [结果](evidence/current/live-ownership/result.json) · [日志](evidence/current/live-ownership/tlc.log) |
| `live-handoff` | 1,928 | 200 | 1.37 | [结果](evidence/current/live-handoff/result.json) · [日志](evidence/current/live-handoff/tlc.log) |
| `live-composed` | 904,868 | 200 | 221.94 | [结果](evidence/current/live-composed/result.json) · [日志](evidence/current/live-composed/tlc.log) |

组合 `composed` 同时启用全部 13 个不变量，完整探索 **904,868** 个 distinct states；`live-composed` 在相同图上检查 `AdmittedRequestResolves` 与 `DecisionResolvesOrExpires`，实际 **221.94 秒**完成。它们均保留两个竞争请求、一个代理决定、丢 ACK、崩溃/恢复、控制交还及期限处理。

## 3. 逐性质敏感性

以下“满足预期”仍保留原始 `COUNTEREXAMPLE`，不会改写成正模型 PASS。安全负对照明确命中其单一目标不变量；活性负对照含实际无限停滞/循环，死锁负对照在非终态禁用动作。

| 配置 | 目标 | 原始 rc | distinct states | 原始反例 |
| --- | --- | ---: | ---: | --- |
| `negative-type` | `TypeOK` | 12 | 6 | [结果](evidence/current/negative-type/result.json) · [轨迹](evidence/current/negative-type/tlc.log) |
| `negative-duplicate_owner` | `SingleEffectiveOwner` | 12 | 57 | [结果](evidence/current/negative-duplicate_owner/result.json) · [轨迹](evidence/current/negative-duplicate_owner/tlc.log) |
| `negative-stale_item` | `SingleEffectiveOwner` | 12 | 390 | [结果](evidence/current/negative-stale_item/result.json) · [轨迹](evidence/current/negative-stale_item/tlc.log) |
| `negative-split_receipt` | `AtMostOneEffect` | 12 | 220 | [结果](evidence/current/negative-split_receipt/result.json) · [轨迹](evidence/current/negative-split_receipt/tlc.log) |
| `negative-payload_overwrite` | `ReceiptPayloadBinding` | 12 | 83 | [结果](evidence/current/negative-payload_overwrite/result.json) · [轨迹](evidence/current/negative-payload_overwrite/tlc.log) |
| `negative-split_bundle` | `AtomicCommitBundle` | 12 | 14 | [结果](evidence/current/negative-split_bundle/result.json) · [轨迹](evidence/current/negative-split_bundle/tlc.log) |
| `negative-split_terminal` | `AtomicCommitBundle` | 12 | 35 | [结果](evidence/current/negative-split_terminal/result.json) · [轨迹](evidence/current/negative-split_terminal/tlc.log) |
| `negative-partial_ai` | `AtomicCommitBundle` | 12 | 112 | [结果](evidence/current/negative-partial_ai/result.json) · [轨迹](evidence/current/negative-partial_ai/tlc.log) |
| `negative-early_ack` | `AckRequiresCommit` | 12 | 6 | [结果](evidence/current/negative-early_ack/result.json) · [轨迹](evidence/current/negative-early_ack/tlc.log) |
| `negative-old_human` | `NoDualControl` | 12 | 97 | [结果](evidence/current/negative-old_human/result.json) · [轨迹](evidence/current/negative-old_human/tlc.log) |
| `negative-stale_disconnect` | `NoDualControl` | 12 | 21 | [结果](evidence/current/negative-stale_disconnect/result.json) · [轨迹](evidence/current/negative-stale_disconnect/tlc.log) |
| `negative-old_proxy` | `NoDualControl` | 12 | 302 | [结果](evidence/current/negative-old_proxy/result.json) · [轨迹](evidence/current/negative-old_proxy/tlc.log) |
| `negative-control_nonce` | `ControlNonceIdempotent` | 12 | 20 | [结果](evidence/current/negative-control_nonce/result.json) · [轨迹](evidence/current/negative-control_nonce/tlc.log) |
| `negative-decision_epoch` | `FreshDecisionOnly` | 12 | 305 | [结果](evidence/current/negative-decision_epoch/result.json) · [轨迹](evidence/current/negative-decision_epoch/tlc.log) |
| `negative-decision_generation` | `FreshDecisionOnly` | 12 | 194 | [结果](evidence/current/negative-decision_generation/result.json) · [轨迹](evidence/current/negative-decision_generation/tlc.log) |
| `negative-decision_revision` | `FreshDecisionOnly` | 12 | 194 | [结果](evidence/current/negative-decision_revision/result.json) · [轨迹](evidence/current/negative-decision_revision/tlc.log) |
| `negative-decision_deadline` | `FreshDecisionOnly` | 12 | 192 | [结果](evidence/current/negative-decision_deadline/result.json) · [轨迹](evidence/current/negative-decision_deadline/tlc.log) |
| `negative-decision_status` | `FreshDecisionOnly` | 12 | 194 | [结果](evidence/current/negative-decision_status/result.json) · [轨迹](evidence/current/negative-decision_status/tlc.log) |
| `negative-ai_terminal` | `FreshDecisionOnly` | 12 | 385 | [结果](evidence/current/negative-ai_terminal/result.json) · [轨迹](evidence/current/negative-ai_terminal/tlc.log) |
| `negative-post_terminal` | `TerminalBlocksNewEffects` | 12 | 116 | [结果](evidence/current/negative-post_terminal/result.json) · [轨迹](evidence/current/negative-post_terminal/tlc.log) |
| `negative-deadline_control` | `TerminalBlocksNewEffects` | 12 | 222 | [结果](evidence/current/negative-deadline_control/result.json) · [轨迹](evidence/current/negative-deadline_control/tlc.log) |
| `negative-sequence_gap` | `ContinuousCommittedSequence` | 12 | 14 | [结果](evidence/current/negative-sequence_gap/result.json) · [轨迹](evidence/current/negative-sequence_gap/tlc.log) |
| `negative-sequence_repeat` | `ContinuousCommittedSequence` | 12 | 97 | [结果](evidence/current/negative-sequence_repeat/result.json) · [轨迹](evidence/current/negative-sequence_repeat/tlc.log) |
| `negative-future_base` | `PreconditionDiscipline` | 12 | 21 | [结果](evidence/current/negative-future_base/result.json) · [轨迹](evidence/current/negative-future_base/tlc.log) |
| `negative-stale-item-precondition` | `PreconditionDiscipline` | 12 | 390 | [结果](evidence/current/negative-stale-item-precondition/result.json) · [轨迹](evidence/current/negative-stale-item-precondition/tlc.log) |
| `negative-decision-finality` | `DecisionSettlesOnce` | 12 | 194 | [结果](evidence/current/negative-decision-finality/result.json) · [轨迹](evidence/current/negative-decision-finality/tlc.log) |
| `negative-no_retry` | `AdmittedRequestResolves` | 13 | 616 | [结果](evidence/current/negative-no_retry/result.json) · [轨迹](evidence/current/negative-no_retry/tlc.log) |
| `negative-no_timeout` | `DecisionResolvesOrExpires` | 13 | 1,396 | [结果](evidence/current/negative-no_timeout/result.json) · [轨迹](evidence/current/negative-no_timeout/tlc.log) |
| `negative-deadlock` | `TLC deadlock check` | 11 | 5 | [结果](evidence/current/negative-deadlock/result.json) · [轨迹](evidence/current/negative-deadlock/tlc.log) |

`negative-split_receipt` 的目标反例之外，另保存了严格效果→崩溃→原键重试→第二次效果的见证，避免只以重复计数代替所要求的故障因果链。原子包和提前 ACK 同样另有后续崩溃见证。

## 4. 非真空与组合轨迹

35 项见证均通过目标否定 `WitnessAbsent` 的实际 rc 12 证明可达。每项均有非空初态，正式 positive 的状态数下限未因运行结果而降低。

最终 `witness-effect-crash-handoff-retry` 为 **19 个状态**，辅助进度从 0 达到 9：首请求效果→第二请求物品冲突→丢 ACK→进程崩溃→恢复后进入 Proxy→决定 Pending→交还 Human→原请求键/原载荷取旧 Receipt→旧 AI 回调被拒绝。它不是只检查两个组件各自成功，动作仍在同一持久状态中交错。此前 21 状态见证属于逐 tick 草稿，不能混作本次轨迹。

`witness-terminal-late-ai` 的 7 状态轨迹包含终局后回调；严格重复效果负例为 9 状态，部分提交包后崩溃为 5 状态，提前成功 ACK 后崩溃为 4 状态。

| 见证 | distinct states | 原始轨迹 |
| --- | ---: | --- |
| `witness-take-success` | 57 | [结果](evidence/current/witness-take-success/result.json) · [轨迹](evidence/current/witness-take-success/tlc.log) |
| `witness-item-conflict` | 390 | [结果](evidence/current/witness-item-conflict/result.json) · [轨迹](evidence/current/witness-item-conflict/tlc.log) |
| `witness-same-receipt` | 139 | [结果](evidence/current/witness-same-receipt/result.json) · [轨迹](evidence/current/witness-same-receipt/tlc.log) |
| `witness-payload-conflict` | 83 | [结果](evidence/current/witness-payload-conflict/result.json) · [轨迹](evidence/current/witness-payload-conflict/tlc.log) |
| `witness-crash-before-commit` | 3 | [结果](evidence/current/witness-crash-before-commit/result.json) · [轨迹](evidence/current/witness-crash-before-commit/tlc.log) |
| `witness-crash-after-commit` | 28 | [结果](evidence/current/witness-crash-after-commit/result.json) · [轨迹](evidence/current/witness-crash-after-commit/tlc.log) |
| `witness-recovered` | 9 | [结果](evidence/current/witness-recovered/result.json) · [轨迹](evidence/current/witness-recovered/tlc.log) |
| `witness-published` | 34 | [结果](evidence/current/witness-published/result.json) · [轨迹](evidence/current/witness-published/tlc.log) |
| `witness-manual-ending` | 35 | [结果](evidence/current/witness-manual-ending/result.json) · [轨迹](evidence/current/witness-manual-ending/tlc.log) |
| `witness-deadline-reject` | 63 | [结果](evidence/current/witness-deadline-reject/result.json) · [轨迹](evidence/current/witness-deadline-reject/tlc.log) |
| `witness-future-reject` | 21 | [结果](evidence/current/witness-future-reject/result.json) · [轨迹](evidence/current/witness-future-reject/tlc.log) |
| `witness-grace` | 4 | [结果](evidence/current/witness-grace/result.json) · [轨迹](evidence/current/witness-grace/tlc.log) |
| `witness-proxy` | 64 | [结果](evidence/current/witness-proxy/result.json) · [轨迹](evidence/current/witness-proxy/tlc.log) |
| `witness-returned` | 18 | [结果](evidence/current/witness-returned/result.json) · [轨迹](evidence/current/witness-returned/tlc.log) |
| `witness-explicit-take` | 5 | [结果](evidence/current/witness-explicit-take/result.json) · [轨迹](evidence/current/witness-explicit-take/tlc.log) |
| `witness-resume-held` | 6 | [结果](evidence/current/witness-resume-held/result.json) · [轨迹](evidence/current/witness-resume-held/tlc.log) |
| `witness-control-nonce-retry` | 20 | [结果](evidence/current/witness-control-nonce-retry/result.json) · [轨迹](evidence/current/witness-control-nonce-retry/tlc.log) |
| `witness-old-disconnect-rejected` | 21 | [结果](evidence/current/witness-old-disconnect-rejected/result.json) · [轨迹](evidence/current/witness-old-disconnect-rejected/tlc.log) |
| `witness-control-reject` | 97 | [结果](evidence/current/witness-control-reject/result.json) · [轨迹](evidence/current/witness-control-reject/tlc.log) |
| `witness-ai-committed` | 107 | [结果](evidence/current/witness-ai-committed/result.json) · [轨迹](evidence/current/witness-ai-committed/tlc.log) |
| `witness-ai-after-unrelated` | 531 | [结果](evidence/current/witness-ai-after-unrelated/result.json) · [轨迹](evidence/current/witness-ai-after-unrelated/tlc.log) |
| `witness-epoch-late-ai` | 302 | [结果](evidence/current/witness-epoch-late-ai/result.json) · [轨迹](evidence/current/witness-epoch-late-ai/tlc.log) |
| `witness-generation-late-ai` | 194 | [结果](evidence/current/witness-generation-late-ai/result.json) · [轨迹](evidence/current/witness-generation-late-ai/tlc.log) |
| `witness-revision-late-ai` | 194 | [结果](evidence/current/witness-revision-late-ai/result.json) · [轨迹](evidence/current/witness-revision-late-ai/tlc.log) |
| `witness-deadline-late-ai` | 192 | [结果](evidence/current/witness-deadline-late-ai/result.json) · [轨迹](evidence/current/witness-deadline-late-ai/tlc.log) |
| `witness-terminal-late-ai` | 385 | [结果](evidence/current/witness-terminal-late-ai/result.json) · [轨迹](evidence/current/witness-terminal-late-ai/tlc.log) |
| `witness-atomic-package-rejected` | 112 | [结果](evidence/current/witness-atomic-package-rejected/result.json) · [轨迹](evidence/current/witness-atomic-package-rejected/tlc.log) |
| `witness-decision-expired` | 193 | [结果](evidence/current/witness-decision-expired/result.json) · [轨迹](evidence/current/witness-decision-expired/tlc.log) |
| `witness-invalid-ai-rejected` | 108 | [结果](evidence/current/witness-invalid-ai-rejected/result.json) · [轨迹](evidence/current/witness-invalid-ai-rejected/tlc.log) |
| `witness-decision-cancelled` | 107 | [结果](evidence/current/witness-decision-cancelled/result.json) · [轨迹](evidence/current/witness-decision-cancelled/tlc.log) |
| `witness-aborted` | 6 | [结果](evidence/current/witness-aborted/result.json) · [轨迹](evidence/current/witness-aborted/tlc.log) |
| `witness-effect-crash-handoff-retry` | 422,002 | [结果](evidence/current/witness-effect-crash-handoff-retry/result.json) · [轨迹](evidence/current/witness-effect-crash-handoff-retry/tlc.log) |
| `witness-effect-crash-retry-negative` | 221 | [结果](evidence/current/witness-effect-crash-retry-negative/result.json) · [轨迹](evidence/current/witness-effect-crash-retry-negative/tlc.log) |
| `witness-partial-bundle-crash` | 28 | [结果](evidence/current/witness-partial-bundle-crash/result.json) · [轨迹](evidence/current/witness-partial-bundle-crash/tlc.log) |
| `witness-early-ack-crash` | 15 | [结果](evidence/current/witness-early-ack-crash/result.json) · [轨迹](evidence/current/witness-early-ack-crash/tlc.log) |

## 5. 历史尝试、范围变化与预算

本轮另归档 **92 次历史运行**；状态统计为 `{"COUNTEREXAMPLE": 66, "INCONCLUSIVE": 5, "PASS_WITHIN_SCOPE": 20, "TOOL_ERROR": 1}`。这些历史输出对应各自输入快照，不能混入当前 84 项。旧项目原受拒绝材料没有进入本目录。

| 历史阶段 | 实际结果与处理 |
| --- | --- |
| 初始宽草稿 | Ownership 在 180 秒超时，保留 `INCONCLUSIVE/TIMEOUT`；另有实际 TypeOK 负对照。随后按 Scenario 拆分独立刺激并归一化客户端已完成管线 |
| 初次组合调用 | jar 参数误用相对路径，runner 明确 `TOOL_ERROR`；改用绝对路径后重新运行，未计作模型反例 |
| 较早局部时间草稿 | Receipt 和组合安全性曾完整结束；组合安全为 2,393,736 distinct。组合活性超时。随后用精确的 30/10/1200 秒参数和事件驱动切点取代旧局部时间草稿 |
| 第一轮完整矩阵 | 82/84 满足当时预期，组合安全/活性两项超时；全部 84 次原始记录保留。最终组合保留故障导致的未确认重发，已确认后额外显式重放留在 receipt/payload 配置 |
| 第二轮完整矩阵 | 当前模型 83/84 满足预期；只有组合活性在 180 秒超时。其余 83 次就是本次正式证据，无须另造同内容结果 |
| 单项活性加时 | 模型、配置、性质、下限、heap 不变，只把该项预算提高至 360 秒；221.94 秒完整完成，替代其当前结论，保留原超时 |

下列失败/超时仍可直接读取；完整历史清单及对应输入见 [evidence/index.json](evidence/index.json)。

- [initial-positive](evidence/history/initial-positive/result.json): `INCONCLUSIVE` / `TIMEOUT`，raw `143`。
- [focused-combination](evidence/history/focused-combination/result.json): `TOOL_ERROR` / `--jar must be an existing absolute file path`，raw `None`。
- [focused-composed-live](evidence/history/focused-composed-live/result.json): `INCONCLUSIVE` / `TIMEOUT`，raw `143`。
- [batch-01/runs/composed](evidence/history/batch-01/runs/composed/result.json): `INCONCLUSIVE` / `TIMEOUT`，raw `143`。
- [batch-01/runs/live-composed](evidence/history/batch-01/runs/live-composed/result.json): `INCONCLUSIVE` / `TIMEOUT`，raw `143`。
- [live-composed](evidence/history/live-composed/result.json): `INCONCLUSIVE` / `TIMEOUT`，raw `143`。

## 6. 证据完整性与实现边界

[evidence/index.json](evidence/index.json) 保存当前 84 项和历史 92 次的原始结果、日志与消息文件摘要，以及去重后的完整输入快照和每次使用的 manifest。`archive.py` 在归档前逐项核对真实 TLC 状态/退出码、目标消息、BFS、死锁、配置清单、输入摘要、完成状态、剩余队列及下限；源文件原始字节保留不变。所有稳定链接都指向版本化目录。

结果 JSON 中原执行绝对路径属于原始命令/来源信息，不能据此要求读者拥有原工作目录；正式索引已经给出每份模型、配置、manifest、result、messages 与 tlc.log 的归档位置。jar、TLC 工作队列、临时运行目录、业务数据库、凭据与真人内容不归档。

没有以模型中的原子赋值代替真实 PostgreSQL 事务证据，也没有对业务代码作 refinement 声明。此候选明确不覆盖任意规模、无限轮次、完整传输/可见性/跨 Session/fallback、自然语言质量或任意真实到达时刻。实施方接收 [README.md 第5节](README.md#5-给实现与验收的义务) 的义务和回归规格后，仍需在外层流程中核验当前实现。
