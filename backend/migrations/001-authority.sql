-- 世界状态、连续日志、收据与发布区间共用一个 PostgreSQL 事务。
CREATE TABLE IF NOT EXISTS runtime_users (
  user_id text PRIMARY KEY,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS sessions (
  session_id text PRIMARY KEY,
  host_user_id text NOT NULL REFERENCES runtime_users(user_id),
  name text NOT NULL,
  session_seq numeric NOT NULL CHECK (session_seq >= 0 AND session_seq = trunc(session_seq)),
  state jsonb NOT NULL,
  initial_state jsonb NOT NULL,
  content_snapshot jsonb NOT NULL,
  content_digest text NOT NULL,
  reducer_version text NOT NULL,
  logical_time timestamptz NOT NULL,
  archived boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS session_access (
  session_id text NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES runtime_users(user_id),
  actor_id text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (session_id, user_id),
  UNIQUE (session_id, actor_id)
);
CREATE TABLE IF NOT EXISTS creation_nonces (
  user_id text NOT NULL REFERENCES runtime_users(user_id),
  nonce text NOT NULL,
  content_version text NOT NULL,
  session_id text NOT NULL,
  PRIMARY KEY (user_id, nonce)
);
-- 删除 Session 后仍保留创建记录，因此服务端生成的实例 ID 永不再分配。
CREATE UNIQUE INDEX IF NOT EXISTS creation_nonces_session_id ON creation_nonces(session_id);
CREATE TABLE IF NOT EXISTS command_nonces (
  session_id text NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  principal_id text NOT NULL,
  nonce text NOT NULL,
  semantic_digest text NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY (session_id, principal_id, nonce)
);
CREATE TABLE IF NOT EXISTS world_events (
  session_id text NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  session_seq numeric NOT NULL CHECK (session_seq > 0 AND session_seq = trunc(session_seq)),
  event jsonb NOT NULL,
  PRIMARY KEY (session_id, session_seq)
);
CREATE TABLE IF NOT EXISTS action_receipts (
  session_id text NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  principal_id text NOT NULL,
  client_action_id text NOT NULL,
  actor_id text NOT NULL,
  semantic_digest text NOT NULL,
  receipt jsonb NOT NULL,
  PRIMARY KEY (session_id, principal_id, client_action_id)
);
CREATE TABLE IF NOT EXISTS outbox (
  session_id text NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  from_exclusive numeric NOT NULL,
  through_seq numeric NOT NULL,
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Published')),
  attempts integer NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, through_seq),
  CHECK (from_exclusive >= 0 AND through_seq > from_exclusive)
);
CREATE TABLE IF NOT EXISTS decisions (
  session_id text NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  decision_id text NOT NULL,
  actor_id text NOT NULL,
  record jsonb NOT NULL,
  PRIMARY KEY (session_id, decision_id)
);
CREATE TABLE IF NOT EXISTS connections (
  connection_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES runtime_users(user_id),
  active boolean NOT NULL DEFAULT true,
  lease_until timestamptz NOT NULL
);
