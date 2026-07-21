import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { ProviderAuthError, ProviderFallbackError, ProviderResponseError, ProviderTimeoutError } from "./errors.js";
import { createAudioTranscription, sendAudioTranscription, sendElevenLabsAudioTranscription } from "./openai-transcription.js";

const config: AppConfig = {
  version: 2,
  agent: { name: "Miu", ownerName: "Sep", language: "vi", toneIntensity: 7 },
  llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key" as const,
          baseUrl: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
  transcription: { provider: "openai-compatible", baseUrl: "https://audio.example.com/v1", model: "whisper-1", apiKeyEnv: "BESTIE_TRANSCRIPTION_API_KEY" },
};

test("sendAudioTranscription posts OpenAI-compatible multipart form data", async () => {
  let requestUrl = "";
  let requestHeaders: Headers;
  let requestBody: FormData;
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    requestUrl = String(url);
    requestHeaders = new Headers(init?.headers);
    requestBody = init?.body as FormData;
    return new Response(JSON.stringify({ text: "xin chào từ audio" }), { status: 200 });
  };

  const text = await sendAudioTranscription(
    config,
    "secret",
    { bytes: new Uint8Array([1, 2, 3]), localPath: "/tmp/message.ogg", mimeType: "audio/ogg" },
    fetchImpl,
  );

  assert.equal(text, "xin chào từ audio");
  assert.equal(requestUrl, "https://audio.example.com/v1/audio/transcriptions");
  assert.equal(requestHeaders!.get("authorization"), "Bearer secret");
  assert.equal(requestHeaders!.has("content-type"), false);
  assert.equal(requestBody!.get("model"), "whisper-1");
  assert.equal(requestBody!.get("response_format"), "json");
  const file = requestBody!.get("file");
  assert.ok(file instanceof File);
  assert.equal(file.name, "message.ogg");
  assert.equal(file.type, "audio/ogg");
  assert.equal(await file.text(), "\u0001\u0002\u0003");
});

test("sendAudioTranscription maps auth errors", async () => {
  const fetchImpl = async () => new Response("nope", { status: 401, statusText: "Unauthorized" });

  await assert.rejects(
    () => sendAudioTranscription(config, "secret", { bytes: new Uint8Array([1]), localPath: "voice.ogg" }, fetchImpl),
    ProviderAuthError,
  );
});

test("sendAudioTranscription normalizes trailing slashes in baseUrl", async () => {
  let requestUrl = "";

  await sendAudioTranscription(
    { ...config, transcription: { provider: "openai-compatible", baseUrl: "https://audio.example.com/v1/", model: "whisper-1", apiKeyEnv: "BESTIE_TRANSCRIPTION_API_KEY" } },
    "secret",
    { bytes: new Uint8Array([1]), localPath: "voice.ogg" },
    async (url) => {
      requestUrl = String(url);
      return new Response(JSON.stringify({ text: "ok" }), { status: 200 });
    },
  );

  assert.equal(requestUrl, "https://audio.example.com/v1/audio/transcriptions");
});

test("sendAudioTranscription includes bounded provider error details", async () => {
  const longDetail = `provider exploded ${"x".repeat(1_200)}`;
  const fetchImpl = async () => new Response(`\n${longDetail}\n`, { status: 500, statusText: "Server Error" });

  await assert.rejects(
    () => sendAudioTranscription(config, "secret", { bytes: new Uint8Array([1]), localPath: "voice.ogg" }, fetchImpl),
    (error: unknown) => {
      assert.ok(error instanceof ProviderResponseError);
      assert.match(error.message, /500 Server Error: provider exploded/);
      assert.ok(error.message.length < 1_100);
      assert.match(error.message, /\.\.\.$/);
      return true;
    },
  );
});

test("sendAudioTranscription retries transient provider errors", async () => {
  let calls = 0;

  const text = await sendAudioTranscription(
    config,
    "secret",
    { bytes: new Uint8Array([1]), localPath: "voice.ogg" },
    async () => {
      calls += 1;
      return calls === 1
        ? new Response("rate limited", { status: 429, statusText: "Too Many Requests" })
        : new Response(JSON.stringify({ text: "retried transcript" }), { status: 200 });
    },
  );

  assert.equal(text, "retried transcript");
  assert.equal(calls, 2);
});

test("sendAudioTranscription times out while reading response JSON", async () => {
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    const response = new Response("", { status: 200 });
    Object.defineProperty(response, "json", {
      value: () => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })),
    });
    return response;
  };

  await assert.rejects(
    () => sendAudioTranscription(config, "secret", { bytes: new Uint8Array([1]), localPath: "voice.ogg" }, fetchImpl, 1),
    ProviderTimeoutError,
  );
});

test("sendElevenLabsAudioTranscription calls ElevenLabs speech-to-text and returns text", async () => {
  const elevenLabsConfig: AppConfig = {
    ...config,
    transcription: { provider: "elevenlabs", apiKeyEnv: "ELEVENLABS_API_KEY", modelId: "scribe_v2", tagAudioEvents: true, diarize: false },
  };
  let request: { file: File; modelId: string; languageCode?: string; tagAudioEvents?: boolean; diarize?: boolean } | undefined;
  let timeoutInSeconds: number | undefined;

  const text = await sendElevenLabsAudioTranscription(
    elevenLabsConfig,
    "secret",
    { bytes: new Uint8Array([1, 2, 3]), localPath: "/tmp/message.ogg", mimeType: "audio/ogg" },
    {
      speechToText: {
        convert: async (receivedRequest, requestOptions) => {
          request = receivedRequest;
          timeoutInSeconds = requestOptions?.timeoutInSeconds;
          return { text: "xin chào từ elevenlabs" };
        },
      },
    },
    60_000,
  );

  assert.equal(text, "xin chào từ elevenlabs");
  assert.equal(request?.modelId, "scribe_v2");
  assert.equal(request?.languageCode, "vi");
  assert.equal(request?.tagAudioEvents, true);
  assert.equal(request?.diarize, false);
  assert.equal(request?.file.name, "message.ogg");
  assert.equal(request?.file.type, "audio/ogg");
  assert.equal(await request?.file.text(), "\u0001\u0002\u0003");
  assert.equal(timeoutInSeconds, 60);
});

test("sendElevenLabsAudioTranscription omits language code when agent language is mixed", async () => {
  let request: { languageCode?: string } | undefined;

  await sendElevenLabsAudioTranscription(
    {
      ...config,
      agent: { ...config.agent, language: "mixed" },
      transcription: { provider: "elevenlabs", apiKeyEnv: "ELEVENLABS_API_KEY", modelId: "scribe_v2" },
    },
    "secret",
    { bytes: new Uint8Array([1]), localPath: "/tmp/message.ogg", mimeType: "audio/ogg" },
    {
      speechToText: {
        convert: async (receivedRequest) => {
          request = receivedRequest;
          return { text: "hello" };
        },
      },
    },
  );

  assert.equal(request?.languageCode, undefined);
});

test("sendElevenLabsAudioTranscription uses configured transcription language code", async () => {
  let request: { languageCode?: string } | undefined;

  await sendElevenLabsAudioTranscription(
    {
      ...config,
      agent: { ...config.agent, language: "Vietnamese" },
      transcription: { provider: "elevenlabs", apiKeyEnv: "ELEVENLABS_API_KEY", modelId: "scribe_v2", languageCode: "vi" },
    },
    "secret",
    { bytes: new Uint8Array([1]), localPath: "/tmp/message.ogg", mimeType: "audio/ogg" },
    {
      speechToText: {
        convert: async (receivedRequest) => {
          request = receivedRequest;
          return { text: "hello" };
        },
      },
    },
  );

  assert.equal(request?.languageCode, "vi");
});

test("sendElevenLabsAudioTranscription passes arbitrary agent language codes", async () => {
  let request: { languageCode?: string } | undefined;

  await sendElevenLabsAudioTranscription(
    {
      ...config,
      agent: { ...config.agent, language: "ja" },
      transcription: { provider: "elevenlabs", apiKeyEnv: "ELEVENLABS_API_KEY", modelId: "scribe_v2" },
    },
    "secret",
    { bytes: new Uint8Array([1]), localPath: "/tmp/message.ogg", mimeType: "audio/ogg" },
    {
      speechToText: {
        convert: async (receivedRequest) => {
          request = receivedRequest;
          return { text: "hello" };
        },
      },
    },
  );

  assert.equal(request?.languageCode, "ja");
});

test("createAudioTranscription tries configured fallback provider", async () => {
  const paths = await createTempPaths();
  const calls: Array<{ url: string; model: FormDataEntryValue | null; auth: string | null }> = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeFile(paths.envPath, 'BESTIE_TRANSCRIPTION_API_KEY="primary-secret"\nFALLBACK_TRANSCRIPTION_API_KEY="fallback-secret"\n');
    const text = await createAudioTranscription(
      {
        ...config,
        transcription: {
          provider: "openai-compatible",
          baseUrl: "https://stt.primary/v1",
          model: "primary-stt",
          apiKeyEnv: "BESTIE_TRANSCRIPTION_API_KEY",
          fallbacks: [{ provider: "openai-compatible", baseUrl: "https://stt.fallback/v1", model: "fallback-stt", apiKeyEnv: "FALLBACK_TRANSCRIPTION_API_KEY" }],
        },
      },
      { bytes: new Uint8Array([1, 2]), localPath: "/tmp/message.ogg", mimeType: "audio/ogg" },
      {
        paths,
        fetchImpl: async (url, init) => {
          const body = init?.body as FormData;
          calls.push({ url: String(url), model: body.get("model"), auth: new Headers(init?.headers).get("authorization") });
          return calls.length === 1
            ? new Response("bad gateway", { status: 502, statusText: "Bad Gateway" })
            : new Response(JSON.stringify({ text: "fallback transcript" }), { status: 200 });
        },
      },
    );

    assert.equal(text, "fallback transcript");
    assert.deepEqual(calls, [
      { url: "https://stt.primary/v1/audio/transcriptions", model: "primary-stt", auth: "Bearer primary-secret" },
      { url: "https://stt.fallback/v1/audio/transcriptions", model: "fallback-stt", auth: "Bearer fallback-secret" },
    ]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("createAudioTranscription reports every failed fallback attempt", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeFile(paths.envPath, 'BESTIE_TRANSCRIPTION_API_KEY="primary-secret"\nFALLBACK_TRANSCRIPTION_API_KEY="fallback-secret"\n');

    await assert.rejects(
      () =>
        createAudioTranscription(
          {
            ...config,
            transcription: {
              provider: "openai-compatible",
              baseUrl: "https://stt.primary/v1",
              model: "primary-stt",
              apiKeyEnv: "BESTIE_TRANSCRIPTION_API_KEY",
              fallbacks: [{ provider: "openai-compatible", baseUrl: "https://stt.fallback/v1", model: "fallback-stt", apiKeyEnv: "FALLBACK_TRANSCRIPTION_API_KEY" }],
            },
          },
          { bytes: new Uint8Array([1, 2]), localPath: "/tmp/message.ogg", mimeType: "audio/ogg" },
          { paths, fetchImpl: async () => new Response("bad gateway", { status: 502, statusText: "Bad Gateway" }) },
        ),
      (error: unknown) => {
        assert.ok(error instanceof ProviderFallbackError);
        assert.deepEqual(error.attempts.map((attempt) => `${attempt.provider}/${attempt.model}`), ["openai-compatible/primary-stt", "openai-compatible/fallback-stt"]);
        assert.match(error.message, /primary-stt: Provider returned an unusable response: 502 Bad Gateway/);
        assert.match(error.message, /fallback-stt: Provider returned an unusable response: 502 Bad Gateway/);
        return true;
      },
    );
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("sendAudioTranscription rejects malformed provider responses", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ nope: "missing text" }), { status: 200 });

  await assert.rejects(
    () => sendAudioTranscription(config, "secret", { bytes: new Uint8Array([1]), localPath: "voice.ogg" }, fetchImpl),
    ProviderResponseError,
  );
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-openai-transcription-test-"));
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
