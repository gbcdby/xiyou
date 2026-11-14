# CS-R1 历史与 CS-R2 增量：需求、模型边界及交接义务

本记录只对 `76d98e137f5220518b072650ba6af8001966ea23` / tree `18287fbcde9590c6ce83a82ee747dfafaccdfe46` 的 CS-R1 设计负责。模式为 `design/check`，不做业务实现对应证明。源文件实际摘要见 `source-files.json`。

本文件至“CS-R2 增量”标题之前是 R1 原记录，保留其原候选范围与结论；不把 R2 补全追记为 R1 已通过。当前 PersonalEffects/Terms/AuthorityEffects/PersonalProjection 绑定 R2；R1 Effects 原字节、配置、manifest、矩阵结果保留在 `history/cs-r1/`。

## 需求与性质

| 设计来源 | 模型与启用性质 | 范围与限制 |
| --- | --- | --- |
| §12.2 公开 revision CAS、第三方竞争 | PersonalCAS：SingleCommitPerPublicRevision、NoThirdPartyOverwrite | 两真人、两用途、每人至多两个明确提议；第二次代表刷新后新的明确提交。没有使用私有槽版本作为公开输入。 |
| §11.3、§12.1–12.3 决定与请求生命周期分轴 | PersonalConsent：OwnDecisionOnly、NoThirdPartyReplacement | 玩家取消/替换与本人决定不同；scope固定，原本人决定保留。 |
| §12.2、§14.3 当前请求、purpose、scope和basis | PersonalConsent：PurposeRequestIsolation、ScopeBinding、DecisionBasisRechecked | 一用途旧/新两请求、另一用途一请求；Focus分别交换。Prepare与首次Commit可被外部变化和替换打断。 |
| §13.3 绑定控制、来源、终态失效 | PersonalConsent：ActiveRequiresCurrent；PersonalEffects：AtomicAppearanceStop、AtomicPrivateStop、PurposeAndTakerAuthorized | consent模型分别枚举请求者/本人epoch、共同来源版本、暂停、撤权、终态；effects模型有一次控制器重启及终态。没有热迁移实现。 |
| §11.3 C2、§14.3 personal withdraw | PersonalConsent：OwnerCanCloseInvalidated | 旧proof保存历史，撤回重验当前本人资格/来源与原请求版本；不要求已失效请求者仍保留旧epoch。 |
| §13.2 唯一持有、窄归还 | PersonalEffects：CustodyProvenance、PrivateOwnerOnly、RestitutionEnabled、ReturnEntryRetained | 两件物品、真实物主常量、两位持有人、每用途两请求；归还使用真实取得记录，不从当前槽推断旧能力。距离、LOS、真实物主ref的可用性是明确几何抽象，未证明具体地图可达。 |
| §13.3、§15 原Receipt优先、一次效果 | PersonalConsent：ReceiptDoesNotReactivate、EffectAtMostOnce；PersonalRecovery：OriginalIdentityStable、ReceiptStable、SingleUnsettled、EffectAtMostOnce | 提交前Unknown、提交后返回丢失、重启、原身份查询/重试分开。历史Receipt能在旧授权失效后读回，但不重新应用效果。 |
| §15 两用途待办与有限重试 | PersonalRecovery：PendingPurposesPreserved、CapacitySufficient、BothPurposesProgress | 两用途、其中一用途一个晚到新请求、至多4份原意图；另以5容量扩展检查。初次通知和第二份重复通知可在不同阶段到达；选择与提交串行，外部通知/恢复可交错。 |
| §14.2 UI用投影确认；现有服务端权威原则 | PersonalEffects：ConfirmedProjectionOnly | 已确认投影与Receipt历史分开，旧Accepted不能改已确认当前槽/可用性。本抽象没有检查生产Vue/Socket字段、seq缺口处理或view/generation算法。 |
| §13、§16 安全和合法已知历史 | PersonalConsent：SafetyAndHistoryDurable；PersonalEffects：SafetyAndKnowledgeDurable | 从已安置safe切面开始，取消/撤回/控制变化不能回滚；不重新证明救援成立条件，也不证明全部感知白名单。 |

## 模型分解与初态

四个模型没有相互调用；它们分别检查组件合同，不能推出全产品精化或组合证明。

1. **PersonalCAS** 从无当前安排和公开revision 0开始，两玩家的读、提交、刷新分开。每份动作只有一个已固定的原身份；明确刷新建立第二份动作。
2. **PersonalConsent** 从两用途各一份合法送达的proposed开始，后者由公开CAS合同支持。真实响应的prepare、commit、Receipt重读分开；取消和撤回有自己的两版本快照。每份请求最多各一份response/cancel/withdraw首次动作；第三份请求用于一个用途的旧新替换，Focus交换后检查另一用途。模型固定safe为真，代表安置后切面；declined/deferred配置只验证决定和生命周期，不证明人物偏好。
3. **PersonalEffects** 从两用途各一份合法accepted、尚未执行的grant开始。`consent-witness-both-accepted`提供五状态可达前缀：两个proposed→私物prepare→私物实际accept→借貌prepare→借貌实际accept。该见证没有epoch/来源变化、替换或终态。Effects以相应请求者身份和版本切面开始，但没有建立机器可检验的refinement mapping。
4. **PersonalRecovery** 的task是领域层当前允许评估的语义步骤，含purpose和原请求身份，不在调度模型中替本人选accept。epoch变化后的关联新attempt须经当前领域规则再判断；这尤其适用于当前本人已恢复后收口失效grant，不能解释成旧proposed自动升级accept。领域适用性由PersonalConsent的守卫单独检查。

所有权威提交、效果关闭和Receipt保存都按设计要求作为原子动作。这个建模选择是待实现义务，绝不是现有SQL/代码已经原子的证据。所有集合、计数器和身份均有限；没有CONSTRAINT、ACTION_CONSTRAINT、VIEW、对称归约、随机模拟或早停冒充穷举。见证和负控会按预期首次违反而停止，故其remaining_states通常非零。

## R1归还投影缺口：四状态反例

`effects-r1-current-only`专门探索§14.2“参与者当前请求”按当前槽取投影的字面实现；不是断言设计要求删除旧项。

| 步骤 | 状态/动作 | R1依据 |
| --- | --- | --- |
| 1 | p1的旧私物安排accepted、open、ready，parcel在原处 | §12.3真实accept建立proof；上述Consent可达前缀支持该切面。 |
| 2 | p1真实拿parcel；holder=p1，取得记录=旧request | §13.2枚举私物与当前许可下真实take。 |
| 3 | 绑定失效：旧status仍accepted、lifecycle仍open，但grant停止，execution=return_only | §12.3明确要求该转移；§13.3要求同事务停止新使用，不冒称本人withdrawn。 |
| 4 | p2用当前公开版本合法新提议；旧记录superseded，新slot=2，parcel仍在p1手中 | §12.2第一行允许“失效且不可继续使用”安排被新玩家新提议取代；第二行的竞争保护只针对proposed或仍有效accepted。 |

若归还入口只从当前slot=2派生，p1旧取得记录不再出现在投影中，违反`ReturnEntryRetained`。§12.3末和§13.2又要求旧closed/superseded持物仍能窄归还，故需要补齐独立的旧持有投影义务。`item-ledger`模式表达该补全方向，仅作条件模型；不能把它写成R1原文已经完整规定或生产已实现。

## 活性与死锁边界

- 请求、取消、替换、玩家行动、NPC是否离开均没有被强迫公平发生。R1的围听偏好是否有正常补救是独立需求问题；模型不假定旁观NPC最终离开。
- PersonalRecovery的活性配置假定有限技术故障；对持续可执行的reserve/commit/consume/recover、已提交首次通知以及指定重启后的恢复使用弱公平。一次重启可以不发生；若发生并暂停，则恢复公平性是该配置的条件。另一用途的机会来自独立pending和有限任务，不靠全局水位一并消费。
- 技术重试达到3次的配置只检查安全：保留原意图、真实Unknown和人工待恢复，不承诺自动终止。
- PersonalEffects的归还活性配置只在持有人合作到达、实际引用持续有效时对正常交回动作弱公平。不会据此承诺离线持有人必回来，也不保证地图上任何位置的路径都可走通。
- 每项检查启用死锁检查。Idle只在本模型没有可执行工作时启用，表示可允许的无新输入静止；它没有被用于证明业务活性。Receipt重读可以保持状态不变，不能作为进展。

## 回交实施方的义务与限制

需要独立实现/运行取证：事务隔离与原子关闭、nonce/digest/严格白名单、防冒充与跨局引用、真实空间/听闻/地图、物品级returnPending在正常页面和重连后的入口、原Receipt晚到和新投影交错、两用途真实调度、公平性来源、scene零模型成本、content/schema能力协商，以及旧N1–N6/SP06/三自主NPC的影响范围。此任务没有编写业务或镜像实现测试，未启动浏览器、数据库或provider。

既有SceneRequest/SceneFollow/Consent/Resources/FollowProposal的历史结果保持原对象；这里仅复用固定工具链、runner和机制理解，没有重新把历史64/40项改记为本设计通过。独立模型复核为NOT_RUN；独立需求/标准review与本建模者不同，但不是另一名模型作者对本模型的独立复核。

允许实现方自由选择内部函数、索引和记录形态；不得改变本人决定归因、请求身份、用途隔离、不可变scope、原Receipt和单个Unknown、同事务停止效果、旧取得记录和窄归还。若实际实现拆开这些原子步骤，或增加身份/消息/持久化边界，须返回本模型重新评估。后续实施、真实验收、PR和发布由外层负责。

## CS-R2 增量与固定来源

本增量实际读取 `1a7f45ddfeca0d25fb3714e1ce45980b225d5bde` / tree `6b0130cd6838bf052504994527f05e29aabf521e` 的 git 对象和相对 R1 的三文档差异；摘要在 `source-r2.json`。本目录所在 git 基线仍为 R1，不依赖作者工作树后续 HEAD。R2 §13.2.1/14.2 已明确独立物件返还集合；§11.2/11.3/12/13/14 加入 request-only permissionTerm 与逐物一次使用；§16 是本次 delta 入口。

### 未变合同的证据复用

| 原模型 | R2 未改变的约束 | 新的组合前提及限制 |
| --- | --- | --- |
| PersonalCAS | §12.2 公开人物 revision CAS；同版本竞争至多一成功；不得覆盖第三方有效/待答请求 | 新 single_use 补救仍是新身份、新提交。Terms 另检查 reusable→真实 decline→新 single_use CAS；CAS 原证明不包含新增字段序列化。 |
| PersonalConsent | §12.1–12.3 本人决定与 lifecycle 分轴；strict purpose/request/basis；取消/替换归因；原 Receipt；§13.3 停权；C2 只要求本人当前资格 | 所有成功 accept 的 scope 还必须满足 R2 Terms 的 single_use 和不可变 term/basis 守卫。Consent 原结果仍绑定 R1，不能单独证明 R2 新 term 条款。scopeDigest 用符号相等抽象，不证明哈希算法。 |
| PersonalRecovery | §15 一份未收束原意图、原身份优先、Unknown 原查询/重试、两用途待办保留、三次重试上限 | 每份 task 必须来自当前合法语义；重启后新语义重新过 Consent+Terms 域守卫。此调度器不把旧 reusable/旧 epoch 任务变成合法新 grant。未证明三个模型之间的机械 refinement。 |

原 CAS/Consent/Recovery 模块、配置的实际 hash 与 R1 运行快照核对后复用，不重跑、不把旧状态数改绑新来源。Terms 的独立增量覆盖 immutable term、本人真实 decline、两用途新请求补救、公开 CAS、严格依据、accept/apply/take 的 single_use 权威守卫。两个 corrupt 上游已接受 reusable 的使用防线配置是**故障注入初态**，不称正常可达；它们不启用 NoReusableGrant，只验证应用时重新禁止 reusable。正常配置另启用该不变量。

### R2 Effects 的观察关系与抽象修正

当前完整组合的投影差异 guard 比较：

`Observable = <<slot, active, holder, acquired, taken, completed, returns>>`

其中 returns 是每位玩家的完整集合，每项含 originalRequest、item、当前 view 和 delivery_pending/return_only。holder/acquired 是实际持有与原取得身份；taken/completed 按请求和物件分别记账。同槽同 active 下发生 take、先还一件、归还第二件、放回原处、换 view、取得记录变化，均可产生可观察差异。请求关闭/取代不删该集合；historyAvailable 变化也不删它。没有持物时换 view 本身对本性质是 stuttering；下一次 take 产生带新 view 的项。

R1 `w.seq` 只是用于送达差异的全局历史计数，不参与 grant、请求/取得身份、版本 equality、次数额度或安全性质。R2 删除此无关历史量，使用以上完整观察关系；没有用 modulo 回绕身份。R1 UI 收据集合压缩为 receiptSeen 布尔，但 Requests 的旧/新身份、各份真实历史 Receipt 和 Replay(q) 仍保留，晚到旧 q 可在已收到新槽投影之后发生。该压缩不保留“共收到多少种收据”的性质，本任务也不作该主张。

**此前仅用 slot/active 作差异的抽象不足以证明私物缓存送达。** 当前模型已修正，且 `miss-return-projection` 负控明确恢复旧 guard；ProjectionEventuallyCurrent 实际产生 rc13 反例。R1 Effects 成功结果只覆盖其较窄抽象，不能作为 R2 缓存返还入口证明。R1 两项 60 秒超时、R2 全缓存 60/300 秒超时全部原样保留；分层完成不改变这些状态。

全部变量有有限界：两用途、两真人、每用途旧/新两请求、两物；每请求每物 taken/completed 为有限子集；每玩家 view 仅 1/2 且只刷新一次；一个 history prune；环境配置最多一次 restart/resume/terminal；每物 ownerReposition 一次；每份 grant 接受一次、每物每份合法 grant 拿取一次。没有无界 revision/nonce/seq/重连/提议循环。状态膨胀主要来自当前权威世界与 UI 历史完整快照的组合，而不是无界计数器。取归还后另一个新合法 grant 再拿可达，未把“逐次”误写为物件终生只准拿一次。

### 分层接口、后置条件与可观察保留

**AuthorityEffects** 直接扩展相同 PersonalEffects 世界动作、身份、归因、receipt、fault 和完整 ReturnView 派生，只把服务器 ReturnRule 从客户端 NormalReturn 的缓存前置中分离。它允许真实规则满足时直接提交归还，因此服务器可行动作更宽；不增加同步投影假设，不删除 invalidation/替换/重启/恢复/两物交错。它不启用 ConfirmedProjectionOnly 或 ProjectionEventuallyCurrent。原 Effects 各安全负控仍在同一个被继承模块中，且 cached 模型已实际触发；分层另跑归还集合/逐物额度的必要负控。

**PersonalProjection** 是快照接口的有限实例：空手→取一件→取两件→先交回 parcel→旧安排停权→新请求已接受但旧 letter 仍由 p1 持有→letter 实交 owner 或放回 origin。每个完整快照保留 holder、持久 acquired、按旧/新 request 的 taken/completed 以及独立 returns；只含当前玩家应见的归还行。序列索引 0..6 是这组固定后态的单调观察序，不代表生产 seq 的实际编码。两 view、任意已发快照迟到/重复/乱序、任意旧 Accepted 与送达交错全部保留。活动 grant 变化与新请求接受被折为命名世界后态；组件不重新枚举被省略的世界动作。

组合需要实现满足四个后置条件：

1. 每次相关权威事实改变都能生成完整 snapshot；取得事实持久，不能经 slot/history 裁剪。真实 owner/origin/item ref/revision 仍须独立核验。
2. 每次传输只携带一个一致的完整快照；既有 session/view/generation/seq 机制保证接纳当前视图、拒绝回退。本模型两个 view/单调索引只是该接口的有限实例，不是另造 merger。
3. Receipt 只改变原动作历史并触发同步，不写 grant、当前 snapshot、per-item quota 或返还集合。迟到旧 accepted 不能通过其他副作用回填这些状态。
4. 服务器每次使用/归还重验当前域守卫；客户端旧按钮存在不授予权限。活性另要求最新快照最终送达、实际持有人合作且当前空间/引用有效。

没有给这些组件构建机械可检验的端到端 refinement mapping，也没有实际检查生产 Vue/Socket/DB。分层的 PASS_WITHIN_SCOPE 只支持相应接口合同的设计证据。完整缓存组合未穷尽仍为 INCONCLUSIVE；这一事实必须进入后续实际集成验收范围，不能据组件结果推定全组合 PASS。

### 公平性与非真空性

Terms 将旁观者持续在场设为常真，选择规则不读取 actorKind/controller/online，也没有 NPC 离开公平性。补救见证来自本人真实 decline 后玩家明确提交新 single_use，请求并非被模型自动修改。私物安置前 deferred 后有合法新请求；appearance 的合法提出仍以 settled 为前提。

Projection 仅对 DeliverLatest 加弱公平；最终服务器状态可以停在任一有限后态，不强迫玩家继续流程。Authority 归还活性仅在实际 holder 合作、域守卫持续可满足的条件下对 ReturnRule(owner) 加弱公平。两者都不承诺离线者回来、不承诺旁观 NPC 离开、不证明空间路径。

正向配置均启用死锁检查并要求实际完成、queue=0、预声明最低状态数；见证和负控采用否定不变量/时间性质并实际检查原始退出码和目标名称。第一次 Terms 安置前配置虽完成但只有 58 状态，低于预声明 100，记录为判据未达；检查发现遗漏安置后合法 appearance 提议，补入正常转移后变为 2,954 状态，没有降低阈值。此为模型补全，不是设计修复。Effects 曾将旧 inactive 请求最终归还误写 reason=fulfilled，已按源规范保留旧关闭归因；该修正也明确归类模型误建，不算新的产品 finding。
