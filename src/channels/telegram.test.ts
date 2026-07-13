import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import type { AppConfig } from "../runtime/config.js";
import { writeConfig } from "../runtime/config.js";
import { writeEnvFile } from "../runtime/env.js";
import { appendLog } from "../runtime/logger.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { ProviderFallbackError, ProviderTimeoutError } from "../llm/errors.js";
import { SqliteMemoryStore } from "../memory/sqlite-store.js";
import { runAgentToolRequest } from "../chat/mcp-tool-use.js";
import type { ChannelTranscript } from "./attachments.js";
import { TelegramHttpClient, createTelegramOutboundAdapter, createTelegramRuntimeAdapter, formatTelegramDoctorSummary, handleTelegramUpdate, mapTelegramIncomingMessage, runTelegramPollingLoop, type TelegramClient, type TelegramUpdate } from "./telegram.js";

const config: AppConfig = {
  version: 1,
  agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
  llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "example-model", apiKeyEnv: "OPENAI_API_KEY" },
  channels: { telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "12345" } },
};

const execFileAsync = promisify(execFile);

test("mapTelegramIncomingMessage normalizes owner text and captions", () => {
  const textMessage = createTextUpdate("hello", 12345).message!;
  const textIncoming = mapTelegramIncomingMessage(textMessage);

  assert.equal(textIncoming.chatId, 777);
  assert.equal(textIncoming.messageId, 10);
  assert.equal(textIncoming.senderId, "12345");
  assert.equal(textIncoming.text, "hello");
  assert.equal(textIncoming.raw, textMessage);

  const captionMessage = createPhotoUpdate(12345, 2, "look").message!;
  const captionIncoming = mapTelegramIncomingMessage(captionMessage);

  assert.equal(captionIncoming.chatId, 777);
  assert.equal(captionIncoming.messageId, 10);
  assert.equal(captionIncoming.senderId, "12345");
  assert.equal(captionIncoming.caption, "look");
});

test("createTelegramOutboundAdapter wires responses and typing activity", async () => {
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  const editedMessages: Array<{ chatId: number; messageId: number; text: string }> = [];
  const chatActions: Array<{ chatId: number; action: string }> = [];
  const client = createRecordingClient(sentMessages, chatActions, editedMessages);
  const outbound = createTelegramOutboundAdapter(client, 1_000);

  const response = outbound.createResponseAdapter(777);
  const progress = await response.sendMessage("working");
  assert.ok(progress);
  assert.equal(progress.messageId, 1000);
  await response.editMessage(progress.messageId, "done");
  await outbound.createActivityOptions(777, "typing").client.sendChatAction(777, "typing");

  assert.deepEqual(sentMessages, [{ chatId: 777, text: "working" }]);
  assert.deepEqual(editedMessages, [{ chatId: 777, messageId: 1000, text: "done" }]);
  assert.deepEqual(chatActions, [{ chatId: 777, action: "typing" }]);
  assert.deepEqual(response.splitMessage("short"), ["short"]);
});

test("createTelegramRuntimeAdapter exposes descriptor, outbound, and attachment mapping", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  const update = createPhotoUpdate(12345, 1, "look");

  try {
    const adapter = createTelegramRuntimeAdapter(update, {
      config,
      paths,
      client: createRecordingClient(sentMessages),
    });
    const incoming = mapTelegramIncomingMessage(update.message!);
    const attachment = adapter.attachments?.getAttachment(incoming);

    assert.equal(adapter.descriptor.id, "telegram");
    assert.equal(adapter.outbound.createResponseAdapter(777).splitMessage("short").length, 1);
    assert.equal(attachment?.kind, "photo");
    assert.equal(attachment?.fileId, "photo-1");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate ignores non-owner messages", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];

  try {
    const result = await handleTelegramUpdate(createTextUpdate("/start", 99999), {
      config,
      paths,
      client: createRecordingClient(sentMessages),
    });

    assert.equal(result, "ignored");
    assert.deepEqual(sentMessages, []);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate replies to owner start and help commands", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];

  try {
    const startResult = await handleTelegramUpdate(createTextUpdate("/start", 12345), {
      config,
      paths,
      client: createRecordingClient(sentMessages),
    });
    const helpResult = await handleTelegramUpdate(createTextUpdate("/help", 12345), {
      config,
      paths,
      client: createRecordingClient(sentMessages),
    });

    assert.equal(startResult, "replied");
    assert.equal(helpResult, "replied");
    assert.equal(sentMessages.length, 2);
    assert.match(sentMessages[0].text, /Miu is online/);
    assert.match(sentMessages[1].text, /\/providers/);
    assert.match(sentMessages[1].text, /\/memory pause/);
    assert.match(sentMessages[1].text, /\/approvals/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate saves owner photo attachments and sends metadata to LLM", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  const chatActions: Array<{ chatId: number; action: string }> = [];
  let requestMessages: unknown;

  try {
    await writeRuntimeFiles(paths);
    const client: TelegramClient = {
      ...createRecordingClient(sentMessages, chatActions),
      getFile: async (fileId) => ({ fileId, filePath: "photos/cat.jpg", fileSize: 4 }),
      downloadFile: async () => new TextEncoder().encode("meow"),
    };
    const result = await handleTelegramUpdate(createPhotoUpdate(12345, 1, "what is this?"), {
      config,
      paths,
      client,
      chatCompletion: async (_config, _apiKey, options) => {
        requestMessages = options.messages;
        const systemText = String(options.messages[0]?.content ?? "");
        return systemText.includes("memory reasoning pass") ? '{"candidates":[]}' : '{"answer":"Đã nhận ảnh và lưu lại."}';
      },
    });

    assert.equal(result, "replied");
    assert.deepEqual(chatActions, [{ chatId: 777, action: "typing" }]);
    assert.equal(sentMessages.at(-1)?.text, "Đã nhận ảnh và lưu lại.");
    assert.match(JSON.stringify(requestMessages), /User caption: what is this\?/);
    assert.match(JSON.stringify(requestMessages), /Kind: photo/);
    assert.match(JSON.stringify(requestMessages), /Local path:/);
    assert.doesNotMatch(JSON.stringify(requestMessages), /image_url/);
    const savedPathMatch = JSON.stringify(requestMessages).match(/Local path: ([^\\"]+)/);
    assert.ok(savedPathMatch?.[1]);
    assert.equal(await readFile(savedPathMatch[1], "utf8"), "meow");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate attaches photo bytes to LLM only when vision policy allows it", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  let requestMessages: unknown;

  try {
    await writeRuntimeFiles(paths);
    const imageBytes = new Uint8Array([1, 2, 3, 4]);
    const client: TelegramClient = {
      ...createRecordingClient(sentMessages),
      getFile: async (fileId) => ({ fileId, filePath: "photos/cat.jpg", fileSize: imageBytes.byteLength }),
      downloadFile: async () => imageBytes,
    };

    const result = await handleTelegramUpdate(createPhotoUpdate(12345, 1, "what is this?"), {
      config: { ...config, channels: { telegram: { ...config.channels!.telegram!, attachments: { visionPolicy: "allow" } } } },
      paths,
      client,
      chatCompletion: async (_config, _apiKey, options) => {
        requestMessages = options.messages;
        const systemText = String(options.messages[0]?.content ?? "");
        return systemText.includes("memory reasoning pass") ? '{"candidates":[]}' : '{"answer":"Đã xem ảnh."}';
      },
    });

    assert.equal(result, "replied");
    assert.equal(sentMessages.at(-1)?.text, "Đã xem ảnh.");
    const userMessage = (requestMessages as Array<{ role: string; content: unknown }>).find((message) => message.role === "user" && Array.isArray(message.content));
    assert.ok(userMessage);
    const parts = userMessage.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    assert.equal(parts[0].type, "text");
    assert.match(parts[0].text ?? "", /Vision input: attached/);
    assert.deepEqual(parts[1], { type: "image_url", image_url: { url: "data:image/jpeg;base64,AQIDBA==" } });
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate includes a preview for text-like document attachments", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  let requestMessages: unknown;

  try {
    await writeRuntimeFiles(paths);
    const client: TelegramClient = {
      ...createRecordingClient(sentMessages),
      getFile: async (fileId) => ({ fileId, filePath: "documents/note.txt", fileSize: 18 }),
      downloadFile: async () => new TextEncoder().encode("hello from telegram\n"),
    };

    const result = await handleTelegramUpdate(createDocumentUpdate(12345, "note.txt", "text/plain", "please read this"), {
      config,
      paths,
      client,
      chatCompletion: async (_config, _apiKey, options) => {
        requestMessages = options.messages;
        const systemText = String(options.messages[0]?.content ?? "");
        return systemText.includes("memory reasoning pass") ? '{"candidates":[]}' : '{"answer":"Preview received."}';
      },
    });

    assert.equal(result, "replied");
    assert.equal(sentMessages.at(-1)?.text, "Preview received.");
    const serializedMessages = JSON.stringify(requestMessages);
    assert.match(serializedMessages, /Original filename: note\.txt/);
    assert.match(serializedMessages, /MIME type: text\/plain/);
    assert.match(serializedMessages, /Text preview/);
    assert.match(serializedMessages, /hello from telegram/);
    const savedPathMatch = serializedMessages.match(/Local path: ([^\\"]+)/);
    assert.ok(savedPathMatch?.[1]);
    assert.equal(await readFile(savedPathMatch[1], "utf8"), "hello from telegram\n");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate includes extracted DOCX text previews for document attachments", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  let requestMessages: unknown;

  try {
    await writeRuntimeFiles(paths);
    const docxBytes = await readFile(resolve("node_modules/mammoth/test/test-data/single-paragraph.docx"));
    const client: TelegramClient = {
      ...createRecordingClient(sentMessages),
      getFile: async (fileId) => ({ fileId, filePath: "documents/single-paragraph.docx", fileSize: docxBytes.byteLength }),
      downloadFile: async () => docxBytes,
    };

    const result = await handleTelegramUpdate(
      createDocumentUpdate(12345, "single-paragraph.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "summarize this", 1, docxBytes.byteLength),
      {
        config,
        paths,
        client,
        chatCompletion: async (_config, _apiKey, options) => {
          requestMessages = options.messages;
          const systemText = String(options.messages[0]?.content ?? "");
          return systemText.includes("memory reasoning pass") ? '{"candidates":[]}' : '{"answer":"DOCX preview received."}';
        },
      },
    );

    assert.equal(result, "replied");
    assert.equal(sentMessages.at(-1)?.text, "DOCX preview received.");
    const serializedMessages = JSON.stringify(requestMessages);
    assert.match(serializedMessages, /Text preview \(docx\)/);
    assert.match(serializedMessages, /Walking on imported air/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate does not transcribe voice attachments unless policy allows it", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  let requestMessages: unknown;
  let transcriberCalled = false;

  try {
    await writeRuntimeFiles(paths);
    const client: TelegramClient = {
      ...createRecordingClient(sentMessages),
      getFile: async (fileId) => ({ fileId, filePath: "voice/message.ogg", fileSize: 4 }),
      downloadFile: async () => new Uint8Array([1, 2, 3, 4]),
    };

    const result = await handleTelegramUpdate(createVoiceUpdate(12345, "please listen"), {
      config,
      paths,
      client,
      attachmentTranscriber: async () => {
        transcriberCalled = true;
        return { text: "secret transcript" };
      },
      chatCompletion: async (_config, _apiKey, options) => {
        requestMessages = options.messages;
        const systemText = String(options.messages[0]?.content ?? "");
        return systemText.includes("memory reasoning pass") ? '{"candidates":[]}' : '{"answer":"Voice saved."}';
      },
    });

    assert.equal(result, "replied");
    assert.equal(transcriberCalled, false);
    const serializedMessages = JSON.stringify(requestMessages);
    assert.match(serializedMessages, /Audio transcription: not available/);
    assert.doesNotMatch(serializedMessages, /secret transcript/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate includes voice transcripts when transcription policy allows it", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  let requestMessages: unknown;
  let transcriberInput: unknown;

  try {
    await writeRuntimeFiles(paths);
    const client: TelegramClient = {
      ...createRecordingClient(sentMessages),
      getFile: async (fileId) => ({ fileId, filePath: "voice/message.ogg", fileSize: 4 }),
      downloadFile: async () => new Uint8Array([1, 2, 3, 4]),
    };

    const result = await handleTelegramUpdate(createVoiceUpdate(12345, "please listen"), {
      config: { ...config, channels: { telegram: { ...config.channels!.telegram!, attachments: { transcriptionPolicy: "allow" } } } },
      paths,
      client,
      attachmentTranscriber: async (input) => {
        transcriberInput = { kind: input.kind, mimeType: input.mimeType, duration: input.duration, bytes: input.bytes.byteLength };
        return { text: "xin chào từ voice" };
      },
      chatCompletion: async (_config, _apiKey, options) => {
        requestMessages = options.messages;
        const systemText = String(options.messages[0]?.content ?? "");
        return systemText.includes("memory reasoning pass") ? '{"candidates":[]}' : '{"answer":"Transcript received."}';
      },
    });

    assert.equal(result, "replied");
    assert.deepEqual(transcriberInput, { kind: "voice", mimeType: "audio/ogg", duration: 3, bytes: 4 });
    assert.equal(sentMessages.at(-1)?.text, "Transcript received.");
    const serializedMessages = JSON.stringify(requestMessages);
    assert.match(serializedMessages, /Audio transcript from provider STT/);
    assert.match(serializedMessages, /xin chào từ voice/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate prefers platform voice transcripts before provider transcription", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  let requestMessages: unknown;
  let transcriberCalled = false;

  try {
    await writeRuntimeFiles(paths);
    const client: TelegramClient = {
      ...createRecordingClient(sentMessages),
      getFile: async (fileId) => ({ fileId, filePath: "voice/message.ogg", fileSize: 4 }),
      downloadFile: async () => new Uint8Array([1, 2, 3, 4]),
    };

    const result = await handleTelegramUpdate(createVoiceUpdate(12345, "please listen", 1, { text: "platform transcript", source: "platform" }), {
      config: { ...config, channels: { telegram: { ...config.channels!.telegram!, attachments: { transcriptionPolicy: "allow" } } } },
      paths,
      client,
      attachmentTranscriber: async () => {
        transcriberCalled = true;
        return { text: "provider transcript" };
      },
      chatCompletion: async (_config, _apiKey, options) => {
        requestMessages = options.messages;
        const systemText = String(options.messages[0]?.content ?? "");
        return systemText.includes("memory reasoning pass") ? '{"candidates":[]}' : '{"answer":"Platform transcript received."}';
      },
    });

    assert.equal(result, "replied");
    assert.equal(transcriberCalled, false);
    const serializedMessages = JSON.stringify(requestMessages);
    assert.match(serializedMessages, /Audio transcript from platform ASR/);
    assert.match(serializedMessages, /platform transcript/);
    assert.doesNotMatch(serializedMessages, /provider transcript/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate deletes configured attachment kinds after processing", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  let requestMessages: unknown;
  let transcriberInput: { localPath: string } | undefined;

  try {
    await writeRuntimeFiles(paths);
    const client: TelegramClient = {
      ...createRecordingClient(sentMessages),
      getFile: async (fileId) => ({ fileId, filePath: "voice/message.ogg", fileSize: 4 }),
      downloadFile: async () => new Uint8Array([1, 2, 3, 4]),
    };

    const result = await handleTelegramUpdate(createVoiceUpdate(12345, "please listen"), {
      config: { ...config, channels: { telegram: { ...config.channels!.telegram!, attachments: { transcriptionPolicy: "allow", deleteAfterProcessingKinds: ["voice", "audio"] } } } },
      paths,
      client,
      attachmentTranscriber: async (input) => {
        transcriberInput = { localPath: input.localPath };
        return { text: "xin chào từ voice" };
      },
      chatCompletion: async (_config, _apiKey, options) => {
        requestMessages = options.messages;
        const systemText = String(options.messages[0]?.content ?? "");
        return systemText.includes("memory reasoning pass") ? '{"candidates":[]}' : '{"answer":"Transcript received."}';
      },
    });

    assert.equal(result, "replied");
    assert.ok(transcriberInput?.localPath);
    await assert.rejects(() => access(transcriberInput!.localPath));
    const serializedMessages = JSON.stringify(requestMessages);
    assert.match(serializedMessages, /Audio transcript/);
    assert.match(serializedMessages, /Local file: removed after processing/);
    assert.doesNotMatch(serializedMessages, /internal\.read_file with the local path/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate skips voice reply when assistant text is too long", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  const sentVoices: Array<{ bytes: number; mimeType?: string }> = [];
  let speechSynthesizerCalled = false;

  try {
    await writeRuntimeFiles(paths);
    const client: TelegramClient = {
      ...createRecordingClient(sentMessages),
      getFile: async (fileId) => ({ fileId, filePath: "voice/message.ogg", fileSize: 4 }),
      downloadFile: async () => new Uint8Array([1, 2, 3, 4]),
      sendVoice: async (_chatId, voice, options) => {
        sentVoices.push({ bytes: voice.byteLength, mimeType: options?.mimeType });
      },
    };

    const result = await handleTelegramUpdate(createVoiceUpdate(12345, "please listen"), {
      config: {
        ...config,
        speech: { provider: "elevenlabs", apiKeyEnv: "ELEVENLABS_API_KEY", voiceId: "voice", modelId: "eleven_v3" },
        channels: { telegram: { ...config.channels!.telegram!, voiceReplyPolicy: "voice-input-only", voiceReplyMaxChars: 10, attachments: { transcriptionPolicy: "allow" } } },
      },
      paths,
      client,
      attachmentTranscriber: async () => ({ text: "xin chào từ voice" }),
      speechSynthesizer: async () => {
        speechSynthesizerCalled = true;
        return { bytes: new Uint8Array([4, 5, 6]), mimeType: "audio/mpeg" };
      },
      speechVoiceConverter: async (speech) => ({ bytes: speech.bytes, mimeType: "audio/ogg" }),
      chatCompletion: async (_config, _apiKey, options) => {
        const systemText = String(options.messages[0]?.content ?? "");
        return systemText.includes("memory reasoning pass") ? '{"candidates":[]}' : '{"answer":"Đây là một câu trả lời dài hơn giới hạn."}';
      },
    });

    assert.equal(result, "replied");
    assert.equal(sentMessages.at(-1)?.text, "Đây là một câu trả lời dài hơn giới hạn.");
    assert.equal(speechSynthesizerCalled, false);
    assert.deepEqual(sentVoices, []);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate applies voice reply cooldown", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  const sentVoices: Array<{ bytes: number; mimeType?: string }> = [];
  let speechSynthesizerCalls = 0;

  try {
    await writeRuntimeFiles(paths);
    const client: TelegramClient = {
      ...createRecordingClient(sentMessages),
      getFile: async (fileId) => ({ fileId, filePath: "voice/message.ogg", fileSize: 4 }),
      downloadFile: async () => new Uint8Array([1, 2, 3, 4]),
      sendVoice: async (_chatId, voice, options) => {
        sentVoices.push({ bytes: voice.byteLength, mimeType: options?.mimeType });
      },
    };
    const voiceConfig: AppConfig = {
      ...config,
      speech: { provider: "elevenlabs", apiKeyEnv: "ELEVENLABS_API_KEY", voiceId: "voice", modelId: "eleven_v3" },
      channels: { telegram: { ...config.channels!.telegram!, voiceReplyPolicy: "voice-input-only", voiceReplyCooldownMs: 60_000, attachments: { transcriptionPolicy: "allow" } } },
    };
    const options = {
      config: voiceConfig,
      paths,
      client,
      attachmentTranscriber: async () => ({ text: "xin chào từ voice" }),
      speechSynthesizer: async () => {
        speechSynthesizerCalls += 1;
        return { bytes: new Uint8Array([4, 5, 6]), mimeType: "audio/mpeg" };
      },
      speechVoiceConverter: async (speech: { bytes: Uint8Array; mimeType: string }) => ({ bytes: speech.bytes, mimeType: "audio/ogg" }),
      chatCompletion: async (_config: AppConfig, _apiKey: string, completionOptions: { messages: Array<{ content?: unknown }> }) => {
        const systemText = String(completionOptions.messages[0]?.content ?? "");
        return systemText.includes("memory reasoning pass") ? '{"candidates":[]}' : '{"answer":"Nghe rõ rồi nha."}';
      },
    };

    await handleTelegramUpdate(createVoiceUpdate(12345, "first voice"), options);
    await handleTelegramUpdate(createVoiceUpdate(12345, "second voice"), options);

    assert.equal(speechSynthesizerCalls, 1);
    assert.deepEqual(sentVoices, [{ bytes: 3, mimeType: "audio/ogg" }]);
    assert.equal(sentMessages.filter((message) => message.text === "Nghe rõ rồi nha.").length, 2);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate respects configured attachment preview limits", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  let requestMessages: unknown;

  try {
    await writeRuntimeFiles(paths);
    const client: TelegramClient = {
      ...createRecordingClient(sentMessages),
      getFile: async (fileId) => ({ fileId, filePath: "documents/note.txt", fileSize: 18 }),
      downloadFile: async () => new TextEncoder().encode("hello from telegram\n"),
    };

    await handleTelegramUpdate(createDocumentUpdate(12345, "note.txt", "text/plain", "please read this"), {
      config: { ...config, channels: { telegram: { ...config.channels!.telegram!, attachments: { previewMaxBytes: 5 } } } },
      paths,
      client,
      chatCompletion: async (_config, _apiKey, options) => {
        requestMessages = options.messages;
        const systemText = String(options.messages[0]?.content ?? "");
        return systemText.includes("memory reasoning pass") ? '{"candidates":[]}' : '{"answer":"Preview received."}';
      },
    });

    const serializedMessages = JSON.stringify(requestMessages);
    assert.match(serializedMessages, /Text preview \(text\) \(truncated\)/);
    assert.match(serializedMessages, /hello/);
    assert.doesNotMatch(serializedMessages, /from telegram/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate replies clearly when attachment downloads are disabled", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  let getFileCalled = false;
  let chatCompletionCalled = false;

  try {
    await writeRuntimeFiles(paths);
    const result = await handleTelegramUpdate(createDocumentUpdate(12345, "note.txt", "text/plain", "please read this"), {
      config: { ...config, channels: { telegram: { ...config.channels!.telegram!, attachments: { downloadPolicy: "deny" } } } },
      paths,
      client: {
        ...createRecordingClient(sentMessages),
        getFile: async (fileId) => {
          getFileCalled = true;
          return { fileId, filePath: "documents/note.txt", fileSize: 18 };
        },
        downloadFile: async () => new TextEncoder().encode("hello"),
      },
      chatCompletion: async () => {
        chatCompletionCalled = true;
        return "nope";
      },
    });

    assert.equal(result, "replied");
    assert.equal(getFileCalled, false);
    assert.equal(chatCompletionCalled, false);
    assert.deepEqual(sentMessages, [{ chatId: 777, text: "Attachment downloads are disabled by config." }]);
    assert.match(await readFile(paths.appLogPath, "utf8"), /telegram_attachment_failure/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate replies clearly when attachment MIME type is denied", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  let getFileCalled = false;

  try {
    await writeRuntimeFiles(paths);
    const result = await handleTelegramUpdate(createDocumentUpdate(12345, "paper.pdf", "application/pdf", "please read this"), {
      config: { ...config, channels: { telegram: { ...config.channels!.telegram!, attachments: { allowedMimeTypes: ["text/*"] } } } },
      paths,
      client: {
        ...createRecordingClient(sentMessages),
        getFile: async (fileId) => {
          getFileCalled = true;
          return { fileId, filePath: "documents/paper.pdf", fileSize: 18 };
        },
        downloadFile: async () => new TextEncoder().encode("%PDF"),
      },
    });

    assert.equal(result, "replied");
    assert.equal(getFileCalled, false);
    assert.deepEqual(sentMessages, [{ chatId: 777, text: "This attachment MIME type is not allowed by config." }]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate replies clearly when attachment exceeds configured maxBytes", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  let getFileCalled = false;

  try {
    await writeRuntimeFiles(paths);
    const result = await handleTelegramUpdate(createDocumentUpdate(12345, "large.txt", "text/plain", "please read this", 1, 100), {
      config: { ...config, channels: { telegram: { ...config.channels!.telegram!, attachments: { maxBytes: 10 } } } },
      paths,
      client: {
        ...createRecordingClient(sentMessages),
        getFile: async (fileId) => {
          getFileCalled = true;
          return { fileId, filePath: "documents/large.txt", fileSize: 100 };
        },
        downloadFile: async () => new TextEncoder().encode("large"),
      },
    });

    assert.equal(result, "replied");
    assert.equal(getFileCalled, false);
    assert.deepEqual(sentMessages, [{ chatId: 777, text: "This attachment is larger than the configured limit of 10 bytes." }]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate replies clearly when Telegram omits a downloadable file path", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  let downloadCalled = false;

  try {
    await writeRuntimeFiles(paths);
    const result = await handleTelegramUpdate(createDocumentUpdate(12345, "note.txt", "text/plain", "please read this"), {
      config,
      paths,
      client: {
        ...createRecordingClient(sentMessages),
        getFile: async (fileId) => ({ fileId, fileSize: 18 }),
        downloadFile: async () => {
          downloadCalled = true;
          return new TextEncoder().encode("hello");
        },
      },
    });

    assert.equal(result, "replied");
    assert.equal(downloadCalled, false);
    assert.deepEqual(sentMessages, [{ chatId: 777, text: "Telegram could not provide a downloadable file for this attachment." }]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate replies clearly for attachment download failures without logging raw file paths", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];

  try {
    await writeRuntimeFiles(paths);
    const result = await handleTelegramUpdate(createDocumentUpdate(12345, "note.txt", "text/plain", "please read this"), {
      config,
      paths,
      client: {
        ...createRecordingClient(sentMessages),
        getFile: async (fileId) => ({ fileId, filePath: "documents/secret-file-id.txt", fileSize: 18 }),
        downloadFile: async () => {
          throw new Error("failed to download documents/secret-file-id.txt with token bot-secret-token");
        },
      },
    });

    assert.equal(result, "replied");
    assert.deepEqual(sentMessages, [{ chatId: 777, text: "Telegram could not download this attachment. Please try again with a smaller or different file." }]);
    const logText = await readFile(paths.appLogPath, "utf8");
    assert.match(logText, /telegram_attachment_failure/);
    assert.match(logText, /download_failed/);
    assert.doesNotMatch(logText, /secret-file-id/);
    assert.doesNotMatch(logText, /bot-secret-token/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate handles unknown owner slash commands without LLM", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];

  try {
    const result = await handleTelegramUpdate(createTextUpdate("/wat", 12345), {
      config,
      paths,
      client: createRecordingClient(sentMessages),
    });

    assert.equal(result, "replied");
    assert.deepEqual(sentMessages, [{ chatId: 777, text: "Unknown command: /wat. Try /help." }]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate replies to status and memory slash commands", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];

  try {
    await writeRuntimeFiles(paths);
    const store = await SqliteMemoryStore.open(paths);
    try {
      store.addMemory({ type: "preference", content: "likes short replies" });
    } finally {
      store.close();
    }

    await handleTelegramUpdate(createTextUpdate("/status", 12345), { config, paths, client: createRecordingClient(sentMessages) });
    await handleTelegramUpdate(createTextUpdate("/memory", 12345), { config, paths, client: createRecordingClient(sentMessages) });

    assert.match(sentMessages[0].text, /Status -> memory active; active 1; pending 0/);
    assert.match(sentMessages[1].text, /likes short replies/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate status includes recent provider fallback health", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];

  try {
    await writeRuntimeFiles(paths);
    await appendLog(
      {
        event: "telegram_chat_failure",
        detail: {
          message: "All configured LLM providers failed.",
          fallbackAttempts: [
            { provider: "openai-compatible", model: "primary-model", error: "Provider returned an unusable response: 502 Bad Gateway" },
            { provider: "openai-compatible", model: "fallback-model", error: "Provider request timed out after 60s." },
          ],
        },
      },
      { paths },
    );

    await handleTelegramUpdate(createTextUpdate("/status", 12345), { config, paths, client: createRecordingClient(sentMessages) });

    assert.match(sentMessages[0].text, /Status -> memory active; active 0; pending 0/);
    assert.match(sentMessages[0].text, /provider fallback failures recent 2/);
    assert.match(sentMessages[0].text, /openai-compatible\/primary-model x1/);
    assert.match(sentMessages[0].text, /openai-compatible\/fallback-model x1/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate shows provider diagnostics", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];

  try {
    await writeRuntimeFiles(paths);
    await appendLog(
      {
        event: "telegram_chat_failure",
        detail: {
          fallbackAttempts: [
            { provider: "openai-compatible", model: "primary-model", error: "502" },
            { provider: "openai-compatible", model: "fallback-model", error: "timeout" },
          ],
        },
      },
      { paths },
    );

    await handleTelegramUpdate(createTextUpdate("/providers", 12345), { config, paths, client: createRecordingClient(sentMessages) });

    assert.match(sentMessages[0].text, /Provider diagnostics -> recent fallback chains 1/);
    assert.match(sentMessages[0].text, /openai-compatible\/primary-model: 502/);
    assert.match(sentMessages[0].text, /openai-compatible\/fallback-model: timeout/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate lists and inspects pending memories from Telegram", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];

  try {
    await writeRuntimeFiles(paths);
    const store = await SqliteMemoryStore.open(paths);
    let pendingId: number;
    try {
      pendingId = store.addPendingMemory({
        type: "sensitive_personal",
        content: "prefers private context reviewed first",
        reason: "Sensitive memory requires user approval before storage.",
        source: "test",
      }).id;
    } finally {
      store.close();
    }

    await handleTelegramUpdate(createTextUpdate("/memory pending", 12345), { config, paths, client: createRecordingClient(sentMessages) });
    await handleTelegramUpdate(createTextUpdate(`/memory pending inspect ${pendingId}`, 12345), { config, paths, client: createRecordingClient(sentMessages) });
    await handleTelegramUpdate(createTextUpdate("/memory pending inspect 999", 12345), { config, paths, client: createRecordingClient(sentMessages) });

    assert.match(sentMessages[0].text, /Pending memories:/);
    assert.match(sentMessages[0].text, /Sensitive memory requires user approval/);
    assert.match(sentMessages[1].text, new RegExp(`Pending memory ${pendingId}`));
    assert.match(sentMessages[1].text, /Approve\/reject from CLI for now/);
    assert.equal(sentMessages[2].text, "No pending memory found for id 999.");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate lists pending action approvals with readable decisions", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];

  try {
    await writeRuntimeFiles(paths);
    const store = await SqliteMemoryStore.open(paths);
    try {
      store.addPendingActionApproval({
        channel: "telegram",
        userId: "12345",
        category: "local_write",
        action: "memory_approve",
        target: "pending-memory:7",
        reason: "Owner confirmation is required.",
      });
    } finally {
      store.close();
    }

    await handleTelegramUpdate(createTextUpdate("/approvals", 12345), { config, paths, client: createRecordingClient(sentMessages) });

    assert.equal(
      sentMessages[0].text,
      [
        "Pending approvals:",
        "Request 1",
        "Action: memory_approve",
        "Category: local_write",
        "Target: pending-memory:7",
        "Reason: Owner confirmation is required.",
        "Reply with /approve 1 or /deny 1.",
      ].join("\n"),
    );
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate replies clearly when slash approval is stale", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];

  try {
    await writeRuntimeFiles(paths);

    await handleTelegramUpdate(createTextUpdate("/approve 999", 12345), { config, paths, client: createRecordingClient(sentMessages) });

    assert.equal(sentMessages[0].text, "Approval request 999 is no longer pending. It may have already been handled or expired.");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate lets the model queue memory through remember_memory", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string; options?: unknown }> = [];
  const editedMessages: Array<{ chatId: number; messageId: number; text: string }> = [];
  let calls = 0;

  try {
    await writeRuntimeFiles(paths);
    const result = await handleTelegramUpdate(createTextUpdate("nhớ là reply bằng tiếng Việt", 12345), {
      config: { ...config, memory: { writePolicy: "ask" } },
      paths,
      client: createRecordingClient(sentMessages, [], editedMessages),
      chatCompletion: async () => {
        calls += 1;
        if (calls === 1) return '{"tool":"internal.remember_memory","arguments":{"type":"communication_preference","content":"reply bằng tiếng Việt"}}';
        if (calls === 2) return '{"answer":"Memory approval is ready."}';
        return '{"candidates":[]}';
      },
    });

    assert.equal(result, "replied");
    assert.equal(calls, 3);
    assert.equal(sentMessages[0].text, "Miu is preparing a memory approval");
    assert.match(sentMessages[1].text, /Memory approval needed/);
    assert.match(sentMessages[1].text, /Content: reply bằng tiếng Việt/);
    assert.deepEqual(sentMessages[1].options, {
      replyMarkup: {
        inline_keyboard: [[{ text: "Approve", callback_data: "approval:approve:1" }, { text: "Deny", callback_data: "approval:deny:1" }]],
      },
    });
    assert.deepEqual(editedMessages.at(-1), { chatId: 777, messageId: 1000, text: "Memory approval is ready." });

    const store = await SqliteMemoryStore.open(paths);
    try {
      assert.deepEqual(store.listPendingMemories().map((memory) => `${memory.source}:${memory.type}:${memory.content}`), ["agent-tool:communication_preference:reply bằng tiếng Việt"]);
      assert.deepEqual(store.listPendingActionApprovals("telegram", "12345").map((approval) => `${approval.action}:${approval.target}`), ["memory_approve:pending-memory:1"]);
      assert.deepEqual(store.listRecentMessagesForChannel("telegram", "12345").map((message) => `${message.role}:${message.content}`), [
        "user:nhớ là reply bằng tiếng Việt",
        "assistant:Memory approval is ready.",
      ]);
    } finally {
      store.close();
    }
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate approves pending memory from inline approval callback", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string; options?: unknown }> = [];
  const editedMessages: Array<{ chatId: number; messageId: number; text: string }> = [];
  const callbackAnswers: Array<{ id: string; text?: string }> = [];

  try {
    await writeRuntimeFiles(paths);
    const store = await SqliteMemoryStore.open(paths);
    let approvalId: number;
    try {
      const pending = store.addPendingMemory({ type: "user_fact", content: "Con heo chỉ có 2 chân", source: "agent-tool", explicitConsent: true });
      approvalId = store.addPendingActionApproval({ channel: "telegram", userId: "12345", category: "local_write", action: "memory_approve", target: `pending-memory:${pending.id}` }).id;
    } finally {
      store.close();
    }

    const result = await handleTelegramUpdate(createCallbackUpdate(`approval:approve:${approvalId}`, 12345), {
      config,
      paths,
      client: createRecordingClient(sentMessages, [], editedMessages, callbackAnswers),
    });

    assert.equal(result, "replied");
    assert.deepEqual(callbackAnswers, [{ id: "callback-1", text: "Memory saved." }]);
    assert.deepEqual(sentMessages, []);
    assert.deepEqual(editedMessages, [{ chatId: 777, messageId: 20, text: "Memory approved and saved: 1." }]);

    const verifyStore = await SqliteMemoryStore.open(paths);
    try {
      assert.deepEqual(verifyStore.listActiveMemories().map((memory) => memory.content), ["Con heo chỉ có 2 chân"]);
      assert.deepEqual(verifyStore.listPendingMemories(), []);
      assert.deepEqual(verifyStore.listPendingActionApprovals("telegram", "12345"), []);
    } finally {
      verifyStore.close();
    }
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate includes more than the store default memory count in provider context", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  let requestMessages: Array<{ role: string; content: string }> = [];

  try {
    await writeRuntimeFiles(paths);
    const store = await SqliteMemoryStore.open(paths);
    try {
      for (let index = 1; index <= 25; index += 1) {
        store.addMemory({ type: "preference", content: `memory ${index}`, importance: 1 });
      }
    } finally {
      store.close();
    }

    const result = await handleTelegramUpdate(createTextUpdate("hello", 12345), {
      config,
      paths,
      client: createRecordingClient(sentMessages),
      chatCompletion: async (_config, _apiKey, options) => {
        const systemText = String(options.messages[0]?.content ?? "").toLowerCase();
        if (systemText.includes("memory reasoning pass")) {
          return '{"candidates":[]}';
        }
        requestMessages = options.messages as Array<{ role: string; content: string }>;
        return '{"answer":"Xin chao"}';
      },
    });

    assert.equal(result, "replied");
    const memoryContext = requestMessages.find((message) => message.role === "system" && message.content.startsWith("Approved local memories"))?.content ?? "";
    assert.match(memoryContext, /memory 25/);
    assert.match(memoryContext, /memory 21/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate denies pending memory from inline approval callback", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string; options?: unknown }> = [];
  const editedMessages: Array<{ chatId: number; messageId: number; text: string }> = [];
  const callbackAnswers: Array<{ id: string; text?: string }> = [];

  try {
    await writeRuntimeFiles(paths);
    const store = await SqliteMemoryStore.open(paths);
    let approvalId: number;
    try {
      const pending = store.addPendingMemory({ type: "user_fact", content: "Temporary claim", source: "agent-tool", explicitConsent: true });
      approvalId = store.addPendingActionApproval({ channel: "telegram", userId: "12345", category: "local_write", action: "memory_approve", target: `pending-memory:${pending.id}` }).id;
    } finally {
      store.close();
    }

    const result = await handleTelegramUpdate(createCallbackUpdate(`approval:deny:${approvalId}`, 12345), {
      config,
      paths,
      client: createRecordingClient(sentMessages, [], editedMessages, callbackAnswers),
    });

    assert.equal(result, "replied");
    assert.deepEqual(callbackAnswers, [{ id: "callback-1", text: "Memory denied." }]);
    assert.deepEqual(sentMessages, []);
    assert.deepEqual(editedMessages, [{ chatId: 777, messageId: 20, text: "Memory request denied: 1." }]);

    const verifyStore = await SqliteMemoryStore.open(paths);
    try {
      assert.deepEqual(verifyStore.listActiveMemories(), []);
      assert.deepEqual(verifyStore.listPendingMemories(), []);
    } finally {
      verifyStore.close();
    }
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate edits stale inline approval callbacks with an expired message", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string; options?: unknown }> = [];
  const editedMessages: Array<{ chatId: number; messageId: number; text: string }> = [];
  const callbackAnswers: Array<{ id: string; text?: string }> = [];

  try {
    await writeRuntimeFiles(paths);

    const result = await handleTelegramUpdate(createCallbackUpdate("approval:approve:999", 12345), {
      config,
      paths,
      client: createRecordingClient(sentMessages, [], editedMessages, callbackAnswers),
    });

    assert.equal(result, "replied");
    assert.deepEqual(callbackAnswers, [{ id: "callback-1", text: "Approval request is no longer pending." }]);
    assert.deepEqual(sentMessages, []);
    assert.deepEqual(editedMessages, [
      {
        chatId: 777,
        messageId: 20,
        text: "Approval request 999 is no longer pending. It may have already been handled or expired.",
      },
    ]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate pauses and resumes memory from Telegram", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];

  try {
    await writeRuntimeFiles(paths);
    await handleTelegramUpdate(createTextUpdate("/memory pause", 12345), { config, paths, client: createRecordingClient(sentMessages) });
    await handleTelegramUpdate(createTextUpdate("/memory resume", 12345), { config, paths, client: createRecordingClient(sentMessages) });
    await handleTelegramUpdate(createTextUpdate("/pause_memory", 12345), { config, paths, client: createRecordingClient(sentMessages) });
    await handleTelegramUpdate(createTextUpdate("/resume_memory", 12345), { config, paths, client: createRecordingClient(sentMessages) });

    assert.deepEqual(sentMessages.map((message) => message.text), ["Memory paused.", "Memory resumed.", "Memory paused.", "Memory resumed."]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate returns concise doctor summary", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];

  try {
    await writeRuntimeFiles(paths);
    await writeConfig(config, paths);
    await handleTelegramUpdate(createTextUpdate("/doctor", 12345), { config, paths, client: createRecordingClient(sentMessages) });

    assert.match(sentMessages[0].text, /^Doctor -> /);
    assert.doesNotMatch(sentMessages[0].text, /sk-test/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("formatTelegramDoctorSummary validates Doctor report contract before rendering", () => {
  assert.equal(
    formatTelegramDoctorSummary({
      checks: [{ name: "Config file", status: "fail", message: "Config missing." }],
      issueCount: 1,
      fixes: [],
    }),
    "Doctor -> 1 issues; FAIL Config file: Config missing.",
  );

  assert.match(
    formatTelegramDoctorSummary({
      checks: [{ name: "Config file", status: "broken", message: "Config missing." }],
      issueCount: 0,
      fixes: [],
    }),
    /^Doctor -> report contract error:/,
  );
});

test("formatTelegramDoctorSummary redacts secret-like Doctor details", () => {
  const summary = formatTelegramDoctorSummary({
    checks: [{ name: "LLM API key", status: "fail", message: "Provider returned api key = sk-secret-value-123456" }],
    issueCount: 1,
    fixes: [],
  });

  assert.match(summary, /\[REDACTED]/);
  assert.doesNotMatch(summary, /sk-secret-value-123456/);
});

test("handleTelegramUpdate does not call LLM for handled slash commands", async () => {
  const paths = await createTempPaths();
  let called = false;

  try {
    await writeRuntimeFiles(paths);
    await handleTelegramUpdate(createTextUpdate("/status", 12345), {
      config,
      paths,
      client: createRecordingClient([]),
      chatCompletion: async () => {
        called = true;
        return "nope";
      },
    });

    assert.equal(called, false);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate sends owner text to the LLM and replies", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  const seenMessages: string[] = [];

  try {
    await writeRuntimeFiles(paths);
    const result = await handleTelegramUpdate(createTextUpdate("Chao Miu", 12345), {
      config,
      paths,
      client: createRecordingClient(sentMessages),
      chatCompletion: async (_config, apiKey, options) => {
        assert.equal(apiKey, "sk-test");
        seenMessages.push(...options.messages.map((message) => `${message.role}:${message.content}`));
        return '{"answer":"Chao Boss"}';
      },
    });

    assert.equal(result, "replied");
    assert.deepEqual(sentMessages, [{ chatId: 777, text: "Chao Boss" }]);
    assert.ok(seenMessages.some((message) => message.startsWith("system:You are Miu.\n") && message.includes("internal.read_file")));
    assert.ok(seenMessages.some((message) => message === "user:Chao Miu"));
    const store = await SqliteMemoryStore.open(paths);
    try {
      assert.deepEqual(store.listRecentMessagesForChannel("telegram", "12345").map((message) => `${message.role}:${message.content}`), ["user:Chao Miu", "assistant:Chao Boss"]);
    } finally {
      store.close();
    }
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate sends approval for reasoned memory candidates", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string; options?: unknown }> = [];
  let calls = 0;

  try {
    await writeRuntimeFiles(paths);
    const result = await handleTelegramUpdate(createTextUpdate("This project is called Bestie", 12345), {
      config: { ...config, memory: { writePolicy: "ask" } },
      paths,
      client: createRecordingClient(sentMessages),
      chatCompletion: async (_config, _apiKey, options) => {
        calls += 1;
        const systemText = String(options.messages[0]?.content ?? "");
        return systemText.includes("memory reasoning pass")
          ? '{"candidates":[{"type":"project_context","content":"The project is called Bestie.","reason":"The user stated the project name.","confidence":0.9}]}'
          : '{"answer":"Noted."}';
      },
    });

    assert.equal(result, "replied");
    assert.equal(calls, 2);
    assert.equal(sentMessages[0]?.text, "Noted.");
    assert.match(sentMessages[1]?.text ?? "", /Memory approval needed/);
    assert.match(sentMessages[1]?.text ?? "", /Content: The project is called Bestie\./);
    assert.deepEqual(sentMessages[1]?.options, {
      replyMarkup: {
        inline_keyboard: [[{ text: "Approve", callback_data: "approval:approve:1" }, { text: "Deny", callback_data: "approval:deny:1" }]],
      },
    });
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate keeps typing while waiting for the agent", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  const chatActions: Array<{ chatId: number; action: string }> = [];

  try {
    await writeRuntimeFiles(paths);
    const result = await handleTelegramUpdate(createTextUpdate("nghĩ lâu chút", 12345), {
      config,
      paths,
      client: createRecordingClient(sentMessages, chatActions),
      typingRefreshMs: 1,
      chatCompletion: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return '{"answer":"Xong rồi."}';
      },
    });

    assert.equal(result, "replied");
    assert.ok(chatActions.length >= 2);
    assert.deepEqual(sentMessages, [{ chatId: 777, text: "Xong rồi." }]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate keeps replying when typing refresh fails repeatedly", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  let chatActionCalls = 0;

  try {
    await writeRuntimeFiles(paths);
    const client: TelegramClient = {
      ...createRecordingClient(sentMessages),
      sendChatAction: async () => {
        chatActionCalls += 1;
        throw new Error("Telegram typing rate limited");
      },
    };
    const result = await handleTelegramUpdate(createTextUpdate("nghĩ lâu chút", 12345), {
      config,
      paths,
      client,
      typingRefreshMs: 1,
      chatCompletion: async () => {
        await new Promise((resolve) => setTimeout(resolve, 8));
        return '{"answer":"Vẫn trả lời được."}';
      },
    });

    assert.equal(result, "replied");
    assert.equal(sentMessages.at(-1)?.text, "Vẫn trả lời được.");
    assert.ok(chatActionCalls >= 2);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate executes one MCP read tool request before replying", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  const editedMessages: Array<{ chatId: number; messageId: number; text: string }> = [];
  const requestMessages: unknown[] = [];
  let mcpToolRequest: unknown;

  try {
    await writeRuntimeFiles(paths);
    const result = await handleTelegramUpdate(createTextUpdate("Đọc file giúp mình", 12345), {
      config: {
        ...config,
        mcp: { servers: [{ name: "fs", enabled: true, command: "node", tools: [{ name: "read_file", category: "read" }] }] },
      },
      paths,
      client: createRecordingClient(sentMessages, [], editedMessages),
      chatCompletion: async (_config, apiKey, options) => {
        assert.equal(apiKey, "sk-test");
        requestMessages.push(options.messages);
        return requestMessages.length === 1 ? '{"tool":"mcp.read","server":"fs","name":"read_file","arguments":{"path":"note.txt"}}' : '{"answer":"File nói hello nha."}';
      },
      mcpToolRunner: async (options) => {
        mcpToolRequest = options.request;
        return { ok: true, status: "pass", message: "read ok", result: { content: "hello" } };
      },
    });

    assert.equal(result, "replied");
    assert.deepEqual(mcpToolRequest, { tool: "mcp.read", server: "fs", name: "read_file", arguments: { path: "note.txt" } });
    assert.equal(requestMessages.length, 2);
    assert.match(JSON.stringify(requestMessages[0]), /fs\/read_file/);
    assert.match(JSON.stringify(requestMessages[1]), /Tool result for fs\/read_file/);
    assert.deepEqual(sentMessages, [{ chatId: 777, text: "Miu is using read tool fs/read_file" }]);
    assert.deepEqual(editedMessages, [{ chatId: 777, messageId: 1000, text: "File nói hello nha." }]);

    const store = await SqliteMemoryStore.open(paths);
    try {
      assert.deepEqual(store.listRecentMessagesForChannel("telegram", "12345").map((message) => `${message.role}:${message.content}`), [
        "user:Đọc file giúp mình",
        "assistant:File nói hello nha.",
      ]);
    } finally {
      store.close();
    }
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate repairs tool JSON when the model adds prose before it", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  const editedMessages: Array<{ chatId: number; messageId: number; text: string }> = [];
  const toolRequests: unknown[] = [];
  let calls = 0;

  try {
    await writeRuntimeFiles(paths);
    const result = await handleTelegramUpdate(createTextUpdate("Review code trong repo cho a", 12345), {
      config,
      paths,
      client: createRecordingClient(sentMessages, [], editedMessages),
      chatCompletion: async () => {
        calls += 1;
        if (calls === 1) return 'Để review code, Miu cần xem qua cấu trúc src/ trước.\n\n{"tool":"internal.list_files","arguments":{"path":"src","limit":50}}';
        if (calls === 2) return '{"tool":"internal.list_files","arguments":{"path":"src","limit":50}}';
        return '{"answer":"Em đã xem cấu trúc src rồi, đây là nhận xét đầu tiên."}';
      },
      mcpToolRunner: async (options) => {
        toolRequests.push(options.request);
        return { ok: true, status: "pass", message: "listed", result: { entries: [{ name: "channels", type: "directory" }] } };
      },
    });

    assert.equal(result, "replied");
    assert.deepEqual(toolRequests, [{ tool: "internal.list_files", arguments: { path: "src", limit: 50 } }]);
    assert.deepEqual(sentMessages, [{ chatId: 777, text: "Em đã xem cấu trúc src rồi, đây là nhận xét đầu tiên." }]);
    assert.deepEqual(editedMessages, []);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate splits long final replies after tool progress", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  const editedMessages: Array<{ chatId: number; messageId: number; text: string }> = [];
  let calls = 0;

  try {
    await writeRuntimeFiles(paths);
    const longReply = [`Intro ${"a".repeat(1_900)}`, `Middle ${"b".repeat(1_900)}`, `End ${"c".repeat(1_900)}`].join("\n\n");
    const result = await handleTelegramUpdate(createTextUpdate("Review code trong repo cho a", 12345), {
      config,
      paths,
      client: createRecordingClient(sentMessages, [], editedMessages),
      chatCompletion: async () => {
        calls += 1;
        return calls === 1 ? '{"tool":"internal.list_files","arguments":{"path":"src/cli","limit":50}}' : JSON.stringify({ answer: longReply });
      },
      mcpToolRunner: async () => ({ ok: true, status: "pass", message: "listed", result: { entries: [] } }),
    });

    assert.equal(result, "replied");
    assert.equal(sentMessages[0].text, "Miu is listing files in src/cli");
    assert.ok(editedMessages[0].text.length <= 3_500);
    assert.ok(sentMessages.slice(1).every((message) => message.text.length <= 3_500));
    assert.equal([editedMessages[0].text, ...sentMessages.slice(1).map((message) => message.text)].join("\n\n"), longReply);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate prompts and denies tool calls when Telegram approval is required", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string; options?: unknown }> = [];
  const editedMessages: Array<{ chatId: number; messageId: number; text: string }> = [];
  const chatResponses = [
    '{"tool":"internal.read_file","arguments":{"path":"README.md"}}',
    '{"answer":"I could not read it."}',
  ];

  try {
    await writeRuntimeFiles(paths);
    const result = await handleTelegramUpdate(createTextUpdate("read README", 12345), {
      config,
      paths,
      client: createRecordingClient(sentMessages, [], editedMessages),
      chatCompletion: async () => chatResponses.shift() ?? '{"answer":"done"}',
      mcpToolRunner: async (options) => runAgentToolRequest({ ...options, policy: { allowTrustedRead: false } }),
    });

    assert.equal(result, "replied");
    assert.equal(sentMessages[0].text, "Miu is reading file README.md");
    assert.match(sentMessages[1].text, /Approval needed before running this action/);
    assert.match(sentMessages[1].text, /Request: 1/);
    assert.match(sentMessages[1].text, /Category: read/);
    assert.match(sentMessages[1].text, /Decision: choose Approve or Deny below/);
    assert.deepEqual(sentMessages[1].options, {
      replyMarkup: {
        inline_keyboard: [[{ text: "Approve", callback_data: "approval:approve:1" }, { text: "Deny", callback_data: "approval:deny:1" }]],
      },
    });
    assert.equal(editedMessages.at(-1)?.text, "I could not read it.");
    const logText = await readFile(paths.appLogPath, "utf8");
    assert.match(logText, /action_permission_decision/);
    assert.match(logText, /"decision":"deny"/);
    assert.match(logText, /Pending Telegram approval request 1 was recorded but not executed/);

    const store = await SqliteMemoryStore.open(paths);
    try {
      assert.deepEqual(store.listPendingActionApprovals("telegram").map((approval) => `${approval.id}:${approval.status}:${approval.action}`), ["1:pending:read_local_file"]);
    } finally {
      store.close();
    }
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate executes approved internal action payloads", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string; options?: unknown }> = [];
  const editedMessages: Array<{ chatId: number; messageId: number; text: string }> = [];
  const callbackAnswers: Array<{ id: string; text?: string }> = [];
  const chatResponses = [
    '{"tool":"internal.write_file","arguments":{"path":"telegram-note.txt","content":"approved from telegram\\n"}}',
    "I need approval before writing it.",
  ];

  try {
    await writeRuntimeFiles(paths);
    const result = await handleTelegramUpdate(createTextUpdate("write a note", 12345), {
      config,
      paths,
      client: createRecordingClient(sentMessages, [], editedMessages, callbackAnswers),
      chatCompletion: async () => chatResponses.shift() ?? "done",
    });

    assert.equal(result, "replied");
    assert.match(sentMessages[1].text, /Approval needed before running this action/);
    assert.match(sentMessages[1].text, /Action: internal.write_file/);

    const store = await SqliteMemoryStore.open(paths);
    let approvalId: number;
    try {
      const approvals = store.listPendingActionApprovals("telegram");
      assert.equal(approvals.length, 1);
      assert.equal(approvals[0]?.action, "internal.write_file");
      assert.match(approvals[0]?.payloadJson ?? "", /telegram-note\.txt/);
      approvalId = approvals[0].id;
    } finally {
      store.close();
    }

    await handleTelegramUpdate(createCallbackUpdate(`approval:approve:${approvalId}`, 12345, 2), {
      config,
      paths,
      client: createRecordingClient(sentMessages, [], editedMessages, callbackAnswers),
    });

    assert.equal(await readFile(resolve(paths.workspaceDir, "telegram-note.txt"), "utf8"), "approved from telegram\n");
    assert.deepEqual(callbackAnswers.at(-1), { id: "callback-1", text: "Action executed." });
    assert.match(editedMessages.at(-1)?.text ?? "", /Executed internal\.write_file/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate executes approved edit and patch action payloads", async () => {
  const paths = await createTempPaths();

  try {
    await writeRuntimeFiles(paths);
    await mkdir(paths.workspaceDir, { recursive: true });
    await writeFile(resolve(paths.workspaceDir, "telegram-edit.txt"), "hello old\n");
    await requestAndApproveTelegramTool(paths, '{"tool":"internal.edit_file","arguments":{"path":"telegram-edit.txt","oldText":"old","newText":"new"}}', "internal.edit_file");
    assert.equal(await readFile(resolve(paths.workspaceDir, "telegram-edit.txt"), "utf8"), "hello new\n");

    await writeFile(resolve(paths.rootDir, "telegram-patch.txt"), "hello new\n");
    const patch = [
      "diff --git a/telegram-patch.txt b/telegram-patch.txt",
      "--- a/telegram-patch.txt",
      "+++ b/telegram-patch.txt",
      "@@ -1 +1 @@",
      "-hello new",
      "+hello patched",
      "",
    ].join("\n");
    await requestAndApproveTelegramTool(paths, JSON.stringify({ tool: "internal.apply_patch", arguments: { patch } }), "internal.apply_patch");
    assert.equal(await readFile(resolve(paths.rootDir, "telegram-patch.txt"), "utf8"), "hello patched\n");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate executes approved read_url payloads", async () => {
  const paths = await createTempPaths();
  const server = await createHttpTestServer("MCP install command: npx example-mcp-server");

  try {
    await writeRuntimeFiles(paths);
    await requestAndApproveTelegramTool(paths, JSON.stringify({ tool: "internal.read_url", arguments: { url: server.url } }), "internal.read_url");
  } finally {
    await server.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate executes approved git status add and commit payloads", async () => {
  const paths = await createTempPaths();

  try {
    await writeRuntimeFiles(paths);
    await execFileAsync("git", ["init"], { cwd: paths.rootDir });
    await execFileAsync("git", ["config", "user.email", "bestie@example.invalid"], { cwd: paths.rootDir });
    await execFileAsync("git", ["config", "user.name", "Bestie Test"], { cwd: paths.rootDir });
    await writeFile(resolve(paths.rootDir, "commit-me.txt"), "hello git\n");

    await requestAndApproveTelegramTool(paths, '{"tool":"internal.exec","arguments":{"command":"git","args":["status","--short"],"cwd":".","timeoutMs":30000}}', "internal.exec");
    await requestAndApproveTelegramTool(paths, '{"tool":"internal.exec","arguments":{"command":"git","args":["add","-A"],"cwd":".","timeoutMs":30000}}', "internal.exec");
    await requestAndApproveTelegramTool(paths, '{"tool":"internal.exec","arguments":{"command":"git","args":["commit","-m","telegram approved commit"],"cwd":".","timeoutMs":30000}}', "internal.exec");

    const { stdout } = await execFileAsync("git", ["log", "-1", "--oneline"], { cwd: paths.rootDir, encoding: "utf8" });
    assert.match(stdout, /telegram approved commit/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate lists and records approval decisions without executing actions", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];

  try {
    await writeRuntimeFiles(paths);
    const store = await SqliteMemoryStore.open(paths);
    let approvalId: number;
    try {
      const pending = store.addPendingMemory({ type: "user_fact", content: "slash approval memory", source: "agent-tool", explicitConsent: true });
      approvalId = store.addPendingActionApproval({ channel: "telegram", category: "local_write", action: "memory_approve", target: `pending-memory:${pending.id}` }).id;
    } finally {
      store.close();
    }

    await handleTelegramUpdate(createTextUpdate("/approvals", 12345), { config, paths, client: createRecordingClient(sentMessages) });
    await handleTelegramUpdate(createTextUpdate(`/approve ${approvalId}`, 12345), { config, paths, client: createRecordingClient(sentMessages) });
    await handleTelegramUpdate(createTextUpdate(`/deny ${approvalId}`, 12345), { config, paths, client: createRecordingClient(sentMessages) });

    assert.match(sentMessages[0].text, /Pending approvals:/);
    assert.match(sentMessages[0].text, /Action: memory_approve/);
    assert.match(sentMessages[0].text, /Target: pending-memory:1/);
    assert.match(sentMessages[0].text, /Reply with \/approve 1 or \/deny 1\./);
    assert.equal(sentMessages[1].text, `Memory approved and saved: 1.`);
    assert.equal(sentMessages[2].text, `Approval request ${approvalId} is no longer pending. It may have already been handled or expired.`);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate edits one throttled tool progress message", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  const editedMessages: Array<{ chatId: number; messageId: number; text: string }> = [];
  let completionCalls = 0;

  try {
    await writeRuntimeFiles(paths);
    const result = await handleTelegramUpdate(createTextUpdate("summary docs", 12345), {
      config,
      paths,
      client: createRecordingClient(sentMessages, [], editedMessages),
      chatCompletion: async () => {
        completionCalls += 1;
        if (completionCalls === 1) return '{"tool":"internal.search_files","arguments":{"query":"*.md","path":"docs"}}';
        if (completionCalls === 2) return '{"tool":"internal.read_file","arguments":{"path":"README.md"}}';
        if (completionCalls === 3) return '{"tool":"internal.read_file","arguments":{"path":"PROJECT.md"}}';
        return '{"answer":"Done"}';
      },
      mcpToolRunner: async () => ({ ok: true, status: "pass", message: "ok", result: {} }),
    });

    assert.equal(result, "replied");
    assert.deepEqual(sentMessages, [{ chatId: 777, text: "Miu is searching files for *.md in docs" }]);
    assert.deepEqual(editedMessages, [
      { chatId: 777, messageId: 1000, text: "Miu is reading file PROJECT.md" },
      { chatId: 777, messageId: 1000, text: "Done" },
    ]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate ignores Telegram message-not-modified progress edits", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  const editedMessages: Array<{ chatId: number; messageId: number; text: string }> = [];
  const lastTextByMessage = new Map<number, string>();
  let completionCalls = 0;

  try {
    await writeRuntimeFiles(paths);
    const result = await handleTelegramUpdate(createTextUpdate("run composio", 12345), {
      config,
      paths,
      client: {
        ...createRecordingClient(sentMessages, [], editedMessages),
        async sendMessage(chatId, text) {
          sentMessages.push({ chatId, text });
          lastTextByMessage.set(1000, text);
          return { messageId: 1000 };
        },
        async editMessageText(chatId, messageId, text) {
          if (lastTextByMessage.get(messageId) === text) {
            throw new Error("Call to 'editMessageText' failed! (400: Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message)");
          }
          lastTextByMessage.set(messageId, text);
          editedMessages.push({ chatId, messageId, text });
        },
      },
      chatCompletion: async () => {
        completionCalls += 1;
        if (completionCalls <= 3) return '{"tool":"mcp.read","server":"composio","name":"COMPOSIO_MULTI_EXECUTE_TOOL","arguments":{}}';
        return '{"answer":"Done"}';
      },
      mcpToolRunner: async () => ({ ok: true, status: "pass", message: "ok", result: {} }),
    });

    assert.equal(result, "replied");
    assert.deepEqual(sentMessages, [{ chatId: 777, text: "Miu is using read tool composio/COMPOSIO_MULTI_EXECUTE_TOOL" }]);
    assert.deepEqual(editedMessages, [{ chatId: 777, messageId: 1000, text: "Done" }]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate repairs invented shell command JSON instead of sending it", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  const requestMessages: unknown[] = [];
  let mcpToolCalled = false;

  try {
    await writeRuntimeFiles(paths);
    const result = await handleTelegramUpdate(createTextUpdate("đọc log", 12345), {
      config: {
        ...config,
        mcp: { servers: [{ name: "fs", enabled: true, command: "node", tools: [{ name: "read_file", category: "read" }] }] },
      },
      paths,
      client: createRecordingClient(sentMessages),
      chatCompletion: async (_config, _apiKey, options) => {
        requestMessages.push(options.messages);
        return requestMessages.length === 1
          ? '{"cmd":"sed -n \'1,120p\' .bestie/logs/app.log","workdir":"."}'
          : '{"answer":"Mình chưa chạy được shell JSON đó. Cần dùng MCP read tool đã classify nha."}';
      },
      mcpToolRunner: async () => {
        mcpToolCalled = true;
        return { ok: true, status: "pass", message: "should not call" };
      },
    });

    assert.equal(result, "replied");
    assert.equal(mcpToolCalled, false);
    assert.equal(requestMessages.length, 2);
    assert.match(JSON.stringify(requestMessages[1]), /Shell command JSON/);
    assert.deepEqual(sentMessages, [{ chatId: 777, text: "Mình chưa chạy được shell JSON đó. Cần dùng MCP read tool đã classify nha." }]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate reports missing internal read files through the tool loop", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  const editedMessages: Array<{ chatId: number; messageId: number; text: string }> = [];
  const seenMessages: string[] = [];
  let calls = 0;

  try {
    await writeRuntimeFiles(paths);
    const result = await handleTelegramUpdate(createTextUpdate("đọc src/runtime/runtime.ts", 12345), {
      config,
      paths,
      client: createRecordingClient(sentMessages, [], editedMessages),
      chatCompletion: async (_config, _apiKey, options) => {
        calls += 1;
        seenMessages.push(JSON.stringify(options.messages));
        return calls === 1
          ? '{"tool":"internal.read_file","arguments":{"path":"src/runtime/runtime.ts"}}'
          : '{"answer":"Miu không thấy tệp src/runtime/runtime.ts trong repo."}';
      },
    });

    assert.equal(result, "replied");
    assert.equal(sentMessages[0].text, "Miu is reading file src/runtime/runtime.ts");
    assert.equal(editedMessages.at(-1)?.text, "Miu không thấy tệp src/runtime/runtime.ts trong repo.");
    assert.match(seenMessages.at(-1) ?? "", /Path does not exist/);
    assert.ok(!sentMessages.some((message) => message.text.includes("ENOENT")));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate includes recent Telegram context for owner text", async () => {
  const paths = await createTempPaths();
  const seenMessages: string[] = [];

  try {
    await writeRuntimeFiles(paths);
    const store = await SqliteMemoryStore.open(paths);
    try {
      store.addMessage({ channel: "terminal", role: "user", content: "Terminal context should stay out" });
      store.addMessage({ channel: "telegram", userId: "12345", role: "user", content: "Earlier Telegram user" });
      store.addMessage({ channel: "telegram", userId: "12345", role: "assistant", content: "Earlier Telegram assistant" });
      store.addMessage({ channel: "telegram", userId: "99999", role: "user", content: "Other user context should stay out" });
    } finally {
      store.close();
    }

    await handleTelegramUpdate(createTextUpdate("Continue", 12345), {
      config,
      paths,
      client: createRecordingClient([]),
      chatCompletion: async (_config, _apiKey, options) => {
        seenMessages.push(...options.messages.map((message) => `${message.role}:${message.content}`));
        return '{"answer":"Continuing"}';
      },
    });

    assert.ok(seenMessages.includes("user:Earlier Telegram user"));
    assert.ok(seenMessages.includes("assistant:Earlier Telegram assistant"));
    assert.ok(seenMessages.includes("user:Continue"));
    assert.ok(!seenMessages.includes("user:Terminal context should stay out"));
    assert.ok(!seenMessages.includes("user:Other user context should stay out"));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate never calls LLM for non-owner text", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  let called = false;

  try {
    await writeRuntimeFiles(paths);
    const result = await handleTelegramUpdate(createTextUpdate("hello", 99999), {
      config,
      paths,
      client: createRecordingClient(sentMessages),
      chatCompletion: async () => {
        called = true;
        return "nope";
      },
    });

    assert.equal(result, "ignored");
    assert.equal(called, false);
    assert.deepEqual(sentMessages, []);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate summarizes unexpected runtime errors without leaking raw details", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  const rawError = "ENOENT: no such file or directory, stat '/home/andynguyenn/projects/bestie/src/runtime/runtime.ts'";

  try {
    await writeRuntimeFiles(paths);
    const result = await handleTelegramUpdate(createTextUpdate("review runtime", 12345), {
      config,
      paths,
      client: createRecordingClient(sentMessages),
      chatCompletion: async () => {
        throw new Error(rawError);
      },
    });

    assert.equal(result, "replied");
    assert.equal(sentMessages.at(-1)?.text, "Miu hit an error while handling this message. Try again or ask a narrower question.");
    assert.ok(!sentMessages.some((message) => message.text.includes("ENOENT")));
    assert.ok(!sentMessages.some((message) => message.text.includes("/home/andynguyenn")));

    const logText = await readFile(paths.appLogPath, "utf8");
    assert.match(logText, /telegram_chat_failure/);
    assert.match(logText, /ENOENT/);
    assert.match(logText, /src\/runtime\/runtime\.ts/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate gives timeout-specific guidance", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];

  try {
    await writeRuntimeFiles(paths);
    const result = await handleTelegramUpdate(createTextUpdate("do heavy work", 12345), {
      config,
      paths,
      client: createRecordingClient(sentMessages),
      chatCompletion: async () => {
        throw new ProviderTimeoutError(300_000);
      },
    });

    assert.equal(result, "replied");
    assert.match(sentMessages.at(-1)?.text ?? "", /timed out while handling this message/);
    assert.match(sentMessages.at(-1)?.text ?? "", /llm\.timeoutMs/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleTelegramUpdate gives timeout-specific guidance after fallback exhaustion", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];

  try {
    await writeRuntimeFiles(paths);
    const result = await handleTelegramUpdate(createTextUpdate("do heavy work", 12345), {
      config,
      paths,
      client: createRecordingClient(sentMessages),
      chatCompletion: async () => {
        const timeoutError = new ProviderTimeoutError(300_000);
        throw new ProviderFallbackError(
          [
            { provider: "openai-compatible", model: "primary-model", error: "Provider returned an unusable response: 502 Bad Gateway" },
            { provider: "openai-compatible", model: "fallback-model", error: timeoutError.message },
          ],
          timeoutError,
        );
      },
    });

    assert.equal(result, "replied");
    assert.match(sentMessages.at(-1)?.text ?? "", /timed out while handling this message/);
    assert.match(sentMessages.at(-1)?.text ?? "", /llm\.timeoutMs/);

    const logText = await readFile(paths.appLogPath, "utf8");
    assert.match(logText, /"fallbackAttempts"/);
    assert.match(logText, /"model":"primary-model"/);
    assert.match(logText, /"model":"fallback-model"/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runTelegramPollingLoop advances offset after handled and ignored updates", async () => {
  const paths = await createTempPaths();
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  const offsets: Array<number | undefined> = [];
  const commands: unknown[] = [];

  try {
    await runTelegramPollingLoop({
      config,
      paths,
      once: true,
      client: {
        async getUpdates(offset) {
          offsets.push(offset);
          return [createTextUpdate("/start", 99999, 41), createTextUpdate("/help", 12345, 42)];
        },
        async sendMessage(chatId, text) {
          sentMessages.push({ chatId, text });
        },
        async editMessageText() {},
        async sendChatAction() {},
        async setMyCommands(nextCommands) {
          commands.push(...nextCommands);
        },
      },
    });

    assert.deepEqual(offsets, [undefined]);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].text, /\/doctor/);
    assert.ok(commands.some((command) => (command as { command: string }).command === "doctor"));
    assert.ok(commands.some((command) => (command as { command: string }).command === "memory"));
    assert.ok(!commands.some((command) => (command as { command: string }).command === "pause_memory"));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runTelegramPollingLoop backs off polling failures and resets after recovery", async () => {
  const paths = await createTempPaths();
  const offsets: Array<number | undefined> = [];
  const delays: number[] = [];
  let calls = 0;

  try {
    await runTelegramPollingLoop({
      config,
      paths,
      retryDelayMs: 25,
      maxRetryDelayMs: 60,
      sleep: async (ms) => {
        delays.push(ms);
      },
      shouldStop: () => calls >= 5,
      client: {
        async getUpdates(offset) {
          calls += 1;
          offsets.push(offset);

          if (calls <= 3 || calls === 5) {
            throw new Error("temporary Telegram outage");
          }

          return [];
        },
        async sendMessage() {},
        async editMessageText() {},
        async sendChatAction() {},
        async setMyCommands() {},
      },
    });

    const logText = await readFile(paths.appLogPath, "utf8");
    assert.deepEqual(offsets, [undefined, undefined, undefined, undefined, undefined]);
    assert.deepEqual(delays, [25, 50, 60, 25]);
    assert.match(logText, /telegram_polling_failure/);
    assert.match(logText, /telegram_polling_recovered/);
    assert.match(logText, /"consecutiveFailures":3/);
    assert.match(logText, /"retryDelayMs":60/);
    assert.match(logText, /temporary Telegram outage/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runTelegramPollingLoop throws polling failures in once mode", async () => {
  const paths = await createTempPaths();

  try {
    await assert.rejects(
      runTelegramPollingLoop({
        config,
        paths,
        once: true,
        client: {
          async getUpdates() {
            throw new Error("bad Telegram token");
          },
          async sendMessage() {},
          async editMessageText() {},
          async sendChatAction() {},
          async setMyCommands() {},
        },
      }),
      /bad Telegram token/,
    );

    assert.match(await readFile(paths.appLogPath, "utf8"), /telegram_polling_failure/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("TelegramHttpClient calls getUpdates and sendMessage endpoints", async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) as unknown : undefined });
    const method = String(url).split("/").at(-1);
    if (String(url).includes("/file/")) {
      return new Response("hello file", { status: 200 });
    }
    const result = method === "getMe"
      ? { id: 123, is_bot: true, first_name: "Miu", username: "miu_bot" }
      : method === "sendMessage"
        ? { message_id: 321 }
        : method === "getFile"
          ? { file_id: "file-1", file_path: "documents/file.txt", file_size: 10 }
          : [];
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
  };
  const client = new TelegramHttpClient("test-token", fetchImpl as typeof fetch);

  const me = await client.getMe();
  await client.getUpdates(12);
  const sentMessage = await client.sendMessage(777, "## Plan\n**hi** `code` [docs](https://example.com?a=1&b=2) <raw>");
  await client.editMessageText(777, 321, "working **now**");
  await client.sendChatAction(777, "typing");
  await client.setMyCommands([{ command: "start", description: "Start" }]);
  const file = await client.getFile("file-1");
  const fileBytes = await client.downloadFile("documents/file.txt");

  assert.equal(me.username, "miu_bot");
  assert.deepEqual(sentMessage, { messageId: 321 });
  assert.match(requests[0].url, /bottest-token\/getMe$/);
  assert.deepEqual(requests[0].body, {});
  assert.match(requests[1].url, /bottest-token\/getUpdates$/);
  assert.deepEqual(requests[1].body, { timeout: 25, offset: 12, allowed_updates: ["message", "callback_query"] });
  assert.match(requests[2].url, /bottest-token\/sendMessage$/);
  assert.deepEqual(requests[2].body, {
    chat_id: 777,
    text: '<b>Plan</b>\n<b>hi</b> <code>code</code> <a href="https://example.com?a=1&amp;b=2">docs</a> &lt;raw&gt;',
    parse_mode: "HTML",
  });
  assert.match(requests[3].url, /bottest-token\/editMessageText$/);
  assert.deepEqual(requests[3].body, { chat_id: 777, message_id: 321, text: "working <b>now</b>", parse_mode: "HTML" });
  assert.match(requests[4].url, /bottest-token\/sendChatAction$/);
  assert.deepEqual(requests[4].body, { chat_id: 777, action: "typing" });
  assert.match(requests[5].url, /bottest-token\/setMyCommands$/);
  assert.deepEqual(requests[5].body, { commands: [{ command: "start", description: "Start" }] });
  assert.match(requests[6].url, /bottest-token\/getFile$/);
  assert.deepEqual(requests[6].body, { file_id: "file-1" });
  assert.deepEqual(file, { fileId: "file-1", filePath: "documents/file.txt", fileSize: 10 });
  assert.match(requests[7].url, /\/file\/bottest-token\/documents\/file\.txt$/);
  assert.equal(requests[7].body, undefined);
  assert.equal(new TextDecoder().decode(fileBytes), "hello file");
});

function createTextUpdate(text: string, fromId: number, updateId = 1): TelegramUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: 10,
      date: 1,
      chat: { id: 777, type: "private", first_name: "Boss" },
      from: { id: fromId, is_bot: false, first_name: "Boss" },
      text,
    },
  };
}

function createPhotoUpdate(fromId: number, updateId = 1, caption?: string): TelegramUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: 10,
      date: 1,
      chat: { id: 777, type: "private", first_name: "Boss" },
      from: { id: fromId, is_bot: false, first_name: "Boss" },
      caption,
      photo: [{ file_id: "photo-1", file_unique_id: "photo-unique-1", width: 1, height: 1 }],
    },
  };
}

function createDocumentUpdate(fromId: number, fileName: string, mimeType: string, caption?: string, updateId = 1, fileSize = 18): TelegramUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: 10,
      date: 1,
      chat: { id: 777, type: "private", first_name: "Boss" },
      from: { id: fromId, is_bot: false, first_name: "Boss" },
      caption,
      document: { file_id: "doc-1", file_unique_id: "doc-unique-1", file_name: fileName, mime_type: mimeType, file_size: fileSize },
    },
  };
}

function createVoiceUpdate(fromId: number, caption?: string, updateId = 1, providedTranscript?: ChannelTranscript): TelegramUpdate {
  const voice = { file_id: "voice-1", file_unique_id: "voice-unique-1", duration: 3, mime_type: "audio/ogg", file_size: 4, providedTranscript } as NonNullable<TelegramUpdate["message"]>["voice"];

  return {
    update_id: updateId,
    message: {
      message_id: 10,
      date: 1,
      chat: { id: 777, type: "private", first_name: "Boss" },
      from: { id: fromId, is_bot: false, first_name: "Boss" },
      caption,
      voice,
    },
  };
}

function createCallbackUpdate(data: string, fromId: number, updateId = 1): TelegramUpdate {
  return {
    update_id: updateId,
    callback_query: {
      id: "callback-1",
      from: { id: fromId, is_bot: false, first_name: "Boss" },
      chat_instance: "chat-instance-1",
      data,
      message: {
        message_id: 20,
        date: 1,
        chat: { id: 777, type: "private", first_name: "Boss" },
      },
    },
  };
}


function createRecordingClient(
  sentMessages: Array<{ chatId: number; text: string; options?: unknown }>,
  chatActions: Array<{ chatId: number; action: string }> = [],
  editedMessages: Array<{ chatId: number; messageId: number; text: string }> = [],
  callbackAnswers: Array<{ id: string; text?: string }> = [],
): TelegramClient {
  return {
    async getUpdates() {
      return [];
    },
    async sendMessage(chatId, text, options) {
      sentMessages.push(options === undefined ? { chatId, text } : { chatId, text, options });
      return { messageId: 999 + sentMessages.length };
    },
    async editMessageText(chatId, messageId, text) {
      editedMessages.push({ chatId, messageId, text });
    },
    async sendChatAction(chatId, action) {
      chatActions.push({ chatId, action });
    },
    async answerCallbackQuery(id, text) {
      callbackAnswers.push({ id, text });
    },
    async setMyCommands() {},
  };
}

async function requestAndApproveTelegramTool(paths: RuntimePaths, toolJson: string, expectedAction: string): Promise<void> {
  const sentMessages: Array<{ chatId: number; text: string; options?: unknown }> = [];
  const editedMessages: Array<{ chatId: number; messageId: number; text: string }> = [];
  const callbackAnswers: Array<{ id: string; text?: string }> = [];
  const chatResponses = [toolJson, "I need approval before running it."];

  await handleTelegramUpdate(createTextUpdate(`run ${expectedAction}`, 12345), {
    config,
    paths,
    client: createRecordingClient(sentMessages, [], editedMessages, callbackAnswers),
    chatCompletion: async () => chatResponses.shift() ?? "done",
  });

  const store = await SqliteMemoryStore.open(paths);
  let approvalId: number;
  try {
    const approvals = store.listPendingActionApprovals("telegram");
    assert.equal(approvals.length, 1);
    assert.equal(approvals[0]?.action, expectedAction);
    approvalId = approvals[0].id;
  } finally {
    store.close();
  }

  await handleTelegramUpdate(createCallbackUpdate(`approval:approve:${approvalId}`, 12345, approvalId + 100), {
    config,
    paths,
    client: createRecordingClient(sentMessages, [], editedMessages, callbackAnswers),
  });

  assert.deepEqual(callbackAnswers.at(-1), { id: "callback-1", text: "Action executed." });
  assert.match(editedMessages.at(-1)?.text ?? "", new RegExp(`Executed ${expectedAction.replaceAll(".", "\\.")}`));
}

function createHttpTestServer(body: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end(body);
  });

  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Expected TCP test server address."));
        return;
      }
      resolvePromise({
        url: `http://127.0.0.1:${address.port}/mcp`,
        close: () => new Promise((resolveClose, rejectClose) => server.close((error) => (error ? rejectClose(error) : resolveClose()))),
      });
    });
  });
}

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-telegram-test-"));
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

async function writeRuntimeFiles(paths: RuntimePaths): Promise<void> {
  await mkdir(paths.appDir, { recursive: true });
  await writeEnvFile({ OPENAI_API_KEY: "sk-test" }, paths);
  await writeFile(paths.systemPromptPath, "You are Miu.\n");
}
