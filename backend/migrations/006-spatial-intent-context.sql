-- 内部意图的执行来源与技术降级原因独立保存，不进入外部PublicEnvelope。
ALTER TABLE spatial_intents ADD COLUMN IF NOT EXISTS execution_context jsonb NOT NULL DEFAULT '{"mode":"intent"}'::jsonb;
-- 新增非移动意图可能含NUL；复用现有可逆文本编码，旧导航行保持原值。
ALTER TABLE spatial_intents ADD COLUMN IF NOT EXISTS request_text_encoding text
  CHECK (request_text_encoding IS NULL OR request_text_encoding = 'nul-escaped-v1');
