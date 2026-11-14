# CS-R2 定向形式补证 S1

模式：`check/design`。基础包固定 `77ace28f526ce9ad905b1842b7353e48e251423c`，候选 Spec 固定 `1a7f45ddfeca0d25fb3714e1ce45980b225d5bde`，计划固定 `35d8759aac469eba5a8d9d4b94a787a3e62330c5`。只添加本目录；不修改旧模型/原131项结果、业务实现、Spec 或 current。实际代码 `68d2ccb` 仅有定向只读字段对应，`implementation_status=NOT_ASSESSED`。

## 入口

- `CONTRACT.md`：运行前冻结的54项范围与判据，7正向、47负控/见证，含3项真正时间负控。
- `MAPPING.md`：双用途状态投影、选择性控制帧、合法返还构造域、完整 payload 条件接口和公平性。
- `RESULTS.md`：实际逐MF结论、正向/反例/见证/未穷尽分类。
- `RUN_INDEX.json`：全部新历史与最终54项选择，实际命令、输入SHA、日志SHA、状态数和指纹。原包不包含在新统计中。
- `RUN_NOTES.md`：TLC初次工具错误、原取得来源版本修正、唯一单项300秒授权及旧输入保留。
- `source-bindings.json`：固定来源和独立审查SHA。

## 有限模块

| 文件 | 职责与边界 |
| --- | --- |
| SharedControlEffects.tla | C/p1/p2/W独立控制签名；两用途、每用途旧新请求、两物、实际外貌/持物/原取得/额度；共同Restart/Resume/Terminal、旧Receipt |
| ReturnSnapshotOperators.tla | 对可信完整世界后态，按observer构造返还集合及完整观察元组；当前view/revision、ownerRef=null、原版本来源 |
| ReturnSnapshotCut.tla | 同一合法proposed前缀和真实权威动作产生混合持有人；两个view/revision和可见性参数；不是全部权威环境×缓存组合 |
| ObserverSnapshotTransport.tla | 参数化完整payload的过滤/整体赋值，2 observer×2 view×3 seq；延迟/重复/乱序和旧Accepted；条件活性 |
| PersonalRecovery.tla | 原模块逐字复制；只新增BothPurposesProgress真正时间负控；原正向不重跑、不改绑 |

配置由 `make_profiles.py` 生成，初始默认均60秒、1 worker、512MiB heap。新独立 `fence-shared-extension-verification.json` 仅为 root 明确授权的相同共享配置一次300秒，其原60秒记录保留。

## 实际工具链与复现

固定jar：`"$TLA_JAR"`。

SHA256：`936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`。官方恢复来源：`https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar`。版本 TLC 2.19 / 08 August 2024 / rev 5a47802；Java OpenJDK21.0.13 Debian。实际使用原仓库的固定 `.agents/skills/worker-tla/scripts/run_tlc.py`，BFS，死锁检查开启，无CONSTRAINT/VIEW/对称归约或随机模拟。运行只用1 worker，已记录日志中的指纹/seed；没有新下载或把jar纳入Git。

在本工作树根目录，单项复现示例（输出目录必须全新）：

```bash
python3 formal/adv001/cuilan-self-response-supplement/verify.py \
  --jar "$TLA_JAR" \
  --out /absolute/new-output-directory \
  --jobs 1 --profile fence-performer
```

共享300秒的真实执行调用原runner：

```bash
python3 .agents/skills/worker-tla/scripts/run_tlc.py \
  --manifest formal/adv001/cuilan-self-response-supplement/fence-shared-extension-verification.json \
  --profile fence-shared \
  --jar "$TLA_JAR" \
  --out /absolute/new-shared-output-directory
```

这些是复现命令，不是再次扩时/扩矩阵的授权。`collect_results.py` 只读取本轮已结束的实际结果，验证当前传递依赖和全部历史输入哈希；不运行TLC或业务。

## 结论解释

正向 PASS 要求原退出0、实际完成、队列0、启用性质精确一致且超过运行前状态下限。故障负控rc12或rc13是预期辨识；反置NoWitness的rc12是可达见证，均不计正向穷尽。初态即违反的类型负控可以没有终态统计，报告保留null。超时仅记录日志进度下界，不伪称最终探索总数。

本补证不自动释放生产FM，不证明连续几何、Socket实际交错、SQL事务、页面正确性、真实provider或真人体验。旧五项未完仍在旧包原身份下；本轮共享与constructor的历史超时另列。正式实现对应和新包独立复核仍由root安排。

## 私有发布提案中的路径规范

本页3处原机器jar路径用 `"$TLA_JAR"` 表示；复现时显式设为上述同摘要jar的位置。`RUN_INDEX.json` 的926处原执行目录前缀用 `${FORMAL_SUPPLEMENT_RUN_ROOT}` 表示。此索引是原件的可逆路径派生，原索引SHA-256为 `bc8af5ee507504ee050006a84b5f51df494673092694aac5306abd2a136a6686`；它不是新的执行日志或补跑结果。原54项选定、61次历史、分类/计数/时长/指纹及所有证据摘要不变；模型、cfg、runner等其他78文件逐字保持。此整理不代表外部公开已获许可，也不改变原有限结论。
