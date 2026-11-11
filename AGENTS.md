# AGENTS.md

《西游记》多人 AI 协作游戏。本文件只放**必须常驻**的约定；细节一律在 `docs/` 中，按需读取，不要一次全读。

- 产品与技术设计：[初步设计文档.md](./初步设计文档.md)（冲突时以它为准）
- 工程约定：[docs/engineering.md](./docs/engineering.md)（技术栈、目录、领域命名、测试、IP）
- 设计资料：[docs/design-direction/README.md](./docs/design-direction/README.md)（美术与 UI/UX，按需自取）
- Agent 流程配置：[docs/agents/](./docs/agents/)（issue tracker、triage 标签、文档布局——任何工程流程开始前先读）

## 铁律

> LLM 决定角色意图，状态机约束人格与目标，规则引擎决定世界事实，事件日志决定过去。

1. **LLM 输出永远不是 WorldEvent**，只能是 `ProposedIntent`/tool call；经 Rule Validator 校验后才落地。
2. **严格区分 `WORLD FACT` / `NPC BELIEF` / `NPC CLAIM`**；世界不因 NPC 相信而改变，`beliefUpdates` 不得直接入库。
3. **NPC 只感知其有资格感知的事件**，不得偷看秘密、其他房间或未来剧情。
4. **服务端权威**：客户端只持有 `snapshot + confirmed events + 乐观 UI`，按 `sessionSeq` 应用。
5. **所有权唯一且幂等**；Action 带 `clientActionId`，重发无副作用。
6. **NPC 必须能拒绝玩家**；承诺（Promise）≠ 执行（做到了）。
7. **AI 不阻塞房间**；异步推理，超时与非法 tool JSON 有 fallback。
8. **Prompt 不是秘密边界**，权限由服务端实现。

## 硬性约定

- **语言**：注释、提交说明、文档、日志、回复一律中文；专业名词保留原文（`WorldEvent`、`sessionSeq`、`TLA+` 等）。标识符与文件名用英文。
- **临时文件**：所有 Agent 的临时产物、日志、截图只写 `.agent-output/<agent-or-task>/`，不散落仓库根目录；正式产物放对应目录，不引用 `.agent-output/`。

## 改动前必读

改代码前读 [docs/engineering.md](./docs/engineering.md)；涉及界面改 [docs/design-direction/](./docs/design-direction/README.md)。
