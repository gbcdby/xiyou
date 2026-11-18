# 对象栅格严格像素检查

此入口仅覆盖 #66 已采纳对象栅格方案的 C-R1～C-R4。它不连接 PostgreSQL、Socket 或游戏动作端，不是性能测量、连续移动验收或艺术验收。生产实现、夹具和输入冻结后，须先完成独立审查，再由总控安排单次浏览器窗口。

## 固定输入

- `fixtures/object-raster/matrix.json` 固定三组 CSS/DPR 几何、七个现有 map 变体、原 PNG 身份和原内容坐标、miss/hit 共42对，另加门左边缘与信件右下边缘两对 clip。
- G1 使用各自实际场景的原 base/floor 和原底色；G2 使用固定32 CSS像素明暗棋盘；G3 保持透明底色。每次比较都创建并清底重画真实画布，hit复用同一缓存但不复用上一帧输出。
- `fixtures/object-raster/spatial-canvas-baseline.txt` 是 b462 候选中的原 `spatial-canvas.ts` 完整字节，SHA256 `33375d29a575daf3bada523afb8282d36df35f79e59d88dd7114ce56742a91fd`。Vite仅将它放在原 rendering 相对目录作为受控虚拟模块，依赖仍是未修改的原模块；基线不经过新helper。
- 完整 renderer 两个位置覆盖角色在物件前/后、原前景 `.35/1`、门开关与选择，比较全RGBA、完整frame、原命中及每帧唯一前台写。使用现有公开DTO夹具的受控场景，不冒称服务器权限或自然运行证据。
- 有限生命周期检查包含scope、backing、同backing小数CSS、DPR、clear/dispose、同URL新image、原CanvasAssets受控onerror及真实retry新image、容量上限和设施回退。受控onerror不是网络故障实测。
- helper第四参数直接使用同一次目标surface实际执行的dpr、fit和物件position，按原setTransform(dpr)→translate(fit)→scale(fit.scale)→translate(position)序列提供原值，不从最终DOMMatrix反推。单位比例的容量/回退受控例同样先执行四步再传值，原位置与几何保持。
- 观测只在同步绘制期间转发原生Canvas方法和canvas创建，按真实的“HTMLImage→scratch→retained tile→原目标”关系识别用途，不读helper私有状态。42对与两组clip仍强制实际使用cache，miss只提交一次原图，hit重新合成tile且不分配canvas、不对scratch做draw/clear/setTransform/translate/scale；报告记录实际scratch变换调用及参数。
- scratch独立限制为1张、4,194,304像素，同backing连续miss复用；retained tile仍分别限制32项、总1,048,576像素、单项262,144像素。生命周期逐项检查两类旧backing均归零，容量报告分别列出两类。另有2049×2048的通用backing超限受控例，检查回退与旧资源释放，不替代原合法矩阵。

## 执行

在固定组合候选的仓库根目录，先只保存输入清单，不启动浏览器：

```sh
node frontend/tests/object-raster-browser-check.mjs --freeze-only --output .agent-output/object-raster-pixels/run-01
```

独审该候选与 `input-manifest.json` 后，在同一候选上执行一次：

```sh
node frontend/tests/object-raster-browser-check.mjs --manifest .agent-output/object-raster-pixels/run-01/input-manifest.json --output .agent-output/object-raster-pixels/run-01
```

使用已安装的项目 Playwright 和其 Chromium；本机已有明确的 Chromium 路径时沿用 `CHROMIUM_PATH`、`CHROMIUM_ARGS`。本入口所有自身Git调用均禁lazy/transport。输出已有manifest或result时拒绝覆盖；源码、fixture、资产和Git状态在冻结与运行首尾必须一致。运行使用一个本地Vite和一个Chromium上下文，结束逐项记录关闭结果。

现有CI `browser_direction` 在安装锁定Chromium后、原 normal→late→five 之前，用专属 `.agent-output/ci/browser-object-raster` 先freeze-only再单次运行同一manifest，步骤上限2分钟，默认success依赖，不重试。CI只归档本检查的 `input-manifest.json`、`result.json`、`stdout.log` 和 `difference-*.png`；不归档Vite缓存或数据库目录。工作流文件也计入冻结源码身份。

任意RGBA字节差异即失败。失败报告保留全部固定比较的差异计数、首12处像素与完整RGBA SHA；前三个差异另保存两边PNG。不自动重跑，不放宽阈值或改变 PNG、bounds、DPR、smoothing、alpha。缓存命中次数仅是调用证据，不换算为CPU提升。像素通过后仍需原 normal→late→five 和对应候选的其他门槛。
