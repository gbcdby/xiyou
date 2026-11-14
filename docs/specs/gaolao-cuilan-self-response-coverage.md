# CS-R2 验收覆盖与证据边界

> 2026-11-14 共享记录已发布：五个 CS-T 标识已映射到真实 GitHub Issues，后续有限释放及当前候选见文末[共享记录发布登记](#共享记录发布登记)。以下原计划正文保留其创建时状态，不据此否认后来已发生的建票或 G0-F1 释放。


日期：2026-11-14 UTC。固定输入、临时 Ticket 和唯一依赖来源分别见 [tasks](gaolao-cuilan-self-response-tasks.md) / [release](gaolao-cuilan-self-response-release.md)。本文件是**计划矩阵**；其中所有新业务、浏览器、数据库、TLC 和 provider 执行项当前均 **NOT_RUN**，不得从表格存在或静态双轴 PASS 推定运行通过。

每个 GZ-CS 编号的整体结论归 CS-T05。T01/T02/T03 的责任表示提供实现和本票范围证据，T04 提供固定 IC 的正常页面与技术检查；作者局部 PASS 不能相加成为独立整体验收。正式形式结果单独接收，不混到产品 PASS 数量。

## 1. GZ-CS-01～12 覆盖

| 验收 | 实现责任 | 必须有的可核对证据 | 正常页面与非页面边界 |
| --- | --- | --- | --- |
| **GZ-CS-01 来源/安置后存活** | T01 新两内容/持久来源；T02 按用途读取、settled 后响应；T03 默认内容 | 两变体各一次新来源，仅本人受众、精确 source/content/policy/digest；两安置后本人正常响应；256 窗口外/重启仍能读取原来源，不重复写入旧局 | T04 P-01～03 为实际来源/安置/响应；落窗/重启用专门样本。只检查 content JSON 不能证明生产初始化和响应 |
| **GZ-CS-02 借貌选择** | T01 term/CAS/范围/使用；T02 C4/C5/C6；T03 请求表单 | 正常 reusable proposed 摘要真实送达→本人 declined；新 ID/当前公开 CAS 的 single_use→accepted，旧 declined 保留；三会面点×两安置点内容/选择等价；真实 apply 的三处空间样本 | P-02 覆盖正常请求；离位/出口阻塞 deferred 可用独立合法动作/故障样本。不以 schema 拒绝 reusable 或要求旁观 NPC 离开代替 C5 |
| **GZ-CS-03 私物入口/选择** | T01 目录 token/名目/范围；T02 C3/C5/C7；T03 目录与选择 | 安置前合法请求实际 deferred，安置后旧 deferred 不自动变 accepted；近距说明目录、两物单选/同选、reusable decline→新 single_use accept，两安置点皆可 | P-01/P-03；人物和原处物件不必同屏。正文/远处物件位置不得进入目录，optionRef 不能被 take/inspect/transfer 使用 |
| **GZ-CS-04 实际使用/物权** | T01 authority/取得事实/逐物消费；T03 行囊操作 | 受控悟空本人意图 actual apply；A 实拿/实交两件，各一次；先交第一件后第二件仍可处理；已经归还或放回的同件旧 take 失败，新合法许可可另安排 | P-03/P-06。记录世界事件/唯一位置/真实物主，不能凭 UI 提示证明。其他玩家、同貌悟空、第三人、未枚举物、reusable 内部强行 accept 使用均有拒绝样本 |
| **GZ-CS-05 本人撤回/即时停用** | T01 原子失效/外貌解除；T02 C2；T03 归因 | 每用途各一例实际使用→对应绑定中断→立即停用→恢复后本人 actual withdrawn；另有公开揭明→立即解除→实际 C2；故意延迟 scene 回调仍先停权 | P-04/P-06；系统失效/玩家取消不得标翠兰撤回。若先有新请求取代旧槽，该例不能冒称 C2，需要独立真实撤回样本 |
| **GZ-CS-06 旧持物返还** | T01 持久原取得/独立投影/窄归还；T03 行囊入口 | A 取一/两件→取消/失效/撤回→B 占新槽→A 换 view/重连/旧历史落窗；仍逐件显示同一取得事实、fresh refs，实际交还与原处放回分开，另一件不消失 | P-05 必须走正常行囊；历史落窗可由真实合法事件生成的独立技术样本补，不直接删掉事实制造通过。原处放回不 fulfilled，不恢复旧 take，不给通用物权 |
| **GZ-CS-07 归因/竞争** | T01 CAS/两轴/替换；T03 取消/改约表单；T02 严格当前请求 | 原请求者取消和显式 replacement；同公开 revision 两人竞争至多一个首次提交；第三方不得覆盖有效 proposed/accepted；两用途独立；B 新槽不接管 A 旧取得/持物 | P-04/P-05+同步请求契约样本；竞争错误不泄漏旧请求者/范围/私有版本。没有旧许可时不得传猜测 0 |
| **GZ-CS-08 basis/Unknown/乱序** | T01 原事务/Receipt；T02 原意图/重验/水位；T03 既有 view 合并边界 | prepare→commit 间改变 term/scope、真实控制/来源/本地条件；COMMIT 后丢返回、原文重试、旧响应/撤回与新请求；失效后旧 Accepted 只返历史、sync 不复活授权 | 精确窗口可用故障注入，必须标 profile；正常 UI Unknown/原 ID 保留与迟到收据见 P-04/P-05。不同 ID/修改 nonce 来补绿失败 |
| **GZ-CS-09 暂停/重启/撤权** | T01 恢复版本/原子失效；T02 停止/恢复；T03 状态反馈 | 一人/全员掉线、重启、终态、scene 授权撤销、缺来源；先原结果，未答 proposed 不借新 epoch 接受，旧 grant 不复活；缺源为工程阻塞而非人物决定 | 真实网络断连/重启与契约撤权分列；任何直接写 withdrawn、CuilanSafe 或位置的样本不算正常路径 |
| **GZ-CS-10 感知/引用/投影** | T01 授权数据/capability/refs；T03 正常入口/view；T02 输入白名单 | 参与者/旁人的 snapshot/events/Receipt/重连/recap/工具输入逐项对照；privateReturns 只给实际持有人，ownerRef 不可见=null；跨人/跨房/旧 view 目录和 EntityRef 拒绝；旧 Accepted 不回退当前投影 | 正常页面看见的字段与只读可信审计分开；不输出内部 actorId/epoch/basis、正文或远处实时位置；能力不足不能降级掩盖字段 |
| **GZ-CS-11 旧行为保持** | T01 精确解释器/route；T02 旧 v1 basis；T03 旧内容 UI；T04 旧 CI 保留 | N1～N6、GZ-SP-01～08/SP06 按受影响点定向复核，含 C13 真退出、两路线、暂停换领路者/重提、救援与安全保持；旧 v1/scene-v2 恢复仍按旧语义 | 旧行为的有效未变证据可保留原身份复用，不能把旧 A2 代翠兰脚本当新回应实跑；新默认本人与旧回归分开报告 |
| **GZ-CS-12 成本/有限活性** | T02 单控制器/公平/重试；T01 原持久意图接口 | 无模型配置下 scene 工作；两个用途同时待答/一个提交后另一个得机会，无关行走不饿死；Unknown 耗尽后保持可恢复，不以 pending 自旋；scene 直接 Gateway/ai_runs=0 | 生产计数/原意图与实际步骤为运行证据；形式活性只在已列假设下成立，不要求旁观 NPC 离开，不承诺离线持物人回来 |

## 2. 新旧版本与恢复矩阵

下列 C-V 编号是本计划的补充检查索引，**不是新增产品 Spec 编号**。T01 提供服务端/持久层证据，T03 提供客户端兼容，T04/T05 记录实际候选。

| ID | 会话/客户端组合与输入 | 必须观察的结果 |
| --- | --- | --- |
| **C-V01** | 既有 v1 两变体 Session，恢复/replay；新客户端进入旧房间 | 原内容 digest/reducer/事件解释不变；无新本人来源或默认 personalRequest/term；旧合法动作不被新个人用途守卫卡死 |
| **C-V02** | 既有 scene-v2 两变体，旧 gaolao-cuilan-v1 basis、pending intent/Receipt，重启/再连 | N1～N6 原白名单/路线恢复保持；新控制器不替旧局添偏好/来源，不迁移旧 accepted 为新 proof |
| **C-V03** | 新 v3 两变体，新能力客户端创建、bind/claim、同步、提交、再连 | 持久精确 content/chapter/map/variant/seed/reducer/policy；仅两份新来源各一次。新来源落窗仍读同一事实；新规则只命中已注册新版本 |
| **C-V04** | 无 gaolao-personal-consent-v1 的客户端创建/加入/绑定/恢复新 v3；同客户端访问旧房间 | 新 v3 明确升级/旧内容选择反馈；不能删 lifecycle/returns 后继续操作。旧房间保持可访问。HTTP 与 Socket 两条入口一致 |
| **C-V05** | 新 v3 的缺失/损坏 personalRequest、term、proof、原取得字段；未知 policy/reducer/content 组合 | 严格拒绝/工程阻塞，不默认 active、accepted、single_use 或伪造经手事实；已持原 Receipt 的合法历史读取优先，不重新要求当前条件。旧合法缺字段走旧解释，不能与损坏新版本混为一类 |
| **C-V06** | 新 v3 原 pending/Unknown，在 control epoch/view 改变、重启及结果丢失后恢复 | 原 ID/原文/Receipt 一次效果；原 proposed 不自动以新 epoch 接受；已失效 grant 不复活；本人通知和后续 C2 分开取证 |
| **C-V07** | 新 v3 A 旧持物、B 新槽、A 断线换 view、history 截窗；再送旧 Accepted | 取得事实/current holder 正确重建 privateReturns 与 fresh item/owner refs；owner 不可见=null。旧 Receipt 仅原历史+sync，不能删返还项、换物主、把 restored 写 delivered 或把 ended 改 active |
| **C-V08** | 新默认高老庄入口与旧 v2 静态资源入口；对应 layout/variant 的 exact mapping；未知 content/variant 负例 | 默认实际创建 v3；原 65 PNG/18批准图字节相同；批准默认布局资源仍有正确 visualKey/scene 层。旧 v2 保持，未知/非等布局不自动吃默认映射；无布局/几何变动 |

任何新版本默认入口从 v3 回退为 v1/v2 会使 C-V03/C-V08 失败，即使旧版 A2 CI 仍绿。相反，旧 v1/scene-v2 的回归失败是兼容问题，不能通过把历史夹具改成新字段或注入新知识解决。

## 3. 风险负例与形式性质的对接

这里区分**产品拒绝样本**与**有限模型负控**。产品负例使用真实解析/权威规则，观察拒绝和无越权效果；形式负控由独立 TLA worker 用刻意缺陷配置产生真实 `rc=12`，两者各有 subject，不相互替代。

| 索引 | 产品负例/故障交错 | 对应形式性质与责任 |
| --- | --- | --- |
| **N-01 本人归因** | 玩家/父亲/同貌者/非 scene principal 代响应；取消/替换试图写 withdrawn；未收到中断通知强撤回 | `MF-CONSENT`：决定只能来自真实本人，生命周期与决定轴分开。T01/T02；TLA 具体模型身份待接收 |
| **N-02 term/范围** | reusable 合法提出后内部强 accept/apply/take；旧 scope 改 term 重用 nonce；跨 purpose、错误物/请求者/执行者 | `MF-TERM` + `MF-CONSENT`；T01/T02。正常 C5 的实际 decline 是另一个必要正例，不可用拒绝工具输入代替 |
| **N-03 竞争/CAS** | 同 revision 两玩家提议、第三方覆盖有效安排、原者无 replacement 静默替换、旧 response/withdraw 命中新槽 | `MF-CONSENT`；T01/T02。两用途可共享公开 revision CAS，但不能共享私有槽/决定 |
| **N-04 原子停用** | apply/take 与 cancel/replace/withdraw/control-change 并发；公开揭明提交而延迟 scene 回调；实际移动整段越过 90 边界 | `MF-EFFECT`（离散提交/外貌停止），几何段由产品检查；T01/T04。只查终点、拆事务残留权利均失败 |
| **N-05 逐物单次** | 两件请求只准一次 take 导致第二件被耗尽；归还第一件后用旧 grant 再取；already-at-owner 伪造取送 | `MF-TERM` + `MF-CUSTODY`；T01。新合法安排可另取，不应永久封禁该物 |
| **N-06 物主/窄归还** | 撤回后禁止真物主归还；转第三人/同貌者/任意地面；公共领回离线私物；目录 token 当 EntityRef；新请求接管 A 旧经手 | `MF-CUSTODY`；T01/T03。物理距离/ref 由产品实测，不在模型里假定自动满足 |
| **N-07 返还集合** | current-only/最近256历史筛选把 A 持物排掉；第一件清除第二件；owner 不可见却补远处 ref；drop 原处写 delivered/fulfilled | `MF-RETURN` + `MF-CUSTODY`；T01/T03。选择式是当前 holder+原取得，不是新可编辑账本 |
| **N-08 旧 Receipt/Unknown** | COMMIT 后丢返回、同ID改文、旧epoch原请求、旧 Accepted 在取消后到达、延迟旧 withdraw 与新 request；恢复新建身份/复活 grant | `MF-RECOVERY` + `MF-RETURN`；T01/T02/T03。继续使用既有通用 view/seq 合并，不为验证新增第二套状态机 |
| **N-09 唤醒/公平** | 读完两用途只回一份后清总水位；无关坐标使 basis 永远失效；Unknown 耗尽由 pending 无限重启；隐藏 actorKind/在线字段改变 C5 | `MF-RECOVERY`（原恢复/有限重试/待办）与个人选择约束；T02。持续 Running/合法来源/有限请求/技术故障终止为有限活性前提 |
| **N-10 版本/感知** | 新规则按 content family 注入旧局；缺能力静默剥字段；跨 view/session/observer 的 optionRef/returnContextId；新私密字段进入旁人/模型/recap | `MF-VERSION` 的静态/契约义务 + `MF-RETURN` 隔离；T01/T03。通用感知负例和能力门禁是产品测试，不能笼统称全部由 TLC 证明 |
| **N-11 既有安全/路线** | 两用途改变 follow 槽/basis；cancel/decline/withdraw 回滚 CuilanSafe/历史身份；旧恢复跳过 C13 或复用旧到达 | `MF-SAFETY` 与既有 N1～N6/SP06 受影响性质；T01/T02。旧模型的实际原 subject 保留，增量义务不得重命名为新全量 PASS |

`MF-*` 是本计划对性质的**映射键**，不是宣称已经存在同名 TLA 文件。实际 model/config/结果由 release 中的 FM 映射绑定；没有对应实际证据时该性质仍待核。无需为了某个 UI 只读字段，强迫所有状态与历史长度作一份笛卡尔积；但分解模型之间的假设/接口必须明确，不能因分解而漏掉真正的原子性或旧持物交错。

## 4. 先行最小两人生产路径

所有 P 样本使用 IC、真实新 v3 版本和两个独立账号/浏览器上下文。生产翠兰所有响应、移动与确认来自唯一 scene 运行器。人类操作走实际页面；受控三自主 NPC 单列 profile，外部 provider 调用 0。可信 read-only 诊断可辅助核对来源/取得事实，不能直接改变事实。

| 样本 | 正常玩家操作与真实终点 | 主覆盖/证据关联 |
| --- | --- | --- |
| **P-01 救援与安置** | 页面创建默认新高老庄；侧窗/铜封/门撑/材料送达；悟空合法开门；生产本人退让/接受随行/实走/确认。分别有前院与茶棚、新两变体样本；安置前一次私物请求得到本人 C3 | GZ-CS-01/03/11；保留已有 GZ-SP 编号。默认值至少一例无 VITE 覆写；控制脚本不代翠兰 go/send/interact |
| **P-02 借貌询问与补救** | 安置点近距，reusable 真实 proposed→declined；旁观 NPC 继续停留；新 single_use/current CAS→actual accepted。本人仍在安置点，不自动悟空 apply | GZ-CS-02/07/10；记录原人类 request、本人 received 摘要、scene intent/Receipt、当前投影 |
| **P-03 两私物各取还一次** | 本人近距说明清单；两意向按实际 decline/新accept；正常走到 C07，拿两件，回真物主先还第一件再处理第二件；单选样本另保留。已还同件旧许可再取拒绝 | GZ-CS-03/04/06；证明清单非物品位置/操作引用，单次按件消费，真实物主没有被同貌者替代 |
| **P-04 中断/取消/真实撤回** | 两用途分别取 accepted/使用后的真实绑定断线样本；两人恢复后本人 C2 actual withdrawn。另作原请求者取消/显式改约和同revision竞争 | GZ-CS-05/07/08/09/12；系统立即停用与本人较晚决定有各自事件。一个全房重启不能代替“无关人物变化不影响另一用途” |
| **P-05 旧持物独立归还** | A 拿一/两件后取消/失效；B 新请求占槽；A 重连，新行囊仍列原取得物；正常走近真物主交一件，另一件走回原处放下；检查实收/原处不同 | GZ-CS-06/07/08/10；新ref/ownerRef=null 阶段、旧Accepted迟到、另一件未消失；history落窗另样本补足，不强制改章状态 |
| **P-06 实际借貌与公开结束** | 受控悟空经自己的意图 apply，三会面点有实际空间样本；玩家合法知情后当面揭明，立即解除，再观察本人 C2。自愿解除/玩家取消/本人撤回分开 | GZ-CS-02/04/05/10；无真实 provider 时只记受控 NPC 技术路径；保留真实身份知识及 CuilanSafe，公开替代路线仍可继续 |

精确 prepare/commit 窗口、来源摘要损坏、当前出口动态阻断如没有生产 UI 操作，安排独立契约/故障样本，结果标明。不能把这些样本混写成玩家已从普通按钮完成。P-01～P-06 任意有缺口时报告对应验收 NOT_RUN/FAIL，不靠其他样本的 PASS 平均掩盖。

## 5. 与 #29 的后续覆盖对账

主 Spec §13.3 的受控技术范围包括 2/3/4/5 人、2/5 人乔装/直接与入队/分别、五客户端连续至少 15 分钟。这里给出复用规则和差额入口，不声称已重新审过全部历史 artifacts。实际是否仍适用由 CS-T05 在固定 IC 上判断。

| #29 层/样本 | 本次最小 slice 可提供什么 | 保留或补齐的义务 |
| --- | --- | --- |
| 既有普通 CI / PR54 静态发布 P0～P8 | root 已核旧 main/tree 的历史结果；65 PNG/18图不变作为基础 | 保留原 candidate/content/profile，当前更改影响版本映射和默认入口，须补 C-V08；旧静态 PASS 不证明新本人响应已实现/部署 |
| 旧 A2 2/5 人 | 旧 `.github/workflows/ci.yml` 固定 v1，脚本直接代翠兰回应的历史受控回归 | 继续运行但明确 legacy scope；不能改名称或 contentVersion 字符串就充当新生产 scene-v3 路径 |
| 新 2 人技术链 | P-01～P-06 + GZ-CS 样本、两新变体和两安置；三会面点实际空间应用 | 只释放新增本人回应/归还技术范围；完整章的乔装/直接和入队/分别分支另按真实终点对账 |
| 新 3/4 人 | 可复用未变职责映射的内容/合同证据，需检查新请求/竞争及 scene 在该人数的真实联机影响 | 各声明变体/人数覆盖必须有据；仅 2/5 极值不能假称 3/4 已跑。新增/受影响组合由 root 依 M29 释放必要补测 |
| 新 5 人与 2/5 分支 | 复用确认未变的公共物/身份/复盘底座证据，记录 relation=background | 5 人新 personal/竞争/原取得和两人/五人乔装、直接、入队、分别技术终点仍须真实证据；受控 NPC 标 profile |
| 五客户端 ≥900 秒 | 最小两人链不覆盖 | 独立长时 job/报告，同一固定候选、连续区间、五连接与实际有效操作/暂停恢复/资源清理；不能拼接多短局，不能借旧候选总时长填新候选。已有有效长时证据可仅在未变适用范围保留 |
| 有限模型 | 正式 R2 的实际受影响性质/反例/实现映射 | 分开报告模型规模、假设和未覆盖；不并入页面运行计数，更不证明自然语言质量 |
| 真实 provider 因果质量 | 本计划实际调用 0；技术样本不提供真实质量结论 | 三自主 NPC 真实配置、合法来源→意图→执行/拒绝/重规划、信息顺序/故障因果，另作独立门槛 |
| 真人四局 | 自动浏览器无真人体验证据 | 2 人组/5 人组各初玩+复玩，贡献/求提示/阻塞时长等按 Spec 记录；不把浏览器上下文当真人 |
| 真机/艺术/部署 | 可给正常桌面技术截图和字节未变检查 | 真实设备、艺术验收、具体环境发布各按真实结果。模型、构建、PR合并和旧静态站点均不能顶替 |

M29 每条证据记录最少包含原 subject/content/variant/人数/profile/日期/run/artifact、当前 IC 的相关 diff、可复用范围与理由、受影响需补范围及实际结论。没有原始可读证据时写证据缺失，不把口头历史重写成已核 PASS。

## 6. 收口检查规则

- 本矩阵 GZ-CS-01～12 均有实现负责票与独立归口；新旧恢复、负控、两人路径及更广范围均有显式检查入口，无未覆盖编号。
- 一个通过的模型和一个通过的产品测试可能支撑同一义务，但保留各自 scope；任何总数均不得把模型用例、页面步骤、真机和真人局相加为“全部通过”。
- T04 首先产生两人最小证据，T05 对照真实候选核定新增范围，然后 root 根据 M29 差额推进必要更广验证。现有有效证据只复用它实际支持的范围。
- 所有产品/环境/未执行问题分别记 `FAIL / ENVIRONMENT_BLOCKED / NOT_RUN`；本机 AF_UNIX EPERM 不代表产品失败或 PASS，改到正常 Actions 环境须另有真实 run。
- 测试与实现双方都不能更改事实/路径/期限偏好来补绿。发生 Spec 语义变化交回设计；只修实现时保留失败证据并对新候选复核相关范围。


## 共享记录发布登记

2026-11-14：本覆盖矩阵的责任标识已映射到真实任务：[CS-T01/#55](https://github.com/gbcdby/xiyou/issues/55)、[CS-T02/#56](https://github.com/gbcdby/xiyou/issues/56)、[CS-T03/#57](https://github.com/gbcdby/xiyou/issues/57)、[CS-T04/#58](https://github.com/gbcdby/xiyou/issues/58)、[CS-T05/#59](https://github.com/gbcdby/xiyou/issues/59)。GZ-CS-01～12、C-V01～08、N-01～11、P-01～06 以及 #29 差额义务原文保持。

建票不产生新的产品验收结果。F1 作者候选已固定但独立审查未完成；模型包已交接但独立模型复核和实现映射待做；T04 局部适配器的 5 个替身边界检查仅支撑对应准备范围，没有浏览器/PostgreSQL/E2 结果。最新发布时点和准确候选见 [release 发布登记](gaolao-cuilan-self-response-release.md#共享记录发布登记)；实际证据按相应 Issue 和固定 subject 维护。

新两人技术路径、更广 2/3/4/5 人/分支与长时证据、真实 provider、真人四局、真机及正式艺术继续分别判断。本次保存共享记录不关闭 #23/#29/#33/#34，不启动后续章节、EXT-001 或新增部署。
