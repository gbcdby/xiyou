# 双角色模拟策略与启动

归属 [#10](https://github.com/gbcdby/xiyou/issues/10)，依据 [VS-001 模拟输入验收修订](../../docs/specs/vertical-slice-mock.md) `3690b481d1805f6a7b535584c80a8574c5103d97` 的 §2—3、§5，验收 profile 为 `mock-20261111`。本模块提供可运行的确定性角色策略；独立审查、整局矩阵及实际合并状态由关联 Issue／PR 记录。真实模型质量、真人体验和公网部署均不由这些策略检查推导。

## 启动与集成

安装根目录固定依赖并准备 PostgreSQL 后执行：

```sh
DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/xiyou' npm run start:mock
```

默认监听 `127.0.0.1:3000`，支持原有 `HOST`、`PORT`；日志明确标注“模拟角色策略”。入口运行实际 HTTP／Socket.IO、权威 Runtime、ModelGateway 和 AIOrchestrator，不读取模型密钥、不调用外部供应商。普通 `npm start` 保留原有入口。

启动层扫描已有 Running 房间，并监听实际提交为新开局登记唐僧和悟空。绑定表仅含受信角色 ID 和策略版本；只有会话 ID 用于可信启动层查询，数据库句柄、内容快照、真人凭据和世界状态均不传入 provider。Lobby 和终态不创建新的角色调用；启动层的登记动作不增加公开协议或世界事件。

可复用的生产接口如下：

```js
import { createAuthorityServer } from './backend/server.mjs';
import { attachMockAI } from './backend/ai/mock-runtime.mjs';

const server = await createAuthorityServer({ pool });
const ai = await attachMockAI({ runtime: server.runtime });
await server.listen(3000);
// 调用方结束时停止登记、推理及服务，最后关闭自己持有的 pool。
await ai.close();
await server.close();
```

`attachMockAI({runtime, minIntervalMs = 1000, maxCallsPerSession = 120, log?})` 返回 `{status(), close()}`。每个角色策略有自己的 Gateway／Orchestrator，分别最多一个并发任务，两个策略合计最多两个。每角色请求完成后至少间隔 1000 ms；启动层只按事件发生时的核心 NPC 受众合并唤醒，目标刷新不单独唤醒。远处或仅向真人授权的观察不会让等待中的另一角色消耗预算；事件原文不进入 provider，推理前仍由 Runtime 构造合法上下文。空闲时不轮询生成对白。120 次是整局两个角色共享的持久预留预算，读取现有 `ai_runs`，不是每个角色或每次重启重新领取。可信集成方可以显式设置正整数间隔和预算。

`createMockServer({pool, now?, hooks?, minIntervalMs?, maxCallsPerSession?, log?})` 由 [mock-main.mjs](../mock-main.mjs) 导出，组合上述两个接口并返回 `{runtime, ai, listen(), close()}`；pool 仍归调用方。它在关闭时停止角色登记、取消在途推理，并等待权威服务和 AI 收束。命令入口拥有自己的 pool，额外等待已接入 PostgreSQL 客户端的真实 `end` 事件，随后进程正常退出。旧输出恢复、未知 Receipt 查询、原决定去重和预算约束均复用 [单 AI 运行边界](README.md)，不重置原意图身份。

## 策略与知识边界

[mock-provider.mjs](mock-provider.mjs) 无数据库、内容、文件或 Runtime 依赖，也没有会话缓存。`createMockProvider('tangseng' | 'wukong')` 只消费本次 Gateway 的 `current`、`memory`、Decision 和允许工具；同样的合法输入产生相同原文。该策略只接受对应核心 NPC 的主体，不能用于代理继承核心权限。

| 角色 | providerId / modelId / policyVersion | 行为优先级 |
| --- | --- | --- |
| 唐僧 | `controlled-tangseng` / `tangseng-safety-v2` / `tangseng-safety-v2` | 核对来源、安全与许可；拒绝未经实际确认的通行，建议自愿协调、实际修复及职责人许可；新依据改变公开方案 |
| 孙悟空 | `controlled-wukong` / `wukong-inspection-v2` / `wukong-inspection-v2` | 优先亲自检查可见材料和现场；展示带来源的证据；不因口头指责定责，不因声称修好而跳过实际条件 |

策略识别当前内容公开字段的含义，例如 `safe/permit`、损坏时间记录与现场痕迹、合法搬运记录与现场标记；不硬编码全局对象或终点 ID。核验结论至少要求两个不同字段的合法 Evidence 来源，且来源集合互不重叠；同一来源的重复分享不能充当独立印证。新结论生成实际 Claim、引用本次 Observation 白名单的 BeliefProposal，以及证据展示或合法检查。Claim 与 Belief 不修改世界事实。

已发表的己方 Claim 只用于避免机械重复；它不证明承诺已经执行。物品、目标、可见出口和资源版本始终来自本次合法输入，动作仍受原 Decision 版本、epoch、generation、期限与 Validator 约束。策略不取走关键材料、不执行最终修复或授予许可，这些行动留给玩家。

玩家可以公开或定向建议 **`出口 <当前可见的出口 ID>`**，也可以说“请从出口 <ID> 通行”。策略先完成新证据解释和必要安全核对，再优先执行明确合法路线，随后才做其余可见物检查和普遍证据展示。只考虑最新的路线陈述；它已由实际 `self.regionId` 确认抵达、或目前不是合法可见出口时，不回退旧陈述引发往返。未知路线会转为询问玩家。建议只选择当前授权 `regions.exits` 中的对象；陈述不充当安全事实。通路口的策略必须先看到 `safe=true` 与 `permit=true`，再输出实际 move，规则引擎仍重新检查通行条件。没有硬编码隐藏出口，也不依据测试编号选择结局。

普遍展示把同一来源合并分享给尚未展示过的当前同行者，以一次正常定向 Claim 和一次 `share_evidence` 完成。己方定向 Claim 的 `recipientIds` 只用于避免重复展示，保留原 Observation 的来源，不将多接收者算成多个独立证据。没有新缓存或存储字段，也没有增加预算。

## 验证范围

```sh
node --test backend/tests/ai-mock-*.test.mjs
npm run verify:mock
npm run test:backend
```

针对性测试通过真实 PostgreSQL 和现有权威入口建立合成会话，覆盖不同初始信念／视野、完整输入隔离、同说法下的独立来源变化、拒绝与替代、公开方案和随后合法工具、玩家实际修复／许可前后的移动边界、新开局／重启登记、原意图只提交一次及持久预算。故障组合使用测试侧适配器控制 Promise 或返回非法 JSON，实际角色策略没有故障开关。

`verify:mock` 启动与 `start:mock` 相同的独立生产进程，经正式 HTTP／Socket.IO 创建、加入、控制和开始新房间。Running 后不再发送玩家动作，观察至少 60000 ms 真实单调时间；每角色须有与 active Goal 关联的 Accepted 检查、证据展示或移动事件。检查保留输入摘要、Decision、Receipt、事件范围、配置版本和前后源码摘要，并确认 SIGTERM 后进程、监听及自有数据库连接关闭。它使用本轮新合成输入，不复用历史原始 trace，不把 60 秒检查当作五身份 900 秒或完整切片验收。

本模块继承的单 AI 非法输出、Unknown、稳定 fallback、控制交还和崩溃恢复检查，仍以原候选和源码边界解释。双角色组合另实际检查非法／超时期间玩家可继续操作、终局取消后的两个迟到输出无效、原决定不重复收束。最终同一集成候选的 #12 验证矩阵、独立需求／标准审查及合并由总控继续完成。

当前作者自查与保留的修正前反例见[模拟角色检查归档](../evidence/mock-ai-20261111/README.md)。这份归档不代替独立需求／标准复审或最终同候选集成结果。
