# #11 Observation 详情与终态授权复盘：独立标准轴 R1

**结论：标准轴 PASS；没有新 finding，也没有本审查范围内的阻断项。** 本结论限定于本次证据详情、独立 recap 协议／服务／页面及其证据归档，不释放完整 `full-slice-candidate`，不替代 #10 接合、#12 集成验收或需求轴结论。

## 1. 固定身份与独立性

| 项目 | 本次实际对象 |
| --- | --- |
| work_id / profile | `vs001-p08` / `mock-20261111` |
| 审查候选 | `b221ab89784b197431cf682b0c9036e46bb03932` |
| 审查 tree | `4f330795548d03f93ae38366a98d6ddf162eb97e` |
| 实现与作者执行候选 | `7e28d72fbdbfee88df6c5b709e519354b54820fd` |
| 实现 tree | `d2af9ea21b827d6bb39ee4793cd99c3fb5526b44` |
| 比较基线 | `cf6f880f292d835f1644cd2e8f215fcf8aff512f` |
| 有效 Spec | `3690b481d1805f6a7b535584c80a8574c5103d97` 的 `docs/specs/vertical-slice-mock.md` |
| Spec 文件身份 | GitHub 实读 blob `c5197eb41639d5b4bd2281199a4627d8a734c173`，与本地文件 `git hash-object` 相同 |
| 独立审查者 | `/root/network_standards`，不是本候选作者 |
| 实际独立执行 | 2026-11-11 UTC，在冻结 `b221ab8` 上执行；检查后 tracked 工作区仍干净 |

本轮使用 `worker-review`，读取仓库 AGENTS、工程／工作流／文档布局及 UI 共性和色光规范；读取 [#11 当前正文](https://github.com/gbcdby/xiyou/issues/11) 与有效 Spec。只分配标准轴；没有读取本轮需求轴报告，没有修改业务、协议、测试、既有证据或远端记录，没有递归分派。作者日志被作为待核查材料，结论来自源码、原始记录核对与本次独立执行。

用户已经将本轮输入与验收 profile 改为全 mock；没有把真人或实际模型供应商调用重新设为门槛。

## 2. 标准结论与发现

| 轴 | 结论 | 新问题 | 阻断问题 |
| --- | --- | --- | --- |
| 标准轴 | PASS，限本文范围 | 0 | 0 |
| 需求轴 | NOT_RUN，本审查者未承担 | 不评定 | 不评定 |

没有待修正 finding。原有 #11 内容准备审查的编号、状态和原候选不在本轮重定；本报告也不改变其他票据或其他轴的结论。

## 3. 实现核对与依据

### 严格协议与旧消费者兼容

`protocol/schema.mjs:125` 起定义独立 `RecapReference`、`RecapEntry`、`AuthorizedRecap`，沿用严格 object 和现有标识、码点、标量、UTC 时间规则；页长 100、fields 32、references 40、原文 2000 码点与 Spec 一致。`protocol/index.mjs:311` 的关系检查约束 kind/category、系统条目的 null actor、唯一条目、固定水位内递减序号和末条游标。新入口没有把公开 Claim 型观察归入 WorldFact，也没有为了文案拼接而截断原文。

独立比较生成的 JSON Schema：基线的 **55 个既有定义全部相同**，仅新增上述 3 个定义。原 `AuthorizedProjection`、`AuthorizedSnapshot`、`WorldBatch` 及其依赖定义都未改变；世界 reducer 和既有恢复游标未扩展。生成一致性和 Vue/TypeScript 检查已由本审查者实际运行通过。结构和关系检查不被当作权限验证。

### 当前授权、历史受众、终态水位与只读性

`backend/recap.mjs:80` 先认证，再进入既有 `runtime.locked`；锁内 `access` 重查当前账号与成员绑定，随后核对 Finished/Aborted 和 throughSeq 等于当前 head，最后才查询 `world_events`。角色由受信成员记录取得，不由 query 或前端声明。数据库查询同时包含 session_id、序号界限、事件白名单及原 `audience.humanCharacterIds`；过滤发生在 LIMIT 101 前，隐藏条目不会占用公开分页名额。游标来自第 100 条授权条目，无隐藏记录计数。

`parseRecapQuery` 拒绝未知、重复、遗漏参数以及非法十进制和 beforeSeq 范围；运行层入口再次检查 query。SQL 使用绑定参数，不拼接会话或游标。正常返回继续沿用 `Cache-Control: no-store`。

复盘没有调用 deadline、emit、prepareDecision 或领域动作；事务 events 为空且 clockTouched 为 false，既有 persist 不写状态、事件或 outbox。本次真实 PG/HTTP 检查验证了读取前后 state、logical_time、事件、收据、outbox、Decision、ai_runs 数量以及回放的一致性。锁内读取和既有撤权／删除的会话锁遵守同一串行边界。

### 字段白名单与 Claim 语义

`backend/recap.mjs:24` 按事件种类逐字段构造公开对象，不整包转发 payload，不输出内部受众、UserId、token、connectionId、causedBy、Decision、内部信念或计划。稳定 entryId 只由 sessionId 与序号生成；subject/source 不反查隐藏事件或完整 content。

Observation 首先依据 category 判断是否 Claim，再区分普通取得与分享副本：普通 Claim 为 `heard_claim`，分享 Claim 为 `received_claim`，actor 都是当前接收者；只有 ClaimRecorded 的 `said` actor 表示发言者。Evidence/WorldFact 型观察分别为 observed/received_evidence。target.updated 与终局条目 actor 为 null，item.used 根据真实 consumed 决定文字。无公开类型的 subjectId 保留为普通 source 引用，文档明确这是“相关引用”，没有猜测原发现者或原发言者。

独立实跑了 A→C→B 假修复陈述：B 无原 Claim 受众资格，但合法共享观察仍作为 Claim 保留；C/B 的类别、kind 和接收者各自正确；B 看不到原定向 Claim、私聊及到场前公开陈述，真实 safe 仍为 false。合法证据共享与直接观察同时保留，没有借删掉 Claim 型观察规避负例。

### 前端异步、权限和既有生命周期

`SessionPage.vue:47` 只在当前在线终态投影上打开复盘，绑定账号／token、Session、actor、viewId、phase 和 snapshotSeq；同步 watcher 在绑定失效时清空。`RecapClient.open` 递增 serial、AbortController 取消旧请求并清空独立状态；返回或抛错后同时核对 serial 与取消状态，旧请求不能回填。响应再校验当前 session/actor/throughSeq/phase、页内关系和跨页顺序，不合并重复页。它没有写入世界 reducer 或 ActionJournal。

分页普通失败保留已读页并标记不完整，重试使用原水位与游标；当前 FORBIDDEN、UNAUTHENTICATED、SESSION_GONE 清空复盘。旧服务缺端点只显示过程区不可用，结局仍由已有 ending 提供。共享 HttpApi 增加的取消机制仍保留 10 秒超时；既有身份桥接继续按被拒 token 判断，旧 token 错误不会清除新身份。

独立浏览器复跑覆盖实际断连换 view、经大厅换房、认证撤销后登录新访客，以及实际访问撤权。延迟的是实际服务响应，不是伪造成功包；旧响应均未重填旧记录。既有 HTTP、身份恢复和恢复错误测试同时复跑通过。

### 展示、安全与工程组织

EvidencePanel 直接消费授权 Observation，保留类型字段、适用对象、来源引用和记录接收者。RecapPanel 由独立标签区分观察、陈述、已发生行动，heard/received Claim 标为接收者。名称解析只遍历当前授权投影，未知引用显示 ID，不读取完整 content。原文、字段及引用均为普通 Vue 文本插值；实际 HTML 外形文本没有产生 img 元素。

新网络状态在 network/，类型辅助在 domain/，视图在 features/；没有引入新框架或并行权威状态。新增说明、注释、运行提示使用中文，标识符和文件名为英文。桌面 1440×1000 与 390×844 的实际截图已查看，信息层级、Claim 分类与稳定引用符合现有页面语言；脚本检查全页无横向溢出。此观察不声明已完成全部辅助技术、设备或视觉精确还原验证。

## 4. 本审查者实际执行

| 检查 | 结果 | 本地原始证据 |
| --- | --- | --- |
| 新 recap 协议／后端／客户端，加既有 HTTP、身份恢复和恢复错误测试 | **30/30 PASS**，exit 0，5.972 秒 | `targeted.txt`、`targeted.execution.json` |
| 实际 PostgreSQL／HTTP／Socket.IO／Vue／Chromium 脚本 | **15 项 PASS + 2 图**，exit 0，脚本 45459.024295 ms，外层进程 45.960 秒 | `browser/result.json`、`browser.txt`、`browser.execution.json`、两张 PNG |
| `node protocol/scripts/generate.mjs --check` | PASS，exit 0 | `generated.txt`、`generated.execution.json` |
| `npm --prefix frontend run typecheck` | PASS，exit 0；vue-tsc --noEmit | `typecheck.txt`、`typecheck.execution.json` |
| 独立归档、输入、旧 DTO、相对链接审计 | `source_inspection / OBSERVED / PASS` | `audit-archive.py`、`archive-audit.json` |

30 项执行命令为：

```sh
node --test protocol/tests/recap.test.mjs backend/tests/recap.test.mjs frontend/tests/recap-client.test.mjs frontend/tests/http-api.test.mjs frontend/tests/identity-recovery.test.mjs frontend/tests/recovery-errors.test.mjs
```

浏览器入口为 `node frontend/tests/recap-browser-check.mjs`。本次使用 Node v24.22.1、PostgreSQL 18.6、Chromium 153.0.8010.0，Playwright 与 Chromium package 的实际入口及输出目录记录于 `browser.execution.json`。浏览器 pageErrors、databaseErrors 均为空，browser/Vite/server/PostgreSQL 均已关闭。原始 stdout 保留关闭 WebSocket 时的两条 Vite ECONNRESET 消息；它们没有被删掉，也没有被误称页面或数据库错误。临时数据库由既有 fixture 建在它自己的 `.agent-output/postgres-tests/`；不纳入审查归档。

本次浏览器同样用合法内部 NPC 意图完成终局尾段，验证的是 #11 页面与协议接合。2 人／5 人实际操作链生成 costly_passage；分页场景为 113 条授权记录。没有用这些重复 inspect 构造数据冒充玩家贡献。

## 5. 作者证据真实性与可复核边界

独立审计结果如下：

- manifest 中 **31 项产物**的 SHA-256 与字节数全部吻合；其中 **30 项运行记录／截图**又与作者临时目录的原始文件逐字节相同，剩余一项为新归档 README。
- `checks/result.json` 与最终 R5 浏览器的 **111 项输入摘要**完全相同；每项同时对照作者执行 commit、审查 commit、当前工作区和本次独立浏览器输入，全部一致。执行到归档的 diff 仅涉及证据及 frontend README。
- 作者的后端 94、前端 53、协议 23 共 **170 项**与原始日志计数相符；6 个检查命令与退出码可读取。它们仍标记为作者执行，并未写成本审查者重跑 170 项。
- 作者 R5 为 15 项具名 PASS、2 图、47580.386908 ms；没有把包含截图的 checks 数组长度 17 误报为 17 项行为断言。
- browser-r1/r2/r3 均保留 FAIL 和 exit 1、原错误、各自 dirty 来源与输入哈希；其归档与临时原件相同。当前脚本分别等待 C 的真实修复视图、读取 Aborted 的授权 target.fields、等待每个角色实际完成异步复盘，没有关闭校验器或删除相关角色断言。
- 38 个受查本地文档链接均存在。实现说明引用的 #7 isolation/reconnect/visibility README 已从固定 `c78066d9...` 实际读取，三 blob 与文档所列相符；映射遵守当前授权、历史受众固定、代次清空、终态可读和 Claim/事实分离义务。没有重跑 TLC 或宣称新接口已被旧模型证明。

完整 `git diff --check` 的 exit 2 仅来自原始 `tdd/recap-api-red.txt` 第 17、20 行尾空白；排除原始证据后的源码／文档 diff 检查 exit 0。这两行属于被要求原字节保存的失败日志，不建议改写它们。

早期 TDD 日志没有完整源码快照，三个开发期浏览器失败只提供 dirty 身份及逐文件哈希，不能据本报告认定这些开发中间态都可逐字重播。它们用于保留失败历史；本轮验收与独立复现使用固定、可读取的 7e28/b221 输入。此限制已在原证据说明中披露，没有被拼成最终成功。

## 6. 未覆盖与结论适用范围

本审查者没有重新跑作者全部 170 项、Vite 生产构建或 Python schema 检查；已核对其固定输入和原始结果，另实际执行受影响的 30 项、生成一致性与 SFC 类型检查。没有评估未改业务的全部回归、任意规模负载、所有 SQL 执行计划、所有浏览器或设备，也没有做完整可访问性审计。

没有执行 #10 正式双 NPC mock provider 接合、#12 四结局合集、五职责有效贡献、同候选 900 秒、所有组合故障、完整源实现的 TLC/refinement、需求轴、远端 PR/合并或部署。真实模型质量和真人体验为本 profile 的 NOT_REQUIRED；本报告实际状态仍是 NOT_RUN。

这不阻断当前窄范围候选的标准轴通过。完整 #11 释放及随后合并仍由总控结合独立需求轴、#10 和集成候选的实际状态判定。

## 7. 最小补充归档清单

建议只复制本审查目录中的以下文件，原字节保留；不带浏览器缓存、临时数据库、依赖目录或重复的 before-cleanup 快照：

1. `review-r1.md`、`review-r1.json`、`archive-audit.json`。
2. `audit-archive.py`、`run-check.py`，用于解释实际审计与命令记录方式。审计中的作者临时路径只表示本次原件核对来源；归档独立使用时仍可从 Git 固定对象及 manifest 复核输入与摘要。
3. `targeted.txt`、`targeted.execution.json`；`generated.txt`、`generated.execution.json`；`typecheck.txt`、`typecheck.execution.json`。
4. `browser.txt`、`browser.execution.json`、`browser/result.json`、`browser/recap-desktop.png`、`browser/recap-mobile.png`。

共 16 个文件。已有作者证据目录保持不变，不需要重复复制其 31 项产物到审查目录。
