# #25 高才方向动画试接独立静态复审

## 当前结论与候选身份

2026-11-12，独立 reviewer `/root/review_gaocai_animation_trial` 完成两轮静态审查，最终结论为 **PASS WITH KNOWN ART LIMITS**。一位独立审查者分别审查需求轴与标准轴；不是双人审查。交付整理者仅将该报告的结论与证据边界写入本文件，没有修改运行源码、测试或 PNG，也没有新增独立审查或浏览器验收。

- 基线：`prototype/25-gaolaozhuang@afa12ea57c1b84b7b902a970dfeea724bf7b346d`，既有 [draft PR #26](https://github.com/gbcdby/xiyou/pull/26)。
- 本轮复审对象：8 项运行文本摘要 `sha256:949625e896be92bd001c4cba4cbedba5d0855bd26b898b1e2d04496219e0ba68`。
- `web/world.mjs` SHA-256：`db3d1aa0e10c812023d0208aaa44b069f4de55255a89727ecb84e663b52fcff1`。
- 首轮对象：`sha256:021112bbc3258a3b8956741ca16bdf14c9c93b8c7200ef374a28d8ebb0aa5f1f`；只作为已修发现的背景。
- 指纹算法与逐文件身份见 [source-map.json](source-map.json)，执行证据与未覆盖项见 [verification.md](verification.md)。

| 审查轴 | 最终结论 | 范围 |
| --- | --- | --- |
| 需求轴 | PASS | 本轮高才八向、原生/镜像与实际位移驱动的静态接入；R-001 已核对修正，没有未解决代码阻断 |
| 标准轴 | PASS | 模块职责、无 DOM 引擎、保留现有行为，以及源码与托管目标映射 |

## R-gaocai-animation-001：损坏清单可能中断主循环

首轮发现：清单中的站姿、脚底锚点或帧时长结构损坏时，后续 `draw` 可抛出异常，影响整局继续运行。严重度为中，原为阻断代码问题；最终状态 **VERIFIED，blocking=false**。

实现者在 `world.mjs` 启用角色资源前校验绘制实际消费的 `file`、源尺寸、`scale`、`footPivot`、8 帧数组及有限正帧时长。无效整包保持 `gaocaiSprites=null`，继续旧矢量人物；缺失或坏 JSON 仍由外层捕获，逐方向缺图的 idle/矢量降级保持原样。

复审者只读核对了以下证据：

- E-06：重新计算 8 项文本指纹，等于最终冻结值；`source-map.json` 的 runtime 摘要、字节数和白名单一致。
- E-07：无效站姿、锚点、帧数组和时长在启用前被拒绝，原逐帧异常路径不再可达。
- E-08：新增测试调用真实 preload 与 draw，以 Canvas/Image 宿主替身覆盖 `idle=null`、`footPivot=null`、`frameDurationMs=0`，检查错误提示、移动/站立绘制、名称与图片回退；审查者没有运行测试。
- E-09：去除新增 9 行校验块后，`world.mjs` 摘要等于首轮版本；其他 7 项 runtime 与首轮一致，首轮已审主路径结论继续适用。
- E-10：作者报告 `npm test` 27/27 PASS，并报告新增回退用例先复现再修绿；这是作者自查，未计为审查者独立运行证据。

## 未覆盖与保留限制

独立浏览器验收为 **BLOCKED**：本地 Chromium 启动遇到 socket 权限限制，正式云浏览器访问 localhost 被拒绝，均未进入页面。GZ-ANIM-01～05 全部 NOT_RUN，没有当前场景截图、连续运动、完整交互、抽屉/页面隐藏暂停或故障资源浏览器通过证据。R-001 修后只复核文件身份，没有重跑上述失败环境路径。

E 原 v1 步距偏急、NE04/05 近臂反摆/接缝，以及连续脚滑、比例、低置信度脚底锚点和 76 单位体量仍为已知美术限制。已有素材来自 PNG，5 个原生方向加 3 个镜像方向；本轮没有生成原生 GIF。用户允许试接，不等于正式动画验收通过。

审查者没有重跑作者测试、重核 45 张 PNG 来源字节、上传/部署或核验发布环境，也没有执行合并。本报告只支持已授权私有试用候选的静态结论；实际分支更新、站点发布和用户试玩须分别记录。

---

# 历史：#25 高老庄原型有限静态审查

这是对原始候选的审查记录。交付整理只去除了本地绝对路径，保留原候选身份和结论。后续文档补齐、账本文案微修与路径映射不在本次独立静态审查范围，见 [verification.md](verification.md)。原始报告保存在 [基线证据包](https://chatgpt.com/library?file_id=libfile_fde3_f-dcb5d7ae28c0819193c12df819d1c135_66aec10a983c8191a09f0deb89988b42&account_id=personal) 的 `static-review-original.md`。

## 候选与证据

- work_id：xiyou #25；合同：[GZ-P-01～07](https://github.com/gbcdby/xiyou/issues/25)。
- subject.kind：worktree；对象：原始 15 文件本地候选，以下摘要固定其内容。历史 `dist/` 路径在 GitHub 候选中映射为 `web/`，详见 [verification.md](verification.md)。
- subject.id / worktree_digest：`sha256:efb95d8b43cf8ed310cd66a376e5f7233e825da24003692299995122a3518c28`，本轮复算与调度固定候选一致。
- 身份：本地 main 无提交，15 个未跟踪文件；不是已提交 PR。
- 摘要算法：按相对路径排序，逐文件连接 UTF-8 路径 + NUL + 完整内容 + NUL，对连接结果取 SHA-256。
- 审查者：`/root/review_prototype_baseline`，independent。一位独立审查者分别检查需求轴和标准轴；未安排第二位独立审查者，不宣称完整双审。
- evidence.kind：source_inspection；status：OBSERVED。未执行测试、未操作浏览器、未修改源码、未创建 PR。
- 依据：直接读取 #25 最新正文，项目 AGENTS、工程约定、工作流、设计资料入口；读取 engine、navigation、app、world、HTML/CSS、现有测试与交接资料。
- 本报告是已完成审查的收尾记录，没有新增审查或运行检查。

摘要覆盖文件：

```text
.gitignore
.openai/hosting.json
README.md
assets.json
dist/app.mjs
dist/assets/courtyard.png
dist/engine.mjs
dist/index.html
dist/navigation.mjs
dist/style.css
dist/world.mjs
package.json
tests/engine.test.mjs
tests/navigation.test.mjs
tests/world.test.mjs
```

## 分轴结论

| 轴 | 结论 |
| --- | --- |
| 需求轴 | 玩法源码范围未发现阻断；交付完整性尚未满足。GZ-P-02～06 的必要状态、物权与到场条件均可追溯。GZ-P-01 的运行与可辨识性由浏览器验证负责；GZ-P-07 缺检查文档。 |
| 标准轴 | 已审静态范围通过。逻辑、绘制与输入协调分离；未接入生产协议；本地模拟、预设 NPC、共享手记及未实现范围标注明确。素材登记的图片尺寸、字节数和 SHA-256 与实际文件一致。 |

没有确认必须修改核心玩法代码的缺陷；不得据此声明整票、正式视觉或完整首章验收通过。

## 核心核对

- `engine.mjs/getActions + interact`：两份木料限定角色领取，安装方不能包办另一侧；账本仅有一个 owner，重复领取、非持有人交接和远距离操作均有条件限制。
- `settleArrivals`：双门撑准备不会直接开门，悟空须实际到门边。翠兰先接受邀请，再移动到安置点且停止后才记安全；暂停、继续和近距换领队路径存在。符合受控 NPC 演示合同，不代表自主 AI 决策验收。
- 改约与会面：先收集并送达线索；改约安排 NPC 路径；结算重新检查唐僧、八戒真实位置，要求账本由现场持有人出示。
- `navigation.mjs` 与 `app.mjs/restart`：停步、换路和切换角色清除排队动作；重开清空旧 NPC 计划、所有权、证据及回顾状态。刷新重开与 README 一致，本票不要求存档。
- README、开场说明、帮助和结算均未将原型说成真实多人、真实 LLM 或完整首章。

## R-25-001：检查文档缺失

- axis：requirements；severity：中等交付缺口；status：OPEN。
- blocking：阻断 GZ-P-07 完整交付声明；不阻断继续浏览器验证，不要求修改玩法代码。
- subject_id：上述固定工作树摘要。
- location：README.md 第 54、60 行引用 `verification.md`；审查时实际文件不存在。
- impact：后续 Agent 无法按入口取得本候选实际检查结果及未覆盖范围。
- recommended_action：根据 verifier 实际输出补齐 `verification.md`，记录候选摘要、环境、GZ-P 覆盖、真实结果、证据位置和未执行项。预览地址和草稿 PR 在交付步骤实际固定后补入，不提前写成完成。

## 非阻断观察与未覆盖

`style.css` 为 #app 设置桌面 min-height:560px、窄屏 min-height:500px。更低的横屏视口会令底部操作区超出初始视口；滚动与继续操作的实际可用性需浏览器观察。线索已发 verifier；不计确认阻断，不新增手机真机验收门槛。

本轮未覆盖正式视觉基准、真机表现、真实多人、服务端权威、重连、LLM、完整信息权限及首章终局。本报告没有独立生成测试日志；执行检查证据应采用 verifier 的实际产物。

## 修正边界

验证与交接 worker 可独立补齐 verification.md 和实际交付引用，预览与草稿 PR 按原计划推进。本轮没有需要分派给实现 worker 的核心代码修正项。

