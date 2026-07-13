# Bestie - MCP and Multi-Agent Plan

This is a future architecture plan, not immediate MVP work. `PROJECT.md` remains the source of truth when scope or priority conflicts appear.

## Required Direction

Bestie should eventually:

- connect to arbitrary MCP servers
- discover MCP tools/resources/prompts
- use MCP tools through a permission layer
- diagnose MCP setup with Doctor
- spawn or communicate with other AI agents
- delegate tasks to specialist agents
- aggregate results and respond in the Bestie's own voice

## MCP Principles

MCP support lets the agent gain tools without hardcoding every integration.

Default safety posture:

- read-only tools may be allowed for trusted servers
- write tools ask first
- public/external/destructive tools require explicit confirmation
- unknown tools ask first
- all tool calls are logged

Current local-development CLI foundation plus future additions:

```bash
bestie mcp add
bestie mcp list
bestie mcp show <name>
bestie mcp test <name>
bestie mcp tools <name>
bestie mcp enable <name>
bestie mcp disable <name>
```

Currently implemented commands are `list`, `show`, `test`, `test --connect`, `tools --connect`, `classify`, and classified read-only `call`. Add/enable/disable and broader tool categories remain future work.

## Multi-Agent Principles

The Bestie stays the user-facing personality and coordinator. Specialist agents help in the background.

Possible specialists:

- Research Agent
- Coding Agent
- Browser Agent
- Memory Curator Agent
- Planner Agent
- Content Agent
- Doctor/Repair Agent

Final response should usually be rewritten by the Bestie so the experience stays coherent.

## Safety Rules

- no secret delegation for sensitive tasks
- minimum necessary context to subagents
- no raw private memory dumps by default
- external/destructive actions still need approval
- every delegation/tool call is logged
- disagreements between agents should be surfaced clearly

## First Milestones

Permission layer milestone before MCP:

1. define local action categories: read, local_write, external_write, public_action, destructive, money, unknown
2. implement ask/allow/deny decisions with safe defaults
3. log every proposed and executed action with secret redaction
4. expose a small internal API that channel handlers can call without knowing tool internals

Current foundation:

- `src/safety/permission-policy.ts` defines the first action classifier, review gate, and redacted audit log helper.
- `src/safety/approval-executor.ts` defines the shared approval executor contract. Pending-memory approvals execute immediately; other approved action types return an unsupported executor result until a concrete executor is added.
- trusted read-only actions can be allowed; untrusted reads, local writes, external/public/destructive/money/unknown actions require approval by default.
- `reviewActionPermission` is the internal entrypoint future tool/channel code should call; if an action requires approval and no approver is available, it denies by default.
- Telegram provides a channel approver foundation that sends a redacted approval-needed prompt with inline Approve/Deny buttons, then calls the shared executor and replaces the button message with the result.
- `src/tools/local-read-tools.ts` contains gated local read-only tools for project file reads, bundled multi-file reads, Markdown bundle reads, directory listing, filename search, recent app logs, and active memories. Reads are constrained to the project directory, skip ignored directories such as `.git`, `node_modules`, `dist`, and `coverage`, and enforce per-file/total byte budgets. Terminal chat and Telegram expose these as `internal.read_file`, `internal.read_many_files`, `internal.read_markdown_bundle`, `internal.list_files`, `internal.search_files`, `internal.read_logs`, `internal.list_memories`, and `internal.search_memories` without requiring MCP setup.
- `bestie tools logs --lines N` and `bestie tools memories --limit N` exercise those gated tools from the CLI without exposing MCP execution yet.

MCP first milestone:

1. config model for MCP servers
2. list/test servers
3. list tools
4. support read-only tool calls with logging

Current MCP skeleton:

- `mcp.servers` config shape is accepted and validated.
- `bestie mcp list`, `bestie mcp show <name>`, and `bestie mcp test <name>` inspect configured servers without starting them or printing env values. `show` includes locally classified tools and categories.
- `bestie mcp test <name> --connect` can explicitly start one enabled stdio MCP server, send initialize, then stop it.
- `bestie mcp tools <name> --connect` can list MCP tool metadata from one server.
- `bestie mcp classify <server> <tool> --category read` can update local MCP tool classification without starting the server.
- `bestie mcp call <server> <tool> --read --json '{...}'` can call one MCP tool only when the local config classifies that tool as `read`; calls go through `reviewActionPermission` with redacted audit logging. Add `--ask` to force an interactive one-time approval prompt for the call.
- terminal chat and Telegram can execute multi-step model-requested read-only internal or MCP tool calls per user turn. MCP tools still require local classification as `read`; internal read tools are built in. Telegram passes an explicit permission policy into the tool loop and uses the inline approval foundation for approval-required categories. The runtime feeds each tool result back to the model before returning the final answer, with guidance to choose the right tool family, recover from missing paths when useful, treat empty results as not found, and avoid inventing unsupported facts. Shell-command JSON such as `{ "cmd": "..." }` is rejected and repaired through the model instead of being printed or executed. For repo-scale documentation summaries, the agent can use `internal.read_markdown_bundle` to discover, sort, and read Markdown docs under per-file and total byte budgets, or `internal.read_many_files` for explicit file sets.
- Doctor reports configured MCP servers, disabled-server warnings, and enabled servers missing tool classifications, but does not run MCP connection tests yet.

Multi-agent first milestone:

1. internal delegation interface
2. one simple Research Agent
3. Bestie aggregates and rewrites result

## Product Principle

MCP gives the Bestie hands. Multi-agent support gives the Bestie teammates. Both need permissions, Doctor checks, and logs before normal users should rely on them.
