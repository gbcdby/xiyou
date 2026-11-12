-- 旧行不重写；只有含 NUL 的空间文档显式标记可逆编码，JSONB 索引字段保持原值。
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS state_text_encoding text
  CHECK (state_text_encoding IS NULL OR state_text_encoding = 'nul-escaped-v1');
ALTER TABLE world_events ADD COLUMN IF NOT EXISTS event_text_encoding text
  CHECK (event_text_encoding IS NULL OR event_text_encoding = 'nul-escaped-v1');
ALTER TABLE command_nonces ADD COLUMN IF NOT EXISTS response_text_encoding text
  CHECK (response_text_encoding IS NULL OR response_text_encoding = 'nul-escaped-v1');
