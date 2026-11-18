# S-A1 静止人物栅格严格像素入口

此入口只检查已选 S-A1 的静止非镜像人物采样兼容性，不测性能，不连接 PostgreSQL、Socket 或游戏动作端，不替代方向 normal→late→five、艺术验收或真人体验。生产 renderer、页面 fixture 和本 Node 入口分别制作、固定与审查；作者自查不是独立审查。

## 固定输入与阶段

- A 为 0ef 集成基线的原 renderer 完整字节，SHA 7a772e93e8922eea59aa64117d19e6c868aa91ecc05c1514f8b1d84c5cb0cb04，保留既有对象与背景缓存。B 为唯一 S-A1 renderer，SHA 80e0c31e05257a36b657b9d83f0fcc6fc921949d71a2ce05e0b9ef204179cb3d。最终候选 Git HEAD 由完整提交决定，不硬编码为旧 0ef。
- matrix 固定五张 gaocai native idle（S/SE/E/NE/N）、原 PNG/footPivot/scale、三组原 CSS/DPR/背景及 miss/hit 共30对。原图、bounds、相位、smoothing、alpha 均不调整，RGBA 字节差异阈值为0。54个原PNG身份全部冻结，不下载替代素材。
- 第一阶段每对实际比较完整RGBA并保存两边SHA、差异计数和首12处差异；必须观察到真实缓存链路。像素不同继续保存全部30对，不因此准入第二阶段。环境/断言异常保留实际已完成行，其余由页面标 NOT_RUN，不能算完整30对。
- 全部30对通过后才进入固定23对 renderer 检查：真实 gaocai、原 CanvasAssets/ConfirmedMotion/PresentationOwner、clip、层次/脚底阴影/前景/选择与文字、alpha hit、moving与三镜像原路、资源代、scope/尺寸、共享LRU和失败回退。成功恰46次 renderer paint，硬上限64；后段首败即停止新行，保留已完成原件及剩余 NOT_RUN。
- helper和原caps不变。命中也必须向本帧buffer合成，保留完整frame、递增serial、原beforeFrontWrite和唯一front copy。既有七物件像素资格不能充当新人物资格，旧alpha/frontcopy STOP不被重开。

## 先冻结，后单次执行

须由总控先提交完整七文件候选（生产一文件及检查六文件），保持clean。仅冻结清单时不导入Vite、Playwright或产品模块，也不启动浏览器：

~~~sh
node frontend/tests/stationary-actor-raster-browser-check.mjs --freeze-only --output .agent-output/stationary-actor-raster-pixels/run-01
~~~

该命令保存input-manifest.json：实际HEAD/tree/status、代码/fixture/lockfile SHA、54个PNG bytes/SHA、完整matrix、A内容SHA、Node版本及明确的Chromium路径/参数。freeze-only本身不是像素执行；读取清单和独立审查之后，总控另行释放唯一执行：

~~~sh
node frontend/tests/stationary-actor-raster-browser-check.mjs --manifest .agent-output/stationary-actor-raster-pixels/run-01/input-manifest.json --output .agent-output/stationary-actor-raster-pixels/run-01
~~~

只使用已安装的项目Vite/Playwright和既有Chromium；可沿用CHROMIUM_PATH、JSON数组CHROMIUM_ARGS，但执行必须与冻结值相同。使用一个本地Vite、一个浏览器、一个context、一个page，viewport固定2600×1100、DPR1、no-preference，A/B原画布真实连接到可见页面。虚拟A保留原相对import；禁止冷扫描器把其虚拟路径当实际文件。PNG白名单和同源CSP保留，页面/console/请求错误都判失败。

所有Git调用显式禁lazy-fetch和transport。input-manifest独占写入；run-started.json使用wx排他创建，既有run marker/result/差异PNG一律拒绝覆盖或重跑。入口没有重试、依赖下载、自动更换输入或运行失败后的补跑。

外层独立监督器由总控安排120秒，TERM后10秒、KILL/reap2秒、0retry。页面主体上限90秒，素材ready上限20秒；Node除保留原启动/收集/关闭有限超时，还核页面原performance finishedAt−startedAt实际不超过90000ms。外层时间到即按监督器停止，内层上限不会延长外层预算。此脚本自己不发起第二个执行。

## 结果、保全和清理

result.json顶层包含assessment、实际UTC startedAt/finishedAt、manifest SHA、source/sourceEnd、Node/browser身份、pixelPairs、rendererPaintCalls、原生错误和cleanup。完整页面evidence原对象放在fixture：原pixelRows/rendererRows/postRows、stage1/stage2、notReached、errors、resources和页面自身cleanup都保留，performance时钟不伪装为UTC。页面按预先固定格式保留关键链路计数和frame，不要求序列化临时DOM或所有原生调用对象。

顶层cleanup独立记录page、context、browser、vite，状态为closed、not_started或failed；PASS要求四者closed、页面原backing全部释放且来源首尾一致。页面run仅调用一次，超时后cancel关闭新行准入，有限等待原Promise收束再读取原证据；仍未收束不能PASS。

Node再次核固定30个唯一顺序ID、全部完整RGBA比较、实际cache=true，23个renderer顺序ID/46次调用、完整frame SHA与A/B比较见证、实际owner边界、两个postRow、零错误/零notReached、全部原PNG请求、原件身份和清理。原FAIL不会被收集成功覆盖。首个像素差异最多保存一对原canvas.toDataURL PNG，不重绘或换图；记录文件bytes/SHA。

结果用compact JSON。1MiB是资格上限：超过时标FAIL，但仍保存完整result.json，绝不以摘要替换已采30对/后段原件。result-meta.json记录实际完整bytes/SHA及是否超限；外层可拒绝解析超限结果，但必须保留文件。所有输出wx独占保存。可能因硬超时来不及形成完整结果时，唯一run marker及外层stdout/stderr/执行记录仍保留，不能称已完成验证。

任何合法输入RGBA差异或边界失败均停止本候选，不调整素材、alpha、helper、caps或阈值。通过只表示本固定采样/集成矩阵兼容；实际收益和自然方向资格仍须对应新候选的另外证据。
