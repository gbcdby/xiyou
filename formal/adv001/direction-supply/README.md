# 方向受理与同连接供给的有限模型

本包对应 [#66 方向受理合同](https://github.com/gbcdby/xiyou/issues/66#issuecomment-6894942789) 与 [同连接供给协调合同](https://github.com/gbcdby/xiyou/issues/66#issuecomment-6896744788)。覆盖有限输入下的权威顺序、原 Receipt、跨绑定未决账本、可信发送前缀及接收应用顺序。业务源码映射基准为公开提交 [`8593d928115a946bedbae9c662f28c6a90db7796`](https://github.com/gbcdby/xiyou/commit/8593d928115a946bedbae9c662f28c6a90db7796)，对应文件与 Git blob 如下。

| 映射文件 | Git blob |
| --- | --- |
| `backend/spatial-runtime.mjs` | `bf9e39827e3709912e56307a4ddf99773a0aba71` |
| `game/spatial-rules.mjs` | `e8cc34985d80c1f86bffb7b2e9d5c5d7b3bff19f` |
| `game/spatial-direction.mjs` | `a1743f36d461e92f7b85e386114a276e3d9c3dbe` |
| `frontend/src/network/spatial-session.ts` | `18b96cdfbef1762c07935d6ef72f7da1709611fe` |
| `backend/spatial-supply.mjs` | `751e93a4abded7e904ed468675e26a2cea7bc9d3` |
| `backend/runtime.mjs` | `2a3d9904268b250827162214f23c3537cfc5377d` |
| `backend/socket-enqueue.mjs` | `521092a9746a42e651acbb3ad3bf7ebc9414739e` |
| `frontend/src/network/socket-link.ts` | `3584f81505525c6a17c8d6261ea2d37740b44f95` |
| `frontend/src/domain/spatial-view.ts` | `3647f4eace9e9cfb2ecf7411020152ba931b3914` |
| `frontend/src/domain/spatial-snapshot-source.ts` | `743c074d89c47b42c97686e7d8f52b1de4ed21c5` |

这些业务文件与本次模型对应核验时的源码逐 blob 相同。该公开映射不改变实际 TLC 输入，也不表示 TLC 自动评估了源码实现。

本轮实际 SANY 解析成功。7 个正配置完整遍历并清空队列；26 个负控与 26 个可达见证均以原始 TLC `rc=12` 命中预声明的具体不变量。见证和负控仍记为 `COUNTEREXAMPLE`，没有改写成 TLC PASS。逐项实际范围、时间、状态数、深度、输入摘要与目标性质见 [results.json](results.json)。

## 实际检查规模

所有检查均使用 BFS、1 worker、768 MiB heap、固定 TLC 2.19（v1.7.4）与 OpenJDK 21.0.13。下表各正配置的预声明 distinct 下限均已达到；权威 order/epoch 下限 100、budget 下限 20，供给各配置下限 100。负控和见证下限为 2。

| 组 / 配置 | 有限范围 | distinct | 完整图深度 | 秒 | 死锁检查 |
| --- | --- | ---: | ---: | ---: | --- |
| authority / positive-order | 2 条命令、固定 epoch、一次同连接 binding 变化、原 Receipt/Unknown/重试/迟 ACK | 728,492 | 19 | 41.48 | 是 |
| authority / positive-epoch | 1 条命令、一次 epoch 变化、首次处理与原 Receipt 重放 | 4,446 | 12 | 2.01 | 是 |
| authority / positive-budget | 3 条未决请求、跨 binding 两方向加一 stop；不安排服务端响应 | 6,887 | 14 | 2.26 | 否 |
| supply / positive-order | 稳定 link/view，2 次读、2 个前缀增量 | 6,301 | 16 | 2.22 | 否 |
| supply / positive-view | 同 link 换 view，2 次读、1 个前缀增量 | 31,800 | 18 | 3.37 | 否 |
| supply / positive-reconnect | 一次 link 替换，2 次读、2 个增量；新旧 link 独立 lane 与到达 | 439,220 | 22 | 20.72 | 否 |
| supply / positive-lane | 稳定 link/view，3 次读、零内容增量；满槽与通知合并 | 2,973 | 17 | 1.79 | 否 |

关闭死锁的配置允许有限输入用尽或网络永久不响应，不给最终恢复保证；准确理由在对应 manifest。**全部配置均未检查 liveness，没有添加公平性假设。** E/SE/S/stop 和 0..2 坐标是方向性质所需的有限代表，不是完整寻路或物理模型。

完整笛卡尔积的 `positive-authority` / `positive-supply` 探索配置不计入上述交付门槛，当前完整模型配置状态为 `NOT_RUN`。七个有限正配置分别通过，不推出该完整组合、任意规模或源码 refinement 结论。

## 性质与可证伪性

| 组 / 不变量 | 针对性错误变体 | 非空触发见证 |
| --- | --- | --- |
| authority / TypeOK | negative-type | witness-issue |
| CommandWatermark | negative-domain-water | witness-domain-water、witness-replay-refusal |
| AppliedOrder | negative-late | witness-late |
| ReceiptStable | negative-replay、negative-rebase | witness-replay、witness-moved-replay |
| StopFence | negative-stop | witness-stop |
| EpochFence | negative-epoch | witness-epoch |
| RejectedRoutePreserved | negative-refusal | witness-refusal |
| OutstandingBudget | negative-binding-budget、negative-stop-budget | witness-budget |
| DirectionOriginCurrent | negative-origin | witness-origin |
| OriginalRequestIdentity | negative-identity | witness-replay、witness-old-ack-new-binding |
| ReplayPreservesCurrent | negative-replay-route | witness-replay-newer、witness-replay-refusal、witness-replay-new-binding、witness-replay-new-moving-route |
| supply / TypeOK | negative-type | witness-baseline |
| ReadCapacity | negative-parallel、negative-waiting、negative-publisher | witness-capacity、witness-old-view-waiting、witness-two-links-active |
| InstalledSeparate | negative-installed | witness-separation |
| SentPrefix | negative-fake-enqueue、negative-cursor、negative-old-install | witness-prefix、witness-old-install、witness-send-failure |
| NoStaleAdvance | negative-stale、negative-old-snapshot | witness-stale-reject、witness-late-old-link |
| OrderedApplication | negative-callback | witness-ack-push |
| ExactlyOnce | negative-duplicate、negative-omission | witness-ack-push、witness-late-old-link |

原 Receipt 联合见证真正执行第二次 `Handle`：较新 Accepted 或领域 Rejected 已建立水位，新 binding 的较新方向计划仍 active 时，旧 Receipt 重放保留当前 goal、lastApplied、highWater 与原身份。查询 Receipt 不算此见证。供给见证真正接收旧 link 回调，且该时刻新 link 已应用新内容；模型只要求每条 link 内 FIFO，未把新旧 Socket 错合成一条 FIFO。

详尽的边界、原子性和模块对应分别见 [AUTHORITY_MAP.md](AUTHORITY_MAP.md) 与 [SUPPLY_MAP.md](SUPPLY_MAP.md)。`results.json` 保持 TLC 的实现状态为未评估；源码对应是另行的限定只读核验，不是模型运行器自动证明。

## 复现

使用仓库已有固定 runner，不下载或执行额外运行器。jar 必须为以下内容：

```text
v1.7.4 / TLC 2.19
SHA256 936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88
runner SHA256 ca5811a8cae5d31961185b0ba53868f3ea885a1ee614150d873d61044ff18f5a
```

从仓库根运行，jar 使用实际绝对路径，输出目录必须不存在：

```sh
python3 formal/adv001/direction-supply/check.py \
  --jar /absolute/path/to/tla2tools.jar \
  --out .agent-output/direction-formal/reproduction
```

默认只运行本轮 59 个预声明交付配置，不运行旧 M29、其他正式模型或完整探索配置。只复现某个范围可加 `--group supply --profile positive-reconnect`；多项 `--profile` 可重复传入。每次输出保留原 runner 日志、快照、状态与预期核对，不覆盖旧输出。SANY 可单独执行 `java -cp /absolute/path/to/tla2tools.jar tla2sany.SANY formal/adv001/direction-supply/authority/DirectionAuthority.tla formal/adv001/direction-supply/supply/SpatialSupply.tla`。

## 未覆盖边界

本包不证明真实 PostgreSQL 隔离、多实例/Crash、任意网络交付、精确 400ms、八页循环活性、任意数量命令、实际几何和寻路、模型之间的完整组合。真实 Socket 的入队证据来自代码及其独立回归；模型不把 `emit` 返回值或空 ACK 当作证据。

本包也不检查 Canvas、像素、动画、呈现信用或 150–450ms 体验门槛；不会改变既有实际体验结果。功能启用、远端 CI、实际合并及部署须使用各自的真实证据。
