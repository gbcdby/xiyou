# Session 隔离、重连与 NPC 信息边界

归属 [Ticket #7](https://github.com/gbcdby/xiyou/issues/7)，固定 Spec 修订 `6c2a0b9f6d137ad5fbd41721659404333ad8e16d`。三个产物分别交付，独立审查与后续运行证据不由模型通过替代。

| 产物 | 入口与实际有限检查 | 下游边界 |
| --- | --- | --- |
| `session-isolation-model` | [隔离模型](isolation/README.md)：正向 57 distinct states、队列0；INV-13/TypeOK 负对照和合法／拒绝见证 | #6 的可信 Session 与对象定位；不包含真实数据库验证 |
| `reconnect-model` | [重连模型](reconnect/README.md)：正向与 LIVE-02 各 20,278 distinct states、队列0；4个安全性质的逐项缺陷、2个活性缺陷和恢复见证 | #8 的授权投影、完整区间、恢复与终态读取 |
| `visibility-model` | [信息边界模型](visibility/README.md)：安全与 LIVE-03 各 2,591,386 distinct states、队列0；上下文/观察/传播、原子意图、围栏和非真空证据 | #9 的感知、持久记忆、合法传播、模型意图提交 |

另有独立[死锁敏感性](deadlock/README.md)，其 raw rc=11 不冒充安全性质 rc=12。全部模型采用固定 v1.7.4 / TLC 2.19、普通 BFS、1 worker、死锁检查开启；各配置保存自己的规模、下限、预算与公平性。核心所有权和完整真人控制链由 #5 承担，不能据本目录单独宣称其已完成。

最终证据机械审计核对 57 个 profile 的当前模型/CFG、工具/runner 摘要、原始结果、目标违反、完整探索和预声明下限，结果见 [evidence-audit.json](evidence-audit.json)。复现审计入口为：

```sh
python3 formal/boundary/audit_evidence.py
```

它只核对证据一致性，不代替需求与语义独立审查。模型实现状态均为 `NOT_ASSESSED`，独立审查尚未运行；产物释放由总控绑定审查后的固定提交决定。隔离和重连无需等待整个 #7 关闭才可独立释放。

可见性活性曾有 180 秒超时与两次无最终报告的中断记录，原始结果保留在该目录的历史尝试索引。最终仅增加预算为1200秒，同一模型、性质和公平性约384秒完成；历史中途状态数没有被算作通过。
