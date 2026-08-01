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
import { createUiChatSession, getUiChatSessionMessages, runUiChat } from "./chat.js";
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

test("runUiChat sends UI conversation summary to the provider", async () => {
  const paths = await createTempPaths();

  try {
    await prepareRuntime(paths, { writePolicy: "allow" });
    const session = await createUiChatSession("Remember older UI context", paths);
    const store = await SqliteMemoryStore.open(paths);
    try {
      store.upsertConversationSummary({ channel: "ui", userId: `session:${session.session.id}`, content: "Earlier UI context: user chose the codename Lotus.", summarizedMessageId: 12 });
    } finally {
      store.close();
    }

    let providerMessages: ChatCompletionOptions["messages"] | undefined;
    await runUiChat({
      paths,
      sessionId: session.session.id,
      message: "What codename did I choose?",
      chatCompletion: async (_config, _apiKey, options) => {
        if (!isKnowledgeReasoningRequest(options) && providerMessages === undefined) {
          providerMessages = options.messages;
          return "You chose Lotus.";
        }
        return "{}";
      },
    });

    assert.ok(providerMessages?.some((message) => message.role === "system" && typeof message.content === "string" && message.content.includes("Earlier UI context: user chose the codename Lotus.")));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runUiChat keeps the most recent UI history turns", async () => {
  const paths = await createTempPaths();

  try {
    await prepareRuntime(paths, { writePolicy: "allow", recentMessageLimit: 40 });
    const history = Array.from({ length: 45 }, (_value, index) => ({ role: "user" as const, content: `history-${index}` }));
    let providerMessages: ChatCompletionOptions["messages"] | undefined;

    await runUiChat({
      paths,
      history,
      memoryEnabled: false,
      message: "continue",
      chatCompletion: async (_config, _apiKey, options) => {
        providerMessages = options.messages;
        return "Continuing.";
      },
    });

    const serialized = JSON.stringify(providerMessages);
    assert.doesNotMatch(serialized, /history-0/);
    assert.match(serialized, /history-44/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runUiChat loads persisted UI session history when request history is empty", async () => {
  const paths = await createTempPaths();

  try {
    await prepareRuntime(paths, { writePolicy: "allow" });
    const session = await createUiChatSession("Persisted context", paths);
    const store = await SqliteMemoryStore.open(paths);
    try {
      store.addUiChatMessage(session.session.id, "user", "My project codename is Cedar.");
      store.addUiChatMessage(session.session.id, "assistant", "I will remember Cedar for this session.");
    } finally {
      store.close();
    }

    let providerMessages: ChatCompletionOptions["messages"] | undefined;
    await runUiChat({
      paths,
      sessionId: session.session.id,
      history: [],
      memoryEnabled: false,
      message: "What codename did I mention?",
      chatCompletion: async (_config, _apiKey, options) => {
        providerMessages = options.messages;
        return "Cedar.";
      },
    });

    const serialized = JSON.stringify(providerMessages);
    assert.match(serialized, /My project codename is Cedar/);
    assert.match(serialized, /I will remember Cedar/);
    assert.ok(providerMessages?.some((message) => message.role === "user" && message.content === "My project codename is Cedar."));
    assert.ok(providerMessages?.some((message) => message.role === "assistant" && message.content === "I will remember Cedar for this session."));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runUiChat ignores stale provider model refs removed from config", async () => {
  const paths = await createTempPaths();

  try {
    await prepareRuntime(paths, { writePolicy: "allow" });
    const session = await createUiChatSession("Stale provider", paths);

    const store = await SqliteMemoryStore.open(paths);
    try {
      store.updateUiChatSessionPreferences(session.session.id, { providerModelRef: "openrouter/removed-model" });
    } finally {
      store.close();
    }

    let providerModel: string | undefined;
    const result = await runUiChat({
      paths,
      sessionId: session.session.id,
      memoryEnabled: false,
      message: "Hello",
      providerModelRef: "openrouter/removed-model",
      chatCompletion: async (config) => {
        providerModel = config.llm.primary;
        return JSON.stringify({ answer: "ok" });
      },
    });

    assert.equal(providerModel, "openai/test-model");
    assert.equal(result.model, "openai/test-model");
    assert.equal(result.run?.providerModelRef, undefined);
    assert.equal(JSON.parse(result.run?.metadataJson ?? "{}").providerModelRef, undefined);

    const messages = await getUiChatSessionMessages(session.session.id, paths);
    assert.equal(messages.session.providerModelRef, undefined);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runUiChat rejects concurrent messages for the same UI session", async () => {
  const paths = await createTempPaths();

  try {
    await prepareRuntime(paths, { writePolicy: "allow" });
    const session = await createUiChatSession("Concurrent", paths);
    let calls = 0;
    let releaseFirst: (() => void) | undefined;
    let markFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolvePromise) => { markFirstStarted = resolvePromise; });

    const first = runUiChat({
      paths,
      sessionId: session.session.id,
      memoryEnabled: false,
      message: "First",
      chatCompletion: async () => {
        calls += 1;
        markFirstStarted?.();
        await new Promise<void>((resolvePromise) => { releaseFirst = resolvePromise; });
        return JSON.stringify({ answer: "first" });
      },
    });
    await firstStarted;

    await assert.rejects(
      () => runUiChat({
        paths,
        sessionId: session.session.id,
        memoryEnabled: false,
        message: "Second",
        chatCompletion: async () => {
          calls += 1;
          return JSON.stringify({ answer: "second" });
        },
      }),
      /already streaming/,
    );

    assert.equal(calls, 1);
    releaseFirst?.();
    await first;
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runUiChat sends image attachments as provider vision input without storing image data in metadata", async () => {
  const paths = await createTempPaths();

  try {
    await prepareRuntime(paths, { writePolicy: "allow" });
    const session = await createUiChatSession("Image input", paths);
    const imageDataUrl = "data:image/png;base64,iVBORw0KGgo=";
    let providerMessages: ChatCompletionOptions["messages"] | undefined;

    const result = await runUiChat({
      paths,
      sessionId: session.session.id,
      memoryEnabled: false,
      message: "What is in this image?",
      attachments: [{ name: "screen.png", type: "image/png", size: 12, content: imageDataUrl }],
      chatCompletion: async (_config, _apiKey, options) => {
        providerMessages ??= options.messages;
        return JSON.stringify({ answer: "It is an image." });
      },
    });

    const attachmentMessage = providerMessages?.find((message) => message.role === "user" && Array.isArray(message.content));
    assert.ok(Array.isArray(attachmentMessage?.content));
    assert.deepEqual(attachmentMessage?.content[0], { type: "text", text: "What is in this image?\n\nAttached context:\nAttachment 1: screen.png\nType: image/png\nSize: 12 bytes\nContent: [image attached for vision input]" });
    assert.deepEqual(attachmentMessage?.content[1], { type: "image_url", image_url: { url: imageDataUrl } });
    assert.doesNotMatch(JSON.stringify(attachmentMessage?.content[0]), /iVBORw0KGgo/);

    const metadata = JSON.parse(result.run?.metadataJson ?? "{}");
    assert.equal(metadata.attachments?.[0]?.content, "[image data omitted]");
    assert.doesNotMatch(result.run?.metadataJson ?? "", /iVBORw0KGgo/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runUiChat keeps non-image attachments in text context", async () => {
  const paths = await createTempPaths();

  try {
    await prepareRuntime(paths, { writePolicy: "allow" });
    let providerMessages: ChatCompletionOptions["messages"] | undefined;

    await runUiChat({
      paths,
      memoryEnabled: false,
      message: "Read this note.",
      attachments: [{ name: "note.txt", type: "text/plain", size: 11, content: "hello world" }],
      chatCompletion: async (_config, _apiKey, options) => {
        providerMessages ??= options.messages;
        return JSON.stringify({ answer: "Read it." });
      },
    });

    const attachmentMessage = providerMessages?.find((message) => message.role === "user" && typeof message.content === "string" && message.content.includes("Attachment 1: note.txt"));
    assert.equal(typeof attachmentMessage?.content, "string");
    assert.match(String(attachmentMessage?.content), /Attachment 1: note\.txt/);
    assert.match(String(attachmentMessage?.content), /hello world/);
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
