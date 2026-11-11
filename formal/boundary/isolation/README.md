# Session 写入隔离模型

归属：[Ticket #7](https://github.com/gbcdby/xiyou/issues/7)，产物 `session-isolation-model`。依据固定 Spec `6c2a0b9f6d137ad5fbd41721659404333ad8e16d` 的 M0 §6/7/9 与 VER-01 / INV-13。模式为 `design`；无业务源码，源码对应与真实数据库运行均未评估。

## 模型范围与实际结果

两局 `S1/S2` 各有同名 `item`，两个可信主体分别绑定本局；四个请求为各局合法写入与向另一局同名对象发起的越权写入。接收与提交分开，记录实际写入的授权范围和目标范围。正模型在提交前同时检查可信范围与目标范围；失败不修改任一局版本。

普通 BFS、1 worker、512 MiB、60 秒预算；死锁检查开启，活性不在本独立 profile 内。预声明 distinct 下限为 20；正模型完整探索 **57** 个 distinct states、队列为 0。TypeOK 与 SessionIsolation 目标负对照分别得到原始 TLC **rc=12**，runner 为 COUNTEREXAMPLE/2；两局合法写入和两局越权拒绝见证也有单独预期反例探针。探针不是正模型通过。

完整结果见 [结果索引](results.json)，各行对应未修改的 result、原始 tlc.log、messages、manifest 与 input 快照。工具为固定 v1.7.4 / TLC 2.19，jar SHA-256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`。原始 argv 中的运行路径仅作执行事实；复现用下述相对入口。

```sh
python3 .agents/skills/worker-tla/scripts/run_tlc.py --manifest formal/boundary/isolation/verification.json --profile positive --jar /absolute/path/tla2tools.jar --out .agent-output/isolation-new-run
```

替换 profile 可执行清单中其余四项；输出目录须不存在。

## 交付给 #6 的义务

| 义务 | 依据及实现者必须核实的事实 |
| --- | --- |
| 从可信上下文取 Session 与主体绑定 | 请求内的 actor/session/target 字段不能授予权限；在读取私密结果及写入前都核实当前访问权 |
| 对象定位包含 Session 范围 | 数据库查询/关联和唯一键必须带正确 sessionId；两个局部 itemId 相同不代表同一对象 |
| 提交前重查目标与授权 | 预解析或预校验不能替代持锁后的当前校验；写入对象的实际所属局必须匹配授权范围 |
| 越权结果不泄露对象 | 模型仅记录 Rejected，真实接口应返回统一 TARGET_UNAVAILABLE，不给出另一局持有者或对象详情 |
| 保留原子写入与审计一致性 | 模型一步 Commit 是待落实的事务义务；真实数据库行级锁/事务/异常证据由 #6 提供 |

负对照 `unscoped_lookup` 允许请求跨局同名对象写入：原始轨迹显示 authority 与实际 target 不同，INV-13 捕获。回归场景是同一局部对象 ID 放在两个 Session，以 S1 可信身份请求 S2 对象，断言两局状态和事件均没有越权变化。TypeOK 缺陷从合法初态把版本写入域外 5。

## 证据边界与恢复条件

本产物不覆盖真实认证、数据库隔离、崩溃、网络、客户端过滤、AI 感知和完整 Session 生命周期。它只是 #7 的独立写入隔离子产物，不能代表全部 #7 或父 Spec 完成。独立需求/标准审查尚未运行，释放由总控在审查后决定。

若改变授权绑定、对象寻址、跨局访问规则或提交边界，必须重评本模型及 #6 对应证据；不能只替换候选摘要。正式结果不包含 jar 与 TLC 临时 states，它们可由固定工具及已保存输入重新生成。
