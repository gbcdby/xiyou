# 高老庄本人场景策略运行链

## 范围与来源

本模块落实 [#34](https://github.com/gbcdby/xiyou/issues/34) 下已采纳的 [scene_role N1–N6 合同](../docs/specs/gaolao-scene-policy.md)，发布工作归 [PR47](https://github.com/gbcdby/xiyou/pull/47)。本轮基础为 main `201f18349e0baca60a00f3b5ccaa32dc5278b101` / tree `730527715b46e39b077079515f95b74fc8f7d403`，与原实施输入 `819c8290` 完整同树。公开设计 blob 为 `f206953fe093d4d0a3e36bd773cf6a1819fadc47`。

只有两个新内容版本登记 `gaolao-cuilan-v1`：`gaolaozhuang-scene-v2` 与 `gaolaozhuang-tools-east-scene-v2`，章节版本均为 `gaolaozhuang-chapter-v2`。旧内容文件与旧 Session 快照保持原义；不能用新代码给旧局补写人物知识。客户端创建新局时须选择新版本，旧前端默认创建入口的映射属于独立配套。

`createAuthorityServer` 创建并关闭一个 `attachScenePolicies` 实例；`createAIServer` 返回同一个 `scenePolicy`，另保留自主 NPC 的 `ai` 实例。重复 attach 返回已有实例。当前配置只登记真实翠兰；高太公和见证人的已有规则互动不被改成新自动选择。场景控制器不持有 Gateway，不调用 `ai_runs`、模型预留或三自主 NPC 调度接口。合法场景世界事件仍沿原受众规则提供给相关自主 NPC。

## 模块与事务

| 模块 | 责任 |
| --- | --- |
| `game/gaolao-scene-policy.mjs` | 纯人物选择。只接收本人 Snapshot、本人资料是否有效、当前本人参与记录和可信布尔资格。输出有限动作或内部无动作理由。 |
| `game/gaolao-policy-route.mjs` | 两份有限公开资料、B/U 起点、约定场景顺序、C13 本人退出、现有几何与寻路上的范围限制。 |
| `game/gaolao-rules.mjs` | 开局资料、参与者提议摘要、实际回应与执行版本关联、每步路线守卫、实际到达与安置。 |
| `backend/scene-policy.mjs` | 可信本人授权、白名单资料查询、准备/basis/原预留、首次动作重验、原 Receipt 核对、事务资格差。 |
| `backend/scene-policy-runtime.mjs` | 每角色串行、语义水位、独立技术恢复和有界重试。 |
| `backend/runtime.mjs` / `spatial-runtime.mjs` | 原 Session 锁与 Receipt 事务；只在原提交入口安装策略首次校验，不承担人物意愿判断。 |

准备在一个短 Session 事务内取得本人 Snapshot、实际持久来源及当前判断，随后预留原 `spatial_intents`。导航序号也在此时分配。没有跨事务的“先想好，再重新绑定当前人物/路线”步骤。内部身份必须是内容登记的真实 `scene_role`；真人 UI 的 `self.canControl` 为 false 不影响这份服务端资格。

`scenePolicyBasis` 是严格闭集，顶层及嵌套字段均拒绝未知键。它包含逻辑步骤与尝试关联、原请求摘要、评估水位、内容/章节/地图版本、三个允许来源的标识/摘要/收到水位、当前 consent/follow 版本、双方 epoch、本人 view/ref/目标 revision 与当前布尔守卫。它不含世界副本、远处 live 地图、其他人的记忆或自报“已获授权”的公共字段。

提交复用 `submitSpatialIntent → executeSpatial`。当前读权、原 actor 与原摘要相同的 Receipt 查重先完成；只有没有旧 Receipt 时才执行 `revalidateScenePolicy`。当前纯判断、动作与准备依据必须相符，效果及新 Receipt 同事务落地。无关 actor 行走造成的全局序号增长不是拒绝依据。变更了条件的旧 accept 只能得到原动作的实际拒绝，不能用同 ID 偷换成 defer/decline。

### 完整留证与动作依赖

N5 要求重验“相应选择谓词”和本次选择的真实依赖；P2-09 的本人撤回依据是当前许可及已经合法送达的偏离结果。完整 `guards` 继续按原严格 schema 保存，作为准备时的事实记录。准备去重与首次提交统一用 `sameChoiceBindings` 比较下表的资格投影。共通字段全部比较：内容/章节/地图版本、所有已保存的本人来源及摘要/收到水位、当前 consent 记录、follow/plan/routeDigest、双方 epoch、本人 view/ref/resourceRevision。没有从共通版本或身份围栏中豁免任何动作。

| 动作 | 参与比较的 guards | 另由当前纯判断及原规则核验 |
| --- | --- | --- |
| respond_consent | authorized、versionsCurrent、leaderHuman、leaderOnline、near、visible、los、inRoute、localPathReachable、doorOpen | P2-03～07：当前 proposed、本人资料、相同回应及动作参数。 |
| withdraw_consent | authorized | P2-09：当前 accepted 许可、同一 paused/deviation 计划、没有新提议替代；无离线/普通阻挡代答。 |
| gz-confirm-settlement | authorized、versionsCurrent、arrived、exitReachable | 第 2 节/P2-08：实际到达、当前许可/计划、双方 epoch、真实位置与自由出口。 |
| gz-step-back | authorized、atRetreat | 第 2 节：本人实际联络、尚未退让、当前位置满足门内退让守卫。 |
| move_to（退让） | authorized、atRetreat、retreatReachable | 第 2 节：本人资料、当前场景、没有在途移动、合法退让目的地。 |

每次仍重新判断 Running、paused、本人资格与已安全状态，要求同一逻辑步骤、同一动作及全部参数。位置资格变化不会单独推翻已成立的 P2-09 撤回；安置确认也只按既定的实际位置/许可/出口条件判定。真正改约、双方 epoch、资源 revision 或相应资格变化仍终结原请求，保留其原 Receipt，后续语义才触发关联的新尝试。原存储 schema、请求摘要与 Receipt 优先顺序没有变化。

成功 accept 增长 consent/plan 版本后，另写 `follow.policyRoute.acceptance`，绑定实际新版本、原 actionId 与原请求摘要；准备 basis 永不回写。新内容的 follow 回应不能绕过这个策略校验走普通内部代答。之后每次推进仍验证原执行关联，旧 proposed 版本不会误停正常随行，也不能刷新旧接受来绕过撤回。

## 原结果与语义水位

`spatial_intents.scene_outcome` 仅标记已经按当前读权和原摘要核对的原 Receipt。原 request、execution_context 和移动序号不回写。部分唯一索引保证一个 Session/角色的场景策略最多一条未收束预留。逻辑键区分一次退让确认、每份 consent/version 的回应或撤回、每份 follow/plan 的安置确认。成功步骤继续持久去重；确定拒绝后的新尝试关联上一尝试，要求当前依据变化，或收到晚于该原拒绝的合法新语义且当前选择仍成立。

### 成功步骤与失败尝试

准备时的 basis 相等只能说明两次准备依据相同。原请求可能在临时 paused 时被拒，恢复后再次满足同一 P2-09；不能把该 Rejected 当作人物已经完成撤回。N5 / §6.2～6.3 的新评估入口复用原 `pendingSemanticSeq`：控制器在正常评估调用时捕获它，经可信内部 `prepareScenePolicy(handle,{semanticSeq})` 传入。参数默认 `0`，校验为合法 seq 且不超过当前实际读态；不来自 Public DTO，也不使用最新全局 seq 伪造信号。

| 既有原记录 / 当前判断 | 准备结果 | 确认语义水位 |
| --- | --- | --- |
| 有未收束原请求 | recovery，先查回或提交同一原 ID。 | 不消费新语义。 |
| 当前纯判断确实无动作 | idle。 | 实际 `evaluatedThroughSeq`。 |
| 已 Accepted 的逻辑步骤 | idle；退让导航保留原有“依据变化可重新导航”例外。 | 实际 `evaluatedThroughSeq`。 |
| 已 Rejected，当前有效依据有变化 | 按原规则准备关联的新尝试。 | 实际 `evaluatedThroughSeq`。 |
| 已 Rejected，依据相同，`semanticSeq > 原 Receipt.observedSeq` | 当前纯判断仍须成立；准备关联的新尝试，原拒绝不改写。 | 实际 `evaluatedThroughSeq`。 |
| 已 Rejected，依据相同，没有更晚已接收语义 | idle 等待；不能凭当前全局 seq 再建动作。 | 仅确认 `semanticSeq`，通过临时结果 `consumeThroughSeq` 明示。 |

`observedSeq` 来自原 `executeSpatial` 在同一 Session 锁事务内做出原动作结果、落原 action_receipts 时的 `tx.state.sessionSeq`，由 `recoverScenePolicy` 核对原身份/摘要后保存至 scene_outcome。它不是恢复返回时的最新 seq。新预留继续使用原有 `previousIntentId/attempt`、原子分配的新 actionId 和实际评估水位；没有新增持久字段。原 Unknown 未收束时不进入上述新尝试分支。

`evaluatedThroughSeq` 始终表示实际读取并判断的权威状态；`consumeThroughSeq` 只用于旧拒绝缓存仍在等输入的分支，表示本次真正收到并确认的语义界线。若 prepare 捕获旧 pending 后，resume 在读取前提交或通知迟到，旧输入不能凭较新的读态消费该 resume。控制器只推进到 consumeThroughSeq，较晚 pending 及之后才送达的合法通知都能再触发正常评估；成功预留和真正无动作仍按原规则消费实际读态。相同/倒序旧通知不新建，原结果的纯技术恢复不隐含语义。

| 阶段 | 接收/消费规则 | 新身份规则 |
| --- | --- | --- |
| 原请求恢复读前、读后返回前、结果收束前 | 合法语义始终进入独立 `pendingSemanticSeq`；恢复只查或提交原请求，不消费语义。 | 沿用原 actionId、完整请求、摘要、epoch/ref 与适用移动序号。 |
| 当前评估与预留 / 确定无动作返回 | 成功当前授权评估只消费 `<= evaluatedThroughSeq`；旧拒绝缓存等输入时仅消费 `consumeThroughSeq`。更晚通知保留，失败或 Unknown 不先清水位。 | 只有有依据的当前选择才能预留新尝试。 |
| 原结果已收束 | 有独立 pending 或初始化扫描才开始下一正常评估。 | 纯显式恢复没有新动作或对白。 |
| 重试耗尽 | 保留原身份与 pending；新通知不重置技术重试次数。 | 初次失败后最多三次自动重试，默认间隔 100 ms；显式恢复只接替技术恢复。 |
| 重启 | 先收束原预留/Receipt，沿用原 epoch 提升与暂停；独立启动扫描读取当前本人资料。易失 pending 不声称跨进程持久。 | 旧未提交 epoch 依法拒绝；旧 paused 安排须真人新提议，不能自动复活。 |
| 终态 / 卸载 | 停止新评估与技术计时器；在途只收束原结果。 | 不新增世界事实，不回退安全事实。 |

原生 PostgreSQL 57014 等暂时查询故障保持 Unknown，并受同一重试上限约束。权限、合同和 `ACTION_ID_REUSE` 不是技术重试。核对标记的 COMMIT 返回本身也可能丢失，因此无未收束行时可按本角色/策略读取最近原结果，再核对 Receipt 与摘要；“账本已标记”不等于调用者已经看见原结果。

## 已提交通知的私有相关性

`scenePolicyWake(tx)` 比较**同一实际事务起点和最终状态**的白名单：本人阶段/控制/view/resourceRevision、持久允许来源、当前 consent/follow 的版本/状态/段及其领路者 epoch、本人导航终态、当前场景障碍条件，以及当前提议指定领路者的在线/near/LOS/可见/路线范围/本人局部通路布尔资格。领路者 epoch 也覆盖 paused/deviation 下尚待撤回的当前安排；实际改变才有新通知。

`leaderEligibility` 让当前读取与提议资格通知共用同一组谓词。局部通路只求本人当前场景内既有路径的可达布尔值；下一场景仍只使用约定静态入口，不查看远处实时地图。普通坐标、时钟与无关人物行走不纳入资格键；只有布尔边界变化才唤醒，不逐 tick 重建策略 Snapshot，following/arrived/paused 也不为领路者每步移动计算提议资格。`spatialRevision` 和全局 seq 都不是此资格键。

`AuthorityRuntime` 仅在 COMMIT 成功后，把 `{actorId, throughSeq, relevant}` 附于进程内 `commit` 通知的 `scenePolicyWake`。它不进入 WorldEvent、Session 状态、outbox 内容、Public DTO、模型上下文或意图 basis。策略边界计算留在章节适配模块，Runtime 不作人物选择。该事实不依赖控制器持有的旧快照；新提议评估到返回期间发生的资格变化也能被保存。

真正 resume 仍按现有私有 `spatialPauseBefore` 逐 clock 事件识别 true→false；单个 paused=false 不充当恢复信号。两个私有通知均只沿用权威 seq，重复/乱序旧水位不能重新入队。后续形式化对应应分别核对私有事实来源、资格白名单、pending 保存与消费点，不能借旧 RecoveryWake 的结果替代新检查。

## 路线与本人资料

两份 archive/Evidence 图记在新局初始化时只给真实翠兰，sourceSeq/receivedSeq 都是真实初始化序号。保留本人原 Observation 与有限资料摘要，来源落出最近 256 条窗口后仍按本人白名单读取；重启不再造一份来源。图记只包含约定的静态锚点/公开区域与连接，不含 E 的经历、见证人、私物或远处 live 障碍。

新提议先按 guest-room ∪ guest-passage 的闭集 B 分类，再按公共区域 U 分类。B 内新茶棚安排绑定 front + tea，从当前位置经 C13 退出；本人实际到达 C13 且在 court-ground 才单调完成退出。领路者可以先经过同一连接，不能代本人完成。退出后 U 的交叠合法，B∖U 禁入；新提议从当前位置及新 epoch 重建，不能继承旧 exitDone。

原 `findPath` 在当前许可区域内生成路径，原几何检验覆盖实际折线全段。领路者实际越界或错误场景顺序时，本人在最后合法检查点停止，规则给参与者授权原因后才由策略撤回；不改领路者坐标。只在实际跨入时检查约定入口的物理位置，进入后才对新当前场景寻路。arrived 尚未 settled 时仍受路线守卫；确认另验实际位置、当前安排和自由出口。

defer/decline/withdraw 与内部无动作保持不同。近距合格真人回到允许范围或换合格带路人，依当前版本重新提议即可补救；不新增关系惩罚、默认借貌/私物许可、招募或入队选择。

## 验证入口与未覆盖

作者定向入口为 `node --test --test-concurrency=1 backend/tests/scene-policy-*.test.mjs`。测试按 GZ-SP-01～08 标记，使用真实 PG、HTTP/Socket 和两个真人身份，覆盖两个新布局、两目的地、退让、实际跨场景安置、过道多点/换领路者/庄外返程、defer/decline/withdraw 补救、事务与恢复交错、原生 57014、暂停重启、旧 epoch、终态、来源窗口、资格频率和模型预算耗尽。正常路径的测试辅助器拒绝代翠兰执行动作；悟空的测试操作仍经原合法内部守卫，不把它记成真实供应商自主表现。

旧内容/同貌权限与自主恢复采用受影响路径的定向回归。作者曾实际发现并保留 arrived 早退及旧提议资格缓存两个产品红灯；相同真实场景用于修复验证，不能删掉失败后改称一直通过。

R-GZ-SP-IMPL-STD-001 的依赖一致性回归位于 `backend/tests/scene-policy-dependencies.test.mjs`：两目的地撤回返回、撤回中的真实 epoch 变化、真正新提议替代、到达确认的合法领路者移动，并核对原文/一次效果、旧通知重复乱序及无关移动频率。独立原反例和旧 red 候选的结论保留，修正版仍须独立复核。

R-GZ-SP-IMPL-STD-002 的结果去重回归位于 `backend/tests/scene-policy-result-dedup.test.mjs`：原撤回被暂停拒绝，正常初始化已捕获旧语义后 resume 在读取前送达或真实 COMMIT 后迟通知，以及原拒绝 COMMIT 返回丢失时先恢复原身份。核对新尝试关联、不可变旧 Rejected、成功后再 resume 去重、旧通知重放/无关移动及纯恢复。原独立暂停/resume 红灯保留；作者检查仍不代替独立复审。

这些是作者检查入口与实现说明，不代表独立需求/标准审查、TLC、新 UI 默认入口、完整 A3、真实模型供应商或发布已通过。新增形式化边界见 [scene 影响报告](../formal/adv001/scene-policy-impact.md)；后续必须对冻结源码单独核对。
