# 本次反例与因果见证

全部表格从本次 `matrix-recovery-01` 的 TLC 状态消息摘录；逐字原始日志单独交接，其摘要见 [evidence-audit.json](evidence-audit.json)。负控和见证的 `COUNTEREXAMPLE` 是预先期望的结果。`NoWitness` 失败只表示目标路径存在，不能替代正例全状态检查。

## 旧 25c 的 BeforeRead 活性反例

resume 在恢复读取前提交并送达；旧缓存尚未知，pending 始终为 0。原 Receipt 收束后仍未规划，最后状态可持续停顿。该运行只重现旧机制的抽象，不是重新执行旧产品源码。

配置 `old25c-counterexample`；原始退出码 `13`；8 个显示状态。

| 步骤 | 动作 | phase | pending | context | reservations/calls | paused |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Initial predicate | BeforeRead | 0 | 0 | 0/0 | TRUE |
| 2 | Commit | BeforeRead | 0 | 0 | 0/0 | FALSE |
| 3 | Deliver | BeforeRead | 0 | 0 | 0/0 | FALSE |
| 4 | RecoveryRead | DuringRead | 0 | 0 | 0/0 | FALSE |
| 5 | RecoveryReturn | AfterReturn | 0 | 0 | 0/0 | FALSE |
| 6 | LookupReceipt | ReceiptReturned | 0 | 0 | 0/0 | FALSE |
| 7 | FinishOld | Idle | 0 | 0 | 0/0 | FALSE |
| 8 | Deliver | Idle | 0 | 0 | 0/0 | FALSE |

TLC 末尾报告 `Stuttering`。真实语义 required={1}、covered={}，授权/预算/运行条件具备且原请求已收束，仍永久漏唤醒。

## 错误清空更新水位的安全负控

context=1 后收到序号 2，错误变体在成功 reserve 返回时全部清空 pending。最后 required 中的新水位未覆盖，PendingSemanticPreserved 被指定击穿。

配置 `negative-clear-newer`；原始退出码 `12`；13 个显示状态。

| 步骤 | 动作 | phase | pending | context | reservations/calls | paused |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Initial predicate | BeforeRead | 0 | 0 | 0/0 | FALSE |
| 2 | Commit | BeforeRead | 0 | 0 | 0/0 | FALSE |
| 3 | Deliver | BeforeRead | 1 | 0 | 0/0 | FALSE |
| 4 | RecoveryRead | DuringRead | 1 | 0 | 0/0 | FALSE |
| 5 | RecoveryReturn | AfterReturn | 1 | 0 | 0/0 | FALSE |
| 6 | LookupReceipt | ReceiptReturned | 1 | 0 | 0/0 | FALSE |
| 7 | FinishOld | Idle | 1 | 0 | 0/0 | FALSE |
| 8 | StartNormal | ContextRead | 1 | 0 | 0/0 | FALSE |
| 9 | ReadContext | ContextHeld | 1 | 1 | 0/0 | FALSE |
| 10 | Commit | ContextHeld | 1 | 1 | 0/0 | FALSE |
| 11 | Deliver | ContextHeld | 2 | 1 | 0/0 | FALSE |
| 12 | ReserveNormal | Reserved | 2 | 1 | 1/0 | FALSE |
| 13 | AdmitNormal | Inferring | 0 | 1 | 1/1 | FALSE |

## 技术 Unknown 被写成确定结果的负控

错误变体在技术未知时将原结果改成 rejected/settled；UnknownKeepsOriginalOutcome 立即失败。它检验抽象判据的敏感性，不重现真实 PG 错误分类。

配置 `negative-unknown-reject`；原始退出码 `12`；2 个显示状态。

| 步骤 | 动作 | phase | pending | context | reservations/calls | paused |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Initial predicate | BeforeRead | 0 | 0 | 0/0 | TRUE |
| 2 | RecoveryUnknown | Unknown | 0 | 0 | 0/0 | TRUE |

## 成功 reserve 到返回消费之间的事件见证

步骤 11 已成功 reserve；步骤 12 才送达序号 2。context=1 的返回消费保留 pending=2，第二次正常周期用 context=2 覆盖它。

配置 `witness-reserve-race`；原始退出码 `12`；19 个显示状态。

| 步骤 | 动作 | phase | pending | context | reservations/calls | paused |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Initial predicate | BeforeRead | 0 | 0 | 0/0 | FALSE |
| 2 | Commit | BeforeRead | 0 | 0 | 0/0 | FALSE |
| 3 | Deliver | BeforeRead | 1 | 0 | 0/0 | FALSE |
| 4 | RecoveryRead | DuringRead | 1 | 0 | 0/0 | FALSE |
| 5 | RecoveryReturn | AfterReturn | 1 | 0 | 0/0 | FALSE |
| 6 | LookupReceipt | ReceiptReturned | 1 | 0 | 0/0 | FALSE |
| 7 | FinishOld | Idle | 1 | 0 | 0/0 | FALSE |
| 8 | StartNormal | ContextRead | 1 | 0 | 0/0 | FALSE |
| 9 | ReadContext | ContextHeld | 1 | 1 | 0/0 | FALSE |
| 10 | Commit | ContextHeld | 1 | 1 | 0/0 | FALSE |
| 11 | ReserveNormal | Reserved | 1 | 1 | 1/0 | FALSE |
| 12 | Deliver | Reserved | 2 | 1 | 1/0 | FALSE |
| 13 | AdmitNormal | Inferring | 2 | 1 | 1/1 | FALSE |
| 14 | FinishNormal | Idle | 2 | 1 | 1/1 | FALSE |
| 15 | Elapse | Idle | 2 | 1 | 1/1 | FALSE |
| 16 | StartNormal | ContextRead | 2 | 1 | 1/1 | FALSE |
| 17 | ReadContext | ContextHeld | 2 | 2 | 1/1 | FALSE |
| 18 | ReserveNormal | Reserved | 2 | 2 | 2/1 | FALSE |
| 19 | AdmitNormal | Inferring | 0 | 2 | 2/2 | FALSE |

## 已有语义水位被显式恢复保留

pending=1 已存在后才进入 Unknown 与显式恢复，原请求随后收束；正常周期独立取得新 context 并消费序号 1。

配置 `witness-explicit`；原始退出码 `12`；14 个显示状态。

| 步骤 | 动作 | phase | pending | context | reservations/calls | paused |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Initial predicate | BeforeRead | 0 | 0 | 0/0 | TRUE |
| 2 | Commit | BeforeRead | 0 | 0 | 0/0 | FALSE |
| 3 | Deliver | BeforeRead | 1 | 0 | 0/0 | FALSE |
| 4 | RecoveryUnknown | Unknown | 1 | 0 | 0/0 | FALSE |
| 5 | ExplicitRecovery | BeforeRead | 1 | 0 | 0/0 | FALSE |
| 6 | RecoveryRead | DuringRead | 1 | 0 | 0/0 | FALSE |
| 7 | RecoveryReturn | AfterReturn | 1 | 0 | 0/0 | FALSE |
| 8 | LookupReceipt | ReceiptReturned | 1 | 0 | 0/0 | FALSE |
| 9 | FinishOld | Idle | 1 | 0 | 0/0 | FALSE |
| 10 | Elapse | Idle | 1 | 0 | 0/0 | FALSE |
| 11 | StartNormal | ContextRead | 1 | 0 | 0/0 | FALSE |
| 12 | ReadContext | ContextHeld | 1 | 1 | 0/0 | FALSE |
| 13 | ReserveNormal | Reserved | 1 | 1 | 1/0 | FALSE |
| 14 | AdmitNormal | Inferring | 0 | 1 | 1/1 | FALSE |

## prepare 后暂停仍可 reserve 的边界

context 取得后才提交暂停，当前契约允许已有 context 继续 reserve。最后 paused=TRUE 且 calls=1；不支持“reserve 瞬间必须未暂停”的更强结论。

配置 `witness-prepared-pause`；原始退出码 `12`；12 个显示状态。

| 步骤 | 动作 | phase | pending | context | reservations/calls | paused |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Initial predicate | BeforeRead | 0 | 0 | 0/0 | FALSE |
| 2 | Commit | BeforeRead | 0 | 0 | 0/0 | FALSE |
| 3 | Deliver | BeforeRead | 1 | 0 | 0/0 | FALSE |
| 4 | RecoveryRead | DuringRead | 1 | 0 | 0/0 | FALSE |
| 5 | RecoveryReturn | AfterReturn | 1 | 0 | 0/0 | FALSE |
| 6 | LookupReceipt | ReceiptReturned | 1 | 0 | 0/0 | FALSE |
| 7 | FinishOld | Idle | 1 | 0 | 0/0 | FALSE |
| 8 | StartNormal | ContextRead | 1 | 0 | 0/0 | FALSE |
| 9 | ReadContext | ContextHeld | 1 | 1 | 0/0 | FALSE |
| 10 | Commit | ContextHeld | 1 | 1 | 0/0 | TRUE |
| 11 | ReserveNormal | Reserved | 1 | 1 | 1/0 | TRUE |
| 12 | AdmitNormal | Inferring | 0 | 1 | 1/1 | TRUE |

## 历史建模修正不冒充产品失败

恢复前的历史推导曾把 reserve 的 STALE 返回误抽象成永久 Unavailable，产生假活性反例；还先后把 prepare/reserve、reserve/返回消费合并，未表示真实交错。最终模型保留当前三步分离及 STALE 回 Idle 的正确行为。本次仅有最终模型和新运行日志，原中间文件/旧日志不可读；此段是保留解释的历史记录，不是本次重新运行过的负控，也不把它列为产品 bug。
