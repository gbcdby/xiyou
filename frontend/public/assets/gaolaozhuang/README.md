# 高老庄运行图像

本目录为 Vue 渲染器的必要运行素材，47 张已采用 PNG 与源码一起版本固定。目录内仅逐文件放行下表中的 45 张高才帧和 2 张场景，其他图像继续忽略。素材采用源固定为提交 `4b39f6db92c0e7411fa25378239523baf9d2c224`；仅复用原图字节，不包含人物概念图、源归档或私人资源入口。候选的外部发布仍由项目交付负责人按具体文件处理。

| 路径 | 来源与用途 | 边界 |
| --- | --- | --- |
| `scenes/courtyard.png` | `original_team`；[#25](https://github.com/gbcdby/xiyou/issues/25) 已接受庭院，原字节复用 | 1586×992 映射到 1600×1000；没有删改前景或墙面 |
| `scenes/village-road.png` | `original_team`；[#28](https://github.com/gbcdby/xiyou/issues/28) 已采用庄外概念 | 仅场景输入，不能据此判定正式后间、围护与碰撞校准完成 |
| `gaocai/idle/`、`gaocai/walk/` | `original_team`；#25 已接受的 5 原生方向、3 镜像方向，5 站姿 + 40 行走帧 | 原字节、逐帧脚底和最终缩放保持；E/NE 既有艺术观察不重开为用户确认 |

高才的安全运行 manifest 在 `frontend/src/assets/gaocai-manifest.json`，只包含实际消费的帧、脚底、最终缩放和公开采用依据。按原型的 147.6 地图单位完整循环推进步态；停步与减少动态模式用对应方向站姿。缺图时保持中性可选角色，提供“重新载入图像”，不会因为美术资源失败停止房间或猜测隐藏身份。

完整运行字节清单在 [runtime-assets.json](../../../runtime-assets.json)，逐项固定路径、大小、尺寸与 SHA-256。`npm run build --prefix frontend` 在类型检查和打包前读取全部必要 PNG；缺文件、摘要变化或清单与逐帧 manifest 不一致会明确失败。Vite 将它们原样复制到 `dist/assets/gaolaozhuang/`，正常 Git checkout 不需要从旧工作目录补图。

其余公开造型目前没有正式动画输入，统一使用中性回退；五人概念图没有装成正式动画。完整生产缺口仍按 [GZ-VIS-01 第6节](../../../../docs/specs/gaolaozhuang-visual.md#6-必要资产与动效边界)执行，包括其余 NPC/真人造型与动作、门/门撑/道具、室内、前景遮挡分层。运行来源可读和源码可构建不等于这些资产已经完成。
