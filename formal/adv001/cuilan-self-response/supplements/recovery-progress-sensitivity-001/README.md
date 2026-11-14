# BothPurposesProgress 专门时间负控补充

关联 `R-CS-FORMAL-LIVE-SENS-001` 与 CS-T05/#59。基于固定 `77ace28f526ce9ad905b1842b7353e48e251423c`，本补充只检查既有 PersonalRecovery 的时间性质敏感性。作者状态 **FIX_REPORTED**；独立复审 **NOT_RUN**，由另一位 reviewer 判定。生产实现仍 NOT_ASSESSED。

## 固定预声明与实际结果

预声明在运行前单独提交，实际身份见 [PREDECLARED.json](PREDECLARED.json) 与 [EVIDENCE.json](EVIDENCE.json)。本轮作者从原 77ace 独立复核角色切换为补充候选作者，原独立报告不自动覆盖此增量。

- 唯一新 profile：`recovery-negative-progress-consume-all`。
- 不修改 `PersonalRecovery.tla`、原正向配置、原 LiveSpec/弱公平、有限规模、原期待判据或原 RUN_INDEX。
- 复用已有 `Fault="consume-all"`。只在新增负控 cfg 中启用原 `LiveSpec` 和唯一 PROPERTY `BothPurposesProgress`；不启用会更早给出 rc12 的安全不变量。这是专门敏感性配置，不是削弱正向验收。
- 预算一次 60 s / 1 worker / 512 MiB。实际 2.360384 s，runner rc2，TLC **rc13 / COUNTEREXAMPLE**，没有超时或工具错误。
- 1 个初态；16,752 generated / 5,081 distinct / queue 0。`completed=false`，不将时间反例的空队列称为性质通过。
- 原 131 配置仍是 28 有限 PASS / 98 预期反例 / 5 INCONCLUSIVE；本补充另有 1 个目标时间负控，不修改旧统计或原作者证据。

## 原始时间反例及解释

原 `messages.json`、`tlc.log`、`result.json` 与 `manifest.json` 全部保留；`trace.txt` 是原状态文本的顺序摘录。逐文件摘要及 run_id 在 [EVIDENCE.json](EVIDENCE.json)，具体原件位置随交接给独立复核者。正式文档不链接临时输出目录。

| 原状态 | 动作 | 关键事实 |
| --- | --- | --- |
| 1 | Init | appearance task1 与 private_items task2 均已知、待办且尚未完成 |
| 2–3 | Restart / Resume | 有限一次重启后 Running，epoch2；两项待办仍保留 |
| 4–7 | Reserve(private task2) / LoseBefore / Recover / Commit | 首次提交前丢返回，沿原 id/raw 重试，原任务真实 Accepted |
| 8 | Consume | private task2 完成，finished={2}；故障把 appearance 与 private 的 pending 一起设0；appearance known=current=1、尚未完成 |
| 9 | Stuttering | 状态8无限重复，appearance 不能得到进展，BothPurposesProgress 被违反 |

故障后 Reserve(appearance) 的 Candidates 条件不再成立，内部弱公平不能重新创建被吞掉的待办。Commit/Recover/Consume/Deliver/Resume 也没有持续可执行而被忽略的义务；新的外部请求 NewInput 没有公平要求，不能靠期待玩家再发消息修复已丢任务。旧 Receipt 重读不制造进展。这是明确的无限停滞反例，不是有限前缀或安全 rc12 失败。

正常 `Fault="none"` 的 Consume 只清已处理用途，另一用途的 pending 保留；本补充与原正向执行使用完全相同的模型字节和公平性。原正向结果按原身份复用，不重跑全矩阵，也不改名称冒称本轮新测。

## 保存与复现边界

工具为固定 TLC2.19/v1.7.4；SHA-256、runner、真实 command、Java 版本及所有输入摘要见原 result.json。正式目录保存预声明、配置与可核对的结果身份索引；项目要求运行日志、完整输入快照、jar/state 留隔离运行目录，不提交原日志、jar 或状态数据库。

复现时使用新的空输出目录并按项目 `.agent-output` 约定放置；运行参数为本目录 verification.json、profile `recovery-negative-progress-consume-all`、已有摘要匹配的 TLC jar。预期 runner 返回2、原TLC返回13。失败/超时如实保留，不以别的性质或弱化公平性凑结果。

本增量只为关闭专门时间敏感性缺口提供作者证据，不改变两用途Effects/完整缓存未穷尽、两用途×重启未覆盖、无机械组合、真实FM/产品验收尚未完成的事实。后续由独立 reviewer 核对后再更新 finding；本作者不自标 VERIFIED。
