# 发布进度锁准入：有限模型与源码对应

本包核对 D66-PLA 的两种锁申请模式、sticky 阻塞意图及 try 锁忙后的真实收束。依据为 [#66 已采纳的 r2 设计](https://github.com/gbcdby/xiyou/issues/66#issuecomment-6997411988)和 [r3 事实修订](https://github.com/gbcdby/xiyou/issues/66#issuecomment-6997932340)。r3 保留两模式、sticky、错误与 G/W 协议，撤回“已排队的 FOR UPDATE 阻止所有后来 SHARE”的错误假设，详见 [修订说明](model-r3-correction.md)。

实际执行了 **24 个有限配置：8 个安全正例和 1 个条件性活性正例完整搜索通过，11 个错误变体、2 个可达见证及 2 个环境边界配置均产生预期反例**。反例保留 `COUNTEREXAMPLE`，不改成模型通过。逐项性质、统计、原件摘要见 [results.json](results.json)；工具、源码和注释修订的对应关系见 [project-profile.json](project-profile.json)。原始执行与独立审查见[证据归档](https://chatgpt.com/library?file_id=libfile_fde3_f-3a0ae447c0b48191a7d51a4ecb6662da_66aec10a983c8191a09f0deb89988b42&account_id=personal)。

## 两个模型的边界

`model/wave/WaveAdmission.tla` 以 a4 基线中的 WaveProgress 为起点，保留入场证书、有限 P、一个 G/W、授权读、sent/proof、逐记录提交、最后 G 实际 settle 和关闭自然收束。新增的是非致命 NOWAIT 拒绝、等待 ROLLBACK、等待 release、实际 settle；这些阶段不能直接折成旧模型的 ProgressFailure 或 SkipRecord。原 22 项安全义务继续存在，新增 `MissCleanupHeld`、`MissEffectFree`、`MissFailureDiscarded`、`UnknownNotMiss`。当前配置为两个 peer、组容量 1、P=1 或 2 和有限 head；不推广为生产五 peer、任意分页或完整数据库证明。

`model/sticky/StickyAdmission.tla` 核对外层 wait/try 意图、整轮模式、busy/异常 OR 恢复、fresh wait 与恢复位分离、自续继承及真实清理。fresh 布尔表示本轮 generation 是否变化，最后 Pending 查询独立为 probe 阶段，因此规范动作读取最终 fresh。owedPending/claimedWait 等是规范见证，不是新增产品字段；实际恢复读取 runMode/runLegacy。runtime 调用抽象为有限每轮结果，P/G/W 细节在另一模型中检查。两模型分别通过不构成机械组合或 JavaScript refinement。

## PostgreSQL 事实与条件性进度

真实有限 PostgreSQL 18.6 探针显示，已排队的 UPDATE 可以继续被后来兼容 SHARE 延长等待。因此模型允许 writerQueued 而未 exclusiveHeld 时共享进入；实际持有排他锁时仍排除共享。没有 FIFO 或 writer-priority 假设。

`fair-finite` 限定两个 reader 各最多进入一次、一个其他 writer、资格稳定，并对在途释放、内部阶段和既有维护入口使用明确弱公平。只有在这个有限冲突集合条件下，才检查 `WaitGetsOpportunity` 和 `EventuallyPublished`。前者使用永久保持的 waitQueuedSeen，表示至少获得一次排队机会，不表示每一份后续 wait 都获得逐份服务。

`fair-overlap` 允许 reader 无限重入。本次实际 TLC 循环包含 reader 释放后的短暂空锁间隙：wait 的 Grant 只间歇启用，弱公平仍允许它一直未被选择；all-try 的空隙发生在清理与返回阶段，每次实际 try 仍碰到读锁忙。两个配置均违反 `EventuallyPublished`。这不是生产错误反例，也不是 PostgreSQL 无限运行实验。模型还允许两 reader 交替、全程至少一人持锁的公平循环；该静态构造单列于修订说明，状态为 `NOT_TLC_EMITTED`，不能冒充本次打印的轨迹。没有加入强公平强迫 try 成功，也没有用约束删掉饥饿轨迹。

200ms 只是既有维护配置，不是请求到达、锁服务或提交的时间上界。`NoRestoreDrivenRepeat` 检查指定见证与错误变体，不是任意源码改写的自动无自旋证明。

## 源码对应

| 模型切点或性质 | 生产符号 | 对应义务 |
| --- | --- | --- |
| 单 owner、有限 P、G/W 槽、AdmissionSettled | Runtime.publishPending / #publishSessionWaves | 原 #publishing 不重入；一轮列表不追加；G 启动只保存初检证书；允许旧 G 在途有新 W；最后 G 实际 settle 才 draining。 |
| RejectTry → RollbackMiss → ReleaseMiss → SettleProgress | Runtime.#publishOutboxProgress | 仅指定 try SELECT 的 55P03 返回正常 miss；真实回滚与释放前保留 G；回滚失败报错并丢弃不干净 client。 |
| CheckProgress / UpdateRow / CommitRow | #outboxRecordCovered / #publishOutboxProgress | 获排他锁后重核 pending/current 的真实覆盖；仅更新本 session/through_seq 单行；COMMIT 才产生持久结果，未知提交不能降为 miss 或回写 Pending。 |
| RequestWait、StartRun、FinishNormal/Busy/Error | committedPublisher | wait 位不能被 try 清除；runMode 冻结；busy 不消费意图；异常区分 fresh wait 与恢复位；没有新许可时不自排。 |
| WaitContinuation 与 fresh | committedPublisher 最后 Pending 查询及正常自续 | 最后 await 完成后判 fresh 与 needRepeat；无新入口才继承原模式；新 wait 优先，否则新 try 可选择 try；继承不能反向制造 needRepeat。 |
| 模式来源与能力维度 | attachSpatialDirection 的 onCommit/onSupplyReady/publish；server.pulse | commit 显式 try；ready 及实际到达的维护 publish 为 wait；capability=null/legacyDue 独立于锁模式；旧/mixed 分支仍 wait。 |

生产三文件的完整 SHA256 在 project-profile 中冻结。本目录所属 Git commit 给出最终提交身份；实际模型运行发生在这些源码字节已固定、尚未提交的候选上，不能写成当时已有新提交。原 runner 的 `implementation_status` 保持 `NOT_ASSESSED`，人工源码对应与独立代码审查单独报告。

## 实现层敏感回归与未覆盖

PLA-11b/d 的“无条件继承所有 wait”“最后 await 前缓存 generation”没有实现为本模型的 Fault，状态明确为 `NO_TLC_MUTATION`。其公共 API 回归分别在原 wait 轮次收到新 try 且无新 wait 时检查下一轮 try，以及把新 try 放在最后 Pending promise 尚未完成的窗口后检查下一轮 try。独立审查是否接受这两项分层覆盖以 project-profile 的明确结论为准；现有 drop-wait-continuation 和 inherit-before-repeat 是不同错误，不能冒充这两项覆盖。

Sticky 当前安全配置未启用 legacy、pending、close，不能因性质名称出现在配置中就称已覆盖这些扰动。其 busy-consumes-legacy 变体在当前场景开关组合下不可达。本次 Wave 单独检查关闭安全与关闭收束可达见证，真实实现的旧/mixed、安装变化、关闭和错误分支由公共 API 与 PG 回归另行承担。

本包不证明任意 peer/session/记录数量、跨实例、完整 pool 或 PostgreSQL 调度、公平吞吐、故障永久恢复、毫秒延迟、真实页面 paint、自然方向体验或完整源码 refinement。旧自然方向失败及原预算继续保留；模型结果不替代 normal → late → five 产品门槛、CI 或实际合并。

## 复现

使用当前 worker-tla 的 `run_tlc.py`，并核对其 SHA256 为 `ca5811a8cae5d31961185b0ba53868f3ea885a1ee614150d873d61044ff18f5a`。官方 v1.7.4 / TLC 2.19 jar 的 SHA256 为 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`。本次使用 OpenJDK 21.0.13；每个配置 BFS、1 worker、512 MiB heap、60 秒预算。

```sh
python3 /absolute/path/to/worker-tla/scripts/run_tlc.py \
  --manifest formal/adv001/direction-progress-admission/verification-wave.json \
  --profile try-two-record-failure \
  --jar /absolute/path/to/tla2tools-v1.7.4.jar \
  --out .agent-output/progress-admission/reproduction-wave \
  --java /usr/bin/java
```

Sticky 使用 verification-sticky.json 和对应 profile。输出必须为新目录。没有 CONSTRAINT、VIEW、对称过滤或随机抽样；各 profile 的最小状态数在运行前声明。安全配置关闭死锁检查，因为有限输入用尽或外部停滞允许发生；只有明示 FairSpec 的配置检查条件性时序性质。符合预期的负控、见证与环境边界均保留 runner 退出码 2；不变量反例的原 TLC 退出码为 12，两个时间性质反例为 13。须核对实际命中性质、完整轨迹和输入身份。
