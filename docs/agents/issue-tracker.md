# Issue tracker: Gitee

Issues live as Gitee issues on `gitee.com/gbcdby/xiyou`（私有仓库）。主力工具是 **gitee CLI**（AndersHsueh 版，内置 `--agent-help` 结构化文档），Gitee API v5 + `curl` 作兜底。

> 本文件同时适用于本仓库与同类 Gitee 个人仓库。下文凡是标「实测」的条目都已在本仓库跑过命令验证。

## 认证

- 已配置 `gitee auth login`（token 存于 `~/.gitee-cli/settings.json`），`gitee auth status` 可查。
- 覆盖顺序：`--token` 标志 > 环境变量 `GITEE_TOKEN` > 配置文件。token **不得硬编码或提交**。
- 提取 token：`jq -r '.hosts["gitee.com"].token' ~/.gitee-cli/settings.json`。
- 本 CLI **不会**从 git remote 推断仓库，漏写 repo 标志直接报 `--repo is required`。

## 命令速查

| 操作 | 命令 | 备注 |
|---|---|---|
| 建 issue | `gitee issue create -R gbcdby/xiyou -t "标题" -b "正文" -l "label"` | |
| 读 issue | `gitee issue view <Ixxx> -R gbcdby/xiyou` | 表格输出会截断正文 |
| 读全文/评论 | `gitee api GET /repos/gbcdby/xiyou/issues/<n>/comments -o json` | |
| 列 issue | `gitee issue list --repo gbcdby/xiyou -o json` | **不接受 `-R`**，实测报 `unknown shorthand flag` |
| 评论 | `gitee issue comment <n> -R gbcdby/xiyou --body "..."` | |
| 建仓库标签 | `gitee label create -R gbcdby/xiyou -n <name> -c <6位hex>` | Gitee 标签用 `-n` / `-c` |

issue 的 `number` 是 **ident 字符串**（如 `IKU4W9`），不是纯数字。

## 写操作：路径必须去掉 repo 段（最重要的一条）

CLI 的 `issue edit` / `issue close` / `issue reopen` 与 `--assignees` **整条不可用**，返回 `HTTP 404: project or enterprise`。

**根因不是权限，是路径。** Gitee v5 读写路径分离：

- **读**：`/repos/{owner}/{repo}/issues/<n>`（带 repo 段）
- **写**：`/repos/{owner}/issues/<n>`（**不带 repo 段**，`repo` 作 body 参数）

实测（本仓库，2026-11-09）：

```bash
# ✅ 可用：改 assignee
gitee api PATCH /repos/gbcdby/issues/IKU4W9 --field repo=xiyou --field assignee=gbcdby

# ✅ 可用：关闭 / 重开
gitee api PATCH /repos/gbcdby/issues/IKU4W9 --field repo=xiyou --field state=closed
gitee api PATCH /repos/gbcdby/issues/IKU4W9 --field repo=xiyou --field state=open

# ✅ 可用：改正文
gitee api PATCH /repos/gbcdby/issues/IKU4W9 --field repo=xiyou --field body="$(cat body.md)"
```

curl 直连同理：`PATCH /repos/gbcdby/xiyou/issues/<n>` 一样 404。

> 曾误判为「Gitee 个人版不支持写操作」——**那是错的**，只是漏了 `repo` 参数。不要因为 404 就改用标签绕路。

### `--field` 的两个坑（实测）

1. **`--field body=@file` 会把字面路径当正文写入**，静默成功（200）但正文变成 `@/tmp/x.md`。大段正文一律用 `--field body="$(cat file)"`。
2. **写后必读回校验**，判据用本次新增的独特字符串（别用已存在的标题，会假阳性）。

## 正文硬上限 ≈64KB（实测）

`PATCH` 的 `body` 超过约 **64KB**（UTF-8 字节）会被拒。本仓库实测：**63,900 B 通过，66,000 B 失败**。

注意失败时的错误码是 **`HTTP 403: permission denied`**（不是 500），极易误判成权限问题。按 ≤64KB 留余量使用。

wayfinder 的地图 body 逼近此线就写不进去：新增内容只能按「索引长度」写，详情留在各 ticket 的结论评论里——这正是地图作为 index 的本意。**发现写不进去时，正文可能已被前一次较小的写入改坏**，务必从未污染的本地副本重建。

## 关闭的 issue 禁止评论（实测）

对已关闭的 issue 发评论，CLI 与 curl 都报 **`HTTP 401 authentication failed`**——**这不是凭证问题**，别去重登录。

正确顺序：**先评论，后关票**。已关闭需要补评论时先重开：

```bash
gitee api PATCH /repos/gbcdby/issues/<n> --field repo=xiyou --field state=open
# 发评论
gitee api PATCH /repos/gbcdby/issues/<n> --field repo=xiyou --field state=closed
```

## 标签

- **添加**：`PATCH` 的 `labels` 参数会被**静默忽略**（返回 200 但标签没变，实测）。用：

  ```bash
  curl -X POST "https://gitee.com/api/v5/repos/gbcdby/xiyou/issues/<n>/labels?access_token=$TOKEN" \
       -H "Content-Type: application/json" -d '["ready-for-agent"]'
  ```

  form 格式（`labels=a,b`）报 400 "Problems parsing JSON"。

- **移除单个**：`gitee issue edit --labels ""` 无效（空串被当作"不修改"）。用 **带 repo 段的读路径**：

  ```bash
  curl -X DELETE "https://gitee.com/api/v5/repos/gbcdby/xiyou/issues/<n>/labels/<name>?access_token=$TOKEN"
  ```

  注意这条是 DELETE，走的是 `{repo}` 路径（实测 204）；不带 repo 段会 404。

- **标签命名**：Gitee 标签名不允许半角冒号，技能里的 `wayfinder:<type>` 落地为 `wayfinder-map` / `wayfinder-research` / `wayfinder-grilling` / `wayfinder-prototype` / `wayfinder-task`（均已建好）。triage 映射见 [triage-labels.md](triage-labels.md)。

## PR 输出与读回

PR 创建输出不保证服从 `-o json`；返回成功但解析失败时保存输出，用 `python3 scripts/gitee_pr_read.py --create-output <file>` 恢复编号。该工具只有读操作，不重复创建或代点审核。

**PRs as a request surface: no.** 个人项目，外部 PR 不进 triage 队列。

## 技能措辞对照

- 「publish to the issue tracker」 → 建 Gitee issue，附对应 triage 标签。
- 「fetch the relevant ticket」 → `gitee issue view <n>` + `gitee issue comments <n>`（全文用 API）。

## Wayfinding operations

Gitee 没有原生 sub-issue / blocking 链接，用**文字约定**兜底：

- **Map**：一个打 `wayfinder-map` 标签的 issue，body 维护 Destination / Notes / Decisions-so-far / Not yet specified / Out of scope。
- **Child ticket**：普通 issue，body 第一行写 `Part of #<map>`，并加进 map 的清单。
- **Blocking**：child body 顶部写 `Blocked by: #<n>, #<n>`。所有 blocker 关闭即解除阻塞。
- **Frontier**：列出 map 清单中 open 的 children，去掉仍有 open blocker 或已有 assignee 的，按清单顺序取第一个。
- **Claim**：`gitee api PATCH /repos/gbcdby/issues/<n> --field repo=xiyou --field assignee=<登录名>`（不要用 CLI 的 `--assignees`）。
- **Resolve**：先 `gitee issue comment` 写决议 → 再用 API `state=closed` 关票 → 最后把上下文指针追加到 map 的 Decisions-so-far（走 `gitee api PATCH ... --field body=`，注意 64KB 上限）。
- **资产落点**：research/prototype 的中间文件放 `.agent-output/`；关票时把值得留的迁入 `docs/` 并清理。

## 已知地图

- [技术骨架：从文档到可验证的地基](https://gitee.com/gbcdby/xiyou/issues/IKU4W9)
