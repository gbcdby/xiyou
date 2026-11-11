# NPC 感知、记忆和意图提交模型

归属：[Ticket #7](https://github.com/gbcdby/xiyou/issues/7)，产物 `visibility-model`。依据固定 Spec `6c2a0b9f6d137ad5fbd41721659404333ad8e16d` 的 M0 §8—10 与验证计划。模式为 `design`；没有实际模型供应商调用、业务源码对应或数据库执行结果。

安全性与 LIVE-03 均完成有限状态全量检查：各探索 2,591,386 个 distinct states，队列为 0、raw rc=0；逐性质负对照与可达见证齐全。独立需求/标准审查尚未完成，依赖尚未释放。

## 角色、信息与事实

两位 NPC 为 Tang / Wukong，绑定 S1；S2 提供独立跨局观察输入。原始观察与传播许可如下，权限是服务端规则，模型返回不能改写：

| 观察 | Session 与原始接收者 | 传播 |
| --- | --- | --- |
| evidenceA | S1 / Tang | 允许出示给 Wukong，产生新的 sharedA |
| privateB | S1 / Wukong | 不允许转交给 Tang |
| foreignS2 | S2 | S1 两 NPC 均不可读取 |
| humanPrivate | S1 / 真人私聊 | 核心 NPC 与代理均不得因角色关联继承 |

合法传播显式创建新 Observation 身份，不改变原事件受众。known、beliefSources、gateway context 分别检查，不能只依赖 NPC 最终说“我不知道”。NPC 可说“已经修好”或据合法观察形成错误信念；Claim、候选 Belief 与实际 repaired/material 状态分开保存，陈述不写世界事实。

## 决策与有序工具包

一个决策可由任一 NPC 发起，记录合法 context、epoch、generation 和相关对象 revision。接收模型回调与 Submit 分开；等待期间可交错改变控制代次、计划代次、相关对象、无关对象、期限、取消和终局。

意图包含两个有序工具：第一工具取得材料，在候选状态把 material 置 0 并递增版本；第二工具检查前一步候选状态，完成修复并再次递增版本。批首比较权威 revision，合法的批内递增不会被误判为外部过期。第二工具非法时整个包无世界效果、无 outbox、无对白；成功时两工具效果、Accepted Receipt、outbox、Decision 收束与对白在一个模型动作里保存。这是实现义务，尚无真实事务证明。

另外保留越权工具、非法 JSON 抽象结果、取消/迟到回调及超时不返回。Finite clock 的 0/1/2 分别表示请求时、截止前与 10 秒截止；不据此模拟实际性能。真人 30 秒宽限和完整控制权往返由 #5 负责，本 profile 只建模其产生的 epoch 围栏。fallback 的完整持久命令与去重不在本 profile，#9 仍需从同一权威入口实现，不能由本结果宣称已通过。

## 性质与负对照

| 性质 | 隔离缺陷与可观察反例 |
| --- | --- |
| INV-00 TypeOK | 从合法初态写入域外 epoch |
| INV-10 NoUnauthorizedObservation | 分别撤掉观察者、Session、真人私聊、传播许可、信念来源与网关 context 过滤 |
| INV-11 IntentCannotWriteFact | 分别把 Claim、Belief 或越权意图直接写为 repaired 事实 |
| INV-04 AtomicCommitBundle | 第二工具失败后保留工具一；失败包提前广播对白 |
| INV-07 FreshDecisionOnly | 分别移除 epoch、generation、相关版本、deadline、Cancelled 状态围栏 |
| INV-08 TerminalBlocksNewEffects | 结束后接受仍在途的两工具包 |
| LIVE-03 DecisionResolvesOrExpires | 禁用超时收束，保留模型永不返回的时序反例 |

已启用安全性质都具有单独目标负对照；不让 TypeOK 或其他性质先失败来冒领目标证据。可达探针包括合法传播、权限拒绝、成功两工具、第二工具失败全回滚、迟到拒绝、无关变化后成功和虚假陈述不改变事实。

## 运行及解释

普通 BFS、1 worker、1 GiB、安全性/负对照每项 180 秒、完整活性 1200 秒预算，死锁检查开启；预声明 distinct 下限 100。安全性无公平性条件。LIVE-03 仅加入 Tick、Expire、Submit 的弱公平性，不强制模型回调返回；在决策 Pending 后必须得到接纳、拒绝、取消或超时收束。

活性首次 180 秒运行超时，原始 INCONCLUSIVE/TIMEOUT 作为历史尝试保留；随后两个 600 秒尝试因执行中断未取得最终报告，原始占位、日志和输入保留且不推测退出码；最终仅把同一模型/性质/公平性的预算增加到 1200 秒，实际约 384 秒完整完成。不删减状态或条件。其他 profile 的工具、模型、配置与该 profile 清单未改变；每次原始 manifest 都单独保存。

实际结果及原始退出码见 [结果索引](results.json)。原始 result/log/messages/manifest/input 全部保留；PASS_WITHIN_SCOPE 只对应完整探索完成的有限模型。rc=12 是目标不变量反例，rc=13 是真实时序反例，探针的 rc=12 仅证明目标可达。

```sh
python3 .agents/skills/worker-tla/scripts/run_tlc.py --manifest formal/boundary/visibility/verification.json --profile positive --jar /absolute/path/tla2tools.jar --out .agent-output/visibility-new-run
```

使用固定 v1.7.4 / TLC 2.19，jar SHA-256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`；其余 profile 同清单，新运行目录不能复用。

## #9 的实施义务

| 义务 | 实现方需提供的事实与回归场景 |
| --- | --- |
| 感知过滤先于 Model Gateway | 记录真实请求上下文和持久记忆，证明未含其他 NPC 私密观察、S2 内容或真人私聊 |
| 传播创造新观察 | source/recipient/session 因果链可追溯，原受众不可改；私密证词转发明确拒绝 |
| 候选信念校验来源 | 引用必须在本 NPC 已登记 Observation 中，信念更新不能改 repaired 等事实 |
| 回调提交重查全部围栏 | 分别延迟回调，在 epoch、generation、deadline、相关版本和取消后提交；每个拒绝不得留下效果 |
| 批首版本与批内版本分离 | 有关外部变化拒绝，无关变化允许；两工具模拟按候选状态顺序执行 |
| 包级原子提交 | 第二工具失败回滚第一工具及对白；Accepted Receipt/outbox/Decision 与世界同事务提交 |
| 幂等和 fallback | 同一 decisionId:submit 回调只收束一次；独立 fallback 稳定键、当前 epoch 和终局检查需由运行实现另取证 |
| 真实模型和可追溯性 | 模型、提示词、合法观察、目标、Decision、工具与实际结果版本关联；替身不算真实模型质量证据 |

不覆盖任意自然语言真实性、人物表现、真实模型延迟/质量、生产安全或无限规模。未执行源码 refinement 或 align；独立需求/标准审查由总控完成后才能释放依赖。
