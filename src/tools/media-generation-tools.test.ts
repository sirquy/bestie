import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { imageGenerateTool, videoGenerateTool } from "./media-generation-tools.js";

test("imageGenerateTool calls configured provider and saves b64 output", async () => {
  const paths = await createTempPaths();
  const requests: Array<{ url: string; body: Record<string, unknown>; authorization: string | null }> = [];

  try {
    const result = await imageGenerateTool({
      config: createConfig({ "internal.image_generate": "allow" }),
      paths,
      env: { BESTIE_IMAGE_API_KEY: "image-secret" },
      prompt: "A tiny watercolor moon",
      size: "1024x1024",
      outputPath: "generated/moon",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), body: JSON.parse(String(init?.body)), authorization: new Headers(init?.headers).get("authorization") });
        return jsonResponse({ data: [{ b64_json: Buffer.from("image-bytes").toString("base64"), mime_type: "image/png", revised_prompt: "A tiny watercolor moon." }] });
      },
    });

    assert.equal(result.allowed, true);
    assert.equal(requests[0]?.url, "https://media.example.com/v1/images/generations");
    assert.equal(requests[0]?.authorization, "Bearer image-secret");
    assert.deepEqual(requests[0]?.body, { model: "image-model", prompt: "A tiny watercolor moon", size: "1024x1024", n: 1, response_format: "b64_json" });
    assert.equal(result.assets.length, 1);
    assert.equal(result.assets[0]?.path, resolve(paths.workspaceDir, "generated/moon.png"));
    assert.equal(await readFile(result.assets[0]!.path, "utf8"), "image-bytes");
    assert.equal(result.assets[0]?.revisedPrompt, "A tiny watercolor moon.");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});


test("imageGenerateTool uses llm.image primary and fallbacks", async () => {
  const paths = await createTempPaths();
  const requests: Array<{ url: string; body: Record<string, unknown>; authorization: string | null }> = [];
  const config = createConfig({ "internal.image_generate": "allow" });
  const imageConfig: AppConfig = {
    ...config,
    llm: {
      ...config.llm,
      image: { primary: "openai/image-primary", fallbacks: ["custom-openai/image-fallback"] },
      profiles: {
        ...config.llm.profiles,
        "image-primary:api-key": { provider: "openai", mode: "api-key", baseUrl: "https://image-primary.example.com/v1", apiKeyEnv: "PRIMARY_IMAGE_API_KEY" },
        "image-fallback:api-key": { provider: "openai-compatible", mode: "api-key", baseUrl: "https://image-fallback.example.com/v1", apiKeyEnv: "FALLBACK_IMAGE_API_KEY" },
      },
      modelCatalog: {
        ...config.llm.modelCatalog,
        "openai/image-primary": { profile: "image-primary:api-key" },
        "custom-openai/image-fallback": { profile: "image-fallback:api-key" },
      },
    },
    generation: { image: { ...config.generation!.image!, endpointPath: "/custom/images" }, video: config.generation!.video },
  };

  try {
    const result = await imageGenerateTool({
      config: imageConfig,
      paths,
      env: { PRIMARY_IMAGE_API_KEY: "primary-secret", FALLBACK_IMAGE_API_KEY: "fallback-secret" },
      prompt: "A tiny fallback moon",
      outputPath: "generated/fallback-moon.png",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), body: JSON.parse(String(init?.body)), authorization: new Headers(init?.headers).get("authorization") });
        if (String(url).includes("image-primary")) return new Response("primary down", { status: 500, statusText: "Nope" });
        return jsonResponse({ data: [{ b64_json: Buffer.from("fallback-image").toString("base64"), mime_type: "image/png" }] });
      },
    });

    assert.equal(result.allowed, true);
    assert.deepEqual(requests.map((request) => request.url), ["https://image-primary.example.com/v1/custom/images", "https://image-fallback.example.com/v1/custom/images"]);
    assert.deepEqual(requests.map((request) => request.body.model), ["image-primary", "image-fallback"]);
    assert.deepEqual(requests.map((request) => request.authorization), ["Bearer primary-secret", "Bearer fallback-secret"]);
    assert.equal(result.model, "image-fallback");
    assert.equal(await readFile(result.assets[0]!.path, "utf8"), "fallback-image");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("imageGenerateTool uses a native Gemini image model from llm.image", async () => {
  const paths = await createTempPaths();
  const config: AppConfig = {
    ...createConfig({ "internal.image_generate": "allow" }),
    llm: {
      primary: "gemini/gemini-3.1-flash-image-preview",
      authProfile: "gemini:api-key",
      image: { primary: "gemini/gemini-3.1-flash-image-preview" },
      profiles: { "gemini:api-key": { provider: "gemini", mode: "api-key", apiKeyEnv: "GEMINI_API_KEY" } },
      modelCatalog: { "gemini/gemini-3.1-flash-image-preview": { profile: "gemini:api-key" } },
    },
  };

  class FakeGoogleGenAI {
    constructor(_options: unknown) {}
    models = { generateContent: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: Buffer.from("gemini-image").toString("base64") } }] } }] }), generateContentStream: async () => { throw new Error("unused"); } };
  }

  try {
    const result = await imageGenerateTool({ config, paths, env: { GEMINI_API_KEY: "gemini-secret" }, prompt: "A bright moon", outputPath: "generated/gemini", googleGenAIClass: FakeGoogleGenAI as never });
    assert.equal(result.allowed, true);
    assert.equal(result.provider, "gemini");
    assert.equal(result.model, "gemini-3.1-flash-image-preview");
    assert.equal(await readFile(resolve(paths.workspaceDir, "generated/gemini.png"), "utf8"), "gemini-image");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});
test("videoGenerateTool downloads URL output and saves it", async () => {
  const paths = await createTempPaths();
  const urls: string[] = [];

  try {
    const result = await videoGenerateTool({
      config: createConfig({ "internal.video_generate": "allow" }),
      paths,
      env: { BESTIE_VIDEO_API_KEY: "video-secret" },
      prompt: "A calm sea loop",
      durationSeconds: 5,
      aspectRatio: "16:9",
      outputPath: "generated/sea.mp4",
      fetchImpl: async (url, init) => {
        urls.push(String(url));
        if (init?.method === "POST") {
          return jsonResponse({ data: [{ url: "https://cdn.example.com/video.mp4" }] });
        }
        return new Response(Buffer.from("video-bytes"), { status: 200, headers: { "content-type": "video/mp4" } });
      },
    });

    assert.equal(result.allowed, true);
    assert.deepEqual(urls, ["https://media.example.com/v1/videos/generations", "https://cdn.example.com/video.mp4"]);
    assert.equal(result.assets[0]?.path, resolve(paths.workspaceDir, "generated/sea.mp4"));
    assert.equal(await readFile(result.assets[0]!.path, "utf8"), "video-bytes");
    assert.equal(result.assets[0]?.sourceUrl, "https://cdn.example.com/video.mp4");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("media generation tools require config secrets and permission", async () => {
  const paths = await createTempPaths();

  try {
    const unconfigured = await imageGenerateTool({ config: { ...createConfig(), generation: undefined }, paths, prompt: "hello" });
    assert.equal(unconfigured.allowed, false);
    assert.match(unconfigured.reason, /llm\.image or generation\.image is not configured/);

    const missingSecret = await imageGenerateTool({ config: createConfig({ "internal.image_generate": "allow" }), paths, prompt: "hello", env: {} });
    assert.equal(missingSecret.allowed, false);
    assert.match(missingSecret.reason, /BESTIE_IMAGE_API_KEY is missing/);

    const denied = await videoGenerateTool({ config: createConfig(), paths, prompt: "hello", env: { BESTIE_VIDEO_API_KEY: "secret" } });
    assert.equal(denied.allowed, false);
    assert.match(denied.reason, /Approval required/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

function createConfig(policies: Record<string, "allow" | "ask" | "deny"> = {}): AppConfig {
  return {
    version: 2,
    agent: { name: "Bea", ownerName: "Andy", language: "vi", toneIntensity: 7 },
    llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key" as const,
          baseUrl: "http://127.0.0.1:9/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      },
    },
    generation: {
      image: { provider: "openai-compatible", baseUrl: "https://media.example.com/v1", model: "image-model", apiKeyEnv: "BESTIE_IMAGE_API_KEY" },
      video: { provider: "openai-compatible", baseUrl: "https://media.example.com/v1", model: "video-model", apiKeyEnv: "BESTIE_VIDEO_API_KEY" },
    },
    internalTools: { policies },
  };
}

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-media-generation-tools-test-"));
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
