# AGENTS.md

《西游记》多人 AI 协作游戏。本文件只放必须常驻的约定；细节按任务读取。

## 工作入口

- 当前阶段与下一步：[项目现状](docs/project-status.md)。
- 产品与总体技术依据：[初步设计文档](初步设计文档.md)；细化后的有效 Spec 从 [Spec 索引](docs/specs/README.md)进入。
- 工程约定：[docs/engineering.md](docs/engineering.md)。
- Agent 工作开始前：[项目工作流](docs/agents/workflow.md)；需要任务操作时读 [GitHub 记录约定](docs/agents/issue-tracker.md)，写文档时读 [文档布局](docs/agents/doc-layout.md)。
- 界面与美术任务：[设计资料](docs/design-direction/README.md)。

用户在 2026-11-11 明确：**Gitee 已废弃，后续统一使用 GitHub**。不得把旧平台访问、旧票据或旧技能入口作为新工作的前置门槛。已有设计材料按当前仓库继续复用，历史完成声明须有对应证据。

用户当前明确决定优先于旧文档；详细 Spec 必须注明依据与状态，不能靠拆票或实现静默改变总设计。总设计与工程文档冲突时，以总设计的产品行为为准，记录冲突并修正受影响的约定。

## 铁律

> LLM 决定角色意图，状态机约束人格与目标，规则引擎决定世界事实，事件日志决定过去。

1. **LLM 输出永远不是 WorldEvent**，只能是 `ProposedIntent`/tool call；经 Rule Validator 校验后才落地。
2. **严格区分 WORLD FACT / NPC BELIEF / NPC CLAIM**；世界不因 NPC 相信而改变，`beliefUpdates` 不得直接入库。
3. **NPC 只感知其有资格感知的事件**，不得偷看秘密、其他房间或未来剧情。
4. **服务端权威**：客户端只持有 `snapshot + confirmed events + 乐观 UI`，按单 Session 的权威顺序号应用。
5. **所有权唯一且幂等**；Action 带 `clientActionId`，重发无副作用。
6. **NPC 必须能拒绝玩家**；承诺（Promise）≠ 执行（做到了）。
7. **AI 不阻塞房间**；异步推理，超时与非法 tool JSON 有 fallback。
8. **Prompt 不是秘密边界**，权限由服务端实现。

## 硬性约定

- **语言**：注释、提交说明、文档、日志、回复一律中文；专业名词保留原文。标识符与新增文件名用英文。
- **临时文件**：所有 Agent 的临时产物、日志、截图只写 `.agent-output/<agent-or-task>/`；正式产物放对应目录，不引用临时目录。
- **证据**：计划、设计示例、静态检查、TLC、运行验收和实际合并分别报告。不得把其他项目的 PR、旧检查或缺失素材写成 xiyou 当前成果。
- **改动前**：代码任务读工程约定，界面任务加读设计资料。复用本次范围内仍有效的授权、决定与检查，不重复要求初始化或确认。
