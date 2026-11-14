# M29 生产浏览器 driver：准备候选与执行边界

工作 ID：CS-T04-M29-PREP-20261114。责任来源：[#58](https://github.com/gbcdby/xiyou/issues/58) 的真实页面/生产本人支架，以及 [#59](https://github.com/gbcdby/xiyou/issues/59) 的 M29 对账；约束见 [coverage §5](../../docs/specs/gaolao-cuilan-self-response-coverage.md#5-与-29-的后续覆盖对账) 和 [release 矩阵](../../docs/specs/gaolao-cuilan-self-response-release.md)。

**本次只是可审私有准备。产品样本和 900 秒全部 NOT_RUN；未释放 V2/M29、未注册新 workflow、未写 GitHub。** 语法和场次清单检查不产生产品 PASS。

## 1. 基线与独占范围

从公开 284c56bcf6934ce70f6beabbb7a7a734918d1ecd 创建独立工作区，先快进消费已独审且实际公开的 P05 helper 修复 50bf2ad6d08815765521d7fbe81688dcf5426030，再快进消费已最终独审且实际公开的 03624e7fe13c35b7d9bc1de1a3ca6506a1f370d9（tree 2e3ab585ead7520944a1afbb8e8985e1a2bb6824，唯一 parent50bf）。后者是860249e候选的四个既有 harness 修复，包含真实取消的流式保存与采集排空接口；早期958未审通过版本不消费。

移动等待通过原 Receipt 的 movementId/planVersion/observedSeq 判断，不能用跨 epoch 可重用的 bare commandSeq。新 driver 直接使用最终的 saveCuilanReportJSON(path,value,{signal})、createCuilanReportCollector 及 browserRoom.observe，不复制另一套 JSON 编码器，也不修改共享 helper。共享编码器的21项局部检查及独审只用于该依赖的既有范围，不是 M29 产品/900秒执行。

只新增四个文件：

- cuilan-m29-plan.mjs：固定场次、命令参数及连续活动证据判断。
- cuilan-m29-browser.mjs：生产本人、正常页面、真实网络与 PostgreSQL 的验收 driver。
- cuilan-m29.workflow.yml.example：位于 tests 的惰性 CI 草案，不会注册或自动运行。
- 本说明。

不改业务、内容、TLA、锁文件、共享 helper 或既有 workflow。新文件不并入已冻结的 private IC 13047f5d2869764c596fe7138047ed2399272c33/tree0a2e829068717833c0c41b751f706ef3ac9df56a。将来实际执行有自己的 clean checkout/tree 和 source start/end，需由 root 按 V2、完整候选与运行输入等价关系释放；不能把这份准备的 HEAD 或公有 350 路径改名为完整 IC。

## 2. 固定场次：九短、一长

| 场次 ID | 人数 | 内容/安置 | 分支真实终点 | 新影响 |
| --- | --- | --- | --- | --- |
| M29-2-PUBLIC-E01 | 2 | 默认 v3 / 前院 | 公开、实际同行 E01 | 生产翠兰救援；新私物实际取得与交回 |
| M29-2-PUBLIC-E02 | 2 | 默认 v3 / 前院 | 公开、实际分别 E02 | 同上；结束招徒的全员真实确认 |
| M29-2-DISGUISE-E01 | 2 | 东侧 v3 / 茶棚 | 实际借貌后同行 E01 | 本人 single_use、实际 apply/解除、实际 E01 |
| M29-2-DISGUISE-E02 | 2 | 东侧 v3 / 茶棚 | 实际借貌后分别 E02 | 同上，实际 E02 |
| M29-5-PUBLIC-E01 | 5 | 默认 v3 / 前院 | 公开、实际同行 E01 | 五个独立真实页面与完整职责分配 |
| M29-5-PUBLIC-E02 | 5 | 默认 v3 / 前院 | 公开、实际分别 E02 | 唯一长时 job；新竞争、真实暂停恢复，以及恢复后独立连续 ≥900 秒 |
| M29-5-DISGUISE-E01 | 5 | 东侧 v3 / 茶棚 | 实际借貌后同行 E01 | 五页面与新本人许可进入完整章节链 |
| M29-5-DISGUISE-E02 | 5 | 东侧 v3 / 茶棚 | 实际借貌后分别 E02 | 同上，实际 E02 |
| M29-3-PUBLIC-E01 | 3 | 默认 v3 / 前院 | 公开、实际同行 E01 | A/B 合并、D/E 合并；两个真实请求者竞争、另一用途/原持物保持 |
| M29-4-DISGUISE-E02 | 4 | 东侧 v3 / 茶棚 | 实际借貌后分别 E02 | A 与 B 分离、D/E 合并；竞争和另一用途保持 |

五人 PUBLIC/E02 不再进入短 job。十个实际独立场次中，这一个样本在有证据时可同时关联“该分支”与“长时”义务，不能计作两次独立试验。本计划没有扩成所有变体 × 人数 × 条款 × 故障的组合。

每个场次都从真实页面创建/加入/开局/恢复控制；默认场次不使用内容环境覆写，东侧场次显式固定新登记变体。所有场次实际救出、由生产本人随行并确认安置，新 single_use 许可下真正取出信件并交回。公开路线没有 apply；乔装路线必须有生产本人接受后的真实悟空 apply、公共发言及正常解除。E01 沿实际调查/双方决定/离庄/入队，E02 沿实际结束招徒确认/安排/安全分别；不会用 request_end(scope=chapter) 冒充两种终点。

## 3. 权限、状态与因果边界

复用 browserRoom 的 production-cuilan-v1 profile，其最低 actorFor 层只允许真实玩家和 Tang/Wukong/Bajie。driver 不创建翠兰 handle、不调用她的 send/go/interact、不直接赋予许可、不修改物权，也不向数据库造事实。

玩家动作沿现有真实页面控件；只读页面 snapshot 用来选择当前可见目标与核对投影，不调用 spatialClient.send/move 或写前端状态。三个受控 NPC 只提交有限合法意图，全部记录 actor 与原请求。生产翠兰的意图必须带 scene-policy 与 gaolao-cuilan-v2，由 SELECT 读到的原 Intent/Receipt 对应核实；真实 provider 调用仍为 0。

竞争只在 3 人、4 人和五人长场各进行一次：两真实页面正常提交同 revision 的借貌请求，在提交入口使用至多 15 秒、一次性的可释放顺序屏障。它不修改请求、收据或世界状态。超时和 finally 均释放、收束原异步请求。记录精确 held/release 时间、两原请求/收据、唯一 Accepted 和真实生产回应；期间独立私物许可与实际持有事实必须保持。该调度窗口单独标 profile，不扩成故障矩阵。

## 4. 长时：真实持续操作，不补空等

### 4.1 暂停恢复在计数窗外

五人场景 activeCount < 2 才暂停。因此先让玩家 4 通过合法新许可实际持有包裹，再正常刷新页面 1～4；保持页面 0，在真实 authority 观察暂停和原执行权停止。各原账号通过正常“恢复本人控制”恢复，核生产本人 C2、原取得仍 held，然后按原事项把包裹放回登记原处。

**上述暖场、断线、暂停、恢复和原持物处置全部在 900 秒计数窗外。** 五端重新在线、可控、非暂停后，才用下一轮第一个真实 Socket 玩家请求重新起算。任何中断前后的时间或操作都不拼接进连续窗。

### 4.2 连续窗中的操作

五个玩家按 0→1→2→3→4 循环轮换。每一轮都真实走：

1. 到本人所在的已登记安置处，经页面取得本人目录；
2. 以新的 actionId 发 single_use 包裹请求，等待生产本人原意图及真实 Accepted；
3. 实际走到原处、拿到包裹，保存新的 acquisitionId 与 takeActionId；
4. 按原义务实际放回登记原处；
5. 原请求若仍 open，由本请求者经页面正常取消，随后另一人发新请求。

每轮都须生成新的 consent/acquisition，拿取与归还均有实际权威事件及对应 Receipt。不是重读旧 Receipt、心跳、空转移动或重复点按凑时长。这些是正常权限/物权循环的技术持续运行，不计真人新贡献或玩法趣味。

每轮结束后只检查实际首请求/最后 ACK 跨度是否已经达到 900000 ms；未达到就继续下一个合法新轮次。最多 80 轮，driver 总截止时间 25 分钟。预算耗尽、动作拒绝、窗口失效均失败，绝不末尾补 sleep、加模拟时钟或降为短样本。

### 4.3 连续性证据

- 时间边界取 Playwright 实际 Socket framesent 的玩家 PublicEnvelope 与对应 framereceived ACK；相同 clientActionId 的页面 Receipt、PG Receipt、原请求须逐一相等。
- 一秒级采样五端 user/page/connection/view/controlEpoch/canControl/paused；连续窗内五端实际在线、权威控制成立、view/epoch 不变。
- 起点每页恰有一条已打开的 Socket。窗内任何 Socket close/open 都使连续判断失败，不能自动重连后拼接。
- 用同一 900 秒边界统计活动与轮次。每个完整 60 秒窗口至少有一次真实 Accepted、带领域效果、非移动/聊天/inspect 的操作；每个完整五分钟窗口五个玩家均有此类操作。采样不能出现超过 15 秒的未解释空洞。
- 60 秒/五分钟是本技术 driver 为防空等/空连接选定的证据加强约束，不是从 Spec 伪造的真人规则，也不是产品允许静默剥夺控制的阈值。
- 所有计数只取该连续窗。窗外暂停恢复单列原数据；其他短场次、服务启动时间、暖场和终态稳定观察都不计入 ≥900 秒。

## 5. E03：精确保留残差

[主 Spec 的 E03](../../docs/specs/narrative-adventure.md) 区分“团队主动结束”与“恢复条件不能维持”，并要求按实际安全安置/调查/未归还等事实记录。历史 #29 的“另两种 E03”原始逐场包未恢复，不能凭评论认定那两个样本就是任何新拟定的两个输入。

| 范围 | 现有来源与适用范围 | 当前精确残差 |
| --- | --- | --- |
| 新 v3 主动结束，已安置 | 既有 P 主流程 finishChapter 经真实页面确认；P05 包含真实原持物在 Finished 只展示剩余事项。仅能引用最终实际通过的原 candidate/run/artifact | 当前 M29 driver 不重复加一个同样 E03；需由独立 reviewer 读原终态事实判断这一行可复用 |
| 主动结束，未安置或未完成结束轮遇成员变化 | 旧 gaolao-runtime 的真实 PG 3人样本检查原轮失效与 safe=false；旧 A2 浏览器也有共同暂告一段 | 旧版本/受控主体保留原 scope；不能变为新 v3 生产 scene 尚在退让/随行时的终态证明。若当前 v3 契约/产品原证据没有对应交错，列缺口交 root 定最小补样本 |
| 只剩一人、宽限与恢复不足 | 旧 gaolao-runtime 真实 PG 样本先 NOT_READY，再受控 clock 宽限后 E03 | 不是新 v3 正常页面/真实墙钟。新 personal 停权和 scene 收束的关联需要原 v3 证据，不能用本长场“恢复成功”替代“无法维持并结束” |
| 许可/返还终态 | 已审 FM 工程投影对应、精确契约与新 P05 的原证据各有范围 | 依 GZ-CS 归口读实际证据；本准备不重新扩成 E03 × 全人数/变体矩阵，不删除这些残差，也不认定全部已通过 |

本批十个 E01/E02 场次不把 E03 标成 PASS。运行前 root 可据真正 V2 证据闭合上述精确行，或另行释放确有缺口的最小样本；本准备不自授释放。

## 6. 实际入口与静态入口

下面仅列执行方式，不表示已经执行。

列出固定计划（只加载纯 plan 与 Node 内置模块，不启动产品）：

~~~bash
node frontend/tests/cuilan-m29-browser.mjs --list
~~~

已冻结 clean 候选、root 实际释放后，登记准确 release 引用与实际 tree，再执行一个已登记 case：

~~~bash
M29_RELEASE_REF='<实际释放记录引用>' \
M29_EXPECTED_TREE='<本次真实checkout完整tree>' \
FRONTEND_EVIDENCE_DIR='<本场独立证据绝对目录>' \
node frontend/tests/cuilan-m29-browser.mjs --execute --case M29-3-PUBLIC-E01
~~~

唯一长时场次为 M29-5-PUBLIC-E02，自动要求 ≥900 秒；没有缩短 duration、跳过恢复、变成短样本或任意 count 的后门参数。M29_RELEASE_REF 是执行来源记录，不是自动审批、授权凭据或 V2 证明；外部 gate 仍由 root 和独立职责核对。

## 7. CI 草案与预算

草案目前在 tests 目录，**不会被 GitHub Actions 发现**。将来仅在实际运行释放后，由唯一 publisher 决定放入 .github/workflows/cuilan-m29.yml、固定真实输入与触发分支。现在不执行这些动作。

- 只读 contents；不保留 checkout 凭据；无需用户 secret、真实模型、外部托管或写仓库 API。
- 复用现有完整固定 action SHA、Ubuntu24.04/Node24、两个 npm lock 和对应 Chromium；不升级依赖。
- 短矩阵九项，各 job 25 分钟，最多 2 并发；driver 主场流程 12 分钟截止。
- 长 job 独立 40 分钟，在短矩阵全成功后才运行；driver 主场流程 25 分钟截止，≥900 秒仅按实际连续窗判断。
- 主流程到截止会取消本场真实在途输入；主链及受控调用再收束5秒。采集排空16秒，必要时关闭输入后再排空16秒；待写原页排空15秒（失败时实际取消并再收束5秒）。完整数据库导出60秒，连接取得及BEGIN/SET/FETCH/COMMIT/ROLLBACK均最长5秒，超时销毁该专属连接；归档尾页、连接关闭核对和manifest各自有界。四资源分别清理15秒，真实sourceEnd15秒；结果及失败回执每次保存15秒，并传实际AbortSignal，超时后不启动晚到rename。把所有互斥失败预算仍保守相加，主流程外保守预留400秒（含失败尾段），另为固定依赖/浏览器准备留窗口；因此惰性草案改为25/40分钟，避免CI先强杀而截断失败保全。主场12/25分钟和真实900秒条件均未改变。
- 最坏配置预算为 9×25+40=265 runner 分钟；这是明确上限，不是已测实际时长/费用。短场自然时长和长场暖场开销未实测，运行后仍按结果解释；超时保留失败。
- trigger 为限定 verify/cs-r2-m29 分支 push，或 workflow_dispatch。后者须工作流已进入默认分支才具备正式手动入口；不能假称新分支已有此能力。push 的 NOT_RELEASED 占位必须在真实释放后换成准确引用，否则 driver 在依赖导入/PG/浏览器启动前拒绝执行。
- 长场分支不出现在短矩阵；不通过 PR/push 两套自动触发重复计算。新的结果仅 PASS_WITHIN_CASE，整体 M29 由独立对账判断。
- 保留startup、result-before-cleanup、result、capture/和authority/的完整原始JSON页及清单、最终写失败回执、stdout和具名截图，7天。失败时目录中的已完成页也全部保留，不只上传摘要。不会上传PG数据目录、密码、登录token、缓存或完整环境变量。

## 8. 原始证据与失败清理

报告固定 case、实际 commit/tree、dirty 状态、source start/end、driver/plan/草案/实际 workflow SHA、content/map/variant/policy、独立用户/页面。元数据报告与完整原始流分开，不生成覆盖整个运行的单个巨大 JSON 字符串。

capture/page-000001.json等按观察顺序保存每条真实玩家动作、原Socket请求/ACK、受控NPC动作、完整授权复盘响应、五端连续采样、阶段、截图身份及失败尾段。每条有全局及类别顺序、真实观察时间、完整原值；capture/manifest.json列出每页首尾ordinal、类别数量、准确字节数/SHA256/数量/状态。完整性同时要求停止并排空所有主链/受控调用/观察回调、尾页已封存、页序连续、实写总数及各类别数等于已观察数、每页成功且有实际hash；空页集合不构成COMPLETE。原页最多100条或约4MiB保守内存估计，串行交给共享流式writer；待写页累计保守估计超过32MiB就停止新观察并失败；收尾footer不再受运行期预算二次拦截，finally无条件封存未满尾页并尝试排空已经捕获的原页。任一页未写、仍有在途采集或数目不齐，都明确INCOMPLETE及未写数量，不静默抛弃后补绿。记录I/O开销也属于真实测量，不外推为无采集开销的产品性能。

仅用于断言的内存索引上限为128MiB保守估计/30000行。完整request/Receipt保留于原页，索引不再复制wire.raw；复盘全文保留于原页，索引只存throughSeq、数量与重复结论，并仅为当前正在分页的玩家保留去重集合，该玩家完成后释放引用集。每次实际动作仍逐条比较原网络请求、ACK与PG Receipt。超限立即FAIL，不能裁掉原记录报通过。原始输出没有静默条数上限。单个已解码协议/PG行仍须在内存中存在；这里控制额外汇总、待写队列与索引，不声称限制产品自身内存。

authority/page-000001.json等通过同一REPEATABLE READ READ ONLY事务导出完整session行（含初始状态、内容、最终状态及实际编码标识）、全部action_receipts、spatial_intents、world_events。每次FETCH1，事件按session_seq连续输出；最多32行或约4MiB保守估计形成一页，单个较大行作为独立完整页。共享writer按64KiB块逐值写入，避免整库数组或整文档stringify。authority/manifest.json记录每页准确bytes/SHA256、同快照表计数和最终水位；编码字段完整保留供独立回放。快照明确止于该session_seq，不把后续资源关闭引发的连接变化伪装进已冻结业务窗口。导出作用域通过公开client.release(true)销毁超时连接，覆盖BEGIN/SET和ROLLBACK，不能只设置后续statement_timeout；单独记录实际end事件及未结算查询。取消后已观察的PG尾行仍用独立有界保存封存；manifest不复用已经取消的导出signal，失败时保留INCOMPLETE、全量已完成页和连接收束事实。

范围内每个真实人类动作须匹配唯一 PG Receipt 和原网络帧。翠兰全部意图只能来自生产 scene；其他内部意图仅属于三受控角色。公开路线不允许 actual apply，乔装必须有实际 apply；最后核 E01/E02、cuilanSafe、无遗漏 held 私物与各端授权分页。

正常失败保留实际错误、页面/权威可读尾段及清理前记录；没有浏览器启动条件时记ENVIRONMENT_BLOCKED。finally先通过共享collector停止新增harness监听和采样，排空已开始的真实async recap回调，再封存待写原页；随后读取同一权威快照。采集超时、写入错误、部分原数据或归档核对失败都记FAIL。

共享writer先写唯一临时文件，完整后原子rename，响应AbortSignal且rename前再检查取消；不改其内部JSON语义。每页状态记录PENDING/COMPLETE/FAIL，已完成页全保留；缺页、写失败或取消不会伪造完整清单。结果元数据同样用共享流式writer。即使result-before-cleanup保存失败，browser/Vite/server/PostgreSQL仍分别关闭，继续取得真实sourceEnd；最终result失败则尝试明确的result-write-error小回执，它不替代缺失原始数据。清理失败不能报绿。全局截止或SIGTERM/SIGINT触发主AbortSignal，阻止主链继续，并关闭浏览器、取消本场Pool作用域、释放屏障、启动服务器正常关闭。受控NPC调用的迟到结果不回到主链，所有产品SQL都经过该专属作用域；作用域关闭后禁止新SQL，仍在途查询销毁所属连接并核end。已经提交的领域动作不会因取消被回滚或改造，故障结果仍以实际只读快照为准。晚到的资源创建只交回关闭，不重新接入场次；未结算资源创建/受控调用、关闭失败或未知关闭结果一律明确FAIL，不能把等待返回当作资源已关闭。源码/输入变化同样失败。

每次使用新的独立输出目录；capture和authority目录采用独占创建，遇既有目录拒绝覆盖。完整原始页、全部场内断言、清理及首尾源码核验都成立，才可能给该场PASS_WITHIN_CASE。

本准备尚未验证浏览器/PG运行；所有这些断言与流程都是待真实执行的 harness，必须接受独立代码/范围审查。静态语法、配置解析与计划清单只能记 OBSERVED，不能当作产品自查通过。

## 9. 索引预算的实际依据

只读检查已经保存的第二轮生产原包，不重跑产品：

| 实际失败样本 | 原始result bytes / SHA256 | 完整运行跨度 | 动作量/实际字段大小 |
| --- | --- | --- | --- |
| [PR43598605725](https://github.com/gbcdby/xiyou/actions/runs/43598605725) | 23,990,624 / bfcc7cdba57413293eaab05af2bd48e0d3490f30cbf7a83b5b06085aac1887fc | 279.798秒 | 154个UI动作、177个wire请求、22个受控NPC动作；UI原JSON单条最大917B，p95=858B |
| [push43598601808](https://github.com/gbcdby/xiyou/actions/runs/43598601808) | 23,639,344 / 93cf157823fd2863ce20346204167af2dff316931094b652d47da4e98023c4d5 | 286.135秒 | 同样154/177/22；UI最大917B，p95=858B |

这是启动、实际操作、故障等待及清理在内的全样本聚合频率：约0.538–0.550 UI动作/秒、0.619–0.633原请求/秒。两份都是原FAIL，不能改写为长场通过，也没有新M29或900秒频率实测。它们没有终态复盘响应，因此不编造复盘的实测频率；该部分采用明确的计划上限。

按真实字段最大值和保守元数据模板估算：80轮×每轮20个UI动作，另留300个开局/结束动作，共1900个；原请求与ACK各预留2400个，五端采样1600次，受控NPC150次，单个正在复盘玩家最多12000个64字符引用，再留2MiB杂项。估计约73.13MiB/9350行，所以原64MiB预算不足，调整为128MiB/30000行。viewId用128字符、epoch/seq各32字符的模板是预算假设，不是伪造运行观测。

预算函数对字符串按实际UTF-8字节乘6并计对象/键额外开销，是保守计数器，不声称等于V8堆真实占用；不能拿这个计算当产品性能/内存验收。将来遇超出预算仍如实FAIL，不扩成无限队列、不裁原记录或把硬失败解释为通过。完整页由流式writer独立保存，权威worldEvents不进入这份索引预算。

## 10. M29-R1/R2 限定修正的自查边界

原准备提交16909和其独审FAIL、802观察/800落盘反例全部保留。此修正只处理原始尾页保全、真实截止/连接销毁、失败清理与中文说明日志，不改变十个场次、E01/E02、五端900秒窗、正常Vue、生产翠兰和三受控NPC职责。

局部检查从当前driver实际函数提取控制流，使用Node边界替身和父候选已审共享writer：核802行超预算完整尾页、原页写失败INCOMPLETE、BEGIN/SET/FETCH/ROLLBACK与归档总截止、迟到连接销毁、迟到受控操作不继续SQL，以及正常只读导出完整值。每个探针都读回原页/manifest并调用同一清理段取得真实源码sourceEnd；SQL/资源是明确替身，没有真实PG、产品、浏览器或900秒运行。必要定时器只在这些局部替身中缩短，生产driver的登记期限不改。新候选仍须独立复审；本地检查通过不等于M29产品或V2通过。

接口依据：[node-postgres Pool公开释放/销毁语义](https://node-postgres.com/apis/pool)；取消仅作用于本场借出的连接，不读取凭据、不操作其他进程或数据库。
