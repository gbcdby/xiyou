# 实际 TLC 矩阵

64 项符合运行前判据：20 项有限范围正例、27 项安全负控、5 项活性反例、12 项可达见证。正例中 13 项带活性检查。原始退出码 12/13 按设计保留为 COUNTEREXAMPLE。

当前源为 955；旧 7f / 9b 失败变体继续保留。当前请求正例全部启用 18 个安全性质，原抽象修正正例已由实际 observedSeq / captured input / consumeThrough 机制替换。

| 配置 | 类别 | 原始退出码 | 不同状态 | 预声明判据 |
| --- | --- | ---: | ---: | --- |
| `req-withdraw-return` | 正例 | 0 | 274 | DecisionProgress, SemanticProgress |
| `req-common-change` | 正例 | 0 | 366 | DecisionProgress, SemanticProgress |
| `req-response-dependency` | 正例 | 0 | 32498 | DecisionProgress, SemanticProgress |
| `req-settlement-unrelated` | 正例 | 0 | 274 | DecisionProgress |
| `req-retreat-unrelated` | 正例 | 0 | 274 | DecisionProgress |
| `req-noop-late` | 正例 | 0 | 581 | DecisionProgress, SemanticProgress |
| `req-noise` | 正例 | 0 | 274 | DecisionProgress |
| `req-unknown-restart` | 正例 | 0 | 44683 | 安全性质 |
| `req-retry-exhaustion` | 正例 | 0 | 5063 | 安全性质 |
| `req-durable-step` | 正例 | 0 | 1262 | 安全性质 |
| `req-terminal` | 正例 | 0 | 62 | 安全性质 |
| `req-authority` | 正例 | 0 | 1836 | 安全性质 |
| `req-old9b-counterexample` | 活性反例 | 13 | 62 | DecisionProgress |
| `req-global-seq-counterexample` | 活性反例 | 13 | 62 | DecisionProgress |
| `req-missing-wake-counterexample` | 活性反例 | 13 | 62 | DecisionProgress |
| `req-negative-rewrite` | 安全负控 | 12 | 15 | RequestImmutable |
| `req-negative-receipt-order` | 安全负控 | 12 | 17 | ReceiptStable |
| `req-negative-repeat-effect` | 安全负控 | 12 | 34 | EffectOnce |
| `req-negative-stale-basis` | 安全负控 | 12 | 15 | CurrentChoiceAtCommit |
| `req-negative-drop-common` | 安全负控 | 12 | 15 | CurrentChoiceAtCommit |
| `req-negative-old-version` | 安全负控 | 12 | 10 | ExecutionLinkCurrent |
| `req-negative-clear-newer` | 安全负控 | 12 | 14 | SemanticRetained |
| `req-negative-recovery-consume` | 安全负控 | 12 | 19 | RecoveryNoConsumption |
| `req-negative-ordinary` | 安全负控 | 12 | 28 | FreshEvaluationCause |
| `req-negative-duplicate` | 安全负控 | 12 | 181 | FreshEvaluationCause |
| `req-negative-pending-spin` | 安全负控 | 12 | 626 | RetryBound |
| `req-negative-volatile-dedup` | 安全负控 | 12 | 246 | EffectOnce |
| `req-negative-scene-budget` | 安全负控 | 12 | 6 | SceneBudgetSeparate |
| `req-witness-late` | 可达见证 | 12 | 39 | NoWitness |
| `req-witness-replay` | 可达见证 | 12 | 26 | NoWitness |
| `req-witness-restart` | 可达见证 | 12 | 55 | NoWitness |
| `req-witness-indirect` | 可达见证 | 12 | 17 | NoWitness |
| `req-witness-retry` | 可达见证 | 12 | 421 | NoWitness |
| `follow-tea-safety` | 正例 | 0 | 33079 | 安全性质 |
| `follow-front-safety` | 正例 | 0 | 10662 | 安全性质 |
| `follow-tea-live` | 正例 | 0 | 55 | RouteProgress |
| `follow-front-live` | 正例 | 0 | 39 | RouteProgress |
| `follow-negative-u-first` | 安全负控 | 12 | 2 | OriginAndSources |
| `follow-negative-leader-exit` | 安全负控 | 12 | 19 | ExitBySubject |
| `follow-negative-carry-exit` | 安全负控 | 12 | 680 | ExitBySubject |
| `follow-negative-endpoint-only` | 安全负控 | 12 | 210 | WholePathFence |
| `follow-negative-move-before-check` | 安全负控 | 12 | 203 | WholePathFence |
| `follow-negative-stale-binding` | 安全负控 | 12 | 542 | CurrentExecutionFence |
| `follow-negative-auto-resume` | 安全负控 | 12 | 233 | PausedNeedsProposal |
| `follow-negative-stale-confirm` | 安全负控 | 12 | 3092 | SettlementCurrent |
| `follow-negative-arrived-skip` | 安全负控 | 12 | 885 | ArrivalStillGuarded |
| `follow-witness-route` | 可达见证 | 12 | 35 | NoWitness |
| `follow-witness-reproposal` | 可达见证 | 12 | 680 | NoWitness |
| `follow-witness-overlap` | 可达见证 | 12 | 347 | NoWitness |
| `follow-witness-leader-first` | 可达见证 | 12 | 62 | NoWitness |
| `req-cached-rejection-counterexample` | 活性反例 | 13 | 390 | DecisionProgress |
| `req-resume-after-rejection` | 正例 | 0 | 1178 | DecisionProgress, SemanticProgress |
| `req-resume-before-read-late-input` | 正例 | 0 | 1218 | DecisionProgress, SemanticProgress |
| `req-resume-late-delivery` | 正例 | 0 | 2380 | DecisionProgress, SemanticProgress |
| `req-rejected-return-unknown` | 正例 | 0 | 1070 | DecisionProgress, SemanticProgress |
| `req-negative-wide-consume` | 安全负控 | 12 | 87 | RejectedWaitKeepsInputBoundary |
| `req-wide-last-counterexample` | 活性反例 | 13 | 372 | DecisionProgress |
| `req-negative-recovery-watermark` | 安全负控 | 12 | 39 | ReceiptWatermarkStable |
| `req-negative-global-signal` | 安全负控 | 12 | 73 | RejectedAttemptAuthorized |
| `req-negative-skip-recovery` | 安全负控 | 12 | 55 | SingleUnsettled |
| `req-negative-wrong-parent` | 安全负控 | 12 | 68 | AttemptLinked |
| `req-witness-captured-late` | 可达见证 | 12 | 176 | NoWitness |
| `req-witness-late-delivery` | 可达见证 | 12 | 247 | NoWitness |
| `req-witness-rejected-recovered` | 可达见证 | 12 | 124 | NoWitness |

全部正例检查完成且 remaining_states=0；安全反例与见证在找到目标状态时停止，剩余队列不是通过指标。实际输入和完整日志哈希见 [results.json](results.json)。

请求47项最终证据来自 `request-final-05` 的46项及同一模型哈希下 `rewrite-check-04` 的1项；路线17项复用输入逐字一致的既有运行，没有重跑。旧52项及旧282状态反例在 [历史结果](history/stage1-results.json) 中保持原身份，原始封存包作为本轮证据的一部分保留。

敏感性：所列27项安全负控、5项活性反例均实际命中目标。未声称每个辅助不变量都有独立变异；可信输入来源与完整权限是继承前提，当前TrustedPrepareInput只核对模型内部构造。独立模型复核 NOT_RUN；源码对应是工程核对，不是 refinement 证明。
