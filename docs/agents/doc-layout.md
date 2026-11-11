# 文档布局

本项目的文档放置约定。技能（triage、to-tickets、implement 等）在写入任何文档前读本文件。

## 目录

```text
/
  AGENTS.md                  常驻约定（入口）
  初步设计文档.md             产品与技术设计（冲突时以此为准）
  docs/
    engineering.md           工程约定：技术栈、目录、领域命名、测试、IP
    agents/                  本目录——agent 流程配置
      issue-tracker.md       issue 在哪、怎么操作、平台限制
      triage-labels.md       triage 角色 ↔ Gitee label 映射
      doc-layout.md          本文件
    design-direction/        美术与 UI/UX 设计资料（按需读取）
      README.md              索引
      art-direction.md       整体美术方向主线
      guidelines/            视觉规范
      references/            参考目录、来源、调研
    research/                工程类调研笔记（一题一文件，见该目录 README）
  .agent-output/<agent-or-task>/   所有临时产物、日志、截图（gitignore）
```

## 写作规则

- **语言**：注释、提交说明、文档、日志、回复一律中文；专业名词保留原文（`WorldEvent`、`sessionSeq`、`TLA+` 等）。
- **标识符与文件名**：英文。
- **临时文件**：只写 `.agent-output/<agent-or-task>/`，不散落仓库根目录。正式产物放对应目录，**不引用** `.agent-output/`。
- **调研文档**按主题分流，不要混放：
  - **工程调研**（技术选型、工具、协议、API）→ `docs/research/`
  - **美术与视觉调研**（画风、界面参考）→ `docs/design-direction/references/research/`
- **设计决定**：记录在对应的设计文档中，不新建变更流水账。

## 领域文档

- `CONTEXT.md` / ADR 尚未建立。首个 `/grill-with-docs` 或 `/domain-modeling` 会话创建它们时，放在仓库根目录（`CONTEXT.md`）与 `docs/adr/`（ADR）。在此之前，领域词汇以 [工程约定](../engineering.md#领域命名) 为准。
- 被明确拒绝的需求进 `.out-of-scope/<slug>.md`（见 [triage OUT-OF-SCOPE](../../.agents/skills/triage/OUT-OF-SCOPE.md)）。
