# TLC 实际运行结果

本表来自实际 result.json、manifest.json、messages.json 和 tlc.log。正向必须完整结束且queue=0；负控/见证必须命中指定性质和真实退出码。所有 `INCONCLUSIVE` 原样保留。

## 最终选择与历史

最终配置 131 项，预期匹配 126；状态 {"PASS_WITHIN_SCOPE": 28, "COUNTEREXAMPLE": 98, "INCONCLUSIVE": 5}。其中 CAS/Consent/Recovery 57 项复用 R1 未变模块，保持 R1 source；其余74项绑定 R2。

全部真实运行 178 次，包含4次早期模型语法 TOOL_ERROR、已修正的初态/转移诊断及9次历史超时；全部保留，不计作产品失败或成功。状态 {"TOOL_ERROR": 4, "PASS_WITHIN_SCOPE": 38, "COUNTEREXAMPLE": 127, "INCONCLUSIVE": 9}。

## 最终逐配置

| 配置 | 预期/用途 | 实际 | exit | distinct / queue | 判据 | 证据相对目录 |
| --- | --- | --- | --- | --- | --- | --- |
| cas-different-purpose | 正向穷尽 | PASS_WITHIN_SCOPE | 0 | 20 / 0 | 符合预声明 | `matrix-r1/cas-different-purpose` |
| cas-same-purpose | 正向穷尽 | PASS_WITHIN_SCOPE | 0 | 26 / 0 | 符合预声明 | `matrix-r1/cas-same-purpose` |
| cas-negative-type | 负控 | COUNTEREXAMPLE | 12 | 4 / 2 | 符合预声明 | `matrix-r1/cas-negative-type` |
| cas-negative-skip-cas | 负控 | COUNTEREXAMPLE | 12 | 12 / 3 | 符合预声明 | `matrix-r1/cas-negative-skip-cas` |
| cas-negative-overwrite | 负控 | COUNTEREXAMPLE | 12 | 11 / 3 | 符合预声明 | `matrix-r1/cas-negative-overwrite` |
| cas-witness-concurrent | 可达见证 | COUNTEREXAMPLE | 12 | 5 / 2 | 符合预声明 | `matrix-r1/cas-witness-concurrent` |
| cas-witness-both-purposes | 可达见证 | COUNTEREXAMPLE | 12 | 11 / 3 | 符合预声明 | `matrix-r1/cas-witness-both-purposes` |
| consent-appearance | 正向穷尽 | PASS_WITHIN_SCOPE | 0 | 34026 / 0 | 符合预声明 | `matrix-r1/consent-appearance` |
| consent-private | 正向穷尽 | PASS_WITHIN_SCOPE | 0 | 34026 / 0 | 符合预声明 | `matrix-r1/consent-private` |
| consent-owner-epoch | 正向穷尽 | PASS_WITHIN_SCOPE | 0 | 91874 / 0 | 符合预声明 | `matrix-r1/consent-owner-epoch` |
| consent-source | 正向穷尽 | PASS_WITHIN_SCOPE | 0 | 91874 / 0 | 符合预声明 | `matrix-r1/consent-source` |
| consent-local | 正向穷尽 | PASS_WITHIN_SCOPE | 0 | 76384 / 0 | 符合预声明 | `matrix-r1/consent-local` |
| consent-pause | 正向穷尽 | PASS_WITHIN_SCOPE | 0 | 29409 / 0 | 符合预声明 | `matrix-r1/consent-pause` |
| consent-terminal | 正向穷尽 | PASS_WITHIN_SCOPE | 0 | 16018 / 0 | 符合预声明 | `matrix-r1/consent-terminal` |
| consent-revoke | 正向穷尽 | PASS_WITHIN_SCOPE | 0 | 112634 / 0 | 符合预声明 | `matrix-r1/consent-revoke` |
| consent-third-party | 正向穷尽 | PASS_WITHIN_SCOPE | 0 | 15567 / 0 | 符合预声明 | `matrix-r1/consent-third-party` |
| consent-declined | 正向穷尽 | PASS_WITHIN_SCOPE | 0 | 2714 / 0 | 符合预声明 | `matrix-r1/consent-declined` |
| consent-deferred | 正向穷尽 | PASS_WITHIN_SCOPE | 0 | 2714 / 0 | 符合预声明 | `matrix-r1/consent-deferred` |
| consent-negative-type | 负控 | COUNTEREXAMPLE | 12 | 7 / 5 | 符合预声明 | `matrix-r1/consent-negative-type` |
| consent-negative-cancel-as-withdraw | 负控 | COUNTEREXAMPLE | 12 | 12 / 8 | 符合预声明 | `matrix-r1/consent-negative-cancel-as-withdraw` |
| consent-negative-wrong-request | 负控 | COUNTEREXAMPLE | 12 | 38 / 26 | 符合预声明 | `matrix-r1/consent-negative-wrong-request` |
| consent-negative-wrong-withdraw | 负控 | COUNTEREXAMPLE | 12 | 3771 / 1876 | 符合预声明 | `matrix-r1/consent-negative-wrong-withdraw` |
| consent-negative-wrong-scope | 负控 | COUNTEREXAMPLE | 12 | 7 / 4 | 符合预声明 | `matrix-r1/consent-negative-wrong-scope` |
| consent-negative-skip-invalidation | 负控 | COUNTEREXAMPLE | 12 | 34 / 25 | 符合预声明 | `matrix-r1/consent-negative-skip-invalidation` |
| consent-negative-receipt-reactivates | 负控 | COUNTEREXAMPLE | 12 | 80 / 53 | 符合预声明 | `matrix-r1/consent-negative-receipt-reactivates` |
| consent-negative-repeat-effect | 负控 | COUNTEREXAMPLE | 12 | 27 / 19 | 符合预声明 | `matrix-r1/consent-negative-repeat-effect` |
| consent-negative-stale-basis | 负控 | COUNTEREXAMPLE | 12 | 56 / 42 | 符合预声明 | `matrix-r1/consent-negative-stale-basis` |
| consent-negative-third-party | 负控 | COUNTEREXAMPLE | 12 | 6 / 4 | 符合预声明 | `matrix-r1/consent-negative-third-party` |
| consent-negative-old-participant-epoch | 负控 | COUNTEREXAMPLE | 12 | 34 / 25 | 符合预声明 | `matrix-r1/consent-negative-old-participant-epoch` |
| consent-negative-rollback | 负控 | COUNTEREXAMPLE | 12 | 7 / 5 | 符合预声明 | `matrix-r1/consent-negative-rollback` |
| consent-witness-both-accepted | 可达见证 | COUNTEREXAMPLE | 12 | 103 / 71 | 符合预声明 | `matrix-r1/consent-witness-both-accepted` |
| consent-witness-cancel-before | 可达见证 | COUNTEREXAMPLE | 12 | 126 / 88 | 符合预声明 | `matrix-r1/consent-witness-cancel-before` |
| consent-witness-accept-before | 可达见证 | COUNTEREXAMPLE | 12 | 97 / 66 | 符合预声明 | `matrix-r1/consent-witness-accept-before` |
| consent-witness-stale-response | 可达见证 | COUNTEREXAMPLE | 12 | 49 / 36 | 符合预声明 | `matrix-r1/consent-witness-stale-response` |
| consent-witness-stale-withdraw | 可达见证 | COUNTEREXAMPLE | 12 | 851 / 511 | 符合预声明 | `matrix-r1/consent-witness-stale-withdraw` |
| consent-witness-c2-after-epoch | 可达见证 | COUNTEREXAMPLE | 12 | 338 / 220 | 符合预声明 | `matrix-r1/consent-witness-c2-after-epoch` |
| consent-witness-replay-closed | 可达见证 | COUNTEREXAMPLE | 12 | 115 / 81 | 符合预声明 | `matrix-r1/consent-witness-replay-closed` |
| consent-witness-declined | 可达见证 | COUNTEREXAMPLE | 12 | 64 / 40 | 符合预声明 | `matrix-r1/consent-witness-declined` |
| consent-witness-deferred | 可达见证 | COUNTEREXAMPLE | 12 | 64 / 40 | 符合预声明 | `matrix-r1/consent-witness-deferred` |
| effects-private | 正向穷尽 | INCONCLUSIVE | 143 | 未获终局数 | 未满足 | `r2-effects-positive/effects-private` |
| effects-appearance | 正向穷尽 | PASS_WITHIN_SCOPE | 0 | 10512 / 0 | 符合预声明 | `r2-effects-positive/effects-appearance` |
| effects-restart-private | 正向穷尽 | INCONCLUSIVE | 143 | 未获终局数 | 未满足 | `r2-effects-positive/effects-restart-private` |
| effects-both | 正向穷尽 | INCONCLUSIVE | 143 | 未获终局数 | 未满足 | `r2-effects-positive/effects-both` |
| effects-cooperative-return | 正向穷尽 | INCONCLUSIVE | 143 | 未获终局数 | 未满足 | `r2-effects-positive/effects-cooperative-return` |
| effects-r1-current-only | R1缺口探针 | COUNTEREXAMPLE | 12 | 103 / 73 | 符合预声明 | `r2-gates-small/effects-r1-current-only` |
| effects-negative-type | 负控 | COUNTEREXAMPLE | 12 | 11 / 9 | 符合预声明 | `r2-effects-controls/effects-negative-type` |
| effects-negative-split-stop | 负控 | COUNTEREXAMPLE | 12 | 12 / 9 | 符合预声明 | `r2-effects-controls/effects-negative-split-stop` |
| effects-negative-split-private | 负控 | COUNTEREXAMPLE | 12 | 29 / 23 | 符合预声明 | `r2-effects-controls/effects-negative-split-private` |
| effects-negative-cross-purpose | 负控 | COUNTEREXAMPLE | 12 | 8 / 6 | 符合预声明 | `r2-effects-controls/effects-negative-cross-purpose` |
| effects-negative-wrong-taker | 负控 | COUNTEREXAMPLE | 12 | 7 / 5 | 符合预声明 | `r2-effects-controls/effects-negative-wrong-taker` |
| effects-negative-old-capability | 负控 | COUNTEREXAMPLE | 12 | 11 / 8 | 符合预声明 | `r2-effects-controls/effects-negative-old-capability` |
| effects-negative-reassign-custody | 负控 | COUNTEREXAMPLE | 12 | 103 / 73 | 符合预声明 | `r2-effects-controls/effects-negative-reassign-custody` |
| effects-negative-public-return | 负控 | COUNTEREXAMPLE | 12 | 144 / 107 | 符合预声明 | `r2-effects-controls/effects-negative-public-return` |
| effects-negative-return-needs-active | 负控 | COUNTEREXAMPLE | 12 | 29 / 23 | 符合预声明 | `r2-effects-controls/effects-negative-return-needs-active` |
| effects-negative-receipt-reactivates | 负控 | COUNTEREXAMPLE | 12 | 16 / 13 | 符合预声明 | `r2-effects-controls/effects-negative-receipt-reactivates` |
| effects-negative-ui-receipt-overwrite | 负控 | COUNTEREXAMPLE | 12 | 68 / 52 | 符合预声明 | `r2-effects-controls/effects-negative-ui-receipt-overwrite` |
| effects-negative-rollback | 负控 | COUNTEREXAMPLE | 12 | 2 / 0 | 符合预声明 | `r2-effects-controls/effects-negative-rollback` |
| effects-negative-retake-completed | 负控 | COUNTEREXAMPLE | 12 | 441 / 298 | 符合预声明 | `r2-gates-small/effects-negative-retake-completed` |
| effects-negative-first-item-closes-all | 负控 | COUNTEREXAMPLE | 12 | 143 / 106 | 符合预声明 | `r2-gates-small/effects-negative-first-item-closes-all` |
| effects-negative-return-rewrites-history | 负控 | COUNTEREXAMPLE | 12 | 312 / 204 | 符合预声明 | `r2-effects-controls/effects-negative-return-rewrites-history` |
| effects-negative-leak-return | 负控 | COUNTEREXAMPLE | 12 | 5 / 3 | 符合预声明 | `r2-effects-controls/effects-negative-leak-return` |
| effects-negative-stale-return-view | 负控 | COUNTEREXAMPLE | 12 | 33 / 27 | 符合预声明 | `r2-gates-small/effects-negative-stale-return-view` |
| effects-negative-history-trims-return | 负控 | COUNTEREXAMPLE | 12 | 35 / 29 | 符合预声明 | `r2-gates-small/effects-negative-history-trims-return` |
| effects-witness-old-return | 可达见证 | COUNTEREXAMPLE | 12 | 313 / 205 | 符合预声明 | `r2-effects-controls/effects-witness-old-return` |
| effects-witness-old-return-new-slot | 可达见证 | COUNTEREXAMPLE | 12 | 857 / 556 | 符合预声明 | `r2-effects-controls/effects-witness-old-return-new-slot` |
| effects-witness-new-slot-old-custody | 可达见证 | COUNTEREXAMPLE | 12 | 103 / 73 | 符合预声明 | `r2-effects-controls/effects-witness-new-slot-old-custody` |
| effects-witness-late-old-receipt | 可达见证 | COUNTEREXAMPLE | 12 | 205 / 148 | 符合预声明 | `r2-effects-controls/effects-witness-late-old-receipt` |
| effects-witness-restored-origin | 可达见证 | COUNTEREXAMPLE | 12 | 142 / 105 | 符合预声明 | `r2-effects-controls/effects-witness-restored-origin` |
| effects-witness-first-return-second-held | 可达见证 | COUNTEREXAMPLE | 12 | 388 / 260 | 符合预声明 | `r2-gates-small/effects-witness-first-return-second-held` |
| effects-witness-new-grant-retake | 可达见证 | COUNTEREXAMPLE | 12 | 15349 / 8948 | 符合预声明 | `r2-gates-small/effects-witness-new-grant-retake` |
| effects-witness-old-return-refresh-prune | 可达见证 | COUNTEREXAMPLE | 12 | 2400 / 1552 | 符合预声明 | `r2-gates-small/effects-witness-old-return-refresh-prune` |
| effects-witness-appearance-stopped | 可达见证 | COUNTEREXAMPLE | 12 | 12 / 9 | 符合预声明 | `r2-effects-controls/effects-witness-appearance-stopped` |
| effects-witness-restart-new | 可达见证 | COUNTEREXAMPLE | 12 | 1095 / 789 | 符合预声明 | `r2-effects-controls/effects-witness-restart-new` |
| effects-negative-live-return | 负控 | COUNTEREXAMPLE | 13 | 10155 / 5793 | 符合预声明 | `r2-effects-controls/effects-negative-live-return` |
| effects-negative-missed-projection | 负控 | COUNTEREXAMPLE | 13 | 19797 / 11003 | 符合预声明 | `r2-effects-controls/effects-negative-missed-projection` |
| recovery-appearance | 正向穷尽 | PASS_WITHIN_SCOPE | 0 | 15984 / 0 | 符合预声明 | `matrix-r1/recovery-appearance` |
| recovery-private | 正向穷尽 | PASS_WITHIN_SCOPE | 0 | 15984 / 0 | 符合预声明 | `matrix-r1/recovery-private` |
| recovery-expanded-capacity | 正向穷尽 | PASS_WITHIN_SCOPE | 0 | 15984 / 0 | 符合预声明 | `matrix-r1/recovery-expanded-capacity` |
| recovery-retry-bound | 正向穷尽 | PASS_WITHIN_SCOPE | 0 | 33619 / 0 | 符合预声明 | `matrix-r1/recovery-retry-bound` |
| recovery-negative-type | 负控 | COUNTEREXAMPLE | 12 | 6 / 4 | 符合预声明 | `matrix-r1/recovery-negative-type` |
| recovery-negative-unknown-new-id | 负控 | COUNTEREXAMPLE | 12 | 78 / 53 | 符合预声明 | `matrix-r1/recovery-negative-unknown-new-id` |
| recovery-negative-rewrite-original | 负控 | COUNTEREXAMPLE | 12 | 28 / 18 | 符合预声明 | `matrix-r1/recovery-negative-rewrite-original` |
| recovery-negative-receipt-after-validation | 负控 | COUNTEREXAMPLE | 12 | 59 / 38 | 符合预声明 | `matrix-r1/recovery-negative-receipt-after-validation` |
| recovery-negative-repeat-effect | 负控 | COUNTEREXAMPLE | 12 | 21 / 14 | 符合预声明 | `matrix-r1/recovery-negative-repeat-effect` |
| recovery-negative-consume-all | 负控 | COUNTEREXAMPLE | 12 | 18 / 11 | 符合预声明 | `matrix-r1/recovery-negative-consume-all` |
| recovery-negative-recovery-drops-other | 负控 | COUNTEREXAMPLE | 12 | 21 / 13 | 符合预声明 | `matrix-r1/recovery-negative-recovery-drops-other` |
| recovery-negative-capacity | 负控 | COUNTEREXAMPLE | 12 | 1034 / 444 | 符合预声明 | `matrix-r1/recovery-negative-capacity` |
| recovery-witness-both-complete | 可达见证 | COUNTEREXAMPLE | 12 | 302 / 165 | 符合预声明 | `matrix-r1/recovery-witness-both-complete` |
| recovery-witness-unknown-before | 可达见证 | COUNTEREXAMPLE | 12 | 7 / 4 | 符合预声明 | `matrix-r1/recovery-witness-unknown-before` |
| recovery-witness-unknown-after | 可达见证 | COUNTEREXAMPLE | 12 | 17 / 10 | 符合预声明 | `matrix-r1/recovery-witness-unknown-after` |
| recovery-witness-new-while-unknown | 可达见证 | COUNTEREXAMPLE | 12 | 22 / 14 | 符合预声明 | `matrix-r1/recovery-witness-new-while-unknown` |
| recovery-witness-restart-recovered | 可达见证 | COUNTEREXAMPLE | 12 | 149 / 89 | 符合预声明 | `matrix-r1/recovery-witness-restart-recovered` |
| recovery-witness-retry-exhausted | 可达见证 | COUNTEREXAMPLE | 12 | 1544 / 593 | 符合预声明 | `matrix-r1/recovery-witness-retry-exhausted` |
| terms-reusable-remedy | 正向穷尽 | PASS_WITHIN_SCOPE | 0 | 1196 / 0 | 符合预声明 | `r2-terms-final/terms-reusable-remedy` |
| terms-single-use | 正向穷尽 | PASS_WITHIN_SCOPE | 0 | 25 / 0 | 符合预声明 | `r2-terms-final/terms-single-use` |
| terms-before-settlement | 正向穷尽 | PASS_WITHIN_SCOPE | 0 | 2954 / 0 | 符合预声明 | `r2-terms-final/terms-before-settlement` |
| terms-negative-type | 负控 | COUNTEREXAMPLE | 12 | 6 / 4 | 符合预声明 | `r2-terms-final/terms-negative-type` |
| terms-negative-edit-old-scope | 负控 | COUNTEREXAMPLE | 12 | 6 / 4 | 符合预声明 | `r2-terms-final/terms-negative-edit-old-scope` |
| terms-negative-generic-grant | 负控 | COUNTEREXAMPLE | 12 | 3 / 1 | 符合预声明 | `r2-terms-final/terms-negative-generic-grant` |
| terms-negative-drop-term-basis | 负控 | COUNTEREXAMPLE | 12 | 8 / 5 | 符合预声明 | `r2-terms-final/terms-negative-drop-term-basis` |
| terms-negative-schema-declines | 负控 | COUNTEREXAMPLE | 12 | 4 / 2 | 符合预声明 | `r2-terms-final/terms-negative-schema-declines` |
| terms-witness-both-remedies | 可达见证 | COUNTEREXAMPLE | 12 | 863 / 171 | 符合预声明 | `r2-terms-final/terms-witness-both-remedies` |
| terms-witness-private-deferred | 可达见证 | COUNTEREXAMPLE | 12 | 6 / 3 | 符合预声明 | `r2-terms-final/terms-witness-private-deferred` |
| terms-witness-authority-rejected | 可达见证 | COUNTEREXAMPLE | 12 | 3 / 1 | 符合预声明 | `r2-terms-final/terms-witness-authority-rejected` |
| terms-witness-single-use-permitted | 可达见证 | COUNTEREXAMPLE | 12 | 1130 / 119 | 符合预声明 | `r2-terms-final/terms-witness-single-use-permitted` |
| terms-use-defense-appearance | 正向穷尽 | PASS_WITHIN_SCOPE | 0 | 20 / 0 | 符合预声明 | `r2-terms-final/terms-use-defense-appearance` |
| terms-negative-use-defense-appearance | 负控 | COUNTEREXAMPLE | 12 | 4 / 2 | 符合预声明 | `r2-terms-final/terms-negative-use-defense-appearance` |
| terms-use-defense-private_items | 正向穷尽 | PASS_WITHIN_SCOPE | 0 | 20 / 0 | 符合预声明 | `r2-terms-final/terms-use-defense-private_items` |
| terms-negative-use-defense-private_items | 负控 | COUNTEREXAMPLE | 12 | 2 / 0 | 符合预声明 | `r2-terms-final/terms-negative-use-defense-private_items` |
| authority-private | 正向穷尽 | PASS_WITHIN_SCOPE | 0 | 93536 / 0 | 符合预声明 | `r2-components/authority-private` |
| authority-restart-private | 正向穷尽 | PASS_WITHIN_SCOPE | 0 | 639440 / 0 | 符合预声明 | `r2-components-300/authority-restart-private` |
| authority-both | 正向穷尽 | INCONCLUSIVE | 143 | 未获终局数 | 未满足 | `r2-components-300/authority-both` |
| authority-cooperative-return | 正向穷尽 | PASS_WITHIN_SCOPE | 0 | 93536 / 0 | 符合预声明 | `r2-components/authority-cooperative-return` |
| authority-negative-current-only | 负控 | COUNTEREXAMPLE | 12 | 84 / 57 | 符合预声明 | `r2-components/authority-negative-current-only` |
| authority-negative-first-item-closes-all | 负控 | COUNTEREXAMPLE | 12 | 31 / 25 | 符合预声明 | `r2-components/authority-negative-first-item-closes-all` |
| authority-negative-retake-completed | 负控 | COUNTEREXAMPLE | 12 | 116 / 85 | 符合预声明 | `r2-components/authority-negative-retake-completed` |
| authority-witness-new-grant-retake | 可达见证 | COUNTEREXAMPLE | 12 | 3567 / 1960 | 符合预声明 | `r2-components/authority-witness-new-grant-retake` |
| authority-witness-old-return-new-slot | 可达见证 | COUNTEREXAMPLE | 12 | 236 / 151 | 符合预声明 | `r2-components/authority-witness-old-return-new-slot` |
| projection-owner | 正向穷尽 | PASS_WITHIN_SCOPE | 0 | 436 / 0 | 符合预声明 | `r2-components/projection-owner` |
| projection-origin | 正向穷尽 | PASS_WITHIN_SCOPE | 0 | 436 / 0 | 符合预声明 | `r2-components/projection-origin` |
| projection-negative-type | 负控 | COUNTEREXAMPLE | 12 | 5 / 3 | 符合预声明 | `r2-components/projection-negative-type` |
| projection-negative-current-only | 负控 | COUNTEREXAMPLE | 12 | 54 / 26 | 符合预声明 | `r2-components/projection-negative-current-only` |
| projection-negative-stale-view | 负控 | COUNTEREXAMPLE | 12 | 6 / 3 | 符合预声明 | `r2-components/projection-negative-stale-view` |
| projection-negative-accept-old-seq | 负控 | COUNTEREXAMPLE | 12 | 21 / 13 | 符合预声明 | `r2-components/projection-negative-accept-old-seq` |
| projection-negative-accept-old-view | 负控 | COUNTEREXAMPLE | 12 | 10 / 6 | 符合预声明 | `r2-components/projection-negative-accept-old-view` |
| projection-negative-receipt-overwrite | 负控 | COUNTEREXAMPLE | 12 | 115 / 55 | 符合预声明 | `r2-components/projection-negative-receipt-overwrite` |
| projection-witness-new-view-old-holding | 可达见证 | COUNTEREXAMPLE | 12 | 169 / 70 | 符合预声明 | `r2-components/projection-witness-new-view-old-holding` |
| projection-witness-late-accepted | 可达见证 | COUNTEREXAMPLE | 12 | 180 / 76 | 符合预声明 | `r2-components/projection-witness-late-accepted` |
| projection-witness-same-slot-change | 可达见证 | COUNTEREXAMPLE | 12 | 15 / 9 | 符合预声明 | `r2-components/projection-witness-same-slot-change` |
| projection-witness-origin-not-delivered | 可达见证 | COUNTEREXAMPLE | 12 | 166 / 68 | 符合预声明 | `r2-components/projection-witness-origin-not-delivered` |
| projection-negative-receipt-liveness | 负控 | COUNTEREXAMPLE | 13 | 492 / 0 | 符合预声明 | `r2-components-300/projection-negative-receipt-liveness` |

## 全部历史超时（不覆盖、不改绑）

| 运行 | 上限s | 最近已探索下界：depth / generated / distinct / queue |
| --- | --- | --- |
| `matrix-r1/effects-both` | 60 | 8 / 190267 / 73067 / 51899 |
| `matrix-r1/effects-restart-private` | 60 | 10 / 188812 / 68132 / 39432 |
| `r2-components/authority-both` | 60 | 8 / 155464 / 38012 / 23529 |
| `r2-components/authority-restart-private` | 60 | 10 / 145863 / 39722 / 20221 |
| `r2-components-300/authority-both` | 300 | 14 / 14027136 / 2294877 / 938288 |
| `r2-effects-positive/effects-both` | 300 | 12 / 13080040 / 3137818 / 1907604 |
| `r2-effects-positive/effects-cooperative-return` | 60 | 8 / 21789 / 7379 / 4541 |
| `r2-effects-positive/effects-private` | 60 | 10 / 114114 / 33558 / 18531 |
| `r2-effects-positive/effects-restart-private` | 300 | 15 / 13251311 / 2881423 / 1091445 |

## 性质负控索引

以下目标名称来自实际触发的安全负控；NoWitness是存在性探针，不当安全负控。时间性质以TLC的rc13报告，不能伪填rc12。Authority继承相同PersonalEffects动作/不变量；共享负控的实际原模块hash见RUN_INDEX及SOURCE_MAP。

| 性质 | 实际负控配置 |
| --- | --- |
| ActiveRequiresCurrent | consent-negative-skip-invalidation |
| AtomicAppearanceStop | effects-negative-split-stop |
| AtomicPrivateStop | effects-negative-split-private |
| CapacitySufficient | recovery-negative-capacity |
| CompleteSnapshot | projection-negative-current-only, projection-negative-stale-view |
| CompletedItemNotRetaken | effects-negative-retake-completed, authority-negative-retake-completed |
| ConfirmedProjectionOnly | effects-negative-ui-receipt-overwrite |
| CooperativeReturns | effects-negative-live-return |
| CurrentReturnReference | effects-negative-stale-return-view |
| CurrentViewOnly | projection-negative-accept-old-view |
| CustodyProvenance | effects-negative-reassign-custody |
| DecisionBasisRechecked | consent-negative-stale-basis |
| EffectAtMostOnce | consent-negative-repeat-effect, recovery-negative-repeat-effect |
| EventuallyCurrent | projection-negative-receipt-liveness |
| NoReusableGrant | terms-negative-generic-grant |
| NoReusableUse | terms-negative-use-defense-appearance, terms-negative-use-defense-private_items |
| NoRollback | projection-negative-accept-old-seq |
| NoThirdPartyOverwrite | cas-negative-overwrite |
| NoThirdPartyReplacement | consent-negative-third-party |
| OnlyOwnerDeclines | terms-negative-schema-declines |
| OriginalIdentityStable | recovery-negative-rewrite-original |
| OwnDecisionOnly | consent-negative-cancel-as-withdraw |
| OwnerCanCloseInvalidated | consent-negative-old-participant-epoch |
| PendingPurposesPreserved | recovery-negative-consume-all, recovery-negative-recovery-drops-other |
| PrivateOwnerOnly | effects-negative-public-return |
| ProjectionEventuallyCurrent | effects-negative-missed-projection |
| PurposeAndTakerAuthorized | effects-negative-cross-purpose, effects-negative-wrong-taker, effects-negative-old-capability |
| PurposeRequestIsolation | consent-negative-wrong-request, consent-negative-wrong-withdraw |
| ReceiptDoesNotChangeSnapshot | projection-negative-receipt-overwrite |
| ReceiptDoesNotReactivate | consent-negative-receipt-reactivates |
| ReceiptNeverReactivates | effects-negative-receipt-reactivates |
| ReceiptStable | recovery-negative-receipt-after-validation |
| RemainingItemEntitlement | effects-negative-first-item-closes-all, authority-negative-first-item-closes-all |
| RestitutionEnabled | effects-negative-return-needs-active |
| ReturnContextPrivate | effects-negative-leak-return |
| ReturnEntryRetained | effects-negative-history-trims-return, authority-negative-current-only |
| ReturnPreservesClosureCause | effects-negative-return-rewrites-history |
| SafetyAndHistoryDurable | consent-negative-rollback |
| SafetyAndKnowledgeDurable | effects-negative-rollback |
| ScopeBinding | consent-negative-wrong-scope |
| ScopeTermImmutable | terms-negative-edit-old-scope |
| SingleCommitPerPublicRevision | cas-negative-skip-cas |
| SingleUnsettled | recovery-negative-unknown-new-id |
| StrictTermBasis | terms-negative-drop-term-basis |
| TypeOK | cas-negative-type, consent-negative-type, effects-negative-type, recovery-negative-type, terms-negative-type, projection-negative-type |
