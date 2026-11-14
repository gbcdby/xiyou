# 翠兰本人回应：CS-R1 历史与 CS-R2 有限形式证据

本目录由独立 `worker-tla` 创建，只做设计建模与 TLC 检查。业务实现、实现对应/精化、生产验收均为 **NOT_ASSESSED / NOT_RUN**；没有修改业务、测试、内容或候选 Spec。外层决定采用与实施释放。

## 固定来源与结论入口

- CS-R1：`76d98e137f5220518b072650ba6af8001966ea23`，tree `18287fbcde9590c6ce83a82ee747dfafaccdfe46`。
- CS-R2：`1a7f45ddfeca0d25fb3714e1ce45980b225d5bde`，tree `6b0130cd6838bf052504994527f05e29aabf521e`，parent 为 R1。
- 主规范：`docs/specs/gaolao-scene-policy.md` §10–17。实际来源摘要见 `source-files.json`、`source-r2.json`。
- `RESULTS.md` 给最终逐项运行表；`RUN_INDEX.json` 给每项预期、实际结果、输入/证据摘要、真实命令、指纹与超时下界。**COUNTEREXAMPLE 负控或见证不等于正向穷尽。**
- `SOURCE_MAP.md` 说明原条款/R2增量、初态可达前提、模型修正、assume/guarantee、公平性与未覆盖。

R1 current-only 归还投影存在四状态设计缺口见证：合法接受→拿取→绑定失效→第三方在失效后合法新提议占槽，旧持物归还入口消失。R1 字节和原结果保存在 `history/cs-r1/`，不以 R2 修订抹去。

R2 采用逐物 `privateReturns` 与 immutable request-only `permissionTerm`。已完成组件证据和未穷尽的完整客户端缓存图必须分别阅读。完整缓存 private、restart-private、both、cooperative-return 的 60/300 秒结果仍为 **INCONCLUSIVE**；后续权威组件/快照接口结果不把它们改成 PASS，也不证明生产 UI/数据库事务。

## 最小模型与有限边界

| 模块 | 实际范围 | 组合前提 |
| --- | --- | --- |
| PersonalCAS | 两请求者、两用途、每人两次明确提议；公开 revision 读/提交分开 | 原始 CAS 合同未被 R2 改变；新 term 的编码另验。 |
| PersonalConsent | 一用途旧/新请求、另一用途一请求；prepare/commit、取消/撤回、失效、旧 Receipt | R2 成功 accept 的 scope 另外满足 Terms；当前本人 C2 与旧参与者 epoch 分开。 |
| PersonalRecovery | 两用途、晚到新语义、Unknown 前/后提交、一次重启、三次重试上限；容量4与5 | task 来自当前合法域语义；恢复不能跳过 Consent/Terms。 |
| PersonalTerms | 两用途各旧 reusable / 新 single_use；实际本人回应、公开 CAS、稳定 term/basis | 合法原子域提交；不证明 JSON/digest 实现。永久旁观者在场，不假设 NPC 离开。 |
| PersonalEffects | 两用途×两请求、两物、逐物 taken/completed、完整缓存、两view、裁剪、旧收据；可选一次重启 | 合法 single_use accepted 初态由其他组件的有限见证支持；无机械 refinement。 |
| AuthorityEffects | 继承同一世界动作/故障/逐物事实/完整返还派生；服务器可直接执行满足域守卫的归还 | 不假设 UI 同步；不检查 UI 缓存消费。 |
| PersonalProjection | 七个合法私物世界后态、两view、任意快照延迟/乱序/重复、晚到旧 Accepted | 完整快照生成及既有 view/generation/seq 接纳接口；不复制生产 merger。 |

观察元组为 `slot, active, holder, acquired, taken, completed, returns`，包括原取得身份、逐物额度和当前返还引用。只检查 slot/active 的旧抽象不能覆盖同槽拿取/归还。`miss-return-projection` 的实际 rc13 负控保留对此差异的辨识力。没有 CONSTRAINT、VIEW、对称归约或随机模拟；所有计数/身份均有限且无 modulo ABA。

## 公开索引的路径说明

`RUN_INDEX.json` 仅将原隔离运行目录前缀规范为 `${FORMAL_RUN_ROOT}`；它是可移植路径索引，不是逐字原始执行日志。`publication` 字段保留原索引 SHA-256 和规范化范围。全部模型/config、命令其余参数、131 项选定结果、178 次历史运行及各输入/证据摘要不变；原件继续按原摘要保留，未由这次文档整理重跑或重判。

## 工具链与复现

原运行使用下列固定摘要的 TLC jar。复现时将环境变量 `TLA_JAR` 设为本机该 jar 的路径；原机器的绝对位置不进入公开说明。

SHA-256：`936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`。

官方恢复来源：`https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar`。版本为 `TLC2 Version 2.19 of 08 August 2024 (rev: 5a47802)`，OpenJDK `21.0.13`。使用项目已固定的 `.agents/skills/worker-tla/scripts/run_tlc.py`；每配置 BFS、一个 TLC worker、512MiB JVM 上限（TLC 报告455MB heap/64MB offheap）。实际 RSS 未测得，未据此解释超时。

从本 worktree 根目录可按原 runner 复现单项；输出须为新的空目录。示例是已运行过的私物权威组件配置，不是额外实施验收命令：

```sh
python3 .agents/skills/worker-tla/scripts/run_tlc.py \
  --manifest formal/adv001/cuilan-self-response/authority-verification.json \
  --profile authority-private \
  --jar "$TLA_JAR" \
  --out .agent-output/cuilan-self-response-reproduction
```

`make_profiles.py` 保存事先判据和有限参数；`verify.py` 检查原始退出码、实际启用的全部性质、死锁配置、完整结束/queue=0和最低状态数。`collect_results.py` 仅汇总真实结果且拒绝未完成运行或当前模型与输入快照不一致，不生成模拟通过。

## 必须交给实际代码/产品验收的边界

实际事务原子性、单一物权/取得记录持久化、term进入 scopeDigest/basis 的真实编码、原 nonce/Receipt 的并发唯一性、恢复时的原身份收束、真实 EntityRef/itemRevision/ownerRef/LOS、正常行囊归还入口、页面换代与断线重连、旧内容/三自主NPC的定向回归，均不由本目录宣告通过。

**T03/T04 必验点：** Receipt 仅写原动作历史并触发 sync；连续晚到旧 Accepted 不得回写当前 snapshot、grant、逐物额度或 privateReturns。当前完整快照必须覆盖同 slot/active 下的拿取、归还与放回；服务器仍独立重验当前规则。投影组件的安全与活性负控是这些实际代码验收的设计依据，不是生产通过记录。

归还活性只在持有人真实合作、空间/引用守卫持续可满足时成立；快照活性只在最新完整投影最终送达的弱公平假设下成立。没有 NPC 离开公平性、任意玩家合作保证或无限重启保证。独立需求/标准审查另行作结论；本模型的独立形式复核为 **NOT_RUN**。
