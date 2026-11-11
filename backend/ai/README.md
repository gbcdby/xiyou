# 单角色 AI 运行模块

归属 [Ticket #9](https://github.com/gbcdby/xiyou/issues/9)，依据固定 Spec `6c2a0b9f6d137ad5fbd41721659404333ad8e16d` 的 [M0 §9–10](../../docs/specs/m0-protocol.md)、[玩法中的感知／目标／信念](../../docs/specs/vertical-slice-gameplay.md)和 [VER-04](../../docs/specs/vertical-slice-verification.md)。权威运行基线是 `5d3e16fa46c4719471092d0567e9bfd1e28737f7`；本目录不改变公共 HTTP／Socket.IO／ProposedIntent 契约。

本候选提供受控供应商实现和作者自查。实际供应商、endpoint、modelId、凭证及费用授权尚未提供，**实际外部模型调用为 0，真实模型验收保持 BLOCKED／NOT_RUN**。受控检查不代表模型质量、VER-04 整项完成或 `single-ai-runtime` 释放；后续独立审查、真实模型闭环与 #10／#11 释放由总控处理。正式自查见 [实现结果](../evidence/ai/implementation-result.md)及[清单](../evidence/ai/self-check.json)。

## 结构与数据归属

| 模块 | 职责 |
| --- | --- |
| [context.mjs](context.mjs) | 从本角色合法投影构造 Memory，确定性维护目标及来源 |
| [gateway.mjs](gateway.mjs) | 供应商无关适配、共享 ProposedIntent 严格解析、超时／取消／延迟统计 |
| [orchestrator.mjs](orchestrator.mjs) | 单角色单在途、合并唤醒、并发／间隔／预算、提交与恢复 |
| [persistence.mjs](persistence.mjs) | 本局持久调用预留、上下文／原文／摘要／结果关联 |
| [decisions.mjs](../decisions.mjs) | 原子准备、当前授权、Decision 围栏、整包 Validator 与稳定 fallback |
| [002-ai.sql](../migrations/002-ai.sql) | 内部目标来源和模型尝试记录，无新队列服务 |

`ai_goal_sources` 以 Session、Character 和 principalKind 隔离，保存策略版本、实际来源、相关资源版本、来源水位、语义摘要及对应 Goal revision。世界仍只记录现有 `GoalUpdated`；内部来源字段不进入共享 Goal DTO。`ai_runs` 保存过滤后的上下文、配置、原始输出、严格语义摘要、模型耗时／状态及最终 Receipt 关联。两类表的写入都在 Session 行锁内，锁后复核当前主体；新的持久入口先处理 Session 截止。

这些表属于可信服务诊断数据，没有 HTTP／Socket.IO 查询接口，也不会进入玩家快照。完整内容快照仍只保存在 Session 服务端；上下文不含全量秘密、其他角色信念、内部 audience、UserId、连接凭据或事件日志。

## 原子上下文、Memory 和目标

`runtime.prepareDecisionContext(handle)` 在**同一个 Session 锁／事务**内复核授权和终局、刷新可信目标、构造过滤上下文、选定 Observation 与相关对象版本、保存 Decision。返回 `{decision, context}`；两者的观察白名单、版本依据和 `context.snapshotSeq` 对应同一水位。目标更新产生事件时，水位取更新之后。原有 `prepareDecision` 和 `observeInternal` 的独立调用行为保留；二者没有跨调用原子性承诺，新调度器使用新入口。

Memory 直接读取持久 Observation／Claim／Belief／Goal，不建立另一份无来源的全文记忆。当前视野放在 `context.current`，合法历史知识放在 `context.memory`。最近至多 256 条授权 Observation 与 Decision 白名单完全一致；只发送引用都在这份白名单内的本角色 Belief，最多 64 条。Claim 必须有本次所选合法 Claim 类 Observation；Goal 只带当前主体登记且来源仍在所选观察中的条目。离开区域保留合法历史知识，当前不可见对象从当前视野移除。裁剪不把其他主体资料补入上下文，也不通过摘要模型读取未过滤内容。

当前 `visible-objectives-v1` 策略有两个确定性来源：

- 当前投影公开的 objective，保留其目标含义。
- 有 inspect 能力时，对当前可见目标建立“核查当前状态”的目标；合法亲自检查取得与当前字段一致的 Observation 后，目标改为 completed。以后可见状态或其资源版本真实变化时重新评估。

策略在每次原子准备时刷新，只有标签、状态或实际来源含义变化才增加 Goal revision／事件；全局序号增长不单独算目标变化。来源水位明确表示最近确认依据，不把模型预算耗尽后的旧目标当作实时全知状态。离开后保留已获知的目标及来源，不猜测隐藏对象的新状态。终局后不追加 GoalUpdated；最终展示由既有 ending 派生。没有给模型添加 goalUpdates 权限，也没有扩展两位 NPC 的人格、分歧或剧情策略。

## Model Gateway 契约

构造参数是 `{provider, modelId, timeoutMs?, maxContextBytes?, externalAuthorization?}`。适配器必须给出 `providerId`、`kind: 'controlled' | 'external'` 和异步 `generate(input, {signal})`，返回 `{rawText}`。适配器只收到：

- 明确模型标识、固定版本的中文约束及已过滤上下文。
- 从共享协议取得的 ProposedIntent JSON Schema。
- 本次超时和 64 KiB 输出上限。

它拿不到 Runtime、数据库或 WorldEvent 写入口。原文直接交给共享严格解析器，拒绝非法 JSON、重复键、未知工具／字段、不完整 Unicode、错误 decisionId 及 AI 私人频道；通过后保留原文和覆盖整包的语义摘要。模型给出的事实文字仍只是 Claim／Belief，世界改变只能由原 Validator 生成。

默认单次超时 10 秒，上下文最多 256 KiB；实际超时取配置和 Decision 剩余时间的较小值。Gateway 与 Abort 竞争，吸收忽略 Abort 的迟到完成／拒绝；关闭不等待未返回的供应商 Promise。适配器须管理它自己创建的网络资源；本实现没有创建供应商网络连接。Gateway 的指标区分有效格式、无效格式、超时、取消与供应商错误，提供最近至多 4096 次调用的 p50／p95；这些是运行观测，不是新性能 SLO。

`external` 模式必须由可信集成方传入真实授权记录引用和正整数 `maxCalls`，且仍受调度器本局预算约束。这个参数是已有授权的输入位置，不会自动取得费用许可。当前没有任何供应商 SDK、默认 endpoint、凭证发现或外部模型适配器；默认 `npm start` 不启用 AI。

## 调度、提交和恢复

`new AIOrchestrator({runtime, gateway, maxConcurrent: 2, minIntervalMs: 1000, maxCallsPerSession: 60})` 默认只注册显式传入的可信角色。`watch(handle)` 先恢复旧结果，再准备一个新决定。每角色至多一个在途任务，多次通知合并为一次唤醒；全局并发有界，供应商请求结束后保留完整的最小间隔。Session 行锁不覆盖模型推理，其他玩家可在模型未返回时取得 Receipt。

本局预算统计持久 `ai_runs` 预留，包含崩溃后尚未实际派发的预留，因而采用保守上限；重启不能重置该预算。Gateway 的调用指标与持久预留数分别解释，不能把预留都声称为实际模型调用。预算用尽时状态为 `BudgetExhausted`，不再请求模型。部署保持一个调度器实例负责同一角色；跨进程的世界效果仍由数据库 epoch、generation、期限、版本和 Receipt 围栏保护，本票没有部署分布式调度服务。

事件通知只作唤醒／取消提示，不直接充当 prompt，也不把通知顺序当权威水位。旧控制事件只有在其 epoch 高于当前在途 Decision 时才取消；实际提交继续重读数据库。代理只得到安全移动、inspect、公开问询与 wait，不继承真人私人频道，也不能转移／消耗、许可通行、进入终局区域或作不可逆选择。

每次有效输出在提交前保存原文与摘要，然后以原 `decisionId:submit` 走统一 Validator。批首比较外部读版本，批内继续使用候选状态；第二工具失败会回滚第一工具及对白。重复回调读旧 Receipt；同键异内容不覆盖原记录。

`OUTCOME_UNKNOWN` 保留原 ID、原文和摘要。下一次恢复先做当前读权检查，查询同键 Receipt 并比摘要；尚无 Receipt 时只重试同一原文，不能直接改成拒绝、fallback 或新 ID。自动调度最多连续进行三次间隔恢复，仍未知时保留 Unknown，等待显式 `wake` 或后续合法通知；这个次数限制不把未知改写成失败。

Rejected／Expired 的 fallback 从持久 Decision 和缺失 Receipt 推导，使用固定 `decisionId:fallback` 和原 epoch，走原等待命令及当前权限／终局检查。Cancelled／Committed 不安排失败 fallback。供应商超时若早于权威 Decision deadline，记录 Rejected；到达权威 deadline 才记录 Expired。恢复时无输出的 Pending 可取消并另起新计划，不复活旧 ID；有原文的提交未知优先恢复结果。

仅恢复旧工作时使用：

```js
orchestrator.watch(handle, { wake: false, autoWake: false });
await orchestrator.recover(handle);
```

`wake: false` 只关闭初次唤醒，`autoWake: false` 另外关闭事件自动触发。纯恢复仍重新授权，并保持未知状态及原原因键。完成后调用 `close()`，停止监听、定时器和排队任务，取消未提交推理并等待已接纳的收束操作；迟到 provider 结果不会再次提交。关闭顺序为 Orchestrator → 服务端 Runtime／HTTP／Socket.IO → pg Pool。

## 受控运行示例

以下组合已有真实 PostgreSQL／HTTP 服务和**明确标为 controlled 的等待适配器**。它只用于接口联调，不是实际模型闭环。需要 `DATABASE_URL`、已有 Running Session 的 `AI_SESSION_ID` 和从其合法内容选定的核心角色 `AI_ACTOR_ID`；没有读取其他环境变量或发现凭据的代码。

```sh
node --input-type=module <<'JS'
import pg from 'pg';
import { createAuthorityServer } from './backend/server.mjs';
import { ModelGateway } from './backend/ai/gateway.mjs';
import { AIOrchestrator } from './backend/ai/orchestrator.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const server = await createAuthorityServer({ pool });
const gateway = new ModelGateway({
  provider: {
    kind: 'controlled', providerId: 'controlled-local',
    async generate({ context }) {
      return { rawText: JSON.stringify({
        decisionId: context.decision.decisionId, toolCalls: [{ kind: 'wait' }],
      }) };
    },
  },
  modelId: 'controlled-wait-v1',
});
const ai = new AIOrchestrator({ runtime: server.runtime, gateway, maxCallsPerSession: 3 });
const handle = await server.runtime.bindInternal(process.env.AI_SESSION_ID, process.env.AI_ACTOR_ID, 'core_npc');
ai.watch(handle);
await server.listen(3000);
let stopping;
const stop = () => stopping ??= (async () => {
  await ai.close(); await server.close(); await pool.end();
})();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
JS
```

受限代理使用同一 Runtime 的 `bindInternal(sessionId, actorId, 'proxy')`，保留可信句柄并注册；权限来自当前角色模式，不来自示例参数。实际模型接线需先明确供应商／endpoint／模型标识、适配器、凭证引用和费用预算，再单独运行真实模型检查并归档；本候选没有代填这些输入。

## 检查与模型义务

```sh
npm run test:ai
npm run test:backend
```

检查用真实 PostgreSQL 和真实 HTTP／Socket.IO，供应商使用受控异步函数。`ai-crash.test.mjs` 在父进程持有数据库期间 fork 子进程，实际 `process.exit` 后创建新 Runtime 恢复；抛异常场景与真实退出分开归档。故障注入只通过可信构造参数／测试 IPC，不暴露网络开关。

已释放的 visibility／fallback 依据固定在 `2a23c6ea31ea04dee9271612afe9c4248e93efb9`：本实现把过滤、原子包、批首版本、代次／epoch／期限、稳定 fallback 键和终局围栏落实到实际模块及检查。没有修改协议、正式模型、内容或 Spec，也没有把有限模型检查冒充真实运行。正式证据说明每个义务的对应、自查失败历史、受控指标及未运行边界。
