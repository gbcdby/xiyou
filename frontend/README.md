# 同行前端 · #8 阶段候选

本目录提供 Vue 3 / TypeScript / Vue Router 的房间界面、授权投影视图、HTTP / Socket.IO 客户端以及恢复驱动。当前是等待 #6 运行服务接入的**阶段候选**，不代表 #8 整票完成或已通过多人联机验收。

## 运行与检查

需要 Node.js 24 或更高版本。本轮实际使用 Node.js 24.22.1。依赖固定在本目录的 `package.json` 和 `package-lock.json`，不依赖仓库根目录安装。

```sh
cd frontend
npm ci
npm test
npm run build
npm run dev
```

开发服务器默认仅监听本机。`/api` 和 `/socket.io` 代理到本机 `3000` 端口；部署入口、服务运行方式及正式代理由后续运行层接入确定。`npm run build` 先执行 `vue-tsc --noEmit`，再生成静态产物，不发布或部署。

默认入口 `/` 请求真实 HTTP 服务。`/sessions/:sessionId` 通过真实 Socket.IO 订阅当前账号的授权视图。没有服务、身份失效或尚未取得合法快照时，页面明确显示未连接或不可访问，不生成房间、动作成功或世界变化。

`/demo` 是独立的静态界面演示：只使用手写且通过公开契约校验的授权 DTO，醒目标注“无真实联机”，所有世界动作停用。演示数据的 `contentVersion` 是 `ui-demo-v1`，不作为实际内容或玩法验收材料。

实际创建房间默认使用 `trust-repair-fixture-v1`，可通过公开配置 `VITE_CONTENT_VERSION` 替换。前端不导入完整 `content` 配置、服务端状态、内部受众或 NPC 信念。

### 浏览器检查

`npm run test:browser` 使用安装环境中的 Playwright。可用 `PLAYWRIGHT_MODULE` 指定该模块的绝对入口，用 `CHROMIUM_PATH` 指定既有 Chromium，用 `FRONTEND_URL` 指定已运行的开发服务器。默认目标是本机 `5176` 端口，开发服务器可用 `npm run dev -- --port 5176 --strictPort` 启动。

该脚本包括桌面 / 390 像素窄屏截图、横向溢出检查、断网后的诚实失败反馈、静态演示动作停用，以及组件夹具中的接收者选择、物品交付和移动事件。浏览器输出遵循项目的临时产物规则。`tests/browser-fixture.html` 仅是开发期验证入口，生产构建只包含 `index.html`。

**本轮浏览器脚本未完成执行。** 环境缺少 Playwright 对应的 headless shell；既有 Chromium 无法创建所需套接字；提供的浏览器通道不能连接命令行开发服务器。没有形成页面截图或浏览器交互通过结论。具体执行边界见[阶段自查](evidence/stage-self-check.md)。

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
| 回顾 | 只展示 `AuthorizedProjection.ending`，终态停用新动作，不自行推断胜负 |

客户端保留自己的待确认动作原文到标签页 `sessionStorage`，以登录用户和 Session 隔离。刷新后重新取得授权，再查询原动作；不会把缓存当作授权依据。只缓存待确认的原始请求，不缓存授权投影。浏览器不允许保存时提示保留当前页面，未取得收据前不要刷新。

## 与运行服务约定的最小接口

这些接口经总控与 #6 实现范围对齐；本轮未做真实服务联调。

| HTTP 路径 | 输入 | 客户端期望 |
| --- | --- | --- |
| `POST /api/auth/guest` | `{name}` | `{token,userId,name}` |
| `GET /api/sessions` | 登录 token（如已有） | `[{sessionId,name,playerCount,phase}]` |
| `POST /api/sessions` | `{nonce,contentVersion}` | `{sessionId}` |
| `POST /api/sessions/:id/join` | `{nonce}` | `{sessionId,actorId}`；原成员重复加入保持原角色 |
| `POST /api/sessions/:id/start` | `{nonce}` | JSON 响应；实际 Running 状态仍须由授权流确认 |
| `GET /api/sessions/:id` | 登录 token | 只读 `AuthorizedSnapshot`；不授予客户端连接控制 |
| `GET /api/sessions/:id/actions/:actionId` | 登录 token | `ClientReceipt`；404 保持结果未知 |

Socket.IO 使用默认 `/socket.io` 路径和 `auth: {token}`。服务端从真实 Socket 获得连接身份；客户端不通过 header 或动作载荷声明 `connectionId`。

| Socket.IO 事件 | 载荷 | 响应 / 推送 |
| --- | --- | --- |
| `session.subscribe` | `{sessionId}`，不提供任意 `viewId` | 当前连接的 `AuthorizedSnapshot` 或契约错误 |
| `player.action.request` | 原始 JSON string | `ClientReceipt` 或契约错误 |
| `sync.request` | 原始 JSON string | 覆盖完整区间的 `WorldBatch` 或契约错误 |
| `control.resume` / `control.take` | 原始 JSON string | `ControlResponse` 或契约错误 |
| `world.batch` | 服务端推送 | 同一个 Session / view 的授权批次 |

握手认证失败如附带契约错误，适配器从 Socket.IO 的 `connect_error.data` 读取。`share_evidence.evidenceId` 取自当前用户可传播的 `Observation.observationId`，不把内部来源 ID 当成可任意传播的证据。上述适配细节在 #6 联调时仍须与实际入口逐项核对；修改协议含义应回到相应 Spec。

## 恢复与动作语义

依据[已发布 M0 协议](../docs/specs/m0-protocol.md)和 #7 已释放的 reconnect 模型义务实现：

1. 每条物理连接和每次视图换绑都产生新代次。断线、权限撤销和 `RESYNC_REQUIRED` 清空旧投影；旧代快照、事件与回包不能填回新视图。
2. 订阅快照后立即补发，再以 1.5 秒周期补发兜底最后一个丢失批次。单轮最多 8 页，同一连接上合并并发补发请求。
3. 只有 `fromExclusive == cursor` 才原子应用整批效果和游标。整批重复忽略；未来 / 重叠区间丢弃后从当前游标重取；空的完整区间也推进游标。游标使用十进制字符串比较，不转为 JavaScript Number。
4. 投影替换可以移除旧可见字段。批次内任一效果无效时整批回滚，不留下前半段状态。客户端校验不替代服务端在事件发生时固定受众并过滤快照 / 流。
5. 动作创建时固定 `clientActionId`、`controlEpoch`、`baseSeq` 和完整原文。重连或取得新控制代次后仍原样重试旧动作。只有明确的新动作才生成新的动作身份。
6. 超时与收据 404 仍是结果未知；收据须匹配 Session、角色、动作身份和语义摘要。收据不直接修改世界投影。迟到的空查询不能覆盖已取得的终态收据。
7. 控制请求超时只在同一物理连接复用 nonce 和原文；新连接使用新 nonce。`CONTROL_HELD` 不会触发自动接管。已明确拒绝后的下一次用户尝试创建新的控制 nonce。
8. `Finished` / `Aborted` 视图可读，旧收据可查，不允许新的世界动作；终态之后的新批次要求重新核对授权快照。

`domain/` 不依赖 Vue。`network/` 管理真实传输与异步结果，`state/` 是轻量 Vue 状态桥接，`features/` 仅消费授权 DTO 并产生动作意图。

## 视觉与依赖选择

布局沿用[UI 共性指南](../docs/design-direction/guidelines/ui-and-ux.md)与[色光指南](../docs/design-direction/guidelines/color-and-light.md)：纸色浅底、青绿色动作与状态、暖色提示，使用稳定阅读承托面和明确焦点。CSS 几何山形与 SVG 图标的 `asset_source` 为 `original_team`，属于本阶段原创界面占位，不是最终场景美术、参考图复刻或已批准视觉稿。

准备环境中的 TypeScript 7.0.2 与 `vue-tsc` 3.3.14 实际运行时出现 `ERR_PACKAGE_PATH_NOT_EXPORTED`，因为缺少其需要的 `typescript/lib/tsc` 入口。前端独立固定 TypeScript 6.0.3，保留同一协议类型并实际通过 SFC 类型检查。选择与 [TypeScript 7 官方发布说明](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)对依赖 JavaScript 编译 API 的工具说明一致；不从协议本身的普通类型消费通过推定 Vue 工具链兼容。

## 后续验收边界

- 接入已释放的真实 #6 服务，逐项验证创建 / 加入 / 开局 / 快照 / 控制 / 动作 / 收据 / 批次，核对认证失败载荷与证据引用。
- 补齐真实桌面与移动宽度截图、焦点、放大文字、长内容与组件交互。现有 CSS 和纯色对比计算不能代替实际渲染验收。
- 用同一候选执行五客户端至少 900 秒技术检查、真实丢包 / 重连 / 接管 / 越权场景及服务端授权投影对照。
- 真人试玩和真实 AI 体验分别取证；本阶段的静态演示、网络替身及形式模型均不充当此类证据。
