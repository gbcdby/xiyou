# 当前 v3 的 E03 最小补验入口

状态：入口准备与作者静态自查不代表执行。归属 [CS-T05/#59](https://github.com/gbcdby/xiyou/issues/59) 及 [#29](https://github.com/gbcdby/xiyou/issues/29) 的首章 A1–A3 验收；承接已冻结 [M29 说明](cuilan-m29-browser.md) §5 第 2、3 行的两个证据缺口。原已接受证据继续保留其精确范围，不复制一套完成状态，不扩大至 E03 全人数／变体矩阵。

依据为 [首章主 Spec](../../docs/specs/narrative-adventure.md) §10、13、[场景与本人行为 Spec](../../docs/specs/gaolao-scene-policy.md) §14.3、17 和 [工程覆盖映射](../../docs/specs/gaolao-cuilan-self-response-coverage.md)。入口基于 `acf196fbb9804eac96d042165f704c15bd6a9122` / tree `014f11b2f755a29e1a3ef9b1c9f9c9a6055bd388`，仅新增此说明和 [cuilan-e03-browser.mjs](cuilan-e03-browser.mjs)；不改产品、四个冻结 M29 文件、helper 行为或五秒宽限合同。

## 两个固定样本

| ID | 初始状态与真实触发 | 必须观察到的结果 | 对应义务中的本次范围 |
| --- | --- | --- | --- |
| E03-U3 | 三个独立 Chromium 客户端／人类玩家槽位；默认新 v3。正常侧窗联络、生产翠兰退让、真实开门与本人接受 follow 后，领路者只走到 C01，仍未安置。第 0 页提议结束，第 1 页点击有效旧轮确认；仅暂挂该原提交，第 2 页正常关闭，然后释放同一原请求。剩余两页再以正常控件开始并确认新轮。 | 断开前旧轮有效；真实 disconnect 的控制变化、成员变化、原轮 invalidated 同因果；原 proposalId/version 保留、endVersion 不增长、确认者 epoch/view 不变。旧确认精确 `Rejected/STALE_PRECONDITION` 且无动作事件、无终局；新轮只要求两位仍在线成员，实际 GZ-E03 的 safe=false/open=true/returned=false。终态不补安置或改写未完成事项。 | GZ-E03 当前在线集合确认规则；GZ-SP-06、GZ-CS-09/11、N11 的未安置结束与终态保持子范围。 |
| E03-G2 | 两个独立客户端；默认新 v3。真实前院安置，第 0 页通过本人清单提出 single_use 私物请求，生产本人接受后实际拿取一件私人信件。非本份许可参与者的第 1 页正常关闭，第 0 页在真实五秒宽限前后各点击一次正常“提议暂告一段”。 | 首次真实 `Rejected/NOT_READY` 的 ACK 在原 deadline 前收到；原 disconnect 事件精确给出 `serverTime+5000ms`。不改 clock/timing，不代调维护；实际墙钟越过 deadline 后的新请求由唯一在线成员明确结束为 GZ-E03。safe=true 保持；原 held acquisition/accepted proof/本人决定不改写，许可在终结同事务 `closed/session_ended`，行囊只保留真实剩余且两个归还按钮禁用。 | GZ-E03 的单人宽限；GZ-CS-06/09、GZ-SP-06、N11 的原持物与终态保持子范围。非参与者掉线只暂停，不冒称 GZ-CS-05 的本人 C2 撤回。 |

两场都由生产 `scene-policy` 的翠兰回应，三位自主角色仍按既有 `production-cuilan-v1` profile 受控。正常玩家操作全部来自 Vue 可见控件；不得直接调用 `spatialClient.send`、写状态、移动翠兰或代本人选择。这些客户端不计作真人试玩或真实模型供应商质量证据。

U3 唯一故障屏障复用公开 `holdSubmissions` 接口：一次真实 `confirm_end`，最多 15 秒，始终保留原 raw/身份/返回值，`finally` 释放并还原。没有真实在途生产本人 intent 时只声明终态收束，不声明已覆盖迟到 intent。G2 不注入故障时钟；若前半窗错过、原 ACK 缺失或错误码不符，保留实际失败／未覆盖，不自动改条件或重试补绿。

## 静态入口与实际执行

以下命令只列计划和检查语法，不启动 PostgreSQL、server、Vite 或浏览器：

```sh
node --check frontend/tests/cuilan-e03-browser.mjs
node frontend/tests/cuilan-e03-browser.mjs --list
```

实际执行须先固定完整 clean 候选，独立审查两场断言无开放阻断，并由总控确认旧场资源已释放、明确释放这两个样本。环境变量只是保存释放引用，不能自行形成授权。每个进程一次一场，分别使用新的证据目录；总控逐场核对清理后才开始下一场。

```sh
CUILAN_E03_EXPECTED_COMMIT=<完整候选提交>
CUILAN_E03_EXPECTED_TREE=<完整候选树>
CUILAN_E03_RELEASE_REF=<总控实际释放记录>
FRONTEND_EVIDENCE_DIR=<本工作区.agent-output下的本场新目录>
export CUILAN_E03_EXPECTED_COMMIT CUILAN_E03_EXPECTED_TREE CUILAN_E03_RELEASE_REF FRONTEND_EVIDENCE_DIR
node frontend/tests/cuilan-e03-browser.mjs --execute --case E03-U3
```

第二场命令只将 ID 改为 `E03-G2`，并设置独立新目录。所有其他 ID、额外参数、缺失完整 commit/tree 或占位释放引用都会拒绝。默认内容入口不接受 `VITE_GAOLAO_CONTENT_VERSION` 覆写；必须观察实际 `gaolaozhuang-scene-v3` 五维版本与 `gracePeriodSeconds=5`。

运行上界为每场主链 12 分钟，实际路线完成即可退出，不靠空等凑长场。单个 PG 查询 5 秒、authority 导出总计 60 秒、每页保存 15 秒；采集排空 16 秒、最后主链排空 5 秒、各资源关闭 15 秒。主链失败／终止会取消本场在途调用、恢复故障屏障，并保留失败原件。原 M29 的 900 秒长场不在本入口中。

## 复用、原件与通过条件

- 复用 `gaolao-real-support.mjs` 的生产 `browserRoom`、正常移动／操作／结束控件及授权 snapshot；复用 `cuilan-self-response-support.mjs` 的本人表单、真实生产回应核对、一次提交屏障、采集器与流式 JSON writer。
- 复用冻结 M29 的公开 `cancellable`、`createM29PgScope`、`evidenceMemoryEstimate`、`captureIntegrity`。本入口自己的分页采集、只读 authority 导出与资源收束遵循同一已审模式；只新增场次断言，不复制产品规则。
- `startup.json` 保存来源身份与执行命令；`capture/manifest.json` 及每页保存原 UI action、真实 Socket 请求 raw 和完整 action/ACK 帧、关键正常 snapshot、连续连接观察、授权 HTTP recap 全页、阶段与截图摘要。离线页面正常保持关闭，终态复盘只要求剩余在线端，不以重连改变被测成员集合。
- `authority/manifest.json` 及全部分页来自同一 `REPEATABLE READ READ ONLY` 快照，含完整 session 行（initial_state/content/state 与编码标识）、全量 `action_receipts`、`spatial_intents`、`world_events`；核对数量与连续事件水位。每个真实人类动作都必须有唯一相同 PG Receipt、原请求帧和原 ACK。生产翠兰所有意图须为 `gaolao-cuilan-v2` scene-policy；不得有 provider 调用。
- U3 另保存屏障原文、旧／新轮、原 view、精确成员变化事件。G2 另保存原取得／本人接受证明、真实 deadline 前后的请求与墙钟、同一结束动作内的关闭事件和 `session.finished` 及对应 outbox 范围。两场均通过授权历史 HTTP 读取原 Receipt，并核对没有新增世界效果。
- `result-before-cleanup.json` 与 `result.json` 保存断言、来源首尾、原件索引、错误和 browser/Vite/server/PostgreSQL 清理结果；页与截图有实际 bytes/SHA256。PostgreSQL 原日志路径另记录在 `postgresOutput`，数据库连接凭据不写报告、不上传数据库。

只有本场所有断言、完整捕获／authority 分页、源码首尾与文档摘要不变、原始请求收束、零未结资源创建／PG 查询／受控调用、四类资源关闭均满足，才报告 `PASS_WITHIN_CASE`。作者结果仍须独立复核。静态自查、历史证据、运行结果、整体验收、公开上传、PR/CI、合并和部署保持分列；两场通过也不关闭真人、真实 provider、真机与连续艺术等其他门槛。
