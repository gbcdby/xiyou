# #62：七项未决形式义务的源模型对应与候选闭合

## 1. 结论的身份与证明负担

本文件是作者提交独立审查的**候选论证**。实际 TLC 结果见 `CLOSURE_RESULTS.md` 与 `CLOSURE_RUN_INDEX.json`。原 `RESULTS.md`、原 `RUN_INDEX.json`、旧模型和旧超时均保留；新图的 PASS 不改写旧运行的 INCONCLUSIVE。没有执行 TLAPS，也没有给生产 JavaScript、DTO、数据库或 UI 建立机械精化证明。

基线是 main `3a3001325553b5116db65234190fd681bac7eaf4`，tree `d16f5538f65e80a85aa563ced2bc3cd373db4d09`；任务为 [#62](https://github.com/gbcdby/xiyou/issues/62)，父项 #29、Spec #23。这里复用已合入基线的 CS-R2 有限模型合同，不修改产品语义。

| 原始模块 | SHA-256 | 本轮关系 |
| --- | --- | --- |
| `SharedControlEffects.tla` | `151baf3544b2401bc0fdb2f0ce3fdf8e0feb449024227f2b35dee6e7bd3c7108` | 签名相等商 σ；四 actor 仍在一个共享图内 |
| `ReturnSnapshotOperators.tla` | `52c903cd0b7006ca66a7796bde9031811a163e7d78a8720eba71bab2abcd6cb2` | 原函数逐字复用；检查输入因子及其合成 |
| `../cuilan-self-response/model/PersonalEffects.tla` | `4c20bde2577d87e539caddd60eaa58ac4fc9b6b27cd04f7c142a6afe31b94602` | 历史标签商 η；可选非 open 标签商 λ |
| `../cuilan-self-response/model/AuthorityEffects.tla` | `96fb85b6509524cab9b28cacf4aca41ca0ae1996f53aa0da0ab246017cb54dfc` | 同一 η；缓存安全证明的目标组件 |

`build_quotient.py` 与 `../cuilan-self-response/build_history_quotient.py` 对上述源文件固定摘要，逐片段生成新模块；源漂移时拒绝继续。生成审计可证明未列片段逐字相同，**不能单独证明语义对应**。以下逐动作、读依赖、性质与公平性论证是额外的审查义务。

这里采用的证明形状是：初态映射、每步映为目标动作或 stutter、性质在映射下保持；状态域另给 Init/Next 归纳理由。方法依据见 Lamport 的 [Proving Safety Properties](https://lamport.azurewebsites.net/tla/proving-safety.pdf) §4.2 与 Part II。活性另检查非 stutter 动作的 enabledness；WF 的定义依据 [Specifying Systems](https://lamport.azurewebsites.net/tla/book-02-08-08.pdf) 第 8 章。本文的模型代入和结论由下文及实际证据承担，并非这些资料替本项目证明。

## 2. 共享图的签名相等商 σ

### 2.1 映射、域前提与消费者

对原状态 s 保留全部变量及字段，只将每个请求的 `binding[q]`、`proof[q]` 映成是否等于**当前** `Signature(q)` 的布尔值。请求 q、用途、旧/新编号、requester、items、四 actor 的独立 epoch、generation、stage、slot、grants、持物、原取得、taken/completed、所有监视器都保持。

令 `D(q)` 为原 `Dependencies(q)`。必须证明的归纳前提 NF 是：每个存储签名的 generation 不大于当前 generation；D(q) 内每个坐标不大于当前 actor epoch；D(q) 外坐标恒为 0。没有把 NF 作为业务图的 CONSTRAINT。

NF 的源模型归纳检查如下。

1. Init 的 EmptySignature 全为 0；旧 proposal 捕获当前签名，满足 NF。
2. NewRequest 唯一地给新 q 捕获当前签名；Accept 只复制该 q 的 binding 到 proof。二者不写其他请求的签名。
3. 正常 ActorChange 不写源 binding/proof，只将一个 actor 的 epoch 从 1 增到 2；Restart 同样保留源签名，只将 generation 从 1 增到 2。NF 因此保持。
4. 其他动作的 UNCHANGED 保留签名与相应环境。`Fault=none` 排除了 refresh-proof 的违规写入。

`SignatureProjectionLemmas` 直接枚举全部有限 NF 输入点，包括比真实捕获域更宽的签名，检查 CaptureMatches、EmptyStale、ActorProjection、RestartProjection 及三项域闭包。输入域是纯函数检查的 Init；不是过滤原可达图。

原签名的**全部读消费者**为：Current 中 proof 与当前 Signature 的相等比较、Accept 的 binding 比较和复制、NewRequest 的捕获、故障 refresh-proof 的局部写、ActorChange 中 `np#proof` 的不可变性监视。不存在签名间排序、两个旧请求的 signature 相等比较、以签名为键的集合去重、序列化或整份 Source 的相等判断。`vars` 只用于状态元组、stutter 和 frame；其整体状态相等正是该商合并的历史信息，不是协议守卫。

`ReturnSnapshotCut.Source` 虽携带 proof 字段，原构造器没有读取它或比较整个 Source；它不能把被擦除的历史签名重新带回一个消费者。若以后加入上述任何读取，固定摘要会失效，必须重新建立关系。

### 2.2 关键等式与逐动作对应

在 NF 下，若 actor a 从 1 变为 2：当 a∉D(q) 时当前 Signature 不变；当 a∈D(q) 时存储坐标最多为旧值 1，故匹配必为 FALSE。Restart 前的存储 generation 最多为 1，新的 generation=2，故全部旧匹配位为 FALSE。这里严格依赖有限单调域，无回绕或 ABA。

| 原动作 | σ 后的目标动作 | 必须保持的内容 |
| --- | --- | --- |
| Init | 新 Init | 旧 binding 为 TRUE，新 binding 与全部 proof 为 FALSE；其他初态相同 |
| Accept(q) | 同名 Accept(q) | 守卫匹配等价；源 proof'=binding 映为布尔复制；stage/grants/额度相同 |
| NewRequest(p) | 同名 NewRequest(p) | 新捕获映成 TRUE；旧签名、原取得身份与全部额度不变 |
| Apply / Take | 同名动作 | Current 等价；原身份、实际物和效果更新完全保留 |
| Stop / Return / OwnerRepositions | 同名动作 | 签名与环境都不变；全部实体与逐物更新逐字相同 |
| ActorChange(a) | 同名 ActorChange(a) | 依赖 a 的匹配位清零，无关位保持；四个 actor 都仍可独立选择 |
| Restart | 同名 Restart | 全部匹配位清零；共享暂停、全停、持物和额度 frame 原样保留 |
| Resume / Terminal | 同名动作 | 不捕获新签名、不增加匹配；Terminal 同步全停 |
| Replay(q,op) | 同名 Replay(q,op) | q/op 与原 stage/used/taken 的收据存在关系保留；不读取签名历史 |
| Idle / `[Next]` stutter | stutter | 对应动作的 enabledness 保持；stutter 本身总被规格允许 |

`Fault=none, Probe=none` 时 RejectOldFirst 和 TypeFault 禁用。σ 的正常对应不涵盖各故障语义；新故障配置检查商模型对已声明错误的敏感性，不能替代源→商证明。

源 `proof` 在 ActorChange 中没有被修改，σ(proof) 却可能随环境变成 FALSE。因此不能把商的 `np#proof` 当成源 proof 被改写。生成器把监视器改成是否执行了故障 refresh-proof；在正常语义下两边都保持 FALSE。专门的 refresh-proof 负控仍须命中 ControlFrames。

### 2.3 共享动作的 frame

| 事件 | 同步改变 | 必须保留 |
| --- | --- | --- |
| ActorChange(a) | 仅 a 的 epoch；受影响 proposed 关闭、grant 删除、执行模式停止、对应 disguise 清除 | 其他 actor epoch；源 binding/proof 字节；slot、holder、acquired、originalAcquired、taken/completed、used、generation、phase、restarted；无关请求的 stage/grant/execution |
| Restart | generation、restarted、phase；所有 grant 清空、proposed 关闭、效果停止 | 四 actor epoch、源 binding/proof、所有槽、实际持有与原取得、额度和 used |
| Terminal | phase、所有 grant、proposed、执行模式、disguise | generation、restarted、四 actor epoch、源签名、所有槽、持物、原取得、额度和 used |
| Resume | phase | 所有请求、签名、许可、物权、额度和效果；没有恢复许可 |

上述共享转移是**同一个图的一步**。本轮不把四个单 actor 结果相乘，也不拆开 Restart 或 Terminal 的原子边界。ControlFrames 的机器监视只覆盖误删无关 grant 和改写源 proof；其他字段 frame 由精确赋值/UNCHANGED 和生成差分逐项核对。GrantCurrent、AtomicEffects、CustodyStable 等另检查其动态后果。

共享商启用原 11 个性质，并新增 `SourceInputClosed` 作为普通被检查不变量；没有拿它过滤状态。TypeOK 增加布尔 binding/proof 的类型检查，其余原声明性质在 σ 下等价或由更强类型项蕴含。

## 3. 原完整缓存模型的历史标签商 η 与 λ

### 3.1 精确擦除范围

η 将 `r[q].reason` 规范为 `"none"`，将 e 的 returnedClosed/restored/lateOld/stoppedActive 四位和 `ui.receiptSeen` 规范为 FALSE。其余状态逐字段保持，尤其是完整 `ui.observed`、`ui.confirmed`、Observable、ReturnContext、NormalReturn 的缓存成员守卫、r.status/life/grant/proof、原取得、两 view、historyAvailable 和全部额度。

λ 只在 η 之上将 `r[q].life` 映成：原值为 `"open"` 时仍为 open，其余为 closed。三个写入改动是初始 absent、cancelled 与 superseded；closed 原值保留。λ **没有**合并 status 或 execution，也没有删除缓存。

| 字段或读路径 | 原消费者核对 | 保持依据 |
| --- | --- | --- |
| r.reason | StopRecord/ReturnRule 写入；record 拷贝及 `@` 继承 | 无 guard、性质、Observable、ReturnContext 或整记录比较读取 |
| 四个 e 位 | 各动作写入；NoWitness 在对应 Probe 分支读取 | 新模块显式 `ASSUME Probe="none"`；原见证版本和结果单列、不迁移 |
| ui.receiptSeen | Init/Replay 写入；其他动作拷贝 | 无行为、性质或缓存字段读取；ui.observed 与 ui.confirmed 不擦除 |
| r.life | Usable、Restart、Terminal 只比较是否为 open；其他地方赋值或保留 | λ 精确保留 open 谓词；没有非 open 标签间的比较 |
| r、ui、e 整记录 | `EXCEPT`、函数构造、局部 nextRequests、UNCHANGED、vars | 都是字段选择/拷贝/赋值；没有协议 guard 用整 r/ui/e 的相等性读取被擦除字段 |
| Observable / ReturnView / ReturnContext | 完整缓存比较、整体赋值与归还引用成员测试 | 只从保留字段和 Usable 的 open 谓词构造；无标签别名逃逸 |

原模块没有序列化或外部操作符把这些整记录转为另一个可比较的值。Source/Observable 的间接依赖也纳入本表，而不只依据字段名搜索。固定源摘要与精确生成改动为此人工消费者核对确定输入身份。

### 3.2 每步、性质与死锁

Init 的投影恰是相应新 Init。Apply、Take、Stop、NewRequest、AcceptNew、ReturnRule/NormalReturn、OwnerRepositions、RefreshView、PruneHistory、Restart、Resume、Terminal、DeliverProjection、Replay 的 guards 只读保留字段或 open 谓词；所以启用性相同。每个更新要么写保留字段、要么写被规范的常量、要么复制 `@`；这些赋值与 η/λ 交换，映成目标同名动作。Work 的存在量词、Idle 的 `~ENABLED Work` 因此也保持。

Fault=none 时 FinishSplit 和 TypeFault 禁用。Replay 可以把源第一次 receiptSeen 的变化投成 stutter；规格的 `[Next]_vars` 允许这一结果。反向按同名动作提升可达轨迹时，被擦除标签由原赋值恢复，不参与下一步 guard，不会产生不可提升的行为约束。

原 16 条安全性质的表达式逐字保留。除了仅在 Probe 中使用的 NoWitness，全部只依赖保留字段或 open 谓词。`ReturnPreservesClosureCause` 的实际公式是 `~e.badReturnHistory`，该位未擦除；这项并不是对任意 UI 原因文字的独立真实性证明。RestitutionEnabled 内的 `ENABLED ReturnRule` 也保持：该规则的 guards 和实际效果均保持，所有 `UNCHANGED ui/e/r` 部分均有对应后态。

TypeOK 没有枚举 r.life 的具体标签，因此 λ 不削弱或重写其声明。原 cfg 的规格、参数、性质、死锁检查逐字复用，新 cfg 摘要与原 cfg 相同。新 run 的时间/堆上限和模型入口另外记录，旧 run 不改绑。

本模型始终有旧请求的 receipt；没有动作把它清除，Replay 没有 Available 限制。因此包括 Terminal 之后在内，总有一个 Replay 后继，非死锁义务也有直接的源见证。安全论证不借助要求世界继续行动的公平性。

### 3.3 公平性不能只靠同名 WF

`effects-cooperative-return` 使用 η，不使用 λ，保留原 `WF_vars(DeliverProjection)` 与每物 `WF_vars(NormalReturn(i,"owner"))`。必须核对的是 `ENABLED <<A>>_vars` 及非 stutter A 步，而不是 WF 字符串。

| 公平动作 | enabledness | 非 stutter 及映射 |
| --- | --- | --- |
| DeliverProjection | Fault=none 时恰为完整 `ui.observed # Observable`；二者逐字保持 | 启用时赋值后的 observed 必不同于原 observed，更新保留字段；不能只改变擦除位 |
| NormalReturn(i,owner) | 持有者、原取得、Available、完整 ReturnContext 成员和 ReturnRule guards 均保留 | 成功必将保留的 holder[i] 从玩家改为 owner；映后仍是同一非 stutter 返回 |

因此源状态中上述非 stutter 动作持续启用，当且仅当映后持续启用；每次源公平进展也给目标同一进展。只改擦除位的 Replay 不属于任何命名 WF 动作，不能无限满足源公平却不给目标进展。四个单调监视位和 receiptSeen 还只能各有限变化，但本证明不依赖把“有限 ghost”当作跳过命名公平动作的理由。

CooperativeReturns 只读 Available/holder/running；ProjectionEventuallyCurrent 比较两个保留的完整值。故它们在 η 下保持。此处没有采用 Authority 的更弱归还守卫来推出客户端活性，也没有假设任意玩家实际合作。

## 4. 双用途完整缓存安全性的额外模拟 α

双用途 life 商的本次 300 秒探索仍未穷尽，必须保留 INCONCLUSIVE。候选安全结论改由本节明确的关系承担；**不是**把权威图的状态数称为完整缓存图的状态数。

目标为已完整穷尽的 `AuthorityEffectsHistoryQuotient`，参数与原 effects-both 完全一致：UsePurpose=both、ProjectionMode=item-ledger、Fault=none、Probe=none、EnableEnvironment=FALSE。先对完整 PersonalEffects 状态应用 η，再应用 α。

定义常量初始观察值 O₀：两用途 slot 均为 1、active 均为 TRUE；两物 holder 均为 origin、acquired 均为 None；每请求 taken/completed 均为空；每玩家 returns 为空。令 α 将 ui 映成 `[observed |-> O₀, confirmed |-> O₀, receiptSeen |-> FALSE]`，其余 η 后变量保持。源初态中的缓存确实为 O₀。

| 完整缓存源步 | 目标 AuthorityHistory 步 | 精确理由 |
| --- | --- | --- |
| Init | Init | 所有领域初态相同，缓存均为 O₀ |
| Apply/Take/Stop/NewRequest/AcceptNew/OwnerRepositions/RefreshView/PruneHistory | 同名动作 | 世界守卫无 ui；ui frame 映成固定值的 frame |
| NormalReturn(i,t) | ReturnRule(i,t) | 源另有缓存成员守卫，满足源就满足目标域守卫；领域赋值相同 |
| DeliverProjection | stutter | 只写源 ui；α 后固定 ui，其他变量不变 |
| Replay(q) | 同名 Replay(q) 或 stutter | Fault=none 不回写 observed.active/slot；η 抹去 receiptSeen 与依赖旧缓存的 lateOld 见证位 |
| Restart/Resume/Terminal | 同名动作 | 规则的领域效果相同且不读 ui；本 both 配置环境动作本就关闭 |
| Idle 或外层 stutter | stutter | 无需目标 Idle 的 guard 成立；目标 `[AuthorityNext]` 允许 stutter |

Source 的 `TypeFault`、`FinishSplit` 在 Fault=none 禁用。映后每一步均满足 `[AuthorityNext]`，故源任意行为的像是目标行为。NormalReturn 的额外 UI 守卫可能减少实际归还机会，不能用于活性结论；这不影响状态安全模拟。

Authority 的 15 条不变量恰为原 effects-both 的 16 条删除 ConfirmedProjectionOnly，且它们在 α 下保持。唯一含 enabledness 的 RestitutionEnabled 检查的是 **ReturnRule**；该规则不以缓存成员为前置条件，固定 ui 的 frame 总可满足，所以不把客户端可能暂时不可点按偷换成服务器规则可用性。

第 16 条 ConfirmedProjectionOnly 对完整源单独归纳：Init 的 observed=confirmed；DeliverProjection 把两者都赋为同一 Observable；Fault=none 的 Replay 只改 receiptSeen；其他动作对整个 ui 做 UNCHANGED。因此每步保持相等，不要求缓存已经最新，也不清空源缓存或删除其历史。

这给出原有限配置全部 16 条**声明安全性质**的候选闭合；独立审查必须检查本关系及 η。它不证明双用途缓存活性、原 UI 标签文本、网络序列/缺口恢复或生产完整实现。直接图的未完成状态仍有独立意义，不能改写。

## 5. 合法 Source 域到纯 constructor

### 5.1 源域闭包

新增 SourceInputClosed 检查 stage、slot、holder、acquired、taken/completed 的完整类型；appearance 的额度为空；GrantCurrent；以及 AcquisitionEvidence（玩家持有时，原取得为该玩家实际 accepted private 请求且该物在 taken 中）。它在共享图内作为普通不变量完成检查。通过第 2 节 σ 关系，该域对应源共享模型；不把这个域当外加过滤条件。

原 ReturnSnapshotCut 的 WorldWork 是同一源动作的子集：Accept/Stop/Take/NewRequest/Return/OwnerRepositions/Replay。其 Refresh/Visibility/Revise 对整个权威 vars 都为 stutter，views/revisions 始终在 1..2，ownerVisible 为 BOOLEAN。故 Cut 的每个 Source 都属于该域；不必穷尽额外 UI 参数与世界历史的整个笛卡尔积才能调用一个纯函数。

### 5.2 两个直接输入因子及合成义务

`ReturnInputDomain` 原样导入 ReturnSnapshotOperators。rows 与 requests 是按具体字段依赖分开的**输入检查**，不是两个运行图自动组成一个全图。

| 输入因子 | 完整枚举的内容 | 规范化部分与理由 |
| --- | --- | --- |
| rows | 两物的全部 holder/acquired 组合；玩家持物时原取得 requester 相符；当前 private 槽；该槽 grant 有/无；两 observer、两 view、owner 可见/不可见、每物两 revision | stage 规范为 accepted、额度取代表值；行函数、Owned 和 own-holder/acquired 不读这些值 |
| requests | 任一 focus 用途；其两请求全部 stage、slot、所有 grant 子集、任意 taken/completed 集合、两 observer | 另一用途规范为空、holder 为空；对应请求字段按 purpose/q 点式构造，与返还行、引用及另一用途额度无交叉依赖 |

rows 只枚举至多一个 private 当前 grant，源 GrantCurrent 已保证 grants 中每个 q 的 q[2]=slot[q[1]]。旧持物 q 与当前槽可以不同，旧/新两个持有人可以同时存在；这种关联没有擦除。requests 允许比源更宽的 grant/stage/额度组合，因而不依赖未证明的“全已接受”假设。

对合法 Source 的合成证明如下。

1. Owned 与 own-holder/acquired 只依赖 holder/acquired/p。将源的这部分和 private grant/slot、当前引用参数代入 rows，其全部行输入完全相同。原 stage/额度变为代表值不会改变 rows。
2. Fault=none 时行集合恰为 `{Row(s,p,i,...): i∈Owned(s,p)}`，每行 item=i，故 i 到 row 为单射，既不漏物也不产生重复物行。原取得、两版本 token 和 context 均取实际 acquired[i]；mode 只取该 q 的 grant 成员关系。FreshRows 与 NarrowTargets 只读当前引用参数或固定内容登记值。
3. 对任一用途 p₀，把该用途的两请求 stage/slot/grants/taken/completed 代入 requests 的 focus=p₀。VisibleRequests 的每 q 判断只读其 requester、stage 和同用途 slot；ProjectedSlots/Active 的每用途分量只读同一用途。来自另一用途的数据不会改变这个分量。
4. taken/completed 输出是按 VisibleRequests 对原函数做限制。各 q 值独立复制，跨用途域的并集没有碰撞（q 保留用途和编号）。因此分别成立的点式等式蕴含完整函数等式。
5. SnapshotTyped 的 observer/view 类型由合法引用域保证；returns 的 item/mode 类型由第 1–2 步；ObserverIsolation 的行/holder 部分由 Owned，taken 域部分由第 3–4 步。FullTuple 的六个字段分别由第 1 或第 3–4 步建立。不存在需要一个未枚举跨因子相等关系的剩余字段。

以上逐字段等式加上两个输入因子的实际穷尽，形成 constructor 的候选全合法域结论。Source.proof 不参与构造；版本 token 固定于原取得 q/i，而非当前槽。每个 q/i 最多实际 Take 一次由源额度模型保持，故在该有限模型中 token 不混同两次取得。

### 5.3 明确保留的外层接口义务

constructor 不是 sender/receiver 的完整实现证明。原 `MAPPING.md` §5 的发送合同仍必须满足：同一 observer/view/seq 只对应一个完整 payload；相关世界变化要生成完整新快照；接收方过滤 envelope 后整体替换。第 2 节 σ 没有接触消息序列或 payload，也不能据当前 guard 的布尔值删除不同旧消息的关联。

原 `ObserverSnapshotTransport` 的消息标签、完整 payload 唯一对应、旧新 envelope 相等、view/seq 顺序仍在原模型身份下。本轮未把它们并入一个无界网络×世界×缓存精化结论。历史版与当前版号大小、重启再匹配仅在各模型声明的有限单调域内讨论；无 ABA、无限请求或任意次数重启保证。

## 6. 七项逐一对应与审查裁决点

| 原未决项 | 新候选证据 | 原项可否按候选关系闭合 | 仍须保留的边界 |
| --- | --- | --- | --- |
| effects-private | η 完整缓存图、原 16 条安全性质 | 独审确认 §3 后可给有限配置闭合 | 原运行仍超时；无生产精化 |
| effects-restart-private | λ∘η 完整缓存图、原 16 条安全性质 | 独审确认非 open 标签及 §3 后可闭合 | 一次重启、两 view、有限额度；标签 UI 语义不在性质中 |
| effects-both | authority-both η 穷尽 + §4 α 模拟 +缓存相等归纳 | 只能按明确组合证明候选裁决，不能称完整缓存图穷尽 | 本次 life 图也未完成；无双用途缓存活性结论 |
| effects-cooperative-return | η 完整缓存 LiveSpec，原 16 安全与 2 活性 | 独审确认 §3.3 的 enabledness/非 stutter 迁移后可闭合 | private、环境关闭、原合作与投影 WF 条件 |
| authority-both | η 权威图、原 15 条安全性质 | 独审确认 §3 后可闭合 | 不含完整 UI 消费或实时网络 |
| fence-shared | σ 共享四 actor 图、原 11 性质 + SourceInputClosed；NF 输入引理 | 独审确认 §2 的源 NF 归纳、消费者与 frame 后可闭合 | 有限单调 epoch/generation；未执行 TLAPS |
| returns-constructor | Source 域闭包、rows/requests 两因子穷尽、§5 合成 | 独审确认每字段无遗漏跨因子消费者后可闭合 | 发送方唯一 payload 等外层条件未变；原 Cut 全图超时仍保留 |

原负控若读 erased witness 位，不迁移到 η/λ，也不由新运行冒充覆盖。新负控只按实际命中的性质、真实退出码、输入 hash 分类；rc12 是预期反例，不能计作正常图穷尽。出现未完成、新消费者或对应关系争议时，只保留实际有限证据，对受影响原项维持未决。

## 7. 复算与资源边界

先运行两个生成器的 `--check --audit`，再按新 manifest 的 profile 调用原 `run_tlc.py`。所有正式源模型和 cfg 在 Git 中；原始日志和输入快照按各 run 单独封存。`CLOSURE_RUN_INDEX.json` 给模型/配置/依赖/runner/jar 的摘要和原始结果摘要；机器路径仅在公开索引中作可逆前缀规范化。

本轮每个 TLC 进程 1 worker、最大 heap 1024 MiB；最多同时两个进程，合计 2 workers / 2 GiB 堆上限。JVM 本地和 off-heap 内存没有实测。TLC 固定 2.19，jar SHA 为 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`。正向使用普通 BFS，无 CONSTRAINT、VIEW、对称约简、随机模拟或 Java override。直接输入模型的 self-loop 是纯函数检查终态，不用于宣称业务活性。

原始日志中 TLC 本地时区与 runner 的 UTC 时间不同；耗时以 runner 的 duration_seconds 为准。超时只能给最后进度下界，不补写最终状态数。所有作者判断都等待独立需求轴与标准轴审查；#62 是否关闭、PR 和合并由既有总控处理。

## 8. R-ISSUE62-STD-001：逐项敏感性差量

独审指出，原候选 `4c9957349800767efc4a9668d29fc8c896cd5e2d` 的八项新属性中，六项缺少以自身名称实际命中的 rc12 负控；这不符合 `docs/engineering.md` 的既有“每个不变量”要求。该 finding 属于标准轴，不是正常模型语义反例。本节给作者修正证据，不能代替独审关闭 finding。

**原 `SignatureProjectionLemmas.tla`、`SharedControlQuotient.tla`、全部旧模型与旧 cfg 字节未改。**新增 `SignatureProjectionSensitivity.tla` 由 `build_signature_sensitivity.py` 从 SHA `28197b9588bcea3a4b514c764749ca520ecfb69d35f1748f6c3cbd05e71dcd44` 的原引理生成。它把捕获、空值、actor 步进和恢复代号构造提为可注入具体错误的函数，保留正确的 ReferenceSig 作比较基准；没有反转断言、把断言设为 FALSE 或改变 NF 的输入域。

Fault=none 时：Sig=ReferenceSig，ReferenceSig 逐字为原 Sig；EmptySignature 展开成原全 0 签名；AdvanceEpoch 展开成原 `a:=2`；RestartGeneration 展开成原 2。七个性质经这些局部展开就是原公式，Init/Next/vars 及有限域保持原字节。副本 none 的独立实际检查为 3500 distinct / 7000 generated / queue 0、rc0；原引理正向和原两个投影负控继续使用其原模块身份。

| 本次目标不变量 | 具体缺陷构造 | 保持的断言及实际结果 |
| --- | --- | --- |
| CaptureMatches | 捕获 proof 时使用上一代 generation（g-1） | 仍要求捕获值等于正确当前 ReferenceSig；实际 rc12 命中 CaptureMatches |
| EmptyStale | 未建立 proof 却把空值填成当前完整签名 | 仍要求空签名不匹配当前；实际 rc12 命中 EmptyStale |
| CaptureInDomain | 提前把 C 的 epoch 写成当前值+1 | 仍要求捕获值满足原 NoFuture；实际 rc12 命中 CaptureInDomain |
| ActorDomainClosed | 控制变化把目标 actor epoch 重置为 0 | 原已捕获坐标可能大于后态坐标；原 NoFuture 判断实际 rc12 命中 ActorDomainClosed |
| RestartDomainClosed | 恢复把 generation 重置为 0 | 原存储 generation=1 在后态来自未来；实际 rc12 命中 RestartDomainClosed |
| SourceInputClosed | 复用共享模型原 reassign-acquisition，将旧持物的取得换成新请求 | 仅配置 SourceInputClosed；真实取得/持有者/accepted 关系不成立，实际 rc12 命中该新性质 |

六条均为预先声明单一目标的实际运行；签名五条在合法输入点的初态即可显示构造错误，原始统计没有终局值时保留 null。SourceInputClosed 来自真实 Accept/Take/Stop/NewRequest 动作轨迹，475 distinct 后命中；没有手填不合法源初态。原两个投影负控和这六条共同覆盖八项新增属性，逐项原始 run_id、日志 SHA 与 rc 见 `STD001_SENSITIVITY.json`。

原 36 次运行及其封存包保持，新增差量另封存；`STD001_REUSE_AUDIT.json` 记录原候选模型/cfg、旧 profile 定义和旧原始证据逐项不变核验。没有重跑正常大图或原 26 条负控，也没有借此修改 §2–6 的证明范围、原 INCONCLUSIVE 或生产实现结论。
