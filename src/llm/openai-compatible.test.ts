import assert from "node:assert/strict";
import test from "node:test";

import type { AppConfig } from "../runtime/config.js";
import { ProviderAuthError, ProviderFallbackError, ProviderNetworkError, ProviderRateLimitError, ProviderResponseError, ProviderTimeoutError } from "./errors.js";
import { buildChatCompletionRequestBody, sendChatCompletion, sendChatCompletionWithFallbacks } from "./openai-compatible.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const config: AppConfig = {
  version: 1,
  agent: {
    name: "Miu",
    ownerName: "Sep",
    language: "vi",
    toneIntensity: 7,
  },
  llm: {
    provider: "openai-compatible",
    baseUrl: "https://example.com/v1",
    model: "example-model",
    apiKeyEnv: "OPENAI_API_KEY",
  },
};

test("buildChatCompletionRequestBody uses OpenAI-compatible shape", () => {
  assert.deepEqual(
    buildChatCompletionRequestBody(config, {
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
    buildChatCompletionRequestBody(config, {
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

test("sendChatCompletion returns assistant text", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "Xin chao" } }] }), { status: 200 });

  const content = await sendChatCompletion(config, "secret", { messages: [{ role: "user", content: "Hi" }] }, fetchImpl);

  assert.equal(content, "Xin chao");
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
      return calls.length === 1
        ? new Response("bad gateway", { status: 502, statusText: "Bad Gateway" })
        : new Response(JSON.stringify({ choices: [{ message: { content: "Fallback reply" } }] }), { status: 200 });
    };

    const content = await sendChatCompletionWithFallbacks(
      {
        ...config,
        llm: {
          ...config.llm,
          fallbacks: [{ provider: "openai-compatible", baseUrl: "https://fallback.example.com/v1", model: "fallback-model", apiKeyEnv: "FALLBACK_LLM_API_KEY" }],
        },
      },
      { messages: [{ role: "user", content: "Hi" }] },
      { paths, fetchImpl },
    );

    assert.equal(content, "Fallback reply");
    assert.deepEqual(calls, [
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
              fallbacks: [{ provider: "openai-compatible", baseUrl: "https://fallback.example.com/v1", model: "fallback-model", apiKeyEnv: "FALLBACK_LLM_API_KEY" }],
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
