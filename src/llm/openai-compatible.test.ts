import assert from "node:assert/strict";
import test from "node:test";

import type { AppConfig } from "../runtime/config.js";
import { resolvePrimaryLlmCandidate } from "./resolve-config.js";
import { ProviderAuthError, ProviderFallbackError, ProviderNetworkError, ProviderRateLimitError, ProviderResponseError, ProviderTimeoutError } from "./errors.js";
import { buildGeminiGenerateContentRequest } from "./adapters/gemini.js";
import { buildAnthropicMessagesRequestBody, buildChatCompletionRequestBody } from "./adapters/http-chat.js";
import { sendChatCompletion, sendChatCompletionWithFallbacks } from "./chat-completion.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const config: AppConfig = {
  version: 2,
  agent: {
    name: "Miu",
    ownerName: "Sep",
    language: "vi",
    toneIntensity: 7,
  },
  llm: {
    primary: "openai/example-model",
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
      "openai/example-model": { profile: "openai:api-key" },
    },
  },
};

test("buildChatCompletionRequestBody uses OpenAI-compatible shape", () => {
  assert.deepEqual(
    buildChatCompletionRequestBody(resolvePrimaryLlmCandidate(config), {
      messages: [{ role: "user", content: "Chao" }],
      maxTokens: 42,
      temperature: 0.7,
    }),
    {
      model: "example-model",
      messages: [{ role: "user", content: "Chao" }],
      max_tokens: 42,
      temperature: 0.7,
    },
  );
});

test("buildChatCompletionRequestBody preserves multimodal message parts", () => {
  assert.deepEqual(
    buildChatCompletionRequestBody(resolvePrimaryLlmCandidate(config), {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image." },
            { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
          ],
        },
      ],
    }),
    {
      model: "example-model",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image." },
            { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
          ],
        },
      ],
    },
  );
});

test("buildAnthropicMessagesRequestBody maps system prompts and user messages", () => {
  const claudeConfig: AppConfig = {
    ...config,
    llm: {
      ...config.llm,
      primary: "anthropic/claude-sonnet-4-5",
      authProfile: "anthropic:api-key",
      profiles: {
        "anthropic:api-key": { provider: "claude", mode: "api-key", baseUrl: "https://api.anthropic.com/v1", apiKeyEnv: "ANTHROPIC_API_KEY" },
      },
      modelCatalog: { "anthropic/claude-sonnet-4-5": { profile: "anthropic:api-key" } },
    },
  };

  assert.deepEqual(
    buildAnthropicMessagesRequestBody(resolvePrimaryLlmCandidate(claudeConfig), {
      messages: [
        { role: "system", content: "You are concise." },
        { role: "user", content: "Hi" },
      ],
      maxTokens: 64,
      temperature: 0.3,
    }),
    {
      model: "claude-sonnet-4-5",
      system: "You are concise.",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 64,
      temperature: 0.3,
    },
  );
});

test("buildGeminiGenerateContentRequest maps system prompts and multimodal messages", () => {
  assert.deepEqual(
    buildGeminiGenerateContentRequest(resolvePrimaryLlmCandidate(createGeminiConfig()), {
      messages: [
        { role: "system", content: "You are concise." },
        { role: "user", content: [{ type: "text", text: "Describe" }, { type: "image_url", image_url: { url: "data:image/png;base64,abc" } }] },
        { role: "assistant", content: "A small image." },
      ],
      maxTokens: 64,
      temperature: 0.3,
    }),
    {
      model: "gemini-2.5-flash",
      contents: [
        { role: "user", parts: [{ text: "Describe" }, { inlineData: { mimeType: "image/png", data: "abc" } }] },
        { role: "model", parts: [{ text: "A small image." }] },
      ],
      config: { systemInstruction: "You are concise.", maxOutputTokens: 64, temperature: 0.3 },
    },
  );
});

test("sendChatCompletion returns assistant text", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "Xin chao" } }] }), { status: 200 });

  const content = await sendChatCompletion(config, "secret", { messages: [{ role: "user", content: "Hi" }] }, fetchImpl);

  assert.equal(content, "Xin chao");
});

test("sendChatCompletion calls OpenAI-compatible aliases with chat completions", async () => {
  let requestedUrl = "";
  let authorization = "";
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    requestedUrl = String(url);
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(JSON.stringify({ choices: [{ message: { content: "Xin chao" } }] }), { status: 200 });
  };

  const content = await sendChatCompletion({ ...config, llm: { ...config.llm, profiles: { "openai:api-key": { ...config.llm.profiles["openai:api-key"]!, provider: "chatgpt" } } } }, "secret", { messages: [{ role: "user", content: "Hi" }] }, fetchImpl);

  assert.equal(content, "Xin chao");
  assert.equal(requestedUrl, "https://example.com/v1/chat/completions");
  assert.equal(authorization, "Bearer secret");
});

test("sendChatCompletion calls Claude provider with Anthropic messages API", async () => {
  let requestedUrl = "";
  let headers: Headers | undefined;
  let requestBody: unknown;
  const claudeConfig = createAnthropicConfig("claude");
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    requestedUrl = String(url);
    headers = new Headers(init?.headers);
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ content: [{ type: "text", text: "Chao tu Claude" }] }), { status: 200 });
  };

  const content = await sendChatCompletion(claudeConfig, "secret", { messages: [{ role: "user", content: "Hi" }], maxTokens: 32 }, fetchImpl);

  assert.equal(content, "Chao tu Claude");
  assert.equal(requestedUrl, "https://api.anthropic.com/v1/messages");
  assert.equal(headers?.get("x-api-key"), "secret");
  assert.equal(headers?.get("anthropic-version"), "2023-06-01");
  assert.deepEqual(requestBody, { model: "claude-sonnet-4-5", messages: [{ role: "user", content: "Hi" }], max_tokens: 32 });
});

test("sendChatCompletion calls Gemini native SDK", async () => {
  const calls: unknown[] = [];
  class FakeGoogleGenAI {
    models = {
      generateContent: async (params: unknown) => {
        calls.push(params);
        return { text: "Chao tu Gemini" };
      },
      generateContentStream: async () => { throw new Error("unused"); },
    };
    constructor(public options: unknown) {
      calls.push(options);
    }
  }

  const content = await sendChatCompletion(createGeminiConfig(), "secret", { messages: [{ role: "user", content: "Hi" }], maxTokens: 32 }, undefined, undefined, { googleGenAIClass: FakeGoogleGenAI });

  assert.equal(content, "Chao tu Gemini");
  assert.deepEqual(calls, [
    { apiKey: "secret", httpOptions: { timeout: 60000 } },
    { model: "gemini-2.5-flash", contents: [{ role: "user", parts: [{ text: "Hi" }] }], config: { maxOutputTokens: 32 } },
  ]);
});

test("sendChatCompletion reads Gemini candidate text parts", async () => {
  class FakeGoogleGenAI {
    models = {
      generateContent: async () => ({ candidates: [{ content: { parts: [{ text: "Chao" }, { text: " Gemini" }] } }] }),
      generateContentStream: async () => { throw new Error("unused"); },
    };
  }

  const content = await sendChatCompletion(createGeminiConfig(), "secret", { messages: [{ role: "user", content: "Hi" }] }, undefined, undefined, { googleGenAIClass: FakeGoogleGenAI });

  assert.equal(content, "Chao Gemini");
});

test("sendChatCompletion reports Gemini media-only responses", async () => {
  class FakeGoogleGenAI {
    models = {
      generateContent: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "abc" } }] } }] }),
      generateContentStream: async () => { throw new Error("unused"); },
    };
  }

  await assert.rejects(
    sendChatCompletion(createGeminiConfig(), "secret", { messages: [{ role: "user", content: "Hi" }] }, undefined, undefined, { googleGenAIClass: FakeGoogleGenAI }),
    /Gemini returned non-text media parts without assistant text/,
  );
});

test("sendChatCompletion streams Gemini native SDK chunks", async () => {
  const tokens: string[] = [];
  class FakeGoogleGenAI {
    models = {
      generateContent: async () => { throw new Error("unused"); },
      generateContentStream: async () => {
        async function* stream() {
          yield { text: "Xin" };
          yield { text: " chao" };
        }
        return stream();
      },
    };
  }

  const content = await sendChatCompletion(createGeminiConfig(), "secret", { messages: [{ role: "user", content: "Hi" }], stream: true, onToken: (token) => tokens.push(token) }, undefined, undefined, { googleGenAIClass: FakeGoogleGenAI });

  assert.equal(content, "Xin chao");
  assert.deepEqual(tokens, ["Xin", " chao"]);
});

test("sendChatCompletion streams assistant text chunks", async () => {
  const tokens: string[] = [];
  const encoder = new TextEncoder();
  let requestBody: unknown;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Xin"}}]}\n\n'));
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":" chao"}}]}\n\n'));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  };

  const content = await sendChatCompletion(config, "secret", { messages: [{ role: "user", content: "Hi" }], stream: true, onToken: (token) => tokens.push(token) }, fetchImpl);

  assert.deepEqual(requestBody, { model: "example-model", messages: [{ role: "user", content: "Hi" }], stream: true });
  assert.deepEqual(tokens, ["Xin", " chao"]);
  assert.equal(content, "Xin chao");
});

test("sendChatCompletion streams Claude text deltas", async () => {
  const tokens: string[] = [];
  const encoder = new TextEncoder();
  const claudeConfig = createAnthropicConfig("anthropic");
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('event: content_block_delta\n'));
      controller.enqueue(encoder.encode('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Xin"}}\n\n'));
      controller.enqueue(encoder.encode('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" chao"}}\n\n'));
      controller.close();
    },
  });
  const fetchImpl = async () => new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });

  const content = await sendChatCompletion(claudeConfig, "secret", { messages: [{ role: "user", content: "Hi" }], stream: true, onToken: (token) => tokens.push(token) }, fetchImpl);

  assert.deepEqual(tokens, ["Xin", " chao"]);
  assert.equal(content, "Xin chao");
});

test("sendChatCompletion maps auth errors", async () => {
  const fetchImpl = async () => new Response('{"error":"invalid token sk-secret123456"}', { status: 401, statusText: "Unauthorized" });

  await assert.rejects(
    () => sendChatCompletion(config, "secret", { messages: [{ role: "user", content: "Hi" }] }, fetchImpl),
    (error: unknown) => {
      assert.ok(error instanceof ProviderAuthError);
      assert.match(error.message, /401 Unauthorized/);
      assert.match(error.message, /invalid token \[REDACTED\]/);
      assert.doesNotMatch(error.message, /sk-secret123456/);
      return true;
    },
  );
});

test("sendChatCompletion maps rate limit errors", async () => {
  const fetchImpl = async () => new Response("slow down", { status: 429, statusText: "Too Many Requests" });

  await assert.rejects(
    () => sendChatCompletion({ ...config, llm: { ...config.llm, maxRetries: 0 } }, "secret", { messages: [{ role: "user", content: "Hi" }] }, fetchImpl),
    ProviderRateLimitError,
  );
});

test("sendChatCompletion maps network errors", async () => {
  const fetchImpl = async () => {
    throw new Error("socket hang up");
  };

  await assert.rejects(
    () => sendChatCompletion({ ...config, llm: { ...config.llm, maxRetries: 0 } }, "secret", { messages: [{ role: "user", content: "Hi" }] }, fetchImpl),
    ProviderNetworkError,
  );
});

test("sendChatCompletion retries transient network errors", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) {
      throw new Error("socket hang up");
    }

    return new Response(JSON.stringify({ choices: [{ message: { content: "Recovered" } }] }), { status: 200 });
  };

  const content = await sendChatCompletion(
    { ...config, llm: { ...config.llm, maxRetries: 1, retryDelayMs: 0 } },
    "secret",
    { messages: [{ role: "user", content: "Hi" }] },
    fetchImpl,
  );

  assert.equal(content, "Recovered");
  assert.equal(calls, 2);
});

test("sendChatCompletion retries rate limits within configured limit", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return calls === 1
      ? new Response("slow down", { status: 429, statusText: "Too Many Requests" })
      : new Response(JSON.stringify({ choices: [{ message: { content: "Recovered" } }] }), { status: 200 });
  };

  const content = await sendChatCompletion(
    { ...config, llm: { ...config.llm, maxRetries: 1, retryDelayMs: 0 } },
    "secret",
    { messages: [{ role: "user", content: "Hi" }] },
    fetchImpl,
  );

  assert.equal(content, "Recovered");
  assert.equal(calls, 2);
});

test("sendChatCompletion retries transient provider 5xx responses", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return calls === 1
      ? new Response('{"error":"upstream failed"}', { status: 500, statusText: "Internal Server Error" })
      : new Response(JSON.stringify({ choices: [{ message: { content: "Recovered" } }] }), { status: 200 });
  };

  const content = await sendChatCompletion(
    { ...config, llm: { ...config.llm, maxRetries: 1, retryDelayMs: 0 } },
    "secret",
    { messages: [{ role: "user", content: "Hi" }] },
    fetchImpl,
  );

  assert.equal(content, "Recovered");
  assert.equal(calls, 2);
});

test("sendChatCompletion logs retryable provider failures when runtime paths are provided", async () => {
  const paths = await createTempPaths();
  let calls = 0;

  try {
    const fetchImpl = async () => {
      calls += 1;
      return calls === 1
        ? new Response('{"error":"upstream failed with sk-secret123"}', { status: 500, statusText: "Internal Server Error" })
        : new Response(JSON.stringify({ choices: [{ message: { content: "Recovered" } }] }), { status: 200 });
    };

    await sendChatCompletion(
      { ...config, llm: { ...config.llm, maxRetries: 1, retryDelayMs: 0 } },
      "sk-secret123",
      { messages: [{ role: "user", content: "Hi" }] },
      fetchImpl,
      undefined,
      { paths, knownSecrets: ["sk-secret123"] },
    );

    const logText = await readFile(paths.appLogPath, "utf8");
    assert.match(logText, /"event":"llm_provider_retry"/);
    assert.match(logText, /"provider":"openai-compatible"/);
    assert.match(logText, /"model":"example-model"/);
    assert.match(logText, /"attempt":1/);
    assert.match(logText, /"maxRetries":1/);
    assert.match(logText, /"status":500/);
    assert.doesNotMatch(logText, /sk-secret123/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("sendChatCompletion does not retry non-transient provider 4xx responses", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response("bad request", { status: 400, statusText: "Bad Request" });
  };

  await assert.rejects(
    () => sendChatCompletion({ ...config, llm: { ...config.llm, maxRetries: 3, retryDelayMs: 0 } }, "secret", { messages: [{ role: "user", content: "Hi" }] }, fetchImpl),
    ProviderResponseError,
  );

  assert.equal(calls, 1);
});

test("sendChatCompletion aborts slow provider requests", async () => {
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });

  await assert.rejects(
    () => sendChatCompletion(config, "secret", { messages: [{ role: "user", content: "Hi" }] }, fetchImpl, 1),
    ProviderTimeoutError,
  );
});

test("sendChatCompletion uses configured llm timeout", async () => {
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });

  await assert.rejects(
    () => sendChatCompletion({ ...config, llm: { ...config.llm, timeoutMs: 1 } }, "secret", { messages: [{ role: "user", content: "Hi" }] }, fetchImpl),
    /1ms/,
  );
});

test("sendChatCompletion maps provider abort errors", async () => {
  const fetchImpl = async () => {
    throw new DOMException("This operation was aborted", "AbortError");
  };

  await assert.rejects(
    () => sendChatCompletion(config, "secret", { messages: [{ role: "user", content: "Hi" }] }, fetchImpl),
    ProviderTimeoutError,
  );
});

test("sendChatCompletion rejects malformed provider responses", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [] }), { status: 200 });

  await assert.rejects(
    () => sendChatCompletion(config, "secret", { messages: [{ role: "user", content: "Hi" }] }, fetchImpl),
    ProviderResponseError,
  );
});

test("sendChatCompletionWithFallbacks tries configured fallback model and provider", async () => {
  const paths = await createTempPaths();
  const calls: Array<{ url: string; model: string; auth: string | null }> = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeFile(paths.envPath, 'OPENAI_API_KEY="primary-secret"\nFALLBACK_LLM_API_KEY="fallback-secret"\n');
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      const headers = new Headers(init?.headers);
      calls.push({ url: String(url), model: body.model, auth: headers.get("authorization") });
      return calls.length <= 2
        ? new Response("bad gateway", { status: 502, statusText: "Bad Gateway" })
        : new Response(JSON.stringify({ choices: [{ message: { content: "Fallback reply" } }] }), { status: 200 });
    };

    const content = await sendChatCompletionWithFallbacks(
      {
        ...config,
        llm: {
          ...config.llm,
          maxRetries: 1,
          retryDelayMs: 0,
          fallbacks: ["fallback/fallback-model"],
          profiles: {
            ...config.llm.profiles,
            "fallback:api-key": { provider: "openai-compatible", mode: "api-key", baseUrl: "https://fallback.example.com/v1", apiKeyEnv: "FALLBACK_LLM_API_KEY" },
          },
          modelCatalog: {
            ...config.llm.modelCatalog,
            "fallback/fallback-model": { profile: "fallback:api-key" },
          },
        },
      },
      { messages: [{ role: "user", content: "Hi" }] },
      { paths, fetchImpl },
    );

    assert.equal(content, "Fallback reply");
    assert.deepEqual(calls, [
      { url: "https://example.com/v1/chat/completions", model: "example-model", auth: "Bearer primary-secret" },
      { url: "https://example.com/v1/chat/completions", model: "example-model", auth: "Bearer primary-secret" },
      { url: "https://fallback.example.com/v1/chat/completions", model: "fallback-model", auth: "Bearer fallback-secret" },
    ]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("sendChatCompletionWithFallbacks reports every failed fallback attempt", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeFile(paths.envPath, 'OPENAI_API_KEY="primary-secret"\nFALLBACK_LLM_API_KEY="fallback-secret"\n');
    const fetchImpl = async () => new Response('{"error":"model is not available for this account"}', { status: 502, statusText: "Bad Gateway" });

    await assert.rejects(
      () =>
        sendChatCompletionWithFallbacks(
          {
            ...config,
            llm: {
              ...config.llm,
              fallbacks: ["fallback/fallback-model"],
              profiles: {
                ...config.llm.profiles,
                "fallback:api-key": { provider: "openai-compatible", mode: "api-key", baseUrl: "https://fallback.example.com/v1", apiKeyEnv: "FALLBACK_LLM_API_KEY" },
              },
              modelCatalog: {
                ...config.llm.modelCatalog,
                "fallback/fallback-model": { profile: "fallback:api-key" },
              },
            },
          },
          { messages: [{ role: "user", content: "Hi" }] },
          { paths, fetchImpl },
        ),
      (error: unknown) => {
        assert.ok(error instanceof ProviderFallbackError);
        assert.deepEqual(error.attempts.map((attempt) => `${attempt.provider}/${attempt.model}`), ["openai-compatible/example-model", "openai-compatible/fallback-model"]);
        assert.match(error.message, /example-model: Provider returned an unusable response: 502 Bad Gateway: \{"error":"model is not available for this account"\}/);
        assert.match(error.message, /fallback-model: Provider returned an unusable response: 502 Bad Gateway: \{"error":"model is not available for this account"\}/);
        return true;
      },
    );
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-openai-compatible-test-"));
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

function createAnthropicConfig(provider: string): AppConfig {
  return {
    ...config,
    llm: {
      ...config.llm,
      primary: "anthropic/claude-sonnet-4-5",
      authProfile: "anthropic:api-key",
      profiles: {
        "anthropic:api-key": { provider, mode: "api-key", baseUrl: "https://api.anthropic.com/v1", apiKeyEnv: "ANTHROPIC_API_KEY" },
      },
      modelCatalog: { "anthropic/claude-sonnet-4-5": { profile: "anthropic:api-key" } },
    },
  };
}

function createGeminiConfig(): AppConfig {
  return {
    ...config,
    llm: {
      ...config.llm,
      primary: "gemini/gemini-2.5-flash",
      authProfile: "gemini:api-key",
      profiles: {
        "gemini:api-key": { provider: "gemini", mode: "api-key", baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKeyEnv: "GEMINI_API_KEY" },
      },
      modelCatalog: { "gemini/gemini-2.5-flash": { profile: "gemini:api-key" } },
    },
  };
}
