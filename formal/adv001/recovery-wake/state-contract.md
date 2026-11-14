# 002 统一恢复与语义唤醒契约（实现前固定）

## 事实与接口

当前 `spatial.clock` 的 payload 只有当前暂停值和时间；`paused=false` 既可能是真人恢复，也可能是普通运行步进。因此新注册 actor 没有基线时，不能从单个 false 或之后的数据库快照推断 resume。

拟在既有进程内 `AuthorityRuntime` 的 `commit` 通知增加可选 `spatialPauseBefore: boolean`，取自该真实已提交事务读取的初始 `tx.row.state.paused`。订阅者按本通知既有有序 events 折叠，只有确实 true→false 的 `spatial.clock` 才产生 resume 语义唤醒。通知仍在真实 COMMIT 成功后发出；不改变 WorldEvent、客户端 DTO、模型输入、持久表、公开 API 或规则。region 通知不加字段。只有现有 Runtime→Orchestrator 私有通知合同增加该事实。

复用既有 `sessionSeq` 作收到的语义事件水位；不新增事件 ID 或持久队列。每个 actor 分开保留：

- `dirty`：初始启动、显式 wake、已有限次授权的技术重试触发。
- `pendingSemanticSeq`：已收到且尚未由新决定上下文消费的合法语义唤醒水位。
- `lastSemanticSeq`：去重水位；重复或更早的语义通知不会再增加调用。

恢复读回的 `sessionPaused` 不再用于事件判定，删除此前猜测分支。接收语义事件不依赖恢复读是否开始、完成或返回。

## 阶段表

| 阶段 | 收到真实 resume / 本人新 Observation 等既有合法语义事件 | 收到普通 clock / 无关 move / 重复语义事件 | 完成与消费 |
| --- | --- | --- | --- |
| 恢复读取之前，包括已 checkout 尚未 BEGIN | 去重后保存 pendingSemanticSeq；不调用模型 | 不产生新计划触发 | 原恢复继续；读取值不能清掉已收到的语义事件 |
| 读取之后至返回，包括真实 COMMIT 后延迟返回 | 同上，完全不依赖读取的 paused 真/假 | 同上 | 返回只带回待恢复原请求；不消费语义唤醒 |
| 原 Receipt / outcome 尚未收束 | 同上；新事件排在本人原请求之后 | 同上；技术 Unknown 只使用原有有限重试 | 原请求或确定拒绝按现有规则收束；技术失败保留原请求和语义水位 |
| 原收据已收束，Idle | 有待消费语义水位才排下一次正常规划；纯技术恢复没有该水位 | 不追加调用 | 通过原准备、授权与预算门槛取得新 context；消费该 context 已包含的水位 |
| 新推理在途 | context 之后的新语义水位保留为下一轮 | 同上 | 当前原文提交不换 nonce/序号；下一轮仍受共享并发和间隔约束 |
| Unknown 自动重试耗尽 / 确定授权失败 / 预算耗尽 | 保留尚未消费语义信息，但它自身不得造成无限恢复循环 | 不恢复计数、不新调用 | 显式恢复或新合法触发仍需先过原请求和当前授权；终态清理待执行唤醒 |

## 不变量

1. 收到的语义事件在三个恢复阶段采用同一入口保存；不会因一次数据库读取快照覆盖或清除。
2. 纯恢复只处理原 Decision/Receipt/raw/digest/nonce/navigation seq，不产生 pendingSemanticSeq，不调用 provider。
3. 本人原结果未确定前，新规划不得越过它；001 三次自动重试上限、间隔和显式恢复接替旧 retry 保持。
4. 真实 resume 由提交事务中的 true→false 证明，普通 false→false clock 无权触发；原合法 Observation/相关目标判定不扩大。
5. 同一语义事件最多进入一个有效上下文；去重与已消费 context 的 baseSeq 水位共同阻止重复通知额外调用。
6. 新规划仍经过现有授权、epoch、终态、持久预算和单角色在途限制。内部通知不是授权。
7. 显式恢复只清理旧技术触发；期间已经收到的独立语义水位不会被当作旧 retry 清掉。

## 计划验证范围

逐字原 BEGIN 前反例、原恢复完成后反例、原 57014 反例；真实服务三个阶段的 resume 和本人 Observation；普通运行 clock/无关 move、重复事件、技术重试上限与显式恢复保留新语义。复用既有真实 PG、HTTP/Socket 和正常业务 API，不改业务记录或返回值造例。仅上述范围，不扩 scene policy、UI、协议、全章或外部模型。
