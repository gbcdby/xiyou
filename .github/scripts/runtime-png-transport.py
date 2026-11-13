#!/usr/bin/env python3
"""仅为两个固定运行背景创建完整 Git blob；不写任何分支引用。"""
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import urllib.error
import urllib.request

REPOSITORY = "gbcdby/xiyou"
BRANCH = "auto/adv001-runtime-png-transport-20261113"
PART_BYTES = 240000
EXPECTED = {
    "courtyard": {
        "target_path": "frontend/public/assets/gaolaozhuang/scenes/courtyard.png",
        "bytes": 3423640,
        "sha256": "f5df307eaea03188e823a279cb3df3a65b1b6a7931c329294cd6b79e4c0d510a",
        "git_blob": "2d6cfd174f9e26b89dedf44a9474d79f99dd3762",
    },
    "village-road": {
        "target_path": "frontend/public/assets/gaolaozhuang/scenes/village-road.png",
        "bytes": 3751410,
        "sha256": "51c77eddb5f29727ab6a324398b71d48bcee1f3a828ae3e470f1e6ae190b5115",
        "git_blob": "309182b1b60721f3fa0567a656f0106b769edaa9",
    },
}
API_BASE = "https://api.github.com/repos/" + REPOSITORY + "/git/blobs"

def require(condition, message):
    if not condition:
        raise ValueError(message)

def blob_sha(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()

def verify_png(data, expected):
    require(data[:8] == b"\x89PNG\r\n\x1a\n", "PNG 签名不符")
    require(len(data) == expected["bytes"], "原始字节长度不符")
    require(hashlib.sha256(data).hexdigest() == expected["sha256"], "原始 SHA256 不符")
    require(blob_sha(data) == expected["git_blob"], "原始 Git blob SHA 不符")

def guard_environment(env, checkout_sha):
    require(env.get("GITHUB_REPOSITORY") == REPOSITORY, "仓库不符")
    require(env.get("GITHUB_REF") == "refs/heads/" + BRANCH, "分支不符")
    require(env.get("GITHUB_EVENT_NAME") == "push", "事件不符")
    require(env.get("GITHUB_RUN_ATTEMPT") == "1", "只允许第一次运行")
    require(env.get("GITHUB_SHA") == checkout_sha and len(checkout_sha) == 40, "实际 checkout 身份不符")

def assemble(root):
    manifest_path = root / "transport/manifest.json"
    require(manifest_path.is_file() and not manifest_path.is_symlink(), "清单缺失或为符号链接")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    require(set(manifest) == {"version", "repository", "branch", "part_bytes", "assets"}, "清单字段不符")
    require(manifest["version"] == 1 and manifest["repository"] == REPOSITORY and manifest["branch"] == BRANCH, "清单身份不符")
    require(manifest["part_bytes"] == PART_BYTES, "分块大小不符")
    require(set(manifest["assets"]) == set(EXPECTED), "只允许两张固定背景")
    expected_parts = set()
    outputs = {}
    for asset_id, expected in EXPECTED.items():
        entry = manifest["assets"][asset_id]
        require(set(entry) == set(expected) | {"parts"}, "图片清单字段不符")
        require(all(entry[k] == v for k, v in expected.items()), "固定图片身份不符")
        count = (expected["bytes"] + PART_BYTES - 1) // PART_BYTES
        require(len(entry["parts"]) == count, "分块数量不符")
        pieces = []
        for i, part in enumerate(entry["parts"]):
            require(set(part) == {"path", "bytes", "sha256", "git_blob"}, "分块字段不符")
            path = f"transport/chunks/{asset_id}/{i:03d}.part"
            require(part["path"] == path, "分块路径或顺序不符")
            length = min(PART_BYTES, expected["bytes"] - i * PART_BYTES)
            require(part["bytes"] == length, "分块长度清单不符")
            file = root / path
            require(file.is_file() and not file.is_symlink(), "分块缺失或为符号链接")
            require(file.resolve().is_relative_to(root.resolve()), "分块越出根目录")
            data = file.read_bytes()
            require(len(data) == length, "分块实际长度不符")
            require(hashlib.sha256(data).hexdigest() == part["sha256"] and blob_sha(data) == part["git_blob"], "分块摘要不符")
            expected_parts.add(path)
            pieces.append(data)
        data = b"".join(pieces)
        verify_png(data, expected)
        outputs[asset_id] = data
    actual_parts = {p.relative_to(root).as_posix() for p in (root / "transport/chunks").rglob("*") if not p.is_dir()}
    require(actual_parts == expected_parts, "发现未声明或缺失分块")
    return outputs

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("拒绝 API 重定向")

def request_api(method, suffix, token, body=None):
    allowed_gets = {"/" + e["git_blob"] for e in EXPECTED.values()}
    require((method == "GET" and suffix in allowed_gets and body is None) or
            (method == "POST" and suffix == "" and isinstance(body, dict) and set(body) == {"encoding", "content"} and body["encoding"] == "base64"), "API 动作超出范围")
    payload = None if body is None else json.dumps(body, separators=(",", ":")).encode("ascii")
    req = urllib.request.Request(API_BASE + suffix, data=payload, method=method, headers={
        "Accept": "application/vnd.github+json",
        "Authorization": "Bearer " + token,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "xiyou-runtime-png-transport",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=30) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        if method == "GET" and error.code == 404:
            return 404, None
        raise RuntimeError(f"固定 Git blob API 返回 HTTP {error.code}") from None

def verify_remote(response, expected, original):
    require(response.get("sha") == expected["git_blob"] and response.get("encoding") == "base64", "远端 blob 身份或编码不符")
    encoded = "".join(response["content"].split())
    data = base64.b64decode(encoded, validate=True)
    verify_png(data, expected)
    require(data == original, "远端原字节回读不一致")

def main():
    root = Path(__file__).resolve().parents[2]
    actual_sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    guard_environment(os.environ, actual_sha)
    images = assemble(root)
    token = os.environ.get("XIYOU_BLOB_TOKEN")
    require(bool(token), "缺少本次作业令牌")
    results = []
    for asset_id, original in images.items():
        expected = EXPECTED[asset_id]
        status, existing = request_api("GET", "/" + expected["git_blob"], token)
        reused = status == 200
        if reused:
            verify_remote(existing, expected, original)
        else:
            status, created = request_api("POST", "", token, {"encoding": "base64", "content": base64.b64encode(original).decode("ascii")})
            require(status == 201 and created.get("sha") == expected["git_blob"], "创建 blob 返回身份不符")
            status, returned = request_api("GET", "/" + expected["git_blob"], token)
            require(status == 200, "创建后回读失败")
            verify_remote(returned, expected, original)
        results.append({"path": expected["target_path"], "bytes": expected["bytes"], "sha256": expected["sha256"], "git_blob": expected["git_blob"], "reused": reused, "readback_exact_bytes_verified": True})
    result = {"repository": REPOSITORY, "transport_commit": actual_sha, "run_id": os.environ.get("GITHUB_RUN_ID"), "attempt": 1, "ref_writes": 0, "assets": results}
    print("XIYOU_RUNTIME_BLOB_RESULT=" + json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    (root / "blob-results.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("## 两张运行背景已按原字节核验\n\n")
            for item in results:
                handle.write(f"- {item['path']}: {item['git_blob']}，{item['bytes']} 字节；创建后回读一致。\n")
            handle.write("\n本作业未写分支引用。\n")

if __name__ == "__main__":
    main()

