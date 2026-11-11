# VS-001 模拟输入整体验证

本轮采用用户确认的 `mock-20261111`，执行候选为 `fa87e221aa1e48cb19eeecc1beafcb83c0a7a21a` / tree `2d81686787d35d3a26747fbd7896ab1ec54c31ed`。同一完整tree的[远端源码](https://github.com/gbcdby/xiyou/tree/78a85960e4c2de64fc36a48ba1ed4c4b5e82f227)已固定，实际执行身份与发布身份分别保留。玩家、模型返回和故障是明确合成输入，PostgreSQL、HTTP/Socket.IO、Gateway、Validator、事件回放和浏览器都实际执行。

**本轮执行矩阵与独立需求、标准两轴审查均为 PASS，新增阻断问题为 0。** PR/实际合并以 [#12](https://github.com/gbcdby/xiyou/issues/12) 和 [#2](https://github.com/gbcdby/xiyou/issues/2) 回读记录为准，本文件不提前宣称已合并或部署。

## 本次实际结果

- 后端106、协议23、内容8、前端53，共 **190 tests**，无失败、取消或跳过；构建（含类型检查）、生成一致性与Python Schema均exit0。原始命令和输出在 [checks](checks/)。
- 完整局/联合故障 **7项PASS**，35557.96ms；见[结果及10项五职责贡献](integration/result.json)和[原输出](integration/stdout.txt)。五人和两人自然结局直接由真实材料、许可及两NPC移动产生，未写入预设终态。
- 五身份长测 **900907.628ms**，即15分钟以上；25个同游标检查点 × 5，最后410条连续事件；每120秒窗口都有5个职责选择，共8窗口40次。见[结果摘要](network/summary.json)、[原命令](network/execution.json)、[必要断言原行](network/assertions.jsonl)。此局结束检查时仍Running，完整自然局另行验证，没有延后结算凑时长。
- 当前集成版本的真实浏览器 **15项检查和2图**，46003.68ms，页面/数据库错误为空，资源关闭。见[浏览器结果](browser/result.json)、[桌面](browser/recap-desktop.png)、[390像素窄屏](browser/recap-mobile.png)。该页面脚本的NPC尾段使用合法内部意图，其自然策略证明由上面的完整局承担。
- 三类运行的119个源码/依赖摘要完全相同，当前文件逐项匹配，长测与完整局前后源码未变；见[执行身份](execution-source.json)。所有新检查进程、Socket、HTTP与临时数据库均正常关闭，外部模型调用为0。

## 验收对应

| 编号 | 范围 | 本次实际支持 |
| --- | --- | --- |
| VER-01 | 有限模型、严格契约、源码对应 | 新core84项是20正向/64预期反例；原#7模型按精确子树继承；协议23项和真实后端检查，独立IM-01至10源码对应另附。 |
| VER-02 | 五身份实际900秒 | 900907.627508ms；25个同游标检查点，每点5份授权视图比较；410连续事件；8个职责窗口/40次真实合法操作。 |
| VER-03 | 恢复、未知结果与联合故障 | 同候选真实丢包/乱序/重叠/重连/30秒Grace/接管；联合专例保留同ID同字节两次发送、一次效果、旧AI DECISION_STALE。专例受控31秒不计900秒。 |
| VER-04 | 受控单AI完整链 | 实际106项后端检查中的Gateway/原文持久/非法/超时/取消/Unknown/进程崩溃恢复；0外部模型调用。 |
| VER-05 | 受控双角色 | 12项针对性行为回归、两组证据变化、不同知识/分歧/拒绝；作者默认60016.968272ms窗口按同源范围继承，9调用、0新增玩家动作；原两finding需求复核VERIFIED，标准PASS。 |
| VER-06 | 人数、五职责与四条结局 | 2/3/4/5装配；五人查证通行19个AI决定；两人备用材料和调查未齐各10决定；超时未解决专例；五人10项贡献均有真实下游。3/4装配样本人工终止，不算自然结局。 |
| VER-07 | 授权因果复盘 | 完整局Action/Receipt/Event/Observation/Decision链；逐人历史受众校验；当前浏览器15项与2图，含Claim A→C→B、113条两页、撤权、迟到与只读。 |
| VER-08 | 同候选证据与最终独立审查 | 三类运行同commit/tree与119输入；业务、测试冻结，后续提交只归档必要新证据与入口说明；两轴最终报告单独固定。 |

## 最终独立审查

| 审查轴 | 固定对象与结论 | 正式原报告 |
| --- | --- | --- |
| 需求 | `fa87e221` / `2d816867`，PASS；新增 finding 为空；核对 VER-01—08、五职责下游、真实长测及有限模型源码对应 | [需求报告](reviews/final-requirements-review/review-report.md)、[机器结果](reviews/final-requirements-review/review-result.json)、[模型源码对应](reviews/final-requirements-review/model-source-mapping.md) |
| 标准 | 同执行候选，PASS；新增 finding 为空；独立复跑七项完整局与联合故障，外层 34060.283508ms、脚本 33695.692874ms | [标准报告](reviews/final-standards-review/review-r1.md)、[机器结果](reviews/final-standards-review/review-r1.json)、[独立执行](reviews/final-standards-review/integration/result.json) |

两个独立上下文均未读取另一轴报告来作出结论。报告各自固定了当时的预归档快照；当前索引增加原报告及必要附件，不把较早快照的文件数量改写为最终归档数量。四份入口说明与本目录是执行之后的纯文档/证据差异，119个运行输入保持不变；正式合并身份由PR和任务记录在合并后回读。

组件审查也保留原身份：双角色两项需求finding由原审查者R2复核为VERIFIED，标准轴PASS；复盘组件独立需求与标准均PASS。原FAIL、INCONCLUSIVE及审计程序自身的修正均保留，没有覆盖历史输出。

## 继承范围与模型边界

新核心模型来源是[PR #21](https://github.com/gbcdby/xiyou/pull/21)，完整子树 `d0931a2d91b27f2276f95b4f58cd3d0525082cf0` 与当前候选相同。84配置是20个正向有限检查和64个预期反例；组合安全/活性各904868 distinct、队列0。本轮最终集成不重标为重新运行全部TLC；模型限于声明规模、一轮交接、一个决定、至多一次provider回调，未证明JavaScript/PG实现的无限规模正确性。

原#7固定 `c78066d9b95eb3657293fd26a6a5d8b325846b38` 的边界模型按不变目录继承；实际授权、SQL/Socket、重复结果和新recap负例另行执行。原两项LOW非阻断维护finding `R-vs001-p04-STD-001` 与 `R-vs001-p04-VIS-STD-001` 仍OPEN（见[PR #15](https://github.com/gbcdby/xiyou/pull/15)）；独立观察探针已消除相应可达性未知，没有伪称正式探针已修复。

双角色60秒为71aad48业务/ce57d0f证据的原执行，按策略、Gateway、Validator、内容和脚本不变的逐文件对应继承；当前新增recap及协议增量已另测，不把不同分支的绿值相加冒充集成运行。独立审查报告分别在 [reviews](reviews/) 归档；原执行路径只保留来源身份，正式可读文件与摘要见归档索引。

## 失败与未运行范围

初始集成R1的90秒终局等待失败保留在[原结果](failures/integration-r1/result.json)；它单独不证明1200秒产品期限违约。随后独立检查实际取得120调用预算耗尽和旧路线复活反例，两项修正由原需求审查者R2复核为VERIFIED。新R2没有覆盖或改写旧FAIL/INCONCLUSIVE。复盘作者早期TDD与浏览器失败仍在[组件原归档](../mock-recap-20261111/README.md)。

真人体验、实际LLM质量、真实设备及公网部署在本profile为NOT_REQUIRED，实际状态仍NOT_RUN。没有CI执行记录，本地真实检查不称CI通过。完整传输日志含不必要的全量投影，仅留执行环境；发布的是本轮新合成样本的结果字段、必要原始断言、来源摘要和截图。旧#5/#8被拒绝payload没有读取、复制、换格式或重传。
