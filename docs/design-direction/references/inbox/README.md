# 新增素材入口

新搜集图片先放项目的 `.agent-output/<agent-or-task>/` 临时目录。用户确认具体图片的长期入库范围后，才放在此处并使用 [`worker-visual-design`](../../../../.agents/skills/worker-visual-design/SKILL.md) 执行登记、逐张审阅与规则更新；已有明确入库授权直接沿用。

当前尚未入库任何参考素材，R01—R72 是历史预留编号，详见[参考目录](../catalog.md)。恢复历史材料时先核对编号与来源；新素材从 R73 起分配。文件出现不意味着后台自动处理或已采纳画风。正式导入后再按真实文件生成哈希并保存至 `references/images/`，不能提前声称目录或素材已经存在。
