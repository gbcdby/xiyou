"""独立 JSON Schema 实现与固定样本交叉检查；不检查服务端权限。"""
import hashlib
import json
from pathlib import Path
import sys

from jsonschema import Draft202012Validator
# 检查辅助模块不向源码目录写临时字节码。
sys.dont_write_bytecode = True
from utc_time import utc_format_checker

root = Path(__file__).resolve().parent.parent
schema = json.loads((root / "contracts.schema.json").read_text())
valid = json.loads((root / "fixtures/valid-v1.json").read_text())
invalid = json.loads((root / "fixtures/invalid-v1.json").read_text())
vector = json.loads((root / "fixtures/digest-v1.json").read_text())
dates = json.loads((root / "fixtures/dates-v1.json").read_text())
format_checker = utc_format_checker()
Draft202012Validator.check_schema(schema)

def validator(name):
    return Draft202012Validator(
        {"$schema": schema["$schema"], "$defs": schema["$defs"], "$ref": "#/$defs/" + name},
        format_checker=format_checker,
    )

for name, value in valid.items():
    validator(name).validate(value)
for sample in invalid:
    if validator(sample["contract"]).is_valid(sample["value"]):
        sys.exit("反向结构样本未被拒绝：" + sample["name"])
for sample in dates:
    value = {**valid['WorldEvent'], 'serverTime': sample['value']}
    if validator('WorldEvent').is_valid(value) != sample['valid']:
        sys.exit('UTC 日历边界不符合预期：' + sample['value'])
semantic = {key: value for key, value in valid["ClientAction"].items() if key != "clientActionId"}
canonical = json.dumps(semantic, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
assert canonical == vector["canonical"]
assert hashlib.sha256(canonical.encode("utf-8")).hexdigest() == vector["sha256"]
print(f"JSON Schema 2020-12 合法；{len(valid)} 个正样本和 {len(invalid)} 个反样本符合预期；{len(dates)} 个 UTC 日历边界与独立摘要向量一致。")

# A3 空间模型是独立合同；沿用现有 CI 入口，保留旧合同检查。
import runpy
runpy.run_path(str(root / "scripts/check-spatial-ai.py"), run_name="__main__")
