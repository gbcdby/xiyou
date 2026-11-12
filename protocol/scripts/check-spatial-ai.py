"""Python 独立 Schema、严格原文及与 JavaScript 固定摘要的交叉检查。"""
import json
import hashlib
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True
root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root))
from jsonschema import Draft202012Validator
from protocol.spatial_ai import SCHEMA, SpatialAIContractError, parse_spatial_proposed_intent, spatial_intent_semantic_digest

Draft202012Validator.check_schema(SCHEMA)
fixture = json.loads((root / "protocol/fixtures/spatial-ai-v2.json").read_text(encoding="utf-8"))
for sample in fixture["validIntents"]:
    raw = json.dumps(sample, ensure_ascii=False)
    assert parse_spatial_proposed_intent(raw, "decision-one") == sample
    js = "import {spatialIntentSemanticDigestSync} from './protocol/spatial-ai-node.mjs';process.stdout.write(spatialIntentSemanticDigestSync(JSON.parse(process.argv[1])));"
    expected = subprocess.check_output(["node", "--input-type=module", "-e", js, raw], cwd=root, text=True)
    assert spatial_intent_semantic_digest(sample) == expected
valid = json.dumps(fixture["validIntents"][0])
bad = [
    valid.replace('"schemaVersion": 2', '"schemaVersion": 2, "schemaVersion": 2'),
    valid.replace('"wait"', '"advance_world"'),
    valid[:-1] + ',"actorId":"hidden"}',
    valid.replace('"decision-one"', '"other"'),
    valid.replace('"wait"', '"wait", "controlEpoch":"1"'),
    valid + " " * 65536,
    '{"schemaVersion":2,"decisionId":"decision-one","toolCalls":[{"kind":"speak","text":"x","channel":"team","recipientRefs":[]}]}',
    '{"schemaVersion":2,"decisionId":"decision-one","toolCalls":[{"kind":"speak","text":"\\ud800","channel":"public","recipientRefs":[]}]}',
    '{"schemaVersion":2,"decisionId":"decision-one","toolCalls":[{"kind":"move_to","sceneId":"yard","destination":{"x":1.00000000000000001,"y":0}}]}',
    '{"schemaVersion":2,"decisionId":"decision-one","toolCalls":[{"kind":"move_to","sceneId":"yard","destination":{"x":1e-400,"y":0}}]}',
]
for raw in bad:
    try:
        parse_spatial_proposed_intent(raw, "decision-one")
    except SpatialAIContractError:
        pass
    else:
        raise AssertionError("Python 空间模型反例未拒绝")
print(f"空间模型 Python 绑定：{len(fixture['validIntents'])} 个正样本、{len(bad)} 个反例、跨语言摘要均通过。")

# R-34-PROTO-STD-001：以原文进入两端严格解析器，不先用 JSON.parse 舍入数词。
numbers = json.loads((root / "protocol/fixtures/spatial-ai-numbers-v2.json").read_text(encoding="utf-8"))
raw_numbers = ['{"schemaVersion":2,"decisionId":"d","toolCalls":[{"kind":"move_to","sceneId":"yard","destination":{"x":' + sample["token"] + ',"y":0}}]}' for sample in numbers]
js_numbers = """
import {readFileSync} from 'node:fs';
import {parseSpatialProposedIntent,spatialIntentSemanticDigestSync} from './protocol/spatial-ai-node.mjs';
const results=JSON.parse(readFileSync(0,'utf8')).map(raw=>{
  try {const value=parseSpatialProposedIntent(raw,'d');return {valid:true,value:value.toolCalls[0].destination.x,digest:spatialIntentSemanticDigestSync(value)};}
  catch(error) {return {valid:false,code:error.code};}
});
process.stdout.write(JSON.stringify(results));
"""
js_results = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", js_numbers], input=json.dumps(raw_numbers), cwd=root, text=True))
failures = []
for sample, raw, js_result in zip(numbers, raw_numbers, js_results, strict=True):
    try:
        value = parse_spatial_proposed_intent(raw, "d")
        py_result = {"valid": True, "value": value["toolCalls"][0]["destination"]["x"], "digest": spatial_intent_semantic_digest(value)}
    except SpatialAIContractError as error:
        py_result = {"valid": False, "code": error.code}
    except Exception as error:
        py_result = {"valid": False, "unexpectedError": type(error).__name__}
    if sample["valid"]:
        expected_value = {"schemaVersion": 2, "decisionId": "d", "toolCalls": [{"kind": "move_to", "sceneId": "yard", "destination": {"x": sample["value"], "y": 0}}]}
        expected_digest = hashlib.sha256(json.dumps(expected_value, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
        expected = {"valid": True, "value": sample["value"], "digest": expected_digest}
    else:
        expected = {"valid": False, "code": "INVALID_MESSAGE"}
    if js_result != expected or py_result != expected:
        failures.append({"token": sample["token"], "expected": expected, "js": js_result, "python": py_result})
assert not failures, "空间模型数词与摘要不一致：" + json.dumps(failures, ensure_ascii=False)
print(f"空间模型数词边界：{len(numbers)} 个严格原文样本的 JS/Python 接受、拒绝与完整意图摘要一致。")
