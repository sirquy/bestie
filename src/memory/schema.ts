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
  pinned INTEGER DEFAULT 0,
  scope TEXT DEFAULT 'global',
  confidence REAL DEFAULT 1.0,
  expires_at TEXT,
  superseded_by INTEGER,
  last_accessed_at TEXT,
  access_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (superseded_by) REFERENCES memories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS memory_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_memory_id INTEGER NOT NULL,
  target_memory_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('duplicate', 'conflict', 'supersedes', 'related')),
  reason TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_memory_id) REFERENCES memories(id) ON DELETE CASCADE,
  FOREIGN KEY (target_memory_id) REFERENCES memories(id) ON DELETE CASCADE,
  UNIQUE(source_memory_id, target_memory_id, kind)
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

CREATE TABLE IF NOT EXISTS memory_hygiene_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  score INTEGER NOT NULL,
  label TEXT NOT NULL,
  checked INTEGER NOT NULL,
  delete_candidates INTEGER NOT NULL,
  review_only INTEGER NOT NULL,
  duplicate_groups INTEGER NOT NULL,
  stale_memories INTEGER NOT NULL,
  conflict_groups INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`;

export const MEMORY_DB_RELATIVE_PATH = ".bestie/data/memory.sqlite";
