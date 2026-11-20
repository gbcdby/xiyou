# NSO方法候选v2：当前normal供给边界的独立有界观察方法

## 状态与上位决定

本目录是方法候选，不是release。准备时Node、有限反例、安装、PG、Chromium、监督器和CI均 **NOT_RUN**；三个预算均为提议、尚未分配。两个`*-release-template.json`的state固定为`NOT_RELEASED`，入口拒绝它们。完整v1两轴FAIL及全部原件保留；v2只修正三项已证发现：准确基线更新事件门、不同source的两份独占空npm配置、原F20的外侧publisher/N1顺序判据。32项与预算提议不变。总控沿已有授权在准确方法双轴独审后另行释放有限场；只有有限真实原件经非作者核验，才可以创建实际normal释放数据并发布独立分支。

依据是#66已采纳的NSO设计、C1/C2及采纳评论7034316344。产品固定为`16099e191fdc80c52849aa1d67cd075ccca4e01e`，tree`31f82d6478e2ced1d27875c75160eef626ffe0bf`。`product-manifest.json`列出该树2041个原路径的Git blob、mode、bytes、SHA256；所有原产品文件、原normal harness和两份既有workflow保持逐字不变。新文件仅在本目录和`.github/workflows/normal-supply-observation.yml`。

旧自然Auto44694210554 attempt1 normal的no-idle **FAIL**、late/five未运行、旧MI环境EPERM/缺raw/已消费预算等保持原事实。当前方法只为缩小入口前未知，不修正缓存、缓冲、idle、hold、速度、完整历史或transport credit语义。即使诊断有效，也不补写旧场证据、不授予PR68自然资格，不新增“必须改生产源码”或“必须证明唯一历史根因”的合并条件。

## 唯一观察范围及含义

| 接点 | 新数据及可解释范围 | 不据此推导 |
| --- | --- | --- |
| N1：既有runtime的普通`commit` listener | 同runtime通知到本listener的Node单调时刻、session与首尾seq、数量 | SQL COMMIT瞬间、所有afterCommit耗时或生成瞬间；原runtime先完成其他afterCommit工作，原listener顺序保持 |
| N2：原`enqueueSocketPacket`同步调用 | 原完整参数引用的弱身份、公开范围、原proof/null/异常身份、进入/原调用/返回/退出时刻 | proof已被consume、sent已经推进、wire已经发出、对端已经收到；不消费proof、不调用send/current、不监听packetCreate |
| Page MI03 | 同realm Manager.ondecoded、Socket.onpacket、SpatialView.applyBatch的packet/payload/metadata身份与公开范围 | DOM/set/emit、私有槽、跨微任务同步parent、跨Node/Page单向时延 |
| 原normal原件 | 原source/update/paint、原断言、原cleanup与sourceEnd全部原样 | 不把异时latest snapshot与旧paint强配，也不因报告原文“自然CI”而授予外层自然资格 |

冷分析只能按session/view/公开范围及同realm真实对象身份关联。相同范围的重复批次保留为不同对象，不能按出现序号强配ACK。Node和Page两套`performance.now`不相减；各自的真实先后和局部间隔可以独立解释。此新增观察可能改变时序，因此新场不回填历史gap的唯一原因。私有生成/排队和跨端wire仍可能无法区分；证据不足时继续INCONCLUSIVE，不以推测填空。

## 共用实现与委托

`collector.mjs`在Node/Page共用；热wrapper保留原this、全部args（含applyBatch第三metadata）、原Promise/返回对象和原异常对象，原调用恰一次。不新增await、then、parse、clone、timer或微任务。固定own-data descriptor读取不执行普通getter；任意Proxy反射可能有副作用，这不是零扰动保证。采样失败、字段/行/身份/字节上限关闭admission并保留前缀；旧bound wrapper停采后的首分支纯委托，不再读时钟或反射。

只有`loader-hooks.mjs`两个准确模块可以被冷变换：原enqueue导出和原browserRoom导出。变换是已固定suffix，原源码SHA、唯一export marker、变换后SHA、URL与一次性状态都被核对；非目标load结果对象原样返回。原产品磁盘字节不改。注册的同步load hook在两模块加载后解除，临时全局桥按完整descriptor身份移除。

原browserRoom冷入口先激活Node观察；owner第一页beforeSession中持有本次Page API的JSHandle，在原presentation之前安装三点，再调用原hook一次。close/reload允许明确增加冷收取await及Promise差量，不能称为冷调用耗时/Promise身份不变。原hook/close/reload的原异常仍保留；部分安装失败也继续原hook并恢复已登记项。只覆盖首文档，原reload开始时封口；不偷偷在后继页面重装或延长采集。

`cold-hooks.mjs`采用components-v2错误失效锁存。v1的R-NSO-COMP-REQ-001 / S-001及两份FAIL原件保留；任一冷error令valid=false，后续collect和exit不能复活资格。两个非作者v2报告只关闭静态组件缺陷，不是本方法/执行通过。有限F26/F27在待测catch之外断言collect=false、status invalid、错误保留及原委托。

真实JSON writer先计算文本身份，再独占`.part`完整写出、原子link最终名、移除part；不覆盖原件。若最终名已写而临时清理失败，既存文本不被偷偷修改，外层严格要求诊断目录恰好只有预定三个完整文件；任何part/额外文件都失去方法资格。因此不能凭一个早先写出的`valid:true`掩盖实际冷写错误。

## 固定schema与容量

`schema.json/.mjs`和`envelope-schema.json/.mjs`分别同值。每realm最多16384行、128receiver、16384object ID；对象只保留有界WeakMap整数身份，不复制业务图。单串最多128 UTF16 code units，模块URL最多1024，固定最多两个module/cold-import，最多32个64字符错误码。所有原行位置包括后填时间/返回/异常槽都在入账前预扣，溢出不滚动覆盖、不退款、不增容。

每个raw界16MiB。完整固定头尾含LF保守31203 B，预留65536 B；cold完整封套含LF保守13063 B，界32768 B。非作者按最少逗号独立算得31191/13058 B，作者多留12/5 B安全余量，完整字段列表和算式见capacity-proof。冷序列化再核实际bytes<=reserved<=16MiB。这些是JSON证据容量界，**不是heap/RSS上限、零额外开销或性能保证**。

## 唯一有限场：32个共享实现反例

有限场使用真实新collector/probe/cold/loader实现；Page对象和冷Handle是明确受控夹具，F16–F19调用原真实enqueue/consume模块，协议canonicalize仍来自原产品。不安装依赖、不启动PG/Socket.IO网络/Vite/浏览器，不重跑旧MI23、旧监督三例或其他产品回归。

| 用例 | 覆盖 |
| --- | --- |
| F01–F07 | Page this/全args/metadata/返回及Promise、原异常与getter、真实微任务对象关系、重复范围和各result、反射失败 |
| F08–F14 | 行/字节/identity上限、部分安装、bound停采纯委托、外部descriptor冲突、活动调用内stop |
| F15–F22 | Node全args/this/proof、原真实push/ACK单次consume、原send失败/资格拒绝、反射异常、commit原listener身份及实际publisher→N1→later顺序、Node停采 |
| F23–F24 | 固定头尾/cold最坏可转义字符串的外侧真实JSON字节oracle，长行预扣 |
| F25–F30 | 原共用冷入口、原hook/close/reload/异常/partial restore、同一collection Promise、v1冷写缺陷外侧反例 |
| F31–F32 | 与真实preload同一loader工厂，准确原源码和suffix、非目标对象保留、错源/重复/格式/重复export/未绑定变换拒绝 |

入口固定为`node --test-reporter=tap frontend/tests/normal-supply-observation/finite-check.mjs`（实际命令使用已核绝对物理Node路径）。Node v24默认reporter已为spec，因此这里显式选TAP，保留原生32项计数与原输出，而非把自建JSON总数伪称原生结果。官方版本文档：[Node v24.22.3 test reporters](https://nodejs.org/docs/v24.22.3/api/test.html#test-reporters)。方法同时要求原Node exit0、32个固定ID外侧PASS、原生tests/pass32且fail/skip/cancel/todo均0、真实监督合格与来源不变。

有限提议10+TERM2+KILL1秒，attempt1/retries0。只读冻结/前后全文件核各有120秒截止，日志总封口20秒，均不运行产品；不能把这些冷核时间写成Node执行时间。入口独占创建`source`父目录下`runs/finite`即消费本次有限attempt，之后预检失败也不退款。每次候选修订需保留旧输入/失败并由总控单独决定，不复用旧输出。

## 监督与冷收取

`owned_processes.py`是原22190 B / SHA256 `9aa8daf4a171a65c2d18acb2391d599f426842431108622f82c379c79a7eda07`同字节供应件。runner核实际bytes后直接`compile`进独立module；不使用普通import/get_code，不读旧或本目录pyc。未重跑旧三例；旧已核行为只作为供应件承接，当前宿主能力仍由其启动前真实Linux/pidfd/subreaper预检决定。

每场保存原监督report，包括PID/starttime/PPid归属、独立PGID、真实wait status、root回收、ECHILD、signals、observedExitSignals、errors、残留和组清理。没有全局pkill/按命令grep，也没有增加exe监视器。任意信号、负退出、超时、错误、残留使监督资格失败，不把cleanup成功等于产品PASS。

只有本场helper返回并确认rootReaped/directChildrenECHILD/descendantsGone/ownedGroupsGone，才能读取/hash本场活体输出。异常导致清理未知时，保留路径/size与NOT_COLLECTED_CLEANUP_UNCONFIRMED，不扫描产品输出、不hash未封口stdout/stderr。workflow也仅上传runner自己封口的状态JSON，不遍历可能仍写入的输出。尚未launch时可保存静态状态；预检拒绝的既有产品目录绝不收取成新证据。

## CI宿主与安装后输入冻结

独立分支`diagnostic/d66-normal-supply-16099-v1`不创建PR。沿已采纳两步路线：先以16099建立基线分支，再以expected_sha=16099、force=false更新到准确方法候选。新workflow只监听该分支push，runner要求created=false、deleted=false、forced=false、before=PRODUCT_HEAD、after=GITHUB_SHA、attempt1和精确workflow_ref，并核实际HEAD等于GITHUB_SHA、唯一父16099、clean全树恰好是2041原产品路径加本方法闭集及一个实际release数据文件。firstMethodPushOnly指这一首个具名方法更新，不指分支创建事件。原Auto/Cuilan的main push/PR规则未改；不dispatch/rerun。该方法更新能否真实启动以及workflow写权限仍须实际发布/readback确认；Git对象能力存在不等于权限已实测。权限拒绝即停，不空试探/绕过。

CI固定ubuntu-24.04、Node24.22.3、Python3.12.16与现有准确action SHA。本地有限固定同字节Node24.22.3/Python3.12.14，区别明确记录。Node用实际physical path/bytes/SHA绑定；CI另外核随精确Node安装的version header，进入Node后再核process.version。Python核真实版本/物理binary及实际prefix/lib内同名shared library文件；这是文件来源身份，不是OS loaded-library观察。准备曾发现搬迁环境的编译期LIBDIR仍为不存在的/install/lib，原未运行稿和只读失败保留，改用真实sys.base_prefix/lib，不执行探针来补证。记录ImageOS/ImageVersion/kernel；不声称冻结整个OS或所有系统动态库。

准备只执行三条固定命令：根lock的npm ci、frontend lock的npm ci、锁内Playwright CLI `install --with-deps chromium`。不使用浮动npx下载。npm使用本次独占cache；user/global config分别是本场独占目录npm-config下的user.npmrc与global.npmrc，以不同固定路径各自xb创建0 B空文件，准备输入绑定路径/bytes/SHA/mode，driver核实际空字节和env来源。准备成功且已证clean后再核两件身份未变，并保存回执和两份原件。此修正避免所读npm配置源码对同source二次加载的拒绝，不声称未来CI已运行。关闭audit/fund的额外请求；原lock和安装生命周期保持。原setup-python的pythonLocation与其精确runtime/lib可作为Python父库来源；拒绝LD_PRELOAD/其他库搜索路径。Node安装子环境和产品子环境均显式新建，不继承父NODE_PATH/NODE_OPTIONS或其他注入值；父相关变量只保存存在性/长度/摘要，不打印值、不改全局环境。

安装后、产品启动前冻结完整root与frontend node_modules、所有内部symlink（越出独立目录则拒绝）、完整专属Playwright cache、原源/method/release、锁包元数据与实际native文件。准确源选择为embedded-postgres18.6.0-beta.19的linux-x64包initdb/postgres/pg_ctl；Playwright1.57.0的headless-shell1200、143.0.7499.4、ffmpeg1011。完整安装依赖树前后复核；不只凭binary自报版本，亦不预造未来安装hash。

产品不设置CHROMIUM_PATH/CHROMIUM_ARGS，保留原`chromium.launch`的默认headless registry分支。固定PLAYWRIGHT_BROWSERS_PATH只指向本次独占cache；精确registry源码/选项/env与实际选中文件一起冻结。CLI exit0不等于host validation成功：选中headless目录必须已有空的、不到一小时的DEPENDENCIES_VALIDATED，以及安装完整标志，否则**启动前停止**。默认launch可以据该marker走其原验证缓存路径；不通过显式executablePath跳过这一分支。整cache（含marker）仍前后核，不排除整个cache掩盖变化。此为有依据的选择推导，不是OS独立观察exe。

原harness的Vite cache已在本场product输出内；PG原helper仍TCP-only/unix_socket_directories空，并沿原pool.end/真实连接end/server.stop/log drain清理。Node实际child env精确键集与值在input和Node入口再核；原runtime需要的动态端口、PG随机密码与用户输入继续由原harness产生，方法不替换它们。原PG输出目录启动前必须不存在，清理后原日志复制、集群文件只保存摘要元数据，不外传数据库/凭据文件。

## 三个独立消费点与外层余量

| 阶段 | 提议上限 | 消费点 / 停止 |
| --- | --- | --- |
| 有限 | Node10 + TERM2 + KILL1 | 独占finite输出目录后消费；任何后续guard失败也保留消费；没有setup或normal |
| CI准备 | 安装root720 + TERM10 + KILL2 | 经固定release/branch门后独占CI输出并写attempt即消费；安装/来源/清理失败停止，正常预算未开始，不把已花准备归零 |
| CI normal | 原normal120 + TERM10 + KILL2 | 准备成功、输入冻结、来源及剩余时间门全部满足后写独占normal-attempt；此后任何失败均消费，0重试 |

workflow job30分钟，checkout/setup-node/setup-python各2分钟；首步骤固定job起点，若前置action超过360秒，入口拒绝开始准备。方法执行step22分钟，内部从进程进入起最多1260秒且不得晚于job起点1680秒，保留至少120秒artifact上传。准备前来源/runtime共用60秒截止；准备后来源60秒；实际输入冻结最多120秒；normal132秒；之后来源60秒、产品原件收取60秒、全部日志封口共20秒。最大阶段额定加总1244秒，小于内部1260秒；入口另检查剩余余量，冻结前不足400秒或normal前不足280秒就停止且不claim normal。监督自己的TERM/KILL窗不扩展，不能等GitHub外层cancel才开始cleanup。

这些是正常可调度系统下的明确阶段截止；文件读取/内核调用不是实时系统保证。硬外层仍由CI step/job控制。不会为凑满阶段而sleep、额外采样、重试、拉长原normal或增设setup-only现场。

## 输入与release自引用处理

`method-manifest.json`固定方法/workflow全部文件、精确两次源码变换、预算/版本/历史引用。它只排除自己和将来唯一的`normal-release.json`；后者必须是固定闭集纯数据，不能携带任意命令、路径、参数、scenario或扩容。root创建实际release时绑定准确method摘要、两轴独审scope/摘要和有限真实原件/独审摘要。CI不能从这些摘要独立恢复外部报告，相关资格由总控真实回读后签入；CI核它们的准确数据形状和方法关联，不把声明冒充再次独审。

normal实际release文件在最终全Git树/allowlist、发布对象回读、动态input、source-before/after中单独SHA绑定。诊断commit/tree自身不能再写入这个文件造成循环；最终object由总控在推进ref前精确回读。只在完整候选create_tree/create_commit/回读成功后，以16099基线和expected_sha=16099、force=false更新该独立ref，拒绝则停该宿主。模板不是远端权限试探。

有限input先独占只读冻结，release随后绑定其SHA与实际index tree；input中的releaseSHA为null，避免循环。normal由固定release授权准确冻结规则，安装后input包含实际releaseSHA，release.inputSHA为null；完整实际input必须随原件交非作者核验。两条规则在Python与Node入口一致。

## 后继命令与原件

以下是将来经总控释放后的固定命令，当前没有运行：

```sh
python -I frontend/tests/normal-supply-observation/freeze-input.py
python -I frontend/tests/normal-supply-observation/run-bounded.py finite
# 仅新workflow内部，不能在本地替代真实CI宿主：
python -I frontend/tests/normal-supply-observation/run-bounded.py ci
```

只读freeze入口不加载监督器、不启动Node；已存在finite-input不覆盖。finite实际release放worktree父目录`finite-release.json`；CI实际release为本目录`normal-release.json`，当前不存在。总控对任何已冻结版本另留准确历史，再决定新scope/新attempt，不通过新目录或改名退还旧消费。

保存attempt、release/input身份、安装每步开始/实际exit、setup/normal完整stdout/stderr及原owned report、source-before/after、cold/两个raw、原normal全部JSON/日志/截图/录像及PG日志/元数据。新媒体与原ZIP在最终交接包按总控规则只保留元数据；CI原artifact仍供逐成员CRC/SHA核对。不要将临时artifact签名链接写进报告。

外层若观察有效但原normal断言失败，保留原Node exit1、原assessment FAIL；方法可以标OBSERVATION_VALID，naturalQualified永远false。原报告原有“自然CI”scope文案不改，仅作原件字段保留。当前方法没有获得执行、自然验收或合并资格。
