-- output_raw 继续用 text；编码版本区分旧原文和无损 JSON 字符串，不改变世界 JSON 存储。
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS output_encoding text
  CHECK (output_encoding IS NULL OR output_encoding = 'json-string-v1');
