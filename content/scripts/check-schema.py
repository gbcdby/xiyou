"""用独立 JSON Schema 实现核对配置结构及规范摘要。"""
import copy
import hashlib
import json
from pathlib import Path
from jsonschema import Draft202012Validator

root = Path(__file__).resolve().parent.parent
schema = json.loads((root / 'content.schema.json').read_text())
fixture = json.loads((root / 'fixtures/trust-repair-fixture-v1.json').read_text())
versions = json.loads((root / 'versions.json').read_text())
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema)
validator.validate(fixture)

invalid = []
value = copy.deepcopy(fixture)
value['unknown'] = True
invalid.append(value)
value = copy.deepcopy(fixture)
value['operations'][0]['humanOnly'] = False
invalid.append(value)
value = copy.deepcopy(fixture)
value['timing']['durationSeconds'] = 0
invalid.append(value)
value = copy.deepcopy(fixture)
value['items'][0]['itemId'] += '\n'
invalid.append(value)
for value in invalid:
    assert not validator.is_valid(value), '非法结构样本未被拒绝'

canonical = json.dumps(fixture, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
digest = hashlib.sha256(canonical.encode('utf-8')).hexdigest()
assert digest == versions[fixture['contentVersion']]['sha256'], '内容摘要与固定版本不符'
print('内容 Schema 合法，1 个正样本与 4 个反样本符合预期，独立规范摘要一致。')
