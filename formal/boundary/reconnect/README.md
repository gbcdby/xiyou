# 授权投影、过滤区间与重连模型

归属：[Ticket #7](https://github.com/gbcdby/xiyou/issues/7)，产物 `reconnect-model`。固定设计为 `6c2a0b9f6d137ad5fbd41721659404333ad8e16d` 的 M0 §3/9、INV-00/08/09/10 与 LIVE-02。模型为设计约束，真实客户端、服务端和数据库未评估。

## 抽象与覆盖

模型保留两个 Session、两种视图、两代视图身份、每局四个事件的可见/隐藏交错。1/3 为公开效果，2 仅 A 可见，4 仅 B 可见。效果 3 表示可见字段移除；授权效果的有序前缀同时保留当前视图变更及知识来源，避免只校验一个最终数字而漏掉中间错误。真实 reducer 必须据同一效果序列实现相同投影，由 #8 提供代码证据。

本局事件逐条提交。快照先捕获已提交 head，再异步交付；其间允许继续提交，因此快照落后与后续补发都有可达路径。视图换绑、撤权/恢复及 RESYNC_REQUIRED 会清空旧投影、游标和待用快照。Finished/Aborted 停止新提交，但仍可投递旧日志和授权快照。

传输采用**任意已提交完整区间到达**的抽象：每一步可选择任一 Session、视图/代次与合法区间，包含两个区间任意顺序、旧包重放、重叠和缺前缀。忽略一次发送/不选某区间即代表丢失；另有明确 Drop 见证。它没有固定网络队列长度，也不假设消息恰好一次。未提交、被篡改或不存在的服务器事件不在传输域内，属于认证/持久化接口义务。

## 性质与敏感性

| 性质 | 负对照 |
| --- | --- |
| TypeOK | 合法状态后写域外 cursor |
| ProjectionMatchesCursor / INV-09 | 保存末游标但遗漏最后可见效果；允许未来/重叠区间猜测应用 |
| NoUnauthorizedObservation / INV-10 | 分别撤掉流过滤、快照过滤、Session、viewId、视图代次和当前授权检查 |
| TerminalBlocksNewEffects / INV-08 | 终态后继续分配新事件 |
| ConnectedProjectionCatchesUp / LIVE-02 | 禁用补发；让隐藏序号阻止游标进展（时序反例，不算安全反例） |

快照/投影一致性按同一 cursor 比较，不要求不同角色拥有相同私有视图。全局计数与节奏是协议明确公开的元数据，不在保密保证内。

## 执行与证据

普通 BFS、1 worker、1 GiB、每项 120 秒预算，死锁检查开启，无状态/动作裁剪或对称归约。正配置在运行前固定 distinct 下限为 100。活性另外启用提交、快照捕获/交付、恢复、补发及终止的弱公平性；只覆盖有限日志与有限身份故障，永久离线不承诺追平。

实际统计和完整原始结果见 [结果索引](results.json)；活性、缺陷配置和可达探针分别标记。所有正式启用不变量都有原始 rc=12 目标反例；LIVE-02 负对照使用原始 liveness violation。正式结果目录保留 runner 原始输出，不改写 argv 或时间。

```sh
python3 .agents/skills/worker-tla/scripts/run_tlc.py --manifest formal/boundary/reconnect/verification.json --profile positive --jar /absolute/path/tla2tools.jar --out .agent-output/reconnect-new-run
```

工具固定 v1.7.4 / TLC 2.19、SHA-256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`。其余 profile 在同一清单；每次使用不存在的输出目录。

## #8 的实施义务

| 义务 | 真实实现需取证 |
| --- | --- |
| 事件发生时的受众可重建 | 不按当前区域回看历史；授权传播产生新事件 |
| 服务端过滤 snapshot 与 world.batch | 客户端不得收到完整世界再在 UI 隐藏；DTO 不带内部受众、凭据和秘密占位 |
| 完整区间与游标原子应用 | fromExclusive 等于 cursor 才应用；events 为空仍推进；同批全部效果与 throughSeq 一起保存 |
| 丢包/乱序/重叠/重复 | 整批重复忽略，未来/重叠重新从当前 cursor 请求，不能猜补 |
| 快照原子捕获 | 数据和 snapshotSeq 同源；并发新提交通过补发追上，不能覆盖成不一致前缀 |
| 身份与视图代次绑定 | 接收前核实 Session、viewId、版本和当前权限；换绑/撤权即停旧订阅并清旧待用数据 |
| 终态可读不可写 | 终局后重放旧事件不创造新的 WorldEvent；最终授权投影仍可恢复 |

缺陷轨迹可转写为上述场景的客户端/服务端集成测试。本模型没有执行真实网络、持久存储、身份提供方、渲染或真人验收；独立需求/标准审查由总控安排，完成前不自动释放依赖。
