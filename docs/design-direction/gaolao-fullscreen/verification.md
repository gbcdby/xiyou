# 高老庄全屏场景与镜头检查记录

日期：2026-11-21。合同：[GZ-UX-01 v0.8 / FS-01](../../specs/gaolao-client-experience.md)。任务：[唯一总票 #66](https://github.com/gbcdby/xiyou/issues/66)。

## 候选与结论

实现及专项脚本已经提交；前端作者检查通过，独立静态审查未留下确定阻断问题。**实际浏览器、四视口截图和连续镜头验收受环境限制而未完成，提交状态为 Draft PR。** 原始生成设计图只作为已采纳布局依据，不替代运行证据。

- 基线：`36750bf83a6f75d60a86cfb18fa40c0ad7e24a12`，包含大厅 PR #87。
- 本地冻结候选：`4df9e1074fc7218607d19bb6cea8b9a5508e1207`。
- [等树发布的实现提交](https://github.com/gbcdby/xiyou/commit/077c49616f7ec78ef33b0ffa9a9aebc1987519cd)：`077c49616f7ec78ef33b0ffa9a9aebc1987519cd`。
- 两者完整 Git tree 均为 `f208b543b57aa36c14908a719522a04d25d06dae`；发布时已逐项核对原图 blob 和完整 tree。后续本记录及原始日志为纯文档提交，不改变所检查的产品和脚本。

## 作者实际检查

最终检查在干净树运行，首尾 `sourceIdentity` 的 commit、tree、status 和全部源码摘要一致，Node.js 为 `v24.22.3`。详细身份、命令、退出码和日志摘要在 [author-checks.json](verification/author-checks.json)。

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| `npm test --prefix frontend` | **796/796 通过**，无跳过，退出码 0 | [完整单测输出](verification/frontend-tests.txt) |
| `npm run build --prefix frontend` | **通过**；包括 65 张原运行 PNG 的尺寸、字节和 SHA-256 校验、`vue-tsc --noEmit`、Vite 生产构建 | [完整构建输出](verification/frontend-build.txt) |
| 新专项入口、受控服务、原场景入口 `node --check` | **全部通过** | 命令和退出码见作者检查 JSON |
| `git diff --check` | **通过** | 作者检查 JSON |
| 受控初始、连续位移、换景及脚本终态 DTO | **公开 SnapshotV2 校验通过** | 本地有限协议自查；不作为真实浏览器或章节规则验收 |
| 自动浏览器与连续镜头 | **ENVIRONMENT_BLOCKED / 未进入产品断言** | 下方环境记录 |

针对镜头的单测覆盖 cover 与边界、自由取景保持、回中/减少动态、resize/换代、鼠标/单指阈值与取消、同一 Canvas fit 的绘制/命中/逆变换、画外标签及旧非 immersive 兼容。它们不能证明真实 pointer capture、GPU 呈现或手机视觉效果。

## 独立审查

非作者 `/root/gaolao_fullscreen_review` 只读检查全部变更及相关调用方，并对最终候选的证据守卫差量复审。作者没有把自己的自查写成独立运行验收。

| 轴 | 结论 | 边界 |
| --- | --- | --- |
| 需求轴 | **INCONCLUSIVE** | 静态合同对应和修正已核对；真实页面、触摸和连续画面尚无证据 |
| 标准轴 | **PASS，仅静态** | 职责、原数据授权、非 immersive 兼容、实际绘出帧变换、运动/呈现守卫、测试与证据边界 |
| 整体运行验收 | **INCONCLUSIVE** | FS-06 的浏览器与连续视觉部分未完成，不能标记 Ready/已验收 |

已修正并复审的具体问题：

1. 桌面“全部”地图被已打开的阅读浮层遮住：切到全部地图时统一收起原详情。
2. 任务详情内部按 Esc 后焦点丢失：关闭后回到详情入口，使用 `preventScroll`，不回中镜头。
3. 窄屏停步和回执按钮宽度不足：补齐最小 44px 热区；底部三组堆叠断点提高至 780px。
4. 浏览器检查仍依赖旧展开状态和回执位置：先通过真实任务/地点入口展开，回执改用唯一浮层入口，运行态回看检查禁用，终态再检验实际阅读。
5. 新专项证据保存：首尾源码变化明确 `FAIL_SOURCE_IDENTITY`；清理失败或连续记录保存失败不能保留 PASS。

## 环境限制与待补证据

锁定 Playwright 1.57.0 的 Chromium 143（rev1200）下载被当前网络环境拒绝。系统 Chromium 156.0.8078.79 在默认执行环境启动时报告：

```text
process_singleton_posix.cc:297
socket() failed: Operation not permitted (1)
```

一次本地浏览器提权请求被自动审批策略拒绝，原因为 `sandbox_approval: false`，不允许申请提升权限。随后通过受支持的浏览器 UI 工具尝试本地预览，导航返回 `ERR_CONNECTION_REFUSED`，读取错误页又被 URL 安全策略拒绝；没有取得实际页面截图。没有修改隔离/安全规则，也没有通过替换图片、伪造 DOM 或削弱验收来补成通过。临时预览进程已结束。

需在可运行浏览器的环境中，针对同一候选完成以下专项入口：

```bash
npm ci
npm ci --prefix frontend
frontend/node_modules/.bin/playwright install chromium
node frontend/tests/gaolao-fullscreen-browser.mjs
```

脚本使用生产 Vue 路由、Canvas、Socket 客户端、原始场景/高才资源与明确受控 DTO。目标视口为 1440×900、1366×768、390×844、844×390，保存跟随/自由视角截图、真实 paint 连续记录和 WebM；覆盖拖动不误点、自由取景、回中、边界、面板不改变画布、命中逆变换、取消/多指、收据与终态回看。`--serve-only` 只启动同一页面供查看，不产生通过结论；当前执行环境的随机本地端口并不能被另一个工具会话直接访问。

本次未执行同候选真实后端整章、手机真机、Safari、软键盘、全角色动画或远端 CI。既有协议、服务端权限、运动信用与资源门槛均保留；当前 65 项构建素材通过不等于全角色素材浏览器门槛通过。仓库 CI 仅由 main push 或手动触发，本次 PR 不会自动触发全量云端检查。
