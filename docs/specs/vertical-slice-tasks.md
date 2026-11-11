# VS-001：任务目录与验收覆盖

本目录关联[主 Spec](vertical-slice.md)与 [Spec 汇总 #2](https://github.com/gbcdby/xiyou/issues/2)。任务状态、负责人、依赖及产物释放的**唯一来源为对应 GitHub Issue 正文**；这里不复制活动状态。

设计与发布记录：[设计任务 #3](https://github.com/gbcdby/xiyou/issues/3)。每张后续票都必须绑定该设计实际发布的 Spec 提交；`PENDING_PUBLICATION` 只表示发布中的规划记录，不能据此开始相关实现。

## 实际 Tickets

| Ticket | 负责交付的结果 |
| --- | --- |
| [#4](https://github.com/gbcdby/xiyou/issues/4) | M0：建立机器可读协议契约与契约样本 |
| [#5](https://github.com/gbcdby/xiyou/issues/5) | M0：验证所有权、控制权与提交交错的核心模型 |
| [#6](https://github.com/gbcdby/xiyou/issues/6) | M1：实现权威 Session、持久事务与确定性回放 |
| [#7](https://github.com/gbcdby/xiyou/issues/7) | M1–M2：验证过滤重连与信息投递边界模型 |
| [#8](https://github.com/gbcdby/xiyou/issues/8) | M1：实现 Vue 房间、授权投影与断线恢复 |
| [#9](https://github.com/gbcdby/xiyou/issues/9) | M2：实现单 AI 的合法感知、意图与动作闭环 |
| [#10](https://github.com/gbcdby/xiyou/issues/10) | M3：实现唐僧与悟空的独立判断和主动协作 |
| [#11](https://github.com/gbcdby/xiyou/issues/11) | M4：实现首个机制场景、完整局流程与授权复盘 |
| [#12](https://github.com/gbcdby/xiyou/issues/12) | 验收：完成同候选集成、五人15分钟与两/五人完整试玩 |

所有上述编号均为实际 GitHub Issues。本文的映射只声明责任，不表示相应代码、模型或验收已经完成。

## 启动与产物释放

经审查的设计修订发布后，可先推进 [#4 协议契约](https://github.com/gbcdby/xiyou/issues/4)、[#5 核心模型](https://github.com/gbcdby/xiyou/issues/5)，以及 [#7 的相关模型](https://github.com/gbcdby/xiyou/issues/7)。优先解决 M0 的提交、所有权与控制权交错；下游按 Issue 正文中的具体产物继续。

- 模型检查和实施义务约束相关领域实现；协议类型、纯界面与环境准备可以按票中条件独立推进。
- #7 的 Session 写入隔离、过滤重连与 NPC 信息边界分别提供可复核产物；不以整票关闭作为所有下游的共同前提。
- 固定候选的技术产物取得针对性检查和独立审查后，可以在源票关闭或 PR 合并前供下游使用。接收方固定提交／摘要，不消费不明“最新版”。
- 五名真人连续操作 15 分钟、两人／五人完整局以及真实贡献证据由 [#12](https://github.com/gbcdby/xiyou/issues/12) 汇总。自动化技术检查不满足这些真人要求；技术产物释放不等于 M1 或整个切片验收完成。
- #4—#11 的完成终点按各票正文到必要检查、独立审查及 PR ready；#12 到真实整体验收证据。合并、部署和父 #2 关闭分别判断。

## 验收覆盖

以下引用表示提供相应实现或证据的责任。共享编号在单票中只核对该票范围；[#12](https://github.com/gbcdby/xiyou/issues/12) 对同一集成候选形成完整结论。具体方法见[验证计划](vertical-slice-verification.md)。

| 验收 ID | 负责产物／证据的 Tickets |
| --- | --- |
| INT-AC-01 | [#4](https://github.com/gbcdby/xiyou/issues/4)、[#5](https://github.com/gbcdby/xiyou/issues/5)、[#6](https://github.com/gbcdby/xiyou/issues/6)、[#7](https://github.com/gbcdby/xiyou/issues/7)、[#8](https://github.com/gbcdby/xiyou/issues/8)、[#9](https://github.com/gbcdby/xiyou/issues/9)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| INT-AC-02 | [#6](https://github.com/gbcdby/xiyou/issues/6)、[#8](https://github.com/gbcdby/xiyou/issues/8)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| INT-AC-03 | [#6](https://github.com/gbcdby/xiyou/issues/6)、[#7](https://github.com/gbcdby/xiyou/issues/7)、[#8](https://github.com/gbcdby/xiyou/issues/8)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| INT-AC-04 | [#7](https://github.com/gbcdby/xiyou/issues/7)、[#9](https://github.com/gbcdby/xiyou/issues/9)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| INT-AC-05 | [#10](https://github.com/gbcdby/xiyou/issues/10)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| INT-AC-06 | [#11](https://github.com/gbcdby/xiyou/issues/11)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| INT-AC-07 | [#6](https://github.com/gbcdby/xiyou/issues/6)、[#9](https://github.com/gbcdby/xiyou/issues/9)、[#11](https://github.com/gbcdby/xiyou/issues/11)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| M0-AC-01 | [#4](https://github.com/gbcdby/xiyou/issues/4)、[#5](https://github.com/gbcdby/xiyou/issues/5)、[#6](https://github.com/gbcdby/xiyou/issues/6)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| M0-AC-02 | [#5](https://github.com/gbcdby/xiyou/issues/5)、[#6](https://github.com/gbcdby/xiyou/issues/6)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| M0-AC-03 | [#4](https://github.com/gbcdby/xiyou/issues/4)、[#5](https://github.com/gbcdby/xiyou/issues/5)、[#6](https://github.com/gbcdby/xiyou/issues/6)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| M0-AC-04 | [#5](https://github.com/gbcdby/xiyou/issues/5)、[#6](https://github.com/gbcdby/xiyou/issues/6)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| M0-AC-05 | [#4](https://github.com/gbcdby/xiyou/issues/4)、[#5](https://github.com/gbcdby/xiyou/issues/5)、[#6](https://github.com/gbcdby/xiyou/issues/6)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| M0-AC-06 | [#5](https://github.com/gbcdby/xiyou/issues/5)、[#6](https://github.com/gbcdby/xiyou/issues/6)、[#8](https://github.com/gbcdby/xiyou/issues/8)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| M0-AC-07 | [#5](https://github.com/gbcdby/xiyou/issues/5)、[#6](https://github.com/gbcdby/xiyou/issues/6)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| M0-AC-08 | [#7](https://github.com/gbcdby/xiyou/issues/7)、[#8](https://github.com/gbcdby/xiyou/issues/8)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| M0-AC-09 | [#4](https://github.com/gbcdby/xiyou/issues/4)、[#7](https://github.com/gbcdby/xiyou/issues/7)、[#8](https://github.com/gbcdby/xiyou/issues/8)、[#9](https://github.com/gbcdby/xiyou/issues/9)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| M0-AC-10 | [#5](https://github.com/gbcdby/xiyou/issues/5)、[#7](https://github.com/gbcdby/xiyou/issues/7)、[#9](https://github.com/gbcdby/xiyou/issues/9)、[#10](https://github.com/gbcdby/xiyou/issues/10)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| M0-AC-11 | [#4](https://github.com/gbcdby/xiyou/issues/4)、[#7](https://github.com/gbcdby/xiyou/issues/7)、[#9](https://github.com/gbcdby/xiyou/issues/9)、[#10](https://github.com/gbcdby/xiyou/issues/10)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| M0-AC-12 | [#5](https://github.com/gbcdby/xiyou/issues/5)、[#7](https://github.com/gbcdby/xiyou/issues/7)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| GP-AC-01 | [#11](https://github.com/gbcdby/xiyou/issues/11)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| GP-AC-02 | [#9](https://github.com/gbcdby/xiyou/issues/9)、[#10](https://github.com/gbcdby/xiyou/issues/10)、[#11](https://github.com/gbcdby/xiyou/issues/11)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| GP-AC-03 | [#6](https://github.com/gbcdby/xiyou/issues/6)、[#8](https://github.com/gbcdby/xiyou/issues/8)、[#11](https://github.com/gbcdby/xiyou/issues/11)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| GP-AC-04 | [#10](https://github.com/gbcdby/xiyou/issues/10)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| GP-AC-05 | [#6](https://github.com/gbcdby/xiyou/issues/6)、[#11](https://github.com/gbcdby/xiyou/issues/11)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| GP-AC-06 | [#12](https://github.com/gbcdby/xiyou/issues/12) |
| GP-AC-07 | [#8](https://github.com/gbcdby/xiyou/issues/8)、[#9](https://github.com/gbcdby/xiyou/issues/9)、[#11](https://github.com/gbcdby/xiyou/issues/11)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| GP-AC-08 | [#11](https://github.com/gbcdby/xiyou/issues/11)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| VER-01 | [#4](https://github.com/gbcdby/xiyou/issues/4)、[#5](https://github.com/gbcdby/xiyou/issues/5)、[#6](https://github.com/gbcdby/xiyou/issues/6)、[#7](https://github.com/gbcdby/xiyou/issues/7)、[#8](https://github.com/gbcdby/xiyou/issues/8)、[#9](https://github.com/gbcdby/xiyou/issues/9)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| VER-02 | [#12](https://github.com/gbcdby/xiyou/issues/12) |
| VER-03 | [#6](https://github.com/gbcdby/xiyou/issues/6)、[#8](https://github.com/gbcdby/xiyou/issues/8)、[#9](https://github.com/gbcdby/xiyou/issues/9)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| VER-04 | [#9](https://github.com/gbcdby/xiyou/issues/9)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| VER-05 | [#10](https://github.com/gbcdby/xiyou/issues/10)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| VER-06 | [#11](https://github.com/gbcdby/xiyou/issues/11)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| VER-07 | [#6](https://github.com/gbcdby/xiyou/issues/6)、[#9](https://github.com/gbcdby/xiyou/issues/9)、[#11](https://github.com/gbcdby/xiyou/issues/11)、[#12](https://github.com/gbcdby/xiyou/issues/12) |
| VER-08 | [#12](https://github.com/gbcdby/xiyou/issues/12) |

## 协作与变更

- #4 维护公共协议类型；#6、#8、#9 消费同一契约，字段语义变化回到 Spec。
- #5 与 #7 分别拥有模型 profile；公共模块指定单一写入者，引用时固定版本，不能并行覆盖同一文件。
- #6 维护权威领域与持久化；#8 维护实时适配和联机界面。恢复、控制权和授权校验调用同一领域入口。
- #9 维护 AI 调度、感知和网关；#10 维护双角色行为配置；#11 集成场景与界面。共享外壳经明确交接后再修改。
- #12 负责取证和验收；缺陷交回相关实现票，修复后复验受影响范围与必要组合路径。
- 协议或玩法约束改变时修订 Spec，更新受影响 Issues 的 `spec_ref`、依赖与验收，不改写旧候选的运行结论。

