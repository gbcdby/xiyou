# #66 RPC/publisher 竞态的有限形式化增量

本目录是设计与TLA+/TLC模型检查产物，不含业务实现。R2在9个有限正向配置中完整检查18项安全性质，24个定向负控命中各自目标，11个存在性见证实际到达终点。真实业务状态保持NOT_ASSESSED，活性未检查；设计采纳等待总控独立核验。

## 阅读顺序

- [CONTRACT.md](CONTRACT.md)：唯一行为变化、旧history/race条款替换与模型映射。
- [REPORT.md](REPORT.md)：实际运行、状态数、RRS-DESIGN-01组合见证、负控、历史失败及范围限制。
- [HANDOFF.md](HANDOFF.md)：实现义务和真实验证场景，本worker未执行项目测试。
- [model/RpcRace.tla](model/RpcRace.tla)、[verification.json](verification.json)、[expectations.json](expectations.json)：固定模型、44个配置、运行前声明。
- [results.json](results.json)、[artifact-manifest.json](artifact-manifest.json)：完整身份索引。
- [evidence/final-records.tar.gz](evidence/final-records.tar.gz)、[evidence/history-records.tar.gz](evidence/history-records.tar.gz)：最终44次与历史43次原始记录，含每次输入快照。
- [trace-digest.json](trace-digest.json)：关键原始轨迹的派生阅读辅助。
- [project-profile.json](project-profile.json)、[inputs](inputs/)：项目映射、固定设计/审查原件和24源码输入身份审计。

模型基线是bb66dac423a7a306752a7474eabc95d7d4d9edb7。原Supply、SharedRead、Wave模型与旧64项原件均未覆写；本包不声称新RPC行为已经由旧Wave.ReturnRPC证明。

## 只读复核

在仓库根运行：

```sh
python3 formal/adv001/direction-supply-rpc-race/audit.py
```

该命令只核对归档字节、固定模型/config与原运行快照、原始状态/退出码、指定反例和历史失败记录，不启动TLC或项目测试。正向为PASS_WITHIN_SCOPE；负控和见证原状态必须保持COUNTEREXAMPLE，二者含义不同。

## 显式复跑

准备SHA为936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88的TLC2.19/v1.7.4 jar及Java，选择不存在的输出目录：

```sh
python3 formal/adv001/direction-supply-rpc-race/check.py \
  --jar /path/to/tla2tools.jar \
  --out /path/to/new-output \
  --profile positive-race \
  --profile witness-race-wave-covered-g-settled
```

check.py从固定归档读取原runner，校验工具SHA后运行显式配置；每项保留新result/messages/TLC stdout/input快照。它不会自动运行全部矩阵。固定预算为单worker/768MB/每项120秒，死锁与活性未检查；可接受停滞原因在manifest内声明。复跑应保留失败和超时原件，不能覆盖本包固定证据。

原始归档内路径为 `runs/<profile>/`；例如 `runs/witness-race-wave-covered-g-settled/messages.json` 和 `input/RpcRace.tla`。历史路径为 `runs/<phase>/<profile>/`。正式文档使用相对链接，原日志中的本地执行路径保持原字节用于追溯。
