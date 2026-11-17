# GZ-UX-01：高老庄 Canvas 场景与交互改版

## 0. 对象、依据与状态

| 项目 | 本修订 |
|---|---|
| spec_ref | GZ-UX-01 v0.2；本文件是六项 UX 改版的共同合同 |
| 来源 | 2026-11-15 用户实际使用反馈与后续“所有的更改都需要记到这个ticket中”要求 |
| 唯一活动总票 | [#66：首章场景交互与全角色动画改版](https://github.com/gbcdby/xiyou/issues/66)；工作单元、owner、依赖、commit/PR、证据与剩余项统一登记该票 |
| 观察基线 | main `2408899203955e3010bfe4832406b2b74000b905` / tree `f3526fc53c469018fcf4ac19dcb8b041ff6c0f6c` |
| 状态 | v0.1 已经独立需求/标准短审并获采纳、释放实施；v0.2 记录独立代码审查 R66-STD-004 的必要公开版本纠偏。总控已采纳纠偏方向，实现增量复审与实际运行结果以 #66 为准；本文不声明新产品验收通过 |
| 父记录 | [#33](https://github.com/gbcdby/xiyou/issues/33)客户端表现、[#23](https://github.com/gbcdby/xiyou/issues/23)首章目录、[#29](https://github.com/gbcdby/xiyou/issues/29)整体验收；只引用本轮总票，不另维护一套进度 |

本轮要求：走动不闪烁且当前场景公共物理内容持续显示；主世界用 Canvas；固定视角和右上角当前/全部地图；简洁 HUD；持续组合方向与自然小步移动；可读的共同目标和我的下一步。沿用现有美术资源，不借这次改版加入后章、EXT-001、真实 provider 或未采用的图像候选。全角色动画是 #66 的 ANIM 单元，可并行盘点、后续独立交付，不要求 UX 组合候选等全部新动画。

本修订在首章人类客户端的**物理显示范围、相机、地图操作、HUD与输入方式**上取代 [ADV-001 §4.1/4.3](narrative-adventure.md#4-空间与交互)、[视觉合同 §3](gaolaozhuang-visual.md#3-主视图文字层与避让)的相应旧约定。场景事件感知、真正秘密/知情、物权、本人同意、交互距离、服务端权威与历史事件不因此放宽。设计采用和实现结果以本票的不可变修订与实际记录为准。

方向与显示的后续已采纳合同依次为：[方向短段与恢复边界](https://github.com/gbcdby/xiyou/issues/66#issuecomment-6894942789)、[固定同步前缀](https://github.com/gbcdby/xiyou/issues/66#issuecomment-6895942605)、[分段时间与真实呈现信用](https://github.com/gbcdby/xiyou/issues/66#issuecomment-6896535543)、[同视图供给与逐条应用](https://github.com/gbcdby/xiyou/issues/66#issuecomment-6896744788)。正常应用入口明确采用 50ms 检查点并请求方向、分段显示双能力；通用工厂仍缺省关闭，新客户端保留首次旧服务端拒绝时的一次兼容回退。键盘使用受理时原点解释的 `move_direction`，地图点选与出口路线仍为 `move_to`；原动作身份、Receipt 重试及控制授权语义保持。合同采纳、能力启用和组件检查不等于真实运动验收通过。

## 1. 已知问题与结论边界

源码观察：旧键盘每个 keydown 发出约 60 world units 目标，依赖 OS repeat，无完整按键集合/keyup；默认跟随取景受本人位置、身体帧边界、标签和 HUD 影响；服务端感知数组按距离与遮挡 `canSee` 省略实体。

最小运动对象调用已复现：旧路径的显示仍在 x10 时，连续的新确认段从 x30 开始，旧桥接失败令显示立即跳到 x30、moving=false、累计距离归零。它证明连续短计划的显示/步态断裂，不证明浏览器整屏闪烁的全部成因。基线浏览器尝试在进页面前受环境 socket 限制，尚无该次画面证据；真实成品仍需动态验证。

## 2. 共同边界与接口

### 2.1 人类全场物理显示与原感知分离

- 默认生产客户端协商能力 `spatial-scene-overview-v1`。服务端只对已认证的 `principalKind=human` 输出可选 `sceneOverview` 与 `mapCatalog`；不能由客户端自称 human 获权。
- 原 `projection.entities/items/targets`、Observation/Claim、NPC context与知识通路保持原感知/授权语义；NPC 不因人类看到全场而获得远处/隔墙事件。
- `sceneOverview: { entities, items, targets }` 只含**本人当前场景**的公开物理实体，距离与墙遮挡不使该集合反复增删。地形/背景持续显示；角色/物件因真实跨景、持有/移除、身份外观变更等权威原因更新，不能缓存已经失效的对象来凑数量。
- 公开字段采用明确白名单：各类既有不透明 ref、公开称呼、授权外观/美术键、位置/朝向、绘图必需的已确认运动信息，以及下面的物理形态枚举。名称/外观继续按观察者合法身份知识输出；不能透出真身 ID、NPC 心理、剧情条件、私密库存、物件正文、许可/请求槽或私人路线。
- **v0.2 公开角色版本纠偏（R66-STD-004）：**原感知 `publicActor` 与新 `sceneOverview` 都不能把内部 `appearanceEpoch` 或角色 `resourceRevision` 计数直接输出。真实借貌/解除会推进这两个内部值，直接公开会让未知者根据计数辨认同貌；此前把“既有版本元数据”一概视作可公开不透明值的解释被本条取代。wire 字段名及 `DecimalString` 闭集保持，公共值绑定当前观察者、view 与 opaque entityRef，只供等值/陈旧判断，不表示真实变貌次数或可跨 ref 追踪的全局版本。
- 公共角色版本采用域隔离的 keyed HMAC 十进制别名；输入包含 session、observer、viewId、当前 entityRef、字段名及内部版本。密钥复用 session 创建时的内部随机 seed，仅留在内部状态/私有事件，不进入公共 DTO、NPC/model context、浏览器产物或日志；不得改为由公开 ref 与小整数计数构造的可穷举无密钥 hash，也不得伪造常量 0。物品与静态 target 的既有版本语义不因此扩大修改。
- 内部真实计数、binding 的外观当前性、`movement.relatedTarget` 和 AI `readVersions` 保持原语义。人物 interact/propose_follow 等消费公开版本时，先保留认证、`resolveRef`、内部 epoch 当前性及原动作守卫，再按当前观察者/ref 与真实内部 revision 重算别名作等值比较；跨人、跨 view、陈旧版本仍拒绝，不能删守卫或把收到的旧值自动更新。客户端只保存、比较和原样回送公共值，不推导内部顺序。
- 相同 nonce 的旧结果保持原结果/控制 epoch/序号/世界事实；若缓存内含旧原始角色计数，必须依据原 `snapshotSeq` 的历史 state/view 重新表达这两类公共角色版本，不能返回原始计数旁路，也不能用当前世界替换旧时点授权。此过程不重写 nonce 记录、不重做世界动作。实际借貌/解除、两同貌观察者、view/ref 旋转、陈旧动作和历史 nonce 负对照属于本次实现复审范围。
- 公开 `visualState` 仅按既有 `visualKey` 白名单给出物理形态：地面物件 `loose/fixed`、门 `open/closed`，其余 `default`。从真实当前事实产生，不直接公开整个 `fields`，也不从历史合作状态推导仍有装配。未知键中性降级。
- 全场可选取不等于远程可操作。原授权详情、availableOperations、近距/无遮挡、物权和本人同意仍独立校验；远处只允许查看公开外观、定位或合法走近，不能借公开 ref 跳过服务端规则。
- `sceneDisplayProjection(projection)` 为客户端纯展示合并 helper：同 ref 的原感知对象细节优先，缺感知细节时只合并公开绘图字段；物理枚举仅恢复绘图必要的 open/fixed。它不写权威缓存，不生成 Observation/Claim，不把公开对象送入 NPC context。Page对象列表/选取/地图标签用它；剧情、私物与 GaolaoInteractionPanel 继续用原授权 projection。
- 旧 DTO 为 `additionalProperties:false`。schema、生成类型、校验器和能力协商一起修改；未协商的旧 reader 不接收新字段，包含缓存控制响应/收据内投影的兼容输出也须裁剪。不能只加 TypeScript optional 就宣称兼容。

### 2.2 Canvas 与稳定场景范围

主场景采用实际 Canvas 2D，一套 world→screen 变换同时用于绘图、点击逆变换和目标定位。范围固定为当前场景 `0..width / 0..height`，按容器等比 fit；只有场景切换、容器尺寸或 DPR 变化可重算。本人位置、目标、逐帧身体边界、标签与面板开合不能触发自动平移/缩放。HUD在固定空间布局，开合不改变主场景 viewport。

资源按 URL 缓存并预解码；运动不创建新图片或重置 Canvas 尺寸。每帧先完整合成后一次呈现，资源/状态更新不得产生整屏空白；失败使用既有可操作的中性回退，不用无图帧替代已可用资源。沿用背景/地面、物件/门、脚底深度人物、前景、名字与反馈的层级、脚底锚点、合法镜像与遮挡语义。

不能把原对象 SVG/DOM 改名后称为 Canvas。场景内实体与反馈由 Canvas 绘制；固定 HUD、文本输入、对象列表和可访问操作仍可用 DOM。命中按同一变换和实际绘制区域倒序判断，不用旧相机坐标或错误层级；保留键盘/列表辅助入口。

已确认连续运动段优先衔接；换连续计划不清空累计路程/步态相位，不从新路径起点跳走，也不插一帧 idle。真正停止才 idle；身份、场景或外观等不连续边界按明确规则重置。预测只能表现，不能改写权威位置。沿用 `spriteResourcePaths / spriteForAppearance` 的通用 appearanceId 消费，不把全部角色都映射到高才。

### 2.3 连续方向输入与取消

`SpatialMap` 保留原 props/events；兼容 `cameraArea` 不再驱动 scene fit，新增 `direction` 事件，负载为方向向量或 null。向量的 x/y 各为 -1/0/1，Page 传给 `spatialClient.setDirection(vector | null)`；实现内部归一化，斜向不额外加速。具体类型名允许精修，消费者调用语义不得静默变化。

按键集合由 keydown/keyup维护，支持方向键和现有适用快捷键；OS repeat不重复推进，双键合成、对向抵消，松一键保留另一轴。文本输入、textarea、contenteditable或需要独占键盘的面板不抢方向键。全松、失焦、页面hidden、控制/连接丢失取消续发并停止。

复用现有 `move_to / stop_move` 与同一 `MovementCommandSource`。采用单调时钟的有界输入调度、短目标与有界inflight，合并最新方向，不按 RAF 或 OS repeat直接发请求。最终 stop 的 seq 大于已发 move，不能排在旧 move 等收据之后；Unknown 继续原身份查询/重试，不能无限积压新动作。实现候选须登记调度频率、最大目标前视、最大inflight与短按边界，并有等效时钟测试；不保留“每次固定走60单位”的体验。

### 2.4 地图、选点与合法前往

`mapCatalog?: PublicMapScene[]` 只给公开静态场景目录/拓扑：`sceneId,name,width,height,unitsPerPixel,walkableAreas,anchors[{anchorId,label,position}],exits[{exitId,anchorId,destinationSceneId,destination}]`。不得直接复制完整内容 fixture；仅保留可公开的地形、导航锚点/标签和出口，不带远场动态角色、物件、门状态或私密地点内容。当前出口可用性仍来自当前 scene 的 `exits.open` 与服务端实际校验。

右上地图提供“当前/全部”两种模式。当前地图点击位置走 `move(position)`；全部地图可选场景与静态地点，明确点击前往后调用 `navigateTo(sceneId, position): Promise<void>`，仅选择/预览不隐式移动。未知或不可达目的地显示原因，不虚构到达。

导航状态为 null 或 `{ destinationSceneId, destination, phase: approaching-exit | crossing | approaching-destination }`。客户端只按公开目录找路，经当前合法出口依次 move/traverseExit，服务端继续校验距离/条件，不瞬移。发 crossing 前绑定本次预留 movementCommandSeq 与 expectedSceneId；仅在同一view/epoch/map、对应权威movement/scene匹配时接受计划内跨景，等待权威arrived与视觉settled再推进。非预期场景或身份/version变化取消，不能把计划内跨景一律误当作外部取消。

保留 `move(position, options?, after?)`、`stop()`、`traverseExit(exitId)`、`cancelQueued()`。任何新的手动点地、键盘方向、stop或cancelQueued都接管并撤销旧导航；断线、控制丢失、非预期view/epoch/map变更不恢复旧链。需要重试的未知动作按原规则收束，不由地图重新发一套世界动作。

### 2.5 HUD 与目标指引

首屏只保留共同目标、我的下一步、单一当前状态/阻塞提示；本人名字/职责只显示一处。队伍、手记、行囊、交谈、回看和详细日志各有唯一工具入口，按需展开。未知结果查询/原样重试、取消、本人请求/归还等必要入口保留，不以简洁为由删除恢复能力。

目标是从当前已授权 `objectives`、`chapter.progress`、consents/follows/personalRequests/privateReturns、targets.availableOperations及连接/控制/收据状态派生的纯展示。未提供不当作未完成；不输出未知真相、隐藏身份或尚未获知的解决步骤。“我的下一步”只引导查看、定位、合法走近；世界动作仍由既有明确按钮提交。

桌面保留固定上栏、轻侧栏与底部工具入口；右上地图和详情面板不推动相机。窄屏使用同一固定fit，地图/详情由用户展开，正文可滚动，不靠缩字号或删除动作解决拥挤。设计采用水墨淡彩既有基准，不新增美术制作。

## 3. 单一总票与并行所有权

所有工作单元、活动状态、依赖与证据唯一来源为 [#66](https://github.com/gbcdby/xiyou/issues/66)。下表是该票的接口阅读视图，不另建实施子票。

| 单元 | 单一写入边界 | 释放产物/依赖 |
|---|---|---|
| UX-C | SpatialMap.vue、Canvas/输入模块、spatial-motion.ts、network/spatial-session.ts、相应协议/生成DTO/服务端公开投影及针对性检查 | 本合同独审后实施；提供能力/公开DTO、display helper、direction与导航接口给UX-HUD |
| UX-HUD | SpatialSessionPage.vue、use-gaolao-hud.ts、styles-art.css的HUD域、新地图/目标组件与pure guidance检查 | 本合同独审后可在隔离文件并行；集成依赖UX-C接口候选，不改其实现文件 |
| ANIM | 逐角色来源/manifest/注册及其必要验证，由票内owner协调 | 可先盘点；正式绑定依赖Canvas通用外观接口与已验资产，不阻塞UX六项组合PR |

`SpatialSessionPage.vue` 只有 UX-HUD owner。协议与导航只有 UX-C owner。共享文件新增/变更在 #66 登记并协调，不能两人在同一文件独立重写。规格/索引由唯一记录writer维护；候选组合、独立审查与外部集成按同一总控执行。

## 4. 六项整体验收与实现门槛

所有新运行验收初始为 NOT_RUN。表中结果必须对应同一个组合候选；作者自查不替代非作者需求/标准审查。

| ID | 必要检查与失败判据 | 单元 |
|---|---|---|
| GZ-UX-AC-01 | 正式双身份/多人房走近/走远/隔墙时公开物理实体仍持续显示；实际借貌/解除的两同貌、原感知/overview、view/ref 旋转与历史 nonce 不公开内部角色计数或跨 ref 关联，原版本过期仍拒绝；私物正文/库存、许可/请求、NPC不可听事件、远场动态及旧reader能力负对照不泄漏。距离远不丢物，不把私有字段全公开。 | UX-C；UX-HUD消费边界 |
| GZ-UX-AC-02 | 实际Canvas运行与动态证据；固定viewport下持续走动无整屏空白，当前实体不因重绘资源闪现；高才帧/脚底/镜像/遮挡、点选命中和资源失败恢复保持。不能只检查canvas标签存在。 | UX-C；组合 |
| GZ-UX-AC-03 | 角色移动、帧边界及面板开合不改变场景范围；两种地图、点击/确认前往、合法出口跨景与手动接管/取消实际执行；不跳过权限、不显示远场动态。 | UX-C + UX-HUD |
| GZ-UX-AC-04 | 桌面与窄屏页面核唯一工具入口、名字/状态/日志去重、固定详情及必要未知恢复/原样重试；无技术字段重复霸屏，无关键操作丢失。 | UX-HUD |
| GZ-UX-AC-05 | 按住↑再加→、松↑保留→、对向抵消、快反向、全松/失焦/hidden停止、输入框不抢键；30/60/120Hz等效输入、短按边界、stop/旧请求乱序及慢/丢收据不积压；连续短计划不跳点或归零步态。 | UX-C；Page绑定 |
| GZ-UX-AC-06 | 在新局、进行中与拒绝/未知/恢复状态，实际页面能读出共同目标、我的下一步和阻塞原因；只用授权事实，未知不编造成未完成，不自动执行世界动作。 | UX-HUD；组合 |

采用必要针对性单测、实际浏览器动态证据及现有自然 CI。允许记录一段当前候选短录像供用户看移动/切图/目标，未真正观看的连续艺术自然度不能写PASS。新的人类可用性观察只证明本批指导/界面范围，不代替原首章四场真人或真实provider验收。

后续已采纳的方向协议新增 `move_direction`、领域拒绝消费命令水位及同连接读取/发送协调，原“不新增世界动作，故不重复TLC”的前提已不适用。合并前须完成对应的最小有限模型、TLC 原件和源码映射：首次受理原点与原 Receipt 优先、拒绝后保留旧有效路线、Unknown 原身份和跨绑定容量，以及安装/可信发送水位、旧视图隔离与 ACK/push 恰一次连续应用。只检查受影响范围，不要求重复无关长 M29；有限模型不证明几何、像素、呈现信用或实时供给性能。

同一实际启用候选仍须通过真实 Canvas 的原输入时长、连续移动、速度/累计距离、DOWN 轴向和短按/停步门槛，不能用受控呈现单元或无画布数值探针代替。当前这些完整门槛须以真实证据收口，不能从设计或组件限定 PASS 推导。不得削弱旧守卫或删断言刷绿；旧测试若只断言已被用户明确取代的 human 显示范围，按本修订精确更新，并保留 NPC/秘密与交互负对照。

一次独立设计需求/标准短审后，UX-C/UX-HUD才能释放实现；这是[项目工作流](../agents/workflow.md#一项工作的闭环)既有门槛。规格与两UX单元进入一个组合PR，经完整候选独立双轴、适用检查、实际merge与main核验后记录其完成；ANIM按真实覆盖后续独立PR交付，总票按全部范围判断关闭，父Spec仍按其原义判断。
