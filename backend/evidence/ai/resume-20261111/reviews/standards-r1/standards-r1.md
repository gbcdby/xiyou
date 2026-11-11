# PR #19 标准轴独立审查 R1

## 结论

**标准轴：FAIL。** 确认一个中严重度、阻断本次受控实现审查通过的问题：`R-vs001-p06-STD-001`。非法模型原文中的 U+0000 在新增诊断持久化路径触发数据库异常，使已经被 Gateway 识别为 Invalid 的决定没有正常拒绝及 fallback。

本报告仅审查标准轴；需求轴由另一位审查者独立处理，在本审查者范围内为 NOT_RUN。真实外部模型未配置，也未调用；保持 BLOCKED/NOT_RUN，不能据本报告释放 single-ai-runtime、解除 #10 依赖或宣称 Ticket #9 / VER-04 整项完成。

## 对象、依据与独立性

| 项目 | 本轮固定身份 |
| --- | --- |
| work_id / Ticket | vs001-p06 / gbcdby/xiyou #9 |
| subject.kind / subject.id | pull_request / gbcdby/xiyou#19@0ad722b8a6780c3ff8218395ef0a3f41947ed242 |
| remote head | 0ad722b8a6780c3ff8218395ef0a3f41947ed242 |
| base | 1c2dac4162ea7ae49535221a1c995c1af4f4692c |
| 完整 tree | 172f832627eb46ead24740ef2e59f6494549205f |
| 本地重建提交 | 29322b4ef355060556ee73f21678274140662bc6，同完整 tree |
| contract_id | Spec 6c2a0b9f6d137ad5fbd41721659404333ad8e16d |
| 审查者 | /root/ai_standards，independent；未参与实现 |

本地重建库没有原提交祖先历史，因此比较范围取 GitHub PR 完整文件清单与实际 patch，不能把本地提交的父关系当作远端 merge-base。审查始末回读的远端 head/base 均相同；此报告不覆盖 GitHub 临时合并提交或未来集成候选。

已读取 worker-review 当前技能及 review-protocol、项目 AGENTS.md、工程约定、工作流、Ticket #9、固定 Spec 和 #7 visibility/fallback 对 #9 的实施义务。PR 元数据不可避免包含作者说明；作者说明仅用于定位，不作为结论依据。首轮未读取另一轴报告，没有递归拆分，没有修改生产文件、没有 GitHub 写入。临时文件仅写本任务目录。

## Findings

### R-vs001-p06-STD-001 — 非法原文诊断保存失败，绕过既定收束和 fallback

| 字段 | 值 |
| --- | --- |
| axis | standards |
| severity | medium（P2）：特殊但可达的供应商输出令该角色的失败处理失效；不声称全房间不可用或已有越权世界效果 |
| blocking | true：受控输出边界与故障恢复属于本票基础工程契约 |
| status | OPEN |
| subject_id | gbcdby/xiyou#19@0ad722b8a6780c3ff8218395ef0a3f41947ed242 |
| 主要位置 | backend/ai/persistence.mjs:48–49 |
| 关联位置 | backend/ai/gateway.mjs:60–64；backend/ai/orchestrator.mjs:123–137、58–62 |
| 依据 | AGENTS 铁律 7；工程约定“模型超时、非法 tool JSON”；M0 §10 的非法 JSON 拒绝和受限 fallback；#9 必需检查 |
| evidence_ids | E-STD-02、E-STD-03 |

**触发步骤：**

1. 在真实 PostgreSQL 18.6 上经现有 Runtime 入口创建 Running Session，绑定 tangseng/core_npc。
2. 注入 `kind: 'controlled'` 的本地 provider，返回 `{ rawText: '{bad' + String.fromCharCode(0) }`。
3. 以 `maxCallsPerSession: 1` 注册 Orchestrator。关闭自动事件唤醒以便观察单次调用的状态；这不会改变输出保存和 fallback 路径。
4. 等待模型返回，读取 Orchestrator、Decision、ai_runs 和稳定 fallback Receipt；随后显式调用 recover 观察恢复。

**本轮实际结果：** Gateway `invalid=1`，但 `saveOutput` 把含 NUL 的原文作为 PostgreSQL text 参数发送。`String.isWellFormed()` 只排除不配对代理项，仍允许 U+0000；数据库返回 `22021`。Orchestrator 变为 `Unavailable`，`error='22021'`，Decision 仍为 `Pending`，ai_runs 仍为 `Reserved`、`model_result=null`，没有 `decisionId:fallback` Receipt。显式 recover 把此无输出记录取消成 `Cancelled`，仍无 fallback。普通 `'{bad'` 对照在相同环境正常进入 `Rejected`、`Resolved`，取得 `Accepted/NO_CHANGE` fallback。

新增持久化调用位于决定收束之前，因此诊断载荷的可存储性成为失败处理的前提。此处并非数据库不可用；同一数据库正常处理对照样本。错误由已明确进入 Invalid 分支的供应商文本直接触发。

**建议修正：** 对不适合 text 的不可信原文采用可逆编码/bytea，或明确省略原文字段但保留摘要、Invalid 状态和说明；不能因诊断原文不可存储而跳过确定的 Rejected/Expired 与原稳定 fallback。补充真实 PG 的含 U+0000 非法原文用例，并检查一次恢复仍保留确定终态与唯一 fallback。

**基线边界附注：** 同一探针也观察到合法 JSON 的对白字符串含转义 U+0000 时，Gateway 返回 Valid，既有 WorldEvent 的 jsonb 持久化报 `22P05`，直接 recover 重复失败。共享协议允许该字符、既有 Validator/事件持久化无法表示它的语义缺口已在基线；本报告不把该全部根因归为本 PR 新增。它说明同类存储边界需要明确契约，但 R-STD-001 的阻断证据仅凭本 PR 新增的非法原文保存路径就已成立。

## 已完成的标准检查范围

读取 107 个完整候选文件；核心生产改动、配置、迁移、文档、五份新增测试和三个支持文件逐段检查。远端两个大型 JSON 的 patch 为空，直接读取已核验同 tree 的完整新增文件。归档材料的读入与摘要清单见 independent-artifact-read.json。

| 范围 | 本轮观察及结论边界 |
| --- | --- |
| 模块与供应商边界 | 业务仅通过 ModelGateway 接口；provider 只收到过滤克隆值、共享 schema 和配置，没有 Runtime/数据库写入口。未新增框架或服务。HTTP/Socket.IO 没有注册新的内部 AI 入口。 |
| 原子准备与兼容接口 | prepareDecisionContext 在原 Session 行锁内完成目标、上下文、观察、版本和 Decision；原 prepareDecision 提取到 prepareRecord，原公共 wire 与消费者行为未见改变。模型等待位于事务外。 |
| 信息与目标边界 | Context 从 authorizedProjection 构建，Observation 按历史受众过滤；Belief 的来源必须在选择的白名单内，代理未读取真人私聊。Goal 使用既有事件，来源按 Session/actor/principal_kind 隔离；只在合法当前目标上刷新，离开后不读取隐藏新状态。 |
| 持久预算 | reserveCall 在同一 Session 锁内计数及 INSERT，主键保证每 Decision 最多一份预留；恢复计入旧 Reserved/Ready/Resolved，不能由新 Orchestrator 重置同配置下的本局预算。此为源码观察及现有测试/原输出核对，未在本轮新跑完整预算测试。 |
| 恢复、幂等和权限 | 输出原文先落库再提交；恢复先查原 Receipt、对摘要，无 Receipt 才重发原 ID/原文；Fallback 使用原 decisionId:fallback 与 epoch。当前授权检查覆盖新增持久接口和结果读取，提交继续经过原 Validator。 |
| 关闭与资源 | Orchestrator 关闭监听/定时器、Abort 推理并等待已接纳收束；Gateway 的逻辑取消吸收迟到输出。供应商自行创建的网络资源属于适配器责任，当前尚无真实适配器。 |
| 数据迁移 | 002-ai.sql 通过原事务/advisory lock 顺序安装；ai_runs 的决策外键与 Session 级联关系、复合键适合现有读取路径。未发现新公开诊断查询。 |
| 错误路径 | 除 R-STD-001 外，检查了非法格式、取消、过期、撤权、未知结果、重试和稳定 fallback 的源码及实际归档场景；不把作者 82 项记录冒充本轮重新执行。 |

`externalAuthorization.maxCalls` 的 Gateway 计数是实例内计数，持久本局预算是独立的 maxCallsPerSession。实际授权记录、授权范围与真实适配器尚缺，本报告不把该组合宣称为已验证的跨进程/跨局费用授权保障。配置实际供应商时必须固定授权范围及对应持久预算；这不是已经复现的费用越权事实。

## 证据

| ID | kind / status | 内容 |
| --- | --- | --- |
| E-STD-01 | source_inspection / OBSERVED | PR 实际 patch 与完整文件清单；本地 HEAD/tree；始末 PR head/base 一致；最终 git status 无生产文件修改。 |
| E-STD-02 | source_inspection / OBSERVED | 新增模块、Runtime/Decision 改动、迁移及受影响 Rules/Projection/协议/网络消费者。 |
| E-STD-03 | execution / OBSERVED | invalid-output-probe.mjs，Node v24.22.1、真实 PostgreSQL 18.6，本地 controlled provider；输出见 invalid-output-probe.log / invalid-output-result.json。三个样本共三次受控调用，外部调用 0。探针退出 0 表示取证正常结束，不表示产品通过。 |
| E-STD-04 | artifact_audit / OBSERVED | 80 个源码/输入摘要全部匹配，汇总 4690d0fa76196fb6d44350ca380c73c25b24e42876d121bcc62f6b932b99db67；88 个证据文件摘要全部匹配。 |
| E-STD-05 | execution / OBSERVED | 按归档说明将 audit-contracts.mjs 原字节复制到本任务临时目录后执行：26 份原文摘要、18 个事件、45 份收据匹配共享契约；退出 0。这是对历史 captures 的本轮审计，不是重新执行网络/崩溃场景。 |
| E-STD-06 | historical / HISTORICAL | 候选归档的 final-backend/protocol/content/static 原始命令及 exitCode=0/signal=null，绑定 726e96edff61f71caa2123494f2e9f6795e4a6ca 的源码/输入摘要；保留其作者执行身份。 |
| E-STD-07 | execution / OBSERVED | 本轮 PostgreSQL 日志已观察到 18.6 启动及正常 shutdown；探针无在途执行句柄。 |

归档 audit-contracts.mjs 在正式 tooling 目录原位运行会因 '../../protocol/node.mjs' 相对路径报 ERR_MODULE_NOT_FOUND；按归档文档的临时目录复现方式移动原字节后通过。由于已有明确复现方式，本轮不把该行为列为独立 finding，也不把原位失败隐藏成通过。

## 未覆盖与下一步

未执行真实供应商、端点、模型、凭证及费用授权验证；未重跑全量后端、共享协议、内容或 TLC；未执行浏览器、真人体验、双 NPC 策略、完整局、合并和发布。未覆盖任意规模、永久数据库失效或不配合 Abort 的真实供应商网络资源释放。

下一步仅需针对固定修正候选复核 R-vs001-p06-STD-001、增量和相关失败/恢复路径，并按累计变更清单补齐覆盖。此报告不会因作者称修复就将 OPEN 改为 VERIFIED。
