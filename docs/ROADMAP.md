# Roadmap

## Now

- terminal chat
- character prompt
- minimal onboarding/config wizard
- config v2 provider profiles and LLM calls across OpenAI/ChatGPT, Anthropic Claude, OpenAI-compatible endpoints, Groq, OpenRouter, Ollama, and native Gemini API-key mode
- basic logs
- character eval suite

Status: completed for local development and shipped through the npm CLI.

## Next

- choose the next scoped milestone before expanding beyond the local MVP foundation
- fuller onboarding polish only when it improves first-run completion
- Doctor/local diagnostics polish only when it protects install or real use
- Telegram/Zalo reliability fixes discovered by daily local use
- skills and update-command polish when it improves owner workflows
- agent safety gates checklist before broader autonomy:
  - sandbox every tool/action with least-privilege filesystem, network, process, and external-service access
  - define permission scopes per tool, channel, workflow, and MCP category before execution
  - require explicit approval gates for public, destructive, financial, credential, or external-write actions
  - write audit logs for tool calls, prompts, inputs, outputs, approvals, denials, retries, and resulting IDs/permalinks
  - add incident reports for failed, blocked, ambiguous, duplicate, unsafe, or user-reported bad actions
  - support kill switches, cron disable/toggle, workflow pause, and credential revocation paths
  - add controlled browser tools only behind safety gates: isolated browser profile/session, domain allowlist, screenshot evidence, audit logs, and approval before submit/purchase/delete/public changes
  - verify action results after execution and record verification gaps instead of assuming success
  - review safety metrics regularly: denied actions, approval bypass attempts, duplicate jobs, failed verifications, and policy violations
- Bestie Skills Library MVP:
  - publish an online skills registry for official Bestie skills before opening broader community submissions
  - expose skill discovery in the local web console with search, category filters, version, author, risk level, and required tool/action permissions
  - install approved skills directly into the local runtime under `~/.bestie/skills/<skill-name>/SKILL.md`
  - require explicit confirmation before install, update, uninstall, or enabling any skill that requests tool access
  - show source preview, manifest metadata, requested permissions, changelog, and update diff before changing local files
  - support trust levels: official, verified, community, and local/private
  - add checksum/signature verification and rollback for official or verified skills before treating the registry as safe for broad use
  - keep the first registry small with 10-20 high-quality workflow skills instead of launching a noisy marketplace too early

Status: local MVP foundation complete. Terminal chat, onboarding, local SQLite memory, Doctor, Telegram/Zalo local polling, cron, daemon management for `telegram|zalo|cron|all`, one `bestie.service` systemd runtime, permission-gated local tools, bounded internal subagents, SDK-backed MCP setup plus classified read calls, installed skills, provider catalog/management CLI, local web console, npm update checks, Telegram real-bot smoke, and one-command installer smoke exist for local development.

## Later

- fuller onboarding
- optional Zep memory
- backup/restore/migration
- polish the shipped local web console when it improves real owner workflows
- hosted/product UI beyond the local console
- broader tools after permissions have been exercised in terminal, Telegram, and Zalo
- community skill submissions, ratings, examples, and premium/managed skill packs after the official registry and local install flow are proven safe

## Future

- broader MCP execution categories after permission layer, local tool logging, and real-channel readiness
- named ACP/multi-agent orchestration beyond the bounded internal subagent helper
- plugin system
- persona templates and skill marketplace
- avatar/voice/body layer
- hosted/SaaS mode

## Hard Rules

- The original Phase Now excluded Telegram, memory, Zep, MCP/ACP, plugins, installer, UI, avatar, voice, hosted/SaaS, analytics, and telemetry. The current local MVP has since implemented Telegram, Zalo, cron, local memory, Doctor, permission-gated tools, bounded internal subagents, MCP setup/read foundations, installer, skills, update checks, local web console, daemon management, and one-service systemd integration.
- Zep after SQLite
- MCP/ACP after Doctor + permissions
- product/hosted UI after the shipped local console proves useful
- installer after onboarding works
- no public marketing claims about consciousness/therapy/romance
