# #66 RPC publisher 竞态设计 r1：总控独立静态审查

审查者 `/root`，设计作者 `/root/recovery_fix`。这是单个非作者分别执行需求和工程标准审查，不是两个独立 reviewer。完整读取设计 r1、身份/影响清单及冻结 manifest；对照实际 supply 全模块、syncSpatial 完整入口、Socket enqueue/proof、SocketLink、SpatialView 和 SpatialSession 的消费/恢复相关段，并核对三份原合同的相关条款。

对象：bb66dac423a7a306752a7474eabc95d7d4d9edb7 / tree deccc2600f3703f4b158f9b7ef5505680c557f0e。设计 SHA f9fee487ebcc60a601a29dfc8c9e5ff8ce8f3a5681cc95173608fb0235bbd98d；24 个引用文件的 SHA/Git blob 由总控另外重算，结果见 identity-audit.json。

## 结论与释放边界

- 需求轴：推荐分支的静态行为与已观察浪费对应，原请求授权、真实 sent、单 lane、历史恢复及消费者不跳前缀的规则明确；没有确证业务行为层面的新增缺陷。这里只认可设计论证，未运行新实现。
- 标准/验证轴：**CHANGES_REQUIRED，RRS-DESIGN-01 为 P2**。波次模型对旧 RPC 的实际抽象与草案第7节描述不完全一致，需补最小组合覆盖或可检查的保守映射。
- 允许独立 worker-tla 以冻结 r1 和以下明确缺口为输入推进有限增量。**尚未采纳为业务合同，尚未释放实现。** 形式化结果和模型修订须再次独审；原 no-idle 门仍失败。

## 已核对的设计约束

资格只在 RPC 同步入队时捕获：同当前 V，R=A=真实 sent，准确的 active item 是 publisher；执行时仍同 V 且 S>A。模块私有 sent 的两类写点、单 active 槽、RPC 优先以及仅合并等待 publisher，支持同 V 的这一增量来自所捕获 publisher 的静态论证。该论证依赖现有写点及生命周期，不是对任意未来代码的证明。

内部 sentPrefixStart 必须在原 R 的 access、安装下界、binding、actor/epoch 等全部守卫之后验证，并对照事务内当前 V 的真实 sent/current/pending/closing/scope。它只改变统一的有效读取起点；分页边界、stateAt、轨迹与 Batch.from 必须共同使用该起点。不能把原请求先改写为 S，也不能用 H、Q 或客户端声明代替真实发送水位。

新 ACK 依旧处于原 RPC active 槽，由完整真实 packet、同步发送窗口、一次性 proof 和发送前后 current 守卫推进 sent。前端 SpatialView 先检查完整 DTO、view、区间及投影，再原子接受 snapshot；合法 push 的当前调用链同步完成该接受，后续 ACK 才能连续应用。实际入队不等于应用确认；若 push 未应用，ACK.from 不连续时必须 refetch，不允许跳过。原 fresh demand、旧 cursor 历史路径和旧 link/view 守卫负责后续恢复；无新需求时不承诺无条件最终恢复。

入场已落后的请求、前置 RPC（包括超时 ACK）、能力不合格及 direct runtime.sync 保持原规则。混合房间中仅合格 full-cap handle 满足该精确竞态时允许改变 RPC.from，混合 publisher fallback 和不合格 peer 不变；这是明确拟议变化，后续采纳须保留说明，不能写成混合房间所有字节完全不变。

没有改变 wire schema、默认开关、200ms、页预算、RPC 优先或原动态阈值。没有声称节省全部 SQL 等待或保证修复 78.6ms 空窗；实际收益仍以新组合候选一次原 normal 及顺序后续门检验。

## RRS-DESIGN-01 — 波次模型中的旧 RPC 不是可推进 sent 的一般 RPC

严重度：P2；状态：OPEN；范围：设计第4/7节与 formal 映射，尚无实现可供判断。

原 `direction-supply-wave/CONTRACT.md` 的 **W-12** 明确旧 cursor 回包不超过可信 ceiling；`WaveProgress.tla` 的 `ReturnRPC` 仅记录 through/ceiling 并把 rpc 标为 done，**不更新 sent**。`RPCBoundary` 对全部已记录返回要求 through<=ceiling。该模型的 RPC 场景从旧 SQL 已结束、proof 尚在途的切点开始，不是任意合法 RPC 供给的保守抽象。

因此草案“RPC原本也能合法推进sent，wave只核接口align”的理由不能直接由该模型获得。生产旧 RPC 在另一种条件下能够推进，不等于原有限 wave 模型已经覆盖了本次 race RPC 作为真实 sent 生产者的交错。新规则使原请求 R 旧于执行时 S，但返回 (S,T] 并可推进 sent，须显式调整 W-12 的历史/race适用范围及其模型映射。

最小修复义务：

1. Supply/SharedRead 的资格与有效 from 模型仍按 r1 小范围增加，真正历史请求保持旧 ceiling。
2. 增加可检查的最小 wave 组合配置/见证，表达前置 publisher 后排队 RPC 从 S 到 T 真入队推进 sent、待 W 走 covered/settle、G 仍经原锁内重核和自然 settle，不能把 RPC 进展假记成 W 或 G 完成。若主张原模型的保守抽象已经足够，必须交付能核对的状态映射/条件证明；不能只写结论。
3. 精确区分历史 RPC 的 through<=ceiling 和 race RPC 的 from=可信 sent、through<=固定授权 Q及原完整页界。负控至少能暴露拿head当许可、部分重叠、伪sent、绕过RPC/W/G完成切点等对应新风险。
4. 不因此无差别重跑原64项或扩大状态域；有限配置、原始 TLC 输出、具名性质/反例、见证实际终点和未覆盖范围必须绑定新模型SHA。

这是模型输入修正，不是授权降低旧门槛。worker-tla可据此完善明确增量；其结果交总控独立核对后才决定正式采纳与实现释放。

## 未执行和保留

本审查未运行 TLC、PG、Socket、浏览器、性能测试或新的诊断；未改业务和原设计文件。唯一诊断和旧模型运行按原身份保留。连续 no-idle、late/five、实际实现 refinement 仍未通过；动画艺术门也不受本报告影响。
