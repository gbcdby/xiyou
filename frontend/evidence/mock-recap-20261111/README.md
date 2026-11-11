# #11 授权详情与复盘 · 模拟输入作者自查

结论：**PASS_WITHIN_SCOPE**。固定实现候选为 `7e28d72fbdbfee88df6c5b709e519354b54820fd`，tree `d2af9ea21b827d6bb39ee4793cd99c3fb5526b44`，基线 `cf6f880f292d835f1644cd2e8f215fcf8aff512f`；Spec 为 `3690b481d1805f6a7b535584c80a8574c5103d97`，profile `mock-20261111`。本目录的后续归档提交只添加证据与文档链接，实际运行身份保留上述固定提交。

这是 #11 实现者的自查，不是独立需求／标准审查结论。#10 受控双角色、#12 四路径、五人贡献、至少 900 秒同候选运行和最终集成仍由总控在组合候选上核对。本轮没有真实模型调用或真人体验测试。

## 实际结果

| 检查 | 实际结果 | 原始输出 |
| --- | --- | --- |
| 后端全量行为检查 | 94/94 PASS；包含新增 4 项真实 PostgreSQL / HTTP 复盘场景 | [backend.txt](checks/backend.txt) |
| 前端全量行为检查 | 53/53 PASS；包含新增 6 项复盘读取、代次、分页和错误状态检查 | [frontend.txt](checks/frontend.txt) |
| 协议全量行为检查 | 23/23 PASS；新增严格 DTO、分类、范围及游标关系 | [protocol.txt](checks/protocol.txt) |
| 前端类型与构建 | vue-tsc 和 Vite PASS | [build.txt](checks/build.txt) |
| 生成一致性 / 独立 JSON Schema | 均 PASS；既有三种同步 DTO 的 schema 定义与基线相同 | [检查记录](checks/result.json)、[独立 Schema](checks/python-schema.txt) |
| 实际浏览器 | 15 项具名检查 PASS，2 张截图；47.580 秒，页面及数据库错误为空，所有资源关闭 | [原始结果](browser/result.json)、[执行输出](browser/execution.txt) |

运行使用 Node `v24.22.1`、PostgreSQL `18.6`、Chromium `153.0.8010.0`。浏览器与检查命令的 111 个源码／依赖输入摘要完全相同，执行前后未变化，开始时工作区干净；[manifest](manifest.json) 汇总固定来源与每份产物摘要。`checks/result.json` 保留真实命令、退出码、时长与输入摘要，`browser/result.json` 保留同一候选身份、具体断言分组、截图摘要和清理状态。

## 页面及权限检查覆盖

2 人、5 人分别用独立浏览器上下文，经页面完成登录、创建、加入、开局、取得控制、检查、拿取、转交、修复与许可。随后 NPC 使用 `bindInternal → prepareDecision → submitIntent` 的合法受控移动，正式规则器生成 `costly_passage`；所有玩家看到终态只读复盘，世界操作按钮停用。该 NPC 尾段只为验证 #11 页面接合，不是 #10 受控策略样本，也不作为五职责贡献证明。

3 人负例中，A 先公开说话，再只向 C 定向声称“通路已修好”，并给 C 一条私人陈述；B 后来移动到场。C 合法分享 Claim 型观察给 B，A 另向 B 分享真实证据。终止后 C 的页面显示 `Claim/heard_claim`，B 显示 `Claim/received_claim`，actor 分别为接收者 C/B。B 没有原 ClaimRecorded、私聊或到场前的公开内容；其当前授权目标仍 `safe=false`。直接观察、合法证据副本和类型字段同时保留。HTML 外形的合成文本没有被解释成元素。

浏览器还覆盖实际撤权、跨局查询、空结果、未知及重复参数、非法游标；受控旧服务缺端点只影响过程区。独立分页场景经 55 次合法页面检查产生 113 条授权过程，第一页 100 条；注入一次 503 后原页仍在，状态未伪装完整，重试使用同一 throughSeq 和原 beforeSeq，完整顺序与实际 API 页一致且无重复。重复检查仅构造分页数据，不计作玩法贡献。

旧响应检查延迟的是实际服务返回值，不是预填成功响应：断连恢复新视图、经大厅切换新房间、实际认证失效后重新以新访客登录，都使旧读取被取消并清空；迟到回包不能重填或追加旧记录。后端测试还核对读取前后 state、logical_time、WorldEvent、Receipt、outbox、Decision、ai_runs 数量及持久回放不变，确认此端点没有副作用。

[桌面截图](browser/recap-desktop.png) 显示收到的证据与收到分享的陈述采用不同分类、接收者归属和稳定引用；[390 像素截图](browser/recap-mobile.png) 显示窄屏堆叠与文案换行。全页实际 scrollWidth 检查未发现横向溢出；分类内容另由真实 DOM 断言确认，截图不代替接口权限检查。

实现规则、未知 subjectId 的“相关引用”映射以及 #7 固定模型义务的源码／负例对应见 [backend/recap.md](../../../backend/recap.md)。本次不重跑或扩称原 TLC 结果。

## 保留的失败与修正

| 尝试 | 原结果 | 原因和限定修正 |
| --- | --- | --- |
| [browser-r1](failures/browser-r1/result.json) | FAIL；2 人链通过，5 人许可等待超时 | C 在收到 A 的修复视图前使用旧目标版本，真实服务正确拒绝 STALE_PRECONDITION；[原截图](failures/browser-r1/stale-view.png) 保留。脚本改为等 C 的实际 DOM 显示 safe=true 后明确提交新动作，不改校验器 |
| [browser-r2](failures/browser-r2/result.json) | FAIL；2 人、5 人链通过 | 脚本把 Aborted 的空 ending.facts 当成包含 safe 字段；改为核对当前授权 target.fields，仍断言实际 safe=false |
| [browser-r3](failures/browser-r3/result.json) | FAIL；2 人、5 人链通过 | B/C 复盘已到达时立即检查 A，而 A 的异步页尚未返回；改为等待各自页面完成后检查，保留所有角色断言 |
| browser-r4 | 开发期范围 PASS | 完成分页、视图与换房检查；新增实际账号失效路径后冻结候选并执行最终 R5，不把 R4 改称最终候选 |
| [最终 R5](browser/result.json) | PASS | 固定 commit、全部 15 项具名检查、2 张截图及清理状态齐全 |

前三次失败的原始 JSON、命令输出与真实退出码均保留在各目录。它们发生于未提交开发树，原 result 中的 base commit、dirty 状态及完整源码哈希明确标识每次输入；不把不同输入拼成同候选成功。

新增公开行为的先失败记录在 [tdd](tdd/)：协议最初未知契约、HTTP 最初没有端点、HttpApi 最初没有 recap 方法、复盘代次模块最初不存在，对应后续绿灯输出保留。早期 TDD 日志用于说明开发过程，未单独保存完整源码快照，不能冒充固定候选验收；最终固定候选的全量结果以上表为准。

普通 `git commit` 在建立 tree 时遇到基线两个历史 PNG 对象缺失。按既有 worktree 条件使用 `git write-tree --missing-ok` / `commit-tree`，保持原缓存树引用不变；没有重新导入、修改或外发旧证据。本目录所有执行和图片均来自本轮新的合成输入。

## 复现与未覆盖范围

在仓库根目录安装根依赖和 `frontend` 依赖后，运行 `checks/result.json` 中的六组命令。实际浏览器入口为 `node frontend/tests/recap-browser-check.mjs`；通过 `PLAYWRIGHT_MODULE`、`CHROMIUM_PATH` 或 `CHROMIUM_PACKAGE` 指向已有工具，`FRONTEND_EVIDENCE_DIR` 选择新的输出目录。脚本会启动并关闭临时 PostgreSQL、权威服务、Vue 和浏览器。

此作者检查没有执行 #10 正式 mock provider、四种结局合集、五角色各两次有效贡献、900 秒长测、组合故障全部矩阵、独立两轴审查、远端 PR 或合并。真实模型质量、真人体验、跨设备公网和生产部署也不在结论内；这些边界不妨碍总控按用户授权继续完成模拟切片和合并流程。
