# ADV-001 空间、身份与同意协议

## 0. 身份、范围与状态

| 项目 | 内容 |
| --- | --- |
| 合同标识 | `adv-protocol-v1`；唯一内容身份是保存本文件的提交 |
| 当前增量 | `r2`：修正独立需求审查 R-27-REQ-001，新增移动命令发出顺序围栏；原 `edc8b82` 与原运行证据保留。2026-11-13 的 SP06 兼容增量见第 6 节：新领路者使用合法可见人物版本提议，关联 [#33](https://github.com/gbcdby/xiyou/issues/33) / [#34](https://github.com/gbcdby/xiyou/issues/34)；其模型与运行验收单独核对 |
| 工作 | [#27](https://github.com/gbcdby/xiyou/issues/27)，父 [ADV-001 #23](https://github.com/gbcdby/xiyou/issues/23) |
| 输入 | [ADV-001 v0.2](https://github.com/gbcdby/xiyou/blob/2dc4fb4332860b60127e654b61bdae4925a5e61f/docs/specs/narrative-adventure.md)，代码基线 `60e68a83cac2bd5d45b410a64545730a2a1c3eb4` |
| 模式 | `design`；契约和有限模型，业务实现对应为 `NOT_ASSESSED` |
| 状态 | 待独立审查的实施合同候选；模型与实际运行状态读 [模型报告](../../formal/adv001/README.md)，不得从文档存在推断通过 |
| 授权 | 2026-11-12 用户要求以 auto 完成 #23，更新原设计轮只到 A0 的停点；产品保证不变 |

本文件固定跨 worker 的接口、状态归属与原子性；章节谜题和结局的唯一产品定义仍在主 Spec 及 CH02 详案。实施方可以选择寻路、插值和检查点频率，不能改变本合同的真实到达、身份权限、同意、重试与历史语义。

当前底座是 Node 的 Session 行锁事务、PostgreSQL 中的世界/事件/Receipt、Socket.IO 授权投影。观察依据：`backend/runtime.mjs` 的 `locked/buildTransaction/persist`，`backend/decisions.mjs`，`game/projection.mjs` 和 `protocol/schema.mjs`。本次只读取这些代码辅助设计，不声称它们已实现空间协议，也未执行业务测试。

## 1. 版本与唯一权威边界

### 1.1 两种会话协议

| 项目 | 旧会话 | ADV 新章节 |
| --- | --- | --- |
| 协议能力 | `region-v1`（既有含义） | `spatial-v2` |
| wire `schemaVersion` | `1` | `2` |
| 世界解释器 | 原内容快照与原 `reducerVersion` | 新内容快照与明确的新 `reducerVersion` |
| 位置 | `regionId` | `sceneId + position`，独立移动计划 |
| 对他人引用 | 旧合同按原范围保留 | 仅观察者作用域的 `entityRef`，禁止直接公开内部实体 ID |

创建新章节时把 `protocolCapability/chapterVersion/mapVersion/variantId/seed/reducerVersion` 持久化在会话中。先核验客户端能力，再允许绑定视图和提交动作；缺少 `spatial-v2` 返回 `UPGRADE_REQUIRED` 及所需能力，不能降级发送 v1 快照。旧客户端仍可进入旧章节。旧事件和回放保持原解释器，禁止给旧会话猜坐标或用新 reducer 重解释旧事件。

两个版本共用认证、单 Session 权威顺序与去重原则；实现可按版本分派解析器/规则/reducer/投影，不能新增绕开 Session 事务的浏览器事实库。v2 的原始输入继续严格拒绝重复键、未知字段、原型键、非精确整数和跨类型数据；不能先普通 `JSON.parse` 再声称检查了重复键。v1 唯一字段源和生成产物不得手改。

### 1.2 提交步骤

一次权威命令按以下次序执行：

1. 认证主体，取得 Session 写锁，读取当前版本/阶段/控制权。
2. 把本次权威时间推进到可提交的空间检查点；所有活跃路线按同一时点推进，碰到首个新障碍即停。
3. 按原去重键核对完整原请求摘要；相同 ID 不同内容拒绝，原样重试返回原结果的授权表示。
4. 无原 Receipt 时先核对当前控制 epoch 与真实控制来源；移动/停止命令同时按第3.1节检查发出顺序。再解析目标引用、可达/距离/遮挡、物权、目标语义版本、外观/同意/计划版本和阶段。
5. 原子提交效果、连续事件、Receipt、语义计划状态及 outbox；移动命令的持久顺序围栏与对应 Receipt 也不可拆开。检查失败不产生部分物品/同意/章节效果。
6. COMMIT 后才确认或发布。ACK 丢失视为结果未知，查询/重发原 `clientActionId`；不得换 ID 再执行。

步骤2产生的合法时间/位置事件可以先于随后被拒绝的交互，但必须在同一事务中持久化，并与拒绝 Receipt 的 `observedSeq` 一致；它们不是被拒绝交互的物品副作用。提交后取消只终止未完成计划，不能撤销已落地事实。模型调用和网络等待不得持有会话事务。

## 2. 共享字段与消息形状

本节是最小字段合同，实施票需从单一 schema 源生成公开类型与校验器；这里的形状不构成已实现校验。

| 类型/字段 | 约束 |
| --- | --- |
| `Seq / Revision / Epoch` | 无前导零的非负十进制字符串；比较使用数值语义，不经 JS `Number` |
| `Id` | 沿用现有最大128字符的严格标识；仅内部使用的 ID 不得出现在公开 DTO |
| `EntityRef` | 至少128位随机不透明标识；服务端保存绑定，不能从公开角色名/真实ID算出；不是权限凭证 |
| `Position` | `{x, y}`；均为 `0..1000000` 的整数地图单位，场景声明 `width/height/unitsPerPixel`；禁止 NaN/浮点/越界，平方距离上界仍为安全整数 |
| `Facing` | `N/NE/E/SE/S/SW/W/NW`；仅表现，不授予感知权限 |
| `PublicEnvelope` | `{schemaVersion:2, sessionId, viewId, actorRef, clientActionId, controlEpoch, baseSeq, action}`；主体/连接/受众/服务器时间不接受客户端填写 |
| `PlanRef` | 同一观察者可见的计划标识；内部计划ID与对象引用按同一投影规则处理 |
| `movementCommandSeq` | 正十进制字符串；同一 `(actorId, controlEpoch)` 下由唯一可信控制源在**发出命令时**严格递增，move与stop共用；不同于服务器处理后才产生的 planVersion |

`viewId` 与 `actorRef` 只帮助定位服务端绑定；请求不能凭其选择别人的身份。去重键仍是 `(sessionId, authenticatedPrincipalId, clientActionId)`。摘要覆盖原请求的版本、会话、视图/角色引用、epoch、baseSeq 和完整动作；旧请求重试不得改写这些字段。换视图后的原请求查询通过认证主体及动作 ID 读取原 Receipt，并按原授权语义返回，不能把旧引用重新当作新动作执行。

### 2.1 v2 动作的共同语言

| `kind` | 请求参数 | 成功仅意味着什么 |
| --- | --- | --- |
| `move_to` | `movementCommandSeq, sceneId, destination`；可选 `targetRef, anchorId` | 首次处理必须通过命令顺序围栏，再接纳路线；返回 `movementId/status:accepted`，不表示到达或交互成功 |
| `stop_move` | `movementCommandSeq` | 停止该控制源当前路线，并持久登记停止的顺序围栏；没有活动路线也有效，不要求客户端已收到未知请求的movementId；已提交到达不回退 |
| `inspect` | `targetRef` | 当前距离/权限通过后形成带来源观察 |
| `take_item / put_item / transfer_item` | `itemRef, expectedItemRevision`，放置点或 `recipientRef` | 原子改变唯一实际 owner/落地点；收件者按真身解析 |
| `interact` | `targetRef, operationId, expectedTargetRevision`；内容声明的有限参数 | 执行已登记的有限操作；参数不能包含任意事实/同意/到达旗标 |
| `share_evidence` | `evidenceRef, recipientRefs` | 合法证据送达；不把陈述升级为世界事实 |
| `speak / make_claim` | `text, channel, recipientRefs` | 生成发言/陈述；受众由发生时空间计算，队聊不进入 NPC 感知 |
| `propose_follow` | `subjectRef, destinationId, leaderRef, expectedTargetRevision`；兼容旧 `expectedConsentVersion`，两者只取其一 | 新提议使用当前可见人物版本，绑定真实本人、目的地、带路者与新计划版本；未获同意不开始跟随，详见第 6 节 |
| `respond_consent / withdraw_consent` | `consentId, expectedConsentVersion, response`（仅回应需要） | 只有该同意主体的可信执行身份可接受/拒绝/撤回；玩家请求不能代替翠兰回应 |
| `cooperate` | `operationId, operationVersion, phase:prepare/ready/cancel` | 登记当前本人就位；最后满足条件时同事务提交一次效果 |
| `reclaim_public_item` | `itemRef, holderRef, expectedItemRevision, expectedHolderEpoch` | 全部领回前提重验后转移一次；不扩展托管权限 |
| `request_end / confirm_end` | `proposalId, proposalVersion`，请求含 `scope:chapter/recruitment` | 仅当前在线真人各自提交有效确认，才能形成收束选择；沉默不算同意 |
| `wait` | 无 | 无新世界效果的合法候选 |

`respond_consent` 既可由已绑定的真人本人使用，也可由可信场景策略/自主角色提交自己拥有的同意；客户端不能构造场景策略 principal。高老庄的安置确认、破锁、借貌/解除、加入/撤回、最终入队采用已登记的有限 `operationId`，但仍各自校验执行者、来源与事实，不因“interact”通用入口而降低权限。

`advance_world`、权威路线步进/到达、场景策略响应与故障降级是**内部命令**；外部 schema 不接受内部 principal、任意位置提交或 `CuilanSafe=true`。所有内部命令也走相同权威提交边界，携带稳定去重身份和各自版本围栏。

### 2.2 输出与错误

`ReceiptV2` 包含 `schemaVersion/sessionId/clientActionId/status/code/observedSeq/actionEventRange/result`；`result` 只允许已经授权的 `movementId/planVersion/movementCommandSeq/status/entityRefs/observationRefs/message`。内部 `principalId`、真实 actor/owner、隐藏名称与未授权错误详情均不出网。`Accepted` 不等于后续计划成功；计划变化由独立已提交事件表达。

`SnapshotV2` 与 `BatchV2` 沿用 `viewId + snapshotSeq` / `(fromExclusive,throughSeq]` 完整区间语义；隐藏事件可为空批前进。场景投影至少有本人、当前合法可见实体/位置/外观、地图可见层、合法物品/交互、当前本人可见计划、观察、陈述、任务、阶段与可见终局。客户端整批验证后原子替换投影与游标；绘制预测状态不能回写事实。

错误使用现有错误意义并新增 `UPGRADE_REQUIRED / STALE_REFERENCE / STALE_MOVEMENT_COMMAND / PATH_UNREACHABLE / OUT_OF_RANGE / OCCLUDED / PLAN_REPLACED / CONSENT_REQUIRED / CONSENT_STALE / SESSION_PAUSED`。任何未知、其他观察者、其他会话或过期引用统一用 `STALE_REFERENCE` 或泛化 `TARGET_UNAVAILABLE`，不能借错误区分隐藏对象是否存在。只有本观察者本来有权知道的拒绝原因才可细化。

## 3. 持续移动、位置与事件时刻

`MovementPlan` 内部保存 `movementId/planVersion/movementCommandSeq/actorId/controlEpoch/sceneId/mapVersion/goal/path/acceptedAtSceneTime/status/reason/relatedOperation`。状态为 `accepted → moving → arrived`，或任一步到 `blocked/cancelled`；每个角色最多一个有效计划。通过命令顺序围栏的替换请求原子取消旧计划并登记新计划。到达记录绑定原计划、epoch、发出命令序号、目标、路径版本与实际位置。

### 3.1 发出顺序、未知结果与停止

同一 epoch 的较新目标/停止必须挡住较旧命令的**迟到首次处理**，不能只挡已经有计划的旧到达回调。`baseSeq` 表示客户端观察水位，不承担命令因果排序。

服务端按 `(sessionId, actorId, controlEpoch)` 持久保存 `movementCommandHighWater`，初始为 `0`。客户端在本地唯一控制流中先分配递增 `movementCommandSeq`，再发送；新点击和停止都用同一计数器。允许序号有间隙，不能等待缺失旧命令再执行新命令。网络重排、超时和原样重试不能重新编号。

事务内严格采用以下顺序：

1. 核验当前认证及原结果读取资格；先查原去重键。若原 Receipt 存在，摘要相同则返回历史结果，不重新执行、不降低 highWater；不同则 `ACTION_ID_REUSE`。
2. 没有 Receipt 的请求属于首次处理。核验当前控制源、epoch、结构和命令序号。`movementCommandSeq <= movementCommandHighWater` 一律拒绝为 `STALE_MOVEMENT_COMMAND`；不能因旧请求ID从未出现而放行。
3. 对当前控制源的较新、结构合法命令，持久把 highWater 提升到该序号，再检查目标/路径/场景等领域前提。成功时执行替换或停止；领域拒绝时仍保留此顺序围栏和拒绝 Receipt，防止随后到达的更旧未知命令启动。领域拒绝不取消原本已生效的路线，也不消费物品；只有成功停止/替换会取消它。
4. highWater、Receipt 和适用的路线/取消事件在同一 Session 事务提交。highWater 是与去重同级的受信操作元数据，可存独立命令账本；由已提交账本/Receipt恢复，不能只存在进程或浏览器内存，也不能伪装成客户端世界事实。取消当前路线后的 highWater 不得清零。

例：A=`move(1,甲)` 尚未提交且客户端结果未知，B=`move(2,乙)` 先提交，则 A 原样重试应记录拒绝，乙路线保持。若之后 S=`stop(3)` 提交，迟到 A/B 都不能启动；此后新的 C=`move(4,丙)` 可以正常开始。A 若早已实际提交但 ACK 丢失，则 A 的重试返回原 accepted Receipt，**仍不能重新应用 A** 或回滚 B/S。

命令序号只在该控制epoch内有序。控制权交还/重连建立新输入源时提升 epoch，旧epoch请求无论序号多大都不得首次执行；新epoch从0初始化其自己的highWater，旧epoch账本/Receipt保留历史。同一epoch的计数器状态不能随刷新重置；若输入端丢失计数器且存在未知请求，必须重新取得新epoch，不能仅从服务器已处理水位猜测未送达命令编号。单Session事务或具有等价条件写入的唯一权威负责序号围栏，不依赖Socket投递顺序。

AI/受限代理/场景策略也遵守同一围栏。序号由服务端在**创建有序意图/计划时**预留并绑定控制epoch、Decision generation及计划版本；模型不得自行提供/改写，迟到模型结果或重试不得在接收时再取一个新号。一次决策的导航与其合法fallback共用原预留顺序位置，并受决定状态/原去重身份约束；较新决策/停止已处理后，旧fallback不能复活。当前epoch只能有一个统一分配器，不能为model/fallback/场景导航各设互不相干计数器。

服务恢复必须在接受新的移动写入前，以持久控制变更提高相关角色epoch并使旧活动路线失效；新内部调度和新真人控制源均在恢复后的epoch分配序号。恢复期间没有恢复围栏前不接受写入。不得清空同epoch highWater 来“恢复”，也不能把恢复前未提交的旧请求/内部计划重新包装成新序号。

### 3.2 权威位置与到达

权威位置来自持久的空间检查点和服务端计算的路线步进。每次交互/发言/感知取同一事务、同一场景时点的位置；不能使用客户端渲染坐标或单独墙钟外推后不落日志。实现可保存路线加必要检查点，避免逐动画帧写库，但必须使重放得到当时的操作距离、受众和阻挡依据。路径几何算法、网格或导航网、100ms/其他步进频率属于实现选择；不得省略中途障碍和出口条件复验。

NPC“走到物件再拿取”拆为导航、权威到达、重新检查、实际拿取；一个意图包不能先受理移动再把同包后续拿取当作已到达。客户端点对象后排队操作也如此；停止、换目标或目标外观/状态变化使排队动作失效。到达不是所有权或同意的证明。

控制 epoch 变化、停止、路线替换、终局、服务恢复、目标失效都撤销相关活动计划；延迟到达回调只在当前 `movementId/planVersion/movementCommandSeq/epoch/mapVersion` 匹配、仍可推进、权威位置真实满足目标时生效。`arrived` 是服务端事实，不接受来自客户端/模型的“已到达”。命令发出顺序与到达回调版本是两道独立检查，后者不能替代前者。

## 4. 时钟、暂停与恢复

连接宽限、鉴权期限和模型超时使用非递减的服务端时间；剧情日程、风险窗口和移动模拟使用持久 `sceneTimeMs`。仅当 Session 处于 Running、至少两名真人有效在线且没有技术暂停时推进场景时间。暂停时保留已提交事实，停止新剧情、路线步进和合作提交，仍允许读取、控制恢复、取消及合法结束请求。

每次在线集合/暂停条件改变前，先结算此前合法的场景时间区间。服务启动/恢复把本机时间锚点重新设为当前，不把离线或进程宕机期间补算为游戏时间；从检查点恢复的位置不瞬移。恢复使旧活动路线转为取消/可重提状态，旧内部回调失效。重启后的 Receipt、公共物归属、锁定准备和已安置事实仍在。

少于两人时先等待；宽限结束后唯一剩余真人可按主 Spec 结束未完成章。两人及以上的主动结束/结束招徒都绑定 `onlineMembershipVersion`：在线真人集合变化使未完成确认轮失效，重新提出/确认；单人离开不能关闭仍有队友的会话。已完成的招徒结束选择仍不直接形成 GZ-E02，实际归还、分别和离庄义务继续有效。

## 5. 感知引用与全链路投影

### 5.1 引用生命周期

服务端内部真实实体 ID 永远稳定，外观是独立版本，真实翠兰和借貌悟空始终不同实体。`EntityRef` 绑定 `(sessionId, observerCharacterId, viewEpoch, entityId, appearanceEpoch)`；绑定是服务端私有记录，输出仅不透明 ref。引用有 `active/historical/retired` 状态，不接受客户端自行指定绑定。

- 同一活动视图内，同一已获知外观周期可重复使用 ref，支持导航与物品交接。
- 视图重建、角色/控制身份切换会增加 `viewEpoch`；旧 ref 不可用于新动作。原动作结果仍通过原去重键查询，历史条目保留原引用与当时称呼。
- 外观改变或授权撤回使依赖该外观的目标计划失效。亲眼见变化/合法获知者可收到有来源的身份关系更新；未见变化者不能通过 ref 的继承、原名、排序或角色标签推导关联。
- 当前不可见但已见过的对象可保留历史引用；它不能直接授予当前操作资格。重新出现时根据当前视图与合法身份知识重新签发/激活引用，不能把同名实体接到旧 ref。
- 一个 ref 永远只解析到一个真实实体；任何情况下禁止按显示名、外观名或昵称查找替代真身。同外貌的两个对象必须有不同 ref、位置和点击目标。

Ref 不可猜只降低枚举风险，真正权限仍在每次服务端解析时核对主体、会话、视图、外观、资格和动作。已知玩家的引用不能转发给八戒使用；合法转述/展示创建八戒自己的观察和引用。

### 5.2 一个投影边界，覆盖所有出口

所有离开权威内部域的数据都调用同一语义的 `projectForObserver(state, observer, atSeq, surface)`；函数名是合同称呼，实现可拆模块但不得绕过统一的规则和测试样本。

| 出口 | 必须投影的内容 |
| --- | --- |
| snapshot / batch / reconnect | 人物、位置、名字、角色/控制标签、物件 owner、目标、计划、任务与隐含关联 |
| Receipt / error | actor/changed targets、内部结果、错误原因、计划目标；原请求成功不能授权读全量内部记录 |
| Tool 请求/结果 | 工具可见目标列表、参数 enum、描述、解析错误与返回 owner；模型也只能使用自己的 ref |
| AI context / memory | 所有 observation/source/subject、目标依赖、Decision 元数据与记忆引用；内部 readVersions 不直接交给模型 |
| event / observation / claim | 发生时的外观称呼、真相/陈述类别、来源和合法受众；内部 cause/audience 不出网 |
| recap / historical fetch | 每个历史时点的已授权表示，不根据结局或后来识破把旧记录改成全知版本 |

普通 DTO 中不得包含能推回真身的 `characterId/entityId/realName/roles/controller/principalId` 或以真实ID组成的 observationId/目标键/资源revision键。本人控制字段只放在 self 且仅披露其本人有权知道的内容；旁观他人不可从 NPC 类型、持物者、日志或 debug 属性旁漏。公开地图/内容资源只含客户端可知层，不能把隐藏真相表打包后靠 UI 隐藏。

渲染文字也属于投影：不能把内部 JSON、错误对象、真实ID或全知谜题名字直接插入 message/label。固定事实字段采用各自出口的 allowlist，未获知的身份用当前合法称呼或未知，不靠任意字符串替换遮盖。

首章物件与目标的已采纳美术接线合同见 [GZ-OBJ-01 / v0.1](../../protocol/spatial-object-visual-v1.md)：经现有 capability 机制为已授权 Item/Target 增加可选 visualKey，世界状态仍复用 location/fixed/open。设计已通过独立需求/工程标准审查并采纳，本提交提供有界实现候选；正式资源目录仍为空。实施不得扩大投影、输出内部内容键或绕过旧严格 reader 的协商边界，运行与正式艺术结论分别依候选证据记录。

### 5.3 发生时受众与历史

对话和事件的受众按**事件发生时**权威位置、墙/门、频道与身份知识计算并持久化。队聊仅真人通道；后来靠近、后来重连、后来识破都不补发当时无权听到的内容。合法转述是带来源的新事件，不倒改旧受众。

受众可读表示需能按当时知识重建。建议在提交时保存每个合法观察者的安全事件视图或等价的不可变投影依据；仅保存真实actor再用当前知识重新渲染历史不满足合同。别名当时指向谁与后来何时获知身份是不同记录；授权身份揭示可以追加关系，不能修改旧台词。历史查询还须检查当前访问本局的资格。

## 6. 同意、随行与安置

同意记录 `{consentId, subjectId, purpose, scope, version, status, decidedBy, sourceSeq}` 与随行计划 `{followId, subjectId, leaderId, destinationId, routeVersion, planVersion, consentId, consentVersion, status}` 分开。`purpose` 至少区分随行、借貌、私物处理、会面与加入；一次许可不能变成其他用途的许可。

**SP06 新领路者入口（2026-11-13，#33 / #34）：** 未参与上一份同意的人不能读取其许可或路线，自己的 `consents/follows` 为空仍可合法提出新的安排。正常客户端只从自己当前可见人物 DTO 取得 `entityRef/resourceRevision`，发送 `expectedTargetRevision`；缺少该公开版本时不能退回私有同意版本 `0`。私有同意槽的版本、先前请求者、领路者、目的地与路线不新增到公开投影。

规则先保留原真实主体、请求者/本人/领路者近距无遮挡、真人在线、开门和合法目的地守卫，再比较当前人物 `resourceRevision`，旧值拒绝为 `STALE_PRECONDITION`。比较成功后在同一 Session 锁定事务内读取私有 follow 槽当前版本，创建新的 `proposed`，并增加本人人物 `resourceRevision`；原回应/撤回也增加这个版本。该版本原已公开，仅表示人物语义状态变化，不是私有同意版本；普通行走只推进 `spatialRevision`，其它语义变化可以保守地使准备中的提议过期。新入口不新增授权服务或同意能力，不改变 policyRoute 的资料、起点、路线或本人选择语义。

闭合 schema 同时保留旧 `expectedConsentVersion` 形态并执行其原精确同意版本守卫；不得同时提交两种版本或都不提交。新旧格式成功提议均在同一事务内增加人物版本，避免旧格式成功后旧公开参数仍可覆盖它。同一公开版本的并发提议至多一个提交。purpose 由动作种类固定，subject、requester、view、epoch、leader 与 destination 由原引用解析、认证主体及完整请求摘要共同绑定，不能把一次提议用于另一范围。

已保存原 Receipt 的相同 nonce 原串继续先恢复原结果；换视图或 epoch 不把已提交请求重新执行，同 nonce 改范围/依据仍为 `ACTION_ID_REUSE`。尚未处理的新 nonce 则须通过当前 epoch、view/ref 与当前版本守卫，不能将旧依据自动改成最新版本再提交。此兼容增量只处理随行提议；其它用途的许可、本人回应、隐私受众、一次效果与原历史合同不变。

同一主体最多一个有效随行计划。提议为 `proposed`，真实本人接受后为 `accepted/following`；合法到达后为 `arrived`，真实本人确认才 `settled`。`paused/withdrawn/cancelled` 分别保留原因。只有可信主体等于真实本人，或按内容声明为该本人的可信场景策略，才可写接受/撤回/确认；父亲、玩家、乔装悟空和客户端字段均不能代答。

改变领路者/目的地/用途增加计划/同意版本，旧许可不复用；原同意撤回同事务取消相关活动计划。领路者掉线、人数不足、路线阻断时在当前安全位置暂停，不擅自更换带路者；恢复由本人重新确认需要变化的安排。原样重试不能产生第二计划，旧到达绑定的计划/同意版本失效后不能安置。

`CuilanSafe` 只能由真实翠兰在当前许可的可自由离开安置点真实到达，并以本人可信策略确认后产生。确认时同时重验真实主体、当前有效同意/计划、目的地、路径/出口和会话阶段。**已提交安全事实为单调历史事实**；之后撤回会面/借貌、乔装暴露或招徒失败不能删除它。

唐僧接受与八戒自愿加入分别提交各自决定、各自版本，并由合法通知送达悟空。移动到出发点只是准备；最后 `join_party` 同事务重验两个仍有效的决定、真实三人到达、对应 GZ-E01 其余事实、Session 未结束，再生成入队与同行结果。撤回使未完成计划失效；降级可以沿仍有效安排导航，不能生成接受/加入决定。

### 6.1 借貌与私物生产本人回应的新增设计入口

2026-11-14 的 [GZ-SCENE-CUILAN-SELF-RESPONSE-001 / CS-R2](gaolao-scene-policy.md) §10～17 提出新内容限定的生产 scene_role 合同：安置后继续回应 appearance/private_items；本人的决定与请求者取消/替换、使用结束/失效分开；新请求采用公开人物 revision；本人有限私物清单不放宽远处 EntityRef；本人同意、借貌停用及私物归还分别有明确职责。R2 修订为本人实际收到期限意向后逐次选择，以及独立于当前请求槽的逐物归还上下文。该候选的严格 purpose basis、原子效果、请求恢复、兼容、验收和 TLA 输入以该文为唯一语义归属；R1 独立双轴 FAIL 历史及 R2 待复审状态亦见该文。

**状态为 PROPOSED，尚未采用/实现；本节不改变上文有效 follow/SP06 合同或现有机器 schema。** 新用途的接受/撤回仍只能来自真实本人；旧 follow grant 不跨用途。候选涉及 AP-01～05 与 scene 调度边界，不能用既有有限模型结论直接宣称新增行为已验证。

## 7. 合作、物权与离线领回

合作记录绑定 `operationId/version/targetRevision/participants/readyEpochs/anchors/phase`。prepare/ready 只登记真实已在线主体及其就位；最终提交同时重验所有必需真人、epoch、当前位置/距离、物件/目标版本、同意和场景可推进。只提交一次目标效果与消耗。任何未提交成员取消/掉线/离位使对应 ready 失效，不能用旧 ready 合成成功。

门撑/支架锁定后成为独立持久事实，不再以安装者持续在线为前提；断线或合作取消按钮不拆掉已锁支撑。版本与 Receipt 防止重试重复扣料或重复完成。任何随行/合作请求失败不丢物。

2026-11-13 已采纳物件接线的语义澄清：上段的取消不等于章内明确的撤收操作。当前高老庄规则允许门开放后的合法 `gz-release-support` 清除工具 lockedBy/fixed，位置保持不变；target.locked 与 cooperation.phase 仍记录合作曾提交。装配视觉须依据当前授权工具位置/fixed，不能让历史 locked 使已撤收工具重新出现。此处核对既有行为，不新增撤收前提或改变规则；具体来源与已采纳映射见 GZ-OBJ-01。

离线领回只允许章节在借出前登记并告知的 `publicBorrowable=true` 集合。事务内同时核对：同队在线 requester、holder 已超过宽限且处于受限托管、holder 当前 epoch、物品当前 owner/revision、双方同场景近距且无遮挡、没有已提交操作占用。重连先提交则领回失败；领回先提交则重连看到已转移真实归属。不得把“系统可领回”实现为代理 AI 自己赠送或跨地图召回。私人包裹/信件/钉耙/笔记不在集合，能力重新授权也不转移其私密记忆。

## 8. 三类 NPC、真实依赖与有限降级

内容 `actorKind` 为 `human / persistent_core / chapter_autonomous / scene_role`；高老庄唐僧/悟空为前两名持续核心，八戒为章内自主，翠兰/高太公/见证人为场景角色。自主集合从内容声明计算，不能用固定长度2或让八戒占真人席位。终局分别声明所需决定、到达人物和去向。

同一角色至多一个 Pending generation；推理出事务后才运行 Gateway。排队按轮转或等价公平队列服务全部合资格自主角色，预算允许并发1/2/3；每个推理均有有限超时并释放槽。以持续合资格、有限处理/超时、调度器继续运行作为防饥饿假设；不能从模型的公平假设推断生产系统已公平。

Decision 的可信依赖分为 `controlEpoch/generation`、目标语义 revision、相关外观/同意/计划版本和来源观察。内部依赖表不暴露给模型。无关行走只改变 `spatialRevision`，不能让所有角色意图不断过期；具体操作在最终提交重新检查距离与资格。关键目标移动使**相关操作**重验/重规划，不等于取消全部合法对白或已获知记忆。

新证据、目标变化、到达等语义事件触发计划判断；每帧移动不调用模型。模型只给 ProposedIntent，不能产生 WorldEvent 或直接写 Belief。超时/非法输出不阻塞普通行走和交互；降级限定于已授权、合法知情、稳定安全目标：等待、普通导航、前提全部满足的救援工具动作。收徒、加入、借貌、原谅、赔偿及他人同意禁止由故障策略新增。

## 9. 有限模型、实现义务与释放

模型入口为 [formal/adv001](../../formal/adv001/README.md)。安全性性质与工程交接使用稳定编号：

| 义务 | 模型性质 | 下游必须验证的真实行为 |
| --- | --- | --- |
| AP-01 移动围栏 | `CommandOrder`、`StopFence`、`ReceiptStable`、`EpochFence`；`ArrivalCurrent`、`ArrivalPhysical` | 迟到首次命令/未知重试不能覆盖较新目标或停止；换控/重启失效；旧回调不能到达；地图/几何与持久检查点 |
| AP-02 有效时间 | `PausedTimeStable` | 少于两人、宕机不补跑剧情；恢复锚点与记录一致 |
| AP-03 本人同意 | `SettlementAuthorized`、`SafetyDurable` | 真本人/版本/目的地/实际位置重验，安全事实不回滚 |
| AP-04 身份与历史 | `NoIdentityLeak`、`EventAudienceFixed`、`HistoryAsObserved`、`ReferenceTargetStable` | 八类出口、工具enum和文本字段实际扫描；身份引用不可跨观察者/同名重定向 |
| AP-05 物权与合作 | `SingleOwner`、`EffectOnce`、`PreparedDurable`、`ReclaimAuthorized` | 真实事务/Receipt、抢物/重试、离线领回与重连竞争、锁定后持续有效 |
| AP-06 三角色排队 | `NoStarvation`（有限活性） | 并发预算1/2、超时和无关运动下三名NPC都能获调度；真实模型因果另验 |
| AP-07 入队与终局 | 由同意/版本/一次效果机制约束；完整剧情终局不在本轮抽象模型中 | 两人有效决定、真实三人离场、全队确认与终局后不可改写 |

模型假设单 Session 原子权威提交、可靠保留已提交状态、有限回调/请求/代次；这些是实现义务。它不证明 PostgreSQL实现、解析器、任意规模、几何寻路、像素表现、自然语言语义、完整章节可解或跨章正确。各组件通过也不自动等于组合系统正确；共享提交边界、版本与投影集成仍须实际验证。

向下游释放需固定提交、相关正配置/逐性质负对照及独立需求/标准审查。只改变文档入口不重新宣称历史运行；修改原子性、引用生命周期、持续动作取消/恢复、同意主体、授权来源、时钟或调度假设须返回本票重评模型与合同。职责、模型/运行/真人证据分别报告，不降低主 Spec 任一验收。
