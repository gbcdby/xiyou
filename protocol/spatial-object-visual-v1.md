# 首章物件与目标公开美术键

## 0. 身份、范围与依据

| 项目 | 本次记录 |
| --- | --- |
| 归属 | [#33](https://github.com/gbcdby/xiyou/issues/33)；主 Spec [ADV-001](../docs/specs/narrative-adventure.md) / [#23](https://github.com/gbcdby/xiyou/issues/23)，正式运行验收交 [#29](https://github.com/gbcdby/xiyou/issues/29) |
| 标识 | `GZ-OBJ-01 / v0.1`，2026-11-13；有效身份以保存本文的提交为准 |
| 状态 | **设计已通过独立需求/工程标准审查并由主控采纳；本提交提供有界实现候选，正式素材未接入。** 本文补充 GZ-VIS-01，不建立另一套任务或进度来源 |
| 已采纳设计 | `fca8296b699f828f7ae7dd4ee3b424036d8eb125`；本版仅更新实施状态，不改变该设计边界 |
| 设计时核读源码 | `6b71dff96439553b336dd523b2126b7c51f6fa83`，tree `8ed5516ea77f1b299ac2482aa2b24cfa4bdd385e` |
| 素材事实来源 | 本地 `798bae37f940e77e2d48c7ce1b07c948790420d1`，tree `3874175dc4b9042e02d8fada8203ff520929bca4`；该候选的 `docs/design-direction/gaolaozhuang-v1/object-art-binding-handoff.md`、`production-inventory.md` 及 `gaolaozhuang-public-tools-v1/assets-manifest.json`。本文不纳入或公开其图片 |
| 范围 | 第一章 scene-v2 的已授权 Item/Target 外观映射、兼容、消费者降级、视觉文字澄清；不改变动作、引用、物权、许可、碰撞、NPC 决策或历史事件 |

正式约束来自 [ADV-PROTO §5/§7](../docs/specs/adv-protocol.md)、[GZ-VIS-01 §2/§5/§6](../docs/specs/gaolaozhuang-visual.md) 及[角色公开造型合同](spatial-appearance-v1.md)。导航与新领路者提议的独立修复继续按 #34 原候选收口；本候选不修改它们，不启动 EXT-001、后续章或新的发布目标。

### 0.1 设计基线的已观察事实

| 来源 | 当前行为及设计约束 |
| --- | --- |
| [spatial-schema.mjs](spatial-schema.mjs) 的 `object`、`ItemViewV2`、`TargetViewV2` | `additionalProperties:false`；Item/Target 没有公开美术键。新增 optional 字段只能保证新 reader 读旧 DTO，不能保证旧 reader 读新 DTO |
| [spatial-world.mjs](../game/spatial-world.mjs) 的 `canSee`、`spatialProjection` | 先过滤可见对象；Item 还排除 consumed，且他人持有的非 publicBorrowable 私物不投影。输出 opaque ref、公开位置/ownerRef、fields；不输出 itemId/targetId |
| [spatial-rules.mjs](../game/spatial-rules.mjs) 的 `cooperate` | 两个不同站位的真人有效 ready 且物件版本等前提成立，才原子提交。两件工具变 ground，位置为 support target 的位置，各自 `fixed=true`，内部 `lockedBy` 有值；target.locked 和 cooperation.phase 同次变为锁定 |
| [gaolao-rules.mjs](../game/gaolao-rules.mjs) 的 `gz-release-support` / `gz-return-public` | 合法撤收清工具 lockedBy/fixed，保持地面位置；**不清 target.locked 或 cooperation.phase**。归还将实际持有物移到借还 target 的位置 |
| 同文件的 `gz-break-seal` | 合法动作同次令 door.open=true；没有“解封但仍关闭”的独立持久世界状态 |
| `CooperationViewV2` / `spatialProjection` | 只有 phase、总 readyCount、requiredCount 和候选 anchors；没有每个 anchor 的就位/锁定状态，不能按人数或人物位置猜测 |
| [SpatialMap.vue](../frontend/src/features/world/SpatialMap.vue) / [SpatialInventoryPane.vue](../frontend/src/features/inventory/SpatialInventoryPane.vue) | 地面 Item 现为菱形、Target 为方块；行囊为名称/fields/交接按钮。人物已有独立 appearanceId 与资源失败回退，不需为物件重写人物路径 |
| [scene-v2 内容](../content/fixtures/gaolaozhuang-scene-v2.json) | rope 初始 (365,425)，brace 初始及借还点 (315,390)，固定后两件工具都在 (1250,425)；door/support target 的 position 是接近点，不是门图中心 |

以上保留设计基线的静态 `OBSERVED`；设计审查不包含运行、TLC 或正式美术验收。当前实现的作者自查另按候选身份记录，不能回填为设计阶段已经执行。素材 owner/既有独立记录报告散放麻绳的指定静态范围通过，本文仅核读清单，不重新认证其艺术结论。

## 1. 最小公开接口

新增一个可选标量，名称统一为 **`visualKey`**：

```ts
type ObjectVisualKeyV1 = string;
// 机器合同：1–64 个字符，只允许首位 a–z，后续 a–z、0–9、连字符。
// 正则必须锚定完整字符串，拒绝尾随换行；不是 URL、路径或实体引用。
type ItemVisualExtensionV1 = { visualKey?: ObjectVisualKeyV1 };
type TargetVisualExtensionV1 = { visualKey?: ObjectVisualKeyV1 };
```

把该属性分别加入 `ItemViewV2`、`TargetViewV2` 的 optional 集；其余字段不变。`visualKey` 表示**该观察者此刻获准看到的外观类别**，不能包含所有者、真身、控制者、许可、秘密内容、唯一实例标识或是否存在于别处的信息。字段由可信服务端内容映射生成，不能由客户端、模型文本或显示名称指定。

`visualKey` 不决定 location、动作可用性、距离、权限或碰撞。不新增 visualState、mountedItems、readySide、doorStage、资源 URL 或视觉坐标字段：当前所需状态复用已公开的 location、fixed、open；素材根点与局部偏移属于客户端已审 catalog。

选择有界字符串而非封闭 enum，是为了让升级较慢的新 reader 接受语法合法、但本地没有资源的新 key 并回退。**服务端仍只输出有限映射表中的值**；未知 content/entity 映射时省略字段。客户端不得将任意合法 key 拼成 URL。非法格式继续由严格 parser 拒绝整个消息，不把安全解析错误吞成美术回退。

没有采用把 key 塞进 `FactField` 的路径：fields 还用于观察、证据与模型语境，资源目录不应伪装成世界事实。也不复用角色 `AppearanceIdV2` 的封闭值域或其能力名；旧的角色造型 reader 对 Item/Target 仍是闭集。

## 2. 沿用现有能力协商

新增可选能力 **`spatial-object-visual-v1`**，与已有 `spatial-v2`、`spatial-appearance-v1` 独立。首章新客户端完整声明为：

```json
["spatial-v2", "spatial-appearance-v1", "spatial-object-visual-v1"]
```

沿用现有创建/加入正文、Socket `auth.capabilities`、HTTP `X-Xiyou-Capabilities`，不新增握手系统或把本能力列为进入房间的 requiredCapabilities。生产者默认 `includeObjectVisual=false`，只有读取请求/连接声明本能力才输出字段；角色与物件能力各自裁剪。

| 生产者 / 读取者 | 实际承诺 |
| --- | --- |
| 新服务 + 旧 spatial-v2 reader | Item/Target 不含 visualKey；旧严格 reader 可继续读取 |
| 新服务 + 仅支持 spatial-appearance-v1 的 reader | 仍可有角色 appearanceId；Item/Target 不含 visualKey，不能把角色能力视为物件能力 |
| 新服务 + 新 reader + 物件能力 | 已授权且有映射的 Item/Target 可带 visualKey；没有映射时省略并回退 |
| 新服务 + 新 reader + 物件能力但无角色能力 | 物件字段可输出；角色 appearanceId 仍须省略，验证两项开关互不代替 |
| 新 reader 读取旧 DTO / 服务未启用映射 | 正常解析并显示原占位、文字和操作，不补猜 key |
| 旧服务 + 新客户端完整能力集合 | **不承诺连接成功**：本基线 [server.mjs](../backend/server.mjs) 的 Socket auth 白名单会拒绝新能力。采用服务端先接受/实现扩展、再启客户端声明的发布顺序；连接旧服务时必须继续使用已有能力集合，不能仅靠“字段 optional”宣称网络兼容 |

当前拒绝路径是 `server.mjs` 返回带 `INVALID_MESSAGE` 的 connect_error，经 [socket-link.ts](../frontend/src/network/socket-link.ts) 交给 [spatial-session.ts](../frontend/src/network/spatial-session.ts) 的 `#initialFailure`。它会进入 offline、使旧视图/控制源失效，对此明确错误不安排自动重连，并显示现有[错误文案](../frontend/src/domain/spatial-errors.ts)“请求内容未通过检查，请同步后重新操作”。这不是美术 fallback，也不会自动删能力重试；手动重连相同旧服务仍会被拒绝。本候选保留该失败处理，要求版本发布顺序相容。

所有携带投影的出口必须一致：`snapshotSpatial`（HTTP、订阅、重连、终态和正常 control response）、`syncSpatial` 的 projection.replace（同步与推送共用）、以及**重用原 control nonce 的缓存响应**。实际入口见 [spatial-runtime.mjs](../backend/spatial-runtime.mjs) 与 [runtime.mjs](../backend/runtime.mjs)。

特别是 `controlSpatial` 先调用 `runtime.knownNonce(tx, principalId, nonce, request)`；命中后由 `compatibleControlResponse` 返回原控制结果。设计基线中后者在角色能力存在时直接早返；本实现分别检查两项能力并删除未协商字段，不能因角色能力早返而漏掉物件裁剪。缓存来源是 `runtime.mjs` 的 `knownNonce/saveNonce` 对 `command_nonces` 的读取/写入。裁剪在响应副本上完成，不改变存储 Receipt/nonce、原快照水位或世界状态。旧缓存响应没有 key 时不补入当前世界的 key；新 reader 使用回退，正常新快照再带当前外观。

创建/加入返回 sessionId、Action/Receipt/error、复盘条目不因此增加美术字段，也不改变 schemaVersion 或 reducerVersion。当前可信 AI/scene 读取入口继续沿用原能力集合，不新增物件能力；共享 schema 生成物可能包含 optional 类型，但不能借机把全量内容表交给模型或增加工具参数。region-v1 合同不改。

## 3. 生产者、内容映射与消费者

| 责任 | 最小实施位置与义务 |
| --- | --- |
| 可信内容映射 | 可用一个 server-only `content/gaolao-object-visuals.mjs` 有限表保存下表，严格限定 `gaolaozhuang-scene-v2` / `gaolao-world-v1`；无需修改已持久化世界、内容 schema 或增加插件注册机制。其内部 itemId/targetId 不能被 frontend import |
| 投影生产者 | 在 `spatialProjection` **现有可见性过滤之后**，仅给入选 Item/Target 按可信内容及当前可观察外形附键。名字、ownerRef、观察者真身知识不参与选图；不新增对象或扩展受众 |
| 协议与传输 | `spatial-schema.mjs` 是字段源；同步生成 schema、TS/Python/声明文件，按既有生成器核验。`server.mjs`、`spatial-runtime.mjs` 和客户端能力常量传递同一开关 |
| 客户端资源 catalog | 独立公开 catalog（例如 `frontend/src/assets/gaolao-object-art.json`）只保存美术 key → 明确变体 → 本地已释放文件、尺寸、pivot、scale、层级、适用 map/scene。不得包含内部 entityId、私物 owner、隐藏出生点、规则真相表或整份服务端内容 |
| 渲染选择 | `frontend/src/domain/gaolao-object-art.ts` 这样的纯选择器只接受已授权 DTO、当前画布上下文与 catalog，返回已登记图或 null；不发世界动作、不查隐藏对象 |
| 地图与行囊 | `SpatialMap.vue` 保留原 ground/scene 过滤、引用、点选/键盘路径；`SpatialInventoryPane.vue` 保留本人授权 inventory、fields 与操作。图像只是其中一层，缺图仍可操作 |

推荐初始映射如下。**键可先输出，资源未释放就保持 catalog 空缺；表中“保留”不表示已有图片。**

| 服务端内部内容键（仅在可信表） | 公开 visualKey | 可见含义 / 当前资源处理 |
| --- | --- | --- |
| `gz-rope` | `hemp-rope` | 普通麻绳外形；散放/行囊有本地候选，固定层未制，均未接产品 |
| `gz-brace` | `timber-brace` | 木制门撑；图片未制，全部回退 |
| `gz-parcel` | `cloth-parcel` | 包裹外表；不含所有者或内装内容，资源未制 |
| `gz-letter` | `folded-letter` | 折叠信件外表；不烘秘密正文、称谓或人物身份，资源未制 |
| `gz-rake` | `farm-rake` | 独立农具；不因人物造型自动生成持有物，资源未制 |
| `gz-door` | `timber-door` | 门本体；封闭/开放的正式分层未制，保持目标回退 |
| `gz-support` | `support-point` | 可接近的承力交互点；不在目标图中包含推测的工具装配 |
| `gz-ledger` | `ledger-book` | 账册外表；正文/证据独立授权，资源未制 |
| `gz-return` | `tool-return-point` | 借还位置；不另叠已有棚架或自动画已借出的工具 |
| `gz-window` | `side-window` | 侧窗目标；不画透墙人物/私物 |
| `gz-meeting-C10`、`gz-meeting-C19`、`gz-meeting-R10` | `meeting-point` | 允许同类外观共用 key；仅这三条明确映射，保持三个独立 ref 与位置，不新增永久地面剧情图标 |

key 表示类别，不表示实例。同貌的两个 Item/Target 可以同 key，但 DOM、选中、交接、失败状态与异步加载归属必须按当前 `(sessionId, viewId, entityRef)` 隔离；只允许共享无实例状态的已解码图片。资源缓存不能反查生成对象，实体消失就删除其画面、关联标签与待完成加载效果。

角色继续独立消费 `appearanceId`：真实翠兰与借貌悟空保持同一 `cuilan` 造型，名字或 ownerRef 不改变像素。物品交给谁仍以当前实体 ref 为准；不能按名称、key 或同貌排序合并物主。获取美术键不新增查看/拿取私物的许可。

## 4. 精确状态与缺失处理

### 4.1 Item

按下面顺序选择显示；状态来自最新已验证并应用的授权投影，不用 action Accepted、旧图层或本地猜测抢先改变。

| 当前输入 | 地图 | 行囊/详情 | 禁止推断 |
| --- | --- | --- | --- |
| Item 不在当前投影、已 consumed，或不是当前 scene 的 ground | 没有该地面实例；撤销旧实例及加载回调 | 只按现有授权列表显示 | 历史见过/资源已缓存不等于当前可见；不能从 target.locked 补画 |
| `location.kind=held` | 地面 0 件 | 只有现有本人 inventory 或已授权物品视图显示图标/文字；物主标签用合法 ownerRef | 不自动挂在未知持有人身上，不复制到地面，不公开他人私物 |
| ground，`fixed` 不存在或为 boolean false | loose 变体，根点为当前 `location.position` | 已授权详情可用同一外表图标 | 不回填初始坐标，不按 publicBorrowable 猜具体道具 |
| ground，唯一 `fixed` 为 boolean true | 仅该物件的 fixed 变体；缺该变体时原菱形 + 已授权固定文字 | 保留 fields | **不能用散放绳盘充固定态；不能因看见一件工具补画另一件** |
| `fixed` 重复/冲突或非 boolean | 原占位；保留已收到的合法文字，报告通用资源/状态诊断 | 不猜 loose/fixed | 不修改服务端事实以迁就素材 |
| 合法 release 后 fixed 被移除 | 在当次实际 ground 位置用 loose；当前实现仍在 (1250,425) | 不标归还完成 | support.locked/phase 可仍为 locked，不能让旧装配层复活 |
| 合法 return/put 后 | 在新 `location.position` 用 loose；return 示例 (315,390)，put 也可为其他合法点 | 由真实归属决定本人行囊是否减少 | 不把借还架画面中心 (315,345) 代替地面位置 |

当前规则不会产生 held 且 fixed=true；若收到这种有效结构但语义不一致的输入，优先遵守 held 的“地面零实例”，图标回退，不虚构装配。

### 4.2 Cooperation / Target

| 当前公开事实 | 可显示内容 | 本轮不显示 |
| --- | --- | --- |
| `phase=preparing`、readyCount/requiredCount、anchors | 总人数，如“1/2 人就位”；两个候选站位用同一未锁定样式。prepare 不等于 ready | 谁在哪侧已准备、单侧 locked、按人物靠近猜 ready |
| `phase=locked` 或 support `fields.locked=true` | “协作已提交”等历史完成语义；当前装配另看每个可见 Item.fixed | 永久在门上画工具、释放后继续称工具仍固定、把锁定历史倒清成未合作 |
| `visualKey=timber-door` 且唯一 `open=false` | 此首章当前内容的封闭/铜封未解语义；仅使用已就绪且与底图匹配的封闭层 | “已解封但关闭”的持久中间态 |
| 同门 `open=true` | 开放结果；导航、权限仍以服务端为准 | 等动画结束再开放碰撞/允许操作 |
| open 缺失、冲突或不是 boolean | 中性目标回退及原授权字段，不选封闭/开放贴图 | 从章节目标、他人动作回执或已见过门推断当前状态 |

若之后制作解封动画，只能在**同一活动视图内当前可见门的已确认 open:false→true 更新**之后作短暂呈现；首快照已为 true、重连、重新进入视野或减少动态模式都直接显示当前结果，不补播历史。中间帧不持久化、不新增事件，也不授予/延迟通行。当前最小实现可以完全不播放此过渡。

## 5. 资源、位置与失败恢复

1. 地面 loose 图直接用 `location.position` 作根点。已核读麻绳清单：1254×1254；`groundPivot=(627,680)`；最终倍率 `32/1003`，不叠乘二次缩放。128/40 图标是同一整帧等比显示。这里只规定将来接入的几何，不把本地未发布文件硬填为可用 URL。
2. 固定 brace 与 rope 必须是**各自独立的可组合层**，每层锚定自己 Item 的实际位置；当前两者固定后同为 (1250,425)。不使用含两件工具的合成图驱动单个 Item；缺某件投影/资源，只回退该件。support Target 不能兼画一套工具而重复计数。
3. Target.position 保持交互/导航位置。未来门层在已审 `contentVersion/mapVersion/sceneId/visualKey` catalog 中使用显式局部偏移：C01 (1250,425) 对门图位 (1250,365) 为 (0,-60)；借还点 (315,390) 对架面 (315,345) 为 (0,-45)。这两个偏移仅说明既定 scene-v2 布局，不适用于任意地图或其他 target；未匹配布局/未审素材时不启用对应层。像素、图中心与 target.position 均不替换服务端碰撞或接近点。
4. 底图已经画有敞开的门、台阶、棚架；门状态必须在制作阶段修补/拆分**同一建筑**，不能把完整新门或底座再叠上去。室内、前景和门层未就绪时继续现有目标占位与文字，并明确正式环境视觉仍未完成。资源接线通过不证明底图闭门表现或任意落点遮挡已正确。
5. absent key、未知合法 key、已知 key 但没有已释放 variant：直接原几何/文字回退，**不请求猜出的路径、不显示 key/内部身份、不无休止重试**。已登记文件发生加载/解码失败时才使用既有“部分图像暂未载入，仍可继续操作／重新载入图像”恢复方式；重试只重载资源，不重发游戏动作。
6. 加载中也先显示占位。选择变体/视图/实体可见性改变时，旧请求完成不得把过期图挂回新状态。地图选择环、已有命中区、键盘焦点、可读标签、操作反馈均保留；图像 alpha/尺寸不能反向改变可达性或动作资格。错误统计仅覆盖当前已授权实例请求，不查询隐藏实体。

当前可执行的代码范围是协商、生产者、纯选择器与回退消费者；完整美术绑定依赖已释放的资源。麻绳散放态本地静态结论只覆盖指定 128/40、深浅底和两个 ground 示例；门撑、fixed rope、其余道具、门/室内分层、任意位置前景遮挡、正式应用视觉仍为缺口，不因本合同而转为 ready。

## 6. 稳定验收与最小验证

以下 `GZ-OBJ-AC-*` 是 #33 对 ADV-AC-02/03/04/05/06/14、GZ-AC-02/04/05/11 的局部细化，不替换原编号，也不降低 #29 整章门槛。下表是验收条件；运行结论须对应实现候选的真实证据，作者自查不代替独立审查。当前发布 catalog 为空，正式图片、背景分层和艺术验收仍为 **NOT_RUN**。

| ID | 输入与检查对象 | 可观察通过条件 / 失败判据 |
| --- | --- | --- |
| GZ-OBJ-AC-01 | 严格 schema 的旧 DTO、新 key、未知合法 key、非法 key；旧 reader 模拟 | 新 reader 接受缺字段及有界新 key；非法路径/换行/类型仍拒绝；旧 reader 只接收无扩展形状。生成 TS/Python/schema 一致 |
| GZ-OBJ-AC-02 | 真实 HTTP/Socket 的四种角色/物件能力组合；snapshot、订阅、control、sync/push、重连、终态；新 nonce 响应后由旧能力重试原 nonce | 每个出口仅带已声明字段；cached control 同样裁剪，原结果水位/世界状态不因兼容变换改写。旧服务器未知能力拒绝按矩阵记录，不误报 fallback 已连通 |
| GZ-OBJ-AC-03 | 同一世界的近处/远处/跨墙观察者、他人持有私物、本人持有、公共可借物、consumed、撤销访问 | 新投影移除 visualKey 后与原受众/对象/字段等价；不可见 Item/Target 不因键、请求 URL、合成图或错误透露存在；私物取用权限不变 |
| GZ-OBJ-AC-04 | 两个 ref 共用同 key；真实翠兰与借貌悟空、知情/未知观察者及物品交接 | 图像可复用但实体/位置/点击目标/owner 独立；人物仍同 cuilan 像素。改名不换图、换 ref 不合并，不能交给同貌的另一实体 |
| GZ-OBJ-AC-05 | 实际权威 loose→held→fixed→release→held→return；target.locked 在 release 后仍 true | 地面数量与位置随投影正确变化；fixed 缺图不出现散放图，release 去掉装配，return 用实际 (315,390)。只缺一个授权 Item 时不推画另一个 |
| GZ-OBJ-AC-06 | readyCount=0/1、prepare/ready/cancel，角色在候选点附近但未 ready，locked 后离开及撤收 | 只显示总计数与候选点；无侧别 locked 推断；合作历史与当前工具装配分开，不因离开拆工具或因历史 locked 复活工具 |
| GZ-OBJ-AC-07 | door.open=false→true 的确认投影；初始/重连 true；缺失/冲突 open | 只显示已确认结果；无持久 closed-unsealed；过渡可跳过且不延迟碰撞/操作，缺事实回退 |
| GZ-OBJ-AC-08 | 缺 key、未知 key、缺 variant、文件失败/重试、慢请求在 held/隐藏/换 view 后完成 | 不猜 URL、不重发动作、操作可继续；恢复只针对仍有效实例；旧完成回调不能复活旧图层，未发布资源不被伪称加载成功 |
| GZ-OBJ-AC-09 | catalog 与 scene-v2 坐标/背景；麻绳两个已给示例、固定层及目标偏移（有素材时） | ground 根点、pivot、scale、layer 有明确来源；无双重缩放/重复门架/重复工具；视觉几何不改权威位置、碰撞或命中后的动作对象。缺正式图时只验占位，艺术项仍 NOT_RUN |
| GZ-OBJ-AC-10 | 新候选真实浏览器正常近距选物、拾取、行囊、固定/撤收/归还及资源失败；默认 AI/scene 和旧 region 检查 | 真实 UI 使用自己的授权 DTO，无隐藏 ID helper 替客户端补键；候选 SHA/内容/请求与画面可对应。默认模型输入不增加物件能力，既有角色借貌和旧 region 不回归；不把受控浏览器计为真人/真实模型/完整视觉验收 |

最小有意义验证分四组：

- 协议组：为 AC-01/02 增加有限合同样例，运行既有生成器 `--check` 与相关严格 reader 检查；覆盖未知合法 key 和非法 key 的区别。
- 服务组：一个真实 PostgreSQL/HTTP/Socket 的定向扩展检查，复用已有首章合法建房/可见性/协作操作前置，覆盖能力出口、私物隔离、同貌与 release 的真实状态；不能仅以手造完整投影证明权限。
- 消费组：纯渲染选择与生命周期用有限 fixture 检查状态表、无网络猜图、旧回调失效。fixture 可证明消费者分支，不能冒充已发布麻绳/门撑的艺术证据。
- GUI 组：在 scene-v2 的真实服务与浏览器中取一条正常选择/拾取/协作/撤收/归还的因果链及资源失败恢复。没有正式图片时先交回占位路径和明确未验项；有已释放图后再做相关尺寸、层级及连续状态截图，不重跑无关完整章以代替缺图。

本方案不改变并发原子性、物权或状态机，设计阶段不重跑已通过 TLC；实现若实际触及这些语义，应停止套用本边界，交回设计并按工程规则补相应形式化与回归。新增协议和界面运行证据须由具体实现候选另行产生，作者自查不代替独立审查。

## 7. 决定、实施自由度与返回设计条件

本候选推荐已明确：单一可选 visualKey；新能力复用现有传输；server-only 有限内容映射；客户端静态资源白名单；状态复用 location/fixed/open；侧别只作候选点和总计数；解封只可作确认后的非持久过渡；两件工具独立按授权 Item 画层。此范围没有需要用户重复确认的产品取舍。

实现者可决定小组件拆分、资源缓存库及具体文件名；不能扩大读取受众、把私物目录打包进前端、以名称/opaqueRef 选图、改既有坐标/规则、将缺图写成完整正式视觉，或在本票中引入通用插件系统。

真正未完成的输入是各资源的制作、释放和图层对齐，按资源条目阻断对应艺术验收，不阻断安全回退代码。若后续要求真实的单侧安装、独立“解封关闭”阶段、按可见工具以外信息显示完整装配，或将新外观变体和隐藏身份关联，则属于世界/感知语义变化，须回到既有 #23/#33 设计记录重新裁定，不能从本合同自动推出。
