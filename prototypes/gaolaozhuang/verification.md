# 高老庄原型检查与交接

阅读说明：以下首次冻结与历史基线记录原样保留；本轮后续正式受管预览及私有 v2 的实际结果追加在本文末节。初次 BLOCKED 不是最新全部证据，新增有界 PASS 也不等于完整矩阵通过。

## 2026-11-12：高才方向动画试接检查

**实现者测试 27/27 PASS，独立静态复审 PASS WITH KNOWN ART LIMITS，独立浏览器验收 BLOCKED（尚未进入页面）。** 本节固定候选及其证据，实际分支更新与私有试玩发布以 [PR #26](https://github.com/gbcdby/xiyou/pull/26) 和 [#25 最新交付记录](https://github.com/gbcdby/xiyou/issues/25) 为准；文档冻结不代表已部署。 用户要求把选定角色放进原型试玩。基线为 PR #26 的 `afa12ea57c1b84b7b902a970dfeea724bf7b346d`；仅高才接入已有 PNG，木匠与 NPC 保留原绘制。素材不是原生 GIF，正式动画与美术验收尚未完成。

当前八项运行文本（七项 JS/HTML/CSS 与角色 manifest）的 SHA-256 为 `949625e896be92bd001c4cba4cbedba5d0855bd26b898b1e2d04496219e0ba68`；序列算法与逐文件摘要见 [source-map.json](source-map.json)。素材 manifest SHA-256 为 `c431869d3e6b4fd931ddeadfa029d8424c5f7854eedbc8330de85e25a316dce8`。45 张角色 PNG 与冻结素材逐字节相同；庭院 PNG 与原登记一致。图片不写入 GitHub 源码目录。

| 本轮检查 | 方法与结果 | 边界 |
| --- | --- | --- |
| 八方向与镜像 | 新增纯 helper 测试，8 个明确向量、零位移保留、W/SW/NW 的对应原生组；PASS | 不替代真人对朝向可读性的判断 |
| 真实路径朝向 | 使用引擎公开 moveTo/update，绕花圃到 `(490,400)`，最终保留 NE 而非目标相对起点的 NW；零位移再点击不改朝向；PASS | 使用现有路径与碰撞算法，没有改变寻路 |
| 停步、切换、重开 | 公开导航接口停步/切换后保留 E 和累计41单位；静止 update 不推进；reset 新角色朝向 S、距离0；PASS | 浏览器抽屉、隐藏页面及回顾的实际暂停仍交独立检查 |
| 距离相位 | 18.45单位/帧、147.6单位/周期的确定点检查；PASS | 只是90ms等效试接初值，未做物理配速或脚锁验收 |
| 既有行为回归 | `npm test`：27 tests / 27 pass / 0 fail / 0 skipped，退出码0 | 含原22项与新增5项；Image空替身无decode仍兼容 |
| 清单损坏回退 | 站姿对象缺失、脚底锚点缺失、帧时长为0三种清单，实际预载并 draw 后仍可移动及显示原人物；PASS | Canvas与Image宿主使用替身，不代表浏览器像素检查 |
| 资源与显示静态核对 | 5idle/40walk本地预载；未就绪矢量回退，缺walk整方向idle降级，缺idle矢量回退；错误按背景/角色分开 | 失败场景和连续运动仍待独立浏览器验收 |

测试先出现 helper 尚不存在的目标接口失败，补实现后四项针对性检查通过，再执行完整 `npm test`。独立审查 R-gaocai-animation-001 指出清单字段损坏可能中断 draw；新增针对性用例先复现 TypeError，再于启用前校验实际消费的 file、尺寸、scale、footPivot、帧数组及帧时长，修复后回退旧人物。测试没有修改或删除既有断言。使用 Node v24.22.1；npm 的既有 `http-proxy` 环境警告没有导致检查失败。

所有帧使用各自 manifest `footPivot` 与最终 `scale`，主体初值76地图单位；NE后四帧0.70已计入scale。未修改PNG、未做逐帧等高处理。帧相位没有页面总时钟或渲染器角色缓存，打开暂停界面和页面隐藏时没有实际路程，重开自然清零。S/N连续脚滑与接缝、SE完整双步、E步距偏急、NE04/05近臂反摆以及两批比例/接缝均保持为素材未验收事项。

独立验证者的最短路线：进入原型，先比较高才/木匠体量；在前庭空地尝试八方向及绕花圃路径，停步后观察朝向；移动时打开说明、行囊、手记并恢复，切换标签页，再切同伴/重开；领取一份木料检查包袱与行囊提示；最后确认缺图时继续可操作。浏览器连续运动、脚底锚点/体量、素材接缝与玩法回归以独立报告为准。

独立浏览器验证者报告两个正式运行入口均未进入页面：本地 Chromium 启动遇到 socket 权限限制，云浏览器访问 localhost:4175 连接被拒绝。故当前没有画面或连续运动 PASS；不是已确认的产品失败。仍需在可访问的私有试玩环境中检查真实表现。

### 本轮独立静态复审与浏览器矩阵

独立 reviewer `/root/review_gaocai_animation_trial` 的最终需求轴、标准轴均 PASS；R-gaocai-animation-001 已修复并 VERIFIED。复审绑定上文八项运行文本指纹，详细结论保存在 [review.md](review.md)。其证据是源码检查，不是独立运行测试或动画美术通过。

独立 verifier `/root/verify_gaocai_animation_trial` 的浏览器尝试发生于首轮运行文本 `021112bbc3258a3b8956741ca16bdf14c9c93b8c7200ef374a28d8ebb0aa5f1f`；R-001 修正后仅复核最终文本身份 `949625e8…` 与完整 web 树 `4266670e9dd9b89030c07d6b4f31229662fa3cda1193d048725fd8f41577f608`，没有重跑失败的浏览器环境。以下各项均没有实际进入页面执行：

| 编号 | 本轮需要观察的行为 | 结果与原因 |
| --- | --- | --- |
| GZ-ANIM-01 | 八向运动、绕障/中途转向、到达/Esc/切角色后末朝向 idle | NOT_RUN / BLOCKED：两条浏览器入口均未进入页面 |
| GZ-ANIM-02 | 与庭院/木匠比例、脚底镜像、横跳/悬浮、alpha/遮挡、连续运动 | NOT_RUN / BLOCKED：没有正常场景截图、视频或连续绘制样本 |
| GZ-ANIM-03 | 说明/行囊/手记暂停相位、恢复无补跑、重开；能力允许时检查页面隐藏 | NOT_RUN / BLOCKED：没有页面执行或相位采样 |
| GZ-ANIM-04 | 仅高才换图、点击/切换、近距互动和持物标记 | NOT_RUN / BLOCKED：没有原型交互执行 |
| GZ-ANIM-05 | 缺 walk/idle/manifest 时合理回退且仍可玩 | NOT_RUN / BLOCKED：没有创建故障副本或执行路由拦截 |

本地 Chromium 在启动阶段报告 socket 权限错误，正式云浏览器访问 `localhost:4175` 时连接被拒绝。此结论是环境阻塞，未确认新的产品功能失败，也不足以声称当前候选没有绘制问题。作者 27/27 与 R-001 静态复审不代替本表。用户已授权先更新既有私有试玩；该试接可继续交付，但正式动画与运行验收保持未完成。

## 历史基线证据（不覆盖本轮动画）

## 结论与适用范围

2026-11-12，独立验证者对原始 15 文件候选完成真实桌面浏览器短流程和现有测试：**GZ-P-01 至 GZ-P-06 在本地原型范围 PASS，22/22 测试 PASS**。原始基线的 GZ-P-07 FAIL，因为缺少本检查文档，固定源码交付尚未核实。当前整理补齐检查/审查文档与可取得资产；文案微修和目录映射的最终对象及复验见“微修后候选与组合覆盖”。

以下各节保留旧原型的历史证据，不能用于声明本轮动画浏览器通过。旧 draft PR 和 v1 私有试玩已有记录；本轮动画的源码提交、站点版本和实际交付状态另见 [PR #26](https://github.com/gbcdby/xiyou/pull/26) / [#25 最新记录](https://github.com/gbcdby/xiyou/issues/25)。#25 与父任务 #23 保持 open。

- 验收唯一定义：[xiyou #25](https://github.com/gbcdby/xiyou/issues/25)，父任务 [#23](https://github.com/gbcdby/xiyou/issues/23)。
- 设计依据：[ADV-001 v0.2](https://github.com/gbcdby/xiyou/blob/2dc4fb4332860b60127e654b61bdae4925a5e61f/docs/specs/narrative-adventure.md)，设计提交 `2dc4fb4332860b60127e654b61bdae4925a5e61f`，草稿 PR #24。
- 代码观察基线：`main@5d0befff3673c840756d64a982878ac76dfd0273`。
- 本地模拟采用两个可切换角色和预设 NPC，无远程多人、真实 LLM 或正式八方向动画；刷新重开。本票不构成完整首章或正式视觉验收。

## 候选身份与检查环境

原始候选没有 Git 提交或 remote；15 个源文件、资产、测试与必需配置按相对路径排序后，逐项连接 UTF-8 路径 + NUL + 完整内容 + NUL，SHA-256 为：

`efb95d8b43cf8ed310cd66a376e5f7233e825da24003692299995122a3518c28`

独立 verifier 的清单摘要为 `44029c0e02c8f151c199a68a4bb44a8bdd8278d05ac596fa3a3a8d677ca3bca8`：按相对路径排序，逐行 path + NUL + 文件 SHA-256，行间 LF、末尾无 LF。两种摘要采用不同序列格式，覆盖同一批文件；检查前后逐文件 SHA-256 不变。

运行环境为 Node v24.22.1、npm 11.9.0、Chromium 156.0.8078.79、Debian GNU/Linux 13；浏览器实际访问既有本地预览，桌面页面截图 1363 × 936。`npm test` 退出码 0，22 tests / 22 pass / 0 fail / 0 skipped；npm 的既有 http-proxy 弃用警告未导致检查失败。

## 微修后候选与组合覆盖

后续实现者 `/root/fix_hint_and_package_source` 仅修正旧饭账动作的禁用原因：当前控制角色持有时提示“你已带上旧饭账”；同伴持有时保留走近持有人交接的提示。动作启用条件、物权操作与其余玩法未改变。GitHub 文本源码由 `dist/` 映射为 `web/`，三份既有测试仅替换导入前缀，断言与用例保持原样。

- 六个运行文本使用去除 `dist/` / `web/` 前缀后的文件名，按名称排序连接 UTF-8 名称 + NUL + 完整内容 + NUL，SHA-256 为 `60169354dba140a2e5cf9d3b01dbaaf68cf0d7fd5264b3d8972e39e6aa98cb78`。这是旧 v1 两份候选当时的逐字节对应关系；当前动画运行映射已在 [source-map.json](source-map.json) 单独登记，旧摘要仅作背景。
- 唯一运行源码变动文件 `engine.mjs` 的 SHA-256 为 `6f3eee96679d21fdcb69d54c97886ec04d6058865038645e9501a4d607aa96a7`。其余五个运行文本和 PNG 与原基线字节相同。
- 微修后的 Sites 运行包与 GitHub 源码候选分别执行 `npm test`，均为 22/22 PASS、退出码 0、0 skipped。
- 两份候选分别以公开 API 完成本人/同伴持有、两角色实际交接前后、初始领取与重复领取的定向检查，均 PASS；未直接改游戏状态，未新增或删除既有测试文件。
- 原始日志位于 B1 的 `followup/npm-test-site.log`、`followup/npm-test-github.log`、`followup/hint-after-site.log`、`followup/hint-after-github.log`；微修前复现与映射核对为 `followup/hint-before.log`、`followup/mapping-check.json`。

**微修之后没有重跑完整浏览器流程。** 本候选的覆盖组合是：原始基线真实 UI 全链路证明 GZ-P-01～06 的可观察流程；针对提示的公开 API 复验覆盖唯一文案变化；两套既有测试及逐字节映射检查覆盖目录映射和未变行为。它们不等同于当前最终候选的第二次独立浏览器验收或发布后检查。文档整合没有再改运行源码、测试或图片。

## GZ-P 验收矩阵

下表的运行结论来自原始候选的独立 verifier `/root/verify_prototype_baseline`。证据文件名均指本节后的 B1 基线证据包成员；单帧截图只证明可见状态，实际运动和顺序依据顺序 UI 记录与现有行为测试。

| 验收 | 实际方法 | 结果 | 证据 | 限制 |
| --- | --- | --- | --- | --- |
| GZ-P-01 | Chromium 真实打开，查看本地演示说明，并走完短流程；检查页面、地图、人物、任务与交互提示及采集到的控制台信息。 | PASS（原始本地候选） | B1：`01-start.jpg`、`12-recap-complete.jpg`、`browser-console.json` | 未观察到应用阻断；控制台捕获错误来自 Chrome 扩展。仅桌面布局，正式视觉与发布环境未验收。 |
| GZ-P-02 | 两角色分别点击行走、停步、换向，点击石桌验证障碍拒绝；远处取料、装撑、交接先行走，到场才产生结果；现有测试核对路径合法与取消队列。 | PASS（原始本地候选） | B1：`02-gaocai-stopped.jpg`、`browser-observations.log`、`npm-test.log` | 证明本地移动/交互流程；不证明服务端权威空间或多人时序。 |
| GZ-P-03 | 两角色分别取自己的木料；高才取得账本，走近后交给木匠，高才行囊 1→0，木匠 0→1，由新持有人出示；没有聊天或调试写状态。 | PASS（原始本地候选） | B1：`09-ledger-transferred.jpg`、`browser-observations.log`、`npm-test.log` | 唯一物权行为通过；发现“本人持账却称同伴带走”的非阻断提示问题，该提示已单独微修并通过定向复验，见上节。并发抢物未覆盖。 |
| GZ-P-04 | 高才锁左撑、木匠锁右撑，离开后门撑保持；请求悟空后观察其实际走到门边才开门，再让到旁边。 | PASS（原始本地候选） | B1：`03-left-support.jpg`、`05-wukong-requested.jpg`、`06-cuilan-paused.jpg`、`npm-test.log` | 受控 NPC 演示；不代表自主 AI 决策或多人同时协作。 |
| GZ-P-05 | 本人邀请翠兰、明确同意后随行；暂停并恢复，走近后再商量换领队；途中尚未完成，翠兰本人到安置点才勾选护送。 | PASS（原始本地候选） | B1：`06-cuilan-paused.jpg`、`07-escort-walking.jpg`、`08-cuilan-safe.jpg`、`browser-observations.log` | 只覆盖本地同意、移动、暂停与重新安排；正式权限/联机未覆盖。 |
| GZ-P-06 | 取账、询问厨娘、新持有人当面出示给唐僧；猪刚鬣改约庄口，持账人实际跟进，未到场时不可查证；双方到场后完成回顾。 | PASS（原始本地候选） | B1：`10-meeting-relocated.jpg`、`11-meeting-walking.jpg`、`12-recap-complete.jpg`、`browser-observations.log` | 改约为固定情境；`11-meeting-walking.jpg` 实际为到场待查证状态。回顾明确尚未实现乔装、收徒、真实联机与自主 AI。 |
| GZ-P-07 | 核对源码、运行方式、固定候选、检查证据、资产来源和后续入口。 | 原始基线 FAIL；后续旧 v1 文档/资产与远端交付见 PR #26 历史记录 | B1：原验证报告、前后指纹；当前 [README](README.md)、[审查记录](review.md)、[资产登记](assets.json) | 文档补齐是整理者自查，不替代独立复审。draft PR 与 owner-private 试玩须由实际交付结果确认，本文件不提前判整票完成。 |

补充：在回顾点击“再走一回”后恢复高才、取料任务、行囊 0、空手记；现有重置测试覆盖旧 NPC 路径、证据和结算计划清除。证据为 B1 的 `13-restart-empty.jpg` 与 `npm-test.log`。#25 没有存档要求，刷新重开是已说明的原型行为。

## 原始证据与资产取得

| 编号 | 可取得材料 | 固定身份与用途 |
| --- | --- | --- |
| B1 | [检查证据 ZIP（基线与微修）](https://chatgpt.com/library?file_id=libfile_fde3_f-dcb5d7ae28c0819193c12df819d1c135_66aec10a983c8191a09f0deb89988b42&account_id=personal) | `xiyou-gaolao-prototype-25-baseline-evidence-20261112.zip`，SHA-256 `b3de87da6d7ea5a5c190c67dc6cd22950c7d9f37ca491ca09b88d3faae2bf814`；35 项成员含原始报告、合同快照、日志、前后指纹、13 张必要截图、微修与映射自查及清单；当前已保存版本为 1。 |
| A1 | [庭院资产 ZIP](https://chatgpt.com/library?file_id=libfile_fde3_f-fc9468445c1481919976698091b2e074_66aec10a983c8191a09f0deb89988b42&account_id=personal) | `xiyou-gaolao-courtyard-asset-20261112.zip`，SHA-256 `eed0546456090563b7bd876632bcdc49152d9bf8bd7aef3d209c639076acda49`；仅含原始 `courtyard.png` 和说明，无游戏源码。 |

上述是授权账号的持久文件入口，不能当匿名直链或应用运行时 URL。下载资产 ZIP 后，解压图片并按 [README](README.md) 指定路径放置。PNG 为 3,423,640 bytes、1586 × 992，SHA-256 为 `f5df307eaea03188e823a279cb3df3a65b1b6a7931c329294cd6b79e4c0d510a`；详见 [assets.json](assets.json)。运行截图、原始日志及 PNG 不写入 GitHub 源码目录；不绕过主分支的忽略约定。源码仅按冻结文本白名单入仓。

## 独立静态审查与已知限制

[review.md](review.md) 的历史部分保留原始候选的有限静态审查；开头另列本轮动画复审。一位独立审查者分别检查需求轴与标准轴，未安排第二位独立审查者。该审查未执行测试或浏览器检查，未发现必须修改核心玩法的阻断；确认的 R-25-001 是缺失本检查文档。当前文档补齐及路径检查由整理者完成，不把作者自查称为第二次独立审查。

低高度/手机视口检查尝试通过真实 Chromium UI 开启 DevTools，但组织策略禁止，验证者停止该路径，没有绕过策略。B1 的 `14-devtools-blocked.png` 只证明未执行原因。桌面 `min-height:560px`、窄屏 `min-height:500px` 在更低视口下的滚动和可操作性仍未验证。手机真机按 #25 不在本票范围。

本轮未覆盖正式视觉基准、低高度与真机触控/性能、远程多人、真实 LLM、服务端权威/并发/重连/权限、完整信息权限、完整首章、长期存档或发布后环境。共享手记只在本地双角色间共用，NPC 改约是预设情境。

## 交付停点

后续交付复用既有 Sites 项目 `appgprj_6af53a3e4fa08191802bab06cd371e68`，保持独立 owner-private 试玩，不新建站点。GitHub 目标为 `prototypes/gaolaozhuang/` 的 draft PR；实际源码与运行包按映射清单对应。#25、#23 保持 open，禁止合并或接入正式游戏生产环境。

接手时先读 #25 最新记录，再读本文件和 README；用实际发布/PR 结果补充可访问地址与提交身份。当前检查摘要不是发布凭据，也不授予合并权限。

## 2026-11-12：受管预览与私有 v2 增量记录

### 结论、来源与证据层级

独立验证者 `/root/verify_gaocai_animation_trial` 随后通过正式 Sites 受管预览进入同一冻结运行候选，以真实 Chrome CUA 操作完成 246.676 秒的有界功能检查，画布 1363×936。**已执行范围 PASS，未观察到阻断本次试接的功能或明显体量、脚底、透明绘制问题。** 原完整矩阵仍有明确未执行项，机器总结果保留 **INCONCLUSIVE**；这不是正式动画、美术或全部故障场景通过。

本次取证冻结于 `2026-11-12T10:37:13.569815+00:00`。早先 Chromium socket 权限失败及 localhost:4175 连接被拒绝的 BLOCKED/NOT_RUN 记录仍有效，未删除或改成当时 PASS；正式受管预览后来解决页面可达性，新增了下表实际证据。验证者未修改候选、内部状态或访问策略。

### 实际覆盖与剩余项

| 编号 | 本次结果 | 实际观察与限制 |
| --- | --- | --- |
| GZ-ANIM-01 | PASS（已执行范围） | 在空地实际移动 E、W、N、S、NE、SW、NW、SE，观察原生/三镜像方向；途中改点转向、到达站姿抽查、Esc 停步、1/2 切换。未精确识别全部 40 个 walk 帧相位；NE 近到达截图仍是行走姿态，不能单用该张证明 idle。 |
| GZ-ANIM-02 | PASS（本视口采样） | 连续截图中高才与木匠主体高度相近，脚底与地面选择圈对齐，镜像未见围绕图边界横跳，alpha 未见实色矩形底。未穷举复杂前景遮挡或重新验收全部 40 帧美术；新高才比其他原型人物更纤细写实。 |
| GZ-ANIM-03-modal-reset | PASS | 西行中打开行囊，两张稳定 modal 截图间隔约 6.368 秒，主体位置和轮廓未见变化；关闭后继续行走，无可见补跑。说明内重开后回到初始南向、行囊 0、初始任务。仅行囊做此时序采样，说明/手记未分别重复。 |
| GZ-ANIM-03-hidden | NOT_RUN | 页面隐藏与恢复未执行。 |
| GZ-ANIM-04 | PASS | 仅高才显示新图；1/2 和头像切换正常，画布点木匠打开正确互动；实际走近木料并领取，行囊 0→1，场景包袱与行囊内木料可见；重开复位。 |
| GZ-ANIM-05 | NOT_RUN（浏览器故障注入） | 未执行缺 walk/idle/manifest 的浏览器资源故障注入；作者行为测试和 R-001 独立静态复审继续分别构成证据，不改称浏览器实测。 |

暂停证据来自可见帧采样，没有读取引擎内部 phase。JPEG 及 modal 背景模糊导致主体区域少量像素变化，故不声称逐像素或逐字节相同。没有取得 45 张角色 PNG 的逐项浏览器网络加载计数，没有真实录屏；实际截图序列没有合成成 GIF 来冒充录像。

E 步距偏急、NE04/05 近臂反摆/接缝等已知素材限制保留。本轮没有精确覆盖全部步态、脚滑、全部前景遮挡、隐藏页、手机真机、完整剧情或正式美术。

### 同一运行对象与实际发布

独立验证者结束时重新计算源 `web/` 与受管预览 `dist/`，两者均为 55 文件、46 张 PNG（45 张角色图加庭院），摘要相同：

- 八项运行文本：`949625e896be92bd001c4cba4cbedba5d0855bd26b898b1e2d04496219e0ba68`。
- 完整运行目录：`4266670e9dd9b89030c07d6b4f31229662fa3cda1193d048725fd8f41577f608`。
- 算法：按去除 `web/` 或 `dist/` 前缀的相对路径排序，逐项连接 UTF-8 路径 + NUL + 完整 bytes + NUL，再取 SHA-256。

发布者 `/root/prepare_private_animation_release` 在映射后执行一次 `npm test`，**27/27 PASS**；测试仅调整 `../web/` 到 `../dist/` 的路径，断言未改。它另核对 Site Git 提交与本地部署包的 55 项运行文件均与冻结候选逐字节一致；后续文档收尾没有改代码、测试或 PNG，没有再运行测试。

| 发布对象 | 实际回执 |
| --- | --- |
| 私有试玩 | [高老庄 · 风来有信](https://xiyou-gaolao-prototype.gbcdby98.chatgpt.site)，**v2** |
| Site source commit | `67a580c48ae7aeb032d8592d5c06ef932faced2c`，父 `967d7a6de638a9f42bd02a51988054a042a3e6fb` |
| Version ID | `appgprj_6af53a3e4fa08191802bab06cd371e68~appgver_6a64416eda648191893eee7c12c60929` |
| Deployment ID / 状态 | `appgdep_6af5964e43c4819180bdaa7ddf643b6c` / **succeeded** |
| 发布后访问回读 | latest version 2；custom revision 1；当前角色 owner，允许用户仅一位 owner，外部访客 0、组 0；原 URL 和访问范围保持 |

GitHub 的运行接入提交 `20f41f1eab66b1b2c80249add3d362914f83ecde` 与上述 Site source 属于不同仓库；之后追加本记录的 GitHub 提交仅变更文档。通过相同运行摘要建立对应，不将文档 head、Site source 或受管预览混为同一 Git 提交。`source-map.json` 的 PENDING 字段明确是初次文档冻结时快照，实际后续发布以本节及 PR/#25 回读记录为准。

发布后普通浏览器打开正式 URL，实际看到 **Sign in required / Log in to access**。当前未认证会话没有进入游戏，未点击登录或绕过访问控制，因此正式 URL 登录后的游戏、资源与交互检查仍为 **NOT_RUN**。上述实际游戏检查来自受管预览；发布成功、资产映射和正式网址登录门可达分别记录，不冒充线上游戏实测。用户可使用站点 owner 所用的 ChatGPT 账号正常登录试玩。

### 可取得的真实截图与接手入口

[gaocai-animation-trial-browser.jpg](https://chatgpt.com/library?file_id=libfile_fde3_f-90c79777fd748191a70b39945834faba_66aec10a983c8191a09f0deb89988b42&account_id=personal) 是受管预览中重开后的完整真实场景原图，与验证者 `reset-scene.jpg` 同字节，SHA-256 为 `5d1f3718fdcdaca017b284fa8473fd747b8c12c948c58a022cac6cc1c6c1fa1b`。**它不是正式 v2 URL 的线上截图，也不是视频。** 本节固化独立报告的关键身份、覆盖、结果和限制；PNG、原始截图序列与运行日志不进入 GitHub。

运行素材仍从 [README](README.md) 和 [assets.json](assets.json) 登记的恢复包取得：40 张 walk 与 5 张 idle 来自已有 PNG，既有 GIF/MP4 是 PNG 序列后编码预览，本轮没有取得原生生成 GIF。试玩顺序为“入庄一探”→点空地/方向键行走→Esc 停步→1/2 或头像切换对照，之后可取料或从说明重开。

本次更新 [PR #26](https://github.com/gbcdby/xiyou/pull/26) 并在 [#25](https://github.com/gbcdby/xiyou/issues/25) 交接；PR 仍为 draft，#25/#23 保持 open，main 与设计 PR #24 不变。不因此声明正式动画或完整首章已验收。
