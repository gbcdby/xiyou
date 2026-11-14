# 固定释放计划的逐性质事实边界

核对对象：计划 commit `35d8759aac469eba5a8d9d4b94a787a3e62330c5` / tree `d838c05f22b54601dc9f291df028975347850c47`，`docs/specs/gaolao-cuilan-self-response-release.md` §2.3。本文只映射真实有限模型证据，不修改计划的 gate 或替 root 作实施/产品释放决定。

**本轮最终状态：组件设计证据已冻结；整体形式组合未闭合，生产实现对应 FM 尚未执行。** 最终选择的 131 个配置中：28 个正向完整检查，98 个预期反例/见证，5 个 INCONCLUSIVE。另保留所有原候选、诊断及超时，共 178 次真实运行。不存在“131/131 正向通过”的结论。

| 计划映射 | 本轮已完成的形式证据 | 仍未闭合/实现义务 |
| --- | --- | --- |
| **MF-VERSION** | source/epoch 符号边界与严格来源相等见 Consent；所有模型绑定固定设计对象 | 精确 content/chapter/reducer/policy/capability 解释器、旧事件原解释、缺字段不授予权利、资源 alias 未建模。F1 真实版本/schema/恢复契约须另核。 |
| **MF-TERM** | Terms 正常配置 1,196 /25 /2,954 状态；两种用途的独立 use 防线各20状态；所有对应负控与补救见证实际触发。Authority private 93,536、restart-private 639,440 状态检查每请求×物件一次与另一件额度保持 | term→scopeDigest/basis 的真实序列化/哈希未证明；Terms→Consent/Effects 没有机械 refinement。故障注入的 reusable accepted 初态只用于独立使用守卫，不称正常可达。 |
| **MF-CONSENT** | R1 未变 CAS 两配置20/26状态；Consent 11个正向配置分别2,714～112,634状态；相同revision、第三方竞争、旧response/withdraw、两轴归因、C2旧epoch、原Receipt均有实际负控/见证 | 证据保留 R1 身份与未变条款；应用到 R2 要同时满足 Terms 新守卫和原请求身份/版本映射。未证明生产鉴权、SQL CAS、版本/nonce唯一性。 |
| **MF-EFFECT** | R2完整缓存 appearance 单用途10,512状态PASS；权威 private 93,536、restart-private 639,440状态PASS。实际split-stop/split-private、旧能力、旧Receipt复活负控可识别中间残留 | **Authority both 300s仍INCONCLUSIVE**；完整缓存 private/restart/both/cooperative共4项INCONCLUSIVE。未声称两用途效果全交错及缓存组合闭合。原子模型动作是实现事务必须满足的义务，非已证明数据库原子。 |
| **MF-CUSTODY** | 权威私物/恢复完成：原取得不被新槽接管、实际持有人与物主分开、只交owner/origin、逐物归还、delivered与restored分开、已完成物不复用旧额度。新合法request可再处理同物见证实际可达 | 单一location函数是模型表示边界，实际持久存储不能复制/双持有须由真实约束验证；真实itemRevision、物主/原处、距离/LOS/可放置条件、离线持有未执行。两用途总图仍未完成。 |
| **MF-RETURN** | 权威完整集合与当前view引用派生完成；newslot/旧取得/两件独立/裁剪/refresh见证完成；Projection owner/origin各436状态PASS，旧view/旧seq/旧Accepted安全与活性负控完成 | 精确ownerRef=null、generation/seq缺口规则、生产UI只消费privateReturns、无Unknown乐观删除、真正Socket重连与旧引用被拒仍待实现验收。组件间只给assume/guarantee，没有自动推出全图PASS。 |
| **MF-RECOVERY** | 原R1合同未变：两用途/容量4、扩容量5均15,984状态；重试耗尽33,619状态；Unknown前后提交、原身份、一次效果、未丢另一用途与恢复见证/负控完成 | task必须是当前合法域语义，恢复不得越过R2 Terms与Consent；真实持久intent/事件/通知水位仍待代码对应。BothPurposesProgress未另跑专门时间负控；待办丢失与容量不足已有rc12，活性只在声明有限故障/内部弱公平下成立。 |
| **MF-SAFETY** | 新用途各组件的safe/已知历史单调不变量及rollback负控完成；源合同明确保持旧follow语义 | 本轮未重跑N1～N6/SP06历史模型，更没有证明新增实现不会污染旧follow/到达。C13/两安置/三地点、连续几何及正常生产点击路径仍待定向验收。 |

## 未穷尽的精确剩余范围

Authority both 保留两用途各旧/新两份 accepted/proposed/stop记录、两物 taken/completed/旧取得、外貌实际使用、两位玩家、两view、一次历史裁剪和每物一次重新放置；该配置不含重启环境。最后周期日志为 depth14，14,027,136 generated /2,294,877 distinct /938,288 queued；这是**已探索下界**，不是终局总数，实际剩余队列/总状态未获得。15个安全性质一起启用，未发现反例但未完成，因此不能声称任一性质已在这个完整组合穷尽。

完整缓存四配置又包括历史完整snapshot与当前世界的交错；独立分层没有偷偷把旧cached PASS改写。它们的实际下界、超时和原命令见 RUN_INDEX。未穷尽不自动意味着产品失败；没有发现新R2设计反例，也不以此推出不存在反例。

## T03/T04 明确的代码验收点

旧Accepted仅更新原action历史并sync，不能写当前grant、snapshot、逐物额度或privateReturns。安全负控实际rc12；持续晚到旧Accepted与最新快照交替的时间负控实际rc13（492状态），说明仅有最终同步机会不足以修复错误的Receipt写权限。实际代码须核同槽同active下的take/return/put也送达完整变化、新view旧持物仍有入口、原Unknown确认前不乐观删项，以及服务器独立重验。

FM 计划还要求固定 IC 的真实代码、事务与产品证据；本任务没有 IC，故 **FM 实现对应整体 NOT_RUN**。这些事实可以供 root 逐范围调度，但本 worker 不把模型报告本身记为D1、E2、FM或V2释放。
