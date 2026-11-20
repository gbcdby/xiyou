# 完整背景捕获的严格像素回归

此入口对应 #66 的原 buffer 完整背景捕获。它把已固定的四组几何、两个原状态移植为持久回归门，共 **8 对完整 RGBA 比较、16 次生产 renderer 调用**。本入口只检查像素与调用资格，不作性能计量、自然连续输入或艺术验收。

## 固定对照与输入

`fixtures/background-raster/spatial-canvas-baseline.txt` 是候选 `cde021da365777d9870e8e6df3d72fb8b9090ef6` 的原 SpatialCanvas 全部字节，SHA-256 `4500b595c27b6a99300471e5cbc2caaf3b708d3f9bdf0612655b720f0c324204`。它已经包含原 ObjectRasterCache，没有新背景 helper。Vite 将该原文本作为 rendering 目录下的受控虚拟模块加载，保留原相对 import；另一侧调用实际生产 SpatialCanvas。

`matrix.json` 保存原63张PNG的路径、尺寸、字节数与SHA、原物件路径、两状态、零差异门槛和采纳设计身份。资产、目录、bounds、DPR、alpha、smoothing 均不调整。

| 几何 | CSS 尺寸 | DPR | first / repeat 的实际路径要求 |
|---|---:|---:|---|
| G1 | 1226 × 684 | 1 | 捕获 miss / 真实 hit |
| G2 | 980.5 × 612.25 | 1.25 | 原路径 fallback / fallback |
| G3 | 799.5 × 600.25 | 2 | 原路径 fallback / fallback |
| G4 | 980.25 × 612.15 | 1.25 | 捕获 miss / 真实 hit |

四组都绘制原完整 renderer 的 paper/base。G2/G3 检查原 paper 不覆盖完整 backing 时的真实回退；此完整 renderer 阶段没有额外棋盘或透明底色注入。每组使用独立新上下文；组内 repeat 保留 first 的原前台与 backing，切换原人物位置、门状态与选择。受控公开 DTO 沿用 scene-v2 courtyard、原 gaocai 外观；正式 scene-v3 自然游戏入口由后续原 normal→late→five 覆盖。

按实际 drawImage 源和目标识别“原 base→buffer”“buffer→背景缓存”“背景缓存→buffer”，不读取 helper 私有状态。miss 保留原 paper/base，随后捕获；hit 必须恢复旧缓存且不对背景缓存操作或分配，恢复在原 scene clip 之前。Image→背景缓存恒为0，G2/G3不得把回退计为缓存命中。

同时逐对比较完整 frame metadata、sceneImages、原 alpha hit、每帧唯一 front copy 与 beforeFrontWrite 前旧 frame；分别核背景1张/4,194,304像素、对象scratch1张/4,194,304像素、retained tile32张/总1,048,576/单张262,144像素，以及组末派生资源全部释放。两状态的完整RGBA必须逐字节相等，阈值为0。

## 冻结与单次执行

在干净组合候选的仓库根目录先冻结；此操作不启动浏览器：

```sh
node frontend/tests/background-raster-browser-check.mjs --freeze-only --output .agent-output/background-raster-pixels/run-01
```

独审相同候选与 manifest 后，由总控分配窗口执行一次：

```sh
node frontend/tests/background-raster-browser-check.mjs --manifest .agent-output/background-raster-pixels/run-01/input-manifest.json --output .agent-output/background-raster-pixels/run-01
```

使用已锁定 Vite/Playwright，沿用可选 `CHROMIUM_PATH`、`CHROMIUM_ARGS`。所有自身 Git 明确禁用 lazy fetch 与 transport。manifest、一次 marker、结果均排他写入，拒绝覆盖与自动重试；首尾核源码、目录和63张原PNG。独立 Vite cache 只在本次证据目录内。

一个页面执行原63 PNG预载及8对比较，主体65秒、资源ready20秒上限；启动及关闭各阶段有明确等待上限，CI外层2分钟。未到达行、原异常、页面/console/request错误、清理失败或源码漂移均保留并失败。favicon由本地Vite提供同源小SVG，`img-src 'self'` 下不使用 data: favicon；不忽略或过滤CSP错误。

遇第一对RGBA差异，保存两张完整实际PNG、两侧完整RGBA SHA、差异字节/像素数、最大差及前12处坐标，随后停止；后续行明确 NOT_REACHED。JSON最大1MiB，超限明确FAIL。输出不包括视频、数据库或新素材。

## CI 与证据边界

现有 `browser_direction` 在安装锁定 Chromium 并运行旧对象栅格步骤之后，单独执行本入口 freeze→同manifest运行，专属 `.agent-output/ci/browser-background-raster`，默认success依赖、无重试。只归档具名 `input-manifest.json`、`result.json`、`stdout.log`、`difference-*.png`。

原 object-raster 的独立基线、42对+2clip及62行要求保持；原 presentation/rpc 回归以及 normal→late→five 的输入、断言与顺序保持。隔离实验的54次计量不进入本门槛；历史隔离运行的整体FAIL原件保持。本检查通过只证明本次固定像素和路径资格，不代表性能收益或自然输入验收通过。
