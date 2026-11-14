# CS-R2 依赖、接口与释放矩阵

> 2026-11-14 共享记录已发布：五个 CS-T 标识已映射到真实 GitHub Issues，后续有限释放及当前候选见文末[共享记录发布登记](#共享记录发布登记)。以下原计划正文保留其创建时状态，不据此否认后来已发生的建票、G0-F1 和后续 G0-D1 释放。


日期：2026-11-14 UTC。对应 [Ticket 草案](gaolao-cuilan-self-response-tasks.md) 固定 CS-R2。**本文件是本计划依赖关系的唯一来源**；下表只声明将来解除条件，所有实现/运行 gate 当前均未释放。状态 `PLANNED_NOT_RELEASED / DESIGN_REVIEW_PASS_FORMAL_PENDING`。

规划完成、接口可消费、作者候选可集成、Ticket 完成、独立验收、实际合并与部署是不同事实。CS-R2 设计双轴 PASS 不能自动满足其中任何工程 gate；正式 TLA 尚未收到，不能用旧模型结果代填。

## 1. Gate 与产物的唯一依赖表

| Gate/产物 | 前置与解除条件 | 产生/核定职责 | 允许的后续动作及边界 |
| --- | --- | --- | --- |
| **G0：按范围采用/释放** | root 明确采用固定 CS-R2；独立 requirements/standards 结果绑定该 hash；对这次拟释放范围，按 §2.3 接收所需正式形式子包/实现义务并记录实际身份、负控/见证、边界。只读合同/类型准备不一概等待 Effects×UI 全组合，涉及权利效果的部分仍各有 gate | root 核定；独立 reviewer/TLA 提供证据 | root 可以明确 `released_scope` 逐项释放；未覆盖部分仍阻塞。当前没有实际释放决定，全部仍 PLANNED_NOT_RELEASED；本计划不代 root 判断某个子包已充分 |
| **F1：冻结接口包** | G0 对 F1 范围的实际释放；CS-T01 提交本文件 §2 接口/版本/生成物/契约样本，clean commit/tree；root/相关接口消费方核对不存在悬空字段。形式前置按 §2.3 的字段/性质映射核，不以全部 UI 历史笛卡尔积一项挂起所有 schema 工作 | CS-T01 写；root 释放 | CS-T02、CS-T03 可按已释放范围与不同路径并行编写；CS-T04 可编写新 harness。F1 不证明新房间已可玩、不单独发布半成品默认版本；效果未释放时不能启用新 grant |
| **D1：权威候选** | F1；CS-T01 的各写权利路径满足 §2.3 对应 MF-CONSENT/TERM/EFFECT/CUSTODY/RETURN/RECOVERY 释放；产生固定代码、持久事实/回放/协议自查结果及明确未覆盖 | CS-T01 | 可供 scene、UI 与集成检查消费；不要求已合并、不把作者自查当独立结论。尚未放行的效果模块不能被 F1 的类型可用间接启用 |
| **D2：生产 scene 候选** | F1；CS-T02 按冻结接口交固定代码和策略/恢复范围自查。依赖真实 authority 的检查必须注明实际 D1 组合 | CS-T02 | 可供组合候选使用。D2 代码可在 D1 完工前准备；其权威联动义务不得用替身提前关闭 |
| **D3：客户端候选** | F1；CS-T03 交固定代码、表单/投影/旧收据范围自查及默认版本接线。真实本人回应的检查必须用实际 D1+D2 | CS-T03 | 可供组合候选使用；契约样本显示 accepted 不代表生产本人 accepted |
| **D4：harness/CI 候选** | F1；CS-T04 交固定脚本/workflow，明确最低层翠兰禁代答、旧版隔离、结果格式和失败行为；可先用接口编写 | CS-T04 | 只有达到 IC 才执行并统计新产品路径；脚本语法/构建不计 GZ-CS 产品 PASS |
| **IC：完整固定集成候选** | D1+D2+D3+D4 的可消费固定 commits；root/唯一集成执行者形成一个 clean commit/tree，并记录每个来源、Spec/F1/模型身份与 diff；共享文件归属已核 | root 指定唯一集成/land 职责 | CS-T04 执行 E2，独立职责开始固定候选核验。可先集成阶段产物而不先宣称所有 Ticket 完成，避免自依赖循环 |
| **E2：两人生产技术证据** | IC；正常新默认入口 + 两正常客户端 + 真实 HTTP/Socket/Vue/PostgreSQL/Chromium；按 coverage P-01～P-06 及补充契约样本实际运行，有清晰 profile/run/artifact | CS-T04 作者；独立者复核 | 为 CS-T05 提供运行输入；只释放“受控三 NPC、生产翠兰本人”的新增技术范围候选。不能释放 #29 全集、真实 provider 或真人体验 |
| **FM：实现义务对应已核** | G0 的正式模型包 + IC；逐条把模型动作/不变量/反例映射到真实代码、事务边界和产品证据，缺口/模型外范围显式保留；行为发生变化时重评受影响模型 | 独立形式/审查职责；root 核定归属 | CS-T05 最终 V2 结论可引用。模型不覆盖连续几何/网络/真人时不得推成这些项 PASS |
| **V2：独立新增范围验收** | IC+E2+FM；独立 worker-verify 对 GZ-CS-01～12 的实际证据分层核对；worker-review requirements/standards 分轴，无未闭阻断，列全部 NOT_RUN/ENVIRONMENT_BLOCKED | CS-T05 的独立负责人 | root 可按实际范围释放 CS-R2 技术切片；不得自行关闭整个 A3/#29 |
| **M29：更广覆盖对账** | IC 的影响面 + V2 + 现有证据身份；按 coverage §5 列 2/3/4/5 人、2/5 分支、5 客户端连续 ≥900 秒的已有有效/需补/未运行；实际新增运行另固定候选 | CS-T05，root 核定补测范围 | 精确推进 #29 仍缺技术项；不是仅写矩阵就通过这些项 |
| **L：实际集成/合并** | root 对具体目标授权保持有效；唯一 land 对真实 remote main/head/lease、当前 review/CI/冲突和范围再核；按具体 Ticket 完成条件决定关闭关系 | 唯一 land 执行者 | 记录真实 merge commit/tree/Actions；本拆票 agent 不执行公有写入。合并不等于部署或完整产品验收 |
| **R：已约定发布目标** | L + root 针对实际目标的有效发布范围 + 该目标必要验收；新默认内容/服务端/客户端版本兼容已核 | worker-release / root | 仅该目标的实际发布结果；PR54 的旧静态发布成功不等于新个人回应已部署 |

CS-T05 可以在 FM 收口前并行运行独立产品检查；**V2 的最终完成**才依赖 FM。同理 IC 只依赖固定可消费候选，不依赖这些候选已经拿到 E2/V2，故没有“先整体通过才能组候选”的环路。

当前起始候选是“root 对 G0/F1 范围作实际释放后，由 CS-T01 交 F1”。无需让未相关的完整 UI 历史组合成为一切准备工作的串行前置。这只是规划快照，实际分派前 root 重新核对主线、职责、权限、活动文件与最新采用状态。

## 2. F1 必须具体到什么程度

### 2.1 版本与默认入口合同

下列是 R2 的版本方案和实施冻结义务，均未声明已经注册。F1 须提交真实表值和解析/恢复样本，不能留下“v3 family/最新版/有字段就启用”之类判别。

| 维度 | 新内容候选 | 保留/门禁要求 |
| --- | --- | --- |
| contentVersion | `gaolaozhuang-scene-v3`、`gaolaozhuang-tools-east-scene-v3` | 新增两份注册与 digest；旧 `gaolaozhuang-v1`、`gaolaozhuang-tools-east-v1`、两份 scene-v2 的内容与 digest 原样保留 |
| chapterVersion | `gaolaozhuang-chapter-v3` | 新旧章节按持久值解释，不给旧 Session 注入 personalRequests、permissionTerm 或新来源 |
| policyVersion | `gaolao-cuilan-v2` | v2 严格 rescue/follow/appearance/private_items 分支；保留 `gaolao-cuilan-v1` parser 与 N1～N6 basis 解释 |
| 公有协议 | 继续 `schemaVersion:2` / `spatial-v2`，显式增加 `gaolao-personal-consent-v1` | 新客户端能力须在 create/join/claim或bind/snapshot/sync/action/reconnect 全入口按对应 Session 核验；缺能力对新内容明确 UPGRADE_REQUIRED，旧内容仍可进入 |
| reducerVersion | **F1 必须冻结一个明确的新解释器身份**；命名可采用 `gaolao-world-v2`，真实值由 T01 连同 schema/dispatch 一起交付 | 不用旧 `gaolao-world-v1` 字面量或同 family 自动套新语义。若提出不同等价分派方案，先证明满足主协议精确持久版本/旧事件原解释承诺并交 root 核定，不由下游猜测 |
| map / variant / seed | 继承对应变体的精确地图与布局（当前 `gaolao-layout-v1.1`）、持久 variantId/seed；F1 列出各实际值 | 不因新本人来源增加或替换 world/layout。内容几何比较与三个会面点/两安置区隔离检查保留 |
| 默认“高老庄”入口 | 新创建选择 `gaolaozhuang-scene-v3`；CS-T03 实际 UI 接线 | 既有房间按自己记录的 contentVersion 进入；旧版环境覆盖仍可用于明确历史回归；新验收至少一例不覆写默认值 |
| 正式资源 | 新默认版本到原批准默认布局/场景/物件资源的**逐个精确映射** | 原 65 PNG / 18 批准新原图字节不变。未知版本、不同布局或 tools-east 不自动套默认资源；不得用正则/family 前缀放开全部未来版本 |

除新增 `gaolao-personal-consent-v1` 外，既有 `spatial-appearance-v1 / spatial-object-visual-v1` 协商与视图字段保留各自含义。新能力不能通过“删掉 lifecycle/返还字段再降级发送”兼容旧客户端，客户端也不能把缺字段默认为 active/同意。

实际源码接点包括：`content/gaolao-object-visuals.mjs` 的 v2/reducer 精确筛选；前端 `gaolao-object-art.ts` 的 catalog.contentVersion 比较，`gaolao-scene-layers.ts` 的场景版本比较；`SpatialSessionPage.vue` / `spatial-summary.ts` 的 reducer 字面量；`check-runtime-assets.mjs` 和静态浏览器脚本的旧 v2 固定值。F1 写出谁更新哪个条件、其精确映射和新旧负例，不允许只改 Lobby。

### 2.2 公有与持久接口包

F1 必须覆盖如下并各有至少一个有效样本和针对风险的拒绝样本：

| 接口组 | 冻结产物 | 消费方 |
| --- | --- | --- |
| 请求 | `gz-describe-private-items`、两种 request 的闭集参数、permissionTerm 两值、replacement、cancel_personal_request；当前公开 targetRevision CAS 与两版本取消约束 | CS-T01 authority；CS-T03 表单；CS-T04 页面映射 |
| 投影 | 目录 offer/option token 及 scope；personalRequests 当前生命周期/决定关联；privateReturns 的 0～2 完整集、当前 refs、nullable ownerRef、origin、模式与历史来源字段 | CS-T03/UI、CS-T04/E2、CS-T05 |
| 持久事实 | personalRequest、proposalBinding、immutable accepted proof、每 grant/item 的取机会消费、当前取得/holder/owner/origin 与 delivered_to_owner/restored_origin 结果；原 Receipt 和原 intent 保存不变 | CS-T01 实现，CS-T02 basis/通知读取 |
| 来源/通知 | 两份 sourceId、版本/digest/receivedSeq、仅本人 provenance 的查询白名单；原真实请求摘要与该份 grant 的持久中断通知；无远处当前物件/旁人隐藏身份 | CS-T02 输入；CS-T01 写入与投影 |
| scene 对接 | 按 purpose 的输入与 basis 字段，准备/提交同 choice 重算的依赖集合，原 actionId/digest/stepKey；授予 accepted proof 用实际响应后版本，prepared basis 不回写 | CS-T01 权威使用守卫与 CS-T02 私有 parser/重验 |
| 事务挂点 | 控制变化、取消/替换/撤回、公开揭明、自愿解除、终态、take/transfer/put 的同事务 effects/notice/revision/Receipt；scene 唤醒只消费已提交相关事件 | CS-T01 runtime/domain 与 CS-T02 通知调度 |
| 恢复 | 老/新解释器分派、旧 Receipt 优先、原请求重试、history/window/view 重建 privateReturns、技术 Unknown 与语义 pending 分离 | 各票沿同一合同；不得新建第二套合并器 |

接口冻结不是用完整测试替身模拟产品结果。F1 的 accepted DTO 样本只是 schema 样本，无法替代 D2 生产本人 actual accept。来源与原取得记录的 schema 可以预先冻结；旧房间没有这些字段时如何走旧分支必须同时写清。

### 2.3 接口/实现对具体形式性质的依赖

下表 `MF-*` 是规划映射键，见 [coverage §3](gaolao-cuilan-self-response-coverage.md#3-风险负例与形式性质的对接)；不是虚构 TLA 文件名或运行结果。root 已告知 Terms/Consent/Recovery 有真实正例/负控、Effects 与 UI 缓存组合仍在检查，但本规划尚未收到可据以正式释放的固定全套交接，因此不预填任何 MF 的 PASS。实际 model/config/subject 与充分性判断由独立 TLA 负责人提供，root 决定释放范围。

| 性质映射 | F1 可以先固定的接口/资料 | 对应可执行路径的必要形式义务 | 不应误作串行前置的范围 |
| --- | --- | --- | --- |
| **MF-VERSION：版本/能力/来源边界** | 精确版本表、capability 枚举与 DTO、两来源 sourceId/digest 结构、旧/新解析分派样本、明确资源版本映射 | 旧状态不被新规则重解释、缺新字段不授予权限，主要由严格 schema/静态审查和新旧持久恢复契约验证；若正式模型另列版本假设，映射并核对 | 没有新权利执行的类型/说明/资源 alias 准备，不需要等完整 Effects×UI 状态图。实际默认新房间启用仍等 IC/E2 |
| **MF-TERM：请求意向/单次范围** | two-term 请求枚举、scope/digest 字段、两物逐件消费字段；合法 proposed/reusable 样本 | reusable 可 proposed/本人 decline，但不能形成可用 grant；改意向必须新请求；每物各一次且先还第一件不耗尽第二件 | 表单展示询问与 schema 的合法枚举不要求先证明所有重连历史组合；accepted/apply/take 代码释放须有此性质的正式结果 |
| **MF-CONSENT：身份/CAS/两轴** | consentId/公开 revision/两版本/replacement/cancel DTO、原本人决定与 lifecycle 分开的字段 | 真本人归因、当前槽唯一、同 revision 至多一提交、旧请求/另一用途不串用、取消不伪撤回、原 proof 不重写 | UI 文案/不可执行 DTO 可先准备；权威创建/替换/决定路径和 scene 的响应提交须匹配正式 Consent 范围 |
| **MF-EFFECT：同事务停权** | accepted proof/execution/失效通知的结构与 authority-scene 挂点合同 | apply/take 与 cancel/withdraw/replace/控制/公开结束的交错；先停后无新使用、先用后保留历史再停，外貌/权利无残留中间窗 | 不把所有 UI 历史长短组合绑在类型、来源或纯决定表前；真正权利效果和产品切片释放必须等受影响原子性义务 |
| **MF-CUSTODY：唯一持有/原取得/窄归还** | 原取得身份、真实 owner/registeredOrigin、每件结果与 return_only 结构，普通 transfer/put 参数约定 | 持有唯一、旧取得不被新槽接管、归还不复制/传送/恢复 take、不准第三人/公共领回，delivered 与 restored 分开 | 前端可以先据固定 DTO 构建只读返还说明；真实 take/return 写路径不因 UI 已完成而提前释放 |
| **MF-RETURN：独立返还集合/当前投影** | `privateReturns = 当前本人持有且有本次原取得事实` 的完整集合、ownerRef=null、fresh refs 与既有 view/seq 接收义务 | 新槽/重连/裁剪不丢旧持物；仅真实处置清对应项；旧 Accepted 不复活 grant/覆盖当前 projection；上下文只给实际持有人 | 复用既有 view/generation/seq 合并器，无须强建第二套 UI 状态机。形式负责人可拆集合性质与旧收据交错，须说明组合假设，不要求盲目全历史笛卡尔积 |
| **MF-RECOVERY：原身份/待办/有限公平** | 原 intent/basis/stepKey、pending/last 水位、scene 接口、原 Receipt 读取协议 | 原请求一次效果、Unknown 原文重试与有界重试、纯恢复不另作决定、两用途不吞水位/不饥饿、真实语义不丢，失效 grant 不重活 | 与 UI 布局、资源映射、只读目录样本无硬依赖；新 scene 生产提交/恢复执行须有该范围正式实现义务 |
| **MF-SAFETY：旧安全/路线保持** | 原 N1～N6/SP06 接口不变、旧 v1 basis 保留、safe/history 单调约定 | 两新用途不改 follow 授权/旧到达、CuilanSafe 和发生时身份历史保持；形式影响清单说明哪些旧结果适用及哪些要增量 | 不重复跑不相关模型或声称旧模型证明新增私物；精确几何、C13 真实走法仍由产品定向验证 |

这种分解只减少不相关等待，不降低完成门槛：IC/E2/V2 依赖实际所用的所有权利路径都已获得相应释放。若独立 TLA 指出两性质之间尚缺关键组合交错，则只把受影响接口/效果/验收留在 NOT_RELEASED；其它已明确无依赖的准备可由 root 放行。

## 3. 文件与资源的并行边界

| 写入组 | 唯一 writer | 并行/串行条件 |
| --- | --- | --- |
| protocol/content、生成物、game world/rules/projection、runtime/server/capability、精确 visualKey 版本映射 | CS-T01 | CS-T02/03 只消费 F1。生成代码如影响前端/AI 类型仍由 T01 统一生成 |
| 三个 scene 源文件、scene 专用 support/test、scene runtime 文档 | CS-T02 | F1 后与 T01 后半/CS-T03 并行；不直接改 T01 runtime hook 或 gaolao-world |
| 前端生产组件/动作/默认入口/资源适配/asset checker 和其单元测试 | CS-T03 | F1 后并行；不写 package.json/CI/端到端 support。现有 session/view 合并边界默认只读 |
| e2e support、browser checks、frontend/package.json 脚本、workflow | CS-T04 | F1 后可以准备；真实执行等待 IC；旧检查 scope 必须保留，不能与前端作者同时改 support |
| 正式模型目录及 TLA 结果 | 已有独立 TLA 职责 | 五票均不覆盖该 writer；接收固定产物与实现义务，不复写旧 finite PASS |
| 集成候选、远端分支、Issues/PR/评论、合并与发布 | root 指定唯一 land/release | 每次 mutation 前重新核对实际候选/归属；本规划不执行 |
| PNG/批准原图/world-layout 资源 | 本计划没有 writer | 字节与实际布局不变；必要数据版本映射不是重新设计素材 |

重叠需求只冻结准确接口/路径再移交当前 owner，不把整个 Spec 全串行。任何票输出 helper 必须放入自己的目录职责；若 helper 实际承载另票权威变化，按职责归属移交，不能靠另起文件绕过所有权。

共享数据库/浏览器证据也按 candidate/task 隔离，不能复用另一个正在运行的房间当自己的当前证据；正式 CI job 保留独立端口/数据库与输出目录。已有 Git-backed 工作树不重复保存到其他产物系统。

## 4. 候选和证据身份

每次可消费 F1/D1～D4/IC 的交接至少包含：

- `ticket_ref`、固定 `spec_ref`、`head_commit/tree/base_commit`、clean/dirty 状态及准确变更路径；不使用漂移分支名“最新”作输入。
- F1 内容/协议/解释器/策略版本表、注册内容 digest、需要的生成物身份；D2 的依据与通知白名单；D3 的实际默认创建版本；D4 的 harness/workflow digest。
- 消费的上游 artifact ID/commit；阶段产物可用范围与尚缺工作。若不同来源等 tree，记录等树证据，不能伪造同 commit。
- 检查的 `kind`（source_inspection、contract、database/network、production_browser、finite_model）、`status`、真实命令/环境/profile、结果、未覆盖。

每份 E2/V2/M29 运行证据还须包含：候选/完整工作树头尾身份、content/chapter/map/variant/seed/reducer/policy/capability、人数与角色职责、运行时间/连续区间、Node/PostgreSQL/Chromium 版本、受控 NPC/provider 配置、外部 provider 调用数、实际人类页面动作与 Receipt、scene 自己的 intent/action/Receipt/来源联系、截图及摘要、失败时点与清理。私有内部依据用于可信审计不能混入玩家公开输出。

有限模型包单列实际 model/cfg/hash、常量规模、BFS/死锁/liveness 配置、distinct states 与下限、每个声明性质的真实负控 `rc=12`、正例可达见证、实现映射与模型外部分。这里未收到任何 R2 数值或结果，全部保持待接收。

## 5. 释放账目与未决项

| 事项 | 当前状态 | 谁可改变、依据是什么 |
| --- | --- | --- |
| CS-R2 文档独立需求/标准 | PASS，source_inspection only | 已有固定报告；不会被本计划改写为产品验收 |
| root 正式采用/释放实现 | NOT_RELEASED | root 对固定 CS-R2 及相关形式义务的实际决定 |
| R2 正式有限模型/TLC | FORMAL_PENDING | 独立 TLA 的真实包；旧 AP/SceneRequest/SceneFollow 结果不能顶替 |
| F1 与 D1～D4 | NOT_CREATED | 对应 writer 的真实提交及 gate 核定；本计划中的建议名称不是已有注册版本 |
| 两人新生产本人路径 E2/V2 | NOT_RUN | IC 上实际运行与独立核验 |
| #29 更广受控技术覆盖 | 未由本计划评估/释放 | M29 对具体旧证据的适用性检查和必要补测，不能把旧 v1 A2 改名为 v3 |
| 真实 provider / 真人四局 / 真机 / 艺术 | 分别未由本计划执行/释放 | 各自实际证据与有效授权，不由有限模型/技术页面检查代替 |
| PR/合并/部署 | 本计划未执行 | 唯一 land/release 的实时事实；原 PR54 静态成果保留原范围 |

一般实施没有新的人工作业许可问题；未释放是 root 尚待采用和正式形式输入的**技术/设计 gate**，不是要求用户再次批准日常动作。新协议具体命名、生成位置、数据索引属于 T01 在冻结合同内的实施选择；如果需要改变人格偏好、私物用途/接收者、同意/恢复含义或旧版本保证，则是返回设计的实际范围变化。


## 共享记录发布登记

2026-11-14：已建立 [CS-T01/#55](https://github.com/gbcdby/xiyou/issues/55)、[CS-T02/#56](https://github.com/gbcdby/xiyou/issues/56)、[CS-T03/#57](https://github.com/gbcdby/xiyou/issues/57)、[CS-T04/#58](https://github.com/gbcdby/xiyou/issues/58)、[CS-T05/#59](https://github.com/gbcdby/xiyou/issues/59)。原 `35d8759` 计划的未建票/未释放字样保留其时间与对象；本节登记后来事实，不改写前文 gate 定义。

- **G0-F1 历史与后续 G0-D1 裁决**：原 G0-F1 只释放合同/schema/精确版本准备；总控在 2026-11-14 08:53 UTC 的 v15 记录明确采用 CS-R2 为候选实现基线并释放 G0-D1。CS-T01 原执行者 `/root/cuilan_authority_implement` 在独立冻结 F1 后继续完整权威候选；本次没有改派或覆盖现场。这是实施范围的释放，不是完整形式或产品门槛通过。
- **F1 已固定并作为消费基线**：`f96474f6d85d5bb6eb765f8c881d5f7aa7600e4f` / tree `ee9e2618a63541099e2242e1e93c4749fa95c484`，parent `35d8759`，22 文件。总控接收的作者合同检查为 59/59、0 fail/0 skip，两个生成器、schema 和 TypeScript 消费者检查完成；runtime/DB/browser NOT_RUN。本轮补充独立代码/合同审查仍在进行，不将作者证据写成独立 PASS，也不否认已经发生的消费基线接受。
- **T02/T03 已有明确释放**：T02 已按固定 F1 分派给 `/root/cuilan_scene_consent_design`，角色为 worker-implement、独占 controller 工作树，v15 截点待 ACK，不预填已运行；T03 的 F1 消费与隔离候选实现已释放，v15 截点仍待执行槽位分派。实际领取/工作区以后续 Issue 记录为准，不能抢占旧 writer。
- **正式模型包已交接，组合未知保持**：`77ace28f526ce9ad905b1842b7353e48e251423c` / tree `006fc92d3cd261bddf22f698871e44b6434be36e`。作者状态为 `COMPONENT_DESIGN_EVIDENCE_COMPLETE_WITH_COMBINED_INCONCLUSIVE`：28 个 PASS_WITHIN_SCOPE、98 个 COUNTEREXAMPLE（60 负控、37 见证、1 旧缺口方向探针）、5 个 INCONCLUSIVE；131 个选定配置中 126 符合预声明，不是 131 个正向 PASS。两用途完整效果与四个完整缓存组合未穷尽；独立模型复核、实现对应及 FM/V2 仍待，不把组件结果改为机械组合证明。
- **T04-A 已接受为可整合候选**：`c4b1674eebbdfbfbdacdde30beddb665c1af06b4` / tree `a88beb0fdfbe923462f1f60b6ae7417425eb7a6b`，parent `35d8759`，两文件的 production profile/受控 NPC 适配器防绕行准备。原独立 reviewer 两轴 PASS，并执行 11 次禁用/2 次合法替身调用；本轮另一独立快照的现有 5 项边界检查也为 5 PASS、exit 0，分别保留证据身份，不相加成产品验收。无真实浏览器/PostgreSQL/E2，不等于完整 D4/E2 或全局宿主安全沙箱。
- **仍待完成的门槛**：D1 尚无 v15 收到的完成候选；T02/T03 实施与独立候选检查、完整 T04/IC/E2/FM/V2/M29、主线合并及部署分别保留实际证据边界。建票不代总控新增 release，也不关闭任何实施票。
本文件继续作为规范依赖/产物条件的唯一来源；活动归属、实际释放、候选与结果由 [#34 的 CS-R2 接续记录](https://github.com/gbcdby/xiyou/issues/34)及对应 Issues 维护。本节是本次发布时点的事实快照，不新建长期并行状态表。新默认 v3 尚未因本次文档发布而启用，原 65 PNG/18 批准图、world/layout、当前业务文件全部未改。


### F1 后续独立 finding

本次共享记录发布期间，固定 F1 `f96474f6` 的独立契约探针确认 [R-CS-F1-RETURN-001（#55，OPEN）](https://github.com/gbcdby/xiyou/issues/55)：原取得返还 helper 把权威持物 `character/characterId` 误读为替身/wire 形状，实际两件持物与取得事实会返回空集合。固定候选不能整体写成独立 PASS；作者现场已有未冻结修复迹象，等待固定提交后独立复审。本记录不重复修改原在途目录，不把实现释放改成验收通过。T02/T03 的独立工作区后来已被只读观察到存在，存在性不等于 ACK、运行或完成，当前归属继续由对应 Issues 核对。
