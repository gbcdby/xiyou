# PR #19 需求轴增量复审 R2

## 分开结论

- **需求轴代码审查及新增持久边界：PASS，限受控 AI 接口准备范围。** 未发现新的已确认需求违约。R-vs001-p06-STD-001 对应的非法原文／不可持久意图恢复症状，在本次真实 PostgreSQL 和子进程检查中得到修复验证；该 finding 的标准轴最终状态由原审查者独立判定。
- **本次首次组合运行不是全通过：exit 1，20 pass、1 文件级 fail。** `ai-orchestrator.test.mjs` 内七项行为均显示 PASS，但该文件进程整体失败。之后单文件 TAP 诊断七项通过、exit 0；这不覆盖或抹掉首次失败，首次文件级失败的实际根因仍为 INCONCLUSIVE。
- 本报告不将上述过程失败改称 PASS，不据此宣称全量运行门槛已满足。代码需求判断、具体运行记录和环境／清理诊断分别保留。
- #9、VER-04 整项、single-ai-runtime 仍未完成；实际外部模型调用为 0，真实模型、真人试玩、合并和部署均不由本报告证明。

## 身份与独立性

- work_id：vs001-p06；审查者：/root/ai_requirements；independent，未参与修正实现。
- 旧候选：local 29322b4ef355060556ee73f21678274140662bc6 / tree 172f832627eb46ead24740ef2e59f6494549205f / remote 0ad722b8a6780c3ff8218395ef0a3f41947ed242。
- 修正候选：local 652c16be96367838de18938a9cb8d88dbf8b89bd / tree df7762628a7a5f37c57ca415b625d892676dd66a。
- 总控提供的同 tree 远端发布身份：9ec1bf552dd9701826c00d53e3a40916e4e7bc2c；本次实际运行始终为上述 local 652c16be。
- Spec 与 Ticket 沿用 6c2a0b9f6d137ad5fbd41721659404333ad8e16d / #9，未发生需求修订。
- 完整 diff 共 12 文件，已全部读取；开始／结束 HEAD 与 tree 相同，工作树干净。生产源码及外部记录只读；本审查只写 .agent-output/ai-requirements-r2。

## 需求影响核对

1. `output.mjs` 的 JSON-string-v1 编码保留 JS 字符串码元。旧 `output_encoding=NULL` 按旧 text 原文解码，未知编码、非字符串编码和码元摘要不符拒绝；没有删改、替换或修补原文。新增摘要区分 UTF-8 编码会替换的不同孤立 surrogate。
2. 新 Gateway 检查位于共享 ProposedIntent 解析之后。包含解码 NUL 的合法结构被分类为 Invalid／UNPERSISTABLE_INTENT，原文及 parsedSemanticDigest 用于诊断，整包不执行；普通允许字符继续通过。公共解析器、世界规则、决策原因键、所有权及协议字段未改变。
3. 新记录存编码原文；相同调用重写时先解码再比较原文与语义摘要，旧记录不会被隐式升级或覆盖。记录和元数据继续受当前内部授权与 Session 锁约束。
4. 旧 Ready 原文恢复先执行当前读权检查与原 Receipt 查询。查询未知时保持 Unknown；确认无原 Receipt 后才解码、核对原语义摘要和持久边界。不可持久的旧 Valid 包收束原决定并使用原 fallback 键，原文、原摘要和旧模型分类不被改写。
5. 编码版本迁移仅增加 nullable 字段及固定枚举约束，现有记录无需重写；Runtime 在既有迁移事务／锁内运行 003。重新启动、普通旧 text 恢复与旧 NUL Ready 恢复均有实际检查。
6. 搜索并核对所有 `output_raw` 消费者：恢复入口、重复输出保存、取证导出和相关测试均采用相应解码；取证继续提供原语义文本，另外标记存储编码。原来以原文为输入的语义摘要检查仍能消费导出数据。
7. 旧轮未改变的感知／Memory、目标、权限、原子工具包与正常调度部分，保留首轮源码审查及 44/44 的历史身份，不改标为本次全量实测。此次重点补查存储、迁移、恢复、原键／摘要和原包原子性。

## 本次运行事实

环境 Node v24.22.1，候选锁文件依赖，真实 PostgreSQL 18.6；供应商全部为受控函数。未调用外部模型。

### 首次组合检查

命令：

`node --test backend/tests/ai-output.test.mjs backend/tests/ai-orchestrator.test.mjs backend/tests/ai-crash.test.mjs`

使用 shell pipefail 保留退出状态。实际 exit 1，tests 21／pass 20／fail 1，duration 3597.3382 ms。新 NUL、两种孤立 surrogate、旧 text、旧 Ready 恢复与原五处子进程故障场景的行为断言均显示通过。额外文件级失败指向 ai-orchestrator.test.mjs，七项内部断言均通过，原输出只提供 `test failed`，没有给出具体 file exitCode/signal 或业务断言反例。

对应 PostgreSQL 日志目录为 `ai-orchestrator-tNAYyL`：10:42:19.793 UTC 收到 fast shutdown，PID 123／142 随后记录 administrator termination，10:42:19.873 UTC 数据库关闭。该时序是观察，不足以单独证明文件失败根因。另一只读调查者提出 pg-pool.end 与客户端关闭回调的静态竞态线索，仍需对应运行证据，不将其写成已确认原因。本次修正未更改这个测试支持入口。

### 限定诊断

`node --test --test-reporter=tap backend/tests/ai-orchestrator.test.mjs`，同时收集 stderr：7／7、exit 0、duration 3467.221417 ms。只说明该次单文件运行通过，首次组合失败仍保留。

### 独立新增 Unicode 持久边界探针

自编探针使用实际 Gateway→Orchestrator→PostgreSQL→Receipt／WorldEvent→Replay，四项全部通过、exit 0：

- 字面文本 `\\u0000` 正常接受，不误判为实际 NUL。
- U+0001、TAB、LF、CR、U+001F 正常接受，事件及回放保留原文本。
- 有效补充平面 emoji 与 U+FFFD 正常接受，不做替换或过度过滤。
- 实际 NUL 被拒，稳定 fallback 成功，原包没有对白效果。

四项均核对存储原文可无损解码，恢复不新增效果，调用次数不变，externalCalls=0。

## 原始证据摘要

| 文件 | SHA-256 |
| --- | --- |
| targeted-runtime.log | 28435262be33b7893be5a97b3d716865958fa5d70397d6cc1473736935b7a2cc |
| orchestrator-diagnostic.log | c6bef83e18dff35c42ecd37f1d273845443a94249ba1376a22ecf1dd4ba83f5f |
| storage-boundary.log | 40034035bc91e632b85706ba16217f58fdc1c367e7d8fac972a10c3a167ffc79 |
| storage-boundary-probe.mjs | 5a4ffd426f0592ed43b114fa224f7716bab92281abd8cd8f8c7624dd358c5bb4 |

下一步由总控汇总标准轴复审及测试清理诊断；保持真实模型项 NOT_RUN，不以本报告关闭整票。
