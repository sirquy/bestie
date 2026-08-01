import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { SqliteMemoryStore } from "../dist/memory/sqlite-store.js";
import { writeConfig } from "../dist/runtime/config.js";
import { writeEnvFile } from "../dist/runtime/env.js";

export async function seedUiSmokeRuntime(paths) {
  await mkdir(paths.appDir, { recursive: true });
  await writeConfig(
    {
      version: 2,
      agent: { name: "Bestie", ownerName: "Boss", language: "vi", toneIntensity: 7 },
      llm: {
        primary: "openai/test-model",
        fallbacks: ["gemini/gemini-2.5-flash"],
        authProfile: "openai:api-key",
        profiles: {
          "openai:api-key": { provider: "openai-compatible", mode: "api-key", baseUrl: "http://127.0.0.1:9/v1", apiKeyEnv: "OPENAI_API_KEY" },
          "gemini:api-key": { provider: "gemini", mode: "api-key", apiKeyEnv: "GEMINI_API_KEY" },
        },
        modelCatalog: {
          "openai/test-model": { profile: "openai:api-key" },
          "gemini/gemini-2.5-flash": { profile: "gemini:api-key" },
        },
      },
      memory: { writePolicy: "ask" },
      workspace: { defaultPath: ".bestie/workspace", externalPaths: ["../shared", "/tmp/bestie-ui-shared"] },
      internalTools: { policies: { "internal.exec": "ask", "internal.read_file": "allow", "internal.write_file": "deny" }, exec: { timeoutMs: 120_000 } },
      channels: {
        telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "111" },
        zalo: { enabled: false, botTokenEnv: "BESTIE_ZALO_BOT_TOKEN", ownerUserId: "zalo-owner" },
      },
      mcp: {
        servers: [
          { name: "fs", enabled: true, transport: "stdio", command: "node", args: ["server.js"], env: { MCP_SECRET: "super-secret-mcp" }, tools: [{ name: "read_file", category: "read" }, { name: "COMPOSIO_GET_TOOL_SCHEMAS", category: "read" }] },
          { name: "remote-oauth", enabled: false, transport: "http", url: "https://mcp.example.invalid", headers: { "x-client-name": "bestie-smoke" }, headersEnv: { "x-api-key": "REMOTE_MCP_TOKEN" }, auth: { type: "oauth", authorizationUrl: "https://auth.example.invalid", clientId: "client-id", envVar: "REMOTE_MCP_OAUTH", scopes: ["tools.read"] }, tools: [{ name: "send", category: "public_action" }] },
        ],
      },
    },
    paths,
  );
  await writeEnvFile({ OPENAI_API_KEY: "test-key", GEMINI_API_KEY: "test-gemini-key", BESTIE_TELEGRAM_BOT_TOKEN: "telegram-test-token", REMOTE_MCP_TOKEN: "remote-token-value" }, paths);
  await writeFile(paths.characterPath, `${JSON.stringify({ name: "Bestie", role: "AI best friend companion", language: "vi-first", personality: ["funny", "sharp"], tone: { roastLevel: 2, warmthLevel: 8, bluntnessLevel: 4, chaosLevel: 3 }, boundaries: { neverJokeAbout: ["harm"], dropJokesWhen: ["crisis"] }, ownerName: "Boss" }, null, 2)}\n`, { mode: 0o600 });
  await writeFile(paths.systemPromptPath, "You are Bestie.\n", { mode: 0o600 });
  await mkdir(resolve(paths.appDir, "skills", "smoke-skill"), { recursive: true });
  await writeFile(resolve(paths.appDir, "skills", "smoke-skill", "SKILL.md"), "# Smoke Skill\n\nUse for UI smoke testing.\n", { mode: 0o600 });
  const store = await SqliteMemoryStore.open(paths);
  try {
    store.addMemory({ type: "preference", content: "User prefers concise replies.", source: "smoke", scope: "core" });
    store.addMemory({ type: "project_context", content: "Working on Bestie UI memory center.", source: "smoke", scope: "project" });
    store.addPendingMemory({ type: "sensitive_personal", content: "Review this memory before saving.", reason: "Sensitive memory requires approval.", source: "smoke" });
    const user = store.upsertKnowledgeEntity({ canonicalName: "User", kind: "person", aliases: ["Boss"], confidence: 0.9 });
    const bestie = store.upsertKnowledgeEntity({ canonicalName: "Bestie", kind: "project", aliases: ["Bestie Agent"], confidence: 0.86 });
    const ui = store.upsertKnowledgeEntity({ canonicalName: "Bestie UI", kind: "project", aliases: ["Local Console"], confidence: 0.74 });
    store.upsertKnowledgeRelation({ sourceEntityId: user.id, relationType: "works_on", targetEntityId: bestie.id, evidence: "Smoke user is building Bestie.", confidence: 0.82 });
    store.upsertKnowledgeRelation({ sourceEntityId: bestie.id, relationType: "includes", targetEntityId: ui.id, evidence: "Bestie UI is part of the local console.", confidence: 0.78 });
    const schedule = store.addCronSchedule({ name: "Daily check", scheduleType: "cron_expr", scheduleValue: "0 8 * * *", prompt: "Send a short update.", channel: "telegram:111", nextRunAt: new Date(Date.now() + 60_000).toISOString() });
    const log = store.createCronLog(schedule.id);
    store.finishCronLog(log.id, "ok", "Smoke cron output");
    store.addPendingActionApproval({ channel: "telegram", userId: "111", category: "local_write", action: "internal.write_file", target: "workspace/note.txt", reason: "Smoke approval", proposedReason: "Write a note", payloadJson: JSON.stringify({ path: "workspace/note.txt", content: "secret-ish payload" }) });
    const chatSession = store.createUiChatSession("Approval chat");
    const chatUserMessage = store.addUiChatMessage(chatSession.id, "user", "Please run approval smoke.");
    const chatAttachments = [{ name: "smoke-note.md", type: "text/markdown", size: 18, chars: 18, content: "# Smoke attachment" }];
    const chatRun = store.createUiChatRun(chatSession.id, { model: "openai/test-model", providerModelRef: "openai/test-model", userMessageId: chatUserMessage.id, metadataJson: JSON.stringify({ inputChars: chatUserMessage.content.length, outputChars: 74, toolCalls: 1, attachmentCount: chatAttachments.length, attachments: chatAttachments }) });
    const chatAssistantMessage = store.addUiChatMessage(chatSession.id, "assistant", "**Ready** for `approval`:\n- check one\n- check two\n\n```\nbestie doctor\n```", chatRun.id);
    store.finishUiChatRun(chatRun.id, { status: "done", assistantMessageId: chatAssistantMessage.id, metadataJson: JSON.stringify({ inputChars: chatUserMessage.content.length, output: chatAssistantMessage.content, outputChars: chatAssistantMessage.content.length, toolCalls: 1, attachmentCount: chatAttachments.length, attachments: chatAttachments }) });
    const graphSource = `ui-chat:${chatSession.id}:message:${chatAssistantMessage.id}:run:${chatRun.id}`;
    store.upsertKnowledgeEntity({ canonicalName: "Bestie UI", kind: "project", aliases: ["Local Console"], confidence: 0.74, sourceMessageId: graphSource });
    store.upsertKnowledgeRelation({ sourceEntityId: bestie.id, relationType: "includes", targetEntityId: ui.id, evidence: "Bestie UI is part of the local console.", confidence: 0.78, sourceMessageId: graphSource });
    store.addPendingKnowledgeItem({ payload: { entities: [{ name: "Graph Review", kind: "topic" }], relations: [] }, reason: "Review graph smoke payload.", source: graphSource });
    store.forkUiChatSession(chatSession.id, chatUserMessage.id, "Approval chat fork");
    store.addUiChatEvent(chatSession.id, "approval_required", "internal.exec requires approval", JSON.stringify({ approvalId: 999, category: "local_write", target: ".", proposedReason: "Smoke chat approval" }), chatRun.id);
    store.addUiChatEvent(chatSession.id, "done", "Assistant response completed", JSON.stringify({ characters: chatAssistantMessage.content.length, toolCalls: 1 }), chatRun.id);
    const replayRun = store.createUiChatRun(chatSession.id, { model: "openai/test-model", providerModelRef: "openai/test-model", userMessageId: chatUserMessage.id, metadataJson: JSON.stringify({ inputChars: chatUserMessage.content.length, replaySourceRunId: chatRun.id }) });
    const replayAssistantMessage = store.addUiChatMessage(chatSession.id, "assistant", "**Ready** for `approval` replay:\n- check one\n- changed replay\n\n```\nbestie doctor --verbose\n```", replayRun.id);
    store.finishUiChatRun(replayRun.id, { status: "done", assistantMessageId: replayAssistantMessage.id, metadataJson: JSON.stringify({ inputChars: chatUserMessage.content.length, output: replayAssistantMessage.content, outputChars: replayAssistantMessage.content.length, toolCalls: 0, replaySourceRunId: chatRun.id }) });
    store.addUiChatEvent(chatSession.id, "done", "Replay response completed", JSON.stringify({ characters: replayAssistantMessage.content.length, toolCalls: 0 }), replayRun.id);
    store.updateUiChatSessionPinned(chatSession.id, true);
  } finally {
    store.close();
  }
}

export function createUiSmokeRuntimePaths(root) {
  const appDir = resolve(root, ".bestie");
  const logsDir = resolve(appDir, "logs");
  const dataDir = resolve(appDir, "data");

  return {
    rootDir: root,
    appDir,
    configPath: resolve(appDir, "config.json"),
    envPath: resolve(appDir, ".env"),
    characterPath: resolve(appDir, "character.json"),
    systemPromptPath: resolve(appDir, "system-prompt.md"),
    logsDir,
    appLogPath: resolve(logsDir, "app.log"),
    dataDir,
    memoryDbPath: resolve(dataDir, "memory.sqlite"),
    workspaceDir: resolve(appDir, "workspace"),
  };
}
