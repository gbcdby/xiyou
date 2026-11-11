# 工程约定

从原 AGENTS.md 拆出，供改代码时按需读取。总入口见 [../AGENTS.md](../AGENTS.md)，产品与技术依据见 [../初步设计文档.md](../初步设计文档.md)。

## 技术栈

- 前端：Vue 3 + TypeScript + Vue Router + Pinia（或等价轻量状态库），SFC 组件化。
- 实时：Socket.IO/WebSocket，按 room 广播；HTTP 用于登录、房间列表、历史查询。
- CRDT/Yjs：仅用于「允许并发合并」的子系统（共享笔记、白板），**绝不承载**权威世界状态。
- 后端：语言不锁定，优先开发效率。首版物理部署从简：`game-api`、`ai-worker`、`postgres`、`redis`；代码内部按模块隔离，**不要提前拆微服务**。
- 数据：PostgreSQL 存最终状态与事件索引（`jsonb` 存半结构化状态/payload）；Redis 只放短生命周期实时数据（presence、fan-out、短期锁、推理队列），**不存完整世界事实**。
- AI：业务代码统一走 `Model Gateway` 接口，不直接绑定任何模型厂商 SDK。

## 目录结构

```text
/game        领域模型、事件目录、动作目录、NPC 状态、记忆 schema、权限模型
/protocol    HTTP API、WebSocket 事件、AI 工具 schema
/formal      SessionLifecycle.tla、Ownership.tla、RoleHandoff.tla、Reconnect.tla、SecretVisibility.tla
/frontend    Vue 应用外壳、世界视图、对话面板、队伍面板、实时客户端
/backend     session、world、规则校验器、事件日志、AI 编排器
/content     关卡 schema、角色 schema、目标 schema、终局条件
```

前端模块按 `features/` 划分（lobby、session、character、dialogue、world、inventory、objective、recap）；领域类型放 `domain/`（world、character、event、action），`domain/` 不依赖视图层。目录名与文件名用英文，其中的说明用中文。

## 领域命名

- 三个 ID 必须分清：`UserId`（真人账号）、`CharacterId`（本关角色）、`SessionId`（本局实例）。NPC 认识 `CharacterId` 不等于认识 `UserId`。
- 事件 `seq` 为单 session 内的全局顺序号，`eventId` 形如 `E1009`；状态推进严格为 `State[n+1] = Reduce(State[n], Event[n+1])`。
- 角色控制权：`HumanControlled → GracePeriod → AIProxyControlled → HumanControlled`。托管 AI 继承已知内容/位置/物品/承诺，但**禁止**重大不可逆决策、泄露玩家私人频道、擅自消耗关键物品。
- 时间：`expireAt`、`seq` 等一律以服务端为准。

## 工程边界

- **先机制后故事**：关卡故事与机制实现解耦，先交付六类交互能力（纠纷化解、信任与证据、多人协同、承诺与选择、身份验证、谈判与执行），再写具体章节。
- **关卡走配置**：通过 `content/` 下的人物、场景、权限、知识、目标、终局条件配置实现，不写六套程序。
- **不擅自引入**新框架、消息中间件或微服务拆分；确需引入时先说明动机与替代方案。

## 测试要求

新增并发/实时/NPC 逻辑时至少覆盖：并发抢同一物品、重复请求、中途掉线、重连与托管交还、事件乱序、AI 幻觉、提示注入、跨房间偷看、模型超时、非法 tool JSON。

涉及所有权、角色交接、重连的协议改动，同步更新 `/formal` 下的 TLA+ 规格，并从极小状态空间跑 TLC。用 [`tla-verify`](../.agents/skills/tla-verify/SKILL.md) 技能执行，不要手搓验证流程。

**未经 TLC 验证的规格不得声称已证明；反过来，TLC 跑绿也不等于已证明。** TLC 对"前件永假"的真空不变量同样输出 `No error has been found` 并返回 0，与真正成立的不变量无法从退出码区分（已实测：真空用例只探索到 1 个状态）。因此任何"已验证"的结论必须同时报告：

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
