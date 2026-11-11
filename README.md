# xiyou

《西游记》题材的多人实时 AI 协作游戏。唐僧与孙悟空是跨关持续存在的核心 AI NPC；每局最多 5 位真人扮演本关配角，通过调查、交涉、信息传播与实际行动共同解决阻碍。

## 从这里开始

| 想了解什么 | 阅读 |
| --- | --- |
| 当前做到哪里、接下来做什么 | [项目现状与路线](docs/project-status.md) |
| 产品玩法与总体技术设计 | [初步设计文档](初步设计文档.md) |
| 文档分别负责什么 | [文档索引](docs/README.md) |
| 工程约定与验证要求 | [工程约定](docs/engineering.md) |
| 按技能包推进任务 | [项目工作流](docs/agents/workflow.md) |
| 美术与通用 UI/UX 方向 | [设计资料](docs/design-direction/README.md) |
| Agent 开始工作前的规则 | [AGENTS.md](AGENTS.md) |

## 当前阶段

截至 2026-11-11 检查的代码基线，仓库包含设计文档、工程约定与技能包，尚无游戏应用代码或可运行的本仓库协议模型。检查对象与证据边界见[项目现状](docs/project-status.md#当前基线)。

下一项工作是形成**首个可玩切片的 Spec**，明确 M0–M4 的范围，并优先收敛 M0 协议；随后按既定路线完成无 AI 联机房间、单 AI、双 AI 与第一个机制关。

## 工作记录

后续代码、任务与 PR 统一使用 [GitHub 仓库](https://github.com/gbcdby/xiyou)、[Issues](https://github.com/gbcdby/xiyou/issues) 和 [Pull requests](https://github.com/gbcdby/xiyou/pulls)。Spec 正文进入版本管理，任务状态与验收证据按[记录约定](docs/agents/issue-tracker.md)关联。

核心约束：**LLM 提出意图，服务端规则决定世界事实，事件日志记录已发生的事情。**
