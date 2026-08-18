import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import type { BrowserContext } from "playwright";

import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { listBrowserPagesTool, openBrowserPageTool } from "./browser-tools.js";

test("browser tools reject non-http URLs before launching", async () => {
  const paths = await createTempPaths();
  try {
    const rejectedUrl = await openBrowserPageTool({ config: createConfig(), paths, url: "file:///tmp/nope" });
    assert.equal(rejectedUrl.allowed, false);
    assert.match(rejectedUrl.reason, /http or https/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("browser open captures localhost screenshot evidence", async (t) => {
  const paths = await createTempPaths();
  const server = await createTestServer("<title>Bestie Browser</title><h1>Hello browser tools</h1><button>Continue</button>");

  try {
    const result = await openBrowserPageTool({ config: createConfig(), paths, url: server.url });
    if (!result.allowed && /Executable doesn't exist|browserType.launchPersistentContext|Playwright is not installed/i.test(result.reason)) {
      t.diagnostic(result.reason);
      return;
    }

    assert.equal(result.allowed, true);
    assert.equal(result.reason, "Browser tools are allowed without approval.");
    assert.equal(result.title, "Bestie Browser");
    assert.match(result.text ?? "", /Hello browser tools/);
    assert.ok(result.screenshotPath?.endsWith(".png"));
    assert.ok(result.elements?.some((element) => element.kind === "button" && element.text === "Continue"));
  } finally {
    await server.close();
    await rm(paths.rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("browser tools attach to a configured loopback CDP browser", async (t) => {
  const paths = await createTempPaths();
  let context: BrowserContext | undefined;
  const server = await createTestServer("<title>Configured browser</title><h1>Attached over CDP</h1>");

  try {
    const playwright = await import("playwright").catch(() => undefined);
    if (!playwright) {
      t.diagnostic("Playwright is not installed.");
      return;
    }
    try {
      context = await playwright.chromium.launchPersistentContext(resolve(paths.rootDir, "cdp-profile"), {
        headless: true,
        args: ["--remote-debugging-port=9223"],
      });
    } catch (error) {
      t.diagnostic(error instanceof Error ? error.message : String(error));
      return;
    }
    const page = context ? await context.newPage() : undefined;
    if (!page) throw new Error("Expected a browser context for CDP test.");
    await page.goto(server.url);
    const config = createConfig();
    config.internalTools = { browser: { cdpEndpoint: "http://127.0.0.1:9223" } };
    const result = await listBrowserPagesTool({ config, paths });
    assert.equal(result.allowed, true);
    assert.ok(result.pages?.some((entry) => entry.title === "Configured browser"));
  } finally {
    await context?.close().catch(() => undefined);
    await server.close();
    await rm(paths.rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

function createConfig(options: { policies?: Record<string, "allow" | "ask" | "deny"> } = {}): AppConfig {
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
    internalTools: {
      policies: options.policies ?? {},
    },
  };
}

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-browser-tools-test-"));
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

function createTestServer(html: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><body>${html}</body></html>`);
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
        url: `http://127.0.0.1:${address.port}/`,
        close: () => new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose())),
      });
    });
  });
}
