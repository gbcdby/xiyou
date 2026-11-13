-- 原 spatial_intents 同时充当策略步骤账本；不增加世界副本或持久消息队列。
-- 原 request/execution_context 永不回写，单独标记已经核对的原 Receipt。
ALTER TABLE spatial_intents ADD COLUMN IF NOT EXISTS scene_outcome jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS scene_policy_one_pending
  ON spatial_intents(session_id,actor_id)
  WHERE execution_context->>'mode'='scene-policy' AND scene_outcome IS NULL;
