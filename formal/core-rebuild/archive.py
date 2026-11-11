#!/usr/bin/env python3
"""归档本轮合成模型的原始结果；去重输入快照，保持结果与日志字节不变。"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil

from check import ROOT, inspect, sha


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch", type=Path, action="append", required=True)
    parser.add_argument("--history", type=Path, action="append", default=[])
    parser.add_argument("--out", type=Path, default=ROOT / "evidence")
    args = parser.parse_args()
    output = args.out.resolve()
    output.mkdir(parents=True, exist_ok=False)
    expected = json.loads((ROOT / "expectations.json").read_text())
    current_manifest = json.loads((ROOT / "verification.json").read_text())
    input_hashes = {str(path.relative_to(ROOT / "model")): sha(path)
                    for path in sorted((ROOT / "model").rglob("*")) if path.is_file()}
    selected = {}
    for batch in args.batch:
        audit = json.loads((batch / "audit.json").read_text())
        if not audit.get("complete"):
            raise ValueError(f"批次尚未结束：{batch.name}")
        for row in audit["results"]:
            selected[row["profile"]] = batch / row["profile"]
    if set(selected) != set(expected):
        raise ValueError("正式结果没有完整覆盖预声明清单")
    index = {"schema_version": 1, "implementation_status": "NOT_ASSESSED",
             "model_inputs": input_hashes, "current": [], "history": []}

    def archive_run(label: str, directory: Path, category: str) -> dict:
        result_path = directory / "result.json"
        result = json.loads(result_path.read_text())
        target = output / category / label
        target.mkdir(parents=True, exist_ok=False)
        archived = {}
        for name in ["result.json", "tlc.log", "messages.json", "runner-console.txt"]:
            source = directory / name
            if source.exists():
                shutil.copyfile(source, target / name)
                archived[name] = {"path": str((target / name).relative_to(output)), "sha256": sha(source)}
        record = {"label": label, "profile": result.get("profile"),
                  "status": result.get("status"), "reason": result.get("reason"),
                  "raw_exit": result.get("process", {}).get("exit_code"),
                  "statistics": result.get("statistics", {}), "files": archived}
        source_manifest = directory / "manifest.json"
        if source_manifest.exists():
            digest = sha(source_manifest)
            manifest = output / "manifests" / (digest + ".json")
            manifest.parent.mkdir(exist_ok=True)
            if not manifest.exists():
                shutil.copyfile(source_manifest, manifest)
            record["manifest"] = str(manifest.relative_to(output))
            record["manifest_sha256"] = digest
        files = result.get("inputs", {}).get("files", [])
        if files:
            encoded = json.dumps(files, sort_keys=True, separators=(",", ":")).encode()
            key = hashlib.sha256(encoded).hexdigest()
            snapshot = output / "inputs" / key
            snapshot.mkdir(parents=True, exist_ok=True)
            for entry in files:
                source = directory / "input" / entry["path"]
                if sha(source) != entry["sha256"]:
                    raise ValueError(f"输入快照摘要不符：{label}/{entry['path']}")
                destination = snapshot / entry["path"]
                destination.parent.mkdir(parents=True, exist_ok=True)
                if not destination.exists():
                    shutil.copyfile(source, destination)
                elif sha(destination) != entry["sha256"]:
                    raise ValueError("相同快照键具有不同内容")
            record["input_snapshot"] = str(snapshot.relative_to(output))
        return record

    rows = []
    for name in expected:
        directory = selected[name]
        row = inspect(name, directory, expected[name], input_hashes)
        if not row["audit_pass"]:
            raise ValueError(f"正式配置未满足判据：{name}: {row['errors']}")
        source_manifest = json.loads((directory / "manifest.json").read_text())
        if source_manifest["profiles"][name] != current_manifest["profiles"][name]:
            raise ValueError(f"实际生效 profile 与当前清单不同：{name}")
        record = archive_run(name, directory, "current")
        rows.append({**row, **record})
    index["current"] = rows
    for source in args.history:
        if (source / "audit.json").exists():
            audit = json.loads((source / "audit.json").read_text())
            target = output / "history" / source.name
            target.mkdir(parents=True, exist_ok=False)
            shutil.copyfile(source / "audit.json", target / "audit.json")
            for row in audit["results"]:
                directory = source / row["profile"]
                label = source.name + "/runs/" + row["profile"]
                index["history"].append(archive_run(label, directory, "history"))
        elif (source / "result.json").exists():
            index["history"].append(archive_run(source.name, source, "history"))
        else:
            raise ValueError(f"历史输入缺少结果：{source.name}")
    index["complete"] = True
    index["audit_pass"] = all(row["audit_pass"] for row in rows)
    (output / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"formal_runs": len(rows), "history_runs": len(index["history"]),
                      "audit_pass": index["audit_pass"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
