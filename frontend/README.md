# 同行前端 · 联机界面与授权复盘

ADV-001 [#33](https://github.com/gbcdby/xiyou/issues/33) 新增独立的 `spatial-v2` 灰盒入口，接口、恢复和已确认轨迹表现见[空间客户端说明](spatial.md)。原 `region-v1` 页面、房间与下面的历史证据继续保留；灰盒不代表高老庄完整章或正式视觉已通过。

本目录提供 Vue 3 / TypeScript / Vue Router 的房间界面、授权投影视图、HTTP / Socket.IO 客户端以及恢复驱动。已接入 #6 权威运行服务；本轮以合成玩家身份执行实际 PostgreSQL、HTTP、Socket.IO 与浏览器代码。用户在 2026-11-11 明确本批使用 mock 输入；当前同候选完整玩法、五身份长测、浏览器检查与独立审查见[整体验证记录](evidence/mock-integration-20261111/README.md)。

原候选与后续控制状态提示修正已完成独立需求、标准两轴复审；相关 finding 的历史结论为 VERIFIED。原[审查修正自查](evidence/review-fix-self-check.md)与[初始阶段自查](evidence/stage-self-check.md)保留其实际候选和范围。当前新增的 47 项行为检查、构建及实际服务浏览器短检见[模拟输入联机短检](evidence/mock-shell-20261111/README.md)。它们不冒充新同候选的 900 秒、双 NPC 或完整局验收。

#11 在此基础上加入证据结构化详情、严格独立的终态授权过程列表及其分页 / 权限生命周期。接口、语义与 #7 义务映射见[授权复盘实现说明](../backend/recap.md)，固定候选的 170 项协议／前后端检查、15 项实际浏览器检查及保留失败见[本轮作者自查](evidence/mock-recap-20261111/README.md)。新实现及作者自查与上述 #8 历史结果分开，独立审查和最终集成结论由总控维护。

## 运行与检查

需要 Node.js 24 或更高版本。本轮实际使用 Node.js 24.22.1。前端单元检查、类型检查与构建的依赖固定在本目录的 `package.json` 和 `package-lock.json`。连接实际服务的 `real-browser-check.mjs` 还使用根目录的后端和临时 PostgreSQL 依赖，运行前须在仓库根目录执行 `npm ci`，并在前端目录执行 `npm ci`。

```sh
cd frontend
npm ci
npm test
npm run build
npm run dev
```

开发服务器默认仅监听本机。`/api` 和 `/socket.io` 代理到本机 `3000` 端口；已有权威服务的 `DATABASE_URL` 用法见[后端启动说明](../backend/README.md#技术选择与启动)。运行本轮双 NPC 模拟切片时在根目录使用 `npm run start:mock`，策略和预算见[模拟策略说明](../backend/ai/mock.md)；`npm start` 只启动权威服务。部署入口及正式代理尚未配置。`npm run build` 先执行 `vue-tsc --noEmit`，再生成静态产物，不发布或部署。

默认入口 `/` 请求真实 HTTP 服务。`/sessions/:sessionId` 通过真实 Socket.IO 订阅当前账号的授权视图。没有服务、身份失效或尚未取得合法快照时，页面明确显示未连接或不可访问，不生成房间、动作成功或世界变化。

`/demo` 是独立的静态界面演示：只使用手写且通过公开契约校验的授权 DTO，醒目标注“无真实联机”，所有世界动作停用。演示数据的 `contentVersion` 是 `ui-demo-v1`，不作为实际内容或玩法验收材料。

大厅默认创建 `spatial-graybox-v2` 行走灰盒，可用公开配置 `VITE_SPATIAL_CONTENT_VERSION` 指定对应空间内容版本；选择“山间通路·旧版玩法”仍使用 `trust-repair-fixture-v1`，由 `VITE_CONTENT_VERSION` 替换。前端不导入完整 `content` 配置、服务端状态、内部受众或 NPC 信念。

### 浏览器检查

`npm run test:browser` 使用安装环境中的 Playwright。可用 `PLAYWRIGHT_MODULE` 指定该模块的绝对入口，用 `CHROMIUM_PATH` 指定既有 Chromium，用 `CHROMIUM_ARGS` 提供该二进制所需的启动参数（字符串数组的 JSON），用 `FRONTEND_URL` 指定已运行的开发服务器。默认目标是本机 `5176` 端口，开发服务器可用 `npm run dev -- --port 5176 --strictPort` 启动。

该脚本包括桌面 / 390 像素窄屏截图、横向溢出检查、断网后的诚实失败反馈、静态演示动作停用，以及组件夹具中的接收者选择、物品交付和移动事件。另用受控 HTTP 响应验证明确身份失效后清凭据、恢复真实登录表单、由用户显式创建新访客；此响应替身不是运行服务。浏览器输出遵循项目的临时产物规则。`tests/browser-fixture.html` 仅是开发期验证入口，生产构建只包含 `index.html`。

历史完整浏览器脚本的 10 条限定检查通过，具体候选与范围见[修正自查](evidence/review-fix-self-check.md)和[浏览器结果摘要](evidence/browser-check-summary.json)。原环境阻塞保留在[历史阶段自查](evidence/stage-self-check.md)，不改写为本次执行。

本轮另执行 `node tests/real-browser-check.mjs`（在仓库根目录时为 `node frontend/tests/real-browser-check.mjs`），连接实际权威服务、临时 PostgreSQL 与 Socket.IO。合成身份完成登录、创建、加入、开始、控制、移动、受许可限制出口的真实拒绝、定向陈述和查看；桌面 1440×1000、窄屏 390×844 均无横向溢出。6 项具名检查通过，页面与数据库错误为空，资源已关闭；[新结果](evidence/mock-shell-20261111/result.json)与 105 项源码输入摘要绑定同一次 7.192 秒短检。

## 页面与职责

| 路径 / 模块 | 当前行为 |
| --- | --- |
| 房间大厅 | 访客称呼、创建、加入、真实房间列表及不可达服务反馈 |
| 等待大厅 | 最多 5 个席位，2–5 人的开始入口；开局结果以服务器投影为准 |
| 自身身份与团队 | 自己的职责、控制模式，当前授权的同行者和连接状态 |
| 场所与持物 | 只展示授权视图中的场所、目标、物品与可用操作；发出动作不提前改变位置或所有权 |
| 证据与对话 | 明确区分实际观察、证据记录和陈述；定向 / 私人频道要求选择接收者 |
| 控制入口 | 先取得真实连接的快照，再请求恢复；显式点击接管才发送 `control.take` |
| 动作结果 | 等待确认、结果未知、已提交同步中、已确认以及拒绝分别显示；未知可查询或原样重试 |
| 证据详情 | 原文、有类型的 fields、适用对象、当前接收者及来源引用；共享副本不被标成独立发现 |
| 回顾 | 保留 `AuthorizedProjection.ending`，另按当前资格和历史受众读取授权过程；陈述与已发生行动分类，终态停用新动作 |

客户端保留自己的待确认动作原文到标签页 `sessionStorage`，以登录用户和 Session 隔离。刷新后重新取得授权，再查询原动作；不会把缓存当作授权依据。只缓存待确认的原始请求，不缓存授权投影。浏览器不允许保存时提示保留当前页面，未取得收据前不要刷新。

HTTP 或 Socket 明确返回 `UNAUTHENTICATED` 时，身份层停止旧会话、清空授权视图并移除当前失效凭据，显示返回大厅重新登录的入口。待确认动作仍留在原用户 / Session 作用域。重新登录会创建新访客，不能取回原身份的房间成员资格或动作；页面对此明确提示。单房间 `FORBIDDEN` / `SESSION_GONE` 不会清除账号身份，普通网络故障也不会触发登出。迟到的旧 token 错误不能清除已登录的新身份。

## 与运行服务约定的最小接口

这些接口已与 #6 实现接合；上述新短检执行了实际服务链路，覆盖范围以具名结果为准。

| HTTP 路径 | 输入 | 客户端期望 |
| --- | --- | --- |
| `POST /api/auth/guest` | `{name}` | `{token,userId,name}` |
| `GET /api/sessions` | 登录 token（如已有） | `[{sessionId,name,playerCount,phase}]` |
| `POST /api/sessions` | `{nonce,contentVersion}` | `{sessionId}` |
| `POST /api/sessions/:id/join` | `{nonce}` | `{sessionId,actorId}`；原成员重复加入保持原角色 |
| `POST /api/sessions/:id/start` | `{nonce}` | JSON 响应；实际 Running 状态仍须由授权流确认 |
| `GET /api/sessions/:id` | 登录 token | 只读 `AuthorizedSnapshot`；不授予客户端连接控制 |
| `GET /api/sessions/:id/recap?throughSeq=…[&beforeSeq=…]` | 登录 token，当前终态快照 cursor，可选上一页游标 | 严格 `AuthorizedRecap`；每页最多 100 条授权记录，固定水位递减，不改变世界投影 |
| `GET /api/sessions/:id/actions/:actionId` | 登录 token | `ClientReceipt`；无确定收据的 404 保持未知，明确的契约失效错误继续传给恢复驱动 |

Socket.IO 使用默认 `/socket.io` 路径和 `auth: {token}`。服务端从真实 Socket 获得连接身份；客户端不通过 header 或动作载荷声明 `connectionId`。

| Socket.IO 事件 | 载荷 | 响应 / 推送 |
| --- | --- | --- |
| `session.subscribe` | `{sessionId}`，不提供任意 `viewId` | 当前连接的 `AuthorizedSnapshot` 或契约错误 |
| `player.action.request` | 原始 JSON string | `ClientReceipt` 或契约错误 |
| `sync.request` | 原始 JSON string | 覆盖完整区间的 `WorldBatch` 或契约错误 |
| `control.resume` / `control.take` | 原始 JSON string | `ControlResponse` 或契约错误 |
| `world.batch` | 服务端推送 | 同一个 Session / view 的授权批次 |

握手认证失败如附带契约错误，适配器从 Socket.IO 的 `connect_error.data` 读取。`share_evidence.evidenceId` 取自当前用户可传播的 `Observation.observationId`，不把内部来源 ID 当成可任意传播的证据。修改协议含义应回到相应 Spec。

### 终态授权过程

`RecapClient` 独立于世界 reducer 和动作收据。页面只在收到当前在线终态投影后请求过程；账号、房间、viewId 或授权状态变化时清空并取消，迟到回包不能写入新代次。分页失败保留已有条目并提供重试，不把缺页标作完整。旧服务器没有该端点时，列表显示暂不可用，原结局仍可查看。

陈述分为“说过”“听到／获知陈述”“收到分享的陈述”，后两者的 actor 显示为接收者。对象名称只来自当前已授权投影。无公开类型的 subjectId 在复盘 DTO 中保留为普通 source 引用，界面标“相关引用”；证据卡保留“适用对象”与“来源引用”的原有区分。没有源事件读取入口，不追授原私密观察者或发言者身份，也不从文本推导信念或履约。

`node frontend/tests/recap-browser-check.mjs` 在仓库根目录运行实际 PostgreSQL / HTTP / Socket.IO / Vue / Chromium 检查。它包含 2 人与 5 人页面操作链、A→C→B 假陈述、合法证据共享、历史受众、权限负例、超过一页、分页故障 / 重试和旧请求隔离。NPC 结尾使用合法受控意图，仅检查本功能，不代替 #10 策略或 #12 整局验收。复现工具环境变量与证据范围见[实现说明](../backend/recap.md#检查入口与范围)。

## 恢复与动作语义

依据[已发布 M0 协议](../docs/specs/m0-protocol.md)和 #7 已释放的 reconnect 模型义务实现：

1. 每条物理连接和每次视图换绑都产生新代次。断线、权限撤销和 `RESYNC_REQUIRED` 清空旧投影；旧代快照、事件与回包不能填回新视图。
2. 首次订阅 / 握手遇到普通传输故障或 `OUTCOME_UNKNOWN` / `RESYNC_REQUIRED` 时，每个恢复延迟窗口只保留一个重连任务，默认延迟 1 秒；结束、换房和授权终止会使旧任务失效。订阅快照后立即补发，再以 1.5 秒周期补发兜底最后一个丢失批次。单轮最多 8 页，同一连接上合并并发补发请求。
3. 只有 `fromExclusive == cursor` 才原子应用整批效果和游标。整批重复忽略；未来 / 重叠区间丢弃后从当前游标重取；空的完整区间也推进游标。游标使用十进制字符串比较，不转为 JavaScript Number。
4. 投影替换可以移除旧可见字段。批次内任一效果无效时整批回滚，不留下前半段状态。客户端校验不替代服务端在事件发生时固定受众并过滤快照 / 流。
5. 动作创建时固定 `clientActionId`、`controlEpoch`、`baseSeq` 和完整原文。重连或取得新控制代次后仍原样重试旧动作。只有明确的新动作才生成新的动作身份。
6. 超时与无确定收据的 404 仍是结果未知；404 正文若是合法 `SESSION_GONE`、`UNAUTHENTICATED`、`FORBIDDEN` 等契约错误，保留其确定语义。访问失效立即停止旧授权，原动作结果仍未知，不伪造 Rejected。收据须匹配 Session、角色、动作身份和语义摘要；不直接修改世界投影。迟到的空查询不能覆盖已取得的终态收据。
7. 控制请求超时只在同一物理连接复用 nonce 和原文；新连接使用新 nonce。`CONTROL_HELD` 不会触发自动接管。已明确拒绝后的下一次用户尝试创建新的控制 nonce。
8. `Finished` / `Aborted` 视图可读，旧收据可查，不允许新的世界动作；终态之后的新批次要求重新核对授权快照。

`domain/` 不依赖 Vue。`network/` 管理真实传输与异步结果，`state/` 是轻量 Vue 状态桥接，`features/` 仅消费授权 DTO 并产生动作意图。

## 视觉与依赖选择

布局沿用[UI 共性指南](../docs/design-direction/guidelines/ui-and-ux.md)与[色光指南](../docs/design-direction/guidelines/color-and-light.md)：纸色浅底、青绿色动作与状态、暖色提示，使用稳定阅读承托面和明确焦点。CSS 几何山形与 SVG 图标的 `asset_source` 为 `original_team`，属于本阶段原创界面占位，不是最终场景美术、参考图复刻或已批准视觉稿。

准备环境中的 TypeScript 7.0.2 与 `vue-tsc` 3.3.14 实际运行时出现 `ERR_PACKAGE_PATH_NOT_EXPORTED`，因为缺少其需要的 `typescript/lib/tsc` 入口。前端独立固定 TypeScript 6.0.3，保留同一协议类型并实际通过 SFC 类型检查。选择与 [TypeScript 7 官方发布说明](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)对依赖 JavaScript 编译 API 的工具说明一致；不从协议本身的普通类型消费通过推定 Vue 工具链兼容。

## 验收范围与边界

- #10 双 NPC 受控 provider、#11 证据详情与终态回顾已在同一固定候选接合；对应源码、原始结果和独立审查见[模拟切片验收](evidence/mock-integration-20261111/README.md)。
- #12 已在该候选完成五身份实际 900907.627508 ms、七项完整局／装配／联合故障检查、五职责贡献与授权复盘。历史长测保留原来源，本轮结果单独固定；实际 PR 合并状态以 #12 记录为准。
- 当前桌面／窄屏与具名交互检查已经实际执行，范围不等同完整平台或实际用户体验验收。
- `mock-20261111` 使用合成玩家和模型输出；真实模型质量与真人体验属于尚未执行的 `full-real` 范围。本轮不以它们作为模拟切片的输入门槛。
