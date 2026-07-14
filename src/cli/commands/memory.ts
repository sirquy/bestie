import { evaluateMemoryCandidate, type MemoryType } from "../../memory/policy.js";
import { SqliteMemoryStore, type PendingMemory, type StoredMemory, type StoredMessageRole } from "../../memory/sqlite-store.js";
import { badge, dim, rule, title } from "../ui.js";

const allowedTypes = new Set<MemoryType>([
  "preference",
  "communication_preference",
  "user_fact",
  "project_context",
  "durable_decision",
  "sensitive_personal",
  "secret",
  "one_off",
]);

export async function runMemoryCommand(argv: string[] = process.argv): Promise<void> {
  const subcommand = argv[3] ?? "list";

  if (subcommand === "status") {
    await showMemoryStatus();
    return;
  }

  if (subcommand === "pause") {
    await setMemoryPaused(true);
    return;
  }

  if (subcommand === "resume") {
    await setMemoryPaused(false);
    return;
  }

  if (subcommand === "list") {
    await listMemories();
    return;
  }

  if (subcommand === "add") {
    await addMemory(argv);
    return;
  }

  if (subcommand === "search") {
    await searchMemories(argv);
    return;
  }

  if (subcommand === "inspect") {
    await inspectMemory(argv);
    return;
  }

  if (subcommand === "edit") {
    await editMemory(argv);
    return;
  }

  if (subcommand === "forget" || subcommand === "delete") {
    await forgetMemory(argv);
    return;
  }

  if (subcommand === "clear") {
    await clearMemoryData(argv);
    return;
  }

  if (subcommand === "export") {
    await exportMemoryData();
    return;
  }

  if (subcommand === "messages") {
    await listRecentMessages(argv);
    return;
  }

  if (subcommand === "pending") {
    if (argv[4] === "inspect") {
      await inspectPendingMemory(argv);
      return;
    }

    if (argv[4] === "search") {
      await searchPendingMemories(argv);
      return;
    }

    await listPendingMemories(argv);
    return;
  }

  if (subcommand === "approve") {
    await approvePendingMemory(argv);
    return;
  }

  if (subcommand === "reject-all") {
    await rejectAllPendingMemories(argv);
    return;
  }

  if (subcommand === "reject") {
    await rejectPendingMemory(argv);
    return;
  }

  console.error(`Unknown memory command: ${subcommand}`);
  console.error("Usage: bestie memory status | pause | resume | list | search <query> | add <type> <content> | inspect <id> | edit <id> <content> | forget <id> | messages [--limit <n>] [--role user|assistant|system] | messages search <query> [--limit <n>] [--role user|assistant|system] | export | clear --yes | pending [--limit <n>] | pending search <query> [--limit <n>] | pending inspect <id> | approve <id> | reject <id> | reject-all --yes");
  process.exitCode = 1;
}

async function showMemoryStatus(): Promise<void> {
  const store = await SqliteMemoryStore.open();

  try {
    const state = store.getMemoryState();
    console.log(`${state.paused ? badge("PAUSED", "yellow") : badge("ACTIVE", "green")} Memory is ${state.paused ? "paused" : "active"}.`);
  } finally {
    store.close();
  }
}

async function setMemoryPaused(paused: boolean): Promise<void> {
  const store = await SqliteMemoryStore.open();

  try {
    const state = store.setMemoryPaused(paused);
    console.log(`${state.paused ? badge("PAUSED", "yellow") : badge("ACTIVE", "green")} Memory is ${state.paused ? "paused" : "active"}.`);
  } finally {
    store.close();
  }
}

async function listMemories(): Promise<void> {
  const store = await SqliteMemoryStore.open();

  try {
    const memories = store.listActiveMemories();

    if (memories.length === 0) {
      console.log(`${badge("INFO", "blue")} No active memories yet.`);
      return;
    }

    console.log(title(`Active Memories (${memories.length})`));
    console.log(rule());
    for (const memory of memories) {
      console.log(formatActiveMemoryLine(memory));
    }
  } finally {
    store.close();
  }
}

async function searchMemories(argv: string[]): Promise<void> {
  const query = argv.slice(4).join(" ").trim();

  if (query.length === 0) {
    console.error("Usage: bestie memory search <query>");
    process.exitCode = 1;
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    const memories = store.searchMemories(query);

    if (memories.length === 0) {
      console.log(`${badge("INFO", "blue")} No matching active memories.`);
      return;
    }

    console.log(title(`Matching Active Memories (${memories.length})`));
    console.log(rule());
    for (const memory of memories) {
      console.log(formatActiveMemoryLine(memory));
    }
  } finally {
    store.close();
  }
}

async function addMemory(argv: string[]): Promise<void> {
  const type = argv[4];
  const content = argv.slice(5).join(" ").trim();

  if (!isMemoryType(type)) {
    console.error("Memory type must be one of: preference, communication_preference, user_fact, project_context, durable_decision, sensitive_personal, secret, one_off.");
    process.exitCode = 1;
    return;
  }

  const policy = evaluateMemoryCandidate({ type, content });
  const stateStore = await SqliteMemoryStore.open();

  try {
    if (stateStore.getMemoryState().paused) {
      console.log(`${badge("PAUSED", "yellow")} Memory is paused. Run \`bestie memory resume\` before adding memories.`);
      return;
    }
  } finally {
    stateStore.close();
  }

  if (policy.decision === "pending") {
    const store = await SqliteMemoryStore.open();

    try {
      const pending = store.addPendingMemory({ type, content, reason: policy.reason, source: "manual-command" });
      console.log(`${badge("PENDING", "yellow")} Memory pending approval: ${pending.id}`);
      console.log(policy.reason);
      console.log(`Next: bestie memory pending inspect ${pending.id}`);
      console.log(`Then: bestie memory approve ${pending.id} or bestie memory reject ${pending.id}`);
      return;
    } finally {
      store.close();
    }
  }

  if (policy.decision !== "store") {
    console.log(`${badge("SKIP", "yellow")} Memory not stored: ${policy.reason}`);
    console.log(`Decision: ${policy.decision}`);
    return;
  }

  if (policy.sensitivity === "secret") {
    console.log(`${badge("SKIP", "yellow")} Memory not stored: ${policy.reason}`);
    console.log("Decision: never");
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    const memory = store.addMemory({
      type,
      content,
      sensitivity: policy.sensitivity,
      source: "manual-command",
      explicitConsent: true,
      policyReason: policy.reason,
    });
    console.log(`${badge("STORED", "green")} Memory stored: ${memory.id}`);
  } finally {
    store.close();
  }
}

async function inspectMemory(argv: string[]): Promise<void> {
  const id = parsePositiveId(argv[4]);

  if (!id) {
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    const memory = store.listAllMemories().find((item) => item.id === id);

    if (!memory) {
      console.log(`No memory found for id ${id}.`);
      return;
    }

    console.log(JSON.stringify(memory, null, 2));
  } finally {
    store.close();
  }
}

async function editMemory(argv: string[]): Promise<void> {
  const id = parsePositiveId(argv[4]);
  const content = argv.slice(5).join(" ").trim();

  if (!id) {
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    if (store.getMemoryState().paused) {
      console.log(`${badge("PAUSED", "yellow")} Memory is paused. Run \`bestie memory resume\` before editing memories.`);
      return;
    }

    const current = store.getActiveMemory(id);

    if (!current) {
      console.log(`${badge("INFO", "blue")} No active memory found for id ${id}.`);
      return;
    }

    const policy = evaluateMemoryCandidate({ type: current.type as MemoryType, content, explicitConsent: current.sensitivity === "sensitive" });

    if (policy.decision !== "store" || policy.sensitivity === "secret") {
      console.log(`${badge("SKIP", "yellow")} Memory not updated: ${policy.reason}`);
      console.log(`Decision: ${policy.decision === "store" ? "never" : policy.decision}`);
      return;
    }

    const updated = store.updateMemoryContent(id, content);

    if (!updated) {
      console.log(`${badge("INFO", "blue")} No active memory found for id ${id}.`);
      return;
    }

    console.log(`${badge("UPDATED", "green")} Memory updated: ${updated.id}`);
  } finally {
    store.close();
  }
}

async function forgetMemory(argv: string[]): Promise<void> {
  const id = parsePositiveId(argv[4]);

  if (!id) {
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    const forgotten = store.forgetMemory(id);

    if (!forgotten) {
      console.log(`${badge("INFO", "blue")} No active memory found for id ${id}.`);
      return;
    }

    console.log(`${badge("FORGOT", "green")} Memory forgotten: ${id}`);
  } finally {
    store.close();
  }
}

async function clearMemoryData(argv: string[]): Promise<void> {
  if (!argv.includes("--yes")) {
    console.log("Memory not cleared. Re-run with `bestie memory clear --yes` to delete memories, pending memories, and persisted messages.");
    process.exitCode = 1;
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    store.clearAllData();
    console.log(`${badge("CLEARED", "green")} Memory data cleared.`);
  } finally {
    store.close();
  }
}

async function exportMemoryData(): Promise<void> {
  const store = await SqliteMemoryStore.open();

  try {
    console.log(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          memories: store.listAllMemories(),
          pendingMemories: store.listPendingMemories(Number.MAX_SAFE_INTEGER),
          messages: store.listAllMessages(),
        },
        null,
        2,
      ),
    );
  } finally {
    store.close();
  }
}

async function listRecentMessages(argv: string[] = process.argv): Promise<void> {
  const isSearch = argv[4] === "search";
  const query = isSearch ? parseMessageSearchQuery(argv) : "";
  const limit = parseLimitOption(argv, 20);
  const role = parseRoleOption(argv);

  if (!limit || role === false) {
    return;
  }

  if (isSearch && query.length === 0) {
    console.error("Usage: bestie memory messages search <query> [--limit <n>]");
    process.exitCode = 1;
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    const messages = isSearch ? store.searchMessages(query, limit, role) : store.listRecentMessages(limit, role);

    if (messages.length === 0) {
      console.log(`${badge("INFO", "blue")} ${isSearch ? "No matching persisted messages." : "No persisted messages yet."}`);
      return;
    }

    console.log(title(isSearch ? `Matching Messages (${messages.length})` : `Recent Messages (${messages.length})`));
    console.log(rule());
    for (const message of messages) {
      console.log(`${badge(message.role.toUpperCase(), message.role === "assistant" ? "magenta" : message.role === "user" ? "green" : "cyan")} #${message.id} ${dim(message.channel ?? "unknown")} ${message.content}`);
    }
  } finally {
    store.close();
  }
}

async function listPendingMemories(argv: string[] = process.argv): Promise<void> {
  const limit = parseLimitOption(argv, 20);

  if (!limit) {
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    const memories = store.listPendingMemories(limit);

    if (memories.length === 0) {
      console.log(`${badge("INFO", "blue")} No pending memories.`);
      return;
    }

    console.log(title(`Pending Memories (${memories.length})`));
    console.log(rule());
    for (const memory of memories) {
      console.log(formatPendingMemoryBlock(memory));
    }
    console.log(`${badge("NEXT", "cyan")} Approve with \`bestie memory approve <id>\` or reject with \`bestie memory reject <id>\`. Inspect details with \`bestie memory pending inspect <id>\`.`);
  } finally {
    store.close();
  }
}

async function searchPendingMemories(argv: string[]): Promise<void> {
  const query = parsePendingSearchQuery(argv);
  const limit = parseLimitOption(argv, 20);

  if (!limit) {
    return;
  }

  if (query.length === 0) {
    console.error("Usage: bestie memory pending search <query> [--limit <n>]");
    process.exitCode = 1;
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    const memories = store.searchPendingMemories(query, limit);

    if (memories.length === 0) {
      console.log(`${badge("INFO", "blue")} No matching pending memories.`);
      return;
    }

    console.log(title(`Matching Pending Memories (${memories.length})`));
    console.log(rule());
    for (const memory of memories) {
      console.log(formatPendingMemoryBlock(memory));
    }
    console.log(`${badge("NEXT", "cyan")} Approve with \`bestie memory approve <id>\` or reject with \`bestie memory reject <id>\`. Inspect details with \`bestie memory pending inspect <id>\`.`);
  } finally {
    store.close();
  }
}

async function inspectPendingMemory(argv: string[]): Promise<void> {
  const id = parsePositiveId(argv[5]);

  if (!id) {
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    const memory = store.getPendingMemoryById(id);

    if (!memory) {
      console.log(`No pending memory found for id ${id}.`);
      return;
    }

    console.log(JSON.stringify(memory, null, 2));
  } finally {
    store.close();
  }
}

async function approvePendingMemory(argv: string[]): Promise<void> {
  const id = parsePositiveId(argv[4]);

  if (!id) {
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    if (store.getMemoryState().paused) {
      console.log(`${badge("PAUSED", "yellow")} Memory is paused. Run \`bestie memory resume\` before approving pending memories.`);
      return;
    }

    const memory = store.approvePendingMemory(id);

    if (!memory) {
      console.log(`${badge("INFO", "blue")} No pending memory found for id ${id}.`);
      return;
    }

    console.log(`${badge("APPROVED", "green")} Pending memory approved: ${id} -> memory ${memory.id}`);
    console.log(formatActiveMemoryLine(memory));
  } finally {
    store.close();
  }
}

async function rejectAllPendingMemories(argv: string[]): Promise<void> {
  if (!argv.includes("--yes")) {
    console.log("Pending memories not rejected. Re-run with `bestie memory reject-all --yes` to clear the pending queue.");
    process.exitCode = 1;
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    const rejectedCount = store.rejectAllPendingMemories();
    console.log(`${badge("REJECTED", "green")} Pending memories rejected: ${rejectedCount}`);
  } finally {
    store.close();
  }
}

async function rejectPendingMemory(argv: string[]): Promise<void> {
  const id = parsePositiveId(argv[4]);

  if (!id) {
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    const rejected = store.rejectPendingMemory(id);

    if (!rejected) {
      console.log(`${badge("INFO", "blue")} No pending memory found for id ${id}.`);
      return;
    }

    console.log(`${badge("REJECTED", "green")} Pending memory rejected: ${id}`);
  } finally {
    store.close();
  }
}

function formatActiveMemoryLine(memory: StoredMemory): string {
  return `${badge(memory.type.toUpperCase(), "cyan")} #${memory.id} importance ${memory.importance} ${dim(`${memory.sensitivity}; updated ${memory.updatedAt}`)} ${memory.content}`;
}

function formatPendingMemoryBlock(memory: PendingMemory): string {
  const lines = [`${badge(memory.type.toUpperCase(), "yellow")} #${memory.id} ${dim(`created ${memory.createdAt}`)} ${memory.content}`];

  if (memory.reason) {
    lines.push(`   Reason: ${memory.reason}`);
  }

  lines.push(`   Next: bestie memory pending inspect ${memory.id}`);
  return lines.join("\n");
}

function parsePendingSearchQuery(argv: string[]): string {
  const queryParts: string[] = [];

  for (let index = 5; index < argv.length; index += 1) {
    if (argv[index] === "--limit") {
      index += 1;
      continue;
    }

    queryParts.push(argv[index]);
  }

  return queryParts.join(" ").trim();
}

function parseMessageSearchQuery(argv: string[]): string {
  const queryParts: string[] = [];

  for (let index = 5; index < argv.length; index += 1) {
    if (argv[index] === "--limit" || argv[index] === "--role") {
      index += 1;
      continue;
    }

    queryParts.push(argv[index]);
  }

  return queryParts.join(" ").trim();
}

function parseRoleOption(argv: string[]): StoredMessageRole | undefined | false {
  const roleFlagIndex = argv.indexOf("--role");

  if (roleFlagIndex === -1) {
    return undefined;
  }

  const role = argv[roleFlagIndex + 1];

  if (role === "user" || role === "assistant" || role === "system") {
    return role;
  }

  console.error("--role must be one of: user, assistant, system.");
  process.exitCode = 1;
  return false;
}

function parseLimitOption(argv: string[], defaultLimit: number): number | undefined {
  const limitFlagIndex = argv.indexOf("--limit");

  if (limitFlagIndex === -1) {
    return defaultLimit;
  }

  const value = Number(argv[limitFlagIndex + 1]);

  if (!Number.isInteger(value) || value <= 0) {
    console.error("--limit must be a positive integer.");
    process.exitCode = 1;
    return undefined;
  }

  return value;
}

function parsePositiveId(value: string | undefined): number | undefined {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    console.error("Memory id must be a positive integer.");
    process.exitCode = 1;
    return undefined;
  }

  return id;
}

function isMemoryType(type: string | undefined): type is MemoryType {
  return typeof type === "string" && allowedTypes.has(type as MemoryType);
}
