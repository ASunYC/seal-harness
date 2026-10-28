// 由 local-data 的前向迁移执行；插件本身不创建表或改变数据库版本。
export const tokenStatsSchema = `
CREATE TABLE token_usage_turns (
  session_id TEXT NOT NULL,
  turn INTEGER NOT NULL CHECK (turn >= 0),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_seq INTEGER NOT NULL CHECK (start_seq >= 0),
  end_seq INTEGER,
  preset_id TEXT NOT NULL DEFAULT '',
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'recorded', 'unavailable')),
  provider TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER CHECK (input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens >= 0),
  total_tokens INTEGER CHECK (total_tokens >= 0),
  cache_read_tokens INTEGER CHECK (cache_read_tokens >= 0),
  cache_write_tokens INTEGER CHECK (cache_write_tokens >= 0),
  reasoning_tokens INTEGER CHECK (reasoning_tokens >= 0),
  PRIMARY KEY (session_id, turn),
  CHECK (status <> 'recorded' OR (completed_at IS NOT NULL AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL AND total_tokens IS NOT NULL))
);
CREATE INDEX token_usage_turns_owner_time ON token_usage_turns(user_id, completed_at);
`
