# CUI-OBS-01 朝向修复：有限源码绑定复核

2026-11-13，只读核对高老庄首章朝向写回对既有 `RecoveryWake`、`SceneRequest`、`SceneFollow` 覆盖切片的影响。**本次源码增量对应为 `IN_SYNC`，仅表示下述已审查转移及其假设仍适用；整体对应仍为 `PARTIAL`。本次 TLC 为 `NOT_RUN`，没有运行产品。** 原 40／64 项是各自固定模型和配置的历史结果，没有改成朝向候选的新运行，也没有新增“全实现通过”结论。

## 固定身份与实际核对

| 对象 | 固定身份 |
| --- | --- |
| 已合并公开 main | `573c7c135e8cce8155ad2bb4367be64252f1d7e9`，tree `1eab282a0a5b875ccc8581d612b59e606fd3c1d2`；身份来自合并交接，本次未另行访问远端 |
| 本次使用的本地等价基线 | `04f245310de24538ccde1eb629e3363d9b2410e7`，完整 tree 与上述 main 相同；其 parent 是 `955850241093332353cbb8b84fc2a7df40ecb827` |
| 朝向产品修复 | `45969a982cef55c6dfc93d5c91df6c7dc27dcdbd`，tree `456db52414a07c9f68a83ca13804c247fd90f45e`；同样以 955 为 parent |
| 机械组合 | `3e8bddf5a2662e7af5338a0fe7b14933036e90b5`，tree `db1c616b1f061890b36643dd17381b9afe5f9456`；在 04f 上只取朝向修复的精确四文件 |

四文件为 `game/spatial-geometry.mjs`、`game/spatial-rules.mjs`、`game/gaolao-rules.mjs` 和 `backend/tests/spatial-facing.test.mjs`。已逐字比较组合与修复对象，其他文件保持基线。三个生产文件分别为 9 行 helper、新 import 与普通移动赋值、两处随行赋值及纯距离表达式提取；没有顺带修改业务。测试文件只核对内容身份，本任务未执行它。

[机器可读记录](facing-source-review.json) 保留各源文件 Git blob、SHA-256、两个旧绑定的逐文件差异、三个模型摘要和实际核对状态。它是后续来源绑定的增补记录，不改写旧 [恢复 profile](recovery-wake/project-profile.json) 或 [场景来源清单](scene-policy/source-files.json)。复制或合并后可以直接按该记录核对文件 SHA-256，无需上述本地 Git 对象。

实际完成的静态检查包括：四文件范围与精确内容核对；三个生产文件在内存中移除已审查朝向增量后，剩余文本与基线完全一致；129 份历史模型、配置、运行脚本、身份、结果及历史证据文件保持原字节，其中有 104 份 cfg。两目录的入口说明允许添加本页引用，模型输入、检查判据和旧门禁没有修改。文本分解只是确认差异范围，不是执行测试或机器检查的精化证明。

## 源码变化与模型投影

| 源码切片 | 本次核对 | 对现有模型的影响 |
| --- | --- | --- |
| `spatial-geometry::facingAlongPath` | 倒序读取有限路径，找最后非零段并计算既有八向值，否则返回旧值；不修改路径、不 await、不发事件 | 在合法有限点/路径前提下为同步有限计算。模型不包含朝向和八向算术；其他几何函数逐字未变 |
| `spatial-rules::advanceSpatialPositions` | 仍先检查当前代次、地图、路径依赖和实际各段碰撞；只在原有实际位移分支中写 facing，再执行原位置与 revision 更新 | 已建模的执行门槛、普通 movement 分类和事件次序不变；无额外 revision、event 或 seq |
| `gaolao-rules::advanceGaolaoFollow` 的策略路线分支 | 当前许可、双方代次、地图、acceptance、领路者路线和本人整段守卫顺序不变；朝向只使用已通过检查的实际截断路径 | `Fence`、`Advance`、本人 C13 退出、B 优先、跨场景条件、到达确认及旧安排不得复活的对应保持。连续几何仍为继承前提 |
| 同函数既有 v1 分支 | 从原 path 取实际截断段，新增朝向；位移、revision、跨场景 placement 和原事件条件不变 | 核对这条来源变化不等于把 v1 扩入 SceneFollow 的策略路线证明范围 |
| `spatial-world` reducer、`canSee`、`ensureView`、`resolveRef` | 原 actor 事件持久化整个 actor；可见性依赖场景、位置、距离与遮挡，引用依赖既有 view/appearance；这些判断不读取 facing | 当前权限/引用筛选不因新增朝向值改变。完整授权算法仍未形式化 |
| `scene-policy` 的输入、`sameChoiceBindings`、资格与 `wakeDependencies` | 当前动作依赖和共同围栏不含 facing；位置资格、资源版本、双方代次、来源、许可、路径和状态仍使用原字段 | 本次增量不改变 STD-001／002 的选择/唤醒依赖、水位消费、原请求恢复、Accepted 去重或 Rejected 新尝试资格 |
| AI orchestrator 的 `spatialWake` | actor 签名仍取 appearance/resourceRevision 及本人的 movement ID/状态；不读取 facing。clock 仍沿用 `spatialPauseBefore` | 普通位置 actor 事件不会仅因朝向变化成为新的语义信号；既有合法 scene 事件的间接唤醒仍允许 |

上述判断还核对了未改动的 `gaolao-policy-route`、`gaolao-scene-policy`、`spatial-runtime`、`scene-policy-runtime` 与 AI context 构造路径，具体内容身份见机器记录。`facing` **会**进入既有 actor 事件、授权快照和未来正常 AI context，因此完整 payload、未来 context 摘要及 provider 选择可以变化。本次只论证它不进入当前抽象协议的资格、围栏与水位控制；不声称所有用户可见行为相同。原请求、已保存 context、摘要与 Receipt 没有被回写。

## 两个旧绑定中的真实差异

恢复 profile 的 10 文件中，8 份在本次组合仍匹配原 0ac 摘要。其余两份分别处理：

- `backend/runtime.mjs` 是**此前 scene 扩展**，本次朝向修复没有再改它。0ac 至 04f 的差异为 scene 模块导入、迁移 008、两个转发方法，以及同一提交后通知附带私有 `scenePolicyWake`。原 `spatialPauseBefore` 和既有 events 保持；AI 接收端不读取新增私有字段。旧 40 项没有证明这些扩展分支、迁移或新通知计算的总性；通知最终送达等前提仍须成立。
- `game/spatial-rules.mjs` 在 0ac 与 04f 相同，只在本次新增朝向 import/赋值。上表分别核对其真实位移条件、实际路径守卫和现有通知投影，没有把文件 hash 漂移当成“仍逐字一致”。

场景来源清单的 12 文件中，11 份仍匹配 955，只有 `game/gaolao-rules.mjs` 因本次朝向变化而不同。955 阶段“路线四份源码逐字相同”的历史声明只适用于当时；当前组合依靠上表对变化分支的有限源码复核，不沿用该字节相同声明。

## 历史模型结果如何复用

| 模型 | 当前文本 SHA-256 | 本次处理 |
| --- | --- | --- |
| RecoveryWake | `cefc90a3bc05805ade0e60c2d253d520c15fd52f0f35c85dd649d17d503334ae` | 原 40 判据、结果及旧 25c 反例保持原身份 |
| SceneRequest | `b426837ae8704ce9610edd613ee97728b85947ac103f6629ebe98323e537bea1` | STD-002 细化后的原 47 请求判据及旧失败历史保持原身份 |
| SceneFollow | `61c550a71cdeaced28c77bb44347b9f355b015018032fe6e988dfb62b8cb3049` | 原 17 路线判据保持原身份，与请求部分组成已有 64 判据 |

本次没有改变模型状态、转移、性质、配置、规模、公平性或负控，也没有为朝向正确性建立新性质。重新运行相同模型不能检验未被模型表达的八向方向或客户端绘制；因此本次 TLC 明确为 `NOT_RUN`。旧正例仍只支持原有限模型的 `PASS_WITHIN_SCOPE`，负控和见证仍是各自预期的反例。新增证据只支持已读源码切片在现有抽象下仍适用，不增加模型证明范围。

原有活性前提保持：授权/运行/预算或路线合作条件最终持续具备、原请求最终收束、通知最终送达以及已声明内部动作弱公平。prepare、reserve 提交、返回消费仍分步；已暂停不得新 prepare 与暂停前已 prepare 可继续 reserve 的边界不变。没有借此新增 reserve 时的 paused 门槛。

## 未覆盖范围与返回条件

SQL 原子性和唯一索引、授权算法、原文及摘要编码、连续几何、跨进程通知、多 NPC 组合与 provider 行为仍没有精化证明。实际八向方向、零距离/曲线路段、暖冷视图、离场返场、重启、HTTP/Socket 必须由产品验收承担；这些执行结果不计入本次形式化工作。当前结论不涉及后续章节。

若以后让 facing 参与可见性、引用轮换、action guard、scene basis、资源版本或语义唤醒，或修改路径、原事件数量/revision、同步计算的有限性，就需重新检查受影响模型和配置。当前没有发现这类变化，也没有删除性质、忽略漂移或降低旧检查门槛。
