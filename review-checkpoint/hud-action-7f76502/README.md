# HUD 动作专项脚本文字检查点

此目录只保存已冻结专项浏览器脚本的精确文字补丁与来源摘要，不修改主产品目录，不构成可运行候选或 CI 通过证明。

- 源提交：`7f7650287ada0c24c70c71bb5788d41b7698bac8`。
- 恢复目标：`frontend/tests/gaolao-hud-action-browser.mjs`。
- 原 Git blob：`ff803bec645cdb4c6f1db1b446e9ff45876259c8`。
- `script.patch` 可在目标不存在时恢复原字节；完整长度及 SHA-256 见 `source-manifest.json`。

该脚本需同源 PR48 HUD 十二文件，以及[已有翠兰文字检查点](https://github.com/gbcdby/xiyou/tree/205042faac15750eef66aed95f8e1ad5db085e9a/review-checkpoint/cuilan-v2-9194)中的 helper 和配套文字源码；还需要另行提供的 45 张运行 PNG 私有审阅交付物。只有 helper 不能等价重演完整检查。这里不包含图片、下载入口、原生成输入或原始运行证据，不能用本检查点替代图片公开授权。

只在具备全部依赖且获准的独立本地组合中应用：

```sh
git apply --check review-checkpoint/hud-action-7f76502/script.patch
git apply review-checkpoint/hud-action-7f76502/script.patch
```

纯 HUD 公开产品树保留旧自洽 browser/motion 载体，刻意不在活动测试目录加入本专项入口。首次完整运行、当前源对应和阶段结论须另行记录；本记录不宣称新远端 CI、首章或 A3 通过。
