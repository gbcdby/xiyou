#!/usr/bin/env python3
"""独立只读审计当前验收证据；输出限定在本审查目录。"""
import hashlib
import json
import re
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
EXPECTED_COMMIT = "fa87e221aa1e48cb19eeecc1beafcb83c0a7a21a"
EXPECTED_TREE = "2d81686787d35d3a26747fbd7896ab1ec54c31ed"
errors = []
checked_files = {}


def require(condition, description):
    if not condition:
        errors.append(description)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_hash(path, expected):
    actual = digest(path)
    checked_files[str(path.relative_to(ROOT))] = actual
    require(actual == expected, f"摘要不符：{path.relative_to(ROOT)}")


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def read(path):
    return json.loads(path.read_text())


identity = {"commit": git("rev-parse", "HEAD"), "tree": git("rev-parse", "HEAD^{tree}"), "status": git("status", "--short")}
require(identity == {"commit": EXPECTED_COMMIT, "tree": EXPECTED_TREE, "status": ""}, "当前候选身份或清洁状态不符")

# 核心模型的原始运行材料只读核验；不重新执行 TLC，也不把预期反例改写为正向通过。
core = ROOT / "formal/core-rebuild"
evidence = core / "evidence"
index = read(evidence / "index.json")
expectations = read(core / "expectations.json")
require(len(index["current"]) == 84, "核心当前记录不是 84 项")
require({x["profile"] for x in index["current"]} == set(expectations), "核心 profile 集合不一致")
for name, expected in index["model_inputs"].items():
    check_hash(core / "model" / name, expected)

profile_results = []
for entry in index["current"]:
    name = entry["profile"]
    expected = expectations[name]
    for item in entry["files"].values():
        check_hash(evidence / item["path"], item["sha256"])
    check_hash(evidence / entry["manifest"], entry["manifest_sha256"])
    manifest = read(evidence / entry["manifest"])
    configured = manifest["profiles"][name]
    result = read(evidence / entry["files"]["result.json"]["path"])
    messages = read(evidence / entry["files"]["messages.json"]["path"])
    for item in result["inputs"]["files"]:
        check_hash(evidence / entry["input_snapshot"] / item["path"], item["sha256"])
        require(index["model_inputs"].get(item["path"]) == item["sha256"], f"运行输入与当前模型不符：{name}/{item['path']}")
    require(result["inputs"]["manifest_sha256"] == entry["manifest_sha256"], f"运行 manifest 不符：{name}")
    require(result["profile"] == name and result["run_id"] == entry["run_id"], f"运行身份不符：{name}")
    require(result["status"] == expected["status"] == entry["status"], f"运行状态不符：{name}")
    require(result["process"]["exit_code"] == expected["raw_exit"] == entry["raw_exit"], f"原始退出码不符：{name}")
    require(not result["process"]["timed_out"] and not result["process"]["interrupted"], f"当前记录未完整执行：{name}")
    require(result["checks"]["configured_invariants"] == expected["invariants"], f"目标不变量不符：{name}")
    require(result["checks"]["configured_properties"] == expected["properties"], f"目标活性性质不符：{name}")
    minimum = expected["distinct_state_min"]
    require(configured["scope"]["distinct_state_min"] == minimum == entry["minimum_declared_before_run"], f"预声明最小状态数不符：{name}")
    require(result["statistics"]["distinct_states"] >= minimum, f"探索状态数不足：{name}")
    require(result["statistics"] == entry["statistics"], f"索引与原始状态数不符：{name}")
    require(result["checks"]["checks_deadlock"] is True, f"未启用死锁检查：{name}")
    require(configured["workers"] == 1 and configured["heap_mb"] == 1024, f"运行资源声明不符：{name}")
    if expected["status"] == "PASS_WITHIN_SCOPE":
        require(result["completed"] is True and result["statistics"]["remaining_states"] == 0, f"正向模型未穷尽：{name}")
    elif expected["raw_exit"] == 12:
        target = expected["invariants"][0]
        require(any(m.get("text") == f"Invariant {target} is violated." for m in messages), f"反例未命中声明性质：{name}")
    elif expected["raw_exit"] == 13:
        require(2116 in result["error_codes"], f"缺少真实时序违反：{name}")
    elif expected["raw_exit"] == 11:
        require(any(m.get("text") == "Deadlock reached." for m in messages), f"缺少真实死锁：{name}")
    profile_results.append({"profile": name, "status": result["status"], "rawExit": result["process"]["exit_code"], "distinctStates": result["statistics"]["distinct_states"], "minimum": minimum})

# 当前候选整套检查的命令、计数和摘要。测试断言已由本审查逐项阅读，计数本身不代替需求覆盖。
check_results = []
for name, expected_count in [("backend", 106), ("protocol", 23), ("content", 8), ("frontend", 53), ("build", None), ("generated", None), ("schema", None)]:
    directory = ROOT / ".agent-output/final-checks" / name
    command = read(directory / "command.json")
    require(command["sourceCommit"] == EXPECTED_COMMIT and command["sourceTree"] == EXPECTED_TREE, f"检查候选不符：{name}")
    require(command["rawStatus"] == "completed" and command["exitCode"] == 0, f"检查未通过：{name}")
    log = (directory / "command.log").read_text()
    if expected_count is not None:
        for label, value in [("tests", expected_count), ("pass", expected_count), ("fail", 0), ("skipped", 0)]:
            require(re.search(rf"^[#ℹ] {label} {value}$", log, re.M) is not None, f"测试汇总不符：{name}/{label}")
    for file in [directory / "command.json", directory / "command.log"]:
        checked_files[str(file.relative_to(ROOT))] = digest(file)
    check_results.append({"name": name, "tests": expected_count, "exitCode": command["exitCode"], "elapsedMs": command["elapsedMs"]})

executions = []
for directory_name in ["mock-integration-r2", "final-browser", "mock-network-900"]:
    directory = ROOT / ".agent-output" / directory_name
    if not (directory / "result.json").exists():
        executions.append({"name": directory_name, "status": "尚未产生最终结果"})
        continue
    result = read(directory / "result.json")
    source = result["source"]
    require(source["commit"] == EXPECTED_COMMIT and source["tree"] == EXPECTED_TREE and source["status"] == "", f"执行候选不符：{directory_name}")
    for name, expected in source["sourceHashes"].items():
        check_hash(ROOT / name, expected)
    require(result["assessment"] == "PASS", f"执行未通过：{directory_name}")
    require(result["resourcesClosed"] is True, f"执行清理不符：{directory_name}")
    if "sourceUnchanged" in result:
        require(result["sourceUnchanged"] is True, f"执行源码检查不符：{directory_name}")
    for key in ["databaseErrors", "pageErrors"]:
        if key in result:
            require(result[key] == [], f"存在运行错误：{directory_name}/{key}")
    require(result.get("externalModelCalls", 0) == 0, f"外部模型调用数非零：{directory_name}")
    command = read(directory / "command.json")
    require(command["sourceCommit"] == EXPECTED_COMMIT and command["sourceTree"] == EXPECTED_TREE, f"执行命令候选不符：{directory_name}")
    require(command["rawStatus"] == "completed" and command["exitCode"] == 0, f"执行命令未通过：{directory_name}")
    for file in [directory / "command.json", directory / "result.json"]:
        checked_files[str(file.relative_to(ROOT))] = digest(file)
    executions.append({"name": directory_name, "assessment": result["assessment"], "sourceHashCount": len(source["sourceHashes"]), "sourceUnchangedFlag": result.get("sourceUnchanged"), "elapsedMs": result.get("actualElapsedMs", result.get("actualDurationMs", result.get("elapsedMs"))), "resultSha256": digest(directory / "result.json")})

summary = {
    "recordedAt": datetime.now(timezone.utc).isoformat(),
    "identity": identity,
    "coreTree": git("rev-parse", "HEAD:formal/core-rebuild"),
    "coreInputs": len(index["model_inputs"]),
    "coreProfiles": len(profile_results),
    "coreResultClasses": dict(Counter(x["status"] for x in profile_results)),
    "coreProfileResults": profile_results,
    "checks": check_results,
    "executions": executions,
    "checkedFileCount": len(checked_files),
    "checkedFiles": checked_files,
    "errors": errors,
    "auditStatus": "PASS" if not errors else "FAIL",
    "scope": "独立摘要与原始结果核验；不表示本审查重跑 TLC 或所有业务测试；长测与归档未齐时不得据此作整体 PASS。",
}
(OUT / "evidence-integrity.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({key: summary[key] for key in ["identity", "coreTree", "coreInputs", "coreProfiles", "coreResultClasses", "checks", "executions", "checkedFileCount", "errors", "auditStatus"]}, ensure_ascii=False, indent=2))
raise SystemExit(bool(errors))
