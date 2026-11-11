# Triage 标签映射

`/triage` 技能使用五个状态角色与两个类别角色（canonical role name 见 [triage SKILL](../../.agents/skills/triage/SKILL.md)）。本仓库把它们映射到 Gitee 上实际存在的 label。

Gitee label 名称只允许汉字、字母、数字、`.` `_` `-` `/` `\` 与全角符号，且长度 2–20 字符，**不能含冒号**。因此 wayfinder 的 `wayfinder:<type>` 在这里写作 `wayfinder-<type>`。

## 状态角色（state roles）

每个 triage 过的 issue 恰好带一个。

| canonical role | Gitee label | 含义 |
|---|---|---|
| `needs-triage` | `needs-triage` | 待维护者评估 |
| `needs-info` | `needs-info` | 等待报告者补充信息 |
| `ready-for-agent` | `ready-for-agent` | 已完整描述，可由 AFK agent 直接执行 |
| `ready-for-human` | `ready-for-human` | 需要人工实现 |
| `wontfix` | `wontfix` | 不予处理（仓库已自带此 label） |

> 首次使用前若某 label 不存在，先执行：
> `gitee label create --repo gbcdby/xiyou --name "<name>" --color "#hex"`
> 用 `gitee label list --repo gbcdby/xiyou` 核对。

## 类别角色（category roles）

| canonical role | Gitee label | 含义 |
|---|---|---|
| `bug` | `bug` | 有东西坏了（仓库已自带） |
| `enhancement` | `enhancement` | 新功能或改进（仓库已自带） |

## Wayfinder 标签

wayfinder 的票自带类型标签，与 triage 状态并行存在，互不替代。

| 用途 | Gitee label |
|---|---|
| 地图 | `wayfinder-map` |
| 研究票（AFK） | `wayfinder-research` |
| 原型票（HITL） | `wayfinder-prototype` |
| 拷问票（HITL，默认类型） | `wayfinder-grilling` |
| 任务票（AFK/HITL） | `wayfinder-task` |

## 边界

triage 只处理**不是由 `/to-tickets` 或 wayfinder 产出的** issue——即外部来的 bug 报告与功能请求。上述流程产出的票已经是 agent-ready 的，不要重新 triage。
