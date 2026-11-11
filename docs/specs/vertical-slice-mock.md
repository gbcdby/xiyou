# VS-001：模拟输入验收修订

## 1. 决定、版本与交付含义

**用户决定（2026-11-11，Asia/Shanghai）**：“全部mock，想办法完成验证吧，按流程走，验证完毕就可以提交PR并合并了。”本修订将本轮 VS-001 终点改为**模拟输入下完成验证并合并的可玩切片**。本文是设计及验收要求，不记录尚未执行的通过结论；有效提交由 [#2](https://github.com/gbcdby/xiyou/issues/2) 与关联 PR 固定。

- `acceptanceProfile = mock-20261111`。原设计基线为 `6c2a0b9f6d137ad5fbd41721659404333ad8e16d`；[主 Spec](vertical-slice.md)、[玩法](vertical-slice-gameplay.md)、[M0 协议](m0-protocol.md)和[验证计划](vertical-slice-verification.md)保留，原真人／实际模型条件归于 `full-real` 范围。
- 既有 `INT-AC-*`、`GP-AC-*`、`M0-AC-*`、`VER-*` 编号不更名、不删除。结果的主键是 **验收编号 + acceptanceProfile + 实际候选**；`mock-20261111` 的 PASS 不改写 `full-real` 的未执行项。
- 本轮用自动玩家、受控模型返回和受控外部故障替代人工输入、付费供应商与不可控环境。权限、领域规则、Validator、事务、事件回放、HTTP／Socket.IO 和浏览器消费者必须实际执行；不得预置 Accepted、替写终态或用手工 DTO 冒充整局。
- 真实模型质量、真人乐趣／理解难度、真实设备与公网部署在本 profile 中为 `NOT_REQUIRED`，其实际检查状态仍为 `NOT_RUN`。它们不再阻塞本轮产物释放、PR 或合并；不得由此对外声称已经实测。
- 本轮依然保留审查、可重复检查、源码身份及实际合并回读。没有新增部署目标，也不因此修改用户的其他项目或通用工作技能。

本轮可以报告“VS-001 模拟验证切片完成”；只有相应完整结果实际存在时才能报告该项 PASS。角色行为与授权复盘尚未实现的部分必须完成，不可用“模型已 mock”替代产品实现。

## 2. 模拟边界与启动

| 对象 | 本轮输入方式 | 必须实际运行的部分 |
| --- | --- | --- |
| 玩家 | 2／3／4／5 个独立自动身份；脚本经公开界面或正式传输接口操作 | 当前认证、角色绑定、职责组合、动作权限、Receipt 和授权投影 |
| 核心 NPC | 标明 `kind=controlled` 的确定性 provider，分别扮演唐僧与悟空 | 过滤上下文、Decision、Gateway 严格解析、异步调度、统一 Validator、事件和恢复 |
| 托管代理 | 受控异步意图，含故意迟到、超时、非法及越权输入 | 现有代理权限、epoch／generation、稳定 fallback、未知结果查收据 |
| 网络／供应商故障 | 扣留、丢弃、重复、重排真实载荷；控制 provider Promise 返回时序 | 正式客户端、服务端和持久化路径；不能改造回包为预期结果 |
| 时钟 | 默认真实时钟；针对期限边界可使用原 Runtime 的受控时钟 | 内容时限、30 秒 Grace、Decision 期限语义保持原值；分别记录真实和模拟时间 |

至少提供一个明确、可运行的 **mock 启动入口**，如独立 `npm run start:mock` 命令或等价显式配置。它启动权威服务并为新开局及恢复中的两个核心角色登记受控 provider，使用同一 `ModelGateway`／`AIOrchestrator`；不要求使用者通过测试私有 helper 才能看到 NPC 行为。启动日志、页面说明或可见环境说明应明确“模拟角色策略”。默认入口不隐式调用外部供应商，也不发现、读取或打印模型密钥。

启动层可读取可信角色配置来绑定 `CharacterId → 角色策略`，但不能把完整 content、世界状态、数据库、真人 token 或另一 NPC 的记忆传入 provider。策略配置只规定角色目标、合法工具偏好和行为版本，不携带本局隐藏事实或答案。

Mock 进程关闭须停止监听、计时器、在途模型任务和自身连接；重新启动不得重置持久预算或重复提交旧意图。部署、多实例调度和滚动升级不从这一入口推导为已验证。

## 3. #10：受控双角色行为

### 3.1 角色策略与事实来源

两位角色使用独立的 `providerId/modelId/policyVersion` 或等价可辨识策略配置；状态按 Session、角色隔离。provider 只消费本次 Gateway 已过滤的 `context.current`、`context.memory`、本次 Decision 和允许工具 schema。禁止直接查询数据库、导入 fixture、读取全量快照或依据测试场景编号选择正确结局。

| 角色 | 可执行的策略差异 | 必须观察到的结果 |
| --- | --- | --- |
| 唐僧 | 优先安全、核对来源和自愿协调；安全或许可尚未获合法确认时询问／拒绝通行，并给出可执行替代建议 | 一次有合法依据的拒绝或保留意见；随后合法证据／状态改变时调整公开方案；最终只在合法条件满足后移动 |
| 孙悟空 | 优先亲自检查可达现场、查找材料与提供核验证据；不接受仅凭口头宣称已经修复或任意定责 | 一次与唐僧不同的可观察方案；至少一次有目标依据的检查、询问、合法移动或证据展示；新证据改变其公开建议或后续工具选择 |

“确定性”只指同样的合法输入得到可重复输出，不能指一段与观察无关的固定通关剧本。未知对象不得通过硬编码全局 ID 绕过视野；可见出口、物件、目标及所需版本来自当前授权上下文。不能把同一来源的多个转述计作独立证据。

为减少机械重复，策略可利用自己的合法 Claim／Observation／Goal／Belief 判断已经说过或完成的动作，也可保存不含新世界知识的调度状态；持久知识的权威来源仍是现有 Memory。不能借 provider 的进程缓存保留原本不可访问的另一角色数据。

### 3.2 拒绝、计划与执行

- 提议、拒绝、接受条件和计划变化通过正常 `speak`／`make_claim` 产生实际 `ClaimRecorded`，按正常 public／directed 受众传播。可生成有来源的 `beliefUpdates`，但仍由既有 Validator 校验其 Observation 白名单。
- 可观察计划改变至少表现为新证据之后的公开／定向陈述变化及相应后续合法工具选择。受控验证另外在可信诊断记录中绑定输入 Observation、Decision、原意图摘要、Receipt 和事件范围，不能靠对白模板中的“我改变计划了”一句算通过。
- 陈述、信念、承诺与真实效果保持分离。说“会修复”不等于已修复，回答“愿意走”不等于已经抵达；终局仍读取实际修复、许可、材料消耗和两 NPC 的移动事件。
- NPC 不能替真人执行最终修复或授予通行许可。受限代理不能借核心 NPC 策略继承其权限；托管仍只用原安全工具集合。
- 实际角色策略不得包含测试故障开关；非法 JSON、越权、无响应和迟到样本由独立验证适配器构造。

### 3.3 最小双角色验收

1. 同一 Session 中，两角色取得不同合法知识和初始信念；对其完整输入检查没有另一方私有资料、真人私聊或另一 Session 的唯一标记。
2. 在 Running、有可推进目标且无新玩家输入的 60 秒观察窗口内，两者各提出或执行至少一项有目标依据的合法主动行为。记录时钟方式；空话、机械复读及无目的往返不计。
3. 取得一次角色分歧、一项有依据的拒绝与替代方案，以及合法传播新证据后的计划变化。结果必须关联真实 Claim、Receipt 和必要工具效果。
4. 用至少两组测试输入保留相同口头说法、改变真实授权证据；策略输出／行动随证据改变，且未见证据的一方不能提前知道。该样本可由合成 fixture 变体实现，provider 不能知道变体标签。
5. 在同一流水线中覆盖超时／非法输出、并行玩家可继续取得 Receipt、终局或交还后的旧输出被拒绝，以及原决定只收束一次。相关未改基础行为可引用适用的 #9 检查，但本轮双角色组合需实际运行。

通过的是 `mock-20261111` 下的角色策略、感知隔离与执行链，不是实际 LLM 的泛化、自然语言推理或人格表现。

## 4. #11：授权详情与因果复盘

### 4.1 已授权证据详情

证据卡直接展示现有 `Observation.category/statement/fields/source/subjectId`，字段标签和值保留其类型；对象名称只能从当前已有授权对象或该观察本身解析，未知时展示稳定引用，不读取完整 content 补齐秘密。Claim 保持“陈述”类别；来源引用或反复分享不自动增加独立来源数。

普通检查应能看到实际已获授权的结构化结果。共享副本的 `observerId` 表示**当前接收者**；没有独立授权依据时，不能把它标为最初发现者，也不能根据 `sourceSeq` 回查并暴露原私有观察者。

### 4.2 独立只读协议

现有 `AuthorizedProjection`／`AuthorizedSnapshot`／`WorldBatch` 使用严格对象校验。本轮不向这些既有 DTO 偷加字段，也不改变恢复游标或 reducer。新增独立只读接口：

`GET /api/sessions/:sessionId/recap?throughSeq=<DecimalString>[&beforeSeq=<PositiveDecimalString>]`

- 使用与房间只读接口相同的当前认证和成员资格检查；缺权限、撤权、跨局、Session 删除分别沿用现有错误语义，不能先查询历史内容再判断资格。
- 本轮只为 `Finished`／`Aborted` 的终态提供复盘。`throughSeq` 必须等于该局当前已提交 head；不相等返回 `RESYNC_REQUIRED`，非终态返回现有 `FORBIDDEN` 并说明当前阶段不可读取复盘。终态无新效果，故各页共享同一固定水位。
- `beforeSeq` 是上一页返回的游标，必须在 `1..throughSeq`；首请求省略。非法格式／未知查询参数返回 `INVALID_MESSAGE`。每页最多 100 条**已授权条目**，从新到旧排序；游标是本页最旧可见条目的序号，不提供隐藏记录计数。
- 实现可顺序读取已提交 `world_events` 并投影；这是只读派生结果，不新增 WorldEvent、Decision、Receipt 或 outbox，也不重跑模型／领域动作。

新增严格契约如下，字段名及范围是本修订的公开承诺；引用类型沿用 M0。

| DTO | 字段 |
| --- | --- |
| `AuthorizedRecap` | `schemaVersion: 1`；`type: "session.recap"`；`sessionId`；`actorId`（当前账号绑定角色）；`throughSeq: DecimalString`；`phase: "Finished" \| "Aborted"`；`entries: RecapEntry[]`（最多100）；`nextBeforeSeq: PositiveDecimalString \| null` |
| `RecapEntry` | `entryId: Id`（本局内稳定、不含UserId）；`eventSeq: PositiveDecimalString`；`serverTime: UtcTimestamp`；`category: "Observation" \| "Claim" \| "WorldFact"`；`kind: "observed" \| "received_evidence" \| "heard_claim" \| "received_claim" \| "said" \| "moved" \| "took" \| "transferred" \| "used" \| "updated" \| "finished" \| "aborted"`（类别及归属按下表）；`actorId: CharacterId \| null`；`text: string`（最多2000码点）；`fields: FactField[]`（最多32）；`references: RecapReference[]`（最多40，容纳原32条source及该记录/对象引用） |
| `RecapReference` | `kind: "observation" \| "claim" \| "character" \| "item" \| "target" \| "region" \| "source"`；`id: Id`。仅引用本条已授权 payload 或对应现有公开字段，不反向解析隐藏对象 |

`entryId` 由本局事件身份确定，可取 `R-` 加 `SHA-256(sessionId + ":" + eventSeq)`，以遵守既有Id的128字符上限；不得把内部 `principalId/actionId/decisionId` 拼入公开值。序号空隙属于原协议已公开的全局水位，不解释为隐藏事件类型或数量。所有字符串遵守既有严格 JSON／Unicode 契约，投影不得为了凑长度破坏标识或虚构内容；原statement/text按原文展示，分类标签由独立UI元素提供，不拼前缀导致超长。

### 4.3 历史受众与字段白名单

先检查调用者**当前**访问资格，再逐事件要求发生时的 `audience.humanCharacterIds` 包含当前角色；后来移入区域、终局或同房间身份不追授历史权限。再仅从以下白名单形成条目；既有事件的 payload 不整包直接转发。`ObservationRecorded` 先按 `payload.category` 判断陈述性质，再按 `source.kind` 判断接收方式；凡原 category 为 Claim，普通和分享副本都必须输出 `RecapEntry.category=Claim`，不能落入观察／证据分类。

| 事件 | `category / kind` | 可公开的信息与归属 |
| --- | --- | --- |
| `ObservationRecorded`，`category=Claim`且非分享 | `Claim / heard_claim` | 该授权陈述型观察的statement、fields、observation及既有subject/source引用；actorId为observerId，表示接收者“听到／获知陈述”，不是该接收者说过，更不是确认内容为真 |
| `ObservationRecorded`，`category=Claim`且`source.kind=evidence_share` | `Claim / received_claim` | 该分享副本的statement、fields及既有引用；actorId为接收者，文案明确“收到分享的陈述”。原Claim事件可能对接收者不可见，不依赖其存在来保留本条陈述，也不越权展开原事件 |
| `ObservationRecorded`，`category=WorldFact或Evidence`且非分享 | `Observation / observed` | 该授权观察的statement、fields、subject/source引用；actorId为该观察的observerId；表示其取得了该观察，不概括为全局“最先发现” |
| `ObservationRecorded`，`category=WorldFact或Evidence`且`source.kind=evidence_share` | `Observation / received_evidence` | 该副本的statement、fields及来源引用；actorId为接收者，文案明确“收到证据”。不输出原私有观察者，也不擅自推断分享者或最初发现者 |
| `ClaimRecorded` | `Claim / said` | speakerId、已授权text、claim引用；可以回顾公开／定向计划的原话，但不判定为实际belief、真实承诺状态或已履约 |
| `character.moved` | `WorldFact / moved` | 该已见证actor、from/to区域引用；不补上其此前未获授权的位置史 |
| `item.taken`、`item.transferred` | `WorldFact / took`、`WorldFact / transferred` | 原事件中已见证的物品与from/to角色／位置引用；来源不能扩成当前隐藏持有位置 |
| `item.used` | `WorldFact / used` | 原actor、物品、目标与operation、consumed事实；只有真实consumed=true才显示“已消耗” |
| `target.updated` | `WorldFact / updated` | 原事件已授权的目标和fields；actorId为null，不为补叙事而导出内部causedBy |
| `session.finished`、`session.aborted` | `WorldFact / finished`、`WorldFact / aborted` | 现有公开结局事实或终止原因；不将Aborted算自然结局 |

`BeliefUpdated`、`GoalUpdated`、`control.changed`、初始成员／认证载荷和其他未列事件不输出。不得传出 event.audience、UserId、token、connectionId、完整causedBy、Decision、ai_runs上下文、内部计划或另一角色信念。公开计划变化由用户有资格听到的实际 Claim 序列与已执行行动呈现；内部“为何如此判断”的完整链只留在可信诊断证据。

原来源观察或Claim若对当前角色不可见，`source`引用只按共享副本已有信息展示，不能跟随引用展开源事件。`heard_claim`／`received_claim` 的actorId始终是接收者，只有 `said` 的actorId表示speakerId；不得把接收者标成原发言者。subject/source引用仍按原payload含义展示，不猜测缺失发言者。相同源的多个共享副本必须保留共同出处，而非呈现成多个独立发现或多条独立证词。

### 4.4 页面与兼容

终局页保留现有聚合结局，增加“你有权查看的过程”列表，按“观察／收到证据”“陈述”“已发生的行动”明确分类。陈述组分别标“说过”（said）、“听到／获知陈述”（heard_claim）、“收到分享的陈述”（received_claim），并按上述actorId含义展示发言者或接收者；不得把Claim型观察放入观察或证据组。页面不得新增“真实信念”“承诺已履行”等由文本推断的标签。可以并列展示陈述与后续事实，让玩家看清口头方案和实际结果的区别。所有角色/用户文本按普通文本呈现，不用HTML解释陈述、字段或引用。

客户端只在已取得当前终态授权投影后，以该cursor请求复盘；多页始终使用同一throughSeq。账号、房间、视图代次或授权失效时清空并取消旧请求，迟到响应不得填回新视图。分页失败只影响复盘反馈，不改变世界或把缺页伪装成完整。旧服务器无新endpoint时显示复盘暂不可用，原结算仍可读；旧客户端忽略此新endpoint，原严格DTO不变。

服务端和浏览器必须覆盖：自己的直接观察、合法共享副本、公开／定向／私人Claim的不同受众、后来到场者、撤权与跨局查询、超过一页、稳定排序及同水位、空结果、未知参数、非法游标、失效旧响应、结束后不可操作。

陈述语义负例必须包括：A向C定向声称“通路已修好”，实际safe仍为false；C合法分享该Claim型观察给B，而B不具原ClaimRecorded受众资格。终态复盘中C得到 `Claim/heard_claim`、B得到 `Claim/received_claim`，对应actorId分别为接收者C/B，陈述内容保持原文；B仍看不到原ClaimRecorded和未授权源事件。不得删除Claim型观察后仅依靠 `ClaimRecorded` 兜底，不得把B标为原发言者，也不得生成任何“已修复”WorldFact。两人的页面均须明确标为陈述，并与实际未修复事实保持区分。

新接口的历史受众过滤属于受影响信息边界，须对照 #7 模型义务做源码映射和真实负向检查；若实现改变权限语义而非落实上述白名单，需回到设计／模型复评。

## 5. 本轮同候选验证矩阵

| 原编号 | `mock-20261111` 必须取得的结果 | 不得替代的部分 |
| --- | --- | --- |
| VER-01 / INT-AC-01 / M0-AC-01—12 | 机器契约、可读取固定模型、负对照与实施义务；实际源码对应及受影响边界检查 | Mock不能伪造TLC运行、有效输入、状态数或原始反例；#5原件不可用时另建明确的新候选并重新验证 |
| VER-02 / INT-AC-02 | 同一候选五个独立自动玩家连续操作至少900000ms真实单调时长；正常身份/角色绑定、同cursor逐人投影和持久回放一致，源摘要前后一致 | 不改称真人15分钟或跨设备公网结果；原时限和Grace不缩短 |
| VER-03 / INT-AC-03 | 对真实实现注入重复/乱序/丢包、撤权、重连、交还、未知Receipt及旧回调；同时旧AI迟到的联合轨迹必须取得一次合法效果 | 不以手写预期回包、关闭校验器或新动作ID代替重试 |
| VER-04 / INT-AC-04 | 受控provider经单AI完整生产链；合法、非法、超时、取消、Unknown、恢复；玩家不因未返回推理被阻塞 | 实际模型质量/供应商可用性为NOT_REQUIRED，不冒称已调用 |
| VER-05 / INT-AC-05 / GP-AC-04 | 本文§3双角色隔离、分歧、拒绝、主动行为及两组证据驱动计划变化样本；显式mock启动入口可运行 | 受控行为不能宣称实际LLM自主性或人格质量 |
| VER-06 / INT-AC-06 / GP-AC-01—07 | 2/3/4/5自动身份装配；2人、5人各至少一条完整操作链；组合样本覆盖查证通行、备用材料、原材料调查未齐、超时未解决四路径 | 不以直接写world/ending/Receipt或直接调用UI成功回调产生通关 |
| VER-07 / INT-AC-07 / GP-AC-08 | 同版本玩家动作→Receipt→WorldEvent→合法Observation→NPC Decision→校验动作→结局可追溯；新只读复盘按当前资格及历史受众过滤 | 普通玩家不得获得内部诊断日志；真实信念和履约状态不由Claim猜出 |
| VER-08 / INT-AC-01—07 | 固定同一集成commit/tree、Spec/profile、内容/reducer、角色策略和依赖；汇总当前实际结果、继承证据范围及未覆盖项，两轴审查通过 | 不把不同分支的绿色计数相加当整体通过 |

五人模拟局仍要求每个角色至少2次有效贡献、其中至少1次非聊天操作。每项贡献须指向实际下游使用的观察、合法传播引起的后续计划／行为、物品或规则效果；重复点击、无意义移动和预填信用清单不计。至少给出一条覆盖全部五职责的可执行轨迹，并在每120秒窗口检查仍存在与该角色职责有关的可理解合法选择。该检查证明脚本样本没有结构性空职责，不能证明真人不会无聊或理解困难。

五身份900秒与五人完整局可共用一轮，只有同候选、时长、贡献及自然终局条件全部满足才可复用；完整局提前结束时不得延迟结算凑时长，可另开长测局。期限专例可使用受控时钟加速，但单独标记，不能计入900秒真实运行。

同一候选不要求把全部历史TLC或未改路径机械重跑。每项继承证据须列原候选、原范围、实际源码/契约不变的比较，以及本轮新增代码是否影响假设；有变更或未知的范围保持未完成并补查。#8原网络技术结果可以作为历史背景，但不能改标为新集成候选的本轮900秒执行。

## 6. 产物释放、证据与合并

任务状态与依赖的唯一来源仍为[对应Issues](vertical-slice-tasks.md)。总控将本修订的实际有效提交及profile回写受影响票据，不另造一套工作状态。下表只定义本轮变更后的释放语义：

| Ticket／产物 | 本轮解除条件 |
| --- | --- |
| #8 / playable-network-shell | 固定外壳、恢复/权限检查、独立两轴及可读取的必要结果证据；新同候选网络验收可在#12汇总。旧原始trace外发阻塞不允许通过改格式或渠道绕过 |
| #9 / single-ai-runtime | 受控provider的完整合法感知／提交／失败恢复、原问题修复与两轴满足；真实模型条件改为本profile不要求，可供#10/#11消费 |
| #10 / dual-ai-behavior | §3受控双角色及显式可运行入口通过针对性实际检查与独立两轴；不是只有测试文件提供了脚本台词 |
| #11 / full-slice-candidate | 同一候选集成运行层、外壳、受控双AI、内容、证据详情和授权复盘，实际技术路径及独立审查通过 |
| #12 / 最终模拟验收 | §5矩阵在固定集成候选上完成，真实执行记录可复核；父#2以“模拟验证切片”结论收口，full-real未执行边界保留 |

#4—#7的协议、持久化、模型和权限要求不由mock替代；#5旧模型材料若不可恢复，新的模型与运行证据必须用新候选身份，不拼造旧材料或沿用旧状态数。未改变语义的#4/#6/#7历史检查可按适用范围继承。

本轮新取证只使用明确合成的账号／房间／内容和受控provider；发布源码身份、输入版本、命令、断言、计数、差异见证、必要截图及结果摘要。不得包含真实凭证、数据库连接配置、完整数据库目录或不必要的全量上下文。**原#5及#8被自动审批拒绝的具体payload不通过重编码、摘取或换通道重传。** 新结果是新的合成输入执行，不改写旧日志身份，也不将外发失败写成技术检查失败。

每次失败保留原candidate、输入与结果；修正后复验受影响范围，不能靠改期望或删除场景刷绿。只有必要检查、独立需求/标准审查和当前授权均满足才进入PR ready并实际合并；按依赖顺序处理base变化和冲突，合并后回读目标提交并做必要集成检查。用户本轮已授权验证后提交PR并合并，后续无需重复请求同范围合并许可。

## 7. 设计交接

本修订相对原基线改变了**本轮输入与体验门槛、交付终点**，并定义一个新增只读复盘协议；领域写权限、事务原子性、控制代次、去重、过滤游标及终局规则保持原契约。受影响记录为#2/#8/#9/#10/#11/#12及其PR；#5恢复/重建事实单独记录。

实施前必须固定本修订的实际提交，协议、服务端和前端的新recap消费者使用同一DTO定义。设计本文完成不表示实现、运行、审查或合并已完成；当前执行结果以实际候选的Issue/PR证据为准。
