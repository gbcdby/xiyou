# #10 双 NPC 受控策略：独立需求轴 R2

## 1. 结论与固定对象

**需求轴 R2：PASS。原 `R-vs001-p07-REQ-001`、`R-vs001-p07-REQ-002` 均 VERIFIED；本轮新增阻断 finding：0。**

两个结论来自原审查者对同一输入序列的独立真实 PostgreSQL 复跑，以及本轮唤醒边界探针，不继承作者的 FIX_REPORTED 或标准轴结论。原 c251 R1 的 FAIL 和失败原件保持原身份，未改写为通过。

| 身份 | 本次固定值 |
| --- | --- |
| work_id / Ticket | `vs001-p07` / `gbcdby/xiyou#10` |
| Reviewer / axis | `/root/ai_requirements` / requirements / independent |
| R2 源码提交 | `71aad48878c532521919c72511c023285785d7e7` |
| R2 源码 tree | `b438c5641290cf70cf9cf0fccafb85bab98e76f5` |
| R1 / parent / merge base | `c2511f4a81d29502aed4c122cd701d3c3632d237` |
| 运行工作目录 HEAD | `ce57d0f172b5a447cf16069ed1255fd009ecc931`，相对 71aad 只有证据归档变动 |
| 有效契约 | Spec `3690b481d1805f6a7b535584c80a8574c5103d97`，`mock-20261111` §2—3 与有关 §5 条件 |
| 生产变更范围 | `backend/ai/mock-provider.mjs`、`backend/ai/mock-runtime.mjs` |
| 执行输入身份 | 64 个生产/测试输入逐字节匹配 71aad 的 Git 内容，执行前后 SHA-256 一致 |
| 标准轴 | 本审查未执行，也未读取对侧报告 |

源码身份见 [source-before.json](source-before.json)、[source-after.json](source-after.json)。工作目录中的 ce57 不被冒称为源码提交 71aad；它对证据文本及链接的补充不改变实际执行输入。作者正式证据按 ce57 读取。

## 2. 两个原 finding 的实际复核

### R-vs001-p07-REQ-001 — VERIFIED

R1 触发条件是五人标准内容、合法来源与同行者增加后，逐人分享和没有新合法信息的唤醒先用完 120 次预算，使后续真实修复、许可和终点建议无法执行。

R2 的增量在两个相互关联的消费者处修正这一问题：启动层把通用 `autoWake` 关闭，改为仅根据实际事件的核心 NPC 受众唤醒，排除单独 GoalUpdated；provider 在必要来源解释与安全核对后优先处理最新合法路线，并将同来源对多个尚未接收的同行者合并为一次定向 Claim 和一次分享。推理前仍由 Runtime 重新构造合法上下文，事件原文不传入 provider。120 次预算及持久预留没有提高或重置。

**原序列复跑结果：76/120 次调用，实际自然终局 `clarified_passage`，两 NPC 均抵达 `destination`。**

原 [priority-probe.mjs](priority-probe.mjs) 除候选标签外与 R1 最终探针相同，仍有 22 次真实玩家动作；检查、来源取得/分享、原材料、工具交接、实际修复、许可和路线均通过原 Runtime/Validator，没有直接写世界或预填终态。原预算 120 保持，公开可配调度间隔仍为 10 ms，不计作 60 秒或 900 秒时长验收。

| 原输入阶段 | R1 调用与结果 | R2 调用与结果 |
| --- | --- | --- |
| 五身份初始主动行为收束 | 14，Running | 12，Running |
| 提供四来源，请悟空先到通路口 | **120，双角色 BudgetExhausted** | **38，仍可继续处理** |
| 五人携材料与工具会合 | 120 | 62 |
| 工具交接 | 120 | 64 |
| 玩家实际修复 | 120 | 70 |
| 实际许可与明确终点 | 120；两 NPC 仍在 passage、Running | **76；两 NPC 实际 destination、Finished** |

最终事件派生事实同时显示 safe、permit、arrived、originalConsumed、evidenceComplete 为 true，spareConsumed 为 false。原问题已经由实际成功路径消除，不是延长等待、提高预算或修改输入期望。原始结果见 [priority-probe.json](priority-probe.json)、[priority-probe.log](priority-probe.log)。

### R-vs001-p07-REQ-002 — VERIFIED

R1 在“出口 store”与随后“出口 side_path”均已完成后，没有新输入仍回选旧路线，产生往返。

R2 先取最新路线陈述，然后独立判断当前是否已经抵达、目标是否为当前合法出口。最新请求已经满足或目前不可达时，不再向后寻找旧请求作为替代。判断依据是当前授权 `self.regionId` 与 `regions.exits`，没有添加全局路线答案、跨角色缓存或隐藏对象 ID。

原 [route-replay-probe.mjs](route-replay-probe.mjs) 同样只替换候选标签，保留原人类输入和后续逐决策驱动。**本次实际 61 次 Decision 只有两次要求的移动：side_path → store、store → side_path；其后没有新输入，也没有额外 move。** 原问题为 26 次 Decision 已出现 4 次移动，两次额外往返均有 Accepted；两轮原件分别保存。

本探针通过原 Gateway、持久预算预留、Decision 与 submitIntent 实际执行，以逐次驱动隔离策略。它不被称为自动调度时长检查。结果见 [route-replay-probe.json](route-replay-probe.json)、[route-replay-probe.log](route-replay-probe.log)。

## 3. 唤醒过滤的独立影响检查

减少无信息唤醒可能遗漏有效工作，因此另建独立真实 PG 探针，直接使用原 `attachMockAI` 与 Runtime，不读取作者新测试的结果代替这些检查。原始输入及结果为 [wake-probe.mjs](wake-probe.mjs)、[wake-probe.json](wake-probe.json)。

| 本次实际条件 | 结果 |
| --- | --- |
| 只向真人发送 private Claim | 唐僧/悟空调用保持 5/4，没有唤醒 |
| 真人自己取得新的 inspection Observation，未授权给 NPC | 仍保持 5/4，没有唤醒 |
| 唐僧在场听到新的 public Claim，悟空在远处 | 唐僧 5→6，悟空仍 4；唐僧新 Gateway 输入包含合法 Claim，仍不包含私人标记 |
| 真实 `control.take` 使真人 epoch 2→3 | 按该事件实际核心受众，两 NPC 分别 6→7、4→5；没有丢掉控制通知 |
| 真人从 passage 移动到 side_path | 原地与到达地角色都被唤醒；新上下文中悟空看到该真人位于 side_path，唐僧只看到未知位置 null |
| 停止 AI，在停机期间产生合法 Claim，再关闭并创建新 Runtime | 旧 17 条调用记录全部保留，恢复后共 19 条；悟空新输入读到停机期间的合法 Claim，预算没有重置 |
| 创建另一个新 Session | 两核心角色自动登记并执行；新输入各自绑定新 Session；旧 Session 调用保持不变 |
| 原 Session 终止 | 调用维持 19，不因终局新增调用。此步骤从 Idle 检查；在途取消由下述受影响测试及未改 Orchestrator 单列核对 |

以上 **8 项均 PASS，资源关闭完成**。原预算序列还实际覆盖了修复/许可所造成的 target Fact 更新：调用从 64→70→76，策略取得新状态并最终移动。因此过滤通知没有把本轮要求的 Claim、位置/通路事实变化、控制通知、重启或新会话吞掉。

静态同时确认：旧 Orchestrator 的终局/控制围栏取消逻辑位于 `autoWake` 判断之外，仍监听实际 commit；新启动层只决定何时 `wake`，没有改变提交权限、Observation 过滤、generation/epoch/deadline 校验、Unknown 查询、fallback、持久预留或关闭实现。核心策略仍拒绝 proxy 主体。

## 4. 受影响测试与作者证据

本次实际执行 3 个固定测试文件：

```text
node --test backend/tests/ai-mock-policy.test.mjs \
  backend/tests/ai-mock-runtime.test.mjs \
  backend/tests/ai-mock-progress.test.mjs
```

**12/12，exit 0，无失败、跳过或取消。** 覆盖原合法感知与秘密边界、两组同说法异证据、独立来源、拒绝和实际通行、重启预算/旧意图、双角色非法输出/超时/终局取消，以及新增路线、受众唤醒与五人推进回归。完整日志见 [targeted.log](targeted.log)。本次自己的两个原序列和 8 项唤醒检查另有独立原始结果，不与 12 个测试混成一个虚构的总测试数。

正式作者归档另核对了 70 个 `checkedBytes` 输入，以及真实窗口原件的前后源摘要；正式 `window.json` 与原始窗口记录除重复源摘要表外一致。作者原执行为全后端 **102/102**、默认频率真实窗口 **60016.968272 ms**、9 次 controlled 调用、0 个新玩家动作，独立进程与自有 PG 连接正常关闭。它们是作者提供而本次核对的执行，没有冒称本审查重新运行完整后端或再等 60 秒。详见 [evidence-audit.json](evidence-audit.json)。

原 c251 R1 FAIL、120 次预算反例、旧路线往返反例，以及本评审前两次 budget probe 的 INCONCLUSIVE 都保留在原目录；本轮审计记录其摘要，不覆盖或改名为 PASS。已知旧 PNG 缺失不属于本次新增交付范围，未产生新的截图缺失判断。

## 5. 结论的适用范围

本报告使两个原需求 finding 在 **71aad 的固定源码**上转为 VERIFIED，需求轴 R2 可通过；不替代另一独立标准轴，也不把根代理当前集成候选的 HTTP/Socket.IO 完整局、900 秒、其他人数/分支矩阵或实际合并预先写成通过。

R1 中未变的感知、可信上下文、同源处理、角色差异、玩家专属修复/许可和持久恢复边界继续适用；本轮受影响测试又实际覆盖了这些主要消费者。没有发现新增必须阻断 #10 当前阶段的需求问题。

真实外部模型质量、真人体验与公网部署仍不由本轮推导；在当前用户授权的 mock profile 中为不要求项，不能因此新增释放阻断。实际外部模型调用保持 0。

后续更改唤醒过滤、路线选择、分享去重、调用预算或恢复身份时，应重审相应影响；不能只沿用本轮的绿色计数。当前总控可继续在同一集成候选上完成其余验收与已授权的 PR/合并流程。
