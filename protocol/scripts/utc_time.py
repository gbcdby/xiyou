"""显式校验协议的 UTC 毫秒时间，不依赖 jsonschema 的可选格式插件。"""
import calendar
import re
from jsonschema import FormatChecker

_UTC = re.compile(r'([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})\.([0-9]{3})Z')


def utc_format_checker():
    checker = FormatChecker(formats=[])

    @checker.checks('date-time', raises=(ValueError, OverflowError))
    def valid_utc(value):
        if not isinstance(value, str):
            return True
        match = _UTC.fullmatch(value)
        if match is None:
            return False
        year, month, day, hour, minute, second, _ = map(int, match.groups())
        if not 1 <= month <= 12:
            return False
        # calendar 使用延展公历，支持与四位年份契约一致的 0000 年。
        days = calendar.monthrange(year, month)[1]
        return 1 <= day <= days and 0 <= hour < 24 and 0 <= minute < 60 and 0 <= second < 60

    if 'date-time' not in checker.checkers:
        raise RuntimeError('UTC 时间格式检查器未启用')
    return checker
