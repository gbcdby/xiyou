# RRS 设计与有限验证交接

任务 [#66](https://github.com/gbcdby/xiyou/issues/66)，模式 design/check。合同见 [CONTRACT.md](CONTRACT.md)，实际模型运行见 [REPORT.md](REPORT.md)。本 worker 没有实现业务、编写/运行项目测试或开启服务；真实实现状态保持 NOT_ASSESSED。

## 必须落实的语义

1. 原lane item仅保留既有kind和入场引用；同一同步turn固定原请求R、当前V、真实sent A、准确前置publisher。不能到开始执行时重新认领前置资格。
2. 执行时先确认同V及真实S>A。原R全部授权/下界/持久binding/epoch守卫先完成，内部sentPrefixStart随后对照真实S/current/scope/pending/closing；不得与旧ceiling并用。
3. 一个统一的有效from同时驱动原分页、stateAt、self trail和Batch.from；不复制授权检查，不先做旧批后裁轨迹。原Q、256与首完整事务回退、highWater、DTO验证保持。
4. 入场已旧、前置RPC/timeout、无真实推进、不合格能力、direct runtime.sync保留原路径。新head或客户端游标不能成为真实sent许可。
5. RPC仍优先、工作占lane到自然settle。新ACK真实入队可推进sent，使后W covered，但W自己的settle与G锁内重核/COMMIT/settle不可跳过；新提交不补入旧P。
6. 同link push和ACK仍同步消费、完整连续校验。拒收/超时不能跳前缀；有fresh需求时下一旧cursor走history修复，无需求时保留等待。
7. 错误、未知提交、关闭、换binding沿原自然收束，不复用proof、不回滚成功peer水位、不假取消SQL。

## 可自由选择与不能推断的内容

闭包标量、item字段和内部选项命名可由实现方选择，生命周期只需一次RPC；不需要缓存、额外队列、定时器、协议字段或独立服务。模型的Read/Send原子步骤是实现义务，不表示任意代码块天然原子。

模型固定旧P={1,2}，初始W0之后最多一个后继W1和两个原G；W0/W1不同时活动，新RPC的sent进展是独立真实事实。它补了旧Wave.RPCBoundary的**有限组合缺口**，不构成旧全部wave模型的refinement或任意peer数量证明。

## 真实验证场景（本worker均NOT_RUN）

| 场景 | 可观察断言 |
|---|---|
| RRS-T01：publisher已授权COMMIT、真实send前暂停，R=A的RPC排队，再提交B，放开push | 真实wire先push(R,S]再新ACK(S,T]，原adapter proof推进可信sent；当前consumer对每段只应用一次。旧baseline ACK(R,S]应形成明确RED。 |
| RRS-T02：同步消费与接受后通知异常 | 合法先行push接受snapshot在ACK之前；显示通知异常不能倒退已接受cursor；延后消费的负控应显露不连续。 |
| RRS-T03：入场已旧/consumer拒收后fresh恢复 | 原R<A保持历史完整页；拒收push后新ACK不越cursor；一次fresh请求触发的原分页恢复缺失前缀，ACK自身不递归补读。 |
| RRS-T04：前置RPC及旧ACK超时 | 前置RPC不取得race资格；旧服务端工作占槽至settle；遗漏ACK仍能被后续真正旧cursor重放。 |
| RRS-T05/06：原R非法、能力/权限和current变化 | 内部S不能洗白低于createdAtSeq的R；旧V/scope/pending/closing/epoch和token错误不发送或推进新binding。 |
| RRS-T07：空批、超过256与首完整事务回退 | Q=S的空ACK正常；大页仍保持原完整事务界、trajectory起点与8页/首frontier逻辑，不追无限新head。 |
| RRS-T08：W已排队、RPC先推进、旧G仍在途 | W covered之后仍settle，后G仍锁内重核且真正COMMIT/settle；多peer/第6handle原测试保留，不能用单peer模型替代。 |
| RRS-T09/10：兼容、未知提交、无ACK/伪proof | OFF/legacy/direction-only/direct runtime路径不产生新内部start；mixed仅精确合格子集改变；失败/未知结果不造proof、不假取消。 |

原normal→late→five及官方CI仍是最终动态验收。该模型不预测节省毫秒数，更不能把旧SQL响应时间全部归为锁等待或CPU收益。

## RRS-DESIGN-01 的交接结论

新合同明确改写W-12历史/race范围；模型加入真实RPC sent生产者、等待W covered、W/G独立settle及原P逐行提交。具名见证和负控的实际原件支持此有限组合范围；是否接受关闭问题由总控独立核验决定。旧设计r1及旧模型原件不覆写，采纳和实现释放由总控记录。
