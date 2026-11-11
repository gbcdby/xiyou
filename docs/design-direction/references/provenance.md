# 素材来源与证据范围

## 当前可核验的范围

`guidelines/` 与色板保存的是继承的美术规范和设计提案。以 xiyou GitHub 基线提交 `17bcb222a9d84e0abd7463af06cae19081c8d12e` 的实际文件树核对，仓库没有 `references/images/`、`references/boards/` 或 `references/articles/` 中的素材；原图、总览和文章配图的当前入库数量均为 **0**。

基线中的 `catalog.md`、`manifest.json` 和 `media-links.md` 均为空，不能据此确认任何图的文件名、哈希、来源 URL、授权或逐图审阅结果。当前 [manifest](manifest.json) 只记录实际已入库素材，因此 `references` 为空；它不是历史 72 张图的替代记录。

## 继承记录及其限制

旧数量与编号来自[基线美术方向文档](https://github.com/gbcdby/xiyou/blob/17bcb222a9d84e0abd7463af06cae19081c8d12e/docs/design-direction/art-direction.md)，不来自本次素材审阅：

| 历史记录 | xiyou 当前状态 | 使用边界 |
|---|---|---|
| 72 张原图，R01—R72 | 原图与逐图索引未迁入 | 保留编号线索，不补造每张图的描述、哈希或采纳状态 |
| 6 张浏览总览 | 未迁入 | 不能声称已有可浏览总览 |
| ART01 文章与 7 张配图 | 原文、配图及原始链接未迁入 | 保留辅助方法线索，不能核对原文或视为当前证据 |
| 2026-10-23 的迁移、检查与 PR #51 叙述 | 缺少对应仓库、PR 链接及检查产物 | 仅属来源材料中的历史叙述，不是 xiyou 的 PR 或验收结论 |

`project.json` 中现状计数为 0，历史数量单独保留在 `historical_reference_inventory`，并指向上述基线来源。R01—R72 为历史预留编号；manifest 的 `next_reference_number` 从 73 起，避免新增素材与旧文档中的编号碰撞。恢复历史材料时需先核对原编号与来源，再登记实际文件。

## 后续补齐

使用 [`worker-visual-design`](../../../.agents/skills/worker-visual-design/SKILL.md)，在有效入库授权范围内取得实际素材后，补齐来源、文件、哈希与真实审阅状态。没有可靠来源的材料保持待核验；不得为了凑齐旧数量而下载近似图或生成替代图。

项目来源和用户审阅与“官方艺术风格认证”无关。原图中若含水印、作者标识或已有角色设计，应仅作为私有参考，不去除署名后宣称为自创素材。参考收录、风格采纳、成图检查、设备运行与真人体验各自记录，不能相互替代。
