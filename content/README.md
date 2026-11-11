# 首个机制场景的内容准备

归属 [Ticket #11](https://github.com/gbcdby/xiyou/issues/11)，依据固定 Spec `6c2a0b9f6d137ad5fbd41721659404333ad8e16d` 的[玩法规格](../docs/specs/vertical-slice-gameplay.md)与 [M0 协议](../docs/specs/m0-protocol.md)。消费已经独立审查的协议候选 `3394ad9a699d33dcb5afcf890427a23595d1a6dc`。

当前仅完成内容结构、版本化 fixture、人数职责装配和静态检查。没有权威世界提交、NPC 决策、联机完整局或真人试玩结论；#11 的完整交付继续等待其运行层、界面和真实 AI 依赖。

## 文件与接口

| 入口 | 用途 |
| --- | --- |
| `schema.mjs` / `content.schema.json` | 唯一结构来源及生成的 JSON Schema 2020-12 |
| `fixtures/trust-repair-fixture-v1.json` | 当前原创机制配置，包括私有调查材料和未公开事实 |
| `validate.mjs` | 严格结构与静态引用校验，不执行世界动作 |
| `versions.json` | 内容版本、reducer 版本及规范 SHA-256 |
| `index.mjs` | `loadContent`、`validateContent`、`rolesForPlayers`、`assemblePlayers`、`contentDigest` 服务端入口 |

完整配置是**服务端资料**。浏览器、代理和 Model Gateway 只能获得各自授权投影，不能导入本目录后在界面中隐藏秘密。知识模板也不是已登记 Observation：必须由实际初始授权、检查或合法传播产生观察记录并绑定来源游标。

`loadContent(version)` 只读取受控注册表中的路径，核对配置版本、规则版本与摘要，再返回深冻结副本。`rolesForPlayers(content, count)` 返回可独立使用的职责组合；仅在开局时按固定成员数装配，断线不再次按在线人数调用。未知版本不会作为文件路径使用。

`assemblePlayers(content, count)` 是运行层的完整开局装配入口，每个人数槽位只返回一个角色配置。固定 `partyRoles` 数组的**首项职责决定唯一出生区域**，所有职责的能力和初始知识取保留顺序的去重并集，名称组合显示全部职责。职责中的其他 `initialRegionId` 仅是该职责单独成槽时的默认区域，不代表角色同时存在于多个位置。

| 人数 | 按固定成员顺序的职责与唯一出生区域 |
| --- | --- |
| 2 | A+D：通路口；B+C+E：材料间 |
| 3 | A+D：通路口；B：材料间；C+E：通路口 |
| 4 | A：通路口；B：材料间；C+E：通路口；D：侧路 |
| 5 | A：通路口；B：材料间；C：通路口；D：侧路；E：材料间 |

开局时将每个槽位绑定到唯一 `CharacterId` 并保存装配结果。该规则补全准备阶段的消费契约，fixture 与注册摘要未改变，也不存在已运行的局需要迁移；运行中不得重算或更改，之后改变此装配语义需要新 reducer 版本。知识 ID 仍只是待授权模板，实际 Observation 必须由权威初始化事件登记。

## 配置约束与版本

- 五项职责按 Spec 的 2/3/4/5 人组合完整分配，每项恰好一次；组合属于一个角色，不创建可切换的多个角色。
- 三处可交互场所为通路口、材料间、侧路；`destination` 仅表示越过通路后的终点，不增加第四个调查场景。
- 原材料在侧路，D 的能力允许取回；备用材料和工具初始绑定 B 职责的实际角色。工具不消耗，材料各有唯一初始位置。
- `repair` / `grant_passage` 是通用机制操作配置。修复需要材料和工具，许可需要相应职责；两者均声明最终操作必须由真人执行。配置声明不能替代服务端校验。
- 两组证据分别使用结构记录/现场痕迹、登记记录/材料现场。各卡来源独立；复制或重复转述不会凭此获得另一来源。实际查证还需来源核验与合法投递，不能只读配置认定 NPC 已知。
- 初始信念与知识分开。信念只能引用该 NPC 的初始知识，本身不能生成通路安全、物品或责任事实。
- 默认时限 20 分钟、宽限 30 秒、决策超时 10 秒；当前配置结构限制局长在既定 15—30 分钟范围。

`validateContent` 除结构外拒绝悬空引用、重复标识、缺失职责、未分配能力、无合法依据的初始信念、重复来源和不一致操作关系。跨语言消费者需要补齐这些关系检查；仅通过 JSON Schema 不构成运行规则正确性。

内容摘要采用协议的 UTF-16 键序规范编码和 SHA-256，数组顺序保留；本配置所有对象键均为 ASCII，因此随附 Python 的独立排序摘要可直接对照。新增语义内容必须使用新 `contentVersion`；修改 reducer 语义必须使用新 `reducerVersion`。不能用更新摘要来静默热替换正在运行的局。权威服务应在创建时保存完整配置快照和摘要，回放消费同一快照；`world-v1` 在本目录只是固定规则版本标识，规则实现及其证明由 #6 承担。

## 实际检查与后续义务

```sh
node --test content/tests/content.test.mjs
node content/scripts/generate.mjs --check
python3 content/scripts/check-schema.py
```

Node 行为检查覆盖人数装配、明确初始材料/来源、非法引用、规范摘要和文件被意外改写时拒绝装载；Python 独立检查配置结构与固定摘要。生成命令 `node content/scripts/generate.mjs` 用于有意更新结构后重新生成 Schema。

作者检查原始输出及输入摘要见 [self-check.json](evidence/self-check.json)。这些结果不证明实际修复、许可、NPC 到达、三类结局或权限过滤已经实现。独立审查尚未完成；最终完整局、授权复盘和真人贡献检查仍按 #11/#12 执行。

独立需求审查在原候选发现 `R-vs001-p08-REQ-001`：组合职责存在多个起始区域，但消费契约没有指定唯一位置。本次补充上述装配接口、确定性规则和2/3/4/5人固定期望矩阵；当前仅为作者 `FIX_REPORTED`，最终状态以新固定候选的独立复审为准。
