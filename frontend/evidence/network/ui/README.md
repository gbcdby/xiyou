# 真实联机 UI 作者检查

## 本轮结果与范围

2026-11-11（UTC）在真实 Vue 页面、HTTP、Socket.IO 和独立 PostgreSQL 集群上执行 [real-browser-check.mjs](../../../tests/real-browser-check.mjs)，本轮 **PASS**，退出码 0。运行时长 **8,950 ms**；6 项行为／尺寸检查和 2 张截图记录完成。浏览器 `pageerror` 为 0，数据库连接池错误为 0，浏览器、Vite、权威服务和 PostgreSQL 均完成关闭。

这是 `vs001-p05` / [Issue #8](https://github.com/gbcdby/xiyou/issues/8) 的限定作者检查。参与者是一个 Chromium 页面与一个使用生产 `HttpApi`、`SessionClient`、Socket.IO 适配器的独立客户端，两个身份均由真实服务签发。没有 `page.route`、伪造 HTTP 响应、手工注入授权投影或本地替代世界状态。

本次没有执行五客户端 900 秒、真人体验、真实 AI、完整局、部署或 VER-08 整体验收，也不把作者结果当作独立需求／标准复审通过。

## 候选与运行环境

| 项目 | 本次实际对象 |
| --- | --- |
| 执行时 Git 基线 | `b519e68fe4482937730ee7d41f25f5a25238fd6a` |
| 基线 tree | `69b93c9d92381a2e74a3c3b7e55d7da05991d560` |
| 执行时工作树增量 | 仅 `frontend/tests/real-browser-check.mjs`；完整 86 个执行相关文件摘要见 [result.json](result.json) 的 `source.sourceHashes` |
| 权威运行层来源 | `5d3e16fa46c4719471092d0567e9bfd1e28737f7`；本基线的 `backend` 子树与其相同 |
| `backend` 子树 | `ef99a8e1cc86375c7a5cdfe3c6bcfba1b07fd622` |
| Node.js | `v24.22.1` |
| PostgreSQL | `18.6`，通过本次真实集群 `SHOW server_version` 取得 |
| Chromium | `153.0.8010.0`，通过实际浏览器 `version()` 取得 |
| 桌面 viewport | `1440 × 1000`；文档宽度 `1440` |
| 窄屏 viewport | `390 × 844`；文档宽度 `390` |
| 开始／完成 | `2026-11-11T08:38:47.748Z` / `2026-11-11T08:38:56.698Z` |

执行对象是带明确增量与源码摘要的工作树，不能仅用当时 HEAD 代表。保存本报告前，逐项核对 86 个摘要与当前源文件一致；证据目录不在该摘要范围内。本目录随最终候选提交，截图及运行结果对应的是同一组源文件。

## 真实流程与可观察结果

| 步骤 | 本轮断言与结果 |
| --- | --- |
| 登录、创建、加入 | 房主通过页面登录并创建房间；另一个真实访客通过 HTTP 加入。两个 `userId` 不同，伙伴快照的 `self.characterId` 等于加入响应的 `actorId`。 |
| 开始、控制 | 页面等待“两位旅伴已相聚”，点击房主开始和恢复本人控制；独立客户端同样观察 `Running` 并明确请求恢复自己的控制。 |
| 多出口移动 | 初始三个按钮分别为 `前往 store`、`前往 side_path`、`前往 destination`，标签唯一；页面实际依次到达材料间、侧路、通路口，每步均通过真实 HTTP 授权快照核对位置。 |
| 真实拒绝 | 未满足通行条件时点击 `destination`，页面显示拒绝收据；服务器仍确认房主在 `passage`，没有提前改变位置。 |
| 明确接收者与陈述 | 选择定向频道并输入陈述时，未选接收者不能发送。脚本按实际授权投影读取伙伴角色名称，并核对勾选框值为加入所得的 `actorId`；伙伴真实收到 `directed` Claim，其 `recipientIds` 恰为该角色，`speakerId` 等于房主角色。 |
| 实际查看 | 页面点击通路目标的“查看”，真实授权快照中的 Observation 数量增加。 |
| 两种尺寸 | 在同一真实状态下检查两种 viewport，均无横向溢出，保存全页原始 PNG；没有浏览器脚本异常。 |

## 本次脚本修正及前置失败

主代理的前置运行已经走过登录、开局、移动和拒绝，但在接收者定位处超时：[前置失败摘要](previous-attempt.json) 保留其源身份、完成步骤、原报告摘要及关闭结果。该记录属于 `background`，没有记成本轮重新执行。

失败来自脚本把访客昵称“联机松风”当作关内角色名称。真实 UI 与授权投影显示的是“材料保管者兼通行协调者兼记事者”。本轮改为从真实房主快照中按伙伴 `actorId` 查找当前在场角色，再使用其名称定位并校验控件值；同时核对真实 Claim 的接收者和说话者。没有更改角色分配、权限或投影契约。

基线已包含 `WorldPanel.vue` 的出口后备标签修正：授权投影尚未含目的地名称时，用已公开的 exit ID 区分出口。本轮实际复验了该行为，没有新增 UI 或生产网络代码修改。

更早一轮关闭 PostgreSQL 时出现的 `57P01` 属于前置退出期记录，本轮没有复现或定位其原因；本次关闭成功不构成“后端已修复该问题”的结论。

## 原始截图与查看记录

已经实际查看以下两张原始 PNG。桌面三列与窄屏纵向布局都能容纳长角色名；三个出口各有可辨认标签；对话陈述与事实／观察分类分别显示，拒绝结果与已确认结果可区分。截图为全页静态取证，不代表真人可用性、真机触控、辅助技术、所有字号或持续交互的视觉验收。

- [桌面原图](real-session-desktop.png)：SHA-256 `ea1547ced9182acfe2fb504b02d83bfa552613fe454cb7d6604dea9ec5012b84`。
- [窄屏原图](real-session-mobile.png)：SHA-256 `eb20439c49b8f050e36a74e1d471bd30f95cf2bd0b34254f0f212156e6db28eb`。

图像未经过裁剪、拼接或内容修改。完整执行摘要与源码摘要见 [result.json](result.json)，阶段输出和资源关闭顺序见 [run-output.txt](run-output.txt)。

## 复跑入口

在项目根目录执行 `node frontend/tests/real-browser-check.mjs`。环境需具备项目既有依赖、可启动的真实 PostgreSQL 和 Chromium；可用 `PLAYWRIGHT_MODULE` 指定 Playwright 模块，`CHROMIUM_PACKAGE` 指定提供 `executablePath()` 与 `args` 的 Chromium 包，`TMPDIR` 和 `FRONTEND_EVIDENCE_DIR` 指向本次独占的临时输出位置。

脚本会在同一进程生命周期启动并关闭数据库、权威服务、Vite 和浏览器；失败会保留失败结果，不能由静态演示或替身响应代替。本次没有增加应用依赖或改动共享环境配置。
