# 双角色模拟策略：作者自查与修正证据

归属 [#10](https://github.com/gbcdby/xiyou/issues/10)，Spec `3690b481d1805f6a7b535584c80a8574c5103d97`，profile `mock-20261111`。本目录是作者对 `c2511f4a81d29502aed4c122cd701d3c3632d237` 后续修正的自查，不是独立复审、合并或 #12 整体验收结论。固定检查字节见 [source-manifest.json](source-manifest.json)，汇总见 [self-check.json](self-check.json)。最终提交身份取承载本目录的 Git 提交；测试前后及归档时再次核对源码摘要一致。

## 问题与修正边界

- `R-vs001-p07-REQ-001`：普遍检查／逐条逐人分享排在明确合法目标之前，且全 Session 提交会唤醒没有取得新合法信息的远处角色，消耗共享预算。修正保留原每局120次上限、1000ms默认间隔、1200秒内容时限和全部 Validator 条件；新证据解释与安全核对之后优先处理明确路线，同一来源对当前未展示过的同行者合并为正常定向 Claim 加 share_evidence。启动层按事件已保存的核心NPC受众唤醒，不把事件或全世界传给 provider。
- `R-vs001-p07-REQ-002`：策略把当前可达的旧路线重新取出，导致最新请求完成后往返。修正只选择最新路线陈述，再检查实际当前位置与当前合法出口；最新目标已抵达或当前不可见时不回退旧请求。是否抵达读取 `self.regionId`，不把 Claim 当作履约事实。

两策略行为版本分别更新为 `tangseng-safety-v2`、`wukong-inspection-v2`。没有修改公共协议、内容事实、修复／许可权限、数据库预算规则或单AI恢复语义；没有新增故障开关、世界知识缓存或外部模型调用。

## 红色证据保留

[targeted-red.txt](targeted-red.txt) 保存旧生产代码在新回归中的 **9 pass／3 fail，exit 1**：合法路线被普遍工作排队、最新路线完成后旧请求复活、仅真人可见的观察仍唤醒NPC。三个失败都来自目标行为断言。

[budget-before.json](budget-before.json) 保存另一个真实 PostgreSQL 反例：实际修复、许可与独立“出口 destination”已提交后，108次后续调用中104次仍选择分享；整局120预算耗尽，两角色仍在passage且Running。每轮均使用真实 Gateway 输入、持久预留、Validator和Receipt，没有直接写世界或终局。必要差异见证包含输入／输出摘要、Decision、路线可见性、实际安全字段和Receipt范围。

该长探针的 node:test 在120000ms先报告cancelled，异步执行随后仍取得完整120次调用、自然终局断言失败并关闭全部资源；[原日志](budget-original.txt)与[原探针字节](probes/budget-original.test.mjs.txt)保留。它是完整的行为反例记录，不能称为在测试时限内完成。永久回归改为检查“必要核验完成后，下一轮优先执行明确合法路线”，其独立红灯见上述targeted-red。

根代理R1的90秒等待失败保留其原候选及范围；它没有单独证明违反1200秒领域时限。以上120预算反例与需求审查者提供的原反例是另行取得的证据，不改写原执行结果。

## 修正后的实际结果

| 范围 | 实际结果 | 记录 |
| --- | --- | --- |
| 新旧双角色针对性回归 | 12/12通过；包含三项新的红绿回归 | [targeted-green.txt](targeted-green.txt) |
| 五职责真实操作、全量合法策略输入、最终路线 | 13次实际调用完成查证通行；明确终点后两轮实际move | [progress-after.json](progress-after.json) |
| 需求审查者原五人输入序列 | 原120预算内76次调用，真实修复／许可后双方抵达，Finished／clarified_passage | [review-sequences-after.json](review-sequences-after.json) |
| 需求审查者旧路线序列 | 61个实际Decision，只有两次请求对应的2次移动，无新输入不再往返 | 同上 |
| 完整后端回归 | 102/102，exit 0，signal null | [backend.txt](backend.txt) |
| 默认频率的独立生产入口 | 至少60000ms真实单调窗口，两角色各有目标行为，0个新玩家动作、9次受控调用；进程和自有PG连接正常关闭 | [window.json](window.json)、[window-command.txt](window-command.txt)、[process.txt](process.txt) |

两份审查输入序列的作者复跑只重定位导入和报告路径，并增加成功断言；动作序列保留，输入字节见[五人序列](probes/priority-sequence.mjs.txt)、[路线序列](probes/route-sequence.mjs.txt)。其公开可配调度间隔为10ms，不缩短世界时钟和领域时限，也不计入60秒或900秒。五职责永久回归显式逐轮唤醒，仍走真实Orchestrator及120预算；它不冒充默认频率的自然时间观察。

[policy-witnesses.json](policy-witnesses.json) 保存新旧知识样本的精确输入摘要、Decision、语义摘要和Receipt范围：相同口头指责下的来源变化、同源转述不算独立证据、另一角色未收到信息时不提前改变、私人／跨局资料隔离、口头修复不能通行以及实际修复和许可后的移动。没有归档token、数据库连接配置、数据库目录或完整AI上下文；全量payload只用于本地运行断言。

复现入口：

```sh
node --test backend/tests/ai-mock-*.test.mjs
npm run test:backend
npm run verify:mock
```

当前结论限作者实现与自查。独立需求／标准复审、根代理最新集成候选的正式HTTP／Socket整局与900秒矩阵、实际PR／合并另行记录。真实模型质量、真人体验与公网部署在本profile为NOT_REQUIRED，执行状态仍NOT_RUN。
