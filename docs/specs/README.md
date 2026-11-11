# Spec 索引

> **2026-11-11 本轮验收修订：** 用户要求“全部 mock，验证完毕提交 PR 并合并”。本轮采用 [mock-20261111](vertical-slice-mock.md)，以模拟输入执行实际代码并按该 profile 验收合并。下文原真人／真实模型要求保留为 `full-real` 基线，不再作为本轮阻塞条件，也不改记为已执行；领域权限与一致性约束继续适用。实际候选与结果以关联 Issue／PR 为准。

## 当前状态

2026-11-11 用户启动 `auto` 后，开始将[初步产品与技术设计](../../初步设计文档.md)细化为首个可玩切片。文档候选、独立审查与实际采用状态以关联的 GitHub 任务及 PR 为准；规格存在不表示实现或运行验收通过。

| Spec | 范围 | 权威记录 |
| --- | --- | --- |
| [VS-001：首个可玩切片](vertical-slice.md) | M0–M4：协议、无 AI 联机、单 AI、双 AI、第一机制关 | [汇总 #2](https://github.com/gbcdby/xiyou/issues/2)、[设计 #3](https://github.com/gbcdby/xiyou/issues/3)、[任务目录](vertical-slice-tasks.md) |
| [VS-001：本轮模拟验收修订](vertical-slice-mock.md) | mock-20261111：模拟输入、实际实现验证、受控双NPC与授权复盘，验证后合并 | 同一汇总与任务目录，结果须同时注明 profile 和固定候选 |

VS-001 的细化材料：[玩法闭环](vertical-slice-gameplay.md)、[M0 协议](m0-protocol.md)、[验证计划](vertical-slice-verification.md)。后续工作按任务正文的当前依赖和本轮模拟修订继续，固定实际设计与产物身份；不从本索引推断尚未执行的验证已完成。

## 新增一份 Spec 时

文件使用 `docs/specs/<slug>.md`，至少包含：

- 目标、范围、总设计依据与当前状态。
- 用户入口、行为、状态归属、接口与关键异常语义。
- 稳定验收编号、验证路径、风险与未决事项。
- GitHub 汇总 Issue / Tickets 目录入口及依赖来源。
- 有效修订身份，以及会使旧结论失效的变化。

状态可以写为“草案”“实施依据”“被替代”，但必须附实际决定或交接依据；作者完成一稿不自动成为已接受方案。

设计与拆票分别由 `worker-design`、`worker-plan-tickets` 负责。大功能的 Spec 与 Tickets 按 [GitHub 记录约定](../agents/issue-tracker.md)实际保存后，才进入分派。Spec 验收、Ticket 完成与 PR 合并分别判断。
