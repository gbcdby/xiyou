# SP06 模型与冻结源码对应

对象：`6b71dff96439553b336dd523b2126b7c51f6fa83` / tree `8ed5516ea77f1b299ac2482aa2b24cfa4bdd385e`；逐文件摘要见 [source-identity.json](source-identity.json)。模型工作树基于 `6bc7f62`，最终 `6b71dff` 仅补公共接口表，所有业务和 schema 字节相同。模型作者仅修改形式化文件，产品实现作者与模型独立审查者另有其人。

| 模型符号 | 真实对应与核对依据 | 边界 |
|---|---|---|
| Capture、Raw、Mode | `frontend/src/domain/gaolao-actions.ts::proposeFollow` 只从请求者当前实体 DTO 取得 resourceRevision；`protocol/spatial-schema.mjs::ActionV2` 闭合 oneOf 保留两个互斥版本形态 | Raw 是抽象记录，不是实际 JSON；unused version 的占位0不代表发送该字段，shape=both/missing代表实际 schema 非法 |
| CurrentProjection、knownLegacy | `game/gaolao-world.mjs::projectGaolao` 按 subject/requester/leader/performer 过滤许可，按 subject/requester/leader 过滤随行；`game/spatial-world.mjs` 提供原已公开人物 resourceRevision | **只抽象当前 follow 槽记录的授权子集**，不把旧参与者合法历史写成空。初始 new 从未参与旧许可；真实完整空数组另由 PG 与 GUI 核验。公开语义版本本来可见，不声称零状态变化推断 |
| AccessOK、authenticated key | `backend/spatial-runtime.mjs::submitSpatial` 闭合解析、连接能力、authenticate、runtime.access 在 executeSpatial/Receipt 查找前；key=[sessionId,principalId,clientActionId] | 仅一个可访问 Session；other-session 是无权限范围。密码学/JSON/真实认证存储实现不在 TLC 中 |
| Submit 的 known 分支 | `executeSpatial` 对已知认证 key 先核 actor_id 和完整 semantic_digest，异文 ACTION_ID_REUSE，相同原串返回 publicReceipt，再谈当前 epoch/view；拒绝 Receipt 同样保存 | **advanceSpatialTime 在 Receipt 查找前**；一次效果只指这次提议/许可，不是整个世界、场景时钟不前进 |
| FrameCode、EffectiveFrame | `executeSpatial` 的当前 controlEpoch/控制权、phase、baseSeq、viewId/selfRef，再到 capability 与 `followProposal` 的真实主体、近距无遮挡、开门、在线真人领路者、合法目的地 | observer/refView 抽象不透明引用的观察者与view绑定；多个失败只证明无新提议效果，不保持具体错误码优先级；OTHER_ACTION抽象不产生随行提议的其它动作 |
| FirstDecision、VersionFenced | `game/gaolao-rules.mjs::followProposal` 先保留原资格守卫；public分支比较本人resourceRevision，然后内部取当前私有槽；legacy保留原 expectedConsentVersion 精确检查 | 并发依据不是授权；两个分支都要通过原守卫。模型不检查数字字符串边界或摘要哈希碰撞 |
| apply、RevisionAccounting、SingleBaselineCommit | `followProposal` 创建新的 proposed 随行与 consentRequest，然后两种格式都 bump(subject)；`consentResponse` 回应/撤回已 bump | 效果记录 publicRevisionBefore；VersionFenced 将请求依据与提交时版本联系，SingleBaselineCommit 禁止该公开版本产生两个提交。expected-version变参可能恰好是新鲜版本，不能把它误当成旧捕获版本 |
| SubjectChange | 已授权的 `consentResponse` 对本次许可更新 version/planVersion/status 并 bump 主体 | 本模型不重新证明本人身份、scenePolicy接受授权、路线或自然语言选择；旧 Consent 模型处理部分既有许可/物理关系 |
| Move | `game/spatial-rules.mjs` 和 `game/gaolao-rules.mjs` 的普通运动推进 spatialRevision，保持 resourceRevision | 几何/时间/真实到达另由实际 GUI 验证；其它语义变化可能保守使提议过期 |
| 原子 Submit + lost | `backend/runtime.mjs::locked` BEGIN→session FOR UPDATE→operation→persist→COMMIT；executeSpatial 在同一tx保存规则效果及 action_receipts。确认可在COMMIT之后丢失 | 读公开参数在事务之外。TLC假定上述原子性，不模拟数据库崩溃/隔离实现；真实PG、OUTCOME_UNKNOWN消费者另有运行证据 |

旧 [Consent.tla](../model/Consent.tla) 没有公开 revision、nonce/Receipt、读提交分离或新入口投影，本次不能沿用其绿灯代替新证据。旧导航模型也未重跑；本模型不声称完整 Consent/Nav/全章组合。

源码守卫顺序、同事务更新、投影过滤、schema 或未知恢复策略改变时，应重新核模型及对应。当前资料是逐符号工程对应，runner 的 `implementation_status: NOT_ASSESSED` 原样保留；真实实现验收单列，不将模型通过称为代码形式化证明。
