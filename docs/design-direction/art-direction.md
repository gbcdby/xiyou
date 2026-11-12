# 国风水墨淡彩 · 项目美术方向

本资料包只保存**整体风味、美术语言与跨资产原则**，不承担任何游戏页面的功能合同、组件坐标、商业数值或业务交互规格。用来指导游戏视觉 UI、人物、场景、图标、动态和后续出图时的“共同感觉”。

## 当前主线

**清逸仙境 · 工写相生**：明亮而有色彩的国风水墨淡彩。精工刻画少数人物与材质焦点，山水云气保留写意流动与留白；在自然的安宁中保留清冷、俊逸、幻想尺度与细腻华彩。整体偏利落、有骨力，但**不靠夜景或暗底制造酷感**，也不把温柔理解成粉雾与繁花堆叠。

[整体总纲](guidelines/overview.md) · [视觉语法](guidelines/visual-language.md) · [色光与材质](guidelines/color-and-light.md) · [人物](guidelines/characters.md) · [环境](guidelines/environments.md) · [UI/UX 共性](guidelines/ui-and-ux.md) · [动效倾向](guidelines/motion.md) · [一致性](guidelines/consistency.md) · [出图简报](guidelines/art-brief.md)

## 规则与证据状态

本项目继承了**配色职责、明度／彩度／邻接／材质配合、UI 自然融合与可读性、可复现实验和证据边界**等规范。现存色板包含 10 对可计算的设计提案色值；旧资料中的完整性检查、色值检查和素材迁移叙述属于历史背景，不能替代 xiyou 当前版本的检查记录。

原始参考图、总览图及 ART01 原文与配图仍未迁入；这些历史审阅不能写成本轮已完成。2026-11-12新增的 [高老庄视觉基准](gaolaozhuang-v1/README.md)保存本项目的设计规范、隔离样页和采用范围，图像交付与对外恢复边界见该目录说明；正式页面合同见 [GZ-VIS-01](../specs/gaolaozhuang-visual.md)。设计图与样页渲染不代表正式游戏、真机或玩家 UX 验证。

通用设计方法见仓库技能包的 [游戏案例库](../../.agents/skills/worker-visual-design/references/game-case-library.md)、[UI/UX 模式](../../.agents/skills/worker-visual-design/references/game-ui-ux-patterns.md)与[决策手册](../../.agents/skills/worker-visual-design/references/ui-ux-decision-playbook.md)。本项目仅保留[跨游戏视觉迁移摘要](references/research/design-transfer.md)，不把其他游戏的具体页面规则与商业机制搬进本目录。

## 来源与更新

- [参考目录](references/catalog.md)：旧资料记载 **72 张原始风格参考**，编号 R01—R72，以及 **6 张总览**；当前均未迁入 xiyou，不能直接打开或据此复核画面。
- **教程补充 ART01**：旧资料记载一篇古风视觉语法文章与 **7 张配图**，用于辅助方法参考；当前原文与配图均缺失，详见[来源说明](references/provenance.md)。其中历史配色分类不作为项目固定色板。
- [来源说明](references/provenance.md) · [媒体链接](references/media-links.md)：记载材料来源及实际覆盖边界。
- [可选色彩关系](tokens/palette-directions.json)：仅供比较，不是从原图精确采样，也不是最终锁定色值。

新增参考需先明确长期入库范围；沿用已有有效授权，将实际素材放进 `references/inbox/`，使用 [`worker-visual-design`](../../.agents/skills/worker-visual-design/SKILL.md) 进行登记、审阅与规则更新。恢复历史资料时先核对编号与来源，不凭旧数量补造文件、哈希或审阅结论。**放文件本身不会后台自动学习或更新。** 现行方向更新时同步修订总纲、分项原则与创作简报；用户不采纳的画法不再出现于当前方向或正向提示词。

## 清楚的边界

图片和来源记录可以包含各种历史素材与视觉分支，但**收录来源不代表采纳该画风**。本包不承担按钮排列、UI 模块数量、系统状态、用户资产或技术实现参数。生成图只有明确采纳的范围才作为风格依据；未采纳的候选保留在来源记录中，不与现行方向混淆。

## 资料入口

本项目的美术方向与视觉规范统一存于 `docs/design-direction/`，入口为[设计索引](README.md)。旧资料中关于其他目录迁移、PR #51 与图片原字节保留的叙述，没有可核验的 xiyou 对应记录；其来源限制记录在[来源说明](references/provenance.md)，不作为本项目的交付证据。
