# R-34-NAV-RECOVERY-001 模型与源码映射

归属：[首章 NPC 与恢复工作单 #34](https://github.com/gbcdby/xiyou/issues/34)，关联首章 #23/#29 与客户端 #33。模型结果、产品运行、独立审查、公开 PR 和合并分别记录；本文件不声明整章或真实 AI/真人体验通过。

## 固定对象

| 对象 | 固定身份 |
| --- | --- |
| 产品导航修复 | `a93b865bce412154990d9caf60dd10a0099056f6` |
| 浏览器前置实绘等待及失败取证 | `8be04302310e59441b5fa087236a9ae53fcb05b0`，相对产品修复不改业务源码 |
| 本轮独立出口运行组合 | `c3d8853764b76569802df2433346bceb5bc3d298` / tree `767dcb52b58d59c5bbafde5e02cbbce55efc3362` |
| 后续默认 v2 GUI 组合 | `287be775ec4475a5435f113611dacad73e7ad9a6` / tree `11d1bc0b3885e6b57e0da525a27a20e5f56eb412` |
| 已合 HUD 提交 | `fe9ddd17e26d2ea0b348e0729a360f6552a90954` / tree `8241e99fdabb7b22f9fabead81a4be7faf5d3a2a` |

`c3d885` 中的导航客户端与产品修复相同，地图在 HUD 组合上保留三个 movementId 改动。`287be775` 相对 `c3d885` 只变更两个测试辅助文件，业务源字节相同：

| 文件 | 来源 | 实际 SHA256 |
| --- | --- | --- |
| `frontend/tests/gaolao-real-support.mjs` | HUD 候选 `37269822279eaa9046683df9bedc466a97527ab2` | `ff0559e29f895cdfd45a3a339c838fc56b22cf1140bb4249da9fe3ac0d0836e3` |
| `frontend/tests/navigation-recovery-browser.mjs` | 导航候选 `8be04302310e59441b5fa087236a9ae53fcb05b0` | `2cd50b67975143d9d5243682079cdab2067164b5a8157d2b4d0c035c72d42d7c` |

HUD 本地 `37269822279eaa9046683df9bedc466a97527ab2`、公开 `febb2dc220781f1d6c93e78f41fc0bba14004d0f` 和已合 `fe9ddd` 的完整 tree 相同。当前正式集成只在 `287be775` 上增加文档与本模型源集；后续公开提交与实际 CI 身份记录于关联 PR，不在此维护动态进度。

## 模型与产品的静态对应

| 模型位置 | 产品位置与含义 | 限制 |
| --- | --- | --- |
| `s.high` / `v.high` | 服务端按控制周期持久记录的 `movementCommandHighWater` / 已授权当前投影 | 继承服务端事务与投影按序应用，不重复建模数据库 |
| `s.active`、`v.active`、`c.bound` | 原首段 movementId、投影当前 movement、由原确定 Receipt 绑定的排队计划 | 0 代表旧控制周期历史；1/2 代表至多两个点击计划 |
| `Receipt(i)` | `SpatialSessionClient.#receipt` 先核原 session/action identity，再按 view/epoch/sequence 绑定 movementId | 原 Receipt 真实不可变、同 epoch 输入序号唯一是假设，不是服务端安全性证明 |
| `Snapshot` | `SpatialView.applyBatch` 的 view/generation/区间围栏，然后 `#drainQueued` | 源码额外逐事件检查引用与控制周期；模型以有序投影为前提 |
| `Draw`、`Visual(i)` | `SpatialMap.draw` 用 view/epoch/movementId/sequence 去重；`confirmDisplayedArrival` 再比当前计划及真实脚点 | 动画插值、浮点几何和浏览器调度不在模型中，相关例子由真实 Vue/双客户端检查覆盖 |
| `CancelNeeded`、`DrainCancel`、`CancelLocal`、`Replace` | 当前高水位、失效授权/地图/目标/终态、主动 stop/换目标/取消撤销后续 | 多类失效聚合为已观察的 valid 围栏，不覆盖尚未送达的服务器信息 |
| `DrainSend` | `#drainQueued` 先清队列，再发送预留 command2 | 只验证发出第二段，不证明实际跨场景事务 |

这些是有范围的静态对应，不是 refinement 证明，也不把 TLC 成功解释成源码证明。

## 实际模型检查与敏感性

[正式结果摘要](verification-results.json)保留 14 次原始运行与最终 12 项选取关系；[输入清单](input-manifest.json)保留实际模型身份。正模型 11 个文件与历史检查、本轮 600 秒及 1800 秒检查的输入逐字相同。

| 运行 | 实际状态 | 原始退出与规模 |
| --- | --- | --- |
| 历史 positive-safety，120 秒 | INCONCLUSIVE / TIMEOUT | TLC 143，未完成 |
| 本轮 positive-safety，600 秒 | INCONCLUSIVE / TIMEOUT | TLC 143，未完成 |
| 本轮 positive-safety，1800 秒预算 | PASS_WITHIN_SCOPE / COMPLETE_MODEL_CHECK | TLC 0，707,132,452 generated、88,362,572 distinct、remaining 0 |
| 历史 positive-live | 单稳定合法计划活性范围 PASS_WITHIN_SCOPE | TLC 0，33,660 distinct、remaining 0 |
| 两个新增隔离负对照 | 预期 COUNTEREXAMPLE | ReceiptBound 与 TypeOK 分别命中，TLC 均 12 |

完整正安全运行发生于 2026-11-13T12:33:55Z 至 12:55:03.740744Z，耗时 1268.487574 秒。它保持 Fault=none、Adversarial=TRUE、MaxQueues=2、OldSeq=0、ForceUnknown=FALSE、五项原 invariant、BFS 与死锁检查；无 error/warning。资源为 1800 秒预算、4 workers、2048MB heap 上限。此前没有可用检查点，所以本轮从头重算；原 runner 仅增加原生每分钟 `-checkpoint 1`，精确差异见 `tools/checkpoint-only.diff` 与 `tools/adaptation.json`。

TypeOK 负对照只将首段接受后的高水位写成负数；ReceiptBound 负对照只在公开投影时未经原 Receipt 先绑定计划。二者模型 root 独立，实际一处突变及摘要位于 `negative-controls/*/mutation.json`。预期反例证明对应检查对这类已知错误敏感，不能代替正配置穷举。其它历史负对照及早到显示/Unknown 见证仍保留原始状态和预声明性质。

原始日志、消息、运行器输出及输入快照按项目约定单独保存，未随仓库提交。本摘要没有把旧超时或反例改写为 PASS，也没有把某次运行日志中的临时路径作为正式依赖。

## 产品运行与独立审查范围

执行者 `/root/exit_recovery` 不是原产品作者；受并发角色容量限制，由同一独立执行者分别完成需求与标准两轴。NAV-01 至 NAV-06 需求轴及约定修复标准轴通过，依据包括：

- 33 项定向客户端检查、类型检查、3 组独立 public DTO 回放，以及真实 Vue 中同序号不同 movementId 的实际显示事件。
- 真实 PG、HTTP、Socket、Vue、双账号/双浏览器 context 的正常与首段提交前延迟 700ms 两个出口样本；原 Receipt 后 15 秒判据保留，第二段各恰好一份请求，最终进入庄外场景，pageErrors 为空，源前后 clean、资源关闭。
- 原 Receipt 绑定、取消/替换、当前高水位与旧显示回调围栏的源码/消费者核对；上述同语义模型完成结果和敏感性检查。

这些样本使用明确受控的 v1 合法救援 fixture，不冒充默认 v2 的完整玩法链。最早 UI-EXIT-15S-UNATTRIBUTED 缺完整原触发顺序，新受控反例不能倒写成原事故已被直接归因。默认 v2 GUI、真实模型、真人体验与必要真机验收另按 #29 记录。

## 复现与 CI

复现命令见 [README](README.md)。`check.py` 默认执行原十个 profile 和两个隔离负对照，检查实际配置集合、原始退出码、预期目标；正配置另要求 completed=true、非空状态与剩余队列 0。正式摘要不参与运行判定。

现有 `.github/workflows/ci.yml` 不调用 TLC，job 总预算仍为 20 分钟。新增导航客户端测试由原 `tests/*.test.mjs` 收集；专门浏览器实验与本模型分别验收。本包没有修改 CI 或门槛，本机约 21 分钟的模型耗时也不能承诺其他硬件仍在该时间完成。
