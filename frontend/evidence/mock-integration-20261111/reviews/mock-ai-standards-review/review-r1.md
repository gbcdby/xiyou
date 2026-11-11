# #10 受控双角色策略：独立标准轴 R1

**标准轴 PASS，无新 finding、无阻断项。** 本报告覆盖双角色策略、可信启动层、正式 mock 入口、针对性检查及最终证据补充；需求轴为 NOT_RUN，不改变原需求轴 finding 的状态。#12 最终集成候选另审，不将组件通过写为全切片通过。

## 1. 候选、范围与独立性

| 对象 | 固定身份 |
| --- | --- |
| work_id / profile | `vs001-p07` / `mock-20261111` |
| 基线 | `cf6f880f292d835f1644cd2e8f215fcf8aff512f` |
| 完整实现候选 | `71aad48878c532521919c72511c023285785d7e7` |
| 实现 tree | `b438c5641290cf70cf9cf0fccafb85bab98e76f5` |
| 纯证据补充及本次实际执行 HEAD | `ce57d0f172b5a447cf16069ed1255fd009ecc931` |
| 最终审查 tree | `e0f7a7533ff21b4b58c5a878c36e1d5be8fb26ed` |
| Spec | `3690b481d1805f6a7b535584c80a8574c5103d97`，`vertical-slice-mock.md` §2—3、§5 |
| Spec 本地 blob | `c5197eb41639d5b4bd2281199a4627d8a734c173`，与已实读的固定远端 Spec 相同 |
| 审查者 | `/root/network_standards`，independent，非本候选作者 |

读取了 worker-review 及 review-protocol、仓库 AGENTS、工程／工作流／文档布局、有效 Spec 和 [#10 当前正文](https://github.com/gbcdby/xiyou/issues/10)。没有读取需求轴当前审查报告；Issue 已公开的问题记录和作者归档的原始输入、执行结果作为待核对材料，不作为本轴结论。没有递归分派、改业务或测试、改既有证据或远端写入。

实际检查基线到 71aad 的全部 10 项非证据文件：`mock-provider.mjs`、`mock-runtime.mjs`、`mock-main.mjs`、`verify-mock-ai.mjs`、三个 `ai-mock-*.test.mjs`、`package.json`、两份 AI 说明。再核对完整新证据目录及 71aad→ce57 的 8 项纯证据增量。后者只补 6 份原始文本并修说明／日志链接；业务、测试和验证脚本字节不变。实际执行记录如实保留 ce57 HEAD，不冒称在较早 commit 上执行。

## 2. 分轴结果

| 轴 | 结果 | 新 finding | 阻断项 |
| --- | --- | --- | --- |
| 标准轴 | PASS，限本报告范围 | 0 | 0 |
| 需求轴 | NOT_RUN | 不评定 | 不评定 |

原 `R-vs001-p07-REQ-001/002` 是否 VERIFIED 由原轴处理。本审查独立验证了受影响的预算推进、旧路线和唤醒路径，但不代写其他轴状态。

## 3. 源码审查结论

### provider 输入、权限与事实分离

`backend/ai/mock-provider.mjs` 没有 import、数据库、Runtime、文件、fixture 或网络依赖，也没有 Session／角色记忆缓存。两 provider 的 identity 和 v2 行为版本可区分；generate 核对 core_npc、角色及 Decision/Session 对应。策略仅取本次合法 current、memory、Decision 和允许工具，能力取 allowedTools 与当前 capabilities 的交集。

gate 的 safe/permit 来自当前可见目标；Evidence 判断要求布尔 true、两个合法来源且 sourceIds 集合不相交，Claim 不参与事实判定。同源重复传播不增加独立印证。BeliefProposal 只引用本次 Observation，仍经原 Validator 校验。策略不提出最终修复／许可，未硬编码隐藏对象或终点 ID。明确出口还须属于本次可见 exits，实际效果依然由原提交器决定。

新证据解释、安全核验、明确路线、一般检查／分享的优先次序闭合。最新路线先从合法历史里选出，然后判断当前抵达或可见性，不再从可达旧请求中回退选择。一般展示把尚未收到同一说明的当前同行者合并；正常定向 Claim 与 share_evidence 处于同一既有原子工具包，分享失败不会独留“已展示”记录。去重说明不被用来宣称实际抵达或世界已修复。

### 可信唤醒层与持久预算

`backend/ai/mock-runtime.mjs` 只在可信层查 Running Session、绑定固定两角色；扫描已有局并登记新开局。每个 provider 使用自己的 Gateway／Orchestrator，watch 使用 autoWake=false；新层只按提交事件原 coreNpcCharacterIds 唤醒，忽略单独 GoalUpdated，事件载荷不传给 provider。是否调度与是否有权感知仍分层，后续 Runtime 总是重新构造当前合法上下文。

默认间隔 1000 ms，整局共享持久上限 120 未放大；调用预留、Receipt 恢复、Decision 收束、fallback、epoch、generation、deadline 和终局围栏全部复用原实现。独立 Git 对象比较确认 context、Gateway、Orchestrator、persistence、output、Runtime、decisions、server、普通 main、game、protocol、content、migrations、lockfile 共 14 个受查对象／子树与基线不变。

`register` 合并同一 Session 的登记任务，重复 attachment 拒绝；close 停止登记、解除监听、等待 pending、关闭两套任务和清除句柄。`mock-main` 显式组合正式权威服务与该层，日志标明模拟策略；普通 start 未改变。进程拥有的 pool 等服务与角色关闭后再结束，并等待真实 client end。没有读取模型密钥或开启外部 provider。

### 测试真实性与工程约定

新测试使用真实 PostgreSQL、Runtime、Gateway、Decision、持久预留和 Validator。所有人类动作通过正式权威入口，未替写世界、预填 Accepted 或直接写结局。非法、超时和迟到 Promise 由验证适配器构造，生产 provider 没有测试故障开关。

两套相同口头说法／不同授权来源样本、两角色初始信息与信念差异、合法传播、私聊和跨局标记、拒绝到实际移动、预算与重启、原意图一次提交以及终局迟到均有真实测试路径。五人回归以逐轮显式唤醒检查策略优先级，和默认频率的 60 秒自然窗口分开说明。没有把加速调度当作 60 秒或 900 秒。

实现沿用现有模块和依赖，没有新增并行世界状态或绕过 ModelGateway。注释、说明、策略文本和操作日志采用中文；新文件名与标识为英文。协议／权限语义和模型义务没有改变，本报告不产生新的 TLC 证明声明。

## 4. 本审查者实际执行

| 检查 | 结果 | 原始证据 |
| --- | --- | --- |
| 三个 ai-mock 测试文件 | **12/12 PASS**，0 fail、0 cancelled，exit 0；3.815 秒 | `targeted.txt`、`targeted.execution.json`、`targeted/policy-evidence.json`、`targeted/progress-evidence.json` |
| 独立真实 PG 探针 | **4 组 PASS**，exit 0；3.293 秒 | `isolation-probe.mjs/json`、`isolation.txt`、`isolation.execution.json` |
| 输入、原始文件、派生摘要、链接与继承范围审计 | source_inspection / OBSERVED / PASS | `audit-archive.py`、`archive-audit.json` |

本次 12 项运行中的五人链实际 **13 次调用**完成 clarified_passage；明确 destination 后两次真实 move，未增加 120 预算。证据不只依赖对白。

独立探针另外覆盖了原测试未完整组合的边界：

1. 同一局私人 Claim 与仅真人获得的 Observation 都不增加两 NPC 的持久调用数。
2. 另一 Session 的合法公开话语确实唤醒该局角色，但本局计数不变。
3. 空闲角色终态后没有新 provider 调用，两个 Gateway 的外部调用为 0。
4. 先提交合法 store 请求，再提交更新但不可见的出口请求；随后 **14 次实际 Decision／预留／Gateway／提交**均未回退旧 store 路线，角色保持原处。

独立探针调度间隔为 25 ms；最新不可见路线部分显式逐次驱动原流水线。它不计作自然 60 秒观察。所有测试资源已关闭；执行前后 70 项受查输入相同，tracked 工作区干净。临时 PostgreSQL 由既有 fixture 管理，其数据目录不归档。

## 5. 作者证据的独立核对与继承

作者的全量 102 项及 60 秒窗口没有由本审查者机械重跑。继承依据是固定源身份、原始输出与下列实核：

- **70 项 checkedBytes** 全部匹配 71aad、ce57 和当前工作区；独立两次执行也保存这 70 项的前后摘要。
- 原始 60 秒窗口的 **64 项 sourceBefore/sourceAfter** 相同，均包含在匹配的 source-manifest 内。归档 window.json 是原窗口 JSON 去掉这两份重复来源映射后的精确结果，来源并未变为另一候选。
- 6 份补充日志及 3 份原探针文本，共 **9 份逐字节匹配原件**；ce57 的改动不会改变已执行业务输入。
- 原始日志计数确认为：新回归红灯 9 pass／3 fail／0 cancelled，绿灯 12/12，全后端 102/102。它们是作者执行，不与独立 12 项相加制造“新总通过数”。
- 默认生产入口观察 **60016.968272 ms**，9 次受控调用、0 个新玩家动作，两角色有 Goal 依据的 Accepted 工具效果；进程 code 0、signal null，自有数据库连接关闭。子进程使用实际 HTTP／Socket.IO 与独立 mock-main。
- policy-witnesses 中 22 个摘录逐项对应原 47 个提议记录的声明字段和工具 kind；原 27 个 wait 的数量保留。摘录不是完整上下文，也没有标成全部提议。
- progress-after 的 13 次、末尾两次 move、结束事实与原始记录一致。作者重放的另外两个输入序列，其脚本 SHA、76 次自动调度推进和 61 个 Decision／两次请求移动的结果与原件一致；它们仍是作者复跑。
- 旧预算反例的 provider SHA 与 c251 原对象、probe SHA 与归档探针匹配；120 次调用、108 次后续调用、104 次分享、Running 及失败结果均与原始记录相同。原 node:test **1 cancelled／0 pass** 的 120000 ms 超时没有抹除。随后继续执行至 154960.97789 ms 的行为反例不能写成测试在时限内完成；文档明确区分这两个事实。
- 37 个受查相对文档链接可读取。ce57 对 budget-before.json 仅把 runnerBoundary 中的日志链接改为 `.txt`；其余执行数据与 71aad 完全相同。

全 diff 检查的 4 处尾空白仅在原始 targeted-red.txt；排除原始证据的源码／文档检查 exit 0。保留原日志字节符合本轮证据要求，无需为了格式检查改写失败记录。

## 6. 未覆盖与后续适用边界

未新跑作者全后端 102 项、默认 60 秒窗口、所有历史失败中间树或原单 AI 全套故障矩阵；它们分别按固定来源与未改依赖解释。标准轴实际执行只有上表列明的 12 项和 4 组独立探针。

本报告不覆盖最终集成 candidate 的 #11 recap 接合、完整两人／五人 HTTP／Socket／浏览器矩阵、四结局合集、五职责贡献、900 秒、所有故障的同轨迹因果关系、多实例部署／滚动升级、任意规模压力或新 TLC/refinement。组件里的公开字段策略不代表任意新内容配置、自然语言泛化或实际 LLM 人格质量通过。

真实模型质量、真人体验与公网部署在当前 profile 为 NOT_REQUIRED；实际仍 NOT_RUN。没有把它们重新设为本次 mock 组件的门槛。完整 #10 需求轴结论、整合到后续候选及 PR/合并由总控分别核对。

## 7. 最小审查归档

保留以下 13 个文件即可，不复制依赖或 PostgreSQL 目录：

- `review-r1.md`、`review-r1.json`、`archive-audit.json`、`audit-archive.py`、`run-check.py`。
- `targeted.txt`、`targeted.execution.json`、`targeted/policy-evidence.json`、`targeted/progress-evidence.json`。
- `isolation-probe.mjs`、`isolation-probe.json`、`isolation.txt`、`isolation.execution.json`。

JSON 的 minimalArchiveFiles 提供同一可机读清单。审计脚本里的作者临时路径仅表示本次原件核对来源；正式归档中仍可用 Git 固定对象、源码摘要及已有正式证据验证输入。
