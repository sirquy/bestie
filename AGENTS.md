# AI Coding Agent Instructions

## Project State

Bestie now has a functional TypeScript CLI/runtime implementation. Treat the docs as the product contract for scope and behavior, but use the existing `src/` code and tests as the implementation pattern.

Start with:

- [PROJECT.md](PROJECT.md) for product vision, owner requirements, and source-of-truth decisions.
- [docs/IMPLEMENTATION_PRIORITY.md](docs/IMPLEMENTATION_PRIORITY.md) for Now / Next / Later / Future scope.
- [docs/NOW_BUILD_SPEC.md](docs/NOW_BUILD_SPEC.md) for the current build slice.
- [docs/NOW_ARCHITECTURE_SPEC.md](docs/NOW_ARCHITECTURE_SPEC.md) for Phase Now module boundaries.

## Current Scope

Current shipped scope is intentionally small:

- terminal chat
- character prompt
- minimal onboarding/config wizard
- OpenAI-compatible LLM call
- basic logs
- Telegram and Zalo channel runtimes
- local memory, approvals, and read-only internal tools

Do not pull Zep, broad MCP/ACP platform work, plugins, UI, avatar, voice, or hosted/SaaS work into the current scope unless the user explicitly asks.

## Architecture Rules

- Keep CLI command files thin; put reusable behavior in runtime services.
- Follow the module boundaries in [docs/NOW_ARCHITECTURE_SPEC.md](docs/NOW_ARCHITECTURE_SPEC.md): `src/cli`, `src/runtime`, `src/character`, `src/llm`, and `src/chat`.
- Character behavior must be data-driven through editable character files and prompt files, not hardcoded throughout the codebase.
- OpenAI-compatible provider support should be configurable by `baseUrl`, `model`, and `apiKeyEnv`.
- Build extension points lightly, but do not add speculative abstractions for future systems.

## Safety And Privacy

- Never print or log API keys, tokens, or raw `.env` contents.
- Keep secrets in `.env`; config files store env var names, not secret values.
- Do not market or describe the agent as conscious, human, a therapist replacement, a romantic companion, or perfect memory.
- The character may be playful and blunt, but must not become cruel, humiliating, hateful, sexually explicit, or unsafe.
- External actions beyond the configured LLM call are out of scope for Phase Now.

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
- [docs/ROADMAP.md](docs/ROADMAP.md) - broader product roadmap.

## Working Guidance

- Before implementation, identify which spec controls the requested work.
- If docs conflict, prefer the latest user instruction, then [PROJECT.md](PROJECT.md), then [docs/IMPLEMENTATION_PRIORITY.md](docs/IMPLEMENTATION_PRIORITY.md), then feature-specific docs.
- Preserve future requirements without turning them into current MVP work.
- Add or update focused docs when behavior is ambiguous enough to cause wrong implementation.
- Keep answers and docs concise, actionable, and implementation-ready.