#!/usr/bin/env python3
"""独立核验本次新合成长测原记录，报告只保留断言摘要与必要身份。"""
import gzip
import hashlib
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
directory = ROOT / ".agent-output/mock-network-900"
report = json.loads((directory / "result.json").read_text())
raw_compressed = (directory / report["trace"]["file"]).read_bytes()
raw = gzip.decompress(raw_compressed)
rows = [json.loads(line) for line in raw.decode().splitlines()]
errors = []


def require(ok, message):
    if not ok:
        errors.append(message)


sha = lambda value: hashlib.sha256(value).hexdigest()
require(sha(raw_compressed) == report["trace"]["sha256"], "压缩新 trace 摘要不符")
require(sha(raw) == report["trace"]["uncompressedSha256"], "原新 trace 摘要不符")
require(len(raw) == report["trace"]["bytes"], "原 trace 长度不符")
require(len(rows) == report["trace"]["records"] == 17776, "原 trace 记录数不符")
require([r["index"] for r in rows] == list(range(1, len(rows) + 1)), "记录索引不连续")
require(report["requestedDurationMs"] == 900000 and report["actualDurationMs"] >= 900000, "未取得真实 900 秒")
require(len({r["userId"] for r in report["identities"]}) == len({r["actorId"] for r in report["identities"]}) == 5, "五个独立身份不符")

outbound = {}
inbound = {}
for row in rows:
    if row.get("event") != "player.action.request":
        continue
    if row["kind"] == "outbound":
        request = json.loads(row["value"])
        outbound.setdefault(request["clientActionId"], []).append((row, request))
    elif row["kind"] == "inbound" and "clientActionId" in row["value"]:
        inbound.setdefault(row["value"]["clientActionId"], []).append(row)

windows = []
actor_ids = {r["actorId"] for r in report["identities"]}
require([w["window"] for w in report["roleOpportunityWindows"]] == list(range(8)), "120 秒窗口不完整")
for window in report["roleOpportunityWindows"]:
    start = window["window"] * 120000
    require(window["fromMs"] == start <= window["checkedAtMs"] < start + 120000, "职责窗口实际时刻不符")
    require([c["role"] for c in window["choices"]] == list("ABCDE"), "窗口没有覆盖五职责")
    require(len({c["actorId"] for c in window["choices"]}) == 5, "窗口职责不是五个独立角色")
    action_ids = []
    for choice in window["choices"]:
        require(choice["actorId"] in actor_ids, "职责角色不属于长测局")
        require(start <= choice["elapsedMs"] < start + 120000, "职责动作不在相应窗口")
        action_id = choice["actionId"]
        requests = outbound.get(action_id, [])
        receipts = inbound.get(action_id, [])
        require(len(requests) == 1, "职责检查动作没有唯一实际发送")
        if requests:
            record, request = requests[0]
            require(request["actorId"] == choice["actorId"] and request["sessionId"] == report["sessionId"], "职责请求身份不符")
            require(request["action"] == {"kind": "inspect", "targetId": choice["targetId"]}, "职责检查不是声明的实际动作")
            require(sha(record["value"].encode()) == record["digest"], "职责实际发送字节摘要不符")
        require(choice["receipt"]["status"] == "Accepted" and choice["receipt"]["clientActionId"] == action_id, "职责 Receipt 不符")
        require(any(r["value"] == choice["receipt"] for r in receipts), "职责结果没有实际入站 Receipt")
        action_ids.append(action_id)
    windows.append({"window": window["window"], "checkedAtMs": window["checkedAtMs"], "roles": list("ABCDE"), "actualRequestsAndReceipts": len(action_ids)})

checkpoints = [r for r in rows if r["kind"] == "checkpoint"]
require(len(checkpoints) == len(report["checkpoints"]) == 25, "检查点数量不符")
for recorded, summarized in zip(checkpoints, report["checkpoints"]):
    require(recorded["label"] == summarized["label"] and recorded["cursor"] == summarized["cursor"], "检查点身份不符")
    require(recorded["comparisons"] == summarized["comparisons"], "检查点逐人比较不符")
    require(recorded["replayDigest"] == summarized["stateDigest"], "检查点回放摘要不符")
    require(recorded["storedAtSameCursor"] is True, "检查点未同时比较持久状态")
    require(len(recorded["comparisons"]) == 5, "检查点没有五份比较")
    require({p["actorId"] for p in recorded["comparisons"]} == actor_ids, "检查点角色集合改变")
    require(all(p["cursor"] == recorded["cursor"] for p in recorded["comparisons"]), "检查点游标不一致")
require(checkpoints[-1]["cursor"] == report["final"]["cursor"] == str(report["final"]["eventCount"]) == "410", "最终 head / 事件数不符")
require(checkpoints[-1]["replayDigest"] == report["final"]["stateDigest"], "最终持久回放摘要不符")

retry_case = next(c for c in report["cases"] if "ACK 扣留" in c["name"])
requests = outbound[retry_case["actionId"]]
require(len(requests) == 2, "原字节重试不是两次发送")
require(all(r[0]["value"] == retry_case["raw"] for r in requests), "重试原文改变")
require([r[0]["index"] for r in requests] == retry_case["outboundIndexes"], "重试原文记录位置不符")
require(sha(retry_case["raw"].encode()) == retry_case["rawDigest"], "原文重试摘要不符")
require(retry_case["proxyAfterMs"] >= 30000 and retry_case["effectCount"] == 1, "真实 Grace 时长或一次效果不符")
require(any(r["value"] == retry_case["receipt"] for r in inbound[retry_case["actionId"]]), "原文重试没有实际 Receipt")

result = {
    "assessment": "PASS" if not errors else "FAIL",
    "sourceCommit": report["source"]["commit"],
    "sourceTree": report["source"]["tree"],
    "actualDurationMs": report["actualDurationMs"],
    "traceRecords": len(rows),
    "traceSha256": sha(raw_compressed),
    "rawTraceSha256": sha(raw),
    "recordKinds": dict(Counter(r["kind"] for r in rows)),
    "roleWindows": windows,
    "actualRoleRequestsAndReceipts": 40,
    "checkpoints": len(checkpoints),
    "projectionComparisons": sum(len(c["comparisons"]) for c in checkpoints),
    "allCheckpointsComparedStoredState": all(c["storedAtSameCursor"] for c in checkpoints),
    "retry": {"sends": len(requests), "sameRaw": True, "proxyAfterMs": retry_case["proxyAfterMs"], "effects": retry_case["effectCount"]},
    "final": {k: report["final"][k] for k in ["cursor", "eventCount", "stateDigest", "phase", "contentVersion", "reducerVersion"]},
    "errors": errors,
    "scope": "仅本次 fa87 新合成 trace 的本地独立核验。未复制或重传任何旧被拒绝 trace；不在报告包含全量新 trace；未重跑长测。HTTP 只读投影的 canControl=false 与实际 Socket 控制位分别校验，比较时仅去除此授权上下文字段。",
}
(OUT / "network-audit.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(result, ensure_ascii=False, indent=2))
raise SystemExit(bool(errors))
