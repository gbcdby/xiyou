# #25 高老庄原型有限静态审查

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

