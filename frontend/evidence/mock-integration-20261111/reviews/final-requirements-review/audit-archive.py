#!/usr/bin/env python3
"""核对待发布的新证据清单；不读取标准轴报告内容。"""
import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
archive = ROOT / ".agent-output/final-artifacts"
index = json.loads((archive / "artifact-index.json").read_text())
plan = json.loads((archive / "archive-plan.json").read_text())
errors = []
sha = lambda data: hashlib.sha256(data).hexdigest()


def require(ok, message):
    if not ok:
        errors.append(message)


listed = {item["path"] for item in index["files"]}
actual = {str(p.relative_to(archive)) for p in archive.rglob("*") if p.is_file() and p.name != "artifact-index.json"}
require(actual == listed, "归档实际文件集合与索引不符")
checked = []
not_read = []
for item in index["files"]:
    if "standards" in item["path"]:
        not_read.append(item["path"])
        continue
    path = archive / item["path"]
    data = path.read_bytes()
    require(sha(data) == item["sha256"] and len(data) == item["bytes"], "归档摘要或长度不符：" + item["path"])
    checked.append(item["path"])

copied = 0
for item in plan:
    if "standards" in item["archive"]:
        continue
    original = Path(item["source"]).read_bytes()
    published = (archive / item["archive"]).read_bytes()
    require(original == published, "复制内容与原件不符：" + item["archive"])
    require(sha(published) == item["sha256"] and len(published) == item["bytes"], "复制清单摘要不符：" + item["archive"])
    copied += 1

source_result = ROOT / ".agent-output/mock-network-900/result.json"
source = json.loads(source_result.read_text())
summary = json.loads((archive / "network/summary.json").read_text())
method = json.loads((archive / "network/archive-method.json").read_text())
comparison = dict(summary)
comparison.pop("sourceResultSha256")
comparison.pop("traceIdentity")
comparison.pop("archiveScope")
comparison["trace"] = source["trace"]
require(comparison == source, "网络结果摘要改变了原有结果字段")
require(summary["sourceResultSha256"] == method["sourceResultSha256"] == sha(source_result.read_bytes()), "网络来源结果摘要不符")
identity = {k: v for k, v in source["trace"].items() if k != "file"}
require(summary["traceIdentity"] == method["sourceTrace"] == identity, "网络来源 trace 身份不符")
compressed = (source_result.parent / source["trace"]["file"]).read_bytes()
raw = gzip.decompress(compressed)
selected = []
for line in raw.splitlines(keepends=True):
    if json.loads(line)["kind"] in method["selectedKinds"]:
        selected.append(line)
require(len(selected) == method["selectedRecords"] == 68, "必要断言选择数量不符")
require(b"".join(selected) == (archive / "network/assertions.jsonl").read_bytes(), "必要断言没有逐行保留原始字节")

execution = json.loads((archive / "execution-source.json").read_text())
require(execution["localExecution"] == source["source"], "归档执行身份不符")
require(execution["localExecution"]["commit"] == "fa87e221aa1e48cb19eeecc1beafcb83c0a7a21a", "归档候选不符")
require(execution["localExecution"]["tree"] == "2d81686787d35d3a26747fbd7896ab1ec54c31ed", "归档源码树不符")
matrix = json.loads((archive / "acceptance-matrix.json").read_text())
require([row["id"] for row in matrix["items"]] == [f"VER-{i:02d}" for i in range(1, 9)], "归档验收矩阵缺项")
require(all(row["executionStatus"] == "PASS" for row in matrix["items"]), "执行矩阵没有全部通过")
require(matrix["finalReviewAssessment"] == "PENDING", "正式双轴报告归档之前不应提前改写审查结论")

result = {
    "assessment": "PASS" if not errors else "FAIL",
    "executionCandidate": execution["localExecution"]["commit"],
    "executionTree": execution["localExecution"]["tree"],
    "artifactIndexSha256": sha((archive / "artifact-index.json").read_bytes()),
    "archivePlanSha256": sha((archive / "archive-plan.json").read_bytes()),
    "indexedFiles": len(index["files"]),
    "checkedNonStandardsFiles": len(checked),
    "checkedCopiesAgainstOriginal": copied,
    "standardsFilesNotRead": len(not_read),
    "checkedFiles": checked,
    "standardsExcludedPaths": not_read,
    "newTraceSelectedLines": len(selected),
    "newTraceSelectedLinesByteIdentical": True,
    "summaryOriginalFieldsUnchanged": True,
    "finalReviewStatusAtAudit": matrix["finalReviewAssessment"],
    "errors": errors,
    "scope": "仅主控此次声明的95文件预归档快照；标准轴目录只查看清单名称而未读取内容。之后仅增加两轴原报告、如实更新汇总状态/索引及入口说明的归档差异，须由主控固定最终提交并回读；本结论不扩展到未审业务改动。",
}
(OUT / "archive-audit.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({k:v for k,v in result.items() if k not in ["checkedFiles", "standardsExcludedPaths"]}, ensure_ascii=False, indent=2))
raise SystemExit(bool(errors))
