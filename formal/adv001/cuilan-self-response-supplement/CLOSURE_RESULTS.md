# #62 实际运行结果与候选边界

本表由 `collect_closure_results.py` 读取实际 result/manifest/messages/tlc.log 和输入快照生成。原候选已接受独立审查；本次 STD-001 差量待独立复审，作者不填独审结论。源模型对应及七项逐一裁决点见 [PROOF_CLOSURE.md](PROOF_CLOSURE.md)。

共 43 次实际运行：{'PASS_WITHIN_SCOPE': 10, 'COUNTEREXAMPLE': 32, 'INCONCLUSIVE': 1}。选定 41 次当前证据：9 个正常检查完整结束，32 个负控全部真实 rc12 命中预声明性质。负控反例不计作正常图 PASS，原历史七项结果不改写。

## 选定正向结果

| profile | distinct / generated / queue | 秒 | 原始返回码 | 性质 |
| --- | ---: | ---: | ---: | --- |
| closure-authority-both | 1,655,744 / 15,046,841 / 0 | 259.398 | 0 | 15 不变量、0 时间性质 |
| closure-signature-sensitivity-domain | 3,500 / 7,000 / 0 | 1.463 | 0 | 7 不变量、0 时间性质 |
| closure-effects-cooperative-return | 247,264 / 1,577,799 / 0 | 144.395 | 0 | 16 不变量、2 时间性质 |
| closure-effects-private | 247,264 / 1,577,799 / 0 | 33.019 | 0 | 16 不变量、0 时间性质 |
| closure-life-effects-restart-private | 1,656,476 / 11,062,201 / 0 | 200.231 | 0 | 16 不变量、0 时间性质 |
| closure-return-requests | 131,072 / 262,144 / 0 | 9.492 | 0 | 7 不变量、0 时间性质 |
| closure-return-rows | 8,192 / 16,384 / 0 | 2.084 | 0 | 7 不变量、0 时间性质 |
| closure-shared-quotient | 1,292,409 / 13,391,830 / 0 | 144.743 | 0 | 12 不变量、0 时间性质 |
| closure-signature-domain | 3,500 / 7,000 / 0 | 1.489 | 0 | 7 不变量、0 时间性质 |

上述状态数分别属于不同检查，不能相加解释为一个完整产品状态空间。signature 是 NF 直接输入域；原模块与 STD-001 副本 none 的两次 3500 点检查分别记录；return 两项是纯函数输入因子；shared 是同一个四 actor/两用途/共享 Restart/Terminal 图；private、restart-private、cooperative 保留完整 cache。authority-both 本身不检查缓存消费，effects-both 的安全结论另依赖 §4 的 α 模拟与缓存归纳。

## 本轮保留的历史与未完成运行

| run | 实际状态 | 真实终局或最后进度下界 | 解释 |
| --- | --- | --- | --- |
| effects-both-life-quotient-r1 | INCONCLUSIVE / rc143 | 2,545,171 distinct / 1,271,695 queue | 300 秒到期；下界不是终局，完整 cache 图未获穷尽。 |
| shared-quotient-r1 | PASS_WITHIN_SCOPE / rc0 | 1,292,409 distinct / 0 queue | 新增 SourceInputClosed 前的 11 性质版本；当前证据使用 r2。 |

`effects-both-life-quotient-r1` 的 INCONCLUSIVE 原样保留。候选组合证明只有在独审接受 η、α、15 条权威性质保持和第 16 条缓存相等归纳后，才可用于原有限安全义务；不能把本次超时改成 PASS。

已生成但未运行的替代配置：`closure-effects-both`、`closure-effects-restart-private`。它们没有取代 life 商实际运行，也未计入任何结果。

## 定向负控

| profile | 实际违反 | 真实返回码 | 秒 |
| --- | --- | ---: | ---: |
| closure-effects-negative-first-item-closes-all | RemainingItemEntitlement | 12 | 1.162 |
| closure-effects-negative-history-trims-return | ReturnEntryRetained | 12 | 0.948 |
| closure-effects-negative-stale-return-view | CurrentReturnReference | 12 | 0.985 |
| closure-effects-negative-ui-receipt-overwrite | ConfirmedProjectionOnly | 12 | 1.100 |
| closure-life-effects-negative-old-capability | PurposeAndTakerAuthorized | 12 | 1.384 |
| closure-life-effects-negative-return-rewrites-history | ReturnPreservesClosureCause | 12 | 1.252 |
| closure-return-negative-acquisition | AcquisitionIdentity | 12 | 0.940 |
| closure-return-negative-current-only | ReturnCompleteness | 12 | 1.103 |
| closure-return-negative-null | CurrentReferences | 12 | 0.998 |
| closure-return-negative-observer | ObserverIsolation | 12 | 1.010 |
| closure-return-negative-omit-item | ReturnCompleteness | 12 | 1.151 |
| closure-return-negative-origin | ReturnTargets | 12 | 0.950 |
| closure-return-negative-quota | CompleteObservable | 12 | 1.283 |
| closure-return-negative-type | SnapshotType | 12 | 0.834 |
| closure-return-negative-view | CurrentReferences | 12 | 0.986 |
| closure-shared-negative-custody | CustodyStable | 12 | 1.267 |
| closure-shared-negative-overinvalidate | ControlFrames | 12 | 0.968 |
| closure-shared-negative-performer | GrantCurrent | 12 | 0.944 |
| closure-shared-negative-quota | QuotaCorrect | 12 | 1.182 |
| closure-shared-negative-receipt | ReceiptReadOnly | 12 | 1.162 |
| closure-shared-negative-refresh-proof | ControlFrames | 12 | 0.985 |
| closure-shared-negative-source-domain | SourceInputClosed | 12 | 1.037 |
| closure-shared-negative-split-appearance | AtomicEffects | 12 | 0.934 |
| closure-shared-negative-split-private | AtomicEffects | 12 | 1.171 |
| closure-shared-negative-subject | GrantCurrent | 12 | 1.033 |
| closure-signature-negative-actor-domain | ActorDomainClosed | 12 | 0.829 |
| closure-signature-negative-actor | ActorProjection | 12 | 1.077 |
| closure-signature-negative-capture-domain | CaptureInDomain | 12 | 0.887 |
| closure-signature-negative-capture-match | CaptureMatches | 12 | 0.893 |
| closure-signature-negative-empty | EmptyStale | 12 | 0.882 |
| closure-signature-negative-restart-domain | RestartDomainClosed | 12 | 0.882 |
| closure-signature-negative-restart | RestartProjection | 12 | 0.973 |

纯输入域的初态反例可能没有终局状态统计，原 result.json 的 null 保持；不能以缺失计数自行填写 1 状态或 PASS。Probe 见证仍使用原版本与原结果，没有在擦除相关位的新模型上声称复现旧见证。

## R-ISSUE62-STD-001 差量补证

原候选的六项新属性缺少自身目标的负控，这是工程标准缺口。新增六条具体构造错误的负控和一个签名副本 none 小域正向；原正常模型、旧 cfg、原 36 次运行及 26 条原负控全部保留。没有重新运行大图或以反转断言制造反例。逐项覆盖和旧证据适用性见 `STD001_SENSITIVITY.json`、`STD001_REUSE_AUDIT.json`，具体故障及 none 展开关系见 PROOF_CLOSURE §8。这里只记录作者修正证据，finding 是否关闭仍由独审裁决。

## 身份、资源与复算

`CLOSURE_RUN_INDEX.json` 含精确模型及传递依赖/配置摘要、执行命令、TLC 指纹、原始四种证据文件 SHA、每次真实状态和超时下界。复制到 closure 的 effects/authority cfg 已逐字比较原 cfg；历史原模型摘要也重新核实。

每进程 1 worker / 1024 MiB 最大堆，最多并行两个；JVM 本地和 off-heap 内存未测量。普通 BFS、死锁检查启用，无 CONSTRAINT/VIEW/对称约简/随机模拟/Java override。TLC 2.19、OpenJDK 21.0.13，jar SHA-256：`936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`。

在仓库根目录设置同摘要 `TLA_JAR` 路径，生成审计与单项复算示例：

```sh
python3 formal/adv001/cuilan-self-response/build_history_quotient.py --check
python3 formal/adv001/cuilan-self-response-supplement/build_quotient.py --check
python3 .agents/skills/worker-tla/scripts/run_tlc.py \
  --manifest formal/adv001/cuilan-self-response-supplement/closure-shared-verification.json \
  --profile closure-shared-quotient --jar "$TLA_JAR" \
  --out .agent-output/issue62-reproduction/new-shared-run
```

每次输出必须为全新目录。原始证据封存摘要见 `CLOSURE_EVIDENCE.json`；索引只是绝对目录前缀规范化的派生物，原日志本身未替换路径或重写。

本轮不修改 Spec/业务/项目测试，也不宣告生产实现、真实 UI、SQL 原子性、网络无限交错或真人体验通过。停止新增运行的原因是剩余义务已形成具体可审的模型关系；若独审发现对应关系缺口，再针对该缺口补证。
