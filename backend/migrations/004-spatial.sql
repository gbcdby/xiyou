-- 发出序号与已处理水位是可信命令元数据，与 Receipt 同事务持久。
CREATE TABLE IF NOT EXISTS spatial_command_sources (
  session_id text NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  control_epoch numeric NOT NULL CHECK (control_epoch >= 0 AND control_epoch = trunc(control_epoch)),
  issued_seq numeric NOT NULL DEFAULT 0 CHECK (issued_seq >= 0 AND issued_seq = trunc(issued_seq)),
  handled_seq numeric NOT NULL DEFAULT 0 CHECK (handled_seq >= 0 AND handled_seq = trunc(handled_seq)),
  PRIMARY KEY (session_id, actor_id, control_epoch)
);
CREATE TABLE IF NOT EXISTS spatial_intents (
  session_id text NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  intent_id text NOT NULL,
  actor_id text NOT NULL,
  control_epoch text NOT NULL,
  request jsonb NOT NULL,
  PRIMARY KEY (session_id, intent_id)
);
