export const MEMORY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  sensitivity TEXT DEFAULT 'normal',
  importance INTEGER DEFAULT 3,
  status TEXT DEFAULT 'active',
  source_message_id TEXT,
  source TEXT DEFAULT 'manual',
  explicit_consent INTEGER DEFAULT 0,
  policy_reason TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT,
  user_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pending_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  reason TEXT,
  source TEXT DEFAULT 'manual',
  explicit_consent INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS memory_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pending_action_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  user_id TEXT,
  category TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  reason TEXT,
  proposed_reason TEXT,
  payload_json TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS cron_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  schedule_type TEXT NOT NULL CHECK(schedule_type IN ('interval', 'cron_expr', 'once')),
  schedule_value TEXT NOT NULL,
  prompt TEXT NOT NULL,
  channel TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_run_at TEXT,
  next_run_at TEXT NOT NULL,
  last_result TEXT,
  last_error TEXT,
  run_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cron_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL,
  started_at TEXT DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  result TEXT,
  output TEXT,
  error TEXT,
  FOREIGN KEY (schedule_id) REFERENCES cron_schedules(id) ON DELETE CASCADE
);
`;

export const MEMORY_DB_RELATIVE_PATH = ".bestie/data/memory.sqlite";
