"""有限候选的只读冻结入口；不载入监督器，不启动Node或任何产品。"""
from pathlib import Path
import hashlib
import json
import sys
import time
import types

directory = Path(__file__).resolve().parent
repository = directory.parents[2]
manifest_bytes = (directory / 'method-manifest.json').read_bytes()
manifest = json.loads(manifest_bytes)
for item in manifest['files']:
    source = repository / item['path']
    data = source.read_bytes()
    if len(data) != item['bytes'] or hashlib.sha256(data).hexdigest() != item['sha256']:
        raise ValueError('冻结前方法字节不符')
path = directory / 'binding.py'
data = path.read_bytes()
module = types.ModuleType('xiyou_nso_binding_freeze')
module.__file__ = str(path)
module.__package__ = ''
module.__cached__ = module.__loader__ = module.__spec__ = None
sys.modules[module.__name__] = module
exec(compile(data, str(path), 'exec', dont_inherit=True, optimize=0), module.__dict__)
module.require(len(sys.argv) == 1 and sys.flags.isolated == 1, '冻结命令必须是固定Python-I入口')
output = repository.parent / 'runs/finite'
module.require(not output.exists(), '有限输出目录已存在，禁止覆盖或退款')
value = module.make_input('finite', output, deadline=time.monotonic() + 120)
target = repository.parent / 'finite-input.json'
result = module.atomic_json(target, value)
print(json.dumps({'state': 'FROZEN_INPUT_ONLY_NOT_RUN', 'path': str(target), **result}, ensure_ascii=False))
