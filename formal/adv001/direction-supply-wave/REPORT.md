# r1 + r1a 有限形式化检查报告

## 结论

**PASS_WITHIN_SCOPE。** 冻结后的 `WaveProgress` 在 11 个有限正向配置中完成 BFS，22 项启用性质均未违反；32 个故意缺陷配置全部以 TLC `rc=12` 命中预声明的准确 invariant。17 个初步到达探针与 4 个更严格的顺序探针也均找到目标状态。

这里是 **64 次正式运行 = 11 正向 + 32 负控 + 17 初步见证 + 4 补充见证**。补充 4 次增强了已有业务义务的先后证据，不能再算成 4 项独立业务保证，也不意味着 21 个互不重叠的场景。所有反例探针原始状态仍为 `COUNTEREXAMPLE`，没有回填成 PASS。

**implementation_status：NOT_ASSESSED；独立模型复核：NOT_RUN；交接材料：COMPLETE。** 本 worker 是提案的独立形式化检查者，同时是本模型作者；本报告不是作者之外对模型的复审。新协调器没有实现/PG/浏览器结果，没有毫秒收益或活性结论。既有自然方向门槛 FAIL 保持；本包不宣称任何源码、PostgreSQL 或体验已证明。

## 固定输入与工具

输入提案、基线源码与实际读取范围见 [inputs.json](inputs.json)、[project-profile.json](project-profile.json)；性质合同见 [CONTRACT.md](CONTRACT.md)。r1a 的作者为总控，单行终止解释经本 worker 以必要见证独立检查。原三份 r1 没有改写。

| 对象 | SHA256 / 身份 |
| --- | --- |
| `WaveWitnesses.tla` | `49651049624fe403aef5d9724d74ca93a5e1bc4c1500e979c4cd644b81527b47` |
| `WaveProgress.tla` | `61749c7428dfc14a4a2450991fd86c0ded4411a3c6a50532bb250f3fca2356e0` |
| 官方工具 | v1.7.4 / TLC 2.19；`936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88` |
| 固定 runner | `ca5811a8cae5d31961185b0ba53868f3ea885a1ee614150d873d61044ff18f5a` |
| Java | OpenJDK 21.0.13 |
| 读源基线 | `aacbf377e3cb94cb2c9ec77c3609eac9e773b1e5` / tree `e760d4cfa13e99146177651db3029ba6794f6191` |

每次为普通 BFS、1 worker、768 MiB、180 秒预算；正向状态数预声明下限 50，负控/见证下限 2。没有搜索裁剪、对称归约、模拟或主动终止。死锁和 liveness 均未检查；有限输入可以用尽，SQL/RPC/网络可永久等待，不加公平性。`owed` 检查的是不能用新波次取消旧行机会的安全性预算，不保证调度器最终选择某个 enabled 动作。

## 正向配置

所有行均 `PASS_WITHIN_SCOPE`、TLC exit 0、`completed=true`、remaining queue 0，并启用相同 22 项性质。状态数分别属于各配置，不能相加冒充一个组合故障模型。

| 配置 | P 行数 / peer 预算 | head 上限 / 初始 sent / 页步长 | 环境扰动 | distinct |
| --- | --- | --- | --- | ---: |
| [positive-two-rows](model/positive-two-rows.cfg) | 2 / 2 | 3 / 2 / 4 | stable | 1,078 |
| [positive-one-row-budget](model/positive-one-row-budget.cfg) | 1 / 1 | 3 / 2 / 4 | stable | 260 |
| [positive-rpc](model/positive-rpc.cfg) | 2 / 2 | 3 / 2 / 4 | rpc | 3,000 |
| [positive-failure](model/positive-failure.cfg) | 2 / 2 | 3 / 2 / 4 | failure | 4,111 |
| [positive-pending](model/positive-pending.cfg) | 2 / 2 | 3 / 2 / 4 | pending | 24,329 |
| [positive-view](model/positive-view.cfg) | 2 / 2 | 3 / 2 / 4 | view | 14,853 |
| [positive-join](model/positive-join.cfg) | 2 / 2 | 3 / 2 / 4 | join | 9,395 |
| [positive-close](model/positive-close.cfg) | 2 / 2 | 3 / 2 / 4 | close | 7,915 |
| [positive-mixed](model/positive-mixed.cfg) | 2 / 2 | 3 / 2 / 4 | mixed | 3,851 |
| [positive-merge](model/positive-merge.cfg) | 2 / 2 | 4 / 2 / 4 | stable | 6,979 |
| [positive-pagination](model/positive-pagination.cfg) | 2 / 2 | 3 / 1 / 1 | stable | 7,479 |

## 每条性质的实际结果与敏感性

下表每个负控均是独立配置、原始 `COUNTEREXAMPLE`、TLC exit 12，`messages.json` 的 2110 消息准确命中该行 invariant。括号为该反例停止时的 distinct 数，并非完整状态空间。部分负控故意破坏环境锁或调度守卫，说明性质能发现这种缺陷，不是声称实际产品已有该错误。

| 启用性质 | 正向实际结果 | 定向负控及 distinct |
| --- | --- | --- |
| `TypeOK` | 11/11 完成，无违反 | [negative-type](model/negative-type.cfg) (4) |
| `SingleSlots` | 11/11 完成，无违反 | [negative-second-owner](model/negative-second-owner.cfg) (4)；[negative-second-progress](model/negative-second-progress.cfg) (8)；[negative-second-wave](model/negative-second-wave.cfg) (9) |
| `PeerBudget` | 11/11 完成，无违反 | [negative-exceed-budget](model/negative-exceed-budget.cfg) (8) |
| `LockExclusion` | 11/11 完成，无违反 | [negative-read-through-lock](model/negative-read-through-lock.cfg) (67)；[negative-progress-through-read](model/negative-progress-through-read.cfg) (65) |
| `AdmissionSettled` | 11/11 完成，无违反 | [negative-early-progress](model/negative-early-progress.cfg) (9) |
| `DrainedOwner` | 11/11 完成，无违反 | [negative-early-release](model/negative-early-release.cfg) (23) |
| `NoSQLCancellation` | 11/11 完成，无违反 | [negative-cancel-sql](model/negative-cancel-sql.cfg) (73) |
| `NoNewAfterStop` | 11/11 完成，无违反 | [negative-start-after-stop](model/negative-start-after-stop.cfg) (11)；[negative-wave-after-drain](model/negative-wave-after-drain.cfg) (102) |
| `OrderedAttempts` | 11/11 完成，无违反 | [negative-reorder-rows](model/negative-reorder-rows.cfg) (3) |
| `ExactRowCommit` | 11/11 完成，无违反 | [negative-batch-update](model/negative-batch-update.cfg) (36) |
| `ActualCommitOnly` | 11/11 完成，无违反 | [negative-precommit-published](model/negative-precommit-published.cfg) (22)；[negative-rollback-commit](model/negative-rollback-commit.cfg) (98) |
| `PendingBlocks` | 11/11 完成，无违反 | [negative-ignore-pending](model/negative-ignore-pending.cfg) (160)；[negative-pending-after-check](model/negative-pending-after-check.cfg) (168) |
| `CurrentCoverage` | 11/11 完成，无违反 | [negative-stale-coverage](model/negative-stale-coverage.cfg) (152)；[negative-join-after-check](model/negative-join-after-check.cfg) (129) |
| `SentProof` | 11/11 完成，无违反 | [negative-fake-proof](model/negative-fake-proof.cfg) (58) |
| `SuccessfulSentRetained` | 11/11 完成，无违反 | [negative-rollback-peer](model/negative-rollback-peer.cfg) (109) |
| `FailureDoesNotAdvance` | 11/11 完成，无违反 | [negative-failure-as-success](model/negative-failure-as-success.cfg) (36) |
| `NoStaleSend` | 11/11 完成，无违反 | [negative-stale-send](model/negative-stale-send.cfg) (276) |
| `FixedAuthorizedHead` | 11/11 完成，无违反 | [negative-hint-as-authority](model/negative-hint-as-authority.cfg) (181) |
| `RPCBoundary` | 11/11 完成，无违反 | [negative-bypass-rpc](model/negative-bypass-rpc.cfg) (21)；[negative-rpc-above-ceiling](model/negative-rpc-above-ceiling.cfg) (7) |
| `FiniteWave` | 11/11 完成，无违反 | [negative-chase-wave](model/negative-chase-wave.cfg) (11)；[negative-repeat-peer](model/negative-repeat-peer.cfg) (582) |
| `NoBusyRetry` | 11/11 完成，无违反 | [negative-busy-retry](model/negative-busy-retry.cfg) (9,620) |
| `ProgressOpportunity` | 11/11 完成，无违反 | [negative-erase-owed](model/negative-erase-owed.cfg) (1,657)；[negative-bypass-opportunity](model/negative-bypass-opportunity.cfg) (1,932) |

### 反例的业务解释

- `early-progress` 在 W 尚未收束时接纳 G，立即违反入场证书；`second-progress/second-wave/second-owner` 则直接暴露唯一性丢失。新合同允许 G 入场后的新 W，不允许新 G 越过这个 W。
- `read-through-lock/progress-through-read` 分别删除两边锁守卫，产生共享读与排他 G 同时持锁。`cancel-sql` 把仍有真实 SQL outstanding 的工作标为结果；单纯清理 Promise 不能使查询消失。
- `ignore-pending/stale-coverage` 重用旧检查；`pending-after-check/join-after-check` 故意取消写侧切点约束，使检查与 COMMIT 间出现新阻断。后两者是接口假设敏感性，不能将任意无锁内部调用当成生产可达反例。
- `batch-update/precommit-published/rollback-commit` 分别暴露批量标记、真实 COMMIT 前成功和回应丢失后的假回滚；`rollback-peer/failure-as-success/fake-proof` 区分失败与可信水位，成功 peer 不受新失败回退。
- `hint-as-authority` 把读后更新的 H 写入旧候选，超过固定 rowHead；`stale-send` 复用失效绑定；RPC 两个负控分别绕过 lane 与旧 cursor ceiling。
- `chase-wave/repeat-peer/busy-retry` 暴露一个 W 追新 H、重复同 peer 页机会及无进展的同输入自旋；`erase-owed/bypass-opportunity` 表明持续新 hint 不得取消有限 W 后旧 G 的选择机会。

## 初步到达见证：17 次

以下全部是 `Fault="none"`、准确目标 `rc=12`。反例表示目标状态可达，不能解释为有限安全模型失败，也不能将一条可达轨迹写成所有运行都会发生。

| 配置 | 到达事实 | distinct |
| --- | --- | ---: |
| [witness-stopped-sql](model/witness-stopped-sql.cfg) | 停止时 G 持锁、W 的 SQL 仍 outstanding；没有把它当成取消。 | 140 |
| [witness-one-row-overlap](model/witness-one-row-overlap.cfg) | P=1，先 G queued，再 COMMIT3，再 W 入 lane；尚不表示 SQL 已授锁。 | 19 |
| [witness-two-row-overlap](model/witness-two-row-overlap.cfg) | P=2 的同一新 COMMIT 在 G 在途后进入 W 的顺序。 | 19 |
| [witness-rpc-lane](model/witness-rpc-lane.cfg) | 本人 publisher 等旧 RPC lane，另一 peer 已进入 SQL 等待，G 仍在途。 | 38 |
| [witness-lock-wait](model/witness-lock-wait.cfg) | G 持排他锁，W SQL 已提交但无读锁；不是穿锁读取。 | 45 |
| [witness-committed-wave](model/witness-committed-wave.cfg) | 旧 R 已真实 COMMIT、函数尚未 settle，同时 W 仍存在。 | 71 |
| [witness-completed-overlap](model/witness-completed-overlap.cfg) | 发生 G 中的新 COMMIT/W 重叠后，两条旧行均提交并释放 owner。 | 1,075 |
| [witness-send-error-drain](model/witness-send-error-drain.cfg) | A 新前缀成功、B 发送失败；旧 G 可在失败后自然合法完成，最后全收束。 | 3,585 |
| [witness-read-error-drain](model/witness-read-error-drain.cfg) | W 读失败后，已有 G/W 全收束才退出。 | 2,315 |
| [witness-unknown-retained](model/witness-unknown-retained.cfg) | 真实 COMMIT 后回应丢失，Published 保留，最后退出。 | 265 |
| [witness-close-drain](model/witness-close-drain.cfg) | W 真实读锁在途与 G 并存时关闭；读完成/拒绝、G 收束后退出。 | 4,887 |
| [witness-mixed-drain](model/witness-mixed-drain.cfg) | 当前能力变 mixed，既有双槽收束后退出，无后续新工作。 | 612 |
| [witness-pending-blocked](model/witness-pending-blocked.cfg) | 存在 pending 时旧行可按原序跳过并保留未发布。 | 11 |
| [witness-view-discard](model/witness-view-discard.cfg) | 读已完成，随后换 binding，旧 candidate 被丢弃，新 binding 水位没有被旧证明推进。 | 276 |
| [witness-merge-opportunity](model/witness-merge-opportunity.cfg) | 头已到4，有限波次后保留的旧进度机会实际被使用。 | 1,892 |
| [witness-pagination](model/witness-pagination.cfg) | 页步长1，存在两波并使用旧进度机会；不是在单波无限追页。 | 1,376 |
| [witness-drain-second-group](model/witness-drain-second-group.cfg) | 保留初步名称；此弱目标仅证 draining 后启动某个既有冻结组，不能单独证明它是第二组。 | 75 |

## 严格顺序补证：4 次

`WaveWitnesses` 仅在原 `Next` 上累积观察历史，没有增加或排除业务动作。它主要防止将同一个终态误读为某种先后关系。core 模型 SHA 始终不变；没有为补证重跑 60 条核心集合。

| 配置 | 比初步目标更严格的条件 | distinct |
| --- | --- | ---: |
| [witness-second-group-after-drain](model/witness-second-group-after-drain.cfg) | P=1、预算1，第一组已 settle，G settle 进入 draining，随后第二组才启动。 | 174 |
| [witness-single-row-full-cycle](model/witness-single-row-full-cycle.cfg) | G先在途→新COMMIT3→W→G真实提交/settle→draining→后续组→两peer均证明到3→owner释放。 | 260 |
| [witness-late-send-failure](model/witness-late-send-failure.cfg) | 观察历史保证旧 G 的真实 COMMIT 先于新 W 发送失败；旧行与 A 成功水位保持至最后释放。 | 3,701 |
| [witness-next-row-waits](model/witness-next-row-waits.cfg) | G1 已实际 settle、P 下一条是R2、W仍在途；G2尚未接纳。 | 101 |

### 两条已读原始状态序列

**单行完整生命周期**共25个状态：2 为 G queued；3 才出现新 COMMIT3；4 开 W；5–11 第一组完成；12–15 旧 G 取锁、检查、精确 UPDATE、真实 COMMIT；16 G settle，draining=true；17 第二组启动；21 两 peer sent 均为3；24 W settle；25 owner=0。G1 提交没有把新头3加入原 P。

**旧提交后新发送失败**共23个状态：9 A 已真证明至3；17 旧 R1 已真实 COMMIT；18 B 才发生发送失败，观察历史 `failureAfterCommit=true`；19–22 已开始工作全部收束；23 owner=0，旧 R1 仍 Published，A=3、B=2。此探针不要求新 COMMIT 发生于 G 入场之后；该先后由前一单行见证专门承担。

这些状态是模型逻辑顺序，不是毫秒时间线；没有将用户诊断中的8119 COMMIT hint 解释成本人 FOR SHARE 已经排队，更没有绕过持续至旧 RPC packet/proof 结束的同 handle 工作。

## 检查中澄清及修正

1. **r1 终止切点的歧义**：若游标到尾即禁 W，P=1 的核心重叠会被排除。总控的冻结 r1a 明确最后 G 实际 settle 才进入 draining，本包已以单行完整轨迹核验；没有修改原三稿或把原稿假定为已采用。
2. **旧 G 与新 W 的失败归属**：总控明确已启动旧 G 沿原 helper 自然收束。当前基线 helper 不接收取消信号；旧 R 可在锁内复核合法后提交，新 H 不因之成功。既有 helper 的真实身份在 project-profile 中，新协调器对应仍未评估。
3. **模型作者修正，不是产品 bug**：早期原型允许失效的 `sql` 等待直接 discard，未充分表示查询尚未返回；现已加入 sqlOutstanding、授权拒绝步骤与 NoSQLCancellation 负控。又加强了新 COMMIT 必须发生于 G 在途之后、读完成后换 view、关闭时正在读等见证条件。早期语法错误及所有探索原件单独保留，不用其 PASS 支持最终结论。
4. **无新增范围扩张**：没有改旧两个 formal 包，没有旧44/59全跑，没有业务/测试/阈值修改。当前有限模型未发现阻断提案的安全性反例；未覆盖的真实 adapter/pending 与监听/SQL实现问题仍必须按 HANDOFF 核验。

## 归档及复核

- 正式64条：[文件](evidence/r1a-records.tar.gz)，732,787 字节，SHA256 `e85319c95c6abec09add40e10d3f6b24b00c95c73aa71535e3a07f05d2639581`。
- 早期探索60条：[文件](evidence/exploration-records.tar.gz)，666,010 字节，SHA256 `29abbf07b31f56e3a4106d30a6a76ff175483328034d1bcc51a61bde93847381`。

归档保留每条原始 result.json、manifest.json、tlc.log、messages.json，包含实际 Java argv、工具/runner/模型/cfg SHA、进程退出、统计与完整反例状态；重复输入只按内容身份存一份，run-index 指向其快照。原始日志中的历史绝对路径不改写。官方 jar 不重新打包，固定摘要与 runner、toolchain 元数据随包保留；如需重做须取得相同 jar。

探索归档有1条语法 TOOL_ERROR、12条旧版正向完成、47条旧版反例探针。它们不是最终64条的组成部分，模型/manifest 身份分别保存。没有修改原始 result 的 NOT_ASSESSED，也没有把工具错误计为敏感性。

`audit.py` 的本次实际只读核验已确认归档摘要、每条原始文件、模型/cfg与当前字节、工具身份、各目标2110消息、状态数下限、正向完成和空队列、22项性质都有负控。此核验不运行新 TLC。完整未覆盖边界见 CONTRACT，实际回归场景见 HANDOFF；它们是结论的必要限定。
