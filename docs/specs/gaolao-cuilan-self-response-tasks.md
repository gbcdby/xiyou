# 翠兰借貌与私物本人回应：实施 Ticket 草案

> 2026-11-14 共享记录已发布：五个 CS-T 标识已映射到真实 GitHub Issues，后续有限释放及当前候选见文末[共享记录发布登记](#共享记录发布登记)。以下原计划正文保留其创建时状态，不据此否认后来已发生的建票、G0-F1 和后续 G0-D1 释放。


## 1. 固定输入与本次终点

本文件是 `GZ-SCENE-CUILAN-SELF-RESPONSE-001 / CS-R2` 的本地拆票候选，日期 **2026-11-14 UTC**。规划结果 `COMPLETE`；所有下列 Ticket 均为 **`PLANNED_NOT_RELEASED`**，共同设计门槛为 **`DESIGN_REVIEW_PASS_FORMAL_PENDING`**。没有创建 GitHub Issue、领取实现、修改公共分支或执行产品验收。

| 输入 | 固定身份及用途 |
| --- | --- |
| 唯一行为 Spec | [gaolao-scene-policy.md](gaolao-scene-policy.md) §0.1、§10～17；CS-R2 commit `1a7f45ddfeca0d25fb3714e1ce45980b225d5bde` / tree `6b0130cd6838bf052504994527f05e29aabf521e` |
| 原修订 | CS-R1 `76d98e137f5220518b072650ba6af8001966ea23` / tree `18287fbcde9590c6ce83a82ee747dfafaccdfe46`；原双轴 FAIL 历史保留 |
| 可读取源码基线 | `2e46abfc528c21824ad5eb2b93d91a6cc7c532a8` / tree `b54f1b52b3588ac2dc28c108e6b55f04bd059675`。本次实际核对 R2 相对此基线仅三份 Spec 文档变化 |
| root 已核正式主线 | `main@c906de29a121edca2fc43422687b0d0bc869fba0` / 同 tree `b54f1b52b3588ac2dc28c108e6b55f04bd059675`。该 commit 尚不在本地对象库；本规划不伪造远端提交或据此拉取。后续 land 以真实 main 及实际 lease 为准 |
| 独立设计复审 | `/root/a1_a3_next_work_inventory` 的《CS-R2 独立增量审查》，2026-11-14，requirements PASS / standards PASS，仅 `source_inspection / OBSERVED`；报告 SHA-256 `ec71dbe8d8432b2f0bdf5a0eb7bc39bfa75e330a5276c43dcaeecd0adbcaab60`。RETURN-PROJECTION、PREFERENCE 两项仅在固定 R2 设计范围 VERIFIED |
| 独立形式工作 | `/root/cuilan_self_response_tla` 正在形成受影响增量；本规划未收到正式固定结果，不预填模型名、状态数或 PASS |
| 共同兼容依据 | [adv-protocol.md](adv-protocol.md) §1.1～1.2、[工程约定](../engineering.md)、N1～N6、GZ-SP-01～08/SP06，以及各自原候选的实际证据 |
| 现有任务入口 | [#23](https://github.com/gbcdby/xiyou/issues/23)、[#27](https://github.com/gbcdby/xiyou/issues/27)、[#33](https://github.com/gbcdby/xiyou/issues/33)、[#34](https://github.com/gbcdby/xiyou/issues/34)、[#29](https://github.com/gbcdby/xiyou/issues/29)。这些是既有入口，本地 `CS-Txx` 不是新建平台编号 |

本计划按项目已有 `docs/specs/*-tasks.md` 形式保存可审 Ticket，未改原 Spec、Spec 索引或项目现状。后续唯一 land 执行者若发布实际 Tickets，先查重，并把稳定草案 ID 映射到实际 Issue；届时任务归属、依赖与状态以实际 Issue 正文为唯一来源，本文件保留该版本的规划快照，不另建平行看板。

**依赖与释放的唯一规划来源：** [release 矩阵](gaolao-cuilan-self-response-release.md)。本文件各票的 `depends_on` 只引用其中稳定 gate，不另维护依赖图。逐项验收责任、负控与新旧恢复矩阵见 [coverage](gaolao-cuilan-self-response-coverage.md)。三份文件是同一计划，均不替代行为 Spec。

## 2. 最小交付拆分

| 临时 Ticket | 可独立交付的结果 | 主要产物 |
| --- | --- | --- |
| CS-T01 | 新版本严格合同、持久事实、权威原子效果及授权投影 | `F1` 接口包；`D1` 权威候选 |
| CS-T02 | 安置后仍工作的单一生产 scene 控制器 | `D2` 生产本人策略及恢复证据 |
| CS-T03 | 正常页面的询问、取消/改约、逐物归还与新默认入口 | `D3` 客户端候选 |
| CS-T04 | 新版本两人生产页面 harness 与独立 CI job | `D4` 检查程序；`E2` 作者两人技术证据 |
| CS-T05 | 固定集成候选的独立验收、双轴审查和 #29 覆盖对账 | `V2` 独立结论；`M29` 差额与证据映射 |

不把同一事务的 lifecycle、借貌停用、逐物取得/归还事实和投影分给多个 writer。CS-T01 先交可消费的 F1，CS-T02 与 CS-T03 再按不同路径并行；CS-T04 可在接口冻结后编写检查，但有效执行必须针对真实组合候选。CS-T05 是独立验收职责，不让实现作者给自己的候选签独立 PASS。

## 3. CS-T01：权威合同、版本、持久事实与投影

- `ticket_ref`：**CS-T01（草案，未建 Issue）**；建议关联 #27/#32，整体验收归 #29。
- `spec_ref`：本文件 §1 固定 CS-R2，重点 §11.1～11.2、§12～14、§15；主协议 §1.1～1.2。
- `acceptance_ids`：GZ-CS-01～11 的权威/合同部分，GZ-CS-12 的原身份和预算接口边界；具体负责关系以 coverage 为准。
- `depends_on`：release 中 **G0**；先交 **F1**，再交 **D1**。消费正式 TLA 的实现义务，不以模型运行替代数据库/协议检查。
- 所需能力：协议、内容 schema、Session 事务、事件回放、授权投影。尚未分派负责人。

### 3.1 输入与允许写入

输入是固定行为 Spec、精确旧版本内容/摘要、当前 authority 源码、独立形式输出及已有 N1～N6/SP06 合同。唯一 writer 范围：

| 路径 | 允许变化 |
| --- | --- |
| `protocol/spatial-schema.mjs`、`protocol/spatial.mjs`、`protocol/gaolao-v2.md`，必要时新 `protocol/gaolao-personal-consent-v1.md` | 新个人用途闭集形状、合法意向、取消动作、目录/请求/逐物返还 DTO、精确版本分派和错误合同；旧动作解释保留 |
| `protocol/scripts/generate-spatial.mjs`、`protocol/scripts/generate-spatial-ai.mjs` 及其实际生成目标 | 从单一源生成 `protocol/spatial.schema.json`、声明、`game/spatial-types.ts` 和确受影响的 AI schema/类型；不得手改生成物或扩大模型权限 |
| `content/index.mjs`、`content/spatial.mjs`、`content/gaolao-schema.mjs`、`content/versions.json`、生成的 content schema；新两份 `*-scene-v3.json` | 注册精确新内容/章节/解释器，初始化两份新本人来源；旧 v1/scene-v2 内容字节与注册摘要不改 |
| `game/gaolao-rules.mjs`、`game/gaolao-world.mjs`、`game/spatial-rules.mjs`、`game/spatial-world.mjs`、`game/spatial-appearance.mjs`；必要时同目录 `gaolao-personal-*.mjs` | CAS、两轴状态、不可变 accepted proof、原子失效/停用、按件使用与原取得事实、窄归还、投影与精确解释器识别 |
| `game/gaolao-policy-route.mjs` | 仅新版本兼容接线及旧路线合同保持；不改变 C13、区域、行走边界。CS-T02 只读此文件 |
| `backend/runtime.mjs`、`backend/spatial-runtime.mjs`、`backend/server.mjs`、必要时 `backend/gaolao-recap.mjs` 与一份新 migration | capability 在 create/join/bind/snapshot/action/reconnect 的实际校验、原 Receipt 优先、控制/终态事务挂接、持久恢复；若现有 JSONB 足够，不为拆票强建表 |
| `content/gaolao-object-visuals.mjs` | 新默认内容对原批准 visualKey 的精确已注册版本映射；不得扩大成 family/前缀通配，不改 asset 字节 |
| `backend/ai/spatial-context.mjs`（仅必要兼容）、`protocol/tests/`、`content/tests/`、新 `backend/tests/gaolao-personal-*.test.mjs`，必要的既有 `gaolao-private-items` / `gaolao-follow-proposal` / `gaolao-recovery` / `spatial-appearance` 测试和 `backend/test-support/gaolao-room.mjs`、`backend/gaolao.md` | 新投影到已有自主角色合法输入的兼容及泄露负控；不改变 Gateway、provider、预算、调度或 persona。`scene-policy-*` / `scene-personal-*` 测试由 T02 独占 |

不写 CS-T02 的三个 scene 源文件、CS-T03 前端、CS-T04 CI/harness、任何 PNG、原 Spec 或形式 worker 的模型。需要边界外变化时，先以准确文件和原因交 root 协调所有权；不在相邻票的工作树顺手修补。

### 3.2 交付内容

F1 按 release 冻结精确版本表、公有 schema、私有 authority/scene 对接字段、逐物投影选择式、内容来源、生成物和合法/非法样本。F1 不要求 D1 已完成，也不表示新房间已可发布；下游不得根据口头字段自行猜实现。

D1 必须形成一条真实权威链：

1. `permissionTerm` 可合法提出 `single_use/reusable`；reusable 不在 schema 层变成人物拒绝，但 authority 独立阻止其 accept/apply/take 变可执行 grant。提议用当前公开 `expectedTargetRevision` CAS；非参与者不读私有槽、不猜 0。
2. `personalRequest` 的 lifecycle 与最后本人决定分开；取消、同人显式替换、第三方竞争、绑定失效、真正本人 withdrawn 归因准确，旧/另一用途请求不能串槽。scope 与 proposalBinding 不可变；accept proof 只绑定实际 accept 产生的新版本。
3. apply/take、取消/替换/withdraw、控制围栏、公开揭明和终态在同一 Session 顺序中原子收束授权、外貌/返还模式、版本、通知与 Receipt。不能等 scene 下一回调才停权。
4. 每枚举私物各有一次 take 机会；先交回第一件不耗尽第二件，已归还/原处放回的同件不能借旧 grant 再拿。真实本人已持有项记录已有事实，不造取送事件。新合法安排可另处理，但不重写旧取得来源。
5. 持久原取得事实含取得动作、旧 consent/实际接受版本、实际经手人、真实物主和登记原处，独立于近期观察/同意窗口。`privateReturns` 从**当前本人持物 ∩ 本次持久原取得依据**派生，0～2 项完整；原槽被新请求占据、换 view/epoch、历史落窗均保留。仅真实归还动作移除对应项。
6. 普通 `transfer_item/put_item` 实现窄 restitution：真物主或原处、当前 holder/ref/revision/空间守卫独立校验；不要求旧 grant 恢复有效。`ownerRef` 不可见为 null，原处仅历史授权位置。原处放回为 `restored_origin`，不能写实收/fulfilled；不给阅读、新取、第三人转交或公共领回权。
7. 旧房间按精确旧解释器/内容继续恢复，新来源只在新开局写一次。新字段缺失不能默认 accepted/active/single_use。任何新版本不完整状态均不能静默获得权限；旧合法状态不能被新守卫误拒。

### 3.3 完成条件与身份

本票对其变更安排有意义的协议正反样本、真实 PostgreSQL 事务/回放/重连和对照测试，至少覆盖 coverage 中 C-V01～C-V08、N-01～N-09 的权威部分、GZ-CS-04～10，并核 N1～N6/SP06 受影响部分。这些是未来执行义务，本规划均 NOT_RUN。

交 D1 时提供 clean commit/tree、相对 F1 的完整 diff、内容 digest/生成器结果、数据库 schema 身份、明确的检查输入/结果和未覆盖项；独立 review 到本票范围通过后可作为集成输入。D1 不等于生产本人回应、完整 CS 验收、合并或发布。原子性/归还/兼容的设计含义变更须回设计，不能靠测试期望改写 Spec。

## 4. CS-T02：单一生产 scene 控制器

- `ticket_ref`：**CS-T02（草案，未建 Issue）**；建议关联 #34。
- `spec_ref`：固定 CS-R2 §11、§14.3、§15；旧 §4～6/N1～N6。
- `acceptance_ids`：GZ-CS-01/02/03/05/08/09/11/12；对 GZ-CS-07/10 提供本人来源/归因证据。
- `depends_on`：release 中 **G0、F1**。可在 D1 尚未完成时按固定接口编写；本人真实效果的作者完成证据须使用 **D1+D2** 的固定组合。
- 所需能力：纯策略、严格 basis、持久意图恢复、语义唤醒。尚未分派。

### 4.1 允许写入与产物

只写 `game/gaolao-scene-policy.mjs`、`backend/scene-policy.mjs`、`backend/scene-policy-runtime.mjs`、已有 `backend/tests/scene-policy-*.test.mjs` 和新 `backend/tests/scene-personal-*.test.mjs`，以及 `backend/scene-policy-runtime.md`。已有 `backend/test-support/scene-policy-room.mjs` 如需扩展由本票独占，不能在生产页面证据中代答翠兰。T01 持有通用 runtime/server、domain、schema；缺钩子时提交准确接口需求，由 T01 落地。

D2 实现 C0～C8；safe/settled 仅结束救援分支，仍处理 appearance/private_items。等待 follow 到达不阻止合法私物请求取得 C3。同级个人请求按 sourceSeq，确有通知的撤回优先；一个控制器/一个未收束意图，自己的提交继续唤醒另一待办。无 provider 配置也能工作，不进入 Gateway/ai_runs/三自主队列。

严格区分旧 `gaolao-cuilan-v1` 与新 `gaolao-cuilan-v2` parser。v2 按 rescue/follow/appearance/private_items 判别绑定来源、purpose、request ID、两版本、不可变 term/scope、原动作和真实依赖；personal withdraw 不要求已中断请求者保有旧 epoch/在线/近距。普通事件不能污染另一用途或 follow basis；无关玩家坐标和隐藏控制模式不成为 C5。

实际本人收到 reusable 后生产 decline；新 single_use 是新 proposed，不自动编辑旧结果。C2 由自己收到的持久中断/公开结束通知触发，系统停权与实际 withdrawn 的记录必须能分别观察。回复/撤回不再额外 speak 刷对白。

原 Unknown 先按原 actionId/完整原文恢复，技术重试最多三次且有间隔；pending/last 水位保持独立。恢复前/后返回、提交响应丢失窗口里的新语义不丢；纯技术恢复不能创造新动作/同意。重启先沿现有 epoch/暂停围栏再读原意图与 Receipt，授权撤销和终态不升级身份或补跑。

### 4.2 完成条件

在固定 D1+D2 上，以真实 authority/持久记录核对各决定与通知因果、两用途不饥饿、原意图去重/恢复、来源落窗和缺来源阻塞；缺源是工程无动作，不是人物 decline。定向保留旧 scene-v2/N1～N6/SP06，报告旧行为与新行为分开。故障钩子只能安排提交/返回窗口，不注入选择结果。

交付 clean D2 commit/tree、依赖 F1/D1 身份、策略版本/basis/source 白名单说明、作者检查及未覆盖项。独立审查确认选择/恢复合同后作为集成输入；本票不自称两人正常 UI 已走通。

## 5. CS-T03：正常页面请求、逐物归还与新默认入口

- `ticket_ref`：**CS-T03（草案，未建 Issue）**；建议关联 #33。
- `spec_ref`：固定 CS-R2 §11.2、§12.2、§13.2.1、§14.2/14.4、§15。
- `acceptance_ids`：GZ-CS-02/03/04/06/07/08/09/10，以及 GZ-CS-01/11 的默认入口与兼容。
- `depends_on`：release 中 **G0、F1**；真实页面完成证据依赖 **D1+D2+D3**。可先用 F1 的固定契约样本验证表单，样本不计作本人选择运行。
- 所需能力：Vue/TypeScript、授权投影、原请求 UI 恢复。尚未分派。

### 5.1 允许写入

`frontend/src/domain/gaolao-actions.ts`、`spatial-labels.ts`、`spatial-summary.ts`，`features/character/GaolaoInteractionPanel.vue`、`GaolaoChapterState.vue`、`features/inventory/SpatialInventoryPane.vue`、必要的 `features/session/SpatialSessionPage.vue` / `use-gaolao-hud.ts`，`features/lobby/LobbyPage.vue`、`network/spatial-capabilities.ts` / `http-api.ts`；对应 `frontend/tests/*personal*.test.mjs` 和受影响既有单元测试。本票独占这些前端生产文件。

精确新版本素材兼容允许改 `domain/gaolao-object-art.ts`、`domain/gaolao-scene-layers.ts`、必要的只读 catalog 元数据与 `scripts/check-runtime-assets.mjs`；不改任何批准 PNG 字节，不重画、不移动 world/layout。只为固定 F1 映射增加显式版本适配；不得把 tools-east 或未知变体自动当成默认布局。现有资源语义/位置不变。

`network/spatial-session.ts`、`domain/spatial-view.ts`、`state/spatial-store.ts` 为继承只读边界；仅当实际新增字段无法通过现有投影接线而出现可复现缺口，向 root 报准确最小变更再归本票。禁止先建第二套个人许可状态合并器。

### 5.2 结果行为

新内容正常表单提供两种**询问**意向，默认 single_use；展示实际范围、等待本人、本人决定与当前可用性。目录来自近距实际询问，optionRef 仅能用于本人的有限请求；物件不必与本人同屏。取消/显式 replacement 使用当前两版本，竞争失败后刷新并重新明确提出，不自动升版重发。

行囊直接消费独立 `privateReturns`，不按当前许可卡过滤。每件明确“交回本人”与“放回原处”；ownerRef 不可见时保留说明和正常走近步骤，不能按姓名猜真身。放回用登记原处，不能偷换为脚边。动作是普通 transfer/put 的当前 ref/revision；Unknown 保留原动作，当前投影确认前不移除待办。两件各自显示实收/原处/尚持有，`privateReturns=[]` 不写成全物完成。

Receipt 只收束原动作历史并 sync；沿原 session/view/generation/seq 接受投影。旧 Accepted 迟到不能写 active、删除返还项或回退当前请求。旧房间仍按其版本呈现，新能力不足时阻止进入新内容并给升级/旧内容选择反馈。

将新建“高老庄”默认入口切到 F1 的 `gaolaozhuang-scene-v3`，并实际核对服务器创建内容身份。旧内容的显式环境覆盖与已存在房间路由保留。新默认角色/场景/物件继续使用原批准资源，不能靠默认落回旧内容躲过本人回应。

### 5.3 完成条件

表单/投影针对性检查覆盖新旧字段、两意向/新 nonce、取消归因、当前槽替换后归还、ownerRef=null、旧 Accepted/旧 view 及终态只读。真实页面在 D1+D2+D3 上完成借貌/私物请求与归还入口检查，记录结果为作者范围，不能替代 CS-T04 完整链或 CS-T05 独立验收。

交 D3 clean commit/tree、依赖 F1 身份、实际默认创建版本、已有资源 byte manifest 的比较、截图/请求/Receipt/投影的对应关系。美术质量、真机和真人理解度仍不在本票自动通过范围。

## 6. CS-T04：真实两人生产点击 harness 与增量 CI

- `ticket_ref`：**CS-T04（草案，未建 Issue）**；建议关联 #29/#33/#34。
- `spec_ref`：固定 CS-R2 §16～17；主 Spec §13.3；工程约定的既有 CI。
- `acceptance_ids`：GZ-CS-01～12 的可执行证据入口；每项区分正常页面、契约/故障注入、有限模型和未覆盖部分。
- `depends_on`：release 中 **G0、F1** 后可编写 D4；执行 **E2** 必须先有 **IC**。CI 真实执行与上传依赖已存在的实际候选/Actions run，不以本机环境代替。
- 所需能力：生产 HTTP/Socket/Vue/PostgreSQL/Chromium 验证、CI 和证据身份。尚未分派。

### 6.1 独占路径与复用边界

允许新 `frontend/tests/cuilan-self-response-browser.mjs` 及其专用 support、`frontend/tests/gaolao-real-support.mjs` 的显式新 profile、`frontend/package.json` 仅检查脚本接线、`.github/workflows/ci.yml` 的新增独立 job，必要时新 `.github/workflows/cuilan-self-response.yml`。同一功能只选一种新增 workflow 形式，以 F1/实现交接冻结；不得两个 job 重复宣称同一证据。既有 `gaolao-real-browser.mjs`、`object-visual-browser-check.mjs`、`static-release-browser.mjs` 仅保留其旧 scope，必要兼容修改由本票独占。

现有 `gaolao-real-support.mjs` 默认 v1，且为含翠兰在内的 NPC 建内部写 handle；`interact/move/go` 闭包可调用原 send。新 profile 必须在最底层只允许已授权受控三自主 NPC，**不为翠兰创建 harness 写 handle**，任何代翠兰 send/go/interact/reserve 都失败。不能只覆盖返回对象的 room.send/room.go。允许 read-only 诊断核对生产 scene 的意图/Receipt；诊断不作为人物动作来源。模型/供应商 profile 独立标注，外部 provider 调用数必须为 0。

人类动作必须从页面控件发出；只读 snapshot 可帮助核对可见标签，不能调用 spatialClient.send/move 或写客户端/数据库状态来造正常路径。故障注入只控制真实提交/返回/通知顺序，报告独立样本。

### 6.2 D4/E2 内容

按 coverage 的 P-01～P-06 先完成最小两人路径：救援→本人真实随行/安置→两用途 reusable declined→新 single_use accepted→真实逐物取/还→取消/失效/本人撤回→A 持物、B 占新槽、A 重连仍正常归还。包含两种安置与新两内容变体的有据样本；三个会面点的实际 apply 空间样本另明确标注受控悟空 profile，不能只有 schema 等价。

新 job 安装已锁定依赖与 Chromium、启动实际 PostgreSQL/authority/frontend，不使用用户 secret 或真实模型。保留已有 checks 所有门槛和失败行为。旧 A2 明确固定 `gaolaozhuang-v1`；旧静态发布/物件测试若依赖默认 v2，显式固定 v2 保留原证据 scope；新增 job 必须至少一次**不靠环境覆写**证明新高老庄默认创建 v3 并走生产本人链。两种工作不互相代替。

新增 job 独立 timeout/产物路径，避免塞进现有 20 分钟 checks 而挤掉回归。上传固定版本/人数/profile/步骤、检查逐项结果、原人类请求与 scene 意图对应、必要截图、失败前尾段、源码头尾身份和清理结果；不上传数据库、凭证、缓存。`AF_UNIX EPERM`/浏览器无法启动只能报 ENVIRONMENT_BLOCKED，不能 skip 成 PASS；既有正式 Actions 可执行环境作为实际渠道。

### 6.3 完成条件

D4 必须可在干净候选稳定失败/成功并输出上述身份与覆盖，不以“脚本存在”记运行完成。E2 需实际 IC 的完整运行记录及 CI run/job/artifact 身份，任何未运行步骤/负控不得折算 PASS。作者证据经独立复核后仅释放新增两人技术范围；更广人数/900 秒按 CS-T05 对账安排，真实 provider/真人/真机/艺术/部署不放行。

## 7. CS-T05：独立候选验收与 #29 对账

- `ticket_ref`：**CS-T05（草案，未建 Issue）**；建议关联 #29，引用实际后续 Tickets。
- `spec_ref`：固定 CS-R2 全部验收；主 Spec §13.3；正式 TLA 实现义务。
- `acceptance_ids`：GZ-CS-01～12 全部归口，并把 ADV/GZ 相关项映射回 #29，不能只汇总各作者 PASS。
- `depends_on`：独立产品执行依赖 release 中 **IC、E2**，最终 **V2** 完成另依赖 **FM**；可以提前只读审查已冻结的 F1/D1/D2/D3/D4，最终结论必须绑定同一完整候选。
- 所需能力：独立 worker-verify 与 worker-review 职责；不允许候选作者自行作独立结论。尚未分派，具体人选由 root 定。

只写本票验收报告、覆盖差额和证据索引；产品失败回原 writer 修复，不改业务、不“修”脚本以伪过。临时证据按项目任务目录，正式证据用实际 Actions artifacts/版本化报告；公有写入与合并仍由唯一 land 执行者。

V2 应直接核对：正常生产翠兰因果链、逐物返还原事实、真实 owner/ref、两个用途/版本竞争、控制失效的原子停权、Unknown 旧 Receipt、旧房间恢复、新能力门禁、N1～N6/SP06；模型不能覆盖的几何/可玩性/页面要有相应产品证据。requirements/standards 分轴给结论，独立性、subject、范围和剩余阻断齐全。

M29 是对当前新候选与既有有效证据的逐项关系表：原证据保持原 subject/content/profile；只有未变范围能写“背景复用”，受影响范围补跑。先完成 2 人新技术链，再按有据缺口规划/执行 3/4 人组合、2/5 人乔装/公开及入队/分别、5 客户端连续 ≥900 秒。900 秒必须有同一连续区间、五连接状态与有效操作，不拼短局或把单客户端墙钟算五人运行。受控技术与真实 provider/真人四局/真机/艺术/部署分列。

本票完成终点是独立结论和可审覆盖差额，允许把超出本最小 slice 的未完成项准确移交 #29；不能因此关闭 #29 或宣称 A3/整章已完成。任何模型正式输出尚未到齐、产品实际失败、环境阻塞、证据身份不匹配均按 release 对应 gate 保留，不自授例外。

## 8. 本次规划自查及交接

本规划实际进行了：固定 R2/基线身份和三文档差额读取；项目规则读取；协议、内容、authority、scene、UI、harness、CI 的定向源码核对；草案链接/编号/依赖/覆盖与写入所有权静态检查。未执行业务、数据库、浏览器、TLC、真实 provider、真人/真机、出图或部署。

根调度者下一步是审本计划、接收正式 R2 TLA 及实现义务，并按 release 的 G0/F1 实际释放；这不是已经分派。计划修订若改变 Spec 行为、版本兼容承诺、写入归属或证据 scope，须固定新计划 commit/tree 并列受影响 gates；旧计划不改写为已经实施。


## 共享记录发布登记

2026-11-14：原固定计划 `35d8759aac469eba5a8d9d4b94a787a3e62330c5` 已按相同五项结果建立以下真实 Issues。上文“草案、未建 Issue、PLANNED_NOT_RELEASED”保留为该作者快照，不代表本节之后尚未保存任务；没有重新拆票或改变行为合同。

| 稳定标识 | 实际任务 |
| --- | --- |
| CS-T01 | [#55](https://github.com/gbcdby/xiyou/issues/55) |
| CS-T02 | [#56](https://github.com/gbcdby/xiyou/issues/56) |
| CS-T03 | [#57](https://github.com/gbcdby/xiyou/issues/57) |
| CS-T04 | [#58](https://github.com/gbcdby/xiyou/issues/58) |
| CS-T05 | [#59](https://github.com/gbcdby/xiyou/issues/59) |

五票的范围、负责人/当前归属、实际产物与完成状态以各 Issue 为准；依赖与产物解除条件继续遵守本计划的 [release 矩阵](gaolao-cuilan-self-response-release.md)，本次实际采用/释放接续见其发布登记及 [#34](https://github.com/gbcdby/xiyou/issues/34)。不再维护另一份可变任务状态清单。

按总控 2026-11-14 08:53 UTC 的后续裁决，CS-R2 已采用为候选实现基线，G0-D1 已释放，CS-T01 原执行者继续完整权威候选。固定 F1 `f96474f6d85d5bb6eb765f8c881d5f7aa7600e4f` 已被接受为消费基线；T02 已分派待 ACK，T03 已释放待槽位分派，T04-A 局部适配器已接受为可整合候选。具体归属、原始证据与仍未完成的门槛见 release 发布登记。五票均保持 open；实施释放不等于 D1/D2/D3/D4、E2/FM/V2 已通过。文档 PR 只保存共享依据，不自动合并、不关闭实施票。
