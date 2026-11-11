# #6 首轮独立审查修正结果

## 结论与固定对象

**本轮作者实现：COMPLETE；当前候选作者自查：PASS_WITHIN_SCOPE。** 五项 finding 均为 **FIX_REPORTED**，等待各自独立增量复审；作者没有将其改为 VERIFIED，也没有据此释放后续联调或 #9。

- work_id：`vs001-p03`；Ticket：[xiyou #6](https://github.com/gbcdby/xiyou/issues/6)。
- 有效 Spec：`6c2a0b9f6d137ad5fbd41721659404333ad8e16d`；未修改 Spec、protocol、content、formal 或生成的 game/types.ts。
- 原冻结候选／本轮基线：`e32c579da3f41b131368ca2e9fca80bdb0b449fd`，tree `a4cfca72c94a25c2650b25d19943a7d1aa8b35ae`。
- 本轮独占分支：`auto/vs001-runtime-fix`。原候选工作树与本分支内的原作者证据均保持不变；[原实现结果](../implementation-result.md)属于历史背景。
- 固定源码提交：**`8daac7cb50075a9c43317d3c193f0effed4acc7b`**，tree **`eabc52e78923bed88e6b38a1372cf6a9ae9e5218`**。后续证据提交只增加本目录文件。
- 56 项源码／测试／协议／内容／Spec 输入的集合 SHA-256：**`3680283a4c0d776ec391304f4b545f69d7bcb9779032e9f904757640c6b6edc9`**；算法与逐文件摘要见 [source-manifest.json](source-manifest.json)。

检查索引与原始输出摘要见 [self-check.json](self-check.json)，实际版本见 [environment.json](environment.json)。本轮不改变旧报告的候选身份，不用旧 26 项绿灯反驳首次独立审查的真实反例。

## Findings 与修正

| 原 finding ID | 作者状态 | 修正及实际边界 |
| --- | --- | --- |
| R-vs001-p03-REQ-001 | FIX_REPORTED | 控制提交后的本地副作用重新读取当前绑定，撤销同时限定原 epoch／viewId；迟到事务不能断开再次获权的连接或回退 view epoch |
| R-vs001-p03-STD-001 | FIX_REPORTED | 未知结果恢复在当前读权复核后比较本次 semanticDigest；异载荷保持 ACTION_ID_REUSE，同载荷返回原 Receipt |
| R-vs001-p03-STD-002 | FIX_REPORTED | 领域字典只查询自有对象记录；合法未知原型属性名持久拒绝，真实同名自有记录仍正常工作 |
| R-vs001-p03-STD-003 | FIX_REPORTED | 断线、撤权、换订阅、删除及运行层关闭收束 view；在途旧对象不能影响当前 Map 中的新订阅 |
| R-vs001-p03-STD-004 | FIX_REPORTED | 公开错误消息修复不完整代理对，按 Unicode 码点限制为 500，并经共享 ErrorResponse 校验 |

### REQ-001：COMMIT 后的当前代次围栏

[runtime.mjs](../../runtime.mjs) 保留原 `beforeCommit`／`afterCommit` 钩子及其位置。控制事务 COMMIT 后可以暂停，后续接管仍可以提交；没有跨钩子持有 Session 锁来阻止反例交错。钩子返回后，`applyControlEffects` 只在实际应用本地副作用时短暂重取行锁，按当前数据库中的角色、连接及 epoch 更新 grants 和 view。

旧绑定记录保存 actorId、当时 epoch 与 viewId。当前已再次获权的连接、新只读订阅和终局后的合法读取均不受旧撤销影响。新增真实 Socket.IO 场景复现 C1 → C2 已提交但回调暂停 → C1 再次接管 → 旧回调恢复；C1 保持连接、HumanControlled 和最后 epoch。另覆盖同连接双 take、真实断开仍撤销最后代次、撤权／终局之后迟到回调，以及旧事务不撤新订阅。旧 nonce 的既有回归也继续通过。

### STD-001：恢复结果仍绑定本次载荷

`confirmOutcome` 的三个调用方提供原始请求对应的摘要。真人结果查询与内部结果查询先执行既有当前身份、Session、成员及角色读权检查，之后才比较摘要。[decisions.mjs](../../decisions.mjs) 的内部意图使用整包摘要；fallback 使用本次固定系统请求摘要。

真人与内部意图的“同键异载荷 + COMMIT 后响应异常”均先红后绿。检查同时确认旧 Receipt 内容和世界不变，相同载荷仍返回旧收据；回复前撤权得到 FORBIDDEN，不能通过恢复路径读出旧结果。fallback 原键响应故障恢复与重复提交保持幂等。

### STD-002：自有记录查询

[records.mjs](../../../game/records.mjs) 的 `ownRecord` 仅返回自有且确为对象的记录，接入规则、投影、角色授权、受众、Decision 读取对象及 reducer 的记录查询。没有禁用 `constructor`／`toString` 这些合法 ID，也没有吞掉异常返回未知结果。

真实网络检查覆盖普通不存在 ID 与原型属性名称的物品、检查对象、交互目标、证据和私聊接收者：ACK 为 Rejected／TARGET_UNAVAILABLE，事件范围为空，HTTP Receipt 查询为 200，重试返回相同收据，世界不变。伪造 actor 和内部未授权对象继续拒绝。另以规则公开入口检查实际自有的 `constructor` 角色与 `toString` 物品仍产生合法观察；该同名记录场景是领域检查，不冒充新增关卡集成验收。

### STD-003：视图生命周期

`retireView` 先使旧对象 inactive，再仅在 Map 仍指向同一对象时删除和通知。发布器在异步同步返回后检查旧对象状态，旧错误也不能撤销新订阅。当前终局只读订阅仍可读结果，在订阅自身结束时释放。

四个真实只读连接执行 open → subscribe → disconnect，跨任务显式 GC 后四个 WeakRef 均不可达；无需调用整个运行层的 close。另用原 afterCommit 钩子暂停发布中的 sync，替换订阅后释放旧任务，确认不投递旧批次、不撤销新 view。测试脚本仅为该生命周期检查添加 `--expose-gc`，生产启动不受影响；没有增加压力或 SLO 门槛。

### STD-004：公开错误边界

[errors.mjs](../../errors.mjs) 保留错误 code，以 `toWellFormed` 修复不完整代理对，再按码点截断；超长消息包含省略符且总长度不超过 500。非字符串消息使用固定文本，未知内部错误仍按原规则返回 OUTCOME_UNKNOWN。返回 DTO 经共享 Schema 校验。

真实 ACK 覆盖 600 字符和 600 个非 BMP 字符的未知字段名，以及不完整代理对输入；非法输入仍为 INVALID_MESSAGE，不产生领域 Receipt 或世界效果。函数级检查覆盖恰好 500 码点、501 码点、末尾完整 emoji、孤立高／低代理项及非字符串消息。

## 本轮实际检查

新增场景统一在 [review-fixes.test.mjs](../../tests/review-fixes.test.mjs)。测试继续使用真实 PostgreSQL，没有内存权威替身；控制交错使用可信暂停钩子，异常恢复使用已有可信响应故障钩子。

| 检查 | 当前结果 | 原始输出 |
| --- | --- | --- |
| `npm run test:backend` 最终运行 | **38/38 PASS**，0 fail／skip；原 26 项计数 + 新增 12 项 | [final-backend.txt](raw/final-backend.txt) |
| 新增文件 TAP 诊断 | **12/12 PASS** | [review-suite-diagnostic.txt](raw/review-suite-diagnostic.txt) |
| 完整 TAP 诊断 | **38/38 PASS** | [full-suite-diagnostic.txt](raw/full-suite-diagnostic.txt) |
| `npm run test:protocol` | **21/21 PASS** | [final-protocol.txt](raw/final-protocol.txt) |
| `npm run test:content` | **8/8 PASS** | [final-content.txt](raw/final-content.txt) |
| 两份生成一致性、Python Schema／摘要、diff | 全部退出码 0 | [final-static.txt](raw/final-static.txt) |
| 固定来源、正式链接、源码／日志摘要、旧证据及进程收束 | 见真实收口输出 | [freeze-check.txt](raw/freeze-check.txt) |

最终运行中的原进程崩溃场景重新实际执行：子进程 PID 186／203／216 分别在提交前、COMMIT 后 ACK 前、发布中退出，退出码 71／72／73。恢复检查通过，PG 父进程与子进程由本轮执行者持有并收束；没有交接 pending exec 句柄。

### 保留的首次整套失败

[final-backend-first-attempt.txt](raw/final-backend-first-attempt.txt) 的退出码为 **1**：38 个行为检查通过，但 Node 在新增测试文件级别另报 `test failed`，总计 tests 39／pass 38／fail 1。该原始输出没有提供该次文件进程退出码或信号细节，**根因仍未确定**；不能据此归因为业务断言、GC 或具体依赖。

随后没有修改业务或测试源码，新增文件 TAP、完整 TAP 和原 npm 命令分别得到上表结果。本报告保留首个失败，不称其“已定位／已修复”，也不把该次运行写成 PASS。若复发，下一步是同时保存 spec／TAP 或捕获 runner 的 `exitCode`／`signal`，而不是用重复绿灯补造原因。本轮没有为此继续扩展全套执行。

### 小步红绿

| 行为 | 实际红灯 | 修正后输出 |
| --- | --- | --- |
| 迟到控制副作用 | [01 红](tdd/01-control-red.txt)：两条目标反例失败 | [01 绿](tdd/01-control-green.txt)：2/2；[邻近检查](tdd/01-control-neighbors.txt)：4/4 |
| Receipt 恢复摘要 | [02 红](tdd/02-receipt-red.txt)：真人与内部意图错收旧结果 | [02 绿](tdd/02-receipt-green.txt)：2/2 |
| 自有记录查询 | [03 红](tdd/03-own-record-red.txt)：未知 ID 误报 unknown，同名自有物品检查抛异常 | [03 绿](tdd/03-own-record-green.txt)：2/2 |
| view 生命周期 | [04 红](tdd/04-view-lifecycle-red.txt)：4/4 句柄保留，旧批次继续投递 | [04 绿](tdd/04-view-lifecycle-green.txt)：本项 2 项与 REQ 4 项共 6/6 |
| 错误正文 | [05 红](tdd/05-error-envelope-red.txt)：两项共享 Schema 校验失败 | [05 绿](tdd/05-error-envelope-green.txt)：2/2 |

11 份阶段输出原样保留，包括框架差异中的行尾空格；仅本证据目录的日志属性允许保留该格式，业务源码继续执行默认空白检查。阶段日志属于当时执行过程，不冒充各自已有独立固定 commit；当前结论绑定上方源码清单与最终运行输出。

## 未覆盖与交接

五项 finding 尚未独立复审，原 requirements／standards FAIL 的历史结论没有被作者覆盖。新候选需由对应审查者核对修正及相邻影响后判定 VERIFIED。

本轮没有新的 TLA+／TLC／refinement 结论，没有修改协议或借修正改变玩法；没有读取并上传受阻的 core 原始日志。没有最新前端联合、五客户端 900 秒、真实模型、NPC 自主运行或真人体验结论，也没有数据库自身宕机、主备、容量或生产 SLO 验收。

没有推送、创建 PR、合并、部署或修改共享安装。使用现有只读依赖链接并通过本地 exclude 排除。最终固定候选交回总控，按原 finding ID 安排独立需求／标准增量复审，复审释放后才继续后续集成。
