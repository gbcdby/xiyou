-- 目标来源是内部元数据；世界 Goal 继续由既有事件与 reducer 回放。
CREATE TABLE IF NOT EXISTS ai_goal_sources (
  session_id text NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  principal_kind text NOT NULL CHECK (principal_kind IN ('core_npc', 'proxy')),
  goal_id text NOT NULL,
  source jsonb NOT NULL,
  PRIMARY KEY (session_id, actor_id, principal_kind, goal_id)
);

-- 每个 Decision 至多预留一次模型调用；原始有效输出在提交前持久化以恢复未知结果。
CREATE TABLE IF NOT EXISTS ai_runs (
  session_id text NOT NULL,
  decision_id text NOT NULL,
  actor_id text NOT NULL,
  principal_kind text NOT NULL CHECK (principal_kind IN ('core_npc', 'proxy')),
  context jsonb NOT NULL,
  context_digest text NOT NULL,
  configuration jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('Reserved','Ready','Resolved')),
  output_raw text,
  semantic_digest text,
  model_result jsonb,
  outcome jsonb,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (session_id, decision_id),
  FOREIGN KEY (session_id, decision_id) REFERENCES decisions(session_id, decision_id) ON DELETE CASCADE
);
