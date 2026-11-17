# #66 供给调度窄增量：旧进度与有限新波次

冻结 r1 + r1a 的有限模型检查为 **PASS_WITHIN_SCOPE**：11 个正向配置全部完成，32 个故意缺陷配置均命中预声明性质，21 个到达见证均实际找到。每个正向启用的 22 项性质都有目标负控。源码对应为 **NOT_ASSESSED**；新协调器尚未实现，本包不改变性能、浏览器或采纳状态。

| 入口 | 内容 |
| --- | --- |
| [CONTRACT.md](CONTRACT.md) | 相对旧全局 settled 规则的显式 delta、状态、性质、假设及范围 |
| [REPORT.md](REPORT.md) | 每条性质和配置的实际状态、distinct 数、关键反例/见证顺序、工具身份 |
| [HANDOFF.md](HANDOFF.md) | 拟议源码映射、真实 PG/Socket 待实现回归场景、返回建模条件 |
| [inputs.json](inputs.json) / [project-profile.json](project-profile.json) | 冻结提案与基线源码内容身份；设计与现实现事实分开 |
| [results.json](results.json) | 64 条正式原始记录的身份、实际 argv、预期与统计索引 |
| [r1a-records.tar.gz](evidence/r1a-records.tar.gz) | 原始 result/manifest/log/messages、模型/cfg 输入快照与固定 runner |
| [exploration-records.tar.gz](evidence/exploration-records.tar.gz) | 早期语法错误和被修正模型的探索原件；不纳入最终 PASS |
| [design-inputs-r1a.tar.gz](evidence/design-inputs-r1a.tar.gz) | 三份 r1 与总控 r1a 的原字节 |

## 复核与重做

从仓库根只读核对归档，不跑 TLC：

```sh
python formal/adv001/direction-supply-wave/audit.py
```

需要新跑时使用原固定 runner，工具 jar 必须为官方 v1.7.4/TLC 2.19，SHA256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`。每次选用新的输出目录。下面 `/absolute/path/to/tla2tools.jar` 需替换为已核验的本地路径，输出路径也需尚不存在：

```sh
python formal/adv001/direction-supply-wave/check.py \
  --profile positive-one-row-budget \
  --jar /absolute/path/to/tla2tools.jar \
  --out .agent-output/supply-wave-recheck/positive

python formal/adv001/direction-supply-wave/check.py --supplement \
  --profile witness-single-row-full-cycle \
  --jar /absolute/path/to/tla2tools.jar \
  --out .agent-output/supply-wave-recheck/witness
```

不加 `--profile` 会运行该 manifest 的全部配置；核心 60 条与补充 4 条分别调用。wrapper 对目标 `rc=12` 核对具体 invariant 名称、状态数下限与原始分类，原 `COUNTEREXAMPLE` 不会被改成 PASS。正向 BFS 单 worker、768 MiB、180 秒，死锁与活性均未检查。

旧 [direction-supply-parallel](../direction-supply-parallel/README.md) 及 [direction-supply](../direction-supply/README.md) 保持只读。这里的两 peer/预算 1 或 2 不是实际五任务上限的证明；有限模型也没有 PostgreSQL、实时延迟或浏览器实现证明。
