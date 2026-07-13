import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { ProviderAuthError, ProviderFallbackError, ProviderResponseError } from "./errors.js";
import { createSpeech, sendElevenLabsSpeech, sendSpeech } from "./openai-speech.js";

const config: AppConfig = {
  version: 1,
  agent: { name: "Miu", ownerName: "Sep", language: "vi", toneIntensity: 7 },
  llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "chat-model", apiKeyEnv: "OPENAI_API_KEY" },
  speech: { provider: "openai-compatible", baseUrl: "http://localhost:20128/v1", model: "google-tts/vi", apiKeyEnv: "BESTIE_TTS_API_KEY" },
};

const elevenLabsConfig: AppConfig = {
  version: 1,
  agent: { name: "Miu", ownerName: "Sep", language: "vi", toneIntensity: 7 },
  llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "chat-model", apiKeyEnv: "OPENAI_API_KEY" },
  speech: { provider: "elevenlabs", apiKeyEnv: "ELEVENLABS_API_KEY", voiceId: "NOpBlnGInO9m6vDvFkFC", modelId: "eleven_v3", outputFormat: "mp3_44100_128" },
};

test("sendSpeech posts OpenAI-compatible speech JSON and returns audio bytes", async () => {
  let requestUrl = "";
  let requestHeaders: Headers;
  let requestBody: { model: string; input: string };
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    requestUrl = String(url);
    requestHeaders = new Headers(init?.headers);
    requestBody = JSON.parse(String(init?.body));
    return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mp3" } });
  };

  const speech = await sendSpeech(config, "secret", { text: " xin chào " }, fetchImpl);

  assert.deepEqual([...speech.bytes], [1, 2, 3]);
  assert.equal(speech.mimeType, "audio/mp3");
  assert.equal(requestUrl, "http://localhost:20128/v1/audio/speech");
  assert.equal(requestHeaders!.get("authorization"), "Bearer secret");
  assert.equal(requestHeaders!.get("content-type"), "application/json");
  assert.deepEqual(requestBody!, { model: "google-tts/vi", input: "xin chào" });
});

test("sendSpeech maps auth errors", async () => {
  const fetchImpl = async () => new Response("nope", { status: 401, statusText: "Unauthorized" });

  await assert.rejects(() => sendSpeech(config, "secret", { text: "xin chào" }, fetchImpl), ProviderAuthError);
});

test("sendSpeech includes bounded provider error details", async () => {
  const longDetail = `speech provider failed ${"x".repeat(1_200)}`;
  const fetchImpl = async () => new Response(`\n${longDetail}\n`, { status: 502, statusText: "Bad Gateway" });

  await assert.rejects(
    () => sendSpeech(config, "secret", { text: "xin chào" }, fetchImpl),
    (error: unknown) => {
      assert.ok(error instanceof ProviderResponseError);
      assert.match(error.message, /502 Bad Gateway: speech provider failed/);
      assert.ok(error.message.length < 1_100);
      assert.match(error.message, /\.\.\.$/);
      return true;
    },
  );
});

test("sendSpeech rejects empty audio responses", async () => {
  const fetchImpl = async () => new Response(new Uint8Array(), { status: 200 });

  await assert.rejects(() => sendSpeech(config, "secret", { text: "xin chào" }, fetchImpl), ProviderResponseError);
});

test("sendElevenLabsSpeech calls ElevenLabs text-to-speech and returns stream bytes", async () => {
  let request: { voiceId: string; body: { text: string; modelId?: string; languageCode?: string; outputFormat?: string }; timeout?: number } | undefined;
  const client = {
    textToSpeech: {
      convert: async (voiceId: string, body: { text: string; modelId?: string; languageCode?: string; outputFormat?: string }, options?: { timeoutInSeconds?: number }) => {
        request = { voiceId, body, timeout: options?.timeoutInSeconds };
        return new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2]));
            controller.enqueue(new Uint8Array([3]));
            controller.close();
          },
        });
      },
    },
  };

  const speech = await sendElevenLabsSpeech(elevenLabsConfig, "secret", { text: " xin chào " }, client, 12_000);

  assert.deepEqual([...speech.bytes], [1, 2, 3]);
  assert.equal(speech.mimeType, "audio/mpeg");
  assert.deepEqual(request, {
    voiceId: "NOpBlnGInO9m6vDvFkFC",
    body: { text: "xin chào", modelId: "eleven_v3", languageCode: "vi", outputFormat: "mp3_44100_128" },
    timeout: 12,
  });
});

test("sendElevenLabsSpeech omits language code when agent language is mixed", async () => {
  let body: { languageCode?: string } | undefined;
  const client = {
    textToSpeech: {
      convert: async (_voiceId: string, receivedBody: { languageCode?: string }) => {
        body = receivedBody;
        return new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1]));
            controller.close();
          },
        });
      },
    },
  };

  await sendElevenLabsSpeech({ ...elevenLabsConfig, agent: { ...elevenLabsConfig.agent, language: "mixed" } }, "secret", { text: "hello" }, client);

  assert.equal(body?.languageCode, undefined);
});

test("sendElevenLabsSpeech passes arbitrary agent language codes", async () => {
  let body: { languageCode?: string } | undefined;
  const client = {
    textToSpeech: {
      convert: async (_voiceId: string, receivedBody: { languageCode?: string }) => {
        body = receivedBody;
        return new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1]));
            controller.close();
          },
        });
      },
    },
  };

  await sendElevenLabsSpeech({ ...elevenLabsConfig, agent: { ...elevenLabsConfig.agent, language: "ja" } }, "secret", { text: "hello" }, client);

  assert.equal(body?.languageCode, "ja");
});

test("createSpeech tries configured fallback provider", async () => {
  const paths = await createTempPaths();
  const calls: Array<{ url: string; body: { model: string; input: string }; auth: string | null }> = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeFile(paths.envPath, 'BESTIE_TTS_API_KEY="primary-secret"\nFALLBACK_TTS_API_KEY="fallback-secret"\n');
    const speech = await createSpeech(
      {
        ...config,
        speech: {
          provider: "openai-compatible",
          baseUrl: "https://speech.primary/v1",
          model: "primary-tts",
          apiKeyEnv: "BESTIE_TTS_API_KEY",
          fallbacks: [{ provider: "openai-compatible", baseUrl: "https://speech.fallback/v1", model: "fallback-tts", apiKeyEnv: "FALLBACK_TTS_API_KEY" }],
        },
      },
      { text: "xin chào" },
      {
        paths,
        fetchImpl: async (url, init) => {
          calls.push({ url: String(url), body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get("authorization") });
          return calls.length === 1
            ? new Response("bad gateway", { status: 502, statusText: "Bad Gateway" })
            : new Response(new Uint8Array([7, 8, 9]), { status: 200, headers: { "content-type": "audio/mp3" } });
        },
      },
    );

    assert.deepEqual([...speech.bytes], [7, 8, 9]);
    assert.deepEqual(calls, [
      { url: "https://speech.primary/v1/audio/speech", body: { model: "primary-tts", input: "xin chào" }, auth: "Bearer primary-secret" },
      { url: "https://speech.fallback/v1/audio/speech", body: { model: "fallback-tts", input: "xin chào" }, auth: "Bearer fallback-secret" },
    ]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("createSpeech reports every failed fallback attempt", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeFile(paths.envPath, 'BESTIE_TTS_API_KEY="primary-secret"\nFALLBACK_TTS_API_KEY="fallback-secret"\n');

    await assert.rejects(
      () =>
        createSpeech(
          {
            ...config,
            speech: {
              provider: "openai-compatible",
              baseUrl: "https://speech.primary/v1",
              model: "primary-tts",
              apiKeyEnv: "BESTIE_TTS_API_KEY",
              fallbacks: [{ provider: "openai-compatible", baseUrl: "https://speech.fallback/v1", model: "fallback-tts", apiKeyEnv: "FALLBACK_TTS_API_KEY" }],
            },
          },
          { text: "xin chào" },
          { paths, fetchImpl: async () => new Response("bad gateway", { status: 502, statusText: "Bad Gateway" }) },
        ),
      (error: unknown) => {
        assert.ok(error instanceof ProviderFallbackError);
        assert.deepEqual(error.attempts.map((attempt) => `${attempt.provider}/${attempt.model}`), ["openai-compatible/primary-tts", "openai-compatible/fallback-tts"]);
        assert.match(error.message, /primary-tts: Provider returned an unusable response: 502 Bad Gateway/);
        assert.match(error.message, /fallback-tts: Provider returned an unusable response: 502 Bad Gateway/);
        return true;
      },
    );
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-openai-speech-test-"));
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
