# #11 授权详情与终态复盘：独立需求轴审查

## 结论

**requirements：PASS（限定本次委派范围）**。没有确认的阻断或非阻断 finding，`findings: []`。审查者为 `/root/mock_ui_requirements`，不是实现作者；未读取另一独立上下文的当前标准轴报告。`standards：NOT_RUN`，由总控另行汇总。

本次结论覆盖证据详情、独立 AuthorizedRecap 协议／服务／页面，以及 2 人和 5 人页面技术接合。**不据此释放完整 full-slice-candidate、完成 #11 整票或关闭 #12／父 #2。** 当前候选尚未接合 #10 正式受控双角色策略；页面检查的 NPC 尾段使用正式 Validator 约束下的内部受控意图。

## 固定对象与契约

- work_id：`vs001-p08`；Issue：https://github.com/gbcdby/xiyou/issues/11（读取正文更新时间 2026-11-11T12:13:47Z）。
- candidate：`b221ab89784b197431cf682b0c9036e46bb03932`；tree：`4f330795548d03f93ae38366a98d6ddf162eb97e`。
- base / merge-base：`cf6f880f292d835f1644cd2e8f215fcf8aff512f`。开始及结束工作区均干净；没有业务、测试或远端写入。
- contract：`3690b481d1805f6a7b535584c80a8574c5103d97` / `mock-20261111`，重点为 `docs/specs/vertical-slice-mock.md` §4、§5 相关范围及 Issue 当前有效范围。
- 本地 Spec blob `c5197eb41639d5b4bd2281199a4627d8a734c173` 与 GitHub 固定文件一致。
- 作者历史执行候选为 `7e28d72fbdbfee88df6c5b709e519354b54820fd` / tree `d2af9ea21b827d6bb39ee4793cd99c3fb5526b44`。到本次候选仅新增证据和 README；独立核对 111 个运行输入摘要无差异，31 份归档产物大小及 SHA-256 匹配。原证据保留原身份。

## 需求覆盖

| 要求 | 独立判断与证据 |
| --- | --- |
| 已授权 Observation 详情 | EvidencePanel 展示类别、原文、带类型字段、来源和适用对象。名称仅取当前授权投影；未知 ID 保留稳定引用。分享接收者没有被标成最初发现者。静态核对加真实 DOM 检查通过。 |
| 严格且独立的 DTO | AuthorizedRecap 单独定义并生成；原 AuthorizedProjection、AuthorizedSnapshot、WorldBatch schema 与基线逐项相等。类别、actor null 规则、严格递减序号、100 条上限及尾游标均有运行拒绝检查。 |
| 当前访问资格及历史 audience | readRecap 先认证，在 Session 锁内 access 后才查询 world_events；查询同时限定 session_id、历史 humanCharacterIds 和白名单。真实撤权、陌生账号、跨局、删除及失效身份拒绝；后来到场不追授历史权限。 |
| 终态固定 head、只读分页 | 非终态拒绝，throughSeq 必须等于当前 head。非法／未知／重复参数拒绝；授权过滤在 LIMIT 前，100 条页面之外的第 101 条只判断是否继续，不返回隐藏数量。实际 113 条两页排序稳定，503 保留已读页、原游标重试；数据库状态、logical_time、事件／收据／outbox／决策／ai_runs 不变。 |
| Claim 不提升为事实 | Observation 先按 category 再按 evidence_share 分类。A→C→B 假修复负例中 C 为 Claim/heard_claim、B 为 Claim/received_claim，actor 分别为 C/B，原文不变、safe=false；B 没有原 ClaimRecorded、私聊或旧公开记录。源码和真实 HTTP/浏览器复跑均通过。 |
| 不追溯秘密 | 每类条目逐字段白名单构造；没有查询 source/subject 的隐藏源。Belief、Goal、控制/认证及未列事件排除；不导出 audience、UserId、完整 causedBy、Decision 或内部计划。无类型 subjectId 保留 source/相关引用，不猜对象类型。 |
| 前端代次、取消及兼容 | 独立 RecapClient 绑定账号、角色、Session、view、phase 和 throughSeq；打开新绑定即清空和 abort，旧响应以 serial 拒绝。账号、房间、视图变更及撤权真实复跑通过；分页失败不显示完整，旧服务器无端点时原结局仍可读。 |
| 安全展示与终态操作 | Vue 普通文本插值；HTML 外形文本没有形成元素。陈述、观察、实际行动和接收者／发言者标签清晰；桌面及 390 像素无横向溢出。2/5 人均经真实界面完成查看、拿取、交付、修复、许可和终态只读复盘。 |
| #7 实施义务 | 实际读取固定 `c78066d9b95eb3657293fd26a6a5d8b325846b38` 的 isolation/reconnect/visibility README；对应可信主体、Session 范围、历史受众、合法新观察传播、当前授权／代次与终态可读不可写。此次源码不改变这些语义，负例执行覆盖新增读取边界。未将历史 TLC 结果称作本接口证明。 |

## 本轮执行

环境：Node `v24.22.1`、PostgreSQL `18.6`、Chromium `153.0.8010.0`。所有身份、房间和输入为本次合成数据；数据库、HTTP、Socket.IO、Vue 和浏览器为真实实现。

| 检查 | 结果 | 原始材料 |
| --- | --- | --- |
| 针对性协议／后端／前端 | 12/12，退出码 0，6.015 秒，无失败／跳过 | `focused-tests.log` |
| 真实浏览器 | 15 个具名检查通过、2 张截图，退出码 0，49.505 秒；pageErrors/databaseErrors 均空，全部资源关闭 | `browser/result.json`、`browser-execution.log` |
| 归档与输入完整性 | 31 份产物及 111 个源码／依赖摘要匹配；3 个原 DTO 不变；Spec blob 一致 | `evidence-integrity.json` |

浏览器运行前后候选及 111 个源码摘要一致。检查使用 `output-path-hook.mjs` **仅**将原测试 helper 固定的 PostgreSQL 临时文件路径重定向到本审查目录；不改变测试断言、业务源码、数据库、输入或执行步骤。仓库原 helper 未改。

作者 170 项、构建、生成一致性和独立 JSON Schema 结果未在本轮全量重复执行；保留为 `7e28d72...` 的历史证据，并通过摘要与文档增量核对其适用性。本轮自行运行的结果只按上表陈述。

## 未覆盖与下一步

没有本次窄范围未关闭 finding。完整 #11 / full-slice 仍需接合 #10，并在实际集成候选完成必要增量验收；#12 的四结局合集、五职责有效贡献／120 秒窗口、900000ms 长测及组合故障矩阵未由本次审查执行。TLC 重跑/refinement、真实模型质量、真人体验、公网与部署均未执行；其中真实模型／真人／公网在当前 profile 为 NOT_REQUIRED。

由总控汇总另一个独立标准轴，再按已有用户授权推进相关 PR。不得把本报告的局部 PASS 改写为全部模拟切片完成；实际集成、合并和发布仍分别记录。
