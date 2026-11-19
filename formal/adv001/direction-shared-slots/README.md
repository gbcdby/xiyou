# D66-DS2：方向共享两槽有限模型

本目录对应 [#66正式采用D66-DS2 r2](https://github.com/gbcdby/xiyou/issues/66#issuecomment-7000269439)，权威产品合同见[客户端体验Spec](../../../docs/specs/gaolao-client-experience.md)。[DESIGN.md](DESIGN.md)保持原10777字节／SHA `3f9286fb6896b4e346c2899db0705881b710e08fca0cd0512eac2f0ae35e0800`；其中“尚未采纳”等状态是原文当时记录，已由上述采用决定取代，没有事后改字。

本目录从r2准备包机械封装，完整保留原包和所有原件，现汇总27个已结束记录。三个正安全profile均有完整PASS_WITHIN_SCOPE证据；内容状态为FINAL_CONTENT_AWAITING_INDEPENDENT_BINDING，等待非作者对最终身份绑定，不提前声称独审或原产品自然门PASS。

## 模型根与复现清单

| 独立根／manifest | 用途与身份 |
| --- | --- |
| `safety/`；`verification-safety.json` | 正安全模型SHA `787fdc589633ef6922bc43060e0b26da89705c3b26257a353e64c30a82d35249`，seen恒空，20项安全性质原文保持。 |
| `controls/`；`verification-negative.json` | 原含seen模型SHA `c50dacfdc8233af7506dc59a59413e84adfc44e239b34e480608c76e14c1c53b`，9个隔离错误变体。 |
| `controls/`；`verification-witness.json` | 同一原模型＋Probes SHA `4ed65b3e2619b03a7e44fb4f6eae22a6af06fd4476177c0c6fd6e301607ce45e`，原9个存在探针、旧guard缺席配对，新增1个旧move释放资格探针。 |

两个根各有同名`DirectionSharedSlots.tla`，不可覆盖或混载。正安全投影仅去除与业务无反馈的seen历史：guard、业务更新、audit和19业务性质不读seen；TypeOK的seen类型子项由固定标签构造保持。**Never见证只能使用controls原模型**。全部26个模型／cfg文件保持冻结来源原字节，新增cfg为`witness-old-move-finally.cfg` 191B／SHA `24a1411e9965122e94bf9c04ef985c9162b29946af674a99664e395d32864afc`。

## 已结束结果与真实见证限度

[RESULTS.md](RESULTS.md)及[EVIDENCE_INDEX.json](EVIDENCE_INDEX.json)分别列出状态、统计和原result／run manifest SHA；本包已收录三个正profile的完整结果和其余原记录，共27条。

- shared正模型：**PASS_WITHIN_SCOPE**，130.264396秒；25,453,553 generated／6,321,710 distinct／remaining0，20项匹配，0warning/error。
- core-rebinding正模型：**PASS_WITHIN_SCOPE**，645.107619秒；140,535,032 generated／33,931,337 distinct／remaining0，20项匹配，0warning/error。
- core-deadline正模型：**PASS_WITHIN_SCOPE**，294.138328秒；56,166,377 generated／13,183,795 distinct／remaining0，20项匹配，0warning/error。
- 9负控：全部实际命中指定目标，均为预期COUNTEREXAMPLE，不是产品FAIL或正安全通过。
- 原9个存在探针：均命中指定谓词；旧guard缺席配对完整通过，19,640 generated／7,834 distinct／remaining0。存在命中不能替代全称安全或严格时序。
- 加强旧move finally：预期COUNTEREXAMPLE，1.82094秒／647 generated／378 distinct；实际local TRUE→FALSE，补足原旧stop见证不具备的move资格。
- 四次历史资源超时全部保持**INCONCLUSIVE/TIMEOUT**：原shared60秒、投影shared60秒、原rebinding240秒、原deadline240秒。不会被新结果追认。

| 见证 | 实际前缀 | 证据限制 |
| --- | --- | --- |
| old-unknown | id1先Unknown，随后id2Accepted | 不是较新Accepted先到。 |
| same-reject-ignored | id1先Rejected并Handle，随后id2Accepted | 不是较新Accepted先到后旧Rejected。 |
| stop-with-two | S/E异向两move未决，Unknown触发自动stop | 不是两旧同向全松stop。 |
| latest-release | 两个初始Input在E/E发送前；满槽后仅改W，释放后发W | 不含满槽后先S再W两个改向。 |
| 原old-finally | 旧stop finally，local恒FALSE | 不证明move entry释放，原件保留。 |
| 加强old-move-finally | 唯一move最新Rejected的Handle触发halt，Finally将local TRUE→FALSE；clears=0/current=1 | 不是外部clear或bind路径。 |

严格“较新Accepted先／旧Unknown或Rejected后”、“两旧同向满槽后S再W”、“全松触发独立stop”与外部clear/bind的针对顺序归root已实际完成的69项单元／session测试；本包不把那些测试结果升级成TLC见证，也不声称现有最短前缀已展示这些严格顺序。

负控也有精确边界：同intent旧Rejected负控中较新E2仍waiting；旧代次负控的最短轨迹利用Input/Send拆步过近似，不是可直接复放的真实源码轨迹。详细源码／动作映射和限制见[SOURCE_MAP.md](SOURCE_MAP.md)。

## 正安全范围与资源

| profile | 原请求上限 | 100ms tick上限 | 显式输入上限 | 外部clear | 实例上限 | 当前复现资源 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| core-shared | 3 | 1 | 3 | 0 | 1 | 4 workers／1024MiB／240秒 |
| core-rebinding | 3 | 1 | 2 | 1 | 2 | 8 workers／2048MiB／900秒 |
| core-deadline | 3 | 4 | 1 | 0 | 2 | 8 workers／2048MiB／900秒 |

原20性质、cfg、787模型及所有有限参数未变，rebinding/deadline按原完整范围增加计算资源后均已完成。没有temporal property；本次完成不保证任意重跑的实时上界。Tick不强制派发原400ms任务，ACK先／timer先均允许；global准入仅检查原ledger status，没有新增全局age guard。clear不抹去旧pending或ledger，也不重置本实例token；新实例与原会话两层容量分开，原Receipt可以先收束而旧Promise仍挂起。stop序号比较只限同controlEpoch。

不覆盖实数时间／50ms分数token、硬实时400ms、跨epoch数值关系、任意规模、PG／呈现性能或自然无idle；不把最多3身份分面组合成4身份“E1/E2→W→stop”证明。实现精化仍为NOT_ASSESSED。原normal/late/five与父验收门不因此释放。

## 路径适配与原运行身份

三个manifest均使`design.path=DESIGN.md`本地可解，model.root分别为`safety`／`controls`。安全manifest来自completion-r3原清单SHA `c54713f1ad2662a63c0cfcf504a780334c5fc6f2e85684c395de9049607d9014`，只适配这两个路径；negative同样仅路径适配。witness清单合并原10项与加强oldmove一项，并修正六项scope.description／feature以精确说明真实资格；不改模型、cfg、参数、性质或资源。

仓库manifest的新SHA不冒充历史实际run manifest。shared实际使用completion-r1 `f6f8513f…`；原见证使用`a074a426…`，加强oldmove使用`129a8f15…`。原manifest/input/result保留原字节，27条身份索引见EVIDENCE_INDEX。manifest中的历史路径及初始NOT_RUN准备字段不是本目录的模型依赖，也不代替RESULTS的实际状态。

工具固定v1.7.4/TLC2.19，jar SHA `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`，受控runner SHA `ca5811a8cae5d31961185b0ba53868f3ea885a1ee614150d873d61044ff18f5a`；不切换仅准备过的1.8。复跑示例：

```text
python <受控runner绝对路径>/run_tlc.py --manifest formal/adv001/direction-shared-slots/verification-safety.json --profile core-rebinding --jar <固定jar绝对路径> --out <新的证据目录>
```

输出须为模型根外的新目录；negative/witness使用各自manifest。该示例不自动释放新运行预算。内容已机械封装；独立绑定审查、最终冻结与实际仓库写入仍由root推进。SOURCE_MAP.md按原字节保留，其25条／两项待填措辞是准备时快照；当前27条实际状态以RESULTS和EVIDENCE_INDEX为准。
