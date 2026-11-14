# 翠兰本人回应 F1 接口

本文件绑定 [CS-R2](../docs/specs/gaolao-scene-policy.md) §10～17 和 [CS-T01](../docs/specs/gaolao-cuilan-self-response-tasks.md)。它冻结接口、类型、内容和只读合同，**不表示新房间已可玩，也不表示 D1、FM 或产品验收完成**。实际运行接线由各票完成后在固定集成候选检查。既有 Receipt 只收束原动作历史并触发 sync；权利与返还集合仍由现有 Snapshot/Batch 的 session/view/generation/seq 更新。

## 1. 精确版本与职责

| 对象 | 旧值保持 | 新登记值及原因 |
| --- | --- | --- |
| content | `gaolaozhuang-v1`、`gaolaozhuang-tools-east-v1`、两个 `scene-v2`，原文件/digest 不变 | `gaolaozhuang-scene-v3`、`gaolaozhuang-tools-east-scene-v3`，增加两份本人声明及个人许可语义 |
| chapter / reducer | 原 chapter-v1/v2、`gaolao-world-v1` 保持原解释 | `gaolaozhuang-chapter-v3` / `gaolao-world-v2`，新增两轴请求、逐物取得与返还，不能借旧解释器默认字段 |
| scene policy | `gaolao-cuilan-v1` 原 parser / N1～N6 | `gaolao-cuilan-v2`，显式 rescue/follow/appearance/private_items 分支 |
| 网络协议 / capability | `schemaVersion:2` / `spatial-v2`；appearance/object-visual 两能力不变 | `gaolao-personal-consent-v1` 必须显式协商，不能剥字段降级 |
| 地图 / variant | 两旧布局、几何、资源不变 | 均为 `gaolao-layout-v1.1`；默认 `west-tools`、另一变体 `east-tools`；Session seed 仍按原开局持久保存 |
| 正式图片 | 原 65 PNG / 18 张批准原图 | 不增加、不重写。仅新默认 west-tools 精确映射到既有默认资源；east-tools、未知版本/布局没有默认映射 |

`protocol/spatial.mjs` 导出 `gaolaoPersonalProfiles` 和 `gaolaoPersonalProfile(value)`。后者同时匹配 content/chapter/reducer/map/variant，返回完整登记项或 null。不可改成前缀匹配。该表及生成声明来自 `spatial-schema.mjs`。

新内容规范摘要：

- 默认：`9fe67da426ec0d8cfb8d28ccc58dcfaf07d45da13a57371c808fd783dd04fce6`。
- tools-east：`5afb3fda35fdc0143513406dc1f69392c597c32ee925de088f7f649b02e7c1ff`。

T01 负责服务端 capability 在 create/join/bind/control/snapshot/sync/action/reconnect 的接线、新 reducer、初始化、原 Receipt 优先和事务恢复；F1 尚未启用这些新运行路径。T02 负责三个 scene 文件中的新策略分派；T03 负责 Lobby 默认值及页面中旧 reducer/catalog/scene 版本判别。默认页面新建 v3，既有房间仍用其持久版本。

## 2. 公开合同

唯一字段源为 `spatial-schema.mjs`；`spatial.schema.json`、`game/spatial-types.ts`、声明及受影响 AI schema/TS/Python 由原生成器更新。模型 action kind 白名单没有加入玩家取消能力；规则仍独立限制人物与权限。内容结构源为 `content/spatial.mjs` 的 `spatialContentSchema` 及 `gaolao-schema.mjs`，原 `content.schema.json` 仍是未改动的 region-v1 生成物。

| 入口/类型 | 精确形状与消费规则 |
| --- | --- |
| `gz-describe-private-items` | interact 原 targetRef/expectedTargetRevision；不带 parameters。目录只说明两个名目，不产生 grant |
| `PersonalAppearanceParametersV1` | `{destinationId,permissionTerm,replacement?}`；term 为 single_use 或 reusable。新版本提议不得携带/猜测私有 expectedConsentVersion |
| `PersonalPrivateItemsParametersV1` | `{offerRef,itemOptionRefs,permissionTerm,replacement?}`；去重 1～2 个 option。option 不是 EntityRef 的操作授权 |
| `PersonalRequestReplacementV1` / `cancel_personal_request` | 同一 `{consentId,expectedConsentVersion,expectedLifecycleVersion}`；取消 action 另有 kind。原请求者明确取消/改约，不能写本人 withdrawn |
| `PrivateItemOfferV1` | offerRef/subjectRef/sourceRef/sourceRevision/options。每 option 只有 optionRef/label/handling=retrieve_to_owner；不含 itemRef、正文、实时位置 |
| `PersonalRequestViewV1` | consentId/purpose/lifecycleVersion/lifecycle/executionState/reasonCode/reason/permissionTerm/scope。与当前可见 consents 按 ID 关联；最多两用途各一项 |
| scope 摘要 | appearance 为 destinationId/performerLabel/usage=inquiry_meeting；private 为 handling/ownerLabel/items，每项 label 和 nullable origin。未获原处说明前 origin=null，实际接受后的原处是内容登记信息 |
| `PrivateReturnViewV1` | returnContextId/originalConsentId/acceptedConsentVersion/sourceLifecycleVersion/itemRef/itemRevision/mode/ownerLabel/nullable ownerRef/origin；mode=delivery_pending 或 return_only |

v3 的 `chapter.personalRequests`、`privateItemOffers`、`privateReturns` **全部必需**，无项时是空数组；不能省略后当 active/同意。旧内容不携带这些字段。Snapshot、Batch 和 ControlResponse 都核对相应版本与新字段；返还 item 必须真实出现在本人 held 投影中且 revision 一致，ownerRef 非 null 时必须存在当前可见实体。两件返还的 itemRef / returnContextId 不重复。

该个人策略仅针对真实翠兰。八戒钉耙仍走原本人的独立授权，不能因为整个房间是 v3 就套用翠兰目录/scene basis。新目录入口在未识破的同貌对象上仍同样显示，只有实际询问才由真主体守卫判定；不能用入口有无泄露真身。

T03 从 `privateReturns` 直接构建行囊的“交回本人 / 放回原处”，不经当前 consents 过滤；依旧构造普通 transfer_item/put_item。不可见 ownerRef=null 时保留说明并先让玩家走近，不能按名字找同貌人物；origin 是登记原处，不能改成脚边。任何新动作使用当前物品版本和当前 envelope，原 Unknown 保留原 ID/原文。

## 3. 可信持久记录与共享函数

`game/gaolao-personal-contract.mjs` 由 T01 独占；T02 只导入。该模块没有网络调用、事务写入、人物决定或 provider 调用。全部私有 schema 为闭集，不导出到玩家 wire。

| 导出 | 用途 |
| --- | --- |
| `PERSONAL_CAPABILITY`、`PERSONAL_SOURCE_IDS` | 精确能力与 appearance/private_items 两 sourceId |
| `validatePersonalScope`、`personalScopeDigest` | 私有 scope 形状及含 purpose 的规范 SHA-256；term 创建后不可编辑；reusable 可被合法提出 |
| `createPersonalState`、`requirePersonalState` | 新局的 personalRequests/privateAcquisitions/privateItemOffers 三个对象；检查不为缺字段补默认，旧局不调用初始化 |
| `validatePersonalRequestRecord` | 按原 consent 校验两轴、不可变 proposalBinding、实际接受 proof 与逐物使用字段；accepted 缺 proof、term 错误或以旧提议版本冒充实际接受均拒绝 |
| `personalDecisionBinding`、`validatePersonalDecisionBinding` | 为当前指定用途读出固定依赖；不扫描另一用途/远处物件/旁人控制。无当前槽返回 null；缺失新记录明确报错 |
| `personalSources`、`ownPersonalSource` | 前者只导出内容有限知识；后者只读真实翠兰的对应持久来源，校对完整声明/digest。旧内容或缺失/错配来源返回空/null，不伪作人物决定 |
| `validatePersonalSourceBinding`、`validatePersonalNotice` | 来源 sourceRef/observationRef/两水位/版本/digest 与实际 grant 中断通知的严格合同 |
| `validatePrivateItemOfferRecord` | 私有目录绑定 session/requester/subject/view/content/source/digest 与 option→item 名目解析；普通 resolveRef 不接受此绑定 |
| `validatePrivateAcquisition`、`privateReturnAcquisitions` | 取得记录严格校验及完整选择；只认真实 held item 的 personalAcquisitionId，不查当前请求槽或近期观察窗 |

持久 `chapter.personalRequests[consentId]` 保存 lifecycleVersion/lifecycle/reasonCode/transitionActor/transitionSeq、proposalBinding、execution 和 nullable notice。`consent.status/decidedBy` 保留原本人决定；系统失效/请求者取消不改写它。

`proposalBinding` 包含 subject/requester/nullable performer 的真实 ID 与 epoch、scopeDigest、content/chapter/map/policy、提议 consentVersion、原 requestActionId/requestDigest、sourceSeq/requestObservationRef/receivedSeq。后两水位及 observationRef 指本人实际收到的原请求摘要，不能从当前状态补造过去。

`execution` 为 state、nullable acceptedProof、appearanceStarted/appearanceEnded、itemUses。proof 绑定**本人 accept 实际生成的 consentVersion**、原 actionId/requestDigest、原参与者/范围/版本及实际本人 source binding；它不得回写 prepare basis。每个 itemUse 有 itemId/takeActionId/acquisitionId/outcome；pending/already_at_owner 没有伪造的取物身份，其余结果保留首次 take 身份，每个 item 最多一次。

`chapter.privateAcquisitions[acquisitionId]` 保存 itemId/holderId/真实 ownerId/originalConsentId/acceptedConsentVersion/sourceLifecycleVersion/scopeDigest、takeActionId/requestDigest/takenAtSeq、origin、outcome 和 nullable resolvedByActionId/resolvedAtSeq。成功取得时真实 item 的 `personalAcquisitionId` 指向它；这不是客户端可编辑账本。原 consent 不再 current 或旧观察落窗不会改变该指针。返还后保留原取得记录，只更新实际处置结果；下一次合法新取得使用新 ID。sourceLifecycleVersion 记录取得时的原请求版本，仅解释历史，不授权旧 grant。

本人声明写入原 provenance：`metadata.personalSource` 取 `personalSources(content)` 的对应完整对象，并同存原 `retainedObservation`。目录为每个 requester 的当前 view 下私有记录；新目录可以替换旧目录，但已经提交请求的 scope/摘要和原 Receipt 不随之改写。

## 4. T02 与 authority 的接点

T02 的 v2 私有 basis 顶层继续保留 actionId/requestDigest/stepKey/evaluatedThroughSeq、content/chapter/map、subjectEpoch/viewId/subjectRef/subjectRevision、previousIntentId/attempt。新增 `branch` 为 rescue/follow/appearance/private_items；个人分支以 **`personal`** 保存 `personalDecisionBinding(state, actorId, purpose)` 的结果，以 **`sources`** 保存本次 `ownPersonalSource` 去掉 knowledge 后的严格 binding。`knowledge` 仅供纯策略读取本人声明；实际本人回应仍由策略提交。

T02 继续负责整个 basis 的严格判别 parser、按实际 choice 选择依赖、prepare/commit 重算同 choice/action/stepKey，以及 Unknown/语义水位。D1 只在其成功重验后读取 `tx.scenePolicyAuthorization`；个人 accept/withdraw 再独立核对 branch/personal、真实本人、两版本、scope/term 和 proof。不得给公开请求添加“验证通过”字段。

personal withdraw 的相关依赖只含当前原请求、旧 proof/对应 notice、本人当前授权/来源与内容，不要求旧 requester/performer 仍在线、近距或保有旧 epoch。response 对原 proposed 则校验 proposalBinding 与真实本地资格。另一用途变化不应改变本份 personal 依赖；follow/rescue 的旧来源/路线与 guard 不混入个人槽。

`notice` 精确字段为 noticeId/consentId/acceptedConsentVersion/reasonCode/sourceEventId/sourceSeq/receivedSeq；reasonCode 仅 binding_invalidated/appearance_disclosed。它来自实际失效/结束提交且持久保留；系统停权与本人后续 withdrawn 分别记录。场景唤醒只消费提交后的相关事实。

## 5. D1 接线与完成边界

F1 尚未更改 `reduceSpatial` 新解释器接入、runtime 能力门禁、新局来源写入、权威动作/投影或生产 scene。D1 在同一 Session 事务中落实：提议/取消/替换/本人决定、apply/take、控制/终态/公开揭明、逐物 transfer/put 及相应版本、Observation、Receipt。新 take 和接受均独立验证 single_use；已有持物的窄归还不能依靠旧 grant 复活。

有效原 Receipt 读取先于首次领域条件重验；终态、暂停、恢复的具体执行资格与窄归还规则必须在 D1 的真实事务检查中区分。T01 不改 T02 scene 源码、T03 页面、T04 harness/CI、形式模型或任何图片。类型/纯合同样本不是数据库、生产本人回应、真实浏览器、独立审查或有限模型的替代证据。
