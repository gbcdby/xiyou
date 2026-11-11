# fallback 修正执行报告

## 固定范围与结论

对应 `R-vs001-p04-VIS-001`，作者状态为 `FIX_REPORTED`；独立复审 `NOT_RUN`，业务实现 `NOT_ASSESSED`。本目录的 38 项最终配置均取得其预声明的实际结果，正向安全与完整活性为 `PASS_WITHIN_SCOPE`，缺陷与见证保持 `COUNTEREXAMPLE`。不以作者结论关闭原 finding。

最终模型 SHA-256：`b88c64415254973407e44b34d27b3e24888864e6a0c4384ceb3522645e1e59fd`。工具固定 v1.7.4 / TLC 2.19，jar SHA-256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`。runner SHA-256 `ca5811a8cae5d31961185b0ba53868f3ea885a1ee614150d873d61044ff18f5a`，未修改。

| 正向 profile | 实际启用 | generated / distinct / queue | raw rc / completed | 耗时秒 |
| --- | --- | --- | --- | ---: |
| positive | TypeOK, StableReasonKey, AtMostOneEffect, ReceiptPayloadBinding, AtomicCommitBundle, FallbackAfterSettlement, CurrentEpochOnly, CurrentToolPermission, TerminalBlocksNewEffects, NoDecisionRevival, FreshDecisionOnly | 4,194,733 / 150,576 / 0 | 0 / true | 17.949 |
| live | DecisionResolvesOrExpires, FallbackResolves | 4,194,733 / 150,576 / 0 | 0 / true | 33.440 |

普通 BFS、1 worker、1024 MiB、死锁开启；预声明正向下限 100。两个正向 raw 输出均有完成消息与清空队列，不依赖仅出现成功字符串。安全无公平性；活性弱公平性与有限故障假设见 [README](README.md)。

## 逐目标实际结果

| Profile | 目标 | raw TLC rc | distinct | 分类 |
| --- | --- | ---: | ---: | --- |
| negative-type | TypeOK | 12 | 9 | 安全缺陷 |
| negative-unstable_key | StableReasonKey | 12 | 2,947 | 安全缺陷 |
| negative-lost_receipt | AtMostOneEffect | 12 | 6,608 | 安全缺陷 |
| negative-payload_overwrite | ReceiptPayloadBinding | 12 | 2,948 | 安全缺陷 |
| negative-split_bundle | AtomicCommitBundle | 12 | 1,704 | 安全缺陷 |
| negative-early_queue | FallbackAfterSettlement | 12 | 8 | 安全缺陷 |
| negative-fallback_epoch | CurrentEpochOnly | 12 | 2,163 | 安全缺陷 |
| negative-fallback_permission | CurrentToolPermission | 12 | 2,197 | 安全缺陷 |
| negative-fallback_terminal | TerminalBlocksNewEffects | 12 | 2,919 | 安全缺陷 |
| negative-fallback_deadline | TerminalBlocksNewEffects | 12 | 3,739 | 安全缺陷 |
| negative-revive_decision | NoDecisionRevival | 12 | 1,704 | 安全缺陷 |
| negative-reuse_decision_id | NoDecisionRevival | 12 | 2,950 | 安全缺陷 |
| negative-original_epoch | FreshDecisionOnly | 12 | 70 | 安全缺陷 |
| negative-original_permission | FreshDecisionOnly | 12 | 74 | 安全缺陷 |
| negative-original_deadline | FreshDecisionOnly | 12 | 194 | 安全缺陷 |
| negative-no_timeout | DecisionResolvesOrExpires | 13 | 19,573 | 活性缺陷 |
| negative-no_queue | FallbackResolves | 13 | 4,572 | 活性缺陷 |
| negative-no_fallback_commit | FallbackResolves | 13 | 14,816 | 活性缺陷 |
| deadlock | TypeOK | 11 | 1 | 死锁敏感性 |
| witness-original-committed | NotReached | 12 | 12 | 可达见证 |
| witness-invalid-json-rejected | NotReached | 12 | 51 | 可达见证 |
| witness-no-tool-rejected | NotReached | 12 | 52 | 可达见证 |
| witness-decision-expired | NotReached | 12 | 80 | 可达见证 |
| witness-fallback-from-expired | NotReached | 12 | 2,370 | 可达见证 |
| witness-fallback-from-rejected | NotReached | 12 | 1,704 | 可达见证 |
| witness-fallback-epoch-rejected | NotReached | 12 | 2,934 | 可达见证 |
| witness-fallback-permission-rejected | NotReached | 12 | 2,938 | 可达见证 |
| witness-fallback-terminal-rejected | NotReached | 12 | 2,941 | 可达见证 |
| witness-fallback-session-deadline | NotReached | 12 | 3,739 | 可达见证 |
| witness-fallback-repeat | NotReached | 12 | 7,477 | 可达见证 |
| witness-crash-retry-fallback | NotReached | 12 | 20,025 | 可达见证 |
| witness-payload-conflict-rejected | NotReached | 12 | 2,948 | 可达见证 |
| witness-late-original-after-fallback | NotReached | 12 | 5,477 | 可达见证 |
| witness-original-repeat | NotReached | 12 | 57 | 可达见证 |
| witness-terminal-receipt-read | NotReached | 12 | 12,000 | 可达见证 |
| witness-fresh-replan-id | NotReached | 12 | 2,950 | 可达见证 |

15 个安全缺陷逐一命中目标不变量；3 个活性缺陷得到真实无限停滞轨迹；1 个 deadlock 得到 raw 11；17 个见证得到 NotReached 的 raw 12。这些结果不冒充完整正向探索。逐项原始 result/log/messages、输入及清单定位均在 [results.json](results.json)。

## 原决定与 fallback 的组合证据

- `witness-fallback-from-expired` 与 `witness-fallback-from-rejected` 分别先收束原决定，再成功提交独立 fallback。
- `witness-fallback-epoch-rejected`、`witness-fallback-permission-rejected`、`witness-fallback-terminal-rejected` 要求先有有效预校验，再发生对应失效，最后拒绝真正提交；不以一开始就无权限的孤立状态替代交错。
- `witness-late-original-after-fallback` 先有已提交 fallback 效果，再处理原决定的迟到回调，保留原收束状态。
- `witness-crash-retry-fallback` 要求第一次 fallback 效果与 Receipt 已提交，随后崩溃、恢复、原键读取；最终仍只有一次效果。
- `negative-lost_receipt` 在错误包留下首次 fallback 效果但缺 Receipt 后才允许唯一崩溃，随后恢复重试得到第二次效果并触发 AtMostOneEffect。

两条崩溃链的原始消息状态顺序由 [evidence-audit.json](evidence-audit.json) 的 `causal_checks` 保存；它核对首次效果先于崩溃、恢复后重试和最终效果计数，并不把 messages.json 冒充通用轨迹格式。

## 历史与修正过程

首轮 `e2445f2a1a20cd39a2bbfb36d5802afab882312eb0bad7acddfa939bc78a0f73` 的 38 项均得到预期 raw 结果，但作者检查发现 `crash-retry-fallback` 探针仅要求 crashes=1，TLC 最短轨迹选择了先崩溃再首次提交，不能证明“提交后崩溃”的更强顺序。该问题属于见证表达不足，不是伪造正模型反例。首轮全部原始证据保存在 [history.json](history.json) 所列位置，不能当最终字节的当前验收。

最终仅增加只读 `crashAfterFallback` 观察器，并强化该探针：Crash 时必须已有一次 fallback 效果及 Receipt，后续原键读取才记录目标；Probe=none 时此标志恒为 FALSE。业务动作、性质、公平性、规模和状态下限未减弱。最终 38 项全部按新模型字节实际重跑；不以观察器等价论证迁移旧 PASS。

## 原冻结子产物保护

[baseline-preservation.json](baseline-preservation.json) 逐文件比较基线 `87dd1ec8a5b74d147a41072f66d3639e4e009189`：isolation 59、reconnect 671、visibility 1,053、deadlock 11 个文件，共 1,794 个文件的字节均相同，目录没有增加文件。原 57 项证据、28 项 visibility 结果及历史超时/unknown 状态原样保留。

补充目录的只读审计核对 38 个 profile，并确认每个启用安全性质都有目标负对照；顶层 [边界审计](../evidence-audit.json) 核对现有 57 加新增 38，共 95 个当前 profile，均一致。这是证据一致性检查，不是独立需求或标准审查。

## 未覆盖与实施状态

本补充仅涵盖一个原决定与一个 fallback 的有限组合；不证明任意数量的并行/循环决策、真实认证/数据库/网络/JSON 解析、自然语言质量或真实供应商表现。原子工具包内部和观察信息边界沿用原 visibility 的已声明模型范围，不能把两个范围之和解释成完整应用 refinement。后续 d2 仅检查新 ID 分配，不声称完成第二轮推理。

协议义务、可观测回归场景和返回建模条件见 [README](README.md)。#9 / #12 的业务实现与真实回归均未由本次模型检查执行。
