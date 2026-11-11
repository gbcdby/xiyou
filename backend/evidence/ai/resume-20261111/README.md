# #9 单 AI 持久边界与恢复复审

2026-11-11，关联 [#9](https://github.com/gbcdby/xiyou/issues/9) / [PR #19](https://github.com/gbcdby/xiyou/pull/19)。本目录保存恢复后的独立审查、实际反例、两次修正及复审。**当前结论仅覆盖受控单 AI 实现，真实外部模型调用为 0；PR 保持 draft，single-ai-runtime 未释放。**

## 固定对象

Spec 始终为 `6c2a0b9f6d137ad5fbd41721659404333ad8e16d`。本地恢复提交和远端提交因提交元数据不同而 SHA 不同，完整 tree 均分别核对一致。

| 阶段 | 实际本地源码 | 同内容远端源码 | 完整 tree |
| --- | --- | --- | --- |
| 恢复基线／R1 | `29322b4ef355060556ee73f21678274140662bc6` | `0ad722b8a6780c3ff8218395ef0a3f41947ed242` | `172f832627eb46ead24740ef2e59f6494549205f` |
| 输出持久化修正／R2 | `652c16be96367838de18938a9cb8d88dbf8b89bd` | `9ec1bf552dd9701826c00d53e3a40916e4e7bc2c` | `df7762628a7a5f37c57ca415b625d892676dd66a` |
| 测试清理修正／R3 | `bf1a9c8df89538183f19fead1055f869d4d081f6` | `1c49c249296dfe7ea2dff76051f863416f1f04e7` | `6b0bf762701d2d776044d2b32aa45794aaf6b751` |

[source.json](source.json) 保存阶段映射和 R3 实际执行时的 69 项源码／输入摘要；R2 的 68 项摘要原件另见 [作者清单](author/candidate-source-manifest.json)。后续归档提交只增加说明和证据，并更新 AI README 的当前审查入口；69 项输入中的该 README 说明随后变化，业务与测试输入字节不变，不将实际检查身份改标为归档提交。历史 PR 原有自查和日志继续按各自原候选保留。

## 已发现并修复的问题

### 非法模型原文可能使决定长期悬空

独立标准轴 R1 在真实 PostgreSQL 中发现 `R-vs001-p06-STD-001`（P2、blocking）：非法 JSON 原文含实际 NUL 时，Gateway 虽判 Invalid，后续保存原文仍报 `22021`，决定无法正常拒绝及 fallback；结构合法但对白解码含 NUL 时，世界 `jsonb` 提交报 `22P05`，恢复重复失败。其中 `22P05` 涉及共享协议／既有世界 jsonb 的基线相容性缺口；STD-001 的新增阻断依据是非法原文的诊断持久化路径，未将两者全部归因于本 PR 新增。原[报告](reviews/standards-r1/standards-r1.md)、[反例结果](reviews/standards-r1/invalid-output-result.json)和[输出](reviews/standards-r1/invalid-output-probe.log)保留。

修正使用内部 JSON-string-v1 编码无损保存 JS 原始字符串，旧 text 记录仍按旧格式读；原有摘要不改含义，新增精确码元摘要，区分不同孤立 surrogate。共享解析之后检查 AI 意图的实际存储边界，不能持久的 NUL 意图成为 Invalid，保留诊断及原文，整包不提交，并走原稳定 fallback 键。旧 Ready 恢复仍先查原 Receipt：查询未知继续 Unknown，确认无原 Receipt 后才按原摘要拒绝不能持久的原包。公共协议和其他入口的既有字符规则未改。

R2 两个独立上下文分别完成增量审查。标准轴原反例重放、真实旧库迁移、Unknown／已提交 Receipt 恢复、两个真实进程退出、精确码元身份及导出消费者均通过，原 finding 为 **VERIFIED**。需求轴另测字面 `\\u0000`、其他合法控制字符、emoji／替换字符的可用边界，没有扩大过滤。

### 测试清理存在提前停止 PostgreSQL 的竞态

R2 需求轴首次组合运行得到 **20 pass、1 文件级 fail、exit 1**，虽然 `ai-orchestrator.test.mjs` 内部七项均通过。原[输出](reviews/requirements-r2/targeted-runtime.log)和对应[数据库日志](reviews/requirements-r2/postgres/ai-orchestrator-tNAYyL/postgres.log)保留；随后单文件诊断七项／exit 0 不覆盖首次失败。

进一步真实 PG 探针用明确门闩控制结束顺序，未使用固定 sleep。修前 `pool.end()` 在 1281.581 ms 兑现，PG stop 在 1281.757 ms 开始，两连接直到 1283.146／1283.841 ms 才真正 end；修后对应顺序为 1120.713 ms、1122.465／1123.618 ms、1123.652 ms。探针因修前顺序错误 exit 1，修后 exit 0，原始 [baseline](author/postgres-lifecycle-baseline.json) / [fixed](author/postgres-lifecycle-fixed.json) 与红绿日志全部保留。

R3 仅修改测试 helper 与新增一个真实生命周期回归：跟踪实际连接的公开 end 事件，等待 Pool 和连接全部结束后才停库；并发／重复 stop 共享一个 Promise，没有吞错或固定等待。作者完整后端 90/90、exit 0，独立需求轴四文件 21/21，并另测并发 stop。**已证实并修复的是提前停库竞态；原 R2 文件级失败的唯一根因仍为 INCONCLUSIVE，不能用后续绿灯倒推因果。**

## 检查与独立性

| 阶段／执行者 | 结果与范围 | 正式材料 |
| --- | --- | --- |
| R1 独立需求轴 | Gateway 2 项、真实 PG／网络／崩溃 42 项，共 44 项通过；仅受控范围 | [需求报告](reviews/requirements-r1/review.md)及同目录原日志 |
| R1 独立标准轴 | FAIL；真实 NUL 反例形成上述 P2 finding | [标准报告](reviews/standards-r1/standards-r1.md)及同目录原探针 |
| R2 作者 | 新边界三轮红绿、两类孤立 surrogate 与导出核对；完整后端 89/89、exit 0 | [运行](author/final-backend.json)、[原日志](author/final-backend.log)、`author/output-*` |
| R2 独立需求轴 | 代码与新增持久边界 PASS；首次组合 exit 1 保留，随后单文件及 4 项新增边界探针通过 | [报告](reviews/requirements-r2/review.md)及同目录原日志 |
| R2 独立标准轴 | PASS，STD-001 VERIFIED；真实旧库、原反例、两个退出码 81 的子进程和原文导出核对 | [报告](reviews/standards-r2/standards-r2.md)、[兼容结果](reviews/standards-r2/compatibility-result.json) |
| R3 作者 | 生命周期红绿；完整后端 90/90、exit 0 | [运行](author/lifecycle-backend.json)、[原日志](author/lifecycle-backend.log) |
| R3 独立需求轴 | 两文件局部 PASS；21/21、exit 0，独立真实 PG 并发 stop 探针通过 | [报告](reviews/requirements-r3/review.md) |
| R3 独立标准轴 | 两文件局部 PASS；修前负对照、修后回归、独立双门闩及共享 stop Promise 检查通过 | [报告](reviews/standards-r3/standards-r3.md) |

作者、需求审查者与标准审查者是不同上下文；未用作者自查替代独立审查，也未把受控 provider 称为实际模型。原始 JSON 中的执行路径属于当次运行身份，正式存放映射以上述目录为准，不要求依赖当次临时目录仍存在。

## 复现及剩余条件

在相应固定源码候选上按 [AI 模块说明](../../../ai/README.md)安装根锁文件依赖，再执行 `npm run test:ai` 或 `npm run test:backend`。R3 的针对性组合为：

```sh
node --test backend/tests/postgres-lifecycle.test.mjs \
  backend/tests/ai-output.test.mjs backend/tests/ai-orchestrator.test.mjs \
  backend/tests/ai-crash.test.mjs
```

本目录独立探针保留原字节及原相对导入。需要重放时先按各报告恢复到仓库根下 `.agent-output/<对应任务>/` 的相同层级，复用对应 helper 并使用新输出目录；涉及旧版升级的探针还需恢复报告所列旧源码候选。归档不包含数据库目录、连接配置或凭证，不覆盖历史结果。

当前还缺实际供应商／endpoint／模型标识、适配器与凭证引用、授权预算，不能运行或认定 VER-04 真实模型项。单 AI 产物未释放，#10 双 AI 与 #11 AI 联调仍按原依赖等待；#12 五名真人 15 分钟及两人／五人完整局未执行。旧候选的有限模型证据、当前真实数据库检查、真实模型、真人试玩、远端 CI、合并和部署分别判断，父 #2 仍未完成。
