# 高老庄规则与受控接入

实现范围为 [Spec #23](https://github.com/gbcdby/xiyou/issues/23) 的 [Ticket #32](https://github.com/gbcdby/xiyou/issues/32)。产品行为沿用 [ADV-001 v0.2](../docs/specs/narrative-adventure.md)；事务、时间、同意、身份及恢复沿用 [adv-protocol-v1/r2](../docs/specs/adv-protocol.md)。机器字段、有限操作与分页语义见 [高老庄接口](../protocol/gaolao-v2.md)。这些文件说明实现与检查入口，不代表独立审查、A2 阶段或下游已释放。

## 固定内容与状态

`gaolaozhuang-v1` 与 `gaolaozhuang-tools-east-v1` 分别固定公共工具的西侧、东侧布置，均使用 `gaolao-world-v1`、`gaolaozhuang-chapter-v1`、`gaolao-layout-v1.1`。地图来源为仓库 GZ-VIS-01/v1.1 坐标基准。内容的摘要和完整快照在建局时持久化；旧 region 与空间灰盒仍按各自解释器回放。内容校验拒绝不完整职责、错误本人实体、伪独立来源、未登记操作、私物公共化与缺失结局去向。

章节状态属于原 Session 事务，没有第二个可写权威源。`game/gaolao-world.mjs` 管理章节状态和观察者投影；`game/gaolao-rules.mjs` 执行有限动作。效果、连续事件、Receipt、计划围栏与 outbox 使用原 `locked/buildTransaction/persist` 边界。随行使用同一场景时钟和寻路几何，每个检查点验证主体、领路者、许可及路线版本；接受、跟随、实际到达和本人安置确认分别记录。重启提高控制 epoch，暂停随行，不补走宕机时间。安全安置事实在 reducer 中保持单调。

借貌改变外观代次和观察者引用，不改变真实物权。改约、撤回或重新回应使旧版本许可与依赖外貌同事务失效。姓名只用于展示；动作始终解析本观察者当前引用。来源分享保留原始来源标识和类别，陈述不会升级为事实。唐僧与八戒各自的决定有独立版本，撤回取消依赖离庄安排；最终同行/分别仍重验实际位置、物品归还和当前决定。结束确认轮绑定当前在线真人集合，成员变化使未完成轮失效。

全员结束招徒是持续到本局收束的边界：新的招徒/加入决定拒绝，已有决定仍可本人撤回；离庄计划选择与最终入队再次检查该边界，原有效决定的 Receipt 和历史不改写。`game/gaolao-navigation.mjs` 只关联预留时确实朝向约定会面点、离庄目标或对应出口的导航，把许可/安排依据保存于既有 `execution_context`。实际计划持有同一份依据；撤回/改约/结束选择按依赖取消，晚到预留提交及路径步进继续重验。普通目标不继承许可，不被无关变化取消。

授权同意列表使用现有 256 条容量，优先保留所有当前用途槽，其余位置给最近可见历史。`follows` 只有真实翠兰一槽，`decisions` 只有两个当事人槽，`progress` 是有限规则键，目的地和公共物来自固定内容；原观察/台词已有 256 条窗口。同意变化产生不可分享的参与者专属观察，完整历史走现有终态复盘分页。接收者仅为当时主体、请求者、领路者与许可执行者；观察保存当时用途/状态/版本/目的地和不透明许可编号，不输出内部人物身份，也不在复盘时反查后来的姓名或受众。

## 受信角色执行

HTTP/Socket 不暴露内部句柄。服务端模块通过以下链路执行单个有限意图：

```js
const handle = await runtime.bindInternal(sessionId, configuredActorId, 'core_npc');
const snapshot = await runtime.observeInternal(handle);
const context = await runtime.spatialContext(handle);
// action 的目标只能取该角色自己的 snapshot/context；不使用另一观察者的引用。
await runtime.reserveSpatialIntent(handle, stableIntentId, action);
const receipt = await runtime.submitSpatialIntent(handle, stableIntentId);
```

翠兰、高太公与见证人使用 `scene_role`，唐僧、悟空和八戒使用 `core_npc`；绑定时核对内容实际 actorKind，不能互换。对外仍只输出安全 DTO，不携带这些内部身份。导航序号在预留意图时由服务端统一分配，重试只读原 Receipt，晚到结果不能重新编号。非移动意图通过同一预留/提交/Receipt 链路；真实主体、资源、同意和阶段在提交时重验。内部意图的 fallback 原因存于迁移 006 增加的执行上下文，不由公共动作声明。

迁移 006 的 `spatial_intents.request_text_encoding` 为可空列；旧行不重写，空值按原文解释。新增非移动文本含 NUL 时使用既有 `nul-escaped-v1` 可逆编码，反斜杠同时转义。预留请求的重试比较、提交与重启读取都先解码，保持 NUL 与字面 `\\0` 的区别；语义摘要针对原文，公共请求的严格解析和持久 nonce/Receipt 边界保持原有规则。

`spatialContext` 完全从该角色的严格授权 SnapshotV2 生成，包括合法观察、发生时台词、当前目标引用、有限操作及本人可回应的同意。它不读取隐藏世界、其他人的记忆或内部依赖表。旧 `prepareDecision/prepareDecisionContext` 等 region 决策入口对空间局返回 `UPGRADE_REQUIRED`，不能误作 A2 上下文。

受控故障只允许等待、停止、原有稳定安全目标的导航，以及前提全部满足的悟空破封。`reserveSpatialFallback` 的 `model_timeout/invalid_output/ineffective_twice` 是受控故障来源；规则仍拒绝代答同意、借貌、收徒或加入。这里没有真实 Model Gateway、三角色公平队列或模型质量评价；这些属于 #34。

完整受控动作样例在 `test-support/gaolao-room.mjs`，独立 HTTP/Socket 客户端适配在 `test-support/gaolao-network.mjs`。样例通过绑定、合法观察、导航、有限交互及真实事务推进，不直接写章节旗标。它们用于可重复技术检查，不是生产自动 NPC 调度器，也不是真人游玩记录。

## 授权出口

| 出口 | 实际实现与约束 |
| --- | --- |
| 快照、订阅、控制恢复 | 原空间 runtime + `projectGaolao`；同意只给参与者，决定只给本人或实际收到决定的人；同名实体各保留自己的引用 |
| 增量与主动同步 | 原 outbox 和完整事务水位；投影替换仍按观察者生成，隐藏事件只推进游标 |
| 动作 Receipt、错误与结果查询 | 原持久 Receipt 和当前访问检查；结果只引用请求者已持有的公开引用 |
| 观察、来源和台词 | 发生时存下安全文本、姓名、引用与受众；来源转送保留类别和 origin，定向/公共发言验证当时范围与遮挡 |
| 物主、目标、工具和上下文 | `observerName`、`gaolaoOperations`、`buildSpatialContext`；未知者不能凭操作 enum 区分两个相同外貌的实体 |
| 终局与复盘 | `gaolao-recap.mjs` 从授权历史 payload 分页，保持 NUL 与文本原文，不按后来身份重绘旧条目；读取仍核对当前资格 |

## 检查与边界

新增检查直接进入现有 CI 的 `npm run test:protocol`、`npm run test:content` 和 `npm run test:backend` 通配入口；无需另建选择性命令。只运行本票真实 PG/网络检查可用：

```sh
node --test backend/tests/gaolao-runtime.test.mjs backend/tests/gaolao-network.test.mjs
```

作者检查覆盖 2/3/4/5 职责、声明变体、2/5 人直接/乔装与同行/分别组合、本人同意和旧请求、双同貌物权及历史、来源送达、全员结束、晚到终局动作和受控故障。原空间/region 回归继续约束命令顺序、未知结果、旧订阅、所有权和 NUL 持久化。真实运行结论以固定候选的日志与审查记录为准。

这些检查控制场景时间，不承担五独立客户端至少 15 分钟真实墙钟的长时验收；没有真人体验、真实模型、正式美术或手机真机结论。AP-01～05/07 的实现义务映射到上述事务、引用、随行、物权和终局入口；复用 #27 已冻结的合同与有限模型边界，不把模型历史记录重标为本候选新运行或完整章节证明。独立需求/标准审查、完整候选长时验收和阶段释放由外层交付记录确认。
