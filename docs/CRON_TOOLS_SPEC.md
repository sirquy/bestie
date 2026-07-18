# Cron Tools Spec

**Status**: Implemented local-development foundation
**Scope**: Agent-initiated cron job CRUD + scheduled execution with isolated chat context

---

## Goals

1. Agent có thể CRUD cron jobs qua internal tools (tương tự cách agent dùng `internal.write_file`, `internal.read_file`...)
2. Cron executor chạy nền, trigger đúng lịch, gửi kết quả vào **isolated chat context** (context riêng, không làm phiền user)
3. User có thể xem/quản lý cron jobs qua CLI (`bestie cron list|add|remove|logs`)

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Agent Chat Loop                 │
│  LLM → tool call → cron CRUD → SQLite store     │
└──────────────────┬──────────────────────────────┘
                   │ writes schedules
                   ▼
┌─────────────────────────────────────────────────┐
│              SQLite (memory.sqlite)              │
│  Table: cron_schedules                           │
│  Table: cron_logs                                │
└──────────────────┬──────────────────────────────┘
                   │ polls for due jobs
                   ▼
┌─────────────────────────────────────────────────┐
│           Cron Executor (runtime process)        │
│  For each due job:                               │
│    1. Build system prompt (isolated, no owner)   │
│    2. Run completeWithAgentTools (background)    │
│    3. Log result to cron_logs                    │
│    4. Send output to configured channel (opt.)   │
└─────────────────────────────────────────────────┘
```

---

## 1. SQLite Schema

### Table: `cron_schedules`

```sql
CREATE TABLE IF NOT EXISTS cron_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  schedule_type TEXT NOT NULL CHECK(schedule_type IN ('interval', 'cron_expr', 'once')),
  schedule_value TEXT NOT NULL,          -- interval: "30m", "1h", "2d" | cron_expr: "0 8 * * *" | once: ISO timestamp
  prompt TEXT NOT NULL,                  -- what the agent should do when triggered
  channel TEXT,                          -- optional: "telegram" | "zalo" | null (no output)
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_run_at TEXT,
  next_run_at TEXT NOT NULL,
  last_result TEXT,                      -- "ok" | "error" | null
  last_error TEXT,
  run_count INTEGER NOT NULL DEFAULT 0
);
```

### Table: `cron_logs`

```sql
CREATE TABLE IF NOT EXISTS cron_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  result TEXT,                           -- "ok" | "error"
  output TEXT,                           -- agent response text (truncated to 2000 chars)
  error TEXT,
  FOREIGN KEY (schedule_id) REFERENCES cron_schedules(id) ON DELETE CASCADE
);
```

---

## 2. Cron Tools (Agent CRUD)

File: `src/tools/cron-tools.ts`

### 2.1 `internal.add_cron_schedule`

```typescript
interface AddCronScheduleArgs {
  name: string;                    // job name
  schedule_type: "interval" | "cron_expr" | "once";
  schedule_value: string;          // "30m" | "0 8 * * *" | "2026-07-16T08:00:00Z"
  prompt: string;                  // what the agent should do
  channel?: string;                // "telegram" | "zalo" | undefined
}
```

Validate schedule_value format:
- `interval`: regex `^\d+[smhd]$` (30s, 5m, 1h, 2d)
- `cron_expr`: 5-field cron (minute hour dom month dow)
- `once`: ISO 8601 timestamp, must be in the future

Return: `{ allowed: true, reason: "", scheduleId: number, nextRunAt: string }`

### 2.2 `internal.list_cron_schedules`

No args. Return all schedules with status.

```typescript
interface ListCronScheduleResult {
  allowed: true;
  reason: "";
  schedules: Array<{
    id: number;
    name: string;
    scheduleType: string;
    scheduleValue: string;
    prompt: string;       // truncated to 80 chars
    channel?: string;
    enabled: boolean;
    nextRunAt: string;
    lastRunAt?: string;
    runCount: number;
    lastResult?: string;
  }>;
}
```

### 2.3 `internal.remove_cron_schedule`

```typescript
interface RemoveCronScheduleArgs {
  schedule_id: number;
}
```

Return: `{ allowed: true, reason: "", removed: true }`

### 2.4 `internal.toggle_cron_schedule`

```typescript
interface ToggleCronScheduleArgs {
  schedule_id: number;
  enabled: boolean;
}
```

Return: `{ allowed: true, reason: "", enabled: boolean }`

### Permission

All cron tools classified as `"local_write"` — the agent can call them freely when `internalTools.policies.local_write` is `"allow"` (default). No external action or destructive classification needed since cron jobs don't directly send messages.

---

## 3. Tool Registration

### 3.1 InternalToolRequest union (`src/chat/mcp-tool-use.ts`)

Add to the union type:
```typescript
| { tool: "internal.add_cron_schedule"; arguments: AddCronScheduleArgs }
| { tool: "internal.list_cron_schedules"; arguments: Record<string, never> }
| { tool: "internal.remove_cron_schedule"; arguments: RemoveCronScheduleArgs }
| { tool: "internal.toggle_cron_schedule"; arguments: ToggleCronScheduleArgs }
```

### 3.2 Dispatcher (`runAgentToolRequest`)

Add branches:
```typescript
if (options.request.tool === "internal.add_cron_schedule") {
  return addCronScheduleTool(options.request.arguments, options);
}
if (options.request.tool === "internal.list_cron_schedules") {
  return listCronSchedulesTool(options);
}
if (options.request.tool === "internal.remove_cron_schedule") {
  return removeCronScheduleTool(options.request.arguments, options);
}
if (options.request.tool === "internal.toggle_cron_schedule") {
  return toggleCronScheduleTool(options.request.arguments, options);
}
```

### 3.3 Tool Instructions (`buildMcpToolInstructions`)

Add cron tool descriptions to the system prompt section:
```
### Cron Schedules

- `internal.add_cron_schedule`: Create a scheduled task. schedule_type: "interval" (e.g. "30m", "1h", "2d"), "cron_expr" (5-field cron), or "once" (ISO timestamp). prompt: what to do. channel: optional output target.
- `internal.list_cron_schedules`: List all scheduled tasks.
- `internal.remove_cron_schedule`: Remove a scheduled task by ID.
- `internal.toggle_cron_schedule`: Enable/disable a scheduled task.
```

---

## 4. Isolated Chat Context

**"Isolated chat"** = cron executor chạy `completeWithAgentTools` với context riêng, không có owner conversation history.

### 4.1 How it differs from normal chat

| Aspect | Normal Chat | Cron Chat |
|--------|-------------|-----------|
| System prompt | Character prompt + owner context | Character prompt + cron-specific prefix ("You are executing a scheduled task.") |
| Recent turns | Loaded from memory/conversation | Empty (no history) |
| Memories | Active memories loaded | Active memories loaded (agent can still search memory) |
| Tools | All tools available | Restricted: read-only + cron itself. No `internal.write_file`, `internal.exec` unless explicitly allowed |
| Channel | Terminal / Telegram / Zalo | `cron_logs` table + optional channel send |
| Max tool calls | 250 | 50 (limited, background task) |

### 4.2 Isolated chat builder

```typescript
// src/cron/isolated-chat.ts
interface IsolatedChatOptions {
  config: AppConfig;
  paths: RuntimePaths;
  apiKey: string;
  prompt: string;              // the cron job's prompt
  channel?: string;            // optional output channel
  maxToolCalls?: number;
}

async function runIsolatedChat(options: IsolatedChatOptions): Promise<string> {
  const systemPrompt = buildCronSystemPrompt(options.config);
  const messages: ChatMessage[] = [
    { role: "user", content: options.prompt },
  ];
  const memories = await loadActiveMemories(options.paths);

  // Use a restricted tool runner that blocks dangerous tools
  const toolRunner = createRestrictedToolRunner(options.config, options.paths, options.apiKey);

  const result = await completeWithAgentTools({
    config: options.config,
    paths: options.paths,
    apiKey: options.apiKey,
    messages,
    chatCompletion: /* standard chat completion */,
    toolRunner,
    maxToolCalls: options.maxToolCalls ?? 50,
    streamFinalResponse: false,
  });

  return result;
}
```

### 4.3 Restricted tool runner

Cron jobs should not call destructive or external tools by default. The restricted runner wraps `runAgentToolRequest` and blocks:
- `internal.write_file`, `internal.edit_file`, `internal.apply_patch`, `internal.exec`
- Any tool classified as `"external_write"`, `"destructive"`, `"money"`

Allowed:
- `internal.read_file`, `internal.read_many_files`, `internal.list_files`, `internal.search_files`
- `internal.read_git_status`, `internal.read_git_diff`, `internal.read_git_log`
- `internal.read_recent_logs`, `internal.list_active_memories`, `internal.search_memories`
- `internal.read_url`
- `internal.list_cron_schedules` (can inspect other jobs)
- All MCP `"read"` tools

---

## 5. Cron Executor

File: `src/cron/executor.ts`

### 5.1 Core loop

```typescript
export class CronExecutor {
  private intervalMs = 30_000; // check every 30s
  private timer?: NodeJS.Timeout;
  private running = new Set<number>(); // prevent overlapping runs

  constructor(
    private config: AppConfig,
    private paths: RuntimePaths,
    private apiKey: string,
  ) {}

  start(): void {
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.tick(); // run immediately
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    const store = new SqliteMemoryStore(this.paths.memoryDbPath);
    const dueJobs = store.listDueCronJobs(new Date().toISOString());

    for (const job of dueJobs) {
      if (this.running.has(job.id)) continue; // skip if already running
      this.running.add(job.id);
      this.executeJob(job).finally(() => this.running.delete(job.id));
    }
  }

  private async executeJob(job: CronSchedule): Promise<void> {
    const store = new SqliteMemoryStore(this.paths.memoryDbPath);
    const logId = store.createCronLog(job.id);

    try {
      store.updateCronNextRun(job.id, computeNextRun(job));
      const output = await runIsolatedChat({
        config: this.config,
        paths: this.paths,
        apiKey: this.apiKey,
        prompt: job.prompt,
        channel: job.channel ?? undefined,
      });

      store.finishCronLog(logId, "ok", output);
      store.updateCronRunResult(job.id, "ok");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "unknown error";
      store.finishCronLog(logId, "error", undefined, msg);
      store.updateCronRunResult(job.id, "error", msg);
    }
  }
}
```

### 5.2 Next-run computation

```typescript
function computeNextRun(job: CronSchedule): string {
  switch (job.scheduleType) {
    case "interval": {
      const ms = parseInterval(job.scheduleValue); // "30m" → 1_800_000
      return new Date(Date.now() + ms).toISOString();
    }
    case "cron_expr": {
      // Use cron-parser library (lightweight, no deps needed — can use a simple parser)
      return computeCronNextRun(job.scheduleValue, job.timezone ?? "UTC");
    }
    case "once": {
      return ""; // no next run, job is one-shot
    }
  }
}
```

### 5.3 Runtime integration

The cron executor runs through `bestie cron run`. Manual daemon mode starts it as the `cron` target through `bestie daemon start --channel cron` or `bestie daemon start --channel all`:

```typescript
// In cron run flow
const executor = new CronExecutor(config, paths, apiKey);
executor.start();
```

The Linux user service does not create a separate cron unit. `bestie service install` writes one `bestie.service` unit whose hidden foreground command, `bestie service run`, starts configured Telegram, Zalo, cron, and future service targets together.

For non-daemon usage (`bestie chat`), cron does NOT run; it only runs in `bestie cron run`, the cron daemon target, or the shared service runtime.

---

## 6. CLI Commands

File: `src/cli/commands/cron.ts`

### 6.1 `bestie cron list`

```
┌────┬──────────────┬────────────┬──────────┬─────────────────┬──────────┐
│ ID │ Name         │ Schedule   │ Channel  │ Next Run        │ Status   │
├────┼──────────────┼────────────┼──────────┼─────────────────┼──────────┤
│  1 │ Morning brief│ 0 8 * * *  │ telegram │ 2026-07-16 08:00│ ok (3x)  │
│  2 │ Check tasks  │ every 30m  │ —        │ 2026-07-15 18:30│ disabled │
└────┴──────────────┴────────────┴──────────┴─────────────────┴──────────┘
```

### 6.2 `bestie cron add --name "Morning brief" --schedule "0 8 * * *" --prompt "Review my pending tasks" --channel telegram`

### 6.3 `bestie cron remove <id>`

### 6.4 `bestie cron toggle <id>`

### 6.5 `bestie cron logs [id]`

Show recent cron execution logs.

---

## 7. Files to Create/Modify

### New files

| File | Purpose |
|------|---------|
| `src/tools/cron-tools.ts` | CRUD tool functions for agent |
| `src/tools/cron-tools.test.ts` | Tests for cron tools |
| `src/cron/executor.ts` | Cron execution engine |
| `src/cron/executor.test.ts` | Tests for executor |
| `src/cron/scheduler.ts` | Next-run computation (interval parsing, cron expression) |
| `src/cron/scheduler.test.ts` | Tests for scheduler |
| `src/cron/isolated-chat.ts` | Isolated chat context builder |
| `src/cron/isolated-chat.test.ts` | Tests for isolated chat |
| `src/cli/commands/cron.ts` | CLI `bestie cron` command |
| `src/cli/commands/cron.test.ts` | Tests for CLI |
| `docs/CRON_TOOLS_SPEC.md` | This spec |

### Modified files

| File | Change |
|------|--------|
| `src/memory/schema.ts` | Add `cron_schedules` and `cron_logs` tables |
| `src/memory/sqlite-store.ts` | Add CRUD methods for cron schedules and logs |
| `src/chat/mcp-tool-use.ts` | Add tool names to `InternalToolRequest` union + dispatcher branches + tool instructions |
| `src/cli/command-specs.ts` | Register `cron` command |
| `src/cli/commands/daemon.ts` | Start CronExecutor when daemon starts |
| `src/runtime/doctor.ts` | Add cron health check (next run is valid, no overdue jobs) |

---

## 8. Implementation Order

### Phase 1: Storage (foundation)
1. Add `cron_schedules` + `cron_logs` tables to `schema.ts`
2. Add CRUD methods to `sqlite-store.ts`
3. Add `src/cron/scheduler.ts` — interval parser + next-run computation

### Phase 2: Agent Tools
4. Create `src/tools/cron-tools.ts` with 4 tool functions
5. Register tools in `mcp-tool-use.ts` (union type + dispatcher + instructions)
6. Tests for tools

### Phase 3: Executor
7. Create `src/cron/isolated-chat.ts` — isolated chat context
8. Create `src/cron/executor.ts` — background loop
9. Integrate executor into daemon startup
10. Tests for executor + isolated chat

### Phase 4: CLI
11. Create `src/cli/commands/cron.ts` — list/add/remove/toggle/logs
12. Register in `command-specs.ts`
13. Doctor integration

### Phase 5: Polish
14. Add cron tool instructions to system prompt
15. Log redaction for cron outputs (may contain secrets from tool results)
16. Limit cron_logs retention (auto-clean logs older than 30 days)

---

## 9. Example Flow

### User says: "Mỗi sáng 8h nhắc mình check task"

1. LLM parses intent → calls `internal.add_cron_schedule`:
   ```json
   {
     "name": "Morning task check",
     "schedule_type": "cron_expr",
     "schedule_value": "0 8 * * *",
     "prompt": "Check pending tasks and remind the owner about anything urgent.",
     "channel": "telegram"
   }
   ```

2. Tool creates row in `cron_schedules`, computes `next_run_at = 2026-07-16T08:00:00+07:00`

3. At 08:00, executor picks up the job → runs isolated chat:
   - System prompt: character prompt + cron prefix
   - User message: "Check pending tasks and remind the owner about anything urgent."
   - Agent searches memory, reads files, produces summary
   - Output sent to Telegram via channel adapter

4. Cron log written to `cron_logs`

---

## 10. Edge Cases

- **Overlapping runs**: Executor uses `Set<id>` to skip jobs already running
- **Missed jobs**: If daemon was down, executor catches up on next start (runs all overdue jobs)
- **One-shot jobs** (`schedule_type: "once"`): Auto-disable after first run, set `next_run_at` to empty
- **Invalid cron expressions**: Validate at creation time, reject with clear error
- **Agent creating too many jobs**: No hard limit in MVP, but doctor warns if >20 active jobs
- **Empty output**: If agent returns empty string, log as `"ok"` with `(no output)` placeholder
