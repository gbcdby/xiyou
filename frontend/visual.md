# 高老庄渲染合同

依据：[GZ-UX-01](../docs/specs/gaolao-client-experience.md)、[GZ-VIS-01 / v1.1](../docs/specs/gaolaozhuang-visual.md) 和 [公开造型协商](../protocol/spatial-appearance-v1.md)。当前 Canvas、固定取景和全场物理显示按 GZ-UX-01；本轮改动与实际证据统一记录在 [#66](https://github.com/gbcdby/xiyou/issues/66)。本文件描述运行实现，不替代独立审查或全素材验收。

## 权威位置与公开外观

背景、角色、物件、路线、姓名和反馈由同一 Canvas 2D 完整合成，一次呈现。人物位置始终是服务端授权脚底；文字按 CSS 像素绘制，与世界共用固定等比 fit 和点击逆变换。不能为了文字移动权威人物。可选姓名保留至少 14px 字体、44×44px 区域；容不下的标签保留“场景对象”列表入口，不按姓名可容纳数删掉物理对象。

人物身体、脚底和文字都选择同一当前公开引用。PNG 身体命中轮廓来自当前帧原始 alpha，随脚底缩放与镜像一起变换；透明边缘与内部空隙不扩成矩形选择区。中性回退按实际可见轮廓选择，脚底阴影也可命中；姓名与列表提供更大的可访问入口。选择不透明身体不会穿透发出地面移动。

新客户端在创建、加入、HTTP 和 Socket 鉴权统一声明 `spatial-v2,spatial-appearance-v1,spatial-object-visual-v1,gaolao-personal-consent-v1,spatial-scene-overview-v1`。同场公共物理实体来自人类专用 `sceneOverview`；原详情、事件感知、NPC 知识和操作范围保持独立。只用当前授权 `appearanceId` 选择美术，不能按称呼、观察者知识、`entityRef` 或隐藏真身选择。外观版本变化时撤销旧绑定，可信 URL 的已解码图片可安全复用；旧服务缺字段或缺本地资源时显示同一中性回退。角色称呼和可见编号继续由原授权标签规则负责。

## 确认移动与步态

`ConfirmedMotion` 只采样合法投影之间已经发生的确认路径，衔接连续短计划并保留累计步态路程，不外推未来路径，不回写服务端位置。角色朝向和步态路程从同一条已确认折线计算，转角保留路径顶点。停止使用末段朝向的独立站姿；换视图、场景、控制代次、外观代次或连续轨迹缺失时不延续旧步态。

高才使用原帧的 `footPivot` 和最终 `scale`，不再叠乘 `groupScale`，不逐帧按边界归一化。镜像只作用于脚底局部的图像，姓名、选择环、持物权与操作目标不镜像。系统减弱动态模式直接呈现确认位置和站姿，文字与操作状态保留。个人打开阅读区不会暂停另一个玩家。

## 布局与资源故障

主场景始终完整显示当前 `0..width / 0..height`，仅在场景、容器尺寸或 DPR 改变时等比 fit。本人移动、选择、逐帧身体边界、HUD 开合不平移或缩放主镜头。右上地图提供当前场景与全部公开场景的定位；跨景前往按合法出口逐段执行。桌面用固定上栏、侧栏和底部工具；窄屏地图与阅读面板按需展开，正文可滚动。

图片按可信 URL 缓存与预解码；整套走步帧尚未齐备或某帧失败时稳定使用同朝向站姿，再回退中性图形，点击区和授权文字继续存在；按“重新载入图像”可重试。素材位置与正式缺口见 [运行图像说明](public/assets/gaolaozhuang/README.md)。中性回退和庄外概念不代表完整正式美术通过。

## 当前检查入口

```sh
node frontend/tests/client-experience-browser.mjs
```

该入口显式使用正式 `gaolaozhuang-scene-v3`，启动隔离 PostgreSQL、真实 HTTP/Socket.IO、Vue 和两个独立 Chromium 身份。它检查持续按键、多键松开、短按与失焦停步、全场实体稳定、真实 Canvas 像素、固定取景、当前/全部地图、合法出口前往、目标入口、未知停步查询和刷新恢复，保存具名 JSON、PNG 和 WebM。自然 CI 调用同一入口；脚本存在、类型检查或构建通过均不等于浏览器已经运行通过，实际结果须绑定候选 SHA。

`node frontend/tests/static-release-browser.mjs` 保留 65 PNG 的实际 HTTP 摘要/解码、场景组失败回退、门图独立失败和重试、原授权动作检查。其前置位置/held/open 状态为明确受控 authority 条件，不代替真实导航、物权流程或艺术验收。

`node frontend/tests/runtime-assets-browser.mjs` 用干净候选的已构建 `dist` 启动本地预览，逐项通过 HTTP 获取并由 Chromium 解码清单全部 PNG，核对大小、摘要和尺寸。这检查资产交付，不代表完整剧情或全视觉验收。

## 保留的历史 SVG 探针

`gaolao-art-browser.mjs`、`gaolao-body-browser.mjs`、`gaolao-hud-browser.mjs`、`gaolao-hud-motion-browser.mjs`、`navigation-recovery-browser.mjs`、`spatial-reading-browser.mjs`、`object-visual-browser-check.mjs`、`object-visual-resources.mjs`、`scene-layer-browser-check.mjs`、`scene-layer-metadata-browser.mjs`、`scene-layer-resources.mjs` 仍保留旧 SVG/逐实体 DOM 或旧动态 HUD 的断言，适用于各自历史冻结候选，尚未迁为当前 Canvas 入口。它们未被新自然 CI 当作当前结果运行，也不能把旧截图/录像或 PASS 移作当前 Canvas 的证据。

上述探针的角色脚点、原生/镜像 alpha、层级及美术专项迁移归 #66 的 ANIM 后续集验。当前主线使用前述 scene-v3、静态资源、多人实际交互入口；原探针与失败记录保留，未删除断言制造通过。自动浏览器、真人趣味/复玩、手机真机、真实模型和连续艺术验收分别取证。
