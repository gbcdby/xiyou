# Spec 索引

> **VS-001 历史验收范围：** 2026-11-11 用户要求该轮“全部 mock，验证完毕提交 PR 并合并”，采用 [mock-20261111](vertical-slice-mock.md)。这项修订只对应 VS-001，不自动替代新 Spec 的验收。原真人／真实模型项保留真实状态，领域权限与一致性约束继续适用。

## 当前状态

2026-11-11 用户启动 `auto` 后，开始将[初步产品与技术设计](../../初步设计文档.md)细化为首个可玩切片。文档候选、独立审查与实际采用状态以关联的 GitHub 任务及 PR 为准；规格存在不表示实现或运行验收通过。

当前实施入口为 **ADV-001 v0.2** 及其实施接续说明：用户已明确选定高老庄为首章并要求按 auto 推进，现有应用实现与实施 Tickets 从 [#23](https://github.com/gbcdby/xiyou/issues/23) 进入，阶段与整体验收从 [#29](https://github.com/gbcdby/xiyou/issues/29) 进入。2026-11-13 接管范围仅第一章，后续章节暂缓；五庄观详案和其他经典章节选题保留为设计材料。原文“本次仅设计”等措辞记录 v0.2 设计轮，不能据此认定后续尚未实施，也不能从代码存在推定验收完成。

| Spec | 范围 | 权威记录 |
| --- | --- | --- |
| [ADV-001：无战斗多人叙事冒险与首章高老庄](narrative-adventure.md) | v0.2 及实施接续：共用行走/交互、高老庄玩法、三 NPC/乔装/随行边界与验收 | [汇总与 Tickets #23](https://github.com/gbcdby/xiyou/issues/23)、[验收 #29](https://github.com/gbcdby/xiyou/issues/29)；[PR #24](https://github.com/gbcdby/xiyou/pull/24) 保留设计修订来源 |
| [ADV-001：共用空间协议](adv-protocol.md) | adv-protocol-v1：权威空间、授权投影、动作与恢复合同；实现绑定有效修订 | [合同与模型 #27](https://github.com/gbcdby/xiyou/issues/27) |
| [高老庄场景角色与本人回应](gaolao-scene-policy.md) | N1～N6 已采用；CS-R2 已采用为候选实现基线、G0-D1 已释放；F1 已作为消费基线，T02 已分派待 ACK、T03 已释放待分派；完整产品验收仍待 | [五票及实际 Issue 映射](gaolao-cuilan-self-response-tasks.md#共享记录发布登记)、[生产角色 #34](https://github.com/gbcdby/xiyou/issues/34)、[验收 #29](https://github.com/gbcdby/xiyou/issues/29) |
| [GZ-VIS-01：高老庄视觉基准](gaolaozhuang-visual.md) | v1.1：已采用的场景/UI/尺度与状态语义；正式素材和运行效果另行验收 | [视觉基准 #28](https://github.com/gbcdby/xiyou/issues/28)、[客户端 #33](https://github.com/gbcdby/xiyou/issues/33) |
| [ADV-001：CH02五庄观保留详案](narrative-adventure-wuzhuang.md) | 同一 v0.2 的后续 A4 范围；保留果数、两条路线和原 ADV-AC-07/08/09，本轮暂缓 | 同一 [#23](https://github.com/gbcdby/xiyou/issues/23)，不是另一个已实施 Spec |
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

