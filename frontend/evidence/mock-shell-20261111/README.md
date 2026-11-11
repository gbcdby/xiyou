# 模拟输入下的实际服务与浏览器短检

这是 2026-11-11 新执行的最小证据，参与者为自动创建的合成身份，外部模型调用为 0。实际执行 PostgreSQL、权威运行层、HTTP、Socket.IO、正式前端与 Chromium；检查没有替代世界规则、授权或数据库提交。

## 固定身份

实际运行本地提交 `61b12dd078a2058a8f459279434c1643bd34fb10`，完整 tree `8fb8b0223ffa309b921cbf6cb4c86d3af77bc1cc`。它组合了远端前端 `e93acd6d791abb899fb777f89a2a9fe865f23b74` 和受控 AI 候选 `37c35784ce77d4d3f43dbad6e34f4fd01ccc96a0` 的运行输入；本次没有启用模型 provider。[source-inputs.json](source-inputs.json) 冻结 105 项实际源输入。归档只增加证据及 README，源输入重新计算后不变。

## 实际结果

| 检查 | 结果 | 输出 |
| --- | --- | --- |
| `npm test --prefix frontend` | 47/47，exit 0 | [frontend-unit.txt](frontend-unit.txt) |
| `npm run build --prefix frontend` | 类型与 Vite 构建，exit 0 | [frontend-build.txt](frontend-build.txt) |
| `node frontend/tests/real-browser-check.mjs` | 6 项具名检查，exit 0；实际 7191.988215 ms | [browser.txt](browser.txt)、[result.json](result.json) |

浏览器检查覆盖实际页面登录、创建、两人加入、开始与控制；可辨认的多个出口及移动；未满足许可时服务器真实拒绝且位置未被客户端提前改变；定向陈述与查看记录；桌面 1440×1000 和窄屏 390×844 无横向溢出。页面错误和数据库错误为空，资源已关闭。两张新截图为 [桌面](real-session-desktop.png) 和 [窄屏](real-session-mobile.png)，摘要保存在 result.json。Node v24.22.1、PostgreSQL 18.6、Chromium 153.0.8010.0；命令、退出码、耗时及原输出摘要见 [execution.json](execution.json)。

运行环境可通过 `PLAYWRIGHT_MODULE` 提供 Playwright 入口，并按脚本支持的 `CHROMIUM_PACKAGE` 或 `CHROMIUM_PATH` 指向可用浏览器。脚本自行创建测试数据库与服务，输出目录由 `FRONTEND_EVIDENCE_DIR` 指定。本次临时输出在归档前保留，正式链接仅指向本目录。

## 结论与边界

这些结果支持已审联机界面的短流程接合，不能单独证明完整局、双 NPC、自主性、最终同候选 900 秒或真人体验。原前端独立两轴审查按原候选继承；本目录不是新增独立两轴报告。最终模拟集成仍由 #12 在固定候选执行。

此前完整长测 trace 的外发曾被自动审批拒绝，旧载荷未重传、未换编码、未摘取到本目录。本目录的日志、结果和截图全部来自本轮新的合成运行；历史长测的原结论及发布边界继续保留。
