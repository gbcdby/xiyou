# CS-R2 补证：状态投影、动作帧与接口合同

本文件解释补证模型的抽象和组合依据，不是生产实现的机械精化证明。源设计固定为 `1a7f45ddfeca0d25fb3714e1ce45980b225d5bde`，计划固定为 `35d8759aac469eba5a8d9d4b94a787a3e62330c5`；结果由同目录 `RUN_INDEX.json` 指向实际输入、命令和日志。原 `77ace28` 包、原五项未穷尽、异常 use-defense 初态与历史证据不改绑。

## 1. 共享效果模型的合法入口和有限状态

`SharedControlEffects.Init` 是两个用途各一份合法 `proposed`，没有预填 accepted/grant/disguise/holder。`Accept(q)` 实际检查当前槽及 proposal binding 后建立 accepted proof。这里的 `stage=accepted` 是“曾有真实接受的持久证据”，**不是**取消/失效后仍显示本人当前 consent.status；当前用途可用性由 `grants`、当前槽和 proof 控制。本人决定、lifecycle 归因、严格 purpose/version/CAS、scope digest 与 single_use 资格由旧 CAS/Consent 和 R2 Terms 的输入合同承担，不能从这个简化 stage 反推生产状态机。

每用途两请求：旧请求由 p1 提出，新请求由 p2 提出；两用途均有各自旧/新身份。真实翠兰 C、借貌执行者 W 与两个请求者均为独立 actor。两物 parcel/letter 有单一真实位置、原取得请求、每请求 taken/completed。一个请求中每物只取一次；新合法请求仍可对已经实际放回的物另行安排。

所有增长量有明确有限界：每 actor epoch 只从 1 到 2 一次；generation 只随一次 Restart 从 1 到 2；每用途槽只从 1 到 2；stage 每请求单调走 proposed/accepted 历史或 closed，used/taken/completed 只增长于有限集合。OwnerRepositions 可以将真实 owner 处的物放回 origin，但要再次送达 owner 必须先有新的、尚未消费的 Take；四个私物 request/item 取物额度限制这类循环。Replay/Idle 只是同状态或有限诊断位；没有无界 seq、nonce、日志长度或重连计数。没有模回绕、CONSTRAINT、VIEW、对称归约或随机取样。

## 2. 控制签名与受影响集合

对请求 q 定义 D(q)：private_items 为 `{C, requester(q)}`；appearance 为 `{C, requester(q), W}`。`Signature(q)` 包含 generation，以及 D(q) 内 actor 的当前 epoch；不在 D(q) 内的 actor 固定映射为 0。

初始旧 proposal、以及 `NewRequest` 创建的新 proposal，在建立时捕获 binding。`Accept` 比较捕获值与当前签名，成功后把它冻结为 proof；后来的控制变化不重写 accepted proof。actor a 变化的 affected 精确为存在且 `a ∈ D(q)` 的请求。新请求在变化后捕获的新 binding 可以合法通过，旧请求不能借更新 proof 偷渡。

| 控制事件 | 应受影响 | 必须保持的对应关系 |
| --- | --- | --- |
| C 变化 | 两用途中所有依赖 C 的旧/新请求 | 同一步停 grant/外貌并保留真实持物与原取得；本人身份资格在上层另核 |
| p1 变化 | 两用途的旧请求 | p2 新请求的 grant、proof 与执行模式不因此改变 |
| p2 变化 | 两用途的新请求 | p1 旧请求的 grant、proof 与执行模式不因此改变 |
| W 变化 | appearance 的旧/新请求 | private_items 的许可、持物和逐物额度保持 |
| Restart | 所有当前有效许可 | generation 更新、paused、全停同时提交；原 proof、取得、持物及额度保持 |
| Resume | 只改运行阶段 | 不发新 grant，不改 proof，不恢复外貌；新请求仍须当前合法入口 |
| Terminal | 所有当前有效许可 | 全停并禁止新领域动作；已持物事实不会被伪归还 |

四个单 actor 配置只证明各自切面。`fence-shared` 同时保留四 actor 的任意变化顺序、两个用途和共享 Restart/Resume/Terminal；其结果单独分类，绝不能由四个诊断结果拼成 PASS。

## 3. 明确的状态投影与逐动作帧

令 A 是 appearance 的两个请求，P 是 private_items 的两个请求。µA 保留 stage/binding/proof/execution 在 A 上的限制、`grants∩A`、appearance slot、disguise、used，以及 generation/phase/restarted 和四 actor epoch。µP 保留 P 上对应请求字段、private slot、holder/acquired/originalAcquired、P 上 taken/completed，以及 generation/phase/restarted 和 C/p1/p2 epoch；W 的值在 private proof 中恒为 0，故从 µP 的控制部分删除不改变任何 private 守卫。

诊断记录 e 是有限的性质监视器：它捕获非法使用/重复额度、控制搬物/改变无关 grant/刷新 proof、Resume 或 Receipt 写权限等事件，不是新增生产账本。下面的帧表逐项来自 Fault=none 的赋值和 UNCHANGED；没有把整个 UI 历史乘回世界状态。

| SharedControlEffects 动作 | µA 的对应 | µP 的对应 | 共享/被删除状态的依据 |
| --- | --- | --- | --- |
| Init | 合法 proposed、无许可/外貌 | 合法 proposed、物在原处/无取得 | 初态实际生成 accepted 前缀；不采用 use-defense 异常初态 |
| Accept(appearance) | 当前 binding 建立 proof/grant | stutter | 不读私物 holder 来决定借貌；done 对 appearance 为空 |
| Accept(private) | stutter | 当前 binding 建立 proof；真实已在 owner 的物可记完成 | 已实收是世界事实，不转移别人的原取得 |
| Apply | 当前借貌 grant/proof 下建立一次外貌 | stutter | 不写私物 holder、取得或额度 |
| Take | stutter | 当前 private grant/proof 下改真实持有与原取得，消费该 q/i | 旧新请求身份保留；不能由同一 q 重取已消费物 |
| Stop(q) | q∈A 时停权/解除，否则 stutter | q∈P 时停权/保留持物为 return_only，否则 stutter | Stop 只抽象实际停用，不代写本人 withdraw 的原因/决定 |
| NewRequest(purpose) | 仅 appearance 的合法换槽 | 仅 private 的合法换槽，旧取得不动 | 旧 proposed/有效 grant 阻挡第三方占槽；失效/结束后可建新身份 |
| Return(i,owner/origin) | stutter | 实际逐件处置；owner 可标对应 private 已实收，origin 不标 completed | 仅真实持有者的物可处理，旧 request 无 grant 也能归还；不会赋权给新人 |
| OwnerRepositions | stutter | 真实 owner→登记原处 | 不清 taken/completed；新许可可另行安排，旧许可额度不复活 |
| ActorChange(a) | 仅含 a 的 A 请求停止 | 仅含 a 的 P 请求停止；W 时 stutter | binding/proof/取得/额度不变；非 affected 请求全部领域字段按赋值保持 |
| Restart/Terminal | 同一步全停并解除外貌 | 同一步全停；已持物为 return_only | 共同事件不是两个可分开的事务；真实持物不动 |
| Resume | phase 变化；其他领域字段不变 | 同左 | 不是 grant 新来源 |
| Replay(q,op) | stutter | stutter | 旧 accept/apply/take 原结果存在由 stage/used/taken 判定；q/op 区分旧新身份，返回历史不再执行效果 |
| RefreshView/裁剪展示历史/纯只读 UI 事件 | 模型中 stutter | 模型中 stutter | 这些状态不参与本模型 grant/proof/额度守卫；构造和接收快照由第5节单列 |

纯房间 Pause 被这里的运行超集抽象省略，本模型不证明暂停期间允许新领域动作；其安全守卫仍是原 Consent 与生产对应义务。使旧 proof 失效的 Restart 没有省略，也没有用普通 Pause 替代。Receipt 可读资格由既有原身份授权合同保证，本模型不证明撤销身份之后仍能读任意收据。

### 3.1 归纳的局部理由与边界

在 Fault=none 和合法入口下，GrantCurrent 的保持可按动作穷举：Init 无 grant；Accept 只加入 binding 等于当前签名且当前槽的 q；NewRequest 要求旧 grant 已不存在；Stop/Return 仅删 grant；ActorChange 只改变 a 的 epoch，并删掉所有依赖 a 的 grant，未删 q 的签名因屏蔽 a 而不变；Restart/Terminal 清空 grant；Apply/Take/Resume/Replay 不增加 grant。因此不能因无关控制变化失效，也不能把旧 proof 原地更新以恢复。

AtomicEffects 同样分解：Apply 只能使用当前 grant；所有可能删 appearance grant 的事件同一步清对应 disguise；私物停用保留 holder/acquired 并把仍持有的原取得切为 return_only；最后一物实际归还才把该执行模式结束。Take/Return/OwnerRepositions 的单一位置赋值及每 q/i 的集合额度提供逐物保持，跨用途动作不能写另一侧效果。

这是一份可审查的逐动作归纳论证，**未执行 TLAPS，也未机械证明源代码 refinement**。TLC 对启用的具体不变量在声明有限图内检查；ControlFrames 的机器监视目标具体是“误删无关 grant/刷新 proof”，完整字段 frame 另外由上表赋值核对。共享图若未穷尽，不能用这里的说明改写其真实结果。对无界请求、无限控制变化与生产事务仍不作结论。

## 4. 私物快照的合法生成域与真实混合轨迹

`ReturnSnapshotOperators` 是纯参数化构造器。合法输入域要求：有限两物和四请求的字段全定义；每个实际 held 物有 private 原取得 q；holder 等于该 q 的 requester；该 q 有实际 accepted 历史且 i∈taken[q]；当前 grant 满足 GrantCurrent；slot/taken/completed 指向原请求域。前两项由状态类型及 AcquisitionEvidence 表达，当前许可由 GrantCurrent 表达。取得版本用不可变 token 表示；其映射是“实际取得时已记录的版本”，不读取当前 lifecycle。Owner 固定为真实 C，origin 为该物内容登记值。

`ReturnSnapshotCut` 从相同 Init 使用原始 Accept/Take/Stop/NewRequest/Return/OwnerRepositions/Replay 动作。该子轨迹是共享模型权威动作的子行为；views/revisions/ownerVisible 的变化对权威投影作 stutter。它确实可以生成：Accept(old private)→Take(parcel,p1)→Stop(old)→NewRequest(private)→Accept(new private)→Take(letter,p2)。在后态，p1 的 parcel 原取得仍为旧 q、mode=return_only，p2 的 letter 为新 q、mode=delivery_pending。反置见证的 rc12 是实际可达证据，不是手填七个后态，也不是完整 Authority×UI 穷尽。

合法参数包括每观察者两个 view、每物两个当前 revision、两种 owner 可见性。ownerRef 在不可见时映射 wire 的 null；为 TLC 同形比较，模型用 tagged NullOwnerRef。owner 可见性布尔可任意切换，只是接口安全域，不附加“本人终会可见”的活性公平性。几何可见/近距真实性、opaque 引用验证仍在模型外。

逐项构造合同如下：

| 输出/性质 | 来源及保持理由 |
| --- | --- |
| 完整 privateReturns | 对 `{i: holder[i]=observer 且有实际取得}` 逐件构造；不查 current slot 或最近历史。每行 item 唯一，最多两行 |
| 按观察者过滤 | holder/acquired 只含自己的物；当前 request/额度只含该 requester 的当前请求；返还行不移交给新 requester |
| 原取得与版本 | context 是(q,i,本次取得)，originalRequest/acceptedVersion/sourceLifecycleVersion 都由该原取得映射；同请求每物一次使该 token 唯一 |
| mode | 对该原取得请求检查当前 grant；合法域的 GrantCurrent 保证不是陈旧许可 |
| 当前引用 | itemRef 由当前 observer/view/itemRevision 构造；ownerRef 只在当前可见时构造，否则 null |
| 安全目标 | 真实 C 的可见引用或该物登记原处；没有第三人或公共领回目标；origin 不自动计 delivered |
| 完整观察元组 | slot、active、holder、acquired、taken、completed、returns 一并保留；same-slot/active 下的物件变化仍形成新值 |

这些是对合法输入域的代数构造关系，并有定向负控辨识相反实现；不是已经对生产 DTO 序列化做机械检查。Cut 的正常全图结果与其见证分别报告。只有“某个共享动作维持上述合法域”的明确局部保持关系，才能把它的后态作为构造器输入；这里不声称把旧七后态模型提升成完整权威组合。

## 5. 完整 payload 到传输组件的条件映射

`ObserverSnapshotTransport` 接收已完整、按 observer 过滤的 snapshot。把每个合法实例映射成带 observer/view/seq 的不可分割值；算法不查看 payload 内部字段，正常 Deliver 只判断 envelope 的接收者、当前 view、非回退 seq，然后整体赋值。因只使用相等与整体赋值，可用 injective token 保留“收到哪个完整快照”的关系。内部 body 内容没有由 token 的存在自动证明。

接口承担者和后置条件：

1. 权威事务产生 holder/acquired/逐物状态及停权一致的后态；本层根据 SharedControlEffects 的具体动作与生成域论证它的抽象版本，生产事务尚需对应。
2. constructor 对某一一致后态生成上述完整观察元组，并按观察者过滤。取得原版本永久保留，当前引用按新 view 重建。
3. 发送方每次相关变化（含同 slot/active 下取还、逐物完成、当前引用变化）生成新 seq 或新 view；同一 observer/view/seq 永远指向同一完整 payload。模型的 ChangeWorld 每次都发完整新值。miss-same-slot 负控故意破坏此条件。
4. 接收方按当前 observer/view 与非回退 seq 接收并整体替换；旧 Accepted 只改原动作历史，不能写 snapshot。生产连续 seq/缺口重同步算法未在这里重新建模；它必须满足这个接口后置条件。

若 body 在两个 seq 恰好相等，注入标签仍可不同：模型不按 body 相等改变接收行为，权利关系只依赖最后被接受的 envelope 和其整体值。这个更细标签不宣称每次世界变化一定产生不同业务字段；不会借此跳过同 slot 的实际变化。

有限边界为两 observer、每人两 view、seq 0..2、所有已发消息的任意延迟/重复/重排、旧 Accepted 任意插入。安全不变量和 EventuallyCurrent 分开；后者要求世界最终有限稳定且每 observer 的 DeliverLatest 弱公平。无网络天然公平、无 NPC 合作、无持有人必返还假设。旧 Accepted 持续回写的时间负控允许它无限干扰，用真实 rc13 证明活性条件有辨识力。

该传输实例只有固定房间/session；跨 session/generation 隔离沿既有外层协议作为输入前提，没有在此新增独立代际计数。ViewBound 检查的是“接纳消息必须来自当前 view”，不是“NewView 后尚未收到新快照的缓存立刻清空”；本模型可暂时保留上一个显示值，最终新鲜度另由 EventuallyCurrent 保证。生产按钮可用性、旧引用提交拒绝和连续 seq 缺口恢复仍须映射实际协议，不能从这个组件 PASS 代填。

## 6. Recovery 原模型复用与真正时间反例

`PersonalRecovery.tla` 与原包字节相同，SHA256 `a986e81b2dfb6e366181b5892acfe0b0d399e006ad75f99d406e4bc826445b07`。正常15,984状态的活性结果保留原来源，不改绑为新跑。补充配置只把原 consume-all 故障配上原 LiveSpec/BothPurposesProgress，去掉会先截断的 PendingPurposesPreserved；TypeOK、SingleUnsettled、OriginalIdentityStable、ReceiptStable、EffectAtMostOnce、CapacitySufficient 仍启用。

公平性仍为原有限故障、内部提交/恢复/通知/Resume 弱公平。丢掉另一 purpose 的 pending 后，没有相应 Reserve 持续 enabled；弱公平不会凭空创造新需求。因此真正的 rc13 指向“在这些公平条件仍满足时，两用途都完成”失效。它不证明用户或环境必给新 task，也不容许 Unknown 尚未原身份收束就发新语义。新 task 来自当前合法领域状态仍是 Terms/Consent/生产恢复接线的组合前提。

## 7. 固定 IC 的只读对应（非验收）

只读对象为 `68d2ccb26237c2deb9640b0f2014600929d3feea`，tree `8f44905939a2cf083ff08196b957cc19064cee64`。`game/gaolao-personal.mjs` 的 personalBindingCurrent / createProposal / respondPersonal 提供 subject/requester/可选 performer epoch、proposal binding→accepted proof 的对应；stopPersonalForEvent 按 personalBindingCurrent 选择失效请求，stopRequest 处理 return_only；changePersonalItem 保存真实私物取得与 sourceLifecycleVersion；projectPersonal 按真实持有人派生返还上下文并在不可见时给 ownerRef=null。

这些只用于防止模型误解释原取得版本或选择性依赖，未执行业务检查、未核完整调用事务、未声明真实代码满足所有模型 guard/原子性/seq 后置条件。`implementation_status=NOT_ASSESSED`。真正 FM、独立 review、真实 Socket/UI/持久恢复对应由 root 在固定候选上另行核定。
