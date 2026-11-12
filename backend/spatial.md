# spatial-v2 服务端接入

范围对应 [ADV-001 #31](https://github.com/gbcdby/xiyou/issues/31)，合同为 `adv-protocol-v1/r2`。正式章节与三名自主 NPC 集成由后续章节实现负责；`spatial-graybox-v2` 是专门用于共同空间机制检查的原创灰盒，不是高老庄剧情或正式地图。

## 版本、运行与存储

`createAuthorityServer` 和 `AuthorityRuntime` 同时承载旧 `region-v1/world-v1` 与新 `spatial-v2/spatial-world-v2`。启动仍用 `npm start`，配置现有 `DATABASE_URL`；没有另一个浏览器或内存世界。每次启动在提供服务前恢复现存空间会话：保存场景时间与当前位置，提高全部控制 epoch，取消旧活动路线，重新设置墙钟锚点。服务按单个 Session 唯一权威进程部署；本票不引入多进程主节点选举。

迁移 `004-spatial.sql` 只增加命令水位与内部意图表，不重写既有会话、日志或内容快照。最终世界、事件、Receipt、outbox 与水位均沿用 `AuthorityRuntime.locked` 的 PostgreSQL 行锁事务。`spatial_command_sources` 是命令元数据，不由客户端世界位置重建。灰盒、地图、章节、变体、reducer、seed 和内容摘要固定在 Session 中；旧日志继续走原解释器。

迁移 [005-spatial-text-encoding.sql](migrations/005-spatial-text-encoding.sql) 为 `sessions.state`、`world_events.event`、`command_nonces.response` 各增加一个可空文本编码标记，既有 JSONB 行保持原值。空间协议允许正文包含 U+0000；含该码点的文档通过 [jsonb-text.mjs](jsonb-text.mjs) 将所有字符串中的反斜杠编码为两个反斜杠、NUL 编码为反斜杠加 `0`，并在独立列标记 `nul-escaped-v1`。键和值均按标记解码，普通文档和标记为空的历史行按原文读取，因此字面 `\0`、字面 `\u0000`、真实 NUL 可区分。编码保留其他 Unicode 码点及其组合顺序；协议、原请求摘要和 Receipt 格式沿用原定义。

事件、世界状态及其编码标记在原 Session 事务提交；含历史正文的控制 nonce 快照也使用相同编码。投影、同步、回放、启动恢复和原 nonce 重试先恢复原字符串，SQL 选择用的 capability、phase、ID、序号等受约束元数据保持原值。旧 region 会话继续使用原存储与解释器，并可与编码后的空间会话共存。迁移可重复执行；读写编码行的服务必须带有该解码器，因此升级按既有单权威进程边界替换服务。已写入编码行后直接运行旧服务二进制可能把转义字面量当正文；本次没有实现旧二进制混写或自动降级迁移。

服务对空间会话每 200ms 做维护，旧 region 会话与连接心跳保留 1000ms 周期。动作发生前也先推进同一权威检查点。少于两位有效在线真人时，剧情场景时间、移动与合作效果暂停；宽限和鉴权仍使用服务端时间。恢复不会把宕机时间补进剧情。服务端将几何路线转换为整数脚底位置，人物互不形成硬碰撞；当前导航使用点位置、多边形与可配置网格，正式美术半径/扫掠验证属于正式地图集成。

## 客户端入口

创建：`POST /api/sessions`，正文 `{nonce, contentVersion:'spatial-graybox-v2', capabilities:['spatial-v2']}`。加入：`POST /api/sessions/:id/join`，正文 `{nonce, capabilities:['spatial-v2']}`。两者返回 `{sessionId}`，不暴露内部 actorId。开始保持原 `{nonce}`。房间列表的空间行增加 `protocolCapability`、`contentVersion`、`requiredCapabilities`。

Socket.IO `auth` 使用 `{token, capabilities:['spatial-v2']}`。`session.subscribe` 仍发送 `{sessionId}`，响应为 `SnapshotV2`。HTTP 读取快照须带 `X-Xiyou-Capabilities: spatial-v2`。缺能力时返回 `UPGRADE_REQUIRED`，HTTP 状态 426，不发送降级 v1 视图。

正常大厅流程允许先订阅、队友再加入、取得控制、房主开始。新增成员和开局新增实体会在同一个权威事务中为已有视图补齐引用，保留原 viewId；客户端无需强制重连。另一条只读连接不会撤销现有控制者的视图。同步停在完整事务末尾，不把空间检查点或合作效果拆在分页两侧；新视图不允许请求其创建前的游标。

`control.resume` / `control.take` 均发送原始 JSON 字符串：

```js
const request = {
  schemaVersion: 2,
  type: 'control.resume',
  sessionId,
  viewId: snapshot.viewId,
  actorRef: snapshot.projection.self.entityRef,
  nonce: crypto.randomUUID(),
};
socket.emit('control.resume', JSON.stringify(request), control => {
  // control.snapshot 是控制后的新视图，后续使用它的 viewId 和 entityRef。
});
```

重新连接后合法 resume 或主动 take 提高 epoch。原连接仍持有控制时，另一个连接 resume 得到 `CONTROL_HELD`。同一连接同一来源的 resume 可以保留 epoch，因此不能无条件重新创建序号源。

空间连接的请求选择、事务提交和本地安装分别裁定，不能把 COMMIT 响应已返回或已经安装当作唯一的选择围栏：

| 阶段 | 权威依据与边界 |
| --- | --- |
| 请求与候选准备 | 跨会话选择分配本连接的代次，同一选择代次内的同会话请求仍按实际提交顺序处理。合法的新视图候选登记入事务时，推进单调的 `viewScopeFence`；它只使旧在途选择失效，不表示世界已经提交。旧代次在行锁内或候选登记时得到 `RESYNC_REQUIRED`，事务回滚，不旋转当前持久视图。 |
| 事务提交 | 当前 viewId、epoch 和事件只由 PostgreSQL 的 Session 事务决定。新选择已提交但驱动响应在途时，准备阶段的围栏已经生效，旧请求不能再破坏其视图。新选择回滚会保留已有安装，但不重新授权旧在途请求；原代次重试或再次选择仍可前进。 |
| 本地安装 | COMMIT 后短暂重取 Session 行锁，按当前持久 viewId、epoch、读权、活跃连接及已安装代次核验。旧回调不能覆盖已安装的新视图、切回旧会话或复活已关闭连接；不比较两个会话的 sessionSeq。 |

原控制 nonce 查询返回已提交的原结果；需要恢复安装时沿用原 scope，不把历史查询/恢复当作新选择推进围栏。这样既可恢复安装和断线交还信息，也不会再次提高 epoch 或挤掉在途的新选择。安装在途或暂时失败时，发布器继续服务其他读者，并保留待发 outbox。

```js
import { MovementCommandSource, parseSpatial } from '../protocol/spatial.mjs';

const source = new MovementCommandSource(control.controlEpoch);
const envelope = {
  schemaVersion: 2, sessionId,
  viewId: control.snapshot.viewId,
  actorRef: control.snapshot.projection.self.entityRef,
  clientActionId: crypto.randomUUID(),
  controlEpoch: control.controlEpoch,
  baseSeq: control.snapshot.snapshotSeq,
  action: source.move('gray-yard', { x: 200, y: 100 }),
};
const originalRaw = JSON.stringify(envelope);
socket.emit('player.action.request', originalRaw, receipt => {});
// 未知 ACK：重试 originalRaw；不能换 ID、baseSeq、引用或命令序号。
```

同一 epoch 的移动与停止必须共用一个 `MovementCommandSource`。源状态丢失时先取得新 epoch；不能从服务端已处理 highWater 猜测仍在网络中的请求序号。`stop_move` 不要求已经知道 movementId。原 Receipt 优先重放，较新结构合法命令的领域拒绝仍提高持久水位，同时保留原有效路线。

`sync.request` 发送 `SyncRequestV2` 字符串；响应与 `world.batch` 都采用 `BatchV2`。先校验完整批次，再按 `(fromExclusive, throughSeq]` 原子应用 `projection.replace`。所有公开类型从 `game/spatial-types.ts` 生成，解析入口 `protocol/spatial.mjs`；唯一字段源为 `protocol/spatial-schema.mjs`。

## 路线、轨迹与交互

`projection.movement.path` 是从接纳位置到目标的完整路径，`acceptedAtSceneTime` 是有效场景时间。`status:accepted` 只表示路线被接纳；真实到达由服务端推进后给出 `arrived`。`move_to.destination` 必须是合法站位，`targetRef` 绑定目标版本；目标发生相关移动、外观或语义变化时取消导航。客户端排队交互必须在到达后另发命令，接受前还会重新检查距离、墙、版本和物权。

地图入口必须在当前出口锚点附近、无遮挡且条件满足后才能通过。灰盒对象位置都是可用站位；正式 #28 的 `position` 是接近脚底点，`visual_object` 只描述图上物件位置，不可作为导航终点。

其他可见角色可选提供 `motionTrail`、`motionFromSceneTimeMs`、`motionThroughSceneTimeMs`。三者同时存在，表示本次检查点之间**已经实际走过**的连续折线。只给发生区间内静止、同场景、全程看得到整段轨迹且视图未重建的观察者；遮挡、中途入视野、观察者同期运动或视图更新都省略轨迹。可见性按障碍顶点射线分段验证，不用两端可见推断中间可见。它不含未来目标，也不把隐藏区两端连起来。缺少轨迹时直接使用确认位置；不在客户端重新寻路补画他人轨迹。

灰盒 `lock-support` 的玩家用语为“合作固定支架”。`cooperate` 的 prepare/ready/cancel 分别为“参与准备”“我已就位”“取消准备”，初始 `operationVersion:'0'`；两名在线真人在不同锚点就位、公共支架归参与者持有时，最终 ready 原子固定支架并开放出口。锁定后版本为 `1`，支架落在目标位置且不可再拿走，安装者掉线不会撤销效果。私人信件不允许离线领回，公共支架在借用前声明该规则，只有近处队友可在持有者超宽限进入受限托管后领回。

`projection.cooperations` 同时提供当前可见合作操作的初始可用描述：版本、所需人数、就位数和锚点直接来自服务端内容与已提交状态，尚未有人准备时就位数为零。客户端不需硬编码初始版本或锚点。`TargetViewV2.availableOperations` 只列 `interact` 操作；合作入口使用合作描述中的 operationId。

公开发言的受众与称呼在发生时冻结。队聊只进真人历史，不进入 NPC/代理的感知。重建视图不会改写旧历史引用。新章完整同意、身份揭示、AI context/工具/记忆与终局复盘集成由 #32 承接；旧 recap 保持原样，空间 recap 不会调用 v1 投影。

## 内部入口与边界

可信服务模块可用 `bindInternal` 取得限定角色的内部句柄，再调用 `reserveSpatialIntent(handle, intentId, action)` 创建导航/停止意图。调用者不提供 movementCommandSeq，唯一数据库分配器在此时预留序号；`submitSpatialIntent(handle, intentId)` 重用原已保存请求。迟到输出、重试或停止后的旧调用不会重新编号。HTTP、Socket.IO 和模型动作 schema 都不暴露这些内部入口，也不接收客户端到达或位置事实。

检查入口：

```sh
node protocol/scripts/generate-spatial.mjs --check
node --test protocol/tests/spatial.test.mjs backend/tests/spatial-geometry.test.mjs
node --test backend/tests/spatial-runtime.test.mjs backend/tests/spatial-network.test.mjs
node --test backend/tests/spatial-commit-order.test.mjs
node --test backend/tests/spatial-text-persistence.test.mjs
```

校验/几何与运行检查分别取证：空间运行、网络、提交顺序和文本持久化检查使用隔离真实 PostgreSQL，网络与提交顺序检查还包含真实 HTTP/Socket.IO 边界。文本检查覆盖合法 NUL、字面转义、Unicode 边界、原 Receipt/nonce、恢复回放和历史表结构升级。没有以内存替身代替数据库。五连接短程网络检查不代替 15 分钟集成、真实浏览器表现、正式地图或完整首章验收。
