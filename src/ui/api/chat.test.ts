import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import type { ChatCompletionOptions } from "../../llm/types.js";
import { writeConfig, type AppConfig } from "../../runtime/config.js";
import { writeEnvFile } from "../../runtime/env.js";
import type { RuntimePaths } from "../../runtime/paths.js";
import { SqliteMemoryStore } from "../../memory/sqlite-store.js";
import { createUiChatSession, runUiChat } from "./chat.js";
import { getUiKnowledgeGraphSummary } from "./knowledge-graph.js";

test("runUiChat captures knowledge graph memory after completed UI turns", async () => {
  const paths = await createTempPaths();

  try {
    await prepareRuntime(paths, { writePolicy: "allow" });
    const session = await createUiChatSession("Graph capture", paths);
    const timelineEvents: string[] = [];

    const result = await runUiChat({
      paths,
      sessionId: session.session.id,
      message: "I am building Bestie with SQLite memory.",
      chatCompletion: async (_config, _apiKey, options) => isKnowledgeReasoningRequest(options)
        ? JSON.stringify({
          entities: [
            { name: "User", kind: "person", confidence: 0.9 },
            { name: "Bestie", kind: "project", aliases: ["Bestie Agent"], confidence: 0.9 },
            { name: "SQLite", kind: "tool", confidence: 0.9 },
          ],
          relations: [
            { sourceName: "User", sourceKind: "person", type: "works_on", targetName: "Bestie", targetKind: "project", evidence: "User is building Bestie.", confidence: 0.88 },
            { sourceName: "Bestie", sourceKind: "project", type: "depends_on", targetName: "SQLite", targetKind: "tool", evidence: "Bestie uses SQLite memory.", confidence: 0.86 },
          ],
        })
        : "Captured.",
      onTimelineEvent: (event) => {
        timelineEvents.push(event.type);
      },
    });

    assert.equal(result.answer, "Captured.");
    assert.ok(timelineEvents.includes("memory_capture"));

    const store = await SqliteMemoryStore.open(paths);
    try {
      assert.deepEqual(store.listKnowledgeEntities().map((entity) => `${entity.kind}:${entity.canonicalName}`).sort(), ["person:User", "project:Bestie", "tool:SQLite"].sort());
      assert.deepEqual(store.listKnowledgeRelations().map((relation) => relation.relationType).sort(), ["depends_on", "works_on"]);
      assert.ok(store.listKnowledgeEntities().every((entity) => entity.sourceMessageId?.startsWith(`ui-chat:${session.session.id}:message:`)));
      assert.ok(store.listKnowledgeRelations().every((relation) => relation.sourceMessageId?.startsWith(`ui-chat:${session.session.id}:message:`)));
      assert.equal(store.listPendingKnowledgeItems().length, 0);
      assert.ok(store.listUiChatEvents(session.session.id).some((event) => event.eventType === "memory_capture"));
    } finally {
      store.close();
    }

    const graph = await getUiKnowledgeGraphSummary(paths);
    assert.ok(graph.entities.every((entity) => entity.source?.kind === "ui_chat"));
    assert.ok(graph.relations.every((relation) => relation.source?.chatSessionId === session.session.id));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runUiChat queues captured graph memory when memory writes ask", async () => {
  const paths = await createTempPaths();

  try {
    await prepareRuntime(paths, { writePolicy: "ask" });
    const session = await createUiChatSession("Graph pending", paths);

    await runUiChat({
      paths,
      sessionId: session.session.id,
      message: "Bestie depends on SQLite.",
      chatCompletion: async (_config, _apiKey, options) => isKnowledgeReasoningRequest(options)
        ? JSON.stringify({
          entities: [{ name: "Bestie", kind: "project", confidence: 0.9 }, { name: "SQLite", kind: "tool", confidence: 0.9 }],
          relations: [{ sourceName: "Bestie", sourceKind: "project", type: "depends_on", targetName: "SQLite", targetKind: "tool", confidence: 0.9 }],
        })
        : "Noted.",
    });

    const store = await SqliteMemoryStore.open(paths);
    try {
      assert.equal(store.listKnowledgeEntities().length, 0);
      const pending = store.listPendingKnowledgeItems();
      assert.equal(pending.length, 1);
      assert.equal(pending[0]?.source, "reasoning:ui");
      assert.match(JSON.stringify(pending[0]?.payload), /ui-chat:/);
      assert.match(pending[0]?.reason ?? "", /Reasoned from ui conversation/);
    } finally {
      store.close();
    }

    const graph = await getUiKnowledgeGraphSummary(paths);
    assert.equal(graph.pending[0]?.sourceAttribution?.kind, "ui_chat");
    assert.equal(graph.pending[0]?.sourceAttribution?.chatSessionId, session.session.id);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

function isKnowledgeReasoningRequest(options: ChatCompletionOptions): boolean {
  const system = options.messages.find((message) => message.role === "system")?.content;
  return typeof system === "string" && system.includes("knowledge graph reasoning pass");
}

async function prepareRuntime(paths: RuntimePaths, memory: NonNullable<AppConfig["memory"]>): Promise<void> {
  await mkdir(paths.appDir, { recursive: true });
  await writeFile(paths.systemPromptPath, "You are Bestie.\n", { mode: 0o600 });
  await writeConfig({ ...createConfig(), memory }, paths);
  await writeEnvFile({ OPENAI_API_KEY: "test-key" }, paths);
}

function createConfig(): AppConfig {
  return {
    version: 2,
    agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
    llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key",
          baseUrl: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      },
    },
  };
}

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-ui-chat-graph-test-"));
  const appDir = resolve(rootDir, ".bestie");
  const logsDir = resolve(appDir, "logs");
  const dataDir = resolve(appDir, "data");

  return {
    rootDir,
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
