# ADV-001 协议有限模型与交接

## 1. 结论与对象

本目录为 [#27](https://github.com/gbcdby/xiyou/issues/27) 的 `design` 交付候选，消费 [ADV-001 v0.2](https://github.com/gbcdby/xiyou/blob/2dc4fb4332860b60127e654b61bdae4925a5e61f/docs/specs/narrative-adventure.md)，技术合同见 [adv-protocol-v1](../../docs/specs/adv-protocol.md)。源码观察基线为 `60e68a83cac2bd5d45b410a64545730a2a1c3eb4`。

**当前10个正配置全部 `PASS_WITHIN_SCOPE`；25个声明不变量均有实际 `rc=12` 的缺陷负对照。** 共67项当前结果符合预声明判据：10个正配置、31个不变量负对照、1个活性负对照、21个可达见证、4个见证阻断对照。活性错误返回实际 `rc=13`，不是不变量负对照，未改写成12。另有2项真实 TLC 验证器突变，均被矩阵拒绝。

原候选 `edc8b82e00371b430de5803ae072f42c26fde849` 的独立需求/标准审查均为 **FAIL**。第二轮候选 `a46830f53dea128ddfd2ba145d9a0fbc48513ea5` 的需求轴 **PASS**、R-27-REQ-001 **VERIFIED**；标准轴已验证 R-ADV27-STD-001/002，但因新增 R-ADV27-STD-003 仍为 **FAIL**。本轮只修正因果见证与相关观测/证据，合同仍为 r2、文件与 a468 逐字一致；当前模型修订 r3 等待独立标准复审及需求轴增量适用性确认，作者不自行继承 PASS。本票未合并，未释放实现。

`implementation_status` 保持 `NOT_ASSESSED`。有限模型没有证明业务代码、数据库、几何、模型回复或完整章节正确，也没有把历史 VS-001 mock 结果作为本次证据。

## 2. 可复核证据

- [当前结果索引](results.json)：每项期望/实际状态、原始退出码、distinct states、预声明下限、结果文件摘要与原始证据内路径。
- 原始输入、日志和结果通过本次交接单独交付；结果索引使用相对于该证据集合的路径。公开仓库不包含私人存储链接或标识。
- [运行前判据](expectations.json)、六份模型清单、[配置生成器](build_manifests.py)、[矩阵执行器](run_matrix.py)及 [验证器反证脚本](verify_matrix_contract.py)。所有正式配置为 `Fault=none`；隔离负对照通过显式 `Fault` 参数改变声明的机制。

证据包含每次实际 `result.json/manifest.json/input/*.tla/*.cfg/tlc.log/messages.json`、矩阵输出和冻结时输入；原始输入与日志未重写。初次移动检查、第一轮46项、调度第二轮6项及各次修订均保留。工具 jar、状态队列、临时运行目录和业务数据不入版本库；日志按仓库约定外置，正式文档不依赖临时目录链接。

当前 Movement/Resources/Identity 对应 `matrix-01`，Scheduler 对应 `matrix-02`，Consent 对应 `matrix-04`，MovementCommands 对应 `matrix-07`。本轮未变的5个模型共47项复用原始 TLC 运行，按当前验证器重新核对实际检查清单、原始结果摘要及根模块/配置/清单/工具内容身份；此项是证据重审，不是新 TLC 运行。受影响的 MovementCommands 全20项真实重跑。工具在每次输入快照中保存整个 model 目录；无关根模块的快照可与当前版本不同，实际调用的根模块及标准模块依赖必须一致。

## 3. 规模、设置与正结果

固定官方工具为 v1.7.4 / TLC 2.19（2024-08-08），jar SHA-256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`；实际 Java 为 OpenJDK 21.0.13。全部使用普通 **BFS、1 worker、512 MiB heap、死锁检查开启**；没有 `CONSTRAINT/ACTION_CONSTRAINT/VIEW/SYMMETRY`、随机选择、真实时钟或 Java 覆写。每个正配置均有1个初态，完成时剩余队列为0；预算90秒。

| 模型/配置 | 有限范围 | distinct states | 预声明下限 | 活性 |
| --- | --- | ---: | ---: | --- |
| MovementCommands positive | 1唯一输入源、4条有序命令（甲/乙/停止/丙）、请求与ACK各丢失1次、1次原样重试、因果观测 | 161706 | 100 | NOT_CHECKED |
| MovementCommands positive-control | 3条命令、1次控制epoch变化及新源绑定，发出与处理独立 | 102602 | 100 | NOT_CHECKED |
| MovementCommands positive-recovery | 3条命令、分离Crash/Recover及新源绑定，持久Receipt | 104848 | 100 | NOT_CHECKED |
| Movement positive | 1移动者、2代路线、3位置、1掉线/重连、1重启、epoch0..3、2时间tick | 7353 | 100 | NOT_CHECKED |
| Consent positive | 翠兰/悟空2实体、2带路者、2安置点、2代提议、3回应身份、安置版本证据 | 2786 | 100 | NOT_CHECKED |
| Resources positive | 2真人、1公共物、1领回/重试/掉线/恢复与2人准备 | 496 | 100 | NOT_CHECKED |
| Resources positive-private | 同上，物品明确为私人 | 428 | 100 | NOT_CHECKED |
| Identity positive | 2观察者、2真身、1事件、8出口、1变身/获知/视图重建/引用操作 | 7456 | 100 | NOT_CHECKED |
| Scheduler positive-1 | 3持续合资格自主角色、预算1、成功/超时/非法三结果 | 188 | 30 | `NoStarvation` |
| Scheduler positive-2 | 同上，预算2 | 594 | 30 | `NoStarvation` |

调度活性只针对有限待办集合：所有三角色持续合资格，`Dispatch` 与每位角色 `SettleAny` 弱公平；请求的成功、超时或非法输出最终释放槽。永久不运行 worker、永久挂起且无超时、角色资格反复消失不在该活性保证中。有限模型的弱公平性是实现需满足的条件，不是生产调度的现成证据。

## 4. 性质、缺陷与见证

| 模型 | 声明不变量 | 隔离负对照 | 已观察的业务反例 |
| --- | --- | --- | --- |
| MovementCommands | `TypeOK` | type | 输入源序号超出模型有限域 |
| MovementCommands | `CommandOrder` | late / reset-water | 较旧命令迟到覆盖新目标；同epoch恢复清空围栏 |
| MovementCommands | `StopFence` | stop-no-fence | 未登记停止围栏，旧首次请求在停止后重新启动 |
| MovementCommands | `ReceiptStable` | replay | ACK未知时重放原命令产生第二效果 |
| MovementCommands | `EpochFence` | epoch | 旧控制epoch首次请求启动路线 |
| Movement | `TypeOK` | type | 写出位置域 |
| Movement | `ArrivalCurrent` | stale | 旧路线/旧epoch或已停止回调恢复 arrived |
| Movement | `ArrivalPhysical` | teleport | 仅受理路线，尚未到点就确认到达 |
| Movement | `PausedTimeStable` | paused-clock | 少于2人仍推进场景时间 |
| Consent | `TypeOK` | type | 代次超域 |
| Consent | `SettlementAuthorized` | impersonation / fake / stale | 父亲或他人代同意、借貌悟空替安置、旧计划回调完成新安排 |
| Consent | `SafetyDurable` | rollback | 安置后撤回同意抹消安全事实 |
| Resources | `TypeOK` | type | 物品版本超域 |
| Resources | `SingleOwner` | duplicate-owner | 领回后原持有人和领取者同时持有 |
| Resources | `EffectOnce` | repeat-effect | 相同已提交合作请求重放产生第二次效果 |
| Resources | `PreparedDurable` | unlock | 安装者断线撤销已锁定准备 |
| Resources | `CooperationAuthorized` | premature | 未满足两人有效就位就锁定 |
| Resources | `ReclaimAuthorized` | reclaim / private-reclaim | 宽限、在线/epoch、距离或公共性质不成立仍领回 |
| Identity | `TypeOK` | type | 视图代次超域 |
| Identity | `NoIdentityLeak` | raw-id / true-name | 未识破观察者收到内部ID或真名 |
| Identity | `EventAudienceFixed` | late-audience | 晚到者补听发生时无权听到的事件 |
| Identity | `HistoryAsObserved` | rewrite-history | 后来识破/变外观改写先前记录 |
| Identity | `ReferenceTargetStable` | by-name / stale-ref | 同名重定向到翠兰，或接受已失效/未签发代次引用 |
| Scheduler | `TypeOK` | type | 调度游标超域 |
| Scheduler | `BudgetRespected` | overbook | 超过并发预算仍派发 |

以上31次负对照均确实违反指定不变量，TLC 原始退出码为12；没有用语法错误、状态数或超时替代反例。Scheduler 的 `starve` 只持续调度唐僧，实际产生 `NoStarvation` 的循环反例，原始退出码13；它在唯一启用该时序性质的配置中出现 TLC 消息2116。

21项见证用目标场景的否定作为临时不变量，**预期产生反例，不是产品错误**：其中8项新增命令场景为双目标乱序、旧未知请求实际重试处理后拒绝、停止后拒绝旧首次请求、ACK丢失后返回原Receipt、停止后合法新目标、旧epoch拒绝、新epoch接受、重启保留原Receipt。另13项为移动成功、替换后成功、恢复后重新成功；本人安置、实际改约后第二版安置、安置后撤回仍安全；公共物领回、锁定后掉线/恢复、领回后重连；历史借貌称呼在获知后保留、晚到重放仍不补听、同貌对象引用仍指悟空；三角色均已调度。原始轨迹证明目标过程确实可达，不仅检查非零状态数。

## 5. 初次未达标、独立审查与修正

第一轮调度预算1正配置 TLC 完成，但只有12个 distinct states，低于运行前固定的30；矩阵按未达标记录，未称为整体通过。原模型把成功/超时/非法返回都压成同一个 Settle，无法分别观察三类收束。第二轮保留所有安全/活性性质、预算、下限和公平假设，增加 `outcomes` 及三种实际有意义的有限结果分支，得到188/594状态；不是下调下限或删除故障。

第一轮调度活性负对照实际返回13并产生循环反例，但矩阵脚本错误要求日志打印 `NoStarvation` 字面量。TLC 2.19 的2116消息只说时序性质违反；已修正矩阵核验为“唯一实际配置性质匹配 + 2116消息 + raw13”，并真实重跑。原判定失败及日志仍保留。

### R-27-REQ-001：同epoch旧首次请求覆盖新目标或停止

原 Movement 的 `generation` 在接收请求时递增，仅覆盖到达回调，不能约束 A先发但未提交、B后发先提交、A原样重试的命令乱序。合同现在要求输入源在发出时统一分配 `movementCommandSeq`，move/stop共用序列；首次请求必须超过持久 `movementCommandHighWater`，原Receipt重放不重新执行。控制变化和恢复先提高epoch，停止没有活动路线时也持久登记围栏。内部AI/代理必须在决策意图创建时预留同一序列，迟到结果不能重新编号。

新增 MovementCommands 独立区分 `Issue/Drop/Retry/Handle/Ack/LoseAck`，覆盖4条有序命令的任意投递顺序和控制/恢复交错。`NoUnknownRetryWitness` 记录重试**在B提交后发出且已经实际处理**，不允许只发出、丢弃或在B提交前发出重试就充当该场景见证；`matrix-03`/`matrix-05` 的早期修订保留，r2采用补强后完整重跑的 `matrix-06`。原 Movement 原样复用，范围明确为**通过命令围栏之后**的路线步进/到达/暂停检查；两模型未做组合 refinement。

### R-ADV27-STD-001：改约见证误用持久安全事实

原 `version=2 ∧ safe` 可由第一版安置后只提出第二版满足。独立反证禁止第二版 Confirm，原见证仍以510状态、raw12报“可达”，因此原证据不能支持“改约后安置”。修正为当前状态 `settled`、实际安置 `proof.planVersion=2`，并记录第一版本人已接受、尚在随行时确实改变领路人或目的地。

新见证真实轨迹为第一版目的地A、本人接受、第二版改为B、本人再次接受、实际Walk到B、第二版Confirm安置：1000状态、raw12。新增 `witness-control-block-replan` 仅允许第一版Confirm，完整2558状态、raw0且队列归零，找不到第二版安置见证。Consent 全10项重跑；旧9项保留为历史，不用改写日志替换失败。

### R-ADV27-STD-002：矩阵误接纳删减检查

原矩阵对正配置/见证只检查状态、退出码和规模，未把实际检查集合与独立判据相连。独立反证把 Movement 正配置和manifest一起缩为 `TypeOK`，期望仍为4个不变量，真实TLC以7353状态、raw0完成，原矩阵误报通过。

现在所有分类都必须逐一核对 `result.checks` 的实际配置和manifest声明中 invariant/property 集合，与 `expectations.json` 的目标完全一致；缺字段、重复项和替换项均拒绝。随后才核对状态、原退出码、规模、完成/剩余队列与指定反例。可达见证也必须在日志中实际违反其指定不变量。

`verify_matrix_contract.py` 在隔离副本中保留原判据，真实运行两种突变：正配置只留TypeOK仍为7353状态/raw0，另将到达见证换成“替换后到达”仍为145状态/raw12；新矩阵均退出1且 `meets_expectation=false`。原46项的实际清单重新核对无删减，但这不恢复被前两项发现否定的合同范围和见证含义。r2的64项均由同一新判定函数审计；本轮67项继续使用该函数，原始字节和运行身份保留。

### R-ADV27-STD-003：ACK丢失与重试的因果顺序

r2 的 `NoAckRetryWitness` 只合取最终 `lostAck/retried/replayed` 标记，实际轨迹为 `Issue → Handle → Retry → Handle去重 → LoseAck`。独立审查禁止丢ACK后的重试，旧见证仍以144状态/raw12成立，不能支持“ACK丢失后返回原Receipt”。原轨迹及第二轮标准 FAIL 保留。

本轮在 Retry 当步记录该动作 `lostBeforeRetry`、原Receipt和效果计数；之后同一次重试的 Handle 再记录实际返回值及计数是否保持。见证要求返回值等于 Retry 时的原Receipt和持久原记录，且效果仍为1。新真实轨迹为 `Issue → Handle accepted → LoseAck → Retry → Handle返回原Receipt`，155状态/raw12；禁止 `lostAck=c` 后发起 Retry 的对照完整141084状态/raw0、队列归零，见证不再出现。模型记录服务端产生的返回值，不据此声称客户端必然收到第二次ACK。

同时对8项新增见证逐一核对原始轨迹和写入条件。两处加强仍只增加观测：新目标必须在停止提交后发出，旧epoch拒绝必须在拒绝当步发现epoch不匹配。对应阻断对照分别禁止该时刻的发出/处理，完整102468/51694状态、raw0且队列归零。三个 `block-*` 只用于见证对照，正常 `Fault=none` 的发出、提交、水位、Receipt和控制转换规则未改变。

| 见证 | 本轮真实顺序及强制因果条件 | 处置 |
| --- | --- | --- |
| `NoOutOfOrderWitness` | 发出A/B → B提交 → A首次拒绝；同epoch、B仍活动与单调水位共同排除A在B前被拒 | 原条件保留，核对新轨迹 |
| `NoUnknownRetryWitness` | A丢失 → B提交 → Retry A → Handle A拒绝；Retry水位及实际处理标记都绑定该次重试 | 原条件保留，核对新轨迹 |
| `NoStopRejectWitness` | stop提交 → 旧A首次处理被拒；`rejectedAfterStop`只在拒绝当步记录已提交stop | 原条件保留，核对新轨迹 |
| `NoAckRetryWitness` | ACK丢失 → Retry → Handle原Receipt；记录Retry时已丢ACK和处理时返回值/效果 | 本轮修正并加阻断对照 |
| `NoNewAfterStopWitness` | stop提交 → Issue新目标 → Handle接受；原迹先发出全部4条，只证明处理顺序，现由`issuedAfterStop`固定发出时刻 | 本轮补强并加阻断对照 |
| `NoOldEpochRejectedWitness` | Issue旧请求 → ChangeControl → Handle拒绝；原最短轨迹正确，但原断言可拼接旧拒绝Receipt，现由`rejectedOldEpoch`固定拒绝时刻 | 本轮补强并加阻断对照 |
| `NoNewEpochAcceptedWitness` | ChangeControl → BindNewEpoch → Issue → Handle；当前epoch的已接受Receipt必先经绑定和发出，命令epoch不可重写 | 原条件保留，核对新轨迹 |
| `NoRestartPreservesReceiptWitness` | Handle接受epoch0命令 → Crash → Recover；宕机不能Handle，恢复后epoch1拒绝旧首次请求，因此原已接受记录必来自崩溃前 | 原条件保留，核对新轨迹 |

## 6. 给实现方的义务与回归规格

| 义务 | 已读基线的接入点 | 实施/验收必须补的证据 |
| --- | --- | --- |
| 事务与版本路由 | `backend/runtime.mjs` 的 locked/buildTransaction/persist，`protocol/schema.mjs` | v1/v2分派、严格原始解析、同Session效果/Receipt/事件/outbox原子、崩溃与结果未知 |
| 移动命令顺序 | 前端新空间输入流、`backend/decisions.mjs`、权威提交边界 | 发出时统一seq；A未知/B先提交/A重试、stop后旧首次请求、ACK丢失原Receipt、领域拒绝仍挡旧命令；AI晚到/fallback不得重新编号；崩溃后先持久增epoch |
| 移动与时间 | `game/rules.mjs` 的区域移动、旧 deadline | 新空间检查点/真实路径/门阻挡；交互与发言同一时点；暂停/恢复不补跑；仅围栏通过的命令进入路线层 |
| 全出口身份投影 | `game/projection.mjs`、`backend/recap.mjs`、`backend/ai/context.mjs` | 快照、增量、Receipt、owner、tool、AI context、重连、复盘和文本/资源包均无真实ID旁漏 |
| 同意与合作 | 旧规则的有限操作/物品入口 | 真主体、许可用途、版本、实际到达；借貌不改物权；全部在线真人确认；锁定准备持久 |
| 公共物领回 | `backend/runtime.mjs` 控制权、`game/rules.mjs` 物品转移 | 同一事务重验offline/grace/epoch/public/near/version/占用；重连与领回两种顺序 |
| NPC三类与真实依赖 | `backend/decisions.mjs`、`backend/ai/orchestrator.mjs`、内容schema | 第3自主角色公平获调度；无关走动不全量作废；预算1/2与故障下普通操作持续 |

这些是待实现的映射位置，**不是源码 refinement 或本次已运行测试**。每个反例应转成可控交错：先准备旧路线/同意/引用/领回请求，再使其依赖改变，最后投递旧结果，观察拒绝且没有第二世界效果。真实事务与网络检查由实现/验证票执行，本票没有写或运行业务测试。

本轮没有检查：任意数量/无限次请求；命令参数解析及领域拒绝仍消费水位的分支（MovementCommands 只取领域合法命令）；连续几何与寻路正确性；墙体/听闻分区计算；加密引用不可猜性；完整跨 Session 非干扰；任意文字字段编码；数据库隔离/崩溃细节；完整结束投票与GZ-E01/02/03的章节组合；真实模型质量/全部变体可解/真人趣味/正式视觉。序号分配的唯一可信输入源和原子持久化为假设，需实现验证。关键同意、身份、资源、移动子模型分别通过不自动推出它们组合正确，下游整体验收必须覆盖共享事务中的交错。

## 7. 复现与返回条件

从仓库根目录，使用符合工具摘要的已取得 jar：

```sh
python3 formal/adv001/build_manifests.py
python3 formal/adv001/run_matrix.py --jar /absolute/path/tla2tools.jar --out .agent-output/adv27/new-run --jobs 3
python3 formal/adv001/verify_matrix_contract.py --jar /absolute/path/tla2tools.jar --out .agent-output/adv27/new-validator-check
```

输出目录必须是新的；可用 `--model Movement` 等只重跑受影响模型。执行器固定检查清单、工具摘要、BFS和真实结果，`matrix-results.json` 保存逐项判据，不把预期负对照当失败，也不把意外正例反例当通过。复用仓库内 [固定执行器](../../.agents/skills/worker-tla/scripts/run_tlc.py) 与 [toolchain](../../.agents/skills/worker-tla/assets/toolchain.json)，不另复制一套通用工具。实际运行使用的执行器副本与仓库版本逐字节一致，SHA-256 为 `ca5811a8cae5d31961185b0ba53868f3ea885a1ee614150d873d61044ff18f5a`；原命令位置仍保留在原始结果中。

合同、原子步骤、持久状态、版本围栏、引用生命周期、本人同意来源、暂停条件或调度公平假设发生语义变化时，返回 #27 重评受影响模型与实现义务。未改变的根模型检查可按内容身份复用，但不得重标为新运行。达到本范围充分证据后停止扩大模型；独立审查、实现、真实运行与合并继续由外层交付负责。
