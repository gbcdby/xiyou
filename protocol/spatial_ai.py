"""空间模型的 Python 消费边界；授权与权威提交仍由服务端负责。"""
import hashlib
import json
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import cast

from jsonschema import Draft202012Validator
from .spatial_ai_types import SpatialProposedIntentV2

SCHEMA = json.loads(Path(__file__).with_name("spatial-ai.schema.json").read_text(encoding="utf-8"))


class SpatialAIContractError(ValueError):
    code = "INVALID_MESSAGE"


def _fail():
    raise SpatialAIContractError("消息不符合空间模型合同")


def _integer(token):
    # json.loads 已核对数词语法；全零系数不受 Decimal 的指数表示范围限制。
    coefficient = token.lower().partition("e")[0]
    if coefficient.lstrip("-").replace(".", "").strip("0") == "":
        return 0
    try:
        value = Decimal(token)
        if not value.is_finite() or value != value.to_integral_value() or value.copy_abs() > 9007199254740991:
            _fail()
        return int(value)
    except (InvalidOperation, ValueError, OverflowError):
        _fail()


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            _fail()
        result[key] = value
    return result


def _check_json(value, depth=0, seen=None):
    if depth > 32:
        _fail()
    if value is None or type(value) is bool:
        return
    if type(value) is str:
        try:
            value.encode("utf-8")
        except UnicodeError:
            _fail()
        return
    if type(value) is int:
        if abs(value) > 9007199254740991:
            _fail()
        return
    if type(value) not in (dict, list):
        _fail()
    seen = set() if seen is None else seen
    if id(value) in seen:
        _fail()
    seen.add(id(value))
    if isinstance(value, dict):
        for key, child in value.items():
            if type(key) is not str or key in ("__proto__", "prototype", "constructor"):
                _fail()
            _check_json(key, depth + 1, seen)
            _check_json(child, depth + 1, seen)
    else:
        for child in value:
            _check_json(child, depth + 1, seen)
    seen.remove(id(value))


def validate_spatial_ai(name, value):
    _check_json(value)
    if name not in SCHEMA["$defs"]:
        _fail()
    schema = {"$schema": SCHEMA["$schema"], "$defs": SCHEMA["$defs"], "$ref": "#/$defs/" + name}
    if not Draft202012Validator(schema).is_valid(value):
        _fail()
    actions = value["toolCalls"] if name == "SpatialProposedIntentV2" else [value] if name == "SpatialModelActionV2" else []
    for action in actions:
        if action["kind"] in ("speak", "make_claim") and ((action["channel"] == "public") != (len(action["recipientRefs"]) == 0)):
            _fail()
    if name in ("SpatialContextV2", "SpatialDecisionContextV2"):
        projection = value["projection"]
        if any(claim["channel"] == "team" for claim in projection["claims"]):
            _fail()
        observations = {item["observationRef"] for item in projection["observations"]}
        objectives = {item["objectiveId"] for item in projection["objectives"]}
        goals = value.get("goals", [])
        if len({goal["goalId"] for goal in goals}) != len(goals):
            _fail()
        for goal in goals:
            if any(ref not in observations for ref in goal["basedOnObservationRefs"]) or ("objectiveId" in goal and goal["objectiveId"] not in objectives):
                _fail()
    return value


def parse_spatial_proposed_intent(raw: str, expected_decision_id: str) -> SpatialProposedIntentV2:
    """严格解析原文、输出结构与决定身份；不以形状正确代替当前工具授权。"""
    try:
        if not isinstance(raw, str) or len(raw.encode("utf-8")) > 65536:
            _fail()
        value = json.loads(raw, object_pairs_hook=_pairs, parse_int=_integer, parse_float=_integer, parse_constant=lambda _: _fail())
    except (ValueError, UnicodeError, RecursionError):
        _fail()
    validate_spatial_ai("SpatialProposedIntentV2", value)
    if value["decisionId"] != expected_decision_id:
        _fail()
    return cast(SpatialProposedIntentV2, value)


def _canonical(value):
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(key, ensure_ascii=False) + ":" + _canonical(value[key]) for key in sorted(value, key=lambda key: key.encode("utf-16-be"))) + "}"
    if isinstance(value, list):
        return "[" + ",".join(_canonical(item) for item in value) + "]"
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def spatial_intent_semantic_digest(value: SpatialProposedIntentV2) -> str:
    validate_spatial_ai("SpatialProposedIntentV2", value)
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()
