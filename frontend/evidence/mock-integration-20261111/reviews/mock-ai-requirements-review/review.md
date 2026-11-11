# #10 双 NPC 受控策略与显式入口：独立需求轴 R1

## 1. 结论与身份

**需求轴：FAIL。两个已确认阻断 finding 保持 OPEN：`R-vs001-p07-REQ-001`、`R-vs001-p07-REQ-002`。**

显式入口、合法上下文隔离、两组证据变化、基础恢复与双角色故障检查已取得正向证据；但当前策略会在合法协作过程中过早耗尽整局持久预算，并会复活已完成的旧路线请求。不能以新增测试 9/9 或作者全后端 99/99 抵消这两项实际反例。

| 字段 | 固定值 |
| --- | --- |
| work_id / Ticket | `vs001-p07` / `gbcdby/xiyou#10` |
| 审查者 | `/root/ai_requirements`，independent，requirements 轴 |
| HEAD / subject_id | `c2511f4a81d29502aed4c122cd701d3c3632d237` |
| Tree | `5c02c7273fbf02fe470e9ac77c95032ec0d9e455` |
| Base / merge base | `cf6f880f292d835f1644cd2e8f215fcf8aff512f` |
| 有效契约 | Spec `3690b481d1805f6a7b535584c80a8574c5103d97`；`mock-20261111` §2—3，关联 §5 / GP-AC-04 / INT-AC-05 |
| 实际环境 | Node `v24.22.1`；各探针独立真实 PostgreSQL；原 Gateway、Runtime、Validator 和持久化路径 |
| 标准轴 | 本审查未执行，未读取对侧报告 |

读取了固定候选全部 9 个变更文件，以及其实际消费者 `context`、`orchestrator`、`persistence`、`decisions`、`server`、projection/rules、固定内容和测试 helper。候选范围为 3 个新增运行模块、2 个新增测试、验证脚本、文档和 package 入口。

全部探针结束后的 `evidence-audit.json` 已核对 9 个变更文件及执行证据覆盖的 63 个生产输入匹配冻结摘要。随后撰写报告期间作者开始在同一目录修正测试，并新增了未跟踪的 `backend/tests/ai-mock-progress.test.mjs`；这些是未来修正材料，不在本次固定 c251 范围，未执行其新测试，也未把尚未冻结的修正纳入本结论。`review.json` 如实记录报告落盘时的文件比较，不将当前工作目录冒称为 c251 的整份干净工作树。本审查没有修改生产、业务测试或远端记录。临时 PostgreSQL helper 和探针只在本评审目录。

## 2. Findings

### R-vs001-p07-REQ-001：自动分享与无新信息唤醒耗尽持久预算，后续合法通行无法执行

| 字段 | 内容 |
| --- | --- |
| axis / severity / blocking / status | requirements / high / true / OPEN |
| subject_id | `c2511f4a81d29502aed4c122cd701d3c3632d237` |
| location | `backend/ai/mock-provider.mjs:98` 的逐来源逐同行者分享与后置路线；`backend/ai/mock-runtime.mjs` 的双 Orchestrator；既有 `orchestrator` 的 session commit 唤醒及共享调用预留消费者 |
| rule_or_acceptance | mock §3.1 有目标的策略差异、减少机械重复；§3.2 计划必须落实为后续合法工具；§3.3 有意义主动行为和真实通行；120 次是入口当前承诺的整局持久预算 |
| trigger | 五人标准内容，合法取得并提供四个核验来源、请求悟空从当前可见出口前往通路口，等待角色自行完成已有工作；之后玩家完成真实修复、许可并给出明确终点 |
| impact | 预算在修复/许可之前已经耗尽；后续新证据和路线请求再唤醒角色仍不能预留调用，两 NPC 无法完成实际通行。这是资源状态的实质失败，不是用短等待时间断言产品期限违约 |
| evidence_ids | E-REQ-BUDGET：`priority-probe.mjs`、`priority-probe.json`、`priority-probe.log`；E-REQ-AUDIT：`evidence-audit.json` |

**实际反例。** 探针经正式 Runtime 创建五个合成身份；没有直接写 world、Receipt、终态或模型回答。使用原双 provider / Gateway / Orchestrator 和默认整局预算 **120**。只把公开可配的 `minIntervalMs` 设为 10，以检查调用预算，不计作真实 60 秒观察或整局时长验收。界限、领域时钟、30 秒 Grace 和内容时限均未改动。

| 阶段 | 已预留调用 | 世界与调度结果 |
| --- | ---: | --- |
| 五身份开局主动行为完成 | 14 | 两角色 Idle；唐僧在 passage，悟空在 side_path |
| 四来源合法提供，明确请求悟空先到 passage | **120** | 悟空已到 passage；两角色都进入 `BudgetExhausted` |
| 五人会合、真实工具交接 | 120 | 所有相应玩家动作 Accepted |
| 玩家使用原材料实际修复 | 120 | `safe=true`、`repairMaterial=original_material` |
| 有职责玩家授予许可，公开“请从出口 destination 通行。” | 120 | `permit=true`；两 NPC 仍在 passage；Session 仍 Running，ending=null |

探针共 22 次玩家动作，全部取得 Accepted。120 次调用的实际分布如下：

| 角色 | 调用 | 输出工具统计 | Receipt 结果 |
| --- | ---: | --- | --- |
| 唐僧 | 60 | **47 次包含 wait**；11 次分享；1 次检查 | 46 NO_CHANGE、13 OK、1 DECISION_STALE |
| 悟空 | 60 | **51 次包含 share_evidence**；5 次检查；仅 1 次 move | 1 NO_CHANGE、58 OK、1 DECISION_STALE |

唐僧始终在 passage；悟空前 50 次调用仍在 side_path。另一地区的提交仍不断唤醒唐僧，唐僧在没有相应新合法信息时反复产出 wait，却照样消耗整局预算。单纯把 destination 判断向前移动，未必能处理“安全/许可出现之前预算已空”的这条路径。

**建议修正。** 让目标相关的合法推进获得有界优先级，并限制无新合法信息的反复调用和无目标的逐人分享开销。保留 120 次持久预算语义与全部权限检查；不要靠提高预算、忽略已耗尽状态或改验收等待条件掩盖问题。降低无意义唤醒时，须仍响应新的合法 Claim、变化的可见 Fact、当前控制 epoch，以及重启恢复和新会话。

### R-vs001-p07-REQ-002：已完成的旧路线请求被重新选中，产生没有新输入的往返

| 字段 | 内容 |
| --- | --- |
| axis / severity / blocking / status | requirements / high / true / OPEN |
| subject_id | `c2511f4a81d29502aed4c122cd701d3c3632d237` |
| location | `backend/ai/mock-provider.mjs:113` 的历史 Claim 扫描和 `:114` 的“找当前任一合法出口”；`:117` 每次重新返回 say + move |
| rule_or_acceptance | mock §3.1 观察相关且避免机械重复的策略；§3.2 公开方案与实际工具一致；§3.3.2 无目的往返不能算有效主动行为；有限预算内推进目标 |
| trigger | 同一角色先收到“出口 store”，已实际抵达；再收到“出口 side_path”，也已抵达；此后没有新玩家输入 |
| impact | 最新请求的目标因当前已经抵达而不在 exits 中，代码转而选中更旧请求。返回旧地区后，最新请求又变为合法出口，反复往返并继续消耗预算。提升路线分支优先级会更快暴露这项问题 |
| evidence_ids | E-REQ-ROUTE：`route-replay-probe.mjs`、`route-replay-probe.json`、`route-replay-probe.log`；E-REQ-AUDIT |

**实际反例。** 在真实 PostgreSQL 上，以未修改 provider、原 Gateway 合法上下文、Decision、持久预算预留和实际 submitIntent，逐次驱动 26 次决定。没有伪造 provider context，也没有修改世界状态。两次人类移动只用于在现场提出两条合法请求；第二条请求之后没有新玩家输入。

| 决策序号 | 实际 Accepted 移动 | 当时累计玩家输入 |
| ---: | --- | ---: |
| 6 | side_path → store | 2 |
| 24 | store → side_path | 4 |
| 25 | side_path → store | **仍为 4** |
| 26 | store → side_path | **仍为 4** |

最后两步的 Gateway 输入中，只有原来两条路线 Claim；原请求没有被删除或重新发送。两次额外移动有真实 Receipt 和事件区间。探针逐次驱动以隔离策略，不把它宣称为另一次自动调度时长检查；既有自动调度器对这些实际移动提交会继续唤醒角色，是该策略的真实消费者。

**建议修正。** 区分最新建议、已满足的建议及被后续建议替代的历史请求。已到达最新目标时应完成该次建议，不能因为旧目标再次成为邻接出口就恢复旧请求；同时保留新 Claim 对相同出口发起新请求的能力。不能用己方一句“打算去”替代已经实际完成的判断，也不能通过清空合法 Memory 修复。

## 3. 已覆盖并取得正向证据的部分

本次实际运行了固定的两个新增测试文件，共 **9/9，exit 0，无 skip/cancel**。原始输出见 [targeted.log](targeted.log)，本次重新产生的策略证据见 [policy-evidence.json](policy-evidence.json)。没有机械重跑全后端。

| 需求范围 | 本次检查 |
| --- | --- |
| 独立角色身份与策略 | 两组不同 providerId/modelId/policyVersion；唐僧优先安全与许可、悟空亲自检查。实际 Claim 和 inspect 经统一提交产生 |
| 合法上下文与秘密边界 | provider 无 DB、文件、fixture 或全量状态依赖，只读取当前 Gateway 输入；完整输入检查未包含另一局唯一标记或真人私人内容；核心策略拒绝 proxy 主体 |
| 两组同说法、异证据 | 损坏时间记录/现场痕迹、材料登记/现场标记两组均实际改变公开判断与后续证据工具；未见合法来源的角色没有提前知道 |
| 同源副本 | sourceIds 交集拒绝作独立印证；重复分享原来源不触发相互印证。Claim 不参与 Evidence 事实判断 |
| 拒绝、替代与动作 | 实际修复前拒绝通行，修复后未许可仍拒绝；玩家完成许可后有合法移动。没有由 NPC 代修复、代许可或预填通关 |
| 显式入口与恢复 | `start:mock` 使用原权威 HTTP/Socket.IO、Runtime 和两个 Orchestrator；新局登记、已有 Running 恢复、重复 attach 拒绝、持久预算不重置、旧 Ready 意图恢复只提交一次 |
| 双角色故障组合 | 超时与非法 JSON 实际走 fallback，玩家并行取得 Receipt；迟到输出不复活原决定；终局取消两份在途输出后没有新提交 |
| 关闭 | 新增运行测试实际检查取消角色任务、停止监听、清空登记、重复 close；独立进程及自有 PG 连接的最终关闭由下节匹配源码的 60 秒原件补充 |

上述正向结果没有覆盖“所有合法玩法都能在共享预算内推进”或“旧路线不会重新执行”；这正是两个新增反例揭示的缺口。

## 4. 作者原始证据核对与失败保留

[author-evidence-audit.json](author-evidence-audit.json) 独立核对了候选清单、9 个变更文件和 63 个生产执行输入的摘要，确认最终 60 秒记录的前后来源相同且与固定候选一致；全后端最终日志的当前来源清单也匹配。作者的全后端 **99/99** 是原提供执行，不冒称本审查重新执行。

最终真实窗口记录为 **60010.480770999995 ms**、9 次 controlled 调用、唐僧 4 条/悟空 3 条实际检查或分享事件、窗口内新玩家动作 0、外部模型调用 0。独立 mock 进程正常退出，最终记录显示自有 PG 连接已关闭。该记录只支持没有新玩家输入时的最小主动行为，不支持五人完整局、900 秒或预算推进结论。

保留以下失败，不以最终成功替写：

- 作者 `real-window-first-failure.json/log` 原状态 FAIL，报“模拟进程遗留 PostgreSQL 连接”。它的源摘要不同于最终窗口；本次未把它改名为通过或声称重跑了该旧输入。
- 本评审 `priority-probe-first-window.*`：25 秒阶段 watchdog，尚未取得完整预算结论，按 INCONCLUSIVE 保留。
- 本评审 `priority-probe-second-window.*`：90 秒阶段 watchdog，尚未取得完整预算结论，按 INCONCLUSIVE 保留。
- 第三次预算探针减少了反复全量 replay 的观察开销，并给预算检查独立运行上限。它完整观察到 120 次及两角色 BudgetExhausted；finding 的依据是此实际资源终态，不是前两次等待失败。

所有探针使用独立 PG，资源均已关闭。原两个已知 PNG 缺失不属于本轮新增截图交付；未把它们记成当前候选的新问题，也未声称已经恢复。

## 5. 未覆盖与复审边界

本审查没有重跑完整 99 项、真实 60 秒观察或五身份 900 秒，也没有验证公网部署、真人体验或外部模型质量。当前用户已授权全部 mock；后面三项保持 full-real 未执行边界，不构成本 profile 的额外阻断。

根代理提供的五人集成 R1 有限等待失败只作为风险线索；本报告不依赖该 90 秒失败证明产品违约。两个 OPEN findings 均由本评审自己的实际输入、数据库记录和工具效果支撑。也没有读取标准轴报告或将另一轴结论计入此判断。

修正后应固定新候选，对两个原 finding 作 R2 局部复核，并至少覆盖：

1. 保持默认持久预算不提高，合法五人序列在新 Claim、新 Fact 和安全/许可变化后仍能真正推进；无关地区提交不能以大量无效果调用提前耗尽预算。
2. 减少无新信息唤醒不能吞掉新的合法 Claim、已见 Fact 变化、控制 epoch 变化、重启恢复或新会话登记；不能把跨角色/跨局数据放入缓存来判断变化。
3. 两条已执行路线不会复活成往返；新的明确建议仍可响应，安全/许可和当前可见出口检查保持。
4. 受影响的恢复、持久预算、旧意图身份和关闭路径继续有效；保留本轮 R1 原始失败及两次探针 INCONCLUSIVE。

本轮只交付需求轴 FAIL；尚不具备 #10 `dual-ai-behavior` 的释放条件。后续修正不能由作者自报替代原发现的独立复审。
