# 高老庄运行图像

本目录为 Vue 渲染器版本固定的必要运行素材，共 **65 张 PNG / 29,038,902 字节**。原 45 张高才帧与 2 张场景共 13,913,035 字节保持原样；新增 18 张静态素材共 15,125,867 字节。目录只逐文件放行这 65 项，其他 PNG 继续忽略。

新增集合为 `GZ-STATIC-PROPOSED-PUBLICATION-18-V2`：用户于 2026-11-14 明确批准其 18 PNG 公开到 `gbcdby/xiyou` 的 `frontend/public/assets/gaolaozhuang/static-v1/`。这项具体采用范围包含下表中的后宅、茶棚和五件物件，原字节及已确认参数直接复用；不包含参考图、制作源归档、技术板、私有诊断或其他待验图片。原 47 项的采用源仍为提交 `4b39f6db92c0e7411fa25378239523baf9d2c224`，完整 manifest 保留其既有条目与 `original_team` 来源字段。

| 路径 | 来源与用途 | 范围 |
| --- | --- | --- |
| `scenes/courtyard.png` | `original_team`；[#25](https://github.com/gbcdby/xiyou/issues/25) 已接受庭院，原字节保留 | 1586×992 映射到 1600×1000，供旧 scope 与原图身份核对 |
| `scenes/village-road.png` | `original_team`；[#28](https://github.com/gbcdby/xiyou/issues/28) 已采用庄外概念，原字节保留 | 同尺寸映射，供旧 scope 与原图身份核对 |
| `gaocai/idle/`、`gaocai/walk/` | `original_team`；#25 已接受的 5 原生方向、3 镜像方向，5 站姿 + 40 行走帧 | 原字节、逐帧脚底和最终缩放保持 |
| `static-v1/scenes/courtyard-rear-v3/` | 已采用后宅静态修复底层、4 片入口前景、replace-mask，共 6 PNG | 地面已合入底层；6 项均为原子就绪组的必要依赖 |
| `static-v1/objects/timber-door/` | 同画框的 closed/open 门扇，共 2 PNG | 仅按当前授权 Target 的唯一 boolean open 选图，缺失或未就绪时中性 |
| `static-v1/scenes/village-tea-r2/` | 已采用茶棚底层、floor、replace-mask、2 片入口前景，共 5 PNG | floor 与 replace-mask 必须加载；固定敞开叶片是静态结构，没有动态门 target |
| `static-v1/objects/` 的其余 5 PNG | 布包、书信、散绳、账册、钉耙 | 单一 PNG 可被 loose/icon 共用；无 fixed 替代图或额外所有权状态 |

[生产场景目录](../../../src/assets/gaolao-scene-layers.json)只启用 `gaolaozhuang-scene-v2 / gaolao-layout-v1.1` 的院落后宅组与庄外茶棚组。所有必要静态资源与元数据通过校验后才整组显示；任一静态依赖失败时使用既有几何降级，门图单独失败时使用中性门槽。未知、未登记或未启用的 scope 完整保留原显示。

[生产物件目录](../../../src/assets/gaolao-object-art.json)只登记 `timber-door`、`cloth-parcel`、`folded-letter`、`hemp-rope`、`ledger-book`、`farm-rake` 六个键。私物与门始终由当前授权 ref、状态及 scene scope 决定是否绘制；静态场景不创建实体。钉耙仅匹配庄外场景，包括该场景中的本人行囊图标；进入院落仍按既有 scope 回退。held 不在地面画，fixed 缺专用变体时保留占位。

账册采用 CAL-01：权威位置和走近点仍为 `(260,405)`，C15 外观点为 `(292,305)`，仅以 offset `(32,-100)` 对齐；1254×1254 PNG、pivot `(624,645)` 与倍率 `26/1126` 不变。门沿用权威根点 `(1250,425)` 与 offset `(0,-60)`，两态共用 pivot 和倍率。图片没有独立命中或读取权限，原标签、列表与交互点继续操作同一授权 ref。

高才的运行 manifest 在 `frontend/src/assets/gaocai-manifest.json`。按原型的 147.6 地图单位完整循环推进步态，停步与减少动态模式用对应方向站姿。缺图时保持中性可选角色与“重新载入图像”，不会因为美术资源失败停止房间或猜测隐藏身份。

完整字节合同在 [runtime-assets.json](../../../runtime-assets.json)，逐项固定路径、大小、尺寸与 SHA-256。`npm run build --prefix frontend` 在类型检查和打包前校验原 47 项基线、两个完整场景组、六个物件键去重后的 18 项增量及精确 allowlist；任何文件缺失、摘要或尺寸不符、依赖遗漏、额外条目均使构建失败。Vite 将这些 PNG 原样复制到 `dist/assets/gaolaozhuang/`，正常 Git checkout 无需私有 fixture 路由或旧工作目录补图。

本批不完成前院客房、其余 NPC/真人造型与动画、门撑/固定绳装配、全场树冠/低墙/花丛前景或真实 A1–A3 验收。采用范围与剩余义务见 [GZ-VIS-01](../../../../docs/specs/gaolaozhuang-visual.md) 和[室内分层合同](../../../../docs/design-direction/gaolaozhuang-v1/scene-layer-contract.md)。静态登记、作者自查、独立审查、实际运行、CI、合并和部署分别记录，不能从文件可读或构建成功推定整章通过。
