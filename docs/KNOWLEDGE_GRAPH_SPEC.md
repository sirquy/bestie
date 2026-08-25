# Knowledge Graph Spec

## Goal

Bestie's knowledge graph is a local-first extension of SQLite memory. It stores durable entities and relationships derived from approved memory/tool writes and bounded reasoning passes.

The graph is recall support, not perfect memory. It must stay inspectable, exportable, and governed by the same local memory safety policy.

## Scope

Current scope:

- SQLite tables for active entities, active relations, and pending graph items.
- SQLite `knowledge_audit_events` for graph provenance events.
- CLI inspection through `bestie memory graph ...`.
- Local UI inspection through the Knowledge Graph panel in `bestie ui`, including an interactive 3D map, inventory/review controls, search, pending graph writes, review suggestions, and safe graph actions.
- Internal tools: `internal.search_knowledge`, `internal.inspect_entity`, `internal.analyze_knowledge`, `internal.plan_knowledge_review`, `internal.remember_knowledge`, `internal.merge_knowledge_entities`, `internal.forget_knowledge_relation`, and `internal.update_knowledge_relation`.
- Post-turn knowledge reasoning for terminal, Telegram, Zalo, and UI chat when `memory.writePolicy` is explicitly configured.
- Compact graph retrieval injected into terminal, Telegram, Zalo, cron, and UI chat prompts when relevant to the current user input.
- Basic graph hygiene analysis for duplicate entity candidates, conflicting relations, orphan entities, low-confidence relations, and pending graph items.

Out of scope for this slice:

- Neo4j or external graph databases.
- Vector embeddings.
- Hosted/global graph sync.
- Automatic destructive cleanup.

## Data Model

Entities are stored in `knowledge_entities`:

- `canonical_name`
- `kind`: `person`, `project`, `preference`, `tool`, `skill`, `topic`, `organization`, `location`, `decision`, or `concept`
- aliases, sensitivity, scope, confidence, source ids, status, timestamps

Relations are stored in `knowledge_relations`:

- source entity id
- relation type
- target entity id
- evidence, sensitivity, scope, confidence, source ids, status, timestamps

Pending graph writes are stored in `pending_knowledge_items` as JSON payloads for owner review. Approval uses the same pending action flow as memory writes, with targets shaped as `pending-knowledge:<id>`.

## Policy

Graph writes follow `memory.writePolicy`:

- `allow`: stores non-secret allowed graph items directly.
- `ask`: queues graph payloads in `pending_knowledge_items`.
- `deny`: rejects graph writes and skips reasoning writes.

Secret-like payloads are always rejected. Blocked `internal.remember_knowledge` calls return `result.status = "blocked"` and `result.diagnostics.blockedBy` reason codes, for example `payment_card_like`, `api_key_assignment`, `token_assignment`, `openai_key`, or `explicit_secret_sensitivity`; diagnostics must not include the matched secret value. Chat tool-result guidance uses those diagnostics to explain that no graph fact was stored and to suggest retrying with sanitized evidence instead of repeating the sensitive value. Sensitive payloads are queued unless explicit consent is provided and policy allows storage.

Pending graph items can be reviewed from CLI or owner channels. Telegram and Zalo create approval requests for `internal.remember_knowledge` and post-turn knowledge reasoning; approving stores valid entities/relations and denying deletes the pending item.

If a pending graph payload is later blocked by the current knowledge policy during approval, approval returns a blocked/invalid result with diagnostics, keeps the pending item for owner review, and stores no graph entities or relations. The owner can reject the old pending item or recreate it with sanitized evidence.

Owners can sanitize a blocked pending graph item with `bestie memory graph pending sanitize <id>`, owner-channel slash commands `/memory graph pending sanitize <id>` or `/graph pending sanitize <id>`, or the UI `sanitize_pending` action. Sanitization redacts secret-like values from the pending payload, keeps durable non-secret entities/relations intact when possible, records a `sanitized` audit event, and lets the owner approve the same pending item after policy validation passes. If automatic sanitization cannot produce an allowed payload, the pending item is kept unchanged and the owner should reject or recreate it manually.

Agent-assisted graph cleanup is allowed only through the same safety gates. `internal.analyze_knowledge` and `internal.plan_knowledge_review` are trusted read-only tools. `internal.plan_knowledge_review` converts raw hygiene analysis into prioritized review suggestions with safe next commands/tool calls. `internal.merge_knowledge_entities`, `internal.forget_knowledge_relation`, and `internal.update_knowledge_relation` are local write actions governed by `memory.deletePolicy`, per-tool `internalTools.policies`, and channel/terminal approval when policy asks.

Graph deletion, relation metadata update, and entity merge follow `memory.deletePolicy` through CLI confirmation for `bestie memory graph forget ...`, `bestie memory graph update relation ...`, and `bestie memory graph merge entity ...`.

The local UI exposes the same write surface for owner review: relation metadata updates, relation forget, duplicate entity merge, and pending graph approve/reject. Every UI graph action requires an explicit browser confirmation. If `memory.deletePolicy` or per-tool policy asks for approval, the UI queues a pending action with channel `ui`; approving that item in the Approvals panel executes the stored internal tool payload through the shared approval executor.

The UI inspector surfaces graph provenance from `knowledge_audit_events` when available, with fallback hints from the current SQLite record. Audit events are written for graph entity/relation creation and updates, pending graph queue/approve/reject, relation/entity forget, and entity merge operations. Each event stores subject type/id, event type, actor, channel, reason, payload summary, and creation time. The inspector also keeps a short "why this exists" explanation derived from evidence, source references, graph connectivity, or review policy. UI chat runs emit a `memory_capture` timeline event when post-turn graph reasoning stores, queues, or skips graph candidates. Auto-captured UI chat graph items store source attribution in `source_message_id` using `ui-chat:<sessionId>:message:<assistantMessageId>:run:<runId>` when a persisted chat source exists, and the UI decodes that into a readable source label for entity, relation, and pending item review.

Owner undo is supported through soft-delete graph actions. Relations can be forgotten from the relation inspector, and entities can be forgotten from the entity inspector through the same permission-gated internal action path as other graph writes.

## Retrieval

Before a chat completion, Bestie searches the graph with compact token queries derived from the current user input. It uses one shared retrieval service for terminal, Telegram, Zalo, cron, and UI chat; memory pause disables retrieval everywhere. Candidate facts are ranked by trust, while secret-marked defensive legacy data, low-trust facts, and conflicting relations are excluded from the prompt context. If relevant entities or relations are found, a compact system context block is injected:

```text
Relevant approved local knowledge graph facts. Use them when relevant; do not claim perfect memory.
- relation #1: User --works_on--> Bestie (confidence:0.8 evidence: User is building Bestie.)
- entity #2: [project] Bestie (confidence:0.9 aliases:Bestie Agent)
```

Retrieval is skipped when memory is paused or disabled for the UI chat call.

## CLI

Supported commands:

```bash
bestie memory graph status
bestie memory graph search <query>
bestie memory graph entities [--kind <kind>]
bestie memory graph relations [--limit <n>]
bestie memory graph inspect entity <id>
bestie memory graph inspect relation <id>
bestie memory graph add entity <kind> <name>
bestie memory graph add relation <sourceId> <type> <targetId> [evidence]
bestie memory graph update relation <id> [--confidence <n>] [--evidence <text>] [--scope core|project|session] [--sensitivity normal|sensitive] --yes
bestie memory graph merge entity <primaryId> <duplicateId> --yes
bestie memory graph forget entity|relation <id> [--yes]
bestie memory graph analyze [--json]
bestie memory graph hygiene [--json]
bestie memory graph review [--json] [--limit <n>]
bestie memory graph pending [--limit <n>]
bestie memory graph pending inspect <id>
bestie memory graph approve <id>
bestie memory graph reject <id>
bestie memory graph reject-all --yes
bestie memory graph export
```

## Hygiene

Graph hygiene currently reports:

- possible duplicate entity pairs based on canonical name and alias overlap
- relation conflicts for likely opposing relation types on the same source/target pair
- orphan entities with no active one-hop relations
- low-confidence relations below `0.5`
- pending graph items
- a simple 0-100 score

Cleanup remains manual and review-first. `merge entity` keeps the primary entity, folds the duplicate canonical name and aliases into the primary aliases, redirects active relations, and soft-deletes the duplicate entity.

Agent tool examples:

```json
{"tool":"internal.analyze_knowledge","arguments":{}}
{"tool":"internal.plan_knowledge_review","arguments":{"limit":5}}
{"tool":"internal.merge_knowledge_entities","arguments":{"primaryId":2,"duplicateId":3,"reason":"Bestie Agent is an alias of Bestie."}}
{"tool":"internal.update_knowledge_relation","arguments":{"id":4,"confidence":0.72,"evidence":"Reviewed evidence.","reason":"Relation was inspected and needs confidence/evidence correction."}}
{"tool":"internal.forget_knowledge_relation","arguments":{"id":4,"reason":"Relation is stale or incorrect after review."}}
```
