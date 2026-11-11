# PR #19 独立需求轴审查

## 结论与范围

- work_id：vs001-p06；审查者：/root/ai_requirements；独立性：independent，未参与候选实现。
- 需求轴：**PASS，范围仅为当前受控单角色 AI 实现及接口准备**；已确认 findings：0。
- 标准轴：由另一独立审查者承担，本报告不代替该轴。
- 整票 #9、VER-04 整项、single-ai-runtime 释放：**仍未满足**。实际外部模型调用未运行；供应商、模型、凭证引用与费用授权预算未提供。不得据本报告把 PR 标为完成真实模型验收、关闭 #9 或解除 #10 的真实模型依赖。

## 固定对象

- 仓库：gbcdby/xiyou；PR：https://github.com/gbcdby/xiyou/pull/19。
- 远端候选：0ad722b8a6780c3ff8218395ef0a3f41947ed242。
- 比较点：1c2dac4162ea7ae49535221a1c995c1af4f4692c；远端 PR 差异用于确认完整变更清单。
- 实际读取／运行本地候选：29322b4ef355060556ee73f21678274140662bc6。
- 两者完整 tree：172f832627eb46ead24740ef2e59f6494549205f。
- Spec：6c2a0b9f6d137ad5fbd41721659404333ad8e16d；读取主 Spec、M0 协议、验证计划与 Ticket #9。
- visibility/fallback 模型实施义务：读取已发布同内容远端 c78066d9b95eb3657293fd26a6a5d8b325846b38 的两份 README，核对其 #9 实施义务；本审查未运行 TLC，不声称源码 refinement 证明。
- 开始与结束均核对工作树干净，tree 未变。临时日志在被忽略的 .agent-output 内，未修改生产代码或外部 GitHub 记录。

## 核对内容

已读取完整 PR 变更目录、四个新 AI 模块、decisions/runtime 新入口与其完整上下文、002-ai 迁移、所有新增 AI 行为测试与崩溃支持入口；另读取现有 projection、rules、world、协议解析与类型边界、真实服务的相应消费者。生成的历史证据仅作来源线索；下列执行结论来自本次独立运行。

| 需求／边界 | 本次观察及执行覆盖 |
| --- | --- |
| M0-AC-09：上下文和 Memory 权限 | 同锁原子准备；Observation 白名单与上下文水位一致；跨局、他人信念、真人私聊过滤；合法传播产生新 Observation、不改旧受众；离开区域保留合法历史、移除当前视野 |
| M0-AC-10：意图只能通过 Validator | 非法 JSON、重复键、未知工具、无工具、不可访问目标、原型名称、私人发言、虚构观察与模型伪造目标权限均不产生原意图效果 |
| M0-AC-10：决策围栏 | 新 generation、取消、期限、终局、真人交还、访问撤销与相关目标版本变化后的旧结果拒绝；原 Decision 不复活 |
| 包级原子性与版本 | 第一工具合法第二工具失败，第一工具和对白一起回滚；合法有序工具包按候选状态递增版本；重复回调只读原 Receipt |
| Fact／Claim／Belief 与因果 | Claim 可形成来源明确的 Belief，但不改变 repaired 等世界事实；可信目标和目标来源持久记录；实际决定、上下文、输出、摘要和 Receipt 可关联 |
| 异步与预算 | 模型等待期间真人经真实 Socket 获得合法 Receipt；每角色单在途、全局并发、通知合并、最小调用间隔、本局持久预留预算跨重启保留 |
| Unknown 与独立 fallback | 原文先保存；未知结果保留原 ID/摘要，不伪造失败；恢复只查／重试原结果；Rejected/Expired 的 fallback 使用固定原因键；Cancelled/Committed 不安排失败 fallback |
| 实际进程退出与恢复 | after-output、before-fallback、after-fallback、after-intent、during-publish 五处真实子进程退出（81—85，无信号），新 Runtime 恢复；原文/Receipt/回放/outbox 一致，纯恢复不调用模型 |
| 关闭与迟到回调 | 忽略 Abort 的受控 provider 不阻塞调度器关闭；迟到返回不再次提交；取消及终局后原意图没有新效果 |

## 本次独立执行

环境：Node v24.22.1；依赖使用候选锁文件安装；PostgreSQL 使用候选 embedded-postgres 18.6.0-beta.19，启动真实独立集群；网络检查为真实 HTTP／Socket.IO。供应商为受控函数，**实际外部模型调用 0**。

1. `node --test backend/tests/ai-gateway.test.mjs`：2 tests、2 pass、0 fail；退出成功。
2. `node --test backend/tests/ai-context.test.mjs backend/tests/ai-orchestrator.test.mjs backend/tests/ai-network.test.mjs backend/tests/ai-crash.test.mjs`：42 tests、42 pass、0 fail／cancelled／skipped；exit 0；测试报告实际持续 5492.674933 ms。

合计 **44/44**。这不是 CI，不包括原作者其余后端 38 项，也没有把原作者 82/82 改称本次全量复跑。

原始输出：

- gateway.log SHA-256：79326a78b236ef082e3977ec8b0e33e9604e6f0e3e5630fd35a75a3475a82a33。
- ai-runtime.log SHA-256：efc9c943e9c6d855cbdaf083e4537f042d11b1dcb2cb86f1467d207961a997c7。

## 未覆盖与后续约束

- 未执行真实模型正常闭环、真实模型质量／延迟、双核心人格策略、完整局真人试玩、跨层最终集成、合并或部署。
- 当前 Gateway externalAuthorization.maxCalls 是实例内限制；Orchestrator 的持久限制按 Session 统计。实际供应商接入前须让费用授权的作用域与配置对应，不能把实例内指标称为跨重启总费用账本。本报告未把此尚未选择的外部预算作用域虚构成现有产品门槛或已确认缺陷。
- 当前未发现需要修正的需求阻断项；如候选、协议、模型条件或实际集成配置改变，应复核受影响增量，保留本次证据的原候选身份。
