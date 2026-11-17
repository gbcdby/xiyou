# 仅 publisher 先行竞态中的 RPC 连续续读：设计 r1

状态：**DRAFT_FOR_INDEPENDENT_REVIEW / COMPLETE_DESIGN**。本稿由 worker-design 在 bb66dac 固定基线上只读形成；未采纳、未实现、未执行 TLC/PG/Socket/browser，也未写 GitHub。总控已通过 #66 comment6949508120 采纳上一轮调查事实并释放本阶段；该记录不是本方案的批准。

## 1. 对象与目标

候选为 `bb66dac423a7a306752a7474eabc95d7d4d9edb7`，tree `deccc2600f3703f4b158f9b7ef5505680c557f0e`，416源码hash。有效依据为原方向供给合同/`formal/adv001/direction-supply/SUPPLY_MAP.md`，共享授权读 `direction-supply-parallel/HANDOFF.md`，波次合同 `direction-supply-wave/{CONTRACT,HANDOFF}.md`；仓库工程、工作流与服务端权威约束不变。

本稿解决单一已观察浪费：**RPC排队时没有落后服务端sent，但其前置publisher先完成了真实push；原RPC随后重建、授权并ACK这段已经由同连接先行push发送的历史前缀，较新的W继续等它完成。**

诊断原件SHA `14fcaac94732522d8d516e0fe629d992430bd423d9bc5bce847bf92e932c9a08`，调查报告SHA `aa69bb63103e4081a76d60f263b2f4d771eb1fbf055e10b76a61ff7b256530d5`。RPC659入场cursor59=sent59，前置push632之后sent64；RPC读取同事务head73却按原ceiling重放59→64，W673等待102.554ms。新W/G实际入场并行已经成立，不能重新包装成旧G全程串行问题。

目标是减少这一竞态中无新前缀的完整重放，使原优先RPC本身承担下一次连续供给；**不承诺单次修改必然消除原78.6ms断粮**。该数值还含SQL响应等待、其它事务以及客户端工作。

## 2. 方案比较与选择

| 备选 | 等价性与收益依据 | 本轮决定 |
| --- | --- | --- |
| 继续优化clone/canonical/schema或历史投影 | 若保持全部公共语义可做内部优化，但本轮未细分CPU；不能把RPC14.970ms混合operation全当可省CPU，也不能消除已观察110.107ms的SQL提交→首row组合等待。 | 不作为本轮主方案；无新实测支持具体热点收益。 |
| 复用已发送完整Batch/免授权返回 | 不等价：同历史through64仍有当前syncFrontier73；projection的movementCommandHighWater取当前actor/命令源；token/access/view/claim必须重读，先前proof一次性。缓存可变DTO或先前权限均不可行。 | 排除。即使缓存不可变字节，新的权限/元数据仍须读，不是本轮最少机制。 |
| 把同步改为无session锁或缩短到新的MVCC授权切点 | 会改变固定授权头、写排斥、view/claim原子性和PS01–03；需要额外一致性/重试机制，不能称等价。 | 排除本轮。 |
| 所有旧cursor RPC改从sent续读 | 会破坏真正遗漏/拒收先前包后的历史修复；若前置是已超时被客户端忽略的ACK，更不能假定它已应用。 | 排除这一过宽规则。 |
| **只处理入队时与sent对齐、且前置活动任务是publisher的竞态** | 保留原一活动/一RPC/一publisher槽、RPC优先和完整授权事务；只改这个RPC的实际读取起点。先行push与后续ACK在同link FIFO交付，客户端仍整批连续应用。真正旧cursor和前置RPC继续原历史路径。 | **推荐；显式合同变化，先窄模型/独审，再实施。** |

推荐不新增缓存、全局调度器、优先级、协议DTO字段、定时器或队列。仅给现有lane item保留其已有的kind分类，并在RPC closure记录入场sent与前置publisher身份/资格；这些标量不是权限或客户端确认。

## 3. 准确规则（RRS-01）

记：

- `R`：严格解析的原SyncRequestV2.cursor；原请求始终保留，不伪造或覆盖。
- `V`：RPC入队时取得的当前view对象；有原session、scope、binding身份。
- `A`：入队同一同步turn从`cursor(V)`读取的真实已入队sent，可能为null。
- `P`：入队时该handle lane的active item。
- `S`：RPC按原优先级开始执行时，原`assertCurrent(handle,V)`成功后的真实sent。
- `Q`：完整原授权事务锁定的session头；它不是发送许可。

只在以下条件全部成立时可采用新增内部起点：

1. 仍是当前既有完整能力模式：direction开关、v2、direction与timed三能力；同一真实handle和当前V。
2. `P.kind === 'publisher'`，且该RPC被排在这个已活动publisher之后；不包含前置RPC。
3. `A !== null && R === A`。入场已经落后的`R < A`永远保持历史重放；入场申报未来游标`R > A`不提前拒绝也不取得新资格，仍按原执行时检查处理。
4. 前置publisher沿原read→send→proof自然完成，V未被换绑/退休，执行时`S > A`。证明失败会沿原retire→disconnect/closing，当前性检查拒绝RPC，不能转成续读。
5. 原RPC执行时的全部请求/当前绑定/权限守卫通过，且`R <= S <= Q`。新路径必须在原授权事务中再次核服务器给出的S确为当前V的真实sent，不能接受客户端、H或Q替代它。

若1–4不成立，沿用原请求及原throughSeqCeiling规则；如果条件成立后授权/SQL/发送失败，沿原错误返回，**不新增第二次隐式fallback读取或重试**。

### 授权事务内的行为（RRS-02）

新增仅服务器内部选项，拟名 `sentPrefixStart`。它不进入SyncRequestV2或任何wire DTO，不能与旧`throughSeqCeiling`同时指定。

`syncSpatial`必须先对**原R**完成现有检查：token/access、协议能力、当前installed view、持久binding、session/actor、原R不超过Q、原R不低于binding.createdAtSeq、ownedEpoch/activeConnection、终态/liveConnection等。不得把原请求先改成S再检查，否则可把原本非法的过早cursor洗成合法请求。

之后仅当内部选项合法、当前S与可信sent相等且current/scope/pending/closing守卫允许时，令有效读取起点`F=S`、上界仍为本事务Q。继续用**原完整提交边界算法**，从F计算256页预算/首完整事务回退、stateAt、current highWater、executedSelfTrail、完整BatchV2校验；最终`fromExclusive=F`。实际scene轨迹必须从F重新计算，不能先按R做Batch后裁片段或只改字段。

无此选项的`runtime.sync`和旧路径行为逐字义保留。新分支仍使用原非readOnly `buildTransaction`、prefix capture、FOR SHARE、persist/hook、独立COMMIT、OUTCOME_UNKNOWN和client.release；不缩短或绕过授权锁。

### 真实发送与前缀（RRS-03）

RPC继续占原active槽并先于待处理publisher执行。`sentBatch`/`sendChecked`/`enqueueSocketPacket`/`consumeQueuedPacket`不变：新ACK必须从此时可信S连续开始；完整真实packet、正常同步send返回、唯一证明和发送前后current守卫共同成立后，sent才可前进。原installed cursor不动。

同一link的先行push `(A,S]` 先入队，后续ACK `(S,T]` 后入队；**真实入队不等于已应用确认**。当前正常接收链同步应用合法push，后续ACK才可连续应用；若push未应用，ACK必须按现有规则拒绝推进，恢复边界见下文。不得把FIFO扩大为“客户端永不丢弃”。若Q=S，正常形成`from=S, through=S, events=[]`的授权空批；客户端已到S时按原duplicate规则处理，空ACK不倒退sent。

被排在该RPC之后的原W仍按原机会执行；若其target已被RPC真入队覆盖，它走既有covered分支，无需再次授权读取/发送。固定P、W有限选择和每handle一页、5人分组、G逐行COMMIT、draining/stop/settle全部不改。

### 为何S只能来自所捕获publisher：静态证明范围

基线`spatial-supply.mjs`的`sent`与`lanes`均是模块私有WeakMap。`drain`先把选中的等待槽清空，再令其成为唯一active；active未settle不启动第二项，随后仍优先取唯一rpc槽。新RPC必须在同一同步turn捕获准确的active item引用与A，然后入队，不能只根据后来一次`lane.active.kind`重推资格。publisher合并只修改等待中的`lane.publisher.work`，不能覆盖已被移出等待槽的P。故从RPC入场到其实际执行之间，不会另有RPC或publisher插入并写该V的sent。

当前全部写点仅两类：`sentBatch`在真实proof消费成功后写sent；`snapshot`只在`!sent.has(view)`时初始化。资格要求A非null，所以旁路snapshot不能推进这个已初始化V；控制/安装另一个view即使复用文本viewId，也因对象引用不等而被原current守卫拒绝。publisher单页工作至多成功调用一次`sentBatch`后返回；若RPC入场晚于这次写入，A已包含该值，P不会再次推进，`S>A`不成立。因此在当前生产写点和lane生命周期下，同一V的`S>A`只能来自入场所捕获P的真实push。这是**当前源码的静态论证**，不是新交错已实测；RRS-T01/T06必须验证。若以后出现第三个sent写点、可替换active work、同handle旁路发送或同V重置，资格证明失效，必须返回设计，不能只加kind判断继续使用。

### 客户端连续应用与失败恢复（不是应用ACK）

固定源码的合法数据链是同步的：`socket-link.ts`把`world.batch`直接交给listener；`direction-capability.ts`在当前serial/connected下同步转交；`SpatialSessionClient.#batch`先执行`SpatialView.applyBatch`，后通知显示订阅者。`SpatialView`在所有身份、区间和投影检查通过后才原子替换snapshot；ACK callback也先同步消费再resolve Promise。因此**未换link/view且合法push成功应用**时，客户端cursor先到S，再处理新ACK `(S,T]`。显示订阅者在snapshot已经接受后抛错不会把cursor退回R；本稿不把画面绘制完成当成应用完成。

失败时必须保留以下不同结果：

| 实际接收情况 | 既有consumer结果与恢复义务 |
| --- | --- |
| push严格校验或区间失败、当前view仍在R | `applyBatch`返回refetch且不推进；push入口调用sync，活动sync合并为一次`#syncDemand`。随后ACK若`from=S`而客户端仍R，也返回refetch，不能剪片段或越过S。ACK自身不创建递归需求；已有push需求在原请求settle后触发下一轮。下一请求R小于新的入场sent，因此**不再满足RRS资格**，沿原历史页恢复。需真实consumer回归，不能用服务端sent代替客户端cursor。 |
| push因旧link/旧view/generation失效被丢弃 | 旧ACK同样受serial、link、generation、revision和view检查限制；断线清空旧snapshot/需求，新连接重新安装授权快照。控制换view沿原安装链处理。不能把旧P的资格或sent迁移到新binding。 |
| push合法应用后显示通知抛错 | snapshot已原子到S；后续请求从已接受cursor读取，保留原“消费者异常不重放已接受批”语义。异常是否阻断传输继续派发需具体consumer回归，不能扩大为任意外部回调无影响。 |
| 当前RPC自己的ACK超时或未被应用 | 原服务器lane/SQL自然settle，不能假取消。若server已送到T而client仍S或R，下一请求在入场已经落后，走旧历史路径；若下一请求排在仍活动的旧RPC后，因前置kind是RPC也不能取得RRS资格。 |
| ACK.from与当前cursor不符且没有外部fresh需求 | 原`sync()`主动中止本轮，不自行循环；等待已有心跳、后续push需求、显式sync或重连。heartbeat/reconnect被关闭且再无需求时，本稿不承诺自动恢复或有限时延。 |

授权/历史语义的保证是**保留下一次合法旧cursor恢复能力**，不是保证任意坏包、永久丢弃或撤权后仍能恢复。原R必须通过原binding.createdAtSeq及当前授权界限；不前移installed cursor、不删除旧events/outbox、不新增历史保留水位、不缩短旧view可读范围，旧历史分页/stateAt/完整事务边界原样使用。若原view已失效或原授权不再允许，仍用原RESYNC/Forbidden与新快照流程，不能以恢复为由重放已撤销历史。

### 现有证据和未证明项

| 依据 | 已支持的范围 | 不能替代的验证 |
| --- | --- | --- |
| `spatial-supply.mjs`的lane/drain、sentBatch、snapshot三个静态路径 | 单active、RPC优先、同V sent写点与真实proof来源的上述论证。 | RRS新资格实际交错、同link新ACKfrom、错误/换绑/停止回归尚未执行。 |
| 同候选唯一DIAGNOSTIC：seq64 push native8126.6→source8133.7；旧59→64 ACK native8295.5；精确重演2236值无差异 | 此实际运行先应用push，随后重复旧ACK不重复产生source64；真实packet/proof/同binding链见原调查。 | 这是**旧ACK**路径，不是本提案 `(S,T]` 的实测，也不证明所有消费者异常。 |
| `frontend/tests/spatial-reply-order.test.mjs` 的 SUP-03真实Socket测试定义 | 真实loopback的ACK同步hook先于后续push及Promise续体，hook异常收束Promise。 | 定义主要测ACK→push，不能改称已测本次push→新ACK；本设计轮未运行它。 |
| `frontend/tests/spatial-inbound-order.test.mjs` 的 SUP-03系列、`spatial-sync-wakeup.test.mjs` 的 D66-CLIENT-03系列定义 | 原SpatialSession/SpatialView的同步消费、旧link/view守卫、接受后异常、fresh需求合并与不递归refetch可复用；其transport为受控fixture。 | 不是完整PG+真实Socket的新分支证明，本设计轮未执行。 |
| `backend/tests/spatial-supply-pg.test.mjs` 的 D66-SUP-01/02定义 | 已有真实PG+Socket工具和旧cursor/完整事务/安装下界/空deliver保护，可保留并执行。 | 原测试尚未包含新资格，不能把旧PASS改写为RRS-T01 PASS。 |

以上只有标注DIAGNOSTIC的历史原件是本设计引用的实际运行事实；测试定义是静态证据及后续可复用目标。所有本提案验证仍为NOT_RUN。

## 4. 条款替代范围

| 旧条款 | r1拟议替代（仅上述竞态） | 明确保留 |
| --- | --- | --- |
| SUPPLY_MAP `SentPrefix`：“旧cursor RPC仍跑原授权事务，仅内部throughSeqCeiling；重复完整区间可回” | 真正旧cursor仍原义；入场R=A且前置publisher推进后，可在原授权事务从可信S产生下一连续页。 | 可信sent、installed分离、完整区间、真实proof、非客户端游标授权。 |
| parallel `PS-04 OldCursorCeiling`、反例规格2 | 条件为历史路径时仍`through<=sent ceiling`；新增race路径的from必须等于同binding可信S，through不超过固定授权Q及原页边界。 | PS01–03读写锁/授权头/完整守卫；PS05–10供给/进度/关闭。 |
| wave `RG-08`“合法旧cursor仍重读且through不越ceiling” | 区分历史RPC和RRS资格RPC，二者都重读授权；后者只从S续读，不能发送`from=R, through>S`的部分重叠。 | 同owner/1G+1W/RPC优先/真实入队、所有停止和失败边界。 |
| 客户端正常假设 | ACK应用仍以**收到时当前snapshot cursor**与Batch.from连续性判断；该机制已有，不新增客户端放宽。 | 8页上限、首个有效frontier固定、serial/generation/revision/link撤权守卫。 |

这不是等价重构，也不把旧TLC的PASS自动改写为新方案PASS。只有条件分支被替代；入场已落后的历史修复能力仍是兼容承诺。

## 5. 状态、失败、兼容与关闭（RRS-04..09）

| 场景 | 必须行为 |
| --- | --- |
| 入场R<A，或没有active publisher | 原历史ceiling路径；即使后来S继续前进，也不能升级资格。 |
| 入场前置为RPC，包括超时ACK | 原路径。前一ACK可能被客户端超时回调忽略；后续旧cursor请求必须能重放修复，不能假定已应用。 |
| 前置publisher未推进、blocked或无proof | 未推进按原路径；proof失败/退休/closing按原当前性拒绝，不伪造资格。 |
| 请求R>A | 保留原“执行时”有效性检查；若前置合法推进后R已不大于S，可按原规则读；不能因本设计提前拒绝旧代码允许的排队情况。 |
| control/take/subscribe换V、scope fence提高、pending installation | 原assertCurrent/事务守卫拒绝旧资格与候选；不迁移到新V、不重新取入场A。 |
| token/access撤销、持久claim/epoch变化、terminal变化 | 全部原事务检查，错误语义不变；新start不能掩盖非法原R。 |
| head Q 小于S、恢复/新runtime/新link | 不能使用该选项；同runtime异常状态拒绝并走原恢复。新link单独安装基线，不继承A/P/V或旧sent。 |
| SQL/COMMIT错误或结果未知 | 保留原ROLLBACK/OUTCOME_UNKNOWN/release；没有有效候选就不发；不复制旧proof，不倒退已成功peer的sent。 |
| RPC客户端timeout/本地取消 | 原服务端工作不假取消、不释放占槽；自然settle。此RPC自己的晚ACK可能被忽略，下一次真正旧请求仍走原重放。 |
| server stop/连接关闭 | 已开始lane/SQL自然settle，发送守卫拒绝closing；publisher owner继续等已开始W/G；不加独立资源或stop回调。 |
| defaultOFF、legacy、direction-only、直接runtime.sync | 原路径，无新增内部选项；DTO、序列化、proof完整比较不变。 |
| 混合session | 本设计按**handle协商**限定：不合格peer和混合publisher fallback原路径不改；合格full-cap handle若满足RRS竞态才用新增规则。不能宣称混合房间每个full-cap RPC都字节不变。此范围须由独审明确接受。 |
| 第6handle、5+1组、已冻结W进入draining | 原wave调度不改；RPC推进仅让原covered检查更早成立，不能丢第6handle或提前结束owner。 |

只新增生命周期为一次RPC的标量/引用；不增加持久字段、cache预算、过期回收、后台线程或跨runtime状态。

## 6. 拟实施位置与自由度

| 文件/入口 | 拟议改动 | 不在本轮改动 |
| --- | --- | --- |
| `backend/spatial-supply.mjs::enqueue/sync` | item保留已有kind；RPC入场捕获A与active publisher资格；按原lane顺序执行，选择旧ceiling或新内部start。 | drain顺序、槽容量、publisher合并/两次binding尝试、sentBatch/proof/current。 |
| `backend/spatial-runtime.mjs::syncSpatial` | 对原request完成全部守卫后验证内部S；统一有效from供分页、stateAt/trail与Batch使用。 | 授权SQL、锁、256页、Q、highWater、DTO/schema及完整校验。 |
| `backend/runtime.mjs::sync` | 原internal透传已存在，预计无需改。若实现发现必须改须说明具体义务。 | publisher wave/G helper、缓存、控制优先、commit/释放。 |
| 后端真实PG/Socket测试与前端消费者定向测试 | 新竞态行为/反例，保留旧cursor测试；测试只用真实原adapter证据。 | 原normal、时长、速度/no-idle/diagonal/DOWN阈值、frontend业务。 |
| formal映射/小模型 | 经worker-tla独立增量后采用对应义务。 | 不重跑与本次状态无关的全部模型，也不把有限结果当完整证明。 |

实现应优先复用原syncSpatial分页构造段，避免复制一份授权守卫或两份投影逻辑；有效from是局部数据。不能用临时绝对路径import，不引入通用任务框架。

## 7. 最小模型增量，先验状态NOT_RUN

这是Read起点的**已建模状态转移变化**，需要有限增量验证，不是单纯源码align。

1. 在`direction-supply/supply/SpatialSupply.tla`给RPC job记录`admittedSent`及`predecessorKind`（或等价资格布尔）；Read只在当前V、R=A、前置publisher、当前sent>A时令from=sent，余下保留原requested/ceiling。该选择仍受真实proof后sent前进，lane与Enqueue容量不变。
2. 保留SentPrefix、InstalledSeparate、NoStaleAdvance、OrderedApplication、ExactlyOnce等原性质；新增“竞态ACK起点来自该当前binding真实sent、非H/head/client值”及“入场已旧/前置RPC不能取得资格”。
3. SharedRead里的OldCursorCeiling须按mode区分：history保留旧不变量；race结果from=可信S且through<=固定授权rowHead。建议小配置只补资格与两种起点，不扩大PG隔离抽象。
4. wave模型结构不变：RPC原本也能合法推进sent，W covered/settle/G最终重枚举已消费该水位。但须做映射复核，确保没有把新RPC推进当作W完成或绕过active；不默认整套wave重跑。
5. 必要负控：拿head/H当from；保留R却扩大through造成部分重叠；入场R<A仍升级；前置RPC仍升级；忽略换view/旧link/原R下界；伪proof或ACK Promise延迟导致错误应用。必须精确触发具名性质，不能仅“存在反例”。
6. 必要见证：先行push尚未交付时RPC已排队→push应用→新ACK连续应用→W已covered；真正旧cursor仍重放；换view旧资格丢弃；新link先前进后旧回调无效。补一条“先行push被consumer拒收→新ACKfrom不连续被拒绝→有fresh需求时下一旧cursor沿历史路径修复”的有限见证；不能把拒收建模成客户端游标已前进。最小规模优先1link/2～3工作/2～3前缀，换link/换view单独配置。
7. ACK超时忽略与consumer拒收在旧FIFO模型未必覆盖，worker-tla必须先核映射，不能假称已证明。最小增量只需在独立小配置表示delivery后不应用、ACK callback失效及一次合法fresh需求；无需求时允许等待，不断言无条件最终恢复。新增资格限定前置publisher降低依赖，同时用真实Socket/consumer回归验证历史修复。任意网络丢包/崩溃/性能liveness不扩大为本次证明。

TLA工作由独立worker核对具体最小配置、负控与映射；本作者不运行、不修改formal。模型通过也不能替代以下真实行为。

## 8. 可证伪验收与原门（均NOT_RUN）

| 编号 | 输入/交错及对象 | 成功/失败判据 |
| --- | --- | --- |
| RRS-T01 核心RED→GREEN | 真实PG+原Socket adapter。已提交headA后publisher完成授权读，门在COMMIT后函数返回/真实send前；RPC按R=原sent入队；再真实提交headB，放开先行push。 | 实际wire先push(R,S]、再ACK(S,T]，T覆盖B的一页；原baseline回ACK(R,S]应RED。完整DTO/真实proof/current sent与客户端原consumer均核；不能仅SQL形状/次数替代行为。 |
| RRS-T02 一次世界应用 | 原SpatialView/SocketLink同步consumer实际接收上述FIFO；故意把Promise消费延后作反例；另测push已接受但显示通知抛错。 | 每个有效前缀与轨迹只应用一次，ACK后新push连续；接受后异常不倒退cursor。新ACKfrom不匹配时必须refetch而非跳前缀。 |
| RRS-T03 真正旧cursor与拒收恢复 | 原D66-SUP-01/02 PG旧cursor用例不改；新增资格成立但先行push被消费者拒收、ACKfrom=S也不能应用，原fresh需求触发下一旧cursor请求。再测无外部需求时不自行递归。 | R<A仍返回原历史完整页，through<=原sent，下一合法历史批能够恢复；无外部需求时保留等待行为。不得改旧断言或伪造客户端cursor；不删除历史/前移installed。 |
| RRS-T04 前置RPC/timeout | 真实前置RPC原ACK在途，客户端timeout后排下一RPC，再放原工作自然settle。 | 下一项不得取得race资格；保历史恢复，旧工作占槽到settle，无伪cancel。 |
| RRS-T05 原请求非法 | R低于binding.createdAtSeq但服务器S合法；伪未来cursor；错误session/view/token/access/epoch。 | 内部start不能洗白R；原错误/不发送/不推进sent保持。未来cursor仍按原执行时规则，不提前缩限。 |
| RRS-T06 同binding和失效 | 前置publisher成功前/后换V、scope/pending/closing；读后新view；真实缺ACK/proof失败→retire→同步closing。 | 旧资格/候选不能发送或推进新binding；保持原pending防复活链。 |
| RRS-T07 分页与空批 | 新Q=S；以及Q距S超过256并含完整事务边界。 | 空ACK(S,S]安全；预算从S计算并保原事务边界算法/客户端8页固定frontier，不追无限新head。 |
| RRS-T08 W/G/停止 | 原W已等RPC，RPC真推进后W covered；相邻旧G仍在途；stop/error时另peer已开始。 | 不抢RPC、不并行同handle、不提前G/owner release；成功sent保留，所有started自然settle。复用原wave关闭/三peer用例。 |
| RRS-T09 兼容 | OFF/legacy/direction-only/直接runtime.sync，以及一个full-cap与一个不合格peer混合。 | 旧入口不产生内部start；仅合格handle满足竞态时改变from，混合publisher原分支不改。 |
| RRS-T10 未知提交/真实proof | 授权读COMMIT响应未知、send抛错/async/no ACK、proof复用、packet改写。 | 原错误与release、retire/Pending语义；不缓存或重用proof。 |

运行回归先按这些具体风险选择现有protocol/supply/parallel/wave/SocketLink/SpatialView消费者target，不要求无差别长suite。核心行为测试不得用降低原验收门槛获得GREEN。

最终实际收益仍由固定组合候选的原 **normal→late→five** 和官方CI给出；本稿不预测具体毫秒改善、不称normal已通过。若核心行为通过但原no-idle仍FAIL，应保留失败并按新原件说明剩余瓶颈，不能通过继续扩大本分支、改200ms/page256或前端跳段补救。

## 9. 收束与返回设计条件

本稿仅交付一个推荐方案及最小替代条款，等待需求/标准独立审查和模型增量。若实现需要取消RPC优先、额外读取、共享mutableDTO、移除session锁、绕token/view/claim、改变current/退场或新增协议字段，应停止该扩展并返回设计；不能作为实施自由度。

机器身份与影响清单见同目录`identity-and-impact.json`，精确输入/本稿SHA见`manifest.json`。正式Spec/formal/旧调查原件均未修改。
