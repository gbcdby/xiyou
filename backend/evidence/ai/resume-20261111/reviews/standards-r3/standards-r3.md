# PR #19 测试生命周期补修：标准轴局部复审 R3

## 结论

**本次两文件增量：PASS。** 未发现新增标准轴 finding。已独立执行新增回归、旧 helper 负对照和分开放行两个连接的门闩探针，确认修正真正等待全部已连接 client 的 end 事件，并使并发/重复 stop 复用同一个 Promise。

R2 的受控单 AI 实现标准轴 **PASS** 继续保留，`R-vs001-p06-STD-001` 继续为 **VERIFIED**；本增量没有更改 AI、协议或世界业务代码，其 R2 证据仍保留原候选身份，不改称本轮重新执行。

历史“20 项断言通过但文件级失败”的唯一根因仍为 **INCONCLUSIVE**。本轮证明的是旧测试 helper 存在的特定关闭顺序窗口及其修复，不能据此认定它就是那次历史异常的唯一原因，也没有把原失败改写成通过。

## 固定对象及独立性

| 项目 | 身份 |
| --- | --- |
| work_id / Ticket | vs001-p06 / gbcdby/xiyou #9 |
| 新本地 commit | bf1a9c8df89538183f19fead1055f869d4d081f6 |
| 新远端 commit / PR head | 1c49c249296dfe7ea2dff76051f863416f1f04e7 |
| 同完整 tree | 6b0bf762701d2d776044d2b32aa45794aaf6b751 |
| 比较本地 commit | 652c16be96367838de18938a9cb8d88dbf8b89bd |
| 比较远端 commit / tree | 9ec1bf552dd9701826c00d53e3a40916e4e7bc2c / df7762628a7a5f37c57ca415b625d892676dd66a |
| PR base | 1c2dac4162ea7ae49535221a1c995c1af4f4692c，未变 |
| contract_id | 6c2a0b9f6d137ad5fbd41721659404333ad8e16d，未变 |
| 审查者 | /root/ai_standards，independent |

本轮回读确认远端提交的 tree、父提交及 PR head 均与上述身份一致；PR 仍为 draft，累计改动 112 个路径。本次独立审查没有参与修正实现，没有读取需求轴报告，没有采信作者 90/90 作为本轮检查结果。

完整增量仅为 backend/test-support/postgres.mjs 与 backend/tests/postgres-lifecycle.test.mjs。执行末尾 tracked 生产文件没有额外修改；总控正在准备的未跟踪 backend/evidence/ai/resume-20261111/ 归档材料不在本次冻结提交或审查范围，未读取其中需求报告。审查者仅在本任务临时目录保存探针和报告。

## 源码观察

安装依赖为 pg 8.23.1、pg-pool 3.14.0。读取其实际实现可见：pg-pool 的 _remove 先从 _clients 移除 client，再调用 client.end；结束队列可能在 _clients 为空时先兑现 Pool 的结束 Promise。该 Promise 不能单独充当底层所有 client 已发出 end 事件的证据。

修正只使用公开生命周期：在 pool.connect 事件登记每个 client 的 end Promise，结束后从集合移除；stop 先 await pool.end，再等待集合中的连接结束，最后停止真实 PostgreSQL 和收束日志。没有访问依赖私有字段、吞掉 pool/client 错误、增加固定 sleep 或放宽测试结果。

新的 stopping Promise 在首次调用时保存；后续调用得到同一份结果。若停止失败，错误继续传给调用方，不把失败伪装成成功。新增测试只在测试中收集错误并断言为空，未在 helper 中添加忽略 error 的监听器。prototype/client 方法包裹仅用于单文件测试的门闩和观测，并在 finally 恢复。

## 本轮实际执行

为遵守临时产物只写本任务目录的约束，执行副本只调整 helper 的 PostgreSQL 日志/数据输出目录，新增回归副本只调整其 import 路径；没有改变生命周期逻辑或断言。原始源码 SHA-256 与该限定变换记录在 execution-inputs.json。

环境：Node v24.22.1、PostgreSQL 18.6，使用上述固定 pg/pg-pool 依赖。

| 检查 | 本轮结果 | 原始材料 |
| --- | --- | --- |
| 新增回归配固定新 helper | 1/1 PASS，exitCode=0；必须覆盖 Pool 先兑现、client 后结束的窗口，再验证停库顺序 | lifecycle-fixed.log |
| 同一回归配父候选旧 helper | 预期负对照命中，exitCode=1；失败断言为“所有已接入连接必须先结束，再停止真实 PostgreSQL” | lifecycle-baseline.log |
| 独立双门闩探针 | PASS，exitCode=0；第二个连接先结束时 PG 仍未开始关闭，最后一个连接结束后才停库 | independent-lifecycle-probe.mjs、independent-lifecycle.log、independent-lifecycle-result.json |
| 并发与重复停止 | 并发 stop 与完成后 stop 均返回同一 Promise，pool.end 调用次数为 1，PG stop 仅一次，errors=[] | independent-lifecycle-result.json |
| 源码空白与资源 | git diff --check 通过；三个自有真实 PG 集群日志均有正常 shutdown；所有执行句柄完成 | postgres/*/postgres.log |

独立探针实际事件顺序：

1. 两个 client 分别收到 end 请求，但门闩尚未放行。
2. pool.end.resolved。
3. 放行 client 1，观察 client.1.end；确认 PostgreSQL 尚未开始停止。
4. 放行 client 0，观察 client.0.end。
5. postgres.stop.begin，随后 postgres.stop.end。

探针用 Promise 门闩和一次 setImmediate 调度检查，不以固定睡眠猜测资源结束。旧 helper 负对照的退出 1 被保留为预期反例，不计为正向运行通过。

## 证据与保留状态

| ID | kind / status / assessment | 范围 |
| --- | --- | --- |
| E-STD-R3-01 | source_inspection / OBSERVED / PASS | 两文件完整差异、pg/pg-pool 实际生命周期、固定 tree 与远端身份 |
| E-STD-R3-02 | execution / OBSERVED / PASS | 新增回归本轮执行，1/1、退出 0 |
| E-STD-R3-03 | execution / OBSERVED / COUNTEREXAMPLE | 同回归加旧 helper，预期目标断言失败、退出 1 |
| E-STD-R3-04 | execution / OBSERVED / PASS | 独立双门闩、stop Promise 身份和关闭次数 |
| E-STD-R3-05 | execution / OBSERVED / PASS | 三个 PG 集群正常 shutdown 和执行句柄收束 |
| R2 保留证据 | historical / HISTORICAL | 原标准轴 PASS 与 STD-001 VERIFIED，适用于本增量未变的 AI 源码；未冒充本轮重跑 |

没有新增未解决标准轴问题。没有执行整套后端、模型、协议或内容回归；作者 90/90 未由本审查者重新执行。未验证失效网络永不发出 end 的情形、调用方永久不归还 client 或实际生产部署关闭流程，本补修仅针对测试 PostgreSQL helper。

本轮没有模型调用，实际外部模型调用为 **0**。真实模型配置/授权/执行仍为 **BLOCKED/NOT_RUN**；不代表需求轴、Ticket #9、VER-04、single-ai-runtime 释放或合并/部署通过。
