# AI Coding Agent Instructions

## Project State

Bestie now has a functional TypeScript CLI/runtime implementation. Treat the docs as the product contract for scope and behavior, but use the existing `src/` code and tests as the implementation pattern.

Start with:

- [PROJECT.md](PROJECT.md) for product vision, owner requirements, and source-of-truth decisions.
- [docs/IMPLEMENTATION_PRIORITY.md](docs/IMPLEMENTATION_PRIORITY.md) for Now / Next / Later / Future scope.
- [docs/NOW_BUILD_SPEC.md](docs/NOW_BUILD_SPEC.md) for the current build slice.
- [docs/NOW_ARCHITECTURE_SPEC.md](docs/NOW_ARCHITECTURE_SPEC.md) for Phase Now module boundaries.

## Current Scope

Current shipped scope is no longer only the original Phase Now slice. The local npm CLI/runtime now includes:

- terminal chat
- editable character prompt and installed skills from `~/.bestie/skills`
- minimal onboarding/config wizard
- OpenAI-compatible LLM calls with fallback diagnostics
- basic redacted logs
- Telegram and Zalo channel runtimes behind `bestie channels telegram|zalo`
- daemon management through `bestie daemon --channel telegram|zalo|cron|all`
- one Linux user service through `bestie service install|uninstall|restart|status`, backed by `bestie.service` and hidden foreground `bestie service run`
- local SQLite memory, pending approvals, pause/resume, and memory inspection commands
- permission-gated local read/write/action tools, including allowed external workspace paths
- bounded internal subagent spawning through `internal.spawn_subagent`
- SDK-backed MCP add/list/show/test/tools/classify/login/call, remote HTTP OAuth setup, and classified read calls
- local Doctor diagnostics and safe fixes
- npm version checks through `bestie update` and throttled update notices on chat/daemon/service startup

Do not pull Zep, broad MCP/ACP platform work, a plugin marketplace, UI, avatar/body, or hosted/SaaS work into the current scope unless the user explicitly asks.

## Architecture Rules

- Keep CLI command files thin; put reusable behavior in runtime services.
- Preserve the current module boundaries: `src/cli`, `src/runtime`, `src/character`, `src/llm`, `src/chat`, `src/channels`, `src/memory`, `src/safety`, `src/tools`, `src/mcp`, and `src/skills`.
- Character behavior must be data-driven through editable character files and prompt files, not hardcoded throughout the codebase.
- OpenAI-compatible provider support should be configurable by `baseUrl`, `model`, and `apiKeyEnv`.
- Build extension points lightly, but do not add speculative abstractions for future systems.

## Safety And Privacy

- Never print or log API keys, tokens, or raw `.env` contents.
- Keep secrets in `.env`; config files store env var names, not secret values.
- Do not market or describe the agent as conscious, human, a therapist replacement, a romantic companion, or perfect memory.
- The character may be playful and blunt, but must not become cruel, humiliating, hateful, sexually explicit, or unsafe.
- External, destructive, public, or money-related actions must go through permission review. Keep default permissions conservative.

See [docs/SECURITY_PRIVACY.md](docs/SECURITY_PRIVACY.md) for security, privacy, prompt-injection, telemetry, and public-claims rules.

## Documentation Map

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - long-term architecture.
- [docs/CHANNEL_ADAPTER_PLAN.md](docs/CHANNEL_ADAPTER_PLAN.md) - checklist for adding future channel adapters.
- [docs/MVP_BUILD_PLAN.md](docs/MVP_BUILD_PLAN.md) - milestone plan.
- [docs/CONFIG_SPEC.md](docs/CONFIG_SPEC.md) - config paths and schemas.
- [docs/ONBOARDING_SPEC.md](docs/ONBOARDING_SPEC.md) - onboarding flow.
- [docs/DOCTOR_SPEC.md](docs/DOCTOR_SPEC.md) - diagnostics and repair.
- [docs/MEMORY_SPEC.md](docs/MEMORY_SPEC.md) - local and Zep memory design.
- [docs/CHARACTER_EVALS.md](docs/CHARACTER_EVALS.md) - personality regression checks.
- [docs/TELEGRAM_MVP_SPEC.md](docs/TELEGRAM_MVP_SPEC.md) - Telegram channel behavior.
- [docs/CHANNEL_ADAPTER_PLAN.md](docs/CHANNEL_ADAPTER_PLAN.md) - checklist for channel adapters.
- [docs/ROADMAP.md](docs/ROADMAP.md) - broader product roadmap.

## Working Guidance

- Before implementation, identify which spec controls the requested work.
- If docs conflict, prefer the latest user instruction, then [PROJECT.md](PROJECT.md), then [docs/IMPLEMENTATION_PRIORITY.md](docs/IMPLEMENTATION_PRIORITY.md), then feature-specific docs.
- Preserve future requirements without turning them into current MVP work.
- Add or update focused docs when behavior is ambiguous enough to cause wrong implementation.
- Keep answers and docs concise, actionable, and implementation-ready.