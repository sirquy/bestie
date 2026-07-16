# Memory Spec

## Strategy

Start with local SQLite. Add Zep later as optional advanced memory.

Do not build Zep first.

## Memory MVP Policy

The model may propose durable memory through the `internal.remember_memory` tool when it decides the user wants something remembered, in any language. Runtime config controls the write behavior with `memory.writePolicy`:

- `allow` - store allowed non-secret memories directly.
- `ask` - queue allowed non-secret memories as pending approval and ask the owner to approve or deny the write in-channel when the channel supports approvals. This is the default when unset.
- `deny` - reject memory writes.

Eligible memory types:

- non-sensitive user facts
- project context
- durable decisions
- communication preferences
- explicit preferences

Pending approval:

- sensitive personal details
- relationship/family details
- health or mental health context
- financial details
- private identifiers

Never store:

- passwords
- tokens
- payment details
- secrets
- one-off venting unless explicitly requested


## Current Implementation Slice

The current local memory slice includes policy, schema, and a minimal SQLite store:

- `src/memory/policy.ts` decides whether a memory candidate is `store`, `pending`, or `never`.
- `src/memory/schema.ts` defines the MVP SQLite tables, governance metadata, memory links, and repo-local database path.
- `src/memory/sqlite-store.ts` opens `.bestie/data/memory.sqlite`, applies schema, and can add/list active memories, persisted messages, pause state, pending memories, and pending action approvals.
- `bestie doctor` verifies the local memory database can be created and opened.
- `bestie memory status`, `bestie memory pause`, `bestie memory resume`, `bestie memory list`, `bestie memory search <query>`, `bestie memory analyze [--mode all|duplicates|stale|conflicts] [--json]`, `bestie memory cleanup --dry-run|--apply [--yes] [--json]`, `bestie memory add <type> <content>`, `bestie memory inspect <id>`, `bestie memory edit <id> <content>`, `bestie memory forget <id>`, `bestie memory messages [--limit <n>] [--role user|assistant|system]`, `bestie memory messages search <query> [--limit <n>] [--role user|assistant|system]`, `bestie memory export`, `bestie memory clear --yes`, `bestie memory pending [--limit <n>]`, `bestie memory pending search <query> [--limit <n>]`, `bestie memory pending inspect <id>`, `bestie memory approve <id>`, `bestie memory reject <id>`, and `bestie memory reject-all --yes` support manual inspection, clearer active-memory listing, simple active-memory search, structured duplicate/stale/conflict analysis, policy-aware duplicate/stale cleanup planning and application, per-memory metadata inspection, pause/resume control, safe manual writes, manual edits, soft deletion, bounded persisted-message inspection, search, and role filtering, JSON export, confirmed clearing, and bounded sensitive-memory inspection, search, approval, rejection, and confirmed bulk rejection with next-command hints.
- Chat reads approved active memories as context, supports `/status`, `/memory`, `/memory pause`, `/memory resume`, and `/pending` for quick in-chat local memory control and inspection, and persists successful terminal/Telegram user/assistant messages only while memory is active. The tool loop exposes `internal.list_memories` for complete active-memory listing, `internal.search_memories` for model-requested active-memory lookup, `internal.analyze_memories` for duplicate/stale/conflict cleanup planning, and `internal.remember_memory` for model-requested writes without language-specific keyword detection; writes are stored, queued, or denied according to `memory.writePolicy`, memory pause state, and memory safety policy. Telegram `ask` writes create an approval request with inline Approve/Deny buttons; approving stores the pending memory and denying rejects it.
- Memory Candidate Reasoning v1 runs after successful terminal and Telegram turns when `memory.writePolicy` is explicitly configured. It asks the model for a small structured candidate list, routes each candidate through the existing memory policy, skips duplicates and secrets, stores allowed candidates when policy is `allow`, and queues pending candidates when policy is `ask`.
- Memory Governance v1 stores lightweight metadata (`pinned`, `scope`, `confidence`, `expires_at`, `superseded_by`, `last_accessed_at`, and `access_count`) and a `memory_links` table for duplicate/conflict/supersession relationships. The first governance tool, `internal.analyze_memories`, is read-only and returns structured duplicate groups, stale memories, and conflict groups so cleanup can be deliberate instead of relying on free-form inspection.

This keeps the storage layer testable while avoiding language-specific remember-request regexes.

## SQLite Tables

```sql
CREATE TABLE memories (
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

CREATE TABLE memory_links (
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

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT,
  user_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE pending_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  reason TEXT,
  source TEXT DEFAULT 'manual',
  explicit_consent INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE memory_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE pending_action_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  user_id TEXT,
  category TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  reason TEXT,
  proposed_reason TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  decided_at TEXT
);
```

## User Controls

Commands/future UI should support:

- inspect memory
- pause and resume memory writes/recall
- edit memory
- delete memory
- analyze duplicate, stale, and conflicting memory
- dry-run and apply duplicate/stale cleanup while respecting `memory.deletePolicy`
- export memory
- clear memory
- `forget this`
- pause memory
- approve/reject pending memory

## Zep Later

When enabled:

- create/get Zep user
- create/get thread
- write messages to Zep
- retrieve context block before reply
- merge Zep context with local state
- fall back to SQLite if Zep fails

Zep should remember context; it should not define the character.
