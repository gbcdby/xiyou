# D66-PLA r3：共享读准入与条件性进度修订

本修订于 2026-11-19 经独立审查并在 [#66](https://github.com/gbcdby/xiyou/issues/66#issuecomment-6997932340) 采纳。r2 设计 SHA256 为 `ddfa4e844d9cecde1dbde10d46ec52a7e03f693eb5f9bb371f354fa4756d767b`；r3 为 `8ea1ea52b11f6b3d93be2804682273f985af17b72abde9786684ec91619c493c`。

## 撤回的假设

原准备材料中的 writer-priority 选项，以及最初 PLA-06 对“UPDATE 已排队就阻止所有后来兼容 SHARE”的断言，均不作为有效依据。实际首轮生命周期用例为 5 项通过、1 项失败；该失败原件保持，不改写成通过。

真实有限 PG 探针中，A 持 SHARE，B 的 UPDATE 等待；C 后到的 SHARE 仍取得锁。A 释放后 B 继续等待 C；D 后到的 SHARE 也取得锁；C、D 全部释放后 B 才获排他锁。探针结果 SHA256 为 `3f0c5cbf2fed741096a344cc3dc705a00f1b4f28cc25bada20e325435e705524`。这是 PostgreSQL 18.6 的本次有限实际观察，不是无限负载试验。探针脚本的事后摘要不冒充运行前后绑定。

修订后的 PLA-06 保留 try 忙时真实回滚、wait 真实等待，再释放有限持锁者，等待 G 确实取得排他锁后启动新 SHARE，观察它真实等待，最后 COMMIT 使其继续。该单项实际通过；其余五项函数逐字未变并限范围复用原通过证据，没有声称新文件重新跑过 6/6。

## 模型改变

Sticky 的 AcquireReader 不再读取 queuedWait；只有实际 writer 持排他锁才禁止 SHARE。fair-finite 用 readerEntered 限定两个 reader 各最多进入一次，其他 writer 最多一次。busy/error 的实际恢复读取 runMode/runLegacy，claimedWait/claimedLegacy 仅为规范见证。没有新增产品状态、计时器、owner 或公平队列。

有限冲突集合最终释放且资格稳定，再配合明确弱公平，支持条件性进度。每个事务有限并不意味着冲突集合有限；持续到来的兼容共享读可以延长等待。try 和 wait 均没有无条件最终成功保证。

## 实际循环与静态构造的区别

实际 overlap-wait 反例的循环为 state 13 → RequestWait → ReleaseReader(1) → AcquireReader(1) → RequestWait → state 13。其中 reader 集合曾为空；Grant 只间歇启用，仍可在弱公平下始终未被选择。all-try 的实际循环也包含 reader 1 释放与重入的间隙，并保留实际清理后再次 try。两条 TLC 原件真实违反 EventuallyPublished，但不称作两 reader 无缝交替的打印轨迹。

独立审查还逐动作核对了以下静态无缝构造，明确为 `NOT_TLC_EMITTED`：从 wait 实迹 state 13（readers={1}、readerEntered={1,2}、queuedWait=TRUE）起，循环 AcquireReader(2)、ReleaseReader(1)、AcquireReader(1)、ReleaseReader(2)、RequestWait、RequestWait，回到同一状态。全程读集合非空，两 reader 每圈均释放，Grant 一直不启用，符合所声明弱公平。all-try 可在原循环释放 reader 1 前加入 reader 2，在重新加入 reader 1 后释放 reader 2，保留其余清理与重试动作。

这些边界不会改成强公平假设，也不会改原 36 单位、180 速度、100ms 输入、400ms unknown、50ms checkpoint、200ms 维护及真实 hold/paint 的产品门槛。
