# 高老庄原型检查与交接

## 结论与适用范围

2026-11-12，独立验证者对原始 15 文件候选完成真实桌面浏览器短流程和现有测试：**GZ-P-01 至 GZ-P-06 在本地原型范围 PASS，22/22 测试 PASS**。原始基线的 GZ-P-07 FAIL，因为缺少本检查文档，固定源码交付尚未核实。当前整理补齐检查/审查文档与可取得资产；文案微修和目录映射的最终对象及复验见“微修后候选与组合覆盖”。

本文件只陈述检查和交接事实。整票完成还需实际可访问的独立 owner-private 试玩、源码 draft PR 及其交付记录；本快照冻结时，这两项尚未由本整理者核实，实际交付状态与最终地址以 [#25 最新记录](https://github.com/gbcdby/xiyou/issues/25) 为索引。#25 与父任务 #23 保持 open。

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

- 六个运行文本使用去除 `dist/` / `web/` 前缀后的文件名，按名称排序连接 UTF-8 名称 + NUL + 完整内容 + NUL，SHA-256 为 `60169354dba140a2e5cf9d3b01dbaaf68cf0d7fd5264b3d8972e39e6aa98cb78`。两份最终候选逐文件字节相同，见 [source-map.json](source-map.json)。
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
| GZ-P-07 | 核对源码、运行方式、固定候选、检查证据、资产来源和后续入口。 | 原始基线 FAIL；当前文档/资产整理就绪，远端交付待核实 | B1：原验证报告、前后指纹；当前 [README](README.md)、[审查记录](review.md)、[资产登记](assets.json) | 文档补齐是整理者自查，不替代独立复审。draft PR 与 owner-private 试玩须由实际交付结果确认，本文件不提前判整票完成。 |

补充：在回顾点击“再走一回”后恢复高才、取料任务、行囊 0、空手记；现有重置测试覆盖旧 NPC 路径、证据和结算计划清除。证据为 B1 的 `13-restart-empty.jpg` 与 `npm-test.log`。#25 没有存档要求，刷新重开是已说明的原型行为。

## 原始证据与资产取得

| 编号 | 可取得材料 | 固定身份与用途 |
| --- | --- | --- |
| B1 | [检查证据 ZIP（基线与微修）](https://chatgpt.com/library?file_id=libfile_fde3_f-dcb5d7ae28c0819193c12df819d1c135_66aec10a983c8191a09f0deb89988b42&account_id=personal) | `xiyou-gaolao-prototype-25-baseline-evidence-20261112.zip`，SHA-256 `b3de87da6d7ea5a5c190c67dc6cd22950c7d9f37ca491ca09b88d3faae2bf814`；35 项成员含原始报告、合同快照、日志、前后指纹、13 张必要截图、微修与映射自查及清单；当前已保存版本为 1。 |
| A1 | [庭院资产 ZIP](https://chatgpt.com/library?file_id=libfile_fde3_f-fc9468445c1481919976698091b2e074_66aec10a983c8191a09f0deb89988b42&account_id=personal) | `xiyou-gaolao-courtyard-asset-20261112.zip`，SHA-256 `eed0546456090563b7bd876632bcdc49152d9bf8bd7aef3d209c639076acda49`；仅含原始 `courtyard.png` 和说明，无游戏源码。 |

上述是授权账号的持久文件入口，不能当匿名直链或应用运行时 URL。下载资产 ZIP 后，解压图片并按 [README](README.md) 指定路径放置。PNG 为 3,423,640 bytes、1586 × 992，SHA-256 为 `f5df307eaea03188e823a279cb3df3a65b1b6a7931c329294cd6b79e4c0d510a`；详见 [assets.json](assets.json)。运行截图、原始日志及 PNG 不写入 GitHub 源码目录；不绕过主分支的忽略约定。源码仅按冻结文本白名单入仓。

## 独立静态审查与已知限制

[review.md](review.md) 保留原始候选的有限静态审查。一位独立审查者分别检查需求轴与标准轴，未安排第二位独立审查者。该审查未执行测试或浏览器检查，未发现必须修改核心玩法的阻断；确认的 R-25-001 是缺失本检查文档。当前文档补齐及路径检查由整理者完成，不把作者自查称为第二次独立审查。

低高度/手机视口检查尝试通过真实 Chromium UI 开启 DevTools，但组织策略禁止，验证者停止该路径，没有绕过策略。B1 的 `14-devtools-blocked.png` 只证明未执行原因。桌面 `min-height:560px`、窄屏 `min-height:500px` 在更低视口下的滚动和可操作性仍未验证。手机真机按 #25 不在本票范围。

本轮未覆盖正式视觉基准、低高度与真机触控/性能、远程多人、真实 LLM、服务端权威/并发/重连/权限、完整信息权限、完整首章、长期存档或发布后环境。共享手记只在本地双角色间共用，NPC 改约是预设情境。

## 交付停点

后续交付复用既有 Sites 项目 `appgprj_6af53a3e4fa08191802bab06cd371e68`，保持独立 owner-private 试玩，不新建站点。GitHub 目标为 `prototypes/gaolaozhuang/` 的 draft PR；实际源码与运行包按映射清单对应。#25、#23 保持 open，禁止合并或接入正式游戏生产环境。

接手时先读 #25 最新记录，再读本文件和 README；用实际发布/PR 结果补充可访问地址与提交身份。当前检查摘要不是发布凭据，也不授予合并权限。
