#!/usr/bin/env python3
"""执行固定 TLC 清单并审计原始结果；不运行业务实现，不把预期反例改写为 PASS。"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
REPOSITORY = ROOT.parent.parent
RUNNER = REPOSITORY / ".agents/skills/worker-tla/scripts/run_tlc.py"


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inspect(name: str, directory: Path, expected: dict, input_hashes: dict) -> dict:
    result = json.loads((directory / "result.json").read_text())
    messages = json.loads((directory / "messages.json").read_text())
    errors = []
    def require(condition: bool, problem: str) -> None:
        if not condition:
            errors.append(problem)
    require(result.get("status") == expected["status"], "原始状态不符")
    process = result.get("process", {})
    require(process.get("exit_code") == expected["raw_exit"], "TLC 原始退出码不符")
    require(not process.get("timed_out") and not process.get("interrupted"), "执行超时或中断")
    require(result.get("implementation_status") == "NOT_ASSESSED", "实现边界被改写")
    require(result.get("mode") == "modelcheck", "未使用模型检查")
    require(any("Running breadth-first search Model-Checking" in m["text"] for m in messages), "未确认 BFS")
    checks = result.get("checks", {})
    require(checks.get("checks_deadlock") is True, "未检查死锁")
    for label in ["invariants", "properties"]:
        require(checks.get("configured_" + label) == expected[label], "配置性质清单不符")
        require(checks.get("expected_" + label) == expected[label], "预期性质清单不符")
    actual_inputs = {entry["path"]: entry["sha256"] for entry in result.get("inputs", {}).get("files", [])}
    require(actual_inputs == input_hashes, "运行输入与当前冻结输入不符")
    stats = result.get("statistics", {})
    distinct = stats.get("distinct_states")
    require(isinstance(distinct, int) and distinct >= expected["distinct_state_min"], "未达到预先声明的 distinct 下限")
    if expected["status"] == "PASS_WITHIN_SCOPE":
        require(result.get("completed") is True and stats.get("remaining_states") == 0, "正向探索未完整收束")
        require(not result.get("error_codes"), "正向出现 TLC 错误消息")
    elif expected["raw_exit"] == 12:
        target = expected["invariants"][0]
        require(any(m.get("code") == 2110 and m["text"].strip() == f"Invariant {target} is violated." for m in messages), "没有命中目标不变量")
        require(any(m.get("code") == 2217 for m in messages), "缺少反例轨迹")
    elif expected["raw_exit"] == 13:
        require(any("Temporal properties were violated" in m["text"] for m in messages), "没有实际活性违反")
        require(any(m.get("code") in {2122, 2218} or "Back to state" in m["text"] or "Stuttering" in m["text"] for m in messages), "缺少活性循环/停滞证据")
    elif expected["raw_exit"] == 11:
        require(any("Deadlock reached" in m["text"] for m in messages), "没有实际死锁")
    return {
        "profile": name, "audit_pass": not errors, "errors": errors,
        "status": result.get("status"), "reason": result.get("reason"),
        "raw_exit": process.get("exit_code"), "statistics": stats,
        "duration_seconds": result.get("duration_seconds"),
        "minimum_declared_before_run": expected["distinct_state_min"],
        "invariants": expected["invariants"], "properties": expected["properties"],
        "run_id": result.get("run_id"),
        "result_sha256": sha(directory / "result.json"),
        "log_sha256": sha(directory / "tlc.log"),
        "messages_sha256": sha(directory / "messages.json"),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jar", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--profile", action="append", default=[])
    parser.add_argument("--jobs", type=int, default=2, choices=[1, 2])
    args = parser.parse_args()
    output = args.out.resolve()
    output.mkdir(parents=True, exist_ok=False)
    expected = json.loads((ROOT / "expectations.json").read_text())
    names = args.profile or list(expected)
    if len(set(names)) != len(names) or any(name not in expected for name in names):
        raise ValueError("profile 名称无效或重复")
    input_hashes = {str(path.relative_to(ROOT / "model")): sha(path)
                    for path in sorted((ROOT / "model").rglob("*")) if path.is_file()}
    evidence = {
        "schema_version": 1, "implementation_status": "NOT_ASSESSED",
        "manifest_sha256": sha(ROOT / "verification.json"),
        "expectations_sha256": sha(ROOT / "expectations.json"),
        "runner_sha256": sha(RUNNER), "model_inputs": input_hashes,
        "selected_profiles": names,
    }
    (output / "batch-inputs.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n")
    def execute(name: str) -> dict:
        command = [sys.executable, str(RUNNER), "--manifest", str(ROOT / "verification.json"),
                   "--profile", name, "--jar", str(args.jar.resolve()), "--out", str(output / name)]
        completed = subprocess.run(command, text=True, capture_output=True, check=False)
        directory = output / name
        (directory / "runner-console.txt").write_text(completed.stdout + completed.stderr)
        try:
            row = inspect(name, directory, expected[name], input_hashes)
        except (OSError, ValueError, KeyError) as error:
            row = {"profile": name, "audit_pass": False, "errors": [str(error)]}
        row["runner_exit"] = completed.returncode
        required_runner = 0 if expected[name]["status"] == "PASS_WITHIN_SCOPE" else 2
        if completed.returncode != required_runner:
            row["audit_pass"] = False
            row["errors"].append("runner 退出码不符")
        return row
    rows = []
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        tasks = {pool.submit(execute, name): name for name in names}
        for future in as_completed(tasks):
            row = future.result()
            rows.append(row)
            print(json.dumps(row, ensure_ascii=False), flush=True)
            report = {**evidence, "complete": len(rows) == len(names),
                      "audit_pass": len(rows) == len(names) and all(row["audit_pass"] for row in rows),
                      "results": sorted(rows, key=lambda row: row["profile"])}
            (output / "audit.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    return 0 if all(row["audit_pass"] for row in rows) else 1


if __name__ == "__main__":
    raise SystemExit(main())
