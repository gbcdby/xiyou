# 高老庄全屏场景与镜头检查记录

日期：2026-11-21。合同：[GZ-UX-01 v0.8 / FS-01](../../specs/gaolao-client-experience.md)。任务：[唯一总票 #66](https://github.com/gbcdby/xiyou/issues/66)。

## 候选与结论

**本次全屏 UI 与镜头专项已在真实 Chromium 完成四视口验收，40 项全部通过；原章节与空间检查的两处适配也已在同一候选运行通过。** 独立需求轴、标准轴及本 UI 范围运行复审通过，FS-06 的真实浏览器证据已补齐。第三轮八个 job 全部结束，六个成功，方向 job 因 exact base 已有的草稿人物注册与发布素材不一致而失败，原汇总也为 FAIL。独立审查支持本次 UI PR 转 Ready 供审阅；不代表全 CI 通过或可以合并。PR 未合并，本结论不扩大为整个 #66、新模式真实后端整章或全角色美术验收。

实际截图与四份连续录像见[运行证据](runtime/README.md)，原始报告和检查日志见下方归档。生成设计图继续只作为已采纳布局依据。

- 基线：`36750bf83a6f75d60a86cfb18fa40c0ad7e24a12`，包含大厅 PR #87。
- 本地冻结候选：`4df9e1074fc7218607d19bb6cea8b9a5508e1207`。
- [等树发布的实现提交](https://github.com/gbcdby/xiyou/commit/077c49616f7ec78ef33b0ffa9a9aebc1987519cd)：`077c49616f7ec78ef33b0ffa9a9aebc1987519cd`。
- 两者完整 Git tree 均为 `f208b543b57aa36c14908a719522a04d25d06dae`；发布时已逐项核对原图 blob 和完整 tree。
- 首个四视口完整通过候选：[`0c18631a94ee288ca13247bec6ec1588f7bc6dab`](https://github.com/gbcdby/xiyou/commit/0c18631a94ee288ca13247bec6ec1588f7bc6dab)，tree 为 `5eed97d4c74c99f1dc55ba983aadb272ed692f6e`。在原实现上新增手动 CI 取证任务，并修正专项脚本对带数字徽标的回执入口定位；产品实现没有因此改变。
- 原章节/空间检查适配候选：[`41a68f6a223c6d9670aee98e37782ac28da613ef`](https://github.com/gbcdby/xiyou/commit/41a68f6a223c6d9670aee98e37782ac28da613ef)，tree 为 `7a924861ebe3451818eed0faf069eda7e5126b3a`，与本地 `e5c0bfab88caf3e2dc6300f43ddf2dd63966233c` 等树。此增量只改两份原有浏览器脚本，未改产品实现或预解码门槛。
- 本记录、代表截图、原始录像与报告属于随后证据归档，不修改被测产品或脚本，也不把原运行重新标记为归档提交的运行。

## 早期本地作者检查

最终检查在干净树运行，首尾 `sourceIdentity` 的 commit、tree、status 和全部源码摘要一致，Node.js 为 `v24.22.3`。详细身份、命令、退出码和日志摘要在 [author-checks.json](verification/author-checks.json)。

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| `npm test --prefix frontend` | **796/796 通过**，无跳过，退出码 0 | [完整单测输出](verification/frontend-tests.txt) |
| `npm run build --prefix frontend` | **通过**；包括 65 张原运行 PNG 的尺寸、字节和 SHA-256 校验、`vue-tsc --noEmit`、Vite 生产构建 | [完整构建输出](verification/frontend-build.txt) |
| 新专项入口、受控服务、原场景入口 `node --check` | **全部通过** | 命令和退出码见作者检查 JSON |
| `git diff --check` | **通过** | 作者检查 JSON |
| 受控初始、连续位移、换景及脚本终态 DTO | **公开 SnapshotV2 校验通过** | 本地有限协议自查；不作为真实浏览器或章节规则验收 |
| 当时本地自动浏览器与连续镜头 | **ENVIRONMENT_BLOCKED / 未进入产品断言** | 下方保留原限制；本轮远端补验另行记录 |

针对镜头的单测覆盖 cover 与边界、自由取景保持、回中/减少动态、resize/换代、鼠标/单指阈值与取消、同一 Canvas fit 的绘制/命中/逆变换、画外标签及旧非 immersive 兼容。它们不能证明真实 pointer capture、GPU 呈现或手机视觉效果。

## 真实浏览器与连续证据

通过已有登录会话的 GitHub Actions 正式页面，在 PR 分支选择 `Run workflow`，触发仓库已经存在的 `workflow_dispatch`。新增的 `browser_fullscreen` 手动任务固定 checkout 到 `github.sha`，独立安装两份锁依赖，运行完整前端单测、65 PNG 原资源检查、类型检查、生产构建及锁定 Chromium 专项。新任务以外的 workflow 内容保持字节相同；原权限、所有旧 jobs、依赖与汇总没有降低或删除。

| 运行 | 绑定候选 | 专项实际结论 |
| --- | --- | --- |
| [首轮 44894055878](https://github.com/gbcdby/xiyou/actions/runs/44894055878) | `2282d225bbc4921de2abc12f47fd2055ca3b18e6` | **FAIL**。1440 桌面前 7 项通过后，精确“回执”名称未匹配到实际带徽标的“回执 1”，点击超时。其余三尺寸未执行。 |
| [修正后 44894436437](https://github.com/gbcdby/xiyou/actions/runs/44894436437) | `0c18631a94ee288ca13247bec6ec1588f7bc6dab` | **PASS，40/40**。四视口各 10 项；同一 job 的前端 **796/796**、类型、构建和素材检查全部通过。 |
| [旧检查适配后 44895966222](https://github.com/gbcdby/xiyou/actions/runs/44895966222) | `41a68f6a223c6d9670aee98e37782ac28da613ef` | **PASS，40/40**。同一 job 的前端 **796/796**、类型、构建和 65 PNG 检查通过；两个旧脚本之外的产品源码未变。 |

首轮截图确认入口实际存在，错误来自脚本精确名称匹配。修正限定 `.gaolao-scene-utilities` 内的按钮角色，匹配回执及可选数字后缀，新增徽标严格等于 `1` 的断言；普通点击、原 `clientActionId` 查询、查询记录、Accepted 状态和原请求字节一致性检查全部保留。修正通过非作者复审后才发布新候选，不把首轮失败改写为成功。

第二轮 `44894436437` 的环境为 Ubuntu 24.04、Node.js 24.22.3、Playwright 1.57.0、Chromium 143.0.7499.4、DPR 1。运行于北京时间 2026-11-21 18:29:03–18:29:41；首尾 commit、tree、干净工作树及源码摘要一致，页面错误为 0，全部服务正常清理。下表及 runtime 归档媒体均属于这一轮。

| 视口 | 专项断言 | 实际 paint | 连续录像 |
| --- | --- | --- | --- |
| 1440×900，鼠标 | 10/10 PASS | 219 | 11.68 秒 |
| 1366×768，鼠标 | 10/10 PASS | 220 | 9.72 秒 |
| 390×844，Chromium 触摸 | 10/10 PASS | 236 | 8.28 秒 |
| 844×390，Chromium 触摸 | 10/10 PASS | 233 | 8.28 秒 |

检查覆盖全屏且无整页滚动、同帧本人插值跟随、拖动不误走/误选、自由镜头保持、按钮按实际偏移显隐、连续回中、减少动态、边界不露白、画外标签不贴边、HUD 与面板不改画布、点地逆变换/人物命中、键盘输入、取消/失焦/多指、原未知回执查询、resize、换景复位和受控终态回看。

保存了 24 张实际 PNG、四份 WebM 与 908 次真实 paint。截图 hash 均与原报告一致，四份录像全片解码退出码为 0。代表截图、全部四份原录像和 SHA-256 清单已[正式归档](runtime/README.md)；录像末段的固定画幅灰边来自测试将实际 viewport 缩小 20px，实际页面覆盖仍按当时视口核验。原始产物未裁切或重编码。

- [第二轮可读摘要](verification/ci-44894436437-summary.json)、[原始完整报告，无损 gzip](verification/ci-44894436437-result.json.gz)、[专项 stdout](verification/ci-44894436437-stdout.txt)、[完整 job 日志](verification/ci-44894436437-job.txt.gz)。
- [首轮原始失败报告，无损 gzip](verification/ci-44894055878-result.json.gz)、[首轮失败 stdout](verification/ci-44894055878-stdout.txt)。
- [完整 CI artifact](https://github.com/gbcdby/xiyou/actions/runs/44894436437/artifacts/14703059436)：33,902,210 bytes，SHA-256 `a40afda416d893dcb67a89ac234bc0f8ef4ae748e4bbc87136d253ead88096d2`，下载后已匹配 GitHub digest。

第三轮在北京时间 18:47:58–18:48:37 对 `41a68f6` 重新执行，四视口仍为 **40/40**，保存 908 次实际 paint、24 张 hash 匹配的截图和四份录像，页面错误为 0，全部清理完成，首尾源码身份相同。其[检查摘要](verification/ci-44895966222-summary.json)、[完整无损报告](verification/ci-44895966222-result.json.gz)与[原始 stdout](verification/ci-44895966222-stdout.txt)分别归档；[完整 artifact](https://github.com/gbcdby/xiyou/actions/runs/44895966222/artifacts/14704560457)为 33,971,299 bytes，SHA-256 `e37c36b462051fa38bc15c4adb7875477550764de65280ffb7d3a6c6a0ef2558`。runtime 目录的代表截图和原始录像仍明确绑定第二轮 `0c18631`，没有重新标成第三轮。

## 当前独立审查

非作者 `/root/gaolao_fullscreen_review` 只读检查全部变更及调用方，复审 CI 配置与回执定位修正，并对第二轮原报告、472 项源码文件 hash、24 张实际截图和保存的连续数据独立核对。作者没有把自己的自查写成独立运行验收。

| 轴 | 结论 | 边界 |
| --- | --- | --- |
| 需求轴 | **PASS，限本 UI 与镜头** | 四视口实际页面、鼠标/触摸、40 项断言及连续 paint 已核对 |
| 标准轴 | **PASS** | 原数据授权、非 immersive 兼容、实际变换、呈现守卫和原门槛保持；证据与来源完整 |
| 视觉及连续镜头 | **PASS，限声明样本** | 查看全部 24 张截图、9 张录像抽样帧；复算全部 paint 的覆盖、跟随和自由期 fit，四组回中 15 帧在约 229–235ms 内连续到达跟随中心 |

独立审查在专项范围内未发现新增 P1/P2 问题；原 CI 的 R-GZ-FS-005/006 在修正后另行做静态复审和实际复验，不用专项结论替代。全片解码来自 FS-V 检查，独立审查没有把抽帧查看描述为逐帧人工播放整段录像。

已修正并复审的具体问题：

1. 桌面“全部”地图被已打开的阅读浮层遮住：切到全部地图时统一收起原详情。
2. 任务详情内部按 Esc 后焦点丢失：关闭后回到详情入口，使用 `preventScroll`，不回中镜头。
3. 窄屏停步和回执按钮宽度不足：补齐最小 44px 热区；底部三组堆叠断点提高至 780px。
4. 浏览器检查仍依赖旧展开状态和回执位置：先通过真实任务/地点入口展开，回执改用唯一浮层入口，运行态回看检查禁用，终态再检验实际阅读。
5. 新专项证据保存：首尾源码变化明确 `FAIL_SOURCE_IDENTITY`；清理失败或连续记录保存失败不能保留 PASS。
6. 首轮实际运行发现“回执 1”与精确“回执”选择器不符：按实际可访问名称修正入口，并增加未决计数断言；完整四视口复跑通过。

## 本地环境限制与正式补验路径

锁定 Playwright 1.57.0 的 Chromium 143（rev1200）下载被当前网络环境拒绝。系统 Chromium 156.0.8078.79 在默认执行环境启动时报告：

```text
process_singleton_posix.cc:297
socket() failed: Operation not permitted (1)
```

早期本地浏览器提权请求被自动审批策略拒绝，原因为 `sandbox_approval: false`，不允许申请提升权限。随后通过受支持的浏览器 UI 工具尝试本地预览，导航返回 `ERR_CONNECTION_REFUSED`，读取错误页又被 URL 安全策略拒绝，当时没有取得实际页面截图。临时预览进程已结束。

用户要求继续进行合规请求后，重新提交了仅启动系统 Chromium 并加载内存页面的正式 `require_escalated` 请求；执行器仍在命令运行前拒绝，审批 UI 没有送达用户。随后使用不同的已授权验证环境：通过云浏览器在已有 GitHub 登录会话中打开正式 Actions 页面，显式选择 PR 分支，正常提交 `Run workflow`。该入口成功创建了上表三次运行；浏览器和页面服务在同一 CI runner 内完成实测。没有改变本地隔离策略、隧道转发本地页面或削弱功能断言。

相同专项的命令入口如下；远端手动任务还会先跑完整前端测试和构建：

```bash
npm ci
npm ci --prefix frontend
frontend/node_modules/.bin/playwright install --with-deps chromium
node frontend/tests/gaolao-fullscreen-browser.mjs
```

`--serve-only` 只启动同一页面供查看，不产生通过结论；当前执行环境的随机本地端口不能假设可被另一个工具会话访问。

专项使用受控公开 DTO、收据和回看 HTTP，不代表真实后端整章、服务端幂等、AI 或全角色动画验收；触摸为 Chromium 模拟，不代表手机真机、Safari、软键盘及系统边缘手势。65 项构建素材通过不等于全角色素材门槛通过。仓库仍仅由 main push 或手动触发云端检查。

## 原有 CI 与 PR 状态

首轮旧 `core` 在后端步骤被后续候选取消，五个依赖浏览器任务也取消，原汇总按既有规则失败；取消和跳过不计作通过。[第二轮运行](https://github.com/gbcdby/xiyou/actions/runs/44894436437)的全部八个 job 已完成，整体为 **FAIL**。以下旧失败保持其原候选身份，不因修正或专项成功改写。

| 第二轮 job | 实际结果 | 含义 |
| --- | --- | --- |
| 协议、规则、联机与前端构建 | PASS | 协议 66/66、内容 13/13、后端 571/571、前端 796/796，类型和构建通过 |
| 全屏与拖动镜头专项 | PASS | 本文四视口 40/40 |
| 首章静态资源浏览器 | PASS | 9 项限定静态资源检查 |
| 未决请求与恢复浏览器 | PASS | 原恢复流程通过 |
| 多人空间与对象几何浏览器 | FAIL | 报告已有 19 条 PASS 断言及 3 张截图记录，随后旧脚本仍对 immersive 要求 contain；与 FS-01 新 cover 合同不符 |
| 旧版 A2 章节浏览器 | FAIL | 1 项通过后，旧脚本直接等待默认已折叠的任务详情文字 |
| 连续输入与新模式多人浏览器 | FAIL | 正式场景和当前人物资源预解码条件 15 秒超时；后续方向业务断言未执行 |
| 原汇总 | FAIL | 如实汇总三个原浏览器失败 |

原件：[全部 jobs](verification/ci-44894436437-jobs.json)、[无损报告与摘要校验清单](verification/ci-44894436437-original-report-manifest.json)，以及 [空间](verification/ci-44894436437-spatial-job.txt.gz)、[章节](verification/ci-44894436437-legacy-job.txt.gz)、[方向](verification/ci-44894436437-direction-job.txt.gz)的原始 job 日志。四份原始失败报告分别为[空间](verification/ci-44894436437-spatial-result.json.gz)、[对象几何](verification/ci-44894436437-object-geometry-result.json.gz)、[章节](verification/ci-44894436437-legacy-result.json.gz)与[方向](verification/ci-44894436437-direction-result.json.gz)。

### 两处旧检查的精确适配

**R-GZ-FS-005**：章节脚本通过真实详情入口展开，保持进展文本精确相等、目标与下一步非空、旧固定目标不得出现的全部断言；仅在本函数打开详情时恢复原折叠状态，并核对 `aria-expanded=false`。

**R-GZ-FS-006**：同一 fixture 先在非 immersive 模式保留原 contain、完整世界和留白零动作检查；资源请求仍在途时切换正式 immersive，等实际 Canvas 达到 1600×1000 后，验证 cover 与同帧本人边界跟随。资源 ready 前后 fit、alpha 命中、标签避让、Enter 实际颜色、404/重试/换 view/迟到/撤销的原断言均保留。

两文件已经非作者静态复审通过。其 SHA-256 分别为 `906263ff4f384ded9421a535a31dec58d310fc9ff5925b67d0dfc0b31c580ec0` 和 `04e12d64f157268eaa39a9ecec437aabb8f8e0f9188a7e97878051f69490cef6`；语法与 diff 检查退出码 0。适配后通过正式页面触发[第三轮 44895966222](https://github.com/gbcdby/xiyou/actions/runs/44895966222)，绑定 `41a68f6`。该候选全屏专项再次 **40/40 PASS**；原空间与章节 job 均 **PASS**，全部八个 job 现已收束。

R-GZ-FS-006 已完成实际非作者复核：空间报告的 25 条记录中，有 **22 条 PASS 断言和 3 张截图/hash 记录**，不得写成 25 条断言。对象几何 4/4 PASS，非 immersive 实际视口 1150×460、fit=(scale 0.46, x 207, y 0)，切至 immersive 后为 1600×1000、fit=(1.1, 0, 0)，与预期相同。Enter 的实际颜色从 green=166/red=0 变为 green=0/red=314，黑色计数均为 0；资源在途、404/重试/换 view/迟到/撤销和清理均执行通过。[空间完整报告](verification/ci-44895966222-spatial-result.json.gz)及[对象几何原件](verification/ci-44895966222-object-geometry-result.json.gz)已无损归档。旧空间 harness 只有 source，没有 sourceEnd；它绑定干净的 `41a68f6` 候选，但不能套用专项的首尾一致声明。

R-GZ-FS-005 的[第三轮章节原件](verification/ci-44895966222-legacy-result.json.gz)为 **12/12 PASS**，通过真实 2 人/5 人救援与安置、私物许可/撤回、断线及丢 ACK 原身份恢复、双同貌实际物权、GZ-E01/E02/E03 持久终态和逐人授权分页复盘。实际回看响应 11 份、页面错误为 0，四项清理完成，source/sourceEnd 的 commit、tree、干净工作树及摘要一致。此为旧版 A2 场景回归，不代替受素材缺口阻塞的新模式方向完整验收。

### 原方向门槛：exact base 已有的素材集合不一致

原报告实际请求了 `carpenter`、`gao`、`wukong` 三套角色各 72 张，共 **216 张不在仓库和运行清单的图片**。渲染注册引用这些帧，`Canvas.prepare()` 会预加载当前投影人物的全部 idle/walk 帧；原门槛要求所有资源 ready，因此缺口足以阻断预解码完成。三份 manifest 自身仍标为来源与消费参数装配草稿，`metadataOnly=true`、`payloadCopied=false`；不能把这些缺帧称为已获批准的正式素材。

与 exact base `36750bf` 逐字节比较，角色注册、资源加载器、运行清单及三份 manifest 的六个 SHA-256 完全相同；运行素材子树均为 `cd9f85fd7d68c0f3d6fd90f9ed48594ff792762c`，同样只有 65 张 PNG，同样缺少这 216 张帧。引用的 `frontend/src/source-map.json` 不存在；现有项目归档没有找到这三套帧的可用恢复入口。详见[基线集合比较](verification/direction-asset-baseline-comparison.json)。

这项结论来自 exact base 的 Git 字节及素材集合核对，**未重跑 base 浏览器**。实际失败报告仍有 112 次 paint、87 次本人呈现被接受、0 页面错误；报告没有逐项保存 HTTP 状态或资源最终状态，不能写成“观察到 216 个 failed”，也不解释所有人物降级细节。65 项构建检查通过不代表全角色资源通过。本 PR 保持原预解码断言和失败状态，后续资产工作仍归 #66 的 ANIM 范围。

### 第三轮最终整体结果与 PR 边界

[第三轮 44895966222](https://github.com/gbcdby/xiyou/actions/runs/44895966222)绑定 `41a68f6a223c6d9670aee98e37782ac28da613ef`，tree `7a924861ebe3451818eed0faf069eda7e5126b3a`。全部八个 job 已完成：

| job | 最终结果 |
| --- | --- |
| 协议、规则、联机与前端构建 | **PASS**；66 协议、13 内容、571 后端、796 前端测试全部通过，无跳过，类型和构建通过 |
| 高老庄全屏与拖动镜头专项 | **PASS，40/40**，四视口及连续 paint |
| 多人空间与对象几何浏览器 | **PASS**；22 条 PASS 断言及 3 张截图记录，对象几何 4/4 已含于其中 |
| 旧版 A2 章节浏览器 | **PASS，12/12**，三种持久终态与授权回看 |
| 首章静态资源浏览器 | **PASS，9/9**，原有 65 PNG 的限定发布范围 |
| 未决请求与恢复浏览器 | **PASS**，报告 `passed=true` |
| 连续输入与新模式多人浏览器 | **FAIL**；原预解码门槛同一行 15 秒超时，方向业务断言 0 项，后续 late/five 场景未运行 |
| 原汇总 | **FAIL**，完整保留上述方向失败 |

归档包括[最终可读整体摘要](verification/ci-44895966222-final-summary.json)、[平台 jobs 原件](verification/ci-44895966222-jobs.json)、[六份原浏览器报告校验清单](verification/ci-44895966222-original-report-manifest.json)、[八份 job 日志校验清单](verification/ci-44895966222-job-log-manifest.json)和[平台 artifact 元数据](verification/ci-44895966222-artifacts.json)。其中[方向失败原件](verification/ci-44895966222-direction-result.json.gz)、[静态资源原件](verification/ci-44895966222-static-result.json.gz)、[恢复原件](verification/ci-44895966222-retention-result.json.gz)同样按原始字节无损保存。

Ready 仅表示本次 FS-01 UI 与镜头变更已经形成可审查候选。依据 FS-06 和 Spec §3 的 ANIM 不阻塞 UX 组合 PR 边界，已验证的 UI 范围可以提交正式审阅，同时保留原方向及汇总 FAIL、未运行范围和素材采用缺口。本轮没有合并、部署或关闭 #66，也没有因专项成功而删除原 CI 失败。
