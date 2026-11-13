# SP06 公开随行提议：有限模型与交接

针对首章 [#33](https://github.com/gbcdby/xiyou/issues/33) / [#34](https://github.com/gbcdby/xiyou/issues/34) 的新领路者入口。新请求使用当前可见人物 `resourceRevision`；legacy 精确私有版本语义保留。新旧成功提议都原子推进公开版本，原 nonce 原串仍优先恢复原 Receipt，投影不扩大他人许可受众。正式合同见 [ADV 协议 §6](../../../docs/specs/adv-protocol.md#6-同意随行与安置)。

**本次结论：四个有限正配置均 `PASS_WITHIN_SCOPE`；15 个故障负对照和 6 个可达见证均得到预声明目标的原始 `raw12`。** 这是已定义范围的模型检查和源码对应，不是无限规模或实现 refinement 证明。旧宽交叉配置三次超时仍为 `INCONCLUSIVE`，没有被小配置改写为通过。

## 实际结果

固定模型 SHA256：`8613b929dea9a4c711ed0f93eb29d76497922e4fe6062062fa61e2f76e92d82b`。TLC 2.19 / tools v1.7.4，固定 JAR SHA256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`。

| 正配置 | generated | distinct | 剩余队列 | 本次用时 |
|---|---:|---:|---:|---:|
| positive-public | 88,101 | 27,620 | 0 | 5.76s |
| positive-mixed | 84,917 | 26,228 | 0 | 5.55s |
| positive-identity-public | 318,176 | 116,334 | 0 | 19.64s |
| positive-identity-legacy | 317,064 | 115,718 | 0 | 20.60s |

四项均 raw0 / runner0 / completed，实际检查13项 invariant、启用死锁检查，无 temporal property。不同配置规模不能相加成一个状态空间。六个否定可达命题确实找到新领路者、两类竞争、旧控制原串恢复、Unknown重试及运动后版本可用的轨迹；并非只依靠最小状态数认定非空覆盖。

精确每次结果、51次历史/当前运行的原始状态及输入/日志/消息 SHA、25项最终选择在 [verification-results.json](verification-results.json)。负控/见证的逐步标量摘录在 [counterexample-summary.json](counterexample-summary.json)。原始完整运行包（日志、result、messages、输入快照）**未随仓库提交**，已由任务执行者保留为私有证据；本目录不链接临时运行目录或私人下载位置。它们不能替代本目录的可复现源码与配置。

## 范围与源码对应

[MODEL_CONTRACT.md](MODEL_CONTRACT.md) 固定每项风险、性质、假设、分解理由、负对照和排除行为。[MODEL_SOURCE_MAP.md](MODEL_SOURCE_MAP.md) 对应到精确冻结源码，逐文件摘要在 [source-identity.json](source-identity.json)，项目事实在 [project-profile.json](project-profile.json)。

两个认证人类、一个真实本人、两个合法目的地，每主体2个 nonce。竞争族保留两提交顺序、3次总提交及一次可信回应/撤回加一次普通运动；身份族保留2次总提交、一个变参维度及合计一次环境变化，明确包含 view+epoch 同时变化。更多同时失效因素只依据真实守卫单调拒绝与 Receipt 分支先后作工程组合论证，不声称与旧宽空间等价。没有 `CONSTRAINT`、`VIEW`、对称裁剪或隐藏状态。

`CurrentProjection` 只抽象当前用途槽的授权子集；真实旧参与者可继续看到自己的许可历史。`advanceSpatialTime` 位于 Receipt 查找之前，因此“一次效果”指本次提议/许可，不能理解为世界时间完全不动。假定 Session 行锁事务的原子效果/Receipt保存；数据库崩溃实现、真实几何、完整 JSON/哈希、本人自然语言决定、未知nonce多轮恢复和整个章组合不在此模型内。

## 重现

使用本仓库已固定的 `.agents/skills/worker-tla/scripts/run_tlc.py`，本目录 `check.py` 只检查原始状态/退出码/实际性质/预声明目标，不改写 runner 结果。运行输入与固定 runner 摘要见 [input-manifest.json](input-manifest.json)。

```sh
python3 formal/adv001/follow-proposal/check.py \
  --jar /path/to/tla2tools.jar \
  --out .agent-output/follow-proposal-reproduction
```

输出目录必须全新，默认最多两个检查任务并行。正配置预算120s、2 workers、1024MB；负控/见证60s、1 worker、512MB。单项可追加 `--profile positive-mixed --jobs 1`。结果 raw12 在负控/见证里是必要成功判据；正配置仍要求 raw0、completed、队列0和全部13性质一致。当前以**独立必需验收**交付，未接入现有20分钟CI，也未修改CI门槛。

## 与真实实现验收分开

对象为 `6b71dff96439553b336dd523b2126b7c51f6fa83` / tree `8ed5516ea77f1b299ac2482aa2b24cfa4bdd385e`，相对作者实际实现 `6bc7f62` 仅公共接口表补充，业务/schema/tests字节相同。独立原 SP06 双GUI重启链和受影响真实PG7项已通过；原 `CONSENT_STALE` 失败保留为修复前证据，详见任务验收记录。GUI使用两真实浏览器账号、同PG不同 authority OS进程、生产scenePolicy驱动本人，核心NPC输入受控；未验证真实LLM。TLC原始 `implementation_status: NOT_ASSESSED` 原样保留，不用模型结果替代GUI、PG、源码独立审查或最终CI。

若修改新旧 schema、scope守卫、Receipt查找/摘要边界、公开版本推进、事务原子性或当前许可投影，需要重新核对相应模型与证据；纯集成应保留源集合/树的精确映射。
