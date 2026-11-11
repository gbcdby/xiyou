# 工程约定

供实现与审查时按需读取。总入口见 [AGENTS.md](../AGENTS.md)，产品与技术依据见 [初步设计文档](../初步设计文档.md)，当前阶段见 [项目现状](project-status.md)。

## 技术栈

- 前端：Vue 3 + TypeScript + Vue Router + Pinia（或等价轻量状态库），SFC 组件化。
- 实时：Socket.IO/WebSocket，按 room 广播；HTTP 用于登录、房间列表、历史查询。
- CRDT/Yjs：仅用于「允许并发合并」的子系统（共享笔记、白板），**绝不承载**权威世界状态。
- 后端：语言不锁定，优先开发效率。首版物理部署从简：`game-api`、`ai-worker`、`postgres`、`redis`；代码内部按模块隔离，**不要提前拆微服务**。
- 数据：PostgreSQL 存最终状态与事件索引（`jsonb` 存半结构化状态/payload）；Redis 只放短生命周期实时数据（presence、fan-out、短期锁、推理队列），**不存完整世界事实**。
- AI：业务代码统一走 `Model Gateway` 接口，不直接绑定任何模型厂商 SDK。

## 目录结构

以下是目标结构，按里程碑逐步建立，不表示这些模块已经存在。M0 首批模型以总设计的 Ownership / RoleHandoff 为重点，其他模型随相关协议范围推进。

```text
/game        领域模型、事件目录、动作目录、NPC 状态、记忆 schema、权限模型
/protocol    HTTP API、WebSocket 事件、AI 工具 schema
/formal      按阶段建立 SessionLifecycle、Ownership、RoleHandoff、Reconnect、SecretVisibility、Commitment 等模型
/frontend    Vue 应用外壳、世界视图、对话面板、队伍面板、实时客户端
/backend     session、world、规则校验器、事件日志、AI 编排器
/content     关卡 schema、角色 schema、目标 schema、终局条件
```

前端模块按 `features/` 划分（lobby、session、character、dialogue、world、inventory、objective、recap）；领域类型放 `domain/`（world、character、event、action），`domain/` 不依赖视图层。目录名与文件名用英文，其中的说明用中文。

## 领域命名

- 三个 ID 必须分清：`UserId`（真人账号）、`CharacterId`（本关角色）、`SessionId`（本局实例）。NPC 认识 `CharacterId` 不等于认识 `UserId`。
- 事件顺序号在单个 Session 内全局有序；状态推进严格为 `State[n+1] = Reduce(State[n], Event[n+1])`。总设计的示例字段 `seq` 与文字中的 `sessionSeq` 表达同一概念，正式 wire schema 命名由 M0 Spec 统一，不假定已经存在两套序号。`eventId` 的示例为 `E1009`，最终唯一性范围一并写入协议。
- 角色控制权：`HumanControlled → GracePeriod → AIProxyControlled → HumanControlled`。托管 AI 继承已知内容/位置/物品/承诺，但**禁止**重大不可逆决策、泄露玩家私人频道、擅自消耗关键物品。总设计保留的“维持游戏必需行为”例外仍需 Spec 定义可判断的范围；不能由模型临场解释该例外来绕过校验。
- 时间：`expireAt`、`seq` 等一律以服务端为准。

## 工程边界

- **机制与故事解耦**：六类交互能力是整体方向，按 [M0–M6 路线](project-status.md#开发路线)逐步实现可复用机制。先验证“信任与证据 + 纠纷解决”，第二关成立后再扩展；不要求第一关前完成全部六类能力。
- **关卡走配置**：通过 `content/` 下的人物、场景、权限、知识、目标、终局条件配置实现，不写六套程序。
- **不擅自引入**新框架、消息中间件或微服务拆分；确需引入时先说明动机与替代方案。

## 测试要求

新增并发/实时/NPC 逻辑时至少覆盖：并发抢同一物品、重复请求、中途掉线、重连与托管交还、事件乱序、AI 幻觉、提示注入、跨房间偷看、模型超时、非法 tool JSON。

涉及所有权、角色交接、重连的协议改动，同步更新 `/formal` 下的 TLA+ 规格，并从极小状态空间跑 TLC。使用当前 [`worker-tla`](../.agents/skills/worker-tla/SKILL.md) 的方法，保留模型、实现对应与真实执行证据。修改协议语义时先更新相关 Spec 与模型，再使实现满足其义务；简单文档整理不要求运行无关的 TLC。

**未经 TLC 验证的规格不得声称已证明；反过来，TLC 跑绿也不等于已证明。** 本项目把可证伪性作为模型验收条件，不仅检查退出码。旧稿中的实验叙述没有随当前仓库提供原始模型与日志，不能当作本项目本轮实测。因此任何“已验证”的结论必须同时报告：

- 常量规模（如 `Item = {i1, i2}`）
- 每个不变量的**负对照**：一个必然破坏它的缺陷配置，且该配置确实报出 `rc=12`
- 实际探索的 distinct state 数，且不低于声明的下限
- 是否 BFS、是否查死锁、是否检查 liveness
- **没有覆盖什么**

少而可证伪，胜过多而恒真。

## IP 与合规

- 只使用古典原著、公版文本与团队原创表达；禁止复刻现代影视/动漫/游戏的人物造型、对白、配乐、UI、资产。
- 新资产登记 `asset_source`：`original_team` / `classical_public_domain_reference` / `licensed_asset`。
- 赛事规则以登录后的官方页面为准，不把第三方转载的未核实规则写进代码或文档。
