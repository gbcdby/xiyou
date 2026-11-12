# Spec 索引

> **VS-001 历史验收范围：** 2026-11-11 用户要求该轮“全部 mock，验证完毕提交 PR 并合并”，采用 [mock-20261111](vertical-slice-mock.md)。这项修订只对应 VS-001，不自动替代新 Spec 的验收。原真人／真实模型项保留真实状态，领域权限与一致性约束继续适用。

## 当前状态

2026-11-11 用户启动 `auto` 后，开始将[初步产品与技术设计](../../初步设计文档.md)细化为首个可玩切片。文档候选、独立审查与实际采用状态以关联的 GitHub 任务及 PR 为准；规格存在不表示实现或运行验收通过。

当前设计候选为 **ADV-001 v0.2**（2026-11-12，北京时间）：用户已明确选定高老庄为首章。原五庄观详案保留为 CH02，其余改用经典章节路线；真假美猴王为条件候选。具体玩法、三名自主NPC、乔装/本人随行与验收见主文档。此次只修订 Spec；应用实现与实施 Tickets 尚未开始。

| Spec | 范围 | 权威记录 |
| --- | --- | --- |
| [ADV-001：无战斗多人叙事冒险与首章高老庄](narrative-adventure.md) | v0.2：共用行走/交互、经典章节顺序、高老庄完整玩法、三NPC/乔装/随行边界与验收；设计候选 | [汇总 #23](https://github.com/gbcdby/xiyou/issues/23)、[设计 PR #24](https://github.com/gbcdby/xiyou/pull/24)，实施 Tickets 尚未建立 |
| [ADV-001：CH02五庄观保留详案](narrative-adventure-wuzhuang.md) | 同一v0.2的后续A4范围；保留果数、两条完整路线和原ADV-AC-07/08/09；运行未执行 | 同一汇总与PR，不是另一个已实施Spec |
| [VS-001：首个可玩切片](vertical-slice.md) | M0–M4：协议、无 AI 联机、单 AI、双 AI、第一机制关 | [汇总 #2](https://github.com/gbcdby/xiyou/issues/2)、[设计 #3](https://github.com/gbcdby/xiyou/issues/3)、[任务目录](vertical-slice-tasks.md) |
| [VS-001：本轮模拟验收修订](vertical-slice-mock.md) | mock-20261111：模拟输入、实际实现验证、受控双NPC与授权复盘，验证后合并 | 同一汇总与任务目录，结果须同时注明 profile 和固定候选 |

VS-001 的细化材料：[玩法闭环](vertical-slice-gameplay.md)、[M0 协议](m0-protocol.md)、[验证计划](vertical-slice-verification.md)。它们保留底座协议与历史验收依据；ADV-001 的新增空间行为、正式剧情和体验验收按新 Spec 独立记录，不复用已关闭的历史 Tickets 冒充新工作。

## 新增一份 Spec 时

文件使用 `docs/specs/<slug>.md`，至少包含：

- 目标、范围、总设计依据与当前状态。
- 用户入口、行为、状态归属、接口与关键异常语义。
- 稳定验收编号、验证路径、风险与未决事项。
- GitHub 汇总 Issue / Tickets 目录入口及依赖来源。
- 有效修订身份，以及会使旧结论失效的变化。

状态可以写为“草案”“实施依据”“被替代”，但必须附实际决定或交接依据；作者完成一稿不自动成为已接受方案。

设计与拆票分别由 `worker-design`、`worker-plan-tickets` 负责。大功能的 Spec 与 Tickets 按 [GitHub 记录约定](../agents/issue-tracker.md)实际保存后，才进入分派。Spec 验收、Ticket 完成与 PR 合并分别判断。

