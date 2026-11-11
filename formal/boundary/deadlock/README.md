# 非终态死锁敏感性

此隔离变体复制 SessionIsolation 模型的同一初态、变量和 TypeOK，仅把 Next 改为 FALSE：四个请求仍未处理，但所有接收/处理动作都被禁用。它用于核实受控 runner 的死锁检查确实执行，不是业务正模型。

实际结果是原始 TLC rc=11、Deadlock reached、runner COUNTEREXAMPLE。完整原始材料见 [结果索引](results.json)。TypeOK 的目标 rc=12 负对照仍由 [SessionIsolation](../isolation/README.md) 提供，死锁反例不能替代任一安全性反例。
