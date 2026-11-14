# CS-R2 定向形式补证合同（运行前冻结）

模式为 check/design，只有源文件的定向只读映射；不把业务运行结果作为形式证明，不修改实现、候选Spec、旧模型或原131项记录。本轮新配置默认60秒、BFS、1个TLC worker、512MiB heap；若有剩余共享风险超时，先交实际规模，只有root另行明确授权才扩时。初始清单的预期不是运行结论。

## 固定输入

- 基础形式包：77ace28f526ce9ad905b1842b7353e48e251423c / tree006fc92d3cd261bddf22f698871e44b6434be36e。
- 设计：CS-R2 1a7f45ddfeca0d25fb3714e1ce45980b225d5bde / tree6b0130cd6838bf052504994527f05e29aabf521e。
- 计划：35d8759aac469eba5a8d9d4b94a787a3e62330c5 / treed838c05f22b54601dc9f291df028975347850c47，release §2.3。
- 固定独立审查：cs-r2-formal-independent-review-20261114.txt，SHA256 ab046ee5cf2659421f045f6dfa49628f914e3a9475bbc8738b27796cd107af89；需求INCONCLUSIVE、标准PASS，限原包声明范围。
- 可只读参考的IC-core+joints：68d2ccb26237c2deb9640b0f2014600929d3feea / tree8f449059；任何PG2/2均不作本包的TLC证据。

## 1. MF-EFFECT：选择性与共享控制围栏

### 状态、初态与边界

保留两个用途、每用途旧/新两请求、两真人p1/p2、本人C、借貌执行者W、两件物、实际disguise、holder、原取得、每request/item的taken/completed、grant及不可变proof。初态是两份合法single_use proposed；通过Accept实际建立accepted proof，不能把故障use-defense初态当正常前缀。原CAS/Terms/Consent承担进入这个合法proposed与Accept域守卫的组合前提；此模块不替本人决定reusable。

每请求的requester由身份固定：旧请求p1，新请求p2。依赖集合：private_items={C,requester}；appearance={C,requester,W}。合法proposal建立时捕获binding；Accept重验binding等于当前依赖签名后，把该签名冻结为proof。非依赖actor在签名内固定为0，不因无关epoch变化改proof或失效。stage=accepted表示已存在真实accepted历史/证明，当前本人status/lifecycle仍由Consent负责；是否可用另由grant/current proof/slot表示。

四个诊断正向配置分别允许C、p1、p2或W的epoch由1到2一次。另有**共享配置**允许四个actor按任意顺序各变化一次。五配置均保留一次共享Restart（generation1→2、paused）、Resume、Terminal，旧新两请求/两物交错；不是以四个单actor结果代替多个actor同一系统的顺序组合。共享未完就如实保留。

### 控制动作与frame

ActorChange(a)的affected按该请求依赖集合选择：停止affected中的grant、关闭受影响proposed、同步清对应disguise/改私物return_only；accepted proof原值、真实holder/取得/逐物集合不动。未受影响请求的grant/proof/执行状态不变。重启与终态则在同一动作全停；Resume只改变运行阶段，不新增grant、不写proof。

用state projection删除完整UI缓存、历史裁剪与最近Receipt展示集合；它们不参与本层效果/额度/控制守卫。保留原receipt存在条件：accept历史、used与taken分别决定旧accept/apply/take原动作可读；Replay(q,op)保留旧新identity并不执行世界效果。纯房间暂停对grant/custody是frame，本层允许动作的running超集不用于证明暂停期间可执行；纯暂停阻止使用的旧Consent条款保持原范围。本层保留真正使proof失效的Restart暂停，不能把其删作stutter。

逐动作映射义务：Accept建立当前proof；Apply只改外貌侧；Take只改私物侧；Stop与NewRequest按purpose/request，不迁移取得；Return/OwnerRepositions只改真实物件及私物额度；ActorChange按依赖集；Restart/Terminal为两个投影的共同关闭；Resume、正常Replay对领域状态stutter。控制签名的具体保存方式由实现自由选择，原子关闭、原身份和选择性集合不可改变。

### 实际将启用的性质与负控

| 性质 | 必须辨识的缺陷 |
| --- | --- |
| TypeOK | 非法复制位置值 |
| GrantCurrent | 漏掉subject或performer控制依赖 |
| AtomicEffects | grant停止但外貌残留；私物未切return_only |
| ControlFrames | 无关actor变化被误作全停；原accepted proof被原地刷新 |
| AuthorityUse | 旧首次apply/take越过当前grant/proof |
| QuotaCorrect | 原grant重拿已消费物；先还一件错误耗尽另一件 |
| CustodyStable | 新槽改写旧取得；控制变化自动搬走持物 |
| AcquisitionEvidence | 持物原取得的requester/accepted历史/taken不一致 |
| ResumptionReadOnly | Resume复活accepted旧grant |
| ReceiptReadOnly | 读回旧Receipt重新赋权 |
| TerminalClosed | 终态留下grant或外貌 |

见证包括选择性变化保持另一份grant、共用Restart/Terminal在双用途实际使用后同停、新槽后的旧take Receipt、停止后旧首次使用被拒。共享配置还核任意多actor顺序，状态数与结果分别记。

## 2. MF-RETURN/UI：动态双持有人与参数化完整快照

ReturnSnapshotCut复用SharedControlEffects的Init与真实Accept/Take/Stop/NewRequest/Return/OwnerRepositions/Replay动作，未加入手填持物初态。它枚举最小相关权威切面，不含控制历史；目标见证为p1持旧parcel/return_only与p2持新letter/delivery_pending同时存在。这是共享权威动作的子行为包含关系，不能把它说成全Authority世界已穷尽。

ReturnSnapshotOperators是参数化纯函数。输入保留slot、grant、stage/proof、holder、acquired、taken、completed及不可变requester映射。输出按observer过滤：holder/acquired仅自己的持物；当前request/额度仅该observer参与的当前请求；privateReturns从本人的实际持有及原取得派生，独立于当前槽。完整元组是验证观察关系，**不要求真实wire公开内部holder/actorId/proof字段**。

每条返还行有本次取得identity、original request、不可变accepted版本标识、原lifecycle关系、delivery_pending/return_only、当前observer/view/itemRevision的itemRef、可为null的ownerRef和内容登记原处。位置用登记内容符号抽象；ownerRef只有本人当前可见时存在，不按同名/同貌补齐。两个view与两种当前revision、ownerVisible布尔都是有限接口参数；每次实际相关参数变化必须由权威序列/当前view生成完整新快照。

性质包括类型、完整0～2集合、按观察者隔离、原取得身份、当前引用/ownerRef-null、安全归还目标以及完整元组复制。相应负控：漏letter/current-only、泄给另一人、把原取得改成新slot、旧view、伪造ownerRef、公共原处、漏额度字段；每项目标实际rc12。见证包含双持有人、新view且ownerRef-null、同槽两物变化、放回不记delivered。

ObserverSnapshotTransport把**已完整且按observer过滤**的payload作为不可分割值。标签(observer,seq,view)在边界内注入地代表整个payload；正常算法只检查observer/view/seq并整体赋值，不按业务字段选择。因此对任意合法payload内容，整体复制与相等关系在此映射下保持；不能证明产生payload的真实代码或传输序列缺口算法。该层保留两observer、两个view、三seq、任意已发消息重排/重复和旧Accepted。

同slot的拿取/归还可以产生新的seq/payload；发送不能只看slot/active。参数化映射要求同(observer,view,seq)指向同一一致快照，所有相关变化生成新seq或view；这是实际服务器必须履行的接口义务。新旧取得可同时存在由Cut的真实见证与行性质提供，不能由一个opaque标签伪造可达性。

传输正向启用TypeOK/ObserverBound/ViewBound/NoRollback/WholeSnapshot/ReceiptReadOnly及EventuallyCurrent；弱公平仅对每observer的DeliverLatest。负控覆盖跨observer、旧view/seq、部分复制、旧Accepted回写；miss-same-slot与持续旧Receipt回写分别必须产生真正rc13。两个可达见证为两observer在新view都收到当前快照，以及当前投影后旧Accepted晚到。

## 3. MF-RECOVERY：真正时间性质负控

PersonalRecovery按原字节复制为冻结依赖，SHA256 a986e81b2dfb6e366181b5892acfe0b0d399e006ad75f99d406e4bc826445b07。只新增Fault=consume-all、Focus=appearance、容量4、前/后各一次故障、一次可选重启的配置，启用原LiveSpec与BothPurposesProgress。保持类型、单个Unknown、原身份/Receipt、一次效果与容量不变量；有意不启用会先截断的PendingPurposesPreserved，目标是实际时间性质rc13。

原15,984状态的正常活性对照复用原候选/原输入SHA，不再运行相同正向配置。原所有公平条件保持：内部reserve/commit/recover/consume、已提交通知与Resume的弱公平，有限故障；不强迫新输入、玩家或NPC配合。丢待办后Candidates为空导致对应Reserve不再enabled，公平性不能凭空补出已丢语义。真实返回轨迹才作为敏感性结论，不以旧rc12顶替。

## 交接边界

本轮结束冻结新commit/tree、新配置/输入SHA、真实命令、状态数/指纹/反例与逐MF结论。原包的5项未完、旧异常use-defense切面和178次历史保持不变。本轮结果不能自动释放实际代码FM；真实事务/版本/引用/页面行为仍由固定实现对应与独立复核决定。
