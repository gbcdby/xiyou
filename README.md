# xiyou

《西游记》题材的多人实时 AI 协作游戏。唐僧与孙悟空是跨关持续存在的核心 AI NPC；每局最多 5 位真人扮演本关配角，通过调查、交涉、信息传播与实际行动共同解决阻碍。

## 从这里开始

| 想了解什么 | 阅读 |
| --- | --- |
| 当前做到哪里、接下来做什么 | [项目现状与路线](docs/project-status.md) |
| 产品玩法与总体技术设计 | [初步设计文档](初步设计文档.md) |
| 首个可玩切片怎么实现和验收 | [VS-001 Spec](docs/specs/vertical-slice.md) |
| 本轮模拟运行结果与证据 | [模拟切片验收](frontend/evidence/mock-integration-20261111/README.md) |
| 文档分别负责什么 | [文档索引](docs/README.md) |
| 工程约定与验证要求 | [工程约定](docs/engineering.md) |
| 按技能包推进任务 | [项目工作流](docs/agents/workflow.md) |
| 美术与通用 UI/UX 方向 | [设计资料](docs/design-direction/README.md) |
| Agent 开始工作前的规则 | [AGENTS.md](AGENTS.md) |

## 当前阶段

截至 2026-11-11，仓库已包含 M0–M4 首个机制切片的协议、有限模型、PostgreSQL 权威服务、Vue 联机界面、受控双 NPC 策略、证据详情与终态授权复盘。当前采用 [mock-20261111 验收修订](docs/specs/vertical-slice-mock.md)：玩家与模型输入可以模拟，权限、规则、事务、事件、网络和浏览器仍实际运行。

固定候选、实际检查与合并状态以 [Spec 汇总 #2](https://github.com/gbcdby/xiyou/issues/2)及[最终验收 #12](https://github.com/gbcdby/xiyou/issues/12)为准。真实模型质量、真人体验和公网部署尚未执行；模拟结果不替代这些结论。[项目现状](docs/project-status.md#当前基线)保留初始检查与当前实现的区别。

## 本机运行模拟切片

需要 Node.js 24 或更高版本及可连接的 PostgreSQL。先按[服务端说明](backend/README.md#技术选择与启动)配置本机 `DATABASE_URL`，在仓库根目录安装依赖并启动明确标注为“模拟角色策略”的服务：

```sh
npm ci
npm run start:mock
```

另开终端启动前端：

```sh
cd frontend
npm ci
npm run dev
```

打开开发服务器显示的本机地址，以不同浏览器身份创建或加入房间，2–5 人即可开局。唐僧与悟空使用确定性受控 provider；所有行动仍经正式校验器。默认 `npm start` 只启动权威服务，双角色策略的行为与启动边界见[模拟策略说明](backend/ai/mock.md)。

## 工作记录

后续代码、任务与 PR 统一使用 [GitHub 仓库](https://github.com/gbcdby/xiyou)、[Issues](https://github.com/gbcdby/xiyou/issues) 和 [Pull requests](https://github.com/gbcdby/xiyou/pulls)。Spec 正文进入版本管理，任务状态与验收证据按[记录约定](docs/agents/issue-tracker.md)关联。

核心约束：**LLM 提出意图，服务端规则决定世界事实，事件日志记录已发生的事情。**
