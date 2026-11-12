# 高老庄 A2 机器接口

适用 #32 / ADV-001 v0.2、adv-protocol-v1/r2。唯一字段源为 `spatial-schema.mjs`，生成 `game/spatial-types.ts`、`protocol/spatial.d.mts`、`protocol/spatial.schema.json`；前端直接消费这些类型，不另存手写副本。旧 region-v1 与 spatial-graybox-v2 不改解释器。本增量的内容解释器为 `gaolao-world-v1`。

此接口准备提交不表示完整灰盒或下游释放。#32 完整协议/候选释放仍须完整路径、身份/资源反例和独立双轴；#33 在此前可准备类型和组件。

## 公共动作

全部动作保持 PublicEnvelope、当前 viewId/actorRef、controlEpoch、baseSeq 与原 clientActionId。移动发出顺序、Receipt 和未知结果恢复不变。Actor、owner、同意主体均只使用观察者自己的不透明引用；不得从姓名解析实体。

| 动作 | 参数及语义 |
| --- | --- |
| propose_follow | subjectRef、leaderRef、destinationId、expectedConsentVersion；创建新提议，须真实本人回应后才能跟随。期望版本是该主体现有 follow 用途同意版本，无记录为0。 |
| respond_consent | consentId、expectedConsentVersion、response=accept/decline/defer；真实同意主体独有。每次有效回应提升版本。 |
| withdraw_consent | consentId、expectedConsentVersion；真实主体撤回，取消依赖旧许可的活动计划。 |
| request_end | proposalId、proposalVersion、scope=chapter/recruitment；proposalVersion 是当前确认轮版本，无记录为0。请求者作为首位确认人，其他当前在线真人须各自 confirm_end。 |
| confirm_end | proposalId、proposalVersion；使用投影显示的新版本；在线集合变化使未完成轮失效。 |
| interact | targetRef、operationId、expectedTargetRevision；有限参数见下表。NPC 目标的语义版本取 EntityViewV2.resourceRevision；场景目标沿 TargetViewV2.resourceRevision。 |

## 有限 operationId 与参数

无参数操作省略 `parameters`。字段组合必须与操作相符，不能填写世界旗标或控制主体。

| operationId | 目标与参数 |
| --- | --- |
| gz-contact / gz-check-seal / gz-try-key | 侧窗/铜封目标；无参数 |
| gz-step-back / gz-break-seal | 真实翠兰本人/铜封；仅声明的受信本人动作；无参数 |
| gz-confirm-settlement / gz-pause-follow | 真实本人；{consentId, expectedConsentVersion} |
| gz-request-appearance | 真实翠兰；{destinationId, expectedConsentVersion}，目的地为本局会面点 |
| gz-apply-appearance | 悟空本人；{consentId, expectedConsentVersion}；仍重验翠兰许可及悟空本人意图 |
| gz-release-appearance / gz-reveal-identity / gz-check-appearance | 对应有权目标；无参数；知识只传播给实际在场合法受众 |
| gz-read-ledger / gz-hear-witness | 旧账/见证人；无参数 |
| gz-compare-sources | 会面/比较点；{evidenceRefs:[旧账观察, 独立证言观察]}；原始来源重复不能伪装独立 |
| gz-show-passage | 唐僧本人；无参数；生成本人获准展示材料，仍需实际分享送达 |
| gz-invite-meeting | 被邀请本人；{destinationId, expectedConsentVersion} |
| gz-confirm-meeting | 真实唐僧或八戒本人；无参数；实际会面且双方材料送达后提交其说明 |
| gz-recruitment-decision / gz-membership-decision | 对应本人；{expectedDecisionVersion, response:accept/decline/defer/withdraw}；知情条件不自动选择 |
| gz-release-support | 门撑；无参数；开门后拆回有限公共物 |
| gz-return-public | 归还点；{itemRef, expectedItemRevision}；实际放回 |
| gz-plan-departure | 合法会面点；无参数；只有前置满足且当事人实际收到安排后才开放受限导航 |
| gz-join-party / gz-finish-separation | 本人；无参数；重验真实去向及仍有效决定 |
| gz-request-private-items | 实际物主；{itemRefs, expectedConsentVersion}；按本次物品及请求者范围登记独立许可 |

## 授权状态

`ProjectionV2.chapter` 只在高老庄版本出现。包含本人 `responsibilities`、已经合法获知的 `progress`、有资格查看的 `consents/follows/decisions`、公开目的地、在线结束确认轮和本队公共借用清单。`route` 仅向具有相应知识的人出现；未识破者不会看到乔装标签。`EntityViewV2` 可增加 resourceRevision 与 availableOperations，不能包含真实ID、actorKind、roles 或 controller。两张同名“翠兰”必须保留各自 entityRef、位置和选择入口。

同意 scope 只含本次 destinationId/leaderRef/itemRefs；用途由 purpose 区分。随行 accepted、following、arrived、settled 是不同状态。撤回后的 CuilanSafe 不回滚。Decision 的 deferred/declined/withdrawn 分开显示，沉默不能显示成拒绝。

`consents` 是有界当前视图：优先保留该观察者有资格查看的全部当前用途槽，再用最近历史填满协议既有的 256 条容量。当前许可不能被较新的历史挤掉；完整持久记录不删改。新的同意变化另形成发生时参与者专属、不可分享的观察，供终态授权复盘分页读取；不向在场但未参与许可的人补发。观察只记录当时的用途、状态、版本、公开目的地和不透明许可编号，不输出内部人物标识，也不按后来知识重写。

全员确认结束招徒后，本局不能再新增招徒/加入决定或形成 GZ-E01；本人仍可撤回已留存的决定。已有决定的历史结果保留，不改写为拒绝。该选择取消依赖旧离庄安排的活动路线，仍须完成安全、归还与真实分别去向后才能形成 GZ-E02。

观察可带 `source`：不透明 sourceRef、来源种类、已授权说明、到访前天数与 receivedSeq。分享保留原来源，不把 Claim 升格为 WorldFact。只有合法观察能够进入比较/送达事实。

`RecapV2` 按当前访问资格及发生时授权记录分页；不以后来知识改写旧姓名、旧引用或受众。通过现有 `/api/sessions/:id/recap?throughSeq=...` 读取，返回 schemaVersion=2。旧空间灰盒继续原行为。

分页先按发生时受众过滤，再按 `eventSeq` 倒序取最多 100 条。当前每个事件对同一观察者最多产生一个条目；事件序号在本局唯一。存在后页时，`nextBeforeSeq` 精确等于本页最小 `eventSeq`，后页使用严格小于 `beforeSeq` 的事件；否则为 `null`。空页只能返回空游标，不以隐藏事件数产生额外空页。整次读取固定终态 `throughSeq` 和 `phase`；水位不符返回 `RESYNC_REQUIRED`。客户端可以保留同一事件的多条展示，但不能跨页重放已读条目或自动更改水位。

## 授权样例

下面是结构示例，不是运行证据。八戒未识破时，对借貌者仅可见 `{entityRef:不透明A,name:"翠兰",appearanceEpoch:当前外观版本,...}`；若同时看见真实翠兰，得到另一不透明B及独立位置。已知观察者可见合法称呼“孙悟空（借貌）”；它的引用仍独立于八戒的A。向A转交物品的收据和 ownerRef 均只使用八戒视图内的A，内部真正owner仍是悟空。

受信执行入口保持 `bindInternal → observeInternal → reserveSpatialIntent → submitSpatialIntent`。只允许同一合法角色的有限动作，移动序号仍由服务端预留。scene_role 与自主角色的真实actorKind在内部核验；HTTP/Socket不提供内部句柄。受控策略和未来真实模型使用同一规则、事务与Receipt；本票不交付真实Gateway或公平模型队列。

受信导航在预留时绑定其实际目标所依赖的本人会面许可或离庄安排；此依据只在内部执行上下文与计划中保存，不新增公共参数。目标为约定会面点或通向该场景的声明出口时，绑定许可主体、用途、目的地和版本。撤回、改约或安排失效只取消相应依赖路线；提交与步进均重验，晚到意图不能改绑当前许可。原样重试仍返回原 Receipt，无关目标的普通导航继续有效。

A2 调用方使用生成的 `GaolaoInteractionV2` 与 `gaolaoInteraction(value)` 构造有限操作，使用 `isGaolaoInteraction(action)` 取得精确的 TypeScript 窄化。为兼容旧内容的任意字符串操作名，通用 `ActionV2` 的旧分支不能独立提供该窄化；运行时仍按严格判别 schema 检查。授权输出的原始 JSON 解析保留完整合法历史页，不沿用外部请求的 64 KiB 限额；请求限额与严格重复键拒绝保持。
