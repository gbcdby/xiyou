# PR #19 标准轴独立复审 R2

## 结论

**标准轴：PASS（受控单 AI 实现范围）。** `R-vs001-p06-STD-001` 已由本轮独立源码核对和真实 PostgreSQL/子进程复现改为 **VERIFIED**。本次 12 文件增量未发现新阻断；结合 R1 未变部分的累计审查，当前 PR 110 文件清单没有新增路径覆盖缺口。

本结论不代表另一需求轴、本票完整验收或真实模型闭环通过。实际供应商、模型、凭证及费用授权未配置，真实模型仍为 BLOCKED/NOT_RUN；不因此释放 single-ai-runtime 或解除 #10 的原依赖。

## 固定候选和审查身份

| 对象 | 身份 |
| --- | --- |
| work_id / Ticket | vs001-p06 / gbcdby/xiyou #9 |
| 新候选本地 commit | 652c16be96367838de18938a9cb8d88dbf8b89bd |
| 新候选远端 PR head | 9ec1bf552dd9701826c00d53e3a40916e4e7bc2c |
| 新候选完整 tree | df7762628a7a5f37c57ca415b625d892676dd66a |
| 已审 R1 本地 commit/tree | 29322b4ef355060556ee73f21678274140662bc6 / 172f832627eb46ead24740ef2e59f6494549205f |
| 已审 R1 远端 head | 0ad722b8a6780c3ff8218395ef0a3f41947ed242 |
| PR base | 1c2dac4162ea7ae49535221a1c995c1af4f4692c，未变 |
| contract_id | 6c2a0b9f6d137ad5fbd41721659404333ad8e16d，未变 |
| 审查者 / 独立性 | /root/ai_standards / independent |

已独立回读远端 Git commit 元数据：9ec1bf 的 tree 为 df776262，与本轮实际执行的本地候选相同，父提交为 R1 远端 head。审查者未参与修正实现，未读取另一需求复审结论；作者“89/89”未作为本轮结论依据。生产文件只读，临时文件仅位于本任务输出目录。

## Finding 复审

| 字段 | 结果 |
| --- | --- |
| id | R-vs001-p06-STD-001 |
| axis / severity | standards / medium（P2） |
| 原始状态与阻断 | OPEN / blocking=true，来源为 R1 的真实失败 |
| 本轮状态 | VERIFIED；该阻断已解决 |
| original_subject_id | gbcdby/xiyou#19@0ad722b8a6780c3ff8218395ef0a3f41947ed242 |
| verified_subject_id | gbcdby/xiyou#19@9ec1bf552dd9701826c00d53e3a40916e4e7bc2c |
| 修正位置 | ai/output.mjs；ai/persistence.mjs；ai/gateway.mjs；ai/orchestrator.mjs；003-ai-output-encoding.sql；Runtime 迁移及读取消费者 |
| 本轮证据 | E-STD-R2-01 至 E-STD-R2-05 |

R1 原始失败保留原候选身份和日志，不改写为成功。本轮原样复制 R1 的三个反例样本到新候选执行，再独立断言结果：

| 原反例 / 对照 | 新候选实际结果 |
| --- | --- |
| 普通非法 JSON | Rejected、Resolved、无 error，fallback Accepted，恢复不改变终态 |
| 非法原文含 U+0000 | Rejected、Resolved、无 22021，fallback Accepted，恢复不再取消原失败决定 |
| 合法 JSON 的对白解码后含 U+0000 | AI 边界 Invalid，Rejected、Resolved、无 22P05，fallback Accepted，恢复无异常 |

原文采用 JSON-string-v1 的字符串编码保存到 text，读取时还原原始 JS 码元；未删除、替换或修补原文。旧 output_encoding=NULL 继续按 plain text 读取。精确码元摘要使用编码后的字节，避免仅凭原有 UTF-8 摘要混淆孤立代理项。

Gateway 在共享解析之后检查 AI 意图的实际存储边界，包含 NUL 的意图成为 Invalid，保存 parsedSemanticDigest 作诊断而不误当成可提交输出。共享公共解析器、世界 JSON 存储和其他入口未改；R1 附注中的公共入口字符相容性仍属于既有范围，本次只关闭 AI 路径的具体问题。

## 独立运行检查

### 1. 真正旧版数据库升级和结果恢复

兼容探针先加载 R1 原候选的 Runtime、reserveCall、saveOutput，确认 ai_runs 尚无 output_encoding 列。使用真实公开建局入口及旧内部 API 生成三类持久记录，再启动新 Runtime 执行 003 迁移并重复执行 migrate。不是先建新表后手工伪装成旧数据库。

| 旧记录 / 故障 | 实际断言结果 |
| --- | --- |
| 正常 Ready 原文 | 迁移前后原文与 model_result 不变，编码为 NULL；按原 decisionId/语义摘要提交一次，得到 Accepted，无 fallback |
| NUL Ready，Receipt 查询报 OUTCOME_UNKNOWN | Orchestrator 保持 Unknown；Decision 仍 Pending，fallback 数 0 |
| 同一 NUL Ready，查询恢复正常且原 Receipt 不存在 | 核对原摘要后 Rejected；原文、旧 Valid 分类和旧摘要不变；outcome 单独记录 UNPERSISTABLE_INTENT；原包无效果，fallback 一次 |
| 原提交已经 Committed，但 ai_runs 仍 Ready | 读取并返回原 Receipt；世界状态不新增效果，不执行 fallback |
| 重复 migrate / recover | 无数据改写，无重复收据或效果；全部纯恢复 Gateway 调用数为 0 |

兼容探针固定逻辑时钟，以隔离本次编码/迁移风险，未用它证明真实时间或超时性质。实际数据库仍是 PostgreSQL 18.6。

### 2. 孤立 surrogate 码元跨真实进程退出

分别让新候选的受控故障子进程保存 `{bad` 加 U+D800 和 U+DC00，在 ai-output COMMIT 后实际 process.exit(81)。父进程读到退出码 81、signal=null，再按持久记录恢复。

- 两个原文均精确还原原始码元：55296 和 56320；编码文本与原始 JSON.stringify 值相同。
- 两份 outputStringDigest 不同；原有 UTF-8 摘要不承担这项精确码元身份判断。
- 同原文重复 saveOutput 接受；改为 U+FFFD 替换字符则 ACTION_ID_REUSE，不能覆盖记录。
- 两个 Decision 都保持 Rejected，每个稳定 fallback 恰有一份 Receipt；恢复不新调模型，原文与摘要不变。

### 3. 消费者、损坏编码和关闭

实际执行 captureAI，五条新旧记录导出后都与其原始字符串逐码元相等；同时保留实际存储编码标记。未知编码版本、编码后不是字符串、精确摘要不匹配均被明确拒绝，未静默修复数据。

本轮五次实际受控 provider 调用：原反例三个、故障子进程两个；外部模型调用 0。旧版兼容数据经旧持久 API 构造，没有将其算作实际模型调用。两个探针主进程均退出 0，两个自有 PostgreSQL 集群日志均有正常 shutdown；无遗留执行句柄。

## 源码与累计覆盖

本轮完整读取 12 文件 diff，包括新增 output 模块/迁移/测试、Gateway、Orchestrator、持久化、Runtime、崩溃与取证消费者、原测试适配和说明。全仓搜索 output_raw/output_encoding 的生产读取者，均核对其编码处理；归档历史 captures 保持原本的解码语义。git diff --check 通过，最终工作树无生产修改。

当前远端 PR 文件数 110；等于 R1 的 107 路径加本轮三个新增路径。九个既有路径的修改已在本轮重读。项目 AGENTS/工程/工作流、固定 Spec、协议和 game 在本增量中未改，R1 对未变架构、权限、预算、提交及关闭部分的源码观察仍适用，保留其原证据身份。

没有重新把旧 source-manifest 或作者历史 82/89 项执行结果标成新候选的本轮运行。新候选的本轮结论来自独立反例重放、兼容探针和增量源码审查。

## 证据索引

| ID | kind / status / assessment | 原始材料 |
| --- | --- | --- |
| E-STD-R2-01 | source_inspection / OBSERVED / PASS（12 文件增量） | 本地 git diff、远端 commit/tree、coverage.json、生产读取消费者搜索 |
| E-STD-R2-02 | execution / OBSERVED / PASS（原反例修复） | invalid-output-probe.mjs、invalid-output-probe.log、invalid-output-result.json；退出 0，另对结果全部断言 |
| E-STD-R2-03 | execution / OBSERVED / PASS（真实旧库迁移/恢复/Unknown） | compatibility-probe.mjs、compatibility-probe.log、compatibility-result.json |
| E-STD-R2-04 | execution / OBSERVED / PASS（两个真实退出与码元保真） | compatibility-result.json 中 D800/DC00 退出码 81、空信号、摘要及恢复结果 |
| E-STD-R2-05 | execution / OBSERVED / PASS（读取消费者/损坏拒绝） | compatibility-result.json、captures/review.json；五条导出记录逐码元比对 |
| E-STD-R2-06 | execution / OBSERVED / PASS（资源收束） | postgres/invalid-output-*/postgres.log、postgres/compatibility-*/postgres.log，均正常 shutdown |

## 未覆盖与交接

本轮未重新执行全量后端、协议、内容或 TLC；未验证真实供应商/模型/凭证/费用授权、浏览器、真人体验、双 NPC 策略、完整局、合并或部署。未知编码/损坏数据采用拒绝策略，未验证人工修复数据的流程。没有验证同时混跑旧写入程序的滚动升级或回滚部署；此次检查是旧实例停止后新实例迁移和读取。

标准轴的已确认阻断已经关闭，可将 VERIFIED 连同本固定候选交给总控汇总；是否推进其他阶段仍取决于独立需求轴及本票原有真实模型条件。
