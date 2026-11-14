# 首章出口恢复的有限前端握手模型

归属：#34 / R-34-NAV-RECOVERY-001，关联首章 #23/#29、客户端 #33。这里只验证首段 Receipt、已授权投影和实际显示确认汇合之后，第二段何时能够且只能发出一次。模型不证明服务端数据库、真实几何或第二段跨场景事务；产品与真实双客户端证据另列于 `MODEL_SOURCE_MAP.md`。

## 本轮结果

原对抗 `positive-safety` 已完整检查，**PASS_WITHIN_SCOPE**：

| 项目 | 实际记录 |
| --- | --- |
| 时间 | 2026-11-13T12:33:55Z 至 12:55:03Z，1268.49 秒 |
| 状态 | 707,132,452 generated；88,362,572 distinct；remaining 0 |
| 原始退出 | TLC 0、runner 0、completed=true；无 error/warning |
| 检查 | TypeOK、NoPrematureCrossing、AtMostOneContinuation、NoCancelledRevival、ReceiptBound；死锁检查开启 |
| 原语义 | Fault=none、Adversarial=TRUE、MaxQueues=2、OldSeq=0、ForceUnknown=FALSE；BFS |
| 资源 | 4 workers、2048MB heap 上限、1800 秒预算、每分钟原生 checkpoint |

`model/` 的 11 个文件与旧模型和本轮实际输入逐字相同。旧 120 秒及本轮 600 秒的退出 143 / INCONCLUSIVE 仍保留，未改写为通过。本轮没有前轮可用检查点，因此从头重算，不能称为 resume。

正式的[结果摘要](verification-results.json)保留 14 次原始运行的状态、原始退出码、实际检查集合、参数、时间、规模、输入身份及结果/日志/消息摘要，并列出最终 12 个 profile 采用哪次运行。[输入清单](input-manifest.json)列出正模型与两个隔离负对照的全部实际输入摘要。它们是从固定原始记录整理的版本化说明，不是重新运行的结果。

按项目运行日志不入仓的约定，完整原始结果、TLC 日志、消息、重复输入快照和运行器的临时绝对路径**未随仓库提交**。原始记录单独保留；本目录不依赖私人下载链接或临时文件路径来运行。完整原始包为 303 个文本文件、949,509 bytes，其排序文件清单的摘要为 `d96f27eee2884b1a687558cfe2a50141520ba16923fe37f182123844f137c091`，与正式结果摘要中的内容哈希可互相核对。

搜索状态峰值约 3.74GB，记录中最少剩余磁盘约 30.0GB；没有取得 JVM 实际 RSS，不把 heap 配置当成实测内存。数 GB 的状态与检查点未入仓。

## 复现

需要 Python 3、Java（本轮 OpenJDK 21.0.13）及清单固定的 TLC jar：

```text
TLC 2.19 / v1.7.4
SHA256 936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88
```

从仓库根目录运行，`--jar` 指向实际已取得且摘要相符的 jar。输出路径必须不存在：

```sh
python formal/adv001/navigation-recovery/check.py \
  --jar /absolute/path/to/tla2tools.jar \
  --out .agent-output/navigation-recovery/reproduction
```

默认明确执行原十个 profile 和两个独立负对照。正配置须 completed=true、原始退出 0、队列清空且实际检查集合完全一致；负对照须原始退出 12/13 并命中预声明性质。预期反例的原始状态仍是 COUNTEREXAMPLE，不被改写为 TLC PASS。

只复现最昂贵的原安全配置：

```sh
python formal/adv001/navigation-recovery/check.py \
  --jar /absolute/path/to/tla2tools.jar \
  --profile positive-safety \
  --out .agent-output/navigation-recovery/safety
```

只检查新增负对照入口：

```sh
python formal/adv001/navigation-recovery/check.py \
  --jar /absolute/path/to/tla2tools.jar \
  --profile negative-receipt --profile negative-type \
  --out .agent-output/navigation-recovery/sensitivity
```

预算来自本轮真实成本，1800 秒在其他硬件上仍可能不足。超时必须保留 INCONCLUSIVE、已探索数量和剩余队列；不得改小 MaxQueues、删属性或用 positive-live 代替原安全配置。

## 运行器变化与 CI 边界

`tools/run_tlc_checkpoint.py` 是原固定 runner 的副本，只在 Java argv 增加原生 `-checkpoint 1`。精确差异和摘要见 `tools/checkpoint-only.diff`、`tools/adaptation.json`；本轮成功运行器摘要为 `7105e24bbc724b565f16deb265defcf9dfa54821b085d4b640efa4e8857078eb`。

原 `check.py` 的预声明结果核对保持；小幅扩展仅将运行器指向此副本，并把两个独立负对照的清单显式加入默认目录。差异见 `tools/check-wrapper.diff`。`verification.json` 仅将原 positive-safety 的资源由 120s/1worker/512MB 调整为 1800s/4workers/2048MB，其余模型语义和检查不变。

**现有 `.github/workflows/ci.yml` 不调用 TLC，此项是独立必需验收。** 现有 job 总预算 20 分钟；不能把本机约 21 分钟的检查直接塞入该 job 并宣称可完成。本包不修改 CI、不删除任何门槛。新增导航客户端测试仍由原前端 `tests/*.test.mjs` 收集；专门的导航浏览器实验另有固定对象证据。

## 性质与敏感性

| 性质 | 预声明的错误/反例对照 |
| --- | --- |
| TypeOK | `negative-type` 把高水位写成负数；实际原始 12、目标违反 |
| ReceiptBound | `negative-receipt` 在公开投影时未经原 Receipt 先绑定计划；实际原始 12、目标违反 |
| NoPrematureCrossing | `old-same-seq` 错把同号历史显示当作新计划到达；实际原始 12 |
| AtMostOneContinuation | `negative-double` 发出后错误保留队列；实际原始 12 |
| NoCancelledRevival | `negative-revive` 错误复活已取消队列；实际原始 12 |
| ContinuationProgress | 单个稳定合法计划的 `positive-live` 完成 33,660 distinct；错误旧序号、过早丢队列/旧 map key 等按预期出现原始 13 活性反例 |

`witness-early-unknown` 是刻意寻找早到显示/Unknown 顺序的见证，不是正安全配置失败。两个新增 mutant 位于 `negative-controls/*/model`，与正模型 root 分离；各自保存精确 mutation 与配置，原始结果身份及实际性质保存在正式结果摘要中，不改变正模型状态空间。

## 产品对应与保留边界

产品修复来自 `a93b865`，`8be043` 只改浏览器前置实绘等待与失败取证。独立运行组合为 `c3d885`；后续 `287be775` 只补入最新 HUD helper 与该浏览器脚本，产品字节相同。已合 HUD 提交 `fe9ddd` 与本地 `372698`、公开 `febb2dc` 完整 tree 等价。精确 SHA/tree、源码对应与保留边界见[模型与源码映射](MODEL_SOURCE_MAP.md)；当前交付状态以 [#34](https://github.com/gbcdby/xiyou/issues/34) 及关联 PR 为准。

模型假定投影按序应用、原 Receipt 真实不可变、同控制周期输入序号唯一；视觉事件必须来自该计划实际显示站定。真实动画、权限、任意多个连续点击、跨进程持久队列和真正跨场景提交不在模型内。形式化成功不是源码 refinement 证明，也不是整个首章、真实模型或真人体验验收。
