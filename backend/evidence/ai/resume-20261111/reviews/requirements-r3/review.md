# PR #19 测试生命周期补修：需求轴局部复审 R3

## 结论

**PASS，范围仅为两文件测试生命周期补修及其受影响的受控 AI 检查。** 独立核对未发现新的需求违约；必要针对性组合检查 21/21、exit 0，另一个独立真实 PostgreSQL 并发 stop 场景通过。

旧 R2 候选首次组合运行的 **20 pass／1 文件级 fail、exit 1** 继续保留，实际根因仍为 INCONCLUSIVE。本轮证明当前关闭顺序受约束且受影响检查通过，不倒推该竞态就是旧文件失败的唯一原因，不覆盖或改写旧失败记录。

实际外部模型调用为 0；#9、VER-04 整项和 single-ai-runtime 仍未满足真实模型释放条件。没有进行标准轴复审、CI、合并、部署或真人验收。

## 固定对象与独立性

- work_id：vs001-p06；审查者：/root/ai_requirements，independent，未参与补修实现。
- 父候选：652c16be96367838de18938a9cb8d88dbf8b89bd／tree df7762628a7a5f37c57ca415b625d892676dd66a。
- 本次实际候选：bf1a9c8df89538183f19fead1055f869d4d081f6／tree 6b0bf762701d2d776044d2b32aa45794aaf6b751。
- Spec／Ticket 继续沿用 VS-001 固定修订 6c2a0b9f6d137ad5fbd41721659404333ad8e16d／#9。
- 只有 backend/test-support/postgres.mjs、backend/tests/postgres-lifecycle.test.mjs 两文件变化。开始／结束身份一致，工作树干净；未改生产或测试源码，临时探针和日志只保存在本报告目录。
- 未读取另一轴复审报告；本次执行结论来自本审查者的实际运行，不把作者 90/90 转称独立全量复跑。

## 需求影响与消费者核对

1. 查询实际安装的 pg-pool 实现，确认其结束路径先从池内列表移除 client，再发起 client.end；列表为空时可以先兑现 pool.end。Pool Promise 和真实连接 end 是不同事实。
2. helper 在向消费者提供 Pool 前安装公开 connect 监听，为每个成功连接记录真实 end Promise；连接结束后移除该记录，不依赖 pg-pool 私有列表或固定睡眠。
3. stop 先等待 Pool 停止接纳与收束，再等待所有已接入连接的实际 end，随后停止 PostgreSQL 并等待日志落盘。未新增吞错监听、忽略拒绝、缩短检查或内存替身。
4. 所有并发或重复 stop 调用复用同一个清理 Promise，因此后续调用方不能在首次清理尚未完成时提前报告成功，也不会第二次发起停库。首次清理拒绝不会被随后调用伪装成成功。
5. 已查看后端测试消费者；调用者仍保持 Runtime／网络服务在前、数据库 helper 在后的清理顺序，接口不变。新回归中的 prototype 包装只处于独立测试文件进程，finally 恢复；门闩驱动真实 client.end，不以 sleep 猜测时序。
6. 新测试在收集 Pool error 后断言错误集合为空，错误仍导致测试失败；其顺序断言要求 Pool 已兑现、客户端随后真实结束、最后才开始停库，并检查重复 stop 不重复停库。
7. 业务 Gateway、权限、世界事务、模型原文编码、恢复因果键及公开协议没有变化。R1／R2 未变代码的需求结论保留原身份；本轮仅重新运行受 helper 影响的必要路径。

## 本次独立执行

环境：Node v24.22.1；候选锁文件依赖；真实 PostgreSQL 18.6。所有供应商调用为受控函数，外部调用为 0。

### 针对性组合

命令：

`node --test --test-reporter=tap backend/tests/postgres-lifecycle.test.mjs backend/tests/ai-output.test.mjs backend/tests/ai-orchestrator.test.mjs backend/tests/ai-crash.test.mjs`

同时收集 stdout／stderr，shell pipefail 保留 Node 退出状态。实际 **exit 0；tests 21／pass 21／fail 0／cancelled 0／skipped 0**，duration 3318.986209 ms。

覆盖新增真实连接结束门闩、NUL／孤立 surrogate 无损存储与升级恢复、Unknown／fallback、异步限流与持久预算、关闭及五处真实 AI 子进程退出后的恢复。没有再次运行无关的协议、内容、网络长测或全部后端套件。

### 独立并发 stop 探针

新建真实 PostgreSQL 与一个借出的真实连接，连续调用两次 stop，确认两者返回同一个 Promise 且均未提前兑现；释放该连接后，确认实际 end 已发生、两个调用方同时得到已完成结果，再次 stop 仍可读取同一完成结果。探针 **exit 0**。

此场景补查了新 stopPromise 的调用方语义，不仅检查“第二次停库次数为一”。探针未修改生产文件、未替换数据库、未设置固定 sleep。

## 原始证据

| 文件 | SHA-256 |
| --- | --- |
| targeted-runtime.log | 83ba5c65f5e41ede98b1bda3c1efe408a469df3d5ec7a2fc0d3705173afd44b5 |
| concurrent-stop-probe.mjs | ca4791f21d1409a39c59f4838a0b878cf6ba8ffba3634ce34e29811e821899c0 |
| concurrent-stop.log | 981ad6dd30e5db529128ef4339bdf12c293fce450512791c66c145fe0482596e |

## 保留边界

- 旧 R2 首次失败、之后单文件诊断成功与本轮新候选成功分别保留。明确关闭竞态已得到当前回归覆盖，不等于旧失败唯一因果已证实。
- 本轮是独立需求轴的局部复审。由总控汇总标准轴、候选发布身份及后续真实模型条件；不据本报告关闭整票或释放完整 single-ai-runtime。
