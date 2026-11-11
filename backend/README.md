# PostgreSQL 权威运行层

本目录实现 [Ticket #6](https://github.com/gbcdby/xiyou/issues/6) 的服务端基础，依据固定 Spec `6c2a0b9f6d137ad5fbd41721659404333ad8e16d` 的 [M0 协议](../docs/specs/m0-protocol.md)、[玩法契约](../docs/specs/vertical-slice-gameplay.md)和[验证计划](../docs/specs/vertical-slice-verification.md)。

这是作者实现与自查候选，独立需求／标准审查由总控另行执行。真实 AI、前端联合验收、五客户端 900 秒、两人／五人真人试玩和生产部署没有由本目录宣称完成。本轮五项独立审查修正见 [修正结果](evidence/review-fix-r1/implementation-result.md)及[修正自查清单](evidence/review-fix-r1/self-check.json)，作者状态均为 `FIX_REPORTED`。初始候选 `e32c579` 的 [实现结果](evidence/implementation-result.md)及[自查清单](evidence/self-check.json)保留为历史证据。

## 技术选择与启动

沿用仓库的 Node ESM，使用原生 HTTP、固定 `pg` 8.23.1 和 Socket.IO 4.8.4；不增加框架、微服务或消息中间件。当前检查环境为 Node 24.22.1、真实 PostgreSQL 18.6，完整版本记录见证据。浏览器共用已有机器协议，原始动作和模型输出先进入协议严格解析器。

```sh
# 先按根 package.json 的固定依赖准备环境，再指定已有 PostgreSQL 数据库。
DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/xiyou' npm start
```

默认监听 `127.0.0.1:3000`，可通过 `HOST`、`PORT` 调整。`GET /health` 检查数据库连接。服务启动自动执行 [001-authority.sql](migrations/001-authority.sql)，迁移使用事务和数据库 advisory lock，不删除现有数据。未来结构升级应添加有序迁移，而非把升级逻辑藏在请求中。

退出时处理 SIGINT／SIGTERM，停止维护、关闭 Socket.IO、等待已接纳任务结束，再关闭连接池。业务库不可用时不会切换到内存世界。原型登录是随机 Bearer token，数据库只保存 token 的 SHA-256；生产账号运营不在 #6 范围。

```sh
npm run test:backend
npm run test:protocol
npm run test:content
node protocol/scripts/generate.mjs --check
node content/scripts/generate.mjs --check
python3 protocol/scripts/check-schema.py
python3 content/scripts/check-schema.py
```

后端检查使用 [真实 PostgreSQL 辅助环境](test-support/README.md)，每次新建独立集群，由检查进程在结束时关闭。测试脚本的 `--expose-gc` 只用于四个断线句柄的生命周期回归，生产启动不启用该标志。测试中的可控时钟和故障回调仅通过可信构造参数注入，没有 HTTP、Socket.IO 或模型工具后门。

## 模块与持久边界

| 模块 | 职责 |
| --- | --- |
| [runtime.mjs](runtime.mjs) | Session 行锁、当前授权、生命周期、控制、Receipt、同步与 outbox |
| [decisions.mjs](decisions.mjs) | 持久 Decision、generation／epoch／版本／期限围栏、原子意图包和等待 fallback |
| [server.mjs](server.mjs) | 原生 HTTP 和真实 Socket.IO 连接适配，不接受客户端构造连接身份 |
| [main.mjs](main.mjs) | 进程运行和关闭入口 |
| [world.mjs](../game/world.mjs) | 固定 `world-v1` 的纯事件 reducer、开局装配和观察登记 |
| [rules.mjs](../game/rules.mjs) | 当前对象／版本校验、内容操作、陈述与证据、结局事实 |
| [projection.mjs](../game/projection.mjs) | 当前可见状态、合法历史知识和不同主体的过滤视图 |
| [records.mjs](../game/records.mjs) | 只读取自有领域记录，保留合法同名 ID，排除对象原型属性 |

`sessions` 保存当前世界、初始状态、连续事务计数、完整内容快照、内容摘要和 reducer 版本。`world_events` 保存不可变事件；`action_receipts` 以 `(session_id, principal_id, client_action_id)` 唯一去重；`outbox` 只引用已提交区间。`decisions`、控制 nonce、成员访问权限和连接租约分别保存运行记录。

所有世界写入和 Session 运行记录修改都经过 `AuthorityRuntime.locked` 的 `SELECT ... FOR UPDATE`。认证在进入前检查，取得锁后再读当前认证与成员权限。创建尚不存在的 Session 时，先锁可信账号行，并以创建 nonce 去重；创建记录保留唯一 Session ID，删除后不会复用。

事务顺序为：当前读取权限 → 已知 Receipt → 截止时间 → 当前控制／领域条件 → 候选事件与 reducer → 状态、事件、Receipt、outbox → COMMIT。序号由行内计数在事务中分配，不使用 `serial` 或 PostgreSQL sequence。失败的工具包丢弃全部候选事件，拒绝只保存 Receipt；截止系统事件是允许推进 observedSeq 的例外，拒绝动作范围仍为空。

COMMIT、ACK 和发布是独立阶段。提交阶段结果未知时保留原动作身份，并在当前读权复核后查询原键、比较本次原始语义摘要；异载荷仍返回 `ACTION_ID_REUSE`，不覆盖旧 Receipt。查询仍未知则返回 `OUTCOME_UNKNOWN`，不伪造拒绝，也不自动生成新 ID。真人、内部意图和 fallback 共用这个恢复边界。outbox 发布失败保持可恢复；发送完成标记不能代替客户端游标。该服务不承诺网络恰好一次送达。

本局逻辑时间保存在 `sessions.logical_time`，取服务端时钟与已记录时间的最大值。只读快照和已知收据不触发截止；所有新的 Session 命令、控制、调度及收束操作先处理已到期终局。世界事件携带已决定的 UTC 时间，回放不会重新读取时钟。正常终局在原动作事务内追加最后一条 `session.finished`，其因果和 Receipt 区间涵盖最后事件；终局撤销全部控制、取消其余 Pending，之后只能读取旧世界与维护运行记录。

## HTTP 契约

除访客登录外，使用 `Authorization: Bearer ...`。请求为严格 UTF-8 JSON，拒绝重复键、未知字段与超过 64 KiB 的外部输入。接口没有连接 ID header。

| 方法与路径 | 请求 | 成功响应 |
| --- | --- | --- |
| `POST /api/auth/guest` | `{name}` | `{token,userId,name}` |
| `GET /api/sessions` | 无 | `[{sessionId,name,playerCount,phase}]` |
| `POST /api/sessions` | `{nonce,contentVersion}` | `{sessionId}` |
| `POST /api/sessions/:id/join` | `{nonce}` | `{sessionId,actorId}`；房主重复加入保持原角色 |
| `POST /api/sessions/:id/start` | `{nonce}` | `{sessionId}`；仅房主，固定 2–5 人装配 |
| `POST /api/sessions/:id/cancel` | `{nonce}` | `{sessionId}`；仅房主取消 Lobby |
| `GET /api/sessions/:id` | 无 | `AuthorizedSnapshot`，始终 `canControl=false` |
| `GET /api/sessions/:id/actions/:actionId` | 无 | 本人 `ClientReceipt`；尚无记录为 404／`OUTCOME_UNKNOWN` |

错误正文统一是协议 `ErrorResponse`。非法输入为 400，认证失败为 401，当前无权为 403，冲突／重同步为 409，未知事务结果为 503。不存在或已删除的 Session 统一为 **410／`SESSION_GONE`**，与“当前尚无 Receipt”的 404 区分。领域动作的确定拒绝使用持久 `ClientReceipt`，不会把其结果码塞进不兼容的 `ErrorResponse`。

公开错误消息修复不完整 Unicode 代理对，并按码点限制在 500 字以内；转换后的 DTO 再经共享 Schema 校验。长未知字段名仍是确定的 `INVALID_MESSAGE`，不会因为错误正文超长再次破坏响应。

`revokeAccess`、`abortSession`、`archiveSession`、`deleteSession` 是可信运维模块入口，没有暴露为玩家或模型接口。归档保留事件和收据；删除后的原 ID 请求返回 `SESSION_GONE`。

## Socket.IO、控制与同步

默认路径 `/socket.io`，握手 `auth: {token}`。握手失败的 `ErrorResponse` 放在 `connect_error.data`。ACK 直接返回 DTO 或 `ErrorResponse`，没有额外 `data` 包装。

| 事件 | 请求格式 | 响应 |
| --- | --- | --- |
| `session.subscribe` | 对象 `{sessionId}` | 服务端生成 viewId 的授权快照 |
| `player.action.request` | 原始 `ClientAction` JSON 字符串 | `ClientReceipt` 或 `ErrorResponse` |
| `sync.request` | 原始 `SyncRequest` JSON 字符串 | `WorldBatch` 或 `ErrorResponse` |
| `control.resume` / `control.take` | 原始 `ControlRequest` JSON 字符串，type 与事件名称相同 | `ControlResponse` 或 `ErrorResponse` |
| `world.batch` | 服务端推送 | 同一 Session／view 的完整区间 |

服务端在真实连接建立时创建不可伪造的本地句柄。新连接只读；resume 遇另一活动控制连接返回 `CONTROL_HELD`，显式 take 才替换。控制 nonce 持久保存且不把 connectionId 纳入重新授权键；重复 nonce 只返回旧响应。服务端断开代次取自已提交控制事件，不能被旧 nonce 响应回退。旧连接的迟到断开不能撤销新绑定。

控制事务 COMMIT 后的副作用还要短暂重取 Session 行锁，按当前数据库中的角色、连接和 epoch 更新本地绑定，撤销时同时限定原 viewId。该复核在 `afterCommit` 故障／暂停钩子返回后执行，钩子期间不持有 Session 锁；后续接管可以正常完成，旧回调不能断开再次获权的连接或回退当前视图代次。

离线检测后进入固定内容中的 30 秒 Grace，再进入受限 proxy；重连交还推进 epoch 并取消旧决策。真实断开立即处理；进程异常消失时由 60 秒连接租约检测，维护器每秒检查。租约是传输存活信息，不能单独授予角色写权。数据库中的 mode、epoch、活动连接和当前访问权须同时匹配。

视图绑定只由服务端创建。控制成功保留当前连接已有 view，使前端可直接 sync；被替换连接的旧订阅停止。身份撤销同样停止旧订阅。每批覆盖至多 256 个**全局**序号，返回的 `projection.replace` 对应那个确切前缀；全隐藏区间允许 `events: []` 并推进 throughSeq。未来游标、错误 view 或旧绑定要求重新同步。

断线、撤权、订阅替换和 Session 删除会从活动 Map 中删除相应视图；旧在途任务只持有已停用的对象，不能删除或撤销同连接的新订阅。终局仍保留当前合法只读订阅，直到该订阅自身结束，以便读取结果和历史。

快照与批次不携带内部受众、UserId、凭据、他人信念或完整内容。历史 Observation／Claim 使用发生时保存的受众，离开区域保留合法知识，后来进入区域不会补发旧私聊。当前可见物品随区域变化增删。jsonb 会重排对象键，投影数组使用稳定顺序，避免重放前缀与当前行产生伪差异。

## 内容、物品与结局

创建时固定完整内容快照和摘要；开局只调用一次 `assemblePlayers`。组合职责绑定一个 CharacterId，首项决定唯一出生区域，能力与知识取并集。初始知识实际生成 `ObservationRecorded`，初始 NPC 信念另生成 `BeliefUpdated`。

物品有唯一位置和独立版本。拿取、转交、使用都校验真实位置／持有者／可见性／版本；修复按内容中的物品种类、能力、目标前置值和消耗规则处理。无关旧 baseSeq 可用，未来 baseSeq 拒绝；隐藏与不存在目标统一 `TARGET_UNAVAILABLE`，可见版本冲突为 `STALE_PRECONDITION`。工具使用推进版本但不消耗；材料只有一次真实消耗。

`speak` / `make_claim` 产生 Claim 和有资格接收者的 Claim 类 Observation，不修复结构或改变责任事实。`share_evidence.evidenceId` 使用本人已登记且可传播的 `Observation.observationId`，新传播生成新事件并保留来源。重复传播同一来源不能补齐另一来源。

结局读取实际修复材料、安全和许可、两位 NPC 的实际位置及已合法取得的独立证据来源。原材料与完整双证据链产生查证通行；备用材料或调查未齐产生带代价通行；截止产生未解决。结束摘要只公开必要的结果事实，不复制私聊、完整信念或未公开配置。

## 后续 #9 的可信内部接口

`bindInternal(sessionId, actorId, 'core_npc' | 'proxy')` 只能由可信服务代码领取绑定句柄；客户端不能提交 principalKind。`observeInternal(handle)` 返回过滤后的投影、本角色信念和目标。代理视图剔除真人私人频道。

内部写入只开放 **prepareDecision → submitIntent**，没有绕过 Decision 的裸 NPC／proxy 动作入口：

1. `prepareDecision(handle, {allowedTools?, observationIds?, readEntityIds?})` 在 Session 锁内保存固定 epoch、递增 generation、合法 Observation 引用、对象版本和默认 10 秒期限，取消旧 Pending。读取对象用 `item:ID`、`target:ID`、`character:ID`、`belief:持有者ID:信念ID` 或 `goal:持有者ID:目标ID`。
2. 调用方在事务外请求未来的 Model Gateway。本票没有供应商 SDK、模型调用或伪造 AI 运行结论。
3. `submitIntent(handle, decisionId, rawJson)` 解析完整 ProposedIntent，并使用固定 `decisionId:submit` 及整包摘要。批首比较可信读版本，再按序模拟工具；后续工具失败时全部工具和对白回滚。相关版本、generation、epoch、期限、当前授权和终局在提交时复核。
4. `settleDecision` 收束非法输出、取消或超时；定时维护也会使到期 Pending 变为 Expired。`submitFallback(handle, decisionId)` 使用独立稳定键 `decisionId:fallback`，仅执行受限等待，仍检查当前授权、epoch 和终局。是否调度下一次模型调用由 #9 负责。

候选 beliefUpdates 只能引用该 Decision 授权且本角色已登记的 Observation，只产生 Belief 事件，不能写世界事实。代理工具仅允许安全移动、观察、公开问询和等待；公开问询采用以问号结尾的公开 speak。该结构约束不证明自然语言真假。代理不能使用私人频道、转移／消耗物品、展示私人材料或执行最终许可。

`replay(sessionId, throughSeq?)` 是可信诊断接口，不提供给玩家。它使用本局初始状态、保存的内容快照和固定 reducer，从连续持久事件重建指定前缀，不取新时间、随机数、模型输出或触发 outbox。运行记录如逻辑时间、连接租约和 Decision 处理状态不冒充可由 WorldEvent 回放的世界事实。

## 已固定的实现依据

- 协议释放候选：`5067542eede979ffdf59e016e3103aec663dc6d8`。
- 核心模型释放候选：`31766d6c0166cc61c49578dc353514292dfacc5e`；消费其中 Session 锁、原子包、控制、截止优先及动作终局义务。
- 隔离／恢复模型：`38d891579330be990cc44a51230d2ded81076dd1` 对应的固定目录内容；消费当前授权、Session 范围、历史受众和完整区间义务。
- 内容装配基线：`b0405af1bd955a933e762dd062cc7647a39ab2b3`，另接入 `7e04e4ad94b7f409318b0bc35847fa98cf0208e6` 的组合协议上限检查；现有 fixture 与摘要不变。

本目录的作者自查没有重跑或替代模型的独立审查，也没有复制或发布受阻的模型原始日志。义务与本次真实运行检查的对应见实现结果。吞吐量、长时间运行、前端新候选集成和真人体验仍须由后续对应 Ticket 取证。
