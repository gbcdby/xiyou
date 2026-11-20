# D66-DS2：两个原方向槽共享同向续发

## 身份与状态

- 稳定合同 ID：**D66-DS2**。修订 r2 仅澄清既有预算的实例范围。状态：**正式设计候选，尚未采纳、未释放生产实现**。
- 设计基线：`d51af2a120d7275b11eaabdd22f3c535ccbbf579`，树 `f8e6e0685e9c0ed1cde1ba253f6eb74ec395f3a9`。
- 权威 Spec 入口：`docs/specs/gaolao-client-experience.md` v0.5 的 §2.3、AC05、§4 方向协议模型义务；Ticket 唯一入口为 #66。本文是私有候选合同，不冒称已改共享 Spec 或获得采用。
- 本次终点是紧凑设计与验证义务。无生产 patch、无新采样或运行；后续由 root 保存采用决定、更新 Spec 并决定释放，非作者审查者与独立模型作者并行检查。

## 1. 依据与明确取舍

现 `DirectionIntent.#schedule` 在 `#pending.size < 2` 和会话准入外，还禁止同一 intent 有任何当前代次在途请求（`frontend/src/domain/direction-intent.ts:75–83`）。因此同向通常只有一条在途；第二槽只在改向时用上。原 Spec 要求有界输入、合并最新方向、stop 不等旧 move 和 Unknown 原身份，没有要求永久为改向预留第二槽，但旧实现及 `direction-intent.test.mjs:65–69` 的精确失 ACK 轨迹确实只有一条同向。

本轮原 normal 的同 scene 证据：E2 acceptedAt1758、E3 acceptedAt2009，间隔251ms，大于E2完整36单位／180速度的名义200ms；seq66保存11ms确认hold，下一段到页面又在完整尾后19ms。当前捕获没有E2 ACK／E3 emit切点，不能证明该guard是唯一根因，也不能保证去掉它会通过原自然门槛。证据已经独立冻结：`../d51-supply-analysis/report.md` SHA `30050dd4dccb89a87bede87f389632f261efd54cc55ad80855d7584546a3a289`；derived SHA `059b6acb1d03b06f6e80ac2ad73b8df676b49f30df013630de2f3743e45f571b`。

**拟议变化只有一项：空出的第二个原方向槽也允许同向在既有100ms节奏与token预算下使用。** 同向续发不再强制等上一条同向 ACK；原请求、序号和服务端权威解释保持。

代价必须公开：若E在0ms、100ms各发一条且都未决，110ms改为S时两槽已满，S只能等原槽真实释放。旧实现此时常有第二槽可抢先改向；新设计不承诺这种情况下立即改向。若首原请求到400ms仍未知，按原规则冻结并发一次stop，暂存S不能越过Unknown发出。无界ACK延迟下不承诺立即改向、持续运动或无idle；不能以第三方向槽、提前删除原请求、假Receipt或延长截止补偿。

## 2. 唯一变化与保持的状态归属

预期生产差量仅移除 `available` 中的同intent串行限制；`current` 仍用于原截止计算，其他时间、状态、回调和ledger逻辑不改。不得顺便改发送API、服务器、schema、供给模式或呈现队列。

| 责任 | 原状态／约束 | D66-DS2义务 |
| --- | --- | --- |
| DirectionIntent局部调度 | `#pending`原请求id、generation、intent、at；`#vector`只存一个最新意图 | 局部槽仍最多2；同向可占空槽；已发请求不被最新意图替换。旧代次entry仍占原局部槽直到原回调收束，回调只能删除自己的id。 |
| SpatialSessionClient全会话账本 | waiting／unknown原draft、原raw／id／movementCommandSeq、每draft400ms定时；`#hasDirectionCapacity`／`#pendingStop` | 跨地图、控制、连接／controller更换仍按原账本限制**最多2个未决原方向身份**；Unknown与未决stop继续禁止新方向。不能只依赖局部Map。原样retry不换ID或变成新方向，原Receipt查询的既有释放语义保持。 |
| 发送速率 | 每实例的`#nextAt`、上限2的token及每100ms补充1；当前可发送intent | 同一实例同一intent续发最早为上一实际方向发送后100ms；不同intent可沿原burst预算及时发送。ACK提早返回不提前同向续发，也不补发过去错过的tick。 |
| 停步与未知 | 独立stop槽、原generation冻结、原请求各自截止 | 两方向满仍可立即请求一个stop；stop seq大于此前全部已发方向。任何适用Unknown按原路径冻结，不复活旧持键；400ms从每条原请求原时刻算，第二次发送／改向／retry／绑定更换不延长旧截止。 |

时间预算按原DirectionIntent实例归属：clear不重置该实例的token／nextAt；新绑定需要新建实例时沿原构造初始化，不能据此声称跨实例的任意时间窗共享一个全局token桶。跨实例始终保持的是原账本容量、原请求截止与身份，不新增全局速率状态。

全会话“2”计算未决原请求身份，不将原样恢复重试与新的动作身份混淆，也不能用已经确定的Receipt但未返回的旧网络Promise永久占用新ledger资格；现有 CLIENT-02 契约和测试继续适用。

## 3. 发送、合并与结算规则

1. **准入。** 当前有效向量、未blocked、无当前stopPending；局部pending数量小于2，并且原会话canSend允许。取消唯一的“当前代次已有相同intent则禁止”条件。所有其它原guard保持。
2. **时间。** 原 `sendAt = max(同intent时nextAt，否则now, budgetAt)` 保持；`due = min(最早原请求deadline, sendAt)` 保持；tick先检查原400ms超期，再考虑发送。过去的100ms tick不排队补放，不按RAF／OS repeat增发，token补充与消耗公式原样。
3. **满槽。** 仅替换待发的最新vector／intent，不分配动作ID或序号，不积压一串方向。真实释放一个槽后读取当时最新意图；若该意图尚未发过，沿原新intent预算优先发送，不先补旧同向请求。无新意图则到原nextAt后续同向。
4. **结算。** 原成功／拒绝／异常Promise链保持。当前代次任意原请求Unknown仍冻结，**即使较新同向已经Accepted**；不让较新成功冲销旧不确定结果。Rejected仅在该回调仍为当前最新已发送id且intent仍当前时触发原halt；E1迟到Rejected不得误停已接受的E2或后续新方向。旧generation回调不改新意图，只按原机制释放自己的局部entry；会话ledger的Unknown与400ms仍独立生效。
5. **停止、绑定与恢复。** 全松、原取消／失焦／hidden／控制丢失路径保持；不新定义clear的外部效果。两方向满时stop仍独立、幂等地走原一次stop逻辑。旧Receipt／查询只收束原身份，不自行恢复Unknown前持键；待原账本允许后，仍需既有规则要求的新明确输入。跨绑定容量、原定时和stop序号不得重置或抹去。

## 4. 稳定验收与最小验证范围

以下均为 **NOT_RUN**，不把设计判断当测试或模型通过。实现前须有独立两轴设计核查；实现、模型及实际产品门槛各自绑定真实候选。

| ID | 必须可观察的断言／区分力 |
| --- | --- |
| DS2-01 同向共享 | 0ms发E1且未结算，100ms才可发E2；此前不发E2，200ms两槽仍满不发第三条。同一夹具在旧guard上必须因100ms仍仅1条而失败，确认检查确实区分新语义。 |
| DS2-02 原节奏预算 | 若E1于180ms收束且意图不变，下一同向不早于原nextAt200ms；0／100后改向只依原剩余token。保留30／60／120Hz等效trace及同一实例内任意区间 `N <= 2 + Δt/100` 预算断言；不变的重复按键不额外增发。 |
| DS2-03 满槽改向 | E1@0、E2@100未决，110ms改S，120ms再改W：释放前无第三条；首原槽释放后只发当时最新W，不补S/E，不伪造提前释放。旧拒绝晚到不误停新方向。此用例明确接受改向等待的代价。 |
| DS2-04 Unknown／乱序 | E2先Accepted、E1后Unknown或到原400ms，仍冻结并只请求一次stop；不能因E2成功取消E1截止。E1迟到Rejected、E2Accepted则不误halt；最新已发请求真正Rejected仍halt。边界同刻“原ACK先到／原deadline先到”各保留原真实先后语义。 |
| DS2-05 stop／跨绑定 | 两同向满槽时全松仍独立发送更高seq stop；迟到两ACK不复活已取消意图。保留原CLIENT-02的跨绑定全局容量、原400ms、原串retry／Receipt查询和新明确输入恢复断言，另覆盖两条同向占槽的同一边界。 |
| DS2-06 原兼容与产品 | 旧能力的ContinuousDirection、公开direction wire、36单位、180速度、100／400／50／200参数、严格校验、源接受顺序和完整确认history均不改。原方向／session针对回归、有限模型、非作者实现审查后，再由root判断新候选原normal→late→five的一次预算；原断言不因本设计调整。 |

最小预期改动为 `frontend/src/domain/direction-intent.ts`、`frontend/tests/direction-intent.test.mjs`、必要的 `frontend/tests/direction-session.test.mjs` 断言，以及 root 更新的 `docs/specs/gaolao-client-experience.md`。不改生产spatial-session账本；如果实现需要改变它的原容量、Deadline、Receipt或外部API，必须返回本设计，不扩大一行guard差量。

**有限TLA模型交接。** 独立模型作者负责新的小范围模型，覆盖两个原方向槽、独立stop、至少两代绑定、同／不同意图、原ID／序号和有限100／400时间、每实例token／nextAt；分别表示controller局部pending和跨绑定ledger，不能合并后丢失旧代次未决身份。环境允许Accepted／Rejected／Unknown／查询及回调乱序、改向／clear与同刻截止先后。安全性质为容量、token／最早续发、最新未发意图合并、stop覆盖、原截止不延长、Unknown冻结、旧回调不能复活或误停。有限进度只在适用回调最终收束且原调度获得执行的假设下声明；满槽无ACK分支必须允许400ms Unknown终止，而非假设成功。

须保留能打破容量、延期原截止／忽略旧Unknown、迟到回调复活或误halt等核心性质的必要负对照，并写源码映射、实际探索规模和未覆盖项。模型不证明实时延迟、几何、页面画帧、PG性能或自然无idle。此次不改变服务器事务／锁与授权协议，不要求重跑旧PG或无关TLC；实际模型／测试执行槽均归root。

## 5. 交接与返回设计条件

root采纳后才更新权威Spec并释放实现；独立审查者核合同与候选，模型作者核状态义务。取消同intent串行属于可观察调度变化，不能登记为纯字节等价优化。若要求“两旧同向已经占满后仍立即改向”、增加第三方向槽、缩短／延长400ms、提前丢弃未决原ID，或通过预测／buffer／跳history消除idle，均超出D66-DS2，须重新裁决。当前无其它待用户决定项；设计结论为范围内COMPLETE，采用、实施、验证与产品结果仍分别未发生。
