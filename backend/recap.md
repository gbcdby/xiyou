# 终态授权过程读取 · #11

依据 [VS-001 模拟输入修订 §4](../docs/specs/vertical-slice-mock.md)，本模块提供独立只读复盘。它消费已提交事件，不触发模型、世界动作、Decision、Receipt 或 outbox；`AuthorizedProjection`、`AuthorizedSnapshot`、`WorldBatch` 及其 reducer 保持原契约。

## 入口与水位

`GET /api/sessions/:sessionId/recap?throughSeq=<DecimalString>[&beforeSeq=<PositiveDecimalString>]`

身份沿用 `Authorization: Bearer <token>`。返回独立严格 `AuthorizedRecap`，其 `RecapEntry` 和 `RecapReference` 类型由 `protocol/schema.mjs` 统一生成。运行层入口为 `runtime.recap(token, sessionId, { throughSeq, beforeSeq? })`；前端入口为 `HttpApi.recap(sessionId, throughSeq, beforeSeq?, signal?)`。

| 输入或状态 | 行为 |
| --- | --- |
| 当前账号、Session 和成员资格 | 在读取历史前调用既有认证及 `access`；角色取自受信成员记录 |
| `Finished` / `Aborted` | 允许读取；终止单独标记，不当作自然结局 |
| `Lobby` / `Running` | `FORBIDDEN`，解释当前阶段不可读取 |
| `throughSeq` | 必须等于该局当前已提交 head；不符为 `RESYNC_REQUIRED` |
| `beforeSeq` | 省略为首请求；若提供，须为 `1..throughSeq` 内的无前导零正十进制字符串 |
| 重复、未知或非法参数 | `INVALID_MESSAGE`；不宽松忽略未知参数 |
| 当前撤权、跨局或失效身份 | 沿用 `FORBIDDEN` / `UNAUTHENTICATED`；Session 删除为 `SESSION_GONE` |

`readRecap` 在已有 Session 锁内重查当前资格、终态和固定水位，再按 `session_id`、事件序号、白名单种类及发生时的 `audience.humanCharacterIds` 查询历史。每页最多 100 条**授权条目**，查询第 101 条授权记录仅用于判断是否还有下一页。返回游标是本页最后一条的序号，不返回隐藏记录计数。所有页按序号严格递减，保持原全局序号空隙；空隙不解释为隐藏事件类型。

该读取不调用 `deadline` 或 `emit`，事务中的 `events` 始终为空、`clockTouched` 为 false。既有 `persist` 不产生任何更新。测试对比读取前后的 state、logical_time、world_events、action_receipts、outbox、decisions 和 ai_runs，另核对持久回放未变。

## 白名单与语义

`projectEvent` 逐字段构造新对象，不直接传递原事件 payload。只有设计列明的 Observation、Claim、移动、拿取、交付、使用、目标变化及终局事件进入列表。内部受众、完整 causedBy、UserId、token、连接标识、Decision、信念和 AI 上下文均不输出。

| 记录 | 复盘含义 |
| --- | --- |
| Claim 型 Observation，普通来源 | `Claim / heard_claim`，actor 是记录接收者 |
| Claim 型 Observation，共享副本 | `Claim / received_claim`，actor 是新接收者；保留原文，不要求原 Claim 事件也可见 |
| Evidence / WorldFact 型 Observation | `Observation / observed` 或 `received_evidence`，actor 是取得该观察的角色 |
| ClaimRecorded | `Claim / said`；仅这里的 actor 表示发言者 |
| item.used | 使用事实；只有 `consumed=true` 才显示已消耗 |
| target.updated、终局事件 | actor 为 null；不为补叙事而导出内部因果主体 |

Observation 的 `subjectId` 本身没有公开实体类型。本实现把它保留为 `RecapReference { kind: "source", id: subjectId }`，不从完整世界或 content 反查类型；复盘界面统一将此类引用标为**相关引用**。原 `source.sourceIds` 按已有值保留，明确为 speech 的来源可标为 claim 引用。该映射不增加独立来源数，也不猜测原发现者、分享者或发言者。证据卡直接消费原 Observation，仍分别显示**适用对象**与**来源引用**，不会把 `subjectId` 混称成来源。

显示名称只解析当前已授权投影中的人物、物品、目标和区域；未知时显示稳定 ID。引用不是展开隐藏事件的链接。所有陈述、字段和引用使用 Vue 普通文本插值，不解释为 HTML。

## 前端读取生命周期

终局聚合结算仍由 `AuthorizedProjection.ending` 决定；过程列表拥有独立的 `RecapClient`。只有取得在线终态授权投影后，`SessionPage` 才使用当前 snapshotSeq 发起读取。绑定键包含账号、token、Session、actor、viewId、phase 和 throughSeq；账号、房间、视图或访问状态变化时同步清空列表并取消旧请求。序列代次及 AbortSignal 双重阻止旧响应和旧错误填回。

分页失败保留已经读取的页，明确标记未完成，重试使用原 throughSeq 和 beforeSeq。客户端核对每页身份、水位、类别关系和跨页顺序；不把重复条目追加进列表。旧服务返回缺端点错误时，过程区显示不可用，原结局继续可读。复盘数据不进入世界投影 reducer，也不改变动作收据。

## #7 义务的源码对应

本次实际读取并对照的固定模型来源是 `c78066d9b95eb3657293fd26a6a5d8b325846b38`，相关义务分别位于 [isolation](https://github.com/gbcdby/xiyou/blob/c78066d9b95eb3657293fd26a6a5d8b325846b38/formal/boundary/isolation/README.md)、[reconnect](https://github.com/gbcdby/xiyou/blob/c78066d9b95eb3657293fd26a6a5d8b325846b38/formal/boundary/reconnect/README.md)、[visibility](https://github.com/gbcdby/xiyou/blob/c78066d9b95eb3657293fd26a6a5d8b325846b38/formal/boundary/visibility/README.md)。对应 README blob 分别为 `a6bfec711187df18b2686318cc02606be09aba60`、`7cf13753d73c3f56348c3b57312cd6ea68a28aa8`、`b163a8e7fbddd0c9188b62b73cd60e11aa1a69c8`。这只是实施义务来源，不将原模型结果改称新增接口的证明。

| 既有义务 | 本次源码对应 | 真实负向检查 |
| --- | --- | --- |
| 可信 Session / 主体与当前权限 | `recap.mjs: readRecap` 先认证，在 `runtime.locked` 内调用 `access`，SQL 明确带 session_id；不接收 actor 参数 | 跨局、陌生账号、撤权、失效 token 和 Session 删除拒绝 |
| 历史受众固定，不按当前区域追授 | SQL 要求事件原 `humanCharacterIds` 包含当前角色；共享副本是已提交的新 Observation | B 后来到场，看不到先前公开说法、A→C 原定向 Claim 与私聊；能看合法分享副本 |
| 服务端过滤，DTO 不携带秘密 | `projectEvent` 字段白名单及严格独立契约；不跟随 source/subject 查询 | 检查响应不含内部受众、主体、连接、决策、信念、causedBy 或 token 字段 |
| 合法传播与事实 / 陈述分离 | 先判 Observation.category，再判分享来源；不消费 BeliefUpdated 或 GoalUpdated | A→C→B 假“通路已修好”保持 Claim、actor 为 C/B，safe 仍为 false，无修复 WorldFact |
| 身份与视图代次绑定 | `SessionPage` 绑定当前授权快照；`RecapClient.open` 清空、取消并递增代次 | 账号 / 房间 / view / 撤权单元检查；实际浏览器断连、换房与迟到回包 |
| 同一权威前缀 | 终态内 head 等值检查；所有页共用 throughSeq；严格递减游标 | 授权记录超过一页，隐藏记录不占页，重取稳定、无重叠；旧水位拒绝 |
| 终态可读不可写 | 读取无事件、无 deadline 更新；原世界动作终态围栏不变 | 数据库计数、持久状态和回放读前读后相同；页面终态动作停用 |

没有修改 #7 的权限语义、传播规则、同步区间、世界 reducer 或终态写规则；这里只增加遵守这些约束的独立终态读取。新增接口的依据是上述源码映射和实际 API / 浏览器负例，本次没有运行新的 TLC、refinement 或完整形式化证明。

## 检查入口与范围

```sh
node --test protocol/tests/recap.test.mjs
node --test backend/tests/recap.test.mjs
node --test frontend/tests/recap-client.test.mjs
node frontend/tests/recap-browser-check.mjs
```

浏览器脚本需要根目录和前端依赖、Playwright 与 Chromium。可用 `PLAYWRIGHT_MODULE`、`CHROMIUM_PATH` / `CHROMIUM_PACKAGE` 指定已安装工具，`FRONTEND_EVIDENCE_DIR` 指定临时输出。脚本启动真实临时 PostgreSQL、权威服务、Vue 开发服务器和独立浏览器上下文；资源在结束时关闭，输出只含合成账号与场景的必要摘要和截图，不写 token 或数据库连接参数。

2 人 / 5 人页面链通过合法人类动作完成观察、拿取、交付、修复、许可；NPC 的结尾移动使用 `bindInternal → prepareDecision → submitIntent`，仍受正式校验器及结局规则约束。它限定检查 #11 页面链，不替代 #10 受控角色策略、#12 四结局与五人贡献、同候选 900 秒或真人 / 真实模型验收。故障注入仅用于分页 503、旧服务缺端点及实际服务回包延迟；不伪造成功动作、Receipt、世界事件或结局。
