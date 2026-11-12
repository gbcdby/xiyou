# 高老庄 · 风来有信

《西游记》多人无战斗叙事游戏的**独立 H5 交互原型**。本轮先让一个人在同一页面切换高才和木匠，体验真实行走、近距操作、协作开门、护送和带证据赴约。这是同一浏览器内的本地双角色和预设 NPC 模拟，无远程多人、真实 LLM；高才本轮试用五原生、三镜像的八方向行走与站立素材，尚未通过正式动画验收。本票不等于完整首章或正式视觉验收，也不连接生产房间。

**当前归档基准（2026-11-12）：**用户已[接受私有试玩 v2 中高才的八向行走动作](https://github.com/gbcdby/xiyou/issues/25#issuecomment-6822385165)，作为本轮试玩动作基准。本次按用户新增决定，通过 [PR #26](https://github.com/gbcdby/xiyou/pull/26) 将本目录保存为 `main` 中可恢复的独立 H5 原型基准；实际合并与 #25 收尾结果以 PR 和任务记录为准。该动作接受不扩大为完整动画矩阵、完整首章或正式多人产品验收。

## 同日后续交付：私有试玩 v2

[原私有试玩](https://xiyou-gaolao-prototype.gbcdby98.chatgpt.site)已更新为 **v2**，访问仍仅限 owner。独立验证者随后通过正式 Sites 受管预览，实际检查八向/镜像移动、停步与切换、行囊暂停恢复、取料持物及重开；已执行范围 PASS，完整矩阵因隐藏页与浏览器故障注入等未执行而仍为 INCONCLUSIVE。正式 URL 当前未认证浏览器只到登录门，未做登录后线上游戏验收。[检查记录](verification.md)末节保存本次增量、发布身份和[真实受管预览截图](https://chatgpt.com/library?file_id=libfile_fde3_f-90c79777fd748191a70b39945834faba_66aec10a983c8191a09f0deb89988b42&account_id=personal)。下文初次冻结的 BLOCKED/PENDING 是当时事实，继续保留；素材与正式美术限制仍有效。

## 任务与依据

- 原型任务：[xiyou #25](https://github.com/gbcdby/xiyou/issues/25)。父任务：[ADV-001 #23](https://github.com/gbcdby/xiyou/issues/23)。
- `spec_ref`：[ADV-001 v0.2](https://github.com/gbcdby/xiyou/blob/2dc4fb4332860b60127e654b61bdae4925a5e61f/docs/specs/narrative-adventure.md)，设计候选提交 `2dc4fb4332860b60127e654b61bdae4925a5e61f`，见草稿 PR #24。
- 代码观察基线：`main@5d0befff3673c840756d64a982878ac76dfd0273`。本目录与现有 Vue / Socket.IO 应用隔离；没有迁移它的协议、依赖或世界状态。
- 本轮授权：2026-11-12 用户要求先做高老庄原型，并为后续 Agent 留票记录；后续接受当前高才动作，并新增将 PR #26 合入 `main` 保存原型基准的决定。
- 原型验收使用 `GZ-P-01` 至 `GZ-P-07`，唯一定义和完成终点在 #25。不能把它们换写成完整 `ADV-AC` / `GZ-AC` 已通过。

## 启动

先从 [assets.json](assets.json) 中 `external_download_url` 登记的素材包入口下载庭院 ZIP，将其中的 `courtyard.png` 解压到 `web/assets/courtyard.png`。这是授权账号的文件下载入口，不是浏览器运行时的图片直链。原始 PNG 为 3,423,640 字节，SHA-256 必须为 `f5df307eaea03188e823a279cb3df3a65b1b6a7931c329294cd6b79e4c0d510a`；不要提交图片二进制。`npm test` 不依赖这张图片，完整浏览器画面需要先恢复素材。

高才素材从 [gaocai-player-animation-runtime-v1.zip](https://chatgpt.com/library?file_id=libfile_fde3_f-e9e9279c65308191846ce6457cfa5a9e_66aec10a983c8191a09f0deb89988b42&account_id=personal) 恢复，ZIP 为 6,748,031 字节、SHA-256 `cdd47ffb7c7e0582c7bd46340b30ad7aeffa1d471e1b55134a0422515cc7d242`。将包内 `runtime/gaocai/` 的内容复制到 `web/assets/gaocai/`；运行时读取本地相对路径的 `manifest.json` 与 45 张 PNG，不把下载入口当作 CDN。图片总计 6,737,985 字节；逐帧 SHA-256、源尺寸、脚底锚点与缩放见清单。源图来自已有生成 PNG，本次没有原生 GIF 输出。

本目录的 `web/` 是手写运行源码，不是构建输出。当前运行文本共八项：原六项、`gaocai-animation.mjs` 和角色 `manifest.json`。托管运行包目标仍为 `dist/`，相对路径保持不变；初次冻结候选的映射与 SHA-256 见 [source-map.json](source-map.json)，其中的 PENDING/draft 等状态保留为冻结时快照。后续私有试玩已更新为 v2，实际 GitHub 提交、合并与私有试玩身份以 [PR #26](https://github.com/gbcdby/xiyou/pull/26) 和 [#25 最新记录](https://github.com/gbcdby/xiyou/issues/25) 为准。

此原型不需要安装依赖或构建。使用支持 ES module 的现代浏览器，通过 HTTP 打开 `web/`，不要直接双击 `file://`。

```sh
cd prototypes/gaolaozhuang
python3 -m http.server 4173 --directory web
```

然后访问 `http://localhost:4173`。纯引擎检查使用本机 Node.js：

```sh
npm test
```

本目录不携带托管项目配置；独立托管运行包保留原 `dist/` 结构与素材，使用其既有预览入口。GitHub #25 及其 PR 是接手入口。

## 操作与短流程

点击空地行走；点击人物或物件后选择动作，角色会先走近。点击右上头像或按 `1` / `2` 切换角色，`E` 打开最近的互动，方向键也可以移动。点击“停步”或按 `Esc` 取消当前行走和排队互动；切换同伴也会取消上一人的行走与排队动作。“去下一处”只带路，到场后仍需玩家选择行动。

1. 两名角色各领取一份木料，各安装一侧门撑。门撑锁定后可离开。
2. 走近悟空请求协助；他要实际走到门口才会开门。
3. 与翠兰交谈，明确邀请她到前庭安置。她同意后才会随行；可以暂停、继续或换人带领。本人实际抵达才算安全。
4. 找到旧饭账，询问厨娘，向唐长老出示证据。账本只有一位持有人，接近同伴后可以交接。
5. 到猪刚鬣身边提出会面；他会在这条预设演示中改约庄口。带着账本走过去，再完成交谈。

完成后展示的是**样片回顾**，并未执行正式收徒、自愿分别或离庄终局。原型刷新即重开；打开行囊、手记、说明或回顾时暂停本地模拟；切到其他标签页也暂停。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `web/engine.mjs` | 地图、寻路、物件所有权、动作前置条件、受控 NPC、进度与事实；无 DOM 依赖 |
| `web/world.mjs` | Canvas 场景、角色绘制、路径与点击命中；不修改游戏事实 |
| `web/app.mjs` | DOM 界面、输入、手记与回顾 |
| `web/gaocai-animation.mjs` | 实际位移的八方向量化、原生/镜像映射、距离帧相位；无独立时钟 |
| `web/assets/gaocai/manifest.json` | 5 个原生方向的 40 张行走帧、5 张站姿、逐帧脚底锚点与最终缩放；PNG 外置恢复 |
| `web/navigation.mjs` | 导航与到达动作排队；地点精确到达、停步及切换取消 |
| `web/style.css` / `web/index.html` | 水墨淡彩界面与页面结构 |
| `web/assets/courtyard.png` | 下载资产 ZIP 后恢复的原始底图；GitHub 不含此 PNG，恢复方式见上文 |
| `tests/*.test.mjs` | 引擎、导航、动画方向/相位与资源回退的行为检查；不替代浏览器或正式美术验收 |
| [assets.json](assets.json) | 美术与声音来源、庭院资产包入口及恢复校验 |
| [verification.md](verification.md) | 本轮 GZ-ANIM-01 至 05、作者测试，以及历史 GZ-P 检查与未覆盖项 |
| [review.md](review.md) | 本轮动画独立静态复审、R-001 修正及历史基线审查边界 |
| [source-map.json](source-map.json) | 本轮冻结运行源码、测试路径、素材映射及 SHA-256；托管目标不冒充已部署 |

逻辑地图为 `1600 × 1000`，背景与交互层独立。角色、门障与交互物件使用 Canvas 绘制以便快速改动。仅高才接入本次 PNG 方向动画；木匠与 NPC 保留原绘制。这些仍是可替换的原型资产，不是正式动画验收结果。

## 高才动画试用合同

本轮对应用户“把玩家操作的那个角色做成这个，再看看原型里的表现”的试用要求，基于 PR #26 分支 `prototype/25-gaolaozhuang` 的 `afa12ea57c1b84b7b902a970dfeea724bf7b346d`。只更换高才的外观，角色落点、碰撞、点击命中、距离、路径与按 y 排序沿用原型规则。

- S、SE、E、NE、N 使用原生帧；W、SW、NW 分别绕脚底镜像 E、SE、NE。名字、选择环、玩家标记与贴图上的持物提示独立保留。
- 主体高初值为 76 地图单位。每帧按清单的 `footPivot` 与最终 `scale` 绘制，不再乘 `groupScale`，不逐帧拉成等高。Idle 使用自己的基准图锚点；NE 后四帧的 0.70 已计入最终缩放。
- 引擎按实际非零路段更新末朝向。帧相位来自累计实际行走距离：18.45 单位/帧、147.6 单位/周期，等价于参考速度 205 单位/秒下 90ms/帧；该参数未做物理配速验收。
- 停步、到达和切换同伴保留末朝向，显示相应站姿。打开说明、行囊、手记、回顾及页面隐藏时引擎不推进，步态冻结且恢复不补跑。重开创建新角色，朝向南、累计路程清零；渲染器没有残留的角色相位缓存。
- 预载未完成或清单绘制字段损坏时使用旧矢量高才。某原生方向缺行走帧时整组改用同方向站姿；站姿也缺失时使用旧矢量绘制。角色与场景图片的失败提示分开。

初次冻结时，素材的 S/N 连续脚滑与接缝、SE 完整双步、E 的 00→01 与 04→05 步距、NE 两批比例/接缝及 04/05 近臂反摆尚未验收。镜像会反转交领与光照。76 单位体量与全部脚底锚点是低置信度试接初值；当时独立验证者的两条浏览器入口均被环境阻塞，尚未进入页面。后续受管预览检查与用户动作接受见本文顶部和 [verification.md](verification.md)；E/NE 的历史艺术观察现为本轮非阻断的可选优化，不再据此安排返工。全部步态相位、连续脚滑及最终体量/锚点仍未完成全面艺术核验。

## 初次交付冻结时的检查状态（历史）

| 证据层 | 当前结论 | 能证明的范围 |
| --- | --- | --- |
| 实现者行为测试 | `npm test` 27/27 PASS | 引擎、八向与距离相位、停步/切换/重开、缺损清单回退；Canvas/Image 使用宿主替身 |
| 独立静态复审 | PASS WITH KNOWN ART LIMITS | 需求轴与标准轴通过；清单字段损坏导致主循环停止的 R-gaocai-animation-001 已修正并 VERIFIED |
| 独立浏览器验收 | GZ-ANIM-01～05 全部 NOT_RUN / BLOCKED | 本地 Chromium socket 权限失败，正式云浏览器访问 localhost 被拒绝；没有场景截图、连续运动或交互通过证据 |
| 私有试玩更新 | 交由发布记录确认 | 文档冻结不代表已发布；保持既有 owner-private 访问范围 |

当前八项运行文本摘要为 `949625e896be92bd001c4cba4cbedba5d0855bd26b898b1e2d04496219e0ba68`，完整 `web/` 文件树摘要为 `4266670e9dd9b89030c07d6b4f31229662fa3cda1193d048725fd8f41577f608`；算法见 [source-map.json](source-map.json)。初次冻结时，本轮可作为已授权试接交给用户体验，但尚未完成正式动画、真实浏览器或完整首章验收；后续受管预览已执行范围和用户动作接受见本文顶部，完整矩阵仍为 INCONCLUSIVE。

## 后续 Agent 接手

先读 [#25 的最新记录](https://github.com/gbcdby/xiyou/issues/25)及 [PR #26](https://github.com/gbcdby/xiyou/pull/26)，再看 [verification.md](verification.md)。当前停点是独立 H5 原型交付与 `main` 归档，#25 按此范围收尾；父任务 [#23](https://github.com/gbcdby/xiyou/issues/23)继续 open，正式 A1/A2/A3、真实多人/NPC、完整首章和后续章节仍需各自的 Spec、Tickets 与验收。本原型的观察、交互和素材规则可以复用，不能替代正式交付或直接把本地引擎接到生产房间。

**历史停点（已由本次归档决定更新）：**初次交付时 #25/#23 均保持 open，等待用户试玩决定是否保留短流程；该等待不再是当前原型归档的前置条件。

推荐的下一轮顺序：先消化用户对行走、操作频率、任务引导和协作感觉的反馈；随后按正式 Spec 单独拆 A1 的空间与多人动作票，再讨论真实 NPC 接入。正式实现应复用现有 Vue 客户端 / Session 协议；本原型主要可复用地图、交互语言、行为验收与素材分层思路。若选择复用引擎代码，必须先把事实裁定迁回服务端并补协议设计。

正式多人开发仍需处理服务端权威、`clientActionId` 幂等、多人抢物、断线重连、受控角色交还、会话顺序、同意与物权权限、合法 NPC 感知以及模型超时 fallback。相关协议变更遵循项目的 Spec 与形式化要求；本地模拟测试不能证明这些性质。

本轮没有真实 LLM、随机行为评估、隐私/乔装完整机制、2–5 人联机、跨章游历、真机性能数据或完整首章验收。共享手记在本地两角色间共用，未模拟正式角色之间的信息权限。NPC 改约是固定的可复现演示，用来试出“计划改变后要重新行动”的感觉；不宣称 AI 自发涌现。

## 交付边界

本次授权终点已扩展为：保存可访问的独立原型、可恢复源码与素材说明、检查及后续 Agent 交接，并将 [PR #26](https://github.com/gbcdby/xiyou/pull/26) 以正常合并流程合入 `main` 归档，按原型范围关闭 #25。源码目标仍为 `prototypes/gaolaozhuang/`；实际合并提交和任务状态以 PR / [#25 最新记录](https://github.com/gbcdby/xiyou/issues/25) 为准。#23 与设计草稿 PR #24 保持独立、open；正式产品实现及验收边界不变。

**历史停点（初次文档冻结）：**当时授权只到可访问原型、检查、Agent 交接与 draft PR，#25/#23 保持 open，禁止自动合并；当时 PR 为 draft/open，动画候选尚待提交及发布。该合并停点现由用户新增的 `main` 归档决定更新，历史发布事实仍保留，不改写为当时已上线。

[既有私有试玩入口](https://xiyou-gaolao-prototype.gbcdby98.chatgpt.site)保持 v2、owner-private，Sites 项目为 `appgprj_6af53a3e4fa08191802bab06cd371e68`。本次只归档源码，不重新部署或调整访问范围，不接入正式游戏生产环境；源码与资产只用于本项目的授权交付。

原始浏览器全流程与微修后的定向复验分别报告，详见 [verification.md](verification.md)。运行截图、原始日志及图片二进制按项目规则独立保存，不写入 GitHub 源码目录。
