# 外部资料与核验范围

本文件为[总设计](../../初步设计文档.md)提供可点击来源，取代无法在仓库解析的旧会话引用标记。技术资料于 **2026-11-11** 读取；这只支持相应的能力说明，不表示项目已接入、锁定具体版本或完成运行验证。

## 本轮核验的技术资料

| 主题 | 官方来源 | 支持范围与限制 |
| --- | --- | --- |
| Vue 3、SFC、路由 | [Vue Introduction](https://vuejs.org/guide/introduction.html)、[SFC](https://vuejs.org/guide/scaling-up/sfc.html)、[Vue Router](https://router.vuejs.org/introduction.html) | 组件化、响应式、构建型应用中的 SFC 与官方路由；项目具体版本在实现时确定 |
| 房间广播 | [Socket.IO Rooms](https://socket.io/docs/v4/rooms/) | room 广播属于服务端能力，本身不证明事件持久化或世界一致性 |
| 多服务器广播与恢复 | [Redis adapter](https://socket.io/docs/v4/redis-adapter/)、[Connection State Recovery](https://socket.io/docs/v4/connection-state-recovery) | 传统 Redis Pub/Sub adapter 不支持恢复；恢复需显式启用且依赖兼容适配器，也可能失败 |
| 并发共享类型 | [Yjs Introduction](https://docs.yjs.dev/)、[Shared Types](https://docs.yjs.dev/getting-started/working-with-shared-types) | 共享类型可合并并发更新；最终同步需要更新送达。限制其只用于笔记等子系统是本项目决定 |
| JSON 数据与索引 | [PostgreSQL JSON Types](https://www.postgresql.org/docs/current/datatype-json.html) | 支持 jsonb 与相应索引，不等于具体 Event Store 的性能或事务语义已经验证 |
| Session 原子提交与串行化 | [PostgreSQL Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html)、[Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html)、[Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html) | 行锁与唯一约束可支撑 M0 方案；所有本局写入仍须统一遵守锁与事务。序列计数不会随事务回滚，连续 `sessionSeq` 需使用受锁保护的事务字段；资料不能代替实现或故障验证 |
| 传输与应用重试 | [Socket.IO Delivery Guarantees](https://socket.io/docs/v4/delivery-guarantees/) | 默认至多一次投递，持久日志、动作去重、收据与恢复由应用实现；不声称网络恰好一次 |
| 异步流与消费组 | [Redis Streams](https://redis.io/docs/latest/develop/data-types/streams/) | 提供追加式流和消费组；不由此推出恰好一次执行或故障下不丢数据 |
| 形式化工具 | [TLA+ Tools](https://lamport.azurewebsites.net/tla/tools.html)、[TLC 文档](https://www.docs.tlapl.us/using:tlc:start) | TLC 对可执行规格进行显式状态检查，可检查 safety/liveness；项目结论仍需绑定具体有限模型、配置和检查证据 |
| 模型接口候选 | [百炼 OpenAI 兼容接口](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)、[文本生成](https://help.aliyun.com/zh/model-studio/text-generation)、[SDK](https://help.aliyun.com/zh/model-studio/install-sdk) | 提供兼容调用方式与 DashScope；具体模型能力、地域和 endpoint 需要匹配，尚不是项目已选定的供应商 |

## 待重新核验的外部信息

| 内容 | 当前证据状态 | 后续使用前需要 |
| --- | --- | --- |
| 魔搭活动与报名时间 | 旧稿记载“第三期 AI 造游戏”“2026-12-01 10:00”；原始可访问来源与时区未随文保存，本轮未核验 | 当前官方活动页面、核验日期、明确时区、规则与提交要求 |
| 赛事部署、试玩、视频与社媒要求 | 旧稿有要求摘要；不能作为当前已确认条款 | 官方完整条款与实际提交入口 |
| 具体素材的版权与授权 | 保留项目原创、公版参考或获授权素材的原则；本轮未做具体法律适用或授权审查 | 逐项真实来源、许可范围与必要授权记录 |
| 历史风格图与文章配图 | 当前基线没有原图与配图 | 见[美术来源记录](../design-direction/references/provenance.md)，不把继承编号当成已入库素材 |

外部资料变化时只更新受影响的判断，并保留新的核验日期。技术文档、设计选择、模型检查和产品实测是不同证据，不互相替代。
