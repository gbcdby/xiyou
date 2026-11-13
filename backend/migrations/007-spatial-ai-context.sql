-- 空间上下文含授权原文；与空间状态相同的可逆编码保留 NUL，旧 region 记录不改写。
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS context_text_encoding text
  CHECK (context_text_encoding IS NULL OR context_text_encoding = 'nul-escaped-v1');
