# SP06 公开随行提议模型合同

对象为已冻结 `6b71dff96439553b336dd523b2126b7c51f6fa83`（tree `8ed5516ea77f1b299ac2482aa2b24cfa4bdd385e`），正式协议 `adv-protocol.md` §6（SHA256 `4a57faffdc8a532c8129e459b1540b930b414f33798d375388f68458ca829a27`）。旧模型 a67e844 的两次 60s 竞争检查保留 INCONCLUSIVE，同语义 180s 检查也已超时并保留原结果；不将下述分解结果冒充旧宽配置穷尽。

## 既定风险与检查族

| 既定风险 | 竞争族 public / mixed | 身份族 public / legacy | 必须保留的断言/见证 |
|---|---|---|---|
| 未参与旧许可的新领路者可提议、不读私有槽 | 两人分别读取公开参数，private slot 初值2，new私有数组为空 | public入口同样从自己的公开值准备 | PublicProposalAvailable、ConsentPrivate、NoNewLeaderWitness |
| new/new、legacy/new 相同基线至多一次效果，两提交顺序 | 两次独立读取、3次总提交、每人2个nonce；保留两个提交顺序 | 每个身份入口保持原版本守卫 | SingleBaselineCommit、VersionFenced、两竞争见证 |
| 提议/本人回应/撤回使旧revision过期；移动不使其过期 | 保留1次可信 respond 或 withdraw 与读/提交全部交错；保留1次 Move | 单一环境变化也可选 respond / withdraw / Move | RevisionAccounting、VersionFenced、NoMovementWitness |
| 已知原串 Receipt 在旧 view/epoch 下恢复；未知新nonce拒绝 | 保留提交后原串重放、确认丢失 | 一次环境变化可选 view、epoch、二者同时更新；首执和已知Receipt都覆盖 | ReceiptStable、AtMostOnce、ScopeAuthorized、旧控制/Unknown重放见证 |
| 同nonce异参/换owner/新nonce旧依据 | 提交成功/拒绝后重复；两参与者同nonce互不混用 | 同一捕获请求可由两个认证主体提交；原串或一个变参维度；2次总提交、每主体2个nonce | NonceDigestBound、ReceiptOwnerScoped、VersionFenced |
| 非法当前身份、权限或范围不得首执 | 竞争族固定其它环境合法，集中验证并发槽 | 一次环境变化选认证/成员失效、control失效、phase终止、近距/可见/门/在线leader/capability失效；请求变参含future base、foreign observer/view、假subject及非法目的地 | ScopeAuthorized，负控删除守卫必须raw12 |
| 新旧严格互斥，提议不代表本人接受 | 两分支真实版本各自保留 | both/missing 与原/已知nonce都覆盖 | SchemaExclusive、ProposalOnly |

13项正性质全部保留，15项负控逐一对应，6项可达见证保留。新增请求变参维度 `expected-version`（绑定完整并发依据）与 `invalid-destination`；它们此前没有动态取值覆盖，明确补入。竞争族不加入身份变参；身份族每条轨迹最多一个变参维度，明确不声称多种异参连续组合。

## 组合理由与独立审查边界

1. `backend/runtime.mjs::locked` 的 BEGIN、session行 FOR UPDATE、operation、持久化、COMMIT，使 `executeSpatial` 的规则/槽更新/公开revision/Receipt保存为同一串行提交点。竞争族保留读与提交分离，故不是把读也锁进事务；回复丢失在提交后，保留重试。
2. `backend/spatial-runtime.mjs::submitSpatial/executeSpatial` 先闭合解析、认证/会话访问，再查认证主体的原Receipt；相同digest在当前epoch/view及业务守卫之前返回，异文同nonce拒绝。对已知原串，所有内层控制/范围失效组合均不影响这条分支；对外层认证/访问失效，不能读取Receipt。身份族单独涵盖外层失效、内层view、epoch和二者同时失效，二者不混成同一种拒绝规则。
3. 对没有Receipt的首执，`executeSpatial` 与 `followProposal` 的守卫只会短路拒绝，不存在由“另一个守卫失败”重新打开执行的分支。作用域失效的组合因此对“产生新提议效果”单调：任一失败足以拒绝；多个失败只可能改变首先返回的错误码。模型不声称精确保持这些组合的首错误码。一次环境失效覆盖每个具体守卫与版本仍新鲜的危险情况，版本失效由竞争族及身份族语义变化独立覆盖；不能推及失败后重新恢复为合法或跨会话重新授权的多轮轨迹。
4. 身份族把 **全部环境变化合计限制为一次**：respond、withdraw、Move、view、epoch、view+epoch、一个范围/权限失效。竞争族保留一次语义变化及一次无语义运动。不会丢弃任何状态变量、使用 VIEW/CONSTRAINT/对称裁剪，也不声称与旧宽交叉状态空间相等。这里的组合充分性是有源码依据的工程论证，非refinement证明。

## 规模与停止规则

两个认证人类主体、一个真实本人、两个合法目的地、2 nonce/主体、单次公开捕获；竞争总3次提交，身份总2次提交。四正配置采用120s/2workers/1GB；负控和见证60s/1worker/512MB。正配置需 completed=true、raw0、13实际性质完全一致、队列0；负控/见证需预声明目标raw12。无公平性假设，不检查活性，实际GUI/PG与模型分别报告。若仍超时，保留范围与原结果先分析，不再机械加时。

## 性质与负对照

| 稳定风险 | 正性质 | 负对照 Fault / 首次预期违反 |
|---|---|---|
| 状态域完整 | TypeOK | type / 初态revision=-1 |
| 新领路者不需要旧私有版本 | PublicProposalAvailable | private-fallback / 合法新请求被错误CONSENT_STALE |
| 新旧版本分别精确围栏 | VersionFenced | skip-public-version、skip-legacy-version / 过期依据产生效果 |
| 语义推进、运动不推进公开版本 | RevisionAccounting | move-bump / 仅运动却提高公开版本 |
| 同一公开提交版本唯一 | SingleBaselineCommit | no-public-bump、no-legacy-bump / 两个提议使用同一publicRevisionBefore |
| 原操作一次效果 | AtMostOnce | reexecute-known / 同key重复产生效果 |
| 原串回原结果 | ReceiptStable | guard-before-receipt / 已知原串被较新的控制/视图守卫改变 |
| 异文同nonce不能改义 | NonceDigestBound | ignore-digest / 异文被错误当原Receipt |
| 认证主体隔离 | ReceiptOwnerScoped | global-receipt-key / 一主体得到另一主体Receipt |
| 当前权限/引用/范围 | ScopeAuthorized | skip-scope / 非法首执产生效果 |
| 闭合互斥新旧格式 | SchemaExclusive | open-schema / both或missing形态越过解析边界 |
| 仅当事方当前许可投影 | ConsentPrivate | leak-private / 非当事方得到当前私有记录 |
| 提议不等于本人同意 | ProposalOnly | auto-accept / 提议直接创建following |

负控在同一主模块通过 Fault 注入，正配置 Fault=none；每个负控只启用预声明的目标 invariant，须出现该目标实际 violated 与原始 raw12。六个 witness 用否定可达命题查找轨迹，raw12是预期**可达性证据**，不是产品失败：新领路者、公开/公开竞争、legacy/公开竞争、旧控制下原Receipt、Unknown后重放、Move后可用版本。

`SingleBaselineCommit` 记录实际提交前的公开版本，而不是固定捕获时的ghost值；`VersionFenced` 另核提交时请求依据正确。这样加入 expected-version 变参后，恰好匹配更新版本的合法新请求不会被误判成旧版本第二次成功。各性质目标没有删除。

## 状态归属与抽象

权威状态为公开revision、私有consentVersion、当前requester/leader/destination/planStatus、认证主体的epochs/views及Receipt。Capture和knownLegacy表示客户端实际持有的公开/自己已知私有信息。effects/audit只作可观测历史用于性质；clientResult可为Unknown，权威Receipt仍保留。SubjectChange是可信本人已获授权的既有入口；其授权本身不由本模型假定“玩家可代做”。

初值私有槽版本2/公开人物版本0只需两者彼此独立，准确暴露“私有数组空不等于版本0”的缺陷。整数仅有限抽象；真实revision是大整数十进制字符串。身份族每条轨迹只改变一个请求字段维度，原串始终可选；不等价于全JSON词法/语义摘要证明。Schema与真实Vue构造由代码及运行另证。

认证/会话访问失败发生在Receipt之前，旧view/epoch失败发生在已知Receipt之后；两类不能混同。多个首次guard失败对“新提议效果”单调拒绝，但不声称各错误码顺序等价，也不包括失效后多轮恢复为合法。没有公平性假设与活性结论。

## 审查、修订与旧结果

分解预声明已由独立审查者对源码与验收覆盖核对，认定只在本次窄量工程组合论证范围充分；它不是旧宽模型等价或refinement。旧宽输入3次TIMEOUT/raw143保留INCONCLUSIVE，模型prototype的None字符串/记录比较导致TOOL_ERROR也保留；之后改为统一缺席记录，未改协议目标。

旧输入在输入快照与摘要中保留；最终四正配置、15负控、6见证用同一最新模型重跑。实际状态、输入摘要、参数与原结果hash见 [verification-results.json](verification-results.json)，源码对应见 [MODEL_SOURCE_MAP.md](MODEL_SOURCE_MAP.md)。
