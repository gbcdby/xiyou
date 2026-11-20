# D66-DS2实际结果：27条已结束记录，等待独立绑定

本页由root机械封装原记录，三个正profile已完成；内容仍等待最终身份的独立绑定。以下27条均保留原manifest和result SHA，详见EVIDENCE_INDEX.json；没有新增TLC或业务运行，也不声明自然门PASS。

## 两个补入的正安全结果

| profile／原run | 最终状态与统计 | 原result／manifest身份 |
| --- | --- | --- |
| core-rebinding／core-rebinding-completion-r3 | PASS_WITHIN_SCOPE；645.107619秒；140535032／33931337／0 | result 3e69c67c03499d425bf70ae93a1d48e8c47e2bdf63199cb383b7f9d9e5aca290；manifest c54713f1ad2662a63c0cfcf504a780334c5fc6f2e85684c395de9049607d9014 |
| core-deadline／core-deadline-completion-r3 | PASS_WITHIN_SCOPE；294.138328秒；56166377／13183795／0 | result bfb63ddc3084709a405b3866ee08134ae964c856dc65e31894e83d1e0430e24c；manifest c54713f1ad2662a63c0cfcf504a780334c5fc6f2e85684c395de9049607d9014 |

## 已结束原记录

| 类别／run | 原状态 | 秒 | generated／distinct／remaining | result SHA256 |
| --- | --- | ---: | --- | --- |
| positive_safety：core-shared-completion-r1 | PASS_WITHIN_SCOPE | 130.264396 | 25453553／6321710／0 | a6cf50339a4891ccdbb3b4a940b6bb6fc9f4c81aaa9e16c6aa57926cc841b4aa |
| timeout：core-shared-r2 | INCONCLUSIVE | 60.574925 | null／null／null | 87c281a71adbe405e947bf7e8ffb4bf4e51e569c02da35b2c8815f0971a76b0e |
| timeout：core-shared-r3-projected | INCONCLUSIVE | 60.518096 | null／null／null | 8320e853845f70d7e96fd6be2e1b632b1269855d0203cc3d3e05ad7332b3827a |
| timeout：core-rebinding-completion-r1 | INCONCLUSIVE | 240.561314 | null／null／null | 8dbe6c84330fff5c14dc5eed61a980a3e4f1fe04a7db0b32a503df5c922e6ae1 |
| timeout：core-deadline-completion-r1 | INCONCLUSIVE | 240.632908 | null／null／null | d2e683fc2c2b5cfdc1af01133a8cc70862c1df04e23ae55545c8018b01df361c |
| negative_control：negative-session-capacity-r1 | COUNTEREXAMPLE | 2.315357 | 22595／10722／7902 | fefa728b0efd954c65f64def6f730b4cb0bc155ca562cc14f5a473b0a087be21 |
| negative_control：negative-old-deadline-r1 | COUNTEREXAMPLE | 1.493957 | 66／40／24 | ada9fb1b69c4f93350c2b76f22bc2acfc9432283c17ad2e21e0a573115555311 |
| negative_control：negative-unknown-freeze-r1 | COUNTEREXAMPLE | 1.575676 | 1972／989／669 | 3aee48374e9c5c3e1ed8c1bbe327e9229f34c898801e2978569cf3bc5a21b7d5 |
| negative_control：negative-old-generation-r1 | COUNTEREXAMPLE | 1.529775 | 1006／556／399 | 6adae3bc9a7647926b9b6bb23c9edf10addea9e1bb482cabf28a72b7cda134e6 |
| negative_control：negative-same-intent-latest-id-r1 | COUNTEREXAMPLE | 1.931612 | 1823／955／619 | 415e775ca62521cc0c022bde301e5a8209e908e51d6e5a3029da137fcf4fe297 |
| negative_control：negative-latest-intent-r1 | COUNTEREXAMPLE | 1.450858 | 365／189／141 | 0f79cfb7349b370f2cacdc870ff0c1ac970dabb41eb5b21a4fb8eb957fa9852f |
| negative_control：negative-clear-budget-r1 | COUNTEREXAMPLE | 26.781768 | 1493927／467473／262345 | 14fe66a0d2b417481b022ac047ee48cb71ef74e59ddb727b4dc171b48a6ca36d |
| negative_control：negative-cadence-r1 | COUNTEREXAMPLE | 1.101519 | 24／9／2 | 98882f5fff5600a24babe8827d1b053b6ba9c33b1f51f93e7eebc2895b20c429 |
| negative_control：negative-receipt-id-r1 | COUNTEREXAMPLE | 1.308971 | 137／83／55 | b7cab1492fab53dd2ef28920cb3116c136eafa65d9bcf59b647864541c1c5e9a |
| reachability_probe：witness-two-same-r1 | COUNTEREXAMPLE | 1.569253 | 66／40／24 | 9409e17d78199c13f50ddbfa6f88d9cce6baf37fca8407339f33ce17541fcc8b |
| reachability_probe：witness-latest-release-r1 | COUNTEREXAMPLE | 41.512836 | 2055820／650508／377280 | 029c812b4baba55ca0d6385d43034f46ade62eb6698e5a4dc753fcbaa753b8e2 |
| reachability_probe：witness-cross-binding-r1 | COUNTEREXAMPLE | 2.871146 | 325／196／130 | 794409be33175078396cf1425a470715939e22370a27312648f51dbc7705cba2 |
| reachability_probe：witness-query-before-return-r1 | COUNTEREXAMPLE | 1.886813 | 22／12／5 | 2c10f8dd9dec22d433bf26afbaa9075b0f0c5f7faa971859532017fd9d94fcf9 |
| reachability_probe：witness-ledger-reuse-r1 | COUNTEREXAMPLE | 6.16283 | 87813／40637／29161 | 99811ecd0f396745542b3eb94ba4e08a5bf00adf2fa9ec9f1880fb88a0ddbc55 |
| reachability_probe：witness-stop-with-two-r1 | COUNTEREXAMPLE | 1.930744 | 715／406／288 | 97063002c4adfb80078da705111c9c53c3d8d8291589605c5915b6f76b89792f |
| reachability_probe：witness-old-unknown-r1 | COUNTEREXAMPLE | 2.961924 | 895／562／404 | f0c7d93623d48e08803af343f5ce7b724e56e910e8fc03014e31bd6acb156863 |
| reachability_probe：witness-same-reject-ignored-r1 | COUNTEREXAMPLE | 3.495591 | 4534／2090／1134 | 40d82189d3af2fbdd4d68556081e939c2a27f3a678df6c303cdd8cdf625d2f73 |
| reachability_probe：witness-old-finally-r1 | COUNTEREXAMPLE | 3.37297 | 3896／2016／1459 | 052f4ba5f5a8b28f3a799e0ca2a00eb44186781e2df21c2c0ec743c3a38450a0 |
| sensitivity_absence：old-guard-absence-r1 | PASS_WITHIN_SCOPE | 2.788187 | 19640／7834／0 | 3a6704e59da397b6d556d663d70bafb65641216622da04992092694c8603376f |
| reachability_probe：witness-old-move-finally-r2 | COUNTEREXAMPLE | 1.82094 | 647／378／199 | 60d8da5f79db8c65a9eb0c6fbbf4f93f4cf192ab181d957cb4fff909e79389d0 |

| positive_safety：core-rebinding-completion-r3 | PASS_WITHIN_SCOPE | 645.107619 | 140535032／33931337／0 | 3e69c67c03499d425bf70ae93a1d48e8c47e2bdf63199cb383b7f9d9e5aca290 |
| positive_safety：core-deadline-completion-r3 | PASS_WITHIN_SCOPE | 294.138328 | 56166377／13183795／0 | bfb63ddc3084709a405b3866ee08134ae964c856dc65e31894e83d1e0430e24c |

COUNTEREXAMPLE在负控／存在探针中是预期目标命中，不能被当作正安全全状态通过；其remaining通常非零。old-guard-absence的PASS只证明给定旧guard配置中未达两同向目标，不是新模型全部安全或产品通过。四次timeout最终statistics为null，不能用progress行替代。

## 必须与结果一起保留的资格说明

| profile | 已观察与限度 |
| --- | --- |
| witness-latest-release | 实际原前缀：两个初始Input发生在E/E发送前；两同向满槽后仅改W，真实释放后发W。不证明满槽后先S再W。 |
| witness-old-unknown | 实际原前缀：id1先Unknown，随后id2Accepted，最终旧Unknown与较新Accepted共存。不证明较新Accepted先到。 |
| witness-same-reject-ignored | 实际原前缀：id1先Rejected并Handle，随后id2Accepted；旧拒绝未误halt。不证明较新Accepted先到。 |
| witness-stop-with-two | 实际原前缀：两未决move为S/E异向，Unknown触发自动stop；证明独立stop与两个move共存，不证明两同向全松stop。 |
| witness-old-finally | 实际原前缀：旧stop finally，local一直FALSE；本原profile不承担旧move entry从TRUE到FALSE的释放资格。 |
| witness-old-move-finally | 加强profile实际前缀：唯一move自身最新Rejected的Handle触发halt，之后Finally令该move local从TRUE到FALSE；clears=0/current=1，不是外部clear或bind的见证。 |

严格“较新Accepted先／旧Unknown或Rejected后”、“两旧同向满槽后S再W”、“全松触发独立stop”与外部clear/bind的针对顺序归root已实际完成的69项单元／session测试；本包不把那些测试结果升级成TLC见证，也不声称现有最短前缀已展示这些严格顺序。

正安全20性质原义务保持；这里收窄的是实际存在轨迹的资格，不能利用命名或最终状态补造消息先后。较新Accepted先到等严格组合没有在这些最短前缀中得到证明。

同intent负控较新E2仍waiting；旧代次负控的最短trace使用Input/Send拆步过近似。所有历史原件、旧stop finally原命中及加强move命中均保留。

三个正profile均有实际完整检查记录；本内容状态FINAL_CONTENT_AWAITING_INDEPENDENT_BINDING，等待非作者对最终文件和原证据身份绑定。不提前声称独审或自然验收门通过。
