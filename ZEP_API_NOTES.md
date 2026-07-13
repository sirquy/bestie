# Zep API Notes for Bestie

## What Zep Is

Zep is an agent memory platform. It stores user/application context as temporal knowledge graphs and returns prompt-ready memory context for agents.

For this project, Zep is useful as the long-term memory layer for the bestie:

- remember user facts and preferences
- remember emotional patterns and recurring topics
- store chat/thread history
- retrieve relevant context before each reply
- keep facts temporal, so newer facts can invalidate older facts

## Core Concepts

### User

A user represents one real end user of the application. Each user can have a user graph and thread history.

For Bestie:

- one human account = one Zep user
- use a stable internal user id, not a Telegram display name
- example: `telegram_914093548`

### Thread

A thread is a conversation/session under a user.

For Bestie:

- use one long-running thread per chat surface, or
- use separate threads for major contexts such as `daily_chat`, `work_brainstorm`, `emotional_support`

Simple MVP recommendation:

```text
user_id: telegram_914093548
thread_id: main_telegram_chat
```

### Messages

Messages are conversation turns added to a thread. Zep can extract facts/entities/relationships from them asynchronously.

Recommended pattern:

1. User sends message.
2. App retrieves memory/context from Zep.
3. LLM replies using that context.
4. App writes both user message and assistant reply back to Zep.

### Context Block

Zep returns a prompt-ready context block containing relevant user summary and facts. This is the main thing to inject into the agent prompt.

For Bestie, place it below the persona prompt and above the live user message.

Example prompt layout:

```text
[System persona]
You are the bestie...

[Relevant memory from Zep]
<Zep context block here>

[Current user message]
...
```

### Graph / User Graph

Zep stores memory as a temporal graph:

- nodes = entities
- edges = facts/relationships
- episodes = source moments/documents/messages
- facts can become invalid later while history is preserved

This is useful for a companion because people change. The agent should not cling to stale facts forever.

## MVP Integration Flow

```text
Telegram/Web message received
  -> get or create Zep user
  -> get or create thread
  -> retrieve Zep memory/context for current message
  -> build prompt with persona + memory + current message
  -> call LLM
  -> send reply
  -> add user message + assistant reply to Zep thread
```

## Pseudocode

```ts
const userId = `telegram_${telegramUserId}`;
const threadId = `main_${telegramChatId}`;

await zep.user.add({ userId }); // or get/create wrapper
await zep.thread.create({ threadId, userId }); // if not exists

const memory = await zep.thread.getUserContext(threadId, {
  query: userMessage,
});

const prompt = buildPrompt({
  persona: aiBestieSystemPrompt,
  memoryContext: memory.context,
  userMessage,
});

const assistantReply = await callLLM(prompt);

await zep.thread.addMessages(threadId, {
  messages: [
    { role: 'user', content: userMessage },
    { role: 'assistant', content: assistantReply },
  ],
});
```

Note: exact method names depend on the current Zep SDK version. Check the SDK docs when coding.

## What To Store In Zep

Good memory candidates:

- user's name and preferred form of address
- relationship dynamic with the agent
- communication preferences
- ongoing projects
- emotional patterns
- recurring worries/goals
- personal principles and boundaries
- inside jokes
- important decisions

Do not blindly store everything. A companion that remembers every tiny sentence feels creepy and noisy.

## Suggested Memory Rules

Store automatically:

- explicit preferences
- recurring project context
- durable identity facts
- important decisions

Ask before storing:

- sensitive personal details
- family/relationship details
- health/mental health details
- secrets

Do not store:

- one-off venting details unless the user asks
- passwords, tokens, bank details
- anything that would feel invasive later

## Zep vs Local Memory

For this project:

- local SQLite is enough for the first prototype
- Zep becomes useful when the agent needs better long-term memory, graph relationships, and temporal fact invalidation

Recommended path:

1. Build MVP with SQLite memory first.
2. Add Zep as the memory engine once the chat loop works.
3. Keep a small local memory review UI/log even when using Zep.

## Practical First Zep Tasks

When coding starts, implement these first:

1. Create/get user by stable id.
2. Create/get main thread.
3. Add messages after each turn.
4. Retrieve context before each reply.
5. Inject context into prompt.
6. Add a debug command to show the context block used for a reply.

## Risks

- Over-remembering can make the agent feel creepy.
- Bad memory retrieval can make replies weird or overconfident.
- Stale facts need handling; this is where Zep's temporal graph helps.
- Cost/lock-in should be checked before relying on Zep in production.
- Memory must have delete/export controls if this becomes a real product.

## Recommendation For Bestie

Use Zep for memory after the character feels good in basic chat.

Best architecture:

```text
Persona + style examples = local files
Conversation state = local DB
Long-term user memory = Zep
Audit/debug logs = local files or DB
```

Do not outsource the entire personality to Zep. Zep should remember facts and context; the character should still be defined by our own prompt and character files.
